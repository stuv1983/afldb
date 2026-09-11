'use server';

import {
  clearCoachAssignment as clearCoachAssignmentQuery,
  createCoach as createCoachQuery,
  getCoachAdminDetail,
  linkCoachToPlayer as linkCoachToPlayerQuery,
  listCoachedClubSlugs,
  retireCoachOverride as retireCoachOverrideQuery,
  saveCoachMetadata as saveCoachMetadataQuery,
  setCoachAssignment as setCoachAssignmentQuery,
  unlinkCoach as unlinkCoachQuery,
} from '@/db/queries/admin-coaches';
import { sql } from '@/db/client';
import { searchPlayers, type SearchResult } from '@/db/queries/search';
import { audit, requireCapability } from '@/lib/auth/session';
import { clubPath, coachPath, matchPath, playerPath } from '@/lib/format';
import { coachSlug } from '@/lib/slugs';

import type { CoachActionState } from './submit-helper';
import { optionalText, parseAssignments, parsePositiveInt } from './validation';

/**
 * The coach administration Server Actions (AFLDB-ISSUE-159 §8.2, §16.1
 * deliverable 6, Stage 2). Thin, matching the brownlow and player-links
 * shape: assert the capability first, parse the form, hand the decision to
 * one `src/db/queries/admin-coaches.ts` transaction, audit a refusal worth
 * one, and return the public paths that changed for the client to
 * revalidate AFTER this action has already returned (§9, S-6 --
 * `submit-helper.ts` is where that fetch actually happens; nothing here
 * calls `revalidatePath`).
 *
 * `requireCapability('data.coaches.edit')` is Super Admin only (§8.1): a
 * coach edit becomes a public statistical fact immediately, with no draft
 * stage.
 */

async function coachRevalidatePaths(coachId: number): Promise<string[]> {
  const [detail, clubSlugs] = await Promise.all([
    getCoachAdminDetail(coachId),
    listCoachedClubSlugs(coachId),
  ]);
  const paths = ['/coaches', '/records/coaches'];
  if (detail) {
    paths.push(coachPath(coachSlug(detail.displayName), detail.id));
    if (detail.playerId !== null && detail.playerSlug !== null) {
      paths.push(playerPath(detail.playerSlug, detail.playerId));
    }
  }
  for (const slug of clubSlugs) paths.push(clubPath(slug));
  return paths;
}

async function auditRefusal(action: string, detail: Record<string, unknown>, actorId: number, label: string): Promise<void> {
  try {
    await audit('admin.coaches_refused', { action, ...detail }, { userId: actorId, label });
  } catch (error) {
    console.error('Failed to log administrative audit for coach admin refusal', error);
  }
}

export async function createCoachAction(
  _previous: CoachActionState,
  formData: FormData,
): Promise<CoachActionState> {
  const admin = await requireCapability('data.coaches.edit');

  const displayName = (formData.get('displayName') ?? '').toString().trim();
  if (!displayName) return { error: 'Display name is required.' };

  const result = await createCoachQuery({
    displayName,
    givenName: optionalText(formData.get('givenName'), 60),
    surname: optionalText(formData.get('surname'), 60),
    dob: optionalText(formData.get('dob'), 10),
    notes: optionalText(formData.get('notes'), 2000),
    adminUserId: admin.id,
    note: optionalText(formData.get('note'), 2000),
    confirmed: formData.get('confirmed') === '1',
  });

  if (!result.ok) {
    if ('needsConfirmation' in result) {
      return {
        needsConfirmation: true,
        candidates: result.candidates,
        error: 'A similarly named coach already exists. Review below, then confirm to create a new, separate coach anyway.',
      };
    }
    await auditRefusal('create', { displayName, reason: result.error }, admin.id, admin.email);
    return { error: result.error };
  }

  try {
    await audit('coaches.created', { coachId: result.coachId, displayName }, { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for coach creation', error);
  }

  return {
    ok: true,
    message: `Coach "${displayName}" created (#${result.coachId}).`,
    revalidatePaths: await coachRevalidatePaths(result.coachId),
  };
}

export async function saveCoachMetadataAction(
  _previous: CoachActionState,
  formData: FormData,
): Promise<CoachActionState> {
  const admin = await requireCapability('data.coaches.edit');

  const coachId = parsePositiveInt(formData.get('coachId'));
  if (coachId === null) return { error: 'Bad coach id.' };
  const displayName = (formData.get('displayName') ?? '').toString().trim();
  if (!displayName) return { error: 'Display name is required.' };

  const result = await saveCoachMetadataQuery({
    coachId,
    displayName,
    givenName: optionalText(formData.get('givenName'), 60),
    surname: optionalText(formData.get('surname'), 60),
    dob: optionalText(formData.get('dob'), 10),
    notes: optionalText(formData.get('notes'), 2000),
    adminUserId: admin.id,
    note: optionalText(formData.get('note'), 2000),
  });

  if (!result.ok) {
    await auditRefusal('save_metadata', { coachId, reason: result.error }, admin.id, admin.email);
    return { error: result.error };
  }

  try {
    await audit('coaches.metadata_saved', { coachId }, { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for coach metadata save', error);
  }

  return { ok: true, message: 'Coach metadata saved.', revalidatePaths: await coachRevalidatePaths(coachId) };
}

export async function linkCoachToPlayerAction(
  _previous: CoachActionState,
  formData: FormData,
): Promise<CoachActionState> {
  const admin = await requireCapability('data.coaches.edit');

  const coachId = parsePositiveInt(formData.get('coachId'));
  const playerId = parsePositiveInt(formData.get('playerId'));
  if (coachId === null || playerId === null) return { error: 'Pick a player first.' };

  const result = await linkCoachToPlayerQuery({
    coachId, playerId, adminUserId: admin.id, note: optionalText(formData.get('note'), 2000),
  });

  if (!result.ok) {
    await auditRefusal('link', { coachId, playerId, reason: result.error }, admin.id, admin.email);
    return { error: result.error };
  }

  try {
    await audit('coaches.linked', { coachId, playerId }, { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for coach link', error);
  }

  return { ok: true, message: 'Coach linked to player.', revalidatePaths: await coachRevalidatePaths(coachId) };
}

export async function unlinkCoachAction(
  _previous: CoachActionState,
  formData: FormData,
): Promise<CoachActionState> {
  const admin = await requireCapability('data.coaches.edit');

  const coachId = parsePositiveInt(formData.get('coachId'));
  if (coachId === null) return { error: 'Bad coach id.' };

  const result = await unlinkCoachQuery({
    coachId, adminUserId: admin.id, note: optionalText(formData.get('note'), 2000),
  });

  if (!result.ok) {
    await auditRefusal('unlink', { coachId, reason: result.error }, admin.id, admin.email);
    return { error: result.error };
  }

  try {
    await audit('coaches.unlinked', { coachId }, { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for coach unlink', error);
  }

  return { ok: true, message: 'Coach unlinked from player.', revalidatePaths: await coachRevalidatePaths(coachId) };
}

export async function setCoachAssignmentAction(
  _previous: CoachActionState,
  formData: FormData,
): Promise<CoachActionState> {
  const admin = await requireCapability('data.coaches.edit');

  const coachId = parsePositiveInt(formData.get('coachId'));
  const assignments = parseAssignments(formData.get('assignments'));
  if (coachId === null || assignments === null) return { error: 'Pick at least one match first.' };

  const result = await setCoachAssignmentQuery({
    assignments, coachId, adminUserId: admin.id, note: optionalText(formData.get('note'), 2000),
  });

  if (!result.ok) {
    await auditRefusal('set_assignment', { assignments, coachId, reason: result.error }, admin.id, admin.email);
    return { error: result.error };
  }

  try {
    await audit('coaches.assignment_set', { assignments, coachId }, { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for coach assignment', error);
  }

  const clubIds = [...new Set(assignments.map((a) => a.clubId))];
  const clubs = clubIds.length > 0
    ? await sql<{ slug: string }[]>`SELECT slug FROM clubs WHERE id = ANY(${clubIds})`
    : [];
  const paths = await coachRevalidatePaths(coachId);
  for (const { matchId } of assignments) paths.push(matchPath(matchId));
  for (const club of clubs) paths.push(clubPath(club.slug));
  return {
    ok: true,
    message: assignments.length === 1
      ? 'Coaching assignment set.'
      : `Coaching assignment set for ${assignments.length} matches.`,
    revalidatePaths: paths,
  };
}

export async function clearCoachAssignmentAction(
  _previous: CoachActionState,
  formData: FormData,
): Promise<CoachActionState> {
  const admin = await requireCapability('data.coaches.edit');

  const matchId = parsePositiveInt(formData.get('matchId'));
  const clubId = parsePositiveInt(formData.get('clubId'));
  if (matchId === null || clubId === null) return { error: 'Bad match or club id.' };

  const result = await clearCoachAssignmentQuery({
    matchId, clubId, adminUserId: admin.id, note: optionalText(formData.get('note'), 2000),
  });

  if (!result.ok) {
    await auditRefusal('clear_assignment', { matchId, clubId, reason: result.error }, admin.id, admin.email);
    return { error: result.error };
  }

  try {
    await audit('coaches.assignment_cleared', { matchId, clubId }, { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for coach assignment clear', error);
  }

  const [club] = await sql<{ slug: string }[]>`SELECT slug FROM clubs WHERE id = ${clubId}`;
  const paths = ['/coaches', '/records/coaches', matchPath(matchId)];
  if (club) paths.push(clubPath(club.slug));
  return { ok: true, message: 'Manual assignment override retired.', revalidatePaths: paths };
}

/**
 * The player search behind the linkage panel's picker. Read-only, but
 * guarded the same as every mutation here: it is reachable only from a
 * Super Admin's own linkage panel, and gating it separately at
 * `data.coaches.read` would let an Admin probe player search results for a
 * feature they cannot otherwise act on.
 */
export async function searchPlayersForLinkAction(query: string): Promise<SearchResult[]> {
  await requireCapability('data.coaches.edit');
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  return searchPlayers(trimmed, 10);
}

export async function retireCoachOverrideAction(
  _previous: CoachActionState,
  formData: FormData,
): Promise<CoachActionState> {
  const admin = await requireCapability('data.coaches.edit');

  const coachId = parsePositiveInt(formData.get('coachId'));
  const fieldGroup = (formData.get('fieldGroup') ?? '').toString();
  if (coachId === null || (fieldGroup !== 'identity' && fieldGroup !== 'linkage')) {
    return { error: 'Bad request.' };
  }

  const result = await retireCoachOverrideQuery({
    coachId, fieldGroup, adminUserId: admin.id, note: optionalText(formData.get('note'), 2000),
  });

  if (!result.ok) {
    await auditRefusal('retire_override', { coachId, fieldGroup, reason: result.error }, admin.id, admin.email);
    return { error: result.error };
  }

  try {
    await audit('coaches.override_retired', { coachId, fieldGroup }, { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for coach override retirement', error);
  }

  return {
    ok: true,
    message: fieldGroup === 'identity'
      ? 'Identity override retired. A manual coach with no active identity override no longer survives a destructive reload or a promotion.'
      : 'Linkage override retired.',
    revalidatePaths: await coachRevalidatePaths(coachId),
  };
}
