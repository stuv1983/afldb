#!/usr/bin/env node
/**
 * AFLDB-ISSUE-229 — applies (or dry-runs) the RETAINED authentic 2027 AFL API season feed to a
 * DISPOSABLE isolated database through the real fixture writer, and prints a JSON report.
 *
 *   node --import tsx tools/v2/isolated-pg.ts run <afldb_v2_*_test> -- \
 *     node --import tsx tools/v2/issue229-retained-feed-proof.ts --mode dry-run|apply [--expect-schema 118]
 *
 * It exists for the migration-118 / rollback-compatibility qualification and for the admin-UI visual
 * evidence: it needs real clubs and venues, so it runs against a production-derived clone, never an
 * empty database. It is NOT the production settle tool (`tools/current-season/settle-afl-api-fixture-schedule.ts`):
 * it reads no operator snapshot, ignores the ingestion switch, and refuses to run anywhere except
 * inside the isolated-pg runner (`AFLDB_V2_ISOLATED_PG=1`) on a `_test` database.
 *
 * The feed is the committed, hash-bound test fixture (`tests/fixtures/afl_api/seasons/01-season-matches-2027.raw.json`,
 * sha256 21fd12e7704b7c7146cfbab414352352f3cfaa53e7ef5038f4411fa789e4c84d). The report carries counts only.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import {
  parseAcknowledgedUnobservedStatuses,
  parseSourceFamilyRegistry,
  stageAflApiFixtureFeed,
} from '@afldb/acquisition';
import { postgresExecutor } from '@afldb/db';

import { parseAflApiIdentities } from '../../src/lib/acquisition/afl-api-bundle';
import { settleAflApiFixtureStage } from '../../src/lib/acquisition/afl-api-fixture-writer';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FEED = join(root, 'tests', 'fixtures', 'afl_api', 'seasons', '01-season-matches-2027.raw.json');
const FEED_SHA256 = '21fd12e7704b7c7146cfbab414352352f3cfaa53e7ef5038f4411fa789e4c84d';

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function main(): Promise<void> {
  if (process.env.AFLDB_V2_ISOLATED_PG !== '1') {
    throw new Error('refused: run this only through `tools/v2/isolated-pg.ts run <afldb_v2_*_test> -- ...`.');
  }
  const mode = arg('--mode');
  if (mode !== 'dry-run' && mode !== 'apply') throw new Error('--mode dry-run|apply is required.');
  const dsn = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!dsn) throw new Error('refused: no import DSN from the isolated runner.');
  const ownerDsn = process.env.AFLDB_TEST_DATABASE_URL;
  if (!ownerDsn) throw new Error('refused: no owner DSN from the isolated runner.');
  // The import role writes through the real writer; the owner role only counts (the import role cannot read afldb_meta).
  const sql = postgres(dsn, { max: 1, onnotice: () => {}, transform: { undefined: null } });
  const owner = postgres(ownerDsn, { max: 1, onnotice: () => {} });
  try {
    const [{ db }] = await sql<{ db: string }[]>`SELECT current_database() AS db`;
    if (!/^afldb_v2_.+_test$/.test(db)) throw new Error(`refused: ${db} is not an isolated _test database.`);
    const [{ n: schema }] = await owner<{ n: number }[]>`SELECT count(*)::int AS n FROM afldb_meta.schema_migrations`;
    const expected = arg('--expect-schema');
    if (expected !== undefined && Number(expected) !== schema) {
      throw new Error(`refused: schema ledger is ${schema}, expected ${expected}.`);
    }

    const bytes = readFileSync(FEED);
    const sha = createHash('sha256').update(bytes).digest('hex');
    // The committed fixture is the parsed feed envelope; its recorded provider hash is the pinned one.
    const envelope = JSON.parse(bytes.toString('utf8')) as { matches: Record<string, unknown>[] };
    const readJson = (...parts: string[]): unknown => JSON.parse(readFileSync(join(root, ...parts), 'utf8'));
    const identities = parseAflApiIdentities(readJson('data', 'reference', 'afl-api-identities.json'));
    const registry = parseSourceFamilyRegistry(readJson('data', 'reference', 'source-families.json'));
    const stage = stageAflApiFixtureFeed(envelope.matches, { registry, identities }, {
      season: 2027, acknowledgedUnobservedStatuses: parseAcknowledgedUnobservedStatuses([]),
    });
    const outcome = await settleAflApiFixtureStage(postgresExecutor(sql), {
      stage, mode,
      provenance: { tool: 'issue229-retained-feed-proof.ts', snapshotLabel: 'afl-api-2027-2026-11-01-012026', manifestSha256: FEED_SHA256 },
    });
    const kinds: Record<string, number> = {};
    for (const action of outcome.actions) kinds[action.kind] = (kinds[action.kind] ?? 0) + 1;
    const [counts] = await owner<Record<string, number>[]>`
      SELECT count(*)::int AS fixtures,
             (count(*) FILTER (WHERE confirmation = 'confirmed'))::int AS confirmed,
             (count(*) FILTER (WHERE confirmation = 'unconfirmed'))::int AS unconfirmed,
             (count(*) FILTER (WHERE home_club_id IS NULL OR away_club_id IS NULL))::int AS "labelParticipants",
             (count(*) FILTER (WHERE confirmation = 'unconfirmed' AND (match_date IS NOT NULL OR match_time IS NOT NULL)))::int AS "unconfirmedWithDateOrTime",
             (count(*) FILTER (WHERE confirmation = 'confirmed' AND (match_date IS NULL OR match_time IS NULL)))::int AS "confirmedWithoutDateOrTime"
        FROM fixtures WHERE season = 2027`;
    console.log(JSON.stringify({
      database: db, schemaLedger: schema, mode, feedFixtureSha256: sha, feedProviderSha256: FEED_SHA256,
      records: envelope.matches.length, status: outcome.status, batchId: outcome.batchId ?? null, actions: kinds, fixtures2027: counts,
    }, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
    await owner.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
