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
  rebuildCensusScope, rolloverCensusScope,
  type CensusResult, type CensusScope,
} from '@/lib/rollover/afl-api-ownership-census';
import { runPsql, type SpawnSyncLike } from '../../tools/db/psql';
import { aflApiOwnershipCensusSql } from '../../tools/db/rebuild-test';

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

/** Synthetic throwaway clubs and the seasons the census cases use (existing seasons are left alone). */
const PLANT_CLUBS = `
SET CONSTRAINTS clubs_current_identity_id_fkey DEFERRED;
INSERT INTO club_organizations (name, slug)
SELECT 'ISSUE-316 census plant org ' || upper(x), 'issue316-census-org-' || x FROM (VALUES ('a'), ('b')) v(x);
INSERT INTO clubs (slug, name, short_name, abbreviation, current_identity_id, legacy_club_hist, organization_id)
SELECT 'issue316-census-club-' || x, 'ISSUE-316 census plant club ' || upper(x), 'Plant ' || upper(x),
       'PL' || upper(x), -1, 'issue316-census-club-' || x, o.id
  FROM (VALUES ('a'), ('b')) v(x) JOIN club_organizations o ON o.slug = 'issue316-census-org-' || x;
UPDATE clubs SET current_identity_id = id WHERE slug LIKE 'issue316-census-club-%';
INSERT INTO seasons (year, league, status)
SELECT y, 'AFL', st::season_status FROM (VALUES (2023, 'complete'), (2024, 'complete'), (2025, 'complete'), (2026, 'in_progress')) v(y, st)
ON CONFLICT (year) DO NOTHING;`;

/** One synthetic home-and-away match owned by `sourceKey`. */
function plantMatch(season: number, key: string, sourceKey: string): string {
  return `
INSERT INTO matches (match_key, season, round_code, round_number, round_type, is_final, match_date, venue_raw,
                   home_club_id, away_club_id, home_score, away_score, result, winner_club_id, margin,
                   attendance, attendance_status, source_id)
SELECT 'issue316-census-${key}', ${season}, '1', 1, 'home_and_away'::round_type, false, DATE '${season}-03-20',
       'ISSUE-316 census plant oval', a.id, b.id, 100, 80, 'home_win'::match_result, a.id, 20, NULL,
       'not_collected'::coverage_status, s.id
  FROM clubs a, clubs b, sources s
 WHERE a.slug = 'issue316-census-club-a' AND b.slug = 'issue316-census-club-b' AND s.key = '${sourceKey}';`;
}

/**
 * `n` extra synthetic home-and-away matches owned by `sourceKey` (default: not `afl_api`), so the
 * re-own cases below hold on an empty isolated database as well as on one that carries real matches.
 */
function plantMatches(season: number, n: number, sourceKey = 'afltables'): string {
  return `
INSERT INTO matches (match_key, season, round_code, round_number, round_type, is_final, match_date, venue_raw,
                     home_club_id, away_club_id, home_score, away_score, result, winner_club_id, margin,
                     attendance, attendance_status, source_id)
  SELECT 'issue316-census-fill-${season}-' || g, ${season}, g::text, g, 'home_and_away'::round_type, false,
         DATE '${season}-03-20' + g, 'ISSUE-316 census plant oval', a.id, b.id, 100, 80, 'home_win'::match_result,
         a.id, 20, NULL, 'not_collected'::coverage_status, s.id
    FROM generate_series(1, ${n}) g, clubs a, clubs b, sources s
   WHERE a.slug = 'issue316-census-club-a' AND b.slug = 'issue316-census-club-b' AND s.key = '${sourceKey}';`;
}


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
    const run = psql([PLANT_CLUBS, plantMatches(2024, 3), plantMatches(2025, 1), plantMatches(2023, 2),
      reown(2024, 3), reown(2025, 1), reown(2023, 2, 'afltables'),
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
    const run = psql([PLANT_CLUBS, plantMatches(2025, 2), reown(2025, 2),
      aflApiOwnershipCensusBlock(scope, 'report'), rollback].join('\n'));
    const after = parseCensusOutput(run.output, scope);
    expect(count(after, 2025, 'inScope')).toBe(0);
    expect(count(after, 2025, 'outsideScope') - count(before, 2025, 'outsideScope')).toBe(2);
  });

  it('the ENFORCING form raises, naming every affected season and count, before the sentinel', () => {
    const before = baseline();
    const run = psql([PLANT_CLUBS, plantMatches(2024, 3), plantMatches(2025, 1), reown(2024, 3), reown(2025, 1),
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

/**
 * AFLDB-ISSUE-316 (closure limitation L1) — the candidate-2026 scope against a PLANTED AFL
 * API-owned match.
 *
 * The earlier census evidence ran on an empty or schema-absent database, so it proved the SQL runs
 * but not that the enforcing form refuses a real afl_api-owned 2026 match under the scope the
 * successor rebuild would have (1897..2026, 2026 included once the rollover completes it). The
 * matches here are SYNTHETIC: two throwaway clubs, a 2025 and a 2026 match owned by `afl_api`, and
 * a 2026 match owned by `afltables`, all inside the single `--single-transaction` stream that ends
 * in the deliberate rollback, so nothing is ever committed. Counts are deltas over a baseline
 * census, so the cases hold on a database that already carries real matches.
 */
describe('AFLDB-ISSUE-316 L1: candidate-2026 ownership enforcement against a planted afl_api match', () => {
  const CANDIDATE = rolloverCensusScope(1897, 2026, [2026]);
  const PREDECESSOR: CensusScope = { firstSeason: 1897, lastSeason: 2025, excludedSeasons: [2026] };

  it('the candidate scope is the one the rebuild itself derives from the successor documents', () => {
    const contract = { full_history: { season_range: { first_season: 1897, last_season: 2026 } } };
    const seasons = { first_season: 1897, last_season: 2026, in_progress_seasons: [] };
    expect(rebuildCensusScope(contract, seasons)).toEqual(CANDIDATE);
    expect(CANDIDATE).toEqual({ firstSeason: 1897, lastSeason: 2026, excludedSeasons: [] });
  });

  it('the rebuild stage runs exactly this enforcing block', () => {
    expect(aflApiOwnershipCensusSql(CANDIDATE)).toContain(aflApiOwnershipCensusBlock(CANDIDATE, 'enforce'));
  });

  it('REFUSES a planted afl_api-owned 2026 match under the candidate scope, naming 2026 and its count', () => {
    const before = baseline(CANDIDATE);
    const run = psql([PLANT_CLUBS, plantMatch(2026, '2026-a', 'afl_api'),
      aflApiOwnershipCensusBlock(CANDIDATE, 'enforce'), rollback].join('\n'));
    expect(run.status).not.toBe(0);
    expect(run.output).toContain(`${CENSUS_MARKER} REFUSED`);
    expect(run.output).not.toContain(SENTINEL);
    expect(run.output).toContain(`2026 (${count(before, 2026, 'inScope') + 1})`);
    // and nothing was committed
    expect(baseline(CANDIDATE)).toEqual(before);
  });

  it('CONTROL: the same planted 2026 match is outside the predecessor scope, so that scope does not refuse it', () => {
    const before = baseline(PREDECESSOR);
    const run = psql([PLANT_CLUBS, plantMatch(2026, '2026-a', 'afl_api'),
      aflApiOwnershipCensusBlock(PREDECESSOR, 'report'), rollback].join('\n'));
    expect(run.output).toContain(SENTINEL);
    const after = parseCensusOutput(run.output, PREDECESSOR);
    expect(count(after, 2026, 'inScope')).toBe(0);
    expect(count(after, 2026, 'outsideScope') - count(before, 2026, 'outsideScope')).toBe(1);
    const enforce = psql([PLANT_CLUBS, plantMatch(2026, '2026-a', 'afl_api'),
      aflApiOwnershipCensusBlock(PREDECESSOR, 'enforce'), rollback].join('\n'));
    expect(enforce.output).not.toContain(`${CENSUS_MARKER} REFUSED`);
  });

  it('a planted 2025 afl_api match is refused under BOTH scopes', () => {
    for (const scope of [CANDIDATE, PREDECESSOR]) {
      const before = baseline(scope);
      const run = psql([PLANT_CLUBS, plantMatch(2025, '2025-a', 'afl_api'),
        aflApiOwnershipCensusBlock(scope, 'enforce'), rollback].join('\n'));
      expect(run.status).not.toBe(0);
      expect(run.output).toContain(`${CENSUS_MARKER} REFUSED`);
      expect(run.output).toContain(`2025 (${count(before, 2025, 'inScope') + 1})`);
    }
  });

  it('CONTROL: a planted 2026 match owned by another source is never counted under the candidate scope', () => {
    const before = baseline(CANDIDATE);
    const run = psql([PLANT_CLUBS, plantMatch(2026, '2026-t', 'afltables'),
      aflApiOwnershipCensusBlock(CANDIDATE, 'report'), rollback].join('\n'));
    expect(run.output).toContain(SENTINEL);
    expect(count(parseCensusOutput(run.output, CANDIDATE), 2026, 'inScope')).toBe(count(before, 2026, 'inScope'));
  });
});
