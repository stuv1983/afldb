/**
 * AFLDB-ISSUE-101 — end-of-season rollover planner.
 *
 * WHY A NEW FILE. `tests/db-test-rebuild.test.ts` owns the rebuild
 * orchestrator, and `tests/reference-data.test.ts` owns the tracked datasets;
 * the rollover planner is a new subsystem that spans both plus the fitzRoy
 * contract, so neither is its semantic home. It still REUSES the existing
 * authorities rather than restating them: the stage-9 boundary proof below
 * calls the real `finalValidationChecks()`, and the artefact-digest proof
 * recomputes the REAL accepted baseline's tracked hash.
 *
 * 2026 IS NOT ROLLED HERE. Every scenario runs on synthetic in-memory
 * documents. The one thing these tests do to the real repository is READ it,
 * and one test asserts byte-for-byte that a complete planning run leaves every
 * real reference file untouched.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CONTRACT_PATH,
  IDENTITY_SCAN_SOURCE_NOTE,
  IMPORTER,
  LADDER_VALIDATOR,
  REBUILD_PATH,
  REGISTER_PATH,
  RolloverRefused,
  SEASONS_PATH,
  STAT_AVAILABILITY_PATH,
  artefactSetDigest,
  assertCoherent,
  assertIdentityScanMeasured,
  assertLadderValidatorRun,
  assertPreApplyAuthority,
  applyRegisterPatches,
  assertRegisterHistoryPreserved,
  assertValidatorRun,
  lineEndingOf,
  manifestRowTotal,
  type ValidatorOverride,
  type ValidatorRun,
  parseRolloverArgv,
  parseValidatorEvidence,
  planClubSeasonsConstantEdit,
  planSeasonRollover,
  planSuccessorContract,
  readClubSeasonsExpectedRows,
  retirementVocabulary,
  selectAccepted,
  type RolloverRequest,
  type TransitionInput,
} from '../src/lib/rollover/season-rollover';
import { planAfltablesNetworkRetirement } from '../src/lib/rollover/afltables-network-retirement';
import {
  PLANNER_OWNED_WRITES,
  SENTINEL_MARKER,
  TRANSACTION_JOURNAL_SCHEMA,
  TRANSACTION_JOURNAL_PATH,
  TRANSITION_SCHEMA,
  applyStagedWrites,
  assertNoSentinel,
  assertTransitionWriteSet,
  buildTransactionJournal,
  classifyTransaction,
  describeTransitionDiff,
  formatTransitionDiff,
  parseTransitionChangeSet,
  pendingTransactionProblem,
  prepareTransition,
  recoveryRequirements,
  sha256Hex,
  type FileIo,
  type InputRole,
} from '../src/lib/rollover/transition-change-set';
import { censusRecord, type CensusScope } from '../src/lib/rollover/afl-api-ownership-census';
import { finalValidationChecks } from '../tools/db/rebuild-test';

const root = process.cwd();

// ---------------------------------------------------------------------------
// Synthetic fixtures — "accepted through 2025, 2026 in progress"
// ---------------------------------------------------------------------------

const FIRST_SEASON = 1897;
const COMPLETING = 2026;
const RETIRED_LABEL = 'full-history-20250101';
const NEW_LABEL = 'full-history-20261103';
const OLD_WITNESS = 'ladder-20250101';
const NEW_WITNESS = 'ladder-20261103';
const DATE = '2026-11-03';

/** Deterministic per-season ladder row counts, so min/max/total are provable. */
const ladderRows = (season: number): number =>
  (season === 1916 ? 4 : season >= 2012 ? 18 : 8);

function ladderTotal(lastSeason: number): number {
  let total = 0;
  for (let s = FIRST_SEASON; s <= lastSeason; s += 1) total += ladderRows(s);
  return total;
}

const ROWS_2025 = ladderTotal(2025);
const ROWS_2026 = ladderTotal(2026);

function ladderManifest(lastSeason: number, label: string): Record<string, unknown> {
  const files = [];
  for (let s = FIRST_SEASON; s <= lastSeason; s += 1) {
    files.push({
      dataset: 'ladder',
      filename: `ladder_${s}.csv`,
      row_count: ladderRows(s),
      sha256: createHash('sha256').update(`ladder-${s}`).digest('hex'),
    });
  }
  return {
    adapter: 'tools/rebuild/fitzroy/acquire_core.R',
    adapter_schema_version: 1,
    fitzroy_version_pinned: '1.8.0',
    extraction_date: DATE,
    extraction_timestamp_utc: `${DATE}T01:00:00Z`,
    snapshot_label: label,
    requested_range: { from: FIRST_SEASON, to: lastSeason },
    datasets_requested: ['ladder'],
    files,
  };
}

function coreManifest(lastSeason: number, label: string): Record<string, unknown> {
  const files = [];
  for (let s = FIRST_SEASON; s <= lastSeason; s += 1) {
    files.push({
      dataset: 'player_stats',
      filename: `player_stats_${s}.csv`,
      row_count: 100 + (s % 7),
      sha256: createHash('sha256').update(`core-${s}`).digest('hex'),
    });
  }
  files.push({ dataset: 'results', filename: 'results.csv', row_count: 500,
    sha256: createHash('sha256').update('results').digest('hex') });
  files.push({ dataset: 'player_details', filename: 'player_details.csv', row_count: 900,
    sha256: createHash('sha256').update('details').digest('hex') });
  return {
    adapter: 'tools/rebuild/fitzroy/acquire_core.R',
    adapter_schema_version: 1,
    fitzroy_version_pinned: '1.8.0',
    extraction_date: DATE,
    extraction_timestamp_utc: `${DATE}T01:54:19Z`,
    snapshot_label: label,
    requested_range: { from: FIRST_SEASON, to: lastSeason },
    datasets_requested: ['player_stats', 'player_details', 'results'],
    files,
  };
}

const SNAPSHOT_DIR = `data/sources/afltables/fitzroy_core/${NEW_LABEL}`;
const CORE_MANIFEST_PATH =
  `docs/rebuild-manifests/afltables_fitzroy_core/${NEW_LABEL}.json`;

/**
 * The temporary successor documents the CLI materialises, and the reviewed
 * availability document it points the gates at. Paths only — the planner binds
 * these runs by their BYTES, which is what makes them evidence about this plan.
 */
const TMP_CONTRACT = '/tmp/afldb-rollover-x/fitzroy-contract.json';
const TMP_REGISTER = '/tmp/afldb-rollover-x/fitzroy-accepted-baselines.json';
const REVIEWED_STAT_PATH = 'artifacts/rollover/stat-availability.json';
const LADDER_MANIFEST_DIR = 'docs/rebuild-manifests/afltables_fitzroy_core';
const LADDER_MANIFEST_PATH = `${LADDER_MANIFEST_DIR}/${NEW_WITNESS}.json`;

/** The measured identity coverage the full-history gate prints. */
function identityScan(over: Record<string, number> = {}): Record<string, number> {
  return {
    rows: 695002, missing_id: 83, missing_url: 0, malformed_url: 0,
    distinct_ids: 13395, distinct_urls: 13400, ...over,
  };
}

const block = (o: Record<string, string | number>) =>
  Object.entries(o).map(([k, v]) => `  ${k.padEnd(28)} ${v}`).join('\n');

/**
 * What `import_fitzroy_core.py --validate-only --require-full-history` really
 * prints: the summary block AND the identity-coverage block. Both are required
 * now that the full-history gate runs pre-apply against the successor contract.
 */
function validatorOutput(
  over: Record<string, string | number> = {},
  coverage: Record<string, number> | null = null,
): string {
  const summary: Record<string, string | number> = {
    matches: 17000,
    matches_with_player_rows: 17000,
    attendance_known: 15400,
    players: 13400,
    players_with_dob: 860,
    players_with_dob_conflict: 0,
    player_match_rows: 695000,
    venues: 52,
    seasons: `${FIRST_SEASON}-${COMPLETING}`,
    club_identities: 'Adelaide, Brisbane Bears, Carlton, Collingwood',
    brownlow_round_vote_rows: 323000,
    ...over,
  };
  const lines = ['snapshot scan summary', block(summary)];
  if (coverage !== null) {
    lines.push('full-history gates PASSED — identity coverage', block(coverage));
  }
  lines.push('');
  return lines.join('\n');
}

/** Summary + coverage: the real shape of a passing pre-apply gate run. */
function gateOutput(
  over: Record<string, string | number> = {},
  coverageOver: Record<string, number> = {},
): string {
  return validatorOutput(over, identityScan(coverageOver));
}

/** A captured run of the real full-history gate, as the CLI would produce it. */
function validatorRun(over: Partial<ValidatorRun> = {}): ValidatorRun {
  return {
    argv: ['/usr/bin/python3', IMPORTER, '--label', NEW_LABEL,
      '--snapshot-dir', SNAPSHOT_DIR, '--manifest', CORE_MANIFEST_PATH,
      '--validate-only', '--require-full-history',
      '--contract', TMP_CONTRACT, '--stat-availability', REVIEWED_STAT_PATH],
    status: 0,
    stdout: gateOutput(),
    stderr: '',
    ...over,
  };
}

/** A captured run of the acceptance gate against the successor register. */
function acceptanceRun(over: Partial<ValidatorRun> = {}): ValidatorRun {
  return {
    argv: ['/usr/bin/python3', IMPORTER, '--label', NEW_LABEL,
      '--snapshot-dir', SNAPSHOT_DIR, '--manifest', CORE_MANIFEST_PATH,
      '--validate-only', '--require-accepted-baseline',
      '--contract', TMP_CONTRACT, '--stat-availability', REVIEWED_STAT_PATH,
      '--accepted-baselines', TMP_REGISTER],
    status: 0,
    stdout: gateOutput(),
    stderr: '',
    ...over,
  };
}

/** A captured run of the OFFLINE half of the ladder witness validator. */
function ladderRun(over: Partial<ValidatorRun> = {}): ValidatorRun {
  return {
    argv: ['/usr/bin/python3', LADDER_VALIDATOR, '--label', NEW_WITNESS,
      '--contract', TMP_CONTRACT, '--manifest-dir', LADDER_MANIFEST_DIR],
    status: 0,
    stdout: 'All checks passed.',
    stderr: '',
    ...over,
  };
}

function baseRegister(): Record<string, unknown> {
  return {
    contract: 'afldb.fitzroy.accepted_baselines',
    schema_version: 1,
    selection_policy: {
      rule: 'exactly_one_accepted',
      retired_statuses: ['retired'],
    },
    baselines: [{
      snapshot_label: RETIRED_LABEL,
      acceptance_status: 'accepted',
      accepted_on: '2025-01-01',
      issue: 'AFLDB-ISSUE-093',
      competition: "VFL/AFL men's senior competition",
      snapshot_dir: `data/sources/afltables/fitzroy_core/${RETIRED_LABEL}`,
      acquisition: {
        manifest_path: `docs/rebuild-manifests/afltables_fitzroy_core/${RETIRED_LABEL}.json`,
        manifest_sha256: 'a'.repeat(64),
        immutable: true,
        adapter: 'tools/rebuild/fitzroy/acquire_core.R',
        adapter_schema_version: 1,
        extraction_timestamp_utc: '2025-01-01T00:00:00Z',
        fitzroy_version_pinned: '1.8.0',
        $comment: ['carried acquisition comment'],
      },
      raw_artefacts: {
        file_count: 130, total_rows: 700000,
        artefact_set_sha256: 'b'.repeat(64),
        digest_rule: 'sha256 over sorted lines',
        $comment: ['carried raw comment'],
      },
      contract_binding: {
        fitzroy_contract: 'tools/rebuild/fitzroy/fitzroy-contract.json',
        contract_version: 1,
        contract_full_history_version: 1,
        required_range: { first_season: FIRST_SEASON, last_season: 2025 },
        required_datasets: ['player_stats', 'player_details', 'results'],
      },
      validation: {
        authority: 'tools/migration/import_fitzroy_core.py',
        command: `import_fitzroy_core.py --label ${RETIRED_LABEL} --validate-only`,
        verdict: 'PASSED', validated_on: '2025-01-01', database_accessed: false,
        $comment: ['carried validation comment'],
      },
      measured: {
        $comment: 'Drift gates.',
        matches: 16838, matches_with_player_rows: 16838,
        seasons_first: FIRST_SEASON, seasons_last: 2025,
        venues: 52, attendance_known: 15187, club_identities: 4,
        players: 13275, players_with_dob: 855, players_with_dob_conflict: 0,
        player_match_rows: 685471, brownlow_round_vote_rows: 320861,
      },
      identity_scan: {
        $comment: ['carried identity comment'],
        rows: 685473, missing_id: 83, missing_url: 0, malformed_url: 0,
        distinct_ids: 13270, distinct_urls: 13275,
      },
      accepted_corrections: outgoingCorrections(),
    }],
  };
}

function baseSeasons(): Record<string, unknown> {
  return {
    first_season: FIRST_SEASON,
    last_season: COMPLETING,
    league_eras: [
      { league: 'VFL', first_season: FIRST_SEASON, last_season: 1989 },
      { league: 'AFL', first_season: 1990, last_season: null },
    ],
    in_progress_seasons: [COMPLETING],
    season_notes: { '2026': 'Season in progress at time of import.' },
  };
}

function baseContract(): Record<string, unknown> {
  return {
    contract_version: 1,
    pinned_version: '1.8.0',
    full_history: {
      contract_full_history_version: 1,
      required_datasets: ['player_stats', 'player_details', 'results'],
      season_range: {
        first_season: FIRST_SEASON,
        last_season: 2025,
        last_season_rule: 'the latest COMPLETED season',
        resolved_on: '2025-01-01',
      },
      current_season_excluded: { seasons: [COMPLETING], reason: 'current-season pipeline' },
      approved_source_gaps: { seasons: [] },
    },
    datasets: {
      ladder: {
        fitzroy_function: 'fetch_ladder_afltables',
        role: 'VALIDATION_WITNESS',
        accepted_witness: {
          $comment: 'durability binding',
          snapshot_label: OLD_WITNESS,
          manifest: `docs/rebuild-manifests/afltables_fitzroy_core/${OLD_WITNESS}.json`,
          manifest_sha256: 'c'.repeat(64),
          files: 129,
          rows: ROWS_2025,
          acquired_on: '2025-01-01',
          validator: `tools/rebuild/fitzroy/validate_ladder_witness.py --label ${OLD_WITNESS}`,
          not_validated_by: 'import_fitzroy_core.py',
        },
        coverage: {
          $comment: 'Exhaustive read-only probe, 1897-2025.',
          first_season: FIRST_SEASON,
          last_season: 2025,
          seasons_returned: 129,
          club_season_rows: ROWS_2025,
          distinct_labels: 20,
          min_rows_season: { season: 1916, rows: 4 },
          max_rows_season: { seasons: '2012-2025', rows: 18 },
          exact_points_and_percentage_ties: 0,
        },
      },
    },
  };
}

function reviewedCoverage(): Record<string, unknown> {
  return {
    $comment: 'Exhaustive read-only probe, 1897-2026, re-run at rollover.',
    first_season: FIRST_SEASON,
    last_season: COMPLETING,
    seasons_returned: COMPLETING - FIRST_SEASON + 1,
    club_season_rows: ROWS_2026,
    distinct_labels: 20,
    min_rows_season: { season: 1916, rows: 4 },
    max_rows_season: { seasons: '2012-2026', rows: 18 },
    exact_points_and_percentage_ties: 0,
  };
}

function baseStatAvailability(): Record<string, unknown> {
  return {
    status: 'READY',
    coverage_ranges: [
      { stat_key: 'goals', coverage: 'complete', first_season: FIRST_SEASON,
        last_season: COMPLETING },
      { stat_key: 'brownlow_round_votes', coverage: 'complete', first_season: 1924,
        last_season: 2025 },
      { stat_key: 'brownlow_round_votes', coverage: 'pending', first_season: COMPLETING,
        last_season: COMPLETING },
    ],
  };
}

/** The reviewed successor: 2026's Brownlow is now counted; 2027 is only pending. */
function reviewedStatAvailability(): Record<string, unknown> {
  return {
    status: 'READY',
    coverage_ranges: [
      { stat_key: 'goals', coverage: 'complete', first_season: FIRST_SEASON,
        last_season: COMPLETING },
      { stat_key: 'goals', coverage: 'pending', first_season: 2027, last_season: 2027 },
      { stat_key: 'brownlow_round_votes', coverage: 'complete', first_season: 1924,
        last_season: COMPLETING },
      { stat_key: 'brownlow_round_votes', coverage: 'pending', first_season: 2027,
        last_season: 2027 },
    ],
  };
}

/**
 * The OUTGOING baseline's corrections. Deliberately distinctive, so a test can
 * tell "reviewed for this acquisition" apart from "copied from the last one".
 */
function outgoingCorrections(): Record<string, unknown> {
  return {
    source_normalisation: [
      { kind: 'source_club_normalisation', rule: 'INHERITED-MARKER 1987-1996',
        dataset_scope: 'all datasets' },
    ],
    source_data: [
      { kind: 'source_row_corrections', rule: 'INHERITED-MARKER two 1909 rows',
        rows_dropped: 2 },
    ],
    import_transformation: [
      { kind: 'display_name_fallback', rule: 'INHERITED-MARKER blank Player',
        rows_affected: 79 },
    ],
  };
}

/** The reviewed state for the CANDIDATE acquisition. Same shape, own findings. */
function reviewedCorrections(): Record<string, unknown> {
  return {
    $comment: ['Reviewed for the candidate acquisition at rollover.'],
    source_normalisation: [
      { kind: 'source_club_normalisation', rule: 'REVIEWED 1987-1996',
        dataset_scope: 'all datasets' },
    ],
    source_data: [],
    import_transformation: [],
  };
}

/** An acquisition that needs no corrections says so explicitly. */
function emptyCorrections(): Record<string, unknown> {
  return { source_normalisation: [], source_data: [], import_transformation: [] };
}

const REBUILD_STUB = [
  '/** doc */',
  'export const CLUB_SEASONS_EXPECTED = {',
  `  rows: ${ROWS_2025},`,
  '  brisbaneLionsFirstSeason: 1997,',
  '};',
  '',
].join('\n');

type Overrides = {
  request?: Partial<RolloverRequest>;
  register?: Record<string, unknown>;
  seasons?: Record<string, unknown>;
  contract?: Record<string, unknown>;
  statAvailability?: Record<string, unknown>;
  reviewedStat?: Record<string, unknown>;
  reviewedStatText?: string;
  acceptedCorrections?: Record<string, unknown> | undefined;
  ladderCoverage?: Record<string, unknown>;
  coreManifest?: Record<string, unknown>;
  ladderManifest?: Record<string, unknown>;
  validatorOutput?: string;
  validatorRun?: ValidatorRun;
  coreValidatorOverrides?: ValidatorOverride[];
  ladderManifestPath?: string;
  rebuildSource?: string;
  clubSeasonsExpectedRows?: number;
  aflApiOwnershipCensuses?: Array<{ path: string; sha256: string; record: unknown }>;
  transition?: TransitionInput;
};

/**
 * AFLDB-ISSUE-233 D-233-3. A census evidence record exactly as the census CLI writes it, for
 * the successor rebuild scope (1897..2026) by default, with no afl_api-owned match.
 */
function censusEvidence(over: {
  database?: string;
  inScope?: Array<[number, number]>;
  outsideScope?: Array<[number, number]>;
  scope?: CensusScope;
  schemaPresent?: boolean;
} = {}): { path: string; sha256: string; record: Record<string, unknown> } {
  const database = over.database ?? 'afldb_test';
  return {
    path: `artifacts/rollover/afl-api-ownership-census-${database}.json`,
    sha256: 'a'.repeat(64),
    record: censusRecord({
      database,
      scope: over.scope ?? { firstSeason: FIRST_SEASON, lastSeason: COMPLETING, excludedSeasons: [] },
      schemaPresent: over.schemaPresent ?? true,
      inScope: (over.inScope ?? []).map(([season, aflApiMatches]) => ({ season, aflApiMatches })),
      outsideScope: (over.outsideScope ?? []).map(([season, aflApiMatches]) => ({ season, aflApiMatches })),
    }, { capturedAtUtc: '2026-11-03T00:00:00Z', sqlSha256: 'b'.repeat(64) }),
  };
}

const serialiseJson = (d: unknown) => `${JSON.stringify(d, null, 2)}\n`;

/** Everything stage one needs, assembled exactly the way the CLI assembles it. */
function stageOneInput(over: Overrides = {}) {
  const register = over.register ?? baseRegister();
  const seasons = over.seasons ?? baseSeasons();
  const contract = over.contract ?? baseContract();
  const statAvailability = over.statAvailability ?? baseStatAvailability();
  const rebuild = over.rebuildSource ?? REBUILD_STUB;
  const reviewedStat = over.reviewedStat ?? reviewedStatAvailability();

  return {
    request: {
      season: COMPLETING,
      acknowledgeSeasonComplete: true,
      rolloverDate: DATE,
      retirementStatus: 'retired',
      expectedClubSeasonRows: over.clubSeasonsExpectedRows ?? ROWS_2026,
      ...over.request,
    },
    current: {
      register, seasons, contract, statAvailability,
      clubSeasonsExpectedRows: readClubSeasonsExpectedRows(rebuild),
    },
    currentSources: {
      register: serialiseJson(register),
      seasons: serialiseJson(seasons),
      contract: serialiseJson(contract),
      statAvailability: serialiseJson(statAvailability),
      rebuild,
    },
    evidence: {
      coreManifest: over.coreManifest ?? coreManifest(COMPLETING, NEW_LABEL),
      coreManifestPath: CORE_MANIFEST_PATH,
      coreSnapshotDir: SNAPSHOT_DIR,
      ladderManifest: over.ladderManifest ?? ladderManifest(COMPLETING, NEW_WITNESS),
      ladderManifestSha256: 'e'.repeat(64),
      ladderManifestPath: over.ladderManifestPath ?? LADDER_MANIFEST_PATH,
      ladderCoverage: over.ladderCoverage ?? reviewedCoverage(),
      statAvailability: reviewedStat,
      statAvailabilityText: over.reviewedStatText ?? serialiseJson(reviewedStat),
      acceptedCorrections: 'acceptedCorrections' in over
        ? (over.acceptedCorrections as never)
        : reviewedCorrections(),
      aflApiOwnershipCensuses: over.aflApiOwnershipCensuses ?? [censusEvidence()],
    },
    transition: over.transition,
  };
}

/**
 * The CLI's own sequence, in memory: compute the successor contract, "write"
 * it, then hand the gate run that was pointed at those bytes to stage two.
 */
function run(over: Overrides = {}) {
  const input = stageOneInput(over);
  const successor = planSuccessorContract(input);
  const overrides = over.coreValidatorOverrides ?? [
    { flag: '--contract', path: TMP_CONTRACT, bytes: successor.contractContent },
    { flag: '--stat-availability', path: REVIEWED_STAT_PATH,
      bytes: input.evidence.statAvailabilityText },
  ];

  return planSeasonRollover({
    ...input,
    evidence: {
      ...input.evidence,
      coreManifestSha256: 'd'.repeat(64),
      coreValidatorRun: over.validatorRun
        ?? validatorRun(over.validatorOutput ? { stdout: over.validatorOutput } : {}),
      coreValidatorOverrides: overrides,
    },
  });
}

/** The overrides a passing acceptance gate carries, for a given plan. */
function acceptanceOverrides(plan: ReturnType<typeof run>): ValidatorOverride[] {
  return [
    { flag: '--contract', path: TMP_CONTRACT,
      bytes: plan.authority.successorContractContent },
    { flag: '--stat-availability', path: REVIEWED_STAT_PATH,
      bytes: plan.authority.reviewedStatAvailabilityContent },
    { flag: '--accepted-baselines', path: TMP_REGISTER,
      bytes: plan.authority.successorRegisterContent },
  ];
}

function ladderOverrides(plan: ReturnType<typeof run>): ValidatorOverride[] {
  return [{ flag: '--contract', path: TMP_CONTRACT,
    bytes: plan.authority.successorContractContent }];
}

/** Both remaining pre-apply gates, passing, exactly as the CLI would run them. */
function proveAuthority(plan: ReturnType<typeof run>, over: {
  acceptance?: Partial<ValidatorRun>;
  ladder?: Partial<ValidatorRun>;
  acceptanceOverrides?: ValidatorOverride[];
  ladderOverrides?: ValidatorOverride[];
} = {}) {
  assertPreApplyAuthority({
    plan,
    acceptance: {
      run: acceptanceRun(over.acceptance),
      overrides: over.acceptanceOverrides ?? acceptanceOverrides(plan),
    },
    ladder: {
      run: ladderRun(over.ladder),
      overrides: over.ladderOverrides ?? ladderOverrides(plan),
    },
  });
}

const fileIn = (plan: ReturnType<typeof run>, path: string) =>
  plan.files.find((f) => f.path === path)!;

const jsonIn = (plan: ReturnType<typeof run>, path: string) =>
  JSON.parse(fileIn(plan, path).content) as Record<string, unknown>;

/** Descend one level without a cast at every call site. */
const nested = (doc: Record<string, unknown>, key: string) =>
  doc[key] as Record<string, unknown>;

// ---------------------------------------------------------------------------

describe('fixture sanity', () => {
  it('models a real advance: 2025 -> 2026 adds one season of club-seasons', () => {
    expect(ROWS_2026).toBe(ROWS_2025 + 18);
    expect(readClubSeasonsExpectedRows(REBUILD_STUB)).toBe(ROWS_2025);
  });
});

describe('validator evidence', () => {
  it('reads the measured fingerprint out of the validator, not out of a flag', () => {
    const { measured } = parseValidatorEvidence(gateOutput());
    expect(measured.matches).toBe(17000);
    expect(measured.seasons_first).toBe(1897);
    expect(measured.seasons_last).toBe(2026);
    // enforce_accepted_fingerprint() counts the comma-separated identity list.
    expect(measured.club_identities).toBe(4);
  });

  it('reads identity coverage out of the same run, not out of an input', () => {
    const { identityScan: scan } = parseValidatorEvidence(gateOutput());
    expect(scan).toEqual(identityScan());
  });

  it('refuses output missing a measured key rather than inventing a partial record', () => {
    const stripped = gateOutput().split('\n')
      .filter((l) => !l.includes('brownlow_round_vote_rows')).join('\n');
    expect(() => parseValidatorEvidence(stripped)).toThrow(/brownlow_round_vote_rows/);
  });

  it('refuses a run whose full-history gate never produced identity coverage', () => {
    // A bare `--validate-only` scan: exactly what the previous design accepted,
    // and exactly what is no longer sufficient.
    expect(() => parseValidatorEvidence(validatorOutput()))
      .toThrow(/full-history gate did not run/);
  });

  it('refuses an identity-coverage block the parser could not read as counts', () => {
    expect(() => parseValidatorEvidence(gateOutput({}, { missing_url: -1 })))
      .toThrow(/'missing_url' is not a whole count/);
    expect(() => parseValidatorEvidence(gateOutput({}, { distinct_urls: 999999 })))
      .toThrow(/internally impossible/);
  });

  it('refuses an unparsable season span', () => {
    expect(() => parseValidatorEvidence(gateOutput({ seasons: '2026' })))
      .toThrow(/not a FIRST-LAST range/);
  });
});

describe('the validator is the authority — a transcript is not', () => {
  const successorContract = planSuccessorContract(stageOneInput()).contractContent;
  const reviewedStatText = serialiseJson(reviewedStatAvailability());
  const expected = {
    label: NEW_LABEL, manifestPath: CORE_MANIFEST_PATH, snapshotDir: SNAPSHOT_DIR,
    gate: 'full-history' as const,
    requiredOverrides: [
      { flag: '--contract', content: successorContract },
      { flag: '--stat-availability', content: reviewedStatText },
    ],
    overrides: [
      { flag: '--contract', path: TMP_CONTRACT, bytes: successorContract },
      { flag: '--stat-availability', path: REVIEWED_STAT_PATH, bytes: reviewedStatText },
    ],
  };

  it('accepts a real passing run of the right command against the right artefacts', () => {
    expect(assertValidatorRun(validatorRun(), expected)).toContain('snapshot scan summary');
  });

  it('refuses a non-zero exit however good the output looks', () => {
    // The whole point: stdout that parses perfectly is still not a verdict.
    expect(() => run({ validatorRun: validatorRun({ status: 1, stderr: 'boom' }) }))
      .toThrow(/did not pass \(exit 1\)/);
    expect(() => run({ validatorRun: validatorRun({ status: 1, stderr: 'boom' }) }))
      .toThrow(/boom/);
  });

  it('refuses a run killed by a signal', () => {
    expect(() => assertValidatorRun(validatorRun({ status: null }), expected))
      .toThrow(/exit signal/);
  });

  it('refuses evidence that is not a captured run at all', () => {
    expect(() => assertValidatorRun(undefined as never, expected))
      .toThrow(/never from a file or a flag/);
    expect(() => assertValidatorRun({ stdout: validatorOutput() } as never, expected))
      .toThrow(/never from a file or a flag/);
  });

  it('refuses a run of some other command', () => {
    expect(() => assertValidatorRun(
      validatorRun({ argv: ['python', 'tools/other.py', '--validate-only'] }), expected))
      .toThrow(new RegExp(`did not invoke ${IMPORTER}`));
  });

  it('refuses a run that was not the offline validation', () => {
    const argv = validatorRun().argv.filter((a) => a !== '--validate-only');
    expect(() => assertValidatorRun(validatorRun({ argv }), expected))
      .toThrow(/did not carry --validate-only/);
  });

  it('refuses a bare scan that never carried the full-history gate', () => {
    const argv = validatorRun().argv.filter((a) => a !== '--require-full-history');
    expect(() => assertValidatorRun(validatorRun({ argv }), expected))
      .toThrow(/did not carry --require-full-history/);
  });

  it('refuses a gate run that was never pointed at the successor contract', () => {
    const argv = validatorRun().argv
      .filter((a) => a !== '--contract' && a !== TMP_CONTRACT);
    expect(() => assertValidatorRun(
      validatorRun({ argv }),
      { ...expected, overrides: [expected.overrides[1]] }))
      .toThrow(/records no --contract override/);
  });

  it('refuses a gate run pointed at a contract that is not this plan\'s successor', () => {
    // The whole point of reading the temporary file back: bytes, not promises.
    expect(() => assertValidatorRun(validatorRun(), {
      ...expected,
      overrides: [
        { flag: '--contract', path: TMP_CONTRACT, bytes: '{"contract_version":99}\n' },
        expected.overrides[1],
      ],
    })).toThrow(/is not the successor document this plan computed/);
  });

  it('refuses a gate run whose override path is not the file that was written', () => {
    expect(() => assertValidatorRun(validatorRun(), {
      ...expected,
      overrides: [
        { flag: '--contract', path: '/tmp/elsewhere.json', bytes: successorContract },
        expected.overrides[1],
      ],
    })).toThrow(/but the temporary document written for it is/);
  });

  it('refuses a run redirected at a reference document this plan did not compute', () => {
    const argv = [...validatorRun().argv, '--accepted-baselines', '/tmp/someone-elses.json'];
    expect(() => assertValidatorRun(validatorRun({ argv }), expected))
      .toThrow(/carried --accepted-baselines, which redirects it/);
  });

  it('refuses a run carrying a flag that changes what it adjudicates', () => {
    for (const flag of ['--dry-run', '--require-in-season', '--emit-observations']) {
      expect(() => assertValidatorRun(
        validatorRun({ argv: [...validatorRun().argv, flag] }), expected))
        .toThrow(new RegExp(`carried ${flag}`));
    }
  });

  it('refuses a run pointed at a different label, manifest or snapshot', () => {
    const swap = (from: string, to: string) =>
      validatorRun({ argv: validatorRun().argv.map((a) => (a === from ? to : a)) });
    expect(() => assertValidatorRun(swap(NEW_LABEL, 'some-other-label'), expected))
      .toThrow(/--label "some-other-label"/);
    expect(() => assertValidatorRun(swap(CORE_MANIFEST_PATH, 'docs/other.json'), expected))
      .toThrow(/--manifest "docs\/other.json"/);
    expect(() => assertValidatorRun(swap(SNAPSHOT_DIR, 'data/elsewhere'), expected))
      .toThrow(/--snapshot-dir "data\/elsewhere"/);
  });

  it('refuses a run that omitted the bindings entirely', () => {
    expect(() => assertValidatorRun(
      validatorRun({ argv: ['python', IMPORTER, '--validate-only'] }), expected))
      .toThrow(/did not pass --label/);
  });

  it('binds the acceptance record to the artefacts the validator examined', () => {
    // The plan's manifest_path is the same path the captured argv names.
    const next = (jsonIn(run(), 'data/reference/fitzroy-accepted-baselines.json')
      .baselines as Record<string, unknown>[])[1];
    expect((next.acquisition as Record<string, unknown>).manifest_path)
      .toBe(CORE_MANIFEST_PATH);
    expect(validatorRun().argv).toContain(CORE_MANIFEST_PATH);
  });

  it('offers no way to skip validation or supply a verdict', () => {
    const base = [
      '--season', '2026', '--rollover-date', DATE, '--retire-status', 'retired',
      '--expected-club-season-rows', String(ROWS_2026), '--core-manifest', 'a.json',
      '--ladder-manifest', 'c.json',
      '--ladder-coverage', 'd.json', '--stat-availability', 'e.json',
      '--accepted-corrections', 'f.json',
      // AFLDB-ISSUE-233: required since D-233-3, so the refusal below is the banned flag's alone.
      '--afl-api-ownership-census', 'g.json',
    ];
    expect(() => parseRolloverArgv(base)).not.toThrow();
    for (const banned of ['--skip-validation', '--no-validate', '--force',
      '--core-validator-output', '--assume-validated']) {
      expect(() => parseRolloverArgv([...base, banned]))
        .toThrow(new RegExp(`${banned.replace(/-/g, '\\-')} does not exist`));
    }
    // and every gate is executed and adjudicated before a single write.
    const cli = readFileSync(join(root, 'tools', 'db', 'rollover-season.ts'), 'utf8');
    expect(cli).toContain('spawnSync');
    expect(cli.indexOf('assertPreApplyAuthority({'))
      .toBeLessThan(cli.indexOf('applyStagedWrites(repoIo, args.season, writeSet)'));
    expect(cli.indexOf('planSuccessorContract({'))
      .toBeLessThan(cli.indexOf('runPython(fullHistoryArgv'));
  });
});

describe('identity_scan is MEASURED, not supplied', () => {
  it('accepts a complete, internally possible measured scan', () => {
    expect(assertIdentityScanMeasured(identityScan()).distinct_urls).toBe(13400);
  });

  it('records that the executed full-history gate is its only source', () => {
    expect(IDENTITY_SCAN_SOURCE_NOTE).toMatch(/MEASURED by the executed/);
    expect(IDENTITY_SCAN_SOURCE_NOTE).toMatch(/never an operator input/);
  });

  it('has no operator flag left to supply one', () => {
    const source = readFileSync(
      join(root, 'src', 'lib', 'rollover', 'season-rollover.ts'), 'utf8');
    // Only the refusal mentions it; there is no `need('--identity-scan')`.
    expect(source).not.toMatch(/need\('--identity-scan'\)/);
    expect(source).toMatch(/--identity-scan no longer exists/);
  });

  it('refuses a partial, non-integer or unknown-keyed coverage block', () => {
    const partial = identityScan();
    delete (partial as Record<string, unknown>).missing_id;
    expect(() => assertIdentityScanMeasured(partial))
      .toThrow(/'missing_id' is not a whole count/);
    expect(() => assertIdentityScanMeasured(identityScan({ rows: -1 })))
      .toThrow(/'rows' is not a whole count/);
    expect(() => assertIdentityScanMeasured({ ...identityScan(), invented: 1 }))
      .toThrow(/unknown key\(s\): invented/);
  });

  it('refuses an internally impossible coverage block', () => {
    expect(() => assertIdentityScanMeasured(identityScan({ distinct_urls: 999999 })))
      .toThrow(/internally impossible/);
    expect(() => assertIdentityScanMeasured(identityScan({ distinct_ids: 13401 })))
      .toThrow(/internally impossible/);
  });

  it('carries the gate\'s own numbers into the new baseline', () => {
    const plan = run({
      validatorRun: validatorRun({ stdout: gateOutput({}, { missing_id: 91 }) }),
    });
    const next = (jsonIn(plan, 'data/reference/fitzroy-accepted-baselines.json')
      .baselines as Record<string, unknown>[])[1];
    const scan = next.identity_scan as Record<string, unknown>;
    expect(scan.rows).toBe(695002);
    expect(scan.distinct_urls).toBe(13400);
    // and it tracks the run rather than any fixture constant
    expect(scan.missing_id).toBe(91);
  });
});

describe('pre-apply versus post-rebuild authority is stated, not implied', () => {
  const plan = run();

  it('records the executed pre-apply full-history verdict', () => {
    const notes = plan.notes.join(' ');
    expect(notes).toMatch(/Pre-apply verdict \(1\/3\)/);
    expect(notes).toContain(`${IMPORTER} --validate-only --require-full-history`);
    expect(notes).toMatch(/EXECUTED and exited 0/);
    expect(notes).toMatch(/measured fingerprint and the identity scan above are its output/);
  });

  it('names the other two gates as pre-apply, not post-apply', () => {
    const notes = plan.notes.join(' ');
    expect(notes).toMatch(/Pre-apply gates \(2\/3 and 3\/3\)/);
    expect(notes).toMatch(/--require-accepted-baseline/);
    expect(notes).toContain(LADDER_VALIDATOR);
    expect(notes).toMatch(/Any failure means zero tracked writes/);
    // The old "cannot run before the write" claim is gone, because it is no
    // longer true — the overrides made both runnable pre-apply.
    expect(notes).not.toMatch(/read the tracked contract from a fixed path/);
  });

  it('keeps the --compare cross-check with the rebuild, where it belongs', () => {
    expect(plan.notes.join(' '))
      .toMatch(/Post-REBUILD: .*--compare .*needs the rebuilt database/);
  });
});

describe('the remaining pre-apply gates are executed and adjudicated', () => {
  it('accepts both gates run against exactly this plan\'s successor state', () => {
    const plan = run();
    expect(() => proveAuthority(plan)).not.toThrow();
  });

  it('refuses a failing acceptance gate', () => {
    const plan = run();
    expect(() => proveAuthority(plan, {
      acceptance: { status: 1, stderr: 'drifted from its measured fingerprint' },
    })).toThrow(/did not pass \(exit 1\)/);
  });

  it('refuses an acceptance gate pointed at some other register', () => {
    const plan = run();
    expect(() => proveAuthority(plan, {
      acceptanceOverrides: [
        ...acceptanceOverrides(plan).slice(0, 2),
        { flag: '--accepted-baselines', path: TMP_REGISTER,
          bytes: serialiseJson(baseRegister()) },
      ],
    })).toThrow(/is not the successor document this plan computed/);
  });

  it('refuses an acceptance run that never carried the acceptance gate', () => {
    const plan = run();
    const argv = acceptanceRun().argv.filter((a) => a !== '--require-accepted-baseline');
    expect(() => proveAuthority(plan, { acceptance: { argv } }))
      .toThrow(/did not carry --require-accepted-baseline/);
  });

  it('refuses when the two gate runs do not agree with each other', () => {
    const plan = run();
    expect(() => proveAuthority(plan, {
      acceptance: { stdout: gateOutput({ matches: 17001 }) },
    })).toThrow(/measured a different fingerprint/);
    expect(() => proveAuthority(plan, {
      acceptance: { stdout: gateOutput({}, { missing_id: 84 }) },
    })).toThrow(/measured a different fingerprint/);
  });

  it('refuses a failing or absent offline ladder proof', () => {
    const plan = run();
    expect(() => proveAuthority(plan, { ladder: { status: 1, stderr: '3 check(s)' } }))
      .toThrow(/offline ladder witness validation did not pass/);
    expect(() => assertLadderValidatorRun(undefined as never, {
      witnessLabel: NEW_WITNESS, manifestDir: LADDER_MANIFEST_DIR,
      contractContent: plan.authority.successorContractContent,
      overrides: ladderOverrides(plan),
    })).toThrow(/never assumed/);
  });

  it('refuses a ladder run that reached for the database', () => {
    const plan = run();
    expect(() => proveAuthority(plan, {
      ladder: { argv: [...ladderRun().argv, '--compare'] },
    })).toThrow(/--compare, which reads the rebuilt database/);
  });

  it('refuses a ladder run against the tracked contract or another manifest dir', () => {
    const plan = run();
    expect(() => proveAuthority(plan, { ladderOverrides: [] }))
      .toThrow(/records no --contract override/);
    expect(() => proveAuthority(plan, {
      ladder: { argv: ['py', LADDER_VALIDATOR, '--label', NEW_WITNESS,
        '--contract', TMP_CONTRACT, '--manifest-dir', 'docs/elsewhere'] },
    })).toThrow(/read manifests from "docs\/elsewhere"/);
  });

  it('refuses a ladder run validating a different witness label', () => {
    const plan = run();
    expect(() => proveAuthority(plan, {
      ladder: { argv: ['py', LADDER_VALIDATOR, '--label', OLD_WITNESS,
        '--contract', TMP_CONTRACT, '--manifest-dir', LADDER_MANIFEST_DIR] },
    })).toThrow(/but the rollover is accepting/);
  });

  it('binds the ladder manifest the validator must have hashed', () => {
    const plan = run();
    expect(plan.authority.ladderManifestDir).toBe(LADDER_MANIFEST_DIR);
    // The witness validator reads `<dir>/<label>.json`, so a manifest filed under
    // any other name could never be the file whose sha256 the contract binds.
    expect(() => run({
      ladderManifestPath: `${LADDER_MANIFEST_DIR}/some-other-name.json`,
    })).toThrow(/cannot be the one it validates/);
  });
});

describe('artefact bindings are derived, never supplied', () => {
  it('reproduces the REAL accepted baseline artefact-set digest and totals', () => {
    const register = JSON.parse(readFileSync(
      join(root, 'data', 'reference', 'fitzroy-accepted-baselines.json'), 'utf8'));
    const accepted = selectAccepted(register);
    const manifest = JSON.parse(readFileSync(
      join(root, String((accepted.acquisition as Record<string, unknown>).manifest_path)),
      'utf8'));
    const raw = accepted.raw_artefacts as Record<string, unknown>;
    expect(artefactSetDigest(manifest)).toBe(raw.artefact_set_sha256);
    expect(manifestRowTotal(manifest)).toBe(raw.total_rows);
    expect((manifest.files as unknown[]).length).toBe(raw.file_count);
  });
});

describe('a valid synthetic rollover', () => {
  const plan = run();

  it('advances the completed boundary and the in-progress season together', () => {
    expect(plan.completedSeason).toBe(2026);
    expect(plan.newInProgressSeason).toBe(2027);
    const seasons = jsonIn(plan, 'data/reference/seasons.json');
    expect(seasons.last_season).toBe(2027);
    expect(seasons.in_progress_seasons).toEqual([2027]);
    // The note is carried verbatim, not rewritten.
    expect(seasons.season_notes).toEqual({ '2027': 'Season in progress at time of import.' });
  });

  it('advances the fitzRoy contract in step', () => {
    const fh = nested(jsonIn(plan, 'tools/rebuild/fitzroy/fitzroy-contract.json'),
      'full_history');
    expect(nested(fh, 'season_range').last_season).toBe(2026);
    expect(nested(fh, 'season_range').resolved_on).toBe(DATE);
    expect(nested(fh, 'current_season_excluded').seasons).toEqual([2027]);
    // The rule text states the real numbers rather than keeping a stale sentence.
    expect(nested(fh, 'season_range').last_season_rule)
      .toBe('the latest COMPLETED season: data/reference/seasons.json last_season (2027) '
        + 'minus every entry in in_progress_seasons ([2027])');
  });

  it('keeps exactly one accepted baseline and retires the old one by its own vocabulary', () => {
    const register = jsonIn(plan, 'data/reference/fitzroy-accepted-baselines.json');
    const baselines = register.baselines as Record<string, unknown>[];
    expect(baselines).toHaveLength(2);
    expect(baselines.filter((b) => b.acceptance_status === 'accepted')).toHaveLength(1);
    expect(baselines[0].acceptance_status).toBe('retired');
    expect(baselines[1].snapshot_label).toBe(NEW_LABEL);
    // The measured block is the validator's, and the derived bindings are computed.
    const next = baselines[1];
    expect((next.measured as Record<string, unknown>).seasons_last).toBe(2026);
    expect((next.raw_artefacts as Record<string, unknown>).artefact_set_sha256)
      .toBe(artefactSetDigest(coreManifest(COMPLETING, NEW_LABEL)));
    expect((next.contract_binding as Record<string, Record<string, unknown>>).required_range)
      .toEqual({ first_season: 1897, last_season: 2026 });
    // Corrections are the REVIEWED state for this acquisition, not the old one's.
    expect(next.accepted_corrections).toEqual(reviewedCorrections());
    expect(JSON.stringify(next.accepted_corrections)).not.toContain('INHERITED-MARKER');
    expect(plan.notes.join(' ')).toMatch(/accepted_corrections were REVIEWED/);
  });

  it('advances the accepted ladder witness and stage 9 together', () => {
    const contract = jsonIn(plan, 'tools/rebuild/fitzroy/fitzroy-contract.json');
    const ladder = nested(nested(contract, 'datasets'), 'ladder');
    const witness = nested(ladder, 'accepted_witness');
    expect(witness.snapshot_label).toBe(NEW_WITNESS);
    expect(witness.rows).toBe(ROWS_2026);
    expect(witness.files).toBe(2026 - 1897 + 1);
    expect(witness.validator).toContain(NEW_WITNESS);
    expect(nested(ladder, 'coverage').last_season).toBe(2026);
    expect(plan.clubSeasonRows).toEqual({ from: ROWS_2025, to: ROWS_2026 });
    expect(fileIn(plan, 'tools/db/rebuild-test.ts').content)
      .toContain(`rows: ${ROWS_2026},`);
  });

  it('plans exactly the five coupled artefacts and nothing else', () => {
    expect(plan.files.map((f) => f.path).sort()).toEqual([
      'data/reference/fitzroy-accepted-baselines.json',
      'data/reference/seasons.json',
      'data/reference/stat-availability.json',
      'tools/db/rebuild-test.ts',
      'tools/rebuild/fitzroy/fitzroy-contract.json',
    ]);
  });

  it('says plainly that it writes no canonical row', () => {
    expect(plan.notes.join(' ')).toMatch(/No canonical row is written/);
  });
});

describe('stage 9 re-points itself — the gate is never edited', () => {
  it('evaluates the accepted-last-season boundary at Y from the successor register', () => {
    const plan = run();
    const before = finalValidationChecks(baseRegister());
    const after = finalValidationChecks(
      jsonIn(plan, 'data/reference/fitzroy-accepted-baselines.json'));

    const gate = (checks: ReturnType<typeof finalValidationChecks>) =>
      checks.find((c) => c.key === 'matches_after_accepted_last_season')!;
    expect(gate(before).sql).toContain('season > 2025');
    expect(gate(after).sql).toContain('season > 2026');
    expect(gate(after).expected).toBe(0);
    // The club_seasons sibling boundary moves from the same single source.
    expect(after.find((c) => c.key === 'club_seasons_after_accepted_last_season')!.sql)
      .toContain('season > 2026');

    // And the runner's own source was not touched to achieve it.
    const runner = readFileSync(join(root, 'tools', 'db', 'rebuild-test.ts'), 'utf8');
    expect(runner).toContain('Number(measured.seasons_last)');
  });
});

describe('completion authority', () => {
  it('refuses as a typed RolloverRefused, which is what the CLI exits 2 on', () => {
    expect(() => run({ request: { acknowledgeSeasonComplete: false } }))
      .toThrow(RolloverRefused);
    expect(() => parseRolloverArgv([])).toThrow(RolloverRefused);
  });

  it('refuses without an explicit acknowledgement', () => {
    expect(() => run({ request: { acknowledgeSeasonComplete: false } }))
      .toThrow(/--acknowledge-season-complete/);
  });

  it('refuses a non-explicit rollover date rather than reading a clock', () => {
    expect(() => run({ request: { rolloverDate: '' } })).toThrow(/never reads the system clock/);
    expect(() => run({ request: { rolloverDate: 'today' } })).toThrow(/YYYY-MM-DD/);
  });

  it('reads no clock and no calendar anywhere in the library', () => {
    const source = readFileSync(
      join(root, 'src', 'lib', 'rollover', 'season-rollover.ts'), 'utf8');
    expect(source).not.toMatch(/Date\.now|new Date\(|toISOString/);
  });

  it('performs no database or filesystem access from the library', () => {
    const source = readFileSync(
      join(root, 'src', 'lib', 'rollover', 'season-rollover.ts'), 'utf8');
    expect(source).not.toMatch(/from 'node:fs'|from 'postgres'|readFileSync|writeFileSync/);
  });

  it('refuses a season that is not an integer', () => {
    expect(() => run({ request: { season: 2026.5 } })).toThrow(/not an integer/);
  });
});

describe('argument parsing', () => {
  const complete = [
    '--season', '2026', '--rollover-date', DATE, '--retire-status', 'retired',
    '--expected-club-season-rows', String(ROWS_2026), '--core-manifest', 'a.json',
    '--ladder-manifest', 'c.json',
    '--afl-api-ownership-census', 'g.json',
    '--ladder-coverage', 'd.json', '--stat-availability', 'e.json',
    '--accepted-corrections', 'f.json',
  ];

  it('requires the reviewed corrections path', () => {
    expect(() => parseRolloverArgv(
      complete.slice(0, complete.length - 2)))
      .toThrow(/--accepted-corrections is required/);
  });

  it('refuses a supplied identity_scan, which no longer exists', () => {
    expect(() => parseRolloverArgv([...complete, '--identity-scan', 'i.json']))
      .toThrow(/--identity-scan no longer exists/);
    expect(() => parseRolloverArgv([...complete, '--identity-scan', 'i.json']))
      .toThrow(/MEASURED by the executed/);
  });

  it('has no flag that supplies validator output', () => {
    expect(complete).not.toContain('--core-validator-output');
  });

  it('parses a complete command and defaults to a dry run', () => {
    const args = parseRolloverArgv(complete);
    expect(args.apply).toBe(false);
    expect(args.acknowledgeSeasonComplete).toBe(false);
    expect(args.season).toBe(2026);
  });

  it('refuses a missing --season', () => {
    const without = complete.filter((a, i) =>
      a !== '--season' && complete[i - 1] !== '--season');
    expect(() => parseRolloverArgv(without)).toThrow(/--season is required/);
  });

  it('refuses --apply without the completion acknowledgement', () => {
    expect(() => parseRolloverArgv([...complete, '--apply']))
      .toThrow(/--apply requires --acknowledge-season-complete/);
  });

  it('accepts --apply with the acknowledgement', () => {
    const args = parseRolloverArgv(
      [...complete, '--apply', '--acknowledge-season-complete']);
    expect(args.apply).toBe(true);
    expect(args.acknowledgeSeasonComplete).toBe(true);
  });

  it('refuses a flag with no value at all', () => {
    expect(() => parseRolloverArgv(['--season'])).toThrow(/--season needs a value/);
  });

  it('refuses a flag whose value is the next flag', () => {
    const swallowed = complete.slice();
    swallowed[1] = '--retire-status';        // --season would swallow a flag
    expect(() => parseRolloverArgv(swallowed)).toThrow(/--season needs a value/);
  });

  it('AFLDB-ISSUE-233: requires the afl_api ownership census, repeatable, one per database', () => {
    const without = complete.filter((a, i) =>
      a !== '--afl-api-ownership-census' && complete[i - 1] !== '--afl-api-ownership-census');
    expect(() => parseRolloverArgv(without)).toThrow(/--afl-api-ownership-census is required/);
    expect(parseRolloverArgv(complete).aflApiOwnershipCensus).toEqual(['g.json']);
    expect(parseRolloverArgv([...complete, '--afl-api-ownership-census', 'h.json'])
      .aflApiOwnershipCensus).toEqual(['g.json', 'h.json']);
    expect(() => parseRolloverArgv([...complete, '--afl-api-ownership-census']))
      .toThrow(/--afl-api-ownership-census needs a value/);
  });
});

describe('AFLDB-ISSUE-233 D-233-3 — afl_api ownership across the successor rebuild', () => {
  it('passes a zero census of the successor scope and records it in the plan notes', () => {
    const plan = run();
    const note = plan.notes.find((n) => n.startsWith('afl_api ownership census'));
    expect(note).toContain('afldb_test');
    expect(note).toContain('0 afl_api-owned canonical matches in 1897..2026');
    expect(note).toContain('artifacts/rollover/afl-api-ownership-census-afldb_test.json');
    expect(plan.notes.some((n) => n.includes('stage afl-api-ownership-census'))).toBe(true);
  });

  it('refuses one afl_api-owned match in the completing season, naming season and count', () => {
    expect(() => run({ aflApiOwnershipCensuses: [censusEvidence({ inScope: [[2026, 1]] })] }))
      .toThrow(/REFUSED on afldb_test: .*1897\.\.2026.*source afl_api: 2026 \(1\)\./);
  });

  it('names every affected season with its exact count', () => {
    let message = '';
    try {
      run({ aflApiOwnershipCensuses: [censusEvidence({ inScope: [[1999, 2], [2024, 3], [2026, 1]] })] });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('1999 (2), 2024 (3), 2026 (1)');
    expect(message).toContain('There is no override');
    expect(message).toContain('Nothing was written');
  });

  it('refuses before any validator evidence is needed (stage one), so nothing is spawned', () => {
    expect(() => planSuccessorContract(stageOneInput({
      aflApiOwnershipCensuses: [censusEvidence({ inScope: [[2026, 4]] })],
    }))).toThrow(RolloverRefused);
  });

  it('reports, but does not refuse on, an afl_api-owned season outside the successor scope', () => {
    const plan = run({ aflApiOwnershipCensuses: [censusEvidence({ outsideScope: [[2027, 5]] })] });
    expect(plan.notes.find((n) => n.startsWith('afl_api ownership census')))
      .toContain('outside that scope (reported only): 2027 (5)');
  });

  it('refuses a census of the CURRENT rebuild scope: the completing season must be inside it', () => {
    const current = censusEvidence({
      scope: { firstSeason: FIRST_SEASON, lastSeason: 2025, excludedSeasons: [2026] },
    });
    expect(() => run({ aflApiOwnershipCensuses: [current] }))
      .toThrow(/covers 1897\.\.2025 excluding in-progress 2026, but the rebuild after completing 2026 covers 1897\.\.2026.*--through-season 2026/);
  });

  it('refuses edited evidence whose verdict disagrees with its own counts', () => {
    const edited = censusEvidence({ inScope: [[2026, 2]] });
    Object.assign(edited.record, { verdict: 'pass', total_in_scope: 0 });
    expect(() => run({ aflApiOwnershipCensuses: [edited] })).toThrow(/disagree with its own counts/);
  });

  it('refuses evidence that lists an in-scope season as outside the scope', () => {
    const hidden = censusEvidence({});
    Object.assign(hidden.record, { outside_scope: [{ season: 2026, afl_api_matches: 3 }] });
    expect(() => run({ aflApiOwnershipCensuses: [hidden] })).toThrow(/listed outside scope but is not/);
  });

  it('refuses a census of an empty database, a repeated database, and no census at all', () => {
    expect(() => run({ aflApiOwnershipCensuses: [censusEvidence({ schemaPresent: false })] }))
      .toThrow(/found no canonical schema/);
    expect(() => run({ aflApiOwnershipCensuses: [censusEvidence(), censusEvidence()] }))
      .toThrow(/name the same database/);
    expect(() => run({ aflApiOwnershipCensuses: [] })).toThrow(/No afl_api ownership census was supplied/);
  });

  it('judges every supplied census: a clean one never offsets a refusing one', () => {
    expect(() => run({ aflApiOwnershipCensuses: [
      censusEvidence({ database: 'afldb_test' }),
      censusEvidence({ database: 'afldb_dev', inScope: [[2026, 1]] }),
    ] })).toThrow(/REFUSED on afldb_dev/);
    const plan = run({ aflApiOwnershipCensuses: [
      censusEvidence({ database: 'afldb_test' }), censusEvidence({ database: 'afldb_dev' }),
    ] });
    expect(plan.notes.filter((n) => n.startsWith('afl_api ownership census'))).toHaveLength(2);
  });

  it('keeps the library free of database and filesystem access', () => {
    const source = readFileSync(
      join(root, 'src', 'lib', 'rollover', 'afl-api-ownership-census.ts'), 'utf8');
    expect(source).not.toMatch(/from 'node:fs'|from 'postgres'|readFileSync|writeFileSync|Date\.now|new Date\(/);
  });
});

describe('idempotence', () => {
  it('refuses a season already inside the accepted boundary, and does not no-op', () => {
    // The successor state, fed back in: exactly what a second run would see.
    const plan = run();
    const register = jsonIn(plan, 'data/reference/fitzroy-accepted-baselines.json');
    const seasons = jsonIn(plan, 'data/reference/seasons.json');
    const contract = jsonIn(plan, 'tools/rebuild/fitzroy/fitzroy-contract.json');
    expect(() => run({
      register, seasons, contract,
      statAvailability: reviewedStatAvailability(),
      rebuildSource: REBUILD_STUB.replace(`${ROWS_2025}`, `${ROWS_2026}`),
    })).toThrow(/already inside the accepted historical boundary/);
  });

  it('refuses a season that is not in progress', () => {
    expect(() => run({ request: { season: 2030 } })).toThrow(/in_progress_seasons/);
  });

  it('refuses when the contract has advanced but the baseline has not', () => {
    // seasons.json and the contract agree with each other at 2027/2028, but the
    // accepted baseline still measures through 2025. That is the half-rolled shape a
    // previous interrupted run would leave, and it must refuse rather than continue
    // from whichever artefact happens to be read first.
    const seasons = baseSeasons();
    seasons.last_season = 2028;
    seasons.in_progress_seasons = [2028];
    seasons.season_notes = { '2028': 'x' };
    const contract = baseContract();
    ((contract.full_history as Record<string, Record<string, unknown>>)
      .season_range).last_season = 2027;
    ((contract.full_history as Record<string, Record<string, unknown>>)
      .current_season_excluded).seasons = [2028];
    expect(() => run({ seasons, contract, request: { season: 2028 } }))
      .toThrow(/required_range is 1897-2025/);
  });

  // NOTE: the planner also refuses a season that does not directly follow the accepted
  // boundary. That branch is defence in depth and is not separately reachable: coherence
  // already forces in_progress_seasons == [accepted_last + 1], so any season that passes
  // the membership check is contiguous by construction. It is deliberately left in place
  // and deliberately not claimed as tested.
});

describe('a half-rolled or inconsistent starting state refuses', () => {
  it('names the seasons.json / contract disagreement', () => {
    const seasons = baseSeasons();
    seasons.last_season = 2027;
    expect(() => run({ seasons })).toThrow(/last completed season is 2025.*last_season is 2027/s);
  });

  it('names an in-progress list that disagrees with the contract exclusion', () => {
    const contract = baseContract();
    ((contract.full_history as Record<string, Record<string, unknown>>)
      .current_season_excluded).seasons = [2025];
    expect(() => run({ contract }))
      .toThrow(/current_season_excluded\.seasons does not equal/);
  });

  it('names a required_range that has drifted from the contract', () => {
    const register = baseRegister();
    ((register.baselines as Record<string, Record<string, Record<string, unknown>>>[])[0]
      .contract_binding.required_range).last_season = 2024;
    expect(() => run({ register })).toThrow(/required_range is 1897-2024/);
  });

  it('names a stage-9 expectation that disagrees with the accepted witness', () => {
    expect(() => run({ rebuildSource: REBUILD_STUB.replace(`${ROWS_2025}`, '999') }))
      .toThrow(/stage 9 expects 999 club_seasons rows/);
  });

  it('names a ladder witness whose span lags the accepted boundary', () => {
    const contract = baseContract();
    ((contract.datasets as Record<string, Record<string, Record<string, unknown>>>)
      .ladder.coverage).last_season = 2024;
    expect(() => run({ contract })).toThrow(/accepted ladder witness covers through 2024/);
  });

  it('refuses zero accepted baselines', () => {
    const register = baseRegister();
    (register.baselines as Record<string, unknown>[])[0].acceptance_status = 'retired';
    expect(() => run({ register })).toThrow(/No fitzRoy baseline is marked accepted/);
  });

  it('refuses more than one accepted baseline instead of choosing', () => {
    const register = baseRegister();
    const extra = JSON.parse(JSON.stringify((register.baselines as unknown[])[0]));
    extra.snapshot_label = 'full-history-other';
    (register.baselines as unknown[]).push(extra);
    expect(() => run({ register })).toThrow(/2 fitzRoy baselines are marked accepted/);
  });

  it('refuses an unimplemented selection policy', () => {
    const register = baseRegister();
    (register.selection_policy as Record<string, unknown>).rule = 'latest_label';
    expect(() => run({ register })).toThrow(/only policy this rollover implements/);
  });
});

describe('baseline status vocabulary — never invented', () => {
  it('refuses when the register declares no retired-status vocabulary', () => {
    const register = baseRegister();
    delete (register.selection_policy as Record<string, unknown>).retired_statuses;
    expect(() => run({ register }))
      .toThrow(/declares no vocabulary for a retired baseline/);
  });

  it('refuses a status outside the declared vocabulary', () => {
    expect(() => run({ request: { retirementStatus: 'superseded' } }))
      .toThrow(/not one of the register's declared retired statuses/);
  });

  it('refuses a vocabulary that would break the exactly-one-accepted invariant', () => {
    const register = baseRegister();
    (register.selection_policy as Record<string, unknown>).retired_statuses =
      ['retired', 'accepted'];
    expect(() => retirementVocabulary(register)).toThrow(/would break the/);
  });

  it("adopts 'retired' in the REAL register, and only that", () => {
    // AFLDB-ISSUE-101's adjudicated lifecycle vocabulary, asserted against the tracked
    // file so it cannot drift or quietly grow.
    const register = JSON.parse(readFileSync(
      join(root, 'data', 'reference', 'fitzroy-accepted-baselines.json'), 'utf8'));
    expect(retirementVocabulary(register)).toEqual(['retired']);
    expect(retirementVocabulary(register)).not.toContain('accepted');
    // 'candidate' means "not yet accepted" and must never describe a baseline that WAS
    // accepted; it is excluded by being absent from the declared vocabulary.
    expect(retirementVocabulary(register)).not.toContain('candidate');
  });

  it('the real register holds one accepted baseline beside one retired one', () => {
    // AFLDB-ISSUE-101 declared this vocabulary; AFLDB-ISSUE-112 was the first real
    // retirement to use it. The shape asserted here is the shape the rollover produces:
    // the outgoing baseline stays in the file as retired, and exactly one stays accepted.
    const register = JSON.parse(readFileSync(
      join(root, 'data', 'reference', 'fitzroy-accepted-baselines.json'), 'utf8'));
    const baselines = register.baselines as Record<string, unknown>[];
    const accepted = selectAccepted(register);
    expect(baselines).toHaveLength(2);
    expect(baselines.map((b) => b.acceptance_status)).toEqual(['retired', 'accepted']);
    expect(accepted.snapshot_label).toBe('full-history-20260902');
    expect((accepted.measured as Record<string, unknown>).seasons_last).toBe(2025);
    expect((accepted.contract_binding as Record<string, Record<string, unknown>>)
      .required_range).toEqual({ first_season: 1897, last_season: 2025 });
    // AFLDB-ISSUE-108: the canonical LF hash, not the CRLF-checkout one. AFLDB-ISSUE-112
    // re-proved that rule - the relabelled manifest was CRLF from the R adapter and had
    // to be normalised before this binding was pinned.
    expect((accepted.acquisition as Record<string, unknown>).manifest_sha256)
      .toBe('2bd66e3df5ce80411363da9e15c6dddadc9eefe5c5c9eca3f5b7bd7106b0a0c1');
    expect((accepted.raw_artefacts as Record<string, unknown>).artefact_set_sha256)
      .toBe('15ba5dc624535d95fd1661c7c5e757ae4fc2d31782a2c0b1414e19358580dd6c');

    // The retired predecessor keeps its own bindings, untouched by the retirement.
    const outgoing = baselines.find((b) => b.acceptance_status === 'retired')!;
    expect(outgoing.snapshot_label).toBe('full-history-20260827');
    expect(outgoing.superseded_by).toBe('full-history-20260902');
    expect((outgoing.acquisition as Record<string, unknown>).manifest_sha256)
      .toBe('a42c6d5faacbcb6f4ce77a93a01f282577797375d14c60ef17f09bff2ab21d09');
    expect((outgoing.raw_artefacts as Record<string, unknown>).artefact_set_sha256)
      .toBe('8e14ce6198685b9fec568ab3c680cab34783e8e202ab0c7e93f45773d96f4125');
    // 'retired' is declared vocabulary, so the retirement is a named decision.
    expect(retirementVocabulary(register)).toContain(outgoing.acceptance_status);
  });

  it('refuses a candidate-style status for a previously accepted baseline', () => {
    expect(() => run({ request: { retirementStatus: 'candidate' } }))
      .toThrow(/not one of the register's declared retired statuses/);
  });

  it('transitions the outgoing baseline to retired and keeps one accepted', () => {
    const register = jsonIn(run(), 'data/reference/fitzroy-accepted-baselines.json');
    const baselines = register.baselines as Record<string, unknown>[];
    expect(baselines.map((b) => b.acceptance_status)).toEqual(['retired', 'accepted']);
  });
});

describe('accepted_corrections are reviewed per acquisition, never inherited', () => {
  it('does not silently copy the outgoing baseline\'s corrections', () => {
    const next = (jsonIn(run(), 'data/reference/fitzroy-accepted-baselines.json')
      .baselines as Record<string, unknown>[])[1];
    expect(next.accepted_corrections).toEqual(reviewedCorrections());
    expect(next.accepted_corrections).not.toEqual(outgoingCorrections());
    // The outgoing entries are not merely different — they were never read.
    expect(JSON.stringify(next.accepted_corrections)).not.toContain('INHERITED-MARKER');
  });

  it('refuses when no reviewed corrections state is supplied', () => {
    expect(() => run({ acceptedCorrections: undefined }))
      .toThrow(/never inherited from the outgoing baseline/);
  });

  it('accepts an explicit no-corrections state', () => {
    const plan = run({ acceptedCorrections: emptyCorrections() });
    const next = (jsonIn(plan, 'data/reference/fitzroy-accepted-baselines.json')
      .baselines as Record<string, unknown>[])[1];
    expect(next.accepted_corrections).toEqual(emptyCorrections());
    expect(plan.notes.join(' ')).toMatch(/accepted_corrections were REVIEWED .* 0 entries/);
  });

  it('retains explicitly supplied corrections exactly', () => {
    const supplied = {
      $comment: ['bespoke'],
      source_normalisation: [
        { kind: 'source_club_normalisation', rule: 'Fitzroy 1996 -> Fitzroy',
          dataset_scope: 'results' },
      ],
      source_data: [{ kind: 'source_row_corrections', rule: 'one 2026 duplicate',
        rows_dropped: 1 }],
      import_transformation: [],
    };
    const next = (jsonIn(run({ acceptedCorrections: supplied }),
      'data/reference/fitzroy-accepted-baselines.json')
      .baselines as Record<string, unknown>[])[1];
    expect(next.accepted_corrections).toEqual(supplied);
  });

  it('refuses a category the established shape declares but the review omits', () => {
    expect(() => run({ acceptedCorrections: { source_normalisation: [] } }))
      .toThrow(/a missing category is an omission rather than a decision/);
  });

  it('refuses an unknown category', () => {
    expect(() => run({
      acceptedCorrections: { ...emptyCorrections(), invented_category: [] },
    })).toThrow(/established\s+shape is/);
  });

  it('refuses an entry that states no kind or no rule', () => {
    expect(() => run({
      acceptedCorrections: { ...emptyCorrections(), source_data: [{ kind: 'x' }] },
    })).toThrow(/source_data\[0\]\.rule/);
    expect(() => run({
      acceptedCorrections: { ...emptyCorrections(), source_data: [{ rule: 'y' }] },
    })).toThrow(/source_data\[0\]\.kind/);
  });

  it('refuses a category that is not an array', () => {
    expect(() => run({
      acceptedCorrections: { ...emptyCorrections(), source_data: 'none' },
    })).toThrow(/source_data is not a JSON array/);
  });
});

describe('the candidate acquisition is evidence, and is checked', () => {
  it('refuses a candidate that does not reach the completing season', () => {
    expect(() => run({ coreManifest: coreManifest(2025, NEW_LABEL) }))
      .toThrow(/must cover 1897-2026/);
  });

  it('refuses a candidate reusing the accepted label — snapshots are immutable', () => {
    expect(() => run({ coreManifest: coreManifest(COMPLETING, RETIRED_LABEL) }))
      .toThrow(/Snapshots are immutable/);
  });

  it('refuses a candidate whose datasets are not the contract\'s', () => {
    const manifest = coreManifest(COMPLETING, NEW_LABEL);
    manifest.datasets_requested = ['player_stats', 'results'];
    expect(() => run({ coreManifest: manifest })).toThrow(/required_datasets/);
  });

  it('refuses a candidate acquired under a different fitzRoy version', () => {
    const manifest = coreManifest(COMPLETING, NEW_LABEL);
    manifest.fitzroy_version_pinned = '1.9.0';
    expect(() => run({ coreManifest: manifest })).toThrow(/but the contract pins/);
  });

  it('refuses validator evidence that describes a different span', () => {
    expect(() => run({ validatorOutput: gateOutput({ seasons: '1897-2025' }) }))
      .toThrow(/evidence does not describe the candidate/);
  });

  it('refuses a candidate that does not grow the match count', () => {
    expect(() => run({ validatorOutput: gateOutput({ matches: 16838 }) }))
      .toThrow(/cannot reduce or preserve the match count/);
  });
});

describe('the ladder witness is checked against the accepted span', () => {
  it('refuses a witness that stops at the old boundary', () => {
    expect(() => run({ ladderManifest: ladderManifest(2025, NEW_WITNESS) }))
      .toThrow(/must cover exactly the accepted completed span 1897-2026/);
  });

  it('refuses a witness reusing the accepted witness label', () => {
    expect(() => run({ ladderManifest: ladderManifest(COMPLETING, OLD_WITNESS) }))
      .toThrow(/currently accepted witness label/);
  });

  it('refuses a witness with a missing season artefact', () => {
    const manifest = ladderManifest(COMPLETING, NEW_WITNESS);
    manifest.files = (manifest.files as unknown[])
      .filter((f) => (f as Record<string, string>).filename !== 'ladder_1950.csv');
    expect(() => run({ ladderManifest: manifest })).toThrow(/129 seasons, but 1897-2026/);
  });

  it('refuses a reviewed coverage block that disagrees with the acquisition', () => {
    const coverage = reviewedCoverage();
    coverage.club_season_rows = ROWS_2026 + 1;
    expect(() => run({ ladderCoverage: coverage }))
      .toThrow(/declares club_season_rows/);
  });

  it('refuses reviewed min/max row counts the acquisition does not support', () => {
    const coverage = reviewedCoverage();
    coverage.min_rows_season = { season: 1916, rows: 6 };
    expect(() => run({ ladderCoverage: coverage }))
      .toThrow(/min\/max season row counts/);
  });
});

describe('stage-9 club_seasons expectation stays explicit reviewed evidence', () => {
  it('refuses an operator number that disagrees with the witness', () => {
    expect(() => run({ clubSeasonsExpectedRows: ROWS_2026 + 5 }))
      .toThrow(/disagrees with the ladder witness/);
  });

  it('refuses a witness that does not grow the club-season population', () => {
    const contract = baseContract();
    const ladder = (contract.datasets as Record<string, Record<string, Record<string, unknown>>>)
      .ladder;
    ladder.coverage.club_season_rows = ROWS_2026;
    ladder.accepted_witness.rows = ROWS_2026;
    expect(() => run({
      contract,
      rebuildSource: REBUILD_STUB.replace(`${ROWS_2025}`, `${ROWS_2026}`),
    })).toThrow(/not more than the current/);
  });

  it('edits the constant only through an unambiguous anchor', () => {
    expect(planClubSeasonsConstantEdit(REBUILD_STUB, ROWS_2025, ROWS_2026))
      .toContain(`rows: ${ROWS_2026},`);
    expect(() => planClubSeasonsConstantEdit('no constant here', 1, 2))
      .toThrow(/exactly one CLUB_SEASONS_EXPECTED/);
    expect(() => planClubSeasonsConstantEdit(`${REBUILD_STUB}\n${REBUILD_STUB}`, 1, 2))
      .toThrow(/exactly one CLUB_SEASONS_EXPECTED/);
    expect(() => planClubSeasonsConstantEdit(REBUILD_STUB, 999, 1000))
      .toThrow(/but the current state was read as 999/);
  });

  it('locates the constant in the REAL runner', () => {
    const runner = readFileSync(join(root, 'tools', 'db', 'rebuild-test.ts'), 'utf8');
    expect(readClubSeasonsExpectedRows(runner)).toBe(1622);
  });
});

describe('stat availability cannot be fabricated', () => {
  it('requires a reviewed successor document, and accepts a coherent one', () => {
    const plan = run();
    const stat = jsonIn(plan, 'data/reference/stat-availability.json');
    expect(stat).toEqual(reviewedStatAvailability());
  });

  it('refuses recorded coverage for a season later than the one completing', () => {
    const reviewed = reviewedStatAvailability();
    (reviewed.coverage_ranges as Record<string, unknown>[])[1] =
      { stat_key: 'goals', coverage: 'complete', first_season: 2027, last_season: 2027 };
    expect(() => run({ reviewedStat: reviewed }))
      .toThrow(/cannot already have recorded data|will not fabricate availability/);
  });

  it('refuses a range dragged mechanically past the completing season', () => {
    const reviewed = {
      status: 'READY',
      coverage_ranges: [
        { stat_key: 'goals', coverage: 'complete', first_season: 1897, last_season: 2027 },
        { stat_key: 'brownlow_round_votes', coverage: 'complete', first_season: 1924,
          last_season: 2026 },
      ],
    };
    expect(() => run({ reviewedStat: reviewed })).toThrow(/will not fabricate availability/);
  });

  it('refuses a document that retracts recorded history', () => {
    const reviewed = {
      status: 'READY',
      coverage_ranges: [
        { stat_key: 'goals', coverage: 'complete', first_season: 1897, last_season: 2019 },
        { stat_key: 'goals', coverage: 'pending', first_season: 2020, last_season: 2027 },
        { stat_key: 'brownlow_round_votes', coverage: 'complete', first_season: 1924,
          last_season: 2026 },
      ],
    };
    expect(() => run({ reviewedStat: reviewed })).toThrow(/retracts recorded coverage/);
  });

  it('refuses coverage outside the successor season range', () => {
    const reviewed = reviewedStatAvailability();
    (reviewed.coverage_ranges as Record<string, unknown>[]).push(
      { stat_key: 'goals', coverage: 'pending', first_season: 2028, last_season: 2028 });
    expect(() => run({ reviewedStat: reviewed })).toThrow(/outside the successor season range/);
  });

  it('refuses a duplicated cell and an unknown coverage class', () => {
    const dup = reviewedStatAvailability();
    (dup.coverage_ranges as Record<string, unknown>[]).push(
      { stat_key: 'goals', coverage: 'pending', first_season: 2027, last_season: 2027 });
    expect(() => run({ reviewedStat: dup })).toThrow(/covers goals:2027 twice/);

    const bad = reviewedStatAvailability();
    (bad.coverage_ranges as Record<string, unknown>[])[0] =
      { stat_key: 'goals', coverage: 'probably', first_season: 1897, last_season: 2026 };
    expect(() => run({ reviewedStat: bad })).toThrow(/which is not one of/);
  });

  it('refuses a document the loader would ignore', () => {
    const reviewed = reviewedStatAvailability();
    reviewed.status = 'DRAFT';
    expect(() => run({ reviewedStat: reviewed })).toThrow(/not status READY/);
  });

  it('reports, without refusing, a stat key that says nothing about the new season', () => {
    const reviewed = reviewedStatAvailability();
    reviewed.coverage_ranges =
      (reviewed.coverage_ranges as Record<string, unknown>[]).filter(
        (r) => !(r.stat_key === 'goals' && r.first_season === 2027));
    const plan = run({ reviewedStat: reviewed });
    expect(plan.notes.join(' ')).toMatch(/declare no coverage for 2027 \(goals\)/);
  });
});

describe('the successor is held to the same rules as the predecessor', () => {
  it('validates the computed successor with the same coherence gate', () => {
    const plan = run();
    // Feeding the plan's own output back through assertCoherent must pass.
    expect(() => assertCoherent({
      register: jsonIn(plan, 'data/reference/fitzroy-accepted-baselines.json'),
      seasons: jsonIn(plan, 'data/reference/seasons.json'),
      contract: jsonIn(plan, 'tools/rebuild/fitzroy/fitzroy-contract.json'),
      statAvailability: jsonIn(plan, 'data/reference/stat-availability.json'),
      clubSeasonsExpectedRows: ROWS_2026,
    }, 'successor')).not.toThrow();
  });
});

describe('write strategy', () => {
  /**
   * Option C's obligation, discharged: for the three documents the planner
   * rewrites wholesale, prove that the ONLY semantic differences are the
   * intended mutations. Formatting is allowed to change; content is not.
   */
  function semanticPaths(doc: unknown, prefix = ''): Map<string, string> {
    const out = new Map<string, string>();
    if (doc === null || typeof doc !== 'object') {
      out.set(prefix, JSON.stringify(doc));
      return out;
    }
    const entries = Array.isArray(doc)
      ? doc.map((v, i) => [String(i), v] as const)
      : Object.entries(doc);
    if (entries.length === 0) out.set(prefix, Array.isArray(doc) ? '[]' : '{}');
    for (const [key, value] of entries) {
      for (const [k, v] of semanticPaths(value, prefix ? `${prefix}.${key}` : key)) {
        out.set(k, v);
      }
    }
    return out;
  }

  function changedPaths(before: unknown, after: unknown): string[] {
    const a = semanticPaths(before);
    const b = semanticPaths(after);
    const keys = new Set([...a.keys(), ...b.keys()]);
    return [...keys].filter((k) => a.get(k) !== b.get(k)).sort();
  }

  const plan = run();

  it('changes only the intended paths in seasons.json', () => {
    expect(changedPaths(baseSeasons(), jsonIn(plan, 'data/reference/seasons.json')))
      .toEqual([
        'in_progress_seasons.0',
        'last_season',
        'season_notes.2026',
        'season_notes.2027',
      ]);
  });

  it('changes only the intended paths in the fitzRoy contract', () => {
    const changed = changedPaths(
      baseContract(), jsonIn(plan, 'tools/rebuild/fitzroy/fitzroy-contract.json'));
    expect(changed).toEqual([
      'datasets.ladder.accepted_witness.acquired_on',
      'datasets.ladder.accepted_witness.files',
      'datasets.ladder.accepted_witness.manifest',
      'datasets.ladder.accepted_witness.manifest_sha256',
      'datasets.ladder.accepted_witness.rows',
      'datasets.ladder.accepted_witness.snapshot_label',
      'datasets.ladder.accepted_witness.validator',
      'datasets.ladder.coverage.$comment',
      'datasets.ladder.coverage.club_season_rows',
      'datasets.ladder.coverage.last_season',
      'datasets.ladder.coverage.max_rows_season.seasons',
      'datasets.ladder.coverage.seasons_returned',
      'full_history.current_season_excluded.seasons.0',
      'full_history.season_range.last_season',
      'full_history.season_range.last_season_rule',
      'full_history.season_range.resolved_on',
    ]);
    // Nothing outside full_history and datasets.ladder moved.
    expect(changed.every((p) =>
      p.startsWith('full_history.') || p.startsWith('datasets.ladder.'))).toBe(true);
  });

  it('changes only the retired status and the appended baseline in the register', () => {
    const changed = changedPaths(
      baseRegister(), jsonIn(plan, 'data/reference/fitzroy-accepted-baselines.json'));
    const outsideNewEntry = changed.filter((p) => !p.startsWith('baselines.1'));
    expect(outsideNewEntry).toEqual(['baselines.0.acceptance_status']);
  });

  it('writes the reviewed stat-availability bytes verbatim', () => {
    const text = `{\n  "status": "READY",\n  "coverage_ranges": [\n`
      + `    { "stat_key": "goals", "coverage": "complete", "first_season": 1897,`
      + ` "last_season": 2026 },\n`
      + `    { "stat_key": "goals", "coverage": "pending", "first_season": 2027,`
      + ` "last_season": 2027 },\n`
      + `    { "stat_key": "brownlow_round_votes", "coverage": "complete",`
      + ` "first_season": 1924, "last_season": 2026 },\n`
      + `    { "stat_key": "brownlow_round_votes", "coverage": "pending",`
      + ` "first_season": 2027, "last_season": 2027 }\n  ]\n}\n`;
    const withText = run({
      reviewedStat: JSON.parse(text) as Record<string, unknown>,
      reviewedStatText: text,
    });
    // Byte-identical to what was reviewed — the hand alignment survives.
    expect(fileIn(withText, 'data/reference/stat-availability.json').content).toBe(text);
    expect(fileIn(withText, 'data/reference/stat-availability.json').reformatted)
      .toBe(false);
  });

  it('refuses reviewed bytes that are not the document it validated', () => {
    expect(() => run({ reviewedStatText: '{"status":"READY","coverage_ranges":[]}' }))
      .toThrow(/not the same document/);
  });

  it('preserves the source document line ending instead of converting the file', () => {
    expect(lineEndingOf('a\r\nb\r\n')).toBe('\r\n');
    expect(lineEndingOf('a\nb\n')).toBe('\n');

    const lfRun = run();
    // The default fixtures are LF, so build a CRLF-sourced run explicitly.
    const seasons = baseSeasons();
    const crlf = `${JSON.stringify(seasons, null, 2)}\n`.replace(/\n/g, '\r\n');
    const input = stageOneInput({ seasons });
    input.currentSources.seasons = crlf;
    const successor = planSuccessorContract(input);
    const planned = planSeasonRollover({
      ...input,
      evidence: {
        ...input.evidence,
        coreManifestSha256: 'd'.repeat(64),
        coreValidatorRun: validatorRun(),
        coreValidatorOverrides: [
          { flag: '--contract', path: TMP_CONTRACT, bytes: successor.contractContent },
          { flag: '--stat-availability', path: REVIEWED_STAT_PATH,
            bytes: input.evidence.statAvailabilityText },
        ],
      },
    });
    const written = fileIn(planned, 'data/reference/seasons.json').content;
    expect(written).toContain('\r\n');
    expect(written.match(/(?<!\r)\n/g)).toBeNull();
    // and the LF-sourced run stays LF
    expect(fileIn(lfRun, 'data/reference/seasons.json').content).not.toContain('\r\n');
  });

  it('reproduces the repository\'s machine-written reference JSON convention', () => {
    // tools/rebuild/draftguru/export_link_decisions.py writes this tracked file as
    // json.dumps(indent=2) + "\n". Serialising it the planner's way reproduces it
    // exactly, which is what makes 2-space + trailing newline the established
    // convention rather than an arbitrary choice.
    const path = join(root, 'data', 'reference', 'draftguru-link-decisions.json');
    const raw = readFileSync(path, 'utf8');
    const ending = lineEndingOf(raw);
    const body = `${JSON.stringify(JSON.parse(raw), null, 2)}\n`;
    expect(ending === '\n' ? body : body.replace(/\n/g, '\r\n')).toBe(raw);
  });
});

/*
 * AFLDB-ISSUE-101 §14. Making the gates runnable pre-apply meant editing two
 * VALIDATED Python scripts. These assertions pin the two properties that make
 * that safe: the defaults are unchanged, so every existing caller behaves
 * exactly as before; and the overrides are confined to paths that cannot reach
 * a database. They are read out of the real files, not restated here.
 */
describe('the validator path overrides are additive and fail closed', () => {
  const importer = readFileSync(
    join(root, 'tools', 'migration', 'import_fitzroy_core.py'), 'utf8');
  const witness = readFileSync(
    join(root, 'tools', 'rebuild', 'fitzroy', 'validate_ladder_witness.py'), 'utf8');

  it('leaves the importer defaulting to the tracked contract and availability doc', () => {
    expect(importer).toContain(
      'CONTRACT_PATH = REPO_ROOT / "tools" / "rebuild" / "fitzroy" / "fitzroy-contract.json"');
    expect(importer).toContain(
      'AVAILABILITY_JSON = REPO_ROOT / "data" / "reference" / "stat-availability.json"');
    expect(importer).toContain(
      'contract_path = Path(args.contract) if args.contract else CONTRACT_PATH');
    expect(importer).toContain('Path(args.stat_availability) if args.stat_availability');
    expect(importer).toContain('else AVAILABILITY_JSON');
    // Every helper the override flows through keeps a default, so no existing
    // caller — the rebuild orchestrator, tests/python, the settle path — changes.
    for (const signature of [
      'def validate_snapshot(snapshot_dir: Path, manifest_path: Path,',
      'contract_path: Path | None = None) -> list[SnapshotFile]:',
      'def load_row_corrections(contract_path: Path | None = None) -> list[dict]:',
      'def load_round_vote_seasons(availability_path: Path | None = None) -> set[int]:',
    ]) expect(importer).toContain(signature);
  });

  it('routes every contract read site, so the two halves cannot disagree', () => {
    // The §14 hazard: four read sites, and missing one would let the gate read a
    // different contract from the scan. None may read the module constant directly.
    // AFLDB-ISSUE-136 added a fifth, load_profile_continuity_rules(contract_path), routed
    // the same way — so the successor contract's continuity rules are what a rollover
    // validation applies.
    expect(importer).not.toMatch(/CONTRACT_PATH\.read_text/);
    expect(importer).not.toMatch(/AVAILABILITY_JSON\.read_text/);
    expect(witness).not.toMatch(/\bCONTRACT\.read_text/);
    expect((importer.match(/\(contract_path or CONTRACT_PATH\)\.read_text/g) ?? []).length)
      .toBe(3);
    expect(importer).toContain('load_profile_continuity_rules(contract_path)');
    expect(importer).toContain('contract = json.loads(contract_path.read_text');
    expect(importer).toContain('(json.loads(contract_path.read_text(encoding="utf-8"))');
  });

  it('confines the importer overrides to runs that cannot reach a database', () => {
    expect(importer).toContain(
      'is offline-validation only: pass --validate-only. A run that can ');
    expect(importer).toContain('reference documents OVERRIDDEN for this offline validation');
  });

  it('leaves the witness validator defaulting to the tracked contract and manifests', () => {
    expect(witness).toContain(
      'CONTRACT = ROOT / "tools" / "rebuild" / "fitzroy" / "fitzroy-contract.json"');
    expect(witness).toContain(
      'MANIFEST_DIR = ROOT / "docs" / "rebuild-manifests" / "afltables_fitzroy_core"');
    expect(witness).toContain('contract_path = Path(args.contract) if args.contract '
      + 'else CONTRACT');
    expect(witness).toContain('manifest_dir = Path(args.manifest_dir) if args.manifest_dir '
      + 'else MANIFEST_DIR');
    expect(witness).toContain('manifest_path = (manifest_dir or MANIFEST_DIR) '
      + '/ f"{label}.json"');
  });

  it('refuses to point the D7 database cross-check at a temporary state', () => {
    expect(witness).toContain('cannot be combined with --compare');
    expect(witness).toContain('adjudicates the tracked accepted witness, never a temporary');
  });

  it('does not change how the rebuild orchestrator invokes either validator', () => {
    const runner = readFileSync(join(root, 'tools', 'db', 'rebuild-test.ts'), 'utf8');
    expect(runner).not.toContain('--contract');
    expect(runner).not.toContain('--manifest-dir');
    expect(runner).not.toContain('--stat-availability');
    // and the rebuild still owns the one proof that needs the database
    expect(runner).toContain('--compare');
  });

  it('writes nothing tracked until every gate has been adjudicated', () => {
    const cli = readFileSync(join(root, 'tools', 'db', 'rollover-season.ts'), 'utf8');
    // One write site, and it is after the authority check and after the dry-run return.
    expect((cli.match(/applyStagedWrites\(repoIo, args\.season/g) ?? []).length).toBe(1);
    expect(cli.indexOf('assertPreApplyAuthority({'))
      .toBeLessThan(cli.indexOf('if (!apply) {'));
    expect(cli.indexOf('if (!apply) {'))
      .toBeLessThan(cli.indexOf('applyStagedWrites(repoIo, args.season, writeSet)'));
    // The repository filesystem adapter is only handed to the pending check and the one staged
    // apply: nothing calls its mutators directly, and it holds the only rename site.
    expect(cli).not.toMatch(/repoIo\.(write|rename|remove)\(/);
    expect((cli.match(/renameSync\(/g) ?? []).length).toBe(1);
    // materialise() in the temporary directory, and the adapter's own write.
    expect((cli.match(/writeFileSync\(/g) ?? []).length).toBe(2);
    // The temporary successor state never lands inside the repository.
    expect(cli).toContain('mkdtempSync(join(tmpdir()');
    expect(cli).toContain("rmSync(temporary, { recursive: true, force: true })");
  });
});

describe('planning writes nothing', () => {
  it('leaves every real reference artefact byte-identical', () => {
    const paths = [
      'data/reference/fitzroy-accepted-baselines.json',
      'data/reference/seasons.json',
      'data/reference/stat-availability.json',
      'tools/rebuild/fitzroy/fitzroy-contract.json',
      'tools/db/rebuild-test.ts',
    ];
    const digest = () => paths.map((p) =>
      createHash('sha256').update(readFileSync(join(root, ...p.split('/')))).digest('hex'));

    const before = digest();
    run();                                    // a complete, successful planning run
    expect(() => run({ request: { season: 2030 } })).toThrow();   // and a refused one
    expect(digest()).toEqual(before);
  });

  it('confirms the real repository boundary is still 2025 / 2026', () => {
    const register = JSON.parse(readFileSync(
      join(root, 'data', 'reference', 'fitzroy-accepted-baselines.json'), 'utf8'));
    const seasons = JSON.parse(readFileSync(
      join(root, 'data', 'reference', 'seasons.json'), 'utf8'));
    expect((selectAccepted(register).measured as Record<string, unknown>).seasons_last)
      .toBe(2025);
    expect(seasons.last_season).toBe(2026);
    expect(seasons.in_progress_seasons).toEqual([2026]);
  });
});

// ---------------------------------------------------------------------------
// AFLDB-ISSUE-316 C2 — the complete transition as ONE validated change set
// ---------------------------------------------------------------------------
//
// Synthetic documents only. No production 1,640 profile, no real predecessor/successor bytes,
// no proposal file: the real proposal carries `UNRESOLVED:` sentinels precisely so that
// none of this can be satisfied by it.

const AFL_API_PATH = 'tools/rebuild/afl_api/afl-api-contract.json';
const AFLTABLES_PATH = 'tools/rebuild/afltables/afltables-contract.json';
const BASE_PROPOSED = 'artifacts/rollover/fitzroy-contract.base.json';
const AFL_API_PROPOSED = 'artifacts/rollover/afl-api-contract.json';
const AFLTABLES_PROPOSED = 'artifacts/rollover/afltables-contract.json';
const NETWORK_SOURCE = serialiseJson({
  $comment: 'switch', status: 'active', last_season: COMPLETING, decision: null, changed_at: null,
});

const TRANSITION_INPUTS: Record<InputRole, { path: string; sha256: string }> = {
  core_manifest: { path: CORE_MANIFEST_PATH, sha256: sha256Hex('core manifest bytes') },
  ladder_manifest: { path: LADDER_MANIFEST_PATH, sha256: sha256Hex('ladder manifest bytes') },
  ladder_coverage: { path: 'artifacts/rollover/ladder-coverage.json', sha256: sha256Hex('coverage') },
  stat_availability: { path: REVIEWED_STAT_PATH, sha256: sha256Hex('stat availability') },
  accepted_corrections: { path: 'artifacts/rollover/accepted-corrections.json', sha256: sha256Hex('corrections') },
};

/** The contract the planner cannot compute: ladder expectation, height block, reason text. */
function proposedBaseContract(): Record<string, unknown> {
  const contract = baseContract();
  nested(contract, 'full_history').current_season_excluded = {
    seasons: [COMPLETING], reason: 'reviewed successor reason',
  };
  nested(nested(nested(contract, 'datasets'), 'ladder'), 'accepted_witness').$comment =
    'durability binding, restated for the successor';
  nested(nested(contract, 'datasets'), 'ladder').rebuild_expectation = {
    profile: 'synthetic-profile', expected_rows: ROWS_2026,
  };
  contract.player_details = { height_enrichment: { stage: 'heights', supplements: [] } };
  return contract;
}

const NEW_BASELINE_PATCHES = [{
  pointer: '/acquisition/$comment',
  old: ['carried acquisition comment'],
  new: ['reviewed successor acquisition comment'],
}];

type Scenario = {
  disk: Map<string, string>;
  proposed: Map<string, string>;
  changeSet: Record<string, unknown>;
};

function scenario(): Scenario {
  const disk = new Map<string, string>([
    [REGISTER_PATH, serialiseJson(baseRegister())],
    [SEASONS_PATH, serialiseJson(baseSeasons())],
    [CONTRACT_PATH, serialiseJson(baseContract())],
    [STAT_AVAILABILITY_PATH, serialiseJson(baseStatAvailability())],
    [REBUILD_PATH, REBUILD_STUB],
    ['data/reference/afltables-network.json', NETWORK_SOURCE],
    [AFL_API_PATH, serialiseJson({ measured: { players_with_afl_api_evidence: 1824 } })],
    [AFLTABLES_PATH, serialiseJson({ measured: { players_with_dob: 13255 } })],
  ]);
  const proposed = new Map<string, string>([
    [BASE_PROPOSED, serialiseJson(proposedBaseContract())],
    [AFL_API_PROPOSED, serialiseJson({ measured: { players_with_afl_api_evidence: 1916 } })],
    [AFLTABLES_PROPOSED, serialiseJson({ measured: { players_with_dob: 13347 } })],
  ]);
  const ref = (path: string, proposedPath: string) => ({
    path, old_sha256: sha256Hex(disk.get(path)!), proposed: proposedPath,
    proposed_sha256: sha256Hex(proposed.get(proposedPath)!),
  });
  return {
    disk, proposed,
    changeSet: {
      schema: TRANSITION_SCHEMA,
      season: COMPLETING,
      inputs: (Object.keys(TRANSITION_INPUTS) as InputRole[]).map((role) => ({
        role, path: TRANSITION_INPUTS[role].path, sha256: TRANSITION_INPUTS[role].sha256,
      })),
      base: ref(CONTRACT_PATH, BASE_PROPOSED),
      replace: [ref(AFL_API_PATH, AFL_API_PROPOSED), ref(AFLTABLES_PATH, AFLTABLES_PROPOSED)],
      register_patches: JSON.parse(JSON.stringify(NEW_BASELINE_PATCHES)),
      write_set: [...PLANNER_OWNED_WRITES, AFL_API_PATH, AFLTABLES_PATH],
    },
  };
}

const bufferOf = (m: Map<string, string>) => (path: string) =>
  m.has(path) ? Buffer.from(m.get(path)!) : null;

function prepare(s: Scenario, over: {
  inputs?: Partial<typeof TRANSITION_INPUTS>; season?: number; text?: string;
} = {}) {
  return prepareTransition({
    changeSet: parseTransitionChangeSet(over.text ?? JSON.stringify(s.changeSet)),
    season: over.season ?? COMPLETING,
    currentContract: JSON.parse(s.disk.get(CONTRACT_PATH)!),
    readRepo: bufferOf(s.disk),
    readProposed: bufferOf(s.proposed),
    inputs: { ...TRANSITION_INPUTS, ...over.inputs },
  });
}

/** The planner's complete output for a prepared transition, as the CLI assembles it. */
function planWith(prepared: ReturnType<typeof prepare>) {
  const plan = run({ transition: prepared.transition });
  const network = planAfltablesNetworkRetirement({
    completedSeason: COMPLETING, rolloverDate: DATE, decision: 'D-316-1',
    currentSource: NETWORK_SOURCE, currentSeasons: { in_progress_seasons: [COMPLETING] },
  });
  return { plan, planned: [network.file, ...plan.files] };
}

describe('transition change set — parsing is strict', () => {
  it('accepts a complete change set', () => {
    const parsed = parseTransitionChangeSet(JSON.stringify(scenario().changeSet));
    expect(parsed.replace).toHaveLength(2);
    expect(parsed.finalSha256).toBeNull();
  });

  it.each([
    ['an unknown top-level field', (c: Record<string, unknown>) => { c.extra = 1; }, /unknown field "extra"/],
    ['another schema', (c: Record<string, unknown>) => { c.schema = 'x/2'; }, /schema is "x\/2"/],
    ['a fractional season', (c: Record<string, unknown>) => { c.season = 2026.5; }, /season must be an integer/],
    ['a missing role', (c: Record<string, unknown>) => { (c.inputs as unknown[]).pop(); }, /each of/],
    ['a repeated role', (c: Record<string, unknown>) => {
      (c.inputs as unknown[]).push((c.inputs as unknown[])[0]);
    }, /each of/],
    ['a non-hex hash', (c: Record<string, unknown>) => {
      ((c.inputs as Record<string, unknown>[])[0]).sha256 = 'ABC';
    }, /lower-case SHA-256/],
    ['a backslash path', (c: Record<string, unknown>) => {
      (c.write_set as string[]).push('a\\b.json');
    }, /normalised repository-relative path/],
    ['a parent-escaping path', (c: Record<string, unknown>) => {
      (c.write_set as string[]).push('../x.json');
    }, /normalised repository-relative path/],
    ['an empty write_set', (c: Record<string, unknown>) => { c.write_set = []; }, /every file the apply writes/],
    ['a repeated write_set path', (c: Record<string, unknown>) => {
      (c.write_set as string[]).push((c.write_set as string[])[0]);
    }, /twice/],
    ['an unknown file-ref field', (c: Record<string, unknown>) => {
      (c.base as Record<string, unknown>).note = 'x';
    }, /unknown field "note"/],
  ])('refuses %s', (_label, mutate, message) => {
    const s = scenario();
    mutate(s.changeSet);
    expect(() => parseTransitionChangeSet(JSON.stringify(s.changeSet))).toThrow(RolloverRefused);
    expect(() => parseTransitionChangeSet(JSON.stringify(s.changeSet))).toThrow(message);
  });

  it('refuses text that is not JSON', () => {
    expect(() => parseTransitionChangeSet('{ nope')).toThrow(/not valid JSON/);
  });
});

describe('transition change set — a sentinel is never a value', () => {
  it('names the marker, the line and the reason', () => {
    expect(() => assertNoSentinel('{\n "a": "UNRESOLVED:OWNER-ROLLOVER-DATE"\n}', 'The file'))
      .toThrow(/line 2/);
    expect(() => assertNoSentinel('{\n "a": "UNRESOLVED:OWNER-ROLLOVER-DATE"\n}', 'The file'))
      .toThrow(/never read as authority or as a value/);
    expect(() => assertNoSentinel('{"a":"resolved"}', 'The file')).not.toThrow();
  });

  it('refuses a change set that carries one anywhere, before parsing it', () => {
    const s = scenario();
    (s.changeSet.register_patches as Record<string, unknown>[])[0].new = ['UNRESOLVED:OWNER-ROLLOVER-DATE'];
    expect(() => parseTransitionChangeSet(JSON.stringify(s.changeSet)))
      .toThrow(new RegExp(SENTINEL_MARKER));
  });

  it.each([
    ['the proposed base contract', BASE_PROPOSED],
    ['a proposed replacement', AFL_API_PROPOSED],
  ])('refuses %s carrying one, even with a correct hash', (_label, proposedPath) => {
    const s = scenario();
    const doc = JSON.parse(s.proposed.get(proposedPath)!);
    doc.profile = 'UNRESOLVED:PRODUCTION-LADDER-PROFILE-NAME';
    s.proposed.set(proposedPath, serialiseJson(doc));
    const refs = [s.changeSet.base, ...(s.changeSet.replace as unknown[])] as Record<string, string>[];
    const ref = refs.find((r) => r.proposed === proposedPath)!;
    ref.proposed_sha256 = sha256Hex(s.proposed.get(proposedPath)!);
    expect(() => prepare(s)).toThrow(/unresolved-proposal marker/);
  });

  it('refuses a planned output carrying one, so a sentinel can never be written', () => {
    const s = scenario();
    const prepared = prepare(s);
    const { planned } = planWith(prepared);
    const poisoned = planned.map((f) => f.path === SEASONS_PATH
      ? { ...f, content: f.content.replace('"2027"', '"UNRESOLVED:OWNER-ROLLOVER-DATE"') } : f);
    expect(() => assertTransitionWriteSet({ prepared, planned: poisoned, apply: false }))
      .toThrow(/The planned data\/reference\/seasons\.json still contains/);
  });
});

describe('transition change set — stale, substituted and partial inputs refuse', () => {
  it('accepts the reviewed set and reads, but never writes, the working tree', () => {
    const s = scenario();
    const before = new Map(s.disk);
    const prepared = prepare(s);
    expect(prepared.transition.contractBase).toEqual(proposedBaseContract());
    expect(prepared.replacements.map((f) => f.path)).toEqual([AFL_API_PATH, AFLTABLES_PATH]);
    expect(s.disk).toEqual(before);
  });

  it.each([
    ['the base contract', CONTRACT_PATH],
    ['a replaced contract', AFLTABLES_PATH],
  ])('refuses when %s moved since review (stale old hash)', (_label, path) => {
    const s = scenario();
    s.disk.set(path, `${s.disk.get(path)!} `);
    expect(() => prepare(s)).toThrow(/is stale — the change set was written against bytes with SHA-256/);
  });

  it('refuses a proposed file that is not the reviewed document', () => {
    const s = scenario();
    s.proposed.set(AFL_API_PROPOSED, serialiseJson({ measured: { players_with_afl_api_evidence: 9999 } }));
    expect(() => prepare(s)).toThrow(/is not the reviewed document/);
  });

  it('refuses a missing proposed file and a missing target', () => {
    const a = scenario();
    a.proposed.delete(BASE_PROPOSED);
    expect(() => prepare(a)).toThrow(/proposed file .* does not exist/);
    const b = scenario();
    b.disk.delete(AFL_API_PATH);
    expect(() => prepare(b)).toThrow(/does not exist in the working tree/);
  });

  it('refuses a no-op replacement and invalid proposed JSON', () => {
    const a = scenario();
    a.proposed.set(AFL_API_PROPOSED, a.disk.get(AFL_API_PATH)!);
    const ref = (a.changeSet.replace as Record<string, string>[])[0];
    ref.proposed_sha256 = ref.old_sha256;
    expect(() => prepare(a)).toThrow(/equal the current bytes/);
    const b = scenario();
    b.proposed.set(AFL_API_PROPOSED, '{ nope');
    (b.changeSet.replace as Record<string, string>[])[0].proposed_sha256 = sha256Hex('{ nope');
    expect(() => prepare(b)).toThrow(/is not valid JSON/);
  });

  it.each(Object.keys(TRANSITION_INPUTS) as InputRole[])(
    'refuses a substituted %s input (path or bytes differ from the one reviewed)',
    (role) => {
      const s = scenario();
      expect(() => prepare(s, { inputs: { [role]: { ...TRANSITION_INPUTS[role], sha256: sha256Hex('other') } } }))
        .toThrow(new RegExp(`Input ${role} is stale or substituted`));
      expect(() => prepare(s, { inputs: { [role]: { ...TRANSITION_INPUTS[role], path: 'elsewhere.json' } } }))
        .toThrow(/stale or substituted/);
    },
  );

  it('refuses a change set for another season', () => {
    expect(() => prepare(scenario(), { season: 2027 })).toThrow(/is for season 2026, but --season is 2027/);
  });

  it.each(PLANNER_OWNED_WRITES)('refuses to replace %s, which the planner writes itself', (path) => {
    const s = scenario();
    (s.changeSet.replace as Record<string, unknown>[]).push({
      path, old_sha256: sha256Hex('x'), proposed: BASE_PROPOSED, proposed_sha256: sha256Hex('y'),
    });
    expect(() => prepare(s)).toThrow(/which the rollover planner writes itself/);
  });

  it('refuses a replacement outside the closed list, a repeat, and a non-contract base', () => {
    const a = scenario();
    (a.changeSet.replace as Record<string, unknown>[])[0].path = 'package.json';
    expect(() => prepare(a)).toThrow(/not one of the replaceable contracts/);
    const b = scenario();
    (b.changeSet.replace as unknown[]).push((b.changeSet.replace as unknown[])[0]);
    expect(() => prepare(b)).toThrow(/names tools\/rebuild\/afl_api\/afl-api-contract\.json twice/);
    const c = scenario();
    (c.changeSet.base as Record<string, unknown>).path = AFL_API_PATH;
    expect(() => prepare(c)).toThrow(/base may only be tools\/rebuild\/fitzroy\/fitzroy-contract\.json/);
  });

  it.each([
    ['a planner file', (w: string[]) => w.filter((p) => p !== REGISTER_PATH), /Missing: data\/reference\/fitzroy-accepted-baselines\.json/],
    ['the AFL Tables switch', (w: string[]) => w.filter((p) => !p.endsWith('afltables-network.json')), /Missing: data\/reference\/afltables-network\.json/],
    ['a replaced contract', (w: string[]) => w.filter((p) => p !== AFLTABLES_PATH), /Missing: tools\/rebuild\/afltables\/afltables-contract\.json/],
    ['an unrelated extra', (w: string[]) => [...w, 'package.json'], /Not written by this transition: package\.json/],
  ])('refuses a write_set that is not the complete membership (%s)', (_label, change, message) => {
    const s = scenario();
    s.changeSet.write_set = change(s.changeSet.write_set as string[]);
    expect(() => prepare(s)).toThrow(RolloverRefused);
    expect(() => prepare(s)).toThrow(message);
  });
});

describe('transition change set — the base may not edit what the planner owns', () => {
  const edits: Array<[string, (c: Record<string, unknown>) => void]> = [
    ['/pinned_version', (c) => { c.pinned_version = '9.9.9'; }],
    ['/full_history/required_datasets', (c) => { nested(c, 'full_history').required_datasets = ['player_stats']; }],
    ['/full_history/season_range/resolved_on', (c) => {
      nested(nested(c, 'full_history'), 'season_range').resolved_on = '2026-11-03';
    }],
    ['/full_history/season_range/last_season', (c) => {
      nested(nested(c, 'full_history'), 'season_range').last_season = 2026;
    }],
    ['/full_history/current_season_excluded/seasons', (c) => {
      nested(nested(c, 'full_history'), 'current_season_excluded').seasons = [2027];
    }],
    ['/datasets/ladder/accepted_witness/rows', (c) => {
      nested(nested(nested(c, 'datasets'), 'ladder'), 'accepted_witness').rows = ROWS_2026;
    }],
    ['/datasets/ladder/coverage', (c) => {
      nested(nested(nested(c, 'datasets'), 'ladder'), 'coverage').club_season_rows = ROWS_2026;
    }],
  ];

  it.each(edits)('refuses a base that edits %s', (pointer, edit) => {
    const s = scenario();
    const doc = JSON.parse(s.proposed.get(BASE_PROPOSED)!);
    edit(doc);
    s.proposed.set(BASE_PROPOSED, serialiseJson(doc));
    (s.changeSet.base as Record<string, string>).proposed_sha256 = sha256Hex(s.proposed.get(BASE_PROPOSED)!);
    expect(() => prepare(s)).toThrow(new RegExp(`base edits ${pointer.replace(/\//g, '\\/')}`));
  });

  it('allows a reordered coverage block (not an edit) and unbound fields such as the witness comment', () => {
    const s = scenario();
    const doc = JSON.parse(s.proposed.get(BASE_PROPOSED)!);
    const coverage = nested(nested(nested(doc, 'datasets'), 'ladder'), 'coverage');
    nested(nested(doc, 'datasets'), 'ladder').coverage = Object.fromEntries(Object.entries(coverage).reverse());
    s.proposed.set(BASE_PROPOSED, serialiseJson(doc));
    (s.changeSet.base as Record<string, string>).proposed_sha256 = sha256Hex(s.proposed.get(BASE_PROPOSED)!);
    expect(() => prepare(s)).not.toThrow();
  });
});

describe('planner with a prepared transition — one change set, validated together', () => {
  it('derives the successor from the reviewed base and still applies every planner edit', () => {
    const { plan } = planWith(prepare(scenario()));
    const contract = jsonIn(plan, CONTRACT_PATH);
    const fh = nested(contract, 'full_history');
    // the edits only the base can carry
    expect(nested(nested(contract, 'datasets'), 'ladder').rebuild_expectation)
      .toEqual({ profile: 'synthetic-profile', expected_rows: ROWS_2026 });
    expect(nested(fh, 'current_season_excluded').reason).toBe('reviewed successor reason');
    expect(contract.player_details).toEqual({ height_enrichment: { stage: 'heights', supplements: [] } });
    // the edits only the planner makes
    expect(nested(fh, 'season_range').last_season).toBe(2026);
    expect(nested(fh, 'season_range').resolved_on).toBe(DATE);
    expect(nested(fh, 'current_season_excluded').seasons).toEqual([2027]);
    expect(nested(nested(nested(contract, 'datasets'), 'ladder'), 'accepted_witness').snapshot_label)
      .toBe(NEW_WITNESS);
    expect(nested(nested(nested(contract, 'datasets'), 'ladder'), 'coverage').club_season_rows)
      .toBe(ROWS_2026);
  });

  it('feeds the very same bytes to the gates it later writes (pre-apply authority passes)', () => {
    const { plan } = planWith(prepare(scenario()));
    expect(() => proveAuthority(plan)).not.toThrow();
    expect(plan.authority.successorContractContent).toBe(fileIn(plan, CONTRACT_PATH).content);
    expect(plan.authority.successorRegisterContent)
      .toContain('reviewed successor acquisition comment');
  });

  it('is exactly the unextended plan when no transition is supplied', () => {
    const plain = run();
    expect(run({ transition: {} }).files).toEqual(plain.files);
    expect(run({ transition: { registerPatches: [] } }).files).toEqual(plain.files);
  });

  it('leaves the predecessor coherent on disk at every step (nothing pre-edits the working tree)', () => {
    const s = scenario();
    const current = () => ({
      register: JSON.parse(s.disk.get(REGISTER_PATH)!), seasons: JSON.parse(s.disk.get(SEASONS_PATH)!),
      contract: JSON.parse(s.disk.get(CONTRACT_PATH)!), statAvailability: JSON.parse(s.disk.get(STAT_AVAILABILITY_PATH)!),
      clubSeasonsExpectedRows: readClubSeasonsExpectedRows(s.disk.get(REBUILD_PATH)!),
    });
    assertCoherent(current(), 'before');
    const prepared = prepare(s);
    assertCoherent(current(), 'after prepare');
    const { plan } = planWith(prepared);
    assertCoherent(current(), 'after planning');
    // the successor is held to the same rules
    assertCoherent({
      register: jsonIn(plan, REGISTER_PATH), seasons: jsonIn(plan, SEASONS_PATH),
      contract: jsonIn(plan, CONTRACT_PATH), statAvailability: jsonIn(plan, STAT_AVAILABILITY_PATH),
      clubSeasonsExpectedRows: readClubSeasonsExpectedRows(fileIn(plan, REBUILD_PATH).content),
    }, 'successor');
  });

  it('keeps the existing gates: a wrong date, status or expectation still refuses with a transition', () => {
    const prepared = prepare(scenario());
    const withT = (request: Partial<RolloverRequest>) => () => run({ transition: prepared.transition, request });
    expect(withT({ rolloverDate: 'UNRESOLVED:OWNER-ROLLOVER-DATE' })).toThrow(/explicit YYYY-MM-DD/);
    expect(withT({ retirementStatus: 'obsolete' })).toThrow(/not one of the register's declared retired statuses/);
    expect(withT({ expectedClubSeasonRows: ROWS_2026 + 1 })).toThrow(/disagrees with/);
    expect(() => run({ transition: prepared.transition, aflApiOwnershipCensuses: [] })).toThrow(/census/i);
  });
});

describe('register patches are comment prose only, against an explicit old value', () => {
  const patch = (over: Partial<{ pointer: string; old: unknown; new: unknown }> = {}) => ({
    ...NEW_BASELINE_PATCHES[0], ...over,
  });
  const planPatches = (patches: unknown[]) =>
    () => run({ transition: { registerPatches: patches as never } });

  it('applies a reviewed patch to the new entry only and keeps every older entry byte-equal', () => {
    const plan = run({ transition: { registerPatches: [patch()] } });
    const baselines = jsonIn(plan, REGISTER_PATH).baselines as Record<string, unknown>[];
    expect(nested(baselines[1], 'acquisition').$comment).toEqual(['reviewed successor acquisition comment']);
    expect(nested(baselines[0], 'acquisition').$comment).toEqual(['carried acquisition comment']);
  });

  it.each([
    ['a different expected old value', patch({ old: ['something else'] }), /expects a different current comment/],
    ['a value-bearing field', patch({ pointer: '/measured/matches', old: 17000, new: 1 }), /does not end in \/\$comment/],
    ['a pointer that does not resolve', patch({ pointer: '/nope/$comment' }), /does not resolve/],
    ['a number as the new comment', patch({ new: 5 }), /string or a non-empty array of strings/],
    ['an empty array as the new comment', patch({ new: [] }), /string or a non-empty array of strings/],
    ['identical text', patch({ new: ['carried acquisition comment'] }), /identical text/],
    ['a forbidden segment', patch({ pointer: '/__proto__/$comment' }), /forbidden segment/],
    ['a relative pointer', patch({ pointer: 'acquisition/$comment' }), /not a JSON pointer/],
  ])('refuses %s', (_label, bad, message) => {
    expect(planPatches([bad])).toThrow(RolloverRefused);
    expect(planPatches([bad])).toThrow(message);
  });

  it('refuses the same pointer twice', () => {
    expect(planPatches([patch(), patch({ new: ['another'] })])).toThrow(/given twice/);
  });

  it('does not mutate the entry it patches', () => {
    const entry = { acquisition: { $comment: ['a'] } };
    const copy = JSON.parse(JSON.stringify(entry));
    applyRegisterPatches(entry, [{ pointer: '/acquisition/$comment', old: ['a'], new: ['b'] }]);
    expect(entry).toEqual(copy);
  });
});

describe('the successor register preserves predecessor and older history', () => {
  const retired = RETIRED_LABEL;
  const before = () => {
    const r = baseRegister();
    const older = { ...(r.baselines as Record<string, unknown>[])[0], snapshot_label: 'older-baseline', acceptance_status: 'retired' };
    r.baselines = [older, ...(r.baselines as unknown[])];
    return r;
  };
  const advance = (r: Record<string, unknown>) => {
    const next = JSON.parse(JSON.stringify(r));
    next.baselines = (next.baselines as Record<string, unknown>[]).map((b) => b.snapshot_label === retired
      ? { ...b, acceptance_status: 'retired' } : b);
    next.baselines.push({ snapshot_label: NEW_LABEL, acceptance_status: 'accepted' });
    return next;
  };

  it('accepts retirement of the outgoing baseline plus one appended entry', () => {
    const r = before();
    expect(() => assertRegisterHistoryPreserved(r, advance(r), retired, 'retired')).not.toThrow();
  });

  it('is satisfied by every real planner run', () => {
    expect(() => run()).not.toThrow();
  });

  it.each([
    ['an older baseline edited', (n: Record<string, unknown>) => { (n.baselines as Record<string, unknown>[])[0].issue = 'X'; }, /changed history: baseline older-baseline/],
    ['the predecessor edited beyond its status', (n: Record<string, unknown>) => { (n.baselines as Record<string, unknown>[])[1].accepted_on = '2030-01-01'; }, /changed history: baseline full-history-20250101/],
    ['a baseline dropped', (n: Record<string, unknown>) => { (n.baselines as unknown[]).splice(0, 1); }, /carries 2 baselines, but exactly 3/],
    ['a second appended entry', (n: Record<string, unknown>) => { (n.baselines as unknown[]).push({ snapshot_label: 'x', acceptance_status: 'retired' }); }, /carries 4 baselines/],
    ['a top-level field changed', (n: Record<string, unknown>) => { (n.selection_policy as Record<string, unknown>).retired_statuses = ['retired', 'x']; }, /changes top-level field "selection_policy"/],
    ['the predecessor left accepted', (n: Record<string, unknown>) => { (n.baselines as Record<string, unknown>[])[1].acceptance_status = 'accepted'; }, /changed history|exactly one accepted/],
    ['the new entry not accepted', (n: Record<string, unknown>) => { ((n.baselines as Record<string, unknown>[])[2]).acceptance_status = 'candidate'; }, /exactly one accepted baseline/],
  ])('refuses %s', (_label, mutate, message) => {
    const r = before();
    const n = advance(r);
    mutate(n);
    expect(() => assertRegisterHistoryPreserved(r, n, retired, 'retired')).toThrow(message);
  });
});

describe('the write set is judged whole, ordered, and pinned before apply', () => {
  const prepared = () => prepare(scenario());

  it('puts the AFL Tables switch first, then replacements, then the planner files', () => {
    const p = prepared();
    const { planned } = planWith(p);
    const { files } = assertTransitionWriteSet({ prepared: p, planned, apply: false });
    expect(files.map((f) => f.path)).toEqual([
      'data/reference/afltables-network.json', AFL_API_PATH, AFLTABLES_PATH,
      REGISTER_PATH, SEASONS_PATH, CONTRACT_PATH, STAT_AVAILABILITY_PATH, REBUILD_PATH,
    ]);
  });

  it('a dry run needs no pins and reports every hash to pin', () => {
    const p = prepared();
    const { planned } = planWith(p);
    const { finalHashes, files } = assertTransitionWriteSet({ prepared: p, planned, apply: false });
    expect(Object.keys(finalHashes).sort()).toEqual([...p.changeSet.writeSet].sort());
    for (const f of files) expect(finalHashes[f.path]).toBe(sha256Hex(f.content));
  });

  it('apply without pins refuses; with matching pins for every file it passes', () => {
    const s = scenario();
    const p = prepare(s);
    const { planned } = planWith(p);
    expect(() => assertTransitionWriteSet({ prepared: p, planned, apply: true }))
      .toThrow(/--apply needs final_sha256/);
    const { finalHashes } = assertTransitionWriteSet({ prepared: p, planned, apply: false });
    s.changeSet.final_sha256 = finalHashes;
    const pinned = prepare(s);
    const result = assertTransitionWriteSet({ prepared: pinned, planned: planWith(pinned).planned, apply: true });
    expect(result.files).toHaveLength(8);
  });

  it.each([
    ['a pin for different bytes', (h: Record<string, string>) => { h[REGISTER_PATH] = sha256Hex('other'); }, /Different bytes: data\/reference\/fitzroy-accepted-baselines\.json/],
    ['a missing pin', (h: Record<string, string>) => { delete h[REBUILD_PATH]; }, /Unpinned: tools\/db\/rebuild-test\.ts/],
    ['a pin for a file that is not written', (h: Record<string, string>) => { h['package.json'] = sha256Hex('x'); }, /Pinned but not written: package\.json/],
  ])('refuses %s', (_label, mutate, message) => {
    const s = scenario();
    const p = prepare(s);
    const { planned } = planWith(p);
    const { finalHashes } = assertTransitionWriteSet({ prepared: p, planned, apply: false });
    const hashes = { ...finalHashes };
    mutate(hashes);
    s.changeSet.final_sha256 = hashes;
    const pinned = prepare(s);
    for (const apply of [false, true]) {
      expect(() => assertTransitionWriteSet({ prepared: pinned, planned: planWith(pinned).planned, apply }))
        .toThrow(message);
    }
  });

  it('refuses a planner that does not produce exactly the owned files', () => {
    const p = prepared();
    const { planned } = planWith(p);
    expect(() => assertTransitionWriteSet({ prepared: p, planned: planned.slice(1), apply: false }))
      .toThrow(/The planner produced/);
  });

  it('shows a concrete per-file diff, and register history is untouched in it', () => {
    const s = scenario();
    const p = prepare(s);
    const { planned } = planWith(p);
    const { files } = assertTransitionWriteSet({ prepared: p, planned, apply: false });
    const diffs = describeTransitionDiff(files, bufferOf(s.disk));
    const by = (path: string) => diffs.find((d) => d.path === path)!;

    expect(by(AFL_API_PATH).changes).toEqual([
      { where: '/measured/players_with_afl_api_evidence', kind: 'change', before: '1824', after: '1916' },
    ]);
    expect(by('data/reference/afltables-network.json').changes.map((c) => c.where).sort())
      .toEqual(['/changed_at', '/decision', '/status']);
    expect(by(CONTRACT_PATH).changes.some((c) => c.where === '/datasets/ladder/rebuild_expectation' && c.kind === 'add')).toBe(true);
    expect(by(REBUILD_PATH).changes).toEqual([
      { where: expect.stringMatching(/^line \d+$/), kind: 'remove', before: JSON.stringify(`  rows: ${ROWS_2025},`) },
      { where: expect.stringMatching(/^line \d+$/), kind: 'add', after: JSON.stringify(`  rows: ${ROWS_2026},`) },
    ]);
    // Older register history never appears in the diff: only the predecessor's status and the append.
    const where = by(REGISTER_PATH).changes.map((c) => c.where);
    expect(where).toContain('/baselines/0/acceptance_status');
    expect(where.every((w) => w === '/baselines/0/acceptance_status' || w.startsWith('/baselines/1'))).toBe(true);
    for (const d of diffs) {
      expect(d.oldSha256).toBe(sha256Hex(s.disk.get(d.path)!));
      expect(d.newSha256).not.toBe(d.oldSha256);
    }
    const text = formatTransitionDiff(diffs).join('\n');
    expect(text).toContain(`${by(AFL_API_PATH).oldSha256} (`);
    expect(text).toContain('/measured/players_with_afl_api_evidence');
  });
});

describe('the staged apply, its journal and recovery', () => {
  /** An in-memory filesystem with an optional fault on the Nth rename or on a staged write. */
  function memoryIo(initial: Map<string, string>, fault: { renameAt?: number; writeOf?: string } = {}) {
    const fs = new Map(initial);
    let renames = 0;
    const io: FileIo = {
      read: (p) => (fs.has(p) ? Buffer.from(fs.get(p)!) : null),
      write: (p, c) => {
        if (fault.writeOf !== undefined && p.startsWith(fault.writeOf)) throw new Error('disk full');
        fs.set(p, c);
      },
      rename: (a, b) => {
        renames += 1;
        if (fault.renameAt === renames) throw new Error('rename failed');
        fs.set(b, fs.get(a)!); fs.delete(a);
      },
      remove: (p) => { fs.delete(p); },
    };
    return { fs, io };
  }
  const files = (): Array<{ path: string; content: string; reformatted: boolean }> =>
    ['a.json', 'b.json', 'c.json'].map((path) => ({ path, content: `new ${path}`, reformatted: false }));
  const disk = () => new Map([['a.json', 'old a.json'], ['b.json', 'old b.json'], ['c.json', 'old c.json']]);

  it('a clean apply leaves new bytes, no journal and no staged file', () => {
    const { fs, io } = memoryIo(disk());
    applyStagedWrites(io, 2026, files());
    expect([...fs.entries()].sort()).toEqual([['a.json', 'new a.json'], ['b.json', 'new b.json'], ['c.json', 'new c.json']]);
    expect(pendingTransactionProblem(io)).toBeNull();
  });

  it('stages and reads back every file before the first rename, and journals before it', () => {
    const order: string[] = [];
    const { io } = memoryIo(disk());
    const traced: FileIo = {
      ...io,
      write: (p, c) => { order.push(`write ${p}`); io.write(p, c); },
      rename: (a, b) => { order.push(`rename ${b}`); io.rename(a, b); },
    };
    applyStagedWrites(traced, 2026, files());
    const firstRename = order.findIndex((o) => o.startsWith('rename'));
    expect(order.slice(0, firstRename).filter((o) => o.startsWith('write')).length).toBe(4);   // 3 files + journal
    expect(order[firstRename]).toBe(`rename ${TRANSACTION_JOURNAL_PATH}`);
    expect(order.slice(firstRename + 1)).toEqual(['rename a.json', 'rename b.json', 'rename c.json']);
  });

  it('an interrupted rename sequence leaves the journal, so the next invocation refuses with the per-file state', () => {
    const { fs, io } = memoryIo(disk(), { renameAt: 3 });   // journal=1, a=2, b fails
    expect(() => applyStagedWrites(io, 2026, files())).toThrow('rename failed');
    expect(fs.has(TRANSACTION_JOURNAL_PATH)).toBe(true);
    const problem = pendingTransactionProblem(io)!;
    expect(problem.join('\n')).toContain('did not finish');
    expect(problem).toContain('  new     a.json');
    expect(problem).toContain('  old     b.json');
    expect(problem.join('\n')).toContain('Files are mixed. Restore EVERY listed file to its old bytes');
    // every old byte is recoverable from the journal itself
    const journal = JSON.parse(fs.get(TRANSACTION_JOURNAL_PATH)!);
    expect(journal.schema).toBe(TRANSACTION_JOURNAL_SCHEMA);
    expect(Buffer.from(journal.entries[0].oldBase64, 'base64').toString()).toBe('old a.json');
  });

  it('a failure while staging removes what was staged and renames nothing', () => {
    const { fs, io } = memoryIo(disk(), { writeOf: 'c.json' });
    expect(() => applyStagedWrites(io, 2026, files())).toThrow('disk full');
    expect([...fs.keys()].sort()).toEqual(['a.json', 'b.json', 'c.json']);
    expect(fs.get('a.json')).toBe('old a.json');
    expect(pendingTransactionProblem(io)).toBeNull();
  });

  it('a failure writing the journal removes the staged files and leaves the tracked bytes alone', () => {
    const { fs, io } = memoryIo(disk(), { writeOf: TRANSACTION_JOURNAL_PATH });
    expect(() => applyStagedWrites(io, 2026, files())).toThrow('disk full');
    expect([...fs.entries()].sort()).toEqual([['a.json', 'old a.json'], ['b.json', 'old b.json'], ['c.json', 'old c.json']]);
  });

  it('leftover staged files alone are reported as untouched tracked files', () => {
    const { io } = memoryIo(new Map([[`${PLANNER_OWNED_WRITES[0]}.rollover-tmp`, 'x']]));
    expect(pendingTransactionProblem(io)!.join('\n')).toContain('tracked files are untouched');
  });

  it('classifies old / new / neither / absent and words the recovery for each overall state', () => {
    const journal = buildTransactionJournal(2026, files(), (p) => Buffer.from(disk().get(p)!));
    const sha = (m: Record<string, string | null>) => (p: string) => m[p] ?? null;
    const old = { 'a.json': sha256Hex('old a.json'), 'b.json': sha256Hex('old b.json'), 'c.json': sha256Hex('old c.json') };
    const next = { 'a.json': sha256Hex('new a.json'), 'b.json': sha256Hex('new b.json'), 'c.json': sha256Hex('new c.json') };
    expect(classifyTransaction(journal, sha({ ...old, 'a.json': next['a.json'], 'b.json': sha256Hex('weird'), 'c.json': null })))
      .toEqual([{ path: 'a.json', state: 'new' }, { path: 'b.json', state: 'neither' }, { path: 'c.json', state: 'absent' }]);
    const wording = (m: Record<string, string>) =>
      recoveryRequirements(journal, classifyTransaction(journal, sha(m))).join('\n');
    expect(wording(old)).toContain('Every file still holds the old bytes');
    expect(wording(next)).toContain('Every file already holds the reviewed new bytes');
    expect(wording({ ...old, 'a.json': next['a.json'] })).toContain('Files are mixed');
  });
});
