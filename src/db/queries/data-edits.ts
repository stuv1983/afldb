import 'server-only';

import postgres from 'postgres';

import { recordDataEdit, type DataEditTableName } from '@/db/queries/audit-log';
import { sql } from '@/db/client';
import {
  recomputeClubSeasons,
  recomputePlayerDerivedStats,
  recomputeSeasonBrownlowStatus,
  recomputeSeasonMetadata,
} from '@/db/queries/player-derived';
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
 * write access to the statistical tables. The required data_edits audit
 * row is written inside the same import-role transaction (migration
 * 066, AFLDB-ISSUE-027): if the audit insert fails, the edit rolls
 * back with it, so an edit can never exist without its audit row.
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

  if (entity.key === 'draft_picks') {
    const [row] = await sql<Record<string, unknown>[]>`
      SELECT dp.player_name_raw, dp.original_club_raw,
             dp.height_cm, dp.weight_kg, dp.draft_age,
             dp.pick_note, dp.detail,
             dp.draft_year, dp.draft_type, dp.pick_number,
             c.name AS club_name
        FROM draft_picks dp
        LEFT JOIN clubs c ON c.id = dp.club_id
       WHERE dp.id = ${rowId}
    `;
    if (!row) return null;
    return {
      entity: entity.key,
      rowId,
      title: `${row.player_name_raw} · ${row.draft_year} ${row.draft_type} Draft (Pick ${row.pick_number ?? '—'}) · ${row.club_name ?? '—'}`,
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
  | {
      ok: true;
      changed: Record<string, { from: FieldValue; to: FieldValue }>;
    }
  | { ok: false; error: string };

/**
 * Save one field group. Validates against the spec, applies the
 * entity-specific coupled recomputes, and writes the audit row.
 */
async function getEntityNaturalKey(tx: Tx, entityKey: string, rowId: number): Promise<string | null> {
  if (entityKey === 'matches') {
    const [row] = await tx<{ match_key: string }[]>`SELECT match_key FROM matches WHERE id = ${rowId}`;
    if (!row) throw new Error('Match not found');
    return row.match_key;
  }
  if (entityKey === 'players') {
    // Identity is profile-URL path through external_identities (afltables).
    const [row] = await tx<{ external_id: string }[]>`
      SELECT e.external_id
        FROM external_identities e
        JOIN sources s ON s.id = e.source_id
       WHERE e.player_id = ${rowId}
         AND s.key = 'afltables'
         AND e.status IN ('unique', 'resolved')
       LIMIT 1
    `;
    if (!row) return null; // Not source-owned or lacks stable identity
    return `afltables:${row.external_id}`;
  }
  if (entityKey === 'draft_picks') {
    // Draft picks natural key matching the supported DraftGuru importer reload key:
    const [row] = await tx<{ source_id: number; player_url: string; draft_year: number; draft_kind: string }[]>`
      SELECT source_id, player_url, draft_year, draft_kind
        FROM draft_picks WHERE id = ${rowId}
    `;
    if (!row) throw new Error('Draft pick not found');
    return `${row.source_id}|${row.player_url}|${row.draft_year}|${row.draft_kind}`;
  }
  throw new Error(`Unknown entity key for natural key: ${entityKey}`);
}

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
      
      const naturalKey = await getEntityNaturalKey(tx, input.entityKey, input.rowId);

      if (input.entityKey === 'players') {
        await applyPlayerEdit(tx, input.rowId, input.groupKey, values);
      } else if (input.entityKey === 'draft_picks') {
        await applyDraftPickEdit(tx, input.rowId, input.groupKey, values);
      } else {
        await applyMatchEdit(tx, input.rowId, input.groupKey, values);
      }
      
      if (naturalKey !== null) {
        const [existing] = await tx<{ override_values: Record<string, any> }[]>`
          SELECT override_values FROM data_overrides
           WHERE entity_type = ${input.entityKey} AND entity_key = ${naturalKey} AND field_group = ${input.groupKey}
        `;
        
        const overrides: Record<string, any> = existing ? { ...existing.override_values } : {};
        for (const field of group.fields) {
          if (values[field] !== before[field]) {
            overrides[field] = values[field];
          }
        }
        
        // Upsert the active override so importers can replay it
        if (Object.keys(overrides).length > 0) {
          await tx`
            INSERT INTO data_overrides (entity_type, entity_key, field_group, override_values, admin_user_id, is_active, updated_at)
            VALUES (${input.entityKey}, ${naturalKey}, ${input.groupKey}, ${tx.json(overrides)}, ${input.adminUserId}, true, now())
            ON CONFLICT (entity_type, entity_key, field_group) DO UPDATE SET
              override_values = EXCLUDED.override_values,
              admin_user_id = EXCLUDED.admin_user_id,
              is_active = true,
              updated_at = now()
          `;
        }
      }

      // Required audit, same transaction: a failed insert rolls the
      // edit back (AFLDB-ISSUE-027).
      await recordDataEdit(tx, {
        tableName: entity.table as DataEditTableName,
        rowId: input.rowId,
        fieldGroup: input.groupKey,
        oldValues: before,
        newValues: values,
        adminUserId: input.adminUserId,
        note: input.note,
      });
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
      const [match] = await tx<{
        season: number;
        homeClubId: number;
        awayClubId: number;
      }[]>`
        SELECT season, home_club_id AS "homeClubId", away_club_id AS "awayClubId"
          FROM matches
         WHERE id = ${rowId}
      `;
      if (!match) throw new Error('No match with that id.');

      const playerRows = await tx<{ playerId: number }[]>`
        SELECT DISTINCT player_id AS "playerId"
          FROM player_match_stats
         WHERE match_id = ${rowId}
      `;
      const affectedIds = playerRows.map((row) => row.playerId);

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

      // Period rows are cumulative. A sparse Q1/Q2/Q3 set does not identify
      // the final period, so regulation time is period 4 unless explicit
      // extra-time rows (5+) already establish a later final period.
      const [periodRow] = await tx<{ period: number }[]>`
        SELECT GREATEST(COALESCE(max(period), 4), 4)::int AS period
          FROM match_period_scores
         WHERE match_id = ${rowId}
      `;
      const finalPeriod = periodRow?.period ?? 4;
      for (const score of [
        { clubId: match.homeClubId, goals: hg, behinds: hb, points: home },
        { clubId: match.awayClubId, goals: ag, behinds: ab, points: away },
      ]) {
        await tx`
          INSERT INTO match_period_scores (match_id, club_id, period, goals, behinds, points)
          VALUES (${rowId}, ${score.clubId}, ${finalPeriod}, ${score.goals}, ${score.behinds}, ${score.points})
          ON CONFLICT (match_id, club_id, period) DO UPDATE SET
            goals = EXCLUDED.goals,
            behinds = EXCLUDED.behinds,
            points = EXCLUDED.points
        `;
      }

      await recomputeSeasonMetadata(tx, match.season);
      await recomputeClubSeasons(tx, match.season);
      await recomputePlayerDerivedStats(tx, affectedIds, match.season);
      await recomputeSeasonBrownlowStatus(tx, match.season);
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

async function applyDraftPickEdit(
  tx: Tx,
  rowId: number,
  groupKey: string,
  v: Record<string, FieldValue>,
): Promise<void> {
  switch (groupKey) {
    case 'player_info':
      await tx`
        UPDATE draft_picks
           SET player_name_raw = ${v.player_name_raw},
               original_club_raw = ${v.original_club_raw},
               draft_age = ${v.draft_age}
         WHERE id = ${rowId}
      `;
      return;
    case 'measurements':
      await tx`
        UPDATE draft_picks
           SET height_cm = ${v.height_cm},
               weight_kg = ${v.weight_kg}
         WHERE id = ${rowId}
      `;
      return;
    case 'notes':
      await tx`
        UPDATE draft_picks
           SET pick_note = ${v.pick_note},
               detail = ${v.detail}
         WHERE id = ${rowId}
      `;
      return;
    default:
      throw new Error(`unhandled draft_picks group ${groupKey}`);
  }
}
