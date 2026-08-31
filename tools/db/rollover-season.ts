/**
 * AFLDB-ISSUE-101 — the end-of-season rollover CLI.
 *
 * Plans, and only on demand applies, the coordinated reference-state
 * transition that moves a completed season out of the in-season pipeline and
 * into the accepted historical baseline.
 *
 * REVIEW-FIRST IS THE DEFAULT. With no `--apply` this prints the plan and
 * writes nothing at all. `--apply` must be explicit AND accompanied by
 * `--acknowledge-season-complete`. Nothing here is scheduled.
 *
 * THE VALIDATORS ARE THE AUTHORITY, AND THEY ARE ALL EXECUTED BEFORE THE WRITE.
 * A dry run validates exactly what an apply validates. Three real subprocesses
 * run on every invocation, in this order:
 *
 *   1. import_fitzroy_core.py --validate-only --require-full-history
 *        --contract <tmp successor contract>
 *        --stat-availability <reviewed successor availability>
 *   2. import_fitzroy_core.py --validate-only --require-accepted-baseline
 *        --contract <tmp> --stat-availability <reviewed>
 *        --accepted-baselines <tmp successor register>
 *   3. validate_ladder_witness.py --label <witness>
 *        --contract <tmp> --manifest-dir <dir of the bound ladder manifest>
 *
 * (1) re-hashes every artefact, checks every CSV shape, resolves club and
 * player identity, and MEASURES identity coverage — both the measured
 * fingerprint and the identity scan in the acceptance record come from its
 * stdout. (2) proves the acceptance record this plan computed still binds those
 * exact bytes under that exact contract, and re-derives the whole fingerprint.
 * (3) is the offline witness proof. There is no flag that supplies a
 * transcript, no flag that skips a run, and no cached success.
 *
 * WHY A TEMPORARY DIRECTORY. All three gates compare the candidate against the
 * boundary the fitzRoy contract declares, and the tracked contract declares the
 * PREVIOUS boundary until this plan lands. Rather than write first and validate
 * afterwards, the CLI materialises the computed SUCCESSOR contract and register
 * in a temporary directory outside the repository and points the validators at
 * them with the backward-compatible `--contract` / `--accepted-baselines` /
 * `--stat-availability` / `--manifest-dir` overrides. The planner then re-reads
 * those temporary files back off disk and refuses unless their bytes are
 * exactly the successor documents it computed — so a passing gate is a gate
 * that adjudicated THIS plan.
 *
 * WHAT STILL WAITS FOR THE REBUILD. `validate_ladder_witness.py --compare` is
 * the D7 set equality against `club_seasons` and genuinely needs a rebuilt
 * database. It is neither moved nor weakened; it stays inside
 * `npm run db:test:rebuild`, which also re-runs (2) in PRECHECK against the
 * landed tracked documents.
 *
 * THIS TOOL PERFORMS NO CANONICAL WRITE. It opens no database connection and
 * issues no SQL. It edits tracked reference artefacts only. The completed
 * season's canonical rows are superseded the one way they already are: by
 * `npm run db:test:rebuild` rebuilding from the newly accepted baseline.
 *
 * IT DOES NOT DECIDE THAT A SEASON ENDED. There is no clock here. Completion
 * is established by a newly acquired full-history candidate that the existing
 * validators passed, plus the operator's explicit acknowledgement.
 *
 * MULTI-FILE SAFETY, STATED HONESTLY. The entire successor state is computed
 * and fully validated in memory, and every gate has passed, before a single
 * byte reaches a tracked file. Each file is then written to a temporary file in
 * the same directory and renamed over the original, so no file is ever observed
 * half-written. That is per-file atomicity, NOT a transaction across files:
 * there is no such thing for the filesystem here. If the process dies between
 * two renames, some files are new and some are old — and because every one of
 * them is tracked, Git is the recovery boundary. Review the diff; revert it if
 * it is partial.
 *
 * Usage (dry run):
 *
 *   npx tsx tools/db/rollover-season.ts \
 *     --season 2026 --rollover-date 2026-11-03 --retire-status <status> \
 *     --core-manifest docs/rebuild-manifests/afltables_fitzroy_core/<label>.json \
 *     --ladder-manifest docs/rebuild-manifests/afltables_fitzroy_core/<witness>.json \
 *     --ladder-coverage artifacts/rollover/ladder-coverage.json \
 *     --stat-availability artifacts/rollover/stat-availability.json \
 *     --accepted-corrections artifacts/rollover/accepted-corrections.json \
 *     --expected-club-season-rows <n>
 *
 * `--retire-status` must name a value the acceptance register declares in
 * `selection_policy.retired_statuses` (today: `retired`). `--accepted-corrections`
 * is the reviewed correction state for THIS acquisition — it is never inherited
 * from the outgoing baseline, and an acquisition needing none says so explicitly
 * with the same categories and empty arrays. There is no `--identity-scan`:
 * identity coverage is measured by gate (1).
 */
import {
  readFileSync, writeFileSync, renameSync, existsSync, statSync, mkdtempSync, rmSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  IMPORTER,
  LADDER_VALIDATOR,
  RolloverRefused,
  assertPreApplyAuthority,
  parseRolloverArgv,
  planSeasonRollover,
  planSuccessorContract,
  readClubSeasonsExpectedRows,
  type RolloverPlan,
  type ValidatorOverride,
  type ValidatorRun,
} from '../../src/lib/rollover/season-rollover';
import { resolvePython } from './rebuild-test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const REGISTER = 'data/reference/fitzroy-accepted-baselines.json';
const SEASONS = 'data/reference/seasons.json';
const CONTRACT = 'tools/rebuild/fitzroy/fitzroy-contract.json';
const STAT_AVAILABILITY = 'data/reference/stat-availability.json';
const REBUILD = 'tools/db/rebuild-test.ts';

function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

/** Read an operator-supplied file from anywhere, but never outside the repository. */
function readEvidenceFile(path: string, what: string): { text: string; relative: string } {
  const absolute = resolve(REPO_ROOT, path);
  const rel = relative(REPO_ROOT, absolute);
  if (rel.startsWith('..') || rel === '') {
    throw new RolloverRefused(`${what} (${path}) is outside the repository.`);
  }
  if (!existsSync(absolute)) {
    throw new RolloverRefused(`${what} does not exist: ${path}`);
  }
  return { text: readFileSync(absolute, 'utf8'), relative: rel.split(sep).join('/') };
}

function parseJsonFile(path: string, what: string): {
  parsed: Record<string, unknown>; text: string; relative: string;
} {
  const { text, relative: rel } = readEvidenceFile(path, what);
  try {
    return { parsed: JSON.parse(text) as Record<string, unknown>, text, relative: rel };
  } catch (error) {
    throw new RolloverRefused(`${what} is not valid JSON (${path}): ${String(error)}`);
  }
}

function sha256Of(text: string): string {
  // The register binds the manifest's BYTES, so hash what is on disk.
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

const SNAPSHOT_ROOT = 'data/sources/afltables/fitzroy_core';

/**
 * Materialise one temporary document and read it BACK.
 *
 * The read-back is the point. The planner compares these bytes against the
 * successor document it computed, so what it checks is what the validator
 * subprocess actually opened — not an in-memory string that was merely intended
 * to be written.
 */
function materialise(
  directory: string, name: string, flag: string, content: string,
): ValidatorOverride {
  const path = join(directory, name);
  writeFileSync(path, content, 'utf8');
  return { flag, path, bytes: readFileSync(path, 'utf8') };
}

function runPython(argv: string[], banner: string): ValidatorRun {
  const python = resolvePython();
  console.log(`\n${banner}\n  ${python} ${argv.join(' ')}`);
  const result = spawnSync(python, argv, {
    cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new RolloverRefused(
      `Could not execute ${argv[0]} (${String(result.error)}). The rollover is authorised `
      + 'by these validators and will not proceed without running them.');
  }
  console.log(`  exit ${result.status}`);
  return {
    argv: [python, ...argv],
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function assertSnapshotPresent(snapshotDir: string): void {
  const absolute = join(REPO_ROOT, snapshotDir);
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
    throw new RolloverRefused(
      `The candidate snapshot directory does not exist: ${snapshotDir}. The validators `
      + 'must be run against the acquired artefacts, so there is nothing to validate.');
  }
}

function printPlan(plan: RolloverPlan, apply: boolean): void {
  console.log(`\nAFLDB-ISSUE-101 — season rollover ${apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`  completing season          ${plan.completedSeason}`);
  console.log(`  new in-progress season     ${plan.newInProgressSeason}`);
  console.log(`  baseline retired           ${plan.retiredLabel}`);
  console.log(`  baseline accepted          ${plan.acceptedLabel}`);
  console.log(`  ladder witness accepted    ${plan.witnessLabel}`);
  console.log(`  club_seasons expected      ${plan.clubSeasonRows.from} -> `
    + `${plan.clubSeasonRows.to}`);

  console.log('\nmeasured fingerprint (from the validator, not entered by hand)');
  for (const [key, value] of Object.entries(plan.measured)) {
    console.log(`  ${key.padEnd(28)} ${value}`);
  }
  console.log('identity scan (measured by the executed full-history gate)');
  for (const [key, value] of Object.entries(plan.identityScan)) {
    console.log(`  ${key.padEnd(28)} ${value}`);
  }

  console.log('\nfiles');
  for (const file of plan.files) {
    console.log(`  ${file.path}${file.reformatted ? '  (JSON reformatted)' : ''}`);
  }

  console.log('\nnotes');
  for (const note of plan.notes) console.log(`  - ${note}`);
}

/** Write via a sibling temporary file, then rename over the target. */
function writeAtomicish(relativePath: string, content: string): void {
  const target = join(REPO_ROOT, relativePath);
  const temporary = `${target}.rollover-tmp`;
  writeFileSync(temporary, content, 'utf8');
  renameSync(temporary, target);
}

function main(argv: string[]): number {
  const args = parseRolloverArgv(argv);
  const { apply } = args;

  const core = parseJsonFile(args.coreManifest,
    'the full-history acquisition manifest');
  const witness = parseJsonFile(args.ladderManifest,
    'the ladder witness acquisition manifest');
  const coverage = parseJsonFile(args.ladderCoverage,
    'the reviewed ladder coverage block');
  const statAvailability = parseJsonFile(args.statAvailability,
    'the reviewed stat-availability document');
  const acceptedCorrections = parseJsonFile(args.acceptedCorrections,
    'the reviewed accepted_corrections state');

  const candidateLabel = String(core.parsed.snapshot_label ?? '');
  if (!candidateLabel) {
    throw new RolloverRefused('The candidate manifest declares no snapshot_label.');
  }
  const snapshotDir = `${SNAPSHOT_ROOT}/${candidateLabel}`;
  assertSnapshotPresent(snapshotDir);

  const sources = {
    register: readRepoFile(REGISTER),
    seasons: readRepoFile(SEASONS),
    contract: readRepoFile(CONTRACT),
    statAvailability: readRepoFile(STAT_AVAILABILITY),
    rebuild: readRepoFile(REBUILD),
  };
  const current = {
    register: JSON.parse(sources.register) as Record<string, unknown>,
    seasons: JSON.parse(sources.seasons) as Record<string, unknown>,
    contract: JSON.parse(sources.contract) as Record<string, unknown>,
    statAvailability: JSON.parse(sources.statAvailability) as Record<string, unknown>,
    clubSeasonsExpectedRows: readClubSeasonsExpectedRows(sources.rebuild),
  };
  const request = {
    season: args.season,
    acknowledgeSeasonComplete: args.acknowledgeSeasonComplete,
    rolloverDate: args.rolloverDate,
    retirementStatus: args.retirementStatus,
    expectedClubSeasonRows: args.expectedClubSeasonRows,
  };
  const successorEvidence = {
    coreManifest: core.parsed,
    coreManifestPath: core.relative,
    coreSnapshotDir: snapshotDir,
    ladderManifest: witness.parsed,
    ladderManifestSha256: sha256Of(witness.text),
    ladderManifestPath: witness.relative,
    ladderCoverage: coverage.parsed,
    statAvailability: statAvailability.parsed,
    // Written through verbatim, so what lands is what was reviewed — and it is
    // also the document the gates below are pointed at.
    statAvailabilityText: statAvailability.text,
    acceptedCorrections: acceptedCorrections.parsed,
  };

  // STAGE 1. Every refusal that needs no validator evidence happens here: an
  // incoherent or half-rolled starting state, a candidate covering the wrong
  // span, a fabricated availability document, an inherited corrections block.
  // Nothing has been spawned and nothing has been written.
  const successor = planSuccessorContract({
    request, current, currentSources: sources, evidence: successorEvidence,
  });

  const temporary = mkdtempSync(join(tmpdir(), 'afldb-rollover-'));
  try {
    // STAGE 2. Materialise the computed successor contract and run the REAL
    // full-history gate against it. This is what makes identity coverage
    // measured rather than stated, and it happens before any tracked write.
    const contractOverride = materialise(
      temporary, 'fitzroy-contract.json', '--contract', successor.contractContent);
    // The reviewed availability document is already on disk exactly as it will be
    // written, so it is pointed at directly rather than copied — and read back the
    // same way, so the planner still compares what the validator opened.
    const availabilityPath = resolve(REPO_ROOT, args.statAvailability);
    const availabilityOverride: ValidatorOverride = {
      flag: '--stat-availability',
      path: availabilityPath,
      bytes: readFileSync(availabilityPath, 'utf8'),
    };

    const fullHistoryArgv = [
      IMPORTER,
      '--label', candidateLabel,
      '--snapshot-dir', snapshotDir,
      '--manifest', core.relative,
      '--validate-only',
      '--require-full-history',
      '--contract', contractOverride.path,
      '--stat-availability', availabilityOverride.path,
    ];
    const fullHistoryRun = runPython(fullHistoryArgv,
      'PRE-APPLY GATE 1/3 — full-history validation against the successor contract '
      + '(this is the verdict authority, and the source of measured + identity_scan)');

    const plan = planSeasonRollover({
      request,
      current,
      currentSources: sources,
      evidence: {
        ...successorEvidence,
        coreManifestSha256: sha256Of(core.text),
        coreValidatorRun: fullHistoryRun,
        coreValidatorOverrides: [contractOverride, availabilityOverride],
      },
    });

    // STAGE 3. The successor register now exists, so the acceptance gate can be
    // pointed at it, and the ladder witness can be proven against the successor
    // contract. Both are still offline; neither has touched a tracked file.
    const registerOverride = materialise(
      temporary, 'fitzroy-accepted-baselines.json', '--accepted-baselines',
      plan.authority.successorRegisterContent);

    const acceptanceRun = runPython([
      IMPORTER,
      '--label', plan.acceptedLabel,
      '--snapshot-dir', snapshotDir,
      '--manifest', core.relative,
      '--validate-only',
      '--require-accepted-baseline',
      '--contract', contractOverride.path,
      '--stat-availability', availabilityOverride.path,
      '--accepted-baselines', registerOverride.path,
    ], 'PRE-APPLY GATE 2/3 — acceptance binding + fingerprint drift gate against the '
      + 'successor register');

    const ladderRun = runPython([
      LADDER_VALIDATOR,
      '--label', plan.witnessLabel,
      '--contract', contractOverride.path,
      '--manifest-dir', plan.authority.ladderManifestDir,
    ], 'PRE-APPLY GATE 3/3 — offline ladder witness validation against the successor '
      + 'contract (--compare is deliberately absent: it needs the rebuilt database)');

    // Any failure above, or any binding that does not match this plan, throws
    // here. Nothing tracked has been written at this point, in either mode.
    assertPreApplyAuthority({
      plan,
      acceptance: {
        run: acceptanceRun,
        overrides: [contractOverride, availabilityOverride, registerOverride],
      },
      ladder: { run: ladderRun, overrides: [contractOverride] },
    });
    console.log('\nAll three pre-apply gates PASSED against the computed successor state.');

    printPlan(plan, apply);

    if (!apply) {
      console.log('\nDRY RUN — nothing was written. Every gate above still ran. '
        + 'Re-run with --apply --acknowledge-season-complete to write these files.');
      return 0;
    }

    // Every check has passed. Only now does anything reach the filesystem.
    for (const file of plan.files) writeAtomicish(file.path, file.content);

    console.log(`\nWROTE ${plan.files.length} files.`);
    console.log('Review the diff before anything else — Git is the recovery boundary if a '
      + 'filesystem failure interrupted the sequence.');
    console.log('\nRemaining proof, which genuinely needs the rebuilt database:');
    console.log('  npm run db:test:rebuild -- --acknowledge-destroy afldb_test');
    console.log(`     PRECHECK re-runs ${IMPORTER} --require-accepted-baseline against the `
      + 'landed tracked documents, then the witness --compare cross-check against the '
      + 'rebuilt club_seasons, then stage 9.');
    return 0;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

try {
  process.exit(main(process.argv.slice(2)));
} catch (error) {
  if (error instanceof RolloverRefused) {
    console.error(`\nROLLOVER REFUSED\n  ${error.message}\n`);
    process.exit(2);
  }
  throw error;
}
