/**
 * AFLDB-ISSUE-235 (OD-3, OD-5, D15) — the `afl_api` human identity replay
 * adapter, run at "Post-promotion state" step 1 immediately after
 * `replay_admin_overrides('players')`, and by `db:test:rebuild`'s
 * reinstate/replay data stage.
 *
 * CHOSEN OVER A PYTHON `common.py` ADDITION (S4b; the choice this issue's §9
 * asks to be disclosed). D15's decision logic — `planAflApiAdjudicationReplay`,
 * the stored-identity assertion, `checkAflApiAdjudicationBijection` — is
 * already pure TypeScript in `src/lib/acquisition/afl-api-adjudication.ts`,
 * the same module the admin surface and its query module both depend on.
 * Porting it to Python merely to share `common.py` would be exactly the
 * `tools/records/special-records-replay.ts` precedent's own refused move
 * (its header names AFLDB-ISSUE-167 Decision D-3: "porting the first-kick
 * importer to Python merely to share common.py" was refused), just mirrored
 * in the other direction. `docs/production-promotion.md`'s
 * "Post-promotion state" step already runs that TypeScript adapter from a
 * small `npx tsx` script beside the Python `replay_admin_overrides()` loop
 * for exactly this reason (two adapters, one authority) — this file follows
 * the identical shape for the `afl_api` ledger.
 *
 * ATOMIC WITH THE CALLER'S TRANSACTION, by construction: every export here
 * takes a `TransactionSql` handle, never a pool, exactly the
 * `special-records-replay.ts` contract.
 *
 * SELF-VERIFYING, not merely trusting an earlier step. D15 point 1 also
 * remaps `afl_api_identity_adjudications.player_id` through the GENERIC
 * per-row lineage remap file (`lineageRemapSql`'s `storedIdentityColumn`
 * extension, promotion-inventory.ts), run earlier at
 * `promotion-reinstate.sh`'s REMAP step. That file can leave a row
 * `-- UNRESOLVED` (no UPDATE) for an operator to resolve by hand, so this
 * adapter does NOT trust the column it finds: `remapLedgerPlayerIds()`
 * below independently re-derives each row's current candidate-database
 * player id from its OWN stored `player_identity`, the same
 * `afltables_profile_url`/`manual_admin_edit` lookup
 * `LINEAGE_IDENTITY_SQL.afltables_profile_url` uses (no new identity
 * mechanism, R8) — so a skipped or stale generic remap is caught here too,
 * never silently trusted.
 */
import type { TransactionSql } from 'postgres';

import {
  AFL_API_ADMIN_MATCH_METHOD,
  checkAflApiAdjudicationBijection,
  planAflApiAdjudicationReplay,
  type AflApiAdjudicationLedgerRow,
  type AflApiCandidateIdentityRow,
  type AflApiPlayerRemapResult,
} from '../../src/lib/acquisition/afl-api-adjudication';

/** Raised when the replay cannot proceed. Thrown inside the caller's transaction, so
 * nothing it has written survives (the `special-records-replay.ts` `SpecialRecordReplayAbort`
 * pattern). */
export class AflApiReplayAbort extends Error {}

export type AflApiReplayCounts = {
  inserted: number;
  noops: number;
  /** Empty on success; a non-empty result is never partially applied (see below). */
  stops: readonly { externalId: string; reason: string }[];
};

async function fetchAflApiSourceId(tx: TransactionSql): Promise<number> {
  const [row] = await tx<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afl_api'`;
  if (!row) throw new AflApiReplayAbort("sources.key = 'afl_api' not found on the candidate database.");
  return row.id;
}

async function readLedgerRows(tx: TransactionSql): Promise<readonly AflApiAdjudicationLedgerRow[]> {
  const rows = await tx<{
    id: number; externalId: string; action: 'linked' | 'revoked'; playerId: number;
    playerIdentity: string; supersedesId: number | null;
  }[]>`
    SELECT id, external_id AS "externalId", action, player_id AS "playerId",
           player_identity AS "playerIdentity", supersedes_id AS "supersedesId"
      FROM afl_api_identity_adjudications
     WHERE source_key = 'afl_api'
     ORDER BY id
  `;
  return rows;
}

/**
 * D15 point 1, for ONE stored `player_identity`: the CURRENT candidate-database player id
 * it names, or why it names none/several. Exactly the existing
 * `afltables_profile_url`/`manual_admin_edit` lineage rule
 * (`promotion-inventory.ts` `LINEAGE_IDENTITY_SQL.afltables_profile_url`); no new
 * identity mechanism. Exported so `db:test:rebuild`'s ledger reinstatement
 * (`rebuild_afl_api_adjudications.ts`, OD-5) remaps `player_id` through this very lookup
 * rather than a second copy of it.
 */
export async function resolveAflApiPlayerIdentity(
  tx: TransactionSql, playerIdentity: string,
): Promise<AflApiPlayerRemapResult> {
  const matches = await tx<{ playerId: number }[]>`
    SELECT DISTINCT ei.player_id AS "playerId"
      FROM external_identities ei
      JOIN sources s ON s.id = ei.source_id
     WHERE ((s.key = 'afltables' AND ei.match_method = 'afltables_profile_url')
            OR (s.key = 'manual_admin_edit' AND ei.match_method = 'manual_admin_edit'))
       AND ei.status IN ('unique', 'resolved')
       AND ei.external_id = ${playerIdentity}
  `;
  if (matches.length === 0) return { ok: false, reason: 'unresolvable' };
  if (matches.length > 1) return { ok: false, reason: 'ambiguous' };
  return { ok: true, newPlayerId: matches[0].playerId, remappedIdentity: playerIdentity };
}

/**
 * D15 point 1: for every ledger row, resolve its `player_identity` to a CURRENT
 * candidate-database player id, independently of whatever the row's own (possibly
 * unremapped, possibly stale) `player_id` column holds.
 */
async function remapLedgerPlayerIds(
  tx: TransactionSql, ledgerRows: readonly AflApiAdjudicationLedgerRow[],
): Promise<ReadonlyMap<string, AflApiPlayerRemapResult>> {
  const result = new Map<string, AflApiPlayerRemapResult>();
  for (const row of ledgerRows) {
    result.set(row.externalId, await resolveAflApiPlayerIdentity(tx, row.playerIdentity));
  }
  return result;
}

async function readCandidateAflApiState(tx: TransactionSql, sourceId: number): Promise<{
  candidateByExternalId: ReadonlyMap<string, AflApiCandidateIdentityRow>;
  candidatePlayerAflApiRow: ReadonlyMap<number, AflApiCandidateIdentityRow>;
}> {
  const rows = await tx<{
    externalId: string; status: string; matchMethod: string | null; playerId: number | null;
  }[]>`
    SELECT external_id AS "externalId", status::text AS status, match_method AS "matchMethod",
           player_id AS "playerId"
      FROM external_identities WHERE source_id = ${sourceId}
  `;
  const candidateByExternalId = new Map<string, AflApiCandidateIdentityRow>();
  const candidatePlayerAflApiRow = new Map<number, AflApiCandidateIdentityRow>();
  for (const r of rows) {
    const row: AflApiCandidateIdentityRow = {
      externalId: r.externalId, status: r.status, matchMethod: r.matchMethod, playerId: r.playerId,
    };
    candidateByExternalId.set(r.externalId, row);
    if (r.playerId !== null) candidatePlayerAflApiRow.set(r.playerId, row);
  }
  return { candidateByExternalId, candidatePlayerAflApiRow };
}

/**
 * The whole D15 point-2 replay: reinstated ledger -> remap -> plan -> write. Runs
 * "Post-promotion state" step 1, immediately after `replay_admin_overrides('players')`
 * (`docs/production-promotion.md`), and as `db:test:rebuild`'s post-player-load data
 * stage (OD-5). Never overwrites, never partially applies: any STOP aborts the WHOLE
 * replay (the caller's transaction rolls back everything, including any INSERT this
 * call already issued for an earlier row) rather than leaving some providers linked
 * and others not.
 */
export async function replayAflApiAdjudications(tx: TransactionSql): Promise<AflApiReplayCounts> {
  const sourceId = await fetchAflApiSourceId(tx);
  const ledgerRows = await readLedgerRows(tx);
  if (ledgerRows.length === 0) return { inserted: 0, noops: 0, stops: [] };

  const remapByExternalId = await remapLedgerPlayerIds(tx, ledgerRows);
  const { candidateByExternalId, candidatePlayerAflApiRow } = await readCandidateAflApiState(tx, sourceId);

  const plan = planAflApiAdjudicationReplay({
    ledgerRows, remapByExternalId, candidateByExternalId, candidatePlayerAflApiRow,
  });

  if (plan.stops.length > 0) {
    throw new AflApiReplayAbort(
      `afl_api adjudication replay stopped on ${plan.stops.length} provider id(s), no row written: `
      + plan.stops.map((s) => `${s.externalId} (${s.reason})`).join('; '),
    );
  }

  for (const insert of plan.inserts) {
    await tx`
      INSERT INTO external_identities
            (source_id, external_id, player_id, status, candidate_count, match_method, notes)
      VALUES (${sourceId}, ${insert.externalId}, ${insert.playerId}, 'resolved', 0,
              ${AFL_API_ADMIN_MATCH_METHOD},
              'AFLDB-ISSUE-235 admin adjudication; see afl_api_identity_adjudications')
    `;
  }

  return { inserted: plan.inserts.length, noops: plan.noops.length, stops: [] };
}

/**
 * D15's consistency proof (runbook §10.1 C5), run as the last step of the replay
 * ("the validation stage" for `db:test:rebuild`; the promotion checker for a real
 * promotion). Standalone and read-only: safe to call at any time, independent of
 * whether a replay ran in this same transaction.
 */
export async function assertAflApiAdjudicationBijection(tx: TransactionSql): Promise<void> {
  const sourceId = await fetchAflApiSourceId(tx);
  const ledgerRows = await readLedgerRows(tx);
  const resolvedRows = await tx<{ externalId: string; status: string; matchMethod: string | null }[]>`
    SELECT external_id AS "externalId", status::text AS status, match_method AS "matchMethod"
      FROM external_identities WHERE source_id = ${sourceId} AND status = 'resolved'
  `;
  const mismatches = checkAflApiAdjudicationBijection({ ledgerRows, resolvedRows });
  if (mismatches.length > 0) {
    throw new AflApiReplayAbort(
      `afl_api adjudication bijection check failed (${mismatches.length} mismatch(es)): `
      + mismatches.map((m) => `${m.kind}:${m.externalId}`).join(', '),
    );
  }
}
