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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  parseAflApiIdentities, type AflApiIdentities,
} from '@/lib/acquisition/afl-api-bundle';
import {
  buildAflApiSettleBundle,
  runSettleAflApi,
  SETTLE_BATCH_TOOL,
  SETTLE_ISSUE_OWNER,
  type AflApiSettleBundle,
  type AflApiSettleUnitSource,
} from '@/lib/acquisition/settle-afl-api';
import { renderMatchKey } from '@/lib/acquisition/settle-core';
import {
  getSourceFamily,
  parseSourceFamilyRegistry,
  type SourceFamilyRegistry,
} from '@/lib/acquisition/source-families';
import { recomputeClubSeasons, recomputeSeasonMetadata } from '@/db/queries/player-derived';

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
  await sql`
    INSERT INTO external_identities (source_id, external_id, status, match_method, player_id)
    VALUES (${aflApiSourceId}, ${BRIDGED_PROVIDER_PLAYER_ID}, 'unique', 'afl_api_stat_vector_bootstrap', ${bridgedPlayerId})
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
