import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import {
  CLUB_SEASONS_EXPECTED,
  DRAFTGURU_EXPECTED,
  colemanChecks,
  colemanFirstSeason,
  LADDER_WITNESS_VALIDATOR,
  resolvePython,
  ladderWitnessLabel,
  ladderWitnessValidateArgv,
  DEFAULT_VENV_PYTHON,
  DEFAULT_DRAFTGURU_LABEL,
  DEFAULT_TARGET,
  REBUILD_TARGETS,
  parseArgs as parseRebuildArgs,
  DRAFTGURU_IMPORTER,
  draftguruImportArgv,
  draftguruValidateArgv,
  FINAL_VALIDATION_MARKER,
  RESET_SQL,
  RebuildRefused,
  assertDestructiveAcknowledgement,
  assertDraftguruPreflight,
  AWARDS_HONOURS_EXPECTED,
  AWARDS_HONOURS_GROUPS,
  awardsHonoursChecks,
  AFL_API_HEIGHT_LOADER,
  BIRTH_DATE_LOADER,
  COACH_LOADER,
  afltablesClubListPin,
  afltablesCoachesPin,
  coachChecks,
  coachesImportArgv,
  coachesValidateArgv,
  FATHER_SON_ADJUDICATIONS,
  FATHER_SON_CSV,
  FATHER_SON_LOADER,
  FATHER_SON_PROVENANCE,
  fatherSonArgv,
  fatherSonChecks,
  fatherSonMeasures,
  fatherSonValidateArgv,
  SIBLINGS_ADJUDICATIONS,
  SIBLINGS_CSV,
  SIBLINGS_LOADER,
  SIBLINGS_PROVENANCE,
  SIBLINGS_SUPPLEMENTS,
  siblingChecks,
  siblingMeasures,
  siblingsArgv,
  siblingsValidateArgv,
  AFTER_SIREN_ADJUDICATIONS,
  AFTER_SIREN_CSV,
  AFTER_SIREN_LOADER,
  AFTER_SIREN_PROVENANCE,
  afterSirenArgv,
  afterSirenChecks,
  afterSirenMeasures,
  afterSirenReconcileArgv,
  afterSirenValidateArgv,
  parseCsvRows,
  birthDateChecks,
  birthDatesArgv,
  birthDatesValidateArgv,
  HEIGHT_LOADER,
  WIKIPEDIA_HEIGHT_CSV,
  WIKIPEDIA_HEIGHT_LOADER,
  wikipediaHeightRows,
  wikipediaHeightsValidateArgv,
  aflApiHeightsValidateArgv,
  aflApiRosterPin,
  heightChecks,
  heightEnrichmentPins,
  heightsValidateArgv,
  BROWNLOW_SEASON_LOADER,
  BROWNLOW_SEASON_PREFLIGHT_FILES,
  brownlowSeasonChecks,
  brownlowSeasonExpected,
  brownlowSeasonImportArgv,
  brownlowSeasonValidateArgv,
  buildFinalValidationSql,
  executeRebuild,
  finalValidationChecks,
  finalValidationSql,
  fitzroyValidateArgv,
  planStages,
  resolveFitzroySource,
  resolveTarget,
  runPreflight,
  type Deps,
  type ResolvedTarget,
  type RunResult,
  type Stage,
} from '../tools/db/rebuild-test';
import {
  DATABASE_COMMENT_SQL,
  FINGERPRINT_SECTIONS,
  HEALTH_SQL,
  IDENTITY_SQL,
  MIGRATION_STATE_SQL,
  MIGRATION_TABLE_SQL,
  OTHER_SESSIONS_SQL,
  PROOF_DELIVERY_MARKER,
  PROOF_MARKER,
  PROOF_MARKER_COMMENT,
  PROOF_REQUIRED_MARKERS,
  PROOF_ROLLBACK_SENTINEL,
  TOLERATED_BACKEND_TYPES,
  buildProofSql,
  runResetProof,
  type Identity,
  type ProofDeps,
  type Row,
  type SessionRow,
} from '../tools/db/prove-reset';
import {
  PSQL_BIN,
  PSQL_PROBE_ABORT,
  PSQL_PROBE_OK,
  PSQL_PROBE_SQL,
  PsqlUnavailable,
  assertPsqlReachable,
  redact,
  psqlArgv,
  runPsql,
  type SpawnSyncLike,
} from '../tools/db/psql';
import {
  READ_ONLY_SQL,
  IDENTITY_SQL as VERIFIER_IDENTITY_SQL,
  parseArgs,
} from '../tools/db/fingerprint-test';
import {
  AFL_API_ADJUDICATION_DSN_ENV,
  AFL_API_ADJUDICATION_TARGET_ENV,
  AFL_API_ADJUDICATION_TOOL,
  REHEARSAL_HALT_EXIT_CODE,
  REHEARSAL_STOP_BOUNDARIES,
  aflApiAdjudicationArgv,
  assertRehearsalStop,
} from '../tools/db/rebuild-test';
import {
  AdjudicationRebuildRefused,
  CAPTURE_FORMAT,
  CAPTURE_VERSION,
  PENDING_CAPTURE_FILE,
  archivePendingCapture,
  archivedCaptureName,
  assertSequenceAboveLedger,
  buildCombinedCapture,
  captureDirectory,
  capturePayloadSha256,
  combinedCaptureStructureProblems,
  decidePendingCapture,
  fetchAflApiSourceIdIfPresent,
  nextIdentityValue,
  observeCaptureState,
  parseCombinedCapture,
  planActorRemap,
  planLedgerReinstatement,
  readPendingCapture,
  readPendingCaptureWithHash,
  readRebuildMarker,
  reinstateAndReplay,
  reinstatedCaptureProblems,
  reinstatedLedgerProblems,
  remapActors,
  resolveAdjudicationTarget,
  sameImporterRows,
  sameLedger,
  settleCapture,
  writePendingCapture,
  type CapturedLedgerRow,
  type CombinedCapture,
  type LiveReinstatementObservation,
  type RebuildMarker,
} from '../tools/migration/rebuild_afl_api_adjudications';
import {
  AflApiRecoveryAbort,
  R3_EXPECTED_COUNTS_BY_METHOD,
  R3_SOURCE_DATABASE,
  R3_SOURCE_DSN_ENV,
  R3_SOURCE_DUMP_SHA256,
  RECOVERY_EXPORT_FORMAT,
  RECOVERY_EXPORT_VERSION,
  assertR3ExportBinding,
  assertR3SourceDatabaseName,
  executeR3Export,
  formatR3ExportReport,
  normaliseR3SourceDumpSha256,
  parseAflApiImporterRecoveryExport,
  R4PostCommitFailure,
  R4_EXPORT_BINDING,
  R4_EXPORT_FILE_SHA256,
  R4_EXPORT_PAYLOAD_SHA256,
  R4_TRANSACTION_OPTIONS,
  executeR4Recovery,
  formatR4Report,
  parseR3ExportArgs,
  parseR4Args,
  readR4Export,
  recoverAflApiImporterIdentities,
  resolveR3OutputPath,
  resolveR3SourceDsn,
  resolveR4TargetDsn,
  type AflApiImporterRecoveryExport,
  type R4Connection,
  type VerifiedR4Export,
} from '../tools/migration/recover_afl_api_importer_identities';
import {
  RecoveryActorRefused,
  parseRecoveryActorArgs,
  resolveRecoveryActorDsn,
  runEnsureRecoveryActor,
} from '../tools/migration/ensure_issue237_recovery_actor';
import {
  AflApiReplayAbort, readAflApiForwardIdentities, replayAflApiAdjudications, replayAflApiImporterRows, resolveAflApiPlayerIdentity,
} from '../tools/migration/replay_afl_api_adjudications';
import {
  MANUAL_REGISTRATION_REPLAY,
  REGISTRATION_CREATED_AFLTABLES_IDENTITY_SQL,
} from '../tools/db/rebuild-test';
import {
  reinstateRegistrationsStage,
  verifyRegistrationsStage,
} from '../tools/migration/rebuild_afl_api_adjudications';
import {
  EMPTY_LIVE_REGISTRATION_STATE,
  REGISTRATION_PROFILE_PATH_RE,
  RegistrationRebuildRefused,
  manualRegistrationVerificationProblems,
  planRegistrationActors,
  planRegistrationReplay,
  readLiveRegistrationState,
  registrationCaptureStructureProblems,
  registrationsFromLive,
  reinstateManualRegistrations,
  sameRegistrations,
  type CapturedRegistration,
  type LiveRegistrationState,
} from '../tools/migration/rebuild_manual_registrations';
import {
  REGISTRATION_REHEARSAL_FIXTURE,
  REGISTRATION_REHEARSAL_PROVIDER_NAMESPACE_RE,
  ZERO_REGISTRATION_REHEARSAL_RESIDUE,
  buildRegistrationRehearsalBaseline,
  captureCarriesRegistrationFixture,
  parseRegistrationRehearsalBaseline,
  readArchivedRegistrationCaptures,
  registrationRehearsalBaselinePath,
  registrationRehearsalVerifyProblems,
  registrationResidueTotal,
  type RegistrationRehearsalObservation,
} from '../tools/migration/manual_registration_rebuild_rehearsal_fixture';
import { loadFitzroyProfileContinuityRules } from '../src/lib/acquisition/fitzroy-profile-continuity';
import { AFL_API_ADMIN_MATCH_METHOD, type AflApiPlayerRemapResult, type CapturedImporterRow } from '../src/lib/acquisition/afl-api-adjudication';
import { canonicalJson } from '../src/lib/acquisition/observations';
import { isLifecycleRole } from '../src/lib/auth/admin-lifecycle';
import {
  I18_FIXTURE,
  I18FixtureRefused,
  buildI18Baseline,
  captureMatchesBaseline,
  i18BaselinePath,
  i18LedgerShapeProblems,
  i18SeedPreconditionProblems,
  i18VerifyProblems,
  parseI18Args,
  parseI18Baseline,
  readArchivedCaptures,
  resolveI18Dsns,
  type I18Baseline,
  type I18LedgerRow,
  type I18Observation,
  type I18SeedObservation,
} from '../tools/migration/afl_api_adjudication_i18_fixture';
import {
  REHEARSAL_FIXTURE,
  REHEARSAL_PROVIDER_NAMESPACE_RE,
  RehearsalFixtureRefused,
  ZERO_REHEARSAL_RESIDUE,
  buildRehearsalBaseline,
  captureCarriesFixture,
  parseRehearsalArgs,
  parseRehearsalBaseline,
  readArchivedRehearsalCaptures,
  rehearsalBaselinePath,
  rehearsalSeedPreconditionProblems,
  rehearsalVerifyProblems,
  residueTotal,
  resolveRehearsalDsns,
  type RehearsalBaseline,
  type RehearsalLedgerRow,
  type RehearsalObservation,
  type RehearsalSeedObservation,
} from '../tools/migration/afl_api_identity_rebuild_rehearsal_fixture';
import type { TransactionSql } from 'postgres';

/*
 * AFLDB-ISSUE-093 §10 — the clean test-rebuild orchestrator.
 *
 * Every safety refusal, the stage order and the fail-closed semantics are pure or
 * dependency-injected, so this suite proves the whole contract with NO database, no
 * subprocess and nothing destroyed.
 */

const root = process.cwd();
const runnerSource = readFileSync(join(root, 'tools', 'db', 'rebuild-test.ts'), 'utf8');
const importerSource = readFileSync(
  join(root, 'tools', 'migration', 'import_fitzroy_core.py'), 'utf8');

const OWNER = 'postgres://afldb_owner:pw@localhost:5432/afldb_test';
const IMPORT = 'postgres://afldb_import:pw@localhost:5432/afldb_test';

const FULL_LABEL = 'full-history-2026';
const fullManifest = () => ({
  full_history: true,
  completeness: 'full_history',
  snapshot_label: FULL_LABEL,
});

function target(overrides: Partial<ResolvedTarget> = {}): ResolvedTarget {
  return {
    database: 'afldb_test',
    adminDsn: OWNER,
    importDsn: IMPORT,
    importIsOwnerSubstitution: false,
    ...overrides,
  };
}

/** A minimal acceptance register shaped like the tracked one. */
function register(opts: { label?: string; status?: string } = {}): Record<string, unknown> {
  return {
    contract: 'afldb.fitzroy.accepted_baselines',
    schema_version: 1,
    selection_policy: { rule: 'exactly_one_accepted' },
    baselines: [{
      snapshot_label: opts.label ?? FULL_LABEL,
      acceptance_status: opts.status ?? 'accepted',
    }],
  };
}

function fitzroy(label = FULL_LABEL) {
  return resolveFitzroySource({ fitzroyLabel: label },
    { readManifest: () => fullManifest(), readAcceptedRegister: () => register({ label }) });
}

const OPTS = { draftguruLabel: 'annual-html-20260826', planOnly: false };

// AFLDB-ISSUE-237 D11a/F5: runPreflight's Stage 1 precheck now resolves the capture root
// before anything else, so every test in this file that exercises runPreflight() — most of
// them, for reasons unrelated to ISSUE-237 — needs one set. This module-level default is
// outside the checkout (mkdtempSync(tmpdir())); the capture-root-specific tests below save,
// override and restore process.env.AFLDB_REBUILD_CAPTURE_ROOT explicitly around their own
// assertions rather than relying on this default.
process.env.AFLDB_REBUILD_CAPTURE_ROOT = mkdtempSync(join(tmpdir(), 'afldb-capture-root-'));

/** A dependency set that records what ran and can be told to fail at one stage. */
function fakeDeps(failAt?: string) {
  const commands: string[][] = [];
  const envs: Record<string, string>[] = [];
  const sqlRuns: string[] = [];
  const validationRuns: string[] = [];
  const deps: Deps = {
    runCommand: (argv, env): RunResult => {
      commands.push(argv);
      envs.push(env);
      const joined = argv.join(' ');
      const failed = failAt && joined.includes(failAt);
      return { status: failed ? 1 : 0, stdout: '', stderr: '' };
    },
    runSql: (_dsn, sql) => { sqlRuns.push(sql); },
    runValidation: (_dsn, sql) => {
      validationRuns.push(sql);
      if (failAt === 'FINAL VALIDATION') throw new Error('final validation failed');
    },
    fileExists: () => true,
    log: () => {},
  };
  return { deps, commands, envs, sqlRuns, validationRuns };
}

function idsOf(stages: Stage[]) { return stages.map((s) => s.id); }

describe('rebuild target safety', () => {
  it('refuses a database outside the explicit allowlist', () => {
    // AFLDB-ISSUE-146 replaced the `_test`-suffix rule with the allowlist; a name that is
    // not listed is refused whether or not it happens to end in _test.
    expect(() => resolveTarget({
      AFLDB_TEST_DATABASE_URL: 'postgres://u:p@h:5432/afldb_scratch',
      AFLDB_TEST_IMPORT_DATABASE_URL: 'postgres://u:p@h:5432/afldb_scratch',
    })).toThrow(/only explicit rebuild targets/);
    expect(() => resolveTarget({
      AFLDB_TEST_DATABASE_URL: 'postgres://u:p@h:5432/random_test',
      AFLDB_TEST_IMPORT_DATABASE_URL: 'postgres://u:p@h:5432/random_test',
    })).toThrow(/only explicit rebuild targets/);
  });

  it('refuses afldb_dev by name', () => {
    expect(() => resolveTarget({
      AFLDB_TEST_DATABASE_URL: 'postgres://u:p@h:5432/afldb_dev',
    })).toThrow(/rejected by name/);
  });

  it('refuses anything that looks like production', () => {
    expect(() => resolveTarget({
      AFLDB_TEST_DATABASE_URL: 'postgres://u:p@h:5432/afldb_prod',
    })).toThrow(/rejected by name|looks like production/);
  });

  it('refuses a preserved pre-rebuild database', () => {
    // What matters is that it is refused, not which guard fires first.
    expect(() => resolveTarget({
      AFLDB_TEST_DATABASE_URL: 'postgres://u:p@h:5432/afldb_test_pre_rebuild_20260825',
    })).toThrow(RebuildRefused);
    expect(() => resolveTarget({
      AFLDB_TEST_DATABASE_URL: 'postgres://u:p@h:5432/afldb_test_pre_rebuild_20260825',
    })).toThrow(/Refusing/);
  });

  it('refuses when the import DSN names a different database', () => {
    expect(() => resolveTarget({
      AFLDB_TEST_DATABASE_URL: OWNER,
      AFLDB_TEST_IMPORT_DATABASE_URL: 'postgres://afldb_import:pw@h:5432/other_test',
    })).toThrow(/different database/);
  });

  it('fails closed when no restricted test import credential exists', () => {
    // Never silently substitutes owner access, and never inherits the dev DSN.
    expect(() => resolveTarget({ AFLDB_TEST_DATABASE_URL: OWNER }))
      .toThrow(/AFLDB_TEST_IMPORT_DATABASE_URL is not set/);
  });

  it('allows an owner substitution only under an explicit flag, and marks it', () => {
    const resolved = resolveTarget({ AFLDB_TEST_DATABASE_URL: OWNER },
      { allowOwnerImportDsn: true });
    expect(resolved.importIsOwnerSubstitution).toBe(true);
    expect(resolved.importDsn).toBe(OWNER);
  });

  it('never inherits the development import DSN', () => {
    const resolved = resolveTarget({
      AFLDB_TEST_DATABASE_URL: OWNER,
      AFLDB_TEST_IMPORT_DATABASE_URL: IMPORT,
      AFLDB_IMPORT_DATABASE_URL: 'postgres://afldb_import:pw@h:5432/afldb_dev',
    });
    expect(resolved.importDsn).toBe(IMPORT);
    expect(resolved.importDsn).not.toContain('afldb_dev');
  });

  it('requires the operator to name the database before destroying it', () => {
    expect(() => assertDestructiveAcknowledgement(target(), undefined))
      .toThrow(/--acknowledge-destroy afldb_test/);
    expect(() => assertDestructiveAcknowledgement(target(), 'afldb_dev'))
      .toThrow(/--acknowledge-destroy afldb_test/);
    expect(() => assertDestructiveAcknowledgement(target(), 'afldb_test')).not.toThrow();
  });
});

describe('explicit --target and the code_test_db rehearsal (AFLDB-ISSUE-146)', () => {
  // Distinctive secrets and host, so a leak into any message is unmistakable.
  const CODE_OWNER = 'postgres://afldb_owner:s3cret-owner-LEAK@db.internal:6543/code_test_db';
  const CODE_IMPORT = 'postgres://afldb_import:s3cret-import-LEAK@db.internal:6543/code_test_db';
  const SECRETS = ['s3cret-owner-LEAK', 's3cret-import-LEAK', 'db.internal', '6543', 'postgres://', ':pw@'];
  const bothEnv = {
    AFLDB_TEST_DATABASE_URL: OWNER,
    AFLDB_TEST_IMPORT_DATABASE_URL: IMPORT,
    AFLDB_CODE_TEST_DATABASE_URL: CODE_OWNER,
    AFLDB_CODE_TEST_IMPORT_DATABASE_URL: CODE_IMPORT,
  };
  const codeTarget = () => target({ database: 'code_test_db', adminDsn: CODE_OWNER, importDsn: CODE_IMPORT });

  /** Run a refusal and hand back its message, failing if nothing was refused. */
  function refusal(fn: () => unknown): string {
    try {
      fn();
    } catch (error) {
      expect(error).toBeInstanceOf(RebuildRefused);
      return (error as Error).message;
    }
    throw new Error('expected a RebuildRefused');
  }

  it('allowlists exactly the two targets and still defaults to afldb_test', () => {
    expect(Object.keys(REBUILD_TARGETS)).toEqual(['afldb_test', 'code_test_db']);
    expect(DEFAULT_TARGET).toBe('afldb_test');
    expect(parseRebuildArgs(['--acknowledge-destroy', 'afldb_test']).target).toBeUndefined();

    const byDefault = resolveTarget(bothEnv);
    expect(byDefault.database).toBe('afldb_test');
    expect(byDefault.adminDsn).toBe(OWNER);
    expect(byDefault.importDsn).toBe(IMPORT);
    // Even with the rehearsal variables present, the default never reads them.
    expect(JSON.stringify(byDefault)).not.toContain('code_test_db');
  });

  it('resolves an explicit afldb_test identically to the default', () => {
    expect(resolveTarget(bothEnv, { target: 'afldb_test' })).toEqual(resolveTarget(bothEnv));
  });

  it('resolves code_test_db through its dedicated DSNs and never the test ones', () => {
    const resolved = resolveTarget(bothEnv, { target: 'code_test_db' });
    expect(resolved).toEqual({
      database: 'code_test_db',
      adminDsn: CODE_OWNER,
      importDsn: CODE_IMPORT,
      importIsOwnerSubstitution: false,
    });
    expect(JSON.stringify(resolved)).not.toContain('afldb_test');
  });

  it('requires the acknowledgement to name the selected database exactly', () => {
    const code = resolveTarget(bothEnv, { target: 'code_test_db' });
    expect(() => assertDestructiveAcknowledgement(code, 'code_test_db')).not.toThrow();
    expect(() => assertDestructiveAcknowledgement(code, 'afldb_test'))
      .toThrow(/--acknowledge-destroy code_test_db/);
    expect(() => assertDestructiveAcknowledgement(code, undefined))
      .toThrow(/--acknowledge-destroy code_test_db/);
    // and the reverse mismatch, exactly as before ISSUE-146
    expect(() => assertDestructiveAcknowledgement(resolveTarget(bothEnv), 'code_test_db'))
      .toThrow(/--acknowledge-destroy afldb_test/);
  });

  it('produces the same stage graph for both targets, differing only in the bound scripts', () => {
    const forTest = planStages(target(), fitzroy(), OPTS);
    const forCode = planStages(codeTarget(), fitzroy(), OPTS);

    expect(idsOf(forCode)).toEqual(idsOf(forTest));
    expect(forCode.map((s) => s.kind)).toEqual(forTest.map((s) => s.kind));
    expect(forCode.map((s) => s.run)).toEqual(forTest.map((s) => s.run));

    // The schema and privilege stages are the ONLY argv difference, and they bind to the
    // rehearsal's own package scripts / migrate target.
    const migrations = forCode.find((s) => s.id === 'migrations')!;
    expect(migrations.argv).toEqual(['npm', 'run', 'db:migrate:code-test']);
    expect(migrations.envOverlay).toEqual({ AFLDB_MIGRATE_TARGET: 'code-test' });
    expect(forCode.find((s) => s.id === 'privileges')!.argv)
      .toEqual(['npm', 'run', 'db:privileges:code-test']);
    for (const [i, stage] of forCode.entries()) {
      if (stage.id === 'migrations' || stage.id === 'privileges') continue;
      expect(stage.argv, stage.id).toEqual(forTest[i].argv);
    }

    // Every data stage gets the rehearsal's restricted import DSN, and nothing test-shaped.
    for (const stage of forCode.filter((s) => s.kind === 'data')) {
      expect(stage.envOverlay?.AFLDB_IMPORT_DATABASE_URL, stage.id).toBe(CODE_IMPORT);
    }
    expect(JSON.stringify(forCode)).not.toContain('afldb_test');
    expect(JSON.stringify(forCode)).not.toMatch(/\b07\d\b/);
    expect(JSON.stringify(forCode)).not.toContain('AFLDB_LEGACY_SQLITE');
  });

  /**
   * AFLDB-ISSUE-237 D11d — prerequisite P-M, point 1 ONLY (DB-free/static). Points 2-4 need a
   * real `afldb_test` connection (a rolled-back proof, a rehearsal, a transactional-clear
   * check) and are OUT OF SCOPE for this DB-free slice (runbook §8's non-destructive rule;
   * this task's own testing boundary does not authorise a write, rolled back or not, against
   * `afldb_test`). Until points 2-4 pass, no marker code is written (D11d): the database
   * marker, Stage 2's marker-set and Stage 18's marker-clear/precondition are NOT implemented
   * in this slice. This test proves only what is provable without a connection.
   */
  it('P-M point 1 (D11d) — recreate runs ONLY RESET_SQL, in place, for BOTH rebuild targets; RESET_SQL never drops/recreates the database object', () => {
    for (const stages of [planStages(target(), fitzroy(), OPTS), planStages(codeTarget(), fitzroy(), OPTS)]) {
      // Exactly one stage is destructive/sql-run: 'recreate'. No other stage id, anywhere in
      // the 25-stage plan (capture at 2 through fingerprints at 25), runs 'sql'.
      const sqlStages = stages.filter((s) => s.run === 'sql');
      expect(sqlStages.map((s) => s.id)).toEqual(['recreate']);
      expect(stages.find((s) => s.id === 'recreate')?.kind).toBe('destructive');
    }

    // executeRebuild's OWN dispatch: the 'sql' branch calls deps.runSql with the RESET_SQL
    // module constant and nothing else -- never a caller-supplied or stage-specific string.
    const source = readFileSync(join(process.cwd(), 'tools', 'db', 'rebuild-test.ts'), 'utf8');
    const sqlBranch = source.slice(source.indexOf("if (stage.run === 'sql')"), source.indexOf("if (stage.run === 'validate')"));
    expect(sqlBranch).toContain('deps.runSql(target.adminDsn, RESET_SQL)');
    expect(sqlBranch).not.toMatch(/dropdb|createdb|pg_restore/);

    // No stage's own argv (the command-kind stages) ever names a database-dropping/creating
    // program or flag -- a synthetic stage that added one would be caught here.
    for (const stages of [planStages(target(), fitzroy(), OPTS), planStages(codeTarget(), fitzroy(), OPTS)]) {
      for (const stage of stages) {
        const argvText = JSON.stringify(stage.argv ?? []);
        expect(argvText, stage.id).not.toMatch(/dropdb|createdb|pg_restore/i);
      }
    }

    // RESET_SQL itself: ordinary transactional DDL (DROP SCHEMA/TABLE/VIEW/SEQUENCE/ROUTINE/
    // TYPE), never DROP DATABASE or CREATE DATABASE -- the database OBJECT is never touched.
    expect(RESET_SQL).not.toMatch(/DROP\s+DATABASE/i);
    expect(RESET_SQL).not.toMatch(/CREATE\s+DATABASE/i);
    expect(RESET_SQL).toMatch(/DROP SCHEMA IF EXISTS/);

    // A synthetic 'sql'-run stage inserted between capture and reinstate WOULD be caught: the
    // filter above counts every 'sql'-run stage, not just the one named 'recreate'. Proven
    // directly here so the guard itself is exercised, not merely asserted about.
    const withExtra = [
      ...planStages(target(), fitzroy(), OPTS),
      { id: 'synthetic-extra-reset', name: 'synthetic', kind: 'destructive', run: 'sql' } as Stage,
    ];
    expect(withExtra.filter((s) => s.run === 'sql').map((s) => s.id)).toEqual(['recreate', 'synthetic-extra-reset']);
  });

  it('refuses forbidden and unlisted targets by name, before reading any DSN', () => {
    const cases: Array<[string, RegExp]> = [
      ['afldb_dev', /rejected by name/],
      ['afldb_prod', /rejected by name/],
      ['anything-prod', /looks like production/],
      ['afldb_production_test', /looks like production/],
      ['random_test', /only explicit rebuild targets/],
      ['afldb_scratch', /only explicit rebuild targets/],
      ['afldb_dev_pre_rebuild_20260906-112500', /rejected by name|pre-rebuild/],
      ['afldb_test_pre_rebuild_20260825', /pre-rebuild databases are read-only/],
      ['code_test_db_pre_rebuild_20260907', /pre-rebuild databases are read-only/],
    ];
    for (const [name, pattern] of cases) {
      // With no environment at all: the name is refused first, so no DSN is ever consulted.
      expect(refusal(() => resolveTarget({}, { target: name })), name).toMatch(pattern);
      // and with every variable present, the answer is the same
      expect(refusal(() => resolveTarget(bothEnv, { target: name })), name).toMatch(pattern);
    }
  });

  it('refuses a code-test DSN whose database is not code_test_db', () => {
    const wrong = (owner: string, imp?: string) => refusal(() => resolveTarget({
      ...bothEnv,
      AFLDB_CODE_TEST_DATABASE_URL: owner,
      AFLDB_CODE_TEST_IMPORT_DATABASE_URL: imp,
    }, { target: 'code_test_db' }));

    expect(wrong(OWNER, IMPORT))
      .toMatch(/AFLDB_CODE_TEST_DATABASE_URL names database 'afldb_test', not the selected target 'code_test_db'/);
    expect(wrong('postgres://afldb_owner:x@h:5432/afldb_dev')).toMatch(/rejected by name/);
    expect(wrong('postgres://afldb_owner:x@h:5432/code_test_db_prod')).toMatch(/looks like production/);
    expect(wrong('postgres://afldb_owner:x@h:5432/code_test_db_pre_rebuild_1')).toMatch(/read-only/);
    expect(wrong('postgres://afldb_owner:x@h:5432/code_test')).toMatch(/only explicit rebuild targets/);
    expect(wrong('not a url')).toMatch(/AFLDB_CODE_TEST_DATABASE_URL is not a valid connection URL/);
    // the import DSN must agree with the owner DSN, and both with the selection
    expect(wrong(CODE_OWNER, IMPORT))
      .toMatch(/AFLDB_CODE_TEST_IMPORT_DATABASE_URL names a different database from AFLDB_CODE_TEST_DATABASE_URL/);
    expect(wrong(CODE_OWNER, 'nope')).toMatch(/AFLDB_CODE_TEST_IMPORT_DATABASE_URL is not a valid connection URL/);
  });

  it('fails closed when the code-test DSNs are missing, without borrowing the test ones', () => {
    const testOnly = { AFLDB_TEST_DATABASE_URL: OWNER, AFLDB_TEST_IMPORT_DATABASE_URL: IMPORT };
    expect(refusal(() => resolveTarget(testOnly, { target: 'code_test_db' })))
      .toMatch(/AFLDB_CODE_TEST_DATABASE_URL is not set/);
    expect(refusal(() => resolveTarget({ ...testOnly, AFLDB_CODE_TEST_DATABASE_URL: CODE_OWNER },
      { target: 'code_test_db' })))
      .toMatch(/AFLDB_CODE_TEST_IMPORT_DATABASE_URL is not set/);
    // the owner substitution is the same explicit flag, and substitutes the CODE owner DSN
    const substituted = resolveTarget({ ...testOnly, AFLDB_CODE_TEST_DATABASE_URL: CODE_OWNER },
      { target: 'code_test_db', allowOwnerImportDsn: true });
    expect(substituted.importIsOwnerSubstitution).toBe(true);
    expect(substituted.importDsn).toBe(CODE_OWNER);
    // and the reverse: the default target never reads the rehearsal variables
    expect(refusal(() => resolveTarget({
      AFLDB_CODE_TEST_DATABASE_URL: CODE_OWNER, AFLDB_CODE_TEST_IMPORT_DATABASE_URL: CODE_IMPORT,
    }))).toMatch(/AFLDB_TEST_DATABASE_URL is not set/);
  });

  it('never infers the target from a DSN', () => {
    // AFLDB_TEST_DATABASE_URL pointing at code_test_db does not make code_test_db the
    // target; it is a mismatch and a refusal.
    expect(refusal(() => resolveTarget({
      AFLDB_TEST_DATABASE_URL: CODE_OWNER, AFLDB_TEST_IMPORT_DATABASE_URL: CODE_IMPORT,
    }))).toMatch(/AFLDB_TEST_DATABASE_URL names database 'code_test_db', not the selected target 'afldb_test'/);
    expect(refusal(() => resolveTarget({
      AFLDB_TEST_DATABASE_URL: CODE_OWNER, AFLDB_TEST_IMPORT_DATABASE_URL: CODE_IMPORT,
    }, { target: 'afldb_test' }))).toMatch(/not the selected target 'afldb_test'/);
  });

  it('parses --target and refuses a bare flag rather than defaulting', () => {
    const parsed = parseRebuildArgs(['--target', 'code_test_db', '--acknowledge-destroy', 'code_test_db']);
    expect(parsed.target).toBe('code_test_db');
    expect(parsed.acknowledgeDestroy).toBe('code_test_db');
    expect(() => parseRebuildArgs(['--target'])).toThrow(/--target needs a database name/);
    expect(() => parseRebuildArgs(['--target', '--plan'])).toThrow(/--target needs a database name/);
    // an unlisted name parses (parseArgs is not the gate) and is then refused by resolveTarget
    expect(refusal(() => resolveTarget(bothEnv, parseRebuildArgs(['--target', 'afldb_dev']))))
      .toMatch(/rejected by name/);
  });

  it('refuses through planStages too if a non-allowlisted name ever reached it', () => {
    expect(() => planStages(target({ database: 'afldb_dev' }), fitzroy(), OPTS))
      .toThrow(/not an explicit rebuild target/);
  });

  it('never leaks a DSN, host or credential in any refusal', () => {
    const secretEnv = {
      AFLDB_TEST_DATABASE_URL: 'postgres://afldb_owner:s3cret-owner-LEAK@db.internal:6543/afldb_dev',
      AFLDB_TEST_IMPORT_DATABASE_URL: 'postgres://afldb_import:s3cret-import-LEAK@db.internal:6543/afldb_dev',
      AFLDB_CODE_TEST_DATABASE_URL: 'postgres://afldb_owner:s3cret-owner-LEAK@db.internal:6543/afldb_test',
      AFLDB_CODE_TEST_IMPORT_DATABASE_URL: 'postgres://afldb_import:s3cret-import-LEAK@db.internal:6543/code_test_db',
    };
    const messages = [
      refusal(() => resolveTarget(secretEnv)),
      refusal(() => resolveTarget(secretEnv, { target: 'code_test_db' })),
      refusal(() => resolveTarget({ ...secretEnv, AFLDB_CODE_TEST_DATABASE_URL: CODE_OWNER,
        AFLDB_CODE_TEST_IMPORT_DATABASE_URL: undefined }, { target: 'code_test_db' })),
      refusal(() => resolveTarget({ ...secretEnv, AFLDB_CODE_TEST_DATABASE_URL: CODE_OWNER,
        AFLDB_CODE_TEST_IMPORT_DATABASE_URL: 'postgres://afldb_import:s3cret-import-LEAK@db.internal:6543/afldb_test' },
      { target: 'code_test_db' })),
      refusal(() => resolveTarget(secretEnv, { target: 'afldb_prod' })),
      refusal(() => resolveTarget({ ...secretEnv, AFLDB_CODE_TEST_DATABASE_URL: 'bad' },
        { target: 'code_test_db' })),
      refusal(() => assertDestructiveAcknowledgement(codeTarget(), 'afldb_test')),
      refusal(() => parseRebuildArgs(['--target'])),
    ];
    expect(messages).toHaveLength(8);
    for (const message of messages) {
      for (const secret of SECRETS) expect(message, message).not.toContain(secret);
    }
  });
});

describe('fitzRoy source selection', () => {
  it('resolves the accepted canonical baseline with no label at all', () => {
    // The normal path: `npm run db:test:rebuild` needs neither --fitzroy-label nor
    // --acknowledge-partial-fitzroy.
    const source = resolveFitzroySource({},
      { readManifest: () => fullManifest(), readAcceptedRegister: () => register() });
    expect(source.label).toBe(FULL_LABEL);
    expect(source.accepted).toBe(true);
    expect(source.fullHistory).toBe(true);
    expect(source.acknowledgedPartial).toBe(false);
    expect(source.selection).toBe('accepted-baseline');
  });

  it('accepts exactly full-history-20260902 from the REAL tracked register', () => {
    const real = resolveFitzroySource({});
    expect(real.label).toBe('full-history-20260902');
    expect(real.accepted).toBe(true);
    expect(real.selection).toBe('accepted-baseline');
    // AFLDB-ISSUE-112: full-history-20260827 is still IN the register, retired. Selection
    // must come from acceptance_status, never from label order, date or filename.
    expect(real.label).not.toBe('full-history-20260827');
  });

  it('refuses the retired predecessor by label on the normal path', () => {
    // The retired baseline is historical evidence, not a selectable source.
    expect(() => resolveFitzroySource({ fitzroyLabel: 'full-history-20260827' }))
      .toThrow(/is not the accepted canonical baseline \('full-history-20260902'\)/);
  });

  it('never selects trial-2024 on the normal path', () => {
    expect(resolveFitzroySource({}).label).not.toBe('trial-2024');
    expect(() => resolveFitzroySource({ fitzroyLabel: 'trial-2024' },
      { readManifest: () => fullManifest(), readAcceptedRegister: () => register() }))
      .toThrow(/not the accepted canonical baseline[\s\S]*known trial snapshot/);
  });

  it('refuses a non-accepted label rather than honouring it', () => {
    expect(() => resolveFitzroySource({ fitzroyLabel: 'some-other-2026' },
      { readManifest: () => fullManifest(), readAcceptedRegister: () => register() }))
      .toThrow(/not the accepted canonical baseline/);
  });

  it('refuses when nothing is accepted, and never falls back to a label', () => {
    expect(() => resolveFitzroySource({},
      { readManifest: () => fullManifest(),
        readAcceptedRegister: () => register({ status: 'candidate' }) }))
      .toThrow(/No fitzRoy baseline is marked accepted/);
  });

  it('fails closed on more than one accepted baseline - no latest-label tiebreak', () => {
    const two = register();
    (two.baselines as unknown[]).push({
      snapshot_label: 'full-history-2027', acceptance_status: 'accepted',
    });
    expect(() => resolveFitzroySource({},
      { readManifest: () => fullManifest(), readAcceptedRegister: () => two }))
      .toThrow(/2 fitzRoy baselines are marked accepted[\s\S]*not defined policy/);
  });

  it('implements no implicit "latest label" selection anywhere', () => {
    // A date- or filename-ordered fallback is exactly what must not exist: prove it by
    // source, since an absent behaviour cannot be observed from the outside.
    // Assert on USE, not on prose: the header legitimately says there is no latest-label
    // fallback, so the word itself must not be the thing under test.
    const code = runnerSource.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/readdirSync|globSync|\.sort\(\)\.pop\(\)|\.slice\(-1\)/);
    expect(code).not.toMatch(/accepted\[accepted\.length|sort[\s\S]{0,80}accepted/);
    expect(code).not.toMatch(/extraction_date|extraction_timestamp/);
  });

  it('refuses an unknown selection policy instead of guessing', () => {
    const odd = register();
    (odd.selection_policy as Record<string, unknown>).rule = 'newest_wins';
    expect(() => resolveFitzroySource({},
      { readManifest: () => fullManifest(), readAcceptedRegister: () => odd }))
      .toThrow(/only policy this rebuild implements is 'exactly_one_accepted'/);
  });

  it('refuses when the accepted baseline has no tracked acquisition manifest', () => {
    expect(() => resolveFitzroySource({},
      { readManifest: () => null, readAcceptedRegister: () => register() }))
      .toThrow(/no tracked acquisition manifest/);
  });

  it('keeps partial core data available, but only as an explicit opt-in', () => {
    const source = resolveFitzroySource(
      { fitzroyLabel: 'trial-2024', acknowledgePartialFitzroy: true },
      { readManifest: () => ({}), readAcceptedRegister: () => register() });
    expect(source.fullHistory).toBe(false);
    expect(source.acknowledgedPartial).toBe(true);
    expect(source.accepted).toBe(false);
    expect(source.selection).toBe('explicit-partial');
  });

  it('refuses partial mode without a label rather than degrading the baseline', () => {
    expect(() => resolveFitzroySource({ acknowledgePartialFitzroy: true },
      { readManifest: () => ({}), readAcceptedRegister: () => register() }))
      .toThrow(/needs --fitzroy-label/);
  });

  it('does not treat the acquisition manifest flags as the verdict', () => {
    // AFLDB-ISSUE-093: the accepted acquisition published `full_history: true` while the
    // independent validator rejected the snapshot. Both fields are inert.
    const source = resolveFitzroySource({},
      { readManifest: () => ({ full_history: false, completeness: 'unvalidated' }),
        readAcceptedRegister: () => register() });
    expect(source.fullHistory).toBe(true);
    expect(fitzroyValidateArgv(source)).toContain('--require-accepted-baseline');
  });
});

describe('fitzRoy preflight', () => {
  it('holds the accepted baseline to its bindings AND the artefact-level gates', () => {
    const argv = fitzroyValidateArgv(resolveFitzroySource({},
      { readManifest: () => fullManifest(), readAcceptedRegister: () => register() }));
    expect(argv).toContain('tools/migration/import_fitzroy_core.py');
    expect(argv).toContain('--validate-only');
    expect(argv).toContain('--require-accepted-baseline');
    expect(argv).toContain(FULL_LABEL);
  });

  it('still validates an acknowledged partial snapshot, without the full-history gate', () => {
    const argv = fitzroyValidateArgv({
      label: 'trial-2024', fullHistory: false, acknowledgedPartial: true,
      accepted: false, selection: 'explicit-partial',
    });
    expect(argv).toContain('--validate-only');
    expect(argv).not.toContain('--require-full-history');
    expect(argv).not.toContain('--require-accepted-baseline');
  });

  it('runs the independent validator BEFORE any destructive stage', () => {
    const order: string[] = [];
    const { deps } = fakeDeps();
    const tracing: Deps = {
      ...deps,
      runCommand: (argv, env) => {
        order.push(`cmd:${argv.join(' ')}`);
        deps.runCommand(argv, env);
        return {
          status: 0,
          stdout: 'snapshot : x (42 year pages, sha256 verified)\n'
            + 'persons    : 5057\npicks      : 6810\n',
          stderr: '',
        };
      },
      runSql: (_dsn, sql) => { order.push(`sql:${sql.slice(0, 12)}`); },
    };
    runPreflight(tracing, OPTS, resolveFitzroySource({},
      { readManifest: () => fullManifest(), readAcceptedRegister: () => register() }));
    expect(order.some((o) => o.includes('import_fitzroy_core.py')
      && o.includes('--require-accepted-baseline'))).toBe(true);
    expect(order.some((o) => o.startsWith('sql:'))).toBe(false);
    // and the runner sequences preflight ahead of the destructive acknowledgement itself
    expect(runnerSource).toMatch(
      /runPreflight\(deps, opts, fitzroy\);\s*\n\s*assertDestructiveAcknowledgement/);
  });

  it('stops before destruction when fitzRoy validation fails', () => {
    const { deps } = fakeDeps();
    const failing: Deps = {
      ...deps,
      runCommand: (argv) => (argv.join(' ').includes('import_fitzroy_core.py')
        ? { status: 1, stdout: '', stderr: 'ERROR' }
        : { status: 0, stdout: '', stderr: '' }),
    };
    expect(() => runPreflight(failing, OPTS, fitzroy()))
      .toThrow(/fitzRoy preflight failed[\s\S]*Nothing has been destroyed/);
  });
});

/*
 * AFLDB-ISSUE-093 - the acceptance/promotion register.
 *
 * The register BINDS an accepted acquisition to its hashes, contract version and measured
 * fingerprint. It never blesses: the independent validator remains the sole authority, and
 * these tests prove the binding cannot be satisfied by a hand-edited record.
 */
describe('accepted canonical baseline', () => {
  const REGISTER_PATH = join(root, 'data', 'reference', 'fitzroy-accepted-baselines.json');
  const registerText = readFileSync(REGISTER_PATH, 'utf8');
  const registerJson = JSON.parse(registerText);
  const accepted = registerJson.baselines
    .filter((b: any) => b.acceptance_status === 'accepted');
  // AFLDB-ISSUE-112: the register now carries the retired predecessor as well. It is
  // historical evidence, and the tests below prove the retirement moved a status without
  // editing a single hash or measurement in that record.
  const retired = registerJson.baselines
    .filter((b: any) => b.acceptance_status === 'retired');

  const MANIFEST_PATH = join(root, 'docs', 'rebuild-manifests', 'afltables_fitzroy_core',
    'full-history-20260902.json');
  const manifestBytes = readFileSync(MANIFEST_PATH);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));

  const RETIRED_MANIFEST_PATH = join(root, 'docs', 'rebuild-manifests',
    'afltables_fitzroy_core', 'full-history-20260827.json');
  const retiredManifestBytes = readFileSync(RETIRED_MANIFEST_PATH);
  const retiredManifest = JSON.parse(retiredManifestBytes.toString('utf8'));

  // AFLDB-ISSUE-108: the acceptance record binds the manifest by the SHA-256 of its
  // canonical LF bytes. A Windows checkout without .gitattributes renders CRLF, which
  // has a different hash — the binding must be platform-independent, so normalise
  // line endings before hashing. import_fitzroy_core.py sees LF on the supported
  // Linux runtime (and now everywhere, via .gitattributes).
  const lfSha = (bytes: Buffer) => createHash('sha256')
    .update(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')
    .digest('hex');
  const manifestLfSha = lfSha(manifestBytes);
  const retiredManifestLfSha = lfSha(retiredManifestBytes);

  const setDigest = (files: any[]) => createHash('sha256')
    .update(`${files.map((f) => `${f.filename} ${f.sha256} ${f.row_count}`).sort().join('\n')}\n`)
    .digest('hex');

  it('accepts exactly one baseline, and it is full-history-20260902', () => {
    // Two entries exist; exactly_one_accepted still decides, and it decides on status.
    expect(registerJson.baselines).toHaveLength(2);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].snapshot_label).toBe('full-history-20260902');
    expect(registerJson.selection_policy.rule).toBe('exactly_one_accepted');
    expect(accepted[0].snapshot_dir)
      .toBe('data/sources/afltables/fitzroy_core/full-history-20260902');
  });

  it('keeps full-history-20260827 as retired historical evidence', () => {
    // AFLDB-ISSUE-112: the accepted bytes became unreproducible, so the baseline was
    // retired rather than deleted or overwritten. 'retired' is the register's own
    // declared vocabulary, and every entry that is not 'accepted' is unselectable.
    expect(retired).toHaveLength(1);
    expect(retired[0].snapshot_label).toBe('full-history-20260827');
    expect(retired[0].snapshot_dir)
      .toBe('data/sources/afltables/fitzroy_core/full-history-20260827');
    expect(registerJson.selection_policy.retired_statuses).toContain('retired');
    expect(registerJson.selection_policy.retired_statuses).not.toContain('accepted');
    expect(retired[0].superseded_by).toBe('full-history-20260902');
    expect(accepted[0].supersedes).toBe('full-history-20260827');
    // The retirement changed a status and added fields. It edited NO evidence: both
    // hash bindings still describe the bytes the baseline was granted over.
    expect(retired[0].accepted_on).toBe('2026-08-27');
    expect(retired[0].acquisition.manifest_sha256).toBe(retiredManifestLfSha);
    expect(retired[0].acquisition.manifest_sha256)
      .toBe('a42c6d5faacbcb6f4ce77a93a01f282577797375d14c60ef17f09bff2ab21d09');
    expect(retired[0].raw_artefacts.artefact_set_sha256)
      .toBe(setDigest(retiredManifest.files));
    expect(retired[0].raw_artefacts.artefact_set_sha256)
      .toBe('8e14ce6198685b9fec568ab3c680cab34783e8e202ab0c7e93f45773d96f4125');
    // The successor reproduced its predecessor's measured fingerprint exactly - the
    // retirement moved provenance, not canonical semantics. Compared on the measured
    // values themselves; only each entry's own prose $comment differs.
    //
    // AFLDB-ISSUE-136 (2026-09-04) then amended the ACCEPTED entry only: the importer's
    // profile_url_continuity transformation folds four renumbered 2025 profiles into
    // their continuing players, so `players` moved 13,275 -> 13,271 and the accepted
    // entry gained `players_with_renumbered_profile`. The retired entry is historical
    // evidence and was deliberately NOT rewritten, so the two differ on exactly that.
    const gates = (o: any) => {
      const { $comment, ...rest } = o;
      return rest;
    };
    const { players: acceptedPlayers, players_with_renumbered_profile: folded,
      ...acceptedRest } = gates(accepted[0].measured);
    const { players: retiredPlayers, ...retiredRest } = gates(retired[0].measured);
    expect(acceptedRest).toEqual(retiredRest);
    expect(retiredPlayers).toBe(13275);
    expect(acceptedPlayers).toBe(13271);
    expect(folded).toBe(4);
    expect(retiredPlayers - acceptedPlayers).toBe(folded);
    expect(retired[0].measured.players_with_renumbered_profile).toBeUndefined();
    expect(accepted[0].amendments[0]).toMatchObject({
      date: '2026-09-04', issue: 'AFLDB-ISSUE-136', kind: 'import_transformation_added',
    });
    expect(gates(accepted[0].identity_scan)).toEqual(gates(retired[0].identity_scan));
    expect(Object.keys(gates(accepted[0].measured))).toHaveLength(13);
    expect(Object.keys(gates(retired[0].measured))).toHaveLength(12);
    expect(Object.keys(gates(accepted[0].identity_scan))).toHaveLength(6);
  });

  it('binds acceptance to the acquisition manifest bytes', () => {
    expect(accepted[0].acquisition.manifest_sha256).toBe(manifestLfSha);
    expect(accepted[0].acquisition.manifest_sha256)
      .toBe('2bd66e3df5ce80411363da9e15c6dddadc9eefe5c5c9eca3f5b7bd7106b0a0c1');
    expect(accepted[0].acquisition.manifest_path)
      .toBe('docs/rebuild-manifests/afltables_fitzroy_core/full-history-20260902.json');
    // The predecessor's manifest is a different artefact and can never satisfy this bind.
    expect(accepted[0].acquisition.manifest_sha256).not.toBe(retiredManifestLfSha);
  });

  it('binds acceptance to the raw artefact hash set', () => {
    expect(accepted[0].raw_artefacts.artefact_set_sha256).toBe(setDigest(manifest.files));
    expect(accepted[0].raw_artefacts.artefact_set_sha256)
      .toBe('15ba5dc624535d95fd1661c7c5e757ae4fc2d31782a2c0b1414e19358580dd6c');
    expect(accepted[0].raw_artefacts.file_count).toBe(manifest.files.length);
    expect(accepted[0].raw_artefacts.file_count).toBe(131);
    expect(accepted[0].raw_artefacts.total_rows)
      .toBe(manifest.files.reduce((n: number, f: any) => n + f.row_count, 0));
    expect(accepted[0].raw_artefacts.total_rows).toBe(719042);
    // 130 of the 131 artefacts are shared with the retired baseline; player_details.csv
    // is not, and that one artefact is the whole reason this is a separate acceptance.
    expect(accepted[0].raw_artefacts.artefact_set_sha256)
      .not.toBe(retired[0].raw_artefacts.artefact_set_sha256);
  });

  it('detects a modified raw artefact', () => {
    const tampered = JSON.parse(manifestBytes.toString('utf8'));
    tampered.files[7].sha256 = 'f'.repeat(64);
    expect(setDigest(tampered.files))
      .not.toBe(accepted[0].raw_artefacts.artefact_set_sha256);
    // and the validator re-hashes every artefact on disk against the manifest itself,
    // so editing the bytes without editing the manifest is caught there
    expect(importerSource).toContain('SHA-256 mismatch (manifest');
    expect(importerSource).toContain('actual_sha = sha256_file(path)');
  });

  it('detects a modified acquisition manifest', () => {
    expect(createHash('sha256').update(Buffer.concat([manifestBytes, Buffer.from(' ')]))
      .digest('hex')).not.toBe(accepted[0].acquisition.manifest_sha256);
    const rowEdited = JSON.parse(manifestBytes.toString('utf8'));
    rowEdited.files[0].row_count += 1;
    expect(setDigest(rowEdited.files))
      .not.toBe(accepted[0].raw_artefacts.artefact_set_sha256);
  });

  it('binds acceptance to the contract and adapter versions', () => {
    const contract = JSON.parse(readFileSync(
      join(root, 'tools', 'rebuild', 'fitzroy', 'fitzroy-contract.json'), 'utf8'));
    const b = accepted[0].contract_binding;
    expect(b.contract_version).toBe(contract.contract_version);
    expect(b.contract_full_history_version)
      .toBe(contract.full_history.contract_full_history_version);
    expect(b.required_range).toEqual({ first_season: 1897, last_season: 2025 });
    expect(b.required_datasets).toEqual(contract.full_history.required_datasets);
    expect(accepted[0].acquisition.fitzroy_version_pinned).toBe(contract.pinned_version);
    expect(accepted[0].acquisition.adapter_schema_version)
      .toBe(manifest.adapter_schema_version);
  });

  it('records the validator verdict and the drift gates it must keep matching', () => {
    expect(accepted[0].validation.verdict).toBe('PASSED');
    expect(accepted[0].validation.database_accessed).toBe(false);
    expect(accepted[0].validation.command).toContain('--require-full-history');
    expect(accepted[0].validation.authority)
      .toBe('tools/migration/import_fitzroy_core.py');
    // AFLDB-ISSUE-136: players is 13,271, not the 13,275 distinct profile URLs — four
    // renumbered 2025 profiles fold into their continuing players under the tracked
    // profile_url_continuity rules; identity_scan.distinct_urls stays 13,275 (raw rows).
    expect(accepted[0].measured).toMatchObject({
      matches: 16838, matches_with_player_rows: 16838, players: 13271,
      players_with_renumbered_profile: 4,
      player_match_rows: 685471, brownlow_round_vote_rows: 320861,
      seasons_first: 1897, seasons_last: 2025, club_identities: 24,
      venues: 52, attendance_known: 15187, players_with_dob: 855,
      players_with_dob_conflict: 0,
    });
    expect(accepted[0].identity_scan).toMatchObject({
      rows: 685473, missing_id: 83, missing_url: 0, malformed_url: 0,
      distinct_ids: 13270, distinct_urls: 13275,
    });
    // the importer compares those gates against freshly measured values
    expect(importerSource).toContain('def enforce_accepted_fingerprint');
    expect(importerSource).toContain('has drifted from its');
  });

  it('records the accepted source corrections by contract version', () => {
    const c = accepted[0].accepted_corrections;
    const all = JSON.stringify(c);
    expect(all).toContain('Brisbane Lions 1987-1996 -> Brisbane Bears');
    expect(all).toContain('North Melbourne 1999-2007 -> Kangaroos');
    expect(c.source_data[0].rows_dropped).toBe(2);
    expect(c.import_transformation[0].rows_affected).toBe(79);
    expect(c.import_transformation[0].players_affected).toBe(4);
    // AFLDB-ISSUE-136: the four renumbered-profile continuity rules are an accepted
    // identity correction of this baseline, bound by rule id to the contract.
    const contract = JSON.parse(readFileSync(
      join(root, 'tools', 'rebuild', 'fitzroy', 'fitzroy-contract.json'), 'utf8'));
    const ruleIds = (contract.profile_url_continuity.rules as { id: string }[])
      .map((r) => r.id).sort();
    expect(c.identity_continuity[0].kind).toBe('profile_url_continuity');
    expect(c.identity_continuity[0].rows_affected).toBe(79);
    expect(c.identity_continuity[0].players_affected).toBe(4);
    expect([...c.identity_continuity[0].rule_ids].sort()).toEqual(ruleIds);
    expect(ruleIds).toHaveLength(4);
  });

  it('cannot bypass --require-full-history by hand-editing the record', () => {
    // The acceptance flag IMPLIES the gate; it can never substitute for it.
    expect(importerSource).toContain(
      'require_full_history = args.require_full_history or args.require_accepted_baseline');
    // and the gates are re-derived from the artefacts, never read off the record
    expect(importerSource).toContain('binds, it never blesses');
    expect(importerSource).not.toMatch(/baseline\[["'](full_history|completeness)["']\]/);
  });

  it('keeps both acquisition manifests inert and unchanged', () => {
    // The RETIRED acquisition still self-declares full_history: true and completeness:
    // full_history - the claim the independent validator rejected. Preserved as evidence,
    // byte-for-byte, by the retirement.
    expect(retiredManifest.full_history).toBe(true);
    expect(retiredManifest.completeness).toBe('full_history');
    expect(retiredManifest.snapshot_label).toBe('full-history-20260827');
    expect(retiredManifest.extraction_timestamp_utc).toBe('2026-08-27T01:54:19Z');
    // The ACCEPTED acquisition declines to self-assess and says so. That field is exactly
    // as inert as the other one: the verdict came from the independent validator, and a
    // manifest claiming false did not block an acceptance any more than true granted one.
    expect(manifest.full_history).toBe(false);
    expect(manifest.completeness).toBe('unvalidated');
    expect(manifest.snapshot_label).toBe('full-history-20260902');
    expect(manifest.extraction_timestamp_utc).toBe('2026-09-02T01:00:04Z');
    expect(registerJson.inert_acquisition_fields.fields)
      .toEqual(['full_history', 'completeness', 'completeness_gates']);
    // and nothing in the supported path reads them as a verdict
    expect(runnerSource).not.toMatch(/manifest\.(full_history|completeness)/);
    expect(importerSource).toContain(
      "The manifest's own `full_history` field is NOT consulted as a verdict");
  });

  it('depends on no legacy SQLite source', () => {
    for (const src of [runnerSource, importerSource, registerText]) {
      expect(src).not.toContain('require_env("AFLDB_LEGACY_SQLITE")');
      expect(src).not.toContain('AFLDB_LEGACY_SQLITE)');
      expect(src).not.toContain('AFLDB_LEGACY_SQLITE]');
    }
    expect(registerText).not.toContain('sqlite');
  });
});

describe('acquisition contract', () => {
  const acquirer = readFileSync(join(root, 'tools', 'rebuild', 'fitzroy', 'acquire_core.R'),
    'utf8');
  const contract = JSON.parse(readFileSync(
    join(root, 'tools', 'rebuild', 'fitzroy', 'fitzroy-contract.json'), 'utf8'));

  it('never adjudicates its own completeness', () => {
    // The defect this replaced: the acquirer published `full_history: true` from a
    // SMALLER gate set than the contract declares, and the independent validator then
    // rejected the snapshot. One adjudicator now, and it is not this script.
    expect(acquirer).toContain('manifest$completeness <- "unvalidated"');
    expect(acquirer).toContain('manifest$full_history <- FALSE');
    expect(acquirer).toContain('the acquirer does not adjudicate');
    expect(acquirer).toContain('--require-full-history');
    expect(acquirer).not.toContain('manifest$full_history <- all_passed');
  });

  it('measures identity coverage so the manifest records what the source supplied', () => {
    expect(acquirer).toContain('identity_obs');
    expect(acquirer).toContain('rows_without_id');
    expect(acquirer).toContain('rows_without_url');
    expect(acquirer).toContain('seasons_with_missing_id');
  });

  it('writes the manifest last, after every artefact is hashed', () => {
    const manifestWrite = acquirer.indexOf('write_json(manifest, manifest_path)');
    const hashing = acquirer.indexOf('sha256 = sha256_file(path)');
    expect(hashing).toBeGreaterThan(-1);
    expect(manifestWrite).toBeGreaterThan(hashing);
    expect(acquirer).toContain('# The manifest is written LAST');
  });

  it('refuses to overwrite an accepted immutable label', () => {
    expect(acquirer).toContain('Snapshots are immutable');
  });

  it('never touches the legacy database or PostgreSQL', () => {
    // The header states the adapter has no legacy dependency, so — as elsewhere in this
    // repository — the absence assertion is on USE, not on the mention.
    expect(acquirer).not.toMatch(/Sys\.getenv\(\s*["']AFLDB_LEGACY_SQLITE/);
    expect(acquirer).not.toMatch(/dbConnect|RPostgres|RSQLite|psql/);
    expect(acquirer).not.toMatch(/postgres:\/\//);
  });

  it('derives the season boundary from tracked reference data', () => {
    const seasons = JSON.parse(readFileSync(
      join(root, 'data', 'reference', 'seasons.json'), 'utf8'));
    const fh = contract.full_history;
    expect(fh.season_range.first_season).toBe(seasons.first_season);
    // the boundary is the latest COMPLETED season, so every in-progress season is excluded
    expect(fh.season_range.last_season).toBe(seasons.last_season - 1);
    expect(fh.current_season_excluded.seasons).toEqual(seasons.in_progress_seasons);
  });

  it('keeps the current season and AFLW out of this snapshot', () => {
    const fh = contract.full_history;
    expect(fh.current_season_excluded.reason).toMatch(/current-season pipeline/);
    expect(fh.aflw_excluded.reason).toMatch(/aflwstats\.com|staging_aflw/);
  });

  it('treats a missing season as failure while no gap is approved', () => {
    expect(contract.full_history.approved_source_gaps.seasons).toEqual([]);
  });
});

describe('stage graph', () => {
  const stages = planStages(target(), fitzroy(), OPTS);

  it('runs the §10 order exactly', () => {
    // AFLDB-ISSUE-095 added 'ladder-witness' between derived and fingerprints. It is a
    // VALIDATION stage, not a data stage — the nine-stage DATA topology is unchanged and
    // nothing new imports. See 'ladder witness cross-check' below.
    // AFLDB-ISSUE-118 §23.19 added 'heights' and 'heights-afl-api' directly after
    // fitzroy: both read tracked-manifest snapshots already on disk (the baseline's own
    // register plus a pinned in-season supplement; the pinned AFL API roster set) and
    // join through the identities and match facts fitzroy just loaded. Neither acquires.
    // AFLDB-ISSUE-118 §23.33–§23.35 added 'after-siren' (data) and 'after-siren-reconcile'
    // (validation) directly after 'siblings': the canonical after_siren_kicks events from
    // the tracked normalised artefact, then a re-resolution check of the loaded table.
    // AFLDB-ISSUE-235 OD-5 added the adjudication ledger's capture (before 'recreate') and
    // its reinstate/replay + bijection pair (directly after 'draftguru'); see the C6 suite.
    // AFLDB-ISSUE-245 added the manual registration reinstate/replay/verify trio directly
    // before 'draftguru'; see the AFLDB-ISSUE-245 suite.
    expect(idsOf(stages)).toEqual([
      'precheck', 'afl-api-adjudications-capture', 'recreate', 'migrations', 'privileges',
      'reference', 'fitzroy', 'heights', 'heights-afl-api', 'heights-wikipedia', 'birth-dates',
      'coaches', 'father-son', 'siblings', 'after-siren', 'after-siren-reconcile',
      'manual-registrations-reinstate', 'manual-registrations-replay', 'manual-registrations-verify',
      'draftguru', 'afl-api-adjudications-reinstate', 'afl-api-adjudications-bijection',
      'awards-honours', 'brownlow-season', 'derived', 'coleman',
      'ladder-witness', 'fingerprints',
    ]);
  });

  it('adds only non-acquiring data stages beyond the four', () => {
    // AFLDB-ISSUE-111. 'coleman' is the fifth DATA stage. It is admitted because it
    // acquires nothing: no legacy SQLite, no manifest, no network — it reads AFLDB's own
    // canonical match facts and writes the award they imply.
    // AFLDB-ISSUE-112. 'awards-honours' is the sixth. It acquires nothing either: every
    // family reads a tracked manifest checked in under data/awards/, and the legacy
    // SQLite source is never wired back in (operator decision 8).
    // AFLDB-ISSUE-113. 'brownlow-season' is the seventh, for the same reason: it reads
    // the tracked artefact under data/brownlow/ — a re-keyed read-only export of the
    // preserved authoritative table — and never the legacy SQLite or the network.
    // AFLDB-ISSUE-118 §23.19. 'heights' and 'heights-afl-api' are the eighth and ninth:
    // manifest-pinned snapshots on disk, no legacy SQLite, no network (see 'height
    // enrichment' below).
    // AFLDB-ISSUE-118 §23.33–§23.35. 'after-siren' reads the tracked normalised artefact
    // (migration 089) and joins through the matches / player_match_stats / identities
    // fitzroy loaded — no legacy SQLite, no manifest, no network. Its re-resolution check
    // 'after-siren-reconcile' is a VALIDATION stage and is not in this list.
    // AFLDB-ISSUE-245. 'manual-registrations-replay' acquires nothing either: it runs the
    // production replay_admin_overrides(players) over creation records the rebuild itself
    // carried across the reset — no manifest, no legacy SQLite, no network.
    expect(idsOf(stages.filter((s) => s.kind === 'data')))
      .toEqual(['reference', 'fitzroy', 'heights', 'heights-afl-api', 'heights-wikipedia',
                'birth-dates', 'coaches', 'father-son', 'siblings', 'after-siren',
                'manual-registrations-replay', 'draftguru',
                'awards-honours', 'brownlow-season', 'derived', 'coleman']);
    const coleman = stages.find((s) => s.id === 'coleman')!;
    expect(coleman.argv).toEqual([
      resolvePython(), 'tools/migration/import_awards.py', '--groups', 'coleman',
    ]);
  });

  describe('height enrichment (AFLDB-ISSUE-118 §23.19)', () => {
    const ids = idsOf(stages);
    const heights = stages.find((s) => s.id === 'heights')!;
    const aflApi = stages.find((s) => s.id === 'heights-afl-api')!;

    it('binds the register to the accepted baseline and every supplement to the contract pin', () => {
      const pins = heightEnrichmentPins();
      expect(pins.supplements.length).toBeGreaterThan(0);
      expect(heights.argv).toEqual([
        resolvePython(), HEIGHT_LOADER, '--label', fitzroy().label,
        ...pins.supplements.flatMap((p) => ['--supplement-label', p.label]),
      ]);
      expect(heights.envOverlay).toEqual({ AFLDB_IMPORT_DATABASE_URL: target().importDsn });
      // The preflight argv is DERIVED from the data argv (the §28.4 rule), so the
      // snapshot proven and the snapshot imported cannot differ.
      expect(heightsValidateArgv(fitzroy().label)).toEqual([...heights.argv!, '--validate-only']);
    });

    it('loads the AFL API roster the contract accepts, as evidence only', () => {
      const pin = aflApiRosterPin();
      expect(aflApi.argv).toEqual([resolvePython(), AFL_API_HEIGHT_LOADER, '--label', pin.label]);
      expect(aflApiHeightsValidateArgv()).toEqual([...aflApi.argv!, '--validate-only']);
    });

    it('follows fitzroy (identities and match facts) and precedes everything that reads players', () => {
      expect(ids.indexOf('fitzroy')).toBeLessThan(ids.indexOf('heights'));
      expect(ids.indexOf('heights')).toBeLessThan(ids.indexOf('heights-afl-api'));
      expect(ids.indexOf('heights-afl-api')).toBeLessThan(ids.indexOf('heights-wikipedia'));
      expect(ids.indexOf('heights-wikipedia')).toBeLessThan(ids.indexOf('draftguru'));
      const wikipedia = stages.find((s) => s.id === 'heights-wikipedia')!;
      expect(wikipedia.argv).toEqual([resolvePython(), WIKIPEDIA_HEIGHT_LOADER, '--csv', WIKIPEDIA_HEIGHT_CSV]);
      expect(wikipediaHeightsValidateArgv()).toEqual([...wikipedia.argv!, '--validate-only']);
      expect(wikipediaHeightRows()).toBeGreaterThan(0);
      expect(() => wikipediaHeightRows(() => 'afltables_profile,player\n')).toThrow(/no data rows/);
      for (const stage of [heights, aflApi, wikipedia]) {
        expect(stage.kind).toBe('data');
        expect(stage.argv!.join(' ')).not.toMatch(/legacy|sqlite|acquire/i);
      }
    });

    it('refuses a contract with no height pin, and a pin whose manifest does not hash to its binding', () => {
      expect(() => heightEnrichmentPins(() => ({ datasets: { player_details: {} } })))
        .toThrow(/records no height enrichment binding/);
      const real = JSON.parse(readFileSync(
        join(root, 'tools', 'rebuild', 'fitzroy', 'fitzroy-contract.json'), 'utf8'));
      const tampered = structuredClone(real);
      tampered.datasets.player_details.height_enrichment.supplements[0].manifest_sha256 = '0'.repeat(64);
      expect(() => heightEnrichmentPins(() => tampered)).toThrow(/hashes to/);
      expect(() => aflApiRosterPin(() => ({ roster: {} }))).toThrow(/no accepted roster snapshot/);
    });

    it('preflights both snapshots offline before the destructive stage and refuses on failure', () => {
      const draftguruOk = 'snapshot : x (42 year pages, sha256 verified)\n'
        + 'persons    : 5057\npicks      : 6810\n';
      const brownlowOk = '{"ok": true}';
      const withFailing = (failing?: string) => {
        const commands: string[][] = [];
        const deps: Deps = {
          ...fakeDeps().deps,
          runCommand: (a: string[]) => {
            commands.push(a);
            if (failing && a.includes(failing)) return { status: 1, stdout: '', stderr: 'sha256 mismatch' };
            if (a.includes(BROWNLOW_SEASON_LOADER)) return { status: 0, stdout: brownlowOk, stderr: '' };
            return { status: 0, stdout: draftguruOk, stderr: '' };
          },
        };
        return { deps, commands };
      };
      const { deps, commands } = withFailing();
      runPreflight(deps, OPTS, fitzroy());
      const validate = commands.filter((a) => a.includes('--validate-only'));
      expect(validate.some((a) => a.includes(HEIGHT_LOADER))).toBe(true);
      expect(validate.some((a) => a.includes(AFL_API_HEIGHT_LOADER))).toBe(true);
      expect(validate.some((a) => a.includes(WIKIPEDIA_HEIGHT_LOADER))).toBe(true);
      expect(() => runPreflight(withFailing(WIKIPEDIA_HEIGHT_LOADER).deps, OPTS, fitzroy()))
        .toThrow(/Wikipedia height preflight failed[\s\S]*Nothing has been destroyed/);
      expect(() => runPreflight(withFailing(HEIGHT_LOADER).deps, OPTS, fitzroy()))
        .toThrow(/Height preflight failed[\s\S]*Nothing has been destroyed/);
      expect(() => runPreflight(withFailing(AFL_API_HEIGHT_LOADER).deps, OPTS, fitzroy()))
        .toThrow(/AFL API roster preflight failed[\s\S]*Nothing has been destroyed/);
    });

    it('gates the rebuilt heights on the pinned measurements', () => {
      const keys = heightChecks().map((c) => c.key);
      expect(keys).toEqual(['players_with_height', 'height_without_evidence',
                            'height_conflicts_open', 'players_with_afl_api_height_evidence',
                            'players_with_wikipedia_height_evidence']);
      const register = JSON.parse(readFileSync(
        join(root, 'data', 'reference', 'fitzroy-accepted-baselines.json'), 'utf8'));
      expect(finalValidationChecks(register).map((c) => c.key)).toEqual(expect.arrayContaining(keys));
      expect(heightChecks().find((c) => c.key === 'players_with_height')!.expected).toBeGreaterThan(12000);
    });
  });

  describe('birth dates (AFLDB-ISSUE-118 §23.24 Stage D1)', () => {
    const ids = idsOf(stages);
    const birthDates = stages.find((s) => s.id === 'birth-dates')!;
    const contractPath = join(root, 'tools', 'rebuild', 'afltables', 'afltables-contract.json');

    it('loads the club-list snapshot the AFL Tables contract accepts, and only that one', () => {
      const pin = afltablesClubListPin();
      expect(pin.label).toMatch(/^club-lists-\d{8}$/);
      expect(birthDates.argv).toEqual([resolvePython(), BIRTH_DATE_LOADER, '--label', pin.label]);
      expect(birthDatesArgv()).toEqual(birthDates.argv);
      expect(birthDates.name).toContain(pin.label);
      expect(birthDates.envOverlay).toEqual({ AFLDB_IMPORT_DATABASE_URL: target().importDsn });
      // The preflight argv is DERIVED from the data argv (the §28.4 rule).
      expect(birthDatesValidateArgv()).toEqual([...birthDates.argv!, '--validate-only']);
      expect(birthDates.kind).toBe('data');
      expect(birthDates.argv!.join(' ')).not.toMatch(/legacy|sqlite|acquire/i);
    });

    it('follows heights-wikipedia (the identities fitzroy registered are all it joins on) and precedes draftguru', () => {
      expect(ids.indexOf('heights-wikipedia')).toBeLessThan(ids.indexOf('birth-dates'));
      expect(ids.indexOf('birth-dates')).toBeLessThan(ids.indexOf('draftguru'));
      expect(ids.indexOf('fitzroy')).toBeLessThan(ids.indexOf('birth-dates'));
    });

    it('refuses a contract with no pin, a tampered manifest hash, and a missing measured value', () => {
      expect(() => afltablesClubListPin(() => null)).toThrow(/no accepted club-list snapshot/);
      expect(() => afltablesClubListPin(() => ({ club_player_lists: {} })))
        .toThrow(/no accepted club-list snapshot/);
      const real = JSON.parse(readFileSync(contractPath, 'utf8'));
      const tampered = structuredClone(real);
      tampered.club_player_lists.accepted_snapshot.manifest_sha256_lf = '0'.repeat(64);
      expect(() => afltablesClubListPin(() => tampered)).toThrow(/hashes to/);
      const moved = structuredClone(real);
      moved.club_player_lists.accepted_snapshot.manifest = 'docs/rebuild-manifests/afltables_club_lists/nope.json';
      expect(() => afltablesClubListPin(() => moved)).toThrow(/not in this checkout/);
      const unmeasured = structuredClone(real);
      delete unmeasured.club_player_lists.accepted_snapshot.measured.dob_without_evidence;
      expect(() => afltablesClubListPin(() => unmeasured)).toThrow(/dob_without_evidence is not an integer/);
      // The real pin proves: the tracked manifest hashes to its LF binding on any checkout.
      expect(afltablesClubListPin().measured.playersWithDob).toBeGreaterThan(13000);
    });

    it('preflights the snapshot offline before the destructive stage and refuses on failure', () => {
      const commands: string[][] = [];
      const withFailing = (failing?: string): Deps => ({
        ...fakeDeps().deps,
        runCommand: (a: string[]) => {
          commands.push(a);
          if (failing && a.includes(failing)) return { status: 1, stdout: '', stderr: 'sha256 mismatch' };
          if (a.includes(BROWNLOW_SEASON_LOADER)) return { status: 0, stdout: '{"ok": true}', stderr: '' };
          return { status: 0, stdout: 'snapshot : x (42 year pages, sha256 verified)\npersons    : 5057\npicks      : 6810\n', stderr: '' };
        },
      });
      runPreflight(withFailing(), OPTS, fitzroy());
      const validate = commands.filter((a) => a.includes('--validate-only'));
      expect(validate.some((a) => a.includes(BIRTH_DATE_LOADER) && a.includes(afltablesClubListPin().label))).toBe(true);
      expect(() => runPreflight(withFailing(BIRTH_DATE_LOADER), OPTS, fitzroy()))
        .toThrow(/Birth-date preflight failed[\s\S]*Nothing has been destroyed/);
    });

    it('gates the rebuilt dates on the contract pin: population, evidence link, coverage, conflicts, disagreements', () => {
      const checks = birthDateChecks();
      expect(checks.map((c) => c.key)).toEqual([
        'players_with_dob_after_birth_dates', 'dob_without_evidence', 'players_with_club_list_birth_evidence',
        'club_list_birth_conflict_players', 'dob_disagreeing_with_club_list',
      ]);
      const byKey = Object.fromEntries(checks.map((c) => [c.key, c]));
      const pin = afltablesClubListPin();
      expect(byKey.players_with_dob_after_birth_dates.expected).toBe(pin.measured.playersWithDob);
      expect(byKey.dob_without_evidence.expected).toBe(0);
      expect(byKey.club_list_birth_conflict_players.expected).toBe(0);
      expect(byKey.players_with_club_list_birth_evidence.expected).toBeLessThanOrEqual(pin.measured.playersWithDob);
      expect(byKey.dob_without_evidence.sql).toMatch(/dob_evidence_id IS NULL/);
      expect(byKey.club_list_birth_conflict_players.sql).toMatch(/count\(DISTINCT e\.dob\) > 1/);
      expect(byKey.dob_disagreeing_with_club_list.sql).toMatch(/p\.dob <> e\.dob/);
      for (const c of checks) expect(c.sql).not.toMatch(/'afltables_club_list'.*'wikipedia'/);
      const register = JSON.parse(readFileSync(
        join(root, 'data', 'reference', 'fitzroy-accepted-baselines.json'), 'utf8'));
      const all = finalValidationChecks(register).map((c) => c.key);
      expect(all).toEqual(expect.arrayContaining(checks.map((c) => c.key)));
      // Added after the height gates, in stage order.
      expect(all.indexOf('players_with_dob_after_birth_dates')).toBeGreaterThan(all.indexOf('players_with_wikipedia_height_evidence'));
    });
  });

  describe('coaches (AFLDB-ISSUE-118 §23.27 Stage E2)', () => {
    const ids = idsOf(stages);
    const coaches = stages.find((s) => s.id === 'coaches')!;
    const contractPath = join(root, 'tools', 'rebuild', 'afltables', 'afltables-contract.json');

    it('loads the coach-page snapshot the AFL Tables contract accepts, beside the baseline and every pinned supplement', () => {
      const pin = afltablesCoachesPin();
      expect(pin.label).toMatch(/^coaches-\d{8}$/);
      const expected = [resolvePython(), COACH_LOADER, '--label', pin.label, '--fitzroy-label', FULL_LABEL];
      for (const s of heightEnrichmentPins().supplements) expected.push('--supplement-label', s.label);
      expect(coaches.argv).toEqual(expected);
      expect(coachesImportArgv(FULL_LABEL)).toEqual(coaches.argv);
      expect(coaches.name).toContain(pin.label);
      expect(coaches.name).toContain(FULL_LABEL);
      expect(coaches.envOverlay).toEqual({ AFLDB_IMPORT_DATABASE_URL: target().importDsn });
      // The preflight argv is DERIVED from the data argv (the §28.4 rule).
      expect(coachesValidateArgv(FULL_LABEL)).toEqual([...coaches.argv!, '--validate-only']);
      expect(coaches.kind).toBe('data');
      expect(coaches.argv!.join(' ')).not.toMatch(/legacy|sqlite|acquire/i);
    });

    it('follows birth-dates (matches, clubs and the afltables identities are all it joins on) and precedes draftguru', () => {
      expect(ids.indexOf('fitzroy')).toBeLessThan(ids.indexOf('coaches'));
      expect(ids.indexOf('birth-dates')).toBeLessThan(ids.indexOf('coaches'));
      expect(ids.indexOf('coaches')).toBeLessThan(ids.indexOf('draftguru'));
    });

    it('refuses a contract with no pin, a tampered manifest hash, a moved manifest and a missing measured value', () => {
      expect(() => afltablesCoachesPin(() => null)).toThrow(/no accepted coaches snapshot/);
      expect(() => afltablesCoachesPin(() => ({ coaches: {} }))).toThrow(/no accepted coaches snapshot/);
      expect(() => afltablesCoachesPin(() => ({ coaches: { accepted_snapshot: null } }))).toThrow(/no accepted coaches snapshot/);
      const real = JSON.parse(readFileSync(contractPath, 'utf8'));
      const tampered = structuredClone(real);
      tampered.coaches.accepted_snapshot.manifest_sha256_lf = '0'.repeat(64);
      expect(() => afltablesCoachesPin(() => tampered)).toThrow(/hashes to/);
      const moved = structuredClone(real);
      moved.coaches.accepted_snapshot.manifest = 'docs/rebuild-manifests/afltables_coaches/nope.json';
      expect(() => afltablesCoachesPin(() => moved)).toThrow(/not in this checkout/);
      const unmeasured = structuredClone(real);
      delete unmeasured.coaches.accepted_snapshot.measured.coaches_unlinked;
      expect(() => afltablesCoachesPin(() => unmeasured)).toThrow(/coaches_unlinked is not an integer/);
      // The real pin proves: the tracked manifest hashes to its LF binding on any checkout.
      const pin = afltablesCoachesPin();
      expect(pin.measured.coaches).toBe(pin.measured.coachesLinkedToPlayers + pin.measured.coachesUnlinked);
      expect(pin.measured.matchCoaches).toBe(2 * pin.measured.matchesWithBothCoaches + pin.measured.matchesWithOneCoach);
    });

    it('preflights the snapshot offline before the destructive stage and refuses on failure', () => {
      const commands: string[][] = [];
      const withFailing = (failing?: string): Deps => ({
        ...fakeDeps().deps,
        runCommand: (a: string[]) => {
          commands.push(a);
          if (failing && a.includes(failing)) return { status: 1, stdout: '', stderr: 'sha256 mismatch' };
          if (a.includes(BROWNLOW_SEASON_LOADER)) return { status: 0, stdout: '{"ok": true}', stderr: '' };
          return { status: 0, stdout: 'snapshot : x (42 year pages, sha256 verified)\npersons    : 5057\npicks      : 6810\n', stderr: '' };
        },
      });
      runPreflight(withFailing(), OPTS, fitzroy());
      const validate = commands.filter((a) => a.includes('--validate-only'));
      expect(validate.some((a) => a.includes(COACH_LOADER) && a.includes(afltablesCoachesPin().label) && a.includes(FULL_LABEL))).toBe(true);
      expect(() => runPreflight(withFailing(COACH_LOADER), OPTS, fitzroy()))
        .toThrow(/Coaches preflight failed[\s\S]*Nothing has been destroyed/);
    });

    it('gates the rebuilt coaching on the contract pin: people, proven links only, assignments, coverage shape', () => {
      const checks = coachChecks();
      expect(checks.map((c) => c.key)).toEqual([
        'coaches', 'coaches_linked_to_players', 'coaches_unlinked', 'coaches_linked_outside_unique',
        'match_coaches', 'matches_with_both_coaches', 'matches_with_one_coach', 'matches_without_coach',
      ]);
      const byKey = Object.fromEntries(checks.map((c) => [c.key, c]));
      const pin = afltablesCoachesPin();
      expect(byKey.coaches.expected).toBe(pin.measured.coaches);
      expect(byKey.coaches_linked_outside_unique.expected).toBe(0);
      expect(byKey.match_coaches.expected).toBe(pin.measured.matchCoaches);
      expect(byKey.coaches_linked_to_players.sql).toMatch(/link_status_value = 'unique'/);
      expect(byKey.matches_without_coach.sql).toMatch(/LEFT JOIN match_coaches/);
      for (const c of checks) expect(c.sql).not.toMatch(/display_name|surname|name_key/); // never a name
      const register = JSON.parse(readFileSync(
        join(root, 'data', 'reference', 'fitzroy-accepted-baselines.json'), 'utf8'));
      const all = finalValidationChecks(register).map((c) => c.key);
      expect(all).toEqual(expect.arrayContaining(checks.map((c) => c.key)));
      // Added after the birth-date gates, in stage order.
      expect(all.indexOf('coaches')).toBeGreaterThan(all.indexOf('dob_disagreeing_with_club_list'));
    });
  });

  describe('father–son selections (AFLDB-ISSUE-118 §23.29 family F)', () => {
    const ids = idsOf(stages);
    const stage = stages.find((s) => s.id === 'father-son')!;
    const HEADER = 'source_key,draft_year,competition,selection_pick,selection_raw,club,drafted_player,drafted_games_reported,'
      + 'drafted_profile,drafted_link,drafted_note,father,father_games_reported,father_profile,father_link,father_note\n';
    const row = (key: string, son: string, sonLink: string, father: string, fatherLink: string) =>
      `${key},${key.split(':')[1]},national,1,1,Geelong,"Son, Jr.",10,${son},${sonLink},"n, with a comma",Dad,100,${father},${fatherLink},note\n`;

    it('loads the tracked artefact through the loader\'s load subcommand, and derives the preflight argv from it', () => {
      expect(stage.argv).toEqual([resolvePython(), FATHER_SON_LOADER, 'load', '--csv', FATHER_SON_CSV, '--provenance', FATHER_SON_PROVENANCE]);
      expect(fatherSonArgv()).toEqual(stage.argv);
      expect(fatherSonValidateArgv()).toEqual([...stage.argv!, '--validate-only']);
      expect(stage.kind).toBe('data');
      expect(stage.envOverlay).toEqual({ AFLDB_IMPORT_DATABASE_URL: target().importDsn });
      expect(stage.name).toContain(`${fatherSonMeasures().selections} selections`);
      expect(stage.argv!.join(' ')).not.toMatch(/legacy|sqlite|acquire|normalize/i);
      for (const path of [FATHER_SON_CSV, FATHER_SON_ADJUDICATIONS, FATHER_SON_PROVENANCE]) expect(existsSync(join(root, path))).toBe(true);
    });

    it('follows coaches (players and the afltables identities are all it joins on) and precedes draftguru', () => {
      expect(ids.indexOf('fitzroy')).toBeLessThan(ids.indexOf('father-son'));
      expect(ids.indexOf('coaches')).toBeLessThan(ids.indexOf('father-son'));
      expect(ids.indexOf('father-son')).toBeLessThan(ids.indexOf('draftguru'));
    });

    it('reads its gate values from the artefact itself and refuses a missing, headerless or self-contradicting one', () => {
      const m = fatherSonMeasures();
      expect(m.selections).toBeGreaterThan(100);
      expect(m.sonsLinked).toBeLessThanOrEqual(m.selections);
      expect(m.fathersLinked).toBeLessThanOrEqual(m.selections);
      expect(m.distinctFathersLinked).toBeLessThanOrEqual(m.fathersLinked);
      expect(() => fatherSonMeasures(() => null)).toThrow(/not in this checkout/);
      expect(() => fatherSonMeasures(() => 'source_key,draft_year\n')).toThrow(/no data rows or an unexpected header/);
      expect(() => fatherSonMeasures(() => HEADER)).toThrow(/no data rows/);
      const ok = HEADER
        + row('wikipedia-father-son-rule:2001:01', 'players/G/Gary_Ablett1.html', 'unique', 'players/G/Gary_Ablett0.html', 'unique')
        + row('wikipedia-father-son-rule:2004:01', '', 'unmatched', 'players/G/Gary_Ablett0.html', 'unique')
        + row('wikipedia-father-son-rule:2004:02', 'players/X/X.html', 'resolved', '', 'unmatched');
      expect(fatherSonMeasures(() => ok)).toEqual({ selections: 3, sonsLinked: 2, fathersLinked: 2, distinctFathersLinked: 1 });
      // A trusted status with no profile, or a profile under 'unmatched', is a contradiction the gate refuses to count.
      expect(() => fatherSonMeasures(() => HEADER + row('wikipedia-father-son-rule:2001:01', '', 'unique', 'players/G/Gary_Ablett0.html', 'unique'))).toThrow(/disagrees with its profile/);
      expect(() => fatherSonMeasures(() => HEADER + row('wikipedia-father-son-rule:2001:01', 'players/X/X.html', 'unique', 'players/G/G.html', 'unmatched'))).toThrow(/disagrees with its profile/);
      // The reader honours quoted commas and CRLF.
      expect(parseCsvRows('a,"b, c","d ""q"""\r\n1,2,3\r\n')).toEqual([['a', 'b, c', 'd "q"'], ['1', '2', '3']]);
    });

    it('preflights the tracked files and the loader\'s offline validation before the destructive stage', () => {
      const commands: string[][] = [];
      const withFailing = (failing?: string): Deps => ({
        ...fakeDeps().deps,
        runCommand: (a: string[]) => {
          commands.push(a);
          if (failing && a.includes(failing)) return { status: 1, stdout: '', stderr: 'ERROR: columns differ' };
          if (a.includes(BROWNLOW_SEASON_LOADER)) return { status: 0, stdout: '{"ok": true}', stderr: '' };
          return { status: 0, stdout: 'snapshot : x (42 year pages, sha256 verified)\npersons    : 5057\npicks      : 6810\n', stderr: '' };
        },
      });
      runPreflight(withFailing(), OPTS, fitzroy());
      expect(commands.some((a) => a.includes(FATHER_SON_LOADER) && a.includes('load') && a.includes('--validate-only'))).toBe(true);
      expect(() => runPreflight(withFailing(FATHER_SON_LOADER), OPTS, fitzroy()))
        .toThrow(/Father–son preflight failed[\s\S]*Nothing has been destroyed/);
      const ok = withFailing();
      const missing: Deps = { ...ok, fileExists: (path: string) => path !== FATHER_SON_ADJUDICATIONS && ok.fileExists(path) };
      expect(() => runPreflight(missing, OPTS, fitzroy())).toThrow(/Father–son preflight: required tracked input is missing[\s\S]*father-son-adjudications/);
    });

    it('gates the rebuilt selections on the artefact: rows, proven links only, one relationship per selection', () => {
      const checks = fatherSonChecks();
      expect(checks.map((c) => c.key)).toEqual([
        'father_son_selections', 'father_son_sons_linked', 'father_son_fathers_linked', 'father_son_distinct_fathers',
        'father_son_links_outside_trusted_status', 'player_relationships_parent_child',
      ]);
      const byKey = Object.fromEntries(checks.map((c) => [c.key, c]));
      const m = fatherSonMeasures();
      expect(byKey.father_son_selections.expected).toBe(m.selections);
      expect(byKey.father_son_sons_linked.expected).toBe(m.sonsLinked);
      expect(byKey.father_son_fathers_linked.expected).toBe(m.fathersLinked);
      expect(byKey.father_son_distinct_fathers.expected).toBe(m.distinctFathersLinked);
      expect(byKey.father_son_links_outside_trusted_status.expected).toBe(0);
      expect(byKey.player_relationships_parent_child.expected).toBe(m.selections);
      for (const c of checks) expect(c.sql).not.toMatch(/display_name|surname|_name_raw|drafted_player_name|father_name/); // never a name
      const register = JSON.parse(readFileSync(
        join(root, 'data', 'reference', 'fitzroy-accepted-baselines.json'), 'utf8'));
      const all = finalValidationChecks(register).map((c) => c.key);
      expect(all).toEqual(expect.arrayContaining(checks.map((c) => c.key)));
      // Added after the coach gates, in stage order.
      expect(all.indexOf('father_son_selections')).toBeGreaterThan(all.indexOf('matches_without_coach'));
    });
  });

  describe('sibling pairs (AFLDB-ISSUE-118 §23.31 family F)', () => {
    const ids = idsOf(stages);
    const stage = stages.find((s) => s.id === 'siblings')!;
    const HEADER = 'source_key,family_key,family_name,person_a_name,person_a_role,person_a_wikipedia,person_a_clubs,person_a_legacy,'
      + 'person_a_profile,person_a_link,person_a_note,person_b_name,person_b_role,person_b_wikipedia,person_b_clubs,person_b_legacy,'
      + 'person_b_profile,person_b_link,person_b_note,relationship_label,source_label,evidence,extraction_method,source_revision_id,also_source_keys\n';
    const row = (key: string, a: string, aLink: string, b: string, bLink: string, label = 'brothers') =>
      `${key},ablett-0004,Ablett,"Ablett, A",brother,u,"Geelong, Hawthorn",unique:1,${a},${aLink},"n, with a comma",B Ablett,sibling,u,,unmatched,${b},${bLink},note,${label},siblings/brothers,"A and B were brothers.",prose_rule,1,\n`;

    it('loads the tracked artefact through the loader\'s load subcommand, and derives the preflight argv from it', () => {
      expect(stage.argv).toEqual([resolvePython(), SIBLINGS_LOADER, 'load', '--csv', SIBLINGS_CSV, '--provenance', SIBLINGS_PROVENANCE]);
      expect(siblingsArgv()).toEqual(stage.argv);
      expect(siblingsValidateArgv()).toEqual([...stage.argv!, '--validate-only']);
      expect(stage.kind).toBe('data');
      expect(stage.envOverlay).toEqual({ AFLDB_IMPORT_DATABASE_URL: target().importDsn });
      expect(stage.name).toContain(`${siblingMeasures().pairs} pairs`);
      expect(stage.argv!.join(' ')).not.toMatch(/legacy|sqlite|acquire|normalize|families\//i);
      for (const path of [SIBLINGS_CSV, SIBLINGS_ADJUDICATIONS, SIBLINGS_SUPPLEMENTS, SIBLINGS_PROVENANCE]) expect(existsSync(join(root, path))).toBe(true);
    });

    it('follows father-son (the same identities) and precedes draftguru', () => {
      expect(ids.indexOf('fitzroy')).toBeLessThan(ids.indexOf('siblings'));
      expect(ids.indexOf('father-son')).toBeLessThan(ids.indexOf('siblings'));
      expect(ids.indexOf('siblings')).toBeLessThan(ids.indexOf('draftguru'));
    });

    it('reads its gate values from the artefact itself and refuses a missing, headerless or self-contradicting one', () => {
      const m = siblingMeasures();
      expect(m.pairs).toBeGreaterThan(400);
      expect(m.pairsBothLinked).toBeLessThanOrEqual(m.pairs);
      expect(m.brotherPairsLinked).toBeLessThanOrEqual(m.pairsBothLinked);
      expect(m.playersWithBrother).toBeLessThanOrEqual(2 * m.brotherPairsLinked);
      expect(m.unlinkedSides).toBeGreaterThanOrEqual(m.pairs - m.pairsBothLinked);
      expect(m.unlinkedSides).toBeLessThanOrEqual(2 * (m.pairs - m.pairsBothLinked));
      expect(() => siblingMeasures(() => null)).toThrow(/not in this checkout/);
      expect(() => siblingMeasures(() => 'source_key,family_key\n')).toThrow(/no data rows or an unexpected header/);
      expect(() => siblingMeasures(() => HEADER)).toThrow(/no data rows/);
      const ok = HEADER
        + row('000000000000000000000001', 'players/G/Gary_Ablett0.html', 'unique', 'players/G/Geoff_Ablett.html', 'unique')
        + row('000000000000000000000002', 'players/G/Gary_Ablett0.html', 'unique', 'players/K/Kevin_Ablett.html', 'resolved')
        + row('000000000000000000000003', 'players/G/Geoff_Ablett.html', 'unique', '', 'unmatched', 'siblings')
        + row('000000000000000000000004', '', 'ambiguous', '', 'unmatched', 'siblings')
        + row('000000000000000000000005', 'players/A/A.html', 'unique', 'players/B/B.html', 'unique', 'twins');
      expect(siblingMeasures(() => ok)).toEqual({ pairs: 5, pairsBothLinked: 3, brotherPairsLinked: 2, playersWithBrother: 3, unlinkedSides: 3 });
      // A trusted status with no profile, a profile under an untrusted status, or a self-pair is refused.
      expect(() => siblingMeasures(() => HEADER + row('000000000000000000000001', '', 'unique', 'players/G/Geoff_Ablett.html', 'unique'))).toThrow(/disagrees with its profile/);
      expect(() => siblingMeasures(() => HEADER + row('000000000000000000000001', 'players/X/X.html', 'ambiguous', '', 'unmatched'))).toThrow(/disagrees with its profile/);
      expect(() => siblingMeasures(() => HEADER + row('000000000000000000000001', 'players/X/X.html', 'unique', 'players/X/X.html', 'unique'))).toThrow(/links one player to himself/);
    });

    it('preflights the tracked files and the loader\'s offline validation before the destructive stage', () => {
      const commands: string[][] = [];
      const withFailing = (failing?: string): Deps => ({
        ...fakeDeps().deps,
        runCommand: (a: string[]) => {
          commands.push(a);
          if (failing && a.includes(failing)) return { status: 1, stdout: '', stderr: 'ERROR: columns differ' };
          if (a.includes(BROWNLOW_SEASON_LOADER)) return { status: 0, stdout: '{"ok": true}', stderr: '' };
          return { status: 0, stdout: 'snapshot : x (42 year pages, sha256 verified)\npersons    : 5057\npicks      : 6810\n', stderr: '' };
        },
      });
      runPreflight(withFailing(), OPTS, fitzroy());
      expect(commands.some((a) => a.includes(SIBLINGS_LOADER) && a.includes('load') && a.includes('--validate-only'))).toBe(true);
      expect(() => runPreflight(withFailing(SIBLINGS_LOADER), OPTS, fitzroy()))
        .toThrow(/Siblings preflight failed[\s\S]*Nothing has been destroyed/);
      const ok = withFailing();
      const missing: Deps = { ...ok, fileExists: (path: string) => path !== SIBLINGS_ADJUDICATIONS && ok.fileExists(path) };
      expect(() => runPreflight(missing, OPTS, fitzroy())).toThrow(/Siblings preflight: required tracked input is missing[\s\S]*sibling-adjudications/);
      const noSupplement: Deps = { ...ok, fileExists: (path: string) => path !== SIBLINGS_SUPPLEMENTS && ok.fileExists(path) };
      expect(() => runPreflight(noSupplement, OPTS, fitzroy())).toThrow(/Siblings preflight: required tracked input is missing[\s\S]*sibling-supplements/);
    });

    it('gates the rebuilt pairs on the artefact: rows, proven links only, brothers, no self or duplicate pair', () => {
      const checks = siblingChecks();
      expect(checks.map((c) => c.key)).toEqual([
        'player_relationships_sibling', 'sibling_pairs_both_linked', 'sibling_unlinked_sides', 'sibling_brother_pairs_linked',
        'sibling_players_with_brother', 'sibling_self_pairs', 'sibling_duplicate_pairs',
      ]);
      const byKey = Object.fromEntries(checks.map((c) => [c.key, c]));
      const m = siblingMeasures();
      expect(byKey.player_relationships_sibling.expected).toBe(m.pairs);
      expect(byKey.sibling_pairs_both_linked.expected).toBe(m.pairsBothLinked);
      expect(byKey.sibling_unlinked_sides.expected).toBe(m.unlinkedSides);
      expect(byKey.sibling_brother_pairs_linked.expected).toBe(m.brotherPairsLinked);
      expect(byKey.sibling_players_with_brother.expected).toBe(m.playersWithBrother);
      expect(byKey.sibling_self_pairs.expected).toBe(0);
      expect(byKey.sibling_duplicate_pairs.expected).toBe(0);
      for (const c of checks) expect(c.sql).not.toMatch(/display_name|surname|_name_raw|person_a_name|person_b_name|family_key/); // never a name or a family
      const register = JSON.parse(readFileSync(
        join(root, 'data', 'reference', 'fitzroy-accepted-baselines.json'), 'utf8'));
      const all = finalValidationChecks(register).map((c) => c.key);
      expect(all).toEqual(expect.arrayContaining(checks.map((c) => c.key)));
      // Added after the father–son gates, in stage order.
      expect(all.indexOf('player_relationships_sibling')).toBeGreaterThan(all.indexOf('player_relationships_parent_child'));
    });
  });

  describe('after-siren events (AFLDB-ISSUE-118 §23.33–§23.35)', () => {
    const ids = idsOf(stages);
    const stage = stages.find((s) => s.id === 'after-siren')!;
    const reconcile = stages.find((s) => s.id === 'after-siren-reconcile')!;
    const HEADER = 'event_key,season,competition,premiership_season,round_raw,round_code,round_kind,player_name_raw,'
      + 'player_name,club_raw,opponent_raw,kick_scored,kick_effect,shot_detail,kicker_result,siren,kicker_score_raw,'
      + 'opponent_score_raw,kicker_points,opponent_points,margin,supergoal_scoring,score_footnote_raw,outcome_raw,'
      + 'ref_raw,cited,adjudication_keys,source_file,source_table,source_line,note\n';
    const row = (key: string, prem: string, scored: string, effect: string) =>
      `${key},2017,VFL/AFL,${prem},EF,EF,final,A B,A B,West Coast,Port Adelaide,${scored},${effect},,`
      + `${effect === 'won' ? 'win' : effect === 'drew' ? 'draw' : 'loss'},final,10.10 (70),10.9 (69),70,69,1,false,,,[1],true,,f.csv,t,2,\n`;

    it('loads the tracked artefact through the loader\'s load subcommand, and derives the preflight argv from it', () => {
      expect(stage.argv).toEqual([resolvePython(), AFTER_SIREN_LOADER, 'load', '--csv', AFTER_SIREN_CSV, '--provenance', AFTER_SIREN_PROVENANCE]);
      expect(afterSirenArgv()).toEqual(stage.argv);
      expect(afterSirenValidateArgv()).toEqual([...stage.argv!, '--validate-only']);
      expect(stage.kind).toBe('data');
      expect(stage.envOverlay).toEqual({ AFLDB_IMPORT_DATABASE_URL: target().importDsn });
      expect(stage.name).toContain(`${afterSirenMeasures().events} events`);
      expect(stage.argv!.join(' ')).not.toMatch(/legacy|sqlite|acquire|normalize|after-siren\//i);
      for (const path of [AFTER_SIREN_CSV, AFTER_SIREN_ADJUDICATIONS, AFTER_SIREN_PROVENANCE]) expect(existsSync(join(root, path))).toBe(true);
    });

    it('runs a re-resolution reconcile as a validation stage right after the load', () => {
      expect(reconcile.kind).toBe('validation');
      expect(reconcile.run).toBe('command');
      expect(reconcile.argv).toEqual([resolvePython(), AFTER_SIREN_LOADER, 'reconcile', '--csv', AFTER_SIREN_CSV]);
      expect(afterSirenReconcileArgv()).toEqual(reconcile.argv);
      expect(reconcile.envOverlay).toEqual({ AFLDB_IMPORT_DATABASE_URL: target().importDsn });
      expect(ids.indexOf('after-siren-reconcile')).toBe(ids.indexOf('after-siren') + 1);
    });

    it('follows siblings (the same identities) and precedes draftguru', () => {
      expect(ids.indexOf('fitzroy')).toBeLessThan(ids.indexOf('after-siren'));
      expect(ids.indexOf('siblings')).toBeLessThan(ids.indexOf('after-siren'));
      expect(ids.indexOf('after-siren')).toBeLessThan(ids.indexOf('draftguru'));
    });

    it('reads its gate values from the artefact itself and refuses a missing or headerless one', () => {
      const m = afterSirenMeasures();
      expect(m.events).toBeGreaterThan(100);
      expect(m.premiershipEvents + m.otherCompetitionEvents).toBe(m.events);
      expect(m.qualifyingEvents).toBeLessThanOrEqual(m.premiershipEvents);
      expect(() => afterSirenMeasures(() => null)).toThrow(/not in this checkout/);
      expect(() => afterSirenMeasures(() => 'event_key,season\n')).toThrow(/no data rows or an unexpected header/);
      const ok = HEADER
        + row('e1', 'true', 'goal', 'won')
        + row('e2', 'true', 'behind', 'won')
        + row('e3', 'true', 'goal', 'drew')
        + row('e4', 'true', 'none', 'none')
        + row('e5', 'false', 'goal', 'won');
      expect(afterSirenMeasures(() => ok)).toEqual({ events: 5, premiershipEvents: 4, otherCompetitionEvents: 1, qualifyingEvents: 2 });
    });

    it('preflights the tracked files and the loader\'s offline validation before the destructive stage', () => {
      const commands: string[][] = [];
      const withFailing = (failing?: string): Deps => ({
        ...fakeDeps().deps,
        runCommand: (a: string[]) => {
          commands.push(a);
          if (failing && a.includes(failing) && a.includes('--validate-only')) return { status: 1, stdout: '', stderr: 'ERROR: measures disagree' };
          if (a.includes(BROWNLOW_SEASON_LOADER)) return { status: 0, stdout: '{"ok": true}', stderr: '' };
          return { status: 0, stdout: 'snapshot : x (42 year pages, sha256 verified)\npersons    : 5057\npicks      : 6810\n', stderr: '' };
        },
      });
      runPreflight(withFailing(), OPTS, fitzroy());
      expect(commands.some((a) => a.includes(AFTER_SIREN_LOADER) && a.includes('load') && a.includes('--validate-only'))).toBe(true);
      expect(() => runPreflight(withFailing(AFTER_SIREN_LOADER), OPTS, fitzroy()))
        .toThrow(/After-siren preflight failed[\s\S]*Nothing has been destroyed/);
      const ok = withFailing();
      const missing: Deps = { ...ok, fileExists: (path: string) => path !== AFTER_SIREN_ADJUDICATIONS && ok.fileExists(path) };
      expect(() => runPreflight(missing, OPTS, fitzroy())).toThrow(/After-siren preflight: required tracked input is missing[\s\S]*after-siren-adjudications/);
    });

    it('gates the rebuilt events on the artefact: total, prem split, qualifying set, no duplicate, provenance present', () => {
      const checks = afterSirenChecks();
      expect(checks.map((c) => c.key)).toEqual([
        'after_siren_kicks', 'after_siren_premiership_rows', 'after_siren_other_competition_rows',
        'after_siren_qualifying_rows', 'after_siren_duplicate_events', 'after_siren_rows_missing_provenance',
      ]);
      const byKey = Object.fromEntries(checks.map((c) => [c.key, c]));
      const m = afterSirenMeasures();
      expect(byKey.after_siren_kicks.expected).toBe(m.events);
      expect(byKey.after_siren_premiership_rows.expected).toBe(m.premiershipEvents);
      expect(byKey.after_siren_other_competition_rows.expected).toBe(m.otherCompetitionEvents);
      expect(byKey.after_siren_qualifying_rows.expected).toBe(m.qualifyingEvents);
      expect(byKey.after_siren_duplicate_events.expected).toBe(0);
      expect(byKey.after_siren_rows_missing_provenance.expected).toBe(0);
      for (const c of checks) expect(c.sql).not.toMatch(/player_name|club_name_raw|opponent_name_raw/); // never a name
      const register = JSON.parse(readFileSync(
        join(root, 'data', 'reference', 'fitzroy-accepted-baselines.json'), 'utf8'));
      const all = finalValidationChecks(register).map((c) => c.key);
      expect(all).toEqual(expect.arrayContaining(checks.map((c) => c.key)));
      // Added after the sibling gates, in stage order.
      expect(all.indexOf('after_siren_kicks')).toBeGreaterThan(all.indexOf('player_relationships_sibling'));
    });
  });

  describe('brownlow season (AFLDB-ISSUE-113 §8.6)', () => {
    const brownlow = stages.find((s) => s.id === 'brownlow-season')!;

    it('runs after AWARDS & HONOURS and before DERIVED', () => {
      const ids = idsOf(stages);
      // fitzroy supplies players and the profile identities every row resolves
      // through; derived reads the table this stage writes.
      expect(ids.indexOf('fitzroy')).toBeLessThan(ids.indexOf('brownlow-season'));
      expect(ids.indexOf('awards-honours')).toBeLessThan(ids.indexOf('brownlow-season'));
      expect(ids.indexOf('brownlow-season')).toBeLessThan(ids.indexOf('derived'));
    });

    it('is a data stage that runs the dedicated loader with no legacy source', () => {
      expect(brownlow.kind).toBe('data');
      expect(brownlow.argv).toEqual([resolvePython(), BROWNLOW_SEASON_LOADER]);
      expect(brownlow.argv).toEqual(brownlowSeasonImportArgv());
      expect(brownlow.envOverlay).toEqual({ AFLDB_IMPORT_DATABASE_URL: target().importDsn });
      expect(brownlow.envOverlay).not.toHaveProperty('AFLDB_LEGACY_SQLITE');
    });

    it('preflights the tracked artefact, manifest and adjudication file offline', () => {
      expect(BROWNLOW_SEASON_PREFLIGHT_FILES).toEqual([
        'data/brownlow/season-votes.csv',
        'data/brownlow/season-votes.manifest.json',
        'data/brownlow/player-identity.csv',
      ]);
      expect(brownlowSeasonValidateArgv()).toEqual([
        resolvePython(), BROWNLOW_SEASON_LOADER, '--validate-only',
      ]);
      const draftguruOk = 'snapshot : x (42 year pages, sha256 verified)\n'
        + 'persons    : 5057\npicks      : 6810\n';
      const withBrownlow = (status: number): Deps => ({
        ...fakeDeps().deps,
        runCommand: (a: string[]) => (a.includes(BROWNLOW_SEASON_LOADER)
          ? { status, stdout: status ? '{"ok": false, "error": "sha256 mismatch"}' : '{"ok": true}', stderr: '' }
          : { status: 0, stdout: draftguruOk, stderr: '' }),
      });
      expect(() => runPreflight(withBrownlow(0), OPTS)).not.toThrow();
      // A failing self-validation refuses before anything is destroyed.
      expect(() => runPreflight(withBrownlow(1), OPTS)).toThrow(RebuildRefused);
      expect(() => runPreflight(withBrownlow(1), OPTS)).toThrow(/Nothing has been destroyed/);
      // A missing tracked input refuses too.
      const missing: Deps = {
        ...withBrownlow(0),
        fileExists: (path) => !path.endsWith('season-votes.manifest.json'),
      };
      expect(() => runPreflight(missing, OPTS))
        .toThrow(/required tracked input is missing: data\/brownlow\/season-votes\.manifest\.json/);
    });
  });

  describe('awards & honours (AFLDB-ISSUE-112 §7/§24)', () => {
    const awards = stages.find((s) => s.id === 'awards-honours')!;

    it('runs after DraftGuru and before DERIVED', () => {
      const ids = idsOf(stages);
      // Every family carries player links, so the canonical players population
      // must be complete before it runs.
      expect(ids.indexOf('draftguru')).toBeLessThan(ids.indexOf('awards-honours'));
      expect(ids.indexOf('awards-honours')).toBeLessThan(ids.indexOf('derived'));
    });

    it('runs every legacy-free manifest group and nothing else', () => {
      expect(awards.argv).toEqual([
        resolvePython(), 'tools/migration/import_awards.py', '--groups',
        ...AWARDS_HONOURS_GROUPS,
      ]);
      // 'awards' is the legacy re-extract and is the one group that still needs
      // AFLDB_LEGACY_SQLITE; 'coleman' is derived and has its own stage after
      // `derived`, where season_metadata has decided which seasons are complete.
      expect(AWARDS_HONOURS_GROUPS).not.toContain('awards');
      expect(AWARDS_HONOURS_GROUPS).not.toContain('coleman');
    });

    it('runs only groups import_awards.py declares legacy-free', () => {
      const src = readFileSync(
        join(root, 'tools', 'migration', 'import_awards.py'), 'utf8');
      const declared = src.slice(src.indexOf('LEGACY_FREE_GROUPS = {'),
                                 src.indexOf('BATCH_SOURCE_KEYS'));
      for (const group of AWARDS_HONOURS_GROUPS) {
        expect(declared).toContain(`"${group}"`);
      }
    });

    it('carries no legacy source in its own environment', () => {
      expect(JSON.stringify(awards)).not.toContain('AFLDB_LEGACY_SQLITE');
      expect(awards.envOverlay).toEqual({ AFLDB_IMPORT_DATABASE_URL: IMPORT });
    });
  });

  describe('ladder witness cross-check (AFLDB-ISSUE-095 D7)', () => {
    const witness = stages.find((s) => s.id === 'ladder-witness')!;

    it('runs after club_seasons is derived and before final validation', () => {
      const ids = idsOf(stages);
      expect(ids.indexOf('derived')).toBeLessThan(ids.indexOf('ladder-witness'));
      expect(ids.indexOf('ladder-witness')).toBeLessThan(ids.indexOf('fingerprints'));
    });

    it('cross-checks against the label the tracked contract accepts', () => {
      const contract = JSON.parse(readFileSync(
        join(root, 'tools', 'rebuild', 'fitzroy', 'fitzroy-contract.json'), 'utf8'));
      const accepted = contract.datasets.ladder.accepted_witness;
      expect(witness.argv).toContain(accepted.snapshot_label);
      expect(witness.argv).toContain('--compare');
      expect(witness.argv).toContain(LADDER_WITNESS_VALIDATOR);
      // The manifest is bound by hash, so the bytes cannot be swapped underneath it.
      // Its VALUE is asserted in the next test (AFLDB-ISSUE-114); a shape-only check
      // here is exactly what let a stale CRLF literal survive AFLDB-ISSUE-108.
      expect(accepted.manifest_sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it('binds the witness to the canonical LF bytes of the tracked manifest', () => {
      // AFLDB-ISSUE-114 — the AFLDB-ISSUE-108 defect class, missed here.
      // validate_ladder_witness.py:142-144 compares sha256 over the manifest's RAW
      // bytes, so a literal captured from a CRLF working copy makes the witness
      // binding fail closed on a CORRECT manifest, on every platform, before a single
      // ladder CSV is read — and the rebuild's ladder gate with it. Assert the value,
      // not the shape. Line endings are normalised before hashing for the same reason
      // as the core register at :425-427: .gitattributes renders these bytes LF on
      // every checkout, so the canonical LF hash is the only binding that can pass,
      // and the assertion itself must not depend on the working copy's endings.
      const contract = JSON.parse(readFileSync(
        join(root, 'tools', 'rebuild', 'fitzroy', 'fitzroy-contract.json'), 'utf8'));
      const accepted = contract.datasets.ladder.accepted_witness;

      // The validator derives the manifest as `<manifest_dir>/<label>.json`, so a
      // binding filed under any other name would hash a different file than the one
      // it proves. Read the path from the contract rather than writing it here.
      expect(accepted.manifest).toBe(
        `docs/rebuild-manifests/afltables_fitzroy_core/${accepted.snapshot_label}.json`);

      const lf = readFileSync(join(root, ...accepted.manifest.split('/')), 'utf8')
        .replace(/\r\n/g, '\n');
      const sha = (text: string) =>
        createHash('sha256').update(text, 'utf8').digest('hex');

      expect(accepted.manifest_sha256).toBe(sha(lf));
      // ...and it is the LF rendering that is bound, never the CRLF rendering of the
      // identical document. That substitution is the whole of AFLDB-ISSUE-114, and it
      // is silent: both values are well-formed 64-hex digests of the same manifest.
      expect(accepted.manifest_sha256).not.toBe(sha(lf.replace(/\n/g, '\r\n')));

      // The manifest the binding accepts is still the accepted acquisition itself:
      // this repair re-pointed the hash at the same document, it did not admit new
      // bytes (that would be an AFLDB-ISSUE-101 successor-witness decision).
      const manifest = JSON.parse(lf);
      const ladderFiles = manifest.files.filter((f: any) => f.dataset === 'ladder');
      expect(ladderFiles).toHaveLength(accepted.files);
      expect(ladderFiles.reduce((n: number, f: any) => n + f.row_count, 0))
        .toBe(accepted.rows);
    });

    it('refuses rather than guessing when no witness is accepted', () => {
      expect(() => ladderWitnessLabel(() => ({ datasets: {} }))).toThrow(RebuildRefused);
      expect(() => ladderWitnessLabel(() => null)).toThrow(RebuildRefused);
    });

    it('proves the witness offline BEFORE anything is destroyed', () => {
      // The durability gate: the raw CSVs are gitignored, so a fresh checkout has the
      // manifest and not the bytes. That must refuse at preflight, not at the last stage
      // with the database already gone.
      const argv = ladderWitnessValidateArgv();
      expect(argv).toContain(LADDER_WITNESS_VALIDATOR);
      expect(argv).not.toContain('--compare');   // offline: no database contact

      const draftguruOk = 'snapshot : x (42 year pages, sha256 verified)\n'
        + 'persons    : 5057\npicks      : 6810\n';
      const failing: Deps = {
        ...fakeDeps().deps,
        runCommand: (a: string[]) => (a.includes(LADDER_WITNESS_VALIDATOR)
          ? { status: 2, stdout: 'REFUSED: acquired bytes are absent', stderr: '' }
          : { status: 0, stdout: draftguruOk, stderr: '' }),
      };
      expect(() => runPreflight(failing, OPTS)).toThrow(RebuildRefused);
      expect(() => runPreflight(failing, OPTS)).toThrow(/Nothing has been destroyed/);

      // ... and it passes when the bytes are there, so the gate is not vacuous.
      const passing: Deps = {
        ...fakeDeps().deps,
        runCommand: () => ({ status: 0, stdout: draftguruOk, stderr: '' }),
      };
      expect(() => runPreflight(passing, OPTS)).not.toThrow();
    });
  });

  describe('Coleman derivation stage (AFLDB-ISSUE-111)', () => {
    const coleman = stages.find((s) => s.id === 'coleman')!;

    it('runs after the facts it derives from and before final validation', () => {
      const ids = idsOf(stages);
      // fitzRoy supplies matches, player_match_stats and the AFL Tables profile
      // identities the durable key is built from.
      expect(ids.indexOf('fitzroy')).toBeLessThan(ids.indexOf('coleman'));
      // derived is where season_metadata decides which seasons are complete, and an
      // undecided season must not materialise a winner.
      expect(ids.indexOf('derived')).toBeLessThan(ids.indexOf('coleman'));
      expect(ids.indexOf('coleman')).toBeLessThan(ids.indexOf('fingerprints'));
    });

    it('needs no legacy SQLite database', () => {
      // G9. The group is legacy-free, so the stage passes no legacy environment and the
      // whole plan still carries none (asserted separately below).
      expect(JSON.stringify(coleman)).not.toContain('AFLDB_LEGACY_SQLITE');
      expect(coleman.envOverlay).toEqual({ AFLDB_IMPORT_DATABASE_URL: IMPORT });
    });

    it('runs only the coleman group, never the legacy awards families', () => {
      expect(coleman.argv).toContain('--groups');
      expect(coleman.argv).toContain('coleman');
      for (const other of ['awards', 'all_australian', 'hall_of_fame', 'captaincies']) {
        expect(coleman.argv!.slice(coleman.argv!.indexOf('--groups') + 1))
          .not.toContain(other);
      }
    });
  });

  it('puts every preflight before the destructive stage', () => {
    expect(idsOf(stages).indexOf('precheck'))
      .toBeLessThan(idsOf(stages).indexOf('recreate'));
    expect(stages[0].kind).toBe('precheck');
    expect(stages.filter((s) => s.kind === 'destructive')).toHaveLength(1);
  });

  it('has exactly one fitzRoy phase and one DraftGuru phase', () => {
    expect(stages.filter((s) => s.id === 'fitzroy')).toHaveLength(1);
    expect(stages.filter((s) => s.id === 'draftguru')).toHaveLength(1);
    const draftguruCommands = stages
      .filter((s) => s.argv?.some((a) => a.includes('draftguru')));
    expect(draftguruCommands).toHaveLength(1);
  });

  it('orders reference -> fitzRoy -> DraftGuru -> derived', () => {
    const ids = idsOf(stages);
    expect(ids.indexOf('reference')).toBeLessThan(ids.indexOf('fitzroy'));
    expect(ids.indexOf('fitzroy')).toBeLessThan(ids.indexOf('draftguru'));
    expect(ids.indexOf('draftguru')).toBeLessThan(ids.indexOf('derived'));
  });

  it('wires the supported DraftGuru importer and never the retired one', () => {
    const draftguru = stages.find((s) => s.id === 'draftguru')!;
    expect(draftguru.argv).toContain('tools/rebuild/draftguru/import_draftguru.py');
    for (const stage of stages) {
      expect(stage.argv?.join(' ') ?? '').not.toContain('import_draft.py');
    }
  });

  it('gives every data stage the restricted test import DSN, and nothing else', () => {
    for (const stage of stages.filter((s) => s.kind === 'data')) {
      expect(stage.envOverlay?.AFLDB_IMPORT_DATABASE_URL).toBe(IMPORT);
      expect(stage.envOverlay?.AFLDB_IMPORT_DATABASE_URL).not.toContain('afldb_dev');
    }
  });

  it('applies the whole tracked migration set with no terminal number', () => {
    const migrations = stages.find((s) => s.id === 'migrations')!;
    expect(migrations.argv).toEqual(['npm', 'run', 'db:migrate:test']);
    expect(JSON.stringify(stages)).not.toMatch(/\b07\d\b/);
  });

  it('carries no AFLDB_LEGACY_SQLITE anywhere in the plan', () => {
    expect(JSON.stringify(stages)).not.toContain('AFLDB_LEGACY_SQLITE');
  });
});

/*
 * Python interpreter resolution.
 *
 * A git worktree has no .venv of its own, so the hard-coded in-tree path made every
 * Python stage fail before it ran. On Windows the only symptom was "The system cannot
 * find the path specified.", attributed to whichever stage ran first — it presented as a
 * fitzRoy preflight failure. AFLDB_PYTHON is the override seven existing suites already
 * use; these tests hold the harness to that same contract.
 */
describe('Python interpreter resolution', () => {
  const PY_STAGES = [
    'tools/migration/load_reference_data.py',
    'tools/migration/import_fitzroy_core.py',
    'tools/rebuild/draftguru/import_draftguru.py',
    'tools/migration/rebuild_derived.py',
    LADDER_WITNESS_VALIDATOR,
  ];
  const OVERRIDE = process.platform === 'win32'
    ? 'C:\\some\\other\\python.exe' : '/usr/bin/python3';

  it('keeps the platform-local project default when nothing is set', () => {
    expect(resolvePython({})).toBe(DEFAULT_VENV_PYTHON);
    expect(DEFAULT_VENV_PYTHON).toBe(process.platform === 'win32'
      ? join('.venv', 'Scripts', 'python.exe')
      : join('.venv', 'bin', 'python'));
  });

  it('prefers AFLDB_PYTHON when it is set', () => {
    expect(resolvePython({ AFLDB_PYTHON: OVERRIDE })).toBe(OVERRIDE);
  });

  it('treats a blank or whitespace override as unset rather than as a path', () => {
    expect(resolvePython({ AFLDB_PYTHON: '' })).toBe(DEFAULT_VENV_PYTHON);
    expect(resolvePython({ AFLDB_PYTHON: '   ' })).toBe(DEFAULT_VENV_PYTHON);
  });

  it('never resolves by searching outside the repository', () => {
    // An interpreter found by walking to a parent or sibling checkout is one nobody
    // chose, and this harness drives a destructive rebuild.
    const source = readFileSync(join(root, 'tools', 'db', 'rebuild-test.ts'), 'utf8');
    expect(source).not.toMatch(/\.\.[/\\]\.\.[/\\]/);
    expect(source).not.toContain('D:\\dev\\afldb');
    expect(source).not.toMatch(/readdirSync|process\.env\.PATH/);
  });

  describe('with AFLDB_PYTHON set', () => {
    const saved = process.env.AFLDB_PYTHON;
    beforeEach(() => { process.env.AFLDB_PYTHON = OVERRIDE; });
    afterEach(() => {
      if (saved === undefined) delete process.env.AFLDB_PYTHON;
      else process.env.AFLDB_PYTHON = saved;
    });

    it('runs every planned Python stage under the one override', () => {
      const stages = planStages(target(), fitzroy(), OPTS);
      const seen = stages.filter((s) => s.argv?.some((a) => PY_STAGES.includes(a)));
      expect(seen.length).toBe(PY_STAGES.length);
      for (const stage of seen) expect(stage.argv![0]).toBe(OVERRIDE);
      // and no stage is left on the in-tree default
      expect(JSON.stringify(stages)).not.toContain(DEFAULT_VENV_PYTHON);
    });

    it('uses the override for both preflights and the witness validator', () => {
      expect(fitzroyValidateArgv(fitzroy())[0]).toBe(OVERRIDE);
      expect(draftguruValidateArgv(OPTS.draftguruLabel)[0]).toBe(OVERRIDE);
      expect(ladderWitnessValidateArgv()[0]).toBe(OVERRIDE);
    });
  });

  it('refuses with the selected path when that interpreter does not exist', () => {
    // This case is about the DEFAULT interpreter, so the ambient environment must not
    // choose one for it. AFLDB_PYTHON is the documented setup for a worktree, and an
    // exported value made runPreflight resolve an absolute path this stub reports as
    // present, so the refusal never fired and the run fell through to the DraftGuru
    // preflight. Its siblings above and below already manage the variable explicitly.
    const savedPython = process.env.AFLDB_PYTHON;
    delete process.env.AFLDB_PYTHON;
    try {
      const deps: Deps = { ...fakeDeps().deps, fileExists: (p: string) => p !== DEFAULT_VENV_PYTHON };
      expect(() => runPreflight(deps, OPTS)).toThrow(RebuildRefused);
      expect(() => runPreflight(deps, OPTS)).toThrow(new RegExp(
        `No Python interpreter at .*${DEFAULT_VENV_PYTHON.replace(/[\\/.]/g, '.')}`));
      expect(() => runPreflight(deps, OPTS)).toThrow(/AFLDB_PYTHON/);
      expect(() => runPreflight(deps, OPTS)).toThrow(/Nothing has been destroyed/);
    } finally {
      if (savedPython === undefined) delete process.env.AFLDB_PYTHON;
      else process.env.AFLDB_PYTHON = savedPython;
    }
  });

  it('accepts an ABSOLUTE override path, which is what an override always is', () => {
    // path.join does not reset on an absolute second argument — join('D:/repo',
    // 'C:/py.exe') is 'D:/repo/C:/py.exe' — so resolving every candidate against the
    // repo root would have rejected every valid AFLDB_PYTHON.
    const source = readFileSync(join(root, 'tools', 'db', 'rebuild-test.ts'), 'utf8');
    expect(source).toContain('isAbsolute(path) ? path : join(REPO_ROOT, path)');
    expect(isAbsolute(OVERRIDE)).toBe(true);
  });

  it('names AFLDB_PYTHON as the source when the override is the missing one', () => {
    const saved = process.env.AFLDB_PYTHON;
    process.env.AFLDB_PYTHON = OVERRIDE;
    try {
      const deps: Deps = { ...fakeDeps().deps, fileExists: (p: string) => p !== OVERRIDE };
      expect(() => runPreflight(deps, OPTS)).toThrow(/from AFLDB_PYTHON/);
    } finally {
      if (saved === undefined) delete process.env.AFLDB_PYTHON;
      else process.env.AFLDB_PYTHON = saved;
    }
  });
});

/*
 * AFLDB-ISSUE-093 §H11 F3 — the FINAL VALIDATION stage.
 *
 * Stage 9 was declared `run: 'internal'` while executeRebuild had no branch for `internal`:
 * it logged its name, recorded itself as executed and did nothing, so §H9's mandatory
 * "final validation mismatch" refusal could never fire and `Rebuild complete.` meant only
 * that eight commands had exited zero. These tests exist so that cannot come back.
 */
describe('final validation', () => {
  /** A register with a measured block, shaped like the tracked one. */
  function measuredRegister(measured: Record<string, unknown>): Record<string, unknown> {
    return {
      contract: 'afldb.fitzroy.accepted_baselines',
      schema_version: 1,
      selection_policy: { rule: 'exactly_one_accepted' },
      baselines: [{
        snapshot_label: FULL_LABEL, acceptance_status: 'accepted', measured,
      }],
    };
  }

  it('is a stage that does work, not an inert declaration', () => {
    const stage = planStages(target(), fitzroy(), OPTS).at(-1)!;
    expect(stage.id).toBe('fingerprints');
    expect(stage.run).toBe('validate');
    expect(stage.sql).toContain(FINAL_VALIDATION_MARKER);
    // The specific regression: an `internal` stage falls straight through the loop.
    expect(stage.run).not.toBe('internal');
  });

  it('runs, and is reached only after every data stage', () => {
    const { deps, validationRuns } = fakeDeps();
    const report = executeRebuild(planStages(target(), fitzroy(), OPTS), target(), deps);
    expect(report.ok).toBe(true);
    expect(validationRuns).toHaveLength(1);
    expect(report.executed.at(-1)).toBe('fingerprints');
  });

  it('FAILS the rebuild when the database does not match', () => {
    const { deps } = fakeDeps('FINAL VALIDATION');
    const report = executeRebuild(planStages(target(), fitzroy(), OPTS), target(), deps);
    expect(report.ok).toBe(false);
    expect(report.failedStage).toBe('fingerprints');
  });

  it('takes its expected values from the tracked register, not from this file', () => {
    const tracked = JSON.parse(readFileSync(
      join(root, 'data', 'reference', 'fitzroy-accepted-baselines.json'), 'utf8'));
    const accepted = tracked.baselines.find((b: Record<string, unknown>) =>
      b.acceptance_status === 'accepted');
    const checks = finalValidationChecks(tracked);
    for (const [key, value] of Object.entries(accepted.measured)) {
      if (key.startsWith('$')) continue;
      const check = checks.find((c) => c.key === key);
      if (check) expect(check.expected).toBe(value);
    }
    // and the headline gates are actually present
    for (const key of ['matches', 'player_match_rows', 'brownlow_round_vote_rows']) {
      expect(checks.map((c) => c.key)).toContain(key);
    }
  });

  it('gates the seasons the accepted baseline claims, and excludes anything later', () => {
    const checks = finalValidationChecks(measuredRegister({
      matches: 16838, seasons_first: 1897, seasons_last: 2025,
    }));
    expect(checks.find((c) => c.key === 'seasons_first')?.expected).toBe(1897);
    expect(checks.find((c) => c.key === 'seasons_last')?.expected).toBe(2025);
    const later = checks.find((c) => c.key === 'matches_after_accepted_last_season')!;
    expect(later.expected).toBe(0);
    expect(later.sql).toContain('season > 2025');
  });

  it('binds the DraftGuru gates to the one expected-counts constant', () => {
    const checks = finalValidationChecks(measuredRegister({ matches: 1 }));
    expect(checks.find((c) => c.key === 'draft_persons')?.expected)
      .toBe(DRAFTGURU_EXPECTED.persons);
    expect(checks.find((c) => c.key === 'draft_picks')?.expected)
      .toBe(DRAFTGURU_EXPECTED.picks);
  });

  it('refuses an unrecognised measured key rather than silently ignoring it', () => {
    expect(() => finalValidationChecks(measuredRegister({ matches: 1, umpires: 700 })))
      .toThrow(RebuildRefused);
  });

  // AFLDB-ISSUE-095 D7. Until the ladder domain had a canonical contract, a non-zero
  // club_seasons gate would have failed every rebuild over a known, deliberate gap, so
  // the runbook forbade one. The table is now derived from the same accepted match set,
  // so its absence is a failure rather than an expected outcome.
  describe('club_seasons gates', () => {
    const checks = () => finalValidationChecks(measuredRegister({
      matches: 16838, seasons_first: 1897, seasons_last: 2025,
    }));
    const gate = (key: string) => checks().find((c) => c.key === key);

    it('requires the derived ladder to exist at all', () => {
      expect(gate('club_seasons_rows')?.expected).toBe(CLUB_SEASONS_EXPECTED.rows);
      expect(CLUB_SEASONS_EXPECTED.rows).toBe(1622);
    });

    it('proves the historical identity rather than forcing it', () => {
      // The derivation reads matches, which already carry the historical identity, so it
      // deliberately does NOT re-point through afldb_identity_for_season. This gate is
      // what turns that into a checked invariant instead of an assumption.
      const g = gate('club_seasons_identity_era_violations')!;
      expect(g.expected).toBe(0);
      expect(g.sql).toContain('afldb_identity_for_season');
      expect(g.sql).toContain('IS DISTINCT FROM');
    });

    it('awards no rank to an exact points-and-percentage tie', () => {
      // Zero in the accepted corpus, audited over all 1,622 rows. If a match correction
      // ever creates a tie, the rebuild must fail loudly rather than drop a position.
      const g = gate('club_seasons_unranked_rows')!;
      expect(g.expected).toBe(0);
      expect(g.sql).toContain('ladder_rank IS NULL');
    });

    it('keeps a merger navigable without transferring history', () => {
      expect(gate('club_seasons_brisbane_lions_first_season')?.expected).toBe(1997);
    });

    it('excludes the current season by the accepted baseline, not a hard-coded year', () => {
      expect(gate('club_seasons_after_accepted_last_season')?.sql).toContain('season > 2025');
      // Re-pointing the register must move this gate with it.
      const rolled = finalValidationChecks(measuredRegister({
        matches: 1, seasons_last: 2026,
      })).find((c) => c.key === 'club_seasons_after_accepted_last_season');
      expect(rolled?.sql).toContain('season > 2026');
    });

    it('renders every club_seasons gate into the executed stream', () => {
      const sql = finalValidationSql();
      for (const key of [
        'club_seasons_rows', 'club_seasons_identity_era_violations',
        'club_seasons_duplicate_identity_seasons', 'club_seasons_unranked_rows',
        'club_seasons_brisbane_lions_first_season',
        'club_seasons_after_accepted_last_season',
      ]) {
        expect(sql).toContain(key);
      }
    });
  });

  // AFLDB-ISSUE-111. The Coleman gate is added in the same change as the COLEMAN stage
  // and never before it: a gate whose data source does not yet exist would fail every
  // rebuild (the ISSUE-093 §H15.5 rule).
  describe('Coleman gates', () => {
    const checks = () => finalValidationChecks(measuredRegister({
      matches: 16838, seasons_first: 1897, seasons_last: 2025,
    }));
    const gate = (key: string) => checks().find((c) => c.key === key);

    it('takes the span from the tracked contract, not from this file', () => {
      const contract = JSON.parse(readFileSync(
        join(root, 'data', 'reference', 'coleman-derivation.json'), 'utf8'));
      expect(contract.first_season).toBe(1980);
      expect(colemanFirstSeason()).toBe(contract.first_season);
      expect(gate('coleman_first_season')?.expected).toBe(1980);
      // 1980..2025 inclusive.
      expect(gate('coleman_seasons')?.expected).toBe(46);
      expect(gate('coleman_rows')?.expected).toBe(46);
    });

    it('refuses rather than guessing when the contract declares no span', () => {
      expect(() => colemanFirstSeason(() => null)).toThrow(RebuildRefused);
      expect(() => colemanFirstSeason(() => ({}))).toThrow(RebuildRefused);
      expect(() => colemanFirstSeason(() => ({ first_season: '1980' })))
        .toThrow(RebuildRefused);
    });

    it('requires every derived winner to be linked', () => {
      const g = gate('coleman_unlinked_rows')!;
      expect(g.expected).toBe(0);
      expect(g.sql).toContain('player_id IS NULL');
    });

    it('catches a surviving legacy row before it becomes a duplicate family', () => {
      // The whole point of the one-time transition: an untransitioned draftguru row plus
      // a derived row is 92 Coleman rows, and neither uniqueness constraint stops it.
      const g = gate('coleman_rows_not_derived_from_afltables')!;
      expect(g.expected).toBe(0);
      expect(g.sql).toContain("key = 'afltables'");
      expect(gate('coleman_rows')?.expected).toBe(46);
    });

    it('rejects the surrogate-id key form the design ruled out', () => {
      // players.id is not canonical-rebuild-stable, so coleman:<season>:<players.id> is
      // exactly the key this derivation must never produce.
      const g = gate('coleman_rows_keyed_on_a_numeric_id')!;
      expect(g.expected).toBe(0);
      expect(g.sql).toContain('^coleman:[0-9]{4}:[0-9]+$');
    });

    it('excludes the current season by the accepted baseline, not a hard-coded year', () => {
      expect(gate('coleman_after_accepted_last_season')?.sql).toContain('season > 2025');
      const rolled = finalValidationChecks(measuredRegister({
        matches: 1, seasons_last: 2026,
      })).find((c) => c.key === 'coleman_after_accepted_last_season');
      expect(rolled?.sql).toContain('season > 2026');
    });

    it('moves the span with the contract rather than pinning 1980 in code', () => {
      const moved = colemanChecks(2025, 1990);
      expect(moved.find((c) => c.key === 'coleman_first_season')?.expected).toBe(1990);
      expect(moved.find((c) => c.key === 'coleman_seasons')?.expected).toBe(36);
    });

    it('renders every Coleman gate into the executed stream', () => {
      const sql = finalValidationSql();
      for (const key of [
        'coleman_rows', 'coleman_seasons', 'coleman_first_season',
        'coleman_unlinked_rows', 'coleman_rows_not_derived_from_afltables',
        'coleman_rows_keyed_on_a_numeric_id', 'coleman_after_accepted_last_season',
      ]) {
        expect(sql).toContain(key);
      }
    });
  });

  describe('awards & honours gates (AFLDB-ISSUE-112)', () => {
    const gate = (key: string) =>
      finalValidationChecks(measuredRegister({ matches: 1, seasons_last: 2025 }))
        .find((c) => c.key === key);

    it('gates every manifest family at its measured row count', () => {
      const e = AWARDS_HONOURS_EXPECTED;
      const expected: Record<string, number> = {
        honour_team_members_rows: e.honourTeamMembers,
        hall_of_fame_rows: e.hallOfFame,
        captaincies_rows: e.captaincies,
        rising_star_nomination_rows: e.risingStarNominations,
        rising_star_winner_rows: e.risingStarWinners,
        all_australian_rows: e.allAustralian,
        club_best_and_fairest_rows: e.clubBestAndFairest,
        named_medal_rows: e.namedMedals,
        under_22_rows: e.under22,
        award_definitions_rows: e.awardDefinitions,
      };
      for (const [key, value] of Object.entries(expected)) {
        expect(gate(key)?.expected, key).toBe(value);
      }
    });

    it('gates ROW counts, never link counts', () => {
      // A row whose player cannot be re-resolved loads present and unlinked
      // (AFLDB-ISSUE-112 §24.5). A linked-count gate here would turn that into
      // a rebuild failure and hide the row that actually needs a curator.
      for (const check of awardsHonoursChecks(2025)) {
        expect(check.sql).not.toContain('player_id IS NOT NULL');
      }
    });

    it('refuses an honours row with no provenance', () => {
      expect(gate('award_winners_without_a_source')?.expected).toBe(0);
    });

    it('excludes the current season by the accepted baseline, not a hard-coded year', () => {
      expect(gate('award_winners_after_accepted_last_season')?.sql)
        .toContain('season > 2025');
      expect(awardsHonoursChecks(2026)
        .find((c) => c.key === 'award_winners_after_accepted_last_season')?.sql)
        .toContain('season > 2026');
    });

    it('renders every awards gate into the executed stream', () => {
      const sql = finalValidationSql();
      for (const check of awardsHonoursChecks(2025)) {
        expect(sql).toContain(check.key);
      }
    });
  });

  describe('brownlow season gates (AFLDB-ISSUE-113)', () => {
    const manifest = JSON.parse(readFileSync(
      join(root, 'data', 'brownlow', 'season-votes.manifest.json'), 'utf8')) as {
        artefact: Record<string, number>;
      };
    const gate = (key: string) =>
      finalValidationChecks(measuredRegister({ matches: 1, seasons_last: 2025 }))
        .find((c) => c.key === key);

    it('reads its expected values from the tracked manifest, never a literal', () => {
      const e = brownlowSeasonExpected();
      expect(e).toEqual({
        rows: manifest.artefact.rows,
        votesTotal: manifest.artefact.votes_total,
        winners: manifest.artefact.winners,
        seasons: manifest.artefact.seasons,
        firstSeason: manifest.artefact.first_season,
        lastSeason: manifest.artefact.last_season,
      });
      // The measured recovery-source contract (§8.11), asserted here so a regenerated
      // artefact that silently shrank is caught before it is loaded anywhere.
      expect(e.rows).toBe(16_120);
      expect(e.votesTotal).toBe(79_113);
      expect(e.winners).toBe(112);
      expect(e.seasons).toBe(98);
      expect(e.firstSeason).toBe(1924);
      expect(e.lastSeason).toBe(2025);
    });

    it('gates rows, total votes, winners and season count at the manifest values', () => {
      const e = brownlowSeasonExpected();
      expect(gate('brownlow_season_rows')?.expected).toBe(e.rows);
      expect(gate('brownlow_season_votes_total')?.expected).toBe(e.votesTotal);
      expect(gate('brownlow_season_winners')?.expected).toBe(e.winners);
      expect(gate('brownlow_season_seasons')?.expected).toBe(e.seasons);
      expect(gate('brownlow_season_first_season')?.expected).toBe(e.firstSeason);
      expect(gate('brownlow_season_last_season')?.expected).toBe(e.lastSeason);
    });

    it('refuses rows with foreign provenance or a non-profile key', () => {
      expect(gate('brownlow_season_rows_not_sourced_from_afltables')?.expected).toBe(0);
      expect(gate('brownlow_season_rows_not_keyed_by_profile_path')?.sql)
        .toContain('^brownlow-season:[0-9]{4}:players/');
    });

    it('excludes the current season by the accepted baseline, not a hard-coded year', () => {
      expect(gate('brownlow_season_after_accepted_last_season')?.sql)
        .toContain('season > 2025');
      expect(brownlowSeasonChecks(2026)
        .find((c) => c.key === 'brownlow_season_after_accepted_last_season')?.sql)
        .toContain('season > 2026');
    });

    it('refuses a missing or malformed manifest rather than gating nothing', () => {
      expect(() => brownlowSeasonExpected(() => null)).toThrow(RebuildRefused);
      expect(() => brownlowSeasonExpected(() => ({ artefact: { rows: 'many' } })))
        .toThrow(RebuildRefused);
    });

    it('never touches the round-vote table', () => {
      for (const check of brownlowSeasonChecks(2025)) {
        expect(check.sql).not.toContain('brownlow_round_votes');
      }
    });

    it('renders every Brownlow season gate into the executed stream', () => {
      const sql = finalValidationSql();
      for (const check of brownlowSeasonChecks(2025)) {
        expect(sql).toContain(check.key);
      }
    });
  });

  it('refuses a baseline with no measured block rather than validating nothing', () => {
    expect(() => finalValidationChecks(register())).toThrow(RebuildRefused);
  });

  it('refuses a measured value that is not an integer', () => {
    expect(() => finalValidationChecks(measuredRegister({ matches: 'lots' })))
      .toThrow(RebuildRefused);
  });

  it('ends in a refusal, so a mismatch is a non-zero psql exit', () => {
    const sql = buildFinalValidationSql([
      { key: 'matches', sql: 'SELECT count(*) FROM matches', expected: 16838 },
    ]);
    expect(sql).toContain('RAISE EXCEPTION');
    expect(sql).toContain('IS DISTINCT FROM 16838::bigint');
    // every measured value is reported whether it passes or fails
    expect(sql).toContain(`${FINAL_VALIDATION_MARKER} matches = %`);
    // and all failures are collected, so one mismatch cannot hide the next
    expect(sql).toContain('array_to_string(failures');
  });

  it('is read-only: the stream can write nothing', () => {
    const sql = finalValidationSql();
    for (const verb of ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'TRUNCATE', 'ALTER',
                        'CREATE', 'GRANT', 'REVOKE', 'COPY']) {
      expect(sql.toUpperCase()).not.toContain(`${verb} `);
    }
  });

  it('never routes the validation stream through the destructive runner', () => {
    const { deps, sqlRuns, validationRuns } = fakeDeps();
    executeRebuild(planStages(target(), fitzroy(), OPTS), target(), deps);
    expect(sqlRuns).toHaveLength(1);
    expect(sqlRuns[0]).toBe(RESET_SQL);
    expect(validationRuns[0]).not.toBe(RESET_SQL);
  });

  it('relays the validation output on the SUCCESS path, not only on failure', () => {
    // RAISE WARNING goes to stderr; a passing run that dropped it would print a verdict
    // with no evidence behind it.
    const runner = runnerSource.slice(runnerSource.indexOf('runValidation: (dsn, sql)'));
    expect(runner.slice(0, 600)).toContain('process.stderr.write(result.stderr)');
  });

  it('carries no decorative, uncalled fingerprint export', () => {
    expect(runnerSource).not.toMatch(/^export const FINGERPRINT_QUERIES/m);
  });
});

describe('DraftGuru preflight', () => {
  const good = 'snapshot : x (42 year pages, sha256 verified)\n'
    + 'persons    : 5057\npicks      : 6810\n';

  it('accepts the accepted Stage A counts', () => {
    expect(() => assertDraftguruPreflight(good)).not.toThrow();
    expect(DRAFTGURU_EXPECTED).toEqual({ yearPages: 42, persons: 5057, picks: 6810 });
  });

  it('refuses a wrong population before anything is destroyed', () => {
    expect(() => assertDraftguruPreflight(good.replace('5057', '5056')))
      .toThrow(/5057 persons.*Nothing has been destroyed/s);
    expect(() => assertDraftguruPreflight(good.replace('6810', '6809')))
      .toThrow(/6810 picks/);
    expect(() => assertDraftguruPreflight(good.replace('42 year pages', '41 year pages')))
      .toThrow(/42 year pages/);
  });

  it('validates with no database and no legacy source', () => {
    expect(draftguruValidateArgv(OPTS.draftguruLabel)).toContain('--validate-only');
    expect(draftguruValidateArgv(OPTS.draftguruLabel).join(' '))
      .toContain('tools/rebuild/draftguru/import_draftguru.py');
  });

  it('stops before destruction when a tracked input is missing', () => {
    const { deps } = fakeDeps();
    const missing: Deps = { ...deps, fileExists: (p) => !p.includes('link-decisions') };
    expect(() => runPreflight(missing, OPTS))
      .toThrow(/draftguru-link-decisions\.json.*Nothing has been destroyed/s);
  });

  it('stops before destruction when importer validation fails', () => {
    const { deps } = fakeDeps();
    const failing: Deps = {
      ...deps,
      runCommand: () => ({ status: 1, stdout: '', stderr: 'REFUSED' }),
    };
    expect(() => runPreflight(failing, OPTS)).toThrow(/Nothing has been destroyed/);
  });
});

/*
 * AFLDB-ISSUE-112 §28.4 — the DraftGuru preflight/data label contract.
 *
 * The defect: draftguruValidateArgv() took no label and emitted only --validate-only, so
 * import_draftguru.py fell back to its own hardcoded STAGE_A_LABEL while the data stage
 * imported whatever --draftguru-label selected. It only failed closed because the retired
 * snapshot's bytes were absent; with both snapshot directories on disk the rebuild would
 * have verified one snapshot and imported another, and then destroyed afldb_test.
 *
 * These tests hold the two sides to ONE selection.
 */
describe('DraftGuru preflight validates the label the data stage will import', () => {
  const NEW_LABEL = 'annual-html-20260902';
  const DRAFTGURU_OK = 'snapshot : x (42 year pages, sha256 verified)\n'
    + 'persons    : 5057\npicks      : 6810\n';

  /** Runs a real preflight and returns the DraftGuru argv it actually emitted. */
  function preflightDraftguruArgv(opts: { draftguruLabel: string; planOnly: boolean }) {
    const seen: string[][] = [];
    const deps: Deps = {
      ...fakeDeps().deps,
      runCommand: (argv) => {
        seen.push(argv);
        return { status: 0, stdout: DRAFTGURU_OK, stderr: '' };
      },
    };
    runPreflight(deps, opts);
    const argv = seen.find((a) => a.includes(DRAFTGURU_IMPORTER));
    expect(argv, 'preflight ran no DraftGuru validation at all').toBeDefined();
    return argv!;
  }

  it('propagates --draftguru-label through to the preflight validator', () => {
    const opts = parseRebuildArgs(['--draftguru-label', NEW_LABEL,
                            '--acknowledge-destroy', 'afldb_test']);
    expect(opts.draftguruLabel).toBe(NEW_LABEL);

    const argv = preflightDraftguruArgv(opts);
    expect(argv).toContain('--validate-only');
    expect(argv).toContain('--label');
    expect(argv[argv.indexOf('--label') + 1]).toBe(NEW_LABEL);
    // The exact regression: a label-less preflight lets import_draftguru.py fall back to
    // its own STAGE_A_LABEL default, which is a DIFFERENT snapshot.
    expect(argv.join(' ')).not.toBe(
      `${resolvePython()} ${DRAFTGURU_IMPORTER} --validate-only`);
  });

  it('gives the data stage the same label the preflight proved', () => {
    const opts = parseRebuildArgs(['--draftguru-label', NEW_LABEL]);
    const stage = planStages(target(), fitzroy(), opts).find((s) => s.id === 'draftguru')!;
    expect(stage.argv).toContain('--label');
    expect(stage.argv![stage.argv!.indexOf('--label') + 1]).toBe(NEW_LABEL);
    expect(stage.name).toContain(NEW_LABEL);

    // and the two argvs are the SAME selection, not two equal strings by luck
    expect(preflightDraftguruArgv(opts)).toEqual([...stage.argv!, '--validate-only']);
  });

  it('makes preflight/data label equality contractual, for any label', () => {
    // Structural, not incidental: the validator argv is BUILT from the import argv, so no
    // future label can be selected for one side and not the other.
    for (const label of [NEW_LABEL, 'annual-html-20260826', 'annual-html-29991231']) {
      const opts = { draftguruLabel: label, planOnly: false };
      const stage = planStages(target(), fitzroy(), opts).find((s) => s.id === 'draftguru')!;
      expect(draftguruImportArgv(label)).toEqual(stage.argv);
      expect(draftguruValidateArgv(label))
        .toEqual([...draftguruImportArgv(label), '--validate-only']);
      expect(preflightDraftguruArgv(opts)).toEqual([...stage.argv!, '--validate-only']);
    }
  });

  it('keeps the default label correct, and identical on both sides, with no override', () => {
    const opts = parseRebuildArgs([]);
    expect(opts.draftguruLabel).toBe(DEFAULT_DRAFTGURU_LABEL);
    const stage = planStages(target(), fitzroy(), opts).find((s) => s.id === 'draftguru')!;
    expect(stage.argv![stage.argv!.indexOf('--label') + 1]).toBe(DEFAULT_DRAFTGURU_LABEL);
    expect(preflightDraftguruArgv(opts)).toEqual([...stage.argv!, '--validate-only']);
  });

  it('destroys nothing when the SELECTED snapshot fails validation', () => {
    // The live failure this fix exists for: the selected snapshot's bytes are absent, so
    // the importer refuses. Nothing may be reset, and the refusal must name the label that
    // was actually proven.
    const sqlRuns: string[] = [];
    const deps: Deps = {
      ...fakeDeps().deps,
      runCommand: (argv) => (argv.includes(NEW_LABEL)
        ? { status: 1,
            stdout: `REFUSED: snapshot directory not found: ${NEW_LABEL}`,
            stderr: '' }
        : { status: 0, stdout: DRAFTGURU_OK, stderr: '' }),
      runSql: (_dsn, sql) => { sqlRuns.push(sql); },
    };
    const opts = { draftguruLabel: NEW_LABEL, planOnly: false };
    expect(() => runPreflight(deps, opts)).toThrow(RebuildRefused);
    expect(() => runPreflight(deps, opts)).toThrow(new RegExp(NEW_LABEL));
    expect(() => runPreflight(deps, opts)).toThrow(/Nothing has been destroyed/);
    expect(sqlRuns).toEqual([]);
    expect(sqlRuns.join('')).not.toContain(RESET_SQL.slice(0, 24));

    // ...and the runner still sequences preflight ahead of BOTH the destructive
    // acknowledgement and executeRebuild, so no RESET can precede this refusal.
    const runner = readFileSync(join(root, 'tools', 'db', 'rebuild-test.ts'), 'utf8');
    expect(runner).toMatch(
      /runPreflight\(deps, opts, fitzroy\);[\s\S]*assertDestructiveAcknowledgement[\s\S]*executeRebuild\(/);
  });
});

describe('failure semantics — first failure stops everything', () => {
  const stages = planStages(target(), fitzroy(), OPTS);

  it('runs every stage once, in order, on success', () => {
    const { deps, commands } = fakeDeps();
    const report = executeRebuild(stages, target(), deps);
    expect(report.ok).toBe(true);
    expect(report.executed).toEqual(idsOf(stages));
    // one invocation per command stage, no repeats
    expect(commands).toHaveLength(stages.filter((s) => s.run === 'command').length);
  });

  it('migration failure prevents everything later', () => {
    const { deps } = fakeDeps('db:migrate:test');
    const report = executeRebuild(stages, target(), deps);
    expect(report.ok).toBe(false);
    expect(report.failedStage).toBe('migrations');
    for (const later of ['privileges', 'reference', 'fitzroy', 'draftguru', 'derived']) {
      expect(report.executed).not.toContain(later);
    }
  });

  it('privilege failure prevents every data load', () => {
    const { deps } = fakeDeps('db:privileges:test');
    const report = executeRebuild(stages, target(), deps);
    expect(report.failedStage).toBe('privileges');
    expect(report.executed).not.toContain('reference');
  });

  it('reference failure prevents fitzRoy', () => {
    const { deps } = fakeDeps('load_reference_data.py');
    const report = executeRebuild(stages, target(), deps);
    expect(report.failedStage).toBe('reference');
    expect(report.executed).not.toContain('fitzroy');
  });

  it('fitzRoy failure means DraftGuru never runs', () => {
    const { deps, commands } = fakeDeps('import_fitzroy_core.py');
    const report = executeRebuild(stages, target(), deps);
    expect(report.failedStage).toBe('fitzroy');
    expect(report.executed).not.toContain('draftguru');
    expect(commands.some((c) => c.join(' ').includes('import_draftguru.py'))).toBe(false);
  });

  it('DraftGuru failure means derived never runs', () => {
    const { deps } = fakeDeps('import_draftguru.py');
    const report = executeRebuild(stages, target(), deps);
    expect(report.failedStage).toBe('draftguru');
    expect(report.executed).not.toContain('derived');
    expect(report.executed).not.toContain('fingerprints');
  });

  it('derived failure prevents the success report', () => {
    const { deps } = fakeDeps('rebuild_derived.py');
    const report = executeRebuild(stages, target(), deps);
    expect(report.ok).toBe(false);
    expect(report.executed).not.toContain('fingerprints');
  });

  it('never swallows a non-zero exit code', () => {
    const { deps } = fakeDeps('import_draftguru.py');
    expect(executeRebuild(stages, target(), deps).ok).toBe(false);
  });
});

describe('reset semantics', () => {
  it('is a real clean slate, not a truncation', () => {
    expect(RESET_SQL).toContain('DROP TABLE IF EXISTS public.%I CASCADE');
    expect(RESET_SQL).toContain('DROP SCHEMA IF EXISTS %I CASCADE');
    expect(RESET_SQL).toContain('DROP ROUTINE IF EXISTS');
    expect(RESET_SQL).toContain('DROP TYPE IF EXISTS');
    expect(RESET_SQL).not.toMatch(/\bTRUNCATE\b/);
  });

  it('preserves extensions, as restore-test.sh does', () => {
    // pg_trgm and unaccent live in public and are owned by another role
    expect(RESET_SQL).not.toContain('DROP SCHEMA IF EXISTS public');
    expect(RESET_SQL).toContain("deptype = 'e'");
    expect(RESET_SQL).not.toMatch(/DROP EXTENSION/);
  });

  it('guards EVERY drop loop with extension membership', () => {
    // One guard for the schema loop, one for each of the three pg_class loops (tables,
    // views/matviews, sequences/foreign tables), one for routines, one for types.
    const loops = RESET_SQL.split('DO $$').filter((block) => block.includes('EXECUTE'));
    expect(loops).toHaveLength(6);
    for (const loop of loops) expect(loop).toContain("deptype = 'e'");
  });

  it('excludes the internal pg_ schemas with a pattern that survives both escapings', () => {
    // Regression. The earlier form was `NOT LIKE 'pg\\_%'` in a JS template literal, which
    // reaches the server as LIKE 'pg\\_%' — a pattern matching "pg<backslash><any char>",
    // so NOTHING was excluded and DROP SCHEMA pg_toast would have aborted the reset on the
    // very first loop. A regex has no escape to lose.
    expect(RESET_SQL).toContain("n.nspname !~ '^pg_'");
    expect(RESET_SQL).not.toMatch(/NOT LIKE 'pg/);
    expect(RESET_SQL).not.toContain('\\_');
  });

  it('drops every relation class the migrations can create', () => {
    // 72 CREATE TABLE, 16 CREATE VIEW, 13 CREATE TYPE, 10 CREATE FUNCTION, 4 CREATE SCHEMA
    // across src/db/migrations, plus the sequences serial/identity columns bring with them.
    expect(RESET_SQL).toContain("c.relkind IN ('r', 'p')");        // tables + partitioned
    expect(RESET_SQL).toContain("c.relkind IN ('v', 'm')");        // views + matviews
    expect(RESET_SQL).toContain("c.relkind IN ('S', 'f')");        // sequences + foreign
    expect(RESET_SQL).toContain("WHEN 'S' THEN 'SEQUENCE'");
    expect(RESET_SQL).toContain("'FOREIGN TABLE'");
    expect(RESET_SQL).toContain("WHEN 'm' THEN 'MATERIALIZED VIEW'");
  });

  it('uses only transactionally reversible statements', () => {
    // The rollback-only proof depends on this. Anything here that could not participate in
    // a transaction would make the proof meaningless rather than merely incomplete.
    expect(RESET_SQL).not.toMatch(/CONCURRENTLY/i);
    expect(RESET_SQL).not.toMatch(/DROP\s+DATABASE/i);
    expect(RESET_SQL).not.toMatch(/DROP\s+TABLESPACE/i);
    expect(RESET_SQL).not.toMatch(/\bVACUUM\b/i);
    expect(RESET_SQL).not.toMatch(/\bCOMMIT\b/i);
    expect(RESET_SQL).not.toMatch(/ALTER\s+SYSTEM/i);
  });

  it('actually sends the SQL to the server', () => {
    // Regression. runSql used to be `void client.unsafe(sql)`; postgres.js Query objects
    // only execute when .then/.catch/.finally/.execute() is called, so the reset was never
    // sent and the destructive stage reported success against an untouched database.
    // Anchored to the start of a line so the comment recording the defect does not count.
    expect(runnerSource).not.toMatch(/^\s*void client\.unsafe/m);
    // The invocation itself lives in the shared helper both this and the proof use.
    expect(runnerSource).toContain('runPsql(dsn, sql');
    expect(runnerSource).toContain("from './psql'");
  });
});

/*
 * AFLDB-ISSUE-093 §20 — the ROLLBACK-ONLY RESET_SQL proof.
 *
 * Two things must be proven here and cannot be left to the live run: the proof cannot
 * commit, and it exercises the SAME psql execution path the destructive rebuild uses.
 * Both are proven behaviourally, against a fake psql and a fake catalog.
 */
describe('reset proof', () => {
  const proofSource = readFileSync(join(root, 'tools', 'db', 'prove-reset.ts'), 'utf8');
  const proofCode = proofSource.slice(proofSource.indexOf('*/') + 2);
  const psqlSource = readFileSync(join(root, 'tools', 'db', 'psql.ts'), 'utf8');

  /** A catalog shaped like afldb_test: two extensions, some application objects. */
  function catalog(overrides: Partial<Record<string, string[]>> = {}) {
    const base: Record<string, string[]> = {
      schemas: ['public|afldb_owner|', 'staging|afldb_owner|', 'afldb_meta|afldb_owner|'],
      relations: ['public.players|r|p|afldb_owner|{afldb_owner=arwd/afldb_owner}'],
      columns: ['public.players|1|player_id|23|-1|true|true||'],
      indexes: ['public.players|players_pkey|true|true|1'],
      constraints: ['public|players_pkey|p|players|{1}'],
      routines: ['public.similarity|25 25|f|postgres|',
        'public.afldb_normalise_name|25|f|afldb_owner|'],
      types: ['public.link_status|e|afldb_owner', 'public.gtrgm|b|postgres'],
      enum_values: ['public.link_status|1|pending'],
      sequences: ['public.players_player_id_seq|1|1|1|9223372036854775807'],
      extensions: ['pg_trgm|1.6|public|postgres', 'unaccent|1.1|public|postgres'],
      extension_members: ['1255:16400:0:16399', '1247:16401:0:16399'],
      default_acls: ['afldb_owner|public|r|{afldb_app=r/afldb_owner}'],
      migrations: ['present|66|066_audit'],
    };
    return { ...base, ...overrides };
  }

  const CLEAN_CENSUS = {
    schemas: 0, tables: 0, views: 0, sequences: 0, foreign_tables: 0,
    routines: 0, types: 0, public_schemas: 1, migrations: 'f',
  };

  /** Build the stderr a passing psql run produces: WARNING markers, then the abort. */
  function psqlStderr(options: {
    census?: Partial<typeof CLEAN_CENSUS>;
    before?: Record<string, number>;
    omitMarker?: string;
    sentinel?: boolean;
    markerSet?: string;
    markerAfter?: string;
  } = {}) {
    const census = { ...CLEAN_CENSUS, ...options.census };
    const before = { schemas: 3, relations: 1, extensions: 2, extension_members: 2,
      ...options.before };
    const lines: [string, string][] = [
      ['received', 'stream=begins'],
      ['trap', 'armed=2 rows'],
      ['identity', 'database=afldb_test current_user=afldb_owner session_user=afldb_owner'],
      ['sessions', 'others=0'],
      ['before', `schemas=${before.schemas} relations=${before.relations} `
        + `extensions=${before.extensions} extension_members=${before.extension_members}`],
      ['marker_set', options.markerSet ?? 'status=ok'],
      ['census', Object.entries(census).map(([k, v]) => `${k}=${v}`).join(' ')],
      ['marker_after', options.markerAfter ?? 'status=ok'],
      ['extensions', 'preserved=2 members=2'],
    ];
    const out = lines
      .filter(([kind]) => kind !== options.omitMarker)
      .map(([kind, body]) => `WARNING:  ${PROOF_MARKER} ${kind} ${body}`);
    if (options.sentinel !== false) {
      out.push(`ERROR:  ${PROOF_ROLLBACK_SENTINEL}: every assertion passed; aborting`);
    }
    return `${out.join('\n')}\n`;
  }

  type FakeOptions = {
    identity?: Partial<Identity>;
    sessions?: SessionRow[];
    catalogAfter?: Record<string, string[]>;
    psql?: { status?: number; stdout?: string; stderr?: string };
    psqlThrows?: Error;
    psqlUnreachable?: Error;
    stderr?: Parameters<typeof psqlStderr>[0];
    /** P-M point 2. `post` defaults to `pre` — a correctly-restored comment. */
    comment?: { pre?: string | null; post?: string | null };
  };

  function fake(options: FakeOptions = {}) {
    const state = {
      catalog: catalog(),
      psqlStreams: [] as string[],
      psqlProbed: false,
      resetRan: false,
      openSessions: 0,
      sessionsOpened: [] as number[],
      openWhenProbed: [] as number[],
      openWhenPsqlRan: [] as number[],
      timeline: [] as string[],
    };

    const answer = (sql: string): Row[] => {
      if (sql === IDENTITY_SQL) {
        return [{
          database: 'afldb_test', role_name: 'afldb_owner',
          session_role_name: 'afldb_owner', role_is_superuser: false,
          session_is_superuser: false, server_addr: '127.0.0.1', server_port: '5432',
          server_version: '16.4', ...options.identity,
        }];
      }
      if (sql === OTHER_SESSIONS_SQL) return options.sessions ?? [];
      if (sql === MIGRATION_TABLE_SQL) {
        return [{ present: !(state.catalog.migrations ?? []).includes('absent') }];
      }
      if (sql === MIGRATION_STATE_SQL) {
        return [{ k: (state.catalog.migrations ?? [''])[0].replace('present|', '') }];
      }
      if (sql === HEALTH_SQL) {
        return [{ database: 'afldb_test', relations: 120, extensions: 2 }];
      }
      if (sql === DATABASE_COMMENT_SQL) {
        const pre = options.comment?.pre ?? null;
        const post = options.comment?.post ?? pre;
        return [{ comment: state.resetRan ? post : pre }];
      }
      const section = FINGERPRINT_SECTIONS.find((s) => s.sql === sql);
      if (section) return (state.catalog[section.id] ?? []).map((k) => ({ k }));
      // RESET_SQL must NEVER arrive here: it belongs on the psql path.
      throw new Error(`fake database: unexpected statement on the read-only path\n${sql}`);
    };

    const deps: ProofDeps = {
      dsnDatabase: 'afldb_test',
      log: () => {},
      // Records the whole session lifecycle so a connection spanning the psql run is
      // visible to the tests rather than only to PostgreSQL.
      withSession: async (fn) => {
        const id = state.sessionsOpened.length + 1;
        state.sessionsOpened.push(id);
        state.timeline.push(`open:${id}`);
        state.openSessions += 1;
        try {
          return await fn(async (sql) => answer(sql));
        } finally {
          state.openSessions -= 1;
          state.timeline.push(`close:${id}`);
        }
      },
      assertPsqlReachable: () => {
        if (options.psqlUnreachable) throw options.psqlUnreachable;
        state.psqlProbed = true;
        state.timeline.push(`probe(open=${state.openSessions})`);
        state.openWhenProbed.push(state.openSessions);
      },
      runPsql: (sql) => {
        if (options.psqlThrows) throw options.psqlThrows;
        state.timeline.push(`psql(open=${state.openSessions})`);
        state.openWhenPsqlRan.push(state.openSessions);
        state.psqlStreams.push(sql);
        state.resetRan = sql.includes(RESET_SQL.trim());
        // A rolled-back reset leaves the catalog as it was, unless a test says otherwise.
        state.catalog = options.catalogAfter ?? catalog();
        return {
          status: options.psql?.status ?? 3,
          stdout: options.psql?.stdout ?? '',
          stderr: options.psql?.stderr ?? psqlStderr(options.stderr),
        };
      },
    };
    return { deps, state };
  }

  describe('execution-path parity with the real rebuild', () => {
    it('builds the psql argv in exactly one place', () => {
      // The gap this stage exists to close: a proof that ran RESET_SQL through a different
      // mechanism would prove the SQL and leave the mechanism untested.
      expect(runnerSource).toContain("from './psql'");
      expect(proofCode).toContain("from './psql'");
      // Neither caller builds its own argument vector. `psqlArgv` is the only place the
      // flags are assembled, so the two paths cannot drift apart.
      for (const source of [runnerSource, proofCode]) {
        expect(source).not.toMatch(/'-v',\s*'ON_ERROR_STOP=1'/);
        expect(source).not.toMatch(/psql'\s*,\s*\[/);
      }
      expect(psqlSource).toMatch(/'-v',\s*'ON_ERROR_STOP=1'/);
      expect(psqlSource).toContain('--single-transaction');
      expect((psqlSource.match(/export function psqlArgv/g) ?? [])).toHaveLength(1);
    });

    it('keeps ON_ERROR_STOP and single-transaction on the one shared argv', () => {
      const argv = psqlArgv('postgres://u:p@h:5432/afldb_test');
      expect(argv).toContain('-v');
      expect(argv).toContain('ON_ERROR_STOP=1');
      expect(argv).toContain('--single-transaction');
      expect(argv).toContain('-f');
      expect(argv[argv.length - 1]).toBe('-');
    });

    it('hands the real rebuild and the proof byte-identical psql invocations', () => {
      const dsn = 'postgres://afldb_owner:pw@h:5432/afldb_test';
      const calls: { bin: string; argv: string[]; input: string }[] = [];
      const spawn: SpawnSyncLike = (bin, argv, opts) => {
        calls.push({ bin, argv, input: opts.input });
        return { status: 0, stdout: '', stderr: '' };
      };

      // The real rebuild's destructive stage...
      const { deps } = fakeDeps();
      deps.runSql = (d, sql) => { runPsql(d, sql, { spawn }); };
      executeRebuild(planStages(target(), fitzroy(), OPTS), target({ adminDsn: dsn }), deps);
      // ...and the proof.
      runPsql(dsn, buildProofSql(), { spawn });

      expect(calls).toHaveLength(2);
      expect(calls[0].bin).toBe(calls[1].bin);
      expect(calls[0].bin).toBe(PSQL_BIN);
      expect(calls[0].argv).toEqual(calls[1].argv);
      // The one intended difference is the stream, not the mechanism.
      expect(calls[0].input).not.toBe(calls[1].input);

      // THE PAYLOAD, not just the argv. The 2026-08-27 live failure was a psql that exited
      // 0 having (apparently) not run the stream, and this test could not have caught it:
      // it recorded `input` and then only asserted the two differed.
      expect(calls[0].input).toBe(RESET_SQL);                    // real reset: raw body
      expect(calls[1].input).toContain(RESET_SQL.trim());        // proof: wraps it verbatim
      expect(calls[1].input).toContain(PROOF_ROLLBACK_SENTINEL); // ...and always aborts
      for (const call of calls) expect(call.input.trim().length).toBeGreaterThan(0);
    });

    it('passes the exact SQL bytes through to psql stdin', () => {
      const seen: { input: unknown; argv: string[] }[] = [];
      const spawn: SpawnSyncLike = (_bin, argv, opts) => {
        seen.push({ input: opts.input, argv });
        return { status: 0, stdout: '', stderr: '' };
      };
      const payload = "SELECT 'exact ✓ bytes', $$dollar quoted$$;\n-- trailing comment\n";
      runPsql('postgres://u:p@h:5432/afldb_test', payload, { spawn });

      // `input` must be PRESENT, a string, and byte-identical — spawnSync silently sends
      // nothing at all if `input` is missing or undefined.
      expect(seen).toHaveLength(1);
      expect(seen[0].input).toBeTypeOf('string');
      expect(seen[0].input).toBe(payload);
      expect(seen[0].input).not.toBe('');
      expect(seen[0].input).not.toBeUndefined();
    });

    it('tells psql to read that stdin, with `-f -` exactly once', () => {
      const argv = psqlArgv('postgres://u:p@h:5432/afldb_test');
      expect(argv.filter((a) => a === '-f')).toHaveLength(1);
      expect(argv[argv.indexOf('-f') + 1]).toBe('-');
      expect(argv.filter((a) => a === '-')).toHaveLength(1);
      expect(argv).not.toContain('-c');           // -c would supersede the stdin script
    });

    it('passes the DSN as an OPTION, never as a positional operand', () => {
      // The 2026-08-27 incident's leading explanation. psql is `[OPTION]... [DBNAME
      // [USERNAME]]`, and PostgreSQL's own src/port/getopt_long.c — used wherever the
      // system getopt_long is absent, Windows included — STOPS at the first non-option and
      // does not permute. With the DSN leading, `--single-transaction` and ON_ERROR_STOP
      // could be swallowed as operands, leaving psql to autocommit each statement and exit
      // 0 regardless of errors: exactly what was observed.
      const dsn = 'postgres://u:p@h:5432/afldb_test';
      const argv = psqlArgv(dsn);
      expect(argv[0]).toBe('-d');
      expect(argv[1]).toBe(dsn);
      expect(argv[0].startsWith('-')).toBe(true);

      // No element is a positional operand: everything is a flag or a flag's value.
      const valueTaking = new Set(['-d', '-v', '-f']);
      const positionals: string[] = [];
      for (let i = 0; i < argv.length; i += 1) {
        if (argv[i].startsWith('-') && argv[i] !== '-') {
          if (valueTaking.has(argv[i])) i += 1;   // skip the flag's value
          continue;
        }
        if (argv[i] === '-' && argv[i - 1] === '-f') continue;
        positionals.push(argv[i]);
      }
      expect(positionals).toEqual([]);
    });

    it('keeps the repository\'s other psql callers off the same hazard', () => {
      // The privileges runner moved out of the package scripts and into
      // tools/db/privileges.ts (§H11 F1): the scripts interpolated the DSN with a POSIX
      // `"$VAR"`, which npm on Windows hands to cmd.exe unexpanded, so psql received the
      // literal string as a database name. The getopt invariant this test exists for is
      // unchanged and is now asserted where the argv is actually built.
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      const privilegeScripts = {
        'db:privileges': 'dev',
        'db:privileges:test': 'test',
        'db:privileges:code-test': 'code-test', // AFLDB-ISSUE-146
      };
      for (const [script, expectedTarget] of Object.entries(privilegeScripts)) {
        const command: string = pkg.scripts[script];
        expect(command, `${script} must not build a psql argv in the shell`)
          .toBe(`tsx tools/db/privileges.ts --target ${expectedTarget}`);
        expect(command, `${script} must not depend on shell expansion`)
          .not.toContain('$');
      }

      const source = readFileSync(join(root, 'tools', 'db', 'privileges.ts'), 'utf8');
      const argv = source.match(/const argv = \[([^\]]*)\]/)![1]
        .split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
      expect(argv[0], 'the DSN must never lead the argv').toMatch(/^-/);
      expect(argv).toContain('ON_ERROR_STOP=1');
      // The DSN is a `-d` OPTION value, never a positional operand.
      expect(argv[argv.indexOf('dsn') - 1] ?? argv[argv.length - 2]).toBe('-d');
      expect(source).toContain('ON_ERROR_STOP=1');
    });

    it('resolves the privileges DSN in Node, so no shell can mis-target it', () => {
      const source = readFileSync(join(root, 'tools', 'db', 'privileges.ts'), 'utf8');
      // Explicitly named targets, exactly as migrate.ts does — never a guessed default DSN.
      expect(source).toContain('AFLDB_OWNER_DATABASE_URL');
      expect(source).toContain('AFLDB_TEST_DATABASE_URL');
      // AFLDB-ISSUE-146: the rehearsal target is bound to its OWN variable, never test's.
      expect(source).toMatch(/'code-test': 'AFLDB_CODE_TEST_DATABASE_URL'/);
      // and it never prints what it resolved
      expect(source).not.toMatch(/console\.(log|error)\([^)]*\bdsn\b/);
    });

    it('sets the migration target without a POSIX shell assignment', () => {
      // `AFLDB_MIGRATE_TARGET=test tsx …` fails outright under cmd.exe, which is the shell
      // npm uses for package scripts on Windows — and MIGRATIONS is the stage immediately
      // after the destructive reset (§H11 F1).
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      expect(pkg.scripts['db:migrate:test']).toBe('tsx tools/db/migrate.ts --target test');
      // AFLDB-ISSUE-146: the rehearsal's migrations go through the same explicit-target
      // path, bound to the rehearsal's own variable and exempt from the shared-ledger guard
      // exactly as `test` is (both are wiped and rebuilt from nothing).
      expect(pkg.scripts['db:migrate:code-test']).toBe('tsx tools/db/migrate.ts --target code-test');
      const source = readFileSync(join(root, 'tools', 'db', 'migrate.ts'), 'utf8');
      expect(source).toMatch(/'code-test': 'AFLDB_CODE_TEST_DATABASE_URL'/);
      expect(source).toMatch(/DISPOSABLE_TARGETS: readonly Target\[\] = \['test', 'code-test'\]/);
      expect(source).not.toMatch(/target === 'test'\) return/);
      // The environment variable stays supported, and a disagreement is a refusal rather
      // than a silent preference for one over the other.
      expect(source).toContain('AFLDB_MIGRATE_TARGET');
      expect(source).toContain('disagree');
    });

    it('sends RESET_SQL down the psql path, never through postgres.js', async () => {
      // The fake read-only query throws on anything that is not a catalog SELECT, so if
      // RESET_SQL ever reached it this test fails rather than silently passing.
      const { deps, state } = fake();
      await runResetProof(deps);
      expect(state.psqlStreams).toHaveLength(1);
      expect(state.psqlStreams[0]).toContain(RESET_SQL.trim());
      expect(state.resetRan).toBe(true);
    });

    it('embeds RESET_SQL verbatim rather than a re-worded copy', () => {
      expect(buildProofSql()).toContain(RESET_SQL.trim());
      expect(proofCode).not.toMatch(/const\s+RESET_SQL\s*=/);
      expect(proofCode).toContain('import { RESET_SQL');
    });
  });

  describe('psql availability', () => {
    const dsn = 'postgres://afldb_owner:pw@h:5432/afldb_test';

    it('reports a launch failure as a refusal, naming psql', () => {
      const spawn: SpawnSyncLike = () => ({
        status: null, stdout: null, stderr: null,
        error: Object.assign(new Error('spawnSync psql ENOENT'), { code: 'ENOENT' }),
      });
      expect(() => runPsql(dsn, 'SELECT 1;', { spawn })).toThrow(PsqlUnavailable);
      expect(() => assertPsqlReachable(dsn, { spawn })).toThrow(/must be on PATH/);
    });

    it('refuses when psql runs but cannot reach the database', () => {
      const spawn: SpawnSyncLike = () => ({
        status: 2, stdout: '', stderr: 'psql: error: connection to server failed',
      });
      expect(() => assertPsqlReachable(dsn, { spawn })).toThrow(/did NOT execute the SQL/);
    });

    it('DETECTS a psql that exits 0 without executing its stdin', () => {
      // The 2026-08-27 live failure mode, and the reason the old probe was worthless: it
      // ran `SELECT 1` and accepted exit 0, which an empty or discarded stdin also gives.
      const spawn: SpawnSyncLike = () => ({ status: 0, stdout: '', stderr: '' });
      expect(() => assertPsqlReachable(dsn, { spawn }))
        .toThrow(/did NOT execute the SQL supplied on its stdin/);
      expect(() => assertPsqlReachable(dsn, { spawn })).toThrow(/nothing at all/);
    });

    it('DETECTS a path where ON_ERROR_STOP is not in force', () => {
      // The stream ran (token came back) but the deliberate exception still exited 0, so a
      // failed reset would be reported as a success.
      const spawn: SpawnSyncLike = () => ({
        status: 0, stdout: '', stderr: `WARNING:  ${PSQL_PROBE_OK}\nERROR: ${PSQL_PROBE_ABORT}`,
      });
      expect(() => assertPsqlReachable(dsn, { spawn }))
        .toThrow(/ON_ERROR_STOP is not in force/);
    });

    it('DETECTS diagnostics that never reach this process', () => {
      const spawn: SpawnSyncLike = () => ({
        status: 3, stdout: '', stderr: `WARNING:  ${PSQL_PROBE_OK}`,
      });
      expect(() => assertPsqlReachable(dsn, { spawn }))
        .toThrow(/never reported the probe's deliberate error/);
    });

    it('accepts only a path that delivered stdin AND surfaced the error', () => {
      const spawn: SpawnSyncLike = () => ({
        status: 3, stdout: '',
        stderr: `WARNING:  ${PSQL_PROBE_OK}\npsql:<stdin>:5: ERROR:  ${PSQL_PROBE_ABORT}`,
      });
      expect(() => assertPsqlReachable(dsn, { spawn })).not.toThrow();
    });

    it('probes through the reset\'s own argv, so the whole path is proven', () => {
      const calls: { argv: string[]; input: string }[] = [];
      const spawn: SpawnSyncLike = (_bin, argv, opts) => {
        calls.push({ argv, input: opts.input });
        return {
          status: 3, stdout: '',
          stderr: `WARNING: ${PSQL_PROBE_OK}\nERROR: ${PSQL_PROBE_ABORT}`,
        };
      };
      assertPsqlReachable(dsn, { spawn });
      expect(calls[0].argv).toEqual(psqlArgv(dsn));
      expect(calls[0].input).toBe(PSQL_PROBE_SQL);
      // Read-only: the probe touches no application object.
      expect(PSQL_PROBE_SQL).not.toMatch(/\b(DROP|CREATE|ALTER|INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    });

    it('fails closed BEFORE the reset when psql is unavailable', async () => {
      const { deps, state } = fake({
        psqlUnreachable: new PsqlUnavailable("Could not run 'psql': ENOENT"),
      });
      await expect(runResetProof(deps)).rejects.toThrow(/Could not run 'psql'/);
      expect(state.psqlStreams).toHaveLength(0);
      expect(state.resetRan).toBe(false);
    });

    it('runs the probe only after the observation session has closed', async () => {
      const { deps, state } = fake();
      await runResetProof(deps);
      expect(state.openWhenProbed).toEqual([0]);
      expect(state.timeline.indexOf('close:1'))
        .toBeLessThan(state.timeline.findIndex((e) => e.startsWith('probe')));
    });
  });

  describe('connection lifecycle — no observer may span the psql run', () => {
    /*
     * 2026-08-27, reproduced twice: the proof refused with "1 other client session(s)
     * connected to afldb_test" while a plain psql check moments earlier saw none, and the
     * phantom session vanished when the proof exited. The harness held ONE postgres.js
     * connection open across the whole proof, so psql's own pg_stat_activity check counted
     * the observer. The gate was right; the harness was the intruder.
     */
    it('holds NO postgres.js session open while psql runs', async () => {
      const { deps, state } = fake();
      await runResetProof(deps);
      expect(state.openWhenPsqlRan).toEqual([0]);
      expect(state.openWhenProbed).toEqual([0]);
    });

    it('closes the pre-proof observation session before the reset stream', async () => {
      const { deps, state } = fake();
      await runResetProof(deps);
      const closedFirst = state.timeline.indexOf('close:1');
      const psql = state.timeline.findIndex((e) => e.startsWith('psql('));
      expect(closedFirst).toBeGreaterThan(-1);
      expect(closedFirst).toBeLessThan(psql);
    });

    it('opens a FRESH session for the post-rollback fingerprint', async () => {
      const { deps, state } = fake();
      await runResetProof(deps);
      expect(state.sessionsOpened).toEqual([1, 2]);
      const psql = state.timeline.findIndex((e) => e.startsWith('psql('));
      expect(state.timeline.indexOf('open:2')).toBeGreaterThan(psql);
      // Every session that was opened was also closed.
      expect(state.openSessions).toBe(0);
      expect(state.timeline.filter((e) => e.startsWith('open:'))).toHaveLength(2);
      expect(state.timeline.filter((e) => e.startsWith('close:'))).toHaveLength(2);
    });

    it('closes the observation session even when a gate refuses', async () => {
      const { deps, state } = fake({ identity: { role_name: 'afldb_import' } });
      await expect(runResetProof(deps)).rejects.toThrow(/afldb_owner/);
      expect(state.openSessions).toBe(0);
      expect(state.timeline).toContain('close:1');
      expect(state.psqlStreams).toHaveLength(0);
    });

    it('never carries a live connection handle across phases', () => {
      // Structural: the deps expose a SCOPED session, not a connection. There is no way to
      // hand runResetProof something it can keep open.
      expect(proofCode).toContain('withSession');
      expect(proofCode).not.toMatch(/\bquery:\s*Query;/);
      // The CLI builds a client per session and awaits its close in a finally.
      expect(proofCode).toMatch(/await sql\.end\(\{ timeout: 5 \}\)/);
      expect(proofCode).not.toMatch(/const sql = postgres\(dsn[\s\S]{0,400}runResetProof/);
    });

    it('does not exempt the harness from the exclusivity gate', async () => {
      // The fix is to stop being a second session, NOT to whitelist one. An application_name
      // exemption would have hidden this bug and every future one like it.
      for (const source of [proofCode, buildProofSql()]) {
        expect(source).not.toContain('afldb-reset-proof\' AND');
        expect(source).not.toMatch(/application_name\s*(<>|!=)/);
        expect(source).not.toMatch(/pid\s*(<>|!=)\s*\d/);
      }
      // Still fail-closed on a real client backend.
      const { deps } = fake({
        sessions: [{
          pid: '77', usename: 'afldb_owner', application_name: 'afldb-reset-proof',
          state: 'idle', backend_type: 'client backend',
        }],
      });
      await expect(runResetProof(deps)).rejects.toThrow(/exclusive access/);
    });

    it('leaves the exclusive-session SQL itself unchanged and fail-closed', () => {
      expect(OTHER_SESSIONS_SQL).toContain('pid <> pg_backend_pid()');
      expect(OTHER_SESSIONS_SQL).toContain('datname = current_database()');
      // The in-stream check tolerates exactly one thing, and it is not a session anyone owns.
      const stream = buildProofSql();
      expect(stream).toContain("coalesce(backend_type, '') <> 'autovacuum worker'");
      expect(stream).toContain('other client session(s) connected');
      expect(TOLERATED_BACKEND_TYPES).toEqual(['autovacuum worker']);
    });
  });

  describe('no commit path', () => {
    it('always ends the stream in the rollback sentinel', () => {
      const sql = buildProofSql().trimEnd();
      // The sentinel is raised after every assertion, and nothing follows it but the DO
      // block's own terminator — so there is no statement psql could still commit.
      const tail = sql.slice(sql.lastIndexOf(PROOF_ROLLBACK_SENTINEL));
      expect(tail).not.toMatch(/\b(SELECT|DROP|CREATE|COMMIT|SET|RAISE)\b/);
      expect(sql.endsWith('END $afldb_proof$;')).toBe(true);
      expect(sql.lastIndexOf('RAISE EXCEPTION'))
        .toBeGreaterThan(sql.lastIndexOf(`${PROOF_MARKER} extensions preserved`));
    });

    it('never issues COMMIT, and never opens its own transaction', () => {
      const sql = buildProofSql();
      // psql --single-transaction owns the transaction envelope; an explicit BEGIN/COMMIT
      // inside the stream would fight it and could leave the abort ineffective.
      expect(sql).not.toMatch(/^\s*COMMIT\s*;/im);
      expect(sql).not.toMatch(/^\s*BEGIN\s*;/im);
      expect(sql).not.toMatch(/^\s*ROLLBACK\s*;/im);
    });

    it('proves it is inside a transaction block before the first destructive statement', () => {
      // The trap doubles as the detector: in autocommit the deferred duplicate INSERT fails
      // at its own statement end, so fewer than two rows are visible and the stream stops
      // HERE — before RESET_SQL — rather than destroying a database it cannot roll back.
      const sql = buildProofSql();
      const check = sql.indexOf('the commit trap did not arm');
      expect(check).toBeGreaterThan(sql.indexOf('INSERT INTO afldb_proof_commit_trap'));
      expect(check).toBeLessThan(sql.indexOf(RESET_SQL.trim()));
      expect(sql).toContain('not in a transaction block');
      expect(PROOF_REQUIRED_MARKERS).toContain('trap');
    });

    it('nothing between the trap and COMMIT can disarm it', () => {
      const sql = buildProofSql();
      const after = sql.slice(sql.indexOf('INSERT INTO afldb_proof_commit_trap'));
      // Anything that could clear the pending violation before commit-time checking.
      expect(after).not.toMatch(/SET\s+CONSTRAINTS/i);
      expect(after).not.toMatch(/\bSAVEPOINT\b/i);
      expect(after).not.toMatch(/ROLLBACK\s+TO/i);
      expect(after).not.toMatch(/\bDISCARD\b/i);
      expect(after).not.toMatch(/DELETE\s+FROM\s+afldb_proof_commit_trap/i);
      expect(after).not.toMatch(/DROP\s+TABLE\s+afldb_proof_commit_trap/i);
      // And the reset itself cannot reach a temp table: it is public-only for relations
      // and excludes every pg_ schema, which is where temp objects live.
      expect(RESET_SQL).toContain("n.nspname = 'public'");
      expect(RESET_SQL).toContain("n.nspname !~ '^pg_'");
      expect(RESET_SQL).not.toMatch(/pg_temp/i);
    });

    it('arms a server-side commit trap BEFORE the reset', () => {
      // The defence against a TRUNCATED stream. A stream cut after RESET_SQL but before
      // the sentinel would reach EOF and psql's --single-transaction would COMMIT it. A
      // DEFERRABLE INITIALLY DEFERRED unique constraint with a duplicate row is checked at
      // COMMIT, so from this point on any commit becomes an error, whatever psql does.
      const sql = buildProofSql();
      const trap = sql.indexOf('afldb_proof_commit_trap');
      expect(trap).toBeGreaterThan(-1);
      expect(trap).toBeLessThan(sql.indexOf(RESET_SQL.trim()));
      expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED');
      expect(sql).toContain('INSERT INTO afldb_proof_commit_trap VALUES (1), (1)');
      // In a temp table, so the reset it guards cannot drop it.
      expect(sql).toContain('CREATE TEMP TABLE afldb_proof_commit_trap');
    });

    it('emits a delivery marker as the first thing it does', () => {
      const sql = buildProofSql();
      const delivery = sql.indexOf(`${PROOF_MARKER} ${PROOF_DELIVERY_MARKER}`);
      expect(delivery).toBeGreaterThan(-1);
      expect(delivery).toBeLessThan(sql.indexOf('afldb_proof_commit_trap'));
      expect(delivery).toBeLessThan(sql.indexOf(RESET_SQL.trim()));
    });

    it('treats a ZERO psql exit as a FAILURE, and says which kind', async () => {
      // Inverted on purpose: exit 0 means the stream did not abort. The two cases are
      // materially different and must not be reported the same way.
      const notDelivered = fake({ psql: { status: 0, stdout: '', stderr: '' } });
      await expect(runResetProof(notDelivered.deps))
        .rejects.toThrow(/never emitted the delivery marker.*nothing was committed/s);

      const startedThenStopped = fake({ psql: { status: 0, stderr: psqlStderr() } });
      await expect(runResetProof(startedThenStopped.deps))
        .rejects.toThrow(/exited 0 having STARTED the stream/);
      await expect(runResetProof(fake({ psql: { status: 0, stderr: psqlStderr() } }).deps))
        .rejects.toThrow(/db:test:fingerprint/);
    });

    it('redacts any connection string before relaying psql output', async () => {
      expect(redact('psql: error: connection to postgres://afldb_owner:hunter2@h:5432/x failed'))
        .toBe('psql: error: connection to <redacted-dsn> failed');
      expect(redact('PGPASSWORD=hunter2 in env')).toContain('PGPASSWORD=<redacted>');
      expect(redact('relation "players" does not exist'))
        .toBe('relation "players" does not exist');

      const { deps } = fake({
        psql: {
          status: 0, stdout: '',
          stderr: 'could not connect to postgres://afldb_owner:hunter2@h:5432/afldb_test',
        },
      });
      const error = await runResetProof(deps).catch((e: Error) => e);
      expect((error as Error).message).not.toContain('hunter2');
      expect((error as Error).message).toContain('<redacted-dsn>');
    });

    it('never discards what psql said', async () => {
      // The 2026-08-27 refusal reported the exit status and threw the output away, leaving
      // nothing to diagnose. Every unexpected outcome now carries psql's own words.
      const { deps } = fake({
        psql: { status: 0, stdout: 'some stdout', stderr: 'some stderr' },
      });
      const error = await runResetProof(deps).catch((e: Error) => e);
      expect((error as Error).message).toContain('psql exit 0');
      expect((error as Error).message).toContain('some stderr');
    });

    it('refuses a truncated stream that never reached the sentinel', async () => {
      const { deps } = fake({ psql: { status: 3, stderr: psqlStderr({ sentinel: false }) } });
      await expect(runResetProof(deps))
        .rejects.toThrow(/began but failed before its deliberate abort/);
    });

    it('reports a non-zero exit without the sentinel as a genuine failure', async () => {
      const { deps } = fake({
        psql: {
          status: 3,
          stderr: `WARNING:  ${PROOF_MARKER} ${PROOF_DELIVERY_MARKER} stream=begins
`
            + 'ERROR:  permission denied for schema public',
        },
      });
      const error = await runResetProof(deps).catch((e: Error) => e);
      expect((error as Error).message).toMatch(/failed before its deliberate abort/);
      expect((error as Error).message).toMatch(/nothing was committed/i);
      expect((error as Error).message).toContain('permission denied for schema public');
    });

    it('refuses when an assertion marker never appeared', async () => {
      for (const kind of PROOF_REQUIRED_MARKERS) {
        const { deps } = fake({ stderr: { omitMarker: kind } });
        // The delivery marker has its own, more specific refusal: without it the stream
        // never began, which is a different fact from an assertion having been skipped.
        const message = kind === PROOF_DELIVERY_MARKER
          ? /emitting the delivery marker/
          : new RegExp(`'${kind}' marker`);
        await expect(runResetProof(deps), `omitting ${kind} must refuse`)
          .rejects.toThrow(message);
      }
    });

    it('accepts the deliberate abort as success', async () => {
      const report = await runResetProof(fake().deps);
      expect(report.rolledBack).toBe(true);
      expect(report.committed).toBe(false);
      expect(report.psqlStatus).not.toBe(0);
    });
  });

  describe('comment marker (AFLDB-ISSUE-237 prerequisite P-M, point 2)', () => {
    it('sets a throwaway COMMENT ON DATABASE and checks it back, inside the same transaction', () => {
      const sql = buildProofSql();
      expect(sql).toContain(`COMMENT ON DATABASE afldb_test IS '${PROOF_MARKER_COMMENT}'`);
      // Before RESET_SQL...
      expect(sql.indexOf('marker_set')).toBeLessThan(sql.indexOf(RESET_SQL.trim()));
      // ...and again after it, before the extension check and the deliberate abort.
      expect(sql.indexOf('marker_after'))
        .toBeGreaterThan(sql.indexOf(RESET_SQL.trim()) + RESET_SQL.trim().length);
      expect(sql.indexOf('marker_after')).toBeLessThan(sql.indexOf(PROOF_ROLLBACK_SENTINEL));
    });

    it('proves the marker on a clean run with no pre-existing comment', async () => {
      const report = await runResetProof(fake().deps);
      expect(report.commentMarkerProven).toBe(true);
    });

    it('proves the marker survives with a pre-existing comment restored exactly', async () => {
      const { deps } = fake({ comment: { pre: 'operator note: do not touch' } });
      const report = await runResetProof(deps);
      expect(report.commentMarkerProven).toBe(true);
    });

    it('refuses when the rollback does not restore the pre-existing comment', async () => {
      const { deps } = fake({ comment: { pre: 'original', post: 'drifted' } });
      await expect(runResetProof(deps))
        .rejects.toThrow(/did NOT restore the pre-existing database comment/);
    });

    it('refuses when a comment appears after reset that was not there before', async () => {
      const { deps } = fake({ comment: { pre: null, post: 'leaked marker' } });
      await expect(runResetProof(deps))
        .rejects.toThrow(/did NOT restore the pre-existing database comment/);
    });

    it('refuses when the stream reports marker_set without status=ok', async () => {
      const { deps } = fake({ stderr: { markerSet: 'status=mismatch' } });
      await expect(runResetProof(deps)).rejects.toThrow(/marker_set.*did not report 'ok'/s);
    });

    it('refuses when the stream reports marker_after without status=ok', async () => {
      const { deps } = fake({ stderr: { markerAfter: 'status=mismatch' } });
      await expect(runResetProof(deps)).rejects.toThrow(/marker_after.*did not report 'ok'/s);
    });

    // Generalises the existing "refuses when an assertion marker never appeared" case:
    // marker_set and marker_after are now part of PROOF_REQUIRED_MARKERS, so omitting
    // either is already covered there. This asserts the array actually lists them, so a
    // future edit cannot silently drop the coverage.
    it('requires both marker_set and marker_after as proof markers', () => {
      expect(PROOF_REQUIRED_MARKERS).toContain('marker_set');
      expect(PROOF_REQUIRED_MARKERS).toContain('marker_after');
    });
  });

  describe('identity refusals — every one fires BEFORE the reset', () => {
    const cases: [string, Partial<Identity>, string, RegExp][] = [
      ['a database that is not afldb_test', { database: 'afldb_scratch_test' },
        'afldb_scratch_test', /only explicit rebuild targets/],
      ['afldb_dev by name', { database: 'afldb_dev' }, 'afldb_dev', /rejected by name/],
      ['anything that looks like production', { database: 'afldb_prod' }, 'afldb_prod',
        /rejected by name|looks like production/],
      ['a name outside the rebuild allowlist', { database: 'afldb' }, 'afldb',
        /only explicit rebuild targets/],
      // AFLDB-ISSUE-146: code_test_db is an allowlisted REBUILD target, but this proof stays
      // pinned to afldb_test — the shared name check passes and the proof's own pin refuses.
      ['the code_test_db rehearsal target', { database: 'code_test_db' }, 'code_test_db',
        /only ever runs against 'afldb_test'/],
      ['a server answering a different database from the DSN', { database: 'afldb_dev' },
        'afldb_test', /only ever runs against 'afldb_test'/],
      ['a current_user that is not afldb_owner', { role_name: 'afldb_import' },
        'afldb_test', /current_user 'afldb_import'/],
      ['a session_user that is not afldb_owner', { session_role_name: 'postgres' },
        'afldb_test', /session_user is 'postgres'/],
      ['a SUPERUSER current_user', { role_is_superuser: true }, 'afldb_test',
        /current_user 'afldb_owner' is a SUPERUSER/],
      ['a SUPERUSER session_user', { session_is_superuser: true }, 'afldb_test',
        /session_user 'afldb_owner' is a SUPERUSER/],
    ];

    for (const [what, identity, dsnDatabase, message] of cases) {
      it(`refuses ${what}`, async () => {
        const { deps, state } = fake({ identity });
        await expect(runResetProof({ ...deps, dsnDatabase })).rejects.toThrow(message);
        expect(state.psqlStreams).toHaveLength(0);
        expect(state.resetRan).toBe(false);
      });
    }

    it('refuses a superuser outright rather than warning', () => {
      // The earlier draft warned and continued. afldb_owner is created LOGIN NOSUPERUSER
      // (00_install_postgres.sh:57) and nothing in this repository issues SET ROLE, so a
      // superuser is not part of the credential model — and it would bypass exactly the
      // ownership rules the real reset depends on.
      expect(proofCode).not.toMatch(/WARNING: this role is a SUPERUSER/);
      expect(proofCode).toContain('is a SUPERUSER');
      expect(buildProofSql()).toContain('rolsuper');
    });

    it('re-asserts identity inside the psql transaction, before the reset', () => {
      const sql = buildProofSql();
      expect(sql.indexOf('current_user')).toBeLessThan(sql.indexOf(RESET_SQL.trim()));
      expect(sql.indexOf('session_user')).toBeLessThan(sql.indexOf(RESET_SQL.trim()));
      expect(sql.indexOf('rolsuper')).toBeLessThan(sql.indexOf(RESET_SQL.trim()));
    });
  });

  describe('concurrency', () => {
    it('refuses to run while any other client session is connected', async () => {
      const { deps, state } = fake({
        sessions: [{
          pid: '4321', usename: 'afldb_app', application_name: 'afldb',
          state: 'idle in transaction', backend_type: 'client backend',
        }],
      });
      await expect(runResetProof(deps)).rejects.toThrow(/ACCESS EXCLUSIVE|exclusive access/);
      expect(state.resetRan).toBe(false);
    });

    it('tolerates an autovacuum worker rather than failing at random', async () => {
      const { deps, state } = fake({
        sessions: [{
          pid: '99', usename: 'postgres', application_name: '?', state: 'active',
          backend_type: 'autovacuum worker',
        }],
      });
      await expect(runResetProof(deps)).resolves.toMatchObject({ rolledBack: true });
      expect(state.resetRan).toBe(true);
    });

    it('still refuses a client backend alongside an autovacuum worker', async () => {
      const { deps, state } = fake({
        sessions: [
          { pid: '99', usename: 'postgres', application_name: '?', state: 'active',
            backend_type: 'autovacuum worker' },
          { pid: '100', usename: 'afldb_app', application_name: 'afldb', state: 'idle',
            backend_type: 'client backend' },
        ],
      });
      await expect(runResetProof(deps)).rejects.toThrow(/1 other session/);
      expect(state.resetRan).toBe(false);
    });

    it('re-checks exclusivity inside the psql transaction too', () => {
      const sql = buildProofSql();
      expect(sql).toContain('pg_stat_activity');
      expect(sql.indexOf('pg_stat_activity')).toBeLessThan(sql.indexOf(RESET_SQL.trim()));
    });

    it('bounds its own locking and idle time before touching anything', () => {
      const sql = buildProofSql();
      for (const guard of ['SET LOCAL lock_timeout', 'SET LOCAL statement_timeout',
        'SET LOCAL idle_in_transaction_session_timeout']) {
        expect(sql).toContain(guard);
        expect(sql.indexOf(guard)).toBeLessThan(sql.indexOf(RESET_SQL.trim()));
      }
    });

    it('never terminates another session', () => {
      expect(proofSource).not.toMatch(/pg_terminate_backend|pg_cancel_backend/);
      expect(psqlSource).not.toMatch(/pg_terminate_backend|pg_cancel_backend/);
    });
  });

  describe('post-reset assertions', () => {
    const cases: [string, Partial<typeof CLEAN_CENSUS>, RegExp][] = [
      ['a surviving application schema', { schemas: 1 }, /application schemas/],
      ['a surviving table', { tables: 1 }, /tables in public/],
      ['a surviving view', { views: 1 }, /views and materialized views/],
      ['a surviving sequence', { sequences: 1 }, /sequences in public/],
      ['a surviving foreign table', { foreign_tables: 1 }, /foreign tables/],
      ['a surviving routine', { routines: 1 }, /routines in public/],
      ['a surviving type', { types: 1 }, /enum, domain and composite types/],
      ['surviving migration bookkeeping', { migrations: 't' }, /schema_migrations/],
      ['a removed public schema', { public_schemas: 0 }, /removed the public schema/],
    ];
    for (const [what, census, message] of cases) {
      it(`refuses on ${what}`, async () => {
        await expect(runResetProof(fake({ stderr: { census } }).deps))
          .rejects.toThrow(message);
      });
    }

    it('asserts the same census in SQL, so the stream aborts on its own', () => {
      const sql = buildProofSql();
      const afterReset = sql.slice(sql.indexOf(RESET_SQL.trim()) + RESET_SQL.trim().length);
      for (const fragment of ['survived the reset', 'schema_migrations survived',
        'public schema was removed']) {
        expect(afterReset).toContain(fragment);
      }
    });

    it('accepts a clean slate', async () => {
      const report = await runResetProof(fake().deps);
      expect(report.census).toEqual({
        schemas: 0, tables: 0, views: 0, sequences: 0, foreign_tables: 0,
        routines: 0, types: 0, public_schemas: 1,
      });
    });

    it('is not defeated by a census value that is not an integer', async () => {
      await expect(runResetProof(fake({ stderr: { census: { tables: 'x' as never } } }).deps))
        .rejects.toThrow(/non-integer 'tables'/);
    });
  });

  describe('extension preservation', () => {
    it('compares against a snapshot taken inside the same transaction', () => {
      const sql = buildProofSql();
      const reset = sql.indexOf(RESET_SQL.trim());
      // The snapshot is taken BEFORE the reset and compared AFTER it.
      expect(sql.indexOf('CREATE TEMP TABLE afldb_proof_ext')).toBeLessThan(reset);
      expect(sql.indexOf('CREATE TEMP TABLE afldb_proof_extmem')).toBeLessThan(reset);
      expect(sql.lastIndexOf('afldb_proof_extmem')).toBeGreaterThan(reset);
      expect(sql).toContain('changed the extension set');
      expect(sql).toContain('extension-owned object');
    });

    it('survives the reset it checks, because temp objects live in pg_temp', () => {
      // RESET_SQL's schema loop excludes `^pg_` and its table loop is public-only, so the
      // snapshot tables cannot be dropped by the reset they are used to verify.
      expect(RESET_SQL).toContain("n.nspname !~ '^pg_'");
      expect(RESET_SQL).toContain("n.nspname = 'public'");
    });

    it('does not hard-code which extensions must exist', () => {
      // Repository evidence names pg_trgm and unaccent (00_install_postgres.sh:98-99), but
      // the stream asserts "the same set as a moment ago", so a third extension added at
      // bootstrap is preserved and proven too, with no code change here.
      expect(proofCode).not.toMatch(/'pg_trgm'|"pg_trgm"/);
      expect(proofCode).not.toMatch(/'unaccent'|"unaccent"/);
    });
  });

  describe('rollback restoration', () => {
    it('requires the post-rollback fingerprint to match exactly', async () => {
      const { deps } = fake({ catalogAfter: { ...catalog(), relations: [] } });
      await expect(runResetProof(deps))
        .rejects.toThrow(/did NOT restore|Do NOT run the rebuild/);
    });

    it('names the drifted section without printing any row', async () => {
      const { deps } = fake({ catalogAfter: { ...catalog(), routines: [] } });
      const error = await runResetProof(deps).catch((e: Error) => e);
      expect((error as Error).message).toMatch(/routines/);
      // Fingerprints exist so a failure report can be exact without emitting database rows.
      expect((error as Error).message).not.toContain('afldb_normalise_name');
    });

    it('refuses if the psql transaction saw a different database from the fingerprint', async () => {
      const { deps } = fake({ stderr: { before: { relations: 99 } } });
      await expect(runResetProof(deps)).rejects.toThrow(/saw 99 relations/);
    });
  });

  describe('the proof cannot become a rebuild', () => {
    it('has no stage graph and spawns nothing of its own', () => {
      expect(proofCode).not.toContain('planStages');
      expect(proofCode).not.toContain('executeRebuild');
      // The one subprocess it uses is the shared psql helper, injected as a dependency.
      expect(proofCode).not.toContain('spawnSync(');
    });

    it('names no migration, privilege, importer or derived step', () => {
      for (const forbidden of ['db:migrate', 'db:privileges', 'load_reference_data',
        'import_fitzroy_core', 'import_draftguru', 'rebuild_derived', 'import_draft.py']) {
        expect(proofCode, `prove-reset.ts must not reference ${forbidden}`)
          .not.toContain(forbidden);
      }
    });

    it('never references AFLDB_LEGACY_SQLITE', () => {
      expect(proofCode).not.toContain('AFLDB_LEGACY_SQLITE');
      expect(psqlSource).not.toContain('AFLDB_LEGACY_SQLITE');
    });

    it('contains no TRUNCATE substitute anywhere on the proof path', () => {
      expect(buildProofSql()).not.toMatch(/\bTRUNCATE\b/i);
      expect(proofCode).not.toMatch(/\bTRUNCATE\b/i);
    });

    it('does not require the fitzRoy accepted baseline', () => {
      // Correct BECAUSE the proof loads no data and commits nothing: an accepted core
      // source is a precondition for populating a database, not for proving a reset.
      expect(proofCode).not.toContain('accepted-baselines');
      expect(proofCode).not.toContain('fitzroy');
      expect(proofCode).not.toContain('--require-accepted-baseline');
    });

    it('needs no import credential, so AFLDB-ISSUE-083 does not gate it', () => {
      expect(proofCode).not.toContain('AFLDB_TEST_IMPORT_DATABASE_URL');
      expect(proofCode).not.toContain('allow-owner-import-dsn');
      expect(proofCode).toContain('AFLDB_TEST_DATABASE_URL');
    });

    it('takes no options at all', () => {
      expect(proofCode).toContain('Unknown argument');
      expect(proofCode).not.toContain('--acknowledge-destroy');
    });

    it('emits no DSN and no password', () => {
      for (const source of [proofSource, psqlSource]) {
        expect(source).not.toMatch(/console\.log\([^)]*[Dd]sn/);
        expect(source).not.toMatch(/console\.log\([^)]*password/i);
        expect(source).not.toMatch(/\$\{dsn\}/);
      }
      // psql's own diagnostics name relations, roles and hosts — never the DSN it was
      // handed — so relaying stderr does not leak the connection string.
      expect(psqlSource).not.toMatch(/Error\(`[^`]*\$\{dsn\}/);
    });

    it("reuses the rebuild's own target contract rather than a weaker copy", () => {
      expect(proofCode).toContain('assertRebuildTargetName');
    });
  });
});

/*
 * AFLDB-ISSUE-093 §20.11 — the READ-ONLY verifier, `npm run db:test:fingerprint`.
 *
 * It exists to settle database state after an unexplained reset-proof outcome, so it must
 * be incapable of changing anything — and that has to be provable here, not promised in a
 * comment, because it will be run against a database whose state is in doubt.
 */
describe('read-only fingerprint verifier', () => {
  const source = readFileSync(join(root, 'tools', 'db', 'fingerprint-test.ts'), 'utf8');
  const code = source.slice(source.indexOf('*/') + 2);
  const catalogSource = readFileSync(
    join(root, 'tools', 'db', 'catalog-fingerprint.ts'), 'utf8');

  it('cannot reach any reset path', () => {
    expect(code).not.toContain('RESET_SQL');
    expect(code).not.toContain('runPsql');
    expect(code).not.toContain('prove-reset');
    expect(code).not.toContain('spawnSync');
    expect(code).not.toContain('child_process');
  });

  it('issues no DDL or DML of its own', () => {
    // Behavioural, not a prose scan: EVERY statement this path can send is checked.
    const statements = [
      READ_ONLY_SQL, VERIFIER_IDENTITY_SQL, HEALTH_SQL,
      MIGRATION_TABLE_SQL, MIGRATION_STATE_SQL,
      ...FINGERPRINT_SECTIONS.map((s) => s.sql),
    ];
    for (const statement of statements) {
      expect(statement)
        .not.toMatch(/\b(DROP|CREATE|ALTER|INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
      expect(statement.trim()).toMatch(/^(SELECT|SET)\b/);
    }
    expect(statements.length).toBeGreaterThan(10);
  });

  it('puts the SERVER into read-only mode before it queries anything', () => {
    expect(READ_ONLY_SQL).toBe('SET default_transaction_read_only = on');
    // Compared at the CALL SITES, not the import list.
    expect(code.indexOf('await query(READ_ONLY_SQL)')).toBeGreaterThan(-1);
    expect(code.indexOf('await query(READ_ONLY_SQL)'))
      .toBeLessThan(code.indexOf('await collectSections(query)'));
  });

  it('computes the same digest the proof computes, from one implementation', () => {
    // If these could drift, a "MATCH" would mean nothing.
    expect(catalogSource).toContain('export const FINGERPRINT_SECTIONS');
    expect(code).toContain("from './catalog-fingerprint'");
    const proof = readFileSync(join(root, 'tools', 'db', 'prove-reset.ts'), 'utf8');
    expect(proof).toContain("from './catalog-fingerprint'");
    expect(proof).not.toContain('export const FINGERPRINT_SECTIONS:');
  });

  it('reuses the rebuild target contract and refuses anything else', () => {
    expect(code).toContain('assertRebuildTargetName');
  });

  it('validates --expect and rejects anything else', () => {
    expect(parseArgs([])).toEqual({});
    expect(parseArgs(['--expect', 'a'.repeat(64)])).toEqual({ expect: 'a'.repeat(64) });
    expect(() => parseArgs(['--expect', 'nope'])).toThrow(/sha256 digest/);
    expect(() => parseArgs(['--expect'])).toThrow(/sha256 digest/);
    expect(() => parseArgs(['--reset'])).toThrow(/Unknown argument/);
  });

  it('emits no DSN and no password', () => {
    expect(source).not.toMatch(/console\.log\([^)]*[Dd]sn/);
    expect(source).not.toMatch(/\$\{dsn\}/);
  });

  it('is exposed as its own npm entry point', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(pkg.scripts['db:test:fingerprint']).toBe('tsx tools/db/fingerprint-test.ts');
  });
});

describe('wiring', () => {
  it('is exposed as the single npm entry point', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(pkg.scripts['db:test:rebuild']).toBe('tsx tools/db/rebuild-test.ts');
  });

  it('exposes the reset proof as its own entry point, not a rebuild flag', () => {
    // A separate command, deliberately: overloading --acknowledge-destroy for a
    // rollback-only proof would make the operator's intent ambiguous at the one moment it
    // must not be.
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(pkg.scripts['db:test:prove-reset']).toBe('tsx tools/db/prove-reset.ts');
  });

  it('is the only rebuild orchestrator in the repository', () => {
    const source = readFileSync(join(root, 'tools', 'db', 'rebuild-test.ts'), 'utf8');
    // The header documents §10's "never reference AFLDB_LEGACY_SQLITE" requirement, so as
    // elsewhere in this repository the absence assertion runs against the CODE, not the
    // documentation of what the code must not do.
    const code = source.slice(source.indexOf('*/') + 2);
    expect(code).not.toContain('AFLDB_LEGACY_SQLITE');
    expect(code).not.toContain('import_draft.py');
    // never prints a DSN
    expect(source).not.toMatch(/console\.log\([^)]*Dsn/);
  });

  it('is named as canonical by active operator documentation', () => {
    for (const doc of ['deployment.md', 'production-cutover.md']) {
      const text = readFileSync(join(root, 'docs', doc), 'utf8');
      expect(text, `${doc} does not name the canonical rebuild`)
        .toContain('npm run db:test:rebuild');
    }
  });
});

// ---------------------------------------------------------------------------
// AFLDB-ISSUE-222 Phase 1 — the DraftGuru bridge dataset threaded through the
// rebuild (revised runbook §2.4, §5 Phase 1 item 5, §6.1). Absent by default:
// every assertion above this point already proves the no-bridge behaviour is
// unchanged (285/285 passing with no bridge-related edits to those tests).
// ---------------------------------------------------------------------------

describe('DraftGuru bridge wiring (AFLDB-ISSUE-222 Phase 1)', () => {
  const BRIDGE_LABEL = 'annual-html-20260826';

  function withTempBridgeFile(bridgeCount: number, body: (path: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), 'afldb-i222-bridge-'));
    try {
      const path = join(dir, 'bridge.json');
      writeFileSync(path, JSON.stringify({
        schema_version: 1,
        bridges: Array.from({ length: bridgeCount }, (_, i) => ({
          player_url: `https://www.draftguru.com.au/players/fixture_${i}/1`,
          afltables_external_id: `players/F/Fixture_${i}.html`,
        })),
      }));
      body(path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('draftguruImportArgv appends --bridge only when one is supplied', () => {
    expect(draftguruImportArgv(BRIDGE_LABEL, 'python')).toEqual(
      ['python', DRAFTGURU_IMPORTER, '--label', BRIDGE_LABEL]);
    expect(draftguruImportArgv(BRIDGE_LABEL, 'python', '/tmp/bridge.json')).toEqual(
      ['python', DRAFTGURU_IMPORTER, '--label', BRIDGE_LABEL, '--bridge', '/tmp/bridge.json']);
  });

  it('draftguruValidateArgv carries the bridge through to --validate-only', () => {
    expect(draftguruValidateArgv(BRIDGE_LABEL, 'python', '/tmp/bridge.json')).toEqual([
      'python', DRAFTGURU_IMPORTER, '--label', BRIDGE_LABEL,
      '--bridge', '/tmp/bridge.json', '--validate-only',
    ]);
  });

  it('planStages threads opts.draftguruBridge into the draftguru data stage', () => {
    const withoutBridge = planStages(target(), fitzroy(), OPTS)
      .find((s) => s.id === 'draftguru')!;
    expect(withoutBridge.argv).not.toContain('--bridge');

    // planStages also builds the FINAL VALIDATION stage's SQL from the same bridge path
    // (see the 'finalValidationSql' tests below), so a real file is required here too.
    withTempBridgeFile(3, (bridgePath) => {
      const withBridge = planStages(target(), fitzroy(),
        { ...OPTS, draftguruBridge: bridgePath }).find((s) => s.id === 'draftguru')!;
      expect(withBridge.argv).toContain('--bridge');
      expect(withBridge.argv![withBridge.argv!.indexOf('--bridge') + 1]).toBe(bridgePath);
      expect(withBridge.name).toContain(bridgePath);
    });
  });

  it('runPreflight proves the bridge file exists before anything is destroyed', () => {
    const { deps } = fakeDeps();
    let checked: string | undefined;
    deps.fileExists = (path: string) => {
      if (path === '/does/not/exist.json') { checked = path; return false; }
      return true;
    };
    expect(() => runPreflight(deps,
      { ...OPTS, draftguruBridge: '/does/not/exist.json' }))
      .toThrow(/bridge dataset is missing.*Nothing has been destroyed/s);
    expect(checked).toBe('/does/not/exist.json');
  });

  it('finalValidationChecks adds draft_persons_bridged only when draftguru.bridged is given', () => {
    const minimalRegister = {
      contract: 'afldb.fitzroy.accepted_baselines',
      schema_version: 1,
      selection_policy: { rule: 'exactly_one_accepted' },
      baselines: [{ snapshot_label: FULL_LABEL, acceptance_status: 'accepted', measured: {} }],
    };
    const withoutBridge = finalValidationChecks(minimalRegister);
    expect(withoutBridge.find((c) => c.key === 'draft_persons_bridged')).toBeUndefined();

    const withBridge = finalValidationChecks(minimalRegister,
      { ...DRAFTGURU_EXPECTED, bridged: 3405 });
    const check = withBridge.find((c) => c.key === 'draft_persons_bridged');
    expect(check).toBeDefined();
    expect(check!.expected).toBe(3405);
    expect(check!.sql).toContain("match_method = 'draftguru_person_page_afltables_bridge'");
    expect(check!.sql).toContain("link_status = 'unique'");
  });

  it('finalValidationSql reads bridged from the SAME deployment dataset the data stage imports', () => {
    withTempBridgeFile(7, (path) => {
      const sql = finalValidationSql(path);
      expect(sql).toContain('draft_persons_bridged');
      expect(sql).toContain('IS DISTINCT FROM 7::bigint');
    });
    // absent by default: no bridge-shaped expectation appears
    expect(finalValidationSql()).not.toContain('draft_persons_bridged');
  });

  it('finalValidationSql refuses a bridge path that does not exist', () => {
    expect(() => finalValidationSql('/does/not/exist.json')).toThrow(RebuildRefused);
    expect(() => finalValidationSql('/does/not/exist.json'))
      .toThrow(/bridge dataset is missing/);
  });

  it('finalValidationSql refuses a bridge file with no bridges[] array', () => {
    const dir = mkdtempSync(join(tmpdir(), 'afldb-i222-bridge-bad-'));
    try {
      const path = join(dir, 'bad.json');
      writeFileSync(path, JSON.stringify({ schema_version: 1 }));
      expect(() => finalValidationSql(path)).toThrow(/does not carry a bridges\[\] array/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// AFLDB-ISSUE-235 C6 (OD-5, runbook D15 (i)–(iii)) — the afl_api human identity
// adjudication ledger survives the destructive rebuild: captured before the reset,
// reinstated and replayed after the last player-population stage, bijection-checked
// straight after. DB-free: the stage graph, the executor with fake deps, and the pure
// capture/reinstatement helpers of tools/migration/rebuild_afl_api_adjudications.ts.
// ---------------------------------------------------------------------------

describe('AFL API adjudication survival through the rebuild (AFLDB-ISSUE-235 C6 / OD-5)', () => {
  const CAPTURE = 'afl-api-adjudications-capture';
  const REINSTATE = 'afl-api-adjudications-reinstate';
  const BIJECTION = 'afl-api-adjudications-bijection';
  const CODE_OWNER = 'postgres://afldb_owner:pw@localhost:5432/code_test_db';
  const CODE_IMPORT = 'postgres://afldb_import:pw@localhost:5432/code_test_db';
  const codeTarget = () => target({ database: 'code_test_db', adminDsn: CODE_OWNER, importDsn: CODE_IMPORT });

  const stages = planStages(target(), fitzroy(), OPTS);
  const ids = idsOf(stages);
  const stage = (id: string, from: Stage[] = stages) => from.find((s) => s.id === id)!;

  it('captures after PRECHECK and immediately before the reset', () => {
    expect(ids.indexOf('precheck')).toBeLessThan(ids.indexOf(CAPTURE));
    expect(ids.indexOf(CAPTURE)).toBe(ids.indexOf('recreate') - 1);
    expect(stage(CAPTURE).kind).toBe('capture');
    expect(stage(CAPTURE).run).toBe('command');
    expect(stage(CAPTURE).argv).toEqual(['npx', 'tsx', AFL_API_ADJUDICATION_TOOL, 'capture']);
    expect(existsSync(join(root, AFL_API_ADJUDICATION_TOOL))).toBe(true);
    // still exactly one destructive stage, and it is the reset
    expect(stages.filter((s) => s.kind === 'destructive').map((s) => s.id)).toEqual(['recreate']);
  });

  it('never runs the reset unless the capture succeeded', () => {
    const failed = fakeDeps(`${AFL_API_ADJUDICATION_TOOL} capture`);
    const report = executeRebuild(stages, target(), failed.deps);
    expect(report.ok).toBe(false);
    expect(report.failedStage).toBe(CAPTURE);
    expect(report.executed).toEqual(['precheck', CAPTURE]);
    expect(failed.sqlRuns).toEqual([]);        // RESET_SQL was never sent
    expect(failed.commands).toHaveLength(1);   // nothing after the capture was spawned

    const ok = fakeDeps();
    const passed = executeRebuild(stages, target(), ok.deps);
    expect(passed.executed.indexOf(CAPTURE)).toBeLessThan(passed.executed.indexOf('recreate'));
    expect(ok.sqlRuns).toEqual([RESET_SQL]);
  });

  it('reinstates only after every player-population stage, draftguru included — never straight after fitzroy', () => {
    const draftguru = ids.indexOf('draftguru');
    expect(ids.indexOf(REINSTATE)).toBe(draftguru + 1);
    expect(ids[ids.indexOf('fitzroy') + 1]).not.toBe(REINSTATE);
    // every data stage up to and including draftguru precedes it (they build the players
    // and the afltables identities player_identity remaps through) …
    const upstream = stages.slice(0, draftguru + 1).filter((s) => s.kind === 'data').map((s) => s.id);
    expect(upstream).toEqual(expect.arrayContaining(['reference', 'fitzroy', 'draftguru']));
    for (const id of upstream) expect(ids.indexOf(id), id).toBeLessThan(ids.indexOf(REINSTATE));
    // … and it precedes the stages that only READ the canonical players
    for (const later of ['awards-honours', 'brownlow-season', 'derived', 'coleman', 'fingerprints']) {
      expect(ids.indexOf(REINSTATE), later).toBeLessThan(ids.indexOf(later));
    }
    expect(stage(REINSTATE).kind).toBe('reinstate');
    expect(stage(REINSTATE).argv).toEqual(['npx', 'tsx', AFL_API_ADJUDICATION_TOOL, 'reinstate']);
  });

  it('checks the bijection straight after the replay, as its own read-only validation stage', () => {
    expect(ids.indexOf(BIJECTION)).toBe(ids.indexOf(REINSTATE) + 1);
    expect(ids.indexOf(BIJECTION)).toBeLessThan(ids.indexOf('fingerprints'));
    expect(stage(BIJECTION).kind).toBe('validation');
    expect(stage(BIJECTION).argv).toEqual(['npx', 'tsx', AFL_API_ADJUDICATION_TOOL, 'bijection']);
  });

  it('a failed reinstate/replay stops the bijection and every later stage', () => {
    const { deps, validationRuns } = fakeDeps(`${AFL_API_ADJUDICATION_TOOL} reinstate`);
    const report = executeRebuild(stages, target(), deps);
    expect(report.ok).toBe(false);
    expect(report.failedStage).toBe(REINSTATE);
    for (const later of [BIJECTION, 'awards-honours', 'brownlow-season', 'derived', 'coleman',
                         'ladder-witness', 'fingerprints']) {
      expect(report.executed, later).not.toContain(later);
    }
    expect(validationRuns).toEqual([]);
  });

  it('a failed bijection stops every later stage', () => {
    const { deps, validationRuns } = fakeDeps(`${AFL_API_ADJUDICATION_TOOL} bijection`);
    const report = executeRebuild(stages, target(), deps);
    expect(report.failedStage).toBe(BIJECTION);
    expect(report.executed.at(-1)).toBe(BIJECTION);
    for (const later of ['awards-honours', 'derived', 'fingerprints']) {
      expect(report.executed, later).not.toContain(later);
    }
    expect(validationRuns).toEqual([]);
  });

  it("binds every adjudication stage to the selected target's own DSNs, for both targets", () => {
    const cases: Array<[ResolvedTarget, string, string, string]> = [
      [target(), 'afldb_test', OWNER, IMPORT],
      [codeTarget(), 'code_test_db', CODE_OWNER, CODE_IMPORT],
    ];
    for (const [t, database, owner, imp] of cases) {
      const plan = planStages(t, fitzroy(), OPTS);
      // exactly two variables: the target NAME and one DSN; owner only where it must be
      expect(stage(CAPTURE, plan).envOverlay).toEqual(
        { [AFL_API_ADJUDICATION_TARGET_ENV]: database, [AFL_API_ADJUDICATION_DSN_ENV]: owner });
      expect(stage(REINSTATE, plan).envOverlay).toEqual(
        { [AFL_API_ADJUDICATION_TARGET_ENV]: database, [AFL_API_ADJUDICATION_DSN_ENV]: owner });
      expect(stage(BIJECTION, plan).envOverlay).toEqual(
        { [AFL_API_ADJUDICATION_TARGET_ENV]: database, [AFL_API_ADJUDICATION_DSN_ENV]: imp });
      // and the executor hands each child exactly that overlay
      const { deps, commands, envs } = fakeDeps();
      executeRebuild(plan, t, deps);
      for (const step of ['capture', 'reinstate', 'bijection']) {
        const i = commands.findIndex((c) => c.join(' ') === `npx tsx ${AFL_API_ADJUDICATION_TOOL} ${step}`);
        expect(i, step).toBeGreaterThanOrEqual(0);
        expect(envs[i][AFL_API_ADJUDICATION_TARGET_ENV]).toBe(database);
        expect(envs[i][AFL_API_ADJUDICATION_DSN_ENV]).toBe(step === 'bijection' ? imp : owner);
      }
    }
    // the argv is target-independent; nothing test-shaped leaks into the rehearsal graph
    const forCode = planStages(codeTarget(), fitzroy(), OPTS);
    for (const id of [CAPTURE, REINSTATE, BIJECTION]) {
      expect(stage(id, forCode).argv).toEqual(stage(id).argv);
      expect(JSON.stringify(stage(id, forCode))).not.toContain('afldb_test');
    }
    // the ordinary data stages are untouched: they never receive the adjudication variables
    for (const s of stages.filter((x) => x.kind === 'data')) {
      expect(s.envOverlay?.[AFL_API_ADJUDICATION_DSN_ENV], s.id).toBeUndefined();
    }
  });

  it('refuses a DEV/PROD, mismatched or non-dedicated DSN inside the tool itself', () => {
    const env = (name: string | undefined, dsn: string | undefined) => ({
      [AFL_API_ADJUDICATION_TARGET_ENV]: name, [AFL_API_ADJUDICATION_DSN_ENV]: dsn,
    });
    expect(resolveAdjudicationTarget(env('afldb_test', OWNER))).toEqual({ database: 'afldb_test', dsn: OWNER });
    expect(resolveAdjudicationTarget(env('code_test_db', CODE_OWNER)))
      .toEqual({ database: 'code_test_db', dsn: CODE_OWNER });

    const refusals: Array<[Record<string, string | undefined>, RegExp]> = [
      [env('afldb_dev', 'postgres://u:pw@h:5432/afldb_dev'), /rejected by name/],
      [env('afldb_test', 'postgres://u:pw@h:5432/afldb_dev'), /rejected by name/],
      [env('afldb_test', 'postgres://u:pw@h:5432/afldb_prod'), /rejected by name|looks like production/],
      [env('code_test_db', 'postgres://u:pw@h:5432/afldb_test'), /names database 'afldb_test', not the rebuild target 'code_test_db'/],
      [env('afldb_test', CODE_OWNER), /names database 'code_test_db', not the rebuild target 'afldb_test'/],
      [env('afldb_test', 'not a url'), /is not a valid connection URL/],
      [env('afldb_test', undefined), new RegExp(`${AFL_API_ADJUDICATION_DSN_ENV} is not set`)],
      [env(undefined, OWNER), new RegExp(`${AFL_API_ADJUDICATION_TARGET_ENV} is not set`)],
      // the development variables are never read in place of the dedicated ones
      [{ AFLDB_DATABASE_URL: OWNER, AFLDB_IMPORT_DATABASE_URL: IMPORT },
        new RegExp(`${AFL_API_ADJUDICATION_TARGET_ENV} is not set`)],
    ];
    for (const [e, pattern] of refusals) {
      let message = '';
      try { resolveAdjudicationTarget(e); } catch (error) { message = (error as Error).message; }
      expect(message, JSON.stringify(Object.keys(e))).toMatch(pattern);
      expect(message).not.toContain('pw@');
      expect(message).not.toContain('postgres://');
    }
  });

  it('names the new lifecycle stages in the plan, and --recover only ever reaches the capture', () => {
    expect(stage(CAPTURE).name).toMatch(/AFL API ADJUDICATIONS — capture .* before anything is destroyed/);
    expect(stage(REINSTATE).name).toMatch(/AFL API ADJUDICATIONS — reinstate the ledger, replay the importer/);
    expect(stage(BIJECTION).name).toMatch(/AFL API ADJUDICATIONS — assert the combined importer\/human identity invariant/);
    expect(stage(CAPTURE).argv).not.toContain('--recover');

    const opts = parseRebuildArgs(['--recover-afl-api-adjudications', '--acknowledge-destroy', 'afldb_test']);
    expect(opts.recoverAflApiAdjudications).toBe(true);
    expect(parseRebuildArgs([]).recoverAflApiAdjudications).toBeUndefined();
    const recovering = planStages(target(), fitzroy(), opts);
    expect(stage(CAPTURE, recovering).argv).toEqual(aflApiAdjudicationArgv('capture', true));
    expect(stage(CAPTURE, recovering).argv!.at(-1)).toBe('--recover');
    expect(stage(CAPTURE, recovering).name).toContain('RECOVER');
    expect(stage(REINSTATE, recovering).argv).not.toContain('--recover');
    expect(stage(BIJECTION, recovering).argv).not.toContain('--recover');
    expect(idsOf(recovering)).toEqual(ids);
  });

  // -------------------------------------------------------------------------
  // The pure capture / reinstatement contract. The fixture ledger is deliberately NOT
  // empty: a first link, a link+revoke pair (supersedes_id), gapped ids, and one actor
  // recorded under two spellings of the same email.
  // -------------------------------------------------------------------------

  const EVIDENCE = '{"blocks": [1, 2], "providerId": "CD_I1001"}';
  const ledger = (): CapturedLedgerRow[] => [
    {
      id: 7, sourceKey: 'afl_api', externalId: 'CD_I1001', action: 'linked', playerId: 500,
      playerIdentity: 'players/A/Alpha_Able.html', previousState: null, evidence: EVIDENCE,
      evidenceSha256: 'a'.repeat(64), surnameDisagreementAcknowledged: false, supersedesId: null,
      adminUserId: 3, adminEmail: 'Admin.One@Example.org', adminRole: 'super_admin',
      note: 'Linked on club list and DOB evidence.', createdAt: '2026-09-23T01:02:03.123456Z',
    },
    {
      id: 9, sourceKey: 'afl_api', externalId: 'CD_I1002', action: 'linked', playerId: 501,
      playerIdentity: 'players/B/Bravo_Baker.html', previousState: null, evidence: '{"b": true}',
      evidenceSha256: 'b'.repeat(64), surnameDisagreementAcknowledged: true, supersedesId: null,
      adminUserId: 4, adminEmail: 'two@example.org', adminRole: 'admin',
      note: 'Surname differs by marriage; acknowledged.', createdAt: '2026-09-23T02:00:00.000001Z',
    },
    {
      id: 12, sourceKey: 'afl_api', externalId: 'CD_I1002', action: 'revoked', playerId: 501,
      playerIdentity: 'players/B/Bravo_Baker.html',
      previousState: '{"id": 44, "status": "resolved", "player_id": 501}', evidence: '{"b": false}',
      evidenceSha256: 'c'.repeat(64), surnameDisagreementAcknowledged: false, supersedesId: 9,
      adminUserId: 3, adminEmail: 'admin.one@example.org', adminRole: 'super_admin',
      note: 'Revoked: the provider is a different person.', createdAt: '2026-09-23T03:00:00.000000Z',
    },
  ];
  /** AFLDB-ISSUE-237 D6: a full importer row, disjoint from the ledger fixture's provider ids. */
  const importerRow = (over: Partial<CapturedImporterRow> = {}): CapturedImporterRow => ({
    externalId: 'CD_I2001', playerIdentity: 'players/C/Charlie_Cooper.html',
    matchMethod: 'afl_api_stat_vector_bootstrap', status: 'unique', candidateCount: 1,
    externalName: 'C Cooper', externalUrl: null, notes: null, playerId: 502, ...over,
  });
  const capture = (rows = ledger(), importerRows: CapturedImporterRow[] = [importerRow()], database = 'afldb_test') =>
    buildCombinedCapture({
      database, capturedAt: '2026-09-23T10:00:00.000Z', ledgerTablePresent: true,
      ledgerRows: rows, importerRows,
    });
  const REMAP = new Map([
    ['players/A/Alpha_Able.html', { ok: true as const, newPlayerId: 9001, remappedIdentity: 'players/A/Alpha_Able.html' }],
    ['players/B/Bravo_Baker.html', { ok: true as const, newPlayerId: 9002, remappedIdentity: 'players/B/Bravo_Baker.html' }],
  ]);
  /** Keyed by lower(email), as remapActors() builds it: both spellings of actor 71 find it. */
  const ACTORS = new Map([['admin.one@example.org', 71], ['two@example.org', 72]]);

  function withTempDir(body: (dir: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), 'afldb-i235-od5-'));
    try { body(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  it('round-trips a non-empty combined capture through its hashed file, and refuses a tampered or foreign one', () => {
    withTempDir((dir) => {
      const c = capture();
      const written = writePendingCapture(dir, c);
      expect(written.path).toBe(join(dir, PENDING_CAPTURE_FILE));
      expect(written.sha256).toBe(createHash('sha256').update(readFileSync(written.path, 'utf8')).digest('hex'));
      const back = readPendingCapture(dir, 'afldb_test')!;
      expect(back).toEqual(c);
      expect(back.ledgerRows).toHaveLength(3);
      expect(back.ledgerRows[2].supersedesId).toBe(9);
      expect(back.importerRows).toHaveLength(1);
      expect(back.importerRows[0].externalId).toBe('CD_I2001');

      // reinstated into another rebuild target: refused
      expect(() => readPendingCapture(dir, 'code_test_db')).toThrow(/taken from 'afldb_test', not 'code_test_db'/);
      // altered after capture (one note byte): refused by the payload hash
      writeFileSync(written.path, readFileSync(written.path, 'utf8').replace('Revoked:', 'Revoked;'));
      expect(() => readPendingCapture(dir, 'afldb_test')).toThrow(/does not match its own payload hash/);
    });
    expect(captureDirectory('/r', 'afldb_test')).not.toBe(captureDirectory('/r', 'code_test_db'));
    expect(captureDirectory('/r', 'afldb_test')).toBe(join('/r', 'afldb_test'));
  });

  it('refuses a v2/ledger-only (ISSUE-235-era) capture file outright, never upgrading it (D10)', () => {
    withTempDir((dir) => {
      const legacyBody = {
        format: 'afldb.afl_api_identity_adjudications.rebuild_capture', version: 2,
        database: 'afldb_test', capturedAt: '2026-09-23T10:00:00.000Z', ledgerTablePresent: true,
        rows: ledger(),
      };
      writeFileSync(join(dir, PENDING_CAPTURE_FILE), JSON.stringify({ ...legacyBody, payloadSha256: 'x'.repeat(64) }));
      expect(() => readPendingCapture(dir, 'afldb_test'))
        .toThrow(/superseded ISSUE-235 ledger-only format.*refused, never upgraded/s);
    });
  });

  it('refuses a ledger that cannot be reinstated in id order', () => {
    const rows = ledger();
    expect(() => capture([rows[0], rows[2], rows[1]])).toThrow(/not strictly ascending|not an earlier captured row/);
    expect(() => capture([rows[0], { ...rows[2], supersedesId: 99 }])).toThrow(/supersedes_id 99 is not an earlier captured row/);
    expect(() => capture([{ ...rows[2], id: 5 }, rows[1]])).toThrow(AdjudicationRebuildRefused);
    expect(() => capture([{ ...rows[0], supersedesId: 1 }])).toThrow(/supersedes_id must be set exactly on a revoked row/);
    expect(() => capture([{ ...rows[0], createdAt: '2026-09-23 01:02:03+00' }])).toThrow(/created_at/);
    expect(() => capture([{ ...rows[0], adminEmail: ' ' }])).toThrow(/no email to remap by/);
    expect(() => buildCombinedCapture({
      database: 'afldb_test', capturedAt: 'x', ledgerTablePresent: false, ledgerRows: ledger(), importerRows: [],
    })).toThrow(/no ledger table cannot carry ledger rows/);
  });

  it('D13/D6: the importer section is structurally checked (duplicate provider/identity, unsupported method, shape)', () => {
    const a = importerRow();
    expect(() => capture(ledger(), [a, { ...a }]))
      .toThrow(/duplicate provider id/);
    expect(() => capture(ledger(), [a, importerRow({ externalId: 'CD_I2002' })]))
      .toThrow(/duplicate player identity/);
    expect(() => capture(ledger(), [importerRow({ matchMethod: 'not_a_method' as never })]))
      .toThrow(/unsupported match_method/);
    expect(() => capture(ledger(), [importerRow({ candidateCount: 2 as never })]))
      .toThrow(/candidate_count 2, expected 1/);
    expect(() => capture(ledger(), [importerRow({ externalUrl: 'https://x' as never })]))
      .toThrow(/external_url is not NULL/);
    expect(() => capture(ledger(), [importerRow({ playerIdentity: '' })]))
      .toThrow(/player_identity is empty/);
    // a structurally valid importer row is sorted by externalId, deterministically
    const c = capture(ledger(), [importerRow({ externalId: 'CD_I2002', playerIdentity: 'players/D/D.html', playerId: 503 }), importerRow()]);
    expect(c.importerRows.map((r) => r.externalId)).toEqual(['CD_I2001', 'CD_I2002']);
  });

  it('reinstates the original ids, supersedes_id and audit fields, remapping ONLY player_id and admin_user_id', () => {
    const plan = planLedgerReinstatement({ rows: ledger(), remapByIdentity: REMAP, actorIdByEmail: ACTORS });
    expect(plan.maxId).toBe(12);
    expect(plan.rows.map((r) => r.id)).toEqual([7, 9, 12]);
    expect(plan.rows.map((r) => r.playerId)).toEqual([9001, 9002, 9002]);   // never 500/501
    expect(plan.rows.map((r) => r.adminUserId)).toEqual([71, 72, 71]);      // one actor, two spellings
    expect(plan.rows.map((r) => r.supersedesId)).toEqual([null, null, 9]);
    for (const [i, original] of ledger().entries()) {
      const { playerId: _p, adminUserId: _a, adminEmail: _e, adminRole: _r, ...kept } = original;
      expect(plan.rows[i]).toMatchObject(kept);
      expect(plan.rows[i]).not.toHaveProperty('adminEmail');
      expect(plan.rows[i]).not.toHaveProperty('adminRole');
    }
  });

  it('refuses the whole reinstatement on any identity that does not remap to exactly one player', () => {
    const withEntry = (identity: string, result: AflApiPlayerRemapResult) =>
      new Map<string, AflApiPlayerRemapResult>([...REMAP, [identity, result]]);
    const cases: Array<[ReadonlyMap<string, AflApiPlayerRemapResult>, RegExp]> = [
      [new Map([...REMAP].filter(([k]) => k !== 'players/B/Bravo_Baker.html')),
        /ledger row 9 \(CD_I1002\).*names no rebuilt player/],
      [withEntry('players/B/Bravo_Baker.html', { ok: false, reason: 'ambiguous' }),
        /names more than one rebuilt player/],
      [withEntry('players/A/Alpha_Able.html', { ok: true, newPlayerId: 9001, remappedIdentity: 'players/A/Other.html' }),
        /remapped identity differs from the stored one/],
    ];
    for (const [remapByIdentity, pattern] of cases) {
      expect(() => planLedgerReinstatement({ rows: ledger(), remapByIdentity, actorIdByEmail: ACTORS }))
        .toThrow(pattern);
    }
    // a manual_admin_edit identity with no data_overrides on afldb_test is exactly this stop
    expect(() => planLedgerReinstatement({
      rows: [{ ...ledger()[0], playerIdentity: 'manual_admin_edit:token-1' }],
      remapByIdentity: new Map(), actorIdByEmail: ACTORS,
    })).toThrow(/nothing was written.*manual_admin_edit:token-1.*names no rebuilt player/);
    // and an actor that was not remapped
    expect(() => planLedgerReinstatement({
      rows: ledger(), remapByIdentity: REMAP, actorIdByEmail: new Map([['two@example.org', 72]]),
    })).toThrow(/ledger row 7 \(CD_I1001\): its actor was not remapped/);
  });

  it('proves the identity sequence hands out an id above the reinstated maximum', () => {
    expect(nextIdentityValue({ lastValue: 12, isCalled: true })).toBe(13);
    expect(nextIdentityValue({ lastValue: 1, isCalled: false })).toBe(1);
    expect(() => assertSequenceAboveLedger({ lastValue: 12, isCalled: true }, 12)).not.toThrow();
    // a setval that never happened: the fresh sequence would hand out 1 and collide
    expect(() => assertSequenceAboveLedger({ lastValue: 1, isCalled: false }, 12)).toThrow(/does not exceed the reinstated maximum id 12/);
    expect(() => assertSequenceAboveLedger({ lastValue: 12, isCalled: false }, 12)).toThrow(/would next hand out 12/);
    // empty ledger: the fresh sequence is already above 0
    expect(() => assertSequenceAboveLedger({ lastValue: 1, isCalled: false }, 0)).not.toThrow();
  });

  it('requires the read-back ledger to equal the plan byte-for-byte', () => {
    const plan = planLedgerReinstatement({ rows: ledger(), remapByIdentity: REMAP, actorIdByEmail: ACTORS });
    expect(reinstatedLedgerProblems(plan.rows, plan.rows.map((r) => ({ ...r })))).toEqual([]);
    const drifted = plan.rows.map((r) => (r.id === 12 ? { ...r, createdAt: '2026-09-23T03:00:00.000001Z' } : r));
    expect(reinstatedLedgerProblems(plan.rows, drifted)).toEqual(['ledger row 12 was not reinstated byte-for-byte']);
    expect(reinstatedLedgerProblems(plan.rows, plan.rows.slice(0, 2))).toEqual(['3 row(s) planned but 2 read back']);
  });

  it('treats an empty capture as valid — including one from before migration 104', () => {
    const empty = buildCombinedCapture({
      database: 'afldb_test', capturedAt: '2026-09-23T10:00:00.000Z', ledgerTablePresent: false,
      ledgerRows: [], importerRows: [],
    });
    expect(empty.ledgerRows).toEqual([]);
    expect(empty.importerRows).toEqual([]);
    expect(planLedgerReinstatement({ rows: [], remapByIdentity: new Map(), actorIdByEmail: new Map() }))
      .toEqual({ rows: [], maxId: 0 });
    withTempDir((dir) => {
      writePendingCapture(dir, empty);
      expect(readPendingCapture(dir, 'afldb_test')).toEqual(empty);
    });
  });

  it('D11c: never lets a re-run overwrite a capture an earlier failed run did not reinstate — no decision ever splits the sections', () => {
    const pending = capture();
    const live = ledger();
    const importerLive = [importerRow()];
    expect(decidePendingCapture({ markerPresent: false, pending: null, liveLedgerRows: live, liveImporterRows: importerLive, recover: false }))
      .toEqual({ action: 'capture-live' });
    expect(decidePendingCapture({ markerPresent: false, pending: null, liveLedgerRows: [], liveImporterRows: [], recover: true }).action)
      .toBe('refuse');
    // same state, different surrogates and email case (a reinstated database): nothing lost
    const reinstated = live.map((r) => ({ ...r, playerId: r.playerId + 8000, adminUserId: 70,
      adminEmail: r.adminEmail.toUpperCase() }));
    const reinstatedImporter = importerLive.map((r) => ({ ...r, playerId: r.playerId + 8000 }));
    expect(sameLedger(pending.ledgerRows, reinstated)).toBe(true);
    expect(sameImporterRows(pending.importerRows, reinstatedImporter)).toBe(true);
    // … but "nothing lost" is proven, not assumed: see the post-commit/pre-archive cases below
    expect(decidePendingCapture({
      markerPresent: false, pending, liveLedgerRows: reinstated, liveImporterRows: reinstatedImporter, recover: false,
    })).toEqual({ action: 'verify-reinstated' });
    // an empty pending capture over an empty live state is STILL a completed reinstatement to
    // verify and archive (D11c has no empty-capture special case: "equal to the pending
    // capture" -> verify-reinstated, whatever the sizes are). Only the ABSENCE of a pending
    // file at all is capture-live (the very first assertion in this test, above).
    const emptyPending = capture([], []);
    expect(decidePendingCapture({ markerPresent: false, pending: emptyPending, liveLedgerRows: [], liveImporterRows: [], recover: false }))
      .toEqual({ action: 'verify-reinstated' });
    // the failed run's reset destroyed the state: refuse, and name the recovery flag
    const lost = decidePendingCapture({ markerPresent: false, pending, liveLedgerRows: [], liveImporterRows: [], recover: false });
    expect(lost.action).toBe('refuse');
    expect(lost.action === 'refuse' && lost.reason).toMatch(/3 ledger row\(s\), 1 importer row\(s\).*--recover-afl-api-adjudications/s);
    expect(decidePendingCapture({ markerPresent: false, pending, liveLedgerRows: [], liveImporterRows: [], recover: true }))
      .toEqual({ action: 'adopt-pending' });
    // a live ledger that differs is never chosen over, or overwritten by, the pending one
    const differs = decidePendingCapture({
      markerPresent: false, pending, liveLedgerRows: live.slice(0, 2), liveImporterRows: importerLive, recover: true,
    });
    expect(differs.action).toBe('refuse');
    expect(sameLedger(pending.ledgerRows, live.map((r) => (r.id === 7 ? { ...r, note: `${r.note}!` } : r)))).toBe(false);
    // a live importer section that differs is likewise never chosen over the pending one, even
    // when the ledger section alone matches — no decision splits the two sections (D11c)
    const importerDiffers = decidePendingCapture({
      markerPresent: false, pending, liveLedgerRows: live, liveImporterRows: [importerRow({ notes: 'changed' })], recover: false,
    });
    expect(importerDiffers.action).toBe('refuse');
  });

  it('retires the pending capture only by archiving it, never by deleting it', () => {
    withTempDir((dir) => {
      const c = capture();
      writePendingCapture(dir, c);
      const archived = archivePendingCapture(dir, c);
      expect(existsSync(join(dir, PENDING_CAPTURE_FILE))).toBe(false);
      expect(archived).toMatch(/afl-api-identities\.20260923T100000000Z\.[0-9a-f]{12}\.reinstated\.json$/);
      expect(parseCombinedCapture(readFileSync(archived, 'utf8'), 'afldb_test')).toEqual(c);
      expect(readPendingCapture(dir, 'afldb_test')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Actor attribution: the captured ROLE, never a hard-coded one; reuse before create.
  // -------------------------------------------------------------------------

  /**
   * A TransactionSql stand-in that records every statement (text with $n placeholders, and
   * its parameters) and answers from `respond`. Enough for the code paths below, which
   * never reach the replay adapter.
   */
  function fakeTx(respond: (text: string, params: unknown[]) => unknown[] = () => []) {
    const statements: Array<{ text: string; params: unknown[] }> = [];
    const tx = (strings: unknown, ...params: unknown[]) => {
      if (Array.isArray(strings) && 'raw' in strings) {
        const text = (strings as string[]).reduce((acc, s, i) => `${acc}${i ? `$${i}` : ''}${s}`, '')
          .replace(/\s+/g, ' ').trim();
        statements.push({ text, params });
        return Promise.resolve(respond(text, params));
      }
      return { identifier: strings };
    };
    return { tx: tx as unknown as TransactionSql, statements };
  }
  const WRITES = /\b(INSERT|UPDATE|DELETE|setval)\b/i;

  it('pins the role contract to auth_users_role_check, and captures each actor role through the hashed file', () => {
    // the contract isLifecycleRole() enforces is exactly the live CHECK (migration 033, never redefined since)
    const migrations = join(root, 'src', 'db', 'migrations');
    const redefining = readdirSync(migrations)
      .filter((f) => readFileSync(join(migrations, f), 'utf8').includes('auth_users_role_check'));
    expect(redefining).toEqual(['029_admin_roles.sql', '033_contributor_role.sql']);
    const check = readFileSync(join(migrations, '033_contributor_role.sql'), 'utf8')
      .match(/auth_users_role_check\s+CHECK \(role IN \(([^)]*)\)\)/)!;
    const roles = check[1].split(',').map((s) => s.trim().replace(/'/g, ''));
    expect([...roles].sort()).toEqual(['admin', 'contributor', 'super_admin']);
    for (const role of roles) expect(isLifecycleRole(role), role).toBe(true);
    for (const role of ['owner', 'Admin', 'SUPER_ADMIN', '', null]) expect(isLifecycleRole(role)).toBe(false);

    // AFLDB-ISSUE-245: version 2 carries the registration section
    expect(CAPTURE_VERSION).toBe(2);
    expect(CAPTURE_FORMAT).toBe('afldb.afl_api_identities.rebuild_capture');
    withTempDir((dir) => {
      writePendingCapture(dir, capture());
      expect(readPendingCapture(dir, 'afldb_test')!.ledgerRows.map((r) => r.adminRole))
        .toEqual(['super_admin', 'admin', 'super_admin']);
    });
  });

  it('refuses an invalid or inconsistent captured role — never converting it — before anything is written', () => {
    const rows = ledger();
    const invalid = [{ ...rows[0], adminRole: 'owner' as never }, rows[1], rows[2]];
    expect(() => capture(invalid)).toThrow(/ledger row 7: the actor's role 'owner' is not one auth_users.role allows/);
    // one actor (two spellings of one email) captured with two roles
    expect(() => capture([rows[0], rows[1], { ...rows[2], adminRole: 'admin' }]))
      .toThrow(/ledger row 12: its actor is captured with a different role from ledger row 7's/);

    withTempDir((dir) => {
      // a file whose payload hash is VALID but whose role is not: the parse itself refuses,
      // so the reinstate stage never opens its transaction
      const body: Omit<CombinedCapture, 'payloadSha256'> = {
        format: CAPTURE_FORMAT, version: CAPTURE_VERSION,
        database: 'afldb_test', capturedAt: '2026-09-23T10:00:00.000Z', ledgerTablePresent: true,
        ledgerRows: invalid, importerRows: [], registrations: [] };
      const path = join(dir, PENDING_CAPTURE_FILE);
      writeFileSync(path, JSON.stringify({ ...body, payloadSha256: capturePayloadSha256(body) }));
      expect(() => readPendingCapture(dir, 'afldb_test')).toThrow(/role 'owner' is not one auth_users.role allows/);
      // an unknown version is refused outright, never defaulted
      writeFileSync(path, JSON.stringify({ ...capture(), version: 99 }));
      expect(() => readPendingCapture(dir, 'afldb_test')).toThrow(/unknown format or version/);
    });

    // and inside the reinstate itself, a role that slipped past the parse issues NO statement
    const { tx, statements } = fakeTx();
    const smuggled = { ...capture(), ledgerRows: invalid } as CombinedCapture;
    return expect(reinstateAndReplay(tx, smuggled)).rejects.toThrow(/nothing was written.*role 'owner'/)
      .then(() => expect(statements).toEqual([]));
  });

  it('plans one actor per case-insensitive email: reuse the existing account unchanged, else create with the captured role', () => {
    // no accounts on the rebuilt database: two actors, the FIRST spelling, the CAPTURED role
    const fresh = planActorRemap(ledger(), []);
    expect(fresh.reuse.size).toBe(0);
    expect(fresh.create).toEqual([
      { email: 'Admin.One@Example.org', role: 'super_admin' },
      { email: 'two@example.org', role: 'admin' },
    ]);
    // nothing but email and role: no credential, TOTP, session or capability field exists to carry
    for (const a of fresh.create) expect(Object.keys(a).sort()).toEqual(['email', 'role']);

    // an existing account, differently cased and in a different CURRENT role, is reused as it is
    const reused = planActorRemap(ledger(), [{ id: 71, email: 'ADMIN.ONE@example.ORG', role: 'contributor' }]);
    expect([...reused.reuse]).toEqual([['admin.one@example.org', 71]]);
    expect(reused.create).toEqual([{ email: 'two@example.org', role: 'admin' }]);
    expect(reused.reusedWithDifferentRole).toBe(1);
    expect(planActorRemap(ledger(), [{ id: 72, email: 'two@example.org', role: 'admin' }]).reusedWithDifferentRole).toBe(0);

    // an email that matches two accounts is refused, not guessed
    expect(() => planActorRemap(ledger(), [
      { id: 71, email: 'admin.one@example.org', role: 'admin' },
      { id: 81, email: 'Admin.One@example.org', role: 'admin' },
    ])).toThrow(/actor of ledger row 7 matches 2 auth_users rows/);
    expect(() => planActorRemap([{ ...ledger()[0], adminRole: 'root' as never }], []))
      .toThrow(/nothing was written.*role 'root'/);
  });

  it('writes an attribution-only actor with the captured role, NULL credentials and disabled_at — and never touches a reused one', async () => {
    const { tx, statements } = fakeTx((text) => {
      if (text.startsWith('SELECT id, email, role FROM auth_users')) {
        return [{ id: 71, email: 'admin.one@EXAMPLE.org', role: 'admin' }];
      }
      if (text.startsWith('INSERT INTO auth_users')) return [{ id: 900 }];
      throw new Error(`unexpected statement: ${text}`);
    });
    const result = await remapActors(tx, ledger());

    expect(statements).toHaveLength(2);
    expect(statements[0].text).toBe('SELECT id, email, role FROM auth_users WHERE lower(email) = ANY($1::text[])');
    expect(statements[0].params).toEqual([['admin.one@example.org', 'two@example.org']]);
    // exactly one INSERT, for the actor with no account; credentials are SQL literals, not parameters
    expect(statements[1].text).toBe('INSERT INTO auth_users (email, role, password_hash, totp_secret, disabled_at) '
      + 'VALUES ($1, $2, NULL, NULL, now()) RETURNING id');
    expect(statements[1].params).toEqual(['two@example.org', 'admin']);
    expect(statements.map((s) => s.text).join('\n')).not.toMatch(/UPDATE|DELETE|auth_sessions|can_manage_admins/i);

    expect([...result.actorIdByEmail]).toEqual([['admin.one@example.org', 71], ['two@example.org', 900]]);
    expect(result).toMatchObject({ reused: 1, created: 1, reusedWithDifferentRole: 1 });
    // both spellings of actor 71 land on the reused account; the created one takes row 9
    const plan = planLedgerReinstatement({ rows: ledger(), remapByIdentity: REMAP, actorIdByEmail: result.actorIdByEmail });
    expect(plan.rows.map((r) => r.adminUserId)).toEqual([71, 900, 71]);
  });

  // -------------------------------------------------------------------------
  // The post-commit / pre-archive crash: reinstate COMMITTED, the process died before
  // capture.json -> reinstated.json, and the operator re-runs (with or without --recover).
  // -------------------------------------------------------------------------

  /** The rebuilt database after the committed reinstate: new surrogates, a reused actor's role. */
  const reinstatedLive = (): CapturedLedgerRow[] => ledger().map((r) => ({
    ...r, playerId: r.playerId === 500 ? 9001 : 9002, adminUserId: r.adminRole === 'admin' ? 900 : 71,
    adminEmail: r.adminEmail.toLowerCase(), adminRole: 'admin' as const,
  }));
  const reinstatedImporterLive = (): CapturedImporterRow[] => [importerRow({ playerId: 9003 })];
  const VERIFIED: LiveReinstatementObservation = {
    sequence: { lastValue: 12, isCalled: true },
    replay: { inserted: 0, noops: 1, stops: [], supersedes: [] },
    importerReplay: { inserted: 0, noops: 0 },
    bijection: 'ok',
  };
  /** Wraps a pending capture with the fileSha256 `readPendingCaptureWithHash` would report. */
  const withHash = (c: CombinedCapture) => ({ capture: c, fileSha256: fileSha256Of(c) });
  function fileSha256Of(c: CombinedCapture): string {
    return createHash('sha256').update(`${JSON.stringify(c, null, 2)}\n`, 'utf8').digest('hex');
  }

  it('recognises a committed-but-unarchived reinstatement, archives it and captures afresh — idempotently, with no re-insert', () => {
    withTempDir((dir) => {
      const pending = capture();
      writePendingCapture(dir, pending);
      const ledgerRows = reinstatedLive();
      const importerRows = reinstatedImporterLive();
      for (const recover of [true, false]) {
        expect(decidePendingCapture({ markerPresent: false, pending, liveLedgerRows: ledgerRows, liveImporterRows: importerRows, recover }))
          .toEqual({ action: 'verify-reinstated' });
      }
      expect(reinstatedCaptureProblems(pending, ledgerRows, importerRows, VERIFIED)).toEqual([]);

      const first = settleCapture({
        dir, database: 'afldb_test', capturedAt: '2026-09-23T11:00:00.000Z', pending: withHash(pending),
        live: { ledgerPresent: true, ledgerRows, importerRows },
        decision: decidePendingCapture({ markerPresent: false, pending, liveLedgerRows: ledgerRows, liveImporterRows: importerRows, recover: true }),
        observed: VERIFIED,
      });
      // never adopted: adopting would make the reinstate stage insert these ids a second time
      expect(first.adopted).toBeNull();
      // the pending capture is kept, byte-for-byte, as reinstated …
      expect(first.archived).toBe(join(dir, archivedCaptureName(pending)));
      expect(parseCombinedCapture(readFileSync(first.archived!, 'utf8'), 'afldb_test')).toEqual(pending);
      // … and this run's capture is the live state: same decisions, same ids, same supersession
      const fresh = readPendingCapture(dir, 'afldb_test')!;
      expect(fresh).toEqual(first.captured!.capture);
      expect(fresh.ledgerRows.map((r) => [r.id, r.action, r.supersedesId])).toEqual([[7, 'linked', null], [9, 'linked', null], [12, 'revoked', 9]]);
      expect(fresh.ledgerRows.map((r) => r.playerId)).toEqual([9001, 9002, 9002]);
      expect(fresh.importerRows.map((r) => r.playerId)).toEqual([9003]);
      expect(sameLedger(fresh.ledgerRows, pending.ledgerRows)).toBe(true);
      expect(first.markerAction.kind).toBe('clear-then-set');

      // the rerun dies AGAIN before the reset, and the operator re-runs once more: the same
      // path, the same three ledger rows and one importer row, a second archive — never a
      // duplicate and never a loss
      const again = settleCapture({
        dir, database: 'afldb_test', capturedAt: '2026-09-23T12:00:00.000Z', pending: withHash(fresh),
        live: { ledgerPresent: true, ledgerRows, importerRows },
        decision: decidePendingCapture({ markerPresent: false, pending: fresh, liveLedgerRows: ledgerRows, liveImporterRows: importerRows, recover: true }),
        observed: VERIFIED,
      });
      expect(again.adopted).toBeNull();
      expect(again.captured!.capture.ledgerRows).toHaveLength(3);
      const files = readdirSync(dir).sort();
      expect(files.filter((f) => f.endsWith('.reinstated.json'))).toHaveLength(2);
      expect(files).toContain(PENDING_CAPTURE_FILE);
      expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([]);
    });
  });

  it('refuses already_reinstated_unverified — pending capture untouched — unless sequence, both replays and bijection all prove it', () => {
    const ledgerRows = reinstatedLive();
    const importerRows = reinstatedImporterLive();
    const cases: Array<[LiveReinstatementObservation | null, RegExp]> = [
      [{ ...VERIFIED, sequence: { lastValue: 11, isCalled: true } }, /would next hand out 12, which does not exceed the reinstated maximum id 12/],
      [{ ...VERIFIED, sequence: { lastValue: 1, isCalled: false } }, /does not exceed the reinstated maximum id 12/],
      [{ ...VERIFIED, replay: { inserted: 1, noops: 0, stops: [], supersedes: [] } }, /a replay would still insert 1 human identity row/],
      [{ ...VERIFIED, replay: { error: 'cannot execute INSERT in a read-only transaction' } },
        /replay could not confirm the human identities: cannot execute INSERT in a read-only transaction/],
      [{ ...VERIFIED, importerReplay: { inserted: 1, noops: 0 } }, /a replay would still insert 1 importer identity row/],
      [{ ...VERIFIED, importerReplay: { error: 'cannot execute INSERT in a read-only transaction' } },
        /replay could not confirm the importer identities/],
      [{ ...VERIFIED, bijection: { error: 'afl_api adjudication bijection check failed (1 mismatch(es))' } },
        /the bijection does not hold/],
      [null, /the live database was not observed/],
    ];
    for (const [observed, pattern] of cases) {
      withTempDir((dir) => {
        const pending = capture();
        const { path } = writePendingCapture(dir, pending);
        const before = readFileSync(path, 'utf8');
        expect(() => settleCapture({
          dir, database: 'afldb_test', capturedAt: '2026-09-23T11:00:00.000Z', pending: withHash(pending),
          live: { ledgerPresent: true, ledgerRows, importerRows },
          decision: { action: 'verify-reinstated' }, observed,
        })).toThrow(new RegExp(`already_reinstated_unverified.*${pattern.source}`, 's'));
        expect(readFileSync(path, 'utf8')).toBe(before);
        expect(readdirSync(dir)).toEqual([PENDING_CAPTURE_FILE]);
      });
    }
    // and a live ledger that is NOT the capture is never "verified", whatever was observed
    expect(reinstatedCaptureProblems(capture(), reinstatedLive().slice(0, 2), importerRows, VERIFIED))
      .toContain('the live ledger differs from the pending capture');
    // likewise for the importer section, even when the ledger section matches exactly
    expect(reinstatedCaptureProblems(capture(), ledgerRows, [importerRow({ notes: 'changed', playerId: 9003 })], VERIFIED))
      .toContain('the live importer identities differ from the pending capture');
  });

  it('never replaces lost state with the rebuilt database\'s empty one', () => {
    withTempDir((dir) => {
      const pending = capture();
      const { path } = writePendingCapture(dir, pending);
      const before = readFileSync(path, 'utf8');
      const empty = { ledgerPresent: true, ledgerRows: [] as CapturedLedgerRow[], importerRows: [] as CapturedImporterRow[] };
      // without --recover: refused, nothing written
      expect(() => settleCapture({
        dir, database: 'afldb_test', capturedAt: '2026-09-23T11:00:00.000Z', pending: withHash(pending), live: empty,
        decision: decidePendingCapture({ markerPresent: false, pending, liveLedgerRows: [], liveImporterRows: [], recover: false }),
        observed: null,
      })).toThrow(/--recover-afl-api-adjudications/);
      // with --recover: the pending capture IS this run's; no empty capture is written over it
      const adopted = settleCapture({
        dir, database: 'afldb_test', capturedAt: '2026-09-23T11:00:00.000Z', pending: withHash(pending), live: empty,
        decision: decidePendingCapture({ markerPresent: false, pending, liveLedgerRows: [], liveImporterRows: [], recover: true }),
        observed: null,
      });
      expect(adopted.adopted).toEqual(pending);
      expect(adopted.archived).toBeNull();
      expect(adopted.captured).toBeNull();
      expect(adopted.markerAction.kind).toBe('set-if-absent');
      expect(readFileSync(path, 'utf8')).toBe(before);
      expect(readdirSync(dir)).toEqual([PENDING_CAPTURE_FILE]);
    });
  });

  it('reinstate binds the captured jsonb/timestamptz text AS text, so PostgreSQL parses the captured bytes; the read-back stays exact', () => {
    // postgres.js types each parameter by the server's inference: `${text}::jsonb` would be
    // JSON.stringified a second time, `${text}::timestamptz` routed through a JS Date (ms only).
    const tool = readFileSync(join(root, 'tools', 'migration', 'rebuild_afl_api_adjudications.ts'), 'utf8');
    const start = tool.indexOf('export async function reinstateAndReplay(');
    const fn = tool.slice(start, tool.indexOf('\n}', start));
    const insert = fn.slice(fn.indexOf('INSERT INTO afl_api_identity_adjudications'), fn.indexOf('`;', fn.indexOf('OVERRIDING SYSTEM VALUE')));
    expect(insert).toContain('${r.previousState}::text::jsonb');
    expect(insert).toContain('${r.evidence}::text::jsonb');
    expect(insert).toContain('${r.createdAt}::text::timestamptz');
    expect(insert).not.toMatch(/\}::(jsonb|json|timestamptz|timestamp)\b/);
    expect(insert).not.toMatch(/JSON\.stringify|tx\.json|new Date/);
    // the capture keeps PostgreSQL's own text, with microseconds -- not lowered to fit the driver
    expect(tool).toContain('a.previous_state::text AS "previousState", a.evidence::text AS evidence');
    expect(tool).toContain(`to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);
    // and the exact field-for-field read-back still runs after the INSERTs, before the replay
    const inserted = fn.indexOf('INSERT INTO afl_api_identity_adjudications');
    const readBack = fn.indexOf('reinstatedLedgerProblems(');
    expect(readBack).toBeGreaterThan(inserted);
    expect(fn.indexOf('replayAflApiAdjudications(tx, new Set())')).toBeGreaterThan(readBack);
    expect(tool).toMatch(/JSON\.stringify\(ledgerTuple\(readBack\[i\]\)\) !== JSON\.stringify\(ledgerTuple\(p\)\)/);
    // AFLDB-ISSUE-237 Stage 18 order (a)-(e): importer replay, then the ledger INSERTs, then the
    // D15 replay, then parity + the combined invariant, then the marker clear -- LAST.
    const importerReplay = fn.indexOf('replayAflApiImporterRows(tx, capture.importerRows)');
    const d15Replay = fn.indexOf('replayAflApiAdjudications(tx, new Set())');
    const parity = fn.indexOf('importerParityProblems(');
    const invariant = fn.indexOf('assertAflApiIdentityInvariant(tx)');
    const markerClear = fn.indexOf('clearRebuildMarker(tx, capture.database)');
    expect(importerReplay).toBeGreaterThan(-1);
    expect(inserted).toBeGreaterThan(importerReplay);
    expect(d15Replay).toBeGreaterThan(readBack);
    expect(parity).toBeGreaterThan(d15Replay);
    expect(invariant).toBeGreaterThan(parity);
    expect(markerClear).toBeGreaterThan(invariant);
    // and the marker clear is the LAST statement before the function returns its report
    expect(fn.indexOf('return {', markerClear)).toBeGreaterThan(markerClear);
  });

  it('the reinstate stage itself refuses a ledger that is already populated, before any write', async () => {
    const raw = ledger().map((r) => ({ ...r, id: String(r.id), supersedesId: r.supersedesId === null ? null : String(r.supersedesId) }));
    const c = capture();
    const marker = JSON.stringify({
      format: CAPTURE_FORMAT, version: CAPTURE_VERSION, capturedAt: c.capturedAt,
      payloadSha256: c.payloadSha256, fileSha256: 'd'.repeat(64),
    });
    const { tx, statements } = fakeTx((text) => {
      if (text === 'SELECT current_database() AS actual') return [{ actual: 'afldb_test' }];
      if (text.includes('shobj_description')) return [{ comment: marker }];
      if (text.includes('to_regclass')) return [{ present: true }];
      if (text.includes('FROM afl_api_identity_adjudications a')) return raw;
      if (text.includes('count(*)')) return [{ total: raw.length }];
      throw new Error(`unexpected statement: ${text}`);
    });
    await expect(reinstateAndReplay(tx, c))
      .rejects.toThrow(/The rebuilt ledger already holds 3 row\(s\); reinstatement needs it empty/);
    // marker read (2) + ledger read (3): nothing else, and no write anywhere
    expect(statements).toHaveLength(5);
    for (const s of statements) expect(s.text).not.toMatch(WRITES);
  });

  it('P-M point 4 (DB-free): the marker clear runs ONLY inside the Stage 18 transaction, after '
     + 'every other step, and a thrown failure before it never reaches it', async () => {
    // 1. A capture whose E_rebuild is non-empty (an agreeing importer/ledger overlap, OD-6)
    //    throws before ANY statement -- the marker read never even runs, so the marker is
    //    trivially never cleared on this path.
    const overlapping = capture(ledger(), [importerRow({ externalId: 'CD_I1001', playerIdentity: 'players/A/Alpha_Able.html', playerId: 9001 })]);
    const { tx: tx1, statements: s1 } = fakeTx();
    await expect(reinstateAndReplay(tx1, overlapping)).rejects.toThrow(/E_rebuild is not empty in the capture file \(OD-6\)/);
    expect(s1).toEqual([]);

    // 2. No marker present at all: refuses before the ledger/importer are ever read, and
    //    certainly before any clear.
    const { tx: tx2, statements: s2 } = fakeTx((text) => {
      if (text === 'SELECT current_database() AS actual') return [{ actual: 'afldb_test' }];
      if (text.includes('shobj_description')) return [{ comment: null }];
      throw new Error(`unexpected statement: ${text}`);
    });
    await expect(reinstateAndReplay(tx2, capture())).rejects.toThrow(/No rebuild marker is present/);
    expect(s2.some((s) => s.text.includes('COMMENT ON DATABASE'))).toBe(false);

    // 3. The marker present but for a DIFFERENT payload: refuses before the clear, which is
    //    exactly what protects a rolled-back Stage 18 from losing an unrelated pending marker.
    const { tx: tx3, statements: s3 } = fakeTx((text) => {
      if (text === 'SELECT current_database() AS actual') return [{ actual: 'afldb_test' }];
      if (text.includes('shobj_description')) {
        return [{ comment: JSON.stringify({ format: CAPTURE_FORMAT, version: CAPTURE_VERSION, capturedAt: 'x', payloadSha256: 'f'.repeat(64), fileSha256: 'f'.repeat(64) }) }];
      }
      throw new Error(`unexpected statement: ${text}`);
    });
    await expect(reinstateAndReplay(tx3, capture())).rejects.toThrow(/does not match the pending capture file/);
    expect(s3.some((s) => s.text.includes('COMMENT ON DATABASE'))).toBe(false);

    // Source-level proof (combined with the ordering test above) that the marker clear is
    // never reached by any early-return/throw path other than falling through every one of
    // (a)-(d) first, and that it is the LAST write before the function returns -- so a thrown
    // error at (a), (b), (c) or (d) always precedes it, and postgres.js rolls the WHOLE
    // transaction back on any thrown error, restoring whatever comment existed before this
    // call ran (P-M point 2 already proves RESET_SQL cannot itself touch the comment; this
    // proves Stage 18 never clears it early).
    const tool = readFileSync(join(root, 'tools', 'migration', 'rebuild_afl_api_adjudications.ts'), 'utf8');
    const fnStart = tool.indexOf('export async function reinstateAndReplay(');
    const fnEnd = tool.indexOf('\n}', fnStart);
    const fn = tool.slice(fnStart, fnEnd);
    // Exactly one clear inside THIS function, and it is the call, not a re-declaration.
    const callsInFn = [...fn.matchAll(/clearRebuildMarker\(/g)];
    expect(callsInFn).toHaveLength(1);
    expect(fn).toContain('await clearRebuildMarker(tx, capture.database);');
    // Nothing after the clear except building and returning the report — no further statement
    // that could itself throw and strand a cleared-but-uncommitted marker outside a rollback.
    const afterClear = fn.slice(fn.indexOf('await clearRebuildMarker(tx, capture.database);') + 1);
    expect(afterClear).not.toMatch(/await tx[`.]/);
  });

  // -------------------------------------------------------------------------
  // P-M point 4, tightened (2026-09-24): a REAL, stateful fake transaction that runs the
  // WHOLE Stage 18 body (reinstateAndReplay) to completion — every production function it
  // calls (replayAflApiImporterRows, the ledger INSERTs, replayAflApiAdjudications,
  // assertAflApiIdentityInvariant, clearRebuildMarker) executes for real against this store;
  // only the SQL executor is faked, and even that never re-implements a DECISION (the pure
  // planners run for real against whatever this store's queries return). Complements the live
  // P-M point 2 proof (COMMENT ON DATABASE survives RESET_SQL and is itself transactional,
  // proven against real afldb_test, §11(d)2): this proves the other half — that Stage 18's
  // OWN transaction boundary is what the marker clear lives inside, end to end.
  // -------------------------------------------------------------------------

  type FakeExternalIdentityRow = {
    externalId: string; playerId: number; status: string; matchMethod: string | null;
    candidateCount: number; externalUrl: string | null; externalName: string | null; notes: string | null;
  };
  type FakeLedgerRow = {
    id: number; sourceKey: string; externalId: string; action: 'linked' | 'revoked'; playerId: number;
    playerIdentity: string; previousState: string | null; evidence: string; evidenceSha256: string;
    surnameDisagreementAcknowledged: boolean; supersedesId: number | null; adminUserId: number;
    note: string; createdAt: string;
  };
  type RebuildStore = {
    marker: string | null;
    ledgerRows: FakeLedgerRow[];
    afApiRows: FakeExternalIdentityRow[];
    authUsers: { id: number; email: string; role: string }[];
    sequence: { lastValue: number; isCalled: boolean };
    stableIdentities: { externalId: string; playerId: number }[];
  };
  const LEDGER_SEQ_QUALIFIED = 'public.afl_api_identity_adjudications_id_seq';

  /** A rebuilt-but-otherwise-empty database, exactly Stage 18's precondition: no ledger row,
   * no importer row — plus the AFL Tables identities `fitzroy` (stage 7) already wrote, which
   * is what `resolveAflApiPlayerIdentity`/`readAflApiForwardIdentities` resolve the fixture's
   * `players/A|B|C/....html` stable identities to on THIS rebuilt database. */
  function createRebuildStore(markerObj: RebuildMarker | null): RebuildStore {
    return {
      marker: markerObj ? JSON.stringify(markerObj) : null,
      ledgerRows: [], afApiRows: [], authUsers: [],
      sequence: { lastValue: 1, isCalled: false },
      stableIdentities: [
        { externalId: 'players/A/Alpha_Able.html', playerId: 9001 },
        { externalId: 'players/B/Bravo_Baker.html', playerId: 9002 },
        { externalId: 'players/C/Charlie_Cooper.html', playerId: 9003 },
      ],
    };
  }

  /**
   * A REAL SQL executor bound to `store`, not a scripted responder: every statement
   * `reinstateAndReplay` and its callees actually issue is interpreted against `store` and
   * mutates it exactly as PostgreSQL would for that statement. No pure decision function
   * (`planAflApiAdjudicationReplay`, `planAflApiImporterReplay`, `checkAflApiIdentityInvariant`,
   * …) is re-implemented here — only their SQL inputs are supplied, so their real decisions
   * run for real, against a single mutable `store` that stands in for the one open
   * transaction (no concurrent writer exists in this test).
   */
  function statefulTx(store: RebuildStore, database = 'afldb_test') {
    const statements: Array<{ text: string; params: unknown[] }> = [];
    let nextAuthUserId = 900;

    function respond(text: string, params: unknown[]): unknown[] {
      if (text === 'SELECT current_database() AS actual') return [{ actual: database }];
      if (text.includes('shobj_description')) return [{ comment: store.marker }];
      if (text.includes('to_regclass')) return [{ present: true }];
      if (text.includes('JOIN auth_users u')) {
        return [...store.ledgerRows].sort((a, b) => a.id - b.id).map((r) => {
          const actor = store.authUsers.find((a) => a.id === r.adminUserId)!;
          return {
            id: String(r.id), sourceKey: r.sourceKey, externalId: r.externalId, action: r.action,
            playerId: r.playerId, playerIdentity: r.playerIdentity, previousState: r.previousState,
            evidence: r.evidence, evidenceSha256: r.evidenceSha256,
            surnameDisagreementAcknowledged: r.surnameDisagreementAcknowledged,
            supersedesId: r.supersedesId === null ? null : String(r.supersedesId),
            adminUserId: r.adminUserId, adminEmail: actor.email, adminRole: actor.role,
            note: r.note, createdAt: r.createdAt,
          };
        });
      }
      if (text.includes('count(*)::int AS total FROM afl_api_identity_adjudications')) {
        return [{ total: store.ledgerRows.length }];
      }
      if (text === "SELECT id FROM sources WHERE key = 'afl_api'") return [{ id: 1 }];
      if (text.includes("FROM afl_api_identity_adjudications WHERE source_key = 'afl_api'")) {
        return [...store.ledgerRows].sort((a, b) => a.id - b.id).map((r) => ({
          id: r.id, externalId: r.externalId, action: r.action, playerId: r.playerId,
          playerIdentity: r.playerIdentity, supersedesId: r.supersedesId,
        }));
      }
      if (text.includes('AS "playerId" FROM external_identities WHERE source_id')) {
        return store.afApiRows.map((r) => ({
          externalId: r.externalId, status: r.status, matchMethod: r.matchMethod, playerId: r.playerId,
        }));
      }
      if (text.includes('candidate_count AS "candidateCount", external_url AS "externalUrl" FROM external_identities')) {
        return store.afApiRows.map((r) => ({
          externalId: r.externalId, status: r.status, matchMethod: r.matchMethod, playerId: r.playerId,
          candidateCount: r.candidateCount, externalUrl: r.externalUrl,
        }));
      }
      if (text.includes('external_name AS "externalName", notes')) {
        return store.afApiRows.map((r) => ({ externalId: r.externalId, externalName: r.externalName, notes: r.notes }));
      }
      if (text.includes('SELECT DISTINCT ei.player_id AS "playerId"')) {
        const identity = params[0] as string;
        return store.stableIdentities.filter((s) => s.externalId === identity).map((s) => ({ playerId: s.playerId }));
      }
      if (text.includes('ei.player_id AS "playerId", ei.external_id AS "externalId", s.key AS "sourceKey"')) {
        const ids = params[0] as number[];
        return store.stableIdentities.filter((s) => ids.includes(s.playerId))
          .map((s) => ({ playerId: s.playerId, externalId: s.externalId, sourceKey: 'afltables' }));
      }
      if (text.includes('SELECT id, email, role FROM auth_users')) {
        const emails = (params[0] as string[]).map((e) => e.toLowerCase());
        return store.authUsers.filter((a) => emails.includes(a.email.toLowerCase()));
      }
      if (text.startsWith('INSERT INTO auth_users')) {
        const [email, role] = params as [string, string];
        const row = { id: nextAuthUserId++, email, role };
        store.authUsers.push(row);
        return [{ id: row.id }];
      }
      if (text.startsWith('INSERT INTO afl_api_identity_adjudications')) {
        const [id, sourceKey, externalId, action, playerId, playerIdentity, previousState, evidence,
          evidenceSha256, surnameDisagreementAcknowledged, supersedesId, adminUserId, note, createdAt] =
          params as [number, string, string, 'linked' | 'revoked', number, string, string | null, string,
            string, boolean, number | null, number, string, string];
        store.ledgerRows.push({
          id, sourceKey, externalId, action, playerId, playerIdentity, previousState, evidence,
          evidenceSha256, surnameDisagreementAcknowledged, supersedesId, adminUserId, note, createdAt,
        });
        return [];
      }
      if (text.includes('pg_get_serial_sequence')) return [{ name: LEDGER_SEQ_QUALIFIED }];
      if (text.startsWith('SELECT setval(')) {
        store.sequence = { lastValue: params[1] as number, isCalled: true };
        return [];
      }
      if (text.includes('"lastValue"')) {
        return [{ lastValue: String(store.sequence.lastValue), isCalled: store.sequence.isCalled }];
      }
      if (text.startsWith('INSERT INTO external_identities') && text.includes("'unique', 1")) {
        const [, externalId, playerId, matchMethod, externalName, externalUrl, notes] =
          params as [number, string, number, string, string | null, string | null, string | null];
        store.afApiRows.push({
          externalId, playerId, status: 'unique', matchMethod, candidateCount: 1, externalName, externalUrl, notes,
        });
        return [];
      }
      if (text.startsWith('INSERT INTO external_identities') && text.includes("'resolved', 0")) {
        const [, externalId, playerId, matchMethod] = params as [number, string, number, string];
        store.afApiRows.push({
          externalId, playerId, status: 'resolved', matchMethod, candidateCount: 0, externalName: null,
          externalUrl: null, notes: 'AFLDB-ISSUE-235 admin adjudication; see afl_api_identity_adjudications',
        });
        return [];
      }
      throw new Error(`statefulTx: unhandled statement: ${text} | params=${JSON.stringify(params)}`);
    }

    const tx = ((strings: unknown, ...params: unknown[]) => {
      if (Array.isArray(strings) && 'raw' in (strings as object)) {
        const text = (strings as string[]).reduce((acc, s, i) => `${acc}${i ? `$${i}` : ''}${s}`, '')
          .replace(/\s+/g, ' ').trim();
        statements.push({ text, params });
        return Promise.resolve(respond(text, params));
      }
      return { identifier: strings };
    }) as unknown as TransactionSql;
    (tx as unknown as { unsafe: (t: string) => Promise<unknown[]> }).unsafe = (text: string) => {
      statements.push({ text, params: [] });
      if (/IS NULL\s*$/.test(text)) { store.marker = null; return Promise.resolve([]); }
      const match = text.match(/\$afldb_rebuild_marker\$(.*)\$afldb_rebuild_marker\$/s);
      if (match) { store.marker = match[1]; return Promise.resolve([]); }
      throw new Error(`statefulTx.unsafe: unhandled statement: ${text}`);
    };
    (tx as unknown as { array: (a: unknown[]) => unknown[] }).array = (a) => a;
    return { tx, statements };
  }

  it('P-M point 4 (DB-free, full Stage 18 execution): runs the REAL transaction body to '
     + 'completion — importer replay, ledger reinstatement, the D15 human replay with '
     + 'actualSupersedes = {}, parity/invariants and the marker clear, all against the SAME '
     + 'transaction handle — then a simulated commit failure restores the pre-transaction '
     + 'marker exactly, proven by a FRESH reader over the rolled-back store', async () => {
    // ledger() (3 rows, 2 providers: CD_I1001 linked, CD_I1002 linked+revoked) + [importerRow()]
    // (1 provider: CD_I2001) -- disjoint providers, so E_rebuild = ∅ (OD-6) as every accepted
    // rebuild capture must be.
    const c = capture();
    const originalMarker: RebuildMarker = {
      format: CAPTURE_FORMAT, version: CAPTURE_VERSION, capturedAt: '2026-09-23T09:00:00.000Z',
      payloadSha256: c.payloadSha256, fileSha256: 'e'.repeat(64),
    };
    const store = createRebuildStore(originalMarker);
    const preTransactionSnapshot = structuredClone(store);

    const { tx, statements } = statefulTx(store);
    const report = await reinstateAndReplay(tx, c);

    // 1-4: every step of Stage 18 actually succeeded — the REAL production functions ran, not
    // a scripted stand-in for their decisions.
    expect(report.importerInserted).toBe(1);
    expect(report.importerNoops).toBe(0);
    expect(report.ledgerRows).toBe(3);
    expect(report.replay.stops).toEqual([]);
    expect(report.replay.supersedes).toEqual([]); // actualSupersedes = {} (D9/OD-6 rebuild semantics)

    // 5. The marker clear DID execute, using the SAME transaction handle: exactly one
    // COMMENT ON DATABASE statement ran on `tx`, and it is the LAST statement issued.
    const commentStatements = statements.filter((s) => s.text.startsWith('COMMENT ON DATABASE'));
    expect(commentStatements).toHaveLength(1);
    expect(commentStatements[0].text).toBe('COMMENT ON DATABASE "afldb_test" IS NULL');
    expect(statements.at(-1)).toBe(commentStatements[0]);
    expect(store.marker).toBeNull(); // cleared, inside this transaction

    // 6. The transaction wrapper now simulates an abort/failure instead of commit — exactly
    // PostgreSQL's own guarantee when COMMIT itself fails (or a `sql.begin` callback promise
    // is otherwise never allowed to commit): every write the callback issued is undone. The
    // ONLY thing this test does to model that is restore the pre-transaction snapshot, rather
    // than keep `store`'s mutated state.
    Object.assign(store, structuredClone(preTransactionSnapshot));

    // Rollback restores the pre-transaction marker state EXACTLY — proven by the REAL
    // production reader (`readRebuildMarker`), over a FRESH transaction handle bound to the
    // rolled-back store, not by re-inspecting this test's own bookkeeping.
    const restoredMarker = await readRebuildMarker(statefulTx(store).tx, 'afldb_test');
    expect(restoredMarker).toEqual(originalMarker);

    // No out-of-transaction clear ran afterwards: nothing here (or in `reinstateAndReplay`,
    // per the source-order proof in the adjacent test above) calls `clearRebuildMarker` a
    // second time. If one had, `restoredMarker` above would be null.
    expect(restoredMarker).not.toBeNull();

    // Capture archive does not occur on this path. Structurally: `runReinstate`'s only call to
    // `archivePendingCapture` runs strictly after `await sql.begin(...)` returns, inside no
    // `catch` — so a rejected `sql.begin` (exactly what a failed COMMIT produces) propagates
    // straight out of `runReinstate`, and `archivePendingCapture` is never reached. This
    // composes with the proof above: the only way `store.marker` could end up null OUTSIDE a
    // transaction is a `sql.begin` that resolved (committed), and this test's own control flow
    // shows resolving is exactly the branch that was NOT taken.
    const tool = readFileSync(join(root, 'tools', 'migration', 'rebuild_afl_api_adjudications.ts'), 'utf8');
    const runReinstateStart = tool.indexOf('async function runReinstate(');
    const runReinstateEnd = tool.indexOf('\nasync function runBijection(');
    const runReinstateBody = tool.slice(runReinstateStart, runReinstateEnd);
    const beginCall = runReinstateBody.indexOf('await sql.begin(');
    const archiveCall = runReinstateBody.indexOf('archivePendingCapture(dir, capture)');
    const finallyIdx = runReinstateBody.indexOf('} finally {');
    expect(beginCall).toBeGreaterThan(-1);
    expect(finallyIdx).toBeGreaterThan(beginCall);
    expect(archiveCall).toBeGreaterThan(finallyIdx);
    // the error propagates: no catch exists between the try and its finally, so a rejected
    // sql.begin() is never swallowed -- it reaches main()'s own top-level .catch instead
    expect(runReinstateBody.slice(runReinstateBody.indexOf('try {'), finallyIdx)).not.toMatch(/catch/);
  });

  // -------------------------------------------------------------------------
  // AFLDB-ISSUE-237 continuity amendment (2026-09-25): a player the fitzRoy importer folded
  // under a tracked profile_url_continuity rule holds BOTH paths on the rebuilt database.
  // The rule comes from the real tracked contract, never a hand-kept list.
  // -------------------------------------------------------------------------

  const CONTINUITY_RULE = loadFitzroyProfileContinuityRules()[0];
  const FOLDED_PLAYER = 9004;
  function foldedStore(): RebuildStore {
    const store = createRebuildStore(null);
    store.stableIdentities.push(
      { externalId: CONTINUITY_RULE.continuingUrl, playerId: FOLDED_PLAYER },
      { externalId: CONTINUITY_RULE.renumberedUrl, playerId: FOLDED_PLAYER },
    );
    return store;
  }
  function withMarker(store: RebuildStore, c: ReturnType<typeof capture>): RebuildStore {
    store.marker = JSON.stringify({
      format: CAPTURE_FORMAT, version: CAPTURE_VERSION, capturedAt: '2026-09-23T09:00:00.000Z',
      payloadSha256: c.payloadSha256, fileSha256: 'e'.repeat(64),
    });
    return store;
  }

  it('AFLDB-ISSUE-237 continuity: identity -> player still maps the continuing path uniquely, and the '
     + 'forward lookup of the folded player returns that continuing path', async () => {
    const { tx } = statefulTx(foldedStore());
    expect(await resolveAflApiPlayerIdentity(tx, CONTINUITY_RULE.continuingUrl))
      .toEqual({ ok: true, newPlayerId: FOLDED_PLAYER, remappedIdentity: CONTINUITY_RULE.continuingUrl });
    expect((await readAflApiForwardIdentities(tx, [FOLDED_PLAYER])).get(FOLDED_PLAYER))
      .toEqual({ ok: true, identity: CONTINUITY_RULE.continuingUrl, via: 'afltables' });
  });

  it('AFLDB-ISSUE-237 continuity: Stage 18 replays a folded player\'s continuing path and passes '
     + 'parity, the combined invariant and the bijection', async () => {
    const folded = importerRow({ externalId: 'CD_I2002', playerIdentity: CONTINUITY_RULE.continuingUrl, playerId: 777 });
    const c = capture(ledger(), [importerRow(), folded]);
    const store = withMarker(foldedStore(), c);
    const { tx } = statefulTx(store);
    const report = await reinstateAndReplay(tx, c);
    expect(report.importerInserted).toBe(2);
    expect(report.replay.stops).toEqual([]);
    expect(store.afApiRows.find((r) => r.externalId === 'CD_I2002')?.playerId).toBe(FOLDED_PLAYER);
    expect(store.marker).toBeNull(); // parity + invariant passed, so the marker cleared
  });

  it('AFLDB-ISSUE-237 continuity: a source that did NOT fold (continuing and renumbered on two '
     + 'players, two providers) replayed onto a folded target still refuses through parity', async () => {
    const c = capture(ledger(), [
      importerRow(),
      importerRow({ externalId: 'CD_I2002', playerIdentity: CONTINUITY_RULE.continuingUrl, playerId: 777 }),
      importerRow({ externalId: 'CD_I2003', playerIdentity: CONTINUITY_RULE.renumberedUrl, playerId: 778 }),
    ]);
    const store = withMarker(foldedStore(), c);
    const { tx } = statefulTx(store);
    await expect(reinstateAndReplay(tx, c)).rejects.toThrow(
      /do not match the capture.*"retargeted_identity","externalId":"CD_I2003"/);
    expect(store.marker).not.toBeNull(); // never reached the in-transaction clear
  });

  // Reverse direction (2026-09-25 tightening): a target that did NOT fold contradicts the
  // tracked rule, so Stage 18 STOPS rather than binding the continuing path to its own player.
  // Previously this case passed — that was the defect.
  it('AFLDB-ISSUE-237 continuity: Stage 18 refuses a SPLIT target (continuing and renumbered on two '
     + 'players) — nothing written, marker kept, never a fallback to the continuing path alone', async () => {
    const c = capture(ledger(), [
      importerRow(), importerRow({ externalId: 'CD_I2002', playerIdentity: CONTINUITY_RULE.continuingUrl, playerId: 777 }),
    ]);
    const store = createRebuildStore(null);
    store.stableIdentities.push(
      { externalId: CONTINUITY_RULE.continuingUrl, playerId: FOLDED_PLAYER },
      { externalId: CONTINUITY_RULE.renumberedUrl, playerId: FOLDED_PLAYER + 1 },
    );
    withMarker(store, c);
    await expect(reinstateAndReplay(statefulTx(store).tx, c)).rejects.toThrow(new RegExp(
      `afl_api importer replay stopped on 1 provider id\\(s\\), no row written: CD_I2002 \\(the captured row's player `
      + `identity is named by tracked profile_url_continuity rule ${CONTINUITY_RULE.id} and the target contradicts it: `
      + `its continuing_url and renumbered_url resolve to different target players \\(continuing -> \\[${FOLDED_PLAYER}\\], `
      + `renumbered -> \\[${FOLDED_PLAYER + 1}\\]\\)\\)`));
    expect(store.afApiRows).toEqual([]); // the whole replay refused: not even the ordinary row was written
    expect(store.marker).not.toBeNull();
  });

  it('AFLDB-ISSUE-237 continuity: Stage 18 refuses a target missing either path, or holding either '
     + 'path on more than one player', async () => {
    const cases: [string, { externalId: string; playerId: number }[]][] = [
      ['continuing_url resolves to no target player', [{ externalId: CONTINUITY_RULE.renumberedUrl, playerId: FOLDED_PLAYER }]],
      ['renumbered_url resolves to no target player', [{ externalId: CONTINUITY_RULE.continuingUrl, playerId: FOLDED_PLAYER }]],
      ['continuing_url resolves to more than one target player', [
        { externalId: CONTINUITY_RULE.continuingUrl, playerId: FOLDED_PLAYER },
        { externalId: CONTINUITY_RULE.continuingUrl, playerId: FOLDED_PLAYER + 1 },
        { externalId: CONTINUITY_RULE.renumberedUrl, playerId: FOLDED_PLAYER },
      ]],
      ['renumbered_url resolves to more than one target player', [
        { externalId: CONTINUITY_RULE.continuingUrl, playerId: FOLDED_PLAYER },
        { externalId: CONTINUITY_RULE.renumberedUrl, playerId: FOLDED_PLAYER },
        { externalId: CONTINUITY_RULE.renumberedUrl, playerId: FOLDED_PLAYER + 1 },
      ]],
    ];
    for (const [wording, identities] of cases) {
      const c = capture(ledger(), [
        importerRow(), importerRow({ externalId: 'CD_I2002', playerIdentity: CONTINUITY_RULE.continuingUrl, playerId: 777 }),
      ]);
      const store = createRebuildStore(null);
      store.stableIdentities.push(...identities);
      withMarker(store, c);
      await expect(reinstateAndReplay(statefulTx(store).tx, c), wording).rejects.toThrow(
        new RegExp(`CD_I2002 \\(the captured row's player identity is named by tracked profile_url_continuity rule ${CONTINUITY_RULE.id} and the target contradicts it: its ${wording}`));
      expect(store.afApiRows, wording).toEqual([]);
    }
  });

  it('AFLDB-ISSUE-237 continuity: an ordinary single-path identity still issues exactly ONE reverse '
     + 'lookup statement, with the identity itself as its only parameter', async () => {
    const { tx, statements } = statefulTx(createRebuildStore(null));
    expect(await resolveAflApiPlayerIdentity(tx, 'players/A/Alpha_Able.html'))
      .toEqual({ ok: true, newPlayerId: 9001, remappedIdentity: 'players/A/Alpha_Able.html' });
    const lookups = statements.filter((s) => s.text.includes('SELECT DISTINCT ei.player_id AS "playerId"'));
    expect(lookups.map((s) => s.params)).toEqual([['players/A/Alpha_Able.html']]);
    // a continuity identity reads both of its rule's paths, the identity's own first
    const folded = statefulTx(foldedStore());
    await resolveAflApiPlayerIdentity(folded.tx, CONTINUITY_RULE.continuingUrl);
    expect(folded.statements.filter((s) => s.text.includes('SELECT DISTINCT ei.player_id AS "playerId"')).map((s) => s.params))
      .toEqual([[CONTINUITY_RULE.continuingUrl], [CONTINUITY_RULE.renumberedUrl]]);
  });

  // -------------------------------------------------------------------------
  // Stage 2 crash window (2026-09-24 tightening): "combined capture file becomes durable ->
  // short transaction sets database marker -> only then may recreate/reset begin." Four
  // boundary cases (A-D), DB-free.
  // -------------------------------------------------------------------------

  it('Stage 2 crash window A: a file-write failure leaves nothing for the caller to act on — '
     + 'the marker is never even attempted, so recreate cannot run', () => {
    withTempDir((dir) => {
      // a path that exists as a FILE, not a directory: mkdirSync(..., {recursive:true}) throws
      const notADir = join(dir, 'blocks-the-directory');
      writeFileSync(notADir, 'x');
      expect(() => writePendingCapture(notADir, capture())).toThrow();
      expect(() => settleCapture({
        dir: notADir, database: 'afldb_test', capturedAt: '2026-09-24T10:00:00.000Z',
        pending: null,
        live: { ledgerPresent: true, ledgerRows: ledger(), importerRows: [importerRow()] },
        decision: { action: 'capture-live' }, observed: null,
      })).toThrow();
    });
    // settleCapture never touches the database (no tx/DSN parameter anywhere in its
    // signature); it writes the file LAST, after every live-state check, and runCapture's
    // ONLY marker action call is strictly after settleCapture returns — so a thrown write
    // failure propagates before any marker action is ever computed or applied.
    const tool = readFileSync(join(root, 'tools', 'migration', 'rebuild_afl_api_adjudications.ts'), 'utf8');
    const runCaptureStart = tool.indexOf('async function runCapture(');
    const runCaptureEnd = tool.indexOf('\nasync function runReinstate(');
    const body = tool.slice(runCaptureStart, runCaptureEnd);
    const settleCall = body.indexOf('settleCapture({');
    const markerCall = body.indexOf('await applyMarkerAction(');
    expect(settleCall).toBeGreaterThan(-1);
    expect(markerCall).toBeGreaterThan(settleCall);
  });

  it('Stage 2 crash window B: a marker-set failure after a successful file write is safe to '
     + 'retry — the retry recognises recreate never ran and re-verifies, it never silently '
     + 'recaptures the untouched live state as a fresh baseline', () => {
    // recreate never ran (the marker-set failed before it, so the stage exits non-zero and
    // the rebuild stops there): the live database is EXACTLY what this run just captured.
    // marker absent (applyMarkerAction never completed) + pending file present + live equals
    // pending -> D11c's row fires for the RIGHT reason here too: it recognises nothing has
    // changed and re-verifies, rather than treating the untouched live state as new.
    const pending = capture();
    const decision = decidePendingCapture({
      markerPresent: false, pending, liveLedgerRows: ledger(), liveImporterRows: [importerRow()], recover: false,
    });
    expect(decision).toEqual({ action: 'verify-reinstated' });
    expect(decision.action).not.toBe('capture-live'); // never a silent re-write of the same file as "new"
  });

  it('Stage 2 crash window C: a valid pending file with no marker is exactly the D11c contract '
     + '— no implicit recapture, --recover is required once the live database was actually '
     + 'reset, and a live state that neither matches nor is empty is never chosen automatically', () => {
    const pending = capture();
    const noRecover = decidePendingCapture({ markerPresent: false, pending, liveLedgerRows: [], liveImporterRows: [], recover: false });
    expect(noRecover.action).toBe('refuse');
    expect(noRecover.action === 'refuse' && noRecover.reason).toMatch(/--recover-afl-api-adjudications/);
    expect(decidePendingCapture({ markerPresent: false, pending, liveLedgerRows: [], liveImporterRows: [], recover: true }))
      .toEqual({ action: 'adopt-pending' });
    const differs = decidePendingCapture({
      markerPresent: false, pending, liveLedgerRows: ledger().slice(0, 1), liveImporterRows: [], recover: true,
    });
    expect(differs.action).toBe('refuse');
  });

  it('Stage 2 crash window D: a marker with no pending file, or a marker whose pending file '
     + 'differs from it, is a hard refusal — even with --recover, never a recapture '
     + '(previously untested: every existing decidePendingCapture case in this suite used '
     + 'markerPresent: false)', () => {
    const pending = capture();
    for (const recover of [false, true]) {
      const decision = decidePendingCapture({ markerPresent: true, pending: null, liveLedgerRows: [], liveImporterRows: [], recover });
      expect(decision.action).toBe('refuse');
      expect(decision.action === 'refuse' && decision.reason).toMatch(/other-worktree\/other-host silent-loss path \(F5\)/);
      expect(decision.action === 'refuse' && decision.reason).not.toMatch(/--recover/); // no flag rescues this row
    }
    expect(decidePendingCapture({ markerPresent: true, pending, liveLedgerRows: [], liveImporterRows: [], recover: false }).action)
      .toBe('refuse');
    expect(decidePendingCapture({ markerPresent: true, pending, liveLedgerRows: [], liveImporterRows: [], recover: true }))
      .toEqual({ action: 'adopt-pending' });
    expect(decidePendingCapture({
      markerPresent: true, pending, liveLedgerRows: ledger(), liveImporterRows: [importerRow()], recover: false,
    })).toEqual({ action: 'verify-reinstated' });
    for (const recover of [false, true]) {
      const decision = decidePendingCapture({
        markerPresent: true, pending, liveLedgerRows: ledger().slice(0, 1), liveImporterRows: [], recover,
      });
      expect(decision.action).toBe('refuse');
      expect(decision.action === 'refuse' && decision.reason).toMatch(/reconcile by hand/);
    }
  });

  it('Stage 2 crash window D (tampered/foreign file, structural): the marker/pending hash '
     + 'mismatch is checked BEFORE decidePendingCapture is ever called, and refuses '
     + 'unconditionally — no --recover branch reaches it', () => {
    const tool = readFileSync(join(root, 'tools', 'migration', 'rebuild_afl_api_adjudications.ts'), 'utf8');
    const runCaptureStart = tool.indexOf('async function runCapture(');
    const runCaptureEnd = tool.indexOf('\nasync function runReinstate(');
    const body = tool.slice(runCaptureStart, runCaptureEnd);
    expect(body).toMatch(/marker\.payloadSha256 !== pendingInfo\.capture\.payloadSha256[\s\S]{0,80}marker\.fileSha256 !== pendingInfo\.fileSha256/);
    expect(body).toContain('This is the wrong or a tampered capture');
    const guardIdx = body.indexOf('This is the wrong or a tampered capture');
    const decideIdx = body.indexOf('decidePendingCapture({');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(decideIdx).toBeGreaterThan(guardIdx);
    const guardBlock = body.slice(body.indexOf('if (marker && pendingInfo'), guardIdx);
    expect(guardBlock).not.toContain('recover');
  });
});

// ---------------------------------------------------------------------------
// AFLDB-ISSUE-235 I18 — the tracked fixture harness around the guarded rebuild
// (tools/migration/afl_api_adjudication_i18_fixture.ts). DB-free: argument and DSN
// refusals, seed preconditions, the baseline's shape and hash, and every verify rule.
// ---------------------------------------------------------------------------

describe('AFLDB-ISSUE-235 I18 fixture harness (DB-free)', () => {
  const OWNER = 'postgres://afldb_owner:pw@127.0.0.1:55432/afldb_test';
  const IMPORT = 'postgres://afldb_import:pw@127.0.0.1:55432/afldb_test';
  const EMAIL = I18_FIXTURE.actorEmail;

  function row(over: Partial<I18LedgerRow> & Pick<I18LedgerRow, 'id' | 'action'>): I18LedgerRow {
    return {
      externalId: I18_FIXTURE.providerId, playerId: 144, playerIdentity: I18_FIXTURE.stableIdentity,
      previousState: null, previousStateType: null,
      evidence: '{"fingerprint": "abc", "providerId": "CD_I9991800001"}', evidenceType: 'object',
      evidenceSha256: 'a'.repeat(64), surnameAck: false, supersedesId: null, adminUserId: 900,
      adminEmail: EMAIL, note: I18_FIXTURE.notes.firstLink, createdAt: '2026-09-25T01:02:03.123456Z',
      ...over,
    };
  }
  const LEDGER: I18LedgerRow[] = [
    row({ id: 199, action: 'linked' }),
    row({ id: 200, action: 'revoked', supersedesId: 199, previousState: '{"id": 5, "status": "resolved"}',
      previousStateType: 'object', evidenceSha256: 'b'.repeat(64), note: I18_FIXTURE.notes.revoke,
      createdAt: '2026-09-25T01:02:04.000001Z' }),
    row({ id: 201, action: 'linked', evidenceSha256: 'c'.repeat(64), note: I18_FIXTURE.notes.secondLink,
      createdAt: '2026-09-25T01:02:05.999999Z' }),
  ];
  const baseline = (): I18Baseline => buildI18Baseline({
    database: 'afldb_test', seededAt: '2026-09-25T01:03:00.000Z', providerId: I18_FIXTURE.providerId,
    stableIdentity: I18_FIXTURE.stableIdentity, playerId: 144,
    actor: { id: 900, email: EMAIL, role: 'super_admin' },
    ledger: LEDGER, identity: { id: 77, status: 'resolved', matchMethod: 'afl_api_admin_adjudication', playerId: 144 },
    sequence: { lastValue: 201, isCalled: true, next: 202 },
  });

  /** The live state a correct run leaves; `post` renumbers the player and the actor. */
  function observed(phase: 'pre' | 'post', over: Partial<I18Observation> = {}): I18Observation {
    const playerId = phase === 'pre' ? 144 : 13001;
    const actorId = phase === 'pre' ? 900 : 1;
    return {
      database: 'afldb_test',
      resolvedPlayerIds: [playerId],
      ledger: LEDGER.map((r) => ({ ...r, playerId, adminUserId: actorId })),
      ledgerTotal: 3,
      ledgerMaxId: 201,
      providerIdentities: [{ id: phase === 'pre' ? 77 : 3, status: 'resolved', matchMethod: 'afl_api_admin_adjudication', playerId }],
      playerAflApiProviders: [I18_FIXTURE.providerId],
      humanResolvedTotal: 1,
      actors: [{ id: actorId, email: EMAIL, role: 'super_admin', disabled: true, hasPasswordHash: false, hasTotpSecret: false }],
      live: { sequence: { lastValue: 201, isCalled: true }, replay: { inserted: 0, noops: 1, stops: [], supersedes: [] },
        importerReplay: { inserted: 0, noops: 0 }, bijection: 'ok' },
      pendingCaptureExists: false,
      archivedCaptures: phase === 'pre' ? [] : [{ file: 'x.reinstated.json', fileSha256: 'f', payloadSha256: 'p', matchesBaseline: true }],
      ...over,
    };
  }

  it('parses exactly seed / verify --phase pre|post / teardown', () => {
    expect(parseI18Args(['seed'])).toEqual({ step: 'seed', allowOwnerImportDsn: false });
    expect(parseI18Args(['seed', '--allow-owner-import-dsn'])).toEqual({ step: 'seed', allowOwnerImportDsn: true });
    expect(parseI18Args(['verify', '--phase', 'pre'])).toEqual({ step: 'verify', phase: 'pre' });
    expect(parseI18Args(['verify', '--phase', 'post'])).toEqual({ step: 'verify', phase: 'post' });
    expect(parseI18Args(['teardown'])).toEqual({ step: 'teardown' });
    for (const argv of [[], ['verify'], ['verify', '--phase', 'during'], ['teardown', '--force'], ['seed', '--x'], ['rebuild']]) {
      expect(() => parseI18Args(argv), argv.join(' ')).toThrow(I18FixtureRefused);
    }
  });

  it('runs on afldb_test only, and never substitutes the owner for the import role silently', () => {
    expect(resolveI18Dsns({ AFLDB_TEST_DATABASE_URL: OWNER, AFLDB_TEST_IMPORT_DATABASE_URL: IMPORT }, { allowOwnerImportDsn: false }))
      .toEqual({ database: 'afldb_test', ownerDsn: OWNER, importDsn: IMPORT, importIsOwner: false });
    expect(() => resolveI18Dsns({ AFLDB_TEST_DATABASE_URL: OWNER }, { allowOwnerImportDsn: false }))
      .toThrow(/AFLDB_TEST_IMPORT_DATABASE_URL is not set/);
    expect(resolveI18Dsns({ AFLDB_TEST_DATABASE_URL: OWNER }, { allowOwnerImportDsn: true }).importIsOwner).toBe(true);
    expect(() => resolveI18Dsns({}, { allowOwnerImportDsn: true })).toThrow(/AFLDB_TEST_DATABASE_URL is not set/);
    expect(() => resolveI18Dsns({ AFLDB_TEST_DATABASE_URL: OWNER.replace('afldb_test', 'afldb_dev') }, { allowOwnerImportDsn: true }))
      .toThrow(/rejected by name/);
    expect(() => resolveI18Dsns({ AFLDB_TEST_DATABASE_URL: OWNER.replace('afldb_test', 'code_test_db') }, { allowOwnerImportDsn: true }))
      .toThrow(/afldb_test' only/);
    expect(() => resolveI18Dsns({ AFLDB_TEST_DATABASE_URL: OWNER, AFLDB_TEST_IMPORT_DATABASE_URL: IMPORT.replace('afldb_test', 'afldb_dev') },
      { allowOwnerImportDsn: true })).toThrow(/names 'afldb_dev'/);
    // no refusal ever quotes a DSN or its password
    expect(() => resolveI18Dsns({ AFLDB_TEST_DATABASE_URL: 'postgres://u:secretpw@h/afldb_dev' }, { allowOwnerImportDsn: true }))
      .toThrow(/^(?!.*secretpw)/);
  });

  it('owns only exact literals, outside every real provider id and the S6 namespace', () => {
    expect(I18_FIXTURE.providerId).toMatch(/^CD_I[0-9]{10}$/);
    expect(I18_FIXTURE.providerId).not.toMatch(/^CD_I999235[0-9]{4}$/);
    expect(I18_FIXTURE.actorEmail).toMatch(/@example\.test$/);
    expect(I18_FIXTURE.externalRecordId).toBe(`${I18_FIXTURE.matchId}|${I18_FIXTURE.teamId}|${I18_FIXTURE.providerId}`);
    for (const note of Object.values(I18_FIXTURE.notes)) expect(note.length).toBeGreaterThanOrEqual(20);
    const tool = readFileSync(join(process.cwd(), 'tools', 'migration', 'afl_api_adjudication_i18_fixture.ts'), 'utf8');
    expect(tool).not.toMatch(/\bLIKE\b/);
    expect(tool).not.toMatch(/\b144\b/); // the player is resolved from its identity, never a numeric id
  });

  it('writes the human state ONLY through the real link/revoke APIs, and the rebuild never runs the fixture', () => {
    const tool = readFileSync(join(process.cwd(), 'tools', 'migration', 'afl_api_adjudication_i18_fixture.ts'), 'utf8');
    expect(tool).not.toMatch(/INSERT INTO afl_api_identity_adjudications/);
    expect(tool).not.toMatch(/INSERT INTO external_identities/);
    expect(tool).not.toMatch(/UPDATE (afl_api_identity_adjudications|external_identities)/);
    expect(tool.match(/await linkAflApiProvider\(/g)).toHaveLength(1); // one helper, called twice
    expect(tool).toMatch(/await link\('link #1'[\s\S]*revokeAflApiLink\(\{[\s\S]*await link\('link #2'/);
    // no statistic or Brownlow use is seeded, so the revoke stays provable
    expect(tool).not.toMatch(/INSERT INTO (player_match_stats|brownlow_round_votes|player_height_evidence)/);
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['db:test:issue235-i18'])
      .toBe('tsx --conditions=react-server tools/migration/afl_api_adjudication_i18_fixture.ts');
    const runner = readFileSync(join(process.cwd(), 'tools', 'db', 'rebuild-test.ts'), 'utf8');
    expect(runner).not.toMatch(/i18|afl_api_adjudication_i18_fixture/i);
  });

  it('teardown and verify run under plain tsx: nothing they load reaches server-only (post-I18 teardown refusal, 2026-09-24)', () => {
    // `npx tsx tools/migration/afl_api_adjudication_i18_fixture.ts teardown` (no
    // --conditions=react-server) once committed its DELETEs and then REFUSED loading its proof
    // module, which reached `import 'server-only'` through @/db/queries. Walk the static import
    // graph of the tool and of the module teardown's proof loads; none may reach server-only.
    const root = process.cwd();
    const resolve = (from: string, spec: string): string | null => {
      let base: string;
      if (spec.startsWith('@/')) base = join(root, 'src', spec.slice(2));
      else if (spec.startsWith('.')) base = join(from, '..', spec);
      else return null; // a package: postgres/node:* are server-neutral
      for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
        if (existsSync(candidate)) return candidate;
      }
      throw new Error(`unresolved import '${spec}' from ${from}`);
    };
    const staticImports = (text: string) => [...text.matchAll(/^(?:import|export)\s[^;]*?from\s+'([^']+)'|^import\s+'([^']+)'/gm)]
      .map((m) => m[1] ?? m[2]);
    const reachable = (entry: string): Map<string, string[]> => {
      const seen = new Map<string, string[]>();
      const stack = [entry];
      while (stack.length > 0) {
        const file = stack.pop()!;
        if (seen.has(file)) continue;
        const specs = staticImports(readFileSync(file, 'utf8'));
        seen.set(file, specs);
        for (const spec of specs) {
          const next = resolve(file, spec);
          if (next) stack.push(next);
        }
      }
      return seen;
    };
    const tool = join(root, 'tools', 'migration', 'afl_api_adjudication_i18_fixture.ts');
    const ownership = join(root, 'tests', 'integration', 'afl-api-fixture-ownership.ts');
    for (const entry of [tool, ownership]) {
      const graph = reachable(entry);
      expect(graph.size, entry).toBeGreaterThan(1); // not vacuous
      for (const [file, specs] of graph) {
        expect(specs, file).not.toContain('server-only');
        expect(specs.filter((s) => s.startsWith('@/db/')), file).toEqual([]);
      }
    }
    // Not vacuous: the seeding fixtures module DOES reach server-only, which is why teardown must not load it.
    const seeding = reachable(join(root, 'tests', 'integration', 'afl-api-adjudication-fixtures.ts'));
    expect([...seeding.values()].some((specs) => specs.includes('server-only'))).toBe(true);

    // Teardown's proof loads the neutral module; only seed loads the query module (under react-server).
    const text = readFileSync(tool, 'utf8');
    const teardown = text.slice(text.indexOf('async function runTeardown('), text.indexOf('async function main('));
    expect(teardown).toContain("await import('../../tests/integration/afl-api-fixture-ownership')");
    expect(teardown.match(/import\('[^']+'\)/g)).toEqual(["import('../../tests/integration/afl-api-fixture-ownership')"]);
    const verify = text.slice(text.indexOf('async function runVerify('), text.indexOf('async function runTeardown('));
    expect(verify).not.toMatch(/await import\(/);
    // Teardown re-checks the live database before its first DELETE.
    expect(teardown.indexOf('SELECT current_database()')).toBeGreaterThan(-1);
    expect(teardown.indexOf('SELECT current_database()')).toBeLessThan(teardown.indexOf('DELETE FROM'));
  });

  it('refuses to seed unless the baseline player is exactly one clean, safely revocable player', () => {
    const clean: I18SeedObservation = {
      resolvedPlayerIds: [144], playerStableIdentities: [{ sourceKey: 'afltables', externalId: I18_FIXTURE.stableIdentity }],
      playerAflApiRows: 0, playerAflApiUses: 0, playerLedgerRows: 0, fixtureRows: 0, ledgerRows: 0,
      humanResolvedRows: 0, pendingCaptureExists: false, baselineExists: false,
    };
    expect(i18SeedPreconditionProblems(clean)).toEqual([]);
    const refused: [Partial<I18SeedObservation>, RegExp][] = [
      [{ resolvedPlayerIds: [] }, /resolves to 0 players/],
      [{ resolvedPlayerIds: [144, 145] }, /resolves to 2 players/],
      [{ playerStableIdentities: [...clean.playerStableIdentities, { sourceKey: 'manual_admin_edit', externalId: 'manual_admin_edit:x' }] }, /ambiguous/],
      [{ playerStableIdentities: [{ sourceKey: 'afltables', externalId: 'players/A/Alan_Martello0.html' },
        ...clean.playerStableIdentities] }, /ambiguous/],
      [{ playerAflApiRows: 1 }, /already holds 1 afl_api/],
      [{ playerAflApiUses: 2 }, /revoke could not be proven safe/],
      [{ playerLedgerRows: 1 }, /ledger row/],
      [{ fixtureRows: 3 }, /run teardown first/],
      [{ ledgerRows: 1 }, /ledger is not empty/],
      [{ humanResolvedRows: 1 }, /'resolved' row/],
      [{ pendingCaptureExists: true }, /pending rebuild capture/],
      [{ baselineExists: true }, /baseline file already exists/],
    ];
    for (const [over, message] of refused) {
      expect(i18SeedPreconditionProblems({ ...clean, ...over }).join('; '), String(message)).toMatch(message);
    }
  });

  it('the baseline is exactly linked / revoked (superseding the first link) / linked, and hash-bound', () => {
    const b = baseline();
    expect(i18LedgerShapeProblems(b.ledger)).toEqual([]);
    expect(b.ledger.map((r) => [r.id, r.action, r.supersedesId])).toEqual([[199, 'linked', null], [200, 'revoked', 199], [201, 'linked', null]]);
    expect(parseI18Baseline(JSON.stringify(b), 'afldb_test')).toEqual(b);
    expect(() => parseI18Baseline(JSON.stringify({ ...b, playerId: 145 }), 'afldb_test')).toThrow(/payload hash/);
    expect(() => parseI18Baseline(JSON.stringify(b), 'code_test_db')).toThrow(/not 'code_test_db'/);
    expect(() => parseI18Baseline('{', 'afldb_test')).toThrow(/not valid JSON/);

    const bad: [I18LedgerRow[], RegExp][] = [
      [LEDGER.slice(0, 2), /not \[linked, revoked, linked\]/],
      [[LEDGER[0], { ...LEDGER[1], supersedesId: 201 }, LEDGER[2]], /supersedes 201, not the first linked row 199/],
      [[LEDGER[0], { ...LEDGER[1], supersedesId: null }, LEDGER[2]], /supersedes null/],
      [[LEDGER[0], LEDGER[1], { ...LEDGER[2], supersedesId: 200 }], /second linked row has a supersedes_id/],
      [[LEDGER[0], LEDGER[1], { ...LEDGER[2], evidenceType: 'string' }], /jsonb string, not an object/],
      [[LEDGER[0], LEDGER[1], { ...LEDGER[2], playerId: 145 }], /different player ids/],
      [[{ ...LEDGER[0], adminEmail: 'someone@afldb.example' }, LEDGER[1], LEDGER[2]], /not the I18 actor/],
    ];
    for (const [rows, message] of bad) {
      expect(i18LedgerShapeProblems(rows).join('; '), String(message)).toMatch(message);
      expect(() => buildI18Baseline({ ...b, ledger: rows })).toThrow(I18FixtureRefused);
    }
  });

  it('verify passes before the rebuild and after it, with the player and actor renumbered', () => {
    expect(i18VerifyProblems(baseline(), observed('pre'), 'pre')).toEqual([]);
    expect(i18VerifyProblems(baseline(), observed('post'), 'post')).toEqual([]);
    // an unchanged numeric id is also a pass: player_id is compared to the identity, not the number
    expect(i18VerifyProblems(baseline(), observed('post', {
      resolvedPlayerIds: [144], ledger: LEDGER.map((r) => ({ ...r, adminUserId: 1 })),
      providerIdentities: [{ id: 3, status: 'resolved', matchMethod: 'afl_api_admin_adjudication', playerId: 144 }],
    }), 'post')).toEqual([]);
    // but the pre phase requires the seeded surrogates exactly
    expect(i18VerifyProblems(baseline(), observed('post', { archivedCaptures: [] }), 'pre').join('; '))
      .toMatch(/resolves to player 13001, not the seeded 144/);
  });

  it('verify post refuses every departure from the reinstate contract', () => {
    const post = (over: Partial<I18Observation>) => i18VerifyProblems(baseline(), observed('post', over), 'post').join('; ');
    const ledgerWith = (i: number, change: Partial<I18LedgerRow>) =>
      observed('post').ledger.map((r, k) => (k === i ? { ...r, ...change } : r));
    const cases: [Partial<I18Observation>, RegExp][] = [
      [{ resolvedPlayerIds: [] }, /resolves to 0 players/],
      [{ resolvedPlayerIds: [13001, 13002] }, /resolves to 2 players/],
      [{ ledger: ledgerWith(1, { evidence: '{"fingerprint": "changed"}' }) }, /ledger row 200: evidence differ/],
      [{ ledger: ledgerWith(1, { previousState: '{"id": 6}' }) }, /previous_state differ/],
      [{ ledger: ledgerWith(1, { evidenceSha256: 'd'.repeat(64) }) }, /evidence_sha256 differ/],
      [{ ledger: ledgerWith(1, { supersedesId: 201 }) }, /supersedes_id differ/],
      [{ ledger: ledgerWith(2, { createdAt: '2026-09-25T01:02:05.999000Z' }) }, /ledger row 201: created_at differ/],
      [{ ledger: ledgerWith(0, { id: 1 }) }, /ledger row 199: id differ/],
      [{ ledger: ledgerWith(0, { note: 'x'.repeat(30) }) }, /note differ/],
      [{ ledger: ledgerWith(0, { playerId: 144 }) }, /player_id 144 is not the player the identity resolves to[\s\S]*still names the pre-rebuild player id 144/],
      [{ ledger: ledgerWith(0, { adminUserId: 900 }) }, /admin_user_id 900 is not the actor/],
      [{ ledger: observed('post').ledger.slice(0, 2) }, /2 ledger row\(s\)/],
      [{ ledgerTotal: 4 }, /whole ledger holds 4/],
      [{ providerIdentities: [] }, /0 afl_api identity row/],
      [{ providerIdentities: [{ id: 3, status: 'unique', matchMethod: 'afl_api_stat_vector_season', playerId: 13001 }] },
        /'unique', not 'resolved'[\s\S]*match_method/],
      [{ providerIdentities: [{ id: 3, status: 'resolved', matchMethod: 'afl_api_admin_adjudication', playerId: 144 }] },
        /(?=[\s\S]*names player 144, not 13001)(?=[\s\S]*identity still names the pre-rebuild player id 144)/],
      [{ playerAflApiProviders: [I18_FIXTURE.providerId, 'CD_I1002231'] }, /not only CD_I9991800001/],
      [{ humanResolvedTotal: 2 }, /2 human afl_api 'resolved'/],
      [{ actors: [] }, /0 auth_users row/],
      [{ actors: [{ id: 1, email: EMAIL, role: 'super_admin', disabled: false, hasPasswordHash: true, hasTotpSecret: true }] },
        /not disabled[\s\S]*password hash[\s\S]*TOTP secret/],
      [{ actors: [{ id: 1, email: EMAIL, role: 'contributor', disabled: true, hasPasswordHash: false, hasTotpSecret: false }] },
        /role is 'contributor', not the captured 'super_admin'/],
      [{ live: { sequence: { lastValue: 201, isCalled: false }, replay: { inserted: 0, noops: 1, stops: [], supersedes: [] },
          importerReplay: { inserted: 0, noops: 0 }, bijection: 'ok' } },
        /next hand out 201, not above max\(id\) 201/],
      [{ live: { sequence: { lastValue: 201, isCalled: true }, replay: { inserted: 1, noops: 0, stops: [], supersedes: [] },
          importerReplay: { inserted: 0, noops: 0 }, bijection: 'ok' } },
        /not a single no-op/],
      [{ live: { sequence: { lastValue: 201, isCalled: true }, replay: { error: 'read-only' },
          importerReplay: { inserted: 0, noops: 0 }, bijection: 'ok' } }, /could not run read-only/],
      [{ live: { sequence: { lastValue: 201, isCalled: true }, replay: { inserted: 0, noops: 1, stops: [], supersedes: [] },
          importerReplay: { inserted: 0, noops: 0 }, bijection: { error: 'x' } } },
        /bijection does not hold/],
      [{ pendingCaptureExists: true }, /was not archived/],
      [{ archivedCaptures: [] }, /no archived rebuild capture/],
      [{ database: 'code_test_db' }, /connected to 'code_test_db'/],
    ];
    for (const [over, message] of cases) expect(post(over), String(message)).toMatch(message);
  });

  it('finds the archived rebuild capture that holds the I18 ledger, proven by its own hash', () => {
    const dir = mkdtempSync(join(tmpdir(), 'i18-capture-'));
    try {
      const b = baseline();
      const rows: CapturedLedgerRow[] = b.ledger.map((r) => ({
        id: r.id, sourceKey: 'afl_api', externalId: r.externalId, action: r.action, playerId: r.playerId,
        playerIdentity: r.playerIdentity, previousState: r.previousState, evidence: r.evidence,
        evidenceSha256: r.evidenceSha256, surnameDisagreementAcknowledged: r.surnameAck, supersedesId: r.supersedesId,
        adminUserId: r.adminUserId, adminEmail: r.adminEmail, adminRole: 'super_admin', note: r.note, createdAt: r.createdAt,
      }));
      const capture = buildCombinedCapture({
        database: 'afldb_test', capturedAt: '2026-09-25T02:00:00.000Z', ledgerTablePresent: true,
        ledgerRows: rows, importerRows: [],
      });
      expect(captureMatchesBaseline(capture.ledgerRows, b)).toBe(true);
      expect(captureMatchesBaseline(capture.ledgerRows.slice(1), b)).toBe(false);
      expect(captureMatchesBaseline(capture.ledgerRows.map((r) => ({ ...r, createdAt: '2026-09-25T01:02:03.123000Z' })), b)).toBe(false);

      writePendingCapture(dir, capture);
      const archived = archivePendingCapture(dir, capture);
      writeFileSync(join(dir, 'afl-api-identities.unrelated.reinstated.json'), '{"format":"other"}');
      const found = readArchivedCaptures(dir, 'afldb_test', b);
      expect(found.find((c) => c.matchesBaseline)?.file).toBe(archived.split(/[\\/]/).pop());
      expect(found.find((c) => c.matchesBaseline)?.payloadSha256).toBe(capture.payloadSha256);
      // an unparseable or foreign archive is listed, never trusted
      expect(found.find((c) => c.file.includes('unrelated'))).toMatchObject({ matchesBaseline: false, payloadSha256: 'unverifiable' });
      expect(readArchivedCaptures(join(dir, 'missing'), 'afldb_test', b)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the baseline beside, never inside, the directory the rebuild capture stage owns', () => {
    const repo = join('R:', 'repo');
    expect(i18BaselinePath(repo, 'afldb_test')).toBe(join(repo, 'backups', 'issue-235-i18', 'afldb_test.baseline.json'));
    expect(i18BaselinePath(repo, 'afldb_test').startsWith(captureDirectory(repo, 'afldb_test'))).toBe(false);
  });
});

/**
 * AFLDB-ISSUE-237 §9/§11a — the OD-4 recovery tool (R3–R5), DB-free. `parseAflApiImporterRecoveryExport`
 * is pure and tested directly; `recoverAflApiImporterIdentities` is tested against a fake
 * `TransactionSql` (the same technique `fakeTx()` above already uses for the rebuild's own
 * actor-attribution tests), covering: the two guards that fire before any other query (target
 * database, rebuild marker); the fail-closed/rollback contract for `validate-only`/`dry-run`;
 * the "existing non-identical importer row refuses" pre-check (§11a R4, including why the
 * one-provider-per-player collision is the SAME code path, not a distinct one, on this tool's
 * own call graph); and the full `apply`-mode success path through the real control flow
 * (`recoverAflApiImporterIdentities` -> `planAflApiImporterRowsLive` -> `planAflApiImporterReplay`
 * -> the real INSERT -> the R5 post-write re-read -> `importerParityProblems` -> the bijection
 * re-check), asserting the exact final write set and that D3's "no surrogate carry-through"
 * rule holds (the captured, stale `playerId` never appears in the written row).
 */
describe('AFLDB-ISSUE-237 — recover_afl_api_importer_identities.ts (OD-4 recovery tool, DB-free)', () => {
  const SOURCE_DUMP_SHA256 = 'b'.repeat(64);

  function exportOf(
    rows: readonly CapturedImporterRow[],
    source: { sourceDatabase: string; sourceDumpSha256: string } = { sourceDatabase: 'afldb-recovery-temp', sourceDumpSha256: SOURCE_DUMP_SHA256 },
  ): AflApiImporterRecoveryExport {
    const countsByMethod: Record<string, number> = {};
    for (const r of rows) countsByMethod[r.matchMethod] = (countsByMethod[r.matchMethod] ?? 0) + 1;
    // payloadSha256 is recomputed the same way the tool computes it (over sourceDatabase,
    // sourceDumpSha256 and the D6 fields of each row, excluding the audit-only playerId) --
    // exercised end to end via the parse/roundtrip test below, not hand-duplicated here.
    const draft: Omit<AflApiImporterRecoveryExport, 'payloadSha256'> = {
      format: RECOVERY_EXPORT_FORMAT, version: RECOVERY_EXPORT_VERSION,
      sourceDatabase: source.sourceDatabase, sourceDumpSha256: source.sourceDumpSha256,
      capturedAt: '2026-09-24T00:00:00.000Z', countsByMethod, rows,
    };
    // Uses the SAME canonicalJson() the tool itself hashes with (key-sorted at every depth) --
    // a hand-rolled JSON.stringify here previously produced a DIFFERENT byte sequence purely
    // from field-declaration order, which is exactly the kind of drift canonicalJson exists to
    // prevent. Caught by actually running this suite, not by typecheck.
    const payload = canonicalJson({
      sourceDatabase: draft.sourceDatabase, sourceDumpSha256: draft.sourceDumpSha256,
      rows: rows.map((r) => ({
        externalId: r.externalId, playerIdentity: r.playerIdentity, matchMethod: r.matchMethod,
        status: r.status, candidateCount: r.candidateCount, externalName: r.externalName,
        externalUrl: r.externalUrl, notes: r.notes,
      })),
    });
    const payloadSha256 = createHash('sha256').update(payload).digest('hex');
    return { ...draft, payloadSha256 };
  }

  const oneRow = (): CapturedImporterRow => ({
    externalId: 'CD_I9990000099', playerIdentity: 'players/Z/Recovery-test.html',
    matchMethod: 'afl_api_stat_vector_bootstrap', status: 'unique', candidateCount: 1,
    externalName: 'Recovery Test', externalUrl: null, notes: null, playerId: 12345,
  });

  it('parseAflApiImporterRecoveryExport — round-trips a valid export, refuses a tampered one and a wrong sourceDumpSha256', () => {
    const good = exportOf([oneRow()]);
    expect(parseAflApiImporterRecoveryExport(good, { sourceDumpSha256: SOURCE_DUMP_SHA256 }))
      .toEqual(good);

    // a wrong sourceDumpSha256 (the caller's OWN expected hash, from the recorded R1 evidence)
    expect(() => parseAflApiImporterRecoveryExport(good, { sourceDumpSha256: 'c'.repeat(64) }))
      .toThrow(/sourceDumpSha256 is .*, expected the recorded R1 hash/);

    // a tampered row (any field edited after the hash was computed) -- payloadSha256 no longer matches
    const tampered = { ...good, rows: [{ ...good.rows[0], playerIdentity: 'players/Z/Different.html' }] };
    expect(() => parseAflApiImporterRecoveryExport(tampered, { sourceDumpSha256: SOURCE_DUMP_SHA256 }))
      .toThrow(/payloadSha256 does not match/);

    // a wrong format/version string
    expect(() => parseAflApiImporterRecoveryExport({ ...good, format: 'wrong' }, { sourceDumpSha256: SOURCE_DUMP_SHA256 }))
      .toThrow(/export format is/);
    expect(() => parseAflApiImporterRecoveryExport({ ...good, version: 2 }, { sourceDumpSha256: SOURCE_DUMP_SHA256 }))
      .toThrow(/export version is/);

    // a missing required field
    const { capturedAt: _capturedAt, ...missingField } = good;
    expect(() => parseAflApiImporterRecoveryExport(missingField, { sourceDumpSha256: SOURCE_DUMP_SHA256 }))
      .toThrow(/missing a required field/);

    // not an object at all
    expect(() => parseAflApiImporterRecoveryExport(null, { sourceDumpSha256: SOURCE_DUMP_SHA256 }))
      .toThrow(/not a JSON object/);
    expect(() => parseAflApiImporterRecoveryExport('a string', { sourceDumpSha256: SOURCE_DUMP_SHA256 }))
      .toThrow(/not a JSON object/);
  });

  /**
   * A minimal `TransactionSql` stand-in: a tagged-template callable that records every
   * statement and answers from an ordered list of `[matcher, response]` pairs, the first whose
   * matcher's substrings all appear in the (whitespace-collapsed) statement text. Unmatched
   * statements throw immediately, so a scenario that reaches an unexpected query fails loudly
   * rather than silently answering `[]`.
   */
  function fakeRecoveryTx(rules: Array<{ includes: string[]; respond: (params: unknown[]) => unknown[] }>) {
    const statements: Array<{ text: string; params: unknown[] }> = [];
    const call = (strings: unknown, ...params: unknown[]) => {
      if (Array.isArray(strings) && 'raw' in strings) {
        const text = (strings as string[]).reduce((acc, s, i) => `${acc}${i ? `$${i}` : ''}${s}`, '')
          .replace(/\s+/g, ' ').trim();
        statements.push({ text, params });
        const rule = rules.find((r) => r.includes.every((needle) => text.includes(needle)));
        // `readRebuildMarker`'s own connection check; every scenario here is on afldb_test.
        if (!rule && text === 'SELECT current_database() AS actual') return Promise.resolve([{ actual: 'afldb_test' }]);
        if (!rule) throw new Error(`fakeRecoveryTx: no rule matched statement: ${text}`);
        return Promise.resolve(rule.respond(params));
      }
      return { identifier: strings };
    };
    // postgres.js `sql.array(value)` returns an opaque bind wrapper for a single template
    // parameter; the fake never inspects bound values (matching is on statement TEXT only,
    // via `includes`), so passing the array straight through is enough for the real
    // `readAflApiForwardIdentities()` call (`... = ANY (${tx.array([...playerIds])})`) to run
    // without throwing `tx.array is not a function`.
    const tx = Object.assign(call, {
      savepoint: async (cb: (sp: unknown) => unknown) => cb(call),
      array: (value: unknown[]) => value,
    });
    return { tx: tx as unknown as import('postgres').TransactionSql, statements };
  }

  const SOURCE_ID_RULE = { includes: ["SELECT id FROM sources WHERE key = 'afl_api'"], respond: () => [{ id: 1 }] };
  const EMPTY_LEDGER_RULE = { includes: ['FROM afl_api_identity_adjudications'], respond: () => [] };
  const EMPTY_RESOLVED_RULE = { includes: ['external_identities', "status = 'resolved'"], respond: () => [] };
  const EMPTY_CENSUS_RULE = { includes: ['"candidateCount"'], respond: () => [] };
  const EMPTY_NAMES_RULE = { includes: ['externalName', 'notes'], respond: () => [] };
  const NO_MARKER_RULE = { includes: ["obj_description(oid, 'pg_database')"], respond: () => [{ comment: null }] };

  it('D15 exact set: an EMPTY ledger still refuses a non-empty expected supersede set, writing nothing', async () => {
    const rules = [SOURCE_ID_RULE, EMPTY_LEDGER_RULE,
      { includes: ['FROM external_identities WHERE source_id'], respond: () => [] }];
    // nothing expected: the pre-ISSUE-237 short-circuit, no further statement
    const quiet = fakeRecoveryTx(rules);
    expect(await replayAflApiAdjudications(quiet.tx)).toEqual({ inserted: 0, noops: 0, stops: [], supersedes: [] });
    expect(quiet.statements.some((s) => s.text.includes('WHERE source_id'))).toBe(false);
    // something expected: fewer supersedes than expected is a D13 abort, never a silent pass
    const strict = fakeRecoveryTx(rules);
    await expect(replayAflApiAdjudications(strict.tx, new Set(['CD_I1'])))
      .rejects.toThrow(/supersede set did not match the expected set exactly -- nothing written \(missing: CD_I1; extra: none\)/);
    expect(strict.statements.some((s) => /\b(INSERT|UPDATE|DELETE)\b/.test(s.text))).toBe(false);
  });

  /*
   * A STATEFUL stand-in for afldb_test's `afl_api` slice: `external_identities` rows for the
   * afl_api source, the accepted AFL Tables/manual paths the forward and reverse lookups read,
   * and the adjudication ledger. Every statement the R4 path issues is answered from this state
   * at the moment it runs, an INSERT really appends, a savepoint really restores on throw, and a
   * READ ONLY transaction really refuses a write -- so parity, invariant and rollback are
   * exercised against what was actually written rather than scripted per call.
   */
  type FakeAflRow = {
    externalId: string; status: string; matchMethod: string | null; playerId: number | null;
    candidateCount: number; externalUrl: string | null; externalName: string | null; notes: string | null;
  };
  type FakeDbState = {
    database: string;
    comment: string | null;
    afl: FakeAflRow[];
    paths: Array<{ playerId: number; externalId: string; sourceKey: 'afltables' | 'manual_admin_edit' }>;
    ledger: Array<{ id: number; externalId: string; action: 'linked' | 'revoked'; playerId: number; playerIdentity: string; supersedesId: number | null }>;
  };
  type FakeDbHooks = { afterInsert?: (state: FakeDbState, insertedSoFar: number) => void };

  function fakeAflApiDb(state: FakeDbState, opts: { readOnly?: boolean; hooks?: FakeDbHooks } = {}) {
    const statements: Array<{ text: string; params: unknown[] }> = [];
    let inserts = 0;
    const answer = (text: string, params: unknown[]): unknown[] => {
      if (text === 'SELECT current_database() AS database') return [{ database: state.database }];
      if (text === 'SELECT current_database() AS actual') return [{ actual: state.database }];
      if (text.includes("shobj_description(oid, 'pg_database')")) return [{ comment: state.comment }];
      if (text.includes("SELECT id FROM sources WHERE key = 'afl_api'")) return [{ id: 1 }];
      if (text.includes('FROM afl_api_identity_adjudications')) return state.ledger.map((r) => ({ ...r }));
      if (text.includes('INSERT INTO external_identities')) {
        if (opts.readOnly) throw new Error('cannot execute INSERT in a read-only transaction');
        const [, externalId, playerId, matchMethod, externalName, externalUrl, notes] = params as [
          number, string, number, string, string | null, string | null, string | null];
        if (state.afl.some((r) => r.externalId === externalId)) throw new Error(`duplicate key: ${externalId}`);
        state.afl.push({ externalId, status: 'unique', matchMethod, playerId, candidateCount: 1, externalUrl, externalName, notes });
        inserts += 1;
        opts.hooks?.afterInsert?.(state, inserts);
        return [];
      }
      if (/\b(UPDATE|DELETE)\b/.test(text)) throw new Error(`fakeAflApiDb: unexpected write: ${text}`);
      if (text.includes('DISTINCT ei.player_id')) {
        return [...new Set(state.paths.filter((p) => p.externalId === params[0]).map((p) => p.playerId))].map((playerId) => ({ playerId }));
      }
      if (text.includes('"sourceKey"')) return state.paths.map((p) => ({ ...p }));
      if (text.includes("status = 'resolved'")) {
        return state.afl.filter((r) => r.status === 'resolved').map((r) => ({ externalId: r.externalId, status: r.status, matchMethod: r.matchMethod }));
      }
      if (text.includes('FROM external_identities WHERE source_id')) return state.afl.map((r) => ({ ...r }));
      throw new Error(`fakeAflApiDb: no answer for statement: ${text}`);
    };
    const call = (strings: unknown, ...params: unknown[]) => {
      if (!(Array.isArray(strings) && 'raw' in strings)) return { identifier: strings };
      const text = (strings as string[]).reduce((acc, s, i) => `${acc}${i ? `$${i}` : ''}${s}`, '').replace(/\s+/g, ' ').trim();
      statements.push({ text, params });
      try {
        return Promise.resolve(answer(text, params));
      } catch (error) {
        return Promise.reject(error);
      }
    };
    const tx = Object.assign(call, {
      savepoint: async (cb: (sp: unknown) => unknown) => {
        const snapshot = structuredClone(state.afl);
        try {
          return await cb(call);
        } catch (error) {
          state.afl = snapshot;
          throw error;
        }
      },
      array: (value: unknown[]) => value,
    });
    return { tx: tx as unknown as TransactionSql, statements };
  }

  /** The target's accepted AFL Tables path for every row: identity -> a NEW player id (D3 remap). */
  const targetPathsFor = (rows: readonly CapturedImporterRow[], offset = 50_000): FakeDbState['paths'] =>
    rows.map((r, i) => ({ playerId: offset + i, externalId: r.playerIdentity, sourceKey: 'afltables' as const }));

  const emptyTarget = (rows: readonly CapturedImporterRow[]): FakeDbState => ({
    database: 'afldb_test', comment: null, afl: [], paths: targetPathsFor(rows), ledger: [],
  });

  it('target guard — refuses any database other than afldb_test, before any other query', async () => {
    const { tx, statements } = fakeRecoveryTx([
      { includes: ['SELECT current_database() AS database'], respond: () => [{ database: 'afldb_dev' }] },
    ]);
    const good = exportOf([oneRow()]);
    await expect(recoverAflApiImporterIdentities(tx, {
      expectedSourceDumpSha256: SOURCE_DUMP_SHA256, export: good, mode: 'validate-only',
    })).rejects.toThrow(/target must be afldb_test, connected to 'afldb_dev'/);
    expect(statements).toHaveLength(1); // refused before consulting anything else
  });

  it('marker guard — refuses when a rebuild marker is present on afldb_test (read with shobj_description, the rebuild\'s own strict reader), and on a foreign database comment', async () => {
    const marker = JSON.stringify({
      format: CAPTURE_FORMAT, version: CAPTURE_VERSION, capturedAt: '2026-09-25T00:00:00.000Z',
      payloadSha256: 'a'.repeat(64), fileSha256: 'c'.repeat(64),
    });
    for (const [comment, message] of [
      [marker, /a rebuild marker is present on afldb_test/],
      ['a hand-written note', /not valid JSON/],
    ] as const) {
      const { tx, statements } = fakeRecoveryTx([
        { includes: ['SELECT current_database() AS database'], respond: () => [{ database: 'afldb_test' }] },
        { includes: ["shobj_description(oid, 'pg_database')"], respond: () => [{ comment }] },
      ]);
      const good = exportOf([oneRow()]);
      await expect(recoverAflApiImporterIdentities(tx, {
        expectedSourceDumpSha256: SOURCE_DUMP_SHA256, export: good, mode: 'validate-only',
      })).rejects.toThrow(message);
      expect(statements).toHaveLength(3); // target, marker's own connection check, the comment
    }
  });

  it('fail closed (OD-1) — an unresolvable captured identity rolls back everything, in validate-only mode', async () => {
    const good = exportOf([oneRow()]);
    const { tx } = fakeRecoveryTx([
      { includes: ['SELECT current_database() AS database'], respond: () => [{ database: 'afldb_test' }] },
      NO_MARKER_RULE,
      SOURCE_ID_RULE,
      EMPTY_LEDGER_RULE,
      EMPTY_RESOLVED_RULE,
      EMPTY_CENSUS_RULE,
      EMPTY_NAMES_RULE,
      // resolveAflApiPlayerIdentity for the captured row's OWN identity: zero matches -> unresolvable
      { includes: ['DISTINCT ei.player_id'], respond: () => [] },
      // replayAflApiImporterRows' own candidate-state read (no candidateCount column)
      { includes: ['FROM external_identities WHERE source_id'], respond: () => [] },
    ]);
    await expect(recoverAflApiImporterIdentities(tx, {
      expectedSourceDumpSha256: SOURCE_DUMP_SHA256, export: good, mode: 'validate-only',
    })).rejects.toThrow(AflApiReplayAbort);
  });

  it('validate-only plans the exact write set and writes nothing; dry-run writes, proves R5 on the written state, and rolls its savepoint back — nothing is ever applied outside apply mode', async () => {
    const good = exportOf([oneRow()]);

    const validateState = emptyTarget([oneRow()]);
    const validate = fakeAflApiDb(validateState, { readOnly: true });
    const validated = await recoverAflApiImporterIdentities(validate.tx, {
      expectedSourceDumpSha256: SOURCE_DUMP_SHA256, export: good, mode: 'validate-only',
    });
    expect(validated).toMatchObject({
      mode: 'validate-only', wouldInsert: 1, alreadyIdentical: 0, inserted: 0, preExistingImporterRows: 0,
      plannedProviders: [oneRow().externalId], projectedParity: 'PASS', writtenParity: 'NOT RUN', applied: false,
      countsByMethod: { afl_api_stat_vector_bootstrap: 1 },
    });
    expect(validate.statements.some((s) => /\b(INSERT|UPDATE|DELETE)\b/i.test(s.text))).toBe(false);
    expect(validateState.afl).toEqual([]);

    const dryState = emptyTarget([oneRow()]);
    const dry = fakeAflApiDb(dryState);
    const dried = await recoverAflApiImporterIdentities(dry.tx, {
      expectedSourceDumpSha256: SOURCE_DUMP_SHA256, export: good, mode: 'dry-run',
    });
    expect(dried).toMatchObject({ mode: 'dry-run', wouldInsert: 1, inserted: 1, writtenParity: 'PASS', applied: false });
    // the INSERT was genuinely executed (proving the write would succeed), then rolled back
    expect(dry.statements.filter((s) => s.text.includes('INSERT INTO external_identities'))).toHaveLength(1);
    expect(dryState.afl).toEqual([]);
  });

  it('existing non-identical row refusal — a live importer row the export does not reproduce identically refuses, with nothing continuing; the one-provider-per-player collision is the SAME pre-check, not a distinct path', async () => {
    const good = exportOf([oneRow()]);

    // Case 1: SAME provider (oneRow()'s own externalId) already live, but resolved to a
    // DIFFERENT identity under a DIFFERENT method. `recoverAflApiImporterIdentities`'s R4
    // pre-check (`nonIdentical`) compares every LIVE importer row against the export by
    // externalId and refuses on any that is not byte-identical -- before
    // `replayAflApiImporterRows` (and so the real INSERT path) is ever reached.
    {
      const { tx, statements } = fakeRecoveryTx([
        { includes: ['SELECT current_database() AS database'], respond: () => [{ database: 'afldb_test' }] },
        NO_MARKER_RULE,
        SOURCE_ID_RULE,
        EMPTY_LEDGER_RULE,
        EMPTY_RESOLVED_RULE,
        {
          includes: ['"candidateCount"'], respond: () => [{
            externalId: oneRow().externalId, status: 'unique', matchMethod: 'afl_api_name_team_season_bootstrap',
            playerId: 999, candidateCount: 1, externalUrl: null,
          }],
        },
        { includes: ['"sourceKey"'], respond: () => [{ playerId: 999, externalId: 'players/Z/Different-live.html', sourceKey: 'afltables' }] },
        EMPTY_NAMES_RULE,
      ]);
      await expect(recoverAflApiImporterIdentities(tx, {
        expectedSourceDumpSha256: SOURCE_DUMP_SHA256, export: good, mode: 'apply',
      })).rejects.toThrow(/afldb_test already holds 1 importer row\(s\) that are not identical to an export entry: CD_I9990000099/);
      // no overwrite, no partial continuation: refused before the replay planner ever runs
      expect(statements.some((s) => /\b(INSERT|UPDATE|DELETE)\b/i.test(s.text))).toBe(false);
    }

    // Case 2 (the one-provider-per-player collision): the SAME target player already holds a
    // DIFFERENT provider's importer row, and that other provider is absent from the export.
    // `readAflApiImporterRows` returns this row too, so the R4 pre-check refuses on it by the
    // EXACT SAME "not identical to an export entry" path -- NOT by
    // `planAflApiImporterReplay`'s own `candidatePlayerAflApiRow` collision STOP. On this
    // tool's own call graph that STOP is unreachable: the R4 pre-check always refuses first on
    // any live importer row the export does not reproduce identically, including one under an
    // entirely different provider id for the very player the export's own row would resolve to.
    {
      const { tx, statements } = fakeRecoveryTx([
        { includes: ['SELECT current_database() AS database'], respond: () => [{ database: 'afldb_test' }] },
        NO_MARKER_RULE,
        SOURCE_ID_RULE,
        EMPTY_LEDGER_RULE,
        EMPTY_RESOLVED_RULE,
        {
          includes: ['"candidateCount"'], respond: () => [{
            externalId: 'CD_I9990000999', status: 'unique', matchMethod: 'afl_api_stat_vector_bootstrap',
            playerId: 12345, candidateCount: 1, externalUrl: null,
          }],
        },
        // player 12345's own AFL Tables identity is exactly oneRow()'s playerIdentity -- the
        // export's row would resolve to the SAME player, under a DIFFERENT provider id.
        { includes: ['"sourceKey"'], respond: () => [{ playerId: 12345, externalId: oneRow().playerIdentity, sourceKey: 'afltables' }] },
        EMPTY_NAMES_RULE,
      ]);
      await expect(recoverAflApiImporterIdentities(tx, {
        expectedSourceDumpSha256: SOURCE_DUMP_SHA256, export: good, mode: 'apply',
      })).rejects.toThrow(/afldb_test already holds 1 importer row\(s\) that are not identical to an export entry: CD_I9990000999/);
      expect(statements.some((s) => /\b(INSERT|UPDATE|DELETE)\b/i.test(s.text))).toBe(false);
    }
  });

  it('full apply-mode success — the real control flow end to end (plan, INSERT, the R5 post-write parity re-read, the bijection re-check), asserting the exact final write set with no surrogate carry-through (D3)', async () => {
    const TARGET_PLAYER_ID = 777; // the CURRENT afldb_test player the identity re-derives to
    const applyRow = (): CapturedImporterRow => ({
      externalId: 'CD_I9990000200', playerIdentity: 'players/Z/Recovery-apply-test.html',
      matchMethod: 'afl_api_stat_vector_bootstrap', status: 'unique', candidateCount: 1,
      externalName: null, externalUrl: null, notes: null,
      playerId: 999999999, // the SOURCE database's own stale surrogate -- must never be written back
    });
    const good = exportOf([applyRow()]);

    // The captured row's OWN identity resolves to the CURRENT player id, never the captured
    // row's stale `playerId` (D3).
    const state: FakeDbState = {
      ...emptyTarget([]), paths: [{ playerId: TARGET_PLAYER_ID, externalId: applyRow().playerIdentity, sourceKey: 'afltables' }],
    };
    const { tx, statements } = fakeAflApiDb(state);

    const result = await recoverAflApiImporterIdentities(tx, {
      expectedSourceDumpSha256: SOURCE_DUMP_SHA256, export: good, mode: 'apply',
    });
    expect(result).toMatchObject({ mode: 'apply', wouldInsert: 1, alreadyIdentical: 0, inserted: 1, writtenParity: 'PASS', applied: true });
    expect(state.afl).toEqual([{
      externalId: applyRow().externalId, status: 'unique', matchMethod: applyRow().matchMethod, playerId: TARGET_PLAYER_ID,
      candidateCount: 1, externalUrl: null, externalName: null, notes: null,
    }]);

    // The exact final write set: exactly ONE INSERT, carrying the RESOLVED player id, never
    // the captured row's stale surrogate (D3 -- "no surrogate ids across a lineage").
    const inserts = statements.filter((s) => s.text.includes('INSERT INTO external_identities'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0].params).toContain(TARGET_PLAYER_ID);
    expect(inserts[0].params).not.toContain(applyRow().playerId);

    // No unexpected mutation: nothing else written, and R5's parity/count/bijection checks
    // (which would themselves throw AflApiRecoveryAbort/AflApiReplayAbort on any mismatch)
    // were genuinely exercised, not short-circuited -- proven by the census re-read AFTER the INSERT.
    expect(statements.filter((s) => /\b(UPDATE|DELETE)\b/i.test(s.text))).toEqual([]);
    const insertAt = statements.findIndex((s) => s.text.includes('INSERT INTO external_identities'));
    expect(statements.slice(insertAt + 1).some((s) => s.text.includes('"candidateCount"'))).toBe(true);
    expect(statements.slice(insertAt + 1).some((s) => s.text.includes('FROM afl_api_identity_adjudications'))).toBe(true);
  });

  /*
   * AFLDB-ISSUE-237 continuity amendment, reverse direction, on R4's own call graph: an export
   * row whose identity is a tracked rule's continuing_url (a folded source player) recovers only
   * onto a target holding BOTH rule paths on one player. R4 reaches the check through
   * `planAflApiImporterRowsLive` -> `resolveAflApiPlayerIdentity`, so this is the same guard
   * Stage 18 runs, not a copy of it.
   */
  describe('continuity reverse check (R4/R5)', () => {
    const rule = loadFitzroyProfileContinuityRules()[0];
    const FOLDED = 4242;
    const continuityRow = (): CapturedImporterRow => ({
      externalId: 'CD_I9990000300', playerIdentity: rule.continuingUrl,
      matchMethod: 'afl_api_stat_vector_bootstrap', status: 'unique', candidateCount: 1,
      externalName: null, externalUrl: null, notes: null, playerId: 999999998,
    });
    const recoveryTx = (byPath: Record<string, number[]>, census: () => unknown[] = () => []) => fakeRecoveryTx([
      { includes: ['SELECT current_database() AS database'], respond: () => [{ database: 'afldb_test' }] },
      NO_MARKER_RULE,
      SOURCE_ID_RULE,
      EMPTY_LEDGER_RULE,
      EMPTY_RESOLVED_RULE,
      { includes: ['"candidateCount"'], respond: census },
      EMPTY_NAMES_RULE,
      // the reverse lookup, answered PER PATH (its only bound parameter)
      { includes: ['DISTINCT ei.player_id'], respond: (params) => (byPath[params[0] as string] ?? []).map((playerId) => ({ playerId })) },
      { includes: ['FROM external_identities WHERE source_id'], respond: () => [] },
      { includes: ['INSERT INTO external_identities'], respond: () => [] },
      {
        includes: ['"sourceKey"'], respond: () => Object.entries(byPath).flatMap(([externalId, ids]) =>
          ids.map((playerId) => ({ playerId, externalId, sourceKey: 'afltables' }))),
      },
    ]);

    it('(9) R4 refuses a SPLIT target in every mode, before any INSERT', async () => {
      const good = exportOf([continuityRow()]);
      for (const mode of ['validate-only', 'dry-run', 'apply'] as const) {
        const { tx, statements } = recoveryTx({ [rule.continuingUrl]: [FOLDED], [rule.renumberedUrl]: [FOLDED + 1] });
        await expect(recoverAflApiImporterIdentities(tx, {
          expectedSourceDumpSha256: SOURCE_DUMP_SHA256, export: good, mode,
        }), mode).rejects.toThrow(new RegExp(
          `CD_I9990000300 \\(the captured row's player identity is named by tracked profile_url_continuity rule ${rule.id} `
          + 'and the target contradicts it: its continuing_url and renumbered_url resolve to different target players'));
        expect(statements.some((s) => /\b(INSERT|UPDATE|DELETE)\b/i.test(s.text)), mode).toBe(false);
      }
    });

    it('R4 refuses a target missing the renumbered path, rather than falling back to the continuing path', async () => {
      const { tx, statements } = recoveryTx({ [rule.continuingUrl]: [FOLDED] });
      await expect(recoverAflApiImporterIdentities(tx, {
        expectedSourceDumpSha256: SOURCE_DUMP_SHA256, export: exportOf([continuityRow()]), mode: 'apply',
      })).rejects.toThrow(/its renumbered_url resolves to no target player/);
      expect(statements.some((s) => /\bINSERT\b/i.test(s.text))).toBe(false);
    });

    it('R4 + R5 accept the FOLDED target (the real afldb_test shape): one INSERT onto the folded player, parity exact', async () => {
      const state: FakeDbState = {
        ...emptyTarget([]),
        paths: [
          { playerId: FOLDED, externalId: rule.continuingUrl, sourceKey: 'afltables' },
          { playerId: FOLDED, externalId: rule.renumberedUrl, sourceKey: 'afltables' },
        ],
      };
      const { tx, statements } = fakeAflApiDb(state);
      const result = await recoverAflApiImporterIdentities(tx, {
        expectedSourceDumpSha256: SOURCE_DUMP_SHA256, export: exportOf([continuityRow()]), mode: 'apply',
      });
      expect(result).toMatchObject({ mode: 'apply', inserted: 1, alreadyIdentical: 0, writtenParity: 'PASS', applied: true });
      const inserts = statements.filter((s) => s.text.includes('INSERT INTO external_identities'));
      expect(inserts).toHaveLength(1);
      expect(inserts[0].params).toContain(FOLDED);
      // R5's post-write re-read found the row under the rule's continuing path
      expect(state.afl.map((r) => [r.externalId, r.playerId])).toEqual([[continuityRow().externalId, FOLDED]]);
    });
  });

  /*
   * §11a R4 operator CLI (`npm run db:issue237:recover-importer-identities`), DB-free. The CLI
   * adds no identity logic: these prove its argv, credential, export binding and transaction
   * contract around `recoverAflApiImporterIdentities`, against the stateful fake above.
   */
  describe('R4 recovery CLI (modes, target credential, export binding, transaction semantics)', () => {
    const IMPORT = 'postgres://afldb_import:s3cret-import@db.internal:5432/afldb_test';
    const OWNER = 'postgres://afldb_owner:s3cret-owner@db.internal:5432/afldb_test';
    const R3_SOURCE = { sourceDatabase: R3_SOURCE_DATABASE, sourceDumpSha256: R3_SOURCE_DUMP_SHA256 };

    /** 802 captured rows with R1's exact method split (3/129/397/273). */
    function r4Rows(): CapturedImporterRow[] {
      const rows: CapturedImporterRow[] = [];
      let i = 0;
      for (const method of Object.keys(R3_EXPECTED_COUNTS_BY_METHOD).sort()) {
        for (let k = 0; k < R3_EXPECTED_COUNTS_BY_METHOD[method]; k += 1) {
          i += 1;
          rows.push({
            externalId: `CD_I${9990200000 + i}`, playerIdentity: `players/T/R4_Test_${i}.html`,
            matchMethod: method as CapturedImporterRow['matchMethod'], status: 'unique', candidateCount: 1,
            externalName: i % 2 ? `R4 Test ${i}` : null, externalUrl: null, notes: i % 7 ? null : `note ${i}`,
            playerId: i, // the SOURCE surrogate, never written back
          });
        }
      }
      return rows.sort((a, b) => a.externalId.localeCompare(b.externalId));
    }

    const verifiedOf = (rows: readonly CapturedImporterRow[]): VerifiedR4Export => {
      const exported = exportOf(rows, R3_SOURCE);
      return { path: 'D:\\fake\\export.json', fileSha256: 'F'.repeat(64), exported, census: assertR3ExportBinding(exported) };
    };

    /**
     * Connections over ONE shared fake state. `begin` snapshots the state and restores it on a
     * throw (ROLLBACK), keeps it on return (COMMIT), and enforces READ ONLY; every lifecycle
     * event lands in `log` in order.
     */
    function fakeR4Connections(state: FakeDbState, hooks: FakeDbHooks & { afterCommit?: (s: FakeDbState) => void } = {}) {
      const log: string[] = [];
      const transactions: Array<{ options: string; statements: Array<{ text: string; params: unknown[] }> }> = [];
      const connect = (): R4Connection => {
        log.push('CONNECT');
        return {
          begin: async <T,>(options: string, fn: (tx: TransactionSql) => Promise<T>): Promise<T> => {
            log.push(`BEGIN ${options}`);
            const snapshot = structuredClone(state);
            const fake = fakeAflApiDb(state, { readOnly: options.includes('read only'), hooks });
            transactions.push({ options, statements: fake.statements });
            try {
              const result = await fn(fake.tx);
              log.push('COMMIT');
              hooks.afterCommit?.(state);
              return result;
            } catch (error) {
              Object.assign(state, snapshot);
              log.push('ROLLBACK');
              throw error;
            }
          },
          end: async () => { log.push('END'); },
        };
      };
      return { connect, log, transactions };
    }

    const run = (mode: 'validate-only' | 'dry-run' | 'apply', state: FakeDbState, rows = r4Rows(), hooks: Parameters<typeof fakeR4Connections>[1] = {}) => {
      const conns = fakeR4Connections(state, hooks);
      const promise = executeR4Recovery({
        mode, verified: verifiedOf(rows), credential: 'AFLDB_TEST_IMPORT_DATABASE_URL (restricted importer)', connect: conns.connect,
      });
      return { ...conns, promise };
    };
    const writes = (t: { statements: Array<{ text: string }> }) => t.statements.filter((s) => /\b(INSERT|UPDATE|DELETE)\b/i.test(s.text));

    // -- (1)(2) argv -------------------------------------------------------------------------
    const ARGS = ['--export', 'D:\\x\\e.json', '--source-dump-sha256', R3_SOURCE_DUMP_SHA256];

    it('(1) argv — exactly validate-only, dry-run and apply are accepted', () => {
      for (const mode of ['validate-only', 'dry-run', 'apply'] as const) {
        expect(parseR4Args([mode, ...ARGS])).toEqual({
          mode, export: 'D:\\x\\e.json', sourceDumpSha256: R3_SOURCE_DUMP_SHA256, allowOwnerImportDsn: false,
        });
        expect(parseR4Args([mode, '--allow-owner-import-dsn', ...ARGS]).allowOwnerImportDsn).toBe(true);
      }
      for (const bad of [undefined, 'export', 'validate', '--validate-only', 'Apply', 'dry_run', 'commit']) {
        expect(() => parseR4Args(bad === undefined ? [] : [bad, ...ARGS])).toThrow(/mode must be one of validate-only, dry-run, apply/);
      }
    });

    it('(2) argv — unknown, bare, repeated or valueless flags and a missing required flag are refused', () => {
      expect(() => parseR4Args(['apply', ...ARGS, '--dsn', IMPORT])).toThrow(/unknown argument "--dsn"/);
      expect(() => parseR4Args(['apply', ...ARGS, '--force'])).toThrow(/unknown argument "--force"/);
      expect(() => parseR4Args(['apply', ...ARGS, 'afldb_test'])).toThrow(/unknown argument "afldb_test"/);
      expect(() => parseR4Args(['apply', ...ARGS, '--target', 'afldb_test'])).toThrow(/unknown argument "--target"/);
      expect(() => parseR4Args(['apply', ...ARGS, '--export', 'D:\\y.json'])).toThrow(/--export was given more than once/);
      expect(() => parseR4Args(['apply', '--allow-owner-import-dsn', '--allow-owner-import-dsn', ...ARGS])).toThrow(/more than once/);
      expect(() => parseR4Args(['apply', '--export', '--source-dump-sha256', R3_SOURCE_DUMP_SHA256])).toThrow(/--export needs a value/);
      expect(() => parseR4Args(['apply', '--export', 'D:\\x\\e.json', '--source-dump-sha256'])).toThrow(/--source-dump-sha256 needs a value/);
      expect(() => parseR4Args(['apply', '--export', 'D:\\x\\e.json'])).toThrow(/--source-dump-sha256 is required/);
      expect(() => parseR4Args(['apply', '--source-dump-sha256', R3_SOURCE_DUMP_SHA256])).toThrow(/--export is required/);
    });

    // -- (3)(4) target credential --------------------------------------------------------------
    it('(3) target — a DSN naming anything but afldb_test is refused before connecting, and the live current_database() is re-proven in the transaction', async () => {
      for (const name of ['afldb_dev', 'code_test_db', 'issue237_r1_restore', 'afldb_prod', 'afldb', 'afldb_test_copy', 'AFLDB_TEST']) {
        const dsn = IMPORT.replace('/afldb_test', `/${name}`);
        expect(() => resolveR4TargetDsn({ AFLDB_TEST_IMPORT_DATABASE_URL: dsn }, { allowOwnerImportDsn: false }), name)
          .toThrow(new RegExp(`is '${name}'; the only recovery target is 'afldb_test'`));
        expect(() => resolveR4TargetDsn({ AFLDB_TEST_DATABASE_URL: OWNER.replace('/afldb_test', `/${name}`) }, { allowOwnerImportDsn: true }), name)
          .toThrow(/the only recovery target is 'afldb_test'/);
      }
      expect(() => resolveR4TargetDsn({ AFLDB_TEST_IMPORT_DATABASE_URL: 'not a url' }, { allowOwnerImportDsn: false }))
        .toThrow(/AFLDB_TEST_IMPORT_DATABASE_URL is not a valid connection URL/);

      // the DSN path is only an early refusal: a connection that lands elsewhere is refused live
      for (const database of ['code_test_db', 'afldb_dev', 'issue237_r1_restore']) {
        const rows = r4Rows();
        const state = { ...emptyTarget(rows), database };
        const { promise, log, transactions } = run('apply', state, rows);
        await expect(promise).rejects.toThrow(new RegExp(`target must be afldb_test, connected to '${database}'`));
        expect(transactions[0].statements).toHaveLength(1);
        expect(log).toEqual(['CONNECT', `BEGIN ${R4_TRANSACTION_OPTIONS.apply}`, 'ROLLBACK', 'END']);
      }
    });

    it('(4) credential — the restricted import DSN is the contract; the owner DSN only with an explicit --allow-owner-import-dsn; a missing credential is refused; no DSN is ever echoed', () => {
      expect(resolveR4TargetDsn({ AFLDB_TEST_IMPORT_DATABASE_URL: IMPORT, AFLDB_TEST_DATABASE_URL: OWNER }, { allowOwnerImportDsn: false }))
        .toEqual({ dsn: IMPORT, credential: 'AFLDB_TEST_IMPORT_DATABASE_URL (restricted importer)' });
      // the flag is a fallback, never an override of a configured restricted credential
      expect(resolveR4TargetDsn({ AFLDB_TEST_IMPORT_DATABASE_URL: IMPORT, AFLDB_TEST_DATABASE_URL: OWNER }, { allowOwnerImportDsn: true }).dsn)
        .toBe(IMPORT);
      expect(() => resolveR4TargetDsn({ AFLDB_TEST_DATABASE_URL: OWNER }, { allowOwnerImportDsn: false }))
        .toThrow(/AFLDB_TEST_IMPORT_DATABASE_URL is not set.*--allow-owner-import-dsn/);
      expect(() => resolveR4TargetDsn({ AFLDB_TEST_IMPORT_DATABASE_URL: '  ' }, { allowOwnerImportDsn: false }))
        .toThrow(/AFLDB_TEST_IMPORT_DATABASE_URL is not set/);
      expect(() => resolveR4TargetDsn({}, { allowOwnerImportDsn: true }))
        .toThrow(/--allow-owner-import-dsn was given but AFLDB_TEST_DATABASE_URL is not set/);
      expect(resolveR4TargetDsn({ AFLDB_TEST_DATABASE_URL: OWNER }, { allowOwnerImportDsn: true }))
        .toEqual({ dsn: OWNER, credential: 'AFLDB_TEST_DATABASE_URL (owner, --allow-owner-import-dsn)' });
      // the DSN reaches only the returned `dsn`: never a refusal, never the printed credential
      for (const env of [
        { AFLDB_TEST_IMPORT_DATABASE_URL: IMPORT.replace('/afldb_test', '/afldb_dev') },
        { AFLDB_TEST_DATABASE_URL: OWNER.replace('/afldb_test', '/afldb_dev') },
      ]) {
        try { resolveR4TargetDsn(env, { allowOwnerImportDsn: true }); } catch (e) {
          expect((e as Error).message).not.toMatch(/s3cret|db\.internal|afldb_import:|afldb_owner:/);
        }
      }
      expect(resolveR4TargetDsn({ AFLDB_TEST_IMPORT_DATABASE_URL: IMPORT }, { allowOwnerImportDsn: false }).credential).not.toMatch(/s3cret|postgres:/);
    });

    // -- (5) marker ----------------------------------------------------------------------------
    it('(5) marker — a pending rebuild marker on afldb_test refuses every mode before any planning, with nothing written', async () => {
      const marker = JSON.stringify({
        format: CAPTURE_FORMAT, version: CAPTURE_VERSION, capturedAt: '2026-09-25T00:00:00.000Z',
        payloadSha256: 'a'.repeat(64), fileSha256: 'c'.repeat(64),
      });
      for (const mode of ['validate-only', 'dry-run', 'apply'] as const) {
        const rows = r4Rows();
        const state = { ...emptyTarget(rows), comment: marker };
        const { promise, log, transactions } = run(mode, state, rows);
        await expect(promise, mode).rejects.toThrow(/a rebuild marker is present on afldb_test/);
        expect(transactions[0].statements.some((s) => s.text.includes('DISTINCT ei.player_id')), mode).toBe(false);
        expect(writes(transactions[0])).toEqual([]);
        expect(log.filter((e) => e === 'COMMIT'), mode).toEqual([]);
      }
    });

    // -- (6)–(12) export binding ---------------------------------------------------------------
    describe('export binding (read before any connection)', () => {
      let dir: string;
      beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'afldb-i237-r4-')); });
      afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

      /** Writes an export the way R3 does and returns the binding that would accept exactly it. */
      const writeExport = (exported: unknown, name = 'export.json') => {
        const path = join(dir, name);
        writeFileSync(path, `${JSON.stringify(exported, null, 2)}\n`);
        const fileSha256 = createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();
        const payloadSha256 = (exported as { payloadSha256: string }).payloadSha256;
        return { path, binding: { sourceDumpSha256: R3_SOURCE_DUMP_SHA256, payloadSha256, fileSha256 } };
      };

      it('binds to the exact R3 PASS evidence by default', () => {
        expect(R4_EXPORT_BINDING).toEqual({
          sourceDumpSha256: 'B6552DC4583AFCBE28C61EE605FC995146D112FDB3424FCE4A82144BBAE3C436',
          payloadSha256: '3cfad942dabed98d69452a71b6f57b82cc951b63109fb0152dc74f362f6bcb9b',
          fileSha256: '870EA366C63E9C6C434E8A41340B024A43BC80D413E41FF99B1D398836175D35',
        });
        expect([R4_EXPORT_PAYLOAD_SHA256, R4_EXPORT_FILE_SHA256]).toEqual([R4_EXPORT_BINDING.payloadSha256, R4_EXPORT_BINDING.fileSha256]);
      });

      it('accepts a well-formed, exactly-bound export and reports the R1 census and the file SHA256', () => {
        const { path, binding } = writeExport(exportOf(r4Rows(), R3_SOURCE));
        const verified = readR4Export(path, binding);
        expect(verified.fileSha256).toBe(binding.fileSha256);
        expect(verified.census).toMatchObject({ rows: 802, providers: 802, stableIdentities: 802, countsByMethod: { ...R3_EXPECTED_COUNTS_BY_METHOD } });
        expect(verified.exported.rows).toHaveLength(802);
      });

      it('refuses a relative path and a missing file', () => {
        expect(() => readR4Export('recovery\\export.json')).toThrow(/is not an absolute path/);
        expect(() => readR4Export(join(dir, 'absent.json'))).toThrow(/does not exist or is not a file/);
        expect(() => readR4Export(dir)).toThrow(/does not exist or is not a file/);
      });

      it('(6) refuses any file whose SHA256 is not the bound R3 PASS file — including a valid export', () => {
        const { path } = writeExport(exportOf(r4Rows(), R3_SOURCE));
        expect(() => readR4Export(path)).toThrow(/export file SHA256 is [0-9A-F]{64}, expected the R3 PASS file 870EA366C63E9C6C434E8A41340B024A43BC80D413E41FF99B1D398836175D35/);
      });

      it('(7) refuses a wrong source dump SHA256 — on the command line and inside the export', () => {
        expect(() => normaliseR3SourceDumpSha256('c'.repeat(64))).toThrow(/not the R1-proven dump hash/);
        const { path, binding } = writeExport(exportOf(r4Rows(), { sourceDatabase: R3_SOURCE_DATABASE, sourceDumpSha256: 'C'.repeat(64) }));
        expect(() => readR4Export(path, binding)).toThrow(/sourceDumpSha256 is C{64}, expected the recorded R1 hash/);
      });

      it('(8) refuses a tampered payload (a row edited after hashing), a payload differing from the R3 PASS payload, and a foreign source database', () => {
        const good = exportOf(r4Rows(), R3_SOURCE);
        const tampered = { ...good, rows: good.rows.map((r, i) => (i === 400 ? { ...r, matchMethod: 'afl_api_stat_vector_season' as const } : r)) };
        const t = writeExport(tampered, 'tampered.json');
        expect(() => readR4Export(t.path, t.binding)).toThrow(/payloadSha256 does not match its own rows/);

        const g = writeExport(good, 'other-payload.json');
        expect(() => readR4Export(g.path, { ...g.binding, payloadSha256: R4_EXPORT_PAYLOAD_SHA256 }))
          .toThrow(/payloadSha256 is [0-9a-f]{64}, expected the R3 PASS payload 3cfad942/);

        const f = writeExport(exportOf(r4Rows(), { sourceDatabase: 'afldb_test', sourceDumpSha256: R3_SOURCE_DUMP_SHA256 }), 'foreign.json');
        expect(() => readR4Export(f.path, f.binding)).toThrow(/taken from 'afldb_test', not the R1-proven source 'issue237_r1_restore'/);
      });

      it('(9) refuses a row-count mismatch (801 and 803 rows)', () => {
        const rows = r4Rows();
        const extra: CapturedImporterRow = { ...rows[0], externalId: 'CD_I9990299999', playerIdentity: 'players/T/R4_Extra.html' };
        for (const [variant, n] of [[rows.slice(1), 801], [[...rows, extra], 803]] as const) {
          const { path, binding } = writeExport(exportOf(variant, R3_SOURCE), `count-${n}.json`);
          expect(() => readR4Export(path, binding)).toThrow(new RegExp(`holds ${n} row\\(s\\), expected exactly 802`));
        }
      });

      it('(10) refuses a method-census mismatch with the total still 802', () => {
        const rows = r4Rows();
        const shifted = rows.map((r) => (r.matchMethod === 'afl_api_manual_adjudication' && r === rows.find((x) => x.matchMethod === 'afl_api_manual_adjudication')
          ? { ...r, matchMethod: 'afl_api_name_team_season_bootstrap' as const } : r));
        const { path, binding } = writeExport(exportOf(shifted, R3_SOURCE));
        expect(() => readR4Export(path, binding)).toThrow(/R3\/R1\.4: method afl_api_manual_adjudication count is 2, expected exactly 3/);
      });

      it('(11) refuses a duplicate provider', () => {
        const rows = r4Rows();
        rows[1] = { ...rows[1], externalId: rows[0].externalId };
        const { path, binding } = writeExport(exportOf(rows, R3_SOURCE));
        expect(() => readR4Export(path, binding)).toThrow(/801 distinct provider\(s\).*duplicate provider/);
      });

      it('(12) refuses a duplicate stable identity', () => {
        const rows = r4Rows();
        rows[1] = { ...rows[1], playerIdentity: rows[0].playerIdentity };
        const { path, binding } = writeExport(exportOf(rows, R3_SOURCE));
        expect(() => readR4Export(path, binding)).toThrow(/801 distinct stable identit.*duplicate stable identity/);
      });

      it('refuses a malformed importer row the census does not see (candidate_count, external_url)', () => {
        for (const change of [{ candidateCount: 2 }, { externalUrl: 'https://example.invalid/p' }]) {
          const rows = r4Rows();
          rows[3] = { ...rows[3], ...change } as unknown as CapturedImporterRow;
          const { path, binding } = writeExport(exportOf(rows, R3_SOURCE));
          expect(() => readR4Export(path, binding)).toThrow(/malformed importer row/);
        }
      });
    });

    // -- (13)–(15) transaction semantics -------------------------------------------------------
    it('(13) validate-only — the real planner over all 802 rows in a READ ONLY transaction, no write, ROLLED BACK, and a fresh reader sees 0 importer rows', async () => {
      const rows = r4Rows();
      const state = emptyTarget(rows);
      const { promise, log, transactions } = run('validate-only', state, rows);
      const report = await promise;

      expect(log).toEqual([
        'CONNECT', 'BEGIN isolation level repeatable read read only', 'ROLLBACK', 'END',
        'CONNECT', 'BEGIN isolation level repeatable read read only', 'COMMIT', 'END',
      ]);
      expect(writes(transactions[0])).toEqual([]);
      // every stable identity was reverse-resolved live
      expect(transactions[0].statements.filter((s) => s.text.includes('DISTINCT ei.player_id'))).toHaveLength(802);
      expect(report.result).toMatchObject({
        mode: 'validate-only', wouldInsert: 802, alreadyIdentical: 0, inserted: 0, preExistingImporterRows: 0,
        projectedParity: 'PASS', writtenParity: 'NOT RUN', invariant: 'PASS', applied: false,
        countsByMethod: { ...R3_EXPECTED_COUNTS_BY_METHOD },
      });
      expect(report.transaction).toBe('ROLLED BACK');
      expect(report.freshReader).toMatchObject({ importerRows: 0, plannedProvidersPresent: 0 });
      expect(state.afl).toEqual([]);

      const printed = formatR4Report(report);
      for (const line of [
        'target database           : afldb_test', 'export rows               : 802', 'providers                 : 802',
        'stable identities         : 802', 'would insert              : 802', 'already identical         : 0',
        'conflicts                 : 0', 'manual_adjudication       : 3', 'name_team_season_bootstrap: 129',
        'stat_vector_bootstrap     : 397', 'stat_vector_season        : 273', 'transaction               : ROLLED BACK',
      ]) expect(printed).toContain(line);
      expect(printed).not.toContain('inserted');
      expect(printed.trim().endsWith('R4 validate-only: PASS')).toBe(true);
      expect(printed).not.toMatch(/postgres:|s3cret/);
    });

    it('(14) dry-run — the apply path (802 INSERTs, R5 on the written state, invariant) then an unconditional ROLLBACK; a fresh reader sees 0 importer rows', async () => {
      const rows = r4Rows();
      const state = emptyTarget(rows);
      const { promise, log, transactions } = run('dry-run', state, rows);
      const report = await promise;

      expect(log).toEqual([
        'CONNECT', 'BEGIN isolation level repeatable read', 'ROLLBACK', 'END',
        'CONNECT', 'BEGIN isolation level repeatable read read only', 'COMMIT', 'END',
      ]);
      expect(writes(transactions[0])).toHaveLength(802);
      expect(report.result).toMatchObject({ mode: 'dry-run', wouldInsert: 802, inserted: 802, writtenParity: 'PASS', applied: false });
      expect(report.transaction).toBe('ROLLED BACK');
      expect(report.freshReader).toMatchObject({ importerRows: 0, plannedProvidersPresent: 0 });
      expect(writes(transactions[1])).toEqual([]);
      expect(state.afl).toEqual([]);
      const printed = formatR4Report(report);
      expect(printed).toContain('inserted                  : 802');
      expect(printed).toContain('R5 parity                 : PASS');
      expect(printed.trim().endsWith('R4 dry-run: PASS')).toBe(true);
    });

    it('(15) apply — COMMIT only after the INSERTs, the R5 re-read and the invariants; the committed rows carry the RESOLVED player ids; a post-commit fresh reader re-proves R5 and the invariant', async () => {
      const rows = r4Rows();
      const state = emptyTarget(rows);
      const { promise, log, transactions } = run('apply', state, rows);
      const report = await promise;

      expect(log).toEqual([
        'CONNECT', 'BEGIN isolation level repeatable read', 'COMMIT', 'END',
        'CONNECT', 'BEGIN isolation level repeatable read read only', 'COMMIT', 'END',
      ]);
      const statements = transactions[0].statements;
      const lastInsert = statements.map((s) => s.text.includes('INSERT INTO external_identities')).lastIndexOf(true);
      const after = statements.slice(lastInsert + 1).map((s) => s.text);
      expect(after.some((t) => t.includes('"candidateCount"'))).toBe(true); // R5 re-read
      expect(after.some((t) => t.includes('FROM afl_api_identity_adjudications'))).toBe(true); // bijection + invariant
      expect(after.some((t) => t.includes('"sourceKey"'))).toBe(true); // invariant's D7 forward lookup

      expect(report.transaction).toBe('COMMITTED');
      expect(report.result).toMatchObject({ mode: 'apply', inserted: 802, alreadyIdentical: 0, writtenParity: 'PASS', applied: true });
      expect(report.freshReader).toEqual({ importerRows: 802, plannedProvidersPresent: 802, r5Parity: 'PASS', invariant: 'PASS' });
      expect(state.afl).toHaveLength(802);
      const target = new Map(state.paths.map((p) => [p.externalId, p.playerId]));
      for (const row of rows) {
        const written = state.afl.find((r) => r.externalId === row.externalId)!;
        expect(written).toEqual({
          externalId: row.externalId, status: 'unique', matchMethod: row.matchMethod, playerId: target.get(row.playerIdentity),
          candidateCount: 1, externalUrl: null, externalName: row.externalName, notes: row.notes,
        });
      }
      const printed = formatR4Report(report);
      for (const line of [
        'inserted                  : 802', 'already identical         : 0', 'R5 parity                 : PASS',
        'AFL API invariant         : PASS', 'transaction               : COMMITTED', 'post-commit R5 parity     : PASS',
      ]) expect(printed).toContain(line);
      expect(printed.trim().endsWith('R4 apply: PASS')).toBe(true);
    });

    // -- (16)–(20) STOPs roll back everything --------------------------------------------------
    it('(16) one unresolvable stable identity (of 802) refuses the WHOLE recovery in every mode: no INSERT, nothing left behind', async () => {
      for (const mode of ['validate-only', 'dry-run', 'apply'] as const) {
        const rows = r4Rows();
        const state = emptyTarget(rows);
        state.paths = state.paths.filter((p) => p.externalId !== rows[500].playerIdentity);
        const { promise, log, transactions } = run(mode, state, rows);
        await expect(promise, mode).rejects.toThrow(new RegExp(
          `stopped on 1 provider id\\(s\\), no row written: ${rows[500].externalId} \\(the captured row's player identity does not resolve to any candidate player\\)`));
        expect(writes(transactions[0]), mode).toEqual([]);
        expect(log, mode).not.toContain('COMMIT');
        expect(state.afl, mode).toEqual([]);
      }
    });

    it('(17) a SPLIT continuity target (the rule\'s two paths on different players) refuses all 802 rows in every mode', async () => {
      const rule = loadFitzroyProfileContinuityRules()[0];
      for (const mode of ['validate-only', 'dry-run', 'apply'] as const) {
        const rows = r4Rows();
        rows[10] = { ...rows[10], playerIdentity: rule.continuingUrl };
        const state = emptyTarget(rows);
        state.paths.push({ playerId: 90_001, externalId: rule.renumberedUrl, sourceKey: 'afltables' }); // a DIFFERENT player
        const { promise, log, transactions } = run(mode, state, rows);
        await expect(promise, mode).rejects.toThrow(/its continuing_url and renumbered_url resolve to different target players/);
        expect(writes(transactions[0]), mode).toEqual([]);
        expect(log, mode).not.toContain('COMMIT');
        expect(state.afl, mode).toEqual([]);
      }

      // the folded shape (both paths on ONE player) is the accepted real afldb_test state
      const rows = r4Rows();
      rows[10] = { ...rows[10], playerIdentity: rule.continuingUrl };
      const state = emptyTarget(rows);
      state.paths.push({ playerId: state.paths[10].playerId, externalId: rule.renumberedUrl, sourceKey: 'afltables' });
      const { promise } = run('apply', state, rows);
      await expect(promise).resolves.toMatchObject({ transaction: 'COMMITTED' });
    });

    it('(18) an existing IDENTICAL importer row is idempotent: classified already-identical, never re-inserted or updated, and parity still exact', async () => {
      const rows = r4Rows();
      const state = emptyTarget(rows);
      const existing = rows[42];
      state.afl.push({
        externalId: existing.externalId, status: 'unique', matchMethod: existing.matchMethod, playerId: state.paths[42].playerId,
        candidateCount: 1, externalUrl: null, externalName: existing.externalName, notes: existing.notes,
      });
      const validate = run('validate-only', structuredClone(state), rows);
      await expect(validate.promise).resolves.toMatchObject({ result: { wouldInsert: 801, alreadyIdentical: 1, preExistingImporterRows: 1 } });

      const { promise, transactions } = run('apply', state, rows);
      const report = await promise;
      expect(report.result).toMatchObject({ wouldInsert: 801, alreadyIdentical: 1, inserted: 801, preExistingImporterRows: 1 });
      expect(writes(transactions[0])).toHaveLength(801);
      expect(writes(transactions[0]).some((s) => s.text.includes('UPDATE'))).toBe(false);
      expect(state.afl).toHaveLength(802);
      expect(formatR4Report(report)).toContain('already identical         : 1');
    });

    it('(19) an existing NON-identical importer row (same provider, different method / name / player) is a hard STOP, never an UPDATE', async () => {
      const variants: Array<(row: CapturedImporterRow, playerId: number) => FakeAflRow> = [
        (r, p) => ({ externalId: r.externalId, status: 'unique', matchMethod: 'afl_api_stat_vector_season', playerId: p, candidateCount: 1, externalUrl: null, externalName: r.externalName, notes: r.notes }),
        (r, p) => ({ externalId: r.externalId, status: 'unique', matchMethod: r.matchMethod, playerId: p, candidateCount: 1, externalUrl: null, externalName: 'Different Name', notes: r.notes }),
        (r) => ({ externalId: r.externalId, status: 'unique', matchMethod: r.matchMethod, playerId: 50_000 + 7, candidateCount: 1, externalUrl: null, externalName: r.externalName, notes: r.notes }),
      ];
      for (const variant of variants) {
        const rows = r4Rows();
        const state = emptyTarget(rows);
        state.afl.push(variant(rows[3], state.paths[3].playerId));
        const { promise, log, transactions } = run('apply', state, rows);
        await expect(promise).rejects.toThrow(/importer row/);
        expect(writes(transactions[0])).toEqual([]);
        expect(log).not.toContain('COMMIT');
        expect(state.afl).toHaveLength(1);
      }
    });

    it('(20) a human resolved row on an export provider, or on the target player an export row needs, is a STOP: the human row is never overwritten or superseded', async () => {
      const human = (externalId: string, playerId: number): FakeAflRow => ({
        externalId, status: 'resolved', matchMethod: AFL_API_ADMIN_MATCH_METHOD, playerId, candidateCount: 0,
        externalUrl: null, externalName: null, notes: 'AFLDB-ISSUE-235 admin adjudication; see afl_api_identity_adjudications',
      });
      const ledgerFor = (externalId: string, playerId: number, playerIdentity: string): FakeDbState['ledger'][number] => ({
        id: 1, externalId, action: 'linked', playerId, playerIdentity, supersedesId: null,
      });

      // (a) same provider
      {
        const rows = r4Rows();
        const state = emptyTarget(rows);
        state.afl.push(human(rows[7].externalId, state.paths[7].playerId));
        state.ledger.push(ledgerFor(rows[7].externalId, state.paths[7].playerId, rows[7].playerIdentity));
        const { promise, log, transactions } = run('apply', state, rows);
        await expect(promise).rejects.toThrow(new RegExp(`${rows[7].externalId} \\(a human resolved row already exists for this provider id`));
        expect(writes(transactions[0])).toEqual([]);
        expect(log).not.toContain('COMMIT');
        expect(state.afl).toEqual([human(rows[7].externalId, state.paths[7].playerId)]);
      }
      // (b) same target player, a different provider
      {
        const rows = r4Rows();
        const state = emptyTarget(rows);
        state.afl.push(human('CD_HUMAN_1', state.paths[9].playerId));
        state.ledger.push(ledgerFor('CD_HUMAN_1', state.paths[9].playerId, rows[9].playerIdentity));
        const { promise, transactions } = run('validate-only', state, rows);
        await expect(promise).rejects.toThrow(new RegExp(`player ${state.paths[9].playerId} already holds a different afl_api provider \\(CD_HUMAN_1\\)`));
        expect(writes(transactions[0])).toEqual([]);
      }
    });

    it('two export rows reverse-resolving to ONE target player are a per-player collision STOP already in validate-only', async () => {
      const rows = r4Rows();
      const state = emptyTarget(rows);
      state.paths[20] = { ...state.paths[20], playerId: state.paths[21].playerId };
      const { promise, transactions } = run('validate-only', state, rows);
      await expect(promise).rejects.toThrow(new RegExp(
        `1 target player\\(s\\) would receive more than one afl_api provider, no row written: player ${state.paths[21].playerId} <- `));
      expect(writes(transactions[0])).toEqual([]);
    });

    // -- (21)(22) post-write checks roll back apply -------------------------------------------
    it('(21) an R5 parity mismatch on the written state rolls back ALL 802 apply writes', async () => {
      const rows = r4Rows();
      const state = emptyTarget(rows);
      const { promise, log, transactions } = run('apply', state, rows, {
        afterInsert: (s, n) => { if (n === 802) s.afl[100] = { ...s.afl[100], notes: 'drifted' }; },
      });
      await expect(promise).rejects.toThrow(/R5 \(after the recovery write\): exact parity failed \(1 problem\(s\)\).*"field":"notes"/);
      expect(writes(transactions[0])).toHaveLength(802);
      expect(log).toEqual(['CONNECT', 'BEGIN isolation level repeatable read', 'ROLLBACK', 'END']);
      expect(state.afl).toEqual([]);
    });

    it('(22) a combined-invariant failure after the write rolls back ALL 802 apply writes', async () => {
      const rows = r4Rows();
      const state = emptyTarget(rows);
      const { promise, log } = run('apply', state, rows, {
        afterInsert: (s, n) => {
          if (n === 802) {
            s.afl.push({ externalId: 'CD_ANOMALY', status: 'unique', matchMethod: null, playerId: 1, candidateCount: 1, externalUrl: null, externalName: null, notes: null });
          }
        },
      });
      await expect(promise).rejects.toThrow(/afl_api identity invariant failed .*census_anomaly/);
      expect(log).toEqual(['CONNECT', 'BEGIN isolation level repeatable read', 'ROLLBACK', 'END']);
      expect(state.afl).toEqual([]);
    });

    it('a pre-write invariant failure refuses before planning; a post-commit re-read failure is reported as COMMITTED, never as rolled back', async () => {
      const rows = r4Rows();
      const pre = emptyTarget(rows);
      pre.afl.push(human0());
      const refused = run('validate-only', pre, rows);
      await expect(refused.promise).rejects.toThrow(/adjudication bijection check failed .*row_without_ledger:CD_HUMAN_0/);
      expect(refused.transactions[0].statements.some((s) => s.text.includes('DISTINCT ei.player_id'))).toBe(false);

      const state = emptyTarget(rows);
      const { promise, log } = run('apply', state, rows, {
        afterCommit: (s) => { s.afl = s.afl.slice(1); }, // a concurrent writer between COMMIT and the re-read
      });
      const failure = await promise.catch((e) => e);
      expect(failure).toBeInstanceOf(R4PostCommitFailure);
      expect((failure as Error).message).toMatch(/transaction COMMITTED, but the post-commit fresh read-only re-read FAILED: R5 \(post-commit fresh reader\)/);
      expect(log.slice(0, 3)).toEqual(['CONNECT', 'BEGIN isolation level repeatable read', 'COMMIT']);

      function human0(): FakeAflRow {
        return {
          externalId: 'CD_HUMAN_0', status: 'resolved', matchMethod: AFL_API_ADMIN_MATCH_METHOD, playerId: 123, candidateCount: 0,
          externalUrl: null, externalName: null, notes: null,
        };
      }
    });
  });

  it('AflApiRecoveryAbort is exported and distinct from AflApiReplayAbort', () => {
    expect(new AflApiRecoveryAbort('x')).toBeInstanceOf(Error);
    expect(new AflApiRecoveryAbort('x')).not.toBeInstanceOf(AflApiReplayAbort);
  });

  /*
   * §11a R3 operator CLI (`npm run db:issue237:export-importer-recovery`), DB-free. The CLI
   * adds no identity logic; these prove its source/session/path/count binding around the
   * library export, and that no file is left behind on any refusal.
   */
  describe('R3 export CLI (source binding, R1 counts, atomic output)', () => {
    const LIVE_OK = {
      database: R3_SOURCE_DATABASE, transactionReadOnly: 'on', defaultReadOnly: 'on', isolation: 'repeatable read',
    };
    const METHODS = Object.keys(R3_EXPECTED_COUNTS_BY_METHOD).sort();

    /** Census + forward-identity rows for the given per-method counts (default: exactly R1's). */
    function r3Source(counts: Record<string, number> = { ...R3_EXPECTED_COUNTS_BY_METHOD }) {
      const census: Array<Record<string, unknown>> = [];
      const identities: Array<{ playerId: number; externalId: string; sourceKey: string }> = [];
      let i = 0;
      for (const method of Object.keys(counts).sort()) {
        for (let k = 0; k < counts[method]; k += 1) {
          i += 1;
          census.push({
            externalId: `CD_I${9990100000 + i}`, status: 'unique', matchMethod: method,
            playerId: i, candidateCount: 1, externalUrl: null,
          });
          identities.push({ playerId: i, externalId: `players/T/R3_Test_${i}.html`, sourceKey: 'afltables' });
        }
      }
      return { census, identities };
    }

    function r3Tx(opts: {
      proof?: Partial<typeof LIVE_OK>;
      census?: Array<Record<string, unknown>>;
      identities?: Array<{ playerId: number; externalId: string; sourceKey: string }>;
    } = {}) {
      const base = r3Source();
      return fakeRecoveryTx([
        { includes: ["current_setting('transaction_read_only')"], respond: () => [{ ...LIVE_OK, ...opts.proof }] },
        SOURCE_ID_RULE,
        { includes: ['"candidateCount"'], respond: () => opts.census ?? base.census },
        { includes: ['"sourceKey"'], respond: () => opts.identities ?? base.identities },
        EMPTY_NAMES_RULE,
      ]);
    }

    /** 802 captured rows with R1's exact method split, for the pure binding checks. */
    function r3Rows(): CapturedImporterRow[] {
      const { census, identities } = r3Source();
      return census.map((c, idx) => ({
        externalId: c.externalId as string, playerIdentity: identities[idx].externalId,
        matchMethod: c.matchMethod as CapturedImporterRow['matchMethod'], status: 'unique', candidateCount: 1,
        externalName: null, externalUrl: null, notes: null, playerId: c.playerId as number,
      }));
    }
    const countsOf = (rows: readonly CapturedImporterRow[]) => {
      const counts: Record<string, number> = {};
      for (const r of rows) counts[r.matchMethod] = (counts[r.matchMethod] ?? 0) + 1;
      return counts;
    };

    let outDir: string;
    beforeEach(() => { outDir = mkdtempSync(join(tmpdir(), 'afldb-i237-r3-')); });
    afterEach(() => { rmSync(outDir, { recursive: true, force: true }); });

    const run = (tx: TransactionSql, overrides: Partial<{ sourceDatabase: string; output: string }> = {}) =>
      executeR3Export(tx, {
        sourceDatabase: R3_SOURCE_DATABASE, sourceDumpSha256: R3_SOURCE_DUMP_SHA256,
        output: join(outDir, 'export.json'), ...overrides,
      });
    const expectNoFile = () => expect(readdirSync(outDir)).toEqual([]);

    it('argv — export only, each of the three flags exactly once, no unknown flag', () => {
      const good = ['export', '--source-database', R3_SOURCE_DATABASE, '--source-dump-sha256', R3_SOURCE_DUMP_SHA256, '--output', 'D:\\x\\e.json'];
      expect(parseR3ExportArgs(good)).toEqual({ sourceDatabase: R3_SOURCE_DATABASE, sourceDumpSha256: R3_SOURCE_DUMP_SHA256, output: 'D:\\x\\e.json' });
      expect(() => parseR3ExportArgs(['apply', ...good.slice(1)])).toThrow(/only supported command is 'export'/);
      expect(() => parseR3ExportArgs([...good, '--dsn', 'postgres://x'])).toThrow(/unknown argument/);
      expect(() => parseR3ExportArgs([...good, '--output', 'D:\\y.json'])).toThrow(/more than once/);
      expect(() => parseR3ExportArgs(good.slice(0, 5))).toThrow(/--output is required/);
      expect(() => parseR3ExportArgs(['export', '--source-database', '--output', 'D:\\x.json'])).toThrow(/needs a value/);
    });

    it('source DSN — missing variable refused; only the dedicated variable is read; a forbidden or different database named by the DSN is refused', () => {
      expect(R3_SOURCE_DSN_ENV).toBe('AFLDB_ISSUE237_R1_DATABASE_URL');
      expect(() => resolveR3SourceDsn({}, R3_SOURCE_DATABASE)).toThrow(/AFLDB_ISSUE237_R1_DATABASE_URL is not set/);
      expect(() => resolveR3SourceDsn({ AFLDB_TEST_DATABASE_URL: 'postgres://u:p@h:1/issue237_r1_restore' }, R3_SOURCE_DATABASE))
        .toThrow(/is not set/);
      expect(() => resolveR3SourceDsn({ [R3_SOURCE_DSN_ENV]: 'not a url' }, R3_SOURCE_DATABASE)).toThrow(/not a valid connection URL/);
      expect(() => resolveR3SourceDsn({ [R3_SOURCE_DSN_ENV]: 'postgres://u:secret@h:1/afldb_test' }, R3_SOURCE_DATABASE))
        .toThrow(/'afldb_test' is refused by name/);
      expect(() => resolveR3SourceDsn({ [R3_SOURCE_DSN_ENV]: 'postgres://u:secret@h:1/other_restore' }, R3_SOURCE_DATABASE))
        .toThrow(/only R1-proven source is 'issue237_r1_restore'/);
      expect(resolveR3SourceDsn({ [R3_SOURCE_DSN_ENV]: 'postgres://u:secret@h:1/issue237_r1_restore' }, R3_SOURCE_DATABASE))
        .toBe('postgres://u:secret@h:1/issue237_r1_restore');
      // no refusal message ever carries the credential
      try { resolveR3SourceDsn({ [R3_SOURCE_DSN_ENV]: 'postgres://u:secret@h:1/afldb_dev' }, R3_SOURCE_DATABASE); } catch (e) {
        expect((e as Error).message).not.toContain('secret');
      }
    });

    it('forbidden source names — afldb_test, code_test_db, afldb_dev, afldb, and anything production-looking', () => {
      for (const name of ['afldb_test', 'code_test_db', 'afldb_dev', 'afldb', 'afldb_prod', 'afldb_production_copy', 'PROD_restore']) {
        expect(() => assertR3SourceDatabaseName(name, '--source-database')).toThrow(/refused by name/);
      }
      expect(() => assertR3SourceDatabaseName(R3_SOURCE_DATABASE, '--source-database')).not.toThrow();
    });

    it('live session — a forbidden live database, a live database differing from --source-database, a writable transaction, a writable default and a non-repeatable-read snapshot are each refused before any importer identity is read, with no file', async () => {
      const cases: Array<[Parameters<typeof r3Tx>[0], Partial<{ sourceDatabase: string }>, RegExp]> = [
        [{ proof: { database: 'afldb_test' } }, {}, /live current_database\(\) 'afldb_test' is refused by name/],
        [{ proof: { database: 'issue237_r1_restore_b' } }, {}, /only R1-proven source is 'issue237_r1_restore'/],
        [{}, { sourceDatabase: 'issue237_r1_restore_b' }, /live current_database\(\) is 'issue237_r1_restore', not --source-database 'issue237_r1_restore_b'/],
        [{ proof: { transactionReadOnly: 'off' } }, {}, /transaction_read_only is 'off'.*writable transaction/],
        [{ proof: { defaultReadOnly: 'off' } }, {}, /default_transaction_read_only is 'off'/],
        [{ proof: { isolation: 'read committed' } }, {}, /transaction_isolation is 'read committed'/],
      ];
      for (const [txOpts, overrides, message] of cases) {
        const { tx, statements } = r3Tx(txOpts);
        await expect(run(tx, overrides)).rejects.toThrow(message);
        expect(statements).toHaveLength(1); // only the live proof ran
        expectNoFile();
      }
    });

    it('dump SHA256 — exactly 64 hex characters and equal to the R1-proven hash; returned in R1\'s upper case', () => {
      for (const bad of [R3_SOURCE_DUMP_SHA256.slice(1), `${R3_SOURCE_DUMP_SHA256}0`, `G${R3_SOURCE_DUMP_SHA256.slice(1)}`, '', ` ${R3_SOURCE_DUMP_SHA256}`]) {
        expect(() => normaliseR3SourceDumpSha256(bad)).toThrow(/exactly 64 hexadecimal characters/);
      }
      expect(() => normaliseR3SourceDumpSha256('c'.repeat(64))).toThrow(/not the R1-proven dump hash/);
      expect(normaliseR3SourceDumpSha256(R3_SOURCE_DUMP_SHA256.toLowerCase())).toBe(R3_SOURCE_DUMP_SHA256);
    });

    it('R1 row count — 801 and 803 importer rows are each refused, with no file', async () => {
      for (const [delta, n] of [[-1, 801], [1, 803]] as const) {
        const counts = { ...R3_EXPECTED_COUNTS_BY_METHOD, afl_api_stat_vector_season: 273 + delta };
        const { census, identities } = r3Source(counts);
        const { tx } = r3Tx({ census, identities });
        await expect(run(tx)).rejects.toThrow(new RegExp(`holds ${n} row\\(s\\), expected exactly 802`));
        expectNoFile();
      }
    });

    it('R1 distinctness — a duplicate provider and a duplicate stable identity are each refused', async () => {
      const dupProvider = r3Rows();
      dupProvider[1] = { ...dupProvider[1], externalId: dupProvider[0].externalId };
      expect(() => assertR3ExportBinding({ rows: dupProvider, countsByMethod: countsOf(dupProvider) }))
        .toThrow(/801 distinct provider\(s\).*duplicate provider/);

      const dupIdentity = r3Rows();
      dupIdentity[1] = { ...dupIdentity[1], playerIdentity: dupIdentity[0].playerIdentity };
      expect(() => assertR3ExportBinding({ rows: dupIdentity, countsByMethod: countsOf(dupIdentity) }))
        .toThrow(/801 distinct stable identit.*duplicate stable identity/);

      // end to end: two source players forward-resolving to ONE stable identity -- the library
      // exports both rows (the lookup is per player); the R1 binding refuses, and nothing is written.
      const { census, identities } = r3Source();
      identities[1] = { ...identities[1], externalId: identities[0].externalId };
      const { tx } = r3Tx({ census, identities });
      await expect(run(tx)).rejects.toThrow(/duplicate stable identity/);
      expectNoFile();
    });

    it('R1 method census — every individual method-count mismatch (total still 802) is refused, as is an unexpected method or a countsByMethod disagreeing with the rows', async () => {
      for (const [idx, method] of METHODS.entries()) {
        const other = METHODS[(idx + 1) % METHODS.length];
        const counts = { ...R3_EXPECTED_COUNTS_BY_METHOD, [method]: R3_EXPECTED_COUNTS_BY_METHOD[method] - 1, [other]: R3_EXPECTED_COUNTS_BY_METHOD[other] + 1 };
        const { census, identities } = r3Source(counts);
        const { tx } = r3Tx({ census, identities });
        const refusal = run(tx);
        await expect(refusal).rejects.toThrow(/R3\/R1\.4: method .* count is .*, expected exactly/);
        await expect(refusal).rejects.toThrow(new RegExp(`method (${method}|${other}) count`));
        expectNoFile();
      }

      const rows = r3Rows();
      expect(() => assertR3ExportBinding({ rows, countsByMethod: { ...countsOf(rows), afl_api_manual_adjudication: 4 } }))
        .toThrow(/countsByMethod\.afl_api_manual_adjudication is 4/);
      expect(() => assertR3ExportBinding({ rows, countsByMethod: { ...countsOf(rows), afl_api_other: 0 } }))
        .toThrow(/names a method outside the R1 census/);
      const foreign = r3Rows();
      foreign[0] = { ...foreign[0], matchMethod: 'afl_api_other' as CapturedImporterRow['matchMethod'] };
      expect(() => assertR3ExportBinding({ rows: foreign, countsByMethod: countsOf(foreign) })).toThrow(/R1\.4: method/);
      expect(assertR3ExportBinding({ rows, countsByMethod: countsOf(rows) }).countsByMethod).toEqual(R3_EXPECTED_COUNTS_BY_METHOD);
    });

    it('OD-1 still refuses through the library — an unresolved and an ambiguous forward identity each refuse the WHOLE export, with no file', async () => {
      const { census, identities } = r3Source();
      const unresolved = identities.filter((r) => r.playerId !== 1);
      const ambiguous = [...identities, { playerId: 1, externalId: 'players/T/R3_Other.html', sourceKey: 'afltables' }];
      for (const ids of [unresolved, ambiguous]) {
        const { tx } = r3Tx({ census, identities: ids });
        await expect(run(tx)).rejects.toThrow(/R3\/OD-1: 1 importer row\(s\) do not resolve to exactly one accepted stable identity -- refusing the WHOLE export/);
        expectNoFile();
      }
    });

    it('continuity amendment — a folded player (exact tracked pair) exports its continuing path and the '
       + 'export passes; the same player with a non-exact pair still refuses the WHOLE export', async () => {
      const rule = loadFitzroyProfileContinuityRules()[0];
      const { census, identities } = r3Source();
      const others = identities.filter((r) => r.playerId !== 1);
      const folded = [
        ...others,
        { playerId: 1, externalId: rule.renumberedUrl, sourceKey: 'afltables' },
        { playerId: 1, externalId: rule.continuingUrl, sourceKey: 'afltables' },
      ];
      const output = join(outDir, 'folded.json');
      const report = await run(r3Tx({ census, identities: folded }).tx, { output });
      expect(report.census.rows).toBe(802);
      expect(report.census.stableIdentities).toBe(802);
      const parsed = parseAflApiImporterRecoveryExport(JSON.parse(readFileSync(output, 'utf8')), { sourceDumpSha256: R3_SOURCE_DUMP_SHA256 });
      const row = parsed.rows.find((r) => r.playerId === 1)!;
      expect(row.playerIdentity).toBe(rule.continuingUrl);
      expect(parsed.rows.some((r) => r.playerIdentity === rule.renumberedUrl)).toBe(false);
      rmSync(output);

      const nonExact = [...others,
        { playerId: 1, externalId: rule.continuingUrl, sourceKey: 'afltables' },
        { playerId: 1, externalId: 'players/Z/Unrelated_Profile.html', sourceKey: 'afltables' }];
      await expect(run(r3Tx({ census, identities: nonExact }).tx)).rejects.toThrow(/R3\/OD-1: 1 importer row\(s\)/);
      expectNoFile();
    });

    it('output path — relative, non-.json, existing, inside this checkout and inside any Git checkout are refused; a fresh absolute path outside is accepted', () => {
      expect(() => resolveR3OutputPath('recovery/export.json', [process.cwd()])).toThrow(/not an absolute path/);
      expect(() => resolveR3OutputPath(join(outDir, 'export.txt'), [process.cwd()])).toThrow(/must end in \.json/);
      writeFileSync(join(outDir, 'existing.json'), '{}');
      expect(() => resolveR3OutputPath(join(outDir, 'existing.json'), [process.cwd()])).toThrow(/already exists; an export is never overwritten/);
      expect(() => resolveR3OutputPath(join(process.cwd(), 'tmp-r3', 'export.json'), [process.cwd()])).toThrow(/is inside the checkout/);
      // any Git checkout, not only this one: a `.git` entry on any ancestor refuses
      mkdirSync(join(outDir, 'other-checkout', '.git'), { recursive: true });
      expect(() => resolveR3OutputPath(join(outDir, 'other-checkout', 'deep', 'export.json'), [process.cwd()]))
        .toThrow(/resolves inside the Git checkout/);
      const fresh = join(outDir, 'issue-237-recovery', 'afl-api-importer-identities.json');
      expect(resolveR3OutputPath(fresh, [process.cwd()])).toBe(fresh);
      expect(existsSync(join(outDir, 'issue-237-recovery'))).toBe(false); // validation creates nothing
    });

    it('success — read-only statements only, atomic write into a created parent, read-back through the parser, exact R1 census, file SHA256 of the bytes on disk, no temp file left', async () => {
      const { tx, statements } = r3Tx();
      const output = join(outDir, 'issue-237-recovery', 'afl-api-importer-identities.json');
      const report = await run(tx, { output });

      expect(statements[0].text).toContain("current_setting('transaction_read_only')"); // proof first
      expect(statements.some((s) => /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(s.text))).toBe(false);
      expect(readdirSync(join(outDir, 'issue-237-recovery'))).toEqual(['afl-api-importer-identities.json']);

      const bytes = readFileSync(output);
      expect(report.fileSha256).toBe(createHash('sha256').update(bytes).digest('hex').toUpperCase());
      const parsed = parseAflApiImporterRecoveryExport(JSON.parse(bytes.toString('utf8')), { sourceDumpSha256: R3_SOURCE_DUMP_SHA256 });
      expect(parsed.sourceDatabase).toBe(R3_SOURCE_DATABASE);
      expect(parsed.sourceDumpSha256).toBe(R3_SOURCE_DUMP_SHA256);
      expect(parsed.payloadSha256).toBe(report.payloadSha256);
      expect(parsed.countsByMethod).toEqual(R3_EXPECTED_COUNTS_BY_METHOD);
      expect(parsed.rows.every((r) => r.playerIdentity.startsWith('players/') && r.externalId.startsWith('CD_I'))).toBe(true);
      expect(report.census).toEqual({
        rows: 802, providers: 802, stableIdentities: 802,
        countsByMethod: { ...R3_EXPECTED_COUNTS_BY_METHOD }, identityKinds: { afltables_profile_path: 802 },
      });

      const printed = formatR3ExportReport(report);
      expect(printed).toContain('transaction read-only : on');
      expect(printed).toContain('default read-only     : on');
      expect(printed).toContain('afl_api_name_team_season_bootstrap : 129');
      expect(printed).toContain(`file sha256           : ${report.fileSha256}`);
      expect(printed.trim().endsWith('R3 export: PASS')).toBe(true);
    });

    it('never overwrites — an export appearing at the path before the write is refused, left byte-identical, with no temp file', async () => {
      const output = join(outDir, 'export.json');
      writeFileSync(output, 'prior export');
      const { tx } = r3Tx();
      await expect(run(tx, { output })).rejects.toThrow(/appeared during the write; an export is never overwritten/);
      expect(readFileSync(output, 'utf8')).toBe('prior export');
      expect(readdirSync(outDir)).toEqual(['export.json']);
    });
  });
});

/*
 * AFLDB-ISSUE-237 L2 — the deterministic rehearsal halt. `--rehearsal-stop-after recreate` is
 * the ONLY supported way to leave a code_test_db rebuild in the "marker committed, pending
 * capture durable, database reset" state P-M point 3 must observe. It replaces an
 * operator-timed Ctrl+C.
 */
describe('AFLDB-ISSUE-237 L2 — deterministic rehearsal halt (--rehearsal-stop-after recreate)', () => {
  const CODE_OWNER = 'postgres://afldb_owner:pw@localhost:5432/code_test_db';
  const CODE_IMPORT = 'postgres://afldb_import:pw@localhost:5432/code_test_db';
  const codeTarget = () => target({ database: 'code_test_db', adminDsn: CODE_OWNER, importDsn: CODE_IMPORT });
  const codeOpts = { ...OPTS, target: 'code_test_db' };
  const haltOpts = { ...codeOpts, rehearsalStopAfter: 'recreate' as const };
  const HALT = { rehearsalStopAfter: 'recreate' as const };
  const toolSource = readFileSync(join(root, 'tools', 'migration', 'rebuild_afl_api_adjudications.ts'), 'utf8');
  const mainSource = runnerSource.slice(runnerSource.indexOf('async function main(): Promise<number>'));

  /** Deps that record every stage action, of every kind, in ONE ordered list. */
  function orderedDeps(failAt?: 'capture' | 'recreate') {
    const events: string[] = [];
    const commands: string[][] = [];
    const deps: Deps = {
      runCommand: (argv): RunResult => {
        commands.push(argv);
        const joined = argv.join(' ');
        events.push(`command:${joined}`);
        return { status: failAt === 'capture' && joined.includes(`${AFL_API_ADJUDICATION_TOOL} capture`) ? 1 : 0, stdout: '', stderr: '' };
      },
      runSql: (_dsn, sql) => {
        events.push(sql === RESET_SQL ? 'sql:RESET_SQL' : 'sql:OTHER');
        if (failAt === 'recreate') throw new Error('reset failed');
      },
      runValidation: () => { events.push('validation'); },
      fileExists: () => true,
      log: () => {},
    };
    return { deps, events, commands };
  }

  function refusal(fn: () => unknown): string {
    try {
      fn();
    } catch (error) {
      expect(error).toBeInstanceOf(RebuildRefused);
      return (error as Error).message;
    }
    throw new Error('expected a RebuildRefused');
  }

  it('the CLI parser accepts exactly `recreate` and never an arbitrary stage name', () => {
    expect(REHEARSAL_STOP_BOUNDARIES).toEqual(['recreate']);
    expect(parseRebuildArgs(['--target', 'code_test_db', '--rehearsal-stop-after', 'recreate']).rehearsalStopAfter)
      .toBe('recreate');
    expect(parseRebuildArgs(['--target', 'code_test_db']).rehearsalStopAfter).toBeUndefined();

    const everyOtherStage = idsOf(planStages(codeTarget(), fitzroy(), codeOpts)).filter((id) => id !== 'recreate');
    expect(everyOtherStage.length).toBeGreaterThan(15);
    for (const value of [...everyOtherStage, 'RECREATE', 'recreate ', ' recreate', 'reset', 'all', '', '--plan', '*']) {
      expect(refusal(() => parseRebuildArgs(['--rehearsal-stop-after', value])), value)
        .toMatch(/accepts exactly 'recreate'/);
    }
    // a bare flag, the = spelling, and a repeat are refused too
    expect(refusal(() => parseRebuildArgs(['--rehearsal-stop-after']))).toMatch(/accepts exactly 'recreate'/);
    expect(refusal(() => parseRebuildArgs(['--rehearsal-stop-after=recreate']))).toMatch(/Unknown argument/);
    expect(refusal(() => parseRebuildArgs(['--rehearsal-stop-after', 'recreate', '--rehearsal-stop-after', 'recreate'])))
      .toMatch(/only once/);
  });

  it('is refused for afldb_test, whether named explicitly or reached by default', () => {
    expect(refusal(() => assertRehearsalStop({ rehearsalStopAfter: 'recreate' })))
      .toMatch(/valid only with an explicit --target code_test_db; refusing it for 'afldb_test' \(the default target\)/);
    expect(refusal(() => assertRehearsalStop({ target: 'afldb_test', rehearsalStopAfter: 'recreate' })))
      .toMatch(/refusing it for 'afldb_test'/);
    // and at execution time, before ANY stage: nothing captured, nothing reset
    const { deps, events } = orderedDeps();
    expect(refusal(() => executeRebuild(planStages(target(), fitzroy(), OPTS), target(), deps, HALT)))
      .toMatch(/refusing it for 'afldb_test'/);
    expect(events).toEqual([]);
  });

  it('is refused for every target other than code_test_db, by name and by resolved database', () => {
    for (const name of ['afldb_dev', 'afldb_prod', 'afldb', 'prod', 'afldb_production', 'afldb_test_pre_rebuild',
      'random_test', 'code_test_db_copy', 'CODE_TEST_DB', 'code_test']) {
      expect(refusal(() => assertRehearsalStop({ target: name, rehearsalStopAfter: 'recreate' })), name)
        .toMatch(/valid only with an explicit --target code_test_db/);
    }
    // the name says code_test_db but the resolved database does not
    expect(refusal(() => assertRehearsalStop({ target: 'code_test_db', rehearsalStopAfter: 'recreate' }, 'afldb_test')))
      .toMatch(/resolved to database 'afldb_test'/);
    expect(() => assertRehearsalStop({ target: 'code_test_db', rehearsalStopAfter: 'recreate' }, 'code_test_db')).not.toThrow();
    // the main() order: the name check runs before resolveTarget() reads any DSN, then again after
    const nameCheck = mainSource.indexOf('assertRehearsalStop(opts);');
    const resolve = mainSource.indexOf('resolveTarget(process.env, opts)');
    const dbCheck = mainSource.indexOf('assertRehearsalStop(opts, target.database);');
    expect(nameCheck).toBeGreaterThan(-1);
    expect(nameCheck).toBeLessThan(resolve);
    expect(resolve).toBeLessThan(dbCheck);
  });

  it('cannot be combined with --recover-afl-api-adjudications', () => {
    expect(refusal(() => assertRehearsalStop({ ...haltOpts, recoverAflApiAdjudications: true })))
      .toMatch(/cannot be combined with --recover-afl-api-adjudications/);
  });

  it('keeps the destructive acknowledgement and the capture root: both run, unconditionally, before execution', () => {
    // no branch of main() skips either when the flag is present
    const preflight = mainSource.indexOf('\n  runPreflight(deps, opts, fitzroy);');
    const ack = mainSource.indexOf('\n  assertDestructiveAcknowledgement(target, opts.acknowledgeDestroy);');
    const execute = mainSource.indexOf('executeRebuild(stages, target, deps, { rehearsalStopAfter: opts.rehearsalStopAfter })');
    expect(preflight).toBeGreaterThan(-1);
    expect(preflight).toBeLessThan(ack);
    expect(ack).toBeLessThan(execute);
    expect(refusal(() => assertDestructiveAcknowledgement(codeTarget(), undefined))).toMatch(/--acknowledge-destroy code_test_db/);
    // the precheck's capture-root resolution is the first thing runPreflight does
    const preflightFn = runnerSource.slice(runnerSource.indexOf('export function runPreflight('));
    expect(preflightFn.indexOf('resolveCaptureRoot(process.env, REPO_ROOT);'))
      .toBeLessThan(preflightFn.indexOf('const python = resolvePython();'));
  });

  it('runs Stage 1, then Stage 2 (capture), then the real recreate — and stops there', () => {
    const stages = planStages(codeTarget(), fitzroy(), haltOpts);
    const { deps, events, commands } = orderedDeps();
    const report = executeRebuild(stages, codeTarget(), deps, HALT);

    expect(report).toEqual({
      executed: ['precheck', 'afl-api-adjudications-capture', 'recreate'],
      rehearsalHalt: 'recreate',
      ok: false,
    });
    expect(report.failedStage).toBeUndefined();
    // Stage 2 is the normal capture (no --recover), then the reset is the exact RESET_SQL constant
    expect(events).toEqual([`command:${aflApiAdjudicationArgv('capture').join(' ')}`, 'sql:RESET_SQL']);
    expect(commands).toEqual([['npx', 'tsx', AFL_API_ADJUDICATION_TOOL, 'capture']]);
  });

  it('never runs migrations or any later stage, so Stage 18 can neither clear the marker nor archive the capture', () => {
    const stages = planStages(codeTarget(), fitzroy(), haltOpts);
    const { deps, events } = orderedDeps();
    const report = executeRebuild(stages, codeTarget(), deps, HALT);
    const notRun = idsOf(stages).filter((id) => !report.executed.includes(id));
    expect(notRun[0]).toBe('migrations');
    for (const id of ['migrations', 'privileges', 'reference', 'fitzroy', 'draftguru',
      'afl-api-adjudications-reinstate', 'afl-api-adjudications-bijection']) {
      expect(notRun, id).toContain(id);
    }
    expect(notRun).toHaveLength(stages.length - 3);
    expect(events.some((e) => /db:migrate|db:privileges/.test(e))).toBe(false);
    expect(events.some((e) => e.includes(`${AFL_API_ADJUDICATION_TOOL} reinstate`))).toBe(false);
    expect(events.some((e) => e.includes(`${AFL_API_ADJUDICATION_TOOL} bijection`))).toBe(false);
    expect(events).not.toContain('validation');

    // Where the marker is cleared and the capture archived: only the reinstate step (Stage 18)
    // and the capture step's verify-reinstated branch — never the capture-live path Stage 2
    // takes on a fresh run, and never anything the halt could reach.
    const archiveCalls = [...toolSource.matchAll(/archivePendingCapture\(dir, /g)].length;
    expect(archiveCalls).toBe(2);
    const settle = toolSource.slice(toolSource.indexOf('export function settleCapture('), toolSource.indexOf('// Reinstatement planning'));
    expect(settle.indexOf('archivePendingCapture(dir, pending!.capture)'))
      .toBeGreaterThan(settle.indexOf("if (decision.action === 'verify-reinstated')"));
    const reinstate = toolSource.slice(toolSource.indexOf('async function runReinstate('), toolSource.indexOf('async function runBijection('));
    expect(reinstate).toContain('archivePendingCapture(dir, capture)');
  });

  it('halts only after a SUCCESSFUL recreate: a failed capture never resets, a failed reset is a failure', () => {
    const stages = planStages(codeTarget(), fitzroy(), haltOpts);
    const capture = orderedDeps('capture');
    const capReport = executeRebuild(stages, codeTarget(), capture.deps, HALT);
    expect(capReport).toEqual({ executed: ['precheck', 'afl-api-adjudications-capture'], failedStage: 'afl-api-adjudications-capture', ok: false });
    expect(capture.events).not.toContain('sql:RESET_SQL');

    const reset = orderedDeps('recreate');
    const resetReport = executeRebuild(stages, codeTarget(), reset.deps, HALT);
    expect(resetReport).toEqual({ executed: ['precheck', 'afl-api-adjudications-capture', 'recreate'], failedStage: 'recreate', ok: false });
    expect(resetReport.rehearsalHalt).toBeUndefined();
  });

  it('refuses, before running anything, a plan that does not begin PRECHECK -> capture -> recreate', () => {
    const stages = planStages(codeTarget(), fitzroy(), haltOpts);
    for (const broken of [
      stages.filter((s) => s.id !== 'afl-api-adjudications-capture'),
      stages.filter((s) => s.id !== 'precheck'),
      [stages[0], stages[2], stages[1], ...stages.slice(3)],
      [],
    ]) {
      const { deps, events } = orderedDeps();
      expect(refusal(() => executeRebuild(broken, codeTarget(), deps, HALT))).toMatch(/needs the plan to begin/);
      expect(events).toEqual([]);
    }
  });

  it('leaves normal runs exactly as they were: same stage graph, same execution, same result', () => {
    const withFlag = planStages(codeTarget(), fitzroy(), haltOpts);
    const without = planStages(codeTarget(), fitzroy(), codeOpts);
    expect(JSON.stringify(withFlag)).toBe(JSON.stringify(without));

    for (const [t, opts] of [[codeTarget(), codeOpts], [target(), OPTS]] as const) {
      const stages = planStages(t, fitzroy(), opts);
      const a = orderedDeps();
      const b = orderedDeps();
      const plain = executeRebuild(stages, t, a.deps);
      const explicit = executeRebuild(stages, t, b.deps, {});
      expect(plain).toEqual({ executed: idsOf(stages), ok: true });
      expect(explicit).toEqual(plain);
      expect(a.events).toEqual(b.events);
      expect(plain.rehearsalHalt).toBeUndefined();
    }
  });

  it('has a distinct exit code and tells the operator recovery is required, before any failure/success path', () => {
    expect(REHEARSAL_HALT_EXIT_CODE).not.toBe(0);
    expect(REHEARSAL_HALT_EXIT_CODE).not.toBe(1);
    const haltBranch = mainSource.indexOf('if (report.rehearsalHalt) {');
    expect(haltBranch).toBeGreaterThan(-1);
    expect(haltBranch).toBeLessThan(mainSource.indexOf('if (!report.ok) {'));
    expect(haltBranch).toBeLessThan(mainSource.indexOf("console.log('\\nRebuild complete.');"));
    const branch = mainSource.slice(haltBranch, mainSource.indexOf('if (!report.ok) {'));
    expect(branch).toContain('AFLDB-ISSUE-237 REHEARSAL HALT');
    expect(branch).toContain('RECOVERY IS REQUIRED');
    expect(branch).toContain('--recover-afl-api-adjudications');
    expect(branch).toContain('return REHEARSAL_HALT_EXIT_CODE;');
  });

  // -------------------------------------------------------------------------
  // The resulting state: marker present, pending file durable, database reset.
  // -------------------------------------------------------------------------

  const importer: CapturedImporterRow = {
    externalId: 'CD_I9992370001', playerIdentity: 'players/B/Barry_Mulcair.html',
    matchMethod: 'afl_api_stat_vector_bootstrap', status: 'unique', candidateCount: 1,
    externalName: 'x', externalUrl: null, notes: null, playerId: 700,
  };
  const pendingCapture = () => buildCombinedCapture({
    database: 'code_test_db', capturedAt: '2026-09-24T10:00:00.000Z', ledgerTablePresent: true,
    ledgerRows: [], importerRows: [importer],
  });

  it('--recover is the only way out of the halted state; a normal rerun refuses and never captures empty', () => {
    const pending = pendingCapture();
    const halted = { markerPresent: true, pending, liveLedgerRows: [], liveImporterRows: [] };
    const normal = decidePendingCapture({ ...halted, recover: false });
    expect(normal.action).toBe('refuse');
    expect((normal as { reason: string }).reason).toMatch(/--recover-afl-api-adjudications/);
    expect(decidePendingCapture({ ...halted, recover: true })).toEqual({ action: 'adopt-pending' });
    // the marker without the file (another capture root) refuses even with --recover
    expect(decidePendingCapture({ ...halted, pending: null, recover: true }).action).toBe('refuse');
    expect(decidePendingCapture({ ...halted, pending: null, recover: false }).action).toBe('refuse');
    // the recovery run is a NORMAL run: the halt flag cannot ride along
    expect(refusal(() => assertRehearsalStop({ target: 'code_test_db', rehearsalStopAfter: 'recreate', recoverAflApiAdjudications: true })))
      .toMatch(/cannot be combined/);
    // and the rerun's Stage 2 carries --recover only when asked
    const recovering = planStages(codeTarget(), fitzroy(), { ...codeOpts, recoverAflApiAdjudications: true });
    expect(recovering[1].argv).toEqual([...aflApiAdjudicationArgv('capture'), '--recover']);
    expect(planStages(codeTarget(), fitzroy(), codeOpts)[1].argv).toEqual(aflApiAdjudicationArgv('capture'));
  });

  it('adopting leaves the pending file byte-for-byte, archives nothing and recaptures nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'afldb-i237-halt-'));
    try {
      const pending = pendingCapture();
      writePendingCapture(dir, pending);
      const before = readFileSync(join(dir, PENDING_CAPTURE_FILE), 'utf8');
      const info = readPendingCaptureWithHash(dir, 'code_test_db')!;
      const outcome = settleCapture({
        dir, database: 'code_test_db', capturedAt: '2026-09-24T11:00:00.000Z', pending: info,
        live: { ledgerPresent: false, ledgerRows: [], importerRows: [] },
        decision: { action: 'adopt-pending' }, observed: null,
      });
      expect(outcome.adopted?.payloadSha256).toBe(pending.payloadSha256);
      expect(outcome.archived).toBeNull();
      expect(outcome.captured).toBeNull();
      expect(outcome.markerAction).toEqual({
        kind: 'set-if-absent', payloadSha256: pending.payloadSha256, fileSha256: info.fileSha256, capturedAt: pending.capturedAt,
      });
      expect(readFileSync(join(dir, PENDING_CAPTURE_FILE), 'utf8')).toBe(before);
      expect(readdirSync(dir)).toEqual([PENDING_CAPTURE_FILE]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // A TransactionSql stand-in (the fakeTx technique the OD-5 suite uses).
  function fakeTx(respond: (text: string) => unknown[]) {
    const statements: string[] = [];
    const tx = (strings: unknown, ...params: unknown[]) => {
      const text = (strings as string[]).reduce((acc, s, i) => `${acc}${i ? `$${i}` : ''}${s}`, '').replace(/\s+/g, ' ').trim();
      statements.push(text);
      void params;
      return Promise.resolve(respond(text));
    };
    return { tx: tx as unknown as TransactionSql, statements };
  }

  it('Stage 2 on the reset database reads an EMPTY importer section instead of failing (the --recover run)', async () => {
    // after RESET_SQL: no sources, no external_identities -> no statement touches either table
    const reset = fakeTx((text) => (text.includes('to_regclass') ? [{ sources: false, identities: false }] : []));
    await expect(fetchAflApiSourceIdIfPresent(reset.tx)).resolves.toBeNull();
    expect(reset.statements.some((s) => s.includes('FROM sources'))).toBe(false);
    // after migrations, before reference: the tables exist but hold no afl_api source
    const migrated = fakeTx((text) => (text.includes('to_regclass') ? [{ sources: true, identities: true }] : []));
    await expect(fetchAflApiSourceIdIfPresent(migrated.tx)).resolves.toBeNull();
    // a loaded database: the real id
    const loaded = fakeTx((text) => (text.includes('to_regclass') ? [{ sources: true, identities: true }] : [{ id: 9 }]));
    await expect(fetchAflApiSourceIdIfPresent(loaded.tx)).resolves.toBe(9);

    // the capture step uses it, skips the bijection only without a source, and refuses a
    // ledger with no source rather than capturing around it
    const runCapture = toolSource.slice(toolSource.indexOf('async function runCapture('), toolSource.indexOf('async function runReinstate('));
    expect(runCapture).toContain('await fetchAflApiSourceIdIfPresent(tx)');
    expect(runCapture).not.toContain('await fetchAflApiSourceId(tx)');
    expect(runCapture).toContain(
      'if (sourceId !== null) await assertAflApiAdjudicationBijection(tx, { ledgerTablePresent: ledgerLive.present });');
    expect(runCapture).toContain('if (sourceId === null && ledgerLive.rows.length > 0)');
    // the marker decision still comes after the read, so an empty read never becomes a baseline
    expect(runCapture.indexOf('decidePendingCapture({')).toBeGreaterThan(runCapture.indexOf('fetchAflApiSourceIdIfPresent'));
  });
});

/*
 * AFLDB-ISSUE-237 bootstrap — Stage 2 on a database older than migration 104 (the real
 * code_test_db: afl_api source present, 0 afl_api identity rows, no
 * afl_api_identity_adjudications table). observeCaptureState is the whole read-only half of
 * the capture step; it runs here against a statement-keyed TransactionSql stand-in. An absent
 * relation reads as an empty human section; an existing relation is read strictly.
 */
describe('AFLDB-ISSUE-237 bootstrap — Stage 2 capture before the adjudication ledger exists (DB-free)', () => {
  const LEDGER_TABLE = 'afl_api_identity_adjudications';
  const ledgerRow: CapturedLedgerRow = {
    id: 7, sourceKey: 'afl_api', externalId: 'CD_I1001', action: 'linked', playerId: 500,
    playerIdentity: 'players/A/Alpha_Able.html', previousState: null, evidence: '{"b": true}',
    evidenceSha256: 'a'.repeat(64), surnameDisagreementAcknowledged: false, supersedesId: null,
    adminUserId: 3, adminEmail: 'Admin.One@Example.org', adminRole: 'super_admin',
    note: 'Linked on club list and DOB evidence.', createdAt: '2026-09-23T01:02:03.123456Z',
  };
  const importerCensus = {
    externalId: 'CD_I2001', status: 'unique', matchMethod: 'afl_api_stat_vector_bootstrap',
    playerId: 502, candidateCount: 1, externalUrl: null,
  };
  const adminResolved = {
    externalId: 'CD_I1001', status: 'resolved', matchMethod: 'afl_api_admin_adjudication',
    playerId: 500, candidateCount: 0, externalUrl: null,
  };
  const relationMissing = () => Object.assign(
    new Error(`relation "${LEDGER_TABLE}" does not exist`), { code: '42P01' });

  type Stage2Db = {
    ledgerTable: boolean;
    ledgerRows?: CapturedLedgerRow[];
    ledgerTotal?: number;
    census?: typeof importerCensus[];
    /** Thrown by the statement whose text contains the key. */
    failOn?: Record<string, () => Error>;
    /** The forward-lookup rows (default: one Charlie_Cooper path per `unique` census row). */
    forwardRows?: { playerId: number; externalId: string; sourceKey: string }[];
  };

  /** Answers each Stage 2 statement the way the modelled database would. Any statement that
   * touches the ledger table while it is absent fails exactly as PostgreSQL does. */
  function stage2Tx(db: Stage2Db) {
    const statements: string[] = [];
    const census = db.census ?? [];
    const ledgerRows = db.ledgerRows ?? [];
    const respond = (text: string): unknown[] => {
      for (const [needle, error] of Object.entries(db.failOn ?? {})) {
        if (text.includes(needle)) throw error();
      }
      if (text.includes(`to_regclass('public.${LEDGER_TABLE}')`)) return [{ present: db.ledgerTable }];
      if (text.includes(LEDGER_TABLE) && !db.ledgerTable) throw relationMissing();
      if (text.includes('current_database() AS actual')) return [{ actual: 'code_test_db' }];
      if (text.includes('shobj_description')) return [{ comment: null }];
      if (text.includes("to_regclass('public.sources')")) return [{ sources: true, identities: true }];
      if (text.includes("SELECT id FROM sources WHERE key = 'afl_api'")) return [{ id: 9 }];
      if (text.includes(`FROM ${LEDGER_TABLE} a`)) {
        return ledgerRows.map((r) => ({ ...r, id: String(r.id), supersedesId: r.supersedesId === null ? null : String(r.supersedesId) }));
      }
      if (text.includes(`count(*)::int AS total FROM ${LEDGER_TABLE}`)) return [{ total: db.ledgerTotal ?? ledgerRows.length }];
      if (text.includes(`FROM ${LEDGER_TABLE} WHERE source_key = 'afl_api'`)) {
        return ledgerRows.map((r) => ({
          id: r.id, externalId: r.externalId, action: r.action, playerId: r.playerId,
          playerIdentity: r.playerIdentity, supersedesId: r.supersedesId,
        }));
      }
      if (text.includes("AND status = 'resolved'")) {
        return census.filter((r) => r.status === 'resolved')
          .map((r) => ({ externalId: r.externalId, status: r.status, matchMethod: r.matchMethod }));
      }
      if (text.includes('candidate_count AS "candidateCount"')) return census;
      if (text.includes('player_id = ANY')) {
        if (db.forwardRows) return db.forwardRows;
        return census.filter((r) => r.status === 'unique')
          .map((r) => ({ playerId: r.playerId, externalId: 'players/C/Charlie_Cooper.html', sourceKey: 'afltables' }));
      }
      if (text.includes('external_name AS "externalName"')) {
        return census.map((r) => ({ externalId: r.externalId, externalName: 'C Cooper', notes: null }));
      }
      if (text.includes('SELECT DISTINCT ei.player_id')) return [{ playerId: 500 }];
      throw new Error(`unmodelled statement: ${text}`);
    };
    const tx = (strings: unknown, ...params: unknown[]) => {
      const text = (strings as string[]).reduce((acc, s, i) => `${acc}${i ? `$${i}` : ''}${s}`, '').replace(/\s+/g, ' ').trim();
      statements.push(text);
      void params;
      return new Promise((resolve) => resolve(respond(text)));
    };
    Object.assign(tx, { array: (values: unknown[]) => values });
    return { tx: tx as unknown as TransactionSql, statements };
  }

  const observe = (tx: TransactionSql, dir: string) =>
    observeCaptureState(tx, { database: 'code_test_db', dir, pendingInfo: null, recover: false });

  function withDir<T>(body: (dir: string) => Promise<T>): Promise<T> {
    const dir = mkdtempSync(join(tmpdir(), 'afldb-i237-bootstrap-'));
    return body(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
  }

  it('Test A: a pre-ledger bootstrap database (afl_api source, 0 afl_api rows, no ledger table, '
     + 'no marker, no pending file) captures ledgerRows = [] and importerRows = [] as one valid '
     + 'combined capture, and the normal marker/file lifecycle proceeds', async () => {
    await withDir(async (dir) => {
      const db = stage2Tx({ ledgerTable: false });
      const state = await observe(db.tx, dir);
      expect(state.ledgerLive).toEqual({ present: false, rows: [] });
      expect(state.importerLive).toEqual([]);
      expect(state.decision).toEqual({ action: 'capture-live' });
      expect(state.observed).toBeNull();

      // the absent relation is only ever probed through to_regclass, never queried or created
      const touching = db.statements.filter((s) => s.includes(LEDGER_TABLE));
      expect(touching).toHaveLength(1);
      expect(touching[0]).toContain(`to_regclass('public.${LEDGER_TABLE}')`);
      expect(db.statements.some((s) => /\b(CREATE|INSERT|UPDATE|DELETE|COMMENT)\b/.test(s))).toBe(false);
      // importer capture and the bijection still ran against the real afl_api source
      expect(db.statements.some((s) => s.includes('candidate_count AS "candidateCount"'))).toBe(true);
      expect(db.statements.some((s) => s.includes("AND status = 'resolved'"))).toBe(true);

      const outcome = settleCapture({
        dir, database: 'code_test_db', capturedAt: '2026-09-24T12:00:00.000Z', pending: null,
        live: { ledgerPresent: state.ledgerLive.present, ledgerRows: state.ledgerLive.rows, importerRows: state.importerLive },
        decision: state.decision, observed: state.observed,
      });
      expect(outcome.adopted).toBeNull();
      expect(outcome.archived).toBeNull();
      const { capture, sha256 } = outcome.captured!;
      expect(capture.ledgerTablePresent).toBe(false);
      expect(capture.ledgerRows).toEqual([]);
      expect(capture.importerRows).toEqual([]);
      expect(combinedCaptureStructureProblems(capture.ledgerRows, capture.importerRows)).toEqual([]);
      expect(outcome.markerAction).toEqual({
        kind: 'set', payloadSha256: capture.payloadSha256, fileSha256: sha256, capturedAt: capture.capturedAt,
      });
      // one file, one payload hash: it reads back whole, as the reset's recovery source
      expect(readdirSync(dir)).toEqual([PENDING_CAPTURE_FILE]);
      const back = readPendingCaptureWithHash(dir, 'code_test_db')!;
      expect(back.capture).toEqual(capture);
      expect(back.fileSha256).toBe(sha256);
      // a run halted after `recreate` meets exactly the existing recovery rules
      expect(decidePendingCapture({ markerPresent: true, pending: capture, liveLedgerRows: [], liveImporterRows: [], recover: true }))
        .toEqual({ action: 'adopt-pending' });
    });
  });

  it('Test A (strictness kept): with no ledger table, an admin-resolved afl_api row still fails the '
     + 'bijection, and importer rows are still captured through the full D5/D7/D13 path', async () => {
    await withDir(async (dir) => {
      const orphan = stage2Tx({ ledgerTable: false, census: [adminResolved] });
      await expect(observe(orphan.tx, dir)).rejects.toThrow(/row_without_ledger:CD_I1001/);

      const importer = stage2Tx({ ledgerTable: false, census: [importerCensus] });
      const state = await observe(importer.tx, dir);
      expect(state.ledgerLive).toEqual({ present: false, rows: [] });
      expect(state.importerLive.map((r) => [r.externalId, r.playerIdentity, r.playerId]))
        .toEqual([['CD_I2001', 'players/C/Charlie_Cooper.html', 502]]);
      expect(readdirSync(dir)).toEqual([]); // observing never writes the file
    });
  });

  it('Test B: an EXISTING ledger table whose read fails is a hard failure — never an empty-ledger '
     + 'substitution — and nothing after the failed read runs', async () => {
    const failures: { name: string; db: Stage2Db; message: RegExp }[] = [
      {
        name: 'permission failure on the ledger read',
        db: { ledgerTable: true, failOn: { [`FROM ${LEDGER_TABLE} a`]: () => Object.assign(new Error(`permission denied for table ${LEDGER_TABLE}`), { code: '42501' }) } },
        message: /permission denied/,
      },
      {
        // the table vanishing between the probe and the read is NOT "absent": only the probe decides
        name: 'relation error on an existing table',
        db: { ledgerTable: true, failOn: { [`FROM ${LEDGER_TABLE} a`]: relationMissing } },
        message: /does not exist/,
      },
      {
        name: 'unexpected SQL error',
        db: { ledgerTable: true, failOn: { [`count(*)::int AS total FROM ${LEDGER_TABLE}`]: () => new Error('canceling statement due to statement timeout') } },
        message: /statement timeout/,
      },
      {
        name: 'malformed row',
        db: { ledgerTable: true, ledgerRows: [{ ...ledgerRow, id: 0 }] },
        message: /ledger id '0' is not a safe positive integer/,
      },
      {
        name: 'a ledger row with no resolvable actor',
        db: { ledgerTable: true, ledgerRows: [ledgerRow], ledgerTotal: 2 },
        message: /holds 2 row\(s\) but only 1 carry a resolvable actor/,
      },
    ];
    for (const { name, db, message } of failures) {
      await withDir(async (dir) => {
        const fake = stage2Tx(db);
        await expect(observe(fake.tx, dir), name).rejects.toThrow(message);
        // no downgrade: the importer section, the decision and the marker are never reached
        expect(fake.statements.some((s) => s.includes("to_regclass('public.sources')")), name).toBe(false);
        expect(readdirSync(dir), name).toEqual([]);
      });
    }

    // the bijection's own ledger read is strict too whenever the table exists
    await withDir(async (dir) => {
      const fake = stage2Tx({
        ledgerTable: true,
        failOn: { [`FROM ${LEDGER_TABLE} WHERE source_key = 'afl_api'`]: () => new Error('permission denied for table afl_api_identity_adjudications') },
      });
      await expect(observe(fake.tx, dir)).rejects.toThrow(/permission denied/);
    });

    // and the failure stops the capture step before settleCapture/applyMarkerAction, i.e. before
    // the stage can exit 0 and let `recreate` run
    const tool = readFileSync(join(root, 'tools', 'migration', 'rebuild_afl_api_adjudications.ts'), 'utf8');
    const runCapture = tool.slice(tool.indexOf('async function runCapture('), tool.indexOf('\nexport type CaptureObservation'));
    expect(runCapture.indexOf('observeCaptureState(tx,')).toBeGreaterThan(-1);
    expect(runCapture.indexOf('settleCapture({')).toBeGreaterThan(runCapture.indexOf('observeCaptureState(tx,'));
    expect(runCapture).not.toMatch(/catch\s*\(/);
  });

  it('Test C: an existing ledger table is captured exactly as before, alongside the importer section', async () => {
    await withDir(async (dir) => {
      const db = stage2Tx({ ledgerTable: true, ledgerRows: [ledgerRow], census: [adminResolved, importerCensus] });
      const state = await observe(db.tx, dir);
      expect(state.ledgerLive).toEqual({ present: true, rows: [ledgerRow] });
      expect(state.importerLive.map((r) => r.externalId)).toEqual(['CD_I2001']);
      expect(state.decision).toEqual({ action: 'capture-live' });
      // the bijection read the ledger itself (the strict path), not the Stage 2 copy
      expect(db.statements.some((s) => s.includes(`FROM ${LEDGER_TABLE} WHERE source_key = 'afl_api'`))).toBe(true);

      const outcome = settleCapture({
        dir, database: 'code_test_db', capturedAt: '2026-09-24T12:00:00.000Z', pending: null,
        live: { ledgerPresent: state.ledgerLive.present, ledgerRows: state.ledgerLive.rows, importerRows: state.importerLive },
        decision: state.decision, observed: state.observed,
      });
      const { capture } = outcome.captured!;
      expect(capture.ledgerTablePresent).toBe(true);
      expect(capture.ledgerRows).toEqual([ledgerRow]);
      expect(capture.importerRows).toHaveLength(1);
      expect(capture).toEqual(buildCombinedCapture({
        database: 'code_test_db', capturedAt: '2026-09-24T12:00:00.000Z', ledgerTablePresent: true,
        ledgerRows: [ledgerRow], importerRows: state.importerLive,
      }));

      // a ledger decision with no resolved row behind it still fails the (strict) bijection
      const broken = stage2Tx({ ledgerTable: true, ledgerRows: [ledgerRow], census: [importerCensus] });
      await expect(observe(broken.tx, dir)).rejects.toThrow(/ledger_without_row:CD_I1001/);
    });
  });

  it('AFLDB-ISSUE-237 continuity: Stage 2 captures a folded player (exact tracked pair) under the '
     + 'continuing path, and still refuses before destruction for any non-exact pair', async () => {
    const rule = loadFitzroyProfileContinuityRules()[0];
    const path = (externalId: string) => ({ playerId: 502, externalId, sourceKey: 'afltables' });
    await withDir(async (dir) => {
      // renumbered path first: the rule, not row order or sort order, picks the continuing path
      const folded = stage2Tx({
        ledgerTable: false, census: [importerCensus],
        forwardRows: [path(rule.renumberedUrl), path(rule.continuingUrl)],
      });
      const state = await observe(folded.tx, dir);
      expect(state.importerLive.map((r) => [r.externalId, r.playerIdentity, r.playerId]))
        .toEqual([['CD_I2001', rule.continuingUrl, 502]]);

      for (const forwardRows of [
        [path(rule.continuingUrl), path('players/Z/Unrelated_Profile.html')],
        [path(rule.renumberedUrl), path('players/Z/Unrelated_Profile.html')],
        [path(rule.continuingUrl), path(rule.renumberedUrl), path('players/Z/Unrelated_Profile.html')],
      ]) {
        const refused = stage2Tx({ ledgerTable: false, census: [importerCensus], forwardRows });
        await expect(observe(refused.tx, dir)).rejects.toThrow(
          /D7: before-destruction identity check failed for 1 importer row\(s\).*not exactly one tracked profile_url_continuity pair/);
      }
      expect(readdirSync(dir)).toEqual([]);
    });
  });
});

/*
 * AFLDB-ISSUE-237 L1/L2 — the code_test_db rehearsal fixture, DB-free. Target pinning, the
 * provider namespace, stable-identity-only resolution, and the pre/post verification contract.
 */
describe('AFLDB-ISSUE-237 — code_test_db rehearsal fixture (DB-free)', () => {
  const fixtureSource = readFileSync(
    join(root, 'tools', 'migration', 'afl_api_identity_rebuild_rehearsal_fixture.ts'), 'utf8');
  const F = REHEARSAL_FIXTURE;
  const OWNER_CT = 'postgres://afldb_owner:pw@localhost:5432/code_test_db';
  const IMPORT_CT = 'postgres://afldb_import:pw@localhost:5432/code_test_db';
  const dsnFor = (db: string) => `postgres://afldb_owner:pw@localhost:5432/${db}`;

  function refused(fn: () => unknown): string {
    try {
      fn();
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error('expected a refusal');
  }

  it('parses exactly seed, verify --phase pre|post, teardown and residue', () => {
    expect(parseRehearsalArgs(['seed'])).toEqual({ step: 'seed', allowOwnerImportDsn: false });
    expect(parseRehearsalArgs(['seed', '--allow-owner-import-dsn'])).toEqual({ step: 'seed', allowOwnerImportDsn: true });
    expect(parseRehearsalArgs(['verify', '--phase', 'pre'])).toEqual({ step: 'verify', phase: 'pre' });
    expect(parseRehearsalArgs(['verify', '--phase', 'post'])).toEqual({ step: 'verify', phase: 'post' });
    expect(parseRehearsalArgs(['teardown'])).toEqual({ step: 'teardown' });
    expect(parseRehearsalArgs(['residue'])).toEqual({ step: 'residue' });
    for (const argv of [[], ['verify'], ['verify', '--phase', 'mid'], ['teardown', 'now'], ['seed', '--target', 'afldb_test'],
      ['residue', '--fix'], ['cleanup']]) {
      expect(() => parseRehearsalArgs(argv), argv.join(' ')).toThrow(RehearsalFixtureRefused);
    }
  });

  it('seed forward lookup binds player ids as int[] (a bare tx.array of numbers is text[]: integer = text)', async () => {
    const statements: string[] = [];
    const tx = (strings: string[]) => {
      statements.push(strings.reduce((acc, s, i) => `${acc}${i ? `$${i}` : ''}${s}`, '').replace(/\s+/g, ' ').trim());
      return Promise.resolve([{ playerId: 500, externalId: F.importer.stableIdentity, sourceKey: 'afltables' }]);
    };
    Object.assign(tx, { array: (values: unknown[]) => values });
    const result = await readAflApiForwardIdentities(tx as unknown as TransactionSql, [500]);
    expect(result.get(500)).toEqual({ ok: true, identity: F.importer.stableIdentity, via: 'afltables' });
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('ei.player_id = ANY ($1::int[])');
  });

  it('is hard-pinned to code_test_db through its own variables, never another target\'s', () => {
    expect(resolveRehearsalDsns({ AFLDB_CODE_TEST_DATABASE_URL: OWNER_CT, AFLDB_CODE_TEST_IMPORT_DATABASE_URL: IMPORT_CT },
      { allowOwnerImportDsn: false }))
      .toEqual({ database: 'code_test_db', ownerDsn: OWNER_CT, importDsn: IMPORT_CT, importIsOwner: false });
    for (const db of ['afldb_test', 'afldb_dev', 'afldb_prod', 'afldb', 'afldb_production', 'random_test', 'afldb_test_pre_rebuild']) {
      expect(refused(() => resolveRehearsalDsns({ AFLDB_CODE_TEST_DATABASE_URL: dsnFor(db) }, { allowOwnerImportDsn: true })), db)
        .toMatch(/Refusing|code_test_db' only/);
    }
    // the afldb_test variables are never read, even when they are the only ones set
    expect(refused(() => resolveRehearsalDsns({
      AFLDB_TEST_DATABASE_URL: dsnFor('afldb_test'), DATABASE_URL: dsnFor('afldb_dev'), AFLDB_DATABASE_URL: dsnFor('afldb_dev'),
    }, { allowOwnerImportDsn: true }))).toMatch(/AFLDB_CODE_TEST_DATABASE_URL is not set/);
    expect(refused(() => resolveRehearsalDsns({ AFLDB_CODE_TEST_DATABASE_URL: OWNER_CT,
      AFLDB_CODE_TEST_IMPORT_DATABASE_URL: dsnFor('afldb_test') }, { allowOwnerImportDsn: false })))
      .toMatch(/names 'afldb_test', not 'code_test_db'/);
    expect(refused(() => resolveRehearsalDsns({ AFLDB_CODE_TEST_DATABASE_URL: OWNER_CT }, { allowOwnerImportDsn: false })))
      .toMatch(/AFLDB_CODE_TEST_IMPORT_DATABASE_URL is not set/);
    expect(resolveRehearsalDsns({ AFLDB_CODE_TEST_DATABASE_URL: OWNER_CT }, { allowOwnerImportDsn: true }).importIsOwner).toBe(true);
    expect(fixtureSource).not.toMatch(/AFLDB_TEST_DATABASE_URL|AFLDB_TEST_IMPORT_DATABASE_URL/);
  });

  it('owns an ISSUE-237 provider namespace that no real, S6 or I18 id can fall into', () => {
    const ids = [F.importer.providerId, F.human.providerId];
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) {
      expect(REHEARSAL_PROVIDER_NAMESPACE_RE.test(id)).toBe(true);
      expect(/^CD_I[0-9]+$/.test(id)).toBe(true);
      expect(/^CD_I999235[0-9]{4}$/.test(id)).toBe(false); // S6
    }
    expect(F.human.externalRecordId).toBe(`${F.human.matchId}|${F.human.teamId}|${F.human.providerId}`);
    // real Champion Data ids are CD_I + 6-7 digits; the namespace needs 10
    for (const real of ['CD_I999237', 'CD_I9992370', 'CD_I1002231', 'CD_I999724', 'CD_I9991800001', 'CD_I99923700011']) {
      expect(REHEARSAL_PROVIDER_NAMESPACE_RE.test(real), real).toBe(false);
    }
  });

  it('the provider/match namespace is absent from every tracked AFL API data file', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(json|jsonl|csv|tsv|txt)$/i.test(entry.name)) files.push(path);
      }
    };
    walk(join(root, 'data'));
    walk(join(root, 'tools', 'rebuild', 'afl_api'));
    expect(files.some((f) => /afl-api-player-bridge/.test(f))).toBe(true);
    const hits = files.filter((f) => /CD_[IM]999237/.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });

  it('chooses players by accepted AFL Tables identity only: no name lookup, no stored players.id', () => {
    for (const identity of [F.importer.stableIdentity, F.human.stableIdentity]) {
      expect(identity).toMatch(/^players\/[A-Z]\/[A-Za-z_]+\.html$/);
    }
    expect(F.importer.stableIdentity).not.toBe(F.human.stableIdentity);
    // both are tracked, accepted AFL Tables resolutions (father-son selections, status unique)
    const fatherSon = readFileSync(join(root, 'data', 'players', 'father-son-selections.csv'), 'utf8');
    for (const identity of [F.importer.stableIdentity, F.human.stableIdentity]) {
      expect(fatherSon).toContain(`,${identity},unique,`);
    }
    // no SQL predicate on a name column anywhere in the tool
    expect(fixtureSource).not.toMatch(/(surname|given_name|display_name|full_name)\s*(=|ILIKE|LIKE|~)/i);
    // every players row it reads is by an id resolved in the SAME transaction from the stable identity
    expect(fixtureSource.match(/FROM players/g)).toHaveLength(1);
    const seed = fixtureSource.slice(fixtureSource.indexOf('async function runSeed('), fixtureSource.indexOf('async function runVerify('));
    expect(seed).toContain('const humanPlayer = await resolveNow(tx, f.human.stableIdentity);');
    expect(seed).toContain('const playerId = await resolveNow(tx, f.importer.stableIdentity);');
    // the importer row is written through the IMPORT role, the human link through the real mutation
    expect(seed.indexOf('connect(dsns.importDsn)')).toBeLessThan(seed.indexOf('INSERT INTO external_identities'));
    expect(seed).toContain('linkAflApiProvider({');
    // all three development variables are overwritten before the query module loads
    const load = seed.indexOf("import('@/db/queries/afl-api-player-links')");
    for (const v of ['DATABASE_URL', 'AFLDB_IMPORT_DATABASE_URL', 'AFLDB_AUTH_DATABASE_URL']) {
      const at = seed.indexOf(`process.env.${v} = dsns.`);
      expect(at, v).toBeGreaterThan(-1);
      expect(at, v).toBeLessThan(load);
    }
  });

  const seedObs = (over: Partial<RehearsalSeedObservation> = {}): RehearsalSeedObservation => ({
    database: 'code_test_db', importerResolvedPlayerIds: [11], humanResolvedPlayerIds: [12],
    importerForward: { ok: true, identity: F.importer.stableIdentity, via: 'afltables' },
    humanForward: { ok: true, identity: F.human.stableIdentity, via: 'afltables' },
    aflApiRows: 0, ledgerRows: 0, fixtureResidue: 0, markerPresent: false, pendingCaptureExists: false, baselineExists: false,
    ...over,
  });

  it('seed fails closed on a missing/ambiguous identity and on any state that would make E_rebuild non-empty', () => {
    expect(rehearsalSeedPreconditionProblems(seedObs())).toEqual([]);
    const cases: Array<[Partial<RehearsalSeedObservation>, RegExp]> = [
      [{ importerResolvedPlayerIds: [] }, /resolves to 0 players/],
      [{ humanResolvedPlayerIds: [12, 13] }, /resolves to 2 players/],
      [{ humanResolvedPlayerIds: [11] }, /resolve to the same player/],
      [{ importerForward: { ok: false, reason: 'ambiguous' } }, /D7: the importer player's forward identity is ambiguous/],
      [{ humanForward: { ok: true, identity: 'tok-1', via: 'manual_admin_edit' } }, /D7: the human player's forward identity is manual_admin_edit/],
      [{ importerForward: { ok: true, identity: 'players/X/Other.html', via: 'afltables' } }, /not afltables:players\/B\/Barry_Mulcair/],
      [{ aflApiRows: 1 }, /afl_api identity row\(s\) already exist/],
      [{ ledgerRows: 2 }, /ledger is not empty/],
      [{ fixtureResidue: 1 }, /run teardown first/],
      [{ markerPresent: true }, /rebuild marker is present/],
      [{ pendingCaptureExists: true }, /pending rebuild capture/],
      [{ baselineExists: true }, /baseline already exists/],
      [{ database: 'afldb_test' }, /not 'code_test_db'/],
    ];
    for (const [over, pattern] of cases) {
      expect(rehearsalSeedPreconditionProblems(seedObs(over)).join('; '), JSON.stringify(over)).toMatch(pattern);
    }
  });

  const ledgerRow = (over: Partial<RehearsalLedgerRow> = {}): RehearsalLedgerRow => ({
    id: 41, externalId: F.human.providerId, action: 'linked', playerIdentity: F.human.stableIdentity,
    evidenceSha256: 'e'.repeat(64), supersedesId: null, adminEmail: F.actorEmail, note: F.human.note,
    createdAt: '2026-09-24T01:02:03.123456Z', ...over,
  });
  const baseline = () => buildRehearsalBaseline({ database: 'code_test_db', seededAt: '2026-09-24T01:03:00.000Z', ledger: [ledgerRow()] });

  it('the baseline carries durable fields only, proves its own hash, and refuses the wrong shape', () => {
    const b = baseline();
    const text = JSON.stringify(b);
    expect(text).not.toMatch(/"playerId"|"adminUserId"|password|totp/i);
    expect(parseRehearsalBaseline(text, 'code_test_db')).toEqual(b);
    expect(() => parseRehearsalBaseline(text, 'afldb_test')).toThrow(/not 'afldb_test'/);
    expect(() => parseRehearsalBaseline(JSON.stringify({ ...b, ledger: [ledgerRow({ note: 'edited after seed....' })] }), 'code_test_db'))
      .toThrow(/fixture shape|payload hash/);
    expect(() => parseRehearsalBaseline(JSON.stringify({ ...b, ledger: [ledgerRow({ createdAt: '2026-09-24T01:02:03.123457Z' })] }), 'code_test_db'))
      .toThrow(/payload hash/);
    expect(() => parseRehearsalBaseline(JSON.stringify({ ...b, importer: { ...b.importer, matchMethod: 'afl_api_stat_vector_season' } }), 'code_test_db'))
      .toThrow(/payload hash or the fixture constants/);
    expect(() => buildRehearsalBaseline({ database: 'code_test_db', seededAt: 'x', ledger: [ledgerRow(), ledgerRow({ id: 42 })] }))
      .toThrow(/expected exactly 1/);
    expect(() => buildRehearsalBaseline({ database: 'code_test_db', seededAt: 'x', ledger: [ledgerRow({ action: 'revoked', supersedesId: 40 })] }))
      .toThrow(/not 'linked'/);
    expect(() => buildRehearsalBaseline({ database: 'code_test_db', seededAt: 'x', ledger: [ledgerRow({ externalId: F.importer.providerId })] }))
      .toThrow(/names CD_I9992370001/);
    expect(rehearsalBaselinePath('D:/cap', 'code_test_db').replace(/\\/g, '/')).toBe('D:/cap/issue-237-rehearsal/code_test_db.baseline.json');
  });

  /** A consistent observation: importer on player `ip`, human on `hp` — whatever those ids are. */
  const observation = (ip: number, hp: number, over: Partial<RehearsalObservation> = {}): RehearsalObservation => ({
    database: 'code_test_db', markerPresent: false, pendingCaptureExists: false,
    importerResolvedPlayerIds: [ip], humanResolvedPlayerIds: [hp],
    importerForward: { ok: true, identity: F.importer.stableIdentity, via: 'afltables' },
    humanForward: { ok: true, identity: F.human.stableIdentity, via: 'afltables' },
    aflApiRows: [
      { externalId: F.importer.providerId, status: 'unique', matchMethod: F.importer.matchMethod, playerId: ip,
        candidateCount: 1, externalUrl: null, externalName: F.importer.externalName, notes: F.importer.notes },
      { externalId: F.human.providerId, status: 'resolved', matchMethod: 'afl_api_admin_adjudication', playerId: hp,
        candidateCount: 0, externalUrl: null, externalName: 'Shephard', notes: 'x' },
    ],
    ledger: [{ ...ledgerRow(), playerId: hp }],
    actors: [{ email: F.actorEmail, role: 'super_admin', disabled: true, hasPasswordHash: false, hasTotpSecret: false }],
    invariant: 'ok',
    live: {
      sequence: { lastValue: 41, isCalled: true },
      replay: { inserted: 0, noops: 1, stops: [], supersedes: [] },
      importerReplay: { inserted: 0, noops: 1 },
      bijection: 'ok',
    },
    archivedCaptures: [],
    ...over,
  });
  const carrying = [{ file: 'afl-api-identities.x.reinstated.json', fileSha256: 'f'.repeat(64), payloadSha256: 'p'.repeat(64),
    carriesFixture: true, importerPlayerIdAtCapture: 101 }];

  it('verify pre/post pass on the exact fixture state, including after every player is renumbered', () => {
    const b: RehearsalBaseline = baseline();
    expect(rehearsalVerifyProblems(b, observation(101, 102), 'pre')).toEqual([]);
    // post: new surrogate ids everywhere, same stable identities, archived capture carrying both sections
    expect(rehearsalVerifyProblems(b, observation(9001, 9002, { archivedCaptures: carrying }), 'post')).toEqual([]);
    // post without an archived combined capture carrying both sections
    expect(rehearsalVerifyProblems(b, observation(9001, 9002), 'post').join('; '))
      .toMatch(/no archived combined capture carries both fixture sections/);
    // pre after a rebuild already ran
    expect(rehearsalVerifyProblems(b, observation(101, 102, { archivedCaptures: carrying }), 'pre').join('; '))
      .toMatch(/use --phase post/);
  });

  it('verify post fails on every D5/D7/D13/D15 violation', () => {
    const b = baseline();
    const post = (over: Partial<RehearsalObservation>) =>
      rehearsalVerifyProblems(b, observation(9001, 9002, { archivedCaptures: carrying, ...over }), 'post').join('; ');
    const rows = observation(9001, 9002).aflApiRows;
    const [imp, hum] = rows;
    const cases: Array<[Partial<RehearsalObservation>, RegExp]> = [
      [{ markerPresent: true }, /Stage 18 did not clear it/],
      [{ pendingCaptureExists: true }, /pending rebuild capture/],
      [{ aflApiRows: [{ ...imp, playerId: 101 }, hum] }, /retargeted/],
      [{ aflApiRows: [{ ...imp, matchMethod: 'afl_api_stat_vector_season' }, hum] }, /not exactly 'afl_api_stat_vector_bootstrap'/],
      [{ aflApiRows: [{ ...imp, status: 'resolved', matchMethod: 'afl_api_admin_adjudication' }, hum] }, /superseded or rewritten/],
      [{ aflApiRows: [{ ...imp, externalUrl: 'https://x' }, hum] }, /external_url is not NULL/],
      [{ aflApiRows: [{ ...imp, candidateCount: 2 }, hum] }, /candidate_count is 2/],
      [{ aflApiRows: [{ ...imp, notes: null }, hum] }, /notes were not carried exactly/],
      [{ aflApiRows: [hum] }, /has 0 afl_api row/],
      [{ aflApiRows: [imp] }, /human provider .* has 0 afl_api row/],
      [{ aflApiRows: [...rows, { ...imp, externalId: 'CD_I1002231', playerId: 5 }] }, /non-fixture afl_api row/],
      [{ ledger: [] }, /whole ledger holds 0 row/],
      [{ ledger: [{ ...ledgerRow({ createdAt: '2026-09-24T01:02:03.000000Z' }), playerId: 9002 }] }, /durable field differs/],
      [{ ledger: [{ ...ledgerRow(), playerId: 102 }] }, /not the player its identity names now/],
      [{ importerResolvedPlayerIds: [] }, /resolves to 0 players/],
      [{ humanForward: { ok: false, reason: 'ambiguous' } }, /D7/],
      [{ invariant: { error: 'one-row-per-player' } }, /standalone invariant failed/],
      [{ live: { ...observation(1, 2).live, replay: { inserted: 0, noops: 0, stops: [], supersedes: [{ externalId: F.importer.providerId, playerId: 9001 }] } } },
        /supersedes 1 row\(s\); expected none/],
      [{ live: { ...observation(1, 2).live, replay: { inserted: 1, noops: 0, stops: [], supersedes: [] } } }, /would still insert 1/],
      [{ live: { ...observation(1, 2).live, importerReplay: { inserted: 1, noops: 0 } } }, /importer replay would still insert 1/],
      [{ live: { ...observation(1, 2).live, bijection: { error: 'missing_resolved:CD_I9992370002' } } }, /bijection does not hold/],
      [{ actors: [] }, /0 fixture actor/],
      [{ actors: [{ email: F.actorEmail, role: 'super_admin', disabled: false, hasPasswordHash: true, hasTotpSecret: false }] },
        /not attribution-only/],
      [{ database: 'afldb_test' }, /not 'code_test_db'/],
    ];
    for (const [over, pattern] of cases) expect(post(over), JSON.stringify(over).slice(0, 120)).toMatch(pattern);
  });

  const capturedLedger = (over: Partial<CapturedLedgerRow> = {}): CapturedLedgerRow => ({
    id: 41, sourceKey: 'afl_api', externalId: F.human.providerId, action: 'linked', playerId: 102,
    playerIdentity: F.human.stableIdentity, previousState: null, evidence: '{"k": 1}', evidenceSha256: 'e'.repeat(64),
    surnameDisagreementAcknowledged: false, supersedesId: null, adminUserId: 5, adminEmail: F.actorEmail,
    adminRole: 'super_admin', note: F.human.note, createdAt: '2026-09-24T01:02:03.123456Z', ...over,
  });
  const capturedImporter = (over: Partial<CapturedImporterRow> = {}): CapturedImporterRow => ({
    externalId: F.importer.providerId, playerIdentity: F.importer.stableIdentity, matchMethod: 'afl_api_stat_vector_bootstrap',
    status: 'unique', candidateCount: 1, externalName: F.importer.externalName, externalUrl: null, notes: F.importer.notes,
    playerId: 101, ...over,
  });
  const combined = (ledgerRows = [capturedLedger()], importerRows = [capturedImporter()]) => buildCombinedCapture({
    database: 'code_test_db', capturedAt: '2026-09-24T02:00:00.000Z', ledgerTablePresent: true, ledgerRows, importerRows,
  });

  it('an archived capture proves both sections travelled together — or it is not evidence', () => {
    const b = baseline();
    expect(captureCarriesFixture(combined(), b)).toBe(true);
    // a renumbered captured surrogate is irrelevant (audit only)
    expect(captureCarriesFixture(combined([capturedLedger({ playerId: 7 })], [capturedImporter({ playerId: 8 })]), b)).toBe(true);
    expect(captureCarriesFixture(combined([], [capturedImporter()]), b)).toBe(false);
    expect(captureCarriesFixture(combined([capturedLedger()], []), b)).toBe(false);
    expect(captureCarriesFixture(combined([capturedLedger()], [capturedImporter({ matchMethod: 'afl_api_stat_vector_season' })]), b)).toBe(false);
    expect(captureCarriesFixture(combined([capturedLedger({ createdAt: '2026-09-24T01:02:03.000000Z' })]), b)).toBe(false);

    const dir = mkdtempSync(join(tmpdir(), 'afldb-i237-rehearsal-'));
    try {
      const capture = combined();
      writePendingCapture(dir, capture);
      const archived = archivePendingCapture(dir, capture);
      writeFileSync(join(dir, 'afl-api-identities.tampered.reinstated.json'), '{"format":"nope"}');
      const found = readArchivedRehearsalCaptures(dir, 'code_test_db', b);
      expect(found.map((c) => c.carriesFixture)).toEqual(
        found.map((c) => c.file === archived.split(/[\\/]/).pop()));
      expect(found.find((c) => c.carriesFixture)?.importerPlayerIdAtCapture).toBe(101);
      expect(found.find((c) => !c.carriesFixture)?.payloadSha256).toBe('unverifiable');
      expect(readArchivedRehearsalCaptures(join(dir, 'absent'), 'code_test_db', b)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('teardown owns only exact literals, never runs mid-lifecycle, and ends in the residue gate', () => {
    expect(residueTotal(ZERO_REHEARSAL_RESIDUE)).toBe(0);
    expect(residueTotal({ ...ZERO_REHEARSAL_RESIDUE, actors: 1, ledgerRows: 2 })).toBe(3);
    const teardown = fixtureSource.slice(fixtureSource.indexOf('async function runTeardown('), fixtureSource.indexOf('async function main('));
    // mid-lifecycle refusals come before the first DELETE
    const firstDelete = teardown.indexOf('DELETE FROM');
    expect(teardown.indexOf('existsSync(join(captureDir, PENDING_CAPTURE_FILE))')).toBeLessThan(firstDelete);
    expect(teardown.indexOf('await readRebuildMarker(tx, database)')).toBeLessThan(firstDelete);
    expect(teardown.indexOf('if (database !== dsns.database)')).toBeLessThan(firstDelete);
    // every DELETE is by exact literal: no pattern match, no prefix
    const deletes = teardown.split('DELETE FROM').slice(1).map((s) => s.slice(0, s.indexOf('`')));
    expect(deletes.length).toBe(9);
    for (const d of deletes) expect(d, d).not.toMatch(/\bLIKE\b|\s~\s|NAMESPACE/);
    // the residue gate runs after the deletes and counts the whole namespace
    expect(teardown.indexOf('await runResidue(dsns);')).toBeGreaterThan(teardown.lastIndexOf('DELETE FROM'));
    const residue = fixtureSource.slice(fixtureSource.indexOf('export async function readRehearsalResidue('));
    expect(residue).toContain('ei.external_id ~ ${REHEARSAL_PROVIDER_NAMESPACE}');
  });

  it('is invoked through its own react-server package script', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['db:code-test:issue237-rehearsal'])
      .toBe('tsx --conditions=react-server tools/migration/afl_api_identity_rebuild_rehearsal_fixture.ts');
  });
});

describe('AFLDB-ISSUE-237 recovery attribution actor — ensure_issue237_recovery_actor.ts (DB-free)', () => {
  const EMAIL = 'issue224-recovery@example.test';
  const SECRET = 'S3cretOwnerPw';
  const dsnFor = (db: string) => `postgres://afldb_owner:${SECRET}@127.0.0.1:55432/${db}`;

  type StoredUser = {
    id: number; email: string; role: string;
    password_hash: string | null; totp_secret: string | null; totp_last_step: number | null;
    must_change_password: boolean; password_changed_at: string | null; can_manage_admins: boolean;
    disabled_at: string | null;
  };
  const attributionOnly = (id: number, over: Partial<StoredUser> = {}): StoredUser => ({
    id, email: EMAIL, role: 'super_admin', password_hash: null, totp_secret: null, totp_last_step: null,
    must_change_password: false, password_changed_at: null, can_manage_admins: false,
    disabled_at: '2026-09-25T00:00:00Z', ...over,
  });

  /** An in-memory auth_users with transaction semantics: `begin` restores the snapshot on throw. */
  function fakeDb(init: {
    database?: string; users?: StoredUser[]; sessions?: Record<number, number>; openInvites?: number;
    canInsert?: boolean; tamperInsert?: (u: StoredUser) => void;
  } = {}) {
    const state = { users: [...(init.users ?? [])].map((u) => ({ ...u })), nextId: 500 };
    const statements: Array<{ text: string; params: unknown[] }> = [];
    let writes = 0;
    const tx = ((strings: TemplateStringsArray, ...params: unknown[]) => {
      const text = strings.reduce((acc, s, i) => `${acc}${i ? `$${i}` : ''}${s}`, '').replace(/\s+/g, ' ').trim();
      statements.push({ text, params });
      if (text.startsWith('SELECT current_database()')) {
        return Promise.resolve([{ database: init.database ?? 'afldb_test', canInsert: init.canInsert ?? true }]);
      }
      if (text.includes('FROM admin_invites')) return Promise.resolve([{ openInvites: init.openInvites ?? 0 }]);
      if (text.includes('FROM auth_users u WHERE lower(u.email) = $1')) {
        return Promise.resolve(state.users
          .filter((u) => u.email.toLowerCase() === params[0])
          .sort((a, b) => a.id - b.id)
          .map((u) => ({
            id: u.id, email: u.email, role: u.role, disabled: u.disabled_at !== null,
            hasPassword: u.password_hash !== null, hasTotp: u.totp_secret !== null,
            hasTotpLastStep: u.totp_last_step !== null, mustChangePassword: u.must_change_password,
            hasPasswordChangedAt: u.password_changed_at !== null, canManageAdmins: u.can_manage_admins,
            sessions: init.sessions?.[u.id] ?? 0,
          })));
      }
      if (text.startsWith('INSERT INTO auth_users')) {
        const [email, role] = params as [string, string];
        if (state.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
          return Promise.reject(new Error('duplicate key value violates unique constraint "uq_auth_users_email_lower"'));
        }
        const id = state.nextId++;
        const u = attributionOnly(id, { email, role, disabled_at: 'now()' });
        init.tamperInsert?.(u); // what the readback sees; RETURNING still reports the inserted id
        state.users.push(u);
        writes += 1;
        return Promise.resolve([{ id }]);
      }
      return Promise.reject(new Error(`unexpected statement: ${text}`));
    }) as unknown as TransactionSql;
    const outcome = { committed: 0, rolledBack: 0 };
    const connect = (dsn: string) => {
      void dsn;
      return {
        begin: async <T>(fn: (t: TransactionSql) => Promise<T>): Promise<T> => {
          const snapshot = { users: state.users.map((u) => ({ ...u })), nextId: state.nextId };
          try {
            const r = await fn(tx);
            outcome.committed += 1;
            return r;
          } catch (error) {
            state.users = snapshot.users;
            state.nextId = snapshot.nextId;
            outcome.rolledBack += 1;
            throw error;
          }
        },
        end: async () => {},
      };
    };
    return { state, statements, outcome, connect, writes: () => writes };
  }
  const ARGV = ['--email', EMAIL, '--role', 'super_admin'];
  const ENV = { AFLDB_TEST_DATABASE_URL: dsnFor('afldb_test') };
  const run = (db: ReturnType<typeof fakeDb>, argv = ARGV, env: Record<string, string | undefined> = ENV) =>
    runEnsureRecoveryActor({ argv, env, connect: db.connect });

  it('refuses every target other than exactly afldb_test, from the DSN path and again from the live session', async () => {
    for (const name of ['afldb_dev', 'code_test_db', 'issue237_r1_restore', 'afldb_prod', 'afldb', 'afldb_test_2', 'random_test']) {
      const db = fakeDb();
      await expect(run(db, ARGV, { AFLDB_TEST_DATABASE_URL: dsnFor(name) }))
        .rejects.toThrow(new RegExp(`is '${name}'; the only recovery-actor target is 'afldb_test'`));
      expect(db.statements, name).toEqual([]); // refused before any connection
    }
    // a DSN that names afldb_test but lands elsewhere is refused by current_database(), before any read
    const moved = fakeDb({ database: 'afldb_dev' });
    await expect(run(moved)).rejects.toThrow(/live current_database\(\) is 'afldb_dev'/);
    expect(moved.statements).toHaveLength(1);
    expect(moved.outcome).toEqual({ committed: 0, rolledBack: 1 });
    // only AFLDB_TEST_DATABASE_URL is read: a development or importer variable is never a fallback
    const other = fakeDb();
    await expect(run(other, ARGV, { AFLDB_DATABASE_URL: dsnFor('afldb_test'), AFLDB_TEST_IMPORT_DATABASE_URL: dsnFor('afldb_test') }))
      .rejects.toThrow(/AFLDB_TEST_DATABASE_URL is not set/);
  });

  it('refuses a missing or malformed DSN before connecting', () => {
    expect(() => resolveRecoveryActorDsn({})).toThrow(/AFLDB_TEST_DATABASE_URL is not set/);
    expect(() => resolveRecoveryActorDsn({ AFLDB_TEST_DATABASE_URL: '   ' })).toThrow(/is not set/);
    expect(() => resolveRecoveryActorDsn({ AFLDB_TEST_DATABASE_URL: 'not a url' })).toThrow(/not a valid connection URL/);
    expect(resolveRecoveryActorDsn(ENV)).toBe(dsnFor('afldb_test'));
  });

  it('refuses an invalid email, an invalid role, and malformed arguments; normalises the email as create-admin.ts does', () => {
    for (const email of ['no-at-sign', 'a@b', 'two words@example.test', 'a@@example.test']) {
      expect(() => parseRecoveryActorArgs(['--email', email, '--role', 'super_admin']), email).toThrow(/not a valid email address/);
    }
    for (const role of ['owner', 'root', 'SUPER_ADMIN', 'superadmin']) {
      expect(() => parseRecoveryActorArgs(['--email', EMAIL, '--role', role]), role).toThrow(/not one auth_users.role allows/);
    }
    expect(() => parseRecoveryActorArgs([])).toThrow(RecoveryActorRefused);
    expect(() => parseRecoveryActorArgs(['--email', EMAIL])).toThrow(/--role is required/);
    expect(() => parseRecoveryActorArgs(['--role', 'admin'])).toThrow(/--email is required/);
    expect(() => parseRecoveryActorArgs(['--email', '--role', 'admin'])).toThrow(/--email needs a value/);
    expect(() => parseRecoveryActorArgs([...ARGV, '--role', 'admin'])).toThrow(/more than once/);
    expect(() => parseRecoveryActorArgs([...ARGV, '--apply'])).toThrow(/Unknown argument/);
    expect(parseRecoveryActorArgs(['--email', '  Issue224-Recovery@Example.TEST ', '--role', 'admin']))
      .toEqual({ email: EMAIL, role: 'admin' });
    // the role vocabulary is exactly auth_users_role_check (pinned against migration 033 above)
    for (const role of ['contributor', 'admin', 'super_admin']) {
      expect(parseRecoveryActorArgs(['--email', EMAIL, '--role', role]).role).toBe(role);
    }
  });

  it('creates one disabled, credential-free actor through the shared ISSUE-235 INSERT, reads it back, and commits', async () => {
    const db = fakeDb();
    const report = await run(db);
    expect(db.outcome).toEqual({ committed: 1, rolledBack: 0 });
    expect(db.state.users).toEqual([attributionOnly(500, { disabled_at: 'now()' })]);
    // exactly the ISSUE-235 statement; credentials are SQL literals, never parameters
    expect(db.statements.filter((s) => s.text.startsWith('INSERT'))).toEqual([{
      text: 'INSERT INTO auth_users (email, role, password_hash, totp_secret, disabled_at) VALUES ($1, $2, NULL, NULL, now()) RETURNING id',
      params: [EMAIL, 'super_admin'],
    }]);
    // order: prove target, invites, inspect, INSERT, readback; never an UPDATE, DELETE or session write
    expect(db.statements.map((s) => s.text.split(' ').slice(0, 2).join(' '))).toEqual([
      'SELECT current_database()', 'SELECT count(*)::int', 'SELECT u.id,', 'INSERT INTO', 'SELECT u.id,',
    ]);
    expect(db.statements.map((s) => s.text).join('\n')).not.toMatch(/\bUPDATE\b|\bDELETE\b|INSERT INTO auth_sessions/i);
    // the state query reads credential PRESENCE only, never a value
    for (const col of ['password_hash', 'totp_secret', 'totp_last_step', 'password_changed_at']) {
      expect(db.statements[2].text).toMatch(new RegExp(`u\\.${col} IS NOT NULL AS`));
    }
    expect(report).toBe([
      'AFLDB ISSUE-237 recovery attribution actor',
      '',
      'target database : afldb_test',
      `email           : ${EMAIL}`,
      'role            : super_admin',
      'enabled         : no',
      'password        : absent',
      'totp            : absent',
      '',
      'action          : CREATED',
      'admin_user_id   : 500',
      'writes          : 1',
      'transaction     : COMMITTED',
      'PASS',
    ].join('\n'));
  });

  it('is idempotent: a second identical run is ALREADY_SUITABLE, writes 0, and returns the same id', async () => {
    const db = fakeDb();
    await run(db);
    const before = db.statements.length;
    const second = await run(db);
    expect(db.writes()).toBe(1);
    expect(db.state.users).toHaveLength(1);
    expect(db.statements.slice(before).some((s) => /^(INSERT|UPDATE|DELETE)\b/.test(s.text))).toBe(false);
    expect(second).toContain('action          : ALREADY_SUITABLE');
    expect(second).toContain('admin_user_id   : 500');
    expect(second).toContain('writes          : 0');
    expect(second).toContain('transaction     : COMMITTED (no writes)');
    expect(second.endsWith('PASS')).toBe(true);
  });

  it('returns an exactly suitable pre-existing actor unchanged (email matched case-insensitively)', async () => {
    const db = fakeDb({ users: [attributionOnly(42)] });
    const report = await run(db, ['--email', 'ISSUE224-Recovery@example.test', '--role', 'super_admin']);
    expect(report).toContain('action          : ALREADY_SUITABLE');
    expect(report).toContain('admin_user_id   : 42');
    expect(db.writes()).toBe(0);
    expect(db.state.users).toEqual([attributionOnly(42)]);
  });

  it('STOPs, without modifying it, on an existing account that is enabled, credentialed, wrong-role or otherwise not identical', async () => {
    const cases: Array<[string, Partial<StoredUser>, RegExp, Record<number, number>?]> = [
      ['enabled', { disabled_at: null }, /it is enabled/],
      ['password', { password_hash: 'scrypt$x' }, /password credential/],
      ['totp', { totp_secret: 'JBSWY3DP' }, /TOTP credential/],
      ['totp counter', { totp_last_step: 1 }, /TOTP sign-in counter/],
      ['temporary password', { must_change_password: true }, /temporary-password flag/],
      ['password changed', { password_changed_at: '2026-01-01' }, /records a password change/],
      ['can_manage_admins', { can_manage_admins: true }, /can_manage_admins/],
      ['wrong role', { role: 'admin' }, /role is 'admin', not 'super_admin'/],
      ['mixed-case stored email', { email: 'Issue224-Recovery@example.test' }, /email is not exactly/],
      ['session', {}, /has 1 auth session/, { 42: 1 }],
    ];
    for (const [label, over, message, sessions] of cases) {
      const existing = attributionOnly(42, over);
      const db = fakeDb({ users: [existing], sessions });
      await expect(run(db), label).rejects.toThrow(message);
      await expect(run(db), label).rejects.toThrow(/STOP: auth_users 42 .*It was NOT modified; nothing was written/);
      expect(db.writes(), label).toBe(0);
      expect(db.state.users, label).toEqual([existing]);
      expect(db.statements.some((s) => /^(INSERT|UPDATE|DELETE)\b/.test(s.text)), label).toBe(false);
    }
  });

  it('STOPs on duplicate/conflicting email state: two case-variant rows, or an open admin invite', async () => {
    const dup = fakeDb({ users: [attributionOnly(42), attributionOnly(43, { email: 'Issue224-Recovery@Example.test' })] });
    await expect(run(dup)).rejects.toThrow(/STOP: 2 auth_users rows match/);
    expect(dup.writes()).toBe(0);
    // accepting an open invite would upsert credentials onto the row and clear disabled_at
    for (const users of [[], [attributionOnly(42)]]) {
      const invited = fakeDb({ users, openInvites: 1 });
      await expect(run(invited)).rejects.toThrow(/STOP: 1 open admin invite/);
      expect(invited.writes()).toBe(0);
    }
  });

  it('refuses to INSERT through a role without the privilege, before writing', async () => {
    const db = fakeDb({ canInsert: false });
    await expect(run(db)).rejects.toThrow(/cannot INSERT into auth_users; AFLDB_TEST_DATABASE_URL must be the afldb_test owner DSN/);
    expect(db.writes()).toBe(0);
  });

  it('rolls the INSERT back when the post-write readback does not meet the exact contract', async () => {
    const tampers: Array<[string, (u: StoredUser) => void, RegExp]> = [
      ['enabled', (u) => { u.disabled_at = null; }, /it is enabled/],
      ['password', (u) => { u.password_hash = 'x'; }, /password credential/],
      ['totp', (u) => { u.totp_secret = 'x'; }, /TOTP credential/],
      ['role', (u) => { u.role = 'admin'; }, /role is 'admin'/],
      ['can_manage_admins', (u) => { u.can_manage_admins = true; }, /can_manage_admins/],
      ['id mismatch', (u) => { u.id = 999; }, /not exactly auth_users 500/],
    ];
    for (const [label, tamperInsert, message] of tampers) {
      const db = fakeDb({ tamperInsert });
      await expect(run(db), label).rejects.toThrow(message);
      expect(db.outcome, label).toEqual({ committed: 0, rolledBack: 1 });
      expect(db.state.users, label).toEqual([]); // the rollback removed the row
    }
  });

  it('never populates a credential or auth-token field, and writes only through the shared ISSUE-235 helper', async () => {
    const db = fakeDb();
    await run(db);
    const [u] = db.state.users;
    expect([u.password_hash, u.totp_secret, u.totp_last_step, u.password_changed_at]).toEqual([null, null, null, null]);
    expect([u.must_change_password, u.can_manage_admins]).toEqual([false, false]);
    expect(db.statements.some((s) => /auth_sessions\s*\(|INSERT INTO admin_invites|beta_login_tokens/.test(s.text))).toBe(false);
    const source = readFileSync(join(root, 'tools', 'migration', 'ensure_issue237_recovery_actor.ts'), 'utf8');
    expect(source).toContain("import { insertAttributionOnlyActor } from './rebuild_afl_api_adjudications';");
    expect(source).not.toMatch(/INSERT INTO|UPDATE auth_users|from '\.\.\/admin\/create-admin'/);
    const helper = readFileSync(join(root, 'tools', 'migration', 'rebuild_afl_api_adjudications.ts'), 'utf8');
    // AFLDB-ISSUE-245 moved the ONE definition into rebuild_manual_registrations.ts (the
    // registration stage writes attribution actors too); this module re-exports it unchanged.
    const leaf = readFileSync(join(root, 'tools', 'migration', 'rebuild_manual_registrations.ts'), 'utf8');
    expect(leaf).toContain('export async function insertAttributionOnlyActor(tx: TransactionSql, actor: AttributionOnlyActor)');
    expect(leaf.match(/INSERT INTO auth_users/g)).toHaveLength(1);
    expect(helper).toContain('export { insertAttributionOnlyActor };');
    expect(helper).not.toMatch(/INSERT INTO auth_users/);
    // remapActors writes through the same helper, so the two cannot drift apart
    const remap = helper.slice(helper.indexOf('export async function remapActors('));
    expect(remap.slice(0, remap.indexOf('\n}\n'))).toContain('await insertAttributionOnlyActor(tx, actor)');
    expect(remap.slice(0, remap.indexOf('\n}\n'))).not.toContain('INSERT INTO');
  });

  it('never prints the DSN or its password, on success or on any refusal', async () => {
    const leaks = (text: string) => text.includes(SECRET) || text.includes('postgres://');
    expect(leaks(await run(fakeDb()))).toBe(false);
    const failures: Array<() => Promise<unknown>> = [
      () => run(fakeDb(), ARGV, { AFLDB_TEST_DATABASE_URL: dsnFor('afldb_dev') }),
      () => run(fakeDb(), ARGV, { AFLDB_TEST_DATABASE_URL: `x${SECRET}` }),
      () => run(fakeDb({ database: 'code_test_db' })),
      () => run(fakeDb({ users: [attributionOnly(42, { disabled_at: null })] })),
      () => run(fakeDb({ tamperInsert: (u) => { u.totp_secret = 'x'; } })),
    ];
    for (const f of failures) {
      const error = await f().then(() => null, (e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      expect(leaks(error!.message), error!.message).toBe(false);
    }
    // a driver error that quotes the connection string is redacted by the CLI's catch
    expect(leaks(redact(`connect failed for ${dsnFor('afldb_test')}`))).toBe(false);
    const source = readFileSync(join(root, 'tools', 'migration', 'ensure_issue237_recovery_actor.ts'), 'utf8');
    expect(source).toContain('console.error(`    REFUSED: ${redact((error as Error).message)}`);');
    expect(source.match(/console\.(log|error)\(/g)).toHaveLength(3);
  });

  it('is invoked through its own package script', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['db:issue237:ensure-recovery-actor']).toBe('tsx tools/migration/ensure_issue237_recovery_actor.ts');
  });
});

/*
 * AFLDB-ISSUE-245 — the manual/post-baseline player registrations carried through the
 * destructive rebuild, DB-free. A STATEFUL stand-in holds the slice of the database the
 * registration lifecycle touches (players by id, external identities, `players` data_overrides,
 * auth_users, admin invites, the database comment) and answers every statement the capture,
 * reinstate and verify stages — and ISSUE-237's real Stage 18 importer replay — issue, from that
 * state at the moment each runs. `replay_admin_overrides(players)` itself is Python and runs only
 * against a real database (the code_test_db rehearsal); here `pythonPlayersReplay()` models its
 * manual branch (tools/migration/common.py) statement for statement, so the TypeScript stages
 * around it are exercised against what it writes.
 */
describe('AFLDB-ISSUE-245 — manual player registrations survive the rebuild (DB-free)', () => {
  type Source = 'afltables' | 'manual_admin_edit' | 'afl_api';
  type Ident = {
    source: Source; externalId: string; playerId: number | null; status: string; matchMethod: string | null;
    candidateCount?: number; externalName?: string | null; externalUrl?: string | null; notes?: string | null;
  };
  type Override = {
    entityType: string; entityKey: string; fieldGroup: string; overrideValues: string; isActive: boolean;
    adminUserId: number; createdAt: string; updatedAt: string;
  };
  type User = { id: number; email: string; role: string };
  type World = {
    database: string; comment: string | null; tables: boolean; readOnly: boolean;
    players: number[]; identities: Ident[]; overrides: Override[]; users: User[]; invites: string[]; nextId: number;
  };

  const ACTOR = { id: 144, email: 'Recovery.Actor@Example.test', role: 'super_admin' };
  const CREATED = '2026-09-25T01:02:03.123456Z';
  const UPDATED = '2026-09-25T01:02:04.654321Z';

  /** PostgreSQL's own jsonb::text rendering: keys by length then bytes, `": "` and `", "`. */
  function jsonbText(value: Record<string, unknown>): string {
    const keys = Object.keys(value).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
    return `{${keys.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(value[k])}`).join(', ')}}`;
  }
  const tokenOf = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
  const pathOf = (i: number) => `players/R/Registered_Player${i}.html`;
  const payloadOf = (i: number, path: string | null = pathOf(i)) => jsonbText({
    display_name: `Registered Player${i}`, given_name: 'Registered', surname: `Player${i}`,
    notes: `AFLDB-ISSUE-224 S9 registration ${i}`, ...(path === null ? {} : { afltables_profile_path: path }),
  });

  /** An ISSUE-224-style pre-rebuild database: each registration is a manual player with its
   * token, its creation record, its attached AFL Tables path and (optionally) an importer row. */
  function preWorld(ids: number[], opts: { noPath?: number[]; importer?: boolean } = {}): World {
    const w: World = {
      database: 'afldb_test', comment: null, tables: true, readOnly: false,
      players: [], identities: [], overrides: [], users: [{ ...ACTOR }], invites: [], nextId: 20_000,
    };
    for (const i of ids) {
      const playerId = 13_856 + i; // the captured database's surrogates: audit only
      const path = opts.noPath?.includes(i) ? null : pathOf(i);
      w.players.push(playerId);
      w.identities.push({ source: 'manual_admin_edit', externalId: tokenOf(i), playerId, status: 'resolved', matchMethod: 'manual_admin_edit' });
      if (path) {
        w.identities.push({ source: 'afltables', externalId: path, playerId, status: 'resolved', matchMethod: 'afltables_profile_url' });
        if (opts.importer) {
          w.identities.push({ source: 'afl_api', externalId: `CD_I1${String(i).padStart(6, '0')}`, playerId, status: 'unique',
            matchMethod: 'afl_api_stat_vector_bootstrap', candidateCount: 1, externalUrl: null, externalName: null, notes: null });
        }
      }
      w.overrides.push({
        entityType: 'players', entityKey: `manual_admin_edit:${tokenOf(i)}`, fieldGroup: 'identity',
        overrideValues: payloadOf(i, path), isActive: true, adminUserId: ACTOR.id, createdAt: CREATED, updatedAt: UPDATED,
      });
    }
    return w;
  }

  /** The same target straight after `draftguru`'s predecessors: the reset destroyed everything,
   * fitzroy created only the source's players (`unique` AFL Tables rows), no auth_users. */
  function rebuiltWorld(sourcePlayers: Array<{ path: string; playerId: number }> = [], comment: string | null = null): World {
    return {
      database: 'afldb_test', comment, tables: true, readOnly: false,
      players: sourcePlayers.map((p) => p.playerId),
      identities: sourcePlayers.map((p) => ({ source: 'afltables' as const, externalId: p.path, playerId: p.playerId,
        status: 'unique', matchMethod: 'afltables_profile_url' })),
      overrides: [], users: [], invites: [], nextId: 90_000,
    };
  }

  const BINDABLE = new Set(['unique', 'resolved']);
  const bindable = (i: Ident, method: string) => i.playerId !== null && BINDABLE.has(i.status) && i.matchMethod === method;

  function fakeDb(w: World) {
    const statements: Array<{ text: string; params: unknown[] }> = [];
    const splitKey = (key: string) => [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    const answer = (text: string, params: unknown[]): unknown[] => {
      const write = /^(INSERT|UPDATE|DELETE)\b/.test(text);
      if (write && w.readOnly) throw new Error('cannot execute INSERT in a read-only transaction');
      if (text === 'SELECT current_database() AS actual') return [{ actual: w.database }];
      if (text.includes("shobj_description(oid, 'pg_database')")) return [{ comment: w.comment }];
      if (text.includes("current_setting('transaction_read_only')")) return [{ readOnly: w.readOnly ? 'on' : 'off' }];
      if (text.includes("to_regclass('public.data_overrides')")) return [{ overrides: w.tables, identities: w.tables, sources: w.tables }];
      // Stage 2's other two sections (observeCaptureState): no ledger table and no afl_api
      // source, so only the registration section is live in these scenarios.
      if (text.includes("to_regclass('public.afl_api_identity_adjudications')")) return [{ present: false }];
      if (text.includes("to_regclass('public.sources')")) return [{ sources: false, identities: false }];
      if (text.includes('FROM data_overrides o LEFT JOIN auth_users u')) {
        return w.overrides.filter((o) => o.entityType === 'players')
          .sort((a, b) => a.entityKey.localeCompare(b.entityKey) || a.fieldGroup.localeCompare(b.fieldGroup))
          .map((o) => {
            const u = w.users.find((x) => x.id === o.adminUserId);
            return { entityKey: o.entityKey, fieldGroup: o.fieldGroup, isActive: o.isActive, overrideValues: o.overrideValues,
              createdAt: o.createdAt, updatedAt: o.updatedAt, adminUserId: o.adminUserId,
              adminEmail: u?.email ?? null, adminRole: u?.role ?? null };
          });
      }
      if (text.includes('SELECT DISTINCT o.entity_key AS "entityKey"')) {
        return w.overrides.filter((o) => o.entityType === 'players' && o.isActive && splitKey(o.entityKey)[0] !== 'manual_admin_edit')
          .flatMap((o) => {
            const [ns, ext] = splitKey(o.entityKey);
            return w.identities.filter((i) => i.source === ns && i.externalId === ext && i.playerId !== null && BINDABLE.has(i.status))
              .map((i) => ({ entityKey: o.entityKey, fieldGroup: o.fieldGroup, playerId: i.playerId }));
          });
      }
      if (text.includes('count(*)::int AS "manualOverrideRows"')) {
        return [{ manualOverrideRows: w.overrides.filter((o) => o.entityType === 'players' && splitKey(o.entityKey)[0] === 'manual_admin_edit').length }];
      }
      const row = (i: Ident) => ({ externalId: i.externalId, playerId: i.playerId, status: i.status, matchMethod: i.matchMethod });
      if (text.includes('WHERE s.key = $1') && params[0] === 'manual_admin_edit') {
        return w.identities.filter((i) => i.source === 'manual_admin_edit').map(row);
      }
      if (text.includes('e.player_id = ANY ($1::int[]) OR e.external_id = ANY ($2::text[])')) {
        const [ids, paths] = params as [number[], string[]];
        return w.identities.filter((i) => i.source === 'afltables'
          && ((i.playerId !== null && ids.includes(i.playerId)) || paths.includes(i.externalId))).map(row);
      }
      if (text.includes("s.key = 'afltables' AND e.external_id = ANY ($1::text[])")) {
        return w.identities.filter((i) => i.source === 'afltables' && (params[0] as string[]).includes(i.externalId)).map(row);
      }
      if (text.startsWith('SELECT id, email, role FROM auth_users')) {
        return w.users.filter((u) => (params[0] as string[]).includes(u.email.toLowerCase())).map((u) => ({ ...u }));
      }
      if (text.includes('FROM admin_invites')) {
        return w.invites.filter((e) => (params[0] as string[]).includes(e.toLowerCase())).map((email) => ({ email }));
      }
      if (text.startsWith('INSERT INTO auth_users')) {
        const id = w.nextId++;
        w.users.push({ id, email: params[0] as string, role: params[1] as string });
        return [{ id }];
      }
      if (text.startsWith('INSERT INTO data_overrides')) {
        const [entityKey, fieldGroup, overrideValues, adminUserId, createdAt, updatedAt] = params as [string, string, string, number, string, string];
        if (w.overrides.some((o) => o.entityType === 'players' && o.entityKey === entityKey && o.fieldGroup === fieldGroup)) {
          throw new Error('duplicate key value violates unique constraint "data_overrides_uq"');
        }
        w.overrides.push({ entityType: 'players', entityKey, fieldGroup, overrideValues, isActive: true, adminUserId, createdAt, updatedAt });
        return [];
      }
      if (text.startsWith('SELECT entity_key AS "entityKey", override_values::text AS "overrideValues"')) {
        return w.overrides.filter((o) => o.entityType === 'players' && o.fieldGroup === 'identity' && o.isActive
            && splitKey(o.entityKey)[0] === 'manual_admin_edit')
          .sort((a, b) => a.entityKey.localeCompare(b.entityKey))
          .map((o) => ({ entityKey: o.entityKey, overrideValues: o.overrideValues, createdAt: o.createdAt,
            updatedAt: o.updatedAt, adminUserId: o.adminUserId }));
      }
      // ISSUE-237's Stage 18 importer replay (replayAflApiImporterRows), unchanged.
      if (text.includes("SELECT id FROM sources WHERE key = 'afl_api'")) return [{ id: 1 }];
      if (text.includes('SELECT DISTINCT ei.player_id AS "playerId"')) {
        return [...new Set(w.identities.filter((i) => i.externalId === params[0]
          && ((i.source === 'afltables' && bindable(i, 'afltables_profile_url'))
              || (i.source === 'manual_admin_edit' && bindable(i, 'manual_admin_edit'))))
          .map((i) => i.playerId as number))].map((playerId) => ({ playerId }));
      }
      if (text.includes('FROM external_identities WHERE source_id = $1')) {
        return w.identities.filter((i) => i.source === 'afl_api').map((i) => ({
          externalId: i.externalId, status: i.status, matchMethod: i.matchMethod, playerId: i.playerId,
          candidateCount: i.candidateCount ?? 1, externalUrl: i.externalUrl ?? null }));
      }
      if (text.startsWith('INSERT INTO external_identities')) {
        const [, externalId, playerId, matchMethod, externalName, externalUrl, notes] =
          params as [number, string, number, string, string | null, string | null, string | null];
        if (w.identities.some((i) => i.source === 'afl_api' && i.externalId === externalId)) throw new Error(`duplicate key: ${externalId}`);
        w.identities.push({ source: 'afl_api', externalId, playerId, status: 'unique', matchMethod, candidateCount: 1,
          externalName, externalUrl, notes });
        return [];
      }
      throw new Error(`AFLDB-ISSUE-245 fake: unmodelled statement: ${text}`);
    };
    const tx = (strings: unknown, ...params: unknown[]) => {
      if (!(Array.isArray(strings) && 'raw' in strings)) return { identifier: strings };
      const text = (strings as string[]).reduce((acc, s, i) => `${acc}${i ? `$${i}` : ''}${s}`, '').replace(/\s+/g, ' ').trim();
      statements.push({ text, params });
      try {
        return Promise.resolve(answer(text, params));
      } catch (error) {
        return Promise.reject(error);
      }
    };
    Object.assign(tx, { array: (values: unknown[]) => values });
    return { tx: tx as unknown as TransactionSql, statements };
  }
  const writes = (statements: Array<{ text: string }>) => statements.filter((s) => /^(INSERT|UPDATE|DELETE)\b/.test(s.text));

  /**
   * `replay_admin_overrides(players)`'s manual branch (tools/migration/common.py), modelled
   * exactly: every ACTIVE creation record whose token names no player is re-created — bound to
   * the one source player already holding its AFL Tables path, or a new player whose path
   * identity is registered unless ANY afltables row already carries the path.
   */
  function pythonPlayersReplay(w: World): void {
    const manual = w.overrides.filter((o) => o.entityType === 'players' && o.isActive && o.entityKey.startsWith('manual_admin_edit:'))
      .sort((a, b) => a.entityKey.localeCompare(b.entityKey));
    for (const o of manual) {
      const token = o.entityKey.slice('manual_admin_edit:'.length);
      if (w.identities.some((i) => i.source === 'manual_admin_edit' && i.externalId === token && i.playerId !== null)) continue;
      const path = (JSON.parse(o.overrideValues) as { afltables_profile_path?: string | null }).afltables_profile_path ?? null;
      const holders = w.identities.filter((i) => i.source === 'afltables' && i.externalId === path && bindable(i, 'afltables_profile_url'))
        .map((i) => i.playerId as number);
      if (new Set(holders).size > 1) throw new Error('replay_admin_overrides(players): afltables_profile_path resolves to more than one player');
      const bound = holders.length > 0 ? Math.min(...holders) : null;
      let playerId = bound;
      if (playerId === null) {
        playerId = w.nextId++;
        w.players.push(playerId);
      }
      w.identities.push({ source: 'manual_admin_edit', externalId: token, playerId, status: 'resolved', matchMethod: 'manual_admin_edit' });
      if (path && bound === null && !w.identities.some((i) => i.source === 'afltables' && i.externalId === path)) {
        w.identities.push({ source: 'afltables', externalId: path, playerId, status: 'resolved', matchMethod: 'afltables_profile_url' });
      }
    }
  }

  const importerRowFor = (i: number, playerId: number): CapturedImporterRow => ({
    externalId: `CD_I1${String(i).padStart(6, '0')}`, playerIdentity: pathOf(i), matchMethod: 'afl_api_stat_vector_bootstrap',
    status: 'unique', candidateCount: 1, externalName: null, externalUrl: null, notes: null, playerId,
  });

  /** Stage 2's registration section, read from the live world exactly as the capture reads it. */
  async function captureOf(w: World, importerRows: CapturedImporterRow[] = []): Promise<CombinedCapture> {
    const live = registrationsFromLive(await readLiveRegistrationState(fakeDb(w).tx));
    expect(live.problems).toEqual([]);
    return buildCombinedCapture({
      database: 'afldb_test', capturedAt: '2026-09-25T10:00:00.000Z', ledgerTablePresent: true,
      ledgerRows: [], importerRows, registrations: live.registrations,
    });
  }
  const markerFor = (c: CombinedCapture) => JSON.stringify({
    format: CAPTURE_FORMAT, version: CAPTURE_VERSION, capturedAt: c.capturedAt,
    payloadSha256: c.payloadSha256, fileSha256: 'd'.repeat(64),
  });

  /** Stages 17 -> 18 -> 19 on the rebuilt world. */
  async function reinstateReplayVerify(c: CombinedCapture, w: World) {
    w.comment = markerFor(c);
    const reinstate = fakeDb(w);
    const report = await reinstateRegistrationsStage(reinstate.tx, c);
    pythonPlayersReplay(w);
    w.readOnly = true;
    try {
      await verifyRegistrationsStage(fakeDb(w).tx, c);
    } finally {
      w.readOnly = false;
    }
    return { report, statements: reinstate.statements };
  }

  const playerFor = (w: World, source: Source, externalId: string) =>
    w.identities.filter((i) => i.source === source && i.externalId === externalId).map((i) => i.playerId);

  // -------------------------------------------------------------------------
  // The stage graph
  // -------------------------------------------------------------------------

  const stages = planStages(target(), fitzroy(), OPTS);
  const ids = idsOf(stages);
  const stage = (id: string) => stages.find((s) => s.id === id)!;
  const TRIO = ['manual-registrations-reinstate', 'manual-registrations-replay', 'manual-registrations-verify'];

  it('stage ordering: capture -> reset -> fitzroy … -> registrations (reinstate, replay, verify) -> draftguru -> ISSUE-237/235 replay -> invariant', () => {
    const at = (id: string) => ids.indexOf(id);
    expect(ids.slice(at(TRIO[0]), at(TRIO[0]) + 3)).toEqual(TRIO);
    expect(at('afl-api-adjudications-capture')).toBeLessThan(at('recreate'));
    for (const source of ['fitzroy', 'heights', 'birth-dates', 'coaches', 'father-son', 'siblings', 'after-siren', 'after-siren-reconcile']) {
      expect(at(source), source).toBeLessThan(at(TRIO[0]));
    }
    // before draftguru, whose manual/bridge targets must already exist, and so before Stage 18
    expect(at('draftguru')).toBe(at(TRIO[2]) + 1);
    expect(at('afl-api-adjudications-reinstate')).toBeGreaterThan(at(TRIO[2]));
    expect(at('afl-api-adjudications-bijection')).toBe(at('afl-api-adjudications-reinstate') + 1);
    // still exactly one destructive stage
    expect(stages.filter((s) => s.kind === 'destructive').map((s) => s.id)).toEqual(['recreate']);
  });

  it('each registration stage has its own kind, argv and target-bound environment; the replay is the production Python function', () => {
    expect(stage(TRIO[0])).toMatchObject({ kind: 'reinstate', run: 'command',
      argv: ['npx', 'tsx', AFL_API_ADJUDICATION_TOOL, 'registrations-reinstate'],
      envOverlay: { [AFL_API_ADJUDICATION_TARGET_ENV]: 'afldb_test', [AFL_API_ADJUDICATION_DSN_ENV]: OWNER } });
    expect(stage(TRIO[1])).toMatchObject({ kind: 'data', run: 'command', argv: [resolvePython(), MANUAL_REGISTRATION_REPLAY],
      envOverlay: { AFLDB_IMPORT_DATABASE_URL: IMPORT, [AFL_API_ADJUDICATION_TARGET_ENV]: 'afldb_test' } });
    expect(stage(TRIO[1]).envOverlay?.[AFL_API_ADJUDICATION_DSN_ENV]).toBeUndefined();
    expect(stage(TRIO[2])).toMatchObject({ kind: 'validation', run: 'command',
      argv: ['npx', 'tsx', AFL_API_ADJUDICATION_TOOL, 'registrations-verify'],
      envOverlay: { [AFL_API_ADJUDICATION_TARGET_ENV]: 'afldb_test', [AFL_API_ADJUDICATION_DSN_ENV]: OWNER } });

    const py = readFileSync(join(root, MANUAL_REGISTRATION_REPLAY), 'utf8');
    expect(py).toContain('replay_admin_overrides(pg, "players")');
    // one executable call, one table (the docstring names it too)
    expect(py.match(/^ {8}replay_admin_overrides\(pg, "players"\)$/gm)).toHaveLength(1);
    expect(py.match(/^\s+replay_admin_overrides\(/gm)).toHaveLength(1);
    expect(py).toContain('REBUILD_TARGETS = ("afldb_test", "code_test_db")');
    expect(py).toMatch(/if database != target:[\s\S]*raise RuntimeError/);
    expect(py).not.toMatch(/INSERT INTO|UPDATE |DELETE FROM/);
    // the production function still re-creates AND binds (the semantics this rebuild relies on)
    const common = readFileSync(join(root, 'tools', 'migration', 'common.py'), 'utf8');
    expect(common).toContain('Bind the token onto that row instead of creating a twin.');
    expect(common).toContain("if afl_path and bound_player_id is None:");
  });

  it('a failed registration stage stops everything after it; the marker is only ever cleared by Stage 18', () => {
    for (const [failAt, failed] of [
      [`${AFL_API_ADJUDICATION_TOOL} registrations-reinstate`, TRIO[0]],
      [MANUAL_REGISTRATION_REPLAY, TRIO[1]],
      [`${AFL_API_ADJUDICATION_TOOL} registrations-verify`, TRIO[2]],
    ] as const) {
      const { deps } = fakeDeps(failAt);
      const report = executeRebuild(stages, target(), deps);
      expect(report.failedStage).toBe(failed);
      for (const later of ['draftguru', 'afl-api-adjudications-reinstate', 'afl-api-adjudications-bijection', 'fingerprints']) {
        expect(report.executed, `${failed} -> ${later}`).not.toContain(later);
      }
    }
    const tool = readFileSync(join(root, AFL_API_ADJUDICATION_TOOL), 'utf8');
    const stageFns = tool.slice(tool.indexOf('export async function reinstateRegistrationsStage('),
      tool.indexOf('function readRequiredPendingCapture('));
    expect(stageFns).not.toMatch(/clearRebuildMarker|setRebuildMarker|archivePendingCapture/);
    expect(tool.match(/clearRebuildMarker\(tx, capture\.database\)/g)).toHaveLength(1); // Stage 18 only
  });

  it('the final `players` gate counts the source\'s players only: a replay-created registration path is excluded, a bound one is not', () => {
    const sql = finalValidationSql();
    expect(sql).toContain(`AND NOT (${REGISTRATION_CREATED_AFLTABLES_IDENTITY_SQL})`);
    expect(REGISTRATION_CREATED_AFLTABLES_IDENTITY_SQL).toContain("ei.status = 'resolved'");
    expect(REGISTRATION_CREATED_AFLTABLES_IDENTITY_SQL).toContain("o.override_values->>'afltables_profile_path' = ei.external_id");
    expect(REGISTRATION_CREATED_AFLTABLES_IDENTITY_SQL).toContain('m.player_id = ei.player_id');
    // the source writes 'unique' and never 'resolved' (so a BOUND registration stays counted),
    // and the replay's created path identity is 'resolved'
    const importer = readFileSync(join(root, 'tools', 'migration', 'import_fitzroy_core.py'), 'utf8');
    expect(importer).toContain("VALUES (%s, %s, %s, %s, 'unique', %s, %s)");
    const common = readFileSync(join(root, 'tools', 'migration', 'common.py'), 'utf8');
    expect(common).toMatch(/'https:\/\/afltables\.com\/afl\/stats\/' \|\| %\(path\)s, %\(player_id\)s,\s*'resolved', 0, 'afltables_profile_url'/);
  });

  it('the profile-path rule is the admin surface\'s own', () => {
    const adminDraft = readFileSync(join(root, 'src', 'db', 'queries', 'admin-draft.ts'), 'utf8');
    expect(adminDraft).toContain(`export const AFLTABLES_PROFILE_PATH_RE = /${REGISTRATION_PROFILE_PATH_RE.source}/;`);
  });

  // -------------------------------------------------------------------------
  // Required cases 1–22
  // -------------------------------------------------------------------------

  it('1. an empty registration capture is valid, and reinstating it issues no statement', async () => {
    expect(registrationsFromLive(EMPTY_LIVE_REGISTRATION_STATE)).toEqual({ registrations: [], problems: [] });
    // a reset database (no data_overrides relation) reads as empty
    const reset = rebuiltWorld();
    reset.tables = false;
    expect(await readLiveRegistrationState(fakeDb(reset).tx)).toEqual(EMPTY_LIVE_REGISTRATION_STATE);
    const c = await captureOf(preWorld([]));
    expect(c.registrations).toEqual([]);
    const dir = mkdtempSync(join(tmpdir(), 'afldb-i245-'));
    try {
      writePendingCapture(dir, c);
      expect(readPendingCapture(dir, 'afldb_test')).toEqual(c);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const { tx, statements } = fakeDb(rebuiltWorld());
    expect(await reinstateManualRegistrations(tx, [])).toEqual({ registrations: 0, creates: 0, binds: 0, actorsReused: 0, actorsCreated: 0 });
    expect(statements).toEqual([]);
  });

  it('2/4/5/6/7/8. one registration round-trips: new players.id, same token, same AFL Tables path, same creation record bytes, recreated actor', async () => {
    const pre = preWorld([1]);
    const c = await captureOf(pre);
    expect(c.registrations).toHaveLength(1);
    const [r] = c.registrations;
    expect(r).toMatchObject({ token: tokenOf(1), afltablesProfilePath: pathOf(1), overrideValues: payloadOf(1),
      createdAt: CREATED, updatedAt: UPDATED, adminEmail: ACTOR.email, adminRole: 'super_admin', playerId: 13_857, adminUserId: 144 });

    // the hashed file round-trips byte for byte
    const dir = mkdtempSync(join(tmpdir(), 'afldb-i245-'));
    try {
      writePendingCapture(dir, c);
      expect(readPendingCapture(dir, 'afldb_test')).toEqual(c);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    const post = rebuiltWorld([{ path: 'players/A/Source_Player.html', playerId: 1 }]);
    const { report, statements } = await reinstateReplayVerify(c, post);
    expect(report).toEqual({ registrations: 1, creates: 1, binds: 0, actorsReused: 0, actorsCreated: 1 });

    // 4/5/6: the token and the path name ONE player — a new surrogate, never 13857
    const [newId] = playerFor(post, 'manual_admin_edit', tokenOf(1));
    expect(newId).not.toBe(13_857);
    expect(playerFor(post, 'afltables', pathOf(1))).toEqual([newId]);
    // 7: the creation record is back byte for byte, both timestamps included
    const record = post.overrides.find((o) => o.entityKey === `manual_admin_edit:${tokenOf(1)}`)!;
    expect(record).toMatchObject({ overrideValues: payloadOf(1), createdAt: CREATED, updatedAt: UPDATED, isActive: true, fieldGroup: 'identity' });
    const insert = statements.find((s) => s.text.startsWith('INSERT INTO data_overrides'))!;
    expect(insert.text).toContain('$3::text::jsonb');
    expect(insert.text).toContain('$5::text::timestamptz, $6::text::timestamptz');
    expect(insert.params[2]).toBe(payloadOf(1)); // the captured text itself, never re-serialised
    // 8: an attribution-only actor with the CAPTURED email and role, no credential of any kind
    expect(post.users).toEqual([{ id: record.adminUserId, email: ACTOR.email, role: 'super_admin' }]);
    const actorInsert = statements.find((s) => s.text.startsWith('INSERT INTO auth_users'))!;
    expect(actorInsert.text).toBe('INSERT INTO auth_users (email, role, password_hash, totp_secret, disabled_at) VALUES ($1, $2, NULL, NULL, now()) RETURNING id');
    expect(statements.map((s) => s.text).join('\n')).not.toMatch(/auth_sessions|can_manage_admins|UPDATE|DELETE/);
    // and a re-capture of the rebuilt world is the same section, surrogates aside
    const again = registrationsFromLive(await readLiveRegistrationState(fakeDb(post).tx));
    expect(again.problems).toEqual([]);
    expect(sameRegistrations(again.registrations, c.registrations)).toBe(true);
    expect(again.registrations[0].playerId).toBe(newId);
  });

  it('3. many registrations round-trip, with and without an AFL Tables path', async () => {
    const pre = preWorld([1, 2, 3, 4], { noPath: [3] });
    const c = await captureOf(pre);
    expect(c.registrations.map((r) => r.afltablesProfilePath)).toEqual([pathOf(1), pathOf(2), null, pathOf(4)]);
    const post = rebuiltWorld();
    const { report } = await reinstateReplayVerify(c, post);
    expect(report).toMatchObject({ registrations: 4, creates: 4, binds: 0, actorsCreated: 1 });
    const newIds = [1, 2, 3, 4].map((i) => playerFor(post, 'manual_admin_edit', tokenOf(i))[0]);
    expect(new Set(newIds).size).toBe(4);
    expect(playerFor(post, 'afltables', pathOf(3))).toEqual([]); // no path, none invented
  });

  it('9. actors: a matching account is reused untouched; a conflicting (credentialed or not) role, a duplicate email or an open invite STOPS before any write', async () => {
    const c = await captureOf(preWorld([1]));
    const [r] = c.registrations;
    // reused as it is: same role, whatever credentials it holds
    expect(planRegistrationActors([r], [{ id: 7, email: 'recovery.actor@example.TEST', role: 'super_admin' }], []))
      .toEqual({ reuse: new Map([['recovery.actor@example.test', 7]]), create: [] });
    expect(planRegistrationActors([r], [], [])).toEqual({ reuse: new Map(), create: [{ email: ACTOR.email, role: 'super_admin' }] });
    const refusals: Array<[Parameters<typeof planRegistrationActors>[1], string[], RegExp]> = [
      [[{ id: 7, email: ACTOR.email, role: 'admin' }], [], /conflicting actor state: auth_users 7 holds .* in role 'admin', the capture records 'super_admin'; it is never overwritten or downgraded/],
      [[{ id: 7, email: ACTOR.email, role: 'super_admin' }, { id: 8, email: ACTOR.email.toUpperCase(), role: 'super_admin' }], [], /matches 2 auth_users rows/],
      [[], [ACTOR.email.toUpperCase()], /open admin invite exists/],
    ];
    for (const [existing, invites, pattern] of refusals) {
      expect(() => planRegistrationActors([r], existing, invites)).toThrow(pattern);
    }
    // through the stage: a credentialed account in another role refuses, and NOTHING is written
    const post = rebuiltWorld();
    post.users.push({ id: 5, email: 'recovery.actor@example.test', role: 'contributor' });
    post.comment = markerFor(c);
    const db = fakeDb(post);
    await expect(reinstateRegistrationsStage(db.tx, c)).rejects.toThrow(RegistrationRebuildRefused);
    expect(writes(db.statements)).toEqual([]);
    expect(post.users).toEqual([{ id: 5, email: 'recovery.actor@example.test', role: 'contributor' }]);
    // a ledger actor and a registration actor with one email but two roles is refused in the capture
    const ledgerActor: CapturedLedgerRow = {
      id: 1, sourceKey: 'afl_api', externalId: 'CD_I1001', action: 'linked', playerId: 9, playerIdentity: 'players/A/A.html',
      previousState: null, evidence: '{}', evidenceSha256: 'a'.repeat(64), surnameDisagreementAcknowledged: false,
      supersedesId: null, adminUserId: 3, adminEmail: ACTOR.email.toLowerCase(), adminRole: 'admin', note: '', createdAt: CREATED,
    };
    expect(() => buildCombinedCapture({ database: 'afldb_test', capturedAt: 'x', ledgerTablePresent: true,
      ledgerRows: [ledgerActor], importerRows: [], registrations: [r] })).toThrow(/conflicting actor state/);
  });

  it('10/11. a duplicate manual token, a token naming two players, or two registrations claiming one AFL Tables path refuses', async () => {
    const c = await captureOf(preWorld([1, 2]));
    const [a, b] = c.registrations;
    expect(registrationCaptureStructureProblems([a, { ...a }]).join('; ')).toMatch(/duplicate manual identity token/);
    expect(registrationCaptureStructureProblems([a, { ...b, afltablesProfilePath: pathOf(1), overrideValues: payloadOf(2, pathOf(1)) }]).join('; '))
      .toMatch(/AFL Tables path players\/R\/Registered_Player1\.html is also claimed by registration/);
    expect(() => buildCombinedCapture({ database: 'afldb_test', capturedAt: 'x', ledgerTablePresent: true, ledgerRows: [],
      importerRows: [], registrations: [a, { ...a }] })).toThrow(/duplicate manual identity token/);

    // live: one token naming two players
    const twoPlayers = preWorld([1]);
    twoPlayers.identities.push({ source: 'manual_admin_edit', externalId: tokenOf(1), playerId: 999, status: 'resolved', matchMethod: 'manual_admin_edit' });
    expect(registrationsFromLive(await readLiveRegistrationState(fakeDb(twoPlayers).tx)).problems.join('; '))
      .toMatch(/the manual identity resolves to 2 players/);
    // live: two creation records naming one path
    const onePath = preWorld([1, 2]);
    onePath.overrides[1].overrideValues = payloadOf(2, pathOf(1));
    expect(registrationsFromLive(await readLiveRegistrationState(fakeDb(onePath).tx)).problems.join('; '))
      .toMatch(/attached to a different player|also claimed by registration/);
    // replay-time: a rebuilt database that already holds the token is a duplicate manual identity
    const post = rebuiltWorld();
    post.identities.push({ source: 'manual_admin_edit', externalId: tokenOf(1), playerId: 5, status: 'resolved', matchMethod: 'manual_admin_edit' });
    post.comment = markerFor(c);
    const db = fakeDb(post);
    await expect(reinstateRegistrationsStage(db.tx, c)).rejects.toThrow(/duplicate manual identity — the rebuilt database already holds it/);
    expect(writes(db.statements)).toEqual([]);
  });

  it('12. every unsupported or unreplayable shape refuses BEFORE the reset (Stage 2), nothing destroyed', async () => {
    const mutate: Array<[string, (w: World) => void, RegExp]> = [
      ['another field group', (w) => { w.overrides[0].fieldGroup = 'name'; }, /unsupported override shape/],
      ['inactive record', (w) => { w.overrides[0].isActive = false; }, /creation record is inactive/],
      ['unknown key', (w) => { w.overrides[0].overrideValues = jsonbText({ display_name: 'X', debut_club: 'x', afltables_profile_path: pathOf(1) }); }, /unsupported override key\(s\): debut_club/],
      ['no display_name', (w) => { w.overrides[0].overrideValues = jsonbText({ surname: 'X', afltables_profile_path: pathOf(1) }); }, /no display_name/],
      ['dob with no confidence', (w) => { w.overrides[0].overrideValues = jsonbText({ display_name: 'X', dob: '2006-01-02', afltables_profile_path: pathOf(1) }); }, /dob is set with no dob_confidence/],
      ['a malformed path', (w) => { w.overrides[0].overrideValues = jsonbText({ display_name: 'X', afltables_profile_path: 'players/x' }); }, /not an AFL Tables profile path/],
      ['no resolvable identity', (w) => { w.identities = w.identities.filter((i) => i.source !== 'manual_admin_edit'); }, /no resolvable stable registration identity/],
      ['an actor that cannot be recreated', (w) => { w.users = []; }, /its actor has no resolvable email/],
      ['a manual identity with no creation record (the ISSUE-245 loss itself)', (w) => { w.overrides = []; }, /has no active 'identity' creation record: the rebuild would destroy that player/],
      ['a later correction of a registered player', (w) => {
        w.overrides.push({ entityType: 'players', entityKey: `afltables:${pathOf(1)}`, fieldGroup: 'dob',
          overrideValues: jsonbText({ dob: '2006-01-02' }), isActive: true, adminUserId: 144, createdAt: CREATED, updatedAt: UPDATED });
      }, /correction override afltables:players\/R\/Registered_Player1\.html \(dob\) targets registered player/],
    ];
    for (const [label, change, pattern] of mutate) {
      const w = preWorld([1]);
      change(w);
      const db = fakeDb(w);
      const state = await observeCaptureState(db.tx, { database: 'afldb_test', dir: tmpdir(), pendingInfo: null, recover: false })
        .then(() => 'captured', (error: Error) => error.message);
      expect(state, label).toMatch(/AFLDB-ISSUE-245: \d+ manual player registration problem\(s\) before destruction, nothing has been destroyed/);
      expect(state, label).toMatch(pattern);
      expect(writes(db.statements), label).toEqual([]);
    }
    // and a pre-ISSUE-245 (v1) combined capture file is refused by name, never read as "no registrations"
    const dir = mkdtempSync(join(tmpdir(), 'afldb-i245-'));
    try {
      writeFileSync(join(dir, PENDING_CAPTURE_FILE), JSON.stringify({ format: CAPTURE_FORMAT, version: 1, database: 'afldb_test',
        capturedAt: 'x', ledgerTablePresent: true, ledgerRows: [], importerRows: [], payloadSha256: 'f'.repeat(64) }));
      expect(() => readPendingCapture(dir, 'afldb_test')).toThrow(/pre-AFLDB-ISSUE-245 combined format \(v1\).*never upgraded/s);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('13. source-owned convergence: a registered player now in the accepted source is BOUND to the source player — no duplicate', async () => {
    const c = await captureOf(preWorld([1, 2]));
    // the new baseline carries player 1's path: fitzroy created them as source player 4242
    const post = rebuiltWorld([{ path: pathOf(1), playerId: 4242 }]);
    const plan = planRegistrationReplay(c.registrations, { manualOverrideRows: 0, manualIdentities: [], afltablesForPaths: post.identities.map((i) => ({
      externalId: i.externalId, playerId: i.playerId, status: i.status, matchMethod: i.matchMethod })) });
    expect(plan.binds).toEqual([{ token: tokenOf(1), path: pathOf(1), playerId: 4242 }]);
    expect(plan.creates).toEqual([{ token: tokenOf(2), path: pathOf(2) }]);

    const before = post.players.length;
    const { report } = await reinstateReplayVerify(c, post);
    expect(report).toMatchObject({ creates: 1, binds: 1 });
    expect(playerFor(post, 'manual_admin_edit', tokenOf(1))).toEqual([4242]);
    expect(playerFor(post, 'afltables', pathOf(1))).toEqual([4242]); // the SOURCE row, still 'unique', no twin
    expect(post.identities.filter((i) => i.externalId === pathOf(1))).toEqual([
      { source: 'afltables', externalId: pathOf(1), playerId: 4242, status: 'unique', matchMethod: 'afltables_profile_url' }]);
    expect(post.players.length).toBe(before + 1); // only player 2 is new
  });

  it('14. source identity disagreement refuses — before the reset, and again before any reinstatement write', async () => {
    // capture: the path belongs to another player, or the player holds a path the record does not carry
    const taken = preWorld([1]);
    taken.identities.find((i) => i.source === 'afltables')!.playerId = 777;
    expect(registrationsFromLive(await readLiveRegistrationState(fakeDb(taken).tx)).problems.join('; '))
      .toMatch(/attached to a different player or is not a bindable identity/);
    const extra = preWorld([1]);
    extra.identities.push({ source: 'afltables', externalId: 'players/O/Other_Path.html', playerId: 13_857, status: 'unique', matchMethod: 'afltables_profile_url' });
    expect(registrationsFromLive(await readLiveRegistrationState(fakeDb(extra).tx)).problems.join('; '))
      .toMatch(/holds AFL Tables identity players\/O\/Other_Path\.html that the creation record does not carry/);
    const unrecorded = preWorld([1]);
    unrecorded.overrides[0].overrideValues = payloadOf(1, null);
    expect(registrationsFromLive(await readLiveRegistrationState(fakeDb(unrecorded).tx)).problems.join('; '))
      .toMatch(/that the creation record does not carry/);

    // replay: the rebuilt source disagrees about the path
    const c = await captureOf(preWorld([1, 2]));
    const replayCases: Array<[string, Ident[], RegExp]> = [
      ['held by two source players', [
        { source: 'afltables', externalId: pathOf(1), playerId: 4242, status: 'unique', matchMethod: 'afltables_profile_url' },
        { source: 'afltables', externalId: pathOf(1), playerId: 4243, status: 'unique', matchMethod: 'afltables_profile_url' }],
      /resolves to 2 source players/],
      ['held by a non-bindable row', [
        { source: 'afltables', externalId: pathOf(1), playerId: null, status: 'ambiguous', matchMethod: 'afltables_profile_url' }],
      /not a bindable afltables_profile_url identity; the replay would attach nothing/],
      ['two registrations converging on one source player', [
        { source: 'afltables', externalId: pathOf(1), playerId: 4242, status: 'unique', matchMethod: 'afltables_profile_url' },
        { source: 'afltables', externalId: pathOf(2), playerId: 4242, status: 'unique', matchMethod: 'afltables_profile_url' }],
      /would both bind to source player 4242/],
    ];
    for (const [label, idents, pattern] of replayCases) {
      const post = rebuiltWorld();
      post.identities.push(...idents);
      post.comment = markerFor(c);
      const db = fakeDb(post);
      await expect(reinstateRegistrationsStage(db.tx, c), label).rejects.toThrow(pattern);
      expect(writes(db.statements), label).toEqual([]);
    }
    // a verification that finds the path on a DIFFERENT player than the token fails the stage
    const post = rebuiltWorld();
    await reinstateRegistrationsStage((() => { post.comment = markerFor(c); return fakeDb(post).tx; })(), c);
    pythonPlayersReplay(post);
    post.identities.find((i) => i.source === 'afltables' && i.externalId === pathOf(2))!.playerId = 1;
    post.readOnly = true;
    await expect(verifyRegistrationsStage(fakeDb(post).tx, c)).rejects.toThrow(/replayed registrations do not match the capture/);
  });

  // The pending-capture lifecycle, with the third section (D11c generalised).
  const withRegs = async (ids: number[]) => captureOf(preWorld(ids, { importer: true }),
    ids.map((i) => importerRowFor(i, 13_856 + i)));
  const VERIFIED_OBS: LiveReinstatementObservation = {
    sequence: { lastValue: 1, isCalled: false }, replay: { inserted: 0, noops: 0, stops: [], supersedes: [] },
    importerReplay: { inserted: 0, noops: 1 }, bijection: 'ok', registrations: [],
  };
  const renumbered = (rs: readonly CapturedRegistration[]) => rs.map((r, n) => ({ ...r, playerId: 90_000 + n, adminUserId: 90_500 }));

  it('15. a crash BEFORE the reset leaves the capture reusable: the live original equals it, is verified read-only, archived and recaptured', async () => {
    const pending = await withRegs([1, 2]);
    const dir = mkdtempSync(join(tmpdir(), 'afldb-i245-'));
    try {
      writePendingCapture(dir, pending);
      const decision = decidePendingCapture({ markerPresent: true, pending, liveLedgerRows: [],
        liveImporterRows: pending.importerRows, liveRegistrations: pending.registrations, recover: false });
      expect(decision).toEqual({ action: 'verify-reinstated' });
      const settled = settleCapture({ dir, database: 'afldb_test', capturedAt: '2026-09-25T11:00:00.000Z',
        pending: { capture: pending, fileSha256: 'x'.repeat(64) },
        live: { ledgerPresent: true, ledgerRows: [], importerRows: pending.importerRows, registrations: pending.registrations },
        decision, observed: VERIFIED_OBS });
      expect(settled.archived).toBe(join(dir, archivedCaptureName(pending)));
      expect(sameRegistrations(settled.captured!.capture.registrations, pending.registrations)).toBe(true);
      expect(settled.markerAction.kind).toBe('clear-then-set');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('16. reset-before-replay: the database is empty, so --recover adopts the ORIGINAL capture and never recaptures the empty one', async () => {
    const pending = await withRegs([1, 2]);
    const dir = mkdtempSync(join(tmpdir(), 'afldb-i245-'));
    try {
      const { path } = writePendingCapture(dir, pending);
      const bytes = readFileSync(path, 'utf8');
      const refused = decidePendingCapture({ markerPresent: true, pending, liveLedgerRows: [], liveImporterRows: [],
        liveRegistrations: [], recover: false });
      expect(refused.action === 'refuse' && refused.reason).toMatch(/2 registration\(s\).*--recover-afl-api-adjudications/s);
      const decision = decidePendingCapture({ markerPresent: true, pending, liveLedgerRows: [], liveImporterRows: [],
        liveRegistrations: [], recover: true });
      expect(decision).toEqual({ action: 'adopt-pending' });
      const settled = settleCapture({ dir, database: 'afldb_test', capturedAt: '2026-09-25T11:00:00.000Z',
        pending: { capture: pending, fileSha256: 'x'.repeat(64) },
        live: { ledgerPresent: true, ledgerRows: [], importerRows: [], registrations: [] }, decision, observed: null });
      expect(settled.adopted).toEqual(pending);
      expect(settled.captured).toBeNull();
      expect(readFileSync(path, 'utf8')).toBe(bytes);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('17. committed-but-unarchived: every section already back (new surrogates) is recognised, verified and archived — never re-inserted', async () => {
    const pending = await withRegs([1, 2]);
    const liveRegs = renumbered(pending.registrations);
    const liveImporter = pending.importerRows.map((r, n) => ({ ...r, playerId: 90_000 + n }));
    for (const recover of [true, false]) {
      expect(decidePendingCapture({ markerPresent: false, pending, liveLedgerRows: [], liveImporterRows: liveImporter,
        liveRegistrations: liveRegs, recover })).toEqual({ action: 'verify-reinstated' });
    }
    expect(reinstatedCaptureProblems(pending, [], liveImporter, VERIFIED_OBS, liveRegs)).toEqual([]);
    // not proven -> already_reinstated_unverified, pending left in place
    expect(reinstatedCaptureProblems(pending, [], liveImporter, { ...VERIFIED_OBS, registrations: undefined }, liveRegs))
      .toContain('the live registrations were not verified');
    expect(reinstatedCaptureProblems(pending, [], liveImporter, { ...VERIFIED_OBS, registrations: ['x'] }, liveRegs))
      .toContain('registration verification: x');
    expect(reinstatedCaptureProblems(pending, [], liveImporter, VERIFIED_OBS, liveRegs.slice(1)))
      .toContain('the live registrations differ from the pending capture');
    // a live registration section that differs is never adopted over, with or without --recover
    const drifted = liveRegs.map((r, n) => (n === 0 ? { ...r, updatedAt: '2026-09-26T00:00:00.000000Z' } : r));
    for (const markerPresent of [true, false]) {
      expect(decidePendingCapture({ markerPresent, pending, liveLedgerRows: [], liveImporterRows: [],
        liveRegistrations: drifted, recover: true }).action).toBe('refuse');
    }
  });

  it('18. a failure after the registration stages committed keeps the marker and the pending capture: --recover resets and replays from it', async () => {
    const pending = await withRegs([1, 2]);
    // Stage 17/18/19 committed, Stage 18 (AFL API) failed: registrations are back, AFL API sections empty
    const liveRegs = renumbered(pending.registrations);
    expect(decidePendingCapture({ markerPresent: true, pending, liveLedgerRows: [], liveImporterRows: [],
      liveRegistrations: liveRegs, recover: true })).toEqual({ action: 'adopt-pending' });
    const refused = decidePendingCapture({ markerPresent: true, pending, liveLedgerRows: [], liveImporterRows: [],
      liveRegistrations: liveRegs, recover: false });
    expect(refused.action).toBe('refuse');
    // the registration stages never touch the marker; a reinstate that throws writes nothing that survives
    const post = rebuiltWorld();
    post.comment = markerFor(pending);
    post.invites.push(ACTOR.email); // forces a refusal after planning
    const db = fakeDb(post);
    await expect(reinstateRegistrationsStage(db.tx, pending)).rejects.toThrow(/open admin invite/);
    expect(writes(db.statements)).toEqual([]);
    expect(post.comment).toBe(markerFor(pending));
    // a marker that names another capture refuses before any read of the registrations
    post.comment = markerFor({ ...pending, payloadSha256: 'e'.repeat(64) });
    const other = fakeDb(post);
    await expect(reinstateRegistrationsStage(other.tx, pending)).rejects.toThrow(/does not match the pending capture file/);
    expect(other.statements.some((s) => s.text.includes('data_overrides'))).toBe(false);
    post.comment = null;
    await expect(reinstateRegistrationsStage(fakeDb(post).tx, pending)).rejects.toThrow(/No rebuild marker is present/);
  });

  it('18b. a crash between Stage 17 and the registration replay (records, no identities, marker set): only --recover adopts', async () => {
    const pending = await withRegs([1, 2]);
    const post = rebuiltWorld();
    post.comment = markerFor(pending);
    await reinstateRegistrationsStage(fakeDb(post).tx, pending); // Stage 17 committed; the replay never ran
    const observe = (recover: boolean) => observeCaptureState(fakeDb(post).tx, {
      database: 'afldb_test', dir: tmpdir(), pendingInfo: { capture: pending, fileSha256: 'd'.repeat(64) }, recover,
    });
    // --recover resets and replays every section from the ORIGINAL capture; nothing is captured from this state
    const recovered = await observe(true);
    expect(recovered.decision).toEqual({ action: 'adopt-pending' });
    expect(recovered.registrationsLive).toEqual([]);
    // without --recover it still refuses, naming the registration problem
    await expect(observe(false)).rejects.toThrow(/registration problem\(s\).*the token names no player/s);
    // with no marker the same rows are a LIVE database: refused before destruction, --recover or not
    post.comment = null;
    await expect(observe(true)).rejects.toThrow(/registration problem\(s\) before destruction/);
  });

  it('19/20. ISSUE-237 Stage 18 resolves the importer identity after the registration replay — and STOPs without it', async () => {
    const pre = preWorld([1], { importer: true });
    const importerRows = [importerRowFor(1, 13_857)];
    const c = await captureOf(pre, importerRows);

    // 20: without the registration replay (the I18 failure) the importer replay STOPs, writing nothing
    const without = rebuiltWorld();
    await expect(replayAflApiImporterRows(fakeDb(without).tx, c.importerRows)).rejects.toThrow(AflApiReplayAbort);
    expect(without.identities.filter((i) => i.source === 'afl_api')).toEqual([]);

    // 19: with it, the provider lands on the player the stable identity names NOW
    const post = rebuiltWorld();
    await reinstateReplayVerify(c, post);
    expect(await replayAflApiImporterRows(fakeDb(post).tx, c.importerRows)).toEqual({ inserted: 1, noops: 0 });
    const [newId] = playerFor(post, 'manual_admin_edit', tokenOf(1));
    expect(post.identities.filter((i) => i.source === 'afl_api')).toEqual([expect.objectContaining({
      externalId: 'CD_I1000001', playerId: newId, status: 'unique', matchMethod: 'afl_api_stat_vector_bootstrap' })]);
    expect(newId).not.toBe(13_857);
  });

  it('21. a 92-player ISSUE-224-shaped cohort round-trips, and all 92 AFL API providers resolve afterwards', async () => {
    const cohort = Array.from({ length: 92 }, (_, n) => n + 1);
    const pre = preWorld(cohort, { importer: true });
    const importerRows = cohort.map((i) => importerRowFor(i, 13_856 + i));
    const c = await captureOf(pre, importerRows);
    expect(c.registrations).toHaveLength(92);
    const post = rebuiltWorld();
    const { report } = await reinstateReplayVerify(c, post);
    expect(report).toEqual({ registrations: 92, creates: 92, binds: 0, actorsReused: 0, actorsCreated: 1 });
    expect(await replayAflApiImporterRows(fakeDb(post).tx, c.importerRows)).toEqual({ inserted: 92, noops: 0 });
    // final provider -> player mapping equals the pre-rebuild mapping, through stable identity
    const mapping = (w: World) => new Map(w.identities.filter((i) => i.source === 'afl_api').map((i) => [i.externalId,
      w.identities.find((m) => m.source === 'manual_admin_edit' && m.playerId === i.playerId)!.externalId]));
    expect(mapping(post)).toEqual(mapping(pre));
    expect(post.overrides.map((o) => o.overrideValues).sort()).toEqual(pre.overrides.map((o) => o.overrideValues).sort());
  });

  it('22. no players.id (or admin_user_id) is transported as durable identity', async () => {
    const c = await captureOf(preWorld([1, 2]));
    // the hash ignores the audit surrogates …
    const moved = buildCombinedCapture({ database: 'afldb_test', capturedAt: c.capturedAt, ledgerTablePresent: true,
      ledgerRows: [], importerRows: [], registrations: renumbered(c.registrations) });
    expect(moved.payloadSha256).toBe(c.payloadSha256);
    // … but not a durable field
    const edited = buildCombinedCapture({ database: 'afldb_test', capturedAt: c.capturedAt, ledgerTablePresent: true,
      ledgerRows: [], importerRows: [], registrations: [{ ...c.registrations[0], updatedAt: CREATED }, c.registrations[1]] });
    expect(edited.payloadSha256).not.toBe(c.payloadSha256);
    // and no statement the reinstate issues ever binds a captured surrogate
    const post = rebuiltWorld();
    const { statements } = await reinstateReplayVerify(c, post);
    for (const s of statements) {
      for (const r of c.registrations) {
        expect(s.params, s.text).not.toContain(r.playerId);
        expect(s.params, s.text).not.toContain(r.adminUserId);
      }
    }
    const tool = readFileSync(join(root, 'tools', 'migration', 'rebuild_manual_registrations.ts'), 'utf8');
    expect(tool).not.toMatch(/\$\{r\.playerId\}|\$\{r\.adminUserId\}/);
    expect(tool).not.toMatch(/(display_name|given_name|surname)\s*(=|ILIKE|LIKE|~)/i); // never a name lookup
    // the verify stage refuses outside a read-only transaction
    await expect(verifyRegistrationsStage(fakeDb(post).tx, c)).rejects.toThrow(/must run in a read-only transaction/);
    // and the live re-capture used by the verify stage is the capture itself, surrogates aside
    expect(manualRegistrationVerificationProblems(c.registrations, await readLiveRegistrationState(fakeDb(post).tx))).toEqual([]);
    const state: LiveRegistrationState = await readLiveRegistrationState(fakeDb(post).tx);
    expect(state.manualIdentities.map((m) => m.playerId)).not.toContain(c.registrations[0].playerId);
  });

  // -------------------------------------------------------------------------
  // The code_test_db rehearsal fixture (the real regression target), DB-free
  // -------------------------------------------------------------------------

  describe('code_test_db rehearsal fixture', () => {
    const RF = REGISTRATION_REHEARSAL_FIXTURE;
    const fixtureSource = readFileSync(join(root, 'tools', 'migration', 'manual_registration_rebuild_rehearsal_fixture.ts'), 'utf8');

    it('runs through its own react-server package script, on code_test_db only', () => {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
      expect(pkg.scripts['db:code-test:issue245-rehearsal'])
        .toBe('tsx --conditions=react-server tools/migration/manual_registration_rebuild_rehearsal_fixture.ts');
      expect(RF.database).toBe('code_test_db');
      // the ISSUE-237 fixture's own DSN pin, reused: only the code_test_db variables are read
      expect(fixtureSource).toContain('resolveRehearsalDsns(process.env');
      expect(fixtureSource).not.toMatch(/AFLDB_TEST_DATABASE_URL|AFLDB_TEST_IMPORT_DATABASE_URL/);
    });

    it('owns a provider namespace, a profile path and a notes marker no tracked source carries', () => {
      expect(REGISTRATION_REHEARSAL_PROVIDER_NAMESPACE_RE.test(RF.importer.providerId)).toBe(true);
      for (const other of ['CD_I9992370001', 'CD_I9992350001', 'CD_I9991800001', 'CD_I1002231', 'CD_I99924500011']) {
        expect(REGISTRATION_REHEARSAL_PROVIDER_NAMESPACE_RE.test(other), other).toBe(false);
      }
      expect(REGISTRATION_PROFILE_PATH_RE.test(RF.withPath.profilePath)).toBe(true);
      const files: string[] = [];
      const walk = (dir: string) => {
        if (!existsSync(dir)) return;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name);
          if (entry.isDirectory()) walk(path);
          else if (/\.(json|jsonl|csv|tsv|txt)$/i.test(entry.name)) files.push(path);
        }
      };
      walk(join(root, 'data'));
      walk(join(root, 'tools', 'rebuild'));
      walk(join(root, 'docs', 'rebuild-manifests'));
      expect(files.length).toBeGreaterThan(10);
      const hits = files.filter((f) => {
        const text = readFileSync(f, 'utf8');
        return /CD_I999245/.test(text) || text.includes('Issue245') || text.includes(RF.note);
      });
      expect(hits).toEqual([]);
    });

    it('seeds through the REAL registration primitives, the importer row through the import role, and stores no players.id', () => {
      const seed = fixtureSource.slice(fixtureSource.indexOf('async function runSeed('), fixtureSource.indexOf('async function runVerify('));
      expect(seed).toContain("import('@/db/queries/players')");
      expect(seed).toContain("import('@/db/queries/admin-draft')");
      expect(seed.match(/await createPlayerInTransaction\(tx,/g)).toHaveLength(2);
      expect(seed.match(/await attachAflTablesIdentityInTransaction\(tx,/g)).toHaveLength(1);
      const load = seed.indexOf("import('@/db/queries/players')");
      for (const v of ['DATABASE_URL', 'AFLDB_IMPORT_DATABASE_URL', 'AFLDB_AUTH_DATABASE_URL']) {
        const at = seed.indexOf(`process.env.${v} = dsns.`);
        expect(at, v).toBeGreaterThan(-1);
        expect(at, v).toBeLessThan(load);
      }
      expect(seed.indexOf('connect(dsns.importDsn)')).toBeLessThan(seed.indexOf('INSERT INTO external_identities'));
      expect(fixtureSource).not.toMatch(/(surname|given_name|display_name)\s*(=|ILIKE|LIKE|~)/i);
      // players are reached only through identities: the ONE `FROM players` is teardown's DELETE of
      // ids resolved from the fixture's own tokens and path in that same transaction
      expect(fixtureSource.match(/FROM players\b/g)).toEqual(['FROM players']);
      expect(fixtureSource).toContain('DELETE FROM players WHERE id = ANY (${tx.array(playerIds)}::int[])');
    });

    const breg = (token: string, path: string | null) => ({
      token, overrideValues: jsonbText({ display_name: path ? RF.withPath.displayName : RF.withoutPath.displayName,
        given_name: 'Issue245', surname: path ? 'Rehearsalone' : 'Rehearsaltwo', notes: RF.note,
        ...(path ? { afltables_profile_path: path } : {}) }),
      afltablesProfilePath: path, createdAt: CREATED, updatedAt: UPDATED,
    });
    const rbaseline = () => buildRegistrationRehearsalBaseline({ database: 'code_test_db', seededAt: '2026-09-25T02:00:00.000Z',
      registrations: [breg(tokenOf(901), RF.withPath.profilePath), breg(tokenOf(902), null)] });

    it('the baseline carries durable fields only, proves its own hash, and refuses the wrong shape', () => {
      const b = rbaseline();
      const text = JSON.stringify(b);
      expect(text).not.toMatch(/"playerId"|"adminUserId"|password|totp/i);
      expect(parseRegistrationRehearsalBaseline(text, 'code_test_db')).toEqual(b);
      expect(() => parseRegistrationRehearsalBaseline(text, 'afldb_test')).toThrow(/not 'afldb_test'/);
      expect(() => parseRegistrationRehearsalBaseline(JSON.stringify({ ...b, registrations: [{ ...b.registrations[0], updatedAt: CREATED },
        b.registrations[1]] }), 'code_test_db')).toThrow(/payload hash/);
      expect(() => buildRegistrationRehearsalBaseline({ database: 'code_test_db', seededAt: 'x', registrations: [breg(tokenOf(901), RF.withPath.profilePath)] }))
        .toThrow(/expected exactly 2/);
      expect(() => buildRegistrationRehearsalBaseline({ database: 'code_test_db', seededAt: 'x',
        registrations: [breg(tokenOf(902), null), breg(tokenOf(901), RF.withPath.profilePath)] })).toThrow(/does not carry the fixture path/);
      expect(registrationRehearsalBaselinePath('D:/cap', 'code_test_db').replace(/\\/g, '/'))
        .toBe('D:/cap/issue-245-rehearsal/code_test_db.baseline.json');
    });

    const liveReg = (b: ReturnType<typeof breg>, playerId: number): CapturedRegistration => ({
      ...b, adminEmail: RF.actorEmail, adminRole: 'super_admin', adminUserId: 77, playerId,
    });
    /** A consistent observation: the registered player is `x`, the path-less one `y` — whatever those ids are. */
    const robs = (x: number, y: number, over: Partial<RegistrationRehearsalObservation> = {}): RegistrationRehearsalObservation => {
      const b = rbaseline();
      return {
        database: 'code_test_db', markerPresent: false, pendingCaptureExists: false, registrationProblems: [],
        fixtureRegistrations: [liveReg(b.registrations[0], x), liveReg(b.registrations[1], y)],
        withPathTokenPlayers: [x], withPathPathPlayers: [x],
        withPathForward: { ok: true, identity: RF.withPath.profilePath, via: 'afltables' },
        withoutPathTokenPlayers: [y], withoutPathAfltablesPaths: [],
        aflApiRows: [{ externalId: RF.importer.providerId, status: 'unique', matchMethod: RF.importer.matchMethod, playerId: x,
          candidateCount: 1, externalUrl: null, externalName: RF.importer.externalName, notes: RF.importer.notes }],
        actors: [{ email: RF.actorEmail, role: 'super_admin', disabled: true, hasPasswordHash: false, hasTotpSecret: false }],
        invariant: 'ok', archivedCaptures: [], ...over,
      };
    };
    const carrying = [{ file: 'afl-api-identities.x.reinstated.json', fileSha256: 'f'.repeat(64), payloadSha256: 'p'.repeat(64), carriesFixture: true }];

    it('verify pre/post pass on the exact fixture state, including after both players are renumbered', () => {
      const b = rbaseline();
      expect(registrationRehearsalVerifyProblems(b, robs(13_900, 13_901), 'pre')).toEqual([]);
      expect(registrationRehearsalVerifyProblems(b, robs(95_001, 95_002, { archivedCaptures: carrying }), 'post')).toEqual([]);
      expect(registrationRehearsalVerifyProblems(b, robs(95_001, 95_002), 'post').join('; '))
        .toMatch(/no archived combined capture carries both fixture registrations and the importer row/);
      expect(registrationRehearsalVerifyProblems(b, robs(13_900, 13_901, { archivedCaptures: carrying }), 'pre').join('; '))
        .toMatch(/use --phase post/);
    });

    it('verify post fails on every lost, retargeted or rewritten piece of registration state', () => {
      const b = rbaseline();
      const post = (over: Partial<RegistrationRehearsalObservation>) =>
        registrationRehearsalVerifyProblems(b, robs(95_001, 95_002, { archivedCaptures: carrying, ...over }), 'post').join('; ');
      const [imp] = robs(95_001, 95_002).aflApiRows;
      const [r1, r2] = robs(95_001, 95_002).fixtureRegistrations;
      const cases: Array<[Partial<RegistrationRehearsalObservation>, RegExp]> = [
        [{ fixtureRegistrations: [r2] }, /0 live creation record\(s\), expected 1/],
        [{ fixtureRegistrations: [{ ...r1, overrideValues: r1.overrideValues.replace('Rehearsalone', 'Rehearsal1') }, r2] }, /durable field of the creation record differs/],
        [{ fixtureRegistrations: [{ ...r1, adminRole: 'admin' }, r2] }, /not attributed to the fixture actor/],
        [{ withPathTokenPlayers: [] }, /first registration's token names 0 players/],
        [{ withPathPathPlayers: [95_003] }, /token names player 95001 but the AFL Tables path names player 95003/],
        [{ withPathForward: { ok: false, reason: 'ambiguous' } }, /D7/],
        [{ withoutPathTokenPlayers: [95_001] }, /resolve to the same player/],
        [{ withoutPathAfltablesPaths: ['players/X/X.html'] }, /path-less registration's player holds an AFL Tables identity/],
        [{ aflApiRows: [] }, /has 0 afl_api row/],
        [{ aflApiRows: [{ ...imp, playerId: 13_900 }] }, /retargeted/],
        [{ aflApiRows: [{ ...imp, matchMethod: 'afl_api_stat_vector_season' }] }, /not exactly 'afl_api_stat_vector_bootstrap'/],
        [{ aflApiRows: [{ ...imp, status: 'resolved' }] }, /not 'unique'/],
        [{ registrationProblems: ['x'] }, /the next capture would refuse: x/],
        [{ markerPresent: true }, /rebuild marker is still present/],
        [{ pendingCaptureExists: true }, /pending rebuild capture/],
        [{ invariant: { error: 'one-row-per-player' } }, /standalone invariant failed/],
        [{ actors: [{ email: RF.actorEmail, role: 'super_admin', disabled: false, hasPasswordHash: true, hasTotpSecret: false }] }, /not attribution-only/],
        [{ database: 'afldb_test' }, /not 'code_test_db'/],
      ];
      for (const [over, pattern] of cases) expect(post(over), JSON.stringify(over).slice(0, 120)).toMatch(pattern);
    });

    it('an archived capture is evidence only when it carries both registrations AND the importer row', () => {
      const b = rbaseline();
      const regs = [liveReg(b.registrations[0], 7), liveReg(b.registrations[1], 8)];
      const imp: CapturedImporterRow = { externalId: RF.importer.providerId, playerIdentity: RF.withPath.profilePath,
        matchMethod: 'afl_api_stat_vector_bootstrap', status: 'unique', candidateCount: 1, externalName: RF.importer.externalName,
        externalUrl: null, notes: RF.importer.notes, playerId: 7 };
      const c = buildCombinedCapture({ database: 'code_test_db', capturedAt: '2026-09-25T03:00:00.000Z', ledgerTablePresent: false,
        ledgerRows: [], importerRows: [imp], registrations: regs });
      expect(captureCarriesRegistrationFixture(c, b)).toBe(true);
      expect(captureCarriesRegistrationFixture({ ...c, registrations: [regs[0]] }, b)).toBe(false);
      expect(captureCarriesRegistrationFixture({ ...c, importerRows: [] }, b)).toBe(false);
      const dir = mkdtempSync(join(tmpdir(), 'afldb-i245-rehearsal-'));
      try {
        writePendingCapture(dir, c);
        const archived = archivePendingCapture(dir, c);
        writeFileSync(join(dir, 'afl-api-identities.tampered.reinstated.json'), '{"format":"nope"}');
        const found = readArchivedRegistrationCaptures(dir, 'code_test_db', b);
        expect(found.map((x) => x.carriesFixture)).toEqual(found.map((x) => x.file === archived.split(/[\\/]/).pop()));
        expect(found.find((x) => !x.carriesFixture)?.payloadSha256).toBe('unverifiable');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('teardown owns only exact literals, never runs mid-lifecycle, and ends in the residue gate', () => {
      expect(registrationResidueTotal(ZERO_REGISTRATION_REHEARSAL_RESIDUE)).toBe(0);
      const teardown = fixtureSource.slice(fixtureSource.indexOf('async function runTeardown('), fixtureSource.indexOf('async function main('));
      const firstDelete = teardown.indexOf('DELETE FROM');
      expect(teardown.indexOf('existsSync(join(captureDir, PENDING_CAPTURE_FILE))')).toBeLessThan(firstDelete);
      expect(teardown.indexOf('await readRebuildMarker(tx, database)')).toBeLessThan(firstDelete);
      expect(teardown.indexOf('if (database !== dsns.database)')).toBeLessThan(firstDelete);
      const deletes = teardown.split('DELETE FROM').slice(1).map((s) => s.slice(0, s.indexOf('`')));
      expect(deletes.length).toBe(8);
      for (const d of deletes) expect(d, d).not.toMatch(/\bLIKE\b|\s~\s|NAMESPACE/);
      expect(teardown.indexOf('await runResidue(dsns);')).toBeGreaterThan(teardown.lastIndexOf('DELETE FROM'));
    });
  });
});
