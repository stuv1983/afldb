import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ClubCoachRecords } from '@/components/ClubCoachRecords';
import type { ClubCoachRecordRow } from '@/db/queries/coaches';

/**
 * Rendering of the club page's club-specific coaching section
 * (AFLDB-ISSUE-148). The club-specific / W-D-L / tenure semantics are the
 * query's job and are proven in tests/integration/club-coach-records.test.ts;
 * these fixtures only exercise the presentation.
 */
function row(overrides: Partial<ClubCoachRecordRow> = {}): ClubCoachRecordRow {
  return {
    coachId: 1,
    displayName: 'Damien Hardwick',
    coachOnly: false,
    playerId: 10,
    playerSlug: 'damien-hardwick',
    firstSeason: 2010,
    lastSeason: 2023,
    seasons: 14,
    games: 307,
    wins: 170,
    draws: 6,
    losses: 131,
    winPct: '56.35',
    ...overrides,
  };
}

describe('ClubCoachRecords rendering', () => {
  it('renders the expected column headings', () => {
    const html = renderToStaticMarkup(
      ClubCoachRecords({ records: [row()], clubRecordName: 'Richmond', hasLineage: false }),
    );
    for (const heading of ['Coach', 'Span', 'Games', '>W<', '>D<', '>L<', 'Win %']) {
      expect(html).toContain(heading);
    }
  });

  it('shows the coach and their club record W / D / L', () => {
    const html = renderToStaticMarkup(
      ClubCoachRecords({ records: [row()], clubRecordName: 'Richmond', hasLineage: false }),
    );
    expect(html).toContain('Damien Hardwick');
    expect(html).toContain('307');
    expect(html).toContain('170');
    expect(html).toContain('131');
    // Win % uses the repository's one-decimal percentage formatting.
    expect(html).toContain('56.4');
  });

  it('links a coach who also played to their player profile', () => {
    const html = renderToStaticMarkup(
      ClubCoachRecords({ records: [row()], clubRecordName: 'Richmond', hasLineage: false }),
    );
    expect(html).toContain('href="/players/damien-hardwick-10"');
  });

  it('links a coach-only person to the coach route, derived from their name', () => {
    const html = renderToStaticMarkup(
      ClubCoachRecords({
        records: [row({
          coachId: 42, displayName: 'Chris Fagan', coachOnly: true,
          playerId: null, playerSlug: null,
        })],
        clubRecordName: 'Brisbane Lions',
        hasLineage: false,
      }),
    );
    expect(html).toContain('href="/coaches/chris-fagan-42"');
  });

  it('formats a single-season tenure as one year, not a repeated range', () => {
    const html = renderToStaticMarkup(
      ClubCoachRecords({
        records: [row({ displayName: 'Jade Rawlings', firstSeason: 2009, lastSeason: 2009 })],
        clubRecordName: 'Richmond',
        hasLineage: false,
      }),
    );
    expect(html).toContain('>2009<');
    // Source-safe escape for the en dash formatSpan would put in a range.
    expect(html).not.toContain('2009\u20132009');
  });

  it('renders one row per coach', () => {
    const html = renderToStaticMarkup(
      ClubCoachRecords({
        records: [
          row({ coachId: 1, displayName: 'Adem Yze' }),
          row({ coachId: 2, displayName: 'Damien Hardwick' }),
        ],
        clubRecordName: 'Richmond',
        hasLineage: false,
      }),
    );
    expect(html).toContain('Adem Yze');
    expect(html).toContain('Damien Hardwick');
  });

  it('renders nothing when the club has no coaching data', () => {
    const html = renderToStaticMarkup(
      ClubCoachRecords({ records: [], clubRecordName: 'Some Club', hasLineage: false }),
    );
    expect(html).toBe('');
  });

  it('notes the whole-club scope only when the club has more than one era', () => {
    const withLineage = renderToStaticMarkup(
      ClubCoachRecords({ records: [row()], clubRecordName: 'Western Bulldogs', hasLineage: true }),
    );
    expect(withLineage).toContain('across every era of the club');

    const withoutLineage = renderToStaticMarkup(
      ClubCoachRecords({ records: [row()], clubRecordName: 'Richmond', hasLineage: false }),
    );
    expect(withoutLineage).not.toContain('across every era of the club');
  });
});
