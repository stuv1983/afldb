/**
 * AFLDB-ISSUE-274, D-274-2. DB-free checks of the closing sequence of the afldb_import lock test
 * (tests/integration/import-role-lock-fixture.ts): ownership is proved by a per-run marker before any
 * removal, a lost season INSERT reply is reported as possible residue and never removed, and the
 * primary failure and every cleanup problem stay visible. No database, no driver; the operations are
 * fakes over an in-memory table. A new file because the integration file cannot be imported without a
 * database (`./guard` throws) and no existing suite covers this helper.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  finishImportRoleLockCase, type FinishOps, type FixtureLabels, type FixtureState,
} from './integration/import-role-lock-fixture';

const MARKER = 'ISSUE-274 import-role lock fixture run-A';
const LABELS: FixtureLabels = {
  matchKey: '2093|issue122-274-importlock-1', season: 2093, marker: MARKER, roleApplicationName: 'tag-import',
};

type MatchRow = { id: number; notes: string | null };
type SeasonRow = { notes: string | null };

/** An in-memory stand-in for the two tables, with the same ownership predicate the SQL carries. */
function world(initial: { matches?: MatchRow[]; season?: SeasonRow | null } = {}) {
  const matches: MatchRow[] = [...(initial.matches ?? [])];
  const store = { matches, season: initial.season ?? null as SeasonRow | null };
  const calls: string[] = [];
  const knobs = {
    closeRoleThrows: false, goneThrows: false, goneFalse: false,
    deleteMatchThrows: false, deleteSeasonThrows: false, observeThrows: false, closeOwnerThrows: false,
  };
  const ops: FinishOps = {
    closeRole: async () => { calls.push('closeRole'); if (knobs.closeRoleThrows) throw new Error('role socket reset'); },
    roleSessionGone: async (pid) => {
      calls.push(`gone:${pid}`);
      if (knobs.goneThrows) throw new Error('pg_stat_activity unreadable');
      return !knobs.goneFalse;
    },
    deleteOwnedMatch: async (matchId) => {
      calls.push(`deleteMatch:${matchId}`);
      if (knobs.deleteMatchThrows) throw new Error('reply lost during DELETE');
      // The predicate of the SQL: the marker is always required, the id only when known.
      for (let at = matches.length - 1; at >= 0; at -= 1) {
        if (matches[at].notes === MARKER && (matchId === null || matches[at].id === matchId)) matches.splice(at, 1);
      }
    },
    deleteOwnedSeason: async () => {
      calls.push('deleteSeason');
      if (knobs.deleteSeasonThrows) throw new Error('foreign key violation');
      if (store.season?.notes === MARKER && matches.length === 0) store.season = null;
    },
    observe: async () => {
      calls.push('observe');
      if (knobs.observeThrows) throw new Error('connection terminated');
      return {
        ownedMatches: matches.filter((row) => row.notes === MARKER).length,
        foreignMatches: matches.filter((row) => row.notes !== MARKER).length,
        ownedSeasons: store.season?.notes === MARKER ? 1 : 0,
      };
    },
    closeOwner: async () => { calls.push('closeOwner'); if (knobs.closeOwnerThrows) throw new Error('owner socket reset'); },
  };
  return { store, calls, knobs, ops };
}

const state = (patch: Partial<FixtureState> = {}): FixtureState => ({
  seasonInsert: 'created', matchInsertSent: true, matchId: 501, rolePid: 4242, ...patch,
});

const outcomeOf = (run: Promise<void>): Promise<unknown> => run.then(() => null, (error: unknown) => error);
const messageOf = (error: unknown): string => (error as Error).message;

describe('ISSUE-274 D-274-2 — the afldb_import lock test removes only what it can prove it owns', () => {
  it('success: removes its own match by id and its own season, then closes both connections', async () => {
    const w = world({ matches: [{ id: 501, notes: MARKER }], season: { notes: MARKER } });
    await finishImportRoleLockCase(state(), LABELS, w.ops, { failed: false });
    expect(w.store.matches).toEqual([]);
    expect(w.store.season).toBeNull();
    expect(w.calls).toEqual(['closeRole', 'gone:4242', 'deleteMatch:501', 'deleteSeason', 'observe', 'closeOwner']);
  });

  it('another session wins the match-key race: its row survives, and the primary failure and the preservation are both reported', async () => {
    // Our INSERT lost on the unique key: no id came back, but the INSERT was sent.
    const theirs: MatchRow = { id: 900, notes: 'created by another session' };
    const w = world({ matches: [theirs], season: { notes: MARKER } });
    const primary = new Error('duplicate key value violates unique constraint "matches_match_key_key"');
    const failure = await outcomeOf(finishImportRoleLockCase(
      state({ matchId: null }), LABELS, w.ops, { failed: true, error: primary },
    ));
    expect(w.store.matches).toEqual([theirs]); // survived, untouched
    expect(w.calls).toContain('deleteMatch:null'); // the key fallback ran...
    expect(messageOf(failure)).toContain('duplicate key value violates unique constraint'); // ...the cause is named
    expect(messageOf(failure)).toMatch(/1 matches row\(s\) on 2093\|issue122-274-importlock-1 do not carry this run's marker/);
    expect(messageOf(failure)).toMatch(/PRESERVED, not deleted/);
    expect((failure as Error & { cause?: unknown }).cause).toBe(primary);
    // The season is still ours (we created it), but a matches row now references it: it stays, reported.
    expect(w.store.season).not.toBeNull();
    expect(messageOf(failure)).toMatch(/seasons row 2093 created by this run remains/);
  });

  it('a foreign row is preserved even when this run also lost its own id', async () => {
    const theirs: MatchRow = { id: 900, notes: null }; // no notes at all: ownership cannot be confirmed
    const w = world({ matches: [theirs, { id: 501, notes: MARKER }] });
    const failure = await outcomeOf(finishImportRoleLockCase(
      state({ matchId: null, seasonInsert: 'pre-existing' }), LABELS, w.ops, { failed: false },
    ));
    expect(w.store.matches).toEqual([theirs]);
    expect(messageOf(failure)).toMatch(/PRESERVED/);
  });

  it('a lost season INSERT reply is reported as possible residue and is never removed or treated as "nothing written"', async () => {
    // The INSERT was sent; the connection died before the reply. The season may exist.
    const w = world({ season: { notes: MARKER } });
    const primary = new Error('write CONNECTION_CLOSED 127.0.0.1:55432');
    const failure = await outcomeOf(finishImportRoleLockCase(
      state({ seasonInsert: 'unconfirmed', matchInsertSent: false, matchId: null }), LABELS, w.ops,
      { failed: true, error: primary },
    ));
    expect(messageOf(failure)).toContain('write CONNECTION_CLOSED');
    expect(messageOf(failure)).toMatch(/possible season residue: the seasons INSERT for 2093 was sent but its outcome was never confirmed/);
    expect(messageOf(failure)).toMatch(/NOT removed because its ownership is not confirmed/);
    expect(messageOf(failure)).toMatch(/a seasons row carrying this run's marker EXISTS at the check/);
    expect(w.calls).not.toContain('deleteSeason');
    expect(w.calls).not.toContain('deleteMatch:null');
    expect(w.store.season).toEqual({ notes: MARKER }); // untouched
  });

  it('a lost season INSERT reply is still reported when the state cannot be checked, and without any primary failure', async () => {
    const w = world();
    w.knobs.observeThrows = true;
    const failure = await outcomeOf(finishImportRoleLockCase(
      state({ seasonInsert: 'unconfirmed', matchInsertSent: false, matchId: null }), LABELS, w.ops, { failed: false },
    ));
    expect(messageOf(failure)).toMatch(/verifying the fixture state failed: connection terminated/);
    expect(messageOf(failure)).toMatch(/possible season residue/);
    expect(messageOf(failure)).toMatch(/the state could not be checked/);
    expect(w.calls).not.toContain('deleteSeason');
  });

  it('a season that pre-existed is never removed; a season never sent leaves nothing to report', async () => {
    const pre = world({ matches: [{ id: 501, notes: MARKER }], season: { notes: 'someone else' } });
    await finishImportRoleLockCase(state({ seasonInsert: 'pre-existing' }), LABELS, pre.ops, { failed: false });
    expect(pre.calls).not.toContain('deleteSeason');
    expect(pre.store.season).toEqual({ notes: 'someone else' });

    const none = world();
    const primary = new Error('afldb_test has fewer than two clubs with legacy_club_hist.');
    const failure = await outcomeOf(finishImportRoleLockCase(
      state({ seasonInsert: 'not-sent', matchInsertSent: false, matchId: null, rolePid: null }), LABELS, none.ops,
      { failed: true, error: primary },
    ));
    expect(failure).toBe(primary); // reported as it is, not wrapped, not as a removal problem
    expect(none.calls).toEqual(['closeRole', 'closeOwner']);
  });

  it('the primary failure and a cleanup failure are both visible, with the original as the cause', async () => {
    const w = world({ matches: [{ id: 501, notes: MARKER }], season: { notes: MARKER } });
    w.knobs.deleteMatchThrows = true;
    const primary = new Error('expected 1 to be 0: a conflicting FOR UPDATE NOWAIT was refused');
    const failure = await outcomeOf(finishImportRoleLockCase(state(), LABELS, w.ops, { failed: true, error: primary }));
    expect(messageOf(failure)).toContain('a conflicting FOR UPDATE NOWAIT was refused');
    expect(messageOf(failure)).toMatch(/removing the fixture matches row failed: reply lost during DELETE/);
    expect(messageOf(failure)).toMatch(/seasons row 2093 created by this run was NOT removed because the matches removal did not complete/);
    expect(messageOf(failure)).toMatch(/fixture residue: 1 matches row\(s\) carrying this run's marker remain/);
    expect((failure as Error & { cause?: unknown }).cause).toBe(primary);
    expect(w.calls).not.toContain('deleteSeason');
  });

  it('connection-close failures are reported, alongside the primary failure and on their own', async () => {
    const both = world({ matches: [{ id: 501, notes: MARKER }], season: { notes: MARKER } });
    both.knobs.closeRoleThrows = true;
    both.knobs.closeOwnerThrows = true;
    const primary = new Error('the lock was not held');
    const failure = await outcomeOf(finishImportRoleLockCase(state(), LABELS, both.ops, { failed: true, error: primary }));
    expect(messageOf(failure)).toContain('the lock was not held');
    expect(messageOf(failure)).toMatch(/closing the afldb_import connection failed: role socket reset/);
    expect(messageOf(failure)).toMatch(/closing the owner connection failed: owner socket reset/);
    // The fixture was still removed: a failed close is reported, not a reason to leave residue.
    expect(both.store.matches).toEqual([]);

    const only = world({ matches: [{ id: 501, notes: MARKER }], season: { notes: MARKER } });
    only.knobs.closeOwnerThrows = true;
    const alone = await outcomeOf(finishImportRoleLockCase(state(), LABELS, only.ops, { failed: false }));
    expect(messageOf(alone)).toBe('closing the owner connection failed: owner socket reset');
  });

  it('an unconfirmed role session removes nothing, and says what to remove and by which marker', async () => {
    const w = world({ matches: [{ id: 501, notes: MARKER }], season: { notes: MARKER } });
    w.knobs.goneFalse = true;
    const primary = new Error('boom');
    const failure = await outcomeOf(finishImportRoleLockCase(state(), LABELS, w.ops, { failed: true, error: primary }));
    expect(w.store.matches).toHaveLength(1);
    expect(w.store.season).not.toBeNull();
    expect(w.calls).not.toContain('deleteMatch:501');
    expect(messageOf(failure)).toContain('boom');
    expect(messageOf(failure)).toMatch(/backend pid 4242, application_name 'tag-import'\) is not confirmed gone, so the fixture was NOT removed/);
    expect(messageOf(failure)).toContain(`'${MARKER}'`);

    const unreadable = world({ matches: [{ id: 501, notes: MARKER }] });
    unreadable.knobs.goneThrows = true;
    const second = await outcomeOf(finishImportRoleLockCase(state({ seasonInsert: 'pre-existing' }), LABELS, unreadable.ops, { failed: false }));
    expect(unreadable.store.matches).toHaveLength(1);
    expect(messageOf(second)).toMatch(/confirming the afldb_import session gone failed: pg_stat_activity unreadable/);
    expect(messageOf(second)).toMatch(/NOT removed/);
  });
});

describe('ISSUE-274 D-274-2 — the integration file carries the marker on every INSERT and DELETE (from source)', () => {
  const source = readFileSync('tests/integration/import-role-match-lock.test.ts', 'utf8').replace(/\r\n/g, '\n');
  const statements = (pattern: RegExp): string[] => [...source.matchAll(pattern)].map((match) => match[0]);

  it('every DELETE requires the run marker', () => {
    const deletes = statements(/DELETE FROM (?:matches|seasons)[^`]*/g);
    // matches by id, matches by key (lost reply), seasons.
    expect(deletes).toHaveLength(3);
    for (const sql of deletes) expect(sql, sql).toContain('notes = ${marker}');
    expect(source).not.toMatch(/DELETE FROM matches WHERE match_key = \$\{MATCH_KEY\}`/);
  });

  it('both fixture INSERTs write the marker, and the state flags are set BEFORE the statement is sent', () => {
    // To RETURNING, not to the closing backtick: the matches INSERT has a nested template (the date).
    const [seasonInsert] = statements(/INSERT INTO seasons[\s\S]*?RETURNING/g);
    const [matchInsert] = statements(/INSERT INTO matches[\s\S]*?RETURNING/g);
    expect(seasonInsert).toContain('notes');
    expect(seasonInsert).toContain('${marker}');
    expect(matchInsert).toContain('notes');
    expect(matchInsert).toContain('${marker}');
    expect(source.indexOf("state.seasonInsert = 'unconfirmed'")).toBeGreaterThan(-1);
    expect(source.indexOf("state.seasonInsert = 'unconfirmed'")).toBeLessThan(source.indexOf('INSERT INTO seasons'));
    expect(source.indexOf('state.matchInsertSent = true')).toBeGreaterThan(-1);
    expect(source.indexOf('state.matchInsertSent = true')).toBeLessThan(source.indexOf('INSERT INTO matches'));
  });

  it('no cleanup problem or close failure is swallowed, and the old "nothing written" shortcut is gone', () => {
    expect(source).not.toMatch(/\.end\(\{ timeout: 5 \}\)\.catch/);
    expect(source).not.toContain('insertAttempted');
    expect(source).not.toContain('createdSeason');
    expect(source).toContain('await finishImportRoleLockCase(');
    expect(source).toContain('failed ? { failed: true, error: failure } : { failed: false }');
  });

  it('the lock proof and identity assertions are in place', () => {
    expect(source).toContain("expect(ownerIdentity).toMatchObject({ database: 'afldb_test', currentUser: 'afldb_owner', sessionUser: 'afldb_owner' });");
    expect(source).toContain("database: 'afldb_test', currentUser: 'afldb_import', sessionUser: 'afldb_import', superuser: false,");
    expect(source).toContain('SELECT id::int AS id FROM matches WHERE match_key = ${MATCH_KEY} FOR NO KEY UPDATE');
    expect(source).toContain("FOR UPDATE NOWAIT`");
    expect(source).toContain(".toBe('55P03');");
    expect(source).toContain("expect(observed.ids, 'exactly the one test-owned row was locked').toEqual([fixtureId]);");
    expect(source).toContain("expect(free.map((row) => row.id), 'the lock is gone after the rollback').toEqual([fixtureId]);");
  });
});
