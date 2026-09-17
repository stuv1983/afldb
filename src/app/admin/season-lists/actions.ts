'use server';

import {
  addSeasonListMember as addSeasonListMemberQuery,
  addSeasonListMembers as addSeasonListMembersQuery,
  copySeasonListsForward as copySeasonListsForwardQuery,
  removeSeasonListMember as removeSeasonListMemberQuery,
  transferSeasonListMember as transferSeasonListMemberQuery,
  type SeasonListRefusalReason,
} from '@/db/queries/admin-season-lists';
import { audit, requireCapability } from '@/lib/auth/session';

import type { CopyForwardActionState, SeasonListActionState } from './submit-helper';
import { optionalText, parsePositiveInt, requiredText } from './validation';

/**
 * The season-list administration Server Actions (AFLDB-ISSUE-161 §29 Stage
 * 2), matching the coach/draft shape: assert the capability first, parse the
 * form, hand the decision to exactly one `src/db/queries/admin-season-lists.ts`
 * transaction (the ONE season-list mutation contract), audit a refusal worth
 * one, and return `revalidatePaths: []` always -- no public consumer of a
 * list exists yet (§10), so nothing here ever calls `revalidatePath`.
 *
 * `requireCapability('data.seasonLists.edit')` is Super Admin only (§16):
 * every mutation here is a public-fact-in-waiting decision with no draft
 * stage, matching `data.draft.edit` / `data.coaches.edit`.
 */

function shouldAuditRefusal(reason: SeasonListRefusalReason): boolean {
  return reason === 'duplicate' || reason === 'conflict' || reason === 'stale'
    || reason === 'forbidden' || reason === 'ambiguous_identity';
}

async function auditRefusal(action: string, detail: Record<string, unknown>, actorId: number, label: string): Promise<void> {
  try {
    await audit('admin.season_list_refused', { action, ...detail }, { userId: actorId, label });
  } catch (error) {
    console.error('Failed to log administrative audit for season list refusal', error);
  }
}

// --- add (§12.1) -----------------------------------------------------------

export async function addSeasonListMemberAction(
  _previous: SeasonListActionState,
  formData: FormData,
): Promise<SeasonListActionState> {
  const admin = await requireCapability('data.seasonLists.edit');

  const season = parsePositiveInt(formData.get('season'));
  const clubSlug = requiredText(formData.get('clubSlug'), 60);
  const playerId = parsePositiveInt(formData.get('playerId'));
  if (season === null || !clubSlug || playerId === null) return { error: 'Select a player to add.' };

  const result = await addSeasonListMemberQuery({
    season,
    clubSlug,
    playerId,
    adminUserId: admin.id,
    note: optionalText(formData.get('note'), 2000),
    candidateSource: optionalText(formData.get('candidateSource'), 60),
  });

  if (!result.ok) {
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal('add_member', { season, clubSlug, playerId, reason: result.error }, admin.id, admin.email);
    }
    return { error: result.error };
  }

  try {
    await audit(
      'season_lists.member_added',
      { season, clubSlug, playerId, membershipId: result.membershipId },
      { userId: admin.id, label: admin.email },
    );
  } catch (error) {
    console.error('Failed to log administrative audit for season list add', error);
  }

  return { ok: true, message: 'Added to the list.', revalidatePaths: [] };
}

// --- multi-select add (§18, §23, §14) --------------------------------------

export async function addSeasonListMembersAction(
  _previous: SeasonListActionState,
  formData: FormData,
): Promise<SeasonListActionState> {
  const admin = await requireCapability('data.seasonLists.edit');

  const season = parsePositiveInt(formData.get('season'));
  const clubSlug = requiredText(formData.get('clubSlug'), 60);
  const playerIds = formData.getAll('playerIds')
    .map((value) => parsePositiveInt(value))
    .filter((id): id is number => id !== null);
  if (season === null || !clubSlug || playerIds.length === 0) {
    return { error: 'Select at least one player to add.' };
  }

  const result = await addSeasonListMembersQuery({
    season,
    clubSlug,
    playerIds,
    adminUserId: admin.id,
    note: optionalText(formData.get('note'), 2000),
    candidateSource: optionalText(formData.get('candidateSource'), 60),
  });

  if (!result.ok) {
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal('add_members_batch', { season, clubSlug, playerIds, reason: result.error }, admin.id, admin.email);
    }
    return { error: result.error };
  }

  try {
    await audit(
      'season_lists.members_added',
      { season, clubSlug, added: result.added, batchId: result.batchId },
      { userId: admin.id, label: admin.email },
    );
  } catch (error) {
    console.error('Failed to log administrative audit for season list batch add', error);
  }

  return { ok: true, message: `Added ${result.added} player${result.added === 1 ? '' : 's'}.`, revalidatePaths: [] };
}

// --- remove (§12.2, D-4) -----------------------------------------------------

export async function removeSeasonListMemberAction(
  _previous: SeasonListActionState,
  formData: FormData,
): Promise<SeasonListActionState> {
  const admin = await requireCapability('data.seasonLists.edit');

  const membershipId = parsePositiveInt(formData.get('membershipId'));
  const expectedUpdatedAt = requiredText(formData.get('expectedUpdatedAt'), 60);
  if (membershipId === null || !expectedUpdatedAt) return { error: 'Bad request.' };
  if (formData.get('confirmRemove') !== '1') return { error: 'Confirm the removal before submitting.' };

  const result = await removeSeasonListMemberQuery({
    membershipId,
    expectedUpdatedAt,
    adminUserId: admin.id,
    note: optionalText(formData.get('note'), 2000),
  });

  if (!result.ok) {
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal('remove_member', { membershipId, reason: result.error }, admin.id, admin.email);
    }
    return { error: result.error };
  }

  try {
    await audit(
      'season_lists.member_removed',
      { membershipId, playerId: result.playerId },
      { userId: admin.id, label: admin.email },
    );
  } catch (error) {
    console.error('Failed to log administrative audit for season list removal', error);
  }

  return { ok: true, message: 'Removed from the list.', revalidatePaths: [] };
}

// --- transfer (§13) ----------------------------------------------------------

export async function transferSeasonListMemberAction(
  _previous: SeasonListActionState,
  formData: FormData,
): Promise<SeasonListActionState> {
  const admin = await requireCapability('data.seasonLists.edit');

  const membershipId = parsePositiveInt(formData.get('membershipId'));
  const expectedUpdatedAt = requiredText(formData.get('expectedUpdatedAt'), 60);
  const toClubSlug = requiredText(formData.get('toClubSlug'), 60);
  if (membershipId === null || !expectedUpdatedAt || !toClubSlug) return { error: 'Choose a destination club.' };

  const result = await transferSeasonListMemberQuery({
    membershipId,
    toClubSlug,
    expectedUpdatedAt,
    adminUserId: admin.id,
    note: optionalText(formData.get('note'), 2000),
  });

  if (!result.ok) {
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal('transfer_member', { membershipId, toClubSlug, reason: result.error }, admin.id, admin.email);
    }
    return { error: result.error };
  }

  try {
    await audit(
      'season_lists.member_transferred',
      { membershipId, toClubSlug, transferId: result.transferId },
      { userId: admin.id, label: admin.email },
    );
  } catch (error) {
    console.error('Failed to log administrative audit for season list transfer', error);
  }

  return { ok: true, message: `Transferred to ${toClubSlug}.`, revalidatePaths: [] };
}

// --- copy forward (§11a) ------------------------------------------------------

export async function copySeasonListsForwardAction(
  _previous: CopyForwardActionState,
  formData: FormData,
): Promise<CopyForwardActionState> {
  const admin = await requireCapability('data.seasonLists.edit');

  const season = parsePositiveInt(formData.get('season'));
  const dryRun = formData.get('dryRun') !== '0';
  const clubs = formData.getAll('clubs').map((value) => value.toString()).filter(Boolean);
  if (season === null || clubs.length === 0) return { error: 'Select at least one club to copy forward.' };

  const result = await copySeasonListsForwardQuery({
    season, clubs, dryRun, adminUserId: admin.id,
  });

  if (!result.ok) {
    if (shouldAuditRefusal(result.reason)) {
      await auditRefusal('copy_forward', { season, clubs, dryRun, reason: result.error }, admin.id, admin.email);
    }
    return { error: result.error };
  }

  if (!dryRun) {
    try {
      await audit(
        'season_lists.copied_forward',
        { season, fromSeason: result.fromSeason, copied: result.copied, batchId: result.batchId },
        { userId: admin.id, label: admin.email },
      );
    } catch (error) {
      console.error('Failed to log administrative audit for season list copy-forward', error);
    }
  }

  const previewCount = result.clubs.reduce((sum, club) => sum + club.players, 0);
  return {
    ok: true,
    dryRun: result.dryRun,
    fromSeason: result.fromSeason,
    plan: result.clubs,
    copied: result.dryRun ? previewCount : result.copied,
    message: result.dryRun
      ? `Preview: ${previewCount} player${previewCount === 1 ? '' : 's'} would be copied from ${result.fromSeason}.`
      : `Copied ${result.copied} player${result.copied === 1 ? '' : 's'} forward from ${result.fromSeason}.`,
    revalidatePaths: [],
  };
}
