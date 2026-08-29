/**
 * AFLDB-ISSUE-100 L3B2 — lineup persistence against real PostgreSQL.
 *
 * Drives the REAL `persistLineupBundle()` against `afldb_test`: the
 * migration-074 spine, the migration-077 typed projection, and the linkage
 * between them, all read back out of the database rather than asserted from
 * values carried forward in memory.
 *
 * ISOLATION MODEL — COMMITTED OUTPUT, exactly as
 * `tests/integration/settle-afltables.test.ts` established and for the same
 * reason: `persistLineupBundle()` opens its OWN transaction, and postgres.js
 * gives a `TransactionSql` only `savepoint` and `prepare`, never `begin`. The
 * spine suite's outer-transaction-that-always-rolls-back pattern therefore
 * cannot wrap this driver. A test-only savepoint seam inside the production
 * boundary was not added: the transaction envelope is part of what is under
 * test.
 *
 * SO: THIS SUITE TEMPORARILY MUTATES `afldb_test`. It commits the
 * ISSUE-100-owned output of its runs and removes it afterwards. The invariant
 * it proves is NOT "no database change" — it is that **no canonical row is
 * written by the lineup pass**:
 *
 *   committed by the pass    import_batches, the migration-074 spine, the
 *                            migration-077 typed projection
 *   NEVER written            players, matches, player_match_stats, clubs,
 *                            promotion_candidates
 *
 * `seasons` and `sources` are READ, never written: the fixture uses the real
 * in-progress season and the real `afl_api` row migration 077 registered.
 *
 * THE CASES RUN IN ORDER AND SHARE COMMITTED STATE, deliberately: they trace
 * one record's lifecycle — staged, linked, re-imported unchanged, then revised
 * — which is the behaviour under test and cannot be observed from independent
 * cases. A failure early in the file will therefore cascade; read the first
 * failure, not the last.
 *
 * Everything this suite owns is namespaced by the provider match id
 * `CD_M2099ISSUE100`, which appears nowhere else in the repository. Cleanup
 * runs BEFORE setup as well as in `afterAll`, because an interrupted earlier
 * run can leave committed rows behind. That cleanup deletes THIS SUITE'S OWN
 * output; it is teardown, and it is not part of the persistence path the
 * no-DELETE invariant constrains.
 *
 * @see src/db/migrations/077_afl_api_lineups.sql (applied, checksum-frozen)
 * @see tests/afl-api-lineup-store.test.ts (the DB-free contract home)
 */
import './guard';

import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import {
  buildLineupBundle,
  type LineupAcquisitionRef,
  type LineupBundle,
  type LineupSourceRow,
} from '@/lib/acquisition/lineup-bundle';
import { persistLineupBundle } from '@/lib/acquisition/lineup-store';
import {
  getSourceFamily,
  parseSourceFamilyRegistry,
} from '@/lib/acquisition/source-families';

import { createImportRoleParityHarness } from './import-role-parity';

const importRole = createImportRoleParityHarness(
  process.env.AFLDB_TEST_DATABASE_URL,
  process.env.AFLDB_TEST_IMPORT_DATABASE_URL,
);
const roleParitySuffix = importRole.isConfigured ? '' : ` — ${importRole.skipMessage}`;

const registry = parseSourceFamilyRegistry(
  JSON.parse(readFileSync('data/reference/source-families.json', 'utf8')),
);
const contract = getSourceFamily(registry, 'afl_api', 'lineup');

/** This suite's namespace. Appears nowhere else in the repository. */
const NS = 'CD_M2099ISSUE100';
/** The owner-path provider match id. */
const MATCH = NS;
/**
 * The restricted-role provider match id, distinct so afldb_import's committed
 * rows can never be mistaken for the owner path's — the owner cases assert
 * exact row counts on `MATCH` alone.
 */
const MATCH_RESTRICTED = `${NS}R`;
/** Every provider match id this suite owns, for cleanup. */
const OWNED_MATCHES = [MATCH, MATCH_RESTRICTED];
const TEAM = 'CD_T2099';
const PLAYER_A = 'CD_I209901';
const PLAYER_B = 'CD_I209902';
/** The real in-progress season; read only, never written. */
const SEASON = 2026;
const ROUND = 20;

const COLUMNS = [
  'providerId', 'utcStartTime', 'status', 'compSeason.shortName', 'round.name',
  'round.roundNumber', 'venue.name', 'teamAbbr', 'teamName', 'teamNickname',
  'teamId', 'position', 'player.playerId', 'player.captain',
  'player.playerJumperNumber', 'player.playerName.givenName',
  'player.playerName.surname', 'teamStatus', 'teamType', 'lateChanges',
] as const;

const ACQUISITION: LineupAcquisitionRef = {
  snapshotLabel: 'issue100-integration',
  manifestPath: 'data/sources/afl_api/lineups/issue100-integration',
  manifestSha256: '',
  artefactSha256: 'c'.repeat(64),
  acquisitionKind: 'round_lineup_snapshot',
  fitzroyVersion: '1.8.0',
};

function row(overrides: Partial<Record<string, unknown>> = {}): LineupSourceRow {
  return {
    'providerId': MATCH,
    'utcStartTime': '2026-08-21T09:20:00.000+00:00',
    'status': 'CONCLUDED',
    'compSeason.shortName': 'Premiership',
    'round.name': 'Round 20',
    'round.roundNumber': ROUND,
    'venue.name': 'Marvel Stadium',
    'teamAbbr': 'STK',
    'teamName': 'St Kilda',
    'teamNickname': 'Saints',
    'teamId': TEAM,
    'position': 'RK',
    'player.playerId': PLAYER_A,
    'player.captain': false,
    'player.playerJumperNumber': 47,
    'player.playerName.givenName': 'Alix',
    'player.playerName.surname': 'Caminiti',
    'teamStatus': 'FINAL_TEAM',
    'teamType': 'away',
    'lateChanges': 'INS: A.Caminiti OUTS: R.Marshall(Injured)',
    ...overrides,
  } as LineupSourceRow;
}

function bundleOf(
  rows: readonly LineupSourceRow[], columns: readonly string[] = COLUMNS,
): LineupBundle {
  return buildLineupBundle({
    contract,
    season: SEASON,
    roundNumber: ROUND,
    observedColumns: columns,
    rows,
    acquisition: ACQUISITION,
  });
}

const idOf = (player: string, match: string = MATCH): string =>
  `${match}|${TEAM}|${player}`;

/**
 * Remove this suite's own committed output, child rows first.
 *
 * Teardown only. The no-DELETE invariant constrains the PERSISTENCE PATH, not
 * a harness cleaning up after itself, exactly as ISSUE-099's suite records.
 */
async function cleanup(): Promise<void> {
  // FK-SAFE ORDER, and the order matters in a way that is easy to get wrong.
  // `staging.source_records` is the CHILD of `staging.source_record_versions`:
  // migration 074 gives it a foreign key on
  // (source_id, family, external_record_id, current_version_seq) pointing at
  // the versions table. So the head row must go BEFORE the versions it points
  // at, not after. `tests/integration/settle-afltables.test.ts` deletes them in
  // this same order for the same reason.
  //
  //   afl_api_lineup  -> references source_record_versions (version_seq)
  //   source_records  -> references source_record_versions (current_version_seq)
  //   source_record_versions -> references source_payloads (payload_hash)
  //   source_records / afl_api_lineup -> reference import_batches
  // Scoped by EXACT provider match id throughout. `split_part` recovers the
  // first component of the composite external record id, so no LIKE pattern is
  // needed and the `_` in `CD_M...` cannot act as a single-character wildcard
  // inside a DELETE.
  await sql`
    DELETE FROM staging.afl_api_lineup
     WHERE provider_match_id = ANY(${OWNED_MATCHES})
  `;
  await sql`
    DELETE FROM staging.source_records
     WHERE family = 'lineup'
       AND split_part(external_record_id, '|', 1) = ANY(${OWNED_MATCHES})
  `;
  await sql`
    DELETE FROM staging.source_record_versions
     WHERE family = 'lineup'
       AND split_part(external_record_id, '|', 1) = ANY(${OWNED_MATCHES})
  `;
  // Payloads are content-addressed and carry no external record id, so they are
  // scoped by the provider match id INSIDE the payload — this suite's own
  // namespace — rather than by family, which would reach a real acquisition's
  // rows. The NOT EXISTS is a second guard: a payload another version still
  // references is never removed.
  await sql`
    DELETE FROM staging.source_payloads p
     WHERE p.family = 'lineup'
       AND p.raw_payload->>'providerId' = ANY(${OWNED_MATCHES})
       AND NOT EXISTS (
         SELECT 1 FROM staging.source_record_versions v
          WHERE v.source_id = p.source_id AND v.family = p.family
            AND v.payload_hash = p.payload_hash
       )
  `;
  await sql`
    DELETE FROM import_batches
     WHERE tool = 'lineup-store.ts' AND notes LIKE ${'%issue100-integration%'}
  `;
}

beforeAll(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await sql.end();
});

type ProjectionRow = {
  sourceId: number; family: string; externalRecordId: string; versionSeq: number;
  providerMatchId: string; providerTeamId: string; providerPlayerId: string;
  season: number; roundNumber: number; roundName: string | null;
  status: string; teamStatus: string;
  teamType: string | null; position: string | null; jumperNumber: string | null;
  teamNameRaw: string | null; teamAbbrRaw: string | null; teamNicknameRaw: string | null;
  matchId: number | null; clubId: number | null; playerId: number | null;
};

async function projections(match: string = MATCH): Promise<ProjectionRow[]> {
  return sql<ProjectionRow[]>`
    SELECT source_id AS "sourceId", family, external_record_id AS "externalRecordId",
           version_seq AS "versionSeq",
           provider_match_id AS "providerMatchId", provider_team_id AS "providerTeamId",
           provider_player_id AS "providerPlayerId",
           season, round_number AS "roundNumber", round_name AS "roundName",
           status, team_status AS "teamStatus",
           team_type AS "teamType", position, jumper_number AS "jumperNumber",
           team_name_raw AS "teamNameRaw", team_abbr_raw AS "teamAbbrRaw",
           team_nickname_raw AS "teamNicknameRaw",
           match_id AS "matchId", club_id AS "clubId", player_id AS "playerId"
      FROM staging.afl_api_lineup
     WHERE provider_match_id = ${match}
     ORDER BY external_record_id
  `;
}

async function versionsOf(externalRecordId: string): Promise<
  { versionSeq: number; observedTo: unknown }[]
> {
  return sql<{ versionSeq: number; observedTo: unknown }[]>`
    SELECT version_seq AS "versionSeq", observed_to AS "observedTo"
      FROM staging.source_record_versions
     WHERE family = 'lineup' AND external_record_id = ${externalRecordId}
     ORDER BY version_seq
  `;
}

async function rawPayloadOf(externalRecordId: string): Promise<Record<string, unknown>> {
  const [stored] = await sql<{ rawPayload: Record<string, unknown> }[]>`
    SELECT p.raw_payload AS "rawPayload"
      FROM staging.source_records r
      JOIN staging.source_record_versions v
        ON v.source_id = r.source_id AND v.family = r.family
       AND v.external_record_id = r.external_record_id
       AND v.version_seq = r.current_version_seq
      JOIN staging.source_payloads p
        ON p.source_id = v.source_id AND p.family = v.family
       AND p.payload_hash = v.payload_hash
     WHERE r.family = 'lineup' AND r.external_record_id = ${externalRecordId}
  `;
  return stored.rawPayload;
}

async function canonicalCounts(): Promise<Record<string, number>> {
  const [counts] = await sql<Record<string, number>[]>`
    SELECT (SELECT count(*)::int FROM players)              AS players,
           (SELECT count(*)::int FROM matches)              AS matches,
           (SELECT count(*)::int FROM player_match_stats)   AS "playerMatchStats",
           (SELECT count(*)::int FROM clubs)                AS clubs,
           (SELECT count(*)::int FROM promotion_candidates) AS "promotionCandidates",
           (SELECT count(*)::int FROM external_identities)  AS "externalIdentities"
  `;
  return counts;
}

describe('afl_api.lineup persistence', () => {
  it('targets a _test database with migration 077 applied', async () => {
    const [db] = await sql<{ db: string }[]>`SELECT current_database() AS db`;
    expect(db.db).toMatch(/_test$/);
    const [source] = await sql<{ key: string; kind: string }[]>`
      SELECT key, kind FROM sources WHERE key = 'afl_api'
    `;
    expect(source).toBeDefined();
    expect(source.kind).toBe('upstream_dataset');
    const [season] = await sql<{ year: number }[]>`
      SELECT year FROM seasons WHERE year = ${SEASON}
    `;
    expect(season).toBeDefined();
  });

  it('stages a valid provider row with every canonical FK unresolved', async () => {
    const result = await persistLineupBundle(sql, bundleOf([row()]), contract);
    expect(result.counters.recordsRead).toBe(1);
    expect(result.counters.versionsInserted).toBe(1);
    expect(result.counters.projectionsInserted).toBe(1);

    const [projected] = await projections();
    expect(projected.externalRecordId).toBe(idOf(PLAYER_A));
    expect(projected.providerMatchId).toBe(MATCH);
    expect(projected.providerTeamId).toBe(TEAM);
    expect(projected.providerPlayerId).toBe(PLAYER_A);
    expect(projected.season).toBe(SEASON);
    expect(projected.roundNumber).toBe(ROUND);
    expect(projected.status).toBe('CONCLUDED');
    expect(projected.teamStatus).toBe('FINAL_TEAM');
    // Unresolved canonical identity is an EXPECTED staging state, never a
    // reason to discard a valid provider row.
    expect(projected.matchId).toBeNull();
    expect(projected.clubId).toBeNull();
    expect(projected.playerId).toBeNull();
    expect(projected.teamType).toBe('away');
    expect(projected.position).toBe('RK');
    expect(projected.jumperNumber).toBe('47');
    expect(projected.teamNameRaw).toBe('St Kilda');
    expect(projected.teamAbbrRaw).toBe('STK');
    expect(projected.roundName).toBe('Round 20');
  });

  it('links the projection to the exact persisted source version', async () => {
    const [projected] = await projections();
    const [head] = await sql<{ currentVersionSeq: number; absentSince: unknown }[]>`
      SELECT current_version_seq AS "currentVersionSeq", absent_since AS "absentSince"
        FROM staging.source_records
       WHERE source_id = ${projected.sourceId}
         AND family = 'lineup' AND external_record_id = ${idOf(PLAYER_A)}
    `;
    expect(head).toBeDefined();
    expect(projected.versionSeq).toBe(head.currentVersionSeq);
    // Absence is disabled for this family; nothing may stamp it.
    expect(head.absentSince).toBeNull();

    const versions = await versionsOf(idOf(PLAYER_A));
    expect(versions).toHaveLength(1);
    expect(versions[0].versionSeq).toBe(projected.versionSeq);
    expect(versions[0].observedTo).toBeNull();

    // The projection agrees with the spine on all three identity columns.
    const [agrees] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n
        FROM staging.afl_api_lineup l
        JOIN staging.source_record_versions v
          ON v.source_id = l.source_id AND v.family = l.family
         AND v.external_record_id = l.external_record_id
         AND v.version_seq = l.version_seq
       WHERE l.provider_match_id = ${MATCH}
    `;
    expect(agrees.n).toBe(1);
  });

  it('keeps raw fidelity in the payload the projection narrows', async () => {
    const payload = await rawPayloadOf(idOf(PLAYER_A));
    // captain false stays false: never null, never reinterpreted.
    expect(payload['player.captain']).toBe(false);
    // lateChanges verbatim and unparsed; no typed column exists for it.
    expect(payload.lateChanges).toBe('INS: A.Caminiti OUTS: R.Marshall(Injured)');
    // The integer stays an integer in raw evidence; only the typed projection
    // carries the text form the frozen schema requires.
    expect(payload['player.playerJumperNumber']).toBe(47);
    const [projected] = await projections();
    expect(projected.jumperNumber).toBe('47');
  });

  it('is idempotent: an identical bundle invents no revision and no duplicate row', async () => {
    const second = await persistLineupBundle(sql, bundleOf([row()]), contract);
    expect(second.counters.versionsInserted).toBe(0);
    expect(second.counters.headsRefreshed).toBe(1);
    expect(second.counters.projectionsInserted).toBe(0);
    expect(second.counters.projectionsUpdated).toBe(1);

    expect(await projections()).toHaveLength(1);
    const versions = await versionsOf(idOf(PLAYER_A));
    expect(versions).toHaveLength(1);
    expect((await projections())[0].versionSeq).toBe(1);
  });

  it('replays a revision: new version, projection moves forward, history kept', async () => {
    await persistLineupBundle(sql, bundleOf([row({
      'status': 'SCHEDULED',
      'teamStatus': 'PROVISIONAL_TEAM',
      'position': 'INT',
    })]), contract);

    const [projected] = await projections();
    expect(projected.status).toBe('SCHEDULED');
    expect(projected.teamStatus).toBe('PROVISIONAL_TEAM');
    expect(projected.position).toBe('INT');
    expect(projected.versionSeq).toBe(2);

    // History is appended, never rewritten, and never deleted.
    const versions = await versionsOf(idOf(PLAYER_A));
    expect(versions.map((v) => v.versionSeq)).toEqual([1, 2]);
    expect(versions[0].observedTo).not.toBeNull();
    expect(versions[1].observedTo).toBeNull();
    // Still exactly one typed row: it is the LATEST view of that history.
    expect(await projections()).toHaveLength(1);
  });

  it('keeps an omitted optional column absent rather than fabricating null', async () => {
    const withoutLateChanges = Object.fromEntries(
      Object.entries(row({ 'player.playerId': PLAYER_B })).filter(
        ([k]) => k !== 'lateChanges',
      ),
    ) as LineupSourceRow;
    await persistLineupBundle(
      sql,
      bundleOf([withoutLateChanges], COLUMNS.filter((c) => c !== 'lateChanges')),
      contract,
    );
    const payload = await rawPayloadOf(idOf(PLAYER_B));
    expect('lateChanges' in payload).toBe(false);
    expect(await projections()).toHaveLength(2);
  });

  it('writes no canonical row and queues no promotion candidate', async () => {
    const before = await canonicalCounts();
    await persistLineupBundle(sql, bundleOf([
      row({ 'position': 'FB' }),
      row({ 'player.playerId': PLAYER_B, 'position': 'INT' }),
    ]), contract);
    expect(await canonicalCounts()).toEqual(before);
  });

  it('refuses to project another source\'s bundle', async () => {
    const foreign = { ...bundleOf([row()]), source_key: 'afltables' };
    await expect(persistLineupBundle(sql, foreign, contract)).rejects
      .toThrow(/never projected into staging\.afl_api_lineup/);
  });

  it('records the batch against the resolved afl_api source only', async () => {
    const { batchId } = await persistLineupBundle(sql, bundleOf([row()]), contract);
    // AFLDB-ISSUE-105: `import_batches.id` is bigint, so the driver returns
    // decimal text and `LineupPersistResult.batchId` says so. The value below
    // is bound straight back into a bigint comparison, uncast.
    expect(typeof batchId).toBe('string');
    const [batch] = await sql<{
      sourceKey: string; tool: string; targetTable: string;
      recordsRead: number; status: string;
    }[]>`
      SELECT s.key AS "sourceKey", b.tool, b.target_table AS "targetTable",
             b.records_read::int AS "recordsRead", b.status::text AS status
        FROM import_batches b JOIN sources s ON s.id = b.source_id
       WHERE b.id = ${batchId}
    `;
    expect(batch.sourceKey).toBe('afl_api');
    expect(batch.tool).toBe('lineup-store.ts');
    expect(batch.targetTable).toBe('staging.afl_api_lineup');
    expect(batch.recordsRead).toBe(1);
    expect(batch.status).toBe('completed');
  });

  /* ---------------------------------------------------------------- *
   * Restricted importer role
   * ---------------------------------------------------------------- */

  it.skipIf(!importRole.isConfigured)(
    `runs the whole lineup write path under the restricted afldb_import role${roleParitySuffix}`,
    async () => {
      // Proves same _test database, owner is afldb_owner, restricted is
      // afldb_import, and that afldb_import genuinely lacks a privilege it
      // must not have (42501 on auth_users). connect() refuses until this has
      // passed, so the connection below cannot silently be the owner's.
      const validation = await importRole.validate();
      expect(validation.restricted.role).toBe('afldb_import');
      expect(validation.restricted.database).toMatch(/_test$/);

      const restricted = importRole.connect();
      try {
        // Stated again from the connection actually used, so the assertion is
        // about this session rather than about the harness's earlier one.
        const [identity] = await restricted<{ db: string; role: string }[]>`
          SELECT current_database() AS db, current_user AS role
        `;
        expect(identity.db).toMatch(/_test$/);
        expect(identity.role).toBe('afldb_import');

        const restrictedRow = (overrides: Partial<Record<string, unknown>> = {}) =>
          row({ providerId: MATCH_RESTRICTED, ...overrides });
        const recordId = idOf(PLAYER_A, MATCH_RESTRICTED);

        // 1. A valid provider row persists end to end under the restricted
        //    role, with every canonical FK unresolved.
        const first = await persistLineupBundle(
          restricted, bundleOf([restrictedRow()]), contract,
        );
        expect(first.counters.versionsInserted).toBe(1);
        expect(first.counters.projectionsInserted).toBe(1);

        const [staged] = await projections(MATCH_RESTRICTED);
        expect(staged.externalRecordId).toBe(recordId);
        expect(staged.providerMatchId).toBe(MATCH_RESTRICTED);
        expect(staged.status).toBe('CONCLUDED');
        expect(staged.jumperNumber).toBe('47');
        expect(staged.matchId).toBeNull();
        expect(staged.clubId).toBeNull();
        expect(staged.playerId).toBeNull();

        // The spine half, and the linkage between the two layers.
        const [head] = await restricted<{ currentVersionSeq: number; absentSince: unknown }[]>`
          SELECT current_version_seq AS "currentVersionSeq", absent_since AS "absentSince"
            FROM staging.source_records
           WHERE family = 'lineup' AND external_record_id = ${recordId}
        `;
        expect(staged.versionSeq).toBe(head.currentVersionSeq);
        expect(head.absentSince).toBeNull();

        // 2. Identical replay is idempotent: the head is refreshed, no second
        //    version is invented, and no duplicate typed row appears.
        const replay = await persistLineupBundle(
          restricted, bundleOf([restrictedRow()]), contract,
        );
        expect(replay.counters.versionsInserted).toBe(0);
        expect(replay.counters.headsRefreshed).toBe(1);
        expect(replay.counters.projectionsInserted).toBe(0);
        expect(replay.counters.projectionsUpdated).toBe(1);
        expect(await projections(MATCH_RESTRICTED)).toHaveLength(1);
        expect((await projections(MATCH_RESTRICTED))[0].versionSeq).toBe(1);

        // 3. A payload revision advances the spine version and moves the typed
        //    projection forward, keeping the earlier version as history.
        await persistLineupBundle(restricted, bundleOf([restrictedRow({
          status: 'SCHEDULED',
          teamStatus: 'PROVISIONAL_TEAM',
          position: 'INT',
        })]), contract);

        const [revised] = await projections(MATCH_RESTRICTED);
        expect(revised.versionSeq).toBe(2);
        expect(revised.status).toBe('SCHEDULED');
        expect(revised.position).toBe('INT');
        expect(await projections(MATCH_RESTRICTED)).toHaveLength(1);

        const versions = await restricted<{ versionSeq: number; observedTo: unknown }[]>`
          SELECT version_seq AS "versionSeq", observed_to AS "observedTo"
            FROM staging.source_record_versions
           WHERE family = 'lineup' AND external_record_id = ${recordId}
           ORDER BY version_seq
        `;
        expect(versions.map((v) => v.versionSeq)).toEqual([1, 2]);
        expect(versions[1].observedTo).toBeNull();

        // Canonical safety is proved once, on the owner connection, by
        // `canonicalCounts()` above — it brackets players, matches,
        // player_match_stats, clubs, promotion_candidates and
        // external_identities. Re-reading those tables as afldb_import would
        // test that role's SELECT grants rather than this pass's behaviour,
        // which is a different question and not ISSUE-100's.
        //
        // DELETE and TRUNCATE are NOT exercised here. afldb_import holds both
        // on the whole staging schema from privileges.sql; ISSUE-100's
        // invariant is that the production path never ISSUES them, and that is
        // proved by source assertion in tests/afl-api-lineup-store.test.ts —
        // not by executing a destructive statement against afldb_test.
      } finally {
        await restricted.end({ timeout: 5 });
      }
    },
  );
});
