'use server';

import {
  linkAflApiProvider,
  revokeAflApiLink,
} from '@/db/queries/afl-api-player-links';
import { audit, requireCapability } from '@/lib/auth/session';

/**
 * AFLDB-ISSUE-235 §7.3. Neither action calls `revalidatePath` (E32/A8): the
 * detail page reads live on every navigation, and the client calls
 * `router.refresh()` itself, the `SuggestionControls` pattern.
 *
 * Every posted field the query module does not explicitly read (a name, a
 * score, a status) is ignored here too — only providerId/playerId/note/
 * acknowledgement/fingerprint ever reach `linkAflApiProvider`/
 * `revokeAflApiLink` (A7, D12).
 */

export type AflApiAdjudicationActionState = { error?: string; message?: string; warning?: string };

// Same wording as the sibling actions in ../actions.ts (AFLDB-ISSUE-311). Not shared: a
// 'use server' module may export only async functions.
const ACTIVITY_AUDIT_WARNING =
  'The change succeeded, but its administrative activity audit failed. '
  + 'Do not submit it again; ask an administrator to reconcile the audit log.';

function stringField(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}

export async function linkAflApiPlayer(
  _prev: AflApiAdjudicationActionState,
  formData: FormData,
): Promise<AflApiAdjudicationActionState> {
  const admin = await requireCapability('data.playerLinks');

  const providerId = stringField(formData, 'providerId');
  const playerId = Number(formData.get('playerId'));
  const note = stringField(formData, 'note');
  const surnameAcknowledged = formData.get('surnameAcknowledged') === 'on'
    || formData.get('surnameAcknowledged') === 'true';
  const fingerprint = stringField(formData, 'fingerprint');

  if (!providerId || !Number.isInteger(playerId) || playerId <= 0 || !fingerprint) {
    return { error: 'Missing or invalid submission — reload the page and try again.' };
  }

  const result = await linkAflApiProvider({
    providerId, playerId, adminUserId: admin.id, note, surnameAcknowledged, fingerprint,
  });
  if (!result.ok) return { error: result.error };

  let warning: string | undefined;
  try {
    await audit('player_link.afl_api_linked', { providerId, playerId },
      { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for afl_api link', error);
    warning = ACTIVITY_AUDIT_WARNING;
  }

  return { message: `Linked ${providerId} — awaiting the next settle.`, warning };
}

export async function revokeAflApiPlayerLink(
  _prev: AflApiAdjudicationActionState,
  formData: FormData,
): Promise<AflApiAdjudicationActionState> {
  const admin = await requireCapability('data.playerLinks');

  const providerId = stringField(formData, 'providerId');
  const note = stringField(formData, 'note');
  const fingerprint = stringField(formData, 'fingerprint');

  if (!providerId || !fingerprint) {
    return { error: 'Missing or invalid submission — reload the page and try again.' };
  }

  const result = await revokeAflApiLink({ providerId, adminUserId: admin.id, note, fingerprint });
  if (!result.ok) return { error: result.error };

  let warning: string | undefined;
  try {
    await audit('player_link.afl_api_revoked', { providerId }, { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for afl_api revoke', error);
    warning = ACTIVITY_AUDIT_WARNING;
  }

  return { message: `Revoked the link for ${providerId}.`, warning };
}
