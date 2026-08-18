/**
 * Parser corpus: every phrasing required by the feature's acceptance
 * criteria, asserting the exact semantic plan produced -- not just that
 * a plan exists. DB-free: a small fake directory and a fake
 * resolvePlayer stand in for the database (see db/queries/nl/resolve.ts
 * for the real one). DB-result validation for the same fixtures lands in
 * tests/integration/nl-answers.test.ts once the grain compilers exist.
 */
import { describe, expect, it } from 'vitest';

import { parseNlQuestion, type NlParseContext, type NlPlayerCandidate } from '@/search/nl/parser';
import { NL_CONFIDENCE, NL_METRICS, validatePlan, type NlParse, type NlQueryPlan } from '@/search/nl/plan';
import type { NlClubDirectoryEntry, NlVenueDirectoryEntry } from '@/search/nl/entities';

const CLUBS: NlClubDirectoryEntry[] = [
  { organizationId: 1, slug: 'richmond', name: 'Richmond', names: ['richmond', 'tigers'] },
  { organizationId: 2, slug: 'carlton', name: 'Carlton', names: ['carlton', 'blues'] },
  { organizationId: 3, slug: 'collingwood', name: 'Collingwood', names: ['collingwood', 'pies', 'magpies'] },
  { organizationId: 4, slug: 'geelong', name: 'Geelong', names: ['geelong', 'cats'] },
];

const VENUES: NlVenueDirectoryEntry[] = [
  { id: 1, slug: 'mcg', name: 'Melbourne Cricket Ground', names: ['mcg', 'melbourne cricket ground', 'the g'] },
  { id: 2, slug: 'docklands', name: 'Docklands Stadium', names: ['docklands', 'marvel', 'etihad'] },
];

const PLAYERS: Record<string, NlPlayerCandidate[]> = {
  'dustin martin': [{ ref: { id: 100, slug: 'dustin-martin', name: 'Dustin Martin' }, score: 1000 }],
  'gary ablett': [{ ref: { id: 101, slug: 'gary-ablett', name: 'Gary Ablett' }, score: 1000 }],
};

function fakeResolvePlayer(name: string): Promise<NlPlayerCandidate[]> {
  return Promise.resolve(PLAYERS[name.toLowerCase()] ?? []);
}

const ctx: NlParseContext = { clubs: CLUBS, venues: VENUES, resolvePlayer: fakeResolvePlayer };

async function parse(question: string): Promise<NlParse> {
  return parseNlQuestion(question, ctx);
}

async function plan(question: string): Promise<NlQueryPlan> {
  const result = await parse(question);
  expect(result.status, `"${question}" -> ${result.status}${
    result.status !== 'plan' ? ` (${result.status === 'none' ? result.reason : result.reason})` : ''
  }, confidence ${result.report.confidence.toFixed(2)}, unsupported: ${result.report.unsupportedTerms.join(',')}`)
    .toBe('plan');
  return (result as Extract<NlParse, { status: 'plan' }>).plan;
}

describe('1. player-specific queries', () => {
  it('dusty most disposals -> single-game peak', async () => {
    const p = await plan('dusty most disposals');
    expect(p.grain).toBe('player_game');
    expect(p.mode).toBe('single');
    expect(p.metric).toBe('disposals');
    expect(p.agg).toEqual({ kind: 'max' });
    expect(p.player?.name).toBe('Dustin Martin');
  });

  it('dustin martin most goals -> single-game peak', async () => {
    const p = await plan('dustin martin most goals');
    expect(p.grain).toBe('player_game');
    expect(p.mode).toBe('single');
    expect(p.metric).toBe('goals');
    expect(p.player?.name).toBe('Dustin Martin');
  });

  it('top 5 disposal games by dusty', async () => {
    const p = await plan('top 5 disposal games by dusty');
    expect(p.grain).toBe('player_game');
    expect(p.mode).toBe('single');
    expect(p.metric).toBe('disposals');
    expect(p.agg).toEqual({ kind: 'top_n', n: 5 });
    expect(p.player?.name).toBe('Dustin Martin');
  });
});

describe('2. team queries', () => {
  it('richmond biggest loss', async () => {
    const p = await plan('richmond biggest loss');
    expect(p.grain).toBe('team_match');
    expect(p.metric).toBe('loss_margin');
    expect(p.agg).toEqual({ kind: 'max' });
    expect(p.scope.clubFor?.name).toBe('Richmond');
    expect(p.scope.clubAgainst).toBeUndefined();
  });

  it('richmond biggest win since 2000', async () => {
    const p = await plan('richmond biggest win since 2000');
    expect(p.grain).toBe('team_match');
    expect(p.metric).toBe('win_margin');
    expect(p.scope.clubFor?.name).toBe('Richmond');
    expect(p.scope.seasonMin).toBe(2000);
  });

  it('biggest loss at the mcg', async () => {
    const p = await plan('biggest loss at the mcg');
    expect(p.grain).toBe('team_match');
    expect(p.metric).toBe('loss_margin');
    expect(p.scope.venue?.name).toBe('Melbourne Cricket Ground');
    expect(p.scope.clubFor).toBeUndefined();
  });
});

describe('3. venue queries', () => {
  it('most goals at the mcg -> ranks every player, summed at that venue', async () => {
    const p = await plan('most goals at the mcg');
    expect(p.grain).toBe('player_game');
    expect(p.mode).toBe('sum');
    expect(p.metric).toBe('goals');
    expect(p.scope.venue?.name).toBe('Melbourne Cricket Ground');
    expect(p.player).toBeUndefined();
  });

  it('most disposals in a grand final at the mcg -> single-game, matchType + venue scoped', async () => {
    const p = await plan('most disposals in a grand final at the mcg');
    expect(p.grain).toBe('player_game');
    expect(p.mode).toBe('single');
    expect(p.metric).toBe('disposals');
    expect(p.scope.venue?.name).toBe('Melbourne Cricket Ground');
    expect(p.scope.matchType).toBe('grand_final');
  });
});

describe('4. career filters', () => {
  it('players with 200 games and no premiership', async () => {
    const p = await plan('players with 200 games and no premiership');
    expect(p.grain).toBe('player_career');
    expect(p.careerConditions).toContainEqual({ kind: 'column', column: 'games', op: 'gte', value: 200 });
    expect(p.careerConditions).toContainEqual({ kind: 'column', column: 'premierships', op: 'eq', value: 0 });
  });

  it('players with 250 games and exactly two clubs', async () => {
    const p = await plan('players with 250 games and exactly two clubs');
    expect(p.grain).toBe('player_career');
    expect(p.careerConditions).toContainEqual({ kind: 'column', column: 'games', op: 'gte', value: 250 });
    expect(p.careerConditions).toContainEqual({ kind: 'column', column: 'clubs_played', op: 'eq', value: 2 });
  });

  it('most games without kicking a goal', async () => {
    const p = await plan('most games without kicking a goal');
    expect(p.grain).toBe('player_career');
    expect(p.metric).toBe('games');
    expect(p.agg).toEqual({ kind: 'max' });
    expect(p.careerConditions).toContainEqual({ kind: 'column', column: 'goals', op: 'eq', value: 0 });
  });
});

describe('5. awards', () => {
  it('most brownlow votes', async () => {
    const p = await plan('most brownlow votes');
    expect(p.grain).toBe('player_career');
    expect(p.metric).toBe('brownlow_votes');
    expect(p.agg).toEqual({ kind: 'max' });
  });

  it('most brownlow votes without winning a brownlow', async () => {
    const p = await plan('most brownlow votes without winning a brownlow');
    expect(p.grain).toBe('player_career');
    expect(p.metric).toBe('brownlow_votes');
    expect(p.careerConditions).toContainEqual({ kind: 'column', column: 'brownlow_medals', op: 'eq', value: 0 });
  });

  it('most all-australian selections without a premiership', async () => {
    const p = await plan('most all-australian selections without a premiership');
    expect(p.grain).toBe('player_career');
    expect(p.metric).toBe('all_australian_selections');
    expect(p.careerConditions).toContainEqual({ kind: 'column', column: 'premierships', op: 'eq', value: 0 });
  });
});

describe('6. finals', () => {
  it('most disposals in a grand final', async () => {
    const p = await plan('most disposals in a grand final');
    expect(p.grain).toBe('player_game');
    expect(p.mode).toBe('single');
    expect(p.metric).toBe('disposals');
    expect(p.scope.matchType).toBe('grand_final');
  });

  it('dusty top 5 disposal games in finals', async () => {
    const p = await plan('dusty top 5 disposal games in finals');
    expect(p.grain).toBe('player_game');
    expect(p.mode).toBe('single');
    expect(p.metric).toBe('disposals');
    expect(p.agg).toEqual({ kind: 'top_n', n: 5 });
    expect(p.scope.matchType).toBe('finals');
    expect(p.player?.name).toBe('Dustin Martin');
  });

  it('most finals played without winning a premiership', async () => {
    const p = await plan('most finals played without winning a premiership');
    expect(p.grain).toBe('player_career');
    expect(p.metric).toBe('finals');
    expect(p.careerConditions).toContainEqual({ kind: 'column', column: 'premierships', op: 'eq', value: 0 });
  });
});

describe('7. career-boundary queries', () => {
  it('players whose first game was a grand final', async () => {
    const p = await plan('players whose first game was a grand final');
    expect(p.grain).toBe('player_career');
    expect(p.boundary).toEqual({ event: 'debut', where: 'grand_final' });
  });

  it('players whose last game was a grand final', async () => {
    const p = await plan('players whose last game was a grand final');
    expect(p.grain).toBe('player_career');
    expect(p.boundary).toEqual({ event: 'last_game', where: 'grand_final' });
  });
});

describe('8. compound queries', () => {
  it('most goals by a Richmond player in a final at the MCG since 1980', async () => {
    const p = await plan('most goals by a Richmond player in a final at the MCG since 1980');
    expect(p.grain).toBe('player_game');
    expect(p.metric).toBe('goals');
    expect(p.scope.clubFor?.name).toBe('Richmond');
    expect(p.scope.matchType).toBe('finals');
    expect(p.scope.venue?.name).toBe('Melbourne Cricket Ground');
    expect(p.scope.seasonMin).toBe(1980);
    expect(p.player).toBeUndefined(); // "a Richmond player" names no one specific
  });

  it('top 10 players by brownlow votes with no medal', async () => {
    const p = await plan('top 10 players by brownlow votes with no medal');
    expect(p.grain).toBe('player_career');
    expect(p.metric).toBe('brownlow_votes');
    expect(p.agg).toEqual({ kind: 'top_n', n: 10 });
    expect(p.careerConditions).toContainEqual({ kind: 'column', column: 'brownlow_medals', op: 'eq', value: 0 });
  });
});

describe('9. aliases', () => {
  it('dusty resolves to Dustin Martin', async () => {
    const p = await plan('dusty most disposals');
    expect(p.player?.name).toBe('Dustin Martin');
  });

  it('tigers resolves to Richmond', async () => {
    const p = await plan('tigers biggest win');
    expect(p.scope.clubFor?.name).toBe('Richmond');
  });

  it('pies resolves to Collingwood', async () => {
    const p = await plan('pies biggest win');
    expect(p.scope.clubFor?.name).toBe('Collingwood');
  });

  it('touches resolves to disposals', async () => {
    const p = await plan('dusty most touches');
    expect(p.metric).toBe('disposals');
  });

  it('AA resolves to All-Australian', async () => {
    const p = await plan('most AA selections');
    expect(p.metric).toBe('all_australian_selections');
  });

  it('GF resolves to Grand Final', async () => {
    const p = await plan('most disposals in a gf');
    expect(p.scope.matchType).toBe('grand_final');
  });

  it('MCG resolves to Melbourne Cricket Ground', async () => {
    const p = await plan('biggest win at the mcg');
    expect(p.scope.venue?.name).toBe('Melbourne Cricket Ground');
  });
});

describe('10. operator parsing', () => {
  it('top 10', async () => {
    const p = await plan('top 10 career goalkickers');
    expect(p.agg).toEqual({ kind: 'top_n', n: 10 });
  });

  it('most / least / highest / lowest all resolve to max/min', async () => {
    expect((await plan('most goals')).agg).toEqual({ kind: 'max' });
    expect((await plan('highest disposal game by dustin martin')).agg).toEqual({ kind: 'max' });
    expect((await plan('lowest score at the mcg')).agg).toEqual({ kind: 'min' });
  });

  it('since / before as season bounds', async () => {
    expect((await plan('richmond biggest win since 2000')).scope.seasonMin).toBe(2000);
    expect((await plan('richmond biggest win before 1990')).scope.seasonMax).toBe(1989);
  });

  it('at least / more than / less than / exactly as comparison operators', async () => {
    const atLeast = await plan('players with at least 300 games');
    expect(atLeast.careerConditions).toContainEqual({ kind: 'column', column: 'games', op: 'gte', value: 300 });

    const moreThan = await plan('players with more than 300 games');
    expect(moreThan.careerConditions).toContainEqual({ kind: 'column', column: 'games', op: 'gt', value: 300 });

    const lessThan = await plan('players with less than 50 games');
    expect(lessThan.careerConditions).toContainEqual({ kind: 'column', column: 'games', op: 'lt', value: 50 });

    const exactly = await plan('players with exactly 250 games');
    expect(exactly.careerConditions).toContainEqual({ kind: 'column', column: 'games', op: 'eq', value: 250 });
  });

  it('without / never as negation', async () => {
    const without = await plan('most games without kicking a goal');
    expect(without.careerConditions).toContainEqual({ kind: 'column', column: 'goals', op: 'eq', value: 0 });

    const never = await plan('players with 300 games and never a premiership');
    expect(never.careerConditions).toContainEqual({ kind: 'column', column: 'premierships', op: 'eq', value: 0 });
  });
});

describe('11. player-season queries', () => {
  it('most goals in 2017 -> player_season, a bare year is captured as an exact season', async () => {
    const p = await plan('most goals in 2017');
    expect(p.grain).toBe('player_season');
    expect(p.metric).toBe('goals');
    expect(p.scope.seasonMin).toBe(2017);
    expect(p.scope.seasonMax).toBe(2017);
    expect(p.player).toBeUndefined();
  });

  // Changed at PARSER_VERSION 2: this used to stay player_game/sum on
  // the argument that match-grain club scoping is more precise for a
  // transfer season. The 12,000-question corpus showed 1,875 questions
  // of this shape, all describing a season leaderboard; the sum reached
  // the same numbers by a different route, but the plan misdescribed the
  // question, and the player_season compiler's club scope
  // (player_club_season_stats) handles transfer seasons itself.
  it('most goals by a richmond player in 2017 -> player_season, a club-scoped season leaderboard', async () => {
    const p = await plan('most goals by a richmond player in 2017');
    expect(p.grain).toBe('player_season');
    expect(p.metric).toBe('goals');
    expect(p.scope.clubFor?.name).toBe('Richmond');
    expect(p.scope.seasonMin).toBe(2017);
    expect(p.scope.seasonMax).toBe(2017);
  });

  it('dusty most goals in 2017 -> a named player still defaults to single-game peak, now filtered to that season', async () => {
    const p = await plan('dusty most goals in 2017');
    expect(p.grain).toBe('player_game');
    expect(p.mode).toBe('single');
    expect(p.scope.seasonMin).toBe(2017);
    expect(p.scope.seasonMax).toBe(2017);
  });
});

describe('13. club_season queries', () => {
  it('teams with the most wins in a season', async () => {
    const p = await plan('teams with the most wins in a season');
    expect(p.grain).toBe('club_season');
    expect(p.metric).toBe('wins');
    expect(p.agg).toEqual({ kind: 'max' });
  });

  it('clubs with the most losses in a season', async () => {
    const p = await plan('clubs with the most losses in a season');
    expect(p.grain).toBe('club_season');
    expect(p.metric).toBe('losses');
  });

  it('fewest wins by a premier -> "premier" alone is enough of a club-season cue, no leading "teams" needed', async () => {
    const p = await plan('fewest wins by a premier');
    expect(p.grain).toBe('club_season');
    expect(p.metric).toBe('wins');
    expect(p.agg).toEqual({ kind: 'min' });
    expect(p.clubSeasonConditions).toContainEqual({ kind: 'premier' });
  });

  it('most losses by a premiership team', async () => {
    const p = await plan('most losses by a premiership team');
    expect(p.grain).toBe('club_season');
    expect(p.metric).toBe('losses');
    expect(p.clubSeasonConditions).toContainEqual({ kind: 'premier' });
  });

  it('teams that won the wooden spoon -> a conditions-only list, no ranked metric', async () => {
    const p = await plan('teams that won the wooden spoon');
    expect(p.grain).toBe('club_season');
    expect(p.metric).toBeNull();
    expect(p.clubSeasonConditions).toContainEqual({ kind: 'wooden_spoon' });
  });

  it('clubs that made finals', async () => {
    const p = await plan('clubs that made finals');
    expect(p.grain).toBe('club_season');
    expect(p.clubSeasonConditions).toContainEqual({ kind: 'made_finals' });
  });

  it('clubs that missed finals', async () => {
    const p = await plan('clubs that missed finals');
    expect(p.grain).toBe('club_season');
    expect(p.clubSeasonConditions).toContainEqual({ kind: 'missed_finals' });
  });

  it('a club-scoped player question is NOT misread as club_season ("richmond" alone is too weak a cue)', async () => {
    const p = await plan('most goals against carlton by a richmond player');
    expect(p.grain).not.toBe('club_season');
  });
});

describe('12. aggregate-vs-single scope for a named player', () => {
  it('dusty total goals against carlton -> "total" overrides the single-game default to a scoped sum', async () => {
    const p = await plan('dusty total goals against carlton');
    expect(p.grain).toBe('player_game');
    expect(p.mode).toBe('sum');
    expect(p.metric).toBe('goals');
    expect(p.player?.name).toBe('Dustin Martin');
    expect(p.scope.clubAgainst?.name).toBe('Carlton');
  });

  it('dusty combined disposals -> "combined" also reads as a sum cue', async () => {
    const p = await plan('dusty combined disposals');
    expect(p.mode).toBe('sum');
  });

  it('dusty career goals against carlton -> a scoped "career" reads as a sum, not a dropped scope', async () => {
    // Regression: player_career has no opponent scoping at all, so this
    // used to silently drop "against carlton" and answer his whole
    // career total instead of erroring or scoping correctly.
    const p = await plan('dusty career goals against carlton');
    expect(p.grain).toBe('player_game');
    expect(p.mode).toBe('sum');
    expect(p.scope.clubAgainst?.name).toBe('Carlton');
  });

  it('dusty career goals (no scope) -> stays the true unscoped player_career reading', async () => {
    const p = await plan('dusty career goals');
    expect(p.grain).toBe('player_career');
    expect(p.player?.name).toBe('Dustin Martin');
  });

  it('most goals against carlton ever (no player) -> scoped sum, not a dropped opponent', async () => {
    const p = await plan('most goals against carlton ever');
    expect(p.grain).toBe('player_game');
    expect(p.mode).toBe('sum');
    expect(p.scope.clubAgainst?.name).toBe('Carlton');
  });
});

describe('unanswerable topics decline with a reason rather than a wrong answer', () => {
  it('coaching questions are declined', async () => {
    const result = await parse('who coached richmond to the 2017 premiership');
    expect(result.status).toBe('unanswerable');
    if (result.status === 'unanswerable') {
      expect(result.topic).toBe('coaching');
      expect(result.reason).toMatch(/coaching data/i);
    }
  });

  it('streak questions are declined', async () => {
    const result = await parse("richmond's longest winning streak");
    expect(result.status).toBe('unanswerable');
  });

  it('youngest/oldest questions are declined pending dob completeness', async () => {
    const result = await parse('youngest player ever');
    expect(result.status).toBe('unanswerable');
  });
});

describe('confidence gating', () => {
  it('gibberish declines rather than fabricating a plan', async () => {
    const result = await parse('purple elephant sandwich');
    expect(result.status).toBe('none');
    if (result.status === 'none') expect(result.reason).toBe('unrecognised');
  });

  it('an unresolvable player mention declines rather than dropping the reference', async () => {
    const result = await parse('zzznotaplayer most disposals');
    expect(result.status).toBe('none');
  });

  it('a plain entity search ("michael tuck") is not forced into a plan', async () => {
    const result = await parse('michael tuck');
    expect(result.status).not.toBe('plan');
  });

  it('an executed plan always clears the configured execute threshold', async () => {
    const result = await parse('dusty most disposals');
    if (result.status === 'plan') {
      expect(result.report.confidence).toBeGreaterThanOrEqual(NL_CONFIDENCE.clarify);
    }
  });
});

/**
 * Generalises the exact bug class the bare-year gap was: a meaningful,
 * recognisable token (here, a season year) present in the question but
 * with no effect at all on the executed plan -- silently ignored rather
 * than acted on. (Digit tokens are deliberately excluded from
 * `report.consumed`'s own token-ratio accounting -- meaningfulTokens()
 * filters them from both the numerator and denominator alike, so a
 * dropped year costs nothing in confidence either; the plan's `scope` is
 * the only place that actually proves the year was used.) A future
 * regression of this shape -- a year dropped from a new compound
 * phrasing -- fails here rather than shipping a silently-wrong answer.
 */
describe('regression: every year in an executed question reaches the plan scope', () => {
  const YEAR_RE = /\b(1[89]\d{2}|20\d{2})\b/;
  const questionsWithAYear = [
    'most goals in 2017',
    'richmond biggest win since 2000',
    'most disposals since 1990',
    'players with at least 300 games since 1980',
    'most goals by a Richmond player in a final at the MCG since 1980',
    'dusty most goals in 2017',
    'dusty total goals against carlton since 2015',
  ];

  it.each(questionsWithAYear)('%s', async (question) => {
    const result = await parse(question);
    if (result.status !== 'plan') return; // A decline can't silently drop anything -- nothing was acted on.
    const year = Number(YEAR_RE.exec(question)![0]);
    const { seasonMin, seasonMax } = result.plan.scope;
    expect(
      seasonMin === year || seasonMax === year,
      `"${question}": year ${year} reached neither seasonMin (${seasonMin}) nor seasonMax (${seasonMax})`,
    ).toBe(true);
  });
});

/**
 * A bare "most <career column>" with no player named. Found broken for
 * everything except games/goals/brownlow_votes/finals: the fallback that
 * reads a leftover career-subject word only ever hand-listed those three,
 * so "most premierships" matched none of them, fell through to the
 * player-name scan, and declined as "no player named premierships".
 * Reuses CAREER_STAT_WORDS (the same list extractCareerConditions already
 * uses for thresholds) instead of a second, narrower copy.
 */
describe('regression: bare "most <career column>" ranks every career column, not just games/goals', () => {
  const cases: [string, string][] = [
    ['most premierships', 'premierships'],
    ['most wins', 'wins'],
    ['most losses', 'losses'],
    ['most draws', 'draws'],
    ['most brownlow medals', 'brownlow_medals'],
    ['most clubs', 'clubs_played'],
  ];

  it.each(cases)('%s -> player_career %s, ranked, not a condition', async (question, metric) => {
    const p = await plan(question);
    expect(p.grain).toBe('player_career');
    expect(p.metric).toBe(metric);
    expect(p.agg).toEqual({ kind: 'max' });
    expect(p.careerConditions).toEqual([]);
  });

  // Asserting the plan SHAPE above is not enough, and this pair of tests
  // exists because relying on it alone already shipped a defect: the
  // parser produced exactly the plan asserted above for "most wins" /
  // "most losses" / "most draws" / "most brownlow medals" / "most clubs",
  // and validatePlan then rejected all five -- NL_METRICS.player_career
  // had no entry for those columns, so a reader was told "'wins' is not a
  // recognised statistic", which reads as though the site does not track
  // wins at all. Every test here passed throughout.
  //
  // A plan that cannot be validated is not an answer, so the parser test
  // must carry the plan all the way through validation. Same lesson as
  // the player_career missing-player-filter bug: check the answer, not
  // the shape of the thing that was going to produce it.
  it.each(cases)('%s survives validatePlan, not just the parser', async (question) => {
    const validated = validatePlan(await plan(question));
    expect(validated).not.toHaveProperty('error');
  });

  it('every bare career metric the parser can emit is a real player_career metric', async () => {
    // The structural form of the same check: whatever CAREER_STAT_WORDS
    // grows to cover next, the metric it yields must exist in
    // NL_METRICS.player_career or this fails at the point the vocabulary
    // is added rather than in production.
    for (const [question] of cases) {
      const p = await plan(question);
      expect(NL_METRICS.player_career, `metric "${p.metric}" from "${question}"`)
        .toHaveProperty(p.metric!);
    }
  });

  it('"most flags" ranks by premierships rather than filtering to zero premierships', async () => {
    // The regression this guards: CAREER_STAT_WORDS' premierships entry
    // is /\bpremierships?\b|\bflags?\b/ -- a top-level alternation.
    // negativeTargets spliced its .source into a larger pattern
    // unparenthesised, so the "no/never/without" prefix bound only to
    // the FIRST alternative; "flags" stood alone as its own complete
    // alternative and matched unconditionally. Every bare "flags"
    // anywhere in a question, not just "no flags", pushed a false
    // premierships = 0 condition -- "most flags" silently became "most
    // <nothing> among players with no premierships".
    const p = await plan('most flags');
    expect(p.metric).toBe('premierships');
    expect(p.agg).toEqual({ kind: 'max' });
    expect(p.careerConditions).toEqual([]);
  });

  it('"no flags" still reads as the negative condition it always meant', async () => {
    const p = await plan('players with no flags');
    expect(p.careerConditions).toContainEqual({ kind: 'column', column: 'premierships', op: 'eq', value: 0 });
  });
});

/**
 * A NAMED player asking for a career-only column ("games", "premierships",
 * "wins", "losses", "draws", "brownlow medals", "clubs") must go to
 * player_career, never the player_game single-game-peak default that a
 * genuine per-game stat like "goals" or "disposals" gets. There is no
 * "his best 1-game haul of premierships" -- Nick Dal Santo most games
 * was routing to player_game with metric 'games', which validatePlan
 * correctly rejects (player_game has no games column), surfacing as
 * "'games' is not a recognised statistic for this kind of question" for
 * a total (322) that was one grain over.
 */
describe('regression: a named player + a career-only column goes to player_career', () => {
  it('dusty most games -> career total, not a single-game reading', async () => {
    const p = await plan('dusty most games');
    expect(p.grain).toBe('player_career');
    expect(p.metric).toBe('games');
    expect(p.mode).toBeUndefined();
    expect(p.player?.name).toBe('Dustin Martin');
  });

  it('dusty most premierships -> career total', async () => {
    const p = await plan('dusty most premierships');
    expect(p.grain).toBe('player_career');
    expect(p.metric).toBe('premierships');
  });

  it('genuine per-game stats are unaffected: dusty most goals still asks for his record game', async () => {
    const p = await plan('dusty most goals');
    expect(p.grain).toBe('player_game');
    expect(p.mode).toBe('single');
    expect(p.metric).toBe('goals');
  });
});

/**
 * New vocabulary: AFL commentary/slang terms with no existing mapping,
 * checked against a real question shape rather than the bare regex, so a
 * future edit to surrounding extraction logic (aggregation, stripping)
 * that broke one would fail here too.
 */
describe('vocabulary: commentary and slang terms map to their real stat', () => {
  it.each([
    ['dusty most sausages', 'goals'],
    ['dusty most sausage rolls', 'goals'],
    ['dusty find the sticks the most', 'goals'],
    ['dusty most grabs', 'marks'],
    ['dusty most clunks', 'marks'],
    ['dusty most handpasses', 'handballs'],
    ['dusty most assists', 'goal_assists'],
  ] as const)('%s -> metric %s', async (question, metric) => {
    const p = await plan(question);
    expect(p.metric).toBe(metric);
  });

  it.each([
    'dusty most inside 50s',
    'dusty most inside-50s',
    'dusty most forward entries',
  ])('%s -> inside_50s', async (question) => {
    const p = await plan(question);
    expect(p.metric).toBe('inside_50s');
  });

  it.each([
    'dusty most rebound 50s',
    'dusty most rebound-50s',
  ])('%s -> rebounds', async (question) => {
    const p = await plan(question);
    expect(p.metric).toBe('rebounds');
  });

  it('"most goals in the big dance" reads as a grand_final match type', async () => {
    const p = await plan('most goals in the big dance');
    expect(p.scope.matchType).toBe('grand_final');
  });

  it('"most goals in September" reads as the finals series', async () => {
    const p = await plan('most goals in September');
    expect(p.scope.matchType).toBe('finals');
  });

  it('bare "spoon" reads as the wooden-spoon condition', async () => {
    const p = await plan('teams that won the spoon');
    expect(p.clubSeasonConditions).toContainEqual({ kind: 'wooden_spoon' });
  });
});

describe('regression: two career conditions in one sentence do not cross-contaminate', () => {
  // Found by the 250k-row V2 stress corpus (category plan_numeric_conditions),
  // not by hand-written cases: extractCareerConditions's 20-char lookbehind
  // window used to be measured in raw characters, so when the FIRST stat
  // processed (CAREER_STAT_WORDS' fixed array order, not the order the
  // words appear in the sentence) sat close enough to a second clause's
  // multi-digit number, the window could slice into it -- either stealing
  // its number outright, or slicing THROUGH it and reading the truncated
  // remainder as if it were a complete one (\b evaluates against the
  // window substring, not the original text). See parser.ts's comment at
  // the windowStart computation for the full trace.
  it('a 3-digit number does not bleed into an adjacent clause', async () => {
    const p = await plan('players with more than 300 clubs and over 10 premierships');
    expect(p.careerConditions).toContainEqual({ kind: 'column', column: 'clubs_played', op: 'gt', value: 300 });
    expect(p.careerConditions).toContainEqual({ kind: 'column', column: 'premierships', op: 'gt', value: 10 });
  });

  it('two clauses with the same number both survive', async () => {
    const p = await plan('players with more than 4 clubs and over 4 premierships');
    expect(p.careerConditions).toContainEqual({ kind: 'column', column: 'clubs_played', op: 'gt', value: 4 });
    expect(p.careerConditions).toContainEqual({ kind: 'column', column: 'premierships', op: 'gt', value: 4 });
  });

  it('neither clause is misread as a bare ranking metric', async () => {
    const p = await plan('players with at least 1 games and over 1 goals');
    expect(p.metric).toBeNull();
    expect(p.careerConditions).toContainEqual({ kind: 'column', column: 'games', op: 'gte', value: 1 });
    expect(p.careerConditions).toContainEqual({ kind: 'column', column: 'goals', op: 'gt', value: 1 });
  });

  it('a later-processed stat keeps its own number, not an earlier clause\'s', async () => {
    const p = await plan('players with over 2 games and over 5 premierships');
    expect(p.careerConditions).toContainEqual({ kind: 'column', column: 'games', op: 'gt', value: 2 });
    expect(p.careerConditions).toContainEqual({ kind: 'column', column: 'premierships', op: 'gt', value: 5 });
  });

  it('goals keeps its own condition rather than becoming the ranking subject', async () => {
    const p = await plan('players with more than 5 goals and over 5 finals');
    expect(p.metric).toBeNull();
    expect(p.careerConditions).toContainEqual({ kind: 'column', column: 'goals', op: 'gt', value: 5 });
    expect(p.careerConditions).toContainEqual({ kind: 'column', column: 'finals', op: 'gt', value: 5 });
  });
});

/**
 * The first-kick-goal achievement (player_achievements, migration 053).
 *
 * The claim is curated and source-only -- AFLDB has no play-by-play data,
 * so nothing here is derivable from a stat line. The parser's job is to
 * recognise the phrase, keep it apart from the several achievements that
 * sound like it, and route a summary question to its own grain.
 */
describe('14. goal with first kick', () => {
  const ACHIEVEMENT = 'first_kick_goal_player';

  function builders(p: NlQueryPlan): string[] {
    return p.careerPredicates.map((axis) => axis.builder);
  }

  describe('the base question', () => {
    it('lists players, with no metric to rank by', async () => {
      const p = await plan('players who kicked a goal with their first kick');
      expect(p.grain).toBe('player_career');
      expect(builders(p)).toEqual([ACHIEVEMENT]);
      expect(p.metric).toBeNull();
      // Not {kind:'max'}: a list is capped at 100 rows and a tie list at
      // 25, and this question asks for all of them.
      expect(p.agg).toEqual({ kind: 'list' });
      expect(p.limit).toBe(100);
    });

    it('validates, so the plan actually reaches a compiler', async () => {
      const p = await plan('players who kicked a goal with their first kick');
      expect(validatePlan(p)).not.toHaveProperty('error');
    });
  });

  // Every phrasing in the acceptance criteria has to produce the SAME
  // plan, not merely a similar one: a reader rewording a question must
  // not silently get a different query.
  describe('equivalent phrasings produce one canonical plan', () => {
    const phrasings = [
      'players who kicked a goal with their first kick',
      'players to goal with their first kick',
      'players who goaled with their first kick',
      'first kick goal players',
      'players who scored with their first kick',
      'players to score a goal with their first AFL kick',
      'who kicked a goal with their first VFL kick',
      'who kicked a goal with their first career kick',
    ];

    it.each(phrasings)('%s', async (question) => {
      const p = await plan(question);
      expect(p.grain).toBe('player_career');
      expect(builders(p)).toEqual([ACHIEVEMENT]);
    });

    it('every phrasing produces the identical plan, not merely a similar one', async () => {
      const plans = await Promise.all(phrasings.map(plan));
      for (const p of plans.slice(1)) {
        expect({ ...p }).toEqual({ ...plans[0] });
      }
    });
  });

  describe('filters', () => {
    // A club or season filter has to become a PREDICATE, not scope:
    // answerWithPredicates ignores scope entirely, so a scope-only club
    // filter would silently answer for every club.
    //
    // And it must scope the ACHIEVEMENT, not the player: "Carlton players
    // who kicked a goal with their first kick" means players who did it
    // FOR Carlton. Scoping by played_for_club instead would also count a
    // player who did it on debut elsewhere and was traded to Carlton
    // later -- 33 players rather than the 23 who actually did it there.
    it('a club filter scopes the achievement, not the player', async () => {
      const p = await plan('Carlton players who kicked a goal with their first kick');
      expect(p.grain).toBe('player_career');
      expect(builders(p)).toEqual(['first_kick_goal_for_club']);
      expect(p.careerPredicates[0].params.club).toBe('2');
    });

    it('a decade filter uses the season the feat happened in', async () => {
      const p = await plan('players who kicked a goal with their first kick in the 1940s');
      expect(builders(p)).toEqual(['first_kick_goal_between']);
      expect(p.careerPredicates[0].params).toEqual({ from: '1940', to: '1949' });
    });

    it('a "before" filter bounds the upper end', async () => {
      const p = await plan('players who kicked a goal with their first kick before 1950');
      expect(builders(p)).toEqual(['first_kick_goal_between']);
      expect(p.careerPredicates[0].params.to).toBe('1949');
    });

    it('a "since" filter bounds the lower end', async () => {
      const p = await plan('players who kicked a goal with their first kick since 2000');
      expect(builders(p)).toEqual(['first_kick_goal_between']);
      expect(p.careerPredicates[0].params.from).toBe('2000');
    });

    it('"how many" is still a list; the count comes from its total', async () => {
      const p = await plan('how many players have kicked a goal with their first kick');
      expect(p.grain).toBe('player_career');
      expect(builders(p)).toEqual([ACHIEVEMENT]);
      expect(p.metric).toBeNull();
    });
  });

  describe('summary questions', () => {
    it('which club has had the most', async () => {
      const p = await plan('which club has had the most players kick a goal with their first kick');
      expect(p.grain).toBe('achievement_summary');
      expect(p.achievementSummary).toEqual({ achievementKey: 'first_kick_goal', kind: 'by_club' });
      expect(p.metric).toBeNull();
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('by club', async () => {
      const p = await plan('first kick goal players by club');
      expect(p.achievementSummary?.kind).toBe('by_club');
    });

    it('by decade', async () => {
      const p = await plan('first kick goal players by decade');
      expect(p.achievementSummary?.kind).toBe('by_decade');
    });

    it('which clubs have never had one', async () => {
      const p = await plan('which clubs have never had a player kick a goal with their first kick');
      expect(p.achievementSummary?.kind).toBe('clubs_without');
    });

    it('who was the first', async () => {
      const p = await plan('who was the first player to kick a goal with their first kick');
      expect(p.achievementSummary?.kind).toBe('earliest');
    });

    it('who was the most recent', async () => {
      const p = await plan('who was the most recent player to kick a goal with their first kick');
      expect(p.achievementSummary?.kind).toBe('latest');
    });

    it('a summary cue alone never elects the grain', async () => {
      // "by decade" names no achievement, so there is nothing to
      // summarise; this must not become an achievement_summary plan.
      const result = await parse('players by decade');
      if (result.status === 'plan') {
        expect(result.plan.grain).not.toBe('achievement_summary');
      }
    });
  });

  /**
   * These are DIFFERENT achievements. A player can kick a goal in their
   * debut game without it being their first kick, and a "first goal" is
   * whenever it came -- mapping any of them here would answer a question
   * the reader did not ask.
   */
  describe('semantically different questions are not this achievement', () => {
    const negatives = [
      'players who kicked a goal in their first game',
      'players who kicked their first goal',
      'players with one career goal',
      'players who scored on debut',
      'players who kicked a goal on debut',
    ];

    it.each(negatives)('%s does not resolve to the achievement', async (question) => {
      const result = await parse(question);
      if (result.status === 'plan') {
        expect(builders(result.plan)).not.toContain(ACHIEVEMENT);
        expect(result.plan.grain).not.toBe('achievement_summary');
      }
    });

    it('"one career goal" still parses as an ordinary career condition', async () => {
      const p = await plan('players with one career goal');
      expect(p.grain).toBe('player_career');
      expect(p.careerConditions).toContainEqual({ kind: 'column', column: 'goals', op: 'gte', value: 1 });
      expect(builders(p)).not.toContain(ACHIEVEMENT);
    });
  });
});

/**
 * Parser version 13: the achievement paths stop dropping what the parser
 * consumed. A named player and a plain career condition survive to the
 * career answer path; a summary keeps its season range and club; every
 * scope no compiler can express is rejected by validatePlan rather than
 * silently ignored; and a negated phrasing declines instead of returning
 * the polarity-inverted list.
 */
describe('15. achievement questions honour everything consumed', () => {
  const ACHIEVEMENT = 'first_kick_goal_player';

  function builders(p: NlQueryPlan): string[] {
    return p.careerPredicates.map((axis) => axis.builder);
  }

  it('a named player stays pinned to the plan', async () => {
    const p = await plan('did dustin martin kick a goal with his first kick');
    expect(p.grain).toBe('player_career');
    expect(builders(p)).toEqual([ACHIEVEMENT]);
    expect(p.player?.name).toBe('Dustin Martin');
    expect(validatePlan(p)).not.toHaveProperty('error');
  });

  it('a career condition combines with the achievement', async () => {
    const p = await plan('players with 300 games who kicked a goal with their first kick');
    expect(builders(p)).toEqual([ACHIEVEMENT]);
    expect(p.careerConditions).toContainEqual({ kind: 'column', column: 'games', op: 'gte', value: 300 });
  });

  // The career predicate path expresses a club and a season range as
  // predicates of their own, and nothing else: a venue, opponent or
  // match type that reached execution would be silently ignored, so
  // validatePlan turns each into a decline. (A parse-stage decline is
  // equally safe -- what must never happen is a confident answer that
  // dropped the qualifier.)
  it.each([
    'players who kicked a goal with their first kick at the mcg',
    'players who kicked a goal with their first kick against collingwood',
    'players who kicked a goal with their first kick in a grand final',
  ])('%s is rejected rather than silently unscoped', async (question) => {
    const result = await parse(question);
    if (result.status !== 'plan') return;
    expect(validatePlan(result.plan)).toHaveProperty('error');
  });

  it.each([
    'players who never kicked a goal with their first kick',
    'players who did not kick a goal with their first kick',
  ])('%s declines instead of answering inverted', async (question) => {
    const result = await parse(question);
    expect(result.status).toBe('none');
  });

  it('"this decade" declines instead of answering all-time', async () => {
    const result = await parse('players who kicked a goal with their first kick this decade');
    expect(result.status).toBe('none');
  });

  it('a summary keeps its season scope', async () => {
    const p = await plan('which club has had the most players kick a goal with their first kick since 2000');
    expect(p.grain).toBe('achievement_summary');
    expect(p.achievementSummary?.kind).toBe('by_club');
    expect(p.scope.seasonMin).toBe(2000);
    expect(validatePlan(p)).not.toHaveProperty('error');
  });

  it('a summary keeps its club scope', async () => {
    const p = await plan('carlton first kick goal players by decade');
    expect(p.grain).toBe('achievement_summary');
    expect(p.achievementSummary?.kind).toBe('by_decade');
    expect(p.scope.clubFor?.name).toBe('Carlton');
    expect(validatePlan(p)).not.toHaveProperty('error');
  });

  it('clubs_without scoped to one club is rejected', async () => {
    const p = await plan('which clubs have never had a player kick a goal with their first kick');
    expect(p.achievementSummary?.kind).toBe('clubs_without');
    const scoped = { ...p, scope: { ...p.scope, clubFor: { organizationId: 2, slug: 'carlton', name: 'Carlton' } } };
    expect(validatePlan(scoped)).toHaveProperty('error');
  });

  it('a summary with a named player is rejected', async () => {
    const p = await plan('who was the most recent player to kick a goal with their first kick');
    const withPlayer = { ...p, player: { id: 100, slug: 'dustin-martin', name: 'Dustin Martin' } };
    expect(validatePlan(withPlayer)).toHaveProperty('error');
  });
});
