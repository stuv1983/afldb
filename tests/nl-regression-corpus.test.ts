/**
 * The production regression corpus.
 *
 * Every case here comes from a real logged search in `nl_search_log`
 * during the first round of live beta testing, not from someone
 * imagining what a reader might type. That is the whole point of the
 * telemetry: a failure observed in production becomes a permanent test
 * before it becomes a fix, so the fix can never quietly regress.
 *
 * Each block names the issue it pins and, where the behaviour was wrong
 * rather than merely missing, what the wrong answer was -- because "115
 * points, not 1 point" is the kind of detail that makes a future reader
 * trust the assertion instead of loosening it.
 *
 * DB-free, same fake directory as nl-parser.test.ts. Where a case turns
 * on real data (the 303 players whose last game was a Grand Final) the
 * verification lives in SQL, not here; this file pins the PLAN, which is
 * the part the parser owns.
 */
import { describe, expect, it } from 'vitest';

import { parseNlQuestion, type NlParseContext, type NlPlayerCandidate } from '@/search/nl/parser';
import type { NlParse, NlQueryPlan } from '@/search/nl/plan';
import type { NlClubDirectoryEntry, NlVenueDirectoryEntry } from '@/search/nl/entities';

const CLUBS: NlClubDirectoryEntry[] = [
  { organizationId: 1, slug: 'richmond', name: 'Richmond', names: ['richmond', 'tigers'] },
  { organizationId: 2, slug: 'carlton', name: 'Carlton', names: ['carlton', 'blues'] },
  { organizationId: 3, slug: 'collingwood', name: 'Collingwood', names: ['collingwood', 'pies', 'magpies'] },
];

const VENUES: NlVenueDirectoryEntry[] = [
  { id: 1, slug: 'mcg', name: 'Melbourne Cricket Ground', names: ['mcg', 'melbourne cricket ground', 'the g'] },
];

const PLAYERS: Record<string, NlPlayerCandidate[]> = {
  'dustin martin': [{ ref: { id: 100, slug: 'dustin-martin', name: 'Dustin Martin' }, score: 1000 }],
  // "thomas" is both a surname and a first name, and prominence ranking
  // can put one Thomas 200+ points clear of the next -- the exact shape
  // that made the gap rule read a bare surname as certain (NL-018).
  thomas: [
    { ref: { id: 200, slug: 'thomas-hawkins', name: 'Thomas Hawkins' }, score: 900 },
    { ref: { id: 201, slug: 'dale-thomas', name: 'Dale Thomas' }, score: 600 },
  ],
  // Two Gary Abletts, both below PLAYER_ACCEPT_SCORE for a bare
  // surname: the resolver knows who they might be but will not commit.
  ablett: [
    { ref: { id: 300, slug: 'gary-ablett-snr', name: 'Gary Ablett Snr' }, score: 400 },
    { ref: { id: 301, slug: 'gary-ablett-jnr', name: 'Gary Ablett Jnr' }, score: 380 },
  ],
  // A unique surname: one real candidate plus a distant fuzzy match.
  // Must STAY certain -- surname-only is how readers actually type.
  pendlebury: [
    { ref: { id: 400, slug: 'scott-pendlebury', name: 'Scott Pendlebury' }, score: 900 },
    { ref: { id: 401, slug: 'pendleton-someone', name: 'John Pendleton' }, score: 250 },
  ],
};

const ctx: NlParseContext = {
  clubs: CLUBS,
  venues: VENUES,
  resolvePlayer: (name) => Promise.resolve(PLAYERS[name.toLowerCase()] ?? []),
};

async function plan(question: string): Promise<NlQueryPlan> {
  const result: NlParse = await parseNlQuestion(question, ctx);
  expect(result.status, `"${question}" -> ${result.status}, confidence ${
    result.report.confidence.toFixed(2)}, unsupported: [${result.report.unsupportedTerms.join(', ')}]`)
    .toBe('plan');
  return (result as Extract<NlParse, { status: 'plan' }>).plan;
}

async function declined(question: string): Promise<Extract<NlParse, { status: 'none' }>> {
  const result: NlParse = await parseNlQuestion(question, ctx);
  expect(result.status, `"${question}" -> ${result.status}; expected a decline`).toBe('none');
  return result as Extract<NlParse, { status: 'none' }>;
}

// ---------------------------------------------------------------------
// NL-001 -- "worst loss" selected the SMALLEST losing margin
// ---------------------------------------------------------------------
// Logged 2026-08-17: "Richmond worst loss to Carlton" answered a 1-point
// loss. Verified against the database, the true answer is the 115-point
// loss of 1984. The engine was not confused -- it confidently returned
// the exact opposite of the question, which is the most dangerous class
// of bug this project can ship, so every synonym is pinned.
describe('NL-001: "worst"/"biggest" loss both mean the LARGEST losing margin', () => {
  const phrasings = [
    'Richmond worst loss to Carlton',
    'Richmond biggest loss to Carlton',
    'Richmond heaviest loss to Carlton',
    'Richmond largest loss to Carlton',
    'Richmond worst defeat against Carlton',
  ];

  it.each(phrasings)('%s -> team_match / loss_margin / max', async (question) => {
    const p = await plan(question);
    expect(p.grain).toBe('team_match');
    expect(p.metric).toBe('loss_margin');
    expect(p.agg).toEqual({ kind: 'max' });
    expect(p.scope.clubFor?.name).toBe('Richmond');
    expect(p.scope.clubAgainst?.name).toBe('Carlton');
  });

  it('every phrasing produces the identical plan, not merely a similar one', async () => {
    const plans = await Promise.all(phrasings.map(plan));
    for (const p of plans.slice(1)) {
      expect({ ...p, }).toEqual({ ...plans[0] });
    }
  });

  // The counterweight: polarity must NOT be flipped for an ordinary
  // metric, where a bigger number really is better.
  it('"worst" still means minimum for a metric whose polarity is normal', async () => {
    const p = await plan('lowest score at the mcg');
    expect(p.agg).toEqual({ kind: 'min' });
    expect(p.metric).toBe('team_score');
  });

  it('a narrow loss is still a minimum', async () => {
    const p = await plan('Richmond smallest loss to Carlton');
    expect(p.metric).toBe('loss_margin');
    expect(p.agg).toEqual({ kind: 'min' });
  });
});

// ---------------------------------------------------------------------
// NL-003 / NL-004 -- Grand Final and finals TEAM-margin questions
// ---------------------------------------------------------------------
// All of these declined in production. The match type was recognised
// ("most goals in a Grand Final" worked throughout), but a bare "grand
// final" with no governing "in"/"during" was held back for the
// player_career reading of "finals" and left unconsumed.
describe('NL-004: bare "grand final"/"finals" is scope when a team-scoring word is present', () => {
  it.each([
    'biggest Grand Final win',
    'largest Grand Final win',
    'biggest Grand Final win since 2000',
  ])('%s -> team_match / win_margin / grand_final', async (question) => {
    const p = await plan(question);
    expect(p.grain).toBe('team_match');
    expect(p.metric).toBe('win_margin');
    expect(p.agg).toEqual({ kind: 'max' });
    expect(p.scope.matchType).toBe('grand_final');
  });

  it('biggest Grand Final win since 2000 keeps the season bound', async () => {
    const p = await plan('biggest Grand Final win since 2000');
    expect(p.scope.seasonMin).toBe(2000);
  });

  it('biggest finals win -> team_match, not a career finals tally', async () => {
    const p = await plan('biggest finals win');
    expect(p.grain).toBe('team_match');
    expect(p.metric).toBe('win_margin');
    expect(p.scope.matchType).toBe('finals');
  });

  // The distinction the reviewer specifically asked to encode, and the
  // half of it that matters most: "most finals wins" must NOT be dragged
  // into the team-match margin reading by the fix above. It falls out of
  // the singular/plural convention rather than a special case -- \bwin\b
  // matches "win" and not "wins".
  //
  // Asserted as "not misread" rather than "answered", because a
  // player-career "finals wins" metric does not exist in the vocabulary
  // at all: the question declines today, naming "wins" as unsupported.
  // Declining is the honest outcome for something AFLDB cannot compute,
  // and pinning the real behaviour is worth more than pinning an
  // aspiration -- if that metric is ever added, this test should be
  // tightened deliberately rather than discovered to have been lying.
  it('most finals wins is NOT captured as a team-match margin question', async () => {
    const result = await parseNlQuestion('most finals wins', ctx);
    if (result.status === 'plan') {
      expect(result.plan.metric).not.toBe('win_margin');
      expect(result.plan.grain).not.toBe('team_match');
    } else {
      // Current behaviour: declines, naming the plural as unsupported.
      expect(result.report.unsupportedTerms).toContain('wins');
    }
  });

  it('"most goals in a Grand Final" is unaffected -- it always worked', async () => {
    const p = await plan('most goals in a Grand Final');
    expect(p.grain).toBe('player_game');
    expect(p.metric).toBe('goals');
    expect(p.scope.matchType).toBe('grand_final');
  });
});

describe('NL-004: explicit margin phrasings', () => {
  it.each([
    ['highest winning margin in a GF', 'win_margin', 'grand_final'],
    ['highest winning margin in a Grand Final since 2000', 'win_margin', 'grand_final'],
    ['biggest losing margin in a final', 'loss_margin', 'finals'],
  ])('%s', async (question, metric, matchType) => {
    const p = await plan(question);
    expect(p.grain).toBe('team_match');
    expect(p.metric).toBe(metric);
    expect(p.scope.matchType).toBe(matchType);
  });
});

// ---------------------------------------------------------------------
// NL-005 -- "over" as an opponent relationship
// ---------------------------------------------------------------------
// Both clubs resolved with certainty 1.0; the single unconsumed word
// "over" was misread as a failed player-name guess and cost enough
// confidence to decline.
describe('NL-005: "over" reads as an opponent relationship before a club', () => {
  it.each([
    'Richmond biggest win over Carlton',
    'biggest win by Richmond over Carlton',
    'biggest win by Richmond over Carlton at the MCG',
  ])('%s', async (question) => {
    const p = await plan(question);
    expect(p.grain).toBe('team_match');
    expect(p.metric).toBe('win_margin');
    expect(p.scope.clubFor?.name).toBe('Richmond');
    expect(p.scope.clubAgainst?.name).toBe('Carlton');
  });

  it('matches the plan "versus" already produced', async () => {
    const withOver = await plan('Richmond biggest win over Carlton');
    const withVersus = await plan('Richmond biggest win versus Carlton');
    expect(withOver).toEqual(withVersus);
  });

  it('the venue survives alongside it', async () => {
    const p = await plan('biggest win by Richmond over Carlton at the MCG');
    expect(p.scope.venue?.name).toBe('Melbourne Cricket Ground');
  });

  // "over" before DIGITS is the comparison operator, and must stay one --
  // this is why the fix is contextual rather than a blanket stopword.
  it('"over N" is still a comparison, not an opponent', async () => {
    const p = await plan('players with over 200 games');
    expect(p.grain).toBe('player_career');
    expect(p.careerConditions).toContainEqual(
      expect.objectContaining({ column: 'games', op: 'gt', value: 200 }),
    );
    expect(p.scope.clubAgainst).toBeUndefined();
  });
});

// ---------------------------------------------------------------------
// NL-006 -- "leading goalkicker"
// ---------------------------------------------------------------------
// The metric resolved fine all along ("goalkicker" -> goals); the
// leftover "leading" was the whole problem. Fixed by recognising
// "leading"/"led" as what they are: aggregation words meaning max.
describe('NL-006: leading-goalkicker phrasings', () => {
  it.each([
    "Richmond's leading goalkicker in 2017",
    '2017 Richmond leading goalkicker',
    "who was Richmond's leading goalkicker in 2017",
    "who led Richmond's goalkicking in 2017",
  ])('%s -> goals / max / Richmond / 2017', async (question) => {
    const p = await plan(question);
    expect(p.metric).toBe('goals');
    expect(p.agg).toEqual({ kind: 'max' });
    expect(p.scope.clubFor?.name).toBe('Richmond');
    expect(p.scope.seasonMin).toBe(2017);
    expect(p.scope.seasonMax).toBe(2017);
  });

  it('agrees with the phrasing that already worked', async () => {
    const leading = await plan("Richmond's leading goalkicker in 2017");
    const explicit = await plan('most goals for Richmond in 2017');
    expect(leading.metric).toBe(explicit.metric);
    expect(leading.agg).toEqual(explicit.agg);
    expect(leading.scope.clubFor?.name).toBe(explicit.scope.clubFor?.name);
    expect(leading.scope.seasonMin).toBe(explicit.scope.seasonMin);
  });
});

// ---------------------------------------------------------------------
// Answered correctly in production -- pinned so they stay that way
// ---------------------------------------------------------------------
// These are the cases the live run got RIGHT. They are the more
// important half of a regression corpus: the fixes above all touch
// shared vocabulary, and this is what proves they cost nothing.
describe('production successes that must not regress', () => {
  it('single vs total for a named player against an opponent', async () => {
    const single = await plan('dusty most goals against Carlton');
    expect(single.mode).toBe('single');
    expect(single.player?.name).toBe('Dustin Martin');
    expect(single.scope.clubAgainst?.name).toBe('Carlton');

    const total = await plan('dusty total goals against Carlton');
    expect(total.mode).toBe('sum');
    expect(total.player?.name).toBe('Dustin Martin');
    expect(total.scope.clubAgainst?.name).toBe('Carlton');
  });

  it('the full four-dimension composition still composes', async () => {
    const p = await plan('top 5 disposal games by Richmond players in finals at the MCG');
    expect(p.grain).toBe('player_game');
    expect(p.metric).toBe('disposals');
    expect(p.agg).toEqual({ kind: 'top_n', n: 5 });
    expect(p.scope.clubFor?.name).toBe('Richmond');
    expect(p.scope.matchType).toBe('finals');
    expect(p.scope.venue?.name).toBe('Melbourne Cricket Ground');
  });

  it('Richmond biggest win against Carlton at the MCG', async () => {
    const p = await plan('Richmond biggest win against Carlton at the MCG');
    expect(p.grain).toBe('team_match');
    expect(p.metric).toBe('win_margin');
    expect(p.scope.clubFor?.name).toBe('Richmond');
    expect(p.scope.clubAgainst?.name).toBe('Carlton');
    expect(p.scope.venue?.name).toBe('Melbourne Cricket Ground');
  });

  it.each([
    'most goals by a Richmond player in 2017',
    'who kicked the most goals for Richmond in 2017',
    'Richmond player with most goals in 2017',
    'richmond 2017 most goals',
  ])('%s -- word order does not change the meaning', async (question) => {
    const p = await plan(question);
    expect(p.metric).toBe('goals');
    expect(p.scope.clubFor?.name).toBe('Richmond');
    expect(p.scope.seasonMin).toBe(2017);
  });

  it('bare-year season election', async () => {
    const p = await plan('most goals in 1900');
    expect(p.grain).toBe('player_season');
    expect(p.scope.seasonMin).toBe(1900);
    expect(p.scope.seasonMax).toBe(1900);
  });

  it('career boundary: last game was a Grand Final', async () => {
    // The 303-player result this produces was verified against the
    // database two independent ways (last_match_date join vs a
    // DISTINCT ON latest-match scan): both返 303, and last_match_date
    // disagrees with the real maximum on zero rows. The count is right.
    const p = await plan('players whose last game was a Grand Final');
    expect(p.grain).toBe('player_career');
    expect(p.boundary).toEqual({ event: 'last_game', where: 'grand_final' });
  });

  it('negative career condition', async () => {
    const p = await plan('most games without a premiership');
    expect(p.grain).toBe('player_career');
    expect(p.metric).toBe('games');
    expect(p.careerConditions).toContainEqual(
      expect.objectContaining({ column: 'premierships', op: 'eq', value: 0 }),
    );
  });
});

// ---------------------------------------------------------------------
// NL-010 -- "<stat>s game" was not the same idiom as "<stat> game"
// ---------------------------------------------------------------------
// From the 12,000-question stress run: the largest single cluster of
// declines, 1,887 rows, all one missing plural. STAT_GAMES_IDIOM_WORDS
// matched "goal game" but not "goals game", so METRIC_WORDS took "goals"
// and left "game" in the text, where the player-name scan swallowed it
// and reported an unsupported term of "dustin martin game".
describe('NL-010: the stat-games idiom accepts either noun pluralised', () => {
  it.each([
    'Dustin Martin highest goal game against Carlton',
    'Dustin Martin highest goals game against Carlton',
    'Dustin Martin highest goals games against Carlton',
  ])('%s', async (question) => {
    const p = await plan(question);
    expect(p.grain).toBe('player_game');
    expect(p.mode).toBe('single');
    expect(p.metric).toBe('goals');
    expect(p.player?.name).toBe('Dustin Martin');
    expect(p.scope.clubAgainst?.name).toBe('Carlton');
  });

  it('the player name comes back clean, with nothing left unsupported', async () => {
    const result = await parseNlQuestion('Dustin Martin highest goals game against Carlton', ctx);
    expect(result.report.unsupportedTerms).toEqual([]);
  });

  it('works for the other stats too', async () => {
    const p = await plan('top 5 disposals games by Dustin Martin');
    expect(p.metric).toBe('disposals');
    expect(p.agg).toEqual({ kind: 'top_n', n: 5 });
  });
});

// ---------------------------------------------------------------------
// NL-011 -- club roles were decided by alias length, not word order
// ---------------------------------------------------------------------
// Also from the stress run. "to" and "over" were missing from
// AGAINST_PREPOSITION, so neither club in "X biggest win over Y" was
// governed and the roles fell through to first-found-wins -- and findClub
// returns the LONGEST alias, never the leftmost. The result was a
// coin-flip decided by club name length: "Richmond biggest win over
// Carlton" came out right, "Carlton biggest win over Collingwood" came
// out backwards, and both looked equally confident.
describe('NL-011: the club named first is the subject, whatever its name length', () => {
  it.each([
    ['Carlton biggest win over Collingwood', 'Carlton', 'Collingwood'],
    ['Collingwood biggest win over Carlton', 'Collingwood', 'Carlton'],
    ['Carlton worst loss to Collingwood', 'Carlton', 'Collingwood'],
    ['Collingwood worst loss to Carlton', 'Collingwood', 'Carlton'],
  ])('%s', async (question, subject, opponent) => {
    const p = await plan(question);
    expect(p.grain).toBe('team_match');
    expect(p.scope.clubFor?.name).toBe(subject);
    expect(p.scope.clubAgainst?.name).toBe(opponent);
  });

  it('reversing the clubs reverses the plan -- it is not one fixed answer', async () => {
    const a = await plan('Carlton biggest win over Collingwood');
    const b = await plan('Collingwood biggest win over Carlton');
    expect(a.scope.clubFor?.name).not.toBe(b.scope.clubFor?.name);
  });

  it('an explicit "for" still beats position', async () => {
    const p = await plan('biggest win by Richmond over Carlton');
    expect(p.scope.clubFor?.name).toBe('Richmond');
    expect(p.scope.clubAgainst?.name).toBe('Carlton');
  });

  it('word order decides when no preposition governs either club', async () => {
    const p = await plan('Carlton Collingwood biggest win');
    expect(p.scope.clubFor?.name).toBe('Carlton');
    expect(p.scope.clubAgainst?.name).toBe('Collingwood');
  });
});

// ---------------------------------------------------------------------
// NL-012 -- two conditions sharing a number lost one of them
// ---------------------------------------------------------------------
// "players with 3 games and exactly 3 clubs": both counts are the string
// "3", and each clause removed its number by searching for it from the
// start of the question. The clubs clause therefore deleted the games
// clause's "3", leaving "games" with no number to bind to and dropping
// the condition entirely -- a silently narrower answer, not an error.
describe('NL-012: two numeric conditions in one question both survive', () => {
  it('keeps both when the numbers are identical', async () => {
    const p = await plan('players with 3 games and exactly 3 clubs');
    expect(p.grain).toBe('player_career');
    expect(p.careerConditions).toContainEqual(
      expect.objectContaining({ column: 'games', op: 'gte', value: 3 }),
    );
    expect(p.careerConditions).toContainEqual(
      expect.objectContaining({ column: 'clubs_played', op: 'eq', value: 3 }),
    );
  });

  it('keeps both when the numbers differ', async () => {
    const p = await plan('players with 200 games and exactly 2 clubs');
    expect(p.careerConditions).toContainEqual(
      expect.objectContaining({ column: 'games', op: 'gte', value: 200 }),
    );
    expect(p.careerConditions).toContainEqual(
      expect.objectContaining({ column: 'clubs_played', op: 'eq', value: 2 }),
    );
  });

  it('still reads a single condition the same way', async () => {
    const p = await plan('players with at least 145 games');
    expect(p.careerConditions).toEqual([
      expect.objectContaining({ column: 'games', op: 'gte', value: 145 }),
    ]);
  });
});

// ---------------------------------------------------------------------
// NL-013 -- "combined score"/"total score" answered the single-team record
// ---------------------------------------------------------------------
// From the user's code review of the stress-run parser. Two independent
// faults, either fatal alone: AGGREGATE_TOTAL_WORDS stripped
// "total"/"combined" before team-metric extraction ever saw the text, and
// TEAM_METRIC_WORDS listed \bscore\b before "combined score" with
// first-match-wins iteration -- so "highest combined score" answered
// team_score, a confidently wrong record.
describe('NL-013: combined/total score is the match aggregate, not the team score', () => {
  it.each([
    'highest combined score',
    'highest total score',
    'highest aggregate score',
    'highest total points',
  ])('%s', async (question) => {
    const p = await plan(question);
    expect(p.grain).toBe('team_match');
    expect(p.metric).toBe('total_score');
  });

  it('survives a match-type scope', async () => {
    const p = await plan('highest combined score in a grand final');
    expect(p.metric).toBe('total_score');
    expect(p.scope.matchType).toBe('grand_final');
  });

  it('a bare "score" is still the single-team metric', async () => {
    const p = await plan('Richmond highest score in a grand final');
    expect(p.metric).toBe('team_score');
    expect(p.scope.clubFor?.name).toBe('Richmond');
  });

  it('"total" away from "score" is still the named-player sum cue', async () => {
    const p = await plan('dusty total goals against Carlton');
    expect(p.grain).toBe('player_game');
    expect(p.mode).toBe('sum');
    expect(p.metric).toBe('goals');
  });
});

// ---------------------------------------------------------------------
// NL-014 -- decades were never parsed
// ---------------------------------------------------------------------
// DECADE_RE existed in vocab.ts but nothing imported it, and the "1990s"
// token cost the confidence ratio so little that "most goals in the
// 1990s" executed as the ALL-TIME career record -- the season constraint
// silently discarded behind a believable answer.
describe('NL-014: "in the 1990s" is a season range', () => {
  it('four-digit decade', async () => {
    const p = await plan('most goals in the 1990s');
    expect(p.grain).toBe('player_season');
    expect(p.scope.seasonMin).toBe(1990);
    expect(p.scope.seasonMax).toBe(1999);
  });

  it('two-digit decades resolve a century sensibly', async () => {
    const nineties = await plan('most goals in the 90s');
    expect(nineties.scope.seasonMin).toBe(1990);
    const noughties = await plan('most goals in the 00s');
    expect(noughties.scope.seasonMin).toBe(2000);
  });

  it('"the 20s" declines rather than guessing a century', async () => {
    // 1920s vs 2020s is a coin flip; a decline beats a confident guess.
    const result = await declined('most goals in the 20s');
    expect(result.report.confidence).toBeLessThan(0.85);
  });
});

// ---------------------------------------------------------------------
// NL-015 -- "top banana" was a valid Top 10
// ---------------------------------------------------------------------
// TOP_N_RE's [a-z]+ arm matched whatever word followed "top", and an
// unknown count word fell back to `?? 10` -- so "top banana goals" ran a
// confident Top 10, and "top disposal games" (where the next word is the
// METRIC) invented the same 10.
describe('NL-015: an unknown word after "top" is not a count', () => {
  it('garbage after "top" declines instead of inventing a Top 10', async () => {
    const result = await declined('top banana goals');
    expect(result.report.unsupportedTerms).toContain('banana');
  });

  it('"top 5 disposal games by dusty" still carries its real count', async () => {
    const p = await plan('top 5 disposal games by dusty');
    expect(p.agg).toEqual({ kind: 'top_n', n: 5 });
    expect(p.metric).toBe('disposals');
  });

  it('"top disposal games by dusty" reads bare "top" as the leader', async () => {
    const p = await plan('top disposal games by dusty');
    expect(p.agg).toEqual({ kind: 'max' });
    expect(p.metric).toBe('disposals');
    expect(p.mode).toBe('single');
  });

  it('"top ten" still counts', async () => {
    const p = await plan('top ten goalkickers');
    expect(p.agg).toEqual({ kind: 'top_n', n: 10 });
  });
});

// ---------------------------------------------------------------------
// NL-016 -- a nickname swallowed whatever followed it
// ---------------------------------------------------------------------
// The player span consumed candidateRaw wholesale, so "dusty banana most
// goals" resolved Dustin Martin via the first-token nickname and counted
// "banana" as consumed too -- arbitrary noise vanished behind a valid
// name at full confidence.
describe('NL-016: only the tokens the resolution justifies are consumed', () => {
  it('noise after a nickname declines', async () => {
    const result = await declined('dusty banana most goals');
    expect(result.report.unsupportedTerms).toContain('banana');
  });

  it('"dusty martin" still resolves -- the surname is part of the real name', async () => {
    const p = await plan('dusty martin most goals');
    expect(p.player?.name).toBe('Dustin Martin');
  });

  it('a full clean name is untouched', async () => {
    const p = await plan('dustin martin most goals');
    expect(p.player?.name).toBe('Dustin Martin');
  });
});

// ---------------------------------------------------------------------
// NL-017 -- named club + club-season metric fell through to unrecognised
// ---------------------------------------------------------------------
// clubSeasonCuePresent deliberately excluded clubFor, but for the
// club-season-ONLY metric words (wins/losses/draws/percentage) plus
// season wording there is no player reading to protect -- "Richmond most
// wins in a season" just declined.
describe('NL-017: a named club with a club-season metric and season wording routes to club_season', () => {
  it('Richmond most wins in a season', async () => {
    const p = await plan('Richmond most wins in a season');
    expect(p.grain).toBe('club_season');
    expect(p.metric).toBe('wins');
    expect(p.scope.clubFor?.name).toBe('Richmond');
    expect(p.agg).toEqual({ kind: 'max' });
  });

  it('Richmond most wins in 2017 pins the season', async () => {
    const p = await plan('Richmond most wins in 2017');
    expect(p.grain).toBe('club_season');
    expect(p.scope.seasonMin).toBe(2017);
  });

  it('"Richmond most goals in 2017" is still a player question -- goals is a player stat', async () => {
    const p = await plan('Richmond most goals in 2017');
    expect(p.grain).toBe('player_season');
    expect(p.metric).toBe('goals');
  });
});

// ---------------------------------------------------------------------
// NL-018 -- a bare surname shared by two players answered anyway
// ---------------------------------------------------------------------
// Certainty came only from the resolver's score gap, and prominence
// ranking routinely puts one Thomas 200+ points clear of the next -- so
// "Thomas most goals" answered for Thomas Hawkins as though the reader
// had named him. The one hard failure left in the 12,000-question run.
describe('NL-018: a mention matching two players is ambiguous however lopsided the ranking', () => {
  it('Thomas most goals declines as ambiguous', async () => {
    const result = await declined('Thomas most goals');
    expect(result.reason).toBe('ambiguous');
  });

  it('Ablett most goals declines with the mention recorded as ambiguous, not unsupported', async () => {
    const result = await declined('Ablett most goals');
    expect(result.report.ambiguousPlayer).toBe('ablett');
    expect(result.report.unsupportedTerms).not.toContain('ablett');
  });

  it('a unique surname still resolves -- surname-only is how readers type', async () => {
    const p = await plan('pendlebury most goals');
    expect(p.player?.name).toBe('Scott Pendlebury');
  });

  it('a nickname is one specific player by construction', async () => {
    const p = await plan('dusty most goals');
    expect(p.player?.name).toBe('Dustin Martin');
  });
});

// ---------------------------------------------------------------------
// NL-019 -- understood cue words depressed confidence
// ---------------------------------------------------------------------
// IN_ONE_GAME/IN_A_FINAL/IN_A_GRAND_FINAL/IN_ONE_SEASON/OVER_CAREER were
// stripped but never counted as consumed, so "dusty career goals against
// Carlton" sat at 0.750 -- and with the clarify band now declining over
// leftover words, an understood-but-uncounted cue would have turned
// correct answers into declines.
describe('NL-019: grain-cue words count as consumed', () => {
  it.each([
    'dusty career goals against Carlton',
    'most career goals at the mcg',
    'most disposals in a game',
    'most goals in a season',
  ])('%s parses at full token ratio', async (question) => {
    const result = await parseNlQuestion(question, ctx);
    expect(result.status).toBe('plan');
    expect(result.report.components.tokenRatio).toBe(1);
  });
});
