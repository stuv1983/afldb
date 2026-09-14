import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  CoachBiggestWinLossTable,
  CoachCareerBody,
  CoachOpponentRecordBody,
  CoachTotalsTable,
  CoachVenueHistoryTable,
  type CoachOpponentRecordLike,
} from '@/components/CoachCareerRecord';
import { CoachOpponentSelector } from '@/components/CoachOpponentSelector';
import type { ComparisonOrganization } from '@/db/queries/club-comparison';
import type {
  CoachCareer, CoachCareerMatch, CoachingClubStint, CoachVenueRecord,
} from '@/db/queries/coaches';

/**
 * The AFLDB-ISSUE-170 Stage 1D shared presentation: totals, club-by-club
 * record, biggest win/loss and venue history, plus the opponent-scoped
 * Stage 1C record. Every function here is a plain prop-to-JSX renderer
 * (see CoachCareerRecord.tsx's header comment), so these are ordinary
 * renderToStaticMarkup tests with no database — the same convention
 * player-coaching-career.test.ts already uses for CoachCareer fixtures.
 */

function stint(overrides: Partial<CoachingClubStint> = {}): CoachingClubStint {
  return {
    clubId: 1,
    clubName: 'Collingwood',
    clubSlug: 'collingwood',
    firstSeason: 1990,
    lastSeason: 1999,
    games: 200,
    wins: 100,
    draws: 2,
    losses: 98,
    finals: 20,
    grandFinals: 2,
    premierships: 1,
    winPct: 50.5,
    ...overrides,
  };
}

function match(overrides: Partial<CoachCareerMatch> = {}): CoachCareerMatch {
  return {
    matchId: 555,
    season: 1995,
    matchDate: new Date('1995-06-10'),
    roundType: 'home_and_away',
    isFinalsSeries: false,
    coachedClubId: 1,
    coachedClubName: 'Collingwood',
    coachedClubSlug: 'collingwood',
    opponentClubId: 2,
    opponentClubName: 'Essendon',
    opponentClubSlug: 'essendon',
    margin: 45,
    venueId: 3,
    venueName: 'MCG',
    venueSlug: 'mcg',
    ...overrides,
  };
}

function venue(overrides: Partial<CoachVenueRecord> = {}): CoachVenueRecord {
  return {
    venueId: 3,
    venueName: 'MCG',
    venueSlug: 'mcg',
    games: 50,
    wins: 30,
    draws: 1,
    losses: 19,
    winPct: 61.0,
    finals: 5,
    grandFinals: 1,
    firstMatchId: 100,
    firstMatchDate: new Date('1990-04-01'),
    lastMatchId: 999,
    lastMatchDate: new Date('1999-09-01'),
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

function org(overrides: Partial<ComparisonOrganization> = {}): ComparisonOrganization {
  return {
    id: 9, name: 'Essendon', slug: 'essendon', firstSeason: 1897, lastSeason: null, isActive: true,
    ...overrides,
  };
}

function opponentRecord(overrides: Partial<CoachOpponentRecordLike> = {}): CoachOpponentRecordLike {
  return {
    organization: org(),
    totals: { games: 20, wins: 12, draws: 0, losses: 8, finals: 3, grandFinals: 1, winPct: 60 },
    biggestWin: match({ margin: 55 }),
    biggestLoss: match({ matchId: 557, margin: -30 }),
    venues: [venue()],
    ...overrides,
  };
}

describe('CoachTotalsTable', () => {
  it('shows Premierships when the totals include it (career totals)', () => {
    const html = renderToStaticMarkup(CoachTotalsTable({ totals: career().totals }));
    expect(html).toContain('Premierships');
    expect(html).toContain('63.4');
  });

  it('omits Premierships when the totals do not include it (opponent-scoped totals, Stage 1C)', () => {
    const html = renderToStaticMarkup(CoachTotalsTable({ totals: opponentRecord().totals }));
    expect(html).not.toContain('Premierships');
    expect(html).toContain('60.0');
  });

  it('uses the repository-standard missing-value marker for a null win percentage', () => {
    const html = renderToStaticMarkup(
      CoachTotalsTable({ totals: { games: 0, wins: 0, draws: 0, losses: 0, winPct: null, finals: 0, grandFinals: 0 } }),
    );
    expect(html).toContain('—');
  });
});

describe('CoachBiggestWinLossTable', () => {
  it('signs a win with a leading +, a loss with a trailing minus, from formatNumber', () => {
    const html = renderToStaticMarkup(
      CoachBiggestWinLossTable({
        biggestWin: match({ margin: 90 }),
        biggestLoss: match({ matchId: 2, margin: -60 }),
        showCoachedClub: false,
      }),
    );
    expect(html).toContain('+90');
    expect(html).toContain('-60');
  });

  it('never treats a null biggest win/loss as a fabricated zero', () => {
    const html = renderToStaticMarkup(
      CoachBiggestWinLossTable({ biggestWin: null, biggestLoss: null, showCoachedClub: false }),
    );
    expect(html).toContain('No qualifying (decided) match on record');
    expect(html).not.toContain('+0');
  });

  it('adds a Coaching column only when showCoachedClub is true (the multi-club case)', () => {
    const withColumn = renderToStaticMarkup(
      CoachBiggestWinLossTable({ biggestWin: match(), biggestLoss: null, showCoachedClub: true }),
    );
    const withoutColumn = renderToStaticMarkup(
      CoachBiggestWinLossTable({ biggestWin: match(), biggestLoss: null, showCoachedClub: false }),
    );
    expect(withColumn).toContain('Coaching');
    expect(withoutColumn).not.toContain('>Coaching<');
  });

  it('marks a Grand Final win distinctly from an ordinary finals win', () => {
    const grandFinal = renderToStaticMarkup(
      CoachBiggestWinLossTable({
        biggestWin: match({ roundType: 'grand_final', isFinalsSeries: true }),
        biggestLoss: null,
        showCoachedClub: false,
      }),
    );
    expect(grandFinal).toContain('Grand Final');
  });
});

describe('CoachVenueHistoryTable', () => {
  it('renders an explicit empty state for no venue history, not an empty table', () => {
    const html = renderToStaticMarkup(CoachVenueHistoryTable({ venues: [] }));
    expect(html).toContain('No canonical venue history on record');
  });

  it('renders venue name, games and win percentage from the given venues', () => {
    const html = renderToStaticMarkup(CoachVenueHistoryTable({ venues: [venue()] }));
    expect(html).toContain('MCG');
    expect(html).toContain('50');
    expect(html).toContain('61.0');
  });

  it('accepts a JSON-decoded (string) match date, not only a Date object', () => {
    // The client-fetched opponent record has already been through
    // JSON.stringify, which turns firstMatchDate/lastMatchDate into ISO
    // strings — this must render exactly like the Date-object path.
    const html = renderToStaticMarkup(
      CoachVenueHistoryTable({
        venues: [{ ...venue(), firstMatchDate: '1990-04-01T00:00:00.000Z', lastMatchDate: '1999-09-01T00:00:00.000Z' }],
      }),
    );
    expect(html).toContain('MCG');
    expect(html).not.toContain('—');
  });
});

describe('CoachCareerBody — the shared career presentation (AFLDB-ISSUE-170 Stage 1D)', () => {
  it('renders an explicit no-record state for a zero-game coach, never a table of invented zeros', () => {
    const c = career({
      totals: { games: 0, wins: 0, draws: 0, losses: 0, finals: 0, grandFinals: 0, premierships: 0, winPct: null },
      biggestWin: null,
      biggestLoss: null,
      venues: [],
      clubs: [],
    });
    const html = renderToStaticMarkup(CoachCareerBody({ career: c, linkClubs: true }));
    expect(html).toContain('No canonical coaching match is currently recorded');
    expect(html).not.toContain('0W');
  });

  it('renders biggest win/loss and venue history — the exact tables Stage 1D adds beyond the pre-existing totals/club table', () => {
    const html = renderToStaticMarkup(CoachCareerBody({ career: career(), linkClubs: true }));
    expect(html).toContain('Biggest win and loss');
    expect(html).toContain('Essendon');
    expect(html).toContain('Venue history');
    expect(html).toContain('MCG');
  });

  it('links each club only when linkClubs is true — the one real difference between the standalone and player-linked surfaces, now expressed as a single shared component instead of two duplicated implementations', () => {
    const c = career();
    const linked = renderToStaticMarkup(CoachCareerBody({ career: c, linkClubs: true }));
    const unlinked = renderToStaticMarkup(CoachCareerBody({ career: c, linkClubs: false }));

    // Scoped to the coached club's own slug, not every /clubs/ anchor in
    // the body: the biggest-win/loss table legitimately links opponent
    // clubs (Essendon, Carlton) regardless of linkClubs — that link is
    // not what this prop controls, and suppressing it would be a
    // production regression, not a test fix. Collingwood does not
    // collide with either opponent slug in this fixture.
    expect(linked).toContain(`<a href="/clubs/${c.clubs[0].clubSlug}"`);
    expect(unlinked).not.toContain(`<a href="/clubs/${c.clubs[0].clubSlug}"`);
    expect(unlinked).toContain(c.clubs[0].clubName);

    // Everything else — totals, biggest win/loss (including its
    // legitimate opponent links), venue history — is identical, because
    // both calls run through the exact same functions.
    expect(linked).toContain('<a href="/clubs/essendon"');
    expect(unlinked).toContain('<a href="/clubs/essendon"');
    expect(linked).toContain('<a href="/clubs/carlton"');
    expect(unlinked).toContain('<a href="/clubs/carlton"');
    expect(linked).toContain('MCG');
    expect(unlinked).toContain('MCG');
  });
});

describe('CoachOpponentRecordBody — the Stage 1C opponent-scoped presentation', () => {
  it('renders an explicit zero-meeting state, not a table of zeros', () => {
    const record = opponentRecord({
      totals: { games: 0, wins: 0, draws: 0, losses: 0, finals: 0, grandFinals: 0, winPct: null },
      biggestWin: null,
      biggestLoss: null,
      venues: [],
    });
    const html = renderToStaticMarkup(CoachOpponentRecordBody({ record, showCoachedClub: false }));
    expect(html).toContain('No canonical coaching meetings are recorded against Essendon');
  });

  it('renders Games/W-L-D/Win%, biggest win/loss and the venue breakdown for a real record', () => {
    const html = renderToStaticMarkup(CoachOpponentRecordBody({ record: opponentRecord(), showCoachedClub: false }));
    expect(html).toContain('20'); // games
    expect(html).toContain('60.0'); // win %
    expect(html).toContain('Biggest win and loss vs Essendon');
    expect(html).toContain('Venue breakdown vs Essendon');
    expect(html).toContain('MCG');
  });
});

describe('CoachOpponentSelector — the standalone coach page\'s server-rendered Stage 1C selector', () => {
  it('renders every organisation as a plain GET option, grouped by current/former', () => {
    const html = renderToStaticMarkup(
      CoachOpponentSelector({
        organizations: [org(), org({ id: 10, name: 'Fitzroy', slug: 'fitzroy', isActive: false })],
        selected: undefined,
        basePath: '/coaches/some-coach-1',
      }),
    );
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/coaches/some-coach-1"');
    expect(html).toContain('Essendon');
    expect(html).toContain('Fitzroy');
    expect(html).toContain('Current clubs');
    expect(html).toContain('Former clubs');
  });

  it('offers a Clear link back to the base path only once an opponent is selected', () => {
    const none = renderToStaticMarkup(
      CoachOpponentSelector({ organizations: [org()], selected: undefined, basePath: '/coaches/some-coach-1' }),
    );
    const selected = renderToStaticMarkup(
      CoachOpponentSelector({ organizations: [org()], selected: 'essendon', basePath: '/coaches/some-coach-1' }),
    );
    expect(none).not.toContain('Clear');
    expect(selected).toContain('Clear');
  });
});
