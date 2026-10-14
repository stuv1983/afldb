/**
 * AFLDB-ISSUE-276 — a roster whose period scores contradict the fixture's final score, against
 * real PostgreSQL (`runSettleAflApi()` on `afldb_test`).
 *
 * WHY THIS IS NOT IN `settle-afl-api.test.ts`. That suite's file-level hooks run a BROAD baseline
 * before every case: `cleanup()` (every `issue228-integration` batch, every `%CD_M2026ISSUE228%`
 * row, the shared keep-alive match), a rebuilt synthetic player and bridge, and a full recompute
 * of the shared 2026 `seasons`/`club_seasons` rows. Module-level hooks apply to every `describe`
 * in the file, so a focused `-t` run of three small cases would still have executed all of it.
 * This file owns its own namespace and its own narrow hooks instead. Nothing here imports the
 * ISSUE-228 suite (importing it would register its hooks and cases).
 *
 * NAMESPACE. Provider match ids `CD_M2026ISSUE276<A-D>`; batch label `issue276-integration`
 * (the batch `notes` carry `snapshot=issue276-integration;`); the keep-alive match key
 * `CD_M2026ISSUE276-keepalive`; four June Monday/Tuesday/Wednesday dates used by no other suite.
 * Every provider PLAYER id in the cloned payloads is rewritten to `CD_I276<digits>`, a shape
 * real provider ids are not known to have (nine digits where the fixtures' own ids have six), so no fixture player can resolve to a real
 * or ISSUE-228 bridged player. Every player unit therefore refuses as `unresolved_identity` (a
 * well-trodden path: ISSUE-228's own cases refuse 40+ players per run) and this file writes NO
 * `players`, `external_identities`, `player_match_stats`, `player_clubs` or other player-derived row.
 *
 * OWNERSHIP IS PROVEN, NEVER ASSUMED. An exact canonical match key (or an id prefix) is only a way
 * to FIND a row; it never authorises deleting it. The rules, in order:
 *   1. STARTUP IS READ-ONLY AND FAILS CLOSED. Before this file writes anything it inspects the whole
 *      namespace (matches, ledger, candidates, rejections, findings, typed projections, spine
 *      records/versions, batches carrying the marker, and any afl_api payload row whose STORED
 *      content carries an exact namespace marker). ANY hit stops the run with a listing. Nothing is
 *      removed automatically; an operator decides (see RESIDUE.sql, which classifies the same rows).
 *   2. FOREIGN CONFLICTS ARE CHECKED BEFORE ANY FIXTURE WRITE (`findPlausibleCanonicalFixtures`, the
 *      planner's own predicate), at startup and again before every case. A hit stops the run; the
 *      row is never touched.
 *   3. EVERYTHING THIS RUN CREATES IS TRACKED BY RETURNED IDENTITY. Batches by the id
 *      `runSettleAflApi()` returns (and re-checked to carry the marker); the keep-alive and case D's
 *      foreign-owned row by `INSERT ... RETURNING id` plus a run-unique `matches.notes` marker.
 *      Every other row is then owned only through those: a match must be written by an adopted batch
 *      (`source_id = afl_api`, `source_record_id` in the namespace, `import_batch_id` adopted) or be
 *      a returned seed; ledger/candidate/rejection/projection/spine rows must cite an adopted batch.
 *      A namespace row that fails these tests is UNPROVEN: teardown refuses (throws) rather than
 *      delete it. `data_issues` has no batch/provenance column, so a finding is owned by its exact
 *      provider id in the key AND at least one adopted batch (the weakest link, stated openly).
 *   4. A second concurrent run is excluded by a session advisory lock held for the whole run.
 *   5. PAYLOADS are content-addressed and shared, so they are owned only by exact retained
 *      identity: the (family, payload_hash) of a version proven owned, captured BEFORE that version
 *      is deleted, AND stored content that carries an exact namespace marker (a quoted fixture
 *      provider id or rewritten player id; checked DB-free for every record this file can build),
 *      AND no surviving version cites it. No unrelated orphan payload is ever examined or removed.
 *
 * TEARDOWN IS ATOMIC. Every removal runs in ONE transaction, child to parent, each statement
 * asserting the exact row count its ownership proof predicted; any mismatch rolls the whole removal
 * back. After it, the namespace is re-inspected and must be empty. Teardown steps are independent:
 * each runs even if an earlier one failed, failures are collected, and `afterAll` throws one error
 * naming everything left behind (it does not touch anything at all if startup never completed).
 *
 * SHARED DERIVED STATE (what the writer changes, and how it is restored). Whenever a case's settle
 * writes a canonical row, the writer itself recomputes season 2026 in the same transaction:
 *   - `recomputeSeasonMetadata`        UPDATE seasons: first_match_date, last_match_date,
 *                                      match_count, club_count, status, data_through_date,
 *                                      last_loaded_round, completed_at (and so the generated is_complete);
 *   - `recomputeClubSeasons`           DELETE + INSERT every 2026 club_seasons row (new identity `id`s;
 *                                      `import_batch_id` is NOT written, so it becomes NULL);
 *   - `recomputeSeasonBrownlowStatus`  UPDATE every 2026 player_season_stats row: brownlow_status
 *                                      AND brownlow_votes.
 * `recomputePlayerDerivedStats` is a no-op here (no fixture player resolves, so no player ids).
 * That is production code and cannot be avoided from a test. Recomputing "canonical truth" afterwards
 * would NOT prove the captured baseline came back (a baseline may differ from recomputed truth, and
 * `import_batch_id` is lost), so this file does not recompute. Before any write it captures the
 * baseline of exactly those rows (the full seasons row; every club_seasons column but `id`; the
 * brownlow columns of every 2026 player_season_stats row plus an md5 of the WHOLE rows). At teardown
 * it compares, and only if they differ it restores them from that capture in one transaction, then
 * re-captures and ASSERTS equality (a mismatch fails the run). Transaction isolation was rejected:
 * the writer commits through its own `sql.begin`, and a case must observe committed state across
 * several runs. The restoration columns are checked against the live schema at startup.
 * EXCLUDED, and why: `club_seasons.id` (identity, reissued by every recompute, nothing references
 * it); sequence positions (`club_seasons`, `matches`, `data_issues`, `import_batches`, ... are never
 * rolled back by anything); `players`/`player_*` (untouched, see NAMESPACE). Between a case's
 * commit and teardown, other sessions on `afldb_test` can observe the recomputed rows; the lock
 * above only excludes other runs OF THIS FILE.
 *
 * @see issues/open/AFLDB-ISSUE-276.md
 * @see issues/open/AFLDB-ISSUE-276-RESIDUE.sql (read-only residue classification for exactly this scope)
 */
import './guard';

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { parseAflApiIdentities, type AflApiIdentities } from '@/lib/acquisition/afl-api-bundle';
import { findPlausibleCanonicalFixtures } from '@/lib/acquisition/match-rekey';
import {
  buildAflApiSettleBundle,
  runSettleAflApi,
  SETTLE_ISSUE_OWNER,
  type AflApiSettleBundle,
  type AflApiSettleUnitSource,
} from '@/lib/acquisition/settle-afl-api';
import { renderMatchKey } from '@/lib/acquisition/settle-core';
import {
  getSourceFamily, parseSourceFamilyRegistry, type SourceFamilyRegistry,
} from '@/lib/acquisition/source-families';

const PROJECT_ROOT = join(__dirname, '..', '..');
const FIXTURE_DIR = join(PROJECT_ROOT, 'tests', 'fixtures', 'afl_api', 'match');

const SEASON = 2026;
const NS = 'CD_M2026ISSUE276';
const SNAPSHOT_LABEL = 'issue276-integration';
const SNAPSHOT_MARKER = `snapshot=${SNAPSHOT_LABEL};`;
const KEEPALIVE_MATCH_KEY = `${NS}-keepalive`;
const HOME_HIST = 'Hawthorn';
const AWAY_HIST = 'Brisbane Lions';

/** Unique to this run: stamped into the `matches.notes` of the two rows this file seeds itself. */
const RUN_TOKEN = randomUUID();
const SEED_NOTE = `AFLDB-ISSUE-276 integration fixture; run=${RUN_TOKEN}`;
/** Session advisory lock (two-int form, so it cannot collide with a single-bigint key). */
const RUN_LOCK = { classId: 276_276, objId: 1 } as const;

const CASE_IDS = {
  fresh: `${NS}A`,
  existing: `${NS}B`,
  lifecycle: `${NS}C`,
  corroborated: `${NS}D`,
} as const;
const ALL_IDS: string[] = Object.values(CASE_IDS);

/**
 * One dedicated date per case (the date, not the provider id, is what makes a case its own
 * canonical match). June 2026 Monday/Tuesday/Wednesday/Monday (AEST, no daylight saving);
 * no Preliminary Final is ever played then, and ISSUE-228's own June dates are the 1st-3rd.
 * `07:15:00Z` -> `17:15:00` is Australia/Melbourne at AEST, exactly as ISSUE-228's `unitSourceFor`.
 */
const CASE_DATES: Readonly<Record<string, string>> = {
  [CASE_IDS.fresh]: '2026-06-15',
  [CASE_IDS.existing]: '2026-06-16',
  [CASE_IDS.lifecycle]: '2026-06-17',
  [CASE_IDS.corroborated]: '2026-06-22',
};

const PERIOD_TYPE = 'afl_api_period_scores_contradiction';
const PERIOD_REASON = 'period_scores_contradict_final_score';

/* ------------------------------------------------------------------ *
 * Fixture construction
 * ------------------------------------------------------------------ */

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8'));
}

/** Rewrites every provider player id (`CD_I<digits>`) so none can resolve to a real or ISSUE-228 player. */
function isolatePlayerIds<T>(payload: T): T {
  return JSON.parse(JSON.stringify(payload).replace(/CD_I(\d+)/g, 'CD_I276$1')) as T;
}

/** The rewritten player ids, derived from the two fixture files that carry them (exactly two today). */
const FIXTURE_PLAYER_IDS: readonly string[] = [...new Set(
  ['02-player-stats.raw.json', '03-match-roster.raw.json']
    .flatMap((name) => JSON.stringify(readFixture(name)).match(/CD_I\d+/g) ?? []),
)].map((id) => id.replace(/^CD_I/, 'CD_I276'));

/**
 * Exact JSON string values (quoted, so a longer id cannot match as a prefix) whose presence in a
 * STORED payload is positive evidence that the payload came from this file's fixtures.
 */
const PAYLOAD_MARKERS: readonly string[] = [...ALL_IDS, ...FIXTURE_PLAYER_IDS].map((id) => JSON.stringify(id));
const PAYLOAD_FAMILIES = ['match', 'match_roster', 'player_match_stats'] as const;

type FixtureRaw = { providerId: string; utcStartTime: string };
type RosterRaw = {
  match: { matchId: string; venueLocalStartTime: string };
  matchRoster: { matchId: string; homeTeam: { matchId: string }; awayTeam: { matchId: string } };
  recentMatchScores: { matchId: string }[];
};
type RawUnit = { fixture: unknown; roster: unknown; stats: unknown };

function matchDateFor(providerMatchId: string): string {
  const date = CASE_DATES[providerMatchId];
  if (!date) throw new Error(`No CASE_DATES entry for provider match id '${providerMatchId}'.`);
  return date;
}

/** The ISSUE-228 suite's `unitSourceFor`, restated: cloned proven bytes, own id and date, one mutation. */
function unitSourceFor(providerMatchId: string, mutate?: (raw: RawUnit) => void): AflApiSettleUnitSource {
  const fixture = clone(readFixture('01-fixture-result.json')) as FixtureRaw;
  const roster = isolatePlayerIds(clone(readFixture('03-match-roster.raw.json'))) as RosterRaw;
  const stats = isolatePlayerIds(clone(readFixture('02-player-stats.raw.json')));
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

/**
 * Builds the bundle AND proves, before anything can be written, that every record the writer will
 * persist carries an exact namespace marker in its payload (the stored-payload ownership evidence
 * the teardown relies on). Fails the case instead of letting an unprovable payload be stored.
 */
function buildBundle(sources: readonly AflApiSettleUnitSource[]): AflApiSettleBundle {
  const bundle = buildAflApiSettleBundle({
    season: SEASON, snapshotLabel: SNAPSHOT_LABEL, sources, registry, identities,
  });
  expect(bundle.buildFailures).toEqual([]);
  for (const unit of bundle.units) {
    for (const record of unit.settleRecords) {
      const text = JSON.stringify(record.payload);
      if (!PAYLOAD_MARKERS.some((marker) => text.includes(marker))) {
        throw new Error(
          `ISSUE-276 fixture record ${record.family}/${record.externalRecordId} carries no namespace marker in its payload; `
          + 'its stored payload could not be proven ours. Nothing was written.',
        );
      }
    }
  }
  return bundle;
}

type ScoreSide = { periodScore: { score: Record<string, number> }[] };
type ScoreEntry = { matchId: string; homeTeamScore: ScoreSide; awayTeamScore: ScoreSide };

function ownScoreEntryOf(roster: unknown, providerId: string): ScoreEntry {
  const entry = (roster as { recentMatchScores: ScoreEntry[] }).recentMatchScores
    .find((candidate) => candidate.matchId === providerId);
  if (!entry) throw new Error(`The fixture roster has no recentMatchScores entry for '${providerId}'.`);
  return entry;
}

/** The issue's own trigger: a partial payload with three periods only (ends 77-95, not 122-131). */
function threePeriodsOnly(providerId: string) {
  return (raw: RawUnit): void => {
    const entry = ownScoreEntryOf(raw.roster, providerId);
    for (const side of [entry.homeTeamScore, entry.awayTeamScore]) side.periodScore = side.periodScore.slice(0, 3);
  };
}

/** A stale fourth period: internally consistent, but it ends 83-101 rather than 122-131. */
function staleFourthPeriod(providerId: string) {
  return (raw: RawUnit): void => {
    const entry = ownScoreEntryOf(raw.roster, providerId);
    for (const side of [entry.homeTeamScore, entry.awayTeamScore]) {
      side.periodScore[3].score = { totalScore: 6, goals: 1, behinds: 0, superGoals: 0 };
    }
  };
}

/** No own-match score entry at all: `periodScoresReproduceFinalScore === null` (absence of evidence). */
function withoutOwnScoreEntry(providerId: string) {
  return (raw: RawUnit): void => {
    const roster = raw.roster as RosterRaw;
    roster.recentMatchScores = roster.recentMatchScores.filter((entry) => entry.matchId !== providerId);
  };
}

/** A roster that is not concluded (the fixture itself is): the roster family DEFERS. */
function liveRoster(raw: RawUnit): void {
  (raw.roster as { matchRoster: { status: string } }).matchRoster.status = 'LIVE';
}

/** The local match date becomes unproved (`unproved_match_date`): the match family is REFUSED. */
function withoutVenueTimezone(raw: RawUnit): void {
  delete (raw.fixture as { venue: { timezone?: string } }).venue.timezone;
}

/* ------------------------------------------------------------------ *
 * Connection, run state and the ownership ledger
 * ------------------------------------------------------------------ */

const sql = postgres(process.env.AFLDB_TEST_DATABASE_URL as string, { max: 1, onnotice: () => {} });

let registry: SourceFamilyRegistry;
let identities: AflApiIdentities;
let aflApiSourceId: number;
let afltablesSourceId: number;
let homeClubId: number;
let awayClubId: number;
let homeClubName: string;
let awayClubName: string;
let venueId: number;

type PayloadKey = { family: string; payloadHash: string };

/**
 * What THIS run has created, by returned identity. Nothing is ever added by searching for it.
 * `writesAllowed` becomes true only once startup has proved the namespace empty and captured the
 * baseline; until then teardown touches nothing (and a failed startup therefore cannot delete the
 * leftovers it just refused to run over).
 */
const ledger = {
  writesAllowed: false,
  /** `import_batches.id` values returned by `runSettleAflApi()`, each re-verified to carry the marker. */
  batchIds: new Set<string>(),
  /** `matches.id` values returned by this run's own `INSERT ... RETURNING id`. */
  seededMatchIds: new Set<number>(),
  keepaliveMatchId: null as number | null,
  /** Exact payload identities, retained from versions proven owned, before those versions go. */
  payloads: new Map<string, PayloadKey>(),
};

function matchKeyFor(providerMatchId: string): string {
  if (!homeClubName || !awayClubName) throw new Error('matchKeyFor() was called before beforeAll() read the club names.');
  return renderMatchKey(SEASON, 'PF', matchDateFor(providerMatchId), homeClubName, awayClubName);
}

function caseMatchKeys(): string[] {
  return ALL_IDS.map((id) => matchKeyFor(id));
}

/** The integration guard (`./guard`, tests/setup.ts) already requires `_test`; this re-checks the live connection. */
async function assertTestDatabase(): Promise<void> {
  const [{ db }] = await sql<{ db: string }[]>`SELECT current_database() AS db`;
  if (!/_test$/.test(db)) {
    throw new Error(`ISSUE-276 integration cases refuse to run against '${db}': the database name must end in _test.`);
  }
}

/** Mutual exclusion between runs of THIS file. Held on the single pooled connection until it closes. */
async function acquireRunLock(): Promise<void> {
  const [{ locked }] = await sql<{ locked: boolean }[]>`
    SELECT pg_try_advisory_lock(${RUN_LOCK.classId}::int, ${RUN_LOCK.objId}::int) AS locked
  `;
  if (!locked) {
    throw new Error(
      'Another run of the ISSUE-276 integration file holds the advisory lock on this database. '
      + 'Wait for it to finish; nothing was inspected or written.',
    );
  }
}

/* ------------------------------------------------------------------ *
 * Shared derived state: schema check, capture, diff, restore
 * ------------------------------------------------------------------ */

/** Exact column set of `club_seasons`: restoration is DELETE + INSERT, so an unknown column would be lost. */
const CLUB_SEASONS_COLUMNS = [
  'id', 'season', 'club_id', 'played', 'wins', 'draws', 'losses', 'points_for', 'points_against',
  'premiership_points', 'percentage', 'ladder_rank', 'wooden_spoon', 'is_premier', 'finals_played',
  'source_id', 'import_batch_id',
];
const SEASONS_RESTORED_COLUMNS = [
  'year', 'first_match_date', 'last_match_date', 'match_count', 'club_count', 'status',
  'data_through_date', 'last_loaded_round', 'completed_at',
];
const PSS_RESTORED_COLUMNS = ['player_id', 'season', 'brownlow_status', 'brownlow_votes'];

async function columnsOf(table: string): Promise<Map<string, { generated: string; identity: string }>> {
  const rows = await sql<{ name: string; generated: string; identity: string }[]>`
    SELECT column_name AS name, is_generated AS generated, is_identity AS identity
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ${table}
  `;
  return new Map(rows.map((r) => [r.name, { generated: r.generated, identity: r.identity }]));
}

/** Fails closed, before any write, if the live schema is not the one the restoration was written for. */
async function assertRestorationSchemaKnown(): Promise<void> {
  const problems: string[] = [];
  const clubSeasons = await columnsOf('club_seasons');
  const actual = [...clubSeasons.keys()].sort();
  const expected = [...CLUB_SEASONS_COLUMNS].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    problems.push(`club_seasons columns are [${actual.join(', ')}], expected exactly [${expected.join(', ')}]`);
  }
  if (clubSeasons.get('id')?.identity !== 'YES') problems.push('club_seasons.id is not an identity column');
  const seasons = await columnsOf('seasons');
  for (const column of SEASONS_RESTORED_COLUMNS) if (!seasons.has(column)) problems.push(`seasons.${column} is missing`);
  if (seasons.get('is_complete')?.generated !== 'ALWAYS') problems.push('seasons.is_complete is no longer a generated column');
  const pss = await columnsOf('player_season_stats');
  for (const column of PSS_RESTORED_COLUMNS) if (!pss.has(column)) problems.push(`player_season_stats.${column} is missing`);
  const [{ n }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f' AND confrelid = 'club_seasons'::regclass
  `;
  if (n > 0) problems.push(`${n} foreign key(s) reference club_seasons; its ids cannot be allowed to be reissued`);
  if (problems.length > 0) {
    throw new Error(
      'ISSUE-276 cannot guarantee restoring the shared season-2026 derived rows on this schema; nothing was written: '
      + problems.join('; '),
    );
  }
}

type SharedState = {
  season: Record<string, unknown>;
  clubSeasons: Record<string, unknown>[];
  brownlow: { playerId: number; status: string; votes: number | null }[];
  pssCount: number;
  pssDigest: string;
};

/** The full 2026 state the writer's recompute can change, captured so it can be compared and restored. */
async function captureSharedState(): Promise<SharedState> {
  const [season] = await sql<{ row: Record<string, unknown> }[]>`
    SELECT to_jsonb(s) AS row FROM seasons s WHERE s.year = ${SEASON}
  `;
  if (!season) throw new Error(`seasons has no row for ${SEASON}; the writer's recompute has nothing to update.`);
  const clubSeasons = await sql<{ row: Record<string, unknown> }[]>`
    SELECT to_jsonb(c) - 'id' AS row FROM club_seasons c WHERE c.season = ${SEASON} ORDER BY c.club_id
  `;
  const brownlow = await sql<{ playerId: number; status: string; votes: number | null }[]>`
    SELECT player_id AS "playerId", brownlow_status::text AS status, brownlow_votes AS votes
      FROM player_season_stats WHERE season = ${SEASON} ORDER BY player_id
  `;
  const [digest] = await sql<{ n: number; digest: string }[]>`
    SELECT count(*)::int AS n, coalesce(md5(string_agg(to_jsonb(p)::text, '|' ORDER BY p.player_id)), '') AS digest
      FROM player_season_stats p WHERE p.season = ${SEASON}
  `;
  return {
    season: season.row,
    clubSeasons: clubSeasons.map((r) => r.row),
    brownlow: brownlow.map((r) => ({ playerId: r.playerId, status: r.status, votes: r.votes })),
    pssCount: digest.n,
    pssDigest: digest.digest,
  };
}

/** Empty when `actual` equals `baseline` on every captured column; otherwise one line per difference. */
function diffSharedState(baseline: SharedState, actual: SharedState): string[] {
  const out: string[] = [];
  for (const key of new Set([...Object.keys(baseline.season), ...Object.keys(actual.season)])) {
    if (JSON.stringify(baseline.season[key]) !== JSON.stringify(actual.season[key])) {
      out.push(`seasons.${key}: baseline ${JSON.stringify(baseline.season[key])} -> now ${JSON.stringify(actual.season[key])}`);
    }
  }
  if (JSON.stringify(baseline.clubSeasons) !== JSON.stringify(actual.clubSeasons)) {
    const clubOf = (row: Record<string, unknown>) => String(row.club_id);
    const before = new Map(baseline.clubSeasons.map((r) => [clubOf(r), JSON.stringify(r)]));
    const after = new Map(actual.clubSeasons.map((r) => [clubOf(r), JSON.stringify(r)]));
    const differing = [...new Set([...before.keys(), ...after.keys()])].filter((club) => before.get(club) !== after.get(club));
    out.push(
      `club_seasons (excluding id): baseline ${baseline.clubSeasons.length} row(s), now ${actual.clubSeasons.length}; `
      + `differing club_id(s): ${differing.join(', ')}`,
    );
  }
  if (baseline.pssCount !== actual.pssCount || baseline.pssDigest !== actual.pssDigest) {
    const before = new Map(baseline.brownlow.map((r) => [r.playerId, `${r.status}/${r.votes}`]));
    const after = new Map(actual.brownlow.map((r) => [r.playerId, `${r.status}/${r.votes}`]));
    const differing = [...new Set([...before.keys(), ...after.keys()])].filter((id) => before.get(id) !== after.get(id));
    out.push(
      `player_season_stats ${SEASON}: baseline ${baseline.pssCount} row(s), now ${actual.pssCount}; whole-row md5 `
      + `${baseline.pssDigest === actual.pssDigest ? 'equal' : 'DIFFERS'}; brownlow status/votes differ for ${differing.length} player(s)`,
    );
  }
  return out;
}

let sharedBaseline: SharedState;

/**
 * Brings the shared 2026 rows back to the captured baseline if (and only if) they differ, from the
 * capture itself rather than by recomputing, then re-captures and ASSERTS equality. Throws on any
 * remaining difference. Covers the "no non-final matches" case with no special branch: whatever the
 * baseline held (rows, or none) is what is restored.
 */
async function restoreSharedBaseline(): Promise<void> {
  const differences = diffSharedState(sharedBaseline, await captureSharedState());
  if (differences.length > 0) {
    await sql.begin(async (tx) => {
      await tx`
        UPDATE seasons s
           SET first_match_date = b.first_match_date, last_match_date = b.last_match_date,
               match_count = b.match_count, club_count = b.club_count, status = b.status,
               data_through_date = b.data_through_date, last_loaded_round = b.last_loaded_round,
               completed_at = b.completed_at
          FROM jsonb_to_recordset(${tx.json([sharedBaseline.season] as postgres.JSONValue)}) AS b(
                 year smallint, first_match_date date, last_match_date date, match_count integer,
                 club_count smallint, status season_status, data_through_date date,
                 last_loaded_round text, completed_at date)
         WHERE s.year = b.year
      `;
      await tx`DELETE FROM club_seasons WHERE season = ${SEASON}`;
      if (sharedBaseline.clubSeasons.length > 0) {
        await tx`
          INSERT INTO club_seasons (
            season, club_id, played, wins, draws, losses, points_for, points_against,
            premiership_points, percentage, ladder_rank, wooden_spoon, is_premier,
            finals_played, source_id, import_batch_id)
          SELECT b.season, b.club_id, b.played, b.wins, b.draws, b.losses, b.points_for, b.points_against,
                 b.premiership_points, b.percentage, b.ladder_rank, b.wooden_spoon, b.is_premier,
                 b.finals_played, b.source_id, b.import_batch_id
            FROM jsonb_to_recordset(${tx.json(sharedBaseline.clubSeasons as postgres.JSONValue)}) AS b(
                   season smallint, club_id integer, played smallint, wins smallint, draws smallint,
                   losses smallint, points_for integer, points_against integer, premiership_points integer,
                   percentage numeric, ladder_rank smallint, wooden_spoon boolean, is_premier boolean,
                   finals_played smallint, source_id smallint, import_batch_id bigint)
           ORDER BY b.club_id
        `;
      }
      await tx`
        UPDATE player_season_stats p
           SET brownlow_status = b.status, brownlow_votes = b.votes
          FROM jsonb_to_recordset(${tx.json(sharedBaseline.brownlow as postgres.JSONValue)}) AS b(
                 "playerId" integer, status coverage_status, votes smallint)
         WHERE p.season = ${SEASON} AND p.player_id = b."playerId"
      `;
    });
    console.warn(
      `[ISSUE-276] shared season ${SEASON} derived rows had moved from the setup capture and were restored from it:\n  `
      + differences.join('\n  '),
    );
  }
  const remaining = diffSharedState(sharedBaseline, await captureSharedState());
  if (remaining.length > 0) {
    throw new Error(
      `ISSUE-276 could not restore the shared season ${SEASON} derived rows to the captured baseline:\n  ${remaining.join('\n  ')}`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * Namespace inspection (read-only) and proven removal
 * ------------------------------------------------------------------ */

type SpineKey = { family: string; externalRecordId: string; versionSeq?: number };
type OwnedRows = {
  matchIds: number[];
  applicationIds: string[];
  candidateIds: string[];
  issueIds: string[];
  rejectionIds: string[];
  matchProjections: string[];
  playerProjections: string[];
  records: SpineKey[];
  versions: SpineKey[];
  payloads: PayloadKey[];
  batchIds: string[];
};
type NamespaceState = {
  owned: OwnedRows;
  /** Namespace rows whose ownership this run cannot prove. Never deleted; always reported. */
  unproven: string[];
  /** Owned payloads that a non-fixture version also cites: left in place, reported, not an error. */
  sharedPayloads: PayloadKey[];
};

function ownedCount(o: OwnedRows): number {
  return o.matchIds.length + o.applicationIds.length + o.candidateIds.length + o.issueIds.length
    + o.rejectionIds.length + o.matchProjections.length + o.playerProjections.length + o.records.length
    + o.versions.length + o.payloads.length + o.batchIds.length;
}

const payloadId = (key: PayloadKey): string => `${key.family}|${key.payloadHash}`;

/**
 * Read-only. Finds every row in the namespace (by id prefix, exact fixture key, marker batch or
 * exact stored-payload marker) and classifies it OWNED (provable from this run's ledger) or
 * UNPROVEN. With an empty ledger nothing can be owned, so the result IS the leftover listing.
 * Its one side effect is in memory: payload identities of versions proven owned are retained.
 */
async function inspectNamespace(includeKeepalive: boolean): Promise<NamespaceState> {
  const owned: OwnedRows = {
    matchIds: [], applicationIds: [], candidateIds: [], issueIds: [], rejectionIds: [],
    matchProjections: [], playerProjections: [], records: [], versions: [], payloads: [], batchIds: [],
  };
  const unproven: string[] = [];
  const sharedPayloads: PayloadKey[] = [];
  const caseKeys = caseMatchKeys();
  const allKeys = [...caseKeys, KEEPALIVE_MATCH_KEY];
  const adopted = (batchId: string | null): boolean => batchId !== null && ledger.batchIds.has(batchId);

  // matches ----------------------------------------------------------------------------------
  const matchRows = (await sql<{
    id: number; matchKey: string; sourceId: number | null; sourceRecordId: string | null;
    batchId: string | null; notes: string | null;
  }[]>`
    SELECT id, match_key AS "matchKey", source_id AS "sourceId", source_record_id AS "sourceRecordId",
           import_batch_id::text AS "batchId", notes
      FROM matches
     WHERE match_key = ANY(${allKeys}::text[])
        OR starts_with(match_key, ${NS})
        OR starts_with(coalesce(source_record_id, ''), ${NS})
     ORDER BY id
  `).filter((row) => includeKeepalive || row.id !== ledger.keepaliveMatchId);
  for (const row of matchRows) {
    const seeded = ledger.seededMatchIds.has(row.id) && (row.notes ?? '').includes(SEED_NOTE);
    const written = row.sourceId === aflApiSourceId && (row.sourceRecordId ?? '').startsWith(NS) && adopted(row.batchId);
    if (seeded || written) owned.matchIds.push(row.id);
    else {
      unproven.push(
        `matches.id=${row.id} key='${row.matchKey}' source_id=${row.sourceId} source_record_id='${row.sourceRecordId}' `
        + `import_batch_id=${row.batchId}: neither seeded by this run nor written by a batch this run ran`,
      );
    }
  }
  if (matchRows.length > 0) {
    const stats = await sql<{ matchId: number; n: number }[]>`
      SELECT match_id AS "matchId", count(*)::int AS n FROM player_match_stats
       WHERE match_id = ANY(${matchRows.map((r) => r.id)}::bigint[]) GROUP BY match_id
    `;
    for (const row of stats) {
      unproven.push(`matches.id=${row.matchId} owns ${row.n} player_match_stats row(s); these cases must write none`);
    }
  }

  // Rows in a source this file never writes to, keyed by a fixture match key ------------------
  const [foreign] = await sql<{ n: number }[]>`
    SELECT ((SELECT count(*) FROM staging.afltables_match
              WHERE source_id = ${afltablesSourceId} AND external_record_id = ANY(${allKeys}::text[]))
          + (SELECT count(*) FROM staging.source_records
              WHERE source_id = ${afltablesSourceId} AND external_record_id = ANY(${allKeys}::text[])))::int AS n
  `;
  if (foreign.n > 0) unproven.push(`${foreign.n} afltables staging row(s) are keyed by a fixture match key; this file stages none`);

  // ledger, candidates, rejections ------------------------------------------------------------
  for (const row of await sql<{ id: string; batchId: string | null; externalRecordId: string }[]>`
    SELECT id::text AS id, import_batch_id::text AS "batchId", external_record_id AS "externalRecordId"
      FROM canonical_applications
     WHERE starts_with(external_record_id, ${NS})
        OR (target_table = 'matches' AND target_key->>'match_key' = ANY(${allKeys}::text[]))
     ORDER BY id::bigint
  `) {
    if (adopted(row.batchId)) owned.applicationIds.push(row.id);
    else unproven.push(`canonical_applications.id=${row.id} external_record_id='${row.externalRecordId}' import_batch_id=${row.batchId}`);
  }
  for (const row of await sql<{ id: string; batchId: string | null; externalRecordId: string }[]>`
    SELECT id::text AS id, created_by_batch_id::text AS "batchId", external_record_id AS "externalRecordId"
      FROM promotion_candidates WHERE starts_with(external_record_id, ${NS}) ORDER BY id::bigint
  `) {
    if (adopted(row.batchId)) owned.candidateIds.push(row.id);
    else unproven.push(`promotion_candidates.id=${row.id} external_record_id='${row.externalRecordId}' created_by_batch_id=${row.batchId}`);
  }
  for (const row of await sql<{ id: string; batchId: string | null; sourceRecordId: string }[]>`
    SELECT id::text AS id, import_batch_id::text AS "batchId", source_record_id AS "sourceRecordId"
      FROM import_rejections WHERE starts_with(source_record_id, ${NS}) ORDER BY id::bigint
  `) {
    if (adopted(row.batchId)) owned.rejectionIds.push(row.id);
    else unproven.push(`import_rejections.id=${row.id} source_record_id='${row.sourceRecordId}' import_batch_id=${row.batchId}`);
  }

  // findings: no provenance column, so exact provider id in the key AND an adopted batch --------
  for (const row of await sql<{ id: string; issueKey: string }[]>`
    SELECT id::text AS id, issue_key AS "issueKey" FROM data_issues
     WHERE position(${NS}::text in coalesce(issue_key, '')) > 0 ORDER BY id::bigint
  `) {
    // Two key shapes carry the provider id: `afl_api|<family>|<id>|<table>` (settleIssueKey, id is the
    // third segment) and `afl_api|apply|<family>|<id>|<table>` (canonicalApplyIssueKey, the fourth).
    const segments = row.issueKey.split('|');
    const providerId = segments[1] === 'apply' ? segments[3] : segments[2];
    if (segments[0] === 'afl_api' && ALL_IDS.includes(providerId ?? '') && ledger.batchIds.size > 0) owned.issueIds.push(row.id);
    else unproven.push(`data_issues.id=${row.id} issue_key='${row.issueKey}': provider id not in an exact key segment, or no batch adopted yet`);
  }

  // typed projections --------------------------------------------------------------------------
  for (const row of await sql<{ externalRecordId: string; batchId: string | null }[]>`
    SELECT external_record_id AS "externalRecordId", projected_by_batch_id::text AS "batchId"
      FROM staging.afl_api_match
     WHERE source_id = ${aflApiSourceId} AND starts_with(external_record_id, ${NS}) ORDER BY external_record_id
  `) {
    if (adopted(row.batchId)) owned.matchProjections.push(row.externalRecordId);
    else unproven.push(`staging.afl_api_match '${row.externalRecordId}' projected_by_batch_id=${row.batchId}`);
  }
  for (const row of await sql<{ externalRecordId: string; batchId: string | null }[]>`
    SELECT external_record_id AS "externalRecordId", projected_by_batch_id::text AS "batchId"
      FROM staging.afl_api_player_match
     WHERE source_id = ${aflApiSourceId} AND starts_with(provider_match_id, ${NS}) ORDER BY external_record_id
  `) {
    if (adopted(row.batchId)) owned.playerProjections.push(row.externalRecordId);
    else unproven.push(`staging.afl_api_player_match '${row.externalRecordId}' projected_by_batch_id=${row.batchId}`);
  }

  // spine records and versions --------------------------------------------------------------------
  for (const row of await sql<{ family: string; externalRecordId: string; batchId: string | null }[]>`
    SELECT family, external_record_id AS "externalRecordId", last_batch_id::text AS "batchId"
      FROM staging.source_records
     WHERE source_id = ${aflApiSourceId} AND starts_with(external_record_id, ${NS}) ORDER BY family, external_record_id
  `) {
    if (adopted(row.batchId)) owned.records.push({ family: row.family, externalRecordId: row.externalRecordId });
    else unproven.push(`staging.source_records ${row.family}/'${row.externalRecordId}' last_batch_id=${row.batchId}`);
  }
  const retainedNow: PayloadKey[] = [];
  const ownedVersionCitations = new Map<string, number>();
  for (const row of await sql<{
    family: string; externalRecordId: string; versionSeq: number; payloadHash: string;
    opened: string | null; closed: string | null;
  }[]>`
    SELECT family, external_record_id AS "externalRecordId", version_seq AS "versionSeq",
           payload_hash::text AS "payloadHash", opened_by_batch_id::text AS opened, closed_by_batch_id::text AS closed
      FROM staging.source_record_versions
     WHERE source_id = ${aflApiSourceId} AND starts_with(external_record_id, ${NS})
     ORDER BY family, external_record_id, version_seq
  `) {
    if (adopted(row.opened) && (row.closed === null || adopted(row.closed))) {
      owned.versions.push({ family: row.family, externalRecordId: row.externalRecordId, versionSeq: row.versionSeq });
      const key = { family: row.family, payloadHash: row.payloadHash };
      retainedNow.push(key);
      ownedVersionCitations.set(payloadId(key), (ownedVersionCitations.get(payloadId(key)) ?? 0) + 1);
    } else {
      unproven.push(
        `staging.source_record_versions ${row.family}/'${row.externalRecordId}' v${row.versionSeq} `
        + `opened_by_batch_id=${row.opened} closed_by_batch_id=${row.closed}`,
      );
    }
  }
  for (const key of retainedNow) ledger.payloads.set(payloadId(key), key);

  // payloads: stored-content evidence, retained exact identity, citations ---------------------------
  const evidence = await sql<{ family: string; payloadHash: string }[]>`
    SELECT family, payload_hash::text AS "payloadHash"
      FROM (SELECT family, payload_hash, raw_payload::text AS body
              FROM staging.source_payloads
             WHERE source_id = ${aflApiSourceId} AND family = ANY(${[...PAYLOAD_FAMILIES]}::text[])) p
     WHERE EXISTS (SELECT 1 FROM unnest(${[...PAYLOAD_MARKERS]}::text[]) AS m(t) WHERE position(m.t in p.body) > 0)
     ORDER BY family, payload_hash
  `;
  const evidenced = new Set(evidence.map(payloadId));
  for (const key of evidence) {
    if (!ledger.payloads.has(payloadId(key))) {
      unproven.push(
        `staging.source_payloads ${key.family}/${key.payloadHash} carries a namespace marker but no version this run proved owned retained it`,
      );
    }
  }
  const retained = [...ledger.payloads.values()];
  if (retained.length > 0) {
    const present = await sql<{ family: string; payloadHash: string }[]>`
      SELECT p.family, p.payload_hash::text AS "payloadHash"
        FROM staging.source_payloads p
        JOIN unnest(${retained.map((k) => k.family)}::text[], ${retained.map((k) => k.payloadHash)}::text[]) AS k(family, hash)
          ON p.family = k.family AND p.payload_hash::text = k.hash
       WHERE p.source_id = ${aflApiSourceId}
    `;
    const citations = await sql<{ family: string; payloadHash: string; n: number }[]>`
      SELECT v.family, v.payload_hash::text AS "payloadHash", count(*)::int AS n
        FROM staging.source_record_versions v
        JOIN unnest(${retained.map((k) => k.family)}::text[], ${retained.map((k) => k.payloadHash)}::text[]) AS k(family, hash)
          ON v.family = k.family AND v.payload_hash::text = k.hash
       WHERE v.source_id = ${aflApiSourceId}
       GROUP BY v.family, v.payload_hash
    `;
    const cited = new Map(citations.map((c) => [payloadId(c), c.n]));
    for (const key of present) {
      if (!evidenced.has(payloadId(key))) {
        unproven.push(
          `staging.source_payloads ${key.family}/${key.payloadHash} was retained from an owned version but its stored content carries no namespace marker`,
        );
      } else if ((cited.get(payloadId(key)) ?? 0) > (ownedVersionCitations.get(payloadId(key)) ?? 0)) {
        sharedPayloads.push(key);
      } else {
        owned.payloads.push(key);
      }
    }
  }

  // batches carrying the marker ----------------------------------------------------------------------
  for (const row of await sql<{ id: string }[]>`
    SELECT id::text AS id FROM import_batches
     WHERE position(${SNAPSHOT_MARKER}::text in coalesce(notes, '')) > 0 ORDER BY id
  `) {
    if (ledger.batchIds.has(row.id)) owned.batchIds.push(row.id);
    else unproven.push(`import_batches.id=${row.id} carries the '${SNAPSHOT_MARKER}' marker but was not returned by a run of this file`);
  }

  return { owned, unproven, sharedPayloads };
}

function leftoverListing(lines: string[]): string {
  return lines.map((line) => `  - ${line}`).join('\n');
}

function expectRemoved(label: string, result: { count: number }, expected: number): void {
  if (result.count !== expected) {
    throw new Error(`ISSUE-276 teardown: ${label} removed ${result.count} row(s) where ownership proved exactly ${expected}; the whole removal was rolled back.`);
  }
}

/**
 * Removes exactly the rows this run provably owns, child to parent, in ONE transaction (any row-count
 * surprise rolls the lot back), then re-inspects and requires the namespace to be empty. Refuses,
 * deleting nothing, while any namespace row is unproven.
 */
async function removeOwnedFixtures(includeKeepalive: boolean): Promise<void> {
  const state = await inspectNamespace(includeKeepalive);
  if (state.unproven.length > 0) {
    throw new Error(
      'ISSUE-276 teardown refused: these namespace rows are not provably owned by this run, so NOTHING was deleted:\n'
      + leftoverListing(state.unproven),
    );
  }
  const o = state.owned;
  await sql.begin(async (tx) => {
    if (o.matchIds.length > 0) await tx`DELETE FROM match_period_scores WHERE match_id = ANY(${o.matchIds}::bigint[])`;
    if (o.applicationIds.length > 0) {
      expectRemoved('canonical_applications', await tx`DELETE FROM canonical_applications WHERE id = ANY(${o.applicationIds}::bigint[])`, o.applicationIds.length);
    }
    if (o.candidateIds.length > 0) {
      expectRemoved('promotion_candidates', await tx`DELETE FROM promotion_candidates WHERE id = ANY(${o.candidateIds}::bigint[])`, o.candidateIds.length);
    }
    if (o.issueIds.length > 0) {
      expectRemoved('data_issues', await tx`DELETE FROM data_issues WHERE id = ANY(${o.issueIds}::bigint[])`, o.issueIds.length);
    }
    if (o.rejectionIds.length > 0) {
      expectRemoved('import_rejections', await tx`DELETE FROM import_rejections WHERE id = ANY(${o.rejectionIds}::bigint[])`, o.rejectionIds.length);
    }
    if (o.matchIds.length > 0) {
      expectRemoved('matches', await tx`DELETE FROM matches WHERE id = ANY(${o.matchIds}::bigint[])`, o.matchIds.length);
    }
    if (o.playerProjections.length > 0) {
      expectRemoved('staging.afl_api_player_match', await tx`
        DELETE FROM staging.afl_api_player_match
         WHERE source_id = ${aflApiSourceId} AND external_record_id = ANY(${o.playerProjections}::text[])
      `, o.playerProjections.length);
    }
    if (o.matchProjections.length > 0) {
      expectRemoved('staging.afl_api_match', await tx`
        DELETE FROM staging.afl_api_match
         WHERE source_id = ${aflApiSourceId} AND external_record_id = ANY(${o.matchProjections}::text[])
      `, o.matchProjections.length);
    }
    if (o.records.length > 0) {
      expectRemoved('staging.source_records', await tx`
        DELETE FROM staging.source_records r
          USING unnest(${o.records.map((k) => k.family)}::text[], ${o.records.map((k) => k.externalRecordId)}::text[]) AS k(family, id)
         WHERE r.source_id = ${aflApiSourceId} AND r.family = k.family AND r.external_record_id = k.id
      `, o.records.length);
    }
    if (o.versions.length > 0) {
      expectRemoved('staging.source_record_versions', await tx`
        DELETE FROM staging.source_record_versions v
          USING unnest(${o.versions.map((k) => k.family)}::text[], ${o.versions.map((k) => k.externalRecordId)}::text[],
                       ${o.versions.map((k) => k.versionSeq as number)}::int[]) AS k(family, id, seq)
         WHERE v.source_id = ${aflApiSourceId} AND v.family = k.family AND v.external_record_id = k.id AND v.version_seq = k.seq
      `, o.versions.length);
    }
    if (o.payloads.length > 0) {
      // Exact retained identity + stored marker evidence + no surviving citation, all three, per row.
      expectRemoved('staging.source_payloads', await tx`
        DELETE FROM staging.source_payloads p
          USING unnest(${o.payloads.map((k) => k.family)}::text[], ${o.payloads.map((k) => k.payloadHash)}::text[]) AS k(family, hash)
         WHERE p.source_id = ${aflApiSourceId} AND p.family = k.family AND p.payload_hash::text = k.hash
           AND EXISTS (SELECT 1 FROM unnest(${[...PAYLOAD_MARKERS]}::text[]) AS m(t) WHERE position(m.t in p.raw_payload::text) > 0)
           AND NOT EXISTS (
             SELECT 1 FROM staging.source_record_versions v
              WHERE v.source_id = p.source_id AND v.family = p.family AND v.payload_hash = p.payload_hash)
      `, o.payloads.length);
    }
    if (o.batchIds.length > 0) {
      expectRemoved('import_batches', await tx`DELETE FROM import_batches WHERE id = ANY(${o.batchIds}::bigint[])`, o.batchIds.length);
    }
  });

  const after = await inspectNamespace(includeKeepalive);
  if (ownedCount(after.owned) > 0 || after.unproven.length > 0) {
    throw new Error(
      'ISSUE-276 teardown left rows behind after removal:\n'
      + leftoverListing([
        ...after.unproven,
        ...(ownedCount(after.owned) > 0 ? [`still present and owned: ${JSON.stringify(after.owned)}`] : []),
      ]),
    );
  }
  if (after.sharedPayloads.length > 0) {
    console.warn(
      `[ISSUE-276] ${after.sharedPayloads.length} fixture payload(s) are also cited by a non-fixture version and were left in place: `
      + after.sharedPayloads.map(payloadId).join(', '),
    );
  }
  if (includeKeepalive) {
    ledger.keepaliveMatchId = null;
    ledger.seededMatchIds.clear();
  }
}

/** Seeds the keep-alive only when the writer's own recompute would otherwise have nothing to rank. */
async function seedKeepaliveIfNeeded(): Promise<void> {
  const [{ n }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM matches WHERE season = ${SEASON} AND NOT is_final
  `;
  if (n > 0) return;
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO matches (
      match_key, season, round_code, round_type, round_number, is_final, match_date,
      venue_raw, home_club_id, away_club_id, home_score, away_score, result,
      winner_club_id, margin, attendance_status, notes
    ) VALUES (
      ${KEEPALIVE_MATCH_KEY}, ${SEASON}::smallint, '9276', 'home_and_away', 9276, false,
      ${`${SEASON}-01-02`}::date, 'ISSUE-276 test fixture', ${homeClubId}, ${awayClubId}, 100, 80,
      'home_win', ${homeClubId}, 20, 'not_collected', ${SEED_NOTE}
    ) RETURNING id
  `;
  ledger.keepaliveMatchId = row.id;
  ledger.seededMatchIds.add(row.id);
}

/**
 * Fail closed, never delete: a canonical row that is not ours and differs from a case's identity
 * in at most one of round/date would make the planner refuse the INSERT as `possible_existing_match`
 * (the same predicate, via the planner's own function). Called before any fixture write, and again
 * before each case once the previous case's own rows are gone.
 */
async function assertNoForeignFixtureConflicts(): Promise<void> {
  const conflicts: string[] = [];
  for (const id of ALL_IDS) {
    const rows = await findPlausibleCanonicalFixtures(sql, {
      season: SEASON, matchKey: matchKeyFor(id), roundCode: 'PF', matchDate: matchDateFor(id),
      homeClubId, awayClubId,
    });
    conflicts.push(...rows.map((row) => `${row.matchKey} (matches.id ${row.id})`));
  }
  if (conflicts.length > 0) {
    throw new Error(
      'ISSUE-276 cases cannot run: these existing canonical rows are not ISSUE-276 fixtures and would make '
      + `the settle refuse possible_existing_match. They were NOT touched: ${[...new Set(conflicts)].join('; ')}`,
    );
  }
}

/** Records a batch the writer returned, after re-checking that it really carries this file's marker. */
async function adoptBatch(batchId: string): Promise<void> {
  const [batch] = await sql<{ notes: string | null }[]>`SELECT notes FROM import_batches WHERE id = ${batchId}::bigint`;
  if (!batch || !(batch.notes ?? '').includes(SNAPSHOT_MARKER)) {
    throw new Error(`import_batches.id=${batchId} was returned by the writer but does not carry '${SNAPSHOT_MARKER}'; refusing to adopt it.`);
  }
  ledger.batchIds.add(batchId);
}

beforeAll(async () => {
  await assertTestDatabase();
  registry = parseSourceFamilyRegistry(
    JSON.parse(readFileSync(join(PROJECT_ROOT, 'data', 'reference', 'source-families.json'), 'utf8')),
  );
  identities = parseAflApiIdentities(
    JSON.parse(readFileSync(join(PROJECT_ROOT, 'data', 'reference', 'afl-api-identities.json'), 'utf8')),
  );
  getSourceFamily(registry, 'afl_api', 'match'); // fails loudly if the registry is somehow not this repo's

  const [afl] = await sql<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afl_api'`;
  const [aft] = await sql<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afltables'`;
  if (!afl || !aft) throw new Error("sources 'afl_api' and 'afltables' must both exist on afldb_test.");
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
  homeClubName = home.name;
  awayClubName = away.name;
  venueId = venue.id;

  // Everything above and below, up to `writesAllowed`, is read-only.
  await acquireRunLock();
  await assertRestorationSchemaKnown();

  const leftovers = await inspectNamespace(true); // empty ledger: nothing can be owned yet
  if (leftovers.unproven.length > 0) {
    throw new Error(
      'ISSUE-276 cases cannot run: the namespace already holds rows (an interrupted earlier run, or rows whose ownership cannot be '
      + 'proven). NOTHING was deleted or written. Classify them with issues/open/AFLDB-ISSUE-276-RESIDUE.sql and clear them '
      + `deliberately:\n${leftoverListing(leftovers.unproven)}`,
    );
  }
  await assertNoForeignFixtureConflicts();
  sharedBaseline = await captureSharedState();

  ledger.writesAllowed = true; // from here on teardown may remove and restore what this run creates
  await seedKeepaliveIfNeeded();
}, 120_000);

beforeEach(async () => {
  if (!ledger.writesAllowed) throw new Error('ISSUE-276 startup did not complete; no case may run.');
  await removeOwnedFixtures(false); // only what the previous case of THIS run created
  await assertNoForeignFixtureConflicts();
}, 120_000);

afterAll(async () => {
  const problems: string[] = [];
  const attempt = async (label: string, step: () => Promise<void>): Promise<void> => {
    try {
      await step();
    } catch (error) {
      problems.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  try {
    if (ledger.writesAllowed) {
      // Independent steps: each runs even if an earlier one failed, so one failure cannot hide another.
      await attempt('removing this run\'s fixtures and keep-alive', () => removeOwnedFixtures(true));
      await attempt('restoring the shared season-2026 derived rows', restoreSharedBaseline);
    }
  } finally {
    await attempt('closing the connection (releases the run lock)', () => sql.end({ timeout: 5 }));
  }
  if (problems.length > 0) {
    throw new Error(
      `ISSUE-276 teardown FAILED; state may be left behind on afldb_test. Classify it with issues/open/AFLDB-ISSUE-276-RESIDUE.sql.\n${leftoverListing(problems)}`,
    );
  }
}, 120_000);

/* ------------------------------------------------------------------ *
 * Evidence readers (every one scoped to a fixture provider id / match key)
 * ------------------------------------------------------------------ */

type FindingRow = {
  id: string; entityId: string | null; severity: string; resolved: boolean;
  resolution: string | null; details: Record<string, unknown>;
};

/** EVERY finding (open or resolved) ever written for one provider match's period-score key. */
async function findingsFor(providerId: string): Promise<FindingRow[]> {
  return sql<FindingRow[]>`
    SELECT id::text AS id, entity_id::text AS "entityId", severity::text AS severity,
           (resolved_at IS NOT NULL) AS resolved, resolution::text AS resolution, details
      FROM data_issues
     WHERE issue_type = ${PERIOD_TYPE}
       AND issue_key = ${`afl_api|match_roster|${providerId}|match_period_scores`}
     ORDER BY id
  `;
}

/** Every data_issues row naming the provider match that is closed, as `issue_type:resolution`, sorted. */
async function closedFindingsOf(providerId: string): Promise<string[]> {
  const rows = await sql<{ issueType: string; resolution: string | null }[]>`
    SELECT issue_type AS "issueType", resolution::text AS resolution
      FROM data_issues
     WHERE issue_key LIKE ${`%|${providerId}|%`} AND resolved_at IS NOT NULL
  `;
  return rows.map((row) => `${row.issueType}:${row.resolution}`).sort();
}

async function onlyFinding(providerId: string): Promise<FindingRow> {
  const rows = await findingsFor(providerId);
  expect(rows).toHaveLength(1);
  return rows[0];
}

async function periodRowsOf(matchKey: string): Promise<{ clubId: number; period: number; points: number }[]> {
  return sql<{ clubId: number; period: number; points: number }[]>`
    SELECT p.club_id AS "clubId", p.period::int AS period, p.points::int AS points
      FROM match_period_scores p JOIN matches m ON m.id = p.match_id
     WHERE m.match_key = ${matchKey}
     ORDER BY p.club_id, p.period
  `;
}

/** Ledger and review-queue rows that target `match_period_scores` for one provider match. */
async function periodTargetTraceFor(providerId: string): Promise<{ applications: number; candidates: number }> {
  const [applications] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM canonical_applications
     WHERE starts_with(external_record_id, ${providerId}) AND target_table = 'match_period_scores'
  `;
  const [candidates] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM promotion_candidates
     WHERE starts_with(external_record_id, ${providerId}) AND target_table = 'match_period_scores'
  `;
  return { applications: applications.n, candidates: candidates.n };
}

/** Everything canonical one match owns, captured whole (`to_jsonb`, so every column is compared). */
async function canonicalSnapshot(matchKey: string, providerId: string) {
  const [match] = await sql<{ row: Record<string, unknown> }[]>`
    SELECT to_jsonb(m) AS row FROM matches m WHERE m.match_key = ${matchKey}
  `;
  const periods = await sql<{ row: Record<string, unknown> }[]>`
    SELECT to_jsonb(p) AS row FROM match_period_scores p JOIN matches m ON m.id = p.match_id
     WHERE m.match_key = ${matchKey} ORDER BY p.club_id, p.period
  `;
  const [applications] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM canonical_applications WHERE starts_with(external_record_id, ${providerId})
  `;
  const [candidates] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM promotion_candidates WHERE starts_with(external_record_id, ${providerId})
  `;
  return {
    match: match?.row ?? null, periods: periods.map((r) => r.row),
    applications: applications.n, candidates: candidates.n,
  };
}

/** Runs one settle and adopts the batch id it RETURNS: the only way a batch (and so its rows) becomes owned. */
async function settleCase(providerId: string, mutate?: (raw: RawUnit) => void, autoApply = true) {
  const result = await runSettleAflApi(sql, {
    bundle: buildBundle([unitSourceFor(providerId, mutate)]),
    registry, apply: true, autoApply, inProgressSeasons: [SEASON],
  });
  if (result.batchId !== null) await adoptBatch(result.batchId);
  return result;
}

/* ------------------------------------------------------------------ *
 * The cases
 * ------------------------------------------------------------------ */

describe('AFLDB-ISSUE-276 — a roster whose period scores contradict the final score is refused, made durable and self-healing', () => {
  it('a contradictory roster for a FRESH match writes the match but no period rows, and opens one finding; a repeat refreshes it in place; a corrected roster resolves it and writes the periods', async () => {
    const providerId = CASE_IDS.fresh;
    const matchKey = matchKeyFor(providerId);

    const first = await settleCase(providerId, threePeriodsOnly(providerId));
    expect(first.halt).toBeNull();
    expect(first.applied).toBe(true);
    expect(first.counters.canonicalApplyFailures).toBe(0);
    expect(first.counters.manualAuthorityRefusals).toBe(0);
    // Only the roster family is refused: the match family still inserts the fixture.
    expect(first.counters.canonicalRowsInserted).toBeGreaterThan(0);

    const [match] = await sql<{ id: number; sourceId: number; homeScore: number; awayScore: number }[]>`
      SELECT id, source_id AS "sourceId", home_score AS "homeScore", away_score AS "awayScore"
        FROM matches WHERE match_key = ${matchKey}
    `;
    expect(match).toBeDefined();
    expect(match.sourceId).toBe(aflApiSourceId);
    expect([match.homeScore, match.awayScore]).toEqual([122, 131]);

    // No canonical period row, no ledger row and no review candidate targets match_period_scores.
    expect(await periodRowsOf(matchKey)).toEqual([]);
    expect(await periodTargetTraceFor(providerId)).toEqual({ applications: 0, candidates: 0 });

    const opened = await onlyFinding(providerId);
    expect(opened).toMatchObject({ severity: 'error', resolved: false, resolution: null });
    expect(opened.entityId).toBeNull(); // new_target: the match row did not exist when the plan ran
    expect(opened.details).toMatchObject({
      owner: SETTLE_ISSUE_OWNER,
      source_key: 'afl_api',
      family: 'match_roster',
      external_record_id: providerId,
      target_table: 'match_period_scores',
      reason: PERIOD_REASON,
      fixture_home_score: 122,
      fixture_away_score: 131,
      issue: 'AFLDB-ISSUE-276',
    });
    expect(String(opened.details.detail)).toContain('roster period scores end 77-95 (3/3 periods)');

    // Repeating the contradiction refreshes the one open row; nothing else changes.
    const snapshotBefore = await canonicalSnapshot(matchKey, providerId);
    const second = await settleCase(providerId, threePeriodsOnly(providerId));
    expect(second.halt).toBeNull();
    expect(second.counters.canonicalApplyFailures).toBe(0);
    expect(second.counters.canonicalRowsInserted).toBe(0);
    expect(second.counters.canonicalRowsUpdated).toBe(0);
    expect(second.counters.dataIssuesRefreshed).toBeGreaterThan(0);

    const refreshed = await onlyFinding(providerId);
    expect(refreshed.id).toBe(opened.id);
    expect(refreshed).toMatchObject({ resolved: false, resolution: null });
    expect(refreshed.entityId).toBe(String(match.id)); // refreshed now the match row exists
    expect(await canonicalSnapshot(matchKey, providerId)).toEqual(snapshotBefore);
    expect(await periodRowsOf(matchKey)).toEqual([]);

    // The corrected roster resolves the finding and writes the expected periods.
    const third = await settleCase(providerId);
    expect(third.halt).toBeNull();
    expect(third.counters.canonicalApplyFailures).toBe(0);
    expect(third.counters.manualAuthorityRefusals).toBe(0);

    const resolved = await onlyFinding(providerId);
    expect(resolved).toMatchObject({ id: opened.id, resolved: true, resolution: 'source_agreement_restored' });
    // AFLDB-ISSUE-293: the closed finding is counted (the call's result was discarded).
    expect(third.counters.dataIssuesResolved).toBe(1);

    const periods = await periodRowsOf(matchKey);
    expect(periods).toHaveLength(8);
    expect(periods.filter((p) => p.clubId === homeClubId).map((p) => p.points)).toEqual([31, 67, 77, 122]);
    const away = periods.filter((p) => p.clubId === awayClubId);
    expect(away.map((p) => p.period)).toEqual([1, 2, 3, 4]);
    expect(away[3].points).toBe(131);

    // A further identical valid run is a no-op: no new finding, no canonical change.
    const settled = await canonicalSnapshot(matchKey, providerId);
    const fourth = await settleCase(providerId);
    expect(fourth.counters.canonicalRowsInserted).toBe(0);
    expect(fourth.counters.canonicalRowsUpdated).toBe(0);
    expect(await findingsFor(providerId)).toHaveLength(1);
    expect(await canonicalSnapshot(matchKey, providerId)).toEqual(settled);
  }, 120_000);

  it('a contradictory roster leaves EXISTING canonical period rows byte-identical: nothing is rewritten, deleted or ledgered', async () => {
    const providerId = CASE_IDS.existing;
    const matchKey = matchKeyFor(providerId);

    const first = await settleCase(providerId);
    expect(first.counters.canonicalApplyFailures).toBe(0);
    expect(first.counters.canonicalRowsInserted).toBeGreaterThan(0);
    const before = await canonicalSnapshot(matchKey, providerId);
    const traceBefore = await periodTargetTraceFor(providerId);
    expect(before.periods).toHaveLength(8);
    expect(await findingsFor(providerId)).toEqual([]);

    // Were it written, this stale fourth period would rewrite period 4 of both sides (to 83 and 101).
    const second = await settleCase(providerId, staleFourthPeriod(providerId));
    expect(second.halt).toBeNull();
    expect(second.counters.canonicalApplyFailures).toBe(0);
    expect(second.counters.canonicalRowsInserted).toBe(0);
    expect(second.counters.canonicalRowsUpdated).toBe(0);
    expect(second.counters.canonicalApplicationsLogged).toBe(0);

    // Every column of every period row (and the match row, and the ledger and candidate counts)
    // is identical to what the valid run left.
    expect(await canonicalSnapshot(matchKey, providerId)).toEqual(before);

    const finding = await onlyFinding(providerId);
    expect(finding).toMatchObject({ resolved: false, severity: 'error' });
    expect(finding.entityId).not.toBeNull(); // update_owned: the existing match row
    expect(finding.details).toMatchObject({ reason: PERIOD_REASON });
    expect(String(finding.details.detail)).toContain('roster period scores end 83-101 (4/4 periods)');
    // No new ledger row or review candidate for the period set.
    expect(await periodTargetTraceFor(providerId)).toEqual(traceBefore);
    expect(traceBefore.candidates).toBe(0);
  }, 120_000);

  it('an open finding is resolved only by positive evidence: missing score evidence, a deferred roster and a blocked match each leave it open', async () => {
    const providerId = CASE_IDS.lifecycle;
    const matchKey = matchKeyFor(providerId);

    // 1. The contradiction opens the finding.
    const contradicted = await settleCase(providerId, threePeriodsOnly(providerId));
    expect(contradicted.counters.canonicalApplyFailures).toBe(0);
    const opened = await onlyFinding(providerId);
    expect(opened.resolved).toBe(false);

    // 2. No own-match score entry at all (periodScoresReproduceFinalScore === null): the roster
    //    is skipped, not corrected, so the finding stays open and nothing is written.
    const noEvidence = await settleCase(providerId, withoutOwnScoreEntry(providerId));
    expect(noEvidence.halt).toBeNull();
    expect(noEvidence.counters.canonicalApplyFailures).toBe(0);
    expect(await onlyFinding(providerId)).toMatchObject({ id: opened.id, resolved: false, resolution: null });
    expect(await periodRowsOf(matchKey)).toEqual([]);

    // 3. A deferred roster (not yet concluded), even carrying VALID period scores: processing
    //    was skipped, so there is nothing to call corrected.
    const deferred = await settleCase(providerId, liveRoster);
    expect(deferred.halt).toBeNull();
    expect(deferred.counters.canonicalApplyFailures).toBe(0);
    expect(Object.keys(deferred.counters.recordsDeferred)).toContain('roster_not_concluded');
    expect(await onlyFinding(providerId)).toMatchObject({ id: opened.id, resolved: false, resolution: null });
    expect(await periodRowsOf(matchKey)).toEqual([]);

    // 4. A blocked match (the local match date is unproved, so the match family is refused):
    //    the roster family is blocked, and the finding must not be touched.
    const blocked = await settleCase(providerId, withoutVenueTimezone);
    expect(blocked.halt).toBeNull();
    expect(blocked.counters.unresolvedIdentityMatch).toBeGreaterThan(0);
    expect(await onlyFinding(providerId)).toMatchObject({ id: opened.id, resolved: false, resolution: null });
    expect(await periodRowsOf(matchKey)).toEqual([]);

    // 5. Only a roster that reproduces the final score resolves it, and then writes the periods.
    const healed = await settleCase(providerId);
    expect(healed.halt).toBeNull();
    expect(healed.counters.canonicalApplyFailures).toBe(0);
    expect(await onlyFinding(providerId)).toMatchObject({ id: opened.id, resolved: true, resolution: 'source_agreement_restored' });
    // Two findings close in this run and both are counted (AFLDB-ISSUE-293): the match-identity
    // refusal the blocked run opened (healed on the way in) and the period-scores contradiction
    // this roster now disproves (which used to be closed without being counted).
    expect(await closedFindingsOf(providerId)).toEqual([
      'afl_api_match_identity_refusal:match_identity_resolved',
      'afl_api_period_scores_contradiction:source_agreement_restored',
    ]);
    expect(healed.counters.dataIssuesResolved).toBe(2);
    const periods = await periodRowsOf(matchKey);
    expect(periods).toHaveLength(8);
    expect(periods.filter((p) => p.clubId === homeClubId).map((p) => p.points)).toEqual([31, 67, 77, 122]);
  }, 150_000);

  /**
   * The corroborated-match path. `matches.source_id` is never changed on an UPDATE
   * (canonical-apply.ts §19.1(e)), so an afl_api-owned row cannot become foreign-owned through the
   * writer. What IS reachable: a finding opened while the match did not exist yet (a review-first
   * run proposes the INSERT for a human; the match is not written), after which another source
   * creates the row. The next afl_api run then resolves it as `corroborated`, a branch that never
   * writes period scores.
   */
  it('a finding opened before another source created the match is closed on the corroborated path by positive roster evidence, and only by it', async () => {
    const providerId = CASE_IDS.corroborated;
    const matchKey = matchKeyFor(providerId);

    // 1. Review-first, contradictory roster: the finding opens, the match is NOT written.
    const reviewFirst = await settleCase(providerId, threePeriodsOnly(providerId), false);
    expect(reviewFirst.halt).toBeNull();
    expect(reviewFirst.counters.canonicalRowsInserted).toBe(0);
    const [{ n: matchRows }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM matches WHERE match_key = ${matchKey}`;
    expect(matchRows).toBe(0);
    const opened = await onlyFinding(providerId);
    expect(opened).toMatchObject({ severity: 'error', resolved: false, resolution: null });
    expect(opened.entityId).toBeNull();

    // 2. Another source (afltables) creates the same fixture, agreeing on the score.
    // Tracked by the id this INSERT returns and by the run-unique `notes` marker; the match key alone
    // would never authorise its removal. (`notes` is not read by the writer's corroborated path.)
    const [owned] = await sql<{ id: number }[]>`
      INSERT INTO matches (
        match_key, season, round_code, round_number, round_type, is_final,
        match_date, venue_id, venue_raw, home_club_id, away_club_id,
        home_goals, home_behinds, home_score, away_goals, away_behinds, away_score,
        result, winner_club_id, margin,
        attendance, attendance_status, attendance_source_id,
        source_id, source_record_id, notes
      ) VALUES (
        ${matchKey}, ${SEASON}, 'PF', ${null}, 'preliminary_final', true,
        ${matchDateFor(providerId)}, ${venueId}, 'MCG', ${homeClubId}, ${awayClubId},
        19, 8, 122, 20, 11, 131,
        'away_win', ${awayClubId}, 9,
        NULL, 'not_collected', NULL,
        ${afltablesSourceId}, ${matchKey}, ${SEED_NOTE}
      ) RETURNING id
    `;
    ledger.seededMatchIds.add(owned.id);
    const ownedBefore = (await canonicalSnapshot(matchKey, providerId)).match;

    // 3. From here the match is corroborated. Anything short of positive evidence leaves the finding
    //    exactly as it was (not refreshed, not resolved, no second finding).
    const contradicting = await settleCase(providerId, threePeriodsOnly(providerId));
    expect(contradicting.halt).toBeNull();
    expect(contradicting.counters.corroboratedForeignOwned).toBe(1);
    expect(await findingsFor(providerId)).toEqual([opened]);

    const noEvidence = await settleCase(providerId, withoutOwnScoreEntry(providerId));
    expect(noEvidence.counters.corroboratedForeignOwned).toBe(1);
    expect(await findingsFor(providerId)).toEqual([opened]);

    const deferred = await settleCase(providerId, liveRoster);
    expect(deferred.counters.corroboratedForeignOwned).toBe(1);
    expect(Object.keys(deferred.counters.recordsDeferred)).toContain('roster_not_concluded');
    expect(await findingsFor(providerId)).toEqual([opened]);

    // 4. Positive evidence closes it, and afl_api still writes nothing to the foreign-owned match.
    const restored = await settleCase(providerId);
    expect(restored.halt).toBeNull();
    expect(restored.counters.corroboratedForeignOwned).toBe(1);
    expect(restored.counters.canonicalRowsInserted).toBe(0);
    expect(restored.counters.canonicalRowsUpdated).toBe(0);
    expect(restored.counters.dataIssuesResolved).toBe(1);
    expect(await onlyFinding(providerId)).toMatchObject({
      id: opened.id, resolved: true, resolution: 'source_agreement_restored',
    });
    expect(await periodRowsOf(matchKey)).toEqual([]);
    expect(await periodTargetTraceFor(providerId)).toEqual({ applications: 0, candidates: 0 });

    const [after] = await sql<{ id: number; sourceId: number }[]>`
      SELECT id, source_id AS "sourceId" FROM matches WHERE match_key = ${matchKey}
    `;
    expect(after).toEqual({ id: owned.id, sourceId: afltablesSourceId }); // never re-owned
    expect((await canonicalSnapshot(matchKey, providerId)).match).toEqual(ownedBefore);
  }, 150_000);
});
