/**
 * getPlayerFamily (player_relationships + father_son_selections) and
 * getPlayerCoachingCareer (coaches + match_coaches + matches), added to
 * unblock the player-page UI (AFLDB-ISSUE-118 §23.28/§23.29). Identities
 * are discovered dynamically through external_identities/name_key, the
 * same pattern tests/integration/grid-solver.test.ts uses for the Abletts
 * and Leigh Matthews -- never a hardcoded player id.
 */
import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { getPlayerCoachingCareer } from '@/db/queries/coaches';
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
    expect(family.fatherSonAsSon[0]).toMatchObject({ fatherName: 'Gary Ablett, Sr.' });
    expect(family.fatherSonAsFather).toEqual([]);
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

describe('getPlayerCoachingCareer', () => {
  it('Leigh Matthews: derived totals equal direct canonical SQL, across multiple clubs', async () => {
    const [matthews] = await sql<{ id: number; playerId: number | null }[]>`
      SELECT id, player_id AS "playerId" FROM coaches WHERE name_key = 'Matthews, Leigh'
    `;
    expect(matthews, 'the coaches stage has not loaded this database').toBeDefined();
    expect(matthews.playerId).not.toBeNull();

    const truth = await sql<{
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
       WHERE mc.coach_id = ${matthews.id}
       GROUP BY mc.club_id
    `;
    expect(truth.length).toBeGreaterThan(1);

    const career = await getPlayerCoachingCareer(matthews.playerId!);
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

    const totalsTruth = truth.reduce((acc, t) => ({
      games: acc.games + t.games, wins: acc.wins + t.wins, draws: acc.draws + t.draws,
      losses: acc.losses + t.losses, finals: acc.finals + t.finals,
      grandFinals: acc.grandFinals + t.grandFinals, premierships: acc.premierships + t.premierships,
    }), { games: 0, wins: 0, draws: 0, losses: 0, finals: 0, grandFinals: 0, premierships: 0 });
    expect(career!.totals).toMatchObject(totalsTruth);
    expect(career!.totals.premierships).toBeGreaterThan(0);
  });

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
