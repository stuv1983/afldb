'use server';

import { sql } from '@/db/client';
import {
  adoptLegacyPick as adoptLegacyPickQuery,
  attachAflTablesIdentity as attachAflTablesIdentityQuery,
  createManualPick as createManualPickQuery,
  createPlayerAndDraftPick as createPlayerAndDraftPickQuery,
  getDraftPickAdminDetail,
  retireManualPick as retireManualPickQuery,
  retireSourcePickOverride as retireSourcePickOverrideQuery,
  saveManualPick as saveManualPickQuery,
  saveSourcePickFields as saveSourcePickFieldsQuery,
  supersedeManualPickBySourceRow as supersedeManualPickBySourceRowQuery,
  type DraftRefusalReason,
} from '@/db/queries/admin-draft';
import { searchPlayers } from '@/db/queries/search';
import { audit, requireCapability } from '@/lib/auth/session';
import { playerPath } from '@/lib/format';

import type { DraftActionState } from './submit-helper';
import {
  optionalText, parseEventPair, parseNullablePickNumber, parsePositiveInt, requiredText,
} from './validation';

/**
 * The draft administration Server Actions (AFLDB-ISSUE-160 §18), matching
 * the coach/brownlow shape: assert the capability first, parse the form,
 * hand the decision to one `src/db/queries/admin-draft.ts` transaction (the
 * ONE draft mutation contract, D-5), audit a refusal worth one, and return
 * the public paths that changed for the client to revalidate AFTER this
 * action has already returned (D-9's `submit-helper.ts` posts to
 * `/admin/draft/revalidate` -- nothing here calls `revalidatePath`).
 *
 * `requireCapability('data.draft.edit')` is Super Admin only (D-6): every
 * mutation here is a person-identity or public-fact decision with no draft
 * stage.
 */

function shouldAuditRefusal(reason: DraftRefusalReason): boolean {
  return reason === 'duplicate' || reason === 'conflict' || reason === 'stale'
    || reason === 'forbidden' || reason === 'ambiguous_identity';
}

async function auditRefusal(action: string, detail: Record<string, unknown>, actorId: number, label: string): Promise<void> {
  try {
    await audit('admin.draft_refused', { action, ...detail }, { userId: actorId, label });
  } catch (error) {
    console.error('Failed to log administrative audit for draft admin refusal', error);
  }
}

/** `/players/<slug>-<id>` for each affected player, resolved fresh (never client-supplied). */
async function playerRevalidatePaths(playerIds: number[], options: { includeSitemap?: boolean } = {}): Promise<string[]> {
  const ids = [...new Set(playerIds)];
  const paths: string[] = [];
  if (ids.length > 0) {
    const rows = await sql<{ id: number; slug: string }[]>`SELECT id, slug FROM players WHERE id = ANY(${ids})`;
    for (const row of rows) paths.push(playerPath(row.slug, row.id));
  }
  if (options.includeSitemap) paths.push('/sitemap.xml');
  return paths;
}

function readFieldValues(formData: FormData, prefix: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of formData.keys()) {
    if (key.startsWith(prefix)) values[key.slice(prefix.length)] = (formData.get(key) ?? '').toString();
  }
  return values;
}

// --- 6.1 / 6.2: source-owned field groups -------------------------------

export async function saveSourcePickFieldsAction(
  _previous: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  const admin = await requireCapability('data.draft.edit');

  const pickId = parsePositiveInt(formData.get('pickId'));
  const groupKey = (formData.get('groupKey') ?? '').toString();
  if (pickId === null || !groupKey) return { error: 'Bad request.' };

  const result = await saveSourcePickFieldsQuery({
    pickId,
    groupKey,
    raw: readFieldValues(formData, 'field:'),
    adminUserId: admin.id,
    note: optionalText(formData.get('note'), 2000),
    expectedRevision: optionalText(formData.get('expectedRevision'), 40),
    confirmed: formData.get('confirmed') === '1',
  });

  if (!result.ok) {
    if ('needsConfirmation' in result) {
      return { needsConfirmation: true, confirm: result.confirm, candidates: result.candidates, error: result.error };
    }
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal('save_source_fields', { pickId, groupKey, reason: result.error }, admin.id, admin.email);
    }
    return { error: result.error };
  }

  try {
    await audit('draft.source_fields_saved', { pickId, groupKey }, { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for draft source field save', error);
  }

  const detail = await getDraftPickAdminDetail(pickId);
  return {
    ok: true,
    message: 'Selection saved.',
    revalidatePaths: detail?.playerId ? await playerRevalidatePaths([detail.playerId]) : [],
  };
}

export async function retireSourcePickOverrideAction(
  _previous: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  const admin = await requireCapability('data.draft.edit');

  const pickId = parsePositiveInt(formData.get('pickId'));
  const groupKey = (formData.get('groupKey') ?? '').toString();
  if (pickId === null || !groupKey) return { error: 'Bad request.' };

  const result = await retireSourcePickOverrideQuery({
    pickId, groupKey, adminUserId: admin.id, note: optionalText(formData.get('note'), 2000),
  });

  if (!result.ok) {
    if ('needsConfirmation' in result) return { error: result.error };
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal('retire_source_override', { pickId, groupKey, reason: result.error }, admin.id, admin.email);
    }
    return { error: result.error };
  }

  try {
    await audit('draft.source_override_retired', { pickId, groupKey }, { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for draft override retirement', error);
  }

  const detail = await getDraftPickAdminDetail(pickId);
  return {
    ok: true,
    message: 'Override retired. The next source reload restores the source value.',
    revalidatePaths: detail?.playerId ? await playerRevalidatePaths([detail.playerId]) : [],
  };
}

// --- 6.3 / 6.3b: create a selection --------------------------------------

export async function createManualPickAction(
  _previous: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  const admin = await requireCapability('data.draft.edit');

  const playerId = parsePositiveInt(formData.get('playerId'));
  const draftYear = parsePositiveInt(formData.get('draftYear'));
  const eventPair = parseEventPair(formData.get('eventPair'));
  const clubSlug = requiredText(formData.get('clubSlug'), 60);
  const pick = parseNullablePickNumber(formData.get('pickNumber'));
  if (playerId === null) return { error: 'Select an existing player first.' };
  if (draftYear === null || !eventPair || !clubSlug || !pick.ok) return { error: 'Fill in the draft year, event, and club.' };

  const result = await createManualPickQuery({
    playerId,
    draftYear,
    draftType: eventPair.draftType,
    draftKind: eventPair.draftKind,
    pickNumber: pick.value,
    clubSlug,
    playerNameRaw: optionalText(formData.get('playerNameRaw'), 120),
    originalClubRaw: optionalText(formData.get('originalClubRaw'), 160),
    draftAge: parsePositiveInt(formData.get('draftAge')),
    heightCm: parsePositiveInt(formData.get('heightCm')),
    weightKg: parsePositiveInt(formData.get('weightKg')),
    pickNote: optionalText(formData.get('pickNote'), 500),
    detail: optionalText(formData.get('detail'), 2000),
    adminUserId: admin.id,
    note: optionalText(formData.get('note'), 2000),
    confirmed: formData.get('confirmed') === '1',
  });

  if (!result.ok) {
    if ('needsConfirmation' in result) {
      return { needsConfirmation: true, confirm: result.confirm, candidates: result.candidates, error: result.error };
    }
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal('create_manual_pick', { playerId, draftYear, reason: result.error }, admin.id, admin.email);
    }
    return { error: result.error };
  }

  try {
    await audit('draft.manual_pick_created', { pickId: result.pickId, playerId: result.playerId }, { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for manual pick creation', error);
  }

  return {
    ok: true,
    message: `Selection #${result.pickId} recorded.`,
    revalidatePaths: await playerRevalidatePaths([result.playerId]),
  };
}

export async function createPlayerAndDraftPickAction(
  _previous: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  const admin = await requireCapability('data.draft.edit');

  const draftYear = parsePositiveInt(formData.get('draftYear'));
  const eventPair = parseEventPair(formData.get('eventPair'));
  const clubSlug = requiredText(formData.get('clubSlug'), 60);
  const pick = parseNullablePickNumber(formData.get('pickNumber'));
  const displayName = requiredText(formData.get('displayName'), 100);
  if (draftYear === null || !eventPair || !clubSlug || !pick.ok) return { error: 'Fill in the draft year, event, and club.' };
  if (!displayName) return { error: 'Display name is required.' };

  const heightCm = parsePositiveInt(formData.get('heightCm'));
  const weightKg = parsePositiveInt(formData.get('weightKg'));

  const result = await createPlayerAndDraftPickQuery({
    draftYear,
    draftType: eventPair.draftType,
    draftKind: eventPair.draftKind,
    pickNumber: pick.value,
    clubSlug,
    originalClubRaw: optionalText(formData.get('originalClubRaw'), 160),
    draftAge: parsePositiveInt(formData.get('draftAge')),
    heightCm,
    weightKg,
    pickNote: optionalText(formData.get('pickNote'), 500),
    detail: optionalText(formData.get('detail'), 2000),
    player: {
      displayName,
      givenName: optionalText(formData.get('givenName'), 60),
      surname: optionalText(formData.get('surname'), 60),
      dob: optionalText(formData.get('dob'), 10),
      heightCm,
      weightKg,
      notes: optionalText(formData.get('notes'), 2000),
    },
    adminUserId: admin.id,
    note: optionalText(formData.get('note'), 2000),
    confirmed: formData.get('confirmed') === '1',
  });

  if (!result.ok) {
    if ('needsConfirmation' in result) {
      return { needsConfirmation: true, confirm: result.confirm, candidates: result.candidates, error: result.error };
    }
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal('create_player_and_draft_pick', { displayName, draftYear, reason: result.error }, admin.id, admin.email);
    }
    return { error: result.error };
  }

  try {
    await audit('draft.player_created', { playerId: result.playerId, pickId: result.pickId }, { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for draft player creation', error);
  }

  return {
    ok: true,
    message: `${displayName} created (#${result.playerId}); selection #${result.pickId} recorded. `
      + 'External identity: none yet (manual). An AFL Tables identity attaches after debut; '
      + 'a DraftGuru identity links through Player links when the source publishes this person.',
    revalidatePaths: await playerRevalidatePaths([result.playerId], { includeSitemap: true }),
  };
}

// --- 6.4: edit a manual selection ----------------------------------------

export async function saveManualPickAction(
  _previous: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  const admin = await requireCapability('data.draft.edit');

  const pickId = parsePositiveInt(formData.get('pickId'));
  const playerId = parsePositiveInt(formData.get('playerId'));
  const draftYear = parsePositiveInt(formData.get('draftYear'));
  const eventPair = parseEventPair(formData.get('eventPair'));
  const clubSlug = requiredText(formData.get('clubSlug'), 60);
  const pick = parseNullablePickNumber(formData.get('pickNumber'));
  if (pickId === null || playerId === null) return { error: 'Bad request.' };
  if (draftYear === null || !eventPair || !clubSlug || !pick.ok) return { error: 'Fill in the draft year, event, and club.' };

  const before = await getDraftPickAdminDetail(pickId);

  const result = await saveManualPickQuery({
    pickId,
    playerId,
    draftYear,
    draftType: eventPair.draftType,
    draftKind: eventPair.draftKind,
    pickNumber: pick.value,
    clubSlug,
    playerNameRaw: optionalText(formData.get('playerNameRaw'), 120),
    originalClubRaw: optionalText(formData.get('originalClubRaw'), 160),
    draftAge: parsePositiveInt(formData.get('draftAge')),
    heightCm: parsePositiveInt(formData.get('heightCm')),
    weightKg: parsePositiveInt(formData.get('weightKg')),
    pickNote: optionalText(formData.get('pickNote'), 500),
    detail: optionalText(formData.get('detail'), 2000),
    adminUserId: admin.id,
    note: optionalText(formData.get('note'), 2000),
    expectedRevision: optionalText(formData.get('expectedRevision'), 40),
    confirmed: formData.get('confirmed') === '1',
  });

  if (!result.ok) {
    if ('needsConfirmation' in result) {
      return { needsConfirmation: true, confirm: result.confirm, candidates: result.candidates, error: result.error };
    }
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal('save_manual_pick', { pickId, playerId, reason: result.error }, admin.id, admin.email);
    }
    return { error: result.error };
  }

  try {
    await audit('draft.manual_pick_saved', { pickId, playerId, relinked: result.relinked }, { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for manual pick save', error);
  }

  const affected = new Set([playerId]);
  if (before?.playerId) affected.add(before.playerId);
  return {
    ok: true,
    message: result.relinked ? 'Selection saved and relinked to the new player.' : 'Selection saved.',
    revalidatePaths: await playerRevalidatePaths([...affected]),
  };
}

// --- 6.4b / 6.8: adopt a legacy pick --------------------------------------

export async function adoptLegacyPickAction(
  _previous: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  const admin = await requireCapability('data.draft.edit');

  const pickId = parsePositiveInt(formData.get('pickId'));
  const eventPair = parseEventPair(formData.get('eventPair'));
  if (pickId === null || !eventPair) return { error: 'Choose the draft event this selection belongs to.' };

  const result = await adoptLegacyPickQuery({
    pickId,
    draftType: eventPair.draftType,
    draftKind: eventPair.draftKind,
    adminUserId: admin.id,
    note: optionalText(formData.get('note'), 2000),
    confirmed: formData.get('confirmed') === '1',
  });

  if (!result.ok) {
    if ('needsConfirmation' in result) {
      return { needsConfirmation: true, confirm: result.confirm, candidates: result.candidates, error: result.error };
    }
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal('adopt_legacy_pick', { pickId, reason: result.error }, admin.id, admin.email);
    }
    return { error: result.error };
  }

  try {
    await audit(
      'draft.legacy_pick_adopted',
      { pickId, playerId: result.playerId, mintedPlayerIdentity: result.mintedPlayerIdentity },
      { userId: admin.id, label: admin.email },
    );
  } catch (error) {
    console.error('Failed to log administrative audit for legacy pick adoption', error);
  }

  return {
    ok: true,
    message: result.mintedPlayerIdentity
      ? 'Selection adopted. The linked player had no durable identity and was given one in the same step.'
      : 'Selection adopted; it now carries a durable, replayable and promotable identity.',
    revalidatePaths: await playerRevalidatePaths([result.playerId]),
  };
}

// --- 6.5: attach a later AFL Tables identity ------------------------------

export async function attachAflTablesIdentityAction(
  _previous: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  const admin = await requireCapability('data.draft.edit');

  const playerId = parsePositiveInt(formData.get('playerId'));
  const profilePath = requiredText(formData.get('profilePath'), 200);
  if (playerId === null || !profilePath) return { error: 'Enter an AFL Tables profile path.' };

  const result = await attachAflTablesIdentityQuery({
    playerId, profilePath, adminUserId: admin.id, note: optionalText(formData.get('note'), 2000),
  });

  if (!result.ok) {
    if ('needsConfirmation' in result) return { error: result.error };
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal('attach_afltables_identity', { playerId, profilePath, reason: result.error }, admin.id, admin.email);
    }
    return { error: result.error };
  }

  try {
    await audit('draft.afltables_identity_attached', { playerId, profilePath }, { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for identity attach', error);
  }

  return {
    ok: true,
    message: 'AFL Tables identity attached. The next settle and the next fitzRoy import will resolve onto this player.',
    revalidatePaths: await playerRevalidatePaths([playerId]),
  };
}

// --- 6.6 / 6.7: retire or supersede a manual selection --------------------

export async function retireManualPickAction(
  _previous: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  const admin = await requireCapability('data.draft.edit');

  const pickId = parsePositiveInt(formData.get('pickId'));
  if (pickId === null) return { error: 'Bad request.' };
  if (formData.get('confirmRetire') !== '1') return { error: 'Confirm the retirement before submitting.' };

  const result = await retireManualPickQuery({
    pickId,
    adminUserId: admin.id,
    note: optionalText(formData.get('note'), 2000),
    expectedRevision: optionalText(formData.get('expectedRevision'), 40),
  });

  if (!result.ok) {
    if ('needsConfirmation' in result) return { error: result.error };
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal('retire_manual_pick', { pickId, reason: result.error }, admin.id, admin.email);
    }
    return { error: result.error };
  }

  try {
    await audit('draft.manual_pick_retired', { pickId, playerId: result.playerId }, { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for manual pick retirement', error);
  }

  return { ok: true, message: 'Selection retired.', revalidatePaths: await playerRevalidatePaths([result.playerId]) };
}

export async function supersedeManualPickBySourceRowAction(
  _previous: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  const admin = await requireCapability('data.draft.edit');

  const manualPickId = parsePositiveInt(formData.get('manualPickId'));
  const sourcePickId = parsePositiveInt(formData.get('sourcePickId'));
  if (manualPickId === null || sourcePickId === null) return { error: 'Bad request.' };

  const result = await supersedeManualPickBySourceRowQuery({
    manualPickId, sourcePickId, adminUserId: admin.id, note: optionalText(formData.get('note'), 2000),
  });

  if (!result.ok) {
    if ('needsConfirmation' in result) return { error: result.error };
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal('supersede_manual_pick', { manualPickId, sourcePickId, reason: result.error }, admin.id, admin.email);
    }
    return { error: result.error };
  }

  try {
    await audit('draft.manual_pick_superseded', { manualPickId, sourcePickId, playerId: result.playerId }, { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for manual pick supersession', error);
  }

  return {
    ok: true,
    message: 'The manual selection was retired; the source-owned selection now carries the link.',
    revalidatePaths: await playerRevalidatePaths([result.playerId]),
  };
}

// --- player search behind the wizard's picker -----------------------------

export type DraftPlayerSearchResult = {
  id: number;
  slug: string;
  title: string;
  subtitle: string | null;
  dob: string | null;
};

/**
 * Search-first (§4): ranking only, never identity. Guarded at
 * `data.draft.edit` rather than `.read` -- it is reachable only from the new
 * -selection wizard, which only a Super Admin may reach, and gating it
 * separately at `.read` would let a plain Admin probe player search results
 * for a feature they cannot otherwise act on (the ISSUE-159 LinkagePanel
 * precedent).
 */
export async function searchPlayersForDraftAction(query: string): Promise<DraftPlayerSearchResult[]> {
  await requireCapability('data.draft.edit');
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const results = await searchPlayers(trimmed, 10);
  const ids = results.map((r) => r.id);
  const dobRows = ids.length > 0
    ? await sql<{ id: number; dob: string | null }[]>`
        SELECT id, to_char(dob, 'YYYY-MM-DD') AS dob FROM players WHERE id = ANY(${ids})
      `
    : [];
  const dobById = new Map(dobRows.map((row) => [row.id, row.dob]));
  return results.map((r) => ({ id: r.id, slug: r.slug, title: r.title, subtitle: r.subtitle, dob: dobById.get(r.id) ?? null }));
}
