import { describe, expect, it } from 'vitest';

import {
  NOT_RECORDED,
  formatHallOfFameClub,
  formatRound,
  formatRoundShort,
  formatScore,
  formatSpan,
  formatSpanLabel,
  formatStat,
  isNonAflClub,
  isNonPlayerHallOfFameCategory,
  parseEntitySlug,
  playerPath,
  shouldShowUnmatched,
} from '@/lib/format';

describe('formatStat', () => {
  // The central data-correctness rule of the whole site.
  it('renders null as "not recorded", never as zero', () => {
    expect(formatStat(null)).toBe(NOT_RECORDED);
    expect(formatStat(undefined)).toBe(NOT_RECORDED);
  });

  it('renders a genuine zero as 0', () => {
    expect(formatStat(0)).toBe('0');
  });

  it('groups thousands', () => {
    expect(formatStat(1234)).toBe('1,234');
  });
});

describe('formatScore', () => {
  it('renders goals, behinds and points', () => {
    expect(formatScore(12, 8, 80)).toBe('12.8 (80)');
  });

  it('falls back to points when the breakdown was not recorded', () => {
    expect(formatScore(null, null, 80)).toBe('80');
  });
});

describe('formatSpan', () => {
  it('renders a closed career span', () => {
    expect(formatSpan(2002, 2020)).toBe('2002–2020');
  });

  it('renders a single season without a range', () => {
    expect(formatSpan(1952, 1952)).toBe('1952');
  });

  it('leaves an ongoing career open-ended', () => {
    expect(formatSpan(2018, 2026, true)).toBe('2018–');
  });

  it('reports an unknown span as not recorded', () => {
    expect(formatSpan(null, null)).toBe(NOT_RECORDED);
  });
});

describe('formatSpanLabel', () => {
  it('renders a span between two season labels', () => {
    expect(formatSpanLabel('2017', 'Season Seven')).toBe('2017–Season Seven');
  });

  it('collapses a single season to one label', () => {
    expect(formatSpanLabel('Season Six', 'Season Six')).toBe('Season Six');
  });

  it('reports an unknown span as not recorded', () => {
    expect(formatSpanLabel(null, null)).toBe(NOT_RECORDED);
  });
});

describe('formatRound', () => {
  it('numbers a home-and-away round', () => {
    expect(formatRound('home_and_away', 12)).toBe('Round 12');
    expect(formatRoundShort('home_and_away', 12)).toBe('R12');
  });

  it('names a final from its type', () => {
    expect(formatRound('grand_final', null)).toBe('Grand Final');
    expect(formatRoundShort('grand_final', null)).toBe('GF');
  });

  // AFLDB-ISSUE-129. Every AFL call site passes NO fallback — only AFLW carries a
  // round_code to fall back to — so without a map entry these would render as the
  // bare identifier "wildcard_final", including as a season-page heading and its
  // anchor id. The no-fallback call shape is the point of this test.
  it('names a Wildcard Final with no fallback available', () => {
    expect(formatRound('wildcard_final', null)).toBe('Wildcard Final');
    expect(formatRoundShort('wildcard_final', null)).toBe('WF');
  });

  // A round type this map has never seen, or a home-and-away row with no
  // number, must not render as an identifier or as "Rnull".
  it('falls back to the source label for an unknown type', () => {
    expect(formatRound('finals_week_1', null, 'Finals Week 1')).toBe('Finals Week 1');
    expect(formatRoundShort('finals_week_1', null, 'FW1')).toBe('FW1');
  });

  it('falls back when a home-and-away round has no number', () => {
    expect(formatRoundShort('home_and_away', null, 'Opening Round')).toBe('Opening Round');
    expect(formatRoundShort('home_and_away', null)).toBe(NOT_RECORDED);
  });
});

describe('parseEntitySlug', () => {
  it('splits a slug and trailing id', () => {
    expect(parseEntitySlug('scott-pendlebury-4182')).toEqual({
      slug: 'scott-pendlebury',
      id: 4182,
    });
  });

  it('handles a name that itself ends in a number', () => {
    expect(parseEntitySlug('player-2-99')).toEqual({ slug: 'player-2', id: 99 });
  });

  it('rejects a slug with no id', () => {
    expect(parseEntitySlug('scott-pendlebury')).toBeNull();
  });

  it('rejects a non-positive id', () => {
    expect(parseEntitySlug('someone-0')).toBeNull();
  });

  it('round-trips with playerPath', () => {
    const path = playerPath('gary-ablett', 1105);
    expect(path).toBe('/players/gary-ablett-1105');
    expect(parseEntitySlug(path.replace('/players/', ''))).toEqual({
      slug: 'gary-ablett',
      id: 1105,
    });
  });
});

describe('isNonPlayerHallOfFameCategory', () => {
  it('identifies non-player categories', () => {
    expect(isNonPlayerHallOfFameCategory('media')).toBe(true);
    expect(isNonPlayerHallOfFameCategory('Media')).toBe(true);
    expect(isNonPlayerHallOfFameCategory('umpire')).toBe(true);
    expect(isNonPlayerHallOfFameCategory('Umpire')).toBe(true);
    expect(isNonPlayerHallOfFameCategory('administrator')).toBe(true);
    expect(isNonPlayerHallOfFameCategory('Administrator')).toBe(true);
    expect(isNonPlayerHallOfFameCategory('pioneer')).toBe(true);
    expect(isNonPlayerHallOfFameCategory('Pioneer')).toBe(true);
  });

  it('returns false for player, coach, legend, or null', () => {
    expect(isNonPlayerHallOfFameCategory('player')).toBe(false);
    expect(isNonPlayerHallOfFameCategory('Player')).toBe(false);
    expect(isNonPlayerHallOfFameCategory('coach')).toBe(false);
    expect(isNonPlayerHallOfFameCategory('legend')).toBe(false);
    expect(isNonPlayerHallOfFameCategory(null)).toBe(false);
    expect(isNonPlayerHallOfFameCategory(undefined)).toBe(false);
    expect(isNonPlayerHallOfFameCategory('')).toBe(false);
  });
});

describe('formatHallOfFameClub', () => {
  it('returns null for non-player categories', () => {
    expect(formatHallOfFameClub('Melbourne', 'media', null)).toBeNull();
    expect(formatHallOfFameClub('Collingwood', 'Umpire', null)).toBeNull();
    expect(formatHallOfFameClub('Carlton', 'administrator', null)).toBeNull();
    expect(formatHallOfFameClub('Essendon', 'pioneer', null)).toBeNull();
  });

  it('appends (AFLW) for AFLW player inductees', () => {
    expect(formatHallOfFameClub('Melbourne', 'player', 'daisy-pearce')).toBe('Melbourne (AFLW)');
    expect(formatHallOfFameClub('Adelaide, Port Adelaide', 'player', 'erin-phillips')).toBe(
      'Adelaide, Port Adelaide (AFLW)',
    );
  });

  it('avoids duplicating (AFLW) if already present', () => {
    expect(formatHallOfFameClub('Melbourne (AFLW)', 'player', 'daisy-pearce')).toBe(
      'Melbourne (AFLW)',
    );
  });

  it('returns raw club name for regular AFL players', () => {
    expect(formatHallOfFameClub('Hawthorn', 'player', null)).toBe('Hawthorn');
    expect(formatHallOfFameClub('Fitzroy, Brisbane Lions', 'player', null)).toBe(
      'Fitzroy, Brisbane Lions',
    );
  });

  it('returns null when clubNameRaw is empty or null', () => {
    expect(formatHallOfFameClub(null, 'player', 'daisy-pearce')).toBeNull();
    expect(formatHallOfFameClub('', 'player', null)).toBeNull();
  });
});

describe('isNonAflClub', () => {
  it('identifies state-league and regional non-AFL clubs', () => {
    expect(isNonAflClub('West Perth')).toBe(true);
    expect(isNonAflClub('West Adelaide')).toBe(true);
    expect(isNonAflClub('North Adelaide')).toBe(true);
    expect(isNonAflClub('South Adelaide')).toBe(true);
    expect(isNonAflClub('Norwood')).toBe(true);
    expect(isNonAflClub('East Brunswick Scorpions (VWFL)')).toBe(true);
    expect(isNonAflClub('St Albans Spurs (VWFL)')).toBe(true);
    expect(isNonAflClub('Port Melbourne')).toBe(true);
    expect(isNonAflClub('Claremont')).toBe(true);
  });

  it('returns false for recognized AFL clubs', () => {
    expect(isNonAflClub('Carlton')).toBe(false);
    expect(isNonAflClub('Collingwood')).toBe(false);
    expect(isNonAflClub('Essendon')).toBe(false);
    expect(isNonAflClub('Hawthorn')).toBe(false);
    expect(isNonAflClub('Richmond')).toBe(false);
    expect(isNonAflClub('Melbourne')).toBe(false);
    expect(isNonAflClub('North Melbourne')).toBe(false);
    expect(isNonAflClub('South Melbourne')).toBe(false);
    expect(isNonAflClub('Sydney')).toBe(false);
    expect(isNonAflClub('West Coast')).toBe(false);
    expect(isNonAflClub('Adelaide')).toBe(false);
    expect(isNonAflClub('Brisbane Lions')).toBe(false);
    expect(isNonAflClub('Western Bulldogs')).toBe(false);
  });

  it('returns false if club has a valid clubId integer', () => {
    expect(isNonAflClub('West Perth', 1)).toBe(false);
  });

  it('returns false for compound entries containing an AFL club', () => {
    expect(isNonAflClub('West Perth, Richmond')).toBe(false);
    expect(isNonAflClub('East Perth, West Coast')).toBe(false);
  });

  it('returns false for null or empty strings', () => {
    expect(isNonAflClub(null)).toBe(false);
    expect(isNonAflClub(undefined)).toBe(false);
    expect(isNonAflClub('')).toBe(false);
  });
});

describe('shouldShowUnmatched', () => {
  it('hides unmatched badge for linked players', () => {
    expect(
      shouldShowUnmatched({ linkStatus: 'unique', clubName: 'Carlton' }),
    ).toBe(false);
    expect(
      shouldShowUnmatched({ linkStatus: 'resolved', clubName: 'Collingwood' }),
    ).toBe(false);
  });

  it('hides unmatched badge for AFLW matched players', () => {
    expect(
      shouldShowUnmatched({
        linkStatus: 'unmatched',
        clubName: 'Melbourne',
        aflwPlayerSlug: 'daisy-pearce',
      }),
    ).toBe(false);
  });

  it('hides unmatched badge for non-player categories', () => {
    expect(
      shouldShowUnmatched({
        linkStatus: 'unmatched',
        category: 'media',
      }),
    ).toBe(false);
    expect(
      shouldShowUnmatched({
        linkStatus: 'unmatched',
        category: 'umpire',
      }),
    ).toBe(false);
  });

  it('hides unmatched badge for non-AFL clubs', () => {
    expect(
      shouldShowUnmatched({
        linkStatus: 'unmatched',
        clubName: 'West Perth',
      }),
    ).toBe(false);
    expect(
      shouldShowUnmatched({
        linkStatus: 'unmatched',
        clubName: 'West Adelaide',
      }),
    ).toBe(false);
    expect(
      shouldShowUnmatched({
        linkStatus: 'unmatched',
        clubName: 'East Brunswick Scorpions (VWFL)',
      }),
    ).toBe(false);
  });

  it('shows unmatched badge for unlinked players with AFL clubs or unknown clubs', () => {
    expect(
      shouldShowUnmatched({
        linkStatus: 'unmatched',
        clubName: 'Carlton',
      }),
    ).toBe(true);
    expect(
      shouldShowUnmatched({
        linkStatus: 'unmatched',
        clubName: null,
      }),
    ).toBe(true);
  });
});
