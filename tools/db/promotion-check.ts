/**
 * AFLDB-ISSUE-125 — READ-ONLY production promotion preflight and acceptance checker.
 *
 *     npm run db:promotion:check -- --phase source      --database afldb_test
 *     npm run db:promotion:check -- --phase pre-cutover --database afldb_prod \
 *         --snapshot ~/backups/afldb/promotion-<stamp>.json --expect-super-admin <email>
 *     npm run db:promotion:check -- --phase restored    --database afldb_prod_candidate_<stamp> \
 *         --old-database afldb_prod [--lineage-remap-out <file>]
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
 * Every form above is the PRODUCTION contract, which is the default. AFLDB-ISSUE-141 adds an
 * explicit `--environment prod|dev`, so the same supported path can converge `afldb_dev`
 * (AFLDB-ISSUE-139) instead of hand-written per-table dump/restore:
 *
 *     npm run db:promotion:check -- --environment dev --phase pre-cutover --database afldb_dev \
 *         --snapshot ~/backups/afldb/promotion-dev-<stamp>.json
 *     npm run db:promotion:check -- --environment dev --phase candidate \
 *         --database afldb_dev_candidate_<stamp> --compare <snapshot> [--allow-fixture-identities]
 *
 * The environment is never inferred from a database name — a typo must not select a
 * relaxation. It selects one more accepted name shape per phase, not a name-free phase, and
 * `--allow-fixture-identities` is refused outright under `prod`.
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
 * The only things it writes are a local JSON snapshot of ROW COUNTS (`--snapshot`), the
 * `--plan` SQL/command files, and — AFLDB-ISSUE-142 — the `--lineage-remap-out` file, all of
 * which the operator reads and runs by hand. No DSN, no password, no hash and no secret is
 * ever printed or written; email addresses are printed only when they are test fixtures
 * being refused, and the remap file carries row ids and AFL Tables profile paths only.
 */

import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHash, randomBytes } from 'node:crypto';

import { collectSections, fingerprintOf, type Row } from './catalog-fingerprint';
import { computeChecksumRepresentations, matchesStoredChecksum } from './migration-checksum';
import {
  AFL_API_G2_REFUSING_OUTCOMES,
  AFL_API_REBUILD_MARKER_FORMAT,
  AflApiPromotionFileRefused,
  aflApiDevRegenerationBindingProblems,
  aflApiDevRegenerationEntriesFromG3,
  aflApiG2AgreeSet,
  aflApiImporterStateSha256,
  aflApiLedgerStateSha256,
  aflApiReverseIdentityPaths,
  aflApiSupersedeBindingProblems,
  aflApiSupersedeMismatch,
  buildAflApiDevRegenerationClassification,
  buildAflApiSupersedeFile,
  censusAflApiRows,
  checkAflApiIdentityInvariant,
  classifyAflApiDevRegenerationCensus,
  classifyAflApiForwardIdentityRows,
  classifyAflApiG1,
  classifyAflApiG2,
  classifyAflApiG3,
  classifyAflApiReverseIdentity,
  isAflApiRebuildMarkerComment,
  netLedgerRowsByExternalId,
  parseAflApiDevRegenerationClassification,
  parseAflApiSupersedeFile,
  validateAflApiDevRegenerationClassification,
  type AflApiAdjudicationLedgerRow,
  type AflApiCensusResult,
  type AflApiCensusRow,
  type AflApiDevRegenerationClassification,
  type AflApiDevRegenerationClassificationEntry,
  type AflApiForwardIdentityResult,
  type AflApiG2EntryInput,
  type AflApiG2Grade,
  type AflApiG3Grade,
  type AflApiG3Row,
  type AflApiPlayerRemapResult,
  type AflApiSupersedeFile,
} from '../../src/lib/acquisition/afl-api-adjudication';
import {
  loadFitzroyProfileContinuityRules,
  type ValidatedFitzroyProfileContinuityRules,
} from '../../src/lib/acquisition/fitzroy-profile-continuity';
import {
  ACCEPTANCE_CHECKLIST,
  DEFAULT_ENVIRONMENT,
  DERIVED_FOOTBALL_TABLES,
  EMAIL_BEARING_TABLES,
  ENVIRONMENTS,
  LINEAGE_IDENTITY_SQL,
  PHASES,
  PROMOTION_CONTRACT,
  PromotionRefused,
  TEST_FIXTURE_EMAIL_SQL,
  assertContractCoherent,
  assertDatabaseForPhase,
  assertLinuxHostPath,
  assertOldDatabaseName,
  assertPromotionPlanCoherent,
  auditMarkerSql,
  classifyPublicTables,
  compareCounts,
  databaseOf,
  detectLineageChange,
  effectiveCompare,
  effectiveTreatment,
  environmentNames,
  historicalOnlyFor,
  historicalOnlyTables,
  judgeLineage,
  judgeStagedSourceRows,
  judgeStagingLeftover,
  lineageBoundTables,
  lineageRemapSql,
  lineageTargetsOf,
  isStagedLineageColumn,
  matchKeysOfOverrides,
  applyManualIdentityConvergence,
  convergencePathsToRead,
  EMPTY_MANUAL_IDENTITY_CONVERGENCE,
  planManualIdentityConvergence,
  planPromotionMatchReplay,
  planPromotionPlayersReplay,
  playerIdentityKeysOfOverrides,
  promotionPlayerCheckProblems,
  stableLineageTargetForFootballRef,
  promoteStagedSql,
  publicContractTables,
  quoteIdent,
  quoteSqlLiteral,
  reinstatePlan,
  reinstatedSchemas,
  rollbackSql,
  resolveLineageRemap,
  resyncIdentitySql,
  rowIdColumnOf,
  shellQuote,
  stageSql,
  STAGING_SCHEMA,
  swapSql,
  truncateSql,
  withDatabase,
  type CompareRule,
  type Environment,
  type HistoricalOnly,
  type IdentityPair,
  type LineageColumnPlan,
  type LineageIdentityRule,
  type LineageRef,
  type LineageSample,
  type LineageTarget,
  type ManualIdentityConvergenceEntry,
  type ManualIdentityConvergencePlan,
  type Phase,
  type PromotionIdentityRow,
  type PromotionMatchReplayPlan,
  type PromotionOverrideRow,
  type PromotionPlayerCheckRow,
  type PromotionPlayersReplayPlan,
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
  /** AFLDB-ISSUE-141. Always explicit, always defaulted to `prod`, never inferred. */
  environment: Environment;
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
  /**
   * DEV-only conscious acceptance of test-fixture identities. It does not skip the scan and
   * it does not hide a row: the gate still runs, still lists EVERY offending address (the
   * ten-row sample cap is lifted), and reports WARN instead of FAIL. Refused under `prod`.
   */
  allowFixtureIdentities: boolean;
  /**
   * AFLDB-ISSUE-142 (B). Where to write the evidenced lineage remap the `restored` phase
   * computes when the candidate does not share the replaced database's id lineage. Reading
   * both databases is the only way to compute it, so it belongs to a phase, not to `--plan`.
   */
  lineageRemapOut?: string;
  /**
   * AFLDB-ISSUE-237 §6.3 point 3. The operator-authored, hash-bound classification of target
   * `afl_api_stat_vector_season` rows intentionally regenerated on DEV after re-acquisition.
   * Consulted by G3 at `--phase restored` (DEV only) and by `--phase dev-regeneration-census`.
   * Refused outright under `--environment prod` (D14: no general WARN in production).
   */
  aflApiDevRegeneration?: string;
  /**
   * AFLDB-ISSUE-237 D9. Where to write G2's AGREE list (`E_promotion`), the exact provider
   * set the post-swap D15 replay is permitted to supersede. Written at `--phase restored`
   * only, so the replay step never has to derive its own expected set — and (F-L4-4) only
   * when that whole run PASSES, atomically, bound to the candidate importer state and the
   * target ledger state it was derived from.
   */
  aflApiSupersedeOut?: string;
  /**
   * AFLDB-ISSUE-237 F-L4-3. The bound supersede file `--phase restored` wrote, re-read at
   * `--phase candidate` (required there): the candidate's reinstated ledger must be exactly
   * the target ledger G2 evaluated, and re-evaluating G2 on the candidate must reproduce the
   * same `E_promotion`.
   */
  aflApiSupersedeIn?: string;
  /**
   * AFLDB-ISSUE-237 F-L4-5. DEV only, `--phase restored` only: write the regeneration
   * classification from G3's own grades when G3's ONLY failures are hard losses of
   * `afl_api_stat_vector_season` rows. It is a proposal, not an approval: approval is a
   * second `--phase restored` run that consumes it through `--afl-api-dev-regeneration`.
   */
  aflApiDevRegenerationOut?: string;
  aflApiRegenerationSeason?: number;
  aflApiRegenerationReason?: string;
  aflApiRegenerationPlan?: string;
};

export function parseArgs(argv: readonly string[]): Options {
  const out: Options = {
    environment: DEFAULT_ENVIRONMENT, dsnEnv: DEFAULT_DSN_ENV,
    plan: false, checklist: false, allowFixtureIdentities: false,
  };
  const need = (i: number, flag: string): string => {
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new PromotionRefused(`${flag} needs a value.`);
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--environment': {
        const value = need(i, arg);
        if (!ENVIRONMENTS.includes(value as Environment)) {
          throw new PromotionRefused(
            `Unknown environment '${value}'. Valid environments: ${ENVIRONMENTS.join(', ')} (default ${DEFAULT_ENVIRONMENT}).`);
        }
        out.environment = value as Environment; i += 1; break;
      }
      case '--allow-fixture-identities': out.allowFixtureIdentities = true; break;
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
      case '--lineage-remap-out': out.lineageRemapOut = need(i, arg); i += 1; break;
      case '--afl-api-dev-regeneration': out.aflApiDevRegeneration = need(i, arg); i += 1; break;
      case '--afl-api-supersede-out': out.aflApiSupersedeOut = need(i, arg); i += 1; break;
      case '--afl-api-supersede-in': out.aflApiSupersedeIn = need(i, arg); i += 1; break;
      case '--afl-api-dev-regeneration-out': out.aflApiDevRegenerationOut = need(i, arg); i += 1; break;
      case '--afl-api-regeneration-season': {
        const value = need(i, arg);
        if (!/^[12][0-9]{3}$/.test(value)) throw new PromotionRefused('--afl-api-regeneration-season needs a four-digit year.');
        out.aflApiRegenerationSeason = Number(value); i += 1; break;
      }
      case '--afl-api-regeneration-reason': out.aflApiRegenerationReason = need(i, arg); i += 1; break;
      case '--afl-api-regeneration-plan': out.aflApiRegenerationPlan = need(i, arg); i += 1; break;
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

  // Checked before every early return: the relaxation must never be silently ignored
  // because it was combined with a mode that does not consult it.
  if (out.allowFixtureIdentities && out.environment !== 'dev') {
    throw new PromotionRefused(
      '--allow-fixture-identities is a DEV-only conscious acceptance and needs --environment dev. '
      + 'A reserved-domain identity can never be a production identity.');
  }
  if (out.aflApiDevRegeneration && out.environment !== 'dev') {
    throw new PromotionRefused(
      '--afl-api-dev-regeneration is a DEV-only regeneration classification (AFLDB-ISSUE-237 D14) '
      + 'and needs --environment dev. Production has no general WARN for importer identity loss.');
  }
  const regenerationCompanions = [
    out.aflApiRegenerationSeason !== undefined, out.aflApiRegenerationReason !== undefined,
    out.aflApiRegenerationPlan !== undefined,
  ];
  if ((out.aflApiDevRegenerationOut || regenerationCompanions.some(Boolean)) && out.environment !== 'dev') {
    throw new PromotionRefused(
      '--afl-api-dev-regeneration-out and its --afl-api-regeneration-* inputs are DEV-only '
      + '(AFLDB-ISSUE-237 D14) and need --environment dev.');
  }

  if (out.checklist) return out;

  if (!out.database) throw new PromotionRefused('--database is required: name the database explicitly.');

  const names = environmentNames(out.environment);

  if (out.plan) {
    if (!out.database.startsWith(names.candidatePrefix) || out.database.length === names.candidatePrefix.length) {
      throw new PromotionRefused(`--plan needs --database ${names.candidatePrefix}<stamp>: the plan is only ever run on a candidate.`);
    }
    if (!out.oldDatabase) throw new PromotionRefused(`--plan needs --old-database (the ${names.live} database being replaced).`);
    assertOldDatabaseName(out.oldDatabase, out.environment);
    if (out.oldDatabase !== names.live) {
      throw new PromotionRefused(`--plan must be generated before cutover with --old-database ${names.live}.`);
    }
    if (!out.preCutoverDump) throw new PromotionRefused('--plan needs --pre-cutover-dump <file>.');
    if (!out.rebuiltDump) throw new PromotionRefused('--plan needs --rebuilt-dump <file>.');
    assertLinuxHostPath(out.preCutoverDump, '--pre-cutover-dump');
    assertLinuxHostPath(out.rebuiltDump, '--rebuilt-dump');
    if (!out.planDir) throw new PromotionRefused('--plan needs --plan-dir <dir> to write the SQL files into.');
    return out;
  }

  if (!out.phase) throw new PromotionRefused(`--phase is required. Valid phases: ${PHASES.join(', ')}.`);
  assertDatabaseForPhase(out.phase, out.database, out.environment);
  if (out.phase === 'restored') {
    if (!out.oldDatabase) {
      throw new PromotionRefused("Phase 'restored' needs --old-database so dangling references can be probed.");
    }
    assertOldDatabaseName(out.oldDatabase, out.environment);
  } else if (out.oldDatabase) {
    throw new PromotionRefused("--old-database is only meaningful with --phase restored.");
  }
  if (out.lineageRemapOut && out.phase !== 'restored') {
    throw new PromotionRefused(
      "--lineage-remap-out is only meaningful with --phase restored: the remap is computed by "
      + 'reading the candidate and the database it replaces in the same pass.');
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
  if (out.aflApiDevRegeneration && out.phase !== 'restored' && out.phase !== 'dev-regeneration-census') {
    throw new PromotionRefused(
      '--afl-api-dev-regeneration is only meaningful with --phase restored or '
      + '--phase dev-regeneration-census.');
  }
  if (out.phase === 'dev-regeneration-census' && !out.aflApiDevRegeneration) {
    throw new PromotionRefused("Phase 'dev-regeneration-census' needs --afl-api-dev-regeneration <file>.");
  }
  if (out.aflApiSupersedeOut && out.phase !== 'restored') {
    throw new PromotionRefused(
      '--afl-api-supersede-out is only meaningful with --phase restored: E_promotion is '
      + "G2's own AGREE list, computed there.");
  }
  if (out.aflApiSupersedeIn && out.phase !== 'candidate') {
    throw new PromotionRefused(
      '--afl-api-supersede-in is only meaningful with --phase candidate: it verifies the reinstated '
      + 'target ledger against the E_promotion file --phase restored wrote.');
  }
  if (out.aflApiDevRegenerationOut || regenerationCompanions.some(Boolean)) {
    if (out.phase !== 'restored') {
      throw new PromotionRefused(
        '--afl-api-dev-regeneration-out is only meaningful with --phase restored: it is generated '
        + "from G3's own comparison of the candidate and the target.");
    }
    if (!out.aflApiDevRegenerationOut || !regenerationCompanions.every(Boolean)) {
      throw new PromotionRefused(
        '--afl-api-dev-regeneration-out needs all of --afl-api-regeneration-season <yyyy>, '
        + '--afl-api-regeneration-reason <text> and --afl-api-regeneration-plan <text>, and they need it.');
    }
    if (out.aflApiDevRegeneration) {
      throw new PromotionRefused(
        '--afl-api-dev-regeneration-out cannot be combined with --afl-api-dev-regeneration: a run either '
        + 'proposes a classification or consumes one, never both.');
    }
  }
  // Last, so every narrower scoping message above wins. F-L4-3: a candidate may hold the
  // target's reinstated human ledger only when that ledger is proven to be the one G2 graded.
  if (out.phase === 'candidate' && !out.aflApiSupersedeIn) {
    throw new PromotionRefused(
      "Phase 'candidate' needs --afl-api-supersede-in <file>: the E_promotion file --phase restored wrote "
      + '(AFLDB-ISSUE-237). It binds the reinstated human ledger and the candidate importer state.');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Gate bookkeeping
// ---------------------------------------------------------------------------

type Verdict = 'PASS' | 'FAIL' | 'INFO' | 'WARN';
type GateResult = { gate: string; verdict: Verdict; lines: string[] };

export class Report {
  readonly results: GateResult[] = [];
  add(gate: string, verdict: Verdict, lines: string[] = []): void {
    this.results.push({ gate, verdict, lines });
    console.log(`\n[${verdict.padEnd(4)}] ${gate}`);
    for (const line of lines) console.log(`       ${line}`);
  }
  get failed(): boolean { return this.results.some((r) => r.verdict === 'FAIL'); }
}

export type Query = (text: string, params?: unknown[]) => Promise<Row[]>;

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

/**
 * AFLDB-ISSUE-151: the staging schema exists only between plan steps 2b and 2d. Present at
 * any phase, it is an interrupted staged reinstatement and the check refuses — the operator
 * inspects it first; nothing generated ever reuses or removes it.
 */
async function gateStagingLeftover(q: Query, report: Report): Promise<void> {
  const gate = `No leftover ${STAGING_SCHEMA} schema (AFLDB-ISSUE-151)`;
  const schema = await q('SELECT 1 AS present FROM pg_namespace WHERE nspname = $1', [STAGING_SCHEMA]);
  if (schema.length === 0) {
    const verdict = judgeStagingLeftover(null);
    report.add(gate, verdict.verdict, verdict.lines);
    return;
  }
  const tables = (await q('SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY 1', [STAGING_SCHEMA]))
    .map((r) => String(r.tablename));
  const found: { table: string; rows: number }[] = [];
  for (const table of tables) {
    const n = asInt((await q(`SELECT count(*)::int AS n FROM ${quoteIdent(STAGING_SCHEMA)}.${quoteIdent(table)}`))[0]?.n);
    found.push({ table, rows: n });
  }
  const verdict = judgeStagingLeftover(found);
  report.add(gate, verdict.verdict, verdict.lines);
}

/**
 * AFLDB-ISSUE-151: a staged table must hold rows in the database being replaced, unless its
 * contract declares `stagedMayBeEmpty` (AFLDB-ISSUE-247), in which case the promotion
 * accepts its zero only on the stage-completion evidence the plan records. Judged here, at
 * pre-cutover, so an undecided empty table never reaches a half-run transcript.
 */
function gateStagedSourceRows(counts: Record<string, number>, environment: Environment, report: Report): void {
  const gate = 'Staged tables hold rows in the replaced database (AFLDB-ISSUE-151)';
  const judged = judgeStagedSourceRows(counts, environment);
  const lines = judged.populated.map((p) => `${p.table.padEnd(30)} ${String(p.rows).padStart(8)}  staged`);
  for (const { table, decidedBy } of judged.emptyPermitted) {
    lines.push(`${table.padEnd(30)} ${'0'.padStart(8)}  staged — EMPTY, permitted by contract (${decidedBy}); `
      + 'promoted only on stage-completion evidence');
  }
  for (const table of judged.empty) {
    lines.push(`${table.padEnd(30)} ${'0'.padStart(8)}  staged — EMPTY: the staged reinstatement presumes rows`);
  }
  for (const table of judged.missing) lines.push(`${table.padEnd(30)}   absent  staged — the table itself is missing`);
  if (judged.verdict === 'FAIL') {
    lines.push('promotion-promote-staged.sql would refuse an empty staging copy mid-transcript; decide the');
    lines.push("table's disposition now (docs/production-promotion.md §7.2) rather than promote past it.");
  }
  if (judged.populated.length + judged.emptyPermitted.length + judged.empty.length + judged.missing.length === 0) {
    lines.push('no staged table in this environment');
  }
  report.add(gate, judged.verdict, lines);
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
  q: Query, present: readonly string[], phase: Phase, environment: Environment,
  allowAccepted: boolean, report: Report,
): Promise<number> {
  const mustBeAbsent = phase === 'pre-cutover' || phase === 'candidate' || phase === 'production';
  // AFLDB-ISSUE-141. Conscious acceptance means SEEING what is accepted: with the override
  // in play the sample cap is lifted, so every offending address is printed, not ten of them.
  const sampleLimit = allowAccepted ? '' : ' LIMIT 10';
  let total = 0;
  const lines: string[] = [];
  for (const table of EMAIL_BEARING_TABLES) {
    if (!present.includes(table)) { lines.push(`${table}: absent`); continue; }
    const relation = `${quoteIdent('public')}.${quoteIdent(table)}`;
    const rows = await q(`
      SELECT count(*)::int AS n,
             (SELECT array_agg(email ORDER BY email)
                FROM (SELECT email FROM ${relation} WHERE ${TEST_FIXTURE_EMAIL_SQL} ORDER BY email${sampleLimit}) s) AS sample
        FROM ${relation}
       WHERE ${TEST_FIXTURE_EMAIL_SQL}`);
    const n = asInt(rows[0]?.n);
    total += n;
    const sample = Array.isArray(rows[0]?.sample) ? (rows[0]?.sample as string[]) : [];
    lines.push(`${table.padEnd(20)} ${String(n).padStart(6)} fixture-domain row(s)${n ? `: ${sample.join(', ')}${n > sample.length ? ', …' : ''}` : ''}`);
  }
  if (total === 0) {
    report.add('Test-fixture identities (reserved domains: .test .example .invalid .localhost, example.com/net/org)', 'PASS', lines);
  } else if (mustBeAbsent && allowAccepted) {
    // environment === 'dev' is guaranteed here: parseArgs refuses the flag under prod.
    lines.push(`${total} fixture identity row(s) CONSCIOUSLY ACCEPTED under --environment dev --allow-fixture-identities.`);
    lines.push('Accepted, not cleared, and every offending address is listed above.');
    lines.push('This database must never become production: the prod contract refuses these rows and has no such flag.');
    report.add('Test-fixture identities (accepted, DEV only)', 'WARN', lines);
  } else if (mustBeAbsent) {
    lines.push(environment === 'prod'
      ? 'A reserved-domain identity can never be a production identity. REFUSED.'
      : 'A reserved-domain identity is refused by default here too. Accept it deliberately with '
        + '--allow-fixture-identities, or remove the rows. REFUSED.');
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
  q: Query, present: readonly string[], phase: Phase, environment: Environment,
  expected: string | undefined, report: Report,
): Promise<number> {
  const gate = environment === 'prod' ? 'Production super admin' : 'DEV super admin';
  if (!present.includes('auth_users')) {
    report.add(gate, 'FAIL', ['auth_users is absent.']);
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
  // AFLDB-ISSUE-141. On production the expectation is unconditional: a database nobody can
  // administer must not be promoted. A DEV promotion protects no real human authority, so
  // the expectation is OPTIONAL there rather than silently dropped — state it with
  // --expect-super-admin and it is enforced exactly as on production; omit it and the gate
  // says so and warns.
  const enforced = required && (environment === 'prod' || expected !== undefined);
  let warn = false;
  if (required && enabled === 0) {
    if (enforced) {
      lines.push('no enabled, fully enrolled super_admin — nobody could administer this database');
      ok = false;
    } else {
      lines.push('no enabled, fully enrolled super_admin — NOT enforced under --environment dev '
        + 'without --expect-super-admin; pass it to enforce the production rule here too');
      warn = true;
    }
  }
  if (!required && !expected) lines.push('(informational in this phase)');
  const verdict: Verdict = enforced
    ? (ok ? 'PASS' : 'FAIL')
    : (ok ? (warn ? 'WARN' : 'INFO') : 'WARN');
  report.add(gate, verdict, lines);
  return enabled;
}

async function gateInventory(
  q: Query, present: readonly string[], environment: Environment, report: Report,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const lines: string[] = [];
  for (const t of publicContractTables()) {
    if (!present.includes(t.name)) { lines.push(`${t.name.padEnd(30)} absent`); continue; }
    const n = asInt((await q(
      `SELECT count(*)::int AS n FROM ${quoteIdent('public')}.${quoteIdent(t.name)}`,
    ))[0]?.n);
    counts[`public.${t.name}`] = n;
    // AFLDB-ISSUE-143: the EFFECTIVE treatment, so the transcript never says 'reinstate'
    // beside a table this environment's plan deliberately does not reinstate.
    const withheld = historicalOnlyFor(t, environment);
    lines.push(`${t.name.padEnd(30)} ${String(n).padStart(8)}  `
      + `${effectiveTreatment(t, environment).padEnd(10)} ${t.category}`
      + (withheld ? `  HISTORICAL-ONLY (${withheld.decidedBy})` : ''));
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

/**
 * AFLDB-ISSUE-143: `effectiveCompare`, so a table the plan intentionally did not reinstate
 * is expected to be EMPTY here rather than equal to the snapshot. The candidate is never
 * rejected for missing rows it was deliberately not given; every other table compares
 * exactly as before.
 */
function compareRules(environment: Environment): { table: string; rule: CompareRule }[] {
  return publicContractTables()
    .map((t) => ({ table: `public.${t.name}`, rule: effectiveCompare(t, environment) }));
}

function gateCompare(
  snapshotPath: string, counts: Record<string, number>, environment: Environment, report: Report,
): void {
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
  const rules = compareRules(environment);
  // Reinstated schemas: every table the snapshot knew must be equal.
  for (const key of Object.keys(snapshot.counts)) {
    if (!key.startsWith('public.')) rules.push({ table: key, rule: 'equal' });
  }
  const findings = compareCounts(snapshot, rules, counts);
  const lines = [`snapshot of ${snapshot.database} taken ${snapshot.takenAt}`];
  for (const { table, disposition } of historicalOnlyTables(environment)) {
    lines.push(`note public.${table.name}: HISTORICAL-ONLY, expected 0 not `
      + `${snapshot.counts[`public.${table.name}`] ?? '-'} — ${disposition.decidedBy}`);
  }
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
  candidate: Query, old: Query, present: readonly string[], environment: Environment,
  report: Report,
): Promise<void> {
  const lines: string[] = [];
  let fail = false;
  let fixups = 0;
  for (const t of PROMOTION_CONTRACT) {
    if (t.schema !== 'public' || !t.footballRefs) continue;
    const withheld = historicalOnlyFor(t, environment);
    for (const ref of t.footballRefs) {
      if (!present.includes(t.name) || !present.includes(ref.references)) { lines.push(`${t.name}.${ref.column}: table absent`); continue; }
      const relation = `${quoteIdent('public')}.${quoteIdent(t.name)}`;
      const column = quoteIdent(ref.column);
      const referencedRelation = `${quoteIdent('public')}.${quoteIdent(ref.references)}`;
      const idsRows = await old(`SELECT DISTINCT ${column} AS id FROM ${relation} WHERE ${column} IS NOT NULL ORDER BY 1`);
      const ids = idsRows.map((r) => asInt(r.id));
      if (ids.length === 0) { lines.push(`ok   ${t.name}.${ref.column} -> ${ref.references}: no references in ${'the old database'}`); continue; }
      const missing = (await candidate(`
        SELECT count(*)::int AS n FROM unnest($1::bigint[]) u(id)
         WHERE NOT EXISTS (SELECT 1 FROM ${referencedRelation} r WHERE r.id = u.id)`, [ids]))[0];
      const n = asInt(missing?.n);
      const label = `${t.name}.${ref.column} -> ${ref.references}: ${ids.length} distinct id(s) referenced, ${n} missing in the candidate`;
      if (n === 0) { lines.push(`ok   ${label}`); continue; }
      // AFLDB-ISSUE-143: this table's rows are not reinstated in this environment, so a
      // reference from them cannot dangle in the candidate. Narrow by construction — it is
      // the declared table's own reference, and every other table is judged as before.
      if (withheld) {
        lines.push(`info ${label} — HISTORICAL-ONLY under --environment ${environment}: `
          + `not reinstated, so this reference is never created (${withheld.decidedBy})`);
        continue;
      }
      if (t.treatment !== 'reinstate') { lines.push(`info ${label} (treatment '${t.treatment}', not reinstated)`); continue; }
      const stableTarget = stableLineageTargetForFootballRef(t, ref.column, ref.references);
      if (stableTarget) {
        fixups += 1;
        lines.push(`WARN ${label} — numeric ids differ, but ${stableTarget.identity} is declared as the stable identity.`);
        lines.push('       --phase restored resolves old id -> stable identity -> candidate id and writes a');
        lines.push('       guarded UPDATE through --lineage-remap-out.');
        if (!ref.nullable && isStagedLineageColumn(t.name, ref.column, environment)) {
          // AFLDB-ISSUE-151: an immediate NOT NULL FK refuses the old integer on a plain
          // restore, so the plan stages this table and the remap lands in the staging schema.
          lines.push(`       NOT NULL: the plan STAGES ${t.name} (AFLDB-ISSUE-151) — restored into promotion_staging`);
          lines.push('       with no FK, the remap applied THERE at plan step 2c, then promoted into public under');
          lines.push('       the FK with its ids preserved. Never restore this table straight into public.');
        } else {
          lines.push('       Apply it at the plan\'s remap step (promotion-reinstate.sh step 2c), before acceptance.');
        }
        continue;
      }
      if (ref.nullable) {
        fixups += 1;
        const conname = (await candidate(`
          SELECT conname FROM pg_constraint
           WHERE conrelid = ${quoteSqlLiteral(`public.${t.name}`)}::regclass AND contype = 'f'
             AND (SELECT attname FROM pg_attribute WHERE attrelid = conrelid AND attnum = conkey[1]) = $1`, [ref.column]))[0]?.conname;
        const constraint = conname ? quoteIdent(String(conname)) : '<quote-the-fk-constraint-name>';
        lines.push(`WARN ${label} — reinstating this table as-is will fail the FK. Documented exception path (docs/production-promotion.md §7.4):`);
        lines.push(`       ALTER TABLE ${relation} DROP CONSTRAINT ${constraint};`);
        lines.push(`       -- pg_restore --data-only --table=${shellQuote(`public.${t.name}`)} … (as in the plan)`);
        lines.push(`       UPDATE ${relation} SET ${column} = NULL WHERE ${column} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${referencedRelation} r WHERE r.id = ${column});`);
        lines.push(`       ALTER TABLE ${relation} ADD CONSTRAINT ${constraint} FOREIGN KEY (${column}) REFERENCES ${referencedRelation}(id);`);
      } else {
        fail = true;
        lines.push(`FAIL ${label} — NOT NULL reference cannot be reinstated as-is`);
        // AFLDB-ISSUE-141: where the contract HAS decided this case, print its decision
        // rather than asking for one. A NOT NULL reference with no remediation recorded is
        // still an undecided table, which is what the original message meant.
        for (const line of (ref.remediation ?? 'the contract must decide this table').split('\n')) {
          lines.push(`       ${line}`);
        }
      }
    }
  }
  report.add('Dangling references from production-owned rows into rebuilt data', fail ? 'FAIL' : (fixups ? 'WARN' : 'PASS'), lines);
}

// ---------------------------------------------------------------------------
// Lineage identity — AFLDB-ISSUE-142 (B)
// ---------------------------------------------------------------------------

/** Ids compared to decide whether the two databases share an id lineage. */
const LINEAGE_SAMPLE_LIMIT = 50;
/**
 * A per-row remap is only honest while the rows can be enumerated and read by an operator.
 * Beyond this the contract needs a set-based answer, so the gate refuses rather than
 * emitting a file nobody can check.
 */
const LINEAGE_ROW_CAP = 5000;
/** Unresolved ids printed per column before the transcript says how many more there are. */
const LINEAGE_PRINT_LIMIT = 20;

async function identitiesById(
  q: Query, rule: Exclude<LineageIdentityRule, 'none'>, ids: readonly number[],
): Promise<IdentityPair[]> {
  if (ids.length === 0) return [];
  const rows = await q(LINEAGE_IDENTITY_SQL[rule].byId, [ids]);
  return rows.map((r) => ({ id: asInt(r.id), identity: String(r.identity) }));
}

async function identitiesByIdentity(
  q: Query, rule: Exclude<LineageIdentityRule, 'none'>, identities: readonly string[],
): Promise<IdentityPair[]> {
  if (identities.length === 0) return [];
  const rows = await q(LINEAGE_IDENTITY_SQL[rule].byIdentity, [identities]);
  return rows.map((r) => ({ id: asInt(r.id), identity: String(r.identity) }));
}

/**
 * Does a reinstated id still mean the same thing?
 *
 * `gateDanglingReferences` asks only whether an id EXISTS in the candidate. Existence is not
 * identity: when the candidate comes from a different id lineage almost every id exists and
 * denotes a different row, so "0 missing" is exactly the answer a silent misattribution
 * gives. This gate asks the other question, from evidence on both databases:
 *
 *   1. sample ids that exist on both sides and compare their STABLE identity. Equal on every
 *      comparable sample -> one lineage -> id-keyed reinstatement is sound (the production
 *      case, where the candidate is a rebuild of the same lineage) and the gate passes;
 *   2. otherwise every lineage-bound column declared in the contract is resolved old id ->
 *      identity -> new id, per row, and anything not evidenced REFUSES.
 *
 * Fails closed in both directions: no comparable sample counts as a lineage change.
 */
async function gateLineageIdentity(
  candidate: Query, old: Query, present: readonly string[], remapOut: string | undefined,
  candidateName: string, oldName: string, environment: Environment, report: Report,
  convergence: readonly ManualIdentityConvergenceEntry[] = [],
): Promise<string | undefined> {
  const tables = lineageBoundTables().filter((t) => present.includes(t.name));
  const lines: string[] = [];
  if (tables.length === 0) {
    // AFLDB-ISSUE-242: the convergence rides the remap file; with no remap step it cannot run.
    report.add('Lineage identity of reinstated id-keyed rows', convergence.length > 0 ? 'FAIL' : 'INFO', [
      'no reinstated table declares a lineage-bound column on this database',
      ...(convergence.length > 0
        ? [`${convergence.length} AFLDB-ISSUE-242 convergence(s) need the plan's remap step, which this database does not have`]
        : []),
    ]);
    return undefined;
  }

  // 1. Read the referenced ids and their rows from the database being replaced.
  type Slot = { table: string; ref: LineageRef; target: LineageTarget;
    /** AFLDB-ISSUE-143: set only where the contract withholds this table HERE. */
    disposition?: HistoricalOnly;
    totalRows: number; enumerated: boolean;
    rows: { rowId: number; oldValue: number }[] };
  const slots: Slot[] = [];
  for (const t of tables) {
    const declared = historicalOnlyFor(t, environment);
    for (const { ref, target } of lineageTargetsOf(t)) {
      // Column-exact, not table-level: the declaration must name THIS column. (The contract
      // coherence check already requires it to name every one, so this can only agree — but
      // the acceptance site should read the same rule `judgeLineage` applies.)
      const disposition = declared?.columns.includes(ref.column) ? declared : undefined;
      const relation = `${quoteIdent('public')}.${quoteIdent(t.name)}`;
      const column = quoteIdent(ref.column);
      const where = ref.kindColumn ? ` AND ${quoteIdent(ref.kindColumn)} = $1` : '';
      const params = ref.kindColumn ? [target.kind] : [];
      const totalRows = asInt((await old(
        `SELECT count(*)::int AS n FROM ${relation}
          WHERE ${column} IS NOT NULL${where}`, params))[0]?.n);
      if (totalRows > LINEAGE_ROW_CAP) {
        // The cap exists because a per-row remap is only honest while an operator can read
        // it. A withheld table generates no remap at all, so the cap does not apply to it —
        // its rows are still COUNTED and reported, just not enumerated.
        if (!disposition) {
          lines.push(`FAIL ${t.name}.${ref.column}: ${totalRows} rows exceed the ${LINEAGE_ROW_CAP}-row`
            + ' per-row remap cap — the contract needs a set-based treatment for this table');
          report.add('Lineage identity of reinstated id-keyed rows', 'FAIL', lines);
          return undefined;
        }
        slots.push({ table: t.name, ref, target, disposition, totalRows, enumerated: false, rows: [] });
        continue;
      }
      // AFLDB-ISSUE-155: the row anchor is the table's own identifying column, not always
      // `id` (brownlow_vote_entry_state's primary key is match_id itself).
      const rowIdCol = quoteIdent(rowIdColumnOf(t));
      const rows = await old(
        `SELECT ${rowIdCol}::bigint AS row_id, ${column}::bigint AS old_value
           FROM ${relation}
          WHERE ${column} IS NOT NULL${where}
          ORDER BY ${rowIdCol}`, params);
      slots.push({
        table: t.name, ref, target, disposition, totalRows, enumerated: true,
        rows: rows.map((r) => ({ rowId: asInt(r.row_id), oldValue: asInt(r.old_value) })),
      });
    }
  }

  // 2. Decide whether the lineage changed at all, from identities read on both sides.
  const rules = [...new Set(slots.map((s) => s.target.identity))]
    .filter((r): r is Exclude<LineageIdentityRule, 'none'> => r !== 'none');
  const samples: LineageSample[] = [];
  for (const rule of rules) {
    const entity = LINEAGE_IDENTITY_SQL[rule].entity;
    if (!present.includes(entity)) {
      lines.push(`incomparable ${entity}: absent from the candidate`);
      continue;
    }
    const referenced = [...new Set(slots.filter((s) => s.target.identity === rule)
      .flatMap((s) => s.rows.map((r) => r.oldValue)))].sort((a, b) => a - b);
    const spread = (await old(
      `SELECT id::bigint AS id FROM ${quoteIdent('public')}.${quoteIdent(entity)} ORDER BY id LIMIT ${LINEAGE_SAMPLE_LIMIT}`))
      .map((r) => asInt(r.id));
    const ids = [...new Set([...referenced.slice(0, LINEAGE_SAMPLE_LIMIT), ...spread])];
    const before = new Map((await identitiesById(old, rule, ids)).map((p) => [p.id, p.identity] as const));
    const after = new Map((await identitiesById(candidate, rule, ids)).map((p) => [p.id, p.identity] as const));
    for (const id of ids) samples.push({ id, replaced: before.get(id), candidate: after.get(id) });
    lines.push(`${entity}: ${ids.length} id(s) compared by ${rule} (${LINEAGE_IDENTITY_SQL[rule].description})`);
  }

  const verdict = detectLineageChange(samples);
  lines.push(`identity agreed on ${verdict.agreed} sampled id(s), differed on ${verdict.differed.length}, `
    + `${verdict.incomparable} incomparable`);
  for (const d of verdict.differed.slice(0, 5)) {
    lines.push(`  id ${d.id}: ${oldName} = ${d.replaced} vs ${candidateName} = ${d.candidate}`);
  }
  // The one place the remap is generated. AFLDB-ISSUE-151: the plan applies it at a fixed
  // step (2c) whenever a staged table exists, so on a shared lineage it is still generated — as
  // an explicit no-op holding no UPDATE — rather than leaving the step with nothing to run.
  // AFLDB-ISSUE-237 L4: it is only PREPARED here. `publishRestoredLineageRemap` writes it after
  // every gate of the run, and only if none failed, so a refused run leaves no remap to consume.
  let remapSql: string | undefined;
  const prepareRemap = (plans: readonly LineageColumnPlan[], shared: boolean): void => {
    if (!remapOut) {
      lines.push('re-run with --lineage-remap-out <file> to write the evidenced per-row remap');
      return;
    }
    remapSql = lineageRemapSql({ candidate: candidateName, oldDatabase: oldName, environment, plans, convergence });
    lines.push(shared && convergence.length === 0
      ? `remap prepared for ${remapOut} — an explicit no-op (shared lineage, no UPDATE); the plan still runs it at step 2c`
      : `remap prepared for ${remapOut} — read it, then run it at the plan's remap step (promotion-reinstate.sh 2c)`);
    if (convergence.length > 0) {
      lines.push(`it carries ${convergence.length} AFLDB-ISSUE-242 manual identity convergence(s), in the same transaction`);
    }
    lines.push('it is written only if every gate of this run passes, and it refuses to run on any database but '
      + `${candidateName}`);
  };
  if (!verdict.changed) {
    lines.push(`${candidateName} shares the id lineage of ${oldName}: reinstating id-keyed rows `
      + 'unchanged is sound, and no remap is needed.');
    prepareRemap([], true);
    report.add('Lineage identity of reinstated id-keyed rows', 'PASS', lines);
    return remapSql;
  }
  lines.push('LINEAGE CHANGE: the same id denotes a different row in the candidate. Every reinstated');
  lines.push('id-keyed column must be resolved through a stable identity — never by integer, never by name.');

  // 3. Resolve every declared column, per row.
  const plans: LineageColumnPlan[] = [];
  const remediationPrinted = new Set<string>();
  const dispositionPrinted = new Set<string>();
  const measured: { table: string; column: string; unresolved: number }[] = [];
  for (const slot of slots) {
    const referencedIds = [...new Set(slot.rows.map((r) => r.oldValue))];
    const rule = slot.target.identity;
    let replacedIdentities: IdentityPair[] = [];
    let candidateIdentities: IdentityPair[] = [];
    if (rule !== 'none' && referencedIds.length > 0) {
      replacedIdentities = await identitiesById(old, rule, referencedIds);
      candidateIdentities = await identitiesByIdentity(
        candidate, rule, [...new Set(replacedIdentities.map((p) => p.identity))]);
    }
    const remap = resolveLineageRemap({
      entity: slot.target.entity, rule, referencedIds, replacedIdentities, candidateIdentities,
    });
    plans.push({
      table: slot.table, column: slot.ref.column, kindColumn: slot.ref.kindColumn,
      kind: slot.target.kind, entity: slot.target.entity, rule,
      remediation: slot.ref.remediation, rows: slot.rows, remap,
    });
    measured.push({ table: slot.table, column: slot.ref.column, unresolved: remap.unresolved.length });
    const scope = slot.ref.kindColumn ? ` (${slot.ref.kindColumn} = '${slot.target.kind}')` : '';
    const label = `${slot.table}.${slot.ref.column}${scope} -> ${slot.target.entity}`;
    // The status word is the CONTRACT's answer for this exact table and column, never a
    // relaxation of the resolver: `hist` is only reachable through a declaration.
    const status = remap.unresolved.length === 0 ? 'ok  ' : (slot.disposition ? 'hist' : 'FAIL');
    lines.push(`${status} ${label}: `
      + `${slot.totalRows} row(s)${slot.enumerated ? '' : ' (not enumerated: above the per-row cap)'}`
      + `, ${referencedIds.length} distinct id(s), `
      + `${remap.mapped.length} evidenced by ${rule}, ${remap.unresolved.length} unresolved`
      + `${remap.merges.length ? `, ${remap.merges.length} merge(s)` : ''}`
      + `${remap.unchanged ? `, ${remap.unchanged} unchanged` : ''}`);
    // Every unresolved id is named. A REFUSED column prints all of them: a refused run
    // publishes no remap file to list them in. A historical-only column's accepted ids stop at
    // a readable number, with how many more there are and where all of them are listed — a
    // count, never a silent truncation.
    const printLimit = slot.disposition ? LINEAGE_PRINT_LIMIT : remap.unresolved.length;
    for (const u of remap.unresolved.slice(0, printLimit)) {
      lines.push(`       ${slot.table}.${slot.ref.column} = ${u.oldId}: ${u.reason}`
        + `${u.identity ? ` (${u.identity})` : ''} — row(s) `
        + `${slot.rows.filter((r) => r.oldValue === u.oldId).map((r) => r.rowId).join(', ')}`);
    }
    if (remap.unresolved.length > printLimit) {
      lines.push(`       …and ${remap.unresolved.length - LINEAGE_PRINT_LIMIT} more, every one of them `
        + 'listed in the file written by --lineage-remap-out');
    }
    for (const m of remap.merges) {
      lines.push(`       MERGE ${slot.target.entity} ${m.oldIds.join(', ')} -> ${m.newId}`);
    }
    // One remediation per column, not per polymorphic target: target_id has seven. A
    // withheld column prints its DECISION instead: the remediation asks for one, and it has
    // already been made and written into the contract.
    const remediationKey = `${slot.table}.${slot.ref.column}`;
    if (remap.unresolved.length > 0 && slot.disposition) {
      if (!dispositionPrinted.has(slot.table)) {
        dispositionPrinted.add(slot.table);
        lines.push(`       INTENTIONALLY HISTORICAL-ONLY — ${slot.disposition.decidedBy}`);
        lines.push(`       ${slot.disposition.summary}`);
        for (const line of slot.disposition.reason.split('\n')) lines.push(`       ${line}`);
        lines.push(`       The plan for --environment ${environment} therefore has NO pg_restore line for `
          + `public.${slot.table}, and --phase candidate expects 0 rows in it. Nothing is deleted: `
          + 'every row stays in the pre-cutover dump and the retained pre-rebuild database.');
      }
    } else if (remap.unresolved.length > 0 && !remediationPrinted.has(remediationKey)) {
      remediationPrinted.add(remediationKey);
      for (const line of slot.ref.remediation.split('\n')) lines.push(`       ${line}`);
    }
  }

  // 4. The contract decides what is acceptable; this gate only reports it.
  const judgement = judgeLineage({ environment, columns: measured });
  for (const a of judgement.accepted) {
    lines.push(`ACCEPTED ${a.table}.${a.column}: ${a.unresolved} unresolved id(s) accepted as `
      + `historical-only — ${a.decidedBy}`);
  }
  for (const r of judgement.refused) {
    lines.push(`REFUSED  ${r.table}.${r.column}: ${r.unresolved} unresolved id(s) with no `
      + `historical-only declaration for --environment ${environment}`);
  }
  lines.push(`${judgement.acceptedTotal} unresolved id(s) accepted by contract, `
    + `${judgement.refusedTotal} refused.`);
  const unresolvedTotal = judgement.refusedTotal;

  if (unresolvedTotal === 0) {
    prepareRemap(plans, false);
  } else if (remapOut) {
    lines.push(`no remap prepared for ${remapOut}: this gate refuses, and a refused run publishes no remap`);
  }

  report.add('Lineage identity of reinstated id-keyed rows',
    unresolvedTotal === 0 ? 'WARN' : 'FAIL', lines);
  return remapSql;
}

// ---------------------------------------------------------------------------
// AFLDB-ISSUE-237 — importer identity gates (G1, G2, G3)
// ---------------------------------------------------------------------------

async function readAflApiCensus(q: Query): Promise<AflApiCensusRow[]> {
  const [source] = await q(`SELECT id FROM sources WHERE key = 'afl_api'`);
  if (!source) return [];
  const rows = await q(`
    SELECT external_id AS "externalId", status::text AS status, match_method AS "matchMethod",
           player_id AS "playerId", candidate_count AS "candidateCount", external_url AS "externalUrl"
      FROM external_identities WHERE source_id = $1`, [asInt(source.id)]);
  return rows.map((r) => ({
    externalId: String(r.externalId), status: String(r.status), matchMethod: r.matchMethod === null ? null : String(r.matchMethod),
    playerId: r.playerId === null ? null : asInt(r.playerId), candidateCount: asInt(r.candidateCount),
    externalUrl: r.externalUrl === null ? null : String(r.externalUrl),
  }));
}

/**
 * D7's forward stable-identity lookup, strict where `LINEAGE_IDENTITY_SQL.afltables_profile_url`
 * (F9) is lenient: reads every candidate row per player and classifies client-side, so a
 * player with two AFL Tables paths is reported ambiguous rather than one being silently
 * chosen — unless the two are exactly one tracked `profile_url_continuity` pair. The
 * classification is the SAME `classifyAflApiForwardIdentityRows` the rebuild/recovery reader
 * (`replay_afl_api_adjudications.ts`) uses, over the same validated fitzRoy contract, so a
 * promotion gate can never resolve a player differently from the rebuild that captured it.
 * Exported for that equivalence proof only (tests/db-promotion-check.test.ts).
 */
export async function readAflApiForwardIdentities(
  q: Query, playerIds: readonly number[],
  continuityRules: ValidatedFitzroyProfileContinuityRules = loadFitzroyProfileContinuityRules(),
): Promise<Map<number, AflApiForwardIdentityResult>> {
  if (playerIds.length === 0) return new Map();
  const rows = await q(`
    SELECT ei.player_id AS "playerId", ei.external_id AS "externalId", s.key AS "sourceKey"
      FROM external_identities ei
      JOIN sources s ON s.id = ei.source_id
     WHERE ((s.key = 'afltables' AND ei.match_method = 'afltables_profile_url')
            OR (s.key = 'manual_admin_edit' AND ei.match_method = 'manual_admin_edit'))
       AND ei.status IN ('unique', 'resolved')
       AND ei.player_id = ANY ($1::bigint[])`, [[...playerIds]]);
  return classifyAflApiForwardIdentityRows({
    playerIds,
    rows: rows.map((r) => ({ playerId: asInt(r.playerId), externalId: String(r.externalId), sourceKey: String(r.sourceKey) })),
    continuityRules,
  });
}

async function readAflApiLedgerRowCount(q: Query): Promise<number> {
  const [row] = await q(`SELECT count(*)::int AS n FROM afl_api_identity_adjudications WHERE source_key = 'afl_api'`);
  return asInt(row?.n ?? 0);
}

/**
 * AFLDB-ISSUE-237 F-L4-2 — the durable human ledger, read in full. Named so a test can prove
 * WHICH database it is sent to: at `--phase restored` it goes to the TARGET, never the candidate.
 */
export const AFL_API_LEDGER_ROWS_SQL = `
    SELECT id, external_id AS "externalId", action, player_id AS "playerId",
           player_identity AS "playerIdentity", supersedes_id AS "supersedesId"
      FROM afl_api_identity_adjudications WHERE source_key = 'afl_api' ORDER BY id`;

export async function readAflApiLedgerRows(q: Query): Promise<AflApiAdjudicationLedgerRow[]> {
  const rows = await q(AFL_API_LEDGER_ROWS_SQL);
  return rows.map((r) => ({
    id: asInt(r.id), externalId: String(r.externalId), action: r.action as 'linked' | 'revoked',
    playerId: asInt(r.playerId), playerIdentity: String(r.playerIdentity),
    supersedesId: r.supersedesId === null || r.supersedesId === undefined ? null : asInt(r.supersedesId),
  }));
}

/** Which of `identities` are `manual_admin_edit` tokens on the database `q` reads (G2 UNEVALUABLE). */
async function readAflApiManualIdentities(q: Query, identities: readonly string[]): Promise<Set<string>> {
  if (identities.length === 0) return new Set();
  const rows = await q(`
    SELECT DISTINCT ei.external_id AS "manualIdentity" FROM external_identities ei
      JOIN sources s ON s.id = ei.source_id
     WHERE s.key = 'manual_admin_edit' AND ei.match_method = 'manual_admin_edit'
       AND ei.status IN ('unique', 'resolved')
       AND ei.external_id = ANY ($1::text[])`, [[...identities]]);
  return new Set(rows.map((r) => String(r.manualIdentity)));
}

/**
 * The reverse (stable identity -> candidate player) lookup G2 remaps each ledger identity
 * through. Reads exactly the accepted-identity paths `aflApiReverseIdentityPaths` names (each
 * identity, plus both paths of any tracked `profile_url_continuity` rule naming it) and
 * classifies with the SAME `classifyAflApiReverseIdentity` the replay adapter's
 * `resolveAflApiPlayerIdentity` uses — so the gate and the post-swap D15 replay cannot resolve
 * an identity differently, and a candidate holding a rule's two paths on two players refuses
 * here as it would there. Exported for that equivalence proof (tests/db-promotion-check.test.ts).
 */
export async function readAflApiReverseIdentities(
  q: Query, identities: readonly string[],
  continuityRules: ValidatedFitzroyProfileContinuityRules = loadFitzroyProfileContinuityRules(),
): Promise<Map<string, AflApiPlayerRemapResult>> {
  if (identities.length === 0) return new Map();
  const paths = [...new Set(identities.flatMap((identity) => aflApiReverseIdentityPaths(identity, continuityRules)))];
  const rows = await q(`
    SELECT DISTINCT ei.external_id AS identity, ei.player_id AS "playerId"
      FROM external_identities ei JOIN sources s ON s.id = ei.source_id
     WHERE ((s.key = 'afltables' AND ei.match_method = 'afltables_profile_url')
            OR (s.key = 'manual_admin_edit' AND ei.match_method = 'manual_admin_edit'))
       AND ei.status IN ('unique', 'resolved')
       AND ei.external_id = ANY ($1::text[])`, [paths]);
  const playerIdsByPath = new Map<string, number[]>();
  for (const r of rows) {
    const path = String(r.identity);
    if (!playerIdsByPath.has(path)) playerIdsByPath.set(path, []);
    playerIdsByPath.get(path)!.push(asInt(r.playerId));
  }
  return new Map(identities.map((identity) => [
    identity, classifyAflApiReverseIdentity({ identity, playerIdsByPath, continuityRules }),
  ]));
}

/**
 * AFLDB-ISSUE-237 F-L4-1 — the one correct read of a DATABASE comment, the statement the
 * rebuild lifecycle's own `readRebuildMarker` (`rebuild_afl_api_adjudications.ts`) runs.
 * `COMMENT ON DATABASE` writes the shared catalogue `pg_shdescription`, which only
 * `shobj_description(oid, 'pg_database')` reads. The per-database `obj_description` read this
 * checker used before never sees it (it is NULL for every `pg_database` oid), so G1's marker
 * refusal could never fire; and a comment on some OTHER object, which lives in the
 * per-database `pg_description`, must never be mistaken for the marker either.
 */
export const DATABASE_COMMENT_SQL =
  "SELECT shobj_description(oid, 'pg_database') AS comment FROM pg_database WHERE datname = current_database()";

export async function readRebuildMarkerPresent(q: Query): Promise<boolean> {
  const [row] = await q(DATABASE_COMMENT_SQL);
  return isAflApiRebuildMarkerComment(row?.comment);
}

/**
 * One database's `afl_api` importer rows with each row's OWN forward stable identity
 * (re-derived live, D9), and the stable-field digest of that state (`aflApiImporterStateSha256`).
 * Used for both sides of the promotion — which side a view came from is the caller's
 * `AflApiPromotionSides` role, never inferred.
 */
export type AflApiImporterView = {
  census: readonly AflApiCensusRow[];
  importerRows: AflApiCensusResult['importerRows'];
  humanRowCount: number;
  identityByPlayerId: ReadonlyMap<number, AflApiForwardIdentityResult>;
  /** Provider id -> forward identity, for importer rows whose player resolves. */
  identityByExternalId: ReadonlyMap<string, string>;
  state: { rowCount: number; sha256: string };
};

export async function readAflApiImporterView(q: Query): Promise<AflApiImporterView> {
  const census = await readAflApiCensus(q);
  const { importerRows, humanRows } = censusAflApiRows(census);
  const playerIds = [...new Set(importerRows.filter((r) => r.playerId !== null).map((r) => r.playerId as number))];
  const identityByPlayerId = await readAflApiForwardIdentities(q, playerIds);
  const identityByExternalId = new Map<string, string>();
  for (const row of importerRows) {
    if (row.playerId === null) continue;
    const identity = identityByPlayerId.get(row.playerId);
    if (identity && identity.ok) identityByExternalId.set(row.externalId, identity.identity);
  }
  const sha256 = aflApiImporterStateSha256(importerRows.map((r) => ({
    externalId: r.externalId, status: r.status, matchMethod: r.matchMethod,
    playerIdentity: identityByExternalId.get(r.externalId) ?? null,
  })));
  return {
    census, importerRows, humanRowCount: humanRows.length, identityByPlayerId, identityByExternalId,
    state: { rowCount: importerRows.length, sha256 },
  };
}

function aflApiViewToG3(view: AflApiImporterView): AflApiG3Row[] {
  const rows: AflApiG3Row[] = [];
  for (const row of view.importerRows) {
    const identity = view.identityByExternalId.get(row.externalId);
    if (identity === undefined) continue; // an unresolved identity is a G1 anomaly, not a G3 input
    rows.push({ externalId: row.externalId, playerIdentity: identity, matchMethod: row.matchMethod });
  }
  return rows;
}

function importerMethodLine(view: AflApiImporterView): string {
  const byMethod = new Map<string, number>();
  for (const row of view.importerRows) byMethod.set(row.matchMethod, (byMethod.get(row.matchMethod) ?? 0) + 1);
  return `importer rows: ${view.importerRows.length} (${[...byMethod.entries()].map(([m, n]) => `${m}=${n}`).join(', ') || 'none'})`;
}

/**
 * G1 (§6.2) at `--phase source`: `afldb_test` is SOURCE lineage and must carry no human
 * authority at all — zero `resolved` rows, zero ledger rows — and no pending rebuild marker
 * (F-L4-1: now read where a database comment actually lives). The candidate-phase G1 is
 * `gateAflApiCandidateAfterReinstate` (F-L4-3): the candidate legitimately holds the TARGET's
 * reinstated ledger by then.
 */
export async function gateAflApiG1(q: Query, report: Report): Promise<void> {
  const view = await readAflApiImporterView(q);
  const ledgerRowCount = await readAflApiLedgerRowCount(q);
  const rebuildMarkerPresent = await readRebuildMarkerPresent(q);
  const problems = classifyAflApiG1({
    rows: view.census, ledgerRowCount, identityByPlayerId: view.identityByPlayerId, rebuildMarkerPresent,
  });
  const lines = [importerMethodLine(view), `importer state sha256: ${view.state.sha256}`];
  if (problems.length === 0) { report.add('afl_api importer identity — source census (G1)', 'PASS', lines); return; }
  for (const p of problems) lines.push(JSON.stringify(p));
  report.add('afl_api importer identity — source census (G1)', 'FAIL', lines);
}

/**
 * F-L4-1 at the phases whose database is not read by a G1 gate: the pre-cutover target and,
 * at `--phase restored`, both the candidate and the target. None of them may carry a pending
 * `db:test:rebuild` marker; an unrelated database comment is not a marker.
 */
export async function gateAflApiRebuildMarker(databases: readonly { role: string; q: Query }[], report: Report): Promise<void> {
  const present: string[] = [];
  for (const { role, q } of databases) if (await readRebuildMarkerPresent(q)) present.push(role);
  report.add('afl_api rebuild marker absent (F-L4-1)', present.length === 0 ? 'PASS' : 'FAIL', present.length === 0
    ? [`no pending rebuild marker on: ${databases.map((d) => d.role).join(', ')}`]
    : present.map((role) => `${role} carries a pending db:test:rebuild marker (${AFL_API_REBUILD_MARKER_FORMAT}) — do not promote it`));
}

/**
 * Target census (§6.2 `--phase pre-cutover`): D5 census + D15 bijection + D7 identity, WITHOUT
 * the source's "zero human rows" expectation — the live target legitimately holds human
 * decisions. Returns the census shape recorded into the snapshot: COUNTS for the record only.
 * No gate reads it back: G3 re-reads the live target at `--phase restored`, and the DEV
 * regeneration classification is generated from that same live read (F-L4-6).
 */
export async function gateAflApiPreCutoverCensus(q: Query, report: Report): Promise<{
  importerRowsByMethod: Record<string, number>; humanRows: number; netLinkedLedgerEntries: number;
}> {
  const view = await readAflApiImporterView(q);
  const ledgerRows = await readAflApiLedgerRows(q);
  const problems = checkAflApiIdentityInvariant({ rows: view.census, ledgerRows, identityByPlayerId: view.identityByPlayerId });
  const byMethod = new Map<string, number>();
  for (const row of view.importerRows) byMethod.set(row.matchMethod, (byMethod.get(row.matchMethod) ?? 0) + 1);
  const net = netLedgerRowsByExternalId(ledgerRows);
  const netLinkedCount = [...net.values()].filter((r) => r.action === 'linked').length;

  const importerRowsByMethod = Object.fromEntries(byMethod);
  const lines = [
    importerMethodLine(view),
    `human resolved rows: ${view.humanRowCount}; ledger rows: ${ledgerRows.length}; net-linked ledger entries: ${netLinkedCount}`,
    `importer state sha256: ${view.state.sha256}; ledger state sha256: ${aflApiLedgerStateSha256(ledgerRows)}`,
  ];
  if (problems.length === 0) {
    report.add('afl_api importer identity — pre-cutover target census', 'PASS', lines);
  } else {
    for (const p of problems) lines.push(JSON.stringify(p));
    report.add('afl_api importer identity — pre-cutover target census', 'FAIL', lines);
  }
  return { importerRowsByMethod, humanRows: view.humanRowCount, netLinkedLedgerEntries: netLinkedCount };
}

function refusedFile<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof AflApiPromotionFileRefused) throw new PromotionRefused(error.message);
    throw error;
  }
}

/**
 * §6.3 point 3's classification file (v2, F-L4-5): strict parse, exact field set, eligible
 * class only, payload hash over EVERY field. Binding to the compared states is checked by the
 * caller, which knows them.
 */
function readAflApiDevRegenerationClassification(path: string): AflApiDevRegenerationClassification {
  assertLinuxHostPath(path, '--afl-api-dev-regeneration');
  return refusedFile(() => parseAflApiDevRegenerationClassification(readFileSync(path, 'utf8'), path));
}

/** The bound E_promotion file (F-L4-4), read back at `--phase candidate`. */
function readAflApiSupersedeFile(path: string): AflApiSupersedeFile {
  assertLinuxHostPath(path, '--afl-api-supersede-in');
  return refusedFile(() => parseAflApiSupersedeFile(readFileSync(path, 'utf8'), path));
}

/**
 * AFLDB-ISSUE-237 F-L4-2 — the database ROLES the promotion's `afl_api` gates read, explicit so
 * a refactor cannot quietly read both sides from one database again:
 *
 * - `candidate` — the restored rebuilt candidate. It owns IMPORTER state: G2's importer rows,
 *   G3's candidate rows, and the reverse remap of every ledger identity all come from here.
 * - `target` — the live database being replaced (`--old-database`). It owns the durable HUMAN
 *   ledger: G2's ledger rows come from here (the candidate's ledger at `--phase restored` is the
 *   source's, which G1 proved empty), and so do G3's target rows.
 */
export type AflApiPromotionSides = { candidate: Query; target: Query };

/**
 * The roles one G2 evaluation reads. `humanLedger` is the TARGET at `--phase restored`; it is
 * the candidate only at `--phase candidate`, and only after the candidate's reinstated ledger
 * has been proven equal to the bound target ledger. `manualTokenSides` is every database that
 * could have minted a ledger identity as a `manual_admin_edit` token.
 */
export type AflApiG2Sides = { candidate: Query; humanLedger: Query; manualTokenSides: readonly Query[] };

export type AflApiG2Evaluation = {
  grades: readonly AflApiG2Grade[];
  ePromotion: ReadonlySet<string>;
  failed: boolean;
  candidate: AflApiImporterView;
  ledgerRows: readonly AflApiAdjudicationLedgerRow[];
  ledgerState: { rowCount: number; sha256: string };
};

/**
 * G2 (§6.2): one entry per NET ledger entry (latest row per provider, `netLedgerRowsByExternalId`),
 * graded by `classifyAflApiG2`. Identity is the stored stable identity (AFL Tables path or manual
 * token) remapped against the candidate — never a name, never a player id from the other side.
 */
export async function evaluateAflApiG2(sides: AflApiG2Sides, candidateView?: AflApiImporterView): Promise<AflApiG2Evaluation> {
  const candidate = candidateView ?? await readAflApiImporterView(sides.candidate);
  const ledgerRows = await readAflApiLedgerRows(sides.humanLedger);
  const net = netLedgerRowsByExternalId(ledgerRows);
  const identities = [...new Set([...net.values()].map((row) => row.playerIdentity))];
  const manualIdentities = new Set<string>();
  for (const q of sides.manualTokenSides) for (const identity of await readAflApiManualIdentities(q, identities)) manualIdentities.add(identity);
  const remapByIdentity = await readAflApiReverseIdentities(sides.candidate, identities);

  const grades = classifyAflApiG2(aflApiG2Entries({ candidate, net, manualIdentities, remapByIdentity }));
  const g2Failed = grades.some((g) => AFL_API_G2_REFUSING_OUTCOMES.has(g.outcome));
  return {
    grades, ePromotion: aflApiG2AgreeSet(grades), failed: g2Failed, candidate, ledgerRows,
    ledgerState: { rowCount: ledgerRows.length, sha256: aflApiLedgerStateSha256(ledgerRows) },
  };
}

/** G2's per-entry input, built from the candidate's importer view and the net human ledger. Pure. */
export function aflApiG2Entries(input: {
  candidate: Pick<AflApiImporterView, 'importerRows' | 'identityByExternalId'>;
  net: ReadonlyMap<string, AflApiAdjudicationLedgerRow>;
  manualIdentities: ReadonlySet<string>;
  remapByIdentity: ReadonlyMap<string, AflApiPlayerRemapResult>;
}): AflApiG2EntryInput[] {
  const candidateByExternalId = new Map(input.candidate.importerRows.map((r) => [r.externalId, r]));
  const externalIdByIdentity = new Map<string, string>();
  for (const [externalId, identity] of input.candidate.identityByExternalId) {
    if (!externalIdByIdentity.has(identity)) externalIdByIdentity.set(identity, externalId);
  }
  // The post-swap D15 planner refuses by PLAYER (`candidatePlayerAflApiRow.get(remap.newPlayerId)`),
  // not by identity string. The two differ when the ledger stored one path of a continuity pair
  // (ISSUE-235's link reads the first path in collation order) and the forward classifier gives the
  // candidate's row the other: no string collision, same player. Both are checked, so G2 refuses
  // every case D15 would refuse after the swap.
  const externalIdByPlayerId = new Map<number, string>();
  for (const r of input.candidate.importerRows) {
    if (r.playerId !== null && !externalIdByPlayerId.has(r.playerId)) externalIdByPlayerId.set(r.playerId, r.externalId);
  }
  return [...input.net.entries()].map(([externalId, entry]) => {
    const candidateRow = candidateByExternalId.get(externalId) ?? null;
    const remap = input.remapByIdentity.get(entry.playerIdentity);
    const collidingElsewhere = [
      externalIdByIdentity.get(entry.playerIdentity),
      remap?.ok ? externalIdByPlayerId.get(remap.newPlayerId) : undefined,
    ].find((id) => id !== undefined && id !== externalId);
    return {
      externalId, ledgerNetAction: entry.action, identityIsManualToken: input.manualIdentities.has(entry.playerIdentity),
      candidateRow: candidateRow === null ? null : {
        status: candidateRow.status, matchMethod: candidateRow.matchMethod, candidateCount: candidateRow.candidateCount,
        externalUrl: candidateRow.externalUrl, playerId: candidateRow.playerId,
        playerIdentity: input.candidate.identityByExternalId.get(externalId) ?? '',
      },
      remappedCandidatePlayerId: remap?.ok ? remap.newPlayerId : null,
      collidingProviderId: collidingElsewhere && collidingElsewhere !== externalId ? collidingElsewhere : null,
      continuityContradiction: remap?.ok === false && remap.reason === 'continuity_contradiction' ? remap : null,
      remapFailure: remap === undefined ? 'unresolvable'
        : remap.ok === false && remap.reason !== 'continuity_contradiction' ? remap.reason : null,
    };
  });
}

function g2Lines(evaluation: AflApiG2Evaluation): string[] {
  return [
    `E_promotion (AGREE) = {${[...evaluation.ePromotion].sort().join(', ') || 'empty'}}`,
    ...evaluation.grades.map((g) => `${g.externalId}: ${g.outcome}${'collidingProviderId' in g ? ` (vs ${g.collidingProviderId})` : ''}${'reason' in g ? ` (${g.reason})` : ''}`),
  ];
}

export const AFL_API_G3_GATE = 'afl_api importer identity — G3 cross-lineage comparison';

export type AflApiOverlapResult = {
  ePromotion: ReadonlySet<string>;
  candidate: AflApiImporterView;
  target: AflApiImporterView;
  ledgerState: { rowCount: number; sha256: string };
  targetRows: readonly AflApiG3Row[];
  candidateRows: readonly AflApiG3Row[];
  g3Grades: readonly AflApiG3Grade[];
};

/**
 * `--phase restored`, candidate + target, both read-only, BEFORE the plan reinstates anything:
 *
 * 1. the candidate carries no source-lineage human authority (zero ledger rows, zero `resolved`
 *    rows) — the source G1 already proved this of `afldb_test`; this proves the restore;
 * 2. G2 (F-L4-2): the CANDIDATE's importer rows vs the TARGET's effective human ledger, each
 *    ledger identity remapped against the candidate. `E_promotion` is exactly the AGREE set;
 *    every other refusing grade STOPs here, before the swap;
 * 3. G3: the TARGET's importer rows vs the CANDIDATE's, optionally with a bound DEV
 *    regeneration classification.
 *
 * Writes nothing: `main()` writes the bound `E_promotion` file only after EVERY gate of the run
 * has passed (F-L4-4).
 */
export async function gateAflApiOverlap(
  sides: AflApiPromotionSides, names: { candidateDatabase: string; targetDatabase: string },
  environment: Environment, devRegenerationPath: string | undefined, report: Report,
): Promise<AflApiOverlapResult> {
  const candidate = await readAflApiImporterView(sides.candidate);
  const candidateLedgerRowCount = await readAflApiLedgerRowCount(sides.candidate);
  const sourceLineageFailed = candidateLedgerRowCount > 0 || candidate.humanRowCount > 0;
  report.add('afl_api candidate carries no source-lineage human authority', sourceLineageFailed ? 'FAIL' : 'PASS', [
    `candidate ledger rows: ${candidateLedgerRowCount}; candidate resolved rows: ${candidate.humanRowCount} (both must be 0 before reinstatement)`,
  ]);

  const g2 = await evaluateAflApiG2({
    candidate: sides.candidate, humanLedger: sides.target, manualTokenSides: [sides.target, sides.candidate],
  }, candidate);
  report.add('afl_api importer identity — G2 human-vs-importer overlap', g2.failed ? 'FAIL' : 'PASS', [
    `human ledger: TARGET ${names.targetDatabase}, ${g2.ledgerState.rowCount} row(s), sha256 ${g2.ledgerState.sha256}`,
    `importer rows and identity remap: CANDIDATE ${names.candidateDatabase}, ${candidate.state.rowCount} row(s), sha256 ${candidate.state.sha256}`,
    ...g2Lines(g2),
  ]);

  const target = await readAflApiImporterView(sides.target);
  const targetRows = aflApiViewToG3(target);
  const candidateRows = aflApiViewToG3(candidate);

  let devRegenerationEntries: readonly AflApiDevRegenerationClassificationEntry[] | undefined;
  if (environment === 'dev' && devRegenerationPath) {
    const classification = readAflApiDevRegenerationClassification(devRegenerationPath);
    const problems = [
      ...aflApiDevRegenerationBindingProblems(classification, {
        targetDatabase: names.targetDatabase, candidateDatabase: names.candidateDatabase,
        targetImporterSha256: target.state.sha256, candidateImporterSha256: candidate.state.sha256,
      }),
      ...validateAflApiDevRegenerationClassification({ entries: classification.entries, targetRows, candidateRows }),
    ];
    if (problems.length > 0) {
      report.add('afl_api importer identity — DEV regeneration classification', 'FAIL', problems.map((p) => JSON.stringify(p)));
    } else {
      report.add('afl_api importer identity — DEV regeneration classification', 'INFO',
        [`${classification.entries.length} entries, bound to target ${classification.database} and candidate ${classification.candidateDatabase}: ${classification.reason}`]);
    }
    devRegenerationEntries = classification.entries;
  }

  const g3Grades = classifyAflApiG3({
    environment: environment === 'dev' ? 'dev' : 'production', targetRows, candidateRows, devRegenerationEntries,
  });
  // `aflApiViewToG3` leaves out an importer row whose player has no single forward identity. The
  // target is re-read live here, after `--phase pre-cutover`'s invariant, so such a row is not
  // assumed away: G3 cannot grade it, and an ungraded row is a refusal, never a silent pass.
  const ungraded = [
    ...target.importerRows.filter((r) => !target.identityByExternalId.has(r.externalId)).map((r) => `target ${r.externalId}`),
    ...candidate.importerRows.filter((r) => !candidate.identityByExternalId.has(r.externalId)).map((r) => `candidate ${r.externalId}`),
  ];
  const g3Failed = g3Grades.some((g) => g.outcome === 'FAIL') || ungraded.length > 0;
  report.add(AFL_API_G3_GATE, g3Failed ? 'FAIL' : 'PASS', [
    `${targetRows.length} target row(s) (sha256 ${target.state.sha256}), ${candidateRows.length} candidate row(s)`,
    ...g3Grades.map((g) => `${g.externalId}: ${g.outcome}${'reason' in g ? ` (${g.reason})` : ''}`),
    ...ungraded.map((u) => `STOP ${u}: importer row whose player has no single forward stable identity; G3 cannot grade it`),
  ]);

  return { ePromotion: g2.ePromotion, candidate, target, ledgerState: g2.ledgerState, targetRows, candidateRows, g3Grades };
}

/**
 * The `E_promotion` handoff (F-L4-4): the bound file's content for this restored run. Pure, so
 * the binding is testable without a database.
 */
export function aflApiSupersedeFileFor(
  overlap: AflApiOverlapResult, names: { environment: Environment; candidateDatabase: string; targetDatabase: string },
): AflApiSupersedeFile {
  return buildAflApiSupersedeFile({
    environment: names.environment, candidateDatabase: names.candidateDatabase, targetDatabase: names.targetDatabase,
    candidateImporterRowCount: overlap.candidate.state.rowCount, candidateImporterSha256: overlap.candidate.state.sha256,
    targetLedgerRowCount: overlap.ledgerState.rowCount, targetLedgerSha256: overlap.ledgerState.sha256,
    expectedSupersedes: overlap.ePromotion,
  });
}

/**
 * F-L4-5's generator decision, pure: a classification is proposed only when the ONLY failed
 * gate of the restored run is G3, and every G3 failure is a hard loss of an
 * `afl_api_stat_vector_season` row that the §6.3 validator accepts. Anything else returns the
 * reasons no file may be written.
 */
export function aflApiDevRegenerationProposal(input: {
  failedGates: readonly string[];
  overlap: AflApiOverlapResult;
  names: { candidateDatabase: string; targetDatabase: string };
  season: number; reason: string; reacquisitionPlan: string;
}): { classification: AflApiDevRegenerationClassification } | { refusals: readonly string[] } {
  const refusals: string[] = input.failedGates.filter((gate) => gate !== AFL_API_G3_GATE)
    .map((gate) => `gate '${gate}' failed; only a G3-only failure may be classified`);
  // A G3 FAIL from an ungraded row (no single forward identity) is not a hard loss and never classifiable.
  for (const [side, view] of [['target', input.overlap.target], ['candidate', input.overlap.candidate]] as const) {
    for (const r of view.importerRows) {
      if (!view.identityByExternalId.has(r.externalId)) refusals.push(`${side} ${r.externalId}: no single forward stable identity; G3 cannot grade it`);
    }
  }
  const { entries, refusals: g3Refusals } = aflApiDevRegenerationEntriesFromG3({
    g3Grades: input.overlap.g3Grades, targetRows: input.overlap.targetRows,
  });
  refusals.push(...g3Refusals.map((r) => `${r.externalId}: ${r.reason}`));
  if (entries.length === 0) refusals.push('G3 reports no afl_api_stat_vector_season hard loss: there is nothing to classify');
  refusals.push(...validateAflApiDevRegenerationClassification({
    entries, targetRows: input.overlap.targetRows, candidateRows: input.overlap.candidateRows,
  }).map((p) => JSON.stringify(p)));
  if (refusals.length > 0) return { refusals };
  return {
    classification: buildAflApiDevRegenerationClassification({
      database: input.names.targetDatabase, candidateDatabase: input.names.candidateDatabase,
      season: input.season, reason: input.reason, reacquisitionPlan: input.reacquisitionPlan,
      targetImporterSha256: input.overlap.target.state.sha256,
      candidateImporterSha256: input.overlap.candidate.state.sha256,
      entries,
    }),
  };
}

/**
 * G1 at `--phase candidate` (F-L4-3), AFTER the promotion plan has reinstated the target's
 * state. The candidate now legitimately holds the TARGET's durable human ledger, so the rule is
 * no longer "no ledger" but "exactly the ledger G2 graded":
 *
 * - the importer census holds no anomaly, every importer row resolves to exactly one identity,
 *   one row per player, and no rebuild marker is present;
 * - zero `resolved` rows (D15 has not run yet);
 * - the reinstated ledger's row count and stable-field digest equal the bound file's
 *   `targetLedger*` (nothing dropped, added or altered by the reinstatement);
 * - the candidate importer state still equals the bound `candidateImporter*`, and the file names
 *   this candidate, this environment and this environment's live target;
 * - G2 re-evaluated on the candidate over the reinstated ledger refuses nothing and reproduces
 *   exactly the bound `E_promotion`.
 */
export async function gateAflApiCandidateAfterReinstate(
  q: Query, bound: AflApiSupersedeFile,
  names: { environment: Environment; candidateDatabase: string; targetDatabase: string }, report: Report,
): Promise<void> {
  const g2 = await evaluateAflApiG2({ candidate: q, humanLedger: q, manualTokenSides: [q] });
  const rebuildMarkerPresent = await readRebuildMarkerPresent(q);
  const problems: unknown[] = [
    ...classifyAflApiG1({
      rows: g2.candidate.census, ledgerRowCount: g2.ledgerState.rowCount,
      identityByPlayerId: g2.candidate.identityByPlayerId, rebuildMarkerPresent,
      boundLedger: { boundRowCount: bound.targetLedgerRowCount, boundSha256: bound.targetLedgerSha256, actualSha256: g2.ledgerState.sha256 },
    }),
    ...aflApiSupersedeBindingProblems(bound, {
      environment: names.environment, targetDatabase: names.targetDatabase, candidateDatabase: names.candidateDatabase,
      importer: g2.candidate.state, ledger: g2.ledgerState,
    }).filter((p) => p.kind !== 'ledger_state_mismatch'), // reported once, as G1's ledger_not_bound_target_state
  ];
  if (g2.failed) problems.push({ kind: 'g2_refuses_after_reinstatement' });
  const expected = new Set(bound.expectedSupersedes);
  const mismatch = aflApiSupersedeMismatch({ expected, actual: [...g2.ePromotion].map((externalId) => ({ externalId })) });
  if (mismatch.missing.length > 0 || mismatch.extra.length > 0) {
    problems.push({ kind: 'e_promotion_not_reproduced', missing: mismatch.missing, extra: mismatch.extra });
  }
  const lines = [
    importerMethodLine(g2.candidate),
    `reinstated human ledger: ${g2.ledgerState.rowCount} row(s), sha256 ${g2.ledgerState.sha256} (bound: ${bound.targetLedgerRowCount}, ${bound.targetLedgerSha256})`,
    ...g2Lines(g2),
  ];
  const gate = 'afl_api importer identity — candidate census after target-ledger reinstatement (G1)';
  if (problems.length === 0) { report.add(gate, 'PASS', lines); return; }
  for (const p of problems) lines.push(JSON.stringify(p));
  report.add(gate, 'FAIL', lines);
}

/**
 * §6.3's mandatory post-re-acquisition verification census (`--phase dev-regeneration-census`).
 * Read-only; needs the same classification file the `restored` phase consulted, which must name
 * this database as its target.
 */
export async function runAflApiDevRegenerationCensus(q: Query, database: string, classificationPath: string, report: Report): Promise<void> {
  const classification = readAflApiDevRegenerationClassification(classificationPath);
  const binding = aflApiDevRegenerationBindingProblems(classification, { targetDatabase: database });
  if (binding.length > 0) {
    report.add('afl_api DEV regeneration — classification binding', 'FAIL', binding.map((p) => JSON.stringify(p)));
    return;
  }
  const census = await readAflApiCensus(q);
  const { importerRows } = censusAflApiRows(census);
  const afterRows = importerRows
    .filter((r) => r.playerId !== null)
    .map((r) => ({ externalId: r.externalId, matchMethod: r.matchMethod, status: r.status, playerIdentity: '' }));
  // The census compares by IDENTITY, so resolve it for exactly the listed rows' players.
  const byExternalId = new Map(importerRows.map((r) => [r.externalId, r]));
  const listedPlayerIds = [...new Set(
    classification.entries.map((e) => byExternalId.get(e.externalId)?.playerId).filter((id): id is number => id !== null && id !== undefined),
  )];
  const identityByPlayerId = await readAflApiForwardIdentities(q, listedPlayerIds);
  for (const row of afterRows) {
    const source = byExternalId.get(row.externalId);
    const identity = source?.playerId !== null && source?.playerId !== undefined ? identityByPlayerId.get(source.playerId) : undefined;
    row.playerIdentity = identity && identity.ok ? identity.identity : '';
  }

  const outcomes = classifyAflApiDevRegenerationCensus({ entries: classification.entries, afterRows });
  const failed = outcomes.some((o) => o.outcome === 'FAIL');
  const lines = outcomes.map((o) => `${o.externalId}: ${o.outcome}${'reason' in o ? ` (${o.reason})` : ''}`);
  report.add('afl_api DEV regeneration — post-re-acquisition census', failed ? 'FAIL' : 'PASS', lines);
}

/**
 * Every operator file this checker writes that a later step TRUSTS (the E_promotion file, the
 * DEV regeneration proposal) is written atomically and never over an existing file: the content
 * goes to a private temporary sibling first, and `link()` publishes it under the final name in
 * one step that fails with EEXIST rather than replacing anything. A crash therefore leaves at
 * most a `.partial-*` file, never a truncated file under the name a later step reads.
 */
export function writeOperatorFileAtomically(path: string, content: string): void {
  if (existsSync(path)) throw new PromotionRefused(`${path} already exists; refusing to overwrite.`);
  const temp = `${path}.partial-${process.pid}-${randomBytes(6).toString('hex')}`;
  writeFileSync(temp, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try {
    linkSync(temp, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new PromotionRefused(`${path} already exists; refusing to overwrite.`);
    }
    throw error;
  } finally {
    unlinkSync(temp);
  }
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
// AFLDB-ISSUE-237 L4 A4.2 / A4.3 — the post-swap data_overrides replay, predicted pre-swap
// ---------------------------------------------------------------------------

/** The target's ACTIVE overrides of the two branches that can lose a decision after the swap. */
export const PROMOTION_REPLAY_OVERRIDES_SQL = `
  SELECT entity_type AS "entityType", entity_key AS "entityKey", field_group AS "fieldGroup",
         override_values::text AS "overrideValues"
    FROM data_overrides
   WHERE is_active AND entity_type IN ('players', 'matches', 'match_coaches')
   ORDER BY entity_type, entity_key, field_group`;

/**
 * The candidate identities the players replay reads: every `manual_admin_edit` row, every row
 * whose (source key, external id) an override names, and every AFL Tables row of a player that
 * carries a manual token. Any status and method: the planner decides what is bindable.
 */
export const PROMOTION_REPLAY_IDENTITIES_SQL = `
  SELECT s.key AS "sourceKey", e.external_id AS "externalId", e.player_id AS "playerId",
         e.status::text AS status, e.match_method AS "matchMethod"
    FROM external_identities e
    JOIN sources s ON s.id = e.source_id
   WHERE s.key = 'manual_admin_edit'
      OR (s.key, e.external_id) IN (SELECT u.k, u.x FROM unnest($1::text[], $2::text[]) AS u(k, x))
      OR (s.key = 'afltables' AND e.player_id IN (
            SELECT m.player_id FROM external_identities m JOIN sources ms ON ms.id = m.source_id
             WHERE ms.key = 'manual_admin_edit' AND m.player_id IS NOT NULL))
   ORDER BY 1, 2, 3`;

/**
 * The candidate columns the players replay's merge UPDATE can drive into a CHECK violation, for
 * the players the plan already resolved through a stable identity. By id only; no name column.
 */
export const PROMOTION_REPLAY_PLAYER_CHECKS_SQL = `
  SELECT id AS "playerId", (dob IS NOT NULL) AS "hasDob", dob_confidence::text AS "dobConfidence",
         birth_year_min AS "birthYearMin", birth_year_max AS "birthYearMax"
    FROM players
   WHERE id = ANY($1::int[])
   ORDER BY id`;

export const PROMOTION_REPLAY_MATCH_KEYS_SQL = `
  SELECT match_key AS "matchKey" FROM matches WHERE match_key = ANY($1::text[])`;

export const PROMOTION_REPLAY_MAX_SEASON_SQL = `SELECT max(season)::int AS "maxSeason" FROM matches`;

/**
 * AFLDB-ISSUE-242. The TARGET's identities for the AFL Tables paths a `retire` turns on: every
 * row naming one of the paths, and every manual token held by a player holding one. Read at
 * --phase restored only; its player ids are compared with each other and never leave the read.
 */
export const PROMOTION_CONVERGENCE_TARGET_IDENTITIES_SQL = `
  SELECT s.key AS "sourceKey", e.external_id AS "externalId", e.player_id AS "playerId",
         e.status::text AS status, e.match_method AS "matchMethod"
    FROM external_identities e
    JOIN sources s ON s.id = e.source_id
   WHERE (s.key = 'afltables' AND e.external_id = ANY($1::text[]))
      OR (s.key = 'manual_admin_edit' AND e.player_id IN (
            SELECT a.player_id FROM external_identities a JOIN sources sa ON sa.id = a.source_id
             WHERE sa.key = 'afltables' AND a.external_id = ANY($1::text[]) AND a.player_id IS NOT NULL))
   ORDER BY 1, 2, 3`;

function identityRowsOf(rows: Record<string, unknown>[]): PromotionIdentityRow[] {
  return rows.map((r) => ({
    sourceKey: String(r.sourceKey), externalId: String(r.externalId),
    playerId: r.playerId === null || r.playerId === undefined ? null : asInt(r.playerId),
    status: String(r.status), matchMethod: r.matchMethod === null || r.matchMethod === undefined ? null : String(r.matchMethod),
  }));
}

/**
 * A4.2 and A4.3 as gates. `overrides` is whichever database holds the TARGET's data_overrides —
 * the target itself at `--phase restored`, the candidate after the plan reinstated them at
 * `--phase candidate` — and `candidate` is the rebuilt lineage the replay will run on. Every
 * refusal costs `dropdb` of the candidate and nothing else.
 *
 * AFLDB-ISSUE-242: `convergence` is given at --phase restored only, naming the target database
 * whose identities decide a `retire`. The convergence is then planned, the players replay is
 * predicted over the candidate AS IT WILL STAND after plan step 2c applies it, and the entries
 * are returned for the remap file. At --phase candidate it is absent: the real, already-converged
 * candidate is read, and a token step 2c did not converge is the unchanged A4.2 STOP.
 */
export async function gateOverrideReplayTargets(
  sides: { overrides: Query; candidate: Query },
  roles: { overrides: string; candidate: string },
  report: Report,
  convergence?: { target: Query; role: string },
): Promise<{ players: PromotionPlayersReplayPlan; matches: PromotionMatchReplayPlan; convergence: ManualIdentityConvergencePlan }> {
  const overrides: PromotionOverrideRow[] = (await sides.overrides(PROMOTION_REPLAY_OVERRIDES_SQL)).map((r) => ({
    entityType: String(r.entityType), entityKey: String(r.entityKey),
    fieldGroup: String(r.fieldGroup), overrideValues: String(r.overrideValues),
  }));
  const keys = playerIdentityKeysOfOverrides(overrides);
  const read = identityRowsOf(await sides.candidate(PROMOTION_REPLAY_IDENTITIES_SQL, [keys.sourceKeys, keys.externalIds]));
  let converged: ManualIdentityConvergencePlan = EMPTY_MANUAL_IDENTITY_CONVERGENCE;
  if (convergence) {
    const paths = convergencePathsToRead({ overrides, candidate: read });
    const target = paths.length === 0 ? []
      : identityRowsOf(await convergence.target(PROMOTION_CONVERGENCE_TARGET_IDENTITIES_SQL, [paths]));
    converged = planManualIdentityConvergence({ overrides, candidate: read, target });
    const rebinds = converged.entries.filter((e) => e.kind === 'rebind').length;
    report.add('manual player registration token convergence planned (AFLDB-ISSUE-242)',
      converged.problems.length === 0 ? 'PASS' : 'FAIL', [
        `candidate tokens no target creation record names, from ${roles.candidate}; target identities from ${convergence.role} `
          + `for ${paths.length} AFL Tables path(s)`,
        `converge at plan step 2c: ${converged.entries.length} (rebind onto the target token ${rebinds}, `
          + `retire to the source-owned path ${converged.entries.length - rebinds})`,
        ...converged.entries.map((e) => (e.kind === 'rebind'
          ? `rebind ${e.path}: manual_admin_edit:${e.candidateToken} -> manual_admin_edit:${e.targetToken} (candidate player ${e.playerId})`
          : `retire ${e.path}: manual_admin_edit:${e.candidateToken} (candidate player ${e.playerId}); the target owns the person by path`)),
        ...converged.problems.map((p) => `STOP ${p}`),
      ]);
  }
  const candidate = applyManualIdentityConvergence(read, converged.entries);
  const planned = planPromotionPlayersReplay({ overrides, candidate });
  const checkIds = [...new Set(planned.merges.map((m) => m.playerId).filter((id): id is number => id !== null))].sort((a, b) => a - b);
  const checkRows = new Map<number, PromotionPlayerCheckRow>((checkIds.length === 0 ? []
    : await sides.candidate(PROMOTION_REPLAY_PLAYER_CHECKS_SQL, [checkIds])).map((r) => [asInt(r.playerId), {
    hasDob: r.hasDob === true, dobConfidence: String(r.dobConfidence),
    birthYearMin: r.birthYearMin === null || r.birthYearMin === undefined ? null : asInt(r.birthYearMin),
    birthYearMax: r.birthYearMax === null || r.birthYearMax === undefined ? null : asInt(r.birthYearMax),
  }]));
  const players: PromotionPlayersReplayPlan = {
    ...planned, problems: [...planned.problems, ...promotionPlayerCheckProblems(planned.merges, checkRows)],
  };
  const playerRecords = players.present.length + players.binds.length + players.creates.length;
  const playerLines = [
    `target data_overrides read from ${roles.overrides}; identities and CHECK columns from ${roles.candidate}`
      + (converged.entries.length > 0
        ? ` (as they will stand after the ${converged.entries.length} AFLDB-ISSUE-242 convergence(s) at plan step 2c)` : ''),
    `creation records replayable: ${playerRecords} (present ${players.present.length}, bind ${players.binds.length}, `
      + `create ${players.creates.length}); source-keyed corrections resolving: ${players.corrections.length}`,
    `players the merge UPDATE writes: ${players.merges.length} (candidate rows read by id: ${checkRows.size})`,
    `candidate manual identities no target creation record names: ${players.candidateOnlyTokens.length} (each a STOP)`,
    ...players.problems.map((p) => `STOP ${p}`),
  ];
  if (players.problems.length > 0) {
    playerLines.push('A4.2: the post-swap players replay would not reinstate these decisions faithfully. STOP before '
      + 'the swap; this is not an operator judgement, and nothing here is resolved by name or by players.id.');
  }
  report.add('data_overrides players replay predicted on the candidate (AFLDB-ISSUE-237 A4.2)',
    players.problems.length === 0 ? 'PASS' : 'FAIL', playerLines);

  const matchKeys = matchKeysOfOverrides(overrides);
  const held = new Set((matchKeys.length === 0 ? [] : await sides.candidate(PROMOTION_REPLAY_MATCH_KEYS_SQL, [matchKeys]))
    .map((r) => String(r.matchKey)));
  const maxRow = (await sides.candidate(PROMOTION_REPLAY_MAX_SEASON_SQL))[0];
  const maxSeason = maxRow?.maxSeason === null || maxRow?.maxSeason === undefined ? null : asInt(maxRow.maxSeason);
  const matches = planPromotionMatchReplay({ overrides, candidateMatchKeys: held, candidateMaxSeason: maxSeason });
  const matchLines = [
    `target data_overrides read from ${roles.overrides}; matches from ${roles.candidate} (max season ${maxSeason ?? 'none'})`,
    `active matches / match_coaches overrides resolving to a candidate match: ${matches.resolved}`,
    ...matches.problems.map((p) => `STOP ${p}`),
  ];
  if (matches.problems.length > 0) {
    matchLines.push('A4.3: there is no supported deferred lifecycle for these overrides. STOP before the swap; '
      + 'L4 stays blocked while any of them is active.');
  }
  report.add('data_overrides match-keyed replay targets exist in the candidate (AFLDB-ISSUE-237 A4.3)',
    matches.problems.length === 0 ? 'PASS' : 'FAIL', matchLines);
  return { players, matches, convergence: converged };
}

/**
 * `--lineage-remap-out`, written after every gate of the run and only if none failed —
 * the same fail-closed rule as the E_promotion file (F-L4-4). A refused run leaves no remap
 * a later reinstatement could consume, and the file itself refuses any database but the
 * candidate it was evidenced against (`lineageRemapSql`).
 */
export function publishRestoredLineageRemap(remapOut: string | undefined, remapSql: string | undefined, report: Report): void {
  if (!remapOut) return;
  const failedGates = report.results.filter((r) => r.verdict === 'FAIL').map((r) => r.gate);
  if (failedGates.length > 0 || remapSql === undefined) {
    report.add('Lineage remap file NOT written', 'INFO', [
      `${remapOut} was not created: ${failedGates.length > 0
        ? `${failedGates.length} gate(s) of this run failed, and only a fully passing --phase restored may hand a remap to the plan.`
        : 'this run prepared no remap.'}`,
    ]);
    return;
  }
  writeOperatorFileAtomically(remapOut, remapSql);
  report.add('Lineage remap file written', 'INFO', [
    remapOut,
    `sha256: ${createHash('sha256').update(remapSql, 'utf8').digest('hex')}`,
    'Run it at the plan\'s remap step (promotion-reinstate.sh 2c) as LINEAGE_REMAP_SQL; record the sha256.',
  ]);
}

// ---------------------------------------------------------------------------
// Plan and checklist (no database contact)
// ---------------------------------------------------------------------------

export function writePlan(opts: Options): string[] {
  const input = {
    candidate: opts.database!, oldDatabase: opts.oldDatabase!,
    preCutoverDump: opts.preCutoverDump!, rebuiltDump: opts.rebuiltDump!,
    environment: opts.environment,
  };
  const dir = opts.planDir!;
  const artifacts = {
    truncate: truncateSql(),
    resyncIdentity: resyncIdentitySql(opts.environment),
    auditMarker: auditMarkerSql(input),
    reinstate: reinstatePlan(input),
    stage: stageSql(opts.environment),
    promoteStaged: promoteStagedSql(opts.environment),
  };
  assertPromotionPlanCoherent(artifacts, opts.environment);
  const files = [
    ['promotion-truncate.sql', artifacts.truncate],
    ['promotion-stage.sql', artifacts.stage],
    ['promotion-promote-staged.sql', artifacts.promoteStaged],
    ['promotion-resync-identity.sql', artifacts.resyncIdentity],
    ['promotion-audit-marker.sql', artifacts.auditMarker],
    ['promotion-reinstate.sh', artifacts.reinstate],
    ['promotion-swap.sql', swapSql(input)],
    ['promotion-rollback.sql', rollbackSql(input)],
  ] as const;
  const paths = files.map(([name, content]) => ({ name, content, path: join(dir, name) }));
  const existing = paths.filter(({ path }) => existsSync(path));
  if (existing.length > 0) {
    throw new PromotionRefused(
      `${existing.map(({ path }) => path).join(', ')} already exists; refusing to write a partial plan.`,
    );
  }
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const { content, path } of paths) {
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

/**
 * `--phase restored`'s two trusted outputs, written after every gate of the run (F-L4-4, F-L4-5):
 *
 * - `--afl-api-supersede-out`: written ONLY when no gate failed. A refused run leaves no file
 *   that could be mistaken for an approved E_promotion — it says so instead.
 * - `--afl-api-dev-regeneration-out` (DEV): written only when the run's failures are exactly
 *   G3 hard losses of `afl_api_stat_vector_season` rows (`aflApiDevRegenerationProposal`).
 */
export function publishRestoredAflApiFiles(opts: Options, overlap: AflApiOverlapResult, report: Report): void {
  const names = { environment: opts.environment, candidateDatabase: opts.database!, targetDatabase: opts.oldDatabase! };
  const failedGates = report.results.filter((r) => r.verdict === 'FAIL').map((r) => r.gate);
  if (opts.aflApiSupersedeOut) {
    if (failedGates.length > 0) {
      report.add('afl_api E_promotion file NOT written', 'INFO', [
        `${opts.aflApiSupersedeOut} was not created: ${failedGates.length} gate(s) of this run failed, `
        + 'and only a fully passing --phase restored may hand E_promotion to the post-swap replay.',
      ]);
    } else {
      const file = aflApiSupersedeFileFor(overlap, names);
      writeOperatorFileAtomically(opts.aflApiSupersedeOut, `${JSON.stringify(file, null, 2)}
`);
      report.add('afl_api E_promotion file written', 'INFO', [
        opts.aflApiSupersedeOut,
        `expectedSupersedes: {${file.expectedSupersedes.join(', ') || 'empty'}}`,
        `bound to candidate ${file.candidateDatabase} (${file.candidateImporterRowCount} importer rows, ${file.candidateImporterSha256}) `
        + `and target ${file.targetDatabase} ledger (${file.targetLedgerRowCount} rows, ${file.targetLedgerSha256})`,
        `payloadSha256: ${file.payloadSha256}`,
      ]);
    }
  }
  if (opts.aflApiDevRegenerationOut) {
    if (!overlap.g3Grades.some((g) => g.outcome === 'FAIL')) {
      report.add('afl_api DEV regeneration classification NOT generated', 'INFO', [
        `${opts.aflApiDevRegenerationOut} was not created: G3 reports no hard loss, so the exception is not needed.`,
      ]);
      return;
    }
    const proposal = aflApiDevRegenerationProposal({
      failedGates, overlap, names, season: opts.aflApiRegenerationSeason!,
      reason: opts.aflApiRegenerationReason!, reacquisitionPlan: opts.aflApiRegenerationPlan!,
    });
    if ('refusals' in proposal) {
      report.add('afl_api DEV regeneration classification NOT generated', 'FAIL', [...proposal.refusals]);
      return;
    }
    writeOperatorFileAtomically(opts.aflApiDevRegenerationOut, `${JSON.stringify(proposal.classification, null, 2)}
`);
    report.add('afl_api DEV regeneration classification proposed', 'INFO', [
      opts.aflApiDevRegenerationOut,
      `${proposal.classification.entries.length} afl_api_stat_vector_season hard loss(es): ${proposal.classification.entries.map((e) => e.externalId).join(', ')}`,
      `payloadSha256: ${proposal.classification.payloadSha256}`,
      'A PROPOSAL, not an approval: re-run --phase restored with --afl-api-dev-regeneration <this file>.',
    ]);
  }
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  // AFLDB-ISSUE-143. Refuse before anything else if the contract's own invariants do not
  // hold — in particular, a historical-only declaration that the plan would still reinstate.
  assertContractCoherent();

  if (opts.checklist) { printChecklist(); return 0; }
  if (opts.plan) {
    const written = writePlan(opts);
    console.log(`AFLDB-ISSUE-125 promotion plan written for --environment ${opts.environment} `
      + '(nothing executed, no database contacted):');
    for (const path of written) console.log(`  ${path}`);
    const withheld = historicalOnlyTables(opts.environment);
    if (withheld.length > 0) {
      console.log(`\nAFLDB-ISSUE-143 — ${withheld.length} table(s) are INTENTIONALLY NOT reinstated `
        + `under --environment ${opts.environment}. They are truncated in the candidate, given no `
        + 'pg_restore line, expected to read 0 rows at --phase candidate, and named in the '
        + 'database.promoted marker. Every row survives in the pre-cutover dump and the retained '
        + 'pre-rebuild database:');
      for (const { table, disposition } of withheld) {
        console.log(`  public.${table.name} — ${disposition.decidedBy}`);
        console.log(`      ${disposition.summary}`);
      }
    }
    console.log('\nRead every file before running it. The .sh is a transcript to follow, not a script to pipe.');
    return 0;
  }

  loadEnv();
  const baseDsn = process.env[opts.dsnEnv];
  if (!baseDsn) throw new PromotionRefused(`${opts.dsnEnv} is not set.`);
  const dsn = withDatabase(baseDsn, opts.database!);
  const phase = opts.phase!;

  const names = environmentNames(opts.environment);
  console.log(`AFLDB-ISSUE-125 promotion check — environment '${opts.environment}' (live ${names.live}), phase '${phase}'`);
  console.log(`  mode      : READ-ONLY (server-enforced), no DDL, no DML, no restore path`);
  console.log(`  target    : ${opts.database} via ${opts.dsnEnv} (database name replaced; DSN host/role unchanged: ${databaseOf(baseDsn)} -> ${opts.database})`);

  // AFLDB-ISSUE-237 §6.3 — a narrow, standalone read-only phase, never folded into the
  // standard gate pipeline every other phase shares below (identity/classification/staging/
  // migration/fixtures/super-admin/inventory/privileges gates do not apply to it).
  if (phase === 'dev-regeneration-census') {
    // parseArgs already refuses this phase without --afl-api-dev-regeneration.
    const report = new Report();
    const conn = await openReadOnly(dsn, phase);
    try {
      await gateIdentity(conn.q, opts.database!, report);
      await runAflApiDevRegenerationCensus(conn.q, opts.database!, opts.aflApiDevRegeneration!, report);
    } finally {
      await conn.end();
    }
    const failed = report.results.filter((r) => r.verdict === 'FAIL').map((r) => r.gate);
    console.log(`\n${'='.repeat(78)}`);
    if (failed.length === 0) {
      console.log(`PROMOTION CHECK (${opts.environment}/${phase}): PASS — ${report.results.length} gate(s) evaluated, none failed.`);
      return 0;
    }
    console.log(`PROMOTION CHECK (${opts.environment}/${phase}): REFUSED — ${failed.length} gate(s) failed:`);
    for (const gate of failed) console.log(`  - ${gate}`);
    return 1;
  }

  // AFLDB-ISSUE-237: refuse a bad operator file, or an output that already exists, before any
  // database is opened.
  const boundSupersede = phase === 'candidate' ? readAflApiSupersedeFile(opts.aflApiSupersedeIn!) : undefined;
  for (const out of [opts.aflApiSupersedeOut, opts.aflApiDevRegenerationOut, opts.lineageRemapOut]) {
    if (out && existsSync(out)) throw new PromotionRefused(`${out} already exists; refusing to overwrite.`);
  }

  const report = new Report();
  const conn = await openReadOnly(dsn, phase);
  let old: { q: Query; end: () => Promise<void> } | undefined;
  let aflApiOverlap: AflApiOverlapResult | undefined;
  let lineageRemap: string | undefined;
  try {
    await gateIdentity(conn.q, opts.database!, report);
    const { present } = await gateClassification(conn.q, report);
    await gateStagingLeftover(conn.q, report);
    await gateMigrationParity(conn.q, report);
    if (opts.expectFingerprint) await gateFingerprint(conn.q, opts.expectFingerprint, report);
    const fixtures = await gateFixtureIdentities(
      conn.q, present, phase, opts.environment, opts.allowFixtureIdentities, report);
    const superAdmins = await gateSuperAdmin(
      conn.q, present, phase, opts.environment, opts.expectSuperAdmin, report);
    const counts = await gateInventory(conn.q, present, opts.environment, report);
    if (phase === 'pre-cutover') gateStagedSourceRows(counts, opts.environment, report);
    await gatePrivileges(conn.q, present, phase === 'candidate' || phase === 'production', report);

    // AFLDB-ISSUE-237: source = SOURCE lineage (no human authority); candidate = after the
    // plan reinstated the TARGET's ledger, which must be exactly the one G2 graded (F-L4-3).
    if (phase === 'source') await gateAflApiG1(conn.q, report);
    if (phase === 'candidate') {
      await gateAflApiCandidateAfterReinstate(conn.q, boundSupersede!, {
        environment: opts.environment, candidateDatabase: opts.database!, targetDatabase: names.live,
      }, report);
      // A4.2/A4.3 again, over the target's data_overrides as the plan actually reinstated them and
      // the candidate identities as step 2c actually converged them (AFLDB-ISSUE-242): nothing is
      // planned here, so a token 2c did not converge is the unchanged A4.2 STOP.
      await gateOverrideReplayTargets({ overrides: conn.q, candidate: conn.q }, {
        overrides: `candidate ${opts.database} (the target's reinstated data_overrides)`, candidate: `candidate ${opts.database}`,
      }, report);
    }
    let aflApiTargetCensus: Snapshot['aflApiTargetCensus'];
    if (phase === 'pre-cutover') {
      await gateAflApiRebuildMarker([{ role: `target ${opts.database}`, q: conn.q }], report);
      aflApiTargetCensus = await gateAflApiPreCutoverCensus(conn.q, report);
    }

    if (phase === 'restored') {
      old = await openReadOnly(withDatabase(baseDsn, opts.oldDatabase!), 'old');
      const oldName = String((await old.q('SELECT current_database() AS d'))[0]?.d);
      if (oldName !== opts.oldDatabase) throw new PromotionRefused(`Old database connection landed on '${oldName}', not '${opts.oldDatabase}'.`);
      await gateDanglingReferences(conn.q, old.q, present, opts.environment, report);
      // A4.2/A4.3: the target's data_overrides against the candidate the replay will run on,
      // as it will stand after the AFLDB-ISSUE-242 convergence planned here from the target's
      // identities. Planned BEFORE the lineage gate, whose remap file carries it (step 2c).
      const replay = await gateOverrideReplayTargets({ overrides: old.q, candidate: conn.q }, {
        overrides: `target ${opts.oldDatabase}`, candidate: `candidate ${opts.database}`,
      }, report, { target: old.q, role: `target ${opts.oldDatabase}` });
      lineageRemap = await gateLineageIdentity(
        conn.q, old.q, present, opts.lineageRemapOut,
        opts.database!, opts.oldDatabase!, opts.environment, report, replay.convergence.entries);
      await gateAflApiRebuildMarker([
        { role: `candidate ${opts.database}`, q: conn.q }, { role: `target ${opts.oldDatabase}`, q: old.q },
      ], report);
      // F-L4-2: importer rows from the CANDIDATE, the human ledger from the TARGET.
      aflApiOverlap = await gateAflApiOverlap(
        { candidate: conn.q, target: old.q },
        { candidateDatabase: opts.database!, targetDatabase: opts.oldDatabase! },
        opts.environment, opts.aflApiDevRegeneration, report);
    }
    if (opts.compare) gateCompare(opts.compare, counts, opts.environment, report);

    if (opts.snapshot) {
      const snapshot: Snapshot = {
        issue: 'AFLDB-ISSUE-125', database: opts.database!, takenAt: new Date().toISOString(),
        counts, superAdmins, fixtureRows: fixtures, aflApiTargetCensus,
      };
      if (existsSync(opts.snapshot)) throw new PromotionRefused(`${opts.snapshot} already exists; refusing to overwrite a snapshot.`);
      writeFileSync(opts.snapshot, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      report.add('Snapshot written', 'INFO', [opts.snapshot, 'row counts only — no row content, no identities, no secrets']);
    }
  } finally {
    await conn.end();
    if (old) await old.end();
  }
  // F-L4-4: only now, with every gate of this run evaluated, may a trusted file be written.
  if (aflApiOverlap) publishRestoredAflApiFiles(opts, aflApiOverlap, report);
  if (phase === 'restored') publishRestoredLineageRemap(opts.lineageRemapOut, lineageRemap, report);

  const failed = report.results.filter((r) => r.verdict === 'FAIL').map((r) => r.gate);
  console.log(`\n${'='.repeat(78)}`);
  if (failed.length === 0) {
    console.log(`PROMOTION CHECK (${opts.environment}/${phase}): PASS — ${report.results.length} gate(s) evaluated, none failed.`);
    return 0;
  }
  console.log(`PROMOTION CHECK (${opts.environment}/${phase}): REFUSED — ${failed.length} gate(s) failed:`);
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
