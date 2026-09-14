/**
 * getPlayerFamily (player_relationships + father_son_selections) and
 * getCoachCareer / getPlayerCoachingCareer (coaches + match_coaches +
 * matches), added to unblock the player-page UI (AFLDB-ISSUE-118
 * §23.28/§23.29). getCoachCareer is the one derived aggregation, callable
 * by coach id for coach-only people too; getPlayerCoachingCareer is a
 * thin resolve-then-delegate wrapper. Identities are discovered
 * dynamically through external_identities/name_key, the same pattern
 * tests/integration/grid-solver.test.ts uses for the Abletts and Leigh
 * Matthews -- never a hardcoded player id.
 */
import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import {
  getCoach,
  getCoachCareer,
  getCoachRecordAgainstOrganization,
  getPlayerCoachingCareer,
  listCoaches,
} from '@/db/queries/coaches';
import { searchCoaches } from '@/db/queries/search';
import { getPlayerFamily } from '@/db/queries/players';
import { resolveCoachOpponentSelection } from '@/lib/coach-opponent-history';

afterAll(async () => {
  await sql.end();
});

async function profilePlayerId(profile: string): Promise<number> {
  const [row] = await sql<{ playerId: number }[]>`
    SELECT ei.player_id AS "playerId" FROM external_identities ei
      JOIN sources s ON s.id = ei.source_id
     WHERE s.key = 'afltables' AND ei.external_id = ${profile}
  `;
  expect(row, profile).toBeDefined();
  return row.playerId;
}

describe('getPlayerFamily', () => {
  it('a father with multiple sons: Gary Ablett Sr lists both sons and nothing from player_relationships is duplicated', async () => {
    const senior = await profilePlayerId('players/G/Gary_Ablett0.html');
    const family = await getPlayerFamily(senior);

    expect(family.fatherSonAsFather.map((r) => r.sonName)).toEqual(['Gary Ablett, Jr.', 'Nathan Ablett']);
    expect(family.fatherSonAsSon).toEqual([]);
    // The loader also writes one parent_child player_relationships row per
    // selection; those must not surface a second time as generic relationships.
    const fatherSonFacts = family.relationships.filter((r) => r.relationshipType === 'parent_child');
    expect(fatherSonFacts).toEqual([]);
  });

  it('a father-son selection: Gary Ablett Jr lists his father, not himself as a father', async () => {
    const junior = await profilePlayerId('players/G/Gary_Ablett1.html');
    const family = await getPlayerFamily(junior);

    expect(family.fatherSonAsSon).toHaveLength(1);
    // 'selection' is renamed 'competition': the source pathway (national |
    // rookie | pre-draft), never a formatted pick. Gary Jr (2001, pick 40)
    // also has a canonical pick number, checked below alongside a second row.
    expect(family.fatherSonAsSon[0]).toMatchObject({ fatherName: 'Gary Ablett, Sr.', competition: 'national', selectionPick: 40 });
    expect(family.fatherSonAsFather).toEqual([]);
  });

  it('a national-draft son with a recorded pick number carries it; competition is the pathway, not the pick', async () => {
    const [row] = await sql<{ id: number; pick: number | null }[]>`
      SELECT drafted_player_id AS id, selection_pick AS pick FROM father_son_selections
       WHERE competition = 'national' AND selection_pick IS NOT NULL AND drafted_player_id IS NOT NULL
       LIMIT 1
    `;
    expect(row, 'father-son stage has not loaded this database').toBeDefined();
    const family = await getPlayerFamily(row.id);
    const own = family.fatherSonAsSon.find((r) => r.selectionPick === row.pick);
    expect(own).toMatchObject({ competition: 'national', selectionPick: row.pick });
  });

  it('an unlinked relative stays name-only with a null player link', async () => {
    // Peter Morrison (Brisbane Lions 1999) is the tracked non-link: the
    // list's father is explicitly unmatched, never guessed from the name.
    const [row] = await sql<{ sonId: number }[]>`
      SELECT drafted_player_id AS "sonId" FROM father_son_selections WHERE drafted_player_name LIKE 'Shane Morrison%'
    `;
    expect(row, 'father-son stage has not loaded this database').toBeDefined();
    const family = await getPlayerFamily(row.sonId);
    expect(family.fatherSonAsSon).toHaveLength(1);
    expect(family.fatherSonAsSon[0]).toMatchObject({ fatherPlayerId: null, fatherPlayerSlug: null, fatherName: 'Peter Morrison' });
  });

  it('a player with no family data returns a clean empty result', async () => {
    const [someone] = await sql<{ id: number }[]>`
      SELECT p.id FROM players p
       WHERE NOT EXISTS (SELECT 1 FROM player_relationships r WHERE r.person_a_player_id = p.id OR r.person_b_player_id = p.id)
         AND NOT EXISTS (SELECT 1 FROM father_son_selections fs WHERE fs.drafted_player_id = p.id OR fs.father_player_id = p.id)
       LIMIT 1
    `;
    expect(someone).toBeDefined();
    const family = await getPlayerFamily(someone.id);
    expect(family).toEqual({ relationships: [], fatherSonAsSon: [], fatherSonAsFather: [] });
  });
});

/** Direct-SQL truth for a coach's derived aggregation, grouped by club. */
async function coachTruth(coachId: number) {
  return sql<{
    clubId: number; games: number; wins: number; draws: number; losses: number;
    finals: number; grandFinals: number; premierships: number;
  }[]>`
    SELECT mc.club_id AS "clubId",
           count(*)::int AS games,
           count(*) FILTER (WHERE m.winner_club_id = mc.club_id)::int AS wins,
           count(*) FILTER (WHERE m.winner_club_id IS NULL)::int AS draws,
           count(*) FILTER (WHERE m.winner_club_id IS NOT NULL AND m.winner_club_id <> mc.club_id)::int AS losses,
           count(*) FILTER (WHERE m.is_finals_series)::int AS finals,
           count(*) FILTER (WHERE m.round_type = 'grand_final')::int AS "grandFinals",
           count(*) FILTER (WHERE m.round_type = 'grand_final' AND m.winner_club_id = mc.club_id)::int AS premierships
      FROM match_coaches mc JOIN matches m ON m.id = mc.match_id
     WHERE mc.coach_id = ${coachId}
     GROUP BY mc.club_id
  `;
}

function sumTruth(truth: Awaited<ReturnType<typeof coachTruth>>) {
  return truth.reduce((acc, t) => ({
    games: acc.games + t.games, wins: acc.wins + t.wins, draws: acc.draws + t.draws,
    losses: acc.losses + t.losses, finals: acc.finals + t.finals,
    grandFinals: acc.grandFinals + t.grandFinals, premierships: acc.premierships + t.premierships,
  }), { games: 0, wins: 0, draws: 0, losses: 0, finals: 0, grandFinals: 0, premierships: 0 });
}

describe('getCoachCareer', () => {
  it('Leigh Matthews (linked player/coach): derived totals equal direct canonical SQL, across multiple clubs', async () => {
    const [matthews] = await sql<{ id: number; playerId: number | null }[]>`
      SELECT id, player_id AS "playerId" FROM coaches WHERE name_key = 'Matthews, Leigh'
    `;
    expect(matthews, 'the coaches stage has not loaded this database').toBeDefined();
    expect(matthews.playerId).not.toBeNull();

    const truth = await coachTruth(matthews.id);
    expect(truth.length).toBeGreaterThan(1);

    const career = await getCoachCareer(matthews.id);
    expect(career).not.toBeNull();
    expect(career!.coachId).toBe(matthews.id);
    expect(career!.clubs).toHaveLength(truth.length);

    const truthByClub = new Map(truth.map((t) => [t.clubId, t]));
    for (const club of career!.clubs) {
      const t = truthByClub.get(club.clubId);
      expect(t, `club ${club.clubId}`).toBeDefined();
      expect(club).toMatchObject({
        games: t!.games, wins: t!.wins, draws: t!.draws, losses: t!.losses,
        finals: t!.finals, grandFinals: t!.grandFinals, premierships: t!.premierships,
      });
    }
    expect(career!.totals).toMatchObject(sumTruth(truth));
    expect(career!.totals.premierships).toBeGreaterThan(0);

    // getPlayerCoachingCareer is a thin wrapper: same coach, same result.
    const viaPlayer = await getPlayerCoachingCareer(matthews.playerId!);
    expect(viaPlayer).toEqual(career);
  });

  it('Chris Fagan (coach-only, player_id IS NULL): the aggregation still works by coach id', async () => {
    const [fagan] = await sql<{ id: number; playerId: number | null }[]>`
      SELECT id, player_id AS "playerId" FROM coaches WHERE name_key = 'Fagan, Chris'
    `;
    expect(fagan, 'the coaches stage has not loaded this database').toBeDefined();
    expect(fagan.playerId).toBeNull();

    const truth = await coachTruth(fagan.id);
    expect(truth.length).toBeGreaterThan(0);

    const career = await getCoachCareer(fagan.id);
    expect(career).not.toBeNull();
    expect(career!.coachId).toBe(fagan.id);
    expect(career!.totals).toMatchObject(sumTruth(truth));

    // No player link exists, so the player-scoped wrapper cannot reach him.
    const [asPlayer] = await sql<{ id: number }[]>`
      SELECT id FROM players WHERE display_name = 'Chris Fagan'
    `;
    if (asPlayer) expect(await getPlayerCoachingCareer(asPlayer.id)).toBeNull();
  });

  it('an invalid/nonexistent coach id returns null', async () => {
    expect(await getCoachCareer(-1)).toBeNull();
  });
});

/**
 * AFLDB-ISSUE-170 Stage 1A: biggest win/loss, added to the same
 * {@link getCoachCareer} boundary. selectCareerRecordMatch's tie rule and
 * coachPerspectiveMargin's home/away formula are unit-tested directly
 * (tests/coaches.test.ts) with fixtures; these tests only prove the real
 * query wires that logic to canonical data correctly, cross-checked
 * against a direct-SQL truth query rather than a hardcoded margin.
 */
describe('getCoachCareer — biggest win/loss', () => {
  it('Leigh Matthews: biggest win/loss and totals match a direct canonical cross-check', async () => {
    const [matthews] = await sql<{ id: number }[]>`
      SELECT id FROM coaches WHERE name_key = 'Matthews, Leigh'
    `;
    expect(matthews, 'the coaches stage has not loaded this database').toBeDefined();

    const career = await getCoachCareer(matthews.id);
    expect(career).not.toBeNull();
    expect(career!.biggestWin).not.toBeNull();
    expect(career!.biggestLoss).not.toBeNull();

    // Existing totals are untouched by this stage: still equal direct truth.
    const truth = await coachTruth(matthews.id);
    expect(career!.totals).toMatchObject(sumTruth(truth));

    // Independent direct-SQL selection of the biggest win, scoped to WIN
    // assignments only (m.winner_club_id = mc.club_id) and applying the
    // same deterministic tie rule as selectCareerRecordMatch -- greatest
    // margin, then earliest match_date, then lowest match id -- entirely
    // from scratch, not by reusing the production margin/tie-break logic.
    //
    // Comparing signed margin (not abs()) and scoping to one direction at
    // a time both matter here: an abs()/direction-agnostic comparison
    // would let a bigger WIN "beat" the biggest LOSS (or vice versa),
    // which is not a real counter-example -- wins and losses are never
    // compared against each other.
    const [expectedWin] = await sql<{ matchId: number; margin: number }[]>`
      SELECT m.id AS "matchId",
             (CASE WHEN mc.club_id = m.home_club_id THEN m.home_score - m.away_score
                   ELSE m.away_score - m.home_score END)::int AS margin
        FROM match_coaches mc JOIN matches m ON m.id = mc.match_id
       WHERE mc.coach_id = ${matthews.id} AND m.winner_club_id = mc.club_id
       ORDER BY (CASE WHEN mc.club_id = m.home_club_id THEN m.home_score - m.away_score
                      ELSE m.away_score - m.home_score END) DESC,
                m.match_date ASC, m.id ASC
       LIMIT 1
    `;
    expect(expectedWin, `no win found for coach ${matthews.id}`).toBeDefined();
    expect(career!.biggestWin).toMatchObject({ matchId: expectedWin.matchId, margin: expectedWin.margin });

    // Mirrored for the biggest loss: scoped to LOSS assignments only, most
    // negative margin first (largest loss magnitude), same tie-break tuple.
    const [expectedLoss] = await sql<{ matchId: number; margin: number }[]>`
      SELECT m.id AS "matchId",
             (CASE WHEN mc.club_id = m.home_club_id THEN m.home_score - m.away_score
                   ELSE m.away_score - m.home_score END)::int AS margin
        FROM match_coaches mc JOIN matches m ON m.id = mc.match_id
       WHERE mc.coach_id = ${matthews.id} AND m.winner_club_id IS NOT NULL AND m.winner_club_id <> mc.club_id
       ORDER BY (CASE WHEN mc.club_id = m.home_club_id THEN m.home_score - m.away_score
                      ELSE m.away_score - m.home_score END) ASC,
                m.match_date ASC, m.id ASC
       LIMIT 1
    `;
    expect(expectedLoss, `no loss found for coach ${matthews.id}`).toBeDefined();
    expect(career!.biggestLoss).toMatchObject({ matchId: expectedLoss.matchId, margin: expectedLoss.margin });
  });

  it('Jim Adamson (coach id 315): zero canonical coaching assignments render safely, never a fabricated record', async () => {
    const adamson = await getCoach(315);
    expect(adamson, 'Jim Adamson (id 315) — see AFLDB-ISSUE-170.md §0.2; discovery evidence may be stale').toBeDefined();

    const career = await getCoachCareer(315);
    expect(career).not.toBeNull();
    expect(career!.totals).toMatchObject({ games: 0, wins: 0, draws: 0, losses: 0 });
    expect(career!.totals.winPct).toBeNull();
    expect(career!.clubs).toEqual([]);
    expect(career!.biggestWin).toBeNull();
    expect(career!.biggestLoss).toBeNull();
  });
});

/**
 * AFLDB-ISSUE-170 Stage 1B: venue history, added to the same
 * {@link getCoachCareer} boundary. Cross-checked against a direct-SQL
 * oracle built from scratch (not by re-running the production aggregation
 * query), and against a generic ordering invariant rather than a
 * hard-coded tie, since a real tied games-count for one coach cannot be
 * relied on to exist in historical data.
 */
describe('getCoachCareer — venue history', () => {
  it("Leigh Matthews: top venue's W/L/D, win %, finals, Grand Finals and first/last dates match a direct canonical cross-check", async () => {
    const [matthews] = await sql<{ id: number }[]>`
      SELECT id FROM coaches WHERE name_key = 'Matthews, Leigh'
    `;
    expect(matthews, 'the coaches stage has not loaded this database').toBeDefined();

    const career = await getCoachCareer(matthews.id);
    expect(career).not.toBeNull();
    expect(career!.venues.length).toBeGreaterThan(1);

    // Existing totals and biggest win/loss are untouched by this stage.
    const truth = await coachTruth(matthews.id);
    expect(career!.totals).toMatchObject(sumTruth(truth));
    expect(career!.biggestWin).not.toBeNull();
    expect(career!.biggestLoss).not.toBeNull();

    const topVenue = career!.venues[0];

    const [venueTruth] = await sql<{
      games: number; wins: number; draws: number; losses: number;
      finals: number; grandFinals: number; firstMatchDate: Date; lastMatchDate: Date;
    }[]>`
      SELECT count(*)::int AS games,
             count(*) FILTER (WHERE m.winner_club_id = mc.club_id)::int AS wins,
             count(*) FILTER (WHERE m.winner_club_id IS NULL)::int AS draws,
             count(*) FILTER (WHERE m.winner_club_id IS NOT NULL AND m.winner_club_id <> mc.club_id)::int AS losses,
             count(*) FILTER (WHERE m.is_finals_series)::int AS finals,
             count(*) FILTER (WHERE m.round_type = 'grand_final')::int AS "grandFinals",
             min(m.match_date) AS "firstMatchDate",
             max(m.match_date) AS "lastMatchDate"
        FROM match_coaches mc JOIN matches m ON m.id = mc.match_id
       WHERE mc.coach_id = ${matthews.id} AND m.venue_id = ${topVenue.venueId}
    `;
    expect(venueTruth, `no assignments found at venue ${topVenue.venueId}`).toBeDefined();

    expect(topVenue).toMatchObject({
      games: venueTruth.games, wins: venueTruth.wins, draws: venueTruth.draws, losses: venueTruth.losses,
      finals: venueTruth.finals, grandFinals: venueTruth.grandFinals,
    });
    expect(topVenue.firstMatchDate.toISOString()).toBe(venueTruth.firstMatchDate.toISOString());
    expect(topVenue.lastMatchDate.toISOString()).toBe(venueTruth.lastMatchDate.toISOString());

    // Win % is the site's draw-half formula, recomputed independently
    // from the row's own wins/draws/games rather than by importing the
    // production winPct() helper.
    const expectedWinPct = ((topVenue.wins + topVenue.draws * 0.5) / topVenue.games) * 100;
    expect(topVenue.winPct).toBeCloseTo(expectedWinPct, 9);

    // firstMatchId/lastMatchId name a real match at this venue whose own
    // match_date agrees with the reported boundary date.
    const [firstMatch] = await sql<{ matchDate: Date; venueId: number }[]>`
      SELECT match_date AS "matchDate", venue_id AS "venueId" FROM matches WHERE id = ${topVenue.firstMatchId}
    `;
    const [lastMatch] = await sql<{ matchDate: Date; venueId: number }[]>`
      SELECT match_date AS "matchDate", venue_id AS "venueId" FROM matches WHERE id = ${topVenue.lastMatchId}
    `;
    expect(firstMatch.venueId).toBe(topVenue.venueId);
    expect(firstMatch.matchDate.toISOString()).toBe(venueTruth.firstMatchDate.toISOString());
    expect(lastMatch.venueId).toBe(topVenue.venueId);
    expect(lastMatch.matchDate.toISOString()).toBe(venueTruth.lastMatchDate.toISOString());

    // Deterministic ordering: games DESC, venue name ASC, venue id ASC --
    // checked as a general invariant over every returned row rather than a
    // single hard-coded tie, since a real tied games-count cannot be
    // relied on to exist for this coach.
    for (let i = 1; i < career!.venues.length; i++) {
      const prev = career!.venues[i - 1];
      const cur = career!.venues[i];
      if (prev.games !== cur.games) {
        expect(prev.games).toBeGreaterThan(cur.games);
      } else if (prev.venueName !== cur.venueName) {
        expect(prev.venueName < cur.venueName).toBe(true);
      } else {
        expect(prev.venueId).toBeLessThan(cur.venueId);
      }
    }
  });

  it('Jim Adamson (coach id 315): zero canonical coaching assignments yield an empty venue list, never a fabricated venue', async () => {
    const career = await getCoachCareer(315);
    expect(career).not.toBeNull();
    expect(career!.venues).toEqual([]);
  });
});

describe('getPlayerCoachingCareer', () => {
  it('a player with no linked coaching row returns null', async () => {
    const [someone] = await sql<{ id: number }[]>`
      SELECT p.id FROM players p
       WHERE NOT EXISTS (SELECT 1 FROM coaches c WHERE c.player_id = p.id AND c.link_status_value = 'unique')
       LIMIT 1
    `;
    expect(someone).toBeDefined();
    expect(await getPlayerCoachingCareer(someone.id)).toBeNull();
  });
});

/**
 * AFLDB-ISSUE-170 Stage 1C: a coach's record against one opponent
 * club-organisation. Every fixture below is discovered dynamically from
 * canonical data (never a hardcoded coach/organisation id), and every
 * cross-check query is built from scratch rather than by re-running
 * getCoachRecordAgainstOrganization's own SQL or importing its helpers.
 */
describe('getCoachRecordAgainstOrganization', () => {
  it("Leigh Matthews: Games/W/D/L, Win%, Finals and Grand Finals against his most-faced opponent organisation match a direct canonical cross-check", async () => {
    const [matthews] = await sql<{ id: number }[]>`
      SELECT id FROM coaches WHERE name_key = 'Matthews, Leigh'
    `;
    expect(matthews, 'the coaches stage has not loaded this database').toBeDefined();

    const [topOrg] = await sql<{ organizationId: number; games: number }[]>`
      SELECT oc.organization_id AS "organizationId", count(*)::int AS games
        FROM match_coaches mc
        JOIN matches m ON m.id = mc.match_id
        JOIN clubs oc ON oc.id = (CASE WHEN mc.club_id = m.home_club_id THEN m.away_club_id ELSE m.home_club_id END)
       WHERE mc.coach_id = ${matthews.id}
       GROUP BY oc.organization_id
       ORDER BY count(*) DESC
       LIMIT 1
    `;
    expect(topOrg, 'no opponent organisation found for Leigh Matthews').toBeDefined();

    const record = await getCoachRecordAgainstOrganization(matthews.id, topOrg.organizationId);
    expect(record).not.toBeNull();
    expect(record!.coachId).toBe(matthews.id);
    expect(record!.organization.id).toBe(topOrg.organizationId);
    expect(record!.totals.games).toBe(topOrg.games);

    const [truth] = await sql<{
      wins: number; draws: number; losses: number; finals: number; grandFinals: number;
    }[]>`
      SELECT count(*) FILTER (WHERE m.winner_club_id = mc.club_id)::int AS wins,
             count(*) FILTER (WHERE m.winner_club_id IS NULL)::int AS draws,
             count(*) FILTER (WHERE m.winner_club_id IS NOT NULL AND m.winner_club_id <> mc.club_id)::int AS losses,
             count(*) FILTER (WHERE m.is_finals_series)::int AS finals,
             count(*) FILTER (WHERE m.round_type = 'grand_final')::int AS "grandFinals"
        FROM match_coaches mc
        JOIN matches m ON m.id = mc.match_id
        JOIN clubs oc ON oc.id = (CASE WHEN mc.club_id = m.home_club_id THEN m.away_club_id ELSE m.home_club_id END)
       WHERE mc.coach_id = ${matthews.id} AND oc.organization_id = ${topOrg.organizationId}
    `;
    expect(record!.totals).toMatchObject(truth);
    const expectedWinPct = ((truth.wins + truth.draws * 0.5) / topOrg.games) * 100;
    expect(record!.totals.winPct).toBeCloseTo(expectedWinPct, 9);
  });

  it('Leigh Matthews: biggest win/loss against that organisation match a direct canonical cross-check', async () => {
    const [matthews] = await sql<{ id: number }[]>`
      SELECT id FROM coaches WHERE name_key = 'Matthews, Leigh'
    `;
    expect(matthews).toBeDefined();

    const [topOrg] = await sql<{ organizationId: number }[]>`
      SELECT oc.organization_id AS "organizationId"
        FROM match_coaches mc
        JOIN matches m ON m.id = mc.match_id
        JOIN clubs oc ON oc.id = (CASE WHEN mc.club_id = m.home_club_id THEN m.away_club_id ELSE m.home_club_id END)
       WHERE mc.coach_id = ${matthews.id} AND m.winner_club_id IS NOT NULL
       GROUP BY oc.organization_id
      HAVING count(*) FILTER (WHERE m.winner_club_id = mc.club_id) > 0
         AND count(*) FILTER (WHERE m.winner_club_id <> mc.club_id) > 0
       ORDER BY count(*) DESC
       LIMIT 1
    `;
    expect(topOrg, 'no opponent organisation with both a win and a loss found for Leigh Matthews').toBeDefined();

    const record = await getCoachRecordAgainstOrganization(matthews.id, topOrg.organizationId);
    expect(record!.biggestWin).not.toBeNull();
    expect(record!.biggestLoss).not.toBeNull();

    const [expectedWin] = await sql<{ matchId: number; margin: number }[]>`
      SELECT m.id AS "matchId",
             (CASE WHEN mc.club_id = m.home_club_id THEN m.home_score - m.away_score
                   ELSE m.away_score - m.home_score END)::int AS margin
        FROM match_coaches mc
        JOIN matches m ON m.id = mc.match_id
        JOIN clubs oc ON oc.id = (CASE WHEN mc.club_id = m.home_club_id THEN m.away_club_id ELSE m.home_club_id END)
       WHERE mc.coach_id = ${matthews.id} AND m.winner_club_id = mc.club_id
         AND oc.organization_id = ${topOrg.organizationId}
       ORDER BY (CASE WHEN mc.club_id = m.home_club_id THEN m.home_score - m.away_score
                      ELSE m.away_score - m.home_score END) DESC,
                m.match_date ASC, m.id ASC
       LIMIT 1
    `;
    expect(record!.biggestWin).toMatchObject({ matchId: expectedWin.matchId, margin: expectedWin.margin });

    const [expectedLoss] = await sql<{ matchId: number; margin: number }[]>`
      SELECT m.id AS "matchId",
             (CASE WHEN mc.club_id = m.home_club_id THEN m.home_score - m.away_score
                   ELSE m.away_score - m.home_score END)::int AS margin
        FROM match_coaches mc
        JOIN matches m ON m.id = mc.match_id
        JOIN clubs oc ON oc.id = (CASE WHEN mc.club_id = m.home_club_id THEN m.away_club_id ELSE m.home_club_id END)
       WHERE mc.coach_id = ${matthews.id} AND m.winner_club_id IS NOT NULL AND m.winner_club_id <> mc.club_id
         AND oc.organization_id = ${topOrg.organizationId}
       ORDER BY (CASE WHEN mc.club_id = m.home_club_id THEN m.home_score - m.away_score
                      ELSE m.away_score - m.home_score END) ASC,
                m.match_date ASC, m.id ASC
       LIMIT 1
    `;
    expect(record!.biggestLoss).toMatchObject({ matchId: expectedLoss.matchId, margin: expectedLoss.margin });
  });

  it('Leigh Matthews: venue breakdown against that organisation matches a direct canonical cross-check and stays deterministically ordered', async () => {
    const [matthews] = await sql<{ id: number }[]>`
      SELECT id FROM coaches WHERE name_key = 'Matthews, Leigh'
    `;
    expect(matthews).toBeDefined();

    const [topOrg] = await sql<{ organizationId: number }[]>`
      SELECT oc.organization_id AS "organizationId", count(DISTINCT m.venue_id)::int AS venues
        FROM match_coaches mc
        JOIN matches m ON m.id = mc.match_id
        JOIN clubs oc ON oc.id = (CASE WHEN mc.club_id = m.home_club_id THEN m.away_club_id ELSE m.home_club_id END)
       WHERE mc.coach_id = ${matthews.id}
       GROUP BY oc.organization_id
      HAVING count(DISTINCT m.venue_id) > 1
       ORDER BY count(*) DESC
       LIMIT 1
    `;
    expect(topOrg, 'no opponent organisation with more than one venue found for Leigh Matthews').toBeDefined();

    const record = await getCoachRecordAgainstOrganization(matthews.id, topOrg.organizationId);
    expect(record!.venues.length).toBeGreaterThan(1);

    const topVenue = record!.venues[0];
    const [venueTruth] = await sql<{
      games: number; wins: number; draws: number; losses: number;
      finals: number; grandFinals: number; firstMatchDate: Date; lastMatchDate: Date;
    }[]>`
      SELECT count(*)::int AS games,
             count(*) FILTER (WHERE m.winner_club_id = mc.club_id)::int AS wins,
             count(*) FILTER (WHERE m.winner_club_id IS NULL)::int AS draws,
             count(*) FILTER (WHERE m.winner_club_id IS NOT NULL AND m.winner_club_id <> mc.club_id)::int AS losses,
             count(*) FILTER (WHERE m.is_finals_series)::int AS finals,
             count(*) FILTER (WHERE m.round_type = 'grand_final')::int AS "grandFinals",
             min(m.match_date) AS "firstMatchDate",
             max(m.match_date) AS "lastMatchDate"
        FROM match_coaches mc
        JOIN matches m ON m.id = mc.match_id
        JOIN clubs oc ON oc.id = (CASE WHEN mc.club_id = m.home_club_id THEN m.away_club_id ELSE m.home_club_id END)
       WHERE mc.coach_id = ${matthews.id} AND oc.organization_id = ${topOrg.organizationId}
         AND m.venue_id = ${topVenue.venueId}
    `;
    expect(topVenue).toMatchObject({
      games: venueTruth.games, wins: venueTruth.wins, draws: venueTruth.draws, losses: venueTruth.losses,
      finals: venueTruth.finals, grandFinals: venueTruth.grandFinals,
    });
    expect(topVenue.firstMatchDate.toISOString()).toBe(venueTruth.firstMatchDate.toISOString());
    expect(topVenue.lastMatchDate.toISOString()).toBe(venueTruth.lastMatchDate.toISOString());

    for (let i = 1; i < record!.venues.length; i++) {
      const prev = record!.venues[i - 1];
      const cur = record!.venues[i];
      if (prev.games !== cur.games) {
        expect(prev.games).toBeGreaterThan(cur.games);
      } else if (prev.venueName !== cur.venueName) {
        expect(prev.venueName < cur.venueName).toBe(true);
      } else {
        expect(prev.venueId).toBeLessThan(cur.venueId);
      }
    }
  });

  it("organisation lineage: a coach's record against an organisation combines every historical identity it has traded under, not just one", async () => {
    const [pair] = await sql<{ coachId: number; organizationId: number; identities: number; total: number }[]>`
      SELECT mc.coach_id AS "coachId", oc.organization_id AS "organizationId",
             count(DISTINCT oc.id)::int AS identities, count(*)::int AS total
        FROM match_coaches mc
        JOIN matches m ON m.id = mc.match_id
        JOIN clubs oc ON oc.id = (CASE WHEN mc.club_id = m.home_club_id THEN m.away_club_id ELSE m.home_club_id END)
       GROUP BY mc.coach_id, oc.organization_id
      HAVING count(DISTINCT oc.id) >= 2
       ORDER BY count(DISTINCT oc.id) DESC, count(*) DESC
       LIMIT 1
    `;
    expect(pair, 'no coach/organisation pair spans multiple historical identities in this database').toBeDefined();

    const record = await getCoachRecordAgainstOrganization(pair.coachId, pair.organizationId);
    expect(record).not.toBeNull();
    expect(record!.totals.games).toBe(pair.total);

    // The single historical identity this coach faced most, within the same
    // organisation, must undercount relative to the full lineage total --
    // the assertion that fails if the implementation scoped by one
    // clubs.id instead of clubs.organization_id.
    const [biggestSlice] = await sql<{ games: number }[]>`
      SELECT count(*)::int AS games
        FROM match_coaches mc
        JOIN matches m ON m.id = mc.match_id
        JOIN clubs oc ON oc.id = (CASE WHEN mc.club_id = m.home_club_id THEN m.away_club_id ELSE m.home_club_id END)
       WHERE mc.coach_id = ${pair.coachId} AND oc.organization_id = ${pair.organizationId}
       GROUP BY oc.id
       ORDER BY count(*) DESC
       LIMIT 1
    `;
    expect(biggestSlice, 'no per-identity slice found').toBeDefined();
    expect(biggestSlice.games).toBeLessThan(record!.totals.games);
  });

  it('a recognised coach/organisation pair with zero canonical meetings returns a deliberate zero-record, not null', async () => {
    const [pair] = await sql<{ coachId: number; organizationId: number }[]>`
      SELECT c.id AS "coachId", o.id AS "organizationId"
        FROM coaches c
        CROSS JOIN club_organizations o
       WHERE NOT EXISTS (
               SELECT 1
                 FROM match_coaches mc
                 JOIN matches m ON m.id = mc.match_id
                 JOIN clubs oc
                   ON oc.id = (CASE WHEN mc.club_id = m.home_club_id THEN m.away_club_id ELSE m.home_club_id END)
                WHERE mc.coach_id = c.id AND oc.organization_id = o.id
             )
       LIMIT 1
    `;
    expect(pair, 'no zero-meeting coach/organisation pair found').toBeDefined();

    const record = await getCoachRecordAgainstOrganization(pair.coachId, pair.organizationId);
    expect(record).not.toBeNull();
    expect(record!.totals).toMatchObject({ games: 0, wins: 0, draws: 0, losses: 0, finals: 0, grandFinals: 0 });
    expect(record!.totals.winPct).toBeNull();
    expect(record!.biggestWin).toBeNull();
    expect(record!.biggestLoss).toBeNull();
    expect(record!.venues).toEqual([]);
  });

  it('an unrecognised coach id or organisation id returns null', async () => {
    const [anyOrg] = await sql<{ id: number }[]>`SELECT id FROM club_organizations LIMIT 1`;
    expect(anyOrg).toBeDefined();
    expect(await getCoachRecordAgainstOrganization(-1, anyOrg.id)).toBeNull();

    const [anyCoach] = await sql<{ id: number }[]>`SELECT id FROM coaches LIMIT 1`;
    expect(anyCoach).toBeDefined();
    expect(await getCoachRecordAgainstOrganization(anyCoach.id, -1)).toBeNull();
  });
});

/**
 * The Stage 1C opponent-selection resolver shared by the standalone coach
 * page's server-rendered selector and the player-linked coaching
 * surface's `/api/coaches/[id]/opponent-record` route handler
 * (AFLDB-ISSUE-170 Stage 1D). It is a thin slug-resolve-then-delegate
 * wrapper over {@link getOrganizationBySlug} and
 * {@link getCoachRecordAgainstOrganization} above, so these checks only
 * prove the wrapping — not the aggregation, already proven in full above.
 */
describe('resolveCoachOpponentSelection', () => {
  it('no requested slug resolves to "none", never running a query', async () => {
    const [anyCoach] = await sql<{ id: number }[]>`SELECT id FROM coaches LIMIT 1`;
    expect(anyCoach).toBeDefined();
    expect(await resolveCoachOpponentSelection(anyCoach.id, undefined)).toEqual({ kind: 'none' });
  });

  it("a valid opponent slug resolves the same record getCoachRecordAgainstOrganization returns directly", async () => {
    const [matthews] = await sql<{ id: number }[]>`
      SELECT id FROM coaches WHERE name_key = 'Matthews, Leigh'
    `;
    expect(matthews, 'the coaches stage has not loaded this database').toBeDefined();

    const [topOrg] = await sql<{ organizationId: number; slug: string }[]>`
      SELECT o.id AS "organizationId", o.slug
        FROM match_coaches mc
        JOIN matches m ON m.id = mc.match_id
        JOIN clubs oc ON oc.id = (CASE WHEN mc.club_id = m.home_club_id THEN m.away_club_id ELSE m.home_club_id END)
        JOIN club_organizations o ON o.id = oc.organization_id
       WHERE mc.coach_id = ${matthews.id}
       GROUP BY o.id, o.slug
       ORDER BY count(*) DESC
       LIMIT 1
    `;
    expect(topOrg, 'no opponent organisation found for Leigh Matthews').toBeDefined();

    const direct = await getCoachRecordAgainstOrganization(matthews.id, topOrg.organizationId);
    const selection = await resolveCoachOpponentSelection(matthews.id, topOrg.slug);

    expect(selection.kind).toBe('resolved');
    if (selection.kind !== 'resolved') throw new Error('unreachable');
    expect(selection.organization.id).toBe(topOrg.organizationId);
    expect(selection.record).toEqual(direct);
  });

  it('an unrecognised opponent slug is "invalid" with the requested value, never a thrown error', async () => {
    const [anyCoach] = await sql<{ id: number }[]>`SELECT id FROM coaches LIMIT 1`;
    expect(anyCoach).toBeDefined();
    expect(await resolveCoachOpponentSelection(anyCoach.id, 'not-a-real-club-organisation-xyz')).toEqual({
      kind: 'invalid',
      requested: 'not-a-real-club-organisation-xyz',
    });
  });

  it('a real, zero-meeting organisation still resolves — a coverage gap is never reported as an invalid selection', async () => {
    const [pair] = await sql<{ coachId: number; organizationId: number; slug: string }[]>`
      SELECT c.id AS "coachId", o.id AS "organizationId", o.slug
        FROM coaches c
        CROSS JOIN club_organizations o
       WHERE NOT EXISTS (
               SELECT 1
                 FROM match_coaches mc
                 JOIN matches m ON m.id = mc.match_id
                 JOIN clubs oc
                   ON oc.id = (CASE WHEN mc.club_id = m.home_club_id THEN m.away_club_id ELSE m.home_club_id END)
                WHERE mc.coach_id = c.id AND oc.organization_id = o.id
             )
       LIMIT 1
    `;
    expect(pair, 'no zero-meeting coach/organisation pair found').toBeDefined();

    const selection = await resolveCoachOpponentSelection(pair.coachId, pair.slug);
    expect(selection.kind).toBe('resolved');
    if (selection.kind !== 'resolved') throw new Error('unreachable');
    expect(selection.record.totals.games).toBe(0);
    expect(selection.record.biggestWin).toBeNull();
    expect(selection.record.venues).toEqual([]);
  });
});

/**
 * The `/coaches/[slug]-id` public route's identity lookup and discovery
 * index (AFLDB-ISSUE-118 §W.4). Leigh Matthews (linked) and Chris Fagan
 * (coach-only) are the same tracked fixtures {@link getCoachCareer} above
 * uses -- discovered dynamically, never a hardcoded id.
 */
describe('getCoach', () => {
  // AFLDB-ISSUE-170 Stage 1E: these two fields no longer drive a redirect to
  // the player page — they are what the coach page's "View playing career"
  // link is built from — but the route still needs both of them present.
  it('Leigh Matthews: a linked coach carries the player id and slug the playing-career link needs', async () => {
    const [matthews] = await sql<{ id: number; playerId: number | null }[]>`
      SELECT id, player_id AS "playerId" FROM coaches WHERE name_key = 'Matthews, Leigh'
    `;
    expect(matthews, 'the coaches stage has not loaded this database').toBeDefined();
    expect(matthews.playerId).not.toBeNull();

    const identity = await getCoach(matthews.id);
    expect(identity).not.toBeNull();
    expect(identity!.playerId).toBe(matthews.playerId);
    expect(identity!.playerSlug).not.toBeNull();
  });

  it('Chris Fagan: a coach-only identity carries no player id or slug', async () => {
    const [fagan] = await sql<{ id: number }[]>`
      SELECT id FROM coaches WHERE name_key = 'Fagan, Chris'
    `;
    expect(fagan, 'the coaches stage has not loaded this database').toBeDefined();

    const identity = await getCoach(fagan.id);
    expect(identity).not.toBeNull();
    expect(identity!.playerId).toBeNull();
    expect(identity!.playerSlug).toBeNull();
  });

  it('an invalid/nonexistent coach id returns null, never a fabricated identity', async () => {
    expect(await getCoach(-1)).toBeNull();
  });
});

describe('listCoaches', () => {
  it('includes both a linked and a coach-only person, each with their own link fields', async () => {
    const coaches = await listCoaches();
    expect(coaches.length).toBeGreaterThan(0);

    const matthews = coaches.find((c) => c.displayName.includes('Leigh Matthews'));
    const fagan = coaches.find((c) => c.displayName.includes('Chris Fagan'));
    expect(matthews, 'the coaches stage has not loaded this database').toBeDefined();
    expect(fagan, 'the coaches stage has not loaded this database').toBeDefined();

    expect(matthews!.playerId).not.toBeNull();
    expect(matthews!.playerSlug).not.toBeNull();
    expect(fagan!.playerId).toBeNull();
    expect(fagan!.playerSlug).toBeNull();
  });
});

describe('searchCoaches', () => {
  it('finds a coach-only person by name', async () => {
    const results = await searchCoaches('Chris Fagan');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toContain('Chris Fagan');
    expect(results[0].type).toBe('coach');
  });

  it('never returns a coach who also played -- that person is a Player search result, not a Coach one', async () => {
    const results = await searchCoaches('Leigh Matthews');
    expect(results.find((r) => r.title.includes('Leigh Matthews'))).toBeUndefined();
  });
});
