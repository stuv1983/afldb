/**
 * AFLDB-ISSUE-170 Stage 1E — `/coaches/[slug]-id` is a real coach page for
 * EVERY coach, not a redirect alias for the player page.
 *
 * The defect this pins: a person who both played and coached was
 * permanently redirected from the coach route to their player route, so
 * selecting (say) Mick Malthouse from /coaches delivered a player profile
 * whose primary action was "Compare with another player" and whose coaching
 * record sat at the bottom of the page. The two routes are now
 * route-contextual presentations of one person: the coach route leads with
 * coaching, the player route leads with playing, and neither redirects to
 * the other.
 *
 * Rendered with fixtures rather than against afldb_test: what is under test
 * is the ROUTE CONTRACT (which page renders, what it leads with, where it
 * links, what it canonicalises to), which is independent of any particular
 * coach's rows. Aggregation correctness stays in tests/coaches.test.ts and
 * tests/integration/player-family-and-coaching.test.ts, and the two-route
 * browser journey stays in tests/e2e/journeys.spec.ts.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CoachCareer } from '@/db/queries/coaches';

const nav = vi.hoisted(() => ({ redirects: [] as string[], notFound: 0 }));
const data = vi.hoisted(() => ({
  coach: null as {
    id: number; displayName: string; dob: Date | null;
    playerId: number | null; playerSlug: string | null;
  } | null,
}));

// notFound()/permanentRedirect() are `never`-returning throws in Next; the
// throw is what stops the rest of the page from rendering, so it is
// reproduced here rather than stubbed out.
vi.mock('next/navigation', () => ({
  notFound: () => { nav.notFound += 1; throw new Error('NEXT_NOT_FOUND'); },
  permanentRedirect: (url: string) => { nav.redirects.push(url); throw new Error('NEXT_REDIRECT'); },
}));

vi.mock('@/db/queries/coaches', () => ({
  getCoach: async (id: number) => (data.coach?.id === id ? data.coach : null),
  getCoachCareer: async (coachId: number) => career(coachId),
}));

vi.mock('@/db/queries/club-comparison', () => ({
  getComparisonOrganizations: async () => [],
}));

vi.mock('@/lib/coach-opponent-history', () => ({
  resolveCoachOpponentSelection: async () => ({ kind: 'none' as const }),
}));

const MALTHOUSE = {
  id: 3, displayName: 'Mick Malthouse', dob: null,
  playerId: 900, playerSlug: 'mick-malthouse',
};
const FAGAN = {
  id: 4, displayName: 'Chris Fagan', dob: null,
  playerId: null, playerSlug: null,
};

function career(coachId: number): CoachCareer {
  const clubs = [{
    clubId: 7, clubName: 'Collingwood', clubSlug: 'collingwood',
    firstSeason: 2000, lastSeason: 2011,
    games: 718, wins: 428, draws: 8, losses: 282,
    finals: 62, grandFinals: 5, premierships: 2, winPct: 60.1,
  }];
  return {
    coachId,
    clubs,
    totals: {
      games: 718, wins: 428, draws: 8, losses: 282,
      finals: 62, grandFinals: 5, premierships: 2, winPct: 60.1,
    },
    biggestWin: {
      matchId: 11, season: 2007, matchDate: new Date('2007-05-05'),
      roundType: 'regular', isFinalsSeries: false,
      coachedClubId: 7, coachedClubName: 'Collingwood', coachedClubSlug: 'collingwood',
      opponentClubId: 9, opponentClubName: 'Carlton', opponentClubSlug: 'carlton',
      margin: 138, venueId: 1, venueName: 'MCG', venueSlug: 'mcg',
    },
    biggestLoss: {
      matchId: 12, season: 2003, matchDate: new Date('2003-06-14'),
      roundType: 'regular', isFinalsSeries: false,
      coachedClubId: 7, coachedClubName: 'Collingwood', coachedClubSlug: 'collingwood',
      opponentClubId: 9, opponentClubName: 'Carlton', opponentClubSlug: 'carlton',
      margin: -95, venueId: 1, venueName: 'MCG', venueSlug: 'mcg',
    },
    venues: [{
      venueId: 1, venueName: 'MCG', venueSlug: 'mcg',
      games: 300, wins: 180, draws: 4, losses: 116, winPct: 60.6,
      finals: 40, grandFinals: 5,
      firstMatchId: 1, firstMatchDate: new Date('2000-03-25'),
      lastMatchId: 99, lastMatchDate: new Date('2011-09-24'),
    }],
  };
}

async function renderCoachPage(slug: string): Promise<string> {
  const page = (await import('@/app/coaches/[slug]/page')).default;
  const html = renderToStaticMarkup(await page({
    params: Promise.resolve({ slug }),
    searchParams: Promise.resolve({}),
  }));
  // Adjacent text nodes can be separated by an empty comment; the assertions
  // below are about content, not about React's text-node boundaries.
  return html.replace(/<!-- -->/g, '');
}

/**
 * Every VISIBLE link out to the player route, with its link text.
 *
 * Deliberately NOT a count of the player URL in the whole document. Since
 * Stage 1E the coach page names that URL in two legitimate places — this
 * anchor, and the `sameAs` of its JSON-LD `Person` — and a server-rendered
 * page names it again in the framework's own payload (the live page carries
 * four occurrences and one anchor). The product claim is about links, so the
 * assertion is about links: scripts are stripped before matching.
 */
function playerAnchors(html: string): { href: string; text: string }[] {
  const visible = html.replace(/<script[\s\S]*?<\/script>/g, '');
  return [...visible.matchAll(/<a[^>]*href="(\/players\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/g)]
    .map((m) => ({ href: m[1], text: m[2].replace(/<[^>]*>/g, '').trim() }));
}

/**
 * The `Person` block. The page emits two JSON-LD scripts — the breadcrumb
 * trail first — so this selects by type rather than by position.
 */
function personSchema(html: string): Record<string, unknown> {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)]
    .map((m) => JSON.parse(m[1].replace(/\\u003c/g, '<')) as Record<string, unknown>);
  const person = blocks.find((b) => b['@type'] === 'Person');
  expect(person, 'the coach page must emit a Person block').toBeDefined();
  return person!;
}

async function coachMetadata(slug: string) {
  const { generateMetadata } = await import('@/app/coaches/[slug]/page');
  return generateMetadata({
    params: Promise.resolve({ slug }),
    searchParams: Promise.resolve({}),
  });
}

beforeEach(() => {
  nav.redirects.length = 0;
  nav.notFound = 0;
  data.coach = null;
});

describe('a player-linked coach gets a coach page, not a redirect (Stage 1E)', () => {
  it('renders the coach profile instead of redirecting to /players', async () => {
    data.coach = MALTHOUSE;
    const html = await renderCoachPage('mick-malthouse-3');

    // The defect: this used to be a permanentRedirect to /players/…-900.
    expect(nav.redirects).toEqual([]);
    expect(nav.notFound).toBe(0);
    expect(html).toContain('Mick Malthouse');
  });

  it('leads with the coaching record, not with a playing career', async () => {
    data.coach = MALTHOUSE;
    const html = await renderCoachPage('mick-malthouse-3');

    // Every headline coaching figure the coach route owes a reader, in the
    // page header/stat strip and the record body beneath it.
    expect(html).toContain('>718<');              // Games
    expect(html).toContain('428–282–8');          // W–L–D, in the stat strip
    expect(html).toContain('W–L–D');
    expect(html).toContain('60.1');               // Win %
    expect(html).toContain('Premierships');
    expect(html).toContain('Coaching record');
    expect(html).toContain('Biggest win and loss');
    expect(html).toContain('Venue history');
    expect(html).toContain('History against club');
    expect(html).toContain('Collingwood');

    // "Primary" means the body of the page IS the coaching record: the
    // playing career contributes no content of its own, only a single
    // secondary link, and none of the player route's controls appear here.
    // (On the player route the relationship is the other way up.)
    expect(playerAnchors(html)).toHaveLength(1);
    expect(html).not.toContain('Compare with another player');
  });

  it('offers "Compare with another coach" as the primary compare action, preselected', async () => {
    data.coach = MALTHOUSE;
    const html = await renderCoachPage('mick-malthouse-3');

    expect(html).toContain('Compare with another coach');
    expect(html).toContain('/coaches/compare?a=3');
    // The player route's action must not appear on the coach route.
    expect(html).not.toContain('Compare with another player');
    expect(html).not.toContain('/players/compare');
  });

  it('links back to the playing career, as a secondary action', async () => {
    data.coach = MALTHOUSE;
    const html = await renderCoachPage('mick-malthouse-3');

    // Exactly one visible link out, and it is the secondary action — not a
    // second copy of the player profile smuggled into the coach route.
    expect(playerAnchors(html)).toEqual([
      { href: '/players/mick-malthouse-900', text: 'View playing career →' },
    ]);
    // Secondary, not a redirect: the reader stays on the coach page.
    expect(nav.redirects).toEqual([]);
  });

  it('canonicalises to the coach URL, never to the player URL', async () => {
    data.coach = MALTHOUSE;
    const meta = await coachMetadata('mick-malthouse-3');

    expect(meta.alternates?.canonical).toBe('/coaches/mick-malthouse-3');
    expect(meta.openGraph?.url).toBe('/coaches/mick-malthouse-3');
    expect(String(meta.title)).toContain('Coaching Record');
  });

  it('declares the player page as the same person in structured data', async () => {
    data.coach = MALTHOUSE;
    const jsonLd = personSchema(await renderCoachPage('mick-malthouse-3'));

    expect(jsonLd['@id']).toMatch(/\/coaches\/mick-malthouse-3#coach$/);
    expect(jsonLd.url).toMatch(/\/coaches\/mick-malthouse-3$/);
    expect(jsonLd.jobTitle).toBe('Australian rules football coach');
    // Two documents, one human — without this they read as two people.
    expect(jsonLd.sameAs).toEqual([expect.stringMatching(/\/players\/mick-malthouse-900$/)]);
  });
});

describe('a coach-only identity keeps working exactly as before', () => {
  it('renders its coach profile', async () => {
    data.coach = FAGAN;
    const html = await renderCoachPage('chris-fagan-4');

    expect(nav.redirects).toEqual([]);
    expect(html).toContain('Chris Fagan');
    expect(html).toContain('Coaching record');
    expect(html).toContain('/coaches/compare?a=4');
  });

  it('offers no playing-career link and claims no player identity', async () => {
    data.coach = FAGAN;
    const html = await renderCoachPage('chris-fagan-4');

    expect(html).not.toContain('View playing career');
    expect(playerAnchors(html)).toEqual([]);
    // A coach-only person has no player page at all, so the URL may not
    // appear anywhere — structured data included.
    expect(html).not.toContain('/players/');
    expect(personSchema(html).sameAs).toBeUndefined();
  });
});

describe('the route resolves in one hop and never loops', () => {
  it('redirects a stale slug ONCE, to the coach route', async () => {
    data.coach = MALTHOUSE;
    await expect(renderCoachPage('michael-malthouse-3')).rejects.toThrow('NEXT_REDIRECT');

    expect(nav.redirects).toEqual(['/coaches/mick-malthouse-3']);
    // The old behaviour redirected a linked coach onward to /players, so a
    // stale slug cost two hops and landed on the wrong presentation.
    expect(nav.redirects[0]).not.toContain('/players/');
  });

  it('does not redirect the canonical URL a redirect points at', async () => {
    data.coach = MALTHOUSE;
    await renderCoachPage('mick-malthouse-3');
    expect(nav.redirects).toEqual([]);
  });

  it('404s an unknown coach id rather than redirecting somewhere', async () => {
    data.coach = MALTHOUSE;
    await expect(renderCoachPage('nobody-99999')).rejects.toThrow('NEXT_NOT_FOUND');

    expect(nav.notFound).toBe(1);
    expect(nav.redirects).toEqual([]);
  });
});

describe('coach-context surfaces link to coach pages (Stage 1E)', () => {
  it('the coaches index links a player-linked coach to their coach page', async () => {
    const { coachProfilePath } = await import('@/lib/format');
    // The entry point the acceptance defect was found through.
    expect(coachProfilePath({ slug: 'mick-malthouse', coachId: 3 })).toBe('/coaches/mick-malthouse-3');
  });
});
