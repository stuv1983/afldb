import './guard';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { answerHeadToHead } from '@/db/queries/nl/head-to-head';
import { answerPlayerCareer } from '@/db/queries/nl/player-career';
import { buildNlParseContext } from '@/db/queries/nl/resolve';
import { parseNlQuestion } from '@/search/nl/parser';
import { validatePlan, type NlHeadToHeadKind, type NlQueryPlan } from '@/search/nl/plan';

const FIXTURE_PREFIX = 'issue-094-nl-fixture';

type SemanticFixture = {
  careerOrganization: { id: number; name: string; slug: string };
  clubLeaderId: number;
  wholeCareerLeaderId: number;
  juniorId: number;
  seniorId: number;
};

let fixture: SemanticFixture;

/**
 * Production NL query functions use the shared sql client, so uncommitted rows
 * from a test-local transaction would be invisible to them. Follow the
 * repository's committed-fixture convention instead: uniquely marked rows,
 * atomic setup, and targeted idempotent cleanup before and after the suite.
 */
async function cleanupSemanticFixtures(): Promise<void> {
  const marker = `${FIXTURE_PREFIX}-%`;
  await sql.begin(async (tx) => {
    await tx`
      DELETE FROM player_match_stats
       WHERE player_id IN (SELECT id FROM players WHERE slug LIKE ${marker})
          OR match_id IN (SELECT id FROM matches WHERE match_key LIKE ${marker})
    `;
    await tx`
      DELETE FROM player_clubs
       WHERE player_id IN (SELECT id FROM players WHERE slug LIKE ${marker})
          OR club_id IN (SELECT id FROM clubs WHERE slug LIKE ${marker})
    `;
    await tx`
      DELETE FROM player_career_stats
       WHERE player_id IN (SELECT id FROM players WHERE slug LIKE ${marker})
    `;
    await tx`DELETE FROM matches WHERE match_key LIKE ${marker}`;
    await tx`DELETE FROM players WHERE slug LIKE ${marker}`;
    await tx`DELETE FROM clubs WHERE slug LIKE ${marker}`;
    await tx`DELETE FROM club_organizations WHERE slug LIKE ${marker}`;
  });
}

async function createSemanticFixtures(): Promise<SemanticFixture> {
  return sql.begin(async (tx) => {
    const [careerOrganization] = await tx<{ id: number; name: string; slug: string }[]>`
      INSERT INTO club_organizations (name, slug, is_active, notes)
      VALUES ('ISSUE-094 Lineage Fixture', ${`${FIXTURE_PREFIX}-lineage`}, false,
              'Runtime fixture for nl-semantic-mapping.test.ts')
      RETURNING id, name, slug
    `;
    const [otherOrganization] = await tx<{ id: number }[]>`
      INSERT INTO club_organizations (name, slug, is_active, notes)
      VALUES ('ISSUE-094 Other Fixture', ${`${FIXTURE_PREFIX}-other`}, false,
              'Runtime fixture for nl-semantic-mapping.test.ts')
      RETURNING id
    `;

    // The self-identity FK is intentionally deferrable for atomic identity
    // loads. Both historical identities below belong to one organization;
    // that is the lineage boundary the compiler must aggregate across.
    await tx`SET CONSTRAINTS clubs_current_identity_id_fkey DEFERRED`;
    const [lineageOld] = await tx<{ id: number }[]>`
      INSERT INTO clubs (
        slug, name, short_name, abbreviation, current_identity_id,
        succession, is_current_afl_club, legacy_club_hist, organization_id
      ) VALUES (
        ${`${FIXTURE_PREFIX}-lineage-old`}, 'ISSUE-094 Lineage Old',
        'I094 Old', 'I94O', -1, 'renamed', false,
        ${`${FIXTURE_PREFIX}-lineage-old`}, ${careerOrganization.id}
      ) RETURNING id
    `;
    const [lineageCurrent] = await tx<{ id: number }[]>`
      INSERT INTO clubs (
        slug, name, short_name, abbreviation, current_identity_id,
        succession, is_current_afl_club, legacy_club_hist, organization_id
      ) VALUES (
        ${`${FIXTURE_PREFIX}-lineage-current`}, 'ISSUE-094 Lineage Current',
        'I094 Current', 'I94C', -1, 'current', false,
        ${`${FIXTURE_PREFIX}-lineage-current`}, ${careerOrganization.id}
      ) RETURNING id
    `;
    await tx`
      UPDATE clubs SET current_identity_id = ${lineageCurrent.id}
       WHERE id IN (${lineageOld.id}, ${lineageCurrent.id})
    `;

    const [otherClub] = await tx<{ id: number }[]>`
      INSERT INTO clubs (
        slug, name, short_name, abbreviation, current_identity_id,
        succession, is_current_afl_club, legacy_club_hist, organization_id
      ) VALUES (
        ${`${FIXTURE_PREFIX}-other-club`}, 'ISSUE-094 Other Club',
        'I094 Other', 'I94X', -1, 'current', false,
        ${`${FIXTURE_PREFIX}-other-club`}, ${otherOrganization.id}
      ) RETURNING id
    `;
    await tx`UPDATE clubs SET current_identity_id = ${otherClub.id} WHERE id = ${otherClub.id}`;

    const [season] = await tx<{ year: number }[]>`
      SELECT year FROM seasons ORDER BY year DESC LIMIT 1
    `;
    if (!season) throw new Error('afldb_test needs one baseline season for ISSUE-094 fixtures');

    const matchSpecs = [
      { club: lineageOld.id, opponent: otherClub.id },
      { club: lineageCurrent.id, opponent: otherClub.id },
      { club: otherClub.id, opponent: lineageCurrent.id },
      { club: otherClub.id, opponent: lineageCurrent.id },
    ];
    const matchIds: number[] = [];
    for (const [index, spec] of matchSpecs.entries()) {
      const [match] = await tx<{ id: number }[]>`
        INSERT INTO matches (
          match_key, season, round_code, round_number, round_type, is_final,
          match_date, venue_raw, home_club_id, away_club_id,
          home_score, away_score, result, winner_club_id, margin,
          attendance, attendance_status
        ) VALUES (
          ${`${FIXTURE_PREFIX}-match-${index + 1}`}, ${season.year},
          ${`I094-${index + 1}`}, ${index + 1}, 'home_and_away', false,
          make_date(${season.year}, 1, ${index + 1}), 'ISSUE-094 fixture venue',
          ${spec.club}, ${spec.opponent}, 1, 0, 'home_win', ${spec.club}, 1,
          NULL, 'not_collected'
        ) RETURNING id
      `;
      matchIds.push(match.id);
    }

    const [clubLeader] = await tx<{ id: number }[]>`
      INSERT INTO players (display_name, sort_name, search_name, slug)
      VALUES ('ISSUE-094 Club Leader', 'Club Leader, ISSUE-094',
              afldb_normalise_name('ISSUE-094 Club Leader'),
              ${`${FIXTURE_PREFIX}-club-leader`})
      RETURNING id
    `;
    const [wholeCareerLeader] = await tx<{ id: number }[]>`
      INSERT INTO players (display_name, sort_name, search_name, slug)
      VALUES ('ISSUE-094 Whole Career Leader', 'Whole Career Leader, ISSUE-094',
              afldb_normalise_name('ISSUE-094 Whole Career Leader'),
              ${`${FIXTURE_PREFIX}-whole-career-leader`})
      RETURNING id
    `;
    const [junior] = await tx<{ id: number }[]>`
      INSERT INTO players (display_name, sort_name, search_name, slug)
      VALUES ('Semanticfixture Gary Ablett Jnr', 'Ablett, Semanticfixture Gary Jnr',
              afldb_normalise_name('Semanticfixture Gary Ablett Jnr'),
              ${`${FIXTURE_PREFIX}-gary-ablett-jnr`})
      RETURNING id
    `;
    const [senior] = await tx<{ id: number }[]>`
      INSERT INTO players (display_name, sort_name, search_name, slug)
      VALUES ('Semanticfixture Gary Ablett Snr', 'Ablett, Semanticfixture Gary Snr',
              afldb_normalise_name('Semanticfixture Gary Ablett Snr'),
              ${`${FIXTURE_PREFIX}-gary-ablett-snr`})
      RETURNING id
    `;

    // Whole-career totals deliberately rank B over A (3 > 2), while
    // appearances for the requested lineage rank A over B (2 > 1).
    await tx`
      INSERT INTO player_career_stats (player_id, games, clubs_played, seasons_played)
      VALUES (${clubLeader.id}, 2, 1, 1), (${wholeCareerLeader.id}, 3, 2, 1)
    `;
    await tx`
      INSERT INTO player_match_stats (player_id, match_id, club_id, career_game_no)
      VALUES
        (${clubLeader.id}, ${matchIds[0]}, ${lineageOld.id}, 1),
        (${clubLeader.id}, ${matchIds[1]}, ${lineageCurrent.id}, 2),
        (${wholeCareerLeader.id}, ${matchIds[0]}, ${lineageOld.id}, 1),
        (${wholeCareerLeader.id}, ${matchIds[2]}, ${otherClub.id}, 2),
        (${wholeCareerLeader.id}, ${matchIds[3]}, ${otherClub.id}, 3)
    `;

    return {
      careerOrganization,
      clubLeaderId: clubLeader.id,
      wholeCareerLeaderId: wholeCareerLeader.id,
      juniorId: junior.id,
      seniorId: senior.id,
    };
  });
}

beforeAll(async () => {
  await cleanupSemanticFixtures();
  fixture = await createSemanticFixtures();
});

afterAll(async () => {
  try {
    await cleanupSemanticFixtures();
  } finally {
    await sql.end();
  }
});

async function organizations() {
  const rows = await sql<{ id: number; name: string; slug: string }[]>`
    SELECT id, name, slug FROM club_organizations WHERE lower(name) IN ('richmond', 'carlton')
  `;
  const richmond = rows.find((r) => r.name.toLowerCase() === 'richmond');
  const carlton = rows.find((r) => r.name.toLowerCase() === 'carlton');
  if (!richmond || !carlton) throw new Error('afldb_test needs Richmond and Carlton organizations');
  return { richmond, carlton };
}

function basePlan(overrides: Partial<NlQueryPlan>): NlQueryPlan {
  const raw: NlQueryPlan = {
    v: 1, grain: 'head_to_head', metric: null, agg: { kind: 'count' }, scope: {},
    careerConditions: [], careerPredicates: [], clubSeasonConditions: [],
    tiePolicy: 'all', limit: 25, ...overrides,
  };
  const validated = validatePlan(raw);
  if ('error' in validated) throw new Error(validated.error);
  return validated;
}

describe('head-to-head compiler matches independent PostgreSQL truth', () => {
  it.each(['record', 'compare_wins', 'draw_count', 'last_draw'] as NlHeadToHeadKind[])(
    'returns exact counts and last draw for %s',
    async (kind) => {
      const { richmond, carlton } = await organizations();
      const plan = basePlan({
        headToHead: { kind },
        scope: {
          matchup: {
            clubA: { organizationId: richmond.id, name: richmond.name, slug: richmond.slug },
            clubB: { organizationId: carlton.id, name: carlton.name, slug: carlton.slug },
          },
        },
      });
      const payload = await answerHeadToHead(plan);
      if (payload.kind !== 'head_to_head' || !payload.row) throw new Error('expected a head-to-head row');

      const [truth] = await sql<{
        total: number; richmondWins: number; carltonWins: number; draws: number; lastDrawId: number | null;
      }[]>`
        WITH meetings AS (
          SELECT m.*
            FROM matches m
            JOIN clubs h ON h.id = m.home_club_id
            JOIN clubs a ON a.id = m.away_club_id
           WHERE (h.organization_id = ${richmond.id} AND a.organization_id = ${carlton.id})
              OR (h.organization_id = ${carlton.id} AND a.organization_id = ${richmond.id})
        )
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE winner_club_id IN
                 (SELECT id FROM clubs WHERE organization_id = ${richmond.id}))::int AS "richmondWins",
               count(*) FILTER (WHERE winner_club_id IN
                 (SELECT id FROM clubs WHERE organization_id = ${carlton.id}))::int AS "carltonWins",
               count(*) FILTER (WHERE winner_club_id IS NULL)::int AS draws,
               (SELECT id FROM meetings WHERE winner_club_id IS NULL
                 ORDER BY match_date DESC NULLS LAST, season DESC, id DESC LIMIT 1) AS "lastDrawId"
          FROM meetings
      `;
      expect(payload.row).toMatchObject({
        total: truth.total,
        clubAWins: truth.richmondWins,
        clubBWins: truth.carltonWins,
        draws: truth.draws,
        lastDrawMatchId: truth.lastDrawId,
      });
    },
  );
});

describe('club-scoped career games and suffix identity', () => {
  it('ranks games played for the requested organization lineage rather than whole-career games', async () => {
    const organization = fixture.careerOrganization;
    const plan = basePlan({
      grain: 'player_career', metric: 'games', agg: { kind: 'max' }, headToHead: undefined,
      scope: {
        clubFor: {
          organizationId: organization.id,
          name: organization.name,
          slug: organization.slug,
        },
      },
    });
    const payload = await answerPlayerCareer(plan, 25);
    if (payload.kind !== 'player_career' || !payload.lead) throw new Error('expected a career leader');

    const truth = await sql<{ playerId: number; value: number }[]>`
      SELECT pms.player_id AS "playerId", count(DISTINCT pms.match_id)::int AS value
        FROM player_match_stats pms
        JOIN clubs cl ON cl.id = pms.club_id
       WHERE cl.organization_id = ${organization.id}
       GROUP BY pms.player_id
       ORDER BY value DESC, pms.player_id
    `;
    expect(truth).toEqual([
      { playerId: fixture.clubLeaderId, value: 2 },
      { playerId: fixture.wholeCareerLeaderId, value: 1 },
    ]);
    expect(payload.lead).toMatchObject({ playerId: fixture.clubLeaderId, value: 2 });
    expect(payload.rows.map((r) => ({ playerId: r.playerId, value: r.value })))
      .toEqual([{ playerId: fixture.clubLeaderId, value: 2 }]);

    const wholeCareerTruth = await sql<{ playerId: number; games: number }[]>`
      SELECT player_id AS "playerId", games
        FROM player_career_stats
       WHERE player_id IN (${fixture.clubLeaderId}, ${fixture.wholeCareerLeaderId})
       ORDER BY games DESC, player_id
    `;
    expect(wholeCareerTruth).toEqual([
      { playerId: fixture.wholeCareerLeaderId, games: 3 },
      { playerId: fixture.clubLeaderId, games: 2 },
    ]);
  });

  it('resolves Jr/Jnr/Junior to the exact junior player and keeps senior distinct', async () => {
    expect(fixture.juniorId).not.toBe(fixture.seniorId);
    const ctx = await buildNlParseContext();

    for (const suffix of ['Jr', 'Jnr', 'Junior']) {
      const parsed = await parseNlQuestion(`Semanticfixture Gary Ablett ${suffix} career goals`, ctx);
      expect(parsed.status).toBe('plan');
      if (parsed.status === 'plan') {
        expect(parsed.plan.player?.id).toBe(fixture.juniorId);
        expect(parsed.plan.player?.id).not.toBe(fixture.seniorId);
      }
    }
    for (const suffix of ['Sr', 'Snr', 'Senior']) {
      const parsed = await parseNlQuestion(`Semanticfixture Gary Ablett ${suffix} career goals`, ctx);
      expect(parsed.status).toBe('plan');
      if (parsed.status === 'plan') {
        expect(parsed.plan.player?.id).toBe(fixture.seniorId);
        expect(parsed.plan.player?.id).not.toBe(fixture.juniorId);
      }
    }
  });
});
