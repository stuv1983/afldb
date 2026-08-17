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
