/**
 * AFLDB-ISSUE-228 S6 — the afl_api settle writer against real PostgreSQL.
 *
 * ISOLATION MODEL — COMMITTED FIXTURES, exactly as
 * `tests/integration/settle-afltables.test.ts` established and for the same
 * reason: `runSettleAflApi()` opens its OWN transaction, so the
 * outer-rollback-transaction pattern cannot wrap it. This suite commits
 * fixtures, commits its own settle output, and removes both afterwards.
 *
 * FIXTURE DATA is the REAL, already-validated sample at
 * `tests/fixtures/afl_api/match/*.json` (Hawthorn v Brisbane Lions, 2026
 * Preliminary Final, `CD_M20260142801`) — the same bytes `tests/afl-api-match.test.ts`
 * proves against the emitters DB-free. Reusing proven-valid bytes rather than
 * hand-built JSON is deliberate: every field the emitters require strictly
 * (round vocabulary, score arithmetic, cumulative period-score reproduction,
 * provider-id shapes) is already correct, so this suite only ever mutates the
 * one field each case is actually about. Every case gets its OWN provider
 * match id (`CD_M2026ISSUE228<n>`), so cases never share canonical rows.
 *
 * `clubs` (Hawthorn, Brisbane Lions) and `venues` (M.C.G.) are READ, never
 * written — real historical identities, exactly as `settle-afltables.test.ts`
 * reads two existing clubs rather than inventing any. `sources` rows for
 * `afl_api` (077) and `afltables` are READ, never written: both should
 * already exist on any correctly migrated `afldb_test`.
 *
 * COMMITTED BY THIS SUITE: one dedicated `players` row and one
 * `external_identities` bootstrap-bridge row (T1, §6.3) for the ONE player
 * this suite resolves; every settle-produced row (import_batches, the
 * migration-074 spine, the migration-103 typed projections,
 * `promotion_candidates`, `canonical_applications`, `matches`,
 * `match_period_scores`, `player_match_stats`, `data_issues`); and, for the
 * corroboration/enrichment cases, one `afltables`-owned `matches` fixture row
 * plus a `staging.afltables_match` row. Cleanup runs BEFORE setup as well as
 * in `afterAll`, exactly as the established pattern requires.
 *
 * @see src/lib/acquisition/settle-afl-api.ts
 * @see issues/open/AFLDB-ISSUE-228.md §16 S6, §19
 */
import './guard';

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  linkAflApiProvider,
  revokeAflApiLink,
  type LinkAflApiProviderInput,
  type LinkAflApiProviderResult,
} from '@/db/queries/afl-api-player-links';
import { adjudicationFingerprint, type AflApiImporterMatchMethod } from '@/lib/acquisition/afl-api-adjudication';
import {
  parseAflApiIdentities, type AflApiIdentities,
} from '@/lib/acquisition/afl-api-bundle';
import { classifyCandidate } from '@/lib/acquisition/settle-report';
import {
  buildAflApiSettleBundle,
  runSettleAflApi,
  SETTLE_BATCH_TOOL,
  SETTLE_ISSUE_OWNER,
  type AflApiSettleBundle,
  type AflApiSettleUnitSource,
} from '@/lib/acquisition/settle-afl-api';
import { renderMatchKey } from '@/lib/acquisition/settle-core';
import { resolveAflApiPlayer } from '@/lib/acquisition/afl-api-player-resolver';
import {
  getSourceFamily,
  parseSourceFamilyRegistry,
  type SourceFamilyRegistry,
} from '@/lib/acquisition/source-families';
import { recomputeClubSeasons, recomputeSeasonMetadata } from '@/db/queries/player-derived';

import {
  archivedCaptureName,
  buildCombinedCapture,
  decidePendingCapture,
  nextIdentityValue,
  observeLiveReinstatement,
  PENDING_CAPTURE_FILE,
  readLedger,
  readPendingCapture,
  readPendingCaptureWithHash,
  reinstateAndReplay,
  reinstatedCaptureProblems,
  setRebuildMarker,
  settleCapture,
  writePendingCapture,
  type CapturedLedgerRow,
  type CombinedCapture,
  type LiveReinstatementObservation,
  type PendingCaptureDecision,
  type ReinstateReport,
} from '../../tools/migration/rebuild_afl_api_adjudications';
import { RESET_SQL } from '../../tools/db/rebuild-test';
import {
  AflApiReplayAbort,
  assertAflApiAdjudicationBijection,
  assertAflApiIdentityInvariant,
  readAflApiForwardIdentities,
  readAflApiImporterRows,
  replayAflApiAdjudications,
  replayAflApiImporterRows,
  resolveAflApiPlayerIdentity,
} from '../../tools/migration/replay_afl_api_adjudications';

import {
  assertS6LedgerIsolated,
  cleanupI14Fixtures,
  cleanupI237Fixtures,
  cleanupI237ProviderRows,
  cleanupS6Fixtures,
  decodeS6Jsonb,
  I1_FIXTURE,
  I14_FIXTURE,
  I237_FIXTURE,
  i14StaleLedgerRow,
  i237Issue235OwnershipOverlap,
  insertS6BrownlowVote,
  issue235FixtureResidue,
  issue237FixtureResidue,
  loadS6Refs,
  renderS6Form,
  routeS6ImportDsn,
  S6_NOTE,
  S6_SEASON,
  s6LedgerRows,
  s6MatchId,
  s6ProviderId,
  s6StateSnapshot,
  seedI14Actor,
  seedS6Actor,
  seedS6ImporterLink,
  seedS6PendingEvidence,
  seedS6Player,
  seedS6SpineVersion,
  ZERO_ISSUE235_RESIDUE,
  ZERO_ISSUE237_RESIDUE,
  type S6Refs,
} from './afl-api-adjudication-fixtures';

const PROJECT_ROOT = join(__dirname, '..', '..');
const FIXTURE_DIR = join(PROJECT_ROOT, 'tests', 'fixtures', 'afl_api', 'match');

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8'));
}

/** Deep clone via JSON round-trip — every fixture here is plain JSON. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const REAL_MATCH_ID = 'CD_M20260142801';
/** This suite's own namespace. Appears nowhere else in the repository. */
const NS = 'CD_M2026ISSUE228';
const SEASON = 2026;
const HOME_HIST = 'Hawthorn';
const AWAY_HIST = 'Brisbane Lions';
const BRIDGED_PROVIDER_PLAYER_ID = 'CD_I297354'; // Karl Amon, home side, in the fixture
/**
 * AFLDB-ISSUE-237: the bridged fixture player's own AFL Tables identity. A real importer row's
 * player always holds exactly one (D7: Stage 2 refuses to capture one that does not), and
 * `assertAflApiIdentityInvariant()` is whole-table, so the baseline bridged row must be a
 * genuine D5 importer row, not merely one the settle resolver accepts. Synthetic, like the
 * player itself; appears nowhere else in the repository.
 */
const BRIDGED_AFLTABLES_ID = 'players/Z/Issue228-bridged-test.html';
const UNBRIDGED_PROVIDER_PLAYER_ID = 'CD_I500001'; // "Test Forward", away side — deliberately never bridged

/**
 * One match unit's three raw payloads, cloned from the proven-valid fixture
 * and renamed onto a dedicated provider match id AND a dedicated match DATE.
 *
 * WHY THE DATE MOVES PER CASE. `matches.match_key` is `NOT NULL UNIQUE`
 * (003:23) and is rendered as `season|round_code|match_date|home name|away
 * name` (`renderMatchKey()`) — the provider match id is NOT a component of
 * it. So renaming the provider id alone leaves every case of this suite
 * denoting ONE canonical match. That is what an earlier draft did, and the
 * consequences were not subtle: each case resolved onto the previous case's
 * row at §6.1 step 2 instead of creating its own, so the "new match" and
 * "idempotent rerun" cases proposed no change at all; the provider id was
 * never linked to a row, so the §14 contradiction case could not HALT; and
 * `afl_api_player_match_grain_uq (source_id, provider_player_id, match_key)`
 * (103:368) was violated the moment a second case projected the same player
 * against the same shared key. Giving each case its own real-world identity
 * fixes all of them at the source rather than per symptom.
 *
 * Both halves of the local date/time are moved together. §11.1's cross-check
 * (`deriveAflApiLocalMatchDateTime()`) proves the canonical local date ONLY
 * when the roster's `venueLocalStartTime` equals the match family's own
 * `utcStartTime` converted to `venue.timezone`, and an outright disagreement
 * is a hard `local_time_contradiction` failure — so moving one without the
 * other would not merely be sloppy, it would refuse the unit. `07:15:00Z` ->
 * `17:15:00` is `Australia/Melbourne` at AEST (UTC+10); every date below is
 * in September 2026, before daylight saving begins on 4 October, so the one
 * offset is correct for all of them.
 *
 * `venueLocalStartTime` must be ADDED at all: the real fixture omits it
 * (§11.1 "known-but-not-required"), which would otherwise leave
 * `bundle.localMatchDateTime` null and refuse every case with
 * `unproved_match_date`.
 */
function unitSourceFor(providerMatchId: string, mutate?: (raw: {
  fixture: Record<string, any>; roster: Record<string, any>; stats: Record<string, any>;
}) => void): AflApiSettleUnitSource {
  const fixture = clone(readFixture('01-fixture-result.json')) as Record<string, any>;
  const roster = clone(readFixture('03-match-roster.raw.json')) as Record<string, any>;
  const stats = clone(readFixture('02-player-stats.raw.json')) as Record<string, any>;
  const matchDate = matchDateFor(providerMatchId);

  fixture.providerId = providerMatchId;
  fixture.utcStartTime = `${matchDate}T07:15:00.000+0000`;
  roster.match.matchId = providerMatchId;
  roster.match.venueLocalStartTime = `${matchDate}T17:15:00`;
  roster.matchRoster.matchId = providerMatchId;
  roster.matchRoster.homeTeam.matchId = providerMatchId;
  roster.matchRoster.awayTeam.matchId = providerMatchId;
  roster.recentMatchScores[0].matchId = providerMatchId;

  if (mutate) mutate({ fixture, roster, stats });

  return { fixtureRaw: fixture, rosterRaw: roster, playerStatsRaw: stats };
}

function buildBundle(
  sources: readonly AflApiSettleUnitSource[], registry: SourceFamilyRegistry, identities: AflApiIdentities,
): AflApiSettleBundle {
  const bundle = buildAflApiSettleBundle({
    season: SEASON, snapshotLabel: 'issue228-integration', sources, registry, identities,
  });
  expect(bundle.buildFailures).toEqual([]);
  return bundle;
}

/* ------------------------------------------------------------------ *
 * Fixture setup / teardown
 * ------------------------------------------------------------------ */

const sql = postgres(process.env.AFLDB_TEST_DATABASE_URL as string, { max: 1, onnotice: () => {} });

let registry: SourceFamilyRegistry;
let identities: AflApiIdentities;
let aflApiSourceId: number;
let afltablesSourceId: number;
let homeClubId: number;
let awayClubId: number;
/** The canonical `clubs.name` for each side — what `renderMatchKey()` uses. */
let homeClubName: string;
let awayClubName: string;
let venueId: number;
let bridgedPlayerId: number;

/**
 * The synthetic player's canonical key. `players` (migration 002) has NO
 * `first_name`/`last_name` columns — its identity/name shape is `id`
 * (identity PK), `legacy_player_id` (nullable, UNIQUE — the legacy-database
 * parity key), `display_name`/`sort_name`/`search_name`/`slug` (all NOT
 * NULL) and `given_name`/`surname` (nullable, display-only). A real
 * `legacy_player_id` is always a positive legacy-database id, so a negative,
 * namespaced value can never collide with one and gives cleanup a
 * deterministic lookup key that survives across process restarts — unlike
 * the in-memory `bridgedPlayerId`, which is unset on a fresh run picking up
 * an interrupted earlier run's leftover row.
 */
const SYNTHETIC_PLAYER_LEGACY_ID = -228000001;

const CASE_IDS = {
  golden: `${NS}A`,
  rerun: `${NS}B`,
  contradiction: `${NS}C`,
  corroborateAgree: `${NS}D`,
  corroborateDisagree: `${NS}E`,
  enrichment: `${NS}F`,
  // I244-F001: derived (club_seasons/seasons) coverage, added for
  // AFLDB-ISSUE-244's F001 fix. Own case ids/dates so cleanup() and
  // matchKeyFor() need no special-casing.
  derivedNewFinal: `${NS}G`,
  derivedCorrection: `${NS}H`,
  // I244-F003: venue identity coverage. Own case ids/dates for the same
  // reason as F001's above — cleanup()/matchKeyFor() pick these up for free
  // via ALL_PROVIDER_IDS/allMatchKeys() with no special-casing.
  venueProviderMiss: `${NS}K`,
  venueLegacyNameMiss: `${NS}L`,
  venueSelfHeal: `${NS}M`,
  completenessRollback: `${NS}N`,
  // I244-F008: import_batches terminal lifecycle. Own ids/dates for the same
  // reason as the groups above; cleanup() removes the batches by the
  // 'issue228-integration' note prefix every label below carries.
  batchLifecycle: `${NS}O`,
  batchDryRun: `${NS}P`,
  batchFinaliseFailure: `${NS}Q`,
  // I244-F009: durable evidence for an automatic-apply refusal. Same reasoning:
  // cleanup() removes their data_issues rows via the `%NS%` issue_key match.
  applyRefusal: `${NS}R`,
  applyRefusalMoot: `${NS}S`,
  // I244-F010: identity-bearing corrections are withheld, made durable and self-healing.
  // `identityCollision` is the row a correction is proposed for; `identityCollisionOther`
  // is a second, real canonical match whose key the proposed identity would collide with.
  identityCorrection: `${NS}T`,
  identityCollision: `${NS}U`,
  identityCollisionOther: `${NS}V`,
  // I244-F030: an unresolved provider record vs a canonical fixture that may already be the same
  // match. Each case is one provider record; the canonical fixtures it is compared with are SEEDED
  // (see `F030_SEEDS`), never produced through the settle, because the settle refuses to create them.
  possibleDate: `${NS}F30A`,
  possibleRound: `${NS}F30B`,
  possibleHeal: `${NS}F30C`,
  secondMeeting: `${NS}F30D`,
  otherSeason: `${NS}F30E`,
  possibleMultiple: `${NS}F30F`,
  raceAfterPlanning: `${NS}F30G`,
  swappedOrientation: `${NS}F30H`,
  // AFLDB-ISSUE-235 S6 (I2/I5/I6): the one case that drives the real settle across a human
  // link. Its unbridged away player is renamed into the ISSUE-235 provider namespace
  // (`issue235LifecycleSource()`), so cleanup() owns its match and spine rows exactly as it owns
  // every other case's.
  issue235Lifecycle: `${NS}Z235`,
} as const;
const ALL_PROVIDER_IDS = Object.values(CASE_IDS);

/**
 * I244-F001 H&A regression cases. Every OTHER case in this suite builds from
 * `01-fixture-result.json` as-is, which is a Preliminary Final — Fable's
 * §32 acceptance requirement is explicit that a genuine, non-final AFL
 * API-owned insert must flow through `runSettleAflApi()` and prove
 * `club_seasons`'s W/L/points/percentage/ladder columns, which
 * `recomputeClubSeasons()` scopes to `NOT is_final` rows only
 * (`player-derived.ts:437,443`) — a Preliminary Final can never exercise
 * them. Deliberately NOT added to `CASE_IDS`/`ALL_PROVIDER_IDS`:
 * `matchKeyFor()`/`allMatchKeys()` hard-code round_code `'PF'`, which would
 * render the WRONG key for a home-and-away round, so `haMatchKeyFor()`
 * below is the dedicated renderer and `cleanup()` lists both keys
 * explicitly instead.
 */
const HA_INSERT_ID = `${NS}I`;
const HA_CORRECTION_ID = `${NS}J`;
/** afl_api_2026 declared round vocabulary (`data/reference/source-families.json`):
 * `api_round_number 1` ("Rd 1"/"Round 1") -> `canonical_round_number 2`,
 * `round_type: 'home_and_away'`. Any genuine H&A round would do; this one is
 * arbitrary. */
const HA_ROUND_CODE = '2';

/**
 * One dedicated match DATE per case — the component that actually makes each
 * case its own canonical match (see `unitSourceFor()`'s comment; the provider
 * id is not part of `match_key` at all).
 *
 * Every date is a September 2026 Monday, Tuesday or Wednesday. No AFL match
 * is ever played mid-week in the finals series, so none of these keys can
 * collide with a real fixture that an AFL Tables settle may already have
 * written to `afldb_test` — which matters because `matches.match_key` is
 * UNIQUE and a collision would silently turn a "new match" case into a
 * corroboration against somebody else's row.
 */
const CASE_DATES: Readonly<Record<string, string>> = {
  [CASE_IDS.golden]: '2026-09-21',
  [CASE_IDS.rerun]: '2026-09-22',
  [CASE_IDS.contradiction]: '2026-09-23',
  [CASE_IDS.corroborateAgree]: '2026-09-28',
  [CASE_IDS.corroborateDisagree]: '2026-09-29',
  [CASE_IDS.enrichment]: '2026-09-30',
  [CASE_IDS.derivedNewFinal]: '2026-09-24',
  [CASE_IDS.derivedCorrection]: '2026-09-25',
  [CASE_IDS.venueProviderMiss]: '2026-09-14',
  [CASE_IDS.venueLegacyNameMiss]: '2026-09-15',
  [CASE_IDS.venueSelfHeal]: '2026-09-16',
  [CASE_IDS.completenessRollback]: '2026-09-17',
  // I244-F008 (Mon/Tue/Wed, like every other case — no real fixture is played then).
  [CASE_IDS.batchLifecycle]: '2026-09-07',
  [CASE_IDS.batchDryRun]: '2026-09-08',
  [CASE_IDS.batchFinaliseFailure]: '2026-09-09',
  // I244-F009 (Tue/Wed, like every other case — no real fixture is played then).
  [CASE_IDS.applyRefusal]: '2026-09-01',
  [CASE_IDS.applyRefusalMoot]: '2026-09-02',
  // I244-F010: every Mon-Wed in September is taken, so these are late-August
  // dates (still AEST, before 4 October daylight saving), Tue/Wed/Mon of the
  // week after the home-and-away season. `IDENTITY_CORRECTED_DATE` below is the
  // date a provider "corrects" a match to; no canonical match is ever created at
  // it except by the supervised-repair step, and cleanup() covers that key.
  [CASE_IDS.identityCorrection]: '2026-08-25',
  [CASE_IDS.identityCollision]: '2026-08-26',
  [CASE_IDS.identityCollisionOther]: '2026-08-31',
  // I244-F030: Mon/Tue dates in July/August (AEST, before daylight saving), used by no other case;
  // no real fixture is played then. Every one is a preliminary-final rendering, like the cases above.
  [CASE_IDS.possibleDate]: '2026-07-06',
  [CASE_IDS.possibleRound]: '2026-07-13',
  [CASE_IDS.possibleHeal]: '2026-07-20',
  [CASE_IDS.secondMeeting]: '2026-07-27',
  [CASE_IDS.otherSeason]: '2026-08-03',
  [CASE_IDS.possibleMultiple]: '2026-08-04',
  [CASE_IDS.raceAfterPlanning]: '2026-08-10',
  [CASE_IDS.swappedOrientation]: '2026-08-17',
  // AFLDB-ISSUE-235 S6: a June Monday (AEST, no daylight saving), used by no other case; no
  // Preliminary Final is ever played then.
  [CASE_IDS.issue235Lifecycle]: '2026-06-01',
  // I244-F001 H&A cases: deliberately the LATEST dates in the suite (every
  // other case is <= 2026-09-30) so seasons.last_match_date/
  // data_through_date/last_loaded_round can be proven to reflect THIS
  // match once it lands — still before 2026-10-04 daylight saving (see this
  // file's own note on `venueLocalStartTime`/`utcStartTime` above).
  [HA_INSERT_ID]: '2026-10-01',
  [HA_CORRECTION_ID]: '2026-10-02',
};

/**
 * I244-F001. `recomputeClubSeasons()` (`player-derived.ts:413-423`) throws
 * "no canonical home-and-away matches for season ${season}" when a season
 * has zero `NOT is_final` rows — a fail-closed guard against silently
 * emptying a real ladder from nothing. Before this fix `runSettleAflApi()`
 * never called it, so the guard was unreachable from this suite; now every
 * case above that actually writes a canonical match (golden/rerun/
 * contradiction/derivedNewFinal/derivedCorrection) reaches it. Every fixture
 * this suite builds from `01-fixture-result.json` is a Preliminary Final
 * (`is_final = true`), so without an explicit home-and-away anchor for
 * season 2026 the guard would trip on the very first auto-applied case.
 * `tests/integration/match-admin-create.test.ts` establishes the identical
 * pattern (a permanent keep-alive row for its own synthetic season) for the
 * same reason. Home/away club id, not source, decide `played`/`wins`/etc.
 * for this row; nothing in this suite asserts those columns, only
 * `finals_played` (fed by `is_finals_series`, unaffected by a
 * `home_and_away` row) and `seasons` metadata (deltas, not absolutes).
 */
const KEEPALIVE_MATCH_KEY = `${NS}-keepalive`;

/**
 * Rewrites the cloned fixture/roster round fields from the shared fixture's
 * native Preliminary Final into the H&A round declared above — the ONLY
 * mutation needed for `translateAflRound()` (`afl-api-rounds.ts:135-161`) to
 * resolve `round_type: 'home_and_away'`, `is_final: false`. Nothing else in
 * the settle path cross-checks `matchRoster.roundNumber` against the match
 * family's own round (grepped: only the Brownlow path reads it), but both
 * are set for internal consistency of the fixture.
 */
function toHomeAndAwayRound(raw: { fixture: Record<string, any>; roster: Record<string, any> }): void {
  raw.fixture.round = { ...raw.fixture.round, abbreviation: 'Rd 1', name: 'Round 1', roundNumber: 1 };
  raw.roster.matchRoster.roundNumber = 1;
}

function matchDateFor(providerMatchId: string): string {
  const date = CASE_DATES[providerMatchId];
  if (!date) throw new Error(`No CASE_DATES entry for provider match id '${providerMatchId}'.`);
  return date;
}

/**
 * The exact `match_key` a case's unit resolves to, rendered by the SAME
 * function the writer itself uses (`renderMatchKey()`, settle-core.ts) over
 * the SAME inputs: the canonical `clubs.name`, never `legacy_club_hist`.
 *
 * The two happen to coincide for Hawthorn and Brisbane Lions, so an earlier
 * draft's hand-joined string worked by luck; rendering it properly means this
 * suite cannot drift from `match_key_of()`'s algorithm for any other club.
 * Depends on `beforeAll` having read the club names, so every caller — and
 * `allMatchKeys()` — is evaluated inside a hook or a test, never at module
 * load.
 */
function matchKeyFor(providerMatchId: string): string {
  if (!homeClubName || !awayClubName) {
    throw new Error('matchKeyFor() was called before beforeAll() resolved the canonical club names.');
  }
  return renderMatchKey(SEASON, 'PF', matchDateFor(providerMatchId), homeClubName, awayClubName);
}

/** I244-F001: the H&A-case equivalent of `matchKeyFor()`, rendered under
 * `HA_ROUND_CODE` rather than the hard-coded `'PF'` every other case uses. */
function haMatchKeyFor(providerMatchId: string): string {
  if (!homeClubName || !awayClubName) {
    throw new Error('haMatchKeyFor() was called before beforeAll() resolved the canonical club names.');
  }
  return renderMatchKey(SEASON, HA_ROUND_CODE, matchDateFor(providerMatchId), homeClubName, awayClubName);
}

/**
 * I244-F010: the date a provider "corrects" an identity-bearing field to, and
 * the `match_key` a canonical row would carry at it. Only the supervised-repair
 * step ever creates a row under this key (by editing an existing one), and
 * cleanup() lists it so a failed run cannot leak that row.
 */
const IDENTITY_CORRECTED_DATE = '2026-08-27';
function identityCorrectedMatchKey(): string {
  if (!homeClubName || !awayClubName) {
    throw new Error('identityCorrectedMatchKey() was called before beforeAll() resolved the canonical club names.');
  }
  return renderMatchKey(SEASON, 'PF', IDENTITY_CORRECTED_DATE, homeClubName, awayClubName);
}

/**
 * I244-F030. A canonical fixture a provider record is compared with, INSERTED DIRECTLY.
 *
 * Never produced through `runSettleAflApi()`: the settle refuses to create a second fixture
 * for the same season and clubs when at most one of round/date differs, which is exactly
 * what these seeds are, so a seeded row is the only honest way to stand one up. Directly
 * inserted rows carry no ledger, spine or staging row, so cleanup() removes them by
 * `match_key` alone (`f030SeedKeys()`), and the `afltables` ones cite their own key as
 * `source_record_id`, as that source's match family does.
 */
type F030Seed = {
  season: number;
  roundCode: 'PF' | 'SF';
  roundType: 'preliminary_final' | 'semi_final';
  date: string;
  /** Home and away swapped relative to the provider's orientation (Hawthorn home). */
  swapped?: boolean;
  /** Another source, `afl_api` itself, or nobody (`source_id` NULL: provenance unknown). */
  owner: 'afltables' | 'afl_api' | 'none';
};

const F030_SEEDS = {
  // Same round (PF) as the provider record, one day later: exactly ONE component differs (date).
  dateForeign: { season: SEASON, roundCode: 'PF', roundType: 'preliminary_final', date: '2026-07-07', owner: 'afltables' },
  // Same date as the provider record, a different round (SF): exactly ONE component differs (round).
  roundForeign: { season: SEASON, roundCode: 'SF', roundType: 'semi_final', date: '2026-07-13', owner: 'afltables' },
  healForeign: { season: SEASON, roundCode: 'PF', roundType: 'preliminary_final', date: '2026-07-21', owner: 'afltables' },
  // A different round AND a different date: TWO components differ — a genuine second meeting.
  secondForeign: { season: SEASON, roundCode: 'SF', roundType: 'semi_final', date: '2026-07-28', owner: 'afltables' },
  // The strongest possible cross-season control: same clubs, same round, a different date — a
  // candidate if the season were ignored.
  priorSeason: { season: 2025, roundCode: 'PF', roundType: 'preliminary_final', date: '2025-07-07', owner: 'afltables' },
  multiDate: { season: SEASON, roundCode: 'PF', roundType: 'preliminary_final', date: '2026-08-05', owner: 'afltables' },
  multiRound: { season: SEASON, roundCode: 'SF', roundType: 'semi_final', date: '2026-08-04', owner: 'none' },
  raceForeign: { season: SEASON, roundCode: 'PF', roundType: 'preliminary_final', date: '2026-08-11', owner: 'afltables' },
  // Same round, one day later — but Brisbane at home: club orientation is exact, so NOT a candidate.
  swappedForeign: { season: SEASON, roundCode: 'PF', roundType: 'preliminary_final', date: '2026-08-18', swapped: true, owner: 'afltables' },
} as const;

function f030SeedKey(seed: F030Seed): string {
  if (!homeClubName || !awayClubName) {
    throw new Error('f030SeedKey() was called before beforeAll() resolved the canonical club names.');
  }
  const [home, away] = seed.swapped ? [awayClubName, homeClubName] : [homeClubName, awayClubName];
  return renderMatchKey(seed.season, seed.roundCode, seed.date, home, away);
}

function f030SeedKeys(): string[] {
  return Object.values(F030_SEEDS).map((seed) => f030SeedKey(seed));
}

/** Insert one seeded canonical fixture on `db` (a SEPARATE connection when a settle transaction is open). */
async function seedCanonicalMatch(
  db: postgres.Sql, seed: F030Seed, aflApiProviderId?: string,
): Promise<{ id: number; matchKey: string }> {
  const matchKey = f030SeedKey(seed);
  const homeId = seed.swapped ? awayClubId : homeClubId;
  const awayId = seed.swapped ? homeClubId : awayClubId;
  let sourceId: number | null = null;
  let sourceRecordId: string | null = null;
  if (seed.owner === 'afltables') { sourceId = afltablesSourceId; sourceRecordId = matchKey; }
  if (seed.owner === 'afl_api') {
    if (!aflApiProviderId) throw new Error('An afl_api-owned seed needs its provider id.');
    sourceId = aflApiSourceId; sourceRecordId = aflApiProviderId;
  }
  // The same column set the corroboration case inserts (matches_round_number_ck: a final carries no round_number).
  const [row] = await db<{ id: number }[]>`
    INSERT INTO matches (
      match_key, season, round_code, round_number, round_type, is_final,
      match_date, venue_id, venue_raw, home_club_id, away_club_id,
      home_goals, home_behinds, home_score, away_goals, away_behinds, away_score,
      result, winner_club_id, margin,
      attendance, attendance_status, attendance_source_id,
      source_id, source_record_id
    ) VALUES (
      ${matchKey}, ${seed.season}, ${seed.roundCode}, ${null}, ${seed.roundType}, true,
      ${seed.date}, ${venueId}, 'MCG', ${homeId}, ${awayId},
      19, 8, 122, 20, 11, 131,
      'away_win', ${awayId}, 9,
      NULL, 'not_collected', NULL,
      ${sourceId}, ${sourceRecordId}
    ) RETURNING id
  `;
  return { id: row.id, matchKey };
}

/** Every match_key this suite's cases may create, for cleanup by exact key. */
function allMatchKeys(): string[] {
  return ALL_PROVIDER_IDS.map((id) => matchKeyFor(id));
}

/**
 * Remove every row this suite can create, and nothing else.
 *
 * The deletion order below is the REVERSE of the real foreign-key graph, and
 * the graph is taken from the migrations rather than discovered one failure at
 * a time. Nine tables reference
 * `staging.source_record_versions (source_id, family, external_record_id,
 * version_seq)`: `staging.source_records` (074:125), `promotion_candidates`
 * (074:178), `canonical_applications` (083:103), `staging.afltables_match`
 * (076:117), `staging.afltables_player_match` (076:316),
 * `staging.afl_api_lineup` (077:197), and `staging.afl_api_match` /
 * `staging.afl_api_player_match` / `staging.afl_api_brownlow_vote` (103:172,
 * 103:360, 103:488). This suite writes five of the nine —
 * afltables_player_match, afl_api_lineup and afl_api_brownlow_vote are never
 * touched by it — and every one of the five is cleared below BEFORE the
 * version rows they cite.
 */
async function cleanup(): Promise<void> {
  // KEEPALIVE_MATCH_KEY is included here (not via allMatchKeys()/CASE_DATES,
  // which are keyed by an afl_api PROVIDER id this row never has) so every
  // deletion below that already scopes by `matchKeys` — canonical_applications'
  // target_key lookup and the `matches` delete itself — covers it too, with no
  // separate statement to keep in sync.
  const matchKeys = [
    ...allMatchKeys(), KEEPALIVE_MATCH_KEY,
    haMatchKeyFor(HA_INSERT_ID), haMatchKeyFor(HA_CORRECTION_ID),
    identityCorrectedMatchKey(),
    // I244-F030: the seeded canonical fixtures (exact keys only — never a season-wide delete).
    ...f030SeedKeys(),
  ];
  const matchIds = await sql<{ id: number }[]>`
    SELECT id FROM matches WHERE match_key = ANY(${matchKeys}::text[])
  `;
  const ids = matchIds.map((r) => r.id);

  // `player_clubs` (migration 007, DERIVED) carries `first_match_id`/
  // `last_match_id REFERENCES matches(id)` with NO `ON DELETE` clause
  // (default RESTRICT) — `recomputePlayerDerivedStats()` (called by the
  // writer on every autoApply run that touches this player) writes a row
  // here keyed on the synthetic player, and it MUST be gone before any of
  // this suite's `matches` rows are deleted below, or that DELETE fails
  // closed with a foreign-key violation. Looked up by `legacy_player_id`,
  // never by the in-memory `bridgedPlayerId`, for the same leftover-run
  // reason the constant's own comment gives. `player_clubs.player_id`
  // itself IS `ON DELETE CASCADE` (007:129), so this is the only explicit
  // statement this table needs.
  await sql`
    DELETE FROM player_clubs
     WHERE player_id IN (SELECT id FROM players WHERE legacy_player_id = ${SYNTHETIC_PLAYER_LEGACY_ID})
  `;

  if (ids.length > 0) {
    await sql`DELETE FROM player_match_stats WHERE match_id = ANY(${ids}::bigint[])`;
    await sql`DELETE FROM match_period_scores WHERE match_id = ANY(${ids}::bigint[])`;
  }
  // canonical_applications carries a FOREIGN KEY to
  // staging.source_record_versions (source_id, family, external_record_id,
  // source_version_seq) — migration 083:103-104 — so EVERY ledger row this
  // suite produces must be gone before the version rows below, or that DELETE
  // fails closed and the whole teardown aborts part-way, leaving the next run
  // to trip over the remains.
  //
  // This suite writes ledger rows under THREE different external_record_id
  // shapes, and an earlier draft deleted only the first:
  //   1. the match family's own provider id, `<NS><case>`;
  //   2. the player family's COMPOSITE id, `<NS><case>|<CD_T…>|<CD_I…>` —
  //      matched by no equality against ALL_PROVIDER_IDS, and by no
  //      target_table = 'matches' filter either, since these rows target
  //      player_match_stats. These were what actually survived and broke
  //      teardown;
  //   3. the attendance-enrichment row, whose external_record_id is the
  //      afltables MATCH KEY (applyAttendanceEnrichment() writes the enriching
  //      source's own identity, and afltables' match family is keyed by
  //      match_key — import_fitzroy_core.py:1260-1263).
  // The LIKE covers 1 and 2 together; 3 is deleted by key, scoped to the
  // afltables source so no other suite's ledger row can be in range.
  await sql`DELETE FROM canonical_applications WHERE external_record_id LIKE ${`${NS}%`}`;
  await sql`
    DELETE FROM canonical_applications
     WHERE source_id = ${afltablesSourceId} AND external_record_id = ANY(${matchKeys}::text[])
  `;
  await sql`
    DELETE FROM canonical_applications
     WHERE target_table = 'matches' AND target_key->>'match_key' = ANY(${matchKeys}::text[])
  `;
  await sql`DELETE FROM promotion_candidates WHERE external_record_id LIKE ${`${NS}%`}`;
  await sql`DELETE FROM data_issues WHERE issue_key LIKE ${`%${NS}%`}`;
  await sql`DELETE FROM import_rejections WHERE source_record_id LIKE ${`${NS}%`}`;
  if (ids.length > 0) await sql`DELETE FROM matches WHERE id = ANY(${ids}::bigint[])`;

  await sql`DELETE FROM staging.afl_api_player_match WHERE provider_match_id LIKE ${`${NS}%`}`;
  await sql`DELETE FROM staging.afl_api_match WHERE external_record_id LIKE ${`${NS}%`}`;
  // staging.afltables_match (migration 076) carries NO match_key column — its
  // grain is (source_id, family, external_record_id), and for the afltables
  // `match` family that external_record_id IS the match_key
  // (import_fitzroy_core.py:1260-1263 joins
  // season|round_code|match_date|clubs.name_of(home)|clubs.name_of(away),
  // which is renderMatchKey() exactly). So this suite's own AFL Tables fixture
  // row for the §19.2 enrichment case is identified by key, scoped to the
  // afltables source, and no other afltables staging row is in range.
  await sql`
    DELETE FROM staging.afltables_match
     WHERE source_id = ${afltablesSourceId} AND external_record_id = ANY(${matchKeys}::text[])
  `;
  // Deletion order is child-to-parent along the two FKs 074 declares:
  // staging.source_records.(source_id, family, external_record_id,
  // current_version_seq) REFERENCES staging.source_record_versions(...)
  // (source_records is the CHILD), and
  // staging.source_record_versions.(source_id, family, payload_hash)
  // REFERENCES staging.source_payloads(...) (source_record_versions is the
  // CHILD of source_payloads). So: source_records first, then
  // source_record_versions, then source_payloads below — never the reverse,
  // which would delete a still-referenced parent row.
  //
  // Two identity shapes, each scoped to the one source that can own it: the
  // afl_api rows (match and the composite player ids, both NS-prefixed) and
  // the afltables enrichment-fixture rows (keyed by match_key, see above).
  //
  // The payload hashes are captured BEFORE the version rows citing them are
  // deleted, because that is the only way to name this suite's afl_api
  // payloads precisely: `persistSourceObservation()` derives the hash from the
  // payload bytes, so no caller can predict it. The earlier form — delete
  // every payload of this source that no surviving version references — was a
  // broad delete that would also remove any OTHER suite's orphaned payload
  // that happened to be present.
  const doomedPayloads = await sql<{ sourceId: number; family: string; payloadHash: string }[]>`
    SELECT DISTINCT source_id AS "sourceId", family, payload_hash AS "payloadHash"
      FROM staging.source_record_versions
     WHERE (source_id = ${aflApiSourceId} AND external_record_id LIKE ${`${NS}%`})
        OR (source_id = ${afltablesSourceId} AND external_record_id = ANY(${matchKeys}::text[]))
  `;
  await sql`
    DELETE FROM staging.source_records
     WHERE (source_id = ${aflApiSourceId} AND external_record_id LIKE ${`${NS}%`})
        OR (source_id = ${afltablesSourceId} AND external_record_id = ANY(${matchKeys}::text[]))
  `;
  await sql`
    DELETE FROM staging.source_record_versions
     WHERE (source_id = ${aflApiSourceId} AND external_record_id LIKE ${`${NS}%`})
        OR (source_id = ${afltablesSourceId} AND external_record_id = ANY(${matchKeys}::text[]))
  `;
  // A payload is shared by every version carrying identical bytes, so each one
  // is removed only once nothing cites it any more.
  for (const payload of doomedPayloads) {
    await sql`
      DELETE FROM staging.source_payloads
       WHERE source_id = ${payload.sourceId} AND family = ${payload.family}
         AND payload_hash = ${payload.payloadHash}
         AND NOT EXISTS (
           SELECT 1 FROM staging.source_record_versions v
            WHERE v.source_id = ${payload.sourceId} AND v.family = ${payload.family}
              AND v.payload_hash = ${payload.payloadHash}
         )
    `;
  }
  // This suite's own two import_batches notes: its own runs
  // ('issue228-integration', from buildBundle's snapshotLabel) and the
  // hand-inserted AFL Tables fixture batch for the §19.2 enrichment case.
  await sql`
    DELETE FROM import_batches
     WHERE notes LIKE ${'%issue228-integration%'} OR notes LIKE ${'%issue228-enrichment-fixture%'}
  `;
  // external_identities.player_id -> players(id) has no ON DELETE clause
  // (default RESTRICT, migration 002:184), so this must run before the
  // players delete below.
  await sql`DELETE FROM external_identities WHERE source_id = ${aflApiSourceId} AND external_id = ${BRIDGED_PROVIDER_PLAYER_ID}`;
  await sql`DELETE FROM external_identities WHERE source_id = ${afltablesSourceId} AND external_id = ${BRIDGED_AFLTABLES_ID}`;
  await sql`DELETE FROM players WHERE legacy_player_id = ${SYNTHETIC_PLAYER_LEGACY_ID}`;
}

/**
 * I244-F001 test-harness fix. Restores season 2026's `seasons`/`club_seasons`
 * derived state to self-consistent canonical truth. Called once in
 * `beforeAll` (after the keep-alive fixture lands, so this suite starts from
 * a clean baseline regardless of residue a PRIOR run's `afterAll` left
 * behind) and once in `afterAll` (after `cleanup()` removes every row this
 * suite created, so the NEXT run — or any other suite/operator reading
 * `afldb_test` afterwards — does not see `club_seasons`/`seasons` still
 * reflecting matches that no longer exist).
 *
 * Without this, `runSettleAflApi()`'s own F001 recompute (which this suite's
 * cases legitimately trigger on every real write, §36 of
 * `afldb-issue244.md`) leaves its LAST run's output sitting in
 * `club_seasons`/`seasons` after `cleanup()` deletes the matches that
 * produced it — inflated Hawthorn/Brisbane Lions `club_seasons` rows, a
 * `seasons.last_match_date`/`last_loaded_round` pointing at a synthetic
 * date/round that no longer exists. A later focused run
 * (`vitest ... -t <case>`) would then read that stale row as its "before"
 * snapshot and compute a wrong delta against a freshly recomputed "after".
 *
 * Guarded on `recomputeClubSeasons()`'s own fail-closed precondition
 * (`player-derived.ts:409-422`: it throws rather than emptying the ladder
 * when a season has zero `NOT is_final` matches) — read directly here rather
 * than duplicating that function's SQL, so this helper can tell whether it is
 * safe to call before doing so. After this suite's OWN `afterAll` cleanup,
 * season 2026 may legitimately hold zero non-final matches (if `afldb_test`
 * has no other real 2026 H&A data), in which case `recomputeClubSeasons()`
 * is skipped rather than manufacturing a permanent fake row just to satisfy
 * it. `recomputeSeasonMetadata()` has no equivalent precondition — a
 * zero-match season is a valid `in_progress` state for it
 * (`player-derived.ts:533-535`) — so it always runs.
 */
async function recompute2026SeasonDerivedState(): Promise<void> {
  await sql.begin(async (tx) => {
    const [{ count }] = await tx<{ count: string }[]>`
      SELECT count(*)::text AS count FROM matches WHERE season = ${SEASON} AND NOT is_final
    `;
    await recomputeSeasonMetadata(tx, SEASON);
    if (Number(count) > 0) {
      await recomputeClubSeasons(tx, SEASON);
    }
  });
}

beforeAll(async () => {
  registry = parseSourceFamilyRegistry(
    JSON.parse(readFileSync(join(PROJECT_ROOT, 'data', 'reference', 'source-families.json'), 'utf8')),
  );
  identities = parseAflApiIdentities(
    JSON.parse(readFileSync(join(PROJECT_ROOT, 'data', 'reference', 'afl-api-identities.json'), 'utf8')),
  );
  getSourceFamily(registry, 'afl_api', 'match'); // fails loudly if the registry is somehow not this repo's

  const [afl] = await sql<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afl_api'`;
  const [aft] = await sql<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afltables'`;
  if (!afl || !aft) {
    throw new Error("sources 'afl_api' (migration 077) and 'afltables' must both exist on afldb_test.");
  }
  aflApiSourceId = afl.id;
  afltablesSourceId = aft.id;

  const [home] = await sql<{ id: number; name: string }[]>`SELECT id, name FROM clubs WHERE legacy_club_hist = ${HOME_HIST}`;
  const [away] = await sql<{ id: number; name: string }[]>`SELECT id, name FROM clubs WHERE legacy_club_hist = ${AWAY_HIST}`;
  const [venue] = await sql<{ id: number }[]>`SELECT id FROM venues WHERE legacy_name = 'M.C.G.'`;
  if (!home || !away || !venue) {
    throw new Error('Hawthorn, Brisbane Lions and M.C.G. must all exist on afldb_test (real historical identities).');
  }
  homeClubId = home.id;
  awayClubId = away.id;
  // Read, never assumed: renderMatchKey() keys on clubs.name, and this suite
  // must render the identical string the writer does.
  homeClubName = home.name;
  awayClubName = away.name;
  venueId = venue.id;

  await seedBaseline();
  baselineIsFresh = true;
}, 30_000);

/**
 * The suite's whole starting state: nothing this suite ever created, then the keep-alive
 * home-and-away anchor, a self-consistent 2026 derived baseline, and the one bridged player.
 * `beforeAll` runs it once and `beforeEach` runs it again before every later case (see there).
 */
async function seedBaseline(): Promise<void> {
  await cleanup();

  // I244-F001 (see KEEPALIVE_MATCH_KEY's own comment): a permanent
  // home-and-away anchor for season 2026 so `recomputeClubSeasons()` never
  // sees zero non-final matches once this suite's writes reach it. Never
  // touched by any case under test; removed only by cleanup().
  await sql`
    INSERT INTO matches (
      match_key, season, round_code, round_type, round_number, is_final, match_date,
      venue_raw, home_club_id, away_club_id, home_score, away_score, result,
      winner_club_id, margin, attendance_status
    ) VALUES (
      ${KEEPALIVE_MATCH_KEY}, ${SEASON}::smallint, '9001', 'home_and_away', 9001, false,
      ${`${SEASON}-01-01`}::date, 'ISSUE-228 test fixture', ${homeClubId}, ${awayClubId}, 100, 80,
      'home_win', ${homeClubId}, 20, 'not_collected'
    )
  `;

  // I244-F001 test-harness fix: establish a self-consistent seasons/
  // club_seasons baseline for 2026 before any case runs, regardless of what
  // a PRIOR run's afterAll may have left behind (see the helper's own doc
  // comment). The keep-alive row above guarantees the non-final-match
  // precondition this recompute needs.
  await recompute2026SeasonDerivedState();

  // players (migration 002): display_name/sort_name/search_name/slug are all
  // NOT NULL with no default; there is no first_name/last_name. Upserted on
  // the synthetic legacy_player_id so a rerun after an interrupted process
  // (which left the row behind, `cleanup()` above already having removed it
  // by the same key) is idempotent rather than failing on a stray unique
  // constraint.
  const [player] = await sql<{ id: number }[]>`
    INSERT INTO players (legacy_player_id, display_name, sort_name, search_name, slug, given_name, surname)
    VALUES (
      ${SYNTHETIC_PLAYER_LEGACY_ID},
      'Karl Amon (ISSUE-228 test fixture)',
      'Amon (ISSUE-228 test fixture), Karl',
      'karl amon issue228 test fixture',
      'karl-amon-issue228-test-fixture',
      'Karl', 'Amon-Issue228Test'
    )
    ON CONFLICT (legacy_player_id) DO UPDATE SET display_name = EXCLUDED.display_name
    RETURNING id
  `;
  bridgedPlayerId = player.id;
  // Exactly the row the real bridge loader writes (`import_afl_api_player_bridge.py`:
  // 'unique', candidate_count 1, NULL external_url). Omitting candidate_count left the column
  // default 0 -- a D5 census anomaly that AFLDB-ISSUE-237's whole-table invariant rightly flags.
  await sql`
    INSERT INTO external_identities (source_id, external_id, status, candidate_count, match_method, player_id)
    VALUES (${aflApiSourceId}, ${BRIDGED_PROVIDER_PLAYER_ID}, 'unique', 1, 'afl_api_stat_vector_bootstrap', ${bridgedPlayerId})
    ON CONFLICT DO NOTHING
  `;
  await sql`
    INSERT INTO external_identities (source_id, external_id, status, candidate_count, match_method, player_id)
    VALUES (${afltablesSourceId}, ${BRIDGED_AFLTABLES_ID}, 'unique', 1, 'afltables_profile_url', ${bridgedPlayerId})
    ON CONFLICT DO NOTHING
  `;
}

/**
 * I244-F030 — every case starts from the same clean baseline.
 *
 * The AFL API settle now refuses to INSERT a match when a canonical row of any owner has the
 * same season and oriented clubs and differs in at most one of round/date. This suite's own
 * idiom — many synthetic matches between the same two clubs, all Preliminary Finals (or all
 * the same home-and-away round), told apart ONLY by date — is exactly that shape, so once one
 * case had committed its match every later case would have been refused as
 * `possible_existing_match`. The cases are independent by design (each owns its provider id,
 * date and assertions), so the fix is isolation rather than a weaker guard: the baseline is
 * rebuilt before every case after the first. No assertion in any case was changed to allow this;
 * a case that measures a derived-table delta now measures it from the same baseline every time,
 * which is what the first case has always relied on.
 */
let baselineIsFresh = false;
beforeEach(async () => {
  if (baselineIsFresh) {
    baselineIsFresh = false; // beforeAll just built it for the first case
    return;
  }
  await seedBaseline();
}, 60_000);

afterAll(async () => {
  await cleanup();
  // I244-F001 test-harness fix: this suite's cases legitimately drove real
  // recomputes of seasons/club_seasons (§36 of afldb-issue244.md); cleanup()
  // above removes the matches that produced that state but does not itself
  // refresh the derived tables. Restore them to canonical truth from
  // whatever season-2026 matches genuinely remain, so afldb_test is not left
  // holding stale season/club rows keyed to fixture matches that no longer
  // exist (see the helper's own doc comment for the full failure mode).
  await recompute2026SeasonDerivedState();
  await sql.end({ timeout: 5 });
}, 30_000);

/* ------------------------------------------------------------------ *
 * Canonical state snapshot (§19 idempotency)
 * ------------------------------------------------------------------ */

type CanonicalSnapshot = {
  match: Record<string, unknown> | null;
  periods: Record<string, unknown>[];
  playerStats: Record<string, unknown>[];
  applications: string;
  candidates: string;
};

/**
 * Everything canonical one match owns, captured whole.
 *
 * `to_jsonb(row)` rather than a hand-picked column list is the point: it
 * captures EVERY column, including the provenance quartet and `matches`'
 * `imported_at`, which `writeMatch()` bumps on any UPDATE. So comparing two
 * snapshots proves the rows were not touched at all, rather than proving that
 * the few fields someone thought to list still agree.
 *
 * An aggregate counter cannot make that statement. The rerun defect this
 * guards against — `career_game_no` written back to NULL by the settle and
 * renumbered again by `recomputePlayerDerivedStats()` — showed up as
 * `canonicalRowsUpdated = 1` and was invisible in every other assertion the
 * suite made; had the counter itself ever been miscounted, nothing here would
 * have noticed. The ledger and candidate counts are included for the rest of
 * the §19 contract: no duplicate `canonical_applications` row, and no
 * duplicate `promotion_candidates` row, on an identical observation.
 */
async function canonicalSnapshot(
  matchKey: string, providerMatchId: string,
): Promise<CanonicalSnapshot> {
  const [match] = await sql<{ row: Record<string, unknown> }[]>`
    SELECT to_jsonb(m) AS row FROM matches m WHERE m.match_key = ${matchKey}
  `;
  const periods = await sql<{ row: Record<string, unknown> }[]>`
    SELECT to_jsonb(p) AS row
      FROM match_period_scores p
      JOIN matches m ON m.id = p.match_id
     WHERE m.match_key = ${matchKey}
     ORDER BY p.club_id, p.period
  `;
  const playerStats = await sql<{ row: Record<string, unknown> }[]>`
    SELECT to_jsonb(s) AS row
      FROM player_match_stats s
      JOIN matches m ON m.id = s.match_id
     WHERE m.match_key = ${matchKey}
     ORDER BY s.player_id
  `;
  // Both families this case writes are covered by one prefix: the match
  // family's external_record_id IS the provider match id, and the player
  // family's is that id followed by '|<CD_T…>|<CD_I…>'.
  const [applications] = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM canonical_applications
     WHERE external_record_id LIKE ${`${providerMatchId}%`}
  `;
  const [candidates] = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM promotion_candidates
     WHERE external_record_id LIKE ${`${providerMatchId}%`}
  `;
  return {
    match: match?.row ?? null,
    periods: periods.map((r) => r.row),
    playerStats: playerStats.map((r) => r.row),
    applications: applications.count,
    candidates: candidates.count,
  };
}

/**
 * I244-F001. `club_seasons`/`seasons` state for one club/the season, taken
 * as a snapshot so a case can assert the DELTA its own run produced rather
 * than an absolute value — this suite's cases accumulate real canonical
 * matches for Hawthorn/Brisbane Lions in season 2026 across the whole file
 * (there is no per-`it` cleanup, only `afterAll`), and afldb_test itself may
 * already hold season-2026 rows this suite never created. A delta survives
 * both.
 *
 * `finals_played` (not played/wins/losses/points_for/points_against) is what
 * a Preliminary Final fixture can move at all: `recomputeClubSeasons()`
 * scopes those other columns to `NOT is_final` rows only
 * (`src/db/queries/player-derived.ts:437,443`), and `finals_played` counts
 * `is_finals_series` rows regardless of final/non-final
 * (`src/db/queries/player-derived.ts:503-509`).
 */
async function clubSeasonSnapshot(clubId: number): Promise<{ finalsPlayed: number; played: number }> {
  const [row] = await sql<{ finalsPlayed: number; played: number }[]>`
    SELECT finals_played AS "finalsPlayed", played
      FROM club_seasons WHERE season = ${SEASON} AND club_id = ${clubId}
  `;
  return { finalsPlayed: row?.finalsPlayed ?? 0, played: row?.played ?? 0 };
}

async function seasonSnapshot(): Promise<{ matchCount: number; lastLoadedRound: string | null }> {
  const [row] = await sql<{ matchCount: number; lastLoadedRound: string | null }[]>`
    SELECT match_count AS "matchCount", last_loaded_round AS "lastLoadedRound"
      FROM seasons WHERE year = ${SEASON}
  `;
  return { matchCount: row?.matchCount ?? 0, lastLoadedRound: row?.lastLoadedRound ?? null };
}

type ClubSeasonFullSnapshot = {
  played: number; wins: number; draws: number; losses: number;
  pointsFor: number; pointsAgainst: number; premiershipPoints: number;
  percentage: number | null; ladderRank: number | null;
};

/**
 * I244-F001 H&A regression. The full `club_seasons` W/L/points/percentage/
 * rank row for one club — everything a home-and-away match can move.
 * `percentage` is `numeric(9,4)` (006:67); postgres.js returns `numeric` as
 * a STRING by default (no custom type parser is registered on this test
 * file's own `sql`), so it is cast to `float8` in the query rather than
 * handed to `Number()` blind.
 */
async function clubSeasonFullSnapshot(clubId: number): Promise<ClubSeasonFullSnapshot> {
  const [row] = await sql<{
    played: number; wins: number; draws: number; losses: number;
    pointsFor: number; pointsAgainst: number; premiershipPoints: number | null;
    percentage: number | null; ladderRank: number | null;
  }[]>`
    SELECT played, wins, draws, losses,
           points_for AS "pointsFor", points_against AS "pointsAgainst",
           premiership_points AS "premiershipPoints",
           percentage::float8 AS percentage,
           ladder_rank AS "ladderRank"
      FROM club_seasons WHERE season = ${SEASON} AND club_id = ${clubId}
  `;
  return {
    played: row?.played ?? 0, wins: row?.wins ?? 0, draws: row?.draws ?? 0, losses: row?.losses ?? 0,
    pointsFor: row?.pointsFor ?? 0, pointsAgainst: row?.pointsAgainst ?? 0,
    premiershipPoints: row?.premiershipPoints ?? 0,
    percentage: row?.percentage ?? null, ladderRank: row?.ladderRank ?? null,
  };
}

/** I244-F001 H&A regression. `seasons` metadata beyond `matchCount`/
 * `lastLoadedRound` (already covered by `seasonSnapshot()`): `date`/`club_count`
 * columns cast to `text`/left as `smallint` respectively, sidestepping any
 * postgres.js `date` <-> JS `Date` timezone ambiguity entirely. */
async function seasonFullSnapshot(): Promise<{
  matchCount: number; clubCount: number; status: string;
  lastMatchDate: string | null; dataThroughDate: string | null; lastLoadedRound: string | null;
}> {
  const [row] = await sql<{
    matchCount: number; clubCount: number; status: string;
    lastMatchDate: string | null; dataThroughDate: string | null; lastLoadedRound: string | null;
  }[]>`
    SELECT match_count AS "matchCount", club_count AS "clubCount", status,
           last_match_date::text AS "lastMatchDate", data_through_date::text AS "dataThroughDate",
           last_loaded_round AS "lastLoadedRound"
      FROM seasons WHERE year = ${SEASON}
  `;
  return {
    matchCount: row?.matchCount ?? 0, clubCount: row?.clubCount ?? 0, status: row?.status ?? '',
    lastMatchDate: row?.lastMatchDate ?? null, dataThroughDate: row?.dataThroughDate ?? null,
    lastLoadedRound: row?.lastLoadedRound ?? null,
  };
}

/**
 * I244-F001 H&A regression — LADDER / RANK, proved as an INDEPENDENT
 * invariant rather than by re-deriving `recomputeClubSeasons()`'s own SQL
 * (`player-derived.ts:464-474`) or hard-coding an expected rank (brittle
 * against whatever else season 2026 already holds in afldb_test). The
 * production `rank() OVER (ORDER BY premiership_points DESC, ratio DESC
 * NULLS LAST)` guarantees that walking `club_seasons` rows for a season in
 * that same order can never see `ladder_rank` decrease from one row to the
 * next (once both are non-null) — a violation proves the persisted ranks are
 * NOT a fresh, correct ranking of the current match set (e.g. stale/frozen
 * from before this run, or a rank never recomputed at all), regardless of
 * what any specific club's number happens to be.
 */
async function ladderRankViolations(): Promise<number> {
  // Orders by the RAW ratio (points_for/points_against), the same
  // unrounded quantity production's own `rank() OVER (... ORDER BY
  // premiership_points DESC, ratio DESC NULLS LAST)` uses
  // (player-derived.ts:459-461,466-468) — never the ROUNDED `percentage`
  // column, so two rows whose stored `percentage` coincidentally ties at 4
  // decimal places but whose raw ratios do not can never be mis-ordered
  // relative to what the recompute itself saw.
  const [row] = await sql<{ violations: number }[]>`
    WITH ordered AS (
      SELECT ladder_rank,
             lag(ladder_rank) OVER (
               ORDER BY premiership_points DESC,
                        (points_for::numeric / NULLIF(points_against, 0)) DESC NULLS LAST
             ) AS "prevRank"
        FROM club_seasons WHERE season = ${SEASON}
    )
    SELECT count(*)::int AS violations FROM ordered
     WHERE "prevRank" IS NOT NULL AND ladder_rank IS NOT NULL AND ladder_rank < "prevRank"
  `;
  return row?.violations ?? 0;
}

/* ------------------------------------------------------------------ *
 * AFLDB-ISSUE-244 I244-F011 — player-grain DERIVED state for this suite's
 * synthetic player: `player_season_stats`, `player_career_stats`,
 * `player_clubs` (all rebuilt by `recomputePlayerDerivedStats()`,
 * `src/db/queries/player-derived.ts`, inside the settle's own transaction).
 * The original review (afldb-issue244.md §5 F011) found that no assertion
 * in this suite read any of the three after an apply, a correction or a
 * replay — only cleanup() referenced `player_clubs`.
 * ------------------------------------------------------------------ */

type PlayerDerivedSnapshot = {
  season: Record<string, unknown> | null;
  career: Record<string, unknown> | null;
  clubs: Record<string, unknown>[];
};

/**
 * I244-F011. The three derived rows for the synthetic player, captured whole
 * via `to_jsonb(row)` for the same reason `canonicalSnapshot()` gives:
 * comparing two snapshots proves the rows were not touched at all on an
 * identical replay, not merely that a hand-picked column still agrees.
 * `to_jsonb` renders `date` columns as ISO `YYYY-MM-DD` text regardless of
 * the session's DateStyle. `player_clubs` has no surrogate id (PK is
 * `(player_id, club_id)`, migration 007), so "row-id stability" is not a
 * contract here; content equality is.
 */
async function playerDerivedSnapshot(): Promise<PlayerDerivedSnapshot> {
  const [season] = await sql<{ row: Record<string, unknown> }[]>`
    SELECT to_jsonb(s) AS row FROM player_season_stats s
     WHERE s.player_id = ${bridgedPlayerId} AND s.season = ${SEASON}
  `;
  const [career] = await sql<{ row: Record<string, unknown> }[]>`
    SELECT to_jsonb(c) AS row FROM player_career_stats c WHERE c.player_id = ${bridgedPlayerId}
  `;
  const clubs = await sql<{ row: Record<string, unknown> }[]>`
    SELECT to_jsonb(pc) AS row FROM player_clubs pc
     WHERE pc.player_id = ${bridgedPlayerId} ORDER BY pc.club_id
  `;
  return { season: season?.row ?? null, career: career?.row ?? null, clubs: clubs.map((r) => r.row) };
}

type PlayerCanonicalTruth = {
  games: number; finals: number; wins: number; draws: number; losses: number;
  goals: number; kicks: number | null; disposals: number | null;
  firstDate: string | null; lastDate: string | null;
  firstMatchId: number | null; lastMatchId: number | null;
  clubIds: number[];
};

/**
 * I244-F011. What the derived rows MUST say, re-derived from raw canonical
 * fact (`player_match_stats` JOIN `matches`) for the synthetic player —
 * independent of the recompute under test, exactly as the F001 cases
 * re-derive `last_loaded_round` from `matches` rather than trusting
 * `recomputeSeasonMetadata()`. A W/L is `matches.result` read against the
 * side the player's stat row is filed under (`player_match_stats.club_id`),
 * the modelling rule `tools/migration/rebuild_derived.py` and the targeted
 * recompute share. Every canonical match this player has is a season-2026
 * match of this suite, so one truth serves the season, career and club
 * grains. Dates are rendered with `to_char(..., 'YYYY-MM-DD')`, never
 * `::text`, so the comparison cannot depend on the session's DateStyle.
 */
async function playerCanonicalTruth(): Promise<PlayerCanonicalTruth> {
  const [row] = await sql<Omit<PlayerCanonicalTruth, 'clubIds'>[]>`
    SELECT count(*)::int AS games,
           count(*) FILTER (WHERE m.is_finals_series)::int AS finals,
           count(*) FILTER (WHERE m.result <> 'draw'
                              AND (m.result = 'home_win') = (m.home_club_id = s.club_id))::int AS wins,
           count(*) FILTER (WHERE m.result = 'draw')::int AS draws,
           count(*) FILTER (WHERE m.result <> 'draw'
                              AND (m.result = 'home_win') <> (m.home_club_id = s.club_id))::int AS losses,
           COALESCE(sum(s.goals), 0)::int AS goals,
           sum(s.kicks)::int AS kicks,
           sum(s.disposals)::int AS disposals,
           to_char(min(m.match_date), 'YYYY-MM-DD') AS "firstDate",
           to_char(max(m.match_date), 'YYYY-MM-DD') AS "lastDate",
           (array_agg(s.match_id ORDER BY m.match_date, s.match_id))[1]::int AS "firstMatchId",
           (array_agg(s.match_id ORDER BY m.match_date DESC, s.match_id DESC))[1]::int AS "lastMatchId"
      FROM player_match_stats s
      JOIN matches m ON m.id = s.match_id
     WHERE s.player_id = ${bridgedPlayerId}
  `;
  const clubs = await sql<{ clubId: number }[]>`
    SELECT DISTINCT club_id::int AS "clubId" FROM player_match_stats
     WHERE player_id = ${bridgedPlayerId} ORDER BY 1
  `;
  return { ...row, clubIds: clubs.map((c) => c.clubId) };
}

/**
 * I244-F011. Asserts that the PERSISTED player-derived rows equal the
 * canonical truth exactly once — the "derived == recomputation from state B,
 * never A + B" contract — and returns both so a case can add its own
 * fixture-specific literals or before/after deltas on top.
 */
async function expectPlayerDerivedMatchesCanonical(): Promise<{
  snapshot: PlayerDerivedSnapshot; truth: PlayerCanonicalTruth;
}> {
  const truth = await playerCanonicalTruth();
  const snapshot = await playerDerivedSnapshot();
  expect(truth.games).toBeGreaterThan(0);
  // The synthetic player is always filed under ONE side (the home roster's
  // Karl Amon, `BRIDGED_PROVIDER_PLAYER_ID`), so the club-grain assertions
  // below can be exact rather than aggregated across clubs.
  expect(truth.clubIds).toHaveLength(1);

  // player_season_stats — one row per (player, season) (migration 015 shape).
  expect(snapshot.season).not.toBeNull();
  const season = snapshot.season as Record<string, unknown>;
  expect(season.games).toBe(truth.games);
  expect(season.finals).toBe(truth.finals);
  expect(season.wins).toBe(truth.wins);
  expect(season.draws).toBe(truth.draws);
  expect(season.losses).toBe(truth.losses);
  expect(season.goals).toBe(truth.goals);
  expect(season.kicks).toBe(truth.kicks);
  expect(season.disposals).toBe(truth.disposals);
  expect(season.club_count).toBe(1);
  expect(season.primary_club_id).toBe(truth.clubIds[0]);
  // "Recorded games" semantics (007/015): the AFL API writes `disposals` on
  // every row it applies, so every game counts as recorded — a 0 here with
  // games > 0 would mean the settle wrote NULLs (cf. the silent-NULL defect
  // `aflApiPlayerStatValues()`'s own comment describes).
  expect(season.disposals_recorded_games).toBe(truth.games);

  // player_career_stats — the synthetic player exists only in season 2026,
  // so career == season for every playing count, and the span is one season.
  expect(snapshot.career).not.toBeNull();
  const career = snapshot.career as Record<string, unknown>;
  expect(career.games).toBe(truth.games);
  expect(career.finals).toBe(truth.finals);
  expect(career.wins).toBe(truth.wins);
  expect(career.draws).toBe(truth.draws);
  expect(career.losses).toBe(truth.losses);
  expect(career.goals).toBe(truth.goals);
  expect(career.kicks).toBe(truth.kicks);
  expect(career.disposals).toBe(truth.disposals);
  expect(career.clubs_played).toBe(1);
  expect(career.seasons_played).toBe(1);
  expect(career.debut_season).toBe(SEASON);
  expect(career.final_season).toBe(SEASON);
  expect(career.debut_date).toBe(truth.firstDate);
  expect(career.last_match_date).toBe(truth.lastDate);

  // player_clubs — one row per (player, club): membership, span and the
  // first/last match pointers derived from canonical truth.
  expect(snapshot.clubs).toHaveLength(1);
  const club = snapshot.clubs[0];
  expect(club.club_id).toBe(truth.clubIds[0]);
  expect(club.games).toBe(truth.games);
  expect(club.goals).toBe(truth.goals);
  expect(club.first_season).toBe(SEASON);
  expect(club.last_season).toBe(SEASON);
  expect(club.first_match_id).toBe(truth.firstMatchId);
  expect(club.last_match_id).toBe(truth.lastMatchId);

  return { snapshot, truth };
}

/**
 * I244-F008. One batch row as an operator would read it, with the number of
 * `import_rejections` rows actually persisted for it, so a case can prove the
 * two agree rather than trusting either alone. `bigint` columns are cast to
 * `int` in the query (postgres.js would otherwise hand back decimal text).
 */
async function importBatchRow(batchId: string): Promise<{
  status: string; completed: boolean; completedAfterStart: boolean;
  recordsRead: number; recordsInserted: number; recordsUpdated: number; recordsRejected: number;
  rejectionRows: number; validationResult: unknown;
}> {
  const [row] = await sql<{
    status: string; completed: boolean; completedAfterStart: boolean;
    recordsRead: number; recordsInserted: number; recordsUpdated: number; recordsRejected: number;
    rejectionRows: number; validationResult: unknown;
  }[]>`
    SELECT b.status::text AS status,
           (b.completed_at IS NOT NULL) AS completed,
           (b.completed_at >= b.started_at) AS "completedAfterStart",
           b.records_read::int AS "recordsRead",
           b.records_inserted::int AS "recordsInserted",
           b.records_updated::int AS "recordsUpdated",
           b.records_rejected::int AS "recordsRejected",
           (SELECT count(*)::int FROM import_rejections r WHERE r.import_batch_id = b.id) AS "rejectionRows",
           b.validation_result AS "validationResult"
      FROM import_batches b
     WHERE b.id = ${batchId}::bigint
  `;
  if (!row) throw new Error(`import_batches row ${batchId} does not exist.`);
  return row;
}

/** I244-F008. How many batches the settle opened under one snapshot label (labels are per-attempt). */
async function batchesLabelled(label: string): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM import_batches
     WHERE source_id = ${aflApiSourceId} AND tool = ${SETTLE_BATCH_TOOL}
       AND notes LIKE ${`%snapshot=${label};%`}
  `;
  return row.count;
}

/**
 * I244-F008. Wraps a real connection so the ONE statement that finalises the
 * batch (`UPDATE import_batches`) fails inside the settle's own transaction,
 * while every other statement — the whole real write path — runs against the
 * real database. A test-side wrapper only: production carries no failure hook.
 * Nested `savepoint()` handles are deliberately not wrapped; the finalising
 * UPDATE is issued on the transaction handle itself.
 */
function sqlFailingOnBatchFinalisation(real: postgres.Sql): postgres.Sql {
  const wrapTransaction = (tx: postgres.TransactionSql): postgres.TransactionSql => new Proxy(tx, {
    apply(target, thisArg, args: unknown[]) {
      const strings = args[0];
      if (Array.isArray(strings) && strings.join('?').includes('UPDATE import_batches')) {
        throw new Error('injected batch finalisation failure');
      }
      return Reflect.apply(target, thisArg, args);
    },
  });
  return new Proxy(real, {
    get(target, property) {
      if (property === 'begin') {
        return (callback: (tx: postgres.TransactionSql) => unknown) =>
          target.begin((tx) => callback(wrapTransaction(tx)) as never);
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as postgres.Sql;
}

/* ------------------------------------------------------------------ *
 * Cases
 * ------------------------------------------------------------------ */

describe('AFLDB-ISSUE-228 S6 — settle-afl-api.ts against afldb_test', () => {
  it('§19: a new CONCLUDED match auto-applies match, period scores and the bridged player; the unbridged player is refused without blocking it', async () => {
    const bundle = buildBundle(
      [unitSourceFor(CASE_IDS.golden)], registry, identities,
    );
    const result = await runSettleAflApi(sql, {
      bundle, registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    });

    expect(result.halt).toBeNull();
    expect(result.applied).toBe(true);
    // `applied` alone proves almost nothing about the canonical write. A
    // per-unit constraint failure is ABSORBED by applyCanonicalUnit() (§9.1:
    // one bad match never stops the run) and an authority refusal routes the
    // proposal to promotion_candidates instead — BOTH leave `applied === true`
    // with a committed batch and nothing canonical written, and the only trace
    // of either is a counter. Asserting them here is what turns "the writer
    // silently wrote nothing" from a puzzle into a named failure.
    expect(result.counters.canonicalApplyFailures).toBe(0);
    expect(result.counters.manualAuthorityRefusals).toBe(0);
    expect(result.counters.canonicalRowsInserted).toBeGreaterThan(0);
    expect(result.counters.unresolvedIdentityPlayer).toBe(1);
    // I244-F003 (§11.1, mapped provider venue): a genuinely mapped provider
    // CD_V (CD_V40 -> M.C.G., the real afl-api-identities.json entry) must
    // never be counted as unresolved, by either counter.
    expect(result.counters.venueProviderUnmapped).toBe(0);
    expect(result.counters.venueUnmapped).toBe(0);

    const [match] = await sql<{
      id: number; sourceId: number; homeScore: number; awayScore: number;
      attendance: number | null; attendanceStatus: string; venueId: number | null; venueRaw: string;
    }[]>`
      SELECT id, source_id AS "sourceId", home_score AS "homeScore", away_score AS "awayScore",
             attendance, attendance_status AS "attendanceStatus", venue_id AS "venueId", venue_raw AS "venueRaw"
        FROM matches WHERE match_key = ${matchKeyFor(CASE_IDS.golden)}
    `;
    expect(match).toBeDefined();
    expect(match.sourceId).toBe(aflApiSourceId);
    expect(match.homeScore).toBe(122);
    expect(match.awayScore).toBe(131);
    expect(match.attendance).toBeNull();
    expect(match.attendanceStatus).toBe('not_collected');
    // I244-F003 (§11.1): the mapped venue lands as venue_id, and venue_raw
    // still carries the provider's own display name.
    expect(match.venueId).toBe(venueId);
    expect(match.venueRaw).toBe('MCG');

    const periods = await sql<{ period: number; points: number }[]>`
      SELECT period, points FROM match_period_scores WHERE match_id = ${match.id} AND club_id = ${homeClubId} ORDER BY period
    `;
    expect(periods.map((p) => p.points)).toEqual([31, 67, 77, 122]);

    const [playerRow] = await sql<{ kicks: number; contestedMarks: number }[]>`
      SELECT kicks, contested_marks AS "contestedMarks" FROM player_match_stats
       WHERE match_id = ${match.id} AND player_id = ${bridgedPlayerId}
    `;
    expect(playerRow).toBeDefined();
    expect(playerRow.kicks).toBe(9);

    // I244-F011: the player-grain DERIVED tables were rebuilt inside this
    // same committed run (F001's recompute block) and reflect this match.
    // This is the first case in file order and beforeAll()'s cleanup()
    // removed every earlier row (the synthetic player is deleted and
    // re-created by legacy id, cascading player_season_stats/
    // player_career_stats), so the player's canonical truth at this point is
    // exactly this one match: a Preliminary Final the home side — the
    // player's side — LOST 122-131, with the fixture's 9 kicks.
    const { snapshot: derived, truth } = await expectPlayerDerivedMatchesCanonical();
    expect(truth.games).toBe(1);
    expect(derived.season?.games).toBe(1);
    expect(derived.season?.finals).toBe(1);
    expect(derived.season?.wins).toBe(0);
    expect(derived.season?.losses).toBe(1);
    expect(derived.season?.kicks).toBe(9);
    expect(derived.season?.primary_club_id).toBe(homeClubId);
    expect(derived.career?.games).toBe(1);
    expect(derived.career?.debut_date).toBe(matchDateFor(CASE_IDS.golden));
    expect(derived.clubs[0]?.club_id).toBe(homeClubId);
    expect(derived.clubs[0]?.first_match_id).toBe(match.id);
    expect(derived.clubs[0]?.last_match_id).toBe(match.id);

    const [rejection] = await sql<{ reason: string }[]>`
      SELECT reason FROM import_rejections
       WHERE source_record_id = ${`${CASE_IDS.golden}|CD_T20|${UNBRIDGED_PROVIDER_PLAYER_ID}`}
    `;
    expect(rejection?.reason).toContain('unresolved_identity');
  });

  it('§19: an identical rerun is idempotent — no new canonical writes', async () => {
    const source = unitSourceFor(CASE_IDS.rerun);
    const first = await runSettleAflApi(sql, {
      bundle: buildBundle([source], registry, identities),
      registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    });
    expect(first.applied).toBe(true);
    expect(first.counters.canonicalApplyFailures).toBe(0);
    expect(first.counters.manualAuthorityRefusals).toBe(0);
    expect(first.counters.canonicalRowsInserted).toBeGreaterThan(0);

    const matchKey = matchKeyFor(CASE_IDS.rerun);
    const before = await canonicalSnapshot(matchKey, CASE_IDS.rerun);
    expect(before.match).not.toBeNull();
    expect(before.playerStats).toHaveLength(1);
    // The derived layer owns this column and has already filled it in, inside
    // the first run's own transaction (recomputePlayerDerivedStats()). The
    // settle proposes NULL for it and must never write that back — which is
    // exactly what the equality below now proves. Asserted as "not null"
    // rather than as a literal, because the recompute numbers a player's
    // matches by date across every case in this suite.
    expect(before.playerStats[0].career_game_no).not.toBeNull();
    // I244-F011: the derived rows the first run rebuilt agree with canonical
    // truth, and are captured whole for the replay comparison below.
    const derivedBefore = (await expectPlayerDerivedMatchesCanonical()).snapshot;

    const second = await runSettleAflApi(sql, {
      bundle: buildBundle([unitSourceFor(CASE_IDS.rerun)], registry, identities),
      registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    });
    expect(second.applied).toBe(true);
    expect(second.counters.canonicalRowsInserted).toBe(0);
    expect(second.counters.canonicalRowsUpdated).toBe(0);
    expect(second.counters.canonicalApplyFailures).toBe(0);
    expect(second.counters.canonicalApplicationsLogged).toBe(0);
    // I244-F001: the no-op replay must not re-run the derived recompute
    // block either — this is the assertion that fails closed if the write
    // gate (`counters.canonicalRowsInserted + counters.canonicalRowsUpdated
    // > 0`) ever regresses back to the old `derived.playerIds.size > 0 ||
    // derived.matchIds.size > 0` condition, which was true on every
    // corroborated/no-op match regardless of whether anything was written
    // (I244-F012). `canonicalRowsInserted`/`canonicalRowsUpdated` being 0
    // above is necessary but not sufficient proof of that on its own — the
    // recompute is a separate call gated on the same counters, not inferred
    // from them.
    expect(second.counters.derivedRecomputeRuns).toBe(0);

    // The real contract: the canonical rows themselves are untouched —
    // matches, its period-score set and its player_match_stats row, every
    // column of each, plus no new ledger row and no duplicate candidate.
    const after = await canonicalSnapshot(matchKey, CASE_IDS.rerun);
    expect(after).toEqual(before);

    // I244-F011 / I244-F012: with derivedRecomputeRuns 0 above, the
    // player-grain derived rows must be byte-identical too — no
    // DELETE/INSERT churn on player_season_stats / player_career_stats /
    // player_clubs from a no-op replay, and no accumulation.
    expect(await playerDerivedSnapshot()).toEqual(derivedBefore);

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM matches WHERE match_key = ${matchKey}
    `;
    expect(count).toBe('1');
  });

  it('§14: a provider-id hit whose season/clubs contradict the incoming record HALTs the whole run', async () => {
    const providerId = CASE_IDS.contradiction;
    const first = await runSettleAflApi(sql, {
      bundle: buildBundle([unitSourceFor(providerId)], registry, identities),
      registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    });
    expect(first.applied).toBe(true);
    // The HALT under test is only reachable if this first run actually created
    // the canonical row AND stamped it with this provider id: step 1 of §6.1
    // looks the contradiction up by (source_id, source_record_id), which
    // `provenance()` writes in canonical-apply.ts. A first run that wrote
    // nothing leaves nothing to contradict, and the second run below would
    // then resolve as an ordinary new match with `halt === null` — passing
    // through the very gate this case exists to prove.
    expect(first.counters.canonicalRowsInserted).toBeGreaterThan(0);
    const batchesBefore = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM import_batches`;

    // Same provider id, now claiming a different away club — a genuine
    // provider-identity contradiction against the row this run just created.
    const contradicting = unitSourceFor(providerId, ({ fixture, stats }) => {
      fixture.away.team.providerId = 'CD_T10'; // Adelaide, not Brisbane Lions
      fixture.away.team.name = 'Adelaide Crows';
      for (const row of stats.awayTeamPlayerStats) row.teamId = 'CD_T10';
    });
    const second = await runSettleAflApi(sql, {
      bundle: buildBundle([contradicting], registry, identities),
      registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    });

    expect(second.halt).not.toBeNull();
    expect(second.halt?.reason).toBe('provider_identity_contradiction');
    expect(second.applied).toBe(false);
    expect(second.batchId).toBeNull();

    const batchesAfter = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM import_batches`;
    expect(batchesAfter[0].count).toBe(batchesBefore[0].count); // the HALTed run's own batch row did not survive
  });

  it('§19.1: an afltables-owned match observed by afl_api with agreeing scores is corroborated, not written, ownership unchanged', async () => {
    const providerId = CASE_IDS.corroborateAgree;
    const matchKey = matchKeyFor(providerId);
    const [ownedMatch] = await sql<{ id: number }[]>`
      INSERT INTO matches (
        match_key, season, round_code, round_number, round_type, is_final,
        match_date, venue_id, venue_raw, home_club_id, away_club_id,
        home_goals, home_behinds, home_score, away_goals, away_behinds, away_score,
        result, winner_club_id, margin,
        attendance, attendance_status, attendance_source_id,
        source_id, source_record_id
      ) VALUES (
        -- matches_round_number_ck (003) requires round_number NULL for every
        -- round_type other than 'home_and_away' — a finals round_number is
        -- carried in round_code alone. staging.afltables_match has no such
        -- constraint (076), which is why the equivalent fixture row for the
        -- §19.2 enrichment case below is free to set round_number = 28.
        ${matchKey}, ${SEASON}, 'PF', ${null}, 'preliminary_final', true,
        ${matchDateFor(providerId)}, ${venueId}, 'MCG', ${homeClubId}, ${awayClubId},
        19, 8, 122, 20, 11, 131,
        'away_win', ${awayClubId}, 9,
        NULL, 'not_collected', NULL,
        ${afltablesSourceId}, ${providerId}
      ) RETURNING id
    `;

    const result = await runSettleAflApi(sql, {
      bundle: buildBundle([unitSourceFor(providerId)], registry, identities),
      registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    });

    expect(result.halt).toBeNull();
    expect(result.counters.corroboratedForeignOwned).toBe(1);
    expect(result.counters.canonicalApplyRefusals).toBe(0);

    const [after] = await sql<{ sourceId: number; homeScore: number }[]>`
      SELECT source_id AS "sourceId", home_score AS "homeScore" FROM matches WHERE id = ${ownedMatch.id}
    `;
    expect(after.sourceId).toBe(afltablesSourceId); // never re-owned
    expect(after.homeScore).toBe(122); // never touched

    // AFLDB-ISSUE-244 I244-F006 — the typed-projection contract: a corroborated
    // foreign-owned match is observed and counted but gets NO
    // `staging.afl_api_match` row (that table holds PLANNED matches only), so
    // Brownlow can identify it only via `--use-fixture-identity`.
    const [typed] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM staging.afl_api_match WHERE external_record_id = ${providerId}
    `;
    expect(typed.n).toBe(0);
  });

  it('§19.2: AFL Tables attendance enriches an afl_api-owned match without changing its ownership', async () => {
    const providerId = CASE_IDS.enrichment;
    const matchKey = matchKeyFor(providerId);

    const first = await runSettleAflApi(sql, {
      bundle: buildBundle([unitSourceFor(providerId)], registry, identities),
      registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    });
    expect(first.applied).toBe(true);
    const [owned] = await sql<{ id: number; sourceId: number }[]>`
      SELECT id, source_id AS "sourceId" FROM matches WHERE match_key = ${matchKey}
    `;
    expect(owned.sourceId).toBe(aflApiSourceId);

    const [batch] = await sql<{ id: string }[]>`
      INSERT INTO import_batches (source_id, tool, target_table, records_read, notes)
      VALUES (${afltablesSourceId}, 'settle-afltables.ts', 'staging.source_record_versions', 1, 'issue228-enrichment-fixture')
      RETURNING id
    `;
    // Insert order matches the real FK chain (074): source_payloads has no
    // dependency and must exist first; source_record_versions references it
    // (source_id, family, payload_hash) and import_batches (opened_by_batch_id);
    // source_records references source_record_versions
    // (source_id, family, external_record_id, current_version_seq) last. The
    // original draft inserted source_records first, which would have failed
    // closed with a foreign-key violation against a version row that did not
    // exist yet — caught here before it could ship.
    //
    // THE SPINE ROWS ARE KEYED BY match_key, NOT BY THE PROVIDER MATCH ID.
    // These stand in for AFL TABLES' own observation, and that source's
    // `match` family is keyed by `season|round_code|match_date|home name|away
    // name` (import_fitzroy_core.py:1260-1263) — the same string
    // renderMatchKey() produces. It matters because
    // applyAttendanceEnrichment() writes its canonical_applications row with
    // `external_record_id = matchKey` and `source_id = <afltables>`, and that
    // ledger row's FK resolves against exactly these version rows. Keying the
    // fixture by the afl_api provider id (as an earlier draft did) leaves the
    // FK unsatisfiable, so the enrichment throws instead of applying — a
    // failure the grain-uniqueness violation upstream was masking.
    await sql`
      INSERT INTO staging.source_payloads (source_id, family, payload_hash, hash_recipe, raw_payload, first_stored_at)
      VALUES (${afltablesSourceId}, 'match', repeat('a', 64), 'sha256/v1(fixture)', '{}'::jsonb, now())
    `;
    await sql`
      INSERT INTO staging.source_record_versions (source_id, family, external_record_id, version_seq, payload_hash, source_updated_at, observed_from, opened_by_batch_id)
      VALUES (${afltablesSourceId}, 'match', ${matchKey}, 1, repeat('a', 64), now(), now(), ${batch.id})
    `;
    await sql`
      INSERT INTO staging.source_records (source_id, family, external_record_id, scope_key, current_version_seq, current_payload_hash, first_seen_at, last_seen_at, last_batch_id)
      VALUES (${afltablesSourceId}, 'match', ${matchKey}, ${`season=${SEASON}`}, 1, repeat('a', 64), now(), now(), ${batch.id})
    `;
    // staging.afltables_match (migration 076) carries NO match_key column —
    // its grain is (source_id, family, external_record_id). The sweep in
    // settle-afl-api.ts correlates this row to a canonical match_key by
    // RENDERING one from season/round_code/match_date/home_club_id/away_club_id
    // (renderMatchKey(), the same computation §6.1 step 2 uses) — so this
    // fixture's values must render the SAME match_key as the canonical row
    // under test: season/round_code/match_date/home+away club ids below match
    // `matchKeyFor(providerId)` exactly.
    await sql`
      INSERT INTO staging.afltables_match (
        source_id, family, external_record_id, version_seq, season,
        round_code, round_number, round_type, is_final, match_date,
        venue_raw, home_club_id, away_club_id,
        home_goals, home_behinds, home_score, away_goals, away_behinds, away_score,
        result, winner_club_id, margin, attendance, attendance_status, attendance_source_id,
        projected_by_batch_id
      ) VALUES (
        ${afltablesSourceId}, 'match', ${matchKey}, 1, ${SEASON},
        'PF', 28, 'preliminary_final', true, ${matchDateFor(providerId)},
        'MCG', ${homeClubId}, ${awayClubId},
        19, 8, 122, 20, 11, 131,
        'away_win', ${awayClubId}, 9, 45123, 'complete', ${afltablesSourceId},
        ${batch.id}
      )
    `;

    const second = await runSettleAflApi(sql, {
      bundle: buildBundle([unitSourceFor(providerId)], registry, identities),
      registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    });
    expect(second.halt).toBeNull();
    expect(second.counters.attendanceEnrichmentsApplied).toBe(1);

    const [enriched] = await sql<{
      sourceId: number; attendance: number | null; attendanceSourceId: number | null;
    }[]>`
      SELECT source_id AS "sourceId", attendance, attendance_source_id AS "attendanceSourceId"
        FROM matches WHERE id = ${owned.id}
    `;
    expect(enriched.sourceId).toBe(aflApiSourceId); // still afl_api-owned
    expect(enriched.attendance).toBe(45123);
    expect(enriched.attendanceSourceId).toBe(afltablesSourceId);
  });

  /* ---------------------------------------------------------------- *
   * AFLDB-ISSUE-244 I244-F001 — season/club derived data
   * ---------------------------------------------------------------- */

  it('I244-F001: a new afl_api-owned final updates club_seasons.finals_played and seasons metadata, gated on the write', async () => {
    const beforeHome = await clubSeasonSnapshot(homeClubId);
    const beforeAway = await clubSeasonSnapshot(awayClubId);
    const beforeSeason = await seasonSnapshot();

    const providerId = CASE_IDS.derivedNewFinal;
    const result = await runSettleAflApi(sql, {
      bundle: buildBundle([unitSourceFor(providerId)], registry, identities),
      registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    });

    expect(result.applied).toBe(true);
    expect(result.counters.canonicalApplyFailures).toBe(0);
    expect(result.counters.canonicalRowsInserted).toBeGreaterThan(0);
    // The write-gating requirement itself: a run that actually wrote a
    // canonical row must run the derived recompute block once.
    expect(result.counters.derivedRecomputeRuns).toBe(1);
    expect(result.counters.derivedRecomputePlayers).toBeGreaterThan(0);

    const afterHome = await clubSeasonSnapshot(homeClubId);
    const afterAway = await clubSeasonSnapshot(awayClubId);
    const afterSeason = await seasonSnapshot();

    expect(afterHome.finalsPlayed).toBe(beforeHome.finalsPlayed + 1);
    expect(afterAway.finalsPlayed).toBe(beforeAway.finalsPlayed + 1);
    // A Preliminary Final never touches these (recomputeClubSeasons scopes
    // them to NOT is_final rows) — proves the recompute ran the RIGHT
    // query, not merely that club_seasons rows now exist.
    expect(afterHome.played).toBe(beforeHome.played);
    expect(afterAway.played).toBe(beforeAway.played);

    expect(afterSeason.matchCount).toBe(beforeSeason.matchCount + 1);
    // I244-F001 hardening: assert against the actual latest canonical
    // match's own round_code (an independent read of `matches`, the same
    // "latest by match_date, tie-broken by id" ordering
    // `recomputeSeasonMetadata()` itself uses, `player-derived.ts:546-552`)
    // rather than hard-coding 'PF'. A hard-coded literal happened to hold
    // only because every fixture this suite builds is a Preliminary Final
    // and no case dated later than this one had run yet at this point in
    // file order — it would break the moment afldb_test carries a genuine
    // 2026 match (or a later-running HA case) dated after this one with a
    // different round_code. This does not duplicate
    // `recomputeSeasonMetadata()`'s SQL: it re-derives the EXPECTED value
    // from raw canonical fact, independent of the recompute under test,
    // exactly as `ladderRankViolations()` above proves the ladder without
    // re-deriving `recomputeClubSeasons()`'s own query.
    const [latest] = await sql<{ roundCode: string }[]>`
      SELECT round_code AS "roundCode" FROM matches
       WHERE season = ${SEASON}
       ORDER BY match_date DESC, id DESC
       LIMIT 1
    `;
    expect(afterSeason.lastLoadedRound).toBe(latest?.roundCode ?? null);
  });

  it('I244-F001: a score correction to an afl_api-owned final recomputes club_seasons/seasons rather than accumulating them', async () => {
    const providerId = CASE_IDS.derivedCorrection;
    const matchKey = matchKeyFor(providerId);

    const first = await runSettleAflApi(sql, {
      bundle: buildBundle([unitSourceFor(providerId)], registry, identities),
      registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    });
    expect(first.applied).toBe(true);
    expect(first.counters.canonicalRowsInserted).toBeGreaterThan(0);
    expect(first.counters.derivedRecomputeRuns).toBe(1);

    const [beforeMatch] = await sql<{ homeScore: number; result: string }[]>`
      SELECT home_score AS "homeScore", result FROM matches WHERE match_key = ${matchKey}
    `;
    expect(beforeMatch.homeScore).toBe(122);
    expect(beforeMatch.result).toBe('away_win');
    const homeAfterFirst = await clubSeasonSnapshot(homeClubId);
    const seasonAfterFirst = await seasonSnapshot();

    // A genuine correction: same provider match, a higher home score that
    // flips the winner (122 -> 150 beats away's 131; 23/12 goals/behinds kept
    // arithmetically consistent with the new total for realism, though
    // `emitAflApiMatch()` reads goals/behinds/totalScore as three independent
    // fields with no cross-check between them, `afl-api-bundle.ts:363-368`).
    const corrected = unitSourceFor(providerId, ({ fixture }) => {
      fixture.home.score = { goals: 23, behinds: 12, totalScore: 150, superGoals: 0 };
    });
    const second = await runSettleAflApi(sql, {
      bundle: buildBundle([corrected], registry, identities),
      registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    });
    expect(second.applied).toBe(true);
    expect(second.counters.canonicalApplyFailures).toBe(0);
    expect(second.counters.canonicalRowsInserted).toBe(0);
    expect(second.counters.canonicalRowsUpdated).toBeGreaterThan(0);
    // I244-F001's write-gating requirement applies identically to a
    // correction, not only to a first insert.
    expect(second.counters.derivedRecomputeRuns).toBe(1);

    const [afterMatch] = await sql<{ homeScore: number; result: string }[]>`
      SELECT home_score AS "homeScore", result FROM matches WHERE match_key = ${matchKey}
    `;
    expect(afterMatch.homeScore).toBe(150);
    expect(afterMatch.result).toBe('home_win'); // the correction flips the winner

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM matches WHERE match_key = ${matchKey}
    `;
    expect(count).toBe('1'); // UPDATEd in place, never a second row

    const homeAfterSecond = await clubSeasonSnapshot(homeClubId);
    const seasonAfterSecond = await seasonSnapshot();
    // The match's IDENTITY (a Preliminary Final) is unchanged by a score
    // correction, so a REBUILD from canonical truth must land on exactly the
    // same finals_played/match_count as after the first run — proving
    // recomputation, not a second increment stacked on top of the first.
    expect(homeAfterSecond.finalsPlayed).toBe(homeAfterFirst.finalsPlayed);
    expect(seasonAfterSecond.matchCount).toBe(seasonAfterFirst.matchCount);
  });

  /* ---------------------------------------------------------------- *
   * AFLDB-ISSUE-244 I244-F001 — genuine H&A ingestion (§32 acceptance)
   * ---------------------------------------------------------------- */

  it('I244-F001: a genuinely new afl_api-owned H&A match updates club_seasons W/L/points/percentage/ladder and seasons metadata', async () => {
    const providerId = HA_INSERT_ID;
    const matchKey = haMatchKeyFor(providerId);

    const beforeHome = await clubSeasonFullSnapshot(homeClubId);
    const beforeAway = await clubSeasonFullSnapshot(awayClubId);
    const beforeSeason = await seasonFullSnapshot();

    const result = await runSettleAflApi(sql, {
      bundle: buildBundle([unitSourceFor(providerId, toHomeAndAwayRound)], registry, identities),
      registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    });

    expect(result.halt).toBeNull();
    expect(result.applied).toBe(true);
    expect(result.counters.canonicalApplyFailures).toBe(0);
    expect(result.counters.manualAuthorityRefusals).toBe(0);
    expect(result.counters.canonicalRowsInserted).toBeGreaterThan(0);
    expect(result.counters.derivedRecomputeRuns).toBe(1);

    // CANONICAL MATCH — genuinely new, afl_api-owned, a real H&A round, and
    // the expected score/result: this is what "new_target / afl_api-owned"
    // means checked against the row itself, not merely the counters.
    const [match] = await sql<{
      sourceId: number; roundType: string; isFinal: boolean;
      homeScore: number; awayScore: number; result: string;
    }[]>`
      SELECT source_id AS "sourceId", round_type AS "roundType", is_final AS "isFinal",
             home_score AS "homeScore", away_score AS "awayScore", result
        FROM matches WHERE match_key = ${matchKey}
    `;
    expect(match).toBeDefined();
    expect(match.sourceId).toBe(aflApiSourceId);
    expect(match.roundType).toBe('home_and_away');
    expect(match.isFinal).toBe(false);
    expect(match.homeScore).toBe(122);
    expect(match.awayScore).toBe(131);
    expect(match.result).toBe('away_win');

    const afterHome = await clubSeasonFullSnapshot(homeClubId);
    const afterAway = await clubSeasonFullSnapshot(awayClubId);
    const afterSeason = await seasonFullSnapshot();

    // CLUB_SEASONS — HOME CLUB (Hawthorn, lost 122-131).
    expect(afterHome.played).toBe(beforeHome.played + 1);
    expect(afterHome.wins).toBe(beforeHome.wins);
    expect(afterHome.draws).toBe(beforeHome.draws);
    expect(afterHome.losses).toBe(beforeHome.losses + 1);
    expect(afterHome.pointsFor).toBe(beforeHome.pointsFor + 122);
    expect(afterHome.pointsAgainst).toBe(beforeHome.pointsAgainst + 131);
    expect(afterHome.premiershipPoints).toBe(beforeHome.premiershipPoints); // +0, a loss

    // CLUB_SEASONS — AWAY CLUB (Brisbane Lions, won 131-122).
    expect(afterAway.played).toBe(beforeAway.played + 1);
    expect(afterAway.wins).toBe(beforeAway.wins + 1);
    expect(afterAway.draws).toBe(beforeAway.draws);
    expect(afterAway.losses).toBe(beforeAway.losses);
    expect(afterAway.pointsFor).toBe(beforeAway.pointsFor + 131);
    expect(afterAway.pointsAgainst).toBe(beforeAway.pointsAgainst + 122);
    expect(afterAway.premiershipPoints).toBe(beforeAway.premiershipPoints + 4); // the 4/2/0 rule, a win

    // PERCENTAGE — an independent check that the persisted value is the
    // canonical formula (player-derived.ts:459-461,480:
    // round(points_for / points_against * 100, 4)) applied to the SAME row's
    // own persisted points, not a value carried over from a stale run.
    expect(afterHome.pointsAgainst).toBeGreaterThan(0);
    expect(afterAway.pointsAgainst).toBeGreaterThan(0);
    expect(afterHome.percentage).not.toBeNull();
    expect(afterAway.percentage).not.toBeNull();
    expect(afterHome.percentage as number)
      .toBeCloseTo((afterHome.pointsFor / afterHome.pointsAgainst) * 100, 3);
    expect(afterAway.percentage as number)
      .toBeCloseTo((afterAway.pointsFor / afterAway.pointsAgainst) * 100, 3);

    // LADDER / RANK — proved as an invariant (see ladderRankViolations()'s
    // own doc comment), not a hard-coded expected rank.
    expect(await ladderRankViolations()).toBe(0);

    // SEASONS.
    expect(afterSeason.matchCount).toBe(beforeSeason.matchCount + 1);
    expect(afterSeason.clubCount).toBe(beforeSeason.clubCount); // same two clubs, not a new one
    expect(afterSeason.status).toBe(beforeSeason.status); // unaffected by one more in-progress match
    // This case's date (2026-10-01) is later than every other date this
    // suite ever writes for season 2026 (CASE_DATES's own comment), so it
    // becomes the new last/data-through match and round.
    expect(afterSeason.lastMatchDate).toBe('2026-10-01');
    expect(afterSeason.dataThroughDate).toBe('2026-10-01');
    expect(afterSeason.lastLoadedRound).toBe(HA_ROUND_CODE);
  });

  it('I244-F001: an H&A score correction that flips home_win to away_win replaces club_seasons W/L/points/percentage rather than accumulating them', async () => {
    const providerId = HA_CORRECTION_ID;
    const matchKey = haMatchKeyFor(providerId);

    const beforeFirstHome = await clubSeasonFullSnapshot(homeClubId);
    const beforeFirstAway = await clubSeasonFullSnapshot(awayClubId);
    // I244-F011: the synthetic player is filed under the HOME side, so this
    // case's home win -> away win correction is, at the player grain, a W
    // that must become an L — replaced, never both counted.
    const playerBeforeFirst = await playerDerivedSnapshot();
    const winsBeforeFirst = (playerBeforeFirst.season?.wins as number | undefined) ?? 0;
    const lossesBeforeFirst = (playerBeforeFirst.season?.losses as number | undefined) ?? 0;
    const gamesBeforeFirst = (playerBeforeFirst.season?.games as number | undefined) ?? 0;

    // First: a genuine home win, 140-100.
    const first = await runSettleAflApi(sql, {
      bundle: buildBundle([unitSourceFor(providerId, (raw) => {
        toHomeAndAwayRound(raw);
        raw.fixture.home.score = { goals: 21, behinds: 14, totalScore: 140, superGoals: 0 };
        raw.fixture.away.score = { goals: 15, behinds: 10, totalScore: 100, superGoals: 0 };
      })], registry, identities),
      registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    });
    expect(first.applied).toBe(true);
    expect(first.counters.canonicalApplyFailures).toBe(0);
    expect(first.counters.canonicalRowsInserted).toBeGreaterThan(0);
    expect(first.counters.derivedRecomputeRuns).toBe(1);

    const [afterFirstMatch] = await sql<{ homeScore: number; awayScore: number; result: string }[]>`
      SELECT home_score AS "homeScore", away_score AS "awayScore", result
        FROM matches WHERE match_key = ${matchKey}
    `;
    expect(afterFirstMatch.homeScore).toBe(140);
    expect(afterFirstMatch.awayScore).toBe(100);
    expect(afterFirstMatch.result).toBe('home_win');

    const afterFirstHome = await clubSeasonFullSnapshot(homeClubId);
    const afterFirstAway = await clubSeasonFullSnapshot(awayClubId);
    expect(afterFirstHome.played).toBe(beforeFirstHome.played + 1);
    expect(afterFirstHome.wins).toBe(beforeFirstHome.wins + 1);
    expect(afterFirstHome.losses).toBe(beforeFirstHome.losses);
    expect(afterFirstHome.pointsFor).toBe(beforeFirstHome.pointsFor + 140);
    expect(afterFirstHome.pointsAgainst).toBe(beforeFirstHome.pointsAgainst + 100);
    expect(afterFirstHome.premiershipPoints).toBe(beforeFirstHome.premiershipPoints + 4);
    expect(afterFirstAway.played).toBe(beforeFirstAway.played + 1);
    expect(afterFirstAway.wins).toBe(beforeFirstAway.wins);
    expect(afterFirstAway.losses).toBe(beforeFirstAway.losses + 1);
    expect(afterFirstAway.pointsFor).toBe(beforeFirstAway.pointsFor + 100);
    expect(afterFirstAway.pointsAgainst).toBe(beforeFirstAway.pointsAgainst + 140);
    expect(afterFirstAway.premiershipPoints).toBe(beforeFirstAway.premiershipPoints);
    const seasonAfterFirst = await seasonFullSnapshot();

    // I244-F011 (player grain, after the home win): derived == canonical
    // truth, and the delta this run produced is exactly one game, one win.
    const playerAfterFirst = (await expectPlayerDerivedMatchesCanonical()).snapshot;
    expect(playerAfterFirst.season?.games).toBe(gamesBeforeFirst + 1);
    expect(playerAfterFirst.season?.wins).toBe(winsBeforeFirst + 1);
    expect(playerAfterFirst.season?.losses).toBe(lossesBeforeFirst);

    // Second: the SAME match, corrected to an away win, 90-140 — the exact
    // "home win -> away win" scenario §32/this brief's continuation asks
    // for, at the club-season grain.
    const second = await runSettleAflApi(sql, {
      bundle: buildBundle([unitSourceFor(providerId, (raw) => {
        toHomeAndAwayRound(raw);
        raw.fixture.home.score = { goals: 13, behinds: 12, totalScore: 90, superGoals: 0 };
        raw.fixture.away.score = { goals: 21, behinds: 14, totalScore: 140, superGoals: 0 };
      })], registry, identities),
      registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    });
    expect(second.applied).toBe(true);
    expect(second.counters.canonicalApplyFailures).toBe(0);
    expect(second.counters.canonicalRowsInserted).toBe(0);
    expect(second.counters.canonicalRowsUpdated).toBeGreaterThan(0);
    expect(second.counters.derivedRecomputeRuns).toBe(1);

    const [afterSecondMatch] = await sql<{ id: number; homeScore: number; awayScore: number; result: string }[]>`
      SELECT id, home_score AS "homeScore", away_score AS "awayScore", result
        FROM matches WHERE match_key = ${matchKey}
    `;
    expect(afterSecondMatch.homeScore).toBe(90);
    expect(afterSecondMatch.awayScore).toBe(140);
    expect(afterSecondMatch.result).toBe('away_win');

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM matches WHERE match_key = ${matchKey}
    `;
    expect(count).toBe('1'); // UPDATEd in place, never a second row

    const afterSecondHome = await clubSeasonFullSnapshot(homeClubId);
    const afterSecondAway = await clubSeasonFullSnapshot(awayClubId);

    // played is UNCHANGED by a correction to an existing match — only the
    // W/L/points/premiership_points it contributes are replaced.
    expect(afterSecondHome.played).toBe(afterFirstHome.played);
    expect(afterSecondAway.played).toBe(afterFirstAway.played);

    // HOME CLUB: the old win disappears, a new loss appears — not both
    // present at once, and not a second win added on top.
    expect(afterSecondHome.wins).toBe(afterFirstHome.wins - 1);
    expect(afterSecondHome.losses).toBe(afterFirstHome.losses + 1);
    expect(afterSecondHome.draws).toBe(afterFirstHome.draws);
    // points_for/against reflect the corrected score EXACTLY ONCE: the old
    // contribution (140/100) is replaced by the new one (90/140), a net
    // delta of -50/+40, not a second contribution stacked on the first.
    expect(afterSecondHome.pointsFor).toBe(afterFirstHome.pointsFor - 50);
    expect(afterSecondHome.pointsAgainst).toBe(afterFirstHome.pointsAgainst + 40);
    // Premiership points are REPLACED, not accumulated: a 4-point win
    // becomes a 0-point loss, a delta of exactly -4, never -4-then-back-to-0
    // nor a stray extra +4 from double-counting the old result.
    expect(afterSecondHome.premiershipPoints).toBe(afterFirstHome.premiershipPoints - 4);

    // AWAY CLUB: the old loss disappears, a new win appears.
    expect(afterSecondAway.wins).toBe(afterFirstAway.wins + 1);
    expect(afterSecondAway.losses).toBe(afterFirstAway.losses - 1);
    expect(afterSecondAway.draws).toBe(afterFirstAway.draws);
    expect(afterSecondAway.pointsFor).toBe(afterFirstAway.pointsFor + 40);
    expect(afterSecondAway.pointsAgainst).toBe(afterFirstAway.pointsAgainst - 50);
    expect(afterSecondAway.premiershipPoints).toBe(afterFirstAway.premiershipPoints + 4);

    // PERCENTAGE reflects the corrected canonical truth — the same
    // formula-against-itself check as the insert case, now proving it holds
    // again after a correction rather than only on a first write.
    expect(afterSecondHome.percentage).not.toBeNull();
    expect(afterSecondAway.percentage).not.toBeNull();
    expect(afterSecondHome.percentage as number)
      .toBeCloseTo((afterSecondHome.pointsFor / afterSecondHome.pointsAgainst) * 100, 3);
    expect(afterSecondAway.percentage as number)
      .toBeCloseTo((afterSecondAway.pointsFor / afterSecondAway.pointsAgainst) * 100, 3);

    expect(await ladderRankViolations()).toBe(0);

    // SEASONS: match_count/played stay unchanged by a correction to an
    // existing match (the row count didn't move, only its own fields did).
    const seasonAfterSecond = await seasonFullSnapshot();
    expect(seasonAfterSecond.matchCount).toBe(seasonAfterFirst.matchCount);

    // I244-F011 (player grain, after the correction): REPLACEMENT, not
    // accumulation. The player's W becomes an L — games unchanged, wins
    // -1, losses +1 — at both the season and the career grain, and the
    // persisted rows equal a fresh derivation from the corrected canonical
    // truth (state B), not A + B. player_clubs is content-identical to
    // after the first run: a score correction moves no membership, span,
    // games or goals, and this match (the LATEST-dated in the suite, see
    // CASE_DATES) is still its last_match_id.
    const playerAfterSecond = (await expectPlayerDerivedMatchesCanonical()).snapshot;
    expect(playerAfterSecond.season?.games).toBe(playerAfterFirst.season?.games);
    expect(playerAfterSecond.season?.wins).toBe((playerAfterFirst.season?.wins as number) - 1);
    expect(playerAfterSecond.season?.losses).toBe((playerAfterFirst.season?.losses as number) + 1);
    expect(playerAfterSecond.season?.kicks).toBe(playerAfterFirst.season?.kicks);
    expect(playerAfterSecond.career?.games).toBe(playerAfterFirst.career?.games);
    expect(playerAfterSecond.career?.wins).toBe((playerAfterFirst.career?.wins as number) - 1);
    expect(playerAfterSecond.career?.losses).toBe((playerAfterFirst.career?.losses as number) + 1);
    expect(playerAfterSecond.career?.last_match_date).toBe(matchDateFor(HA_CORRECTION_ID));
    expect(playerAfterSecond.clubs).toEqual(playerAfterFirst.clubs);
    expect(playerAfterSecond.clubs[0]?.last_match_id).toBe(afterSecondMatch.id);
  });

  /* ------------------------------------------------------------------ *
   * I244-F003 — venue identity completeness / fail-closed miss handling.
   *
   * Every case below builds its OWN `AflApiIdentities` (never mutates the
   * shared `identities` `beforeAll()` reads once for the whole suite) by
   * spreading it and replacing only `venues`, exactly as `unitSourceFor()`
   * clones its own JSON per case rather than mutating a shared fixture.
   * ------------------------------------------------------------------ */

  it('I244-F003 §11.2: a provider venue CD_V absent from afl-api-identities.json.venues refuses auto-apply, counts venueProviderUnmapped and opens a data_issues finding', async () => {
    const providerId = CASE_IDS.venueProviderMiss;
    // The real fixture's venue is CD_V40 (MCG). Removing it from the map
    // reproduces exactly the failure I244-F003 describes: a provider id the
    // identity map has never heard of, not merely one whose legacy_name
    // fails to resolve (that is the NEXT case).
    const unmappedVenueIdentities: AflApiIdentities = {
      ...identities,
      venues: new Map([...identities.venues].filter(([providerVenueId]) => providerVenueId !== 'CD_V40')),
    };
    const bundle = buildBundle([unitSourceFor(providerId)], registry, unmappedVenueIdentities);
    const result = await runSettleAflApi(sql, {
      bundle, registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    });

    expect(result.halt).toBeNull();
    expect(result.applied).toBe(true);
    expect(result.counters.canonicalApplyFailures).toBe(0);
    // The old defect (settle-afl-api.ts pre-I244-F003): this counter stayed
    // 0 on exactly this input, because `venueLegacyName !== null` was false
    // and the increment was skipped. It must now fire.
    expect(result.counters.venueProviderUnmapped).toBe(1);
    expect(result.counters.venueUnmapped).toBe(0);
    // The core fail-closed proof: the match is NOT auto-applied with
    // venue_id NULL. No `matches` row exists for it at all — the whole unit
    // was routed to promotion_candidates instead.
    expect(result.counters.canonicalRowsInserted).toBe(0);
    expect(result.counters.canonicalRowsUpdated).toBe(0);

    const matches = await sql`SELECT id FROM matches WHERE match_key = ${matchKeyFor(providerId)}`;
    expect(matches).toHaveLength(0);

    const [issue] = await sql<{ severity: string; entityId: number | null; details: Record<string, unknown> }[]>`
      SELECT severity, entity_id AS "entityId", details FROM data_issues
       WHERE issue_type = 'afl_api_venue_unmapped'
         AND issue_key = ${`afl_api|match|${providerId}|venue_id`}
         AND resolved_at IS NULL
    `;
    expect(issue).toBeDefined();
    expect(issue.entityId).toBeNull(); // new_target: no canonical row exists yet
    expect(issue.details.reason).toBe('provider_unmapped');
    expect(issue.details.venue_provider_id).toBe('CD_V40');

    // The source observation itself is retained regardless (never blocked
    // by a downstream canonical refusal) — the spine wrote a version for
    // this unit's match family.
    const [observed] = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM staging.source_records
       WHERE source_id = ${aflApiSourceId} AND family = 'match' AND external_record_id = ${providerId}
    `;
    expect(observed.n).toBe('1');

    // Routed to review, not silently dropped: a pending candidate for the
    // match itself carries the true venue_raw evidence.
    const [candidate] = await sql<{ proposedFields: { venue_id: unknown; venue_raw: unknown } }[]>`
      SELECT proposed_fields AS "proposedFields" FROM promotion_candidates
       WHERE external_record_id = ${providerId} AND target_table = 'matches' AND status = 'pending'
    `;
    expect(candidate).toBeDefined();
    expect(candidate.proposedFields.venue_id).toBeNull();
    expect(candidate.proposedFields.venue_raw).toBe('MCG');
  });

  it('I244-F003 §11.3: a mapped legacy_name with no matching venues row refuses auto-apply and counts venueUnmapped, distinctly from a provider map miss', async () => {
    const providerId = CASE_IDS.venueLegacyNameMiss;
    // CD_V40 stays IN the map (unlike the previous case) but is deliberately
    // pointed at a legacy_name no venues row carries — the map hit / canonical
    // miss the review's §11.3 distinguishes from a provider map miss.
    const bogusLegacyName = 'NOT-A-REAL-VENUE-ISSUE244';
    const bogusVenueIdentities: AflApiIdentities = {
      ...identities,
      venues: new Map(identities.venues).set('CD_V40', { rawName: 'MCG', legacyName: bogusLegacyName }),
    };
    const bundle = buildBundle([unitSourceFor(providerId)], registry, bogusVenueIdentities);
    const result = await runSettleAflApi(sql, {
      bundle, registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    });

    expect(result.halt).toBeNull();
    expect(result.counters.venueUnmapped).toBe(1);
    expect(result.counters.venueProviderUnmapped).toBe(0);
    expect(result.counters.canonicalRowsInserted).toBe(0);
    expect(result.counters.canonicalRowsUpdated).toBe(0);

    const matches = await sql`SELECT id FROM matches WHERE match_key = ${matchKeyFor(providerId)}`;
    expect(matches).toHaveLength(0);

    const [issue] = await sql<{ details: Record<string, unknown> }[]>`
      SELECT details FROM data_issues
       WHERE issue_type = 'afl_api_venue_unmapped'
         AND issue_key = ${`afl_api|match|${providerId}|venue_id`}
         AND resolved_at IS NULL
    `;
    expect(issue).toBeDefined();
    expect(issue.details.reason).toBe('legacy_name_unresolved');
    expect(issue.details.venue_legacy_name).toBe(bogusLegacyName);
  });

  it('I244-F003 §11.4: correcting a provider venue mapping self-heals a previously-refused afl_api match on re-settle', async () => {
    const providerId = CASE_IDS.venueSelfHeal;
    const unmappedVenueIdentities: AflApiIdentities = {
      ...identities,
      venues: new Map([...identities.venues].filter(([providerVenueId]) => providerVenueId !== 'CD_V40')),
    };

    const first = await runSettleAflApi(sql, {
      bundle: buildBundle([unitSourceFor(providerId)], registry, unmappedVenueIdentities),
      registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    });
    expect(first.halt).toBeNull();
    expect(first.counters.venueProviderUnmapped).toBe(1);
    expect(first.counters.canonicalRowsInserted).toBe(0);
    const beforeMatches = await sql`SELECT id FROM matches WHERE match_key = ${matchKeyFor(providerId)}`;
    expect(beforeMatches).toHaveLength(0);

    // The map is corrected (the real, unmutated `identities` maps CD_V40 to
    // M.C.G.) and the SAME immutable snapshot is re-settled — no
    // re-acquisition, exactly §11's ISSUE-224 self-heal precedent for a
    // player identity fix.
    const second = await runSettleAflApi(sql, {
      bundle: buildBundle([unitSourceFor(providerId)], registry, identities),
      registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    });
    expect(second.halt).toBeNull();
    expect(second.counters.venueProviderUnmapped).toBe(0);
    expect(second.counters.venueUnmapped).toBe(0);
    expect(second.counters.canonicalRowsInserted).toBeGreaterThan(0);

    const [match] = await sql<{ venueId: number | null; venueRaw: string }[]>`
      SELECT venue_id AS "venueId", venue_raw AS "venueRaw" FROM matches WHERE match_key = ${matchKeyFor(providerId)}
    `;
    expect(match).toBeDefined();
    expect(match.venueId).toBe(venueId);
    expect(match.venueRaw).toBe('MCG');

    // The finding opened by the first run is resolved, not left dangling —
    // a zero on venueProviderUnmapped/venueUnmapped now genuinely means
    // every provider venue identity this run encountered resolved.
    const [issue] = await sql`
      SELECT id FROM data_issues
       WHERE issue_type = 'afl_api_venue_unmapped'
         AND issue_key = ${`afl_api|match|${providerId}|venue_id`}
         AND resolved_at IS NULL
    `;
    expect(issue).toBeUndefined();
  });

  it('I244-F004: require-complete-source refuses an incomplete apply before commit, while explicit partial apply and dry-run keep their contracts', async () => {
    const providerId = CASE_IDS.completenessRollback;
    const matchKey = matchKeyFor(providerId);
    const incompleteBundle = {
      ...buildBundle([unitSourceFor(providerId)], registry, identities),
      // Scope the batch assertion below to this attempted transaction rather
      // than any earlier committed fixture run in the suite.
      snapshotLabel: `issue228-integration-${providerId}-require-complete`,
    };

    const refused = await runSettleAflApi(sql, {
      bundle: incompleteBundle, registry, apply: true, autoApply: true,
      requireCompleteSource: true, inProgressSeasons: [SEASON],
    });
    expect(refused.applied).toBe(false);
    expect(refused.rollbackReason).toBe('require_complete_source');
    expect(refused.sourceCompleteness?.status).toBe('incomplete');
    expect(refused.counters.canonicalRowsInserted).toBe(0);
    expect(refused.counters.canonicalRowsUpdated).toBe(0);
    const [afterRefusal] = await sql<{ id: number }[]>`
      SELECT id FROM matches WHERE match_key = ${matchKey}
    `;
    expect(afterRefusal).toBeUndefined();
    const [stagedMatch] = await sql<{ externalRecordId: string }[]>`
      SELECT external_record_id AS "externalRecordId"
        FROM staging.afl_api_match
       WHERE external_record_id = ${providerId}
    `;
    expect(stagedMatch).toBeUndefined();
    const [refusedBatch] = await sql<{ id: string }[]>`
      SELECT id FROM import_batches
       WHERE source_id = ${aflApiSourceId}
         AND tool = ${SETTLE_BATCH_TOOL}
         AND notes LIKE ${`%snapshot=${incompleteBundle.snapshotLabel};%`}
    `;
    expect(refusedBatch).toBeUndefined();
    const [applications] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM canonical_applications
       WHERE source_id = ${aflApiSourceId}
         AND external_record_id LIKE ${`${providerId}%`}
    `;
    expect(applications.count).toBe('0');

    const explicitlyPartial = await runSettleAflApi(sql, {
      bundle: buildBundle([unitSourceFor(providerId)], registry, identities),
      registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    });
    expect(explicitlyPartial.applied).toBe(true);
    expect(explicitlyPartial.rollbackReason).toBeNull();
    const [afterPartialApply] = await sql<{ id: number }[]>`
      SELECT id FROM matches WHERE match_key = ${matchKey}
    `;
    expect(afterPartialApply).toBeDefined();

    const dryRun = await runSettleAflApi(sql, {
      bundle: buildBundle([], registry, identities), registry, apply: false, autoApply: true,
      requireCompleteSource: true, inProgressSeasons: [SEASON],
    });
    expect(dryRun.applied).toBe(false);
    expect(dryRun.rollbackReason).toBe('dry_run');

    const complete = await runSettleAflApi(sql, {
      bundle: buildBundle([], registry, identities), registry, apply: true, autoApply: true,
      requireCompleteSource: true, inProgressSeasons: [SEASON],
    });
    expect(complete.applied).toBe(true);
    expect(complete.rollbackReason).toBeNull();
    expect(complete.sourceCompleteness?.status).toBe('complete');
  });

  it('I244-F008: a committed apply leaves a terminal batch that agrees with the run, its import_rejections and the canonical data; an identical replay is a terminal zero-change batch', async () => {
    const providerId = CASE_IDS.batchLifecycle;
    const first = await runSettleAflApi(sql, {
      bundle: {
        ...buildBundle([unitSourceFor(providerId)], registry, identities),
        snapshotLabel: `issue228-integration-${providerId}-f008-first`,
      },
      registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    });
    expect(first.applied).toBe(true);
    expect(first.batchId).not.toBeNull();
    expect(first.counters.canonicalApplyFailures).toBe(0);
    expect(first.counters.canonicalRowsInserted).toBeGreaterThan(0);

    // The canonical data the run reports having written actually exists.
    const [match] = await sql<{ id: number }[]>`
      SELECT id FROM matches WHERE match_key = ${matchKeyFor(providerId)}
    `;
    expect(match).toBeDefined();

    const batch = await importBatchRow(first.batchId as string);
    // Terminal: never `running`, stamped complete, and not completed before it started.
    expect(batch.status).toBe('completed');
    expect(batch.completed).toBe(true);
    expect(batch.completedAfterStart).toBe(true);
    // records_read is the unit's settle-record count; records_inserted the versions
    // appended to the batch's own target table (append-only, so records_updated is 0).
    const settleRecordCount = buildBundle([unitSourceFor(providerId)], registry, identities)
      .units.reduce((n, unit) => n + unit.settleRecords.length, 0);
    expect(batch.recordsRead).toBe(settleRecordCount);
    expect(batch.recordsInserted).toBe(first.counters.versionsAppended);
    expect(batch.recordsInserted).toBeGreaterThan(0);
    expect(batch.recordsUpdated).toBe(0);
    // Migration 001: records_rejected = the number of import_rejections rows for the
    // batch. The unbridged fixture player is the one unresolved identity (see the
    // '§19' case above), so exactly one row exists and the two agree.
    expect(batch.rejectionRows).toBe(1);
    expect(batch.recordsRejected).toBe(batch.rejectionRows);
    // validation_result IS the run's counters — canonical outcome included.
    expect(batch.validationResult).toEqual(JSON.parse(JSON.stringify(first.counters)));

    // An identical replay is a distinct, terminal batch reporting NO change.
    const replay = await runSettleAflApi(sql, {
      bundle: {
        ...buildBundle([unitSourceFor(providerId)], registry, identities),
        snapshotLabel: `issue228-integration-${providerId}-f008-replay`,
      },
      registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    });
    expect(replay.applied).toBe(true);
    expect(replay.batchId).not.toBeNull();
    expect(replay.batchId).not.toBe(first.batchId);
    expect(replay.counters.canonicalRowsInserted).toBe(0);
    expect(replay.counters.canonicalRowsUpdated).toBe(0);
    expect(replay.counters.versionsAppended).toBe(0);

    const replayBatch = await importBatchRow(replay.batchId as string);
    expect(replayBatch.status).toBe('completed');
    expect(replayBatch.completed).toBe(true);
    expect(replayBatch.completedAfterStart).toBe(true);
    expect(replayBatch.recordsRead).toBe(settleRecordCount);
    expect(replayBatch.recordsInserted).toBe(0);
    expect(replayBatch.recordsUpdated).toBe(0);
    // The replay re-refuses the same unbridged player, so it persists (and counts)
    // its own single rejection row — the column agrees with the rows, not with zero.
    expect(replayBatch.recordsRejected).toBe(replayBatch.rejectionRows);
    expect(replayBatch.validationResult).toMatchObject({
      canonicalRowsInserted: 0, canonicalRowsUpdated: 0, canonicalApplicationsLogged: 0, versionsAppended: 0,
    });
  });

  it('I244-F008: a dry-run leaves no batch row at all, even though it ran the real finalising UPDATE', async () => {
    const providerId = CASE_IDS.batchDryRun;
    const label = `issue228-integration-${providerId}-f008-dry-run`;
    const dryRun = await runSettleAflApi(sql, {
      bundle: { ...buildBundle([unitSourceFor(providerId)], registry, identities), snapshotLabel: label },
      registry, apply: false, autoApply: true, inProgressSeasons: [SEASON],
    });
    expect(dryRun.applied).toBe(false);
    expect(dryRun.rollbackReason).toBe('dry_run');
    expect(dryRun.batchId).toBeNull();
    expect(await batchesLabelled(label)).toBe(0);
    const [afterDryRun] = await sql<{ id: number }[]>`
      SELECT id FROM matches WHERE match_key = ${matchKeyFor(providerId)}
    `;
    expect(afterDryRun).toBeUndefined();
  });

  it('I244-F008: a failure while finalising the batch rolls the whole run back — no batch, no canonical row, no spine row', async () => {
    const providerId = CASE_IDS.batchFinaliseFailure;
    const label = `issue228-integration-${providerId}-f008-finalise-failure`;
    await expect(runSettleAflApi(sqlFailingOnBatchFinalisation(sql), {
      bundle: { ...buildBundle([unitSourceFor(providerId)], registry, identities), snapshotLabel: label },
      registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    })).rejects.toThrow(/injected batch finalisation failure/);

    // Everything the run had already written (spine observations, projections,
    // canonical rows, ledger) was inside the same transaction as the failed
    // finalisation, so none of it may have survived.
    expect(await batchesLabelled(label)).toBe(0);
    const [survivingMatch] = await sql<{ id: number }[]>`
      SELECT id FROM matches WHERE match_key = ${matchKeyFor(providerId)}
    `;
    expect(survivingMatch).toBeUndefined();
    const [survivingObservations] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM staging.source_records
       WHERE source_id = ${aflApiSourceId} AND external_record_id LIKE ${`${providerId}%`}
    `;
    expect(survivingObservations.count).toBe(0);
    const [survivingLedger] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM canonical_applications
       WHERE source_id = ${aflApiSourceId} AND external_record_id LIKE ${`${providerId}%`}
    `;
    expect(survivingLedger.count).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * AFLDB-ISSUE-244 I244-F009 — durable evidence for an automatic-apply refusal
 *
 * The genuine F009 gap: a player_match_stats row the AFL Tables source owns
 * differs from what the AFL API proposes. `applyCanonicalUnit()` refuses it
 * (`foreign_source_owner`) without rolling back, and before F009 the ONLY trace
 * was `canonicalApplyRefusals` — nothing said which row or why once the run was
 * over. The refusal is manufactured by re-stamping the synthetic player's row
 * as afltables-owned with a different `kicks`; ownership and canonical values
 * are then asserted UNCHANGED after every refused run.
 * ------------------------------------------------------------------ */

type ApplyFindingRow = {
  id: string;
  resolvedAt: Date | null;
  resolution: string | null;
  severity: string;
  entityId: string | null;
  details: Record<string, unknown>;
};

/** Every `canonical_apply_failed` row (open or resolved) for one player record, oldest first. */
async function applyFindingsFor(externalRecordId: string): Promise<ApplyFindingRow[]> {
  const rows = await sql<ApplyFindingRow[]>`
    SELECT id::text AS id, resolved_at AS "resolvedAt", resolution, severity::text AS severity,
           entity_id::text AS "entityId", details
      FROM data_issues
     WHERE issue_type = 'canonical_apply_failed'
       AND issue_key = ${`afl_api|apply|player_match_stats|${externalRecordId}|player_match_stats`}
     ORDER BY id
  `;
  return [...rows];
}

/** The bridged player's whole canonical row, every column, for byte-for-byte comparison. */
async function bridgedPlayerRowOf(matchId: number): Promise<Record<string, unknown>> {
  const [row] = await sql<{ snapshot: Record<string, unknown> }[]>`
    SELECT to_jsonb(p) AS snapshot FROM player_match_stats p
     WHERE p.match_id = ${matchId} AND p.player_id = ${bridgedPlayerId}
  `;
  expect(row).toBeDefined();
  return row.snapshot;
}

/** The composite spine id the bridged player's record carries (`<match>|<team>|<player>`). */
async function bridgedPlayerRecordId(providerId: string): Promise<string> {
  const [row] = await sql<{ externalRecordId: string }[]>`
    SELECT external_record_id AS "externalRecordId" FROM staging.source_records
     WHERE source_id = ${aflApiSourceId} AND family = 'player_match_stats'
       AND external_record_id LIKE ${`${providerId}|%|${BRIDGED_PROVIDER_PLAYER_ID}`}
  `;
  expect(row).toBeDefined();
  return row.externalRecordId;
}

function f009Options(
  providerId: string, label: string,
  overrides: { apply?: boolean; requireCompleteSource?: boolean } = {},
) {
  return {
    bundle: {
      ...buildBundle([unitSourceFor(providerId)], registry, identities),
      snapshotLabel: `issue228-integration-${providerId}-f009-${label}`,
    },
    registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    ...overrides,
  };
}

/** Re-stamp the bridged player's row as another source's, with values that differ from the proposal. */
async function makeBridgedPlayerRowForeignAndDifferent(matchId: number): Promise<void> {
  await sql`
    UPDATE player_match_stats SET source_id = ${afltablesSourceId}, kicks = kicks + 100
     WHERE match_id = ${matchId} AND player_id = ${bridgedPlayerId}
  `;
}

describe('AFLDB-ISSUE-244 I244-F009 — automatic-apply refusals are durable, replay-safe and self-healing', () => {
  it('a foreign-owned player row is refused with a durable machine-readable finding; a replay refreshes it in place; it self-heals when the row becomes applicable — canonical state and ownership untouched while refused', async () => {
    const providerId = CASE_IDS.applyRefusal;

    // Setup: an ordinary auto-applied match whose bridged player row is afl_api-owned.
    const created = await runSettleAflApi(sql, f009Options(providerId, 'create'));
    expect(created.applied).toBe(true);
    expect(created.counters.canonicalApplyFailures).toBe(0);
    expect(created.counters.canonicalApplyRefusals).toBe(0);
    expect(created.counters.canonicalRowsInserted).toBeGreaterThan(0);
    const [match] = await sql<{ id: number }[]>`
      SELECT id FROM matches WHERE match_key = ${matchKeyFor(providerId)}
    `;
    expect(match).toBeDefined();
    const recordId = await bridgedPlayerRecordId(providerId);
    expect(await applyFindingsFor(recordId)).toHaveLength(0);
    const ownRow = await bridgedPlayerRowOf(match.id);
    expect(ownRow.source_id).toBe(aflApiSourceId);

    // The refusal condition: AFL Tables owns the row and holds a different `kicks`.
    await makeBridgedPlayerRowForeignAndDifferent(match.id);
    const foreignRow = await bridgedPlayerRowOf(match.id);
    expect(foreignRow.source_id).toBe(afltablesSourceId);
    expect(foreignRow.kicks).not.toBe(ownRow.kicks);

    // A dry-run and an F004 refusal both decide the refusal inside their transaction and
    // then roll it back: NO committed finding may survive either.
    const dry = await runSettleAflApi(sql, f009Options(providerId, 'dry-run', { apply: false }));
    expect(dry.applied).toBe(false);
    expect(dry.rollbackReason).toBe('dry_run');
    expect(await applyFindingsFor(recordId)).toHaveLength(0);
    const gated = await runSettleAflApi(sql, f009Options(providerId, 'require-complete', { requireCompleteSource: true }));
    expect(gated.applied).toBe(false);
    expect(gated.rollbackReason).toBe('require_complete_source');
    expect(gated.counters.dataIssuesOpened).toBe(0);
    expect(await applyFindingsFor(recordId)).toHaveLength(0);

    // RUN 1 — the committed refusal.
    const refused = await runSettleAflApi(sql, f009Options(providerId, 'refused'));
    expect(refused.applied).toBe(true);
    expect(refused.counters.canonicalApplyFailures).toBe(0);
    expect(refused.counters.canonicalApplyRefusals).toBe(1);
    expect(refused.counters.canonicalRowsInserted).toBe(0);
    expect(refused.counters.canonicalRowsUpdated).toBe(0);
    expect(refused.counters.dataIssuesOpened).toBe(1);

    const opened = await applyFindingsFor(recordId);
    expect(opened).toHaveLength(1);
    expect(opened[0].resolvedAt).toBeNull();
    expect(opened[0].severity).toBe('warning');
    expect(opened[0].entityId).toBe(String(foreignRow.id));
    expect(opened[0].details).toMatchObject({
      owner: 'AFLDB-ISSUE-122', source_key: 'afl_api', family: 'player_match_stats',
      target_table: 'player_match_stats', external_record_id: recordId, refusal: 'foreign_source_owner',
    });
    expect(opened[0].details.fields).toEqual(expect.arrayContaining(['kicks']));
    // Canonical state and ownership are exactly as the other source left them.
    expect(await bridgedPlayerRowOf(match.id)).toEqual(foreignRow);

    // A refused CANONICAL write is not a source rejection or a review proposal:
    // records_rejected still counts import_rejections rows alone (F008), and nothing
    // was drafted into the promotion queue.
    const [{ rejections }] = await sql<{ rejections: number }[]>`
      SELECT count(*)::int AS rejections FROM import_rejections WHERE source_record_id = ${recordId}
    `;
    const [{ candidates }] = await sql<{ candidates: number }[]>`
      SELECT count(*)::int AS candidates FROM promotion_candidates WHERE external_record_id = ${recordId}
    `;
    expect(rejections).toBe(0);
    expect(candidates).toBe(0);
    const refusedBatch = await importBatchRow(refused.batchId as string);
    expect(refusedBatch.recordsRejected).toBe(refusedBatch.rejectionRows);
    expect(refusedBatch.validationResult).toEqual(JSON.parse(JSON.stringify(refused.counters)));

    // REPLAY of identical evidence: the one open finding is refreshed in place — no second row.
    const replay = await runSettleAflApi(sql, f009Options(providerId, 'refused-replay'));
    expect(replay.counters.canonicalApplyRefusals).toBe(1);
    expect(replay.counters.dataIssuesOpened).toBe(0);
    expect(replay.counters.dataIssuesRefreshed).toBe(1);
    const afterReplay = await applyFindingsFor(recordId);
    expect(afterReplay).toHaveLength(1);
    expect(afterReplay[0].id).toBe(opened[0].id);
    expect(afterReplay[0].resolvedAt).toBeNull();
    expect(await bridgedPlayerRowOf(match.id)).toEqual(foreignRow);

    // SELF-HEAL: the prerequisite is corrected (the row is afl_api's again), the same
    // evidence is replayed, the automatic apply succeeds and the finding closes.
    await sql`
      UPDATE player_match_stats SET source_id = ${aflApiSourceId}
       WHERE match_id = ${match.id} AND player_id = ${bridgedPlayerId}
    `;
    const healed = await runSettleAflApi(sql, f009Options(providerId, 'healed'));
    expect(healed.counters.canonicalApplyRefusals).toBe(0);
    expect(healed.counters.canonicalRowsUpdated).toBe(1);
    expect(healed.counters.dataIssuesResolved).toBe(1);
    const afterHeal = await applyFindingsFor(recordId);
    expect(afterHeal).toHaveLength(1);
    expect(afterHeal[0].resolvedAt).not.toBeNull();
    expect(afterHeal[0].resolution).toBe('canonical_apply_succeeded');
    const healedRow = await bridgedPlayerRowOf(match.id);
    expect(healedRow.kicks).toBe(ownRow.kicks);
    expect(healedRow.source_id).toBe(aflApiSourceId);
  });

  it('a refusal that no longer differs from canonical state is closed as moot; a finding a human resolved is never rewritten, and a persisting refusal opens exactly one fresh row', async () => {
    const providerId = CASE_IDS.applyRefusalMoot;
    const created = await runSettleAflApi(sql, f009Options(providerId, 'create'));
    expect(created.applied).toBe(true);
    expect(created.counters.canonicalRowsInserted).toBeGreaterThan(0);
    const [match] = await sql<{ id: number }[]>`
      SELECT id FROM matches WHERE match_key = ${matchKeyFor(providerId)}
    `;
    const recordId = await bridgedPlayerRecordId(providerId);

    // Refused: AFL Tables owns the row and it differs.
    await makeBridgedPlayerRowForeignAndDifferent(match.id);
    const refused = await runSettleAflApi(sql, f009Options(providerId, 'refused'));
    expect(refused.counters.canonicalApplyRefusals).toBe(1);
    const [first] = await applyFindingsFor(recordId);
    expect(first.resolvedAt).toBeNull();

    // MOOT: the other source's row now agrees with the proposal (values restored, ownership
    // still AFL Tables'). Nothing is left to apply, so the run never asks the applier and the
    // stale finding is closed — not left falsely open, and ownership is still not adopted.
    await sql`
      UPDATE player_match_stats SET kicks = kicks - 100
       WHERE match_id = ${match.id} AND player_id = ${bridgedPlayerId}
    `;
    const agreedRow = await bridgedPlayerRowOf(match.id);
    const moot = await runSettleAflApi(sql, f009Options(providerId, 'moot'));
    expect(moot.counters.canonicalApplyRefusals).toBe(0);
    expect(moot.counters.canonicalRowsUpdated).toBe(0);
    expect(moot.counters.dataIssuesResolved).toBe(1);
    const [mootClosed] = await applyFindingsFor(recordId);
    expect(mootClosed.id).toBe(first.id);
    expect(mootClosed.resolvedAt).not.toBeNull();
    expect(mootClosed.resolution).toBe('canonical_apply_not_needed');
    expect(await bridgedPlayerRowOf(match.id)).toEqual(agreedRow);
    expect(agreedRow.source_id).toBe(afltablesSourceId);

    // The refusal condition returns and a NEW finding opens; a super admin then resolves it.
    await makeBridgedPlayerRowForeignAndDifferent(match.id);
    const reopened = await runSettleAflApi(sql, f009Options(providerId, 'reopened'));
    expect(reopened.counters.dataIssuesOpened).toBe(1);
    const second = (await applyFindingsFor(recordId)).find((row) => row.resolvedAt === null);
    expect(second).toBeDefined();
    expect(second?.id).not.toBe(first.id);
    await sql`
      UPDATE data_issues
         SET resolved_at = now(), resolution = 'accepted: AFL Tables is authoritative for this row'
       WHERE id = ${second?.id as string}
    `;
    const [humanRow] = await sql<{ snapshot: Record<string, unknown> }[]>`
      SELECT to_jsonb(d) AS snapshot FROM data_issues d WHERE d.id = ${second?.id as string}
    `;

    // Automatic replay while the refusal still holds must not rewrite the human's decision.
    // Recurrence opens exactly ONE fresh finding beside it (`uq_data_issues_open_by_key` is
    // partial on unresolved rows), and further replays refresh that one — no spam.
    for (const label of ['recurrence-1', 'recurrence-2']) {
      const replay = await runSettleAflApi(sql, f009Options(providerId, label));
      expect(replay.counters.canonicalApplyRefusals).toBe(1);
    }
    const [humanAfter] = await sql<{ snapshot: Record<string, unknown> }[]>`
      SELECT to_jsonb(d) AS snapshot FROM data_issues d WHERE d.id = ${second?.id as string}
    `;
    expect(humanAfter.snapshot).toEqual(humanRow.snapshot);
    const all = await applyFindingsFor(recordId);
    expect(all).toHaveLength(3);
    expect(all.filter((row) => row.resolvedAt === null)).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 * AFLDB-ISSUE-244 I244-F010 — identity-bearing canonical corrections.
 *
 * Policy under test: the AFL API settle never writes an identity-bearing
 * `matches` field (round/date/clubs/season and the columns CHECK-bound to
 * round_code) on an EXISTING row, because `match_key` is a content address over
 * them and this writer cannot maintain it atomically (see
 * `MATCH_IDENTITY_FIELDS`, settle-core.ts). The difference is made durable as a
 * `canonical_apply_failed` finding under its own key and heals when the two
 * sides agree again. Non-identity fields keep auto-applying.
 *
 * Every row is namespaced; cleanup() removes it (K_corrected included).
 * ------------------------------------------------------------------ */

/** Every identity finding (open or resolved) for one provider match, oldest first. */
async function identityFindingsFor(providerId: string): Promise<ApplyFindingRow[]> {
  const rows = await sql<ApplyFindingRow[]>`
    SELECT id::text AS id, resolved_at AS "resolvedAt", resolution, severity::text AS severity,
           entity_id::text AS "entityId", details
      FROM data_issues
     WHERE issue_type = 'canonical_apply_failed'
       AND issue_key = ${`afl_api|apply|match|${providerId}|matches:identity`}
     ORDER BY id
  `;
  return [...rows];
}

/** The unit for `providerId` with its match date replaced (both halves, so §11.1's cross-check still proves it). */
function sourceWithMatchDate(
  providerId: string, matchDate: string,
  extra?: (raw: { fixture: Record<string, any>; roster: Record<string, any>; stats: Record<string, any> }) => void,
): AflApiSettleUnitSource {
  return unitSourceFor(providerId, (raw) => {
    raw.fixture.utcStartTime = `${matchDate}T07:15:00.000+0000`;
    raw.roster.match.venueLocalStartTime = `${matchDate}T17:15:00`;
    extra?.(raw);
  });
}

function f010Options(
  providerId: string, label: string, source: AflApiSettleUnitSource,
  overrides: { apply?: boolean; requireCompleteSource?: boolean } = {},
) {
  return {
    bundle: {
      ...buildBundle([source], registry, identities),
      snapshotLabel: `issue228-integration-${providerId}-f010-${label}`,
    },
    registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    ...overrides,
  };
}

async function matchRowByKey(matchKey: string): Promise<Record<string, any>> {
  const [row] = await sql<{ snapshot: Record<string, any> }[]>`
    SELECT to_jsonb(m) AS snapshot FROM matches m WHERE m.match_key = ${matchKey}
  `;
  expect(row).toBeDefined();
  return row.snapshot;
}

describe('AFLDB-ISSUE-244 I244-F010 — identity-bearing corrections are withheld, durable and self-healing', () => {
  it('a provider date correction is withheld while non-identity corrections still apply; the finding is replay-safe, heals when the sides agree again, and never rewrites a human resolution', async () => {
    const providerId = CASE_IDS.identityCorrection;
    const keyA = matchKeyFor(providerId);
    const keyC = identityCorrectedMatchKey();
    const original = () => unitSourceFor(providerId);
    const correctedDate = (extra?: Parameters<typeof sourceWithMatchDate>[2]) =>
      sourceWithMatchDate(providerId, IDENTITY_CORRECTED_DATE, extra);

    // Setup: an ordinary auto-applied match at identity K_A.
    const created = await runSettleAflApi(sql, f010Options(providerId, 'create', original()));
    expect(created.applied).toBe(true);
    expect(created.counters.canonicalRowsInserted).toBeGreaterThan(0);
    expect(await identityFindingsFor(providerId)).toHaveLength(0);
    const before = await canonicalSnapshot(keyA, providerId);
    const matchRow = before.match as Record<string, any>;
    expect(matchRow.match_key).toBe(keyA);
    expect(String(matchRow.match_date)).toBe(matchDateFor(providerId));

    // A dry-run and an F004 refusal decide the refusal in their transaction and roll it back.
    const dry = await runSettleAflApi(sql, f010Options(providerId, 'dry', correctedDate(), { apply: false }));
    expect(dry.rollbackReason).toBe('dry_run');
    expect(await identityFindingsFor(providerId)).toHaveLength(0);

    // RUN 1 — the committed identity-only correction: withheld, durable, canonical byte-identical.
    const refused = await runSettleAflApi(sql, f010Options(providerId, 'refused', correctedDate()));
    expect(refused.applied).toBe(true);
    expect(refused.counters.canonicalApplyFailures).toBe(0);
    expect(refused.counters.canonicalApplyRefusals).toBe(1);
    expect(refused.counters.canonicalRowsUpdated).toBe(0);
    expect(refused.counters.canonicalRowsInserted).toBe(0);
    expect(refused.counters.canonicalApplicationsLogged).toBe(0);
    expect(refused.counters.derivedRecomputeRuns).toBe(0);
    expect(refused.counters.dataIssuesOpened).toBe(1);
    expect(refused.counters.candidatesCreated).toBe(0);
    // Same row, same key, nothing written; the key still renders the row's own identity.
    expect(await canonicalSnapshot(keyA, providerId)).toEqual(before);
    const afterRefusal = await matchRowByKey(keyA);
    expect(afterRefusal.id).toBe(matchRow.id);
    expect(String(afterRefusal.match_date)).toBe(matchDateFor(providerId));
    // No duplicate fixture appeared at the proposed identity.
    const [{ atProposed }] = await sql<{ atProposed: number }[]>`
      SELECT count(*)::int AS "atProposed" FROM matches WHERE match_key = ${keyC}
    `;
    expect(atProposed).toBe(0);

    const [first] = await identityFindingsFor(providerId);
    expect(first.resolvedAt).toBeNull();
    expect(first.severity).toBe('warning');
    expect(first.entityId).toBe(String(matchRow.id));
    expect(first.details).toMatchObject({
      owner: 'AFLDB-ISSUE-122', source_key: 'afl_api', family: 'match', target_table: 'matches',
      external_record_id: providerId, refusal: 'identity_change_requires_review', match_id: matchRow.id,
      fields: ['match_date'], canonical_match_key: keyA, provider_match_key: keyC,
      changes: [{ field: 'match_date', canonical: matchDateFor(providerId), provider: IDENTITY_CORRECTED_DATE }],
    });
    // A withheld identity is not a source rejection or a review proposal (F008 accounting unchanged).
    const refusedBatch = await importBatchRow(refused.batchId as string);
    expect(refusedBatch.recordsRejected).toBe(refusedBatch.rejectionRows);
    expect(refusedBatch.validationResult).toEqual(JSON.parse(JSON.stringify(refused.counters)));

    // REPLAY of identical evidence refreshes the one open finding — no second row.
    const replay = await runSettleAflApi(sql, f010Options(providerId, 'refused-replay', correctedDate()));
    expect(replay.counters.canonicalApplyRefusals).toBe(1);
    expect(replay.counters.dataIssuesOpened).toBe(0);
    expect(replay.counters.dataIssuesRefreshed).toBe(1);
    const afterReplay = await identityFindingsFor(providerId);
    expect(afterReplay).toHaveLength(1);
    expect(afterReplay[0].id).toBe(first.id);
    expect(await canonicalSnapshot(keyA, providerId)).toEqual(before);

    // PARTIAL: the same corrected date arrives together with a score correction. The non-identity
    // part applies (and recomputes derived state); the date is still withheld and the key still
    // renders the row.
    const withScore = (raw: { fixture: Record<string, any> }) => {
      raw.fixture.home.score = { goals: 23, behinds: 12, totalScore: 150, superGoals: 0 };
    };
    const partial = await runSettleAflApi(sql, f010Options(providerId, 'partial', correctedDate(withScore)));
    expect(partial.counters.canonicalApplyFailures).toBe(0);
    expect(partial.counters.canonicalRowsUpdated).toBeGreaterThan(0);
    expect(partial.counters.derivedRecomputeRuns).toBe(1);
    expect(partial.counters.canonicalApplyRefusals).toBe(1);
    const afterPartial = await matchRowByKey(keyA);
    expect(afterPartial.id).toBe(matchRow.id);
    expect(afterPartial.home_score).toBe(150);
    expect(afterPartial.result).toBe('home_win');
    expect(String(afterPartial.match_date)).toBe(matchDateFor(providerId));
    expect(afterPartial.match_key).toBe(keyA);
    const [{ rowsForProvider }] = await sql<{ rowsForProvider: number }[]>`
      SELECT count(*)::int AS "rowsForProvider" FROM matches WHERE source_record_id = ${providerId}
    `;
    expect(rowsForProvider).toBe(1);
    const stillOne = await identityFindingsFor(providerId);
    expect(stillOne).toHaveLength(1);
    expect(stillOne[0].id).toBe(first.id);
    expect(stillOne[0].details.fields).toEqual(['match_date']);
    const settled = await canonicalSnapshot(keyA, providerId);

    // SELF-HEAL — the provider reverts to the canonical identity: nothing to apply, finding closed.
    const reverted = await runSettleAflApi(sql, f010Options(
      providerId, 'reverted', sourceWithMatchDate(providerId, matchDateFor(providerId), withScore),
    ));
    expect(reverted.counters.canonicalApplyRefusals).toBe(0);
    expect(reverted.counters.canonicalRowsUpdated).toBe(0);
    expect(reverted.counters.dataIssuesResolved).toBe(1);
    const [closed] = await identityFindingsFor(providerId);
    expect(closed.id).toBe(first.id);
    expect(closed.resolvedAt).not.toBeNull();
    expect(closed.resolution).toBe('canonical_apply_not_needed');
    expect(await canonicalSnapshot(keyA, providerId)).toEqual(settled);

    // RECURRENCE and HUMAN DECISION: the difference returns (a fresh finding), a super admin
    // resolves it, and further replays never rewrite that decision — exactly one fresh open row
    // appears beside it and later replays refresh only that one.
    const again = await runSettleAflApi(sql, f010Options(providerId, 'again', correctedDate(withScore)));
    expect(again.counters.dataIssuesOpened).toBe(1);
    const second = (await identityFindingsFor(providerId)).find((row) => row.resolvedAt === null);
    expect(second).toBeDefined();
    expect(second?.id).not.toBe(first.id);
    await sql`
      UPDATE data_issues
         SET resolved_at = now(), resolution = 'accepted: the provider date is wrong'
       WHERE id = ${second?.id as string}
    `;
    const [humanRow] = await sql<{ snapshot: Record<string, unknown> }[]>`
      SELECT to_jsonb(d) AS snapshot FROM data_issues d WHERE d.id = ${second?.id as string}
    `;
    for (const label of ['recurrence-1', 'recurrence-2']) {
      const replayed = await runSettleAflApi(sql, f010Options(providerId, label, correctedDate(withScore)));
      expect(replayed.counters.canonicalApplyRefusals).toBe(1);
    }
    const [humanAfter] = await sql<{ snapshot: Record<string, unknown> }[]>`
      SELECT to_jsonb(d) AS snapshot FROM data_issues d WHERE d.id = ${second?.id as string}
    `;
    expect(humanAfter.snapshot).toEqual(humanRow.snapshot);
    const everything = await identityFindingsFor(providerId);
    expect(everything).toHaveLength(3);
    expect(everything.filter((row) => row.resolvedAt === null)).toHaveLength(1);
    expect(await canonicalSnapshot(keyA, providerId)).toEqual(settled);
  }, 60_000);

  it('a correction whose proposed identity is already another match\'s is refused with both rows untouched; a round correction is withheld as one group; a supervised repair of the canonical row is recognised and heals the finding', async () => {
    const target = CASE_IDS.identityCollision;
    const other = CASE_IDS.identityCollisionOther;
    const keyTarget = matchKeyFor(target);
    const keyOther = matchKeyFor(other);
    const keyRepaired = identityCorrectedMatchKey();

    // Setup: two independent canonical matches, both afl_api-owned.
    //
    // I244-F030: the two differ ONLY by date (same season, clubs and round), which is precisely
    // what the settle now refuses to INSERT when the second is offered — that shape cannot be
    // told from one fixture whose date the provider disagrees about. The target is therefore
    // settled normally and `other` is seeded directly as the afl_api-owned row a settle would
    // have left (same key, same owner, same provider id). Nothing below depends on how `other`
    // was created: the collision, round and repair steps all resolve `target` by PROVIDER ID.
    const createdTarget = await runSettleAflApi(sql, f010Options(target, 'create-target', unitSourceFor(target)));
    expect(createdTarget.applied).toBe(true);
    expect(createdTarget.counters.canonicalRowsInserted).toBeGreaterThan(0);
    await seedCanonicalMatch(sql, {
      season: SEASON, roundCode: 'PF', roundType: 'preliminary_final', date: matchDateFor(other), owner: 'afl_api',
    }, other);
    const targetBefore = await canonicalSnapshot(keyTarget, target);
    const otherBefore = await canonicalSnapshot(keyOther, other);
    const targetId = (targetBefore.match as Record<string, any>).id as number;
    const otherId = (otherBefore.match as Record<string, any>).id as number;
    expect(targetId).not.toBe(otherId);

    // COLLISION — the provider now says the target match is played on the OTHER match's date, so
    // its rendered identity is the other row's key. Nothing is written: no unique violation, no
    // overwrite, no merge, no delete; both rows are byte-identical and one finding names both keys.
    const collide = await runSettleAflApi(sql, f010Options(
      target, 'collide', sourceWithMatchDate(target, matchDateFor(other)),
    ));
    expect(collide.applied).toBe(true);
    expect(collide.counters.canonicalApplyFailures).toBe(0);
    expect(collide.counters.canonicalApplyRefusals).toBe(1);
    expect(collide.counters.canonicalRowsUpdated).toBe(0);
    expect(collide.counters.derivedRecomputeRuns).toBe(0);
    expect(await canonicalSnapshot(keyTarget, target)).toEqual(targetBefore);
    expect(await canonicalSnapshot(keyOther, other)).toEqual(otherBefore);
    const [{ holders }] = await sql<{ holders: number }[]>`
      SELECT count(*)::int AS holders FROM matches WHERE match_key = ${keyOther}
    `;
    expect(holders).toBe(1);
    expect((await matchRowByKey(keyOther)).id).toBe(otherId);
    const [collision] = await identityFindingsFor(target);
    expect(collision.resolvedAt).toBeNull();
    expect(collision.entityId).toBe(String(targetId));
    expect(collision.details).toMatchObject({
      refusal: 'identity_change_requires_review', fields: ['match_date'],
      canonical_match_key: keyTarget, provider_match_key: keyOther,
    });
    expect(await identityFindingsFor(other)).toHaveLength(0);

    // ROUND — the provider re-labels the same match as a home-and-away round. round_code, round_number,
    // round_type and is_final are CHECK-bound to one another, so they are withheld together and the
    // row keeps a self-consistent finals identity. The SAME finding is refreshed with current evidence.
    const rerounded = await runSettleAflApi(sql, f010Options(
      target, 'round', unitSourceFor(target, toHomeAndAwayRound),
    ));
    expect(rerounded.counters.canonicalApplyFailures).toBe(0);
    expect(rerounded.counters.canonicalApplyRefusals).toBe(1);
    expect(rerounded.counters.canonicalRowsUpdated).toBe(0);
    expect(rerounded.counters.derivedRecomputeRuns).toBe(0);
    expect(rerounded.counters.dataIssuesOpened).toBe(0);
    expect(rerounded.counters.dataIssuesRefreshed).toBe(1);
    const afterRound = await matchRowByKey(keyTarget);
    expect(afterRound.round_code).toBe('PF');
    expect(afterRound.is_final).toBe(true);
    expect(await canonicalSnapshot(keyTarget, target)).toEqual(targetBefore);
    const [roundFinding] = await identityFindingsFor(target);
    expect(roundFinding.id).toBe(collision.id);
    expect(roundFinding.details.fields).toEqual(['is_final', 'round_code', 'round_number', 'round_type']);

    // SUPERVISED REPAIR — a human decides the provider is right and corrects the canonical row (the
    // one path that may move an identity: it updates the columns AND the key together). The AFL API
    // settle never does this, but it must recognise the repaired row through the provider id, apply
    // nothing, and close the finding rather than leave it stale.
    await sql`
      UPDATE matches SET match_date = ${IDENTITY_CORRECTED_DATE}::date, match_key = ${keyRepaired}
       WHERE id = ${targetId}
    `;
    const repaired = await runSettleAflApi(sql, f010Options(
      target, 'repaired', sourceWithMatchDate(target, IDENTITY_CORRECTED_DATE),
    ));
    expect(repaired.counters.canonicalApplyFailures).toBe(0);
    expect(repaired.counters.canonicalApplyRefusals).toBe(0);
    expect(repaired.counters.canonicalRowsInserted).toBe(0);
    expect(repaired.counters.dataIssuesResolved).toBe(1);
    const [healed] = await identityFindingsFor(target);
    expect(healed.id).toBe(collision.id);
    expect(healed.resolvedAt).not.toBeNull();
    expect(healed.resolution).toBe('canonical_apply_not_needed');
    const [{ rowsForTarget }] = await sql<{ rowsForTarget: number }[]>`
      SELECT count(*)::int AS "rowsForTarget" FROM matches WHERE source_record_id = ${target}
    `;
    expect(rowsForTarget).toBe(1);
    expect((await matchRowByKey(keyRepaired)).id).toBe(targetId);
    expect(await canonicalSnapshot(keyOther, other)).toEqual(otherBefore);
  }, 60_000);
});

/* ------------------------------------------------------------------ *
 * AFLDB-ISSUE-244 I244-F030 — an unresolved record is not proof that no canonical fixture exists
 *
 * A provider-id miss and an exact match_key miss prove only that this source could not FIND a
 * row. A row another source owns has no AFL API provider id, and a one-component round or date
 * disagreement renders a different match_key, so both lookups miss for exactly the fixture that
 * already has a canonical row — and the settle used to INSERT a second one. It now refuses, at
 * planning and again inside the applier's savepoint, when a canonical row of ANY owner has the
 * same season and oriented clubs and differs in at most one of round/date.
 *
 * The canonical fixtures the provider record is compared with are SEEDED (`F030_SEEDS`), never
 * settled: the settle refuses to create them. Every fixture is namespaced and removed by exact
 * match_key in cleanup(); every case starts from the baseline `beforeEach` rebuilds.
 * ------------------------------------------------------------------ */

function f030Options(providerId: string, label: string, overrides: { apply?: boolean } = {}) {
  return {
    bundle: {
      ...buildBundle([unitSourceFor(providerId)], registry, identities),
      snapshotLabel: `issue228-integration-${providerId}-f030-${label}`,
    },
    registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    ...overrides,
  };
}

/** Every `afl_api_match_identity_refusal` finding (open or resolved) for one provider match, oldest first. */
async function matchIdentityRefusalsFor(providerId: string): Promise<ApplyFindingRow[]> {
  const rows = await sql<ApplyFindingRow[]>`
    SELECT id::text AS id, resolved_at AS "resolvedAt", resolution, severity::text AS severity,
           entity_id::text AS "entityId", details
      FROM data_issues
     WHERE issue_type = 'afl_api_match_identity_refusal'
       AND issue_key = ${`afl_api|match|${providerId}|matches`}
     ORDER BY id
  `;
  return [...rows];
}

/** Every automatic-apply `canonical_apply_failed` finding for one provider match target, oldest first. */
async function applyRefusalFindingsForMatchTarget(providerId: string, targetTable: string): Promise<ApplyFindingRow[]> {
  const rows = await sql<ApplyFindingRow[]>`
    SELECT id::text AS id, resolved_at AS "resolvedAt", resolution, severity::text AS severity,
           entity_id::text AS "entityId", details
      FROM data_issues
     WHERE issue_type = 'canonical_apply_failed'
       AND issue_key = ${`afl_api|apply|match|${providerId}|${targetTable}`}
     ORDER BY id
  `;
  return [...rows];
}

/**
 * Everything a settle of one provider record could have written that depends on its match: the
 * afl_api-owned match, its period and player rows, its ledger rows and its typed projections.
 * A refused record leaves all of it at zero.
 */
type ProviderFootprint = {
  matchesOwned: number; periods: number; playerStats: number; bridgedPlayerStats: number;
  ledger: number; matchProjection: number; playerProjection: number;
};
const NO_FOOTPRINT: ProviderFootprint = {
  matchesOwned: 0, periods: 0, playerStats: 0, bridgedPlayerStats: 0, ledger: 0, matchProjection: 0, playerProjection: 0,
};
async function providerFootprint(providerId: string): Promise<ProviderFootprint> {
  const [row] = await sql<ProviderFootprint[]>`
    SELECT
      (SELECT count(*)::int FROM matches
        WHERE source_id = ${aflApiSourceId} AND source_record_id = ${providerId}) AS "matchesOwned",
      (SELECT count(*)::int FROM match_period_scores
        WHERE source_id = ${aflApiSourceId} AND source_record_id = ${providerId}) AS "periods",
      (SELECT count(*)::int FROM player_match_stats
        WHERE source_id = ${aflApiSourceId} AND source_record_id LIKE ${`${providerId}|%`}) AS "playerStats",
      (SELECT count(*)::int FROM player_match_stats WHERE player_id = ${bridgedPlayerId}) AS "bridgedPlayerStats",
      (SELECT count(*)::int FROM canonical_applications
        WHERE external_record_id = ${providerId} OR external_record_id LIKE ${`${providerId}|%`}) AS "ledger",
      (SELECT count(*)::int FROM staging.afl_api_match WHERE external_record_id = ${providerId}) AS "matchProjection",
      (SELECT count(*)::int FROM staging.afl_api_player_match WHERE provider_match_id = ${providerId}) AS "playerProjection"
  `;
  return row;
}

/**
 * A real connection whose settle transaction COMMITS A SECOND CONNECTION'S WRITE right after the
 * planner's plausibility query has come back empty — the smallest deterministic stand-in for
 * "a fixture appeared after planning". Test-side only, exactly like `sqlFailingOnBatchFinalisation()`:
 * production carries no hook, sleep or synchronisation point. The one statement it recognises is the
 * F030 helper's own SELECT (it alone reads `matches m` and projects `"sourceId"`) on the transaction
 * handle; the applier's re-check runs on a savepoint handle this wrapper deliberately does not wrap,
 * so it sees the committed row for real.
 */
function sqlCommittingAfterPlanning(
  real: postgres.Sql, afterPlanning: () => Promise<void>,
): { sql: postgres.Sql; fired: () => boolean } {
  let fired = false;
  const isPlausibilityQuery = (strings: unknown): boolean => {
    if (!Array.isArray(strings)) return false;
    const text = strings.join('?');
    return text.includes('FROM matches m') && text.includes('AS "sourceId"');
  };
  const wrapTransaction = (tx: postgres.TransactionSql): postgres.TransactionSql => new Proxy(tx, {
    apply(target, thisArg, args: unknown[]) {
      const pending = Reflect.apply(target, thisArg, args);
      if (fired || !isPlausibilityQuery(args[0])) return pending;
      return Promise.resolve(pending).then(async (rows: unknown) => {
        // Only the planner's call can be the first one, and only an EMPTY answer is worth racing.
        if (Array.isArray(rows) && rows.length === 0) {
          fired = true;
          await afterPlanning();
        }
        return rows;
      });
    },
  });
  const wrapped = new Proxy(real, {
    get(target, property) {
      if (property === 'begin') {
        return (callback: (tx: postgres.TransactionSql) => unknown) =>
          target.begin((tx) => callback(wrapTransaction(tx)) as never);
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as postgres.Sql;
  return { sql: wrapped, fired: () => fired };
}

describe('AFLDB-ISSUE-244 I244-F030 — an unresolved record vs a canonical fixture that may already be the same match', () => {
  it('a DATE disagreement with a foreign-owned fixture refuses the INSERT durably; a replay refreshes the one finding; nothing dependent is written and the foreign row is byte-identical', async () => {
    const providerId = CASE_IDS.possibleDate;
    const providerKey = matchKeyFor(providerId);
    const foreign = await seedCanonicalMatch(sql, F030_SEEDS.dateForeign);
    const foreignBefore = await matchRowByKey(foreign.matchKey);
    expect(foreignBefore.source_id).toBe(afltablesSourceId);
    // Both lookups the settle used to trust MUST miss, or this case proves nothing: the provider id is
    // unknown to the canonical table and the two renderings differ (same round, one day apart).
    expect(providerKey).not.toBe(foreign.matchKey);
    expect(await providerFootprint(providerId)).toEqual(NO_FOOTPRINT);

    // A dry-run decides in its own transaction and rolls the finding back with it.
    const dry = await runSettleAflApi(sql, f030Options(providerId, 'dry', { apply: false }));
    expect(dry.rollbackReason).toBe('dry_run');
    expect(await matchIdentityRefusalsFor(providerId)).toHaveLength(0);

    // RUN 1 — refused, durable, nothing written.
    const refused = await runSettleAflApi(sql, f030Options(providerId, 'refused'));
    expect(refused.applied).toBe(true);
    expect(refused.halt).toBeNull();
    expect(refused.counters.canonicalRowsInserted).toBe(0);
    expect(refused.counters.canonicalRowsUpdated).toBe(0);
    expect(refused.counters.canonicalApplicationsLogged).toBe(0);
    expect(refused.counters.canonicalApplyFailures).toBe(0);
    expect(refused.counters.unresolvedIdentityMatch).toBe(1);
    expect(refused.counters.derivedRecomputeRuns).toBe(0);
    expect(refused.counters.candidatesCreated).toBe(0);
    expect(refused.counters.dataIssuesOpened).toBe(1);
    // No second fixture, no dependent row, no typed projection; the foreign row and its owner untouched.
    expect(await providerFootprint(providerId)).toEqual(NO_FOOTPRINT);
    expect((await matchRowByKey(foreign.matchKey))).toEqual(foreignBefore);
    const [{ fixtures }] = await sql<{ fixtures: number }[]>`
      SELECT count(*)::int AS fixtures FROM matches
       WHERE match_key = ANY(${[providerKey, foreign.matchKey]}::text[])
    `;
    expect(fixtures).toBe(1);

    const [first] = await matchIdentityRefusalsFor(providerId);
    expect(first.resolvedAt).toBeNull();
    expect(first.severity).toBe('error');
    expect(first.entityId).toBeNull();
    expect(first.details).toMatchObject({
      owner: SETTLE_ISSUE_OWNER, source_key: 'afl_api', external_record_id: providerId,
      reason: 'possible_existing_match', detail: `matches.id ${foreign.id}`,
      provider_match_key: providerKey,
      candidates: [{ match_id: foreign.id, match_key: foreign.matchKey, source_id: afltablesSourceId }],
      issue: 'AFLDB-ISSUE-244 I244-F030',
    });
    // The existing refusal contract: one import rejection for the record, counted by the batch (F008).
    const batch = await importBatchRow(refused.batchId as string);
    expect(batch.recordsRejected).toBe(1);
    expect(batch.rejectionRows).toBe(1);
    const [rejection] = await sql<{ reason: string }[]>`
      SELECT reason FROM import_rejections WHERE import_batch_id = ${refused.batchId as string}::bigint
    `;
    expect(rejection.reason).toBe('matches: possible_existing_match');

    // IDENTICAL REPLAY — the same one open finding is refreshed in place; still nothing written.
    const replay = await runSettleAflApi(sql, f030Options(providerId, 'replay'));
    expect(replay.counters.canonicalRowsInserted).toBe(0);
    expect(replay.counters.dataIssuesOpened).toBe(0);
    expect(replay.counters.dataIssuesRefreshed).toBe(1);
    const afterReplay = await matchIdentityRefusalsFor(providerId);
    expect(afterReplay).toHaveLength(1);
    expect(afterReplay[0].id).toBe(first.id);
    expect(afterReplay[0].resolvedAt).toBeNull();
    expect(await providerFootprint(providerId)).toEqual(NO_FOOTPRINT);
    expect((await matchRowByKey(foreign.matchKey))).toEqual(foreignBefore);
  }, 60_000);

  it('a ROUND disagreement (same date, a different round) refuses in exactly the same way', async () => {
    const providerId = CASE_IDS.possibleRound;
    const providerKey = matchKeyFor(providerId);
    const foreign = await seedCanonicalMatch(sql, F030_SEEDS.roundForeign);
    const foreignBefore = await matchRowByKey(foreign.matchKey);
    expect(String(foreignBefore.match_date)).toBe(matchDateFor(providerId)); // same date...
    expect(foreignBefore.round_code).toBe('SF'); // ...a different round: PF vs SF
    expect(providerKey).not.toBe(foreign.matchKey);

    const refused = await runSettleAflApi(sql, f030Options(providerId, 'refused'));
    expect(refused.applied).toBe(true);
    expect(refused.counters.canonicalRowsInserted).toBe(0);
    expect(refused.counters.canonicalApplicationsLogged).toBe(0);
    expect(refused.counters.unresolvedIdentityMatch).toBe(1);
    expect(refused.counters.dataIssuesOpened).toBe(1);
    expect(await providerFootprint(providerId)).toEqual(NO_FOOTPRINT);
    expect((await matchRowByKey(foreign.matchKey))).toEqual(foreignBefore);
    const [finding] = await matchIdentityRefusalsFor(providerId);
    expect(finding.resolvedAt).toBeNull();
    expect(finding.details).toMatchObject({
      reason: 'possible_existing_match', provider_match_key: providerKey,
      candidates: [{ match_id: foreign.id, match_key: foreign.matchKey, source_id: afltablesSourceId }],
    });
  }, 60_000);

  it('SELF-HEAL: once a supervised correction makes the renderings agree the record resolves normally, ownership is unchanged, the open finding closes, and a human resolution is never rewritten', async () => {
    const providerId = CASE_IDS.possibleHeal;
    const providerKey = matchKeyFor(providerId);
    const foreign = await seedCanonicalMatch(sql, F030_SEEDS.healForeign);

    // Refused; the finding is open.
    const refused = await runSettleAflApi(sql, f030Options(providerId, 'refused'));
    expect(refused.counters.unresolvedIdentityMatch).toBe(1);
    const [first] = await matchIdentityRefusalsFor(providerId);
    expect(first.resolvedAt).toBeNull();

    // HUMAN-RESOLVED + PERSISTENT AMBIGUITY: a super admin closes it, the ambiguity persists. The
    // historical row is left exactly as it is; ONE fresh open row appears beside it (the F009/F010
    // lifecycle); a further replay refreshes only that one.
    await sql`
      UPDATE data_issues SET resolved_at = now(), resolution = 'accepted: reviewed by a human'
       WHERE id = ${first.id}
    `;
    const [humanBefore] = await sql<{ snapshot: Record<string, unknown> }[]>`
      SELECT to_jsonb(d) AS snapshot FROM data_issues d WHERE d.id = ${first.id}
    `;
    const persistent = await runSettleAflApi(sql, f030Options(providerId, 'persistent'));
    expect(persistent.counters.dataIssuesOpened).toBe(1);
    const persistentAgain = await runSettleAflApi(sql, f030Options(providerId, 'persistent-replay'));
    expect(persistentAgain.counters.dataIssuesOpened).toBe(0);
    expect(persistentAgain.counters.dataIssuesRefreshed).toBe(1);
    const both = await matchIdentityRefusalsFor(providerId);
    expect(both).toHaveLength(2);
    const open = both.filter((row) => row.resolvedAt === null);
    expect(open).toHaveLength(1);
    expect(open[0].id).not.toBe(first.id);
    const [humanAfter] = await sql<{ snapshot: Record<string, unknown> }[]>`
      SELECT to_jsonb(d) AS snapshot FROM data_issues d WHERE d.id = ${first.id}
    `;
    expect(humanAfter.snapshot).toEqual(humanBefore.snapshot);
    expect(await providerFootprint(providerId)).toMatchObject({ matchesOwned: 0, periods: 0, playerStats: 0 });

    // SUPERVISED CORRECTION — the one path that may move an identity: the canonical row's date AND its
    // key change together, so the exact-key lookup now resolves it. The AFL API settle never does this.
    await sql`
      UPDATE matches SET match_date = ${matchDateFor(providerId)}::date, match_key = ${providerKey}
       WHERE id = ${foreign.id}
    `;
    const repaired = await matchRowByKey(providerKey);
    expect(repaired.id).toBe(foreign.id);
    expect(repaired.source_id).toBe(afltablesSourceId);

    // The record now resolves through the exact match_key to an afltables-owned row: corroborated,
    // never written, never re-owned. Its stale identity finding closes; the human row does not move.
    const healed = await runSettleAflApi(sql, f030Options(providerId, 'agreed'));
    expect(healed.halt).toBeNull();
    expect(healed.counters.corroboratedForeignOwned).toBe(1);
    expect(healed.counters.unresolvedIdentityMatch).toBe(0);
    expect(healed.counters.canonicalApplyFailures).toBe(0);
    expect(healed.counters.dataIssuesResolved).toBe(1);
    const afterHeal = await matchIdentityRefusalsFor(providerId);
    expect(afterHeal).toHaveLength(2);
    const closed = afterHeal.find((row) => row.id === open[0].id);
    expect(closed?.resolvedAt).not.toBeNull();
    expect(closed?.resolution).toBe('match_identity_resolved');
    const [humanFinal] = await sql<{ snapshot: Record<string, unknown> }[]>`
      SELECT to_jsonb(d) AS snapshot FROM data_issues d WHERE d.id = ${first.id}
    `;
    expect(humanFinal.snapshot).toEqual(humanBefore.snapshot);
    // The matches row is untouched and still afltables-owned; the match itself gained no ledger row.
    // (A bridged player's own player_match_stats row may legitimately land against a corroborated match.)
    expect(await matchRowByKey(providerKey)).toEqual(repaired);
    const [{ matchLedger }] = await sql<{ matchLedger: number }[]>`
      SELECT count(*)::int AS "matchLedger" FROM canonical_applications
       WHERE external_record_id = ${providerId} AND target_table IN ('matches', 'match_period_scores')
    `;
    expect(matchLedger).toBe(0);
    expect((await providerFootprint(providerId)).matchesOwned).toBe(0);

    // A further replay resolves nothing new and rewrites neither row.
    const settledAgain = await runSettleAflApi(sql, f030Options(providerId, 'agreed-replay'));
    expect(settledAgain.counters.dataIssuesResolved).toBe(0);
    const [closedAgain] = (await matchIdentityRefusalsFor(providerId)).filter((row) => row.id === open[0].id);
    expect(closedAgain.resolvedAt).toEqual(closed?.resolvedAt);
  }, 90_000);

  it('NEGATIVE CONTROL: a genuine second meeting — round AND date both differ — is not blocked and inserts normally', async () => {
    const providerId = CASE_IDS.secondMeeting;
    const providerKey = matchKeyFor(providerId);
    const foreign = await seedCanonicalMatch(sql, F030_SEEDS.secondForeign);
    const foreignBefore = await matchRowByKey(foreign.matchKey);
    // Two components differ (PF vs SF, and a day apart): outside the one-component budget.
    expect(foreignBefore.round_code).toBe('SF');
    expect(String(foreignBefore.match_date)).not.toBe(matchDateFor(providerId));

    const created = await runSettleAflApi(sql, f030Options(providerId, 'created'));
    expect(created.applied).toBe(true);
    expect(created.counters.canonicalApplyFailures).toBe(0);
    expect(created.counters.canonicalApplyRefusals).toBe(0);
    expect(created.counters.unresolvedIdentityMatch).toBe(0);
    expect(created.counters.canonicalRowsInserted).toBeGreaterThan(0);
    expect(await matchIdentityRefusalsFor(providerId)).toHaveLength(0);
    const inserted = await matchRowByKey(providerKey);
    expect(inserted.source_id).toBe(aflApiSourceId);
    expect(inserted.id).not.toBe(foreign.id);
    expect(await matchRowByKey(foreign.matchKey)).toEqual(foreignBefore);
    const [{ meetings }] = await sql<{ meetings: number }[]>`
      SELECT count(*)::int AS meetings FROM matches
       WHERE match_key = ANY(${[providerKey, foreign.matchKey]}::text[])
    `;
    expect(meetings).toBe(2);
  }, 60_000);

  it('a fixture from a DIFFERENT SEASON never blocks the INSERT, even one that would otherwise be one day from the record', async () => {
    const providerId = CASE_IDS.otherSeason;
    const providerKey = matchKeyFor(providerId);
    const [season2025] = await sql<{ year: number }[]>`SELECT year FROM seasons WHERE year = ${F030_SEEDS.priorSeason.season}`;
    if (!season2025) {
      throw new Error('afldb_test must hold a seasons row for 2025 (matches.season references it) for the F030 cross-season control.');
    }
    const prior = await seedCanonicalMatch(sql, F030_SEEDS.priorSeason);
    const priorBefore = await matchRowByKey(prior.matchKey);
    expect(priorBefore.season).toBe(2025);
    expect(priorBefore.round_code).toBe('PF'); // same clubs, same round, a different date: only the season protects the record

    const created = await runSettleAflApi(sql, f030Options(providerId, 'created'));
    expect(created.applied).toBe(true);
    expect(created.counters.unresolvedIdentityMatch).toBe(0);
    expect(created.counters.canonicalRowsInserted).toBeGreaterThan(0);
    expect(await matchIdentityRefusalsFor(providerId)).toHaveLength(0);
    expect((await matchRowByKey(providerKey)).source_id).toBe(aflApiSourceId);
    expect(await matchRowByKey(prior.matchKey)).toEqual(priorBefore);
  }, 60_000);

  it('club ORIENTATION is exact: the same clubs with home and away swapped are a different fixture, not a candidate', async () => {
    const providerId = CASE_IDS.swappedOrientation;
    const providerKey = matchKeyFor(providerId);
    const swapped = await seedCanonicalMatch(sql, F030_SEEDS.swappedForeign);
    const swappedBefore = await matchRowByKey(swapped.matchKey);
    expect(swappedBefore.home_club_id).toBe(awayClubId);
    expect(swappedBefore.away_club_id).toBe(homeClubId);
    expect(swappedBefore.round_code).toBe('PF'); // same round, one day apart — a candidate if orientation were ignored

    const created = await runSettleAflApi(sql, f030Options(providerId, 'created'));
    expect(created.applied).toBe(true);
    expect(created.counters.unresolvedIdentityMatch).toBe(0);
    expect(created.counters.canonicalRowsInserted).toBeGreaterThan(0);
    expect(await matchIdentityRefusalsFor(providerId)).toHaveLength(0);
    expect((await matchRowByKey(providerKey)).home_club_id).toBe(homeClubId);
    expect(await matchRowByKey(swapped.matchKey)).toEqual(swappedBefore);
  }, 60_000);

  it('MULTIPLE plausible fixtures (any owner, either component) refuse with every candidate listed and none chosen', async () => {
    const providerId = CASE_IDS.possibleMultiple;
    const providerKey = matchKeyFor(providerId);
    // Built from the settle's own constraints: two rows that each differ from the record in exactly ONE
    // component (a day apart / a different round) and from each other in both — no artificial fixture.
    const byDate = await seedCanonicalMatch(sql, F030_SEEDS.multiDate); // afltables-owned
    const byRound = await seedCanonicalMatch(sql, F030_SEEDS.multiRound); // source_id NULL
    const byDateBefore = await matchRowByKey(byDate.matchKey);
    const byRoundBefore = await matchRowByKey(byRound.matchKey);
    expect(byDate.id).toBeLessThan(byRound.id);
    expect(byRoundBefore.source_id).toBeNull();

    const refused = await runSettleAflApi(sql, f030Options(providerId, 'refused'));
    expect(refused.applied).toBe(true);
    expect(refused.counters.canonicalRowsInserted).toBe(0);
    expect(refused.counters.unresolvedIdentityMatch).toBe(1);
    expect(await providerFootprint(providerId)).toEqual(NO_FOOTPRINT);
    const [finding] = await matchIdentityRefusalsFor(providerId);
    expect(finding.resolvedAt).toBeNull();
    expect(finding.details).toMatchObject({
      reason: 'possible_existing_match', provider_match_key: providerKey,
      detail: `matches.id ${byDate.id}, ${byRound.id}`,
      candidates: [
        { match_id: byDate.id, match_key: byDate.matchKey, source_id: afltablesSourceId },
        { match_id: byRound.id, match_key: byRound.matchKey, source_id: null },
      ],
    });
    // Neither was linked, rekeyed, re-owned or otherwise touched, and no third fixture appeared.
    expect(await matchRowByKey(byDate.matchKey)).toEqual(byDateBefore);
    expect(await matchRowByKey(byRound.matchKey)).toEqual(byRoundBefore);
    const [{ atProviderKey }] = await sql<{ atProviderKey: number }[]>`
      SELECT count(*)::int AS "atProviderKey" FROM matches WHERE match_key = ${providerKey}
    `;
    expect(atProviderKey).toBe(0);
  }, 60_000);

  it('APPLY-TIME RECHECK: a plausible fixture committed AFTER planning is still refused inside the savepoint — no match, period or player row, a durable finding naming the reason', async () => {
    const providerId = CASE_IDS.raceAfterPlanning;
    const providerKey = matchKeyFor(providerId);
    // A SECOND connection: the settle transaction holds the suite's only pooled connection.
    const other = postgres(process.env.AFLDB_TEST_DATABASE_URL as string, { max: 1, onnotice: () => {} });
    try {
      let raced: { id: number; matchKey: string } | null = null;
      let racedSnapshot: Record<string, any> | null = null;
      const wrapped = sqlCommittingAfterPlanning(sql, async () => {
        raced = await seedCanonicalMatch(other, F030_SEEDS.raceForeign);
        const [row] = await other<{ snapshot: Record<string, any> }[]>`
          SELECT to_jsonb(m) AS snapshot FROM matches m WHERE m.id = ${raced.id}
        `;
        racedSnapshot = row.snapshot;
      });

      const result = await runSettleAflApi(wrapped.sql, f030Options(providerId, 'race'));

      // The precondition of the whole case: the planner asked, saw NOTHING, and only then did the
      // second connection commit. Without it this would be the planner test again.
      expect(wrapped.fired()).toBe(true);
      const foreign = raced as unknown as { id: number; matchKey: string };
      expect(foreign).not.toBeNull();
      expect(result.applied).toBe(true);
      expect(result.halt).toBeNull();
      expect(result.counters.unresolvedIdentityMatch).toBe(0); // the PLANNER saw no candidate
      expect(result.counters.canonicalApplyFailures).toBe(0); // a refusal, not a rolled-back failure
      expect(result.counters.canonicalRowsInserted).toBe(0);
      expect(result.counters.canonicalRowsUpdated).toBe(0);
      expect(result.counters.canonicalApplicationsLogged).toBe(0);
      expect(result.counters.canonicalApplyRefusals).toBe(2); // the matches target and its dependent period set
      expect(result.counters.derivedRecomputeRuns).toBe(0);
      expect(result.counters.dataIssuesOpened).toBe(2);

      // No second fixture and nothing dependent — the applier stopped the whole fixture, not one table.
      expect(await providerFootprint(providerId)).toMatchObject({
        matchesOwned: 0, periods: 0, playerStats: 0, bridgedPlayerStats: 0, ledger: 0, playerProjection: 0,
      });
      const [{ atProviderKey }] = await sql<{ atProviderKey: number }[]>`
        SELECT count(*)::int AS "atProviderKey" FROM matches WHERE match_key = ${providerKey}
      `;
      expect(atProviderKey).toBe(0);
      expect(await matchRowByKey(foreign.matchKey)).toEqual(racedSnapshot);

      // The reason is visible to an operator, per refused target, under the F009 finding.
      for (const targetTable of ['matches', 'match_period_scores']) {
        const [finding] = await applyRefusalFindingsForMatchTarget(providerId, targetTable);
        expect(finding.resolvedAt).toBeNull();
        expect(finding.severity).toBe('error');
        expect(finding.details).toMatchObject({
          owner: 'AFLDB-ISSUE-122', source_key: 'afl_api', family: 'match', target_table: targetTable,
          external_record_id: providerId, refusal: 'possible_existing_match', match_key: providerKey,
        });
      }
      expect(await matchIdentityRefusalsFor(providerId)).toHaveLength(0);

      // The next run finds the fixture at PLANNING and refuses there, with the candidate named.
      const replay = await runSettleAflApi(sql, f030Options(providerId, 'race-replay'));
      expect(replay.counters.unresolvedIdentityMatch).toBe(1);
      expect(replay.counters.canonicalRowsInserted).toBe(0);
      const [planned] = await matchIdentityRefusalsFor(providerId);
      expect(planned.resolvedAt).toBeNull();
      expect(planned.details).toMatchObject({
        reason: 'possible_existing_match',
        candidates: [{ match_id: foreign.id, match_key: foreign.matchKey, source_id: afltablesSourceId }],
      });
      expect(await matchRowByKey(foreign.matchKey)).toEqual(racedSnapshot);
    } finally {
      await other.end({ timeout: 5 });
    }
  }, 90_000);
});

/**
 * AFLDB-ISSUE-235 (I1). Migration 104's `uq_external_identities_afl_api_player` — one
 * `afl_api` provider per player, across BOTH writers (loader `unique` and admin
 * `resolved` alike, since the predicate binds on `source_id`, not `match_method`).
 *
 * Fully self-contained: its own synthetic player (a distinct legacy_player_id, never
 * shared with the rest of this file) and its own cleanup, independent of the suite's
 * match-settle fixtures and `cleanup()`/`seedBaseline()` above. Nothing here calls
 * `runSettleAflApi()`.
 */
describe('AFLDB-ISSUE-235 (I1): migration 104 one-afl_api-provider-per-player index', () => {
  // Literal ids from the shared ownership registry, so the leftover gate counts exactly these.
  const I1_LEGACY_PLAYER_ID = I1_FIXTURE.legacyPlayerId;
  const I1_PROVIDER_A = I1_FIXTURE.providerA;
  const I1_PROVIDER_B = I1_FIXTURE.providerB;
  const I1_AFLTABLES_EXTERNAL_ID = I1_FIXTURE.afltablesId;
  let i1AflApiSourceId: number;
  let i1AfltablesSourceId: number;
  let i1PlayerId: number;

  async function i1Cleanup(): Promise<void> {
    await sql`
      DELETE FROM external_identities
       WHERE (source_id = ${i1AflApiSourceId} AND external_id IN (${I1_PROVIDER_A}, ${I1_PROVIDER_B}))
          OR (source_id = ${i1AfltablesSourceId} AND external_id = ${I1_AFLTABLES_EXTERNAL_ID})
    `;
    await sql`DELETE FROM players WHERE legacy_player_id = ${I1_LEGACY_PLAYER_ID}`;
  }

  beforeAll(async () => {
    const [afl] = await sql<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afl_api'`;
    const [aft] = await sql<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afltables'`;
    if (!afl || !aft) throw new Error("sources 'afl_api' and 'afltables' must both exist on afldb_test.");
    i1AflApiSourceId = afl.id;
    i1AfltablesSourceId = aft.id;

    await i1Cleanup(); // idempotent: clears any residue from an interrupted prior run

    const [player] = await sql<{ id: number }[]>`
      INSERT INTO players (legacy_player_id, display_name, sort_name, search_name, slug, given_name, surname)
      VALUES (
        ${I1_LEGACY_PLAYER_ID},
        'ISSUE-235 I1 Test Player', 'Test Player, ISSUE-235 I1', 'issue 235 i1 test player',
        'issue-235-i1-test-player', 'Issue235I1', 'TestPlayer'
      )
      ON CONFLICT (legacy_player_id) DO UPDATE SET display_name = EXCLUDED.display_name
      RETURNING id
    `;
    i1PlayerId = player.id;
  });

  afterAll(async () => {
    // Do NOT close `sql` here: it is the file's shared module-level connection, and the
    // root-level afterAll (above, outside any describe) still needs it open to run its
    // own cleanup() before it calls sql.end() itself — nested-describe afterAll hooks run
    // before the root's, so closing it here would break that teardown.
    await i1Cleanup();
  });

  it('exists, with predicate source_id = <afl_api id> AND player_id IS NOT NULL', async () => {
    const [index] = await sql<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'external_identities'
         AND indexname = 'uq_external_identities_afl_api_player'
    `;
    expect(index).toBeDefined();
    expect(index.indexdef).toMatch(/UNIQUE INDEX uq_external_identities_afl_api_player/);
    expect(index.indexdef).toContain('(player_id)');
    expect(index.indexdef).toContain(`source_id = ${i1AflApiSourceId}`);
    expect(index.indexdef).toContain('player_id IS NOT NULL');
  });

  it('raises 23505 on a second afl_api row for the same player', async () => {
    await sql`
      INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
      VALUES (${i1AflApiSourceId}, ${I1_PROVIDER_A}, ${i1PlayerId}, 'unique', 1, 'afl_api_stat_vector_season')
    `;
    await expect(sql`
      INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
      VALUES (${i1AflApiSourceId}, ${I1_PROVIDER_B}, ${i1PlayerId}, 'unique', 1, 'afl_api_stat_vector_season')
    `).rejects.toMatchObject({ code: '23505' });

    // Exactly the first row survives; the rejected INSERT wrote nothing.
    const rows = await sql<{ external_id: string }[]>`
      SELECT external_id FROM external_identities
       WHERE source_id = ${i1AflApiSourceId} AND player_id = ${i1PlayerId}
    `;
    expect(rows.map((r) => r.external_id)).toEqual([I1_PROVIDER_A]);
  });

  it('still allows two rows for the same player under another source (the predicate binds on source_id)', async () => {
    // The afl_api row from the previous case is still in place; a DIFFERENT source's
    // identity row for the SAME player is unaffected by the afl_api-scoped index.
    await sql`
      INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
      VALUES (${i1AfltablesSourceId}, ${I1_AFLTABLES_EXTERNAL_ID}, ${i1PlayerId}, 'unique', 1, 'afltables_profile_url')
    `;
    const rows = await sql<{ source_id: number; external_id: string }[]>`
      SELECT source_id, external_id FROM external_identities WHERE player_id = ${i1PlayerId} ORDER BY source_id
    `;
    expect(rows).toEqual(expect.arrayContaining([
      { source_id: i1AflApiSourceId, external_id: I1_PROVIDER_A },
      { source_id: i1AfltablesSourceId, external_id: I1_AFLTABLES_EXTERNAL_ID },
    ]));
  });
});

/**
 * AFLDB-ISSUE-235 (I14). The OD-3/D15 replay (`tools/migration/replay_afl_api_adjudications.ts`).
 * Fully self-contained: its own synthetic players, its own disabled credential-less actor
 * (`I14_FIXTURE.actorEmail` — a freshly rebuilt afldb_test has zero `auth_users` rows, so no
 * existing account is ever borrowed), its own ledger rows, and a teardown
 * (`cleanupI14Fixtures()`) that selects by I14's literal ids only, so it is safe to run after a
 * `beforeAll` that failed part-way. Independent of every other describe block in this file.
 */
describe('AFLDB-ISSUE-235 (I14): afl_api adjudication replay', () => {
  // Literal ids from the shared ownership registry, so the leftover gate counts exactly these.
  const I14_LEGACY_PLAYER_ID_A = I14_FIXTURE.legacyPlayerIdA;
  const I14_LEGACY_PLAYER_ID_B = I14_FIXTURE.legacyPlayerIdB;
  const I14_AFLTABLES_EXTERNAL_ID_A = I14_FIXTURE.afltablesIdA;
  const I14_AFLTABLES_EXTERNAL_ID_B = I14_FIXTURE.afltablesIdB;
  const I14_PROVIDER_LINKED = I14_FIXTURE.providerLinked;
  const I14_PROVIDER_REVOKED = I14_FIXTURE.providerRevoked;
  let i14AflApiSourceId: number;
  let i14AfltablesSourceId: number;
  let i14PlayerIdA: number;
  let i14PlayerIdB: number;
  let i14AdminUserId: number;

  beforeAll(async () => {
    await cleanupI14Fixtures(sql);
    const refs = await loadS6Refs(sql);
    i14AflApiSourceId = refs.aflApiSourceId;
    i14AfltablesSourceId = refs.afltablesSourceId;
    i14AdminUserId = await seedI14Actor(sql);

    const [playerA] = await sql<{ id: number }[]>`
      INSERT INTO players (legacy_player_id, display_name, sort_name, search_name, slug, given_name, surname)
      VALUES (${I14_LEGACY_PLAYER_ID_A}, 'ISSUE-235 I14 Test Player A', 'Test Player A, ISSUE-235 I14',
              'issue 235 i14 test player a', 'issue-235-i14-test-player-a', 'Issue235I14', 'TestPlayerA')
      ON CONFLICT (legacy_player_id) DO UPDATE SET display_name = EXCLUDED.display_name
      RETURNING id
    `;
    i14PlayerIdA = playerA.id;
    const [playerB] = await sql<{ id: number }[]>`
      INSERT INTO players (legacy_player_id, display_name, sort_name, search_name, slug, given_name, surname)
      VALUES (${I14_LEGACY_PLAYER_ID_B}, 'ISSUE-235 I14 Test Player B', 'Test Player B, ISSUE-235 I14',
              'issue 235 i14 test player b', 'issue-235-i14-test-player-b', 'Issue235I14', 'TestPlayerB')
      ON CONFLICT (legacy_player_id) DO UPDATE SET display_name = EXCLUDED.display_name
      RETURNING id
    `;
    i14PlayerIdB = playerB.id;

    await sql`
      INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
      VALUES (${i14AfltablesSourceId}, ${I14_AFLTABLES_EXTERNAL_ID_A}, ${i14PlayerIdA}, 'unique', 1, 'afltables_profile_url')
    `;
    await sql`
      INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
      VALUES (${i14AfltablesSourceId}, ${I14_AFLTABLES_EXTERNAL_ID_B}, ${i14PlayerIdB}, 'unique', 1, 'afltables_profile_url')
    `;
  });

  afterAll(async () => {
    // Do NOT close `sql` here -- see the I1 describe block's own note above. Literal ids only:
    // no setup value is interpolated, so a failed beforeAll cannot cascade into this.
    await cleanupI14Fixtures(sql);
  });

  it('I14 — the replay re-derives the current player_id from player_identity (never trusts a stale stored value), is idempotent, and passes the bijection check', async () => {
    const { replayAflApiAdjudications, assertAflApiAdjudicationBijection } =
      await import('../../tools/migration/replay_afl_api_adjudications');

    // Numeric-id reuse across a destructive rebuild: the ledger row's OWN player_id column is
    // deliberately WRONG but FK-valid -- it names player B, a real, different player (as an
    // old numeric id reassigned to someone else after a rebuild would), while its durable
    // player_identity still names player A. Migration 104's REFERENCES players(id) forbids a
    // dangling id, and a dangling id would prove less anyway: here a replay that trusted the
    // column would silently link the provider to the WRONG existing player. It must re-derive
    // playerIdA from player_identity alone.
    const stale = i14StaleLedgerRow({ playerIdA: i14PlayerIdA, playerIdB: i14PlayerIdB });
    expect(stale).toEqual({ playerId: i14PlayerIdB, playerIdentity: I14_AFLTABLES_EXTERNAL_ID_A });
    await sql`
      INSERT INTO afl_api_identity_adjudications
            (source_key, external_id, action, player_id, player_identity, evidence, evidence_sha256,
             surname_disagreement_acknowledged, admin_user_id, note)
      VALUES ('afl_api', ${I14_PROVIDER_LINKED}, 'linked', ${stale.playerId}, ${stale.playerIdentity},
              '{"fixture":"I14"}'::jsonb, ${'0'.repeat(64)}, false, ${i14AdminUserId},
              'AFLDB-ISSUE-235 I14 fixture: linked, then re-derived by the replay')
    `;
    // A linked -> revoked pair: net-revoked, must NOT be replayed.
    const [linkedRow] = await sql<{ id: number }[]>`
      INSERT INTO afl_api_identity_adjudications
            (source_key, external_id, action, player_id, player_identity, evidence, evidence_sha256,
             surname_disagreement_acknowledged, admin_user_id, note)
      VALUES ('afl_api', ${I14_PROVIDER_REVOKED}, 'linked', ${i14PlayerIdB}, ${I14_AFLTABLES_EXTERNAL_ID_B},
              '{"fixture":"I14"}'::jsonb, ${'1'.repeat(64)}, false, ${i14AdminUserId},
              'AFLDB-ISSUE-235 I14 fixture: linked then revoked, net-revoked')
      RETURNING id
    `;
    await sql`
      INSERT INTO afl_api_identity_adjudications
            (source_key, external_id, action, player_id, player_identity, evidence, evidence_sha256,
             surname_disagreement_acknowledged, supersedes_id, admin_user_id, note)
      VALUES ('afl_api', ${I14_PROVIDER_REVOKED}, 'revoked', ${i14PlayerIdB}, ${I14_AFLTABLES_EXTERNAL_ID_B},
              '{"fixture":"I14"}'::jsonb, ${'2'.repeat(64)}, false, ${linkedRow.id}, ${i14AdminUserId},
              'AFLDB-ISSUE-235 I14 fixture: the revoke of the row above')
    `;

    const counts = await sql.begin((tx) => replayAflApiAdjudications(tx));
    expect(counts).toEqual({ inserted: 1, noops: 0, stops: [], supersedes: [] });

    const [resolved] = await sql<{ playerId: number; status: string; matchMethod: string }[]>`
      SELECT player_id AS "playerId", status::text AS status, match_method AS "matchMethod"
        FROM external_identities WHERE source_id = ${i14AflApiSourceId} AND external_id = ${I14_PROVIDER_LINKED}
    `;
    expect(resolved).toMatchObject({
      playerId: i14PlayerIdA, status: 'resolved', matchMethod: 'afl_api_admin_adjudication',
    });
    expect(resolved.playerId).not.toBe(stale.playerId); // the stored numeric id was not trusted
    const playerBAflApiRows = await sql<{ id: number }[]>`
      SELECT id FROM external_identities WHERE source_id = ${i14AflApiSourceId} AND player_id = ${i14PlayerIdB}
    `;
    expect(playerBAflApiRows).toHaveLength(0); // player B (the reused id) gained no afl_api link
    const revokedProviderRow = await sql<{ id: number }[]>`
      SELECT id FROM external_identities WHERE source_id = ${i14AflApiSourceId} AND external_id = ${I14_PROVIDER_REVOKED}
    `;
    expect(revokedProviderRow).toHaveLength(0); // net-revoked: never replayed

    await sql.begin((tx) => assertAflApiAdjudicationBijection(tx));

    // A second run is idempotent: the identical row already present is a no-op, not a
    // duplicate or a stop.
    const secondRun = await sql.begin((tx) => replayAflApiAdjudications(tx));
    expect(secondRun).toEqual({ inserted: 0, noops: 1, stops: [], supersedes: [] });
  });
});

/**
 * AFLDB-ISSUE-237 §10 (S6, this issue's own). The importer identity capture/replay adapter
 * (`tools/migration/replay_afl_api_adjudications.ts`, S2) against the real schema, PLUS (this
 * pass) the settle-resolver path (runbook §10/E13: `resolveAflApiPlayer()`,
 * `src/lib/acquisition/afl-api-player-resolver.ts`, resolving a replayed importer row) and the
 * whole-table isolation guard proving this namespace can neither leak into, nor absorb, the
 * ISSUE-235 namespace's rows. A separate, self-contained namespace from every ISSUE-235 fixture
 * (`I237_FIXTURE`, `cleanupI237Fixtures()`, `I237_OWNERSHIP`) — never folded into
 * `ISSUE235_OWNERSHIP` or its leftover gate, so this issue's own exact-count assertions can
 * never be confused with ISSUE-235's.
 */
describe('AFLDB-ISSUE-237 (I237): importer identity capture/replay against afldb_test', () => {
  const f = I237_FIXTURE;
  let i237AflApiSourceId: number;
  let i237AfltablesSourceId: number;
  let i237PlayerIdA: number;
  let i237PlayerIdB: number;
  let i237PlayerIdC: number;
  let i237PlayerIdD: number;
  let i237AdminUserId: number;

  beforeAll(async () => {
    await cleanupI237Fixtures(sql);
    const refs = await loadS6Refs(sql);
    i237AflApiSourceId = refs.aflApiSourceId;
    i237AfltablesSourceId = refs.afltablesSourceId;

    const [actor] = await sql<{ id: number }[]>`
      INSERT INTO auth_users (email, role, password_hash, totp_secret, disabled_at)
      VALUES (${f.actorEmail}, 'super_admin', NULL, NULL, now())
      RETURNING id
    `;
    i237AdminUserId = actor.id;

    const [playerA] = await sql<{ id: number }[]>`
      INSERT INTO players (legacy_player_id, display_name, sort_name, search_name, slug, given_name, surname)
      VALUES (${f.legacyPlayerIdA}, 'ISSUE-237 I237 Test Player A', 'Test Player A, ISSUE-237 I237',
              'issue 237 i237 test player a', 'issue-237-i237-test-player-a', 'Issue237I237', 'TestPlayerA')
      ON CONFLICT (legacy_player_id) DO UPDATE SET display_name = EXCLUDED.display_name
      RETURNING id
    `;
    i237PlayerIdA = playerA.id;
    const [playerB] = await sql<{ id: number }[]>`
      INSERT INTO players (legacy_player_id, display_name, sort_name, search_name, slug, given_name, surname)
      VALUES (${f.legacyPlayerIdB}, 'ISSUE-237 I237 Test Player B', 'Test Player B, ISSUE-237 I237',
              'issue 237 i237 test player b', 'issue-237-i237-test-player-b', 'Issue237I237', 'TestPlayerB')
      ON CONFLICT (legacy_player_id) DO UPDATE SET display_name = EXCLUDED.display_name
      RETURNING id
    `;
    i237PlayerIdB = playerB.id;
    const [playerC] = await sql<{ id: number }[]>`
      INSERT INTO players (legacy_player_id, display_name, sort_name, search_name, slug, given_name, surname)
      VALUES (${f.legacyPlayerIdC}, 'ISSUE-237 I237 Test Player C', 'Test Player C, ISSUE-237 I237',
              'issue 237 i237 test player c', 'issue-237-i237-test-player-c', 'Issue237I237', 'TestPlayerC')
      ON CONFLICT (legacy_player_id) DO UPDATE SET display_name = EXCLUDED.display_name
      RETURNING id
    `;
    i237PlayerIdC = playerC.id;
    const [playerD] = await sql<{ id: number }[]>`
      INSERT INTO players (legacy_player_id, display_name, sort_name, search_name, slug, given_name, surname)
      VALUES (${f.legacyPlayerIdD}, 'ISSUE-237 I237 Test Player D', 'Test Player D, ISSUE-237 I237',
              'issue 237 i237 test player d', 'issue-237-i237-test-player-d', 'Issue237I237', 'TestPlayerD')
      ON CONFLICT (legacy_player_id) DO UPDATE SET display_name = EXCLUDED.display_name
      RETURNING id
    `;
    i237PlayerIdD = playerD.id;

    // Player A's own stable identity, for the renumbering case.
    await sql`
      INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
      VALUES (${i237AfltablesSourceId}, ${f.afltablesIdA}, ${i237PlayerIdA}, 'unique', 1, 'afltables_profile_url')
    `;
    // Player C holds TWO AFL Tables paths -- the D7 ambiguity case.
    await sql`
      INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
      VALUES (${i237AfltablesSourceId}, ${f.afltablesIdC1}, ${i237PlayerIdC}, 'unique', 1, 'afltables_profile_url')
    `;
    await sql`
      INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
      VALUES (${i237AfltablesSourceId}, ${f.afltablesIdC2}, ${i237PlayerIdC}, 'unique', 1, 'afltables_profile_url')
    `;
    // Player D's own stable identity: the §10/E13 settle-resolver case's player only.
    await sql`
      INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
      VALUES (${i237AfltablesSourceId}, ${f.afltablesIdD}, ${i237PlayerIdD}, 'unique', 1, 'afltables_profile_url')
    `;
  });

  // Every case starts with no I237 provider or ledger row, whatever the case before it
  // committed or left behind by throwing -- so each case is reproducible on its own.
  afterEach(async () => {
    await cleanupI237ProviderRows(sql);
  });

  afterAll(async () => {
    await cleanupI237Fixtures(sql);
  });

  it('readAflApiImporterRows — returns the unprefixed identity, and excludes (never silently captures) a two-path player', async () => {
    // Player C's own importer row: structurally a full D5 row, but its player is ambiguous.
    await sql`
      INSERT INTO external_identities
            (source_id, external_id, player_id, status, candidate_count, match_method, external_name)
      VALUES (${i237AflApiSourceId}, ${f.providerAmbiguous}, ${i237PlayerIdC}, 'unique', 1,
              'afl_api_stat_vector_bootstrap', 'Ambiguous Player C')
    `;
    try {
      const result = await sql.begin((tx) => readAflApiImporterRows(tx, i237AflApiSourceId));
      const identity = result.identityByPlayerId.get(i237PlayerIdC);
      expect(identity).toEqual({ ok: false, reason: 'ambiguous' });
      expect(result.rows.some((r) => r.playerId === i237PlayerIdC)).toBe(false);

      // A single-identity player DOES resolve, and the identity is the unprefixed path (no
      // 'afltables:' prefix -- resolvePlayerIdentity()'s own prefixed form is never used here).
      const aResult = await sql.begin((tx) => readAflApiForwardIdentities(tx, [i237PlayerIdA]));
      expect(aResult.get(i237PlayerIdA)).toEqual({ ok: true, identity: f.afltablesIdA, via: 'afltables' });
    } finally {
      await sql`DELETE FROM external_identities WHERE source_id = ${i237AflApiSourceId} AND external_id = ${f.providerAmbiguous}`;
    }
  });

  it('renumbering — the replay never trusts the captured playerId, only the re-derived identity', async () => {
    const STALE_CAPTURED_PLAYER_ID = 999999999; // no real player anywhere near this id
    const captured = {
      externalId: f.providerRenumbered, playerIdentity: f.afltablesIdA,
      matchMethod: 'afl_api_stat_vector_bootstrap' as const, status: 'unique' as const, candidateCount: 1 as const,
      externalName: 'Renumbered Provider', externalUrl: null, notes: null, playerId: STALE_CAPTURED_PLAYER_ID,
    };
    const remap = await sql.begin((tx) => resolveAflApiPlayerIdentity(tx, f.afltablesIdA));
    expect(remap).toEqual({ ok: true, newPlayerId: i237PlayerIdA, remappedIdentity: f.afltablesIdA });

    const result = await sql.begin((tx) => replayAflApiImporterRows(tx, [captured]));
    expect(result).toEqual({ inserted: 1, noops: 0 });

    const [row] = await sql<{ playerId: number }[]>`
      SELECT player_id AS "playerId" FROM external_identities
       WHERE source_id = ${i237AflApiSourceId} AND external_id = ${f.providerRenumbered}
    `;
    expect(row.playerId).toBe(i237PlayerIdA);
    expect(row.playerId).not.toBe(STALE_CAPTURED_PLAYER_ID);

    // A second run of the SAME capture is an idempotent no-op, never a duplicate insert.
    const second = await sql.begin((tx) => replayAflApiImporterRows(tx, [captured]));
    expect(second).toEqual({ inserted: 0, noops: 1 });
  });

  it('D9 STOPs against the real UNIQUE constraint and the per-player index', async () => {
    const capturedAt = (externalId: string, playerIdentity: string, matchMethod: AflApiImporterMatchMethod) => ({
      externalId, playerIdentity, matchMethod, status: 'unique' as const,
      candidateCount: 1 as const, externalName: null, externalUrl: null, notes: null, playerId: 1,
    });
    // The STOP must be the replay's own abort AND name the intended D9 reason -- a bare class
    // check would also pass for a STOP raised for some other, unintended reason.
    const expectReplayAbort = async (attempt: Promise<unknown>, reason: RegExp) => {
      const error = await attempt.then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(AflApiReplayAbort);
      expect((error as Error).message).toMatch(reason);
    };

    // Every row this case seeds is a LEGAL live state under migration 104 (one row per
    // provider, one afl_api provider per player): the per-case `afterEach` guarantees player A
    // and player B hold no I237 provider on entry, so each STOP below is the planner's own
    // refusal, never a constraint violation raised while seeding.

    // A candidate row already exists for this provider, resolved to the SAME player the
    // capture's own identity re-derives, but under a DIFFERENT importer method -> STOP
    // (D9 row 3: "same player, different importer method").
    await sql`
      INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
      VALUES (${i237AflApiSourceId}, ${f.providerMethodConflict}, ${i237PlayerIdA}, 'unique', 1, 'afl_api_manual_adjudication')
    `;
    try {
      await expectReplayAbort(sql.begin((tx) => replayAflApiImporterRows(tx, [
        capturedAt(f.providerMethodConflict, f.afltablesIdA, 'afl_api_stat_vector_bootstrap'),
      ])), /CD_I9992370004 \(an importer row for this provider already exists under a different method or field\)/);
    } finally {
      await sql`DELETE FROM external_identities WHERE source_id = ${i237AflApiSourceId} AND external_id = ${f.providerMethodConflict}`;
    }

    // A human resolved row already exists for this provider -> STOP (cannot occur from a
    // single consistent snapshot; proven anyway, defensively).
    await sql`
      INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
      VALUES (${i237AflApiSourceId}, ${f.providerHumanConflict}, ${i237PlayerIdB}, 'resolved', 0, 'afl_api_admin_adjudication')
    `;
    try {
      await expectReplayAbort(sql.begin((tx) => replayAflApiImporterRows(tx, [
        capturedAt(f.providerHumanConflict, f.afltablesIdA, 'afl_api_stat_vector_bootstrap'),
      ])), /CD_I9992370002 \(a human resolved row already exists for this provider id/);
    } finally {
      await sql`DELETE FROM external_identities WHERE source_id = ${i237AflApiSourceId} AND external_id = ${f.providerHumanConflict}`;
    }

    // Migration 104's per-player UNIQUE index, at BOTH layers. This case seeds its own
    // occupant (never another case's leftover row): player A holds providerRenumbered.
    await sql`
      INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
      VALUES (${i237AflApiSourceId}, ${f.providerRenumbered}, ${i237PlayerIdA}, 'unique', 1, 'afl_api_stat_vector_bootstrap')
    `;
    try {
      // (a) The planner refuses a DIFFERENT provider for the SAME player before any write.
      await expectReplayAbort(sql.begin((tx) => replayAflApiImporterRows(tx, [
        capturedAt(f.providerSupersede, f.afltablesIdA, 'afl_api_stat_vector_bootstrap'),
      ])), new RegExp(
        `CD_I9992370003 \\(player ${i237PlayerIdA} already holds a different afl_api provider \\(CD_I9992370001\\)\\)`,
      ));
      // (b) The real index itself refuses the same state for any writer that bypassed the planner.
      await expect(sql.begin((tx) => tx`
        INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
        VALUES (${i237AflApiSourceId}, ${f.providerSupersede}, ${i237PlayerIdA}, 'unique', 1, 'afl_api_stat_vector_bootstrap')
      `)).rejects.toThrow(/uq_external_identities_afl_api_player/);
      const [{ count }] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM external_identities
         WHERE source_id = ${i237AflApiSourceId} AND external_id = ${f.providerSupersede}
      `;
      expect(count).toBe(0); // neither layer wrote anything
    } finally {
      await sql`DELETE FROM external_identities WHERE source_id = ${i237AflApiSourceId} AND external_id = ${f.providerRenumbered}`;
    }
  });

  it('D15 supersede (OD-2) against the real table — the id is kept, the bijection passes, a second replay is a no-op', async () => {
    // A full D5 importer row, resolved to player B's own identity.
    await sql`
      INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
      VALUES (${i237AfltablesSourceId}, ${f.afltablesIdB}, ${i237PlayerIdB}, 'unique', 1, 'afltables_profile_url')
    `;
    // Reuses the bare `providerSupersede` id: the D9 STOPs test above only ATTEMPTED writes
    // under it (both refused, nothing committed), and the per-case `afterEach` removes every
    // I237 provider row regardless -- safe to use as this test's own real row.
    const supersedeProvider = f.providerSupersede;
    const [importerRow] = await sql<{ id: number }[]>`
      INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
      VALUES (${i237AflApiSourceId}, ${supersedeProvider}, ${i237PlayerIdB}, 'unique', 1, 'afl_api_stat_vector_bootstrap')
      RETURNING id
    `;

    await sql`
      INSERT INTO afl_api_identity_adjudications
            (source_key, external_id, action, player_id, player_identity, evidence, evidence_sha256,
             surname_disagreement_acknowledged, admin_user_id, note)
      VALUES ('afl_api', ${supersedeProvider}, 'linked', ${i237PlayerIdB}, ${f.afltablesIdB},
              '{"fixture":"I237"}'::jsonb, ${'3'.repeat(64)}, false, ${i237AdminUserId},
              'AFLDB-ISSUE-237 I237 fixture: D15 supersede (OD-2)')
    `;

    const counts = await sql.begin((tx) => replayAflApiAdjudications(tx, new Set([supersedeProvider])));
    expect(counts).toEqual({ inserted: 0, noops: 0, stops: [], supersedes: [{ externalId: supersedeProvider, playerId: i237PlayerIdB }] });

    const [after] = await sql<{ id: number; status: string; matchMethod: string; candidateCount: number; externalName: string | null }[]>`
      SELECT id, status::text AS status, match_method AS "matchMethod", candidate_count AS "candidateCount", external_name AS "externalName"
        FROM external_identities WHERE source_id = ${i237AflApiSourceId} AND external_id = ${supersedeProvider}
    `;
    expect(after.id).toBe(importerRow.id); // UPDATEd in place, never replaced
    expect(after).toMatchObject({ status: 'resolved', matchMethod: 'afl_api_admin_adjudication', candidateCount: 0, externalName: null });

    await sql.begin((tx) => assertAflApiAdjudicationBijection(tx));

    // A second run: the row is now identical to what an INSERT would create, so it is a no-op,
    // never a repeated supersede. D13 fixes the expected set from the CURRENT state before any
    // mutation, and the provider is now a human row (no longer a G2.AGREE importer row), so the
    // re-run's expected set is empty. Re-passing the FIRST run's now-stale set must fail closed
    // (D13: actual must equal expected exactly), writing nothing.
    await expect(sql.begin((tx) => replayAflApiAdjudications(tx, new Set([supersedeProvider]))))
      .rejects.toThrow(/supersede set did not match the expected set exactly -- nothing written \(missing: CD_I9992370003; extra: none\)/);
    const second = await sql.begin((tx) => replayAflApiAdjudications(tx, new Set()));
    expect(second).toEqual({ inserted: 0, noops: 1, stops: [], supersedes: [] });
    const [afterSecond] = await sql<{ id: number; status: string; matchMethod: string }[]>`
      SELECT id, status::text AS status, match_method AS "matchMethod"
        FROM external_identities WHERE source_id = ${i237AflApiSourceId} AND external_id = ${supersedeProvider}
    `;
    expect(afterSecond).toEqual({ id: importerRow.id, status: 'resolved', matchMethod: 'afl_api_admin_adjudication' });
  });

  it('the combined invariant passes on this fixture set, and fails for an injected anomaly', async () => {
    // Deliberately WHOLE-TABLE, exactly as production runs it: this also covers the file's root
    // ISSUE-228 baseline row (`BRIDGED_PROVIDER_PLAYER_ID`), which is therefore seeded as a full
    // D5 importer row with its player's AFL Tables identity -- never excluded from the check.
    await sql.begin((tx) => assertAflApiIdentityInvariant(tx));

    // Inject a D5 anomaly scoped to this issue's own reserved provider id: a `unique` row
    // with candidate_count != 1. Cleaned up in the `finally` regardless of outcome.
    await sql`
      INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
      VALUES (${i237AflApiSourceId}, ${f.providerAnomaly}, ${i237PlayerIdA}, 'unique', 2, 'afl_api_stat_vector_bootstrap')
    `;
    try {
      await expect(sql.begin((tx) => assertAflApiIdentityInvariant(tx))).rejects.toThrow(AflApiReplayAbort);
    } finally {
      await sql`DELETE FROM external_identities WHERE source_id = ${i237AflApiSourceId} AND external_id = ${f.providerAnomaly}`;
    }

    // Clean again, so this test leaves the shared table exactly as it found it.
    await sql.begin((tx) => assertAflApiIdentityInvariant(tx));
  });

  /**
   * AFLDB-ISSUE-237 D11d — prerequisite P-M, point 2 ONLY (point 3 was PROVEN by the operator's
   * real `code_test_db` L2 rehearsal, not here; this test is NOT a substitute for it).
   *
   * A database comment lives in the SHARED catalogue `pg_shdescription`, so it is read with
   * `shobj_description()` -- `obj_description()` reads the per-database `pg_description` and
   * always returns NULL for a `pg_database` oid (the L2 proof read it the same way).
   *
   * SAFETY: this test runs the real, destructive `RESET_SQL` constant against the live
   * connection's own database -- but entirely INSIDE one transaction that is always rolled
   * back (`finally`), never committed, exploiting PostgreSQL's fully transactional DDL (the
   * same property `tools/db/prove-reset.ts` already depends on, per `RESET_SQL`'s own header
   * comment). Read this test in full before ever running it outside CI: a mistake in the
   * rollback discipline below would wipe every table `RESET_SQL` touches for real. The
   * `sources` row-count check at the end is a second, independent tripwire -- if the rollback
   * somehow did not undo the reset, this assertion fails loudly rather than the corruption
   * passing silently.
   */
  it('P-M point 2 (D11d) — the database marker survives RESET_SQL, entirely inside one rolled-back transaction', async () => {
    const [{ database, sourcesBefore }] = await sql<{ database: string; sourcesBefore: number }[]>`
      SELECT current_database() AS database, (SELECT count(*)::int FROM sources) AS "sourcesBefore"
    `;
    const [{ before }] = await sql<{ before: string | null }[]>`
      SELECT shobj_description(oid, 'pg_database') AS before FROM pg_database WHERE datname = ${database}
    `;
    const testMarker = `afldb.afl_api_identities.rebuild_capture:P-M-test:${Date.now()}`;

    class RollbackSentinel extends Error {}
    await sql.begin(async (tx) => {
      // Identifiers cannot be bound parameters in DDL; `database` is `current_database()`'s
      // own trusted value, never external input, and is quoted defensively regardless.
      await tx.unsafe(`COMMENT ON DATABASE "${database.replace(/"/g, '""')}" IS '${testMarker.replace(/'/g, "''")}'`);
      const [{ mid }] = await tx<{ mid: string | null }[]>`
        SELECT shobj_description(oid, 'pg_database') AS mid FROM pg_database WHERE datname = ${database}
      `;
      expect(mid).toBe(testMarker);

      // The exact constant `recreate` runs (P-M point 1 already proves it is the ONLY thing
      // that stage does). Must not touch the database-level comment.
      await tx.unsafe(RESET_SQL);
      const [{ afterReset }] = await tx<{ afterReset: string | null }[]>`
        SELECT shobj_description(oid, 'pg_database') AS "afterReset" FROM pg_database WHERE datname = ${database}
      `;
      expect(afterReset).toBe(testMarker);

      throw new RollbackSentinel(); // force the rollback this whole test depends on
    }).catch((error: unknown) => {
      if (!(error instanceof RollbackSentinel)) throw error;
    });

    const [{ after, sourcesAfter }] = await sql<{ after: string | null; sourcesAfter: number }[]>`
      SELECT shobj_description(oid, 'pg_database') AS after,
             (SELECT count(*)::int FROM sources) AS "sourcesAfter"
        FROM pg_database WHERE datname = ${database}
    `;
    expect(after).toBe(before); // the pre-test comment is unchanged after the rollback
    expect(sourcesAfter).toBe(sourcesBefore); // tripwire: the schema was genuinely restored
  });

  it('whole-table isolation guarding — I237_OWNERSHIP never overlaps ISSUE235_OWNERSHIP (DB-free)', () => {
    expect(i237Issue235OwnershipOverlap()).toEqual([]);
  });

  it('§10/E13 — the settle resolver (resolveAflApiPlayer) resolves a replayed importer row through the intended identity path, and refuses one it never replayed', async () => {
    const captured = {
      externalId: f.providerSettleResolver, playerIdentity: f.afltablesIdD, // player D: holds no other I237 provider
      matchMethod: 'afl_api_stat_vector_bootstrap' as const, status: 'unique' as const, candidateCount: 1 as const,
      externalName: 'Settle Resolver Test', externalUrl: null, notes: null,
      playerId: 999999999, // a stale surrogate the resolver must never see or trust (D3)
    };

    // Before the replay, the provider is not linked at all: the resolver reports it unresolved
    // through the SAME query the settle path uses, never a name/fallback guess.
    const before = await resolveAflApiPlayer(sql, i237AflApiSourceId, f.providerSettleResolver);
    expect(before).toEqual({ outcome: 'unresolved' });

    const replay = await sql.begin((tx) => replayAflApiImporterRows(tx, [captured]));
    expect(replay).toEqual({ inserted: 1, noops: 0 });

    // After the replay, the settle resolver's OWN read path resolves it to the CURRENT
    // afldb_test player id (never the captured row's stale playerId).
    const after = await resolveAflApiPlayer(sql, i237AflApiSourceId, f.providerSettleResolver);
    expect(after).toEqual({ outcome: 'resolved', playerId: i237PlayerIdD });
    expect(after).not.toMatchObject({ playerId: captured.playerId });
  });
});

/**
 * AFLDB-ISSUE-235 (I17). The D10 manifest's live-catalogue pin. A read-only catalogue query:
 * no fixture, no setup, no application user — it runs on any migrated afldb_test.
 */
describe('AFLDB-ISSUE-235 (I17): the live D10 manifest pin', () => {
  it('I17 (R1/R2 live pin) — the live afldb_test catalogue matches the D10 manifest exactly', async () => {
    const { validateManifestAgainstCatalogue, AFL_API_PLAYER_REFERENCE_MANIFEST } =
      await import('../../src/lib/acquisition/afl-api-adjudication');
    const catalogueRows = await sql<{ schema: string; table: string; column: string }[]>`
      SELECT n.nspname AS schema, c.relname AS table, a.attname AS column
        FROM pg_attribute a
        JOIN pg_constraint con ON con.conrelid = a.attrelid AND a.attnum = ANY(con.conkey)
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE con.contype = 'f' AND con.confrelid = 'public.players'::regclass
         AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND n.nspname NOT LIKE 'pg_temp_%' AND n.nspname NOT LIKE 'pg_toast_temp_%'
         AND array_length(con.conkey, 1) = 1
    `;
    const problems = validateManifestAgainstCatalogue(catalogueRows, AFL_API_PLAYER_REFERENCE_MANIFEST);
    expect(problems).toEqual([]);
  });
});

/* =================================================================== *
 * AFLDB-ISSUE-235 S6 — the live §10.2 matrix: I2–I7 and I6b–I6d (functional adjudication),
 * I15/I16 (the D15 replay), and the OD-5 recovery observation. I8–I10 (races) live in
 * `player-link-concurrency.test.ts`. Namespace, seeding and teardown are shared with that
 * file through `./afl-api-adjudication-fixtures.ts`.
 *
 * Every adjudication under test goes through the real `linkAflApiProvider()` /
 * `revokeAflApiLink()`, on the import DSN `routeS6ImportDsn()` routes (the `afldb_import`
 * role when `AFLDB_TEST_IMPORT_DATABASE_URL` is set), with the fingerprint the admin page
 * itself would render (`renderS6Form()`). Direct INSERTs are fixture setup only.
 *
 * The root `beforeEach` above rebuilds this file's settle baseline before EVERY case,
 * including these, so the one case that needs shared state across steps (the settle
 * lifecycle) is a single ordered `it`.
 * =================================================================== */

/** The lifecycle case's provider: the golden fixture's unbridged away player, renamed. */
const I235_LIFECYCLE_PROVIDER = s6ProviderId(1);

/**
 * The golden unit on the lifecycle case's own date, with its unbridged away player renamed
 * into the ISSUE-235 namespace at every quoted occurrence (the roster and both stat entries),
 * so the settle's `unresolved_identity` candidate names an S6 provider.
 */
function issue235LifecycleSource(): AflApiSettleUnitSource {
  const text = JSON.stringify(unitSourceFor(CASE_IDS.issue235Lifecycle));
  const quoted = `"${UNBRIDGED_PROVIDER_PLAYER_ID}"`;
  if (!text.includes(quoted)) {
    throw new Error(`The fixture no longer names ${UNBRIDGED_PROVIDER_PLAYER_ID}; the ISSUE-235 lifecycle cannot rename it.`);
  }
  return JSON.parse(text.split(quoted).join(`"${I235_LIFECYCLE_PROVIDER}"`)) as AflApiSettleUnitSource;
}

function errorOf(result: { ok: boolean; error?: string }): string {
  return result.ok ? '' : (result.error ?? '');
}

type I235IdentityRow = {
  id: number; status: string; playerId: number | null; matchMethod: string | null;
  candidateCount: number; notes: string | null;
};

/** The `afl_api` rows naming a provider id or a player id. */
async function i235AflApiRows(refs: S6Refs, where: { providerId?: string; playerId?: number }): Promise<I235IdentityRow[]> {
  return sql<I235IdentityRow[]>`
    SELECT id, status::text AS status, player_id AS "playerId", match_method AS "matchMethod",
           candidate_count::int AS "candidateCount", notes
      FROM external_identities
     WHERE source_id = ${refs.aflApiSourceId}
       AND (external_id = ${where.providerId ?? null} OR player_id = ${where.playerId ?? null})
     ORDER BY id
  `;
}

type I235Candidate = { id: number; externalRecordId: string; sourceVersionSeq: number; verb: string; status: string };

/** Every candidate (any status) naming the provider — the page's own filter. */
async function i235Candidates(refs: S6Refs, providerId: string): Promise<I235Candidate[]> {
  return sql<I235Candidate[]>`
    SELECT id::int AS id, external_record_id AS "externalRecordId", source_version_seq AS "sourceVersionSeq",
           verb, status
      FROM promotion_candidates
     WHERE source_id = ${refs.aflApiSourceId} AND split_part(external_record_id, '|', 3) = ${providerId}
     ORDER BY id
  `;
}

describe('AFLDB-ISSUE-235 S6 (I2–I7, I6b–I6d): human afl_api adjudication against afldb_test', () => {
  let refs: S6Refs;
  let actorId: number;
  let restoreImportDsn: (() => void) | undefined;

  beforeAll(async () => {
    refs = await loadS6Refs(sql);
    restoreImportDsn = (await routeS6ImportDsn()).restore;
    await cleanupS6Fixtures(sql, refs); // idempotent: clears an interrupted run's residue
  });

  beforeEach(async () => {
    actorId = await seedS6Actor(sql);
  });

  // Before the root beforeEach's cleanup() of the NEXT case, which cannot delete its matches
  // while player_clubs or any player FK still names an S6 player.
  afterEach(async () => {
    await cleanupS6Fixtures(sql, refs);
  });

  afterAll(async () => {
    // Do NOT close `sql` here -- see the I1 describe block's own note above.
    await cleanupS6Fixtures(sql, refs);
    restoreImportDsn?.();
  });

  function link(
    providerId: string, playerId: number, fingerprint: string | null,
    overrides: Partial<LinkAflApiProviderInput> = {},
  ): Promise<LinkAflApiProviderResult> {
    if (fingerprint === null) throw new Error(`The admin page rendered no link fingerprint for ${providerId}.`);
    return linkAflApiProvider({
      providerId, playerId, adminUserId: actorId, note: S6_NOTE, surnameAcknowledged: false, fingerprint, ...overrides,
    });
  }

  function revoke(providerId: string, fingerprint: string | null) {
    if (fingerprint === null) throw new Error(`The admin page rendered no revoke fingerprint for ${providerId}.`);
    return revokeAflApiLink({ providerId, adminUserId: actorId, note: S6_NOTE, fingerprint });
  }

  /** One U1 provider with a stable-identity player, then a real human link: the L-H start state. */
  async function humanLinked(key: number): Promise<{ provider: string; playerId: number; identity: string }> {
    const provider = s6ProviderId(key);
    const player = await seedS6Player(sql, refs, { key });
    await seedS6PendingEvidence(sql, refs, { providerId: provider, match: key });
    const form = await renderS6Form(provider);
    expect(form.evidence?.state).toBe('U1');
    expect(await link(provider, player.id, form.linkFingerprint)).toEqual({ ok: true });
    return { provider, playerId: player.id, identity: player.identity! };
  }

  it('I2 → I6 (revoke before I5) → re-link → I5 (re-settle) → I6 (revoke after I5) → I6c: one provider through the real settle, link, revoke and replay', async () => {
    const provider = I235_LIFECYCLE_PROVIDER;
    const chosen = await seedS6Player(sql, refs, { key: 1, givenName: 'Test', surname: 'Forward' });
    const source = issue235LifecycleSource();

    // The settle leaves the provider in U1: its stat line is refused as unresolved_identity.
    const first = await runSettleAflApi(sql, {
      bundle: buildBundle([source], registry, identities), registry, apply: true, autoApply: true,
      inProgressSeasons: [SEASON],
    });
    expect(first.halt).toBeNull();
    expect(first.applied).toBe(true);
    expect(first.counters.canonicalApplyFailures).toBe(0);
    expect(first.counters.unresolvedIdentityPlayer).toBe(1);
    const [match] = await sql<{ id: number }[]>`
      SELECT id FROM matches WHERE match_key = ${matchKeyFor(CASE_IDS.issue235Lifecycle)}
    `;
    expect(match).toBeDefined();
    const candidatesBefore = await i235Candidates(refs, provider);
    expect(candidatesBefore).toHaveLength(1);
    expect(candidatesBefore[0]).toMatchObject({ verb: 'unresolved_identity', status: 'pending' });
    expect(await i235AflApiRows(refs, { providerId: provider })).toEqual([]);
    expect(chosen.identity).not.toBeNull();

    // ---- I2: the human link --------------------------------------------------------------
    const form = await renderS6Form(provider);
    expect(form.evidence?.state).toBe('U1');
    expect(form.evidence!.pendingCandidates.map((c) => [Number(c.id), c.sourceVersionSeq]))
      .toEqual([[candidatesBefore[0].id, candidatesBefore[0].sourceVersionSeq]]);
    expect(await link(provider, chosen.id, form.linkFingerprint)).toEqual({ ok: true });

    const linkedRows = await i235AflApiRows(refs, { providerId: provider, playerId: chosen.id });
    expect(linkedRows).toHaveLength(1); // one row for the provider, and the player's only afl_api row
    const [linkedRow] = linkedRows;
    expect(linkedRow).toMatchObject({
      status: 'resolved', matchMethod: 'afl_api_admin_adjudication', playerId: chosen.id, candidateCount: 0,
      notes: 'AFLDB-ISSUE-235 admin adjudication; see afl_api_identity_adjudications',
    });
    const ledgerAfterLink = await s6LedgerRows(sql, [provider]);
    expect(ledgerAfterLink).toHaveLength(1);
    const [linkedAudit] = ledgerAfterLink;
    expect(linkedAudit).toMatchObject({
      action: 'linked', playerId: chosen.id, playerIdentity: chosen.identity, previousState: null,
      evidenceSha256: form.linkFingerprint, surnameAck: false, supersedesId: null, adminUserId: actorId,
      note: S6_NOTE,
    });
    const linkedEvidence = decodeS6Jsonb(linkedAudit.evidence) as Record<string, unknown>;
    expect(linkedEvidence).toMatchObject({
      providerId: provider, chosenPlayerId: chosen.id, fingerprint: form.linkFingerprint,
      latestAdjudicationId: null, classification: null,
    });
    expect((linkedEvidence.pendingCandidateIds as unknown[]).map(Number)).toEqual([candidatesBefore[0].id]);
    // D14: adjudication never touches a promotion candidate.
    expect(await i235Candidates(refs, provider)).toEqual(candidatesBefore);

    // ---- T2 (the brief's I3): the same link again, against the new state -----------------
    const again = await renderS6Form(provider);
    expect(again.evidence?.state).toBe('L-H');
    const beforeDuplicate = await s6StateSnapshot(sql, refs, { providerIds: [provider], playerIds: [chosen.id] });
    expect(await link(provider, chosen.id, again.linkFingerprint))
      .toMatchObject({ ok: false, code: 'T2_already_linked_same_player' });
    expect(await s6StateSnapshot(sql, refs, { providerIds: [provider], playerIds: [chosen.id] })).toEqual(beforeDuplicate);

    // ---- I6, revoke BEFORE I5 (the brief's I5): unused, so it revokes ---------------------
    const revokeForm = await renderS6Form(provider);
    expect(await revoke(provider, revokeForm.revokeFingerprint)).toEqual({ ok: true });
    expect(await i235AflApiRows(refs, { providerId: provider, playerId: chosen.id })).toEqual([]);
    const ledgerAfterRevoke = await s6LedgerRows(sql, [provider]);
    expect(ledgerAfterRevoke).toHaveLength(2);
    expect(ledgerAfterRevoke[0]).toEqual(linkedAudit); // append-only: the linked row is untouched
    expect(ledgerAfterRevoke[1]).toMatchObject({
      action: 'revoked', supersedesId: linkedAudit.id, playerId: chosen.id, playerIdentity: chosen.identity,
      evidenceSha256: revokeForm.revokeFingerprint, surnameAck: false, adminUserId: actorId, note: S6_NOTE,
    });
    expect(decodeS6Jsonb(ledgerAfterRevoke[1].previousState)).toEqual({
      id: linkedRow.id, status: 'resolved', playerId: chosen.id, matchMethod: 'afl_api_admin_adjudication',
    });
    expect(decodeS6Jsonb(ledgerAfterRevoke[1].evidence)).toMatchObject({ nonUseProof: { proven: true } });
    expect(await i235Candidates(refs, provider)).toEqual(candidatesBefore);

    // ---- The brief's I6: re-link after the revoke ----------------------------------------
    const afterRevoke = await renderS6Form(provider);
    expect(afterRevoke.evidence?.state).toBe('U1'); // back in the queue, evidence intact
    expect(await link(provider, chosen.id, afterRevoke.linkFingerprint)).toEqual({ ok: true });
    const [relinkedRow, ...extra] = await i235AflApiRows(refs, { providerId: provider, playerId: chosen.id });
    expect(extra).toEqual([]);
    expect(relinkedRow).toMatchObject({ status: 'resolved', matchMethod: 'afl_api_admin_adjudication', playerId: chosen.id });
    expect(relinkedRow.id).not.toBe(linkedRow.id);
    const ledgerAfterRelink = await s6LedgerRows(sql, [provider]);
    expect(ledgerAfterRelink).toHaveLength(3);
    expect(ledgerAfterRelink.slice(0, 2)).toEqual(ledgerAfterRevoke); // history intact, nothing updated
    expect(ledgerAfterRelink[2]).toMatchObject({
      action: 'linked', supersedesId: null, previousState: null, playerId: chosen.id,
      evidenceSha256: afterRevoke.linkFingerprint,
    });
    const relinkEvidence = decodeS6Jsonb(ledgerAfterRelink[2].evidence) as Record<string, unknown>;
    expect(String(relinkEvidence.latestAdjudicationId)).toBe(String(ledgerAfterRevoke[1].id));
    // Replay semantics resolve linked -> revoked -> linked to the one current human row.
    await assertS6LedgerIsolated(sql, refs);
    expect(await sql.begin((tx) => replayAflApiAdjudications(tx))).toEqual({ inserted: 0, noops: 1, stops: [], supersedes: [] });
    await sql.begin((tx) => assertAflApiAdjudicationBijection(tx));

    // ---- I5: re-run the settle; the stat line lands under the chosen player ---------------
    const second = await runSettleAflApi(sql, {
      bundle: buildBundle([source], registry, identities), registry, apply: true, autoApply: true,
      inProgressSeasons: [SEASON],
    });
    expect(second.halt).toBeNull();
    expect(second.applied).toBe(true);
    expect(second.counters.canonicalApplyFailures).toBe(0);
    expect(second.counters.unresolvedIdentityPlayer).toBe(0);
    const [landed] = await sql<{ sourceId: number }[]>`
      SELECT source_id AS "sourceId" FROM player_match_stats WHERE match_id = ${match.id} AND player_id = ${chosen.id}
    `;
    expect(landed?.sourceId).toBe(refs.aflApiSourceId);
    // The earlier candidate is retained (never retired by the link) and now classifies moot.
    const [candidate] = candidatesBefore;
    expect((await i235Candidates(refs, provider)).map((c) => c.id)).toEqual([candidate.id]);
    const [applied] = await sql<{ seq: number | null }[]>`
      SELECT max(source_version_seq)::int AS seq FROM canonical_applications
       WHERE source_id = ${refs.aflApiSourceId} AND target_table = 'player_match_stats'
         AND external_record_id = ${candidate.externalRecordId}
    `;
    expect(applied.seq).not.toBeNull();
    expect(classifyCandidate(candidate.sourceVersionSeq, applied.seq)).toBe('moot');

    // ---- I6, revoke AFTER I5: used, so it is refused and nothing is written ---------------
    const usedForm = await renderS6Form(provider);
    const beforeUsedRefusal = await s6StateSnapshot(sql, refs, { providerIds: [provider], playerIds: [chosen.id] });
    const refused = await revoke(provider, usedForm.revokeFingerprint);
    expect(refused).toMatchObject({ ok: false, code: 'T19_revoke_unprovable' });
    expect(errorOf(refused)).toMatch(/^used: /);
    expect(errorOf(refused)).toContain('public.player_match_stats');
    expect(errorOf(refused)).toContain('public.canonical_applications');
    expect(await s6StateSnapshot(sql, refs, { providerIds: [provider], playerIds: [chosen.id] })).toEqual(beforeUsedRefusal);

    // ---- I6c: the canonical row's provenance rewritten to another source, its projection
    // gone -- the append-only canonical_applications ledger (D10 (b)) still proves use --------
    await sql`
      UPDATE player_match_stats SET source_id = ${afltablesSourceId}
       WHERE match_id = ${match.id} AND player_id = ${chosen.id}
    `;
    await sql`DELETE FROM staging.afl_api_player_match WHERE source_id = ${refs.aflApiSourceId} AND player_id = ${chosen.id}`;
    const rewrittenForm = await renderS6Form(provider);
    const beforeRewrittenRefusal = await s6StateSnapshot(sql, refs, { providerIds: [provider], playerIds: [chosen.id] });
    const stillRefused = await revoke(provider, rewrittenForm.revokeFingerprint);
    expect(stillRefused).toMatchObject({ ok: false, code: 'T19_revoke_unprovable' });
    expect(errorOf(stillRefused)).toContain('public.canonical_applications');
    expect(errorOf(stillRefused)).not.toContain('public.player_match_stats');
    expect(errorOf(stillRefused)).not.toContain('staging.afl_api_player_match');
    expect(await s6StateSnapshot(sql, refs, { providerIds: [provider], playerIds: [chosen.id] }))
      .toEqual(beforeRewrittenRefusal);
  }, 300_000);

  it('I2 (D8 audit shape) — the linked and revoked audit rows store evidence and previous_state as jsonb OBJECTS, not JSON text', async () => {
    // D8: `evidence jsonb NOT NULL` is the evidence snapshot and `previous_state jsonb` the
    // provider's prior row. A string handed to postgres.js for a jsonb parameter is serialised
    // with JSON.stringify a second time (the driver maps 3802 to JSON.stringify), which stores
    // a jsonb STRING scalar holding JSON text. This case pins the shape the schema declares.
    const { provider } = await humanLinked(201);
    const form = await renderS6Form(provider);
    expect(await revoke(provider, form.revokeFingerprint)).toEqual({ ok: true });
    const [linked, revoked] = await s6LedgerRows(sql, [provider]);
    expect(linked.evidenceType).toBe('object');
    expect(revoked.evidenceType).toBe('object');
    expect(revoked.previousStateType).toBe('object');
  });

  it('I3 — atomicity: an audit INSERT refused by its CHECK after the identity INSERT leaves zero rows on both sides', async () => {
    const [{ encoding }] = await sql<{ encoding: string }[]>`SELECT current_setting('server_encoding') AS encoding`;
    expect(encoding, 'I3 relies on PostgreSQL counting characters, not bytes').toBe('UTF8');
    const provider = s6ProviderId(301);
    const chosen = await seedS6Player(sql, refs, { key: 301 });
    await seedS6PendingEvidence(sql, refs, { providerId: provider, match: 301 });
    const form = await renderS6Form(provider);

    // Ten astral-plane characters: JavaScript's string.length is 20, so the note passes
    // validateAdjudicationInput(); PostgreSQL's length() is 10, so migration 104's
    // CHECK (length(note) BETWEEN 20 AND 2000) refuses the audit INSERT -- which runs AFTER the
    // external_identities INSERT in the same transaction. That is the runbook's "force the audit
    // insert to fail, bypassing validation", reached through the real API with no mock.
    const note = '\u{1F3C9}'.repeat(10);
    expect(note.length).toBe(20);
    const before = await s6StateSnapshot(sql, refs, { providerIds: [provider], playerIds: [chosen.id] });
    expect(before.identities).toEqual([]);
    expect(before.ledger).toEqual([]);

    const result = await link(provider, chosen.id, form.linkFingerprint, { note });
    expect(result.ok).toBe(false);
    expect(errorOf(result)).toMatch(/could not be applied: .*check constraint/);
    expect(await s6StateSnapshot(sql, refs, { providerIds: [provider], playerIds: [chosen.id] })).toEqual(before);
  });

  it('I4/T2 (the brief\'s I3) — a second link of the same provider to the same player is refused as already linked; no duplicate row or audit', async () => {
    const { provider, playerId } = await humanLinked(402);
    const form = await renderS6Form(provider);
    const before = await s6StateSnapshot(sql, refs, { providerIds: [provider], playerIds: [playerId] });
    expect(await link(provider, playerId, form.linkFingerprint))
      .toMatchObject({ ok: false, code: 'T2_already_linked_same_player' });
    const after = await s6StateSnapshot(sql, refs, { providerIds: [provider], playerIds: [playerId] });
    expect(after).toEqual(before);
    expect(after.identities).toHaveLength(1);
    expect(after.ledger).toHaveLength(1);
  });

  it('I4/T3 (the brief\'s I4) — a link of an already-linked provider to a DIFFERENT player is refused; no reassignment, no audit', async () => {
    const { provider, playerId } = await humanLinked(403);
    const other = await seedS6Player(sql, refs, { key: 413 });
    const form = await renderS6Form(provider);
    const before = await s6StateSnapshot(sql, refs, { providerIds: [provider], playerIds: [playerId, other.id] });
    expect(await link(provider, other.id, form.linkFingerprint))
      .toMatchObject({ ok: false, code: 'T3_already_linked_different_player' });
    expect(await s6StateSnapshot(sql, refs, { providerIds: [provider], playerIds: [playerId, other.id] })).toEqual(before);
    expect(await i235AflApiRows(refs, { providerId: provider })).toEqual([
      expect.objectContaining({ playerId, status: 'resolved' }),
    ]);
  });

  it('I4/T4 — a link to a player who already holds another afl_api provider is refused, naming that provider', async () => {
    const provider = s6ProviderId(404);
    const held = s6ProviderId(414);
    const player = await seedS6Player(sql, refs, { key: 404 });
    await seedS6PendingEvidence(sql, refs, { providerId: provider, match: 404 });
    await seedS6ImporterLink(sql, refs, held, player.id);
    const form = await renderS6Form(provider);
    const before = await s6StateSnapshot(sql, refs, { providerIds: [provider, held], playerIds: [player.id] });
    const result = await link(provider, player.id, form.linkFingerprint);
    expect(result).toMatchObject({ ok: false, code: 'T4_player_holds_another_provider' });
    expect(errorOf(result)).toContain(held);
    expect(await s6StateSnapshot(sql, refs, { providerIds: [provider, held], playerIds: [player.id] })).toEqual(before);
  });

  it('I4/T5 — a link with no pending evidence (U0) is refused; nothing is written', async () => {
    const provider = s6ProviderId(405);
    const player = await seedS6Player(sql, refs, { key: 405 });
    // U0 is not listed and the page has nothing to render…
    expect((await renderS6Form(provider)).evidence).toBeNull();
    // …so the only matching fingerprint is one computed over U0 itself (a hand-built POST).
    const u0Fingerprint = adjudicationFingerprint({
      providerId: provider, existing: null, pendingCandidates: [], latestAdjudicationId: null,
      chosenPlayerId: 0, chosenPlayerExistingRows: [],
    });
    const before = await s6StateSnapshot(sql, refs, { providerIds: [provider], playerIds: [player.id] });
    expect(await link(provider, player.id, u0Fingerprint)).toMatchObject({ ok: false, code: 'T5_no_evidence' });
    expect(await s6StateSnapshot(sql, refs, { providerIds: [provider], playerIds: [player.id] })).toEqual(before);
  });

  it('I4/T6 (the brief\'s I7) — a stale fingerprint is refused for link and for revoke after a real database change; nothing is written', async () => {
    // Link: the page is rendered, then a settle observes the provider in a further match.
    const provider = s6ProviderId(406);
    const player = await seedS6Player(sql, refs, { key: 406 });
    await seedS6PendingEvidence(sql, refs, { providerId: provider, match: 406 });
    const staleLink = await renderS6Form(provider);
    await seedS6PendingEvidence(sql, refs, { providerId: provider, match: 416 });
    const beforeLink = await s6StateSnapshot(sql, refs, { providerIds: [provider], playerIds: [player.id] });
    expect(await link(provider, player.id, staleLink.linkFingerprint))
      .toMatchObject({ ok: false, code: 'T6_stale_fingerprint' });
    expect(await s6StateSnapshot(sql, refs, { providerIds: [provider], playerIds: [player.id] })).toEqual(beforeLink);

    // Link: the page is rendered, then the importer links the provider to someone else. The
    // stale fingerprint refuses first, and the importer's row is untouched.
    const raced = s6ProviderId(426);
    const importerPlayer = await seedS6Player(sql, refs, { key: 426 });
    await seedS6PendingEvidence(sql, refs, { providerId: raced, match: 426 });
    const staleRaced = await renderS6Form(raced);
    await seedS6ImporterLink(sql, refs, raced, importerPlayer.id);
    const beforeRaced = await s6StateSnapshot(sql, refs, { providerIds: [raced], playerIds: [player.id, importerPlayer.id] });
    expect(await link(raced, player.id, staleRaced.linkFingerprint))
      .toMatchObject({ ok: false, code: 'T6_stale_fingerprint' });
    expect(await s6StateSnapshot(sql, refs, { providerIds: [raced], playerIds: [player.id, importerPlayer.id] }))
      .toEqual(beforeRaced);

    // Revoke: the page is rendered, then another admin revokes and re-links. The stale revoke
    // must not delete the NEWER link.
    const linked = await humanLinked(436);
    const staleRevoke = await renderS6Form(linked.provider);
    const intervening = await renderS6Form(linked.provider);
    expect(await revoke(linked.provider, intervening.revokeFingerprint)).toEqual({ ok: true });
    const relinkForm = await renderS6Form(linked.provider);
    expect(await link(linked.provider, linked.playerId, relinkForm.linkFingerprint)).toEqual({ ok: true });
    const beforeRevoke = await s6StateSnapshot(sql, refs, { providerIds: [linked.provider], playerIds: [linked.playerId] });
    expect(await revoke(linked.provider, staleRevoke.revokeFingerprint))
      .toMatchObject({ ok: false, code: 'T6_stale_fingerprint' });
    const afterRevoke = await s6StateSnapshot(sql, refs, { providerIds: [linked.provider], playerIds: [linked.playerId] });
    expect(afterRevoke).toEqual(beforeRevoke);
    expect(afterRevoke.identities).toHaveLength(1); // the re-link survives
    expect(afterRevoke.ledger).toHaveLength(3); // linked, revoked, linked -- no fourth row
  });

  it('I4/T7 — a link to a player with no stable identity is refused; nothing is written', async () => {
    const provider = s6ProviderId(407);
    const player = await seedS6Player(sql, refs, { key: 407, stable: false });
    await seedS6PendingEvidence(sql, refs, { providerId: provider, match: 407 });
    const form = await renderS6Form(provider);
    const before = await s6StateSnapshot(sql, refs, { providerIds: [provider], playerIds: [player.id] });
    expect(await link(provider, player.id, form.linkFingerprint)).toMatchObject({ ok: false, code: 'T7_player_not_stable' });
    expect(await s6StateSnapshot(sql, refs, { providerIds: [provider], playerIds: [player.id] })).toEqual(before);
  });

  it('I4/T8 — every action on an anomalous (NULL-player) row is refused; the row is unchanged', async () => {
    const provider = s6ProviderId(408);
    const player = await seedS6Player(sql, refs, { key: 408 });
    await seedS6PendingEvidence(sql, refs, { providerId: provider, match: 408 });
    await sql`
      INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
      VALUES (${refs.aflApiSourceId}, ${provider}, NULL, 'unmatched', 0, NULL)
    `;
    const form = await renderS6Form(provider);
    expect(form.evidence?.state).toBe('X');
    const before = await s6StateSnapshot(sql, refs, { providerIds: [provider], playerIds: [player.id] });
    expect(await link(provider, player.id, form.linkFingerprint)).toMatchObject({ ok: false, code: 'T8_anomalous_row' });
    expect(await s6StateSnapshot(sql, refs, { providerIds: [provider], playerIds: [player.id] })).toEqual(before);

    // Revoke with the fingerprint the page renders. For a NULL-player row the page computes
    // chosenPlayerId 0 and [the row itself] while revokeAflApiLink() recomputes -1 and [] (a
    // `player_id = NULL` read finds nothing), so the two can never agree and the refusal
    // surfaces as T6 rather than T8 -- recorded as an S6 finding. Either code refuses and
    // writes nothing, which is what this case pins.
    const pageRevoke = await revoke(provider, form.revokeFingerprint);
    expect(pageRevoke.ok).toBe(false);
    expect(['T6_stale_fingerprint', 'T8_anomalous_row']).toContain(pageRevoke.ok ? '' : pageRevoke.code);
    // With the server's own fingerprint the anomaly itself is what refuses.
    const serverFingerprint = adjudicationFingerprint({
      providerId: provider, existing: form.evidence!.existing,
      pendingCandidates: form.evidence!.pendingCandidates, latestAdjudicationId: form.evidence!.latestAdjudicationId,
      chosenPlayerId: -1, chosenPlayerExistingRows: [],
    });
    expect(await revoke(provider, serverFingerprint)).toMatchObject({ ok: false, code: 'T8_anomalous_row' });
    expect(await s6StateSnapshot(sql, refs, { providerIds: [provider], playerIds: [player.id] })).toEqual(before);
  });

  it('I4/T9 — a surname disagreement is refused without the acknowledgement, and recorded when acknowledged', async () => {
    const provider = s6ProviderId(409);
    const player = await seedS6Player(sql, refs, { key: 409, surname: 'Otherwise' });
    await seedS6PendingEvidence(sql, refs, { providerId: provider, match: 409, surname: 'Forward' });
    const form = await renderS6Form(provider);
    const before = await s6StateSnapshot(sql, refs, { providerIds: [provider], playerIds: [player.id] });
    // decideAflApiLink's own coded T9 -- never the pre-decision input check, which would
    // pre-empt T2/T3 on an already-linked row (I7).
    expect(await link(provider, player.id, form.linkFingerprint))
      .toMatchObject({ ok: false, code: 'T9_surname_ack_required' });
    expect(await s6StateSnapshot(sql, refs, { providerIds: [provider], playerIds: [player.id] })).toEqual(before);

    expect(await link(provider, player.id, form.linkFingerprint, { surnameAcknowledged: true })).toEqual({ ok: true });
    const [audit] = await s6LedgerRows(sql, [provider]);
    expect(audit).toMatchObject({ action: 'linked', surnameAck: true, playerId: player.id });
  });

  it('I6b (Brownlow, OD-2) — a human link used only by a Brownlow settle is refused as used through D10 (a) and (b), with no projection row', async () => {
    const { provider, playerId } = await humanLinked(601);
    // The AFL API Brownlow settle's footprint: a brownlow_round_votes row (source afl_api, a
    // F002-demoted votes = 0) and its append-only canonical_applications row, keyed by the
    // provider MATCH id -- never `…|CD_I` -- with a target_key naming the player
    // (canonical-apply.ts brownlow target key). No staging.afl_api_brownlow_vote projection
    // exists (the runbook's "projection row deleted").
    const matchRecord = s6MatchId(601);
    const round = 23;
    const { batchId } = await seedS6SpineVersion(sql, refs, {
      family: 'brownlow_match_votes', externalRecordId: matchRecord,
      payload: { providerMatchId: matchRecord, votes: [{ playerId: provider, votes: 0 }] },
    });
    await insertS6BrownlowVote(sql, refs, { playerId, roundNumber: round, sourceRecordId: matchRecord });
    await sql`
      INSERT INTO canonical_applications
            (import_batch_id, source_id, family, external_record_id, source_version_seq,
             target_table, target_key, verb, previous_values, new_values)
      VALUES (${batchId}, ${refs.aflApiSourceId}, 'brownlow_match_votes', ${matchRecord}, 1,
              'brownlow_round_votes',
              ${sql.json({ season: S6_SEASON, player_id: playerId, round_number: round } as never)},
              'insert', NULL, ${sql.json({ votes: 0, played: true } as never)})
    `;
    const [{ n: projections }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM staging.afl_api_brownlow_vote
       WHERE source_id = ${refs.aflApiSourceId} AND (player_id = ${playerId} OR provider_player_id = ${provider})
    `;
    expect(projections).toBe(0);

    async function expectRefusedAsUsed(mustName: readonly string[], mustNotName: readonly string[]): Promise<void> {
      const form = await renderS6Form(provider);
      const before = await s6StateSnapshot(sql, refs, { providerIds: [provider], playerIds: [playerId] });
      const result = await revoke(provider, form.revokeFingerprint);
      expect(result).toMatchObject({ ok: false, code: 'T19_revoke_unprovable' });
      for (const table of mustName) expect(errorOf(result)).toContain(table);
      for (const table of mustNotName) expect(errorOf(result)).not.toContain(table);
      expect(await s6StateSnapshot(sql, refs, { providerIds: [provider], playerIds: [playerId] })).toEqual(before);
    }

    // (a) and (b) together.
    await expectRefusedAsUsed(['public.brownlow_round_votes', 'public.canonical_applications'], []);
    // (b) alone: the vote row gone, the append-only ledger still proves use.
    await sql`DELETE FROM brownlow_round_votes WHERE player_id = ${playerId} AND round_number = ${round}`;
    await expectRefusedAsUsed(['public.canonical_applications'], ['public.brownlow_round_votes']);
    // (a) alone: the vote row back, the ledger row removed (fixture manipulation, owner only).
    await insertS6BrownlowVote(sql, refs, { playerId, roundNumber: round, sourceRecordId: matchRecord });
    await sql`DELETE FROM canonical_applications WHERE external_record_id = ${matchRecord}`;
    await expectRefusedAsUsed(['public.brownlow_round_votes'], ['public.canonical_applications']);
  });

  it('I6d (lock) — while another session holds a read of external_identities the revoke refuses on lock_timeout and writes nothing', async () => {
    const { provider, playerId } = await humanLinked(602);
    const form = await renderS6Form(provider);
    const reader = postgres(process.env.AFLDB_TEST_DATABASE_URL as string, { max: 1, onnotice: () => {} });
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    let markHeld!: () => void;
    const held = new Promise<void>((resolve) => { markHeld = resolve; });
    // A settle-shaped reader: it has read the link and its transaction is still open, so it
    // holds ACCESS SHARE on external_identities until it ends.
    const readerTx = reader.begin(async (tx) => {
      await tx`
        SELECT player_id FROM external_identities
         WHERE source_id = ${refs.aflApiSourceId} AND external_id = ${provider} AND status IN ('unique', 'resolved')
      `;
      markHeld();
      await released;
    });
    try {
      await Promise.race([held, readerTx]);
      const before = await s6StateSnapshot(sql, refs, { providerIds: [provider], playerIds: [playerId] });
      const result = await revoke(provider, form.revokeFingerprint);
      expect(result).toMatchObject({ ok: false, code: 'T19_revoke_unprovable' });
      expect(errorOf(result)).toMatch(/in progress; retry/);
      expect(await s6StateSnapshot(sql, refs, { providerIds: [provider], playerIds: [playerId] })).toEqual(before);
    } finally {
      release();
      await readerTx.catch(() => undefined);
      await reader.end({ timeout: 5 });
    }
    // The reader gone, the SAME fingerprint revokes: the refusal was the lock and nothing else.
    expect(await revoke(provider, form.revokeFingerprint)).toEqual({ ok: true });
  }, 60_000);

  it('I6-LI (LINK_INDEPENDENT; the brief\'s I6d) — an afl_api player_height_evidence row does not block a revoke and survives it', async () => {
    const { provider, playerId } = await humanLinked(603);
    // D10's R1 example: afl_api provenance, but attributed by name + club + season matching.
    await sql`
      INSERT INTO player_height_evidence (player_id, source_id, external_id, height_cm, evidence_type, notes)
      VALUES (${playerId}, ${refs.aflApiSourceId}, ${provider}, 188, 'issue235_s6_fixture',
              'AFLDB-ISSUE-235 S6 LINK_INDEPENDENT fixture')
    `;
    const heightBefore = await sql<{ row: unknown }[]>`
      SELECT to_jsonb(h) AS row FROM player_height_evidence h WHERE player_id = ${playerId}
    `;
    const form = await renderS6Form(provider);
    expect(await revoke(provider, form.revokeFingerprint)).toEqual({ ok: true });
    expect(await i235AflApiRows(refs, { providerId: provider, playerId })).toEqual([]);
    const ledger = await s6LedgerRows(sql, [provider]);
    expect(ledger.map((r) => r.action)).toEqual(['linked', 'revoked']);
    expect(ledger[1].supersedesId).toBe(ledger[0].id);
    expect(await sql<{ row: unknown }[]>`
      SELECT to_jsonb(h) AS row FROM player_height_evidence h WHERE player_id = ${playerId}
    `).toEqual(heightBefore);
  });

  it('I7 — link and revoke against the BRIDGED importer (unique) provider are refused; its status, player_id and match_method are unchanged', async () => {
    const other = await seedS6Player(sql, refs, { key: 701 });
    const form = await renderS6Form(BRIDGED_PROVIDER_PLAYER_ID);
    expect(form.evidence?.state).toBe('L-I');
    const scope = { providerIds: [BRIDGED_PROVIDER_PLAYER_ID], playerIds: [bridgedPlayerId, other.id] };
    const before = await s6StateSnapshot(sql, refs, scope);
    expect(await link(BRIDGED_PROVIDER_PLAYER_ID, bridgedPlayerId, form.linkFingerprint))
      .toMatchObject({ ok: false, code: 'T2_already_linked_same_player' });
    expect(await link(BRIDGED_PROVIDER_PLAYER_ID, other.id, form.linkFingerprint))
      .toMatchObject({ ok: false, code: 'T3_already_linked_different_player' });
    expect(await revoke(BRIDGED_PROVIDER_PLAYER_ID, form.revokeFingerprint))
      .toMatchObject({ ok: false, code: 'T20_revoke_importer_link' });
    expect(await s6StateSnapshot(sql, refs, scope)).toEqual(before);
    expect(await i235AflApiRows(refs, { providerId: BRIDGED_PROVIDER_PLAYER_ID })).toEqual([
      expect.objectContaining({
        status: 'unique', playerId: bridgedPlayerId, matchMethod: 'afl_api_stat_vector_bootstrap',
      }),
    ]);
  });
});

describe('AFLDB-ISSUE-235 S6 (I15, I16): the D15 replay fails closed and is idempotent against afldb_test', () => {
  let refs: S6Refs;
  let actorId: number;
  let restoreImportDsn: (() => void) | undefined;

  beforeAll(async () => {
    refs = await loadS6Refs(sql);
    restoreImportDsn = (await routeS6ImportDsn()).restore;
    await cleanupS6Fixtures(sql, refs);
    // The replay and the bijection read the WHOLE ledger; their exact counts need it to
    // hold only ISSUE-235 fixture rows. Refuses (never deletes) otherwise.
    await assertS6LedgerIsolated(sql, refs);
  });

  beforeEach(async () => {
    actorId = await seedS6Actor(sql);
  });

  afterEach(async () => {
    await cleanupS6Fixtures(sql, refs);
  });

  afterAll(async () => {
    await cleanupS6Fixtures(sql, refs);
    restoreImportDsn?.();
  });

  /** A ledger row written directly (fixture setup, the I14 idiom): the ledger a promotion or
   * rebuild reinstates, whose outcome the replay must re-derive. */
  async function ledgerRow(input: {
    providerId: string; action: 'linked' | 'revoked'; playerId: number; playerIdentity: string;
    supersedesId?: number;
  }): Promise<number> {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO afl_api_identity_adjudications
            (source_key, external_id, action, player_id, player_identity, evidence, evidence_sha256,
             surname_disagreement_acknowledged, supersedes_id, admin_user_id, note)
      VALUES ('afl_api', ${input.providerId}, ${input.action}, ${input.playerId}, ${input.playerIdentity},
              '{"fixture":"I15"}'::jsonb, ${'a'.repeat(64)}, false, ${input.supersedesId ?? null}, ${actorId},
              ${S6_NOTE})
      RETURNING id::text AS id
    `;
    return Number(row.id);
  }

  /**
   * Seeds a GOOD net-linked ledger row that on its own would be inserted, then asserts that a
   * replay over the whole ledger throws AflApiReplayAbort naming `bad`, and that the rollback
   * left every afl_api row, every ledger row and every candidate exactly as they were -- so
   * the good provider is NOT linked either (no partial replay).
   */
  async function expectReplayStops(input: {
    bad: string; reason: RegExp; scope: { providerIds: string[]; playerIds: number[] };
  }): Promise<void> {
    const good = s6ProviderId(1599);
    const goodPlayer = await seedS6Player(sql, refs, { key: 1599 });
    await ledgerRow({ providerId: good, action: 'linked', playerId: goodPlayer.id, playerIdentity: goodPlayer.identity! });
    const scope = {
      providerIds: [...input.scope.providerIds, good], playerIds: [...input.scope.playerIds, goodPlayer.id],
    };
    const before = await s6StateSnapshot(sql, refs, scope);
    const error = await sql.begin((tx) => replayAflApiAdjudications(tx)).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(AflApiReplayAbort);
    expect((error as Error).message).toContain(input.bad);
    expect((error as Error).message).toMatch(input.reason);
    expect((error as Error).message).not.toContain(good); // the good row is not a stop…
    expect(await s6StateSnapshot(sql, refs, scope)).toEqual(before); // …and was not written
    expect(await i235AflApiRows(refs, { providerId: good })).toEqual([]);
  }

  // NOT A LIVE CASE: "a remap whose identity differs from the stored player_identity". The live
  // adapter's remap is resolveAflApiPlayerIdentity(tx, storedIdentity), which looks the player up
  // BY the stored identity and returns that same string as remappedIdentity, so PostgreSQL state
  // cannot make them differ. The planner branch is pinned DB-free instead
  // (db-promotion-check.test.ts, C4), and is not weakened to make it reachable here.
  //
  // Nor is there a live "malformed ledger sequence" stop: the replay planner reduces the ledger to
  // the latest action per provider by id (netLedgerRowsByExternalId) and has no sequence-shape
  // rule to trip. Ledger structure is checked where a ledger is MOVED, by the OD-5 capture
  // (capturedRowProblems, DB-free in db-test-rebuild.test.ts C6).

  it('I15 — an unresolvable player_identity stops the replay; nothing is written', async () => {
    const bad = s6ProviderId(1501);
    const player = await seedS6Player(sql, refs, { key: 1501 });
    await ledgerRow({
      providerId: bad, action: 'linked', playerId: player.id, playerIdentity: 'players/Z/Issue235-S6-nobody.html',
    });
    await expectReplayStops({ bad, reason: /does not resolve to any candidate player/, scope: { providerIds: [bad], playerIds: [player.id] } });
  });

  it('I15 — an ambiguous player_identity (an afltables and a manual_admin_edit identity naming two players) stops the replay', async () => {
    if (refs.manualAdminEditSourceId === null) {
      throw new Error("sources 'manual_admin_edit' (migration 057) must exist on afldb_test for the ambiguous-identity case.");
    }
    const bad = s6ProviderId(1502);
    const playerB = await seedS6Player(sql, refs, { key: 1502, stable: false });
    const playerC = await seedS6Player(sql, refs, { key: 1512, stable: false });
    const identity = 'players/Z/Issue235-S6-ambiguous.html';
    await sql`
      INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
      VALUES (${refs.afltablesSourceId}, ${identity}, ${playerB.id}, 'unique', 1, 'afltables_profile_url'),
             (${refs.manualAdminEditSourceId}, ${identity}, ${playerC.id}, 'unique', 1, 'manual_admin_edit')
    `;
    await ledgerRow({ providerId: bad, action: 'linked', playerId: playerB.id, playerIdentity: identity });
    await expectReplayStops({
      bad, reason: /resolves to more than one candidate player/, scope: { providerIds: [bad], playerIds: [playerB.id, playerC.id] },
    });
  });

  it('I15 — an importer unique row for the CD_I naming a DIFFERENT player stops the replay; the importer row is untouched', async () => {
    const bad = s6ProviderId(1503);
    const ledgerPlayer = await seedS6Player(sql, refs, { key: 1503 });
    const importerPlayer = await seedS6Player(sql, refs, { key: 1513 });
    await seedS6ImporterLink(sql, refs, bad, importerPlayer.id);
    await ledgerRow({ providerId: bad, action: 'linked', playerId: ledgerPlayer.id, playerIdentity: ledgerPlayer.identity! });
    await expectReplayStops({
      bad, reason: /conflicting external_identities row already exists/,
      scope: { providerIds: [bad], playerIds: [ledgerPlayer.id, importerPlayer.id] },
    });
  });

  it('I15 — an importer unique row for the CD_I and the SAME player still stops the replay (it is not the identical human row)', async () => {
    const bad = s6ProviderId(1504);
    const player = await seedS6Player(sql, refs, { key: 1504 });
    await seedS6ImporterLink(sql, refs, bad, player.id);
    await ledgerRow({ providerId: bad, action: 'linked', playerId: player.id, playerIdentity: player.identity! });
    // AFLDB-ISSUE-237 D9/OD-2: a full, AGREEING importer row is now named precisely -- it is a
    // supersede candidate, and this call's expected set is empty (E_rebuild), so it still STOPs
    // with nothing written. Only the reason is more specific; the refusal is unchanged.
    await expectReplayStops({
      bad, reason: /an agreeing importer row exists for this provider but is not in the expected supersede set/,
      scope: { providerIds: [bad], playerIds: [player.id] },
    });
  });

  it('I15 — a conflicting HUMAN row for the CD_I (another player) stops the replay', async () => {
    const bad = s6ProviderId(1505);
    const ledgerPlayer = await seedS6Player(sql, refs, { key: 1505 });
    const otherPlayer = await seedS6Player(sql, refs, { key: 1515 });
    await sql`
      INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method, notes)
      VALUES (${refs.aflApiSourceId}, ${bad}, ${otherPlayer.id}, 'resolved', 0, 'afl_api_admin_adjudication',
              'AFLDB-ISSUE-235 S6 fixture: a human row the ledger does not describe')
    `;
    await ledgerRow({ providerId: bad, action: 'linked', playerId: ledgerPlayer.id, playerIdentity: ledgerPlayer.identity! });
    await expectReplayStops({
      bad, reason: /conflicting external_identities row already exists/,
      scope: { providerIds: [bad], playerIds: [ledgerPlayer.id, otherPlayer.id] },
    });
  });

  it('I15 — a remapped player already holding another afl_api row stops the replay', async () => {
    const bad = s6ProviderId(1506);
    const held = s6ProviderId(1516);
    const player = await seedS6Player(sql, refs, { key: 1506 });
    await seedS6ImporterLink(sql, refs, held, player.id);
    await ledgerRow({ providerId: bad, action: 'linked', playerId: player.id, playerIdentity: player.identity! });
    await expectReplayStops({
      bad, reason: new RegExp(`already holds a different afl_api provider \\(${held}\\)`),
      scope: { providerIds: [bad, held], playerIds: [player.id] },
    });
  });

  // I16 here is the operator brief's replay-idempotence case. The runbook's own I16 -- the bridge
  // loader's --dry-run reporting agreeing providers as `already_linked (human)` after a replay --
  // is a Python loader run against an accepted artefact, operator-run (§10.2 "Bridge regression"),
  // and is not a vitest case.
  it('I16 (replay idempotence) — over a ledger written by the real link/revoke API, a first replay re-creates exactly the net-linked rows and a second is a pure no-op', async () => {
    const [a, b, c] = [
      await seedS6Player(sql, refs, { key: 1601 }),
      await seedS6Player(sql, refs, { key: 1602 }),
      await seedS6Player(sql, refs, { key: 1603 }),
    ];
    const [p1, p2, p3] = [s6ProviderId(1601), s6ProviderId(1602), s6ProviderId(1603)];
    for (const [provider, match] of [[p1, 1601], [p2, 1602], [p3, 1603]] as const) {
      await seedS6PendingEvidence(sql, refs, { providerId: provider, match });
    }
    async function realLink(provider: string, playerId: number): Promise<void> {
      const form = await renderS6Form(provider);
      expect(await linkAflApiProvider({
        providerId: provider, playerId, adminUserId: actorId, note: S6_NOTE, surnameAcknowledged: false,
        fingerprint: form.linkFingerprint!,
      })).toEqual({ ok: true });
    }
    async function realRevoke(provider: string): Promise<void> {
      const form = await renderS6Form(provider);
      expect(await revokeAflApiLink({
        providerId: provider, adminUserId: actorId, note: S6_NOTE, fingerprint: form.revokeFingerprint!,
      })).toEqual({ ok: true });
    }
    // Net linked (P1), net revoked (P2), and linked -> revoked -> linked (P3).
    await realLink(p1, a.id);
    await realLink(p2, b.id);
    await realRevoke(p2);
    await realLink(p3, c.id);
    await realRevoke(p3);
    await realLink(p3, c.id);

    const providers = [p1, p2, p3];
    const ledgerBefore = await s6LedgerRows(sql, providers);
    expect(ledgerBefore.map((r) => `${r.externalId}:${r.action}`)).toEqual([
      `${p1}:linked`, `${p2}:linked`, `${p2}:revoked`, `${p3}:linked`, `${p3}:revoked`, `${p3}:linked`,
    ]);
    await sql.begin((tx) => assertAflApiAdjudicationBijection(tx));

    // The post-promotion/post-rebuild state D15 replays into: the ledger survived, the human
    // identities did not.
    await sql`DELETE FROM external_identities WHERE source_id = ${refs.aflApiSourceId} AND external_id IN (${p1}, ${p3})`;
    await expect(sql.begin((tx) => assertAflApiAdjudicationBijection(tx))).rejects.toThrow(/ledger_without_row/);

    expect(await sql.begin((tx) => replayAflApiAdjudications(tx))).toEqual({ inserted: 2, noops: 0, stops: [], supersedes: [] });
    const afterFirst = await sql<{ externalId: string; playerId: number; status: string; matchMethod: string }[]>`
      SELECT external_id AS "externalId", player_id AS "playerId", status::text AS status, match_method AS "matchMethod"
        FROM external_identities
       WHERE source_id = ${refs.aflApiSourceId} AND external_id IN (${p1}, ${p2}, ${p3})
       ORDER BY external_id
    `;
    expect(afterFirst).toEqual([
      { externalId: p1, playerId: a.id, status: 'resolved', matchMethod: 'afl_api_admin_adjudication' },
      { externalId: p3, playerId: c.id, status: 'resolved', matchMethod: 'afl_api_admin_adjudication' },
    ]);
    await sql.begin((tx) => assertAflApiAdjudicationBijection(tx));

    expect(await sql.begin((tx) => replayAflApiAdjudications(tx))).toEqual({ inserted: 0, noops: 2, stops: [], supersedes: [] });
    const afterSecond = await sql<{ externalId: string; playerId: number; status: string; matchMethod: string }[]>`
      SELECT external_id AS "externalId", player_id AS "playerId", status::text AS status, match_method AS "matchMethod"
        FROM external_identities
       WHERE source_id = ${refs.aflApiSourceId} AND external_id IN (${p1}, ${p2}, ${p3})
       ORDER BY external_id
    `;
    expect(afterSecond).toEqual(afterFirst); // no duplicate, no change
    expect(await s6LedgerRows(sql, providers)).toEqual(ledgerBefore); // the ledger is never written by a replay
    await sql.begin((tx) => assertAflApiAdjudicationBijection(tx));
  }, 120_000);
});

/**
 * AFLDB-ISSUE-235 OD-5 — `observeLiveReinstatement()` against real PostgreSQL, WITHOUT a rebuild.
 *
 * The state under test is what `db:test:rebuild` leaves when its reinstate transaction
 * COMMITTED and the process died before the capture file was archived: a pending capture that
 * equals the live ledger, the human identities replayed, the sequence advanced. This drives the
 * capture step's own database half exactly as `runCapture()` does (one REPEATABLE READ READ ONLY
 * snapshot: readLedger -> decidePendingCapture -> observeLiveReinstatement), then its file half
 * (`settleCapture`) against a temporary capture directory. Nothing is destroyed or rebuilt.
 *
 * The refusal cases alter live state INSIDE the observing transaction, which is then switched to
 * READ ONLY (PostgreSQL lets a read-write transaction become read-only at any point) and always
 * rolled back, so no altered state is ever committed and there is nothing to restore. The
 * "sequence behind the maximum id" refusal is NOT exercised live: setval() is non-transactional,
 * so it would move the shared sequence outside any rollback; assertSequenceAboveLedger() is pinned
 * DB-free (db-test-rebuild.test.ts C6).
 */
describe('AFLDB-ISSUE-235 OD-5: observeLiveReinstatement() against real PostgreSQL (post-COMMIT, pre-archive recovery)', () => {
  let refs: S6Refs;
  let actorId: number;
  let restoreImportDsn: (() => void) | undefined;
  let database: string;
  let dir: string;
  const [p1, p2, p3, p4] = [s6ProviderId(1801), s6ProviderId(1802), s6ProviderId(1803), s6ProviderId(1804)];
  let spare: { id: number; identity: string | null };

  type ObservedState = {
    live: { present: boolean; rows: CapturedLedgerRow[] };
    decision: PendingCaptureDecision;
    observed: LiveReinstatementObservation | null;
  };
  /** This suite never exercises the marker mechanism itself (that is P-M: prove-reset.ts's real
   * `COMMENT ON DATABASE` proof, and the DB-free Stage 18 tests in db-test-rebuild.test.ts).
   * `markerPresent: false` here matches the "marker absent, pending equals/differs" rows of the
   * D11c table, which yield the SAME decision as the marker-present rows for every scenario this
   * suite exercises. */
  const NO_MARKER = false;

  beforeAll(async () => {
    refs = await loadS6Refs(sql);
    restoreImportDsn = (await routeS6ImportDsn()).restore;
    await cleanupS6Fixtures(sql, refs);
    await assertS6LedgerIsolated(sql, refs);
    [{ database }] = await sql<{ database: string }[]>`SELECT current_database() AS database`;
    expect(database).toMatch(/_test$/);
  });

  // The committed reinstatement: a real ledger and its real human identities, written through
  // the API (so the sequence is genuinely above every id): P1 linked, P2 linked then revoked,
  // P3 linked -- two net-linked providers, four ledger rows.
  beforeEach(async () => {
    actorId = await seedS6Actor(sql);
    const players = [
      await seedS6Player(sql, refs, { key: 1801 }),
      await seedS6Player(sql, refs, { key: 1802 }),
      await seedS6Player(sql, refs, { key: 1803 }),
    ];
    spare = await seedS6Player(sql, refs, { key: 1804 });
    for (const [i, provider] of [p1, p2, p3].entries()) {
      await seedS6PendingEvidence(sql, refs, { providerId: provider, match: 1801 + i });
      const form = await renderS6Form(provider);
      expect(await linkAflApiProvider({
        providerId: provider, playerId: players[i].id, adminUserId: actorId, note: S6_NOTE,
        surnameAcknowledged: false, fingerprint: form.linkFingerprint!,
      })).toEqual({ ok: true });
    }
    const revokeForm = await renderS6Form(p2);
    expect(await revokeAflApiLink({
      providerId: p2, adminUserId: actorId, note: S6_NOTE, fingerprint: revokeForm.revokeFingerprint!,
    })).toEqual({ ok: true });
    dir = mkdtempSync(join(tmpdir(), 'afldb-issue235-od5-'));
  }, 60_000);

  afterEach(async () => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    await cleanupS6Fixtures(sql, refs);
  });

  afterAll(async () => {
    await cleanupS6Fixtures(sql, refs);
    restoreImportDsn?.();
  });

  /**
   * The pending capture a run leaves behind: taken from the ledger BEFORE the reset, so its
   * surrogates (`player_id`, `admin_user_id`) are the destroyed database's, and its actor email
   * may differ in case. `sameLedger()` must see through both. Written and re-read through the
   * real file functions, exactly as `runCapture()` reads it.
   */
  async function writePendingPreResetCapture(): Promise<CombinedCapture> {
    const live = await sql.begin('read only', (tx) => readLedger(tx));
    expect(live.rows).toHaveLength(4);
    const capture = buildCombinedCapture({
      database, capturedAt: '2026-09-24T00:00:00.000Z', ledgerTablePresent: live.present,
      ledgerRows: live.rows.map((r) => ({
        ...r, playerId: r.playerId + 7_000_000, adminUserId: r.adminUserId + 7_000_000, adminEmail: r.adminEmail.toUpperCase(),
      })),
      importerRows: [],
    });
    writePendingCapture(dir, capture);
    const reRead = readPendingCapture(dir, database);
    expect(reRead?.payloadSha256).toBe(capture.payloadSha256);
    return reRead!;
  }

  async function observe(tx: postgres.TransactionSql, pending: CombinedCapture): Promise<ObservedState> {
    const live = await readLedger(tx);
    const decision = decidePendingCapture({
      markerPresent: NO_MARKER, pending, liveLedgerRows: live.rows, liveImporterRows: [], recover: false,
    });
    const observed = decision.action === 'verify-reinstated' ? await observeLiveReinstatement(tx, []) : null;
    return { live, decision, observed };
  }

  /** runCapture()'s own snapshot, committed state only. */
  function observeCommitted(pending: CombinedCapture): Promise<ObservedState> {
    return sql.begin('isolation level repeatable read read only', (tx) => observe(tx, pending));
  }

  /** The same observation over an altered state that is NEVER committed. */
  async function observeAltered(
    pending: CombinedCapture, alter: (tx: postgres.TransactionSql) => Promise<void>,
  ): Promise<ObservedState> {
    const rollback = new Error('ISSUE-235 OD-5: roll the altered state back');
    let state: ObservedState | undefined;
    await sql.begin('isolation level repeatable read', async (tx) => {
      await alter(tx);
      await tx`SET TRANSACTION READ ONLY`;
      state = await observe(tx, pending);
      throw rollback;
    }).catch((error: unknown) => {
      if (error !== rollback) throw error;
    });
    return state!;
  }

  async function databaseState() {
    const [ledger, identities, sequence] = await Promise.all([
      sql`SELECT to_jsonb(a) AS row FROM afl_api_identity_adjudications a WHERE external_id IN (${p1}, ${p2}, ${p3}, ${p4}) ORDER BY id`,
      sql`SELECT to_jsonb(e) AS row FROM external_identities e WHERE source_id = ${refs.aflApiSourceId} AND external_id IN (${p1}, ${p2}, ${p3}, ${p4}) ORDER BY id`,
      sql`SELECT last_value::text AS "lastValue", is_called AS "isCalled" FROM afl_api_identity_adjudications_id_seq`,
    ]);
    return { ledger: [...ledger], identities: [...identities], sequence: [...sequence] };
  }

  function pendingFileState(): { files: string[]; pending: string } {
    return {
      files: readdirSync(dir).sort(),
      pending: readFileSync(join(dir, PENDING_CAPTURE_FILE), 'utf8'),
    };
  }

  /** Wraps `settleCapture` for this suite's ObservedState shape, with an empty importer section. */
  function settleObserved(pending: CombinedCapture, state: ObservedState) {
    return settleCapture({
      dir, database, capturedAt: '2026-09-24T01:00:00.000Z',
      pending: { capture: pending, fileSha256: readPendingCaptureWithHash(dir, database)!.fileSha256 },
      live: { ledgerPresent: state.live.present, ledgerRows: state.live.rows, importerRows: [] },
      decision: state.decision, observed: state.observed,
    });
  }

  it('OD-5 recovery — a committed reinstatement whose capture was never archived is verified, archived and captured afresh; the database is not written', async () => {
    const pending = await writePendingPreResetCapture();
    const pendingFileSha256 = readPendingCaptureWithHash(dir, database)!.fileSha256;
    const before = await databaseState();

    // The observation refuses a read-write transaction outright.
    await expect(sql.begin((tx) => observeLiveReinstatement(tx, []))).rejects.toThrow(/read-only transaction/);

    const state = await observeCommitted(pending);
    expect(state.decision).toEqual({ action: 'verify-reinstated' });
    expect(state.observed).not.toBeNull();
    const observed = state.observed!;
    expect(observed.replay).toEqual({ inserted: 0, noops: 2, stops: [], supersedes: [] }); // P1 and P3, already present
    expect(observed.importerReplay).toEqual({ inserted: 0, noops: 0 }); // no importer rows in this fixture
    expect(observed.bijection).toBe('ok');
    const maxId = Math.max(...state.live.rows.map((r) => r.id));
    expect(nextIdentityValue(observed.sequence)).toBeGreaterThan(maxId);
    expect(reinstatedCaptureProblems(pending, state.live.rows, [], observed)).toEqual([]);

    const outcome = settleCapture({
      dir, database, capturedAt: '2026-09-24T01:00:00.000Z',
      pending: { capture: pending, fileSha256: pendingFileSha256 },
      live: { ledgerPresent: state.live.present, ledgerRows: state.live.rows, importerRows: [] },
      decision: state.decision, observed: state.observed,
    });
    expect(outcome.adopted).toBeNull();
    expect(outcome.archived).toBe(join(dir, archivedCaptureName(pending)));
    expect(existsSync(outcome.archived!)).toBe(true);
    expect(outcome.captured!.capture.ledgerRows).toEqual(state.live.rows); // this run's capture: the live ledger
    expect(readPendingCapture(dir, database)?.payloadSha256).toBe(outcome.captured!.capture.payloadSha256);
    expect(readdirSync(dir).sort()).toEqual([archivedCaptureName(pending), PENDING_CAPTURE_FILE].sort());

    expect(await databaseState()).toEqual(before); // read-only: no ledger, identity or sequence change
  });

  it('OD-5 reinstate (rolled back, no rebuild) — reinstateAndReplay() puts a captured ledger back byte-for-byte under its original ids, replays it and passes the bijection', async () => {
    // Not I18 and not a rebuild: the stage-(ii) function itself, against real PostgreSQL, inside
    // ONE transaction that is always rolled back. It meets the state a reset leaves (players and
    // their AFL Tables identities present, the ledger empty, no afl_api identity of either kind)
    // by deleting this case's own ledger rows and human rows inside that transaction -- and the
    // file's root baseline importer row too (`BRIDGED_PROVIDER_PLAYER_ID`), which a real reset
    // would equally have removed and which `reinstateAndReplay()` rightly refuses to meet.
    const pending = await writePendingPreResetCapture();
    const pendingFileSha256 = readPendingCaptureWithHash(dir, database)!.fileSha256;
    const before = await databaseState();
    const [sequenceBefore] = await sql<{ lastValue: string; isCalled: boolean }[]>`
      SELECT last_value::text AS "lastValue", is_called AS "isCalled" FROM afl_api_identity_adjudications_id_seq
    `;
    const rollback = new Error('ISSUE-235 OD-5: roll the reinstatement back');
    let report: ReinstateReport | undefined;
    let readBack: CapturedLedgerRow[] = [];
    try {
      await sql.begin(async (tx) => {
        await tx`
          DELETE FROM external_identities
           WHERE source_id = ${refs.aflApiSourceId} AND external_id IN (${p1}, ${p2}, ${p3}, ${BRIDGED_PROVIDER_PLAYER_ID})
        `;
        await tx`DELETE FROM afl_api_identity_adjudications WHERE external_id IN (${p1}, ${p2}, ${p3})`;
        // reinstateAndReplay()'s precondition (D11b): a rebuild marker matching this capture must
        // be present. Real Stage 2 sets it before `recreate`; this test synthesises the same
        // precondition here, inside the transaction it will roll back with everything else.
        await setRebuildMarker(tx, database, {
          capturedAt: pending.capturedAt, payloadSha256: pending.payloadSha256, fileSha256: pendingFileSha256,
        });
        report = await reinstateAndReplay(tx, pending);
        readBack = (await readLedger(tx)).rows;
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      // reinstateAndReplay() advances the identity sequence with setval(), which no rollback
      // undoes: put it back exactly.
      await sql`
        SELECT setval('public.afl_api_identity_adjudications_id_seq'::regclass,
                      ${sequenceBefore.lastValue}::bigint, ${sequenceBefore.isCalled})
      `;
    }

    expect(report).toMatchObject({
      importerInserted: 0, importerNoops: 0,
      ledgerRows: 4, actorsReused: 1, actorsCreated: 0, replay: { inserted: 2, noops: 0, stops: [], supersedes: [] },
    });
    const ledgerFields = (r: CapturedLedgerRow) => [
      r.id, r.externalId, r.action, r.playerIdentity, r.previousState, r.evidence, r.evidenceSha256,
      r.surnameDisagreementAcknowledged, r.supersedesId, r.note, r.createdAt,
    ];
    expect(readBack.map(ledgerFields)).toEqual(pending.ledgerRows.map(ledgerFields));
    expect(await databaseState()).toEqual(before); // rolled back, sequence restored (marker rolled back too)
  });

  it('OD-5 recovery — a missing human identity is refused as already_reinstated_unverified; the pending capture is left in place', async () => {
    const pending = await writePendingPreResetCapture();
    const filesBefore = pendingFileState();
    const state = await observeAltered(pending, async (tx) => {
      await tx`DELETE FROM external_identities WHERE source_id = ${refs.aflApiSourceId} AND external_id = ${p3}`;
    });
    expect(state.decision).toEqual({ action: 'verify-reinstated' }); // the ledger itself still matches
    const observed = state.observed!;
    // The replay NEEDED an INSERT, which the read-only transaction refused inside its savepoint.
    expect(observed.replay).toEqual({ error: expect.stringMatching(/read-only transaction/) });
    expect(observed.bijection).toEqual({ error: expect.stringContaining(`ledger_without_row:${p3}`) });
    const problems = reinstatedCaptureProblems(pending, state.live.rows, [], observed).join('\n');
    expect(problems).toContain('a replay could not confirm the human identities');
    expect(problems).toContain('the bijection does not hold');

    expect(() => settleObserved(pending, state)).toThrow(/already_reinstated_unverified/);
    expect(pendingFileState()).toEqual(filesBefore);
    expect(await i235AflApiRows(refs, { providerId: p3 })).toHaveLength(1); // rolled back
  });

  it('OD-5 recovery — a human identity with no ledger entry is refused; the pending capture is left in place', async () => {
    const pending = await writePendingPreResetCapture();
    const filesBefore = pendingFileState();
    const state = await observeAltered(pending, async (tx) => {
      await tx`
        INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method, notes)
        VALUES (${refs.aflApiSourceId}, ${p4}, ${spare.id}, 'resolved', 0, 'afl_api_admin_adjudication',
                'AFLDB-ISSUE-235 S6 fixture: a human row with no ledger entry')
      `;
    });
    expect(state.decision).toEqual({ action: 'verify-reinstated' });
    expect(state.observed!.replay).toEqual({ inserted: 0, noops: 2, stops: [], supersedes: [] }); // the ledger's own rows are fine
    expect(state.observed!.bijection).toEqual({ error: expect.stringContaining(`row_without_ledger:${p4}`) });
    expect(() => settleObserved(pending, state)).toThrow(/already_reinstated_unverified/);
    expect(pendingFileState()).toEqual(filesBefore);
    expect(await i235AflApiRows(refs, { providerId: p4 })).toEqual([]); // rolled back
  });

  it('OD-5 recovery — ledger drift is refused before any observation; the pending capture is left in place', async () => {
    const pending = await writePendingPreResetCapture();
    const filesBefore = pendingFileState();
    const state = await observeAltered(pending, async (tx) => {
      await tx`
        INSERT INTO afl_api_identity_adjudications
              (source_key, external_id, action, player_id, player_identity, evidence, evidence_sha256,
               surname_disagreement_acknowledged, admin_user_id, note)
        VALUES ('afl_api', ${p4}, 'linked', ${spare.id}, ${spare.identity}, '{"fixture":"OD-5 drift"}'::jsonb,
                ${'b'.repeat(64)}, false, ${actorId}, ${S6_NOTE})
      `;
    });
    expect(state.live.rows).toHaveLength(5);
    expect(state.decision).toMatchObject({ action: 'refuse' });
    expect(state.observed).toBeNull();
    expect(() => settleObserved(pending, state)).toThrow(/differs from it/);
    expect(pendingFileState()).toEqual(filesBefore);
    const [{ n }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM afl_api_identity_adjudications WHERE external_id = ${p4}
    `;
    expect(n).toBe(0); // rolled back
  });
});

/**
 * AFLDB-ISSUE-235 S6 — the fixture-leftover gate. Last in file order, so a full-file run reaches
 * it after every ISSUE-235 describe's own teardown and after the root cleanup() of the settle
 * lifecycle's namespace rows; run on its own (`-t "fixture-leftover gate"`) it proves an
 * interrupted earlier run left nothing behind. It deletes nothing.
 */
describe('AFLDB-ISSUE-235 S6 fixture-leftover gate', () => {
  it('S6 fixture-leftover gate — afldb_test holds zero ISSUE-235 fixture rows', async () => {
    const refs = await loadS6Refs(sql);
    expect(await issue235FixtureResidue(sql, refs)).toEqual(ZERO_ISSUE235_RESIDUE);
  });
});

/**
 * AFLDB-ISSUE-237 — the I237 fixture-leftover gate, the exact counterpart to the ISSUE-235 gate
 * above, over `I237_OWNERSHIP` instead. Last in file order for the same reason: a full-file run
 * reaches it after the I237 describe's own `afterAll` teardown, so it proves that teardown left
 * nothing behind on the WHOLE table (whole-table isolation guarding) — not merely that the I237
 * describe's own within-suite assertions happened to pass. It deletes nothing.
 */
describe('AFLDB-ISSUE-237 I237 fixture-leftover gate', () => {
  it('I237 fixture-leftover gate — afldb_test holds zero I237 fixture rows', async () => {
    const refs = await loadS6Refs(sql);
    expect(await issue237FixtureResidue(sql, refs)).toEqual(ZERO_ISSUE237_RESIDUE);
    // The reverse direction -- that I237's ids are never, even coincidentally, counted by the
    // ISSUE-235 gate's ownership definition (or vice versa) -- is proven exhaustively and
    // DB-free by `i237Issue235OwnershipOverlap()` above; not repeated here as a live query.
  });
});
