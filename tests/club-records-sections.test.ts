import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ClubCrowdRecords } from '@/components/ClubCrowdRecords';
import { ClubHonours } from '@/components/ClubHonours';
import { ClubMatchRecords } from '@/components/ClubMatchRecords';
import { ClubPlayers } from '@/components/ClubPlayers';
import { ClubPremiershipPlayers } from '@/components/ClubPremiershipPlayers';
import type {
  ClubCrowdRecordRow, ClubMatchRecordRow, ClubPlayerRow, ClubPremiershipPlayerRow,
} from '@/db/queries/clubs';
import type { ClubBrownlowMedallistRow, ClubHonourRow } from '@/db/queries/awards';
import { NOT_RECORDED } from '@/lib/format';

/**
 * Rendering of the five club-page sections added for AFLDB-ISSUE-149.
 * Query correctness (perspective flip, lineage scope, attribution,
 * deterministic ties) is proven in the matching
 * tests/integration/club-*.test.ts; these fixtures exercise presentation
 * only: score orientation, links, empty state, not-recorded handling.
 *
 * Source-safe escape for the en dash the components render between scores
 * and in a season range.
 */
const EN_DASH = '\u2013';

// --- Club records ------------------------------------------------------

function matchRecord(overrides: Partial<ClubMatchRecordRow> = {}): ClubMatchRecordRow {
  return {
    kind: 'biggest_win',
    value: 86,
    matchId: 1,
    season: 2019,
    matchDate: new Date('2019-06-01T00:00:00Z'),
    crowd: 41000,
    roundType: 'home_and_away',
    roundNumber: 12,
    clubScore: 150,
    opponentScore: 64,
    opponentId: 5,
    opponentName: 'Carlton',
    opponentSlug: 'carlton',
    venueName: 'MCG',
    venueSlug: 'mcg',
    ...overrides,
  };
}

describe('ClubMatchRecords rendering', () => {
  it('renders every record label present in the data', () => {
    const html = renderToStaticMarkup(ClubMatchRecords({
      records: [
        matchRecord({ kind: 'biggest_win', value: 86 }),
        matchRecord({ kind: 'lowest_scoring_match', value: 40, clubScore: 20, opponentScore: 20 }),
      ],
      clubRecordName: 'Richmond',
      hasLineage: false,
    }));
    expect(html).toContain('Biggest win');
    expect(html).toContain('Lowest-scoring match');
    expect(html).toContain('86-point win');
    expect(html).toContain('40 points combined');
  });

  it('shows the score from the club perspective and links opponent + venue', () => {
    const html = renderToStaticMarkup(ClubMatchRecords({
      records: [matchRecord()], clubRecordName: 'Richmond', hasLineage: false,
    }));
    expect(html).toContain(`150${EN_DASH}64`);
    expect(html).not.toContain(`64${EN_DASH}150`);
    expect(html).toContain('href="/clubs/carlton"');
    expect(html).toContain('href="/venues/mcg"');
  });

  it('never shows a null crowd as zero', () => {
    const html = renderToStaticMarkup(ClubMatchRecords({
      records: [matchRecord({ crowd: null })], clubRecordName: 'Richmond', hasLineage: false,
    }));
    // The crowd cell (last in the row) shows the not-recorded marker.
    expect(html).toContain(`${NOT_RECORDED}</td></tr>`);
    expect(html).not.toContain('>0</td></tr>');
  });

  it('renders nothing when there are no records', () => {
    expect(renderToStaticMarkup(ClubMatchRecords({
      records: [], clubRecordName: 'Gold Coast', hasLineage: false,
    }))).toBe('');
  });
});

// --- Record crowds ---------------------------------------------------

function crowdRow(overrides: Partial<ClubCrowdRecordRow> = {}): ClubCrowdRecordRow {
  return {
    kind: 'top',
    matchId: 10,
    season: 2017,
    matchDate: new Date('2017-09-30T00:00:00Z'),
    crowd: 100021,
    roundType: 'grand_final',
    roundNumber: null,
    clubScore: 108,
    opponentScore: 60,
    opponentId: 1,
    opponentName: 'Adelaide',
    opponentSlug: 'adelaide',
    venueName: 'MCG',
    venueSlug: 'mcg',
    ...overrides,
  };
}

describe('ClubCrowdRecords rendering', () => {
  it('renders record labels, the Top 5 rank, and formatted crowds', () => {
    const html = renderToStaticMarkup(ClubCrowdRecords({
      records: [crowdRow({ kind: 'record_grand_final' })],
      top: [crowdRow({ matchId: 10 }), crowdRow({ matchId: 11, crowd: 99000 })],
      clubRecordName: 'Richmond',
      hasLineage: false,
    }));
    expect(html).toContain('Highest Grand Final crowd');
    expect(html).toContain('100,021');
    expect(html).toContain('href="/clubs/adelaide"');
    expect(html).toContain(`108${EN_DASH}60`);
  });

  it('renders nothing when there are no crowd records at all', () => {
    expect(renderToStaticMarkup(ClubCrowdRecords({
      records: [], top: [], clubRecordName: 'Gold Coast', hasLineage: false,
    }))).toBe('');
  });
});

// --- Complete players list ------------------------------------------

function player(overrides: Partial<ClubPlayerRow> = {}): ClubPlayerRow {
  return {
    id: 7, slug: 'kevin-bartlett', displayName: 'Kevin Bartlett',
    games: 403, goals: 778, firstSeason: 1965, lastSeason: 1983,
    ...overrides,
  };
}

describe('ClubPlayers rendering', () => {
  it('links players, renders a multi-season range and a single-season year', () => {
    const html = renderToStaticMarkup(ClubPlayers({
      players: [
        player(),
        player({ id: 8, slug: 'one-gamer', displayName: 'One Gamer', games: 1, goals: 0, firstSeason: 1998, lastSeason: 1998 }),
      ],
      clubRecordName: 'Richmond',
      hasLineage: false,
    }));
    expect(html).toContain('href="/players/kevin-bartlett-7"');
    expect(html).toContain(`1965${EN_DASH}1983`);
    expect(html).toContain('>1998<');
  });

  it('renders nothing for a club with no players', () => {
    expect(renderToStaticMarkup(ClubPlayers({
      players: [], clubRecordName: 'Nowhere', hasLineage: false,
    }))).toBe('');
  });
});

// --- Premiership players ------------------------------------------

function premPlayer(overrides: Partial<ClubPremiershipPlayerRow> = {}): ClubPremiershipPlayerRow {
  return {
    season: 2020, playerId: 3, playerSlug: 'dustin-martin', playerName: 'Dustin Martin',
    games: 21, finals: 4, goals: 25, identityName: 'Richmond',
    ...overrides,
  };
}

describe('ClubPremiershipPlayers rendering', () => {
  it('groups by season with the newest first and links players', () => {
    const html = renderToStaticMarkup(ClubPremiershipPlayers({
      players: [
        premPlayer({ season: 2020 }),
        premPlayer({ season: 2019, playerId: 4, playerSlug: 'trent-cotchin', playerName: 'Trent Cotchin' }),
      ],
      clubRecordName: 'Richmond',
      hasLineage: false,
    }));
    expect(html).toContain('href="/players/dustin-martin-3"');
    expect(html.indexOf('2020')).toBeLessThan(html.indexOf('2019'));
    expect(html).toContain('2 premiership sides');
  });

  it('renders a null goal count as the not-recorded marker, never 0', () => {
    const html = renderToStaticMarkup(ClubPremiershipPlayers({
      players: [premPlayer({ goals: null })], clubRecordName: 'Richmond', hasLineage: false,
    }));
    // Goals is the last cell of the row.
    expect(html).toContain(`${NOT_RECORDED}</td></tr>`);
  });

  it('renders nothing for a club with no premiership players', () => {
    expect(renderToStaticMarkup(ClubPremiershipPlayers({
      players: [], clubRecordName: 'Gold Coast', hasLineage: false,
    }))).toBe('');
  });
});

// --- Awards & honours ------------------------------------------

function brownlowRow(overrides: Partial<ClubBrownlowMedallistRow> = {}): ClubBrownlowMedallistRow {
  return {
    season: 1997, playerId: 9, playerSlug: 'player-nine', playerName: 'Player Nine',
    votes: 22, identityName: 'Richmond',
    ...overrides,
  };
}

function honourRow(overrides: Partial<ClubHonourRow> = {}): ClubHonourRow {
  return {
    id: 100, awardSlug: 'coleman-medal', awardName: 'Coleman Medal', season: 2019,
    playerId: 3, playerSlug: 'tom-lynch', playerName: 'Tom Lynch',
    linkStatus: 'unique', identityName: 'Richmond',
    ...overrides,
  };
}

describe('ClubHonours rendering', () => {
  it('renders both the Brownlow table and the national-honours table', () => {
    const html = renderToStaticMarkup(ClubHonours({
      brownlow: [brownlowRow()],
      honours: [honourRow()],
      clubRecordName: 'Richmond',
      hasLineage: false,
    }));
    expect(html).toContain('Brownlow Medal');
    expect(html).toContain('Coleman Medal');
    expect(html).toContain('href="/players/tom-lynch-3"');
    expect(html).toContain('>1997<');
  });

  it('renders an unlinked honour winner as plain text with no player link', () => {
    const html = renderToStaticMarkup(ClubHonours({
      brownlow: [],
      honours: [honourRow({ playerId: null, playerSlug: null, linkStatus: 'unresolved', playerName: 'Old Timer' })],
      clubRecordName: 'Fitzroy',
      hasLineage: false,
    }));
    expect(html).toContain('Old Timer');
    expect(html).not.toContain('href="/players/');
  });

  it('renders nothing when the club has neither Brownlow winners nor honours', () => {
    expect(renderToStaticMarkup(ClubHonours({
      brownlow: [], honours: [], clubRecordName: 'Gold Coast', hasLineage: false,
    }))).toBe('');
  });
});
