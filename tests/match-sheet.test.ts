import * as fs from 'fs';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

import {
  BROWNLOW_MATCH_SHEET_REFUSAL,
  autoDisposalsFromComponents,
  deriveDisposals,
  validateMatchSheetPayload,
} from '@/lib/match-sheet';
import {
  AUTHORITY_UNAVAILABLE_REFUSAL,
  buildMatchSheetAuthorityWrites,
  MATCH_SHEET_SETTLE_RUNNING_REFUSAL,
  computeMatchSheetDelta,
  interpretKeyAuthority,
  matchSheetRetryableRefusal,
  matchSheetStaleToken,
  mergeMatchSheetDelta,
  parseLineupPayload,
  parseMatchSheetPayload,
  planMatchSheetChanges,
  planReturnToSource,
  protectedColumnsOf,
  SETTLING_SOURCE_KEYS,
  summariseActiveMatchAuthority,
  type MatchSheetRowValues,
  type MatchSheetStatRow,
} from '@/lib/acquisition/match-sheet-authority';
import {
  DERIVED_RECOMPUTE_DEADLOCK_BACKOFF_MS,
  runDerivedRecomputeWithDeadlockRetry,
  type SavepointTx,
} from '@/lib/acquisition/settle-core';
import type { PlayerMatchStatInput } from '@/lib/match-sheet';

describe('match-sheet write validation', () => {
  it('accepts and normalises a valid payload', () => {
    const result = validateMatchSheetPayload({
      players: [{
        playerId: 10,
        clubId: 2,
        jumperNumber: ' 7 ',
        kicks: 12,
        handballs: 8,
        disposals: 20,
      }],
      removedPlayerIds: [11, 11],
    });

    expect(result).toEqual({
      ok: true,
      value: {
        players: [{
          playerId: 10,
          clubId: 2,
          jumperNumber: '7',
          goals: null,
          behinds: null,
          kicks: 12,
          handballs: 8,
          disposals: 20,
          marks: null,
          tackles: null,
          hitouts: null,
          freesFor: null,
          freesAgainst: null,
          brownlowVotes: null,
        }],
        removedPlayerIds: [11],
      },
    });
  });

  it.each([
    [{ players: [{ playerId: 1, clubId: 2, goals: -1 }] }, 'invalid goals'],
    [{ players: [{ playerId: 1, clubId: 2 }, { playerId: 1, clubId: 3 }] }, 'appears more than once'],
    [{ players: [{ playerId: 1, clubId: 2 }], removedPlayerIds: [1] }, 'cannot be both active and removed'],
    [{ players: [{ playerId: 1, clubId: 2, kicks: 4, handballs: 3, disposals: 8 }] }, 'do not equal'],
    [{ players: 'not-an-array' }, 'must be an array'],
  ])('rejects malformed or unsafe payloads', (payload, message) => {
    const result = validateMatchSheetPayload(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });

  it('derives disposals only when both components are recorded', () => {
    expect(deriveDisposals(10, 5, null)).toBe(15);
    expect(deriveDisposals(10, null, null)).toBeNull();
    expect(deriveDisposals(null, 5, null)).toBeNull();
    expect(deriveDisposals(10, 5, 16)).toBe(16);
  });

  it('auto-fills disposals only from two recorded components', () => {
    expect(autoDisposalsFromComponents('10', '5')).toBe('15');
    expect(autoDisposalsFromComponents('11', '5')).toBe('16');
    expect(autoDisposalsFromComponents('0', '5')).toBe('5');
    expect(autoDisposalsFromComponents('10', '0')).toBe('10');
    expect(autoDisposalsFromComponents('', '5')).toBe('');
    expect(autoDisposalsFromComponents('10', '')).toBe('');
    expect(autoDisposalsFromComponents('', '')).toBe('');
  });

  // AFLDB-ISSUE-155 §27.15: the match sheet is no longer a Brownlow writer.
  // The previously accepted 3/2/1 allocation is now the primary refusal case.
  it.each([
    ['a complete 3-2-1 allocation', [
      { playerId: 1, clubId: 10, brownlowVotes: 3 },
      { playerId: 2, clubId: 10, brownlowVotes: 2 },
      { playerId: 3, clubId: 20, brownlowVotes: 1 },
      { playerId: 4, clubId: 20, brownlowVotes: 0 },
    ]],
    ['an explicit zero on its own', [{ playerId: 1, clubId: 10, brownlowVotes: 0 }]],
    ['a single 3-vote row', [{ playerId: 1, clubId: 10, brownlowVotes: 3 }]],
    ['a value outside the historical range', [{ playerId: 1, clubId: 10, brownlowVotes: 4 }]],
    ['a partial allocation', [
      { playerId: 1, clubId: 10, brownlowVotes: 3 },
      { playerId: 2, clubId: 20, brownlowVotes: 2 },
    ]],
  ])('refuses any Brownlow value from the match sheet: %s', (_label, players) => {
    const result = validateMatchSheetPayload({ players });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(BROWNLOW_MATCH_SHEET_REFUSAL);
  });

  it('names Brownlow administration in the refusal so the editor can redirect', () => {
    expect(BROWNLOW_MATCH_SHEET_REFUSAL).toContain('/admin/brownlow');
  });

  it('still accepts a sheet that carries no Brownlow value at all', () => {
    expect(validateMatchSheetPayload({
      players: [{ playerId: 1, clubId: 10 }, { playerId: 2, clubId: 20 }],
    }).ok).toBe(true);
    expect(validateMatchSheetPayload({
      players: [{ playerId: 1, clubId: 10, brownlowVotes: null }],
    }).ok).toBe(true);
  });

  it('normalises the mirror to null so the writer never carries a vote through', () => {
    const result = validateMatchSheetPayload({
      players: [{ playerId: 1, clubId: 10, goals: 2 }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.players[0].brownlowVotes).toBeNull();
  });
});

/*
 * AFLDB-ISSUE-257 Slice 1 — durable Match Sheet authority: the changed-field
 * calculation, the payload shapes and the record interpretation (DB-free).
 */
const BLANK_ROW: MatchSheetRowValues = {
  club_slug: 'carlton', jumper_number: null, goals: null, behinds: null, kicks: null,
  handballs: null, disposals: null, marks: null, tackles: null, hitouts: null,
  frees_for: null, frees_against: null,
};
const row = (over: Partial<MatchSheetRowValues>): MatchSheetRowValues => ({ ...BLANK_ROW, ...over });

describe('ISSUE-257 changed-field calculation', () => {
  it('records nothing for an unchanged row', () => {
    const pre = row({ goals: 2, kicks: 10, handballs: 5, disposals: 15 });
    expect(computeMatchSheetDelta(pre, { ...pre })).toEqual({});
  });

  it('records only the changed field, and an unchanged null stays untouched', () => {
    const pre = row({ goals: 2, marks: 4 });
    expect(computeMatchSheetDelta(pre, row({ goals: 3, marks: 4 }))).toEqual({ goals: 3 });
  });

  it('distinguishes an explicit null (changed to not-recorded) from untouched', () => {
    const delta = computeMatchSheetDelta(row({ goals: 2, marks: 4 }), row({ goals: null, marks: 4 }));
    expect(delta).toEqual({ goals: null });
    expect('goals' in delta).toBe(true);
    expect('marks' in delta).toBe(false);
  });

  it('never coerces null to zero', () => {
    expect(computeMatchSheetDelta(row({ goals: null }), row({ goals: 0 }))).toEqual({ goals: 0 });
    expect(computeMatchSheetDelta(row({ goals: 0 }), row({ goals: null }))).toEqual({ goals: null });
  });

  it('records the kicks/handballs/disposals triple as one unit', () => {
    const pre = row({ kicks: 10, handballs: 5, disposals: 15, goals: 1 });
    const delta = computeMatchSheetDelta(pre, row({ kicks: 12, handballs: 5, disposals: 17, goals: 1 }));
    expect(delta).toEqual({ kicks: 12, handballs: 5, disposals: 17 });
    // Changing only disposals still carries all three.
    expect(computeMatchSheetDelta(pre, row({ kicks: 10, handballs: 5, disposals: null, goals: 1 })))
      .toEqual({ kicks: 10, handballs: 5, disposals: null });
    // No member changed: none recorded.
    expect(computeMatchSheetDelta(pre, row({ ...pre, goals: 2 }))).toEqual({ goals: 2 });
  });

  it('stores the club as club_slug and protects it as club_id', () => {
    const delta = computeMatchSheetDelta(row({ club_slug: 'carlton' }), row({ club_slug: 'collingwood' }));
    expect(delta).toEqual({ club_slug: 'collingwood' });
    expect([...protectedColumnsOf({ club_slug: 'x', goals: null })].sort()).toEqual(['club_id', 'goals']);
  });

  it('treats a missing row as all-null: an addition records its non-null fields and the club', () => {
    expect(computeMatchSheetDelta(null, row({ jumper_number: '7', goals: 1 })))
      .toEqual({ club_slug: 'carlton', jumper_number: '7', goals: 1 });
    // A zero entered on an addition is a recorded zero, not an absence.
    expect(computeMatchSheetDelta(null, row({ behinds: 0 })))
      .toEqual({ club_slug: 'carlton', behinds: 0 });
    // A partial triple on an addition still carries the whole unit.
    expect(computeMatchSheetDelta(null, row({ kicks: 4 })))
      .toEqual({ club_slug: 'carlton', kicks: 4, handballs: null, disposals: null });
  });

  it('merges a later save: existing keys kept, incoming overwrite, changed-back stays recorded', () => {
    expect(mergeMatchSheetDelta({ goals: 3, marks: 4 }, { goals: 2, tackles: 1 }))
      .toEqual({ goals: 2, marks: 4, tackles: 1 });
    expect(mergeMatchSheetDelta(null, { goals: 1 })).toEqual({ goals: 1 });
  });
});

describe('ISSUE-257 authority payloads fail closed', () => {
  it('accepts a flat delta and rejects every unreadable shape', () => {
    expect(parseMatchSheetPayload({ club_slug: 'carlton', goals: 3, marks: null })).toEqual({
      ok: true, value: { club_slug: 'carlton', goals: 3, marks: null },
    });
    for (const bad of [
      null, [], 'x', {}, { unknown_key: 1 }, { goals: -1 }, { goals: 1.5 }, { goals: '3' },
      { club_slug: null }, { club_slug: '' }, { jumper_number: 'abcde' }, { goals: 99999 },
      { kicks: 5 }, { kicks: 5, handballs: 5 },
      { kicks: 5, handballs: 5, disposals: 11 },
    ]) {
      expect(parseMatchSheetPayload(bad).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(parseMatchSheetPayload({ kicks: 5, handballs: 5, disposals: 10 }).ok).toBe(true);
    expect(parseMatchSheetPayload({ kicks: 5, handballs: null, disposals: null }).ok).toBe(true);
  });

  it('accepts exactly {"present": boolean} for lineup', () => {
    expect(parseLineupPayload({ present: true })).toEqual({ ok: true, value: { present: true } });
    expect(parseLineupPayload({ present: false })).toEqual({ ok: true, value: { present: false } });
    for (const bad of [null, {}, { present: 'yes' }, { present: true, extra: 1 }, { Present: true }, []]) {
      expect(parseLineupPayload(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('interprets active, withdrawn, addition and removal records', () => {
    expect(interpretKeyAuthority([])).toEqual({ ok: true, fields: null, presence: null });
    expect(interpretKeyAuthority([
      { fieldGroup: 'match_sheet', isActive: true, overrideValues: { goals: 2 } },
      { fieldGroup: 'lineup', isActive: true, overrideValues: { present: true } },
    ])).toEqual({ ok: true, fields: { goals: 2 }, presence: 'present' });
    expect(interpretKeyAuthority([
      { fieldGroup: 'match_sheet', isActive: false, overrideValues: { goals: 2 } },
      { fieldGroup: 'lineup', isActive: true, overrideValues: { present: false } },
    ])).toEqual({ ok: true, fields: null, presence: 'removed' });
    // Withdrawn means no authority, and a withdrawn payload is not even parsed.
    expect(interpretKeyAuthority([
      { fieldGroup: 'match_sheet', isActive: false, overrideValues: { bogus: 1 } },
    ])).toEqual({ ok: true, fields: null, presence: null });
  });

  it('refuses an active unreadable payload, an unknown group and a duplicated group', () => {
    expect(interpretKeyAuthority([
      { fieldGroup: 'match_sheet', isActive: true, overrideValues: { bogus: 1 } },
    ]).ok).toBe(false);
    expect(interpretKeyAuthority([
      { fieldGroup: 'stats', isActive: true, overrideValues: { goals: 1 } },
    ])).toMatchObject({ ok: false, reason: 'unknown_field_group' });
    expect(interpretKeyAuthority([
      { fieldGroup: 'lineup', isActive: true, overrideValues: { present: true } },
      { fieldGroup: 'lineup', isActive: true, overrideValues: { present: true } },
    ])).toMatchObject({ ok: false, reason: 'duplicate_field_group' });
  });
});

const STAT = (over: Partial<MatchSheetStatRow> & { playerId: number }): MatchSheetStatRow => ({
  clubId: 1, jumperNumber: '5', goals: 1, behinds: 0, kicks: 10, handballs: 5, disposals: 15,
  marks: 3, tackles: 2, hitouts: null, freesFor: 1, freesAgainst: 0, ...over,
});
const SLUGS = new Map([[1, 'carlton'], [2, 'essendon']]);
const NO_CONTINUITY = { ok: false as const, detail: 'unused' };
const MK = '2000|carlton|essendon|r1';
const identity = (path: string) => ({ afltablesPaths: [path], manualTokens: [] as string[] });

describe('ISSUE-257 Slice 3 stale-sheet token', () => {
  const rows = [STAT({ playerId: 2 }), STAT({ playerId: 1, goals: 4 })];

  it('is deterministic and independent of row order', () => {
    expect(matchSheetStaleToken(rows)).toBe(matchSheetStaleToken([...rows].reverse()));
    expect(matchSheetStaleToken(rows)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes on a value change, an inserted row and a deleted row', () => {
    const base = matchSheetStaleToken(rows);
    expect(matchSheetStaleToken([rows[0], { ...rows[1], goals: 5 }])).not.toBe(base);
    expect(matchSheetStaleToken([...rows, STAT({ playerId: 3 })])).not.toBe(base);
    expect(matchSheetStaleToken([rows[0]])).not.toBe(base);
    // NULL ("not recorded") is not zero.
    expect(matchSheetStaleToken([STAT({ playerId: 1, hitouts: null })]))
      .not.toBe(matchSheetStaleToken([STAT({ playerId: 1, hitouts: 0 })]));
  });
});

describe('ISSUE-257 Slice 3 per-player planning', () => {
  const locked = [STAT({ playerId: 1 }), STAT({ playerId: 2 })];
  const plan = (players: PlayerMatchStatInput[], removedPlayerIds: number[] = []) => {
    const result = planMatchSheetChanges({ locked, players, removedPlayerIds, clubSlugById: SLUGS });
    if (!result.ok) throw new Error(result.error);
    return result.items;
  };
  const same = (playerId: number): PlayerMatchStatInput => ({
    playerId, clubId: 1, jumperNumber: '5', goals: 1, behinds: 0, kicks: 10, handballs: 5,
    disposals: 15, marks: 3, tackles: 2, hitouts: null, freesFor: 1, freesAgainst: 0,
  });

  it('plans nothing for an unchanged row', () => {
    expect(plan([same(1), same(2)])).toEqual([]);
  });

  it('records only the changed field; null is explicit, untouched is absent', () => {
    const [item] = plan([{ ...same(1), goals: 4, marks: null }]);
    expect(item).toMatchObject({ kind: 'update', playerId: 1, delta: { goals: 4, marks: null } });
    expect(Object.keys((item as { delta: object }).delta).sort()).toEqual(['goals', 'marks']);
  });

  it('keeps the coupled disposal triple together', () => {
    const [item] = plan([{ ...same(1), kicks: 12, disposals: 17 }]);
    expect(item).toMatchObject({ delta: { kicks: 12, handballs: 5, disposals: 17 } });
  });

  it('records a club change as club_slug', () => {
    const [item] = plan([{ ...same(1), clubId: 2 }]);
    expect(item).toMatchObject({ delta: { club_slug: 'essendon' } });
  });

  it('plans an addition with only the entered fields plus club_slug', () => {
    const [item] = plan([{ playerId: 9, clubId: 2, goals: 2, jumperNumber: ' 7 ' }]);
    expect(item).toMatchObject({ kind: 'add', playerId: 9, pre: null, delta: { club_slug: 'essendon', jumper_number: '7', goals: 2 } });
  });

  it('plans a removal, and ignores removing a row that is not there', () => {
    expect(plan([], [2, 77])).toMatchObject([{ kind: 'remove', playerId: 2 }]);
  });

  it('refuses a club with no slug', () => {
    const result = planMatchSheetChanges({
      locked, players: [{ ...same(1), clubId: 3 }], removedPlayerIds: [], clubSlugById: SLUGS,
    });
    expect(result.ok).toBe(false);
  });
});

describe('ISSUE-257 Slice 3 authority writes', () => {
  const locked = [STAT({ playerId: 1 }), STAT({ playerId: 2 })];
  const items = (players: PlayerMatchStatInput[], removedPlayerIds: number[] = []) => {
    const result = planMatchSheetChanges({ locked, players, removedPlayerIds, clubSlugById: SLUGS });
    if (!result.ok) throw new Error(result.error);
    return result.items;
  };
  const edit = (playerId: number, over: Partial<PlayerMatchStatInput>): PlayerMatchStatInput => ({
    playerId, clubId: 1, jumperNumber: '5', goals: 1, behinds: 0, kicks: 10, handballs: 5,
    disposals: 15, marks: 3, tackles: 2, hitouts: null, freesFor: 1, freesAgainst: 0, ...over,
  });
  const build = (
    planned: ReturnType<typeof items>,
    over: Partial<Parameters<typeof buildMatchSheetAuthorityWrites>[0]> = {},
  ) => buildMatchSheetAuthorityWrites({
    matchKey: MK,
    items: planned,
    storable: true,
    continuity: NO_CONTINUITY,
    identities: new Map([[1, identity('players/a/a1.html')], [2, identity('players/b/b1.html')]]),
    records: [],
    ...over,
  });

  it('mints a key from the classified identity and writes a field change', () => {
    const result = build(items([edit(1, { goals: 4 })]));
    expect(result).toMatchObject({
      ok: true,
      keys: [{ playerId: 1, entityKey: `${MK}|afltables:players/a/a1.html`, action: 'mint' }],
      ops: [{ kind: 'upsert', fieldGroup: 'match_sheet', payload: { goals: 4 } }],
    });
  });

  it('merges over the ACTIVE payload but starts fresh over an inactive one', () => {
    const key = `${MK}|afltables:players/a/a1.html`;
    const planned = items([edit(1, { goals: 4 })]);
    const active = build(planned, { records: [
      { entityKey: key, fieldGroup: 'match_sheet', isActive: true, overrideValues: { marks: 9 } },
    ] });
    expect(active).toMatchObject({ ok: true, ops: [{ payload: { marks: 9, goals: 4 } }] });
    const inactive = build(planned, { records: [
      { entityKey: key, fieldGroup: 'match_sheet', isActive: false, overrideValues: { marks: 9 } },
    ] });
    expect(inactive).toMatchObject({ ok: true, ops: [{ payload: { goals: 4 } }] });
  });

  it('reuses the key of an earlier identity form (D-257-8)', () => {
    // The decision was made under a manual token; the player has since gained a path.
    const oldKey = `${MK}|manual_admin_edit:tok1`;
    const result = build(items([edit(1, { goals: 4 })]), {
      identities: new Map([[1, { afltablesPaths: ['players/a/new.html'], manualTokens: ['tok1'] }]]),
      records: [{ entityKey: oldKey, fieldGroup: 'lineup', isActive: true, overrideValues: { present: true } }],
    });
    expect(result).toMatchObject({ ok: true, keys: [{ entityKey: oldKey, action: 'reuse' }] });
  });

  it('refuses ambiguity, no identity, and an unreadable stored payload', () => {
    const planned = items([edit(1, { goals: 4 })]);
    expect(build(planned, { identities: new Map() })).toMatchObject({ ok: false });
    expect(build(planned, {
      identities: new Map([[1, { afltablesPaths: ['players/a/x.html', 'players/a/y.html'], manualTokens: [] }]]),
    })).toMatchObject({ ok: false });
    expect(build(planned, { records: [{
      entityKey: `${MK}|afltables:players/a/a1.html`, fieldGroup: 'match_sheet', isActive: true,
      overrideValues: { bogus: 1 },
    }] })).toMatchObject({ ok: false });
  });

  it('plans an addition as lineup present + only the entered fields', () => {
    const result = build(items([{ playerId: 9, clubId: 2, goals: 2 }]), {
      identities: new Map([[9, identity('players/c/c1.html')]]),
    });
    expect(result).toMatchObject({
      ok: true,
      ops: [
        { kind: 'upsert', fieldGroup: 'lineup', payload: { present: true } },
        { kind: 'upsert', fieldGroup: 'match_sheet', payload: { club_slug: 'essendon', goals: 2 } },
      ],
    });
  });

  it('plans a removal as lineup absent + match_sheet deactivation; a re-add reactivates lineup', () => {
    const removal = build(items([], [2]));
    expect(removal).toMatchObject({
      ok: true,
      ops: [
        { kind: 'upsert', fieldGroup: 'lineup', payload: { present: false } },
        { kind: 'deactivate', fieldGroup: 'match_sheet' },
      ],
    });
    const key = `${MK}|afltables:players/b/b1.html`;
    const readd = buildMatchSheetAuthorityWrites({
      matchKey: MK,
      items: (() => {
        const r = planMatchSheetChanges({ locked: [], players: [{ playerId: 2, clubId: 1, goals: 1 }], removedPlayerIds: [], clubSlugById: SLUGS });
        if (!r.ok) throw new Error(r.error);
        return r.items;
      })(),
      storable: true,
      continuity: NO_CONTINUITY,
      identities: new Map([[2, identity('players/b/b1.html')]]),
      records: [{ entityKey: key, fieldGroup: 'lineup', isActive: true, overrideValues: { present: false } }],
    });
    expect(readd).toMatchObject({
      ok: true,
      keys: [{ entityKey: key, action: 'reuse' }],
      ops: [{ fieldGroup: 'lineup', payload: { present: true } }, { fieldGroup: 'match_sheet' }],
    });
  });

  it('refuses every authority write while the storable probe is false (State A)', () => {
    const result = build(items([edit(1, { goals: 4 })]), { storable: false });
    expect(result).toEqual({ ok: false, error: AUTHORITY_UNAVAILABLE_REFUSAL });
    expect(result.ok === false && result.error).toContain('migration 110');
  });

  it('a save that changes nothing writes no authority, even in State A', () => {
    expect(build(items([edit(1, {})]), { storable: false })).toEqual({ ok: true, ops: [], keys: [] });
  });
});

describe('F-S4-01 deadlock handling (AFLDB-ISSUE-257)', () => {
  function pgError(code: string): Error & { code: string } {
    return Object.assign(new Error(`pg ${code}`), { code });
  }

  function harness(outcomes: ReadonlyArray<'ok' | string>) {
    const statements: string[] = [];
    const sleeps: number[] = [];
    let calls = 0;
    const tx: SavepointTx = async (strings) => {
      statements.push(strings.join('?').trim());
      return [];
    };
    const work = async () => {
      const outcome = outcomes[Math.min(calls, outcomes.length - 1)];
      calls += 1;
      statements.push('<work>');
      if (outcome !== 'ok') throw pgError(outcome);
      return 'done';
    };
    const sleep = async (ms: number) => { sleeps.push(ms); };
    return { tx, work, sleep, statements, sleeps, calls: () => calls };
  }

  it('retries a first-attempt 40P01 from a rolled-back savepoint, then succeeds', async () => {
    const h = harness(['40P01', 'ok']);
    const result = await runDerivedRecomputeWithDeadlockRetry(h.tx, h.work, { sleep: h.sleep });
    expect(result).toEqual({ value: 'done', attempts: 2 });
    expect(h.statements).toEqual([
      'SAVEPOINT afldb_derived_recompute',
      '<work>',
      'ROLLBACK TO SAVEPOINT afldb_derived_recompute',
      'RELEASE SAVEPOINT afldb_derived_recompute',
      'SAVEPOINT afldb_derived_recompute',
      '<work>',
      'RELEASE SAVEPOINT afldb_derived_recompute',
    ]);
    expect(h.sleeps).toEqual([DERIVED_RECOMPUTE_DEADLOCK_BACKOFF_MS[0]]);
  });

  it('propagates the 40P01 once attempts are exhausted, leaving the caller to roll back the whole settle', async () => {
    const h = harness(['40P01']);
    await expect(runDerivedRecomputeWithDeadlockRetry(h.tx, h.work, { sleep: h.sleep }))
      .rejects.toMatchObject({ code: '40P01' });
    expect(h.calls()).toBe(DERIVED_RECOMPUTE_DEADLOCK_BACKOFF_MS.length + 1);
    expect(h.sleeps).toEqual([...DERIVED_RECOMPUTE_DEADLOCK_BACKOFF_MS]);
    // The last attempt is not absorbed: no rollback-to/release after the final <work>.
    expect(h.statements.at(-1)).toBe('<work>');
  });

  it.each(['23505', '55P03', '40001', '57014'])('never retries a non-40P01 error (%s)', async (code) => {
    const h = harness([code, 'ok']);
    await expect(runDerivedRecomputeWithDeadlockRetry(h.tx, h.work, { sleep: h.sleep }))
      .rejects.toMatchObject({ code });
    expect(h.calls()).toBe(1);
    expect(h.sleeps).toEqual([]);
    expect(h.statements).toEqual(['SAVEPOINT afldb_derived_recompute', '<work>']);
  });

  it('never retries a plain error without a SQLSTATE', async () => {
    const statements: string[] = [];
    const tx: SavepointTx = async (strings) => { statements.push(strings.join('?')); return []; };
    let calls = 0;
    await expect(runDerivedRecomputeWithDeadlockRetry(tx, async () => {
      calls += 1;
      throw new Error('boom');
    }, { sleep: async () => {} })).rejects.toThrow('boom');
    expect(calls).toBe(1);
  });

  it('total backoff outlasts the Match Sheet writer lock_timeout it is sized against', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/db/queries/match-sheet.ts'), 'utf-8');
    expect(src).toContain("SET LOCAL lock_timeout = '5s'");
    const total = DERIVED_RECOMPUTE_DEADLOCK_BACKOFF_MS.reduce((sum, ms) => sum + ms, 0);
    expect(total).toBeGreaterThan(5000);
  });

  it('maps 40P01 and 55P03 from saveMatchSheet to the retryable settle-running refusal only', () => {
    expect(matchSheetRetryableRefusal(pgError('40P01'))).toBe(MATCH_SHEET_SETTLE_RUNNING_REFUSAL);
    expect(matchSheetRetryableRefusal(pgError('55P03'))).toBe(MATCH_SHEET_SETTLE_RUNNING_REFUSAL);
    expect(MATCH_SHEET_SETTLE_RUNNING_REFUSAL).toContain('Nothing was saved');
    for (const code of ['23505', '40001', '57014', '42P01']) {
      expect(matchSheetRetryableRefusal(pgError(code))).toBeNull();
    }
    expect(matchSheetRetryableRefusal(new Error('x'))).toBeNull();
    expect(matchSheetRetryableRefusal(null)).toBeNull();
  });

  it('both settles route their end-of-run recompute through the bounded retry', () => {
    for (const file of ['src/lib/acquisition/settle-afltables.ts', 'src/lib/acquisition/settle-afl-api.ts']) {
      const src = fs.readFileSync(path.join(process.cwd(), file), 'utf-8');
      const wrapped = src.match(/runDerivedRecomputeWithDeadlockRetry\(tx, async \(\) => \{[\s\S]*?\n\s*\}\);/g) ?? [];
      expect(wrapped, file).toHaveLength(1);
      expect(wrapped[0]).toContain('recomputePlayerDerivedStats(tx, playerIds, bundle.season)');
      // No bare end-of-run recompute left outside the wrapper.
      expect(src.split('recomputePlayerDerivedStats(tx, playerIds, bundle.season)').length - 1, file).toBe(1);
    }
    const sheet = fs.readFileSync(path.join(process.cwd(), 'src/db/queries/match-sheet.ts'), 'utf-8');
    expect(sheet).toContain('matchSheetRetryableRefusal(err)');
  });
});

describe('ISSUE-257 Slice 7 return to source and deletion guard', () => {
  const KEY_A = `${MK}|afltables:players/a/a1.html`;
  const EMPTY_RULES = { ok: true as const, rules: [] as never };
  const ids = new Map([['afltables:players/a/a1.html', [1]]]);
  const rec = (entityKey: string, fieldGroup: string, isActive: boolean, overrideValues: unknown) =>
    ({ entityKey, fieldGroup, isActive, overrideValues });
  const authority = (records: Parameters<typeof interpretKeyAuthority>[0]) => interpretKeyAuthority(records);

  const addition = authority([
    rec(KEY_A, 'lineup', true, { present: true }), rec(KEY_A, 'match_sheet', true, { goals: 2 }),
  ]);
  const removal = authority([rec(KEY_A, 'lineup', true, { present: false })]);
  const fieldsOnly = authority([rec(KEY_A, 'match_sheet', true, { goals: 2 })]);

  it('F-PR-03 transition 1: an addition still unowned is withdrawn and its row deleted', () => {
    expect(planReturnToSource({ authority: addition, row: { sourceKey: null, hasSourceId: false } }))
      .toEqual({ ok: true, action: 'withdraw_delete_row' });
  });

  it('F-PR-03 transition 2: an addition a settling source has since owned is withdrawn and the row kept', () => {
    for (const sourceKey of SETTLING_SOURCE_KEYS) {
      expect(planReturnToSource({ authority: addition, row: { sourceKey, hasSourceId: true } }))
        .toEqual({ ok: true, action: 'withdraw_keep_row' });
    }
  });

  it('F-S7-01 (accepted 2026-10-03): the three provenance cases of a returned manual addition', () => {
    // unowned manual addition -> withdraw authority and delete the row
    expect(planReturnToSource({ authority: addition, row: { sourceKey: null, hasSourceId: false } }))
      .toEqual({ ok: true, action: 'withdraw_delete_row' });
    // former manual addition now owned by the fitzRoy core reload -> withdraw and RETAIN the row
    expect(planReturnToSource({ authority: addition, row: { sourceKey: 'fitzroy_afldata', hasSourceId: true } }))
      .toEqual({ ok: true, action: 'withdraw_keep_row' });
    // unexpected or unsupported provenance still refuses (e.g. a staged-dataset ingest owner)
    for (const sourceKey of ['wikipedia', 'manual_admin_edit', 'fitzroy', 'afltables_current']) {
      const refused = planReturnToSource({ authority: addition, row: { sourceKey, hasSourceId: true } });
      expect(refused.ok === false && refused.error).toContain(`unexpected source (${sourceKey})`);
    }
  });

  it('refuses an addition owned by an unexpected source or with its row missing', () => {
    const owned = planReturnToSource({ authority: addition, row: { sourceKey: 'wikipedia', hasSourceId: true } });
    expect(owned.ok === false && owned.error).toContain('unexpected source (wikipedia)');
    const unknownOwner = planReturnToSource({ authority: addition, row: { sourceKey: null, hasSourceId: true } });
    expect(unknownOwner.ok).toBe(false);
    const missing = planReturnToSource({ authority: addition, row: null });
    expect(missing.ok === false && missing.error).toContain('has no row');
  });

  it('a manual removal is withdrawn only while its row is absent', () => {
    expect(planReturnToSource({ authority: removal, row: null })).toEqual({ ok: true, action: 'withdraw_only' });
    const present = planReturnToSource({ authority: removal, row: { sourceKey: 'afltables', hasSourceId: true } });
    expect(present.ok === false && present.error).toContain('unexpected state');
  });

  it('field authority only is withdrawn with no canonical write, whatever the row', () => {
    expect(planReturnToSource({ authority: fieldsOnly, row: { sourceKey: 'afltables', hasSourceId: true } }))
      .toEqual({ ok: true, action: 'withdraw_only' });
    expect(planReturnToSource({ authority: fieldsOnly, row: null })).toEqual({ ok: true, action: 'withdraw_only' });
  });

  it('refuses when nothing is active or the authority is unreadable', () => {
    const none = authority([rec(KEY_A, 'match_sheet', false, { goals: 2 })]);
    const refused = planReturnToSource({ authority: none, row: null });
    expect(refused.ok === false && refused.error).toContain('no durable Match Sheet authority');
    const unreadable = authority([rec(KEY_A, 'match_sheet', true, 'not an object')]);
    expect(planReturnToSource({ authority: unreadable, row: null }).ok).toBe(false);
  });

  it('summarises only ACTIVE authority; an inactive key never appears', () => {
    const summary = summariseActiveMatchAuthority({
      matchKey: MK,
      records: [
        rec(KEY_A, 'lineup', true, { present: true }),
        rec(KEY_A, 'match_sheet', true, { goals: 2, behinds: 1 }),
        rec(`${MK}|afltables:players/b/b1.html`, 'match_sheet', false, { goals: 1 }),
      ],
      playerIdsByIdentity: ids,
      continuity: EMPTY_RULES,
    });
    expect(summary.indeterminate).toEqual([]);
    expect(summary.entries).toEqual([
      { entityKey: KEY_A, playerId: 1, kind: 'addition', fields: ['goals', 'behinds'], activeGroups: ['lineup', 'match_sheet'] },
    ]);
  });

  it('fails closed: an active key that does not resolve or decode is indeterminate', () => {
    const summary = summariseActiveMatchAuthority({
      matchKey: MK,
      records: [
        rec(`${MK}|afltables:players/z/z9.html`, 'match_sheet', true, { goals: 1 }),
        rec(`${MK}|garbage`, 'lineup', true, { present: true }),
      ],
      playerIdsByIdentity: ids,
      continuity: EMPTY_RULES,
    });
    expect(summary.entries).toEqual([]);
    expect(summary.indeterminate.map((i) => i.reason)).toEqual(['identity unresolved', 'key does not decode']);
  });

  it('ignores records of a longer match key sharing the prefix (section 18.3)', () => {
    const summary = summariseActiveMatchAuthority({
      matchKey: MK,
      records: [rec(`${MK}|extra|afltables:players/a/a1.html`, 'match_sheet', true, { goals: 1 })],
      playerIdsByIdentity: ids,
      continuity: EMPTY_RULES,
    });
    expect(summary).toEqual({ entries: [], indeterminate: [] });
  });

  it('SETTLING_SOURCE_KEYS are the two settles\' SETTLE_SOURCE_KEY and the fitzRoy reload\'s owner key', () => {
    const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf-8');
    expect(read('src/lib/acquisition/settle-afltables.ts')).toContain("export const SETTLE_SOURCE_KEY = 'afltables'");
    expect(read('src/lib/acquisition/settle-afl-api.ts')).toContain("export const SETTLE_SOURCE_KEY = 'afl_api'");
    expect(read('tools/migration/import_fitzroy_core.py')).toContain('SOURCE_KEY_FITZROY = "fitzroy_afldata"');
    expect([...SETTLING_SOURCE_KEYS]).toEqual(['afltables', 'afl_api', 'fitzroy_afldata']);
  });

  it('deleteMatch refuses on authority after the Brownlow refusal and before the first DELETE', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/db/queries/match-admin.ts'), 'utf-8');
    const start = src.indexOf('export async function deleteMatch');
    const body = src.slice(start);
    const brownlow = body.indexOf('brownlow_vote_entry_state');
    const guard = body.indexOf('matchDeletionAuthorityRefusal(');
    const firstDelete = body.indexOf('await tx`DELETE FROM');
    expect(brownlow).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(brownlow);
    expect(firstDelete).toBeGreaterThan(guard);
    expect(body).toContain('match_key AS "matchKey"');
  });

  it('returnMatchSheetToSource throws every refusal inside begin, with lock_timeout, and never catches inside', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/db/queries/match-sheet.ts'), 'utf-8');
    const body = src.slice(src.indexOf('export async function returnMatchSheetToSource'));
    const begin = body.indexOf('importSql.begin(');
    const catchAt = body.indexOf('} catch (err)');
    const inside = body.slice(begin, catchAt);
    expect(begin).toBeGreaterThan(0);
    expect(inside).toContain("SET LOCAL lock_timeout = '5s'");
    expect(inside).toContain('throw new MatchSheetRefusal(');
    expect(inside).not.toMatch(/\bcatch\b/);
    expect(inside).not.toMatch(/return \{ ok: false/);
    expect(inside).toContain('FOR UPDATE OF pms');
    expect(body).toContain('matchSheetRetryableRefusal(err)');
    // Only the granted data_overrides columns are written.
    expect(inside).toContain('SET is_active = false');
    expect(inside).not.toMatch(/DELETE FROM data_overrides/);
  });
});
