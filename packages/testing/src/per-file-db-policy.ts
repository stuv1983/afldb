/**
 * @afldb/testing — AFLDB-ISSUE-363 owner decision (1): the pure policy for per-file disposable test databases.
 *
 * WHY. Some integration suites cannot run inside a rolled-back transaction, so they COMMIT fixtures and remove
 * them in `afterAll`. A process killed (or timed out) before `afterAll` leaves those rows in the one shared test
 * database, and every later suite that reads the whole table fails with a number that explains nothing. A
 * fail-fast message (tests/integration/leaked-fixtures.ts) names the leak; it cannot prevent it. Per-file mode
 * prevents it: each integration file runs against its own copy of the base database
 * (`CREATE DATABASE … TEMPLATE <base>`), dropped when the file ends, so a leak dies with the file.
 *
 * THIS FILE IS PURE: no environment, file system or database access. Everything that decides whether the mode may
 * run, which names it may create and which names it may drop lives here so each refusal is unit-tested on plain
 * values (tests/dsn-policy.test.ts). The effectful half is ./per-file-db.ts.
 *
 * SAFETY RULES (each has a refusal below):
 *   - opt-in only: AFLDB_TEST_PER_FILE_DB unset / `0` / empty means OFF and nothing here runs;
 *   - the base DSN must parse, name a database ending `_test`, and not be port 5432 (DEV's PostgreSQL) — a missing
 *     port means the default 5432 and is refused;
 *   - generated names are `<prefix><yyyymmddHHMMSS>_<pid>_<nonce>_test`; the prefix must match
 *     {@link PER_FILE_PREFIX_PATTERN} so a sweep can only ever match databases of this shape;
 *   - a name may be dropped only if THIS process generated it (a registry the caller passes in), it still
 *     matches the generated shape, and it is not the base. The base named by the DSN is never droppable.
 */

import { databaseNameOf, namesTestDatabase } from './dsn-policy';

export const PER_FILE_DB_ENV = 'AFLDB_TEST_PER_FILE_DB';
export const PER_FILE_PREFIX_ENV = 'AFLDB_TEST_PER_FILE_DB_PREFIX';
export const DEFAULT_PER_FILE_PREFIX = 'afldb_v2_pf_';
/** `afldb_v2_` + 1..12 lowercase alphanumerics + `_`. The isolated-target name pattern (@afldb/domain) still matches the result. */
export const PER_FILE_PREFIX_PATTERN = /^afldb_v2_[a-z0-9]{1,12}_$/;
/** Never created or dropped by this mode: DEV's PostgreSQL port. */
export const FORBIDDEN_PORT = '5432';
/** A sweep refuses anything younger than this, so it can never reap a database a live run is still using. */
export const MIN_SWEEP_AGE_MS = 60 * 60 * 1000;
export const DEFAULT_SWEEP_AGE_MS = 6 * 60 * 60 * 1000;

export type PerFileMode = 'off' | 'registered' | 'all';

/**
 * `unset`, empty, `0`, `false`, `off` -> off. `1`, `true`, `on`, `registered` -> only the suites in the committed-fixture
 * registry (tests/integration/leaked-fixtures.ts). `all` -> every integration file. Anything else throws: a typo
 * must not silently run the shared-database mode.
 */
export function perFileModeOf(value: string | undefined): PerFileMode {
  const v = (value ?? '').trim().toLowerCase();
  if (v === '' || v === '0' || v === 'false' || v === 'off') return 'off';
  if (v === '1' || v === 'true' || v === 'on' || v === 'registered') return 'registered';
  if (v === 'all') return 'all';
  throw new Error(
    `${PER_FILE_DB_ENV}=${JSON.stringify(value)} is not recognised. Use unset/0 (off), 1 (the committed-fixture suites) or all (every integration file).`,
  );
}

export interface PerFileFinding {
  readonly check: string;
  readonly detail: string;
}

/** Why per-file mode may not run against this base DSN. Empty means allowed. Names checks only, never credentials. */
export function checkPerFileBase(baseDsn: string | undefined): PerFileFinding[] {
  if (!baseDsn) return [{ check: 'base_dsn', detail: 'AFLDB_TEST_DATABASE_URL is not set' }];
  let url: URL;
  try {
    url = new URL(baseDsn);
  } catch {
    return [{ check: 'base_dsn', detail: 'AFLDB_TEST_DATABASE_URL is not a URL' }];
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    return [{ check: 'base_dsn', detail: 'AFLDB_TEST_DATABASE_URL is not a postgres:// or postgresql:// URL' }];
  }
  const findings: PerFileFinding[] = [];
  if (!namesTestDatabase(baseDsn)) {
    findings.push({ check: 'base_name', detail: `base database ${JSON.stringify(databaseNameOf(baseDsn))} does not end in _test` });
  }
  if (url.port === '' || url.port === FORBIDDEN_PORT) {
    findings.push({ check: 'port', detail: `port ${url.port === '' ? '(default 5432)' : url.port} is DEV's PostgreSQL port; per-file databases are never created there` });
  }
  for (const key of ['service', 'host', 'hostaddr', 'port', 'dbname']) {
    if (url.searchParams.has(key)) findings.push({ check: 'libpq_redirect', detail: `query parameter ${key} can redirect the connection` });
  }
  return findings;
}

export function assertPerFileBaseAllowed(baseDsn: string | undefined): void {
  const findings = checkPerFileBase(baseDsn);
  if (findings.length > 0) {
    throw new Error(
      'Per-file test databases refused: ' + findings.map((f) => `${f.check} (${f.detail})`).join('; ')
      + `. Unset ${PER_FILE_DB_ENV} to run against the shared database.`,
    );
  }
}

export function assertPerFilePrefix(prefix: string): string {
  if (!PER_FILE_PREFIX_PATTERN.test(prefix)) {
    throw new Error(
      `Per-file database prefix ${JSON.stringify(prefix)} refused: it must match ${PER_FILE_PREFIX_PATTERN} `
      + `(for example ${DEFAULT_PER_FILE_PREFIX}).`,
    );
  }
  return prefix;
}

export function perFilePrefixOf(env: Record<string, string | undefined>): string {
  return assertPerFilePrefix(env[PER_FILE_PREFIX_ENV] || DEFAULT_PER_FILE_PREFIX);
}

const pad = (n: number, width: number): string => String(n).padStart(width, '0');
const stamp = (d: Date): string =>
  `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1, 2)}${pad(d.getUTCDate(), 2)}`
  + `${pad(d.getUTCHours(), 2)}${pad(d.getUTCMinutes(), 2)}${pad(d.getUTCSeconds(), 2)}`;

/** The name pattern for a prefix: capture 1 = UTC creation stamp, 2 = pid, 3 = nonce. */
function namePattern(prefix: string): RegExp {
  return new RegExp(`^${prefix}(\\d{14})_(\\d{1,10})_([a-f0-9]{8})_test$`);
}

export interface GeneratedNameInput {
  readonly prefix: string;
  readonly now: Date;
  readonly pid: number;
  /** 8 lowercase hex digits; the caller supplies randomness so this stays pure. */
  readonly nonce: string;
}

/** `<prefix><yyyymmddHHMMSS>_<pid>_<nonce>_test`. Throws on a malformed prefix, pid or nonce. */
export function perFileDatabaseName(input: GeneratedNameInput): string {
  assertPerFilePrefix(input.prefix);
  if (!Number.isInteger(input.pid) || input.pid < 1 || input.pid > 9_999_999_999) throw new Error('pid out of range for a per-file database name');
  if (!/^[a-f0-9]{8}$/.test(input.nonce)) throw new Error('nonce must be 8 lowercase hex digits');
  const name = `${input.prefix}${stamp(input.now)}_${input.pid}_${input.nonce}_test`;
  if (name.length > 63) throw new Error(`generated name ${name} exceeds PostgreSQL's 63-byte identifier limit`);
  return name;
}

export interface ParsedPerFileName {
  readonly createdAt: Date;
  readonly pid: number;
  readonly nonce: string;
}

/** The parts of a generated name, or null when the name is not of this prefix's generated shape. */
export function parsePerFileDatabaseName(name: string, prefix: string): ParsedPerFileName | null {
  assertPerFilePrefix(prefix);
  const m = namePattern(prefix).exec(name);
  if (!m) return null;
  const s = m[1];
  const createdAt = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14)));
  if (Number.isNaN(createdAt.getTime()) || stamp(createdAt) !== s) return null;
  return { createdAt, pid: Number(m[2]), nonce: m[3] };
}

/**
 * Throws unless `name` may be dropped by THIS process: it must be in `createdByThisProcess` (the names this process
 * generated and created), still be of the generated shape for `prefix`, end `_test`, and differ from the DSN-named
 * base. Each condition alone is enough to refuse.
 */
export function assertPerFileDroppable(
  name: string,
  opts: { createdByThisProcess: ReadonlySet<string>; baseName: string; prefix: string },
): void {
  assertPerFilePrefix(opts.prefix);
  if (name === opts.baseName) throw new Error(`Refusing to drop ${name}: it is the base database named by the DSN.`);
  if (!name.endsWith('_test')) throw new Error(`Refusing to drop ${name}: it does not end in _test.`);
  if (parsePerFileDatabaseName(name, opts.prefix) === null) {
    throw new Error(`Refusing to drop ${name}: it is not a per-file database name for prefix ${opts.prefix}.`);
  }
  if (!opts.createdByThisProcess.has(name)) {
    throw new Error(`Refusing to drop ${name}: this process did not generate it. Use the sweep for databases left by a crashed run.`);
  }
}

export interface SweepCandidate {
  readonly name: string;
  /** The database comment; a sweep in an isolated cluster only reaps databases carrying the base's marker. */
  readonly comment: string | null;
}

/**
 * Names a sweep may drop: generated shape for `prefix`, `_test`, at least `maxAgeMs` old by the stamp in the name
 * (and never younger than {@link MIN_SWEEP_AGE_MS}), not the base, and — when the base carries a marker comment —
 * carrying the same marker. Anything that does not satisfy every condition is returned in `kept` with the reason.
 */
export function selectStalePerFileDatabases(
  candidates: readonly SweepCandidate[],
  opts: { prefix: string; baseName: string; baseComment: string | null; now: Date; maxAgeMs: number },
): { drop: string[]; kept: { name: string; reason: string }[] } {
  assertPerFilePrefix(opts.prefix);
  if (!Number.isFinite(opts.maxAgeMs) || opts.maxAgeMs < MIN_SWEEP_AGE_MS) {
    throw new Error(`Sweep age bound ${opts.maxAgeMs} ms refused: the minimum is ${MIN_SWEEP_AGE_MS} ms so a live run's database is never reaped.`);
  }
  const drop: string[] = [];
  const kept: { name: string; reason: string }[] = [];
  for (const c of candidates) {
    const parsed = c.name === opts.baseName ? null : parsePerFileDatabaseName(c.name, opts.prefix);
    if (c.name === opts.baseName) kept.push({ name: c.name, reason: 'base database' });
    else if (!c.name.startsWith(opts.prefix)) kept.push({ name: c.name, reason: 'different prefix' });
    else if (!parsed) kept.push({ name: c.name, reason: 'prefix matches but not the generated shape' });
    else if (opts.baseComment !== null && c.comment !== opts.baseComment) kept.push({ name: c.name, reason: 'marker comment differs from the base' });
    else if (opts.now.getTime() - parsed.createdAt.getTime() < opts.maxAgeMs) kept.push({ name: c.name, reason: 'younger than the age bound' });
    else drop.push(c.name);
  }
  return { drop, kept };
}

/**
 * Replace the database name in a connection URL. Only a URL whose host, port and database equal the base's is
 * changed; the rest are returned unchanged (`null`), so a variable aimed anywhere else is never redirected.
 */
export function redirectDsn(dsn: string, base: { host: string; port: string; database: string }, to: string): string | null {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  if (url.hostname !== base.host || url.port !== base.port) return null;
  if (decodeURIComponent(url.pathname.replace(/^\//, '')) !== base.database) return null;
  url.pathname = `/${to}`;
  return url.toString();
}

/**
 * Rewrite, in `env` in place, every `*DATABASE_URL*` variable that names the base to name `to` instead. Returns the
 * variable NAMES changed (never values).
 */
export function redirectEnvToDatabase(env: Record<string, string | undefined>, baseDsn: string, to: string): string[] {
  const b = new URL(baseDsn);
  const base = { host: b.hostname, port: b.port, database: databaseNameOf(baseDsn) };
  const changed: string[] = [];
  for (const name of Object.keys(env)) {
    if (!/DATABASE_URL/.test(name)) continue;
    const value = env[name];
    if (!value) continue;
    const next = redirectDsn(value, base, to);
    if (next !== null) {
      env[name] = next;
      changed.push(name);
    }
  }
  return changed;
}

/** Whether a test file path should receive its own database in `mode`. `registered` is the committed-fixture suites only. */
export function perFileAppliesTo(mode: PerFileMode, testPath: string | undefined, registered: readonly string[]): boolean {
  if (mode === 'off' || !testPath) return false;
  const p = testPath.replace(/\\/g, '/');
  if (!/\/tests\/integration\/[^/]+\.test\.ts$/.test(p)) return false;
  if (mode === 'all') return true;
  return registered.some((r) => p.endsWith(`/${r.replace(/\\/g, '/')}`));
}
