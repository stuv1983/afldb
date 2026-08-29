/**
 * AFLDB-ISSUE-099 T6b slice 3 — the settle transaction against real PostgreSQL.
 *
 * The §26 T6 behavioural gate. `tests/current-season-import.test.ts` proves the
 * pure contract and `tests/integration/observation-spine.test.ts` proves
 * migration 074's schema; neither one executes `runSettleAfltables()`, so
 * neither can regress from T6. This file drives the real driver — the real
 * `sql.begin`, the real upserts, the real constraints, the real unique indexes
 * — over `afldb_test`.
 *
 * ISOLATION MODEL — COMMITTED FIXTURES (runbook option A, user-approved).
 * `runSettleAfltables()` opens its OWN transaction (§21 S-D), and postgres.js
 * gives a `TransactionSql` only `savepoint` and `prepare`, never `begin`. The
 * spine suite's outer-transaction-that-always-rolls-back pattern therefore
 * cannot wrap this driver, and its fixtures must be committed so they exist
 * before the driver opens its transaction. A test-only savepoint seam inside
 * the production boundary was rejected: §22 requires dry-run and apply to be
 * the same path, and that is precisely the thing under test.
 *
 * SO: THIS SUITE DOES TEMPORARILY MUTATE `afldb_test`. It commits fixtures, it
 * commits the ISSUE-099-owned output of its apply runs, and it removes both
 * afterwards. The invariant it proves is NOT "no database change" — it is that
 * **no canonical FACT row is written by the settle pass**:
 *
 *   fixtures COMMITTED here      seasons(2094), one players row, one
 *                                external_identities row, and an `afltables`
 *                                sources row ONLY if none already exists
 *   settle OUTPUT committed here import_batches, the migration-074 spine, the
 *                                two migration-076 projections,
 *                                promotion_candidates, import_rejections
 *   NEVER written by the pass    matches, match_period_scores,
 *                                player_match_stats, brownlow_round_votes
 *
 * `clubs` and `venues` are read, never written: the fixture reads two existing
 * historical club identities rather than inventing any, and no venue is mapped
 * at all, so `venue_id` stays NULL and the `venueUnmapped` path is exercised.
 * `issue099-match-key-a` is deliberately left with NO canonical match, so the
 * `matches` target is `new_target` and its dependants are `unresolved` — the
 * normal in-season state on a rebuilt database.
 *
 * ONE CANONICAL FACT ROW *IS* SEEDED BY THIS HARNESS (T7 / A17). §13's
 * disagreement lifecycle is only reachable when a canonical match exists —
 * `corroborationClaims()` returns nothing otherwise — and is owned by
 * `afltables`, because `foreign_owned_collision` outranks `source_disagreement`
 * in `VERB_PRECEDENCE`. So `beforeAll` inserts exactly one `matches` row on the
 * dedicated key `issue099-match-key-disagree`, plus one
 * `staging.external_current_matches` claim from an independent provider.
 *
 * That row is FIXTURE DATA, not settle output. It is created before
 * `canonicalBaseline` is captured, it refuses to run at all if something is
 * already sitting on its dedicated key, and it is removed by key in cleanup.
 * **The invariant this suite proves is that SETTLE performs zero canonical fact
 * mutation — not that the harness never inserts a fixture.** Both proofs still
 * hold over it: the bracketed row counts include it from the baseline onward,
 * and the per-transaction xid scan asks whether any surviving canonical tuple
 * was written by a settle transaction, which a harness INSERT never is.
 *
 * Everything this suite owns is namespaced: season **2094** and the
 * `issue099-` external-record-id prefix. 2094 is deliberately NOT 2099:
 * `observation-spine.test.ts` seeds `seasons(2099)` inside a transaction that
 * always rolls back, and this suite COMMITS its fixture season, so sharing the
 * key would make a parallel full-suite run collide on the seasons primary key.
 * 2094 appears in no other test and nowhere else in the repository.
 *
 * Cleanup runs BEFORE setup as well as in `afterAll`, because an interrupted
 * earlier run can have left committed rows behind. That cleanup deletes THIS
 * SUITE'S OWN FIXTURES; it is teardown, and it is not part of the settle path
 * obligation O1 constrains.
 *
 * @see issues/closed/AFLDB-ISSUE-099.md §21, §22, §24, §26
 * @see src/lib/acquisition/settle-afltables.ts
 */
import './guard';

import { readFileSync } from 'node:fs';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { persistSourceObservation } from '@/lib/acquisition/observation-store';
import {
  UNAVAILABLE_MANUAL_AUTHORITY,
  type JsonValue,
} from '@/lib/acquisition/observations';
import {
  runSettleAfltables,
  validateSettleBundle,
  type SettleBundle,
  type SettleRunResult,
} from '@/lib/acquisition/settle-afltables';
import {
  getSourceFamily,
  parseSourceFamilyRegistry,
} from '@/lib/acquisition/source-families';
import { asImportBatchId, type ImportBatchId } from '@/lib/import-batch-id';

import { createImportRoleParityHarness } from './import-role-parity';

/* ------------------------------------------------------------------ *
 * Namespace
 * ------------------------------------------------------------------ */

/** Unused by every other suite, and inside seasons_year_ck (1897-2100). */
const SEASON = 2094;
const LABEL = 'issue099-settle-test';
const PREFIX = 'issue099-';
const SCOPE = `season=${SEASON}`;
/** A scope this suite never enumerates, so no sweep may ever reach it. */
const SENTINEL_SCOPE = 'issue099-sentinel-scope';

const MATCH_RECORD = 'issue099-match-a';
const REJECTED_RECORD = 'issue099-match-rejected';
const OMITTED_RECORD = 'issue099-match-omitted';
const PLAYER_RECORD = 'issue099-player-a';
const SENTINEL_MATCH = 'issue099-sentinel-match';
const SENTINEL_PLAYER = 'issue099-sentinel-player';
/** T7 only. Opt-in, so T6's deliberately unresolved MATCH_KEY is untouched. */
const DISAGREE_RECORD = 'issue099-match-disagree';
/** T8 defect D2 only. Its own record, URL and scope — see `unlinkedPlayerBundle()`. */
const UNLINKED_PLAYER_RECORD = 'issue099-player-unlinked';
const UNLINKED_PLAYER_URL = 'issue099-players/U/Issue099_Unlinked.html';
const UNLINKED_SCOPE = `season=${SEASON}|d2-unlinked`;

const PLAYER_URL = 'issue099-players/I/Issue099_Fixture.html';
const MATCH_KEY = 'issue099-match-key-a';
const OMITTED_MATCH_KEY = 'issue099-match-key-omitted';
const DISAGREE_MATCH_KEY = 'issue099-match-key-disagree';
const VENUE_RAW = 'ISSUE-099 Unmapped Ground';
const FIXTURE_TOOL = 'issue099-settle-fixture';
const PLAYER_SLUG = 'issue099-fixture-player';
const MANIFEST_SHA = 'a'.repeat(64);

/** The independent provider whose claim raises, then clears, the disagreement. */
const PROVIDER_SOURCE_KEY = 'squiggle_api';
const PROVIDER_GAME_ID = 'issue099-squiggle-disagree';
/** The exact key §13.1 derives for the disagreement's `matches` target. */
const DISAGREE_ISSUE_KEY = `afltables|match|${DISAGREE_RECORD}|matches`;
/** Every data_issues row this suite can create, for the pre-clean and snapshot. */
const ISSUE_KEY_PATTERN = 'afltables|match|issue099-%';
/** A stand-in for some other writer's finding, which this pass may never close. */
const FOREIGN_ISSUE_OWNER = 'AFLDB-ISSUE-098';

/** Ordered observation times. Increasing, so every interval check holds. */
const T = {
  seed: '2094-03-01T00:00:00Z',
  dryRunFirst: '2094-03-02T00:00:00Z',
  applyFirst: '2094-03-03T00:00:00Z',
  rerun: '2094-03-04T00:00:00Z',
  sweep: '2094-03-05T00:00:00Z',
  reappear: '2094-03-06T00:00:00Z',
  corrected: '2094-03-07T00:00:00Z',
  restored: '2094-03-08T00:00:00Z',
  // The T7 data_issues lifecycle, ordered inside the 03-08 day so it stays
  // between the A -> B -> A restoration and the closing dry-run.
  issueOpen: '2094-03-08T06:00:00Z',
  issueRefresh: '2094-03-08T12:00:00Z',
  issueResolve: '2094-03-08T18:00:00Z',
  issueRerun: '2094-03-08T20:00:00Z',
  issueForeign: '2094-03-08T22:00:00Z',
  dryRunLast: '2094-03-09T00:00:00Z',
  /** T8 D2, after the closing dry-run and before the role-parity run. */
  unlinked: '2094-03-09T12:00:00Z',
  unlinkedZero: '2094-03-09T18:00:00Z',
  parity: '2094-03-10T00:00:00Z',
} as const;

const CANONICAL_FACT_TABLES = [
  'matches', 'match_period_scores', 'player_match_stats', 'brownlow_round_votes',
] as const;

/* ------------------------------------------------------------------ *
 * Connection
 * ------------------------------------------------------------------ */

/**
 * The suite's own owner connection, deliberately NOT `@/db/client`.
 *
 * `max: 1`, `onnotice` and the `undefined` transform mirror the CLI's
 * `createImportClient()`, so the driver runs against the client shape it runs
 * against in production. The one addition is a longer `statement_timeout`:
 * the §15 verification scans whole canonical fact tables, which the
 * application's 5-second serving default is not sized for.
 */
const sql = postgres(process.env.AFLDB_TEST_DATABASE_URL as string, {
  max: 1,
  onnotice: () => {},
  transform: { undefined: null },
  connection: { statement_timeout: 120000 },
});

const registry = parseSourceFamilyRegistry(
  JSON.parse(readFileSync('data/reference/source-families.json', 'utf8')),
);
const matchContract = getSourceFamily(registry, 'afltables', 'match');
const playerContract = getSourceFamily(registry, 'afltables', 'player_match_stats');

const importRole = createImportRoleParityHarness(
  process.env.AFLDB_TEST_DATABASE_URL,
  process.env.AFLDB_TEST_IMPORT_DATABASE_URL,
);
const roleParitySuffix = importRole.isConfigured ? '' : ` — ${importRole.skipMessage}`;

/* ------------------------------------------------------------------ *
 * Fixture state
 * ------------------------------------------------------------------ */

type Fixtures = {
  sourceId: number;
  providerSourceId: number;
  homeClubId: number;
  awayClubId: number;
  homeClubHist: string;
  awayClubHist: string;
  playerId: number;
  /** AFLDB-ISSUE-105: bigint, so the driver's decimal text, never a number. */
  batchId: ImportBatchId;
  /** The ONE canonical matches row this harness creates. See the T7 note above. */
  disagreeMatchId: number;
};

let fixtures: Fixtures;
/** True only when THIS run created the sources row, so only it may remove one. */
let createdSourceRow = false;
let createdProviderSourceRow = false;

/** Every settle transaction's xid, read back from the batch row it wrote. */
const settleXids: string[] = [];
/** Canonical fact-table row counts as they stood before the first settle run. */
let canonicalBaseline: Record<string, number>;

/* ------------------------------------------------------------------ *
 * Cleanup — used as a pre-clean AND as teardown
 * ------------------------------------------------------------------ */

/**
 * Remove every row this suite can have committed, in dependency-safe order.
 *
 * Called before setup as well as after the run: an interrupted earlier run
 * leaves committed rows behind, and `afterAll` alone cannot undo that.
 *
 * The `issue099-` prefix is the whole scope. It is not narrowed by `source_id`
 * because the pre-clean runs before the source row is resolved, and because no
 * real AFL Tables record id can begin with it.
 *
 * The `sources` row is NEVER deleted here — it may be shared reference data
 * this suite merely borrowed. It is removed in `afterAll` only when this
 * process created it.
 */
async function cleanupIssue099(client: postgres.Sql): Promise<void> {
  await client`DELETE FROM staging.afltables_match WHERE external_record_id LIKE ${`${PREFIX}%`}`;
  await client`DELETE FROM staging.afltables_player_match WHERE external_record_id LIKE ${`${PREFIX}%`}`;
  await client`DELETE FROM promotion_candidates WHERE external_record_id LIKE ${`${PREFIX}%`}`;
  await client`DELETE FROM import_rejections WHERE source_record_id LIKE ${`${PREFIX}%`}`;
  await client`DELETE FROM staging.source_records WHERE external_record_id LIKE ${`${PREFIX}%`}`;
  await client`DELETE FROM staging.source_record_versions WHERE external_record_id LIKE ${`${PREFIX}%`}`;
  // Payloads are content-addressed and carry no record id, so every fixture
  // payload carries an explicit marker key instead.
  await client`DELETE FROM staging.source_payloads WHERE raw_payload->>'issue099_fixture' IS NOT NULL`;
  await client`DELETE FROM external_identities WHERE external_id LIKE ${`${PREFIX}%`}`;
  await client`DELETE FROM players WHERE slug = ${PLAYER_SLUG}`;
  // T7. Both keys are namespaced, and `|` is not a LIKE wildcard, so this
  // removes this suite's own findings — the ISSUE-099-owned one and the
  // foreign-owned stand-in — and nothing else.
  await client`DELETE FROM data_issues WHERE issue_key LIKE ${ISSUE_KEY_PATTERN}`;
  // Before `matches`: this row carries the local_match_id foreign key.
  await client`
    DELETE FROM staging.external_current_matches
     WHERE external_game_id LIKE ${`${PREFIX}%`}
  `;
  // The ONE canonical fixture row, by its dedicated key and nothing wider.
  await client`DELETE FROM matches WHERE match_key LIKE ${`${PREFIX}%`}`;
  await client`
    DELETE FROM import_batches
     WHERE tool = ${FIXTURE_TOOL} OR notes LIKE ${`%${LABEL}%`}
  `;
  await client`DELETE FROM seasons WHERE year = ${SEASON}`;
}

/* ------------------------------------------------------------------ *
 * Fixture payloads and projections
 * ------------------------------------------------------------------ */

function matchPayload(over: Record<string, JsonValue> = {}): JsonValue {
  return {
    issue099_fixture: true,
    season: SEASON,
    round_code: '1',
    match_date: '2094-03-05',
    home_team_raw: 'Issue099 Home',
    away_team_raw: 'Issue099 Away',
    home_goals: 20, home_behinds: 12, home_points: 132,
    away_goals: 10, away_behinds: 9, away_points: 69,
    margin: 63,
    ...over,
  };
}

function playerPayload(over: Record<string, JsonValue> = {}): JsonValue {
  return {
    issue099_fixture: true,
    url: PLAYER_URL,
    match_key: MATCH_KEY,
    season: SEASON,
    round_code: '1',
    playing_for_raw: 'Issue099 Away',
    ...over,
  };
}

function matchProjection(
  matchKey: string, over: Record<string, JsonValue> = {},
): JsonValue {
  return {
    match_key: matchKey,
    season: SEASON,
    round_code: '1',
    round_number: 1,
    round_type: 'home_and_away',
    is_final: false,
    match_date: '2094-03-05',
    match_time: '7:30 PM',
    // Mapped by no venue, on purpose: venue_id stays NULL, venue_raw carries
    // the real string, and no venues or venue_aliases row is ever created.
    venue_raw: VENUE_RAW,
    home_club_hist: fixtures.homeClubHist,
    away_club_hist: fixtures.awayClubHist,
    home_goals: 20, home_behinds: 12, home_score: 132,
    away_goals: 10, away_behinds: 9, away_score: 69,
    result: 'home_win', winner_club_hist: fixtures.homeClubHist, margin: 63,
    attendance: 42123, attendance_status: 'complete', attendance_source_key: 'afltables',
    period_scores: [
      { side: 'home', period: 1, goals: 5, behinds: 3, points: 33 },
      { side: 'away', period: 1, goals: 2, behinds: 2, points: 14 },
    ],
    ...over,
  };
}

function playerProjection(over: Record<string, JsonValue> = {}): JsonValue {
  const stats: Record<string, JsonValue> = {};
  for (const column of [
    'kicks', 'marks', 'handballs', 'disposals', 'goals', 'behinds', 'hitouts',
    'tackles', 'rebounds', 'inside_50s', 'clearances', 'clangers', 'frees_for',
    'frees_against', 'contested', 'uncontested', 'contested_marks',
    'marks_inside_50', 'one_percenters', 'bounces', 'goal_assists',
  ]) stats[column] = 4;
  // NA, which is the correct in-season state: AFL Tables publishes no votes
  // until the count, so NO brownlow_round_votes target exists at all.
  stats.brownlow_votes = null;
  return {
    url: PLAYER_URL,
    afltables_id: null,
    match_key: MATCH_KEY,
    season: SEASON,
    round_code: '1',
    round_number: 1,
    is_final: false,
    club_hist: fixtures.awayClubHist,
    career_game_no: 301,
    jumper_number: '3',
    stats,
    brownlow_round_vote: null,
    ...over,
  };
}

/* ------------------------------------------------------------------ *
 * Bundles
 * ------------------------------------------------------------------ */

type BundleOptions = {
  /** false + an unkeyed rejection is the I2 shape: the scope cannot be swept. */
  matchScopeComplete?: boolean;
  /** Adds the omitted record back to the match scope — the I4 reappearance. */
  includeOmitted?: boolean;
  /** Overrides for the `issue099-match-a` payload, for A -> B -> A. */
  matchPayloadOver?: Record<string, JsonValue>;
  /**
   * T7 ONLY. Adds the record whose `matches` target has a real canonical row
   * and a real independent provider claim, so the §13 disagreement lifecycle
   * can run. Off by default, so every T6 expectation in this file is
   * untouched.
   */
  includeDisagreement?: boolean;
  /** Moves the disagreement record's payload without moving its projection. */
  disagreePayloadOver?: Record<string, JsonValue>;
};

function bundleJson(options: BundleOptions = {}): JsonValue {
  const complete = options.matchScopeComplete ?? true;
  const matchIds = [MATCH_RECORD, REJECTED_RECORD];
  if (options.includeOmitted) matchIds.push(OMITTED_RECORD);
  if (options.includeDisagreement) matchIds.push(DISAGREE_RECORD);

  const records: JsonValue[] = [
    {
      family: 'afltables.match', scope_key: SCOPE, external_record_id: MATCH_RECORD,
      payload: matchPayload(options.matchPayloadOver),
      observed_columns: [...(matchContract.knownColumns ?? [])],
      projection: matchProjection(MATCH_KEY),
      rejection: null,
    },
    // Observed but NOT projected (I1): it reaches the spine in full and
    // writes no projection row.
    {
      family: 'afltables.match', scope_key: SCOPE, external_record_id: REJECTED_RECORD,
      payload: matchPayload({ home_team_raw: 'Issue099 Unknown Club' }),
      observed_columns: [...(matchContract.knownColumns ?? [])],
      projection: null,
      rejection: { reason: 'club_unresolved', detail: 'Issue099 Unknown Club' },
    },
    {
      family: 'afltables.player_match_stats', scope_key: SCOPE,
      external_record_id: PLAYER_RECORD,
      payload: playerPayload(),
      observed_columns: [...(playerContract.knownColumns ?? [])],
      projection: playerProjection(),
      rejection: null,
    },
  ];
  if (options.includeOmitted) {
    records.splice(2, 0, {
      family: 'afltables.match', scope_key: SCOPE, external_record_id: OMITTED_RECORD,
      // Byte-identical to what the fixture seeded, so the reappearance
      // appends no version (I4).
      payload: omittedPayload(),
      observed_columns: [...(matchContract.knownColumns ?? [])],
      projection: matchProjection(OMITTED_MATCH_KEY),
      rejection: null,
    });
  }
  if (options.includeDisagreement) {
    records.push({
      family: 'afltables.match', scope_key: SCOPE, external_record_id: DISAGREE_RECORD,
      // The payload is what moves between runs; the PROJECTION deliberately
      // does not, so the proposal put to corroboration is identical every
      // time and only the source version and the provider's claim change.
      payload: matchPayload({ round_code: '3', match_date: '2094-03-19', ...options.disagreePayloadOver }),
      observed_columns: [...(matchContract.knownColumns ?? [])],
      // Attendance is the one proposed field that differs from the canonical
      // fixture row, so `diffFields()` is never empty. Without a changed
      // field `reconcile()` returns `history_only` at step 5 and never
      // reaches corroboration at step 7 — the disagreement would be
      // unreachable, not absent.
      projection: matchProjection(DISAGREE_MATCH_KEY),
      rejection: null,
    });
  }

  return {
    bundle_contract_version: 1,
    generated_by: 'tools/migration/import_fitzroy_core.py',
    snapshot_label: LABEL,
    manifest_path: `docs/rebuild-manifests/afltables_fitzroy_core/${LABEL}.json`,
    manifest_sha256: MANIFEST_SHA,
    acquisition_kind: 'in_season_partial',
    season: SEASON,
    fitzroy_version: '1.8.0',
    enumerations: [
      {
        family: 'afltables.match', scope_key: SCOPE, complete,
        incomplete_reason: complete ? null : 'a row carried no provable key',
        external_record_ids: matchIds,
      },
      {
        family: 'afltables.player_match_stats', scope_key: SCOPE, complete: true,
        incomplete_reason: null, external_record_ids: [PLAYER_RECORD],
      },
    ],
    records,
    unkeyed_rejections: complete ? [] : [{
      family: 'afltables.match', scope_key: SCOPE,
      reason: 'no_provable_key', detail: 'a results row with no resolvable club pair',
    }],
    counts: {
      matches: matchIds.length,
      player_match_rows: 1,
      rejections: 1,
      unkeyed_rejections: complete ? 0 : 1,
    },
  } as JsonValue;
}

function omittedPayload(): JsonValue {
  return matchPayload({
    round_code: '2',
    match_date: '2094-03-12',
    home_team_raw: 'Issue099 Away',
    away_team_raw: 'Issue099 Home',
  });
}

function buildBundle(options: BundleOptions = {}): SettleBundle {
  return validateSettleBundle({
    raw: bundleJson(options),
    expectedSnapshotLabel: LABEL,
    actualManifestSha256: MANIFEST_SHA,
    inProgressSeasons: [SEASON],
    registry,
  });
}

/**
 * T8 defect D2 — the real-data combination that escaped T6 and T7: a player
 * URL that is valid source identity but resolves to nobody here, carrying an
 * NA Brownlow vote.
 *
 * **Its own record, its own URL and its own scope**, and it is built here
 * rather than as a `bundleJson()` option, so every signed-off T6/T7 counter and
 * candidate-set assertion in this file keeps its original value. A separate
 * scope also means this bundle's enumeration can never sweep another test's
 * records: it enumerates exactly one record, in a scope that holds exactly
 * that record.
 *
 * The projection is deliberately well-formed — `readPlayerMatchProjection()`
 * accepts it, and a linked URL would project. Only identity fails, which is
 * what makes `player_match_stats` an honest `unresolved_identity` while
 * `brownlow_round_votes` must not exist at all.
 */
function unlinkedPlayerBundle(over: {
  payload?: Record<string, JsonValue>;
  projection?: Record<string, JsonValue>;
} = {}): SettleBundle {
  return validateSettleBundle({
    raw: {
      bundle_contract_version: 1,
      generated_by: 'tools/migration/import_fitzroy_core.py',
      snapshot_label: LABEL,
      manifest_path: `docs/rebuild-manifests/afltables_fitzroy_core/${LABEL}.json`,
      manifest_sha256: MANIFEST_SHA,
      acquisition_kind: 'in_season_partial',
      season: SEASON,
      fitzroy_version: '1.8.0',
      enumerations: [{
        family: 'afltables.player_match_stats', scope_key: UNLINKED_SCOPE,
        complete: true, incomplete_reason: null,
        external_record_ids: [UNLINKED_PLAYER_RECORD],
      }],
      records: [{
        family: 'afltables.player_match_stats', scope_key: UNLINKED_SCOPE,
        external_record_id: UNLINKED_PLAYER_RECORD,
        payload: playerPayload({ url: UNLINKED_PLAYER_URL, ...over.payload }),
        observed_columns: [...(playerContract.knownColumns ?? [])],
        // brownlow_round_vote stays null by default: the 2026 in-season state,
        // on every one of the 9522 rows the real snapshot carried.
        projection: playerProjection({ url: UNLINKED_PLAYER_URL, ...over.projection }),
        rejection: null,
      }],
      unkeyed_rejections: [],
      counts: { matches: 0, player_match_rows: 1, rejections: 0, unkeyed_rejections: 0 },
    } as JsonValue,
    expectedSnapshotLabel: LABEL,
    actualManifestSha256: MANIFEST_SHA,
    inProgressSeasons: [SEASON],
    registry,
  });
}

/* ------------------------------------------------------------------ *
 * The bracketed run
 * ------------------------------------------------------------------ */

async function canonicalCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of CANONICAL_FACT_TABLES) {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM ${sql(table)}
    `;
    counts[table] = row.n;
  }
  return counts;
}

/**
 * One settle run, with the §15 guarantee asserted around EVERY invocation in
 * this file rather than once at the end.
 *
 * The transaction's own xid is read back from the `import_batches` row it
 * wrote, which is what lets the §15 test later ask each canonical fact table
 * whether any surviving tuple was written by one of these transactions.
 */
async function runSettle(
  bundle: SettleBundle, apply: boolean, observedAt: string,
): Promise<SettleRunResult> {
  const before = await canonicalCounts();
  const result = await runSettleAfltables(sql, {
    bundle,
    registry,
    apply,
    manualAuthority: UNAVAILABLE_MANUAL_AUTHORITY,
    observedAt,
  });
  const after = await canonicalCounts();

  expect(after).toEqual(before);
  expect(result.counters.canonicalRowsInserted).toBe(0);
  expect(result.counters.canonicalRowsUpdated).toBe(0);

  if (result.batchId !== null) {
    const [row] = await sql<{ xid: string }[]>`
      SELECT xmin::text AS xid FROM import_batches WHERE id = ${result.batchId}
    `;
    settleXids.push(row.xid);
  }
  return result;
}

/* ------------------------------------------------------------------ *
 * State readers
 * ------------------------------------------------------------------ */

type SpineRow = {
  externalRecordId: string;
  scopeKey: string;
  currentVersionSeq: number;
  lastSeenAt: string;
  absentSince: string | null;
};

async function spineRow(family: string, recordId: string): Promise<SpineRow | undefined> {
  const [row] = await sql<SpineRow[]>`
    SELECT external_record_id AS "externalRecordId", scope_key AS "scopeKey",
           current_version_seq AS "currentVersionSeq",
           -- Rendered in UTC, not the session zone: the assertions compare
           -- against the UTC observedAt this suite passed in.
           (last_seen_at AT TIME ZONE 'UTC')::text AS "lastSeenAt",
           absent_since::text AS "absentSince"
      FROM staging.source_records
     WHERE source_id = ${fixtures.sourceId} AND family = ${family}
       AND external_record_id = ${recordId}
  `;
  return row;
}

type CandidateRow = {
  externalRecordId: string; targetTable: string; verb: string; status: string;
  sourceVersionSeq: number; createdByBatchId: ImportBatchId;
};

/**
 * The pending queue, ordered in JavaScript by code point.
 *
 * PostgreSQL would order `match_period_scores` and `matches` differently under
 * a punctuation-ignoring collation, so the ordering is not left to the
 * database's locale.
 */
function byRecordThenTarget(a: CandidateRow, b: CandidateRow): number {
  const left = `${a.externalRecordId}|${a.targetTable}`;
  const right = `${b.externalRecordId}|${b.targetTable}`;
  return left < right ? -1 : left > right ? 1 : 0;
}

async function candidateRows(): Promise<CandidateRow[]> {
  const rows = await sql<CandidateRow[]>`
    SELECT external_record_id AS "externalRecordId", target_table AS "targetTable",
           verb, status, source_version_seq AS "sourceVersionSeq",
           created_by_batch_id AS "createdByBatchId"
      FROM promotion_candidates
     WHERE external_record_id LIKE ${`${PREFIX}%`}
  `;
  return [...rows].sort(byRecordThenTarget);
}

async function countEq(relation: string, column: string, value: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM ${sql(relation)} WHERE ${sql(column)} = ${value}
  `;
  return row.n;
}

async function countLike(relation: string, column: string, pattern: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM ${sql(relation)} WHERE ${sql(column)} LIKE ${pattern}
  `;
  return row.n;
}

/**
 * Every ISSUE-099-owned relation, as rows, for the §22 byte-identity check.
 *
 * `to_jsonb(t)` carries every column including `projected_at` and
 * `created_at`, so a dry-run that wrote and did not roll back would move at
 * least one timestamp and fail this comparison.
 */
async function issue099Snapshot(): Promise<string> {
  const like = `${PREFIX}%`;
  const [state] = await sql<{ state: JsonValue }[]>`
    SELECT jsonb_build_object(
      'records', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.external_record_id), '[]'::jsonb)
                    FROM staging.source_records t WHERE t.external_record_id LIKE ${like}),
      'versions', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.external_record_id, t.version_seq), '[]'::jsonb)
                     FROM staging.source_record_versions t WHERE t.external_record_id LIKE ${like}),
      'payloads', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.payload_hash), '[]'::jsonb)
                     FROM staging.source_payloads t WHERE t.raw_payload->>'issue099_fixture' IS NOT NULL),
      'match_projection', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.external_record_id), '[]'::jsonb)
                             FROM staging.afltables_match t WHERE t.external_record_id LIKE ${like}),
      'player_projection', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.external_record_id), '[]'::jsonb)
                              FROM staging.afltables_player_match t WHERE t.external_record_id LIKE ${like}),
      'candidates', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb)
                       FROM promotion_candidates t WHERE t.external_record_id LIKE ${like}),
      'rejections', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb)
                       FROM import_rejections t WHERE t.source_record_id LIKE ${like}),
      'batches', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb)
                    FROM import_batches t
                   WHERE t.tool = ${FIXTURE_TOOL} OR t.notes LIKE ${`%${LABEL}%`}),
      -- §22 names data_issues as an ISSUE-099-owned relation. Scoped to this
      -- suite's own issue keys, so a concurrent writer's findings cannot make
      -- the comparison flaky.
      'data_issues', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb)
                        FROM data_issues t WHERE t.issue_key LIKE ${ISSUE_KEY_PATTERN}),
      -- §22 names promotion_decisions too. ISSUE-099 has no decision-writing
      -- path at all, so this is direct evidence that neither dry-run nor
      -- apply can alter the append-only decision ledger. Scoped through the
      -- candidates this suite owns.
      'decisions', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb)
                      FROM promotion_decisions t
                      JOIN promotion_candidates c ON c.id = t.candidate_id
                     WHERE c.external_record_id LIKE ${like})
    ) AS state
  `;
  return JSON.stringify(state.state);
}

type IssueRow = {
  id: string;
  entityType: string;
  entityId: number | null;
  issueType: string;
  issueKey: string;
  severity: string;
  description: string;
  details: Record<string, JsonValue>;
  detectedAt: string;
  resolvedAt: string | null;
  resolution: string | null;
};

/** Every data_issues row in this suite's key namespace, oldest first. */
async function issueRows(): Promise<IssueRow[]> {
  return sql<IssueRow[]>`
    SELECT id::text AS id, entity_type AS "entityType", entity_id::int AS "entityId",
           issue_type AS "issueType", issue_key AS "issueKey", severity::text AS severity,
           description, details, detected_at::text AS "detectedAt",
           resolved_at::text AS "resolvedAt", resolution
      FROM data_issues
     WHERE issue_key LIKE ${ISSUE_KEY_PATTERN}
     ORDER BY id
  `;
}

/** Point the independent provider's claim at a score, to raise or clear it. */
async function setProviderScore(homeScore: number, awayScore: number): Promise<void> {
  await sql`
    UPDATE staging.external_current_matches
       SET home_score = ${homeScore}, away_score = ${awayScore}
     WHERE source_id = ${fixtures.providerSourceId}
       AND external_game_id = ${PROVIDER_GAME_ID}
  `;
}

/* ------------------------------------------------------------------ *
 * Setup
 * ------------------------------------------------------------------ */

beforeAll(async () => {
  const [{ database }] = await sql<{ database: string }[]>`
    SELECT current_database() AS database
  `;
  if (!/_test$/.test(database)) {
    throw new Error(
      `Refusing to run: this suite commits fixtures, and '${database}' is not a _test database.`,
    );
  }

  await cleanupIssue099(sql);

  await sql`
    INSERT INTO seasons (year, league, status)
    VALUES (${SEASON}, 'AFL', 'in_progress'::season_status)
    ON CONFLICT (year) DO NOTHING
  `;

  // The AFL Tables source row is shared reference data. It is created only if
  // genuinely absent, and only a run that created one may ever remove it. A
  // pre-existing row is read and left exactly as it was found.
  const existingSource = await sql<{ id: number }[]>`
    SELECT id::int AS id FROM sources WHERE key = 'afltables'
  `;
  let sourceId: number;
  if (existingSource.length > 0) {
    sourceId = existingSource[0].id;
  } else {
    const [created] = await sql<{ id: number }[]>`
      INSERT INTO sources (key, name, kind)
      VALUES ('afltables', 'AFL Tables', 'scrape')
      RETURNING id::int AS id
    `;
    sourceId = created.id;
    createdSourceRow = true;
  }

  // Two REAL historical club identities, read and never written. The
  // projection needs resolvable club history strings; inventing clubs would
  // mutate a canonical identity table for no gain.
  const clubs = await sql<{ id: number; hist: string }[]>`
    SELECT id::int AS id, legacy_club_hist AS hist
      FROM clubs WHERE legacy_club_hist IS NOT NULL ORDER BY id LIMIT 2
  `;
  if (clubs.length < 2) {
    throw new Error(
      'afldb_test carries fewer than two clubs with a legacy_club_hist; the settle '
      + 'projection cannot resolve a home and an away identity.',
    );
  }

  const [player] = await sql<{ id: number }[]>`
    INSERT INTO players (display_name, sort_name, search_name, slug)
    VALUES ('Issue099 Fixture', 'Fixture, Issue099', 'issue099 fixture', ${PLAYER_SLUG})
    RETURNING id::int AS id
  `;
  await sql`
    INSERT INTO external_identities (source_id, external_id, player_id, status, match_method)
    VALUES (${sourceId}, ${PLAYER_URL}, ${player.id}, 'unique', 'afltables_profile_url')
  `;

  // `import_batches.id` is bigint. It is NOT cast to int here: the fixture
  // must hand back exactly what `runSettleAfltables()` hands back, or the
  // suite would prove a representation the pass does not use
  // (AFLDB-ISSUE-105).
  const [batch] = await sql<{ id: string }[]>`
    INSERT INTO import_batches (source_id, tool, target_table, notes)
    VALUES (${sourceId}, ${FIXTURE_TOOL}, 'staging.source_record_versions',
            'AFLDB-ISSUE-099 slice 3 fixture')
    RETURNING id
  `;

  // ---- T7 disagreement fixture (A17) -------------------------------
  // Read or create the independent provider's sources row, on exactly the
  // same terms as the AFL Tables one: a pre-existing row is borrowed and
  // left as found, and only a run that created one may remove it.
  const existingProvider = await sql<{ id: number }[]>`
    SELECT id::int AS id FROM sources WHERE key = ${PROVIDER_SOURCE_KEY}
  `;
  let providerSourceId: number;
  if (existingProvider.length > 0) {
    providerSourceId = existingProvider[0].id;
  } else {
    const [created] = await sql<{ id: number }[]>`
      INSERT INTO sources (key, name, kind)
      VALUES (${PROVIDER_SOURCE_KEY}, 'Squiggle API', 'upstream_dataset')
      RETURNING id::int AS id
    `;
    providerSourceId = created.id;
    createdProviderSourceRow = true;
  }

  // FAIL CLOSED. This suite creates the dedicated canonical row itself; a row
  // already sitting on the key is an unknown row, and adopting, overwriting
  // or mutating it would both corrupt someone else's data and invalidate the
  // §15 proof this suite exists to make.
  const preExisting = await sql<{ id: number }[]>`
    SELECT id::int AS id FROM matches WHERE match_key = ${DISAGREE_MATCH_KEY}
  `;
  if (preExisting.length > 0) {
    throw new Error(
      `Refusing to run: a matches row already exists on the dedicated ISSUE-099 fixture key `
      + `'${DISAGREE_MATCH_KEY}'. This suite creates that row itself and never adopts, `
      + 'overwrites or mutates a pre-existing canonical row. Remove it deliberately first.',
    );
  }

  // THE ONE CANONICAL FACT ROW THIS HARNESS CREATES. It is fixture data, and
  // it is inserted here — before `canonicalBaseline` is captured — precisely
  // so the §15 count and xmin proofs still hold: the invariant is that SETTLE
  // performs zero canonical fact mutation, not that the harness never seeds a
  // fixture. `attendance` deliberately differs from the projection's 42123 so
  // `diffFields()` is non-empty and `reconcile()` reaches corroboration.
  const [disagreeMatch] = await sql<{ id: number }[]>`
    INSERT INTO matches (
      match_key, season, round_code, round_number, round_type, is_final,
      match_date, match_time, venue_raw, home_club_id, away_club_id,
      home_goals, home_behinds, home_score, away_goals, away_behinds, away_score,
      result, winner_club_id, margin,
      attendance, attendance_status, attendance_source_id, source_id
    ) VALUES (
      ${DISAGREE_MATCH_KEY}, ${SEASON}, '1', 1, 'home_and_away'::round_type, false,
      '2094-03-05', '7:30 PM', ${VENUE_RAW}, ${clubs[0].id}, ${clubs[1].id},
      20, 12, 132, 10, 9, 69,
      'home_win'::match_result, ${clubs[0].id}, 63,
      41000, 'complete'::coverage_status, ${sourceId}, ${sourceId}
    )
    RETURNING id::int AS id
  `;

  // The independent provider's claim, in the typed projection §13.2 reads —
  // never the jsonb spine. Same orientation as the proposal, and a home score
  // of 130 against AFL Tables' 132: one genuine score conflict.
  await sql`
    INSERT INTO staging.external_current_matches (
      source_id, external_game_id, season, round_label, round_number,
      match_date, venue_raw, home_team_raw, away_team_raw,
      home_club_id, away_club_id, local_match_id,
      home_score, away_score, raw_payload
    ) VALUES (
      ${providerSourceId}, ${PROVIDER_GAME_ID}, ${SEASON}, 'Round 1', 1,
      '2094-03-05', ${VENUE_RAW}, 'Issue099 Home', 'Issue099 Away',
      ${clubs[0].id}, ${clubs[1].id}, ${disagreeMatch.id},
      130, 69, ${sql.json({ issue099_fixture: true } as never)}
    )
  `;

  fixtures = {
    sourceId,
    providerSourceId,
    homeClubId: clubs[0].id,
    awayClubId: clubs[1].id,
    homeClubHist: clubs[0].hist,
    awayClubHist: clubs[1].hist,
    playerId: player.id,
    batchId: asImportBatchId(batch.id),
    disagreeMatchId: disagreeMatch.id,
  };

  // Spine fixtures, written through the REAL store so their hashes and
  // recipes are the ones the settle pass will compare against.
  await sql.begin(async (tx) => {
    await persistSourceObservation(tx, {
      contract: matchContract,
      sourceId: fixtures.sourceId,
      externalRecordId: OMITTED_RECORD,
      scopeKey: SCOPE,
      payload: omittedPayload(),
    }, fixtures.batchId, T.seed);
    await persistSourceObservation(tx, {
      contract: matchContract,
      sourceId: fixtures.sourceId,
      externalRecordId: SENTINEL_MATCH,
      scopeKey: SENTINEL_SCOPE,
      payload: matchPayload({ home_team_raw: 'Issue099 Sentinel' }),
    }, fixtures.batchId, T.seed);
    await persistSourceObservation(tx, {
      contract: playerContract,
      sourceId: fixtures.sourceId,
      externalRecordId: SENTINEL_PLAYER,
      scopeKey: SENTINEL_SCOPE,
      payload: playerPayload({ match_key: 'issue099-sentinel-match-key' }),
    }, fixtures.batchId, T.seed);
  });

  // The O1 sentinels: one row in each migration-076 projection that the
  // settle pass never names. A TRUNCATE, or any unscoped DELETE, removes it.
  await sql`
    INSERT INTO staging.afltables_match (
      source_id, family, external_record_id, version_seq,
      season, round_code, round_number, round_type, is_final, match_date,
      venue_raw, home_club_id, away_club_id, home_score, away_score,
      result, winner_club_id, margin, attendance_status, projected_by_batch_id
    ) VALUES (
      ${fixtures.sourceId}, 'match', ${SENTINEL_MATCH}, 1,
      ${SEASON}, 'issue099', 1, 'home_and_away'::round_type, false, '2094-03-01',
      'ISSUE-099 Sentinel Ground', ${fixtures.homeClubId}, ${fixtures.awayClubId}, 1, 0,
      'home_win'::match_result, ${fixtures.homeClubId}, 1,
      'not_collected'::coverage_status, ${fixtures.batchId}
    )
  `;
  await sql`
    INSERT INTO staging.afltables_player_match (
      source_id, family, external_record_id, version_seq,
      season, match_key, round_code, is_final, player_id, club_id,
      projected_by_batch_id
    ) VALUES (
      ${fixtures.sourceId}, 'player_match_stats', ${SENTINEL_PLAYER}, 1,
      ${SEASON}, 'issue099-sentinel-match-key', 'issue099', false,
      ${fixtures.playerId}, ${fixtures.awayClubId}, ${fixtures.batchId}
    )
  `;

  canonicalBaseline = await canonicalCounts();
});

afterAll(async () => {
  try {
    await cleanupIssue099(sql);
    if (createdSourceRow) {
      await sql`DELETE FROM sources WHERE key = 'afltables'`;
    }
    if (createdProviderSourceRow) {
      await sql`DELETE FROM sources WHERE key = ${PROVIDER_SOURCE_KEY}`;
    }
  } finally {
    await sql.end({ timeout: 10 });
  }
});

/* ================================================================== *
 * The gate
 * ================================================================== */

describe('AFLDB-ISSUE-099 settle — the transaction against PostgreSQL', () => {
  it('is pointed at a _test database and starts from a clean namespace', async () => {
    const [{ database }] = await sql<{ database: string }[]>`
      SELECT current_database() AS database
    `;
    expect(database).toMatch(/_test$/);

    // Only the seeded fixtures exist: nothing from an earlier run survived
    // the pre-clean, and no settle run has happened yet.
    expect(await countLike('promotion_candidates', 'external_record_id', `${PREFIX}%`)).toBe(0);
    expect(await countEq('staging.afltables_match', 'external_record_id', MATCH_RECORD)).toBe(0);
    expect(await spineRow('match', MATCH_RECORD)).toBeUndefined();
    expect(await spineRow('match', OMITTED_RECORD)).toBeDefined();
    expect(await countLike('data_issues', 'issue_key', ISSUE_KEY_PATTERN)).toBe(0);
    // The one canonical fixture row exists, created by this harness and
    // counted in `canonicalBaseline` before any settle run.
    expect(await countEq('matches', 'match_key', DISAGREE_MATCH_KEY)).toBe(1);
  });

  it('runs the whole write path in --dry-run and retains nothing (§22)', async () => {
    const result = await runSettle(buildBundle(), false, T.dryRunFirst);

    expect(result.applied).toBe(false);
    expect(result.batchId).toBeNull();
    // The counters are real: the path executed, then the transaction was
    // rolled back deliberately.
    expect(result.counters.observationsSeen).toBe(3);
    expect(result.counters.versionsAppended).toBe(3);
    expect(result.counters.projectionRowsWritten).toBe(2);
    // Four, not five: see the apply run below (AFLDB-ISSUE-106).
    expect(result.counters.candidatesCreated).toBe(4);

    // And nothing was kept — not even the import_batches row.
    expect(await spineRow('match', MATCH_RECORD)).toBeUndefined();
    expect(await spineRow('player_match_stats', PLAYER_RECORD)).toBeUndefined();
    expect(await countEq('staging.afltables_match', 'external_record_id', MATCH_RECORD)).toBe(0);
    expect(await countLike('promotion_candidates', 'external_record_id', `${PREFIX}%`)).toBe(0);
    expect(await countLike('import_rejections', 'source_record_id', `${PREFIX}%`)).toBe(0);
    expect(await countLike('import_batches', 'notes', `%${LABEL}%`)).toBe(0);
  });

  it('applies observations, projections and candidates, and refuses to sweep an '
    + 'incomplete scope (I2)', async () => {
    // The match scope carries an unkeyed rejection, so it is NOT sweepable:
    // a row whose presence cannot be represented makes absence unknowable.
    const result = await runSettle(
      buildBundle({ matchScopeComplete: false }), true, T.applyFirst,
    );

    expect(result.applied).toBe(true);
    expect(result.batchId).not.toBeNull();

    expect(result.counters.absenceSweepSkipped).toBe(1);
    expect(result.absenceSweepSkipped).toEqual([
      { family: 'afltables.match', scopeKey: SCOPE, reason: 'a row carried no provable key' },
    ]);
    // I2: nothing in that scope was stamped, including the record the bundle
    // genuinely did not carry.
    expect(result.counters.observationsMarkedAbsent).toBe(0);
    expect((await spineRow('match', OMITTED_RECORD))?.absentSince).toBeNull();

    // The spine took every keyed record, projected or not (§19).
    expect(result.counters.observationsSeen).toBe(3);
    expect(result.counters.versionsAppended).toBe(3);
    expect(result.counters.payloadsCreated).toBe(3);
    expect(result.counters.payloadsReused).toBe(0);
    expect((await spineRow('match', MATCH_RECORD))?.currentVersionSeq).toBe(1);
    expect((await spineRow('match', REJECTED_RECORD))?.currentVersionSeq).toBe(1);
    expect((await spineRow('player_match_stats', PLAYER_RECORD))?.currentVersionSeq).toBe(1);

    // Only the two records that projected wrote a typed projection row.
    expect(result.counters.projectionRowsWritten).toBe(2);
    expect(result.counters.venueUnmapped).toBe(1);
    expect(await countEq('staging.afltables_match', 'external_record_id', MATCH_RECORD)).toBe(1);
    expect(await countEq('staging.afltables_match', 'external_record_id', REJECTED_RECORD)).toBe(0);
    expect(await countEq('staging.afltables_player_match', 'external_record_id', PLAYER_RECORD)).toBe(1);

    // venue_id is NULL and venue_raw carries the real string: no venues row
    // was created and the literal 'Unknown' was never written.
    const [projected] = await sql<{ venueId: number | null; venueRaw: string }[]>`
      SELECT venue_id AS "venueId", venue_raw AS "venueRaw"
        FROM staging.afltables_match WHERE external_record_id = ${MATCH_RECORD}
    `;
    expect(projected.venueId).toBeNull();
    expect(projected.venueRaw).toBe(VENUE_RAW);

    // One 'new' proposal for matches; every dependent target that the source
    // actually established is a refusal, because no canonical match exists to
    // key them on. FOUR, not five: AFLDB-ISSUE-106 removed the fifth, which
    // was a `match_period_scores` refusal for a record that established no
    // period score at all (see the candidate list below).
    expect(result.counters.candidatesCreated).toBe(4);
    expect(result.counters.candidatesRefreshed).toBe(0);
    expect(result.counters.unresolvedIdentityMatch).toBe(2);
    // AFLDB-ISSUE-105. `runSettleAfltables()` returns the id exactly as
    // postgres.js delivered it from a bigint `RETURNING id` — decimal TEXT,
    // because the driver renders int8 as text rather than risk a lossy
    // Number — and `SettleRunResult.batchId` now says so. This is the runtime
    // proof of that contract: the declared type and the value agree, and
    // `candidateRows()` reads `created_by_batch_id` uncast, so both sides of
    // the comparison are the one representation. No `::int` cast and no
    // `Number()` normalisation is needed to make the assertion pass.
    expect(typeof result.batchId).toBe('string');
    const batchId = asImportBatchId(result.batchId);
    const refusal = (externalRecordId: string, targetTable: string): CandidateRow => ({
      externalRecordId, targetTable, verb: 'unresolved_identity', status: 'pending',
      sourceVersionSeq: 1, createdByBatchId: batchId,
    });
    // AFLDB-ISSUE-106, DELIBERATE. The rejected record no longer refuses on
    // `match_period_scores`. It is Python-rejected and carries NO projection
    // at all, so nothing about it establishes a period score — and a target
    // the source never established is not a refusal, exactly as an NA
    // Brownlow vote is not one (D2). What it DOES establish is that a results
    // row exists whose club could not be resolved, and it still refuses on
    // `matches` to say so. MATCH_RECORD published period scores, so its
    // `match_period_scores` refusal is unchanged.
    expect(await candidateRows()).toEqual([
      refusal(MATCH_RECORD, 'match_period_scores'),
      { externalRecordId: MATCH_RECORD, targetTable: 'matches',
        verb: 'new', status: 'pending', sourceVersionSeq: 1, createdByBatchId: batchId },
      refusal(REJECTED_RECORD, 'matches'),
      refusal(PLAYER_RECORD, 'player_match_stats'),
    ].sort(byRecordThenTarget));

    // And no candidate anywhere proposes an empty period set (§17.2).
    const [empty] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM promotion_candidates
       WHERE target_table = 'match_period_scores'
         AND external_record_id LIKE ${`${PREFIX}%`}
         AND proposed_fields->'period_scores' = '[]'::jsonb
    `;
    expect(empty.n).toBe(0);

    // §17.4: no vote was published, so brownlow_round_votes is not a target
    // at all — not a candidate proposing votes = 0.
    const [votes] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM promotion_candidates
       WHERE target_table = 'brownlow_round_votes'
         AND external_record_id LIKE ${`${PREFIX}%`}
    `;
    expect(votes.n).toBe(0);

    // import_rejections is written for unresolved identity only — one per
    // refusal above, so three since ISSUE-106 rather than four.
    expect(await countLike('import_rejections', 'source_record_id', `${PREFIX}%`)).toBe(3);

    const [batchRow] = await sql<
      { status: string; recordsRead: number; recordsRejected: number }[]
    >`
      SELECT status, records_read::int AS "recordsRead",
             records_rejected::int AS "recordsRejected"
        FROM import_batches WHERE id = ${result.batchId}
    `;
    expect(batchRow.status).toBe('completed');
    expect(batchRow.recordsRead).toBe(3);
    // Migration 001: records_rejected must equal the number of
    // import_rejections rows for the batch — the three asserted above, not the
    // bundle's single rejected record.
    expect(batchRow.recordsRejected).toBe(3);
  });

  it('reruns idempotently: no payload, no version, no candidate, no rejection', async () => {
    const before = await candidateRows();
    const rejectionsBefore = await countLike(
      'import_rejections', 'source_record_id', `${PREFIX}%`,
    );

    const result = await runSettle(
      buildBundle({ matchScopeComplete: false }), true, T.rerun,
    );

    expect(result.counters.versionsAppended).toBe(0);
    expect(result.counters.payloadsCreated).toBe(0);
    expect(result.counters.payloadsReused).toBe(0);
    // Unchanged content is decided by the family hash contract alone, before
    // identity is consulted, so no target proposes anything.
    //
    // The unit is RECONCILIATION OUTCOMES, one per (record x target the SOURCE
    // ESTABLISHED) — not records, not versions. Four here: MATCH_RECORD on
    // `matches` and `match_period_scores` (it published quarter scores),
    // REJECTED_RECORD on `matches` alone, and PLAYER_RECORD on
    // `player_match_stats` alone. The two absent from that list are the two
    // targets this source never established for those records: PLAYER_RECORD's
    // NA `brownlow_round_votes` (ISSUE-099 D2) and, since AFLDB-ISSUE-106,
    // REJECTED_RECORD's `match_period_scores`. A target that does not exist is
    // never reconciled, so it cannot report an outcome of any kind — an
    // `unchanged` one included. Losing that fifth count is the fix working,
    // not a lost observation: the record itself is still seen, still hashed
    // and still unchanged, and every idempotence assertion around this one
    // says so directly.
    expect(result.counters.observationsUnchanged).toBe(4);
    expect(result.counters.observationsCorrected).toBe(0);
    expect(result.counters.candidatesCreated).toBe(0);
    expect(result.counters.candidatesRefreshed).toBe(0);

    // The pending candidates are the SAME rows, still attributed to the batch
    // that created them.
    expect(await candidateRows()).toEqual(before);
    expect(await countLike('import_rejections', 'source_record_id', `${PREFIX}%`))
      .toBe(rejectionsBefore);

    // The projection rows were refreshed in place, not stacked. Two each: the
    // record that projected, plus the untouched O1 sentinel.
    expect(await countLike('staging.afltables_match', 'external_record_id', `${PREFIX}%`)).toBe(2);
    expect(await countLike('staging.afltables_player_match', 'external_record_id', `${PREFIX}%`)).toBe(2);
  });

  it('marks a genuine omission absent inside a proven-complete scope, and '
    + 'nowhere else (I3)', async () => {
    const result = await runSettle(buildBundle(), true, T.sweep);

    expect(result.counters.absenceSweepSkipped).toBe(0);
    expect(result.counters.observationsMarkedAbsent).toBe(1);

    const omitted = await spineRow('match', OMITTED_RECORD);
    expect(omitted?.absentSince).not.toBeNull();
    // Absence is state, not deletion: the record and its history are intact.
    expect(omitted?.currentVersionSeq).toBe(1);
    expect(await countEq(
      'staging.source_record_versions', 'external_record_id', OMITTED_RECORD,
    )).toBe(1);

    // Scoped: a record in another scope of the same family is untouched, and
    // so is the record the bundle DID carry.
    expect((await spineRow('match', SENTINEL_MATCH))?.absentSince).toBeNull();
    expect((await spineRow('player_match_stats', SENTINEL_PLAYER))?.absentSince).toBeNull();
    expect((await spineRow('match', MATCH_RECORD))?.absentSince).toBeNull();

    // §18.2: absence proposes nothing.
    expect(await countEq(
      'promotion_candidates', 'external_record_id', OMITTED_RECORD,
    )).toBe(0);
  });

  it('keeps an observed-but-rejected record present and unprojected (I1)', async () => {
    const rejected = await spineRow('match', REJECTED_RECORD);
    expect(rejected).toBeDefined();
    // Its last_seen_at advanced with the sweep run, so the sweep that marked
    // the genuinely omitted record could not reach it.
    expect(rejected?.absentSince).toBeNull();
    expect(rejected?.lastSeenAt.startsWith('2094-03-05')).toBe(true);

    // Present in full, projected not at all.
    expect(await countEq(
      'staging.source_record_versions', 'external_record_id', REJECTED_RECORD,
    )).toBe(1);
    expect(await countEq(
      'staging.afltables_match', 'external_record_id', REJECTED_RECORD,
    )).toBe(0);

    const [payload] = await sql<{ raw: Record<string, JsonValue> }[]>`
      SELECT p.raw_payload AS raw
        FROM staging.source_records r
        JOIN staging.source_payloads p
          ON p.source_id = r.source_id AND p.family = r.family
         AND p.payload_hash = r.current_payload_hash
       WHERE r.source_id = ${fixtures.sourceId} AND r.family = 'match'
         AND r.external_record_id = ${REJECTED_RECORD}
    `;
    expect(payload.raw.home_team_raw).toBe('Issue099 Unknown Club');
  });

  it('clears absence on reappearance without appending a version (I4)', async () => {
    const result = await runSettle(
      buildBundle({ includeOmitted: true }), true, T.reappear,
    );

    expect(result.counters.observationsReappeared).toBe(1);
    expect(result.counters.versionsAppended).toBe(0);
    expect(result.counters.payloadsCreated).toBe(0);

    const omitted = await spineRow('match', OMITTED_RECORD);
    expect(omitted?.absentSince).toBeNull();
    expect(omitted?.currentVersionSeq).toBe(1);
    expect(await countEq(
      'staging.source_record_versions', 'external_record_id', OMITTED_RECORD,
    )).toBe(1);

    // Unchanged content proposes nothing, even across a reappearance.
    expect(result.counters.candidatesCreated).toBe(0);
    expect(result.counters.candidatesRefreshed).toBe(0);
  });

  it('keeps A -> B -> A as three ordered versions over two payloads', async () => {
    const corrected = await runSettle(
      buildBundle({ includeOmitted: true, matchPayloadOver: { away_points: 70, margin: 62 } }),
      true, T.corrected,
    );
    expect(corrected.counters.versionsAppended).toBe(1);
    expect(corrected.counters.payloadsCreated).toBe(1);
    expect(corrected.counters.payloadsReused).toBe(0);
    expect((await spineRow('match', MATCH_RECORD))?.currentVersionSeq).toBe(2);
    // The pending candidates were refreshed in place under the partial unique
    // index, not duplicated.
    expect(corrected.counters.candidatesRefreshed).toBe(2);
    expect(corrected.counters.candidatesCreated).toBe(0);

    const restored = await runSettle(buildBundle({ includeOmitted: true }), true, T.restored);
    expect(restored.counters.versionsAppended).toBe(1);
    // The first payload is already stored, so the third state reuses it.
    expect(restored.counters.payloadsCreated).toBe(0);
    expect(restored.counters.payloadsReused).toBe(1);
    expect((await spineRow('match', MATCH_RECORD))?.currentVersionSeq).toBe(3);

    const versions = await sql<{ versionSeq: number; payloadHash: string; closed: boolean }[]>`
      SELECT version_seq AS "versionSeq", payload_hash AS "payloadHash",
             (observed_to IS NOT NULL) AS closed
        FROM staging.source_record_versions
       WHERE source_id = ${fixtures.sourceId} AND family = 'match'
         AND external_record_id = ${MATCH_RECORD}
       ORDER BY version_seq
    `;
    expect(versions.map((v) => v.versionSeq)).toEqual([1, 2, 3]);
    expect(versions.map((v) => v.closed)).toEqual([true, true, false]);
    expect(versions[0].payloadHash).toBe(versions[2].payloadHash);
    expect(versions[1].payloadHash).not.toBe(versions[0].payloadHash);

    // The projection names the open version, and there is still exactly one
    // projection row for the record: it was replaced, never re-inserted.
    const [projection] = await sql<{ versionSeq: number }[]>`
      SELECT version_seq AS "versionSeq" FROM staging.afltables_match
       WHERE external_record_id = ${MATCH_RECORD}
    `;
    expect(projection.versionSeq).toBe(3);

    // Two payload rows for three states: content is deduplicated, history is
    // not.
    const [distinct] = await sql<{ n: number }[]>`
      SELECT count(DISTINCT payload_hash)::int AS n
        FROM staging.source_record_versions
       WHERE source_id = ${fixtures.sourceId} AND family = 'match'
         AND external_record_id = ${MATCH_RECORD}
    `;
    expect(distinct.n).toBe(2);
  });

  /* ---------------------------------------------------------------- *
   * T7 — the data_issues disagreement lifecycle (§13)
   * ---------------------------------------------------------------- */

  describe('the data_issues disagreement lifecycle', () => {
    const disagreeBundle = (over: Record<string, JsonValue> = {}) => buildBundle({
      includeOmitted: true, includeDisagreement: true, disagreePayloadOver: over,
    });
    /**
     * The second payload state, reused so runs 3-5 are genuinely unchanged.
     * It moves EXISTING payload keys, the way the A -> B -> A case does, so
     * the family's hash recipe is certain to see the change.
     */
    const MOVED = { away_points: 70, margin: 62 };

    it('opens exactly one row for a genuine independent score disagreement', async () => {
      const result = await runSettle(disagreeBundle(), true, T.issueOpen);

      expect(result.counters.sourceDisagreement).toBe(1);
      expect(result.counters.dataIssuesOpened).toBe(1);
      expect(result.counters.dataIssuesRefreshed).toBe(0);
      expect(result.counters.dataIssuesResolved).toBe(0);

      const rows = await issueRows();
      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(row.issueType).toBe('source_disagreement');
      expect(row.issueKey).toBe(DISAGREE_ISSUE_KEY);
      expect(row.entityType).toBe('matches');
      // The dedicated canonical fixture match, named rather than left NULL.
      expect(row.entityId).toBe(fixtures.disagreeMatchId);
      // A score conflict on a completed match escalates past `warning`.
      expect(row.severity).toBe('error');
      expect(row.resolvedAt).toBeNull();
      expect(row.resolution).toBeNull();

      expect(row.details).toMatchObject({
        owner: 'AFLDB-ISSUE-099',
        source_key: 'afltables',
        family: 'match',
        external_record_id: DISAGREE_RECORD,
        target_table: 'matches',
        source_version_seq: 1,
        agreeing_groups: [],
        disagreeing_groups: ['squiggle'],
        conflicts: [{ field: 'home_score', afltables: 132, squiggle: 130 }],
      });

      // The counters the CLI prints are the counters the batch stored (§23.2).
      const [batch] = await sql<{ validationResult: Record<string, number> }[]>`
        SELECT validation_result AS "validationResult"
          FROM import_batches WHERE id = ${result.batchId}
      `;
      expect(batch.validationResult.dataIssuesOpened).toBe(1);
      expect(batch.validationResult.dataIssuesRefreshed).toBe(0);
      expect(batch.validationResult.dataIssuesResolved).toBe(0);
    });

    it('refreshes the SAME row when the disagreement recurs, keeping detected_at', async () => {
      const [before] = await issueRows();

      const result = await runSettle(disagreeBundle(MOVED), true, T.issueRefresh);
      expect(result.counters.dataIssuesOpened).toBe(0);
      expect(result.counters.dataIssuesRefreshed).toBe(1);
      expect(result.counters.dataIssuesResolved).toBe(0);

      const rows = await issueRows();
      // SC4: no second open row. The partial unique index makes one
      // unrepresentable, and this proves the writer relies on it.
      expect(rows).toHaveLength(1);
      const [after] = rows;
      expect(after.id).toBe(before.id);
      expect(after.detectedAt).toBe(before.detectedAt);
      expect(after.resolvedAt).toBeNull();
      expect(after.entityId).toBe(fixtures.disagreeMatchId);
      expect(after.severity).toBe('error');
      // The evidence is current: the version moved with the payload.
      expect(before.details.source_version_seq).toBe(1);
      expect(after.details.source_version_seq).toBe(2);
      expect(after.description).toBe(before.description);
    });

    it('resolves on positive agreement even though the AFL Tables payload did not move',
      async () => {
        const [before] = await issueRows();
        // Only the OTHER provider moves. AFL Tables replays byte-identical
        // evidence, so `reconcile()` returns `unchanged` at step 3 and never
        // reaches corroboration — the resolution below can only come from
        // T7's own re-evaluation.
        await setProviderScore(132, 69);

        const result = await runSettle(disagreeBundle(MOVED), true, T.issueResolve);
        expect(result.counters.observationsUnchanged).toBeGreaterThan(0);
        expect(result.counters.versionsAppended).toBe(0);
        expect(result.counters.sourceDisagreement).toBe(0);
        expect(result.counters.dataIssuesOpened).toBe(0);
        expect(result.counters.dataIssuesRefreshed).toBe(0);
        expect(result.counters.dataIssuesResolved).toBe(1);

        const rows = await issueRows();
        // UPDATE, never DELETE: the finding survives as history.
        expect(rows).toHaveLength(1);
        const [after] = rows;
        expect(after.id).toBe(before.id);
        expect(after.detectedAt).toBe(before.detectedAt);
        expect(after.resolvedAt).not.toBeNull();
        expect(after.resolution).toBe('source_agreement_restored');
      });

    it('does not resolve an already-resolved row a second time', async () => {
      const before = await issueRows();

      const result = await runSettle(disagreeBundle(MOVED), true, T.issueRerun);
      expect(result.counters.dataIssuesOpened).toBe(0);
      expect(result.counters.dataIssuesRefreshed).toBe(0);
      // Counted from the rows PostgreSQL actually updated, and the row is no
      // longer open, so there is nothing to update.
      expect(result.counters.dataIssuesResolved).toBe(0);

      expect(await issueRows()).toEqual(before);
    });

    it('never resolves an open row another writer owns', async () => {
      // The SAME key ISSUE-099 is about to re-prove, so only the ownership
      // predicate can be what saves it. Representable only because the owned
      // row is already resolved: the partial unique index covers open rows.
      await sql`
        INSERT INTO data_issues (
          entity_type, entity_id, issue_type, issue_key, severity, description, details
        ) VALUES (
          'matches', ${fixtures.disagreeMatchId}, 'source_disagreement',
          ${DISAGREE_ISSUE_KEY}, 'warning'::issue_severity,
          'A finding belonging to another writer.',
          ${sql.json({ owner: FOREIGN_ISSUE_OWNER } as never)}
        )
      `;

      const result = await runSettle(disagreeBundle(MOVED), true, T.issueForeign);
      // The key WAS positively re-proved this run; only the owner stopped it.
      expect(result.counters.dataIssuesResolved).toBe(0);
      expect(result.counters.dataIssuesOpened).toBe(0);
      expect(result.counters.dataIssuesRefreshed).toBe(0);

      const [foreign] = await sql<{
        resolvedAt: string | null; resolution: string | null;
        details: Record<string, JsonValue>;
      }[]>`
        SELECT resolved_at::text AS "resolvedAt", resolution, details
          FROM data_issues
         WHERE issue_key = ${DISAGREE_ISSUE_KEY} AND details->>'owner' = ${FOREIGN_ISSUE_OWNER}
      `;
      expect(foreign.resolvedAt).toBeNull();
      expect(foreign.resolution).toBeNull();
      expect(foreign.details.owner).toBe(FOREIGN_ISSUE_OWNER);

      // Harness teardown of a harness-created row, so the later dry-run does
      // not upsert onto a foreign open row sharing this key. The settle path
      // itself issues no DELETE — see the O1 proof below.
      await sql`
        DELETE FROM data_issues
         WHERE issue_key = ${DISAGREE_ISSUE_KEY} AND details->>'owner' = ${FOREIGN_ISSUE_OWNER}
      `;
    });
  });

  it('leaves every ISSUE-099-owned relation byte-identical after a --dry-run', async () => {
    // Arranged so the dry-run genuinely WANTS to write: the provider
    // disagrees again and the payload moves, so this run would append a
    // version, refresh candidates and INSERT a fresh open data_issues row
    // (the earlier one is resolved, so the partial unique index does not
    // block it). Every one of those must vanish with the rollback.
    await setProviderScore(130, 69);
    const before = await issue099Snapshot();
    const result = await runSettle(
      buildBundle({
        includeOmitted: true, includeDisagreement: true,
        disagreePayloadOver: { away_points: 71, margin: 61 },
      }),
      false, T.dryRunLast,
    );
    const after = await issue099Snapshot();

    expect(result.applied).toBe(false);
    expect(result.batchId).toBeNull();
    // The write path really did run, so the invariance below is not vacuous.
    expect(result.counters.dataIssuesOpened).toBe(1);
    expect(result.counters.versionsAppended).toBe(1);
    expect(after).toBe(before);
  });

  /* ---------------------------------------------------------------- *
   * O1 — no DELETE and no TRUNCATE against either 076 projection
   * ---------------------------------------------------------------- */

  describe('obligation O1', () => {
    /**
     * The SQL the settle modules actually SEND.
     *
     * postgres.js issues SQL only through tagged templates, so the executable
     * statements are exactly the template bodies. Extracting them excludes
     * every line of prose, which a whole-file grep cannot do: correct prose
     * naming the forbidden keywords would otherwise have to be contorted, and
     * a comment could create a false positive.
     */
    function executableStatements(source: string): string[] {
      const statements: string[] = [];
      for (const match of source.matchAll(/\b(?:tx|sql)(?:<[\s\S]*?>)?`([^`]*)`/g)) {
        const body = match[1]
          .replace(/\$\{[^}]*\}/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (body) statements.push(body);
      }
      return statements;
    }

    const settleSource = readFileSync('src/lib/acquisition/settle-afltables.ts', 'utf8');
    const storeSource = readFileSync('src/lib/acquisition/observation-store.ts', 'utf8');
    const cliSource = readFileSync('tools/current-season/settle-afltables.ts', 'utf8');
    const statements = [
      ...executableStatements(settleSource),
      ...executableStatements(storeSource),
      ...executableStatements(cliSource),
    ];

    it('extracts the real statement set, so the proof below is not vacuous', () => {
      expect(statements.length).toBeGreaterThanOrEqual(20);
      // Positive control: the extraction found the writes it must cover.
      expect(statements.some((s) => s.includes('INSERT INTO staging.afltables_match'))).toBe(true);
      expect(statements.some((s) => s.includes('INSERT INTO staging.afltables_player_match'))).toBe(true);
      expect(statements.some((s) => s.includes('INSERT INTO promotion_candidates'))).toBe(true);
      expect(statements.some((s) => s.includes('INSERT INTO staging.source_record_versions'))).toBe(true);
      // Every extracted body is a statement, not prose.
      for (const statement of statements) {
        expect(statement).toMatch(/^(SELECT|INSERT|UPDATE|WITH)\b/i);
      }
    });

    it('sends no DELETE and no TRUNCATE at all', () => {
      for (const statement of statements) {
        expect(statement).not.toMatch(/\bDELETE\s+FROM\b/i);
        expect(statement).not.toMatch(/\bTRUNCATE\b/i);
      }
      // Both projections are maintained by upsert alone.
      expect(statements.filter((s) => /INSERT INTO staging\.afltables_match\b/i.test(s))
        .every((s) => /ON CONFLICT .* DO UPDATE SET/i.test(s))).toBe(true);
      expect(statements.filter((s) => /INSERT INTO staging\.afltables_player_match\b/i.test(s))
        .every((s) => /ON CONFLICT .* DO UPDATE SET/i.test(s))).toBe(true);
    });

    it('left both projection sentinels in place across every run', async () => {
      // Neither sentinel is named by any bundle. A TRUNCATE, or any DELETE
      // not scoped to the record it was replacing, would have removed them.
      const [match] = await sql<{ n: number; batchId: ImportBatchId }[]>`
        SELECT count(*)::int AS n, max(projected_by_batch_id) AS "batchId"
          FROM staging.afltables_match WHERE external_record_id = ${SENTINEL_MATCH}
      `;
      expect(match.n).toBe(1);
      // Still the FIXTURE batch: no settle run rewrote it either.
      expect(match.batchId).toBe(fixtures.batchId);

      const [player] = await sql<{ n: number; batchId: ImportBatchId }[]>`
        SELECT count(*)::int AS n, max(projected_by_batch_id) AS "batchId"
          FROM staging.afltables_player_match WHERE external_record_id = ${SENTINEL_PLAYER}
      `;
      expect(player.n).toBe(1);
      expect(player.batchId).toBe(fixtures.batchId);
    });
  });

  /* ---------------------------------------------------------------- *
   * §15 — v1 writes no canonical fact row
   * ---------------------------------------------------------------- */

  /**
   * T8 defect D2, against PostgreSQL rather than the pure predicate.
   *
   * The first real apply persisted 803 pending `brownlow_round_votes /
   * unresolved_identity` candidates from a snapshot in which every one of 9522
   * `Brownlow.Votes` observations was NA — one for each record whose player URL
   * was not linked in that database. Nothing in this file reproduced it,
   * because the fixture player always resolved, so the old guard always fired.
   *
   * This is that exact combination: valid source identity, no local link, NA
   * vote. `brownlow_round_votes` must not exist for it at all — no candidate,
   * no rejection, no projection, no canonical row and no invented vote value.
   */
  it('opens no Brownlow target for an unlinked player with an NA vote (D2)', async () => {
    // The premise, asserted rather than assumed: this URL is real source
    // identity that resolves to nobody here.
    expect(await countEq('external_identities', 'external_id', UNLINKED_PLAYER_URL)).toBe(0);

    const result = await runSettle(unlinkedPlayerBundle(), true, T.unlinked);

    // Present in full (§19): the observation is kept whatever identity did.
    expect(result.counters.observationsSeen).toBe(1);
    expect(result.counters.versionsAppended).toBe(1);
    expect((await spineRow('player_match_stats', UNLINKED_PLAYER_RECORD))?.absentSince)
      .toBeNull();

    // Identity failed, so nothing was projected...
    expect(result.counters.unresolvedIdentityPlayer).toBe(1);
    expect(result.counters.projectionRowsWritten).toBe(0);
    expect(await countEq(
      'staging.afltables_player_match', 'external_record_id', UNLINKED_PLAYER_RECORD,
    )).toBe(0);

    // ...and exactly ONE target was proposed. Before the fix this was two: the
    // Brownlow target rode in on the identity failure.
    expect(result.counters.candidatesCreated).toBe(1);
    const candidates = await sql<{ targetTable: string; verb: string; status: string }[]>`
      SELECT target_table AS "targetTable", verb::text AS verb, status::text AS status
        FROM promotion_candidates
       WHERE external_record_id = ${UNLINKED_PLAYER_RECORD}
       ORDER BY target_table
    `;
    expect([...candidates]).toEqual([
      { targetTable: 'player_match_stats', verb: 'unresolved_identity', status: 'pending' },
    ]);

    // One rejection, for the target that genuinely exists. `reason` is
    // prefixed with the target table, so this is per-target and not merely
    // per-record.
    const rejections = await sql<{ reason: string }[]>`
      SELECT reason FROM import_rejections
       WHERE source_record_id = ${UNLINKED_PLAYER_RECORD}
    `;
    expect(rejections.length).toBe(1);
    expect(rejections[0].reason.startsWith('player_match_stats:')).toBe(true);
    expect(rejections.some((row) => row.reason.startsWith('brownlow_round_votes:'))).toBe(false);

    // No vote value was invented anywhere — not a 0, not a NULL filler row.
    // `runSettle()` already bracketed all four canonical fact tables around
    // this run; this says it of the vote table by name.
    const [votes] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM brownlow_round_votes WHERE season = ${SEASON}
    `;
    expect(votes.n).toBe(0);
    expect(result.counters.canonicalRowsInserted).toBe(0);
    expect(result.counters.canonicalRowsUpdated).toBe(0);

    // A published 0 IS a real vote, so for the SAME unlinked player the
    // Brownlow target now exists and is proposed — the count has happened.
    // The payload has to move with it, or `reconcile()` answers `unchanged`
    // and never reaches a target at all. Dry-run, so the distinction is proved
    // without committing a second observation of this record.
    const zero = await runSettle(
      unlinkedPlayerBundle({
        payload: { brownlow_votes: 0 },
        projection: { brownlow_round_vote: { season: SEASON, round_number: 1, votes: 0 } },
      }),
      false,
      T.unlinkedZero,
    );
    // Two targets, not one. Split between created and refreshed because
    // `player_match_stats` already has a pending candidate from the apply
    // above, and which upsert branch each takes is not the point here.
    expect(zero.counters.candidatesCreated + zero.counters.candidatesRefreshed).toBe(2);
  });

  it('wrote no canonical fact row in any settle transaction (§15)', async () => {
    // Row counts are unchanged across the whole suite, which covers inserts
    // and deletes.
    expect(await canonicalCounts()).toEqual(canonicalBaseline);

    // And no surviving tuple in any canonical fact table was written by one
    // of the settle transactions. Each xid was read back from the
    // import_batches row that transaction inserted, so this is the real
    // transaction identity rather than a time window. An UPDATE writes a new
    // tuple version carrying the updating xid, so this covers updates too.
    expect(settleXids.length).toBeGreaterThanOrEqual(5);
    for (const table of CANONICAL_FACT_TABLES) {
      const [row] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM ${sql(table)} WHERE xmin::text = ANY(${settleXids})
      `;
      expect({ table, written: row.n }).toEqual({ table, written: 0 });
    }
  });

  /* ---------------------------------------------------------------- *
   * Restricted importer role
   * ---------------------------------------------------------------- */

  it.skipIf(!importRole.isConfigured)(
    `executes the whole write path under the restricted afldb_import role${roleParitySuffix}`,
    async () => {
      await importRole.validate();

      const restricted = importRole.connect();
      try {
        // A dry run under the restricted role executes every statement the
        // apply would — the same inserts, the same upserts, the same grants —
        // and then rolls back, so parity is proven without committing a
        // second set of rows.
        const result = await runSettleAfltables(restricted, {
          bundle: buildBundle({ includeOmitted: true }),
          registry,
          apply: false,
          manualAuthority: UNAVAILABLE_MANUAL_AUTHORITY,
          observedAt: T.parity,
        });
        expect(result.applied).toBe(false);
        expect(result.counters.canonicalRowsInserted).toBe(0);
        expect(result.counters.canonicalRowsUpdated).toBe(0);
        expect(result.counters.observationsSeen).toBe(4);
      } finally {
        await restricted.end({ timeout: 5 });
      }
    },
  );
});
