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

import {
  buildPlayerMatchStatsAuthority,
  NO_PLAYER_MATCH_STATS_AUTHORITY,
} from '@/lib/acquisition/manual-authority';
import {
  encodePlayerMatchStatsKey,
  type ContinuityRulesLoad,
} from '@/lib/acquisition/match-sheet-authority';
import {
  DATASETS,
  LEGACY_PROMOTION_LOCK_REFUSAL,
  legacyStatsAuthorityRefusal,
  type MatchSheetAuthorityReader,
  type PromotionRow,
} from '@/lib/ingest/datasets';

const matchResults = DATASETS.match_results;
const playerMatchStats = DATASETS.player_match_stats;

/** No Match Sheet authority at all (AFLDB-ISSUE-264): today's answer for most matches. */
const noAuthority: MatchSheetAuthorityReader = async () => ({
  ok: true, authority: NO_PLAYER_MATCH_STATS_AUTHORITY,
});

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
    const absent = await playerMatchStats.validateRow(statsRow(), { sql: fakeSql().sql, matchSheetAuthority: noAuthority });
    const blank = await playerMatchStats.validateRow(
      statsRow({ kicks: null, goals: null, brownlow_votes: null, career_game_no: null, jumper_number: null }),
      { sql: fakeSql().sql, matchSheetAuthority: noAuthority },
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
      { sql: fakeSql().sql, matchSheetAuthority: noAuthority },
    );
    expect(result.verdict).toBe('ok');
    expect(result.resolved).toMatchObject({
      goals: 3, kicks: 0, brownlow_votes: 2, career_game_no: 150, jumper_number: '23B',
      marks: null,
    });
  });
});

/**
 * AFLDB-ISSUE-264 — a legacy row against durable Match Sheet authority.
 *
 * The authority is built by the settle's own pure reader
 * (`buildPlayerMatchStatsAuthority`) from synthetic records, so key decoding,
 * identity resolution and fail-closed marking are the real ones. Validation is
 * advisory; `preparePromotion` re-checks under the match lock against a fake
 * `sql` that answers the lock, the authority loader and the row read by shape.
 */
describe('AFLDB-ISSUE-264 player_match_stats against durable Match Sheet authority', () => {
  const MK = '2073|R1|2073-03-01|Home FC|Away FC';
  const MK2 = '2073|R2|2073-03-08|Away FC|Home FC';
  const PATH = 'players/F/Fixture_Player.html';
  const IDENTITY = `afltables:${PATH}`;
  const OTHER = 'afltables:players/O/Other_Player.html';
  const NO_RULES = { ok: true, rules: [] } as unknown as ContinuityRulesLoad;

  type Rec = { entityKey: string; fieldGroup: string; isActive: boolean; overrideValues: unknown };
  type Over = { playerIdsByIdentity?: Map<string, number[]>; continuity?: ContinuityRulesLoad };

  const rec = (
    fieldGroup: string, overrideValues: unknown,
    opts: { identity?: string; isActive?: boolean; key?: string } = {},
  ): Rec => ({
    entityKey: opts.key ?? `${MK}|${opts.identity ?? IDENTITY}`,
    fieldGroup,
    isActive: opts.isActive ?? true,
    overrideValues,
  });

  const authorityOf = (records: Rec[], over: Over = {}) => buildPlayerMatchStatsAuthority({
    season: 2073,
    records,
    matchesByKey: new Map([[MK, { id: 500, homeClubId: 1, awayClubId: 2 }]]),
    playerIdsByIdentity: over.playerIdsByIdentity ?? new Map([[IDENTITY, [900]], [OTHER, [901]]]),
    clubIdBySlug: new Map([['home-fc', 1], ['away-fc', 2], ['elsewhere-fc', 3]]),
    continuity: over.continuity ?? NO_RULES,
  });

  async function validate(extra: Record<string, string | null>, records: Rec[], over: Over = {}) {
    const seasons: number[] = [];
    const reader: MatchSheetAuthorityReader = async (season) => {
      seasons.push(season);
      return { ok: true, authority: authorityOf(records, over) };
    };
    const result = await playerMatchStats.validateRow(
      statsRow(extra), { sql: fakeSql().sql, matchSheetAuthority: reader },
    );
    return { ...result, seasons };
  }

  const PROTECTED = { goals: 3, jumper_number: '23', kicks: 10, handballs: 5, disposals: 15 };

  describe('validation', () => {
    it('refuses a supplied value that differs from a protected one, and names it', async () => {
      const result = await validate({ goals: '4' }, [rec('match_sheet', PROTECTED)]);
      expect(result.verdict).toBe('error');
      expect(result.resolved).toBeUndefined();
      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0]).toContain('goals (file 4, Match Sheet 3)');
      expect(result.reasons[0]).toContain('/admin/data-editor?mode=match-sheet&id=500');
      expect(result.seasons).toEqual([2073]);
    });

    it('admits identical protected values and unprotected columns', async () => {
      const result = await validate(
        { goals: '3', jumper_number: '23', kicks: '10', handballs: '5', disposals: '15', marks: '9' },
        [rec('match_sheet', PROTECTED)],
      );
      expect(result.verdict).toBe('ok');
      expect(result.resolved).toMatchObject({ goals: 3, marks: 9 });
    });

    it('admits absent and blank protected columns (ISSUE-258: they keep the stored value)', async () => {
      const records = [rec('match_sheet', PROTECTED)];
      expect((await validate({}, records)).verdict).toBe('ok');
      const blank = await validate(
        { goals: null, jumper_number: null, kicks: null, handballs: null, disposals: null }, records,
      );
      expect(blank.verdict).toBe('ok');
    });

    it('treats an explicit "not recorded" as protected: silence passes, a value refuses', async () => {
      const records = [rec('match_sheet', { goals: null, jumper_number: null })];
      expect((await validate({}, records)).verdict).toBe('ok');
      const goals = await validate({ goals: '0' }, records);
      expect(goals.verdict).toBe('error');
      expect(goals.reasons[0]).toContain('goals (file 0, Match Sheet not recorded)');
      const jumper = await validate({ jumper_number: '7' }, records);
      expect(jumper.reasons[0]).toContain('jumper_number (file 7, Match Sheet not recorded)');
    });

    it('compares jumper_number as text', async () => {
      const records = [rec('match_sheet', { jumper_number: '23' })];
      expect((await validate({ jumper_number: '23' }, records)).verdict).toBe('ok');
      expect((await validate({ jumper_number: '24' }, records)).reasons[0])
        .toContain('jumper_number (file 24, Match Sheet 23)');
    });

    it('always compares the mandatory club, even when the file supplies no figure', async () => {
      const away = await validate({}, [rec('match_sheet', { club_slug: 'away-fc' })]);
      expect(away.verdict).toBe('error');
      expect(away.reasons[0]).toContain('club_id (file 1, Match Sheet 2)');
      expect((await validate({}, [rec('match_sheet', { club_slug: 'home-fc' })])).verdict).toBe('ok');
      const moved = await validate({ club: 'Away FC' }, [rec('match_sheet', { club_slug: 'home-fc' })]);
      expect(moved.reasons[0]).toContain('club_id (file 2, Match Sheet 1)');
    });

    it('compares each supplied member of the coupled kicks/handballs/disposals unit', async () => {
      const records = [rec('match_sheet', { kicks: 10, handballs: 5, disposals: 15 })];
      const disposals = await validate({ disposals: '16' }, records);
      expect(disposals.verdict).toBe('error');
      expect(disposals.reasons[0]).toMatch(/protects disposals \(file 16, Match Sheet 15\);/);
      const swapped = await validate({ kicks: '12', handballs: '3', disposals: '15' }, records);
      expect(swapped.reasons[0]).toMatch(
        /protects kicks \(file 12, Match Sheet 10\), handballs \(file 3, Match Sheet 5\);/,
      );
      expect((await validate({ kicks: '10' }, records)).verdict).toBe('ok');
    });

    it('refuses a player the Match Sheet removed, whatever the row carries', async () => {
      const removal = [
        rec('lineup', { present: false }),
        rec('match_sheet', PROTECTED, { isActive: false }),
      ];
      const extras: Record<string, string | null>[] = [{}, { goals: '3' }, { goals: '4', marks: '1' }];
      for (const extra of extras) {
        const result = await validate(extra, removal);
        expect(result.verdict).toBe('error');
        expect(result.reasons[0]).toContain('promoting would re-insert the row');
      }
    });

    it('keeps a durable addition: compatible values pass, a club or value change refuses', async () => {
      const addition = [
        rec('lineup', { present: true }),
        rec('match_sheet', { club_slug: 'home-fc', goals: 2 }),
      ];
      expect((await validate({ goals: '2', marks: '4' }, addition)).verdict).toBe('ok');
      expect((await validate({ club: 'Away FC' }, addition)).reasons[0]).toContain('club_id (file 2, Match Sheet 1)');
      expect((await validate({ goals: '5' }, addition)).reasons[0]).toContain('goals (file 5, Match Sheet 2)');
    });

    it.each([
      ['no match_sheet record', [rec('lineup', { present: true })]],
      ['a match_sheet record without a club', [rec('lineup', { present: true }), rec('match_sheet', { goals: 2 })]],
    ])('refuses a durable addition with %s (unexpected state)', async (_label, records) => {
      const result = await validate({}, records);
      expect(result.verdict).toBe('error');
      expect(result.reasons[0]).toContain('records no club for the addition');
    });

    it('ignores withdrawn records, another player and another season', async () => {
      const records = [
        rec('match_sheet', { goals: 9, club_slug: 'away-fc' }, { isActive: false }),
        rec('lineup', { present: false }, { isActive: false }),
        rec('match_sheet', { goals: 9 }, { identity: OTHER }),
        rec('lineup', { present: false }, { key: `2072|R1|2072-03-01|Home FC|Away FC|${IDENTITY}` }),
      ];
      expect((await validate({ goals: '4' }, records)).verdict).toBe('ok');
    });

    it.each<[string, Rec[], Over]>([
      ['an unreadable payload', [rec('match_sheet', { bogus: 1 })], {}],
      ['an identity that resolves to nobody', [rec('match_sheet', { goals: 1 }, { identity: 'afltables:players/U/Unknown.html' })], {}],
      ['an identity that resolves to two players', [rec('match_sheet', { goals: 3 })],
        { playerIdsByIdentity: new Map([[IDENTITY, [900, 902]]]) }],
      ['a protected club outside the match', [rec('match_sheet', { club_slug: 'elsewhere-fc' })], {}],
      ['two keys resolving to one player', [
        rec('match_sheet', { goals: 3 }),
        rec('match_sheet', { goals: 3 }, { identity: 'manual_admin_edit:tok-1' }),
      ], { playerIdsByIdentity: new Map([[IDENTITY, [900]], ['manual_admin_edit:tok-1', [900]]]) }],
      ["another player's unreadable record on this match", [rec('lineup', { present: 'no' }, { identity: OTHER })], {}],
    ])('fails closed on %s for the match', async (_label, records, over) => {
      const result = await validate({ goals: '3' }, records, over);
      expect(result.verdict).toBe('error');
      expect(result.reasons[0]).toContain('cannot be attributed to exactly one player');
    });

    it.each<[string, Rec[], Over]>([
      ['a record whose key does not decode', [rec('match_sheet', { goals: 3 }, { key: 'not-a-key' })], {}],
      ['an unreadable continuity contract', [rec('match_sheet', { goals: 3 })],
        { continuity: { ok: false, detail: 'contract missing' } }],
    ])('fails closed on %s everywhere', async (_label, records, over) => {
      const result = await validate({ goals: '3' }, records, over);
      expect(result.verdict).toBe('error');
      expect(result.reasons[0]).toContain('stored Match Sheet authority cannot be read');
    });

    it('fails closed when the authority cannot be read or no reader is supplied', async () => {
      const failed = await playerMatchStats.validateRow(statsRow(), {
        sql: fakeSql().sql,
        matchSheetAuthority: async () => ({ ok: false, reason: 'connection refused' }),
      });
      expect(failed.verdict).toBe('error');
      expect(failed.reasons[0]).toContain('authority for 2073 could not be read (connection refused)');
      const missing = await playerMatchStats.validateRow(statsRow(), { sql: fakeSql().sql });
      expect(missing.verdict).toBe('error');
      expect(missing.reasons[0]).toContain('no authority reader was supplied');
    });
  });

  describe('promotion re-check', () => {
    type Pair = { playerId: number; matchId: number };

    /** Answers preparePromotion's queries by shape and records each, with its values. */
    function promotionSql(
      records: Rec[],
      opts: { existing?: Pair[]; badKey?: boolean; missing?: number[]; lockFails?: string; previous?: string } = {},
    ) {
      const queries: { text: string; values: unknown[] }[] = [];
      const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.join('?');
        queries.push({ text, values });
        if (/current_setting\('lock_timeout'\)/.test(text)) return Promise.resolve([{ previous: opts.previous ?? '0' }]);
        if (/set_config\('lock_timeout'/.test(text)) return Promise.resolve([]);
        if (opts.lockFails && /FROM matches[\s\S]*FOR SHARE/.test(text)) {
          return Promise.reject(Object.assign(new Error('canceling statement'), { code: opts.lockFails }));
        }
        if (/FROM matches[\s\S]*FOR SHARE/.test(text)) {
          return Promise.resolve((values[0] as number[])
            .filter((id) => !(opts.missing ?? []).includes(id))
            .map((id) => ({ id, matchKey: opts.badKey ? 'no-season' : id === 500 ? MK : MK2 })));
        }
        if (/FROM data_overrides/.test(text)) {
          return Promise.resolve(records.filter((r) => r.isActive).map((r) => ({
            ...r, overrideValues: JSON.stringify(r.overrideValues),
          })));
        }
        if (/match_key = ANY/.test(text)) {
          return Promise.resolve([
            { id: 500, matchKey: MK, homeClubId: 1, awayClubId: 2 },
            { id: 501, matchKey: MK2, homeClubId: 2, awayClubId: 1 },
          ]);
        }
        if (/FROM external_identities/.test(text)) {
          return Promise.resolve([
            { sourceKey: 'afltables', externalId: PATH, matchMethod: 'afltables_profile_url', playerId: 900 },
          ]);
        }
        if (/FROM clubs/.test(text)) return Promise.resolve([{ id: 1, slug: 'home-fc' }, { id: 2, slug: 'away-fc' }]);
        if (/FROM player_match_stats/.test(text)) {
          return Promise.resolve(opts.existing ?? [{ playerId: 900, matchId: 500 }]);
        }
        throw new Error(`unexpected query: ${text}`);
      };
      return { sql: tag as unknown as Sql, queries };
    }

    const row = (resolved: Record<string, number | string | null> = {}, rowNo = 1, player = 'Fixture Player'): PromotionRow => ({
      rowNo,
      payload: statsRow({ player }),
      resolved: { match_id: 500, player_id: 900, club_id: 1, jumper_number: null, goals: null, ...resolved },
    });

    const prepare = (rows: PromotionRow[], sql: Sql) => playerMatchStats.preparePromotion!(rows, { sql });

    // F-002: both legacy writers take their match locks in a hook, so they share one lock order.
    it('is registered for both legacy writers, match_results and player_match_stats', () => {
      expect(Object.values(DATASETS).filter((spec) => spec.preparePromotion).map((spec) => spec.key).sort())
        .toEqual(['match_results', 'player_match_stats']);
    });

    it('locks the matches FOR SHARE, ascending, before reading authority, and writes nothing', async () => {
      const { sql, queries } = promotionSql([rec('match_sheet', { goals: 3 })]);
      await prepare([row({ match_id: 501 }, 1), row({ goals: 3 }, 2)], sql);
      const lock = queries.findIndex((q) => /FROM matches/.test(q.text));
      expect(queries[lock].text).toMatch(/FROM matches[\s\S]*ORDER BY id\s+FOR SHARE\s*$/);
      expect(queries[lock].text).not.toMatch(/FOR (NO KEY )?UPDATE/);
      expect(queries[lock].values[0]).toEqual([500, 501]);
      expect(queries.findIndex((q) => /FROM data_overrides/.test(q.text))).toBeGreaterThan(lock);
      expect(queries.some((q) => /\b(INSERT|DELETE)\b|\bUPDATE\s+\w/.test(q.text))).toBe(false);
    });

    // F-002: the wait is bounded, transaction-locally, and the bound ends with the hook.
    it('bounds the lock wait with a transaction-local 5s timeout, restored after the hook', async () => {
      const { sql, queries } = promotionSql([], { previous: '30s' });
      await prepare([row()], sql);
      const settings = queries.filter((q) => /set_config\('lock_timeout'/.test(q.text));
      expect(settings.map((q) => q.text.replace(/\s+/g, ' ').trim()))
        .toEqual(Array(2).fill("SELECT set_config('lock_timeout', ?, true)"));
      expect(settings.map((q) => q.values)).toEqual([['5s'], ['30s']]);
      const at = (needle: RegExp) => queries.findIndex((q) => needle.test(q.text));
      expect(at(/current_setting/)).toBeLessThan(at(/FROM matches/));
      expect(queries.indexOf(settings[0])).toBeLessThan(at(/FROM matches/));
      expect(queries.indexOf(settings[1])).toBeGreaterThan(at(/FROM player_match_stats/));
      expect(queries.some((q) => /\bSET\s+(LOCAL\s+)?lock_timeout/i.test(q.text))).toBe(false);
    });

    it.each(['55P03', '40P01'])('turns SQLSTATE %s into the retryable refusal', async (code) => {
      const { sql } = promotionSql([], { lockFails: code });
      await expect(prepare([row()], sql)).rejects.toThrow(LEGACY_PROMOTION_LOCK_REFUSAL);
      await expect(prepare([row()], sql)).rejects.toMatchObject({ cause: { code } });
    });

    it('leaves any other error, and a real refusal, untouched', async () => {
      await expect(prepare([row()], promotionSql([], { lockFails: '23505' }).sql)).rejects.toThrow('canceling statement');
      const { sql } = promotionSql([rec('match_sheet', { goals: 3 })]);
      const refusal = await prepare([row({ goals: 4 })], sql).catch((error: unknown) => error);
      expect(String(refusal)).toMatch(/conflict with durable Match Sheet authority/);
      expect(String(refusal)).not.toContain(LEGACY_PROMOTION_LOCK_REFUSAL);
    });

    it('refuses authority recorded after validation passed, and names the row', async () => {
      const validated = await playerMatchStats.validateRow(
        statsRow({ goals: '4' }), { sql: fakeSql().sql, matchSheetAuthority: noAuthority },
      );
      expect(validated.verdict).toBe('ok');
      const { sql } = promotionSql([rec('match_sheet', { goals: 3 })]);
      await expect(prepare([{ rowNo: 7, payload: statsRow(), resolved: validated.resolved! }], sql))
        .rejects.toThrow(/^1 row\(s\) conflict with durable Match Sheet authority; nothing was promoted\. row 7 "Fixture Player" \(match #500\): .*goals \(file 4, Match Sheet 3\)/);
    });

    it('refuses the whole submission when any one row conflicts', async () => {
      const { sql } = promotionSql([rec('lineup', { present: false })]);
      const rows = [row({ player_id: 901, goals: 8 }, 1, 'Other Player'), row({}, 2)];
      await expect(prepare(rows, sql)).rejects.toThrow(/^1 row\(s\) conflict.*row 2 "Fixture Player".*re-insert the row/);
    });

    it('admits identical and absent protected values at promotion', async () => {
      const { sql } = promotionSql([rec('match_sheet', { goals: 3, club_slug: 'home-fc' })]);
      await expect(prepare([row({ goals: 3 }), row({ goals: null }, 2)], sql)).resolves.toBeUndefined();
    });

    it('refuses a durable addition whose row is missing, and keeps one whose row exists', async () => {
      const addition = [rec('lineup', { present: true }), rec('match_sheet', { club_slug: 'home-fc', goals: 2 })];
      await expect(prepare([row({ goals: 2 })], promotionSql(addition, { existing: [] }).sql))
        .rejects.toThrow(/added this player but the row is missing/);
      await expect(prepare([row({ goals: 2 })], promotionSql(addition).sql)).resolves.toBeUndefined();
    });

    it('fails closed when the authority cannot be read or a match cannot be scoped', async () => {
      await expect(prepare([row()], promotionSql([rec('match_sheet', { goals: 1 }, { key: 'x' })]).sql))
        .rejects.toThrow(/stored Match Sheet authority cannot be read/);
      await expect(prepare([row()], promotionSql([], { badKey: true }).sql))
        .rejects.toThrow(/key the Match Sheet authority cannot scope/);
    });

    it('refuses a row with no resolved match or player before taking any lock', async () => {
      const { sql, queries } = promotionSql([]);
      await expect(prepare([row({ player_id: null })], sql)).rejects.toThrow(/Row 1 carries no resolved match or player/);
      expect(queries).toEqual([]);
    });

    // ISSUE-264 F-005: a malformed `resolved` payload refuses before any lock or read.
    it.each<[string, Record<string, number | string | null>]>([
      ['a zero match id', { match_id: 0 }],
      ['a negative match id', { match_id: -1 }],
      ['a fractional match id', { match_id: 1.5 }],
      ['a text match id', { match_id: 'abc' }],
      ['a zero player id', { player_id: 0 }],
      ['a text player id', { player_id: 'abc' }],
    ])('refuses %s before taking any lock', async (_label, resolved) => {
      const { sql, queries } = promotionSql([rec('match_sheet', { goals: 3 })]);
      await expect(prepare([row(resolved)], sql)).rejects.toThrow(/carries no resolved match or player/);
      expect(queries).toEqual([]);
    });

    // ISSUE-264 F-005: a submission validated earlier names a match that has since been deleted.
    it('refuses a stale submission whose match no longer exists, before reading any authority', async () => {
      const { sql, queries } = promotionSql([rec('match_sheet', { goals: 3 })], { missing: [501] });
      await expect(prepare([row({ match_id: 501 }), row({}, 2)], sql))
        .rejects.toThrow(/no longer exists; re-validate the submission/);
      expect(queries.some((q) => /FROM data_overrides/.test(q.text))).toBe(false);
    });
  });

  // ISSUE-264 F-002: match_results takes the same ascending match locks as the stats hook, in
  // the strength its own upsert takes, before it writes anything.
  describe('match_results promotion lock', () => {
    function lockSql(opts: { lockFails?: string } = {}) {
      const queries: { text: string; values: unknown[] }[] = [];
      const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.join('?');
        queries.push({ text, values });
        if (/current_setting\('lock_timeout'\)/.test(text)) return Promise.resolve([{ previous: '0' }]);
        if (/set_config\('lock_timeout'/.test(text)) return Promise.resolve([]);
        if (/FROM matches/.test(text)) {
          return opts.lockFails
            ? Promise.reject(Object.assign(new Error('canceling statement'), { code: opts.lockFails }))
            : Promise.resolve([]);
        }
        throw new Error(`unexpected query: ${text}`);
      };
      return { sql: tag as unknown as Sql, queries };
    }

    const mrRow = (rowNo: number, roundCode: string, over: Record<string, number | string | null> = {}): PromotionRow => ({
      rowNo,
      payload: { season: '2073', round_code: roundCode, match_date: '2073-04-21', home_club: 'Home FC', away_club: 'Away FC' },
      resolved: { season: 2073, home_club_name: 'Home FC', away_club_name: 'Away FC', ...over },
    });
    const prepare = (rows: PromotionRow[], sql: Sql) => matchResults.preparePromotion!(rows, { sql });

    it('locks the existing target matches by key, ordered by id, FOR NO KEY UPDATE, and writes nothing', async () => {
      const { sql, queries } = lockSql();
      await prepare([mrRow(1, 'R2'), mrRow(2, 'R1'), mrRow(3, 'R2')], sql);
      const lock = queries.find((q) => /FROM matches/.test(q.text))!;
      expect(lock.text).toMatch(/WHERE match_key = ANY\([\s\S]*ORDER BY id\s+FOR NO KEY UPDATE\s*$/);
      expect(lock.text).not.toMatch(/FOR UPDATE|FOR SHARE/);
      // One key per distinct match, in the promotion's own key format (a duplicate row adds none).
      expect(lock.values[0]).toEqual([
        '2073|R2|2073-04-21|Home FC|Away FC', '2073|R1|2073-04-21|Home FC|Away FC',
      ]);
      expect(queries.some((q) => /\b(INSERT|DELETE)\b|\bUPDATE\s+\w/.test(q.text))).toBe(false);
    });

    it('bounds the wait transaction-locally and restores the setting after the lock', async () => {
      const { sql, queries } = lockSql();
      await prepare([mrRow(1, 'R1')], sql);
      expect(queries.filter((q) => /set_config\('lock_timeout'/.test(q.text)).map((q) => q.values))
        .toEqual([['5s'], ['0']]);
      const lock = queries.findIndex((q) => /FROM matches/.test(q.text));
      expect(queries.findIndex((q) => /set_config/.test(q.text))).toBeLessThan(lock);
      expect(queries.length - 1).toBeGreaterThan(lock);
      expect(queries.some((q) => /\bSET\s+(LOCAL\s+)?lock_timeout/i.test(q.text))).toBe(false);
    });

    it.each(['55P03', '40P01'])('turns SQLSTATE %s into the retryable refusal', async (code) => {
      await expect(prepare([mrRow(1, 'R1')], lockSql({ lockFails: code }).sql))
        .rejects.toThrow(LEGACY_PROMOTION_LOCK_REFUSAL);
    });

    it.each<[string, Record<string, number | string | null>]>([
      ['no resolved season', { season: null }],
      ['a text season', { season: '2073' }],
      ['no home club name', { home_club_name: null }],
      ['no away club name', { away_club_name: null }],
    ])('refuses %s before taking any lock', async (_label, over) => {
      const { sql, queries } = lockSql();
      await expect(prepare([mrRow(4, 'R1', over)], sql)).rejects.toThrow(/Row 4 carries no resolved season, clubs, round or date/);
      expect(queries).toEqual([]);
    });

    it('refuses a row with no round code or date before taking any lock', async () => {
      const { sql, queries } = lockSql();
      const noRound: PromotionRow = { ...mrRow(5, 'R1'), payload: { match_date: '2073-04-21' } };
      const noDate: PromotionRow = { ...mrRow(6, 'R1'), payload: { round_code: 'R1' } };
      await expect(prepare([noRound], sql)).rejects.toThrow(/Row 5 carries no resolved season, clubs, round or date/);
      await expect(prepare([noDate], sql)).rejects.toThrow(/Row 6 carries no resolved season, clubs, round or date/);
      expect(queries).toEqual([]);
    });
  });

  // ISSUE-264 F-005: which authority is relevant to a row. Authority is attributed through the
  // match a row resolves to (by id, from season/round/clubs) and the player identity; a record is
  // relevant only if it resolves onto that match, or poisons the table because it cannot be placed.
  describe('which unresolved or indeterminate authority is relevant to a row', () => {
    const UNRELATED_KEY = '2073|R9|2073-05-01|Elsewhere FC|Away FC';
    const MATCH_500 = { id: 500, homeClubId: 1, awayClubId: 2 };
    const MATCH_501 = { id: 501, homeClubId: 2, awayClubId: 1 };
    const wide = (records: Rec[]) => buildPlayerMatchStatsAuthority({
      season: 2073,
      records,
      matchesByKey: new Map([[MK, MATCH_500], [MK2, MATCH_501]]),
      playerIdsByIdentity: new Map([[IDENTITY, [900]], [OTHER, [901]]]),
      clubIdBySlug: new Map([['home-fc', 1], ['away-fc', 2]]),
      continuity: NO_RULES,
    });
    const refusalFor = (authority: ReturnType<typeof wide>, matchId: number, write = { club_id: 1, goals: 4 }) =>
      legacyStatsAuthorityRefusal({ authority, playerId: 900, matchId, write, rowExists: true });

    it.each([
      ['a readable record', { goals: 3 }],
      ['an unreadable record', { bogus: 1 }],
    ])('does not refuse a match because %s names a key no match carries', async (_label, payload) => {
      const records = [rec('match_sheet', payload, { key: `${UNRELATED_KEY}|${IDENTITY}` })];
      const authority = wide(records);
      expect([...authority.unresolvedMatchKeys]).toEqual([UNRELATED_KEY]);
      expect(authority.allIndeterminate).toBe(false);
      expect(authority.indeterminateMatchIds.size).toBe(0);
      expect(refusalFor(authority, 500)).toBeNull();
      expect((await validate({ goals: '4' }, records)).verdict).toBe('ok');
    });

    it('marks only the match an unreadable record resolves onto, not its neighbours', () => {
      const authority = wide([rec('match_sheet', { bogus: 1 }, { key: `${MK2}|${IDENTITY}` })]);
      expect([...authority.indeterminateMatchIds]).toEqual([501]);
      expect(refusalFor(authority, 501)).toContain('cannot be attributed to exactly one player');
      expect(refusalFor(authority, 500)).toBeNull();
    });

    it('lets one undecodable key refuse every row, in every season (it cannot be placed)', () => {
      const authority = wide([rec('match_sheet', { goals: 3 }, { key: 'not-a-key' })]);
      expect(authority.allIndeterminate).toBe(true);
      expect(refusalFor(authority, 500)).toContain('cannot be read');
      expect(refusalFor(authority, 501)).toContain('cannot be read');
    });

    // The rekey carry re-encodes `<old key>|<identity>` as `<new key>|<identity>`
    // (match-rekey.ts planPlayerMatchStatsCarry). The builder must resolve that to the same pair.
    it('attributes a record carried to the new key by a rekey to the same match and player', () => {
      const NEW_KEY = '2073|R1|2073-03-02|Home FC|Away FC';
      const oldEntityKey = `${MK}|${IDENTITY}`;
      const carried = encodePlayerMatchStatsKey(NEW_KEY, oldEntityKey.slice(`${MK}|`.length));
      expect(carried).toEqual({ ok: true, entityKey: `${NEW_KEY}|${IDENTITY}` });
      const authority = buildPlayerMatchStatsAuthority({
        season: 2073,
        records: [rec('match_sheet', PROTECTED, { key: `${NEW_KEY}|${IDENTITY}` })],
        matchesByKey: new Map([[NEW_KEY, MATCH_500]]),
        playerIdsByIdentity: new Map([[IDENTITY, [900]]]),
        clubIdBySlug: new Map([['home-fc', 1], ['away-fc', 2]]),
        continuity: NO_RULES,
      });
      expect(authority.unresolvedMatchKeys.size).toBe(0);
      expect(refusalFor(authority, 500)).toContain('goals (file 4, Match Sheet 3)');
    });
  });

  it('the pure decision answers clear when there is no authority at all', () => {
    expect(legacyStatsAuthorityRefusal({
      authority: NO_PLAYER_MATCH_STATS_AUTHORITY, playerId: 900, matchId: 500,
      write: { club_id: 1, goals: 99 }, rowExists: false,
    })).toBeNull();
  });
});
