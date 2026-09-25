/**
 * AFLDB-ISSUE-237 §11a.2.1 — create or find the DISABLED, attribution-only recovery actor on
 * `afldb_test`, so the ISSUE-224 S9 registration (`register_issue224_s9_players.ts
 * --admin-user-id <n>`) has an `auth_users` row to attribute its `data_overrides` and
 * `data_edits` writes to. The I18 rebuild left `afldb_test` with 0 `auth_users`.
 *
 *     $env:AFLDB_TEST_DATABASE_URL = '<owner DSN naming afldb_test>'
 *     npm run db:issue237:ensure-recovery-actor -- --email <addr> --role <contributor|admin|super_admin>
 *
 * WHAT THE ACTOR IS. Exactly the ISSUE-235 attribution-only account
 * (`insertAttributionOnlyActor`, rebuild_afl_api_adjudications.ts): the normalised email, the
 * explicit role, NULL password hash, NULL TOTP secret, `disabled_at` set at creation, every
 * other column at its schema default. It cannot sign in (login needs both factors and
 * `disabled_at IS NULL`, src/lib/auth/session.ts). It is NOT a restored or usable account;
 * `tools/admin/create-admin.ts` is deliberately not used.
 *
 * ROLE. The tool records whatever `--role` names, within `auth_users_role_check` (migration
 * 033, `isLifecycleRole`). The registration tool checks none. For ISSUE-224 the honest value is
 * `super_admin`: the application's player-creation paths (`data.dataEditor`,
 * `data.playerLinks`, src/lib/auth/capabilities.ts) are SUPER_ADMIN_ONLY, so an `admin`
 * attribution would record a role that could not have made these writes.
 *
 * IDEMPOTENT, NEVER CORRECTIVE. An existing row with the same case-insensitive email
 * (`uq_auth_users_email_lower`) passes only if it is already exactly what this tool would
 * create; its id is returned and nothing is written. Anything else — enabled, wrong role, a
 * credential, a TOTP counter, a temporary-password flag, delegated admin power, any session,
 * or an open admin invite for the address (accepting one upserts credentials onto the row and
 * clears `disabled_at`, src/app/admin/invite/[token]/actions.ts) — STOPs. The tool never
 * updates an existing row.
 *
 * TARGET SAFETY. The DSN comes only from `AFLDB_TEST_DATABASE_URL` (owner: this INSERTs into
 * `auth_users`), and both its path and the live `current_database()` must be exactly
 * `afldb_test`. No DSN, and no credential value, is ever read back or printed: the state query
 * selects credential PRESENCE only.
 *
 * ONE TRANSACTION. Prove the target, inspect the email's state, INSERT if absent, read the row
 * back and prove the exact contract, then commit. Any failure rolls back.
 */
import postgres, { type TransactionSql } from 'postgres';

import { isLifecycleRole, type LifecycleRole } from '../../src/lib/auth/admin-lifecycle';
import { databaseOf } from '../db/rebuild-test';
import { redact } from '../db/psql';
import { insertAttributionOnlyActor } from './rebuild_afl_api_adjudications';

export class RecoveryActorRefused extends Error {}

export const RECOVERY_ACTOR_TARGET_DATABASE = 'afldb_test';
export const RECOVERY_ACTOR_DSN_ENV = 'AFLDB_TEST_DATABASE_URL';

/** The address rule and normalisation every other `auth_users` write path uses (create-admin.ts). */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normaliseRecoveryActorEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new RecoveryActorRefused(`--email ${JSON.stringify(raw)} is not a valid email address.`);
  }
  return email;
}

export type RecoveryActorArgs = { email: string; role: LifecycleRole };

/** `--email <addr> --role <contributor|admin|super_admin>`; both required, no defaults. */
export function parseRecoveryActorArgs(argv: readonly string[]): RecoveryActorArgs {
  const values: Partial<Record<'email' | 'role', string>> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const key = flag === '--email' ? 'email' : flag === '--role' ? 'role' : null;
    if (!key) throw new RecoveryActorRefused(`Unknown argument ${JSON.stringify(flag)}.`);
    if (values[key] !== undefined) throw new RecoveryActorRefused(`${flag} was given more than once.`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new RecoveryActorRefused(`${flag} needs a value.`);
    values[key] = value;
    i += 1;
  }
  if (values.email === undefined) throw new RecoveryActorRefused('--email is required.');
  if (values.role === undefined) throw new RecoveryActorRefused('--role is required.');
  const email = normaliseRecoveryActorEmail(values.email);
  if (!isLifecycleRole(values.role)) {
    throw new RecoveryActorRefused(
      `--role ${JSON.stringify(values.role)} is not one auth_users.role allows (contributor, admin, super_admin).`);
  }
  return { email, role: values.role };
}

export function assertRecoveryActorTarget(database: string, label: string): void {
  if (database !== RECOVERY_ACTOR_TARGET_DATABASE) {
    throw new RecoveryActorRefused(
      `${label} is '${database}'; the only recovery-actor target is '${RECOVERY_ACTOR_TARGET_DATABASE}'.`);
  }
}

/** The DSN, from the environment only. Refusals name the variable and database, never the DSN. */
export function resolveRecoveryActorDsn(env: Record<string, string | undefined>): string {
  const dsn = env[RECOVERY_ACTOR_DSN_ENV]?.trim();
  if (!dsn) throw new RecoveryActorRefused(`${RECOVERY_ACTOR_DSN_ENV} is not set.`);
  let named: string;
  try {
    named = databaseOf(dsn);
  } catch {
    throw new RecoveryActorRefused(`${RECOVERY_ACTOR_DSN_ENV} is not a valid connection URL.`);
  }
  assertRecoveryActorTarget(named, `${RECOVERY_ACTOR_DSN_ENV}'s database`);
  return dsn;
}

/** One `auth_users` row as this tool sees it: credential PRESENCE only, never a value. */
export type AuthUserState = {
  id: number;
  email: string;
  role: string;
  disabled: boolean;
  hasPassword: boolean;
  hasTotp: boolean;
  hasTotpLastStep: boolean;
  mustChangePassword: boolean;
  hasPasswordChangedAt: boolean;
  canManageAdmins: boolean;
  sessions: number;
};

/** Every way a row falls short of the attribution-only contract; empty means suitable. */
export function attributionOnlyProblems(row: AuthUserState, want: RecoveryActorArgs): string[] {
  const problems: string[] = [];
  if (row.email !== want.email) problems.push(`its email is not exactly '${want.email}'`);
  if (row.role !== want.role) problems.push(`its role is '${row.role}', not '${want.role}'`);
  if (!row.disabled) problems.push('it is enabled');
  if (row.hasPassword) problems.push('it holds a password credential');
  if (row.hasTotp) problems.push('it holds a TOTP credential');
  if (row.hasTotpLastStep) problems.push('it has a TOTP sign-in counter');
  if (row.mustChangePassword) problems.push('it carries a temporary-password flag');
  if (row.hasPasswordChangedAt) problems.push('it records a password change');
  if (row.canManageAdmins) problems.push('it holds delegated can_manage_admins');
  if (row.sessions !== 0) problems.push(`it has ${row.sessions} auth session(s)`);
  return problems;
}

export type RecoveryActorOutcome = {
  action: 'CREATED' | 'ALREADY_SUITABLE';
  adminUserId: number;
  writes: number;
};

async function readActorState(tx: TransactionSql, email: string): Promise<AuthUserState[]> {
  return tx<AuthUserState[]>`
    SELECT u.id,
           u.email,
           u.role,
           u.disabled_at IS NOT NULL AS disabled,
           u.password_hash IS NOT NULL AS "hasPassword",
           u.totp_secret IS NOT NULL AS "hasTotp",
           u.totp_last_step IS NOT NULL AS "hasTotpLastStep",
           u.must_change_password AS "mustChangePassword",
           u.password_changed_at IS NOT NULL AS "hasPasswordChangedAt",
           u.can_manage_admins AS "canManageAdmins",
           (SELECT count(*)::int FROM auth_sessions s WHERE s.user_id = u.id) AS sessions
      FROM auth_users u
     WHERE lower(u.email) = ${email}
     ORDER BY u.id
  `;
}

/**
 * The whole contract, inside the caller's transaction. Throws (so the caller rolls back) on
 * any refusal, including a post-INSERT readback that is not exactly the attribution-only row.
 */
export async function ensureRecoveryActor(tx: TransactionSql, want: RecoveryActorArgs): Promise<RecoveryActorOutcome> {
  const [proof] = await tx<{ database: string; canInsert: boolean }[]>`
    SELECT current_database() AS database,
           has_table_privilege('auth_users', 'INSERT') AS "canInsert"
  `;
  assertRecoveryActorTarget(proof.database, 'the live current_database()');

  const [{ openInvites }] = await tx<{ openInvites: number }[]>`
    SELECT count(*)::int AS "openInvites"
      FROM admin_invites
     WHERE lower(email) = ${want.email}
       AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
  `;
  if (openInvites !== 0) {
    throw new RecoveryActorRefused(
      `STOP: ${openInvites} open admin invite(s) exist for ${want.email}; accepting one would make the actor sign-in capable. Nothing was written.`);
  }

  const existing = await readActorState(tx, want.email);
  if (existing.length > 1) {
    throw new RecoveryActorRefused(
      `STOP: ${existing.length} auth_users rows match ${want.email} case-insensitively. Nothing was written.`);
  }
  if (existing.length === 1) {
    const problems = attributionOnlyProblems(existing[0], want);
    if (problems.length > 0) {
      throw new RecoveryActorRefused(
        `STOP: auth_users ${existing[0].id} already holds ${want.email} but is not a suitable attribution-only `
        + `actor: ${problems.join('; ')}. It was NOT modified; nothing was written.`);
    }
    return { action: 'ALREADY_SUITABLE', adminUserId: existing[0].id, writes: 0 };
  }

  if (!proof.canInsert) {
    throw new RecoveryActorRefused(
      `The connected role cannot INSERT into auth_users; ${RECOVERY_ACTOR_DSN_ENV} must be the afldb_test owner DSN.`);
  }
  const id = await insertAttributionOnlyActor(tx, { email: want.email, role: want.role });

  const readback = await readActorState(tx, want.email);
  if (readback.length !== 1 || readback[0].id !== id) {
    throw new RecoveryActorRefused(
      `Readback after INSERT found ${readback.length} row(s) for ${want.email}, not exactly auth_users ${id}. Rolled back.`);
  }
  const problems = attributionOnlyProblems(readback[0], want);
  if (problems.length > 0) {
    throw new RecoveryActorRefused(
      `Readback of the new auth_users ${id} does not meet the attribution-only contract: ${problems.join('; ')}. Rolled back.`);
  }
  return { action: 'CREATED', adminUserId: id, writes: 1 };
}

export function formatRecoveryActorReport(want: RecoveryActorArgs, outcome: RecoveryActorOutcome): string {
  const pad = (label: string) => label.padEnd(16);
  return [
    'AFLDB ISSUE-237 recovery attribution actor',
    '',
    `${pad('target database')}: ${RECOVERY_ACTOR_TARGET_DATABASE}`,
    `${pad('email')}: ${want.email}`,
    `${pad('role')}: ${want.role}`,
    `${pad('enabled')}: no`,
    `${pad('password')}: absent`,
    `${pad('totp')}: absent`,
    '',
    `${pad('action')}: ${outcome.action}`,
    `${pad('admin_user_id')}: ${outcome.adminUserId}`,
    `${pad('writes')}: ${outcome.writes}`,
    `${pad('transaction')}: ${outcome.writes === 0 ? 'COMMITTED (no writes)' : 'COMMITTED'}`,
    'PASS',
  ].join('\n');
}

/** Everything up to the report; `connect` is injected so the whole path is testable DB-free. */
export async function runEnsureRecoveryActor(input: {
  argv: readonly string[];
  env: Record<string, string | undefined>;
  connect: (dsn: string) => { begin: <T>(fn: (tx: TransactionSql) => Promise<T>) => Promise<T>; end: () => Promise<void> };
}): Promise<string> {
  // Every argv/env refusal happens BEFORE any connection is opened.
  const want = parseRecoveryActorArgs(input.argv);
  const dsn = resolveRecoveryActorDsn(input.env);
  const sql = input.connect(dsn);
  try {
    const outcome = await sql.begin((tx) => ensureRecoveryActor(tx, want));
    return formatRecoveryActorReport(want, outcome);
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && /ensure_issue237_recovery_actor\.ts$/.test(process.argv[1])) {
  runEnsureRecoveryActor({
    argv: process.argv.slice(2),
    env: process.env,
    connect: (dsn) => {
      const sql = postgres(dsn, {
        max: 1, onnotice: () => {}, connection: { application_name: 'afldb-issue237-recovery-actor' },
      });
      return {
        begin: <T>(fn: (tx: TransactionSql) => Promise<T>) => sql.begin(fn) as Promise<T>,
        end: () => sql.end(),
      };
    },
  })
    .then((report) => {
      console.log(report);
      process.exit(0);
    })
    .catch((error) => {
      // Refusal text names the variable, database and email, never the DSN; a driver error is
      // redacted in case one ever quotes a connection string.
      console.error(`    REFUSED: ${redact((error as Error).message)}`);
      console.error('    FAIL (transaction ROLLED BACK or never opened; nothing written)');
      process.exit(1);
    });
}
