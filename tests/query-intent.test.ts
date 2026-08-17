import { describe, expect, it } from 'vitest';

import {
  type IntentClub,
  extractQuerySignals,
  gridSolverHref,
  parseClubQuestion,
  parsePlayerQuestion,
  resolveIntent,
} from '@/search/query-intent';
import { parseBoardState } from '@/search/grid-solver-spec';

const CLUBS: IntentClub[] = [
  { slug: 'richmond', name: 'Richmond' },
  { slug: 'st-kilda', name: 'St Kilda' },
  { slug: 'essendon', name: 'Essendon' },
];

function intentFor(
  query: string,
  ctx: Parameters<typeof resolveIntent>[2] = {},
): ReturnType<typeof resolveIntent> {
  const signals = extractQuerySignals(query, CLUBS);
  return resolveIntent(query, signals, ctx);
}

describe('extractQuerySignals', () => {
  it('finds a club by whole-word match and strips it from the topic words', () => {
    const signals = extractQuerySignals('brownlow winner richmond', CLUBS);
    expect(signals.club).toEqual({ slug: 'richmond', name: 'Richmond' });
    expect(signals.topicWords).toBe('brownlow winner');
  });

  it('does not match a club name inside another word', () => {
    // "Essendon" should not match "essendonfc" or similar run-together text.
    const signals = extractQuerySignals('essendonfc history', CLUBS);
    expect(signals.club).toBeNull();
  });

  it('finds a plausible season year and rejects out-of-range numbers', () => {
    expect(extractQuerySignals('1989 grand final', CLUBS).year).toBe(1989);
    expect(extractQuerySignals('round 5 3000', CLUBS).year).toBeNull();
  });

  it('finds a multi-word club name', () => {
    const signals = extractQuerySignals('brownlow st kilda', CLUBS);
    expect(signals.club?.slug).toBe('st-kilda');
    expect(signals.topicWords).toBe('brownlow');
  });
});

describe('resolveIntent — Brownlow', () => {
  it('routes a plain brownlow query to the dedicated page', () => {
    expect(intentFor('brownlow')).toEqual({
      href: '/brownlow',
      label: 'Brownlow Medal',
      detail: 'Every winner and the full vote history, from 1924.',
    });
  });

  it('routes a club-qualified query to winners by season, filtered', () => {
    const match = intentFor('brownlow winner richmond');
    expect(match?.href).toBe('/brownlow?club=richmond#brownlow-winners');
    expect(match?.label).toContain('Richmond');
  });

  it('routes a "leaders"/"career" query to the career leaders table', () => {
    const match = intentFor('brownlow career votes leader');
    expect(match?.href).toBe('/brownlow#brownlow-leaders');
  });

  it('routes via the awards-table hit even without the word "brownlow"', () => {
    // searchAwards() rewrites the Brownlow Medal award row's slug to
    // '/brownlow' (see searchAwards in db/queries/search.ts); the intent
    // parser recognises that rewritten slug as equivalent to the keyword.
    const match = intentFor('fairest and best richmond', {
      bestAward: { slug: '/brownlow', title: 'Brownlow Medal', score: 1000 },
    });
    expect(match?.href).toBe('/brownlow?club=richmond#brownlow-winners');
  });

  it('adds a season range when a year is present with no club', () => {
    const match = intentFor('brownlow 1989');
    expect(match?.href).toBe('/brownlow?season_min=1989&season_max=1989#brownlow-winners');
  });
});

describe('resolveIntent — Draft', () => {
  it('treats a bare club as "drafted to"', () => {
    const match = intentFor('draft richmond 2015');
    expect(match?.href).toBe('/draft?year=2015&club=richmond');
  });

  it('treats "from"/"out of" wording as the feeder club', () => {
    const match = intentFor('draft picks from essendon');
    expect(match?.href).toBe('/draft?origin=Essendon');
  });

  it('reads a feeder club straight off the query, since most are not AFL clubs', () => {
    // Claremont is a WAFL club — it isn't in the `clubs` table at all, so
    // this only works by parsing "from <text>" directly, not via `club`.
    const match = intentFor('draft picks from claremont');
    expect(match?.href).toBe('/draft?origin=Claremont');
  });

  it('falls back to a bare link when no club or year is present', () => {
    expect(intentFor('draft')?.href).toBe('/draft');
  });
});

describe('resolveIntent — records and awards', () => {
  it('links a confident record match with a club to the filtered category page', () => {
    const match = intentFor('most goals richmond', {
      bestRecord: { slug: 'most-goals', title: 'Most Goals', score: 1000 },
    });
    expect(match?.href).toBe('/records/most-goals?club=richmond');
  });

  it('ignores a weak record match even with a club present', () => {
    const match = intentFor('some vague phrase richmond', {
      bestRecord: { slug: 'most-goals', title: 'Most Goals', score: 250 },
    });
    expect(match).toBeNull();
  });

  it('links a confident non-Brownlow award match with a club', () => {
    const match = intentFor('coleman medal essendon', {
      bestAward: { slug: 'coleman', title: 'Coleman Medal', score: 1000 },
    });
    expect(match?.href).toBe('/awards/coleman?club=essendon');
  });

  it('does not fire a record/award match without a club', () => {
    const match = intentFor('most goals', {
      bestRecord: { slug: 'most-goals', title: 'Most Goals', score: 1000 },
    });
    expect(match).toBeNull();
  });
});

describe('parsePlayerQuestion', () => {
  it('parses the draws example with a number word and "or more"', () => {
    expect(parsePlayerQuestion('drawn twice or more in one season')).toEqual({
      axis: { builder: 'season_draws_min', params: { times: '2' } },
      label: '2+ draws in one season',
    });
  });

  it('does not require the "in one season" phrase for outcome questions', () => {
    // The regression this guards: both of these returned null on the live
    // site because the draws branch demanded the literal season phrase,
    // while the catalogue only offers draws at season grain anyway.
    const expected = { builder: 'season_draws_min', params: { times: '2' } };
    expect(parsePlayerQuestion('drawn twice or more')?.axis).toEqual(expected);
    expect(parsePlayerQuestion('two draws')?.axis).toEqual(expected);
    expect(parsePlayerQuestion('multiple draws')?.axis).toEqual(expected);
    expect(parsePlayerQuestion('20 wins')?.axis).toEqual({
      builder: 'season_wins_min', params: { times: '20' },
    });
    expect(parsePlayerQuestion('15 losses')?.axis).toEqual({
      builder: 'season_losses_min', params: { times: '15' },
    });
  });

  it('reads "won" as premierships or finals before season wins', () => {
    // One verb, three builders — the narrower reading has to win.
    expect(parsePlayerQuestion('won 3 premierships')?.axis).toEqual({
      builder: 'premierships_min', params: { times: '3' },
    });
    expect(parsePlayerQuestion('won 2 grand finals')?.axis).toEqual({
      builder: 'premierships_min', params: { times: '2' },
    });
    expect(parsePlayerQuestion('won 5 finals')?.axis).toEqual({
      builder: 'finals_wins_min', params: { x: '5' },
    });
    expect(parsePlayerQuestion('won 20 games in a season')?.axis).toEqual({
      builder: 'season_wins_min', params: { times: '20' },
    });
  });

  it('parses grand final questions at the right grain', () => {
    expect(parsePlayerQuestion('played 4 grand finals')?.axis).toEqual({
      builder: 'grand_finals_played_min', params: { times: '4' },
    });
    expect(parsePlayerQuestion('lost 3 grand finals')?.axis).toEqual({
      builder: 'grand_finals_lost_min', params: { times: '3' },
    });
    expect(parsePlayerQuestion('10 finals games')?.axis).toEqual({
      builder: 'finals_games_min', params: { games: '10' },
    });
  });

  it('never reads the "one" of "in one season" as the count', () => {
    // No explicit number: draws default to 1+.
    expect(parsePlayerQuestion('drew a game in one season')?.axis).toEqual({
      builder: 'season_draws_min', params: { times: '1' },
    });
  });

  it('reads outcome words before the generic "games"', () => {
    expect(parsePlayerQuestion('won 20 games in a season')?.axis).toEqual({
      builder: 'season_wins_min', params: { times: '20' },
    });
    expect(parsePlayerQuestion('lost 15 games in a season')?.axis).toEqual({
      builder: 'season_losses_min', params: { times: '15' },
    });
  });

  it('parses career games and season games separately', () => {
    expect(parsePlayerQuestion('300 games')?.axis).toEqual({
      builder: 'career_games_min', params: { games: '300' },
    });
    expect(parsePlayerQuestion('25 games in a season')?.axis).toEqual({
      builder: 'games_in_season_min', params: { games: '25' },
    });
  });

  it('parses a stat at game, season and career grain', () => {
    expect(parsePlayerQuestion('10 goals in a game')?.axis).toEqual({
      builder: 'single_game_stat_min', params: { stat: 'goals', x: '10' },
    });
    expect(parsePlayerQuestion('100 goals in a season')?.axis).toEqual({
      builder: 'season_stat_total_min', params: { stat: 'goals', x: '100' },
    });
    expect(parsePlayerQuestion('1000 goals')?.axis).toEqual({
      builder: 'career_goals_min', params: { goals: '1000' },
    });
    expect(parsePlayerQuestion('40 disposals in a match')?.axis).toEqual({
      builder: 'single_game_stat_min', params: { stat: 'disposals', x: '40' },
    });
  });

  it('does not read the 50 of "inside 50s" as the count', () => {
    expect(parsePlayerQuestion('inside 50s in a season')).toBeNull();
    expect(parsePlayerQuestion('20 inside 50s in a game')?.axis).toEqual({
      builder: 'single_game_stat_min', params: { stat: 'inside_50s', x: '20' },
    });
  });

  it('parses premierships with and without a count', () => {
    expect(parsePlayerQuestion('3 premierships')?.axis).toEqual({
      builder: 'premierships_min', params: { times: '3' },
    });
    expect(parsePlayerQuestion('premiership players')?.axis).toEqual({
      builder: 'premierships_min', params: { times: '1' },
    });
  });

  it('returns null for text naming no question', () => {
    expect(parsePlayerQuestion('michael tuck')).toBeNull();
    expect(parsePlayerQuestion('most goals')).toBeNull();
  });
});

describe('parseClubQuestion', () => {
  it('parses the teams example', () => {
    expect(parseClubQuestion('teams to draw twice in one season')).toEqual({
      kind: 'season_draws_min', n: 2, label: '2+ draws in a season',
    });
  });

  it('needs an explicit club subject, which is all that separates it from the player question', () => {
    // One word apart, two different questions and two different answers.
    expect(parseClubQuestion('drawn twice or more')).toBeNull();
    expect(parsePlayerQuestion('drawn twice or more')?.axis.builder).toBe('season_draws_min');

    expect(parseClubQuestion('clubs drawn twice or more')?.kind).toBe('season_draws_min');
    expect(parsePlayerQuestion('clubs drawn twice or more')).toBeNull();
  });

  it('accepts team, club and side as the subject', () => {
    for (const subject of ['teams', 'team', 'clubs', 'club', 'sides', 'side']) {
      expect(parseClubQuestion(`${subject} to draw twice`)?.n, subject).toBe(2);
    }
  });

  it('reads the standalone season achievements', () => {
    expect(parseClubQuestion('teams that won the wooden spoon')?.kind).toBe('wooden_spoon');
    expect(parseClubQuestion('teams that won the premiership')?.kind).toBe('premiers');
    expect(parseClubQuestion('teams that finished first')?.kind).toBe('minor_premiers');
    expect(parseClubQuestion('undefeated teams')?.kind).toBe('undefeated');
    expect(parseClubQuestion('winless teams')?.kind).toBe('winless');
  });

  it('reads minor premiership before the premiership inside it', () => {
    expect(parseClubQuestion('teams that were minor premiers')?.kind).toBe('minor_premiers');
  });

  it('reads season win and loss counts', () => {
    expect(parseClubQuestion('teams with 20 wins in a season')).toEqual({
      kind: 'season_wins_min', n: 20, label: '20+ wins in a season',
    });
    expect(parseClubQuestion('teams that lost 18 games in a season')).toEqual({
      kind: 'season_losses_min', n: 18, label: '18+ losses in a season',
    });
  });

  it('returns null for club text naming no question', () => {
    expect(parseClubQuestion('richmond football club')).toBeNull();
    expect(parseClubQuestion('teams')).toBeNull();
  });
});

describe('player questions are answered, not linked away', () => {
  it('is not turned into a grid-solver intent link', () => {
    // The regression this guards: answering via an intent link made the
    // answer depend on reaching /grid-solver, so a reader without access
    // to that page got "no results" instead of their answer. The search
    // layer answers the question inline now (db/queries/search.ts), and
    // resolveIntent must stay out of it.
    expect(intentFor('drawn twice or more in one season')).toBeNull();
    expect(intentFor('drawn twice or more')).toBeNull();
    expect(intentFor('10 goals in a game')).toBeNull();
  });

  it('still builds a refine board with one solvable cell', () => {
    // Offered beside the answer for a reader who can reach the page, so
    // the board shape still matters.
    const href = gridSolverHref(parsePlayerQuestion('drawn twice or more')!.axis);
    expect(href.startsWith('/grid-solver?g=')).toBe(true);

    const state = parseBoardState(href.replace('/grid-solver?g=', ''));
    expect(state?.rows[0]).toEqual({ builder: 'season_draws_min', params: { times: '2' } });
    expect(state?.cols[0]).toEqual({ builder: 'career_games_min', params: { games: '1' } });
    expect(state?.order).toBe('games_desc');
    // The remaining axes stay incomplete so only the one cell solves.
    expect(state?.rows[1].params).toEqual({});
    expect(state?.cols[2].params).toEqual({});
  });
});

describe('resolveIntent — no match', () => {
  it('returns null for a query the registry does not recognise', () => {
    expect(intentFor('michael tuck')).toBeNull();
  });

  it('returns null for an empty query', () => {
    expect(intentFor('')).toBeNull();
  });
});
