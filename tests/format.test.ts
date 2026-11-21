import { describe, expect, it } from 'vitest';

import {
  awardPath,
  awardSeasonPath,
  brownlowStatusNote,
  formatBrownlow,
  NOT_RECORDED,
  coachProfilePath,
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
import {
  isOversizedCanonicalId,
  MAX_INT4_ID,
  parseCanonicalId,
  parseSeason,
  safeDecodeParam,
} from '@/lib/params';

it('Brownlow award links use its canonical publication, not retained named-medal rows', () => {
  expect(awardPath('brownlow-medal')).toBe('/brownlow');
  expect(awardSeasonPath('brownlow-medal', 2025)).toBe('/brownlow/2025');
  expect(awardPath('coleman')).toBe('/awards/coleman');
});

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

describe('formatBrownlow and brownlowStatusNote (D-365-W, season-aware 2026-11-21)', () => {
  // The player season-by-season BV cell renders formatBrownlow as its text and
  // brownlowStatusNote as its title. The four absent-vote meanings must stay
  // distinct from each other and from a recorded zero.
  const VERIFY_NOTE = 'AFLDB has not yet verified and published the Brownlow results for this season.';
  const OPEN_NOTE = 'Brownlow votes for this season are published once the count has been verified.';
  // ISSUE-370 owner decision (2026-11-21): pending text states only AFLDB's own verification state. It
  // never says the medal was awarded or not awarded, that the season is in progress, or that results
  // were not loaded (they can be stored and unverified).
  const AWARD_CLAIM = /award|in progress|not loaded|not been loaded/i;

  it('a pending COMPLETED season reads "Awaiting verification" with a factual, award-neutral note', () => {
    expect(formatBrownlow(null, 'pending', 'complete')).toBe('Awaiting verification');
    expect(brownlowStatusNote('pending', 'complete')).toBe(VERIFY_NOTE);
    for (const text of [formatBrownlow(null, 'pending', 'complete'), brownlowStatusNote('pending', 'complete')]) {
      expect(text).not.toMatch(AWARD_CLAIM);
    }
  });

  it('a pending season that is not complete (or whose status is unknown) reads "Not yet available"', () => {
    for (const seasonStatus of ['in_progress', undefined, null]) {
      expect(formatBrownlow(null, 'pending', seasonStatus)).toBe('Not yet available');
      expect(brownlowStatusNote('pending', seasonStatus)).toBe(OPEN_NOTE);
      expect(formatBrownlow(null, 'pending', seasonStatus)).not.toMatch(AWARD_CLAIM);
      expect(brownlowStatusNote('pending', seasonStatus)).not.toMatch(AWARD_CLAIM);
    }
  });

  it('a declared no-medal season keeps "No medal"', () => {
    expect(formatBrownlow(null, 'not_applicable')).toBe('No medal');
    expect(brownlowStatusNote('not_applicable')).toBe('No Brownlow Medal was awarded for this season.');
  });

  it('a completed result renders a recorded zero as 0, with no note', () => {
    expect(formatBrownlow(0, 'complete')).toBe('0');
    expect(formatBrownlow(1234, 'complete')).toBe('1,234');
    expect(brownlowStatusNote('complete')).toBeNull();
    expect(brownlowStatusNote('complete', 'complete')).toBeNull();
  });

  it('unrecorded results keep their existing treatment', () => {
    expect(formatBrownlow(null, 'not_collected')).toBe('Not recorded');
    expect(brownlowStatusNote('not_collected')).toBe('Votes for this season were not recorded in the source data.');
    // A complete status without a count, or an unknown status, is "not recorded", never 0.
    expect(formatBrownlow(null, 'complete')).toBe(NOT_RECORDED);
    expect(formatBrownlow(undefined, 'complete')).toBe(NOT_RECORDED);
    expect(formatBrownlow(null, 'unexpected')).toBe(NOT_RECORDED);
    expect(brownlowStatusNote('unexpected')).toBeNull();
  });

  it('the status, not a stray vote count, decides a non-complete cell', () => {
    expect(formatBrownlow(0, 'pending', 'complete')).toBe('Awaiting verification');
    expect(formatBrownlow(0, 'pending')).toBe('Not yet available');
    expect(formatBrownlow(0, 'not_applicable')).toBe('No medal');
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

  // AFLDB-ISSUE-357: one canonical spelling per id. `Number()` used to accept
  // every one of these, so the same player rendered (and was persisted by ISR)
  // at as many URLs as there are spellings.
  it('refuses a non-canonical id spelling', () => {
    for (const spelling of ['011724', '0000011724', '00', '0']) {
      expect(parseEntitySlug(`scott-pendlebury-${spelling}`), spelling).toBeNull();
    }
    expect(parseEntitySlug('scott-pendlebury-11724')).toEqual({ slug: 'scott-pendlebury', id: 11724 });
  });

  // AFLDB-ISSUE-359: an id above int4 is well-formed but can never exist, and
  // binding it to an int4 comparison raised 22003 (HTTP 500).
  it('refuses an id that does not fit a PostgreSQL integer', () => {
    expect(parseEntitySlug(`x-${MAX_INT4_ID}`)).toEqual({ slug: 'x', id: MAX_INT4_ID });
    for (const big of ['2147483648', '99999999999', '9007199254740993', '9'.repeat(40)]) {
      expect(parseEntitySlug(`x-${big}`), big).toBeNull();
    }
  });
});

describe('route parameter parsing (AFLDB-ISSUE-357, 359)', () => {
  it('accepts only the canonical spelling of a positive int4 id', () => {
    expect(parseCanonicalId('1')).toBe(1);
    expect(parseCanonicalId('16592')).toBe(16592);
    expect(parseCanonicalId(String(MAX_INT4_ID))).toBe(MAX_INT4_ID);
    for (const bad of ['', '0', '-1', '+1', '01', '1e0', '0x1', '1.0', ' 1', '1 ', '1\n', 'abc', '2147483648',
      '99999999999', '9007199254740993']) {
      expect(parseCanonicalId(bad), JSON.stringify(bad)).toBeUndefined();
    }
    expect(parseCanonicalId(undefined)).toBeUndefined();
  });

  it('tells an oversized canonical id from malformed text', () => {
    expect(isOversizedCanonicalId('2147483648')).toBe(true);
    expect(isOversizedCanonicalId('9007199254740993')).toBe(true);
    expect(isOversizedCanonicalId(String(MAX_INT4_ID))).toBe(false);
    for (const notNumber of ['abc', '01', '1e9', '-5', '']) {
      expect(isOversizedCanonicalId(notNumber), notNumber).toBe(false);
    }
  });

  it('parses a season only in its canonical four-digit spelling and range', () => {
    expect(parseSeason('2024')).toBe(2024);
    expect(parseSeason('1897')).toBe(1897);
    expect(parseSeason('2100')).toBe(2100);
    for (const bad of ['02024', '002024', '2024.0', '2.024e3', '0x7e8', ' 2024', '+2024', '1896', '2101', 'abc', '', '99999']) {
      expect(parseSeason(bad), JSON.stringify(bad)).toBeUndefined();
    }
    expect(parseSeason(undefined)).toBeUndefined();
  });

  // AFLDB-ISSUE-359: AFLW keys are percent-encoded when linked and 17 live
  // slugs contain a literal "%27", so a malformed escape must not become a 500.
  it('decodes a route key once and reports a malformed escape as null', () => {
    expect(safeDecodeParam('Aasta_O%2527Connor')).toBe('Aasta_O%27Connor');
    expect(safeDecodeParam('Plain_Name')).toBe('Plain_Name');
    expect(safeDecodeParam('%E0%A4%A')).toBeNull();
    expect(safeDecodeParam('%')).toBeNull();
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

describe('coachProfilePath', () => {
  // AFLDB-ISSUE-170 Stage 1E reversed this helper's old rule. It used to send
  // a player-linked coach to /players because /coaches/[slug]-id permanently
  // redirected them there; that redirect is gone, and a name picked out of a
  // COACHING surface must now reach the coaching profile.
  it('sends a player-linked coach to their own coach page, not to /players', () => {
    const href = coachProfilePath({ slug: 'damien-hardwick', coachId: 17 });
    expect(href).toBe('/coaches/damien-hardwick-17');
    expect(href).not.toContain('/players');
  });

  it('sends a coach-only person to the coach route, never to /players', () => {
    const href = coachProfilePath({ slug: 'cliff-rankin', coachId: 152 });
    expect(href).toBe('/coaches/cliff-rankin-152');
    expect(href).not.toContain('/players');
  });

  it('is the coach id that identifies the page, not the player id', () => {
    // The two identifier spaces are different tables; a coach page keyed by a
    // player id would silently address the wrong coach.
    expect(coachProfilePath({ slug: 'mick-malthouse', coachId: 3 })).toBe('/coaches/mick-malthouse-3');
  });
});
