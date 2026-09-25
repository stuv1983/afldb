/**
 * AFLDB-ISSUE-248 — remove the exact reserved-domain DEV auth fixture closure that makes
 * AFLDB-ISSUE-237 L4 A5 refuse, through one audited, fail-closed transaction.
 *
 *     # validate only (READ ONLY transaction, writes nothing):
 *     npm run db:issue248:cleanup-dev-auth-fixtures -- --environment dev --actor-email <super admin>
 *     # the one mutation:
 *     npm run db:issue248:cleanup-dev-auth-fixtures -- --environment dev --actor-email <super admin> --apply
 *
 * WHY. ISSUE-237 L4 A5 (`db:promotion:check --environment dev --phase pre-cutover`, which L4 never
 * runs with `--allow-fixture-identities`) refused the test-fixture identity gate
 * (`gateFixtureIdentities`, predicate `TEST_FIXTURE_EMAIL_SQL`). The live census found three
 * disabled `auth_users` fixture accounts (14, 17, 18) and one used, expired `admin_invites` row (5)
 * under reserved domains. The only rows referencing those accounts are the fixture's own eight
 * login/logout audit rows (actor 18, NULL detail) and four already-revoked sessions (user 18). No
 * football, admin or business provenance is owned by them. This tool is bound to exactly that
 * closure. It is not a generic account purge: there is no email, id, pattern or table argument.
 *
 * WHAT IT DOES. One transaction: prove the target, the closure and a zero business/provenance FK
 * census (read from the catalogue, not a hand-kept list); append ONE `auth_audit_log` row
 * (`action = 'test_fixture.cleanup'`) attributed to a verified real, enabled, enrolled super_admin;
 * delete the four sessions, the eight fixture audit rows, invite 5 and the three accounts, each by
 * exact id with its expected state re-asserted in the WHERE clause; re-read and prove the
 * postcondition; commit. Any count or fact that differs throws, which rolls back everything,
 * including the operator audit.
 *
 * IDEMPOTENCE. A rerun that finds the closure absent and exactly one coherent ISSUE-248 cleanup
 * audit returns ALREADY_CLEAN with zero writes. A partially present closure, or an absent one
 * without that audit, is refused rather than guessed at.
 *
 * TARGET SAFETY. The only accepted environment is `dev` and the only accepted database is exactly
 * `afldb_dev`: by the DSN's own path BEFORE any connection, and by `current_database()` inside the
 * transaction. The DSN comes only from AFLDB_OWNER_DATABASE_URL and is never printed. There is no
 * production, test or candidate path and no force flag. The ISSUE-155 acceptance cleanup
 * (`tools/admin/issue155-acceptance-cleanup.ps1`, afldb_test only) is precedent, not a dependency.
 */
import postgres, { type TransactionSql } from 'postgres';

import { redact } from '../db/psql';
import { databaseOf } from '../db/rebuild-test';
import {
  EMAIL_BEARING_TABLES,
  TEST_FIXTURE_EMAIL_SQL,
  isTestFixtureEmail,
  quoteIdent,
} from '../db/promotion-inventory';

export class Issue248Refused extends Error {}

export const ISSUE248 = 'AFLDB-ISSUE-248';
export const BLOCKED_ISSUE = 'AFLDB-ISSUE-237';
export const ISSUE248_TARGET_DATABASE = 'afldb_dev';
export const ISSUE248_ENVIRONMENT = 'dev';
export const ISSUE248_DSN_ENV = 'AFLDB_OWNER_DATABASE_URL';
export const CLEANUP_ACTION = 'test_fixture.cleanup';
export const CLEANUP_OPERATION = 'reserved_domain_fixture_cleanup';
export const CLEANUP_ACTOR_LABEL = `operator: DEV reserved-domain auth fixture cleanup (${ISSUE248})`;
export const CLEANUP_REASON = 'reserved-domain fixture identities block promotion A5 '
  + '(AFLDB-ISSUE-237 L4 A5, test-fixture identity gate); the closure owns no business or '
  + 'provenance references, only its own login/logout audit rows and revoked sessions.';
const TOOL_PATH = 'tools/maintenance/issue248-cleanup-dev-auth-fixtures.ts';

/**
 * The immutable specification of the closure, from the operator's live ISSUE-237 A5 evidence
 * (2026-09-25, issues/open/AFLDB-ISSUE-248.md §2). Nothing here is read from the database.
 * Roles are the fixture accounts' purposes (plain admin, super admin, the contributor invited by
 * invite 5); the validate-only run proves them before anything can be written.
 */
export const FIXTURE_USERS = [
  { id: 14, email: 'e2e-plain-admin@afldb.test', role: 'admin' },
  { id: 17, email: 'e2e-super-admin@afldb.test', role: 'super_admin' },
  { id: 18, email: 'testcon@test.test', role: 'contributor' },
] as const;

export const FIXTURE_INVITE = {
  id: 5,
  email: 'testcon@test.test',
  role: 'contributor',
  invitedBy: 4,
  /** 2026-09-11 13:12:00.671379+10, compared at microsecond precision. */
  usedAtUtc: '2026-09-11T03:12:00.671379Z',
} as const;

/** The eight fixture audit rows: every one is actor 18 with NULL detail. */
export const FIXTURE_AUDITS = [
  { id: 807, action: 'admin.login' },
  { id: 808, action: 'admin.logout' },
  { id: 811, action: 'admin.login' },
  { id: 812, action: 'admin.logout' },
  { id: 889, action: 'admin.login' },
  { id: 890, action: 'admin.logout' },
  { id: 912, action: 'admin.login' },
  { id: 913, action: 'admin.logout' },
] as const;
export const FIXTURE_AUDIT_ACTOR = 18;

/** The four already-revoked sessions: every one is user 18. */
export const FIXTURE_SESSION_IDS = [13, 15, 29, 35] as const;
export const FIXTURE_SESSION_USER = 18;

export const FIXTURE_USER_IDS: readonly number[] = FIXTURE_USERS.map((u) => u.id);
export const FIXTURE_EMAILS: readonly string[] = [...new Set(FIXTURE_USERS.map((u) => u.email))];
export const FIXTURE_AUDIT_IDS: readonly number[] = FIXTURE_AUDITS.map((a) => a.id);

/** The only two foreign keys into auth_users the closure may hold references through. */
export const AUDIT_FK = 'public.auth_audit_log.actor_user_id';
export const SESSION_FK = 'public.auth_sessions.user_id';

export const EXPECTED_WRITES = 1 + FIXTURE_SESSION_IDS.length + FIXTURE_AUDITS.length + 1 + FIXTURE_USERS.length;

// ---------------------------------------------------------------------------
// Arguments and target (all refusals here happen before any connection)
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type Issue248Args = { environment: typeof ISSUE248_ENVIRONMENT; actorEmail: string; apply: boolean };

/** `--environment dev --actor-email <addr> [--apply]`. Nothing else is accepted. */
export function parseIssue248Args(argv: readonly string[]): Issue248Args {
  let environment: string | undefined;
  let actorEmail: string | undefined;
  let apply = false;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--apply') {
      if (apply) throw new Issue248Refused('--apply was given more than once.');
      apply = true;
      continue;
    }
    if (flag !== '--environment' && flag !== '--actor-email') {
      throw new Issue248Refused(
        `Unknown argument ${JSON.stringify(flag)}. The only arguments are --environment dev, `
        + '--actor-email <super admin> and --apply; the fixture closure is fixed in code.');
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Issue248Refused(`${flag} needs a value.`);
    if (flag === '--environment') {
      if (environment !== undefined) throw new Issue248Refused('--environment was given more than once.');
      environment = value;
    } else {
      if (actorEmail !== undefined) throw new Issue248Refused('--actor-email was given more than once.');
      actorEmail = value;
    }
    i += 1;
  }
  if (environment === undefined) throw new Issue248Refused('--environment dev is required.');
  if (environment !== ISSUE248_ENVIRONMENT) {
    throw new Issue248Refused(
      `--environment ${JSON.stringify(environment)} is refused: the only environment is 'dev'. `
      + 'This closure is a DEV-only artefact; there is no production, test or candidate path.');
  }
  if (actorEmail === undefined) throw new Issue248Refused('--actor-email is required (a real, enabled, enrolled super_admin).');
  const email = actorEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new Issue248Refused(`--actor-email ${JSON.stringify(actorEmail)} is not a valid email address.`);
  if (isTestFixtureEmail(email)) {
    throw new Issue248Refused(`--actor-email ${email} is a reserved-domain fixture address; the cleanup must be `
      + 'attributed to a real super_admin.');
  }
  return { environment: ISSUE248_ENVIRONMENT, actorEmail: email, apply };
}

export function assertIssue248Database(database: string, label: string): void {
  if (database !== ISSUE248_TARGET_DATABASE) {
    throw new Issue248Refused(
      `${label} is '${database}'; the only ${ISSUE248} target is '${ISSUE248_TARGET_DATABASE}'.`);
  }
}

/** The DSN from the environment only. Refusals name the variable and database, never the DSN. */
export function resolveIssue248Dsn(env: Record<string, string | undefined>): string {
  const dsn = env[ISSUE248_DSN_ENV]?.trim();
  if (!dsn) throw new Issue248Refused(`${ISSUE248_DSN_ENV} is not set.`);
  let named: string;
  try {
    named = databaseOf(dsn);
  } catch {
    throw new Issue248Refused(`${ISSUE248_DSN_ENV} is not a valid connection URL.`);
  }
  assertIssue248Database(named, `${ISSUE248_DSN_ENV}'s database`);
  return dsn;
}

// ---------------------------------------------------------------------------
// Live state and its pure classification
// ---------------------------------------------------------------------------

export type UserRow = { id: number; email: string; role: string; disabled: boolean; hasPassword: boolean; hasTotp: boolean };

export type InviteRow = {
  id: number;
  email: string;
  role: string;
  invitedBy: number;
  usedAtUtc: string | null;
  expired: boolean;
  revoked: boolean;
};

export type AuditRow = { id: number; actorUserId: number | null; action: string; detail: unknown };

export type SessionRow = { id: number; userId: number; revoked: boolean };

/** One foreign key into auth_users, from the catalogue, with its reference count to the closure. */
export type ForeignKeyRef = { ref: string; arity: number; references: number | null };

export type ReservedRow = { table: string; id: number; email: string };

export type TableTotals = { authUsers: number; adminInvites: number; authAuditLog: number; authSessions: number };

export type ActorRow = UserRow;

export type FixtureState = {
  database: string;
  /** auth_users rows with a closure id OR a closure email (case-insensitive). */
  users: UserRow[];
  /** admin_invites rows with the closure invite id OR a closure email. */
  invites: InviteRow[];
  /** auth_audit_log rows with a closure audit id OR a closure actor. */
  fixtureAudits: AuditRow[];
  /** auth_sessions rows with a closure session id OR a closure user. */
  sessions: SessionRow[];
  /** Every foreign key into public.auth_users, counted against the closure user ids. */
  foreignKeys: ForeignKeyRef[];
  /** Every reserved-domain row in every email-bearing table (the A5 predicate, verbatim). */
  reservedRows: ReservedRow[];
  /** Every auth_audit_log row with action `test_fixture.cleanup`. */
  cleanupAudits: AuditRow[];
  /** auth_users rows matching --actor-email case-insensitively. */
  actors: ActorRow[];
  totals: TableTotals;
};

export type CleanupPlan = { actorId: number; foreignKeyCensus: Record<string, number> };

export type Issue248Classification =
  | { kind: 'CLEANUP'; plan: CleanupPlan }
  | { kind: 'ALREADY_CLEAN'; auditId: number }
  | { kind: 'STOP'; problems: string[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameIds(actual: readonly number[], expected: readonly number[]): boolean {
  const a = [...actual].sort((x, y) => x - y);
  const e = [...expected].sort((x, y) => x - y);
  return a.length === e.length && a.every((v, i) => v === e[i]);
}

const list = (ids: readonly number[]) => ids.join(', ');

/** A cleanup audit concerns this closure if it names ISSUE-248, or if it cannot be read at all. */
export function cleanupAuditConcernsClosure(audit: AuditRow): boolean {
  return !isPlainObject(audit.detail) || audit.detail.issue === ISSUE248;
}

function userProblems(users: readonly UserRow[]): string[] {
  const problems: string[] = [];
  if (!sameIds(users.map((u) => u.id), FIXTURE_USER_IDS)) {
    problems.push(`auth_users closure lookup found ids [${list(users.map((u) => u.id))}], not exactly [${list(FIXTURE_USER_IDS)}]`);
  }
  for (const spec of FIXTURE_USERS) {
    const u = users.find((row) => row.id === spec.id);
    if (!u) continue;
    const at = `auth_users ${u.id}`;
    if (u.email !== spec.email) problems.push(`${at}: email is ${JSON.stringify(u.email)}, not ${spec.email}`);
    if (u.role !== spec.role) problems.push(`${at}: role is '${u.role}', not '${spec.role}'`);
    if (!u.disabled) problems.push(`${at}: is ENABLED; the fixture accounts must all be disabled`);
    if (!u.hasPassword || !u.hasTotp) problems.push(`${at}: password/TOTP presence differs from the A5 evidence (both present)`);
  }
  return problems;
}

function inviteProblems(invites: readonly InviteRow[]): string[] {
  if (invites.length !== 1 || invites[0].id !== FIXTURE_INVITE.id) {
    return [`admin_invites closure lookup found ids [${list(invites.map((i) => i.id))}], not exactly [${FIXTURE_INVITE.id}]`];
  }
  const i = invites[0];
  const at = `admin_invites ${i.id}`;
  const problems: string[] = [];
  if (i.email !== FIXTURE_INVITE.email) problems.push(`${at}: email is ${JSON.stringify(i.email)}, not ${FIXTURE_INVITE.email}`);
  if (i.role !== FIXTURE_INVITE.role) problems.push(`${at}: role is '${i.role}', not '${FIXTURE_INVITE.role}'`);
  if (i.invitedBy !== FIXTURE_INVITE.invitedBy) problems.push(`${at}: invited_by is ${i.invitedBy}, not ${FIXTURE_INVITE.invitedBy}`);
  if (i.usedAtUtc !== FIXTURE_INVITE.usedAtUtc) {
    problems.push(`${at}: used_at is ${i.usedAtUtc ?? 'NULL'}, not ${FIXTURE_INVITE.usedAtUtc}`);
  }
  if (!i.expired) problems.push(`${at}: is not expired`);
  if (i.revoked) problems.push(`${at}: is revoked; the A5 evidence recorded it not revoked`);
  return problems;
}

function auditProblems(audits: readonly AuditRow[]): string[] {
  const problems: string[] = [];
  if (!sameIds(audits.map((a) => a.id), FIXTURE_AUDIT_IDS)) {
    problems.push(`auth_audit_log closure lookup found ids [${list(audits.map((a) => a.id))}], `
      + `not exactly [${list(FIXTURE_AUDIT_IDS)}]; a fixture account has other audit history`);
  }
  for (const spec of FIXTURE_AUDITS) {
    const a = audits.find((row) => row.id === spec.id);
    if (!a) continue;
    const at = `auth_audit_log ${a.id}`;
    if (a.actorUserId !== FIXTURE_AUDIT_ACTOR) problems.push(`${at}: actor_user_id is ${a.actorUserId ?? 'NULL'}, not ${FIXTURE_AUDIT_ACTOR}`);
    if (a.action !== spec.action) problems.push(`${at}: action is '${a.action}', not '${spec.action}'`);
    if (a.detail !== null) problems.push(`${at}: detail is not NULL`);
  }
  return problems;
}

function sessionProblems(sessions: readonly SessionRow[]): string[] {
  const problems: string[] = [];
  if (!sameIds(sessions.map((s) => s.id), FIXTURE_SESSION_IDS)) {
    problems.push(`auth_sessions closure lookup found ids [${list(sessions.map((s) => s.id))}], `
      + `not exactly [${list(FIXTURE_SESSION_IDS)}]`);
  }
  for (const s of sessions) {
    if (!(FIXTURE_SESSION_IDS as readonly number[]).includes(s.id)) continue;
    if (s.userId !== FIXTURE_SESSION_USER) problems.push(`auth_sessions ${s.id}: user_id is ${s.userId}, not ${FIXTURE_SESSION_USER}`);
    if (!s.revoked) problems.push(`auth_sessions ${s.id}: is NOT revoked`);
  }
  return problems;
}

/**
 * The catalogue census. The two closure FKs must exist and hold exactly the closure's own rows;
 * every other FK into auth_users must hold zero. A multi-column FK cannot be counted: refused.
 */
function foreignKeyProblems(refs: readonly ForeignKeyRef[]): { problems: string[]; census: Record<string, number> } {
  const problems: string[] = [];
  const census: Record<string, number> = {};
  for (const r of refs) {
    if (r.arity !== 1 || r.references === null) {
      problems.push(`foreign key ${r.ref} into auth_users has ${r.arity} column(s) and cannot be counted`);
      continue;
    }
    census[r.ref] = r.references;
    const expected = r.ref === AUDIT_FK ? FIXTURE_AUDITS.length : r.ref === SESSION_FK ? FIXTURE_SESSION_IDS.length : 0;
    if (r.references !== expected) {
      problems.push(r.ref === AUDIT_FK || r.ref === SESSION_FK
        ? `${r.ref} holds ${r.references} reference(s) to the closure, not ${expected}`
        : `${r.ref} holds ${r.references} reference(s) to the closure; business/provenance references must be 0`);
    }
  }
  for (const required of [AUDIT_FK, SESSION_FK]) {
    if (!refs.some((r) => r.ref === required)) problems.push(`the catalogue has no foreign key ${required}; the census is not the expected schema`);
  }
  return { problems, census };
}

/** Reserved-domain rows outside the closure are never swept in: their presence is a STOP. */
function reservedProblems(rows: readonly ReservedRow[], closurePresent: boolean): string[] {
  const inClosure = (r: ReservedRow) => closurePresent && (
    (r.table === 'auth_users' && FIXTURE_USERS.some((u) => u.id === r.id && u.email === r.email))
    || (r.table === 'admin_invites' && r.id === FIXTURE_INVITE.id && r.email === FIXTURE_INVITE.email));
  const outside = rows.filter((r) => !inClosure(r));
  const problems = outside.length === 0 ? [] : [
    `${outside.length} reserved-domain row(s) outside the ${ISSUE248} closure `
    + `(${outside.map((r) => `${r.table} ${r.id} ${r.email}`).join(', ')}); they are not in scope and are not swept in`,
  ];
  if (closurePresent) {
    const expected = FIXTURE_USERS.length + 1;
    const matched = rows.filter(inClosure).length;
    if (matched !== expected) {
      problems.push(`the A5 reserved-domain predicate matches ${matched} closure row(s), not ${expected}`);
    }
  }
  return problems;
}

function actorProblems(actors: readonly ActorRow[], email: string): { id: number | null; problems: string[] } {
  if (actors.length !== 1) {
    return { id: null, problems: [`--actor-email ${email} matches ${actors.length} auth_users row(s), not exactly 1`] };
  }
  const a = actors[0];
  const problems: string[] = [];
  if (FIXTURE_USER_IDS.includes(a.id)) problems.push(`actor auth_users ${a.id} is a fixture account`);
  if (isTestFixtureEmail(a.email)) problems.push(`actor auth_users ${a.id} has a reserved-domain email`);
  if (a.role !== 'super_admin') problems.push(`actor auth_users ${a.id} has role '${a.role}', not 'super_admin'`);
  if (a.disabled) problems.push(`actor auth_users ${a.id} is disabled`);
  if (!a.hasPassword || !a.hasTotp) problems.push(`actor auth_users ${a.id} is not fully enrolled (password and TOTP)`);
  return { id: a.id, problems };
}

/** The one cleanup audit's detail. Every value comes from the fixed specification and the census. */
export function buildCleanupAuditDetail(foreignKeyCensus: Record<string, number>): Record<string, unknown> {
  return {
    issue: ISSUE248,
    operation: CLEANUP_OPERATION,
    blocked_issue: BLOCKED_ISSUE,
    blocked_step: 'L4 A5 pre-cutover target census: test-fixture identity gate',
    reason: CLEANUP_REASON,
    database: ISSUE248_TARGET_DATABASE,
    deleted_users: FIXTURE_USERS.map((u) => ({ id: u.id, email: u.email, role: u.role })),
    deleted_invite: {
      id: FIXTURE_INVITE.id,
      email: FIXTURE_INVITE.email,
      role: FIXTURE_INVITE.role,
      invited_by: FIXTURE_INVITE.invitedBy,
      used_at: FIXTURE_INVITE.usedAtUtc,
    },
    deleted_audit_ids: [...FIXTURE_AUDIT_IDS],
    deleted_session_ids: [...FIXTURE_SESSION_IDS],
    foreign_key_census: { ...foreignKeyCensus },
    business_provenance_references: 0,
    tool: TOOL_PATH,
  };
}

/** Everything wrong with the one cleanup audit of a completed cleanup; empty = coherent. */
export function cleanupAuditProblems(audit: AuditRow): string[] {
  const where = `auth_audit_log ${audit.id}`;
  if (!isPlainObject(audit.detail)) return [`${where}: detail is not a JSON object`];
  const d = audit.detail;
  const problems: string[] = [];
  if (d.issue !== ISSUE248) problems.push(`${where}: issue is not ${ISSUE248}`);
  if (d.operation !== CLEANUP_OPERATION) problems.push(`${where}: operation is not ${CLEANUP_OPERATION}`);
  if (d.blocked_issue !== BLOCKED_ISSUE) problems.push(`${where}: blocked_issue is not ${BLOCKED_ISSUE}`);
  if (d.database !== ISSUE248_TARGET_DATABASE) problems.push(`${where}: database is not ${ISSUE248_TARGET_DATABASE}`);
  const users = Array.isArray(d.deleted_users) ? d.deleted_users : [];
  const usersMatch = users.length === FIXTURE_USERS.length && FIXTURE_USERS.every((u, i) =>
    isPlainObject(users[i]) && users[i].id === u.id && users[i].email === u.email);
  if (!usersMatch) problems.push(`${where}: deleted_users is not exactly [${list(FIXTURE_USER_IDS)}] with their emails`);
  const invite = isPlainObject(d.deleted_invite) ? d.deleted_invite : null;
  if (invite?.id !== FIXTURE_INVITE.id || invite?.email !== FIXTURE_INVITE.email) {
    problems.push(`${where}: deleted_invite is not ${FIXTURE_INVITE.id} ${FIXTURE_INVITE.email}`);
  }
  const numbers = (v: unknown) => (Array.isArray(v) && v.every((x) => typeof x === 'number') ? (v as number[]) : null);
  const auditIds = numbers(d.deleted_audit_ids);
  if (!auditIds || !sameIds(auditIds, FIXTURE_AUDIT_IDS)) problems.push(`${where}: deleted_audit_ids is not [${list(FIXTURE_AUDIT_IDS)}]`);
  const sessionIds = numbers(d.deleted_session_ids);
  if (!sessionIds || !sameIds(sessionIds, FIXTURE_SESSION_IDS)) {
    problems.push(`${where}: deleted_session_ids is not [${list(FIXTURE_SESSION_IDS)}]`);
  }
  if (d.business_provenance_references !== 0) problems.push(`${where}: business_provenance_references is not 0`);
  const census = isPlainObject(d.foreign_key_census) ? d.foreign_key_census : null;
  const censusCoherent = census !== null
    && census[AUDIT_FK] === FIXTURE_AUDITS.length
    && census[SESSION_FK] === FIXTURE_SESSION_IDS.length
    && Object.entries(census).every(([ref, n]) => ref === AUDIT_FK || ref === SESSION_FK || n === 0);
  if (!censusCoherent) problems.push(`${where}: foreign_key_census does not prove zero business/provenance references`);
  if (audit.action !== CLEANUP_ACTION) problems.push(`${where}: action is not ${CLEANUP_ACTION}`);
  if (audit.actorUserId === null) problems.push(`${where}: no actor_user_id`);
  else if (FIXTURE_USER_IDS.includes(audit.actorUserId)) problems.push(`${where}: attributed to fixture account ${audit.actorUserId}`);
  if (audit.id <= Math.max(...FIXTURE_AUDIT_IDS)) problems.push(`${where}: is older than the fixture audit rows it records`);
  return problems;
}

/**
 * The whole guard. Pure: no I/O, so every refusal is DB-free testable. Any problem is a STOP that
 * lists every problem found; the caller throws, so the transaction rolls back unwritten.
 */
export function classifyIssue248State(state: FixtureState, actorEmail: string): Issue248Classification {
  if (state.database !== ISSUE248_TARGET_DATABASE) {
    return { kind: 'STOP', problems: [`current_database() is '${state.database}', not '${ISSUE248_TARGET_DATABASE}'`] };
  }
  const closureRows = state.users.length + state.invites.length + state.fixtureAudits.length + state.sessions.length;
  const audits = state.cleanupAudits.filter(cleanupAuditConcernsClosure);

  if (closureRows === 0) {
    // Completed, or never present: only the durable audit tells them apart.
    const problems = reservedProblems(state.reservedRows, false);
    if (audits.length === 0) {
      problems.unshift(`the closure is absent but no ${CLEANUP_ACTION} audit names ${ISSUE248}; it was removed `
        + 'outside this lifecycle (or never existed here)');
    } else if (audits.length > 1) {
      problems.unshift(`${audits.length} ${ISSUE248} ${CLEANUP_ACTION} audits (${list(audits.map((a) => a.id))}); exactly one is allowed`);
    } else {
      problems.unshift(...cleanupAuditProblems(audits[0]));
    }
    if (problems.length > 0) return { kind: 'STOP', problems };
    return { kind: 'ALREADY_CLEAN', auditId: audits[0].id };
  }

  const problems: string[] = [];
  if (audits.length > 0) {
    problems.push(`the closure is (partly) present but ${audits.length} ${ISSUE248} ${CLEANUP_ACTION} audit(s) already exist `
      + `(${list(audits.map((a) => a.id))}); inconsistent state`);
  }
  problems.push(
    ...userProblems(state.users),
    ...inviteProblems(state.invites),
    ...auditProblems(state.fixtureAudits),
    ...sessionProblems(state.sessions),
  );
  const fk = foreignKeyProblems(state.foreignKeys);
  problems.push(...fk.problems, ...reservedProblems(state.reservedRows, true));
  const actor = actorProblems(state.actors, actorEmail);
  problems.push(...actor.problems);
  if (problems.length > 0) return { kind: 'STOP', problems };
  return { kind: 'CLEANUP', plan: { actorId: actor.id as number, foreignKeyCensus: fk.census } };
}

// ---------------------------------------------------------------------------
// The transaction
// ---------------------------------------------------------------------------

export type Issue248Privileges = {
  insertAudit: boolean;
  deleteAudit: boolean;
  deleteSessions: boolean;
  deleteInvites: boolean;
  deleteUsers: boolean;
};

/** Every database operation, so the ordering and the rollback contract are DB-free testable. */
export interface Issue248Db {
  /** With `lock`, the closure rows are locked FOR UPDATE first (read write only). */
  readState(actorEmail: string, lock: boolean): Promise<FixtureState>;
  readPrivileges(): Promise<Issue248Privileges>;
  /** The one INSERT; returns the new auth_audit_log id. */
  insertCleanupAudit(actorId: number, detail: Record<string, unknown>): Promise<number>;
  /** Each guarded DELETE returns the number of rows it removed. */
  deleteSessions(): Promise<number>;
  deleteFixtureAudits(): Promise<number>;
  deleteInvite(): Promise<number>;
  deleteUsers(): Promise<number>;
}

export type Issue248Outcome = {
  verdict: 'WOULD_CLEAN' | 'CLEANED' | 'ALREADY_CLEAN';
  auditId: number | null;
  actorId: number | null;
  foreignKeyCensus: Record<string, number> | null;
  writes: number;
};

function stop(problems: readonly string[]): Issue248Refused {
  return new Issue248Refused(`STOP before mutation:\n      - ${problems.join('\n      - ')}`);
}

function rolledBack(message: string): Issue248Refused {
  return new Issue248Refused(`${message} Rolled back, including the operator audit.`);
}

/** The postcondition: exactly the closure's rows left, exactly one row added. */
export function totalsProblems(before: TableTotals, after: TableTotals): string[] {
  const expected: TableTotals = {
    authUsers: before.authUsers - FIXTURE_USERS.length,
    adminInvites: before.adminInvites - 1,
    authAuditLog: before.authAuditLog - FIXTURE_AUDITS.length + 1,
    authSessions: before.authSessions - FIXTURE_SESSION_IDS.length,
  };
  return (Object.keys(expected) as (keyof TableTotals)[])
    .filter((k) => after[k] !== expected[k])
    .map((k) => `${k} total is ${after[k]}, expected ${expected[k]} (was ${before[k]})`);
}

/**
 * Runs inside the caller's transaction and never catches: any throw propagates out of `begin()`,
 * which rolls the operator audit and every delete back together.
 */
export async function executeIssue248(db: Issue248Db, args: Issue248Args): Promise<Issue248Outcome> {
  const beforeState = await db.readState(args.actorEmail, args.apply);
  const before = classifyIssue248State(beforeState, args.actorEmail);
  if (before.kind === 'STOP') throw stop(before.problems);
  if (before.kind === 'ALREADY_CLEAN') {
    return { verdict: 'ALREADY_CLEAN', auditId: before.auditId, actorId: null, foreignKeyCensus: null, writes: 0 };
  }
  const { actorId, foreignKeyCensus } = before.plan;
  if (!args.apply) {
    return { verdict: 'WOULD_CLEAN', auditId: null, actorId, foreignKeyCensus, writes: 0 };
  }

  const p = await db.readPrivileges();
  const missing = [
    ...(p.insertAudit ? [] : ['INSERT auth_audit_log']),
    ...(p.deleteAudit ? [] : ['DELETE auth_audit_log']),
    ...(p.deleteSessions ? [] : ['DELETE auth_sessions']),
    ...(p.deleteInvites ? [] : ['DELETE admin_invites']),
    ...(p.deleteUsers ? [] : ['DELETE auth_users']),
  ];
  if (missing.length > 0) {
    throw new Issue248Refused(
      `The connected role lacks ${missing.join(', ')}; ${ISSUE248_DSN_ENV} must be the afldb_dev owner DSN. `
      + 'Nothing was written.');
  }

  // The durable operator record first, then the fixture history, children before auth_users.
  const auditId = await db.insertCleanupAudit(actorId, buildCleanupAuditDetail(foreignKeyCensus));
  const steps: [string, () => Promise<number>, number][] = [
    ['auth_sessions', () => db.deleteSessions(), FIXTURE_SESSION_IDS.length],
    ['auth_audit_log', () => db.deleteFixtureAudits(), FIXTURE_AUDITS.length],
    ['admin_invites', () => db.deleteInvite(), 1],
    ['auth_users', () => db.deleteUsers(), FIXTURE_USERS.length],
  ];
  for (const [table, run, expected] of steps) {
    const n = await run();
    if (n !== expected) throw rolledBack(`The guarded DELETE on ${table} removed ${n} row(s), not ${expected}.`);
  }

  const afterState = await db.readState(args.actorEmail, false);
  const after = classifyIssue248State(afterState, args.actorEmail);
  if (after.kind !== 'ALREADY_CLEAN' || after.auditId !== auditId) {
    throw rolledBack(`Post-write readback is not the clean state bound to audit ${auditId}`
      + `${after.kind === 'STOP' ? `: ${after.problems.join('; ')}` : ` (${after.kind})`}.`);
  }
  const drift = totalsProblems(beforeState.totals, afterState.totals);
  if (drift.length > 0) throw rolledBack(`Post-write totals differ: ${drift.join('; ')}.`);
  return { verdict: 'CLEANED', auditId, actorId, foreignKeyCensus, writes: EXPECTED_WRITES };
}

const USER_IDS = [...FIXTURE_USER_IDS];
const EMAILS = [...FIXTURE_EMAILS];
const AUDIT_IDS = [...FIXTURE_AUDIT_IDS];
const SESSION_IDS = [...FIXTURE_SESSION_IDS];
const LOGIN_ACTIONS = [...new Set(FIXTURE_AUDITS.map((a) => a.action))];

/** The real statements. int8 ids are cast to int (postgres.js returns int8 as a string). */
export function postgresIssue248Db(tx: TransactionSql): Issue248Db {
  return {
    async readState(actorEmail, lock) {
      if (lock) {
        // Locking the accounts also blocks any new row referencing them (FK KEY SHARE).
        await tx`SELECT id FROM auth_users WHERE id = ANY(${USER_IDS}) OR lower(email) = ANY(${EMAILS}) FOR UPDATE`;
        await tx`SELECT id FROM admin_invites WHERE id = ${FIXTURE_INVITE.id} OR lower(email) = ANY(${EMAILS}) FOR UPDATE`;
        await tx`SELECT id FROM auth_audit_log WHERE id = ANY(${AUDIT_IDS}) OR actor_user_id = ANY(${USER_IDS}) FOR UPDATE`;
        await tx`SELECT id FROM auth_sessions WHERE id = ANY(${SESSION_IDS}) OR user_id = ANY(${USER_IDS}) FOR UPDATE`;
      }
      const [{ database }] = await tx<{ database: string }[]>`SELECT current_database() AS database`;
      const users = await tx<UserRow[]>`
        SELECT id, email, role, disabled_at IS NOT NULL AS disabled,
               password_hash IS NOT NULL AS "hasPassword", totp_secret IS NOT NULL AS "hasTotp"
          FROM auth_users
         WHERE id = ANY(${USER_IDS}) OR lower(email) = ANY(${EMAILS})
         ORDER BY id`;
      const invites = await tx<InviteRow[]>`
        SELECT id, email, role, invited_by AS "invitedBy",
               to_char(used_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "usedAtUtc",
               expires_at <= now() AS expired, revoked_at IS NOT NULL AS revoked
          FROM admin_invites
         WHERE id = ${FIXTURE_INVITE.id} OR lower(email) = ANY(${EMAILS})
         ORDER BY id`;
      const fixtureAudits = await tx<AuditRow[]>`
        SELECT id::int AS id, actor_user_id AS "actorUserId", action, detail
          FROM auth_audit_log
         WHERE id = ANY(${AUDIT_IDS}) OR actor_user_id = ANY(${USER_IDS})
         ORDER BY id`;
      const sessions = await tx<SessionRow[]>`
        SELECT id::int AS id, user_id AS "userId", revoked_at IS NOT NULL AS revoked
          FROM auth_sessions
         WHERE id = ANY(${SESSION_IDS}) OR user_id = ANY(${USER_IDS})
         ORDER BY id`;
      const fkDefs = await tx<{ schema: string; table: string; column: string; arity: number }[]>`
        SELECT n.nspname AS schema, r.relname AS table, a.attname AS column,
               cardinality(c.conkey)::int AS arity
          FROM pg_constraint c
          JOIN pg_class r ON r.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = r.relnamespace
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
         WHERE c.contype = 'f' AND c.confrelid = 'public.auth_users'::regclass
         ORDER BY 1, 2, 3`;
      const foreignKeys: ForeignKeyRef[] = [];
      for (const fk of fkDefs) {
        const ref = `${fk.schema}.${fk.table}.${fk.column}`;
        if (fk.arity !== 1) {
          foreignKeys.push({ ref, arity: fk.arity, references: null });
          continue;
        }
        const [{ n }] = await tx.unsafe<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM ${quoteIdent(fk.schema)}.${quoteIdent(fk.table)} `
          + `WHERE ${quoteIdent(fk.column)} = ANY($1::int[])`, [USER_IDS]);
        foreignKeys.push({ ref, arity: 1, references: n });
      }
      const reservedRows: ReservedRow[] = [];
      for (const table of EMAIL_BEARING_TABLES) {
        const [{ present }] = await tx<{ present: boolean }[]>`
          SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS present`;
        if (!present) continue;
        const rows = await tx.unsafe<{ id: number; email: string }[]>(
          `SELECT id::int AS id, email FROM public.${quoteIdent(table)} WHERE ${TEST_FIXTURE_EMAIL_SQL} ORDER BY id`);
        reservedRows.push(...rows.map((r) => ({ table, id: r.id, email: r.email })));
      }
      const cleanupAudits = await tx<AuditRow[]>`
        SELECT id::int AS id, actor_user_id AS "actorUserId", action, detail
          FROM auth_audit_log WHERE action = ${CLEANUP_ACTION} ORDER BY id`;
      const actors = await tx<ActorRow[]>`
        SELECT id, email, role, disabled_at IS NOT NULL AS disabled,
               password_hash IS NOT NULL AS "hasPassword", totp_secret IS NOT NULL AS "hasTotp"
          FROM auth_users WHERE lower(email) = ${actorEmail} ORDER BY id`;
      const [totals] = await tx<TableTotals[]>`
        SELECT (SELECT count(*)::int FROM auth_users)     AS "authUsers",
               (SELECT count(*)::int FROM admin_invites)  AS "adminInvites",
               (SELECT count(*)::int FROM auth_audit_log) AS "authAuditLog",
               (SELECT count(*)::int FROM auth_sessions)  AS "authSessions"`;
      return {
        database, users: [...users], invites: [...invites], fixtureAudits: [...fixtureAudits],
        sessions: [...sessions], foreignKeys, reservedRows, cleanupAudits: [...cleanupAudits],
        actors: [...actors], totals,
      };
    },
    async readPrivileges() {
      const [row] = await tx<Issue248Privileges[]>`
        SELECT has_table_privilege('auth_audit_log', 'INSERT') AS "insertAudit",
               has_table_privilege('auth_audit_log', 'DELETE') AS "deleteAudit",
               has_table_privilege('auth_sessions', 'DELETE')  AS "deleteSessions",
               has_table_privilege('admin_invites', 'DELETE')  AS "deleteInvites",
               has_table_privilege('auth_users', 'DELETE')     AS "deleteUsers"`;
      return row;
    },
    async insertCleanupAudit(actorId, detail) {
      // sql.json() only: a pre-stringified value would be double-encoded (migration 082).
      const [row] = await tx<{ id: number }[]>`
        INSERT INTO auth_audit_log (actor_user_id, actor_label, action, detail)
        VALUES (${actorId}, ${CLEANUP_ACTOR_LABEL}, ${CLEANUP_ACTION},
                ${tx.json(detail as postgres.JSONValue)})
        RETURNING id::int AS id`;
      return row.id;
    },
    async deleteSessions() {
      const rows = await tx`
        DELETE FROM auth_sessions
         WHERE id = ANY(${SESSION_IDS})
           AND user_id = ${FIXTURE_SESSION_USER}
           AND revoked_at IS NOT NULL
        RETURNING id`;
      return rows.length;
    },
    async deleteFixtureAudits() {
      const rows = await tx`
        DELETE FROM auth_audit_log
         WHERE id = ANY(${AUDIT_IDS})
           AND actor_user_id = ${FIXTURE_AUDIT_ACTOR}
           AND action = ANY(${LOGIN_ACTIONS})
           AND detail IS NULL
        RETURNING id`;
      return rows.length;
    },
    async deleteInvite() {
      const rows = await tx`
        DELETE FROM admin_invites
         WHERE id = ${FIXTURE_INVITE.id}
           AND email = ${FIXTURE_INVITE.email}
           AND role = ${FIXTURE_INVITE.role}
           AND invited_by = ${FIXTURE_INVITE.invitedBy}
           AND used_at IS NOT NULL
           AND revoked_at IS NULL
        RETURNING id`;
      return rows.length;
    },
    async deleteUsers() {
      const rows = await tx`
        DELETE FROM auth_users
         WHERE id = ANY(${USER_IDS})
           AND email = ANY(${EMAILS})
           AND disabled_at IS NOT NULL
        RETURNING id`;
      return rows.length;
    },
  };
}

export function formatIssue248Report(args: Issue248Args, outcome: Issue248Outcome): string {
  const pad = (label: string) => label.padEnd(22);
  const transaction = !args.apply
    ? 'READ ONLY (validate only; nothing written)'
    : outcome.writes === 0 ? 'COMMITTED (no writes)' : 'COMMITTED';
  const census = outcome.foreignKeyCensus
    ? Object.entries(outcome.foreignKeyCensus).map(([ref, n]) => `${' '.repeat(24)}${ref} = ${n}`)
    : [];
  return [
    `AFLDB ${ISSUE248} DEV reserved-domain auth fixture cleanup`,
    '',
    `${pad('target database')}: ${ISSUE248_TARGET_DATABASE}`,
    `${pad('auth_users')}: ${FIXTURE_USERS.map((u) => `${u.id} ${u.email}`).join(', ')}`,
    `${pad('admin_invites')}: ${FIXTURE_INVITE.id} ${FIXTURE_INVITE.email}`,
    `${pad('auth_audit_log')}: ${list(FIXTURE_AUDIT_IDS)}`,
    `${pad('auth_sessions')}: ${list(FIXTURE_SESSION_IDS)}`,
    `${pad('actor auth_users id')}: ${outcome.actorId ?? '-'}`,
    ...(census.length > 0 ? [`${pad('FK census (closure)')}:`, ...census] : []),
    '',
    `${pad('verdict')}: ${outcome.verdict}`,
    `${pad('cleanup audit')}: ${outcome.auditId === null ? '-' : `auth_audit_log ${outcome.auditId}`}`,
    `${pad('writes')}: ${outcome.writes}`,
    `${pad('transaction')}: ${transaction}`,
    'PASS',
  ].join('\n');
}

export type Issue248Connection = {
  begin: <T>(mode: 'read only' | 'read write', fn: (tx: TransactionSql) => Promise<T>) => Promise<T>;
  end: () => Promise<void>;
};

/** Everything up to the report; `connect` and `makeDb` are injected so the whole path is DB-free testable. */
export async function runIssue248(input: {
  argv: readonly string[];
  env: Record<string, string | undefined>;
  connect: (dsn: string) => Issue248Connection;
  makeDb?: (tx: TransactionSql) => Issue248Db;
}): Promise<string> {
  // Every argv/env refusal happens BEFORE any connection is opened.
  const args = parseIssue248Args(input.argv);
  const dsn = resolveIssue248Dsn(input.env);
  const makeDb = input.makeDb ?? postgresIssue248Db;
  const sql = input.connect(dsn);
  try {
    const outcome = await sql.begin(args.apply ? 'read write' : 'read only', (tx) => executeIssue248(makeDb(tx), args));
    return formatIssue248Report(args, outcome);
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && /issue248-cleanup-dev-auth-fixtures\.ts$/.test(process.argv[1])) {
  runIssue248({
    argv: process.argv.slice(2),
    env: process.env,
    connect: (dsn) => {
      const sql = postgres(dsn, {
        max: 1, onnotice: () => {}, connection: { application_name: 'afldb-issue248-cleanup-fixtures' },
      });
      return {
        begin: <T>(mode: 'read only' | 'read write', fn: (tx: TransactionSql) => Promise<T>) =>
          sql.begin(mode, fn) as Promise<T>,
        end: () => sql.end(),
      };
    },
  })
    .then((report) => {
      console.log(report);
      process.exit(0);
    })
    .catch((error) => {
      // Refusal text names variables and database names, never a DSN; a driver error is
      // redacted in case one ever quotes a connection string.
      console.error(`    REFUSED: ${redact((error as Error).message)}`);
      console.error('    FAIL (transaction ROLLED BACK or never opened; nothing written)');
      process.exit(1);
    });
}
