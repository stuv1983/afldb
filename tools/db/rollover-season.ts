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
 * byte reaches a tracked file. Apply then (1) stages EVERY new file beside its
 * target and reads each back, (2) writes a recovery journal naming each file's
 * old and new SHA-256 and old bytes (`.rollover-transaction.json`), (3) renames
 * the staged files over their targets, (4) re-reads every target against the
 * plan, and only then (5) removes the journal. No file is ever observed
 * half-written, but a rename sequence across files is NOT a transaction: there
 * is no such thing for the filesystem here, and no intermediate combination of
 * old and new files is promised to be usable. If the process dies between two
 * renames some files are new and some old; the journal (or a leftover
 * `*.rollover-tmp`) makes every later invocation, dry run included, and the
 * rebuild preflight refuse, printing the per-file state and the exact recovery
 * steps. The journal holds the old bytes, and Git remains the recovery boundary
 * for them. Apply is refused if the bytes to write, the bytes they replace, or
 * any validated document moved after the proposed state was validated.
 *
 * THE COMPLETE TRANSITION AS ONE CHANGE SET. `--transition-change-set <file>`
 * (optional) carries the contract edits the planner cannot compute, and the
 * other two contracts' measured counts, in the same validated plan instead of
 * pre-editing the working tree and leaving the predecessor invalid while the
 * dry run is reviewed. See `src/lib/rollover/transition-change-set.ts`: an
 * explicit old SHA-256 per file, complete write_set membership, a hash pin of
 * every byte to be written before `--apply` is accepted, and refusal of any
 * change set, proposed file or planned output carrying the proposal sentinel
 * UNRESOLVED:. No gate is relaxed and nothing is written until all of it has
 * been validated together. With a change set, the complete PROPOSED state (the
 * register, seasons, fitzRoy contract, both source contracts and the stage-9
 * constant, exactly as they would be written) is also handed to the rebuild's
 * own validators in memory (`tools/db/rollover-proposed-state.ts`): the ladder
 * selector and tuple, the height block, and the check lists built from the
 * source contracts' measured counts. That needs no database and writes nothing;
 * what only a database can prove is printed as PENDING, never as passed.
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
 *     --afl-api-ownership-census artifacts/rollover/afl-api-ownership-census-afldb_test.json \
 *     --afltables-retirement-decision D-316-1 \
 *     --expected-club-season-rows <n>
 *
 * `--afl-api-ownership-census` (AFLDB-ISSUE-233 D-233-3, required, repeatable: one per
 * database censused) is the evidence `tools/db/afl-api-ownership-census.ts --through-season
 * <season>` wrote. The planner refuses, before any gate runs or anything is written, when a
 * season of the successor rebuild scope holds an `afl_api`-owned canonical match, because the
 * post-rollover rebuild would re-own it. This tool still opens no database connection.
 *
 * `--afltables-retirement-decision` (AFLDB-ISSUE-316 C2, required) names the owner decision
 * that retires AFL Tables network fetching, and must be exactly the one registered for
 * `--season` (`D-316-1` for 2026). The rollover writes `in_progress_seasons: [Y + 1]`,
 * so it also writes `data/reference/afltables-network.json` to `retired` in the same apply,
 * before any other file, and refuses before any gate runs unless that switch is `active` with
 * `last_season` equal to `--season` (see `src/lib/rollover/afltables-network-retirement.ts`).
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
  readStageNineExpectedRows,
  type RolloverPlan,
  type ValidatorOverride,
  type ValidatorRun,
} from '../../src/lib/rollover/season-rollover';
import {
  AFLTABLES_NETWORK_PATH,
  parseAfltablesRetirementDecision,
  planAfltablesNetworkRetirement,
} from '../../src/lib/rollover/afltables-network-retirement';
import type { PlannedFile } from '../../src/lib/rollover/season-rollover';
import {
  TRANSITION_FLAG,
  type ApplyBinding,
  applyStagedWrites,
  assertTransitionWriteSet,
  describeTransitionDiff,
  formatTransitionDiff,
  parseTransitionChangeSet,
  pendingTransactionProblem,
  prepareTransition,
  sha256Hex,
  validateTransitionState,
  type FileIo,
  type InputRole,
  type PreparedTransition,
} from '../../src/lib/rollover/transition-change-set';
import { resolvePython } from './rebuild-test';
import { validateProposedRebuildState } from './rollover-proposed-state';

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
function readEvidenceFile(path: string, what: string): { text: string; relative: string; bytes: Buffer } {
  const absolute = resolve(REPO_ROOT, path);
  const rel = relative(REPO_ROOT, absolute);
  if (rel.startsWith('..') || rel === '') {
    throw new RolloverRefused(`${what} (${path}) is outside the repository.`);
  }
  if (!existsSync(absolute)) {
    throw new RolloverRefused(`${what} does not exist: ${path}`);
  }
  const bytes = readFileSync(absolute);
  return { text: bytes.toString('utf8'), bytes, relative: rel.split(sep).join('/') };
}

function parseJsonFile(path: string, what: string): {
  parsed: Record<string, unknown>; text: string; relative: string; bytes: Buffer;
} {
  const { text, relative: rel, bytes } = readEvidenceFile(path, what);
  try {
    return { parsed: JSON.parse(text) as Record<string, unknown>, text, relative: rel, bytes };
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

/** Current bytes of a repository-relative path, or null when absent. */
function readRepoBytes(relativePath: string): Buffer | null {
  const absolute = join(REPO_ROOT, relativePath);
  return existsSync(absolute) ? readFileSync(absolute) : null;
}

/** The real filesystem under the repository root, for the staged apply and the pending check. */
const repoIo: FileIo = {
  read: readRepoBytes,
  write: (path, content) => writeFileSync(join(REPO_ROOT, path), content, 'utf8'),
  rename: (from, to) => renameSync(join(REPO_ROOT, from), join(REPO_ROOT, to)),
  remove: (path) => rmSync(join(REPO_ROOT, path), { force: true }),
};

function main(argv: string[]): number {
  // Before anything else, even a dry run: an earlier unfinished apply makes every gate unsafe.
  const pending = pendingTransactionProblem(repoIo);
  if (pending !== null) throw new RolloverRefused(pending.join('\n  '));
  const args = parseRolloverArgv(argv);
  const retirementDecision = parseAfltablesRetirementDecision(argv);
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
  // AFLDB-ISSUE-233 D-233-3: read here, judged by the planner from its counts.
  const aflApiOwnershipCensuses = args.aflApiOwnershipCensus.map((path) => {
    const census = parseJsonFile(path, 'the afl_api ownership census evidence');
    return { path: census.relative, sha256: sha256Of(census.text), record: census.parsed };
  });

  const changeSetFlag = argv.indexOf(TRANSITION_FLAG);
  if (changeSetFlag >= 0 && argv.indexOf(TRANSITION_FLAG, changeSetFlag + 1) >= 0) {
    throw new RolloverRefused(`${TRANSITION_FLAG} was given more than once.`);
  }
  const changeSetPath = changeSetFlag >= 0 ? argv[changeSetFlag + 1] : undefined;
  if (changeSetFlag >= 0 && (changeSetPath === undefined || changeSetPath.startsWith('--'))) {
    throw new RolloverRefused(`${TRANSITION_FLAG} needs a value.`);
  }
  const changeSet = changeSetPath === undefined ? null
    : parseTransitionChangeSet(readEvidenceFile(changeSetPath, 'the transition change set').text);

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
    clubSeasonsExpectedRows: readStageNineExpectedRows(sources.rebuild, JSON.parse(sources.contract)),
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
    aflApiOwnershipCensuses,
  };

  // The reviewed transition (optional) is judged against the bytes on disk before anything runs.
  let prepared: PreparedTransition | null = null;
  if (changeSet !== null) {
    const bound = (file: { relative: string; bytes: Buffer }) => ({
      path: file.relative, sha256: sha256Hex(file.bytes),
    });
    const inputs: Record<InputRole, { path: string; sha256: string }> = {
      core_manifest: bound(core),
      ladder_manifest: bound(witness),
      ladder_coverage: bound(coverage),
      stat_availability: bound(statAvailability),
      accepted_corrections: bound(acceptedCorrections),
    };
    prepared = prepareTransition({
      changeSet,
      season: args.season,
      currentContract: current.contract,
      readRepo: readRepoBytes,
      readProposed: (path) => readEvidenceFile(path, 'a proposed transition file').bytes,
      inputs,
    });
  }

  // STAGE 1. Every refusal that needs no validator evidence happens here: an
  // incoherent or half-rolled starting state, a candidate covering the wrong
  // span, a fabricated availability document, an inherited corrections block.
  // Nothing has been spawned and nothing has been written.
  const successor = planSuccessorContract({
    request, current, currentSources: sources, evidence: successorEvidence,
    transition: prepared?.transition,
  });

  // AFLDB-ISSUE-316 C2: the next in-progress season and the AFL Tables
  // retirement land in one write. Refuses here, before any gate is spawned,
  // unless the switch is active and bounded to exactly this season.
  if (!existsSync(join(REPO_ROOT, AFLTABLES_NETWORK_PATH))) {
    throw new RolloverRefused(`${AFLTABLES_NETWORK_PATH} does not exist, so the rollover cannot `
      + 'retire AFL Tables network fetching in the same write as the next in-progress season.');
  }
  const networkRetirement = planAfltablesNetworkRetirement({
    completedSeason: successor.completedSeason,
    rolloverDate: args.rolloverDate,
    decision: retirementDecision,
    currentSource: readRepoFile(AFLTABLES_NETWORK_PATH),
    currentSeasons: current.seasons,
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
      transition: prepared?.transition,
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
    console.log(`  ${networkRetirement.file.path}${networkRetirement.file.reformatted ? '  (JSON reformatted)' : ''}`
      + '  (AFLDB-ISSUE-316: written first)');
    console.log(`  - ${networkRetirement.note}`);

    // The write set: the AFL Tables switch first (an interrupted write leaves AFL Tables retired,
    // never fetching the next season), then whole-file replacements, then the planner's files.
    // Without a change set it is exactly the planner's own files, as before.
    let writeSet: PlannedFile[] = [networkRetirement.file, ...plan.files];
    let binding: ApplyBinding;
    if (prepared === null) {
      // No change set: the planner's own output, as before, but still bound to the bytes judged so
      // a working-tree edit between the gates and the write is refused rather than journaled.
      binding = validateTransitionState({
        files: writeSet, readRepo: readRepoBytes, validate: () => null,
      }).binding;
    } else {
      const judged = assertTransitionWriteSet({ prepared, planned: writeSet, apply });
      writeSet = judged.files;

      // The complete PROPOSED state, judged by the rebuild's own validators before anything is
      // written and before any hash is offered for pinning. Nothing is written to the working tree.
      const validated = validateTransitionState({
        files: writeSet,
        readRepo: readRepoBytes,
        validate: (documents) => validateProposedRebuildState({
          ...documents, witnessManifest: witness.text, baseRebuild: sources.rebuild,
        }),
      });
      binding = validated.binding;
      console.log('\nPROPOSED-STATE VALIDATION - the rebuild\'s own validators over the proposed bytes '
        + '(nothing written; no database)');
      console.log(`  accepted baseline          ${validated.verdict.acceptedLabel}`);
      console.log(`  ladder profile (selector)  ${validated.verdict.ladderProfile}`);
      console.log(`  club_seasons expected      ${validated.verdict.expectedRows}`);
      console.log(`  final-validation checks    ${validated.verdict.finalChecks.length} built from the proposal`);
      console.log('  PENDING - needs the isolated database phase; not proven here:');
      for (const line of validated.verdict.pendingDatabase) console.log(`    - ${line}`);
      console.log('  Continuity and the ladder witness were judged by the executed gates above, '
        + 'against these same contract bytes.');

      console.log('\ntransition change set (every file, old -> new bytes; validated together)');
      for (const note of prepared.notes) console.log(`  - ${note}`);
      for (const line of formatTransitionDiff(describeTransitionDiff(writeSet, readRepoBytes))) {
        console.log(line);
      }
      if (prepared.changeSet.finalSha256 === null) {
        console.log('\nfinal_sha256 (review the diff above, then pin these in the change set; '
          + '--apply requires them)');
        for (const [path, hash] of Object.entries(judged.finalHashes)) {
          console.log(`  "${path}": "${hash}",`);
        }
      } else {
        console.log('\nfinal_sha256 pins match this plan for every file.');
      }
    }

    if (!apply) {
      console.log('\nDRY RUN — nothing was written. Every gate above still ran. '
        + 'Re-run with --apply --acknowledge-season-complete to write these files.');
      return 0;
    }

    // Every check has passed. Only now does anything reach the filesystem: staged, journaled,
    // renamed, then read back against the plan.
    applyStagedWrites(repoIo, args.season, writeSet, binding);

    console.log(`\nWROTE ${writeSet.length} files.`);
    console.log('Review the diff before anything else. Git is the recovery boundary for the old '
      + 'bytes; if this process was interrupted the next invocation refuses and prints the steps.');
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
