'use server';

import { revalidatePath } from 'next/cache';

import { authSql } from '@/db/authClient';
import { sql } from '@/db/client';
import {
  confirmUnlinked as confirmUnlinkedQuery,
  createPlayerAndResolveLink,
  isLinkTargetTable,
  resolveLink,
  resolveLinkFromSuggestion,
  setSuggestionStatus,
  type LinkTargetTable,
} from '@/db/queries/player-links';
import { refreshMatchCandidates } from '@/db/queries/player-match-candidates';
import { audit, requireSuperAdmin } from '@/lib/auth/session';

export type PlayerLinkActionState = { error?: string; message?: string; warning?: string };

const ACTIVITY_AUDIT_WARNING =
  'The change succeeded, but its administrative activity audit failed. '
  + 'Do not submit it again; ask an administrator to reconcile the audit log.';

function combineWarnings(...warnings: Array<string | undefined>): string | undefined {
  return warnings.filter(Boolean).join(' ') || undefined;
}

function revalidatePublicLinkPages(): void {
  revalidatePath('/awards/[slug]', 'page');
  revalidatePath('/awards/[slug]/[season]', 'page');
  revalidatePath('/clubs/[slug]', 'page');
  revalidatePath('/honour-teams/[slug]', 'page');
  revalidatePath('/seasons/[year]', 'page');
  revalidatePath('/hall-of-fame');
  revalidatePath('/draft');
  revalidatePath('/records/first-kick-goal');
}

function parseTargets(formData: FormData): {
  targets?: Array<{ targetTable: LinkTargetTable; targetId: number; previousStatus?: string }>;
  error?: string;
} {
  const targetsRaw = String(formData.get('targets') ?? '');
  const rawList = targetsRaw.split(',').filter(Boolean).map(t => {
    const [table, idStr, previousStatus] = t.split(':');
    return { targetTable: table as LinkTargetTable, targetId: Number(idStr), previousStatus };
  });

  if (rawList.length === 0) return { error: 'No targets selected.' };
  if (rawList.some(t => !isLinkTargetTable(t.targetTable))) return { error: 'Unknown table in targets.' };
  if (rawList.some(t => !Number.isInteger(t.targetId) || t.targetId <= 0)) return { error: 'Bad row id in targets.' };
  
  return { targets: rawList };
}

export async function linkPlayer(
  _prev: PlayerLinkActionState,
  formData: FormData,
): Promise<PlayerLinkActionState> {
  const admin = await requireSuperAdmin();

  const { targets, error } = parseTargets(formData);
  if (error || !targets) return { error };

  const playerId = Number(formData.get('playerId'));
  if (!Number.isInteger(playerId) || playerId <= 0) {
    return { error: 'Pick a player first.' };
  }

  const note = String(formData.get('note') ?? '').trim();
  if (note.length > 2000) return { error: 'Notes are limited to 2000 characters.' };

  let warning: string | undefined;

  for (const { targetTable, targetId } of targets) {
    const result = await resolveLink({
      targetTable, targetId, playerId, adminUserId: admin.id, note,
    });
    if (!result.ok) return { error: `Error on ${targetTable}:${targetId}: ${result.error}` };

    try {
      await audit('player_link.linked', { targetTable, targetId, playerId },
        { userId: admin.id, label: admin.email });
    } catch (error) {
      console.error('Failed to log administrative audit for player link', error);
      warning = combineWarnings(warning, ACTIVITY_AUDIT_WARNING);
    }
  }

  revalidatePublicLinkPages();
  return { message: `Player linked to ${targets.length} record(s).`, warning };
}

export async function confirmUnlinked(
  _prev: PlayerLinkActionState,
  formData: FormData,
): Promise<PlayerLinkActionState> {
  const admin = await requireSuperAdmin();

  const { targets, error } = parseTargets(formData);
  if (error || !targets) return { error };

  const note = String(formData.get('note') ?? '').trim();
  if (note.length > 2000) return { error: 'Notes are limited to 2000 characters.' };

  for (const { targetTable, targetId, previousStatus } of targets) {
    if (!previousStatus || !['ambiguous', 'unmatched', 'implausible'].includes(previousStatus)) {
      return { error: `Unknown link status for target ${targetTable}:${targetId}.` };
    }

    const result = await confirmUnlinkedQuery({
      targetTable, targetId, previousStatus, adminUserId: admin.id, note,
    });
    if (!result.ok) return { error: `Error on ${targetTable}:${targetId}: ${result.error}` };

    await audit('player_link.confirmed_unlinked', { targetTable, targetId },
      { userId: admin.id, label: admin.email });
  }

  revalidatePublicLinkPages();
  return { message: `Recorded ${targets.length} record(s) as vetted — genuinely unlinked.` };
}

export async function reviewSuggestion(
  _prev: PlayerLinkActionState,
  formData: FormData,
): Promise<PlayerLinkActionState> {
  const admin = await requireSuperAdmin();

  const id = Number(formData.get('suggestionId'));
  if (!Number.isInteger(id) || id <= 0) return { error: 'Bad suggestion id.' };

  const status = String(formData.get('status') ?? '');
  if (status !== 'accepted' && status !== 'dismissed') {
    return { error: 'Unknown suggestion status.' };
  }

  await setSuggestionStatus(id, status, admin.id);

  await audit('player_link.suggestion_reviewed', { suggestionId: id, status },
    { userId: admin.id, label: admin.email });

  return { message: `Suggestion ${status}.` };
}

export async function createAndLinkPlayer(
  _prev: PlayerLinkActionState,
  formData: FormData,
): Promise<PlayerLinkActionState> {
  const admin = await requireSuperAdmin();

  const { targets, error } = parseTargets(formData);
  if (error || !targets) return { error };

  const displayName = String(formData.get('displayName') ?? '').trim();
  if (!displayName || displayName.length > 100) {
    return { error: 'Player display name is required (max 100 characters).' };
  }

  const givenName = String(formData.get('givenName') ?? '').trim() || null;
  const surname = String(formData.get('surname') ?? '').trim() || null;
  const dob = String(formData.get('dob') ?? '').trim() || null;
  const dobConfidence = (String(formData.get('dobConfidence') ?? 'sourced') || 'sourced') as 'sourced' | 'estimated' | 'derived' | 'unknown';

  const rawHeight = formData.get('heightCm');
  const heightCm = rawHeight && Number.isInteger(Number(rawHeight)) ? Number(rawHeight) : null;

  const rawWeight = formData.get('weightKg');
  const weightKg = rawWeight && Number.isInteger(Number(rawWeight)) ? Number(rawWeight) : null;

  const notes = String(formData.get('notes') ?? '').trim() || null;
  const note = String(formData.get('note') ?? '').trim();
  if (note.length > 2000) return { error: 'Notes are limited to 2000 characters.' };

  const playerFields = {
    displayName, givenName, surname, dob, dobConfidence, heightCm, weightKg, notes,
  };

  let first = true;
  let createdPlayerId = 0;
  let createdPlayerName = '';
  let warning: string | undefined;

  for (const { targetTable, targetId } of targets) {
    if (first) {
      const result = await createPlayerAndResolveLink({
        targetTable,
        targetId,
        adminUserId: admin.id,
        note,
        player: playerFields,
      });
      if (!result.ok) return { error: result.error };
      const { player } = result;
      createdPlayerId = player.id;
      createdPlayerName = player.displayName;
      try {
        await audit('player_link.created_and_linked', {
          targetTable,
          targetId,
          playerId: player.id,
          playerName: player.displayName,
        }, { userId: admin.id, label: admin.email });
      } catch (error) {
        console.error('Failed to log administrative audit for create-and-link', error);
        warning = combineWarnings(warning, ACTIVITY_AUDIT_WARNING);
      }
      first = false;
    } else {
      const result = await resolveLink({
        targetTable, targetId, playerId: createdPlayerId, adminUserId: admin.id, note,
      });
      if (!result.ok) return { error: `Error on ${targetTable}:${targetId}: ${result.error}` };
      try {
        await audit('player_link.linked', { targetTable, targetId, playerId: createdPlayerId },
          { userId: admin.id, label: admin.email });
      } catch (error) {
        console.error('Failed to log administrative audit for player link', error);
        warning = combineWarnings(warning, ACTIVITY_AUDIT_WARNING);
      }
    }
  }

  revalidatePublicLinkPages();
  revalidatePath('/players');
  revalidatePath('/admin/data-editor');
  return {
    message: `Created player ${createdPlayerName} (ID #${createdPlayerId}) and linked successfully to ${targets.length} record(s).`,
    warning,
  };
}

/**
 * Approve one suggested match.
 *
 * The browser sends a target and a player id and nothing else that
 * matters: any score or band it might post is ignored, because
 * resolveLinkFromSuggestion recomputes the match server-side inside the
 * writing transaction and refuses the link unless that fresh
 * calculation still names the same player. Choosing an ALTERNATIVE
 * candidate deliberately does not come through here -- it goes through
 * linkPlayer and is recorded as a manual decision, because that is what
 * it is.
 *
 * No revalidatePath: the client refreshes once the action settles (see
 * reviewSuggestion and SuggestionControls).
 */
export async function approveSuggestion(
  _prev: PlayerLinkActionState,
  formData: FormData,
): Promise<PlayerLinkActionState> {
  const admin = await requireSuperAdmin();

  const { targets, error } = parseTargets(formData);
  if (error || !targets) return { error };
  if (targets.length !== 1) {
    return { error: 'Approve suggested matches one record at a time.' };
  }

  const playerId = Number(formData.get('playerId'));
  if (!Number.isInteger(playerId) || playerId <= 0) {
    return { error: 'The suggestion did not carry a player.' };
  }

  const note = String(formData.get('note') ?? '').trim();
  if (note.length > 2000) return { error: 'Notes are limited to 2000 characters.' };

  const { targetTable, targetId } = targets[0];
  const result = await resolveLinkFromSuggestion({
    targetTable, targetId, playerId, adminUserId: admin.id, method: 'suggested', note,
  });
  if (!result.ok) return { error: result.error };

  let warning: string | undefined;
  try {
    await audit('player_link.suggestion_approved', { targetTable, targetId, playerId },
      { userId: admin.id, label: admin.email });
  } catch (auditError) {
    console.error('Failed to log administrative audit for suggestion approval', auditError);
    warning = ACTIVITY_AUDIT_WARNING;
  }

  return { message: 'Suggested match approved.', warning };
}

/**
 * Approve a batch of suggestions.
 *
 * Only the target ids are taken from the request. Every row is locked,
 * re-read and rescored on its own, and must still be bulk-eligible at
 * that moment -- so a row whose evidence changed, or which another
 * admin resolved a second earlier, is skipped rather than forced
 * through. One failure does not abandon the batch and does not link
 * anything else incorrectly: each row succeeds or is reported.
 */
export async function bulkApproveSuggestions(
  _prev: PlayerLinkActionState,
  formData: FormData,
): Promise<PlayerLinkActionState> {
  const admin = await requireSuperAdmin();

  const { targets, error } = parseTargets(formData);
  if (error || !targets) return { error };

  const note = String(formData.get('note') ?? '').trim();
  if (note.length > 2000) return { error: 'Notes are limited to 2000 characters.' };

  const playerIds = String(formData.get('playerIds') ?? '').split(',');
  if (playerIds.length !== targets.length) {
    return { error: 'The selection did not match its candidates. Refresh and try again.' };
  }

  let approved = 0;
  const skipped: string[] = [];
  let warning: string | undefined;

  for (const [index, { targetTable, targetId }] of targets.entries()) {
    const playerId = Number(playerIds[index]);
    if (!Number.isInteger(playerId) || playerId <= 0) {
      skipped.push(`${targetTable}:${targetId} (no candidate)`);
      continue;
    }

    const result = await resolveLinkFromSuggestion({
      targetTable, targetId, playerId, adminUserId: admin.id, method: 'bulk_suggested', note,
    });
    if (!result.ok) {
      skipped.push(`${targetTable}:${targetId} — ${result.error}`);
      continue;
    }
    approved += 1;

    try {
      await audit('player_link.bulk_suggestion_approved', { targetTable, targetId, playerId },
        { userId: admin.id, label: admin.email });
    } catch (auditError) {
      console.error('Failed to log administrative audit for bulk approval', auditError);
      warning = ACTIVITY_AUDIT_WARNING;
    }
  }

  const summary = `Approved ${approved} suggested match(es).`;
  if (skipped.length > 0) {
    return {
      message: summary,
      warning: combineWarnings(
        warning,
        `${skipped.length} left for review: ${skipped.slice(0, 5).join('; ')}`
        + (skipped.length > 5 ? ' …' : ''),
      ),
    };
  }
  return { message: summary, warning };
}

/**
 * Recompute every suggestion in the queue.
 *
 * Wholesale, so the entire cache carries one algorithm version, and
 * cheap enough to run on demand: candidate generation is three indexed
 * lookups per source row and the scoring itself is pure arithmetic.
 */
export async function refreshSuggestions(
  _prev: PlayerLinkActionState,
  _formData: FormData,
): Promise<PlayerLinkActionState> {
  const admin = await requireSuperAdmin();

  try {
    const result = await refreshMatchCandidates(sql, authSql);
    await audit('player_link.suggestions_refreshed', result,
      { userId: admin.id, label: admin.email });
    return {
      message:
        `Scored ${result.entities} queue record(s): ${result.suggestions} candidate(s) cached, `
        + `${result.bulkEligible} eligible for bulk approval (${result.algorithmVersion}).`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `Suggestions could not be recomputed: ${message}` };
  }
}
