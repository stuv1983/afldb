/**
 * The settings parsers, which is where the risk in migration 034 actually
 * lives: these values arrive from a jsonb column that a previous deploy — or
 * a hand-run UPDATE — may have written, and they are read on the one page
 * every visitor lands on. Every case below is "what the front page does when
 * the stored value is not what this build expects".
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GRID_AUDIENCE,
  DEFAULT_HOME_LAYOUT,
  DEFAULT_HOME_RECORD,
  HOME_SECTIONS,
  SETTING_KEYS,
  homeSectionRows,
  parseAflwLeaders,
  parseGridAudience,
  parseHomeLayout,
  parseHomeRecord,
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
