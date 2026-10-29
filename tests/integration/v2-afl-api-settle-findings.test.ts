// tests | Integration test for the V2-GAP-025 AFL API settle refusals reader on PostgreSQL
/**
 * V2-GAP-025 — the operations centre's read of open AFL API settle refusals and findings, against a
 * REAL PostgreSQL (the isolated cluster's `_test` database), through the production executor:
 *
 *   withAwardProposalExecutor (afldb_import) -> readAflApiSettleFindings
 *
 * PGlite (tests/v2-admin-operations.test.ts) already proves the scoping, the paging and the bounds on
 * stub tables. What only a real cluster proves, and this suite checks:
 *  - the restricted `afldb_import` role can SELECT `data_issues` (migration 045 registry grant);
 *  - postgres.js `unsafe` binds a NULL and a decimal-text bigint cursor, and parses the jsonb field list;
 *  - `SET TRANSACTION ... READ ONLY` is accepted as the first statement inside `sql.begin`.
 *
 * TARGET: both AFLDB_TEST_DATABASE_URL (afldb_owner) and AFLDB_TEST_IMPORT_DATABASE_URL (afldb_import)
 * are required, and the run must come from the isolated runner (tools/v2/isolated-pg.ts). The reader
 * never falls back to the owner role.
 *
 * FIXTURES: synthetic `data_issues` rows marked with a marker unique to this run, inserted by the
 * owner connection only after that connection has passed `verifyIsolatedIntegrationDatabase`.
 * Teardown deletes only the ids this run's INSERTs returned, still requiring the run marker, and
 * writes nothing at all unless the identity checks passed. No startup purge: a row this run did not
 * create is never touched.
 */
import { verifyIsolatedIntegrationDatabase } from './guard';

import { createImportRoleParityHarness } from './import-role-parity';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readAflApiSettleFindings } from '@/db/queries/afl-api-settle-findings';
import { withAwardProposalExecutor } from '@/db/queries/award-proposals';

const ownerDsn = process.env.AFLDB_TEST_DATABASE_URL;
const importDsn = process.env.AFLDB_TEST_IMPORT_DATABASE_URL;
if (!ownerDsn || !importDsn) {
  throw new Error(
    'V2-GAP-025 integration test refused: both AFLDB_TEST_DATABASE_URL (afldb_owner) and '
    + 'AFLDB_TEST_IMPORT_DATABASE_URL (afldb_import) must be set.',
  );
}
const importRole = createImportRoleParityHarness(ownerDsn, importDsn);

const MARKER = `v2-gap025-it-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
const owner = postgres(ownerDsn, { max: 1, onnotice: () => {} });
const ids: Record<string, string> = {};
const created: string[] = [];
let verified = false;

async function issue(name: string, type: string, details: Record<string, unknown>): Promise<void> {
  if (!verified) throw new Error('Fixture write refused: the owner connection has not been verified.');
  const [row] = await owner<{ id: string }[]>`
    INSERT INTO data_issues (entity_type, issue_type, severity, description, details)
    VALUES ('player_match_stats', ${type}, 'warning'::issue_severity, ${`SYNTHETIC ${MARKER} ${name}`},
            ${owner.json({ ...details, it_marker: MARKER } as never)})
    RETURNING id::text AS id`;
  ids[name] = row.id;
  created.push(row.id);
}

/** The production executor, connected as the validated afldb_import DSN and nothing else. */
const read = (options: Parameters<typeof readAflApiSettleFindings>[1]) => importRole.withImportDsn(
  () => withAwardProposalExecutor((executor) => readAflApiSettleFindings(executor, options)),
);

beforeAll(async () => {
  const proof = await importRole.validate();
  expect(proof.owner.role).toBe('afldb_owner');
  expect(proof.restricted.role).toBe('afldb_import');
  expect(proof.restricted.database).toMatch(/_test$/);

  // The exact connection that writes the fixtures: isolated cluster, marked database, owner role.
  const database = await verifyIsolatedIntegrationDatabase(owner);
  const [identity] = await owner<{ database: string; currentUser: string; sessionUser: string }[]>`
    SELECT current_database() AS database, current_user AS "currentUser", session_user AS "sessionUser"`;
  expect(identity).toEqual({ database, currentUser: 'afldb_owner', sessionUser: 'afldb_owner' });
  // The reader's role reaches the same isolated database.
  const reader = importRole.connect();
  try {
    expect(await verifyIsolatedIntegrationDatabase(reader)).toBe(database);
  } finally {
    await reader.end({ timeout: 5 });
  }
  verified = true;

  const refusal = { owner: 'AFLDB-ISSUE-122', source_key: 'afl_api', family: 'player_match_stats', target_table: 'player_match_stats', fields: ['kicks', 'marks'] };
  await issue('refusedA', 'canonical_apply_failed', { ...refusal, external_record_id: `${MARKER}-A`, refusal: 'foreign_source_owner' });
  await issue('afltables', 'canonical_apply_failed', { ...refusal, source_key: 'afltables', external_record_id: `${MARKER}-T` });
  await issue('refusedB', 'canonical_apply_failed', { ...refusal, external_record_id: `${MARKER}-B`, refusal: 'stale_canonical_target', error: 'SECRET-SQL-DETAIL' });
  await issue('settle', 'afl_api_settle', { owner: 'settle-afl-api.ts', source_key: 'afl_api', external_record_id: `${MARKER}-S` });
}, 60_000);

afterAll(async () => {
  try {
    if (verified && created.length > 0) {
      await owner`
        DELETE FROM data_issues
        WHERE id = ANY(${created}::bigint[]) AND details->>'it_marker' = ${MARKER}`;
    }
  } finally {
    await owner.end({ timeout: 5 });
  }
});

describe('V2-GAP-025 reader on PostgreSQL, as afldb_import', () => {
  it('reads the newest refusals after a decimal-text cursor, excludes AFL Tables, and returns no failure text', async () => {
    const above = (BigInt(ids.settle) + 1n).toString();
    const page = await read({ section: 'refusals', before: above, pageSize: 2 });
    expect(page.rows.map((row) => row.id)).toEqual([ids.refusedB, ids.refusedA]);
    expect(page.rows[0]).toMatchObject({ reason: 'stale_canonical_target', fields: ['kicks', 'marks'], externalRecordId: `${MARKER}-B` });
    expect(page.counts.refusals.total).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(page)).not.toContain('SECRET-SQL-DETAIL');
  });

  it('reads the settle findings from the newest page (NULL cursor) and the next page by the returned cursor', async () => {
    const first = await read({ section: 'findings', before: null, pageSize: 1 });
    expect(first.rows.map((row) => row.id)).toEqual([ids.settle]);
    if (first.nextBefore !== null) {
      const next = await read({ section: 'findings', before: first.nextBefore, pageSize: 1 });
      expect(next.rows.every((row) => BigInt(row.id) < BigInt(ids.settle))).toBe(true);
    }
  });
});
