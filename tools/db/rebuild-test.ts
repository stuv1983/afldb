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

import { createHash } from 'node:crypto';
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

/**
 * AFLDB-ISSUE-113. The season-grain Brownlow artefact's manifest: the Stage-9 gate reads
 * its measured counts at plan time (never typed into this file), and the preflight
 * requires the artefact, manifest and adjudication file to exist and self-validate.
 */
const BROWNLOW_SEASON_MANIFEST = join('data', 'brownlow', 'season-votes.manifest.json');
export const BROWNLOW_SEASON_LOADER = 'tools/migration/import_brownlow_season.py';

/** AFLDB-ISSUE-118 §23.19. The height stages' loaders and the AFL API source contract. */
export const HEIGHT_LOADER = 'tools/migration/enrich_heights.py';
export const AFL_API_HEIGHT_LOADER = 'tools/migration/enrich_heights_afl_api.py';
export const WIKIPEDIA_HEIGHT_LOADER = 'tools/migration/enrich_heights_wikipedia.py';
/** The tracked Wikipedia height adjudication set (ISSUE-118 §23.19), keyed by AFL Tables profile. */
export const WIKIPEDIA_HEIGHT_CSV = join('data', 'players', 'height-evidence-wikipedia.csv');
const AFL_API_CONTRACT = join('tools', 'rebuild', 'afl_api', 'afl-api-contract.json');
/**
 * AFLDB-ISSUE-118 §23.24 Stage D1. The birth-date loader and the direct AFL Tables
 * acquisition contract that pins the accepted all-time club-list snapshot it reads.
 */
export const BIRTH_DATE_LOADER = 'tools/migration/enrich_birth_dates_afltables.py';
/** AFLDB-ISSUE-118 §23.27 Stage E2: coaches + match_coaches from the pinned coach pages and the baseline's Coach column. */
export const COACH_LOADER = 'tools/migration/import_match_coaches.py';
/**
 * AFLDB-ISSUE-118 §23.29 family F: father–son rule selections from the tracked, normalised
 * Wikipedia list (profile paths resolved once by `father_son.py normalize`, never a name at
 * load time), plus the adjudication set and the source provenance the loader carries.
 */
export const FATHER_SON_LOADER = 'tools/migration/father_son.py';
export const FATHER_SON_CSV = join('data', 'players', 'father-son-selections.csv');
export const FATHER_SON_ADJUDICATIONS = join('data', 'players', 'father-son-adjudications.csv');
export const FATHER_SON_PROVENANCE = join('data', 'players', 'father-son-selections.source.json');
/**
 * AFLDB-ISSUE-118 §23.31 family F (siblings): sibling pairs from the tracked, normalised
 * export of the Wikipedia football-families list (profile paths resolved once by
 * `family_siblings.py normalize`, never a name at load time), plus adjudications and provenance.
 */
export const SIBLINGS_LOADER = 'tools/migration/family_siblings.py';
export const SIBLINGS_CSV = join('data', 'players', 'sibling-relationships.csv');
export const SIBLINGS_ADJUDICATIONS = join('data', 'players', 'sibling-adjudications.csv');
export const SIBLINGS_PROVENANCE = join('data', 'players', 'sibling-relationships.source.json');
export const SIBLINGS_SUPPLEMENTS = join('data', 'players', 'sibling-supplements.csv');
/**
 * AFLDB-ISSUE-118 §23.33–§23.35 after-the-siren: canonical after_siren_kicks events
 * (migration 089) from the tracked normalised artefact — a deterministic normalisation of
 * the Wikipedia "kicks after the siren" table exports. The loader resolves match by
 * (season, round, kicker's organisation, opponent) with the artefact's own points as the
 * independent check, and the kicker by match participation, never by name. Adjudications
 * and provenance are tracked beside it; the raw exports are gitignored and unread at load.
 */
export const AFTER_SIREN_LOADER = 'tools/migration/after_siren.py';
export const AFTER_SIREN_CSV = join('data', 'records', 'after-siren-events.csv');
export const AFTER_SIREN_ADJUDICATIONS = join('data', 'records', 'after-siren-adjudications.csv');
export const AFTER_SIREN_PROVENANCE = join('data', 'records', 'after-siren-events.source.json');
const AFLTABLES_CONTRACT = join('tools', 'rebuild', 'afltables', 'afltables-contract.json');
export const BROWNLOW_SEASON_PREFLIGHT_FILES = [
  'data/brownlow/season-votes.csv',
  'data/brownlow/season-votes.manifest.json',
  'data/brownlow/player-identity.csv',
];

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
      // AFLDB-ISSUE-118 §23.19. players.height_cm from the accepted baseline's own AFL
      // Tables player_details register, reconciled to the snapshot's per-match rows and
      // joined to players ONLY through the afltables profile-url identities `fitzroy`
      // registered — so it must follow fitzroy and needs nothing later. The in-season
      // supplement it reads beside the baseline is pinned in the fitzRoy contract
      // (datasets.player_details.height_enrichment), never chosen here. No network.
      id: 'heights',
      name: `HEIGHTS — AFL Tables register (${fitzroy.label} + ${heightEnrichmentPins().supplements.map((s) => s.label).join(', ')})`,
      kind: 'data',
      run: 'command',
      argv: heightsImportArgv(fitzroy.label, python),
      envOverlay: dataEnv,
    },
    {
      // AFLDB-ISSUE-118 §23.19. The SECOND height evidence source: the AFL API season
      // rosters (tracked manifest pinned in tools/rebuild/afl_api/afl-api-contract.json,
      // roster.accepted_snapshot). Corroborating evidence rows only — it never writes
      // players.height_cm — reconciled through canonical club/season/guernsey facts
      // `fitzroy` loaded. No network.
      id: 'heights-afl-api',
      name: `HEIGHTS (AFL API) — corroborating evidence, ${aflApiRosterPin().label}`,
      kind: 'data',
      run: 'command',
      argv: aflApiHeightsArgv(python),
      envOverlay: dataEnv,
    },
    {
      // AFLDB-ISSUE-118 §23.19. The THIRD height evidence source: the tracked Wikipedia
      // infobox transcription for the Gridley height adjudication set (83 players),
      // keyed by the AFL Tables profile identities `fitzroy` registered. Evidence rows
      // only; never writes players.height_cm. Tracked artefact, no network.
      id: 'heights-wikipedia',
      name: 'HEIGHTS (Wikipedia) — tracked adjudication set, corroborating evidence',
      kind: 'data',
      run: 'command',
      argv: wikipediaHeightsArgv(python),
      envOverlay: dataEnv,
    },
    {
      // AFLDB-ISSUE-118 §23.24 Stage D1. players.dob from the AFL Tables all-time club
      // player lists — the very pages the accepted register came from, but keeping the
      // DOB column and the profile hrefs fitzRoy 1.8.0 drops. Manifest-pinned snapshot
      // (tools/rebuild/afltables/afltables-contract.json club_player_lists
      // .accepted_snapshot), joined to players ONLY through the afltables profile-url
      // identities `fitzroy` registered; fills dob only where NULL, records every date
      // seen as evidence, never overwrites a fitzRoy date. No network.
      id: 'birth-dates',
      name: `BIRTH DATES — AFL Tables club lists, ${afltablesClubListPin().label}`,
      kind: 'data',
      run: 'command',
      argv: birthDatesArgv(python),
      envOverlay: dataEnv,
    },
    {
      // AFLDB-ISSUE-118 §23.27 Stage E2. coaches (one row per person, keyed by the AFL
      // Tables coach page; linked to a players row ONLY through the page's profile path
      // and the afltables identities `fitzroy` registered — never by name) and
      // match_coaches (match, club, coach) from the baseline's own per-match Coach
      // column, reconciled to the pages by exact string. Manifest-pinned snapshot
      // (afltables-contract.json coaches.accepted_snapshot); the tracked parsed
      // artefacts are the input bytes. Needs matches, clubs and identities: after
      // fitzroy; nothing later reads it. No network.
      id: 'coaches',
      name: `COACHES — AFL Tables coach pages ${afltablesCoachesPin().label} + ${fitzroy.label} Coach column`,
      kind: 'data',
      run: 'command',
      argv: coachesImportArgv(fitzroy.label, python),
      envOverlay: dataEnv,
    },
    {
      // AFLDB-ISSUE-118 §23.29 family F. father_son_selections (one row per selection under
      // the AFL father–son rule: son, father, club, year, pick) and one parent_child row per
      // pair in player_relationships, from the TRACKED normalised Wikipedia list. Every
      // person is resolved ONLY through the AFL Tables profile path the artefact carries
      // and the identities fitzroy registered; the artefact's own row counts are the gates.
      // Needs players and identities: after fitzroy; nothing later reads it. No network.
      id: 'father-son',
      name: `FATHER–SON — tracked Wikipedia list, ${fatherSonMeasures().selections} selections`,
      kind: 'data',
      run: 'command',
      argv: fatherSonArgv(python),
      envOverlay: dataEnv,
    },
    {
      // AFLDB-ISSUE-118 §23.31 family F (siblings). One `sibling` row per pair of the
      // Wikipedia football-families export in player_relationships, from the TRACKED
      // normalised artefact; every person resolved ONLY through the AFL Tables profile path
      // it carries. Needs players and identities: after fitzroy; nothing later reads it.
      id: 'siblings',
      name: `SIBLINGS — tracked Wikipedia families export, ${siblingMeasures().pairs} pairs`,
      kind: 'data',
      run: 'command',
      argv: siblingsArgv(python),
      envOverlay: dataEnv,
    },
    {
      // AFLDB-ISSUE-118 §23.33–§23.35 after-the-siren. One after_siren_kicks row per event
      // of the TRACKED normalised artefact (migration 089); the match is resolved by
      // (season, round, both organisations) with the artefact's own final score as the
      // independent check, the kicker by match participation for the kicker's club, never
      // by name. Needs matches, clubs, player_match_stats and identities: after fitzroy;
      // nothing later reads it. No network; the raw exports are not read.
      id: 'after-siren',
      name: `AFTER-SIREN — tracked Wikipedia siren-kick exports, ${afterSirenMeasures().events} events`,
      kind: 'data',
      run: 'command',
      argv: afterSirenArgv(python),
      envOverlay: dataEnv,
    },
    {
      // AFLDB-ISSUE-118 §23.34 U.6. The after-siren reconciliation: re-resolve the tracked
      // artefact against the just-loaded database and check every canonical row against it.
      // Every expectation is derived from the artefact or that re-resolution — never a
      // typed constant — so it is independent of the season baseline. A VALIDATION stage:
      // it opens one connection and writes nothing.
      id: 'after-siren-reconcile',
      name: 'AFTER-SIREN RECONCILE — loaded table against a fresh re-resolution',
      kind: 'validation',
      run: 'command',
      argv: afterSirenReconcileArgv(python),
      envOverlay: dataEnv,
    },
    {
      // Must follow fitzroy: three tracked explicit decisions target canonical AFL Tables
      // identities and the importer HALTs rather than invent a replacement player.
      id: 'draftguru',
      name: `DRAFTGURU — ${opts.draftguruLabel}`,
      kind: 'data',
      run: 'command',
      argv: draftguruImportArgv(opts.draftguruLabel, python),
      envOverlay: dataEnv,
    },
    {
      // AFLDB-ISSUE-112 §7/§24. Awards and honours, every family from a tracked
      // manifest in data/awards/ and never from the retired legacy SQLite
      // source, which is deliberately absent from this stage's environment
      // (operator decision 8: it is never wired back into the rebuild).
      //
      // It must follow `draftguru`, which is where the canonical `players`
      // population is complete — every family carries player links, and a link
      // is dropped rather than mis-resolved when its player is absent. It runs
      // before `derived` because that is the runbook's declared position; no
      // derived summary reads an award today, so this is ordering discipline
      // rather than a data dependency.
      //
      // `coleman` is NOT in this list. It is derived, not acquired, and has its
      // own stage after `derived` because season_metadata must first decide
      // which seasons are complete (AFLDB-ISSUE-111). Running it here would
      // duplicate that ownership and break the ordering that gate depends on.
      //
      // The legacy `awards` group is NOT in this list either. Since §24 it
      // creates no definition and no winner row another group does not own, it
      // is compatibility-only, and it is the one group that still requires the
      // retired legacy source.
      id: 'awards-honours',
      name: 'AWARDS & HONOURS — tracked manifests, no legacy source',
      kind: 'data',
      run: 'command',
      argv: [python, 'tools/migration/import_awards.py', '--groups',
             ...AWARDS_HONOURS_GROUPS],
      envOverlay: dataEnv,
    },
    {
      // AFLDB-ISSUE-113 §8.6. The AUTHORITATIVE season-grain Brownlow totals, from the
      // tracked artefact data/brownlow/season-votes.csv (a re-keyed read-only export of
      // the preserved pre-cutover database), never from the retired legacy SQLite.
      //
      // It must follow `fitzroy`, which populates `players` and the AFL Tables profile
      // identities every artefact row is resolved through (fail-closed, zero rejections
      // or no write), and precede `derived`, which reads brownlow_season_votes to write
      // player_season_stats.brownlow_votes / brownlow_status and the career totals.
      // Without it the derived pass asserts "no medal that season" for 98 decided seasons
      // (§8.1). It never touches brownlow_round_votes, which fitzroy/settle own.
      id: 'brownlow-season',
      name: 'BROWNLOW SEASON — authoritative season totals from the tracked artefact',
      kind: 'data',
      run: 'command',
      argv: brownlowSeasonImportArgv(python),
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

/**
 * The awards/honours groups the rebuild runs, in `import_awards.py`'s own
 * GROUP_ORDER. Every one is in that module's LEGACY_FREE_GROUPS: each loads a
 * tracked manifest from `data/awards/` and reads no legacy SQLite.
 *
 * `awards` (the legacy re-extract) and `coleman` (derived, its own stage) are
 * deliberately absent — see the stage comment.
 */
export const AWARDS_HONOURS_GROUPS = [
  'all_australian', 'under_22', 'rising_star', 'club_bf', 'named_medals',
  'hall_of_fame', 'honour_teams', 'captaincies',
] as const;

/**
 * The per-family row counts the AWARDS & HONOURS stage must produce, measured
 * read-only from `afldb_dev` (AFLDB-ISSUE-112 §14.4, re-confirmed per slice in
 * §17-§24) and equal to the tracked manifests' own declared row counts, which
 * their parsers gate offline. Two derivations of the same number, so a drift
 * means a manifest changed without its contract changing.
 *
 * These are ROW counts, not link counts. A row loads whether or not its player
 * resolves, so this gate is independent of the player-link question recorded in
 * §24.5 — a link that cannot be re-resolved leaves the row present and
 * unlinked, which this gate must not mask by also asserting a linked count.
 */
export const AWARDS_HONOURS_EXPECTED = {
  honourTeamMembers: 113,
  hallOfFame: 343,
  /** 1,375 bootstrap rows + 399 AFLDB-ISSUE-118 §23.21 rows for the six missing clubs. */
  captaincies: 1774,
  risingStarNominations: 766,
  risingStarWinners: 33,
  allAustralian: 1244,
  clubBestAndFairest: 752,
  /** 979 legacy-extracted rows + 328 AFLDB-ISSUE-118 §23.20 medal transcriptions. */
  namedMedals: 1307,
  under22: 330,
  /** bf-* (19) + named medals (24) + all-australian + rising-star + 22-under-22. */
  awardDefinitions: 46,
};

/**
 * Structural invariants for the manifest-loaded awards and honours families.
 * Read-only scalar counts, in the clubSeasonChecks/colemanChecks mould.
 *
 * Added together with the AWARDS & HONOURS stage, never before it: a gate whose
 * data source does not yet exist would fail every rebuild (the ISSUE-093
 * §H15.5 rule).
 */
export function awardsHonoursChecks(acceptedLastSeason: number): FinalCheck[] {
  const winners = (predicate: string) =>
    'SELECT count(*) FROM award_winners w JOIN awards a ON a.id = w.award_id'
    + ` WHERE ${predicate}`;
  const e = AWARDS_HONOURS_EXPECTED;
  return [
    { key: 'honour_team_members_rows',
      sql: 'SELECT count(*) FROM honour_team_members',
      expected: e.honourTeamMembers },

    { key: 'hall_of_fame_rows', sql: 'SELECT count(*) FROM hall_of_fame',
      expected: e.hallOfFame },

    { key: 'captaincies_rows', sql: 'SELECT count(*) FROM captaincies',
      expected: e.captaincies },

    { key: 'rising_star_nomination_rows',
      sql: 'SELECT count(*) FROM award_nominations n JOIN awards a ON a.id = n.award_id'
         + " WHERE a.slug = 'rising-star'",
      expected: e.risingStarNominations },

    { key: 'rising_star_winner_rows', sql: winners("a.slug = 'rising-star'"),
      expected: e.risingStarWinners },

    { key: 'all_australian_rows', sql: winners("a.slug = 'all-australian'"),
      expected: e.allAustralian },

    { key: 'club_best_and_fairest_rows',
      sql: winners("a.category = 'club_best_and_fairest'"),
      expected: e.clubBestAndFairest },

    { key: 'named_medal_rows',
      sql: winners("a.category IN ('award', 'draft_pick')"
                   + " AND a.slug NOT IN ('rising-star', 'coleman')"),
      expected: e.namedMedals },

    { key: 'under_22_rows', sql: winners("a.slug = '22-under-22'"),
      expected: e.under22 },

    // Every family's parent row exists. A missing definition is not a smaller
    // awards table — ON DELETE CASCADE means it is a silently emptied family.
    { key: 'award_definitions_rows',
      sql: "SELECT count(*) FROM awards WHERE slug <> 'coleman'",
      expected: e.awardDefinitions },

    // The whole point of the stage: no honours row may be left without its
    // provenance, and none may claim a source the manifests do not carry.
    { key: 'award_winners_without_a_source',
      sql: 'SELECT count(*) FROM award_winners WHERE source_id IS NULL',
      expected: 0 },

    // 2026 belongs to the current-season pipeline. The Rising Star manifest
    // deliberately carries 2026 nominations, so this is scoped to the winner
    // and honour families the historical core owns.
    { key: 'award_winners_after_accepted_last_season',
      sql: 'SELECT count(*) FROM award_winners w JOIN awards a ON a.id = w.award_id'
         + ` WHERE a.slug <> '22-under-22' AND w.season > ${acceptedLastSeason}`,
      expected: 0 },
  ];
}

/** The manifest's measured season-grain facts, as the Stage-9 gate needs them. */
export type BrownlowSeasonExpected = {
  rows: number;
  votesTotal: number;
  winners: number;
  seasons: number;
  firstSeason: number;
  lastSeason: number;
};

/**
 * AFLDB-ISSUE-113. Read the artefact manifest's measured counts at plan time.
 *
 * Never a literal here: the loader verifies the artefact against the SAME manifest
 * before it writes, so the gate asserts that the database received exactly what the
 * manifest declares (16,120 rows / 79,113 votes / 112 winners / 98 seasons as measured
 * from the recovery source on 2026-09-04 — but measured, not typed). A missing or
 * malformed manifest refuses rather than gating nothing.
 */
export function brownlowSeasonExpected(
  readManifest: () => Record<string, unknown> | null = () => {
    const path = join(REPO_ROOT, BROWNLOW_SEASON_MANIFEST);
    return existsSync(path)
      ? JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
      : null;
  },
): BrownlowSeasonExpected {
  const manifest = readManifest();
  const artefact = manifest?.artefact as Record<string, unknown> | undefined;
  if (!artefact) {
    throw new RebuildRefused(
      `${BROWNLOW_SEASON_MANIFEST} is missing or records no 'artefact' block. The `
      + 'BROWNLOW SEASON stage has no declared contract to validate against, and the '
      + 'rebuild will not invent one.');
  }
  const integer = (key: string): number => {
    const value = artefact[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new RebuildRefused(
        `${BROWNLOW_SEASON_MANIFEST}: artefact.${key} is not a non-negative integer.`);
    }
    return value;
  };
  return {
    rows: integer('rows'),
    votesTotal: integer('votes_total'),
    winners: integer('winners'),
    seasons: integer('seasons'),
    firstSeason: integer('first_season'),
    lastSeason: integer('last_season'),
  };
}

/**
 * Structural invariants for the season-grain Brownlow table, in the
 * clubSeasonChecks/colemanChecks mould. Read-only scalar counts.
 *
 * These re-record the retired ISSUE-090 §27.5 gate ("no legacy-free writer for
 * brownlow_season_votes") as a Stage-9 fingerprint, now that the writer exists.
 */
export function brownlowSeasonChecks(
  acceptedLastSeason: number,
  expected: BrownlowSeasonExpected = brownlowSeasonExpected(),
): FinalCheck[] {
  const from = 'FROM brownlow_season_votes';
  return [
    { key: 'brownlow_season_rows', sql: `SELECT count(*) ${from}`, expected: expected.rows },

    { key: 'brownlow_season_votes_total',
      sql: `SELECT coalesce(sum(votes), 0) ${from}`, expected: expected.votesTotal },

    { key: 'brownlow_season_winners',
      sql: `SELECT count(*) ${from} WHERE is_winner`, expected: expected.winners },

    { key: 'brownlow_season_seasons',
      sql: `SELECT count(DISTINCT season) ${from}`, expected: expected.seasons },

    { key: 'brownlow_season_first_season',
      sql: `SELECT coalesce(min(season), 0) ${from}`, expected: expected.firstSeason },

    { key: 'brownlow_season_last_season',
      sql: `SELECT coalesce(max(season), 0) ${from}`, expected: expected.lastSeason },

    // Every row is acquired from AFL Tables facts and keyed by the profile path the
    // rebuild preserves; a row with other provenance did not come from this loader.
    { key: 'brownlow_season_rows_not_sourced_from_afltables',
      sql: `SELECT count(*) ${from} b LEFT JOIN sources s ON s.id = b.source_id`
         + " WHERE s.key IS DISTINCT FROM 'afltables'",
      expected: 0 },

    { key: 'brownlow_season_rows_not_keyed_by_profile_path',
      sql: `SELECT count(*) ${from} WHERE source_record_id !~ `
         + "'^brownlow-season:[0-9]{4}:players/[A-Z]/[^/]+\\.html$'",
      expected: 0 },

    // A pending season must never read as decided (§8.2 coverage semantics): the
    // current season belongs to the settle pipeline and has no season total yet.
    { key: 'brownlow_season_after_accepted_last_season',
      sql: `SELECT count(*) ${from} WHERE season > ${acceptedLastSeason}`,
      expected: 0 },
  ];
}

/** The BROWNLOW SEASON data-stage command line; the same interpreter as every stage. */
export function brownlowSeasonImportArgv(python: string = resolvePython()): string[] {
  return [python, BROWNLOW_SEASON_LOADER];
}

/** Offline artefact/manifest/adjudication validation — no database is contacted. */
export function brownlowSeasonValidateArgv(python: string = resolvePython()): string[] {
  return [python, BROWNLOW_SEASON_LOADER, '--validate-only'];
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

/** The one DraftGuru importer entry point, named once. */
export const DRAFTGURU_IMPORTER = 'tools/rebuild/draftguru/import_draftguru.py';

/**
 * The DraftGuru data-stage command line. Built per call, not frozen at module load, so
 * AFLDB_PYTHON is honoured; `python` is threaded in by planStages so the whole graph keeps
 * its single interpreter resolution.
 */
export function draftguruImportArgv(label: string,
                                    python: string = resolvePython()): string[] {
  return [python, DRAFTGURU_IMPORTER, '--label', label];
}

/**
 * The DraftGuru preflight command line: the SAME argv the data stage will run, plus
 * --validate-only. AFLDB-ISSUE-112 §28.4 — this used to take no label and emit only
 * --validate-only, so the importer fell back to its own hardcoded STAGE_A_LABEL default
 * while the data stage imported whatever --draftguru-label selected. With both snapshot
 * directories present that would have verified snapshot A and imported snapshot B. Deriving
 * one argv from the other makes the two structurally incapable of disagreeing.
 */
export function draftguruValidateArgv(label: string,
                                      python: string = resolvePython()): string[] {
  return [...draftguruImportArgv(label, python), '--validate-only'];
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
 * whatever canonical shells the DraftGuru stage minted afterwards. It counts DISTINCT
 * players behind those identities, because since AFLDB-ISSUE-136 one player may carry two
 * profile URLs (a renumbered AFL Tables profile folded into its continuing player under a
 * tracked `profile_url_continuity` rule); `players_with_renumbered_profile` gates exactly
 * how many do, so a rebuild that re-split them (identities 13,275, players 13,275) fails
 * here rather than passing on the identity row count alone.
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
    'SELECT count(DISTINCT ei.player_id) FROM external_identities ei'
    + ' JOIN sources s ON s.id = ei.source_id'
    + " WHERE s.key = 'afltables' AND ei.match_method = 'afltables_profile_url'"
    + ' AND ei.player_id IS NOT NULL',
  players_with_renumbered_profile:
    'SELECT count(*) FROM (SELECT ei.player_id FROM external_identities ei'
    + ' JOIN sources s ON s.id = ei.source_id'
    + " WHERE s.key = 'afltables' AND ei.match_method = 'afltables_profile_url'"
    + ' AND ei.player_id IS NOT NULL GROUP BY ei.player_id HAVING count(*) > 1) folded',
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
    + 'count is not this baseline’s claim; gated offline by the importer and register. The '
    + 'rebuilt total is gated by the birth-dates stage (players_with_dob_after_birth_dates).',
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

  // AFLDB-ISSUE-112. Added together with the AWARDS & HONOURS stage, for the
  // same §H15.5 reason as the Coleman gates above.
  for (const check of awardsHonoursChecks(Number(measured.seasons_last))) {
    checks.push(check);
  }

  // AFLDB-ISSUE-113. Added together with the BROWNLOW SEASON stage, for the same
  // §H15.5 reason. The expected values are read from the artefact's manifest, so the
  // gate and the loader cannot drift apart.
  for (const check of brownlowSeasonChecks(Number(measured.seasons_last))) {
    checks.push(check);
  }

  // AFLDB-ISSUE-118 §23.19. Added together with the HEIGHTS stages, for the same
  // §H15.5 reason. The expected values are read from the contracts' pin blocks.
  for (const check of heightChecks()) checks.push(check);

  // AFLDB-ISSUE-118 §23.24. Added together with the BIRTH DATES stage, for the same
  // §H15.5 reason. The expected values are read from the AFL Tables contract's pin block.
  for (const check of birthDateChecks()) checks.push(check);

  // AFLDB-ISSUE-118 §23.27. Added together with the COACHES stage, for the same §H15.5
  // reason. The expected values are read from the AFL Tables contract's coaches pin.
  for (const check of coachChecks()) checks.push(check);

  // AFLDB-ISSUE-118 §23.29. Added together with the FATHER–SON stage, for the same §H15.5
  // reason. The expected values are read from the tracked artefact itself.
  for (const check of fatherSonChecks()) checks.push(check);

  // AFLDB-ISSUE-118 §23.31. Added together with the SIBLINGS stage, for the same reason.
  for (const check of siblingChecks()) checks.push(check);

  // AFLDB-ISSUE-118 §23.33–§23.35. Added together with the AFTER-SIREN stage. The values
  // are the tracked artefact's own link-independent counts; the linkage / canonical
  // invariants are the AFTER-SIREN RECONCILE stage's own 38 checks.
  for (const check of afterSirenChecks()) checks.push(check);

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

/**
 * The preflight stage's own work, kept separate so it is testable in isolation.
 *
 * It takes the SAME `Options` object planStages() builds the data stages from, so the
 * snapshot this proves and the snapshot the rebuild then imports cannot be different
 * selections. See draftguruValidateArgv().
 */
export function runPreflight(deps: Deps, opts: Options, source?: FitzroySource): void {
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
  // The label proven here is opts.draftguruLabel — the one the data stage will import.
  const result = deps.runCommand(draftguruValidateArgv(opts.draftguruLabel), {});
  if (result.status !== 0) {
    throw new RebuildRefused(
      'DraftGuru preflight failed (import_draftguru.py --validate-only '
      + `--label ${opts.draftguruLabel}). `
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

  // AFLDB-ISSUE-113. The season-grain Brownlow artefact is TRACKED (unlike the acquired
  // snapshots above), so the failure modes are a checkout missing the files or bytes
  // that no longer hash to the manifest. Prove both offline, before destruction.
  for (const path of BROWNLOW_SEASON_PREFLIGHT_FILES) {
    if (!deps.fileExists(path)) {
      throw new RebuildRefused(
        `Brownlow season preflight: required tracked input is missing: ${path}. `
        + 'Nothing has been destroyed.');
    }
  }
  const brownlow = deps.runCommand(brownlowSeasonValidateArgv(), {});
  if (brownlow.status !== 0) {
    throw new RebuildRefused(
      `Brownlow season preflight failed (${BROWNLOW_SEASON_LOADER} --validate-only): `
      + 'the artefact, its manifest and the identity adjudication file do not agree. '
      + `Nothing has been destroyed.\n${brownlow.stdout}${brownlow.stderr}`);
  }

  // AFLDB-ISSUE-118 §23.19. The height stages read two acquired snapshots beside the
  // baseline — the pinned in-season supplement and the pinned AFL API roster set —
  // whose raw bytes are gitignored. Prove the manifest bindings (done inside the pin
  // readers, which refuse on a missing or mismatched manifest) and every artefact hash
  // offline, before destruction, exactly as the ladder witness is proven.
  if (source) {
    const heights = deps.runCommand(heightsValidateArgv(source.label), {});
    if (heights.status !== 0) {
      throw new RebuildRefused(
        `Height preflight failed (${HEIGHT_LOADER} --validate-only). The fitzRoy contract `
        + 'pins the in-season supplement(s) '
        + `${heightEnrichmentPins().supplements.map((s) => `'${s.label}'`).join(', ')}, `
        + 'but the register or a supplement is missing, incomplete or does not match its '
        + 'manifest. Nothing has been destroyed.\n'
        + `${heights.stdout}${heights.stderr}`);
    }
  }
  if (!deps.fileExists(WIKIPEDIA_HEIGHT_CSV)) {
    throw new RebuildRefused(
      `Wikipedia height preflight: required tracked input is missing: ${WIKIPEDIA_HEIGHT_CSV}. `
      + 'Nothing has been destroyed.');
  }
  const wikipedia = deps.runCommand(wikipediaHeightsValidateArgv(), {});
  if (wikipedia.status !== 0) {
    throw new RebuildRefused(
      `Wikipedia height preflight failed (${WIKIPEDIA_HEIGHT_LOADER} --validate-only): the `
      + `tracked artefact ${WIKIPEDIA_HEIGHT_CSV} is malformed. Nothing has been destroyed.\n`
      + `${wikipedia.stdout}${wikipedia.stderr}`);
  }
  const roster = deps.runCommand(aflApiHeightsValidateArgv(), {});
  if (roster.status !== 0) {
    throw new RebuildRefused(
      `AFL API roster preflight failed (${AFL_API_HEIGHT_LOADER} --validate-only). The `
      + `contract pins '${aflApiRosterPin().label}', but its acquired bytes are missing, `
      + 'incomplete or do not match the manifest. Re-acquire it with '
      + 'acquire_rosters.R --from 2012 --to <season>. Nothing has been destroyed.\n'
      + `${roster.stdout}${roster.stderr}`);
  }
  // AFLDB-ISSUE-118 §23.24. The birth-date stage reads a third acquired snapshot whose
  // raw bytes are gitignored: prove the pin binding (inside afltablesClubListPin) and
  // every parsed and raw artefact hash offline, before destruction.
  const birthDates = deps.runCommand(birthDatesValidateArgv(), {});
  if (birthDates.status !== 0) {
    throw new RebuildRefused(
      `Birth-date preflight failed (${BIRTH_DATE_LOADER} --validate-only). The AFL Tables `
      + `contract pins '${afltablesClubListPin().label}', but its acquired bytes are missing, `
      + 'incomplete or do not match the manifest. Re-acquire it with '
      + 'tools/rebuild/afltables/acquire_club_lists.R. Nothing has been destroyed.\n'
      + `${birthDates.stdout}${birthDates.stderr}`);
  }
  // AFLDB-ISSUE-118 §23.27. The coaches stage reads the pinned coach-page snapshot (its
  // parsed artefacts tracked, raw bytes gitignored) and the baseline's own player_stats
  // files: prove the pin binding (inside afltablesCoachesPin) and every hash offline.
  if (source) {
    const coaches = deps.runCommand(coachesValidateArgv(source.label), {});
    if (coaches.status !== 0) {
      throw new RebuildRefused(
        `Coaches preflight failed (${COACH_LOADER} --validate-only). The AFL Tables contract `
        + `pins '${afltablesCoachesPin().label}', but its tracked artefacts, the baseline's `
        + 'player_stats files or a pinned supplement are missing, incomplete or do not match '
        + 'their manifests. Re-acquire the coach pages with '
        + 'tools/rebuild/afltables/acquire_coaches.py. Nothing has been destroyed.\n'
        + `${coaches.stdout}${coaches.stderr}`);
    }
  }
  // AFLDB-ISSUE-118 §23.29. The father–son stage reads three TRACKED files (the normalised
  // list, its adjudications and its provenance): prove they are in the checkout and that
  // the loader accepts the artefact's shape offline, before destruction.
  for (const path of [FATHER_SON_CSV, FATHER_SON_ADJUDICATIONS, FATHER_SON_PROVENANCE]) {
    if (!deps.fileExists(path)) {
      throw new RebuildRefused(
        `Father–son preflight: required tracked input is missing: ${path}. `
        + 'Nothing has been destroyed.');
    }
  }
  const fatherSon = deps.runCommand(fatherSonValidateArgv(), {});
  if (fatherSon.status !== 0) {
    throw new RebuildRefused(
      `Father–son preflight failed (${FATHER_SON_LOADER} load --validate-only): the tracked `
      + `artefact ${FATHER_SON_CSV} is malformed. Nothing has been destroyed.\n`
      + `${fatherSon.stdout}${fatherSon.stderr}`);
  }
  // AFLDB-ISSUE-118 §23.31. The siblings stage likewise reads four TRACKED files (the
  // supplements are explicitly evidenced pairs the export lacks).
  for (const path of [SIBLINGS_CSV, SIBLINGS_ADJUDICATIONS, SIBLINGS_SUPPLEMENTS, SIBLINGS_PROVENANCE]) {
    if (!deps.fileExists(path)) {
      throw new RebuildRefused(
        `Siblings preflight: required tracked input is missing: ${path}. `
        + 'Nothing has been destroyed.');
    }
  }
  const siblings = deps.runCommand(siblingsValidateArgv(), {});
  if (siblings.status !== 0) {
    throw new RebuildRefused(
      `Siblings preflight failed (${SIBLINGS_LOADER} load --validate-only): the tracked `
      + `artefact ${SIBLINGS_CSV} is malformed. Nothing has been destroyed.\n`
      + `${siblings.stdout}${siblings.stderr}`);
  }
  // AFLDB-ISSUE-118 §23.33–§23.35. The after-siren stage reads three TRACKED files (the
  // artefact, its adjudications and its provenance); the raw exports are gitignored and
  // never read at load. Prove they are in the checkout and that the loader accepts the
  // artefact's shape offline, before destruction.
  for (const path of [AFTER_SIREN_CSV, AFTER_SIREN_ADJUDICATIONS, AFTER_SIREN_PROVENANCE]) {
    if (!deps.fileExists(path)) {
      throw new RebuildRefused(
        `After-siren preflight: required tracked input is missing: ${path}. `
        + 'Nothing has been destroyed.');
    }
  }
  const afterSiren = deps.runCommand(afterSirenValidateArgv(), {});
  if (afterSiren.status !== 0) {
    throw new RebuildRefused(
      `After-siren preflight failed (${AFTER_SIREN_LOADER} load --validate-only): the tracked `
      + `artefact ${AFTER_SIREN_CSV} is malformed or disagrees with its provenance. `
      + `Nothing has been destroyed.\n${afterSiren.stdout}${afterSiren.stderr}`);
  }
}

// ---------------------------------------------------------------------------
// AFLDB-ISSUE-118 §23.19 — the height stages' pinned inputs
// ---------------------------------------------------------------------------

/** SHA-256 of a tracked manifest's CANONICAL LF bytes (the AFLDB-ISSUE-114 lesson). */
function manifestSha256(path: string): string | null {
  if (!existsSync(path)) return null;
  const bytes = readFileSync(path).toString('utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(bytes, 'utf8').digest('hex');
}

export type PinnedManifest = { label: string; manifest: string; sha256: string };

/** Refuses unless the pinned manifest exists and hashes to its binding. */
function provePin(pin: PinnedManifest, what: string): void {
  const actual = manifestSha256(join(REPO_ROOT, pin.manifest));
  if (actual === null) {
    throw new RebuildRefused(
      `${what} pins '${pin.label}' at ${pin.manifest}, but that manifest is not in this `
      + 'checkout. The rebuild will not guess an input.');
  }
  if (actual !== pin.sha256) {
    throw new RebuildRefused(
      `${what} pins '${pin.label}' with manifest_sha256 ${pin.sha256.slice(0, 12)}…, but `
      + `${pin.manifest} hashes to ${actual.slice(0, 12)}…. A changed manifest is a `
      + 'successor decision, not something the rebuild resolves.');
  }
}

export type HeightEnrichmentPins = {
  supplements: PinnedManifest[];
  measured: { playersWithHeight: number; heightWithoutEvidence: number; heightConflictsOpen: number };
};

/**
 * The in-season supplement(s) and measured outcome the HEIGHTS stage is bound to, read
 * from the fitzRoy contract (datasets.player_details.height_enrichment). Never a
 * default: no pin, no stage. Each supplement's manifest binding is proven on read.
 */
export function heightEnrichmentPins(
  readContract: () => Record<string, unknown> | null = () => {
    const path = join(REPO_ROOT, FITZROY_CONTRACT);
    return existsSync(path)
      ? JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
      : null;
  },
): HeightEnrichmentPins {
  const contract = readContract();
  const datasets = contract?.datasets as Record<string, Record<string, unknown>> | undefined;
  const block = datasets?.player_details?.height_enrichment as Record<string, unknown> | undefined;
  const supplements = block?.supplements as Array<Record<string, unknown>> | undefined;
  const measured = block?.measured as Record<string, unknown> | undefined;
  if (!block || !Array.isArray(supplements) || supplements.length === 0 || !measured) {
    throw new RebuildRefused(
      `${FITZROY_CONTRACT} records no height enrichment binding `
      + '(datasets.player_details.height_enrichment with supplements and measured). '
      + 'AFLDB-ISSUE-118 §23.19 binds the in-season supplement explicitly; the rebuild '
      + 'will not pick one.');
  }
  const pins: PinnedManifest[] = supplements.map((s) => ({
    label: String(s.snapshot_label), manifest: String(s.manifest), sha256: String(s.manifest_sha256),
  }));
  for (const pin of pins) provePin(pin, 'The fitzRoy contract height_enrichment block');
  const int = (key: string): number => {
    const v = measured[key];
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      throw new RebuildRefused(`height_enrichment.measured.${key} is not an integer.`);
    }
    return v;
  };
  return {
    supplements: pins,
    measured: {
      playersWithHeight: int('players_with_height'),
      heightWithoutEvidence: int('height_without_evidence'),
      heightConflictsOpen: int('height_conflicts_open'),
    },
  };
}

export type AflApiRosterPin = PinnedManifest & { measured: { playersWithAflApiEvidence: number } };

/** The accepted AFL API roster snapshot, from roster.accepted_snapshot; binding proven. */
export function aflApiRosterPin(
  readContract: () => Record<string, unknown> | null = () => {
    const path = join(REPO_ROOT, AFL_API_CONTRACT);
    return existsSync(path)
      ? JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
      : null;
  },
): AflApiRosterPin {
  const contract = readContract();
  const roster = contract?.roster as Record<string, unknown> | undefined;
  const accepted = roster?.accepted_snapshot as
    { snapshot_label?: unknown; manifest?: unknown; manifest_sha256?: unknown;
      measured?: { players_with_afl_api_evidence?: unknown } } | undefined;
  const n = accepted?.measured?.players_with_afl_api_evidence;
  if (!accepted?.snapshot_label || !accepted.manifest || !accepted.manifest_sha256
      || typeof n !== 'number' || !Number.isInteger(n)) {
    throw new RebuildRefused(
      `${AFL_API_CONTRACT} records no accepted roster snapshot `
      + '(roster.accepted_snapshot with snapshot_label, manifest, manifest_sha256 and '
      + 'measured.players_with_afl_api_evidence). The rebuild will not guess one.');
  }
  const pin = {
    label: String(accepted.snapshot_label), manifest: String(accepted.manifest),
    sha256: String(accepted.manifest_sha256),
  };
  provePin(pin, 'The AFL API contract roster.accepted_snapshot block');
  return { ...pin, measured: { playersWithAflApiEvidence: n } };
}

/** The HEIGHTS data stage: the baseline register plus every pinned supplement. */
export function heightsImportArgv(fitzroyLabel: string,
                                  python: string = resolvePython()): string[] {
  const argv = [python, HEIGHT_LOADER, '--label', fitzroyLabel];
  for (const s of heightEnrichmentPins().supplements) argv.push('--supplement-label', s.label);
  return argv;
}

/** The same argv plus --validate-only: manifests and artefact hashes, no database. */
export function heightsValidateArgv(fitzroyLabel: string,
                                    python: string = resolvePython()): string[] {
  return [...heightsImportArgv(fitzroyLabel, python), '--validate-only'];
}

export function aflApiHeightsArgv(python: string = resolvePython()): string[] {
  return [python, AFL_API_HEIGHT_LOADER, '--label', aflApiRosterPin().label];
}

export function aflApiHeightsValidateArgv(python: string = resolvePython()): string[] {
  return [...aflApiHeightsArgv(python), '--validate-only'];
}

export function wikipediaHeightsArgv(python: string = resolvePython()): string[] {
  return [python, WIKIPEDIA_HEIGHT_LOADER, '--csv', WIKIPEDIA_HEIGHT_CSV];
}

export function wikipediaHeightsValidateArgv(python: string = resolvePython()): string[] {
  return [...wikipediaHeightsArgv(python), '--validate-only'];
}

/**
 * The adjudication set's size, read from the tracked artefact itself: the loader
 * refuses to write unless EVERY row resolves to a canonical player, so the number of
 * players carrying Wikipedia height evidence after a rebuild is exactly its row count.
 */
export function wikipediaHeightRows(
  readCsv: () => string | null = () => {
    const path = join(REPO_ROOT, WIKIPEDIA_HEIGHT_CSV);
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  },
): number {
  const text = readCsv();
  if (text === null) {
    throw new RebuildRefused(`${WIKIPEDIA_HEIGHT_CSV} is not in this checkout.`);
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2 || !lines[0].startsWith('afltables_profile,')) {
    throw new RebuildRefused(`${WIKIPEDIA_HEIGHT_CSV} has no data rows or an unexpected header.`);
  }
  return lines.length - 1;
}

/**
 * AFLDB-ISSUE-118 §23.19. Heights must survive a rebuild from scratch: the fill count,
 * the evidence-link invariant and the conflict count are pinned beside the inputs that
 * produced them, so a rebuild that silently drops the stage (or reproduces fewer
 * identities) fails here rather than being noticed by a Gridley cell weeks later.
 */
export function heightChecks(): FinalCheck[] {
  const pins = heightEnrichmentPins();
  const roster = aflApiRosterPin();
  return [
    { key: 'players_with_height',
      sql: 'SELECT count(*) FROM players WHERE height_cm IS NOT NULL',
      expected: pins.measured.playersWithHeight },
    { key: 'height_without_evidence',
      sql: 'SELECT count(*) FROM players WHERE height_cm IS NOT NULL AND height_evidence_id IS NULL',
      expected: pins.measured.heightWithoutEvidence },
    { key: 'height_conflicts_open',
      sql: "SELECT count(*) FROM data_issues WHERE issue_type = 'height_conflict' AND resolved_at IS NULL",
      expected: pins.measured.heightConflictsOpen },
    { key: 'players_with_afl_api_height_evidence',
      sql: "SELECT count(DISTINCT e.player_id) FROM player_height_evidence e JOIN sources s ON s.id = e.source_id WHERE s.key = 'afl_api'",
      expected: roster.measured.playersWithAflApiEvidence },
    { key: 'players_with_wikipedia_height_evidence',
      sql: "SELECT count(DISTINCT e.player_id) FROM player_height_evidence e JOIN sources s ON s.id = e.source_id WHERE s.key = 'wikipedia'",
      expected: wikipediaHeightRows() },
  ];
}

export type AflTablesClubListPin = PinnedManifest & {
  measured: {
    playersWithDob: number;
    dobWithoutEvidence: number;
    playersWithClubListBirthEvidence: number;
    clubListBirthConflictPlayers: number;
    dobDisagreeingWithClubList: number;
  };
};

/**
 * AFLDB-ISSUE-118 §23.24. The accepted AFL Tables all-time club-list snapshot, from
 * club_player_lists.accepted_snapshot; manifest binding proven on read (the contract
 * records the LF hash, and manifestSha256 normalises line endings, so a CRLF checkout
 * still proves). Never a default: no pin, no stage.
 */
export function afltablesClubListPin(
  readContract: () => Record<string, unknown> | null = () => {
    const path = join(REPO_ROOT, AFLTABLES_CONTRACT);
    return existsSync(path)
      ? JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
      : null;
  },
): AflTablesClubListPin {
  const contract = readContract();
  const lists = contract?.club_player_lists as Record<string, unknown> | undefined;
  const accepted = lists?.accepted_snapshot as
    { label?: unknown; manifest?: unknown; manifest_sha256_lf?: unknown;
      measured?: Record<string, unknown> } | undefined;
  if (!accepted?.label || !accepted.manifest || !accepted.manifest_sha256_lf
      || !accepted.measured) {
    throw new RebuildRefused(
      `${AFLTABLES_CONTRACT} records no accepted club-list snapshot `
      + '(club_player_lists.accepted_snapshot with label, manifest, manifest_sha256_lf and '
      + 'measured). The rebuild will not guess one.');
  }
  const pin = {
    label: String(accepted.label), manifest: String(accepted.manifest),
    sha256: String(accepted.manifest_sha256_lf),
  };
  provePin(pin, 'The AFL Tables contract club_player_lists.accepted_snapshot block');
  const measured = accepted.measured;
  const int = (key: string): number => {
    const v = measured[key];
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      throw new RebuildRefused(
        `club_player_lists.accepted_snapshot.measured.${key} is not an integer.`);
    }
    return v;
  };
  return {
    ...pin,
    measured: {
      playersWithDob: int('players_with_dob'),
      dobWithoutEvidence: int('dob_without_evidence'),
      playersWithClubListBirthEvidence: int('players_with_club_list_birth_evidence'),
      clubListBirthConflictPlayers: int('club_list_birth_conflict_players'),
      dobDisagreeingWithClubList: int('dob_disagreeing_with_club_list'),
    },
  };
}

export function birthDatesArgv(python: string = resolvePython()): string[] {
  return [python, BIRTH_DATE_LOADER, '--label', afltablesClubListPin().label];
}

/** The same argv plus --validate-only: manifest and artefact hashes, no database. */
export function birthDatesValidateArgv(python: string = resolvePython()): string[] {
  return [...birthDatesArgv(python), '--validate-only'];
}

/**
 * AFLDB-ISSUE-118 §23.24. Dates of birth must survive a rebuild from scratch: the
 * population with a date, the evidence-link invariant, the evidence coverage and the
 * contract's documented conflict/disagreement state are pinned beside the snapshot that
 * produced them. A rebuild that silently drops the stage, resolves fewer identities, or
 * starts overwriting fitzRoy dates fails here.
 */
export function birthDateChecks(): FinalCheck[] {
  const pin = afltablesClubListPin();
  const clubListEvidence = "player_birth_evidence e JOIN sources s ON s.id = e.source_id "
    + "WHERE s.key = 'afltables' AND e.evidence_type = 'afltables_club_list'";
  return [
    { key: 'players_with_dob_after_birth_dates',
      sql: 'SELECT count(*) FROM players WHERE dob IS NOT NULL',
      expected: pin.measured.playersWithDob },
    { key: 'dob_without_evidence',
      sql: 'SELECT count(*) FROM players WHERE dob IS NOT NULL AND dob_evidence_id IS NULL',
      expected: pin.measured.dobWithoutEvidence },
    { key: 'players_with_club_list_birth_evidence',
      sql: `SELECT count(DISTINCT e.player_id) FROM ${clubListEvidence}`,
      expected: pin.measured.playersWithClubListBirthEvidence },
    { key: 'club_list_birth_conflict_players',
      sql: `SELECT count(*) FROM (SELECT e.player_id FROM ${clubListEvidence} `
        + 'GROUP BY e.player_id HAVING count(DISTINCT e.dob) > 1) c',
      expected: pin.measured.clubListBirthConflictPlayers },
    { key: 'dob_disagreeing_with_club_list',
      sql: `SELECT count(DISTINCT e.player_id) FROM ${clubListEvidence} `
        + 'AND EXISTS (SELECT 1 FROM players p WHERE p.id = e.player_id AND p.dob IS NOT NULL AND p.dob <> e.dob)',
      expected: pin.measured.dobDisagreeingWithClubList },
  ];
}

export type AflTablesCoachesPin = PinnedManifest & {
  measured: {
    coaches: number;
    coachesLinkedToPlayers: number;
    coachesUnlinked: number;
    matchCoaches: number;
    matchesWithBothCoaches: number;
    matchesWithOneCoach: number;
    matchesWithoutCoach: number;
  };
};

/**
 * AFLDB-ISSUE-118 §23.27. The accepted AFL Tables coach-page snapshot, from
 * coaches.accepted_snapshot; manifest binding proven on read (LF hash, so a CRLF
 * checkout still proves). Never a default: no pin, no stage.
 */
export function afltablesCoachesPin(
  readContract: () => Record<string, unknown> | null = () => {
    const path = join(REPO_ROOT, AFLTABLES_CONTRACT);
    return existsSync(path)
      ? JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
      : null;
  },
): AflTablesCoachesPin {
  const contract = readContract();
  const block = contract?.coaches as Record<string, unknown> | undefined;
  const accepted = block?.accepted_snapshot as
    { label?: unknown; manifest?: unknown; manifest_sha256_lf?: unknown;
      measured?: Record<string, unknown> } | undefined | null;
  if (!accepted?.label || !accepted.manifest || !accepted.manifest_sha256_lf
      || !accepted.measured) {
    throw new RebuildRefused(
      `${AFLTABLES_CONTRACT} records no accepted coaches snapshot `
      + '(coaches.accepted_snapshot with label, manifest, manifest_sha256_lf and '
      + 'measured). The rebuild will not guess one.');
  }
  const pin = {
    label: String(accepted.label), manifest: String(accepted.manifest),
    sha256: String(accepted.manifest_sha256_lf),
  };
  provePin(pin, 'The AFL Tables contract coaches.accepted_snapshot block');
  const measured = accepted.measured;
  const int = (key: string): number => {
    const v = measured[key];
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      throw new RebuildRefused(`coaches.accepted_snapshot.measured.${key} is not an integer.`);
    }
    return v;
  };
  return {
    ...pin,
    measured: {
      coaches: int('coaches'),
      coachesLinkedToPlayers: int('coaches_linked_to_players'),
      coachesUnlinked: int('coaches_unlinked'),
      matchCoaches: int('match_coaches'),
      matchesWithBothCoaches: int('matches_with_both_coaches'),
      matchesWithOneCoach: int('matches_with_one_coach'),
      matchesWithoutCoach: int('matches_without_coach'),
    },
  };
}

/** The COACHES data stage: the pinned coach pages, the baseline and every pinned supplement. */
export function coachesImportArgv(fitzroyLabel: string, python: string = resolvePython()): string[] {
  const argv = [python, COACH_LOADER, '--label', afltablesCoachesPin().label, '--fitzroy-label', fitzroyLabel];
  for (const s of heightEnrichmentPins().supplements) argv.push('--supplement-label', s.label);
  return argv;
}

/** The same argv plus --validate-only: manifests and artefact hashes, no database. */
export function coachesValidateArgv(fitzroyLabel: string, python: string = resolvePython()): string[] {
  return [...coachesImportArgv(fitzroyLabel, python), '--validate-only'];
}

/**
 * AFLDB-ISSUE-118 §23.27. Coaching must survive a rebuild from scratch: every coach page
 * as a person, the player links exactly those the pages prove (and no link outside a
 * 'unique' status), the assignment count and the source's own coverage shape. A rebuild
 * that drops the stage, links by name, or loses assignments fails here.
 */
export function coachChecks(): FinalCheck[] {
  const pin = afltablesCoachesPin();
  const perMatch = 'SELECT m.id, count(mc.match_id) AS n FROM matches m '
    + 'LEFT JOIN match_coaches mc ON mc.match_id = m.id GROUP BY m.id';
  return [
    { key: 'coaches', sql: 'SELECT count(*) FROM coaches', expected: pin.measured.coaches },
    { key: 'coaches_linked_to_players',
      sql: "SELECT count(*) FROM coaches WHERE player_id IS NOT NULL AND link_status_value = 'unique'",
      expected: pin.measured.coachesLinkedToPlayers },
    { key: 'coaches_unlinked',
      sql: 'SELECT count(*) FROM coaches WHERE player_id IS NULL',
      expected: pin.measured.coachesUnlinked },
    { key: 'coaches_linked_outside_unique',
      sql: "SELECT count(*) FROM coaches WHERE player_id IS NOT NULL AND link_status_value <> 'unique'",
      expected: 0 },
    { key: 'match_coaches', sql: 'SELECT count(*) FROM match_coaches', expected: pin.measured.matchCoaches },
    { key: 'matches_with_both_coaches',
      sql: `SELECT count(*) FROM (${perMatch}) x WHERE n = 2`, expected: pin.measured.matchesWithBothCoaches },
    { key: 'matches_with_one_coach',
      sql: `SELECT count(*) FROM (${perMatch}) x WHERE n = 1`, expected: pin.measured.matchesWithOneCoach },
    { key: 'matches_without_coach',
      sql: `SELECT count(*) FROM (${perMatch}) x WHERE n = 0`, expected: pin.measured.matchesWithoutCoach },
  ];
}

// ---------------------------------------------------------------------------
// AFLDB-ISSUE-118 §23.29 — father–son rule selections, gated on the tracked artefact
// ---------------------------------------------------------------------------

export function fatherSonArgv(python: string = resolvePython()): string[] {
  return [python, FATHER_SON_LOADER, 'load', '--csv', FATHER_SON_CSV, '--provenance', FATHER_SON_PROVENANCE];
}

/** The same argv plus --validate-only: the artefact's shape, no database. */
export function fatherSonValidateArgv(python: string = resolvePython()): string[] {
  return [...fatherSonArgv(python), '--validate-only'];
}

/** A minimal RFC 4180 reader: quoted fields may hold commas, quotes and newlines. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f !== '')) rows.push(row); }
  return rows;
}

export type FatherSonMeasures = { selections: number; sonsLinked: number; fathersLinked: number; distinctFathersLinked: number };

/**
 * The artefact's own counts. The loader refuses to write unless every non-empty profile
 * resolves to a canonical identity and every link status agrees with its profile, so the
 * rows, linked sons and linked fathers after a rebuild are exactly these.
 */
export function fatherSonMeasures(
  readCsv: () => string | null = () => {
    const path = join(REPO_ROOT, FATHER_SON_CSV);
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  },
): FatherSonMeasures {
  const text = readCsv();
  if (text === null) throw new RebuildRefused(`${FATHER_SON_CSV} is not in this checkout.`);
  const rows = parseCsvRows(text);
  const header = rows[0] ?? [];
  const col = (name: string) => header.indexOf(name);
  const [profile, link, father, fatherLink] = ['drafted_profile', 'drafted_link', 'father_profile', 'father_link'].map(col);
  if (rows.length < 2 || header[0] !== 'source_key' || [profile, link, father, fatherLink].some((i) => i < 0)) {
    throw new RebuildRefused(`${FATHER_SON_CSV} has no data rows or an unexpected header.`);
  }
  const data = rows.slice(1);
  for (const r of data) {
    if ((r[link] === 'unmatched') !== (r[profile] === '') || (r[fatherLink] === 'unmatched') !== (r[father] === '')) {
      throw new RebuildRefused(`${FATHER_SON_CSV}: a link status disagrees with its profile (${r[0]}).`);
    }
  }
  return {
    selections: data.length,
    sonsLinked: data.filter((r) => r[profile] !== '').length,
    fathersLinked: data.filter((r) => r[father] !== '').length,
    distinctFathersLinked: new Set(data.filter((r) => r[father] !== '').map((r) => r[father])).size,
  };
}

/**
 * The father–son stage must survive a rebuild from scratch: every selection, the links
 * exactly those the artefact proves (none outside a trusted status), and one parent_child
 * relationship per selection. A rebuild that drops the stage or links by name fails here.
 */
export function fatherSonChecks(): FinalCheck[] {
  const m = fatherSonMeasures();
  return [
    { key: 'father_son_selections', sql: 'SELECT count(*) FROM father_son_selections', expected: m.selections },
    { key: 'father_son_sons_linked',
      sql: "SELECT count(*) FROM father_son_selections WHERE drafted_player_id IS NOT NULL AND drafted_link_status IN ('unique', 'resolved')",
      expected: m.sonsLinked },
    { key: 'father_son_fathers_linked',
      sql: "SELECT count(*) FROM father_son_selections WHERE father_player_id IS NOT NULL AND father_link_status IN ('unique', 'resolved')",
      expected: m.fathersLinked },
    { key: 'father_son_distinct_fathers',
      sql: 'SELECT count(DISTINCT father_player_id) FROM father_son_selections WHERE father_player_id IS NOT NULL',
      expected: m.distinctFathersLinked },
    { key: 'father_son_links_outside_trusted_status',
      sql: "SELECT count(*) FROM father_son_selections WHERE (drafted_player_id IS NOT NULL) <> (drafted_link_status IN ('unique', 'resolved')) OR (father_player_id IS NOT NULL) <> (father_link_status IN ('unique', 'resolved'))",
      expected: 0 },
    { key: 'player_relationships_parent_child',
      sql: "SELECT count(*) FROM player_relationships WHERE relationship = 'parent_child'",
      expected: m.selections },
  ];
}

// ---------------------------------------------------------------------------
// AFLDB-ISSUE-118 §23.31 — sibling pairs, gated on the tracked artefact
// ---------------------------------------------------------------------------

export function siblingsArgv(python: string = resolvePython()): string[] {
  return [python, SIBLINGS_LOADER, 'load', '--csv', SIBLINGS_CSV, '--provenance', SIBLINGS_PROVENANCE];
}

/** The same argv plus --validate-only: the artefact's shape, no database. */
export function siblingsValidateArgv(python: string = resolvePython()): string[] {
  return [...siblingsArgv(python), '--validate-only'];
}

export type SiblingMeasures = {
  pairs: number; pairsBothLinked: number; brotherPairsLinked: number; playersWithBrother: number; unlinkedSides: number;
};

/** The labels under which a linked pair is two brothers (family_siblings.py BROTHER_LABELS). */
export const BROTHER_LABELS = ['brothers', 'twin brothers'];

/**
 * The artefact's own counts. The loader refuses to write unless every non-empty profile
 * resolves to a canonical identity and every link status agrees with its profile, so the
 * rows, linked sides and brother pairs after a rebuild are exactly these.
 */
export function siblingMeasures(
  readCsv: () => string | null = () => {
    const path = join(REPO_ROOT, SIBLINGS_CSV);
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  },
): SiblingMeasures {
  const text = readCsv();
  if (text === null) throw new RebuildRefused(`${SIBLINGS_CSV} is not in this checkout.`);
  const rows = parseCsvRows(text);
  const header = rows[0] ?? [];
  const col = (name: string) => header.indexOf(name);
  const [a, aLink, b, bLink, label] = ['person_a_profile', 'person_a_link', 'person_b_profile', 'person_b_link', 'relationship_label'].map(col);
  if (rows.length < 2 || header[0] !== 'source_key' || [a, aLink, b, bLink, label].some((i) => i < 0)) {
    throw new RebuildRefused(`${SIBLINGS_CSV} has no data rows or an unexpected header.`);
  }
  const data = rows.slice(1);
  const linked = (status: string) => status === 'unique' || status === 'resolved';
  for (const r of data) {
    if (linked(r[aLink]) !== (r[a] !== '') || linked(r[bLink]) !== (r[b] !== '')) {
      throw new RebuildRefused(`${SIBLINGS_CSV}: a link status disagrees with its profile (${r[0]}).`);
    }
    if (r[a] !== '' && r[a] === r[b]) throw new RebuildRefused(`${SIBLINGS_CSV}: a pair links one player to himself (${r[0]}).`);
  }
  const both = data.filter((r) => r[a] !== '' && r[b] !== '');
  const brothers = both.filter((r) => BROTHER_LABELS.includes(r[label]));
  return {
    pairs: data.length,
    pairsBothLinked: both.length,
    brotherPairsLinked: brothers.length,
    playersWithBrother: new Set(brothers.flatMap((r) => [r[a], r[b]])).size,
    unlinkedSides: data.reduce((n, r) => n + (r[a] === '' ? 1 : 0) + (r[b] === '' ? 1 : 0), 0),
  };
}

/**
 * The siblings stage must survive a rebuild from scratch: every pair, the links exactly
 * those the artefact proves, no self-pair, no canonical pair twice, and the brother
 * population the Grid Solver's has_brother builder reads. A rebuild that drops the stage
 * or links by name fails here.
 */
export function siblingChecks(): FinalCheck[] {
  const m = siblingMeasures();
  const labels = BROTHER_LABELS.map((l) => `'${l}'`).join(', ');
  return [
    { key: 'player_relationships_sibling', sql: "SELECT count(*) FROM player_relationships WHERE relationship = 'sibling'", expected: m.pairs },
    { key: 'sibling_pairs_both_linked',
      sql: "SELECT count(*) FROM player_relationships WHERE relationship = 'sibling' AND person_a_player_id IS NOT NULL AND person_b_player_id IS NOT NULL",
      expected: m.pairsBothLinked },
    { key: 'sibling_unlinked_sides',
      sql: "SELECT count(*) FILTER (WHERE person_a_player_id IS NULL) + count(*) FILTER (WHERE person_b_player_id IS NULL) FROM player_relationships WHERE relationship = 'sibling'",
      expected: m.unlinkedSides },
    { key: 'sibling_brother_pairs_linked',
      sql: `SELECT count(*) FROM player_relationships WHERE relationship = 'sibling' AND relationship_label IN (${labels}) AND person_a_player_id IS NOT NULL AND person_b_player_id IS NOT NULL`,
      expected: m.brotherPairsLinked },
    { key: 'sibling_players_with_brother',
      sql: `SELECT count(DISTINCT pid) FROM (SELECT person_a_player_id AS pid FROM player_relationships WHERE relationship = 'sibling' AND relationship_label IN (${labels}) AND person_a_player_id IS NOT NULL AND person_b_player_id IS NOT NULL UNION SELECT person_b_player_id FROM player_relationships WHERE relationship = 'sibling' AND relationship_label IN (${labels}) AND person_a_player_id IS NOT NULL AND person_b_player_id IS NOT NULL) x`,
      expected: m.playersWithBrother },
    { key: 'sibling_self_pairs',
      sql: "SELECT count(*) FROM player_relationships WHERE relationship = 'sibling' AND person_a_player_id = person_b_player_id",
      expected: 0 },
    { key: 'sibling_duplicate_pairs',
      sql: "SELECT count(*) FROM (SELECT 1 FROM player_relationships WHERE relationship = 'sibling' AND person_a_player_id IS NOT NULL AND person_b_player_id IS NOT NULL GROUP BY least(person_a_player_id, person_b_player_id), greatest(person_a_player_id, person_b_player_id) HAVING count(*) > 1) d",
      expected: 0 },
  ];
}

// ---------------------------------------------------------------------------
// AFLDB-ISSUE-118 §23.33–§23.35 — the after-siren stage
// ---------------------------------------------------------------------------

/** `after_siren.py load` against the tracked artefact and its provenance. */
export function afterSirenArgv(python: string = resolvePython()): string[] {
  return [python, AFTER_SIREN_LOADER, 'load', '--csv', AFTER_SIREN_CSV,
          '--provenance', AFTER_SIREN_PROVENANCE];
}

/** The same argv plus --validate-only: the artefact's shape, no database. */
export function afterSirenValidateArgv(python: string = resolvePython()): string[] {
  return [...afterSirenArgv(python), '--validate-only'];
}

/** `after_siren.py reconcile`: re-resolve the artefact and check the loaded table. */
export function afterSirenReconcileArgv(python: string = resolvePython()): string[] {
  return [python, AFTER_SIREN_LOADER, 'reconcile', '--csv', AFTER_SIREN_CSV];
}

export type AfterSirenMeasures = {
  events: number; premiershipEvents: number; otherCompetitionEvents: number;
  qualifyingEvents: number;
};

/**
 * The artefact's own link-independent counts. `after_siren.py load` refuses unless the
 * provenance's measures still equal a fresh read of the artefact, so a rebuild reproduces
 * exactly these — and none of them depends on identity resolution or the season baseline
 * (the qualifying predicate is a property of the stored columns, exactly what the
 * downstream `after_siren_winner` builder / Gridley `winaftersiren` filter reads).
 */
export function afterSirenMeasures(
  readCsv: () => string | null = () => {
    const path = join(REPO_ROOT, AFTER_SIREN_CSV);
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  },
): AfterSirenMeasures {
  const text = readCsv();
  if (text === null) throw new RebuildRefused(`${AFTER_SIREN_CSV} is not in this checkout.`);
  const rows = parseCsvRows(text);
  const header = rows[0] ?? [];
  const col = (name: string) => header.indexOf(name);
  const [prem, scored, effect] = ['premiership_season', 'kick_scored', 'kick_effect'].map(col);
  if (rows.length < 2 || header[0] !== 'event_key' || [prem, scored, effect].some((i) => i < 0)) {
    throw new RebuildRefused(`${AFTER_SIREN_CSV} has no data rows or an unexpected header.`);
  }
  const data = rows.slice(1);
  const isPrem = (r: string[]) => r[prem] === 'true';
  return {
    events: data.length,
    premiershipEvents: data.filter(isPrem).length,
    otherCompetitionEvents: data.filter((r) => !isPrem(r)).length,
    qualifyingEvents: data.filter((r) => isPrem(r)
      && (r[scored] === 'goal' || r[scored] === 'behind') && r[effect] === 'won').length,
  };
}

/**
 * The after-siren stage must survive a rebuild from scratch: every event loaded, the
 * premiership / other-competition split intact, the qualifying set the Grid Solver's
 * `after_siren_winner` builder reads, no event twice, and every row carrying its
 * provenance. A rebuild that drops the stage fails here; the deeper canonical / linkage
 * invariants are the separate `after-siren-reconcile` stage's 38 checks.
 */
export function afterSirenChecks(): FinalCheck[] {
  const m = afterSirenMeasures();
  return [
    { key: 'after_siren_kicks',
      sql: 'SELECT count(*) FROM after_siren_kicks', expected: m.events },
    { key: 'after_siren_premiership_rows',
      sql: 'SELECT count(*) FROM after_siren_kicks WHERE premiership_season',
      expected: m.premiershipEvents },
    { key: 'after_siren_other_competition_rows',
      sql: 'SELECT count(*) FROM after_siren_kicks WHERE NOT premiership_season',
      expected: m.otherCompetitionEvents },
    { key: 'after_siren_qualifying_rows',
      sql: "SELECT count(*) FROM after_siren_kicks WHERE premiership_season "
        + "AND kick_scored IN ('goal', 'behind') AND kick_effect = 'won'",
      expected: m.qualifyingEvents },
    { key: 'after_siren_duplicate_events',
      sql: 'SELECT count(*) FROM (SELECT 1 FROM after_siren_kicks GROUP BY source_id, '
        + 'source_record_id HAVING count(*) > 1) d',
      expected: 0 },
    { key: 'after_siren_rows_missing_provenance',
      sql: 'SELECT count(*) FROM after_siren_kicks WHERE source_id IS NULL '
        + 'OR source_record_id IS NULL OR import_batch_id IS NULL',
      expected: 0 },
  ];
}

/** Offline witness validation — no --compare, so no database is contacted. */
export function ladderWitnessValidateArgv(): string[] {
  return [resolvePython(), LADDER_WITNESS_VALIDATOR, '--label',
          ladderWitnessLabel()];
}

/**
 * The DraftGuru snapshot used when --draftguru-label is not given. It is the runner's
 * single default; import_draftguru.py's own STAGE_A_LABEL is never relied on, because the
 * runner now always passes --label explicitly to BOTH the preflight and the data stage.
 */
export const DEFAULT_DRAFTGURU_LABEL = 'annual-html-20260826';

export function parseArgs(argv: string[]): Options {
  const opts: Options = {
    draftguruLabel: DEFAULT_DRAFTGURU_LABEL,
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
  runPreflight(deps, opts, fitzroy);
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
