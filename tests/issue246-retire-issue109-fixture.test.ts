/**
 * AFLDB-ISSUE-246 — DB-free coverage for the audited retirement of the orphaned ISSUE-109 DEV
 * fixture override (`tools/maintenance/issue246-retire-issue109-fixture.ts`).
 *
 * No database is opened. The classifier is pure; the transaction path runs through an injected
 * in-memory store whose `begin()` stages every write and publishes it only when the callback
 * resolves, which is the rollback contract `postgres.begin()` gives the real tool. The module
 * guards its own CLI entrypoint, so importing it never runs against this process's argv/env.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  ISSUE109_BASELINE_NOTES,
  ISSUE109_FIXTURE,
  ISSUE246_DSN_ENV,
  PROMOTION_MARKER_ACTION,
  RETIREMENT_ACTION,
  buildRetirementAuditDetail,
  classifyIssue246State,
  parseIssue246Args,
  resolveIssue246Dsn,
  runIssue246,
  type ActorRow,
  type AuditRow,
  type FixtureState,
  type Issue246Connection,
  type Issue246Db,
  type OverrideRow,
} from '../tools/maintenance/issue246-retire-issue109-fixture';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL_SOURCE = readFileSync(join(root, 'tools/maintenance/issue246-retire-issue109-fixture.ts'), 'utf8');

const KEY = '2026|R30|2026-12-31|104|103';
const EMAIL = 'operator@example.test';
const T_CREATED = new Date('2026-08-30T03:10:00.000Z');
const T_UPDATED = new Date('2026-08-30T03:25:00.000Z');
const T_MARKER = new Date('2026-09-06T05:00:00.000Z');
const DEV_DSN = 'postgres://afldb_owner:SECRETPW@127.0.0.1:5432/afldb_dev';

const HISTORICAL_ONLY = [
  'player_link_resolutions (AFLDB-ISSUE-139 D1 (2026-09-06), docs/production-promotion.md §7.4c option 2)',
  'data_edits (AFLDB-ISSUE-139 D2 (2026-09-06), docs/production-promotion.md §7.4c option 2)',
];

function fixtureOverride(over: Partial<OverrideRow> = {}): OverrideRow {
  return {
    id: 1,
    entityType: 'matches',
    entityKey: KEY,
    fieldGroup: 'notes',
    overrideValues: { notes: ISSUE109_BASELINE_NOTES },
    isActive: true,
    adminUserId: 4,
    createdAt: T_CREATED,
    updatedAt: T_UPDATED,
    ...over,
  };
}

function marker(over: Partial<AuditRow> = {}, detail: Record<string, unknown> = {}): AuditRow {
  return {
    id: 626,
    at: T_MARKER,
    actorUserId: null,
    action: PROMOTION_MARKER_ACTION,
    detail: {
      issue: 'AFLDB-ISSUE-125',
      environment: 'dev',
      replaced: 'afldb_dev',
      candidate: 'afldb_dev_candidate_20260906-112500',
      historical_only: HISTORICAL_ONLY,
      ...detail,
    },
    ...over,
  };
}

const ACTOR: ActorRow = { id: 4, role: 'super_admin', enabled: true, hasPassword: true, hasTotp: true };

function liveState(over: Partial<FixtureState> = {}): FixtureState {
  return {
    database: 'afldb_dev',
    overrides: [fixtureOverride()],
    canonicalMatches: 0,
    dataEditClaims: [],
    promotionMarkers: [marker()],
    retirementAudits: [],
    actors: [ACTOR],
    ...over,
  };
}

/** A coherent already-retired state, exactly what the tool itself leaves behind. */
function retiredState(over: Partial<FixtureState> = {}): FixtureState {
  const retiredAt = new Date('2026-09-26T01:00:00.000Z');
  const audit: AuditRow = {
    id: 900,
    at: retiredAt,
    actorUserId: 4,
    action: RETIREMENT_ACTION,
    detail: JSON.parse(JSON.stringify(buildRetirementAuditDetail(fixtureOverride(), [626]))),
  };
  return liveState({
    overrides: [fixtureOverride({ isActive: false, updatedAt: retiredAt })],
    retirementAudits: [audit],
    ...over,
  });
}

function stopProblems(state: FixtureState): string[] {
  const c = classifyIssue246State(state, EMAIL);
  expect(c.kind).toBe('STOP');
  return c.kind === 'STOP' ? c.problems : [];
}

// ---------------------------------------------------------------------------
// In-memory transactional store
// ---------------------------------------------------------------------------

type Store = { state: FixtureState; nextAuditId: number; log: string[] };

type Faults = {
  failInsert?: boolean;
  updateChanges?: number;
  failUpdate?: boolean;
  insertWrongInstant?: boolean;
  privileges?: { canUpdateOverride: boolean; canInsertAudit: boolean };
};

type FakeTx = { staged: FixtureState; mode: 'read only' | 'read write'; now: Date; store: Store };

function clone(state: FixtureState): FixtureState {
  return structuredClone(state);
}

function fakeDb(tx: FakeTx, faults: Faults): Issue246Db {
  const writable = (what: string) => {
    if (tx.mode === 'read only') throw new Error(`cannot execute ${what} in a read-only transaction`);
  };
  return {
    async readState(_email, lock) {
      tx.store.log.push(lock ? 'readState:lock' : 'readState');
      return clone(tx.staged);
    },
    async readPrivileges() {
      tx.store.log.push('readPrivileges');
      return faults.privileges ?? { canUpdateOverride: true, canInsertAudit: true };
    },
    async retireOverride(overrideId) {
      tx.store.log.push('retireOverride');
      writable('UPDATE');
      if (faults.failUpdate) throw new Error('simulated UPDATE failure');
      if (faults.updateChanges !== undefined) return faults.updateChanges;
      let changed = 0;
      for (const o of tx.staged.overrides) {
        if (o.id === overrideId && o.isActive
          && JSON.stringify(o.overrideValues) === JSON.stringify({ notes: ISSUE109_BASELINE_NOTES })) {
          o.isActive = false;
          o.updatedAt = tx.now;
          changed += 1;
        }
      }
      return changed;
    },
    async insertRetirementAudit(actorId, detail) {
      tx.store.log.push('insertRetirementAudit');
      writable('INSERT');
      if (faults.failInsert) throw new Error('simulated auth_audit_log INSERT failure');
      const id = tx.store.nextAuditId;
      tx.store.nextAuditId += 1;
      tx.staged.retirementAudits.push({
        id,
        at: faults.insertWrongInstant ? new Date(tx.now.getTime() + 1) : tx.now,
        actorUserId: actorId,
        action: RETIREMENT_ACTION,
        detail: JSON.parse(JSON.stringify(detail)),
      });
      return id;
    },
  };
}

function harness(initial: FixtureState, faults: Faults = {}) {
  const store: Store = { state: clone(initial), nextAuditId: 900, log: [] };
  let connects = 0;
  let clock = Date.parse('2026-09-26T01:00:00.000Z');
  const connect = (): Issue246Connection => {
    connects += 1;
    return {
      async begin<T>(mode: 'read only' | 'read write', fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
        store.log.push(`BEGIN ${mode}`);
        clock += 60_000;
        const tx: FakeTx = { staged: clone(store.state), mode, now: new Date(clock), store };
        try {
          const result = await fn(tx as unknown as TransactionSql);
          store.state = tx.staged;
          store.log.push('COMMIT');
          return result;
        } catch (error) {
          store.log.push('ROLLBACK');
          throw error;
        }
      },
      async end() {},
    };
  };
  const run = (argv: readonly string[]) => runIssue246({
    argv,
    env: { [ISSUE246_DSN_ENV]: DEV_DSN },
    connect,
    makeDb: (tx) => fakeDb(tx as unknown as FakeTx, faults),
  });
  return { store, run, connects: () => connects };
}

const PLAN = ['--environment', 'dev', '--actor-email', EMAIL];
const APPLY = [...PLAN, '--apply'];

// ---------------------------------------------------------------------------

describe('AFLDB-ISSUE-246 arguments and target, refused before any connection', () => {
  it('accepts exactly --environment dev, --actor-email and an optional --apply', () => {
    expect(parseIssue246Args(PLAN)).toEqual({ environment: 'dev', actorEmail: EMAIL, apply: false });
    expect(parseIssue246Args(['--actor-email', ' Operator@Example.TEST ', '--apply', '--environment', 'dev']))
      .toEqual({ environment: 'dev', actorEmail: EMAIL, apply: true });
  });

  it.each([
    [['--actor-email', EMAIL], /--environment dev is required/],
    [['--environment', 'prod', '--actor-email', EMAIL], /no production path/],
    [['--environment', 'production', '--actor-email', EMAIL], /only environment is 'dev'/],
    [['--environment', 'test', '--actor-email', EMAIL], /only environment is 'dev'/],
    [['--environment', 'dev'], /--actor-email is required/],
    [['--environment', 'dev', '--actor-email', 'not-an-email'], /not a valid email/],
    [[...APPLY, '--apply'], /more than once/],
    [[...PLAN, '--environment', 'dev'], /more than once/],
  ])('refuses %j', (argv, message) => {
    expect(() => parseIssue246Args(argv)).toThrow(message);
  });

  it.each(['--force', '--database', '--entity-key', '--field-group', '--payload', '--dsn', '--target', '--override-id'])(
    'offers no generic or bypass argument: %s is refused',
    (flag) => {
      expect(() => parseIssue246Args([...PLAN, flag, 'x'])).toThrow(/Unknown argument/);
      expect(() => parseIssue246Args([...PLAN, flag])).toThrow(/Unknown argument/);
    },
  );

  it('accepts only a DSN naming exactly afldb_dev', () => {
    expect(resolveIssue246Dsn({ [ISSUE246_DSN_ENV]: DEV_DSN })).toBe(DEV_DSN);
  });

  it.each(['afldb_test', 'code_test_db', 'afldb_prod', 'afldb_dev_candidate_20260926-010000',
    'afldb_dev_pre_rebuild_20260906-112500', 'postgres', 'AFLDB_DEV', 'afldb_dev_test'])(
    'refuses a DSN naming %s without printing the DSN',
    (db) => {
      const dsn = `postgres://afldb_owner:SECRETPW@127.0.0.1:5432/${db}`;
      let message = '';
      try {
        resolveIssue246Dsn({ [ISSUE246_DSN_ENV]: dsn });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/the only AFLDB-ISSUE-246 target is 'afldb_dev'/);
      expect(message).not.toContain('SECRETPW');
      expect(message).not.toContain('postgres://');
    },
  );

  it('refuses a missing or malformed DSN', () => {
    expect(() => resolveIssue246Dsn({})).toThrow(/AFLDB_OWNER_DATABASE_URL is not set/);
    expect(() => resolveIssue246Dsn({ [ISSUE246_DSN_ENV]: 'not a url' })).toThrow(/not a valid connection URL/);
  });

  it('never connects when the target or arguments are refused', async () => {
    let connects = 0;
    const connect = (): Issue246Connection => {
      connects += 1;
      throw new Error('must not connect');
    };
    await expect(runIssue246({
      argv: APPLY, env: { [ISSUE246_DSN_ENV]: DEV_DSN.replace('/afldb_dev', '/afldb_test') }, connect,
    })).rejects.toThrow(/afldb_test/);
    await expect(runIssue246({
      argv: ['--environment', 'prod', '--actor-email', EMAIL, '--apply'], env: { [ISSUE246_DSN_ENV]: DEV_DSN }, connect,
    })).rejects.toThrow(/no production path/);
    expect(connects).toBe(0);
  });
});

describe('AFLDB-ISSUE-246 fixture recognition (pure)', () => {
  it('recognises the exact retained ISSUE-109 fixture and plans active -> inactive', () => {
    const c = classifyIssue246State(liveState(), EMAIL);
    expect(c).toMatchObject({ kind: 'RETIRE', actorId: 4, markerIds: [626] });
    expect(c.kind === 'RETIRE' && c.override.id).toBe(1);
  });

  it('pins the historical specification to the closed ISSUE-109 record', () => {
    expect(ISSUE109_FIXTURE.entityKey).toBe(KEY);
    expect(ISSUE109_BASELINE_NOTES).toBe('AFLDB-ISSUE-109 DEDICATED DEVELOPMENT VALIDATION FIXTURE — BASELINE — RETAIN');
    const record = readFileSync(join(root, 'issues/closed/AFLDB-ISSUE-109.md'), 'utf8');
    expect(record).toContain(`match key: \`${KEY}\``);
    expect(record).toContain('match ID: `17059`');
    expect(record).toContain(ISSUE109_BASELINE_NOTES);
    expect(record).toContain('all under `admin_user_id = 4`');
    expect(ISSUE109_FIXTURE.replacedLineageAuditRows).toEqual([22, 23, 24, 25]);
  });

  it('refuses a database other than afldb_dev even after connecting', () => {
    for (const database of ['afldb_test', 'code_test_db', 'afldb_prod']) {
      expect(stopProblems(liveState({ database }))[0]).toMatch(`current_database() is '${database}'`);
    }
  });

  it('refuses when no override, or more than one override, names the fixture key', () => {
    expect(stopProblems(liveState({ overrides: [] }))[0]).toMatch(/no data_overrides row names/);
    const coach = fixtureOverride({ id: 7, entityType: 'match_coaches', entityKey: `${KEY}|collingwood`, fieldGroup: 'coach' });
    expect(stopProblems(liveState({ overrides: [fixtureOverride(), coach] }))[0]).toMatch(/2 data_overrides rows/);
    const second = fixtureOverride({ id: 2, fieldGroup: 'score' });
    expect(stopProblems(liveState({ overrides: [fixtureOverride(), second] }))[0]).toMatch(/exactly one is required/);
  });

  it.each([
    ['natural key', { entityKey: '2026|R24|2026-08-20|120|117' }],
    ['entity type', { entityType: 'match_coaches', entityKey: `${KEY}|carlton` }],
    ['field group', { fieldGroup: 'score' }],
  ])('refuses a wrong %s', (_label, over) => {
    expect(stopProblems(liveState({ overrides: [fixtureOverride(over)] })).join('\n'))
      .toMatch(/not the ISSUE-109 matches\/2026\|R30/);
  });

  it.each([
    ['another note', { notes: 'something else' }],
    ['an extra key', { notes: ISSUE109_BASELINE_NOTES, attendance: 0 }],
    ['a hyphen for the em dash', { notes: ISSUE109_BASELINE_NOTES.replaceAll('—', '-') }],
    ['trailing whitespace', { notes: `${ISSUE109_BASELINE_NOTES} ` }],
    ['the temporary marker', { notes: 'AFLDB-ISSUE-109 AUTHENTICATED RUNTIME CHECK — TEMPORARY' }],
    ['a double-encoded string', JSON.stringify({ notes: ISSUE109_BASELINE_NOTES })],
    ['null', null],
  ])('refuses a wrong payload: %s', (_label, overrideValues) => {
    expect(stopProblems(liveState({ overrides: [fixtureOverride({ overrideValues })] })).join('\n'))
      .toMatch(/override_values is not exactly/);
  });

  it('refuses a different override id or author', () => {
    expect(stopProblems(liveState({ overrides: [fixtureOverride({ id: 2 })] })).join('\n')).toMatch(/id is not the recorded 1/);
    expect(stopProblems(liveState({ overrides: [fixtureOverride({ adminUserId: 5 })] })).join('\n'))
      .toMatch(/not the ISSUE-109 author 4/);
  });

  it('refuses provenance outside the ISSUE-109 2026-08-30 window, or a later change', () => {
    const early = fixtureOverride({ createdAt: new Date('2026-08-29T09:59:59.999Z') });
    expect(stopProblems(liveState({ overrides: [early] })).join('\n')).toMatch(/created_at .* outside/);
    const changed = fixtureOverride({ updatedAt: new Date('2026-09-02T00:00:00.000Z') });
    expect(stopProblems(liveState({ overrides: [changed] })).join('\n')).toMatch(/changed after ISSUE-109/);
    const inverted = fixtureOverride({ createdAt: T_UPDATED, updatedAt: T_CREATED });
    expect(stopProblems(liveState({ overrides: [inverted] })).join('\n')).toMatch(/created_at is after updated_at/);
  });

  it('refuses when the canonical fixture match is unexpectedly present', () => {
    expect(stopProblems(liveState({ canonicalMatches: 1 })).join('\n')).toMatch(/canonical match .* is PRESENT/);
  });

  it('refuses ambiguous audit evidence: current data_edits rows purporting to be the fixture chain', () => {
    const claims = [22, 23, 24, 25].map((id) => ({ id, tableName: 'matches', fieldGroup: id === 22 ? 'match_creation' : 'notes' }));
    expect(stopProblems(liveState({ dataEditClaims: claims })).join('\n'))
      .toMatch(/data_edits holds 4 row\(s\) naming ISSUE-109 or the fixture key \(22 matches\/match_creation/);
    expect(stopProblems(liveState({ dataEditClaims: [claims[0]] })).join('\n')).toMatch(/no surviving ISSUE-109 audit chain/);
  });

  it.each([
    ['no marker at all', []],
    ['a production marker', [marker({}, { environment: 'prod' })]],
    ['a marker not replacing afldb_dev', [marker({}, { replaced: 'afldb_prod' })]],
    ['a marker without data_edits historical-only', [marker({}, { historical_only: [HISTORICAL_ONLY[0]] })]],
    ['a marker with no historical_only list', [marker({}, { historical_only: undefined })]],
    ['a marker older than the fixture', [marker({ at: new Date('2026-08-30T03:24:59.000Z') })]],
    ['a double-encoded marker', [marker({ detail: JSON.stringify(marker().detail) })]],
    ['a non-marker action', [marker({ action: 'auth.login' })]],
  ])('refuses absent historical-audit evidence: %s', (_label, promotionMarkers) => {
    expect(stopProblems(liveState({ promotionMarkers })).join('\n')).toMatch(/absence is unexplained/);
  });

  it('accepts one or more markers and records every qualifying one', () => {
    const old = marker({ id: 12, at: new Date('2026-08-20T00:00:00.000Z') });
    const later = marker({ id: 1500, at: new Date('2026-09-26T00:00:00.000Z') });
    expect(classifyIssue246State(liveState({ promotionMarkers: [old, marker(), later] }), EMAIL))
      .toMatchObject({ kind: 'RETIRE', markerIds: [626, 1500] });
  });

  it.each([
    ['no actor', []],
    ['two actors', [ACTOR, { ...ACTOR, id: 9 }]],
    ['an admin', [{ ...ACTOR, role: 'admin' }]],
    ['a disabled super admin', [{ ...ACTOR, enabled: false }]],
    ['an unenrolled super admin', [{ ...ACTOR, hasTotp: false }]],
  ])('refuses an unsuitable actor: %s', (_label, actors) => {
    expect(stopProblems(liveState({ actors: actors as ActorRow[] })).join('\n')).toMatch(/actor/);
  });

  it('reports every problem at once, not only the first', () => {
    const problems = stopProblems(liveState({
      canonicalMatches: 1, promotionMarkers: [], actors: [],
      overrides: [fixtureOverride({ adminUserId: 9 })],
    }));
    expect(problems.length).toBeGreaterThanOrEqual(4);
  });
});

describe('AFLDB-ISSUE-246 already-retired and inconsistent states (pure)', () => {
  it('recognises its own coherent retirement as ALREADY_RETIRED', () => {
    expect(classifyIssue246State(retiredState(), EMAIL)).toMatchObject({ kind: 'ALREADY_RETIRED', auditId: 900, markerIds: [626] });
  });

  it('needs no usable actor to verify an already-retired state', () => {
    expect(classifyIssue246State(retiredState({ actors: [] }), EMAIL).kind).toBe('ALREADY_RETIRED');
  });

  it('refuses an inactive override with no retirement audit (deactivated outside this lifecycle)', () => {
    expect(stopProblems(liveState({ overrides: [fixtureOverride({ isActive: false })] })).join('\n'))
      .toMatch(/deactivated outside this lifecycle/);
  });

  it('refuses an active override that already has a retirement audit', () => {
    const s = retiredState();
    expect(stopProblems({ ...s, overrides: [fixtureOverride()] }).join('\n')).toMatch(/is active but 1 data_override.retired/);
  });

  it('refuses duplicate retirement audits', () => {
    const s = retiredState();
    expect(stopProblems({ ...s, retirementAudits: [...s.retirementAudits, { ...s.retirementAudits[0], id: 901 }] }).join('\n'))
      .toMatch(/2 data_override.retired audits/);
  });

  it('refuses an audit that is not bound to the same transaction as the retirement', () => {
    const s = retiredState();
    const audit = { ...s.retirementAudits[0], at: new Date('2026-09-26T01:00:01.000Z') };
    expect(stopProblems({ ...s, retirementAudits: [audit] }).join('\n')).toMatch(/not one transaction/);
  });

  it.each([
    ['an unreadable detail', (d: Record<string, unknown>) => JSON.stringify(d)],
    ['an altered preserved payload', (d: Record<string, unknown>) => ({ ...d, preserved_override_values: { notes: 'x' } })],
    ['another override id', (d: Record<string, unknown>) => ({ ...d, override_id: 2 })],
    ['a wrong previous state', (d: Record<string, unknown>) => ({ ...d, previous_state: { is_active: false } })],
  ])('refuses an incoherent retirement audit: %s', (_label, mutate) => {
    const s = retiredState();
    const audit = { ...s.retirementAudits[0], detail: mutate(s.retirementAudits[0].detail as Record<string, unknown>) };
    expect(classifyIssue246State({ ...s, retirementAudits: [audit] }, EMAIL).kind).toBe('STOP');
  });

  it('ignores a retirement audit about a different override', () => {
    const other: AuditRow = {
      id: 950, at: T_MARKER, actorUserId: 4, action: RETIREMENT_ACTION,
      detail: { issue: 'AFLDB-ISSUE-999', entity_key: '2027|R1|2027-03-20|104|103' },
    };
    expect(classifyIssue246State(liveState({ retirementAudits: [other] }), EMAIL).kind).toBe('RETIRE');
  });
});

describe('AFLDB-ISSUE-246 audit record', () => {
  it('binds the retirement to the natural key and override id, never to the old match id', () => {
    const detail = buildRetirementAuditDetail(fixtureOverride(), [626]);
    expect(detail).toMatchObject({
      issue: 'AFLDB-ISSUE-246',
      operation: 'override_retirement',
      related_issues: ['AFLDB-ISSUE-109', 'AFLDB-ISSUE-237'],
      database: 'afldb_dev',
      override_id: 1,
      entity_type: 'matches',
      entity_key: KEY,
      field_group: 'notes',
      previous_state: { is_active: true, admin_user_id: 4, created_at: T_CREATED.toISOString(), updated_at: T_UPDATED.toISOString() },
      new_state: { is_active: false },
      preserved_override_values: { notes: ISSUE109_BASELINE_NOTES },
      canonical_match_present: false,
      historical_provenance: { replaced_lineage_match_id: 17059, replaced_lineage_audit_rows: [22, 23, 24, 25], promotion_marker_ids: [626] },
    });
    expect(String(detail.reason)).toMatch(/AFLDB-ISSUE-237 L4 A4\.3 STOP \(matches=1\)/);
    expect(Object.keys(detail)).not.toContain('row_id');
    expect(Object.keys(detail)).not.toContain('match_id');
  });
});

describe('AFLDB-ISSUE-246 transaction, rollback and idempotence (in-memory store)', () => {
  it('validates only by default: READ ONLY, WOULD_RETIRE, nothing written', async () => {
    const h = harness(liveState());
    const report = await h.run(PLAN);
    expect(report).toMatch(/verdict\s+: WOULD_RETIRE/);
    expect(report).toMatch(/READ ONLY/);
    expect(h.store.log).toEqual(['BEGIN read only', 'readState', 'COMMIT']);
    expect(h.store.state).toEqual(liveState());
  });

  it('first --apply changes exactly one override and appends exactly one audit, in order, in one transaction', async () => {
    const h = harness(liveState());
    const report = await h.run(APPLY);
    expect(report).toMatch(/verdict\s+: RETIRED/);
    expect(report).toMatch(/writes\s+: 2/);
    expect(report).not.toContain('SECRETPW');
    expect(h.store.log).toEqual([
      'BEGIN read write', 'readState:lock', 'readPrivileges', 'retireOverride', 'insertRetirementAudit', 'readState', 'COMMIT',
    ]);
    const [o] = h.store.state.overrides;
    expect(o).toMatchObject({
      id: 1, isActive: false, adminUserId: 4, createdAt: T_CREATED, overrideValues: { notes: ISSUE109_BASELINE_NOTES },
    });
    expect(h.store.state.retirementAudits).toHaveLength(1);
    const [audit] = h.store.state.retirementAudits;
    expect(audit.at.getTime()).toBe(o.updatedAt.getTime());
    expect(audit).toMatchObject({ id: 900, actorUserId: 4, action: 'data_override.retired' });
    expect(h.store.state.canonicalMatches).toBe(0);
  });

  it('second and third runs are a verified ALREADY_RETIRED no-op with no duplicate audit', async () => {
    const h = harness(liveState());
    await h.run(APPLY);
    const afterFirst = clone(h.store.state);
    for (const argv of [APPLY, PLAN, APPLY]) {
      const report = await h.run(argv);
      expect(report).toMatch(/verdict\s+: ALREADY_RETIRED/);
      expect(report).toMatch(/retirement audit\s+: auth_audit_log 900/);
      expect(report).toMatch(/writes\s+: 0/);
    }
    expect(h.store.state).toEqual(afterFirst);
    expect(h.store.state.retirementAudits).toHaveLength(1);
    expect(h.store.log.filter((l) => l === 'insertRetirementAudit')).toHaveLength(1);
    expect(h.store.log.filter((l) => l === 'retireOverride')).toHaveLength(1);
  });

  it('an audit INSERT failure rolls back the is_active change', async () => {
    const h = harness(liveState(), { failInsert: true });
    await expect(h.run(APPLY)).rejects.toThrow(/simulated auth_audit_log INSERT failure/);
    expect(h.store.log.at(-1)).toBe('ROLLBACK');
    expect(h.store.state).toEqual(liveState());
  });

  it('an UPDATE that changes no row writes no audit', async () => {
    const h = harness(liveState(), { updateChanges: 0 });
    await expect(h.run(APPLY)).rejects.toThrow(/changed 0 row\(s\), not exactly 1; no audit was written/);
    expect(h.store.log).not.toContain('insertRetirementAudit');
    expect(h.store.state).toEqual(liveState());
  });

  it('an UPDATE that changes more than one row writes no audit', async () => {
    const h = harness(liveState(), { updateChanges: 2 });
    await expect(h.run(APPLY)).rejects.toThrow(/changed 2 row\(s\)/);
    expect(h.store.log).not.toContain('insertRetirementAudit');
  });

  it('a failing UPDATE writes no audit', async () => {
    const h = harness(liveState(), { failUpdate: true });
    await expect(h.run(APPLY)).rejects.toThrow(/simulated UPDATE failure/);
    expect(h.store.log).not.toContain('insertRetirementAudit');
    expect(h.store.state).toEqual(liveState());
  });

  it('a post-write readback that is not the bound retired state rolls everything back', async () => {
    const h = harness(liveState(), { insertWrongInstant: true });
    await expect(h.run(APPLY)).rejects.toThrow(/Post-write readback .* Rolled back/);
    expect(h.store.state).toEqual(liveState());
  });

  it('refuses to write without the UPDATE and INSERT privileges', async () => {
    const h = harness(liveState(), { privileges: { canUpdateOverride: false, canInsertAudit: true } });
    await expect(h.run(APPLY)).rejects.toThrow(/lacks UPDATE data_overrides/);
    expect(h.store.log).not.toContain('retireOverride');
    expect(h.store.state).toEqual(liveState());
  });

  it('a STOP under --apply writes nothing', async () => {
    const h = harness(liveState({ canonicalMatches: 1 }));
    await expect(h.run(APPLY)).rejects.toThrow(/STOP before mutation/);
    expect(h.store.log).toEqual(['BEGIN read write', 'readState:lock', 'ROLLBACK']);
  });
});

describe('AFLDB-ISSUE-246 source contract', () => {
  it('deletes nothing and never writes data_edits', () => {
    expect(TOOL_SOURCE).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(TOOL_SOURCE).not.toMatch(/\bTRUNCATE\b/i);
    expect(TOOL_SOURCE).not.toMatch(/INSERT\s+INTO\s+data_edits/i);
    expect(TOOL_SOURCE).not.toMatch(/UPDATE\s+data_edits/i);
  });

  it('has exactly one UPDATE (data_overrides: is_active, updated_at) and one INSERT (auth_audit_log)', () => {
    const updates = [...TOOL_SOURCE.matchAll(/UPDATE\s+(\w+)\s+SET\s+([\s\S]*?)\s+WHERE/g)];
    expect(updates).toHaveLength(1);
    expect(updates[0][1]).toBe('data_overrides');
    expect(updates[0][2].split(',').map((s) => s.trim().split(/\s*=/)[0])).toEqual(['is_active', 'updated_at']);
    expect(updates[0][2]).toMatch(/is_active = false,\s+updated_at = now\(\)/);
    const inserts = [...TOOL_SOURCE.matchAll(/INSERT\s+INTO\s+(\w+)/g)].map((m) => m[1]);
    expect(inserts).toEqual(['auth_audit_log']);
  });

  it('has no force flag and no production target', () => {
    expect(TOOL_SOURCE).not.toMatch(/--force/);
    expect(TOOL_SOURCE).not.toMatch(/AFLDB_PROD|'afldb_prod'/);
    expect(TOOL_SOURCE).toMatch(/ISSUE246_TARGET_DATABASE = 'afldb_dev'/);
  });

  it('binds jsonb with sql.json, never a pre-stringified value (migration 082)', () => {
    const insert = /INSERT INTO auth_audit_log[\s\S]*?RETURNING/.exec(TOOL_SOURCE)?.[0] ?? '';
    expect(insert).toMatch(/tx\.json\(detail as postgres\.JSONValue\)/);
    expect(insert).not.toMatch(/JSON\.stringify/);
    const update = /UPDATE data_overrides[\s\S]*?RETURNING/.exec(TOOL_SOURCE)?.[0] ?? '';
    expect(update).toMatch(/override_values = \$\{tx\.json\(expectedOverrideValues\(\)\)\}/);
    expect(update).not.toMatch(/JSON\.stringify/);
  });

  it('is wired as npm run db:issue246:retire-issue109-fixture', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['db:issue246:retire-issue109-fixture']).toBe('tsx tools/maintenance/issue246-retire-issue109-fixture.ts');
  });
});
