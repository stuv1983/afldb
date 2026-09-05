import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { PlayerCoachingCareer } from '@/components/PlayerCoachingCareer';
import type { CoachCareer, CoachingClubStint } from '@/db/queries/coaches';
import { coachingCareerSummary } from '@/lib/coaching-format';

function stint(overrides: Partial<CoachingClubStint> = {}): CoachingClubStint {
  return {
    clubId: 1,
    clubName: 'Collingwood',
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
});
