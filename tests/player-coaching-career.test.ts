import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { PlayerCoachingCareer } from '@/components/PlayerCoachingCareer';
import type { CoachCareer, CoachingClubStint } from '@/db/queries/coaches';
import { coachingCareerSummary } from '@/lib/coaching-format';

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

function career(overrides: Partial<CoachCareer> = {}): CoachCareer {
  const clubs = overrides.clubs ?? [stint()];
  return {
    coachId: 1,
    clubs,
    totals: {
      games: 793,
      wins: 500,
      draws: 5,
      losses: 288,
      finals: 60,
      grandFinals: 6,
      premierships: 4,
      winPct: 63.4,
    },
    biggestWin: null,
    biggestLoss: null,
    venues: [],
    ...overrides,
  };
}

describe('coachingCareerSummary', () => {
  it('reports games and premierships from the returned totals, not a hard-coded example', () => {
    expect(coachingCareerSummary({ games: 793, premierships: 4 })).toBe('793 games · 4 premierships');
  });

  it('uses singular units for exactly one game or premiership', () => {
    expect(coachingCareerSummary({ games: 1, premierships: 1 })).toBe('1 game · 1 premiership');
  });

  it('omits the premiership clause entirely when there are none', () => {
    expect(coachingCareerSummary({ games: 12, premierships: 0 })).toBe('12 games');
  });
});

describe('PlayerCoachingCareer rendering', () => {
  it('is collapsed by default', () => {
    const html = renderToStaticMarkup(PlayerCoachingCareer({ career: career() }));
    const detailsTag = html.match(/<details[^>]*>/)?.[0] ?? '';
    expect(detailsTag).not.toMatch(/\bopen\b/);
  });

  it('shows the actual returned totals when expanded', () => {
    const html = renderToStaticMarkup(PlayerCoachingCareer({ career: career() }));
    expect(html).toContain('793');
    expect(html).toContain('4');
    expect(html).toContain('63.4');
  });

  it('renders multiple coaching club stints', () => {
    const c = career({
      clubs: [
        stint({ clubId: 1, clubName: 'Fitzroy', firstSeason: 1980, lastSeason: 1985 }),
        stint({ clubId: 2, clubName: 'Collingwood', firstSeason: 1986, lastSeason: 1999 }),
      ],
    });
    const html = renderToStaticMarkup(PlayerCoachingCareer({ career: c }));
    expect(html).toContain('Fitzroy');
    expect(html).toContain('Collingwood');
  });

  it('formats a one-season stint as a single year, not a repeated range', () => {
    const c = career({
      clubs: [stint({ clubId: 1, clubName: 'Melbourne', firstSeason: 2013, lastSeason: 2013 })],
    });
    const html = renderToStaticMarkup(PlayerCoachingCareer({ career: c }));
    expect(html).toContain('>2013<');
    expect(html).not.toContain('2013–2013');
  });

  it('uses the repository-standard missing-value marker for a null win percentage', () => {
    const c = career({
      clubs: [stint({ winPct: null, games: 0, wins: 0, draws: 0, losses: 0 })],
    });
    const html = renderToStaticMarkup(PlayerCoachingCareer({ career: c }));
    expect(html).toContain('—');
  });

  // AFLDB-ISSUE-170 Stage 1D: the career body now renders through the
  // shared CoachCareerRecord functions the standalone /coaches/[slug]
  // page also uses, instead of a second, independently duplicated table.
  it('renders biggest win/loss and venue history, not only the pre-existing totals/club table', () => {
    const c = career({
      biggestWin: {
        matchId: 1, season: 1995, matchDate: new Date('1995-06-10'), roundType: 'home_and_away',
        isFinalsSeries: false, coachedClubId: 1, coachedClubName: 'Collingwood', coachedClubSlug: 'collingwood',
        opponentClubId: 2, opponentClubName: 'Essendon', opponentClubSlug: 'essendon', margin: 90,
        venueId: 3, venueName: 'MCG', venueSlug: 'mcg',
      },
      biggestLoss: null,
      venues: [{
        venueId: 3, venueName: 'MCG', venueSlug: 'mcg', games: 50, wins: 30, draws: 1, losses: 19, winPct: 61,
        finals: 5, grandFinals: 1, firstMatchId: 10, firstMatchDate: new Date('1990-04-01'),
        lastMatchId: 99, lastMatchDate: new Date('1999-09-01'),
      }],
    });
    const html = renderToStaticMarkup(PlayerCoachingCareer({ career: c }));
    expect(html).toContain('Biggest win and loss');
    expect(html).toContain('Essendon');
    expect(html).toContain('Venue history');
    expect(html).toContain('MCG');
  });

  it('does not link the club-by-club table\'s own club — the player page\'s Clubs section already does, so a second link would be redundant (biggest-win/loss opponent and coached-club links are unaffected)', () => {
    const c = career({
      clubs: [stint({ clubSlug: 'collingwood' })],
      biggestWin: {
        matchId: 1, season: 1995, matchDate: new Date('1995-06-10'), roundType: 'home_and_away',
        isFinalsSeries: false, coachedClubId: 1, coachedClubName: 'Collingwood', coachedClubSlug: 'collingwood',
        opponentClubId: 2, opponentClubName: 'Essendon', opponentClubSlug: 'essendon', margin: 90,
        venueId: 3, venueName: 'MCG', venueSlug: 'mcg',
      },
    });
    const html = renderToStaticMarkup(PlayerCoachingCareer({ career: c }));
    expect(html).not.toContain('<a href="/clubs/collingwood"');
    // The biggest-win opponent link is a different, non-redundant club and stays linked either way.
    expect(html).toContain('<a href="/clubs/essendon"');
  });

  it('renders the explicit no-record state for a zero-game coaching career, never a table of invented zeros', () => {
    const c = career({
      totals: { games: 0, wins: 0, draws: 0, losses: 0, finals: 0, grandFinals: 0, premierships: 0, winPct: null },
      clubs: [],
      biggestWin: null,
      biggestLoss: null,
      venues: [],
    });
    const html = renderToStaticMarkup(PlayerCoachingCareer({ career: c }));
    expect(html).toContain('No canonical coaching match is currently recorded');
  });

  // The opponent-history selector is a client component that reads
  // next/navigation's useRouter(), which throws outside an actual
  // mounted Next.js App Router — there is no such context in this
  // renderToStaticMarkup unit render (see CoachCareerRecord.tsx and
  // PlayerCoachingCareer.tsx's own comments). Gating it on a non-empty
  // `organizations` list, rather than on totals.games alone, is what
  // keeps every test in this file — none of which pass `organizations`
  // — safe: this test pins that gate down explicitly.
  it('omits the opponent-history selector when no organizations are supplied (the default), so it never touches next/navigation outside a mounted router', () => {
    const html = renderToStaticMarkup(PlayerCoachingCareer({ career: career() }));
    expect(html).not.toContain('History against club');
    expect(html).not.toContain('Loading opponent history');
  });
});
