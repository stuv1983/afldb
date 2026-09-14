/**
 * AFLDB-ISSUE-167 Stage 4 — the TypeScript special-record replay adapter.
 *
 * Decision D-3 (2026-09-13, APPROVED WITH MODIFICATION) is the whole shape of
 * this file: `data_overrides` remains the SOLE durable authority, and there are
 * TWO replay adapters over it — the existing Python `replay_admin_overrides` in
 * `tools/migration/common.py` for `after_siren_kicks`, and this one for
 * `player_achievements`, because `tools/records/import-first-kick-goal.ts` is
 * TypeScript and has no access to `common.py`. Two adapters over one authority
 * is not two authorities, PROVIDED the semantics are pinned — which is what
 * `tests/special-records-replay-parity.test.ts` and the shared corpus at
 * `tests/fixtures/special-records-replay-parity.json` are for. D-3 also refused
 * the alternative of porting the first-kick importer to Python merely to share
 * `common.py`.
 *
 * ATOMIC WITH THE OWNING IMPORTER, by construction rather than by convention.
 * This function takes a TRANSACTION HANDLE, never a pool, and the importer calls
 * it inside its existing `sql.begin(...)` — between the upsert phase and the
 * `data_issues` refiling. It therefore sees the same uncommitted state the
 * importer just wrote, and a throw from here rolls the importer's whole run back
 * untouched: the batch row, the upserts, the retirement DELETE and the refiling
 * with it. Gate G-5 is that property, tested in
 * `tests/integration/first-kick-goal-reload-links.test.ts`.
 *
 * READ-ONLY AGAINST `data_overrides`, and this is a privilege contract, not a
 * preference. Migration 073 grants `afldb_import` SELECT and nothing else here,
 * with its own comment: "SELECT only: data_overrides is not importer-owned and
 * must not enter afldb_meta.import_writable_tables" (073:29-38). Every one of
 * `common.py`'s twenty-plus override references is a read, and so is every one
 * here. The `lifecycle` warn-and-retain branch least of all writes: NOT
 * discarding the override is its entire purpose.
 *
 * A NAME COLLISION THIS FILE MUST NOT BE CAUGHT BY (AFLDB-ISSUE-167 §21.8).
 * `import-first-kick-goal.ts:930` aliases `link_status_value::text AS status`
 * into its `OwnedRow` type. That alias is TypeScript-local, predates migration
 * 102's `status` column and is unrelated to it. The lifecycle `status` this
 * adapter reads and writes is ALWAYS the migration 102 column, read straight off
 * the table and never through that type.
 */
import type { TransactionSql } from 'postgres';

import {
  SPECIAL_RECORD_TABLES,
  type SpecialRecordTable,
} from '../../src/lib/special-records/identity';

/**
 * Raised when a durable decision cannot be replayed. Every one of these is a
 * FAIL-CLOSED case from AFLDB-ISSUE-167 §8.4: the run stops rather than
 * silently reverting, discarding or guessing at a human decision. Thrown inside
 * the caller's transaction, so nothing it has written survives.
 */
export class SpecialRecordReplayAbort extends Error {}

/** The three groups, and the three genuinely different replay semantics (§5.2). */
export const SPECIAL_RECORD_FIELD_GROUPS = ['lifecycle', 'correction', 'record'] as const;

/** Migration 102's CHECK, restated so a bad payload is refused before it is written. */
export const SPECIAL_RECORD_STATUSES = ['active', 'void'] as const;

/**
 * One amendable column, as the replay reads it out of the jsonb payload.
 *
 * `amendable` is AFLDB-ISSUE-167 §3.4's classification and nothing wider. The
 * identity columns (`source_id`, `source_record_id`, `achievement_type`), the
 * link columns (`player_id`, `club_id`, `match_id`) and the derived columns
 * (`link_status_value`, `candidate_count`, the provenance quartet) are all
 * absent by design: §3.4.1 proved all three of the apparently-manual ones are
 * genuinely derived, which is why P4 is a designed correction surface and not a
 * generic field editor.
 */
type ColumnSpec = {
  column: string;
  /** The PostgreSQL cast the jsonb text needs. Empty for text columns. */
  cast: string;
  /** NOT NULL with no default: a `record` payload that omits it cannot be reconstructed. */
  required?: true;
  /** NOT NULL WITH a default: supplied when the payload omits it, so a partial record still inserts. */
  fallback?: string;
};

const COLUMNS: Readonly<Record<SpecialRecordTable, readonly ColumnSpec[]>> = {
  // Migration 053.
  player_achievements: [
    { column: 'player_name_raw', cast: '', required: true },
    { column: 'player_name_clean', cast: '', required: true },
    { column: 'club_name_raw', cast: '', required: true },
    { column: 'season', cast: '::smallint', required: true },
    { column: 'round_raw', cast: '', required: true },
    { column: 'season_footnote_raw', cast: '' },
    { column: 'source_annotation', cast: '' },
    { column: 'notes', cast: '' },
    { column: 'consecutive_goal_kicks', cast: '::smallint', fallback: '1' },
    { column: 'no_further_career_goals', cast: '::boolean', fallback: 'false' },
    { column: 'no_further_career_kicks', cast: '::boolean', fallback: 'false' },
    { column: 'kickless_matches_before_first_kick', cast: '::smallint', fallback: '0' },
  ],
  // Migration 089. Four CHECKs couple these columns; a payload that breaks one
  // is refused BY THE DATABASE inside the caller's transaction, which is the
  // same fail-closed outcome by a different route.
  after_siren_kicks: [
    { column: 'player_name_raw', cast: '', required: true },
    { column: 'player_name_clean', cast: '', required: true },
    { column: 'club_name_raw', cast: '', required: true },
    { column: 'opponent_name_raw', cast: '', required: true },
    { column: 'competition', cast: '', required: true },
    { column: 'premiership_season', cast: '::boolean', required: true },
    { column: 'season', cast: '::smallint', required: true },
    { column: 'round_raw', cast: '', required: true },
    { column: 'kick_scored', cast: '::after_siren_score', required: true },
    { column: 'kick_effect', cast: '::after_siren_effect', required: true },
    { column: 'kicker_result', cast: '::after_siren_result', required: true },
    { column: 'kicker_score_raw', cast: '', required: true },
    { column: 'opponent_score_raw', cast: '', required: true },
    { column: 'kicker_points', cast: '::smallint', required: true },
    { column: 'opponent_points', cast: '::smallint', required: true },
    { column: 'siren', cast: '::after_siren_siren', fallback: "'final'::after_siren_siren" },
    { column: 'supergoal_scoring', cast: '::boolean', fallback: 'false' },
    { column: 'cited', cast: '::boolean', fallback: 'true' },
    { column: 'shot_detail', cast: '' },
    { column: 'source_annotation', cast: '' },
    { column: 'notes', cast: '' },
  ],
};

/** Columns the `record` INSERT must set that are not amendable payload fields. */
const RECORD_FIXED: Readonly<Record<SpecialRecordTable, readonly { column: string; expr: string }[]>> = {
  player_achievements: [
    { column: 'achievement_type', expr: "'first_kick_goal'::player_achievement_type" },
  ],
  after_siren_kicks: [],
};

export type ReplayOptions = {
  /**
   * Where a warn-and-retain notice goes. Defaults to stdout, in the SAME
   * wording `common.py:_warn_retained_lifecycle` prints, so an operator reading
   * either importer's log sees one message and the parity suite can assert one
   * shape.
   */
  warn?: (message: string) => void;
};

export type ReplayCounts = {
  recreated: number;
  restored: number;
  corrected: number;
  lifecycle: number;
  retained: string[];
};

/**
 * The owning importer's transaction handle. `Pick<…, 'unsafe'>` rather than the
 * whole `TransactionSql`, so the only thing this adapter can do with the
 * caller's transaction is run a statement on it — it cannot commit, roll back,
 * or open a nested one.
 */
type TxHandle = Pick<TransactionSql, 'unsafe'>;

/**
 * One statement on the caller's transaction.
 *
 * The cast is here, once, and it is the only one in the file: postgres.js types
 * `unsafe`'s parameters as `ParameterOrJSON<never>[]`, which no ordinary
 * `unknown[]` satisfies, and its result as a `PendingQuery` carrying both the
 * rows and the `count` a non-returning statement reports. Both are true at run
 * time; neither is expressible without help.
 */
async function run<T>(
  tx: TxHandle, query: string, parameters: unknown[] = [],
): Promise<T[] & { count: number }> {
  return await tx.unsafe(query, parameters as never[]) as unknown as T[] & { count: number };
}

/**
 * The decoding CTE. Everything the five statements below need, computed once
 * and identically, so a validation branch and the write it guards can never
 * disagree about which row an override names.
 *
 * THE PARSE RULE IS FIRST-COLON, matching `src/lib/special-records/identity.ts`
 * and `common.py`'s `split_part(entity_key, ':', 1)` /
 * `substring(... from position(':' in ...) + 1)` pair exactly. It is what lets a
 * minted manual id carry its own family prefix (`first_kick_goal:<uuid>`)
 * without a second separator.
 */
function decodeCte(table: SpecialRecordTable): string {
  return `
    raw AS (
      SELECT o.entity_key, o.field_group, o.override_values AS v,
             split_part(o.entity_key, ':', 1) AS source_key,
             CASE WHEN position(':' in o.entity_key) = 0 THEN NULL
                  ELSE substring(o.entity_key from position(':' in o.entity_key) + 1)
             END AS record_id
        FROM data_overrides o
       WHERE o.entity_type = '${table}' AND o.is_active = true
    ),
    decoded AS (
      SELECT r.entity_key, r.field_group, r.v, r.source_key, r.record_id,
             s.id AS source_id,
             r.v->>'player_identity' AS identity,
             r.v->>'match_key'       AS match_key,
             (SELECT count(*) FROM raw r2 WHERE r2.entity_key = r.entity_key) AS key_overrides,
             (SELECT count(*) FROM raw r2
               WHERE r2.entity_key = r.entity_key AND r2.field_group = 'record') AS record_overrides
        FROM raw r
        LEFT JOIN sources s ON s.key = r.source_key
    ),
    target AS (
      SELECT d.*,
             (SELECT count(*) FROM ${table} x
               WHERE x.source_id = d.source_id AND x.source_record_id = d.record_id) AS row_matches,
             (SELECT min(x.id) FROM ${table} x
               WHERE x.source_id = d.source_id AND x.source_record_id = d.record_id) AS row_id,
             (SELECT count(DISTINCT ei.player_id)
                FROM external_identities ei JOIN sources ps ON ps.id = ei.source_id
               WHERE ei.status IN ('unique', 'resolved') AND ei.player_id IS NOT NULL
                 AND d.identity IS NOT NULL
                 AND ps.key = split_part(d.identity, ':', 1)
                 AND ei.external_id = substring(d.identity from position(':' in d.identity) + 1)
             ) AS identity_matches,
             (SELECT min(ei.player_id)
                FROM external_identities ei JOIN sources ps ON ps.id = ei.source_id
               WHERE ei.status IN ('unique', 'resolved') AND ei.player_id IS NOT NULL
                 AND d.identity IS NOT NULL
                 AND ps.key = split_part(d.identity, ':', 1)
                 AND ei.external_id = substring(d.identity from position(':' in d.identity) + 1)
             ) AS resolved_player_id,
             (SELECT count(*) FROM matches m
               WHERE d.match_key IS NOT NULL AND m.match_key = d.match_key) AS match_matches,
             (SELECT min(m.id) FROM matches m
               WHERE d.match_key IS NOT NULL AND m.match_key = d.match_key) AS resolved_match_id
        FROM decoded d
    )`;
}

/** `(t.v->>'col')::cast`, or the column's default when the payload omits it. */
function payloadExpr(spec: ColumnSpec): string {
  const read = `(t.v->>'${spec.column}')${spec.cast}`;
  return spec.fallback ? `COALESCE(${read}, ${spec.fallback})` : read;
}

/** A correction DELTA: key presence is the semantics (migration 086 discipline). */
function deltaExpr(spec: ColumnSpec): string {
  return `CASE WHEN jsonb_exists(t.v, '${spec.column}') THEN ${payloadExpr(spec)} ELSE x.${spec.column} END`;
}

/**
 * Replay the durable admin overrides for one special-record table.
 *
 * @param tx    the OWNING importer's transaction handle — never a pool. Atomicity
 *              is the contract (D-3), so there is deliberately no overload that
 *              opens its own transaction.
 */
export async function replaySpecialRecordOverrides(
  tx: TxHandle,
  table: SpecialRecordTable,
  options: ReplayOptions = {},
): Promise<ReplayCounts> {
  if (!SPECIAL_RECORD_TABLES.includes(table)) {
    // The table name is interpolated into SQL below, so the allowlist is a
    // safety boundary and not merely a typo check.
    throw new SpecialRecordReplayAbort(
      `replaySpecialRecordOverrides: ${JSON.stringify(table)} is not a special-record table. `
      + `P4 covers ${SPECIAL_RECORD_TABLES.join(' and ')} only (D-1, 2026-09-13).`,
    );
  }
  const warn = options.warn ?? ((message: string) => { console.log(message); });
  const specs = COLUMNS[table];
  const required = specs.filter((s) => s.required).map((s) => s.column);
  const cte = decodeCte(table);

  // ---- 1. Refuse the whole run before writing anything --------------------
  // One report, in the common.py:1116-1120 shape: every unresolvable override
  // named, bounded at ten so a wholesale mismatch cannot bury the console.
  const problems = await run<{ entity_key: string; problem: string | null }>(tx, `
    WITH ${cte}
    SELECT t.entity_key,
           CASE
             WHEN position(':' in t.entity_key) = 0 OR length(t.source_key) = 0
               THEN 'entity_key is not ''<source key>:<source record id>'''
             WHEN t.record_id IS NULL OR length(t.record_id) = 0
               THEN 'entity_key carries no source record id'
             WHEN t.source_id IS NULL
               THEN 'entity_key names no source in this database'
             WHEN NOT (t.field_group = ANY($1))
               THEN 'unknown field_group'
             -- A 'record' override owns the WHOLE durable row, its status
             -- included, so a second authority over the same row makes the
             -- outcome order-dependent. 'correction' + 'lifecycle' is NOT a
             -- collision: they own disjoint fields and replay in a defined
             -- order. AFLDB-ISSUE-155 Phase E §12: fail closed.
             WHEN t.record_overrides > 0 AND t.key_overrides > 1
               THEN 'more than one active override resolves to this row'
             WHEN t.row_matches > 1
               THEN 'more than one row carries this source record id'
             WHEN t.field_group <> 'correction'
                   AND (t.v->>'status' IS NULL OR NOT (t.v->>'status' = ANY($2)))
               THEN 'payload carries no valid status'
             WHEN t.field_group <> 'correction'
                   AND t.v->>'status' = 'void'
                   AND COALESCE(t.v->>'status_reason', '') = ''
               THEN 'a void row needs a status_reason'
             WHEN t.field_group = 'correction' AND t.row_id IS NULL
               THEN 'correction target row does not exist'
             WHEN t.field_group = 'record' AND t.row_id IS NULL
                   AND EXISTS (SELECT 1 FROM unnest($3::text[]) k WHERE t.v->>k IS NULL)
               THEN 'record payload is missing a required field'
             WHEN t.field_group = 'record' AND t.identity IS NOT NULL AND t.identity_matches <> 1
               THEN 'player_identity does not resolve to exactly one player'
             WHEN t.field_group = 'record' AND t.match_key IS NOT NULL AND t.match_matches <> 1
               THEN 'match_key does not resolve to exactly one match'
           END AS problem
      FROM target t
     ORDER BY t.entity_key, t.field_group`,
  [[...SPECIAL_RECORD_FIELD_GROUPS], [...SPECIAL_RECORD_STATUSES], required]);

  const unresolvable = problems.filter((row) => row.problem !== null);
  if (unresolvable.length > 0) {
    throw new SpecialRecordReplayAbort(
      `replay_admin_overrides(${table}): refusing to commit, ${unresolvable.length} `
      + 'override(s) do not resolve: '
      + unresolvable.slice(0, 10).map((row) => `${row.entity_key} -- ${row.problem}`).join('; '),
    );
  }

  // ---- 2. Lifecycle over an absent row: WARN AND RETAIN -------------------
  // §8.4. A source manifest that stopped carrying a row is not a reason to
  // discard the human decision that the row was wrong, and the override is the
  // only place that decision lives. Reported loudly, by key, and left alone to
  // be re-applied by the next run that does find its row.
  const retainedRows = await run<{ entity_key: string }>(tx, `
    WITH ${cte}
    SELECT t.entity_key FROM target t
     WHERE t.field_group = 'lifecycle' AND t.row_id IS NULL
     ORDER BY t.entity_key`);
  const retained = retainedRows.map((row) => row.entity_key);
  for (const key of retained) {
    warn(
      `    WARNING: replay_admin_overrides(${table}): lifecycle override `
      + `'${key}' names no row in this database; the override is RETAINED, `
      + 'not discarded (AFLDB-ISSUE-165 D-9)',
    );
  }

  // ---- 3. Re-create the manual rows a destructive rebuild removed ---------
  // source_id and source_record_id come from the KEY, never from the payload:
  // the key is what binds the decision to a row, so a payload cannot move one.
  const insertColumns = [
    ...specs.map((s) => s.column),
    'status', 'status_reason',
    ...RECORD_FIXED[table].map((f) => f.column),
    'source_id', 'source_record_id', 'player_id', 'link_status_value', 'match_id',
  ];
  const insertValues = [
    ...specs.map(payloadExpr),
    "t.v->>'status'", "t.v->>'status_reason'",
    ...RECORD_FIXED[table].map((f) => f.expr),
    't.source_id', 't.record_id', 't.resolved_player_id',
    "(CASE WHEN t.resolved_player_id IS NOT NULL THEN 'resolved' ELSE 'unmatched' END)::link_status",
    't.resolved_match_id',
  ];
  const recreated = await run(tx, `
    WITH ${cte}
    INSERT INTO ${table} (${insertColumns.join(', ')})
    SELECT ${insertValues.join(', ')}
      FROM target t
     WHERE t.field_group = 'record' AND t.row_id IS NULL`);

  // ---- 4. Restore a manual row's whole payload ----------------------------
  // Link columns are deliberately NOT restored here: linkage is
  // /admin/player-links' business (D-2), and a replay that insisted on the
  // original link state would fail closed on an ordinary, correct
  // administrative action.
  const restored = await run(tx, `
    WITH ${cte}
    UPDATE ${table} x
       SET ${specs.map((s) => `${s.column} = ${payloadExpr(s)}`).join(', ')},
           status = t.v->>'status', status_reason = t.v->>'status_reason',
           updated_at = now()
      FROM target t
     WHERE t.field_group = 'record' AND x.id = t.row_id
       AND (${specs.map((s) => `x.${s.column}`).join(', ')}, x.status, x.status_reason)
           IS DISTINCT FROM
           (${specs.map(payloadExpr).join(', ')}, t.v->>'status', t.v->>'status_reason')`);

  // ---- 5. The correction DELTA over a source-owned row --------------------
  const corrected = await run(tx, `
    WITH ${cte}
    UPDATE ${table} x
       SET ${specs.map((s) => `${s.column} = ${deltaExpr(s)}`).join(', ')},
           updated_at = now()
      FROM target t
     WHERE t.field_group = 'correction' AND x.id = t.row_id
       AND (${specs.map((s) => `x.${s.column}`).join(', ')})
           IS DISTINCT FROM (${specs.map(deltaExpr).join(', ')})`);

  // ---- 6. The lifecycle decision, last and unconditional ------------------
  // Guarded by IS DISTINCT FROM for one reason that matters: on an ORDINARY
  // reload the lifecycle columns already carry this decision (they are Layer 1
  // and no importer writes them), so an unguarded UPDATE would bump updated_at
  // on every override-bearing row on every run and invalidate a concurrent
  // administrator's compare-and-swap for no actual change. Same discipline
  // after_siren.py:586-588 already applies to its own upsert.
  const lifecycle = await run(tx, `
    WITH ${cte}
    UPDATE ${table} x
       SET status = t.v->>'status', status_reason = t.v->>'status_reason',
           updated_at = now()
      FROM target t
     WHERE t.field_group = 'lifecycle' AND x.id = t.row_id
       AND (x.status, x.status_reason)
           IS DISTINCT FROM (t.v->>'status', t.v->>'status_reason')`);

  return {
    recreated: recreated.count,
    restored: restored.count,
    corrected: corrected.count,
    lifecycle: lifecycle.count,
    retained,
  };
}

/**
 * The keys of every row an importer is about to DELETE that carries a durable
 * decision it must not destroy.
 *
 * §8.1/§8.2: deleting such a row would destroy the row and leave the override
 * orphaned, and the warn-and-retain branch could not restore it, because a
 * SOURCE-OWNED row is not re-creatable from a lifecycle payload. So the importer
 * refuses the whole run instead — a third refusal class beside
 * `--accept-retirement` and `--allow-link-loss`, raised BEFORE anything in the
 * owned scope is written.
 *
 * `record` is deliberately not consulted: a `record` override names a
 * `manual_admin_edit` row, which carries a different `source_id` and so falls
 * outside every source-owned retirement scope in the first place.
 */
export async function findProtectedRecordKeys(
  tx: TxHandle,
  table: SpecialRecordTable,
  entityKeys: string[],
): Promise<{ entityKey: string; fieldGroup: string; status: string | null }[]> {
  if (entityKeys.length === 0) return [];
  // The keys are MINTED BY THE CALLER through
  // `src/lib/special-records/identity.ts`'s `specialRecordEntityKey()`, and
  // matched here whole. Re-deriving them from a source key and a record id in
  // SQL would be a second implementation of the grammar, free to drift from the
  // one the admin writer mints with — so this compares the minted string
  // against the stored one and nothing else.
  return run<{ entityKey: string; fieldGroup: string; status: string | null }>(tx, `
    SELECT o.entity_key AS "entityKey",
           o.field_group AS "fieldGroup",
           o.override_values->>'status' AS status
      FROM data_overrides o
     WHERE o.entity_type = $1
       AND o.is_active = true
       AND o.field_group IN ('lifecycle', 'correction')
       AND o.entity_key = ANY($2)
     ORDER BY 1`, [table, entityKeys]);
}
