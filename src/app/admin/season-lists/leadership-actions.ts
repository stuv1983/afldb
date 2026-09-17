'use server';

import {
  appointLeader as appointLeaderQuery,
  correctAppointment as correctAppointmentQuery,
  endAppointment as endAppointmentQuery,
  isLeadershipRole,
  reinstateAppointment as reinstateAppointmentQuery,
  replaceLeader as replaceLeaderQuery,
  voidAppointment as voidAppointmentQuery,
  type LeadershipRefusalReason,
} from '@/db/queries/admin-club-leadership';
import { audit, requireCapability } from '@/lib/auth/session';

import type { LeadershipActionState } from './submit-helper';
import { optionalText, parsePositiveInt, requiredText } from './validation';

/**
 * Club leadership Server Actions (AFLDB-ISSUE-163 §12, §17, §18 Stage 2),
 * matching the season-list / fixture / draft / coach shape: assert the
 * capability first, parse the form, hand the decision to exactly one
 * `src/db/queries/admin-club-leadership.ts` transaction (the ONE leadership
 * mutation contract), audit a refusal worth one, and return the
 * server-computed `revalidatePaths` the query already resolved.
 *
 * Unlike every other season-list action, these are the first with a public
 * consumer (§21, D-13): `revalidatePaths` is the affected organisation's
 * public club paths, computed server-side inside the mutation transaction,
 * never assembled or trusted here.
 *
 * `requireCapability('data.seasonLists.edit')` is Super Admin only, reused
 * unchanged (§16, D-10): no new capability exists for leadership. Admin
 * (`data.seasonLists.read`) never reaches this module — the page renders
 * every control behind `canEdit` and `tests/auth.test.ts`'s generic scanner
 * additionally proves the guard is the first statement of every export here.
 */

function shouldAuditRefusal(reason: LeadershipRefusalReason): boolean {
  return reason === 'stale' || reason === 'not_listed' || reason === 'duplicate_active'
    || reason === 'invalid_transition' || reason === 'forbidden' || reason === 'ambiguous_identity';
}

async function auditRefusal(
  action: string, detail: Record<string, unknown>, actorId: number, label: string,
): Promise<void> {
  try {
    await audit('admin.club_leadership_refused', { action, ...detail }, { userId: actorId, label });
  } catch (error) {
    console.error('Failed to log administrative audit for club leadership refusal', error);
  }
}

/**
 * Every refusal maps to this shape: the message for display, and the raw
 * `reason` enum so a panel can special-case `co_captaincy_unconfirmed`
 * (offer the deliberate confirm step, L-3) without parsing the sentence.
 */
function refusalState(reason: LeadershipRefusalReason, error: string): LeadershipActionState {
  return { error, reason };
}

// --- appoint (§12) -------------------------------------------------------

export async function appointLeaderAction(
  _previous: LeadershipActionState,
  formData: FormData,
): Promise<LeadershipActionState> {
  const admin = await requireCapability('data.seasonLists.edit');

  const season = parsePositiveInt(formData.get('season'));
  const clubSlug = requiredText(formData.get('clubSlug'), 60);
  const playerId = parsePositiveInt(formData.get('playerId'));
  const roleRaw = (formData.get('role') ?? '').toString();
  if (season === null || !clubSlug || playerId === null || !isLeadershipRole(roleRaw)) {
    return { error: 'Choose a player and a leadership role.' };
  }

  const result = await appointLeaderQuery({
    season,
    clubSlug,
    playerId,
    role: roleRaw,
    adminUserId: admin.id,
    startedOn: optionalText(formData.get('startedOn'), 10),
    note: optionalText(formData.get('note'), 2000),
    // Strict '1' -- never a truthy coercion. An absent, empty or
    // accidentally-repeated field must never read as confirmed (L-3).
    confirmCoCaptaincy: formData.get('confirmCoCaptaincy') === '1',
  });

  if (!result.ok) {
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal(
        'appoint', { season, clubSlug, playerId, role: roleRaw, reason: result.error },
        admin.id, admin.email,
      );
    }
    return refusalState(result.reason, result.error);
  }

  try {
    await audit(
      'club_leadership.appointed',
      { season, clubSlug, playerId, role: roleRaw, appointmentKey: result.appointmentKey },
      { userId: admin.id, label: admin.email },
    );
  } catch (error) {
    console.error('Failed to log administrative audit for club leadership appointment', error);
  }

  return { ok: true, message: 'Appointment recorded.', revalidatePaths: result.revalidatePaths };
}

// --- replace (§12) -------------------------------------------------------

export async function replaceLeaderAction(
  _previous: LeadershipActionState,
  formData: FormData,
): Promise<LeadershipActionState> {
  const admin = await requireCapability('data.seasonLists.edit');

  const appointmentKey = requiredText(formData.get('appointmentKey'), 60);
  const expectedUpdatedAt = requiredText(formData.get('expectedUpdatedAt'), 60);
  const newPlayerId = parsePositiveInt(formData.get('newPlayerId'));
  if (!appointmentKey || !expectedUpdatedAt || newPlayerId === null) {
    return { error: 'Choose the incoming player.' };
  }

  const result = await replaceLeaderQuery({
    appointmentKey,
    expectedUpdatedAt,
    newPlayerId,
    adminUserId: admin.id,
    effectiveOn: optionalText(formData.get('effectiveOn'), 10),
    note: optionalText(formData.get('note'), 2000),
  });

  if (!result.ok) {
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal(
        'replace', { appointmentKey, newPlayerId, reason: result.error }, admin.id, admin.email,
      );
    }
    return refusalState(result.reason, result.error);
  }

  try {
    await audit(
      'club_leadership.replaced',
      {
        endedAppointmentKey: result.endedAppointmentKey,
        appointmentKey: result.appointmentKey,
        replacementId: result.replacementId,
      },
      { userId: admin.id, label: admin.email },
    );
  } catch (error) {
    console.error('Failed to log administrative audit for club leadership replacement', error);
  }

  return { ok: true, message: 'Replacement recorded.', revalidatePaths: result.revalidatePaths };
}

// --- end (§12) -----------------------------------------------------------

export async function endAppointmentAction(
  _previous: LeadershipActionState,
  formData: FormData,
): Promise<LeadershipActionState> {
  const admin = await requireCapability('data.seasonLists.edit');

  const appointmentKey = requiredText(formData.get('appointmentKey'), 60);
  const expectedUpdatedAt = requiredText(formData.get('expectedUpdatedAt'), 60);
  if (!appointmentKey || !expectedUpdatedAt) return { error: 'Bad request.' };
  if (formData.get('confirmEnd') !== '1') return { error: 'Confirm ending the appointment before submitting.' };

  const result = await endAppointmentQuery({
    appointmentKey,
    expectedUpdatedAt,
    adminUserId: admin.id,
    endedOn: optionalText(formData.get('endedOn'), 10),
    reason: optionalText(formData.get('reason'), 500),
  });

  if (!result.ok) {
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal('end', { appointmentKey, reason: result.error }, admin.id, admin.email);
    }
    return refusalState(result.reason, result.error);
  }

  try {
    await audit('club_leadership.ended', { appointmentKey }, { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for club leadership end', error);
  }

  return { ok: true, message: 'Ended.', revalidatePaths: result.revalidatePaths };
}

// --- reinstate (§12) -------------------------------------------------------

export async function reinstateAppointmentAction(
  _previous: LeadershipActionState,
  formData: FormData,
): Promise<LeadershipActionState> {
  const admin = await requireCapability('data.seasonLists.edit');

  const appointmentKey = requiredText(formData.get('appointmentKey'), 60);
  const expectedUpdatedAt = requiredText(formData.get('expectedUpdatedAt'), 60);
  if (!appointmentKey || !expectedUpdatedAt) return { error: 'Bad request.' };

  const result = await reinstateAppointmentQuery({
    appointmentKey,
    expectedUpdatedAt,
    adminUserId: admin.id,
    confirmCoCaptaincy: formData.get('confirmCoCaptaincy') === '1',
  });

  if (!result.ok) {
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal('reinstate', { appointmentKey, reason: result.error }, admin.id, admin.email);
    }
    return refusalState(result.reason, result.error);
  }

  try {
    await audit('club_leadership.reinstated', { appointmentKey }, { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for club leadership reinstatement', error);
  }

  return { ok: true, message: 'Reinstated.', revalidatePaths: result.revalidatePaths };
}

// --- correct (§12) ---------------------------------------------------------

export async function correctAppointmentAction(
  _previous: LeadershipActionState,
  formData: FormData,
): Promise<LeadershipActionState> {
  const admin = await requireCapability('data.seasonLists.edit');

  const appointmentKey = requiredText(formData.get('appointmentKey'), 60);
  const expectedUpdatedAt = requiredText(formData.get('expectedUpdatedAt'), 60);
  if (!appointmentKey || !expectedUpdatedAt) return { error: 'Bad request.' };

  const result = await correctAppointmentQuery({
    appointmentKey,
    expectedUpdatedAt,
    adminUserId: admin.id,
    startedOn: optionalText(formData.get('startedOn'), 10),
    endedOn: optionalText(formData.get('endedOn'), 10),
    appointmentNote: optionalText(formData.get('appointmentNote'), 2000),
  });

  if (!result.ok) {
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal('correct', { appointmentKey, reason: result.error }, admin.id, admin.email);
    }
    return refusalState(result.reason, result.error);
  }

  try {
    await audit('club_leadership.corrected', { appointmentKey }, { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for club leadership correction', error);
  }

  return { ok: true, message: 'Correction saved.', revalidatePaths: result.revalidatePaths };
}

// --- void (§12) --------------------------------------------------------

export async function voidAppointmentAction(
  _previous: LeadershipActionState,
  formData: FormData,
): Promise<LeadershipActionState> {
  const admin = await requireCapability('data.seasonLists.edit');

  const appointmentKey = requiredText(formData.get('appointmentKey'), 60);
  const expectedUpdatedAt = requiredText(formData.get('expectedUpdatedAt'), 60);
  const reason = requiredText(formData.get('reason'), 500);
  if (!appointmentKey || !expectedUpdatedAt) return { error: 'Bad request.' };
  if (!reason) return { error: 'Give a reason for voiding this appointment.' };
  if (formData.get('confirmVoid') !== '1') return { error: 'Confirm voiding this appointment before submitting.' };

  const result = await voidAppointmentQuery({
    appointmentKey, expectedUpdatedAt, adminUserId: admin.id, reason,
  });

  if (!result.ok) {
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal('void', { appointmentKey, reason: result.error }, admin.id, admin.email);
    }
    return refusalState(result.reason, result.error);
  }

  try {
    await audit('club_leadership.voided', { appointmentKey, reason }, { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for club leadership void', error);
  }

  return { ok: true, message: 'Voided.', revalidatePaths: result.revalidatePaths };
}
