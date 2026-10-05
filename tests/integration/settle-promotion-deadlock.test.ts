/**
 * AFLDB-ISSUE-265 Phase A — characterisation of the settle / legacy-promotion match-lock deadlock,
 * driven through the REAL settles and the REAL promotion pipeline on the base tree (before Option 3).
 *
 * CONTRACT. `issues/open/AFLDB-ISSUE-265.md` §13.2 Phase A (A1, A2, A3), as amended by the §15 review and
 * approved by D-265-7 (§14.1). Section 17 of that runbook records what this file is, what it asserts and
 * what was NOT verified when it was written (nothing was executed).
 *
 * PHASE GATING. Phase A asserts PRE-CHANGE behaviour: the settle loses the deadlock. Once Option 3 lands
 * those assertions invert (the gate removes the cycle), so this file runs ONLY when the dedicated runner
 * (D:\tmp\issue265\Invoke-Issue265PhaseA.ps1, runbook §17.9) arms it. All of these must hold:
 *
 *   AFLDB_ISSUE265_PHASE=A;
 *   AFLDB_ISSUE265_ARMED_AT = the epoch milliseconds at which the runner launched vitest, at most 15 min
 *     old: an AFLDB_ISSUE265_PHASE left set in a shell (the old §17.9 command did exactly that) cannot arm
 *     a later, unrelated vitest run on its own;
 *   AFLDB_TEST_DATABASE_URL, AFLDB_AUTH_DATABASE_URL and AFLDB_TEST_IMPORT_DATABASE_URL set.
 *
 * Otherwise every case is skipped and NOTHING is imported that opens a connection: the shared connection
 * guard (`./guard`) is imported dynamically inside the gated `beforeAll`, not at module top as the other
 * integration suites do, because a static import connects (and throws when the DSN is absent). No other
 * module this file reaches opens a connection on import (runbook §17.10 records the static scan). A
 * skipped run is not evidence of anything. Phase B (Option 3 acceptance, runbook §13.2 B1–B6) will reuse
 * the choreography helpers below (`hold`, `reachOf`, `waitUntil`, the bundle builders) with inverted
 * assertions.
 *
 * DSNs (read from the environment by the code under test, never from .env by this file):
 *   - AFLDB_TEST_DATABASE_URL   owner connection, side transactions and both settles (as the existing
 *                               settle suites do).
 *   - AFLDB_AUTH_DATABASE_URL   validateSubmission() writes verdicts through the auth pool
 *                               (src/db/authClient.ts).
 *   - AFLDB_TEST_IMPORT_DATABASE_URL → copied into AFLDB_IMPORT_DATABASE_URL (restored in afterAll), which
 *                               promoteSubmission() and the validation authority read use
 *                               (src/lib/ingest/pipeline.ts:154, :303). Required: the promotion runs as the
 *                               import role it runs as in production, never as the owner.
 *
 * TARGET GUARD (before any write). Each URL must name exactly `afldb_test` at the runner's expected
 * endpoint (AFLDB_ISSUE265_EXPECT_ENDPOINT). Each live session must report current_database()
 * 'afldb_test', current_user = session_user = the runner's expected role for it
 * (AFLDB_ISSUE265_EXPECT_{OWNER,IMPORT,AUTH}_ROLE), and not in recovery; and all three must reach ONE
 * server: equal server address and port, database oid and postmaster start time.
 *
 * RESERVED SEASON 2078. Unused as a season value anywhere in tests/, tools/, src/ or data/ (runbook §17.2
 * records the grep evidence). Every canonical row this file writes is in 2078, on two synthetic club
 * identities (each its own organization, spanning 2078 only), one synthetic venue and two synthetic
 * players. No real club, venue or player is referenced, so the settles' end-of-run derived recompute
 * (recomputeSeasonMetadata/recomputeClubSeasons for 2078; recomputePlayerDerivedStats over the synthetic
 * players only) can reach no historical row. A1 (AFL Tables) uses rounds 1–4; A2/A3 (AFL API) use rounds
 * 5–9 with different dates, so no AFL API insert sees an AFL Tables match as a plausible existing fixture
 * (`findPlausibleCanonicalFixtures`: same clubs and at most one of round/date differing).
 *
 * SYNTHETIC AFL API PAYLOADS. Built in code (`apiFixtureRaw` / `apiRosterRaw` / `apiStatsRaw`). The real
 * season-2026 samples under tests/fixtures/afl_api are NOT read. The emitters need two pieces of reference
 * data the reserved season has no real entry for, and both are supplied to the real functions as inputs,
 * never written to disk:
 *   - a declared round vocabulary `afl_api_2078` (api round n -> canonical H&A round n, 1..9), added to an
 *     in-memory copy of data/reference/source-families.json and parsed by the real
 *     parseSourceFamilyRegistry() validator (the file itself is untouched);
 *   - an `AflApiIdentities` object mapping synthetic team, venue and comp-season provider ids to the
 *     synthetic identities created here.
 *
 * FAIL-CLOSED PREFLIGHT. Before any write, a census proves the reserved season and this file's namespaces
 * hold zero rows in every table the harness (or the code it drives) writes; anything else refuses the run
 * and the teardown then deletes NOTHING. Namespaces: AFL Tables record ids/scopes/labels `issue265-`;
 * every AFL API provider id embeds `2078I265`; match keys start `2078|`; identities use the slug prefix
 * `afldb-issue-265-`; submissions are named `AFLDB-ISSUE-265.csv`.
 *
 * HISTORICAL FINGERPRINTS. After the preflight and before setup: md5 of the ordered per-row md5s of every
 * row OUTSIDE the reserved season / namespace, for matches, match_period_scores, player_match_stats,
 * players, external_identities, seasons, clubs, club_organizations, venues, club_seasons, player_clubs,
 * data_overrides, player_career_stats, player_season_stats and data_edits. Re-taken after teardown and
 * asserted equal. `id` is excluded for the tables a recompute legitimately deletes and re-inserts
 * (club_seasons, player_clubs, player_career_stats, player_season_stats), per ISSUE-264 §14.4.1/§14.5.1.
 *
 * RETAINED-RECORD POLICY.
 *   Deleted by tracked id AND namespace/season predicate (settle-suite convention, settle-afltables.test.ts
 *   cleanup122 / settle-afl-api.test.ts cleanup()): matches and their period scores and player rows,
 *   club_seasons, the synthetic players' derived rows, canonical_applications, promotion_candidates,
 *   import_rejections, data_issues, the AFL Tables and AFL API typed projections, the spine
 *   (source_records, source_record_versions, and this file's own payloads once unreferenced), the
 *   import_batches of every settle run and of the A3 fixture, data_submissions (rows cascade),
 *   external_identities, players, clubs, club_organizations, the venue and the 2078 seasons row.
 *   Retained by convention (ISSUE-264 §14.3 "Retained test records"; submission-promotion.test.ts and
 *   match-results-promotion.test.ts): the fixture auth_users row (deleting it races a concurrent run); the
 *   `sources` 'sports_data_lab' row if this run had to seed it (migration-057 idiom, never deleted); and the
 *   `import_batches` rows with tool 'admin-upload' that the successful promotions write (notes
 *   'submission <id>'; import_batches is append-only and nothing references them after teardown).
 *
 * TEARDOWN AFTER A FAILED SETUP. Every created row is tracked as it is created. The teardown runs from the
 * gated describe's afterAll, which vitest runs even when beforeAll threw part-way (the same reliance as
 * match-results-promotion.test.ts:747-750). Order: still-open side transactions are rolled back; in-flight
 * settles and promotions are awaited (120 s), then their backends terminated — each named by pid AND
 * backend_start, through the owner and then the import role, since a role may signal only its own
 * backends; every side and settle connection and the auth pool are ended; then the scoped deletes in
 * foreign-key order (player_clubs before matches: first/last_match_id has no cascade,
 * match-results-promotion.test.ts:1076-1078), each naming tracked ids AND the season or namespace; then
 * a residue census that must read zero everywhere, then the fingerprint comparison; then the process
 * environment this file changed is restored. Between cases, afterEach rolls back any side transaction
 * left open and waits (bounded) for the case's settles and promotions; one still running poisons the
 * file, so no later case runs into its locks.
 *
 * BOUNDED WAITS. No await in this file is unbounded: every settle, promotion, side transaction and poll
 * has an explicit limit (`within`, `waitUntil`), below the case's own vitest timeout.
 *
 * EVIDENCE. With AFLDB_ISSUE265_EVIDENCE_FILE set, the teardown writes the retained-record accounting
 * (the admin-upload batches by id, whether the fixture user and the sports_data_lab source pre-existed),
 * the tracked ids, any teardown problem, the residue census and which fingerprints changed. The runner
 * reconciles it with its own independent census.
 *
 * OPERATOR COMMAND (not run by the author; inside a guarded afldb_test window, runbook §17.9):
 *   $env:AFLDB_ISSUE265_PHASE='A'; npx vitest run tests/integration/settle-promotion-deadlock.test.ts
 *
 * @see issues/open/AFLDB-ISSUE-265.md §10.1-§10.3, §13.2, §14.1, §15, §17
 * @see tests/integration/match-results-promotion.test.ts (F-002 block: side transactions, waiter walk)
 * @see tests/integration/settle-afltables.test.ts (bundle122 / apply122 / cleanup122)
 * @see tests/integration/settle-afl-api.test.ts (cleanup(): spine and ledger deletion order)
 */
import { readFileSync, writeFileSync } from 'node:fs';

import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { authSql } from '@/db/authClient';
import { type AflApiIdentities } from '@/lib/acquisition/afl-api-bundle';
import { loadManualAuthority } from '@/lib/acquisition/manual-authority';
import { persistSourceObservation } from '@/lib/acquisition/observation-store';
import { UNAVAILABLE_MANUAL_AUTHORITY, type JsonValue } from '@/lib/acquisition/observations';
import {
  buildAflApiSettleBundle,
  runSettleAflApi,
  type AflApiSettleBundle,
  type AflApiSettleRunResult,
  type AflApiSettleUnitSource,
} from '@/lib/acquisition/settle-afl-api';
import {
  CANONICAL_APPLY_ISSUE_TYPE,
  runSettleAfltables,
  validateSettleBundle,
  type SettleBundle,
  type SettleRunResult,
} from '@/lib/acquisition/settle-afltables';
import { canonicalApplyIssueKey, renderMatchKey } from '@/lib/acquisition/settle-core';
import {
  getSourceFamily,
  parseSourceFamilyRegistry,
  type SourceFamilyRegistry,
} from '@/lib/acquisition/source-families';
import { asImportBatchId } from '@/lib/import-batch-id';
import { LEGACY_PROMOTION_LOCK_REFUSAL, resolveClub } from '@/lib/ingest/datasets';
import { promoteSubmission, validateSubmission } from '@/lib/ingest/pipeline';

/* ------------------------------------------------------------------ *
 * Gate
 * ------------------------------------------------------------------ */

const PHASE_A_REQUESTED = process.env.AFLDB_ISSUE265_PHASE === 'A';
/** How long the runner's arming stamp stays valid. A whole Phase A window takes a few minutes. */
const ARM_WINDOW_MS = 15 * 60_000;
const armedAt = Number(process.env.AFLDB_ISSUE265_ARMED_AT ?? '');
const ARMED = Number.isSafeInteger(armedAt) && armedAt > 0
  && Date.now() - armedAt <= ARM_WINDOW_MS && armedAt - Date.now() <= 60_000;
const testDbUrl = process.env.AFLDB_TEST_DATABASE_URL ?? '';
const importDbUrl = process.env.AFLDB_TEST_IMPORT_DATABASE_URL ?? '';
const DSNS_PRESENT = testDbUrl !== '' && importDbUrl !== '' && Boolean(process.env.AFLDB_AUTH_DATABASE_URL);
const RUN_PHASE_A = PHASE_A_REQUESTED && ARMED && DSNS_PRESENT;

if (PHASE_A_REQUESTED && !RUN_PHASE_A) {
  const why = [
    ARMED ? null : 'AFLDB_ISSUE265_ARMED_AT is missing, invalid or older than 15 minutes',
    DSNS_PRESENT ? null : 'a required DSN is not set',
  ].filter(Boolean).join('; ');
  console.warn(
    `AFLDB-ISSUE-265 Phase A was requested but ${why}; every case is skipped. `
    + 'Run it through the dedicated runner. A skipped run is not evidence.',
  );
}

/* ------------------------------------------------------------------ *
 * Namespace (runbook §17.2)
 * ------------------------------------------------------------------ */

const SEASON = 2078;
const TAG = 'AFLDB-ISSUE-265';
const SLUG_PREFIX = 'afldb-issue-265-';
/** AFL Tables record ids, scopes and snapshot labels. */
const AFLT_NS = 'issue265-';
/** Embedded in every AFL API provider id this file invents. */
const API_NS = `${SEASON}I265`;
const FILE_NAME = `${TAG}.csv`;
const FIXTURE_EMAIL = 'issue-265-deadlock-fixture@afldb.test';
const FIXTURE_TOOL = 'issue265-settle-fixture';
const MANIFEST_SHA = 'b'.repeat(64);

/** Census / delete patterns. None contains `_`, so none is wider than it reads. */
const RECORD_LIKE = [`${AFLT_NS}%`, `%${API_NS}%`, `${SEASON}|%`];
const ISSUE_LIKE = [`%${AFLT_NS}%`, `%${API_NS}%`];
const BATCH_NOTE_LIKE = `%snapshot=${AFLT_NS}%`;

const CLUBS = {
  home: { slug: `${SLUG_PREFIX}home`, name: `${TAG} Home Club`, abbreviation: 'I265H' },
  away: { slug: `${SLUG_PREFIX}away`, name: `${TAG} Away Club`, abbreviation: 'I265A' },
} as const;
const VENUE = { slug: `${SLUG_PREFIX}oval`, name: `${TAG} Oval` } as const;
const PLAYERS = {
  p: { slug: `${SLUG_PREFIX}p`, name: `${TAG} Pat Player` },
  q: { slug: `${SLUG_PREFIX}q`, name: `${TAG} Quinn Player` },
} as const;

/** AFL API provider ids (synthetic; the real feed's shapes are `CD_M…`, `CD_T…`, `CD_I…`). */
const COMP_SEASON = `CD_S${API_NS}`;
const TEAM_H = `CD_T${API_NS}H`;
const TEAM_A = `CD_T${API_NS}A`;
const VENUE_PROVIDER = `CD_V${API_NS}`;
const P_PROVIDER = `CD_I${API_NS}P`;
/** Named on the away roster only: the roster contract needs one away position. Never a stats row. */
const W_PROVIDER = `CD_I${API_NS}W`;
/** p's AFL Tables identity, so the AFL API bridge row is shaped like a real importer row (ISSUE-237 D7). */
const P_AFLTABLES_ID = `${AFLT_NS}players/P/Issue265_Pat.html`;

/** Ordered observation times, strictly increasing across every run in this file. */
const T = {
  a1Seed: `${SEASON}-06-01T00:00:00Z`,
  a1Run: `${SEASON}-06-02T00:00:00Z`,
  a1Recovery: `${SEASON}-06-03T00:00:00Z`,
  apiSeed: `${SEASON}-06-10T00:00:00Z`,
  a2Run: `${SEASON}-06-11T00:00:00Z`,
  a2Recovery: `${SEASON}-06-12T00:00:00Z`,
  a3Fixture: `${SEASON}-06-12T12:00:00Z`,
  a3Run: `${SEASON}-06-13T00:00:00Z`,
} as const;

const LABEL = {
  a1Seed: `${AFLT_NS}a1-seed`,
  a1Run: `${AFLT_NS}a1-run`,
  a1Recovery: `${AFLT_NS}a1-recovery`,
  apiSeed: `${AFLT_NS}api-seed`,
  a2Run: `${AFLT_NS}a2-run`,
  a2Recovery: `${AFLT_NS}a2-recovery`,
  a3Run: `${AFLT_NS}a3-run`,
} as const;

/* -- A1: AFL Tables matches. Seeded in this order, so ids ascend MA < MB < MC < MD. -- */

type A1Key = 'MA' | 'MB' | 'MC' | 'MD';
const A1_KEYS: readonly A1Key[] = ['MA', 'MB', 'MC', 'MD'];
const A1: Record<A1Key, { record: string; round: number; date: string }> = {
  MA: { record: `${AFLT_NS}a1-ma`, round: 1, date: `${SEASON}-04-03` },
  MB: { record: `${AFLT_NS}a1-mb`, round: 2, date: `${SEASON}-04-10` },
  MC: { record: `${AFLT_NS}a1-mc`, round: 3, date: `${SEASON}-04-17` },
  MD: { record: `${AFLT_NS}a1-md`, round: 4, date: `${SEASON}-04-24` },
};
const A1_SCOPE = `${AFLT_NS}a1`;
/** Mapped by no venue, as in the ISSUE-122 harness: venue_id stays NULL and no venue row is needed. */
const A1_VENUE_RAW = 'ISSUE-265 Unmapped Ground';
const A1_SEED_ATTENDANCE = 31000;
const A1_RUN_ATTENDANCE = 32000;
const a1Key = (k: A1Key): string =>
  renderMatchKey(SEASON, String(A1[k].round), A1[k].date, CLUBS.home.name, CLUBS.away.name);

/* -- A2/A3: AFL API matches. May dates: Australia/Melbourne is AEST (UTC+10), so 05:10Z is 15:10. -- */

type ApiKey = 'M1' | 'M2' | 'M3' | 'M4' | 'M5';
const API_KEYS: readonly ApiKey[] = ['M1', 'M2', 'M3', 'M4', 'M5'];
const API: Record<ApiKey, { id: string; apiRound: number; date: string }> = {
  M1: { id: `CD_M${API_NS}R5`, apiRound: 5, date: `${SEASON}-05-01` },
  M2: { id: `CD_M${API_NS}R6`, apiRound: 6, date: `${SEASON}-05-08` },
  M3: { id: `CD_M${API_NS}R7`, apiRound: 7, date: `${SEASON}-05-15` },
  M4: { id: `CD_M${API_NS}R8`, apiRound: 8, date: `${SEASON}-05-22` },
  M5: { id: `CD_M${API_NS}R9`, apiRound: 9, date: `${SEASON}-05-29` },
};
const UTC_START = 'T05:10:00.000+0000';
const LOCAL_START = 'T15:10:00';
const VENUE_TZ = 'Australia/Melbourne';
const API_VENUE_SEED = VENUE.name;
const API_VENUE_A2 = `${VENUE.name} (renamed for A2)`;
const API_VENUE_A3 = `${VENUE.name} (renamed for A3)`;
/** The synthetic vocabulary maps api round n to canonical home-and-away round n. */
const apiRoundCode = (k: ApiKey): string => String(API[k].apiRound);
const apiKey = (k: ApiKey): string =>
  renderMatchKey(SEASON, apiRoundCode(k), API[k].date, CLUBS.home.name, CLUBS.away.name);
const apiPlayerRecord = (k: ApiKey): string => `${API[k].id}|${TEAM_H}|${P_PROVIDER}`;

/** Per-period DELTAS, as the AFL API publishes them. Home 12.8 (80), away 10.6 (66). */
const HOME_PERIODS = [[3, 2], [3, 2], [3, 2], [3, 2]] as const;
const AWAY_PERIODS = [[2, 1], [3, 2], [2, 1], [3, 2]] as const;
const totalOf = (periods: readonly (readonly [number, number])[]) => {
  const goals = periods.reduce((n, [g]) => n + g, 0);
  const behinds = periods.reduce((n, [, b]) => n + b, 0);
  return { goals, behinds, totalScore: goals * 6 + behinds };
};

type StatLine = {
  goals: number; behinds: number; kicks: number; handballs: number; disposals: number; marks: number;
  bounces: number; tackles: number; contestedPossessions: number; uncontestedPossessions: number;
  inside50s: number; marksInside50: number; contestedMarks: number; hitouts: number; onePercenters: number;
  clangers: number; freesFor: number; freesAgainst: number; rebound50s: number; goalAssists: number;
  totalClearances: number;
};
const SEED_LINE: StatLine = {
  goals: 1, behinds: 1, kicks: 10, handballs: 5, disposals: 15, marks: 4, bounces: 0, tackles: 3,
  contestedPossessions: 6, uncontestedPossessions: 9, inside50s: 2, marksInside50: 1, contestedMarks: 1,
  hitouts: 0, onePercenters: 2, clangers: 1, freesFor: 1, freesAgainst: 0, rebound50s: 1, goalAssists: 0,
  totalClearances: 2,
};
/** A2: p changed on M1. A3: p changed on M4. Kicks and disposals move together. */
const A2_LINE: StatLine = { ...SEED_LINE, kicks: 11, disposals: 16 };
const A3_LINE: StatLine = { ...SEED_LINE, kicks: 12, disposals: 17 };
const P_JUMPER = 7;

/** Every external record id this file can create (the deletes are scoped to exactly these). */
const TRACKED_RECORD_IDS: readonly string[] = [
  ...A1_KEYS.map((k) => A1[k].record),
  ...API_KEYS.map((k) => API[k].id),
  ...API_KEYS.map((k) => apiPlayerRecord(k)),
  // W is rostered but has no stats row, so no record is expected; tracked so one could still be deleted
  // (review F-004).
  ...API_KEYS.map((k) => `${API[k].id}|${TEAM_A}|${W_PROVIDER}`),
];
const TRACKED_MATCH_KEYS: readonly string[] = [...A1_KEYS.map(a1Key), ...API_KEYS.map(apiKey)];
const TRACKED_PROVIDER_MATCH_IDS: readonly string[] = API_KEYS.map((k) => API[k].id);
/** Every synthetic AFL API provider id: matches, comp season, teams, venue, players. */
const TRACKED_PROVIDER_IDS: readonly string[] = [
  ...TRACKED_PROVIDER_MATCH_IDS, COMP_SEASON, TEAM_H, TEAM_A, VENUE_PROVIDER, P_PROVIDER, W_PROVIDER,
];
/** The run-wide season-gate findings a settle of the reserved season can open (settle-core.ts:679). */
const SEASON_GATE_KEYS: readonly string[] = ['afltables', 'afl_api']
  .map((source) => canonicalApplyIssueKey(source, 'season', String(SEASON), 'seasons'));
/**
 * data_issues keys this file can cause. Every settle finding key embeds the record id, match key or
 * provider id it describes (settle-core.ts:288-300, :879; afl-api-match-absence.ts:81;
 * afl-api-bridge-identity.ts:197), and each of those carries this file's namespace.
 */
const TRACKED_ISSUE_PATTERNS: readonly string[] = [...TRACKED_RECORD_IDS, ...TRACKED_MATCH_KEYS, ...TRACKED_PROVIDER_IDS]
  .map((id) => `%${likeLiteral(id)}%`);

/* ------------------------------------------------------------------ *
 * Mutable harness state (everything created is recorded here as it is created)
 * ------------------------------------------------------------------ */

type Payload = Record<string, string | null>;
type Tx = (tx: postgres.TransactionSql) => Promise<unknown>;
type Fingerprint = { n: number; h: string };
type Outcome<R> = { ok: true; value: R } | { ok: false; error: unknown };
type Run<R> = { label: string; promise: Promise<R>; done: boolean; finishedAt: number | null; outcome: Outcome<R> | null };
type Held = { label: string; pid: number; go: () => void; abort: () => void; outcome: Promise<unknown>; finished: boolean };

let owner!: postgres.Sql;
let ownerReady = false;
let preflightPassed = false;
let baseline: Record<string, Fingerprint> | null = null;
let registry!: SourceFamilyRegistry;
let deadlockTimeoutMs = 0;
let checkPassedPauseMs = 0;
/**
 * A1 releases X this long after the promotion's wait-start timestamp plus deadlock_timeout, on the SERVER
 * clock (`pg_locks.waitstart`), so the promotion's one deadlock check has run before the settle can reach MA.
 */
const A1_CHECK_MARGIN_MS = 150;

const refs = { afltablesSourceId: 0, aflApiSourceId: 0, adminUserId: 0 };
let createdSeason = false;
const clubIds: number[] = [];
const organizationIds: number[] = [];
const venueIds: number[] = [];
const playerIds = new Map<keyof typeof PLAYERS, number>();
const identityPlayerIds: number[] = [];
const submissionIds = new Set<number>();
const settleBatchIds = new Set<string>();
const fixtureBatchIds = new Set<string>();
/** AFL Tables spine record ids the A3 fixture writes: the M4 match key (the enrichment's own identity). */
const fixtureSpineKeys = new Set<string>();
/**
 * Backends this file started or observed waiting, with their `backend_start`. A teardown terminate names
 * both, so it can never reach a pid PostgreSQL has since reused for another session.
 */
const observedBackends = new Map<number, string>();
/** The admin-upload import_batches the successful promotions leave (retained; recorded for the runner). */
const retainedPromotionBatches: { submissionId: number; batchId: string; targetTable: string }[] = [];
let fixtureUserPreexisted: boolean | null = null;
let sportsDataLabSeeded: boolean | null = null;
/**
 * Measured choreography gaps (review F-001), written to the evidence file. A1 fills its entry step by step,
 * so a window that fails part-way still records how far it got.
 */
const timings: Record<string, Record<string, number>> = {};
/**
 * What each case's settle and promotion actually did, written to the evidence file pass or fail. The
 * 2026-10-05 15:23:57 window failed A1 and the teardown then deleted the settle's batch and findings, so
 * which ordering occurred could not be recovered (runbook §17.12).
 */
const outcomes: Record<string, unknown> = {};
/** Read-only captures a case registers; afterEach runs them after the drain and before any teardown delete. */
const forensics: (() => Promise<void>)[] = [];
/** Set when a case leaves a settle or promotion running past its bound; every later case then refuses. */
let poisoned: string | null = null;
/** Process environment this file changes, restored by the teardown. */
const savedEnv = new Map<string, string | undefined>();

const clients: postgres.Sql[] = [];
const holds: Held[] = [];
const inflight: Promise<unknown>[] = [];
const inflightRuns: Run<unknown>[] = [];

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

const pause = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

const sqlstate = (error: unknown): string | undefined => {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code ?? e?.cause?.code;
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Escapes LIKE metacharacters (`_` occurs in every `CD_…` provider id). Hoisted: used by the constants. */
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** `SHOW deadlock_timeout` renders as e.g. '1s', '500ms', '1min'. */
function settingMs(setting: string): number {
  const match = /^(\d+)\s*(ms|s|min)?$/.exec(setting.trim());
  if (!match) throw new Error(`cannot parse the setting '${setting}' as a duration`);
  const n = Number(match[1]);
  return match[2] === 'min' ? n * 60_000 : match[2] === 's' ? n * 1000 : n;
}

function withTimeout<R>(promise: Promise<R>, ms: number): Promise<R | 'timed out'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<'timed out'>((resolve) => { timer = setTimeout(() => resolve('timed out'), ms); });
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}

/** Awaits `promise`, failing the case with `label` if it has not settled within `ms`. Never unbounded. */
async function within<R>(label: string, promise: Promise<R>, ms: number): Promise<R> {
  const result = await withTimeout(promise.then((value) => ({ value })), ms);
  if (result === 'timed out') throw new Error(`${label}: not settled within ${ms} ms`);
  return result.value;
}

/** A fresh single-connection client on the owner DSN. Ended when its work ends, and again by the teardown. */
function client(label: string): postgres.Sql {
  const connection = postgres(testDbUrl, {
    max: 1,
    connect_timeout: 20,
    onnotice: () => {},
    transform: { undefined: null },
    connection: { application_name: `afldb_i265 ${label}`.slice(0, 63), statement_timeout: 120_000 },
  });
  clients.push(connection);
  return connection;
}

/** An import-role session for reading import-role backends' identity; ended by the teardown. */
let importObserver: postgres.Sql | null = null;

/**
 * Records a backend with its start time (runbook §17.5: a terminate must name both). Without
 * pg_read_all_stats a role sees `backend_start` only for its own role's sessions, so a promotion
 * (import role) is read through an import-role session when the owner sees NULL.
 */
async function observe(pid: number): Promise<void> {
  if (observedBackends.has(pid)) return;
  const startedVia = async (db: postgres.Sql) => (await db<{ started: string | null }[]>`
    SELECT backend_start::text AS started FROM pg_stat_activity WHERE pid = ${pid}
  `)[0]?.started ?? null;
  let started = await startedVia(owner);
  if (started === null) {
    importObserver ??= postgres(importDbUrl, {
      max: 1, connect_timeout: 20, onnotice: () => {},
      connection: { application_name: 'afldb_i265 import observer', statement_timeout: 30_000 },
    });
    started = await startedVia(importObserver);
  }
  // Still NULL: neither role can see it (or it has ended). Recorded so the teardown reports it.
  observedBackends.set(pid, started ?? '');
}

/** Tracks a long-running call so the teardown can wait for it and the polls can watch it. */
function track<R>(label: string, promise: Promise<R>): Run<R> {
  const run: Run<R> = { label, promise, done: false, finishedAt: null, outcome: null };
  run.promise = promise.then(
    (value) => { run.done = true; run.finishedAt = Date.now(); run.outcome = { ok: true, value }; return value; },
    (error: unknown) => { run.done = true; run.finishedAt = Date.now(); run.outcome = { ok: false, error }; throw error; },
  );
  inflight.push(run.promise.catch(() => undefined));
  inflightRuns.push(run as Run<unknown>);
  return run;
}

async function settled<R>(run: Run<R>): Promise<Outcome<R>> {
  return run.promise.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}

function describeRun(run: Run<unknown>): string {
  if (!run.outcome) return 'still running';
  if (!run.outcome.ok) return `rejected: ${messageOf(run.outcome.error)}`;
  return `resolved: ${JSON.stringify(run.outcome.value).slice(0, 600)}`;
}

/**
 * Polls `probe` until it yields a value. Fails fast, with the run's own outcome, if a watched run finishes
 * first: a choreography that has gone wrong says why rather than timing out.
 */
async function waitUntil<R>(
  label: string, probe: () => Promise<R | null>, watch: readonly Run<unknown>[] = [], timeoutMs = 20_000,
): Promise<R> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== null) return value;
    const finished = watch.find((run) => run.done);
    if (finished) throw new Error(`${label}: ${finished.label} finished first (${describeRun(finished)})`);
    if (Date.now() > deadline) throw new Error(`${label}: not observed within ${timeoutMs} ms`);
    await pause(25);
  }
}

/* ------------------------------------------------------------------ *
 * Side transactions and the waiter walk
 * (copied from match-results-promotion.test.ts:934-1003, extended with an explicit rollback)
 * ------------------------------------------------------------------ */

class HeldAborted extends Error {
  constructor() { super('side transaction rolled back by the AFLDB-ISSUE-265 harness'); }
}

/** A transaction that runs `first`, reports its pid, then commits on `go()` or rolls back on `abort()`. */
async function hold(label: string, first: Tx): Promise<Held> {
  let release!: (action: 'commit' | 'abort') => void;
  const gate = new Promise<'commit' | 'abort'>((resolve) => { release = resolve; });
  let ready!: (pid: number) => void;
  let failed!: (error: unknown) => void;
  const reached = new Promise<number>((resolve, reject) => { ready = resolve; failed = reject; });
  const held: Held = {
    label, pid: 0, finished: false, outcome: Promise.resolve(null),
    go: () => release('commit'), abort: () => release('abort'),
  };
  const connection = client(`side ${label}`);
  held.outcome = connection.begin(async (tx) => {
    try {
      const [{ pid }] = await tx<{ pid: number }[]>`SELECT pg_backend_pid()::int AS pid`;
      await first(tx);
      ready(pid);
    } catch (error) {
      failed(error);
      throw error;
    }
    if ((await gate) === 'abort') throw new HeldAborted();
  }).then(() => null, (error: unknown) => {
    // A connect failure never reaches the callback: settle `reached` here too (a no-op if it already did).
    failed(error);
    return error;
  }).finally(async () => {
    held.finished = true;
    await connection.end({ timeout: 5 }).catch(() => undefined);
  });
  holds.push(held);
  held.pid = await within(`side transaction ${label} reaching its lock`, reached, 20_000);
  await observe(held.pid);
  return held;
}

const lockMatch = (matchId: number, strength: 'FOR UPDATE' | 'FOR SHARE'): Tx => (tx) => (strength === 'FOR UPDATE'
  ? tx`SELECT id FROM matches WHERE id = ${matchId} FOR UPDATE`
  : tx`SELECT id FROM matches WHERE id = ${matchId} FOR SHARE`);

/**
 * A1's X: an AFL Tables record's spine row `FOR UPDATE`. That row is the first lock a settle takes for the
 * record (`persistSourceObservation`, observation-store.ts:93, `FOR UPDATE OF r`), so a settle stopped here
 * has finished the records before it and has not yet touched this record's match. No promotion reads the
 * spine (src/lib/ingest has no reference to it).
 */
const lockSpineRecord = (externalRecordId: string): Tx => async (tx) => {
  const rows = await tx`
    SELECT external_record_id FROM staging.source_records
     WHERE source_id = ${refs.afltablesSourceId} AND external_record_id = ${externalRecordId}
       FOR UPDATE
  `;
  if (rows.length !== 1) {
    throw new Error(`expected exactly one afltables spine record '${externalRecordId}', found ${rows.length}`);
  }
};

/**
 * A1's Y: an UNCOMMITTED open finding under `issueKey`. A settle writing the same open finding
 * (`writeSettleDataIssue`, settle-core.ts:425-440, `ON CONFLICT (issue_type, issue_key)`) waits on this
 * transaction at the partial unique index `uq_data_issues_open_by_key` (migration 076). The case always
 * rolls it back (`abort()`); it is never committed, so the settle then inserts its own row.
 */
const holdOpenFinding = (issueKey: string, matchId: number): Tx => (tx) => tx`
  INSERT INTO data_issues (entity_type, entity_id, issue_type, issue_key, severity, description)
  VALUES ('matches', ${matchId}, ${CANONICAL_APPLY_ISSUE_TYPE}, ${issueKey}, 'error',
          ${`${TAG} harness stall: rolled back, never committed`})
`;

/**
 * Every session queued behind `holder`, directly or behind each other (a second row-lock waiter queues on
 * the first waiter's tuple lock, not on the holder). Verbatim from the F-002 block.
 */
async function reachOf(holder: number): Promise<number[]> {
  const rows = await owner<{ pid: number }[]>`
    WITH RECURSIVE waiting AS (
      SELECT DISTINCT pid FROM pg_locks WHERE NOT granted
    ), edge AS (
      SELECT w.pid, blocker FROM waiting w, unnest(pg_blocking_pids(w.pid)) AS blocker
    ), reach(pid) AS (
      SELECT pid FROM edge WHERE blocker = ${holder}::int
      UNION
      SELECT e.pid FROM edge e JOIN reach r ON e.blocker = r.pid
    )
    SELECT pid::int AS pid FROM reach
  `;
  return rows.map((row) => row.pid);
}

async function newWaiterBehind(holder: number, exclude: ReadonlySet<number> = new Set()): Promise<number | null> {
  const found = (await reachOf(holder)).find((pid) => !exclude.has(pid));
  if (found !== undefined) await observe(found);
  return found ?? null;
}

async function isBehind(holder: number, pid: number): Promise<true | null> {
  return (await reachOf(holder)).includes(pid) ? true : null;
}

/**
 * Review F-002: `pid` waits on `holder`'s TRANSACTION (a row its uncommitted write or lock holds), not in
 * a tuple-lock queue: exactly one ungranted lock, of type transactionid, and `holder` its only blocker.
 */
async function expectWaitsOnTransactionOf(label: string, pid: number, holder: number): Promise<void> {
  const [row] = await owner<{ waits: string[]; blockers: number[] }[]>`
    SELECT coalesce((SELECT array_agg(locktype::text ORDER BY locktype) FROM pg_locks
                      WHERE pid = ${pid} AND NOT granted), '{}') AS waits,
           pg_blocking_pids(${pid}::int)::int[] AS blockers
  `;
  expect({ label, waits: row.waits, blockers: row.blockers })
    .toEqual({ label, waits: ['transactionid'], blockers: [holder] });
}

type WaitSnapshot = { waits: string[]; blockers: number[]; waitStartMs: number | null; serverNowMs: number };

/**
 * One backend's ungranted locks, its blockers and its `pg_locks.waitstart`, with the server clock, in one
 * statement. PostgreSQL arms a wait's deadlock_timeout and lock_timeout timers when the wait begins and
 * stamps `waitstart` from the same start time (proc.c, ProcSleep), so `waitstart + deadlock_timeout` is when
 * that wait's one deadlock check runs and `waitstart + 5 s` is when a promotion hook's bound expires. Every
 * comparison stays on the server clock. `waitstart` can read NULL for a moment after a wait begins.
 */
async function waitSnapshot(pid: number): Promise<WaitSnapshot> {
  const [row] = await owner<WaitSnapshot[]>`
    SELECT coalesce((SELECT array_agg(locktype::text ORDER BY locktype) FROM pg_locks
                      WHERE pid = ${pid} AND NOT granted), '{}') AS waits,
           pg_blocking_pids(${pid}::int)::int[] AS blockers,
           (SELECT (extract(epoch FROM min(waitstart)) * 1000)::float8 FROM pg_locks
             WHERE pid = ${pid} AND NOT granted) AS "waitStartMs",
           (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS "serverNowMs"
  `;
  return row;
}

type OrderingSnapshot = {
  /** `waitstart` of `waiter`'s ungranted transactionid lock on `holder`'s transaction; null when absent. */
  settleOnHolderMs: number | null;
  settleOnHolderPresent: boolean;
  promotionOnSettleMs: number | null;
  promotionOnSettlePresent: boolean;
  serverNowMs: number;
};

/**
 * Review 2 F-001: ONE lock-manager snapshot of two wait edges, the settle's on `holder` and the promotion's
 * on the settle. `pg_locks` is a single `pg_lock_status()` call taken under every lock-table partition lock
 * (lock.c, GetLockStatusData), so the CTE (materialised: scanned twice, evaluated once) is one consistent
 * server-side instant. transactionid locks never take the fast path, so both edges come from that one
 * consistent table. An edge is a waiter's ungranted lock on an xid whose granted holder is another backend.
 * The settle's MB row carries the xid of a unit subtransaction that was RELEASEd, and a subtransaction's
 * xid lock is dropped at subcommit. The promotion still blocks on the settle's pid: XactLockTableWait
 * takes the dead subxid lock at once, finds the xid still in progress, climbs to its parent
 * (SubTransGetParent) and waits on the settle's TOP-LEVEL xid, which the settle holds granted (review 2,
 * follow-up F-001; window 1 showed pg_blocking_pids = [settle] for this wait).
 */
async function orderingSnapshot(settlePid: number, holder: number, promotionPid: number): Promise<OrderingSnapshot> {
  const [row] = await owner<OrderingSnapshot[]>`
    WITH l AS MATERIALIZED (
      SELECT pid, transactionid::text AS xid, granted, waitstart FROM pg_locks WHERE locktype = 'transactionid'
    ), edge AS (
      SELECT w.pid AS waiter, h.pid AS holder, w.waitstart
        FROM l w JOIN l h ON h.xid = w.xid AND h.granted AND h.pid <> w.pid
       WHERE NOT w.granted
    )
    SELECT (SELECT (extract(epoch FROM min(waitstart)) * 1000)::float8 FROM edge
             WHERE waiter = ${settlePid} AND holder = ${holder}) AS "settleOnHolderMs",
           EXISTS (SELECT 1 FROM edge WHERE waiter = ${settlePid} AND holder = ${holder}) AS "settleOnHolderPresent",
           (SELECT (extract(epoch FROM min(waitstart)) * 1000)::float8 FROM edge
             WHERE waiter = ${promotionPid} AND holder = ${settlePid}) AS "promotionOnSettleMs",
           EXISTS (SELECT 1 FROM edge WHERE waiter = ${promotionPid} AND holder = ${settlePid}) AS "promotionOnSettlePresent",
           (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS "serverNowMs"
  `;
  return row;
}

/** Two `waitstart` readings of the same wait (identical timestamptz through the identical expression). */
const sameWaitStart = (a: number | null, b: number): boolean => a !== null && Math.abs(a - b) < 0.001;

/** A `waitUntil` probe: `pid`'s snapshot once `holder` is its only blocker and its wait start is stamped. */
async function waitingOn(pid: number, holder: number): Promise<WaitSnapshot | null> {
  const snapshot = await waitSnapshot(pid);
  return snapshot.waitStartMs !== null && snapshot.blockers.length === 1 && snapshot.blockers[0] === holder
    ? snapshot : null;
}

/* ------------------------------------------------------------------ *
 * Readers
 * ------------------------------------------------------------------ */

type MatchRow = { id: number; attendance: number | null; venueRaw: string; sourceKey: string | null };

async function matchRow(matchKey: string): Promise<MatchRow | null> {
  const [row] = await owner<MatchRow[]>`
    SELECT m.id::int AS id, m.attendance, m.venue_raw AS "venueRaw", s.key AS "sourceKey"
      FROM matches m LEFT JOIN sources s ON s.id = m.source_id
     WHERE m.match_key = ${matchKey}
  `;
  return row ?? null;
}

type StatsRow = { kicks: number | null; disposals: number | null; goals: number | null; sourceKey: string | null };

async function statsRow(playerId: number, matchKey: string): Promise<StatsRow | null> {
  const [row] = await owner<StatsRow[]>`
    SELECT s.kicks::int AS kicks, s.disposals::int AS disposals, s.goals::int AS goals, src.key AS "sourceKey"
      FROM player_match_stats s
      JOIN matches m ON m.id = s.match_id
      LEFT JOIN sources src ON src.id = s.source_id
     WHERE s.player_id = ${playerId} AND m.match_key = ${matchKey}
  `;
  return row ?? null;
}

type Finding = {
  issueKey: string; externalRecordId: string | null; resolvedAt: string | null; resolution: string | null;
  error: string | null;
};

/** Every canonical_apply_failed finding (open or resolved) whose record is one of `recordIds`. */
async function applyFindings(recordIds: readonly string[]): Promise<Finding[]> {
  const rows = await owner<Finding[]>`
    SELECT issue_key AS "issueKey", details->>'external_record_id' AS "externalRecordId",
           resolved_at::text AS "resolvedAt", resolution, details->>'error' AS error
      FROM data_issues
     WHERE issue_type = ${CANONICAL_APPLY_ISSUE_TYPE}
       AND details->>'external_record_id' = ANY(${[...recordIds]}::text[])
     ORDER BY issue_key, id
  `;
  return [...rows];
}

async function submissionState(id: number): Promise<{ status: string; error: string | null }> {
  const [row] = await owner<{ status: string; error: string | null }[]>`
    SELECT status::text AS status, error FROM data_submissions WHERE id = ${id}
  `;
  return row;
}

async function promotionBatchCount(submissionId: number): Promise<number> {
  const [row] = await owner<{ n: number }[]>`
    SELECT count(*)::int AS n FROM import_batches
     WHERE tool = 'admin-upload' AND notes = ${`submission ${submissionId}`}
  `;
  return row.n;
}

/* ------------------------------------------------------------------ *
 * The legacy promotion, staged exactly as an upload leaves it (match-results-promotion.test.ts:343-370)
 * ------------------------------------------------------------------ */

async function stageApprovedFile(dataset: 'match_results' | 'player_match_stats', payloads: Payload[]): Promise<number> {
  const sha = `${TAG}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const [submission] = await owner<{ id: number }[]>`
    INSERT INTO data_submissions (dataset, filename, content, content_sha256, uploaded_by, row_count, status)
    VALUES (${dataset}, ${FILE_NAME}, ${Buffer.from('synthetic\n')}, ${sha}, ${refs.adminUserId},
            ${payloads.length}, 'staged'::submission_status)
    RETURNING id
  `;
  submissionIds.add(submission.id);
  for (const [index, payload] of payloads.entries()) {
    await owner`
      INSERT INTO data_submission_rows (submission_id, row_no, payload)
      VALUES (${submission.id}, ${index + 1}, ${owner.json(payload)})
    `;
  }
  const summary = await validateSubmission(submission.id);
  if (summary.errors !== 0) {
    const rows = await owner<{ rowNo: number; reasons: unknown }[]>`
      SELECT row_no AS "rowNo", reasons FROM data_submission_rows WHERE submission_id = ${submission.id} ORDER BY row_no
    `;
    throw new Error(`the ${dataset} fixture file did not validate: ${JSON.stringify(rows)}`);
  }
  await owner`UPDATE data_submissions SET status = 'approved' WHERE id = ${submission.id}`;
  return submission.id;
}

function startPromotion(label: string, submissionId: number): Run<Awaited<ReturnType<typeof promoteSubmission>>> {
  return track(label, promoteSubmission(submissionId));
}

/* ------------------------------------------------------------------ *
 * Registry and identities (the reserved season's reference data, in memory only)
 * ------------------------------------------------------------------ */

function registryWithSyntheticVocabulary(): SourceFamilyRegistry {
  const raw = JSON.parse(readFileSync('data/reference/source-families.json', 'utf8')) as Record<string, unknown>;
  const vocabularies = raw.round_vocabularies as Record<string, unknown>;
  const key = `afl_api_${SEASON}`;
  if (key in vocabularies) {
    throw new Error(`data/reference/source-families.json already declares '${key}'; ${SEASON} is no longer a free synthetic season`);
  }
  return parseSourceFamilyRegistry({
    ...raw,
    round_vocabularies: {
      ...vocabularies,
      [key]: {
        description: `${TAG} Phase A synthetic vocabulary for the reserved test season (in memory only).`,
        mapping_status: 'declared',
        season: SEASON,
        evidence: [`${TAG} test harness; never written to data/reference.`],
        rounds: Array.from({ length: 9 }, (_, i) => ({
          api_round_number: i + 1,
          api_abbreviation: `Rd ${i + 1}`,
          api_name: `Round ${i + 1}`,
          round_type: 'home_and_away',
          canonical_round_number: i + 1,
        })),
      },
    },
  });
}

/** Maps the synthetic provider ids to the synthetic identities (`hist` = clubs.legacy_club_hist = slug). */
const IDENTITIES: AflApiIdentities = {
  teams: new Map([
    [TEAM_H, { hist: CLUBS.home.slug, rawName: CLUBS.home.name, rawAbbreviation: CLUBS.home.abbreviation, rawNickname: 'Home' }],
    [TEAM_A, { hist: CLUBS.away.slug, rawName: CLUBS.away.name, rawAbbreviation: CLUBS.away.abbreviation, rawNickname: 'Away' }],
  ]),
  venues: new Map([[VENUE_PROVIDER, { rawName: VENUE.name, legacyName: VENUE.name }]]),
  seasons: new Map([[SEASON, { compSeasonId: 2078265, providerId: COMP_SEASON }]]),
};

/* ------------------------------------------------------------------ *
 * AFL Tables bundles (bundle122 / projection122 shape, settle-afltables.test.ts:2156-2352)
 * ------------------------------------------------------------------ */

function a1Bundle(label: string, order: readonly A1Key[], attendance: number): SettleBundle {
  const contract = getSourceFamily(registry, 'afltables', 'match');
  const records = order.map((k) => ({
    family: 'afltables.match',
    scope_key: A1_SCOPE,
    external_record_id: A1[k].record,
    payload: {
      issue265_fixture: true,
      issue265_record: A1[k].record,
      season: SEASON,
      round_code: String(A1[k].round),
      match_date: A1[k].date,
      home_team_raw: 'Issue265 Home',
      away_team_raw: 'Issue265 Away',
      home_goals: 15, home_behinds: 10, home_points: 100,
      away_goals: 10, away_behinds: 12, away_points: 72,
      margin: 28,
      attendance,
    },
    observed_columns: [...(contract.knownColumns ?? [])],
    projection: {
      match_key: a1Key(k),
      season: SEASON,
      round_code: String(A1[k].round),
      round_number: A1[k].round,
      round_type: 'home_and_away',
      is_final: false,
      match_date: A1[k].date,
      match_time: '3:20 PM',
      venue_raw: A1_VENUE_RAW,
      home_club_hist: CLUBS.home.slug,
      away_club_hist: CLUBS.away.slug,
      home_goals: 15, home_behinds: 10, home_score: 100,
      away_goals: 10, away_behinds: 12, away_score: 72,
      result: 'home_win', winner_club_hist: CLUBS.home.slug, margin: 28,
      attendance, attendance_status: 'complete', attendance_source_key: 'afltables',
      period_scores: [
        { side: 'home', period: 1, goals: 3, behinds: 2, points: 20 },
        { side: 'away', period: 1, goals: 2, behinds: 3, points: 15 },
        { side: 'home', period: 2, goals: 7, behinds: 5, points: 47 },
        { side: 'away', period: 2, goals: 5, behinds: 6, points: 36 },
      ],
    },
    rejection: null,
  })) as JsonValue[];
  return validateSettleBundle({
    raw: {
      bundle_contract_version: 1,
      generated_by: 'tools/migration/import_fitzroy_core.py',
      snapshot_label: label,
      manifest_path: `docs/rebuild-manifests/afltables_fitzroy_core/${label}.json`,
      manifest_sha256: MANIFEST_SHA,
      acquisition_kind: 'in_season_partial',
      season: SEASON,
      fitzroy_version: '1.8.0',
      // Complete, and always all four records, so the sweep never marks one of them absent.
      enumerations: [{
        family: 'afltables.match',
        scope_key: A1_SCOPE,
        complete: true,
        incomplete_reason: null,
        external_record_ids: order.map((k) => A1[k].record),
      }],
      records,
      unkeyed_rejections: [],
      counts: { matches: order.length, player_match_rows: 0, rejections: 0, unkeyed_rejections: 0 },
    } as JsonValue,
    expectedSnapshotLabel: label,
    actualManifestSha256: MANIFEST_SHA,
    inProgressSeasons: [SEASON],
    registry,
  });
}

/** One AFL Tables settle on its own connection, automatic path on (apply122, settle-afltables.test.ts:2363). */
function startAfltablesSettle(label: string, bundle: SettleBundle, observedAt: string): Run<SettleRunResult> {
  const connection = client(label);
  return track(label, runSettleAfltables(connection, {
    bundle,
    registry,
    apply: true,
    autoApply: true,
    inProgressSeasons: [SEASON],
    manualAuthority: UNAVAILABLE_MANUAL_AUTHORITY,
    manualAuthorityLoader: (tx) => loadManualAuthority(tx, SEASON),
    observedAt,
  }).then((result) => {
    if (result.batchId !== null) settleBatchIds.add(String(result.batchId));
    return result;
  }).finally(() => connection.end({ timeout: 5 }).catch(() => undefined)));
}

/* ------------------------------------------------------------------ *
 * AFL API payloads, built in code (the emitters' contract: src/lib/acquisition/afl-api-bundle.ts)
 * ------------------------------------------------------------------ */

function apiFixtureRaw(k: ApiKey, venueName: string): Record<string, unknown> {
  const home = totalOf(HOME_PERIODS);
  const away = totalOf(AWAY_PERIODS);
  return {
    providerId: API[k].id,
    compSeason: { providerId: COMP_SEASON },
    round: { roundNumber: API[k].apiRound, abbreviation: `Rd ${API[k].apiRound}`, name: `Round ${API[k].apiRound}` },
    home: { team: { providerId: TEAM_H }, score: home },
    away: { team: { providerId: TEAM_A }, score: away },
    venue: { providerId: VENUE_PROVIDER, name: venueName, timezone: VENUE_TZ },
    utcStartTime: `${API[k].date}${UTC_START}`,
    status: 'CONCLUDED',
  };
}

function periodScoreSide(periods: readonly (readonly [number, number])[]): Record<string, unknown> {
  const total = totalOf(periods);
  return {
    matchScore: { totalScore: total.totalScore, goals: total.goals, behinds: total.behinds },
    periodScore: periods.map(([goals, behinds], index) => ({
      periodNumber: index + 1,
      score: { totalScore: goals * 6 + behinds, goals, behinds },
    })),
  };
}

function apiRosterRaw(k: ApiKey): Record<string, unknown> {
  return {
    // The one sanctioned sibling leaf (§11.1): proves the local date/time against utcStartTime + timezone.
    match: { venueLocalStartTime: `${API[k].date}${LOCAL_START}` },
    matchRoster: {
      matchId: API[k].id,
      status: 'CONCLUDED',
      competitionId: COMP_SEASON,
      roundNumber: API[k].apiRound,
      // Present but empty: an absent key would flatten to an undeclared 'weather'/'umpires' leaf.
      weather: {},
      umpires: [],
      homeTeam: { teamId: TEAM_H, positions: [{ position: 'FF', player: { playerId: P_PROVIDER, playerJumperNumber: P_JUMPER } }] },
      awayTeam: { teamId: TEAM_A, positions: [{ position: 'FB', player: { playerId: W_PROVIDER, playerJumperNumber: 21 } }] },
    },
    recentMatchScores: [{
      matchId: API[k].id,
      status: 'CONCLUDED',
      homeTeamScore: periodScoreSide(HOME_PERIODS),
      awayTeamScore: periodScoreSide(AWAY_PERIODS),
    }],
  };
}

function apiStatsRaw(line: StatLine): Record<string, unknown> {
  const { totalClearances, ...stats } = line;
  return {
    homeTeamPlayerStats: [{
      teamId: TEAM_H,
      playerStats: {
        player: { playerId: P_PROVIDER, playerJumperNumber: P_JUMPER },
        stats: { ...stats, clearances: { totalClearances } },
        timeOnGroundPercentage: 85,
      },
    }],
    awayTeamPlayerStats: [],
  };
}

type ApiUnit = { key: ApiKey; venueName: string; line: StatLine };

function apiBundle(label: string, units: readonly ApiUnit[]): AflApiSettleBundle {
  const sources: AflApiSettleUnitSource[] = units.map((unit) => ({
    fixtureRaw: apiFixtureRaw(unit.key, unit.venueName),
    rosterRaw: apiRosterRaw(unit.key),
    playerStatsRaw: apiStatsRaw(unit.line),
  }));
  // No season feed: the enumeration is incomplete, so the absence sweep and the retirement search are
  // not applicable and the units the bundle omits are never marked absent.
  const bundle = buildAflApiSettleBundle({ season: SEASON, snapshotLabel: label, sources, registry, identities: IDENTITIES });
  if (bundle.buildFailures.length > 0) {
    throw new Error(`the synthetic AFL API bundle did not build: ${JSON.stringify(bundle.buildFailures)}`);
  }
  return bundle;
}

function startAflApiSettle(label: string, bundle: AflApiSettleBundle, observedAt: string): Run<AflApiSettleRunResult> {
  const connection = client(label);
  return track(label, runSettleAflApi(connection, {
    bundle, registry, apply: true, autoApply: true, inProgressSeasons: [SEASON], observedAt,
  }).then((result) => {
    if (result.batchId !== null) settleBatchIds.add(result.batchId);
    return result;
  }).finally(() => connection.end({ timeout: 5 }).catch(() => undefined)));
}

/** The legacy player_match_stats columns for an AFL API stat line (settle-afl-api.ts aflApiPlayerStatValues). */
function legacyStats(line: StatLine): Payload {
  const values: Record<string, number> = {
    kicks: line.kicks, marks: line.marks, handballs: line.handballs, disposals: line.disposals,
    goals: line.goals, behinds: line.behinds, hitouts: line.hitouts, tackles: line.tackles,
    rebounds: line.rebound50s, inside_50s: line.inside50s, clearances: line.totalClearances,
    clangers: line.clangers, frees_for: line.freesFor, frees_against: line.freesAgainst,
    contested: line.contestedPossessions, uncontested: line.uncontestedPossessions,
    contested_marks: line.contestedMarks, marks_inside_50: line.marksInside50,
    one_percenters: line.onePercenters, bounces: line.bounces, goal_assists: line.goalAssists,
  };
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]));
}

function statsFileRow(k: ApiKey, player: keyof typeof PLAYERS, extra: Payload): Payload {
  return {
    season: String(SEASON), round_code: apiRoundCode(k),
    home_club: CLUBS.home.name, away_club: CLUBS.away.name,
    player: PLAYERS[player].name, club: CLUBS.home.name,
    ...extra,
  };
}

/* ------------------------------------------------------------------ *
 * Census (preflight and residue) and fingerprints
 * ------------------------------------------------------------------ */

async function census(): Promise<Record<string, number>> {
  // Fresh fragments per use: a fragment object is never interpolated twice.
  const synthetic = () => owner`SELECT id FROM players WHERE slug LIKE ${`${SLUG_PREFIX}%`}`;
  const inSeason = () => owner`SELECT id FROM matches WHERE season = ${SEASON}`;
  const [row] = await owner<Record<string, number>[]>`
    SELECT
      (SELECT count(*) FROM matches WHERE season = ${SEASON} OR match_key = ANY(${[...TRACKED_MATCH_KEYS]}::text[]))::int AS matches,
      (SELECT count(*) FROM match_period_scores WHERE match_id IN (${inSeason()}))::int AS match_period_scores,
      (SELECT count(*) FROM player_match_stats WHERE match_id IN (${inSeason()}) OR player_id IN (${synthetic()}))::int AS player_match_stats,
      (SELECT count(*) FROM seasons WHERE year = ${SEASON})::int AS seasons,
      (SELECT count(*) FROM club_seasons WHERE season = ${SEASON})::int AS club_seasons,
      (SELECT count(*) FROM player_season_stats WHERE season = ${SEASON} OR player_id IN (${synthetic()}))::int AS player_season_stats,
      (SELECT count(*) FROM player_club_season_stats WHERE season = ${SEASON} OR player_id IN (${synthetic()}))::int AS player_club_season_stats,
      (SELECT count(*) FROM player_clubs
        WHERE first_season = ${SEASON} OR last_season = ${SEASON} OR player_id IN (${synthetic()}))::int AS player_clubs,
      (SELECT count(*) FROM player_career_stats WHERE player_id IN (${synthetic()}))::int AS player_career_stats,
      (SELECT count(*) FROM brownlow_round_votes WHERE season = ${SEASON})::int AS brownlow_round_votes,
      (SELECT count(*) FROM data_overrides
        WHERE entity_key LIKE ${`${SEASON}|%`} OR entity_key LIKE ${`${AFLT_NS}%`})::int AS data_overrides,
      (SELECT count(*) FROM data_issues
        WHERE issue_key LIKE ANY(${ISSUE_LIKE}::text[]) OR issue_key LIKE ANY(${[...TRACKED_ISSUE_PATTERNS]}::text[])
           OR issue_key = ANY(${[...SEASON_GATE_KEYS]}::text[]))::int AS data_issues,
      (SELECT count(*) FROM canonical_applications
        WHERE external_record_id LIKE ANY(${RECORD_LIKE}::text[])
           OR target_key->>'match_key' = ANY(${[...TRACKED_MATCH_KEYS]}::text[]))::int AS canonical_applications,
      (SELECT count(*) FROM promotion_candidates WHERE external_record_id LIKE ANY(${RECORD_LIKE}::text[]))::int AS promotion_candidates,
      (SELECT count(*) FROM promotion_decisions WHERE candidate_id IN (
         SELECT id FROM promotion_candidates WHERE external_record_id LIKE ANY(${RECORD_LIKE}::text[])))::int AS promotion_decisions,
      (SELECT count(*) FROM stat_availability WHERE season = ${SEASON})::int AS stat_availability,
      (SELECT count(*) FROM brownlow_season_votes WHERE season = ${SEASON})::int AS brownlow_season_votes,
      (SELECT count(*) FROM staging.afl_api_lineup
        WHERE season = ${SEASON} OR provider_match_id LIKE ${`%${API_NS}%`})::int AS afl_api_lineup,
      (SELECT count(*) FROM staging.afl_api_brownlow_vote
        WHERE season = ${SEASON} OR provider_match_id LIKE ${`%${API_NS}%`})::int AS afl_api_brownlow_vote,
      (SELECT count(*) FROM import_rejections WHERE source_record_id LIKE ANY(${RECORD_LIKE}::text[]))::int AS import_rejections,
      (SELECT count(*) FROM staging.source_records WHERE external_record_id LIKE ANY(${RECORD_LIKE}::text[]))::int AS source_records,
      (SELECT count(*) FROM staging.source_record_versions
        WHERE external_record_id LIKE ANY(${RECORD_LIKE}::text[]))::int AS source_record_versions,
      (SELECT count(*) FROM staging.source_payloads WHERE raw_payload->>'issue265_fixture' IS NOT NULL
         OR (source_id = ${refs.aflApiSourceId} AND raw_payload::text LIKE ${`%${API_NS}%`}))::int AS source_payloads,
      (SELECT count(*) FROM staging.afltables_match
        WHERE season = ${SEASON} OR external_record_id LIKE ANY(${RECORD_LIKE}::text[]))::int AS afltables_match,
      (SELECT count(*) FROM staging.afltables_player_match WHERE season = ${SEASON})::int AS afltables_player_match,
      (SELECT count(*) FROM staging.afl_api_match
        WHERE season = ${SEASON} OR external_record_id LIKE ${`%${API_NS}%`})::int AS afl_api_match,
      (SELECT count(*) FROM staging.afl_api_player_match
        WHERE season = ${SEASON} OR provider_match_id LIKE ${`%${API_NS}%`})::int AS afl_api_player_match,
      (SELECT count(*) FROM staging.external_current_matches WHERE season = ${SEASON})::int AS external_current_matches,
      (SELECT count(*) FROM players WHERE slug LIKE ${`${SLUG_PREFIX}%`}
         OR search_name IN (afldb_normalise_name(${PLAYERS.p.name}), afldb_normalise_name(${PLAYERS.q.name})))::int AS players,
      (SELECT count(*) FROM external_identities
        WHERE external_id LIKE ${`%${API_NS}%`} OR external_id LIKE ${`${AFLT_NS}%`})::int AS external_identities,
      (SELECT count(*) FROM clubs WHERE slug LIKE ${`${SLUG_PREFIX}%`} OR name LIKE ${`${TAG}%`}
         OR legacy_club_hist LIKE ${`${SLUG_PREFIX}%`})::int AS clubs,
      (SELECT count(*) FROM club_organizations WHERE slug LIKE ${`${SLUG_PREFIX}%`} OR name LIKE ${`${TAG}%`})::int AS club_organizations,
      (SELECT count(*) FROM venues WHERE slug LIKE ${`${SLUG_PREFIX}%`} OR canonical_name LIKE ${`${TAG}%`}
         OR legacy_name LIKE ${`${TAG}%`})::int AS venues,
      (SELECT count(*) FROM data_submissions WHERE filename = ${FILE_NAME})::int AS data_submissions,
      (SELECT count(*) FROM import_batches WHERE tool = ${FIXTURE_TOOL} OR notes LIKE ${BATCH_NOTE_LIKE})::int AS import_batches
  `;
  return { ...row };
}

const nonZero = (counts: Record<string, number>) => Object.fromEntries(Object.entries(counts).filter(([, n]) => n !== 0));

/** md5 of the ordered per-row md5s; `rows` must yield one `h` per row. */
async function digest(rows: postgres.PendingQuery<postgres.Row[]>): Promise<Fingerprint> {
  const [row] = await owner<Fingerprint[]>`
    SELECT count(*)::int AS n, coalesce(md5(string_agg(r.h, '' ORDER BY r.h)), '') AS h FROM (${rows}) r
  `;
  return row;
}

/**
 * Historical rows: everything OUTSIDE the reserved season and this file's namespaces. Every filter is
 * null-safe (`NOT coalesce(<namespace predicate>, false)`), so a row with a NULL slug or key is still
 * fingerprinted rather than silently dropped. The settles' recomputes are scoped to 2078 and to the
 * synthetic players, so no historical id may change either: the recompute-written tables are
 * fingerprinted WITH their ids, and again without them (`…_values`) only so a mismatch says whether
 * an id was re-issued or a value changed.
 */
async function fingerprints(): Promise<Record<string, Fingerprint>> {
  const db = owner;
  const synthetic = () => db`SELECT id FROM players WHERE slug LIKE ${`${SLUG_PREFIX}%`}`;
  const ns = `${SLUG_PREFIX}%`;
  const recomputed = async (name: string, where: (alias: string) => postgres.PendingQuery<postgres.Row[]>) => ({
    [name]: await digest(db`SELECT md5(to_jsonb(t)::text) AS h FROM ${db(name)} t WHERE ${where('t')}`),
    [`${name}_values`]: await digest(db`SELECT md5((to_jsonb(t) - 'id')::text) AS h FROM ${db(name)} t WHERE ${where('t')}`),
  });
  return {
    matches: await digest(db`SELECT md5(to_jsonb(t)::text) AS h FROM matches t WHERE t.season IS DISTINCT FROM ${SEASON}`),
    match_period_scores: await digest(db`
      SELECT md5(to_jsonb(t)::text) AS h FROM match_period_scores t JOIN matches m ON m.id = t.match_id
       WHERE m.season IS DISTINCT FROM ${SEASON}`),
    player_match_stats: await digest(db`
      SELECT md5(to_jsonb(t)::text) AS h FROM player_match_stats t JOIN matches m ON m.id = t.match_id
       WHERE m.season IS DISTINCT FROM ${SEASON}`),
    players: await digest(db`SELECT md5(to_jsonb(t)::text) AS h FROM players t WHERE NOT coalesce(t.slug LIKE ${ns}, false)`),
    external_identities: await digest(db`
      SELECT md5(to_jsonb(t)::text) AS h FROM external_identities t
       WHERE NOT coalesce(t.external_id LIKE ${`%${API_NS}%`} OR t.external_id LIKE ${`${AFLT_NS}%`}, false)`),
    seasons: await digest(db`SELECT md5(to_jsonb(t)::text) AS h FROM seasons t WHERE t.year IS DISTINCT FROM ${SEASON}`),
    clubs: await digest(db`SELECT md5(to_jsonb(t)::text) AS h FROM clubs t WHERE NOT coalesce(t.slug LIKE ${ns}, false)`),
    club_organizations: await digest(db`
      SELECT md5(to_jsonb(t)::text) AS h FROM club_organizations t WHERE NOT coalesce(t.slug LIKE ${ns}, false)`),
    venues: await digest(db`SELECT md5(to_jsonb(t)::text) AS h FROM venues t WHERE NOT coalesce(t.slug LIKE ${ns}, false)`),
    ...await recomputed('club_seasons', (a) => db`${db(a)}.season IS DISTINCT FROM ${SEASON}`),
    ...await recomputed('player_clubs', (a) => db`${db(a)}.player_id NOT IN (${synthetic()})`),
    ...await recomputed('player_career_stats', (a) => db`${db(a)}.player_id NOT IN (${synthetic()})`),
    ...await recomputed('player_season_stats', (a) => db`
      ${db(a)}.season IS DISTINCT FROM ${SEASON} AND ${db(a)}.player_id NOT IN (${synthetic()})`),
    ...await recomputed('player_club_season_stats', (a) => db`
      ${db(a)}.season IS DISTINCT FROM ${SEASON} AND ${db(a)}.player_id NOT IN (${synthetic()})`),
    stat_availability: await digest(db`
      SELECT md5(to_jsonb(t)::text) AS h FROM stat_availability t WHERE t.season IS DISTINCT FROM ${SEASON}`),
    brownlow_round_votes: await digest(db`
      SELECT md5(to_jsonb(t)::text) AS h FROM brownlow_round_votes t WHERE t.season IS DISTINCT FROM ${SEASON}`),
    data_overrides: await digest(db`
      SELECT md5(to_jsonb(t)::text) AS h FROM data_overrides t
       WHERE NOT coalesce(t.entity_key LIKE ${`${SEASON}|%`} OR t.entity_key LIKE ${`${AFLT_NS}%`}, false)`),
    data_edits: await digest(db`SELECT md5(to_jsonb(t)::text) AS h FROM data_edits t`),
    // Findings and ledgers: a settle resolves or refreshes findings by key, so a historical row must not move.
    data_issues: await digest(db`
      SELECT md5(to_jsonb(t)::text) AS h FROM data_issues t
       WHERE NOT coalesce(t.issue_key LIKE ANY(${ISSUE_LIKE}::text[])
                          OR t.issue_key LIKE ANY(${[...TRACKED_ISSUE_PATTERNS]}::text[])
                          OR t.issue_key = ANY(${[...SEASON_GATE_KEYS]}::text[]), false)`),
    canonical_applications: await digest(db`
      SELECT md5(to_jsonb(t)::text) AS h FROM canonical_applications t
       WHERE NOT coalesce(t.external_record_id LIKE ANY(${RECORD_LIKE}::text[])
                          OR t.target_key->>'match_key' = ANY(${[...TRACKED_MATCH_KEYS]}::text[]), false)`),
    promotion_candidates: await digest(db`
      SELECT md5(to_jsonb(t)::text) AS h FROM promotion_candidates t
       WHERE NOT coalesce(t.external_record_id LIKE ANY(${RECORD_LIKE}::text[]), false)`),
    import_rejections: await digest(db`
      SELECT md5(to_jsonb(t)::text) AS h FROM import_rejections t
       WHERE NOT coalesce(t.source_record_id LIKE ANY(${RECORD_LIKE}::text[]), false)`),
  };
}

/* ------------------------------------------------------------------ *
 * Teardown
 * ------------------------------------------------------------------ */

/**
 * Terminates every observed backend that is still the SAME backend (pid and backend_start). A role may
 * signal only its own role's backends (or needs pg_signal_backend), and the settles and side
 * transactions run as the owner while the promotion runs as the import role, so each pid is tried
 * through an owner connection and then an import-role connection.
 */
async function terminateObserved(problems: string[]): Promise<void> {
  if (!ownerReady || observedBackends.size === 0) return;
  const importTerminator = postgres(importDbUrl, {
    max: 1, connect_timeout: 20, onnotice: () => {},
    connection: { application_name: 'afldb_i265 terminator', statement_timeout: 30_000 },
  });
  try {
    for (const [pid, started] of observedBackends) {
      let settledFor = false;
      for (const terminator of [owner, importTerminator]) {
        try {
          // pid is visible to every role; backend_start only to the backend's own role (or
          // pg_read_all_stats). Decide "gone" or "reused" only from a role that can see it.
          const [seen] = await terminator<{ started: string | null }[]>`
            SELECT backend_start::text AS started FROM pg_stat_activity WHERE pid = ${pid}
          `;
          if (!seen) { settledFor = true; break; } // that backend has already ended
          if (seen.started === null) continue; // not visible to this role: try the next one
          if (started === '' || seen.started !== started) {
            // Identity never recorded, or the pid now belongs to another session: never signal it.
            if (started !== '') { settledFor = true; break; }
            continue;
          }
          const [row] = await terminator<{ ok: boolean }[]>`
            SELECT pg_terminate_backend(pid) AS ok FROM pg_stat_activity
             WHERE pid = ${pid} AND backend_start::text = ${started} AND pid <> pg_backend_pid()
          `;
          if (!row || row.ok) { settledFor = true; break; }
        } catch {
          // Not permitted for this role; the next terminator may be.
        }
      }
      if (!settledFor) problems.push(`backend ${pid} could not be identified and terminated by the owner or the import role`);
    }
  } finally {
    await importTerminator.end({ timeout: 5 }).catch(() => undefined);
  }
}

/** Side transactions rolled back, in-flight work finished (or its backend terminated), connections ended. */
async function releaseEverything(): Promise<string[]> {
  const problems: string[] = [];
  for (const held of holds) if (!held.finished) held.abort();
  if (await withTimeout(Promise.allSettled(holds.map((held) => held.outcome)), 30_000) === 'timed out') {
    problems.push('a side transaction did not end within 30 s of its rollback');
  }
  if (await withTimeout(Promise.allSettled(inflight), 120_000) === 'timed out') {
    problems.push('a settle or promotion was still running 120 s into teardown; its backend was terminated');
    await terminateObserved(problems);
    if (await withTimeout(Promise.allSettled(inflight), 30_000) === 'timed out') {
      problems.push('a settle or promotion was still running 30 s after the terminate');
    }
  }
  await Promise.allSettled(clients.map((connection) => connection.end({ timeout: 5 })));
  if (importObserver) await importObserver.end({ timeout: 5 }).catch(() => undefined);
  importObserver = null;
  // The auth pool validateSubmission() opened (a process-wide singleton, src/db/authClient.ts).
  const authPool = globalThis.__afldbAuthSql;
  if (authPool) {
    await authPool.end({ timeout: 5 }).catch((error: unknown) => problems.push(`auth pool end: ${messageOf(error)}`));
    globalThis.__afldbAuthSql = undefined;
  }
  return problems;
}

/**
 * Between cases: roll back any side transaction the case left open and wait, bounded, for its settles
 * and promotions. Anything still running poisons the file, so a later case cannot run into its locks.
 */
async function drainCase(): Promise<void> {
  for (const held of holds) if (!held.finished) held.abort();
  const holdsDone = await withTimeout(Promise.allSettled(holds.map((held) => held.outcome)), 30_000);
  const running = inflightRuns.filter((run) => !run.done);
  const runsDone = await withTimeout(Promise.allSettled(running.map((run) => run.promise)), 90_000);
  if (holdsDone === 'timed out' || runsDone === 'timed out') {
    poisoned = `a previous case left ${[
      holdsDone === 'timed out' ? 'a side transaction' : null,
      runsDone === 'timed out' ? running.filter((run) => !run.done).map((run) => run.label).join(', ') : null,
    ].filter(Boolean).join(' and ')} running`;
  }
}

/* ------------------------------------------------------------------ *
 * Target guard and process environment
 * ------------------------------------------------------------------ */

/** The one database this file may write to (runbook §17.1). Not a suffix match. */
const TARGET_DB = 'afldb_test';
/** Query parameters libpq or postgres.js could read as a host, port, database or identity. */
const TARGET_PARAMS = new Set([
  'host', 'hostaddr', 'hostname', 'port', 'path', 'dbname', 'database', 'db',
  'user', 'username', 'password', 'pass', 'service', 'passfile', 'options',
]);

/** Parses one DSN without connecting and without ever echoing it. Throws on any mismatch. */
function urlTarget(name: string, dsn: string, endpoint: string): void {
  let url: URL;
  try { url = new URL(dsn); } catch { throw new Error(`Refusing to run: the ${name} DSN is not a valid URL.`); }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error(`Refusing to run: the ${name} DSN protocol is ${url.protocol}.`);
  }
  const db = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (db !== TARGET_DB) throw new Error(`Refusing to run: the ${name} DSN names '${db}', not '${TARGET_DB}'.`);
  if (url.hostname === '' || url.hostname.includes(',')) {
    throw new Error(`Refusing to run: the ${name} DSN must name exactly one host.`);
  }
  const at = `${url.hostname.toLowerCase()}:${url.port || '5432'}`;
  if (at !== endpoint) throw new Error(`Refusing to run: the ${name} DSN endpoint is ${at}, expected ${endpoint}.`);
  for (const key of url.searchParams.keys()) {
    if (TARGET_PARAMS.has(key.toLowerCase())) {
      throw new Error(`Refusing to run: the ${name} DSN carries a '${key}' parameter that could redirect it.`);
    }
  }
}

type LiveTarget = {
  db: string; role: string; sessionRole: string; addr: string | null; port: number | null;
  recovery: boolean; dbOid: string; postmasterStart: string;
};

async function liveTarget(db: postgres.Sql): Promise<LiveTarget> {
  const [row] = await db<LiveTarget[]>`
    SELECT current_database()::text AS db, current_user::text AS role, session_user::text AS "sessionRole",
           inet_server_addr()::text AS addr, inet_server_port() AS port, pg_is_in_recovery() AS recovery,
           (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS "dbOid",
           pg_postmaster_start_time()::text AS "postmasterStart"
  `;
  return row;
}

function setManagedEnv(name: string, value: string): void {
  if (!savedEnv.has(name)) savedEnv.set(name, process.env[name]);
  process.env[name] = value;
}

function restoreManagedEnv(): void {
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  savedEnv.clear();
}

/** The retained-record and outcome accounting the runner reads (AFLDB_ISSUE265_EVIDENCE_FILE). */
function writeEvidence(extra: Record<string, unknown>): void {
  const file = process.env.AFLDB_ISSUE265_EVIDENCE_FILE;
  if (!file) return;
  writeFileSync(file, `${JSON.stringify({
    writtenAt: new Date().toISOString(),
    season: SEASON,
    preflightPassed,
    poisoned,
    fixtureUser: { email: FIXTURE_EMAIL, preexisted: fixtureUserPreexisted },
    sportsDataLabSource: { seededByThisRun: sportsDataLabSeeded },
    retainedPromotionBatches,
    settleBatchIds: [...settleBatchIds],
    fixtureBatchIds: [...fixtureBatchIds],
    submissionIds: [...submissionIds],
    timings,
    outcomes,
    ...extra,
  }, null, 2)}\n`, 'utf8');
}

/**
 * Every DELETE names tracked ids AND the reserved season / namespace, in foreign-key order
 * (settle-afl-api.test.ts:610-761 documents the spine and ledger graph this follows).
 */
async function deleteTracked(): Promise<string[]> {
  const problems: string[] = [];
  const step = async (label: string, work: () => Promise<unknown>) => {
    try { await work(); } catch (error) { problems.push(`${label}: ${messageOf(error)}`); }
  };
  const db = owner;
  const pids = [...playerIds.values()];
  const slugLike = `${SLUG_PREFIX}%`;
  const syntheticPlayers = () => db`SELECT id FROM players WHERE slug LIKE ${slugLike}`;
  const matchKeys = [...TRACKED_MATCH_KEYS, ...fixtureSpineKeys];
  const recordIds = [...TRACKED_RECORD_IDS, ...fixtureSpineKeys];
  // The settles create the matches; their ids are read back by tracked key AND the reserved season.
  let matchIds: number[] = [];
  await step('read tracked match ids', async () => {
    matchIds = (await db<{ id: number }[]>`
      SELECT id::int AS id FROM matches WHERE match_key = ANY(${matchKeys}::text[]) AND season = ${SEASON}
    `).map((row) => row.id);
  });
  // Only batches this run recorded as it created them. An untracked namespaced batch is left for the
  // residue census to report, never deleted on a pattern alone.
  const batchIds = [...new Set([...settleBatchIds, ...fixtureBatchIds])];
  const sourceIds = [refs.afltablesSourceId, refs.aflApiSourceId];
  // Retained by convention (header): the admin-upload batches of this run's successful promotions.
  // Recorded before their submissions (which reference them) are deleted.
  await step('record retained promotion batches', async () => {
    const notes = [...submissionIds].map((id) => `submission ${id}`);
    const rows = await db<{ batchId: string; targetTable: string; notes: string }[]>`
      SELECT id::text AS "batchId", target_table AS "targetTable", notes FROM import_batches
       WHERE tool = 'admin-upload' AND notes = ANY(${notes}::text[]) ORDER BY id
    `;
    retainedPromotionBatches.splice(0, retainedPromotionBatches.length, ...rows.map((row) => ({
      submissionId: Number(row.notes.slice('submission '.length)), batchId: row.batchId, targetTable: row.targetTable,
    })));
  });

  // Derived rows of the synthetic players. player_clubs first: first/last_match_id has no cascade.
  for (const table of ['player_clubs', 'player_club_season_stats', 'player_season_stats', 'player_career_stats']) {
    await step(table, () => db`
      DELETE FROM ${db(table)} WHERE player_id = ANY(${pids}::int[]) AND player_id IN (${syntheticPlayers()})
    `);
  }
  await step('club_seasons', () => db`
    DELETE FROM club_seasons WHERE season = ${SEASON} AND club_id = ANY(${clubIds}::int[])
  `);
  // Everything citing the spine versions, before the versions.
  await step('canonical_applications', () => db`
    DELETE FROM canonical_applications
     WHERE external_record_id = ANY(${recordIds}::text[]) AND external_record_id LIKE ANY(${RECORD_LIKE}::text[])
  `);
  await step('promotion_candidates', () => db`
    DELETE FROM promotion_candidates
     WHERE external_record_id = ANY(${recordIds}::text[]) AND external_record_id LIKE ANY(${RECORD_LIKE}::text[])
  `);
  await step('import_rejections', () => db`
    DELETE FROM import_rejections
     WHERE source_record_id = ANY(${recordIds}::text[]) AND source_record_id LIKE ANY(${RECORD_LIKE}::text[])
  `);
  // Each pattern embeds a tracked id, key or provider id (TRACKED_ISSUE_PATTERNS); the season-gate keys
  // are exact. The preflight proved none of either existed before this run.
  await step('data_issues', () => db`
    DELETE FROM data_issues
     WHERE issue_key LIKE ANY(${[...TRACKED_ISSUE_PATTERNS]}::text[]) OR issue_key = ANY(${[...SEASON_GATE_KEYS]}::text[])
  `);
  await step('player_match_stats', () => db`
    DELETE FROM player_match_stats
     WHERE match_id = ANY(${matchIds}::int[]) AND match_id IN (SELECT id FROM matches WHERE season = ${SEASON})
  `);
  await step('match_period_scores', () => db`
    DELETE FROM match_period_scores
     WHERE match_id = ANY(${matchIds}::int[]) AND match_id IN (SELECT id FROM matches WHERE season = ${SEASON})
  `);
  await step('afl_api_player_match', () => db`
    DELETE FROM staging.afl_api_player_match
     WHERE provider_match_id = ANY(${[...TRACKED_PROVIDER_MATCH_IDS]}::text[]) AND provider_match_id LIKE ${`%${API_NS}%`}
  `);
  await step('afl_api_match', () => db`
    DELETE FROM staging.afl_api_match
     WHERE external_record_id = ANY(${[...TRACKED_PROVIDER_MATCH_IDS]}::text[]) AND external_record_id LIKE ${`%${API_NS}%`}
  `);
  await step('afltables_match', () => db`
    DELETE FROM staging.afltables_match
     WHERE external_record_id = ANY(${recordIds}::text[]) AND season = ${SEASON}
  `);
  await step('matches', () => db`
    DELETE FROM matches WHERE id = ANY(${matchIds}::int[]) AND season = ${SEASON}
  `);
  // Spine: heads, then versions, then this file's own payloads once nothing cites them.
  await step('spine', async () => {
    const doomed = await db<{ sourceId: number; family: string; payloadHash: string }[]>`
      SELECT DISTINCT source_id AS "sourceId", family, payload_hash AS "payloadHash"
        FROM staging.source_record_versions
       WHERE source_id = ANY(${sourceIds}::int[]) AND external_record_id = ANY(${recordIds}::text[])
         AND external_record_id LIKE ANY(${RECORD_LIKE}::text[])
    `;
    await db`
      DELETE FROM staging.source_records
       WHERE source_id = ANY(${sourceIds}::int[]) AND external_record_id = ANY(${recordIds}::text[])
         AND external_record_id LIKE ANY(${RECORD_LIKE}::text[])
    `;
    await db`
      DELETE FROM staging.source_record_versions
       WHERE source_id = ANY(${sourceIds}::int[]) AND external_record_id = ANY(${recordIds}::text[])
         AND external_record_id LIKE ANY(${RECORD_LIKE}::text[])
    `;
    for (const payload of doomed) {
      await db`
        DELETE FROM staging.source_payloads
         WHERE source_id = ${payload.sourceId} AND family = ${payload.family} AND payload_hash = ${payload.payloadHash}
           AND NOT EXISTS (
             SELECT 1 FROM staging.source_record_versions v
              WHERE v.source_id = ${payload.sourceId} AND v.family = ${payload.family}
                AND v.payload_hash = ${payload.payloadHash}
           )
      `;
    }
  });
  // data_submission_rows cascades off data_submissions (migration 023).
  await step('data_submissions', () => db`
    DELETE FROM data_submissions WHERE id = ANY(${[...submissionIds]}::int[]) AND filename = ${FILE_NAME}
  `);
  await step('import_batches', () => db`
    DELETE FROM import_batches
     WHERE id = ANY(${batchIds}::bigint[]) AND (tool = ${FIXTURE_TOOL} OR notes LIKE ${BATCH_NOTE_LIKE})
  `);
  await step('external_identities', () => db`
    DELETE FROM external_identities
     WHERE player_id = ANY(${identityPlayerIds}::int[])
       AND (external_id LIKE ${`%${API_NS}%`} OR external_id LIKE ${`${AFLT_NS}%`})
  `);
  await step('players', () => db`DELETE FROM players WHERE id = ANY(${pids}::int[]) AND slug LIKE ${slugLike}`);
  await step('clubs', () => db`DELETE FROM clubs WHERE id = ANY(${clubIds}::int[]) AND slug LIKE ${slugLike}`);
  await step('club_organizations', () => db`
    DELETE FROM club_organizations WHERE id = ANY(${organizationIds}::int[]) AND slug LIKE ${slugLike}
  `);
  await step('venues', () => db`DELETE FROM venues WHERE id = ANY(${venueIds}::int[]) AND slug LIKE ${slugLike}`);
  if (createdSeason) await step('seasons', () => db`DELETE FROM seasons WHERE year = ${SEASON}`);
  return problems;
}

/* ================================================================== *
 * Phase A
 * ================================================================== */

describe.runIf(RUN_PHASE_A)('AFLDB-ISSUE-265 Phase A: a real settle loses the match-lock deadlock to a legacy promotion', () => {
  beforeAll(async () => {
    // Target guard, part 1: no connection yet. Exact database, one expected endpoint, expected roles.
    const expect265 = {
      endpoint: (process.env.AFLDB_ISSUE265_EXPECT_ENDPOINT ?? '').toLowerCase(),
      owner: process.env.AFLDB_ISSUE265_EXPECT_OWNER_ROLE ?? '',
      import: process.env.AFLDB_ISSUE265_EXPECT_IMPORT_ROLE ?? '',
      auth: process.env.AFLDB_ISSUE265_EXPECT_AUTH_ROLE ?? '',
    };
    const missing = Object.entries(expect265).filter(([, value]) => value === '').map(([key]) => key);
    if (missing.length > 0) {
      throw new Error(`Refusing to run: the runner's expected target is incomplete (${missing.join(', ')}).`);
    }
    const dsns = {
      owner: testDbUrl, import: importDbUrl, auth: process.env.AFLDB_AUTH_DATABASE_URL ?? '',
    } as const;
    for (const [key, dsn] of Object.entries(dsns)) urlTarget(key, dsn, expect265.endpoint);

    // The shared guard: the DSN is set, names a _test database, and is reachable (tests/integration/guard.ts).
    await import('./guard');

    owner = postgres(testDbUrl, {
      max: 1, connect_timeout: 20, onnotice: () => {}, transform: { undefined: null },
      connection: { application_name: 'afldb_i265 owner', statement_timeout: 300_000 },
    });
    ownerReady = true;

    // Target guard, part 2: every live session, before any write.
    const importProbe = postgres(importDbUrl, {
      max: 1, connect_timeout: 20, onnotice: () => {},
      connection: { application_name: 'afldb_i265 import probe' },
    });
    try {
      const live = {
        owner: await liveTarget(owner),
        import: await liveTarget(importProbe),
        auth: await liveTarget(authSql),
      };
      const problems: string[] = [];
      for (const key of ['owner', 'import', 'auth'] as const) {
        const t = live[key];
        if (t.db !== TARGET_DB) problems.push(`${key}: live database is '${t.db}'`);
        if (t.role !== expect265[key] || t.sessionRole !== expect265[key]) {
          problems.push(`${key}: live role is '${t.role}'/'${t.sessionRole}', expected '${expect265[key]}'`);
        }
        if (t.recovery) problems.push(`${key}: the server is in recovery`);
      }
      const servers = new Set(Object.values(live).map((t) => `${t.addr}:${t.port} db-oid ${t.dbOid} up ${t.postmasterStart}`));
      if (servers.size !== 1) problems.push(`the sessions reached different servers: ${[...servers].join(' | ')}`);
      if (problems.length > 0) throw new Error(`Refusing to run: ${problems.join('; ')}`);
    } finally {
      await importProbe.end({ timeout: 5 });
    }
    // The code under test reads the import DSN from here (pipeline.ts:154, :303). Restored by afterAll.
    setManagedEnv('AFLDB_IMPORT_DATABASE_URL', importDbUrl);

    // Timing is read, never assumed (§13.2). One deadlock check per wait fires at deadlock_timeout.
    const [{ deadlock_timeout: deadlockSetting }] = await owner<{ deadlock_timeout: string }[]>`SHOW deadlock_timeout`;
    deadlockTimeoutMs = settingMs(deadlockSetting);
    // A2/A3: the promotion's single check must have run (and found no cycle) before the cycle is closed.
    // The pause starts only once the harness has OBSERVED the promotion waiting, so the wait began earlier
    // and its one check fires at most deadlock_timeout after the observation; 300 ms covers the poll.
    checkPassedPauseMs = deadlockTimeoutMs + 300;

    // Reference rows the run needs and must not create.
    const sources = await owner<{ id: number; key: string }[]>`
      SELECT id::int AS id, key FROM sources WHERE key IN ('afltables', 'afl_api')
    `;
    const sourceId = (key: string) => {
      const found = sources.find((row) => row.key === key);
      if (!found) throw new Error(`sources.key = '${key}' is missing; this is not a correctly migrated afldb_test`);
      return found.id;
    };
    refs.afltablesSourceId = sourceId('afltables');
    refs.aflApiSourceId = sourceId('afl_api');
    registry = registryWithSyntheticVocabulary();

    // FAIL CLOSED: nothing of this file's may exist before it writes anything.
    const residue = nonZero(await census());
    if (Object.keys(residue).length > 0) {
      throw new Error(`Refusing to run: the reserved season ${SEASON} / namespace already holds rows: ${JSON.stringify(residue)}`);
    }
    preflightPassed = true;

    baseline = await fingerprints();

    // ---- setup; every created row is recorded the moment it exists ----
    await owner`INSERT INTO seasons (year, league, status) VALUES (${SEASON}, 'AFL', 'in_progress'::season_status)`;
    createdSeason = true;

    // Retained by convention, never deleted (match-results-promotion.test.ts:167-193). Whether this run
    // created either row is recorded for the runner's retained-record accounting.
    const seededSource = await owner<{ id: number }[]>`
      INSERT INTO sources (key, name, kind, description) VALUES (
        'sports_data_lab', 'Sports Data Lab legacy database', 'derived',
        'Legacy normalisation and derivation layer used as the migration source.'
      ) ON CONFLICT (key) DO NOTHING
      RETURNING id::int AS id
    `;
    sportsDataLabSeeded = seededSource.length === 1;
    const seededUser = await owner<{ id: number }[]>`
      INSERT INTO auth_users (email, role) VALUES (${FIXTURE_EMAIL}, 'super_admin') ON CONFLICT (email) DO NOTHING
      RETURNING id::int AS id
    `;
    fixtureUserPreexisted = seededUser.length === 0;
    const [admin] = await owner<{ id: number }[]>`SELECT id::int AS id FROM auth_users WHERE email = ${FIXTURE_EMAIL}`;
    refs.adminUserId = admin.id;

    // Two synthetic club identities, each its own organization, spanning 2078 only. `legacy_club_hist` is
    // the slug: the AFL Tables projection and the AFL API identity map both resolve through it.
    await owner.begin(async (tx) => {
      await tx`SET CONSTRAINTS clubs_current_identity_id_fkey DEFERRED`;
      for (const club of [CLUBS.home, CLUBS.away]) {
        const [organization] = await tx<{ id: number }[]>`
          INSERT INTO club_organizations (name, slug, first_season, last_season, is_active)
          VALUES (${club.name}, ${club.slug}, ${SEASON}, ${SEASON}, true)
          RETURNING id::int AS id
        `;
        const [created] = await tx<{ id: number }[]>`
          INSERT INTO clubs (slug, name, short_name, abbreviation, current_identity_id,
                             legacy_club_hist, organization_id, first_season, last_season)
          VALUES (${club.slug}, ${club.name}, ${club.name}, ${club.abbreviation}, -1,
                  ${club.slug}, ${organization.id}, ${SEASON}, ${SEASON})
          RETURNING id::int AS id
        `;
        await tx`UPDATE clubs SET current_identity_id = ${created.id} WHERE id = ${created.id}`;
        organizationIds.push(organization.id);
        clubIds.push(created.id);
      }
    });
    const resolved = await Promise.all([CLUBS.home, CLUBS.away].map((club) => resolveClub(owner, club.name, SEASON)));
    if (resolved.some((club, index) => !club || club.id !== clubIds[index])) {
      throw new Error('the synthetic club identities do not resolve to themselves for the reserved season');
    }

    const [venue] = await owner<{ id: number }[]>`
      INSERT INTO venues (slug, canonical_name, legacy_name) VALUES (${VENUE.slug}, ${VENUE.name}, ${VENUE.name})
      RETURNING id::int AS id
    `;
    venueIds.push(venue.id);

    for (const key of Object.keys(PLAYERS) as (keyof typeof PLAYERS)[]) {
      const player = PLAYERS[key];
      const [created] = await owner<{ id: number }[]>`
        INSERT INTO players (display_name, search_name, sort_name, slug, debut_season, final_season)
        VALUES (${player.name}, afldb_normalise_name(${player.name}), ${player.name}, ${player.slug}, ${SEASON}, ${SEASON})
        RETURNING id::int AS id
      `;
      playerIds.set(key, created.id);
    }
    const p = playerIds.get('p')!;
    identityPlayerIds.push(p);
    // p's trusted AFL API bridge row, and the AFL Tables identity a real importer row's player always holds.
    await owner`
      INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
      VALUES (${refs.aflApiSourceId}, ${P_PROVIDER}, ${p}, 'unique', 1, 'afl_api_stat_vector_bootstrap'),
             (${refs.afltablesSourceId}, ${P_AFLTABLES_ID}, ${p}, 'unique', 1, 'afltables_profile_url')
    `;
  }, 600_000);

  beforeEach(() => {
    if (poisoned) throw new Error(`Refusing to start this case: ${poisoned}`);
  });

  afterEach(async () => {
    await drainCase();
    // Read-only, after the drain (the case's settle has committed or rolled back) and before afterAll
    // deletes anything. A capture that fails is recorded, never thrown: it must not mask the case's result.
    // 15 s per capture keeps the drain (30 s + 90 s) plus one capture inside this hook's 150 s.
    for (const capture of forensics.splice(0)) {
      try {
        await within('forensic capture', capture(), 15_000);
      } catch (error) {
        outcomes.forensicErrors = [...(outcomes.forensicErrors as string[] | undefined ?? []), messageOf(error)];
      }
    }
    // A partial evidence file after every case, so a run killed before afterAll keeps its timings and
    // outcomes. afterAll overwrites it with the final file (no `partial` key). The runner's CLEAN verdict
    // comes from its own census, never from this file.
    try { writeEvidence({ partial: true }); } catch { /* the final write in afterAll reports a broken path */ }
  }, 150_000);

  afterAll(async () => {
    let released: string[] = [];
    let deleted: string[] = [];
    let residue: Record<string, number> | null = null;
    let fingerprintsEqual: boolean | null = null;
    let changedFingerprints: string[] = [];
    try {
      released = await releaseEverything();
      // Never delete rows this run did not first prove were absent: a refused preflight deletes nothing.
      if (!ownerReady || !preflightPassed) {
        expect(released).toEqual([]);
        return;
      }
      // Review F-003: a lingering lock must fail a teardown statement fast rather than run the hook past
      // its own bound before the evidence is written. The fingerprints are single server-side scans.
      await owner`SELECT set_config('lock_timeout', '30s', false), set_config('statement_timeout', '120s', false)`;
      deleted = await deleteTracked();
      residue = nonZero(await census());
      // No historical row was touched. No baseline means setup failed before it was taken.
      if (baseline) {
        const after = await fingerprints();
        changedFingerprints = Object.keys({ ...baseline, ...after })
          .filter((name) => JSON.stringify(after[name]) !== JSON.stringify(baseline?.[name]));
        fingerprintsEqual = changedFingerprints.length === 0;
      }
      expect([...released, ...deleted]).toEqual([]);
      expect(residue).toEqual({});
      expect(changedFingerprints).toEqual([]);
    } finally {
      try {
        writeEvidence({ teardownProblems: [...released, ...deleted], residue, fingerprintsEqual, changedFingerprints });
      } finally {
        restoreManagedEnv();
        if (ownerReady) await owner.end({ timeout: 5 });
      }
    }
  }, 600_000);

  /* ---------------------------------------------------------------- *
   * A1 — AFL Tables, shape C2 (hook-phase wait), runbook §13.2 A1
   * ---------------------------------------------------------------- */

  describe('A1: AFL Tables settle against a match_results promotion (C2)', () => {
    const a1Id = {} as Record<A1Key, number>;

    beforeAll(async () => {
      // A1 is the file's one timing-bounded case (review F-001): everything from the promotion's wait at MB
      // to the settle being observed stalled after losing MA must fit the promotion's 5 s hook bound
      // (LEGACY_LOCK_TIMEOUT, datasets.ts:559). The fixed part is the promotion's check, the margin and the
      // settle's own check; the rest (MA's record up to its UPDATE, three cleanup statements, the finding
      // INSERT, one poll) is tunnel latency, measured into timings.A1. Window 2026-10-05 15:23:57 failed
      // the old budget (§17.12). Scoped to A1 (review 2 F-004): A2/A3 have no such bound.
      if (2 * deadlockTimeoutMs + A1_CHECK_MARGIN_MS > 3000) {
        throw new Error(`deadlock_timeout = ${deadlockTimeoutMs} ms leaves under 2 s of the 5 s hook bound for A1's settle work`);
      }
      const seed = await within('A1 seed settle',
        startAfltablesSettle('A1 seed', a1Bundle(LABEL.a1Seed, A1_KEYS, A1_SEED_ATTENDANCE), T.a1Seed).promise, 100_000);
      expect(seed.counters.canonicalApplyFailures).toBe(0);
      for (const k of A1_KEYS) {
        const row = await matchRow(a1Key(k));
        if (!row || row.sourceKey !== 'afltables' || row.attendance !== A1_SEED_ATTENDANCE) {
          throw new Error(`A1 seed did not create ${k} as an afltables-owned match: ${JSON.stringify(row)}`);
        }
        a1Id[k] = row.id;
      }
      // The promotion's hook locks ascending id; the choreography needs MA < MB (§13.2 A1 step 1).
      expect(a1Id.MA).toBeLessThan(a1Id.MB);
    }, 120_000);

    it('the settle is the deadlock victim on MA, commits the rest, and the promotion times out retryably; a recovery run heals MA', async () => {
      const recordMA = A1.MA.record;
      expect(await applyFindings(A1_KEYS.map((k) => A1[k].record))).toEqual([]);
      const fileRow = (k: A1Key): Payload => ({
        season: String(SEASON), round_code: String(A1[k].round), round_number: String(A1[k].round),
        match_date: A1[k].date, venue: A1_VENUE_RAW, home_club: CLUBS.home.name, away_club: CLUBS.away.name,
        home_score: '100', away_score: '72', home_goals: '15', home_behinds: '10', away_goals: '10', away_behinds: '12',
      });
      const fileId = await stageApprovedFile('match_results', [fileRow('MA'), fileRow('MB')]);
      const maFindingKey = canonicalApplyIssueKey('afltables', 'match', recordMA, 'matches');
      const a1: Record<string, number> = { deadlockTimeoutMs, checkMarginMs: A1_CHECK_MARGIN_MS };
      timings.A1 = a1;

      // Step 2 (revised after window 2026-10-05 15:23:57, runbook §17.12). Both side transactions sit as
      // close to MA as a lock allows, so the promotion's 5 s window holds only MA's own work:
      //   X holds MA's spine record: the settle stops at the first statement of MA's record, with MB and MC
      //     already written and held. (X on MC left a whole MC unit plus MA's record inside the window.)
      //   Y holds MA's open finding key, uncommitted: after losing MA the settle's next statements are three
      //     savepoint cleanups (the driver's `rollback to sN`, then the anchor's ROLLBACK TO and RELEASE,
      //     canonical-apply.ts:1273-1274) and then this INSERT, so it stalls at once, inside its failure path, still
      //     holding MB. (Y on MD left MA's failure path plus all of MD's record inside the window.)
      // Neither touches a match row, and neither changes any lock the settle or the promotion takes.
      const X = await hold('A1 X on the MA spine record', lockSpineRecord(recordMA));
      const Y = await hold('A1 Y on the MA finding key', holdOpenFinding(maFindingKey, a1Id.MA));

      // Step 3: feed order MB, MC, MA, MD. The settle writes MB and MC, then waits on X at MA's spine record.
      const settle = startAfltablesSettle('A1 settle', a1Bundle(LABEL.a1Run, ['MB', 'MC', 'MA', 'MD'], A1_RUN_ATTENDANCE), T.a1Run);
      const settlePid = await waitUntil('A1: the settle queues behind X at the MA spine record', () => newWaiterBehind(X.pid), [settle]);

      // Step 4: the promotion's hook takes MA FOR NO KEY UPDATE (lower id; datasets.ts:776; nothing holds MA)
      // and waits on MB, which the settle holds.
      const promotionStarted = Date.now();
      const promotion = startPromotion('A1 promotion', fileId);
      forensics.push(async () => {
        outcomes.A1 = {
          settle: settle.outcome?.ok
            ? {
              applied: settle.outcome.value.applied,
              batchId: settle.outcome.value.batchId,
              canonicalApplyFailures: settle.outcome.value.counters.canonicalApplyFailures,
              canonicalRetryApplied: settle.outcome.value.counters.canonicalRetryApplied,
              dataIssuesOpened: settle.outcome.value.counters.dataIssuesOpened,
            }
            : describeRun(settle as Run<unknown>),
          promotion: describeRun(promotion as Run<unknown>),
          findings: await applyFindings(A1_KEYS.map((k) => A1[k].record)),
          attendance: Object.fromEntries(await Promise.all(
            A1_KEYS.map(async (k) => [k, (await matchRow(a1Key(k)))?.attendance ?? null] as const),
          )),
        };
      });
      const promotionPid = await waitUntil(
        'A1: the promotion queues behind the settle on MB', () => newWaiterBehind(settlePid), [settle, promotion],
      );
      const promotionWait = await waitUntil(
        'A1: the promotion\'s wait on MB is stamped', () => waitingOn(promotionPid, settlePid), [settle, promotion],
      );
      // Review F-002, from the same snapshot: a wait on the settle's transaction, not a tuple-lock queue place.
      expect({ label: 'A1 promotion at MB', waits: promotionWait.waits, blockers: promotionWait.blockers })
        .toEqual({ label: 'A1 promotion at MB', waits: ['transactionid'], blockers: [settlePid] });
      const promotionWaitStart = promotionWait.waitStartMs as number;
      a1.promotionStartToObservedClientMs = Date.now() - promotionStarted;
      a1.promotionWaitToObservedMs = promotionWait.serverNowMs - promotionWaitStart;

      // Step 5: release X once the promotion's one deadlock check has run (server clock). The settle then
      // runs MA's record up to its UPDATE of MA, waits on the promotion's lock and so closes the cycle; one
      // deadlock_timeout later its own check finds the cycle and it is the victim.
      const releaseInMs = Math.max(0, promotionWaitStart + deadlockTimeoutMs + A1_CHECK_MARGIN_MS - promotionWait.serverNowMs);
      await pause(releaseInMs);
      // Planned, on the server clock; X's COMMIT lands half to one round trip later (review 2 F-005).
      a1.promotionWaitToXReleasePlannedMs = promotionWait.serverNowMs - promotionWaitStart + releaseInMs;
      X.go();

      // The cycle, observed directly: the settle waits on the promotion's transaction, at MA. Its wait began
      // after the promotion's check had run, so the promotion cannot be the victim; the settle's check,
      // deadlock_timeout after this wait began, is the one that finds the cycle.
      const cycle = await waitUntil(
        'A1: the settle closes the cycle, queued behind the promotion at MA', () => waitingOn(settlePid, promotionPid),
        [settle, promotion],
      );
      expect({ label: 'A1 settle at MA', waits: cycle.waits, blockers: cycle.blockers })
        .toEqual({ label: 'A1 settle at MA', waits: ['transactionid'], blockers: [promotionPid] });
      const settleCycleWaitStart = cycle.waitStartMs as number;
      a1.promotionWaitToSettleCycleWaitMs = settleCycleWaitStart - promotionWaitStart;
      expect(settleCycleWaitStart - promotionWaitStart).toBeGreaterThan(deadlockTimeoutMs);

      // The ordering (review 2 F-001), proven on the SERVER: the settle reached its stall before the promotion
      // finished. Shown by one lock-manager snapshot in which the settle, having lost MA, already waits on Y
      // while the promotion is STILL in its original MB wait (same waitstart as observed above). A promotion
      // still waiting has not finished: its hook statement, its rollback, the 'failed' write and its COMMIT
      // all come after that wait ends. No client receive time decides this. The promotion's completion
      // itself carries no server timestamp (the 'failed' UPDATE, pipeline.ts:427-431, writes none; now() is
      // its transaction START), so it is bounded below by the end of that wait, bracketed further down.
      // Fail fast, also on the server: a snapshot where the promotion's MB wait has ended (or is a different
      // wait) before the settle is seen on Y means the ordering did not hold.
      const both = await waitUntil(
        'A1: the settle (MA lost) queues behind Y on MA\'s finding while the promotion still waits on MB',
        async () => {
          const snapshot = await orderingSnapshot(settlePid, Y.pid, promotionPid);
          const promotionStillInItsWait = sameWaitStart(snapshot.promotionOnSettleMs, promotionWaitStart);
          if (snapshot.settleOnHolderMs !== null && promotionStillInItsWait) return snapshot;
          if (!promotionStillInItsWait) {
            a1.promotionWaitEndedBeforeStallSeenServerMs = snapshot.serverNowMs - promotionWaitStart;
            throw new Error(
              'A1: the promotion\'s MB wait had ended (or was no longer the observed wait) before any server snapshot '
              + `showed the settle stalled on Y: snapshot ${Math.round(snapshot.serverNowMs - promotionWaitStart)} ms `
              + `after the promotion's wait began; promotion edge present ${snapshot.promotionOnSettlePresent}; `
              + `settle on Y ${!snapshot.settleOnHolderPresent ? 'absent'
                : snapshot.settleOnHolderMs === null ? 'present, waitstart not yet stamped' : 'present'}`,
            );
          }
          return null;
        },
        [settle],
      );
      const settleStallWaitStart = both.settleOnHolderMs as number;
      a1.promotionWaitToSettleStalledMs = settleStallWaitStart - promotionWaitStart;
      a1.promotionWaitToOrderingSnapshotMs = both.serverNowMs - promotionWaitStart;
      a1.settleCycleWaitToStalledMs = settleStallWaitStart - settleCycleWaitStart;
      a1.stallObservedClientMs = Date.now() - promotionStarted;
      // Recorded, not asserted (follow-up F-002): clock_timestamp() may be evaluated a moment before the CTE
      // reads pg_locks, so this delta can be a few microseconds negative. The proof is the co-occurrence of
      // both edges in the one snapshot, which the probe already required.
      a1.settleStallToOrderingSnapshotMs = both.serverNowMs - settleStallWaitStart;

      // Server-side bracket for the END of the promotion's MB wait (its lock_timeout expiry, armed at its
      // waitstart): the last snapshot still showing that wait and the first one without it. Evidence of when
      // the promotion stopped waiting, on the same clock as every other A1 reading; its completion follows.
      // The pair should straddle 5000 ms, the empirical check that waitstart is the lock_timeout origin.
      let lastSeenWaiting = both.serverNowMs;
      const firstSeenEnded = await waitUntil('A1: the promotion\'s MB wait ends (server)', async () => {
        const snapshot = await orderingSnapshot(settlePid, Y.pid, promotionPid);
        if (sameWaitStart(snapshot.promotionOnSettleMs, promotionWaitStart)) {
          lastSeenWaiting = snapshot.serverNowMs;
          return null;
        }
        return snapshot.serverNowMs;
      }, [settle], 20_000);
      a1.promotionWaitToWaitLastSeenMs = lastSeenWaiting - promotionWaitStart;
      a1.promotionWaitToWaitEndedSeenMs = firstSeenEnded - promotionWaitStart;
      // Recorded, not asserted: implied by the snapshot proof above, and subject to the same
      // microsecond evaluation-order window as settleStallToOrderingSnapshotMs.
      a1.settleStallToWaitLastSeenMs = lastSeenWaiting - settleStallWaitStart;

      // Step 6: Y holds the settle open past the promotion's 5 s bound (review F-003).
      const promoted = await within('A1 promotion (5 s hook bound)', promotion.promise, 30_000);
      const promotionElapsed = (promotion.finishedAt ?? Date.now()) - promotionStarted;
      a1.promotionElapsedMs = promotionElapsed;
      expect(settle.done).toBe(false);
      Y.abort();
      const result = await within('A1 settle after Y', settle.promise, 60_000);
      expect(await within('A1 X', X.outcome, 30_000)).toBeNull();
      expect(await within('A1 Y', Y.outcome, 30_000)).toBeInstanceOf(HeldAborted);

      // Step 7: the settle committed with exactly one failed unit, MA's.
      expect(result.applied).toBe(true);
      expect(result.counters.canonicalApplyFailures).toBe(1);
      const opened = await applyFindings(A1_KEYS.map((k) => A1[k].record));
      const open = opened.filter((finding) => finding.resolvedAt === null);
      expect(open.length).toBeGreaterThanOrEqual(1);
      expect(open.every((finding) => finding.externalRecordId === recordMA)).toBe(true);
      expect(open.map((finding) => finding.issueKey))
        .toContain(canonicalApplyIssueKey('afltables', 'match', recordMA, 'matches'));
      for (const finding of open) expect(finding.error ?? '').toMatch(/deadlock detected/i);

      // MA unchanged; MB and MC applied (MD too, after Y).
      expect((await matchRow(a1Key('MA')))?.attendance).toBe(A1_SEED_ATTENDANCE);
      for (const k of ['MB', 'MC', 'MD'] as const) expect((await matchRow(a1Key(k)))?.attendance).toBe(A1_RUN_ATTENDANCE);

      // The promotion: refused retryably by its 5 s hook bound (not a deadlock victim), nothing written,
      // and only after the settle had already lost MA and moved on.
      expect(promoted.ok).toBe(false);
      expect(promoted.ok ? '' : promoted.error).toContain(LEGACY_PROMOTION_LOCK_REFUSAL);
      const failed = await submissionState(fileId);
      expect(failed.status).toBe('failed');
      expect(failed.error ?? '').toContain(LEGACY_PROMOTION_LOCK_REFUSAL);
      expect(await promotionBatchCount(fileId)).toBe(0);
      expect(promotionElapsed).toBeGreaterThanOrEqual(4500);
      expect(promotionElapsed).toBeLessThan(20_000);
      // "The settle reached Y before the promotion resolved" is proven above on the server clock (one
      // lock-manager snapshot); it no longer rests on when this process received either response.

      // Step 8, recovery: the same bundle again. MA's payload has not moved, so the §9.3 retry applies it.
      const recovery = await within('A1 recovery settle', startAfltablesSettle(
        'A1 recovery', a1Bundle(LABEL.a1Recovery, ['MB', 'MC', 'MA', 'MD'], A1_RUN_ATTENDANCE), T.a1Recovery,
      ).promise, 60_000);
      expect(recovery.counters.canonicalApplyFailures).toBe(0);
      expect(recovery.counters.canonicalRetryApplied).toBeGreaterThanOrEqual(1);
      expect((await matchRow(a1Key('MA')))?.attendance).toBe(A1_RUN_ATTENDANCE);
      const healed = await applyFindings(A1_KEYS.map((k) => A1[k].record));
      expect(healed.filter((finding) => finding.resolvedAt === null)).toEqual([]);
      for (const key of open.map((finding) => finding.issueKey)) {
        expect(healed.filter((finding) => finding.issueKey === key).map((finding) => finding.resolution))
          .toEqual(['canonical_apply_succeeded']);
      }

      // Re-promotion is then possible.
      expect(await within('A1 re-promotion', startPromotion('A1 re-promotion', fileId).promise, 30_000))
        .toMatchObject({ ok: true });
      expect((await submissionState(fileId)).status).toBe('promoted');
    }, 180_000);
  });

  /* ---------------------------------------------------------------- *
   * A2, A3 — AFL API (runbook §13.2 A2, A3)
   * ---------------------------------------------------------------- */

  describe('AFL API settle against a player_match_stats promotion', () => {
    const apiId = {} as Record<ApiKey, number>;
    const seedUnit = (key: ApiKey): ApiUnit => ({ key, venueName: API_VENUE_SEED, line: SEED_LINE });

    beforeAll(async () => {
      const seed = await within('AFL API seed settle',
        startAflApiSettle('AFL API seed', apiBundle(LABEL.apiSeed, API_KEYS.map(seedUnit)), T.apiSeed).promise, 100_000);
      expect(seed.counters.canonicalApplyFailures).toBe(0);
      const p = playerIds.get('p')!;
      for (const k of API_KEYS) {
        const row = await matchRow(apiKey(k));
        if (!row || row.sourceKey !== 'afl_api' || row.venueRaw !== API_VENUE_SEED) {
          throw new Error(`the AFL API seed did not create ${k} as an afl_api-owned match: ${JSON.stringify(row)}`);
        }
        apiId[k] = row.id;
        const stats = await statsRow(p, apiKey(k));
        if (!stats || stats.sourceKey !== 'afl_api' || stats.kicks !== SEED_LINE.kicks) {
          throw new Error(`the AFL API seed did not write p's afl_api row on ${k}: ${JSON.stringify(stats)}`);
        }
      }
    }, 120_000);

    it('A2 (C1): the M2 unit loses, the promotion stays blocked by the settle while M3 stalls it, then succeeds; a recovery run heals M2', async () => {
      const p = playerIds.get('p')!;
      const q = playerIds.get('q')!;
      const a2Units: ApiUnit[] = [
        { key: 'M1', venueName: API_VENUE_SEED, line: A2_LINE }, // match unchanged, p changed
        { key: 'M2', venueName: API_VENUE_A2, line: SEED_LINE }, // match changed
        { key: 'M3', venueName: API_VENUE_A2, line: SEED_LINE }, // match changed; stalled by Y
      ];
      const m2Finding = canonicalApplyIssueKey('afl_api', 'match', API.M2.id, 'matches');
      expect(await applyFindings(TRACKED_PROVIDER_MATCH_IDS)).toEqual([]);

      // Step 3: (p, M1) equal to the settle's values, so recovery stays clean, and one row on M2 (q).
      const fileId = await stageApprovedFile('player_match_stats', [
        statsFileRow('M1', 'p', legacyStats(A2_LINE)),
        statsFileRow('M2', 'q', { goals: '2' }),
      ]);

      // Step 2: X holds M2 FOR SHARE (compatible with the hook); Y will stall the settle at M3.
      const X = await hold('A2 X on M2', lockMatch(apiId.M2, 'FOR SHARE'));
      const Y = await hold('A2 Y on M3', lockMatch(apiId.M3, 'FOR SHARE'));

      // Step 4: the settle writes (p, M1), then waits on X for M2.
      const settle = startAflApiSettle('A2 settle', apiBundle(LABEL.a2Run, a2Units), T.a2Run);
      const settlePid = await waitUntil('A2: the settle queues behind X on M2', () => newWaiterBehind(X.pid), [settle]);

      // Step 5: the promotion's hook passes (FOR SHARE on M1, M2), then its (p, M1) row waits on the settle.
      const promotion = startPromotion('A2 promotion', fileId);
      const promotionPid = await waitUntil(
        'A2: the promotion queues behind the settle at (p, M1)', () => newWaiterBehind(settlePid), [settle, promotion],
      );
      // §17.8 item 2, directly (review F-002): the promotion's FOR SHARE on M2 did NOT queue on the M2 tuple
      // lock the settle's waiting UPDATE holds; it waits on the settle's transaction, at (p, M1).
      await expectWaitsOnTransactionOf('A2 promotion at (p, M1)', promotionPid, settlePid);

      // Step 6: the promotion's check passes; releasing X leaves the promotion's FOR SHARE as the settle's
      // new blocker, so the settle gets a fresh check and is the victim (review F-004).
      await pause(checkPassedPauseMs);
      X.go();
      await waitUntil('A2: the settle (M2 lost) queues behind Y on M3', () => isBehind(Y.pid, settlePid), [settle, promotion]);

      // Step 7, in-run retry futility (§11): the M2 unit has rolled back, yet the promotion is STILL blocked
      // by the settle, on a row an earlier, committed-to-the-run unit holds.
      expect(promotion.done).toBe(false);
      expect(await reachOf(settlePid)).toContain(promotionPid);
      await pause(300);
      expect(promotion.done).toBe(false);
      expect(await reachOf(settlePid)).toContain(promotionPid);

      Y.go();
      const result = await within('A2 settle after Y', settle.promise, 60_000);
      const promoted = await within('A2 promotion after the settle commits', promotion.promise, 30_000);
      expect(await within('A2 X', X.outcome, 30_000)).toBeNull();
      expect(await within('A2 Y', Y.outcome, 30_000)).toBeNull();

      expect(result.applied).toBe(true);
      expect(result.counters.canonicalApplyFailures).toBe(1);
      const open = (await applyFindings(TRACKED_PROVIDER_MATCH_IDS)).filter((finding) => finding.resolvedAt === null);
      expect(open.map((finding) => finding.issueKey)).toEqual([m2Finding]);
      expect(open[0].error ?? '').toMatch(/deadlock detected/i);
      expect((await matchRow(apiKey('M2')))?.venueRaw).toBe(API_VENUE_SEED);
      expect((await matchRow(apiKey('M3')))?.venueRaw).toBe(API_VENUE_A2);
      expect((await matchRow(apiKey('M1')))?.venueRaw).toBe(API_VENUE_SEED);

      // After the commit, the promotion succeeds.
      expect(promoted).toMatchObject({ ok: true });
      expect((await submissionState(fileId)).status).toBe('promoted');
      expect(await statsRow(p, apiKey('M1'))).toMatchObject({ kicks: A2_LINE.kicks, disposals: A2_LINE.disposals });
      expect(await statsRow(q, apiKey('M2'))).toMatchObject({ goals: 2 });

      // Step 8, recovery: the next run applies M2 and closes the finding.
      const recovery = await within('A2 recovery settle',
        startAflApiSettle('A2 recovery', apiBundle(LABEL.a2Recovery, a2Units), T.a2Recovery).promise, 60_000);
      expect(recovery.counters.canonicalApplyFailures).toBe(0);
      expect((await matchRow(apiKey('M2')))?.venueRaw).toBe(API_VENUE_A2);
      const healed = (await applyFindings(TRACKED_PROVIDER_MATCH_IDS)).filter((finding) => finding.issueKey === m2Finding);
      expect(healed.map((finding) => [finding.resolvedAt !== null, finding.resolution]))
        .toEqual([[true, 'canonical_apply_succeeded']]);
      expect(await statsRow(p, apiKey('M1'))).toMatchObject({ kicks: A2_LINE.kicks, disposals: A2_LINE.disposals });
    }, 180_000);

    it('A3 (F-265-1): the attendance enrichment loses to the promotion and the whole AFL API run rolls back', async () => {
      const p = playerIds.get('p')!;
      const a3Units: ApiUnit[] = [
        { key: 'M4', venueName: API_VENUE_SEED, line: A3_LINE }, // match unchanged, p changed: the C1 row
        { key: 'M5', venueName: API_VENUE_A3, line: SEED_LINE }, // match changed; stalled by Z
      ];
      const m4Key = apiKey('M4');

      // The fixture: a complete AFL Tables attendance row for the afl_api-owned M4, keyed (as the AFL Tables
      // match family is) by the match key, with the spine version its ledger row would cite.
      fixtureSpineKeys.add(m4Key);
      const [fixtureBatch] = await owner<{ id: string }[]>`
        INSERT INTO import_batches (source_id, tool, target_table, notes)
        VALUES (${refs.afltablesSourceId}, ${FIXTURE_TOOL}, 'staging.source_record_versions', ${`${TAG} A3 enrichment fixture`})
        RETURNING id::text AS id
      `;
      fixtureBatchIds.add(fixtureBatch.id);
      await owner.begin(async (tx) => {
        await persistSourceObservation(tx, {
          contract: getSourceFamily(registry, 'afltables', 'match'),
          sourceId: refs.afltablesSourceId,
          externalRecordId: m4Key,
          scopeKey: `${AFLT_NS}a3-enrichment`,
          payload: { issue265_fixture: true, season: SEASON, round_code: apiRoundCode('M4'), match_date: API.M4.date, attendance: 30123 },
        }, asImportBatchId(fixtureBatch.id), T.a3Fixture);
        const [head] = await tx<{ versionSeq: number }[]>`
          SELECT current_version_seq AS "versionSeq" FROM staging.source_records
           WHERE source_id = ${refs.afltablesSourceId} AND family = 'match' AND external_record_id = ${m4Key}
        `;
        await tx`
          INSERT INTO staging.afltables_match (
            source_id, family, external_record_id, version_seq,
            season, round_code, round_number, round_type, is_final, match_date,
            venue_raw, home_club_id, away_club_id, home_score, away_score,
            result, winner_club_id, margin, attendance, attendance_status, attendance_source_id, projected_by_batch_id
          ) VALUES (
            ${refs.afltablesSourceId}, 'match', ${m4Key}, ${head.versionSeq},
            ${SEASON}, ${apiRoundCode('M4')}, ${API.M4.apiRound}, 'home_and_away'::round_type, false, ${API.M4.date},
            ${VENUE.name}, ${clubIds[0]}, ${clubIds[1]}, 80, 66,
            'home_win'::match_result, ${clubIds[0]}, 14, 30123, 'complete'::coverage_status, ${refs.afltablesSourceId},
            ${fixtureBatch.id}
          )
        `;
      });

      const fileId = await stageApprovedFile('player_match_stats', [statsFileRow('M4', 'p', { goals: '3' })]);

      const snapshot = async () => {
        const [counts] = await owner<{ versions: number; ledger: number; issues: number; batches: number }[]>`
          SELECT
            (SELECT count(*) FROM staging.source_record_versions
              WHERE source_id = ${refs.aflApiSourceId}
                AND external_record_id = ANY(${[API.M4.id, API.M5.id, apiPlayerRecord('M4'), apiPlayerRecord('M5')]}::text[]))::int AS versions,
            (SELECT count(*) FROM canonical_applications WHERE external_record_id LIKE ANY(${RECORD_LIKE}::text[]))::int AS ledger,
            (SELECT count(*) FROM data_issues WHERE issue_key LIKE ANY(${ISSUE_LIKE}::text[]))::int AS issues,
            (SELECT count(*) FROM import_batches WHERE notes LIKE ${`%snapshot=${LABEL.a3Run};%`})::int AS batches
        `;
        const m4 = await matchRow(m4Key);
        return {
          ...counts,
          m4Attendance: m4?.attendance ?? null,
          m5Venue: (await matchRow(apiKey('M5')))?.venueRaw ?? null,
        };
      };
      const before = await snapshot();
      expect(before.batches).toBe(0);

      const Z = await hold('A3 Z on M5', lockMatch(apiId.M5, 'FOR SHARE'));
      // The settle writes (p, M4) under FOR SHARE on M4, then waits on Z at M5.
      const settle = startAflApiSettle('A3 settle', apiBundle(LABEL.a3Run, a3Units), T.a3Run);
      const settlePid = await waitUntil('A3: the settle queues behind Z on M5', () => newWaiterBehind(Z.pid), [settle]);
      // C1: the promotion holds M4 FOR SHARE (its hook) and waits on the (p, M4) row the settle wrote.
      const promotion = startPromotion('A3 promotion', fileId);
      const promotionPid = await waitUntil(
        'A3: the promotion queues behind the settle at (p, M4)', () => newWaiterBehind(settlePid), [settle, promotion],
      );
      await expectWaitsOnTransactionOf('A3 promotion at (p, M4)', promotionPid, settlePid);

      // Its check passes; then the settle finishes M5 and reaches the enrichment, whose FOR UPDATE on M4
      // (canonical-apply.ts:1394-1401, before every gate) closes the cycle. The 40P01 is rethrown.
      await pause(checkPassedPauseMs);
      Z.go();
      const outcome = await within('A3 settle after Z', settled(settle), 60_000);
      const promoted = await within('A3 promotion after the settle rolls back', promotion.promise, 30_000);
      expect(await within('A3 Z', Z.outcome, 30_000)).toBeNull();

      expect(outcome.ok).toBe(false);
      expect(outcome.ok ? null : sqlstate(outcome.error)).toBe('40P01');
      expect(outcome.ok ? '' : messageOf(outcome.error)).toMatch(/deadlock detected/i);

      // Nothing from the run persists, its import_batches row included; the promotion then succeeds.
      expect(await snapshot()).toEqual(before);
      expect(promoted).toMatchObject({ ok: true });
      expect((await submissionState(fileId)).status).toBe('promoted');
      // The settle's kicks/disposals for (p, M4) were rolled back; the promotion's goals landed.
      expect(await statsRow(p, m4Key)).toMatchObject({ kicks: SEED_LINE.kicks, disposals: SEED_LINE.disposals, goals: 3 });
    }, 180_000);
  });
});
