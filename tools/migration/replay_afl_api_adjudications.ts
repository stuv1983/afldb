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
  AflApiPromotionFileRefused,
  aflApiImporterStateSha256,
  aflApiLedgerStateSha256,
  aflApiReverseIdentityPaths,
  aflApiSupersedeBindingProblems,
  aflApiSupersedeMismatch,
  censusAflApiRows,
  checkAflApiAdjudicationBijection,
  checkAflApiIdentityInvariant,
  classifyAflApiForwardIdentityRows,
  classifyAflApiReverseIdentity,
  isAflApiImporterMatchMethod,
  parseAflApiSupersedeFile,
  planAflApiAdjudicationReplay,
  planAflApiImporterReplay,
  type AflApiAdjudicationLedgerRow,
  type AflApiCandidateIdentityRow,
  type AflApiCensusRow,
  type AflApiForwardIdentityResult,
  type AflApiImporterCandidateRow,
  type AflApiImporterReplayPlan,
  type AflApiPlayerRemapResult,
  type AflApiSupersedeFile,
  type CapturedImporterRow,
} from '../../src/lib/acquisition/afl-api-adjudication';
import {
  loadFitzroyProfileContinuityRules,
  type ValidatedFitzroyProfileContinuityRules,
} from '../../src/lib/acquisition/fitzroy-profile-continuity';

/** Raised when the replay cannot proceed. Thrown inside the caller's transaction, so
 * nothing it has written survives (the `special-records-replay.ts` `SpecialRecordReplayAbort`
 * pattern). */
export class AflApiReplayAbort extends Error {}

export type AflApiReplayCounts = {
  inserted: number;
  noops: number;
  /** Empty on success; a non-empty result is never partially applied (see below). */
  stops: readonly { externalId: string; reason: string }[];
  /** AFLDB-ISSUE-237 D9/OD-2: providers whose agreeing importer row was superseded -- always
   * `[]` unless the caller passes a non-empty `expectedSupersedes`. */
  supersedes: readonly { externalId: string; playerId: number }[];
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
 *
 * AFLDB-ISSUE-237 continuity amendment (reverse direction): an identity a tracked
 * `profile_url_continuity` rule names resolves only when the target holds BOTH of that rule's
 * paths on the same single player; the path lookup below runs once per path
 * `aflApiReverseIdentityPaths` names (just the identity itself when no rule names it, so an
 * ordinary identity issues exactly the one statement it always did), and the shared
 * `classifyAflApiReverseIdentity` decides — the same classifier the promotion checker's G2
 * reader uses.
 */
export async function resolveAflApiPlayerIdentity(
  tx: TransactionSql, playerIdentity: string,
  continuityRules: ValidatedFitzroyProfileContinuityRules = loadFitzroyProfileContinuityRules(),
): Promise<AflApiPlayerRemapResult> {
  const playerIdsByPath = new Map<string, number[]>();
  for (const path of aflApiReverseIdentityPaths(playerIdentity, continuityRules)) {
    const matches = await tx<{ playerId: number }[]>`
      SELECT DISTINCT ei.player_id AS "playerId"
        FROM external_identities ei
        JOIN sources s ON s.id = ei.source_id
       WHERE ((s.key = 'afltables' AND ei.match_method = 'afltables_profile_url')
              OR (s.key = 'manual_admin_edit' AND ei.match_method = 'manual_admin_edit'))
         AND ei.status IN ('unique', 'resolved')
         AND ei.external_id = ${path}
    `;
    playerIdsByPath.set(path, matches.map((m) => m.playerId));
  }
  return classifyAflApiReverseIdentity({ identity: playerIdentity, playerIdsByPath, continuityRules });
}

/**
 * D15 point 1: for every ledger row, resolve its `player_identity` to a CURRENT
 * candidate-database player id, independently of whatever the row's own (possibly
 * unremapped, possibly stale) `player_id` column holds.
 */
async function remapLedgerPlayerIds(
  tx: TransactionSql, ledgerRows: readonly AflApiAdjudicationLedgerRow[],
): Promise<ReadonlyMap<string, AflApiPlayerRemapResult>> {
  const continuityRules = loadFitzroyProfileContinuityRules();
  const result = new Map<string, AflApiPlayerRemapResult>();
  for (const row of ledgerRows) {
    result.set(row.externalId, await resolveAflApiPlayerIdentity(tx, row.playerIdentity, continuityRules));
  }
  return result;
}

async function readCandidateAflApiState(tx: TransactionSql, sourceId: number): Promise<{
  candidateByExternalId: ReadonlyMap<string, AflApiCandidateIdentityRow>;
  candidatePlayerAflApiRow: ReadonlyMap<number, AflApiCandidateIdentityRow>;
}> {
  const rows = await tx<{
    externalId: string; status: string; matchMethod: string | null; playerId: number | null;
    candidateCount: number; externalUrl: string | null;
  }[]>`
    SELECT external_id AS "externalId", status::text AS status, match_method AS "matchMethod",
           player_id AS "playerId", candidate_count AS "candidateCount", external_url AS "externalUrl"
      FROM external_identities WHERE source_id = ${sourceId}
  `;
  const candidateByExternalId = new Map<string, AflApiCandidateIdentityRow>();
  const candidatePlayerAflApiRow = new Map<number, AflApiCandidateIdentityRow>();
  for (const r of rows) {
    const row: AflApiCandidateIdentityRow = {
      externalId: r.externalId, status: r.status, matchMethod: r.matchMethod, playerId: r.playerId,
      candidateCount: r.candidateCount, externalUrl: r.externalUrl,
    };
    candidateByExternalId.set(r.externalId, row);
    if (r.playerId !== null) candidatePlayerAflApiRow.set(r.playerId, row);
  }
  return { candidateByExternalId, candidatePlayerAflApiRow };
}

/**
 * AFLDB-ISSUE-237 §5/D7 — the forward stable-identity lookup for a SET of players, strict
 * where `LINEAGE_IDENTITY_SQL.afltables_profile_url.byId` (`promotion-inventory.ts`, F9) is
 * lenient: that query's `DISTINCT ON (player_id)` silently picks the AFL Tables path when a
 * player holds two. D7 requires refusing that case instead, so this reads every candidate
 * row per player and classifies client-side rather than letting SQL choose one. The
 * classification is the shared `classifyAflApiForwardIdentityRows` (the promotion checker
 * uses the same one), and its only exception — an exact tracked `profile_url_continuity`
 * pair resolves to the rule's continuing path — comes from the fitzRoy contract, loaded and
 * validated per call so an unreadable or malformed contract refuses the lookup.
 */
export async function readAflApiForwardIdentities(
  tx: TransactionSql, playerIds: readonly number[],
  continuityRules: ValidatedFitzroyProfileContinuityRules = loadFitzroyProfileContinuityRules(),
): Promise<ReadonlyMap<number, AflApiForwardIdentityResult>> {
  if (playerIds.length === 0) return new Map();
  // `tx.array()` of numbers binds as text[] (postgres.js falls back to oid 25), so the cast
  // to the column's own type is required: without it this is `integer = text`.
  const rows = await tx<{ playerId: number; externalId: string; sourceKey: string }[]>`
    SELECT ei.player_id AS "playerId", ei.external_id AS "externalId", s.key AS "sourceKey"
      FROM external_identities ei
      JOIN sources s ON s.id = ei.source_id
     WHERE ((s.key = 'afltables' AND ei.match_method = 'afltables_profile_url')
            OR (s.key = 'manual_admin_edit' AND ei.match_method = 'manual_admin_edit'))
       AND ei.status IN ('unique', 'resolved')
       AND ei.player_id = ANY (${tx.array([...playerIds])}::int[])
  `;
  return classifyAflApiForwardIdentityRows({ playerIds, rows, continuityRules });
}

/**
 * D5 census rows for `source_id = <afl_api>`, plain and unfiltered -- both anomalous and
 * admissible rows come back, so the caller's pure classifier (`censusAflApiRows`) decides.
 */
export async function readAflApiCensusRows(tx: TransactionSql, sourceId: number): Promise<readonly AflApiCensusRow[]> {
  return tx<AflApiCensusRow[]>`
    SELECT external_id AS "externalId", status::text AS status, match_method AS "matchMethod",
           player_id AS "playerId", candidate_count AS "candidateCount", external_url AS "externalUrl"
      FROM external_identities WHERE source_id = ${sourceId}
  `;
}

/**
 * D6/D7's captured importer rows, read live: every `afl_api` row the D5 census classifies as
 * `importer`, each with its OWN forward stable identity (D7's before-destruction check --
 * Stage 2 refuses before calling this if any player fails to resolve). Used by Stage 2's
 * capture and by the OD-4 export (§11a, R3).
 */
export async function readAflApiImporterRows(tx: TransactionSql, sourceId: number): Promise<{
  rows: readonly CapturedImporterRow[];
  identityByPlayerId: ReadonlyMap<number, AflApiForwardIdentityResult>;
  census: readonly AflApiCensusRow[];
}> {
  const census = await readAflApiCensusRows(tx, sourceId);
  const importerRaw = census.filter((r) => r.status === 'unique'
    && isAflApiImporterMatchMethod(r.matchMethod) && r.candidateCount === 1 && r.externalUrl === null
    && r.playerId !== null);
  const playerIds = [...new Set(importerRaw.map((r) => r.playerId as number))];
  const identityByPlayerId = await readAflApiForwardIdentities(tx, playerIds);

  const nameByExternalId = await tx<{ externalId: string; externalName: string | null; notes: string | null }[]>`
    SELECT external_id AS "externalId", external_name AS "externalName", notes
      FROM external_identities WHERE source_id = ${sourceId}
  `;
  const namesByExternalId = new Map(nameByExternalId.map((r) => [r.externalId, r]));

  const rows: CapturedImporterRow[] = [];
  for (const r of importerRaw) {
    const identity = identityByPlayerId.get(r.playerId as number);
    if (!identity || !identity.ok) continue; // caller's D7 refusal check reports this; never captured
    const names = namesByExternalId.get(r.externalId);
    rows.push({
      externalId: r.externalId,
      playerIdentity: identity.identity,
      matchMethod: r.matchMethod as CapturedImporterRow['matchMethod'],
      status: 'unique',
      candidateCount: 1,
      externalName: names?.externalName ?? null,
      externalUrl: null,
      notes: names?.notes ?? null,
      playerId: r.playerId as number,
    });
  }
  return { rows: rows.sort((a, b) => a.externalId.localeCompare(b.externalId)), identityByPlayerId, census };
}

/**
 * D9's importer replay (Stage 18 (a); the OD-4 recovery path, §11a). Never overwrites, never
 * partially applies: any STOP aborts the WHOLE call, exactly `replayAflApiAdjudications`'s own
 * contract.
 */
export async function replayAflApiImporterRows(
  tx: TransactionSql, capturedRows: readonly CapturedImporterRow[],
): Promise<{ inserted: number; noops: number }> {
  if (capturedRows.length === 0) return { inserted: 0, noops: 0 };
  const { sourceId, plan } = await planAflApiImporterRowsLive(tx, capturedRows);

  if (plan.stops.length > 0) {
    throw new AflApiReplayAbort(
      `afl_api importer replay stopped on ${plan.stops.length} provider id(s), no row written: `
      + plan.stops.map((s) => `${s.externalId} (${s.reason})`).join('; '),
    );
  }

  await writeAflApiImporterPlan(tx, sourceId, plan);
  return { inserted: plan.inserts.length, noops: plan.noops.length };
}

/**
 * The read half of `replayAflApiImporterRows`: every captured identity reverse-resolved
 * (`resolveAflApiPlayerIdentity`, continuity reverse check included), the candidate's live
 * `afl_api` rows read, and D9's `planAflApiImporterReplay` run. Writes nothing and throws on
 * nothing a STOP describes — the caller decides. Split out (AFLDB-ISSUE-237 R4) so the
 * recovery's `validate-only` computes the exact write set through this same path rather than a
 * second planner.
 */
export async function planAflApiImporterRowsLive(
  tx: TransactionSql, capturedRows: readonly CapturedImporterRow[],
): Promise<{ sourceId: number; plan: AflApiImporterReplayPlan }> {
  const sourceId = await fetchAflApiSourceId(tx);

  const continuityRules = loadFitzroyProfileContinuityRules();
  const remapByExternalId = new Map<string, AflApiPlayerRemapResult>();
  for (const row of capturedRows) {
    remapByExternalId.set(row.externalId, await resolveAflApiPlayerIdentity(tx, row.playerIdentity, continuityRules));
  }

  const rawCandidates = await tx<{
    externalId: string; status: string; matchMethod: string | null; playerId: number | null;
  }[]>`
    SELECT external_id AS "externalId", status::text AS status, match_method AS "matchMethod",
           player_id AS "playerId"
      FROM external_identities WHERE source_id = ${sourceId}
  `;
  const candidateByExternalId = new Map<string, AflApiImporterCandidateRow>();
  const candidatePlayerAflApiRow = new Map<number, AflApiImporterCandidateRow>();
  for (const r of rawCandidates) {
    candidateByExternalId.set(r.externalId, r);
    if (r.playerId !== null) candidatePlayerAflApiRow.set(r.playerId, r);
  }

  const plan = planAflApiImporterReplay({
    capturedRows, remapByExternalId, candidateByExternalId, candidatePlayerAflApiRow,
  });
  return { sourceId, plan };
}

/** The write half: one INSERT per planned row. The caller has already refused any STOP. */
export async function writeAflApiImporterPlan(
  tx: TransactionSql, sourceId: number, plan: AflApiImporterReplayPlan,
): Promise<void> {
  if (plan.stops.length > 0) {
    throw new AflApiReplayAbort(`writeAflApiImporterPlan: refusing a plan carrying ${plan.stops.length} STOP(s).`);
  }
  for (const insert of plan.inserts) {
    const { row } = insert;
    await tx`
      INSERT INTO external_identities
            (source_id, external_id, player_id, status, candidate_count, match_method,
             external_name, external_url, notes)
      VALUES (${sourceId}, ${row.externalId}, ${insert.playerId}, 'unique', 1, ${row.matchMethod},
              ${row.externalName}, ${row.externalUrl}, ${row.notes})
    `;
  }
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
export async function replayAflApiAdjudications(
  tx: TransactionSql,
  /**
   * AFLDB-ISSUE-237 D9: the EXACT provider set this call may supersede, fixed by the caller
   * before any mutation -- `E_rebuild` (always empty) for a rebuild/OD-4 call, `E_promotion =
   * G2.AGREE` for a promotion call. Defaults to empty, i.e. the pre-ISSUE-237 behaviour, so
   * every existing call site (the rebuild's own two call sites, and every ISSUE-235-era
   * integration test) keeps its exact prior semantics.
   */
  expectedSupersedes: ReadonlySet<string> = new Set(),
): Promise<AflApiReplayCounts> {
  const sourceId = await fetchAflApiSourceId(tx);
  const ledgerRows = await readLedgerRows(tx);
  // An empty ledger can supersede nothing, so it may short-circuit ONLY when nothing was expected;
  // otherwise it falls through to the exact-set check below and aborts (D13).
  if (ledgerRows.length === 0 && expectedSupersedes.size === 0) return { inserted: 0, noops: 0, stops: [], supersedes: [] };

  const remapByExternalId = await remapLedgerPlayerIds(tx, ledgerRows);
  const { candidateByExternalId, candidatePlayerAflApiRow } = await readCandidateAflApiState(tx, sourceId);

  const plan = planAflApiAdjudicationReplay({
    ledgerRows, remapByExternalId, candidateByExternalId, candidatePlayerAflApiRow, expectedSupersedes,
  });

  if (plan.stops.length > 0) {
    throw new AflApiReplayAbort(
      `afl_api adjudication replay stopped on ${plan.stops.length} provider id(s), no row written: `
      + plan.stops.map((s) => `${s.externalId} (${s.reason})`).join('; '),
    );
  }

  // D13: the ACTUAL superseded set must equal the caller's expected set exactly. Checked
  // before any statement runs, so a mismatch leaves nothing written.
  const mismatch = aflApiSupersedeMismatch({ expected: expectedSupersedes, actual: plan.supersedes });
  if (mismatch.missing.length > 0 || mismatch.extra.length > 0) {
    throw new AflApiReplayAbort(
      'afl_api D15 supersede set did not match the expected set exactly -- nothing written '
      + `(missing: ${mismatch.missing.join(', ') || 'none'}; extra: ${mismatch.extra.join(', ') || 'none'})`,
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

  // AFLDB-ISSUE-237 D9/OD-2 -- the ONE new transition: an agreeing importer row is UPDATEd
  // in place (external_identities.id is kept) rather than replaced, so it becomes exactly the
  // row an INSERT would have created (D9's own statement of the invariant).
  for (const supersede of plan.supersedes) {
    await tx`
      UPDATE external_identities
         SET status = 'resolved', candidate_count = 0, match_method = ${AFL_API_ADMIN_MATCH_METHOD},
             external_name = NULL,
             notes = 'AFLDB-ISSUE-235 admin adjudication; see afl_api_identity_adjudications '
                    || '(AFLDB-ISSUE-237 D9/OD-2: supersedes an agreeing importer row)'
       WHERE source_id = ${sourceId} AND external_id = ${supersede.externalId} AND player_id = ${supersede.playerId}
    `;
  }

  return {
    inserted: plan.inserts.length, noops: plan.noops.length, stops: [], supersedes: plan.supersedes,
  };
}

/**
 * AFLDB-ISSUE-237 F-L4-4 — the promoted database's own state, in the two digests an
 * `E_promotion` file is bound to: the importer rows (stable fields and forward identity) and
 * the reinstated human ledger (every field the reinstatement preserves; never `player_id`).
 * Read-only.
 */
export async function readAflApiSupersedeBindingState(tx: TransactionSql): Promise<{
  currentDatabase: string;
  importer: { rowCount: number; sha256: string };
  ledger: { rowCount: number; sha256: string };
}> {
  const [{ currentDatabase }] = await tx<{ currentDatabase: string }[]>`SELECT current_database() AS "currentDatabase"`;
  const sourceId = await fetchAflApiSourceId(tx);
  const { importerRows } = censusAflApiRows(await readAflApiCensusRows(tx, sourceId));
  const identityByPlayerId = await readAflApiForwardIdentities(
    tx, [...new Set(importerRows.filter((r) => r.playerId !== null).map((r) => r.playerId as number))]);
  const importerState = importerRows.map((r) => {
    const identity = r.playerId === null ? undefined : identityByPlayerId.get(r.playerId);
    return {
      externalId: r.externalId, status: r.status, matchMethod: r.matchMethod,
      playerIdentity: identity && identity.ok ? identity.identity : null,
    };
  });
  const ledgerRows = await readLedgerRows(tx);
  return {
    currentDatabase,
    importer: { rowCount: importerState.length, sha256: aflApiImporterStateSha256(importerState) },
    ledger: { rowCount: ledgerRows.length, sha256: aflApiLedgerStateSha256(ledgerRows) },
  };
}

/**
 * The post-swap D15 replay of a PROMOTION (`docs/production-promotion.md` §8 step 1), driven
 * by the bound `E_promotion` file `--phase restored` wrote. Before anything is written it
 * refuses a file that is:
 *
 * - malformed, foreign, of an older unbound version, or tampered (`parseAflApiSupersedeFile`);
 * - for another environment or another target than the one the operator names and the
 *   connection is actually on;
 * - stale or candidate-mismatched: the promoted database's importer state or reinstated human
 *   ledger no longer hashes to what G2 evaluated.
 *
 * Only then does it run `replayAflApiAdjudications` with exactly the file's provider set, whose
 * own planner and exact-set check still refuse any other supersede. Everything happens inside
 * the caller's single transaction, so a refusal writes nothing.
 */
export async function replayAflApiAdjudicationsFromSupersedeFile(
  tx: TransactionSql, fileText: string, expected: { environment: 'prod' | 'dev'; targetDatabase: string },
): Promise<AflApiReplayCounts> {
  let file: AflApiSupersedeFile;
  try {
    file = parseAflApiSupersedeFile(fileText);
  } catch (error) {
    if (error instanceof AflApiPromotionFileRefused) throw new AflApiReplayAbort(`refusing the E_promotion file: ${error.message}`);
    throw error;
  }
  const state = await readAflApiSupersedeBindingState(tx);
  const problems = [
    ...(state.currentDatabase === expected.targetDatabase ? [] : [{
      kind: 'connected_database_mismatch', expected: expected.targetDatabase, actual: state.currentDatabase,
    }]),
    ...aflApiSupersedeBindingProblems(file, {
      environment: expected.environment, targetDatabase: state.currentDatabase,
      importer: state.importer, ledger: state.ledger,
    }),
  ];
  if (problems.length > 0) {
    throw new AflApiReplayAbort(
      'refusing the E_promotion file: it is not bound to this promoted database state, nothing written — '
      + problems.map((p) => JSON.stringify(p)).join('; '));
  }
  return replayAflApiAdjudications(tx, new Set(file.expectedSupersedes));
}

/**
 * D15's consistency proof (runbook §10.1 C5), run as the last step of the replay
 * ("the validation stage" for `db:test:rebuild`; the promotion checker for a real
 * promotion). Standalone and read-only: safe to call at any time, independent of
 * whether a replay ran in this same transaction.
 *
 * `ledgerTablePresent: false` (AFLDB-ISSUE-237 bootstrap) is passed ONLY by `db:test:rebuild`'s
 * Stage 2 capture, and only after its own `to_regclass` check found no
 * `afl_api_identity_adjudications` table (a database older than migration 104). The ledger is
 * then empty by construction, so every admin-resolved row still fails as `row_without_ledger`.
 * Every other caller omits it and reads the ledger strictly: a missing table is an error there.
 */
export async function assertAflApiAdjudicationBijection(
  tx: TransactionSql, options: { ledgerTablePresent?: boolean } = {},
): Promise<void> {
  const sourceId = await fetchAflApiSourceId(tx);
  const ledgerRows = options.ledgerTablePresent === false ? [] : await readLedgerRows(tx);
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

/**
 * D13's standalone invariant (Stage 19 `afl-api-adjudications-bijection`, §6.1; also usable
 * as a promotion/any-time validation stage). Replaces the bijection-only check above with the
 * combined D5 census + D15 bijection + one-row-per-player + D7 identity check. Read-only, and
 * needs no capture file.
 */
export async function assertAflApiIdentityInvariant(tx: TransactionSql): Promise<void> {
  const sourceId = await fetchAflApiSourceId(tx);
  const ledgerRows = await readLedgerRows(tx);
  const census = await readAflApiCensusRows(tx, sourceId);
  const playerIds = [...new Set(
    census.filter((r) => r.status === 'unique' && r.playerId !== null).map((r) => r.playerId as number),
  )];
  const identityByPlayerId = await readAflApiForwardIdentities(tx, playerIds);

  const problems = checkAflApiIdentityInvariant({ rows: census, ledgerRows, identityByPlayerId });
  if (problems.length > 0) {
    throw new AflApiReplayAbort(
      `afl_api identity invariant failed (${problems.length} problem(s)): `
      + problems.map((p) => JSON.stringify(p)).join('; '),
    );
  }
}
