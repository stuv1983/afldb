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
import { describePlan, NL_CONFIDENCE, NL_METRICS, validatePlan, type NlParse, type NlQueryPlan } from '@/search/nl/plan';
import type { NlClubDirectoryEntry, NlCoachDirectoryEntry, NlVenueDirectoryEntry } from '@/search/nl/entities';

const CLUBS: NlClubDirectoryEntry[] = [
  { organizationId: 1, slug: 'richmond', name: 'Richmond', names: ['richmond', 'tigers'] },
  { organizationId: 2, slug: 'carlton', name: 'Carlton', names: ['carlton', 'blues'] },
  { organizationId: 3, slug: 'collingwood', name: 'Collingwood', names: ['collingwood', 'pies', 'magpies'] },
  { organizationId: 4, slug: 'geelong', name: 'Geelong', names: ['geelong', 'cats'] },
  { organizationId: 5, slug: 'adelaide', name: 'Adelaide', names: ['adelaide', 'crows'] },
  { organizationId: 6, slug: 'port-adelaide', name: 'Port Adelaide', names: ['port adelaide', 'power'] },
];

const VENUES: NlVenueDirectoryEntry[] = [
  { id: 1, slug: 'mcg', name: 'Melbourne Cricket Ground', names: ['mcg', 'melbourne cricket ground', 'the g'] },
  { id: 2, slug: 'docklands', name: 'Docklands Stadium', names: ['docklands', 'marvel', 'etihad'] },
];

/**
 * A stand-in for buildCoachDirectory's 386 rows, including the two
 * measured surname collisions that must NOT resolve: Albert Pannam and
 * Charlie Pannam both coached Richmond, and Len Smith and Norm Smith both
 * coached, so neither surname is an alias here -- exactly as the real
 * directory builder leaves them out.
 */
const COACHES: NlCoachDirectoryEntry[] = [
  { id: 17, slug: 'damien-hardwick', name: 'Damien Hardwick', playerId: 900, playerSlug: 'damien-hardwick', names: ['damien hardwick', 'hardwick'] },
  { id: 1, slug: 'mick-malthouse', name: 'Mick Malthouse', playerId: 9635, playerSlug: 'mick-malthouse', names: ['mick malthouse', 'malthouse'] },
  { id: 152, slug: 'cliff-rankin', name: 'Cliff Rankin', playerId: null, playerSlug: null, names: ['cliff rankin', 'rankin'] },
  { id: 160, slug: 'albert-pannam', name: 'Albert Pannam', playerId: 700, playerSlug: 'albert-pannam', names: ['albert pannam'] },
  { id: 266, slug: 'charlie-pannam', name: 'Charlie Pannam', playerId: 701, playerSlug: 'charlie-pannam', names: ['charlie pannam'] },
];

const PLAYERS: Record<string, NlPlayerCandidate[]> = {
  'dustin martin': [{ ref: { id: 100, slug: 'dustin-martin', name: 'Dustin Martin' }, score: 1000 }],
  // TWO candidates, because afldb_test holds two: players 4700 and 4701
  // share the display name "Gary Ablett" AND the slug "gary-ablett", and
  // the real resolver returns them 10.9 points apart. The single-candidate
  // stand-in this replaces made an unsuffixed "gary ablett" look uniquely
  // resolvable to anyone writing a test against it -- which is how the
  // Phase G corpus came to expect a plan for a question the engine has
  // declined by design since AFLDB-ISSUE-110. The contract itself is
  // asserted in tests/nl-semantic-mapping.test.ts.
  'gary ablett': [
    { ref: { id: 101, slug: 'gary-ablett', name: 'Gary Ablett' }, score: 1000, matchedName: 'Gary Ablett' },
    { ref: { id: 102, slug: 'gary-ablett', name: 'Gary Ablett' }, score: 990, matchedName: 'Gary Ablett' },
  ],
  // AFLDB-ISSUE-152 Phase C: the measured joint holder of "most goals
  // after the siren" (2, tied with Gary Rohan).
  'barry hall': [{ ref: { id: 1001, slug: 'barry-hall', name: 'Barry Hall' }, score: 1000 }],
  // AFLDB-ISSUE-152 Phase D witnesses, with afldb_test's own ids: Brent
  // Harvey is both a brother (relationship 358, Shane Harvey) and a
  // father-son father (relationship 112, Cooper Harvey), so one name
  // exercises every per-player reading.
  'brent harvey': [{ ref: { id: 2164, slug: 'brent-harvey', name: 'Brent Harvey' }, score: 1000 }],
  'cooper harvey': [{ ref: { id: 3048, slug: 'cooper-harvey', name: 'Cooper Harvey' }, score: 1000 }],
  'phil krakouer': [{ ref: { id: 10500, slug: 'phil-krakouer', name: 'Phil Krakouer' }, score: 1000 }],
  // The surname that is also a relationship word. "Most goals by Ben
  // Cousins" must stay a goals question: PLAYER_NICKNAMES maps "cousins"
  // to him, and a bare cousin gate would have declined it as a family
  // question AFLDB cannot answer.
  'ben cousins': [{ ref: { id: 1500, slug: 'ben-cousins', name: 'Ben Cousins' }, score: 1000 }],
};

function fakeResolvePlayer(name: string): Promise<NlPlayerCandidate[]> {
  return Promise.resolve(PLAYERS[name.toLowerCase()] ?? []);
}

const ctx: NlParseContext = { clubs: CLUBS, venues: VENUES, coaches: COACHES, resolvePlayer: fakeResolvePlayer };

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

  it('reads "drawn"/"drew" as the same career draws total as "draws"', async () => {
    // Regression: only the bare "draw(s)" spelling was recognised, so the
    // participle and past-tense forms were left for the entity scan to
    // misread as an unresolved player name and the question declined
    // outright, even though c.draws (a lifetime total, not per-season) is
    // exactly the right column for "played in at least 1 drawn match".
    let p = await plan('played in at least 1 drawn match');
    expect(p.grain).toBe('player_career');
    expect(p.careerConditions).toContainEqual({ kind: 'column', column: 'draws', op: 'gte', value: 1 });

    p = await plan('2 drawn matches');
    expect(p.careerConditions).toContainEqual({ kind: 'column', column: 'draws', op: 'gte', value: 2 });
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

  it('grand final record phrasing scopes the player-game metric', async () => {
    for (const question of [
      'Grand Final record for goals',
      'please Grand Final record for goals thanks',
      'Grand Final goal leader',
      'Grand Final goal record holder',
    ]) {
      const p = await plan(question);
      expect(p.grain).toBe('player_game');
      expect(p.mode).toBe('single');
      expect(p.metric).toBe('goals');
      expect(p.agg).toEqual({ kind: 'max' });
      expect(p.scope.matchType).toBe('grand_final');
    }
  });

  it('record-holder phrasing scopes opponent career totals like leader phrasing', async () => {
    const p = await plan('record holder for goals against Collingwood');
    expect(p.grain).toBe('player_game');
    expect(p.mode).toBe('sum');
    expect(p.metric).toBe('goals');
    expect(p.agg).toEqual({ kind: 'max' });
    expect(p.scope.clubAgainst?.slug).toBe('collingwood');
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

  // AFLDB-ISSUE-129 §8.4 item 8. "wildcard final" contains the word "final", so
  // it has to beat the bare /\bfinals?\b/ rule or it is silently read as a
  // generic finals question. It is its own match type, not a finals synonym.
  it('reads a wildcard final as its own match type, not as generic finals', async () => {
    for (const q of [
      'dusty top 5 disposal games in the wildcard final',
      'dusty top 5 disposal games in wildcard finals',
      'dusty top 5 disposal games in the wildcard round',
    ]) {
      const p = await plan(q);
      expect(p.scope.matchType, q).toBe('wildcard_final');
    }
  });

  it('leaves the generic finals reading unchanged', async () => {
    const p = await plan('dusty top 5 disposal games in finals');
    expect(p.scope.matchType).toBe('finals');
  });

  it('most finals played without winning a premiership', async () => {
    const p = await plan('most finals played without winning a premiership');
    expect(p.grain).toBe('player_career');
    expect(p.metric).toBe('finals');
    expect(p.careerConditions).toContainEqual({ kind: 'column', column: 'premierships', op: 'eq', value: 0 });
  });

  it('bare finals still stays a career metric without record/leader context', async () => {
    const p = await plan('most finals played');
    expect(p.grain).toBe('player_career');
    expect(p.metric).toBe('finals');
    expect(p.scope.matchType).toBeUndefined();
  });

  it('reads a qualified finals count as its own builder, not the generic any-type total', async () => {
    // Regression: the generic /\bfinals?\b/ entry matched "final(s)" on its
    // own and read the qualifier ("grand"/"preliminary") as an unresolved
    // player name, declining the whole question. Also covers the window-
    // size edge case: "preliminary " is long enough that a naive fixed
    // lookback pushed the leading digit of "3 or more" out of range.
    let p = await plan('played 3 grand finals');
    expect(p.grain).toBe('player_career');
    expect(p.careerConditions).toEqual([]);
    expect(p.careerPredicates).toContainEqual({ builder: 'grand_finals_played_min', params: { times: '3' } });

    p = await plan('played in 3 or more preliminary finals');
    expect(p.careerPredicates).toContainEqual({ builder: 'prelim_finals_played_min', params: { times: '3' } });

    p = await plan('at least 1 preliminary final');
    expect(p.careerPredicates).toContainEqual({ builder: 'prelim_finals_played_min', params: { times: '1' } });
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
  it('coaching questions are no longer declined as unsupported (AFLDB-ISSUE-152 F2)', async () => {
    // The old rule claimed AFLDB held no coaching data at all, which
    // stopped being true at migration 087. It is deleted, not softened.
    const result = await parse('who coached richmond to the 2017 premiership');
    expect(result.status).not.toBe('unanswerable');
    expect(result.status).toBe('plan');
    if (result.status === 'plan') expect(result.plan.grain).toBe('coach_record');
  });

  it('streak questions are parsed', async () => {
    const p = await plan("richmond's longest winning streak");
    expect(p.grain).toBe('team_streak');
    expect(p.streakDefinition).toEqual({ kind: 'win' });
    expect(p.agg).toEqual({ kind: 'max' });
    expect(p.scope.clubFor?.name).toBe('Richmond');
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
  ])('%s declines as an unsupported NL statistic', async (question) => {
    const result = await parse(question);
    expect(result.status).toBe('unanswerable');
    if (result.status === 'unanswerable') expect(result.topic).toBe('rebound 50s');
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

describe('16. marquee matches, rivalries and debut windows (parser v15)', () => {
  it('played on anzac day -> match_event_min with the exact tagged value', async () => {
    const p = await plan('players who played on anzac day');
    expect(p.grain).toBe('player_career');
    expect(p.careerPredicates).toContainEqual({ builder: 'match_event_min', params: { event: 'Anzac Day', times: '1' } });
    expect(p.agg).toEqual({ kind: 'list' });
    expect(validatePlan(p)).not.toHaveProperty('error');
  });

  it('3+ anzac day games reads the count', async () => {
    const p = await plan('players who played in 3+ anzac day games');
    expect(p.careerPredicates).toContainEqual({ builder: 'match_event_min', params: { event: 'Anzac Day', times: '3' } });
  });

  it("king's birthday survives canonicalisation to the exact match_event value", async () => {
    const p = await plan("players who played in a king's birthday game");
    expect(p.careerPredicates).toContainEqual({ builder: 'match_event_min', params: { event: "King's Birthday", times: '1' } });
    expect(validatePlan(p)).not.toHaveProperty('error');
  });

  it('dreamtime at the g is the fixture, not the MCG venue', async () => {
    const p = await plan('players who have played dreamtime at the g');
    expect(p.scope.venue).toBeUndefined();
    expect(p.careerPredicates).toContainEqual({ builder: 'match_event_min', params: { event: "Dreamtime at the 'G", times: '1' } });
  });

  it('played in 3 showdowns -> matchup_played_min with both organizations resolved', async () => {
    const p = await plan('players who played in 3 showdowns');
    expect(p.grain).toBe('player_career');
    expect(p.careerPredicates).toContainEqual({
      builder: 'matchup_played_min',
      params: { clubA: '5', clubB: '6', times: '3' },
    });
    expect(validatePlan(p)).not.toHaveProperty('error');
  });

  it('a number word counts too: two showdowns', async () => {
    const p = await plan('players who played in two showdowns');
    expect(p.careerPredicates[0]?.params.times).toBe('2');
  });

  it('a rivalry whose clubs are not in the directory declines instead of guessing', async () => {
    // The fixture directory has no Sydney or GWS, so the phrase cannot
    // resolve; its words stay leftover and the question declines.
    const result = await parse('players who played in a sydney derby');
    expect(result.status).toBe('none');
  });

  it('most anzac day games declines -- the count is the ranked subject', async () => {
    const result = await parse('most anzac day games');
    expect(result.status).toBe('none');
  });

  it('a marquee predicate alongside a season range declines rather than dropping the seasons', async () => {
    const result = await parse('players who played on anzac day since 2000');
    expect(result.status).toBe('none');
  });

  it('debuted in the 1990s -> debuted_between with the decade as the parameter', async () => {
    const p = await plan('players who debuted in the 1990s');
    expect(p.grain).toBe('player_career');
    expect(p.careerPredicates).toContainEqual({ builder: 'debuted_between', params: { from: '1990', to: '1999' } });
    expect(p.agg).toEqual({ kind: 'list' });
    expect(validatePlan(p)).not.toHaveProperty('error');
  });

  it('debuted between 2000 and 2009 -> the explicit range', async () => {
    const p = await plan('players who debuted between 2000 and 2009');
    expect(p.careerPredicates).toContainEqual({ builder: 'debuted_between', params: { from: '2000', to: '2009' } });
  });

  it('played their first career game during the 1990s -> the same predicate', async () => {
    const p = await plan('players who played their first career game during the 1990s');
    expect(p.careerPredicates).toContainEqual({ builder: 'debuted_between', params: { from: '1990', to: '1999' } });
  });

  it('a debut window composes with a career condition', async () => {
    const p = await plan('players who debuted in the 1990s with 300 games');
    expect(p.careerPredicates).toContainEqual({ builder: 'debuted_between', params: { from: '1990', to: '1999' } });
    expect(p.careerConditions).toContainEqual({ kind: 'column', column: 'games', op: 'gte', value: 300 });
    expect(validatePlan(p)).not.toHaveProperty('error');
  });

  it('debuted in a grand final still reads as a boundary, not a debut window', async () => {
    const p = await plan('players who debuted in a grand final');
    expect(p.boundary).toEqual({ event: 'debut', where: 'grand_final' });
    expect(p.careerPredicates).toEqual([]);
  });
});

// ------------------------------------------------- coaching (ISSUE-152 B)

describe('coaching questions (AFLDB-ISSUE-152 Phase B)', () => {
  it('a coach cue elects the coach_record grain, and an unranked club question is a list', async () => {
    const p = await plan('who coached richmond');
    expect(p.grain).toBe('coach_record');
    expect(p.metric).toBeNull();
    expect(p.agg).toEqual({ kind: 'list' });
    expect(p.scope.clubFor?.name).toBe('Richmond');
    expect(validatePlan(p)).not.toHaveProperty('error');
  });

  it('"how many coaches has richmond had" is a count, not a ranking', async () => {
    const p = await plan('how many coaches has richmond had');
    expect(p.grain).toBe('coach_record');
    expect(p.agg).toEqual({ kind: 'count' });
    expect(validatePlan(p)).not.toHaveProperty('error');
  });

  it('a coach name resolves from the coach directory, never as a player', async () => {
    const p = await plan('damien hardwick coaching record');
    expect(p.grain).toBe('coach_record');
    expect(p.coach).toEqual({
      id: 17, slug: 'damien-hardwick', name: 'Damien Hardwick', playerId: 900, playerSlug: 'damien-hardwick',
    });
    expect(p.player).toBeUndefined();
    expect(p.scope.clubFor).toBeUndefined();
  });

  it('a whole career and a record at one club are different plans', async () => {
    const career = await plan('damien hardwick coaching record');
    const atClub = await plan('damien hardwick coaching record at richmond');
    expect(career.scope.clubFor).toBeUndefined();
    expect(atClub.scope.clubFor?.name).toBe('Richmond');
    expect(atClub.coach?.id).toBe(17);
  });

  it('a coach-only person carries no player link', async () => {
    const p = await plan('cliff rankin coaching record');
    expect(p.coach?.playerId).toBeNull();
    expect(p.coach?.playerSlug).toBeNull();
  });

  it('"players coached by X" is a player question, answered by the coached_by predicate', async () => {
    const p = await plan('players coached by damien hardwick');
    expect(p.grain).toBe('player_career');
    expect(p.careerPredicates).toContainEqual({ builder: 'coached_by', params: { coach: '17' } });
    expect(p.coach).toBeUndefined();
  });

  it('"premiership coaches" is a player predicate, NOT the coach-grain premierships metric', async () => {
    const p = await plan('premiership coaches');
    expect(p.grain).toBe('player_career');
    expect(p.careerPredicates).toContainEqual({ builder: 'premiership_coach', params: {} });
  });

  it('"coaches with the most premierships" is the coach-grain metric, NOT the player predicate', async () => {
    // D3: the two questions have different answers and must not collapse.
    const p = await plan('coaches with the most premierships');
    expect(p.grain).toBe('coach_record');
    expect(p.metric).toBe('premierships');
    expect(p.agg).toEqual({ kind: 'max' });
    expect(p.careerPredicates).toEqual([]);
  });

  it('reads each coaching metric word behind the cue', async () => {
    expect((await plan('which coach has coached the most games')).metric).toBe('games');
    expect((await plan('which coach has the most wins')).metric).toBe('wins');
    expect((await plan('which coach has coached the most grand finals')).metric).toBe('grand_finals');
    expect((await plan('which coach has coached the most finals')).metric).toBe('finals');
    expect((await plan('which coach has the most seasons in charge')).metric).toBe('seasons');
  });

  it('a coaching threshold becomes the grain\'s own metricCondition and lists qualifiers', async () => {
    const p = await plan('richmond coaches with 100+ wins');
    expect(p.grain).toBe('coach_record');
    expect(p.metric).toBe('wins');
    expect(p.metricCondition).toEqual({ op: 'gte', value: 100 });
    expect(p.agg).toEqual({ kind: 'list' });
    expect(p.careerConditions).toEqual([]);
    expect(validatePlan(p)).not.toHaveProperty('error');
  });

  it('"coached more than one club" counts organizations, not raw club identities', async () => {
    const p = await plan('coaches who have coached more than one club');
    expect(p.metric).toBe('organizations');
    expect(p.metricCondition).toEqual({ op: 'gt', value: 1 });
  });

  it('a top-N count belongs to the aggregation, never to the metric', async () => {
    const p = await plan('top 5 coaches by premierships');
    expect(p.agg).toEqual({ kind: 'top_n', n: 5 });
    expect(p.metricCondition).toBeUndefined();
  });

  it('a win-percentage ranking carries the 50-game qualifier by default', async () => {
    const p = await plan('best coaching win percentage');
    expect(p.metric).toBe('win_pct');
    expect(p.coachQualifier).toEqual({ minGames: 50 });
    expect(validatePlan(p)).not.toHaveProperty('error');
  });

  it('a reader-stated minimum is honoured instead of the default', async () => {
    const p = await plan('coaches with at least 100 games best win percentage');
    expect(p.metric).toBe('win_pct');
    expect(p.coachQualifier).toEqual({ minGames: 100 });
  });

  it('"no minimum" refuses rather than ranking a one-game sample', async () => {
    const p = await plan('best coaching win percentage no minimum');
    expect(p.coachQualifier).toBeUndefined();
    expect(validatePlan(p)).toHaveProperty('error');
  });

  it('a season before 1902 is refused by the coaching coverage floor', async () => {
    const p = await plan('who coached carlton in 1899');
    const validated = validatePlan(p);
    expect(validated).toHaveProperty('error');
    if ('error' in validated) expect(validated.error).toMatch(/coaching records begin in 1902/);
  });

  it('a season inside coverage is answered, and a future season is left to the empty result', async () => {
    expect(validatePlan(await plan('who coached richmond in 2017'))).not.toHaveProperty('error');
    expect(validatePlan(await plan('who coached richmond in 2030'))).not.toHaveProperty('error');
  });

  it('an ambiguous coach surname declines rather than picking one of two real people', async () => {
    const result = await parse('pannam coaching record');
    expect(result.status).not.toBe('plan');
  });

  it('a per-season coaching split declines rather than answering the all-time total', async () => {
    const result = await parse('most wins in a season by a coach');
    expect(result.status).toBe('none');
    expect(result.report.notes.join(' ')).toMatch(/per-season coaching splits/);
  });

  it('"Richmond players coached by X" declines: no builder owns the club (ISSUE-110 ownership)', async () => {
    const p = await plan('richmond players coached by damien hardwick');
    expect(validatePlan(p)).toHaveProperty('error');
  });

  it('an absent coach directory declines rather than half-resolving a coaching question', async () => {
    const noCoaches: NlParseContext = { clubs: CLUBS, venues: VENUES, resolvePlayer: fakeResolvePlayer };
    const result = await parseNlQuestion('damien hardwick coaching record', noCoaches);
    expect(result.status).not.toBe('plan');
  });

  describe('no coach cue: every pre-Phase-B reading is unchanged', () => {
    it('"most wins" stays a career question', async () => {
      const p = await plan('most wins');
      expect(p.grain).toBe('player_career');
      expect(p.metric).toBe('wins');
    });

    it('"most games" stays a career question', async () => {
      const p = await plan('most games');
      expect(p.grain).toBe('player_career');
      expect(p.metric).toBe('games');
    });

    it('"richmond most wins in a season" stays a club-season question', async () => {
      const p = await plan('richmond most wins in a season');
      expect(p.grain).toBe('club_season');
      expect(p.metric).toBe('wins');
    });

    it('"most premierships" stays a career question', async () => {
      const p = await plan('most premierships');
      expect(p.grain).toBe('player_career');
      expect(p.metric).toBe('premierships');
    });
  });
});

describe('after-the-siren questions (AFLDB-ISSUE-152 Phase C)', () => {
  it('the cue is required: "most goals" alone is still a career-goals ranking', async () => {
    const p = await plan('most goals');
    expect(p.grain).toBe('player_career');
    expect(p.metric).toBe('goals');
  });

  /**
   * R0/§15.4's load-bearing precedence rule. Before Phase C the metric
   * extractor claimed "goals" and only the confidence gate's unresolved
   * penalty on the leftover "after siren" tokens stopped a career-goals
   * leaderboard being returned. Once the cue consumes those tokens the
   * penalty is gone, so "goals" MUST be claimed as the kickScored
   * dimension first.
   */
  it('"goals" is claimed as the kickScored dimension, never as the career goals metric', async () => {
    const p = await plan('who has kicked the most goals after the siren');
    expect(p.grain).toBe('after_siren');
    expect(p.metric).toBe('siren_kicks');
    expect(p.afterSiren).toEqual({ subject: 'player', kickScored: 'goal' });
    expect(p.agg).toEqual({ kind: 'max' });
    expect(validatePlan(p)).not.toHaveProperty('error');
  });

  it('a bare "kicks after the siren" carries NO kickScored: any kick, including a miss', async () => {
    const p = await plan('most kicks after the siren');
    expect(p.grain).toBe('after_siren');
    expect(p.afterSiren?.kickScored).toBeUndefined();
    expect(p.afterSiren?.subject).toBe('player');
  });

  it('a goal after the siren and a goal after the siren TO WIN are different plans', async () => {
    const goal = await plan('goals after the siren');
    const toWin = await plan('goals after the siren to win');
    expect(goal.afterSiren).toEqual({ subject: 'event', kickScored: 'goal' });
    expect(toWin.afterSiren).toEqual({ subject: 'event', kickScored: 'goal', kickEffect: 'won' });
  });

  it('"to draw" is the drew effect, distinct from the drawn-match result', async () => {
    const p = await plan('behinds after the siren to draw');
    expect(p.afterSiren).toEqual({ subject: 'event', kickScored: 'behind', kickEffect: 'drew' });
  });

  it('the kicker result is read BEFORE the effect, so "and lost" is never an effect', async () => {
    const p = await plan('missed after the siren and lost');
    expect(p.afterSiren).toEqual({ subject: 'event', kickScored: 'none', kickerResult: 'loss' });
    expect(p.afterSiren?.kickEffect).toBeUndefined();
  });

  it('"and won" is the kicker result, not the winning-kick effect', async () => {
    const p = await plan('missed after the siren and won');
    expect(p.afterSiren).toEqual({ subject: 'event', kickScored: 'none', kickerResult: 'win' });
  });

  it('occurrence words elect first / most recent, at event subject', async () => {
    const first = await plan('the first goal after the siren');
    expect(first.afterSiren).toEqual({ subject: 'event', kickScored: 'goal', occurrence: 'first' });
    expect(first.agg).toEqual({ kind: 'list' });

    const latest = await plan('the most recent goal after the siren');
    expect(latest.afterSiren).toEqual({ subject: 'event', kickScored: 'goal', occurrence: 'most_recent' });
  });

  it('a count cue is an event count, never a player leaderboard', async () => {
    const p = await plan('how many goals after the siren');
    expect(p.grain).toBe('after_siren');
    expect(p.agg).toEqual({ kind: 'count' });
    expect(p.afterSiren?.subject).toBe('event');
  });

  it('an unranked question is an event list, not a rank-one leader', async () => {
    const p = await plan('goals after the siren for richmond');
    expect(p.agg).toEqual({ kind: 'list' });
    expect(p.afterSiren?.subject).toBe('event');
    expect(p.scope.clubFor?.name).toBe('Richmond');
  });

  it('the opponent role is the kicked-against club', async () => {
    const p = await plan('goals after the siren against richmond');
    expect(p.scope.clubAgainst?.name).toBe('Richmond');
    expect(p.scope.clubFor).toBeUndefined();
  });

  it('a named player takes the event subject: his events, not a leaderboard of one', async () => {
    const p = await plan('barry hall goals after the siren');
    expect(p.grain).toBe('after_siren');
    expect(p.player?.id).toBe(1001);
    expect(p.afterSiren?.subject).toBe('event');
    expect(validatePlan(p)).not.toHaveProperty('error');
  });

  /**
   * The explicit inversion of the Phase B rule: for coaching, "finals" was
   * a METRIC and had to be claimed before extractMatchType. Here finals is
   * genuine match SCOPE (D4), so the after-siren block must LEAVE it.
   */
  it('leaves "finals" for match-type extraction rather than claiming it', async () => {
    const p = await plan('goals after the siren in the finals');
    expect(p.grain).toBe('after_siren');
    expect(p.scope.matchType).toBe('finals');
    expect(validatePlan(p)).not.toHaveProperty('error');
  });

  it('combines finals, club lineage and a season range at player subject', async () => {
    const p = await plan('who has kicked the most goals after the siren for richmond in the finals since 2000');
    expect(p.grain).toBe('after_siren');
    expect(p.afterSiren).toEqual({ subject: 'player', kickScored: 'goal' });
    expect(p.scope.clubFor?.name).toBe('Richmond');
    expect(p.scope.matchType).toBe('finals');
    expect(p.scope.seasonMin).toBe(2000);
    expect(validatePlan(p)).not.toHaveProperty('error');
  });

  it('a coaching cue and a siren cue together fail closed', async () => {
    const parsed = await parse('which coach won most games on a goal after the siren');
    expect(parsed.status).toBe('none');
    if (parsed.status === 'none') expect(parsed.reason).toBe('unrecognised');
  });

  it('a bare "siren" with nothing else declines', async () => {
    const parsed = await parse('siren');
    expect(parsed.status).toBe('none');
  });

  // ------------------------------------------------- §15.14 decline table

  it.each([
    ['C-D1  round scope', 'goals after the siren in round 1'],
    ['C-D2  venue', 'goals after the siren at the mcg'],
    ['C-D3  matchup', 'richmond v carlton after the siren'],
    ['C-D4  coach + siren', 'which coach won most games on a goal after the siren'],
    ['C-D5  min', 'fewest kicks after the siren'],
    ['C-D6  coverage floor', 'goals after the siren in 1900'],
    ['C-D7  per-season grain', 'most goals after the siren in a season'],
    ['C-D8  siren subtype', 'goals after the siren in extra time'],
    ['C-D9  shot detail', 'who kicked it out on the full after the siren'],
    ['C-D10 source scores', 'how much did they win by after the siren'],
    ['C-D11 competition name', 'goals after the siren in the nab cup'],
    ['C-D13 cross-grain', '300 game players who kicked a goal after the siren'],
    ['C-D14 supergoal', 'was it a supergoal after the siren'],
    ['C-D15 out of family', 'did the siren sound before the kick'],
  ])('%s declines or fails validation', async (_label, question) => {
    const parsed = await parse(question);
    if (parsed.status !== 'plan') return;
    expect(validatePlan(parsed.plan), question).toHaveProperty('error');
  });
});

/**
 * AFLDB-ISSUE-152 Phase E: the first-kick-goal family closes its two gaps.
 *
 * E1-E6 already worked and are covered by §14/§15 above; nothing here
 * re-tests them except where a Phase E wording has to leave them alone.
 * What is new is E7 ("a goal with each of their first three kicks") and
 * E8 ("whose first-kick goal was their only career goal") -- two builders
 * the grid solver has always had and the parser could never reach.
 *
 * E8 was not a decline before it was a MISREAD: the tail "only career
 * goal" survived step 5a, and extractPlayerMetric read "goal" as the
 * question's ranking subject. `metric === null` is therefore asserted on
 * every E8 wording, not just the predicate.
 */
describe('first-kick-goal closure (AFLDB-ISSUE-152 Phase E)', () => {
  function builders(p: NlQueryPlan): string[] {
    return p.careerPredicates.map((axis) => axis.builder);
  }

  // ------------------------------------------------------------ E7 (R1)

  describe('E7 — a goal with each of their first N kicks', () => {
    it.each([
      ['word numeral', 'players who kicked a goal with each of their first three kicks', '3'],
      ['bare numeral', 'players who kicked goals with their first 3 kicks', '3'],
      ['each of the', 'players who kicked a goal with each of the first two kicks', '2'],
      ['verb form', 'players who goaled with each of their first four kicks', '4'],
      ['scored form', 'players who scored with each of their first six kicks', '6'],
      ['subject form', 'players whose first three kicks were all goals', '3'],
    ])('%s -> first_kick_goal_consecutive_min with the exact bound', async (_label, question, kicks) => {
      const p = await plan(question);
      expect(p.grain).toBe('player_career');
      expect(builders(p)).toEqual(['first_kick_goal_consecutive_min']);
      expect(p.careerPredicates[0].params).toEqual({ kicks });
      // The whole span is consumed, so neither "goal" nor "kicks" nor the
      // numeral survives for the metric extractors to claim.
      expect(p.metric).toBeNull();
      expect(p.careerConditions).toEqual([]);
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    // E-D3: the column is NOT NULL DEFAULT 1 CHECK (>= 1), so ">= 1" is
    // exactly the whole family. N = 1 must therefore produce the plain
    // builder, whose label reads correctly, not a redundant bound.
    it('N = 1 is the plain family, not a consecutive bound', async () => {
      const p = await plan('players who kicked a goal with their first one kick');
      expect(builders(p)).toEqual(['first_kick_goal_player']);
    });

    it('leaves the base wording exactly as it was', async () => {
      const p = await plan('players who kicked a goal with their first kick');
      expect(builders(p)).toEqual(['first_kick_goal_player']);
    });
  });

  // ------------------------------------------------------------ E8 (R2)

  describe('E8 — the first-kick goal was their only career goal', () => {
    it.each([
      'players whose first-kick goal was their only career goal',
      'players whose first kick goal was their only goal',
      'players who kicked a goal with their first kick and never kicked another goal',
      'players who goaled with their first kick and never scored again',
    ])('%s -> first_kick_goal_only_career_goal, with no metric misread', async (question) => {
      const p = await plan(question);
      expect(p.grain).toBe('player_career');
      expect(builders(p)).toEqual(['first_kick_goal_only_career_goal']);
      // The defect this closes: "goal" left in the text became the ranking
      // subject and the question answered a career-goals leaderboard.
      expect(p.metric).toBeNull();
      expect(p.careerConditions).toEqual([]);
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    // The cue owns its own negation, exactly as clubs_without does. Without
    // this the existing guard would read "never kicked another goal" as a
    // polarity inversion of the whole family and decline a question the
    // engine now answers exactly.
    it('the E8 cue owns the negation it contains', async () => {
      const p = await plan('players who never kicked another goal after their first-kick goal');
      expect(builders(p)).toEqual(['first_kick_goal_only_career_goal']);
    });
  });

  // -------------------------------------------------- composition (R3)

  describe('composition with the scoped builders', () => {
    it('club + E7 -> the club is owned by first_kick_goal_for_club', async () => {
      const p = await plan('carlton players who kicked a goal with each of their first three kicks');
      expect(builders(p)).toEqual(['first_kick_goal_for_club', 'first_kick_goal_consecutive_min']);
      expect(p.careerPredicates[0].params.club).toBe('2');
      expect(p.careerPredicates[1].params.kicks).toBe('3');
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('season range + E7 -> the range is owned by first_kick_goal_between', async () => {
      const p = await plan('players who kicked a goal with each of their first two kicks in the 1940s');
      expect(builders(p)).toEqual(['first_kick_goal_between', 'first_kick_goal_consecutive_min']);
      expect(p.careerPredicates[0].params).toEqual({ from: '1940', to: '1949' });
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('club + season + E8 -> all three, in a stable order', async () => {
      const p = await plan('carlton players since 2000 whose first-kick goal was their only career goal');
      expect(builders(p)).toEqual([
        'first_kick_goal_for_club', 'first_kick_goal_between', 'first_kick_goal_only_career_goal',
      ]);
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('a named player keeps the pin and the modifier together', async () => {
      const p = await plan('did dustin martin kick a goal with each of his first two kicks');
      expect(p.player?.name).toBe('Dustin Martin');
      expect(builders(p)).toEqual(['first_kick_goal_consecutive_min']);
      expect(validatePlan(p)).not.toHaveProperty('error');
    });
  });

  // ------------------------------------------------ the decline table (R4)

  describe('§17.7 declines', () => {
    it.each([
      ['E-DEC-1  kick-level (E9)', 'players who never kicked the ball again after their first-kick goal'],
      ['E-DEC-1b kick-level (E9)', 'players with a first-kick goal who never had another kick'],
      ['E-DEC-3  polarity inversion', 'players who never kicked a goal with each of their first three kicks'],
      ['E-DEC-4  summary + E7', 'which club has had the most players goal with each of their first three kicks'],
      ['E-DEC-5  summary + E8', 'by decade players whose first-kick goal was their only career goal'],
      ['E-DEC-8  N = 0', 'players who kicked a goal with each of their first 0 kicks'],
      ['E-DEC-8b N negative', 'players who kicked a goal with each of their first -2 kicks'],
      ['E-DEC-8c N absurd', 'players who kicked a goal with each of their first 40 kicks'],
      ['E-DEC-2  kickless matches (E9)', 'kickless matches before a first kick'],
      ['E-DEC-9  bare decade', 'players who kicked a goal with each of their first three kicks this decade'],
    ])('%s declines rather than answering something narrower', async (_label, question) => {
      const parsed = await parse(question);
      expect(parsed.status, question).toBe('none');
    });

    it.each([
      ['E-DEC-6  venue', 'players who kicked a goal with each of their first three kicks at the mcg'],
      ['E-DEC-6b opponent', 'players who kicked a goal with each of their first three kicks against collingwood'],
      ['E-DEC-6c match type', 'players who kicked a goal with each of their first three kicks in a grand final'],
      ['E-DEC-10 club + decade + venue', 'carlton players who kicked a goal with their first kick in the 1940s at the mcg'],
    ])('%s is rejected rather than silently unscoped', async (_label, question) => {
      const parsed = await parse(question);
      if (parsed.status !== 'plan') return;
      expect(validatePlan(parsed.plan), question).toHaveProperty('error');
    });

    // E-DEC-2 and E-DEC-11 are not this family and have no vocabulary of
    // their own. What matters is only that neither can reach a
    // first-kick-goal builder; whatever else the parser makes of them is
    // pre-existing behaviour this phase does not change.
    it.each([
      ['E-DEC-2b kickless matches', 'players who did not record a kick in their first two games'],
      ['E-DEC-11 kicks before first goal', 'how many kicks did dustin martin have before his first goal'],
    ])('%s never reaches this family', async (_label, question) => {
      const parsed = await parse(question);
      if (parsed.status !== 'plan') return;
      expect(builders(parsed.plan).filter((b) => b.startsWith('first_kick_goal')), question).toEqual([]);
    });
  });

  // ------------------------------------------------------------ boundaries

  it('the after-siren suppression still wins over step 5a', async () => {
    // "the first kick after the siren" contains this family's noun and is
    // a corpus row of Phase C's own. The siren reading must keep it.
    const p = await plan('the first kick after the siren');
    expect(p.grain).toBe('after_siren');
    expect(builders(p)).toEqual([]);
  });

  it('leaves the summary grain untouched when no modifier is present', async () => {
    const p = await plan('first kick goal players by decade');
    expect(p.grain).toBe('achievement_summary');
    expect(p.achievementSummary?.kind).toBe('by_decade');
  });
});

/**
 * AFLDB-ISSUE-152 Phase D. Family relationships, in the half of the
 * family that has a witness in the data.
 *
 * Red-before-green: every question below declined before this phase --
 * recorded in full by the Stage-0 probe, 31 of 31 NONE. The declines at
 * the end of this block declined then and must keep declining now, which
 * is the harder half: the supported cues share their words with the
 * blocked ones ("a twin brother" contains "a brother", "father-son
 * selections" contains both "father" and "son").
 */
describe('family relationships (AFLDB-ISSUE-152 Phase D)', () => {
  function builders(p: NlQueryPlan): string[] {
    return p.careerPredicates.map((axis) => axis.builder);
  }

  // ------------------------------------------------------------------ C2

  describe('C2 -- a brother who played (has_brother, reused unchanged)', () => {
    it.each([
      'which players had a brother who played AFL',
      'players with a brother who also played VFL/AFL',
      'which AFL players had brothers who played',
    ])('%s -> the label-backed has_brother predicate', async (question) => {
      const p = await plan(question);
      expect(p.grain).toBe('player_career');
      expect(builders(p)).toEqual(['has_brother']);
      expect(p.metric).toBeNull();
      expect(p.agg).toEqual({ kind: 'list' });
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('composes with a career ranking rather than replacing it', async () => {
      const p = await plan('most games by a player with a brother who played AFL');
      expect(p.grain).toBe('player_career');
      expect(p.metric).toBe('games');
      expect(p.agg).toEqual({ kind: 'max' });
      expect(builders(p)).toEqual(['has_brother']);
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('a named player is a pinned yes/no, not a list of his brothers', async () => {
      const p = await plan('did Dustin Martin have a brother who played AFL');
      expect(p.player?.id).toBe(100);
      expect(p.relationshipSubject).toBeUndefined();
      expect(builders(p)).toEqual(['has_brother']);
      expect(validatePlan(p)).not.toHaveProperty('error');
    });
  });

  // ------------------------------------------------------------------ C3

  describe('C3 -- parent and child, typed by role', () => {
    it.each([
      'players who are the parent or child of another AFL player',
      'which AFL players are a parent and child',
    ])('%s -> the symmetric predicate', async (question) => {
      const p = await plan(question);
      expect(builders(p)).toEqual(['has_afl_parent_or_child']);
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('the father direction', async () => {
      const p = await plan('players whose father also played AFL');
      expect(builders(p)).toEqual(['has_afl_father']);
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('the son direction', async () => {
      const p = await plan('players whose son also played AFL');
      expect(builders(p)).toEqual(['has_afl_son']);
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('the two directions are different predicates, never one', async () => {
      const father = await plan('players whose father also played AFL');
      const son = await plan('players whose son also played AFL');
      expect(builders(father)).not.toEqual(builders(son));
    });
  });

  // ------------------------------------------------------------------ C4

  describe('C4 -- the relatives of one named player', () => {
    it('who are Dustin Martin’s brothers', async () => {
      const p = await plan("who are Dustin Martin's brothers");
      expect(builders(p)).toEqual(['brother_of_player']);
      expect(p.careerPredicates[0].params.player).toBe('100');
      // The named person is the OBJECT: pinning him would return him, or
      // nobody, instead of his brothers.
      expect(p.player).toBeUndefined();
      expect(p.relationshipSubject?.id).toBe(100);
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('brothers of Brent Harvey (the "of" wording)', async () => {
      const p = await plan('brothers of Brent Harvey');
      expect(builders(p)).toEqual(['brother_of_player']);
      expect(p.careerPredicates[0].params.player).toBe('2164');
      expect(p.relationshipSubject?.name).toBe('Brent Harvey');
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('who is Brent Harvey’s son', async () => {
      const p = await plan("who is Brent Harvey's son");
      expect(builders(p)).toEqual(['son_of_player']);
      expect(p.careerPredicates[0].params.player).toBe('2164');
      expect(p.relationshipSubject?.id).toBe(2164);
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('who is Cooper Harvey’s father', async () => {
      const p = await plan("who is Cooper Harvey's father");
      expect(builders(p)).toEqual(['father_of_player']);
      expect(p.careerPredicates[0].params.player).toBe('3048');
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('an ambiguous name fails closed rather than picking a Gary Ablett', async () => {
      const parsed = await parse('brothers of Gary Ablett');
      expect(parsed.status).toBe('none');
    });

    it('a name AFLDB cannot identify fails closed', async () => {
      const parsed = await parse('brothers of Some Unknown Person');
      expect(parsed.status).toBe('none');
    });
  });

  // ----------------------------------------------------------------- FS4

  describe('FS4 -- fathers of father-son selections (father_son_father, reused)', () => {
    it.each([
      'players whose son was selected under the father-son rule',
      'which players had a son drafted under the father-son rule',
      'fathers of father-son selections',
    ])('%s -> father_son_father', async (question) => {
      const p = await plan(question);
      expect(builders(p)).toEqual(['father_son_father']);
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('composes with a ranking', async () => {
      const p = await plan('which father-son fathers played the most games');
      expect(p.metric).toBe('games');
      expect(p.agg).toEqual({ kind: 'max' });
      expect(builders(p)).toEqual(['father_son_father']);
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('a father-side ranking with the rule spelled out', async () => {
      const p = await plan('most games by a father whose son was selected under the father-son rule');
      expect(p.metric).toBe('games');
      expect(builders(p)).toEqual(['father_son_father']);
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('a pinned father-side yes/no', async () => {
      const p = await plan('did Brent Harvey have a son selected under the father-son rule');
      expect(p.player?.id).toBe(2164);
      expect(builders(p)).toEqual(['father_son_father']);
      expect(validatePlan(p)).not.toHaveProperty('error');
    });
  });

  // ----------------------------------------------------------------- FS1

  /**
   * AFLDB-ISSUE-153 Stage 2. D8 is decided (operator decision Q1): wording
   * that names the RULE, a SELECTION, a DRAFT or a PICK -- and, under Q1a
   * option (a), "father-son" plus an explicit ROLE noun -- binds to
   * father_son_selections, the authoritative record. The son side gets
   * exactly the wording the father side already ships, and neither side
   * gets one the other is denied.
   *
   * These questions all declined at ISSUE-152 Phase F and are the flip
   * this stage owns. The block after them is the harder half: the
   * COLLECTIVE forms share every word with these and must still decline.
   */
  describe('FS1 -- selected under the father-son rule (father_son_selection)', () => {
    it.each([
      ['the rule itself', 'players selected under the father-son rule'],
      ['the selection noun', 'father-son selections'],
      ['picks', 'which players were father-son picks'],
      ['draftees', 'father-son draftees'],
      ['the role noun (Q1a), mirroring rel_024', 'father-son sons'],
    ])('%s -> father_son_selection', async (_label, question) => {
      const p = await plan(question);
      expect(p.grain).toBe('player_career');
      expect(builders(p)).toEqual(['father_son_selection']);
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    // Q1 consequence 3, the symmetry clause, made concrete: rel_024 is
    // pinned as answering on the father side, so its son-side mirror
    // answers too. This is the one place the two sides could have drifted.
    it('the son-side mirror of rel_024 ranks, exactly as the father side does', async () => {
      const p = await plan('which father-son sons played the most games');
      expect(p.metric).toBe('games');
      expect(p.agg).toEqual({ kind: 'max' });
      expect(builders(p)).toEqual(['father_son_selection']);
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('counts the qualifying set', async () => {
      const p = await plan('how many players were selected under the father-son rule');
      expect(p.agg).toEqual({ kind: 'count' });
      expect(builders(p)).toEqual(['father_son_selection']);
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    // The father side keeps its claim on wording that names it, even
    // though that wording also contains an FS1 cue.
    it('an FS1 cue never takes a question the FATHER side already owns', async () => {
      for (const question of [
        'fathers of father-son selections',
        'players whose son was selected under the father-son rule',
        'which father-son fathers played the most games',
      ]) {
        const p = await plan(question);
        expect(builders(p), question).toEqual(['father_son_father']);
      }
    });
  });

  // ------------------------------------- the D8 boundary, as narrowed

  describe('the COLLECTIVE father-son forms still decline (D8/Q1, ISSUE-153)', () => {
    it.each([
      ['bare players', 'father-son players'],
      ['pairs', 'father-son pairs'],
      ['duos', 'father-son duos'],
      ['families', 'father-son families'],
    ])('%s', async (_label, question) => {
      const parsed = await parse(question);
      expect(parsed.status, question).toBe('none');
    });

  });

  // ----------------------------------------------------------------- FS6

  /**
   * AFLDB-ISSUE-153 Stage 4. A distribution of the SELECTIONS, not a list
   * of the players -- a distinction that is worth 14 of the 17 clubs.
   */
  describe('FS6 -- the father-son selection distribution', () => {
    it.each([
      ['by club', 'father-son selections by club', 'by_club'],
      ['per club', 'father-son selections per club', 'by_club'],
      ['by year', 'father-son selections by year', 'by_draft_year'],
      ['by draft year', 'father-son selections by draft year', 'by_draft_year'],
    ])('%s', async (_label, question, kind) => {
      const p = await plan(question);
      expect(p.grain).toBe('achievement_summary');
      expect(p.fatherSonSummary).toEqual({ kind });
      // The distribution counts selections; it never carries a career
      // predicate, and it must never be read as a player ranking.
      expect(builders(p)).toEqual([]);
      expect(p.metric).toBeNull();
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    // The wrong answer this stage exists to prevent. Left in the text,
    // "by club" resolves to clubs_played -- how many clubs the player went
    // on to play for -- which is plausible, believable and not the
    // question. The cue is consumed before the metric extractor runs.
    it('"by club" is the selecting club, never the clubs_played metric', async () => {
      const p = await plan('father-son selections by club');
      expect(p.metric).not.toBe('clubs_played');
      expect(p.fatherSonSummary?.kind).toBe('by_club');
    });

    it('a scope the distribution cannot honour fails closed', async () => {
      const parsed = await parse('geelong father-son selections by year');
      expect(parsed.status).toBe('plan');
      if (parsed.status !== 'plan') return;
      expect(validatePlan(parsed.plan)).toHaveProperty('error');
    });

    // FS6 is a shape this one family has, not a grouping the parser now
    // offers every relationship.
    it('does not lend its grouping to any other relationship', async () => {
      const parsed = await parse('players with a brother who played by club');
      if (parsed.status === 'plan') expect(parsed.plan.fatherSonSummary).toBeUndefined();
    });
  });

  // ------------------------------------------------------------ FS2/FS3

  /**
   * AFLDB-ISSUE-153 Stage 3. father_son_selections is the only one of the
   * two father-son surfaces that carries a club or a date at all, so these
   * two scopes exist in this reading and nowhere else. Both are bound as
   * the builder's own parameters -- the ownership rule ISSUE-110 findings
   * A and B established -- so neither can be silently discarded.
   */
  describe('FS2/FS3 -- the selecting club and the draft year', () => {
    it('FS2: the club is the SELECTING club, and it is owned by the builder', async () => {
      const p = await plan('geelong father-son selections');
      expect(builders(p)).toEqual(['father_son_selection_for_club']);
      expect(p.careerPredicates[0].params).toEqual({ club: '4' });
      expect(p.scope.clubFor?.organizationId).toBe(4);
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('FS3: the year is a DRAFT year, owned by the builder and labelled as one', async () => {
      const p = await plan('father-son selections in 2022');
      expect(builders(p)).toEqual(['father_son_selection_between']);
      expect(p.careerPredicates[0].params).toEqual({ from: '2022', to: '2022' });
      expect(validatePlan(p)).not.toHaveProperty('error');
      // The plan panel is where a reader checks what was answered. 0 of
      // the 99 selected players debuted in their draft year, so a line
      // reading "Seasons: 2022-2022" would be wrong about every row.
      const lines = describePlan(p).join(' ');
      expect(lines).toContain('Draft years: 2022-2022');
      expect(lines).not.toContain('Seasons:');
    });

    it('both scopes compose, each owned by its own builder', async () => {
      const p = await plan('geelong father-son selections in 2022');
      expect(builders(p)).toEqual([
        'father_son_selection_for_club', 'father_son_selection_between',
      ]);
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    // The Stage 0 trap. A question that scopes a year AND talks about
    // playing is ambiguous between a draft year and a playing season, and
    // the two readings share not one row -- so the year is left unowned
    // and the ownership gate refuses the plan.
    it('a draft year mixed with a playing-season reading fails closed', async () => {
      const parsed = await parse('father-son selections who played in 2022');
      expect(parsed.status).toBe('plan');
      if (parsed.status !== 'plan') return;
      expect(builders(parsed.plan)).toEqual(['father_son_selection']);
      expect(parsed.plan.scope.seasonMin).toBe(2022);
      expect(validatePlan(parsed.plan)).toHaveProperty('error');
    });
  });

  // ------------------------------------------------------------------ X3

  /**
   * AFLDB-ISSUE-153 Stage 5, operator decision Q6. The Phase F in-reading
   * refusal blocked father-son wording of ANY kind inside a cross-domain
   * composition, which was wider than F-D1's own justification: it also
   * refused the FATHER side, whose wording ships and answers everywhere
   * else in the product. Narrowed to the bare and collective forms.
   *
   * Every Phase F freeze holds: conjunction not chronology, and a club
   * named on one side only still fails closed.
   */
  describe('X3 -- the father-son rule composed with actual coaching', () => {
    it('the son side composes', async () => {
      const p = await plan('players selected under the father-son rule who also coached');
      expect(builders(p)).toEqual(['has_coached', 'father_son_selection']);
      expect(p.agg).toEqual({ kind: 'list' });
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('the father side composes too — the 11 players the old guard also blocked', async () => {
      const p = await plan('players who were father-son fathers and also coached');
      expect(builders(p)).toEqual(['has_coached', 'father_son_father']);
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('the collective form still declines by name inside the composition', async () => {
      const parsed = await parse('which father-son players also coached');
      expect(parsed.status).toBe('none');
      expect(parsed.report.notes.join(' ')).toMatch(/what "father–son" means on its own/);
    });

    it('a club named on one side only still fails closed (F-D3)', async () => {
      const parsed = await parse('players selected under the father-son rule who also coached Geelong');
      expect(parsed.status).toBe('none');
    });

    it('the temporal readings are still refused by name (D9/F-D2)', async () => {
      for (const question of [
        'players selected under the father-son rule who later coached',
        'father-son selections who went on to coach',
      ]) {
        const parsed = await parse(question);
        expect(parsed.status, question).toBe('none');
      }
    });
  });

  // ---------------------------------------------------- out of scope

  describe('the relationship families with no builder decline by name', () => {
    it.each([
      ['sisters', 'which players had a sister who played'],
      ['twins', 'which players had a twin brother who played AFL'],
      ['cousins', 'which AFL players are cousins'],
      ['mothers', 'which players had a mother who played'],
      ['the family grain (D6)', 'biggest football families'],
      ['the family grain (D6)', 'which family has the most AFL players'],
      ['C5 families of N', 'families with three AFL players'],
      ['vague family wording', "who are Dustin Martin's family members"],
      ['vague relatedness', 'AFL players related to Phil Krakouer'],
      ['pairings, not players', 'parent and child pairs who both played AFL'],
    ])('%s', async (_label, question) => {
      const parsed = await parse(question);
      expect(parsed.status, question).toBe('none');
    });
  });

  // ------------------------------------------- ownership and collisions

  describe('composition beyond the relationship itself', () => {
    it('a count question counts the qualifying set', async () => {
      const p = await plan('how many players had a brother who played AFL');
      expect(p.agg).toEqual({ kind: 'count' });
      expect(builders(p)).toEqual(['has_brother']);
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('two relationships compose as two predicates, ANDed', async () => {
      const p = await plan('players with a brother and a father who played AFL');
      expect(builders(p)).toEqual(['has_brother', 'has_afl_father']);
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('a career threshold survives alongside a per-player relationship', async () => {
      // The ISSUE-110 shape: a condition the plan cannot honour must never
      // be silently dropped. Here it IS honoured, as a career condition.
      const p = await plan('brothers of Brent Harvey who played 100 games');
      expect(builders(p)).toEqual(['brother_of_player']);
      expect(p.careerConditions).toEqual([{ kind: 'column', column: 'games', op: 'gte', value: 100 }]);
      expect(validatePlan(p)).not.toHaveProperty('error');
    });
  });

  describe('scope this family cannot own is refused, never discarded', () => {
    it.each([
      ['a club', 'richmond players with a brother who played'],
      ['a season range', 'players with a brother who played since 2000'],
      ['a venue', 'players with a brother who played at the mcg'],
    ])('%s', async (_label, question) => {
      const parsed = await parse(question);
      if (parsed.status !== 'plan') return;
      expect(validatePlan(parsed.plan), question).toHaveProperty('error');
    });

    it('a season-grain ranking declines rather than dropping the relationship', async () => {
      const parsed = await parse('most goals in 2015 by a player with a brother who played');
      expect(parsed.status).toBe('none');
    });

    it('a surname that is also a relationship word is still a player', async () => {
      const p = await plan('most goals by ben cousins');
      expect(p.player?.name).toBe('Ben Cousins');
      expect(builders(p)).toEqual([]);
    });
  });
});

/**
 * AFLDB-ISSUE-152 Phase F. The cross-domain composition: one person who
 * both played and coached. The R0 probe recorded on the issue measured
 * that NONE of these wordings produced a plan under v38 -- and that one
 * of them ("played for Richmond and coached Collingwood") reached
 * validatePlan as a coach_record carrying an opponent, refused there
 * rather than answered.
 */
describe('played and also coached (AFLDB-ISSUE-152 Phase F)', () => {
  function builders(p: NlQueryPlan): string[] {
    return p.careerPredicates.map((axis) => axis.builder);
  }

  // ------------------------------------------------------------------ X1

  describe('X1 -- played and also coached', () => {
    it.each([
      'players who also coached',
      'which players both played and coached',
      'players who played and coached',
      'players who played vfl afl and also coached',
    ])('%s -> has_coached at career grain', async (question) => {
      const p = await plan(question);
      expect(p.grain).toBe('player_career');
      expect(builders(p)).toEqual(['has_coached']);
      expect(p.metric).toBeNull();
      expect(p.scope.clubFor).toBeUndefined();
      expect(p.crossDomainClubs).toBeUndefined();
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('"how many" is a count of the same population', async () => {
      const p = await plan('how many players have played and coached');
      expect(builders(p)).toEqual(['has_coached']);
      expect(p.agg).toEqual({ kind: 'count' });
    });

    it('a career metric ranks players WITHIN the composition', async () => {
      const p = await plan('most career games among players who also coached');
      expect(p.grain).toBe('player_career');
      expect(p.metric).toBe('games');
      expect(builders(p)).toEqual(['has_coached']);
      expect(validatePlan(p)).not.toHaveProperty('error');
    });
  });

  // ------------------------------------------------------------------ X2

  describe('X2 -- played for a club and also coached a club', () => {
    it.each([
      'players who played for richmond and also coached richmond',
      'who both played for and coached richmond',
      'richmond players who also coached richmond',
    ])('%s -> both clubs as builder parameters', async (question) => {
      const p = await plan(question);
      expect(p.grain).toBe('player_career');
      expect(builders(p)).toEqual(['played_for_club', 'coached_club']);
      expect(p.careerPredicates[0].params.club).toBe('1');
      expect(p.careerPredicates[1].params.club).toBe('1');
      // THE structural decision of this phase: no scope.clubFor, so the
      // compiler's generic playing-club filter can never be suppressed by
      // a coaching predicate.
      expect(p.scope.clubFor).toBeUndefined();
      expect(p.scope.clubAgainst).toBeUndefined();
      expect(p.crossDomainClubs?.played.name).toBe('Richmond');
      expect(p.crossDomainClubs?.coached.name).toBe('Richmond');
      expect(validatePlan(p)).not.toHaveProperty('error');
    });

    it('the asymmetric form binds two different organizations', async () => {
      const p = await plan('players who played for richmond and coached collingwood');
      expect(builders(p)).toEqual(['played_for_club', 'coached_club']);
      expect(p.careerPredicates[0].params.club).toBe('1');
      expect(p.careerPredicates[1].params.club).toBe('3');
      expect(p.crossDomainClubs?.played.name).toBe('Richmond');
      expect(p.crossDomainClubs?.coached.name).toBe('Collingwood');
      expect(validatePlan(p)).not.toHaveProperty('error');
    });
  });

  // ---------------------------------------------------- temporal declines

  describe('temporal wording declines by name, never silently stripped (D9/F-D2)', () => {
    it.each([
      'players who later coached richmond',
      'players who went on to coach',
      'players who became a coach',
      'players who played and then coached',
      'players who coached after they retired',
    ])('%s', async (question) => {
      const parsed = await parse(question);
      expect(parsed.status).toBe('none');
      expect(parsed.report.notes.join(' ')).toContain('does not record the order');
    });
  });

  // -------------------------------------------------- one-sided declines

  describe('a club on one side only declines (F-D3)', () => {
    it.each([
      'richmond players who also coached',
      'players who coached richmond and also played',
    ])('%s', async (question) => {
      const parsed = await parse(question);
      expect(parsed.status).toBe('none');
      expect(parsed.report.notes.join(' ')).toContain('must name the club on');
    });
  });

  // -------------------------------------------------- unsupported scope

  describe('scope neither builder owns is refused, never discarded', () => {
    it('an opponent declines at parse -- this reading clears clubAgainst', async () => {
      const parsed = await parse('players who played and also coached against carlton');
      expect(parsed.status).toBe('none');
      expect(parsed.report.notes.join(' ')).toContain('cannot also be scoped to an opponent');
    });

    it.each([
      ['a season', 'players who played and also coached in 1990'],
      ['a venue', 'players who played and also coached at the mcg'],
      ['a round', 'players who played and also coached in round 5'],
      ['a match type', 'players who played and also coached in finals'],
    ])('%s is refused at validatePlan', async (_label, question) => {
      const parsed = await parse(question);
      if (parsed.status !== 'plan') return;
      expect(validatePlan(parsed.plan), question).toHaveProperty('error');
    });
  });

  // ----------------------------------------------------- boundaries kept

  describe('the boundaries this phase does not move', () => {
    it('the son-side father-son composition is still deferred (F-D1)', async () => {
      const parsed = await parse('players selected under the father son rule who also coached');
      expect(parsed.status).toBe('none');
    });

    it('a coaching record is still a coaching record', async () => {
      const p = await plan('richmond coaching record');
      expect(p.grain).toBe('coach_record');
      expect(p.scope.clubFor?.name).toBe('Richmond');
    });

    it('coached_by is untouched', async () => {
      const p = await plan('players coached by damien hardwick');
      expect(builders(p)).toEqual(['coached_by']);
    });

    it('premiership_coach is untouched', async () => {
      const p = await plan('premiership coaches');
      expect(builders(p)).toEqual(['premiership_coach']);
    });

    it('"Richmond players coached by Damien Hardwick" still fails the ownership gate', async () => {
      const parsed = await parse('richmond players coached by damien hardwick');
      expect(parsed.status).toBe('plan');
      if (parsed.status !== 'plan') return;
      expect(validatePlan(parsed.plan)).toHaveProperty('error');
    });
  });
});
