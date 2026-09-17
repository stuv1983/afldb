/**
 * AFLDB-ISSUE-131 — proving that an upstream rekey is the SAME real-world match.
 *
 * `match_key` is `season|round_code|match_date|home|away`
 * (`tools/migration/import_fitzroy_core.py:1615`), and the identical five-part
 * string is also the match family's `external_record_id` (`:1221-1224`). It is
 * therefore a content address over mutable scheduling metadata, and it is the
 * only handle either side of the pipeline holds: `reconcile()` keys on the
 * source id, the applier keys on the canonical one, and when the upstream
 * source revises a round or a date BOTH move together. The reconciler then
 * sees a record it has never observed, the applier sees a canonical row that
 * does not exist, and a second canonical row is inserted for a fixture that
 * already had one.
 *
 * This module answers the one question neither of them can ask: **is there
 * exactly one existing canonical row that this record is a renaming of?**
 *
 * Four rules, all of them narrowing (runbook §5.3):
 *
 *   1. **Deterministic evidence only.** No fuzzy matching, no scoring, no
 *      nearest neighbour. Season and BOTH club ids must agree exactly, and at
 *      most one of `round_code` / `match_date` may differ. Two clubs can meet
 *      twice in a season, so that budget is what keeps the candidate set at
 *      one; a club that differs is never a rekey, it is a different fixture.
 *   2. **The old identity must be provably retired.** A candidate's
 *      `source_record_id` must resolve to a spine record of this family whose
 *      scope THIS run proved complete, and that record must be absent from
 *      what this run published. Anything less is silence, and §19's rule that
 *      silence is never absence holds here exactly as it does for the sweep.
 *      It is also what keeps the search honest across scopes: a canonical row
 *      whose scope this run did not enumerate is never a candidate.
 *   3. **Ownership is not adopted.** Only a row already owned by the promoting
 *      source is a candidate. A source-less row, a foreign-owned row, and a
 *      historical row whose `source_record_id` is an AFL Tables game id rather
 *      than a spine record id (§3.6) all fall out of the JOIN.
 *   4. **Ambiguity refuses.** The caller decides, but this module never
 *      collapses two candidates into one.
 */
import type postgres from 'postgres';

type Sql = postgres.Sql | postgres.TransactionSql;

/**
 * What this run still publishes, and where it may conclude anything from
 * absence. Built once per run from the bundle, never from the database.
 */
export type MatchRekeyScope = {
  /** Scope keys this run proved COMPLETE for the match family (§19). */
  readonly completeScopeKeys: readonly string[];
  /** Every match-family `external_record_id` this run's bundle carries. */
  readonly publishedRecordIds: readonly string[];
};

/** The scope that proves nothing, which is what a non-settle caller gets. */
export const NO_MATCH_REKEY_SCOPE: MatchRekeyScope = {
  completeScopeKeys: [],
  publishedRecordIds: [],
};

/**
 * HOW the old identity is proven retired. Two callers, two proofs, ONE
 * identity rule — the club/season/one-component predicate below is shared, so
 * this repository does not grow a second, weaker notion of "the same match".
 *
 *   - `run_enumeration` — the SETTLE, mid-run. The sweep has not stamped
 *     anything yet, so the proof is the bundle: a scope this run proved
 *     complete, and a record absent from what it published.
 *   - `absent_observation` — the §8 REPAIR tool, outside any run. The sweep
 *     has already stamped `staging.source_records.absent_since`, which is the
 *     durable record that the source stopped publishing that identity, and it
 *     was only ever written inside a proven-complete enumeration (§19). The
 *     tool reads that conclusion rather than re-deriving it.
 */
export type MatchRetirementEvidence =
  | { kind: 'run_enumeration'; scope: MatchRekeyScope }
  | { kind: 'absent_observation' };

/** The incoming record's fixture identity, as the proposal resolved it. */
export type MatchRekeyIdentity = {
  season: number;
  sourceId: number;
  /** The contract family, as `staging.source_records.family` stores it. */
  family: string;
  /** The INCOMING rendering. A candidate never carries it. */
  matchKey: string;
  roundCode: string;
  /** ISO `YYYY-MM-DD`, exactly as the proposal renders `match_date`. */
  matchDate: string;
  homeClubId: number;
  awayClubId: number;
};

export type RetiredMatchIdentity = {
  id: number;
  matchKey: string;
  sourceRecordId: string;
};

/**
 * Every canonical row that is provably the same fixture under a source
 * identity this run no longer publishes. Zero, one or many — the caller
 * refuses on many and never merges.
 *
 * `lock` takes `FOR UPDATE` on the candidate rows so two concurrent settles
 * cannot both claim one. It is taken inside the applier's savepoint only; the
 * pre-savepoint pass reads without it, exactly as the rest of that pass does,
 * and every answer is re-derived under the lock before anything is written.
 *
 * Both callers run this on a canonical lookup HIT as well as a miss. §5.3's
 * would-merge clause is a statement about a fixture that already holds two
 * canonical rows, which is only ever reachable on a hit, so a search confined
 * to misses could never see it and the ordinary update would write into one
 * half of the duplicate pair.
 */
export async function findRetiredMatchIdentities(
  sql: Sql, identity: MatchRekeyIdentity, evidence: MatchRetirementEvidence, lock = false,
): Promise<RetiredMatchIdentity[]> {
  // Nothing was proven complete, so nothing can be proven retired.
  if (evidence.kind === 'run_enumeration' && evidence.scope.completeScopeKeys.length === 0) {
    return [];
  }
  if (!identity.matchKey || !identity.roundCode || !identity.matchDate) return [];
  const retired = evidence.kind === 'absent_observation'
    ? sql`r.absent_since IS NOT NULL`
    // `<> ALL (empty)` is true of every row, which is the correct reading of a
    // complete enumeration that published nothing at all.
    : sql`r.scope_key = ANY (${[...evidence.scope.completeScopeKeys]})
      AND r.external_record_id <> ALL (${[...evidence.scope.publishedRecordIds]})`;
  const rows = await sql<RetiredMatchIdentity[]>`
    SELECT m.id::int AS id,
           m.match_key AS "matchKey",
           m.source_record_id AS "sourceRecordId"
      FROM matches m
      JOIN staging.source_records r
        ON r.source_id = ${identity.sourceId}
       AND r.family = ${identity.family}
       AND r.external_record_id = m.source_record_id
     WHERE m.season = ${identity.season}
       AND m.source_id = ${identity.sourceId}
       AND m.home_club_id = ${identity.homeClubId}
       AND m.away_club_id = ${identity.awayClubId}
       AND m.match_key <> ${identity.matchKey}
       AND ${retired}
       AND ((m.round_code IS DISTINCT FROM ${identity.roundCode})::int
          + (m.match_date IS DISTINCT FROM ${identity.matchDate}::date)::int) <= 1
     ORDER BY m.id
     ${lock ? sql`FOR UPDATE OF m` : sql``}
  `;
  return [...rows];
}

/* ------------------------------------------------------------------ *
 * Human overrides across a rekey (§5.7)
 * ------------------------------------------------------------------ */

/**
 * `data_overrides.entity_key` for a match IS the `match_key`
 * (`manual-authority.ts:153-156`, `073_data_overrides.sql:21`), so migration
 * 073's claim that an override survives a rekey is FALSE for exactly this
 * class of rekey: the natural key is the thing that moved. Left alone, a rekey
 * silently orphans every active human decision on that match, and the next
 * settle then overwrites a field a human deliberately pinned.
 *
 * So the override moves with the match, inside the same savepoint as the
 * canonical write:
 *
 *   - the new key already holds an ACTIVE row for the same `field_group` —
 *     two live human decisions for one fixture. **Refuse.** Nothing is merged,
 *     nothing is overwritten, and a human resolves it.
 *   - the new key holds an INACTIVE row for that group — the same decision,
 *     retired at that rendering (a rekey and back does exactly this). It is
 *     UPDATED to the carried values and reactivated.
 *   - otherwise the row is INSERTED at the new key.
 *
 * The old row is then deactivated, never deleted: `afldb_import` holds no
 * DELETE on `data_overrides` (migration 078 grants INSERT and a four-column
 * UPDATE and nothing else), obligation O1 forbids it anyway, and a retired
 * human decision is history worth keeping.
 */
export type MatchOverrideCarry = { carried: number } | { conflict: readonly string[] };

export async function carryMatchOverrides(
  sql: Sql, previousMatchKey: string, matchKey: string,
): Promise<MatchOverrideCarry> {
  type OverrideRow = {
    id: string; fieldGroup: string; overrideValues: unknown; adminUserId: number;
  };
  const active = await sql<OverrideRow[]>`
    SELECT id::text AS id, field_group AS "fieldGroup",
           override_values AS "overrideValues", admin_user_id::int AS "adminUserId"
      FROM data_overrides
     WHERE entity_type = 'matches' AND entity_key = ${previousMatchKey} AND is_active
     ORDER BY field_group
  `;
  if (active.length === 0) return { carried: 0 };

  const existing = await sql<{ id: string; fieldGroup: string; isActive: boolean }[]>`
    SELECT id::text AS id, field_group AS "fieldGroup", is_active AS "isActive"
      FROM data_overrides
     WHERE entity_type = 'matches' AND entity_key = ${matchKey}
  `;
  const atTarget = new Map(existing.map((row) => [row.fieldGroup, row]));

  const conflict = active
    .filter((row) => atTarget.get(row.fieldGroup)?.isActive === true)
    .map((row) => row.fieldGroup);
  if (conflict.length > 0) return { conflict };

  for (const row of active) {
    const retired = atTarget.get(row.fieldGroup);
    if (retired === undefined) {
      await sql`
        INSERT INTO data_overrides (
          entity_type, entity_key, field_group, override_values,
          admin_user_id, is_active, updated_at
        ) VALUES (
          'matches', ${matchKey}, ${row.fieldGroup},
          ${sql.json(row.overrideValues as never)}, ${row.adminUserId}, true, now()
        )
      `;
    } else {
      await sql`
        UPDATE data_overrides
           SET override_values = ${sql.json(row.overrideValues as never)},
               admin_user_id = ${row.adminUserId}, is_active = true, updated_at = now()
         WHERE id = ${retired.id}::bigint
      `;
    }
    await sql`
      UPDATE data_overrides SET is_active = false, updated_at = now()
       WHERE id = ${row.id}::bigint
    `;
  }
  return { carried: active.length };
}
