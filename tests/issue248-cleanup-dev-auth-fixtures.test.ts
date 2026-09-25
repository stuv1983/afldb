/**
 * AFLDB-ISSUE-248 — DB-free coverage for the audited DEV reserved-domain auth fixture cleanup
 * (`tools/maintenance/issue248-cleanup-dev-auth-fixtures.ts`).
 *
 * No database is opened. The classifier is pure; the transaction path runs through an injected
 * in-memory world whose `begin()` stages every write and publishes it only when the callback
 * resolves, which is the rollback contract `postgres.begin()` gives the real tool. The fake
 * derives the tool's state from the whole world with the same filters as the real SELECTs, so a
 * delete that touches the wrong row shows up in the readback. The module guards its own CLI
 * entrypoint, so importing it never runs against this process's argv/env.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { isTestFixtureEmail } from '../tools/db/promotion-inventory';
import {
  AUDIT_FK,
  CLEANUP_ACTION,
  FIXTURE_AUDIT_IDS,
  FIXTURE_EMAILS,
  FIXTURE_INVITE,
  FIXTURE_SESSION_IDS,
  FIXTURE_USER_IDS,
  ISSUE248_DSN_ENV,
  SESSION_FK,
  buildCleanupAuditDetail,
  classifyIssue248State,
  cleanupAuditProblems,
  parseIssue248Args,
  resolveIssue248Dsn,
  runIssue248,
  type AuditRow,
  type FixtureState,
  type ForeignKeyRef,
  type InviteRow,
  type Issue248Connection,
  type Issue248Db,
  type Issue248Privileges,
  type ReservedRow,
  type SessionRow,
  type UserRow,
} from '../tools/maintenance/issue248-cleanup-dev-auth-fixtures';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL_SOURCE = readFileSync(join(root, 'tools/maintenance/issue248-cleanup-dev-auth-fixtures.ts'), 'utf8');

const EMAIL = 'operator@afldb-owner.au';
const DEV_DSN = 'postgres://afldb_owner:SECRETPW@127.0.0.1:5432/afldb_dev';

// ---------------------------------------------------------------------------
// The whole world, and the tool's view of it
// ---------------------------------------------------------------------------

type World = {
  database: string;
  users: UserRow[];
  invites: InviteRow[];
  audits: AuditRow[];
  sessions: SessionRow[];
  /** Closure references held by FKs other than the four the world models itself. */
  otherRefs: Record<string, number>;
  /** Extra catalogue entries (e.g. a multi-column FK). */
  extraFks: ForeignKeyRef[];
  /** Reserved-domain rows in the beta tables. */
  otherReserved: ReservedRow[];
  /** When false, the catalogue lacks the closure FK (a schema the tool does not expect). */
  hasSessionFk: boolean;
};

const REAL = (id: number, email: string, role = 'super_admin'): UserRow =>
  ({ id, email, role, disabled: false, hasPassword: true, hasTotp: true });
const FIXTURE = (id: number, email: string, role: string): UserRow =>
  ({ id, email, role, disabled: true, hasPassword: true, hasTotp: true });

function liveWorld(): World {
  return {
    database: 'afldb_dev',
    users: [
      REAL(4, EMAIL),
      REAL(5, 'second@afldb-owner.au', 'admin'),
      FIXTURE(14, 'e2e-plain-admin@afldb.test', 'admin'),
      FIXTURE(17, 'e2e-super-admin@afldb.test', 'super_admin'),
      FIXTURE(18, 'testcon@test.test', 'contributor'),
    ],
    invites: [
      { id: 3, email: 'second@afldb-owner.au', role: 'admin', invitedBy: 4, usedAtUtc: '2026-08-01T00:00:00.000000Z', expired: true, revoked: false },
      { id: 5, email: 'testcon@test.test', role: 'contributor', invitedBy: 4, usedAtUtc: '2026-09-11T03:12:00.671379Z', expired: true, revoked: false },
    ],
    audits: [
      // A real super admin's lifecycle audit ABOUT a fixture account: not an FK reference, kept.
      { id: 771, actorUserId: 4, action: 'admin.lifecycle', detail: { targetUserId: 14, targetEmail: 'e2e-plain-admin@afldb.test' } },
      ...[807, 808, 811, 812, 889, 890, 912, 913].map((id, i) => ({
        id, actorUserId: 18, action: i % 2 === 0 ? 'admin.login' : 'admin.logout', detail: null,
      })),
      { id: 983, actorUserId: 4, action: 'data_override.retired', detail: { issue: 'AFLDB-ISSUE-246' } },
    ],
    sessions: [
      ...[13, 15, 29, 35].map((id) => ({ id, userId: 18, revoked: true })),
      { id: 40, userId: 4, revoked: false },
    ],
    otherRefs: {
      'public.beta_access_codes.created_by': 0,
      'public.data_edits.admin_user_id': 0,
      'public.data_overrides.admin_user_id': 0,
      'public.brownlow_vote_entry_state.created_by': 0,
      'public.afl_api_identity_adjudications.admin_user_id': 0,
    },
    extraFks: [],
    otherReserved: [],
    hasSessionFk: true,
  };
}

const inIds = (ids: readonly number[], v: number | null) => v !== null && ids.includes(v);

function derive(w: World, actorEmail: string): FixtureState {
  const ids = FIXTURE_USER_IDS;
  const emails = FIXTURE_EMAILS;
  const byClosureUser = (v: number | null) => inIds(ids, v);
  const foreignKeys: ForeignKeyRef[] = [
    { ref: AUDIT_FK, arity: 1, references: w.audits.filter((a) => byClosureUser(a.actorUserId)).length },
    ...(w.hasSessionFk ? [{ ref: SESSION_FK, arity: 1, references: w.sessions.filter((s) => byClosureUser(s.userId)).length }] : []),
    { ref: 'public.admin_invites.invited_by', arity: 1, references: w.invites.filter((i) => byClosureUser(i.invitedBy)).length },
    ...Object.entries(w.otherRefs).map(([ref, references]) => ({ ref, arity: 1, references })),
    ...w.extraFks,
  ];
  return structuredClone({
    database: w.database,
    users: w.users.filter((u) => ids.includes(u.id) || emails.includes(u.email.toLowerCase())),
    invites: w.invites.filter((i) => i.id === FIXTURE_INVITE.id || emails.includes(i.email.toLowerCase())),
    fixtureAudits: w.audits.filter((a) => FIXTURE_AUDIT_IDS.includes(a.id) || byClosureUser(a.actorUserId)),
    sessions: w.sessions.filter((s) => (FIXTURE_SESSION_IDS as readonly number[]).includes(s.id) || byClosureUser(s.userId)),
    foreignKeys,
    reservedRows: [
      ...w.users.filter((u) => isTestFixtureEmail(u.email)).map((u) => ({ table: 'auth_users', id: u.id, email: u.email })),
      ...w.invites.filter((i) => isTestFixtureEmail(i.email)).map((i) => ({ table: 'admin_invites', id: i.id, email: i.email })),
      ...w.otherReserved,
    ],
    cleanupAudits: w.audits.filter((a) => a.action === CLEANUP_ACTION),
    actors: w.users.filter((u) => u.email.toLowerCase() === actorEmail),
    totals: {
      authUsers: w.users.length, adminInvites: w.invites.length,
      authAuditLog: w.audits.length, authSessions: w.sessions.length,
    },
  });
}

function edited(edit: (w: World) => void): World {
  const w = liveWorld();
  edit(w);
  return w;
}

function classify(w: World, email = EMAIL) {
  return classifyIssue248State(derive(w, email), email);
}

function stopProblems(w: World, email = EMAIL): string {
  const c = classify(w, email);
  expect(c.kind).toBe('STOP');
  return c.kind === 'STOP' ? c.problems.join('\n') : '';
}

const CENSUS = {
  [AUDIT_FK]: 8, [SESSION_FK]: 4, 'public.admin_invites.invited_by': 0,
  'public.beta_access_codes.created_by': 0, 'public.data_edits.admin_user_id': 0,
  'public.data_overrides.admin_user_id': 0, 'public.brownlow_vote_entry_state.created_by': 0,
  'public.afl_api_identity_adjudications.admin_user_id': 0,
};

/** A coherent completed cleanup, exactly what the tool itself leaves behind. */
function cleanWorld(edit: (w: World) => void = () => {}): World {
  const w = liveWorld();
  w.users = w.users.filter((u) => !FIXTURE_USER_IDS.includes(u.id));
  w.invites = w.invites.filter((i) => i.id !== FIXTURE_INVITE.id);
  w.audits = w.audits.filter((a) => !FIXTURE_AUDIT_IDS.includes(a.id));
  w.sessions = w.sessions.filter((s) => s.userId !== 18);
  w.audits.push({ id: 990, actorUserId: 4, action: CLEANUP_ACTION, detail: structuredClone(buildCleanupAuditDetail(CENSUS)) });
  edit(w);
  return w;
}

// ---------------------------------------------------------------------------
// In-memory transactional store
// ---------------------------------------------------------------------------

type Step = 'sessions' | 'audits' | 'invite' | 'users';

type Faults = {
  failInsert?: boolean;
  failDelete?: Step;
  /** Report this count from a step (the real delete still happens). */
  reportCount?: Partial<Record<Step, number>>;
  /** The users step removes nothing but reports 3. */
  silentlyKeepUsers?: boolean;
  /** The sessions step also removes a real session. */
  overreachSessions?: boolean;
  privileges?: Partial<Issue248Privileges>;
};

type Store = { world: World; nextAuditId: number; log: string[] };
type FakeTx = { staged: World; mode: 'read only' | 'read write'; store: Store };

function fakeDb(tx: FakeTx, faults: Faults): Issue248Db {
  const w = () => tx.staged;
  const writable = (what: string) => {
    if (tx.mode === 'read only') throw new Error(`cannot execute ${what} in a read-only transaction`);
  };
  const step = (name: Step, removed: number) => {
    if (faults.failDelete === name) throw new Error(`simulated DELETE failure on ${name}`);
    return faults.reportCount?.[name] ?? removed;
  };
  const remove = <T>(rows: T[], pred: (r: T) => boolean): [T[], number] => {
    const kept = rows.filter((r) => !pred(r));
    return [kept, rows.length - kept.length];
  };
  return {
    async readState(email, lock) {
      tx.store.log.push(lock ? 'readState:lock' : 'readState');
      if (lock) writable('SELECT FOR UPDATE');
      return derive(w(), email);
    },
    async readPrivileges() {
      tx.store.log.push('readPrivileges');
      return { insertAudit: true, deleteAudit: true, deleteSessions: true, deleteInvites: true, deleteUsers: true, ...faults.privileges };
    },
    async insertCleanupAudit(actorId, detail) {
      tx.store.log.push('insertCleanupAudit');
      writable('INSERT');
      if (faults.failInsert) throw new Error('simulated auth_audit_log INSERT failure');
      const id = tx.store.nextAuditId;
      tx.store.nextAuditId += 1;
      w().audits.push({ id, actorUserId: actorId, action: CLEANUP_ACTION, detail: structuredClone(detail) });
      return id;
    },
    async deleteSessions() {
      tx.store.log.push('deleteSessions');
      writable('DELETE');
      const [kept, n] = remove(w().sessions, (s) =>
        ((FIXTURE_SESSION_IDS as readonly number[]).includes(s.id) && s.userId === 18 && s.revoked)
        || (!!faults.overreachSessions && s.userId === 4));
      w().sessions = kept;
      return step('sessions', faults.overreachSessions ? n - 1 : n);
    },
    async deleteFixtureAudits() {
      tx.store.log.push('deleteFixtureAudits');
      writable('DELETE');
      const [kept, n] = remove(w().audits, (a) => FIXTURE_AUDIT_IDS.includes(a.id) && a.actorUserId === 18
        && (a.action === 'admin.login' || a.action === 'admin.logout') && a.detail === null);
      w().audits = kept;
      return step('audits', n);
    },
    async deleteInvite() {
      tx.store.log.push('deleteInvite');
      writable('DELETE');
      const [kept, n] = remove(w().invites, (i) => i.id === 5 && i.email === 'testcon@test.test'
        && i.role === 'contributor' && i.invitedBy === 4 && i.usedAtUtc !== null && !i.revoked);
      w().invites = kept;
      return step('invite', n);
    },
    async deleteUsers() {
      tx.store.log.push('deleteUsers');
      writable('DELETE');
      if (faults.silentlyKeepUsers) return step('users', 3);
      const [kept, n] = remove(w().users, (u) => FIXTURE_USER_IDS.includes(u.id) && FIXTURE_EMAILS.includes(u.email) && u.disabled);
      w().users = kept;
      return step('users', n);
    },
  };
}

function harness(initial: World, faults: Faults = {}) {
  const store: Store = { world: structuredClone(initial), nextAuditId: 990, log: [] };
  const connect = (): Issue248Connection => ({
    async begin<T>(mode: 'read only' | 'read write', fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
      store.log.push(`BEGIN ${mode}`);
      const tx: FakeTx = { staged: structuredClone(store.world), mode, store };
      try {
        const result = await fn(tx as unknown as TransactionSql);
        store.world = tx.staged;
        store.log.push('COMMIT');
        return result;
      } catch (error) {
        store.log.push('ROLLBACK');
        throw error;
      }
    },
    async end() {},
  });
  const run = (argv: readonly string[]) => runIssue248({
    argv,
    env: { [ISSUE248_DSN_ENV]: DEV_DSN },
    connect,
    makeDb: (tx) => fakeDb(tx as unknown as FakeTx, faults),
  });
  return { store, run };
}

const PLAN = ['--environment', 'dev', '--actor-email', EMAIL];
const APPLY = [...PLAN, '--apply'];

// ---------------------------------------------------------------------------

describe('AFLDB-ISSUE-248 arguments and target, refused before any connection', () => {
  it('accepts exactly --environment dev, --actor-email and an optional --apply', () => {
    expect(parseIssue248Args(PLAN)).toEqual({ environment: 'dev', actorEmail: EMAIL, apply: false });
    expect(parseIssue248Args(['--actor-email', ' Operator@AFLDB-Owner.AU ', '--apply', '--environment', 'dev']))
      .toEqual({ environment: 'dev', actorEmail: EMAIL, apply: true });
  });

  it.each([
    [['--actor-email', EMAIL], /--environment dev is required/],
    [['--environment', 'prod', '--actor-email', EMAIL], /no production, test or candidate path/],
    [['--environment', 'production', '--actor-email', EMAIL], /only environment is 'dev'/],
    [['--environment', 'test', '--actor-email', EMAIL], /only environment is 'dev'/],
    [['--environment', 'candidate', '--actor-email', EMAIL], /only environment is 'dev'/],
    [['--environment', 'afldb_dev', '--actor-email', EMAIL], /only environment is 'dev'/],
    [['--environment', 'dev'], /--actor-email is required/],
    [['--environment', 'dev', '--actor-email', 'not-an-email'], /not a valid email/],
    [['--environment', 'dev', '--actor-email', 'e2e-super-admin@afldb.test'], /reserved-domain fixture address/],
    [[...APPLY, '--apply'], /more than once/],
    [[...PLAN, '--environment', 'dev'], /more than once/],
    [[...PLAN, '--actor-email', EMAIL], /more than once/],
  ])('refuses %j', (argv, message) => {
    expect(() => parseIssue248Args(argv)).toThrow(message);
  });

  it.each(['--force', '--database', '--dsn', '--target', '--email', '--emails', '--user-id', '--ids',
    '--invite-id', '--session-ids', '--audit-ids', '--domain', '--pattern', '--all', '--table', '--allow-fixture-identities'])(
    'offers no generic target or bypass argument: %s is refused',
    (flag) => {
      expect(() => parseIssue248Args([...PLAN, flag, 'x'])).toThrow(/Unknown argument/);
      expect(() => parseIssue248Args([...PLAN, flag])).toThrow(/Unknown argument/);
    },
  );

  it('accepts only a DSN naming exactly afldb_dev', () => {
    expect(resolveIssue248Dsn({ [ISSUE248_DSN_ENV]: DEV_DSN })).toBe(DEV_DSN);
  });

  it.each(['afldb_test', 'code_test_db', 'afldb_prod', 'afldb_dev_candidate_20260926-010000',
    'afldb_prod_candidate_20260926-010000', 'afldb_dev_pre_rebuild_20260906-112500', 'postgres', 'AFLDB_DEV', 'afldb_dev_test'])(
    'refuses a DSN naming %s without printing the DSN',
    (db) => {
      let message = '';
      try {
        resolveIssue248Dsn({ [ISSUE248_DSN_ENV]: `postgres://afldb_owner:SECRETPW@127.0.0.1:5432/${db}` });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/the only AFLDB-ISSUE-248 target is 'afldb_dev'/);
      expect(message).not.toContain('SECRETPW');
      expect(message).not.toContain('postgres://');
    },
  );

  it('refuses a missing or malformed DSN', () => {
    expect(() => resolveIssue248Dsn({})).toThrow(/AFLDB_OWNER_DATABASE_URL is not set/);
    expect(() => resolveIssue248Dsn({ [ISSUE248_DSN_ENV]: 'not a url' })).toThrow(/not a valid connection URL/);
  });

  it('never connects when the target or arguments are refused', async () => {
    let connects = 0;
    const connect = (): Issue248Connection => {
      connects += 1;
      throw new Error('must not connect');
    };
    await expect(runIssue248({
      argv: APPLY, env: { [ISSUE248_DSN_ENV]: DEV_DSN.replace('/afldb_dev', '/afldb_prod') }, connect,
    })).rejects.toThrow(/afldb_prod/);
    await expect(runIssue248({
      argv: ['--environment', 'prod', '--actor-email', EMAIL, '--apply'], env: { [ISSUE248_DSN_ENV]: DEV_DSN }, connect,
    })).rejects.toThrow(/only environment is 'dev'/);
    await expect(runIssue248({ argv: [...APPLY, '--force'], env: { [ISSUE248_DSN_ENV]: DEV_DSN }, connect }))
      .rejects.toThrow(/Unknown argument/);
    expect(connects).toBe(0);
  });
});

describe('AFLDB-ISSUE-248 closure recognition (pure)', () => {
  it('recognises the exact A5 closure and plans the cleanup with a zero business census', () => {
    const c = classify(liveWorld());
    expect(c.kind).toBe('CLEANUP');
    if (c.kind !== 'CLEANUP') return;
    expect(c.plan.actorId).toBe(4);
    expect(c.plan.foreignKeyCensus).toEqual(CENSUS);
  });

  it('pins the closure to the A5 evidence', () => {
    expect(FIXTURE_USER_IDS).toEqual([14, 17, 18]);
    expect(FIXTURE_EMAILS).toEqual(['e2e-plain-admin@afldb.test', 'e2e-super-admin@afldb.test', 'testcon@test.test']);
    expect(FIXTURE_INVITE).toEqual({
      id: 5, email: 'testcon@test.test', role: 'contributor', invitedBy: 4, usedAtUtc: '2026-09-11T03:12:00.671379Z',
    });
    expect(FIXTURE_AUDIT_IDS).toEqual([807, 808, 811, 812, 889, 890, 912, 913]);
    expect(FIXTURE_SESSION_IDS).toEqual([13, 15, 29, 35]);
    // Every closure address is caught by the very predicate A5 uses.
    for (const email of FIXTURE_EMAILS) expect(isTestFixtureEmail(email)).toBe(true);
  });

  it('refuses a database other than afldb_dev even after connecting', () => {
    for (const database of ['afldb_test', 'code_test_db', 'afldb_prod', 'afldb_dev_candidate_20260926-010000']) {
      expect(stopProblems(edited((w) => { w.database = database; }))).toMatch(`current_database() is '${database}'`);
    }
  });

  describe('auth_users', () => {
    it.each([
      ['a missing account', (w: World) => { w.users = w.users.filter((u) => u.id !== 14); }, /found ids \[17, 18\]/],
      ['an extra account on a fixture email', (w: World) => {
        w.users.find((u) => u.id === 14)!.email = 'e2e-plain-admin-old@afldb.test';
        w.users.push(FIXTURE(50, 'e2e-plain-admin@afldb.test', 'admin'));
      }, /found ids \[14, 17, 18, 50\]/],
      ['a wrong email on a fixture id', (w: World) => { w.users.find((u) => u.id === 17)!.email = 'e2e-super-admin@afldb.tests'; }, /auth_users 17: email is/],
      ['a wrong role', (w: World) => { w.users.find((u) => u.id === 14)!.role = 'super_admin'; }, /auth_users 14: role is 'super_admin', not 'admin'/],
      ['an enabled account', (w: World) => { w.users.find((u) => u.id === 18)!.disabled = false; }, /auth_users 18: is ENABLED/],
      ['a missing TOTP', (w: World) => { w.users.find((u) => u.id === 17)!.hasTotp = false; }, /auth_users 17: password\/TOTP/],
      ['a missing password', (w: World) => { w.users.find((u) => u.id === 14)!.hasPassword = false; }, /auth_users 14: password\/TOTP/],
    ])('refuses %s', (_label, edit, message) => {
      expect(stopProblems(edited(edit))).toMatch(message);
    });
  });

  describe('admin_invites', () => {
    const invite = (w: World) => w.invites.find((i) => i.id === 5)!;
    it.each([
      ['a missing invite', (w: World) => { w.invites = w.invites.filter((i) => i.id !== 5); }, /admin_invites closure lookup found ids \[\]/],
      ['a wrong id', (w: World) => { invite(w).id = 6; }, /found ids \[6\], not exactly \[5\]/],
      ['a second invite for a fixture email', (w: World) => {
        w.invites.push({ ...invite(w), id: 9, email: 'e2e-super-admin@afldb.test' });
      }, /found ids \[5, 9\]/],
      ['a wrong email', (w: World) => { invite(w).email = 'TestCon@test.test'; }, /admin_invites 5: email is/],
      ['a wrong role', (w: World) => { invite(w).role = 'admin'; }, /role is 'admin', not 'contributor'/],
      ['a wrong inviter', (w: World) => { invite(w).invitedBy = 5; }, /invited_by is 5, not 4/],
      ['an unused invite', (w: World) => { invite(w).usedAtUtc = null; }, /used_at is NULL/],
      ['a used_at one microsecond off', (w: World) => { invite(w).usedAtUtc = '2026-09-11T03:12:00.671380Z'; }, /used_at is 2026-09-11T03:12:00.671380Z/],
      ['an unexpired invite', (w: World) => { invite(w).expired = false; }, /is not expired/],
      ['a revoked invite', (w: World) => { invite(w).revoked = true; }, /is revoked/],
    ])('refuses %s', (_label, edit, message) => {
      expect(stopProblems(edited(edit))).toMatch(message);
    });
  });

  describe('auth_audit_log fixture history', () => {
    const audit = (w: World, id: number) => w.audits.find((a) => a.id === id)!;
    it.each([
      ['a missing row', (w: World) => { w.audits = w.audits.filter((a) => a.id !== 913); }, /found ids \[807, 808, 811, 812, 889, 890, 912\]/],
      ['an extra row by a fixture actor', (w: World) => {
        w.audits.push({ id: 950, actorUserId: 17, action: 'admin.login', detail: null });
      }, /other audit history/],
      ['a wrong action', (w: World) => { audit(w, 808).action = 'admin.login'; }, /auth_audit_log 808: action is 'admin.login', not 'admin.logout'/],
      ['a business action', (w: World) => { audit(w, 889).action = 'data_edit.saved'; }, /auth_audit_log 889: action is 'data_edit.saved'/],
      ['a wrong actor', (w: World) => { audit(w, 807).actorUserId = 4; }, /auth_audit_log 807: actor_user_id is 4, not 18/],
      ['a NULL actor', (w: World) => { audit(w, 811).actorUserId = null; }, /auth_audit_log 811: actor_user_id is NULL/],
      ['a non-NULL detail', (w: World) => { audit(w, 912).detail = { ip: 'x' }; }, /auth_audit_log 912: detail is not NULL/],
    ])('refuses %s', (_label, edit, message) => {
      expect(stopProblems(edited(edit))).toMatch(message);
    });
  });

  describe('auth_sessions', () => {
    const session = (w: World, id: number) => w.sessions.find((s) => s.id === id)!;
    it.each([
      ['a live session', (w: World) => { session(w, 29).revoked = false; }, /auth_sessions 29: is NOT revoked/],
      ['a wrong owner', (w: World) => { session(w, 13).userId = 4; }, /auth_sessions 13: user_id is 4, not 18/],
      ['a missing session', (w: World) => { w.sessions = w.sessions.filter((s) => s.id !== 35); }, /found ids \[13, 15, 29\]/],
      ['an extra session for a fixture user', (w: World) => { w.sessions.push({ id: 60, userId: 14, revoked: true }); }, /found ids \[13, 15, 29, 35, 60\]/],
    ])('refuses %s', (_label, edit, message) => {
      expect(stopProblems(edited(edit))).toMatch(message);
    });
  });

  describe('dynamic foreign-key census', () => {
    it.each([
      ['data_edits', 'public.data_edits.admin_user_id'],
      ['data_overrides', 'public.data_overrides.admin_user_id'],
      ['brownlow workflow', 'public.brownlow_vote_entry_state.created_by'],
      ['AFL API adjudications', 'public.afl_api_identity_adjudications.admin_user_id'],
    ])('refuses a %s reference to the closure', (_label, ref) => {
      expect(stopProblems(edited((w) => { w.otherRefs[ref] = 1; })))
        .toMatch(`${ref} holds 1 reference(s) to the closure; business/provenance references must be 0`);
    });

    it('refuses a reference through a foreign key the tool has never heard of', () => {
      expect(stopProblems(edited((w) => { w.otherRefs['staging.some_future_table.reviewed_by'] = 2; })))
        .toMatch(/staging\.some_future_table\.reviewed_by holds 2 reference/);
    });

    it('refuses an invite sent BY a fixture account', () => {
      expect(stopProblems(edited((w) => { w.invites.find((i) => i.id === 3)!.invitedBy = 17; })))
        .toMatch(/public\.admin_invites\.invited_by holds 1 reference/);
    });

    it('refuses a multi-column foreign key it cannot count', () => {
      expect(stopProblems(edited((w) => { w.extraFks.push({ ref: 'public.x.a', arity: 2, references: null }); })))
        .toMatch(/public\.x\.a into auth_users has 2 column\(s\)/);
    });

    it('refuses a catalogue without the closure foreign key', () => {
      expect(stopProblems(edited((w) => { w.hasSessionFk = false; })))
        .toMatch(/no foreign key public\.auth_sessions\.user_id/);
    });
  });

  describe('reserved-domain scope', () => {
    it('refuses, and never sweeps in, a reserved-domain row outside the closure', () => {
      expect(stopProblems(edited((w) => {
        w.otherReserved.push({ table: 'beta_allowed_emails', id: 2, email: 'tester@example.com' });
      }))).toMatch(/1 reserved-domain row\(s\) outside the AFLDB-ISSUE-248 closure \(beta_allowed_emails 2 tester@example.com\)/);
      expect(stopProblems(edited((w) => { w.users.push(FIXTURE(20, 'e2e-other@afldb.test', 'admin')); })))
        .toMatch(/auth_users 20 e2e-other@afldb\.test/);
      expect(stopProblems(edited((w) => {
        w.invites.push({ id: 7, email: 'nobody@example.invalid', role: 'admin', invitedBy: 4, usedAtUtc: null, expired: true, revoked: false });
      }))).toMatch(/admin_invites 7 nobody@example\.invalid/);
    });

    it('does not treat a real admin audit that merely mentions a fixture as a reference', () => {
      expect(classify(liveWorld()).kind).toBe('CLEANUP');
    });
  });

  describe('actor', () => {
    it.each([
      ['no actor', (w: World) => { w.users = w.users.filter((u) => u.id !== 4); }, /matches 0 auth_users row/],
      ['an admin', (w: World) => { w.users.find((u) => u.id === 4)!.role = 'admin'; }, /role 'admin', not 'super_admin'/],
      ['a disabled super admin', (w: World) => { w.users.find((u) => u.id === 4)!.disabled = true; }, /actor auth_users 4 is disabled/],
      ['an unenrolled super admin', (w: World) => { w.users.find((u) => u.id === 4)!.hasTotp = false; }, /not fully enrolled/],
    ])('refuses %s', (_label, edit, message) => {
      expect(stopProblems(edited(edit))).toMatch(message);
    });

    it('refuses a fixture account as the actor', () => {
      const problems = stopProblems(liveWorld(), 'e2e-super-admin@afldb.test');
      expect(problems).toMatch(/actor auth_users 17 is a fixture account/);
      expect(problems).toMatch(/actor auth_users 17 has a reserved-domain email/);
    });
  });

  it('reports every problem at once, not only the first', () => {
    const problems = stopProblems(edited((w) => {
      w.users.find((u) => u.id === 18)!.disabled = false;
      w.sessions.find((s) => s.id === 13)!.revoked = false;
      w.otherRefs['public.data_edits.admin_user_id'] = 3;
      w.users = w.users.filter((u) => u.id !== 4);
    }));
    expect(problems.split('\n').length).toBeGreaterThanOrEqual(4);
  });

  it('refuses a present closure that already has an ISSUE-248 cleanup audit', () => {
    expect(stopProblems(edited((w) => {
      w.audits.push({ id: 990, actorUserId: 4, action: CLEANUP_ACTION, detail: buildCleanupAuditDetail(CENSUS) });
    }))).toMatch(/already exist \(990\); inconsistent state/);
  });

  it('ignores a cleanup audit belonging to another issue', () => {
    expect(classify(edited((w) => {
      w.audits.push({ id: 991, actorUserId: 4, action: CLEANUP_ACTION, detail: { issue: 'AFLDB-ISSUE-999' } });
    })).kind).toBe('CLEANUP');
  });
});

describe('AFLDB-ISSUE-248 completed, partial and incoherent states (pure)', () => {
  it('recognises its own coherent completed cleanup as ALREADY_CLEAN', () => {
    expect(classify(cleanWorld())).toEqual({ kind: 'ALREADY_CLEAN', auditId: 990 });
  });

  it('needs no usable actor to verify a completed cleanup', () => {
    expect(classify(cleanWorld((w) => { w.users = w.users.filter((u) => u.id !== 4); })).kind).toBe('ALREADY_CLEAN');
  });

  it('refuses an absent closure without the durable audit', () => {
    expect(stopProblems(cleanWorld((w) => { w.audits = w.audits.filter((a) => a.action !== CLEANUP_ACTION); })))
      .toMatch(/closure is absent but no test_fixture\.cleanup audit names AFLDB-ISSUE-248/);
  });

  it.each([
    ['one account left, with the audit', (w: World) => { w.users.push(FIXTURE(14, 'e2e-plain-admin@afldb.test', 'admin')); }],
    ['the invite left, with the audit', (w: World) => {
      w.invites.push({ id: 5, email: 'testcon@test.test', role: 'contributor', invitedBy: 4, usedAtUtc: FIXTURE_INVITE.usedAtUtc, expired: true, revoked: false });
    }],
    ['one fixture audit row left', (w: World) => { w.audits.push({ id: 913, actorUserId: null, action: 'admin.logout', detail: null }); }],
    ['one session left', (w: World) => { w.sessions.push({ id: 35, userId: 4, revoked: true }); }],
  ])('refuses a partially missing closure: %s', (_label, edit) => {
    expect(classify(cleanWorld(edit)).kind).toBe('STOP');
  });

  it('refuses a partially missing closure without an audit rather than guessing', () => {
    const w = liveWorld();
    w.users = w.users.filter((u) => u.id !== 17);
    w.sessions = w.sessions.filter((s) => s.userId !== 18);
    const problems = stopProblems(w);
    expect(problems).toMatch(/auth_users closure lookup found ids \[14, 18\]/);
    expect(problems).toMatch(/auth_sessions closure lookup found ids \[\]/);
  });

  it('refuses duplicate cleanup audits', () => {
    expect(stopProblems(cleanWorld((w) => {
      w.audits.push({ ...w.audits.find((a) => a.id === 990)!, id: 991 });
    }))).toMatch(/2 AFLDB-ISSUE-248 test_fixture\.cleanup audits \(990, 991\)/);
  });

  it('refuses a reserved-domain row that appeared after the cleanup', () => {
    expect(stopProblems(cleanWorld((w) => { w.users.push(FIXTURE(60, 'fresh@example.org', 'admin')); })))
      .toMatch(/outside the AFLDB-ISSUE-248 closure \(auth_users 60 fresh@example\.org\)/);
  });

  const mutateAudit = (fn: (a: AuditRow) => void) => cleanWorld((w) => fn(w.audits.find((a) => a.id === 990)!));
  const detailOf = (a: AuditRow) => a.detail as Record<string, unknown>;
  it.each([
    ['an unreadable (double-encoded) detail', (a: AuditRow) => { a.detail = JSON.stringify(a.detail); }, /detail is not a JSON object/],
    ['a wrong session list', (a: AuditRow) => { detailOf(a).deleted_session_ids = [13, 15, 29]; }, /deleted_session_ids is not/],
    ['a wrong audit list', (a: AuditRow) => { detailOf(a).deleted_audit_ids = [807]; }, /deleted_audit_ids is not/],
    ['a wrong user list', (a: AuditRow) => { detailOf(a).deleted_users = [{ id: 14, email: 'e2e-plain-admin@afldb.test' }]; }, /deleted_users is not exactly/],
    ['a wrong invite', (a: AuditRow) => { detailOf(a).deleted_invite = { id: 6 }; }, /deleted_invite is not 5/],
    ['a non-zero business reference', (a: AuditRow) => {
      detailOf(a).foreign_key_census = { ...CENSUS, 'public.data_edits.admin_user_id': 1 };
    }, /foreign_key_census does not prove zero/],
    ['no business proof', (a: AuditRow) => { delete detailOf(a).business_provenance_references; }, /business_provenance_references is not 0/],
    ['a missing blocked issue', (a: AuditRow) => { detailOf(a).blocked_issue = 'AFLDB-ISSUE-236'; }, /blocked_issue is not AFLDB-ISSUE-237/],
    ['a NULL actor', (a: AuditRow) => { a.actorUserId = null; }, /no actor_user_id/],
    // A fixture-attributed audit is itself fixture history, so the closure reads as partly present.
    ['a fixture actor', (a: AuditRow) => { a.actorUserId = 17; }, /auth_audit_log closure lookup found ids \[990\]/],
    ['an id older than the history it records', (a: AuditRow) => { a.id = 900; }, /older than the fixture audit rows/],
  ])('refuses an incoherent cleanup audit: %s', (_label, fn, message) => {
    expect(stopProblems(mutateAudit(fn))).toMatch(message);
  });

  it('the audit check itself refuses a fixture actor', () => {
    const audit: AuditRow = { id: 990, actorUserId: 17, action: CLEANUP_ACTION, detail: buildCleanupAuditDetail(CENSUS) };
    expect(cleanupAuditProblems(audit)).toEqual(['auth_audit_log 990: attributed to fixture account 17']);
    expect(cleanupAuditProblems({ ...audit, actorUserId: 4 })).toEqual([]);
  });
});

describe('AFLDB-ISSUE-248 audit record', () => {
  it('records the issue, the blocked step, every deleted id and the zero business census', () => {
    const detail = buildCleanupAuditDetail(CENSUS);
    expect(detail).toMatchObject({
      issue: 'AFLDB-ISSUE-248',
      blocked_issue: 'AFLDB-ISSUE-237',
      database: 'afldb_dev',
      deleted_users: [
        { id: 14, email: 'e2e-plain-admin@afldb.test', role: 'admin' },
        { id: 17, email: 'e2e-super-admin@afldb.test', role: 'super_admin' },
        { id: 18, email: 'testcon@test.test', role: 'contributor' },
      ],
      deleted_invite: { id: 5, email: 'testcon@test.test', role: 'contributor', invited_by: 4, used_at: '2026-09-11T03:12:00.671379Z' },
      deleted_audit_ids: [807, 808, 811, 812, 889, 890, 912, 913],
      deleted_session_ids: [13, 15, 29, 35],
      foreign_key_census: CENSUS,
      business_provenance_references: 0,
    });
    expect(String(detail.reason)).toMatch(/reserved-domain fixture identities block promotion A5/);
    expect(String(detail.blocked_step)).toMatch(/A5/);
  });
});

describe('AFLDB-ISSUE-248 transaction, rollback and idempotence (in-memory store)', () => {
  it('validates only by default: READ ONLY, WOULD_CLEAN, nothing written', async () => {
    const h = harness(liveWorld());
    const report = await h.run(PLAN);
    expect(report).toMatch(/verdict\s+: WOULD_CLEAN/);
    expect(report).toMatch(/READ ONLY/);
    expect(report).toMatch(/public\.data_edits\.admin_user_id = 0/);
    expect(h.store.log).toEqual(['BEGIN read only', 'readState', 'COMMIT']);
    expect(h.store.world).toEqual(liveWorld());
  });

  it('--apply writes the operator audit first, deletes children before accounts, and changes nothing else', async () => {
    const h = harness(liveWorld());
    const report = await h.run(APPLY);
    expect(report).toMatch(/verdict\s+: CLEANED/);
    expect(report).toMatch(/cleanup audit\s+: auth_audit_log 990/);
    expect(report).toMatch(/writes\s+: 17/);
    expect(report).not.toContain('SECRETPW');
    expect(h.store.log).toEqual([
      'BEGIN read write', 'readState:lock', 'readPrivileges', 'insertCleanupAudit',
      'deleteSessions', 'deleteFixtureAudits', 'deleteInvite', 'deleteUsers', 'readState', 'COMMIT',
    ]);
    const w = h.store.world;
    expect(w.users.map((u) => u.id)).toEqual([4, 5]);
    expect(w.invites.map((i) => i.id)).toEqual([3]);
    expect(w.sessions.map((s) => s.id)).toEqual([40]);
    expect(w.audits.map((a) => a.id)).toEqual([771, 983, 990]);
    const [cleanup] = w.audits.filter((a) => a.action === CLEANUP_ACTION);
    expect(cleanup).toMatchObject({ id: 990, actorUserId: 4 });
    expect(cleanup.detail).toEqual(buildCleanupAuditDetail(CENSUS));
    // Everything that is not the closure is byte-identical.
    const before = liveWorld();
    expect(w.audits.find((a) => a.id === 771)).toEqual(before.audits.find((a) => a.id === 771));
    expect(w.users.filter((u) => u.id < 10)).toEqual(before.users.filter((u) => u.id < 10));
  });

  it('second and third runs are a verified ALREADY_CLEAN no-op with no duplicate audit', async () => {
    const h = harness(liveWorld());
    await h.run(APPLY);
    const afterFirst = structuredClone(h.store.world);
    for (const argv of [APPLY, PLAN, APPLY]) {
      const report = await h.run(argv);
      expect(report).toMatch(/verdict\s+: ALREADY_CLEAN/);
      expect(report).toMatch(/cleanup audit\s+: auth_audit_log 990/);
      expect(report).toMatch(/writes\s+: 0/);
    }
    expect(h.store.world).toEqual(afterFirst);
    expect(h.store.log.filter((l) => l === 'insertCleanupAudit')).toHaveLength(1);
    expect(h.store.log.filter((l) => l.startsWith('delete'))).toHaveLength(4);
  });

  it('an audit INSERT failure writes nothing and deletes nothing', async () => {
    const h = harness(liveWorld(), { failInsert: true });
    await expect(h.run(APPLY)).rejects.toThrow(/simulated auth_audit_log INSERT failure/);
    expect(h.store.log.at(-1)).toBe('ROLLBACK');
    expect(h.store.log.filter((l) => l.startsWith('delete'))).toEqual([]);
    expect(h.store.world).toEqual(liveWorld());
  });

  it.each([
    ['sessions', 3, 'auth_sessions', 'deleteFixtureAudits'],
    ['audits', 7, 'auth_audit_log', 'deleteInvite'],
    ['invite', 0, 'admin_invites', 'deleteUsers'],
    ['users', 2, 'auth_users', 'readState'],
  ] as const)('a %s delete-count mismatch rolls back everything, including the operator audit', async (step, n, table, never) => {
    const h = harness(liveWorld(), { reportCount: { [step]: n } });
    await expect(h.run(APPLY)).rejects.toThrow(
      new RegExp(`DELETE on ${table} removed ${n} row\\(s\\).*Rolled back, including the operator audit`));
    expect(h.store.log).not.toContain(never);
    expect(h.store.log.at(-1)).toBe('ROLLBACK');
    expect(h.store.world).toEqual(liveWorld());
  });

  it('a failing DELETE rolls back the operator audit', async () => {
    const h = harness(liveWorld(), { failDelete: 'audits' });
    await expect(h.run(APPLY)).rejects.toThrow(/simulated DELETE failure on audits/);
    expect(h.store.world).toEqual(liveWorld());
  });

  it('a post-write readback that is not the clean state rolls everything back', async () => {
    const h = harness(liveWorld(), { silentlyKeepUsers: true });
    await expect(h.run(APPLY)).rejects.toThrow(/Post-write readback is not the clean state bound to audit 990.*Rolled back/s);
    expect(h.store.world).toEqual(liveWorld());
  });

  it('a delete that reaches beyond the closure is caught by the totals and rolled back', async () => {
    const h = harness(liveWorld(), { overreachSessions: true });
    await expect(h.run(APPLY)).rejects.toThrow(/authSessions total is 0, expected 1/);
    expect(h.store.world).toEqual(liveWorld());
  });

  it.each(['insertAudit', 'deleteAudit', 'deleteSessions', 'deleteInvites', 'deleteUsers'] as const)(
    'refuses to write without the %s privilege',
    async (missing) => {
      const h = harness(liveWorld(), { privileges: { [missing]: false } });
      await expect(h.run(APPLY)).rejects.toThrow(/The connected role lacks .*Nothing was written/);
      expect(h.store.log).not.toContain('insertCleanupAudit');
      expect(h.store.world).toEqual(liveWorld());
    },
  );

  it('a STOP under --apply writes nothing', async () => {
    const h = harness(edited((w) => { w.otherRefs['public.data_edits.admin_user_id'] = 1; }));
    await expect(h.run(APPLY)).rejects.toThrow(/STOP before mutation/);
    expect(h.store.log).toEqual(['BEGIN read write', 'readState:lock', 'ROLLBACK']);
  });

  it('a partial closure under --apply is refused, not completed', async () => {
    const partial = edited((w) => { w.sessions = w.sessions.filter((s) => s.id !== 13); });
    const h = harness(partial);
    await expect(h.run(APPLY)).rejects.toThrow(/STOP before mutation/);
    expect(h.store.world).toEqual(partial);
  });
});

describe('AFLDB-ISSUE-248 source contract', () => {
  const statements = (re: RegExp) => [...TOOL_SOURCE.matchAll(re)];

  it('deletes from exactly the four closure tables, once each, by exact fixed id', () => {
    const deletes = statements(/DELETE\s+FROM\s+(\w+)\s+WHERE\s+([\s\S]*?)RETURNING/g);
    expect(deletes.map((m) => m[1])).toEqual(['auth_sessions', 'auth_audit_log', 'admin_invites', 'auth_users']);
    const leadingPredicates = deletes.map((m) => m[2].trim().split('\n')[0].trim());
    expect(leadingPredicates).toEqual([
      'id = ANY(${SESSION_IDS})',
      'id = ANY(${AUDIT_IDS})',
      'id = ${FIXTURE_INVITE.id}',
      'id = ANY(${USER_IDS})',
    ]);
    for (const [, , where] of deletes) {
      expect(where).not.toMatch(/TEST_FIXTURE_EMAIL_SQL|LIKE|~|actorEmail|args\./);
    }
  });

  it('inserts only the one auth_audit_log row, updates nothing, truncates nothing', () => {
    expect(statements(/INSERT\s+INTO\s+(\w+)/g).map((m) => m[1])).toEqual(['auth_audit_log']);
    expect(TOOL_SOURCE).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    expect(TOOL_SOURCE).not.toMatch(/\bTRUNCATE\b/i);
  });

  it('has no force flag, no generic target argument and no production/test/candidate target', () => {
    expect(TOOL_SOURCE).not.toMatch(/--force/);
    expect(TOOL_SOURCE).not.toMatch(/AFLDB_PROD|'afldb_prod'|AFLDB_TEST_DATABASE_URL|'afldb_test'/);
    expect(TOOL_SOURCE).toMatch(/ISSUE248_TARGET_DATABASE = 'afldb_dev'/);
    expect(TOOL_SOURCE).toMatch(/ISSUE248_ENVIRONMENT = 'dev'/);
    const flags = new Set(statements(/'(--[a-z-]+)'/g).map((m) => m[1]));
    expect([...flags].sort()).toEqual(['--actor-email', '--apply', '--environment']);
  });

  it('does not reuse the afldb_test-only ISSUE-155 cleanup', () => {
    expect(TOOL_SOURCE).not.toMatch(/from '\.\.\/admin\//);
    expect(TOOL_SOURCE).not.toMatch(/issue155-acceptance-fixtures/);
  });

  it('binds jsonb with sql.json, never a pre-stringified value (migration 082)', () => {
    const insert = /INSERT INTO auth_audit_log[\s\S]*?RETURNING/.exec(TOOL_SOURCE)?.[0] ?? '';
    expect(insert).toMatch(/tx\.json\(detail as postgres\.JSONValue\)/);
    expect(insert).not.toMatch(/JSON\.stringify/);
  });

  it('reads the foreign keys from the catalogue, not from a hand-kept list', () => {
    expect(TOOL_SOURCE).toMatch(/c\.contype = 'f' AND c\.confrelid = 'public\.auth_users'::regclass/);
  });

  it('is wired as npm run db:issue248:cleanup-dev-auth-fixtures', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['db:issue248:cleanup-dev-auth-fixtures']).toBe('tsx tools/maintenance/issue248-cleanup-dev-auth-fixtures.ts');
  });
});
