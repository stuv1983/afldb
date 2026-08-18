'use server';

import { revalidatePath } from 'next/cache';

import {
  confirmUnlinked as confirmUnlinkedQuery,
  isLinkTargetTable,
  resolveLink,
  setSuggestionStatus,
} from '@/db/queries/player-links';
import { audit, requireSuperAdmin } from '@/lib/auth/session';

export type PlayerLinkActionState = { error?: string; message?: string };

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

  revalidatePath('/admin/player-links');
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

  revalidatePath('/admin/player-links');
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

  revalidatePath('/admin/player-links');
  return { message: `Suggestion ${status}.` };
}
