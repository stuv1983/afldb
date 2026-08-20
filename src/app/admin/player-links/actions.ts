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

function parseTargets(formData: FormData) {
  const targetsRaw = String(formData.get('targets') ?? '');
  const targets = targetsRaw.split(',').filter(Boolean).map(t => {
    const [table, idStr] = t.split(':');
    return { targetTable: table, targetId: Number(idStr) };
  });

  if (targets.length === 0) return { error: 'No targets selected.' };
  if (targets.some(t => !isLinkTargetTable(t.targetTable))) return { error: 'Unknown table in targets.' };
  if (targets.some(t => !Number.isInteger(t.targetId) || t.targetId <= 0)) return { error: 'Bad row id in targets.' };
  
  return { targets };
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

    warning = combineWarnings(warning, result.auditWarning);
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

  const previousStatus = String(formData.get('previousStatus') ?? '');
  if (!['ambiguous', 'unmatched', 'implausible', 'mixed'].includes(previousStatus)) {
    return { error: 'Unknown link status.' };
  }

  const note = String(formData.get('note') ?? '').trim();
  if (note.length > 2000) return { error: 'Notes are limited to 2000 characters.' };

  for (const { targetTable, targetId } of targets) {
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
      warning = combineWarnings(warning, result.auditWarning);
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
      warning = combineWarnings(warning, result.auditWarning);
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
