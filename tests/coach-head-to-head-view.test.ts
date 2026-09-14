import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { CoachHeadToHeadSection } from '@/components/CoachHeadToHead';
import type { ResolvedCoach } from '@/app/coaches/compare/state';
import type { CoachCareerMatch, CoachHeadToHead, CoachHeadToHeadVenueRecord } from '@/db/queries/coaches';

/**
 * AFLDB-ISSUE-170 Stage 2C — the direct coach-v-coach head-to-head section.
 *
 * A plain prop-to-JSX renderer (no data fetching, no hooks -- the same
 * `renderToStaticMarkup` convention `coach-comparison-career.test.ts`
 * already uses), so this proves the presentation renders
 * {@link getCoachHeadToHead}'s shape correctly. It deliberately does not
 * re-prove any query statistic -- that stays
 * tests/integration/coach-head-to-head.test.ts's job.
 */

function resolvedCoach(overrides: Partial<ResolvedCoach['coach']> = {}, profilePath?: string): ResolvedCoach {
  const coach = {
    id: 1, displayName: 'Coach One', dob: null, playerId: null, playerSlug: null, ...overrides,
  };
  return { coach, profilePath: profilePath ?? `/coaches/coach-one-${coach.id}` };
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

function venue(overrides: Partial<CoachHeadToHeadVenueRecord> = {}): CoachHeadToHeadVenueRecord {
  return {
    venueId: 3, venueName: 'MCG', venueSlug: 'mcg', meetings: 10, aWins: 6, bWins: 3, draws: 1,
    aWinPct: 65, bWinPct: 35, finals: 2, grandFinals: 0,
    firstMeetingDate: new Date('1990-04-01'), lastMeetingDate: new Date('1999-09-01'),
    ...overrides,
  };
}

function headToHead(overrides: Partial<CoachHeadToHead> = {}): CoachHeadToHead {
  return {
    coachAId: 1,
    coachBId: 2,
    totals: {
      meetings: 10, aWins: 6, bWins: 3, draws: 1, aWinPct: 65, bWinPct: 35, finals: 2, grandFinals: 0,
    },
    biggestWinA: match({ margin: 50, coachedClubName: 'Collingwood', coachedClubSlug: 'collingwood' }),
    biggestWinB: match({
      matchId: 556, margin: 30, coachedClubId: 2, coachedClubName: 'Essendon', coachedClubSlug: 'essendon',
      opponentClubId: 1, opponentClubName: 'Collingwood', opponentClubSlug: 'collingwood',
    }),
    venues: [venue()],
    ...overrides,
  };
}

const coachA = resolvedCoach({ id: 1, displayName: 'Alastair Clarkson' });
const coachB = resolvedCoach({ id: 2, displayName: 'Chris Scott' });

describe('CoachHeadToHeadSection', () => {
  it('renders meetings, wins, draws and win % for both coaches', () => {
    const html = renderToStaticMarkup(
      CoachHeadToHeadSection({ coachA, coachB, headToHead: headToHead() }),
    );
    expect(html).toContain('Alastair Clarkson wins');
    expect(html).toContain('Chris Scott wins');
    expect(html).toContain('>6<');
    expect(html).toContain('>3<');
    expect(html).toContain('65');
    expect(html).toContain('35');
  });

  it('renders finals and Grand Final meeting counts', () => {
    const html = renderToStaticMarkup(
      CoachHeadToHeadSection({
        coachA, coachB,
        headToHead: headToHead({ totals: { meetings: 10, aWins: 6, bWins: 3, draws: 1, aWinPct: 65, bWinPct: 35, finals: 4, grandFinals: 2 } }),
      }),
    );
    expect(html).toContain('Finals');
    expect(html).toContain('Grand Finals');
    expect(html).toContain('>4<');
    expect(html).toContain('>2<');
  });

  it("renders each coach's biggest direct win, labelled by name, not as a generic win/loss pair", () => {
    const html = renderToStaticMarkup(
      CoachHeadToHeadSection({ coachA, coachB, headToHead: headToHead() }),
    );
    expect(html).toContain('Alastair Clarkson’s biggest win');
    expect(html).toContain('Chris Scott’s biggest win');
    expect(html).toContain('+50');
    expect(html).toContain('+30');
  });

  it('renders direct-meeting venue history', () => {
    const html = renderToStaticMarkup(
      CoachHeadToHeadSection({ coachA, coachB, headToHead: headToHead() }),
    );
    expect(html).toContain('MCG');
    expect(html).toContain('Venue history');
  });

  it('gives coach B a null biggest win an explicit "no qualifying win" cell, never a fabricated zero-margin match', () => {
    const html = renderToStaticMarkup(
      CoachHeadToHeadSection({ coachA, coachB, headToHead: headToHead({ biggestWinB: null }) }),
    );
    expect(html).toContain('No qualifying win on record');
    expect(html).not.toContain('+0');
    // Coach A's real win still renders alongside it.
    expect(html).toContain('+50');
  });

  it('renders a deliberate "never met" message for a real, distinct pair with zero meetings, never a table of zeros', () => {
    const html = renderToStaticMarkup(
      CoachHeadToHeadSection({
        coachA, coachB,
        headToHead: {
          coachAId: 1, coachBId: 2,
          totals: { meetings: 0, aWins: 0, bWins: 0, draws: 0, aWinPct: null, bWinPct: null, finals: 0, grandFinals: 0 },
          biggestWinA: null, biggestWinB: null, venues: [],
        },
      }),
    );
    expect(html).toContain('coaching');
    expect(html).toContain('Alastair Clarkson');
    expect(html).toContain('Chris Scott');
    expect(html).not.toContain('Meetings');
    expect(html).not.toContain('Venue history');
  });

  it('fails safely with an explicit message when head-to-head data fails to resolve, never throwing', () => {
    expect(() => renderToStaticMarkup(
      CoachHeadToHeadSection({ coachA, coachB, headToHead: null }),
    )).not.toThrow();
    const html = renderToStaticMarkup(
      CoachHeadToHeadSection({ coachA, coachB, headToHead: null }),
    );
    expect(html).toContain('Direct head-to-head data is not currently available');
    expect(html).toContain('Alastair Clarkson');
    expect(html).toContain('Chris Scott');
  });

  it('swaps presentation and every oriented value when coachA/coachB and the data are both swapped', () => {
    const forward = renderToStaticMarkup(
      CoachHeadToHeadSection({ coachA, coachB, headToHead: headToHead() }),
    );
    const swapped = renderToStaticMarkup(
      CoachHeadToHeadSection({
        coachA: coachB,
        coachB: coachA,
        headToHead: headToHead({
          coachAId: 2, coachBId: 1,
          totals: { meetings: 10, aWins: 3, bWins: 6, draws: 1, aWinPct: 35, bWinPct: 65, finals: 2, grandFinals: 0 },
          biggestWinA: match({
            matchId: 556, margin: 30, coachedClubId: 2, coachedClubName: 'Essendon', coachedClubSlug: 'essendon',
            opponentClubId: 1, opponentClubName: 'Collingwood', opponentClubSlug: 'collingwood',
          }),
          biggestWinB: match({ margin: 50, coachedClubName: 'Collingwood', coachedClubSlug: 'collingwood' }),
        }),
      }),
    );

    // Forward: Clarkson (A) has 6 wins, presented first.
    expect(forward.indexOf('Alastair Clarkson')).toBeLessThan(forward.indexOf('Chris Scott'));
    expect(forward).toContain('Alastair Clarkson wins');
    // Swapped: Scott is now "A" and carries the 6-wins figure; Clarkson carries 3.
    expect(swapped.indexOf('Chris Scott')).toBeLessThan(swapped.indexOf('Alastair Clarkson'));
    expect(swapped).toContain('Chris Scott wins');

    // Each coach's own biggest win stays theirs regardless of A/B position.
    expect(forward).toContain('+50');
    expect(swapped).toContain('+50');
  });
});
