/**
 * AFLDB-ISSUE-250 — the production promotion freeze.
 *
 * A promotion reinstates production-owned state from a dump of the live target (§4) and swaps
 * the candidate in much later (§8). Any write committed to the target between the dump's
 * snapshot and the swap is not in the candidate and is silently lost. This module is the
 * enforced freeze that closes that window:
 *
 *   1. `promotion-freeze.sql` (run as postgres) revokes CONNECT on the target database from
 *      PUBLIC — so no application, auth, admin, timer or import role (`afldb_app`,
 *      `afldb_auth`, `afldb_import`) can connect — keeps it for `afldb_owner` (the owner) and
 *      `afldb_backup` (read-only), and marks the database with a token-bound comment.
 *   2. `promotion-terminate.sql` removes every session that was already connected.
 *   3. `--phase frozen` proves the freeze and quiescence, then records a content digest (F0) of
 *      every production-owned table together with the database OID.
 *   4. The dump is proven to hold exactly F0 (`--phase freeze-dump`), every later phase
 *      re-proves the target, the swap SQL refuses an unfrozen target, and after the swap the
 *      renamed-aside database — found by OID — must still hold exactly F0.
 *
 * Everything here is pure (text generation, parsing, judgement) or a read-only query string;
 * the checker runs the queries on a `default_transaction_read_only` session. The operator runs
 * the generated SQL by hand.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';

import {
  PromotionRefused,
  environmentNames,
  quoteIdent,
  quoteSqlLiteral,
  reinstatedSchemaTables,
  truncatedPublicTables,
  type Environment,
  type PlanInput,
  rollbackSql,
  swapSql,
} from './promotion-inventory';

export const FREEZE_MARKER_FORMAT = 'afldb.promotion_freeze.v1';
export const FREEZE_MANIFEST_FORMAT = 'afldb.promotion_freeze_manifest.v1';
export const FREEZE_RECORD_FORMAT = 'afldb.promotion_freeze_record.v1';
export const FREEZE_DUMP_PROOF_FORMAT = 'afldb.promotion_freeze_dump_proof.v1';
export const RESTORE_TEST_MARKER_FORMAT = 'afldb.restore_test.v1';

export { RESTORE_TEST_DATABASE } from './promotion-inventory';

/** The database owner (implicit CONNECT) and the read-only dump role. Nothing else connects. */
export const FREEZE_OWNER_ROLE = 'afldb_owner';
export const FREEZE_BACKUP_ROLE = 'afldb_backup';
export const FREEZE_ALLOWED_CONNECT_ROLES: readonly string[] = [FREEZE_OWNER_ROLE, FREEZE_BACKUP_ROLE];

const TOKEN_RE = /^[0-9a-f]{32}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Marker and manifest
// ---------------------------------------------------------------------------

export function freezeComment(token: string, environment: Environment, database: string): string {
  if (!TOKEN_RE.test(token)) throw new PromotionRefused('A freeze token is 32 lowercase hex characters.');
  return `${FREEZE_MARKER_FORMAT} token=${token} environment=${environment} database=${database}`;
}

export type FreezeMarker = { token: string; environment: Environment; database: string };

export function parseFreezeComment(comment: unknown): FreezeMarker | null {
  if (typeof comment !== 'string') return null;
  const m = /^afldb\.promotion_freeze\.v1 token=([0-9a-f]{32}) environment=(prod|dev) database=([a-z_][a-z0-9_-]*)$/.exec(comment);
  return m ? { token: m[1], environment: m[2] as Environment, database: m[3] } : null;
}

export function isFreezeMarkerComment(comment: unknown): boolean {
  return typeof comment === 'string' && comment.startsWith(FREEZE_MARKER_FORMAT);
}

export type FreezeManifest = {
  format: typeof FREEZE_MANIFEST_FORMAT;
  environment: Environment;
  database: string;
  token: string;
  comment: string;
  createdAt: string;
};

/** Only the environment's LIVE database is ever frozen, unfrozen or recovered. */
function assertLiveDatabase(database: string, environment: Environment): void {
  const names = environmentNames(environment);
  if (database !== names.live) {
    throw new PromotionRefused(
      `The promotion freeze applies to '${names.live}' only (--environment ${environment}), not '${database}'.`);
  }
}

export function newFreezeToken(): string {
  return randomBytes(16).toString('hex');
}

export function newFreezeManifest(
  environment: Environment, database: string, token: string = newFreezeToken(), now: Date = new Date(),
): FreezeManifest {
  assertLiveDatabase(database, environment);
  return {
    format: FREEZE_MANIFEST_FORMAT, environment, database, token,
    comment: freezeComment(token, environment, database), createdAt: now.toISOString(),
  };
}

function parseJsonObject(text: string, what: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new PromotionRefused(`${what} is not valid JSON.`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PromotionRefused(`${what} is not a JSON object.`);
  return value as Record<string, unknown>;
}

export function parseFreezeManifest(text: string, environment: Environment): FreezeManifest {
  const o = parseJsonObject(text, 'The freeze manifest');
  if (o.format !== FREEZE_MANIFEST_FORMAT) throw new PromotionRefused(`The freeze manifest is not ${FREEZE_MANIFEST_FORMAT}.`);
  if (o.environment !== environment) {
    throw new PromotionRefused(`The freeze manifest is for --environment ${String(o.environment)}, not ${environment}.`);
  }
  if (typeof o.token !== 'string' || !TOKEN_RE.test(o.token)) throw new PromotionRefused('The freeze manifest token is malformed.');
  if (typeof o.database !== 'string') throw new PromotionRefused('The freeze manifest names no database.');
  assertLiveDatabase(o.database, environment);
  const comment = freezeComment(o.token, environment, o.database);
  if (o.comment !== comment) throw new PromotionRefused('The freeze manifest comment does not match its token, environment and database.');
  return {
    format: FREEZE_MANIFEST_FORMAT, environment, database: o.database, token: o.token, comment,
    createdAt: String(o.createdAt ?? ''),
  };
}

// ---------------------------------------------------------------------------
// Generated operator SQL — run as postgres, connected to the postgres database
// ---------------------------------------------------------------------------

/** The effective ACL: a NULL `datacl` (every database `createdb` made) means the defaults. */
const EFFECTIVE_ACL = "aclexplode(coalesce(d.datacl, acldefault('d', d.datdba)))";

/**
 * A DO block that raises unless `database` is frozen by exactly `comment`: the marker matches,
 * PUBLIC holds no CONNECT, and no role other than the owner and `afldb_backup` holds one
 * explicitly. With `noPreparedXacts`, a prepared transaction for it also refuses.
 */
export function frozenGuardSql(database: string, comment: string, what: string, noPreparedXacts: boolean): string {
  const db = quoteSqlLiteral(database);
  const prepared = noPreparedXacts ? `
  IF EXISTS (SELECT 1 FROM pg_prepared_xacts WHERE database = ${db}) THEN
    RAISE EXCEPTION 'AFLDB-ISSUE-250 ${what}: % has a prepared transaction, which could still commit; refusing.', ${db};
  END IF;` : '';
  return `DO $guard$
DECLARE
  target oid;
  marker text;
  stray text;
BEGIN
  SELECT d.oid INTO target FROM pg_database d WHERE d.datname = ${db};
  IF target IS NULL THEN
    RAISE EXCEPTION 'AFLDB-ISSUE-250 ${what}: database % does not exist; refusing.', ${db};
  END IF;
  marker := shobj_description(target, 'pg_database');
  IF marker IS DISTINCT FROM ${quoteSqlLiteral(comment)} THEN
    RAISE EXCEPTION 'AFLDB-ISSUE-250 ${what}: % is not frozen by this token (comment: %); refusing.', ${db}, coalesce(left(marker, 160), '<none>');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_database d, ${EFFECTIVE_ACL} a
              WHERE d.oid = target AND a.grantee = 0 AND a.privilege_type = 'CONNECT') THEN
    RAISE EXCEPTION 'AFLDB-ISSUE-250 ${what}: PUBLIC can still connect to %; refusing.', ${db};
  END IF;
  SELECT string_agg(DISTINCT pg_get_userbyid(a.grantee), ', ') INTO stray
    FROM pg_database d, ${EFFECTIVE_ACL} a
   WHERE d.oid = target AND a.privilege_type = 'CONNECT' AND a.grantee <> 0
     AND a.grantee <> d.datdba AND pg_get_userbyid(a.grantee) <> ${quoteSqlLiteral(FREEZE_BACKUP_ROLE)};
  IF stray IS NOT NULL THEN
    RAISE EXCEPTION 'AFLDB-ISSUE-250 ${what}: % grants CONNECT to %; refusing.', ${db}, stray;
  END IF;${prepared}
END
$guard$;`;
}

function header(manifest: FreezeManifest, title: string, lines: readonly string[]): string {
  return [
    '\\set ON_ERROR_STOP on',
    `-- AFLDB-ISSUE-250 ${title} — ${manifest.database} (--environment ${manifest.environment})`,
    `-- token ${manifest.token}`,
    '-- Run as postgres, connected to the postgres database (never to the database it names):',
    ...lines.map((l) => `-- ${l}`),
    '',
  ].join('\n');
}

/**
 * Step 1: block every new non-operator connection and mark the database. One transaction; it
 * terminates nothing (`freezeTerminateSql` does), so running it under `psql -1` cannot open a
 * gap between a terminate and the revoke's commit.
 */
export function freezeSql(manifest: FreezeManifest): string {
  const db = quoteSqlLiteral(manifest.database);
  const ident = quoteIdent(manifest.database);
  return `${header(manifest, 'promotion freeze', [
    '  sudo -u postgres psql -d postgres -f promotion-freeze.sql',
    'Stop afldb and every afldb-settle-* timer/service first. Then run promotion-terminate.sql,',
    'then --phase frozen. Nothing here terminates a session.',
  ])}BEGIN;
DO $guard$
DECLARE
  target oid;
  owner_name text;
  existing text;
  stray text;
BEGIN
  SELECT d.oid, pg_get_userbyid(d.datdba) INTO target, owner_name FROM pg_database d WHERE d.datname = ${db};
  IF target IS NULL THEN
    RAISE EXCEPTION 'AFLDB-ISSUE-250 freeze: database % does not exist; refusing.', ${db};
  END IF;
  IF owner_name IS DISTINCT FROM ${quoteSqlLiteral(FREEZE_OWNER_ROLE)} THEN
    RAISE EXCEPTION 'AFLDB-ISSUE-250 freeze: % is owned by %, not ${FREEZE_OWNER_ROLE}; refusing.', ${db}, owner_name;
  END IF;
  existing := shobj_description(target, 'pg_database');
  IF existing IS NOT NULL THEN
    RAISE EXCEPTION 'AFLDB-ISSUE-250 freeze: % already carries a database comment (a freeze or rebuild marker may be in place; recover it first): %', ${db}, left(existing, 160);
  END IF;
  -- The effective ACL: a NULL datacl is the expected pre-freeze state (createdb's defaults).
  SELECT string_agg(DISTINCT pg_get_userbyid(a.grantee), ', ') INTO stray
    FROM pg_database d, ${EFFECTIVE_ACL} a
   WHERE d.oid = target AND a.privilege_type = 'CONNECT' AND a.grantee <> 0 AND a.grantee <> d.datdba;
  IF stray IS NOT NULL THEN
    RAISE EXCEPTION 'AFLDB-ISSUE-250 freeze: % grants CONNECT explicitly to %; the release could not restore that exactly; refusing.', ${db}, stray;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_database d, ${EFFECTIVE_ACL} a
                  WHERE d.oid = target AND a.grantee = 0 AND a.privilege_type = 'CONNECT') THEN
    RAISE EXCEPTION 'AFLDB-ISSUE-250 freeze: PUBLIC holds no CONNECT on % (frozen by hand?); refusing.', ${db};
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${quoteSqlLiteral(FREEZE_BACKUP_ROLE)}) THEN
    RAISE EXCEPTION 'AFLDB-ISSUE-250 freeze: role ${FREEZE_BACKUP_ROLE} does not exist; the dump could not run; refusing.';
  END IF;
END
$guard$;
REVOKE CONNECT, TEMPORARY ON DATABASE ${ident} FROM PUBLIC;
GRANT CONNECT ON DATABASE ${ident} TO ${quoteIdent(FREEZE_BACKUP_ROLE)};
COMMENT ON DATABASE ${ident} IS ${quoteSqlLiteral(manifest.comment)};
COMMIT;
`;
}

/**
 * Step 2, re-runnable: terminate every other session on a database frozen by THIS token. A
 * terminated backend's open transaction rolls back. Refuses (terminates nothing) unless the
 * freeze is in place, because terminating sessions that can simply reconnect proves nothing.
 */
export function freezeTerminateSql(manifest: FreezeManifest): string {
  return `${header(manifest, 'promotion freeze — terminate existing sessions', [
    '  sudo -u postgres psql -d postgres -f promotion-terminate.sql',
    'Re-runnable. Run after promotion-freeze.sql, and again whenever --phase frozen reports a session.',
  ])}${frozenGuardSql(manifest.database, manifest.comment, 'terminate', false)}
SELECT pid, usename, application_name, pg_terminate_backend(pid) AS terminated
  FROM pg_stat_activity
 WHERE datname = ${quoteSqlLiteral(manifest.database)}
   AND pid <> pg_backend_pid();
`;
}

/**
 * The deliberate release of an ABORTED promotion (or after a rollback): the exact inverse of
 * `freezeSql`. Only the environment's live name, only this token.
 */
export function unfreezeSql(manifest: FreezeManifest, title = 'promotion freeze — RELEASE'): string {
  const db = quoteSqlLiteral(manifest.database);
  const ident = quoteIdent(manifest.database);
  return `${header(manifest, title, [
    '  sudo -u postgres psql -d postgres -f <this file>',
    'Only to abandon a promotion before the swap, or after promotion-rollback.sql. After a',
    'successful swap the live name is the new database, which carries no marker, so this refuses.',
  ])}BEGIN;
DO $guard$
DECLARE
  target oid;
  marker text;
BEGIN
  SELECT d.oid INTO target FROM pg_database d WHERE d.datname = ${db};
  IF target IS NULL THEN
    RAISE EXCEPTION 'AFLDB-ISSUE-250 release: database % does not exist (a swap stopped between its renames?); refusing.', ${db};
  END IF;
  marker := shobj_description(target, 'pg_database');
  IF marker IS DISTINCT FROM ${quoteSqlLiteral(manifest.comment)} THEN
    RAISE EXCEPTION 'AFLDB-ISSUE-250 release: % is not frozen by this token (comment: %); nothing released.', ${db}, coalesce(left(marker, 160), '<none>');
  END IF;
END
$guard$;
GRANT CONNECT, TEMPORARY ON DATABASE ${ident} TO PUBLIC;
REVOKE CONNECT ON DATABASE ${ident} FROM ${quoteIdent(FREEZE_BACKUP_ROLE)};
COMMENT ON DATABASE ${ident} IS NULL;
COMMIT;
`;
}

/** `--unfreeze-recovery`: the release rebuilt from a token read off the live marker. */
export function recoveryManifest(environment: Environment, database: string, token: string): FreezeManifest {
  assertLiveDatabase(database, environment);
  if (!TOKEN_RE.test(token)) throw new PromotionRefused('--freeze-token needs the 32-character hex token --freeze-status printed.');
  return {
    format: FREEZE_MANIFEST_FORMAT, environment, database, token,
    comment: freezeComment(token, environment, database), createdAt: 'recovery',
  };
}

function preRebuildName(input: PlanInput): string {
  const names = environmentNames(input.environment);
  return `${names.preRebuildPrefix}${input.candidate.slice(names.candidatePrefix.length)}`;
}

function assertBinding(input: PlanInput, binding: FreezeBinding): void {
  const environment = input.environment ?? 'prod';
  if (binding.environment !== environment || binding.database !== input.oldDatabase) {
    throw new PromotionRefused(
      `The freeze record is for ${binding.database} (--environment ${binding.environment}); `
      + `this plan replaces ${input.oldDatabase} (--environment ${environment}).`);
  }
}

/** What a freeze-bound plan needs to know about the freeze and the proven dump. */
export type FreezeBinding = {
  environment: Environment;
  database: string;
  token: string;
  comment: string;
  dumpSha256: string;
};

function stripSet(sql: string): string {
  return sql.replace(/^\\set ON_ERROR_STOP on\n/, '');
}

/** The swap, refused unless the live database is frozen by this token and the candidate is not. */
export function frozenSwapSql(input: PlanInput, binding: FreezeBinding): string {
  assertBinding(input, binding);
  return `\\set ON_ERROR_STOP on
-- AFLDB-ISSUE-250 freeze-bound swap (token ${binding.token}). The guards run first; if either
-- raises, no session is terminated and nothing is renamed.
${frozenGuardSql(input.oldDatabase, binding.comment, 'swap', true)}
DO $candidate$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${quoteSqlLiteral(input.candidate)}) THEN
    RAISE EXCEPTION 'AFLDB-ISSUE-250 swap: candidate % does not exist; refusing.', ${quoteSqlLiteral(input.candidate)};
  END IF;
  IF EXISTS (SELECT 1 FROM pg_database
              WHERE datname = ${quoteSqlLiteral(input.candidate)}
                AND shobj_description(oid, 'pg_database') LIKE ${quoteSqlLiteral(`${FREEZE_MARKER_FORMAT}%`)}) THEN
    RAISE EXCEPTION 'AFLDB-ISSUE-250 swap: candidate % carries a freeze marker; refusing.', ${quoteSqlLiteral(input.candidate)};
  END IF;
END
$candidate$;
${stripSet(swapSql(input))}-- The renamed-aside ${preRebuildName(input)} stays FROZEN. Next: --phase production with the
-- freeze record and --old-database ${preRebuildName(input)}, BEFORE starting afldb.
`;
}

/**
 * The rollback, refused unless the kept database is the frozen one and the live one is not. The
 * original database comes back STILL FROZEN: only the token-guarded release lets writes in.
 */
export function frozenRollbackSql(input: PlanInput, binding: FreezeBinding): string {
  assertBinding(input, binding);
  const kept = preRebuildName(input);
  return `\\set ON_ERROR_STOP on
-- AFLDB-ISSUE-250 freeze-bound rollback (token ${binding.token}).
${frozenGuardSql(kept, binding.comment, 'rollback', false)}
DO $live$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_database
              WHERE datname = ${quoteSqlLiteral(input.oldDatabase)}
                AND shobj_description(oid, 'pg_database') LIKE ${quoteSqlLiteral(`${FREEZE_MARKER_FORMAT}%`)}) THEN
    RAISE EXCEPTION 'AFLDB-ISSUE-250 rollback: live % already carries a freeze marker (not swapped?); refusing.', ${quoteSqlLiteral(input.oldDatabase)};
  END IF;
END
$live$;
${stripSet(rollbackSql(input))}-- ${input.oldDatabase} is the ORIGINAL database again, and it is STILL FROZEN. Release it only
-- with promotion-unfreeze.sql (same token), then start the services.
`;
}

// ---------------------------------------------------------------------------
// Read-only observation (run by the checker on a read-only session)
// ---------------------------------------------------------------------------

export const FREEZE_DATABASE_STATE_SQL = `
SELECT d.oid::text AS oid, d.datname AS name, pg_get_userbyid(d.datdba) AS owner,
       shobj_description(d.oid, 'pg_database') AS comment,
       EXISTS (SELECT 1 FROM ${EFFECTIVE_ACL} a
                WHERE a.grantee = 0 AND a.privilege_type = 'CONNECT') AS "publicConnect"
  FROM pg_database d
 WHERE d.datname = current_database()`;

/** Every non-superuser login role that can connect — membership included. */
export const FREEZE_CONNECT_ROLES_SQL = `
SELECT r.rolname AS role
  FROM pg_roles r
 WHERE r.rolcanlogin AND NOT r.rolsuper
   AND has_database_privilege(r.oid, current_database(), 'CONNECT')
 ORDER BY r.rolname`;

/**
 * Every other session on this database. `usesysid` is visible to every caller (the checker is
 * not a superuser, so `backend_type` and `leader_pid` of other users' rows may be hidden).
 */
export const FREEZE_SESSIONS_SQL = `
SELECT a.pid, a.usename AS role, (a.usesysid IS NOT NULL) AS "hasRole",
       coalesce(r.rolsuper, false) AS superuser, a.application_name AS application
  FROM pg_stat_activity a
  LEFT JOIN pg_roles r ON r.oid = a.usesysid
 WHERE a.datname = current_database()
   AND a.pid <> pg_backend_pid()
   AND a.leader_pid IS DISTINCT FROM pg_backend_pid()
 ORDER BY a.pid`;

export const FREEZE_PREPARED_XACTS_SQL = `
SELECT gid, owner FROM pg_prepared_xacts WHERE database = current_database() ORDER BY gid`;

/** `--freeze-status`: every database, from the shared catalogs, read from the postgres DB. */
export const FREEZE_STATUS_SQL = `
SELECT d.oid::text AS oid, d.datname AS name, shobj_description(d.oid, 'pg_database') AS comment,
       EXISTS (SELECT 1 FROM ${EFFECTIVE_ACL} a
                WHERE a.grantee = 0 AND a.privilege_type = 'CONNECT') AS "publicConnect"
  FROM pg_database d
 ORDER BY d.datname`;

export type FreezeDatabaseState = {
  oid: string; name: string; owner: string; comment: string | null; publicConnect: boolean;
};
export type FreezeSession = { pid: number; role: string | null; hasRole: boolean; superuser: boolean; application: string | null };
export type FreezeObservation = {
  database: FreezeDatabaseState | undefined;
  connectRoles: readonly string[];
  sessions: readonly FreezeSession[];
  preparedXacts: readonly { gid: string; owner: string }[];
};

export type FreezeJudgement = { problems: string[]; warnings: string[]; info: string[] };

/**
 * Is this database frozen by `expected.comment`, and (with `quiescence`) is nothing that could
 * write connected? The FAIL set for sessions is exactly the set the freeze must have removed:
 * another session of a non-superuser role. A superuser session is an operator's, reported as a
 * warning (its writes are caught by the digest); a role-less row is a background process such
 * as an autovacuum worker, which commits no user data.
 */
export function judgeFreezeState(
  obs: FreezeObservation,
  expected: { database: string; comment: string; oid?: string },
  options: { quiescence: boolean },
): FreezeJudgement {
  const out: FreezeJudgement = { problems: [], warnings: [], info: [] };
  const db = obs.database;
  if (!db) {
    out.problems.push(`database ${expected.database} not found`);
    return out;
  }
  if (db.name !== expected.database) out.problems.push(`connected to ${db.name}, expected ${expected.database}`);
  if (expected.oid !== undefined && db.oid !== expected.oid) {
    out.problems.push(`database OID ${db.oid} is not the frozen database's OID ${expected.oid} — a different physical database`);
  }
  if (db.owner !== FREEZE_OWNER_ROLE) out.problems.push(`owned by ${db.owner}, not ${FREEZE_OWNER_ROLE}`);
  if (db.comment !== expected.comment) {
    const marker = parseFreezeComment(db.comment);
    if (db.comment === null) out.problems.push('carries no freeze marker: the database is NOT frozen');
    else if (marker) out.problems.push(`frozen by another token (${marker.token}), not this promotion's`);
    else out.problems.push(`carries a foreign database comment, not this freeze marker: ${db.comment.slice(0, 120)}`);
  }
  if (db.publicConnect) out.problems.push('PUBLIC can still connect');
  const stray = obs.connectRoles.filter((r) => !FREEZE_ALLOWED_CONNECT_ROLES.includes(r));
  if (stray.length > 0) out.problems.push(`non-superuser login role(s) can still connect: ${stray.join(', ')}`);
  if (options.quiescence) {
    const writers = obs.sessions.filter((s) => s.hasRole && !s.superuser);
    if (writers.length > 0) {
      out.problems.push(`${writers.length} other session(s) still connected — run promotion-terminate.sql, then re-run: `
        + writers.map((s) => `pid ${s.pid} ${s.role ?? '?'}${s.application ? ` (${s.application})` : ''}`).join('; '));
    }
    const operators = obs.sessions.filter((s) => s.hasRole && s.superuser);
    if (operators.length > 0) {
      out.warnings.push(`superuser session(s) connected (operator; any write they make fails the digest): `
        + operators.map((s) => `pid ${s.pid} ${s.role ?? '?'}`).join('; '));
    }
    const background = obs.sessions.filter((s) => !s.hasRole);
    if (background.length > 0) {
      out.info.push(`${background.length} role-less background process(es) (e.g. autovacuum): pid ${background.map((s) => s.pid).join(', ')}`);
    }
    if (obs.preparedXacts.length > 0) {
      out.problems.push(`prepared transaction(s) could still commit: ${obs.preparedXacts.map((x) => `${x.gid} (${x.owner})`).join(', ')}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The content digest (F0)
// ---------------------------------------------------------------------------

/**
 * Every table a promotion does NOT take from the rebuild: the non-`rebuilt` public contract
 * tables (reinstated, reset, regenerated) and every reinstated-schema table. Generated from the
 * contract, so a new entry is covered without editing this function.
 */
export function freezeDigestTables(): { schema: string; table: string; key: string }[] {
  const out = truncatedPublicTables().map((table) => ({ schema: 'public', table, key: `public.${table}` }));
  for (const { schema, table } of reinstatedSchemaTables()) out.push({ schema, table, key: `${schema}.${table}` });
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** Pinned output settings: the same rows always render the same text. */
export const DIGEST_SESSION_SETTINGS: readonly [string, string][] = [
  ['TimeZone', 'UTC'], ['DateStyle', 'ISO, YMD'], ['IntervalStyle', 'postgres'],
  ['extra_float_digits', '1'], ['bytea_output', 'hex'],
];

export function tableDigestSql(schema: string, table: string): string {
  return `SELECT count(*)::int AS rows, coalesce(md5(string_agg(h, '' ORDER BY h)), md5('')) AS digest
  FROM (SELECT md5(t::text) AS h FROM ${quoteIdent(schema)}.${quoteIdent(table)} t) s`;
}

export type FreezeDigestEntry = { table: string; rows: number; digest: string };

type Q = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

/** Read the digest. Missing tables are returned as `rows: -1`, which never equals a record. */
export async function readFreezeDigest(q: Q): Promise<FreezeDigestEntry[]> {
  for (const [name, value] of DIGEST_SESSION_SETTINGS) await q(`SET ${name} = ${quoteSqlLiteral(value)}`);
  try {
    const out: FreezeDigestEntry[] = [];
    for (const { schema, table, key } of freezeDigestTables()) {
      const [present] = await q('SELECT to_regclass($1) IS NOT NULL AS present', [`${quoteIdent(schema)}.${quoteIdent(table)}`]);
      if (!present?.present) {
        out.push({ table: key, rows: -1, digest: 'missing' });
        continue;
      }
      const [row] = await q(tableDigestSql(schema, table));
      out.push({ table: key, rows: Number(row?.rows), digest: String(row?.digest) });
    }
    return out;
  } finally {
    for (const [name] of DIGEST_SESSION_SETTINGS) await q(`RESET ${name}`);
  }
}

function canonical(value: unknown): string {
  return JSON.stringify(value);
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function freezeDigestSha256(entries: readonly FreezeDigestEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.table.localeCompare(b.table))
    .map(({ table, rows, digest }) => ({ table, rows, digest }));
  return sha256(canonical(sorted));
}

/** Differences between a recorded F0 and a fresh read. Empty means identical. */
export function judgeFreezeDigest(expected: readonly FreezeDigestEntry[], observed: readonly FreezeDigestEntry[]): string[] {
  const problems: string[] = [];
  const seen = new Map(observed.map((e) => [e.table, e]));
  for (const e of expected) {
    const o = seen.get(e.table);
    if (!o || o.rows < 0) problems.push(`${e.table}: missing`);
    else if (o.rows !== e.rows || o.digest !== e.digest) {
      problems.push(`${e.table}: ${o.rows} row(s) digest ${o.digest.slice(0, 12)}…, frozen ${e.rows} row(s) digest ${e.digest.slice(0, 12)}…`);
    }
    seen.delete(e.table);
  }
  for (const extra of seen.keys()) problems.push(`${extra}: not in the freeze record`);
  return problems;
}

// ---------------------------------------------------------------------------
// The freeze record and the dump proof
// ---------------------------------------------------------------------------

export type FreezeRecord = {
  format: typeof FREEZE_RECORD_FORMAT;
  environment: Environment;
  database: string;
  token: string;
  comment: string;
  databaseOid: string;
  frozenAt: string;
  tables: FreezeDigestEntry[];
  digestSha256: string;
  payloadSha256: string;
};

function payloadOf<T extends { payloadSha256: string }>(value: T): string {
  return sha256(canonical({ ...value, payloadSha256: undefined }));
}

export function buildFreezeRecord(input: {
  manifest: FreezeManifest; databaseOid: string; tables: FreezeDigestEntry[]; now?: Date;
}): FreezeRecord {
  const tables = [...input.tables].sort((a, b) => a.table.localeCompare(b.table));
  if (tables.some((t) => t.rows < 0)) throw new PromotionRefused('A freeze record cannot carry a missing table.');
  const record: FreezeRecord = {
    format: FREEZE_RECORD_FORMAT, environment: input.manifest.environment, database: input.manifest.database,
    token: input.manifest.token, comment: input.manifest.comment, databaseOid: input.databaseOid,
    frozenAt: (input.now ?? new Date()).toISOString(), tables, digestSha256: freezeDigestSha256(tables),
    payloadSha256: '',
  };
  record.payloadSha256 = payloadOf(record);
  return record;
}

export function parseFreezeRecord(text: string, environment: Environment): FreezeRecord {
  const o = parseJsonObject(text, 'The freeze record');
  if (o.format !== FREEZE_RECORD_FORMAT) throw new PromotionRefused(`The freeze record is not ${FREEZE_RECORD_FORMAT}.`);
  if (o.environment !== environment) {
    throw new PromotionRefused(`The freeze record is for --environment ${String(o.environment)}, not ${environment}.`);
  }
  if (typeof o.token !== 'string' || !TOKEN_RE.test(o.token)) throw new PromotionRefused('The freeze record token is malformed.');
  if (typeof o.database !== 'string') throw new PromotionRefused('The freeze record names no database.');
  assertLiveDatabase(o.database, environment);
  if (o.comment !== freezeComment(o.token, environment, o.database)) {
    throw new PromotionRefused('The freeze record marker does not match its token, environment and database.');
  }
  if (typeof o.databaseOid !== 'string' || !/^[1-9][0-9]*$/.test(o.databaseOid)) {
    throw new PromotionRefused('The freeze record database OID is malformed.');
  }
  if (!Array.isArray(o.tables)) throw new PromotionRefused('The freeze record carries no table digest.');
  const tables: FreezeDigestEntry[] = o.tables.map((t) => {
    const e = t as Record<string, unknown>;
    if (typeof e.table !== 'string' || typeof e.rows !== 'number' || !Number.isInteger(e.rows) || e.rows < 0
      || typeof e.digest !== 'string' || !/^[0-9a-f]{32}$/.test(e.digest)) {
      throw new PromotionRefused('The freeze record carries a malformed table digest.');
    }
    return { table: e.table, rows: e.rows, digest: e.digest };
  });
  const expectedKeys = freezeDigestTables().map((t) => t.key).join('\n');
  const keys = [...tables].map((t) => t.table).sort((a, b) => a.localeCompare(b)).join('\n');
  if (keys !== expectedKeys) {
    throw new PromotionRefused('The freeze record covers a different table set than this checkout\'s contract; freeze again with this checkout.');
  }
  if (o.digestSha256 !== freezeDigestSha256(tables)) throw new PromotionRefused('The freeze record digest sha256 does not match its tables (tampered?).');
  const record: FreezeRecord = {
    format: FREEZE_RECORD_FORMAT, environment, database: o.database, token: o.token, comment: o.comment as string,
    databaseOid: o.databaseOid, frozenAt: String(o.frozenAt ?? ''), tables,
    digestSha256: o.digestSha256 as string, payloadSha256: String(o.payloadSha256 ?? ''),
  };
  if (record.payloadSha256 !== payloadOf(record)) throw new PromotionRefused('The freeze record payload sha256 does not match (tampered?).');
  return record;
}

export type FreezeDumpProof = {
  format: typeof FREEZE_DUMP_PROOF_FORMAT;
  environment: Environment;
  database: string;
  token: string;
  recordPayloadSha256: string;
  dumpPath: string;
  dumpSha256: string;
  digestSha256: string;
  provenAt: string;
  payloadSha256: string;
};

export function buildFreezeDumpProof(input: {
  record: FreezeRecord; dumpPath: string; dumpSha256: string; now?: Date;
}): FreezeDumpProof {
  if (!SHA256_RE.test(input.dumpSha256)) throw new PromotionRefused('The dump sha256 is malformed.');
  const proof: FreezeDumpProof = {
    format: FREEZE_DUMP_PROOF_FORMAT, environment: input.record.environment, database: input.record.database,
    token: input.record.token, recordPayloadSha256: input.record.payloadSha256, dumpPath: input.dumpPath,
    dumpSha256: input.dumpSha256, digestSha256: input.record.digestSha256,
    provenAt: (input.now ?? new Date()).toISOString(), payloadSha256: '',
  };
  proof.payloadSha256 = payloadOf(proof);
  return proof;
}

export function parseFreezeDumpProof(text: string, record: FreezeRecord): FreezeDumpProof {
  const o = parseJsonObject(text, 'The freeze dump proof');
  if (o.format !== FREEZE_DUMP_PROOF_FORMAT) throw new PromotionRefused(`The freeze dump proof is not ${FREEZE_DUMP_PROOF_FORMAT}.`);
  const proof: FreezeDumpProof = {
    format: FREEZE_DUMP_PROOF_FORMAT, environment: o.environment as Environment, database: String(o.database),
    token: String(o.token), recordPayloadSha256: String(o.recordPayloadSha256), dumpPath: String(o.dumpPath),
    dumpSha256: String(o.dumpSha256), digestSha256: String(o.digestSha256), provenAt: String(o.provenAt ?? ''),
    payloadSha256: String(o.payloadSha256 ?? ''),
  };
  if (proof.payloadSha256 !== payloadOf(proof)) throw new PromotionRefused('The freeze dump proof payload sha256 does not match (tampered?).');
  if (proof.environment !== record.environment || proof.database !== record.database || proof.token !== record.token
    || proof.recordPayloadSha256 !== record.payloadSha256 || proof.digestSha256 !== record.digestSha256) {
    throw new PromotionRefused('The freeze dump proof belongs to a different freeze record.');
  }
  if (!SHA256_RE.test(proof.dumpSha256)) throw new PromotionRefused('The freeze dump proof dump sha256 is malformed.');
  return proof;
}

export function restoreTestComment(dumpSha256: string): string {
  if (!SHA256_RE.test(dumpSha256)) throw new PromotionRefused('The dump sha256 is malformed.');
  return `${RESTORE_TEST_MARKER_FORMAT} sha256=${dumpSha256}`;
}

/** The sha256 `restore-test.sh` recorded for the dump it restored, or null. */
export function parseRestoreTestComment(comment: unknown): string | null {
  if (typeof comment !== 'string') return null;
  const m = /^afldb\.restore_test\.v1 sha256=([0-9a-f]{64})$/.exec(comment);
  return m ? m[1] : null;
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('error', (error) => reject(new PromotionRefused(`Cannot read ${path}: ${error.message}`)))
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

// ---------------------------------------------------------------------------
// --freeze-status
// ---------------------------------------------------------------------------

export type FreezeStatusRow = { oid: string; name: string; comment: string | null; publicConnect: boolean };

/**
 * What an operator needs after a crash or a lost terminal: for each database of the
 * environment's naming family, what it is, whether it carries a freeze marker, whether its ACL
 * is frozen, and what that combination means.
 */
export function describeFreezeStatus(rows: readonly FreezeStatusRow[], environment: Environment): string[] {
  const names = environmentNames(environment);
  const family = rows.filter((r) => r.name === names.live || r.name.startsWith(names.candidatePrefix)
    || r.name.startsWith(names.preRebuildPrefix));
  const lines: string[] = [];
  if (!family.some((r) => r.name === names.live)) {
    lines.push(`NO LIVE DATABASE '${names.live}': a swap or rollback stopped between its two renames. Rename the `
      + 'frozen database back to the live name by hand, re-run --freeze-status, then continue or release.');
  }
  for (const r of family) {
    const role = r.name === names.live ? 'live' : r.name.startsWith(names.preRebuildPrefix) ? 'kept' : 'candidate';
    const marker = parseFreezeComment(r.comment);
    const frozenAcl = !r.publicConnect;
    const markerText = marker ? `marker token ${marker.token}` : r.comment === null ? 'no marker' : 'foreign comment';
    let meaning: string;
    if (marker && frozenAcl) {
      meaning = role === 'live' ? 'LIVE DATABASE FROZEN — a promotion is in progress or was abandoned: continue it, or release it '
          + 'with promotion-unfreeze.sql / --unfreeze-recovery --freeze-token ' + marker.token
        : role === 'kept' ? 'kept database, frozen (expected after a promotion; stays frozen until cleanup drops it)'
          : 'ANOMALY: a candidate carries a freeze marker — inspect by hand';
    } else if (!marker && !frozenAcl) {
      meaning = role === 'live' ? 'live, writable (normal)' : `${role}, not frozen`;
    } else {
      meaning = 'INCONSISTENT (marker and ACL disagree) — inspect by hand; neither the swap nor a release will run';
    }
    lines.push(`${r.name} (oid ${r.oid}, ${role}): ${markerText}, ACL ${frozenAcl ? 'frozen' : 'open'} — ${meaning}`);
  }
  return lines;
}

/** For tests and the checker's own safety: the markers can never be mistaken for each other. */
export function assertFreezeMarkerDistinct(rebuildMarkerFormat: string): void {
  if (FREEZE_MARKER_FORMAT.includes(rebuildMarkerFormat) || rebuildMarkerFormat.includes(FREEZE_MARKER_FORMAT)) {
    throw new PromotionRefused('The freeze marker would collide with the rebuild marker.');
  }
}
