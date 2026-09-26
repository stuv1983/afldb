/**
 * AFLDB-ISSUE-239 / 240 / 241 — ONE combined code_test_db rehearsal of the AFL API identity bulk
 * change, against real PostgreSQL.
 *
 *     AFLDB_CODE_TEST_DATABASE_URL=<owner DSN naming code_test_db> \
 *     AFLDB_CODE_TEST_IMPORT_DATABASE_URL=<afldb_import DSN naming code_test_db> \
 *       npx tsx tools/db/afl-api-identity-bulk-rehearsal.ts run --acknowledge code_test_db
 *     ... residue      (read-only: counts every fixture row; expect 0)
 *     ... teardown --acknowledge code_test_db   (only after a run that died before its own teardown)
 *
 * WHAT IT PROVES that the DB-free suites cannot: the real SQL. The bridge loader's validate-only
 * really runs read-only, dry-run really rolls back, apply really commits under `afldb_import`
 * grants; `ON CONFLICT (issue_type, issue_key) WHERE ... DO NOTHING` really infers migration 076's
 * partial index and never rewrites the first finding; the batched reverse identity lookup agrees
 * with the single one; the ISSUE-239 recovery's `OVERRIDING SYSTEM VALUE` insert, jsonb and
 * microsecond timestamps, sequence raise, attribution-only actor, D15 replay, bijection and
 * invariant all run for real. Every check is the real exported function; nothing here
 * re-implements a decision.
 *
 * TARGET AND ISOLATION. code_test_db ONLY (`resolveRehearsalDsns`, the ISSUE-237 fixture's own
 * guard: the owner DSN must name code_test_db and pass the rebuild's name guard). It refuses to
 * start unless code_test_db's `afl_api_identity_adjudications` ledger is empty, the combined
 * identity invariant already holds, and no fixture row exists. Fixture namespace: providers
 * `CD_I99923900NN`, the AFL Tables path `players/Z/Zz239_*`, the actor
 * `issue239-rehearsal-fixture@example.test`, ledger ids 9239001+. Real players are only READ
 * (their accepted identities); none is created, changed or deleted. Teardown deletes exactly the
 * namespace plus the data_issues / import_batches rows this run created (recorded by id), then
 * proves zero residue. The ledger id sequence, once raised, is not lowered (an identity sequence
 * is never wound back); code_test_db is the disposable rehearsal database.
 *
 * DEV, PROD and afldb_test are never contacted. No DSN is printed.
 */
import postgres, { type Sql, type TransactionSql } from 'postgres';

import { AFL_API_BRIDGE_IDENTITY_CONTRACT, aflApiBridgeLinkedRows } from '../../src/lib/acquisition/afl-api-bridge-identity';
import { REHEARSAL_IMPORT_ENV, REHEARSAL_OWNER_ENV, resolveRehearsalDsns } from '../migration/afl_api_identity_rebuild_rehearsal_fixture';
import { importAflApiBridge, type BridgeConnection, type LoadedBridgeArtefact } from '../migration/import_afl_api_player_bridge';
import {
  buildAdjudicationRecoveryExport,
  parseAdjudicationRecoverySource,
  recoverAflApiAdjudications,
} from '../migration/recover_afl_api_adjudications';
import type { CapturedLedgerRow } from '../migration/rebuild_afl_api_adjudications';
import {
  assertAflApiIdentityInvariant,
  readAflApiForwardIdentities,
  resolveAflApiPlayerIdentities,
  resolveAflApiPlayerIdentity,
} from '../migration/replay_afl_api_adjudications';
import { redact } from './psql';

export const BULK_REHEARSAL = {
  database: 'code_test_db',
  providerPrefix: 'CD_I99923900',
  providerLike: 'CD_I99923900%',
  pathPrefix: 'players/Z/Zz239_',
  actorEmail: 'issue239-rehearsal-fixture@example.test',
  ledgerIdBase: 9239000,
} as const;

const provider = (n: number) => `${BULK_REHEARSAL.providerPrefix}${String(n).padStart(2, '0')}`;

/**
 * The rows that make `path` an AMBIGUOUS reverse identity, in the only shape the schema can hold.
 * `external_identities_uq UNIQUE (source_id, external_id)` (migration 002) allows ONE row per
 * source, so two `afltables` rows on one path are refused by PostgreSQL (the first real run,
 * 2026-09-26, died exactly there). The reverse lookup unions the `afltables`/`afltables_profile_url`
 * and `manual_admin_edit`/`manual_admin_edit` lineages, so one row in EACH, on two players, is the
 * reachable `ambiguous` state. Exported for the DB-free guard in
 * tests/afl-api-player-bridge-import.test.ts.
 */
export function ambiguousIdentityFixtureRows(path: string, playerIds: readonly [number, number]) {
  return [
    { sourceKey: 'afltables', externalId: path, playerId: playerIds[0], status: 'unique', candidateCount: 1, matchMethod: 'afltables_profile_url' },
    { sourceKey: 'manual_admin_edit', externalId: path, playerId: playerIds[1], status: 'resolved', candidateCount: 0, matchMethod: 'manual_admin_edit' },
  ] as const;
}

/**
 * The ISSUE-239 recovery source's three ledger rows: P0 linked on one provider; P1 linked, then
 * revoked, on another. The source is hand-built here, but a real one is only ever written by
 * `readLedger` (`evidence::text`, `previous_state::text`), so every jsonb field MUST be
 * PostgreSQL's own rendering: keys shorter-first then bytewise, `", "` / `": "` separators. The
 * second real run (2026-09-26) carried `{"rehearsal": ..., "row": N}`, which jsonb stores as
 * `{"row": N, "rehearsal": ...}`; the recovery's readback then correctly refused all three rows.
 * Exported for the DB-free guard in tests/afl-api-adjudication-recovery.test.ts.
 */
export function recoveryFixtureLedgerRows(
  players: readonly [{ playerId: number; path: string }, { playerId: number; path: string }],
): CapturedLedgerRow[] {
  const row = (offset: number, externalId: string, action: 'linked' | 'revoked', p: { playerId: number; path: string },
    supersedes: number | null): CapturedLedgerRow => ({
    id: BULK_REHEARSAL.ledgerIdBase + offset, sourceKey: 'afl_api', externalId, action, playerId: p.playerId,
    playerIdentity: p.path, previousState: action === 'revoked' ? '{"status": "resolved"}' : null,
    evidence: `{"row": ${offset}, "rehearsal": "AFLDB-ISSUE-239"}`, evidenceSha256: String(offset).repeat(64),
    surnameDisagreementAcknowledged: offset === 2, supersedesId: supersedes === null ? null : BULK_REHEARSAL.ledgerIdBase + supersedes,
    adminUserId: 1, adminEmail: BULK_REHEARSAL.actorEmail, adminRole: 'super_admin',
    note: `AFLDB-ISSUE-239 rehearsal human decision ${offset}.`, createdAt: `2026-09-26T0${offset}:00:00.123456Z`,
  });
  return [row(1, provider(11), 'linked', players[0], null), row(2, provider(12), 'linked', players[1], null),
    row(3, provider(12), 'revoked', players[1], 2)];
}

class RehearsalRefused extends Error {}

type Check = { name: string; pass: boolean; detail: string };

function connectionOf(sql: Sql): BridgeConnection {
  return { begin: (options, fn) => sql.begin(options, fn) as never };
}

async function census(sql: Sql, batchIds: readonly string[], issueIds: readonly string[]): Promise<Record<string, number>> {
  const [row] = await sql<Record<string, number>[]>`
    SELECT
      (SELECT count(*)::int FROM external_identities WHERE external_id LIKE ${BULK_REHEARSAL.providerLike}
         OR external_id LIKE ${`${BULK_REHEARSAL.pathPrefix}%`}) AS identities,
      (SELECT count(*)::int FROM afl_api_identity_adjudications WHERE external_id LIKE ${BULK_REHEARSAL.providerLike}) AS ledger,
      (SELECT count(*)::int FROM auth_users WHERE lower(email) = ${BULK_REHEARSAL.actorEmail}) AS actors,
      (SELECT count(*)::int FROM data_issues WHERE details->>'external_id' LIKE ${BULK_REHEARSAL.providerLike}
         OR id = ANY (${sql.array([...issueIds])}::bigint[])) AS findings,
      (SELECT count(*)::int FROM import_batches WHERE id = ANY (${sql.array([...batchIds])}::bigint[])) AS batches
  `;
  return row;
}

async function teardown(owner: Sql, batchIds: readonly string[]): Promise<void> {
  await owner.begin(async (tx) => {
    await tx`DELETE FROM import_rejections WHERE import_batch_id = ANY (${tx.array([...batchIds])}::bigint[])`;
    await tx`DELETE FROM import_batches WHERE id = ANY (${tx.array([...batchIds])}::bigint[])`;
    await tx`DELETE FROM data_issues WHERE details->>'external_id' LIKE ${BULK_REHEARSAL.providerLike}`;
    await tx`DELETE FROM afl_api_identity_adjudications WHERE external_id LIKE ${BULK_REHEARSAL.providerLike}`;
    await tx`DELETE FROM external_identities WHERE external_id LIKE ${BULK_REHEARSAL.providerLike}
               OR external_id LIKE ${`${BULK_REHEARSAL.pathPrefix}%`}`;
    await tx`DELETE FROM auth_users WHERE lower(email) = ${BULK_REHEARSAL.actorEmail}`;
  });
}

/** Real players with exactly one accepted AFL Tables identity, uniquely held, and no afl_api row. */
async function pickPlayers(tx: TransactionSql, count: number): Promise<{ playerId: number; path: string }[]> {
  const candidates = await tx<{ playerId: number; path: string }[]>`
    SELECT ei.player_id AS "playerId", min(ei.external_id) AS path
      FROM external_identities ei JOIN sources s ON s.id = ei.source_id
     WHERE s.key = 'afltables' AND ei.match_method = 'afltables_profile_url' AND ei.status IN ('unique', 'resolved')
       AND ei.player_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM external_identities x JOIN sources sx ON sx.id = x.source_id
                        WHERE sx.key IN ('afl_api', 'manual_admin_edit') AND x.player_id = ei.player_id)
     GROUP BY ei.player_id HAVING count(*) = 1
     ORDER BY ei.player_id LIMIT ${count * 4}
  `;
  const remap = await resolveAflApiPlayerIdentities(tx, candidates.map((c) => c.path));
  const forward = await readAflApiForwardIdentities(tx, candidates.map((c) => c.playerId));
  const chosen = candidates.filter((c) => {
    const r = remap.get(c.path);
    const f = forward.get(c.playerId);
    return r?.ok && r.newPlayerId === c.playerId && f?.ok && f.identity === c.path;
  }).slice(0, count);
  if (chosen.length < count) throw new RehearsalRefused(`code_test_db has fewer than ${count} suitable players.`);
  return chosen;
}

function loaded(evidenceClass: LoadedBridgeArtefact['evidenceClass'], providers: Record<string, unknown>): LoadedBridgeArtefact {
  const { rows, problems } = aflApiBridgeLinkedRows({ player_identity_contract: AFL_API_BRIDGE_IDENTITY_CONTRACT, providers }, evidenceClass);
  if (problems.length > 0) throw new RehearsalRefused(`fixture artefact invalid: ${problems.join('; ')}`);
  return { path: `rehearsal:${evidenceClass}`, fileSha256: '0'.repeat(64), evidenceClass, rows };
}

const linkedRow = (identity: string, hint: number | null) => ({
  disposition: 'linked', candidate_player_identity: identity, candidate_player_id: hint,
  observed_name: 'AFLDB-ISSUE-241 rehearsal', evidence_summary: 'AFLDB-ISSUE-241 rehearsal fixture',
});

async function run(): Promise<number> {
  const dsns = resolveRehearsalDsns(process.env, { allowOwnerImportDsn: process.argv.includes('--allow-owner-import-dsn') });
  const owner = postgres(dsns.ownerDsn, { max: 1, onnotice: () => {}, connection: { application_name: 'afldb-issue239-241-rehearsal' } });
  const importer = dsns.importIsOwner ? owner
    : postgres(dsns.importDsn, { max: 1, onnotice: () => {}, connection: { application_name: 'afldb-issue241-rehearsal-import' } });
  const checks: Check[] = [];
  const check = (name: string, pass: boolean, detail = '') => {
    checks.push({ name, pass, detail });
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };
  const batchIds: string[] = [];
  const issueIds: string[] = [];
  const expected = { database: BULK_REHEARSAL.database, role: null };
  try {
    // ---- Preconditions (read-only) ------------------------------------------------------
    const pre = await owner.begin('isolation level repeatable read read only', async (tx) => {
      const [{ database }] = await tx<{ database: string }[]>`SELECT current_database() AS database`;
      if (database !== BULK_REHEARSAL.database) throw new RehearsalRefused(`connected to '${database}', not code_test_db`);
      const [{ ledger }] = await tx<{ ledger: number }[]>`SELECT count(*)::int AS ledger FROM afl_api_identity_adjudications`;
      if (ledger !== 0) throw new RehearsalRefused(`code_test_db's adjudication ledger holds ${ledger} row(s); the recovery rehearsal needs it empty`);
      await assertAflApiIdentityInvariant(tx);
      return { players: await pickPlayers(tx, 8) };
    });
    const residue0 = await census(owner, [], []);
    if (Object.values(residue0).some((n) => n !== 0)) throw new RehearsalRefused(`fixture residue before the run: ${JSON.stringify(residue0)}`);
    const P = pre.players;
    console.log(`AFLDB-ISSUE-239/240/241 code_test_db rehearsal (import role: ${dsns.importIsOwner ? 'OWNER (explicitly allowed)' : 'afldb_import'})`);

    // ---- ISSUE-241: the batched reverse lookup equals the single one ----------------------
    await owner.begin('isolation level repeatable read read only', async (tx) => {
      const identities = [...P.map((p) => p.path), `${BULK_REHEARSAL.pathPrefix}Absent.html`];
      const batch = await resolveAflApiPlayerIdentities(tx, identities);
      let same = true;
      for (const identity of identities) {
        if (JSON.stringify(batch.get(identity)) !== JSON.stringify(await resolveAflApiPlayerIdentity(tx, identity))) same = false;
      }
      check('241: resolveAflApiPlayerIdentities agrees with resolveAflApiPlayerIdentity on real rows', same);
    });

    // ---- Fixture pre-state: a provider collision and a player collision --------------------
    await owner`
      INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method, notes)
      VALUES ((SELECT id FROM sources WHERE key = 'afl_api'), ${provider(3)}, ${P[3].playerId}, 'unique', 1,
              'afl_api_stat_vector_bootstrap', 'AFLDB-ISSUE-241 rehearsal pre-state')
    `;
    const bridge = loaded('afl_api_stat_vector_bootstrap', {
      [provider(1)]: linkedRow(P[0].path, P[0].playerId), // same lineage
      [provider(2)]: linkedRow(P[1].path, P[2].playerId), // stale hint naming another real player
      [provider(3)]: linkedRow(P[2].path, null), // provider already linked to P[3]: contradiction
      [provider(4)]: linkedRow(P[3].path, null), // P[3] already holds provider 3: player collision
    });

    const before = await census(owner, [], []);
    const validate = await importAflApiBridge({ mode: 'validate-only', connection: connectionOf(importer), expected, loaded: bridge });
    check('241 validate-only: READ_ONLY with 2 links, 1 contradiction, 1 collision, 2 new findings',
      validate.outcome === 'READ_ONLY' && validate.linked === 2 && validate.contradictionsWithheld.length === 1
        && validate.playerCollisionsWithheld.length === 1 && validate.findingsRecorded === 2, JSON.stringify({
        linked: validate.linked, c: validate.contradictionsWithheld, p: validate.playerCollisionsWithheld, f: validate.findingsRecorded }));
    check('241 validate-only: the stale hint is reported and ignored',
      validate.hintMismatches.length === 1 && validate.hintMismatches[0].resolvedPlayerId === P[1].playerId);
    check('241 validate-only wrote nothing', JSON.stringify(await census(owner, [], [])) === JSON.stringify(before));

    const dry = await importAflApiBridge({ mode: 'dry-run', connection: connectionOf(importer), expected, loaded: bridge });
    check('241 dry-run: ROLLED_BACK after the full write path', dry.outcome === 'ROLLED_BACK' && dry.linked === 2 && dry.findingsRecorded === 2);
    check('241 dry-run left nothing behind', JSON.stringify(await census(owner, [], [])) === JSON.stringify(before));

    const apply1 = await importAflApiBridge({ mode: 'apply', connection: connectionOf(importer), expected, loaded: bridge });
    if (apply1.importBatchId) batchIds.push(apply1.importBatchId);
    const links = await owner<{ externalId: string; playerId: number; status: string; candidateCount: number; matchMethod: string }[]>`
      SELECT external_id AS "externalId", player_id AS "playerId", status::text AS status,
             candidate_count AS "candidateCount", match_method AS "matchMethod"
        FROM external_identities WHERE external_id IN (${provider(1)}, ${provider(2)}) ORDER BY external_id
    `;
    check('241 apply: each provider links to the player its IDENTITY names (the stale hint never used)',
      links.length === 2 && links[0].playerId === P[0].playerId && links[1].playerId === P[1].playerId
        && links.every((l) => l.status === 'unique' && l.candidateCount === 1 && l.matchMethod === 'afl_api_stat_vector_bootstrap'),
      JSON.stringify(links));
    const findings1 = await owner<{ id: string; issueKey: string; detectedAt: string; details: unknown; description: string }[]>`
      SELECT id::text AS id, issue_key AS "issueKey", detected_at::text AS "detectedAt", details, description
        FROM data_issues WHERE issue_type = 'afl_api_identity_contradiction'
         AND details->>'external_id' LIKE ${BULK_REHEARSAL.providerLike} ORDER BY id
    `;
    issueIds.push(...findings1.map((f) => f.id));
    check('240 apply: two keyed open findings recorded', findings1.length === 2
      && findings1.every((f) => /^afl_api_identity_contradiction:v1:[0-9a-f]{64}$/.test(f.issueKey)));

    const apply2 = await importAflApiBridge({ mode: 'apply', connection: connectionOf(importer), expected, loaded: bridge });
    if (apply2.importBatchId) batchIds.push(apply2.importBatchId);
    const findings2 = await owner<typeof findings1>`
      SELECT id::text AS id, issue_key AS "issueKey", detected_at::text AS "detectedAt", details, description
        FROM data_issues WHERE issue_type = 'afl_api_identity_contradiction'
         AND details->>'external_id' LIKE ${BULK_REHEARSAL.providerLike} ORDER BY id
    `;
    check('241 apply is idempotent: nothing linked on the replay', apply2.linked === 0 && apply2.alreadyLinked === 2);
    check('240 replay: no duplicate open finding and the first findings are byte-identical (ON CONFLICT DO NOTHING)',
      apply2.findingsRecorded === 0 && apply2.findingsAlreadyOpen === 2 && JSON.stringify(findings2) === JSON.stringify(findings1));
    const [{ rejections }] = await owner<{ rejections: number }[]>`
      SELECT count(*)::int AS rejections FROM import_rejections WHERE import_batch_id = ANY (${owner.array([...batchIds])}::bigint[])`;
    check('240 every detection, the deduplicated replay included, stays inspectable in import_rejections', rejections === 4, String(rejections));

    const changed = await importAflApiBridge({ mode: 'apply', connection: connectionOf(importer), expected,
      loaded: loaded('afl_api_name_team_season_bootstrap', { [provider(3)]: linkedRow(P[2].path, null) }) });
    if (changed.importBatchId) batchIds.push(changed.importBatchId);
    const [{ open }] = await owner<{ open: number }[]>`
      SELECT count(*)::int AS open FROM data_issues WHERE issue_type = 'afl_api_identity_contradiction'
         AND resolved_at IS NULL AND details->>'external_id' LIKE ${BULK_REHEARSAL.providerLike}`;
    check('240 a materially different contradiction (another evidence class) is recorded separately', changed.findingsRecorded === 1 && open === 3);

    // STOP: an ambiguous identity refuses the whole run, nothing written. One row per source
    // (see ambiguousIdentityFixtureRows): never two rows under one source, which
    // external_identities_uq refuses.
    const ambiguousPath = `${BULK_REHEARSAL.pathPrefix}Ambiguous.html`;
    for (const row of ambiguousIdentityFixtureRows(ambiguousPath, [P[4].playerId, P[5].playerId])) {
      await owner`
        INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
        VALUES ((SELECT id FROM sources WHERE key = ${row.sourceKey}), ${row.externalId}, ${row.playerId},
                ${row.status}::link_status, ${row.candidateCount}::smallint, ${row.matchMethod})
      `;
    }
    const beforeStop = await census(owner, batchIds, issueIds);
    let stopMessage = '';
    try {
      await importAflApiBridge({ mode: 'apply', connection: connectionOf(importer), expected, loaded: loaded('afl_api_stat_vector_bootstrap', {
        [provider(5)]: linkedRow(P[6].path, null), [provider(6)]: linkedRow(ambiguousPath, null),
        [provider(7)]: linkedRow(`${BULK_REHEARSAL.pathPrefix}Absent.html`, P[7].playerId),
      }) });
    } catch (error) { stopMessage = (error as Error).message; }
    check('241 ambiguous and missing identities refuse the whole run',
      /names more than one player/.test(stopMessage) && /names no player/.test(stopMessage), stopMessage.slice(0, 160));
    check('241 a refused run wrote nothing', JSON.stringify(await census(owner, batchIds, issueIds)) === JSON.stringify(beforeStop));
    // The ambiguity fixture has served; ISSUE-239 below starts without it (P[4]/P[5] are otherwise
    // untouched real players).
    await owner`DELETE FROM external_identities WHERE external_id = ${ambiguousPath}`;

    let wrongDb = '';
    try {
      await importAflApiBridge({ mode: 'validate-only', connection: connectionOf(importer), expected: { database: 'afldb_test', role: null }, loaded: bridge });
    } catch (error) { wrongDb = (error as Error).message; }
    check('241 a session on another database than the named target refuses', /not 'afldb_test'/.test(wrongDb));

    // ---- ISSUE-239: recovery outside D15 ------------------------------------------------
    const ledgerRows = recoveryFixtureLedgerRows([P[6], P[7]]);
    // A real source's jsonb text is PostgreSQL's own rendering (it is read as `::text`); prove the
    // hand-built one is too, before any recovery call, so a fixture slip names itself here.
    const jsonbTexts = ledgerRows.flatMap((r) => [r.evidence, ...(r.previousState === null ? [] : [r.previousState])]);
    const rendered = await owner<{ t: string }[]>`
      SELECT (x::jsonb)::text AS t FROM unnest(${owner.array(jsonbTexts)}::text[]) WITH ORDINALITY AS u(x, n) ORDER BY n`;
    const canonical = rendered.length === jsonbTexts.length && rendered.every((r, i) => r.t === jsonbTexts[i]);
    check('239 fixture: every jsonb text is exactly what PostgreSQL renders', canonical, JSON.stringify(rendered.map((r) => r.t)));
    if (!canonical) throw new RehearsalRefused('The ISSUE-239 fixture carries jsonb text PostgreSQL would re-render; fix the fixture.');
    const exported = buildAdjudicationRecoveryExport({
      ledgerDatabase: 'code_test_db', sourceDatabase: 'code_test_db', capturedAt: new Date().toISOString(), ledgerRows,
    });
    const source = parseAdjudicationRecoverySource(JSON.stringify(exported), exported.payloadSha256);
    const beforeRecovery = await census(owner, batchIds, issueIds);
    const rv = await recoverAflApiAdjudications({ mode: 'validate-only', connection: connectionOf(owner), targetDatabase: 'code_test_db', source });
    check('239 validate-only: 3 ledger rows, 1 actor, 1 outcome, READ_ONLY',
      rv.outcome === 'READ_ONLY' && rv.ledgerRowsReinstated.length === 3 && rv.actorsToCreate === 1 && rv.outcomeInserts.length === 1);
    const rd = await recoverAflApiAdjudications({ mode: 'dry-run', connection: connectionOf(owner), targetDatabase: 'code_test_db', source });
    // "Nothing" is every fixture row; a sequence raise is non-transactional and outlives the rollback.
    check('239 dry-run: ROLLED_BACK and nothing left behind', rd.outcome === 'ROLLED_BACK'
      && JSON.stringify(await census(owner, batchIds, issueIds)) === JSON.stringify(beforeRecovery));
    const ra = await recoverAflApiAdjudications({ mode: 'apply', connection: connectionOf(owner), targetDatabase: 'code_test_db', source });
    if (ra.importBatchId) batchIds.push(ra.importBatchId);
    const recovered = await owner<{ id: string; playerId: number; createdAt: string; evidence: string;
      previousState: string | null; supersedesId: string | null }[]>`
      SELECT id::text AS id, player_id AS "playerId",
             to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
             evidence::text AS evidence, previous_state::text AS "previousState", supersedes_id::text AS "supersedesId"
        FROM afl_api_identity_adjudications WHERE external_id LIKE ${BULK_REHEARSAL.providerLike} ORDER BY id
    `;
    check('239 apply: ledger reinstated with original ids, microsecond times, jsonb evidence and supersedes',
      ra.outcome === 'COMMITTED' && recovered.length === 3
        && recovered.map((r) => r.id).join() === exported.ledgerRows.map((r) => String(r.id)).join()
        && recovered.every((r, i) => r.createdAt === exported.ledgerRows[i].createdAt
          && r.evidence === exported.ledgerRows[i].evidence && r.previousState === exported.ledgerRows[i].previousState)
        && recovered[2].supersedesId === String(exported.ledgerRows[1].id), JSON.stringify(recovered));
    const [outcome] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM external_identities WHERE external_id = ${provider(11)} AND status = 'resolved'
         AND match_method = 'afl_api_admin_adjudication' AND player_id = ${P[6].playerId}`;
    check('239 apply: the D15 replay produced exactly the live outcome', outcome.n === 1);
    const [actor] = await owner<{ passwordHash: string | null; disabled: boolean }[]>`
      SELECT password_hash AS "passwordHash", disabled_at IS NOT NULL AS disabled FROM auth_users WHERE lower(email) = ${BULK_REHEARSAL.actorEmail}`;
    check('239 apply: the actor is attribution-only (no credential, disabled)', actor?.passwordHash === null && actor.disabled);
    const again = await recoverAflApiAdjudications({ mode: 'apply', connection: connectionOf(owner), targetDatabase: 'code_test_db', source });
    check('239 rerun is idempotent: ALREADY_RECOVERED, no batch', again.outcome === 'ALREADY_RECOVERED' && again.importBatchId === null);

    // Loss with the outcome surviving: the ledger alone comes back; the outcome is a no-op.
    await owner`DELETE FROM afl_api_identity_adjudications WHERE external_id LIKE ${BULK_REHEARSAL.providerLike}`;
    const rs = await recoverAflApiAdjudications({ mode: 'apply', connection: connectionOf(owner), targetDatabase: 'code_test_db', source });
    if (rs.importBatchId) batchIds.push(rs.importBatchId);
    check('239 ledger lost, outcome survived: ledger reinstated, outcome a no-op',
      rs.outcome === 'COMMITTED' && rs.ledgerRowsReinstated.length === 3 && rs.outcomeNoops === 1 && rs.outcomeInserts.length === 0);

    // A conflict with current importer state refuses and writes nothing.
    await owner`DELETE FROM afl_api_identity_adjudications WHERE external_id LIKE ${BULK_REHEARSAL.providerLike}`;
    await owner`DELETE FROM external_identities WHERE external_id = ${provider(11)}`;
    await owner`
      INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
      VALUES ((SELECT id FROM sources WHERE key = 'afl_api'), ${provider(11)}, ${P[2].playerId}, 'unique', 1, 'afl_api_stat_vector_bootstrap')
    `;
    const beforeConflict = await census(owner, batchIds, issueIds);
    let conflict = '';
    try {
      await recoverAflApiAdjudications({ mode: 'apply', connection: connectionOf(owner), targetDatabase: 'code_test_db', source });
    } catch (error) { conflict = (error as Error).message; }
    check('239 a conflicting importer row refuses the recovery', /D15 replay would stop/.test(conflict), conflict.slice(0, 160));
    check('239 the refused recovery wrote nothing', JSON.stringify(await census(owner, batchIds, issueIds)) === JSON.stringify(beforeConflict));
  } finally {
    try {
      await teardown(owner, batchIds);
      const residue = await census(owner, batchIds, issueIds);
      check('zero fixture residue after teardown', Object.values(residue).every((n) => n === 0), JSON.stringify(residue));
    } finally {
      if (importer !== owner) await importer.end({ timeout: 5 });
      await owner.end({ timeout: 5 });
    }
  }
  const failed = checks.filter((c) => !c.pass);
  console.log(`\nAFLDB-ISSUE-239/240/241 code_test_db rehearsal: ${checks.length - failed.length}/${checks.length} checks PASS`);
  return failed.length === 0 ? 0 : 1;
}

async function residueOnly(): Promise<number> {
  const dsns = resolveRehearsalDsns(process.env, { allowOwnerImportDsn: true });
  const owner = postgres(dsns.ownerDsn, { max: 1, onnotice: () => {} });
  try {
    const residue = await census(owner, [], []);
    console.log(`fixture residue: ${JSON.stringify(residue)}`);
    return Object.values(residue).every((n) => n === 0) ? 0 : 1;
  } finally {
    await owner.end({ timeout: 5 });
  }
}

async function teardownOnly(): Promise<number> {
  const dsns = resolveRehearsalDsns(process.env, { allowOwnerImportDsn: true });
  const owner = postgres(dsns.ownerDsn, { max: 1, onnotice: () => {} });
  try {
    // Batches from a dead run: the loader's carry the rehearsal's all-zero artefact hash in their
    // notes (no real artefact hashes to it); the recovery's name code_test_db as the ledger.
    const batches = await owner<{ id: string }[]>`
      SELECT id::text AS id FROM import_batches
       WHERE (tool = 'tools/migration/import_afl_api_player_bridge.ts' AND notes LIKE ${`%artefact_sha256=${'0'.repeat(64)}`})
          OR (tool = 'tools/migration/recover_afl_api_adjudications.ts' AND validation_result->>'ledger_database' = 'code_test_db')
    `;
    await teardown(owner, batches.map((b) => b.id));
    const residue = await census(owner, [], []);
    console.log(`teardown done; fixture residue: ${JSON.stringify(residue)}`);
    return Object.values(residue).every((n) => n === 0) ? 0 : 1;
  } finally {
    await owner.end({ timeout: 5 });
  }
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  const acknowledged = rest.includes('--acknowledge') && rest[rest.indexOf('--acknowledge') + 1] === BULK_REHEARSAL.database;
  if (command === 'run' || command === 'teardown') {
    if (!acknowledged) throw new RehearsalRefused(`${command} needs --acknowledge ${BULK_REHEARSAL.database}.`);
    return command === 'run' ? run() : teardownOnly();
  }
  if (command === 'residue') return residueOnly();
  throw new RehearsalRefused(`usage: run --acknowledge code_test_db | residue | teardown --acknowledge code_test_db `
    + `(needs ${REHEARSAL_OWNER_ENV}; ${REHEARSAL_IMPORT_ENV} or --allow-owner-import-dsn)`);
}

if (process.argv[1] && /afl-api-identity-bulk-rehearsal\.ts$/.test(process.argv[1])) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(`REFUSED: ${redact((error as Error).message)}`);
      process.exit(1);
    });
}
