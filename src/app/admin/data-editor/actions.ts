'use server';

import { revalidatePath } from 'next/cache';

import { saveEdit } from '@/db/queries/data-edits';
import { createPlayer } from '@/db/queries/players';
import { EDITABLE_ENTITIES } from '@/lib/edit/spec';
import { audit, requireSuperAdmin } from '@/lib/auth/session';

export type DataEditState = {
  error?: string;
  message?: string;
  /** rebuild_derived targets left stale by the saved edit, if any. */
  staleDerived?: string[];
};

export type CreatePlayerActionState = {
  error?: string;
  message?: string;
  createdId?: number;
};

/**
 * Create a new player by hand (see changeLog.md).
 * Allows super admins to add bio info for draftees or historical players.
 */
export async function createPlayerAction(
  _prev: CreatePlayerActionState,
  formData: FormData,
): Promise<CreatePlayerActionState> {
  const admin = await requireSuperAdmin();

  const displayName = String(formData.get('displayName') ?? '').trim();
  if (!displayName || displayName.length > 100) {
    return { error: 'Display name is required (up to 100 characters).' };
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

  try {
    const player = await createPlayer({
      displayName,
      givenName,
      surname,
      dob,
      dobConfidence,
      heightCm,
      weightKg,
      notes,
    });

    await audit('player.created', {
      playerId: player.id,
      displayName: player.displayName,
    }, { userId: admin.id, label: admin.email });

    revalidatePath('/admin/data-editor');
    revalidatePath('/players');

    return {
      message: `Created player "${player.displayName}" (ID #${player.id}).`,
      createdId: player.id,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Could not create player: ${msg}` };
  }
}

/**
 * Save one field group of one row. Guarded by requireSuperAdmin like
 * every other manual write; the statistical UPDATE itself runs as
 * afldb_import inside saveEdit, and every save lands one append-only
 * data_edits row.
 */
export async function saveDataEdit(
  _prev: DataEditState,
  formData: FormData,
): Promise<DataEditState> {
  const admin = await requireSuperAdmin();

  const entityKey = String(formData.get('entity') ?? '');
  const entity = EDITABLE_ENTITIES[entityKey];
  if (!entity) return { error: 'Unknown entity.' };

  const rowId = Number(formData.get('rowId'));
  if (!Number.isInteger(rowId) || rowId <= 0) return { error: 'Bad row id.' };

  const groupKey = String(formData.get('group') ?? '');
  const group = entity.groups[groupKey];
  if (!group) return { error: 'Unknown field group.' };

  const note = String(formData.get('note') ?? '').trim();
  if (note.length > 2000) return { error: 'Notes are limited to 2000 characters.' };

  const raw: Record<string, string> = {};
  for (const fieldKey of group.fields) {
    raw[fieldKey] = String(formData.get(fieldKey) ?? '');
  }

  const result = await saveEdit({
    entityKey, rowId, groupKey, raw, adminUserId: admin.id, note,
  });
  if (!result.ok) return { error: result.error };

  if (Object.keys(result.changed).length === 0) {
    return { message: 'No change — the values already match.' };
  }

  await audit('data_edit.saved', { entity: entityKey, rowId, group: groupKey },
    { userId: admin.id, label: admin.email });

  revalidatePath('/admin/data-editor');

  const summary = Object.entries(result.changed)
    .map(([k, c]) => `${entity.fields[k].label}: ${c.from ?? '—'} → ${c.to ?? '—'}`)
    .join('; ');
  return {
    message: `Saved. ${summary}.`,
    staleDerived: group.affectsDerived,
  };
}
