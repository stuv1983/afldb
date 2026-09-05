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
import { getCoach, getCoachCareer, getPlayerCoachingCareer, listCoaches } from '@/db/queries/coaches';
import { searchCoaches } from '@/db/queries/search';
import { getPlayerFamily } from '@/db/queries/players';

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
 * The `/coaches/[slug]-id` public route's identity lookup and discovery
 * index (AFLDB-ISSUE-118 §W.4). Leigh Matthews (linked) and Chris Fagan
 * (coach-only) are the same tracked fixtures {@link getCoachCareer} above
 * uses -- discovered dynamically, never a hardcoded id.
 */
describe('getCoach', () => {
  it('Leigh Matthews: a linked coach carries the player id and slug a redirect needs', async () => {
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
