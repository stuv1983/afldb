import { describe, expect, it } from 'vitest';

import { parseNlQuestion, type NlParseContext, type NlPlayerCandidate } from '@/search/nl/parser';
import type { NlClubDirectoryEntry } from '@/search/nl/entities';
import { validatePlan } from '@/search/nl/plan';

const clubs: NlClubDirectoryEntry[] = [
  { organizationId: 1, slug: 'richmond', name: 'Richmond', names: ['richmond'] },
  { organizationId: 2, slug: 'carlton', name: 'Carlton', names: ['carlton'] },
  { organizationId: 3, slug: 'geelong', name: 'Geelong', names: ['geelong'] },
  { organizationId: 4, slug: 'collingwood', name: 'Collingwood', names: ['collingwood'] },
  { organizationId: 5, slug: 'north-melbourne', name: 'North Melbourne', names: ['north melbourne', 'kangaroos'] },
  // The shape buildClubDirectory produces for the real organization once
  // CLUB_NICKNAMES carries bare "bulldogs": one lineage, four names.
  { organizationId: 6, slug: 'western-bulldogs', name: 'Western Bulldogs', names: ['western bulldogs', 'bulldogs', 'dogs', 'footscray'] },
];

// Production shape (AFLDB-ISSUE-110): generational players share an
// IDENTICAL canonical display name; the Jnr/Snr distinction exists only as
// a player_name_aliases row, which searchPlayers surfaces as matchedName.
// The canonical ref never carries the suffix.
const junior = { id: 101, slug: 'gary-ablett-101', name: 'Gary Ablett' };
const senior = { id: 102, slug: 'gary-ablett-102', name: 'Gary Ablett' };
// Generic alias fixture: canonical "Tom Fixture", known by the alternate
// spelling "Thomas Fixture" and the generational alias "Tom Fixture Jnr";
// "Tom Fixture" (103) shares the canonical name with no alias of its own.
const tomAliased = { id: 201, slug: 'tom-fixture-201', name: 'Tom Fixture' };
const tomPlain = { id: 202, slug: 'tom-fixture-202', name: 'Tom Fixture' };

const players: Record<string, NlPlayerCandidate[]> = {
  'dustin martin': [{ ref: { id: 100, slug: 'dustin-martin', name: 'Dustin Martin' }, score: 1000 }],
  'gary ablett jnr': [
    { ref: junior, score: 1000, matchedName: 'Gary Ablett Jnr' },
    { ref: senior, score: 90, matchedName: 'Gary Ablett' },
  ],
  'gary ablett snr': [
    { ref: senior, score: 1000, matchedName: 'Gary Ablett Snr' },
    { ref: junior, score: 90, matchedName: 'Gary Ablett' },
  ],
  'gary ablett': [
    { ref: junior, score: 1000, matchedName: 'Gary Ablett' },
    { ref: senior, score: 990, matchedName: 'Gary Ablett' },
  ],
  ablett: [
    { ref: junior, score: 400, matchedName: 'Gary Ablett' },
    { ref: senior, score: 390, matchedName: 'Gary Ablett' },
  ],
  'thomas fixture': [{ ref: tomAliased, score: 1000, matchedName: 'Thomas Fixture' }],
  'thomas fixture banana': [{ ref: tomAliased, score: 700, matchedName: 'Thomas Fixture' }],
  'tom fixture jnr': [
    { ref: tomAliased, score: 1000, matchedName: 'Tom Fixture Jnr' },
    { ref: tomPlain, score: 90, matchedName: 'Tom Fixture' },
  ],
  'tom fixture': [
    { ref: tomAliased, score: 1000, matchedName: 'Tom Fixture' },
    { ref: tomPlain, score: 990, matchedName: 'Tom Fixture' },
  ],
};

const ctx: NlParseContext = {
  clubs,
  venues: [{ id: 30, slug: 'mcg', name: 'MCG', names: ['mcg', 'melbourne cricket ground'] }],
  resolvePlayer: async (name) => players[name] ?? [],
};

async function plan(question: string) {
  const parsed = await parseNlQuestion(question, ctx);
  expect(parsed.status, `${question}: ${JSON.stringify(parsed.report)}`).toBe('plan');
  return (parsed as Extract<typeof parsed, { status: 'plan' }>).plan;
}

describe('AFLDB-ISSUE-094 semantic mappings', () => {
  it.each([
    ['at most', 'lte'],
    ['no more than', 'lte'],
    ['at least', 'gte'],
    ['no fewer than', 'gte'],
    ['more than', 'gt'],
    ['less than', 'lt'],
    ['fewer than', 'lt'],
    ['exactly', 'eq'],
  ] as const)('atomically maps grouped %s', async (words, op) => {
    const p = await plan(`teams with ${words} 2 wins against Richmond`);
    expect(p.grain).toBe('team_match');
    expect(p.metric).toBeNull();
    expect(p.agg).toEqual({ kind: 'list' });
    expect(p.havingClause).toEqual({ metric: 'wins', op, value: 2 });
    expect(p.scope.clubAgainst?.slug).toBe('richmond');
  });

  it.each(['wins', 'losses', 'draws'] as const)('applies upper bounds to grouped %s', async (metric) => {
    const p = await plan(`teams with at most 2 ${metric} against Richmond`);
    expect(p.havingClause).toEqual({ metric, op: 'lte', value: 2 });
  });

  it.each([
    ['Richmond v Carlton head to head', 'record'],
    ['Richmond record against Carlton', 'record'],
    ['Richmond and Carlton head to head record', 'record'],
    ['what is the head to head between Richmond and Carlton', 'record'],
    ['who has won more Richmond or Carlton', 'compare_wins'],
    ["who's won more Richmond or Carlton", 'compare_wins'],
  ] as const)('maps %s to typed head-to-head %s', async (question, kind) => {
    const p = await plan(question);
    expect(p.grain).toBe('head_to_head');
    expect(p.metric).toBeNull();
    expect(p.agg).toEqual({ kind: 'count' });
    expect(p.headToHead).toEqual({ kind });
    expect(p.scope.matchup?.clubA.slug).toBe('richmond');
    expect(p.scope.matchup?.clubB.slug).toBe('carlton');
    expect(validatePlan(p)).not.toHaveProperty('error');
  });

  it.each([
    ['how many draws between Richmond and Carlton', 'draw_count'],
    ['Richmond draws against Carlton', 'draw_count'],
    ['how many times have Richmond and Carlton drawn', 'draw_count'],
    ['how many drawn games between Richmond and Carlton', 'draw_count'],
    ['last draw between Richmond and Carlton', 'last_draw'],
    ['most recent draw between Richmond and Carlton', 'last_draw'],
    ['when was the last draw between Richmond and Carlton', 'last_draw'],
  ] as const)('maps %s to typed draw semantics', async (question, kind) => {
    const p = await plan(question);
    expect(p.grain).toBe('head_to_head');
    expect(p.headToHead).toEqual({ kind });
    expect(p.scope.matchup).toBeDefined();
  });

  it.each([
    'Richmond career leader for games',
    'most career games for Richmond',
    'who has played the most games for Richmond',
  ])('routes club-specific career games explicitly: %s', async (question) => {
    const p = await plan(question);
    expect(p.grain).toBe('player_career');
    expect(p.metric).toBe('games');
    expect(p.scope.clubFor?.slug).toBe('richmond');
  });

  it.each([
    ['most games for Geelong', 3, 'geelong'],
    ['most games for Collingwood', 4, 'collingwood'],
    ['most games for Richmond', 1, 'richmond'],
  ] as const)('routes club-career games shorthand: %s', async (question, organizationId, slug) => {
    const shorthand = await plan(question);
    expect(shorthand).toMatchObject({
      grain: 'player_career',
      metric: 'games',
      agg: { kind: 'max' },
      scope: { clubFor: { organizationId, slug } },
    });
    expect(validatePlan(shorthand)).not.toHaveProperty('error');
  });

  it('does not let club-career games shorthand steal match or season grain', async () => {
    const match = await plan('most games in a match for Geelong');
    expect(match).toMatchObject({ grain: 'player_game', metric: 'games', mode: 'single' });
    expect(validatePlan(match)).toEqual({ error: '"games" is not a recognised statistic for this kind of question.' });

    const season = await plan('most games in a season for Geelong');
    expect(season).toMatchObject({ grain: 'player_season', metric: 'games' });
    expect(validatePlan(season)).not.toHaveProperty('error');
  });

  it.each([
    ['at least', 'gte'],
    ['more than', 'gt'],
    ['exactly', 'eq'],
  ] as const)('keeps club-scoped career-game %s thresholds typed and valid', async (words, op) => {
    const p = await plan(`players with ${words} 200 games for Collingwood`);
    expect(p).toMatchObject({
      grain: 'player_career',
      metric: null,
      agg: { kind: 'list' },
      scope: { clubFor: { organizationId: 4, slug: 'collingwood' } },
      careerConditions: [{ kind: 'column', column: 'games', op, value: 200 }],
    });
    expect(validatePlan(p)).not.toHaveProperty('error');
  });

  it('refuses club-scoped unranked conditions whose scope is not fully typed', async () => {
    const p = await plan('players with at least 200 games and no premierships for Collingwood');
    expect(p.careerConditions).toHaveLength(2);
    expect(p.careerConditions).toEqual(expect.arrayContaining([
      { kind: 'column', column: 'games', op: 'gte', value: 200 },
      { kind: 'column', column: 'premierships', op: 'eq', value: 0 },
    ]));
    expect(validatePlan(p)).toEqual({ error: 'This career statistic cannot currently be totalled for one club.' });
  });

  it.each([
    ['Gary Ablett Jr career goals', 101],
    ['Gary Ablett Jnr career goals', 101],
    ['Gary Ablett Junior career goals', 101],
    ['Gary Ablett Snr career goals', 102],
    ['Gary Ablett Senior career goals', 102],
  ] as const)('preserves player identity while normalizing suffixes: %s', async (question, playerId) => {
    const p = await plan(question);
    expect(p.player?.id).toBe(playerId);
    // The plan carries the CANONICAL identity; the suffix lived only in
    // the matched alias and must not leak into the player ref.
    expect(p.player?.name).toBe('Gary Ablett');
    expect(p.grain).toBe('player_career');
  });

  describe('AFLDB-ISSUE-110 matched-identity evidence', () => {
    it('justifies an alternate-spelling alias token through matchedName while keeping the canonical ref', async () => {
      const parsed = await parseNlQuestion('Thomas Fixture career goals', ctx);
      expect(parsed.status, JSON.stringify(parsed.report)).toBe('plan');
      if (parsed.status !== 'plan') return;
      // "thomas" is not a prefix of any canonical-name word ("tom"), so
      // only the matched alias can justify it -- and the ref stays canonical.
      expect(parsed.plan.player).toEqual(tomAliased);
      // playerId/matchedName are the ISSUE-110 telemetry-only enrichment:
      // stable identity plus the exact alias form that justified it.
      expect(parsed.report.entityResolution).toContainEqual({
        mention: 'thomas fixture', resolvedTo: 'Tom Fixture', certainty: 1,
        playerId: 201, matchedName: 'Thomas Fixture',
      });
      expect(parsed.report.unsupportedTerms ?? []).toHaveLength(0);
    });

    it('justifies a generational suffix only through the matched alias and picks the aliased player', async () => {
      const p = await plan('Tom Fixture Jnr career goals');
      expect(p.player).toEqual(tomAliased);
      expect(p.player?.name).not.toContain('Jnr');
    });

    it('keeps two players with the same canonical name ambiguous without a distinguishing alias', async () => {
      const parsed = await parseNlQuestion('Tom Fixture career goals', ctx);
      expect(parsed.status).toBe('none');
      if (parsed.status === 'none') expect(parsed.reason).toBe('ambiguous');
    });

    it('still declines unrelated leftover tokens next to a valid alias match', async () => {
      const parsed = await parseNlQuestion('Thomas Fixture banana career goals', ctx);
      expect(parsed.status).not.toBe('plan');
    });
  });

  it('keeps an unsuffixed full player name safely ambiguous', async () => {
    const parsed = await parseNlQuestion('Gary Ablett career games', ctx);
    expect(parsed.status).toBe('none');
    if (parsed.status === 'none') {
      expect(parsed.reason).toBe('ambiguous');
      expect(parsed.report.confidence).toBeCloseTo(0.7);
    }
  });

  it('keeps surname-candidate ranking behavior', async () => {
    const p = await plan('Ablett most goals');
    expect(p.scope.playerIdIn).toEqual([101, 102]);
    expect(p.player).toBeUndefined();
  });

  it.each([
    'most rebound 50s in 2024',
    'most R50s in 2024',
    'Richmond rebound 50 record',
  ])('declines unsupported rebound-50 data explicitly: %s', async (question) => {
    const parsed = await parseNlQuestion(question, ctx);
    expect(parsed.status).toBe('unanswerable');
    if (parsed.status === 'unanswerable') {
      expect(parsed.topic).toBe('rebound 50s');
      expect(parsed.reason).toContain('not tracked');
    }
  });

  it('does not let club-between language steal a season range', async () => {
    const p = await plan('most goals between 2000 and 2009');
    expect(p.grain).toBe('player_season');
    expect(p.scope.seasonMin).toBe(2000);
    expect(p.scope.seasonMax).toBe(2009);
    expect(p.headToHead).toBeUndefined();
  });

  it('rejects an incomplete or polluted head-to-head plan', async () => {
    const clean = await plan('Richmond v Carlton head to head');
    expect(validatePlan({ ...clean, scope: {} })).toEqual({ error: 'A head-to-head question needs exactly two clubs.' });
    expect(validatePlan({ ...clean, player: { id: 100, slug: 'dustin-martin', name: 'Dustin Martin' } }))
      .toEqual({ error: 'A head-to-head question contains fields its compiler cannot honour.' });
  });

  it.each([
    ['most goals', 'player_career'],
    ['Richmond longest winning streak', 'team_streak'],
    ['Dustin Martin career goals', 'player_career'],
    ['Dustin Martin most goals against Carlton', 'player_game'],
  ] as const)('preserves clean control %s', async (question, grain) => {
    expect((await plan(question)).grain).toBe(grain);
  });

  it('still declines meaningful nonsense', async () => {
    const parsed = await parseNlQuestion('Richmond banana head statistics', ctx);
    expect(parsed.status).not.toBe('plan');
  });

  describe('AFLDB-ISSUE-110 A: explicit zero vs "no <comparative> than"', () => {
    it.each([
      ['players with no more than 4 goals in a game', 'lte', 4],
      ['players with no fewer than 12 goals in a game', 'gte', 12],
      ['players with no less than 12 goals in a game', 'gte', 12],
      ['players with no greater than 4 goals in a game', 'lte', 4],
      ['players with no more than four goals in a game', 'lte', 4],
    ] as const)('%s reaches the comparator, never eq/0', async (question, op, value) => {
      const p = await plan(question);
      expect(p).toMatchObject({
        grain: 'player_game', mode: 'single', metric: 'goals',
        agg: { kind: 'list' },
        metricCondition: { op, value },
        careerConditions: [],
      });
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it.each([
      'players with no goals',
      'players who never kicked a goal',
      'players without a goal',
    ])('preserves the genuine zero condition: %s', async (question) => {
      const p = await plan(question);
      expect(p.grain).toBe('player_career');
      expect(p.careerConditions).toEqual([{ kind: 'column', column: 'goals', op: 'eq', value: 0 }]);
      expect(p.metricCondition).toBeUndefined();
    });

    it('fails a mixed game/career condition closed instead of silently dropping "in a game"', async () => {
      const p = await plan('players with no more than 4 goals in a game and no premierships');
      // The premiership zero condition cannot ride a player_game plan and
      // a game-cued goals threshold cannot ride a career plan. No plan can
      // represent the whole question, so it must NOT validate: a plan that
      // kept both conditions at career grain would silently discard the
      // explicit "in a game" and answer career goals instead.
      expect(p.grain).toBe('player_career');
      expect(p.careerConditions).toEqual([
        { kind: 'column', column: 'premierships', op: 'eq', value: 0 },
      ]);
      expect(p.metricCondition).toEqual({ op: 'lte', value: 4 });
      expect(validatePlan(p)).toHaveProperty('error');
    });
  });

  describe('AFLDB-ISSUE-110 B: typed player game/season metric thresholds', () => {
    it('routes an exact named year to a season threshold', async () => {
      const p = await plan('players with more than 2 goals in 1989');
      expect(p).toMatchObject({
        grain: 'player_season', metric: 'goals',
        agg: { kind: 'list' },
        scope: { seasonMin: 1989, seasonMax: 1989 },
        metricCondition: { op: 'gt', value: 2 },
        careerConditions: [],
      });
      expect(p.mode).toBeUndefined();
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('routes an explicit single-game cue to a per-performance threshold', async () => {
      const p = await plan('players with fewer than 3 goals in a game');
      expect(p).toMatchObject({
        grain: 'player_game', mode: 'single', metric: 'goals',
        agg: { kind: 'list' },
        metricCondition: { op: 'lt', value: 3 },
        careerConditions: [],
      });
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('consumes "at most" atomically for a scoped total instead of stranding "most"', async () => {
      const p = await plan('players with at most 25 disposals against North Melbourne');
      expect(p).toMatchObject({
        grain: 'player_game', mode: 'sum', metric: 'disposals',
        agg: { kind: 'list' },
        scope: { clubAgainst: { organizationId: 5 } },
        metricCondition: { op: 'lte', value: 25 },
      });
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it.each([
      ['at most', 'lte'],
      ['at least', 'gte'],
      ['fewer than', 'lt'],
      ['less than', 'lt'],
      ['more than', 'gt'],
      ['exactly', 'eq'],
      ['no more than', 'lte'],
      ['no fewer than', 'gte'],
      ['no less than', 'gte'],
      ['no greater than', 'lte'],
    ] as const)('carries %s on a non-career stat end to end in the plan', async (words, op) => {
      const p = await plan(`players with ${words} 20 tackles in a game`);
      expect(p).toMatchObject({
        grain: 'player_game', mode: 'single', metric: 'tackles',
        metricCondition: { op, value: 20 },
      });
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('keeps genuine career thresholds on the career-condition path', async () => {
      const p = await plan('players with more than 500 career goals');
      expect(p).toMatchObject({
        grain: 'player_career', metric: null,
        agg: { kind: 'list' },
        careerConditions: [{ kind: 'column', column: 'goals', op: 'gt', value: 500 }],
      });
      expect(p.metricCondition).toBeUndefined();
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('converts a career-column stat threshold with a career cue into a career condition', async () => {
      const p = await plan('players with more than 400 career disposals');
      expect(p).toMatchObject({
        grain: 'player_career', metric: null,
        careerConditions: [{ kind: 'column', column: 'disposals', op: 'gt', value: 400 }],
      });
      expect(p.metricCondition).toBeUndefined();
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('fails closed when no compiler can represent the parsed threshold', async () => {
      // clangers has no career column and no career/game/season cue routes
      // it elsewhere: the threshold must not silently disappear, so the
      // plan carries it and validation refuses honestly.
      const p = await plan('players with more than 30 clangers');
      expect(p.metricCondition).toEqual({ op: 'gt', value: 30 });
      expect(validatePlan(p)).toEqual({ error: 'This statistic cannot currently be filtered by that threshold.' });
    });

    it('preserves unthresholded leader questions', async () => {
      const single = await plan('most disposals in a game');
      expect(single).toMatchObject({ grain: 'player_game', mode: 'single', metric: 'disposals', agg: { kind: 'max' } });
      expect(single.metricCondition).toBeUndefined();

      const season = await plan('most goals in 1989');
      expect(season).toMatchObject({ grain: 'player_season', metric: 'goals', agg: { kind: 'max' } });
      expect(season.metricCondition).toBeUndefined();
    });

    it('keeps the club-scoped career-games threshold contract untouched', async () => {
      const p = await plan('players with at least 200 games for Collingwood');
      expect(p).toMatchObject({
        grain: 'player_career', metric: null,
        scope: { clubFor: { organizationId: 4 } },
        careerConditions: [{ kind: 'column', column: 'games', op: 'gte', value: 200 }],
      });
      expect(p.metricCondition).toBeUndefined();
      expect(validatePlan(p)).not.toHaveProperty('error');
    });
  });

  describe('AFLDB-ISSUE-110 revision: explicit scope never disappears from a career-vocabulary threshold', () => {
    it('routes an opponent-scoped goals threshold to the scoped sum, never a whole-career plan', async () => {
      // The HIGH review finding: this used to stay player_career with
      // careerConditions goals > 2 and scope.clubAgainst that the career
      // compiler never consumes -- a whole-career answer that silently
      // ignored "against Carlton".
      const p = await plan('players with more than 2 goals against Carlton');
      expect(p).toMatchObject({
        grain: 'player_game', mode: 'sum', metric: 'goals',
        agg: { kind: 'list' },
        scope: { clubAgainst: { organizationId: 2, slug: 'carlton' } },
        metricCondition: { op: 'gt', value: 2 },
        careerConditions: [],
      });
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('routes a venue-scoped goals threshold to the scoped sum', async () => {
      const p = await plan('players with at least 50 goals at the MCG');
      expect(p).toMatchObject({
        grain: 'player_game', mode: 'sum', metric: 'goals',
        agg: { kind: 'list' },
        scope: { venue: { id: 30 } },
        metricCondition: { op: 'gte', value: 50 },
        careerConditions: [],
      });
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('routes a match-type-scoped goals threshold to per-performance rows of that type', async () => {
      const p = await plan('players with more than 3 goals in a grand final');
      expect(p).toMatchObject({
        grain: 'player_game', mode: 'single', metric: 'goals',
        agg: { kind: 'list' },
        scope: { matchType: 'grand_final' },
        metricCondition: { op: 'gt', value: 3 },
        careerConditions: [],
      });
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('keeps season + opponent scope together on the scoped sum', async () => {
      const p = await plan('players with more than 10 goals against Carlton since 2000');
      expect(p).toMatchObject({
        grain: 'player_game', mode: 'sum', metric: 'goals',
        scope: { clubAgainst: { organizationId: 2 }, seasonMin: 2000 },
        metricCondition: { op: 'gt', value: 10 },
      });
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('fails a games threshold with opponent scope closed instead of answering whole-career games', async () => {
      // games is not a per-match statistic, so no game/season grain can
      // represent "games against Carlton" -- the plan must refuse rather
      // than count whole-career games and drop the opponent.
      const p = await plan('players with more than 100 games against Carlton');
      expect(p.grain).toBe('player_career');
      expect(validatePlan(p)).toEqual({
        error: 'A career question cannot be scoped to a venue, opponent, match type, or round.',
      });
    });

    it('fails a season range beside an explicit career-cue threshold closed', async () => {
      const p = await plan('players with more than 500 career goals since 2000');
      expect(p.grain).toBe('player_career');
      expect(validatePlan(p)).toEqual({
        error: 'A career question cannot be restricted to a season range.',
      });
    });
  });

  describe('AFLDB-ISSUE-110 independent review: ranked career season scope fails closed', () => {
    const SEASON_ERROR = 'A career question cannot be restricted to a season range.';

    it.each([
      ['most career goals since 2000', { seasonMin: 2000 }],
      ['most career goals in 2000', { seasonMin: 2000, seasonMax: 2000 }],
    ] as const)('retains the requested period but refuses unrestricted career SQL: %s', async (question, scope) => {
      const p = await plan(question);
      expect(p).toMatchObject({
        grain: 'player_career', metric: 'goals', agg: { kind: 'max' },
        scope, careerConditions: [],
      });
      expect(p.metricCondition).toBeUndefined();
      expect(validatePlan(p)).toEqual({ error: SEASON_ERROR });
    });

    it('keeps the ordinary all-time career ranking valid', async () => {
      const p = await plan('most career goals');
      expect(p).toMatchObject({
        grain: 'player_career', metric: 'goals', agg: { kind: 'max' }, scope: {},
      });
      expect(validatePlan(p)).not.toHaveProperty('error');
    });
  });

  describe('AFLDB-ISSUE-110 final review: player_season never silently discards match-level scope', () => {
    // Explicit "in a season" wording elects player_season before match
    // scope is accounted for, and answerPlayerSeason consumes no
    // opponent/venue/match-type/round -- each of these used to validate
    // and answer the whole-season question with the scope discarded.
    const SEASON_SCOPE_ERROR = 'A season total cannot be scoped to a venue, opponent, match type, or round.';

    it.each([
      ['players with more than 20 disposals in a season against Carlton', 'clubAgainst'],
      ['players with more than 20 disposals in a season at the MCG', 'venue'],
      ['players with more than 20 disposals in a season in grand finals', 'matchType'],
      ['players with more than 20 disposals in a season in round 5', 'roundNumber'],
    ] as const)('refuses "%s" instead of answering whole-season disposals', async (question, scopeKey) => {
      const p = await plan(question);
      expect(p.grain).toBe('player_season');
      // The scope genuinely survived parsing -- this is not a decline for
      // want of understanding the phrase, it is the backstop refusing a
      // plan whose executor would ignore the scope.
      expect(p.scope[scopeKey]).toBeDefined();
      expect(validatePlan(p)).toEqual({ error: SEASON_SCOPE_ERROR });
    });

    it('keeps legitimate season thresholds and club-scoped season leaderboards valid', async () => {
      const threshold = await plan('players with more than 20 disposals in a season');
      expect(threshold).toMatchObject({
        grain: 'player_season', metric: 'disposals', agg: { kind: 'list' },
        metricCondition: { op: 'gt', value: 20 },
      });
      expect(validatePlan(threshold)).not.toHaveProperty('error');

      const year = await plan('players with more than 2 goals in 1989');
      expect(year).toMatchObject({
        grain: 'player_season',
        scope: { seasonMin: 1989, seasonMax: 1989 },
        metricCondition: { op: 'gt', value: 2 },
      });
      expect(validatePlan(year)).not.toHaveProperty('error');

      const clubFor = await plan('most goals for Richmond in 2017');
      expect(clubFor.grain).toBe('player_season');
      expect(clubFor.scope.clubFor?.slug).toBe('richmond');
      expect(validatePlan(clubFor)).not.toHaveProperty('error');
    });
  });

  describe('AFLDB-ISSUE-110 blocker: generic season ownership', () => {
    it.each([
      ['players with more than 50 goals in a season', 'gt'],
      ['players who kicked more than 50 goals in a season', 'gt'],
      ['players with at least 50 goals in a season', 'gte'],
      ['players with exactly 50 goals in a season', 'eq'],
      ['players with fewer than 50 goals in a season', 'lt'],
      ['players with no more than 50 goals in a season', 'lte'],
    ] as const)('keeps the season threshold in "%s"', async (question, op) => {
      const p = await plan(question);
      expect(p).toMatchObject({
        grain: 'player_season',
        metric: 'goals',
        agg: { kind: 'list' },
        metricCondition: { op, value: 50 },
        careerConditions: [],
      });
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('also owns the reproduced subject-less wording', async () => {
      const p = await plan('more than 50 goals in a season');
      expect(p).toMatchObject({
        grain: 'player_season', metric: 'goals', agg: { kind: 'list' },
        metricCondition: { op: 'gt', value: 50 }, careerConditions: [],
      });
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it.each([
      ['players with more than 20 games in a season', 'games', 20],
      ['players with more than 10 Brownlow votes in a season', 'brownlow_votes', 10],
    ] as const)('routes the season-capable career vocabulary in "%s"', async (question, metric, value) => {
      const p = await plan(question);
      expect(p).toMatchObject({
        grain: 'player_season', metric, agg: { kind: 'list' },
        metricCondition: { op: 'gt', value }, careerConditions: [],
      });
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('fails a non-season-capable career column closed', async () => {
      const p = await plan('players with more than 2 premierships in a season');
      expect(p.grain).toBe('player_career');
      expect(p.metricCondition).toEqual({ op: 'gt', value: 2 });
      expect(validatePlan(p)).toHaveProperty('error');
    });

    it('keeps generic season ownership when a player is named', async () => {
      const p = await plan('Gary Ablett Jnr with more than 50 goals in a season');
      expect(p).toMatchObject({
        grain: 'player_season', metric: 'goals', player: { id: 101 },
        metricCondition: { op: 'gt', value: 50 }, careerConditions: [],
      });
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it.each([
      'players with more than 50 career goals in a season',
      'players with more than 50 goals and no premierships in a season',
    ])('fails conflicting generic-season conditions closed: %s', async (question) => {
      const p = await plan(question);
      expect(p.grain).toBe('player_career');
      expect(p.metricCondition).toBeDefined();
      expect(validatePlan(p)).toHaveProperty('error');
    });

    it.each([
      ['players with more than 50 goals in a season against Carlton', 'clubAgainst'],
      ['players with more than 50 goals in a season at the MCG', 'venue'],
      ['players with more than 50 goals in a season in grand finals', 'matchType'],
      ['players with more than 50 goals in a season in round 5', 'roundNumber'],
    ] as const)('retains incompatible match scope and refuses "%s"', async (question, scopeKey) => {
      const p = await plan(question);
      expect(p).toMatchObject({
        grain: 'player_season', metric: 'goals', agg: { kind: 'list' },
        metricCondition: { op: 'gt', value: 50 }, careerConditions: [],
      });
      expect(p.scope[scopeKey]).toBeDefined();
      expect(validatePlan(p)).toEqual({
        error: 'A season total cannot be scoped to a venue, opponent, match type, or round.',
      });
    });

    it('retains a reachable matchup and lets the existing season backstop refuse it', async () => {
      const p = await plan('players with more than 50 goals in a season Richmond v Carlton');
      expect(p).toMatchObject({
        grain: 'player_season', metric: 'goals', agg: { kind: 'list' },
        metricCondition: { op: 'gt', value: 50 }, careerConditions: [],
      });
      expect(p.scope.matchup).toBeDefined();
      expect(validatePlan(p)).toHaveProperty('error');
    });

    it('preserves supported named-year, clubFor, game, and career controls', async () => {
      const namedYear = await plan('players with more than 2 goals in 1989');
      expect(namedYear).toMatchObject({
        grain: 'player_season', metric: 'goals',
        scope: { seasonMin: 1989, seasonMax: 1989 },
        metricCondition: { op: 'gt', value: 2 }, careerConditions: [],
      });
      expect(validatePlan(namedYear)).not.toHaveProperty('error');

      const clubFor = await plan('players with more than 50 goals for Richmond in a season');
      expect(clubFor).toMatchObject({
        grain: 'player_season', metric: 'goals',
        scope: { clubFor: { organizationId: 1 } },
        metricCondition: { op: 'gt', value: 50 }, careerConditions: [],
      });
      expect(validatePlan(clubFor)).not.toHaveProperty('error');

      const game = await plan('players with more than 5 goals in a game');
      expect(game).toMatchObject({
        grain: 'player_game', mode: 'single', metric: 'goals',
        metricCondition: { op: 'gt', value: 5 }, careerConditions: [],
      });
      expect(validatePlan(game)).not.toHaveProperty('error');

      const career = await plan('players with more than 500 career goals');
      expect(career).toMatchObject({
        grain: 'player_career', metric: null,
        careerConditions: [{ kind: 'column', column: 'goals', op: 'gt', value: 500 }],
      });
      expect(career.metricCondition).toBeUndefined();
      expect(validatePlan(career)).not.toHaveProperty('error');
    });

    it('refuses top-N plus a season threshold instead of dropping either request', async () => {
      const p = await plan('top 10 players with more than 50 goals in a season');
      expect(p).toMatchObject({
        grain: 'player_season', metric: 'goals', agg: { kind: 'top_n', n: 10 },
        metricCondition: { op: 'gt', value: 50 }, careerConditions: [],
      });
      expect(validatePlan(p)).toEqual({
        error: 'A statistic threshold lists every qualifying result rather than ranking one.',
      });
    });
  });

  describe('AFLDB-ISSUE-110 C: two-club wins/losses-against head-to-head', () => {
    it.each([
      'Richmond wins against Carlton',
      'Richmond losses against Carlton',
      'Richmond wins vs Carlton',
      'Richmond losses versus Carlton',
    ])('routes %s to the typed head-to-head record', async (question) => {
      const p = await plan(question);
      expect(p.grain).toBe('head_to_head');
      expect(p.metric).toBeNull();
      expect(p.agg).toEqual({ kind: 'count' });
      expect(p.headToHead).toEqual({ kind: 'record' });
      expect(p.scope.matchup?.clubA.slug).toBe('richmond');
      expect(p.scope.matchup?.clubB.slug).toBe('carlton');
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('does not steal grouped team-result thresholds', async () => {
      const p = await plan('teams with more than 3 wins against Richmond');
      expect(p.grain).toBe('team_match');
      expect(p.headToHead).toBeUndefined();
      expect(p.havingClause).toEqual({ metric: 'wins', op: 'gt', value: 3 });
    });

    it.each([
      ['exactly three wins against Carlton', 'eq'],
      ['at least three wins against Carlton', 'gte'],
      ['teams with exactly three wins against Carlton', 'eq'],
      ['teams with at least three wins against Carlton', 'gte'],
    ] as const)('a number WORD governs "%s" away from the head-to-head route', async (question, op) => {
      const p = await plan(question);
      expect(p.grain).toBe('team_match');
      expect(p.headToHead).toBeUndefined();
      expect(p.havingClause).toEqual({ metric: 'wins', op, value: 3 });
      expect(p.scope.clubAgainst?.slug).toBe('carlton');
    });

    it.each([
      ['biggest win against Carlton', 'win_margin'],
      ['biggest loss against Carlton', 'loss_margin'],
    ] as const)('does not steal team-match extrema: %s', async (question, metric) => {
      const p = await plan(question);
      expect(p.grain).toBe('team_match');
      expect(p.metric).toBe(metric);
      expect(p.headToHead).toBeUndefined();
    });

    it('declines a one-club relationship question instead of narrowing it', async () => {
      // With only one resolved club the cue is not committed; the question
      // keeps its pre-existing honest refusal (a plan validation cannot
      // pass, or an outright decline) rather than becoming a narrower
      // head-to-head with an invented second participant.
      const parsed = await parseNlQuestion('wins against Carlton', ctx);
      if (parsed.status === 'plan') {
        expect(parsed.plan.grain).not.toBe('head_to_head');
        expect(validatePlan(parsed.plan)).toHaveProperty('error');
      } else {
        expect(parsed.status).toBe('none');
      }
    });
  });

  describe('AFLDB-ISSUE-110 D: Bulldogs organization alias', () => {
    it.each(['Bulldogs', 'Dogs', 'Footscray', 'Western Bulldogs'])(
      'resolves %s to the same organization lineage', async (name) => {
        const p = await plan(`most career games for the ${name}`);
        expect(p.grain).toBe('player_career');
        expect(p.scope.clubFor?.organizationId).toBe(6);
      },
    );

    it('answers an ordinary team question through the alias', async () => {
      const p = await plan('Bulldogs biggest win against Richmond');
      expect(p.grain).toBe('team_match');
      expect(p.metric).toBe('win_margin');
      expect(p.scope.clubFor?.organizationId).toBe(6);
      expect(p.scope.clubAgainst?.organizationId).toBe(1);
    });

    it('keeps a head-to-head between two lineages working through the alias', async () => {
      const p = await plan('Bulldogs record against Richmond');
      expect(p.grain).toBe('head_to_head');
      expect(p.scope.matchup?.clubA.organizationId).toBe(6);
      expect(p.scope.matchup?.clubB.organizationId).toBe(1);
    });

    it('same-organization aliases cannot manufacture a two-club matchup', async () => {
      const parsed = await parseNlQuestion('Bulldogs record against Footscray', ctx);
      if (parsed.status === 'plan') {
        expect(validatePlan(parsed.plan)).toEqual({ error: 'A matchup needs two different clubs.' });
      } else {
        expect(parsed.status).toBe('none');
      }
    });
  });
});
