/**
 * AFLDB-ISSUE-093 §10 — the canonical clean rebuild of `afldb_test`.
 *
 *     npm run db:test:rebuild -- --acknowledge-destroy afldb_test
 *
 * This is the ONE supported rebuild entry point. It runs the fixed dependency order,
 * fails closed at the first problem, and never touches `afldb_dev` or production.
 *
 * The core source is NOT named on the command line: it is the single accepted canonical
 * baseline in data/reference/fitzroy-accepted-baselines.json. Partial/trial core data stays
 * available for bounded testing, but only via an explicit
 * `--fitzroy-label <label> --acknowledge-partial-fitzroy`, and is never selected
 * implicitly — there is no 'latest label' fallback anywhere in this file.
 *
 * §10 contract, implemented here point for point:
 *   1. explicit named-target map, refusing anything unrecognised   -> resolveTarget()
 *   2. destination-must-equal-known-safe-name                      -> resolveTarget()
 *   3. refuse every target but afldb_test; reject dev/prod by name -> resolveTarget()
 *   4. full preflight BEFORE destruction or any database contact   -> stage 1
 *   5. explicit destructive acknowledgement before drop/reset      -> --acknowledge-destroy
 *   6. apply the complete tracked migration set via migrate.ts,
 *      with no hard-coded terminal migration number                -> stage 3
 *   7. fixed dependency order, failing closed on a missing source  -> planStages()
 *   8. per-domain fingerprints and row counts                      -> stage 9
 *   9. never reference AFLDB_LEGACY_SQLITE                         -> nothing here does
 *
 * Two repository facts shape the destructive step, and neither was invented here:
 *
 *   * No DSN in the credential model can DROP/CREATE a database. `afldb_test` is created
 *     once at host bootstrap by `sudo -u postgres createdb -O afldb_owner`
 *     (tools/maintenance/00_install_postgres.sh:88). So "recreate" is an in-place RESET
 *     over the existing test DSN — which is what §10's own cited pattern,
 *     tools/maintenance/restore-test.sh:104-118, does.
 *   * That pattern drops tables individually rather than `DROP SCHEMA public CASCADE`,
 *     because pg_trgm and unaccent live in public and are owned by another role. This
 *     reset goes further than restore-test.sh — it also removes non-public schemas,
 *     routines and types — because the migrations must re-run from nothing, but it keeps
 *     the same extension-preserving discipline.
 *
 * Everything below the argument parsing is pure or dependency-injected, so the whole
 * safety and ordering contract is tested without a database (tests/db-test-rebuild.test.ts).
 *
 * RESET_SQL itself is proven separately and non-destructively by
 * `npm run db:test:prove-reset` (tools/db/prove-reset.ts, AFLDB-ISSUE-093 §20): it runs
 * this exact constant inside one transaction and ALWAYS rolls back. Nothing in that path
 * can reach any stage below — it is a different entry point with no stage graph at all.
 */

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { runPsql, type SpawnSyncLike } from './psql';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StageKind =
  | 'precheck' | 'destructive' | 'schema' | 'privileges' | 'data' | 'validation';

export type Stage = {
  /** Stable identifier used by tests and by the run report. */
  id: string;
  name: string;
  kind: StageKind;
  /**
   * How the stage does its work.
   *
   *   command  — a child process; non-zero exit fails the stage.
   *   sql      — the DESTRUCTIVE reset, through deps.runSql.
   *   validate — a READ-ONLY assertion stream, through deps.runValidation. Separate from
   *              `sql` so nothing can route a validation stream into the destructive
   *              runner, or vice versa, by editing one field.
   *   internal — done by the runner outside the stage loop (PRECHECK; see runPreflight).
   */
  run: 'command' | 'sql' | 'validate' | 'internal';
  argv?: string[];
  /** The stream for a `validate` stage. */
  sql?: string;
  /** Explicit child-process environment. Data stages get the TEST import DSN here. */
  envOverlay?: Record<string, string>;
};

export type ResolvedTarget = {
  /** The database name, e.g. `afldb_test`. */
  database: string;
  /** Owner/admin DSN for schema, privileges and the reset. Never logged. */
  adminDsn: string;
  /** Restricted import DSN handed to every data stage. Never logged. */
  importDsn: string;
  /** True when importDsn is the owner DSN under an explicit acknowledgement. */
  importIsOwnerSubstitution: boolean;
};

export type FitzroySource = {
  label: string;
  fullHistory: boolean;
  acknowledgedPartial: boolean;
  /** True when the label came from (or matches) the tracked acceptance register. */
  accepted: boolean;
  /** How the label was chosen, for the banner and for tests. */
  selection: 'accepted-baseline' | 'explicit-partial';
};

export type Options = {
  fitzroyLabel?: string;
  acknowledgeDestroy?: string;
  acknowledgePartialFitzroy?: boolean;
  allowOwnerImportDsn?: boolean;
  draftguruLabel: string;
  planOnly: boolean;
};

export class RebuildRefused extends Error {}

const REPO_ROOT = process.cwd();

/** The only rebuild target this runner will ever accept. §10 points 1-3. */
const SUPPORTED_TARGET = 'afldb_test';

/** Refused by name, whatever the DSN claims. */
const FORBIDDEN_DATABASES = ['afldb_dev', 'afldb_prod'];

/** Labels known NOT to be full-history acquisitions. */
const KNOWN_TRIAL_LABELS = ['trial-2024'];

const FITZROY_MANIFEST_DIR = join('docs', 'rebuild-manifests', 'afltables_fitzroy_core');

/** The acceptance/promotion register — which acquisition is the canonical core source. */
const ACCEPTED_BASELINES = join('data', 'reference', 'fitzroy-accepted-baselines.json');

/** The source contract, which also names the accepted AFLDB-ISSUE-095 ladder witness. */
const FITZROY_CONTRACT = join('tools', 'rebuild', 'fitzroy', 'fitzroy-contract.json');

/** The AFLDB-ISSUE-111 Coleman derivation contract. Declares the derived span. */
const COLEMAN_CONTRACT = join('data', 'reference', 'coleman-derivation.json');

// ---------------------------------------------------------------------------
// Safety — every refusal happens before any destruction
// ---------------------------------------------------------------------------

export function databaseOf(dsn: string): string {
  return new URL(dsn).pathname.replace(/^\//, '');
}

/**
 * The target-name contract, §10 points 1-3, in ONE place.
 *
 * `resolveTarget` below and the rollback-only reset proof (tools/db/prove-reset.ts) both
 * call this, so the proof cannot drift into a weaker duplicate of the rebuild's own
 * refusals. Never includes a DSN or password in any message.
 */
export function assertRebuildTargetName(database: string): void {
  if (FORBIDDEN_DATABASES.includes(database)) {
    throw new RebuildRefused(
      `Refusing to rebuild '${database}': this database is rejected by name.`);
  }
  if (/prod/i.test(database)) {
    throw new RebuildRefused(
      `Refusing to rebuild '${database}': the name looks like production.`);
  }
  if (!/_test$/.test(database)) {
    throw new RebuildRefused(
      `Refusing to rebuild '${database}': only a database whose name ends in _test `
      + 'may be destroyed by this runner.');
  }
  if (database !== SUPPORTED_TARGET) {
    throw new RebuildRefused(
      `Refusing to rebuild '${database}': the only supported rebuild target is `
      + `'${SUPPORTED_TARGET}'.`);
  }
  if (/pre_rebuild/i.test(database)) {
    throw new RebuildRefused(
      `Refusing to touch '${database}': preserved pre-rebuild databases are read-only.`);
  }
}

/**
 * Resolve and validate the rebuild target. Throws rather than returning a bad target,
 * and never includes a DSN or password in any message.
 */
export function resolveTarget(
  env: Record<string, string | undefined>,
  opts: { allowOwnerImportDsn?: boolean } = {},
): ResolvedTarget {
  const adminDsn = env.AFLDB_TEST_DATABASE_URL;
  if (!adminDsn) {
    throw new RebuildRefused(
      'AFLDB_TEST_DATABASE_URL is not set. This runner rebuilds the test database only and '
      + 'will not fall back to any other target.');
  }

  let database: string;
  try {
    database = databaseOf(adminDsn);
  } catch {
    throw new RebuildRefused('AFLDB_TEST_DATABASE_URL is not a valid connection URL.');
  }

  assertRebuildTargetName(database);

  // Data stages must run as the restricted import role, never as owner and NEVER with the
  // development DSN this repository's .env sets. ISSUE-083 tracks the missing test import
  // credential; this runner fails closed rather than silently substituting owner access.
  const testImportDsn = env.AFLDB_TEST_IMPORT_DATABASE_URL;
  let importDsn: string;
  let importIsOwnerSubstitution = false;

  if (testImportDsn) {
    if (databaseOf(testImportDsn) !== database) {
      throw new RebuildRefused(
        'AFLDB_TEST_IMPORT_DATABASE_URL names a different database from '
        + 'AFLDB_TEST_DATABASE_URL. Both must point at the same test database.');
    }
    importDsn = testImportDsn;
  } else if (opts.allowOwnerImportDsn) {
    importDsn = adminDsn;
    importIsOwnerSubstitution = true;
  } else {
    throw new RebuildRefused(
      'AFLDB_TEST_IMPORT_DATABASE_URL is not set, so there is no restricted import '
      + 'credential for the data stages. Set it to an afldb_import DSN for the test '
      + 'database, or pass --allow-owner-import-dsn to run them as owner deliberately '
      + '(that is the AFLDB-ISSUE-083 gap: a missing grant would then pass here and fail '
      + 'in production).');
  }

  return { database, adminDsn, importDsn, importIsOwnerSubstitution };
}

/** §10 point 5: destruction requires the operator to name the database explicitly. */
export function assertDestructiveAcknowledgement(
  target: ResolvedTarget,
  acknowledgeDestroy: string | undefined,
): void {
  if (acknowledgeDestroy !== target.database) {
    throw new RebuildRefused(
      `This rebuild DROPS every table, schema, routine and type in '${target.database}'. `
      + `Re-run with --acknowledge-destroy ${target.database} to confirm.`);
  }
}

/**
 * Select THE accepted baseline from the tracked acceptance register.
 *
 * Zero and many accepted baselines are BOTH refusals. There is deliberately no 'latest
 * label', filename-ordering or date tiebreak: deterministic selection among several
 * accepted baselines is not tracked policy, so this fails closed and a human decides.
 */
export function selectAcceptedBaseline(
  register: Record<string, unknown> | null,
): { label: string } {
  if (!register) {
    throw new RebuildRefused(
      `No fitzRoy acceptance register at ${ACCEPTED_BASELINES}. The rebuild has no canonical `
      + 'core source and will not guess one.');
  }
  if (register.contract !== 'afldb.fitzroy.accepted_baselines') {
    throw new RebuildRefused(
      `${ACCEPTED_BASELINES} is not an afldb.fitzroy.accepted_baselines document.`);
  }
  const policy = (register.selection_policy as Record<string, unknown> | undefined)?.rule;
  if (policy !== 'exactly_one_accepted') {
    throw new RebuildRefused(
      `The acceptance register declares selection policy '${String(policy)}', but the only `
      + "policy this rebuild implements is 'exactly_one_accepted'.");
  }
  const baselines = (register.baselines ?? []) as Array<Record<string, unknown>>;
  const accepted = baselines.filter((b) => b.acceptance_status === 'accepted');
  if (accepted.length === 0) {
    throw new RebuildRefused(
      `No fitzRoy baseline is marked accepted in ${ACCEPTED_BASELINES}. Validate and accept `
      + 'a full-history acquisition first.');
  }
  if (accepted.length > 1) {
    const names = accepted.map((b) => String(b.snapshot_label)).sort().join(', ');
    throw new RebuildRefused(
      `${accepted.length} fitzRoy baselines are marked accepted (${names}). Deterministic `
      + 'selection among several accepted baselines is not defined policy; mark exactly one '
      + 'accepted.');
  }
  return { label: String(accepted[0].snapshot_label) };
}

/**
 * Resolve the fitzRoy source for this rebuild.
 *
 * The NORMAL path takes no label: it resolves the accepted canonical baseline from the
 * tracked register, so `npm run db:test:rebuild` needs neither --fitzroy-label nor
 * --acknowledge-partial-fitzroy. Partial/trial data is still available for bounded testing
 * but only by naming the label AND acknowledging it — it is never selected implicitly.
 *
 * Nothing here is a verdict. The acceptance register BINDS (which acquisition, which
 * hashes, which contract version, which measured fingerprint); it never blesses. The sole
 * adjudicator remains `import_fitzroy_core.py --require-full-history`, which PRECHECK runs
 * before anything is destroyed — and which `--require-accepted-baseline` implies, so a
 * hand-edited register cannot bypass the gates it claims were passed.
 */
export function resolveFitzroySource(
  opts: { fitzroyLabel?: string; acknowledgePartialFitzroy?: boolean },
  deps: {
    readManifest?: (label: string) => Record<string, unknown> | null;
    readAcceptedRegister?: () => Record<string, unknown> | null;
  } = {},
): FitzroySource {
  const readJson = (path: string) => (existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    : null);
  const read = deps.readManifest
    ?? ((l: string) => readJson(join(REPO_ROOT, FITZROY_MANIFEST_DIR, `${l}.json`)));
  const readRegister = deps.readAcceptedRegister
    ?? (() => readJson(join(REPO_ROOT, ACCEPTED_BASELINES)));

  // Explicit partial/trial mode: opt-in only, and it must name its label.
  if (opts.acknowledgePartialFitzroy) {
    if (!opts.fitzroyLabel) {
      throw new RebuildRefused(
        '--acknowledge-partial-fitzroy needs --fitzroy-label <label>: partial mode never '
        + 'falls back to the accepted baseline, and the accepted baseline is never rebuilt '
        + 'as a partial.');
    }
    if (!read(opts.fitzroyLabel)) {
      throw new RebuildRefused(
        `No tracked fitzRoy manifest for label '${opts.fitzroyLabel}' under `
        + `${FITZROY_MANIFEST_DIR}/.`);
    }
    return {
      label: opts.fitzroyLabel,
      fullHistory: false,
      acknowledgedPartial: true,
      accepted: false,
      selection: 'explicit-partial',
    };
  }

  const acceptedLabel = selectAcceptedBaseline(readRegister()).label;

  if (opts.fitzroyLabel && opts.fitzroyLabel !== acceptedLabel) {
    const trial = KNOWN_TRIAL_LABELS.includes(opts.fitzroyLabel)
      ? ` '${opts.fitzroyLabel}' is a known trial snapshot and can never satisfy `
        + 'full-history mode.'
      : '';
    throw new RebuildRefused(
      `fitzRoy snapshot '${opts.fitzroyLabel}' is not the accepted canonical baseline `
      + `('${acceptedLabel}').${trial} Accept it in ${ACCEPTED_BASELINES}, or pass `
      + '--acknowledge-partial-fitzroy to rebuild deliberately from partial core data.');
  }

  if (!read(acceptedLabel)) {
    throw new RebuildRefused(
      `The accepted baseline '${acceptedLabel}' has no tracked acquisition manifest under `
      + `${FITZROY_MANIFEST_DIR}/.`);
  }

  return {
    label: acceptedLabel,
    fullHistory: true,
    acknowledgedPartial: false,
    accepted: true,
    selection: 'accepted-baseline',
  };
}

// ---------------------------------------------------------------------------
// The stage graph
// ---------------------------------------------------------------------------

/** The platform-local project interpreter, unchanged: this stays the default. */
export const DEFAULT_VENV_PYTHON = process.platform === 'win32'
  ? join('.venv', 'Scripts', 'python.exe')
  : join('.venv', 'bin', 'python');

/**
 * The Python interpreter every Python stage runs under.
 *
 * `AFLDB_PYTHON` is the portable override AFLDB already uses for exactly this case — a
 * checkout whose usable interpreter is not the in-tree `.venv`, which is the normal state
 * of a git worktree, since `.venv/` is not part of a checkout. Seven existing test suites
 * resolve Python the same way; this brings the rebuild harness onto the same contract
 * instead of hard-failing with a bare "The system cannot find the path specified."
 *
 * Deliberately NOT resolved by searching parent or sibling directories: an interpreter
 * found by walking out of the repository is an interpreter nobody chose, and this harness
 * drives a destructive rebuild. Explicit override, or the platform-local default.
 *
 * Read at call time, never captured at module load, so the environment a stage actually
 * runs under is the one that selected the interpreter.
 */
export function resolvePython(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const override = (env.AFLDB_PYTHON ?? '').trim();
  return override !== '' ? override : DEFAULT_VENV_PYTHON;
}

/**
 * The fixed dependency order. Pure: given a target and sources it returns the exact
 * stages, so ordering and command construction are tested without running anything.
 */
export function planStages(target: ResolvedTarget, fitzroy: FitzroySource,
                           opts: Options): Stage[] {
  const dataEnv = { AFLDB_IMPORT_DATABASE_URL: target.importDsn };
  // One resolution for the whole graph, so no two stages can disagree.
  const python = resolvePython();

  return [
    {
      id: 'precheck',
      name: 'PRECHECK — every required input, before anything is destroyed',
      kind: 'precheck',
      run: 'internal',
    },
    {
      id: 'recreate',
      name: `DATABASE RESET — clear ${target.database}`,
      kind: 'destructive',
      run: 'sql',
    },
    {
      id: 'migrations',
      name: 'MIGRATIONS — the complete tracked set',
      kind: 'schema',
      run: 'command',
      argv: ['npm', 'run', 'db:migrate:test'],
      envOverlay: { AFLDB_MIGRATE_TARGET: 'test' },
    },
    {
      id: 'privileges',
      name: 'PRIVILEGES — reconcile roles from the registries',
      kind: 'privileges',
      run: 'command',
      argv: ['npm', 'run', 'db:privileges:test'],
    },
    {
      id: 'reference',
      name: 'REFERENCE DATA — tracked canonical datasets',
      kind: 'data',
      run: 'command',
      argv: [python, 'tools/migration/load_reference_data.py'],
      envOverlay: dataEnv,
    },
    {
      id: 'fitzroy',
      name: `FITZROY CORE — ${fitzroy.label}`,
      kind: 'data',
      run: 'command',
      argv: [python, 'tools/migration/import_fitzroy_core.py',
             '--label', fitzroy.label],
      envOverlay: dataEnv,
    },
    {
      // Must follow fitzroy: three tracked explicit decisions target canonical AFL Tables
      // identities and the importer HALTs rather than invent a replacement player.
      id: 'draftguru',
      name: `DRAFTGURU — ${opts.draftguruLabel}`,
      kind: 'data',
      run: 'command',
      argv: [python, 'tools/rebuild/draftguru/import_draftguru.py',
             '--label', opts.draftguruLabel],
      envOverlay: dataEnv,
    },
    {
      id: 'derived',
      name: 'DERIVED — recomputed summaries',
      kind: 'data',
      run: 'command',
      argv: [python, 'tools/migration/rebuild_derived.py'],
      envOverlay: dataEnv,
    },
    {
      // AFLDB-ISSUE-111. The Coleman Medal is DERIVED from canonical home-and-away match
      // facts, not acquired: no legacy SQLite, no manifest, no network. It must follow
      // `fitzroy`, which supplies matches, player_match_stats and the AFL Tables profile
      // identities its durable source_record_id is built from, AND `derived`, which is
      // where season_metadata decides which seasons are complete — an in-progress season
      // has not decided the award and must not materialise a winner.
      id: 'coleman',
      name: 'COLEMAN — leading home-and-away goalkicker, derived',
      kind: 'data',
      run: 'command',
      argv: [python, 'tools/migration/import_awards.py', '--groups', 'coleman'],
      envOverlay: dataEnv,
    },
    {
      // AFLDB-ISSUE-095 D7. The ladder witness cross-check. It must follow `derived`,
      // which is where club_seasons is built, and precede FINAL VALIDATION so a
      // disagreement is reported with its own per-row diagnostics rather than collapsed
      // into a scalar count.
      //
      // This is a VALIDATION stage, not a data stage: D6's "no tenth data stage" holds —
      // nothing here imports, and the validator opens its one connection read-only.
      id: 'ladder-witness',
      name: `LADDER WITNESS — cross-check club_seasons against ${ladderWitnessLabel()}`,
      kind: 'validation',
      run: 'command',
      argv: [python, LADDER_WITNESS_VALIDATOR,
             '--label', ladderWitnessLabel(), '--compare'],
      envOverlay: dataEnv,
    },
    {
      id: 'fingerprints',
      name: 'FINAL VALIDATION — per-domain row counts against the accepted contracts',
      kind: 'validation',
      run: 'validate',
      sql: finalValidationSql(),
    },
  ];
}

export const LADDER_WITNESS_VALIDATOR =
  'tools/rebuild/fitzroy/validate_ladder_witness.py';

/**
 * The accepted ladder witness, read from the tracked contract.
 *
 * Never a default and never "whatever snapshot happens to be on this machine": the
 * contract names one accepted label and binds its manifest by sha256, so a rebuild on a
 * fresh checkout either has those exact bytes or refuses.
 */
export function ladderWitnessLabel(
  readContract: () => Record<string, unknown> | null = () => {
    const path = join(REPO_ROOT, FITZROY_CONTRACT);
    return existsSync(path)
      ? JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
      : null;
  },
): string {
  const contract = readContract();
  const datasets = contract?.datasets as Record<string, any> | undefined;
  const accepted = datasets?.ladder?.accepted_witness?.snapshot_label;
  if (!accepted) {
    throw new RebuildRefused(
      `${FITZROY_CONTRACT} records no accepted ladder witness `
      + '(datasets.ladder.accepted_witness.snapshot_label). AFLDB-ISSUE-095 D7 has no '
      + 'artefact to cross-check club_seasons against, and the rebuild will not guess one.');
  }
  return String(accepted);
}

/** DraftGuru preflight: the accepted Stage A inputs, proven before destruction. */
export const DRAFTGURU_PREFLIGHT_FILES = [
  'tools/rebuild/draftguru/draftguru-contract.json',
  'data/reference/draftguru-event-kinds.json',
  'data/reference/draftguru-link-decisions.json',
];

/** Built per call, not frozen at module load, so AFLDB_PYTHON is honoured. */
export function draftguruValidateArgv(): string[] {
  return [resolvePython(), 'tools/rebuild/draftguru/import_draftguru.py',
          '--validate-only'];
}

/** The counts the DraftGuru preflight must see before anything is destroyed. */
export const DRAFTGURU_EXPECTED = {
  yearPages: 42,
  persons: 5057,
  picks: 6810,
};

export function assertDraftguruPreflight(stdout: string): void {
  const checks: [string, RegExp][] = [
    [`${DRAFTGURU_EXPECTED.yearPages} year pages`,
     new RegExp(`${DRAFTGURU_EXPECTED.yearPages} year pages, sha256 verified`)],
    [`${DRAFTGURU_EXPECTED.persons} persons`,
     new RegExp(`persons\\s*:\\s*${DRAFTGURU_EXPECTED.persons}\\b`)],
    [`${DRAFTGURU_EXPECTED.picks} picks`,
     new RegExp(`picks\\s*:\\s*${DRAFTGURU_EXPECTED.picks}\\b`)],
  ];
  for (const [what, pattern] of checks) {
    if (!pattern.test(stdout)) {
      throw new RebuildRefused(
        `DraftGuru preflight did not report ${what}. Nothing has been destroyed.`);
    }
  }
}

// ---------------------------------------------------------------------------
// FINAL VALIDATION — §H11 F3
//
// Stage 9 used to be declared `run: 'internal'` while `executeRebuild` had no branch for
// `internal`: the loop logged the name, recorded it as executed and fell through, and
// `FINGERPRINT_QUERIES` was exported and never called by anything. `Rebuild complete.` was
// therefore printed on the strength of eight exit codes and nothing else, so §H9's mandatory
// "final validation mismatch" and "final fingerprint mismatch" refusals could never fire.
//
// The expected values are NOT written out here. They are read from the SAME tracked
// acceptance register the fitzRoy preflight validates against
// (data/reference/fitzroy-accepted-baselines.json -> baselines[].measured), so the offline
// gate and the database gate cannot drift apart, and the DraftGuru counts come from the one
// DRAFTGURU_EXPECTED constant the preflight already uses. This stage asserts one thing the
// offline validator structurally cannot: that the database actually RECEIVED that dataset.
// ---------------------------------------------------------------------------

/**
 * How each accepted `measured` key is counted in PostgreSQL.
 *
 * `venues` and `club_identities` are counted as identities REFERENCED BY MATCHES rather than
 * as `SELECT count(*)` over the tables, because `clubs` and `venues` also carry reference
 * data that this baseline never claimed to describe.
 *
 * `players` is counted over the AFL Tables external identities, not over `players`: the
 * canonical identity is the AFL Tables profile URL (§H4), and the `players` table also holds
 * whatever canonical shells the DraftGuru stage minted afterwards.
 */
const MEASURED_SQL: Record<string, string> = {
  matches: 'SELECT count(*) FROM matches',
  matches_with_player_rows: 'SELECT count(DISTINCT match_id) FROM player_match_stats',
  seasons_first: 'SELECT min(season) FROM matches',
  seasons_last: 'SELECT max(season) FROM matches',
  venues: 'SELECT count(DISTINCT venue_id) FROM matches WHERE venue_id IS NOT NULL',
  attendance_known: 'SELECT count(*) FROM matches WHERE attendance IS NOT NULL',
  club_identities:
    'SELECT count(*) FROM (SELECT home_club_id AS club_id FROM matches'
    + ' UNION SELECT away_club_id FROM matches) c',
  players:
    'SELECT count(*) FROM external_identities ei JOIN sources s ON s.id = ei.source_id'
    + " WHERE s.key = 'afltables'",
  player_match_rows: 'SELECT count(*) FROM player_match_stats',
  brownlow_round_vote_rows: 'SELECT count(*) FROM brownlow_round_votes',
};

/**
 * Accepted `measured` keys deliberately NOT gated in the database, and why. Listing them
 * explicitly — rather than ignoring whatever has no SQL — is what stops this gate from
 * silently shrinking when the register grows a key: an UNKNOWN key is a refusal.
 */
const MEASURED_NOT_DB_GATED: Record<string, string> = {
  players_with_dob:
    'birth dates arrive via player_birth_evidence and DOB enrichment (ISSUE-090), so a raw '
    + 'count is not this baseline’s claim; gated offline by the importer and register.',
  players_with_dob_conflict: 'same evidence model as players_with_dob.',
};

export type FinalCheck = { key: string; sql: string; expected: number };

/** Build the check list from the tracked register. Refuses rather than guessing. */
export function finalValidationChecks(
  register: Record<string, unknown> | null,
  draftguru: { persons: number; picks: number } = DRAFTGURU_EXPECTED,
): FinalCheck[] {
  const label = selectAcceptedBaseline(register).label;
  const baseline = ((register!.baselines ?? []) as Array<Record<string, unknown>>)
    .find((b) => String(b.snapshot_label) === label)!;
  const measured = baseline.measured as Record<string, unknown> | undefined;
  if (!measured) {
    throw new RebuildRefused(
      `The accepted baseline '${label}' records no 'measured' block, so the rebuild has no `
      + 'expected dataset to validate against and will not invent one.');
  }

  const checks: FinalCheck[] = [];
  for (const [key, value] of Object.entries(measured)) {
    if (key.startsWith('$')) continue;                       // $comment and friends
    if (key in MEASURED_NOT_DB_GATED) continue;
    const sql = MEASURED_SQL[key];
    if (!sql) {
      throw new RebuildRefused(
        `The accepted baseline records measured key '${key}', but this rebuild has no `
        + 'database counterpart for it and no recorded reason to skip it. Add it to '
        + 'MEASURED_SQL, or record why it is not database-gated. The final validation will '
        + 'not silently ignore part of the accepted dataset.');
    }
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new RebuildRefused(
        `The accepted baseline's measured '${key}' is not an integer.`);
    }
    checks.push({ key, sql, expected: value });
  }

  // Not a `measured` key, and the one gate the brief names outright: 2026 belongs to
  // current-season ingestion and must never appear in the historical core (§H4).
  checks.push({
    key: 'matches_after_accepted_last_season',
    sql: `SELECT count(*) FROM matches WHERE season > ${
      Number(measured.seasons_last)}`,
    expected: 0,
  });

  checks.push({ key: 'draft_persons', sql: 'SELECT count(*) FROM draft_persons',
                expected: draftguru.persons });
  checks.push({ key: 'draft_picks', sql: 'SELECT count(*) FROM draft_picks',
                expected: draftguru.picks });

  // AFLDB-ISSUE-095 D7. The club_seasons gate §8 of the runbook deferred until the
  // domain had a canonical contract. It now has one — the table is derived from this
  // same match set — so a zero-row club_seasons is a rebuild FAILURE, not a known gap.
  for (const check of clubSeasonChecks(Number(measured.seasons_last))) checks.push(check);

  // AFLDB-ISSUE-111. Added together with the COLEMAN stage, never before it: a gate
  // whose data source does not yet exist would fail every rebuild (the ISSUE-093 §H15.5
  // rule).
  for (const check of colemanChecks(Number(measured.seasons_last))) checks.push(check);

  return checks;
}

/**
 * The declared Coleman span, read from the tracked derivation contract.
 *
 * Never a literal here: the loader obeys the same declaration, so the gate and the
 * derivation cannot drift apart. A missing or malformed contract refuses rather than
 * defaulting to a year nobody chose.
 */
export function colemanFirstSeason(
  readContract: () => Record<string, unknown> | null = () => {
    const path = join(REPO_ROOT, COLEMAN_CONTRACT);
    return existsSync(path)
      ? JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
      : null;
  },
): number {
  const first = readContract()?.first_season;
  if (typeof first !== 'number' || !Number.isInteger(first)) {
    throw new RebuildRefused(
      `${COLEMAN_CONTRACT} declares no integer first_season, so the rebuild has no `
      + 'Coleman span to validate against and will not invent one.');
  }
  return first;
}

/**
 * Structural invariants for the derived Coleman family. Read-only scalar counts.
 *
 * The row count and the season count are gated separately on purpose. Every season in
 * the declared span must produce a winner, which is the season gate; the row gate is
 * equal to it because the accepted 1980-2025 corpus contains no tied season (ISSUE-111
 * G3 measured 46 derived winners over 46 seasons). A future tie is a real result, not a
 * fault — but it must reach a curator loudly rather than appear silently, which is
 * exactly what a row-count mismatch here does.
 */
export function colemanChecks(
  acceptedLastSeason: number,
  firstSeason: number = colemanFirstSeason(),
): FinalCheck[] {
  const span = acceptedLastSeason - firstSeason + 1;
  const winners = "SELECT count(*) FROM award_winners w JOIN awards a ON a.id = w.award_id"
    + " WHERE a.slug = 'coleman'";
  return [
    { key: 'coleman_rows', sql: winners, expected: span },

    { key: 'coleman_seasons',
      sql: "SELECT count(DISTINCT w.season) FROM award_winners w"
         + " JOIN awards a ON a.id = w.award_id WHERE a.slug = 'coleman'",
      expected: span },

    { key: 'coleman_first_season',
      sql: "SELECT min(w.season) FROM award_winners w"
         + " JOIN awards a ON a.id = w.award_id WHERE a.slug = 'coleman'",
      expected: firstSeason },

    // Derived rows are born linked: player_id comes from player_match_stats, so an
    // unlinked Coleman row means the derivation did not own the row it wrote.
    { key: 'coleman_unlinked_rows',
      sql: "SELECT count(*) FROM award_winners w JOIN awards a ON a.id = w.award_id"
         + " WHERE a.slug = 'coleman' AND w.player_id IS NULL",
      expected: 0 },

    // Provenance is the canonical source of the facts the award was derived from.
    // A surviving draftguru-owned row here is the duplication hazard the one-time
    // transition exists to prevent, caught before anyone sees 92 Coleman rows.
    { key: 'coleman_rows_not_derived_from_afltables',
      sql: "SELECT count(*) FROM award_winners w JOIN awards a ON a.id = w.award_id"
         + " WHERE a.slug = 'coleman' AND w.source_id IS DISTINCT FROM"
         + " (SELECT id FROM sources WHERE key = 'afltables')",
      expected: 0 },

    // The durable key is the AFL Tables profile path, never a surrogate id. A key whose
    // third field is an integer is the rejected coleman:<season>:<players.id> form.
    { key: 'coleman_rows_keyed_on_a_numeric_id',
      sql: "SELECT count(*) FROM award_winners w JOIN awards a ON a.id = w.award_id"
         + " WHERE a.slug = 'coleman'"
         + " AND w.source_record_id ~ '^coleman:[0-9]{4}:[0-9]+$'",
      expected: 0 },

    // 2026 belongs to the current-season pipeline, never this path's. The derivation
    // carries no hard-coded year; this proves it produced nothing beyond the core.
    { key: 'coleman_after_accepted_last_season',
      sql: 'SELECT count(*) FROM award_winners w JOIN awards a ON a.id = w.award_id'
         + ` WHERE a.slug = 'coleman' AND w.season > ${acceptedLastSeason}`,
      expected: 0 },
  ];
}

/**
 * The population the derivation must produce, measured — not assumed.
 *
 * 1,622 is the club-season universe of the accepted 1897-2025 core: it is what the
 * fitzRoy ladder witness returns across 129 seasons AND, independently, the count of
 * distinct (club string, season) pairs the contract's source_club_normalisation records
 * for the accepted snapshot's results.csv. Two derivations of the same number from the
 * same source, so a drift here means AFLDB's home-and-away match set has moved.
 */
export const CLUB_SEASONS_EXPECTED = {
  rows: 1622,
  brisbaneLionsFirstSeason: 1997,
};

/** Structural invariants for the derived ladder. Read-only scalar counts. */
export function clubSeasonChecks(acceptedLastSeason: number): FinalCheck[] {
  return [
    { key: 'club_seasons_rows',
      sql: 'SELECT count(*) FROM club_seasons',
      expected: CLUB_SEASONS_EXPECTED.rows },

    // The identity invariant. The derivation reads matches, which already store the
    // HISTORICAL identity, so it never re-points through afldb_identity_for_season.
    // This PROVES the era is right rather than forcing it: a match attributed to the
    // wrong era identity fails the rebuild instead of being normalised away silently.
    // It is also the gate that would have caught the ladder source's modernised labels
    // (Sydney to 1897, Footscray to 2025, North Melbourne over the Kangaroos era).
    { key: 'club_seasons_identity_era_violations',
      sql: 'SELECT count(*) FROM club_seasons cs JOIN clubs c ON c.id = cs.club_id'
         + ' WHERE cs.club_id IS DISTINCT FROM'
         + ' afldb_identity_for_season(c.organization_id, cs.season)',
      expected: 0 },

    { key: 'club_seasons_duplicate_identity_seasons',
      sql: 'SELECT count(*) FROM (SELECT season, club_id FROM club_seasons'
         + ' GROUP BY 1, 2 HAVING count(*) > 1) t',
      expected: 0 },

    // A rank is NULL only where two clubs are exactly level on premiership points AND
    // percentage, which the accepted corpus was audited for and does not contain. If a
    // match correction ever creates one, this fires loudly instead of the ladder quietly
    // losing a position. AFLDB-ISSUE-095 D2/§10.8.
    { key: 'club_seasons_unranked_rows',
      sql: 'SELECT count(*) FROM club_seasons WHERE ladder_rank IS NULL',
      expected: 0 },

    // The merger boundary, in the derived table rather than only in the relations table:
    // Fitzroy's 100 seasons are Fitzroy's, and the Lions' record starts in 1997.
    { key: 'club_seasons_brisbane_lions_first_season',
      sql: "SELECT min(season) FROM club_seasons WHERE club_id ="
         + " (SELECT id FROM clubs WHERE slug = 'brisbane-lions')",
      expected: CLUB_SEASONS_EXPECTED.brisbaneLionsFirstSeason },

    // 2026 is the current-season pipeline's (AFLDB-ISSUE-098/-099/-101), never this
    // path's. The derivation carries no hard-coded year: it produces nothing for 2026
    // because the accepted core contains no 2026 match. This gate proves that.
    { key: 'club_seasons_after_accepted_last_season',
      sql: `SELECT count(*) FROM club_seasons WHERE season > ${acceptedLastSeason}`,
      expected: 0 },
  ];
}

/**
 * Render the checks as ONE read-only stream.
 *
 * Every check reports its measured value whether it passes or fails, so the run's own output
 * is the evidence rather than a bare verdict; all failures are collected and reported
 * together, so one mismatch does not hide the next; and the stream ends in RAISE EXCEPTION
 * when anything failed, which under `ON_ERROR_STOP=1` is a non-zero psql exit and therefore
 * a failed stage. Nothing here writes: SELECTs and RAISE only.
 */
export function buildFinalValidationSql(checks: FinalCheck[]): string {
  const body = checks.map(({ key, sql, expected }) => `
  SELECT (${sql}) INTO actual;
  RAISE WARNING '${FINAL_VALIDATION_MARKER} ${key} = % (expected ${expected})', actual;
  IF actual IS DISTINCT FROM ${expected}::bigint THEN
    failures := failures || format('${key}: got %s, expected ${expected}', actual);
  END IF;`).join('\n');

  return `DO $afldb_final$
DECLARE
  actual   bigint;
  failures text[] := '{}';
BEGIN
${body}

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '${FINAL_VALIDATION_MARKER} FAILED: %',
      array_to_string(failures, '; ');
  END IF;
  RAISE WARNING '${FINAL_VALIDATION_MARKER} PASSED: ${checks.length} checks';
END $afldb_final$;
`;
}

export const FINAL_VALIDATION_MARKER = 'AFLDB-FINAL-VALIDATION';

/** The stream stage 9 runs, built from the tracked register at plan time. */
export function finalValidationSql(): string {
  const path = join(REPO_ROOT, ACCEPTED_BASELINES);
  const register = existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    : null;
  return buildFinalValidationSql(finalValidationChecks(register));
}

/**
 * The reset. Mirrors tools/maintenance/restore-test.sh:104-118's extension-preserving
 * discipline, and goes further because the migrations must re-run from nothing:
 * non-public schemas, then tables, views, sequences, routines and types that are NOT
 * extension members.
 *
 * EVERY loop carries the same two guards, and neither is decorative:
 *
 *   * `deptype = 'e'` — an extension member is never dropped. pg_trgm and unaccent live in
 *     public and are owned by another role, so dropping one of their objects would abort
 *     the whole reset. This is why `DROP SCHEMA public CASCADE` is not used.
 *   * `nspname !~ '^pg_'` — the internal schemas (pg_toast, pg_temp_N, pg_toast_temp_N) are
 *     excluded by REGEX, not by LIKE. `NOT LIKE 'pg\\_%'` needs a backslash that survives
 *     both the JavaScript template literal AND the SQL string literal; the earlier form
 *     emitted `'pg\\_%'` to the server, which matches "pg<backslash><any>" and therefore
 *     excluded NOTHING — pg_toast would have been selected and `DROP SCHEMA pg_toast`
 *     fails on a pinned system schema. The regex has no escape to lose.
 *
 * Every statement here is ordinary transactional DDL: there is no CONCURRENTLY, no
 * DROP DATABASE/TABLESPACE, no VACUUM and no transaction control inside the DO blocks, so
 * the whole reset rolls back cleanly. tools/db/prove-reset.ts depends on that property.
 */
export const RESET_SQL = `
DO $$ DECLARE s record; BEGIN
  FOR s IN SELECT n.nspname FROM pg_namespace n
            WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'public')
              AND n.nspname !~ '^pg_'
              AND NOT EXISTS (SELECT 1 FROM pg_depend d
                               WHERE d.classid = 'pg_namespace'::regclass
                                 AND d.objid = n.oid AND d.deptype = 'e')
  LOOP EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', s.nspname); END LOOP;
END $$;

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT c.relname FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
           WHERE c.relkind IN ('r', 'p')
             AND NOT EXISTS (SELECT 1 FROM pg_depend d
                              WHERE d.classid = 'pg_class'::regclass
                                AND d.objid = c.oid AND d.deptype = 'e')
  LOOP EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.relname); END LOOP;
END $$;

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT c.relname, c.relkind FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
           WHERE c.relkind IN ('v', 'm')
             AND NOT EXISTS (SELECT 1 FROM pg_depend d
                              WHERE d.classid = 'pg_class'::regclass
                                AND d.objid = c.oid AND d.deptype = 'e')
  LOOP EXECUTE format('DROP %s IF EXISTS public.%I CASCADE',
                      CASE r.relkind WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'VIEW' END,
                      r.relname); END LOOP;
END $$;

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT c.relname, c.relkind FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
           WHERE c.relkind IN ('S', 'f')
             AND NOT EXISTS (SELECT 1 FROM pg_depend d
                              WHERE d.classid = 'pg_class'::regclass
                                AND d.objid = c.oid AND d.deptype = 'e')
  LOOP EXECUTE format('DROP %s IF EXISTS public.%I CASCADE',
                      CASE r.relkind WHEN 'S' THEN 'SEQUENCE' ELSE 'FOREIGN TABLE' END,
                      r.relname); END LOOP;
END $$;

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
           WHERE NOT EXISTS (SELECT 1 FROM pg_depend d
                              WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP EXECUTE format('DROP ROUTINE IF EXISTS %s CASCADE', r.sig); END LOOP;
END $$;

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT t.oid::regtype AS ty FROM pg_type t
            JOIN pg_namespace n ON n.oid = t.typnamespace AND n.nspname = 'public'
           WHERE t.typtype IN ('e', 'd', 'c')
             AND NOT EXISTS (SELECT 1 FROM pg_depend d
                              WHERE d.objid = t.oid AND d.deptype = 'e')
             AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.reltype = t.oid)
  LOOP EXECUTE format('DROP TYPE IF EXISTS %s CASCADE', r.ty); END LOOP;
END $$;
`;

// ---------------------------------------------------------------------------
// Execution — dependency-injected so the whole contract is testable DB-free
// ---------------------------------------------------------------------------

export type RunResult = { status: number; stdout: string; stderr: string };

export type Deps = {
  runCommand: (argv: string[], env: Record<string, string>) => RunResult;
  /** The DESTRUCTIVE reset, and nothing else. */
  runSql: (dsn: string, sql: string) => void;
  /** The READ-ONLY final validation stream. Throws on a failed assertion. */
  runValidation: (dsn: string, sql: string) => void;
  fileExists: (path: string) => boolean;
  log: (line: string) => void;
};

export type ExecutionReport = {
  executed: string[];
  failedStage?: string;
  ok: boolean;
};

/**
 * Run the plan, stopping at the FIRST failure. There is no catch-and-continue: a failed
 * stage returns immediately, so every later stage is left unexecuted and visible as such.
 */
export function executeRebuild(
  stages: Stage[], target: ResolvedTarget, deps: Deps,
): ExecutionReport {
  const executed: string[] = [];

  for (const stage of stages) {
    deps.log(`==> ${stage.name}`);
    executed.push(stage.id);

    if (stage.run === 'sql') {
      try {
        deps.runSql(target.adminDsn, RESET_SQL);
      } catch (error) {
        deps.log(`    FAILED: ${(error as Error).message}`);
        return { executed, failedStage: stage.id, ok: false };
      }
      continue;
    }

    if (stage.run === 'validate') {
      try {
        deps.runValidation(target.adminDsn, stage.sql!);
      } catch (error) {
        deps.log(`    FAILED: ${(error as Error).message}`);
        return { executed, failedStage: stage.id, ok: false };
      }
      continue;
    }

    if (stage.run === 'command') {
      const result = deps.runCommand(stage.argv!, { ...(stage.envOverlay ?? {}) });
      if (result.status !== 0) {
        deps.log(`    FAILED: ${stage.id} exited ${result.status}`);
        return { executed, failedStage: stage.id, ok: false };
      }
      continue;
    }
  }

  return { executed, ok: true };
}

/** fitzRoy preflight: re-prove the full-history claim against the raw artefacts. */
export function fitzroyValidateArgv(source: FitzroySource): string[] {
  const argv = [resolvePython(), 'tools/migration/import_fitzroy_core.py',
                '--label', source.label, '--validate-only'];
  // The accepted canonical baseline is held to BOTH: its acceptance bindings (manifest and
  // artefact-set hashes, contract version, measured fingerprint) and — because
  // --require-accepted-baseline implies it — the full-history gates re-derived from the
  // artefacts. An acknowledged partial rebuild is still validated, just not against a claim
  // it never made.
  if (source.accepted) argv.push('--require-accepted-baseline');
  else if (source.fullHistory) argv.push('--require-full-history');
  return argv;
}

/** The preflight stage's own work, kept separate so it is testable in isolation. */
export function runPreflight(deps: Deps, source?: FitzroySource): void {
  // Before anything else. Every stage below this line is a Python child process, and a
  // missing interpreter surfaces on Windows as nothing but "The system cannot find the
  // path specified." — attributed to whichever stage happened to run first, which is how
  // this presented as a fitzRoy preflight failure. Name the interpreter and where it came
  // from instead. The value is a path this repository chose; no credential or unrelated
  // environment value is printed.
  const python = resolvePython();
  if (!deps.fileExists(python)) {
    const overridden = (process.env.AFLDB_PYTHON ?? '').trim() !== '';
    throw new RebuildRefused(
      `No Python interpreter at '${python}' `
      + `(${overridden ? 'from AFLDB_PYTHON' : 'the platform-local project default'}). `
      + 'Every data stage and preflight runs Python, so the rebuild cannot start. Set '
      + 'AFLDB_PYTHON to the interpreter for this checkout — a git worktree has no .venv '
      + 'of its own. Nothing has been destroyed.');
  }

  if (source) {
    const fitzroy = deps.runCommand(fitzroyValidateArgv(source), {});
    if (fitzroy.status !== 0) {
      throw new RebuildRefused(
        'fitzRoy preflight failed. Nothing has been destroyed.\n'
        + `${fitzroy.stdout}${fitzroy.stderr}`);
    }
  }
  for (const path of DRAFTGURU_PREFLIGHT_FILES) {
    if (!deps.fileExists(path)) {
      throw new RebuildRefused(
        `DraftGuru preflight: required tracked input is missing: ${path}. `
        + 'Nothing has been destroyed.');
    }
  }
  const result = deps.runCommand(draftguruValidateArgv(), {});
  if (result.status !== 0) {
    throw new RebuildRefused(
      'DraftGuru preflight failed (import_draftguru.py --validate-only). '
      + `Nothing has been destroyed.\n${result.stdout}${result.stderr}`);
  }
  assertDraftguruPreflight(result.stdout);

  // AFLDB-ISSUE-095 D7 durability gate. The witness's raw CSVs are gitignored, like every
  // other acquired snapshot: only the manifest is tracked, and the bytes are reproduced by
  // acquisition. So the one failure mode that matters is a checkout where the manifest
  // exists and the bytes do not — or do not hash to it. Proving that HERE, offline and
  // before the destructive stage, is the difference between refusing an unusable rebuild
  // and discovering at the last stage that the database has already been destroyed.
  const witness = deps.runCommand(ladderWitnessValidateArgv(), {});
  if (witness.status !== 0) {
    throw new RebuildRefused(
      'Ladder witness preflight failed. The tracked contract accepts '
      + `'${ladderWitnessLabel()}', but its acquired bytes are missing, incomplete or do `
      + 'not match the manifest. Re-acquire it with acquire_core.R --datasets ladder. '
      + `Nothing has been destroyed.\n${witness.stdout}${witness.stderr}`);
  }
}

/** Offline witness validation — no --compare, so no database is contacted. */
export function ladderWitnessValidateArgv(): string[] {
  return [resolvePython(), LADDER_WITNESS_VALIDATOR, '--label',
          ladderWitnessLabel()];
}

export function parseArgs(argv: string[]): Options {
  const opts: Options = {
    draftguruLabel: 'annual-html-20260826',
    planOnly: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--fitzroy-label') opts.fitzroyLabel = argv[++i];
    else if (arg === '--draftguru-label') opts.draftguruLabel = argv[++i];
    else if (arg === '--acknowledge-destroy') opts.acknowledgeDestroy = argv[++i];
    else if (arg === '--acknowledge-partial-fitzroy') opts.acknowledgePartialFitzroy = true;
    else if (arg === '--allow-owner-import-dsn') opts.allowOwnerImportDsn = true;
    else if (arg === '--plan') opts.planOnly = true;
    else throw new RebuildRefused(`Unknown argument: ${arg}`);
  }
  return opts;
}

// FINGERPRINT_QUERIES lived here: six unscoped `count(*)`s, exported and never called by
// anything, with no expected values to compare against. It is replaced by
// finalValidationChecks()/buildFinalValidationSql() above, which are bound to the accepted
// register and actually fail the run. Removed rather than left as a decorative export.

export default { planStages, resolveTarget, resolveFitzroySource, executeRebuild };

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const { spawnSync } = await import('node:child_process');

  // .env without a dotenv dependency, matching tests/setup.ts.
  try {
    for (const line of readFileSync(join(REPO_ROOT, '.env'), 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const [key, ...rest] = trimmed.split('=');
      if (!process.env[key.trim()]) process.env[key.trim()] = rest.join('=').trim();
    }
  } catch { /* CI supplies the variables directly */ }

  const opts = parseArgs(process.argv.slice(2));
  const target = resolveTarget(process.env, opts);
  const fitzroy = resolveFitzroySource(opts);

  const deps: Deps = {
    runCommand: (argv, env) => {
      const [command, ...args] = argv;
      const result = spawnSync(command, args, {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        shell: process.platform === 'win32',
        // The child gets an EXPLICIT import DSN. It never inherits the development value.
        env: { ...process.env, ...env },
      });
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
    },
    // psql, not postgres.js, and via the SHARED helper in tools/db/psql.ts — the same
    // binary, argv and error handling the rollback-only proof uses, so proving the proof
    // proves this path too.
    //
    // `executeRebuild` is synchronous by design (the whole stage graph is) and Node cannot
    // await inside it. The previous postgres.js form (`void client.unsafe(sql)`) never
    // called .then/.execute(), so postgres.js NEVER SENT THE RESET and the stage reported
    // success against an untouched database.
    runSql: (dsn, sql) => {
      const result = runPsql(dsn, sql, { spawn: spawnSync as SpawnSyncLike, cwd: REPO_ROOT });
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.status !== 0) {
        // psql error text names relations and roles, never the DSN or a password.
        throw new Error(`psql exited ${result.status}: ${result.stderr.trim()}`);
      }
    },
    // The final validation reports every measured value through RAISE WARNING, which psql
    // writes to STDERR — so unlike the reset, this stream's output must be relayed on the
    // SUCCESS path too. Without it a passing run would print a verdict and no evidence.
    runValidation: (dsn, sql) => {
      const result = runPsql(dsn, sql, { spawn: spawnSync as SpawnSyncLike, cwd: REPO_ROOT });
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      if (result.status !== 0) {
        throw new Error(
          `FINAL VALIDATION did not pass (psql exited ${result.status}). The rebuilt `
          + 'database does not match the accepted contracts; treat the rebuild as FAILED.');
      }
    },
    // AFLDB_PYTHON is normally an ABSOLUTE path, and path.join does not reset on one:
    // join('D:/repo', 'C:/py.exe') yields 'D:/repo/C:/py.exe'. Resolving relative to
    // the repo root unconditionally would have rejected every valid override.
    fileExists: (path) => existsSync(isAbsolute(path) ? path : join(REPO_ROOT, path)),
    log: (line) => console.log(line),
  };

  console.log('AFLDB clean test rebuild (AFLDB-ISSUE-093 §10)');
  console.log(`  target        : ${target.database}`);
  console.log(`  fitzRoy label : ${fitzroy.label}`
    + (fitzroy.accepted
      ? ' (ACCEPTED canonical full-history baseline)'
      : ' (PARTIAL — explicitly acknowledged)'));
  console.log(`  draftguru     : ${opts.draftguruLabel}`);
  if (target.importIsOwnerSubstitution) {
    console.log('  WARNING: data stages run as OWNER (--allow-owner-import-dsn). '
      + 'A missing afldb_import grant will not be caught — see AFLDB-ISSUE-083.');
  }

  const stages = planStages(target, fitzroy, opts);

  if (opts.planOnly) {
    console.log('\n--plan: the stage graph only, nothing executed and nothing destroyed.\n');
    stages.forEach((stage, i) => {
      console.log(`  ${i + 1}. [${stage.kind}] ${stage.id} — ${stage.name}`);
      if (stage.argv) console.log(`       ${stage.argv.join(' ')}`);
    });
    return 0;
  }

  // Preflight runs BEFORE the acknowledgement is even consumed, so a missing input is
  // reported without the operator having to authorise destruction first.
  runPreflight(deps, fitzroy);
  assertDestructiveAcknowledgement(target, opts.acknowledgeDestroy);

  const report = executeRebuild(stages, target, deps);
  if (!report.ok) {
    const remaining = stages.map((s) => s.id).filter((id) => !report.executed.includes(id));
    console.error(`\nREBUILD FAILED at stage '${report.failedStage}'.`);
    if (remaining.length) console.error(`Not run: ${remaining.join(', ')}`);
    return 1;
  }
  console.log('\nRebuild complete.');
  return 0;
}

// Only run when invoked directly, so the module stays importable by tests.
if (process.argv[1] && /rebuild-test\.ts$/.test(process.argv[1])) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error instanceof RebuildRefused
        ? `REFUSED: ${error.message}`
        : error);
      process.exit(1);
    });
}
