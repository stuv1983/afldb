/**
 * AFLDB-ISSUE-228 S6-D2 — the `afl_api` provider-player -> canonical PLAYER
 * resolver (§6.3). Read-only: this module never inserts, updates or deletes
 * anything; the trusted bridge itself is written exclusively by
 * `tools/migration/import_afl_api_player_bridge.py` (S5).
 *
 * The lookup is exactly §6.3's normal-ingestion rule, generalised only to a
 * single on-demand call instead of the settle's one-time `loadRefs()` bulk
 * load into `refs.playerIdsByProviderId`:
 *
 *   `external_identities WHERE source_id = <afl_api> AND external_id = <CD_I…>
 *    AND status IN ('unique', 'resolved') AND player_id IS NOT NULL`
 *
 * A hit is the trusted canonical player. No hit is `unresolved` — never a
 * guess, never a fallback to name, jumper number, club/team, match
 * participation, statistics, or an AFL Tables profile URL. `status =
 * 'unique'` is what the S5 bootstrap writes; `status = 'resolved'` is
 * reserved for a human decision (§6.3) and is trusted identically. The
 * bridge's `match_method` (`afl_api_stat_vector_bootstrap` for a bootstrap
 * write) is deliberately not filtered on here — §6.3's quoted rule does not
 * condition on it, and a future human-reviewed link may carry a different
 * one while remaining equally trusted.
 *
 * `player_identity_ambiguous` is a defensive addition beyond the literal
 * §6.3 text, in the same spirit as `afl-api-match-resolver.ts`'s
 * `provider_id_ambiguous`: `external_identities_uq` (migration 002)
 * constrains `(source_id, external_id)` to at most one row, so this branch
 * should never occur under correct writes. Fail-closed, not silently
 * picking either row.
 *
 * AFLDB-ISSUE-235 (2026-09-23): `status = 'resolved'` may now also be a
 * human admin adjudication (`match_method = 'afl_api_admin_adjudication'`,
 * written through `/admin/player-links/afl-api`), not only the pre-existing
 * reserved-but-unused meaning this comment already described. No logic
 * here changes: both statuses remain trusted identically, exactly as
 * written above, and `match_method` is still deliberately unfiltered.
 */
import type postgres from 'postgres';

type Sql = postgres.Sql | postgres.TransactionSql;

export type AflApiPlayerResolution =
  | { outcome: 'resolved'; playerId: number }
  | { outcome: 'unresolved' }
  | { outcome: 'refused'; reason: 'player_identity_ambiguous'; candidateIds: readonly number[] };

type LinkRow = { playerId: number };

/**
 * Resolve one AFL.com.au provider player id (`CD_I…`) to an existing
 * canonical `players` row through the trusted `afl_api` bridge (§6.3, S5).
 * Never creates, never mutates, never writes.
 *
 * `sourceId` is `sources.id` for the `afl_api` row — caller-resolved, in the
 * same convention `afl-api-match-resolver.ts`'s `AflApiMatchIdentity.sourceId`
 * uses.
 */
export async function resolveAflApiPlayer(
  sql: Sql,
  sourceId: number,
  providerId: string,
): Promise<AflApiPlayerResolution> {
  const rows = await sql<LinkRow[]>`
    SELECT player_id AS "playerId"
      FROM external_identities
     WHERE source_id = ${sourceId}
       AND external_id = ${providerId}
       AND status IN ('unique', 'resolved')
       AND player_id IS NOT NULL
  `;

  if (rows.length > 1) {
    return {
      outcome: 'refused',
      reason: 'player_identity_ambiguous',
      candidateIds: rows.map((row) => row.playerId),
    };
  }

  if (rows.length === 1) {
    return { outcome: 'resolved', playerId: rows[0].playerId };
  }

  return { outcome: 'unresolved' };
}
