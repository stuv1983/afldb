import { describe, expect, it } from 'vitest';

import {
  NOT_RECORDED,
  formatRound,
  formatRoundShort,
  formatScore,
  formatSpan,
  formatSpanLabel,
  formatStat,
  isNonPlayerHallOfFameCategory,
  parseEntitySlug,
  playerPath,
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
