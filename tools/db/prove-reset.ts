/**
 * AFLDB-ISSUE-093 §20 — the ROLLBACK-ONLY proof of the rebuild's RESET_SQL.
 *
 *     npm run db:test:prove-reset
 *
 * The rebuild's DATABASE RESET stage is intentionally destructive and has never run against
 * live PostgreSQL. Its first execution must not also be the first real clean rebuild, so
 * this exercises BOTH halves of it non-destructively:
 *
 *   * the exact same `RESET_SQL` constant — imported, never copied;
 *   * the exact same psql execution path — `tools/db/psql.ts`, same binary, same argv,
 *     same ON_ERROR_STOP and --single-transaction handling.
 *
 * A proof that ran the SQL through a different mechanism would prove the semantics and
 * leave the mechanism untested, which is the gap this stage exists to close.
 *
 * WHY IT CANNOT COMMIT — the stream's last statement is always `RAISE EXCEPTION` with the
 * rollback sentinel. It is reached only when every assertion has already passed, so the
 * success path aborts the transaction exactly as any failure path does. Two independent
 * guarantees follow:
 *
 *   1. psql, under ON_ERROR_STOP with --single-transaction, stops at that error and does
 *      not commit the stream;
 *   2. even if a COMMIT were somehow sent, PostgreSQL rolls back an already-aborted
 *      transaction — `COMMIT` on an aborted transaction IS a rollback.
 *
 * There is therefore no code path, and no psql behaviour, that commits the reset. The proof
 * treats a ZERO exit status as a failure for exactly that reason.
 *
 * Read-only observation (identity, sessions, the before/after catalog fingerprints) runs
 * over postgres.js, outside psql and outside any transaction. That is deliberate: those are
 * `SELECT`s against the catalogs, not the reset, and they need no execution-path parity.
 *
 * It needs only AFLDB_TEST_DATABASE_URL (the owner DSN). It does NOT need
 * AFLDB_TEST_IMPORT_DATABASE_URL, so AFLDB-ISSUE-083 does not gate it, and it does NOT
 * touch the fitzRoy acceptance register or any importer, so the accepted-baseline preflight
 * is irrelevant here: no data is loaded and nothing survives the transaction.
 *
 * Everything below the CLI is pure or dependency-injected and is tested with no database
 * (tests/db-test-rebuild.test.ts, "reset proof").
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RESET_SQL, RebuildRefused, assertRebuildTargetName, databaseOf } from './rebuild-test';
import {
  PsqlUnavailable, assertPsqlReachable, redact, runPsql, type PsqlResult,
} from './psql';
import {
  FINGERPRINT_SECTIONS,
  HEALTH_SQL,
  MIGRATION_STATE_SQL,
  MIGRATION_TABLE_SQL,
  collectSections,
  describeFingerprintDrift,
  fingerprintOf,
  isTrue,
  type Fingerprint,
  type Query,
  type Row,
} from './catalog-fingerprint';

// Re-exported so the reset proof stays the single import site for its own test suite.
export {
  FINGERPRINT_SECTIONS, HEALTH_SQL, MIGRATION_STATE_SQL, MIGRATION_TABLE_SQL,
  fingerprintOf, describeFingerprintDrift, isTrue, type Row, type Query,
};

// ---------------------------------------------------------------------------
// Contract constants
// ---------------------------------------------------------------------------

/** The only database this proof will touch. Cross-checked against the server's answer. */
export const PROOF_EXPECTED_DATABASE = 'afldb_test';

/**
 * The role the rebuild resets as. `afldb_test` is created `-O afldb_owner` at host
 * bootstrap (tools/maintenance/00_install_postgres.sh:88) and every schema stage runs as
 * that owner, so proving the reset under any other role would prove the wrong thing.
 */
export const PROOF_EXPECTED_ROLE = 'afldb_owner';

/** Guards against the proof blocking, or being blocked by, anything else. */
export const PROOF_LOCK_TIMEOUT = '5s';
export const PROOF_STATEMENT_TIMEOUT = '300s';
export const PROOF_IDLE_IN_TRANSACTION_TIMEOUT = '60s';

/** Prefix on every line the proof stream emits for the operator and for this module. */
export const PROOF_MARKER = 'AFLDB-PROOF';

/** The deliberate abort. Its presence in stderr is what a SUCCESSFUL proof looks like. */
export const PROOF_ROLLBACK_SENTINEL = 'AFLDB-RESET-PROOF-ROLLBACK';

/** Every marker the stream must have emitted before the sentinel, or the proof failed. */
export const PROOF_REQUIRED_MARKERS = [
  'received', 'trap', 'identity', 'sessions', 'before', 'census', 'extensions',
];

/** The first marker the stream emits. Its ABSENCE means psql never ran the stream at all. */
export const PROOF_DELIVERY_MARKER = 'received';

/**
 * The one backend type that is reported rather than refused. An autovacuum worker is not a
 * connection anyone can "close": it appears and disappears on its own, holds only SHARE
 * UPDATE EXCLUSIVE, and PostgreSQL cancels it automatically when it blocks DDL. Refusing on
 * it would make the proof fail at random on an otherwise idle database, which is the kind
 * of unexplained refusal that gets a safety gate weakened.
 */
export const TOLERATED_BACKEND_TYPES = ['autovacuum worker'];

export class ProofRefused extends Error {}

// ---------------------------------------------------------------------------
// Read-only observation SQL — every query is search_path independent
// ---------------------------------------------------------------------------

/*
 * Catalog identifiers are assembled from pg_namespace.nspname and the object's own name, or
 * from raw OIDs. Nothing uses ::regclass, ::regtype, ::regprocedure, format_type() or
 * pg_get_constraintdef(), because those render schema-qualified or bare depending on
 * search_path — which would make the before/after fingerprints incomparable for no gain.
 */

/**
 * Identity, separating the three things that are easy to conflate:
 *   current_user  — the effective role, what object ownership is checked against;
 *   session_user  — the role the DSN authenticated as, unchanged by SET ROLE;
 *   rolsuper      — looked up for BOTH, because a superuser bypasses the ownership rules
 *                   the real reset depends on and would mask a failure it would hit.
 */
export const IDENTITY_SQL = `
SELECT current_database() AS database,
       current_user       AS role_name,
       session_user       AS session_role_name,
       (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS role_is_superuser,
       (SELECT rolsuper FROM pg_roles WHERE rolname = session_user) AS session_is_superuser,
       coalesce(inet_server_addr()::text, 'local-socket') AS server_addr,
       coalesce(inet_server_port()::text, '-')            AS server_port,
       current_setting('server_version') AS server_version`;

/**
 * Every backend on this database that is not us. A non-superuser sees every row's pid,
 * datname and usename; `state` and `application_name` may come back NULL for another
 * role's backend, which is why the refusal counts rows and never depends on those fields.
 */
export const OTHER_SESSIONS_SQL = `
SELECT pid::text                       AS pid,
       coalesce(usename, '?')          AS usename,
       coalesce(application_name, '?') AS application_name,
       coalesce(state, '?')            AS state,
       coalesce(backend_type, '?')     AS backend_type
FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid()
ORDER BY pid`;


// ---------------------------------------------------------------------------
// The proof stream — one psql transaction that always aborts
// ---------------------------------------------------------------------------

/**
 * Build the SQL sent to psql. `RESET_SQL` is embedded VERBATIM: this function may wrap it,
 * never edit it.
 *
 * The temp tables that snapshot the extensions live in `pg_temp_N`, which RESET_SQL's
 * `!~ '^pg_'` schema guard excludes and whose tables its `nspname = 'public'` table guard
 * never sees — so the snapshot survives the very reset it is used to check, inside the one
 * transaction, which is stricter than comparing across two sessions.
 */
export function buildProofSql(): string {
  return `-- AFLDB-ISSUE-093 §20 rollback-only RESET_SQL proof.
-- psql runs this as ONE transaction (--single-transaction, ON_ERROR_STOP=1).
-- The final statement always raises, so this stream can never be committed.

SET LOCAL lock_timeout = '${PROOF_LOCK_TIMEOUT}';
SET LOCAL statement_timeout = '${PROOF_STATEMENT_TIMEOUT}';
SET LOCAL idle_in_transaction_session_timeout = '${PROOF_IDLE_IN_TRANSACTION_TIMEOUT}';
-- DROP ... IF EXISTS emits a NOTICE per absent object. Suppress those; the proof's own
-- markers are raised as WARNING so they still come through.
SET LOCAL client_min_messages = warning;

-- 0. PROOF OF DELIVERY, and the COMMIT TRAP. Both exist because of the failed first live
--    attempt on 2026-08-27, which exited 0 with no diagnostics: nothing then distinguished
--    "psql never received the stream" from "psql received PART of the stream, reached EOF
--    after the reset, and COMMITTED it".
--
--    The marker proves the stream arrived and began executing.
--
--    The trap makes a commit IMPOSSIBLE from this point on, wherever the stream is cut. A
--    DEFERRABLE INITIALLY DEFERRED unique constraint is checked at COMMIT, not at INSERT,
--    so the duplicate below sits harmlessly inside the transaction and turns any COMMIT
--    into an error — and therefore a rollback. This is a SERVER-side guarantee: it does not
--    depend on psql's flags, on ON_ERROR_STOP, or on the stream reaching its own sentinel.
--    It is armed BEFORE the reset, in a temp table the reset cannot drop.
DO $afldb_proof$ BEGIN
  RAISE WARNING '${PROOF_MARKER} received stream=begins';
END $afldb_proof$;

CREATE TEMP TABLE afldb_proof_commit_trap (id int);
ALTER TABLE afldb_proof_commit_trap
  ADD CONSTRAINT afldb_proof_commit_trap_uq UNIQUE (id) DEFERRABLE INITIALLY DEFERRED;
INSERT INTO afldb_proof_commit_trap VALUES (1), (1);

-- 0b. PROOF THAT WE ARE IN A TRANSACTION BLOCK AT ALL.
--     The trap doubles as the detector. Inside a transaction block the deferred constraint
--     is not checked until COMMIT, so the duplicate INSERT above succeeds and two rows are
--     visible here. In AUTOCOMMIT — psql running without --single-transaction, which is the
--     leading explanation for the 2026-08-27 incident — that INSERT is its own transaction
--     and the deferred check fires at its end, so it fails and this sees fewer than two
--     rows. Either way the stream stops HERE, before the first destructive statement.
DO $afldb_proof$
DECLARE armed int;
BEGIN
  SELECT count(*) INTO armed FROM afldb_proof_commit_trap;
  IF armed <> 2 THEN
    RAISE EXCEPTION '${PROOF_MARKER} trap: the commit trap did not arm (% rows, expected 2). This session is not in a transaction block, so nothing here could be rolled back. Refusing to run the reset', armed;
  END IF;
  RAISE WARNING '${PROOF_MARKER} trap armed=% rows', armed;
END $afldb_proof$;

-- 1. IDENTITY, asserted in the SAME session that will run the reset.
DO $afldb_proof$
DECLARE db text; cu text; su text; cu_super boolean; su_super boolean;
BEGIN
  SELECT current_database(), current_user, session_user INTO db, cu, su;
  SELECT rolsuper INTO cu_super FROM pg_roles WHERE rolname = cu;
  SELECT rolsuper INTO su_super FROM pg_roles WHERE rolname = su;
  IF db <> '${PROOF_EXPECTED_DATABASE}' THEN
    RAISE EXCEPTION '${PROOF_MARKER} identity: connected to %, not ${PROOF_EXPECTED_DATABASE}', db;
  END IF;
  IF cu <> '${PROOF_EXPECTED_ROLE}' THEN
    RAISE EXCEPTION '${PROOF_MARKER} identity: current_user is %, not ${PROOF_EXPECTED_ROLE}', cu;
  END IF;
  IF su <> '${PROOF_EXPECTED_ROLE}' THEN
    RAISE EXCEPTION '${PROOF_MARKER} identity: session_user is %, not ${PROOF_EXPECTED_ROLE}; SET ROLE is not part of the AFLDB credential model', su;
  END IF;
  IF cu_super THEN
    RAISE EXCEPTION '${PROOF_MARKER} identity: current_user % is a SUPERUSER; ${PROOF_EXPECTED_ROLE} is created NOSUPERUSER and the reset must be proven under ownership, not superuser bypass', cu;
  END IF;
  IF su_super THEN
    RAISE EXCEPTION '${PROOF_MARKER} identity: session_user % is a SUPERUSER', su;
  END IF;
  RAISE WARNING '${PROOF_MARKER} identity database=% current_user=% session_user=%', db, cu, su;
END $afldb_proof$;

-- 2. EXCLUSIVE ACCESS, re-checked in this session. The reset takes ACCESS EXCLUSIVE locks
--    on everything it drops, so a concurrent backend would be blocked by it.
DO $afldb_proof$
DECLARE others int;
BEGIN
  SELECT count(*) INTO others FROM pg_stat_activity
   WHERE datname = current_database() AND pid <> pg_backend_pid()
     AND coalesce(backend_type, '') <> 'autovacuum worker';
  IF others > 0 THEN
    RAISE EXCEPTION '${PROOF_MARKER} sessions: % other client session(s) connected to %', others, current_database();
  END IF;
  RAISE WARNING '${PROOF_MARKER} sessions others=0';
END $afldb_proof$;

-- 3. Snapshot the extensions and every object they own, INSIDE this transaction.
CREATE TEMP TABLE afldb_proof_ext AS
  SELECT e.extname, e.extversion, n.nspname AS extschema
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace;
CREATE TEMP TABLE afldb_proof_extmem AS
  SELECT d.classid, d.objid, d.objsubid, d.refobjid
    FROM pg_depend d WHERE d.deptype = 'e';

-- 4. Pre-reset counts, cross-checked against what was fingerprinted outside psql.
DO $afldb_proof$
DECLARE sc int; rel int; ext int; mem int;
BEGIN
  SELECT count(*) INTO sc FROM pg_namespace n
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_';
  SELECT count(*) INTO rel FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_'
     AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f');
  SELECT count(*) INTO ext FROM afldb_proof_ext;
  SELECT count(*) INTO mem FROM afldb_proof_extmem;
  RAISE WARNING '${PROOF_MARKER} before schemas=% relations=% extensions=% extension_members=%', sc, rel, ext, mem;
END $afldb_proof$;

-- 5. THE RESET — the exact RESET_SQL constant from tools/db/rebuild-test.ts.
${RESET_SQL.trim()}

-- 6. POST-RESET CENSUS. Every count excludes extension members, so a surviving pg_trgm
--    function is not mistaken for rebuild debris — and a DROPPED one fails step 7 instead.
DO $afldb_proof$
DECLARE sc int; tb int; vw int; sq int; ft int; rt int; ty int; pub int; mig boolean;
BEGIN
  SELECT count(*) INTO sc FROM pg_namespace n
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'public')
     AND n.nspname !~ '^pg_'
     AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_namespace'::regclass
                        AND d.objid = n.oid AND d.deptype = 'e');
  SELECT count(*) INTO tb FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
   WHERE c.relkind IN ('r', 'p')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_class'::regclass
                        AND d.objid = c.oid AND d.deptype = 'e');
  SELECT count(*) INTO vw FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
   WHERE c.relkind IN ('v', 'm')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_class'::regclass
                        AND d.objid = c.oid AND d.deptype = 'e');
  SELECT count(*) INTO sq FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
   WHERE c.relkind = 'S'
     AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_class'::regclass
                        AND d.objid = c.oid AND d.deptype = 'e');
  SELECT count(*) INTO ft FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
   WHERE c.relkind = 'f'
     AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_class'::regclass
                        AND d.objid = c.oid AND d.deptype = 'e');
  SELECT count(*) INTO rt FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
   WHERE NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.objid = p.oid AND d.deptype = 'e');
  SELECT count(*) INTO ty FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace AND n.nspname = 'public'
   WHERE t.typtype IN ('e', 'd', 'c')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.objid = t.oid AND d.deptype = 'e')
     AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.reltype = t.oid);
  SELECT count(*) INTO pub FROM pg_namespace n WHERE n.nspname = 'public';
  mig := to_regclass('afldb_meta.schema_migrations') IS NOT NULL;

  IF sc <> 0 THEN RAISE EXCEPTION '${PROOF_MARKER} census: % application schema(s) survived the reset', sc; END IF;
  IF tb <> 0 THEN RAISE EXCEPTION '${PROOF_MARKER} census: % table(s) survived the reset', tb; END IF;
  IF vw <> 0 THEN RAISE EXCEPTION '${PROOF_MARKER} census: % view(s)/matview(s) survived the reset', vw; END IF;
  IF sq <> 0 THEN RAISE EXCEPTION '${PROOF_MARKER} census: % sequence(s) survived the reset', sq; END IF;
  IF ft <> 0 THEN RAISE EXCEPTION '${PROOF_MARKER} census: % foreign table(s) survived the reset', ft; END IF;
  IF rt <> 0 THEN RAISE EXCEPTION '${PROOF_MARKER} census: % routine(s) survived the reset', rt; END IF;
  IF ty <> 0 THEN RAISE EXCEPTION '${PROOF_MARKER} census: % type(s) survived the reset', ty; END IF;
  IF mig THEN RAISE EXCEPTION '${PROOF_MARKER} census: afldb_meta.schema_migrations survived the reset; migrations would be skipped as already applied against an empty database'; END IF;
  IF pub <> 1 THEN RAISE EXCEPTION '${PROOF_MARKER} census: the public schema was removed; the extensions live there and the migrations expect it'; END IF;

  RAISE WARNING '${PROOF_MARKER} census schemas=% tables=% views=% sequences=% foreign_tables=% routines=% types=% public_schemas=% migrations=%', sc, tb, vw, sq, ft, rt, ty, pub, mig;
END $afldb_proof$;

-- 7. EXTENSION PRESERVATION, against the snapshot taken in this same transaction. Nothing
--    is hard-coded: the expected set is whatever this database carried moments ago.
DO $afldb_proof$
DECLARE lost int; gained int; lost_mem int; gained_mem int; n_ext int; n_mem int;
BEGIN
  SELECT count(*) INTO lost FROM (
    SELECT extname, extversion, extschema FROM afldb_proof_ext
    EXCEPT SELECT e.extname, e.extversion, n.nspname
      FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace) q;
  SELECT count(*) INTO gained FROM (
    SELECT e.extname, e.extversion, n.nspname
      FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    EXCEPT SELECT extname, extversion, extschema FROM afldb_proof_ext) q;
  SELECT count(*) INTO lost_mem FROM (
    SELECT classid, objid, objsubid, refobjid FROM afldb_proof_extmem
    EXCEPT SELECT d.classid, d.objid, d.objsubid, d.refobjid
      FROM pg_depend d WHERE d.deptype = 'e') q;
  SELECT count(*) INTO gained_mem FROM (
    SELECT d.classid, d.objid, d.objsubid, d.refobjid
      FROM pg_depend d WHERE d.deptype = 'e'
    EXCEPT SELECT classid, objid, objsubid, refobjid FROM afldb_proof_extmem) q;

  IF lost <> 0 OR gained <> 0 THEN
    RAISE EXCEPTION '${PROOF_MARKER} extensions: the reset changed the extension set (% lost, % gained)', lost, gained;
  END IF;
  IF lost_mem <> 0 OR gained_mem <> 0 THEN
    RAISE EXCEPTION '${PROOF_MARKER} extensions: the reset dropped % extension-owned object(s) (% gained)', lost_mem, gained_mem;
  END IF;

  SELECT count(*) INTO n_ext FROM afldb_proof_ext;
  SELECT count(*) INTO n_mem FROM afldb_proof_extmem;
  RAISE WARNING '${PROOF_MARKER} extensions preserved=% members=%', n_ext, n_mem;
END $afldb_proof$;

-- 8. ALWAYS ABORT. Reached only when every assertion above has passed, so the success path
--    aborts exactly as any failure path does: psql does not commit an errored stream, and
--    PostgreSQL rolls back an aborted transaction even if COMMIT were sent.
DO $afldb_proof$
BEGIN
  RAISE EXCEPTION '${PROOF_ROLLBACK_SENTINEL}: every assertion passed; aborting deliberately so nothing is committed';
END $afldb_proof$;
`;
}

// ---------------------------------------------------------------------------
// Pure assertions
// ---------------------------------------------------------------------------

export type Identity = {
  database: string;
  role_name: string;
  session_role_name: string;
  role_is_superuser?: unknown;
  session_is_superuser?: unknown;
  server_addr?: string;
  server_port?: string;
  server_version?: string;
};

/**
 * Identity is taken from the SERVER, then cross-checked against the DSN. The target-name
 * contract itself is the rebuild's, imported rather than copied.
 *
 * The superuser rules are refusals, not warnings. `afldb_owner` is created
 * `LOGIN NOSUPERUSER` (tools/maintenance/00_install_postgres.sh:57) and nothing in this
 * repository issues SET ROLE, so a superuser — direct or via SET ROLE from a superuser
 * session — is not part of the credential model at all. It would also bypass exactly the
 * ownership rules the real reset depends on, masking a failure the rebuild would hit.
 */
export function assertProofIdentity(identity: Identity, dsnDatabase: string): void {
  assertRebuildTargetName(dsnDatabase);

  if (identity.database !== PROOF_EXPECTED_DATABASE) {
    throw new ProofRefused(
      `Connected to '${identity.database}', but this proof only ever runs against `
      + `'${PROOF_EXPECTED_DATABASE}'. Nothing has been executed.`);
  }
  if (identity.database !== dsnDatabase) {
    throw new ProofRefused(
      `The DSN names database '${dsnDatabase}' but the server reports `
      + `'${identity.database}'. Nothing has been executed.`);
  }
  if (identity.role_name !== PROOF_EXPECTED_ROLE) {
    throw new ProofRefused(
      `Connected as current_user '${identity.role_name}', but the rebuild resets `
      + `'${PROOF_EXPECTED_DATABASE}' as '${PROOF_EXPECTED_ROLE}'. Proving the reset under `
      + 'another role would prove the wrong thing. Nothing has been executed.');
  }
  if (identity.session_role_name !== PROOF_EXPECTED_ROLE) {
    throw new ProofRefused(
      `session_user is '${identity.session_role_name}', not '${PROOF_EXPECTED_ROLE}'. `
      + 'SET ROLE is not part of the AFLDB credential model, so a session that reaches '
      + `${PROOF_EXPECTED_ROLE} indirectly is refused. Nothing has been executed.`);
  }
  if (isTrue(identity.role_is_superuser)) {
    throw new ProofRefused(
      `current_user '${identity.role_name}' is a SUPERUSER. ${PROOF_EXPECTED_ROLE} is `
      + 'created NOSUPERUSER; a superuser bypasses the ownership rules the reset depends '
      + 'on and would mask a failure the real rebuild would hit. Nothing has been executed.');
  }
  if (isTrue(identity.session_is_superuser)) {
    throw new ProofRefused(
      `session_user '${identity.session_role_name}' is a SUPERUSER. Nothing has been `
      + 'executed.');
  }
}

export type SessionRow = {
  pid: string; usename: string; application_name: string; state: string; backend_type: string;
};

/**
 * Fail closed on any other client backend. A reset that will be rolled back still takes
 * ACCESS EXCLUSIVE locks on every object it touches: it would block the application, the
 * test workers and the importers, and an idle-in-transaction session would block IT until
 * lock_timeout fires. Nothing is terminated automatically — no repository safety contract
 * authorises that, and the operator can see exactly which backends to close.
 *
 * Returns the tolerated sessions so the caller can report them.
 */
export function assertExclusiveAccess(sessions: SessionRow[]): SessionRow[] {
  const tolerated = sessions.filter((s) => TOLERATED_BACKEND_TYPES.includes(s.backend_type));
  const blocking = sessions.filter((s) => !TOLERATED_BACKEND_TYPES.includes(s.backend_type));
  if (blocking.length === 0) return tolerated;
  const who = blocking
    .map((s) => `pid ${s.pid} (${s.usename}, ${s.application_name}, ${s.state})`)
    .join('; ');
  throw new ProofRefused(
    `${blocking.length} other session(s) are connected to ${PROOF_EXPECTED_DATABASE}: ${who}. `
    + 'The reset takes ACCESS EXCLUSIVE locks on every object it drops, so this proof '
    + 'requires exclusive access. Close them and re-run. Nothing has been executed.');
}

// ---------------------------------------------------------------------------
// Interpreting what psql reported
// ---------------------------------------------------------------------------

export type Census = {
  schemas: number; tables: number; views: number; sequences: number;
  foreign_tables: number; routines: number; types: number; public_schemas: number;
};

export const CENSUS_KEYS: (keyof Census)[] = [
  'schemas', 'tables', 'views', 'sequences', 'foreign_tables', 'routines', 'types',
  'public_schemas',
];

/** `AFLDB-PROOF census tables=0 views=0 …` → `{ tables: '0', views: '0', … }`. */
export function parseMarker(output: string, kind: string): Record<string, string> | undefined {
  const line = output.split('\n')
    .find((l) => l.includes(`${PROOF_MARKER} ${kind} `));
  if (!line) return undefined;
  const values: Record<string, string> = {};
  for (const [, key, value] of line.matchAll(/([a-z_]+)=(\S+)/g)) values[key] = value;
  return values;
}

/**
 * Decide what psql's result means. Deliberately inverted relative to every other command in
 * this repository: a ZERO exit is a FAILURE here, because the stream's last statement always
 * raises. Exit 0 would mean the stream did not abort — and therefore that psql committed it.
 */
export function assertProofOutcome(result: PsqlResult): {
  census: Census; migrationsPresent: boolean; extensions: Record<string, string>;
  before: Record<string, string>; identity: Record<string, string>;
} {
  const output = `${result.stdout}\n${result.stderr}`;
  // Never discard psql's own words. The first live attempt refused on the exit status
  // alone and threw away the only evidence that could have explained it.
  const said = `\npsql exit ${result.status}. psql said:\n`
    + `${redact(output.trim()) || '(nothing at all)'}`;
  const delivered = output.includes(`${PROOF_MARKER} ${PROOF_DELIVERY_MARKER} `);

  if (result.status === 0) {
    if (!delivered) {
      throw new ProofRefused(
        'psql exited 0 and never emitted the delivery marker, so it did NOT execute the '
        + 'stream: the SQL on stdin was discarded. Nothing ran, and therefore nothing was '
        + `committed — but the reset is UNPROVEN.${said}`);
    }
    throw new ProofRefused(
      'psql exited 0 having STARTED the stream. The stream ends in RAISE EXCEPTION '
      + `'${PROOF_ROLLBACK_SENTINEL}', so a clean exit means it did not run to the end. `
      + 'The commit trap should have turned any COMMIT into an error, so a commit is not '
      + 'expected — but this outcome is not understood. Treat the database state as '
      + `UNKNOWN and verify it with 'npm run db:test:fingerprint' before anything else.${said}`);
  }
  if (!delivered) {
    throw new ProofRefused(
      `psql exited ${result.status} without ever emitting the delivery marker, so the `
      + `stream did not begin executing. Nothing was committed.${said}`);
  }
  if (!output.includes(PROOF_ROLLBACK_SENTINEL)) {
    throw new ProofRefused(
      'The proof stream began but failed before its deliberate abort. The transaction was '
      + `rolled back and nothing was committed.${said}`);
  }

  const markers: Record<string, Record<string, string>> = {};
  for (const kind of PROOF_REQUIRED_MARKERS) {
    const parsed = parseMarker(output, kind);
    if (!parsed) {
      throw new ProofRefused(
        `The proof stream reached its abort without emitting the '${kind}' marker, so that `
        + 'assertion did not run. Treat the reset as UNPROVEN.');
    }
    markers[kind] = parsed;
  }

  // Re-assert the census in Node. The stream already raised on any non-zero count; this
  // catches a stream that reported numbers its own IF tests somehow did not act on.
  const census = {} as Census;
  for (const key of CENSUS_KEYS) {
    const value = Number(markers.census[key]);
    if (!Number.isInteger(value)) {
      throw new ProofRefused(
        `The post-reset census reported a non-integer '${key}'. Treat the reset as UNPROVEN.`);
    }
    census[key] = value;
  }
  const migrationsPresent = isTrue(markers.census.migrations)
    || markers.census.migrations === 't';
  assertPostResetState(census, migrationsPresent);

  return {
    census,
    migrationsPresent,
    extensions: markers.extensions,
    before: markers.before,
    identity: markers.identity,
  };
}

/** Every object class the rebuild owns must be gone; `public` itself must remain. */
export function assertPostResetState(census: Census, migrationTablePresent: boolean): void {
  const mustBeZero: [keyof Census, string][] = [
    ['schemas', 'non-public application schemas (staging, staging_aflw, aflw, afldb_meta)'],
    ['tables', 'tables in public'],
    ['views', 'views and materialized views in public'],
    ['sequences', 'sequences in public'],
    ['foreign_tables', 'foreign tables in public'],
    ['routines', 'routines in public'],
    ['types', 'enum, domain and composite types in public'],
  ];
  for (const [key, what] of mustBeZero) {
    if (census[key] !== 0) {
      throw new ProofRefused(
        `RESET_SQL left ${census[key]} ${what}. The reset is NOT a clean slate.`);
    }
  }
  if (migrationTablePresent) {
    throw new ProofRefused(
      'RESET_SQL left afldb_meta.schema_migrations in place. Migrations would then be '
      + 'skipped as already applied against an empty database.');
  }
  if (census.public_schemas !== 1) {
    throw new ProofRefused(
      'RESET_SQL removed the public schema. The extensions live there and the migrations '
      + 'expect it to exist.');
  }
}

// ---------------------------------------------------------------------------
// The proof
// ---------------------------------------------------------------------------

export type ProofDeps = {
  /**
   * Opens a FRESH read-only session, runs `fn`, and CLOSES it before returning.
   *
   * A session, not a connection handle, precisely because of the 2026-08-27 self-collision
   * (§20.14): the harness used to hold ONE postgres.js connection open across the whole
   * proof, so when psql ran its own `pg_stat_activity` check it correctly counted the
   * observer as a client backend and refused. Observation must be finished and closed
   * before psql starts, and re-opened fresh afterwards. Nothing may span the psql run.
   */
  withSession: <T>(fn: (query: Query) => Promise<T>) => Promise<T>;
  /** Prove psql can be launched AND can reach the target, through the reset's own argv. */
  assertPsqlReachable: () => void;
  /** The SHARED psql path — same binary, same argv as the real destructive reset. */
  runPsql: (sql: string) => PsqlResult;
  log: (line: string) => void;
  /** The database named by the supplied DSN, for the identity cross-check. */
  dsnDatabase: string;
};

export type ProofReport = {
  identity: Identity;
  before: Fingerprint;
  after: Fingerprint;
  census: Census;
  extensions: Record<string, string>;
  psqlStatus: number;
  elapsedMs: number;
  rolledBack: true;
  committed: false;
};

/**
 * The whole proof. Dependency-injected end to end: the test suite runs it against a fake
 * psql and a fake catalog, and proves the refusals, the ordering, the abort and the absence
 * of any commit path without PostgreSQL.
 */
export async function runResetProof(deps: ProofDeps): Promise<ProofReport> {
  // ---- PHASE 1: observation. One session, opened and CLOSED before psql exists. --------
  //
  // Everything postgres.js needs to see happens here and nowhere else. The session is shut
  // before any psql process starts, because psql's own exclusivity check counts client
  // backends and would otherwise count this one — which is exactly what happened on
  // 2026-08-27 (§20.14). No observer may span the psql run.
  const pre = await deps.withSession(async (query) => {
    const identity = (await query(IDENTITY_SQL))[0] as unknown as Identity;
    assertProofIdentity(identity, deps.dsnDatabase);

    const sessions = (await query(OTHER_SESSIONS_SQL)) as unknown as SessionRow[];
    const tolerated = assertExclusiveAccess(sessions);

    const sections = await collectSections(query);
    return { identity, tolerated, sections };
  });
  // The observation session is closed from here on.

  const { identity } = pre;
  const before = fingerprintOf(pre.sections);
  deps.log(`  database      : ${identity.database}`);
  deps.log(`  role          : current_user ${identity.role_name}, `
    + `session_user ${identity.session_role_name}, superuser no`);
  deps.log(`  server        : ${identity.server_addr}:${identity.server_port} `
    + `PostgreSQL ${identity.server_version}`);
  deps.log(pre.tolerated.length === 0
    ? '  other sessions: 0 (exclusive access)'
    : `  other sessions: 0 client backends; ${pre.tolerated.length} tolerated `
      + `(${pre.tolerated.map((s) => s.backend_type).join(', ')}) — bounded by lock_timeout`);
  deps.log(`  fingerprint   : ${before.overall}`);
  deps.log('  observer      : closed before psql starts (no session spans the reset)');

  // ---- PHASE 2: psql only. No postgres.js connection is open. --------------------------
  //
  // Both calls are synchronous spawns, so each psql process has fully exited before the
  // next step begins — the probe cannot still be connected when the proof stream runs.
  deps.assertPsqlReachable();
  deps.log("  psql          : reachable, and answered through the reset's own argv");

  const started = Date.now();
  const result = deps.runPsql(buildProofSql());
  const elapsedMs = Date.now() - started;
  const outcome = assertProofOutcome(result);
  deps.log(`  psql exit     : ${result.status} (the deliberate abort — this is success)`);

  // ---- PHASE 3: a FRESH observation session, after psql has gone. ----------------------
  const post = await deps.withSession(async (query) => ({
    sections: await collectSections(query),
    health: (await query(HEALTH_SQL))[0],
  }));

  // Cross-check that the psql transaction saw the database the PRE-RESET fingerprint
  // describes. Compared against the sections already collected, never against a fresh
  // query — a post-rollback re-read would compare the wrong side and mask real drift.
  const seenRelations = Number(outcome.before.relations);
  const fingerprintedRelations = pre.sections.relations.length;
  if (seenRelations !== fingerprintedRelations) {
    throw new ProofRefused(
      `The psql transaction saw ${seenRelations} relations but the pre-reset fingerprint `
      + `describes ${fingerprintedRelations}. The database changed underneath the proof. `
      + 'Treat the reset as UNPROVEN.');
  }

  const after = fingerprintOf(post.sections);
  if (after.overall !== before.overall) {
    throw new ProofRefused(
      'The rollback did NOT restore the database. Drifted sections: '
      + `${describeFingerprintDrift(before, after).join(', ')}. `
      + 'Do NOT run the rebuild; restore from backup and investigate.');
  }

  if (!post.health || post.health.database !== PROOF_EXPECTED_DATABASE) {
    throw new ProofRefused('The post-rollback health query did not answer as expected.');
  }
  deps.log(`  post-rollback : ${after.overall} (identical)`);
  deps.log(`  health        : ${String(post.health.relations)} relations, `
    + `${String(post.health.extensions)} extensions`);

  return {
    identity, before, after, census: outcome.census, extensions: outcome.extensions,
    psqlStatus: result.status, elapsedMs, rolledBack: true, committed: false,
  };
}

export default { runResetProof, buildProofSql };

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const REPO_ROOT = process.cwd();

async function main(): Promise<number> {
  if (process.argv.length > 2) {
    throw new ProofRefused(
      `Unknown argument: ${process.argv[2]}. This proof takes no options: it always runs `
      + `against ${PROOF_EXPECTED_DATABASE} and always rolls back.`);
  }

  const { spawnSync } = await import('node:child_process');

  // .env without a dotenv dependency, matching tools/db/rebuild-test.ts and tests/setup.ts.
  try {
    for (const line of readFileSync(join(REPO_ROOT, '.env'), 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const [key, ...rest] = trimmed.split('=');
      if (!process.env[key.trim()]) process.env[key.trim()] = rest.join('=').trim();
    }
  } catch { /* CI supplies the variables directly */ }

  const dsn = process.env.AFLDB_TEST_DATABASE_URL;
  if (!dsn) {
    throw new ProofRefused(
      'AFLDB_TEST_DATABASE_URL is not set. This proof runs against the test database only '
      + 'and will not fall back to any other target.');
  }
  let dsnDatabase: string;
  try {
    dsnDatabase = databaseOf(dsn);
  } catch {
    throw new ProofRefused('AFLDB_TEST_DATABASE_URL is not a valid connection URL.');
  }
  // Refuse on the NAME before a connection is even opened.
  assertRebuildTargetName(dsnDatabase);

  const psqlDeps = { spawn: spawnSync as never, cwd: REPO_ROOT };
  const postgres = (await import('postgres')).default;

  /**
   * One connection per phase, opened here and CLOSED before this returns.
   *
   * Never a long-lived client. psql's in-stream exclusivity check counts client backends,
   * and a postgres.js observer held open across the psql run is itself one — the
   * 2026-08-27 self-collision (§20.14). `await sql.end()` waits for the socket to close,
   * so the backend is gone before psql is spawned.
   */
  const withSession = async <T>(fn: (query: Query) => Promise<T>): Promise<T> => {
    const sql = postgres(dsn, {
      max: 1,
      onnotice: () => {},
      connection: { application_name: 'afldb-reset-proof' },
    });
    try {
      return await fn((text) => sql.unsafe(text).then((rows) => rows as unknown as Row[]));
    } finally {
      await sql.end({ timeout: 5 });
    }
  };

  console.log('AFLDB RESET_SQL proof (AFLDB-ISSUE-093 §20)');
  console.log('  mode          : ROLLBACK-ONLY — nothing is committed, nothing is rebuilt');
  console.log('  reset path    : psql (tools/db/psql.ts) — the same helper, binary and argv');
  console.log('                  the destructive rebuild uses');

  {
    const report = await runResetProof({
      dsnDatabase,
      withSession,
      assertPsqlReachable: () => assertPsqlReachable(dsn, psqlDeps),
      runPsql: (text) => runPsql(dsn, text, psqlDeps),
      log: (line) => console.log(line),
    });

    console.log('\n  post-reset census (inside the aborted transaction):');
    console.log(`    application schemas ${report.census.schemas}   `
      + `tables ${report.census.tables}   views ${report.census.views}   `
      + `sequences ${report.census.sequences}`);
    console.log(`    routines ${report.census.routines}   types ${report.census.types}   `
      + `foreign tables ${report.census.foreign_tables}   `
      + `public schema kept ${report.census.public_schemas === 1 ? 'yes' : 'NO'}`);
    console.log(`    extensions preserved ${report.extensions.preserved}, `
      + `extension-owned objects ${report.extensions.members}`);
    console.log(`    reset stream completed in ${report.elapsedMs} ms`);
    console.log('\nRESET_SQL PROVEN through the real psql path — clean slate inside the');
    console.log('transaction, extensions intact, rollback restored the database');
    console.log('byte-identical by fingerprint.');
    console.log('THIS WAS A ROLLBACK-ONLY PROOF. Nothing was committed. Nothing was rebuilt.');
    return 0;
  }
}

// Only run when invoked directly, so the module stays importable by tests.
if (process.argv[1] && /prove-reset\.ts$/.test(process.argv[1])) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      const refused = error instanceof ProofRefused
        || error instanceof RebuildRefused
        || error instanceof PsqlUnavailable;
      console.error(refused ? `REFUSED: ${(error as Error).message}` : error);
      console.error('\nNothing was committed. The database is unchanged.');
      process.exit(1);
    });
}
