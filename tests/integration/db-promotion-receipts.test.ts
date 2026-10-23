// tests | Integration proof of the brownlow_correction_receipts promotion lifecycle against real PostgreSQL
// Soft size threshold: 500 LOC. Run `phaneslight loc-check` if uncertain.
/**
 * AFLDB-ISSUE-322. Real-PostgreSQL proof, on REAL migrated databases, that promotion treats the append-only
 * `brownlow_correction_receipts` table (migration 116) as the owner decided: the candidate copy is LOCKED and
 * asserted EMPTY inside the promotion transaction (`truncateSql()`), never truncated; its trigger is never
 * bypassed; the production receipts come back through the exact data-only `pg_restore` line `reinstatePlan()`
 * prints and compare equal under the F0 comparator (`tableDigestSql`); and the REAL `swapSql()` then
 * `rollbackSql()` leave every database's receipts unchanged.
 *
 * DISPOSABLE ISOLATED CLUSTER ONLY. It runs only when AFLDB_TEST_DATABASE_URL names `afldb_v2_i322_base_test`
 * under the marked isolated launcher (`tools/v2/isolated-pg.ts run afldb_v2_i322_base_test -- ...`); otherwise the
 * whole file is SKIPPED (an ordinary integration run never touches it). Precondition, made by the harness through
 * `isolated-pg` (cluster provisioning: init, start, roles, create-db incl. its CREATE EXTENSION bootstrap):
 *   - `afldb_v2_i322_base_test` created and migrated to head (`tools/db/migrate.ts` + `tools/db/privileges.ts`,
 *     `--target test`, inside `isolated-pg run`);
 *   - `afldb_v2_i322_{nonempty,live,cand}_test` created with `--template afldb_v2_i322_base_test`;
 *   - no `afldb_v2_i322_pre_test` (it is created only by the swap's rename).
 *
 * Roles. Every table-level step -- inserts, the promotion transaction (lock, emptiness check, truncate), pg_dump,
 * pg_restore, digests, OID/trigger/role reads -- runs as `afldb_owner` (NOSUPERUSER, NOCREATEDB, unchanged). The
 * cluster superuser `afldb_v2_super` is used for exactly TWO psql executions, the mapped `swapSql()` and the
 * mapped `rollbackSql()` (each: the pg_terminate_backend SELECT + two ALTER DATABASE ... RENAME), because a
 * database rename needs CREATEDB or superuser and the owner must stay NOCREATEDB (owner ruling J-05). Its password
 * is read from `$AFLDB_V2_PG_ROOT/secrets/superuser.pw` and travels only in that child's PGPASSWORD; its DSN reuses
 * the verified host:port of AFLDB_TEST_DATABASE_URL and names database `postgres`. Nothing prints a credential.
 */
import './guard';

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ISOLATED_DATABASE_NAME_PATTERN } from '@afldb/domain';

import { DIGEST_SESSION_SETTINGS, tableDigestSql } from '../../tools/db/promotion-freeze';
import { EMPTY_ASSERTED_TABLES, emptyAssertionSql, reinstatePlan, rollbackSql, swapSql, truncateSql } from '../../tools/db/promotion-inventory';

const BASE = 'afldb_v2_i322_base_test';
const NONEMPTY = 'afldb_v2_i322_nonempty_test';
const LIVE = 'afldb_v2_i322_live_test';
const CAND = 'afldb_v2_i322_cand_test';
const PRE = 'afldb_v2_i322_pre_test';
const SUPERUSER = 'afldb_v2_super';
const TABLE = 'brownlow_correction_receipts';
const TRIGGER = 'brownlow_receipt_immutable';
const TRIGGER_DEF = 'CREATE TRIGGER brownlow_receipt_immutable BEFORE DELETE OR UPDATE OR TRUNCATE ON public.brownlow_correction_receipts '
  + 'FOR EACH STATEMENT EXECUTE FUNCTION refuse_brownlow_receipt_mutation()';
const PLAN = { candidate: 'afldb_prod_candidate_i322', oldDatabase: 'afldb_prod', preCutoverDump: '/backups/pre-cutover.dump', rebuiltDump: '/backups/rebuilt.dump' };
/** generated name -> disposable name; longest first so no mapping is a prefix of a later one */
const NAME_MAP: [string, string][] = [['afldb_prod_candidate_i322', CAND], ['afldb_prod_pre_rebuild_i322', PRE], ['afldb_prod', LIVE]];
const TIMEOUT = 120_000;

const testUrl = process.env.AFLDB_TEST_DATABASE_URL ?? '';
const enabled = process.env.AFLDB_V2_ISOLATED_PG === '1' && (() => {
  try { return new URL(testUrl).pathname === `/${BASE}`; } catch { return false; }
})();

const clients = new Map<string, ReturnType<typeof postgres>>();
let scratch = '';
let dumpFile = '';
let liveDigest = '';
const roleAttrsBefore: Record<string, unknown>[] = [];
const oidBefore = new Map<string, string>();

const urlFor = (database: string, user?: string): string => {
  const url = new URL(testUrl);
  url.pathname = `/${database}`;
  if (user) { url.username = user; url.password = ''; }
  return url.toString();
};
function db(name: string): ReturnType<typeof postgres> {
  if (!clients.has(name)) clients.set(name, postgres(urlFor(name), { max: 1, onnotice: () => {} }));
  return clients.get(name)!;
}
async function close(...names: string[]): Promise<void> {
  for (const name of names) {
    const client = clients.get(name);
    clients.delete(name);
    if (client) await client.end({ timeout: 5 });
  }
}

/** The F0 comparator, with its pinned session settings SET on this database's own connection. */
async function digest(name: string): Promise<string> {
  const sql = db(name);
  for (const [setting, value] of DIGEST_SESSION_SETTINGS) await sql.unsafe(`SET ${setting} = '${value}'`);
  const [row] = await sql.unsafe(tableDigestSql('public', TABLE));
  return `${row.rows}:${row.digest}`;
}
async function trigger(name: string): Promise<string> {
  const [row] = await db(name)`
    SELECT tgenabled::text AS enabled, pg_get_triggerdef(oid) AS def FROM pg_trigger
     WHERE tgrelid = ${`public.${TABLE}`}::regclass AND tgname = ${TRIGGER}`;
  expect(row, `${name}: trigger ${TRIGGER} present`).toBeDefined();
  expect(row.def).toBe(TRIGGER_DEF);   // migration 116's trigger, byte for byte as PostgreSQL renders it
  return row.enabled as string;
}
const replicationRole = async (name: string): Promise<string> =>
  (await db(name)`SELECT current_setting('session_replication_role') AS r`)[0].r as string;
const which = async (name: string): Promise<string | null> =>
  ((await db(name)`SELECT value #>> '{}' AS v FROM site_settings WHERE key = 'issue322.which'`)[0]?.v as string | undefined) ?? null;
const settings = async (name: string): Promise<number> => (await db(name)`SELECT count(*)::int AS n FROM site_settings`)[0].n as number;
const fkPresent = async (name: string): Promise<boolean> =>
  (await db(name)`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'promotion_candidates_decision_fk'`)[0].n === 1;
async function oids(): Promise<Map<string, string>> {
  const rows = await db(BASE)`SELECT oid::text AS oid, datname FROM pg_database WHERE datname LIKE 'afldb_v2_i322_%'`;
  return new Map(rows.map((r) => [r.datname as string, r.oid as string]));
}
const roleAttrs = async (): Promise<Record<string, unknown>[]> => [...await db(BASE)`
  SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit, rolcanlogin
    FROM pg_roles WHERE rolname IN ('afldb_owner', 'afldb_app', 'afldb_import', 'afldb_backup', 'afldb_auth') ORDER BY rolname`];

async function insertReceipts(name: string, count: number): Promise<void> {
  const hex = (seed: string): string => createHash('sha256').update(seed).digest('hex');
  for (let i = 0; i < count; i += 1) {
    await db(name)`
      INSERT INTO brownlow_correction_receipts (plan_digest, operation, code_revision, approval_reference, before_digest, after_digest, result, applied_at)
      VALUES (${hex(`${name}-plan-${i}`)}, 'observe', ${hex(`${name}-rev-${i}`).slice(0, 40)},
              ${`SYNTHETIC AFLDB-ISSUE-322 integration fixture ${i}; never a live approval`},
              ${hex(`before-${i}`)}, ${hex(`after-${i}`)}, ${JSON.stringify({ synthetic: true, index: i })}::jsonb,
              ${`2026-01-01T00:00:0${i}Z`}::timestamptz)`;
  }
}
const setMarker = (name: string, value: string) => db(name)`
  INSERT INTO site_settings (key, value) VALUES ('issue322.which', ${JSON.stringify(value)}::jsonb)`;

/** Run a promotion transaction that MUST be refused; leave the connection usable and return the refusal. */
async function refusal(name: string, text: string): Promise<string> {
  try { await db(name).unsafe(text); } catch (error) {
    await db(name).unsafe('ROLLBACK');
    return (error as Error).message;
  }
  throw new Error('the promotion transaction was expected to be refused');
}

function pgTool(tool: string, args: readonly string[], password: string): void {
  const bin = process.env.AFLDB_V2_PG_BIN;
  const file = bin ? join(bin, process.platform === 'win32' ? `${tool}.exe` : tool) : tool;
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) if (/DATABASE_URL/.test(key) || /^PG/.test(key)) delete env[key];
  env.PGPASSWORD = password;
  const result = spawnSync(file, [...args], { shell: false, encoding: 'utf8', env, timeout: 100_000 });
  if (result.status !== 0) throw new Error(`${tool} failed (${result.status ?? result.error?.message}): ${String(result.stderr).slice(0, 800)}`);
}
const ownerPassword = (): string => decodeURIComponent(new URL(testUrl).password);
const ownerDsnWithoutPassword = (database: string): string => {
  const url = new URL(urlFor(database));
  url.password = '';
  return url.toString();
};

/** The exact pg_restore arguments `reinstatePlan()` prints for the receipts table, aimed at `dump` and `database`. */
function reinstateRestoreArgv(dump: string, database: string): string[] {
  const lines = reinstatePlan(PLAN).split('\n');
  const at = lines.findIndex((line) => line.includes(`--table=${TABLE} `));
  expect(at, 'the plan must contain a restore line for the receipts table').toBeGreaterThan(0);
  const words = `${lines[at - 1].replace(/ \\$/, '')} ${lines[at].trim()}`.split(' ').filter(Boolean);
  expect(words[0]).toBe('pg_restore');
  expect(words[1]).toBe('--dbname="$CANDIDATE_DSN"');
  expect(words[words.length - 1]).toBe(`'${PLAN.preCutoverDump}'`);
  const flags = words.slice(2, -1);
  expect(flags).toEqual(['--data-only', '--no-owner', '--no-privileges', '--single-transaction', '--exit-on-error', `--table=${TABLE}`]);
  return [`--dbname=${ownerDsnWithoutPassword(database)}`, ...flags, dump];
}

/** Map ONLY the three quoted database names; prove the mapping round-trips and names nothing but isolated databases. */
function mapped(generated: string): string {
  let text = generated;
  for (const [from, to] of NAME_MAP) text = text.split(`"${from}"`).join(`"${to}"`).split(`'${from}'`).join(`'${to}'`);
  let back = text;
  for (const [from, to] of [...NAME_MAP].reverse()) back = back.split(`"${to}"`).join(`"${from}"`).split(`'${to}'`).join(`'${from}'`);
  expect(back, 'the mapped text differs from the generated text only in the three database names').toBe(generated);
  expect(text).not.toMatch(/afldb_prod|afldb_dev|afldb_test\b|"afldb_test"|'afldb_test'/);
  for (const [, name] of text.matchAll(/["']([a-z0-9_]+)["']/g)) {
    if (name.startsWith('afldb')) expect(ISOLATED_DATABASE_NAME_PATTERN.test(name), name).toBe(true);
  }
  const statements = text.split('\n').filter((line) => !line.startsWith('--') && !line.startsWith('\\set')).join('\n')
    .split(';').map((s) => s.trim()).filter(Boolean);
  expect(statements).toHaveLength(3);
  expect(statements[0]).toMatch(/^SELECT pg_terminate_backend\(pid\)\s+FROM pg_stat_activity\s+WHERE datname IN \('[a-z0-9_]+', '[a-z0-9_]+'\)\s+AND pid <> pg_backend_pid\(\)$/);
  for (const s of statements.slice(1)) expect(s).toMatch(/^ALTER DATABASE "afldb_v2_i322_[a-z]+_test" RENAME TO "afldb_v2_i322_[a-z]+_test"$/);
  return text;
}

/** The ONLY superuser use: execute one mapped swap/rollback file with psql, connected to `postgres`. */
function asSuperuser(label: string, text: string): void {
  const root = process.env.AFLDB_V2_PG_ROOT;
  if (!root) throw new Error('AFLDB_V2_PG_ROOT is required for the disposable rename step');
  const password = readFileSync(join(root, 'secrets', 'superuser.pw'), 'utf8').trim();
  const file = join(scratch, `${label}.sql`);
  writeFileSync(file, text, { mode: 0o600 });
  console.log(`[ISSUE-322 superuser rename step: ${label}] ${text.split('\n').filter((l) => /^(ALTER DATABASE|SELECT pg_terminate_backend)/.test(l)).join(' | ')}`);
  pgTool('psql', ['-X', '-v', 'ON_ERROR_STOP=1', `--dbname=${urlFor('postgres', SUPERUSER)}`, '-f', file], password);
}

describe.runIf(enabled).sequential('AFLDB-ISSUE-322 receipts promotion: real swap and rollback on disposable migrated databases', () => {
  beforeAll(async () => {
    const [facts] = await db(BASE)`SELECT current_database() AS d`;
    expect(facts.d).toBe(BASE);
    const names = await oids();
    expect([...names.keys()].sort()).toEqual([BASE, CAND, LIVE, NONEMPTY].sort());
    for (const [name, oid] of names) oidBefore.set(name, oid);
    roleAttrsBefore.push(...await roleAttrs());
    const owner = roleAttrsBefore.find((r) => r.rolname === 'afldb_owner')!;
    expect([owner.rolsuper, owner.rolcreatedb]).toEqual([false, false]);
    for (const name of [BASE, NONEMPTY, LIVE, CAND]) {
      expect(await digest(name), `${name} receipts start empty`).toMatch(/^0:/);
      expect(await trigger(name)).toBe('O');
    }
    scratch = mkdtempSync(join(tmpdir(), 'afldb-issue322-'));
    dumpFile = join(scratch, 'pre-cutover.dump');
  }, TIMEOUT);

  afterAll(async () => {
    try { await close(...clients.keys()); } finally { if (scratch) rmSync(scratch, { recursive: true, force: true }); }
  }, TIMEOUT);

  it('a non-empty candidate refuses the whole promotion transaction; nothing is emptied', async () => {
    await insertReceipts(NONEMPTY, 1);
    await setMarker(NONEMPTY, 'nonempty');
    const before = { receipts: await digest(NONEMPTY), settings: await settings(NONEMPTY) };
    expect(before.receipts).toMatch(/^1:/);
    const message = await refusal(NONEMPTY, truncateSql());
    expect(message).toMatch(/AFLDB-ISSUE-322: the candidate copy of public\.brownlow_correction_receipts is not empty/);
    expect(message).toContain('nothing was emptied');
    expect(await digest(NONEMPTY)).toBe(before.receipts);
    expect(await settings(NONEMPTY)).toBe(before.settings);
    expect(await fkPresent(NONEMPTY)).toBe(true);
    expect(await replicationRole(NONEMPTY)).toBe('origin');
    expect(await trigger(NONEMPTY)).toBe('O');
  }, TIMEOUT);

  it('the generated LOCK holds the receipts table against another session until the transaction ends', async () => {
    const { lock } = emptyAssertionSql(EMPTY_ASSERTED_TABLES[0]);
    const other = postgres(urlFor(NONEMPTY), { max: 1, onnotice: () => {} });
    try {
      await db(NONEMPTY).unsafe('BEGIN');
      try {
        await db(NONEMPTY).unsafe(lock);
        await other.unsafe("SET lock_timeout = '500ms'");
        await expect(other.unsafe(`SELECT count(*) FROM public.${TABLE}`)).rejects.toMatchObject({ code: '55P03' });
      } finally { await db(NONEMPTY).unsafe('ROLLBACK'); }
      expect((await other.unsafe(`SELECT count(*)::int AS n FROM public.${TABLE}`))[0].n).toBe(1);
    } finally { await other.end({ timeout: 5 }); }
  }, TIMEOUT);

  it('"production" holds receipts and is dumped in full (pg_dump --format=custom) as the owner', async () => {
    await insertReceipts(LIVE, 3);
    await setMarker(LIVE, 'live');
    liveDigest = await digest(LIVE);
    expect(liveDigest).toMatch(/^3:/);
    pgTool('pg_dump', ['--format=custom', `--file=${dumpFile}`, `--dbname=${ownerDsnWithoutPassword(LIVE)}`], ownerPassword());
    expect(await digest(LIVE)).toBe(liveDigest);
  }, TIMEOUT);

  it('an empty candidate passes the promotion transaction; the receipts trigger is untouched', async () => {
    await setMarker(CAND, 'candidate-before-truncate');
    expect(await settings(CAND)).toBeGreaterThanOrEqual(1);
    await db(CAND).unsafe(truncateSql());
    expect(await settings(CAND)).toBe(0);          // the promotion really ran: another contract table was emptied
    expect(await fkPresent(CAND)).toBe(true);
    expect(await digest(CAND)).toMatch(/^0:/);
    expect(await trigger(CAND)).toBe('O');
    expect(await replicationRole(CAND)).toBe('origin');
  }, TIMEOUT);

  it('reinstates the production receipts with the exact plan line under the live trigger; they compare equal', async () => {
    pgTool('pg_restore', reinstateRestoreArgv(dumpFile, CAND), ownerPassword());
    expect(await digest(CAND)).toBe(liveDigest);
    expect(await digest(LIVE)).toBe(liveDigest);    // production was only read
    expect(await trigger(CAND)).toBe('O');
    for (const statement of [`UPDATE public.${TABLE} SET operation = 'adopt'`, `DELETE FROM public.${TABLE}`, `TRUNCATE public.${TABLE}`]) {
      await expect(db(CAND).unsafe(statement), statement).rejects.toThrow(/append-only/);
    }
    expect(await digest(CAND)).toBe(liveDigest);
  }, TIMEOUT);

  it('the REAL swapSql() renames production aside and promotes the candidate; every receipt digest is unchanged', async () => {
    const text = mapped(swapSql(PLAN));
    await close(LIVE, CAND);
    asSuperuser('swap', text);
    const after = await oids();
    expect(after.get(PRE)).toBe(oidBefore.get(LIVE));
    expect(after.get(LIVE)).toBe(oidBefore.get(CAND));
    expect(after.has(CAND)).toBe(false);
    expect([await digest(LIVE), await which(LIVE)]).toEqual([liveDigest, null]);     // the promoted candidate
    expect([await digest(PRE), await which(PRE)]).toEqual([liveDigest, 'live']);     // the retained production
    expect(await digest(BASE)).toMatch(/^0:/);
    expect(await digest(NONEMPTY)).toMatch(/^1:/);
    for (const name of [BASE, NONEMPTY, LIVE, PRE]) expect(await trigger(name), name).toBe('O');
  }, TIMEOUT);

  it('the REAL rollbackSql() restores the original names; every receipt digest is unchanged and the roles are untouched', async () => {
    const text = mapped(rollbackSql(PLAN));
    await close(LIVE, PRE);
    asSuperuser('rollback', text);
    const after = await oids();
    expect(Object.fromEntries(after)).toEqual(Object.fromEntries(oidBefore));
    expect([await digest(LIVE), await which(LIVE)]).toEqual([liveDigest, 'live']);
    expect([await digest(CAND), await which(CAND)]).toEqual([liveDigest, null]);
    expect(await digest(BASE)).toMatch(/^0:/);
    expect(await digest(NONEMPTY)).toMatch(/^1:/);
    for (const name of [BASE, NONEMPTY, LIVE, CAND]) {
      expect(await trigger(name), name).toBe('O');
      expect(await replicationRole(name)).toBe('origin');
    }
    expect(await roleAttrs()).toEqual(roleAttrsBefore);
  }, TIMEOUT);
});
