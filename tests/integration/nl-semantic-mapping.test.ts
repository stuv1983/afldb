import './guard';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { answerHeadToHead } from '@/db/queries/nl/head-to-head';
import { answerPlayerCareer } from '@/db/queries/nl/player-career';
import { buildNlParseContext } from '@/db/queries/nl/resolve';
import { searchPlayers } from '@/db/queries/search';
import { describeAnswer } from '@/search/nl/describe';
import { parseNlQuestion } from '@/search/nl/parser';
import { describePlan, validatePlan, type NlHeadToHeadKind, type NlQueryPlan } from '@/search/nl/plan';

const FIXTURE_PREFIX = 'issue-094-nl-fixture';

type SemanticFixture = {
  careerOrganization: { id: number; name: string; slug: string };
  clubLeaderId: number;
  wholeCareerLeaderId: number;
  juniorId: number;
  seniorId: number;
  /** Canonical "Semanticfixture Robert Aliasholder", also known by the alias "Semanticfixture Bob Aliasholder". */
  aliasedId: number;
  /** Canonical "Semanticfixture Bruce Plainname", no player_name_aliases rows at all. */
  plainId: number;
};

const ALIASED_CANONICAL = 'Semanticfixture Robert Aliasholder';
const ALIASED_ALIAS = 'Semanticfixture Bob Aliasholder';
const PLAIN_CANONICAL = 'Semanticfixture Bruce Plainname';

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

    // AFLDB-ISSUE-110 generic alias-aware search fixtures. The aliased
    // player carries its own primary name as an alias too (the shape the
    // canonical importers write) plus a genuine alternate-name alias; the
    // plain player has no alias rows. player_name_aliases cascades on
    // player delete, so the existing cleanup covers both.
    const [aliased] = await tx<{ id: number }[]>`
      INSERT INTO players (display_name, sort_name, search_name, slug)
      VALUES (${ALIASED_CANONICAL}, 'Aliasholder, Semanticfixture Robert',
              afldb_normalise_name(${ALIASED_CANONICAL}),
              ${`${FIXTURE_PREFIX}-robert-aliasholder`})
      RETURNING id
    `;
    await tx`
      INSERT INTO player_name_aliases (player_id, alias, search_alias, alias_type)
      VALUES (${aliased.id}, ${ALIASED_CANONICAL}, afldb_normalise_name(${ALIASED_CANONICAL}), 'source_string'),
             (${aliased.id}, ${ALIASED_ALIAS}, afldb_normalise_name(${ALIASED_ALIAS}), 'source_string')
    `;
    const [plain] = await tx<{ id: number }[]>`
      INSERT INTO players (display_name, sort_name, search_name, slug)
      VALUES (${PLAIN_CANONICAL}, 'Plainname, Semanticfixture Bruce',
              afldb_normalise_name(${PLAIN_CANONICAL}),
              ${`${FIXTURE_PREFIX}-bruce-plainname`})
      RETURNING id
    `;

    // Whole-career totals deliberately rank B over A (4 > 3), while
    // appearances for the requested lineage rank A over B (2 > 1).
    // Both players also have whole-career totals different from their
    // lineage totals so the row projection cannot accidentally pass by
    // returning player_career_stats.games.
    await tx`
      INSERT INTO player_career_stats (player_id, games, clubs_played, seasons_played)
      VALUES (${clubLeader.id}, 3, 2, 1), (${wholeCareerLeader.id}, 4, 2, 1)
    `;
    await tx`
      INSERT INTO player_match_stats (player_id, match_id, club_id, career_game_no)
      VALUES
        (${clubLeader.id}, ${matchIds[0]}, ${lineageOld.id}, 1),
        (${clubLeader.id}, ${matchIds[1]}, ${lineageCurrent.id}, 2),
        (${clubLeader.id}, ${matchIds[2]}, ${otherClub.id}, 3),
        (${wholeCareerLeader.id}, ${matchIds[0]}, ${lineageOld.id}, 1),
        (${wholeCareerLeader.id}, ${matchIds[2]}, ${otherClub.id}, 2),
        (${wholeCareerLeader.id}, ${matchIds[3]}, ${otherClub.id}, 3),
        (${wholeCareerLeader.id}, ${matchIds[4]}, ${otherClub.id}, 4)
    `;

    return {
      careerOrganization,
      clubLeaderId: clubLeader.id,
      wholeCareerLeaderId: wholeCareerLeader.id,
      juniorId: junior.id,
      seniorId: senior.id,
      aliasedId: aliased.id,
      plainId: plain.id,
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
    expect(payload.lead).toMatchObject({ playerId: fixture.clubLeaderId, games: 2, value: 2 });
    expect(payload.rows.map((r) => ({ playerId: r.playerId, games: r.games, value: r.value })))
      .toEqual([{ playerId: fixture.clubLeaderId, games: 2, value: 2 }]);
    expect(describeAnswer(plan, payload)).toEqual({
      headline: 'ISSUE-094 Club Leader — 2 games',
      interpretation: `Highest career games for ${organization.name}.`,
    });
    expect(describePlan(plan)).toEqual(expect.arrayContaining([
      'Searched for the highest career games.',
      `Club: ${organization.name}.`,
    ]));

    const wholeCareerTruth = await sql<{ playerId: number; games: number }[]>`
      SELECT player_id AS "playerId", games
        FROM player_career_stats
       WHERE player_id IN (${fixture.clubLeaderId}, ${fixture.wholeCareerLeaderId})
       ORDER BY games DESC, player_id
    `;
    expect(wholeCareerTruth).toEqual([
      { playerId: fixture.wholeCareerLeaderId, games: 4 },
      { playerId: fixture.clubLeaderId, games: 3 },
    ]);
  });

  it.each([
    ['gte', 2, true],
    ['gt', 2, false],
    ['eq', 2, true],
  ] as const)('filters organization-lineage appearances with %s rather than whole-career games', async (op, value, includesClubLeader) => {
    const organization = fixture.careerOrganization;
    const plan = basePlan({
      grain: 'player_career', metric: null, agg: { kind: 'list' }, headToHead: undefined,
      scope: {
        clubFor: {
          organizationId: organization.id,
          name: organization.name,
          slug: organization.slug,
        },
      },
      careerConditions: [{ kind: 'column', column: 'games', op, value }],
    });
    const payload = await answerPlayerCareer(plan, 100);
    if (payload.kind !== 'player_career') throw new Error('expected a career list');

    const truth = await sql<{ playerId: number; value: number }[]>`
      SELECT pms.player_id AS "playerId", count(DISTINCT pms.match_id)::int AS value
        FROM player_match_stats pms
        JOIN clubs cl ON cl.id = pms.club_id
       WHERE cl.organization_id = ${organization.id}
       GROUP BY pms.player_id
       ORDER BY value DESC, pms.player_id
    `;
    const expected = includesClubLeader ? [fixture.clubLeaderId] : [];
    const independentlyFiltered = truth
      .filter((row) => op === 'gte' ? row.value >= value : op === 'gt' ? row.value > value : row.value === value)
      .map((row) => row.playerId);
    expect(independentlyFiltered).toEqual(expected);
    expect(payload.rows.map((row) => row.playerId)).toEqual(expected);
    expect(payload.total).toBe(expected.length);
    if (includesClubLeader) {
      expect(payload.rows).toHaveLength(1);
      expect(payload.rows[0]).toMatchObject({
        playerId: fixture.clubLeaderId,
        games: 2,
        value: null,
      });
      expect(describeAnswer(plan, payload)).toEqual({
        headline: '1 player matches',
        interpretation: `Players matching every condition for ${organization.name}.`,
      });
      expect(describePlan(plan)).toEqual(expect.arrayContaining([
        `Club: ${organization.name}.`,
        `Condition: games for ${organization.name} ${op === 'gte' ? 'at least' : 'exactly'} 2.`,
      ]));
    }

    // The whole-career leader has four total games and would incorrectly
    // satisfy `gt 2`; its one appearance for this lineage must not.
    if (op === 'gt') expect(payload.rows.map((row) => row.playerId)).not.toContain(fixture.wholeCareerLeaderId);
  });

  it('orders and projects a club-scoped list by lineage appearances', async () => {
    const organization = fixture.careerOrganization;
    const plan = basePlan({
      grain: 'player_career', metric: null, agg: { kind: 'list' }, headToHead: undefined,
      scope: {
        clubFor: {
          organizationId: organization.id,
          name: organization.name,
          slug: organization.slug,
        },
      },
      careerConditions: [{ kind: 'column', column: 'games', op: 'gte', value: 1 }],
    });
    const payload = await answerPlayerCareer(plan, 100);
    if (payload.kind !== 'player_career') throw new Error('expected a career list');

    expect(payload.rows.map((row) => ({ playerId: row.playerId, games: row.games }))).toEqual([
      { playerId: fixture.clubLeaderId, games: 2 },
      { playerId: fixture.wholeCareerLeaderId, games: 1 },
    ]);
  });

  it('preserves whole-career games projection when no club scope is present', async () => {
    const plan = basePlan({
      grain: 'player_career', metric: 'games', agg: { kind: 'max' }, headToHead: undefined,
      player: {
        id: fixture.wholeCareerLeaderId,
        name: 'ISSUE-094 Whole Career Leader',
        slug: `${FIXTURE_PREFIX}-whole-career-leader`,
      },
      scope: {},
    });
    const payload = await answerPlayerCareer(plan, 25);
    if (payload.kind !== 'player_career' || !payload.lead) throw new Error('expected a career leader');

    expect(payload.lead).toMatchObject({
      playerId: fixture.wholeCareerLeaderId,
      games: 4,
      value: 4,
    });
    expect(describeAnswer(plan, payload)).toEqual({
      headline: 'ISSUE-094 Whole Career Leader — 4 games',
      interpretation: 'Highest career games.',
    });
    expect(describePlan(plan)).not.toContain(expect.stringMatching(/^Club:/));
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

describe('AFLDB-ISSUE-110 two-club wins/losses-against routes to the typed record answer', () => {
  it.each(['richmond wins against carlton', 'richmond losses against carlton'])(
    '%s parses to head_to_head/record and answers with the existing record payload',
    async (question) => {
      const { richmond, carlton } = await organizations();
      const ctx = await buildNlParseContext();
      const parsed = await parseNlQuestion(question, ctx);
      expect(parsed.status, JSON.stringify(parsed.status === 'plan' ? {} : parsed.report)).toBe('plan');
      if (parsed.status !== 'plan') return;
      expect(parsed.plan.grain).toBe('head_to_head');
      expect(parsed.plan.headToHead).toEqual({ kind: 'record' });

      const validated = validatePlan(parsed.plan);
      if ('error' in validated) throw new Error(validated.error);
      const payload = await answerHeadToHead(validated);
      if (payload.kind !== 'head_to_head' || !payload.row) throw new Error('expected a head-to-head row');

      const [truth] = await sql<{ total: number; richmondWins: number; carltonWins: number; draws: number }[]>`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE m.winner_club_id IN
                 (SELECT id FROM clubs WHERE organization_id = ${richmond.id}))::int AS "richmondWins",
               count(*) FILTER (WHERE m.winner_club_id IN
                 (SELECT id FROM clubs WHERE organization_id = ${carlton.id}))::int AS "carltonWins",
               count(*) FILTER (WHERE m.winner_club_id IS NULL)::int AS draws
          FROM matches m
          JOIN clubs h ON h.id = m.home_club_id
          JOIN clubs a ON a.id = m.away_club_id
         WHERE (h.organization_id = ${richmond.id} AND a.organization_id = ${carlton.id})
            OR (h.organization_id = ${carlton.id} AND a.organization_id = ${richmond.id})
      `;
      expect(payload.row).toMatchObject({
        total: truth.total,
        clubAWins: truth.richmondWins,
        clubBWins: truth.carltonWins,
        draws: truth.draws,
      });
      // The existing record description is used unchanged.
      const { headline, interpretation } = describeAnswer(validated, payload);
      expect(headline).toContain(payload.row.clubAName);
      expect(headline).toContain(payload.row.clubBName);
      expect(interpretation).toContain('draws');
    },
  );
});

describe('AFLDB-ISSUE-110 Bulldogs organization alias', () => {
  it('bulldogs, dogs, footscray and western bulldogs are one directory entry', async () => {
    const ctx = await buildNlParseContext();
    const holders = ctx.clubs.filter((club) => club.names.includes('bulldogs'));
    expect(holders).toHaveLength(1);
    for (const name of ['dogs', 'footscray', 'western bulldogs']) {
      expect(holders[0].names, name).toContain(name);
    }
  });

  it('an ordinary organization-backed answer works through the bare alias', async () => {
    const ctx = await buildNlParseContext();
    const parsed = await parseNlQuestion('most career games for the bulldogs', ctx);
    expect(parsed.status, parsed.status === 'plan' ? '' : JSON.stringify(parsed.report)).toBe('plan');
    if (parsed.status !== 'plan') return;
    const holder = ctx.clubs.find((club) => club.names.includes('bulldogs'))!;
    expect(parsed.plan.grain).toBe('player_career');
    expect(parsed.plan.scope.clubFor?.organizationId).toBe(holder.organizationId);

    const validated = validatePlan(parsed.plan);
    if ('error' in validated) throw new Error(validated.error);
    const payload = await answerPlayerCareer(validated, 25);
    if (payload.kind !== 'player_career') throw new Error('expected a career payload');
    expect(payload.lead).not.toBeNull();
  });

  it('a same-organization head-to-head through aliases refuses honestly', async () => {
    const ctx = await buildNlParseContext();
    const parsed = await parseNlQuestion('bulldogs record against footscray', ctx);
    if (parsed.status === 'plan') {
      expect(validatePlan(parsed.plan)).toEqual({ error: 'A matchup needs two different clubs.' });
    } else {
      expect(parsed.status).toBe('none');
    }
  });

  it('a draw question resolves the alias into the typed matchup', async () => {
    const ctx = await buildNlParseContext();
    const parsed = await parseNlQuestion('how many draws between the bulldogs and richmond', ctx);
    expect(parsed.status).toBe('plan');
    if (parsed.status !== 'plan') return;
    const holder = ctx.clubs.find((club) => club.names.includes('bulldogs'))!;
    expect(parsed.plan.grain).toBe('head_to_head');
    expect(parsed.plan.headToHead).toEqual({ kind: 'draw_count' });
    const matchupIds = [
      parsed.plan.scope.matchup?.clubA.organizationId,
      parsed.plan.scope.matchup?.clubB.organizationId,
    ];
    expect(matchupIds).toContain(holder.organizationId);
  });
});

describe('AFLDB-ISSUE-110 alias-aware player search', () => {
  it('matches an exact alias, keeps the canonical title, and exposes the alias as matchedName', async () => {
    const results = await searchPlayers(ALIASED_ALIAS, 5);
    expect(results[0]).toMatchObject({
      type: 'player',
      id: fixture.aliasedId,
      title: ALIASED_CANONICAL,
      matchedName: ALIASED_ALIAS,
    });
    expect(results[0].rank).toBeGreaterThanOrEqual(1000);
    expect(results.filter((r) => r.id === fixture.aliasedId)).toHaveLength(1);
  });

  it('returns a player once when the primary name and its primary-name alias both match, preferring the primary form', async () => {
    const results = await searchPlayers(ALIASED_CANONICAL, 5);
    expect(results.filter((r) => r.id === fixture.aliasedId)).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: fixture.aliasedId,
      title: ALIASED_CANONICAL,
      matchedName: ALIASED_CANONICAL,
    });
    expect(results[0].rank).toBeGreaterThanOrEqual(1000);
  });

  it('keeps exact canonical-name ranking for a player with no aliases', async () => {
    const results = await searchPlayers(PLAIN_CANONICAL, 5);
    expect(results[0]).toMatchObject({
      id: fixture.plainId,
      title: PLAIN_CANONICAL,
      matchedName: PLAIN_CANONICAL,
    });
    expect(results[0].rank).toBeGreaterThanOrEqual(1000);
    expect(results.filter((r) => r.id === fixture.plainId)).toHaveLength(1);
  });

  it('resolves an alternate alias through the database-backed NL path to the canonical player', async () => {
    const ctx = await buildNlParseContext();
    const parsed = await parseNlQuestion(`${ALIASED_ALIAS} career goals`, ctx);
    expect(parsed.status, JSON.stringify(parsed.report)).toBe('plan');
    if (parsed.status === 'plan') {
      expect(parsed.plan.player).toMatchObject({ id: fixture.aliasedId, name: ALIASED_CANONICAL });
      expect(parsed.report.unsupportedTerms).toHaveLength(0);
    }
  });

  it('still declines an unrelated leftover token beside a valid alias match', async () => {
    const ctx = await buildNlParseContext();
    const parsed = await parseNlQuestion(`${ALIASED_ALIAS} banana career goals`, ctx);
    expect(parsed.status).not.toBe('plan');
  });
});
