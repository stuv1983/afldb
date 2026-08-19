import 'server-only';

import postgres from 'postgres';

import { authSql } from '@/db/authClient';
import { sql } from '@/db/client';
import {
  EDITABLE_ENTITIES,
  type EditEntity,
  type FieldValue,
  validateFieldValue,
} from '@/lib/edit/spec';

/**
 * The manual data editor's read and write paths (migration 057).
 *
 * Reads run on the public client — everything editable is app-readable.
 * The statistical UPDATE runs as afldb_import on a short-lived
 * connection, the promoteSubmission pattern, so afldb_auth keeps zero
 * write access to the statistical tables. The audit row is written on
 * the auth pool afterwards; a failure there is surfaced, never hidden.
 */

export type EditableRow = {
  entity: string;
  rowId: number;
  /** Human header: player name, or "Home v Away · date". */
  title: string;
  /** Current values for every field in the spec, stringified for forms. */
  values: Record<string, string>;
};

export async function getEditableRow(
  entityKey: string,
  rowId: number,
): Promise<EditableRow | null> {
  const entity = EDITABLE_ENTITIES[entityKey];
  if (!entity || !Number.isInteger(rowId) || rowId <= 0) return null;

  if (entity.key === 'players') {
    const [row] = await sql<Record<string, unknown>[]>`
      SELECT display_name, given_name, surname,
             to_char(dob, 'YYYY-MM-DD') AS dob,
             dob_confidence::text AS dob_confidence,
             birth_year, birth_year_min, birth_year_max,
             birth_year_confidence::text AS birth_year_confidence,
             height_cm, weight_kg, notes
        FROM players WHERE id = ${rowId}
    `;
    if (!row) return null;
    return {
      entity: entity.key,
      rowId,
      title: String(row.display_name),
      values: stringify(entity, row),
    };
  }

  const [row] = await sql<Record<string, unknown>[]>`
    SELECT m.attendance, m.home_goals, m.home_behinds, m.away_goals, m.away_behinds,
           m.home_score, m.away_score,
           m.match_time, m.match_event, m.notes,
           hc.name AS home_name, ac.name AS away_name,
           to_char(m.match_date, 'YYYY-MM-DD') AS match_date,
           m.season, m.round_code
      FROM matches m
      JOIN clubs hc ON hc.id = m.home_club_id
      JOIN clubs ac ON ac.id = m.away_club_id
     WHERE m.id = ${rowId}
  `;
  if (!row) return null;
  return {
    entity: entity.key,
    rowId,
    title: `${row.home_name} v ${row.away_name} · ${row.season} ${row.round_code} · ${row.match_date}`
      + ` · ${row.home_score}–${row.away_score}`,
    values: stringify(entity, row),
  };
}

function stringify(entity: EditEntity, row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(entity.fields)) {
    const v = row[key];
    out[key] = v === null || v === undefined ? '' : String(v);
  }
  return out;
}

export type SaveEditResult =
  | { ok: true; changed: Record<string, { from: FieldValue; to: FieldValue }> }
  | { ok: false; error: string };

/**
 * Save one field group. Validates against the spec, applies the
 * entity-specific coupled recomputes, and writes the audit row.
 */
export async function saveEdit(input: {
  entityKey: string;
  rowId: number;
  groupKey: string;
  /** Raw form values keyed by field key. */
  raw: Record<string, string>;
  adminUserId: number;
  note?: string | null;
}): Promise<SaveEditResult> {
  const entity = EDITABLE_ENTITIES[input.entityKey];
  const group = entity?.groups[input.groupKey];
  if (!entity || !group) return { ok: false, error: 'Unknown entity or field group.' };
  if (!Number.isInteger(input.rowId) || input.rowId <= 0) {
    return { ok: false, error: 'Bad row id.' };
  }

  // Validate every field in the group.
  const values: Record<string, FieldValue> = {};
  for (const fieldKey of group.fields) {
    const field = entity.fields[fieldKey];
    const result = validateFieldValue(field, input.raw[fieldKey] ?? '');
    if (!result.ok) return { ok: false, error: result.error };
    values[fieldKey] = result.value;
  }

  // Cross-field rules the spec cannot express per-field.
  if (input.entityKey === 'players' && input.groupKey === 'birth_year') {
    const lo = values.birth_year_min;
    const hi = values.birth_year_max;
    if (typeof lo === 'number' && typeof hi === 'number' && lo > hi) {
      return { ok: false, error: 'Earliest birth year cannot exceed latest.' };
    }
  }

  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!importUrl) return { ok: false, error: 'AFLDB_IMPORT_DATABASE_URL is not configured.' };

  const importSql = postgres(importUrl, { max: 1, onnotice: () => {} });
  let old: Record<string, FieldValue>;
  try {
    const applied = await importSql.begin(async (tx) => {
      const before = await readCurrent(tx, entity, group.fields, input.rowId);
      if (!before) return null;
      if (input.entityKey === 'players') {
        await applyPlayerEdit(tx, input.rowId, input.groupKey, values);
      } else {
        await applyMatchEdit(tx, input.rowId, input.groupKey, values);
      }
      return before;
    }) as Record<string, FieldValue> | null;
    if (applied === null) return { ok: false, error: 'No row with that id.' };
    old = applied;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `The edit could not be applied: ${message}` };
  } finally {
    await importSql.end({ timeout: 5 });
  }

  const changed: Record<string, { from: FieldValue; to: FieldValue }> = {};
  for (const key of group.fields) {
    if (old[key] !== values[key]) changed[key] = { from: old[key], to: values[key] };
  }

  try {
    await authSql`
      INSERT INTO data_edits
            (table_name, row_id, field_group, old_values, new_values, admin_user_id, note)
      VALUES (${entity.table}, ${input.rowId}, ${input.groupKey},
              ${authSql.json(old)}, ${authSql.json(values)},
              ${input.adminUserId},
              ${(input.note ?? '').trim().slice(0, 2000) || null})
    `;
  } catch (error) {
    console.error('data_edits audit row could not be written', error);
    return {
      ok: false,
      error: 'The edit was applied, but the audit record failed — check the server log.',
    };
  }

  return { ok: true, changed };
}

type Tx = postgres.TransactionSql;

async function readCurrent(
  tx: Tx,
  entity: EditEntity,
  fields: string[],
  rowId: number,
): Promise<Record<string, FieldValue> | null> {
  // Column identifiers come from the spec alone. dob is read as text so
  // the audit snapshot and the change comparison use the same shape the
  // form submits.
  const cols = fields
    .map((f) => (entity.fields[f].kind === 'date'
      ? `to_char(${f}, 'YYYY-MM-DD') AS ${f}`
      : entity.fields[f].kind === 'enum' ? `${f}::text AS ${f}` : f))
    .join(', ');
  const [row] = await tx.unsafe(
    `SELECT ${cols} FROM ${entity.table} WHERE id = $1 FOR UPDATE`,
    [rowId],
  ) as unknown as Record<string, FieldValue>[];
  return row ?? null;
}

async function applyPlayerEdit(
  tx: Tx,
  rowId: number,
  groupKey: string,
  v: Record<string, FieldValue>,
): Promise<void> {
  switch (groupKey) {
    case 'name':
      // Nothing in the database maintains the search and sort forms —
      // they are recomputed here or they silently go stale (the slug is
      // deliberately untouched: player URLs are id-authoritative).
      await tx`
        UPDATE players
           SET display_name = ${v.display_name},
               given_name = ${v.given_name},
               surname = ${v.surname},
               search_name = afldb_normalise_name(${v.display_name}::text),
               sort_name = CASE
                 WHEN ${v.surname}::text IS NULL THEN ${v.display_name}
                 WHEN ${v.given_name}::text IS NULL THEN ${v.surname}
                 ELSE ${v.surname} || ', ' || ${v.given_name}
               END
         WHERE id = ${rowId}
      `;
      return;
    case 'dob':
      await tx`
        UPDATE players
           SET dob = ${v.dob}::date,
               dob_confidence = ${v.dob === null ? 'unknown' : v.dob_confidence}::value_confidence
         WHERE id = ${rowId}
      `;
      return;
    case 'birth_year':
      await tx`
        UPDATE players
           SET birth_year = ${v.birth_year},
               birth_year_min = ${v.birth_year_min},
               birth_year_max = ${v.birth_year_max},
               birth_year_confidence = ${v.birth_year_confidence}::value_confidence
         WHERE id = ${rowId}
      `;
      return;
    case 'height_cm':
      await tx`UPDATE players SET height_cm = ${v.height_cm} WHERE id = ${rowId}`;
      return;
    case 'weight_kg':
      await tx`UPDATE players SET weight_kg = ${v.weight_kg} WHERE id = ${rowId}`;
      return;
    case 'notes':
      await tx`UPDATE players SET notes = ${v.notes} WHERE id = ${rowId}`;
      return;
    default:
      throw new Error(`unhandled players group ${groupKey}`);
  }
}

async function applyMatchEdit(
  tx: Tx,
  rowId: number,
  groupKey: string,
  v: Record<string, FieldValue>,
): Promise<void> {
  switch (groupKey) {
    case 'attendance':
      // Migration 020's contract: the figure and its status agree in
      // both directions, and a genuine zero must cite a source.
      await tx`
        UPDATE matches
           SET attendance = ${v.attendance},
               attendance_status = ${v.attendance === null ? 'not_collected' : 'complete'}::coverage_status,
               attendance_source_id = CASE
                 WHEN ${v.attendance}::int IS NULL THEN NULL
                 ELSE (SELECT id FROM sources WHERE key = 'manual_admin_edit')
               END
         WHERE id = ${rowId}
      `;
      return;
    case 'score': {
      // Everything the CHECK constraints couple, derived in one
      // statement: scores from components, then result, winner and
      // margin from the scores. The admin never types the derived half.
      const hg = v.home_goals as number;
      const hb = v.home_behinds as number;
      const ag = v.away_goals as number;
      const ab = v.away_behinds as number;
      const home = hg * 6 + hb;
      const away = ag * 6 + ab;
      const result = home > away ? 'home_win' : home < away ? 'away_win' : 'draw';
      await tx`
        UPDATE matches
           SET home_goals = ${hg}, home_behinds = ${hb}, home_score = ${home},
               away_goals = ${ag}, away_behinds = ${ab}, away_score = ${away},
               result = ${result}::match_result,
               winner_club_id = CASE ${result}
                 WHEN 'home_win' THEN home_club_id
                 WHEN 'away_win' THEN away_club_id
                 ELSE NULL END,
               margin = ${Math.abs(home - away)}
         WHERE id = ${rowId}
      `;
      return;
    }
    case 'match_time':
      await tx`UPDATE matches SET match_time = ${v.match_time} WHERE id = ${rowId}`;
      return;
    case 'match_event':
      await tx`UPDATE matches SET match_event = ${v.match_event} WHERE id = ${rowId}`;
      return;
    case 'notes':
      await tx`UPDATE matches SET notes = ${v.notes} WHERE id = ${rowId}`;
      return;
    default:
      throw new Error(`unhandled matches group ${groupKey}`);
  }
}
