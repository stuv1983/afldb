/**
 * Release gates.
 *
 * Each test here corresponds to a stated condition for considering the
 * Brownlow correction and the grain separation finished. They are
 * deliberately separate from database.test.ts: those tests describe how
 * the system behaves, these describe what must never regress.
 *
 * Two classes of assertion are kept apart on purpose:
 *
 *   IMMUTABLE   Historical figures that cannot change no matter how many
 *               times the source is reloaded. A failure is a real defect.
 *
 *   SNAPSHOT    Figures tied to the 2026 season, which is still being
 *               played. These are pinned to the loaded snapshot and are
 *               EXPECTED to change when newer data is imported. A failure
 *               means "re-pin", not "bug".
 *
 * AFLDB-ISSUE-363 (owner decisions 363-W, 363-G, 363-B, run 4) changed how the
 * calendar enters this file:
 *
 *   - A HISTORICAL figure is asserted over an explicit season bound (through
 *     2025, the last season the retired baselines measured) and over stable
 *     keys (AFL Tables profile path, club slug), never a surrogate id.
 *   - A figure about the data as it is NOW is asserted as an equality with an
 *     independent raw-SQL oracle written in the test, not as a literal that
 *     goes stale when a season completes.
 *   - No test assumes that the current calendar year has an open season. The
 *     provisional-season contracts run on a season this file establishes itself
 *     inside a transaction that is always rolled back (2065, 2066: the `gates`
 *     fixture range, synthetic prefix CD_I4020), so this file never commits.
 *   - The accepted-rebuild pins (the birth-date population counts) stay
 *     baseline-pinned: they hold on the accepted c2-2026-final-core-v1 rebuild
 *     and are EXPECTED to fail on the 4 Nov production snapshot, where the 92
 *     2026 debutants carry no birth date. They will go stale when the next
 *     baseline is accepted (a season added to the fitzRoy core, or a club-list
 *     snapshot newer than club-lists-20260905). Each says so where it is pinned.
 */
import './guard';

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import {
  recomputeBrownlowCoverage,
  recomputeClubSeasons,
  recomputePlayerDerivedStats,
  recomputeSeasonBrownlowStatus,
  recomputeSeasonMetadata,
} from '@/db/queries/player-derived';

import {
  lockDraftTables, unlockDraftTables,
  lockHonoursTables, unlockHonoursTables,
  lockBirthDateEnrichment, unlockBirthDateEnrichment,
} from './draft-lock';
import { assertNoLeakedFixtureSeasons } from './leaked-fixtures';
import { runAdvancedSearch } from '@/db/queries/advanced-search';
import { runMatchSearch } from '@/db/queries/match-search';
import { parseAdvancedQuery } from '@/search/advanced-spec';
import { parseMatchSearchQuery } from '@/search/match-spec';

const integrationDsn = process.env.AFLDB_TEST_DATABASE_URL as string;

// AFLDB-ISSUE-090: `gate: birth dates` reads dob_conflict/dob_internal_conflict
// and players.dob_disputed, which tests/integration/dob-enrichment-issues.test.ts
// also writes. File-level, beside the honours lock, so the whole read/write
// window is covered rather than just one describe block. Acquisition order
// (documented in draft-lock.ts): honours -> birth dates -> draft.
// TST-9: the "only season in progress" gate reads the whole seasons table; a fixture season leaked by an
// interrupted committed-fixture suite would fail it with a bare year. Say what happened instead.
beforeAll(() => assertNoLeakedFixtureSeasons(sql));
beforeAll(() => lockHonoursTables(integrationDsn), 300_000);
beforeAll(() => lockBirthDateEnrichment(integrationDsn), 300_000);
afterAll(async () => {
  await unlockBirthDateEnrichment();
  await unlockHonoursTables();
  await sql.end();
});

// ---------------------------------------------------------------------
// Brownlow authority
// ---------------------------------------------------------------------
// AFLDB-ISSUE-108 retired the legacy SQLite source of the season- and career-grain
// Brownlow totals (79,113), and until AFLDB-ISSUE-113 the canonical rebuild had NO
// writer for brownlow_season_votes (AFLDB-ISSUE-090 §27.5), so the value assertions
// below were skipped rather than re-pinned to zero. AFLDB-ISSUE-113 §8.6 landed the
// legacy-free writer — tools/migration/import_brownlow_season.py, loading the tracked
// artefact data/brownlow/season-votes.csv, whose 79,113 total is measured from the
// preserved authoritative source and verified by the loader before it writes — so
// they are re-armed. The representative witnesses are resolved FROM THE DATA by AFL
// Tables profile path, never by a pinned players.id: the canonical rebuild re-seeds
// that surrogate (the retired pins 3702/3578 had come to denote David Stark and Des
// Field).
describe('gate: Brownlow authority', () => {
  const AUTHORITATIVE_TOTAL = 79_113;

  it('season votes total exactly 79,113', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT sum(votes)::int AS n FROM brownlow_season_votes
    `;
    expect(row.n).toBe(AUTHORITATIVE_TOTAL);
  });

  it('career totals sum to the authoritative total, not the per-game total', async () => {
    const [row] = await sql<{ career: number; perGame: number | null }[]>`
      SELECT (SELECT sum(brownlow_votes)::int FROM player_career_stats)  AS career,
             (SELECT sum(brownlow_votes)::int FROM player_match_stats)   AS "perGame"
    `;
    expect(row.career).toBe(AUTHORITATIVE_TOTAL);
    // The per-game table is incomplete by design (1935-1983 was never kept at match
    // grain); it must never be the source of a career figure. AFLDB-ISSUE-113: the
    // canonical per-game column is fitzRoy-sourced, so the retired legacy figure
    // (46,979) is not re-pinned here; the invariant is that it falls short. Measured
    // on the canonical rebuild (§8.17.3): 46,970 over 336,821 non-NULL rows.
    expect(row.perGame ?? 0).toBeLessThan(AUTHORITATIVE_TOTAL);
  });

  it('season-grain table cannot inflate the total', async () => {
    // The bug this gate exists for: when the season table was keyed by
    // club, 44 polling player-seasons split across two clubs contributed
    // their whole total twice, giving 79,280.
    const [row] = await sql<{ n: number }[]>`
      SELECT sum(brownlow_votes)::int AS n FROM player_season_stats
    `;
    expect(row.n).toBe(AUTHORITATIVE_TOTAL);
  });

  it('the club-grained table carries no award column at all', async () => {
    const rows = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'player_club_season_stats'
         AND column_name LIKE '%brownlow%'
    `;
    // Structural, not numeric: if no such column exists, no future query
    // can reintroduce the double count.
    expect(rows).toEqual([]);
  });

  it('stores at most one season row per player', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM (
        SELECT player_id, season FROM player_season_stats
        GROUP BY 1, 2 HAVING count(*) > 1
      ) t
    `;
    expect(row.n).toBe(0);
  });

  it('never reads the broken legacy career_brownlow column', async () => {
    // players.career_brownlow belongs to the legacy SQLite database and
    // was 40.6% short. Nothing in AFLDB should reference it.
    const rows = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'career_brownlow'
    `;
    expect(rows).toEqual([]);
  });

  it('reports representative career totals, resolved by profile identity', async () => {
    const rows = await sql<{ url: string; votes: number; medals: number }[]>`
      SELECT ei.external_id AS url, c.brownlow_votes AS votes, c.brownlow_medals AS medals
        FROM player_career_stats c
        JOIN external_identities ei ON ei.player_id = c.player_id
        JOIN sources s ON s.id = ei.source_id AND s.key = 'afltables'
       WHERE ei.match_method = 'afltables_profile_url'
         AND ei.status IN ('unique', 'resolved')
         AND ei.external_id IN ('players/D/Dick_Reynolds.html', 'players/B/Bob_Skilton.html',
                                'players/H/Harley_Reid.html', 'players/M/Matt_Rowell.html',
                                'players/T/Tom_Green1.html')
    `;
    const votes = (url: string) => rows.find((r) => r.url === url)?.votes;
    // Every witness carries a profile identity, so a silently dropped player cannot
    // hide behind an undefined lookup.
    expect(rows).toHaveLength(5);
    // Dick Reynolds: 154 authoritative against 31 per-game; three medals.
    expect(votes('players/D/Dick_Reynolds.html')).toBe(154);
    // Bob Skilton: 180 authoritative; the per-game table has nothing at all.
    expect(votes('players/B/Bob_Skilton.html')).toBe(180);
    expect(rows.find((r) => r.url === 'players/B/Bob_Skilton.html')?.medals).toBe(3);
    // AFLDB-ISSUE-113 §8.1: the 1984+ witnesses whose totals the production defect
    // rendered as 0. Their careers sit inside round-vote coverage, so these are exact.
    expect(votes('players/H/Harley_Reid.html')).toBe(10);
    expect(votes('players/M/Matt_Rowell.html')).toBe(89);
    expect(votes('players/T/Tom_Green1.html')).toBe(73);
  });

  it('agrees with the canonical round votes for every career inside their coverage', async () => {
    // AFLDB-ISSUE-113 §8.7 V5, in gate form: for a player whose whole career falls in
    // 1984+ (complete round-vote coverage), the season-grain total the artefact
    // supplies must equal the sum of the independently acquired round votes. A
    // mismatch is a mis-keyed row or a real source disagreement, never noise.
    const [row] = await sql<{ careers: number; mismatches: number }[]>`
      WITH span AS (
        SELECT player_id, min(season) AS first_season
          FROM player_season_stats GROUP BY player_id
      ), rounds AS (
        SELECT player_id, sum(votes)::int AS votes
          FROM brownlow_round_votes GROUP BY player_id
      )
      SELECT count(*)::int AS careers,
             count(*) FILTER (WHERE c.brownlow_votes <> COALESCE(r.votes, 0))::int AS mismatches
        FROM player_career_stats c
        JOIN span sp ON sp.player_id = c.player_id
        LEFT JOIN rounds r ON r.player_id = c.player_id
       WHERE sp.first_season >= 1984
    `;
    expect(row.careers).toBeGreaterThan(1_000);
    expect(row.mismatches).toBe(0);
  });
});

// ---------------------------------------------------------------------
// IMMUTABLE — coverage semantics
// ---------------------------------------------------------------------
describe('gate: Brownlow coverage semantics', () => {
  it('distinguishes "no medal" from "polled nothing"', async () => {
    const rows = await sql<{ season: number; status: string; votes: number | null }[]>`
      SELECT DISTINCT season, brownlow_status AS status, brownlow_votes AS votes
        FROM player_season_stats
       WHERE season IN (1943, 1920)
    `;
    // 1920 predates the medal; 1943 is a war year in which none was awarded.
    for (const row of rows) {
      expect(row.status).toBe('not_applicable');
      expect(row.votes).toBeNull();
    }
  });

  // rebuild_derived.py derives brownlow_status as 'complete' ONLY when
  // brownlow_season_votes holds a row for that season. Between AFLDB-ISSUE-108 and
  // AFLDB-ISSUE-113 the canonical rebuild wrote none, so this gate was skipped rather
  // than pinned to 0 (0 would assert the absence of the very semantics it protects).
  // Re-armed unchanged with the ISSUE-113 season-grain writer.
  it('records a genuine zero for a player who polled none in a decided season', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM player_season_stats
       WHERE season = 2025 AND brownlow_votes = 0 AND brownlow_status = 'complete'
    `;
    // A decided season must produce real zeroes, otherwise "zero votes"
    // searches would silently exclude everyone who did not poll.
    expect(row.n).toBeGreaterThan(0);
  });

  it('constrains votes and status so the two cannot disagree', async () => {
    await expect(sql`
      INSERT INTO player_season_stats
        (player_id, season, games, brownlow_votes, brownlow_status)
      VALUES (1, 1900, 1, 5, 'not_applicable')
    `).rejects.toThrow();
  });

  it('publishes the three Brownlow grains separately', async () => {
    const rows = await sql<{ key: string }[]>`
      SELECT key FROM stat_definitions WHERE key LIKE 'brownlow%' ORDER BY key
    `;
    expect(rows.map((r) => r.key)).toEqual([
      'brownlow_match_votes',
      'brownlow_round_votes',
      'brownlow_season_total',
    ]);
  });
});

// ---------------------------------------------------------------------
// IMMUTABLE — Advanced Search, through the real service
// ---------------------------------------------------------------------
describe('gate: Advanced Search regression cases', () => {
  /** Drive the service exactly as a URL would, and collect every ID. */
  async function idsFor(params: Record<string, string>): Promise<number[]> {
    const ids: number[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const { query, errors } = parseAdvancedQuery({
        ...params,
        page_size: '100',
        page: String(page),
      });
      expect(errors).toEqual([]);
      const { rows, total } = await runAdvancedSearch(query);
      ids.push(...rows.map((r) => r.id));
      if (ids.length >= total || rows.length === 0) break;
    }
    return ids;
  }

  /**
   * Membership digests over the AFL Tables profile identity of a cohort (V2-GAP-029).
   *
   * The keys are read in C (byte) order and hashed twice:
   *  - `canonical`: sha256 of the C-ordered keys. Independent of the database collation, so it is the
   *    pin for the 2026-10 rebuild that holds 1897-2025.
   *  - `legacy`: the same keys ordered to reproduce the original pins
   *    (inferred to be a punctuation-ignoring Linux locale order: `_`, `/` and `.` carry no weight
   *    at first level, case is folded; the original host collation is not directly evidenced). The
   *    original pins were reproduced exactly from the locally rebuilt membership under this order, and
   *    under no other tried ordering; that equality is the proof the cohorts' membership is unchanged,
   *    and it holds on any database collation because the ordering is applied here, not in SQL.
   */
  async function profileKeysOf(ids: number[]): Promise<string[]> {
    return (await sql<{ externalId: string }[]>`
      SELECT ei.external_id AS "externalId"
        FROM external_identities ei
        JOIN sources s ON s.id = ei.source_id AND s.key = 'afltables'
       WHERE ei.match_method = 'afltables_profile_url'
         AND ei.status IN ('unique', 'resolved')
         AND ei.player_id = ANY(${ids})
       ORDER BY ei.external_id COLLATE "C"
    `).map((r) => r.externalId);
  }

  /** The two digests of a C-ordered list of profile keys (see the note above). */
  function digestKeys(keys: string[]) {
    const hash = (ordered: string[]) => createHash('sha256').update(ordered.join(',')).digest('hex').slice(0, 16);
    const weight = (k: string) => k.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    const legacyOrder = [...keys].sort((a, b) => {
      const wa = weight(a);
      const wb = weight(b);
      if (wa !== wb) return wa < wb ? -1 : 1;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    return { keys: keys.length, canonical: hash(keys), legacy: hash(legacyOrder) };
  }

  async function identityDigests(ids: number[]) {
    return digestKeys(await profileKeysOf(ids));
  }

  /**
   * INDEPENDENT ORACLE for the 50-199 goals / zero Brownlow votes cohort (AFLDB-ISSUE-363, 363-W).
   *
   * Written from the raw fact tables and shares nothing with the search service, the query builder
   * or the derived `player_career_stats` row the service filters on: career goals are summed from
   * `player_match_stats`, career Brownlow votes from `brownlow_season_votes` (the authoritative
   * season grain, summed per player; a player with no row has polled nothing, which the coverage
   * semantics make a decided zero only inside a season with a medal and is identical here because
   * no season outside the recorded ones has rows). Returns the cohort as AFL Tables profile keys,
   * C-ordered, so it is comparable across databases that number players differently.
   *
   * `through` bounds BOTH sums to that season (inclusive); null means every season.
   */
  async function oracleCohortKeys(through: number | null): Promise<string[]> {
    const bound = through ?? 32_767;
    return (await sql<{ externalId: string }[]>`
      WITH goals AS (
        SELECT s.player_id, sum(s.goals)::int AS goals
          FROM player_match_stats s JOIN matches m ON m.id = s.match_id
         WHERE m.season <= ${bound}::int
         GROUP BY s.player_id
      ), votes AS (
        SELECT player_id, sum(votes)::int AS votes
          FROM brownlow_season_votes
         WHERE season <= ${bound}::int
         GROUP BY player_id
      )
      SELECT ei.external_id AS "externalId"
        FROM goals g
        LEFT JOIN votes v ON v.player_id = g.player_id
        JOIN external_identities ei ON ei.player_id = g.player_id
        JOIN sources src ON src.id = ei.source_id AND src.key = 'afltables'
       WHERE ei.match_method = 'afltables_profile_url'
         AND ei.status IN ('unique', 'resolved')
         AND g.goals BETWEEN 50 AND 199
         AND COALESCE(v.votes, 0) = 0
       ORDER BY ei.external_id COLLATE "C"
    `).map((r) => r.externalId);
  }

  // AFLDB-ISSUE-108: this gate measured the legacy per-game Brownlow correction
  // (269, down from the legacy 750). AFLDB-ISSUE-113 restored the season-grain
  // acquisition and RE-MEASURED the cohort on the canonically rebuilt afltables
  // baseline (§8.17.3): 261 players (career goals are now fitzRoy-sourced; the
  // legacy 269 was 262 on the pre-ISSUE-136 baseline and 261 once the four
  // renumbered-profile careers were folded). The membership digest is taken over
  // the AFL Tables profile identity, as the 1960s-debut gate below does, so it
  // survives the surrogate players.id re-seed of every rebuild.
  //
  // AFLDB-ISSUE-363 (363-W): 261 is a statement about 1897-2025. Once 2026 completed
  // (c2-2026-final-core-v1 and the 4 Nov snapshot both hold it) the cohort over every loaded
  // season is 268, not 261, because the 2026 goals move players across the 50 and 199 bounds.
  // Two claims, kept apart: (1) the service returns exactly the cohort the independent oracle derives, over
  // whatever seasons are loaded, so it cannot go stale when another season completes; and
  // (2) the oracle bounded to seasons <= 2025 is the historical 261, with its ISSUE-113
  // membership digests, so the fixed past cannot drift. Provenance of (2): 261 measured on
  // the accepted rebuild AND the 4 Nov snapshot with the raw SQL above bounded to 2025
  // (run4/gates/README.md), equal to the ISSUE-113 pin and to run 3's independent
  // `player_match_stats` derivation (run3/integb/evidence/facts/facts3-*.txt: 261); the
  // digests are the original ISSUE-113 pins, reproduced here from the oracle, not read back
  // from the service. This gate and database.test.ts "50-199 goals and no Brownlow votes"
  // measure one fact (run 4 brief 3a), so both use the same oracle shape.
  it('50-199 goals and zero Brownlow votes returns the cohort an independent oracle derives (261 through 2025)', async () => {
    const ids = await idsFor({
      goals_min: '50',
      goals_max: '199',
      brownlow_votes_min: '0',
      brownlow_votes_max: '0',
    });

    // (1) The service result, as stable profile keys, equals the oracle over every loaded season.
    const served = await profileKeysOf(ids);
    // Every returned player carries exactly one key, so a silently dropped identity (or a
    // duplicated one) cannot hide behind a matching list.
    expect(served.length).toBe(ids.length);
    const everySeason = await oracleCohortKeys(null);
    expect(everySeason.length).toBeGreaterThan(0);
    // The headline correction: the legacy per-game derivation returned 750 here; the
    // difference was all polled votes between 1935 and 1983.
    expect(served).toEqual(everySeason);

    // (2) The historical cohort, through 2025.
    const historical = await oracleCohortKeys(2025);
    expect(historical.length).toBe(261);
    const digest = digestKeys(historical);
    // The original ISSUE-113 pin, reproduced exactly: membership unchanged.
    expect(digest.legacy).toBe('ca65f15239aaf0b5');
    expect(digest.canonical).toBe('79d3e6eea83a4620');
  });

  it('debuted in the 1960s with exactly two clubs returns the exact 110 players', async () => {
    // Field keys are 'debut' and 'clubs' — the spec ignores unknown
    // parameters rather than erroring, so a wrong name silently returns
    // everything. Using the real keys is part of what this gate proves.
    const ids = await idsFor({
      debut_min: '1960',
      debut_max: '1969',
      clubs_min: '2',
      clubs_max: '2',
    });
    expect(ids.length).toBe(110);

    // AFLDB-ISSUE-108: the membership digest is taken over the AFL Tables profile
    // identity, not over players.id. players.id is a surrogate the canonical rebuild
    // re-seeds — import_fitzroy_core.py inserts players with no legacy_player_id and
    // lets the identity sequence assign one — so an ID-set hash changes whenever the
    // database is rebuilt even though the same 110 people are returned, which is
    // exactly what happened to the retired '8cebc4aa37002766'. external_identities
    // (afltables / afltables_profile_url) is the durable identity the importer
    // resolves players by, so hashing it keeps this an EXACT-membership gate rather
    // than a count, and survives the next rebuild.
    const digest = await identityDigests(ids);
    // Every returned player carries one, so a silently dropped identity cannot
    // hide behind a matching digest.
    expect(digest.keys).toBe(110);
    // The original ISSUE-108 pin, reproduced exactly: membership unchanged.
    expect(digest.legacy).toBe('4b4c6a2aa975cc17');
    expect(digest.canonical).toBe('258396e0512a2212');
  });
});

// ---------------------------------------------------------------------
// IMMUTABLE — a shared name never collapses two people
// ---------------------------------------------------------------------
// The gates look their subjects up BY NAME on purpose: that is the collision the
// database must survive. What must never be shared is the identity behind it.
describe('gate: name collisions resolve by ID', () => {
  // AFLDB-ISSUE-108: looked up by name, not by pinned players.id. players.id is a
  // surrogate the canonical rebuild re-seeds (import_fitzroy_core.py inserts with no
  // legacy_player_id), so the retired 2520/2521 pins addressed two unrelated players
  // and this gate passed while proving nothing about the collision. Resolving the
  // shared surname and requiring two distinct rows is the guarantee itself.
  it('keeps the two Ron Barassis distinct', async () => {
    const rows = await sql<{
      id: number; games: number; debut: number; lastSeason: number;
    }[]>`
      SELECT p.id, c.games, c.debut_season AS debut,
             c.final_season AS "lastSeason"
        FROM players p JOIN player_career_stats c ON c.player_id = p.id
       WHERE p.search_name LIKE '%' || afldb_normalise_name('barassi') || '%'
       ORDER BY c.debut_season
    `;
    expect(rows).toHaveLength(2);
    expect(rows[0].id).not.toBe(rows[1].id);
    // Father and son, same name, different careers.
    expect(rows[0].games).not.toBe(rows[1].games);
    // The father's career ends thirteen years before the son's begins, so a
    // collapsed identity could not hide inside a single plausible career.
    expect([rows[0].debut, rows[0].lastSeason, rows[0].games]).toEqual([1936, 1940, 58]);
    expect([rows[1].debut, rows[1].lastSeason, rows[1].games]).toEqual([1953, 1969, 254]);
  });

  it('returns six distinct players named Peter Brown', async () => {
    const rows = await sql<{ id: number }[]>`
      SELECT id FROM players WHERE search_name = afldb_normalise_name('Peter Brown')
    `;
    expect(new Set(rows.map((r) => r.id)).size).toBe(6);
  });

  it('returns more than one Ted Whitten', async () => {
    const rows = await sql<{ id: number }[]>`
      SELECT id FROM players WHERE search_name = afldb_normalise_name('Ted Whitten')
    `;
    expect(rows.length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------
// IMMUTABLE — organizations versus historical identities
// ---------------------------------------------------------------------
describe('gate: club organizations and identities', () => {
  it('has 24 identities across 21 organizations', async () => {
    const [row] = await sql<{ identities: number; orgs: number }[]>`
      SELECT (SELECT count(*)::int FROM clubs)              AS identities,
             (SELECT count(*)::int FROM club_organizations) AS orgs
    `;
    expect(row.identities).toBe(24);
    expect(row.orgs).toBe(21);
  });

  it('gives every club identity an organization', async () => {
    // Migration 021 relaxed this column to nullable so a reload could
    // start, and named this gate as the thing that keeps the guarantee.
    // It has to assert the guarantee directly to be that.
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM clubs WHERE organization_id IS NULL
    `;
    expect(row.n).toBe(0);
  });

  it('groups exactly the three renamed clubs into shared organizations', async () => {
    const rows = await sql<{ name: string; n: number }[]>`
      SELECT o.name, count(c.id)::int AS n
        FROM club_organizations o JOIN clubs c ON c.organization_id = o.id
       GROUP BY o.name HAVING count(c.id) > 1 ORDER BY o.name
    `;
    expect(rows.map((r) => r.name)).toEqual([
      'North Melbourne', 'Sydney', 'Western Bulldogs',
    ]);
    expect(rows.every((r) => r.n === 2)).toBe(true);
  });

  it('keeps Fitzroy, Brisbane Bears and University as separate organizations', async () => {
    const rows = await sql<{ slug: string; n: number }[]>`
      SELECT o.slug, count(c.id)::int AS n
        FROM club_organizations o JOIN clubs c ON c.organization_id = o.id
       WHERE o.slug IN ('fitzroy', 'brisbane-bears', 'brisbane-lions', 'university')
       GROUP BY o.slug ORDER BY o.slug
    `;
    // A merger is not a rename: four distinct organizations, one identity
    // each. Fitzroy's 100 seasons must never be counted as the Lions'.
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.n === 1)).toBe(true);
  });

  it('records the merger as a navigable link without combining records', async () => {
    const rows = await sql<{ from: string; to: string; season: number }[]>`
      SELECT f.slug AS "from", t.slug AS "to", r.effective_season AS season
        FROM club_organization_relations r
        JOIN club_organizations f ON f.id = r.from_organization_id
        JOIN club_organizations t ON t.id = r.to_organization_id
       WHERE r.relation = 'merged_into' ORDER BY f.slug
    `;
    expect(rows).toEqual([
      { from: 'brisbane-bears', to: 'brisbane-lions', season: 1997 },
      { from: 'fitzroy', to: 'brisbane-lions', season: 1997 },
    ]);

    // ... and the Lions' record still starts in 1997.
    const [lions] = await sql<{ first: number }[]>`
      SELECT min(season)::int AS first FROM club_seasons
       WHERE club_id = (SELECT id FROM clubs WHERE slug = 'brisbane-lions')
    `;
    expect(lions.first).toBe(1997);
  });

  it('attaches every ladder row to the identity trading that season', async () => {
    const SIX = ['footscray', 'western-bulldogs', 'south-melbourne', 'sydney', 'kangaroos', 'north-melbourne'];
    const ladder = (through: number) => sql<{
      slug: string; n: number; from: number; to: number;
    }[]>`
      SELECT c.slug, count(cs.season)::int AS n,
             min(cs.season)::int AS from, max(cs.season)::int AS to
        FROM clubs c JOIN club_seasons cs ON cs.club_id = c.id
       WHERE c.slug = ANY(${SIX}) AND cs.season <= ${through}
       GROUP BY c.slug ORDER BY c.slug
    `;
    // The bound is explicit (AFLDB-ISSUE-363, 363-W): the figures below are the ladder
    // through 2025, the last season the retired baselines measured. They are keyed by
    // club slug (stable identity), never by club id.
    const by = Object.fromEntries((await ladder(2025)).map((r) => [r.slug, r]));

    // Before this was fixed, the source ladder's modern-only club names
    // gave Sydney rows back to 1897 and Footscray none at all.
    // AFLDB-ISSUE-095 re-pinned the upper bound from 2026 to 2025. club_seasons is now
    // derived from the canonical match set; 2026 is a loaded, completed season on the
    // c2-2026-final-core-v1 rebuild and on the 4 Nov snapshot, so the unbounded ladder
    // now ends 2026 for the three open identities (western-bulldogs, sydney,
    // north-melbourne: measured 1997-2026 / 1982-2026 / 1925-2026 on both bases). The
    // bound therefore belongs in the query, where it is stated, not in the data.
    expect(by['footscray']).toMatchObject({ from: 1925, to: 1996 });
    expect(by['western-bulldogs']).toMatchObject({ from: 1997, to: 2025 });
    expect(by['south-melbourne']).toMatchObject({ from: 1897, to: 1981 });
    expect(by['sydney']).toMatchObject({ from: 1982, to: 2025 });
    expect(by['kangaroos']).toMatchObject({ from: 1999, to: 2007 });
    expect(by['north-melbourne']).toMatchObject({ from: 1925, to: 2025 });

    // The eras partition the lineage: no season is lost or duplicated.
    // 101/128/101 over 1897-2025, not the retired 102/129/102 which counted 2026.
    // South Melbourne is one short of its span because the 1916 competition ran with
    // four clubs and it was not one of them — a club that did not play has no ladder
    // row, which is absence, not a zero. Independently derived from the ladder source
    // by tests/python/ladder_identity_contract.py over all 1,622 label-season pairs.
    expect(by['footscray'].n + by['western-bulldogs'].n).toBe(101);
    expect(by['south-melbourne'].n + by['sydney'].n).toBe(128);
    expect(by['kangaroos'].n + by['north-melbourne'].n).toBe(101);

    // Every season, with no calendar assumption: no ladder row of these six identities sits
    // outside the years that identity traded. The windows are the club history itself
    // (Footscray 1925-1996, renamed Western Bulldogs from 1997; South Melbourne 1897-1981,
    // relocated as Sydney from 1982; the Kangaroos name 1999-2007, inside North Melbourne,
    // whose own rows therefore skip those nine years). The open-ended identities have no
    // upper bound, so a season added later cannot fail this and a row filed under the
    // wrong identity in any season does.
    const [stray] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n
        FROM club_seasons cs JOIN clubs c ON c.id = cs.club_id
       WHERE (c.slug = 'footscray'        AND cs.season NOT BETWEEN 1925 AND 1996)
          OR (c.slug = 'western-bulldogs' AND cs.season < 1997)
          OR (c.slug = 'south-melbourne'  AND cs.season NOT BETWEEN 1897 AND 1981)
          OR (c.slug = 'sydney'           AND cs.season < 1982)
          OR (c.slug = 'kangaroos'        AND cs.season NOT BETWEEN 1999 AND 2007)
          OR (c.slug = 'north-melbourne'  AND (cs.season < 1925 OR cs.season BETWEEN 1999 AND 2007))
    `;
    expect(stray.n).toBe(0);
  });

  it('resolves a season to exactly one identity per organization', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM (
        SELECT club_id, season FROM club_seasons GROUP BY 1, 2 HAVING count(*) > 1
      ) t
    `;
    expect(row.n).toBe(0);
  });

  it('prefers the narrower identity where spans nest', async () => {
    // Kangaroos (1999-2007) sits inside North Melbourne (1925-).
    const [row] = await sql<{ slug: string }[]>`
      SELECT c.slug FROM clubs c
       WHERE c.id = afldb_identity_for_season(
         (SELECT id FROM club_organizations WHERE slug = 'north-melbourne'),
         2003::smallint)
    `;
    expect(row.slug).toBe('kangaroos');
  });

  it('counts a rename once but a merger twice in clubs played', async () => {
    // Brent Harvey played as Kangaroos and North Melbourne: one club.
    const [harvey] = await sql<{ n: number }[]>`
      SELECT clubs_played::int AS n FROM player_career_stats
       WHERE player_id = (
         SELECT p.id FROM players p JOIN player_career_stats c ON c.player_id = p.id
          WHERE p.search_name = afldb_normalise_name('Brent Harvey')
          ORDER BY c.games DESC LIMIT 1)
    `;
    expect(harvey.n).toBe(1);
  });
});

// ---------------------------------------------------------------------
// IMMUTABLE — draft links
// ---------------------------------------------------------------------
describe('gate: draft links', () => {
  // These counts are only meaningful over a quiescent draft dataset, and
  // draftguru-import.test.ts deliberately links real draft people to
  // fixture players while it runs. Wait it out rather than read a moving
  // target; the assertions below are unchanged.
  beforeAll(() => lockDraftTables(integrationDsn), 300_000);
  afterAll(unlockDraftTables);

  it('retains all 6,810 DraftGuru rows, including unresolved ones, plus durable manual selections', async () => {
    const [row] = await sql<{ sourceRows: number; manualRows: number; unexpectedRows: number }[]>`
      SELECT count(*) FILTER (WHERE s.key = 'draftguru')::int AS "sourceRows",
             count(*) FILTER (WHERE s.key = 'manual_admin_edit')::int AS "manualRows",
             count(*) FILTER (WHERE s.key IS NULL OR s.key NOT IN ('draftguru', 'manual_admin_edit'))::int AS "unexpectedRows"
        FROM draft_picks dp LEFT JOIN sources s ON s.id = dp.source_id
    `;
    const [durable] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM data_overrides
       WHERE entity_type = 'draft_picks' AND field_group = 'selection' AND is_active
    `;
    // An unmatched row is still a fact about the draft. Dropping it
    // would silently shrink the historical record. GAP-029's eight independently
    // reviewed additions are manual facts; they cannot change the source denominator.
    expect(row.sourceRows).toBe(6_810);
    expect(row.manualRows).toBe(durable.n);
    expect(row.unexpectedRows).toBe(0);
  });

  it('keeps the raw name on every row whether linked or not', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM draft_picks
       WHERE player_name_raw IS NULL OR player_name_raw = ''
    `;
    expect(row.n).toBe(0);
  });

  it('retains exactly 5,057 draft persons', async () => {
    const [row] = await sql<{ people: number }[]>`
      SELECT count(*)::int AS people FROM draft_persons
    `;
    expect(row.people).toBe(5_057);
  });

  // AFLDB-ISSUE-108: the 3,459-person link count required DraftGuru Stage B3
  // (person-page -> AFL Tables identity bridge), which is optional and absent from
  // the canonical default rebuild ("unbridged persons stay unmatched",
  // docs/deployment.md §6a); without it 5 are linked via the seeded decision
  // ledger. Skipped rather than re-pinned to 5 — 5 is the no-B3 floor, not a
  // timeless invariant. Re-enable when Stage B3 is part of the standard rebuild.
  it.skip('resolves identity once per person across 5,057 people', async () => {
    const [row] = await sql<{ people: number; linked: number }[]>`
      SELECT count(*)::int AS people, count(player_id)::int AS linked
        FROM draft_persons
    `;
    expect(row.people).toBe(5_057);
    expect(row.linked).toBe(3_459);
  });

  it('propagates a person link to every row of that person', async () => {
    // The defect this prevents: the same human linked on one row and
    // unlinked on the next, because each row was matched separately.
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM (
        SELECT draft_person_id FROM draft_picks
         WHERE draft_person_id IS NOT NULL
         GROUP BY draft_person_id
        HAVING count(DISTINCT coalesce(player_id, -1)) > 1
      ) t
    `;
    expect(row.n).toBe(0);
  });

  it('refuses a trusted link that points at no player', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM draft_picks
       WHERE (link_status_value IN ('unique', 'resolved')) <> (player_id IS NOT NULL)
    `;
    expect(row.n).toBe(0);

    await expect(sql`
      INSERT INTO draft_persons
        (source_id, dg_person_id, player_url, display_name_raw, name_key,
         player_id, link_status)
      VALUES ((SELECT id FROM sources WHERE key = 'draftguru'),
              -1, '/x', 'Nobody', 'nobody', NULL, 'unique')
    `).rejects.toThrow();
  });

  // AFLDB-ISSUE-108: 1,498 never-played / 100 backlog were measured with 3,459
  // persons linked (DraftGuru Stage B3). Without B3 in the canonical rebuild almost
  // every played person is unlinked, so the backlog is not 100. Skipped, not
  // re-pinned; re-enable with Stage B3.
  it.skip('separates genuine non-players from a real matching backlog', async () => {
    const [row] = await sql<{
      backlog: number; neverPlayed: number;
    }[]>`
      SELECT count(*) FILTER (WHERE is_matching_backlog)::int AS backlog,
             count(*) FILTER (WHERE player_id IS NULL
                                AND NOT is_matching_backlog)::int AS "neverPlayed"
        FROM draft_persons
    `;
    // 1,498 people were drafted and never played a senior game. Having
    // no AFLDB player is the CORRECT outcome, not a defect to fix.
    expect(row.neverPlayed).toBe(1_498);
    // 100 people did play but are unlinked: 85 'unmatched' plus 15
    // 'implausible'. This is the backlog worth working.
    expect(row.backlog).toBe(100);
  });

  it('never flags a linked or non-playing person as backlog', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM draft_persons
       WHERE is_matching_backlog
         AND (player_id IS NOT NULL OR coalesce(reported_games, 0) = 0)
    `;
    expect(row.n).toBe(0);
  });

  // AFLDB-ISSUE-108: no canonical pipeline stage writes 'unlinked_player_with_games'
  // data_issues (AFLDB-ISSUE-090 §27.5 — "no writer at all for
  // unlinked_player_with_games backlog issues"), so this count is 0 after a clean
  // rebuild. Skipped until that writer exists; paired with the backlog gate above.
  it.skip('records the backlog as open data issues', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM data_issues
       WHERE issue_type = 'unlinked_player_with_games' AND resolved_at IS NULL
    `;
    expect(row.n).toBe(100);
  });

  it('does not stack duplicate issues when a pass is re-run', async () => {
    // The enrichment passes are re-runnable, so their issue writes must
    // be too. Left unchecked, each run appended another copy.
    const rows = await sql<{ issueType: string; n: number }[]>`
      SELECT issue_type AS "issueType", count(*)::int AS n FROM (
        SELECT issue_type, entity_type, entity_id, count(*) AS c
          FROM data_issues WHERE resolved_at IS NULL
         GROUP BY 1, 2, 3 HAVING count(*) > 1
      ) d GROUP BY issue_type
    `;
    expect(rows).toEqual([]);
  });

  it('keeps the source person key as the durable identity', async () => {
    const [row] = await sql<{ missing: number; dupes: number }[]>`
      SELECT count(*) FILTER (WHERE dg_person_id IS NULL)::int AS missing,
             (SELECT count(*)::int FROM (
                SELECT dg_person_id FROM draft_persons
                 GROUP BY dg_person_id HAVING count(*) > 1) d) AS dupes
        FROM draft_persons
    `;
    expect(row.missing).toBe(0);
    expect(row.dupes).toBe(0);
  });
});

// ---------------------------------------------------------------------
// IMMUTABLE — absence is never zero
// ---------------------------------------------------------------------
describe('gate: absence is never zero', () => {
  it('keeps unknown attendance NULL rather than 0', async () => {
    const [row] = await sql<{ nulls: number; zeroes: number }[]>`
      SELECT count(*) FILTER (WHERE attendance IS NULL)::int AS nulls,
             count(*) FILTER (WHERE attendance = 0)::int     AS zeroes
        FROM matches
    `;
    // Both raw sources are also NULL for these matches: the crowd was
    // never recorded, which is not the same as nobody attending.
    expect(row.nulls).toBe(1_651);
    expect(row.zeroes).toBe(0);
  });

  it('records why each attendance is missing', async () => {
    // (1) Every season loaded, no calendar assumption (AFLDB-ISSUE-363, 363-W): a match with a
    // figure is `complete`, a match without one is `not_collected`, and no other pairing exists.
    // That is the contract itself (absence says why it is absent and is never a zero); the
    // `matches` check constraints enforce the same pairing on write, so this proves the stored
    // data honours it.
    const pairing = await sql<{ status: string; missing: boolean }[]>`
      SELECT DISTINCT attendance_status AS status, attendance IS NULL AS missing
        FROM matches ORDER BY 1, 2
    `;
    expect(pairing).toEqual([
      { status: 'complete', missing: false },
      { status: 'not_collected', missing: true },
    ]);

    // (2) The historical counts, through 2025.
    const rows = await sql<{ status: string; n: number }[]>`
      SELECT attendance_status AS status, count(*)::int AS n
        FROM matches WHERE season <= 2025 GROUP BY 1 ORDER BY 2 DESC
    `;
    // AFLDB-ISSUE-108: re-pinned to the canonical baseline full-history-20260827
    // (measured.attendance_known = 15,187; 16,838 matches - 15,187 = 1,651
    // not_collected). The old 15,376 was the retired legacy snapshot.
    // AFLDB-ISSUE-363 (363-W): the same two figures, now bounded to season <= 2025 in the
    // query. The unbounded counts moved to 15,405 / 1,651 when 2026 completed with every
    // crowd recorded (data/reference/fitzroy-accepted-baselines.json, accepted entry
    // c2-2026-final-core-v1 measured.attendance_known = 15,405 = 15,187 + 218 matches of
    // 2026; measured 15,187 through 2025 and 218 in 2026 on both bases, run4/gates/README.md).
    expect(rows).toEqual([
      { status: 'complete', n: 15_187 },
      { status: 'not_collected', n: 1_651 },
    ]);
  });

  it('does not infer empty pandemic crowds as zero', async () => {
    const rows = await sql<{ season: number; n: number }[]>`
      SELECT season, count(*)::int AS n FROM matches
       WHERE attendance IS NULL AND season >= 2020
       GROUP BY season ORDER BY season
    `;
    // Some 2020-21 matches genuinely were played to empty stands, but
    // "no figure" and "the figure was zero" are different claims. Only
    // a cited source can turn one into the other.
    expect(rows).toEqual([
      { season: 2020, n: 29 },
      { season: 2021, n: 37 },
    ]);
  });

  it('refuses a zero crowd that cites no source', async () => {
    await expect(sql`
      UPDATE matches SET attendance = 0, attendance_status = 'complete'
       WHERE id = (SELECT id FROM matches WHERE season = 2020
                    AND attendance IS NULL LIMIT 1)
    `).rejects.toThrow();
  });

  it('refuses a status that disagrees with the figure', async () => {
    await expect(sql`
      UPDATE matches SET attendance_status = 'complete'
       WHERE attendance IS NULL
    `).rejects.toThrow();
  });

  it('keeps era-limited statistics NULL before they were collected', async () => {
    const [row] = await sql<{ disposals: number | null; recorded: number }[]>`
      SELECT sum(disposals)::int AS disposals,
             sum(disposals_recorded_games)::int AS recorded
        FROM player_season_stats WHERE season < 1965
    `;
    expect(row.disposals).toBeNull();
    expect(row.recorded).toBe(0);
  });
});

// ---------------------------------------------------------------------
// birth-date evidence
// ---------------------------------------------------------------------
// AFLDB-ISSUE-108: the 12,478-with-DOB / 883-without / two-conflict figures were
// the retired legacy SQLite register plus its DOB-enrichment passes.
// AFLDB-ISSUE-118 §23.24-§23.25 (Stage D1): the canonical rebuild now has a
// `birth-dates` stage that fills every NULL dob from the AFL Tables all-time club
// lists (manifest-pinned club-lists-20260905), each with a player_birth_evidence
// row and linked through dob_evidence_id, never overwriting a fitzRoy date. The
// pins below are the deterministic-rebuild values, gated in tools/db/rebuild-test.ts
// birthDateChecks from tools/rebuild/afltables/afltables-contract.json
// club_player_lists.accepted_snapshot.measured: players_with_dob 13,255,
// dob_without_evidence 0, dob_disagreeing_with_club_list 2 (Roan Steele, Jack
// Hayes -- recorded as evidence, adjudication is separate, dob_disputed stays 0).
// The two conflict-adjudication tests are still skipped: no conflict was
// adjudicated into dob_disputed, so there is nothing to exercise.
//
// AFLDB-ISSUE-363 (owner decision 363-B, run 4). PROVENANCE of the re-pin. The 13,255 /
// 14,110 / 13,275 below were measured 2026-09-06 on the rebuild over the 2025-terminal
// fitzRoy baseline. The accepted rebuild (c2-2026-final-core-v1, the register's single
// accepted entry) adds season 2026, and with it 92 players who debuted in 2026: players
// 13,273 -> 13,365, every one of the 92 carries a fitzRoy per-match date (855 -> 947
// fitzRoy-dated) and a club-list row (the 12,400 club-list-filled dates are unchanged),
// so dated players are 947 + 12,400 = 13,347, evidence rows 947 + 13,347 = 14,294 and
// unique profile identities 13,275 + 92 = 13,367. That is what the tracked contract
// already records as its "C2 SUCCESSOR" (tools/rebuild/afltables/afltables-contract.json
// club_player_lists.accepted_snapshot.measured.players_with_dob = 13,347, reproduced by
// the isolated rehearsal at 5643f5c2) and what the register records for the baseline
// (data/reference/fitzroy-accepted-baselines.json c2-2026-final-core-v1
// identity_scan.distinct_urls = 13,367). Those two tracked files are read below and must
// agree with the database, so the pins are cross-checked against a source the loader did
// not write; the loader (tools/migration/enrich_birth_dates_afltables.py) and the rebuild
// inputs (run3/rebuild/inputs.tsv: club-lists-20260905 manifest sha256 e6d5ae26...) are
// unchanged between the two measurements.
//
// TWO SCOPES, kept apart. HISTORICAL: every player except a player who first appears
// after 2025 (`min(season) > 2025`, the 2026 debutants today). Asserted with the 2026-09
// literals, which hold on every database that contains the accepted history, so they
// are a calendar-independent guard of the fixed past and pass on the 4 Nov snapshot too.
// POPULATION: every player, pinned to the accepted rebuild. BASE-DEPENDENT, ON PURPOSE:
// on the 4 Nov production snapshot the 92 2026 debutants have no birth date (13,255
// dated, 14,110 evidence rows, 13,275 unique profile identities, 110 undated), so the
// population pins fail there with exactly those values. That is a real difference
// between the two databases, not a stale test, and these tests are deliberately not
// made base-adaptive: a lost date would otherwise hide inside the adaptation.
// BASELINE-PINNED (ISSUE-363 F-021): the population pins go stale when the next
// baseline is accepted (another season in the fitzRoy core, or a club-list snapshot
// newer than club-lists-20260905), and then need that baseline's measured values.
const REPO_ROOT = join(__dirname, '..', '..');
const readTrackedJson = (path: string) => JSON.parse(readFileSync(join(REPO_ROOT, path), 'utf8'));

describe('gate: birth dates', () => {
  it('populates the canonical dates with no conflicts (13,255 historical, 13,347 on the accepted rebuild)', async () => {
    const [row] = await sql<{
      withDob: number; disputed: number; historicalWithDob: number; filledFromLists: number;
    }[]>`
      WITH debutants AS (
        SELECT s.player_id FROM player_match_stats s JOIN matches m ON m.id = s.match_id
         GROUP BY s.player_id HAVING min(m.season) > 2025
      )
      SELECT count(*) FILTER (WHERE p.dob IS NOT NULL)::int AS "withDob",
             count(*) FILTER (WHERE p.dob_disputed)::int    AS disputed,
             count(*) FILTER (WHERE p.dob IS NOT NULL
                                AND p.id NOT IN (SELECT player_id FROM debutants))::int
                                                            AS "historicalWithDob",
             (SELECT count(*)::int FROM players q
                JOIN player_birth_evidence e ON e.id = q.dob_evidence_id
               WHERE e.evidence_type = 'afltables_club_list')  AS "filledFromLists"
        FROM players p
    `;
    // HISTORICAL (holds on the snapshot too): §23.25's 855 fitzRoy per-match dates + 12,400
    // filled from the club lists = 13,255 players who played by 2025. Proven by a full
    // afldb_test rebuild 2026-09-06 (FINAL VALIDATION players_with_dob_after_birth_dates =
    // 13255); re-measured 13,255 on the accepted rebuild and on the 4 Nov snapshot.
    expect(row.historicalWithDob).toBe(13_255);
    expect(row.filledFromLists).toBe(12_400);
    expect(row.disputed).toBe(0);
    // POPULATION (accepted rebuild; fails on the 4 Nov snapshot with 13255, see above):
    // 947 fitzRoy per-match dates (855 + the 92 debutants) + 12,400 = 13,347, equal to the
    // tracked contract's C2 successor value.
    const contract = readTrackedJson('tools/rebuild/afltables/afltables-contract.json');
    expect(contract.club_player_lists.accepted_snapshot.measured.players_with_dob).toBe(13_347);
    expect(row.withDob).toBe(13_347);
  });

  it.skip('retains the existing date wherever a source disagrees', async () => {
    const rows = await sql<{ id: number; dob: string; register: string }[]>`
      SELECT p.id, p.dob::text, e.dob::text AS register
        FROM players p JOIN player_birth_evidence e ON e.player_id = p.id
       WHERE p.dob_disputed ORDER BY p.id
    `;
    expect(rows).toHaveLength(2);
    // The register is not automatically preferred: a disagreement is
    // adjudicated by a person, not by import order.
    for (const row of rows) expect(row.dob).not.toBe(row.register);
  });

  it.skip('opens a data issue for every disputed date', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM data_issues
       WHERE issue_type = 'dob_conflict' AND resolved_at IS NULL
    `;
    expect(row.n).toBe(2);
  });

  it('keeps the evidence behind every recovered date (14,110 historical, 14,294 on the accepted rebuild)', async () => {
    const [row] = await sql<{
      evidence: number; linked: number; unevidenced: number;
      historicalEvidence: number; historicalLinked: number; clubListRows: number;
    }[]>`
      WITH debutants AS (
        SELECT s.player_id FROM player_match_stats s JOIN matches m ON m.id = s.match_id
         GROUP BY s.player_id HAVING min(m.season) > 2025
      )
      SELECT (SELECT count(*)::int FROM player_birth_evidence)          AS evidence,
             (SELECT count(*)::int FROM players WHERE dob_evidence_id IS NOT NULL)
                                                                        AS linked,
             (SELECT count(*)::int FROM players
               WHERE dob IS NOT NULL AND dob_evidence_id IS NULL)       AS unevidenced,
             (SELECT count(*)::int FROM player_birth_evidence
               WHERE player_id NOT IN (SELECT player_id FROM debutants))
                                                                        AS "historicalEvidence",
             (SELECT count(*)::int FROM players
               WHERE dob_evidence_id IS NOT NULL
                 AND id NOT IN (SELECT player_id FROM debutants))       AS "historicalLinked",
             (SELECT count(*)::int FROM player_birth_evidence
               WHERE evidence_type = 'afltables_club_list')             AS "clubListRows"
    `;
    // AFLDB-ISSUE-118 §23.25 (Stage D1): a player can now carry more than one
    // birth-evidence row (a fitzRoy per-match date plus one or more club-list
    // dates), so the raw count exceeds the dated-player count. Rebuild-measured
    // 2026-09-06: 14,110 evidence rows behind 13,255 dated players.
    // HISTORICAL (players who played by 2025; holds on the snapshot too, re-measured):
    expect(row.historicalEvidence).toBe(14_110);
    expect(row.historicalLinked).toBe(13_255);
    // Every filled date points back at the row that justified it -- the rebuild's
    // dob_without_evidence gate is 0, so linked equals players_with_dob. And every dated
    // player is reached by a club-list row (contract players_with_club_list_birth_evidence
    // equals players_with_dob), so the club-list evidence rows are exactly the dated players:
    // an independent decomposition of the evidence count on either database.
    expect(row.unevidenced).toBe(0);
    expect(row.clubListRows).toBe(row.linked);
    // POPULATION (accepted rebuild; fails on the 4 Nov snapshot with 14110 / 13255, see above):
    // 947 fitzRoy rows + 13,347 club-list rows = 14,294 rows behind 13,347 dated players.
    // The linked count is the tracked contract's C2 successor value
    // (club_player_lists.accepted_snapshot.measured.players_with_club_list_birth_evidence).
    const contract = readTrackedJson('tools/rebuild/afltables/afltables-contract.json');
    expect(contract.club_player_lists.accepted_snapshot.measured.players_with_club_list_birth_evidence)
      .toBe(13_347);
    expect(row.evidence).toBe(14_294);
    expect(row.linked).toBe(13_347);
  });

  it('matches players on the profile URL rather than the name (13,275 historical, 13,367 on the accepted rebuild)', async () => {
    const [row] = await sql<{ n: number; historical: number }[]>`
      WITH debutants AS (
        SELECT s.player_id FROM player_match_stats s JOIN matches m ON m.id = s.match_id
         GROUP BY s.player_id HAVING min(m.season) > 2025
      )
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE player_id NOT IN (SELECT player_id FROM debutants))::int
                                                                        AS historical
        FROM external_identities
       WHERE match_method = 'afltables_profile_url' AND status = 'unique'
    `;
    // AFLDB-ISSUE-090: re-pinned 12,472 -> 13,275 as a test-baseline repair
    // caused by the 2026-08-27 canonical rebuild, NOT a data change. 12,472
    // was the retired AFLDB_LEGACY_SQLITE register population; the canonical
    // fitzRoy import writes exactly one unique profile-URL identity per
    // player, and the accepted baseline full-history-20260827 measures
    // players = 13,275 with identity_scan.distinct_urls = 13,275 and
    // missing_url = 0. The player_birth_evidence pin above is a DIFFERENT
    // population and is deliberately not changed with this one.
    // HISTORICAL (players who played by 2025; holds on the snapshot too, re-measured):
    expect(row.historical).toBe(13_275);
    // POPULATION (accepted rebuild; fails on the 4 Nov snapshot with 13275, see above).
    // AFLDB-ISSUE-363 (363-B): 13,275 + the 92 players who debuted in 2026 = 13,367, equal to
    // the register's identity_scan.distinct_urls for its accepted entry c2-2026-final-core-v1
    // (data/reference/fitzroy-accepted-baselines.json), read here so the literal is checked
    // against a tracked file rather than only against itself.
    const register = readTrackedJson('data/reference/fitzroy-accepted-baselines.json');
    const accepted = register.baselines.find(
      (b: { snapshot_label: string }) => b.snapshot_label === 'c2-2026-final-core-v1',
    );
    expect(accepted.identity_scan.distinct_urls).toBe(13_367);
    expect(row.n).toBe(13_367);
  });

  it('stores the profile URL it matched on, not a legacy row id', async () => {
    // The label said "matched on profile URL" while external_id held the
    // legacy id, so the retained evidence did not support the claim.
    // Migration 018 defines this column as the durable profile key.
    const [row] = await sql<{ total: number; numeric: number }[]>`
      SELECT count(*)::int                                        AS total,
             count(*) FILTER (WHERE external_id ~ '^[0-9]+$')::int AS numeric
        FROM external_identities
       WHERE match_method = 'afltables_profile_url'
    `;
    expect(row.total).toBeGreaterThan(0);
    expect(row.numeric).toBe(0);
  });

  it('keeps the same profile key on the evidence rows', async () => {
    const [row] = await sql<{ numeric: number }[]>`
      SELECT count(*) FILTER (WHERE external_id ~ '^[0-9]+$')::int AS numeric
        FROM player_birth_evidence
    `;
    expect(row.numeric).toBe(0);
  });

  it('never claims a date whose origin is unknown', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM players
       WHERE dob IS NOT NULL AND dob_confidence = 'unknown'
    `;
    expect(row.n).toBe(0);
  });

  it('leaves the remaining players honestly without a date', async () => {
    const [row] = await sql<{ n: number; historical: number }[]>`
      WITH debutants AS (
        SELECT s.player_id FROM player_match_stats s JOIN matches m ON m.id = s.match_id
         GROUP BY s.player_id HAVING min(m.season) > 2025
      )
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE id NOT IN (SELECT player_id FROM debutants))::int AS historical
        FROM players
       WHERE dob IS NULL AND dob_confidence = 'unknown'
    `;
    // AFLDB-ISSUE-118 §23.25 (Stage D1): the club-list birth-date stage filled all
    // but 18 of the previously undated players. Those 18 are genuinely undated in
    // every canonical source and are shown as "Not recorded", never a guess.
    // Rebuild-measured 2026-09-06: 13,255 dated + 18 undated = 13,273 players.
    // AFLDB-ISSUE-363 (363-B): the 18 are all historical, so the figure is unchanged on the
    // accepted rebuild (13,347 dated + 18 = 13,365 players, the 92 debutants all dated). On the
    // 4 Nov snapshot the population count is 110 = 18 + the 92 undated debutants: that
    // difference is base-dependent and unchanged from B4 (run4/gates/README.md); the
    // historical 18 holds on both.
    expect(row.historical).toBe(18);
    expect(row.n).toBe(18);
  });
});

// ---------------------------------------------------------------------
// IMMUTABLE — Grand Final replays
// ---------------------------------------------------------------------
describe('gate: Grand Final replays', () => {
  it('has two Grand Final rows in each replay season', async () => {
    const rows = await sql<{ season: number; n: number }[]>`
      SELECT season, count(*)::int AS n FROM matches
       WHERE round_type = 'grand_final' GROUP BY season HAVING count(*) > 1
       ORDER BY season
    `;
    expect(rows.map((r) => r.season)).toEqual([1948, 1977, 2010]);
  });

  it('resolves each replay season to exactly one premier', async () => {
    const rows = await sql<{ year: number; premier: string }[]>`
      SELECT s.year, c.name AS premier
        FROM seasons s
        LEFT JOIN LATERAL (
            SELECT gf.winner_club_id FROM matches gf
             WHERE gf.season = s.year AND gf.round_type = 'grand_final'
               AND gf.result <> 'draw'
             ORDER BY gf.match_date DESC LIMIT 1
        ) gf ON true
        LEFT JOIN clubs c ON c.id = gf.winner_club_id
       WHERE s.year IN (1948, 1977, 2010)
       ORDER BY s.year
    `;
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.premier)).toEqual([
      'Melbourne', 'North Melbourne', 'Collingwood',
    ]);
  });

  it('does not duplicate seasons when joining the premier', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n
        FROM seasons s
        LEFT JOIN LATERAL (
            SELECT gf.winner_club_id FROM matches gf
             WHERE gf.season = s.year AND gf.round_type = 'grand_final'
               AND gf.result <> 'draw'
             ORDER BY gf.match_date DESC LIMIT 1
        ) gf ON true
    `;
    const [seasons] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM seasons`;
    expect(row.n).toBe(seasons.n);
  });
});

// ---------------------------------------------------------------------
// IMMUTABLE — Match Search
// ---------------------------------------------------------------------
// The feature shipped with no test of its own: the parser had coverage
// only after this suite gained tests/match-spec.test.ts, and the query
// itself had none. These drive the real service, as the Advanced Search
// gates do.
describe('gate: Match Search', () => {
  it('finds the drawn Grand Finals and nothing else', async () => {
    const { query } = parseMatchSearchQuery({
      outcome: 'draw', match_type: 'finals', sort: 'date_asc',
    });
    const { rows, total } = await runMatchSearch(query);
    const grandFinals = rows.filter((r) => r.roundType === 'grand_final');
    // 1948, 1977 and 2010 are the drawn Grand Finals; the replays are
    // separate matches and are not draws.
    expect(grandFinals.map((r) => r.season)).toEqual([1948, 1977, 2010]);
    expect(total).toBeGreaterThanOrEqual(grandFinals.length);
    for (const row of rows) expect(row.margin).toBe(0);
  });

  it('applies a range filter on both bounds', async () => {
    const { query } = parseMatchSearchQuery({ margin_min: '1', margin_max: '5' });
    const { rows } = await runMatchSearch(query);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.margin).toBeGreaterThanOrEqual(1);
      expect(row.margin).toBeLessThanOrEqual(5);
    }
  });

  it('treats two clubs as either, not both', async () => {
    const both = await runMatchSearch(
      parseMatchSearchQuery({ club: 'collingwood,carlton' }).query,
    );
    const collingwood = await runMatchSearch(
      parseMatchSearchQuery({ club: 'collingwood' }).query,
    );
    const carlton = await runMatchSearch(
      parseMatchSearchQuery({ club: 'carlton' }).query,
    );
    // Either-club is a union, so it exceeds each single club but is less
    // than their sum by the number of games they played each other.
    expect(both.total).toBeGreaterThan(collingwood.total);
    expect(both.total).toBeGreaterThan(carlton.total);
    expect(both.total).toBeLessThan(collingwood.total + carlton.total);
    for (const row of both.rows) {
      expect(['collingwood', 'carlton'].some(
        (slug) => row.homeSlug === slug || row.awaySlug === slug,
      )).toBe(true);
    }
  });

  // AFLDB-ISSUE-360 (SRCH-5). Oracle-independent: the expected count is an
  // independent SQL over the same two slugs, not a figure from any snapshot.
  it('club_match=both returns only the games between the two clubs', async () => {
    const either = await runMatchSearch(
      parseMatchSearchQuery({ club: 'collingwood,carlton' }).query,
    );
    const headToHead = await runMatchSearch(
      parseMatchSearchQuery({ club: 'collingwood,carlton', club_match: 'both' }).query,
    );
    const [expected] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n
        FROM matches m
        JOIN clubs h ON h.id = m.home_club_id
        JOIN clubs a ON a.id = m.away_club_id
       WHERE (h.slug = 'collingwood' AND a.slug = 'carlton')
          OR (h.slug = 'carlton' AND a.slug = 'collingwood')
    `;
    expect(headToHead.total).toBe(expected.n);
    expect(headToHead.total).toBeGreaterThan(0);
    expect(headToHead.total).toBeLessThan(either.total);
    for (const row of headToHead.rows) {
      expect([row.homeSlug, row.awaySlug].sort()).toEqual(['carlton', 'collingwood']);
    }
  });

  it('keeps the true total on a page past the last result', async () => {
    const first = await runMatchSearch(
      parseMatchSearchQuery({ outcome: 'draw', match_type: 'finals' }).query,
    );
    const far = await runMatchSearch(
      parseMatchSearchQuery({
        outcome: 'draw', match_type: 'finals', page: '300',
      }).query,
    );
    expect(far.rows).toHaveLength(0);
    // A window count carried on the page rows would report 0 here.
    expect(far.total).toBe(first.total);
  });

  it('reconciles every returned scoreline with its components', async () => {
    const { rows } = await runMatchSearch(
      parseMatchSearchQuery({ high_score_min: '180', sort: 'high_score_desc' }).query,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.highScore).toBe(Math.max(row.homeScore, row.awayScore));
      expect(row.lowScore).toBe(Math.min(row.homeScore, row.awayScore));
      expect(row.totalScore).toBe(row.homeScore + row.awayScore);
      expect(row.margin).toBe(Math.abs(row.homeScore - row.awayScore));
    }
  });

  it('sorts by the requested key', async () => {
    const { rows } = await runMatchSearch(
      parseMatchSearchQuery({ match_type: 'finals', sort: 'margin_desc' }).query,
    );
    const margins = rows.map((r) => r.margin);
    expect([...margins].sort((a, b) => b - a)).toEqual(margins);
  });
});

// ---------------------------------------------------------------------
// PROVISIONAL SEASONS — a season this file establishes, never committed
// ---------------------------------------------------------------------
// History. These gates were "2026 is provisional (snapshot-pinned)": they asserted on the
// real 2026 row that no premier, no wooden spoon and no Brownlow vote existed for a season
// still being played, and that 2026 was the only season in progress. 2026 completed, so on
// the accepted c2-2026-final-core-v1 rebuild they failed with "expected 'complete' to be
// 'in_progress'", "expected 1 to be +0" and "expected [ 2027 ] to deeply equal [ 2026 ]",
// and on the 4 Nov snapshot, which holds no in-progress season at all, "expected [] to
// deeply equal [ 2026 ]". Re-pointing them at "the in-progress season" would pass
// vacuously on that snapshot (the TST-4 defect this issue exists to remove), so there is no
// lookup here.
//
// AFLDB-ISSUE-363 (owner decision 363-G): no test assumes the current calendar year has an
// open season. Two different claims were fused in the old tests and are separated:
//
//   1. THE CONTRACTS OF A PROVISIONAL SEASON (no premier, no wooden spoon, Brownlow
//      pending and never zero, an explicit as-at date). They are about what the
//      derivation does with a season still in progress, so they are asserted on a season
//      the test itself establishes: season 2065, four real clubs (read by slug, never
//      written), four home-and-away matches over two rounds, eight synthetic players
//      (prefix CD_I4020), built by the production recompute functions, inside a
//      transaction that always ends in a throw. Nothing is committed, so this file stays a
//      non-committing file in both shared and per-file mode and no fixture can leak. The
//      fixture is built so each contract has something to protect: the ladder has a unique
//      last place (a spoon WOULD be awarded were the season complete) and the season has
//      player rows (a vote could be written to one).
//   2. THE STRUCTURE OF THE SEASONS TABLE (at most one season in progress, and it is the
//      latest). This is about the real table, so it is asserted there. On the 4 Nov
//      snapshot no season is in progress and on the accepted rebuild 2027 is: BOTH satisfy
//      it, so it asserts the invariant and never that a season is open.
//
// Each assertion is shown to be able to fail: a `detects ...` test corrupts the same
// fixture (writes a premier, a zero vote, a second open season, ...) and requires the check
// to say so. Expected values are literals chosen here (pending, 0, '2065-03-20'); none is
// computed by the code under test. The completed-season "no medal published yet" case is
// not here: it belongs to the D-365-1 regression (ISSUE-365).
//
// The two skipped tests keep their original text: they assert current-season PIPELINE state
// (seasons.data_through_date as loaded by the ISSUE-099 import, staging.team_seasons) that
// no historical rebuild produces.
describe('gate: 2026 is provisional (snapshot-pinned)', () => {
  it.skip('marks the season in progress with an explicit as-at date', async () => {
    const [row] = await sql<{
      status: string; through: Date | null; round: string | null; completed: Date | null;
    }[]>`
      SELECT status, data_through_date AS through,
             last_loaded_round AS round, completed_at AS completed
        FROM seasons WHERE year = 2026
    `;
    expect(row.status).toBe('in_progress');
    expect(row.completed).toBeNull();
    // Re-pin this date when a newer snapshot is imported.
    expect(row.through?.toISOString().slice(0, 10)).toBe('2026-08-09');
    expect(row.round).not.toBeNull();
  });

  it.skip('preserves the raw ladder untouched in staging', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM staging.team_seasons
       WHERE season = 2026 AND wooden_spoon
    `;
    // Staging is the immutable source. Correcting it there would destroy
    // the ability to reprocess.
    expect(row.n).toBe(1);
  });
});

/** Seasons allocated to this file (run 4 brief 3a): rolled back only. */
const PROVISIONAL_SEASON = 2065;
const LATER_SEASON = 2066;
/** Synthetic provider/key prefix allocated to this file. */
const FIXTURE_PREFIX = 'CD_I4020';
/** Stable club keys. The fixture reads these identities and never writes `clubs`. */
const FIXTURE_CLUB_SLUGS = ['adelaide', 'carlton', 'collingwood', 'essendon'] as const;
/** The as-at date a provisional season with these four matches must report. */
const FIXTURE_AS_AT = '2065-03-20';

type Tx = postgres.TransactionSql;
type Q = typeof sql;
class Rollback extends Error {}

/** Run `work` in a transaction that is always rolled back; resolve with what it returned. */
async function inRolledBackTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  let out!: T;
  try {
    await sql.begin(async (tx) => {
      out = await work(tx);
      throw new Rollback('release-gates provisional-season fixture: always rolled back');
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  return out;
}

/**
 * Insert a fixture season, refusing to adopt one that already exists. Seasons 2065 and 2066 are this
 * file's, but a committed fixture of another suite (or a leak) on the same year would otherwise
 * surface as a bare duplicate-key error.
 */
async function insertFixtureSeason(q: Q, year: number, status: 'in_progress' | 'complete'): Promise<void> {
  const [{ n }] = await q<{ n: number }[]>`SELECT count(*)::int AS n FROM seasons WHERE year = ${year}`;
  if (n !== 0) {
    throw new Error(
      `season ${year} already exists: refusing to build a release-gates provisional-season fixture over it `
      + '(a committed fixture of another suite, or a leak; this file only ever uses 2065 and 2066, rolled back)',
    );
  }
  await q`INSERT INTO seasons (year, league, status) VALUES (${year}, 'AFL', ${status}::season_status)`;
}

/**
 * Establish `year` as a season in progress inside `tx`, with the production recompute
 * functions, and return the synthetic player ids.
 *
 * Round 1: A 100-80 B, C 90-70 D. Round 2: A 95-85 C, B 88-60 D. Four clubs, so the
 * ladder is A (8 points), C (4, 106.1%), B (4, 105.0%), D (0): D is the unique last place.
 * Refuses to adopt a `seasons` row that is already there (insertFixtureSeason).
 */
async function establishProvisionalSeason(tx: Tx, year: number): Promise<number[]> {
  const q = tx as unknown as Q;
  const clubs = await q<{ id: number; slug: string }[]>`
    SELECT id::int AS id, slug FROM clubs WHERE slug = ANY(${[...FIXTURE_CLUB_SLUGS]}::text[])
  `;
  if (clubs.length !== FIXTURE_CLUB_SLUGS.length) {
    throw new Error(`the provisional-season fixture needs the clubs ${FIXTURE_CLUB_SLUGS.join(', ')}`);
  }
  const idOf = Object.fromEntries(clubs.map((c) => [c.slug, c.id]));
  const [a, b, c, d] = FIXTURE_CLUB_SLUGS.map((slug) => idOf[slug]);
  const [{ id: sourceId }] = await q<{ id: number }[]>`SELECT id::int AS id FROM sources WHERE key = 'afltables'`;

  await insertFixtureSeason(q, year, 'in_progress');

  const games = [
    { key: 'r1m1', round: 1, date: '03-12', home: a, away: b, homeScore: 100, awayScore: 80 },
    { key: 'r1m2', round: 1, date: '03-13', home: c, away: d, homeScore: 90, awayScore: 70 },
    { key: 'r2m1', round: 2, date: '03-19', home: a, away: c, homeScore: 95, awayScore: 85 },
    { key: 'r2m2', round: 2, date: '03-20', home: b, away: d, homeScore: 88, awayScore: 60 },
  ];
  const playersByClub = new Map<number, number[]>();
  for (const [index, clubId] of [a, b, c, d].entries()) {
    const ids: number[] = [];
    for (let n = 0; n < 2; n += 1) {
      const name = `${FIXTURE_PREFIX} ${year} C${index} P${n}`;
      const [row] = await q<{ id: number }[]>`
        INSERT INTO players (display_name, sort_name, search_name, slug)
        VALUES (${name}, ${name}, ${name.toLowerCase()}, ${`${FIXTURE_PREFIX}-${year}-c${index}-p${n}`})
        RETURNING id::int AS id
      `;
      ids.push(row.id);
    }
    playersByClub.set(clubId, ids);
  }
  for (const game of games) {
    const [match] = await q<{ id: number }[]>`
      INSERT INTO matches (
        match_key, season, round_code, round_number, round_type, is_final,
        match_date, venue_raw, home_club_id, away_club_id,
        home_score, away_score, result, winner_club_id, margin,
        attendance, attendance_status, source_id
      ) VALUES (
        ${`${FIXTURE_PREFIX}-${year}-${game.key}`}, ${year}, ${String(game.round)}, ${game.round},
        'home_and_away'::round_type, false,
        ${`${year}-${game.date}`}, ${`${FIXTURE_PREFIX} Oval`}, ${game.home}, ${game.away},
        ${game.homeScore}, ${game.awayScore}, 'home_win'::match_result, ${game.home},
        ${game.homeScore - game.awayScore},
        NULL, 'not_collected'::coverage_status, ${sourceId}
      )
      RETURNING id::int AS id
    `;
    for (const clubId of [game.home, game.away]) {
      let jumper = 1;
      for (const playerId of playersByClub.get(clubId) ?? []) {
        await q`
          INSERT INTO player_match_stats (
            player_id, match_id, club_id, jumper_number, kicks, marks, handballs,
            disposals, goals, behinds, hitouts, tackles, frees_for, frees_against, source_id
          ) VALUES (
            ${playerId}, ${match.id}, ${clubId}, ${String(jumper)}, 11, 4, 7,
            18, 1, 1, 0, 3, 1, 1, ${sourceId}
          )
        `;
        jumper += 1;
      }
    }
  }

  const playerIds = [...playersByClub.values()].flat();
  // The production order: season metadata first (the wooden-spoon gate reads seasons.status),
  // then the ladder, the player rows, and the Brownlow coverage grid and statuses.
  await recomputeSeasonMetadata(tx, year);
  await recomputeClubSeasons(tx, year);
  await recomputePlayerDerivedStats(tx, playerIds, year);
  await recomputeBrownlowCoverage(tx, year);
  await recomputeSeasonBrownlowStatus(tx, year);
  return playerIds;
}

const BROWNLOW_GRAINS = ['brownlow_season_total', 'brownlow_round_votes', 'brownlow_match_votes'];

/** Status and as-at date of a season in progress. Empty means the contract holds. */
async function seasonStatusViolations(q: Q, year: number, asAt: string): Promise<string[]> {
  const [row] = await q<{ status: string; completed: string | null; through: string | null; round: string | null }[]>`
    SELECT status::text AS status, completed_at::text AS completed,
           data_through_date::text AS through, last_loaded_round AS round
      FROM seasons WHERE year = ${year}
  `;
  if (!row) return [`no seasons row for ${year}`];
  const out: string[] = [];
  if (row.status !== 'in_progress') out.push(`status is ${row.status}, not in_progress`);
  if (row.completed !== null) out.push(`completed_at is ${row.completed}, not NULL`);
  if (row.through !== asAt) out.push(`data_through_date is ${row.through}, not ${asAt}`);
  if (row.round === null) out.push('last_loaded_round is NULL');
  return out;
}

/** Brownlow of a season in progress: pending, never zero. Empty means the contract holds. */
async function brownlowPendingViolations(q: Q, year: number): Promise<string[]> {
  const out: string[] = [];
  const grains = await q<{ key: string; coverage: string; recorded: boolean }[]>`
    SELECT stat_key AS key, coverage::text AS coverage, is_recorded AS recorded
      FROM stat_availability WHERE season = ${year} AND stat_key = ANY(${BROWNLOW_GRAINS}::text[])
  `;
  for (const key of BROWNLOW_GRAINS) {
    const grain = grains.find((g) => g.key === key);
    if (!grain) out.push(`${key}: no stat_availability row`);
    else if (grain.coverage !== 'pending' || grain.recorded) {
      out.push(`${key}: coverage ${grain.coverage} (recorded ${grain.recorded}), not pending and unrecorded`);
    }
  }
  const [n] = await q<{
    seasonRows: number; roundRows: number; matchVotes: number; playerVotes: number; playerNotPending: number;
  }[]>`
    SELECT (SELECT count(*)::int FROM brownlow_season_votes WHERE season = ${year})   AS "seasonRows",
           (SELECT count(*)::int FROM brownlow_round_votes  WHERE season = ${year})   AS "roundRows",
           (SELECT count(*)::int FROM player_match_stats s JOIN matches m ON m.id = s.match_id
             WHERE m.season = ${year} AND s.brownlow_votes IS NOT NULL)               AS "matchVotes",
           (SELECT count(*)::int FROM player_season_stats
             WHERE season = ${year} AND brownlow_votes IS NOT NULL)                   AS "playerVotes",
           (SELECT count(*)::int FROM player_season_stats
             WHERE season = ${year} AND brownlow_status <> 'pending')                 AS "playerNotPending"
  `;
  if (n.seasonRows > 0) out.push(`${n.seasonRows} brownlow_season_votes rows for an unawarded season`);
  if (n.roundRows > 0) out.push(`${n.roundRows} brownlow_round_votes rows for an unawarded season`);
  // A 0 here would be a lie: nobody has polled nothing in a season nobody has polled in yet.
  if (n.matchVotes > 0) out.push(`${n.matchVotes} player_match_stats rows carry a vote (a 0 counts)`);
  if (n.playerVotes > 0) out.push(`${n.playerVotes} player_season_stats rows carry a vote total (a 0 counts)`);
  if (n.playerNotPending > 0) out.push(`${n.playerNotPending} player_season_stats rows have a status other than pending`);
  return out;
}

/** Honours of a season in progress: none awarded. Empty means the contract holds. */
async function honoursViolations(q: Q, year: number): Promise<string[]> {
  const [n] = await q<{ premiers: number; spoons: number; playerPremierships: number }[]>`
    SELECT (SELECT count(*) FILTER (WHERE is_premier)::int   FROM club_seasons WHERE season = ${year})
             AS premiers,
           (SELECT count(*) FILTER (WHERE wooden_spoon)::int FROM club_seasons WHERE season = ${year})
             AS spoons,
           (SELECT count(*) FILTER (WHERE is_premier)::int   FROM player_season_stats WHERE season = ${year})
             AS "playerPremierships"
  `;
  const out: string[] = [];
  if (n.premiers > 0) out.push(`${n.premiers} club_seasons rows are premier`);
  // The raw ladder does flag a last-placed club; that is a standing, not an honour, and
  // must not survive into the derived table.
  if (n.spoons > 0) out.push(`${n.spoons} club_seasons rows hold the wooden spoon`);
  if (n.playerPremierships > 0) out.push(`${n.playerPremierships} player_season_stats rows record a premiership`);
  return out;
}

/** Build the fixture, apply `corrupt`, and report what `check` finds. */
async function checkAfter(
  corrupt: (q: Q, year: number) => Promise<unknown>,
  check: (q: Q, year: number) => Promise<string[]>,
): Promise<string[]> {
  return inRolledBackTransaction(async (tx) => {
    await establishProvisionalSeason(tx, PROVISIONAL_SEASON);
    await corrupt(tx as unknown as Q, PROVISIONAL_SEASON);
    return check(tx as unknown as Q, PROVISIONAL_SEASON);
  });
}

describe('gate: a season in progress is provisional (established by this file, rolled back)', () => {
  it('is a genuine in-progress season with something for each contract to protect', async () => {
    const proof = await inRolledBackTransaction(async (tx) => {
      await establishProvisionalSeason(tx, PROVISIONAL_SEASON);
      const q = tx as unknown as Q;
      const [ladder] = await q<{ clubs: number; lastRank: number | null; lastPlaceClubs: number }[]>`
        SELECT count(*)::int AS clubs, max(ladder_rank)::int AS "lastRank",
               count(*) FILTER (WHERE ladder_rank = 4)::int AS "lastPlaceClubs"
          FROM club_seasons WHERE season = ${PROVISIONAL_SEASON}
      `;
      const [players] = await q<{ n: number }[]>`
        SELECT count(*)::int AS n FROM player_season_stats WHERE season = ${PROVISIONAL_SEASON}
      `;
      return {
        status: await seasonStatusViolations(q, PROVISIONAL_SEASON, FIXTURE_AS_AT),
        ladder,
        players: players.n,
      };
    });
    expect(proof.status.join(' | ')).toBe('');
    // Four clubs, one of them uniquely last: a wooden spoon would exist on a completed season.
    expect(proof.ladder).toEqual({ clubs: 4, lastRank: 4, lastPlaceClubs: 1 });
    // Eight player-season rows, each of which could carry a vote.
    expect(proof.players).toBe(8);
  });

  it('reports Brownlow as pending, never as zero', async () => {
    const found = await checkAfter(async () => undefined, brownlowPendingViolations);
    expect(found.join(' | ')).toBe('');
  });

  it('awards no premier and no wooden spoon', async () => {
    const found = await checkAfter(async () => undefined, honoursViolations);
    expect(found.join(' | ')).toBe('');
  });

  it('carries an explicit as-at date and is not completed', async () => {
    const found = await checkAfter(
      async () => undefined,
      (q, year) => seasonStatusViolations(q, year, FIXTURE_AS_AT),
    );
    expect(found.join(' | ')).toBe('');
  });

  it('leaves nothing behind: the fixture is rolled back', async () => {
    const [row] = await sql<{ seasons: number; matches: number; players: number }[]>`
      SELECT (SELECT count(*)::int FROM seasons WHERE year = ANY(${[PROVISIONAL_SEASON, LATER_SEASON]}::int[]))
               AS seasons,
             (SELECT count(*)::int FROM matches WHERE match_key LIKE ${`${FIXTURE_PREFIX}%`})
               AS matches,
             (SELECT count(*)::int FROM players WHERE slug LIKE ${`${FIXTURE_PREFIX}%`})
               AS players
    `;
    expect(row).toEqual({ seasons: 0, matches: 0, players: 0 });
  });

  // Non-vacuity: every contract above is shown able to fail on this same fixture.
  it('detects a zero vote, a settled status and a published Brownlow on a season in progress', async () => {
    // pss_brownlow_grain_ck already refuses a vote under a status other than `complete`, so a
    // zero vote is only writable together with a settled status: that is the lie to catch.
    const zeroPlayerVote = await checkAfter(
      (q, year) => q`
        UPDATE player_season_stats SET brownlow_votes = 0, brownlow_status = 'complete'
         WHERE season = ${year}`,
      brownlowPendingViolations,
    );
    expect(zeroPlayerVote).toContainEqual(expect.stringContaining('player_season_stats rows carry a vote total'));
    expect(zeroPlayerVote).toContainEqual(expect.stringContaining('status other than pending'));

    const zeroMatchVote = await checkAfter(
      (q, year) => q`
        UPDATE player_match_stats SET brownlow_votes = 0
         WHERE match_id IN (SELECT id FROM matches WHERE season = ${year})`,
      brownlowPendingViolations,
    );
    expect(zeroMatchVote).toContainEqual(expect.stringContaining('player_match_stats rows carry a vote'));

    const noMedalStatus = await checkAfter(
      (q, year) => q`UPDATE player_season_stats SET brownlow_status = 'not_applicable' WHERE season = ${year}`,
      brownlowPendingViolations,
    );
    expect(noMedalStatus).toContainEqual(expect.stringContaining('status other than pending'));

    const completeGrain = await checkAfter(
      (q, year) => q`
        UPDATE stat_availability SET coverage = 'complete', is_recorded = true
         WHERE season = ${year} AND stat_key = 'brownlow_season_total'`,
      brownlowPendingViolations,
    );
    expect(completeGrain).toContainEqual(expect.stringContaining('brownlow_season_total: coverage complete'));

    const noMedalGrain = await checkAfter(
      (q, year) => q`
        UPDATE stat_availability SET coverage = 'not_applicable'
         WHERE season = ${year} AND stat_key = 'brownlow_round_votes'`,
      brownlowPendingViolations,
    );
    expect(noMedalGrain).toContainEqual(expect.stringContaining('brownlow_round_votes: coverage not_applicable'));

    const publishedRow = await checkAfter(
      (q, year) => q`
        INSERT INTO brownlow_season_votes (season, player_id, votes)
        SELECT ${year}::smallint, player_id, 2 FROM player_season_stats WHERE season = ${year} LIMIT 1`,
      brownlowPendingViolations,
    );
    expect(publishedRow).toContainEqual(expect.stringContaining('brownlow_season_votes rows for an unawarded season'));
  });

  it('detects a premier and a wooden spoon on a season in progress', async () => {
    const premier = await checkAfter(
      (q, year) => q`UPDATE club_seasons SET is_premier = true WHERE season = ${year} AND ladder_rank = 1`,
      honoursViolations,
    );
    expect(premier).toContainEqual(expect.stringContaining('club_seasons rows are premier'));

    const spoon = await checkAfter(
      (q, year) => q`UPDATE club_seasons SET wooden_spoon = true WHERE season = ${year} AND ladder_rank = 4`,
      honoursViolations,
    );
    expect(spoon).toContainEqual(expect.stringContaining('club_seasons rows hold the wooden spoon'));

    const playerPremiership = await checkAfter(
      (q, year) => q`UPDATE player_season_stats SET is_premier = true WHERE season = ${year}`,
      honoursViolations,
    );
    expect(playerPremiership).toContainEqual(expect.stringContaining('player_season_stats rows record a premiership'));
  });

  it('detects a completed season and a missing as-at date', async () => {
    const completed = await checkAfter(
      (q, year) => q`UPDATE seasons SET status = 'complete', completed_at = data_through_date WHERE year = ${year}`,
      (q, year) => seasonStatusViolations(q, year, FIXTURE_AS_AT),
    );
    expect(completed).toContainEqual(expect.stringContaining('status is complete, not in_progress'));
    expect(completed).toContainEqual(expect.stringContaining('completed_at is'));

    const noAsAt = await checkAfter(
      (q, year) => q`UPDATE seasons SET data_through_date = NULL WHERE year = ${year}`,
      (q, year) => seasonStatusViolations(q, year, FIXTURE_AS_AT),
    );
    expect(noAsAt).toContainEqual(expect.stringContaining('data_through_date is null'));
  });
});

// ---------------------------------------------------------------------
// STRUCTURE — which seasons may be in progress
// ---------------------------------------------------------------------
/**
 * The invariant: at most one season is in progress, and it is the latest season. Empty means
 * it holds. Deliberately silent about whether any season is open: the 4 Nov snapshot has none
 * and the accepted rebuild has 2027, and both are correct.
 */
async function inProgressStructureViolations(q: Q): Promise<string[]> {
  const open = await q<{ year: number; latest: boolean }[]>`
    SELECT year::int AS year, year = (SELECT max(year) FROM seasons) AS latest
      FROM seasons WHERE status = 'in_progress' ORDER BY year
  `;
  const out: string[] = [];
  if (open.length > 1) out.push(`${open.length} seasons in progress: ${open.map((s) => s.year).join(', ')}`);
  for (const season of open) {
    if (!season.latest) out.push(`season ${season.year} is in progress but is not the latest season`);
  }
  return out;
}

describe('gate: season status structure', () => {
  it('has at most one season in progress, and it is the latest', async () => {
    // TST-9: a fixture season leaked by an interrupted committed-fixture suite would fail this
    // with a bare year; the file-level beforeAll names the leak first.
    expect((await inProgressStructureViolations(sql)).join(' | ')).toBe('');
  });

  it('detects a second season in progress and an in-progress season that is not the latest', async () => {
    const two = await inRolledBackTransaction(async (tx) => {
      const q = tx as unknown as Q;
      await insertFixtureSeason(q, PROVISIONAL_SEASON, 'in_progress');
      await insertFixtureSeason(q, LATER_SEASON, 'in_progress');
      return inProgressStructureViolations(q);
    });
    // Two fixture seasons are open whatever the real table holds, so this holds on both bases.
    expect(two).toContainEqual(expect.stringContaining('seasons in progress'));
    expect(two).toContainEqual(expect.stringContaining(`season ${PROVISIONAL_SEASON} is in progress but is not the latest`));

    const notLatest = await inRolledBackTransaction(async (tx) => {
      const q = tx as unknown as Q;
      await q`UPDATE seasons SET status = 'complete' WHERE status = 'in_progress'`;
      await insertFixtureSeason(q, PROVISIONAL_SEASON, 'in_progress');
      await insertFixtureSeason(q, LATER_SEASON, 'complete');
      return inProgressStructureViolations(q);
    });
    expect(notLatest).toEqual([`season ${PROVISIONAL_SEASON} is in progress but is not the latest season`]);
  });

  it('accepts exactly one season in progress when it is the latest, and none at all', async () => {
    // The positive controls, so the check above cannot be "always violating": normalise the real
    // table inside the rolled-back transaction, then add the one legal shape.
    const one = await inRolledBackTransaction(async (tx) => {
      const q = tx as unknown as Q;
      await q`UPDATE seasons SET status = 'complete' WHERE status = 'in_progress'`;
      await insertFixtureSeason(q, PROVISIONAL_SEASON, 'in_progress');
      return inProgressStructureViolations(q);
    });
    expect(one.join(' | ')).toBe('');

    const none = await inRolledBackTransaction(async (tx) => {
      const q = tx as unknown as Q;
      await q`UPDATE seasons SET status = 'complete' WHERE status = 'in_progress'`;
      return inProgressStructureViolations(q);
    });
    expect(none.join(' | ')).toBe('');
  });
});
