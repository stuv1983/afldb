import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ClubPremierships } from '@/components/ClubPremierships';
import type { ClubPremiershipRow } from '@/db/queries/clubs';
import { NOT_RECORDED } from '@/lib/format';

/**
 * Rendering of the club page's Premierships section (AFLDB-ISSUE-148).
 * The Grand Final predicate, club-specific filtering and score/opponent
 * derivation are the query's job and are proven in
 * tests/integration/club-premierships.test.ts; these fixtures only
 * exercise the presentation.
 */
function row(overrides: Partial<ClubPremiershipRow> = {}): ClubPremiershipRow {
  return {
    matchId: 15776,
    year: 2020,
    matchDate: new Date('2020-10-24T00:00:00Z'),
    crowd: 29707,
    clubScore: 81,
    opponentScore: 50,
    opponentId: 10,
    opponentName: 'Geelong',
    opponentSlug: 'geelong',
    venueId: 19,
    venueName: 'Gabba',
    venueSlug: 'gabba',
    ...overrides,
  };
}

describe('ClubPremierships rendering', () => {
  it('renders the expected column headings', () => {
    const html = renderToStaticMarkup(
      ClubPremierships({ premierships: [row()], clubRecordName: 'Richmond', hasLineage: false }),
    );
    for (const heading of ['Year', 'Opponent', 'Score', 'Venue', 'Date', 'Crowd']) {
      expect(html).toContain(heading);
    }
  });

  it('shows the score from the premiership club perspective, winner first', () => {
    const html = renderToStaticMarkup(
      ClubPremierships({ premierships: [row()], clubRecordName: 'Richmond', hasLineage: false }),
    );
    expect(html).toContain('81-50');
    expect(html).not.toContain('50-81');
  });

  it('links the opponent to its club page and the venue to its venue page', () => {
    const html = renderToStaticMarkup(
      ClubPremierships({ premierships: [row()], clubRecordName: 'Richmond', hasLineage: false }),
    );
    expect(html).toContain('href="/clubs/geelong"');
    expect(html).toContain('href="/venues/gabba"');
    expect(html).toContain('>Geelong<');
  });

  it('shows a venue with no canonical page as plain text', () => {
    const html = renderToStaticMarkup(
      ClubPremierships({
        premierships: [row({ venueId: null, venueName: 'Junction Oval', venueSlug: null })],
        clubRecordName: 'Fitzroy',
        hasLineage: false,
      }),
    );
    expect(html).toContain('Junction Oval');
    expect(html).not.toContain('href="/venues/');
  });

  it('formats the date and crowd with the site helpers', () => {
    const html = renderToStaticMarkup(
      ClubPremierships({ premierships: [row()], clubRecordName: 'Richmond', hasLineage: false }),
    );
    // formatDate -> "24 Oct 2020"; formatAttendance -> "29,707"
    expect(html).toContain('2020');
    expect(html).toContain('29,707');
  });

  it('never manufactures a crowd when attendance is null', () => {
    const html = renderToStaticMarkup(
      ClubPremierships({
        premierships: [row({ crowd: null })],
        clubRecordName: 'Richmond',
        hasLineage: false,
      }),
    );
    // The crowd cell shows the site's not-recorded marker, never 0 or a made-up figure.
    expect(html).toContain(`${NOT_RECORDED}</td></tr>`);
    expect(html).not.toContain('29,707');
  });

  it('renders one row per premiership, newest first as given', () => {
    const html = renderToStaticMarkup(
      ClubPremierships({
        premierships: [
          row({ matchId: 15776, year: 2020 }),
          row({
            matchId: 15200, year: 2017,
            matchDate: new Date('2017-09-30T00:00:00Z'),
            opponentName: 'Adelaide', opponentSlug: 'adelaide',
          }),
        ],
        clubRecordName: 'Richmond',
        hasLineage: false,
      }),
    );
    const first = html.indexOf('2020');
    const second = html.indexOf('2017');
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
  });

  it('renders nothing when the club has no premierships', () => {
    const html = renderToStaticMarkup(
      ClubPremierships({ premierships: [], clubRecordName: 'Gold Coast', hasLineage: false }),
    );
    expect(html).toBe('');
  });

  it('notes the whole-club scope only when the club has more than one era', () => {
    const withLineage = renderToStaticMarkup(
      ClubPremierships({ premierships: [row()], clubRecordName: 'Western Bulldogs', hasLineage: true }),
    );
    expect(withLineage).toContain('across every era of the club');

    const withoutLineage = renderToStaticMarkup(
      ClubPremierships({ premierships: [row()], clubRecordName: 'Richmond', hasLineage: false }),
    );
    expect(withoutLineage).not.toContain('across every era of the club');
  });
});
