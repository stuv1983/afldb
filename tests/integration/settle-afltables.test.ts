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

import { createHash } from 'node:crypto';
import {
  copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  checkAdmitsExactly,
  loadManualAuthority,
  MANUAL_ATTENDANCE_SOURCE_KEY,
  UNREPRESENTABLE_OVERRIDE_ENTITIES,
} from '@/lib/acquisition/manual-authority';
import { persistSourceObservation } from '@/lib/acquisition/observation-store';
import {
  UNAVAILABLE_MANUAL_AUTHORITY,
  type JsonValue,
  type ManualAuthorityProvider,
} from '@/lib/acquisition/observations';
import {
  canonicalApplyIssueKey,
  CANONICAL_APPLY_ISSUE_TYPE,
  runSettleAfltables,
  settleIssueKey,
  SETTLE_ISSUE_TYPE,
  validateSettleBundle,
  type SettleBundle,
  type SettleRunResult,
} from '@/lib/acquisition/settle-afltables';
import {
  getSourceFamily,
  parseSourceFamilyRegistry,
} from '@/lib/acquisition/source-families';
import { buildSettleExceptionReport } from '@/lib/acquisition/settle-report';
import { asImportBatchId, type ImportBatchId } from '@/lib/import-batch-id';

import {
  runSettleCli,
  type SettleCliOutcome,
} from '../../tools/current-season/settle-afltables';

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
  // AFLDB-ISSUE-122 S2. This suite's own human-override fixtures, on its own
  // namespaced keys — before `matches`, and never wider than the prefix.
  await client`
    DELETE FROM data_overrides
     WHERE entity_type = 'matches' AND entity_key LIKE ${`${PREFIX}%`}
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

      /*
       * AMENDED by AFLDB-ISSUE-122 S4 (§10). `afltables`/`match` now declares
       * `corroboration_policy: "advisory"`, so a disagreeing Squiggle no
       * longer VETOES the proposal — `sourceDisagreement` counts refusals, and
       * there is none. Everything else this test proved is unchanged and is
       * still asserted below: the finding is opened, deduplicated, keyed,
       * attributed and detailed exactly as before, because the settle writer
       * opens it from the corroboration REPORT and not from the refusal verb.
       *
       * The candidate the reviewer sees is now the proposal itself rather than
       * a `source_disagreement` refusal, which is the point of decision 5: a
       * source being retired cannot block the source replacing it, and its
       * agreement is never a prerequisite.
       */
      expect(result.counters.sourceDisagreement).toBe(0);
      const disagreeCandidates = (await candidateRows())
        .filter((row) => row.externalRecordId === DISAGREE_RECORD
          && row.targetTable === 'matches');
      expect(disagreeCandidates).toHaveLength(1);
      expect(disagreeCandidates[0].verb).not.toBe('source_disagreement');

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


/* ================================================================== *
 * AFLDB-ISSUE-122 S2 — the manual-authority provider against PostgreSQL
 * ================================================================== */

/**
 * The DB-free truth table lives in `tests/current-season-import.test.ts`. What
 * needs a real database is narrower and is exactly what is proved here: that
 * an ACTIVE `data_overrides` row refuses authority over the fields it covers,
 * that the live migration-073 CHECK still makes an override for the three
 * source-owned targets unrepresentable, and that a manually-cited attendance
 * figure refuses on provenance alone.
 *
 * Nothing here writes a canonical fact row. The one canonical column it moves
 * — `attendance_source_id` on this suite's own fixture match — is restored in
 * a `finally`, and every override row it creates is namespaced and removed.
 */
describe('AFLDB-ISSUE-122 §8 — manual authority read from data_overrides', () => {
  let adminUserId = 0;
  let createdAdmin = false;
  let manualSourceId = 0;
  let createdManualSource = false;

  beforeAll(async () => {
    const [existingAdmin] = await sql<{ id: number }[]>`
      SELECT id::int AS id FROM auth_users ORDER BY id LIMIT 1
    `;
    if (existingAdmin) {
      adminUserId = existingAdmin.id;
    } else {
      const [created] = await sql<{ id: number }[]>`
        INSERT INTO auth_users (email, role)
        VALUES ('issue122-authority-test@example.test', 'admin')
        RETURNING id::int AS id
      `;
      adminUserId = created.id;
      createdAdmin = true;
    }

    // Shared reference data, on the same terms as the sources rows above: a
    // pre-existing row is borrowed and left exactly as found.
    const [existingSource] = await sql<{ id: number }[]>`
      SELECT id::int AS id FROM sources WHERE key = ${MANUAL_ATTENDANCE_SOURCE_KEY}
    `;
    if (existingSource) {
      manualSourceId = existingSource.id;
    } else {
      const [created] = await sql<{ id: number }[]>`
        INSERT INTO sources (key, name, kind)
        VALUES (${MANUAL_ATTENDANCE_SOURCE_KEY}, 'Manual admin edit', 'manual')
        RETURNING id::int AS id
      `;
      manualSourceId = created.id;
      createdManualSource = true;
    }
  });

  afterAll(async () => {
    await sql`
      DELETE FROM data_overrides
       WHERE entity_type = 'matches' AND entity_key LIKE ${`${PREFIX}%`}
    `;
    if (createdManualSource) {
      await sql`DELETE FROM sources WHERE id = ${manualSourceId}`;
    }
    if (createdAdmin) {
      await sql`DELETE FROM auth_users WHERE id = ${adminUserId}`;
    }
  });

  it('refuses a score proposal covered by an active override, and only that group', async () => {
    await sql`
      INSERT INTO data_overrides (
        entity_type, entity_key, field_group, override_values, admin_user_id, is_active
      ) VALUES (
        'matches', ${DISAGREE_MATCH_KEY}, 'score',
        ${sql.json({ home_goals: 21 })}, ${adminUserId}, true
      )
      ON CONFLICT (entity_type, entity_key, field_group) DO UPDATE
        SET is_active = true, override_values = EXCLUDED.override_values
    `;

    const authority = await loadManualAuthority(sql, SEASON);

    // The human decided the score. This source may not move it.
    expect(authority({
      entity: 'matches',
      targetKey: { match_key: DISAGREE_MATCH_KEY },
      fields: ['home_goals', 'home_behinds', 'home_score'],
    })).toBe('conflict');

    // A different field group on the same match carries no decision.
    expect(authority({
      entity: 'matches',
      targetKey: { match_key: DISAGREE_MATCH_KEY },
      fields: ['match_time'],
    })).toBe('clear');

    // Neither does a different match.
    expect(authority({
      entity: 'matches',
      targetKey: { match_key: MATCH_KEY },
      fields: ['home_goals'],
    })).toBe('clear');
  });

  it('stops refusing once the override is deactivated', async () => {
    await sql`
      UPDATE data_overrides SET is_active = false
       WHERE entity_type = 'matches' AND entity_key = ${DISAGREE_MATCH_KEY}
         AND field_group = 'score'
    `;
    const authority = await loadManualAuthority(sql, SEASON);
    expect(authority({
      entity: 'matches',
      targetKey: { match_key: DISAGREE_MATCH_KEY },
      fields: ['home_goals'],
    })).toBe('clear');
  });

  it('refuses attendance cited to manual_admin_edit, on provenance alone', async () => {
    const [before] = await sql<{ sourceId: number }[]>`
      SELECT attendance_source_id::int AS "sourceId"
        FROM matches WHERE match_key = ${DISAGREE_MATCH_KEY}
    `;
    try {
      await sql`
        UPDATE matches SET attendance_source_id = ${manualSourceId}
         WHERE match_key = ${DISAGREE_MATCH_KEY}
      `;
      const authority = await loadManualAuthority(sql, SEASON);
      expect(authority({
        entity: 'matches',
        targetKey: { match_key: DISAGREE_MATCH_KEY },
        fields: ['attendance', 'attendance_status'],
      })).toBe('conflict');
      // Only attendance. The rest of the proposal is not implicated.
      expect(authority({
        entity: 'matches',
        targetKey: { match_key: DISAGREE_MATCH_KEY },
        fields: ['home_goals'],
      })).toBe('clear');
    } finally {
      await sql`
        UPDATE matches SET attendance_source_id = ${before.sourceId}
         WHERE match_key = ${DISAGREE_MATCH_KEY}
      `;
    }
  });

  it('proves from the live CHECK that the three source-owned targets are clear', async () => {
    // The proof, not the assumption: this reads the constraint PostgreSQL is
    // actually enforcing right now.
    const [check] = await sql<{ def: string }[]>`
      SELECT pg_get_constraintdef(c.oid) AS def
        FROM pg_constraint c
       WHERE c.conrelid = 'public.data_overrides'::regclass
         AND c.contype = 'c'
         AND pg_get_constraintdef(c.oid) LIKE '%entity_type%'
    `;
    expect(checkAdmitsExactly([check.def])).toBe(true);

    // And the database refuses to store one, which is what makes it a proof.
    await expect(sql`
      INSERT INTO data_overrides (
        entity_type, entity_key, field_group, override_values, admin_user_id
      ) VALUES (
        'player_match_stats', ${`${PREFIX}unrepresentable`}, 'stats',
        ${sql.json({ goals: 3 })}, ${adminUserId}
      )
    `).rejects.toThrow();

    const authority = await loadManualAuthority(sql, SEASON);
    for (const entity of UNREPRESENTABLE_OVERRIDE_ENTITIES) {
      expect(authority({ entity, targetKey: { match_id: 1 }, fields: ['goals'] }))
        .toBe('clear');
    }
  });

  it('refuses everything when the authority state cannot be read', async () => {
    const broken = postgres(process.env.AFLDB_TEST_DATABASE_URL as string, {
      max: 1,
      onnotice: () => {},
      transform: { undefined: null },
    });
    try {
      // A closed connection is an unreadable authority record, not an absent
      // one, so every question refuses.
      await broken.end({ timeout: 5 });
      const authority = await loadManualAuthority(broken, SEASON);
      expect(authority({
        entity: 'matches',
        targetKey: { match_key: DISAGREE_MATCH_KEY },
        fields: ['home_goals'],
      })).toBe('indeterminate');
      expect(authority({
        entity: 'player_match_stats', targetKey: { match_id: 1 }, fields: ['goals'],
      })).toBe('indeterminate');
    } finally {
      await broken.end({ timeout: 5 });
    }
  });
});


/* ================================================================== *
 * AFLDB-ISSUE-122 S5 — the canonical applier against PostgreSQL
 *
 * This is the suite that proves ISSUE-099's §15 prohibition has been
 * deliberately superseded for AFL Tables current-season data, and that
 * everything it protected is still protected.
 *
 * **It writes canonical fact rows on purpose.** That is the whole point: the
 * ISSUE-099 suite above proves settle writes none with `autoApply` off, and
 * this one proves what happens with it on. Every row it writes is namespaced
 * — season **2093**, the `issue122-` external-record-id prefix, its own
 * players and its own match keys — and every one is removed in `afterAll`.
 * It runs AFTER the §15 count and xid proofs, and it uses its own run helper
 * rather than `runSettle()`, whose bracketed zero-canonical assertions are
 * correct for the automatic path being OFF and would be wrong here.
 *
 * 2093 appears in no other test. Two REAL historical club identities are read
 * and never written, and no venue is mapped, so `venue_id` stays NULL with the
 * real `venue_raw` — §7.3's designed outcome for this path.
 *
 * @see issues/open/AFLDB-ISSUE-122.md §5, §6, §7, §9, §12, §13, §17
 * @see src/lib/acquisition/canonical-apply.ts
 * ================================================================== */

const SEASON122 = 2093;
const PREFIX122 = 'issue122-';
const LABEL122 = 'issue122-apply-test';
const SLUG122 = 'issue122-';

const SCOPE122 = 'issue122-main';
const SCOPE_FOREIGN = 'issue122-foreign';
const SCOPE_SOURCELESS = 'issue122-sourceless';
const SCOPE_BROKEN = 'issue122-broken';

const MATCH_A = 'issue122-match-a';
const KEY_A = 'issue122-key-a';
const MATCH_FOREIGN = 'issue122-match-foreign';
const KEY_FOREIGN = 'issue122-key-foreign';
const MATCH_SOURCELESS = 'issue122-match-sourceless';
const KEY_SOURCELESS = 'issue122-key-sourceless';
const MATCH_BROKEN = 'issue122-match-broken';
const KEY_BROKEN = 'issue122-key-broken';
const MATCH_OK = 'issue122-match-ok';
const KEY_OK = 'issue122-key-ok';

const LINKED_RECORD = 'issue122-player-linked';
const LINKED_URL = 'issue122-players/L/Issue122_Linked.html';
const DEBUT_RECORD = 'issue122-player-debut';
const DEBUT_URL = 'issue122-players/D/Issue122_Debut.html';

const VENUE_RAW122 = 'ISSUE-122 Unmapped Ground';
const PROVIDER_GAME_122 = 'issue122-squiggle-a';

/** Ordered observation times, one per run, strictly increasing. */
const T122 = {
  dryRun: '2093-04-05T00:00:00Z',
  applyFirst: '2093-04-06T00:00:00Z',
  rerun: '2093-04-07T00:00:00Z',
  correction: '2093-04-08T00:00:00Z',
  revert: '2093-04-09T00:00:00Z',
  retry: '2093-04-10T00:00:00Z',
  brownlow: '2093-04-11T00:00:00Z',
  overrideBlocked: '2093-04-12T00:00:00Z',
  overrideCleared: '2093-04-13T00:00:00Z',
  foreign: '2093-04-14T00:00:00Z',
  sourceless: '2093-04-15T00:00:00Z',
  broken: '2093-04-16T00:00:00Z',
  advisory: '2093-04-17T00:00:00Z',
} as const;

type Ids122 = {
  linkedPlayerId: number;
  debutPlayerId: number;
  adminUserId: number;
};

let ids122: Ids122;
let createdAdmin122 = false;

/* -- fixtures ------------------------------------------------------- */

function payload122(over: Record<string, JsonValue> = {}): JsonValue {
  return {
    issue122_fixture: true,
    season: SEASON122,
    round_code: '1',
    match_date: '2093-04-04',
    home_team_raw: 'Issue122 Home',
    away_team_raw: 'Issue122 Away',
    home_goals: 15, home_behinds: 10, home_points: 100,
    away_goals: 10, away_behinds: 12, away_points: 72,
    margin: 28,
    ...over,
  };
}

/**
 * The `matches` + `match_period_scores` proposal. Every arithmetic identity
 * the canonical CHECK constraints enforce holds: 6*15+10 = 100, 6*10+12 = 72,
 * |100-72| = 28, and each quarter reconciles the same way.
 */
function projection122(
  matchKey: string, over: Record<string, JsonValue> = {},
): JsonValue {
  return {
    match_key: matchKey,
    season: SEASON122,
    round_code: '1',
    round_number: 1,
    round_type: 'home_and_away',
    is_final: false,
    match_date: '2093-04-04',
    match_time: '3:20 PM',
    // Mapped by no venue, on purpose (§7.3): venue_id stays NULL and
    // venue_raw carries the real string. No venues row is ever created.
    venue_raw: VENUE_RAW122,
    home_club_hist: fixtures.homeClubHist,
    away_club_hist: fixtures.awayClubHist,
    home_goals: 15, home_behinds: 10, home_score: 100,
    away_goals: 10, away_behinds: 12, away_score: 72,
    result: 'home_win', winner_club_hist: fixtures.homeClubHist, margin: 28,
    attendance: 31000, attendance_status: 'complete', attendance_source_key: 'afltables',
    period_scores: [
      { side: 'home', period: 1, goals: 3, behinds: 2, points: 20 },
      { side: 'away', period: 1, goals: 2, behinds: 3, points: 15 },
      { side: 'home', period: 2, goals: 7, behinds: 5, points: 47 },
      { side: 'away', period: 2, goals: 5, behinds: 6, points: 36 },
    ],
    ...over,
  };
}

function playerPayload122(url: string, over: Record<string, JsonValue> = {}): JsonValue {
  return {
    issue122_fixture: true,
    url,
    match_key: KEY_A,
    season: SEASON122,
    round_code: '1',
    playing_for_raw: 'Issue122 Away',
    ...over,
  };
}

function statsWith(over: Record<string, JsonValue> = {}): JsonValue {
  const stats: Record<string, JsonValue> = {};
  for (const column of [
    'kicks', 'marks', 'handballs', 'disposals', 'goals', 'behinds', 'hitouts',
    'tackles', 'rebounds', 'inside_50s', 'clearances', 'clangers', 'frees_for',
    'frees_against', 'contested', 'uncontested', 'contested_marks',
    'marks_inside_50', 'one_percenters', 'bounces', 'goal_assists',
  ]) stats[column] = 5;
  // NA. AFL Tables publishes no votes until the count, so no
  // brownlow_round_votes target exists at all — never a zero, never a filler.
  stats.brownlow_votes = null;
  return { ...stats, ...over } as JsonValue;
}

function playerProjection122(url: string, over: Record<string, JsonValue> = {}): JsonValue {
  const stats = statsWith();
  return {
    url,
    afltables_id: null,
    match_key: KEY_A,
    season: SEASON122,
    round_code: '1',
    round_number: 1,
    is_final: false,
    club_hist: fixtures.awayClubHist,
    career_game_no: 12,
    jumper_number: '9',
    stats,
    brownlow_round_vote: null,
    ...over,
  };
}

type MatchSpec = {
  recordId: string;
  matchKey: string;
  scope: string;
  payloadOver?: Record<string, JsonValue>;
  projectionOver?: Record<string, JsonValue>;
};

type PlayerSpec = {
  recordId: string;
  url: string;
  payloadOver?: Record<string, JsonValue>;
  projectionOver?: Record<string, JsonValue>;
};

/**
 * A bundle over exactly the records a test names, enumerated in exactly the
 * scopes those records occupy.
 *
 * Every enumeration is `complete`, so each run sweeps its own scopes and only
 * its own: a test that names no player record enumerates no player scope, and
 * a scope this bundle never mentions can never be swept.
 */
function bundle122(spec: {
  matches?: readonly MatchSpec[];
  players?: readonly PlayerSpec[];
} = {}): SettleBundle {
  const matches = spec.matches
    ?? [{ recordId: MATCH_A, matchKey: KEY_A, scope: SCOPE122 }];
  const players = spec.players ?? [
    { recordId: LINKED_RECORD, url: LINKED_URL },
    { recordId: DEBUT_RECORD, url: DEBUT_URL },
  ];

  const records: JsonValue[] = [
    ...matches.map((match) => ({
      family: 'afltables.match',
      scope_key: match.scope,
      external_record_id: match.recordId,
      payload: payload122({ issue122_record: match.recordId, ...match.payloadOver }),
      observed_columns: [...(matchContract.knownColumns ?? [])],
      projection: projection122(match.matchKey, match.projectionOver),
      rejection: null,
    })),
    ...players.map((player) => ({
      family: 'afltables.player_match_stats',
      scope_key: SCOPE122,
      external_record_id: player.recordId,
      payload: playerPayload122(player.url, player.payloadOver),
      observed_columns: [...(playerContract.knownColumns ?? [])],
      projection: playerProjection122(player.url, player.projectionOver),
      rejection: null,
    })),
  ] as JsonValue[];

  const matchScopes = [...new Set(matches.map((match) => match.scope))];
  const enumerations: JsonValue[] = matchScopes.map((scope) => ({
    family: 'afltables.match',
    scope_key: scope,
    complete: true,
    incomplete_reason: null,
    external_record_ids: matches
      .filter((match) => match.scope === scope)
      .map((match) => match.recordId),
  }));
  if (players.length > 0) {
    enumerations.push({
      family: 'afltables.player_match_stats',
      scope_key: SCOPE122,
      complete: true,
      incomplete_reason: null,
      external_record_ids: players.map((player) => player.recordId),
    });
  }

  return validateSettleBundle({
    raw: {
      bundle_contract_version: 1,
      generated_by: 'tools/migration/import_fitzroy_core.py',
      snapshot_label: LABEL122,
      manifest_path: `docs/rebuild-manifests/afltables_fitzroy_core/${LABEL122}.json`,
      manifest_sha256: MANIFEST_SHA,
      acquisition_kind: 'in_season_partial',
      season: SEASON122,
      fitzroy_version: '1.8.0',
      enumerations,
      records,
      unkeyed_rejections: [],
      counts: {
        matches: matches.length,
        player_match_rows: players.length,
        rejections: 0,
        unkeyed_rejections: 0,
      },
    } as JsonValue,
    expectedSnapshotLabel: LABEL122,
    actualManifestSha256: MANIFEST_SHA,
    inProgressSeasons: [SEASON122],
    registry,
  });
}

/**
 * One settle run with the AUTOMATIC path on.
 *
 * `manualAuthorityLoader` defaults to the real `data_overrides`-backed
 * provider. A test may hand in a deliberately permissive one to prove the
 * applier does NOT trust the run-level snapshot — that is the S2 race S3/S4
 * recorded as binding on this stage, and the only honest way to prove the
 * re-read inside the savepoint is load-bearing.
 */
async function apply122(
  bundle: SettleBundle,
  observedAt: string,
  over: {
    apply?: boolean;
    autoApply?: boolean;
    manualAuthorityLoader?: (
      tx: postgres.TransactionSql,
    ) => Promise<ManualAuthorityProvider>;
  } = {},
): Promise<SettleRunResult> {
  return runSettleAfltables(sql, {
    bundle,
    registry,
    apply: over.apply ?? true,
    autoApply: over.autoApply ?? true,
    inProgressSeasons: [SEASON122],
    manualAuthority: UNAVAILABLE_MANUAL_AUTHORITY,
    manualAuthorityLoader: over.manualAuthorityLoader
      ?? ((tx) => loadManualAuthority(tx, SEASON122)),
    observedAt,
  });
}

/* -- readers -------------------------------------------------------- */

type MatchRow = {
  id: number; homeScore: number; awayScore: number; attendance: number | null;
  attendanceStatus: string; attendanceSourceId: number | null;
  venueId: number | null; venueRaw: string; roundNumber: number | null;
  sourceId: number | null; sourceRecordId: string | null; importBatchId: string | null;
};

async function matchRow122(matchKey: string): Promise<MatchRow | undefined> {
  const [row] = await sql<MatchRow[]>`
    SELECT id::int AS id, home_score AS "homeScore", away_score AS "awayScore",
           attendance, attendance_status AS "attendanceStatus",
           attendance_source_id::int AS "attendanceSourceId",
           venue_id::int AS "venueId", venue_raw AS "venueRaw",
           round_number::int AS "roundNumber",
           source_id::int AS "sourceId", source_record_id AS "sourceRecordId",
           import_batch_id::text AS "importBatchId"
      FROM matches WHERE match_key = ${matchKey}
  `;
  return row;
}

type LedgerRow = {
  family: string; externalRecordId: string; sourceVersionSeq: number;
  targetTable: string; targetKey: JsonValue; verb: string;
  previousValues: JsonValue | null; newValues: JsonValue;
  importBatchId: string; sourceId: number;
};

async function ledger122(): Promise<LedgerRow[]> {
  const rows = await sql<LedgerRow[]>`
    SELECT family, external_record_id AS "externalRecordId",
           source_version_seq AS "sourceVersionSeq", target_table AS "targetTable",
           target_key AS "targetKey", verb,
           previous_values AS "previousValues", new_values AS "newValues",
           import_batch_id::text AS "importBatchId", source_id::int AS "sourceId"
      FROM canonical_applications
     WHERE external_record_id LIKE ${`${PREFIX122}%`}
     ORDER BY id
  `;
  return [...rows];
}

type PeriodRow122 = {
  clubId: number; period: number; goals: number | null; behinds: number | null;
  points: number | null; sourceId: number | null; sourceRecordId: string | null;
};

async function periods122(matchId: number): Promise<PeriodRow122[]> {
  const rows = await sql<PeriodRow122[]>`
    SELECT club_id::int AS "clubId", period::int AS period, goals, behinds, points,
           source_id::int AS "sourceId", source_record_id AS "sourceRecordId"
      FROM match_period_scores WHERE match_id = ${matchId}
     ORDER BY club_id, period
  `;
  return [...rows];
}

type StatsRow122 = {
  matchId: number; clubId: number; kicks: number | null; careerGameNo: number | null;
  jumperNumber: string | null; brownlowVotes: number | null;
  sourceId: number | null; sourceRecordId: string | null;
};

async function stats122(playerId: number): Promise<StatsRow122[]> {
  const rows = await sql<StatsRow122[]>`
    SELECT match_id::int AS "matchId", club_id::int AS "clubId", kicks,
           career_game_no::int AS "careerGameNo", jumper_number AS "jumperNumber",
           brownlow_votes::int AS "brownlowVotes",
           source_id::int AS "sourceId", source_record_id AS "sourceRecordId"
      FROM player_match_stats WHERE player_id = ${playerId}
  `;
  return [...rows];
}

type VoteRow122 = {
  playerId: number; roundNumber: number; played: boolean; votes: number | null;
  sourceId: number | null; sourceRecordId: string | null;
};

async function votes122(): Promise<VoteRow122[]> {
  const rows = await sql<VoteRow122[]>`
    SELECT player_id::int AS "playerId", round_number::int AS "roundNumber",
           played, votes::int AS votes,
           source_id::int AS "sourceId", source_record_id AS "sourceRecordId"
      FROM brownlow_round_votes WHERE season = ${SEASON122}
     ORDER BY player_id, round_number
  `;
  return [...rows];
}

async function candidates122(): Promise<CandidateRow[]> {
  const rows = await sql<CandidateRow[]>`
    SELECT external_record_id AS "externalRecordId", target_table AS "targetTable",
           verb, status, source_version_seq AS "sourceVersionSeq",
           created_by_batch_id AS "createdByBatchId"
      FROM promotion_candidates
     WHERE external_record_id LIKE ${`${PREFIX122}%`}
  `;
  return [...rows].sort(byRecordThenTarget);
}

type IssueRow122 = {
  issueType: string; issueKey: string; entityType: string; severity: string;
  resolvedAt: string | null; details: Record<string, JsonValue>;
};

async function issues122(): Promise<IssueRow122[]> {
  const rows = await sql<IssueRow122[]>`
    SELECT issue_type AS "issueType", issue_key AS "issueKey",
           entity_type AS "entityType", severity::text AS severity,
           resolved_at::text AS "resolvedAt", details
      FROM data_issues WHERE issue_key LIKE ${`%${PREFIX122}%`}
     ORDER BY issue_key
  `;
  return [...rows];
}

/* -- cleanup -------------------------------------------------------- */

/**
 * Remove every row this suite can have committed, canonical rows included, in
 * dependency-safe order. Run as a pre-clean as well as teardown: an
 * interrupted earlier run leaves committed rows behind that `afterAll` alone
 * cannot undo.
 */
async function cleanup122(client: postgres.Sql): Promise<void> {
  const like = `${PREFIX122}%`;
  // Before import_batches and the spine it references.
  await client`DELETE FROM canonical_applications WHERE external_record_id LIKE ${like}`;
  await client`DELETE FROM staging.afltables_match WHERE external_record_id LIKE ${like}`;
  await client`DELETE FROM staging.afltables_player_match WHERE external_record_id LIKE ${like}`;
  await client`DELETE FROM promotion_candidates WHERE external_record_id LIKE ${like}`;
  await client`DELETE FROM import_rejections WHERE source_record_id LIKE ${like}`;
  await client`DELETE FROM data_issues WHERE issue_key LIKE ${`%${PREFIX122}%`}`;
  await client`
    DELETE FROM data_overrides WHERE entity_type = 'matches' AND entity_key LIKE ${like}
  `;
  await client`
    DELETE FROM staging.external_current_matches WHERE external_game_id LIKE ${like}
  `;
  // Canonical facts, children first. match_period_scores cascades from matches.
  await client`DELETE FROM brownlow_round_votes WHERE season = ${SEASON122}`;
  await client`
    DELETE FROM player_match_stats
     WHERE player_id IN (SELECT id FROM players WHERE slug LIKE ${`${SLUG122}%`})
  `;
  // S6: the derived rows the end-of-run recompute writes for this season and
  // for this suite's players. They reference seasons and players, so they go
  // before both. Every statement is a no-op when the recompute never ran.
  await client`DELETE FROM club_seasons WHERE season = ${SEASON122}`;
  for (const table of [
    'player_clubs', 'player_club_season_stats', 'player_season_stats', 'player_career_stats',
  ]) {
    await client`
      DELETE FROM ${client(table)}
       WHERE player_id IN (SELECT id FROM players WHERE slug LIKE ${`${SLUG122}%`})
    `;
  }
  await client`DELETE FROM matches WHERE match_key LIKE ${like}`;
  await client`DELETE FROM staging.source_records WHERE external_record_id LIKE ${like}`;
  await client`DELETE FROM staging.source_record_versions WHERE external_record_id LIKE ${like}`;
  await client`
    DELETE FROM staging.source_payloads WHERE raw_payload->>'issue122_fixture' IS NOT NULL
  `;
  await client`DELETE FROM external_identities WHERE external_id LIKE ${like}`;
  await client`DELETE FROM players WHERE slug LIKE ${`${SLUG122}%`}`;
  await client`DELETE FROM import_batches WHERE notes LIKE ${`%${LABEL122}%`}`;
  await client`DELETE FROM seasons WHERE year = ${SEASON122}`;
}

describe('AFLDB-ISSUE-122 S5 — the canonical applier', () => {
  beforeAll(async () => {
    await cleanup122(sql);

    await sql`
      INSERT INTO seasons (year, league, status)
      VALUES (${SEASON122}, 'AFL', 'in_progress'::season_status)
      ON CONFLICT (year) DO NOTHING
    `;

    // FAIL CLOSED. This suite creates every canonical row on its own keys; a
    // row already sitting on one is an unknown row, and adopting or
    // overwriting it would corrupt someone else's data.
    const collisions = await sql<{ matchKey: string }[]>`
      SELECT match_key AS "matchKey" FROM matches WHERE match_key LIKE ${`${PREFIX122}%`}
    `;
    if (collisions.length > 0) {
      throw new Error(
        `Refusing to run: matches rows already exist on ISSUE-122 fixture keys `
        + `(${collisions.map((row) => row.matchKey).join(', ')}). Remove them deliberately.`,
      );
    }

    const [linked] = await sql<{ id: number }[]>`
      INSERT INTO players (display_name, sort_name, search_name, slug)
      VALUES ('Issue122 Linked', 'Linked, Issue122', 'issue122 linked',
              ${`${SLUG122}linked`})
      RETURNING id::int AS id
    `;
    const [debut] = await sql<{ id: number }[]>`
      INSERT INTO players (display_name, sort_name, search_name, slug)
      VALUES ('Issue122 Debutant', 'Debutant, Issue122', 'issue122 debutant',
              ${`${SLUG122}debut`})
      RETURNING id::int AS id
    `;
    // ONLY the linked player has an identity mapping. The debutant is the
    // §9.4 case: real source identity, no canonical referent, and no source
    // may create one.
    await sql`
      INSERT INTO external_identities (source_id, external_id, player_id, status, match_method)
      VALUES (${fixtures.sourceId}, ${LINKED_URL}, ${linked.id}, 'unique',
              'afltables_profile_url')
    `;

    const [existingAdmin] = await sql<{ id: number }[]>`
      SELECT id::int AS id FROM auth_users ORDER BY id LIMIT 1
    `;
    let adminUserId: number;
    if (existingAdmin) {
      adminUserId = existingAdmin.id;
    } else {
      const [created] = await sql<{ id: number }[]>`
        INSERT INTO auth_users (email, role)
        VALUES ('issue122-apply-test@example.test', 'admin')
        RETURNING id::int AS id
      `;
      adminUserId = created.id;
      createdAdmin122 = true;
    }

    ids122 = {
      linkedPlayerId: linked.id,
      debutPlayerId: debut.id,
      adminUserId,
    };
  });

  afterAll(async () => {
    await cleanup122(sql);
    if (createdAdmin122) {
      await sql`DELETE FROM auth_users WHERE id = ${ids122.adminUserId}`;
    }
  });

  /* ---------------------------------------------------------------- *
   * §17.17 — the dry run still writes nothing
   * ---------------------------------------------------------------- */

  it('runs the whole automatic path in --dry-run and leaves no canonical row', async () => {
    const result = await apply122(bundle122(), T122.dryRun, { apply: false });

    expect(result.applied).toBe(false);
    // The gates all passed and the writers all ran: the counters prove the
    // path executed rather than being skipped.
    expect(result.counters.canonicalRowsInserted).toBeGreaterThan(0);
    expect(result.counters.canonicalApplicationsLogged).toBeGreaterThan(0);

    // And every one of them was rolled back.
    expect(await matchRow122(KEY_A)).toBeUndefined();
    expect(await ledger122()).toEqual([]);
    expect(await stats122(ids122.linkedPlayerId)).toEqual([]);
    expect(await candidates122()).toEqual([]);
  });

  /* ---------------------------------------------------------------- *
   * §17.1, .5, .6, .7, .8, .9, .21 — the unattended first apply
   * ---------------------------------------------------------------- */

  it('makes a new completed AFL Tables match canonical with no human action', async () => {
    const result = await apply122(bundle122(), T122.applyFirst);

    expect(result.applied).toBe(true);
    // One matches row, four period rows, one player_match_stats row.
    expect(result.counters.canonicalRowsInserted).toBe(6);
    expect(result.counters.canonicalRowsUpdated).toBe(0);
    expect(result.counters.canonicalApplicationsLogged).toBe(3);
    expect(result.counters.canonicalApplyFailures).toBe(0);
    expect(result.counters.canonicalRetryApplied).toBe(0);

    const match = await matchRow122(KEY_A);
    expect(match).toBeDefined();
    expect({
      homeScore: match?.homeScore,
      awayScore: match?.awayScore,
      attendance: match?.attendance,
      attendanceStatus: match?.attendanceStatus,
      venueId: match?.venueId,
      venueRaw: match?.venueRaw,
    }).toEqual({
      homeScore: 100,
      awayScore: 72,
      attendance: 31000,
      // A figure exists, so it is complete and cites its source.
      attendanceStatus: 'complete',
      // §7.3: unmapped is not a failure. NULL id, real raw string, no venues
      // row created and never the literal 'Unknown'.
      venueId: null,
      venueRaw: VENUE_RAW122,
    });
    // The provenance quartet, stamped by the applier.
    expect({
      sourceId: match?.sourceId,
      sourceRecordId: match?.sourceRecordId,
      attendanceSourceId: match?.attendanceSourceId,
      batch: match?.importBatchId,
    }).toEqual({
      sourceId: fixtures.sourceId,
      sourceRecordId: MATCH_A,
      attendanceSourceId: fixtures.sourceId,
      batch: String(result.batchId),
    });

    // §17.5 — the period set landed WITH the match, cumulative as published.
    const periods = await periods122(match?.id as number);
    expect(periods.map((row) => ({
      clubId: row.clubId, period: row.period, goals: row.goals, points: row.points,
    }))).toEqual([
      { clubId: fixtures.homeClubId, period: 1, goals: 3, points: 20 },
      { clubId: fixtures.homeClubId, period: 2, goals: 7, points: 47 },
      { clubId: fixtures.awayClubId, period: 1, goals: 2, points: 15 },
      { clubId: fixtures.awayClubId, period: 2, goals: 5, points: 36 },
    ]);
    expect(new Set(periods.map((row) => row.sourceId))).toEqual(new Set([fixtures.sourceId]));
    expect(new Set(periods.map((row) => row.sourceRecordId))).toEqual(new Set([MATCH_A]));

    // §17.7 — the resolved player landed.
    const linkedStats = await stats122(ids122.linkedPlayerId);
    expect(linkedStats).toHaveLength(1);
    expect({
      matchId: linkedStats[0].matchId,
      clubId: linkedStats[0].clubId,
      kicks: linkedStats[0].kicks,
      careerGameNo: linkedStats[0].careerGameNo,
      jumperNumber: linkedStats[0].jumperNumber,
      // Not proposed by this target and therefore never written here.
      brownlowVotes: linkedStats[0].brownlowVotes,
      sourceId: linkedStats[0].sourceId,
      sourceRecordId: linkedStats[0].sourceRecordId,
    }).toEqual({
      matchId: match?.id,
      clubId: fixtures.awayClubId,
      kicks: 5,
      // S6: derived-owned. The applier never writes `career_game_no`; the
      // end-of-run recompute numbers it from AFLDB's own rows, and this is
      // the player's first match here (the projection's 12 is corroboration
      // at most). See DERIVED_OWNED_FIELDS in settle-afltables.ts.
      careerGameNo: 1,
      jumperNumber: '9',
      brownlowVotes: null,
      sourceId: fixtures.sourceId,
      sourceRecordId: LINKED_RECORD,
    });

    // §17.7 / SC4 — ONE debutant blocks neither the match nor the other
    // player. The match landed, the linked player landed, and the debutant
    // alone is in the exception queue.
    expect(await stats122(ids122.debutPlayerId)).toEqual([]);

    // §17.8 — NA is not zero: no Brownlow row exists at all, which is the
    // correct in-season outcome rather than a defect.
    expect(await votes122()).toEqual([]);

    // §17.21 / §5.2 — a successfully applied target creates NO candidate. The
    // only pending row is the debutant's genuine exception.
    expect(await candidates122()).toEqual([{
      externalRecordId: DEBUT_RECORD,
      targetTable: 'player_match_stats',
      verb: 'unresolved_identity',
      status: 'pending',
      sourceVersionSeq: 1,
      createdByBatchId: result.batchId,
    }]);

    // §12 — three ledger rows, one per applied target, all bound to the exact
    // evidence version and the exact batch.
    const ledger = await ledger122();
    expect(ledger.map((row) => ({
      family: row.family,
      record: row.externalRecordId,
      target: row.targetTable,
      verb: row.verb,
      seq: row.sourceVersionSeq,
      batch: row.importBatchId,
      previous: row.previousValues,
    }))).toEqual([
      { family: 'match', record: MATCH_A, target: 'matches', verb: 'insert', seq: 1,
        batch: String(result.batchId), previous: null },
      { family: 'match', record: MATCH_A, target: 'match_period_scores', verb: 'insert',
        seq: 1, batch: String(result.batchId), previous: null },
      { family: 'player_match_stats', record: LINKED_RECORD, target: 'player_match_stats',
        verb: 'insert', seq: 1, batch: String(result.batchId), previous: null },
    ]);
    expect(ledger[0].targetKey).toEqual({ match_key: KEY_A });
    expect((ledger[0].newValues as Record<string, JsonValue>).venue_id).toBeNull();
    expect(ledger[2].targetKey).toEqual({
      player_id: ids122.linkedPlayerId, match_id: match?.id,
    });
  });

  /* ---------------------------------------------------------------- *
   * §17.2 / SC3 — the identical rerun
   * ---------------------------------------------------------------- */

  it('reruns the identical bundle as a total no-op: no canonical write, no ledger row',
    async () => {
      const beforeLedger = await ledger122();
      const beforeMatch = await matchRow122(KEY_A);
      const beforeCandidates = await candidates122();

      const result = await apply122(bundle122(), T122.rerun);

      expect(result.counters.canonicalRowsInserted).toBe(0);
      expect(result.counters.canonicalRowsUpdated).toBe(0);
      expect(result.counters.canonicalApplicationsLogged).toBe(0);
      expect(result.counters.canonicalRetryApplied).toBe(0);
      // Every observation was unchanged, so nothing even reached a gate.
      expect(result.counters.versionsAppended).toBe(0);

      expect(await ledger122()).toEqual(beforeLedger);
      expect(await matchRow122(KEY_A)).toEqual(beforeMatch);
      expect(await candidates122()).toEqual(beforeCandidates);
    });

  /* ---------------------------------------------------------------- *
   * §17.3, .21 — an upstream correction, and the moot pending candidate
   * ---------------------------------------------------------------- */

  it('applies an AFL-Tables-owned correction as exactly one update ledger row', async () => {
    const before = await matchRow122(KEY_A);

    // §5.2 / F7: a pending candidate raised earlier for the SAME target. It
    // must be left pending — never machine-retired, never marked accepted.
    await sql`
      INSERT INTO promotion_candidates (
        source_id, family, external_record_id, source_version_seq, verb, season,
        target_table, target_id, proposed_fields, baseline_canonical_hash,
        agreeing_groups, disagreeing_groups, created_by_batch_id
      ) VALUES (
        ${fixtures.sourceId}, 'match', ${MATCH_A}, 1, 'corrected', ${SEASON122},
        'matches', ${before?.id as number}, ${sql.json({ attendance: 1 } as never)},
        ${'b'.repeat(64)}, ${[]}::text[], ${[]}::text[], ${fixtures.batchId}
      )
    `;

    const result = await apply122(
      bundle122({
        matches: [{
          recordId: MATCH_A, matchKey: KEY_A, scope: SCOPE122,
          payloadOver: { attendance: 32500 },
          projectionOver: { attendance: 32500 },
        }],
      }),
      T122.correction,
    );

    expect(result.counters.canonicalRowsInserted).toBe(0);
    expect(result.counters.canonicalRowsUpdated).toBe(1);
    expect(result.counters.canonicalApplicationsLogged).toBe(1);
    expect(result.counters.candidatesMootLeftPending).toBeGreaterThanOrEqual(1);

    expect((await matchRow122(KEY_A))?.attendance).toBe(32500);

    const ledger = await ledger122();
    const updates = ledger.filter((row) => row.verb === 'update');
    expect(updates).toHaveLength(1);
    expect({
      target: updates[0].targetTable,
      seq: updates[0].sourceVersionSeq,
      previous: updates[0].previousValues,
      next: updates[0].newValues,
    }).toEqual({
      target: 'matches',
      seq: 2,
      // Exactly the prior values of exactly the fields that moved.
      previous: { attendance: 31000 },
      next: { attendance: 32500 },
    });

    // The moot candidate is still pending and was never accepted, and no
    // second candidate was stacked on top of it.
    const mine = (await candidates122())
      .filter((row) => row.externalRecordId === MATCH_A && row.targetTable === 'matches');
    expect(mine.map((row) => ({ status: row.status, verb: row.verb })))
      .toEqual([{ status: 'pending', verb: 'corrected' }]);
  });

  /* ---------------------------------------------------------------- *
   * §17.4 — A -> B -> A
   * ---------------------------------------------------------------- */

  it('records A -> B -> A as three versions over two payloads and TWO update ledger rows',
    async () => {
      const result = await apply122(bundle122(), T122.revert);

      expect(result.counters.canonicalRowsUpdated).toBe(1);
      expect(result.counters.payloadsReused).toBeGreaterThanOrEqual(1);
      expect((await matchRow122(KEY_A))?.attendance).toBe(31000);

      const [spine] = await sql<{ versionSeq: number }[]>`
        SELECT current_version_seq AS "versionSeq" FROM staging.source_records
         WHERE source_id = ${fixtures.sourceId} AND family = 'match'
           AND external_record_id = ${MATCH_A}
      `;
      expect(spine.versionSeq).toBe(3);
      const [payloads] = await sql<{ n: number }[]>`
        SELECT count(DISTINCT v.payload_hash)::int AS n
          FROM staging.source_record_versions v
         WHERE v.source_id = ${fixtures.sourceId} AND v.family = 'match'
           AND v.external_record_id = ${MATCH_A}
      `;
      expect(payloads.n).toBe(2);

      // The canonical value returned to A, and BOTH mutations are on the
      // record: source history append and canonical value mutation are
      // different facts and are both kept.
      const updates = (await ledger122())
        .filter((row) => row.targetTable === 'matches' && row.verb === 'update');
      expect(updates.map((row) => [row.previousValues, row.newValues])).toEqual([
        [{ attendance: 31000 }, { attendance: 32500 }],
        [{ attendance: 32500 }, { attendance: 31000 }],
      ]);
    });

  /* ---------------------------------------------------------------- *
   * §17.20 / §9.3 — retry after identity resolution
   * ---------------------------------------------------------------- */

  it('lands a debutant on an IDENTICAL payload once the identity is resolved', async () => {
    // The administrator resolves the identity between runs. Nothing about the
    // source changed, so `reconcile()` will answer `unchanged` and propose
    // nothing; only the canonical target state moved.
    await sql`
      INSERT INTO external_identities (source_id, external_id, player_id, status, match_method)
      VALUES (${fixtures.sourceId}, ${DEBUT_URL}, ${ids122.debutPlayerId}, 'unique',
              'afltables_profile_url')
    `;

    const beforeLedger = await ledger122();
    const beforeMatch = await matchRow122(KEY_A);

    const result = await apply122(bundle122(), T122.retry);

    // Exactly one write, and it is the retry.
    expect(result.counters.canonicalRowsInserted).toBe(1);
    expect(result.counters.canonicalRowsUpdated).toBe(0);
    expect(result.counters.canonicalApplicationsLogged).toBe(1);
    expect(result.counters.canonicalRetryApplied).toBe(1);
    // The payload did not move for ANY record.
    expect(result.counters.versionsAppended).toBe(0);

    const debutStats = await stats122(ids122.debutPlayerId);
    expect(debutStats).toHaveLength(1);
    expect(debutStats[0].sourceRecordId).toBe(DEBUT_RECORD);

    // Everything unrelated produced zero writes.
    expect(await matchRow122(KEY_A)).toEqual(beforeMatch);
    const added = (await ledger122()).slice(beforeLedger.length);
    expect(added.map((row) => ({
      record: row.externalRecordId, target: row.targetTable, verb: row.verb,
    }))).toEqual([
      { record: DEBUT_RECORD, target: 'player_match_stats', verb: 'insert' },
    ]);

    // F7 again: the debutant's own earlier exception candidate is left
    // pending rather than machine-retired.
    expect((await candidates122())
      .filter((row) => row.externalRecordId === DEBUT_RECORD)
      .map((row) => row.status)).toEqual(['pending']);
  });

  /* ---------------------------------------------------------------- *
   * §17.8 — the Brownlow grain
   * ---------------------------------------------------------------- */

  it('writes a published Brownlow vote at the round grain and nothing else', async () => {
    const [seasonVotesBefore] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM brownlow_season_votes
    `;
    const beforeStats = await stats122(ids122.linkedPlayerId);

    const result = await apply122(
      bundle122({
        players: [
          {
            recordId: LINKED_RECORD, url: LINKED_URL,
            payloadOver: { brownlow_votes: 3 },
            projectionOver: {
              // Migration 076's afltables_player_match_brownlow_row_ck makes
              // "a polled round carrying no vote" unrepresentable, so the
              // per-match statistic moves with the round grain.
              stats: statsWith({ brownlow_votes: 3 }),
              brownlow_round_vote: {
                season: SEASON122, round_number: 1, votes: 3,
              } as unknown as JsonValue,
            },
          },
          { recordId: DEBUT_RECORD, url: DEBUT_URL },
        ],
      }),
      T122.brownlow,
    );

    expect(result.counters.canonicalRowsInserted).toBe(1);
    expect(result.counters.canonicalRowsUpdated).toBe(0);

    expect(await votes122()).toEqual([{
      playerId: ids122.linkedPlayerId,
      roundNumber: 1,
      // A row exists only where a vote was published, so `played` is only
      // ever true here. No filler row is ever manufactured.
      played: true,
      votes: 3,
      sourceId: fixtures.sourceId,
      sourceRecordId: LINKED_RECORD,
    }]);

    // brownlow_season_votes is untouched: no season total is derived from a
    // partial round set (AFLDB-ISSUE-113 owns that table).
    const [seasonVotesAfter] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM brownlow_season_votes
    `;
    expect(seasonVotesAfter.n).toBe(seasonVotesBefore.n);

    // `brownlow_votes` is not in the player_match_stats proposed field set, so
    // one observation never writes the same fact to two targets.
    expect(await stats122(ids122.linkedPlayerId)).toEqual(beforeStats);

    const last = (await ledger122()).at(-1);
    expect({ target: last?.targetTable, verb: last?.verb, key: last?.targetKey }).toEqual({
      target: 'brownlow_round_votes',
      verb: 'insert',
      key: { season: SEASON122, player_id: ids122.linkedPlayerId, round_number: 1 },
    });
  });

  /* ---------------------------------------------------------------- *
   * §17.10 — an active human override, against a deliberately stale snapshot
   * ---------------------------------------------------------------- */

  it('refuses a mutation an active override covers, even when the run-level '
    + 'authority snapshot says clear', async () => {
    await sql`
      INSERT INTO data_overrides (
        entity_type, entity_key, field_group, override_values, admin_user_id, is_active
      ) VALUES (
        'matches', ${KEY_A}, 'score', ${sql.json({ home_goals: 15 } as never)},
        ${ids122.adminUserId}, true
      )
      ON CONFLICT (entity_type, entity_key, field_group) DO UPDATE
        SET is_active = true, override_values = EXCLUDED.override_values
    `;

    const before = await matchRow122(KEY_A);
    const beforeLedger = await ledger122();

    // 6*16+10 = 106, |106-72| = 34: every canonical CHECK still holds, so the
    // ONLY thing that can stop this write is the human decision.
    const scoreCorrection = {
      matches: [{
        recordId: MATCH_A, matchKey: KEY_A, scope: SCOPE122,
        payloadOver: { home_goals: 16, home_points: 106, margin: 34 },
        projectionOver: { home_goals: 16, home_score: 106, margin: 34 },
      }],
      players: [] as PlayerSpec[],
    };

    const result = await apply122(bundle122(scoreCorrection), T122.overrideBlocked, {
      // A deliberately permissive run-level snapshot — the S2 race made
      // concrete. `reconcile()` therefore raises a candidate, and the ONLY
      // thing that can still refuse the write is the applier re-reading
      // `data_overrides` inside the savepoint.
      manualAuthorityLoader: async () => () => 'clear',
    });

    expect(result.counters.canonicalRowsUpdated).toBe(0);
    expect(result.counters.canonicalApplicationsLogged).toBe(0);
    // Byte-identical, and no ledger row.
    expect(await matchRow122(KEY_A)).toEqual(before);
    expect(await ledger122()).toEqual(beforeLedger);

    // The exception path still ran: the reviewer sees the proposal.
    expect((await candidates122()).some(
      (row) => row.externalRecordId === MATCH_A && row.targetTable === 'matches'
        && row.status === 'pending',
    )).toBe(true);
  });

  it('applies the same correction once the override is deactivated', async () => {
    await sql`
      UPDATE data_overrides SET is_active = false
       WHERE entity_type = 'matches' AND entity_key = ${KEY_A} AND field_group = 'score'
    `;

    const result = await apply122(
      bundle122({
        matches: [{
          recordId: MATCH_A, matchKey: KEY_A, scope: SCOPE122,
          payloadOver: { home_goals: 16, home_points: 106, margin: 34 },
          projectionOver: { home_goals: 16, home_score: 106, margin: 34 },
        }],
        players: [],
      }),
      T122.overrideCleared,
    );

    // The payload did not move — this run re-offers the target on CANONICAL
    // state, which is §9.3's retry rule doing exactly what it is for.
    expect(result.counters.canonicalRowsUpdated).toBe(1);
    expect((await matchRow122(KEY_A))?.homeScore).toBe(106);
  });

  /* ---------------------------------------------------------------- *
   * §17.9 / SC6 — foreign-owned and source-less rows are never adopted
   * ---------------------------------------------------------------- */

  it('refuses a foreign-owned canonical row and never adopts it', async () => {
    await sql`
      INSERT INTO matches (
        match_key, season, round_code, round_number, round_type, is_final,
        match_date, venue_raw, home_club_id, away_club_id,
        home_goals, home_behinds, home_score, away_goals, away_behinds, away_score,
        result, winner_club_id, margin,
        attendance, attendance_status, attendance_source_id, source_id
      ) VALUES (
        ${KEY_FOREIGN}, ${SEASON122}, '1', 1, 'home_and_away'::round_type, false,
        '2093-04-04', ${VENUE_RAW122}, ${fixtures.homeClubId}, ${fixtures.awayClubId},
        15, 10, 100, 10, 12, 72,
        'home_win'::match_result, ${fixtures.homeClubId}, 28,
        20000, 'complete'::coverage_status, ${fixtures.providerSourceId},
        ${fixtures.providerSourceId}
      )
    `;
    const beforeLedger = await ledger122();

    const result = await apply122(
      bundle122({
        matches: [{
          recordId: MATCH_FOREIGN, matchKey: KEY_FOREIGN, scope: SCOPE_FOREIGN,
        }],
        players: [],
      }),
      T122.foreign,
    );

    expect(result.counters.canonicalRowsUpdated).toBe(0);
    expect(result.counters.foreignOwnedCollision).toBeGreaterThanOrEqual(1);
    const row = await matchRow122(KEY_FOREIGN);
    expect({ attendance: row?.attendance, owner: row?.sourceId })
      .toEqual({ attendance: 20000, owner: fixtures.providerSourceId });
    expect(await ledger122()).toEqual(beforeLedger);
    expect((await candidates122()).some(
      (candidate) => candidate.externalRecordId === MATCH_FOREIGN
        && candidate.verb === 'foreign_owned_collision',
    )).toBe(true);
  });

  it('refuses a source-less canonical row automatically while leaving it '
    + 'promotable by a human', async () => {
    // No provenance at all — the `createMatch()` / CSV-promote shape §7.2
    // proves the settle role cannot distinguish from a human-corrected row.
    await sql`
      INSERT INTO matches (
        match_key, season, round_code, round_number, round_type, is_final,
        match_date, venue_raw, home_club_id, away_club_id,
        home_goals, home_behinds, home_score, away_goals, away_behinds, away_score,
        result, winner_club_id, margin, attendance_status
      ) VALUES (
        ${KEY_SOURCELESS}, ${SEASON122}, '1', 1, 'home_and_away'::round_type, false,
        '2093-04-04', ${VENUE_RAW122}, ${fixtures.homeClubId}, ${fixtures.awayClubId},
        15, 10, 100, 10, 12, 72,
        'home_win'::match_result, ${fixtures.homeClubId}, 28,
        'not_collected'::coverage_status
      )
    `;
    const beforeLedger = await ledger122();

    const result = await apply122(
      bundle122({
        matches: [{
          recordId: MATCH_SOURCELESS, matchKey: KEY_SOURCELESS, scope: SCOPE_SOURCELESS,
        }],
        players: [],
      }),
      T122.sourceless,
    );

    expect(result.counters.canonicalRowsUpdated).toBe(0);
    expect(await ledger122()).toEqual(beforeLedger);
    const row = await matchRow122(KEY_SOURCELESS);
    // Untouched, and still unowned: NULL means "provenance unknown", never
    // "free to adopt".
    expect({ attendance: row?.attendance, owner: row?.sourceId })
      .toEqual({ attendance: null, owner: null });

    // The GENERIC gate is unchanged and still admits it, so a human can still
    // promote it through the reviewed queue. Only the unattended path is
    // narrowed — that divergence is the whole of E3.
    expect((await candidates122()).some(
      (candidate) => candidate.externalRecordId === MATCH_SOURCELESS
        && candidate.targetTable === 'matches'
        && candidate.verb === 'corrected'
        && candidate.status === 'pending',
    )).toBe(true);
  });

  /* ---------------------------------------------------------------- *
   * §17.11 / §9.1 — a write failure cannot leave a partial match family
   * ---------------------------------------------------------------- */

  it('rolls back the whole match family on a constraint violation and keeps going',
    async () => {
      const beforeLedger = await ledger122();

      // round_type 'home_and_away' with a NULL round_number passes migration
      // 076's staging projection — which carries no such rule — and violates
      // canonical `matches_round_number_ck`. The failure therefore happens
      // where this test needs it: inside the canonical savepoint.
      const result = await apply122(
        bundle122({
          matches: [
            {
              recordId: MATCH_BROKEN, matchKey: KEY_BROKEN, scope: SCOPE_BROKEN,
              projectionOver: { round_number: null },
            },
            { recordId: MATCH_OK, matchKey: KEY_OK, scope: SCOPE_BROKEN },
          ],
          players: [],
        }),
        T122.broken,
      );

      expect(result.counters.canonicalApplyFailures).toBe(1);

      // Neither the match nor its period scores survived: both or neither.
      expect(await matchRow122(KEY_BROKEN)).toBeUndefined();
      const [orphans] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM match_period_scores WHERE source_record_id = ${MATCH_BROKEN}
      `;
      expect(orphans.n).toBe(0);

      // No ledger row for the failed unit — a rolled-back attempt is not an
      // application (SC2).
      expect((await ledger122()).filter((row) => row.externalRecordId === MATCH_BROKEN))
        .toEqual([]);

      // The run continued: the sound match in the same bundle landed, with
      // its own ledger rows.
      const ok = await matchRow122(KEY_OK);
      expect(ok).toBeDefined();
      const added = (await ledger122()).slice(beforeLedger.length);
      expect(added.map((row) => `${row.externalRecordId}|${row.targetTable}`)).toEqual([
        `${MATCH_OK}|matches`, `${MATCH_OK}|match_period_scores`,
      ]);

      // §9.2 — one open finding per target that was in the failed unit, under
      // an issue_type DISTINCT from ISSUE-099's, so the two writers can never
      // contend for migration 076's dedup index (AFLDB-ISSUE-104).
      const failures = (await issues122())
        .filter((issue) => issue.issueType === CANONICAL_APPLY_ISSUE_TYPE);
      expect(failures.map((issue) => issue.issueKey).sort()).toEqual([
        canonicalApplyIssueKey('afltables.match', MATCH_BROKEN, 'match_period_scores'),
        canonicalApplyIssueKey('afltables.match', MATCH_BROKEN, 'matches'),
      ].sort());
      expect(failures.every((issue) => issue.resolvedAt === null)).toBe(true);
      expect(CANONICAL_APPLY_ISSUE_TYPE).not.toBe(SETTLE_ISSUE_TYPE);

      // The exception path still ran for the failed record.
      expect((await candidates122()).some(
        (candidate) => candidate.externalRecordId === MATCH_BROKEN,
      )).toBe(true);
    });

  /* ---------------------------------------------------------------- *
   * §17.19 / SC2 — canonical rows and ledger rows imply one another
   * ---------------------------------------------------------------- */

  it('has no canonical row without a ledger row, and no ledger row without a canonical row',
    async () => {
      // (a) Every canonical row this pass wrote names an application.
      const [unaudited] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM (
          SELECT m.source_record_id AS record, 'matches' AS target
            FROM matches m
           WHERE m.source_record_id LIKE ${`${PREFIX122}%`}
          UNION ALL
          SELECT DISTINCT p.source_record_id, 'match_period_scores'
            FROM match_period_scores p
           WHERE p.source_record_id LIKE ${`${PREFIX122}%`}
          UNION ALL
          SELECT s.source_record_id, 'player_match_stats'
            FROM player_match_stats s
           WHERE s.source_record_id LIKE ${`${PREFIX122}%`}
          UNION ALL
          SELECT b.source_record_id, 'brownlow_round_votes'
            FROM brownlow_round_votes b
           WHERE b.source_record_id LIKE ${`${PREFIX122}%`}
        ) written
        WHERE NOT EXISTS (
          SELECT 1 FROM canonical_applications a
           WHERE a.external_record_id = written.record
             AND a.target_table = written.target
        )
      `;
      expect(unaudited.n).toBe(0);

      // (b) Every ledger row names a canonical row that exists.
      const [phantom] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM canonical_applications a
         WHERE a.external_record_id LIKE ${`${PREFIX122}%`}
           AND NOT EXISTS (
             SELECT 1 FROM matches m
              WHERE a.target_table IN ('matches', 'match_period_scores')
                AND m.match_key = a.target_key->>'match_key'
           )
           AND NOT EXISTS (
             SELECT 1 FROM player_match_stats s
              WHERE a.target_table = 'player_match_stats'
                AND s.player_id = (a.target_key->>'player_id')::int
                AND s.match_id = (a.target_key->>'match_id')::int
           )
           AND NOT EXISTS (
             SELECT 1 FROM brownlow_round_votes b
              WHERE a.target_table = 'brownlow_round_votes'
                AND b.season = (a.target_key->>'season')::int
                AND b.player_id = (a.target_key->>'player_id')::int
                AND b.round_number = (a.target_key->>'round_number')::int
           )
      `;
      expect(phantom.n).toBe(0);

      // No machine decision was ever fabricated (SC8).
      const [decisions] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM promotion_decisions d
          JOIN promotion_candidates c ON c.id = d.candidate_id
         WHERE c.external_record_id LIKE ${`${PREFIX122}%`}
      `;
      expect(decisions.n).toBe(0);
      expect((await candidates122()).every((row) => row.status === 'pending')).toBe(true);
    });

  /* ---------------------------------------------------------------- *
   * §17.12 / §10 — a deprecated source may not veto the write
   * ---------------------------------------------------------------- */

  it('writes despite a disagreeing deprecated group, and still opens the finding',
    async () => {
      const match = await matchRow122(KEY_A);
      await sql`
        INSERT INTO staging.external_current_matches (
          source_id, external_game_id, season, round_label, round_number,
          match_date, venue_raw, home_team_raw, away_team_raw,
          home_club_id, away_club_id, local_match_id,
          home_score, away_score, raw_payload
        ) VALUES (
          ${fixtures.providerSourceId}, ${PROVIDER_GAME_122}, ${SEASON122}, 'Round 1', 1,
          '2093-04-04', ${VENUE_RAW122}, 'Issue122 Home', 'Issue122 Away',
          ${fixtures.homeClubId}, ${fixtures.awayClubId}, ${match?.id as number},
          55, 72, ${sql.json({ issue122_fixture: true } as never)}
        )
      `;

      const result = await apply122(
        bundle122({
          matches: [{
            recordId: MATCH_A, matchKey: KEY_A, scope: SCOPE122,
            payloadOver: { home_goals: 16, home_points: 106, margin: 34, attendance: 33333 },
            projectionOver: {
              home_goals: 16, home_score: 106, margin: 34, attendance: 33333,
            },
          }],
          players: [],
        }),
        T122.advisory,
      );

      // The write proceeded.
      expect(result.counters.canonicalRowsUpdated).toBe(1);
      expect((await matchRow122(KEY_A))?.attendance).toBe(33333);

      // The veto is withdrawn, so nothing was refused for disagreement...
      expect(result.counters.sourceDisagreement).toBe(0);
      // ...but the evidence is preserved exactly as before.
      const finding = (await issues122()).find(
        (issue) => issue.issueType === SETTLE_ISSUE_TYPE
          && issue.issueKey === settleIssueKey('afltables.match', MATCH_A, 'matches'),
      );
      expect(finding).toBeDefined();
      expect(finding?.resolvedAt).toBeNull();
      expect(finding?.details.disagreeing_groups).toEqual(['squiggle']);
    });

  /* ================================================================ *
   * AFLDB-ISSUE-122 S6 — run integration, driven through the CLI
   *
   * The operational path exactly as an operator (or, after S8, a timer)
   * invokes it: `runSettleCli()` parses the flags, reads the bundle from a
   * project root on disk, re-hashes the manifest, reads
   * `seasons.json.in_progress_seasons`, runs the settle with the automatic
   * path on, prints the counters and builds the §9.3 report. The only thing
   * substituted is the connection, which is this suite's guarded
   * `afldb_test` client instead of `AFLDB_IMPORT_DATABASE_URL`.
   *
   * Nested inside the S5 suite so it stands on the same fixtures and is torn
   * down by the same cleanup; it uses its own record ids, match key, scope
   * and players so nothing S5 asserted is disturbed.
   *
   * @see issues/open/AFLDB-ISSUE-122.md §9.3, §13, §16 row S6, §17 step 5
   * @see tools/current-season/settle-afltables.ts
   * @see src/lib/acquisition/settle-report.ts
   * ================================================================ */

  describe('S6 — the operational path end to end', () => {
    const LABEL_S6 = 'issue122-s6-cli';
    const SCOPE_S6 = 'issue122-s6';
    const MATCH_S6 = 'issue122-s6-match';
    const KEY_S6 = 'issue122-s6-key';
    const LINKED_S6_RECORD = 'issue122-s6-player-linked';
    const LINKED_S6_URL = 'issue122-players/S6/Issue122_S6_Linked.html';
    const DEBUT_S6_RECORD = 'issue122-s6-player-debut';
    const DEBUT_S6_URL = 'issue122-players/S6/Issue122_S6_Debut.html';
    const DEBUT_S6_NAME = 'Issue122 S6 Debutant';

    let rootS6 = '';
    let linkedS6PlayerId = 0;
    let debutS6PlayerId = 0;

    /** The bundle as `import_fitzroy_core.py` would have written it. */
    function rawBundleS6(manifestPath: string, manifestSha256: string): JsonValue {
      const playerRecord = (recordId: string, url: string, name: string): JsonValue => ({
        family: 'afltables.player_match_stats',
        scope_key: SCOPE_S6,
        external_record_id: recordId,
        payload: playerPayload122(url, {
          match_key: KEY_S6, round_code: '2', player_name: name,
        }),
        observed_columns: [...(playerContract.knownColumns ?? [])],
        projection: playerProjection122(url, {
          match_key: KEY_S6, round_code: '2', round_number: 2,
        }),
        rejection: null,
      });
      return {
        bundle_contract_version: 1,
        generated_by: 'tools/migration/import_fitzroy_core.py',
        snapshot_label: LABEL_S6,
        manifest_path: manifestPath,
        manifest_sha256: manifestSha256,
        acquisition_kind: 'in_season_partial',
        season: SEASON122,
        fitzroy_version: '1.8.0',
        enumerations: [
          {
            family: 'afltables.match', scope_key: SCOPE_S6, complete: true,
            incomplete_reason: null, external_record_ids: [MATCH_S6],
          },
          {
            family: 'afltables.player_match_stats', scope_key: SCOPE_S6, complete: true,
            incomplete_reason: null, external_record_ids: [LINKED_S6_RECORD, DEBUT_S6_RECORD],
          },
        ],
        records: [
          {
            family: 'afltables.match',
            scope_key: SCOPE_S6,
            external_record_id: MATCH_S6,
            payload: payload122({
              issue122_record: MATCH_S6, match_date: '2093-04-11', round_code: '2',
            }),
            observed_columns: [...(matchContract.knownColumns ?? [])],
            projection: projection122(KEY_S6, {
              match_date: '2093-04-11', round_code: '2', round_number: 2,
            }),
            rejection: null,
          },
          playerRecord(LINKED_S6_RECORD, LINKED_S6_URL, 'Issue122 S6 Linked'),
          playerRecord(DEBUT_S6_RECORD, DEBUT_S6_URL, DEBUT_S6_NAME),
        ],
        unkeyed_rejections: [],
        counts: { matches: 1, player_match_rows: 2, rejections: 0, unkeyed_rejections: 0 },
      } as JsonValue;
    }

    /**
     * A project root on disk with exactly what the CLI reads: the reference
     * registry, an in-progress season list naming this suite's season, the
     * manifest, and the bundle that cites the manifest's real digest.
     */
    function writeProjectRootS6(): string {
      const root = mkdtempSync(join(tmpdir(), 'afldb-issue122-s6-'));
      mkdirSync(join(root, 'data', 'reference'), { recursive: true });
      copyFileSync(
        'data/reference/source-families.json',
        join(root, 'data', 'reference', 'source-families.json'),
      );
      writeFileSync(
        join(root, 'data', 'reference', 'seasons.json'),
        JSON.stringify({ in_progress_seasons: [SEASON122] }),
      );
      const manifestRel = `docs/rebuild-manifests/afltables_fitzroy_core/${LABEL_S6}.json`;
      mkdirSync(dirname(join(root, manifestRel)), { recursive: true });
      const manifestBytes = JSON.stringify({ snapshot_label: LABEL_S6, issue122_fixture: true });
      writeFileSync(join(root, manifestRel), manifestBytes);
      const sha = createHash('sha256').update(manifestBytes).digest('hex');
      const bundleDir = join(root, 'data', 'sources', 'afltables', 'fitzroy_core', LABEL_S6);
      mkdirSync(bundleDir, { recursive: true });
      writeFileSync(
        join(bundleDir, 'observations.json'), JSON.stringify(rawBundleS6(manifestRel, sha)),
      );
      return root;
    }

    async function cli(args: string[]): Promise<{ outcome: SettleCliOutcome; lines: string[] }> {
      const lines: string[] = [];
      const outcome = await runSettleCli(args, {
        projectRoot: rootS6, sql, log: (line) => lines.push(line),
      });
      return { outcome, lines };
    }

    /** Everything a run could have moved, canonical, ledger and derived alike. */
    async function stateS6(): Promise<Record<string, unknown>> {
      const [matches] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM matches WHERE match_key = ${KEY_S6}
      `;
      const [versions] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM staging.source_record_versions
         WHERE external_record_id LIKE ${'issue122-s6-%'}
      `;
      const [payloads] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM staging.source_payloads
         WHERE raw_payload->>'issue122_fixture' IS NOT NULL
      `;
      const [batches] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM import_batches WHERE notes LIKE ${`%${LABEL_S6}%`}
      `;
      const clubSeasons = await sql`
        SELECT club_id::int AS "clubId", played, wins, draws, losses, points_for AS "pointsFor",
               points_against AS "pointsAgainst", premiership_points AS "premiershipPoints",
               ladder_rank AS "ladderRank"
          FROM club_seasons WHERE season = ${SEASON122} ORDER BY club_id
      `;
      const playerClubs = await sql`
        SELECT player_id::int AS "playerId", club_id::int AS "clubId", games, goals,
               first_season AS "firstSeason", last_season AS "lastSeason"
          FROM player_clubs
         WHERE player_id IN (${linkedS6PlayerId}, ${debutS6PlayerId})
         ORDER BY player_id, club_id
      `;
      const playerSeasons = await sql`
        SELECT player_id::int AS "playerId", games, kicks
          FROM player_season_stats
         WHERE season = ${SEASON122}
           AND player_id IN (${linkedS6PlayerId}, ${debutS6PlayerId})
         ORDER BY player_id
      `;
      const [season] = await sql`
        SELECT match_count AS "matchCount", last_match_date::text AS "lastMatchDate",
               last_loaded_round AS "lastLoadedRound"
          FROM seasons WHERE year = ${SEASON122}
      `;
      const s6 = (row: { externalRecordId: string }) => row.externalRecordId.startsWith('issue122-s6-');
      return {
        matches: matches.n,
        versions: versions.n,
        payloads: payloads.n,
        batches: batches.n,
        ledger: (await ledger122()).filter(s6).map((row) => ({
          record: row.externalRecordId, target: row.targetTable, verb: row.verb,
          version: row.sourceVersionSeq,
        })),
        candidates: (await candidates122()).filter(s6).map((row) => ({
          record: row.externalRecordId, target: row.targetTable, verb: row.verb,
          status: row.status, version: row.sourceVersionSeq,
        })),
        issues: (await issues122()).filter((row) => row.issueKey.includes('issue122-s6-')),
        clubSeasons: [...clubSeasons],
        playerClubs: [...playerClubs],
        playerSeasons: [...playerSeasons],
        season,
      };
    }

    beforeAll(async () => {
      rootS6 = writeProjectRootS6();
      const [linked] = await sql<{ id: number }[]>`
        INSERT INTO players (display_name, sort_name, search_name, slug)
        VALUES ('Issue122 S6 Linked', 'Linked, Issue122 S6', 'issue122 s6 linked',
                ${`${SLUG122}s6-linked`})
        RETURNING id::int AS id
      `;
      const [debut] = await sql<{ id: number }[]>`
        INSERT INTO players (display_name, sort_name, search_name, slug)
        VALUES (${DEBUT_S6_NAME}, 'Debutant, Issue122 S6', 'issue122 s6 debutant',
                ${`${SLUG122}s6-debut`})
        RETURNING id::int AS id
      `;
      linkedS6PlayerId = linked.id;
      debutS6PlayerId = debut.id;
      // Only the linked player has an identity mapping; the debutant is the
      // §9.4 case and stays unresolved until a later case resolves it.
      await sql`
        INSERT INTO external_identities (source_id, external_id, player_id, status, match_method)
        VALUES (${fixtures.sourceId}, ${LINKED_S6_URL}, ${linked.id}, 'unique',
                'afltables_profile_url')
      `;
    });

    afterAll(() => {
      if (rootS6 !== '') rmSync(rootS6, { recursive: true, force: true });
    });

    it('refuses a mistyped flag rather than silently running the review-first path',
      async () => {
        await expect(cli(['--label', LABEL_S6, '--apply', '--auto-aply']))
          .rejects.toThrow(/Unknown flag '--auto-aply'/);
        await expect(cli(['--label', LABEL_S6, '--apply', '--dry-run']))
          .rejects.toThrow(/mutually exclusive/);
      });

    it('--dry-run --auto-apply executes the automatic path, the recompute included, '
      + 'and leaves canonical, ledger and derived state unchanged', async () => {
      const before = await stateS6();

      const { outcome, lines } = await cli(['--label', LABEL_S6, '--dry-run', '--auto-apply']);

      const counters = outcome.result?.counters;
      expect(outcome.result?.applied).toBe(false);
      expect(outcome.report).toBeNull();
      // The path ran — gates, writers, ledger and the derived recompute.
      expect(counters?.canonicalRowsInserted).toBeGreaterThan(0);
      expect(counters?.canonicalApplicationsLogged).toBeGreaterThan(0);
      expect(counters?.derivedRecomputeRuns).toBe(1);
      expect(lines.some((line) => line.startsWith('Dry run.'))).toBe(true);
      expect(lines.some((line) => line.includes('--apply --auto-apply'))).toBe(true);

      // And every relation is byte-identical to before it ran.
      expect(await stateS6()).toEqual(before);
      expect(before.matches).toBe(0);
    });

    it('--apply --auto-apply lands the valid data unattended and recomputes the '
      + 'derived tables once, scoped to the players it wrote', async () => {
      const { outcome, lines } = await cli(['--label', LABEL_S6, '--apply', '--auto-apply']);
      const counters = outcome.result?.counters as SettleRunResult['counters'];

      expect(outcome.result?.applied).toBe(true);
      // One match, its four period rows, one resolved player. The debutant is
      // refused at its own record only.
      expect(counters.canonicalRowsInserted).toBe(6);
      expect(counters.canonicalRowsUpdated).toBe(0);
      expect(counters.canonicalApplicationsLogged).toBe(3);
      expect(counters.canonicalApplyFailures).toBe(0);
      expect(counters.canonicalApplyRefusals).toBe(0);
      expect(counters.unresolvedIdentityPlayer).toBeGreaterThan(0);
      expect(counters.candidatesCreated).toBe(1);

      // The derived recompute ran ONCE, over exactly the linked player: the
      // debutant wrote nothing and has no stats row on the new match.
      expect(counters.derivedRecomputeRuns).toBe(1);
      expect(counters.derivedRecomputePlayers).toBe(1);
      const state = await stateS6();
      expect(state.matches).toBe(1);
      expect(state.ledger).toEqual([
        { record: MATCH_S6, target: 'matches', verb: 'insert', version: 1 },
        { record: MATCH_S6, target: 'match_period_scores', verb: 'insert', version: 1 },
        { record: LINKED_S6_RECORD, target: 'player_match_stats', verb: 'insert', version: 1 },
      ]);
      const clubSeasons = state.clubSeasons as { clubId: number; played: number }[];
      expect(clubSeasons.map((row) => row.clubId)).toEqual(
        [fixtures.homeClubId, fixtures.awayClubId].sort((a, b) => a - b),
      );
      expect(clubSeasons.every((row) => row.played >= 1)).toBe(true);
      expect(state.playerClubs).toEqual([{
        playerId: linkedS6PlayerId, clubId: fixtures.awayClubId, games: 1, goals: 5,
        firstSeason: SEASON122, lastSeason: SEASON122,
      }]);
      expect(state.playerSeasons).toEqual([{ playerId: linkedS6PlayerId, games: 1, kicks: 5 }]);
      const [{ n: matchesThisSeason }] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM matches WHERE season = ${SEASON122}
      `;
      expect(state.season).toEqual({
        matchCount: matchesThisSeason, lastMatchDate: '2093-04-11', lastLoadedRound: '2',
      });

      // The batch row carries the ISSUE-122 counters the operator needs.
      const [batch] = await sql<{ validation: Record<string, number> }[]>`
        SELECT validation_result AS validation FROM import_batches
         WHERE id = ${outcome.result?.batchId as ImportBatchId}
      `;
      for (const key of [
        'canonicalRowsInserted', 'canonicalRowsUpdated', 'canonicalApplicationsLogged',
        'canonicalApplyFailures', 'canonicalApplyRefusals', 'canonicalRetryApplied',
        'unresolvedIdentityPlayer', 'candidatesMootLeftPending', 'advisoryDisagreement',
        'derivedRecomputeRuns', 'derivedRecomputePlayers',
      ]) {
        expect(batch.validation[key]).toBe(counters[key as keyof typeof counters]);
      }
      expect(lines.some((line) => /^Applied as import batch \d+: 6 canonical row/.test(line)))
        .toBe(true);

      // §9.3: the debutant is an ACTIVE exception with its full context, and
      // the report says the match itself DID land.
      const report = outcome.report;
      expect(report?.latestBatch?.batchId).toBe(outcome.result?.batchId);
      const unresolved = report?.unresolvedRecords.filter(
        (row) => row.externalRecordId === DEBUT_S6_RECORD,
      );
      expect(unresolved).toHaveLength(1);
      expect(unresolved?.[0]).toEqual({
        sourceKey: 'afltables',
        family: 'player_match_stats',
        externalRecordId: DEBUT_S6_RECORD,
        sourceVersionSeq: 1,
        matchKey: KEY_S6,
        season: SEASON122,
        roundCode: '2',
        playerName: DEBUT_S6_NAME,
        profileUrl: DEBUT_S6_URL,
        clubRaw: 'Issue122 Away',
        targetTable: 'player_match_stats',
        reason: expect.stringMatching(/./),
        canonicalMatchApplied: true,
        canonicalMatchId: (await matchRow122(KEY_S6))?.id,
      });
      // Listed once, under unresolved records — not again under candidates.
      expect(report?.candidates.active.map((c) => c.externalRecordId))
        .not.toContain(DEBUT_S6_RECORD);
      expect(report?.candidates.moot.map((c) => c.externalRecordId))
        .not.toContain(DEBUT_S6_RECORD);
      expect(lines.some((line) => line.includes(`player ${DEBUT_S6_NAME}`))).toBe(true);
      expect(lines.some((line) => line.includes(`match ${KEY_S6}: canonical`))).toBe(true);
    });

    it('a second identical --apply --auto-apply is a total no-op: 0 canonical writes, '
      + '0 ledger rows, no new version, candidate or finding, no recompute', async () => {
      const before = await stateS6();

      const { outcome } = await cli(['--label', LABEL_S6, '--apply', '--auto-apply']);
      const counters = outcome.result?.counters as SettleRunResult['counters'];

      expect(outcome.result?.applied).toBe(true);
      expect(counters.canonicalRowsInserted).toBe(0);
      expect(counters.canonicalRowsUpdated).toBe(0);
      expect(counters.canonicalApplicationsLogged).toBe(0);
      expect(counters.canonicalRetryApplied).toBe(0);
      expect(counters.canonicalApplyFailures).toBe(0);
      expect(counters.versionsAppended).toBe(0);
      expect(counters.payloadsCreated).toBe(0);
      expect(counters.candidatesCreated).toBe(0);
      expect(counters.dataIssuesOpened).toBe(0);
      expect(counters.derivedRecomputeRuns).toBe(0);
      expect(counters.derivedRecomputePlayers).toBe(0);
      // The debutant's payload did not move either, so its record is
      // `unchanged` at gate 4: no new rejection row, and its one pending
      // candidate is neither refreshed nor duplicated. It is still an active
      // exception, and the report below still says so from the candidate.
      expect(counters.candidatesRefreshed).toBe(0);
      expect(counters.unresolvedIdentityPlayer).toBe(1);

      const after = await stateS6();
      // The only difference a rerun may make is its own batch row.
      expect(after).toEqual({ ...before, batches: (before.batches as number) + 1 });
      // The debutant is still the active exception, still not moot. (The
      // report is season-wide, so S5's rolled-back match family is listed
      // beside it as an active exception of its own — correctly.)
      expect(outcome.report?.unresolvedRecords.map((row) => row.externalRecordId)
        .filter((id) => id.startsWith('issue122-s6-')))
        .toEqual([DEBUT_S6_RECORD]);
    });

    it('lands the debutant on the identical bundle once its identity is resolved, '
      + 'recomputes only that player, and the report moves its candidate to MOOT',
    async () => {
      await sql`
        INSERT INTO external_identities (source_id, external_id, player_id, status, match_method)
        VALUES (${fixtures.sourceId}, ${DEBUT_S6_URL}, ${debutS6PlayerId}, 'unique',
                'afltables_profile_url')
      `;
      const before = await stateS6();

      const { outcome } = await cli(['--label', LABEL_S6, '--apply', '--auto-apply']);
      const counters = outcome.result?.counters as SettleRunResult['counters'];

      expect(counters.canonicalRowsInserted).toBe(1);
      expect(counters.canonicalRetryApplied).toBe(1);
      expect(counters.versionsAppended).toBe(0);
      expect(counters.derivedRecomputeRuns).toBe(1);
      expect(counters.derivedRecomputePlayers).toBe(1);
      expect(counters.candidatesMootLeftPending).toBe(1);

      const after = await stateS6();
      expect(after.ledger).toEqual([
        ...(before.ledger as unknown[]),
        { record: DEBUT_S6_RECORD, target: 'player_match_stats', verb: 'insert', version: 1 },
      ]);
      expect(after.playerClubs).toEqual([
        ...(before.playerClubs as unknown[]),
        {
          playerId: debutS6PlayerId, clubId: fixtures.awayClubId, games: 1, goals: 5,
          firstSeason: SEASON122, lastSeason: SEASON122,
        },
      ]);
      // Nothing else moved: same match, same club ladder, same season row.
      expect(after.matches).toBe(before.matches);
      expect(after.clubSeasons).toEqual(before.clubSeasons);
      expect(after.season).toEqual(before.season);
      // F7: the candidate is still pending in the table...
      expect(after.candidates).toEqual(before.candidates);
      // ...and the report now classifies it as moot, with no active exception left.
      expect(outcome.report?.unresolvedRecords
        .filter((row) => row.externalRecordId.startsWith('issue122-s6-'))).toEqual([]);
      const moot = outcome.report?.candidates.moot.find(
        (c) => c.externalRecordId === DEBUT_S6_RECORD,
      );
      expect(moot?.status).toBe('moot');
      expect(moot?.latestAppliedVersionSeq).toBe(moot?.sourceVersionSeq);
      expect(outcome.report?.candidates.active.map((c) => c.externalRecordId))
        .not.toContain(DEBUT_S6_RECORD);
    });

    it('--report is read-only and renders the same classification', async () => {
      const before = await stateS6();

      const { outcome, lines } = await cli(['--label', LABEL_S6, '--report']);

      expect(outcome.result).toBeNull();
      expect(await stateS6()).toEqual(before);
      expect(lines.some((line) => line.startsWith('ACTIVE — requires attention'))).toBe(true);
      expect(lines.some((line) => line.startsWith('MOOT — pending candidates'))).toBe(true);
      expect(lines.some((line) => line.includes(`'${DEBUT_S6_RECORD}'`)
        && line.includes('applied v1'))).toBe(true);

      // The library entry the CLI wraps agrees with it exactly.
      const direct = await buildSettleExceptionReport(sql, { season: SEASON122 });
      expect(direct).toEqual(outcome.report);
    });
  });
});
