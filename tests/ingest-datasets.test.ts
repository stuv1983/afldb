/**
 * AFLDB-ISSUE-258 — the legacy CSV intake's optional columns.
 *
 * `player_match_stats` and `match_results` read their optional counts in
 * four states (D-258-2): no such column and a blank cell both resolve to
 * null, which promotion treats as "keep the stored value" (D-258-3); a
 * malformed cell is a validation error; a valid value applies.
 *
 * DB-free: the validators run against a fake `sql` tag that answers the
 * reference lookups by query shape. The promotion upserts themselves are
 * proven against afldb_test in tests/integration/match-results-promotion.test.ts.
 */
import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { DATASETS } from '@/lib/ingest/datasets';

const matchResults = DATASETS.match_results;
const playerMatchStats = DATASETS.player_match_stats;

type StoredBreakdown = {
  homeGoals: number | null; homeBehinds: number | null;
  awayGoals: number | null; awayBehinds: number | null;
};

const CLUBS: Record<string, { id: number; name: string }> = {
  'Home FC': { id: 1, name: 'Home FC' },
  'Away FC': { id: 2, name: 'Away FC' },
};

/**
 * Answers each validator lookup by its SQL shape. `stored` is the existing
 * match match_results reads back for the breakdown check (none = a new
 * match). Every query text is recorded so a test can prove none ran.
 */
function fakeSql(stored: StoredBreakdown | null = null) {
  const queries: string[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    queries.push(text);
    if (/FROM seasons/.test(text)) return Promise.resolve([{ year: values[0] }]);
    if (/FROM club_aliases/.test(text)) {
      const club = CLUBS[values[0] as string];
      return Promise.resolve(club ? [club] : []);
    }
    if (/FROM venues/.test(text)) return Promise.resolve([]);
    if (/AS "homeGoals"/.test(text)) return Promise.resolve(stored ? [stored] : []);
    if (/SELECT id FROM matches/.test(text)) return Promise.resolve([{ id: 500 }]);
    if (/FROM players p/.test(text)) return Promise.resolve([{ id: 900, forClub: true }]);
    throw new Error(`unexpected query: ${text}`);
  };
  return { sql: tag as unknown as Sql, queries };
}

function matchRow(extra: Record<string, string | null> = {}): Record<string, string | null> {
  return {
    season: '2073', round_code: 'R1', round_number: '1', match_date: '2073-03-01',
    venue: 'Fixture Oval', home_club: 'Home FC', away_club: 'Away FC',
    home_score: '86', away_score: '70',
    ...extra,
  };
}

function statsRow(extra: Record<string, string | null> = {}): Record<string, string | null> {
  return {
    season: '2073', round_code: 'R1', home_club: 'Home FC', away_club: 'Away FC',
    player: 'Fixture Player', club: 'Home FC',
    ...extra,
  };
}

describe('AFLDB-ISSUE-258 match_results optional columns', () => {
  it.each([
    ['1O'], ['12.5'], ['n/a'], ['-3'], ['0x10'], ['1e2'], ['40000'],
  ])('refuses a malformed home_goals cell %j before any lookup', async (cell) => {
    const { sql, queries } = fakeSql();
    const result = await matchResults.validateRow(matchRow({ home_goals: cell }), { sql });
    expect(result.verdict).toBe('error');
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain(`home_goals "${cell}"`);
    expect(result.resolved).toBeUndefined();
    expect(queries).toEqual([]);
  });

  it('names every malformed optional column in one report, attendance included', async () => {
    const { sql } = fakeSql();
    const result = await matchResults.validateRow(
      matchRow({ home_behinds: 'x', away_goals: '9.0', attendance: '12,000' }),
      { sql },
    );
    expect(result.verdict).toBe('error');
    expect(result.reasons.map((r) => r.split(' ')[0]))
      .toEqual(['home_behinds', 'away_goals', 'attendance']);
  });

  it('admits an attendance above the smallint range (the column is integer)', async () => {
    const { sql } = fakeSql();
    const result = await matchResults.validateRow(matchRow({ attendance: '121696' }), { sql });
    expect(result.verdict).not.toBe('error');
    expect(result.resolved?.attendance).toBe(121696);
    expect(result.resolved?.attendance_status).toBe('complete');
  });

  it('resolves an absent column and a blank cell alike, to null', async () => {
    const absent = await matchResults.validateRow(matchRow(), { sql: fakeSql().sql });
    const blank = await matchResults.validateRow(
      matchRow({ home_goals: null, home_behinds: null, away_goals: null, away_behinds: null, attendance: null }),
      { sql: fakeSql().sql },
    );
    for (const result of [absent, blank]) {
      expect(result.verdict).toBe('warning'); // the unrecognised venue only
      expect(result.resolved).toMatchObject({
        home_goals: null, home_behinds: null, away_goals: null, away_behinds: null,
        attendance: null, attendance_status: 'not_collected',
      });
    }
  });

  it('applies valid supplied values', async () => {
    const { sql, queries } = fakeSql();
    const result = await matchResults.validateRow(
      matchRow({ home_goals: '13', home_behinds: '8', away_goals: '10', away_behinds: '10', attendance: '45000' }),
      { sql },
    );
    expect(result.resolved).toMatchObject({
      home_goals: 13, home_behinds: 8, away_goals: 10, away_behinds: 10,
      attendance: 45000, attendance_status: 'complete',
    });
    // Every component supplied: no stored-breakdown read is needed.
    expect(queries.some((q) => /AS "homeGoals"/.test(q))).toBe(false);
  });

  it('still refuses a supplied breakdown that does not add up', async () => {
    const { sql } = fakeSql();
    const result = await matchResults.validateRow(
      matchRow({ home_goals: '10', home_behinds: '5' }),
      { sql },
    );
    expect(result.verdict).toBe('error');
    expect(result.reasons).toEqual(['home_goals and home_behinds do not add up to home_score']);
  });

  it('refuses a new score whose kept (stored) breakdown no longer adds up', async () => {
    // Stored 12.8 (80); the file says 86 and is silent on the breakdown.
    const { sql } = fakeSql({ homeGoals: 12, homeBehinds: 8, awayGoals: 10, awayBehinds: 10 });
    const result = await matchResults.validateRow(matchRow(), { sql });
    expect(result.verdict).toBe('error');
    expect(result.reasons[0]).toMatch(/^home_goals 12 and home_behinds 8 \(the stored figure/);
    expect(result.reasons[0]).toContain('home_score 86');
  });

  it('refuses a half-supplied breakdown that disagrees with the kept component', async () => {
    // Stored away 10.10 (70); the file supplies away_goals 11 only.
    const { sql } = fakeSql({ homeGoals: 13, homeBehinds: 8, awayGoals: 10, awayBehinds: 10 });
    const result = await matchResults.validateRow(matchRow({ away_goals: '11' }), { sql });
    expect(result.verdict).toBe('error');
    expect(result.reasons[0]).toMatch(/^away_goals 11 and away_behinds 10/);
  });

  it('admits a silent breakdown that the stored one still satisfies', async () => {
    const { sql } = fakeSql({ homeGoals: 13, homeBehinds: 8, awayGoals: 10, awayBehinds: 10 });
    const result = await matchResults.validateRow(matchRow(), { sql });
    expect(result.verdict).toBe('warning');
    expect(result.resolved?.home_goals).toBeNull();
  });
});

describe('AFLDB-ISSUE-258 player_match_stats optional columns', () => {
  it.each([
    ['kicks', '1O'], ['marks', '12.5'], ['goal_assists', 'n/a'], ['tackles', '-1'],
    ['career_game_no', '7.0'], ['disposals', '99999'],
  ])('refuses a malformed %s cell %j before any lookup', async (column, cell) => {
    const { sql, queries } = fakeSql();
    const result = await playerMatchStats.validateRow(statsRow({ [column]: cell }), { sql });
    expect(result.verdict).toBe('error');
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain(`${column} "${cell}"`);
    expect(queries).toEqual([]);
  });

  it.each([['4'], ['-1'], ['two']])('refuses brownlow_votes %j outside 0-3', async (cell) => {
    const { sql, queries } = fakeSql();
    const result = await playerMatchStats.validateRow(statsRow({ brownlow_votes: cell }), { sql });
    expect(result.verdict).toBe('error');
    expect(result.reasons[0]).toContain(`brownlow_votes "${cell}" must be a whole number from 0 to 3`);
    expect(queries).toEqual([]);
  });

  it('resolves absent columns and blank cells alike, to null', async () => {
    const absent = await playerMatchStats.validateRow(statsRow(), { sql: fakeSql().sql });
    const blank = await playerMatchStats.validateRow(
      statsRow({ kicks: null, goals: null, brownlow_votes: null, career_game_no: null, jumper_number: null }),
      { sql: fakeSql().sql },
    );
    for (const result of [absent, blank]) {
      expect(result.verdict).toBe('ok');
      expect(result.resolved).toMatchObject({
        match_id: 500, player_id: 900, club_id: 1,
        kicks: null, goals: null, goal_assists: null,
        brownlow_votes: null, career_game_no: null, jumper_number: null,
      });
    }
  });

  it('applies valid supplied values, and jumper_number as free text', async () => {
    const result = await playerMatchStats.validateRow(
      statsRow({ goals: '3', kicks: '0', brownlow_votes: '2', career_game_no: '150', jumper_number: '23B' }),
      { sql: fakeSql().sql },
    );
    expect(result.verdict).toBe('ok');
    expect(result.resolved).toMatchObject({
      goals: 3, kicks: 0, brownlow_votes: 2, career_game_no: 150, jumper_number: '23B',
      marks: null,
    });
  });
});
