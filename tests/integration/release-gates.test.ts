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
 */
import './guard';

import { createHash } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';

import {
  lockDraftTables, unlockDraftTables,
  lockHonoursTables, unlockHonoursTables,
  lockBirthDateEnrichment, unlockBirthDateEnrichment,
} from './draft-lock';
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
beforeAll(() => lockHonoursTables(integrationDsn), 300_000);
beforeAll(() => lockBirthDateEnrichment(integrationDsn), 300_000);
afterAll(async () => {
  await unlockBirthDateEnrichment();
  await unlockHonoursTables();
  await sql.end();
});

/** Same digest as tools/validation/validate_migration.py: id_hash(). */
function idHash(ids: number[]): string {
  return createHash('sha256')
    .update([...ids].sort((a, b) => a - b).join(','))
    .digest('hex')
    .slice(0, 16);
}

// ---------------------------------------------------------------------
// IMMUTABLE — Brownlow authority
// ---------------------------------------------------------------------
describe('gate: Brownlow authority', () => {
  const AUTHORITATIVE_TOTAL = 79_113;

  it('season votes total exactly 79,113', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT sum(votes)::int AS n FROM brownlow_season_votes
    `;
    expect(row.n).toBe(AUTHORITATIVE_TOTAL);
  });

  it('career totals sum to the authoritative total, not the per-game total', async () => {
    const [row] = await sql<{ career: number; perGame: number }[]>`
      SELECT (SELECT sum(brownlow_votes)::int FROM player_career_stats)  AS career,
             (SELECT sum(brownlow_votes)::int FROM player_match_stats)   AS "perGame"
    `;
    expect(row.career).toBe(AUTHORITATIVE_TOTAL);
    // The per-game table is incomplete by design; it must never be the
    // source of a career figure.
    expect(row.perGame).toBe(46_979);
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

  it('reports representative career totals', async () => {
    const rows = await sql<{ id: number; votes: number }[]>`
      SELECT player_id AS id, brownlow_votes AS votes
        FROM player_career_stats WHERE player_id IN (3702, 3578)
       ORDER BY player_id
    `;
    // Dick Reynolds: 154 authoritative against 31 per-game.
    expect(rows.find((r) => r.id === 3578)?.votes).toBe(154);
    // Bob Skilton: 180 authoritative; the per-game table has nothing at all.
    expect(rows.find((r) => r.id === 3702)?.votes).toBe(180);
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

  it('50-199 goals and zero Brownlow votes returns the exact 269 players', async () => {
    const ids = await idsFor({
      goals_min: '50',
      goals_max: '199',
      brownlow_votes_min: '0',
      brownlow_votes_max: '0',
    });
    // The headline correction. The legacy per-game derivation returned
    // 750 here; the 481 difference all polled votes between 1935 and 1983.
    expect(ids.length).toBe(269);
    expect(idHash(ids)).toBe('ae1eb8efd59b06b3');
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
    expect(idHash(ids)).toBe('8cebc4aa37002766');
  });
});

// ---------------------------------------------------------------------
// IMMUTABLE — identity is resolved by ID, never by name
// ---------------------------------------------------------------------
describe('gate: name collisions resolve by ID', () => {
  it('keeps the two Ron Barassis distinct', async () => {
    const rows = await sql<{ id: number; games: number }[]>`
      SELECT p.id, c.games FROM players p
        JOIN player_career_stats c ON c.player_id = p.id
       WHERE p.id IN (2520, 2521) ORDER BY p.id
    `;
    expect(rows).toHaveLength(2);
    expect(rows[0].id).not.toBe(rows[1].id);
    // Father and son, same name, different careers.
    expect(rows[0].games).not.toBe(rows[1].games);
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
    const rows = await sql<{
      slug: string; n: number; from: number; to: number;
    }[]>`
      SELECT c.slug, count(cs.season)::int AS n,
             min(cs.season)::int AS from, max(cs.season)::int AS to
        FROM clubs c JOIN club_seasons cs ON cs.club_id = c.id
       WHERE c.slug IN ('footscray', 'western-bulldogs',
                        'south-melbourne', 'sydney',
                        'kangaroos', 'north-melbourne')
       GROUP BY c.slug ORDER BY c.slug
    `;
    const by = Object.fromEntries(rows.map((r) => [r.slug, r]));

    // Before this was fixed, the source ladder's modern-only club names
    // gave Sydney rows back to 1897 and Footscray none at all.
    expect(by['footscray']).toMatchObject({ from: 1925, to: 1996 });
    expect(by['western-bulldogs']).toMatchObject({ from: 1997, to: 2026 });
    expect(by['south-melbourne']).toMatchObject({ from: 1897, to: 1981 });
    expect(by['sydney']).toMatchObject({ from: 1982, to: 2026 });
    expect(by['kangaroos']).toMatchObject({ from: 1999, to: 2007 });
    expect(by['north-melbourne']).toMatchObject({ from: 1925, to: 2026 });

    // The eras partition the lineage: no season is lost or duplicated.
    expect(by['footscray'].n + by['western-bulldogs'].n).toBe(102);
    expect(by['south-melbourne'].n + by['sydney'].n).toBe(129);
    expect(by['kangaroos'].n + by['north-melbourne'].n).toBe(102);
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
  // draft-reload-links.test.ts deliberately links real draft people to
  // fixture players while it runs. Wait it out rather than read a moving
  // target; the assertions below are unchanged.
  beforeAll(() => lockDraftTables(integrationDsn), 300_000);
  afterAll(unlockDraftTables);

  it('retains all 6,810 rows, including unresolved ones', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM draft_picks
    `;
    // An unmatched row is still a fact about the draft. Dropping it
    // would silently shrink the historical record.
    expect(row.n).toBe(6_810);
  });

  it('keeps the raw name on every row whether linked or not', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM draft_picks
       WHERE player_name_raw IS NULL OR player_name_raw = ''
    `;
    expect(row.n).toBe(0);
  });

  it('resolves identity once per person across 5,057 people', async () => {
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

  it('separates genuine non-players from a real matching backlog', async () => {
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

  it('records the backlog as open data issues', async () => {
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
    const rows = await sql<{ status: string; n: number }[]>`
      SELECT attendance_status AS status, count(*)::int AS n
        FROM matches GROUP BY 1 ORDER BY 2 DESC
    `;
    expect(rows).toEqual([
      { status: 'complete', n: 15_376 },
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
// IMMUTABLE — birth-date evidence
// ---------------------------------------------------------------------
describe('gate: birth dates', () => {
  it('populates 12,478 players with two visible conflicts', async () => {
    const [row] = await sql<{ withDob: number; disputed: number }[]>`
      SELECT count(*) FILTER (WHERE dob IS NOT NULL)::int AS "withDob",
             count(*) FILTER (WHERE dob_disputed)::int    AS disputed
        FROM players
    `;
    // 945 before recovery, 7.1% -> 93.4%.
    expect(row.withDob).toBe(12_478);
    expect(row.disputed).toBe(2);
  });

  it('retains the existing date wherever a source disagrees', async () => {
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

  it('opens a data issue for every disputed date', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM data_issues
       WHERE issue_type = 'dob_conflict' AND resolved_at IS NULL
    `;
    expect(row.n).toBe(2);
  });

  it('keeps the evidence behind every recovered date', async () => {
    const [row] = await sql<{ evidence: number; linked: number }[]>`
      SELECT (SELECT count(*)::int FROM player_birth_evidence)          AS evidence,
             (SELECT count(*)::int FROM players WHERE dob_evidence_id IS NOT NULL)
                                                                        AS linked
    `;
    expect(row.evidence).toBe(12_472);
    // Every filled date points back at the row that justified it.
    expect(row.linked).toBe(11_533);
  });

  it('matches players on the profile URL rather than the name', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM external_identities
       WHERE match_method = 'afltables_profile_url' AND status = 'unique'
    `;
    expect(row.n).toBe(12_472);
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

  it('leaves 883 players honestly without a date', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM players
       WHERE dob IS NULL AND dob_confidence = 'unknown'
    `;
    // Not backfilled with a guess: these are shown as "Not recorded".
    expect(row.n).toBe(883);
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
// SNAPSHOT — 2026 is still being played
// ---------------------------------------------------------------------
describe('gate: 2026 is provisional (snapshot-pinned)', () => {
  it('marks the season in progress with an explicit as-at date', async () => {
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

  it('reports 2026 Brownlow as pending, never as zero', async () => {
    const rows = await sql<{ status: string; votes: number | null }[]>`
      SELECT DISTINCT brownlow_status AS status, brownlow_votes AS votes
        FROM player_season_stats WHERE season = 2026
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].votes).toBeNull();
  });

  it('awards no premier and no wooden spoon for 2026', async () => {
    const [row] = await sql<{ premiers: number; spoons: number }[]>`
      SELECT count(*) FILTER (WHERE is_premier)::int   AS premiers,
             count(*) FILTER (WHERE wooden_spoon)::int AS spoons
        FROM club_seasons WHERE season = 2026
    `;
    expect(row.premiers).toBe(0);
    // The raw ladder does flag a last-placed club; that is a standing,
    // not an honour, and must not survive into the derived table.
    expect(row.spoons).toBe(0);
  });

  it('preserves the raw ladder untouched in staging', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM staging.team_seasons
       WHERE season = 2026 AND wooden_spoon
    `;
    // Staging is the immutable source. Correcting it there would destroy
    // the ability to reprocess.
    expect(row.n).toBe(1);
  });

  it('is the only season still in progress', async () => {
    const rows = await sql<{ year: number }[]>`
      SELECT year FROM seasons WHERE status = 'in_progress' ORDER BY year
    `;
    expect(rows.map((r) => r.year)).toEqual([2026]);
  });
});
