import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
  FINGERPRINT_SECTIONS,
  HEALTH_SQL,
  IDENTITY_SQL,
  MIGRATION_STATE_SQL,
  MIGRATION_TABLE_SQL,
  OTHER_SESSIONS_SQL,
  PROOF_DELIVERY_MARKER,
  PROOF_MARKER,
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
  it('refuses a target that is not a _test database', () => {
    expect(() => resolveTarget({
      AFLDB_TEST_DATABASE_URL: 'postgres://u:p@h:5432/afldb_scratch',
      AFLDB_TEST_IMPORT_DATABASE_URL: 'postgres://u:p@h:5432/afldb_scratch',
    })).toThrow(/ends in _test/);
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
    // Caught by the _test-suffix rule before the pre_rebuild rule is even reached; what
    // matters is that it is refused, not which guard fires first.
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
    expect(idsOf(stages)).toEqual([
      'precheck', 'recreate', 'migrations', 'privileges',
      'reference', 'fitzroy', 'heights', 'heights-afl-api', 'heights-wikipedia', 'birth-dates',
      'coaches', 'draftguru', 'awards-honours', 'brownlow-season', 'derived', 'coleman', 'ladder-witness',
      'fingerprints',
    ]);
  });

  it('adds exactly three data stages beyond the four, none of which acquires', () => {
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
    expect(idsOf(stages.filter((s) => s.kind === 'data')))
      .toEqual(['reference', 'fitzroy', 'heights', 'heights-afl-api', 'heights-wikipedia',
                'birth-dates', 'coaches', 'draftguru', 'awards-honours', 'brownlow-season', 'derived',
                'coleman']);
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
      ['census', Object.entries(census).map(([k, v]) => `${k}=${v}`).join(' ')],
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
      for (const script of ['db:privileges', 'db:privileges:test']) {
        const command: string = pkg.scripts[script];
        expect(command, `${script} must not build a psql argv in the shell`)
          .toBe(`tsx tools/db/privileges.ts --target ${script.endsWith(':test') ? 'test' : 'dev'}`);
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
      // and it never prints what it resolved
      expect(source).not.toMatch(/console\.(log|error)\([^)]*\bdsn\b/);
    });

    it('sets the migration target without a POSIX shell assignment', () => {
      // `AFLDB_MIGRATE_TARGET=test tsx …` fails outright under cmd.exe, which is the shell
      // npm uses for package scripts on Windows — and MIGRATIONS is the stage immediately
      // after the destructive reset (§H11 F1).
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      expect(pkg.scripts['db:migrate:test']).toBe('tsx tools/db/migrate.ts --target test');
      const source = readFileSync(join(root, 'tools', 'db', 'migrate.ts'), 'utf8');
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

  describe('identity refusals — every one fires BEFORE the reset', () => {
    const cases: [string, Partial<Identity>, string, RegExp][] = [
      ['a database that is not afldb_test', { database: 'afldb_scratch_test' },
        'afldb_scratch_test', /only supported rebuild target/],
      ['afldb_dev by name', { database: 'afldb_dev' }, 'afldb_dev', /rejected by name/],
      ['anything that looks like production', { database: 'afldb_prod' }, 'afldb_prod',
        /rejected by name|looks like production/],
      ['a name that does not end in _test', { database: 'afldb' }, 'afldb', /ends in _test/],
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
