'use server';

import { revalidatePath } from 'next/cache';

import {
  confirmUnlinked as confirmUnlinkedQuery,
  createPlayerAndResolveLink,
  isLinkTargetTable,
  resolveLink,
  setSuggestionStatus,
} from '@/db/queries/player-links';
import { audit, requireSuperAdmin } from '@/lib/auth/session';

export type PlayerLinkActionState = { error?: string; message?: string };

/**
 * Every public page that renders linked-or-unmatched names from the
 * review tables. Four of these are statically generated with a 24-hour
 * revalidate window, so without an explicit revalidation a link applied
 * here kept rendering as "unmatched" for up to a day — the row left the
 * admin queue immediately while the public page showed the stale state
 * (found with the Team of the Century honour-team rows for Ted Whitten
 * and Ron Barassi). Link actions are rare, super-admin-only events, so
 * blanket revalidation of the whole family is cheaper than maintaining
 * a per-table map that would silently go stale as pages change.
 */
function revalidatePublicLinkPages(): void {
  revalidatePath('/awards/[slug]', 'page');
  revalidatePath('/awards/[slug]/[season]', 'page');
  revalidatePath('/clubs/[slug]', 'page');
  revalidatePath('/honour-teams/[slug]', 'page');
  revalidatePath('/seasons/[year]', 'page');
  // Dynamic today, listed so a future caching change cannot reintroduce
  // the staleness silently.
  revalidatePath('/hall-of-fame');
  revalidatePath('/draft');
  revalidatePath('/records/first-kick-goal');
}

/**
 * The manual half of player linking (migration 056). Every action here
 * is guarded by requireSuperAdmin — the same gate the queue page uses —
 * and every enum-shaped input is checked against its closed set before
 * it reaches SQL, so a bad value comes back as a message rather than a
 * constraint violation.
 */

export async function linkPlayer(
  _prev: PlayerLinkActionState,
  formData: FormData,
): Promise<PlayerLinkActionState> {
  const admin = await requireSuperAdmin();

  const targetTable = String(formData.get('targetTable') ?? '');
  if (!isLinkTargetTable(targetTable)) return { error: 'Unknown table.' };

  const targetId = Number(formData.get('targetId'));
  if (!Number.isInteger(targetId) || targetId <= 0) return { error: 'Bad row id.' };

  const playerId = Number(formData.get('playerId'));
  if (!Number.isInteger(playerId) || playerId <= 0) {
    return { error: 'Pick a player first.' };
  }

  const note = String(formData.get('note') ?? '').trim();
  if (note.length > 2000) return { error: 'Notes are limited to 2000 characters.' };

  const result = await resolveLink({
    targetTable, targetId, playerId, adminUserId: admin.id, note,
  });
  if (!result.ok) return { error: result.error };

  await audit('player_link.linked', { targetTable, targetId, playerId },
    { userId: admin.id, label: admin.email });

  // Deliberately NOT revalidatePath('/admin/player-links'): on this Next
  // 15.5 line, revalidating the route the action was submitted from leaves
  // the client transition pending forever and the queue never visibly
  // updates (verified on dev 2026-08-19 — the POST returns a complete
  // flight payload including this success message, and the browser never
  // applies it; matches vercel/next.js discussion #82289). The client
  // component refreshes the route itself after the action settles, which
  // takes the ordinary navigation path that provably works.
  revalidatePublicLinkPages();
  return { message: 'Player linked.' };
}

export async function confirmUnlinked(
  _prev: PlayerLinkActionState,
  formData: FormData,
): Promise<PlayerLinkActionState> {
  const admin = await requireSuperAdmin();

  const targetTable = String(formData.get('targetTable') ?? '');
  if (!isLinkTargetTable(targetTable)) return { error: 'Unknown table.' };

  const targetId = Number(formData.get('targetId'));
  if (!Number.isInteger(targetId) || targetId <= 0) return { error: 'Bad row id.' };

  const previousStatus = String(formData.get('previousStatus') ?? '');
  if (!['ambiguous', 'unmatched', 'implausible'].includes(previousStatus)) {
    return { error: 'Unknown link status.' };
  }

  const note = String(formData.get('note') ?? '').trim();
  if (note.length > 2000) return { error: 'Notes are limited to 2000 characters.' };

  const result = await confirmUnlinkedQuery({
    targetTable, targetId, previousStatus, adminUserId: admin.id, note,
  });
  if (!result.ok) return { error: result.error };

  await audit('player_link.confirmed_unlinked', { targetTable, targetId },
    { userId: admin.id, label: admin.email });

  // No self-revalidation — see the comment in linkPlayer. The vetted-unlinked
  // row renders differently on the public pages too (no more reader
  // suggestion prompt), so those revalidate here as before.
  revalidatePublicLinkPages();
  return { message: 'Recorded as vetted — genuinely unlinked.' };
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

  // No self-revalidation — see the comment in linkPlayer.
  return { message: `Suggestion ${status}.` };
}

/**
 * Create a new player record and link an unresolved item to it in one step (see changeLog.md).
 * Ideal for drafted players who have yet to debut (e.g., Riley Onley, Fred Rodriguez).
 */
export async function createAndLinkPlayer(
  _prev: PlayerLinkActionState,
  formData: FormData,
): Promise<PlayerLinkActionState> {
  const admin = await requireSuperAdmin();

  const targetTable = String(formData.get('targetTable') ?? '');
  if (!isLinkTargetTable(targetTable)) return { error: 'Unknown table.' };

  const targetId = Number(formData.get('targetId'));
  if (!Number.isInteger(targetId) || targetId <= 0) return { error: 'Bad row id.' };

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

  const result = await createPlayerAndResolveLink({
    targetTable,
    targetId,
    adminUserId: admin.id,
    note,
    player: {
      displayName,
      givenName,
      surname,
      dob,
      dobConfidence,
      heightCm,
      weightKg,
      notes,
    },
  });
  if (!result.ok) return { error: result.error };
  const { player } = result;

  await audit('player_link.created_and_linked', {
    targetTable,
    targetId,
    playerId: player.id,
    playerName: player.displayName,
  }, { userId: admin.id, label: admin.email });

  revalidatePublicLinkPages();
  revalidatePath('/players');
  revalidatePath('/admin/data-editor');
  return { message: `Created player ${player.displayName} (ID #${player.id}) and linked successfully.` };
}
