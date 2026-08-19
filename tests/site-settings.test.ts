/**
 * The settings parsers, which is where the risk in migration 034 actually
 * lives: these values arrive from a jsonb column that a previous deploy — or
 * a hand-run UPDATE — may have written, and they are read on the one page
 * every visitor lands on. Every case below is "what the front page does when
 * the stored value is not what this build expects".
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_SITE_FOOTER } from '@/lib/site-content';
import {
  DEFAULT_AFL_PLACEHOLDERS,
  DEFAULT_AFLW_PLACEHOLDERS,
  DEFAULT_EARLY_ACCESS_INTRO,
  DEFAULT_EARLY_ACCESS_NOTIFY_TO,
  DEFAULT_EARLY_ACCESS_QUESTIONS,
  DEFAULT_GRID_AUDIENCE,
  DEFAULT_HOME_LAYOUT,
  DEFAULT_HOME_RECORD,
  DEFAULT_PLACEHOLDER_INTERVAL,
  DEFAULT_SEARCH_ANIMATION,
  EARLY_ACCESS_LIMITS,
  HOME_SECTIONS,
  SETTING_KEYS,
  homeSectionRows,
  parseAflwLeaders,
  parseEarlyAccessNotifyTo,
  parseEarlyAccessQuestions,
  parseGridAudience,
  parseHomeLayout,
  parseHomeRecord,
  parsePlaceholderInterval,
  parsePlaceholders,
  parseSearchAnimation,
  parseSiteSettings,
  visibleHomeSections,
  type HomeSectionId,
} from '@/lib/site-settings';

const ALL = HOME_SECTIONS.map((section) => section.id);

describe('parseHomeLayout', () => {
  it('falls back to the default for a missing or non-object value', () => {
    expect(parseHomeLayout(undefined)).toEqual(DEFAULT_HOME_LAYOUT);
    expect(parseHomeLayout(null)).toEqual(DEFAULT_HOME_LAYOUT);
    expect(parseHomeLayout('browse')).toEqual(DEFAULT_HOME_LAYOUT);
    expect(parseHomeLayout(42)).toEqual(DEFAULT_HOME_LAYOUT);
  });

  it('keeps a stored order and appends sections it has never heard of', () => {
    // What a settings row written before a section existed looks like.
    const layout = parseHomeLayout({ order: ['browse', 'stats'], hidden: [] });
    expect(layout.order.slice(0, 2)).toEqual(['browse', 'stats']);
    expect([...layout.order].sort()).toEqual([...ALL].sort());
  });

  it('drops ids this build no longer has', () => {
    const layout = parseHomeLayout({ order: ['ticker', 'browse'], hidden: ['ticker'] });
    expect(layout.order).not.toContain('ticker');
    expect(layout.hidden).toEqual([]);
    expect(layout.order[0]).toBe('browse');
  });

  it('renders a repeated id once', () => {
    const layout = parseHomeLayout({ order: ['vault', 'vault', 'stats'] });
    expect(layout.order.filter((id) => id === 'vault')).toHaveLength(1);
  });

  it('hides only what is asked for', () => {
    const layout = parseHomeLayout({ order: ALL, hidden: ['record'] });
    expect(visibleHomeSections(layout)).toEqual(ALL.filter((id) => id !== 'record'));
  });
});

describe('homeSectionRows', () => {
  it('pairs the two adjacent panels into one split row', () => {
    expect(homeSectionRows(ALL)).toEqual([['stats'], ['vault', 'record'], ['browse']]);
  });

  it('gives a lone panel a row of its own', () => {
    expect(homeSectionRows(['stats', 'vault', 'browse'])).toEqual([
      ['stats'], ['vault'], ['browse'],
    ]);
  });

  it('does not pair panels that are not adjacent', () => {
    const order: HomeSectionId[] = ['vault', 'browse', 'record'];
    expect(homeSectionRows(order)).toEqual([['vault'], ['browse'], ['record']]);
  });

  it('never puts three in a row', () => {
    // Guards the layout rule rather than today's section list: a third panel
    // must start a new split, not squeeze into a two-column grid.
    for (const row of homeSectionRows(['vault', 'record', 'vault'] as HomeSectionId[])) {
      expect(row.length).toBeLessThanOrEqual(2);
    }
  });
});

describe('single-value settings', () => {
  it('rejects a record category the career leaderboard cannot answer', () => {
    expect(parseHomeRecord('most-goals-in-a-game')).toBe(DEFAULT_HOME_RECORD);
    expect(parseHomeRecord('most-games')).toBe('most-games');
  });

  it('falls back to super admins when the audience is unrecognised', () => {
    // The consequential direction: a bad value must never open the page up.
    expect(parseGridAudience('everyone')).toBe(DEFAULT_GRID_AUDIENCE);
    expect(parseGridAudience(null)).toBe(DEFAULT_GRID_AUDIENCE);
    expect(parseGridAudience('')).toBe(DEFAULT_GRID_AUDIENCE);
    expect(DEFAULT_GRID_AUDIENCE).toBe('super_admin');
    expect(parseGridAudience('public')).toBe('public');
  });

  it('accepts the AFLW leader categories and nothing else', () => {
    expect(parseAflwLeaders('tackles')).toBe('tackles');
    expect(parseAflwLeaders('metres_gained')).toBe('goals');
  });
});

describe('parseSiteSettings', () => {
  it('supplies every default from an empty table', () => {
    expect(parseSiteSettings([])).toEqual({
      homeLayout: DEFAULT_HOME_LAYOUT,
      homeRecord: DEFAULT_HOME_RECORD,
      aflwLeaders: 'goals',
      gridAudience: DEFAULT_GRID_AUDIENCE,
      earlyAccessOpen: false,
      earlyAccessIntro: DEFAULT_EARLY_ACCESS_INTRO,
      earlyAccessQuestions: DEFAULT_EARLY_ACCESS_QUESTIONS,
      earlyAccessNotify: false,
      earlyAccessNotifyTo: DEFAULT_EARLY_ACCESS_NOTIFY_TO,
      footer: DEFAULT_SITE_FOOTER,
      searchPlaceholdersAfl: DEFAULT_AFL_PLACEHOLDERS,
      searchPlaceholdersAflw: DEFAULT_AFLW_PLACEHOLDERS,
      searchPlaceholderInterval: DEFAULT_PLACEHOLDER_INTERVAL,
      searchPlaceholderAnimation: DEFAULT_SEARCH_ANIMATION,
    });
  });

  it('reads a jsonb column handed back as raw text', () => {
    // The shape the postgres.js client this project uses actually returns:
    // the five characters `"admin"`, and an object as its serialisation.
    // Reading these as opaque strings is what made every saved setting
    // silently fall back to its default — caught on the dev server, because
    // falling back is also the correct behaviour for a value we do not
    // recognise, so nothing looked broken except that saving did nothing.
    const settings = parseSiteSettings([
      { key: SETTING_KEYS.gridAudience, value: '"admin"' },
      { key: SETTING_KEYS.homeLayout, value: '{"order":["browse","stats"],"hidden":["stats"]}' },
    ]);
    expect(settings.gridAudience).toBe('admin');
    expect(settings.homeLayout.order.slice(0, 2)).toEqual(['browse', 'stats']);
    expect(settings.homeLayout.hidden).toEqual(['stats']);
  });

  it('reads the same values from a client that decodes jsonb itself', () => {
    // The other half of that fix: a driver upgrade must not flip the
    // behaviour back, so an already-decoded value has to work too.
    const settings = parseSiteSettings([
      { key: SETTING_KEYS.gridAudience, value: 'admin' },
      { key: SETTING_KEYS.homeLayout, value: { order: ['browse', 'stats'], hidden: ['stats'] } },
    ]);
    expect(settings.gridAudience).toBe('admin');
    expect(settings.homeLayout.order.slice(0, 2)).toEqual(['browse', 'stats']);
    expect(settings.homeLayout.hidden).toEqual(['stats']);
  });

  it('reads each key independently', () => {
    const settings = parseSiteSettings([
      { key: SETTING_KEYS.gridAudience, value: 'admin' },
      { key: SETTING_KEYS.homeRecord, value: 'most-premierships' },
      { key: 'home.something_removed', value: { any: 'thing' } },
    ]);
    expect(settings.gridAudience).toBe('admin');
    expect(settings.homeRecord).toBe('most-premierships');
    expect(settings.homeLayout).toEqual(DEFAULT_HOME_LAYOUT);
  });
});

/**
 * The early-access question list is the one setting whose value is written by
 * a person rather than chosen from a fixed list, and it is rendered on a
 * public page and used to validate what strangers submit. Every case here is
 * "what the apex form does when the stored questions are not what this build
 * expects".
 */
describe('parseEarlyAccessQuestions', () => {
  it('falls back to the defaults for a value that is not a list', () => {
    expect(parseEarlyAccessQuestions(undefined)).toEqual(DEFAULT_EARLY_ACCESS_QUESTIONS);
    expect(parseEarlyAccessQuestions(null)).toEqual(DEFAULT_EARLY_ACCESS_QUESTIONS);
    expect(parseEarlyAccessQuestions('interest')).toEqual(DEFAULT_EARLY_ACCESS_QUESTIONS);
  });

  it('keeps a deliberately empty list rather than restoring the defaults', () => {
    // "Email and name only" is a coherent form, and a super admin who removed
    // every question must not have them reappear on the next read.
    expect(parseEarlyAccessQuestions([])).toEqual([]);
  });

  it('drops a question with no usable id or label', () => {
    expect(parseEarlyAccessQuestions([
      { id: 'ok', label: 'Fine', type: 'short', required: false },
      { id: 'NO CAPS OR SPACES', label: 'Bad id', type: 'short' },
      { id: 'blank', label: '   ', type: 'short' },
      { label: 'No id at all', type: 'short' },
    ])).toEqual([
      { id: 'ok', label: 'Fine', type: 'short', required: false },
    ]);
  });

  it('drops a duplicate id, keeping the first', () => {
    // Answers are keyed by id, so two questions sharing one would overwrite
    // each other in the stored object.
    const questions = parseEarlyAccessQuestions([
      { id: 'why', label: 'First', type: 'short' },
      { id: 'why', label: 'Second', type: 'long' },
    ]);
    expect(questions).toHaveLength(1);
    expect(questions[0].label).toBe('First');
  });

  it('drops a choice with no options, which could not be answered', () => {
    expect(parseEarlyAccessQuestions([
      { id: 'how', label: 'How?', type: 'select', options: [] },
    ])).toEqual([]);
    expect(parseEarlyAccessQuestions([
      { id: 'how', label: 'How?', type: 'select' },
    ])).toEqual([]);
  });

  it('cleans up a choice’s options', () => {
    const [question] = parseEarlyAccessQuestions([
      { id: 'how', label: 'How?', type: 'select', options: ['  Search  ', '', 'Search', 'Word of mouth'] },
    ]);
    expect(question.options).toEqual(['Search', 'Word of mouth']);
  });

  it('falls back to short text for an unknown answer type', () => {
    const [question] = parseEarlyAccessQuestions([
      { id: 'q', label: 'Q', type: 'signature' },
    ]);
    expect(question.type).toBe('short');
  });

  it('treats required as strictly boolean true', () => {
    const [a, b] = parseEarlyAccessQuestions([
      { id: 'a', label: 'A', type: 'short', required: 'yes' },
      { id: 'b', label: 'B', type: 'short', required: true },
    ]);
    expect(a.required).toBe(false);
    expect(b.required).toBe(true);
  });

  it('caps the list and the field lengths', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: `q${i}`, label: 'x'.repeat(500), type: 'short' as const,
    }));
    const questions = parseEarlyAccessQuestions(many);
    expect(questions).toHaveLength(EARLY_ACCESS_LIMITS.maxQuestions);
    expect(questions[0].label).toHaveLength(EARLY_ACCESS_LIMITS.labelChars);
  });
});

describe('early access, the other settings', () => {
  it('only accepts an email-shaped notification address', () => {
    expect(parseEarlyAccessNotifyTo('someone@example.com')).toBe('someone@example.com');
    expect(parseEarlyAccessNotifyTo('not-an-email')).toBe(DEFAULT_EARLY_ACCESS_NOTIFY_TO);
    expect(parseEarlyAccessNotifyTo(null)).toBe(DEFAULT_EARLY_ACCESS_NOTIFY_TO);
  });

  it('keeps the form shut and quiet unless the stored value is exactly true', () => {
    // A malformed row must never be the thing that opens a public form or
    // starts sending mail. Note 1 and 'on' are the near-misses that matter:
    // both read as "yes" to a human and neither is a jsonb boolean.
    for (const stored of [1, 'on', 'yes', null, undefined, {}, '']) {
      const settings = parseSiteSettings([
        { key: SETTING_KEYS.earlyAccessOpen, value: stored },
        { key: SETTING_KEYS.earlyAccessNotify, value: stored },
      ]);
      expect(settings.earlyAccessOpen).toBe(false);
      expect(settings.earlyAccessNotify).toBe(false);
    }
  });

  it('reads a stored boolean through both jsonb paths', () => {
    // 'true' is not a near-miss: it is what a jsonb boolean looks like coming
    // back as raw text from this project's client, and is the normal path.
    for (const stored of ['true', true]) {
      const settings = parseSiteSettings([
        { key: SETTING_KEYS.earlyAccessOpen, value: stored },
      ]);
      expect(settings.earlyAccessOpen).toBe(true);
    }
    expect(parseSiteSettings([
      { key: SETTING_KEYS.earlyAccessOpen, value: 'false' },
    ]).earlyAccessOpen).toBe(false);
  });

  it('reads the questions through the jsonb-as-text path too', () => {
    const settings = parseSiteSettings([
      {
        key: SETTING_KEYS.earlyAccessQuestions,
        value: '[{"id":"why","label":"Why?","type":"long","required":true}]',
      },
    ]);
    expect(settings.earlyAccessQuestions).toEqual([
      { id: 'why', label: 'Why?', type: 'long', required: true },
    ]);
  });

  it('falls back to the built-in intro for an empty one', () => {
    const settings = parseSiteSettings([
      { key: SETTING_KEYS.earlyAccessIntro, value: '   ' },
    ]);
    expect(settings.earlyAccessIntro).toBe(DEFAULT_EARLY_ACCESS_INTRO);
  });

  it('parses and clamps search placeholder settings', () => {
    expect(parsePlaceholders(' pendles \n dusty \n\n ', DEFAULT_AFL_PLACEHOLDERS)).toEqual(['pendles', 'dusty']);
    expect(parsePlaceholders([], DEFAULT_AFL_PLACEHOLDERS)).toEqual(DEFAULT_AFL_PLACEHOLDERS);
    expect(parsePlaceholders(['daisy', ' '], DEFAULT_AFLW_PLACEHOLDERS)).toEqual(['daisy']);

    expect(parsePlaceholderInterval(10)).toBe(10);
    expect(parsePlaceholderInterval(1)).toBe(2); // Min clamp 2s
    expect(parsePlaceholderInterval(100)).toBe(60); // Max clamp 60s
    expect(parsePlaceholderInterval('invalid')).toBe(DEFAULT_PLACEHOLDER_INTERVAL);

    expect(parseSearchAnimation('typewriter')).toBe('typewriter');
    expect(parseSearchAnimation('fade')).toBe('fade');
    expect(parseSearchAnimation('slide')).toBe('slide');
    expect(parseSearchAnimation('none')).toBe('none');
    expect(parseSearchAnimation('unknown')).toBe(DEFAULT_SEARCH_ANIMATION);
  });
});
