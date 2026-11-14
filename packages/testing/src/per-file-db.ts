/**
 * @afldb/testing — AFLDB-ISSUE-363 owner decision (1): the effectful half of per-file disposable test databases.
 * Policy (what may run, which names may exist, what may be dropped) is ./per-file-db-policy.ts and is unit-tested on
 * plain values; this file creates, audits, drops and sweeps.
 *
 * CREDENTIALS. A test connects as `afldb_owner`, which is NOCREATEDB by design, so creation needs a role that may
 * create databases. `AFLDB_TEST_PER_FILE_ADMIN_USER` and `AFLDB_TEST_PER_FILE_ADMIN_PASSWORD_FILE` name that role and
 * a file holding its password (the isolated cluster's `secrets/superuser.pw`). The password is read from the file
 * once per connection and is never placed in the environment, argv or a log line. The PATH is in the environment and
 * the file is readable by the same uid, so this keeps the password out of env dumps and logs; it is not a boundary
 * against code running as that uid. Before any create, drop, reap, sweep or audit statement the admin connection
 * asks the server for `inet_server_port()` and `current_database()` and refuses a port that is NULL, 5432 or not
 * the DSN's (REVIEW-D MED-1). Neither variable contains `DATABASE_URL`, which keeps `isolated-pg run` (it strips every `*DATABASE_URL*`
 * variable) from removing them. The admin connection goes to the same host and port as the base DSN, database
 * `postgres`; with neither variable set the base DSN's own role is used (this works only if that role has CREATEDB).
 *
 * CREATE. `CREATE DATABASE <name> OWNER <base owner> TEMPLATE <base>` cannot run while any other session is
 * connected to the base. Creation is serialised across processes with a session advisory lock keyed on the base
 * name, and a refusal for "being accessed by other users" (55006) is retried a bounded number of times with
 * back-off; the final error lists the sessions holding the base so the operator can see who. No session is ever
 * terminated on the base. The database comment is copied from the base (a template does not carry it), because
 * `tests/integration/guard.ts` in an isolated cluster requires the isolated-test marker on the DSN's database.
 *
 * DROP. Only a name this process generated and created (registry below) can be dropped, never the base, and
 * `WITH (FORCE)` ends the file's own pool connections. A crashed run leaves only prefix-named databases; the sweep
 * ({@link sweepStalePerFileDatabases}, CLI ./per-file-db-sweep.ts) removes those older than an age bound.
 *
 * RUN-LEVEL REAPER. A file in which every test is skipped never runs its `afterAll`, so the worker's own drop never
 * happens (found in the first full run: six fully-skipped files leaked six databases). Every database a worker creates
 * is therefore also recorded as a file in a ledger directory that the run's globalSetup
 * (./per-file-global-setup.ts) creates and hands to workers through AFLDB_TEST_PER_FILE_LEDGER; when the run ends the
 * globalSetup teardown drops what is still recorded ({@link reapLedgerDatabases}). It drops only ledger entries that
 * still satisfy the same droppable rule (generated shape, `_test`, not the base). A SIGKILLed run never reaches its
 * teardown and leaves only prefix-named databases for the sweep.
 *
 * AUDIT (optional, `AFLDB_TEST_PER_FILE_DB_AUDIT=<jsonl path>`). Before the drop, one line per file records the tables
 * in which a COMMITTED transaction left row versions newer than the database's creation (`xmin` at or above the xid
 * recorded at creation), with the net row count against the base. It is evidence of which suites commit state that
 * would otherwise reach the shared database; it does not affect pass or fail.
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type postgres from 'postgres';

import { databaseNameOf } from './dsn-policy';
import {
  assertAdminServerIdentity,
  assertPerFileAdminDsnAllowed,
  assertPerFileBaseAllowed,
  assertPerFileDroppable,
  perFileDatabaseName,
  perFilePrefixOf,
  selectStalePerFileDatabases,
} from './per-file-db-policy';

export const PER_FILE_ADMIN_USER_ENV = 'AFLDB_TEST_PER_FILE_ADMIN_USER';
export const PER_FILE_ADMIN_PASSWORD_FILE_ENV = 'AFLDB_TEST_PER_FILE_ADMIN_PASSWORD_FILE';
export const PER_FILE_AUDIT_ENV = 'AFLDB_TEST_PER_FILE_DB_AUDIT';
export const PER_FILE_STRATEGY_ENV = 'AFLDB_TEST_PER_FILE_DB_STRATEGY';
export const PER_FILE_LEDGER_ENV = 'AFLDB_TEST_PER_FILE_LEDGER';

type Env = Record<string, string | undefined>;
export type AdminSql = postgres.Sql;
export interface PerFileDeps {
  connect?: (dsn: string) => Promise<AdminSql>;
  now?: () => Date;
  pid?: number;
  randomHex?: () => string;
  sleep?: (ms: number) => Promise<void>;
}

/** Names created by THIS process; the only names {@link dropPerFileDatabase} will drop. */
const CREATED_BY_THIS_PROCESS = new Set<string>();
export function perFileDatabasesCreatedByThisProcess(): ReadonlySet<string> {
  return CREATED_BY_THIS_PROCESS;
}

export interface PerFileDatabase {
  readonly name: string;
  readonly baseName: string;
  readonly prefix: string;
  /** `txid_current()` taken right after creation; row versions with a newer xmin were written by the file. */
  readonly startXid: string;
  readonly createMs: number;
}

const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;
const defaultConnect = async (dsn: string): Promise<AdminSql> => {
  const { default: pg } = await import('postgres');
  return pg(dsn, { max: 1, connect_timeout: 10, onnotice: () => {} });
};
const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The DSN the admin connection uses: same host and port as the base, database `postgres`. */
export function adminDsnFor(baseDsn: string, env: Env, readPasswordFile: (path: string) => string = (p) => readFileSync(p, 'utf8')): string {
  const url = new URL(baseDsn);
  url.pathname = '/postgres';
  const user = env[PER_FILE_ADMIN_USER_ENV];
  const pwFile = env[PER_FILE_ADMIN_PASSWORD_FILE_ENV];
  if (user) url.username = user;
  if (pwFile) url.password = readPasswordFile(pwFile).replace(/[\r\n]+$/, '');
  const dsn = url.toString();
  assertPerFileAdminDsnAllowed(dsn);
  return dsn;
}

/**
 * Ask the SERVER which port and database this admin connection reached, and refuse unless that is what the DSN named
 * and is not 5432 (REVIEW-D MED-1). No DSN-string check can see a tunnel to DEV's 5432 or a multi-host fallback; the
 * server cannot be wrong about its own port. Run before the first create, drop, reap, sweep or audit statement.
 */
async function verifyAdminServer(admin: AdminSql, adminDsn: string): Promise<void> {
  const rows = await admin<{ port: number | null; db: string | null }[]>`SELECT inet_server_port() AS port, current_database()::text AS db`;
  const row = rows[0];
  assertAdminServerIdentity(
    { port: row ? row.port : null, database: row ? row.db : null },
    { port: new URL(adminDsn).port, database: 'postgres' },
  );
}

function strategyOf(env: Env): 'WAL_LOG' | 'FILE_COPY' {
  const v = (env[PER_FILE_STRATEGY_ENV] ?? 'wal_log').toLowerCase();
  if (v === 'wal_log') return 'WAL_LOG';
  if (v === 'file_copy') return 'FILE_COPY';
  throw new Error(`${PER_FILE_STRATEGY_ENV}=${JSON.stringify(env[PER_FILE_STRATEGY_ENV])} is not wal_log or file_copy.`);
}

const IN_USE = '55006';

/** Create a fresh database from the base DSN's database. Throws (creating nothing it cannot drop) on any refusal. */
export async function createPerFileDatabase(
  opts: { env: Env; baseDsn: string; maxAttempts?: number },
  deps: PerFileDeps = {},
): Promise<PerFileDatabase> {
  assertPerFileBaseAllowed(opts.baseDsn);
  const prefix = perFilePrefixOf(opts.env);
  const baseName = databaseNameOf(opts.baseDsn);
  const now = (deps.now ?? (() => new Date()))();
  const name = perFileDatabaseName({
    prefix,
    now,
    pid: deps.pid ?? process.pid,
    nonce: (deps.randomHex ?? (() => randomBytes(4).toString('hex')))(),
  });
  const strategy = strategyOf(opts.env);
  const sleep = deps.sleep ?? defaultSleep;
  const maxAttempts = opts.maxAttempts ?? 20;
  const adminDsn = adminDsnFor(opts.baseDsn, opts.env);
  const admin = await (deps.connect ?? defaultConnect)(adminDsn);
  const t0 = Date.now();
  let locked = false;
  try {
    await verifyAdminServer(admin, adminDsn);
    await admin`SELECT pg_advisory_lock(hashtext(${`afldb-per-file-db:${baseName}`}))`;
    locked = true;
    const [base] = await admin<{ owner: string; comment: string | null }[]>`
      SELECT pg_get_userbyid(datdba)::text AS owner, shobj_description(oid, 'pg_database') AS comment
        FROM pg_database WHERE datname = ${baseName}`;
    if (!base) throw new Error(`Per-file databases refused: base database ${baseName} does not exist.`);
    if (!SAFE_IDENT.test(base.owner)) throw new Error('Per-file databases refused: the base database owner is not a plain lowercase role name.');

    CREATED_BY_THIS_PROCESS.add(name);
    recordInLedger(opts.env, name, baseName);
    for (let attempt = 1; ; attempt++) {
      try {
        await admin.unsafe(`CREATE DATABASE "${name}" OWNER "${base.owner}" TEMPLATE "${baseName}" STRATEGY ${strategy}`);
        break;
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code !== IN_USE || attempt >= maxAttempts) {
          if (code === IN_USE) {
            const holders = await admin<{ pid: number; usename: string; application_name: string; state: string | null }[]>`
              SELECT pid, usename::text, application_name, state FROM pg_stat_activity WHERE datname = ${baseName}`;
            CREATED_BY_THIS_PROCESS.delete(name);
            forgetInLedger(opts.env, name);
            throw new Error(
              `Per-file database for ${baseName} could not be created after ${attempt} attempt(s): the base is in use by `
              + `${holders.map((h) => `pid ${h.pid} (${h.usename}, ${h.application_name || 'no application_name'}, ${h.state ?? 'no state'})`).join('; ') || 'another session'}. `
              + 'Nothing may be connected to the base while per-file mode copies it; stop that session or run in shared mode.',
            );
          }
          CREATED_BY_THIS_PROCESS.delete(name);
          forgetInLedger(opts.env, name);
          throw error;
        }
        await sleep(Math.min(500 * attempt, 3000));
      }
    }
    try {
      if (base.comment !== null) await admin.unsafe(`COMMENT ON DATABASE "${name}" IS '${base.comment.replace(/'/g, "''")}'`);
    } catch (error) {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      CREATED_BY_THIS_PROCESS.delete(name);
      forgetInLedger(opts.env, name);
      throw error;
    }
    const [{ xid }] = await admin<{ xid: string }[]>`SELECT txid_current()::text AS xid`;
    return { name, baseName, prefix, startXid: xid, createMs: Date.now() - t0 };
  } finally {
    try {
      if (locked) await admin`SELECT pg_advisory_unlock(hashtext(${`afldb-per-file-db:${baseName}`}))`;
    } finally {
      await admin.end({ timeout: 5 });
    }
  }
}

/** Drop a database this process created. Refuses every other name before any connection is opened. */
export async function dropPerFileDatabase(
  db: Pick<PerFileDatabase, 'name' | 'baseName' | 'prefix'>,
  opts: { env: Env; baseDsn: string },
  deps: PerFileDeps = {},
): Promise<void> {
  assertPerFileDroppable(db.name, { createdByThisProcess: CREATED_BY_THIS_PROCESS, baseName: databaseNameOf(opts.baseDsn), prefix: db.prefix });
  const adminDsn = adminDsnFor(opts.baseDsn, opts.env);
  const admin = await (deps.connect ?? defaultConnect)(adminDsn);
  try {
    await verifyAdminServer(admin, adminDsn);
    await admin.unsafe(`DROP DATABASE IF EXISTS "${db.name}" WITH (FORCE)`);
    CREATED_BY_THIS_PROCESS.delete(db.name);
    forgetInLedger(opts.env, db.name);
  } finally {
    await admin.end({ timeout: 5 });
  }
}

/** Record a created database in the run ledger, if the run has one. Best effort: the sweep covers a missing entry. */
function recordInLedger(env: Env, name: string, baseName: string): void {
  const dir = env[PER_FILE_LEDGER_ENV];
  if (dir && existsSync(dir)) writeFileSync(join(dir, name), baseName);
}

function forgetInLedger(env: Env, name: string): void {
  const dir = env[PER_FILE_LEDGER_ENV];
  if (!dir) return;
  try {
    unlinkSync(join(dir, name));
  } catch {
    // already gone
  }
}

/** The run's ledger directory (0700, created by the globalSetup in the main process). */
export function createPerFileLedger(): string {
  return mkdtempSync(join(tmpdir(), 'afldb-per-file-'));
}

/**
 * Run-level reaper: drop every database still recorded in the run's ledger. Each entry must still satisfy
 * {@link assertPerFileDroppable} (generated shape for the prefix, `_test`, not the DSN-named base) with the ledger
 * contents as the "generated by this run" set; anything else is skipped and reported, never dropped.
 */
export async function reapLedgerDatabases(
  opts: { env: Env; baseDsn: string; ledgerDir: string },
  deps: PerFileDeps = {},
): Promise<{ dropped: string[]; refused: { name: string; reason: string }[] }> {
  const dropped: string[] = [];
  const refused: { name: string; reason: string }[] = [];
  if (!existsSync(opts.ledgerDir)) return { dropped, refused };
  const prefix = perFilePrefixOf(opts.env);
  const baseName = databaseNameOf(opts.baseDsn);
  const recorded = readdirSync(opts.ledgerDir);
  if (recorded.length > 0) {
    const adminDsn = adminDsnFor(opts.baseDsn, opts.env);
    const admin = await (deps.connect ?? defaultConnect)(adminDsn);
    try {
      await verifyAdminServer(admin, adminDsn);
      const inLedger = new Set(recorded);
      for (const name of recorded) {
        try {
          assertPerFileDroppable(name, { createdByThisProcess: inLedger, baseName, prefix });
        } catch (error) {
          refused.push({ name, reason: (error as Error).message });
          continue;
        }
        await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
        dropped.push(name);
      }
    } finally {
      await admin.end({ timeout: 5 });
    }
  }
  rmSync(opts.ledgerDir, { recursive: true, force: true });
  return { dropped, refused };
}

export interface ResidueRow {
  table: string;
  /** Row versions written by a committed transaction after creation (inserts and update targets). */
  committedRowVersions: number;
  /** Rows now in the file's database minus rows in the base, for tables with any committed write or delete. */
  netRowDelta: number;
}

/**
 * Which tables did a committed transaction leave changed in the file's database? Terminates the file database's own
 * sessions first (so the statistics are flushed), then compares with the base. Read-only on both databases.
 */
export async function auditPerFileResidue(
  db: PerFileDatabase,
  opts: { env: Env; baseDsn: string; testPath: string; auditPath: string },
  deps: PerFileDeps = {},
): Promise<void> {
  const connect = deps.connect ?? defaultConnect;
  const sleep = deps.sleep ?? defaultSleep;
  const adminDsn = adminDsnFor(opts.baseDsn, opts.env);
  const withDb = (database: string): string => { const u = new URL(adminDsn); u.pathname = `/${database}`; return u.toString(); };
  const maint = await connect(adminDsn);
  let sizeBytes = 0;
  let clusterPerFileDatabases = 0;
  try {
    await verifyAdminServer(maint, adminDsn);
    await maint`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${db.name} AND pid <> pg_backend_pid()`;
    const [size] = await maint<{ bytes: string }[]>`SELECT pg_database_size(${db.name})::text AS bytes`;
    sizeBytes = Number(size.bytes);
    const [count] = await maint<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_database WHERE datname LIKE ${`${db.prefix}%`}`;
    clusterPerFileDatabases = count.n;
  } finally {
    await maint.end({ timeout: 5 });
  }
  await sleep(400);
  const x0 = (BigInt(db.startXid) % 4294967296n).toString();
  const fileSql = await connect(withDb(db.name));
  const residue: ResidueRow[] = [];
  const touchedOnly: string[] = [];
  try {
    const tables = await fileSql<{ schema: string; name: string; deleted: string }[]>`
      SELECT n.nspname::text AS schema, c.relname::text AS name, coalesce(s.n_tup_del, 0)::text AS deleted
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
       WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
       ORDER BY 1, 2`;
    const touched: { table: string; versions: number; total: number }[] = [];
    for (const t of tables) {
      const q = `"${t.schema}"."${t.name}"`;
      const [r] = await fileSql.unsafe<{ versions: number }[]>(`SELECT count(*)::int AS versions FROM ${q} WHERE xmin::text::bigint >= ${x0}`);
      if (r.versions > 0 || Number(t.deleted) > 0) {
        const [c] = await fileSql.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${q}`);
        touched.push({ table: `${t.schema}.${t.name}`, versions: r.versions, total: c.n });
      }
    }
    if (touched.length > 0) {
      const baseSql = await connect(withDb(db.baseName));
      try {
        for (const t of touched) {
          const [schema, name] = t.table.split('.');
          const [b] = await baseSql.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${schema}"."${name}"`);
          const netRowDelta = t.total - b.n;
          // A table written only by transactions that rolled back, or whose rows were restored exactly, shows
          // neither a newer committed row version nor a net change: it is touched, not residue.
          if (t.versions > 0 || netRowDelta !== 0) residue.push({ table: t.table, committedRowVersions: t.versions, netRowDelta });
          else touchedOnly.push(t.table);
        }
      } finally {
        await baseSql.end({ timeout: 5 });
      }
    }
  } finally {
    await fileSql.end({ timeout: 5 });
  }
  appendFileSync(opts.auditPath, `${JSON.stringify({
    file: opts.testPath.replace(/^.*\/tests\//, 'tests/'),
    database: db.name,
    createMs: db.createMs,
    sizeBytes,
    perFileDatabasesInCluster: clusterPerFileDatabases,
    residue,
    touchedOnly,
  })}\n`);
}

/**
 * Drop databases left by crashed runs: this prefix's generated shape, `_test`, older than `maxAgeMs` by the stamp in
 * the name, never the base, carrying the base's marker comment. `dryRun` lists without dropping. Returns what was
 * (or would be) dropped and what was kept with the reason.
 */
export async function sweepStalePerFileDatabases(
  opts: { env: Env; baseDsn: string; maxAgeMs: number; dryRun: boolean },
  deps: PerFileDeps = {},
): Promise<{ dropped: string[]; kept: { name: string; reason: string }[] }> {
  assertPerFileBaseAllowed(opts.baseDsn);
  const prefix = perFilePrefixOf(opts.env);
  const baseName = databaseNameOf(opts.baseDsn);
  const now = (deps.now ?? (() => new Date()))();
  const adminDsn = adminDsnFor(opts.baseDsn, opts.env);
  const admin = await (deps.connect ?? defaultConnect)(adminDsn);
  try {
    await verifyAdminServer(admin, adminDsn);
    const rows = await admin<{ name: string; comment: string | null }[]>`
      SELECT datname::text AS name, shobj_description(oid, 'pg_database') AS comment
        FROM pg_database WHERE NOT datistemplate AND datname LIKE ${`${prefix}%`}`;
    const [base] = await admin<{ comment: string | null }[]>`
      SELECT shobj_description(oid, 'pg_database') AS comment FROM pg_database WHERE datname = ${baseName}`;
    if (!base) throw new Error(`Sweep refused: base database ${baseName} does not exist.`);
    const { drop, kept } = selectStalePerFileDatabases(rows, { prefix, baseName, baseComment: base.comment, now, maxAgeMs: opts.maxAgeMs });
    if (!opts.dryRun) {
      for (const name of drop) await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
    return { dropped: drop, kept };
  } finally {
    await admin.end({ timeout: 5 });
  }
}
