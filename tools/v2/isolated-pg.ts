/**
 * AFLDB V2 Launch F — the ISOLATED LOCAL POSTGRESQL environment (provision, guard, run).
 *
 *   npx tsx tools/v2/isolated-pg.ts init                 initdb + loopback config (idempotent)
 *   npx tsx tools/v2/isolated-pg.ts start | stop | status
 *   npx tsx tools/v2/isolated-pg.ts roles                the five AFLDB roles, generated passwords
 *   npx tsx tools/v2/isolated-pg.ts create-db <name> [--template <name>]
 *   npx tsx tools/v2/isolated-pg.ts drop-db <name> --acknowledge-destroy <name>
 *   npx tsx tools/v2/isolated-pg.ts list
 *   npx tsx tools/v2/isolated-pg.ts verify <name>        both guards, prints the facts
 *   npx tsx tools/v2/isolated-pg.ts run <name> -- <command> [args...]
 *
 * Configuration (environment): AFLDB_V2_PG_ROOT (required; a directory OUTSIDE the repository
 * holding `data/`, `secrets/`, `logs/`), AFLDB_V2_PG_BIN (default `<root>/dist/pgsql/bin`),
 * AFLDB_V2_PG_PORT (default 55432).
 *
 * What makes it isolated, each an independent guard (policy: @afldb/domain isolated-test-target):
 *   - the cluster listens on 127.0.0.1 only, accepts SCRAM passwords over loopback TCP only,
 *     and is named `afldb_v2_isolated`;
 *   - roles and passwords are generated here and stored only under `<root>/secrets/`;
 *   - a database is created here only under an `afldb_v2_*_test` name and is marked with a
 *     database comment; `drop-db` refuses an unmarked database, so nothing this tool did not
 *     create can be destroyed by it;
 *   - `run` verifies the DSN (loopback, port, name) and the server (cluster name, marker,
 *     current database) before spawning, refuses when the repository holds a `.env` file, and
 *     spawns the command with `shell: false` and an environment whose every DSN variable names
 *     the verified database; `AFLDB_V2_ISOLATED_PG=1` makes tests/integration/guard.ts repeat
 *     the server check inside the test process.
 *
 * It never prints a password or a DSN. It makes no network connection other than to
 * 127.0.0.1:<port>.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import {
  ISOLATED_CLUSTER_NAME,
  ISOLATED_DATABASE_MARKER,
  ISOLATED_DATABASE_NAME_PATTERN,
  ISOLATED_SERVER_FACTS_SQL,
  checkIsolatedTestDsn,
  checkIsolatedTestServer,
  type IsolatedTargetFinding,
} from '@afldb/domain';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SUPERUSER = 'afldb_v2_super';
export const AFLDB_ROLES = ['afldb_owner', 'afldb_app', 'afldb_import', 'afldb_backup', 'afldb_auth'] as const;
type Role = (typeof AFLDB_ROLES)[number];
const CONFIG_MARKER = '# ---- AFLDB V2 isolated test cluster';

export interface IsolatedConfig {
  readonly root: string;
  readonly bin: string;
  readonly port: number;
}

export function resolveConfig(env: Readonly<Record<string, string | undefined>>): IsolatedConfig {
  const rootRaw = env.AFLDB_V2_PG_ROOT;
  if (!rootRaw) throw new Error('AFLDB_V2_PG_ROOT must name the isolated cluster directory (outside the repository)');
  const root = resolve(rootRaw);
  const rel = relative(REPO_ROOT, root);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    throw new Error('AFLDB_V2_PG_ROOT must be outside the repository (secrets and data never live in the checkout)');
  }
  const port = env.AFLDB_V2_PG_PORT ? Number(env.AFLDB_V2_PG_PORT) : 55432;
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 5432) {
    throw new Error('AFLDB_V2_PG_PORT must be an unprivileged port other than 5432');
  }
  return { root, bin: env.AFLDB_V2_PG_BIN ? resolve(env.AFLDB_V2_PG_BIN) : join(root, 'dist', 'pgsql', 'bin'), port };
}

const exe = (cfg: IsolatedConfig, name: string) => join(cfg.bin, process.platform === 'win32' ? `${name}.exe` : name);
const dataDir = (cfg: IsolatedConfig) => join(cfg.root, 'data');
const secretsDir = (cfg: IsolatedConfig) => join(cfg.root, 'secrets');

function readSecret(cfg: IsolatedConfig, file: string): string {
  return readFileSync(join(secretsDir(cfg), file), 'utf8').trim();
}

function rolePasswords(cfg: IsolatedConfig): Record<Role, string> {
  const file = join(secretsDir(cfg), 'roles.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as Record<Role, string>;
  const generated = Object.fromEntries(AFLDB_ROLES.map((r) => [r, randomBytes(24).toString('base64url')])) as Record<Role, string>;
  writeFileSync(file, `${JSON.stringify(generated, null, 2)}\n`, { mode: 0o600 });
  return generated;
}

export function dsnFor(cfg: IsolatedConfig, user: string, password: string, database: string): string {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${cfg.port}/${database}`;
}

function superSql(cfg: IsolatedConfig, database = 'postgres') {
  return postgres(dsnFor(cfg, SUPERUSER, readSecret(cfg, 'superuser.pw'), database), { max: 1, onnotice: () => {}, connect_timeout: 5 });
}

function runPg(cfg: IsolatedConfig, name: string, args: readonly string[]): number {
  const r = spawnSync(exe(cfg, name), args, { stdio: 'inherit', shell: false });
  return r.status ?? 1;
}

export function assertCreatableName(name: string): void {
  if (!ISOLATED_DATABASE_NAME_PATTERN.test(name)) {
    throw new Error(`refused: ${name} is not an afldb_v2_*_test name`);
  }
}

function init(cfg: IsolatedConfig): void {
  mkdirSync(secretsDir(cfg), { recursive: true });
  mkdirSync(join(cfg.root, 'logs'), { recursive: true });
  const conf = join(dataDir(cfg), 'postgresql.conf');
  if (existsSync(conf)) {
    if (!readFileSync(conf, 'utf8').includes(CONFIG_MARKER)) {
      throw new Error('refused: the data directory exists but is not an AFLDB V2 isolated cluster');
    }
    console.log('init: cluster already initialised');
    return;
  }
  const pwFile = join(secretsDir(cfg), 'superuser.pw');
  if (!existsSync(pwFile)) writeFileSync(pwFile, randomBytes(24).toString('base64url'), { mode: 0o600 });
  const status = runPg(cfg, 'initdb', ['-D', dataDir(cfg), '-U', SUPERUSER, `--pwfile=${pwFile}`, '--auth=scram-sha-256',
    '--encoding=UTF8', '--locale=C', '--no-instructions']);
  if (status !== 0) throw new Error(`initdb exited ${status}`);
  appendFileSync(conf, [
    '',
    `${CONFIG_MARKER} (tools/v2/isolated-pg.ts). Loopback only; never a shared or live host.`,
    "listen_addresses = '127.0.0.1'",
    `port = ${cfg.port}`,
    `cluster_name = '${ISOLATED_CLUSTER_NAME}'`,
    "timezone = 'Etc/UTC'",
    "log_timezone = 'Etc/UTC'",
    'max_connections = 300',
    'shared_buffers = 1GB',
    'work_mem = 32MB',
    'maintenance_work_mem = 512MB',
    'logging_collector = on',
    "log_directory = 'log'",
    'log_min_messages = warning',
    '',
  ].join('\n'));
  writeFileSync(join(dataDir(cfg), 'pg_hba.conf'), [
    '# AFLDB V2 isolated test cluster: TCP loopback only, password (SCRAM) only.',
    'host    all       all   127.0.0.1/32   scram-sha-256',
    '',
  ].join('\n'));
  console.log('init: cluster initialised');
}

async function ensureRoles(cfg: IsolatedConfig): Promise<void> {
  const pw = rolePasswords(cfg);
  const sql = superSql(cfg);
  try {
    for (const role of AFLDB_ROLES) {
      const [exists] = await sql`SELECT 1 FROM pg_roles WHERE rolname = ${role}`;
      if (!exists) await sql.unsafe(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB`);
      await sql.unsafe(`ALTER ROLE ${role} WITH PASSWORD '${pw[role].replace(/'/g, "''")}'`);
    }
    await sql.unsafe('GRANT pg_read_all_data TO afldb_backup');
    console.log(`roles: ${AFLDB_ROLES.join(', ')} present`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** The per-database bootstrap of tools/maintenance/00_install_postgres.sh step [4/5]. */
const DATABASE_BOOTSTRAP_SQL = `
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
ALTER SCHEMA public OWNER TO afldb_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT  USAGE  ON SCHEMA public TO afldb_app, afldb_import, afldb_backup, afldb_auth;
GRANT  CREATE ON SCHEMA public TO afldb_owner;
ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA public REVOKE SELECT ON TABLES FROM afldb_app;
ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM afldb_import;
ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA public REVOKE USAGE, SELECT, UPDATE ON SEQUENCES FROM afldb_import;
`;

async function createDb(cfg: IsolatedConfig, name: string, template: string | null): Promise<void> {
  assertCreatableName(name);
  if (template !== null) assertCreatableName(template);
  const sql = superSql(cfg);
  try {
    const [exists] = await sql`SELECT 1 FROM pg_database WHERE datname = ${name}`;
    if (exists) throw new Error(`refused: ${name} already exists`);
    if (template !== null) {
      const [t] = await sql`SELECT shobj_description(oid, 'pg_database') AS c FROM pg_database WHERE datname = ${template}`;
      if (!t || t.c !== ISOLATED_DATABASE_MARKER) throw new Error(`refused: template ${template} is not a marked isolated database`);
      await sql.unsafe(`CREATE DATABASE ${name} OWNER afldb_owner TEMPLATE ${template}`);
    } else {
      await sql.unsafe(`CREATE DATABASE ${name} OWNER afldb_owner`);
    }
    await sql.unsafe(`COMMENT ON DATABASE ${name} IS '${ISOLATED_DATABASE_MARKER}'`);
  } finally {
    await sql.end({ timeout: 5 });
  }
  if (template === null) {
    const db = superSql(cfg, name);
    try {
      await db.unsafe(DATABASE_BOOTSTRAP_SQL);
    } finally {
      await db.end({ timeout: 5 });
    }
  }
  console.log(`create-db: ${name} created${template ? ` from ${template}` : ''} and marked`);
}

async function dropDb(cfg: IsolatedConfig, name: string, ack: string | null): Promise<void> {
  assertCreatableName(name);
  if (ack !== name) throw new Error(`refused: drop-db needs --acknowledge-destroy ${name}`);
  const sql = superSql(cfg);
  try {
    const [row] = await sql`SELECT shobj_description(oid, 'pg_database') AS c FROM pg_database WHERE datname = ${name}`;
    if (!row) throw new Error(`refused: ${name} does not exist`);
    if (row.c !== ISOLATED_DATABASE_MARKER) throw new Error(`refused: ${name} is not marked as created by this tool`);
    await sql.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
  } finally {
    await sql.end({ timeout: 5 });
  }
  console.log(`drop-db: ${name} dropped`);
}

async function list(cfg: IsolatedConfig): Promise<void> {
  const sql = superSql(cfg);
  try {
    const rows = await sql`SELECT datname, shobj_description(oid, 'pg_database') AS c, pg_database_size(oid) AS bytes
                             FROM pg_database WHERE NOT datistemplate ORDER BY datname`;
    for (const r of rows) console.log(`${r.datname}\t${r.c === ISOLATED_DATABASE_MARKER ? 'marked' : 'unmarked'}\t${r.bytes}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** The DSN variables a command run against `<name>` receives; all name the same database. */
export function environmentFor(cfg: IsolatedConfig, name: string, pw: Record<Role, string>): Record<string, string> {
  const owner = dsnFor(cfg, 'afldb_owner', pw.afldb_owner, name);
  const app = dsnFor(cfg, 'afldb_app', pw.afldb_app, name);
  const imp = dsnFor(cfg, 'afldb_import', pw.afldb_import, name);
  const auth = dsnFor(cfg, 'afldb_auth', pw.afldb_auth, name);
  return {
    AFLDB_TEST_DATABASE_URL: owner,
    AFLDB_TEST_IMPORT_DATABASE_URL: imp,
    AFLDB_TEST_AUTH_DATABASE_URL: auth,
    DATABASE_URL: app,
    AFLDB_IMPORT_DATABASE_URL: imp,
    AFLDB_AUTH_DATABASE_URL: auth,
    AFLDB_OWNER_DATABASE_URL: owner,
    AFLDB_BACKUP_DATABASE_URL: dsnFor(cfg, 'afldb_backup', pw.afldb_backup, name),
    AFLDB_V2_ISOLATED_PG: '1',
    AFLDB_V2_ISOLATED_PORT: String(cfg.port),
  };
}

export async function verifyTarget(cfg: IsolatedConfig, name: string): Promise<IsolatedTargetFinding[]> {
  const pw = rolePasswords(cfg);
  const dsn = dsnFor(cfg, 'afldb_owner', pw.afldb_owner, name);
  const findings = checkIsolatedTestDsn(dsn, cfg.port);
  if (findings.length) return findings;
  const sql = postgres(dsn, { max: 1, connect_timeout: 5, onnotice: () => {} });
  try {
    const [row] = await sql.unsafe(ISOLATED_SERVER_FACTS_SQL);
    return checkIsolatedTestServer(name, {
      clusterName: row?.cluster_name ?? null,
      databaseComment: row?.database_comment ?? null,
      currentDatabase: row?.current_database ?? null,
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function forbiddenEnvFiles(): string[] {
  return readdirSync(REPO_ROOT).filter((n) => n.startsWith('.env') && n !== '.env.example');
}

async function runCommand(cfg: IsolatedConfig, name: string, command: readonly string[]): Promise<number> {
  if (command.length === 0) throw new Error('run needs a command after --');
  const envFiles = forbiddenEnvFiles();
  if (envFiles.length) throw new Error(`refused: the repository holds ${envFiles.join(', ')}; tools would read DSNs from it`);
  const findings = await verifyTarget(cfg, name);
  if (findings.length) {
    for (const f of findings) console.error(`refused: ${f.check}: ${f.detail}`);
    return 2;
  }
  const base: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(base)) {
    if (/DATABASE_URL/.test(key) || /^PG/.test(key)) delete base[key];
  }
  const pathKey = Object.keys(base).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  // The isolated cluster's own client binaries (psql, pg_dump, pg_restore) come first on PATH.
  base[pathKey] = `${cfg.bin}${process.platform === 'win32' ? ';' : ':'}${base[pathKey] ?? ''}`;
  const env = { ...base, ...environmentFor(cfg, name, rolePasswords(cfg)) };
  console.error(`isolated-pg: ${name} verified (cluster ${ISOLATED_CLUSTER_NAME}, 127.0.0.1:${cfg.port}); running ${command[0]}`);
  const [cmd, ...args] = command;
  // No shell: on Windows run Node entry points directly (`node node_modules/vitest/vitest.mjs ...`).
  const r = spawnSync(cmd, args, { stdio: 'inherit', env, shell: false });
  return r.status ?? 1;
}

export async function main(argv: readonly string[]): Promise<number> {
  const cfg = resolveConfig(process.env);
  const [mode, ...rest] = argv;
  const opt = (flag: string): string | null => {
    const i = rest.indexOf(flag);
    return i >= 0 && rest[i + 1] !== undefined ? rest[i + 1] : null;
  };
  switch (mode) {
    case 'init': init(cfg); return 0;
    case 'start': return runPg(cfg, 'pg_ctl', ['-D', dataDir(cfg), '-l', join(cfg.root, 'logs', 'server.log'), '-w', 'start']);
    case 'stop': return runPg(cfg, 'pg_ctl', ['-D', dataDir(cfg), '-w', '-m', 'fast', 'stop']);
    case 'status': return runPg(cfg, 'pg_ctl', ['-D', dataDir(cfg), 'status']);
    case 'roles': await ensureRoles(cfg); return 0;
    case 'create-db': await createDb(cfg, rest[0], opt('--template')); return 0;
    case 'drop-db': await dropDb(cfg, rest[0], opt('--acknowledge-destroy')); return 0;
    case 'list': await list(cfg); return 0;
    case 'verify': {
      const findings = await verifyTarget(cfg, rest[0]);
      for (const f of findings) console.error(`refused: ${f.check}: ${f.detail}`);
      if (!findings.length) console.log(`ISOLATED TARGET OK: ${rest[0]}`);
      return findings.length ? 2 : 0;
    }
    case 'run': {
      const sep = rest.indexOf('--');
      if (sep !== 1) throw new Error('usage: run <name> -- <command> [args...]');
      return runCommand(cfg, rest[0], rest.slice(2));
    }
    default:
      throw new Error('usage: isolated-pg.ts init|start|stop|status|roles|create-db|drop-db|list|verify|run');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (err: unknown) => { console.error(err instanceof Error ? err.message : String(err)); process.exitCode = 2; },
  );
}
