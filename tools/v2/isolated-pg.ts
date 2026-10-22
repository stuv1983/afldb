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
import { appendFileSync, existsSync, mkdirSync, readFileSync, readlinkSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import { guardedListenerTool } from './rehearsal-package.mjs';
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

export interface ListenerOwner {
  address: string;
  pid: number;
  executablePath: string;
  commandLine: string;
}

/** No network access: bind the listener to this data directory's live postmaster. */
export function checkListenerOwnership(cfg: IsolatedConfig, postmaster: string, owners: readonly ListenerOwner[]): void {
  const lines = postmaster.trim().split(/\r?\n/);
  const samePath = (a: string, b: string) => process.platform === 'win32'
    ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);
  const pid = Number(lines[0]);
  const valid = Number.isInteger(pid) && pid > 0 && lines[1] && samePath(lines[1], dataDir(cfg))
    && Number(lines[3]) === cfg.port && owners.length > 0 && owners.every((owner) => {
      const args = (owner.commandLine.match(/"[^"]*"|\S+/g) ?? []).map((arg) => arg.replace(/^"|"$/g, ''));
      const dataIndex = args.indexOf('-D');
      const data = dataIndex >= 0 ? args[dataIndex + 1] : args.find((arg) => arg.startsWith('--pgdata='))?.slice(9);
      return owner.address === '127.0.0.1' && owner.pid === pid
        && samePath(owner.executablePath, exe(cfg, 'postgres')) && data && samePath(data, dataDir(cfg));
    });
  if (!valid) throw new Error(`refused: local listener on port ${cfg.port} is not this isolated postmaster; no database credentials sent`);
}

/** Process facts behind the listener check; the defaults are the real process. Overridable for tests only. */
export interface ListenerProbe {
  platform: NodeJS.Platform;
  spawn: typeof spawnSync;
  readlink: typeof readlinkSync;
  readFile: typeof readFileSync;
  /** Absolute listener tool of a rehearsal-guarded process (verified against launch provenance), else undefined. */
  guardedTool: () => string | undefined;
}

export function assertLocalListener(cfg: IsolatedConfig, override: Partial<ListenerProbe> = {}): void {
  if (!Number.isInteger(cfg.port) || cfg.port < 1024 || cfg.port > 65535) throw new Error('refused: invalid isolated listener port');
  const probe: ListenerProbe = { platform: process.platform, spawn: spawnSync, readlink: readlinkSync, readFile: readFileSync,
    guardedTool: () => guardedListenerTool(), ...override };
  let owners: ListenerOwner[];
  try {
    // Guarded rehearsal: the verified, content-bound absolute tool or a refusal, never a PATH lookup.
    const guardedTool = probe.guardedTool();
    if (probe.platform === 'win32') {
      const script = `$ErrorActionPreference='Stop'; $owners=@(Get-NetTCPConnection -LocalPort ${cfg.port} -State Listen | ForEach-Object { `
        + `$p=Get-CimInstance Win32_Process -Filter ("ProcessId="+$_.OwningProcess); `
        + `[pscustomobject]@{address=$_.LocalAddress;pid=[int]$p.ProcessId;executablePath=$p.ExecutablePath;commandLine=$p.CommandLine} }); `
        + `ConvertTo-Json -InputObject $owners -Compress`;
      const result = probe.spawn(guardedTool ?? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
      if (result.status !== 0) throw new Error('listener inspection failed');
      owners = JSON.parse(String(result.stdout).trim()) as ListenerOwner[];
    } else if (probe.platform === 'linux') {
      const result = probe.spawn(guardedTool ?? 'ss', ['-H', '-ltnp', `sport = :${cfg.port}`], { encoding: 'utf8', timeout: 10_000 });
      if (result.status !== 0) throw new Error('listener inspection failed');
      owners = String(result.stdout).trim().split('\n').filter(Boolean).flatMap((line) => {
        const address = line.trim().split(/\s+/)[3]?.replace(/:\d+$/, '');
        const pids = [...line.matchAll(/pid=(\d+)/g)].map((match) => Number(match[1]));
        if (!address || pids.length === 0) throw new Error('listener owner unavailable');
        return pids.map((pid) => ({ address, pid, executablePath: probe.readlink(`/proc/${pid}/exe`),
          commandLine: String(probe.readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean).map((arg) => `"${arg}"`).join(' ') }));
      });
    } else throw new Error('unsupported OS');
    checkListenerOwnership(cfg, String(probe.readFile(join(dataDir(cfg), 'postmaster.pid'), 'utf8')), owners);
  } catch {
    // Never include captured process arguments: an unexpected process may hold secrets.
    throw new Error(`refused: cannot prove ownership of local port ${cfg.port} by this isolated postmaster; no database credentials sent`);
  }
}

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
  assertLocalListener(cfg);
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
    // TCP-only launcher: distro defaults may require a root-owned Unix socket directory.
    "unix_socket_directories = ''",
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

/** Rotate only this dedicated cluster. Never log a query, password or connection URL. */
async function rotateCredentials(cfg: IsolatedConfig): Promise<void> {
  const oldRoles = rolePasswords(cfg);
  const oldSuper = readSecret(cfg, 'superuser.pw');
  const nextRoles = Object.fromEntries(AFLDB_ROLES.map((r) => [r, randomBytes(32).toString('base64url')])) as Record<Role, string>;
  const nextSuper = randomBytes(32).toString('base64url');
  const pending = join(secretsDir(cfg), 'rotation-pending.json');
  if (existsSync(pending)) throw new Error('Unfinished credential rotation: recover from secrets/rotation-pending.json before retrying');
  const sql = superSql(cfg);
  try {
    const [facts] = await sql`SELECT current_setting('cluster_name') AS cluster,
      host(inet_server_addr()) AS address, inet_server_port() AS port`;
    console.log(`rotation target: cluster=${facts.cluster}; address=${facts.address}; port=${facts.port}`);
    if (facts.cluster !== ISOLATED_CLUSTER_NAME || facts.address !== '127.0.0.1' || Number(facts.port) !== cfg.port) {
      throw new Error('Credential rotation refused: not the dedicated loopback cluster');
    }
    // Durable recovery material before the transaction; removed only after both secret files land.
    writeFileSync(pending, JSON.stringify({ roles: nextRoles, superuser: nextSuper }), { mode: 0o600, flag: 'wx' });
    await sql.begin(async (tx) => {
      for (const role of AFLDB_ROLES) await tx.unsafe(`ALTER ROLE ${role} PASSWORD '${nextRoles[role]}'`);
      await tx.unsafe(`ALTER ROLE ${SUPERUSER} PASSWORD '${nextSuper}'`);
    });
    const replaceSecret = (name: string, value: string) => {
      const temporary = join(secretsDir(cfg), `${name}.next`);
      writeFileSync(temporary, value, { mode: 0o600, flag: 'wx' });
      renameSync(temporary, join(secretsDir(cfg), name));
    };
    replaceSecret('roles.json', `${JSON.stringify(nextRoles, null, 2)}\n`);
    replaceSecret('superuser.pw', nextSuper);
    for (const role of [...AFLDB_ROLES, SUPERUSER]) {
      const next = role === SUPERUSER ? nextSuper : nextRoles[role as Role];
      const old = role === SUPERUSER ? oldSuper : oldRoles[role as Role];
      const fresh = postgres(dsnFor(cfg, role, next, 'postgres'), { max: 1, connect_timeout: 5 });
      try { await fresh`SELECT 1`; } finally { await fresh.end({ timeout: 5 }); }
      const stale = postgres(dsnFor(cfg, role, old, 'postgres'), { max: 1, connect_timeout: 5 });
      let rejected = false;
      try { await stale`SELECT 1`; } catch (error) {
        rejected = (error as { code?: string }).code === '28P01';
      } finally { await stale.end({ timeout: 5 }); }
      if (!rejected) throw new Error(`Old credential rejection not proven for ${role}`);
      console.log(`rotation: ${role}: new login PASS; old login rejected (28P01)`);
    }
    // Recovery file contains the same new secrets, never the old passwords.
    const { unlinkSync } = await import('node:fs');
    unlinkSync(pending);
    console.log('rotation: six credentials rotated; databases and audit history preserved');
  } catch (error) {
    const code = (error as { code?: string }).code;
    throw new Error(`Credential rotation failed (${code ?? 'guard or verification'}); inspect local secret recovery state without printing its contents`);
  } finally { await sql.end({ timeout: 5 }); }
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
  assertLocalListener(cfg);
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
  if (['roles', 'rotate-credentials', 'create-db', 'drop-db', 'list', 'verify', 'run'].includes(mode)) assertLocalListener(cfg);
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
    case 'rotate-credentials': await rotateCredentials(cfg); return 0;
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
