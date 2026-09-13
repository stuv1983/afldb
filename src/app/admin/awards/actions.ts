'use server';

import {
  correctAwardWinner as correctAwardWinnerQuery,
  correctHallOfFameInductee as correctHallOfFameQuery,
  correctHonourTeamMember as correctHonourTeamQuery,
  createAwardWinner as createAwardWinnerQuery,
  createHallOfFameInductee as createHallOfFameQuery,
  createHonourTeamMember as createHonourTeamQuery,
  reinstateAwardWinner as reinstateAwardWinnerQuery,
  reinstateHallOfFameInductee as reinstateHallOfFameQuery,
  reinstateHonourTeamMember as reinstateHonourTeamQuery,
  replaceAwardWinner as replaceAwardWinnerQuery,
  replaceHallOfFameInductee as replaceHallOfFameQuery,
  replaceHonourTeamMember as replaceHonourTeamQuery,
  voidAwardWinner as voidAwardWinnerQuery,
  voidHallOfFameInductee as voidHallOfFameQuery,
  voidHonourTeamMember as voidHonourTeamQuery,
  type AwardWinnerCorrection,
  type CreateAwardWinnerInput,
  type CreateHallOfFameInput,
  type CreateHonourTeamMemberInput,
  type HallOfFameCorrection,
  type HonourMutationResult,
  type HonourRefusal,
  type HonourRefusalReason,
  type HonourTeamCorrection,
} from '@/db/queries/admin-awards';
import { audit, requireCapability } from '@/lib/auth/session';

import type { AwardsActionState } from './submit-helper';
import {
  optionalText, parseChangedFields, parseCheckbox, parseNullableDecimal, parseNullableInt,
  parsePositiveInt, requiredText,
} from './validation';

/**
 * The awards & honours administration Server Actions (AFLDB-ISSUE-165 §5.4,
 * §6.5), matching the coach / draft / fixture shape exactly: assert the
 * capability FIRST, parse the form, hand the decision to one
 * `src/db/queries/admin-awards.ts` transaction (the one mutation contract),
 * audit a refusal worth auditing, and return the public paths that changed
 * for the client to revalidate AFTER this action has already returned.
 * Nothing here calls `revalidatePath` — `submit-helper.ts` posts to
 * `/admin/awards/revalidate` instead (§5.6).
 *
 * `requireCapability('data.awards.edit')` is Super Admin only (§7) on EVERY
 * function in this module, including the three creators this domain takes
 * over from `/admin/data-editor`. An Admin holds `data.awards.read` and can
 * browse every list and every detail page; the UI hides the controls, but the
 * guard here is the actual boundary — a hidden button is furniture, and a
 * direct POST reaches this line either way.
 *
 * WHAT THE FORMS POST, AND WHY IT IS A DELTA. A correction to a SOURCE-OWNED
 * row is recorded as a `data_overrides` delta: an absent key leaves the source
 * value, an explicit null clears it (§6.2). So a correction panel posts a
 * `changed` list naming exactly the fields the administrator edited, and only
 * those reach the `fields` object. The alternative — sending every field every
 * time — would freeze the whole row against every future source improvement
 * after one unrelated typo fix.
 */

function refusalState(result: HonourRefusal): AwardsActionState {
  // The one refusal a caller can answer rather than obey: some awards
  // legitimately record the same player twice in one season (R-5).
  if (result.reason === 'duplicate') {
    return { error: result.error, needsConfirmation: true, confirm: result.error };
  }
  return { error: result.error };
}

/** A refusal worth a permanent record: a conflict, a race, or a rejected boundary. */
function shouldAuditRefusal(reason: HonourRefusalReason): boolean {
  return reason === 'duplicate' || reason === 'conflict' || reason === 'stale'
    || reason === 'forbidden' || reason === 'ambiguous_identity' || reason === 'no_durable_key';
}

async function auditRefusal(
  action: string, detail: Record<string, unknown>, actorId: number, label: string,
): Promise<void> {
  try {
    await audit('admin.awards_refused', { action, ...detail }, { userId: actorId, label });
  } catch (error) {
    console.error('Failed to log administrative audit for awards admin refusal', error);
  }
}

/**
 * The best-effort activity entry, and the sentence an operator gets if it
 * fails.
 *
 * The REQUIRED audit — the `data_edits` row — is written inside the mutation's
 * own transaction and rolls back with it (the ISSUE-027 contract), so a
 * committed-but-unaudited change is not possible for that one. This is the
 * separate `auth_audit_log` activity trail, on its own connection. Its failure
 * must not fail the action (the canonical write has already committed) and
 * must not be silent either, because the one thing an operator must not do in
 * response is submit again.
 */
const ACTIVITY_AUDIT_WARNING =
  'The change was made, but its administrative activity audit could not be written. '
  + 'Do not submit it again; ask an administrator to reconcile the audit log.';

async function auditSuccess(
  action: string, detail: Record<string, unknown>, actorId: number, label: string,
): Promise<string | undefined> {
  try {
    await audit(action, detail, { userId: actorId, label });
    return undefined;
  } catch (error) {
    console.error('Failed to log administrative audit for awards admin mutation', error);
    return ACTIVITY_AUDIT_WARNING;
  }
}

/**
 * The shared tail of every action: audit, then hand the client the message
 * and the server-computed paths.
 *
 * The `data_edits` row is already written INSIDE the mutation transaction
 * (the ISSUE-027 contract), so the `auth_audit_log` write here is the
 * best-effort activity trail and never the required audit. A failure to write
 * it is logged and does not fail the action, because the canonical write has
 * already committed and re-submitting would make a second change.
 */
async function settle(
  result: HonourMutationResult,
  context: {
    action: string; auditAction: string; message: string;
    detail: Record<string, unknown>; actorId: number; label: string;
  },
): Promise<AwardsActionState> {
  if (!result.ok) {
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal(context.action, { ...context.detail, reason: result.error }, context.actorId, context.label);
    }
    return refusalState(result);
  }
  const warning = await auditSuccess(
    context.auditAction,
    { ...context.detail, rowId: result.rowId, entityKey: result.entityKey },
    context.actorId, context.label,
  );
  return {
    ok: true,
    message: context.message,
    revalidatePaths: result.revalidatePaths,
    createdId: result.rowId,
    warning,
  };
}

/** `rowId` + `expectedUpdatedAt`: every mutation's compare-and-swap pair. */
function editBase(formData: FormData): { rowId: number; expectedUpdatedAt: string } | null {
  const rowId = parsePositiveInt(formData.get('rowId'));
  const expectedUpdatedAt = (formData.get('expectedUpdatedAt') ?? '').toString();
  if (rowId === null || !expectedUpdatedAt) return null;
  return { rowId, expectedUpdatedAt };
}

// =========================================================================
// award_winners
// =========================================================================

const AWARD_WINNER_CORRECTABLE = [
  'votes', 'position', 'isCaptain', 'isViceCaptain', 'note', 'sortOrder', 'clubId',
] as const;

export async function correctAwardWinnerAction(
  _previous: AwardsActionState,
  formData: FormData,
): Promise<AwardsActionState> {
  const admin = await requireCapability('data.awards.edit');

  const base = editBase(formData);
  if (base === null) return { error: 'Bad request.' };
  const changed = parseChangedFields(formData.get('changed'), AWARD_WINNER_CORRECTABLE);
  if (changed.length === 0) return { error: 'Nothing was changed.' };

  const fields: AwardWinnerCorrection = {};
  if (changed.includes('votes')) {
    const votes = parseNullableDecimal(formData.get('votes'));
    if (!votes.ok) return { error: 'Award votes or statistic must be from 0 to 999999.99.' };
    fields.votes = votes.value;
  }
  if (changed.includes('position')) fields.position = optionalText(formData.get('position'), 100);
  if (changed.includes('isCaptain')) fields.isCaptain = parseCheckbox(formData.get('isCaptain'));
  if (changed.includes('isViceCaptain')) fields.isViceCaptain = parseCheckbox(formData.get('isViceCaptain'));
  if (changed.includes('note')) fields.note = optionalText(formData.get('note'), 1000);
  if (changed.includes('sortOrder')) {
    const sortOrder = parseNullableInt(formData.get('sortOrder'));
    if (!sortOrder.ok) return { error: 'Display order must be a whole number from 1 to 100.' };
    fields.sortOrder = sortOrder.value;
  }
  if (changed.includes('clubId')) {
    const clubId = parseNullableInt(formData.get('clubId'));
    if (!clubId.ok) return { error: 'Select a club, or clear the club entirely.' };
    fields.clubId = clubId.value;
  }

  const result = await correctAwardWinnerQuery({
    ...base, adminUserId: admin.id, note: optionalText(formData.get('adminNote'), 2000), fields,
  });
  return settle(result, {
    action: 'correct_award_winner',
    auditAction: 'awards.winner_corrected',
    message: 'Award winner corrected.',
    detail: { rowId: base.rowId, fields: changed },
    actorId: admin.id, label: admin.email,
  });
}

export async function voidAwardWinnerAction(
  _previous: AwardsActionState,
  formData: FormData,
): Promise<AwardsActionState> {
  const admin = await requireCapability('data.awards.edit');

  const base = editBase(formData);
  if (base === null) return { error: 'Bad request.' };
  const reason = requiredText(formData.get('reason'), 500);
  if (!reason) return { error: 'Give a reason for voiding this award winner.' };

  const result = await voidAwardWinnerQuery({
    ...base, reason, adminUserId: admin.id, note: optionalText(formData.get('adminNote'), 2000),
  });
  return settle(result, {
    action: 'void_award_winner',
    auditAction: 'awards.winner_voided',
    message: 'Award winner voided. It no longer appears anywhere on the public site.',
    detail: { rowId: base.rowId },
    actorId: admin.id, label: admin.email,
  });
}

export async function reinstateAwardWinnerAction(
  _previous: AwardsActionState,
  formData: FormData,
): Promise<AwardsActionState> {
  const admin = await requireCapability('data.awards.edit');

  const base = editBase(formData);
  if (base === null) return { error: 'Bad request.' };

  const result = await reinstateAwardWinnerQuery({
    ...base, adminUserId: admin.id, note: optionalText(formData.get('adminNote'), 2000),
  });
  return settle(result, {
    action: 'reinstate_award_winner',
    auditAction: 'awards.winner_reinstated',
    message: 'Award winner reinstated. It is public again.',
    detail: { rowId: base.rowId },
    actorId: admin.id, label: admin.email,
  });
}

/** The create form's own fields, shared by the create action and the replace action. */
function awardWinnerFacts(formData: FormData, prefix = ''): {
  ok: true; value: Omit<CreateAwardWinnerInput, 'adminUserId'>;
} | { ok: false; error: string } {
  const at = (name: string) => formData.get(`${prefix}${name}`);

  const awardId = parsePositiveInt(at('awardId'));
  if (awardId === null) return { ok: false, error: 'Select an award.' };

  const season = Number(at('season'));
  if (!Number.isInteger(season) || season < 1897 || season > 2100) {
    return { ok: false, error: 'Award season must be from 1897 to 2100.' };
  }

  const playerId = parsePositiveInt(at('playerId'));
  const playerNameRaw = optionalText(at('playerNameRaw'), 200);
  if (playerId === null && !playerNameRaw) {
    return { ok: false, error: 'Select a player, or enter the recipient name as the source records it.' };
  }

  const votes = parseNullableDecimal(at('votes'));
  if (!votes.ok) return { ok: false, error: 'Award votes or statistic must be from 0 to 999999.99.' };

  const sortOrder = parseNullableInt(at('sortOrder'));
  if (!sortOrder.ok) return { ok: false, error: 'Display order must be a whole number from 1 to 100.' };

  return {
    ok: true,
    value: {
      awardId,
      season,
      playerId,
      playerNameRaw,
      clubId: parsePositiveInt(at('clubId')),
      votes: votes.value,
      position: optionalText(at('position'), 100),
      isCaptain: parseCheckbox(at('isCaptain')),
      isViceCaptain: parseCheckbox(at('isViceCaptain')),
      note: optionalText(at('note'), 1000),
      sortOrder: sortOrder.value,
      confirmDuplicate: parseCheckbox(formData.get('confirmDuplicate')),
    },
  };
}

export async function createAwardWinnerAction(
  _previous: AwardsActionState,
  formData: FormData,
): Promise<AwardsActionState> {
  const admin = await requireCapability('data.awards.edit');

  const facts = awardWinnerFacts(formData);
  if (!facts.ok) return { error: facts.error };

  const result = await createAwardWinnerQuery({ ...facts.value, adminUserId: admin.id });
  return settle(result, {
    action: 'create_award_winner',
    auditAction: 'awards.winner_created',
    message: `Award winner recorded for ${facts.value.season}.`,
    detail: { awardId: facts.value.awardId, season: facts.value.season, playerId: facts.value.playerId },
    actorId: admin.id, label: admin.email,
  });
}

export async function replaceAwardWinnerAction(
  _previous: AwardsActionState,
  formData: FormData,
): Promise<AwardsActionState> {
  const admin = await requireCapability('data.awards.edit');

  const base = editBase(formData);
  if (base === null) return { error: 'Bad request.' };
  const reason = requiredText(formData.get('reason'), 500);
  if (!reason) return { error: 'Give a reason for replacing this award winner.' };
  // Two steps, never one (§6.5): the panel previews "void OLD → create NEW"
  // and only the confirmation carries this flag.
  if (formData.get('confirmReplace') !== '1') {
    return { error: 'Confirm the replacement before submitting.' };
  }

  const facts = awardWinnerFacts(formData, 'new:');
  if (!facts.ok) return { error: facts.error };

  const result = await replaceAwardWinnerQuery({
    ...base, reason, adminUserId: admin.id,
    note: optionalText(formData.get('adminNote'), 2000),
    replacement: facts.value,
  });
  return settle(result, {
    action: 'replace_award_winner',
    auditAction: 'awards.winner_replaced',
    message: 'The wrong record was voided and the correct one recorded, as one change.',
    detail: { rowId: base.rowId, season: facts.value.season },
    actorId: admin.id, label: admin.email,
  });
}

// =========================================================================
// hall_of_fame
// =========================================================================

const HALL_OF_FAME_CORRECTABLE = [
  'category', 'isLegend', 'legendYear', 'clubNameRaw', 'state', 'playingCareer',
  'removedYear', 'notes',
] as const;

export async function correctHallOfFameAction(
  _previous: AwardsActionState,
  formData: FormData,
): Promise<AwardsActionState> {
  const admin = await requireCapability('data.awards.edit');

  const base = editBase(formData);
  if (base === null) return { error: 'Bad request.' };
  const changed = parseChangedFields(formData.get('changed'), HALL_OF_FAME_CORRECTABLE);
  if (changed.length === 0) return { error: 'Nothing was changed.' };

  const fields: HallOfFameCorrection = {};
  if (changed.includes('category')) fields.category = optionalText(formData.get('category'), 60);
  if (changed.includes('isLegend')) fields.isLegend = parseCheckbox(formData.get('isLegend'));
  if (changed.includes('legendYear')) {
    const legendYear = parseNullableInt(formData.get('legendYear'));
    if (!legendYear.ok) return { error: 'Legend year must be a four-digit year, or blank.' };
    fields.legendYear = legendYear.value;
  }
  if (changed.includes('clubNameRaw')) fields.clubNameRaw = optionalText(formData.get('clubNameRaw'), 200);
  if (changed.includes('state')) fields.state = optionalText(formData.get('state'), 60);
  if (changed.includes('playingCareer')) fields.playingCareer = optionalText(formData.get('playingCareer'), 200);
  if (changed.includes('removedYear')) {
    // A HISTORICAL FACT, not lifecycle (§6.6): an inductee formally removed
    // from the Hall of Fame still belongs on the public site, with the removal
    // shown. Voiding is a separate control and says something else entirely.
    const removedYear = parseNullableInt(formData.get('removedYear'));
    if (!removedYear.ok) return { error: 'Removal year must be a four-digit year, or blank.' };
    fields.removedYear = removedYear.value;
  }
  if (changed.includes('notes')) fields.notes = optionalText(formData.get('notes'), 2000);

  const result = await correctHallOfFameQuery({
    ...base, adminUserId: admin.id, note: optionalText(formData.get('adminNote'), 2000), fields,
  });
  return settle(result, {
    action: 'correct_hall_of_fame',
    auditAction: 'awards.hall_of_fame_corrected',
    message: 'Hall of Fame entry corrected.',
    detail: { rowId: base.rowId, fields: changed },
    actorId: admin.id, label: admin.email,
  });
}

export async function voidHallOfFameAction(
  _previous: AwardsActionState,
  formData: FormData,
): Promise<AwardsActionState> {
  const admin = await requireCapability('data.awards.edit');

  const base = editBase(formData);
  if (base === null) return { error: 'Bad request.' };
  const reason = requiredText(formData.get('reason'), 500);
  if (!reason) return { error: 'Give a reason for voiding this Hall of Fame entry.' };

  const result = await voidHallOfFameQuery({
    ...base, reason, adminUserId: admin.id, note: optionalText(formData.get('adminNote'), 2000),
  });
  return settle(result, {
    action: 'void_hall_of_fame',
    auditAction: 'awards.hall_of_fame_voided',
    message: 'Hall of Fame entry voided. It no longer appears anywhere on the public site.',
    detail: { rowId: base.rowId },
    actorId: admin.id, label: admin.email,
  });
}

export async function reinstateHallOfFameAction(
  _previous: AwardsActionState,
  formData: FormData,
): Promise<AwardsActionState> {
  const admin = await requireCapability('data.awards.edit');

  const base = editBase(formData);
  if (base === null) return { error: 'Bad request.' };

  const result = await reinstateHallOfFameQuery({
    ...base, adminUserId: admin.id, note: optionalText(formData.get('adminNote'), 2000),
  });
  return settle(result, {
    action: 'reinstate_hall_of_fame',
    auditAction: 'awards.hall_of_fame_reinstated',
    message: 'Hall of Fame entry reinstated. It is public again.',
    detail: { rowId: base.rowId },
    actorId: admin.id, label: admin.email,
  });
}

function hallOfFameFacts(formData: FormData, prefix = ''): {
  ok: true; value: Omit<CreateHallOfFameInput, 'adminUserId'>;
} | { ok: false; error: string } {
  const at = (name: string) => formData.get(`${prefix}${name}`);

  // The supplied name is CANONICAL and is never derived from a linked
  // player's display name: `hall_of_fame` is keyed on (name, inducted_year),
  // so deriving it would file the induction under a different key from the
  // one the administrator asked for (§17.8, failure 4).
  const name = requiredText(at('name'), 200);
  if (!name) return { ok: false, error: 'Enter the inductee name, exactly as it should be recorded.' };

  const inductedYear = Number(at('inductedYear'));
  if (!Number.isInteger(inductedYear) || inductedYear < 1996 || inductedYear > 2100) {
    return { ok: false, error: 'Inducted year must be from 1996 to 2100.' };
  }

  const isLegend = parseCheckbox(at('isLegend'));
  const legendYear = parseNullableInt(at('legendYear'));
  if (!legendYear.ok) return { ok: false, error: 'Legend year must be a four-digit year, or blank.' };
  if (isLegend && (legendYear.value === null || legendYear.value < inductedYear || legendYear.value > 2100)) {
    return { ok: false, error: 'Legend year must be from the induction year to 2100.' };
  }

  const removedYear = parseNullableInt(at('removedYear'));
  if (!removedYear.ok) return { ok: false, error: 'Removal year must be a four-digit year, or blank.' };

  return {
    ok: true,
    value: {
      name,
      playerId: parsePositiveInt(at('playerId')),
      category: optionalText(at('category'), 60) ?? 'Player',
      inductedYear,
      isLegend,
      legendYear: isLegend ? legendYear.value : null,
      clubNameRaw: optionalText(at('clubNameRaw'), 200),
      state: optionalText(at('state'), 60),
      playingCareer: optionalText(at('playingCareer'), 200),
      notes: optionalText(at('notes'), 2000),
      removedYear: removedYear.value,
    },
  };
}

export async function createHallOfFameAction(
  _previous: AwardsActionState,
  formData: FormData,
): Promise<AwardsActionState> {
  const admin = await requireCapability('data.awards.edit');

  const facts = hallOfFameFacts(formData);
  if (!facts.ok) return { error: facts.error };

  const result = await createHallOfFameQuery({ ...facts.value, adminUserId: admin.id });
  return settle(result, {
    action: 'create_hall_of_fame',
    auditAction: 'awards.hall_of_fame_created',
    message: `Hall of Fame entry recorded for ${facts.value.name} (${facts.value.inductedYear}).`,
    detail: { name: facts.value.name, inductedYear: facts.value.inductedYear },
    actorId: admin.id, label: admin.email,
  });
}

export async function replaceHallOfFameAction(
  _previous: AwardsActionState,
  formData: FormData,
): Promise<AwardsActionState> {
  const admin = await requireCapability('data.awards.edit');

  const base = editBase(formData);
  if (base === null) return { error: 'Bad request.' };
  const reason = requiredText(formData.get('reason'), 500);
  if (!reason) return { error: 'Give a reason for replacing this Hall of Fame entry.' };
  if (formData.get('confirmReplace') !== '1') {
    return { error: 'Confirm the replacement before submitting.' };
  }

  const facts = hallOfFameFacts(formData, 'new:');
  if (!facts.ok) return { error: facts.error };

  const result = await replaceHallOfFameQuery({
    ...base, reason, adminUserId: admin.id,
    note: optionalText(formData.get('adminNote'), 2000),
    replacement: facts.value,
  });
  return settle(result, {
    action: 'replace_hall_of_fame',
    auditAction: 'awards.hall_of_fame_replaced',
    message: 'The wrong entry was voided and the correct one recorded, as one change.',
    detail: { rowId: base.rowId, name: facts.value.name },
    actorId: admin.id, label: admin.email,
  });
}

// =========================================================================
// honour_team_members
// =========================================================================

const HONOUR_TEAM_CORRECTABLE = [
  'position', 'role', 'clubNameRaw', 'sortOrder', 'note',
] as const;

export async function correctHonourTeamAction(
  _previous: AwardsActionState,
  formData: FormData,
): Promise<AwardsActionState> {
  const admin = await requireCapability('data.awards.edit');

  const base = editBase(formData);
  if (base === null) return { error: 'Bad request.' };
  const changed = parseChangedFields(formData.get('changed'), HONOUR_TEAM_CORRECTABLE);
  if (changed.length === 0) return { error: 'Nothing was changed.' };

  const fields: HonourTeamCorrection = {};
  if (changed.includes('position')) fields.position = optionalText(formData.get('position'), 100);
  if (changed.includes('role')) fields.role = optionalText(formData.get('role'), 100);
  if (changed.includes('clubNameRaw')) fields.clubNameRaw = optionalText(formData.get('clubNameRaw'), 200);
  if (changed.includes('sortOrder')) {
    const sortOrder = parseNullableInt(formData.get('sortOrder'));
    if (!sortOrder.ok || sortOrder.value === null) {
      return { error: 'Lineup order must be a whole number from 0 to 50.' };
    }
    fields.sortOrder = sortOrder.value;
  }
  if (changed.includes('note')) fields.note = optionalText(formData.get('note'), 1000);

  const result = await correctHonourTeamQuery({
    ...base, adminUserId: admin.id, note: optionalText(formData.get('adminNote'), 2000), fields,
  });
  return settle(result, {
    action: 'correct_honour_team',
    auditAction: 'awards.honour_team_corrected',
    message: 'Honour-team selection corrected.',
    detail: { rowId: base.rowId, fields: changed },
    actorId: admin.id, label: admin.email,
  });
}

export async function voidHonourTeamAction(
  _previous: AwardsActionState,
  formData: FormData,
): Promise<AwardsActionState> {
  const admin = await requireCapability('data.awards.edit');

  const base = editBase(formData);
  if (base === null) return { error: 'Bad request.' };
  const reason = requiredText(formData.get('reason'), 500);
  if (!reason) return { error: 'Give a reason for voiding this selection.' };

  const result = await voidHonourTeamQuery({
    ...base, reason, adminUserId: admin.id, note: optionalText(formData.get('adminNote'), 2000),
  });
  return settle(result, {
    action: 'void_honour_team',
    auditAction: 'awards.honour_team_voided',
    message: 'Selection voided. It no longer appears anywhere on the public site.',
    detail: { rowId: base.rowId },
    actorId: admin.id, label: admin.email,
  });
}

export async function reinstateHonourTeamAction(
  _previous: AwardsActionState,
  formData: FormData,
): Promise<AwardsActionState> {
  const admin = await requireCapability('data.awards.edit');

  const base = editBase(formData);
  if (base === null) return { error: 'Bad request.' };

  const result = await reinstateHonourTeamQuery({
    ...base, adminUserId: admin.id, note: optionalText(formData.get('adminNote'), 2000),
  });
  return settle(result, {
    action: 'reinstate_honour_team',
    auditAction: 'awards.honour_team_reinstated',
    message: 'Selection reinstated. It is public again.',
    detail: { rowId: base.rowId },
    actorId: admin.id, label: admin.email,
  });
}

function honourTeamFacts(formData: FormData, prefix = ''): {
  ok: true; value: Omit<CreateHonourTeamMemberInput, 'adminUserId'>;
} | { ok: false; error: string } {
  const at = (name: string) => formData.get(`${prefix}${name}`);

  const teamName = requiredText(at('teamName'), 200);
  if (!teamName) return { ok: false, error: 'Enter or choose the team name.' };

  const playerId = parsePositiveInt(at('playerId'));
  const playerNameRaw = optionalText(at('playerNameRaw'), 200);
  if (playerId === null && !playerNameRaw) {
    return { ok: false, error: 'Select a player, or enter the name as the source records it.' };
  }

  const sortOrder = parseNullableInt(at('sortOrder'));
  if (!sortOrder.ok || sortOrder.value === null || sortOrder.value < 0 || sortOrder.value > 50) {
    return { ok: false, error: 'Lineup order must be a whole number from 0 to 50.' };
  }

  return {
    ok: true,
    value: {
      teamName,
      playerId,
      playerNameRaw,
      position: optionalText(at('position'), 100),
      role: optionalText(at('role'), 100),
      clubNameRaw: optionalText(at('clubNameRaw'), 200),
      sortOrder: sortOrder.value,
      note: optionalText(at('note'), 1000),
    },
  };
}

export async function createHonourTeamMemberAction(
  _previous: AwardsActionState,
  formData: FormData,
): Promise<AwardsActionState> {
  const admin = await requireCapability('data.awards.edit');

  const facts = honourTeamFacts(formData);
  if (!facts.ok) return { error: facts.error };

  const result = await createHonourTeamQuery({ ...facts.value, adminUserId: admin.id });
  return settle(result, {
    action: 'create_honour_team',
    auditAction: 'awards.honour_team_created',
    message: `Selection recorded for ${facts.value.teamName}.`,
    detail: { teamName: facts.value.teamName, playerId: facts.value.playerId },
    actorId: admin.id, label: admin.email,
  });
}

export async function replaceHonourTeamAction(
  _previous: AwardsActionState,
  formData: FormData,
): Promise<AwardsActionState> {
  const admin = await requireCapability('data.awards.edit');

  const base = editBase(formData);
  if (base === null) return { error: 'Bad request.' };
  const reason = requiredText(formData.get('reason'), 500);
  if (!reason) return { error: 'Give a reason for replacing this selection.' };
  if (formData.get('confirmReplace') !== '1') {
    return { error: 'Confirm the replacement before submitting.' };
  }

  const facts = honourTeamFacts(formData, 'new:');
  if (!facts.ok) return { error: facts.error };

  const result = await replaceHonourTeamQuery({
    ...base, reason, adminUserId: admin.id,
    note: optionalText(formData.get('adminNote'), 2000),
    replacement: facts.value,
  });
  return settle(result, {
    action: 'replace_honour_team',
    auditAction: 'awards.honour_team_replaced',
    message: 'The wrong selection was voided and the correct one recorded, as one change.',
    detail: { rowId: base.rowId, teamName: facts.value.teamName },
    actorId: admin.id, label: admin.email,
  });
}
