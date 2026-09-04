/**
 * AFLDB-ISSUE-125 — READ-ONLY production promotion preflight and acceptance checker.
 *
 *     npm run db:promotion:check -- --phase source      --database afldb_test
 *     npm run db:promotion:check -- --phase pre-cutover --database afldb_prod \
 *         --snapshot ~/backups/afldb/promotion-<stamp>.json --expect-super-admin <email>
 *     npm run db:promotion:check -- --phase restored    --database afldb_prod_candidate_<stamp> \
 *         --old-database afldb_prod
 *     npm run db:promotion:check -- --phase candidate   --database afldb_prod_candidate_<stamp> \
 *         --compare ~/backups/afldb/promotion-<stamp>.json --expect-super-admin <email>
 *     npm run db:promotion:check -- --phase production  --database afldb_prod \
 *         --compare ~/backups/afldb/promotion-<stamp>.json --expect-super-admin <email>
 *
 *     npm run db:promotion:check -- --plan --database afldb_prod_candidate_<stamp> \
 *         --old-database afldb_prod --pre-cutover-dump <file> --rebuilt-dump <file> \
 *         --plan-dir <dir>                                  (no database contact)
 *     npm run db:promotion:check -- --checklist             (no database contact)
 *
 * What it is: the executable half of docs/production-promotion.md. It reads the contract in
 * tools/db/promotion-inventory.ts and proves, against a live database, the facts an operator
 * would otherwise have to eyeball: that the database is the one the phase expects, that every
 * public table has a decided treatment, that the migration ledger matches this checkout, that
 * no test-fixture identity exists, that the real super admin exists and is enabled, that the
 * production-owned tables hold what the pre-cutover snapshot said they held, and that
 * privileges.sql has been run.
 *
 * What it is not: an orchestrator. It never truncates, restores, renames or grants. It
 * cannot change anything, enforced three ways rather than promised, exactly as
 * tools/db/fingerprint-test.ts does:
 *
 *   1. it imports no psql or process-spawning path and executes only the SELECTs in this file;
 *   2. every session is put into `default_transaction_read_only = on` before any query,
 *      so the SERVER refuses a write even if one were somehow issued;
 *   3. tests/db-promotion-check.test.ts asserts (1) and (2) from the source text.
 *
 * The one thing it writes is a local JSON snapshot of ROW COUNTS (`--snapshot`) and, with
 * `--plan`, the SQL/command files the operator then reads and runs by hand. No DSN, no
 * password, no hash and no secret is ever printed or written; email addresses are printed
 * only when they are test fixtures being refused.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectSections, fingerprintOf, type Row } from './catalog-fingerprint';
import { computeChecksumRepresentations, matchesStoredChecksum } from './migration-checksum';
import {
  ACCEPTANCE_CHECKLIST,
  CANDIDATE_PREFIX,
  DERIVED_FOOTBALL_TABLES,
  EMAIL_BEARING_TABLES,
  PHASES,
  PROMOTION_CONTRACT,
  PromotionRefused,
  TEST_FIXTURE_EMAIL_SQL,
  assertDatabaseForPhase,
  assertOldDatabaseName,
  auditMarkerSql,
  classifyPublicTables,
  compareCounts,
  databaseOf,
  publicContractTables,
  reinstatePlan,
  reinstatedSchemas,
  resyncIdentitySql,
  truncateSql,
  withDatabase,
  type CompareRule,
  type Phase,
  type Snapshot,
} from './promotion-inventory';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS_DIR = join(PROJECT_ROOT, 'src', 'db', 'migrations');

/** Enforced by the server, not merely by intent. */
export const READ_ONLY_SQL = 'SET default_transaction_read_only = on';

export const DEFAULT_DSN_ENV = 'AFLDB_OWNER_DATABASE_URL';

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

export type Options = {
  phase?: Phase;
  database?: string;
  oldDatabase?: string;
  dsnEnv: string;
  snapshot?: string;
  compare?: string;
  expectSuperAdmin?: string;
  expectFingerprint?: string;
  plan: boolean;
  planDir?: string;
  preCutoverDump?: string;
  rebuiltDump?: string;
  checklist: boolean;
};

export function parseArgs(argv: readonly string[]): Options {
  const out: Options = { dsnEnv: DEFAULT_DSN_ENV, plan: false, checklist: false };
  const need = (i: number, flag: string): string => {
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new PromotionRefused(`${flag} needs a value.`);
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--phase': {
        const value = need(i, arg);
        if (!PHASES.includes(value as Phase)) {
          throw new PromotionRefused(`Unknown phase '${value}'. Valid phases: ${PHASES.join(', ')}.`);
        }
        out.phase = value as Phase; i += 1; break;
      }
      case '--database': out.database = need(i, arg); i += 1; break;
      case '--old-database': out.oldDatabase = need(i, arg); i += 1; break;
      case '--dsn-env': {
        const value = need(i, arg);
        // A variable NAME, never a DSN: a connection string on the command line lands
        // in shell history and /proc/<pid>/cmdline.
        if (!/^[A-Z][A-Z0-9_]*$/.test(value)) {
          throw new PromotionRefused('--dsn-env takes the NAME of an environment variable, never a DSN.');
        }
        out.dsnEnv = value; i += 1; break;
      }
      case '--snapshot': out.snapshot = need(i, arg); i += 1; break;
      case '--compare': out.compare = need(i, arg); i += 1; break;
      case '--expect-super-admin': out.expectSuperAdmin = need(i, arg); i += 1; break;
      case '--expect-fingerprint': {
        const value = need(i, arg);
        if (!/^[0-9a-f]{64}$/.test(value)) {
          throw new PromotionRefused('--expect-fingerprint needs a 64-character lowercase sha256 digest.');
        }
        out.expectFingerprint = value; i += 1; break;
      }
      case '--plan': out.plan = true; break;
      case '--plan-dir': out.planDir = need(i, arg); i += 1; break;
      case '--pre-cutover-dump': out.preCutoverDump = need(i, arg); i += 1; break;
      case '--rebuilt-dump': out.rebuiltDump = need(i, arg); i += 1; break;
      case '--checklist': out.checklist = true; break;
      default:
        throw new PromotionRefused(`Unknown argument: ${arg}`);
    }
  }

  if (out.checklist) return out;

  if (!out.database) throw new PromotionRefused('--database is required: name the database explicitly.');

  if (out.plan) {
    if (!out.database.startsWith(CANDIDATE_PREFIX)) {
      throw new PromotionRefused(`--plan needs --database ${CANDIDATE_PREFIX}<stamp>: the plan is only ever run on a candidate.`);
    }
    if (!out.oldDatabase) throw new PromotionRefused('--plan needs --old-database (the production database being replaced).');
    assertOldDatabaseName(out.oldDatabase);
    if (!out.preCutoverDump) throw new PromotionRefused('--plan needs --pre-cutover-dump <file>.');
    if (!out.rebuiltDump) throw new PromotionRefused('--plan needs --rebuilt-dump <file>.');
    if (!out.planDir) throw new PromotionRefused('--plan needs --plan-dir <dir> to write the SQL files into.');
    return out;
  }

  if (!out.phase) throw new PromotionRefused(`--phase is required. Valid phases: ${PHASES.join(', ')}.`);
  assertDatabaseForPhase(out.phase, out.database);
  if (out.phase === 'restored') {
    if (!out.oldDatabase) {
      throw new PromotionRefused("Phase 'restored' needs --old-database so dangling references can be probed.");
    }
    assertOldDatabaseName(out.oldDatabase);
  } else if (out.oldDatabase) {
    throw new PromotionRefused("--old-database is only meaningful with --phase restored.");
  }
  if (out.compare && !['candidate', 'production'].includes(out.phase)) {
    throw new PromotionRefused('--compare is only meaningful in the candidate and production phases.');
  }
  if (out.expectFingerprint && out.phase !== 'source') {
    throw new PromotionRefused('--expect-fingerprint is only meaningful in the source phase.');
  }
  if (out.expectSuperAdmin && !out.expectSuperAdmin.includes('@')) {
    throw new PromotionRefused('--expect-super-admin needs an email address.');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Gate bookkeeping
// ---------------------------------------------------------------------------

type Verdict = 'PASS' | 'FAIL' | 'INFO' | 'WARN';
type GateResult = { gate: string; verdict: Verdict; lines: string[] };

class Report {
  readonly results: GateResult[] = [];
  add(gate: string, verdict: Verdict, lines: string[] = []): void {
    this.results.push({ gate, verdict, lines });
    console.log(`\n[${verdict.padEnd(4)}] ${gate}`);
    for (const line of lines) console.log(`       ${line}`);
  }
  get failed(): boolean { return this.results.some((r) => r.verdict === 'FAIL'); }
}

type Query = (text: string, params?: unknown[]) => Promise<Row[]>;

/** postgres.js returns int8 as a string; every count here is cast in SQL, but be safe. */
function asInt(value: unknown): number {
  const n = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(n)) throw new PromotionRefused(`Expected an integer, got ${String(value)}.`);
  return n;
}

// ---------------------------------------------------------------------------
// Gates (all SELECT-only)
// ---------------------------------------------------------------------------

async function gateIdentity(q: Query, expected: string, report: Report): Promise<void> {
  const rows = await q('SELECT current_database() AS database, current_user AS role_name, inet_server_addr()::text AS addr, version() AS version');
  const row = rows[0] ?? {};
  const database = String(row.database);
  const lines = [
    `database : ${database}`,
    `role     : ${String(row.role_name)}`,
    `server   : ${String(row.addr ?? 'local socket')}`,
    `version  : ${String(row.version).split(',')[0]}`,
  ];
  if (database !== expected) {
    report.add('Database identity', 'FAIL', [...lines, `expected '${expected}' — refusing every further check`]);
    throw new PromotionRefused(`Connected to '${database}', not '${expected}'.`);
  }
  report.add('Database identity', 'PASS', lines);
}

async function gateClassification(q: Query, report: Report): Promise<{ present: string[]; registry: string[] }> {
  const present = (await q(`
    SELECT c.relname AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
     ORDER BY 1`)).map((r) => String(r.name));

  const registryExists = (await q("SELECT to_regclass('afldb_meta.import_writable_tables') IS NOT NULL AS ok"))[0]?.ok;
  if (!registryExists) {
    report.add('Table classification', 'FAIL', [
      'afldb_meta.import_writable_tables is absent (pre-migration 045).',
      'Without the registry there is no authority for "rebuilt data", so nothing can be classified.',
    ]);
    throw new PromotionRefused('import_writable_tables registry absent.');
  }
  const registry = (await q('SELECT name FROM afldb_meta.import_writable_tables ORDER BY name'))
    .map((r) => String(r.name));

  const problems = classifyPublicTables(present, registry);
  const lines = [
    `${present.length} public tables: ${registry.filter((n) => present.includes(n)).length} import-writable (rebuilt data), `
      + `${publicContractTables().filter((t) => present.includes(t.name)).length} under the promotion contract`,
    `derived (recomputed by rebuild_derived.py): ${DERIVED_FOOTBALL_TABLES.filter((n) => present.includes(n)).join(', ')}`,
  ];
  if (problems.length === 0) {
    report.add('Table classification (fail-closed)', 'PASS', lines);
    return { present, registry };
  }
  for (const p of problems) {
    if (p.kind === 'unclassified') {
      lines.push(`UNCLASSIFIED public.${p.table}: neither import-writable nor in tools/db/promotion-inventory.ts — decide its treatment before promoting`);
    } else if (p.kind === 'both') {
      lines.push(`CONFLICT public.${p.table}: both import-writable and in the contract — the contract is stale`);
    } else {
      lines.push(`MISSING public.${p.table}: the contract names it but this database lacks it`);
    }
  }
  report.add('Table classification (fail-closed)', 'FAIL', lines);
  return { present, registry };
}

async function gateMigrationParity(q: Query, report: Report): Promise<void> {
  const exists = (await q("SELECT to_regclass('afldb_meta.schema_migrations') IS NOT NULL AS ok"))[0]?.ok;
  if (!exists) {
    report.add('Migration parity with this checkout', 'FAIL', ['afldb_meta.schema_migrations is absent.']);
    return;
  }
  const applied = new Map(
    (await q('SELECT name, checksum FROM afldb_meta.schema_migrations ORDER BY name'))
      .map((r) => [String(r.name), String(r.checksum)] as const),
  );
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const pending: string[] = [];
  const drifted: string[] = [];
  for (const name of files) {
    const stored = applied.get(name);
    if (stored === undefined) { pending.push(name); continue; }
    const reps = computeChecksumRepresentations(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));
    if (!matchesStoredChecksum(stored, reps)) drifted.push(name);
  }
  const unknown = [...applied.keys()].filter((name) => !files.includes(name));
  const last = [...applied.keys()].sort().at(-1) ?? '(none)';
  const lines = [`${files.length} migration file(s) in this checkout, ${applied.size} applied, latest ${last}`];
  for (const n of pending) lines.push(`PENDING  ${n} — the code to be deployed expects it; run db:migrate before promotion, or check out the matching revision`);
  for (const n of unknown) lines.push(`UNKNOWN  ${n} — applied in the database but not in this checkout; this checkout is older than the database`);
  for (const n of drifted) lines.push(`DRIFT    ${n} — applied bytes differ from this checkout`);
  report.add('Migration parity with this checkout', pending.length + unknown.length + drifted.length === 0 ? 'PASS' : 'FAIL', lines);
}

async function gateFixtureIdentities(
  q: Query, present: readonly string[], phase: Phase, report: Report,
): Promise<number> {
  const mustBeAbsent = phase === 'pre-cutover' || phase === 'candidate' || phase === 'production';
  let total = 0;
  const lines: string[] = [];
  for (const table of EMAIL_BEARING_TABLES) {
    if (!present.includes(table)) { lines.push(`${table}: absent`); continue; }
    const rows = await q(`
      SELECT count(*)::int AS n,
             (SELECT array_agg(email ORDER BY email)
                FROM (SELECT email FROM public.${table} WHERE ${TEST_FIXTURE_EMAIL_SQL} ORDER BY email LIMIT 10) s) AS sample
        FROM public.${table}
       WHERE ${TEST_FIXTURE_EMAIL_SQL}`);
    const n = asInt(rows[0]?.n);
    total += n;
    const sample = Array.isArray(rows[0]?.sample) ? (rows[0]?.sample as string[]) : [];
    lines.push(`${table.padEnd(20)} ${String(n).padStart(6)} fixture-domain row(s)${n ? `: ${sample.join(', ')}${n > sample.length ? ', …' : ''}` : ''}`);
  }
  if (total === 0) {
    report.add('Test-fixture identities (reserved domains: .test .example .invalid .localhost, example.com/net/org)', 'PASS', lines);
  } else if (mustBeAbsent) {
    lines.push('A reserved-domain identity can never be a production identity. REFUSED.');
    report.add('Test-fixture identities', 'FAIL', lines);
  } else {
    lines.push(phase === 'source'
      ? 'Expected on a rebuilt afldb_test that has run integration tests. The candidate truncate removes them; the candidate phase refuses if any survive.'
      : 'Present in the freshly restored candidate as expected. The truncate step removes them; the candidate phase refuses if any survive.');
    report.add('Test-fixture identities', 'INFO', lines);
  }
  return total;
}

async function gateSuperAdmin(
  q: Query, present: readonly string[], phase: Phase, expected: string | undefined, report: Report,
): Promise<number> {
  if (!present.includes('auth_users')) {
    report.add('Production super admin', 'FAIL', ['auth_users is absent.']);
    return 0;
  }
  const rows = await q(`
    SELECT count(*) FILTER (WHERE role = 'super_admin' AND disabled_at IS NULL
                              AND password_hash IS NOT NULL AND totp_secret IS NOT NULL)::int AS enabled_super,
           count(*) FILTER (WHERE role = 'super_admin')::int AS super_total,
           count(*)::int AS users,
           count(*) FILTER (WHERE disabled_at IS NOT NULL)::int AS disabled
      FROM public.auth_users`);
  const r = rows[0] ?? {};
  const enabled = asInt(r.enabled_super);
  const lines = [
    `auth_users rows ${asInt(r.users)}; super_admin ${asInt(r.super_total)} (enabled + enrolled ${enabled}); disabled ${asInt(r.disabled)}`,
  ];
  let ok = true;
  if (expected) {
    const match = await q(`
      SELECT (role = 'super_admin') AS is_super, disabled_at IS NULL AS enabled,
             password_hash IS NOT NULL AS has_password, totp_secret IS NOT NULL AS has_totp
        FROM public.auth_users WHERE lower(email) = lower($1)`, [expected]);
    const m = match[0];
    if (!m) { lines.push(`expected super admin is NOT present`); ok = false; } else {
      const good = m.is_super === true && m.enabled === true && m.has_password === true && m.has_totp === true;
      lines.push(`expected super admin present: role ok ${m.is_super === true}, enabled ${m.enabled === true}, password set ${m.has_password === true}, TOTP enrolled ${m.has_totp === true}`);
      if (!good) ok = false;
    }
  }
  const required = phase === 'pre-cutover' || phase === 'candidate' || phase === 'production';
  if (required && enabled === 0) { lines.push('no enabled, fully enrolled super_admin — nobody could administer this database'); ok = false; }
  if (!required && !expected) lines.push('(informational in this phase)');
  report.add('Production super admin', required ? (ok ? 'PASS' : 'FAIL') : (ok ? 'INFO' : 'WARN'), lines);
  return enabled;
}

async function gateInventory(
  q: Query, present: readonly string[], report: Report,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const lines: string[] = [];
  for (const t of publicContractTables()) {
    if (!present.includes(t.name)) { lines.push(`${t.name.padEnd(30)} absent`); continue; }
    const n = asInt((await q(`SELECT count(*)::int AS n FROM public.${t.name}`))[0]?.n);
    counts[`public.${t.name}`] = n;
    lines.push(`${t.name.padEnd(30)} ${String(n).padStart(8)}  ${t.treatment.padEnd(10)} ${t.category}`);
  }
  for (const schema of reinstatedSchemas()) {
    const tables = (await q('SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY 1', [schema]))
      .map((r) => String(r.tablename));
    for (const table of tables) {
      const n = asInt((await q(`SELECT count(*)::int AS n FROM ${schema}.${table}`))[0]?.n);
      counts[`${schema}.${table}`] = n;
      lines.push(`${`${schema}.${table}`.padEnd(30)} ${String(n).padStart(8)}  reinstate  staging`);
    }
  }
  report.add('Production-owned / operational state inventory', 'INFO', lines);
  return counts;
}

function compareRules(): { table: string; rule: CompareRule }[] {
  return publicContractTables().map((t) => ({ table: `public.${t.name}`, rule: t.compare }));
}

function gateCompare(snapshotPath: string, counts: Record<string, number>, report: Report): void {
  let snapshot: Snapshot;
  try {
    snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as Snapshot;
  } catch (error) {
    report.add('Counts against the pre-cutover snapshot', 'FAIL', [`cannot read ${snapshotPath}: ${(error as Error).message}`]);
    return;
  }
  if (snapshot.issue !== 'AFLDB-ISSUE-125' || typeof snapshot.counts !== 'object') {
    report.add('Counts against the pre-cutover snapshot', 'FAIL', [`${snapshotPath} is not a promotion snapshot`]);
    return;
  }
  const rules = compareRules();
  // Reinstated schemas: every table the snapshot knew must be equal.
  for (const key of Object.keys(snapshot.counts)) {
    if (!key.startsWith('public.')) rules.push({ table: key, rule: 'equal' });
  }
  const findings = compareCounts(snapshot, rules, counts);
  const lines = [`snapshot of ${snapshot.database} taken ${snapshot.takenAt}`];
  for (const f of findings) {
    lines.push(`${f.ok ? 'ok  ' : 'FAIL'} ${f.table.padEnd(34)} ${f.rule.padEnd(8)} ${String(f.before ?? '-').padStart(8)} -> ${String(f.after ?? '-').padStart(8)}  ${f.detail}`);
  }
  report.add('Counts against the pre-cutover snapshot', findings.every((f) => f.ok) ? 'PASS' : 'FAIL', lines);
}

async function gatePrivileges(q: Query, present: readonly string[], required: boolean, report: Report): Promise<void> {
  const roles = new Set((await q("SELECT rolname FROM pg_roles WHERE rolname IN ('afldb_app', 'afldb_auth', 'afldb_import')"))
    .map((r) => String(r.rolname)));
  const lines: string[] = [];
  let ok = true;
  const probe = async (label: string, sql: string, want: boolean): Promise<void> => {
    const got = (await q(sql))[0]?.ok === true;
    lines.push(`${got === want ? 'ok  ' : 'FAIL'} ${label}`);
    if (got !== want) ok = false;
  };
  if (roles.has('afldb_app') && present.includes('auth_users') && present.includes('players')) {
    await probe('afldb_app cannot read auth_users', "SELECT has_table_privilege('afldb_app', 'public.auth_users', 'SELECT') AS ok", false);
    await probe('afldb_app can read players', "SELECT has_table_privilege('afldb_app', 'public.players', 'SELECT') AS ok", true);
  } else lines.push('afldb_app probes skipped (role or table absent)');
  if (roles.has('afldb_auth') && present.includes('auth_users')) {
    await probe('afldb_auth can read auth_users', "SELECT has_table_privilege('afldb_auth', 'public.auth_users', 'SELECT') AS ok", true);
    await probe('afldb_auth cannot delete nl_search_log', "SELECT has_table_privilege('afldb_auth', 'public.nl_search_log', 'DELETE') AS ok", false);
  } else lines.push('afldb_auth probes skipped (role or table absent)');
  if (roles.has('afldb_import') && present.includes('auth_users')) {
    await probe('afldb_import cannot read auth_users', "SELECT has_table_privilege('afldb_import', 'public.auth_users', 'SELECT') AS ok", false);
  }
  const fn = (await q("SELECT to_regprocedure('public.nl_search_telemetry_clear()') IS NOT NULL AS ok"))[0]?.ok === true;
  if (fn) {
    // A NULL ACL is the default, and the default for a function is EXECUTE to PUBLIC.
    await probe('nl_search_telemetry_clear() has no PUBLIC execute',
      "SELECT (proacl IS NOT NULL AND NOT EXISTS (SELECT 1 FROM unnest(proacl) a WHERE a::text LIKE '=X/%')) AS ok FROM pg_proc WHERE oid = 'public.nl_search_telemetry_clear()'::regprocedure", true);
  }
  if (!required) lines.push('(informational in this phase)');
  report.add('Privileges reconciled (tools/maintenance/privileges.sql has been run)', required ? (ok ? 'PASS' : 'FAIL') : (ok ? 'INFO' : 'WARN'), lines);
}

async function gateDanglingReferences(
  candidate: Query, old: Query, present: readonly string[], report: Report,
): Promise<void> {
  const lines: string[] = [];
  let fail = false;
  let fixups = 0;
  for (const t of PROMOTION_CONTRACT) {
    if (t.schema !== 'public' || !t.footballRefs) continue;
    for (const ref of t.footballRefs) {
      if (!present.includes(t.name) || !present.includes(ref.references)) { lines.push(`${t.name}.${ref.column}: table absent`); continue; }
      const idsRows = await old(`SELECT DISTINCT ${ref.column} AS id FROM public.${t.name} WHERE ${ref.column} IS NOT NULL ORDER BY 1`);
      const ids = idsRows.map((r) => asInt(r.id));
      if (ids.length === 0) { lines.push(`ok   ${t.name}.${ref.column} -> ${ref.references}: no references in ${'the old database'}`); continue; }
      const missing = (await candidate(`
        SELECT count(*)::int AS n FROM unnest($1::bigint[]) u(id)
         WHERE NOT EXISTS (SELECT 1 FROM public.${ref.references} r WHERE r.id = u.id)`, [ids]))[0];
      const n = asInt(missing?.n);
      const label = `${t.name}.${ref.column} -> ${ref.references}: ${ids.length} distinct id(s) referenced, ${n} missing in the candidate`;
      if (n === 0) { lines.push(`ok   ${label}`); continue; }
      if (t.treatment !== 'reinstate') { lines.push(`info ${label} (treatment '${t.treatment}', not reinstated)`); continue; }
      if (ref.nullable) {
        fixups += 1;
        const conname = (await candidate(`
          SELECT conname FROM pg_constraint
           WHERE conrelid = 'public.${t.name}'::regclass AND contype = 'f'
             AND (SELECT attname FROM pg_attribute WHERE attrelid = conrelid AND attnum = conkey[1]) = $1`, [ref.column]))[0]?.conname;
        lines.push(`WARN ${label} — reinstating this table as-is will fail the FK. Documented exception path (docs/production-promotion.md §7.4):`);
        lines.push(`       ALTER TABLE public.${t.name} DROP CONSTRAINT ${String(conname ?? '<fk constraint>')};`);
        lines.push(`       -- pg_restore --data-only --table=${t.name} … (as in the plan)`);
        lines.push(`       UPDATE public.${t.name} SET ${ref.column} = NULL WHERE ${ref.column} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.${ref.references} r WHERE r.id = ${ref.column});`);
        lines.push(`       ALTER TABLE public.${t.name} ADD CONSTRAINT ${String(conname ?? '<fk constraint>')} FOREIGN KEY (${ref.column}) REFERENCES public.${ref.references}(id);`);
      } else {
        fail = true;
        lines.push(`FAIL ${label} — NOT NULL reference cannot be reinstated; the contract must decide this table`);
      }
    }
  }
  report.add('Dangling references from production-owned rows into rebuilt data', fail ? 'FAIL' : (fixups ? 'WARN' : 'PASS'), lines);
}

async function gateFingerprint(q: Query, expected: string, report: Report): Promise<void> {
  const sections = await collectSections((text) => q(text));
  const fp = fingerprintOf(sections);
  const ok = fp.overall === expected;
  report.add('Catalog fingerprint of the rebuilt source', ok ? 'PASS' : 'FAIL', [
    `fingerprint : ${fp.overall}`,
    `expected    : ${expected}`,
    ok ? 'the source is byte-identical, by catalog, to the recorded rebuild' : 'the source catalog differs from the recorded rebuild — do not promote it',
  ]);
}

// ---------------------------------------------------------------------------
// Plan and checklist (no database contact)
// ---------------------------------------------------------------------------

export function writePlan(opts: Options): string[] {
  const input = {
    candidate: opts.database!, oldDatabase: opts.oldDatabase!,
    preCutoverDump: opts.preCutoverDump!, rebuiltDump: opts.rebuiltDump!,
  };
  const dir = opts.planDir!;
  mkdirSync(dir, { recursive: true });
  const files = [
    ['promotion-truncate.sql', truncateSql()],
    ['promotion-resync-identity.sql', resyncIdentitySql()],
    ['promotion-audit-marker.sql', auditMarkerSql(input)],
    ['promotion-reinstate.sh', reinstatePlan(input)],
  ] as const;
  const written: string[] = [];
  for (const [name, content] of files) {
    const path = join(dir, name);
    if (existsSync(path)) throw new PromotionRefused(`${path} already exists; refusing to overwrite a plan file.`);
    writeFileSync(path, content, { encoding: 'utf8', mode: 0o600 });
    written.push(path);
  }
  return written;
}

export function printChecklist(): void {
  console.log('AFLDB-ISSUE-125 production promotion — acceptance checklist');
  console.log('(docs/production-promotion.md is the procedure; this is the list an operator ticks)\n');
  ACCEPTANCE_CHECKLIST.forEach((item, i) => console.log(`  [ ] ${String(i + 1).padStart(2)}. ${item}`));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function loadEnv(): void {
  try {
    for (const line of readFileSync(join(PROJECT_ROOT, '.env'), 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const [key, ...rest] = trimmed.split('=');
      if (!process.env[key.trim()]) process.env[key.trim()] = rest.join('=').trim();
    }
  } catch { /* CI supplies the variables directly */ }
}

async function openReadOnly(dsn: string, name: string): Promise<{ q: Query; end: () => Promise<void> }> {
  const postgres = (await import('postgres')).default;
  const sql = postgres(dsn, { max: 1, onnotice: () => {}, connection: { application_name: `afldb-promotion-check:${name}` } });
  const q: Query = (text, params) => sql.unsafe(text, (params ?? []) as never[]).then((rows) => rows as unknown as Row[]);
  await q(READ_ONLY_SQL);
  return { q, end: () => sql.end({ timeout: 5 }) };
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.checklist) { printChecklist(); return 0; }
  if (opts.plan) {
    const written = writePlan(opts);
    console.log('AFLDB-ISSUE-125 promotion plan written (nothing executed, no database contacted):');
    for (const path of written) console.log(`  ${path}`);
    console.log('\nRead every file before running it. The .sh is a transcript to follow, not a script to pipe.');
    return 0;
  }

  loadEnv();
  const baseDsn = process.env[opts.dsnEnv];
  if (!baseDsn) throw new PromotionRefused(`${opts.dsnEnv} is not set.`);
  const dsn = withDatabase(baseDsn, opts.database!);
  const phase = opts.phase!;

  console.log(`AFLDB-ISSUE-125 production promotion check — phase '${phase}'`);
  console.log(`  mode      : READ-ONLY (server-enforced), no DDL, no DML, no restore path`);
  console.log(`  target    : ${opts.database} via ${opts.dsnEnv} (database name replaced; DSN host/role unchanged: ${databaseOf(baseDsn)} -> ${opts.database})`);

  const report = new Report();
  const conn = await openReadOnly(dsn, phase);
  let old: { q: Query; end: () => Promise<void> } | undefined;
  try {
    await gateIdentity(conn.q, opts.database!, report);
    const { present } = await gateClassification(conn.q, report);
    await gateMigrationParity(conn.q, report);
    if (opts.expectFingerprint) await gateFingerprint(conn.q, opts.expectFingerprint, report);
    const fixtures = await gateFixtureIdentities(conn.q, present, phase, report);
    const superAdmins = await gateSuperAdmin(conn.q, present, phase, opts.expectSuperAdmin, report);
    const counts = await gateInventory(conn.q, present, report);
    await gatePrivileges(conn.q, present, phase === 'candidate' || phase === 'production', report);

    if (phase === 'restored') {
      old = await openReadOnly(withDatabase(baseDsn, opts.oldDatabase!), 'old');
      const oldName = String((await old.q('SELECT current_database() AS d'))[0]?.d);
      if (oldName !== opts.oldDatabase) throw new PromotionRefused(`Old database connection landed on '${oldName}', not '${opts.oldDatabase}'.`);
      await gateDanglingReferences(conn.q, old.q, present, report);
    }
    if (opts.compare) gateCompare(opts.compare, counts, report);

    if (opts.snapshot) {
      const snapshot: Snapshot = {
        issue: 'AFLDB-ISSUE-125', database: opts.database!, takenAt: new Date().toISOString(),
        counts, superAdmins, fixtureRows: fixtures,
      };
      if (existsSync(opts.snapshot)) throw new PromotionRefused(`${opts.snapshot} already exists; refusing to overwrite a snapshot.`);
      writeFileSync(opts.snapshot, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      report.add('Snapshot written', 'INFO', [opts.snapshot, 'row counts only — no row content, no identities, no secrets']);
    }
  } finally {
    await conn.end();
    if (old) await old.end();
  }

  const failed = report.results.filter((r) => r.verdict === 'FAIL').map((r) => r.gate);
  console.log(`\n${'='.repeat(78)}`);
  if (failed.length === 0) {
    console.log(`PROMOTION CHECK (${phase}): PASS — ${report.results.length} gate(s) evaluated, none failed.`);
    return 0;
  }
  console.log(`PROMOTION CHECK (${phase}): REFUSED — ${failed.length} gate(s) failed:`);
  for (const gate of failed) console.log(`  - ${gate}`);
  console.log('Do not proceed past this phase until every failed gate passes.');
  return 1;
}

if (process.argv[1] && /promotion-check\.ts$/.test(process.argv[1])) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error instanceof PromotionRefused ? `REFUSED: ${error.message}` : error);
      process.exit(1);
    });
}
