/**
 * AFLDB-ISSUE-233 D-233-3 — the `afl_api` ownership census SQL against real PostgreSQL.
 *
 * The DB-free suite (tests/db-test-rebuild.test.ts) proves where the census sits in the
 * rebuild graph, that a failing census stops the run before the capture and the reset, and
 * how its output is parsed. Only a real database can prove the SQL itself counts the right
 * rows, so this file runs the census streams through the SAME psql path the rebuild uses.
 *
 * Nothing here can commit. The read-only census runs inside `SET TRANSACTION READ ONLY`.
 * Every scenario that needs `afl_api`-owned rows re-owns a few existing matches INSIDE one
 * `--single-transaction` psql stream that always ends in a deliberate exception, so the whole
 * stream rolls back (the tools/db/prove-reset.ts pattern). Counts are asserted as deltas over
 * a baseline census, so the test does not depend on how many `afl_api` rows the database
 * already holds.
 */
import './guard';

import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  CENSUS_MARKER, aflApiOwnershipCensusBlock, buildAflApiOwnershipCensusSql, parseCensusOutput,
  type CensusResult, type CensusScope,
} from '@/lib/rollover/afl-api-ownership-census';
import { runPsql, type SpawnSyncLike } from '../../tools/db/psql';

const DSN = process.env.AFLDB_TEST_DATABASE_URL!;
const SENTINEL = 'AFLDB-ISSUE-233-CENSUS-TEST-ROLLBACK';
const SCOPE: CensusScope = { firstSeason: 1897, lastSeason: 2025, excludedSeasons: [2026] };

function psql(sql: string) {
  const result = runPsql(DSN, sql, { spawn: spawnSync as SpawnSyncLike });
  return { ...result, output: `${result.stdout}\n${result.stderr}` };
}

/** Re-own `limit` matches of `season` (or a given source key) for the rest of the stream. */
function reown(season: number, limit: number, sourceKey = 'afl_api'): string {
  return `UPDATE matches SET source_id = (SELECT id FROM sources WHERE key = '${sourceKey}')
 WHERE id IN (SELECT m.id FROM matches m LEFT JOIN sources s ON s.id = m.source_id
               WHERE m.season = ${season} AND s.key IS DISTINCT FROM '${sourceKey}'
               ORDER BY m.id LIMIT ${limit});`;
}

const rollback = `DO $s$ BEGIN RAISE EXCEPTION '${SENTINEL}'; END $s$;`;

function count(result: CensusResult, season: number, where: 'inScope' | 'outsideScope'): number {
  return result[where].find((c) => c.season === season)?.aflApiMatches ?? 0;
}

function baseline(scope: CensusScope = SCOPE): CensusResult {
  const run = psql(buildAflApiOwnershipCensusSql(scope, 'report'));
  expect(run.status, run.output).toBe(0);
  return parseCensusOutput(run.output, scope);
}

describe('AFLDB-ISSUE-233 D-233-3 census SQL (rollback-only)', () => {
  it('the operational READ ONLY census runs and reports this database', () => {
    const before = baseline();
    expect(before.database).toBe(new URL(DSN).pathname.replace(/^\//, ''));
    expect(before.schemaPresent).toBe(true);
  });

  it('counts afl_api-owned matches per completed season, exactly, and nothing else', () => {
    const before = baseline();
    const run = psql([reown(2024, 3), reown(2025, 1), reown(2023, 2, 'afltables'),
      aflApiOwnershipCensusBlock(SCOPE, 'report'), rollback].join('\n'));
    expect(run.output).toContain(SENTINEL);
    const after = parseCensusOutput(run.output, SCOPE);
    expect(count(after, 2024, 'inScope') - count(before, 2024, 'inScope')).toBe(3);
    expect(count(after, 2025, 'inScope') - count(before, 2025, 'inScope')).toBe(1);
    // a match owned by any other source never counts
    expect(count(after, 2023, 'inScope')).toBe(count(before, 2023, 'inScope'));
    // and the stream rolled back: a fresh census sees the baseline again
    expect(baseline()).toEqual(before);
  });

  it('never treats an excluded (in-progress) season as completed', () => {
    const scope: CensusScope = { firstSeason: 1897, lastSeason: 2024, excludedSeasons: [2025] };
    const before = baseline(scope);
    const run = psql([reown(2025, 2), aflApiOwnershipCensusBlock(scope, 'report'), rollback].join('\n'));
    const after = parseCensusOutput(run.output, scope);
    expect(count(after, 2025, 'inScope')).toBe(0);
    expect(count(after, 2025, 'outsideScope') - count(before, 2025, 'outsideScope')).toBe(2);
  });

  it('the ENFORCING form raises, naming every affected season and count, before the sentinel', () => {
    const before = baseline();
    const run = psql([reown(2024, 3), reown(2025, 1),
      aflApiOwnershipCensusBlock(SCOPE, 'enforce'), rollback].join('\n'));
    expect(run.status).not.toBe(0);
    expect(run.output).toContain(`${CENSUS_MARKER} REFUSED`);
    expect(run.output).not.toContain(SENTINEL);
    expect(run.output).toContain(`2024 (${count(before, 2024, 'inScope') + 3})`);
    expect(run.output).toContain(`2025 (${count(before, 2025, 'inScope') + 1})`);
  });

  it('the ENFORCING form passes when no in-scope season is afl_api-owned', () => {
    // Re-own nothing; if the baseline already holds in-scope afl_api rows, the rebuild WOULD
    // refuse this database, and that is the finding this assertion reports.
    const before = baseline();
    expect(before.inScope, 'this database already holds afl_api-owned completed-season matches').toEqual([]);
    const run = psql([aflApiOwnershipCensusBlock(SCOPE, 'enforce'), rollback].join('\n'));
    expect(run.output).toContain(`${CENSUS_MARKER} verdict=pass total=0`);
    expect(run.output).toContain(SENTINEL);
  });
});
