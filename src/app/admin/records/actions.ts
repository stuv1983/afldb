'use server';

import {
  correctAfterSirenKick as correctAfterSirenQuery,
  correctFirstKickGoal as correctFirstKickQuery,
  createAfterSirenKick as createAfterSirenQuery,
  createFirstKickGoal as createFirstKickQuery,
  reinstateAfterSirenKick as reinstateAfterSirenQuery,
  reinstateFirstKickGoal as reinstateFirstKickQuery,
  replaceAfterSirenKick as replaceAfterSirenQuery,
  replaceFirstKickGoal as replaceFirstKickQuery,
  suppressAfterSirenKick as suppressAfterSirenQuery,
  suppressFirstKickGoal as suppressFirstKickQuery,
  type AfterSirenCorrection,
  type CreateAfterSirenKickInput,
  type CreateFirstKickGoalInput,
  type FirstKickGoalCorrection,
  type SpecialRecordMutationResult,
  type SpecialRecordRefusal,
  type SpecialRecordRefusalReason,
} from '@/db/queries/admin-special-records';
import { audit, requireCapability } from '@/lib/auth/session';
import {
  AFTER_SIREN_EFFECTS, AFTER_SIREN_RESULTS, AFTER_SIREN_SCORES, AFTER_SIREN_SIRENS,
} from '@/lib/special-records/after-siren-rules';

import type { SpecialRecordsActionState } from './submit-helper';
import {
  optionalText, parseChangedFields, parseCheckbox, parseEnum, parseNullableInt,
  parsePositiveInt, parseRequiredInt, requiredText,
} from './validation';

/**
 * The special-records administration Server Actions (AFLDB-ISSUE-167 Stage 6),
 * matching the coach / draft / fixture / awards shape exactly: assert the
 * capability FIRST, parse the form, hand the decision to one
 * `src/db/queries/admin-special-records.ts` transaction (the one mutation
 * contract), audit a refusal worth auditing, and return the paths that changed
 * for the client to revalidate AFTER this action has already returned.
 *
 * NOTHING HERE CALLS `revalidatePath`, and nothing here may: it hangs the Next
 * 15.5 client (AFLDB-ISSUE-156 §7 R-7). `submit-helper.ts` posts to
 * `/admin/records/revalidate` instead, as a second request once the action has
 * resolved. `tests/auth.test.ts` fails this module if the import ever appears.
 *
 * `requireCapability('data.specialRecords.edit')` is Super Admin only (D-4) on
 * EVERY function in this module. An Admin holds `data.specialRecords.read` and
 * can browse every list, every detail page and every record's history; the UI
 * shows them no mutation control, but the guard here is the actual boundary --
 * a hidden button is furniture, and a direct POST reaches this line either way.
 * A Contributor holds neither and is denied the whole surface.
 *
 * WHAT THE CORRECTION FORMS POST, AND WHY IT IS A DELTA. A correction to a
 * SOURCE-OWNED row is recorded as a `data_overrides` delta: an absent key
 * leaves the source value, an explicit null clears it. So a correction panel
 * posts a `changed` list naming exactly the fields the administrator edited,
 * and only those reach the `fields` object. Sending every field every time
 * would freeze the whole row against every future source improvement after one
 * unrelated typo fix.
 */

/** A refusal worth a permanent record: a conflict, a race, or a rejected boundary. */
function shouldAuditRefusal(reason: SpecialRecordRefusalReason): boolean {
  return reason === 'conflict' || reason === 'stale' || reason === 'forbidden'
    || reason === 'ambiguous_identity' || reason === 'no_durable_key';
}

async function auditRefusal(
  action: string, detail: Record<string, unknown>, actorId: number, label: string,
): Promise<void> {
  try {
    await audit('admin.special_records_refused', { action, ...detail }, { userId: actorId, label });
  } catch (error) {
    console.error('Failed to log administrative audit for special-records refusal', error);
  }
}

/**
 * The best-effort activity entry, and the sentence an operator gets if it
 * fails.
 *
 * The REQUIRED audit -- the `data_edits` row -- is written inside the
 * mutation's own transaction and rolls back with it (the AFLDB-ISSUE-027
 * contract), so a committed-but-unaudited change is not possible for that one.
 * This is the separate `auth_audit_log` activity trail, on its own connection.
 * Its failure must not fail the action (the canonical write has already
 * committed) and must not be silent either, because the one thing an operator
 * must not do in response is submit again.
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
    console.error('Failed to log administrative audit for special-records mutation', error);
    return ACTIVITY_AUDIT_WARNING;
  }
}

/** The shared tail of every action: audit, then hand the client the message and the paths. */
async function settle(
  result: SpecialRecordMutationResult<{
    table: string; rowId: number; entityKey: string; revalidatePaths: string[];
  }>,
  context: {
    action: string; auditAction: string; message: string;
    detail: Record<string, unknown>; actorId: number; label: string;
  },
): Promise<SpecialRecordsActionState> {
  if (!result.ok) {
    const refusal = result as SpecialRecordRefusal;
    if (shouldAuditRefusal(refusal.reason)) {
      await auditRefusal(
        context.action, { ...context.detail, reason: refusal.error }, context.actorId, context.label,
      );
    }
    return { error: refusal.error };
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
// player_achievements -- the first-kick goal
// =========================================================================

/**
 * Exactly AFLDB-ISSUE-167 §3.4's amendable list for `player_achievements`.
 *
 * The derived and identity-bearing fields are absent here AND refused again
 * inside the mutation transaction, because this list is a convenience for the
 * form and the transaction is the boundary.
 */
export const FIRST_KICK_CORRECTABLE_FIELDS = [
  'playerNameRaw', 'playerNameClean', 'clubNameRaw', 'season', 'roundRaw', 'seasonFootnoteRaw',
  'sourceAnnotation', 'notes', 'consecutiveGoalKicks', 'noFurtherCareerGoals',
  'noFurtherCareerKicks', 'kicklessMatchesBeforeFirstKick',
] as const;

function firstKickCorrection(
  formData: FormData, changed: string[],
): { ok: true; value: FirstKickGoalCorrection } | { ok: false; error: string } {
  const fields: FirstKickGoalCorrection = {};
  if (changed.includes('playerNameRaw')) {
    fields.playerNameRaw = (formData.get('playerNameRaw') ?? '').toString().trim();
  }
  if (changed.includes('playerNameClean')) {
    fields.playerNameClean = (formData.get('playerNameClean') ?? '').toString().trim();
  }
  if (changed.includes('clubNameRaw')) {
    fields.clubNameRaw = (formData.get('clubNameRaw') ?? '').toString().trim();
  }
  if (changed.includes('roundRaw')) {
    fields.roundRaw = (formData.get('roundRaw') ?? '').toString().trim();
  }
  if (changed.includes('season')) {
    const season = parseRequiredInt(formData.get('season'));
    if (!season.ok) return { ok: false, error: 'Season must be a year from 1897 to 2100.' };
    fields.season = season.value;
  }
  if (changed.includes('seasonFootnoteRaw')) {
    fields.seasonFootnoteRaw = optionalText(formData.get('seasonFootnoteRaw'), 200);
  }
  if (changed.includes('sourceAnnotation')) {
    fields.sourceAnnotation = optionalText(formData.get('sourceAnnotation'), 500);
  }
  if (changed.includes('notes')) fields.notes = optionalText(formData.get('notes'), 2000);
  if (changed.includes('noFurtherCareerGoals')) {
    fields.noFurtherCareerGoals = parseCheckbox(formData.get('noFurtherCareerGoals'));
  }
  if (changed.includes('noFurtherCareerKicks')) {
    fields.noFurtherCareerKicks = parseCheckbox(formData.get('noFurtherCareerKicks'));
  }
  if (changed.includes('consecutiveGoalKicks')) {
    const n = parseRequiredInt(formData.get('consecutiveGoalKicks'));
    if (!n.ok) return { ok: false, error: 'Consecutive goal kicks must be a whole number of 1 or more.' };
    fields.consecutiveGoalKicks = n.value;
  }
  if (changed.includes('kicklessMatchesBeforeFirstKick')) {
    const n = parseRequiredInt(formData.get('kicklessMatchesBeforeFirstKick'));
    if (!n.ok) {
      return { ok: false, error: 'Kickless matches before the first kick must be a whole number of 0 or more.' };
    }
    fields.kicklessMatchesBeforeFirstKick = n.value;
  }
  return { ok: true, value: fields };
}

export async function correctFirstKickGoalAction(
  _previous: SpecialRecordsActionState,
  formData: FormData,
): Promise<SpecialRecordsActionState> {
  const admin = await requireCapability('data.specialRecords.edit');

  const base = editBase(formData);
  if (base === null) return { error: 'Bad request.' };
  const changed = parseChangedFields(formData.get('changed'), FIRST_KICK_CORRECTABLE_FIELDS);
  if (changed.length === 0) return { error: 'Nothing was changed.' };

  const fields = firstKickCorrection(formData, changed);
  if (!fields.ok) return { error: fields.error };

  const result = await correctFirstKickQuery({
    ...base,
    adminUserId: admin.id,
    note: optionalText(formData.get('adminNote'), 2000),
    fields: fields.value,
  });
  return settle(result, {
    action: 'correct_first_kick_goal',
    auditAction: 'special_records.first_kick_corrected',
    message: 'First-kick-goal record corrected.',
    detail: { rowId: base.rowId, fields: changed },
    actorId: admin.id, label: admin.email,
  });
}

export async function suppressFirstKickGoalAction(
  _previous: SpecialRecordsActionState,
  formData: FormData,
): Promise<SpecialRecordsActionState> {
  const admin = await requireCapability('data.specialRecords.edit');

  const base = editBase(formData);
  if (base === null) return { error: 'Bad request.' };
  const reason = requiredText(formData.get('reason'), 500);
  if (!reason) return { error: 'Give a reason for suppressing this first-kick-goal record.' };

  const result = await suppressFirstKickQuery({
    ...base, reason, adminUserId: admin.id, note: optionalText(formData.get('adminNote'), 2000),
  });
  return settle(result, {
    action: 'suppress_first_kick_goal',
    auditAction: 'special_records.first_kick_suppressed',
    message: 'Record suppressed. It no longer appears anywhere on the public site.',
    detail: { rowId: base.rowId },
    actorId: admin.id, label: admin.email,
  });
}

export async function reinstateFirstKickGoalAction(
  _previous: SpecialRecordsActionState,
  formData: FormData,
): Promise<SpecialRecordsActionState> {
  const admin = await requireCapability('data.specialRecords.edit');

  const base = editBase(formData);
  if (base === null) return { error: 'Bad request.' };

  const result = await reinstateFirstKickQuery({
    ...base, adminUserId: admin.id, note: optionalText(formData.get('adminNote'), 2000),
  });
  return settle(result, {
    action: 'reinstate_first_kick_goal',
    auditAction: 'special_records.first_kick_reinstated',
    message: 'Record reinstated. It is public again.',
    detail: { rowId: base.rowId },
    actorId: admin.id, label: admin.email,
  });
}

/** The create form's own fields, shared by the create action and the replace action. */
function firstKickFacts(formData: FormData, prefix = ''): {
  ok: true; value: Omit<CreateFirstKickGoalInput, 'adminUserId'>;
} | { ok: false; error: string } {
  const at = (name: string) => formData.get(`${prefix}${name}`);

  const season = parseRequiredInt(at('season'));
  if (!season.ok) return { ok: false, error: 'Season must be a year from 1897 to 2100.' };

  const clubNameRaw = requiredText(at('clubNameRaw'), 200);
  if (!clubNameRaw) return { ok: false, error: 'The club name as the source records it is required.' };

  const roundRaw = requiredText(at('roundRaw'), 50);
  if (!roundRaw) return { ok: false, error: 'The round is required.' };

  const consecutive = parseNullableInt(at('consecutiveGoalKicks'));
  if (!consecutive.ok) return { ok: false, error: 'Consecutive goal kicks must be a whole number of 1 or more.' };

  const kickless = parseNullableInt(at('kicklessMatchesBeforeFirstKick'));
  if (!kickless.ok) {
    return { ok: false, error: 'Kickless matches before the first kick must be a whole number of 0 or more.' };
  }

  const playerId = parsePositiveInt(at('playerId'));
  const playerNameRaw = optionalText(at('playerNameRaw'), 200);
  if (playerId === null && !playerNameRaw) {
    return {
      ok: false,
      error: 'Select a player by record, or enter the name as the source records it.',
    };
  }

  return {
    ok: true,
    value: {
      playerId,
      playerNameRaw,
      playerNameClean: optionalText(at('playerNameClean'), 200),
      clubNameRaw,
      season: season.value,
      roundRaw,
      seasonFootnoteRaw: optionalText(at('seasonFootnoteRaw'), 200),
      sourceAnnotation: optionalText(at('sourceAnnotation'), 500),
      notes: optionalText(at('notes'), 2000),
      consecutiveGoalKicks: consecutive.value ?? 1,
      noFurtherCareerGoals: parseCheckbox(at('noFurtherCareerGoals')),
      noFurtherCareerKicks: parseCheckbox(at('noFurtherCareerKicks')),
      kicklessMatchesBeforeFirstKick: kickless.value ?? 0,
      matchId: parsePositiveInt(at('matchId')),
    },
  };
}

export async function createFirstKickGoalAction(
  _previous: SpecialRecordsActionState,
  formData: FormData,
): Promise<SpecialRecordsActionState> {
  const admin = await requireCapability('data.specialRecords.edit');

  const facts = firstKickFacts(formData);
  if (!facts.ok) return { error: facts.error };

  const result = await createFirstKickQuery({ ...facts.value, adminUserId: admin.id });
  return settle(result, {
    action: 'create_first_kick_goal',
    auditAction: 'special_records.first_kick_created',
    message: 'First-kick-goal record created.',
    detail: { season: facts.value.season, playerId: facts.value.playerId },
    actorId: admin.id, label: admin.email,
  });
}

export async function replaceFirstKickGoalAction(
  _previous: SpecialRecordsActionState,
  formData: FormData,
): Promise<SpecialRecordsActionState> {
  const admin = await requireCapability('data.specialRecords.edit');

  const base = editBase(formData);
  if (base === null) return { error: 'Bad request.' };
  const reason = requiredText(formData.get('reason'), 500);
  if (!reason) return { error: 'Give a reason for replacing this record.' };

  const facts = firstKickFacts(formData, 'replacement_');
  if (!facts.ok) return { error: facts.error };

  const result = await replaceFirstKickQuery({
    ...base,
    reason,
    adminUserId: admin.id,
    note: optionalText(formData.get('adminNote'), 2000),
    replacement: facts.value,
  });
  return settle(result, {
    action: 'replace_first_kick_goal',
    auditAction: 'special_records.first_kick_replaced',
    message: 'Record suppressed and its replacement recorded, as one change.',
    detail: { rowId: base.rowId },
    actorId: admin.id, label: admin.email,
  });
}

// =========================================================================
// after_siren_kicks -- the kick after the siren
// =========================================================================

/** Exactly AFLDB-ISSUE-167 §3.4's amendable list for `after_siren_kicks`. */
export const AFTER_SIREN_CORRECTABLE_FIELDS = [
  'playerNameRaw', 'playerNameClean', 'clubNameRaw', 'opponentNameRaw', 'competition',
  'premiershipSeason', 'season', 'roundRaw', 'kickScored', 'kickEffect', 'kickerResult',
  'siren', 'kickerScoreRaw', 'opponentScoreRaw', 'kickerPoints', 'opponentPoints',
  'supergoalScoring', 'cited', 'shotDetail', 'sourceAnnotation', 'notes',
] as const;

function afterSirenCorrection(
  formData: FormData, changed: string[],
): { ok: true; value: AfterSirenCorrection } | { ok: false; error: string } {
  const fields: AfterSirenCorrection = {};
  const text: [string, keyof AfterSirenCorrection, number][] = [
    ['playerNameRaw', 'playerNameRaw', 200],
    ['playerNameClean', 'playerNameClean', 200],
    ['clubNameRaw', 'clubNameRaw', 200],
    ['opponentNameRaw', 'opponentNameRaw', 200],
    ['competition', 'competition', 200],
    ['roundRaw', 'roundRaw', 50],
    ['kickerScoreRaw', 'kickerScoreRaw', 50],
    ['opponentScoreRaw', 'opponentScoreRaw', 50],
  ];
  for (const [name, key, max] of text) {
    if (!changed.includes(name)) continue;
    (fields as Record<string, unknown>)[key] =
      (formData.get(name) ?? '').toString().trim().slice(0, max);
  }

  if (changed.includes('season')) {
    const season = parseRequiredInt(formData.get('season'));
    if (!season.ok) return { ok: false, error: 'Season must be a year from 1897 to 2100.' };
    fields.season = season.value;
  }
  for (const name of ['kickerPoints', 'opponentPoints'] as const) {
    if (!changed.includes(name)) continue;
    const points = parseRequiredInt(formData.get(name));
    if (!points.ok) return { ok: false, error: 'Both final scores must be whole numbers of points.' };
    fields[name] = points.value;
  }

  if (changed.includes('kickScored')) {
    const value = parseEnum(formData.get('kickScored'), AFTER_SIREN_SCORES);
    if (!value) return { ok: false, error: 'Choose what the kick registered: a goal, a behind, or nothing.' };
    fields.kickScored = value;
  }
  if (changed.includes('kickEffect')) {
    const value = parseEnum(formData.get('kickEffect'), AFTER_SIREN_EFFECTS);
    if (!value) return { ok: false, error: 'Choose what the kick did to the result.' };
    fields.kickEffect = value;
  }
  if (changed.includes('kickerResult')) {
    const value = parseEnum(formData.get('kickerResult'), AFTER_SIREN_RESULTS);
    if (!value) return { ok: false, error: "Choose the match result from the kicker's side." };
    fields.kickerResult = value;
  }
  if (changed.includes('siren')) {
    const value = parseEnum(formData.get('siren'), AFTER_SIREN_SIRENS);
    if (!value) return { ok: false, error: 'Choose which siren the kick followed.' };
    fields.siren = value;
  }

  if (changed.includes('premiershipSeason')) {
    fields.premiershipSeason = parseCheckbox(formData.get('premiershipSeason'));
  }
  if (changed.includes('supergoalScoring')) {
    fields.supergoalScoring = parseCheckbox(formData.get('supergoalScoring'));
  }
  if (changed.includes('cited')) fields.cited = parseCheckbox(formData.get('cited'));
  if (changed.includes('shotDetail')) {
    fields.shotDetail = optionalText(formData.get('shotDetail'), 200);
  }
  if (changed.includes('sourceAnnotation')) {
    fields.sourceAnnotation = optionalText(formData.get('sourceAnnotation'), 500);
  }
  if (changed.includes('notes')) fields.notes = optionalText(formData.get('notes'), 2000);

  return { ok: true, value: fields };
}

export async function correctAfterSirenKickAction(
  _previous: SpecialRecordsActionState,
  formData: FormData,
): Promise<SpecialRecordsActionState> {
  const admin = await requireCapability('data.specialRecords.edit');

  const base = editBase(formData);
  if (base === null) return { error: 'Bad request.' };
  const changed = parseChangedFields(formData.get('changed'), AFTER_SIREN_CORRECTABLE_FIELDS);
  if (changed.length === 0) return { error: 'Nothing was changed.' };

  const fields = afterSirenCorrection(formData, changed);
  if (!fields.ok) return { error: fields.error };

  const result = await correctAfterSirenQuery({
    ...base,
    adminUserId: admin.id,
    note: optionalText(formData.get('adminNote'), 2000),
    fields: fields.value,
  });
  return settle(result, {
    action: 'correct_after_siren',
    auditAction: 'special_records.after_siren_corrected',
    message: 'After-the-siren record corrected.',
    detail: { rowId: base.rowId, fields: changed },
    actorId: admin.id, label: admin.email,
  });
}

export async function suppressAfterSirenKickAction(
  _previous: SpecialRecordsActionState,
  formData: FormData,
): Promise<SpecialRecordsActionState> {
  const admin = await requireCapability('data.specialRecords.edit');

  const base = editBase(formData);
  if (base === null) return { error: 'Bad request.' };
  const reason = requiredText(formData.get('reason'), 500);
  if (!reason) return { error: 'Give a reason for suppressing this after-the-siren record.' };

  const result = await suppressAfterSirenQuery({
    ...base, reason, adminUserId: admin.id, note: optionalText(formData.get('adminNote'), 2000),
  });
  return settle(result, {
    action: 'suppress_after_siren',
    auditAction: 'special_records.after_siren_suppressed',
    message: 'Record suppressed. It no longer appears anywhere on the public site.',
    detail: { rowId: base.rowId },
    actorId: admin.id, label: admin.email,
  });
}

export async function reinstateAfterSirenKickAction(
  _previous: SpecialRecordsActionState,
  formData: FormData,
): Promise<SpecialRecordsActionState> {
  const admin = await requireCapability('data.specialRecords.edit');

  const base = editBase(formData);
  if (base === null) return { error: 'Bad request.' };

  const result = await reinstateAfterSirenQuery({
    ...base, adminUserId: admin.id, note: optionalText(formData.get('adminNote'), 2000),
  });
  return settle(result, {
    action: 'reinstate_after_siren',
    auditAction: 'special_records.after_siren_reinstated',
    message: 'Record reinstated. It is public again.',
    detail: { rowId: base.rowId },
    actorId: admin.id, label: admin.email,
  });
}

function afterSirenFacts(formData: FormData, prefix = ''): {
  ok: true; value: Omit<CreateAfterSirenKickInput, 'adminUserId'>;
} | { ok: false; error: string } {
  const at = (name: string) => formData.get(`${prefix}${name}`);

  const season = parseRequiredInt(at('season'));
  if (!season.ok) return { ok: false, error: 'Season must be a year from 1897 to 2100.' };

  const clubNameRaw = requiredText(at('clubNameRaw'), 200);
  if (!clubNameRaw) return { ok: false, error: "The kicker's club name as the source records it is required." };
  const opponentNameRaw = requiredText(at('opponentNameRaw'), 200);
  if (!opponentNameRaw) return { ok: false, error: "The opponent's name as the source records it is required." };
  const competition = requiredText(at('competition'), 200);
  if (!competition) return { ok: false, error: 'The competition is required.' };
  const roundRaw = requiredText(at('roundRaw'), 50);
  if (!roundRaw) return { ok: false, error: 'The round is required.' };
  const kickerScoreRaw = requiredText(at('kickerScoreRaw'), 50);
  if (!kickerScoreRaw) return { ok: false, error: "The kicker's side's final score is required." };
  const opponentScoreRaw = requiredText(at('opponentScoreRaw'), 50);
  if (!opponentScoreRaw) return { ok: false, error: "The opponent's final score is required." };

  const kickerPoints = parseRequiredInt(at('kickerPoints'));
  const opponentPoints = parseRequiredInt(at('opponentPoints'));
  if (!kickerPoints.ok || !opponentPoints.ok) {
    return { ok: false, error: 'Both final scores must be whole numbers of points.' };
  }

  const kickScored = parseEnum(at('kickScored'), AFTER_SIREN_SCORES);
  if (!kickScored) return { ok: false, error: 'Choose what the kick registered.' };
  const kickEffect = parseEnum(at('kickEffect'), AFTER_SIREN_EFFECTS);
  if (!kickEffect) return { ok: false, error: 'Choose what the kick did to the result.' };
  const kickerResult = parseEnum(at('kickerResult'), AFTER_SIREN_RESULTS);
  if (!kickerResult) return { ok: false, error: "Choose the match result from the kicker's side." };
  const siren = parseEnum(at('siren'), AFTER_SIREN_SIRENS) ?? 'final';

  const playerId = parsePositiveInt(at('playerId'));
  const playerNameRaw = optionalText(at('playerNameRaw'), 200);
  if (playerId === null && !playerNameRaw) {
    return {
      ok: false,
      error: 'Select a player by record, or enter the name as the source records it.',
    };
  }

  return {
    ok: true,
    value: {
      playerId,
      playerNameRaw,
      playerNameClean: optionalText(at('playerNameClean'), 200),
      clubNameRaw,
      opponentNameRaw,
      competition,
      premiershipSeason: parseCheckbox(at('premiershipSeason')),
      season: season.value,
      roundRaw,
      kickScored,
      kickEffect,
      kickerResult,
      siren,
      kickerScoreRaw,
      opponentScoreRaw,
      kickerPoints: kickerPoints.value,
      opponentPoints: opponentPoints.value,
      supergoalScoring: parseCheckbox(at('supergoalScoring')),
      cited: parseCheckbox(at('cited')),
      shotDetail: optionalText(at('shotDetail'), 200),
      sourceAnnotation: optionalText(at('sourceAnnotation'), 500),
      notes: optionalText(at('notes'), 2000),
      matchId: parsePositiveInt(at('matchId')),
    },
  };
}

export async function createAfterSirenKickAction(
  _previous: SpecialRecordsActionState,
  formData: FormData,
): Promise<SpecialRecordsActionState> {
  const admin = await requireCapability('data.specialRecords.edit');

  const facts = afterSirenFacts(formData);
  if (!facts.ok) return { error: facts.error };

  const result = await createAfterSirenQuery({ ...facts.value, adminUserId: admin.id });
  return settle(result, {
    action: 'create_after_siren',
    auditAction: 'special_records.after_siren_created',
    message: 'After-the-siren record created.',
    detail: { season: facts.value.season, playerId: facts.value.playerId },
    actorId: admin.id, label: admin.email,
  });
}

export async function replaceAfterSirenKickAction(
  _previous: SpecialRecordsActionState,
  formData: FormData,
): Promise<SpecialRecordsActionState> {
  const admin = await requireCapability('data.specialRecords.edit');

  const base = editBase(formData);
  if (base === null) return { error: 'Bad request.' };
  const reason = requiredText(formData.get('reason'), 500);
  if (!reason) return { error: 'Give a reason for replacing this record.' };

  const facts = afterSirenFacts(formData, 'replacement_');
  if (!facts.ok) return { error: facts.error };

  const result = await replaceAfterSirenQuery({
    ...base,
    reason,
    adminUserId: admin.id,
    note: optionalText(formData.get('adminNote'), 2000),
    replacement: facts.value,
  });
  return settle(result, {
    action: 'replace_after_siren',
    auditAction: 'special_records.after_siren_replaced',
    message: 'Record suppressed and its replacement recorded, as one change.',
    detail: { rowId: base.rowId },
    actorId: admin.id, label: admin.email,
  });
}
