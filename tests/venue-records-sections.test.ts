import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { VenueClubRecords } from '@/components/VenueClubRecords';
import { VenueMatchHistory } from '@/components/VenueMatchHistory';
import { VenuePlayerLeaders } from '@/components/VenuePlayerLeaders';
import { VenueRecords } from '@/components/VenueRecords';
import type {
  VenueClubRecordRow, VenueLeaderRow, VenueMatchBrief, VenuePlayerLeaders as VenuePlayerLeadersData,
  VenueRecords as VenueRecordsData,
} from '@/db/queries/venues';
import { NOT_RECORDED } from '@/lib/format';

/**
 * Rendering of the AFLDB-ISSUE-150 venue-page sections. Query
 * correctness (perspective, deterministic ties, NULL-vs-zero in
 * aggregation) is proven in tests/integration/venue-records.test.ts;
 * these fixtures exercise presentation only — the semantic rules that
 * MUST survive rendering: a NULL crowd is never shown as 0, a real 0 is
 * kept, and the marks/kicks/handballs boards say "Recorded".
 */

function brief(overrides: Partial<VenueMatchBrief> = {}): VenueMatchBrief {
  return {
    id: 1,
    season: 2015,
    matchDate: new Date('2015-05-01T00:00:00Z'),
    roundType: 'home_and_away',
    roundNumber: 5,
    homeName: 'Carlton', homeSlug: 'carlton',
    awayName: 'Essendon', awaySlug: 'essendon',
    homeScore: 100, awayScore: 88,
    attendance: 42000,
    ...overrides,
  };
}

// --- Venue records ---------------------------------------------------

function records(overrides: Partial<VenueRecordsData> = {}): VenueRecordsData {
  return {
    highestAttendance: brief({ id: 10, attendance: 99000 }),
    lowestAttendance: brief({ id: 11, attendance: 12000 }),
    highestScore: {
      ...brief({ id: 12 }),
      scoringClubName: 'Geelong', scoringClubSlug: 'geelong',
      score: 239, opponentScore: 47,
    },
    biggestMargin: { ...brief({ id: 13 }), margin: 190 },
    ...overrides,
  };
}

describe('VenueRecords rendering', () => {
  it('renders all four records with links to the match and clubs', () => {
    const html = renderToStaticMarkup(VenueRecords({ records: records(), venueName: 'MCG' }));
    expect(html).toContain('Highest attendance');
    expect(html).toContain('Lowest recorded attendance');
    expect(html).toContain('Highest team score');
    expect(html).toContain('Biggest winning margin');
    expect(html).toContain('99,000');
    expect(html).toContain('239');
    expect(html).toContain('190 pts');
    expect(html).toContain('href="/matches/10"');
    expect(html).toContain('href="/clubs/geelong"');
  });

  it('shows a NULL lowest attendance as the not-recorded marker, never 0', () => {
    // A venue where no crowd was ever recorded: the query returns null.
    const html = renderToStaticMarkup(VenueRecords({
      records: records({ lowestAttendance: null, highestAttendance: null }),
      venueName: 'Tibby Cotter Ground',
    }));
    expect(html).not.toContain('>0</strong>');
  });

  it('keeps a genuine recorded attendance of 0', () => {
    const html = renderToStaticMarkup(VenueRecords({
      records: records({ lowestAttendance: brief({ id: 14, attendance: 0 }) }),
      venueName: 'Arden Street Oval',
    }));
    // 0 is a real figure here — it must render as "0", inside the row.
    expect(html).toContain('<strong>0</strong>');
    expect(html).not.toContain(`<strong>${NOT_RECORDED}</strong>`);
  });

  it('renders nothing when the venue has no records at all', () => {
    expect(renderToStaticMarkup(VenueRecords({
      records: {
        highestAttendance: null, lowestAttendance: null,
        highestScore: null, biggestMargin: null,
      },
      venueName: 'Nowhere Oval',
    }))).toBe('');
  });
});

// --- Club records --------------------------------------------------

function club(overrides: Partial<VenueClubRecordRow> = {}): VenueClubRecordRow {
  return {
    clubId: 1, clubName: 'South Melbourne', clubSlug: 'south-melbourne',
    games: 10, wins: 4, draws: 2, losses: 4, winPct: 40,
    ...overrides,
  };
}

describe('VenueClubRecords rendering', () => {
  it('lists historical identities separately and links each club', () => {
    const html = renderToStaticMarkup(VenueClubRecords({
      clubs: [
        club({ clubId: 1, clubName: 'South Melbourne', clubSlug: 'south-melbourne' }),
        club({ clubId: 2, clubName: 'Sydney', clubSlug: 'sydney', wins: 6, winPct: 60 }),
      ],
      venueName: 'Lake Oval',
    }));
    expect(html).toContain('South Melbourne');
    expect(html).toContain('Sydney');
    expect(html).toContain('href="/clubs/south-melbourne"');
    expect(html).toContain('href="/clubs/sydney"');
  });

  it('renders win % as given — draws are not folded into wins', () => {
    // 4 wins / 10 games = 40.0, even though there are 2 draws.
    const html = renderToStaticMarkup(VenueClubRecords({
      clubs: [club({ games: 10, wins: 4, draws: 2, losses: 4, winPct: 40 })],
      venueName: 'Lake Oval',
    }));
    expect(html).toContain('40.0');
    expect(html).not.toContain('50.0'); // (4 + 2/2) / 10 would be 50 — must not appear
  });

  it('renders nothing for a venue with no club records', () => {
    expect(renderToStaticMarkup(VenueClubRecords({ clubs: [], venueName: 'Nowhere' }))).toBe('');
  });
});

// --- Player leaders ----------------------------------------------

function leader(overrides: Partial<VenueLeaderRow> = {}): VenueLeaderRow {
  return {
    rank: 1, playerId: 7, playerName: 'Leigh Matthews', playerSlug: 'leigh-matthews',
    value: 332, recordedGames: 332,
    ...overrides,
  };
}

function leaders(overrides: Partial<VenuePlayerLeadersData> = {}): VenuePlayerLeadersData {
  return {
    games: [leader({ value: 200, recordedGames: 200 })],
    goals: [leader({ playerId: 8, playerName: 'Tony Lockett', playerSlug: 'tony-lockett', value: 500, recordedGames: 180 })],
    marks: [leader({ playerId: 9, playerName: 'A Ruckman', playerSlug: 'a-ruckman', value: 900, recordedGames: 150 })],
    kicks: [leader({ playerId: 10, playerName: 'A Midfielder', playerSlug: 'a-midfielder', value: 2000, recordedGames: 150 })],
    handballs: [leader({ playerId: 11, playerName: 'B Midfielder', playerSlug: 'b-midfielder', value: 1500, recordedGames: 150 })],
    ...overrides,
  };
}

describe('VenuePlayerLeaders rendering', () => {
  it('labels marks, kicks and handballs boards "Recorded" and shows the denominator', () => {
    const html = renderToStaticMarkup(VenuePlayerLeaders({ leaders: leaders(), venueName: 'MCG' }));
    expect(html).toContain('Recorded marks');
    expect(html).toContain('Recorded kicks');
    expect(html).toContain('Recorded handballs');
    expect(html).toContain('Rec. games');
    // The games board is not a "recorded" statistic.
    expect(html).toContain('Games at MCG');
  });

  it('links every player', () => {
    const html = renderToStaticMarkup(VenuePlayerLeaders({ leaders: leaders(), venueName: 'MCG' }));
    expect(html).toContain('href="/players/tony-lockett-8"');
    expect(html).toContain('href="/players/leigh-matthews-7"');
  });

  it('renders nothing when every board is empty', () => {
    expect(renderToStaticMarkup(VenuePlayerLeaders({
      leaders: { games: [], goals: [], marks: [], kicks: [], handballs: [] },
      venueName: 'Nowhere',
    }))).toBe('');
  });
});

// --- Match history ---------------------------------------------

describe('VenueMatchHistory rendering', () => {
  it('links date/clubs and shows a NULL crowd as the not-recorded marker', () => {
    const html = renderToStaticMarkup(VenueMatchHistory({
      matches: [
        brief({ id: 21, attendance: null }),
        brief({ id: 22, attendance: 0 }),
      ],
      venueName: 'MCG', from: 1, to: 2, total: 2,
    }));
    expect(html).toContain('href="/matches/21"');
    expect(html).toContain('href="/clubs/carlton"');
    // Row 21 crowd cell shows the marker; row 22 keeps a real 0.
    expect(html).toContain(`${NOT_RECORDED}</td></tr>`);
    expect(html).toContain('>0</td></tr>');
  });

  it('renders rows in the order given (the query orders newest first)', () => {
    const html = renderToStaticMarkup(VenueMatchHistory({
      matches: [
        brief({ id: 30, matchDate: new Date('2020-08-01T00:00:00Z') }),
        brief({ id: 31, matchDate: new Date('2019-08-01T00:00:00Z') }),
      ],
      venueName: 'MCG', from: 1, to: 2, total: 2,
    }));
    expect(html.indexOf('/matches/30')).toBeLessThan(html.indexOf('/matches/31'));
  });
});
