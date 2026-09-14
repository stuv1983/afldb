import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { CoachComparisonCareer } from '@/components/CoachComparisonCareer';
import type { ResolvedCoach } from '@/app/coaches/compare/state';
import type { CoachCareer, CoachCareerMatch, CoachingClubStint, CoachVenueRecord } from '@/db/queries/coaches';

/**
 * AFLDB-ISSUE-170 Stage 2B — the side-by-side career comparison component.
 *
 * A plain prop-to-JSX renderer (no data fetching, no hooks -- the same
 * `renderToStaticMarkup` convention `coach-career-record.test.ts` already
 * uses for `CoachCareer` fixtures), so this proves the comparison uses
 * `getCoachCareer`'s records correctly. It deliberately does not re-prove
 * any Stage 1 query statistic -- that stays coach-career-record.test.ts's
 * and coaches.test.ts's job.
 */

function resolvedCoach(overrides: Partial<ResolvedCoach['coach']> = {}, profilePath?: string): ResolvedCoach {
  const coach = {
    id: 1, displayName: 'Coach One', dob: null, playerId: null, playerSlug: null, ...overrides,
  };
  return { coach, profilePath: profilePath ?? `/coaches/coach-one-${coach.id}` };
}

function stint(overrides: Partial<CoachingClubStint> = {}): CoachingClubStint {
  return {
    clubId: 1, clubName: 'Collingwood', clubSlug: 'collingwood',
    firstSeason: 1990, lastSeason: 1999, games: 200, wins: 100, draws: 2, losses: 98,
    finals: 20, grandFinals: 2, premierships: 1, winPct: 50.5,
    ...overrides,
  };
}

function match(overrides: Partial<CoachCareerMatch> = {}): CoachCareerMatch {
  return {
    matchId: 555, season: 1995, matchDate: new Date('1995-06-10'), roundType: 'home_and_away',
    isFinalsSeries: false, coachedClubId: 1, coachedClubName: 'Collingwood', coachedClubSlug: 'collingwood',
    opponentClubId: 2, opponentClubName: 'Essendon', opponentClubSlug: 'essendon',
    margin: 45, venueId: 3, venueName: 'MCG', venueSlug: 'mcg',
    ...overrides,
  };
}

function venue(overrides: Partial<CoachVenueRecord> = {}): CoachVenueRecord {
  return {
    venueId: 3, venueName: 'MCG', venueSlug: 'mcg', games: 50, wins: 30, draws: 1, losses: 19,
    winPct: 61.0, finals: 5, grandFinals: 1, firstMatchId: 100, firstMatchDate: new Date('1990-04-01'),
    lastMatchId: 999, lastMatchDate: new Date('1999-09-01'),
    ...overrides,
  };
}

function career(overrides: Partial<CoachCareer> = {}): CoachCareer {
  const clubs = overrides.clubs ?? [stint()];
  return {
    coachId: 1,
    clubs,
    totals: {
      games: 793, wins: 500, draws: 5, losses: 288, finals: 60, grandFinals: 6, premierships: 4, winPct: 63.4,
    },
    biggestWin: match({ margin: 90, opponentClubName: 'Essendon' }),
    biggestLoss: match({ matchId: 556, margin: -60, opponentClubName: 'Carlton', opponentClubSlug: 'carlton' }),
    venues: [venue()],
    ...overrides,
  };
}

const coachA = resolvedCoach({ id: 1, displayName: 'Alastair Clarkson' });
const coachB = resolvedCoach({ id: 2, displayName: 'Chris Scott' });

const careerA = career({
  coachId: 1,
  totals: { games: 500, wins: 300, draws: 4, losses: 196, finals: 40, grandFinals: 45, premierships: 17, winPct: 60.4 },
  biggestWin: match({ opponentClubName: 'Essendon', margin: 90 }),
  biggestLoss: match({ matchId: 556, opponentClubName: 'Carlton', opponentClubSlug: 'carlton', margin: -60 }),
  venues: [venue({ venueName: 'MCG', venueSlug: 'mcg' })],
});

const careerB = career({
  coachId: 2,
  totals: { games: 300, wins: 180, draws: 2, losses: 118, finals: 25, grandFinals: 23, premierships: 9, winPct: 60.7 },
  biggestWin: match({ opponentClubName: 'Fremantle', opponentClubSlug: 'fremantle', margin: 100 }),
  biggestLoss: match({ matchId: 557, opponentClubName: 'Hawthorn', opponentClubSlug: 'hawthorn', margin: -70 }),
  venues: [venue({ venueName: 'GMHBA Stadium', venueSlug: 'gmhba-stadium' })],
});

describe('CoachComparisonCareer', () => {
  it('renders Games for both coaches', () => {
    const html = renderToStaticMarkup(
      CoachComparisonCareer({ coachA, coachB, careerA, careerB }),
    );
    expect(html).toContain('500'); // coachA games
    expect(html).toContain('300'); // coachB games
  });

  it('renders W-L-D for both coaches', () => {
    const html = renderToStaticMarkup(
      CoachComparisonCareer({ coachA, coachB, careerA, careerB }),
    );
    expect(html).toContain('300W');
    expect(html).toContain('196L');
    expect(html).toContain('180W');
    expect(html).toContain('118L');
  });

  it('renders Win % for both coaches', () => {
    const html = renderToStaticMarkup(
      CoachComparisonCareer({ coachA, coachB, careerA, careerB }),
    );
    expect(html).toContain('60.4');
    expect(html).toContain('60.7');
  });

  it('renders Finals for both coaches', () => {
    const html = renderToStaticMarkup(
      CoachComparisonCareer({ coachA, coachB, careerA, careerB }),
    );
    expect(html).toContain('40');
    expect(html).toContain('25');
  });

  it('renders Grand Finals for both coaches', () => {
    const html = renderToStaticMarkup(
      CoachComparisonCareer({ coachA, coachB, careerA, careerB }),
    );
    expect(html).toContain('Grand Finals');
    // Each coach's own distinct Grand Final count, in its own table cell.
    expect(html).toContain('>45<');
    expect(html).toContain('>23<');
  });

  it('renders Premierships for both coaches', () => {
    const html = renderToStaticMarkup(
      CoachComparisonCareer({ coachA, coachB, careerA, careerB }),
    );
    expect(html).toContain('Premierships');
    // Each coach's own distinct premiership count, in its own table cell.
    expect(html).toContain('>17<');
    expect(html).toContain('>9<');
  });

  it('renders biggest win for both coaches, from each coach\'s own record', () => {
    const html = renderToStaticMarkup(
      CoachComparisonCareer({ coachA, coachB, careerA, careerB }),
    );
    expect(html).toContain('+90');
    expect(html).toContain('Essendon');
    expect(html).toContain('+100');
    expect(html).toContain('Fremantle');
  });

  it('renders biggest loss for both coaches, from each coach\'s own record', () => {
    const html = renderToStaticMarkup(
      CoachComparisonCareer({ coachA, coachB, careerA, careerB }),
    );
    expect(html).toContain('-60');
    expect(html).toContain('Carlton');
    expect(html).toContain('-70');
    expect(html).toContain('Hawthorn');
  });

  it('renders venue history for both coaches, from each coach\'s own venues', () => {
    const html = renderToStaticMarkup(
      CoachComparisonCareer({ coachA, coachB, careerA, careerB }),
    );
    expect(html).toContain('MCG');
    expect(html).toContain('GMHBA Stadium');
  });

  it('is safe when one coach has no biggest win/loss on record, never fabricating a zero', () => {
    const noRecordCareer = career({
      coachId: 2, biggestWin: null, biggestLoss: null,
    });
    const html = renderToStaticMarkup(
      CoachComparisonCareer({ coachA, coachB, careerA, careerB: noRecordCareer }),
    );
    expect(html).toContain('No qualifying (decided) match on record');
    expect(html).not.toContain('+0');
    // The other coach's real record still renders alongside it.
    expect(html).toContain('+90');
  });

  it('is safe for a zero-game coach paired with a coach with games', () => {
    const zeroGameCareer = career({
      coachId: 2,
      totals: { games: 0, wins: 0, draws: 0, losses: 0, finals: 0, grandFinals: 0, premierships: 0, winPct: null },
      biggestWin: null,
      biggestLoss: null,
      venues: [],
      clubs: [],
    });
    const html = renderToStaticMarkup(
      CoachComparisonCareer({ coachA, coachB, careerA, careerB: zeroGameCareer }),
    );
    expect(html).toContain('No qualifying (decided) match on record');
    expect(html).toContain('No canonical venue history on record');
    // The coach with games still renders their real career alongside it.
    expect(html).toContain('500');
    expect(html).toContain('MCG');
  });

  it('renders a player-linked coach and a coach-only coach the same way', () => {
    const linked = resolvedCoach({ id: 3, displayName: 'Player Linked Coach', playerId: 42, playerSlug: 'player-linked' });
    const coachOnly = resolvedCoach({ id: 4, displayName: 'Coach Only Coach', playerId: null, playerSlug: null });
    const html = renderToStaticMarkup(
      CoachComparisonCareer({
        coachA: linked,
        coachB: coachOnly,
        careerA: career({ ...careerA, coachId: 3 }),
        careerB: career({ ...careerB, coachId: 4 }),
      }),
    );
    expect(html).toContain('Player Linked Coach');
    expect(html).toContain('Coach Only Coach');
  });

  it('swaps presentation order but keeps each coach\'s own record attached to them', () => {
    const forward = renderToStaticMarkup(
      CoachComparisonCareer({ coachA, coachB, careerA, careerB }),
    );
    const swapped = renderToStaticMarkup(
      CoachComparisonCareer({ coachA: coachB, coachB: coachA, careerA: careerB, careerB: careerA }),
    );

    // coachA (Clarkson) appears before coachB (Scott) in the forward order.
    expect(forward.indexOf('Alastair Clarkson')).toBeLessThan(forward.indexOf('Chris Scott'));
    // Reversed in the swapped order.
    expect(swapped.indexOf('Chris Scott')).toBeLessThan(swapped.indexOf('Alastair Clarkson'));

    // Each coach's own biggest win stays theirs regardless of position.
    expect(forward).toContain('Essendon');
    expect(swapped).toContain('Essendon');
    expect(forward).toContain('Fremantle');
    expect(swapped).toContain('Fremantle');
  });

  it('fails safely with an explicit message when a career fails to resolve, never throwing', () => {
    expect(() => renderToStaticMarkup(
      CoachComparisonCareer({ coachA, coachB, careerA: null, careerB }),
    )).not.toThrow();
    const html = renderToStaticMarkup(
      CoachComparisonCareer({ coachA, coachB, careerA: null, careerB }),
    );
    expect(html).toContain('Career data is not currently available');
    expect(html).toContain('Alastair Clarkson');
    // No comparison tables are rendered in this state.
    expect(html).not.toContain('Biggest win and loss');
  });

  it('reports both names when both careers fail to resolve', () => {
    const html = renderToStaticMarkup(
      CoachComparisonCareer({ coachA, coachB, careerA: null, careerB: null }),
    );
    expect(html).toContain('Alastair Clarkson');
    expect(html).toContain('Chris Scott');
  });
});
