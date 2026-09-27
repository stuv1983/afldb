/**
 * AFLDB-ISSUE-252 — the code_test_db rehearsal of the current-season promotion source: the
 * preparation CLI and the source dependency gate (runbook §19.6 A–L and §21.6 M–T).
 *
 *     AFLDB_CODE_TEST_DATABASE_URL=<afldb_owner DSN naming code_test_db> \
 *     AFLDB_CODE_TEST_IMPORT_DATABASE_URL=<afldb_import DSN naming code_test_db> \
 *       npx tsx --conditions=react-server tools/db/promotion-source-dependency-rehearsal.ts \
 *         run --acknowledge code_test_db --out <new, empty evidence dir>
 *     ... residue                                (read-only namespace census; expect all zero)
 *     ... teardown --acknowledge code_test_db    (after an interrupted run)
 *
 * Both variables are read by `resolveRehearsalDsns` (the ISSUE-237 fixture's guard); both must name
 * code_test_db. The import DSN is REQUIRED here: the settles run as the import role, as they do in
 * `prepare-promotion-source.ts`.
 *
 * WHAT IT PROVES. The cases in `REHEARSAL_CASES` (A–T, plus U: a 2026 match that is already not
 * AFL Tables-owned refuses preparation before any settle; and V: the standalone `--dry-run` is an
 * unproven preview that writes nothing, Q-252-11). Every decision is made by the real
 * exported functions: `runPreparePromotionSource()` with the real `runSettleCli()` and
 * `runAflApiSettleCli()`; `runDependenciesPhase()` / `captureTargetDependencyManifest()` for the
 * target manifest; `gateSourceDependencies()` + `publishSourceDependencyProof()` for the source
 * gate; `gateFrozenDependencyBinding()` for the frozen re-check; and the parsers for every file.
 * Nothing here re-implements a gate.
 *
 * TWO NAMES ARE LABELS, NOT CONNECTIONS. `buildDependencyManifest()` accepts only the environment's
 * live name (`afldb_prod`) as the target, and `buildSourceDependencyProof()` / the preparation
 * record only `afldb_test` as the source. This rehearsal passes those two NAMES as labels; every
 * read and write actually goes through its own code_test_db connections (the target schema below
 * and `public`). The same substitution is made once more for preparation: the real
 * `preparationDatabaseProblems()` guard refuses anything but `afldb_test` by `current_database()`,
 * so on code_test_db the REAL guard always refuses — that refusal IS case T (T4). The positive
 * preparation cases inject a `prove` that calls the real `proveAflApiIngestionPreflight()`, asserts
 * that BOTH real sessions answered `code_test_db`, and only then presents them under the source
 * name (`presentAsPreparedSource()`). Every other step of the CLI runs unchanged.
 *
 * THE TARGET. PROD and DEV are never contacted. The target is the schema `issue252_rehearsal_target`
 * inside code_test_db — its own `sources`, `matches`, `brownlow_vote_entry_state`, `data_edits` and
 * `data_overrides` — read through a connection whose search_path is that schema only, so the
 * checker's own unqualified target SQL runs unchanged. Target ids come from one sequence offset to
 * 910 000 001, disjoint from any source id (case I). `matches.id` is deliberately NOT unique there:
 * case G builds a real target anchor whose id names two identities.
 *
 * THE SOURCE. `public` in code_test_db, prepared from retained fixture bytes written under
 * `<out>/project-root` in the two established layouts: an AFL Tables observation bundle with its
 * hash-bound manifest, and an AFL API match snapshot with its `manifest.json`. The AFL API unit is
 * the tracked `tests/fixtures/afl_api/match/01-…03-…` unit renamed onto `CD_M2026252R*` and its two
 * players onto `CD_I9252001/2`; the AFL Tables record is derived from the SAME unit and from the
 * identity the real `buildAflApiMatchIdentity()` renders for it, so both sources carry one match_key.
 *
 * ISOLATION. Refused before any write unless: current_database() = code_test_db on both sessions,
 * transaction_read_only is off, no other session is connected, the namespace is empty, the 2026
 * season is present and holds no match that is not AFL Tables-owned, the fixture's venue maps, and
 * `findPlausibleCanonicalFixtures()` finds no canonical row for either fixture identity.
 *
 * NAMESPACE. Labels and AFL Tables record ids `issue252-rehearsal-…`, AFL API provider ids
 * `CD_M2026252R…`, player provider ids `CD_I9252…`, player slugs `issue252-rehearsal-…`, AFL Tables
 * profile paths `players/Z/Zz252_Rehearsal_…`, and the target schema. Every world is torn down before
 * the next (catalog-driven: every row that references a fixture match, fixture player or fixture
 * import batch), the 2026 derived state is recomputed by the real `recompute*()` functions, and the
 * run ends with a zero-residue proof (L). The ONE documented exception: sequences the real writers
 * advanced stay advanced. The AFL API current-season switch is written ONLY by this rehearsal, on
 * code_test_db, with its prior row recorded and restored in a finally (the CLI itself never writes
 * it — T checks that). No DSN is printed.
 *
 * UNVERIFIED UNTIL FIRST RUN (fixture engineering that could not be proved without a database):
 *   1. The AFL Tables projection built by `rehearsalAflTablesRecord()` (venue_raw = the unit's
 *      `venueLegacyName`, '5:15 PM' match_time, period-1 scores only, attendance 50000/'complete')
 *      auto-applies as a canonical INSERT with every §21.2 zero counter at 0.
 *   2. AFL API `apiRound` 1/2 on June 2026 dates render a key no real code_test_db row makes
 *      plausible (preflight checks this with the real F030 predicate and refuses otherwise).
 *   3. The seeded player links (`afl_api` `unique` / `afl_api_stat_vector_bootstrap`, plus an
 *      `afltables` profile link) are enough for both AFL API player units to resolve and apply, so
 *      `unresolvedIdentityPlayer` = 0 and the source is `complete`.
 *   4. An AFL API snapshot with NO retained season feed leaves the absence sweep skipped (never a
 *      HALT) and does not itself make the run incomplete.
 *   5. `matches.source_record_id` of the AFL Tables insert is the AFL Tables record id (residue is
 *      also counted by the fixture match_keys, so a miss here is still caught).
 *   6. Every row a settle writes references a fixture match, fixture player or fixture import batch
 *      by a single-column FK, or is a `data_issues` / `staging.source_payloads` row carrying a
 *      namespace id; otherwise teardown refuses (it never deletes a row it cannot attribute).
 *   7. Recomputing 2026 (`recomputeSeasonMetadata/ClubSeasons/SeasonBrownlowStatus`) after teardown
 *      reproduces the baseline recomputed (and rolled back) before the first write, modulo the
 *      `updated_at`/`created_at` columns the hash omits. FIRST RUN (attempt 1): code_test_db's 2026
 *      holds no match, which `recomputeClubSeasons()` refuses by design; an empty season is now
 *      restored verbatim to its as-found row instead (`restoreDerived()`).
 *   8. `site_settings` has no trigger that would record the rehearsal's own switch writes elsewhere.
 * Case K (a second --apply of the same labels) is the independent idempotence proof; it never stands
 * in for case A's mandatory Q-252-10 closure dry run, which the CLI itself runs inside A.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres, { type Sql, type TransactionSql } from 'postgres';

import { parseAflApiIdentities, type AflApiMatchBundle } from '../../src/lib/acquisition/afl-api-bundle';
import {
  proveAflApiIngestionPreflight,
  requireSameAflApiDatabase,
  type AflApiIngestionPreflight,
} from '../../src/lib/acquisition/afl-api-ingestion-safety';
import { buildAflApiMatchIdentity, resolveAflApiSourceId } from '../../src/lib/acquisition/afl-api-match-identity';
import { aflApiSnapshotRoot } from '../../src/lib/acquisition/afl-api-snapshot';
import { findPlausibleCanonicalFixtures } from '../../src/lib/acquisition/match-rekey';
import { buildAflApiSettleBundle, type AflApiSettleUnitSource } from '../../src/lib/acquisition/settle-afl-api';
import { SETTLE_ACQUISITION_KIND } from '../../src/lib/acquisition/settle-afltables';
import { getSourceFamily, parseSourceFamilyRegistry, type SourceFamilyRegistry } from '../../src/lib/acquisition/source-families';
import { SETTING_KEYS } from '../../src/lib/site-settings';
import { recomputeClubSeasons, recomputeSeasonBrownlowStatus, recomputeSeasonMetadata } from '../../src/db/queries/player-derived';
import { runAflApiSettleCli } from '../current-season/settle-afl-api';
import { runSettleCli } from '../current-season/settle-afltables';
import { REHEARSAL_IMPORT_ENV, REHEARSAL_OWNER_ENV, resolveRehearsalDsns } from '../migration/afl_api_identity_rebuild_rehearsal_fixture';
import type { Row } from './catalog-fingerprint';
import { runPreparePromotionSource, type PrepareDeps, type PrepareOutcome } from './prepare-promotion-source';
import {
  captureTargetDependencyManifest,
  gateSourceDependencies,
  publishSourceDependencyProof,
  readSourceDependencyInputs,
  Report,
  runDependenciesPhase,
  writeOperatorFileAtomically,
  type Options,
  type Query,
} from './promotion-check';
import { environmentNames, quoteIdent } from './promotion-inventory';
import {
  AFLTABLES_FIRST_APPLY_TOLERATED_COUNTER,
  PREPARATION_PREVIEW_STATUS,
  PREPARATION_RECORD_SCHEMA_VERSION,
  PREPARATION_ZERO_COUNTERS,
  buildDependencyManifest,
  buildSourceDependencyProof,
  compareDependencyManifests,
  familyOutcomeCounts,
  familyStatusesFor,
  judgeSourceDependencies,
  parseDependencyManifest,
  parsePreparationRecord,
  parseSourceDependencyProof,
  preexistingSeasonOwnershipProblems,
  sha256Hex,
  sourceProofBindingProblems,
  type DependencyFamilyId,
  type DependencyManifest,
  type PreparationBinding,
  type SourceDependencyJudgement,
  type SourceDependencyProof,
} from './promotion-source-dependencies';
import { redact } from './psql';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NAMES = environmentNames('prod');

export class SourceDependencyRehearsalRefused extends Error {}

export const SOURCE_DEPENDENCY_REHEARSAL = {
  database: 'code_test_db',
  targetSchema: 'issue252_rehearsal_target',
  /** Labels only (see the header): the checker's target and source names for `prod`. */
  environment: 'prod',
  targetLabel: NAMES.live,
  sourceLabel: NAMES.source,
  season: 2026,
  historicalSeason: 2025,
  compSeasonProviderId: 'CD_S2026014',
  providerPrefix: 'CD_M2026252R',
  playerProviderPrefix: 'CD_I9252',
  /** Snapshot labels, AFL Tables record ids/scopes, and player slugs all start with it. */
  labelPrefix: 'issue252-rehearsal',
  recordPrefix: 'issue252-rehearsal-',
  slugPrefix: 'issue252-rehearsal-',
  playerPathPrefix: 'players/Z/Zz252_Rehearsal_',
  payloadMarker: 'issue252_rehearsal_fixture',
  targetIdOffset: 910_000_000,
  applicationName: 'afldb-issue252-source-dependency-rehearsal',
} as const;

const f = SOURCE_DEPENDENCY_REHEARSAL;

// ---------------------------------------------------------------------------
// The cases (pure)
// ---------------------------------------------------------------------------

export type RehearsalCaseId =
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K'
  | 'L' | 'M' | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V';

export const REHEARSAL_CASES: readonly { id: RehearsalCaseId; proves: string }[] = [
  { id: 'A', proves: 'Preparation from retained fixture bytes: hash-bound labels accepted; the first real AFL Tables --apply carries the measured transient unresolvedIdentityMatch (Q-252-10) with every other zero counter 0; the same-label AFL Tables closure --dry-run straight after it is all zero with 0 inserted/updated; only then the AFL API dry run and apply; record (both AFL Tables results separately) written and bound into a PASS proof; negative controls: an unclean closure refuses before AFL API, another non-zero counter on the initial apply refuses immediately' },
  { id: 'B', proves: 'F1: a target brownlow_vote_entry_state row on the fixture match resolves, with owner parity, after preparation' },
  { id: 'C', proves: 'The same dependencies REFUSE (identity_absent_in_candidate, key named) when the gate runs before preparation' },
  { id: 'D', proves: "F2: an active 'matches' and a 'match_coaches' override on the fixture match resolve after preparation" },
  { id: 'E', proves: "F3: a data_edits 'matches' row resolves after preparation" },
  { id: 'F', proves: 'A target dependency on a key no retained unit carries is a hard STOP naming the key; the other families are still reported separately' },
  { id: 'G', proves: 'Ambiguity is a hard STOP: a target anchor with two identities (ambiguous_in_replaced) and an undecodable match_coaches key (no identity)' },
  { id: 'H', proves: 'A historical (2025) dependency resolves identically before and after preparation; preparation touches no pre-2026 match' },
  { id: 'I', proves: 'Target ids are disjoint from source ids (target sequence offset); resolution is by match_key alone' },
  { id: 'J', proves: 'Wrong-database guards: target/source names, a manifest whose environment/target disagree or whose sha256 is not the supplied one, and tampered snapshot files refuse (offline)' },
  { id: 'K', proves: 'Idempotent preparation: a second --apply of the same labels inserts 0 and updates 0; the gate verdict is unchanged' },
  { id: 'L', proves: 'Zero fixture residue after teardown (documented exception: sequences advanced by the real writers); switch and 2026 derived state restored' },
  { id: 'M', proves: 'AFL Tables-first then AFL API corroboration leaves the source match afltables-owned; an afltables-owned target dependency PASSes' },
  { id: 'N', proves: 'The same stable match prepared AFL API-first resolves by match_key but REFUSES owner_mismatch' },
  { id: 'O', proves: 'Target keys one component away from the source key (round, date, team) are hard STOPs naming the target key' },
  { id: 'P', proves: 'Manifests A (pre-freeze) and B of an unchanged target share dependency_set_sha256; the frozen binding PASSes' },
  { id: 'Q', proves: 'A dependency created between A and B changes the hash; the earlier proof is refused as stale' },
  { id: 'R', proves: 'A frozen manifest adding a dependency absent from the prepared source is a hard STOP when judged' },
  { id: 'S', proves: 'Transport tampering (bytes changed, sha not) and semantic tampering (content edited, file re-hashed) are both refused' },
  { id: 'T', proves: 'Preparation guards through the real CLI: switch disabled refuses, enabled passes the guard, disagreeing sessions refuse, a session other than afldb_test refuses; the CLI never writes the switch' },
  { id: 'U', proves: 'A 2026 match already not afltables-owned (AFL API first) refuses preparation before any settle runs' },
  { id: 'V', proves: 'Q-252-11: the standalone preparation --dry-run on the fresh source is an UNPROVEN PREVIEW: the real transient unresolvedIdentityMatch (within the inserted bound) is accepted, the result says unproven, no preparation record and no source proof are written, and the database is unchanged; negative controls: another non-zero counter, or unresolvedIdentityMatch above the inserted rows, still refuses; after preparation the same preview is clean (0/0/0)' },
];

// ---------------------------------------------------------------------------
// Arguments (pure)
// ---------------------------------------------------------------------------

export type SourceDependencyRehearsalCommand =
  | { step: 'run'; out: string }
  | { step: 'residue' }
  | { step: 'teardown'; seasonAsFound: string | null };

export function parseSourceDependencyRehearsalArgs(argv: readonly string[]): SourceDependencyRehearsalCommand {
  const [step, ...rest] = argv;
  if (step !== 'run' && step !== 'residue' && step !== 'teardown') {
    throw new SourceDependencyRehearsalRefused('Usage: run --acknowledge code_test_db --out <dir> | residue | teardown --acknowledge code_test_db [--season-as-found <run>/evidence/season-as-found.json].');
  }
  const allowed: Record<typeof step, readonly string[]> = {
    run: ['--acknowledge', '--out'], residue: [], teardown: ['--acknowledge', '--season-as-found'],
  };
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (!allowed[step].includes(flag)) throw new SourceDependencyRehearsalRefused(`Unknown flag ${flag} for ${step}.`);
    if (value === undefined || value.startsWith('--')) throw new SourceDependencyRehearsalRefused(`${flag} needs a value.`);
    if (flags.has(flag)) throw new SourceDependencyRehearsalRefused(`${flag} was given twice.`);
    flags.set(flag, value);
  }
  if (step === 'residue') return { step };
  if (flags.get('--acknowledge') !== f.database) {
    throw new SourceDependencyRehearsalRefused(`${step} writes to ${f.database}: pass --acknowledge ${f.database}.`);
  }
  if (step === 'teardown') return { step, seasonAsFound: flags.get('--season-as-found') ?? null };
  const out = flags.get('--out');
  if (!out) throw new SourceDependencyRehearsalRefused('run needs --out <new, empty evidence dir>.');
  return { step, out };
}

// ---------------------------------------------------------------------------
// The fixture (pure, apart from reading tracked files)
// ---------------------------------------------------------------------------

export type RehearsalFixtureSpec = { world: string; providerId: string; date: string; apiRound: number };

/** Two worlds, one fixture each. They differ in round AND date, so neither makes the other plausible. */
export const REHEARSAL_FIXTURES = {
  main: { world: 'main', providerId: `${f.providerPrefix}01`, date: '2026-06-16', apiRound: 1 },
  n: { world: 'n', providerId: `${f.providerPrefix}02`, date: '2026-06-23', apiRound: 2 },
} as const satisfies Record<string, RehearsalFixtureSpec>;

/** The tracked unit's two provider player ids, renamed into the namespace. */
export const REHEARSAL_PLAYERS = [
  { from: 'CD_I297354', to: `${f.playerProviderPrefix}001`, n: 1 },
  { from: 'CD_I500001', to: `${f.playerProviderPrefix}002`, n: 2 },
] as const;

export function rehearsalLabels(world: string): { afltables: string; aflApi: string } {
  return { afltables: `${f.labelPrefix}-at-${world}`, aflApi: `${f.labelPrefix}-api-${world}` };
}

function readRepoJson(...parts: string[]): unknown {
  return JSON.parse(readFileSync(join(PROJECT_ROOT, ...parts), 'utf8'));
}

function renamePlayers<T>(value: T): T {
  let text = JSON.stringify(value);
  for (const p of REHEARSAL_PLAYERS) text = text.split(`"${p.from}"`).join(`"${p.to}"`);
  return JSON.parse(text) as T;
}

/**
 * The tracked unit renamed onto the fixture's provider id, June date (AEST, UTC+10, so the local
 * cross-check proves the date) and home-and-away round — the same renames the ISSUE-231 rehearsal
 * proves — with both player ids moved into the namespace.
 */
export function rehearsalUnitSource(spec: RehearsalFixtureSpec): AflApiSettleUnitSource {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const fixture = renamePlayers(readRepoJson('tests', 'fixtures', 'afl_api', 'match', '01-fixture-result.json')) as Record<string, any>;
  const roster = renamePlayers(readRepoJson('tests', 'fixtures', 'afl_api', 'match', '03-match-roster.raw.json')) as Record<string, any>;
  const stats = renamePlayers(readRepoJson('tests', 'fixtures', 'afl_api', 'match', '02-player-stats.raw.json')) as Record<string, any>;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  fixture.providerId = spec.providerId;
  fixture.utcStartTime = `${spec.date}T07:15:00.000+0000`;
  fixture.round = { ...fixture.round, abbreviation: `Rd ${spec.apiRound}`, name: `Round ${spec.apiRound}`, roundNumber: spec.apiRound };
  roster.match.matchId = spec.providerId;
  roster.match.venueLocalStartTime = `${spec.date}T17:15:00`;
  roster.matchRoster.matchId = spec.providerId;
  roster.matchRoster.roundNumber = spec.apiRound;
  roster.matchRoster.homeTeam.matchId = spec.providerId;
  roster.matchRoster.awayTeam.matchId = spec.providerId;
  roster.recentMatchScores[0].matchId = spec.providerId;
  return { fixtureRaw: fixture, rosterRaw: roster, playerStatsRaw: stats };
}

export function rehearsalReferences(): { registry: SourceFamilyRegistry; identities: ReturnType<typeof parseAflApiIdentities> } {
  return {
    registry: parseSourceFamilyRegistry(readRepoJson('data', 'reference', 'source-families.json')),
    identities: parseAflApiIdentities(readRepoJson('data', 'reference', 'afl-api-identities.json')),
  };
}

/** The unit as the AFL API settle will see it, built by the real (offline) bundle builder. */
export function rehearsalUnitBundle(spec: RehearsalFixtureSpec): AflApiMatchBundle {
  const { registry, identities } = rehearsalReferences();
  const bundle = buildAflApiSettleBundle({
    season: f.season, snapshotLabel: rehearsalLabels(spec.world).aflApi, sources: [rehearsalUnitSource(spec)], registry, identities,
  });
  if (bundle.buildFailures.length > 0 || bundle.units.length !== 1) {
    throw new SourceDependencyRehearsalRefused(`fixture unit ${spec.providerId} did not build: ${JSON.stringify(bundle.buildFailures)}`);
  }
  return bundle.units[0].bundle;
}

/** '17:15' -> '5:15 PM', the AFL Tables rendering. */
export function twelveHour(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export type RehearsalMatchIdentity = { matchKey: string; roundCode: string; matchDate: string };

/**
 * The AFL Tables observation record for the SAME match: the key, round and date are the identity
 * the real `buildAflApiMatchIdentity()` rendered for the AFL API unit, the scores the unit's own, so
 * the AFL API settle meets an AFL Tables-owned row with agreeing scores (§19.1 corroboration).
 */
export function rehearsalAflTablesRecord(
  world: string, unit: AflApiMatchBundle, identity: RehearsalMatchIdentity, unitSource: AflApiSettleUnitSource,
  registry: SourceFamilyRegistry,
): Record<string, unknown> {
  const m = unit.match;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const scores = (unitSource.rosterRaw as Record<string, any>).recentMatchScores[0];
  const q1 = (side: 'homeTeamScore' | 'awayTeamScore') => scores[side].periodScore[0].score as { goals: number; behinds: number; totalScore: number };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const [h1, a1] = [q1('homeTeamScore'), q1('awayTeamScore')];
  const winner = m.result === 'draw' ? null : m.result === 'home_win' ? m.homeClubHist : m.awayClubHist;
  return {
    family: 'afltables.match',
    scope_key: `${f.recordPrefix}${world}`,
    external_record_id: `${f.recordPrefix}${world}-match`,
    payload: {
      [f.payloadMarker]: true, season: m.season, round_code: identity.roundCode, match_date: identity.matchDate,
      home_team_raw: m.homeClubHist, away_team_raw: m.awayClubHist,
      home_goals: m.homeGoals, home_behinds: m.homeBehinds, home_points: m.homeScore,
      away_goals: m.awayGoals, away_behinds: m.awayBehinds, away_points: m.awayScore,
      margin: Math.abs(m.homeScore - m.awayScore),
    },
    observed_columns: [...(getSourceFamily(registry, 'afltables', 'match').knownColumns ?? [])],
    projection: {
      match_key: identity.matchKey, season: m.season, round_code: identity.roundCode, round_number: m.roundNumber,
      round_type: m.roundType, is_final: m.isFinal, match_date: identity.matchDate,
      match_time: twelveHour(unit.localMatchDateTime?.matchTime ?? '17:15'),
      venue_raw: m.venueLegacyName, home_club_hist: m.homeClubHist, away_club_hist: m.awayClubHist,
      home_goals: m.homeGoals, home_behinds: m.homeBehinds, home_score: m.homeScore,
      away_goals: m.awayGoals, away_behinds: m.awayBehinds, away_score: m.awayScore,
      result: m.result, winner_club_hist: winner, margin: Math.abs(m.homeScore - m.awayScore),
      attendance: 50000, attendance_status: 'complete', attendance_source_key: 'afltables',
      period_scores: [
        { side: 'home', period: 1, goals: h1.goals, behinds: h1.behinds, points: h1.totalScore },
        { side: 'away', period: 1, goals: a1.goals, behinds: a1.behinds, points: a1.totalScore },
      ],
    },
    rejection: null,
  };
}

/** The bundle `import_fitzroy_core.py --emit-observations` would write for that one record. */
export function rehearsalAflTablesBundle(
  label: string, manifestRel: string, manifestSha256: string, record: Record<string, unknown>,
): Record<string, unknown> {
  return {
    bundle_contract_version: 1,
    generated_by: 'tools/migration/import_fitzroy_core.py',
    snapshot_label: label,
    manifest_path: manifestRel,
    manifest_sha256: manifestSha256,
    acquisition_kind: SETTLE_ACQUISITION_KIND,
    season: f.season,
    fitzroy_version: '1.8.0',
    enumerations: [{
      family: 'afltables.match', scope_key: record.scope_key, complete: true, incomplete_reason: null,
      external_record_ids: [record.external_record_id],
    }],
    records: [record],
    unkeyed_rejections: [],
    counts: { matches: 1, player_match_rows: 0, rejections: 0, unkeyed_rejections: 0 },
  };
}

/** One-component variants of `season|round|date|home|away` (case O). Never a real fixture's key. */
export function oneComponentVariants(matchKey: string): { component: 'round' | 'date' | 'team'; key: string }[] {
  const parts = matchKey.split('|');
  if (parts.length !== 5) throw new SourceDependencyRehearsalRefused(`'${matchKey}' is not season|round|date|home|away.`);
  const [season, round, date, home, away] = parts;
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return [
    { component: 'round', key: [season, round === '99' ? '98' : '99', date, home, away].join('|') },
    { component: 'date', key: [season, round, day.toISOString().slice(0, 10), home, away].join('|') },
    { component: 'team', key: [season, round, date, 'Issue252 Rehearsal Club', away].join('|') },
  ];
}

/**
 * The substitution the header documents: BOTH real sessions must have answered code_test_db, and
 * only then are they presented under the prepared source's name. `sides` lets T3/J present one only.
 */
export function presentAsPreparedSource(
  real: AflApiIngestionPreflight, sides: 'both' | 'control' | 'writer' = 'both',
): AflApiIngestionPreflight {
  const wrong = [real.control, real.writer].filter((s) => s.database !== f.database);
  if (wrong.length > 0) {
    throw new SourceDependencyRehearsalRefused(`the live sessions answered ${wrong.map((s) => `'${s.database}'`).join(', ')}, not ${f.database}; nothing is presented`);
  }
  return {
    ...real,
    control: sides === 'writer' ? real.control : { ...real.control, database: f.sourceLabel },
    writer: sides === 'control' ? real.writer : { ...real.writer, database: f.sourceLabel },
  };
}

export type RehearsalSnapshotHashes = { afltablesManifest: string; afltablesBundle: string; aflApiManifest: string };

export function prepareArgv(
  labels: { afltables: string; aflApi: string }, hashes: RehearsalSnapshotHashes,
  mode: 'apply' | 'dry-run' | 'validate-only', recordOut?: string, acknowledge: string = f.sourceLabel,
): string[] {
  return [
    '--acknowledge', acknowledge,
    '--afltables-label', labels.afltables, '--expect-afltables-manifest-sha256', hashes.afltablesManifest,
    '--expect-afltables-bundle-sha256', hashes.afltablesBundle,
    '--afl-api-label', labels.aflApi, '--expect-afl-api-manifest-sha256', hashes.aflApiManifest,
    `--${mode}`, ...(recordOut ? ['--record-out', recordOut] : []),
  ];
}

/** Checker options for the label names; nothing here is a connection. */
function checkerOptions(over: Partial<Options>): Options {
  return { environment: 'prod', dsnEnv: REHEARSAL_OWNER_ENV, plan: false, checklist: false, allowFixtureIdentities: false, ...over };
}

// ---------------------------------------------------------------------------
// Retained snapshots on disk (the project root the CLIs read)
// ---------------------------------------------------------------------------

function writeText(path: string, text: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, { encoding: 'utf8', flag: 'wx' });
  return sha256Hex(text);
}

function writeProjectReferences(root: string): void {
  for (const name of ['source-families.json', 'afl-api-identities.json']) {
    writeText(join(root, 'data', 'reference', name), readFileSync(join(PROJECT_ROOT, 'data', 'reference', name), 'utf8'));
  }
  writeText(join(root, 'data', 'reference', 'seasons.json'), `${JSON.stringify({ in_progress_seasons: [f.season] })}\n`);
}

function writeAflApiSnapshot(root: string, label: string, source: AflApiSettleUnitSource, providerId: string): string {
  const dir = join(aflApiSnapshotRoot(root), label);
  const files = ([['fixture.json', source.fixtureRaw], ['match-roster.json', source.rosterRaw], ['player-stats.json', source.playerStatsRaw]] as const)
    .map(([name, raw]) => ({ file: `${providerId}/${name}`, sha256: writeText(join(dir, providerId, name), JSON.stringify(raw, null, 2)) }));
  const manifest = {
    contract_version: 1, source_key: 'afl_api', acquisition_kind: 'afl_api_match_snapshot', fixtures_only: false,
    label, season: f.season, comp_season_id: f.compSeasonProviderId,
    selection: { status: null, since: null, match: [providerId] }, acquired_at: '2026-09-27T00:00:00.000Z',
    counts: { matches_in_feed: 1, matches_selected: 1 }, files, [f.payloadMarker]: true,
  };
  return writeText(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

function writeAflTablesSnapshot(root: string, label: string, record: Record<string, unknown>): { manifest: string; bundle: string } {
  const workingDirectory = `data/sources/afltables/fitzroy_core/${label}`;
  const csvSha = writeText(join(root, workingDirectory, 'results.csv'), `issue252_rehearsal,${label}\n`);
  const manifestRel = `docs/rebuild-manifests/afltables_fitzroy_core/${label}.json`;
  const manifestSha = writeText(join(root, manifestRel), JSON.stringify({
    snapshot_label: label, mode: 'acquire', acquisition_kind: SETTLE_ACQUISITION_KIND, in_season: { season: f.season },
    working_directory: workingDirectory, files: [{ filename: 'results.csv', sha256: csvSha }], [f.payloadMarker]: true,
  }, null, 2));
  const bundleSha = writeText(join(root, workingDirectory, 'observations.json'),
    JSON.stringify(rehearsalAflTablesBundle(label, manifestRel, manifestSha, record), null, 2));
  return { manifest: manifestSha, bundle: bundleSha };
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

type Tx = TransactionSql;
type Db = Sql | Tx;

function connect(dsn: string, searchPath?: string): Sql {
  return postgres(dsn, {
    // No prepared-statement cache: the target schema is dropped and re-created between worlds.
    max: 1, prepare: false, onnotice: () => {}, transform: { undefined: null },
    connection: { application_name: f.applicationName, ...(searchPath ? { search_path: searchPath } : {}) },
  });
}

function queryOf(sql: Sql): Query {
  return (text, params) => sql.unsafe(text, (params ?? []) as never[]).then((rows) => rows as unknown as Row[]);
}

async function assertDatabase(db: Db): Promise<void> {
  const [{ d }] = await db<{ d: string }[]>`SELECT current_database() AS d`;
  if (d !== f.database) throw new SourceDependencyRehearsalRefused(`Connected to '${d}', not '${f.database}'; nothing was written.`);
}

async function write(sql: Sql, body: (tx: Tx) => Promise<unknown>): Promise<void> {
  await sql.begin(async (tx) => { await assertDatabase(tx); await body(tx); });
}

/** Every fixture match_key the two worlds render (read-only: two club lookups per fixture). */
async function fixtureKeysOf(sql: Sql): Promise<string[]> {
  const keys: string[] = [];
  for (const spec of Object.values(REHEARSAL_FIXTURES)) {
    try {
      keys.push((await buildAflApiMatchIdentity(sql, await resolveAflApiSourceId(sql), rehearsalUnitBundle(spec))).matchKey);
    } catch { /* an unbuildable identity has written nothing under its key */ }
  }
  return keys;
}

export type SourceDependencyResidue = {
  matches: number; players: number; identities: number; batches: number; spine: number; versions: number;
  payloads: number; candidates: number; ledger: number; findings: number; playerStats: number; targetSchema: number;
};

async function readResidue(sql: Db, keys: readonly string[]): Promise<SourceDependencyResidue> {
  const [row] = await sql<SourceDependencyResidue[]>`
    SELECT
      (SELECT count(*)::int FROM matches WHERE starts_with(source_record_id, ${f.recordPrefix})
          OR starts_with(source_record_id, ${f.providerPrefix}) OR match_key = ANY (${[...keys]}::text[])) AS matches,
      (SELECT count(*)::int FROM players WHERE starts_with(slug, ${f.slugPrefix})) AS players,
      (SELECT count(*)::int FROM external_identities WHERE starts_with(external_id, ${f.playerProviderPrefix})
          OR starts_with(external_id, ${f.playerPathPrefix})) AS identities,
      (SELECT count(*)::int FROM import_batches WHERE strpos(coalesce(notes, ''), ${f.labelPrefix}) > 0) AS batches,
      (SELECT count(*)::int FROM staging.source_records WHERE starts_with(external_record_id, ${f.recordPrefix})
          OR starts_with(external_record_id, ${f.providerPrefix})) AS spine,
      (SELECT count(*)::int FROM staging.source_record_versions WHERE starts_with(external_record_id, ${f.recordPrefix})
          OR starts_with(external_record_id, ${f.providerPrefix})) AS versions,
      (SELECT count(*)::int FROM staging.source_payloads WHERE (raw_payload ->> ${f.payloadMarker}) IS NOT NULL
          OR strpos(raw_payload::text, ${f.providerPrefix}) > 0 OR strpos(raw_payload::text, ${f.playerProviderPrefix}) > 0) AS payloads,
      (SELECT count(*)::int FROM promotion_candidates WHERE starts_with(external_record_id, ${f.recordPrefix})
          OR starts_with(external_record_id, ${f.providerPrefix})) AS candidates,
      (SELECT count(*)::int FROM canonical_applications WHERE starts_with(external_record_id, ${f.recordPrefix})
          OR starts_with(external_record_id, ${f.providerPrefix})) AS ledger,
      (SELECT count(*)::int FROM data_issues WHERE strpos(coalesce(issue_key, ''), ${f.labelPrefix}) > 0
          OR strpos(coalesce(issue_key, ''), ${f.providerPrefix}) > 0) AS findings,
      (SELECT count(*)::int FROM player_match_stats WHERE starts_with(source_record_id, ${f.providerPrefix})
          OR starts_with(source_record_id, ${f.recordPrefix})) AS "playerStats",
      (SELECT count(*)::int FROM pg_namespace WHERE nspname = ${f.targetSchema}) AS "targetSchema"
  `;
  return row;
}

const residueTotal = (r: SourceDependencyResidue): number => Object.values(r).reduce((s, n) => s + n, 0);

/**
 * Delete every row that references one of `ids` in `referenced` through a single-column FK, in as
 * many passes as FK order needs. Such a row is fixture output by construction (it names a fixture
 * match, player or batch). A table that still refuses after every pass fails the whole teardown.
 */
async function deleteReferencing(tx: Tx, referenced: string, ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return;
  const refs = await tx<{ rel: string; col: string }[]>`
    SELECT c.conrelid::regclass::text AS rel, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f' AND c.confrelid = ${referenced}::regclass
       AND cardinality(c.conkey) = 1 AND c.conrelid <> c.confrelid
     ORDER BY 1, 2
  `;
  let pending = [...refs];
  for (let pass = 0; pass < 10 && pending.length > 0; pass += 1) {
    const failed: typeof pending = [];
    for (const r of pending) {
      try {
        await tx.savepoint((sp) => sp.unsafe(`DELETE FROM ${r.rel} WHERE ${quoteIdent(r.col)} = ANY ($1::bigint[])`, [[...ids]] as never[]));
      } catch {
        failed.push(r);
      }
    }
    if (failed.length === pending.length) break;
    pending = failed;
  }
  if (pending.length > 0) {
    throw new SourceDependencyRehearsalRefused(`teardown cannot clear ${pending.map((r) => `${r.rel}.${r.col}`).join(', ')} (references ${referenced})`);
  }
}

/** One world down: fixture matches, players and batches, everything citing them, and the target schema. */
async function teardownWorld(sql: Sql, keys: readonly string[]): Promise<void> {
  await write(sql, async (tx) => {
    const ids = async (text: string, params: unknown[]) => (await tx.unsafe(text, params as never[])).map((r) => Number(r.id));
    const matchIds = await ids(`SELECT id FROM matches WHERE starts_with(source_record_id, $1) OR starts_with(source_record_id, $2)
      OR match_key = ANY ($3::text[])`, [f.recordPrefix, f.providerPrefix, [...keys]]);
    const playerIds = await ids('SELECT id FROM players WHERE starts_with(slug, $1)', [f.slugPrefix]);
    const batchIds = await ids("SELECT id FROM import_batches WHERE strpos(coalesce(notes, ''), $1) > 0", [f.labelPrefix]);
    await tx`
      DELETE FROM data_issues
       WHERE strpos(coalesce(issue_key, ''), ${f.labelPrefix}) > 0 OR strpos(coalesce(issue_key, ''), ${f.providerPrefix}) > 0
          OR (entity_type = 'matches' AND entity_id = ANY (${matchIds}::bigint[]))
          OR (entity_type = 'players' AND entity_id = ANY (${playerIds}::bigint[]))
    `;
    await deleteReferencing(tx, 'public.matches', matchIds);
    await deleteReferencing(tx, 'public.players', playerIds);
    await deleteReferencing(tx, 'public.import_batches', batchIds);
    await tx`DELETE FROM matches WHERE id = ANY (${matchIds}::int[])`;
    await tx`DELETE FROM players WHERE id = ANY (${playerIds}::int[])`;
    await tx`DELETE FROM import_batches WHERE id = ANY (${batchIds}::bigint[])`;
    await tx`
      DELETE FROM staging.source_payloads p
       WHERE ((p.raw_payload ->> ${f.payloadMarker}) IS NOT NULL
              OR strpos(p.raw_payload::text, ${f.providerPrefix}) > 0 OR strpos(p.raw_payload::text, ${f.playerProviderPrefix}) > 0)
         AND NOT EXISTS (SELECT 1 FROM staging.source_record_versions v
                          WHERE v.source_id = p.source_id AND v.family = p.family AND v.payload_hash = p.payload_hash)
    `;
    await tx.unsafe(`DROP SCHEMA IF EXISTS ${f.targetSchema} CASCADE`);
  });
}

/** The 2026 derived state, as one hash (timestamps omitted). */
async function derivedHash(db: Db): Promise<string> {
  const [{ h }] = await db<{ h: string }[]>`
    SELECT md5(
      coalesce((SELECT string_agg(x, '|' ORDER BY x) FROM (SELECT (to_jsonb(s) - 'updated_at' - 'created_at')::text AS x FROM seasons s WHERE s.year = ${f.season}) a), '')
      || '#' || coalesce((SELECT string_agg(x, '|' ORDER BY x) FROM (SELECT (to_jsonb(c) - 'updated_at' - 'created_at')::text AS x FROM club_seasons c WHERE c.season = ${f.season}) b), '')
      || '#' || coalesce((SELECT string_agg(x, '|' ORDER BY x) FROM (SELECT (to_jsonb(p) - 'updated_at' - 'created_at')::text AS x FROM player_season_stats p WHERE p.season = ${f.season}) c), '')
    ) AS h
  `;
  return h;
}

async function recompute(tx: Tx): Promise<void> {
  await recomputeSeasonMetadata(tx, f.season);
  await recomputeClubSeasons(tx, f.season);
  await recomputeSeasonBrownlowStatus(tx, f.season);
}

/** The 2026 season as the run found it, before any write. */
export type SeasonAsFound = { matches: number; clubSeasons: number; playerSeasonStats: number; row: Record<string, unknown> };

async function readSeasonAsFound(db: Db): Promise<SeasonAsFound> {
  const [row] = await db<SeasonAsFound[]>`
    SELECT (SELECT count(*)::int FROM matches WHERE season = ${f.season}) AS matches,
           (SELECT count(*)::int FROM club_seasons WHERE season = ${f.season}) AS "clubSeasons",
           (SELECT count(*)::int FROM player_season_stats WHERE season = ${f.season}) AS "playerSeasonStats",
           (SELECT to_jsonb(s) FROM seasons s WHERE s.year = ${f.season}) AS row
  `;
  return row;
}

/**
 * The 2026 derived state back to the baseline after a teardown. A season that still holds matches is
 * recomputed by the real `recompute*()` functions. An EMPTY season (code_test_db holds no 2026 match)
 * cannot be: `recomputeClubSeasons()` refuses to rebuild from nothing, by design, and
 * `recomputeSeasonMetadata()` would turn the row's NULL counts into 0. So the run's as-found row is
 * restored verbatim and the fixture's derived rows removed — allowed ONLY when the run found the season
 * with no match, no club_seasons row and no player_season_stats row, so every such row is fixture output.
 */
async function restoreDerived(tx: Tx, asFound: SeasonAsFound | null): Promise<void> {
  const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM matches WHERE season = ${f.season}`;
  if (n > 0) {
    await recompute(tx);
    return;
  }
  if (asFound === null) {
    throw new SourceDependencyRehearsalRefused(`season ${f.season} holds no match and its as-found row is not known here; restore it from the run's evidence header`);
  }
  if (asFound.matches !== 0 || asFound.clubSeasons !== 0 || asFound.playerSeasonStats !== 0) {
    throw new SourceDependencyRehearsalRefused(`season ${f.season} is empty now but was not when the run began (${JSON.stringify({ ...asFound, row: undefined })}); refusing to guess its derived rows`);
  }
  await tx`DELETE FROM club_seasons WHERE season = ${f.season}`;
  const [{ pss }] = await tx<{ pss: number }[]>`SELECT count(*)::int AS pss FROM player_season_stats WHERE season = ${f.season}`;
  if (pss !== 0) throw new SourceDependencyRehearsalRefused(`${pss} player_season_stats row(s) for ${f.season} survive the teardown and cite no fixture player`);
  await tx`
    UPDATE seasons s
       SET (first_match_date, last_match_date, match_count, club_count, status, data_through_date, last_loaded_round, completed_at)
         = (r.first_match_date, r.last_match_date, r.match_count, r.club_count, r.status, r.data_through_date, r.last_loaded_round, r.completed_at)
      FROM jsonb_populate_record(NULL::seasons, ${JSON.stringify(asFound.row)}::text::jsonb) r
     WHERE s.year = ${f.season}
  `;
}

class Rollback extends Error {}

/** The derived state a recompute produces with no fixture present — computed, read, rolled back. */
async function recomputedBaseline(sql: Sql): Promise<string> {
  let hash = '';
  try {
    await sql.begin(async (tx) => { await assertDatabase(tx); await recompute(tx); hash = await derivedHash(tx); throw new Rollback(); });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  return hash;
}

async function historicalHash(db: Db): Promise<{ matches: string; n: number; playerRows: number }> {
  const [row] = await db<{ matches: string; n: number; playerRows: number }[]>`
    SELECT (SELECT md5(coalesce(string_agg(to_jsonb(m)::text, '|' ORDER BY m.id), '')) FROM matches m WHERE m.season < ${f.season}) AS matches,
           (SELECT count(*)::int FROM matches m WHERE m.season < ${f.season}) AS n,
           (SELECT count(*)::int FROM player_match_stats p JOIN matches m ON m.id = p.match_id WHERE m.season < ${f.season}) AS "playerRows"
  `;
  return row;
}

type SwitchRow = { present: boolean; value: string | null; updatedAt: string | null; updatedBy: number | null };

async function readSwitch(db: Db): Promise<SwitchRow> {
  const [row] = await db<{ value: string; updatedAt: string; updatedBy: number | null }[]>`
    SELECT value::text AS value, updated_at::text AS "updatedAt", updated_by AS "updatedBy"
      FROM site_settings WHERE key = ${SETTING_KEYS.aflApiCurrentSeasonEnabled}
  `;
  return row ? { present: true, value: row.value, updatedAt: row.updatedAt, updatedBy: row.updatedBy } : { present: false, value: null, updatedAt: null, updatedBy: null };
}

/** Written ONLY by this rehearsal, on code_test_db (the preparation CLI never writes it). */
async function writeSwitch(sql: Sql, enabled: boolean): Promise<void> {
  await write(sql, (tx) => tx`
    INSERT INTO site_settings (key, value) VALUES (${SETTING_KEYS.aflApiCurrentSeasonEnabled}, ${enabled ? 'true' : 'false'}::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `);
}

async function restoreSwitch(sql: Sql, prior: SwitchRow): Promise<void> {
  await write(sql, (tx) => (prior.present
    ? tx`UPDATE site_settings SET value = ${prior.value}::jsonb, updated_at = ${prior.updatedAt}::timestamptz, updated_by = ${prior.updatedBy}
          WHERE key = ${SETTING_KEYS.aflApiCurrentSeasonEnabled}`
    : tx`DELETE FROM site_settings WHERE key = ${SETTING_KEYS.aflApiCurrentSeasonEnabled}`));
}

const sameSwitch = (a: SwitchRow, b: SwitchRow): boolean => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// Preflight: identity, write-capability and isolation, before any write
// ---------------------------------------------------------------------------

type FixtureIdentity = {
  spec: RehearsalFixtureSpec; source: AflApiSettleUnitSource; unit: AflApiMatchBundle;
  identity: Awaited<ReturnType<typeof buildAflApiMatchIdentity>>;
};

async function preflight(owner: Sql): Promise<{ fixtures: Record<'main' | 'n', FixtureIdentity>; notes: string[] }> {
  const problems: string[] = [];
  const [id] = await owner<{ database: string; user: string; readOnly: string; pg: string }[]>`
    SELECT current_database() AS database, current_user AS "user",
           current_setting('transaction_read_only') AS "readOnly", current_setting('server_version') AS pg
  `;
  if (id.database !== f.database) throw new SourceDependencyRehearsalRefused(`Preflight refused: connected to '${id.database}', not '${f.database}'.`);
  if (id.readOnly !== 'off') problems.push(`transaction_read_only = ${id.readOnly}`);
  const [iso] = await owner<{ others: number; season: number; hist: number; sources: number }[]>`
    SELECT (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()) AS others,
           (SELECT count(*)::int FROM seasons WHERE year = ${f.season}) AS season,
           (SELECT count(*)::int FROM matches m JOIN sources s ON s.id = m.source_id
             WHERE m.season = ${f.historicalSeason} AND s.key = 'afltables') AS hist,
           (SELECT count(*)::int FROM sources WHERE key IN ('afltables', 'afl_api')) AS sources
  `;
  if (iso.others !== 0) problems.push(`${iso.others} other session(s) on ${f.database}`);
  if (iso.season !== 1) problems.push(`seasons has no ${f.season} row`);
  if (iso.sources !== 2) problems.push("sources lacks 'afltables' or 'afl_api'");
  const owned = await owner<{ owner_source_key: string | null; matches: number }[]>`
    SELECT s.key AS owner_source_key, count(*)::int AS matches FROM matches m LEFT JOIN sources s ON s.id = m.source_id
     WHERE m.season = ${f.season} GROUP BY s.key
  `;
  problems.push(...preexistingSeasonOwnershipProblems(f.season, owned).map((p) => `before any fixture: ${p}`));
  const residue = await readResidue(owner, []);
  if (residueTotal(residue) !== 0) problems.push(`fixture residue already present ${JSON.stringify(residue)}: run teardown first`);
  const sourceId = await resolveAflApiSourceId(owner);
  const fixtures = {} as Record<'main' | 'n', FixtureIdentity>;
  for (const [name, spec] of Object.entries(REHEARSAL_FIXTURES) as ['main' | 'n', RehearsalFixtureSpec][]) {
    const unit = rehearsalUnitBundle(spec);
    const identity = await buildAflApiMatchIdentity(owner, sourceId, unit);
    fixtures[name] = { spec, source: rehearsalUnitSource(spec), unit, identity };
    const [{ exact, venue }] = await owner<{ exact: number; venue: number }[]>`
      SELECT (SELECT count(*)::int FROM matches WHERE match_key = ${identity.matchKey}) AS exact,
             (SELECT count(*)::int FROM venues WHERE legacy_name = ${unit.match.venueLegacyName}) AS venue
    `;
    if (exact !== 0) problems.push(`${spec.world}: a match already holds the fixture key ${identity.matchKey}`);
    if (venue !== 1) problems.push(`${spec.world}: venue '${String(unit.match.venueLegacyName)}' does not map to exactly one venues row`);
    const plausible = await findPlausibleCanonicalFixtures(owner, identity);
    if (plausible.length > 0) problems.push(`${spec.world}: ${identity.matchKey} is plausibly matches.id ${plausible.map((p) => p.id).join(', ')} (F030)`);
  }
  if (problems.length > 0) throw new SourceDependencyRehearsalRefused(`Preflight refused; nothing was written: ${problems.join('; ')}.`);
  return {
    fixtures,
    notes: [
      `current_database=${id.database} current_user=${id.user} transaction_read_only=${id.readOnly} server=${id.pg}`,
      `isolation PASS: no other session, empty namespace, season ${f.season} present and AFL Tables-owned only, fixture venues map, no plausible fixture`,
      `${iso.hist} afltables-owned ${f.historicalSeason} match(es) available for H`,
    ],
  };
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

type Check = { caseId: RehearsalCaseId; label: string; ok: boolean; detail: string };

class Checks {
  readonly all: Check[] = [];
  readonly notes = new Map<RehearsalCaseId, string[]>();
  that(caseId: RehearsalCaseId, label: string, ok: boolean, detail = ''): boolean {
    this.all.push({ caseId, label, ok, detail: redact(detail) });
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${caseId} ${label}${detail ? ` — ${redact(detail)}` : ''}`);
    return ok;
  }
  note(caseId: RehearsalCaseId, text: string): void {
    if (!this.notes.has(caseId)) this.notes.set(caseId, []);
    this.notes.get(caseId)!.push(redact(text));
    console.log(`  ${caseId} ${redact(text)}`);
  }
  /** Run one step of a case; an exception is that case's FAIL, never the run's end. */
  async step(caseId: RehearsalCaseId, label: string, body: () => Promise<void>): Promise<void> {
    try {
      await body();
    } catch (error) {
      this.that(caseId, `${label}: raised`, false, error instanceof Error ? error.message : String(error));
    }
  }
}

const message = (error: unknown): string => redact(error instanceof Error ? error.message : String(error));

async function refusalOf(body: () => unknown): Promise<string | null> {
  try {
    await body();
    return null;
  } catch (error) {
    return message(error);
  }
}

// ---------------------------------------------------------------------------
// The target schema
// ---------------------------------------------------------------------------

const t = f.targetSchema;

const TARGET_DDL = `
  CREATE SCHEMA ${t};
  CREATE TABLE ${t}.sources (id smallint PRIMARY KEY, key text NOT NULL UNIQUE);
  -- id deliberately NOT unique: case G builds a target anchor whose id names two identities.
  CREATE TABLE ${t}.matches (id bigint NOT NULL, match_key text NOT NULL, season integer NOT NULL,
                             source_id smallint REFERENCES ${t}.sources (id));
  CREATE TABLE ${t}.brownlow_vote_entry_state (match_id bigint PRIMARY KEY);
  CREATE TABLE ${t}.data_edits (id bigint PRIMARY KEY, table_name text NOT NULL, row_id bigint);
  CREATE TABLE ${t}.data_overrides (id bigint PRIMARY KEY, entity_type text NOT NULL, entity_key text NOT NULL,
                                    is_active boolean NOT NULL DEFAULT true);
  CREATE SEQUENCE ${t}.ids START WITH ${f.targetIdOffset + 1};
  INSERT INTO ${t}.sources (id, key) VALUES (1, 'afltables'), (2, 'afl_api');
`;

type TargetOwner = 'afltables' | 'afl_api' | null;

async function targetInsert(sql: Sql, text: string, params: unknown[]): Promise<number> {
  let id = 0;
  await write(sql, async (tx) => { id = Number((await tx.unsafe(text, params as never[]))[0].id); });
  return id;
}

const addTargetMatch = (sql: Sql, key: string, owner: TargetOwner, id?: number): Promise<number> => targetInsert(sql, `
  INSERT INTO ${t}.matches (id, match_key, season, source_id)
  VALUES (coalesce($1::bigint, nextval('${t}.ids')), $2, split_part($2, '|', 1)::int, (SELECT id FROM ${t}.sources WHERE key = $3))
  RETURNING id`, [id ?? null, key, owner]);
const addF1 = (sql: Sql, matchId: number): Promise<number> => targetInsert(sql,
  `INSERT INTO ${t}.brownlow_vote_entry_state (match_id) VALUES ($1) RETURNING match_id AS id`, [matchId]);
const addF2 = (sql: Sql, entityType: 'matches' | 'match_coaches', entityKey: string): Promise<number> => targetInsert(sql,
  `INSERT INTO ${t}.data_overrides (id, entity_type, entity_key) VALUES (nextval('${t}.ids'), $1, $2) RETURNING id`, [entityType, entityKey]);
const addF3 = (sql: Sql, matchId: number): Promise<number> => targetInsert(sql,
  `INSERT INTO ${t}.data_edits (id, table_name, row_id) VALUES (nextval('${t}.ids'), 'matches', $1) RETURNING id`, [matchId]);

async function removeTarget(sql: Sql, rows: { table: 'matches' | 'brownlow_vote_entry_state' | 'data_edits' | 'data_overrides'; id: number }[]): Promise<void> {
  await write(sql, async (tx) => {
    for (const r of rows) {
      const col = r.table === 'brownlow_vote_entry_state' ? 'match_id' : 'id';
      await tx.unsafe(`DELETE FROM ${t}.${r.table} WHERE ${col} = $1`, [r.id] as never[]);
    }
  });
}

// ---------------------------------------------------------------------------
// Manifests and judgements through the real checker
// ---------------------------------------------------------------------------

type Ctx = {
  owner: Sql; importSql: Sql; target: Sql; sourceQ: Query; targetQ: Query;
  ownerDsn: string; importDsn: string; out: string; root: string; checks: Checks; keys: string[]; season: SeasonAsFound;
};

type Captured = { name: string; file: string; bytes: string; sha: string; manifest: DependencyManifest; report: Report };

/** `--phase dependencies` exactly: the real capture, the real no-clobber write; then the file re-read and parsed. */
async function capture(ctx: Ctx, name: string, proof?: SourceDependencyProof): Promise<Captured> {
  const file = join(ctx.out, 'manifests', `${name}.json`);
  const report = new Report();
  await runDependenciesPhase(ctx.targetQ, checkerOptions({ database: f.targetLabel, dependenciesOut: file }), report, undefined, proof);
  if (!existsSync(file)) {
    throw new SourceDependencyRehearsalRefused(`manifest ${name} was not written: ${report.results.filter((r) => r.verdict === 'FAIL').map((r) => r.lines.join(' ')).join(' | ')}`);
  }
  const bytes = readFileSync(file, 'utf8');
  const sha = sha256Hex(bytes);
  return { name, file, bytes, sha, manifest: parseDependencyManifest({ bytes, expectedFileSha256: sha, expectedEnvironment: 'prod' }), report };
}

/** A binding for a gate run before any preparation exists. Its record gate FAILs, by design; only the judgement is asserted. */
const NO_PREPARATION: PreparationBinding = {
  record_sha256: '0'.repeat(64), prepared_at: '(none)', season: f.season, source_database: f.sourceLabel,
  batches: { afltables: null, afl_api: null },
  afltables: { label: '(none)', manifest_sha256: '0'.repeat(64), observations_sha256: '0'.repeat(64) },
  afl_api: { label: '(none)', manifest_sha256: '0'.repeat(64) },
  afltables_closure: {
    initial_apply: { inserted: 0, updated: 0, unresolved_identity_match: 0 },
    closure_dry_run: { inserted: 0, updated: 0, unresolved_identity_match: 0 },
  },
};

type RecordFile = { path: string; sha: string };
type Judged = { report: Report; judgement: SourceDependencyJudgement; opts: Options | null; inputs: Parameters<typeof gateSourceDependencies>[1] };

/** `--phase source`'s gate: with the record's two operator files, or (before preparation) the placeholder binding. */
async function judge(ctx: Ctx, cap: Captured, record: RecordFile | null, proofOut?: string): Promise<Judged> {
  const report = new Report();
  if (record === null) {
    const inputs = { manifest: cap.manifest, manifestFileSha256: cap.sha, preparation: NO_PREPARATION };
    return { report, judgement: (await gateSourceDependencies(ctx.sourceQ, inputs, report)).judgement, opts: null, inputs };
  }
  const opts = checkerOptions({
    database: f.sourceLabel, targetDependencies: cap.file, targetDependenciesSha256: cap.sha,
    preparationRecord: record.path, preparationRecordSha256: record.sha, sourceDependencyProofOut: proofOut,
  });
  const inputs = readSourceDependencyInputs(opts);
  const gate = await gateSourceDependencies(ctx.sourceQ, inputs, report);
  if (proofOut) publishSourceDependencyProof(opts, inputs, gate, report);
  return { report, judgement: gate.judgement, opts, inputs };
}

const familyOf = (j: SourceDependencyJudgement, id: DependencyFamilyId) => j.families.find((x) => x.family === id)!;
const refusalFor = (j: SourceDependencyJudgement, id: DependencyFamilyId, targetRow: string) =>
  familyOf(j, id).refusals.find((r) => r.target_row === targetRow);
const verdictOf = (report: Report, fragment: string): string => report.results.find((r) => r.gate.includes(fragment))?.verdict ?? 'ABSENT';
const refusalsText = (j: SourceDependencyJudgement): string =>
  j.families.flatMap((x) => x.refusals.map((r) => `${x.family} ${r.target_row}: ${r.reason}${r.match_key ? ` ${r.match_key}` : ''}`)).join(' | ') || 'none';

// ---------------------------------------------------------------------------
// World setup
// ---------------------------------------------------------------------------

type World = {
  fx: FixtureIdentity; labels: { afltables: string; aflApi: string }; hashes: RehearsalSnapshotHashes;
  key: string; targetId: number;
};

/** Namespace players and their links (afl_api provider id + an AFL Tables profile path), as the bridge loader writes them. */
async function seedPlayers(sql: Sql, world: string): Promise<void> {
  await write(sql, async (tx) => {
    for (const p of REHEARSAL_PLAYERS) {
      const display = `Issue252 Rehearsal ${world} ${p.n}`;
      const [{ id }] = await tx<{ id: number }[]>`
        INSERT INTO players (display_name, sort_name, search_name, slug, given_name, surname)
        VALUES (${display}, ${`Rehearsal ${world} ${p.n}, Issue252`}, ${display.toLowerCase()}, ${`${f.slugPrefix}${world}-${p.n}`},
                'Issue252', ${`Rehearsal ${world} ${p.n}`})
        RETURNING id
      `;
      await tx`
        INSERT INTO external_identities (source_id, external_id, status, candidate_count, match_method, player_id)
        VALUES ((SELECT id FROM sources WHERE key = 'afl_api'), ${p.to}, 'unique', 1, 'afl_api_stat_vector_bootstrap', ${id})
      `;
      await tx`
        INSERT INTO external_identities (source_id, external_id, status, candidate_count, match_method, player_id)
        VALUES ((SELECT id FROM sources WHERE key = 'afltables'), ${`${f.playerPathPrefix}${world}_${p.n}.html`}, 'unique', 1,
                'afltables_profile_url', ${id})
      `;
    }
  });
}

async function setupWorld(ctx: Ctx, fx: FixtureIdentity): Promise<World> {
  const labels = rehearsalLabels(fx.spec.world);
  const record = rehearsalAflTablesRecord(fx.spec.world, fx.unit, fx.identity, fx.source, rehearsalReferences().registry);
  const at = writeAflTablesSnapshot(ctx.root, labels.afltables, record);
  const hashes = { afltablesManifest: at.manifest, afltablesBundle: at.bundle, aflApiManifest: writeAflApiSnapshot(ctx.root, labels.aflApi, fx.source, fx.spec.providerId) };
  await seedPlayers(ctx.owner, fx.spec.world);
  await write(ctx.owner, (tx) => tx.unsafe(TARGET_DDL));
  const key = fx.identity.matchKey;
  const targetId = await addTargetMatch(ctx.owner, key, 'afltables');
  return { fx, labels, hashes, key, targetId };
}

async function endWorld(ctx: Ctx, baseline: string, caseId: RehearsalCaseId): Promise<void> {
  await teardownWorld(ctx.owner, ctx.keys);
  await write(ctx.owner, (tx) => restoreDerived(tx, ctx.season));
  const residue = await readResidue(ctx.owner, ctx.keys);
  ctx.checks.that(caseId, 'world torn down: zero namespace rows, target schema dropped', residueTotal(residue) === 0, JSON.stringify(residue));
  const derived = await derivedHash(ctx.owner);
  ctx.checks.that(caseId, `world torn down: ${f.season} derived state equals the baseline`, derived === baseline, `${derived} vs ${baseline}`);
}

type Spies = { calls: string[]; deps: Pick<PrepareDeps, 'settleAfltables' | 'settleAflApi'> };

/** The REAL settles, counted: a guard case asserts that neither ran. */
function spies(): Spies {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      settleAfltables: (argv, deps) => { calls.push(`afltables ${argv.join(' ')}`); return runSettleCli(argv, deps); },
      settleAflApi: (argv, deps) => { calls.push(`afl_api ${argv.join(' ')}`); return runAflApiSettleCli(argv, deps); },
    },
  };
}

const presentedProve: NonNullable<PrepareDeps['prove']> = async (sql, env) => presentAsPreparedSource(await proveAflApiIngestionPreflight(sql, env));

async function prepare(
  ctx: Ctx, w: World, mode: 'apply' | 'dry-run' | 'validate-only', recordOut?: string, over: Partial<PrepareDeps> = {},
  root = ctx.root,
): Promise<{ outcome: PrepareOutcome; lines: string[] }> {
  const lines: string[] = [];
  const outcome = await runPreparePromotionSource(prepareArgv(w.labels, w.hashes, mode, recordOut), {
    projectRoot: root, sql: ctx.importSql, env: { DATABASE_URL: ctx.ownerDsn, AFLDB_IMPORT_DATABASE_URL: ctx.importDsn },
    log: (line) => lines.push(line), prove: presentedProve, ...over,
  });
  return { outcome, lines };
}

async function readRecord(path: string): Promise<{ file: RecordFile; binding: PreparationBinding | null; raw: Record<string, unknown>; problem: string | null }> {
  const bytes = readFileSync(path, 'utf8');
  const file = { path, sha: sha256Hex(bytes) };
  const raw = JSON.parse(bytes) as Record<string, unknown>;
  try {
    return { file, raw, problem: null, binding: parsePreparationRecord({ bytes, expectedFileSha256: file.sha, expectedSourceDatabase: f.sourceLabel }) };
  } catch (error) {
    return { file, raw, problem: message(error), binding: null };
  }
}

function counterOf(raw: Record<string, unknown>, source: 'afltables' | 'afl_api', key: string): unknown {
  return ((raw.counters as Record<string, Record<string, unknown> | null> | undefined)?.[source] ?? {})[key];
}

async function sourceOwnerOf(ctx: Ctx, key: string): Promise<string[]> {
  return (await ctx.owner<{ k: string | null }[]>`
    SELECT s.key AS k FROM matches m LEFT JOIN sources s ON s.id = m.source_id WHERE m.match_key = ${key}
  `).map((r) => String(r.k));
}

// ---------------------------------------------------------------------------
// World "main": T, J, C, V, A, B, D, E, H, I, M, P, S, K, V, Q, R, F, G, O
// ---------------------------------------------------------------------------

async function worldMain(ctx: Ctx, fx: FixtureIdentity, baseline: string): Promise<void> {
  const c = ctx.checks;
  console.log('\n=== world main');
  try {
    const w = await setupWorld(ctx, fx);
    const K = w.key;
    c.note('A', `fixture ${fx.spec.providerId} renders ${K}; labels ${w.labels.afltables} / ${w.labels.aflApi}; hashes ${JSON.stringify(w.hashes)}`);
    const f1 = await addF1(ctx.owner, w.targetId);
    const f2m = await addF2(ctx.owner, 'matches', K);
    const f2c = await addF2(ctx.owner, 'match_coaches', `${K}|hawthorn`);
    const f3 = await addF3(ctx.owner, w.targetId);
    const rows = {
      f1: `brownlow_vote_entry_state:match_id=${f1}`, f2m: `data_overrides:id=${f2m}`,
      f2c: `data_overrides:id=${f2c}`, f3: `data_edits:id=${f3}`,
    };
    const [hist] = await ctx.owner<{ key: string }[]>`
      SELECT m.match_key AS key FROM matches m JOIN sources s ON s.id = m.source_id
       WHERE m.season = ${f.historicalSeason} AND s.key = 'afltables' ORDER BY m.id LIMIT 1
    `;
    const hRow = hist ? `brownlow_vote_entry_state:match_id=${await addF1(ctx.owner, await addTargetMatch(ctx.owner, hist.key, 'afltables'))}` : null;
    if (!hRow) c.that('H', `a ${f.historicalSeason} afltables-owned source match exists`, false, 'none in code_test_db');

    await caseT(ctx, w);
    await caseJOffline(ctx, w);

    // C, and H before: the gate before any preparation.
    let pre: Captured | null = null;
    await c.step('C', 'pre-preparation gate', async () => {
      pre = await capture(ctx, 'main-pre');
      const j = (await judge(ctx, pre, null)).judgement;
      for (const [family, row] of [['F1', rows.f1], ['F2', rows.f2m], ['F2', rows.f2c], ['F3', rows.f3]] as const) {
        const r = refusalFor(j, family, row);
        c.that('C', `${family} ${row} refuses identity_absent_in_candidate naming ${K}`, r?.reason === 'identity_absent_in_candidate' && r.match_key === K,
          JSON.stringify(r ?? null));
      }
      c.that('C', 'the gate does not PASS before preparation', !j.pass, refusalsText(j));
      if (hRow) c.that('H', 'before preparation: the 2025 dependency resolves with owner parity', !refusalFor(j, 'F1', hRow), hRow);
    });
    await caseJManifest(ctx, pre);

    // V: the standalone --dry-run on the still-fresh source, before A's first apply.
    await caseVPreview(ctx, w);

    // A: preparation, the record, the gate with it, and the proof.
    const hist0 = await historicalHash(ctx.owner);
    const switch0 = await readSwitch(ctx.owner);
    const recordPath = join(ctx.out, 'preparation', 'main-1.record.json');
    let record: Awaited<ReturnType<typeof readRecord>> | null = null;
    await c.step('A', 'prepare --apply', async () => {
      const fresh = await ctx.owner<{ n: number }[]>`SELECT count(*)::int AS n FROM matches WHERE match_key = ${K}`;
      c.that('A', 'fresh current-season source: the fixture match does not exist before the first apply', fresh[0]?.n === 0, `rows ${String(fresh[0]?.n)}`);
      const { outcome, lines } = await prepare(ctx, w, 'apply', recordPath);
      c.note('A', lines.filter((l) => /PASS|written|proved|verified|provisional/.test(l)).join(' / '));
      c.that('A', 'afltables initial apply, afltables closure dry-run, afl_api dry-run, afl_api apply: every post-condition PASS',
        outcome.steps.map((s) => `${s.source}:${s.mode}`).join(',') === 'afltables:apply,afltables:dry-run,afl_api:dry-run,afl_api:apply',
        outcome.steps.map((s) => `${s.source}:${s.mode}:${s.completeness}`).join(', '));
      // Q-252-10: the measured transient on the first apply, then the closure proof straight after it.
      const first = outcome.steps[0]?.counters ?? {};
      const others = PREPARATION_ZERO_COUNTERS.afltables.filter((k) => k !== AFLTABLES_FIRST_APPLY_TOLERATED_COUNTER);
      c.that('A', 'first AFL Tables apply committed, complete, with the transient unresolvedIdentityMatch > 0 and every other zero counter 0',
        outcome.steps[0]?.applied === true && outcome.steps[0]?.completeness === 'complete' && Number(first.unresolvedIdentityMatch) > 0
          && others.every((k) => first[k] === 0),
        `unresolvedIdentityMatch ${String(first.unresolvedIdentityMatch)}, inserted ${String(first.canonicalRowsInserted)}, updated ${String(first.canonicalRowsUpdated)}, `
          + `others ${JSON.stringify(Object.fromEntries(others.map((k) => [k, first[k]])))}`);
      const closure = outcome.steps[1];
      const cc = closure?.counters ?? {};
      c.that('A', 'same-label AFL Tables closure dry-run: rolled back, complete, unresolvedIdentityMatch 0, inserted 0, updated 0, every zero counter 0',
        closure?.source === 'afltables' && closure.mode === 'dry-run' && closure.applied === false && closure.completeness === 'complete'
          && cc.unresolvedIdentityMatch === 0 && cc.canonicalRowsInserted === 0 && cc.canonicalRowsUpdated === 0
          && cc.canonicalApplicationsLogged === 0 && PREPARATION_ZERO_COUNTERS.afltables.every((k) => cc[k] === 0),
        `unresolvedIdentityMatch ${String(cc.unresolvedIdentityMatch)}, inserted ${String(cc.canonicalRowsInserted)}, updated ${String(cc.canonicalRowsUpdated)}, `
          + `applicationsLogged ${String(cc.canonicalApplicationsLogged)}, zero list ${JSON.stringify(Object.fromEntries(PREPARATION_ZERO_COUNTERS.afltables.map((k) => [k, cc[k]])))}`);
      c.that('A', "the AFL API dry run's rollbackReason 'dry_run' was accepted as its expected outcome",
        outcome.steps[2]?.rollbackReason === 'dry_run' && outcome.steps[2]?.applied === false, String(outcome.steps[2]?.rollbackReason));
      const m = outcome.steps[3]?.counters ?? {};
      c.that('M', 'the AFL API apply corroborated the AFL Tables-owned match, with no foreign-owned collision',
        Number(m.corroboratedForeignOwned) >= 1 && m.foreignOwnedCollision === 0, `corroboratedForeignOwned ${String(m.corroboratedForeignOwned)}, foreignOwnedCollision ${String(m.foreignOwnedCollision)}`);
    });
    c.that('T', 'the preparation CLI did not write the switch (--apply)', sameSwitch(switch0, await readSwitch(ctx.owner)));
    if (existsSync(recordPath)) {
      record = await readRecord(recordPath);
      c.that('A', 'record written (no clobber) and parses for the prepared source', record.binding !== null, record.problem ?? record.file.sha);
      const inputs = (record.raw.inputs ?? []) as Record<string, unknown>[];
      c.that('A', 'the record binds the exact retained bytes', inputs[0]?.manifest_sha256 === w.hashes.afltablesManifest
        && inputs[0]?.observations_sha256 === w.hashes.afltablesBundle && inputs[1]?.manifest_sha256 === w.hashes.aflApiManifest, JSON.stringify(inputs));
      c.that('A', 'the record names both import batches as integers', record.binding?.batches.afltables !== null && record.binding?.batches.afl_api !== null
        && record.binding !== null, JSON.stringify(record.raw.batches));
      const ri = record.raw.afltables_initial_apply as Record<string, unknown> | undefined;
      const rc = record.raw.afltables_closure_dry_run as Record<string, unknown> | undefined;
      c.that('A', 'the record carries the initial apply and the closure dry run as two separate results', !!ri && !!rc
        && ri.mode === 'apply' && rc.mode === 'dry-run' && Number(ri.unresolved_identity_match) > 0 && rc.unresolved_identity_match === 0
        && rc.inserted === 0 && rc.updated === 0 && rc.batch_id === null && String(ri.batch_id) === String(record.binding?.batches.afltables),
        `initial ${JSON.stringify({ batch: ri?.batch_id, inserted: ri?.inserted, updated: ri?.updated, uim: ri?.unresolved_identity_match })}; `
          + `closure ${JSON.stringify({ batch: rc?.batch_id, inserted: rc?.inserted, updated: rc?.updated, uim: rc?.unresolved_identity_match })}`);
    } else {
      c.that('A', 'record written', false, `${recordPath} absent`);
    }
    const owners = await sourceOwnerOf(ctx, K);
    c.that('M', 'the source match is afltables-owned after AFL Tables-first then AFL API', owners.length === 1 && owners[0] === 'afltables', owners.join(','));
    const hist1 = await historicalHash(ctx.owner);
    c.that('H', 'preparation touched no pre-2026 match (hash, count, player rows)', JSON.stringify(hist0) === JSON.stringify(hist1), `${hist1.matches} n=${hist1.n} rows=${hist1.playerRows}`);

    // Manifest A, the gate with the record, the proof (A, B, D, E, H, I, M).
    let capA: Captured | null = null;
    let proof: SourceDependencyProof | null = null;
    let firstCounts = '';
    await c.step('A', 'manifest A + source gate + proof', async () => {
      capA = await capture(ctx, 'main-A');
      if (!record?.binding) throw new SourceDependencyRehearsalRefused('no parseable preparation record');
      const proofPath = join(ctx.out, 'proofs', 'main-A.proof.json');
      const { report, judgement: j } = await judge(ctx, capA, record.file, proofPath);
      firstCounts = JSON.stringify(j.families.map(familyOutcomeCounts));
      c.that('A', 'preparation record belongs to this source (batches present)', verdictOf(report, 'preparation record belongs') === 'PASS');
      c.that('A', 'source dependency proof written and parses as PASS', existsSync(proofPath), proofPath);
      if (existsSync(proofPath)) {
        const bytes = readFileSync(proofPath, 'utf8');
        proof = parseSourceDependencyProof({ bytes, expectedFileSha256: sha256Hex(bytes), expectedEnvironment: 'prod' });
        c.note('A', `proof sha256 ${sha256Hex(bytes)} binds ${proof.dependency_set_sha256} and record ${proof.preparation.record_sha256}`);
      }
      const ok = (id: DependencyFamilyId, row: string) => !refusalFor(j, id, row);
      c.that('B', `F1 ${rows.f1} resolves with owner parity`, ok('F1', rows.f1) && verdictOf(report, 'source dependency gate F1') === 'PASS',
        JSON.stringify(familyOutcomeCounts(familyOf(j, 'F1'))));
      c.that('D', `F2 'matches' ${rows.f2m} and 'match_coaches' ${rows.f2c} resolve`, ok('F2', rows.f2m) && ok('F2', rows.f2c)
        && familyOf(j, 'F2').ownershipMatched === 2, JSON.stringify(familyOutcomeCounts(familyOf(j, 'F2'))));
      c.that('E', `F3 ${rows.f3} resolves`, ok('F3', rows.f3) && familyOf(j, 'F3').ownershipMatched === 1,
        JSON.stringify(familyOutcomeCounts(familyOf(j, 'F3'))));
      if (hRow) c.that('H', 'after preparation: the 2025 dependency still resolves with owner parity', ok('F1', hRow), hRow);
      c.that('M', 'the whole gate PASSes on the afltables-owned target dependency', j.pass, refusalsText(j));
      const srcIds = (await ctx.owner<{ id: number }[]>`SELECT id::int AS id FROM matches WHERE match_key = ${K}`).map((r) => r.id);
      const tgtIds = (await ctx.target<{ id: number }[]>`SELECT id::int AS id FROM matches`).map((r) => r.id);
      c.that('I', 'every target id is offset and none is a source id of the resolved key', tgtIds.every((x) => x > f.targetIdOffset)
        && !srcIds.some((x) => tgtIds.includes(x)), `target ${tgtIds.join(',')} / source ${srcIds.join(',')}`);
      c.that('I', 'the manifest carries the target id for audit only; resolution was by match_key', capA.manifest.dependencies
        .some((d) => d.target_row === rows.f1 && d.match_keys.length === 1 && d.match_keys[0] === K) && ok('F1', rows.f1));
    });

    // P: an unchanged target, captured again with the proof.
    await c.step('P', 'manifest B of the unchanged target', async () => {
      if (!capA || !proof) throw new SourceDependencyRehearsalRefused('manifest A or its proof is missing');
      const capB = await capture(ctx, 'main-B-unchanged', proof);
      c.that('P', 'A and B share dependency_set_sha256', capB.manifest.dependency_set_sha256 === capA.manifest.dependency_set_sha256,
        capB.manifest.dependency_set_sha256);
      c.that('P', 'compareDependencyManifests: identical', compareDependencyManifests(capA.manifest, capB.manifest).identical);
      c.that('P', 'gateFrozenDependencyBinding PASS', verdictOf(capB.report, 'frozen dependency re-check') === 'PASS'
        && sourceProofBindingProblems(proof, capB.manifest).length === 0);
      c.note('P', `file sha256 A ${capA.sha}, B ${capB.sha} (captured_at is metadata)`);
    });

    await caseS(ctx, capA);

    // K: the same labels again.
    await c.step('K', 'second prepare --apply', async () => {
      const path = join(ctx.out, 'preparation', 'main-2.record.json');
      await prepare(ctx, w, 'apply', path);
      const second = await readRecord(path);
      const zero = (s: 'afltables' | 'afl_api') => counterOf(second.raw, s, 'canonicalRowsInserted') === 0 && counterOf(second.raw, s, 'canonicalRowsUpdated') === 0;
      c.that('K', 'afltables: 0 inserted, 0 updated', zero('afltables'), JSON.stringify(second.raw.counters));
      c.that('K', 'afl_api: 0 inserted, 0 updated', zero('afl_api'));
      if (!capA) throw new SourceDependencyRehearsalRefused('manifest A is missing');
      const again = (await judge(ctx, capA, second.file)).judgement;
      c.that('K', 'gate verdict and per-family counts unchanged', JSON.stringify(again.families.map(familyOutcomeCounts)) === firstCounts, refusalsText(again));
      c.that('H', 'the second preparation touched no pre-2026 match either', JSON.stringify(await historicalHash(ctx.owner)) === JSON.stringify(hist0));
    });

    // V: the same preview over the prepared source is naturally clean (no special case).
    await c.step('V', 'the preview after preparation', async () => {
      const before = await previewState(ctx, K);
      const files0 = operatorFiles(ctx);
      const { outcome } = await prepare(ctx, w, 'dry-run');
      const pc = outcome.steps[0]?.counters ?? {};
      c.that('V', 'over the prepared source the preview is clean: unresolvedIdentityMatch 0, inserted 0, updated 0, and still labelled unproven',
        pc.unresolvedIdentityMatch === 0 && pc.canonicalRowsInserted === 0 && pc.canonicalRowsUpdated === 0
          && outcome.status === 'preview-unproven' && outcome.record === null,
        `unresolvedIdentityMatch ${String(pc.unresolvedIdentityMatch)}, inserted ${String(pc.canonicalRowsInserted)}, updated ${String(pc.canonicalRowsUpdated)}, status ${outcome.status}`);
      const after = await previewState(ctx, K);
      c.that('V', 'that preview wrote nothing (database state and operator files unchanged)',
        JSON.stringify(after) === JSON.stringify(before) && JSON.stringify(operatorFiles(ctx)) === JSON.stringify(files0), JSON.stringify(after));
    });

    // A, Q-252-10 negative controls: the REAL settles, with one reported counter simulated.
    await c.step('A', 'Q-252-10 negative controls', async () => {
      const simulate = (when: 'apply' | 'dry-run', over: Record<string, number>) => {
        const calls: string[] = [];
        const deps: Pick<PrepareDeps, 'settleAfltables' | 'settleAflApi'> = {
          settleAfltables: async (argv, d) => {
            const mode = argv.includes('--apply') ? 'apply' : 'dry-run';
            calls.push(`afltables ${mode}`);
            const out = await runSettleCli(argv, d);
            if (mode === when && out.result) out.result = { ...out.result, counters: { ...out.result.counters, ...over } };
            return out;
          },
          settleAflApi: async (argv, d) => { calls.push('afl_api'); return runAflApiSettleCli(argv, d); },
        };
        return { calls, deps };
      };
      const closurePath = join(ctx.out, 'preparation', 'main-neg-closure.record.json');
      const s1 = simulate('dry-run', { unresolvedIdentityMatch: 1 });
      const r1 = await refusalOf(() => prepare(ctx, w, 'apply', closurePath, s1.deps));
      c.that('A', 'negative control: a closure dry run still showing unresolvedIdentityMatch 1 refuses',
        r1 !== null && /afltables closure dry-run did not meet[\s\S]*unresolvedIdentityMatch = 1, must be 0/.test(r1), r1 ?? 'NOT refused');
      c.that('A', 'negative control: that refusal came before the AFL API phase, and no record was written',
        s1.calls.join(',') === 'afltables apply,afltables dry-run' && !existsSync(closurePath), s1.calls.join(','));
      const otherPath = join(ctx.out, 'preparation', 'main-neg-other.record.json');
      const s2 = simulate('apply', { venueUnmapped: 1 });
      const r2 = await refusalOf(() => prepare(ctx, w, 'apply', otherPath, s2.deps));
      c.that('A', 'negative control: another non-zero counter (venueUnmapped 1) on the initial apply refuses immediately',
        r2 !== null && /afltables initial apply did not meet[\s\S]*venueUnmapped = 1, must be 0/.test(r2), r2 ?? 'NOT refused');
      c.that('A', 'negative control: that refusal came before the closure dry run, and no record was written',
        s2.calls.join(',') === 'afltables apply' && !existsSync(otherPath), s2.calls.join(','));
      c.that('H', 'the negative controls touched no pre-2026 match', JSON.stringify(await historicalHash(ctx.owner)) === JSON.stringify(hist0));
    });

    // Q: a resolvable dependency added between A and B makes the proof stale.
    await c.step('Q', 'dependency added between A and B', async () => {
      if (!capA || !proof) throw new SourceDependencyRehearsalRefused('manifest A or its proof is missing');
      const added = await addF3(ctx.owner, w.targetId);
      const capB = await capture(ctx, 'main-B-stale', proof);
      const cmp = compareDependencyManifests(capA.manifest, capB.manifest);
      c.that('Q', 'the set sha changes and the comparison names the new row', !cmp.identical && cmp.added.includes(`F3 data_edits:id=${added}`), JSON.stringify(cmp));
      c.that('Q', 'the old proof is refused as stale (rerun the source gate)', verdictOf(capB.report, 'frozen dependency re-check') === 'FAIL'
        && sourceProofBindingProblems(proof, capB.manifest).some((p) => /rerun the source gate/.test(p)));
      c.that('Q', 'staleness is about the set, not resolvability: B itself judges PASS', (await judge(ctx, capB, null)).judgement.pass);
      await removeTarget(ctx.owner, [{ table: 'data_edits', id: added }]);
    });

    // R: the frozen manifest adds a dependency the prepared source cannot resolve.
    await c.step('R', 'frozen manifest with an unpreparable dependency', async () => {
      const absent = `${f.season}|99|2026-12-30|Issue252 Rehearsal Absent Home|Issue252 Rehearsal Absent Away`;
      const m = await addTargetMatch(ctx.owner, absent, 'afltables');
      await addF1(ctx.owner, m);
      const capB = await capture(ctx, 'main-B-absent');
      const r = refusalFor((await judge(ctx, capB, null)).judgement, 'F1', `brownlow_vote_entry_state:match_id=${m}`);
      c.that('R', 'hard STOP identity_absent_in_candidate naming the key', r?.reason === 'identity_absent_in_candidate' && r.match_key === absent, JSON.stringify(r ?? null));
      await removeTarget(ctx.owner, [{ table: 'brownlow_vote_entry_state', id: m }, { table: 'matches', id: m }]);
    });

    // F: a key no retained unit carries; the other families are still judged on their own.
    await c.step('F', 'dependency on a key no unit carries', async () => {
      const absent = `${f.season}|99|2026-12-31|Issue252 Rehearsal Absent Home|Issue252 Rehearsal Absent Away`;
      const o = await addF2(ctx.owner, 'matches', absent);
      const judged = await judge(ctx, await capture(ctx, 'main-F'), null);
      const r = refusalFor(judged.judgement, 'F2', `data_overrides:id=${o}`);
      c.that('F', 'F2 hard STOP identity_absent_in_candidate naming the key', r?.reason === 'identity_absent_in_candidate' && r.match_key === absent, JSON.stringify(r ?? null));
      c.that('F', 'F1 and F3 are reported separately and PASS', verdictOf(judged.report, 'source dependency gate F1') === 'PASS'
        && verdictOf(judged.report, 'source dependency gate F3') === 'PASS' && verdictOf(judged.report, 'source dependency gate F2') === 'FAIL');
      await removeTarget(ctx.owner, [{ table: 'data_overrides', id: o }]);
    });

    // G: two identities behind one anchor; an undecodable match_coaches key.
    await c.step('G', 'ambiguity', async () => {
      const id = f.targetIdOffset + 900_000;
      await addTargetMatch(ctx.owner, `${f.season}|98|2026-12-29|Issue252 Rehearsal Ambiguous A|Issue252 Rehearsal Ambiguous B`, 'afltables', id);
      await addTargetMatch(ctx.owner, `${f.season}|98|2026-12-29|Issue252 Rehearsal Ambiguous B|Issue252 Rehearsal Ambiguous A`, 'afltables', id);
      const edit = await addF3(ctx.owner, id);
      const coach = await addF2(ctx.owner, 'match_coaches', `${f.labelPrefix}-undecodable`);
      const cap = await capture(ctx, 'main-G');
      const j = (await judge(ctx, cap, null)).judgement;
      c.that('G', 'the anchor carries two identities in the manifest', cap.manifest.dependencies.some((d) => d.target_row === `data_edits:id=${edit}` && d.match_keys.length === 2));
      c.that('G', 'F3 hard STOP ambiguous_in_replaced', refusalFor(j, 'F3', `data_edits:id=${edit}`)?.reason === 'ambiguous_in_replaced', refusalsText(j));
      c.that('G', 'F2 undecodable match_coaches key: hard STOP with no identity', refusalFor(j, 'F2', `data_overrides:id=${coach}`)?.reason === 'no_identity_in_replaced');
      await write(ctx.owner, (tx) => tx.unsafe(`DELETE FROM ${t}.matches WHERE id = $1`, [id] as never[]));
      await removeTarget(ctx.owner, [{ table: 'data_edits', id: edit }, { table: 'data_overrides', id: coach }]);
    });

    // O: one component away, three ways.
    await c.step('O', 'one-component key variants', async () => {
      const variants = oneComponentVariants(K);
      const ids: { component: string; key: string; id: number }[] = [];
      for (const v of variants) ids.push({ ...v, id: await addF2(ctx.owner, 'matches', v.key) });
      const j = (await judge(ctx, await capture(ctx, 'main-O'), null)).judgement;
      for (const v of ids) {
        const r = refusalFor(j, 'F2', `data_overrides:id=${v.id}`);
        c.that('O', `${v.component} variant is a hard STOP naming the target key`, r?.reason === 'identity_absent_in_candidate' && r.match_key === v.key, `${v.key} -> ${JSON.stringify(r ?? null)}`);
      }
      c.that('O', 'the true key still resolves beside them', !refusalFor(j, 'F2', rows.f2m));
      await removeTarget(ctx.owner, ids.map((v) => ({ table: 'data_overrides' as const, id: v.id })));
    });
  } catch (error) {
    c.that('A', 'world main: setup', false, message(error));
  } finally {
    await endWorld(ctx, baseline, 'L').catch((error: unknown) => { c.that('L', 'world main teardown', false, message(error)); });
  }
}

/** What a preview must leave exactly as it found it: the rows a settle writes, and the derived state. */
async function previewState(ctx: Ctx, key: string) {
  const [row] = await ctx.owner<{ seasonMatches: number; fixture: number; batches: number; applications: number; players: number; identities: number }[]>`
    SELECT (SELECT count(*)::int FROM matches WHERE season = ${f.season}) AS "seasonMatches",
           (SELECT count(*)::int FROM matches WHERE match_key = ${key}) AS fixture,
           (SELECT count(*)::int FROM import_batches) AS batches,
           (SELECT count(*)::int FROM canonical_applications) AS applications,
           (SELECT count(*)::int FROM players) AS players,
           (SELECT count(*)::int FROM external_identities) AS identities
  `;
  return {
    ...row, residue: await readResidue(ctx.owner, ctx.keys), derived: await derivedHash(ctx.owner),
    historical: await historicalHash(ctx.owner), switchRow: await readSwitch(ctx.owner),
  };
}

/** Every preparation record and source proof this run has written so far. */
function operatorFiles(ctx: Ctx): { preparation: string[]; proofs: string[] } {
  const list = (dir: string) => (existsSync(dir) ? readdirSync(dir).sort() : []);
  return { preparation: list(join(ctx.out, 'preparation')), proofs: list(join(ctx.out, 'proofs')) };
}

/**
 * V (Q-252-11): the standalone preparation --dry-run on the FRESH source, through the real CLI and
 * the real AFL Tables settle. It must accept the real transient `unresolvedIdentityMatch` within
 * its bound, say it is unproven, and write nothing — no record, no proof, no database change.
 */
async function caseVPreview(ctx: Ctx, w: World): Promise<void> {
  const c = ctx.checks;
  const others = PREPARATION_ZERO_COUNTERS.afltables.filter((k) => k !== AFLTABLES_FIRST_APPLY_TOLERATED_COUNTER);
  await c.step('V', 'standalone preparation --dry-run preview (fresh source)', async () => {
    const before = await previewState(ctx, w.key);
    const files0 = operatorFiles(ctx);
    c.that('V', 'fresh source: the fixture match does not exist before the preview', before.fixture === 0, `rows ${before.fixture}`);
    const s = spies();
    const { outcome, lines } = await prepare(ctx, w, 'dry-run', undefined, s.deps);
    const p = outcome.steps[0];
    const pc = p?.counters ?? {};
    c.note('V', `preview counters: unresolvedIdentityMatch ${String(pc.unresolvedIdentityMatch)}, inserted ${String(pc.canonicalRowsInserted)}, `
      + `updated ${String(pc.canonicalRowsUpdated)}, applicationsLogged ${String(pc.canonicalApplicationsLogged)}, `
      + `zero list ${JSON.stringify(Object.fromEntries(PREPARATION_ZERO_COUNTERS.afltables.map((k) => [k, pc[k]])))}`);
    c.note('V', lines.filter((l) => /preview|PREVIEW|proved/.test(l)).join(' / '));
    c.that('V', 'the preview exited successfully after the real AFL Tables dry run alone (rolled back, complete)',
      s.calls.length === 1 && s.calls[0].includes('--dry-run') && outcome.steps.length === 1 && p?.source === 'afltables'
        && p.mode === 'dry-run' && p.applied === false && p.completeness === 'complete', s.calls.join(' | '));
    c.that('V', 'the real transient unresolvedIdentityMatch is > 0 and ≤ canonicalRowsInserted; every other zero counter 0',
      Number(pc.unresolvedIdentityMatch) > 0 && Number(pc.unresolvedIdentityMatch) <= Number(pc.canonicalRowsInserted)
        && others.every((k) => pc[k] === 0),
      `unresolvedIdentityMatch ${String(pc.unresolvedIdentityMatch)}, inserted ${String(pc.canonicalRowsInserted)}`);
    c.that('V', 'the result is explicitly unproven (status preview-unproven, no record, the PREVIEW ONLY line logged)',
      outcome.status === 'preview-unproven' && outcome.record === null && lines.includes(PREPARATION_PREVIEW_STATUS), outcome.status);
    const files1 = operatorFiles(ctx);
    c.that('V', 'no preparation record and no source proof were written', JSON.stringify(files1) === JSON.stringify(files0), JSON.stringify(files1));
    const after = await previewState(ctx, w.key);
    c.that('V', 'database state unchanged (2026 matches, fixture absent, batches, applications, players, identities, residue, derived, pre-2026, switch)',
      JSON.stringify(after) === JSON.stringify(before), JSON.stringify({ before, after }));
  });

  await c.step('V', 'preview negative controls (real settle, one reported counter simulated)', async () => {
    const simulate = (over: (counters: Record<string, unknown>) => Record<string, number>) => {
      const calls: string[] = [];
      const deps: Pick<PrepareDeps, 'settleAfltables' | 'settleAflApi'> = {
        settleAfltables: async (argv, d) => {
          calls.push(`afltables ${argv.includes('--apply') ? 'apply' : 'dry-run'}`);
          const out = await runSettleCli(argv, d);
          if (out.result) out.result = { ...out.result, counters: { ...out.result.counters, ...over(out.result.counters) } };
          return out;
        },
        settleAflApi: async (argv, d) => { calls.push('afl_api'); return runAflApiSettleCli(argv, d); },
      };
      return { calls, deps };
    };
    const before = await previewState(ctx, w.key);
    const files0 = operatorFiles(ctx);
    const s1 = simulate(() => ({ venueUnmapped: 1 }));
    const r1 = await refusalOf(() => prepare(ctx, w, 'dry-run', undefined, s1.deps));
    c.that('V', 'negative control: another non-zero counter (venueUnmapped 1) beside the transient one still makes the preview fail',
      r1 !== null && /afltables preview dry-run did not meet[\s\S]*venueUnmapped = 1, must be 0/.test(r1) && s1.calls.join(',') === 'afltables dry-run', r1 ?? 'NOT refused');
    const s2 = simulate((cs) => ({ unresolvedIdentityMatch: Number(cs.canonicalRowsInserted) + 1 }));
    const r2 = await refusalOf(() => prepare(ctx, w, 'dry-run', undefined, s2.deps));
    c.that('V', 'negative control: unresolvedIdentityMatch above the inserted rows makes the preview fail',
      r2 !== null && /afltables preview dry-run did not meet[\s\S]*unresolvedIdentityMatch = \d+ exceeds the \d+ canonical rows/.test(r2), r2 ?? 'NOT refused');
    c.that('V', 'the negative controls wrote nothing either', JSON.stringify(await previewState(ctx, w.key)) === JSON.stringify(before)
      && JSON.stringify(operatorFiles(ctx)) === JSON.stringify(files0));
  });
}

/** T: the preparation guards through the REAL CLI, all as --dry-run with the real settles counted (expected: none). */
async function caseT(ctx: Ctx, w: World): Promise<void> {
  const c = ctx.checks;
  class GuardPassed extends Error {}
  const run = async (label: string, over: Partial<PrepareDeps>, expected: RegExp | 'guard-passed') => {
    await c.step('T', label, async () => {
      const s = spies();
      const before = await readSwitch(ctx.owner);
      const refused = await refusalOf(() => prepare(ctx, w, 'dry-run', undefined, { ...s.deps, ...over }));
      const ok = expected === 'guard-passed' ? refused === 'guard passed' : refused !== null && expected.test(refused);
      c.that('T', label, ok, refused ?? 'NOT refused');
      c.that('T', `${label}: no settle ran`, s.calls.length === 0, s.calls.join(' | '));
      c.that('T', `${label}: the CLI did not write the switch`, sameSwitch(before, await readSwitch(ctx.owner)));
    });
  };
  await c.step('T', 'switch disabled', async () => {
    await writeSwitch(ctx.owner, false);
    try {
      await run('switch disabled: refused', {}, new RegExp(SETTING_KEYS.aflApiCurrentSeasonEnabled.replace(/\./g, '\\.')));
    } finally {
      await writeSwitch(ctx.owner, true);
    }
  });
  await run('switch enabled: passes the database/switch guard', {
    readSeasonOwnership: async () => { throw new GuardPassed('guard passed'); },
  }, 'guard-passed');
  await run('control presented as afldb_test, writer still code_test_db: sessions disagree, refused', {
    prove: async (sql, env) => presentAsPreparedSource(await proveAflApiIngestionPreflight(sql, env), 'control'),
  }, /disagree on current_database/);
  c.that('T', 'requireSameAflApiDatabase refuses two different databases', (await refusalOf(() => requireSameAflApiDatabase(
    { database: f.sourceLabel, role: 'afldb_owner' }, { database: f.database, role: 'afldb_import' }))) !== null);
  await run('the REAL guard, unsubstituted: both sessions are code_test_db, not afldb_test — refused', { prove: undefined },
    /DATABASE_URL session is 'code_test_db', not 'afldb_test'[\s\S]*AFLDB_IMPORT_DATABASE_URL session is 'code_test_db'/);
}

/** J, the offline and name guards (no manifest needed). */
async function caseJOffline(ctx: Ctx, w: World): Promise<void> {
  const c = ctx.checks;
  await c.step('J', 'name guards', async () => {
    c.that('J', 'prepare refuses --acknowledge code_test_db', /--acknowledge afldb_test is required/.test(await refusalOf(() => runPreparePromotionSource(
      prepareArgv(w.labels, w.hashes, 'validate-only', undefined, f.database), { projectRoot: ctx.root, log: () => {} })) ?? ''));
    c.that('J', 'the target manifest refuses a target other than afldb_prod', /read from 'afldb_prod' only/.test(await refusalOf(() =>
      captureTargetDependencyManifest(ctx.targetQ, { environment: 'prod', database: f.database })) ?? ''));
    const empty = buildDependencyManifest({
      environment: 'prod', targetDatabase: f.targetLabel, capturedAt: '2026-09-27T00:00:00Z', targetDatabaseOid: null,
      familyStatuses: familyStatusesFor('prod'), readings: [],
    });
    c.that('J', 'the proof refuses a prepared source other than afldb_test', /must be 'afldb_test'/.test(await refusalOf(() => buildSourceDependencyProof({
      manifest: empty, manifestFileSha256: '1'.repeat(64), sourceDatabase: f.database, sourceDatabaseOid: null, judgedAt: 'now',
      judgement: judgeSourceDependencies({ manifest: empty, sourceMatches: [] }), preparation: NO_PREPARATION,
    })) ?? ''));
    const record = JSON.stringify({ kind: 'afldb_promotion_source_preparation_record', schema_version: PREPARATION_RECORD_SCHEMA_VERSION, source_database: f.sourceLabel });
    c.that('J', 'a preparation record is refused for any other source database', /is for 'afldb_test', not 'code_test_db'/.test(await refusalOf(() =>
      parsePreparationRecord({ bytes: record, expectedFileSha256: sha256Hex(record), expectedSourceDatabase: f.database })) ?? ''));
    const s = spies();
    const writerOnly = await refusalOf(() => prepare(ctx, w, 'dry-run', undefined, {
      ...s.deps, prove: async (sql, env) => presentAsPreparedSource(await proveAflApiIngestionPreflight(sql, env), 'writer'),
    }));
    c.that('J', 'a control session on anything but afldb_test refuses before any settle', /DATABASE_URL session is 'code_test_db'/.test(writerOnly ?? '')
      && s.calls.length === 0, writerOnly ?? 'NOT refused');
  });
  await c.step('J', 'tampered snapshot files refuse offline', async () => {
    const tamper = async (name: string, rel: string) => {
      const copy = join(ctx.out, `tamper-${name}`);
      cpSync(ctx.root, copy, { recursive: true });
      try {
        const path = join(copy, rel);
        writeFileSync(path, `${readFileSync(path, 'utf8')} `, 'utf8');
        const refused = await refusalOf(() => prepare(ctx, w, 'validate-only', undefined, {}, copy));
        c.that('J', `tampered ${name} refused offline (--validate-only)`, refused !== null && /STOP: the retained inputs/.test(refused), refused ?? 'NOT refused');
      } finally {
        rmSync(copy, { recursive: true, force: true });
      }
    };
    await tamper('afl_api-payload', join('data', 'sources', 'afl_api', 'matches', w.labels.aflApi, w.fx.spec.providerId, 'fixture.json'));
    await tamper('afltables-bundle', join('data', 'sources', 'afltables', 'fitzroy_core', w.labels.afltables, 'observations.json'));
    await tamper('afltables-csv', join('data', 'sources', 'afltables', 'fitzroy_core', w.labels.afltables, 'results.csv'));
    c.that('J', 'the untampered snapshots validate offline', (await refusalOf(() => prepare(ctx, w, 'validate-only'))) === null);
  });
}

/** J, the manifest guards (on the pre-preparation manifest). */
async function caseJManifest(ctx: Ctx, pre: Captured | null): Promise<void> {
  const c = ctx.checks;
  await c.step('J', 'manifest guards', async () => {
    if (!pre) throw new SourceDependencyRehearsalRefused('no pre-preparation manifest');
    c.that('J', 'a manifest parsed for another environment refuses', /environment 'prod' is not 'dev'/.test(await refusalOf(() =>
      parseDependencyManifest({ bytes: pre.bytes, expectedFileSha256: pre.sha, expectedEnvironment: 'dev' })) ?? ''));
    const retargeted = pre.bytes.replace(`"target_database": "${f.targetLabel}"`, '"target_database": "afldb_dev"');
    c.that('J', 'a manifest naming another target database refuses (file re-hashed)', /target_database 'afldb_dev' is not 'afldb_prod'/.test(await refusalOf(() =>
      parseDependencyManifest({ bytes: retargeted, expectedFileSha256: sha256Hex(retargeted), expectedEnvironment: 'prod' })) ?? ''));
    c.that('J', 'a manifest whose sha256 is not the supplied one refuses', /is not the recorded/.test(await refusalOf(() =>
      parseDependencyManifest({ bytes: pre.bytes, expectedFileSha256: sha256Hex(`${pre.bytes}x`), expectedEnvironment: 'prod' })) ?? ''));
  });
}

/** S: transport and semantic tampering of manifest A. */
async function caseS(ctx: Ctx, capA: Captured | null): Promise<void> {
  const c = ctx.checks;
  await c.step('S', 'tampering', async () => {
    if (!capA) throw new SourceDependencyRehearsalRefused('manifest A is missing');
    const transport = capA.bytes.replace(/"captured_at": "[^"]*"/, '"captured_at": "2026-01-01T00:00:00.000Z"');
    c.that('S', 'transport: bytes changed, recorded sha kept -> refused', transport !== capA.bytes && /file sha256 .* is not the recorded/.test(await refusalOf(() =>
      parseDependencyManifest({ bytes: transport, expectedFileSha256: capA.sha, expectedEnvironment: 'prod' })) ?? ''));
    const raw = JSON.parse(capA.bytes) as { dependencies: { owner_state: string; owner_source_key: string | null }[] };
    const dep = raw.dependencies.find((d) => d.owner_state === 'owned');
    if (!dep) throw new SourceDependencyRehearsalRefused('manifest A has no owned dependency to edit');
    dep.owner_source_key = 'afl_api';
    const semantic = `${JSON.stringify(raw, null, 2)}\n`;
    c.that('S', 'semantic: owner edited, file re-hashed -> dependency_set_sha256 refusal', /dependency_set_sha256 recomputes/.test(await refusalOf(() =>
      parseDependencyManifest({ bytes: semantic, expectedFileSha256: sha256Hex(semantic), expectedEnvironment: 'prod' })) ?? ''));
  });
}

// ---------------------------------------------------------------------------
// World "n": the same kind of match, AFL API first (N, U)
// ---------------------------------------------------------------------------

async function worldN(ctx: Ctx, fx: FixtureIdentity, baseline: string): Promise<void> {
  const c = ctx.checks;
  console.log('\n=== world n');
  try {
    const w = await setupWorld(ctx, fx);
    const f1 = `brownlow_vote_entry_state:match_id=${await addF1(ctx.owner, w.targetId)}`;
    await c.step('N', 'AFL API settle first, then the gate', async () => {
      const lines: string[] = [];
      const outcome = await runAflApiSettleCli(['--label', w.labels.aflApi, '--apply', '--auto-apply', '--require-complete-source'],
        { projectRoot: ctx.root, sql: ctx.importSql, log: (l) => lines.push(l) });
      c.that('N', 'the AFL API settle alone inserted the match', outcome.result?.applied === true && Number(outcome.result.counters.canonicalRowsInserted) > 0,
        `applied ${String(outcome.result?.applied)}, inserted ${String(outcome.result?.counters.canonicalRowsInserted)}`);
      const owners = await sourceOwnerOf(ctx, w.key);
      c.that('N', 'the source match is afl_api-owned', owners.length === 1 && owners[0] === 'afl_api', owners.join(','));
      const j = (await judge(ctx, await capture(ctx, 'n'), null)).judgement;
      const r = refusalFor(j, 'F1', f1);
      c.that('N', 'match_key resolves but the gate REFUSES owner_mismatch (target afltables, source afl_api)', r?.reason === 'owner_mismatch'
        && r.match_key === w.key && r.target_owner === 'afltables' && r.source_owner === 'afl_api' && familyOf(j, 'F1').resolved >= 1, JSON.stringify(r ?? null));
    });
    await c.step('U', 'preparation over an AFL API-first season', async () => {
      const s = spies();
      const refused = await refusalOf(() => prepare(ctx, w, 'dry-run', undefined, s.deps));
      c.that('U', "refused: season-2026 match(es) already 'afl_api'-owned", refused !== null && /already 'afl_api'-owned/.test(refused), refused ?? 'NOT refused');
      c.that('U', 'refused before any settle ran', s.calls.length === 0, s.calls.join(' | '));
    });
  } catch (error) {
    c.that('N', 'world n: setup', false, message(error));
  } finally {
    await endWorld(ctx, baseline, 'L').catch((error: unknown) => { c.that('L', 'world n teardown', false, message(error)); });
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

function writeEvidence(out: string, checks: Checks, header: string[]): number {
  const failed: string[] = [];
  const summary = [...header, ''];
  for (const { id, proves } of REHEARSAL_CASES) {
    const mine = checks.all.filter((x) => x.caseId === id);
    const pass = mine.length > 0 && mine.every((x) => x.ok);
    if (!pass) failed.push(id);
    summary.push(`${id} ${pass ? 'PASS' : 'FAIL'} (${mine.filter((x) => x.ok).length}/${mine.length}) — ${proves}`);
    const text = [
      `AFLDB-ISSUE-252 rehearsal case ${id}: ${pass ? 'PASS' : 'FAIL'}`, `proves: ${proves}`, '',
      ...(checks.notes.get(id) ?? []).map((n) => `note: ${n}`),
      ...mine.map((x) => `[${x.ok ? 'PASS' : 'FAIL'}] ${x.label}${x.detail ? ` — ${x.detail}` : ''}`),
      ...(mine.length === 0 ? ['[FAIL] no check was reached for this case'] : []), '',
    ].join('\n');
    writeOperatorFileAtomically(join(out, 'evidence', `${id}.txt`), text);
  }
  summary.push('', failed.length === 0 ? 'REHEARSAL PASS' : `REHEARSAL FAIL: ${failed.join(', ')}`, '');
  writeOperatorFileAtomically(join(out, 'evidence', 'summary.txt'), summary.join('\n'));
  console.log(`\n${summary.join('\n')}`);
  return failed.length === 0 ? 0 : 1;
}

async function runRehearsal(dsns: { ownerDsn: string; importDsn: string }, outArg: string): Promise<number> {
  const out = resolve(outArg);
  if (existsSync(out) && readdirSync(out).length > 0) throw new SourceDependencyRehearsalRefused(`${out} is not empty; every evidence file is written no-clobber.`);
  for (const sub of ['manifests', 'proofs', 'preparation', 'evidence']) mkdirSync(join(out, sub), { recursive: true });
  const root = join(out, 'project-root');
  const checks = new Checks();
  const owner = connect(dsns.ownerDsn);
  let importSql: Sql | null = null;
  let target: Sql | null = null;
  const header: string[] = [`AFLDB-ISSUE-252 source dependency rehearsal on ${f.database}`];
  const priorDatabaseUrl = process.env.DATABASE_URL;
  let prior: SwitchRow | null = null;
  let keys: string[] = [];
  let baseline = '';
  let season: SeasonAsFound | null = null;
  try {
    const pre = await preflight(owner);
    header.push(...pre.notes.map((n) => `preflight: ${n}`));
    console.log(header.join('\n'));
    keys = Object.values(pre.fixtures).map((x) => x.identity.matchKey);
    importSql = connect(dsns.importDsn);
    target = connect(dsns.ownerDsn, f.targetSchema);
    await assertDatabase(importSql);
    prior = await readSwitch(owner);
    header.push(`switch before the run: ${JSON.stringify(prior)} (restored at the end)`);
    const raw = await derivedHash(owner);
    season = await readSeasonAsFound(owner);
    header.push(`${f.season} as found: ${JSON.stringify(season)}`);
    // What `teardown --season-as-found` restores after an interrupted run.
    writeOperatorFileAtomically(join(out, 'evidence', 'season-as-found.json'), `${JSON.stringify(season, null, 2)}\n`);
    if (season.matches === 0) {
      // An empty season is not recomputable (see restoreDerived): the baseline IS the as-found state.
      baseline = raw;
      header.push(`${f.season} derived hash: as found ${raw} = baseline (empty season: restored verbatim, not recomputed)`);
    } else {
      baseline = await recomputedBaseline(owner);
      header.push(`${f.season} derived hash: as found ${raw}, recomputed baseline ${baseline}${raw === baseline ? '' : ' (differs: the database was not at a recompute fixpoint)'}`);
    }
    // The AFL API settle CLI proves its control session from process.env.DATABASE_URL (code_test_db owner).
    process.env.DATABASE_URL = dsns.ownerDsn;
    writeProjectReferences(root);
    await writeSwitch(owner, true);
    const ctx: Ctx = {
      owner, importSql, target, sourceQ: queryOf(owner), targetQ: queryOf(target),
      ownerDsn: dsns.ownerDsn, importDsn: dsns.importDsn, out, root, checks, keys, season,
    };
    await worldMain(ctx, pre.fixtures.main, baseline);
    await worldN(ctx, pre.fixtures.n, baseline);
  } catch (error) {
    if (prior === null) {
      // Refused before any write: nothing to tear down or restore.
      await owner.end();
      if (importSql) await importSql.end();
      if (target) await target.end();
      throw error;
    }
    checks.that('L', 'the run ended early', false, message(error));
  } finally {
    if (prior !== null) {
      await teardownWorld(owner, keys).catch((error: unknown) => checks.that('L', 'final teardown', false, message(error)));
      await write(owner, (tx) => restoreDerived(tx, season)).catch((error: unknown) => checks.that('L', 'final derived-state restore', false, message(error)));
      await restoreSwitch(owner, prior).catch((error: unknown) => checks.that('L', 'switch restore', false, message(error)));
    }
    if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = priorDatabaseUrl;
  }
  try {
    const residue = await readResidue(owner, keys);
    checks.that('L', 'final residue is zero (matches, players, links, batches, spine, payloads, ledger, findings, target schema)', residueTotal(residue) === 0, JSON.stringify(residue));
    checks.that('L', 'the switch is back to its prior row', prior !== null && sameSwitch(prior, await readSwitch(owner)));
    const derived = await derivedHash(owner);
    checks.that('L', `${f.season} derived state equals the baseline`, derived === baseline, `${derived} vs ${baseline}`);
    if (season !== null && season.matches === 0) {
      const now = await readSeasonAsFound(owner);
      checks.that('L', `${f.season} season row and derived row counts are exactly as found`, JSON.stringify(now) === JSON.stringify(season), JSON.stringify(now));
    }
    checks.note('L', 'documented exception: sequences the real writers advanced (matches, import_batches, staging, ledger) stay advanced');
  } finally {
    await owner.end();
    if (importSql) await importSql.end();
    if (target) await target.end();
  }
  return writeEvidence(out, checks, header);
}

async function main(argv: string[]): Promise<number> {
  const command = parseSourceDependencyRehearsalArgs(argv);
  const dsns = resolveRehearsalDsns(process.env, { allowOwnerImportDsn: false });
  if (dsns.database !== f.database) throw new SourceDependencyRehearsalRefused(`Refusing '${dsns.database}': ${f.database} only.`);
  console.log(`AFLDB-ISSUE-252 source dependency rehearsal — ${command.step} on ${dsns.database} (${REHEARSAL_OWNER_ENV}, ${REHEARSAL_IMPORT_ENV})`);
  if (command.step === 'run') return runRehearsal(dsns, command.out);
  const owner = connect(dsns.ownerDsn);
  try {
    await assertDatabase(owner);
    const keys = await fixtureKeysOf(owner);
    if (command.step === 'teardown') {
      await teardownWorld(owner, keys);
      const asFound = command.seasonAsFound ? JSON.parse(readFileSync(command.seasonAsFound, 'utf8')) as SeasonAsFound : null;
      const derived = await refusalOf(() => write(owner, (tx) => restoreDerived(tx, asFound)));
      console.log(`teardown done; ${f.season} derived state ${derived === null ? 'restored' : `NOT restored: ${derived}`}. The switch is NOT restored here (its prior row is in the run's evidence header): ${JSON.stringify(await readSwitch(owner))}`);
    }
    const residue = await readResidue(owner, keys);
    console.log(`residue: ${JSON.stringify(residue)}`);
    console.log(`${f.season} season now: ${JSON.stringify(await readSeasonAsFound(owner))}`);
    return residueTotal(residue) === 0 ? 0 : 1;
  } finally {
    await owner.end();
  }
}

if (process.argv[1] && /promotion-source-dependency-rehearsal\.ts$/.test(process.argv[1])) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`REFUSED: ${redact((error as Error).message)}`);
      process.exit(1);
    });
}
