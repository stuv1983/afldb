'use server';

import {
  cancelFixture as cancelFixtureQuery,
  changeFixtureClubs as changeFixtureClubsQuery,
  changeFixtureRound as changeFixtureRoundQuery,
  changeFixtureVenue as changeFixtureVenueQuery,
  createFixture as createFixtureQuery,
  createFixtures as createFixturesQuery,
  isFixtureRoundType,
  reinstateFixture as reinstateFixtureQuery,
  rescheduleFixture as rescheduleFixtureQuery,
  updateFixtureNotes as updateFixtureNotesQuery,
  voidFixture as voidFixtureQuery,
  type FixtureBatchRowInput,
  type FixtureRefusalReason,
  type FixtureRoundType,
} from '@/db/queries/admin-fixtures';
import { audit, requireCapability } from '@/lib/auth/session';

import type { FixtureActionState, RoundBatchActionState } from './submit-helper';
import { optionalText, parseInteger, parsePositiveInt, requiredText } from './validation';

/**
 * The fixture administration Server Actions (AFLDB-ISSUE-162 §29 Stage 2),
 * matching the season-list / draft / coach shape: assert the capability
 * first, parse the form, hand the decision to exactly one
 * `src/db/queries/admin-fixtures.ts` transaction (the ONE fixture mutation
 * contract), audit a refusal worth one, and return `revalidatePaths: []`
 * always -- no public consumer of a fixture exists yet (§22, D-7), so
 * nothing here ever calls `revalidatePath`.
 *
 * `requireCapability('data.fixtures.edit')` is Super Admin only (§23): every
 * mutation here is a public-fact-in-waiting decision with no draft stage,
 * matching `data.seasonLists.edit` / `data.draft.edit` / `data.coaches.edit`.
 */

function shouldAuditRefusal(reason: FixtureRefusalReason): boolean {
  return reason === 'duplicate_fixture' || reason === 'club_already_scheduled'
    || reason === 'already_played' || reason === 'played_locked'
    || reason === 'stale' || reason === 'stale_preview' || reason === 'forbidden';
}

async function auditRefusal(
  action: string, detail: Record<string, unknown>, actorId: number, label: string,
): Promise<void> {
  try {
    await audit('admin.fixture_refused', { action, ...detail }, { userId: actorId, label });
  } catch (error) {
    console.error('Failed to log administrative audit for fixture refusal', error);
  }
}

function parseRoundType(value: FormDataEntryValue | null): FixtureRoundType | null {
  const raw = (value ?? '').toString();
  return isFixtureRoundType(raw) ? raw : null;
}

// --- create (§13) -----------------------------------------------------------

export async function createFixtureAction(
  _previous: FixtureActionState,
  formData: FormData,
): Promise<FixtureActionState> {
  const admin = await requireCapability('data.fixtures.edit');

  const season = parsePositiveInt(formData.get('season'));
  const roundType = parseRoundType(formData.get('roundType'));
  const roundNumber = parseInteger(formData.get('roundNumber'));
  const homeClubId = parsePositiveInt(formData.get('homeClubId'));
  const awayClubId = parsePositiveInt(formData.get('awayClubId'));
  if (season === null || !roundType || homeClubId === null || awayClubId === null) {
    return { error: 'Choose a round and two clubs.' };
  }
  const venueIdRaw = formData.get('venueId');
  const venueId = venueIdRaw ? parsePositiveInt(venueIdRaw) : null;

  const result = await createFixtureQuery({
    season,
    roundType,
    roundNumber,
    homeClubId,
    awayClubId,
    matchDate: optionalText(formData.get('matchDate'), 10),
    matchTime: optionalText(formData.get('matchTime'), 5),
    venueId,
    venueRaw: venueId ? null : optionalText(formData.get('venueRaw'), 200),
    notes: optionalText(formData.get('notes'), 2000),
    adminUserId: admin.id,
  });

  if (!result.ok) {
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal('create_fixture', { season, homeClubId, awayClubId, reason: result.error }, admin.id, admin.email);
    }
    return { error: result.error };
  }

  try {
    await audit(
      'fixtures.created',
      { season, fixtureKey: result.fixtureKey, homeClubId, awayClubId },
      { userId: admin.id, label: admin.email },
    );
  } catch (error) {
    console.error('Failed to log administrative audit for fixture creation', error);
  }

  return { ok: true, message: 'Fixture created.', revalidatePaths: [] };
}

// --- round batch (§14, D-4) --------------------------------------------------

/**
 * One batch row, as the client's `RoundBatchForm` serialises it. Parsed
 * narrowly here -- shape only, never business validation, which stays inside
 * `createFixtures()`.
 */
function parseBatchRows(raw: FormDataEntryValue | null): FixtureBatchRowInput[] | null {
  if (typeof raw !== 'string' || raw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const rows: FixtureBatchRowInput[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) return null;
    const row = entry as Record<string, unknown>;
    if (typeof row.homeClubId !== 'number' || typeof row.awayClubId !== 'number') return null;
    const homeClubId = row.homeClubId;
    const awayClubId = row.awayClubId;
    if (!Number.isInteger(homeClubId) || !Number.isInteger(awayClubId) || homeClubId <= 0 || awayClubId <= 0) return null;
    const venueId = row.venueId === null || row.venueId === undefined || row.venueId === ''
      ? null : Number(row.venueId);
    rows.push({
      homeClubId,
      awayClubId,
      matchDate: typeof row.matchDate === 'string' && row.matchDate ? row.matchDate : null,
      matchTime: typeof row.matchTime === 'string' && row.matchTime ? row.matchTime : null,
      venueId: venueId !== null && Number.isInteger(venueId) ? venueId : null,
      venueRaw: venueId === null && typeof row.venueRaw === 'string' && row.venueRaw ? row.venueRaw : null,
      notes: typeof row.notes === 'string' && row.notes ? row.notes : null,
    });
  }
  return rows;
}

/**
 * Preview (`dryRun: true`) and confirm (`dryRun: false`) share this one
 * action, exactly as `copySeasonListsForwardAction` does: the same server
 * code path validates every row either way, and only the write half differs
 * (§14). Confirm carries the `previewFingerprint` the preview returned;
 * `createFixtures()` refuses `stale_preview` itself if the rows do not match
 * (the `CopyForwardPanel` lesson, §14).
 */
export async function submitFixtureBatchAction(
  _previous: RoundBatchActionState,
  formData: FormData,
): Promise<RoundBatchActionState> {
  const admin = await requireCapability('data.fixtures.edit');

  const season = parsePositiveInt(formData.get('season'));
  const roundType = parseRoundType(formData.get('roundType'));
  const roundNumber = parseInteger(formData.get('roundNumber'));
  const dryRun = formData.get('dryRun') !== '0';
  const previewFingerprint = optionalText(formData.get('previewFingerprint'), 128);
  const rows = parseBatchRows(formData.get('rowsJson'));
  if (season === null || !roundType || rows === null || rows.length === 0) {
    return { error: 'Enter at least one fixture row.' };
  }

  const result = await createFixturesQuery({
    season, roundType, roundNumber, rows, adminUserId: admin.id, dryRun, previewFingerprint,
  });

  if (!result.ok) {
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal('submit_batch', { season, dryRun, reason: result.error }, admin.id, admin.email);
    }
    return {
      error: result.error,
      rows: result.rows?.map((row) => ({ index: row.index, ok: row.ok, reason: row.reason, error: row.error, fixtureKey: row.fixtureKey })),
    };
  }

  if (!result.dryRun) {
    try {
      await audit(
        'fixtures.batch_created',
        { season, batchId: result.batchId, created: result.created },
        { userId: admin.id, label: admin.email },
      );
    } catch (error) {
      console.error('Failed to log administrative audit for fixture batch create', error);
    }
  }

  return {
    ok: true,
    dryRun: result.dryRun,
    fingerprint: result.fingerprint,
    batchId: result.batchId,
    created: result.created,
    rows: result.rows.map((row) => ({ index: row.index, ok: row.ok, reason: row.reason, error: row.error, fixtureKey: row.fixtureKey })),
    message: result.dryRun
      ? `Preview: ${result.rows.length} fixture${result.rows.length === 1 ? '' : 's'} would be created. Nothing has been written yet.`
      : `Created ${result.created} fixture${result.created === 1 ? '' : 's'}.`,
    revalidatePaths: [],
  };
}

// --- edits (§15) --------------------------------------------------------

export async function rescheduleFixtureAction(
  _previous: FixtureActionState,
  formData: FormData,
): Promise<FixtureActionState> {
  const admin = await requireCapability('data.fixtures.edit');

  const fixtureKey = requiredText(formData.get('fixtureKey'), 60);
  const expectedUpdatedAt = requiredText(formData.get('expectedUpdatedAt'), 60);
  if (!fixtureKey || !expectedUpdatedAt) return { error: 'Bad request.' };

  const result = await rescheduleFixtureQuery({
    fixtureKey,
    expectedUpdatedAt,
    adminUserId: admin.id,
    matchDate: optionalText(formData.get('matchDate'), 10),
    matchTime: optionalText(formData.get('matchTime'), 5),
    note: optionalText(formData.get('note'), 2000),
  });

  if (!result.ok) {
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal('reschedule', { fixtureKey, reason: result.error }, admin.id, admin.email);
    }
    return { error: result.error };
  }

  try {
    await audit('fixtures.rescheduled', { fixtureKey }, { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for fixture reschedule', error);
  }
  return { ok: true, message: 'Rescheduled.', revalidatePaths: [] };
}

export async function changeFixtureVenueAction(
  _previous: FixtureActionState,
  formData: FormData,
): Promise<FixtureActionState> {
  const admin = await requireCapability('data.fixtures.edit');

  const fixtureKey = requiredText(formData.get('fixtureKey'), 60);
  const expectedUpdatedAt = requiredText(formData.get('expectedUpdatedAt'), 60);
  if (!fixtureKey || !expectedUpdatedAt) return { error: 'Bad request.' };
  const venueIdRaw = formData.get('venueId');
  const venueId = venueIdRaw ? parsePositiveInt(venueIdRaw) : null;

  const result = await changeFixtureVenueQuery({
    fixtureKey,
    expectedUpdatedAt,
    adminUserId: admin.id,
    venueId,
    venueRaw: venueId ? null : optionalText(formData.get('venueRaw'), 200),
    note: optionalText(formData.get('note'), 2000),
  });

  if (!result.ok) {
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal('change_venue', { fixtureKey, reason: result.error }, admin.id, admin.email);
    }
    return { error: result.error };
  }

  try {
    await audit('fixtures.venue_changed', { fixtureKey }, { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for fixture venue change', error);
  }
  return { ok: true, message: 'Venue updated.', revalidatePaths: [] };
}

export async function changeFixtureRoundAction(
  _previous: FixtureActionState,
  formData: FormData,
): Promise<FixtureActionState> {
  const admin = await requireCapability('data.fixtures.edit');

  const fixtureKey = requiredText(formData.get('fixtureKey'), 60);
  const expectedUpdatedAt = requiredText(formData.get('expectedUpdatedAt'), 60);
  const roundType = parseRoundType(formData.get('roundType'));
  if (!fixtureKey || !expectedUpdatedAt || !roundType) return { error: 'Choose a round.' };

  const result = await changeFixtureRoundQuery({
    fixtureKey,
    expectedUpdatedAt,
    adminUserId: admin.id,
    roundType,
    roundNumber: parseInteger(formData.get('roundNumber')),
    note: optionalText(formData.get('note'), 2000),
  });

  if (!result.ok) {
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal('change_round', { fixtureKey, reason: result.error }, admin.id, admin.email);
    }
    return { error: result.error };
  }

  try {
    await audit('fixtures.round_changed', { fixtureKey }, { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for fixture round change', error);
  }
  return { ok: true, message: 'Round updated. Duplicate and collision checks were re-run for the new round.', revalidatePaths: [] };
}

export async function changeFixtureClubsAction(
  _previous: FixtureActionState,
  formData: FormData,
): Promise<FixtureActionState> {
  const admin = await requireCapability('data.fixtures.edit');

  const fixtureKey = requiredText(formData.get('fixtureKey'), 60);
  const expectedUpdatedAt = requiredText(formData.get('expectedUpdatedAt'), 60);
  const homeClubId = parsePositiveInt(formData.get('homeClubId'));
  const awayClubId = parsePositiveInt(formData.get('awayClubId'));
  if (!fixtureKey || !expectedUpdatedAt || homeClubId === null || awayClubId === null) {
    return { error: 'Choose two clubs.' };
  }

  const result = await changeFixtureClubsQuery({
    fixtureKey, expectedUpdatedAt, adminUserId: admin.id, homeClubId, awayClubId,
    note: optionalText(formData.get('note'), 2000),
  });

  if (!result.ok) {
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal('change_clubs', { fixtureKey, homeClubId, awayClubId, reason: result.error }, admin.id, admin.email);
    }
    return { error: result.error };
  }

  try {
    await audit('fixtures.clubs_changed', { fixtureKey, homeClubId, awayClubId }, { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for fixture club change', error);
  }
  return { ok: true, message: 'Clubs updated.', revalidatePaths: [] };
}

export async function updateFixtureNotesAction(
  _previous: FixtureActionState,
  formData: FormData,
): Promise<FixtureActionState> {
  const admin = await requireCapability('data.fixtures.edit');

  const fixtureKey = requiredText(formData.get('fixtureKey'), 60);
  const expectedUpdatedAt = requiredText(formData.get('expectedUpdatedAt'), 60);
  if (!fixtureKey || !expectedUpdatedAt) return { error: 'Bad request.' };

  const result = await updateFixtureNotesQuery({
    fixtureKey, expectedUpdatedAt, adminUserId: admin.id,
    notes: optionalText(formData.get('notes'), 2000),
  });

  if (!result.ok) {
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal('update_notes', { fixtureKey, reason: result.error }, admin.id, admin.email);
    }
    return { error: result.error };
  }

  try {
    await audit('fixtures.notes_updated', { fixtureKey }, { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for fixture notes update', error);
  }
  return { ok: true, message: 'Notes saved.', revalidatePaths: [] };
}

// --- lifecycle (§16, D-2) ------------------------------------------------

export async function cancelFixtureAction(
  _previous: FixtureActionState,
  formData: FormData,
): Promise<FixtureActionState> {
  const admin = await requireCapability('data.fixtures.edit');

  const fixtureKey = requiredText(formData.get('fixtureKey'), 60);
  const expectedUpdatedAt = requiredText(formData.get('expectedUpdatedAt'), 60);
  const reason = requiredText(formData.get('reason'), 500);
  if (!fixtureKey || !expectedUpdatedAt) return { error: 'Bad request.' };
  if (!reason) return { error: 'Give a reason for the cancellation.' };
  if (formData.get('confirmCancel') !== '1') return { error: 'Confirm the cancellation before submitting.' };

  const result = await cancelFixtureQuery({ fixtureKey, expectedUpdatedAt, adminUserId: admin.id, reason });

  if (!result.ok) {
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal('cancel', { fixtureKey, reason: result.error }, admin.id, admin.email);
    }
    return { error: result.error };
  }

  try {
    await audit('fixtures.cancelled', { fixtureKey, reason }, { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for fixture cancellation', error);
  }
  return { ok: true, message: 'Cancelled.', revalidatePaths: [] };
}

export async function reinstateFixtureAction(
  _previous: FixtureActionState,
  formData: FormData,
): Promise<FixtureActionState> {
  const admin = await requireCapability('data.fixtures.edit');

  const fixtureKey = requiredText(formData.get('fixtureKey'), 60);
  const expectedUpdatedAt = requiredText(formData.get('expectedUpdatedAt'), 60);
  if (!fixtureKey || !expectedUpdatedAt) return { error: 'Bad request.' };

  const result = await reinstateFixtureQuery({
    fixtureKey, expectedUpdatedAt, adminUserId: admin.id,
    note: optionalText(formData.get('note'), 2000),
  });

  if (!result.ok) {
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal('reinstate', { fixtureKey, reason: result.error }, admin.id, admin.email);
    }
    return { error: result.error };
  }

  try {
    await audit('fixtures.reinstated', { fixtureKey }, { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for fixture reinstatement', error);
  }
  return { ok: true, message: 'Reinstated. Collision checks were re-run.', revalidatePaths: [] };
}

export async function voidFixtureAction(
  _previous: FixtureActionState,
  formData: FormData,
): Promise<FixtureActionState> {
  const admin = await requireCapability('data.fixtures.edit');

  const fixtureKey = requiredText(formData.get('fixtureKey'), 60);
  const expectedUpdatedAt = requiredText(formData.get('expectedUpdatedAt'), 60);
  const reason = requiredText(formData.get('reason'), 500);
  if (!fixtureKey || !expectedUpdatedAt) return { error: 'Bad request.' };
  if (!reason) return { error: 'Give a reason for voiding this fixture.' };
  if (formData.get('confirmVoid') !== '1') return { error: 'Confirm voiding this fixture before submitting.' };

  const result = await voidFixtureQuery({ fixtureKey, expectedUpdatedAt, adminUserId: admin.id, reason });

  if (!result.ok) {
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal('void', { fixtureKey, reason: result.error }, admin.id, admin.email);
    }
    return { error: result.error };
  }

  try {
    await audit('fixtures.voided', { fixtureKey, reason }, { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for fixture void', error);
  }
  return { ok: true, message: 'Voided.', revalidatePaths: [] };
}
