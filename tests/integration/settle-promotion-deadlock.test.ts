/**
 * AFLDB-ISSUE-265 Phase B — acceptance of the settle / legacy-promotion advisory gate, driven through the REAL
 * settles (`runSettleAfltables`, `runSettleAflApi`) and the REAL promotion pipeline (`promoteSubmission`).
 *
 * CONTRACT. `issues/open/AFLDB-ISSUE-265.md` §12 (design), §18 (plan), §19 (B1–B11), §20 (timeouts, queue
 * behaviour), decisions D-265-1..15. Phase B REPLACES Phase A (§17.15). The Phase A harness this file started
 * from is committed at 62f2cd67 (the S0 checkpoint), together with its runner and probe under
 * `issues/open/AFLDB-ISSUE-265-phase-a/`; window 2 (2026-10-05 16:22:35) ran it on the base tree. Phase A
 * asserted the deadlock; each of those assertions is a lock edge the gate removes, so Phase A must not run
 * again on this tree and this file runs Phase B only.
 *
 * WHAT IS UNDER TEST. A settle takes `pg_advisory_xact_lock_shared(717275, 4)` as the first call in its
 * transaction (`acquireSettlePromotionGate`, settle-core.ts), bounded by a 300 s `lock_timeout` and a 330 s
 * `statement_timeout` for that statement only. The three legacy match writers (`match_results`,
 * `player_match_stats`, `match_attendance`) take `pg_advisory_xact_lock(717275, 4)` inside
 * `withLegacyLockTimeout` (datasets.ts), under the 5 s hook bound and before any match lock. So a settle and a
 * promotion never hold match row locks at the same time.
 *
 * CASES (runbook §19.2). B1 and B2 AFL Tables · match_results; B3 and B4 AFL API · player_match_stats (B4 is
 * F-265-1, the attendance enrichment); B5 match_attendance (the third writer; it runs LAST because it changes
 * attendance on matches the other AFL API cases settle); B6 a settle waits behind a stuck promotion; B7 the
 * full 300 s timeout, rollback and connection reuse for both providers; B8 concurrent settles and a rolled-back
 * settle releasing the gate; B9 promotions serialise; B10 the helper restores both previous settings; B11 both
 * advisory-lock queue shapes.
 *
 * PHASE GATING. This file runs ONLY when the dedicated Phase B runner
 * (D:\tmp\issue265\Invoke-Issue265PhaseB.ps1) arms it. All of these must hold:
 *
 *   AFLDB_ISSUE265_PHASE=B;
 *   AFLDB_ISSUE265_ARMED_AT = the epoch milliseconds at which the runner launched vitest, at most 15 min
 *     old: an AFLDB_ISSUE265_PHASE left set in a shell cannot arm a later, unrelated vitest run on its own.
 *     B7 alone takes about 5.5 minutes, and the whole phase about 10 to 12, so a runner that starts vitest
 *     promptly stays inside the window; the stamp is only checked at module load;
 *   AFLDB_TEST_DATABASE_URL, AFLDB_AUTH_DATABASE_URL and AFLDB_TEST_IMPORT_DATABASE_URL set.
 *
 * A stale `AFLDB_ISSUE265_PHASE=A` arms nothing: every case is skipped and the runner, which expects a
 * non-zero count of passed tests, fails loudly. Otherwise every case is skipped and NOTHING is imported that
 * opens a connection: the shared connection guard (`./guard`) is imported dynamically inside the gated
 * `beforeAll`, not at module top as the other integration suites do, because a static import connects (and
 * throws when the DSN is absent). No other module this file reaches opens a connection on import. A skipped
 * run is not evidence of anything.
 *
 * REFUSES ON A TREE WITHOUT THE GATE. Before any connection, `beforeAll` checks the source text: both settles
 * call `acquireSettlePromotionGate` as the first call of their transaction, and `withLegacyLockTimeout` takes
 * the exclusive gate. Phase B therefore cannot run, and fail confusingly, on the base tree.
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
 * players only) can reach no historical row. The AFL Tables matches (MA to MD) use rounds 1–4; the AFL API
 * matches (M1 to M5) use rounds 5–9 with different dates, so no AFL API insert sees an AFL Tables match as a
 * plausible existing fixture (`findPlausibleCanonicalFixtures`: same clubs and at most one of round/date
 * differing).
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
 * ONE VALUE, TWO WRITERS. A promotion and a settle that touch the same row write the SAME value (a promotion's
 * file row equals the line or projection the settle writes or already stored), so a promotion that succeeds
 * never leaves a canonical row the next settle would read as drift. A promotion is refused or succeeds; it is
 * never what changes a value.
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
 *   import_batches of every settle run and of the B4 fixture, data_submissions (rows cascade),
 *   external_identities, players, clubs, club_organizations, the venue and the 2078 seasons row.
 *   Retained by convention (ISSUE-264 §14.3 "Retained test records"; submission-promotion.test.ts and
 *   match-results-promotion.test.ts): the fixture auth_users row (deleting it races a concurrent run); the
 *   `sources` 'sports_data_lab' row if this run had to seed it (migration-057 idiom, never deleted); and the
 *   `import_batches` rows with tool 'admin-upload' that the successful promotions write (notes
 *   'submission <id>'; import_batches is append-only and nothing references them after teardown).
 *   A full pass retains exactly EXPECTED_RETAINED_BATCHES of them: one per successful promotion (B1 1, B2 1,
 *   B3 1, B4 1, B5 1, B6 1, B7 1, B8 1, B9 4, B11 2). A REFUSED promotion rolls back and writes none.
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
 * TWO SETTLES AT ONCE. B8 and B11 hold two settles open together to show their gate locks side by side.
 * They are released one after the other, never together: two settles' end-of-run recomputes running at the
 * same moment is the separate, pre-existing ISSUE-261 contention, not what these cases test.
 *
 * EVIDENCE. With AFLDB_ISSUE265_EVIDENCE_FILE set, the teardown writes the retained-record accounting
 * (the admin-upload batches by id, whether the fixture user and the sports_data_lab source pre-existed),
 * the tracked ids, any teardown problem, the residue census and which fingerprints changed, plus each case's
 * timings. The runner reconciles it with its own independent census.
 *
 * OPERATOR COMMAND (not run by the author; inside a guarded afldb_test window, runbook §19, §21):
 *   powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\tmp\issue265\Invoke-Issue265PhaseB.ps1 `
 *     -Phase Preflight -TunnelHost 127.0.0.1 -TunnelPort 55432
 *   (then -Phase Full with the same endpoint)
 *
 * @see issues/open/AFLDB-ISSUE-265.md §10-§20
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
import {
  acquireSettlePromotionGate,
  canonicalApplyIssueKey,
  renderMatchKey,
  SETTLE_PROMOTION_GATE,
  SETTLE_PROMOTION_GATE_WAIT_MS,
  SettlePromotionGateTimeout,
} from '@/lib/acquisition/settle-core';
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

const PHASE_B_REQUESTED = process.env.AFLDB_ISSUE265_PHASE === 'B';
/**
 * How long the runner's arming stamp stays valid. It is checked once, when this module loads (the runner
 * launches vitest straight after stamping), so the length of the run itself does not matter.
 */
const ARM_WINDOW_MS = 15 * 60_000;
const armedAt = Number(process.env.AFLDB_ISSUE265_ARMED_AT ?? '');
const ARMED = Number.isSafeInteger(armedAt) && armedAt > 0
  && Date.now() - armedAt <= ARM_WINDOW_MS && armedAt - Date.now() <= 60_000;
const testDbUrl = process.env.AFLDB_TEST_DATABASE_URL ?? '';
const importDbUrl = process.env.AFLDB_TEST_IMPORT_DATABASE_URL ?? '';
const DSNS_PRESENT = testDbUrl !== '' && importDbUrl !== '' && Boolean(process.env.AFLDB_AUTH_DATABASE_URL);
const RUN_PHASE_B = PHASE_B_REQUESTED && ARMED && DSNS_PRESENT;

if (PHASE_B_REQUESTED && !RUN_PHASE_B) {
  const why = [
    ARMED ? null : 'AFLDB_ISSUE265_ARMED_AT is missing, invalid or older than 15 minutes',
    DSNS_PRESENT ? null : 'a required DSN is not set',
  ].filter(Boolean).join('; ');
  console.warn(
    `AFLDB-ISSUE-265 Phase B was requested but ${why}; every case is skipped. `
    + 'Run it through the dedicated runner. A skipped run is not evidence.',
  );
} else if (process.env.AFLDB_ISSUE265_PHASE === 'A') {
  console.warn(
    'AFLDB-ISSUE-265 Phase A is retired (runbook §17.15): it asserted the deadlock the gate removes, so it cannot run '
    + 'on this tree. Every case is skipped. The Phase A harness is committed at 62f2cd67.',
  );
}

/** One admin-upload batch is retained per successful promotion; see the header for the per-case count. */
const EXPECTED_RETAINED_BATCHES = 14;
/** The number of cases B1 to B11. */
const EXPECTED_TESTS = 11;

/** Refuses a tree without the gate, before any connection: the Phase B assertions would be meaningless on it. */
function assertGateInSource(): void {
  const read = (file: string) => readFileSync(file, 'utf8');
  const problems: string[] = [];
  for (const file of ['src/lib/acquisition/settle-afltables.ts', 'src/lib/acquisition/settle-afl-api.ts']) {
    const text = read(file);
    if (text.split('await sql.begin(async (tx) => {').length !== 2
      || !/await sql\.begin\(async \(tx\) => \{\s*(\/\/[^\n]*\s*)*await acquireSettlePromotionGate\(tx\);/.test(text)) {
      problems.push(`${file} does not call acquireSettlePromotionGate(tx) first in its transaction`);
    }
  }
  const datasets = read('src/lib/ingest/datasets.ts');
  const start = datasets.indexOf('async function withLegacyLockTimeout');
  // The function ends at the first closing brace on its own line; a checkout may use CRLF endings.
  const end = start < 0 ? -1 : datasets.slice(start).search(/\r?\n\}\r?\n/);
  const body = start < 0 || end < 0 ? '' : datasets.slice(start, start + end);
  if (!/pg_advisory_xact_lock\(\$\{SETTLE_PROMOTION_GATE\.classId\}/.test(body) || body.includes('_shared')) {
    problems.push('src/lib/ingest/datasets.ts withLegacyLockTimeout does not take the exclusive gate');
  }
  if (problems.length > 0) throw new Error(`Refusing to run Phase B: ${problems.join('; ')}.`);
}

/** Counts the settle runs this file starts, so each has a unique label and a strictly increasing observation time. */
let runCounter = 0;

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

/* -- AFL Tables matches. Seeded in this order, so ids ascend MA < MB < MC < MD. -- */

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
const a1Key = (k: A1Key): string =>
  renderMatchKey(SEASON, String(A1[k].round), A1[k].date, CLUBS.home.name, CLUBS.away.name);

/* -- AFL API matches. May dates: Australia/Melbourne is AEST (UTC+10), so 05:10Z is 15:10. -- */

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
/** AFL Tables spine record ids the B4 fixture writes: the M4 match key (the enrichment's own identity). */
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
 * Measured choreography gaps, written to the evidence file. Each case fills its entry step by step, so a
 * window that fails part-way still records how far it got.
 */
const timings: Record<string, Record<string, number>> = {};
/**
 * What each case's settle and promotion actually did, written to the evidence file pass or fail. The
 * 2026-10-05 15:23:57 Phase A window failed and the teardown then deleted the settle's batch and findings, so
 * which ordering occurred could not be recovered (runbook §17.12); a case that registers a forensic capture
 * here keeps that evidence.
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

/**
 * A fresh single-connection client on the owner DSN. Ended when its work ends, and again by the teardown.
 * `statementTimeoutMs` is the SESSION statement_timeout it opens with (default 120 s, a backstop); `null` sends
 * none, so the session reads the server's own default (B7 uses both, and B10 and the B5 probe use `null`).
 */
function client(label: string, statementTimeoutMs: number | null = 120_000): postgres.Sql {
  const connection = postgres(testDbUrl, {
    max: 1,
    connect_timeout: 20,
    onnotice: () => {},
    transform: { undefined: null },
    connection: {
      application_name: `afldb_i265 ${label}`.slice(0, 63),
      ...(statementTimeoutMs === null ? {} : { statement_timeout: statementTimeoutMs }),
    },
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

async function stageApprovedFile(
  dataset: 'match_results' | 'player_match_stats' | 'match_attendance', payloads: Payload[],
): Promise<number> {
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
        description: `${TAG} Phase B synthetic vocabulary for the reserved test season (in memory only).`,
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

/**
 * One AFL Tables settle on the given connection, automatic path on (apply122, settle-afltables.test.ts:2363).
 * The connection is left open, so B7 can run a second settle on the SAME backend. `apply: false` is a dry run:
 * the settle takes the gate, does its work and rolls everything back (B8).
 */
function runAfltables(connection: postgres.Sql, bundle: SettleBundle, observedAt: string, apply = true): Promise<SettleRunResult> {
  return runSettleAfltables(connection, {
    bundle,
    registry,
    apply,
    autoApply: true,
    inProgressSeasons: [SEASON],
    manualAuthority: UNAVAILABLE_MANUAL_AUTHORITY,
    manualAuthorityLoader: (tx) => loadManualAuthority(tx, SEASON),
    observedAt,
  }).then((result) => {
    if (result.batchId !== null) settleBatchIds.add(String(result.batchId));
    return result;
  });
}

/** One AFL Tables settle on its own connection, ended when it finishes. */
function startAfltablesSettle(label: string, bundle: SettleBundle, observedAt: string, apply = true): Run<SettleRunResult> {
  const connection = client(label);
  return track(label, runAfltables(connection, bundle, observedAt, apply)
    .finally(() => connection.end({ timeout: 5 }).catch(() => undefined)));
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

function runAflApi(connection: postgres.Sql, bundle: AflApiSettleBundle, observedAt: string): Promise<AflApiSettleRunResult> {
  return runSettleAflApi(connection, {
    bundle, registry, apply: true, autoApply: true, inProgressSeasons: [SEASON], observedAt,
  }).then((result) => {
    if (result.batchId !== null) settleBatchIds.add(result.batchId);
    return result;
  });
}

function startAflApiSettle(label: string, bundle: AflApiSettleBundle, observedAt: string): Run<AflApiSettleRunResult> {
  const connection = client(label);
  return track(label, runAflApi(connection, bundle, observedAt)
    .finally(() => connection.end({ timeout: 5 }).catch(() => undefined)));
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
    phase: 'B',
    expectedTests: EXPECTED_TESTS,
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
 * Phase B: gate observation helpers (read through pg_locks, on the server clock)
 * ================================================================== */

type GateRow = { pid: number; mode: string; granted: boolean; waitStartMs: number | null; serverNowMs: number };

/**
 * Every request for the settle/promotion gate, granted or waiting, in one statement. The two-int4 advisory
 * key shows as `classid` = 717275, `objid` = 4, `objsubid` = 2. A settle holds `ShareLock`, a promotion
 * `ExclusiveLock` (runbook §19.1).
 */
async function gateRows(): Promise<GateRow[]> {
  const rows = await owner<GateRow[]>`
    SELECT pid::int AS pid, mode::text AS mode, granted,
           (extract(epoch FROM waitstart) * 1000)::float8 AS "waitStartMs",
           (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS "serverNowMs"
      FROM pg_locks
     WHERE locktype = 'advisory'
       AND classid = ${SETTLE_PROMOTION_GATE.classId}::oid AND objid = ${SETTLE_PROMOTION_GATE.objId}::oid
       AND objsubid = 2
     ORDER BY granted DESC, pid
  `;
  return rows.map((row) => ({ ...row }));
}

const gateRowOf = (rows: readonly GateRow[], pid: number): GateRow | undefined => rows.find((row) => row.pid === pid);
const grantedShared = (rows: readonly GateRow[]): number[] =>
  rows.filter((row) => row.granted && row.mode === 'ShareLock').map((row) => row.pid).sort((a, b) => a - b);

/** The `matches` row-lock modes `pid` holds or awaits (FOR SHARE/FOR UPDATE take RowShareLock, UPDATE RowExclusiveLock). */
async function matchesRowLockModes(pid: number): Promise<string[]> {
  const rows = await owner<{ mode: string }[]>`
    SELECT mode::text AS mode FROM pg_locks
     WHERE pid = ${pid} AND locktype = 'relation' AND relation = 'matches'::regclass
       AND mode IN ('RowShareLock', 'RowExclusiveLock', 'ShareRowExclusiveLock', 'ExclusiveLock')
     ORDER BY mode
  `;
  return rows.map((row) => row.mode);
}

/**
 * What a backend holds besides its own virtual transaction id: a transactionid lock means an xid has been
 * assigned (something was written), a relation lock means a table was touched. A settle waiting at the gate
 * holds neither (runbook §19.1, "before any write"). `backendXid` is read through the owner, which sees a
 * same-role session's xid; the pg_locks counts need no privilege.
 */
async function writesAndTableLocksOf(pid: number): Promise<{ xidLocks: number; relationLocks: number; backendXid: string | null }> {
  const [row] = await owner<{ xidLocks: number; relationLocks: number; backendXid: string | null }[]>`
    SELECT (SELECT count(*) FROM pg_locks WHERE pid = ${pid} AND locktype = 'transactionid')::int AS "xidLocks",
           (SELECT count(*) FROM pg_locks WHERE pid = ${pid} AND locktype = 'relation')::int AS "relationLocks",
           (SELECT backend_xid::text FROM pg_stat_activity WHERE pid = ${pid}) AS "backendXid"
  `;
  return row;
}

async function serverNowMs(): Promise<number> {
  const [row] = await owner<{ ms: number }[]>`SELECT (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS ms`;
  return row.ms;
}

/** A side transaction holding one player_match_stats row FOR UPDATE: the "stuck promotion" stall (B6, B7, B9, B11). */
const lockStatsRow = (playerId: number, matchId: number): Tx => async (tx) => {
  const rows = await tx`
    SELECT 1 FROM player_match_stats WHERE player_id = ${playerId} AND match_id = ${matchId} FOR UPDATE
  `;
  if (rows.length !== 1) throw new Error(`expected exactly one player_match_stats row for player ${playerId} on match ${matchId}, found ${rows.length}`);
};

/**
 * Everything the 2078 fixtures hold that a settle would write, in one comparable value: counts of batches,
 * findings, ledger rows and spine versions, and a digest of the season's matches and player rows. B7 asserts
 * it is equal before and after both settles give up at the gate ("nothing persists").
 */
async function persistedState(): Promise<Record<string, unknown>> {
  const promotionNotes = [...submissionIds].map((id) => `submission ${id}`);
  const [row] = await owner<Record<string, unknown>[]>`
    SELECT
      (SELECT count(*) FROM import_batches WHERE notes LIKE ${BATCH_NOTE_LIKE})::int AS settle_batches,
      (SELECT count(*) FROM import_batches WHERE tool = 'admin-upload' AND notes = ANY(${promotionNotes}::text[]))::int AS promotion_batches,
      (SELECT count(*) FROM data_issues
        WHERE issue_key LIKE ANY(${ISSUE_LIKE}::text[]) OR issue_key LIKE ANY(${[...TRACKED_ISSUE_PATTERNS]}::text[])
           OR issue_key = ANY(${[...SEASON_GATE_KEYS]}::text[]))::int AS findings,
      (SELECT count(*) FROM canonical_applications WHERE external_record_id LIKE ANY(${RECORD_LIKE}::text[]))::int AS ledger,
      (SELECT count(*) FROM staging.source_record_versions WHERE external_record_id LIKE ANY(${RECORD_LIKE}::text[]))::int AS versions,
      (SELECT coalesce(md5(string_agg(md5(to_jsonb(t)::text), '' ORDER BY t.id)), '') FROM matches t WHERE t.season = ${SEASON}) AS matches,
      (SELECT coalesce(md5(string_agg(md5(to_jsonb(t)::text), '' ORDER BY t.match_id, t.player_id)), '')
         FROM player_match_stats t WHERE t.match_id IN (SELECT id FROM matches WHERE season = ${SEASON})) AS stats
  `;
  return { ...row };
}

/**
 * Samples a promotion's wait every 250 ms until it ends and asserts EVERY sample: whatever it waits on is the
 * gate (an advisory lock, never a transactionid or tuple lock on a match) and its only blocker is `blockerPid`
 * (runbook §19.1, "never on a match"). Returns how many samples saw it waiting. Bounded.
 */
async function watchGateWait(label: string, run: Run<unknown>, pid: number, blockerPid: number, timeoutMs = 30_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let waiting = 0;
  while (!run.done) {
    const snapshot = await waitSnapshot(pid);
    if (snapshot.waits.length > 0) {
      waiting += 1;
      expect({
        label,
        otherWaits: snapshot.waits.filter((wait) => wait !== 'advisory'),
        otherBlockers: snapshot.blockers.filter((blocker) => blocker !== blockerPid),
      }).toEqual({ label, otherWaits: [], otherBlockers: [] });
    }
    if (Date.now() > deadline) throw new Error(`${label}: still waiting after ${timeoutMs} ms`);
    await pause(250);
  }
  return waiting;
}

/** Every canonical_apply_failed finding any fixture record can have, open or resolved. */
const allFindings = () => applyFindings([...TRACKED_RECORD_IDS]);
const openFindings = async () => (await allFindings()).filter((finding) => finding.resolvedAt === null);

/* ------------------------------------------------------------------ *
 * Phase B: per-run parameters and fixture values
 * ------------------------------------------------------------------ */

/** One settle run's unique label, strictly increasing observation time and attendance / stat values. */
function nextRun(): { n: number; label: string; observedAt: string; attendance: number } {
  runCounter += 1;
  const at = new Date(Date.UTC(SEASON, 5, 1) + runCounter * 60_000).toISOString().replace('.000Z', 'Z');
  return { n: runCounter, label: `${AFLT_NS}b${runCounter}`, observedAt: at, attendance: 33_000 + runCounter };
}

/** An AFL API stat line that differs per run; kicks and disposals move together. */
const lineOf = (n: number): StatLine => ({ ...SEED_LINE, kicks: SEED_LINE.kicks + n, disposals: SEED_LINE.disposals + n });
const venueOf = (n: number): string => `${VENUE.name} (b${n})`;

/** The AFL Tables feed order that stalls at MA's spine record after MB and MC are written (A1's proven order). */
const STALL_ORDER: readonly A1Key[] = ['MB', 'MC', 'MA', 'MD'];

/** A match_results file row equal to what the AFL Tables settle projects for `k`, so a promotion is idempotent. */
const mrFileRow = (k: A1Key): Payload => ({
  season: String(SEASON), round_code: String(A1[k].round), round_number: String(A1[k].round),
  match_date: A1[k].date, venue: A1_VENUE_RAW, home_club: CLUBS.home.name, away_club: CLUBS.away.name,
  home_score: '100', away_score: '72', home_goals: '15', home_behinds: '10', away_goals: '10', away_behinds: '12',
});

type Settled = SettleRunResult | AflApiSettleRunResult;

/** A settle that committed: applied, and no unit failed. */
function expectCommitted(label: string, result: Settled): void {
  expect({ label, applied: result.applied, failures: result.counters.canonicalApplyFailures })
    .toEqual({ label, applied: true, failures: 0 });
}

function expectRefusedRetryably(label: string, outcome: Awaited<ReturnType<typeof promoteSubmission>>): void {
  expect({ label, ok: outcome.ok }).toEqual({ label, ok: false });
  expect(outcome.ok ? '' : outcome.error).toContain(LEGACY_PROMOTION_LOCK_REFUSAL);
}

/* ================================================================== *
 * Phase B
 * ================================================================== */

describe.runIf(RUN_PHASE_B)('AFLDB-ISSUE-265 Phase B: the settle / legacy-promotion gate, with real settles and real promotions', () => {
  const a1Id = {} as Record<A1Key, number>;
  const apiId = {} as Record<ApiKey, number>;
  /** The AFL API stat line currently stored for (p, M1); promotions that are not part of a settle rewrite exactly this. */
  let apiLine: StatLine = SEED_LINE;

  const apiUnit = (key: ApiKey, venueName: string, line: StatLine = SEED_LINE): ApiUnit => ({ key, venueName, line });

  beforeAll(async () => {
    assertGateInSource();

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

    // ---- seed the two providers' matches with the REAL settles (no promotion runs yet, so no gate wait) ----
    const seedTables = nextRun();
    const tablesSeed = await within('AFL Tables seed settle',
      startAfltablesSettle('seed afltables', a1Bundle(seedTables.label, A1_KEYS, A1_SEED_ATTENDANCE), seedTables.observedAt).promise,
      100_000);
    expectCommitted('AFL Tables seed', tablesSeed);
    for (const k of A1_KEYS) {
      const row = await matchRow(a1Key(k));
      if (!row || row.sourceKey !== 'afltables' || row.attendance !== A1_SEED_ATTENDANCE) {
        throw new Error(`the AFL Tables seed did not create ${k} as an afltables-owned match: ${JSON.stringify(row)}`);
      }
      a1Id[k] = row.id;
    }
    // The ascending lock order the hooks rely on needs MA < MB.
    expect(a1Id.MA).toBeLessThan(a1Id.MB);

    const seedApi = nextRun();
    const apiSeed = await within('AFL API seed settle',
      startAflApiSettle('seed afl api', apiBundle(seedApi.label, API_KEYS.map((k) => apiUnit(k, API_VENUE_SEED))), seedApi.observedAt).promise,
      100_000);
    expectCommitted('AFL API seed', apiSeed);
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
    // The ascending lock order needs M1 < M2 (B5) and the stalls need the seeded ids.
    expect(apiId.M1).toBeLessThan(apiId.M2);
    expect(await openFindings()).toEqual([]);
  }, 900_000);

  /** Index into `inflightRuns` at the start of the current case, so its forensic record holds only its own runs. */
  let caseRunStart = 0;

  beforeEach(() => {
    if (poisoned) throw new Error(`Refusing to start this case: ${poisoned}`);
    caseRunStart = inflightRuns.length;
  });

  afterEach(async () => {
    await drainCase();
    // Every case, pass or fail: what each of its settles and promotions did, and every finding. Phase A lost this
    // when a failed window's teardown deleted the rows (runbook §17.12); the evidence file keeps it.
    try {
      outcomes[expect.getState().currentTestName ?? `case ${caseRunStart}`] = {
        runs: inflightRuns.slice(caseRunStart).map((run) => ({ label: run.label, state: describeRun(run) })),
        findings: await within('forensic findings', allFindings(), 15_000),
      };
    } catch (error) {
      outcomes.forensicErrors = [...(outcomes.forensicErrors as string[] | undefined ?? []), messageOf(error)];
    }
    // Read-only, after the drain (the case's settle has committed or rolled back) and before afterAll
    // deletes anything. A capture that fails is recorded, never thrown: it must not mask the case's result.
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
      // A lingering lock must fail a teardown statement fast rather than run the hook past its own bound
      // before the evidence is written. The fingerprints are single server-side scans.
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
        writeEvidence({
          teardownProblems: [...released, ...deleted], residue, fingerprintsEqual, changedFingerprints,
          expectedRetainedBatches: EXPECTED_RETAINED_BATCHES,
        });
      } finally {
        restoreManagedEnv();
        if (ownerReady) await owner.end({ timeout: 5 });
      }
    }
  }, 600_000);

  /* ---------------------------------------------------------------- *
   * Held settles: a real settle, stopped mid-run by a side transaction, holding the shared gate
   * ---------------------------------------------------------------- */

  /**
   * An AFL Tables settle held open by a side transaction X on a record's spine row. It has taken the shared gate
   * (its first lock) and written the records before the stall, and waits at the stalled record's first statement.
   * 'MA' (the default) feeds MB, MC, MA, MD, so MB and MC are written first (A1's proven stall). 'MD' feeds the
   * natural order, so MA, MB and MC are written and only MD and the end-of-run work remain: B2 uses it, because
   * its promotion must obtain the gate inside its own 5 s bound once the stall is released.
   */
  async function startHeldAfltablesSettle(label: string, stallAt: 'MA' | 'MD' = 'MA') {
    const run = nextRun();
    const X = await hold(`${label} X on the ${stallAt} spine record`, lockSpineRecord(A1[stallAt].record));
    const settle = startAfltablesSettle(
      `${label} settle`, a1Bundle(run.label, stallAt === 'MA' ? STALL_ORDER : A1_KEYS, run.attendance), run.observedAt,
    );
    const settlePid = await waitUntil(`${label}: the settle queues behind X at the ${stallAt} spine record`, () => newWaiterBehind(X.pid), [settle]);
    expect(gateRowOf(await gateRows(), settlePid)).toMatchObject({ mode: 'ShareLock', granted: true });
    return { run, X, settle, settlePid };
  }

  /**
   * An AFL API settle held open by a side transaction Y on M3 (FOR SHARE, so the settle's UPDATE of a changed M3
   * waits). It has taken the shared gate, written (p, M1) with this run's line, and waits at M3.
   */
  async function startHeldApiSettle(label: string) {
    const run = nextRun();
    const line = lineOf(run.n);
    const venue = venueOf(run.n);
    const Y = await hold(`${label} Y on M3`, lockMatch(apiId.M3, 'FOR SHARE'));
    const settle = startAflApiSettle(
      `${label} settle`, apiBundle(run.label, [apiUnit('M1', API_VENUE_SEED, line), apiUnit('M3', venue)]), run.observedAt,
    );
    const settlePid = await waitUntil(`${label}: the settle queues behind Y on M3`, () => newWaiterBehind(Y.pid), [settle]);
    expect(gateRowOf(await gateRows(), settlePid)).toMatchObject({ mode: 'ShareLock', granted: true });
    return { run, line, venue, Y, settle, settlePid };
  }

  /**
   * A promotion over (p, M1), stuck after its hook on a side transaction's row lock. Its row carries `line`, the
   * value already stored there unless a later settle in the same case writes the same line, so a promotion and a
   * settle never disagree about (p, M1).
   */
  async function startStuckPromotion(label: string, line: StatLine = apiLine) {
    const p = playerIds.get('p')!;
    const fileId = await stageApprovedFile('player_match_stats', [statsFileRow('M1', 'p', legacyStats(line))]);
    const Xrow = await hold(`${label} X on (p, M1)`, lockStatsRow(p, apiId.M1));
    const promotion = startPromotion(`${label} promotion`, fileId);
    // Its hook has passed (the gate is held, M1 locked FOR SHARE) and the upsert now waits on X's row.
    const promotionPid = await waitUntil(`${label}: the promotion passes its hook and waits on (p, M1)`, () => newWaiterBehind(Xrow.pid), [promotion]);
    expect(gateRowOf(await gateRows(), promotionPid)).toMatchObject({ mode: 'ExclusiveLock', granted: true });
    return { fileId, Xrow, promotion, promotionPid };
  }

  /* ---------------------------------------------------------------- *
   * B1, B2 — AFL Tables · match_results
   * ---------------------------------------------------------------- */

  it('B1: AFL Tables · match_results · the promotion is refused at the gate while a settle holds it, and a retry succeeds', async () => {
    const fileId = await stageApprovedFile('match_results', [mrFileRow('MA'), mrFileRow('MB')]);
    const findingsBefore = await allFindings();
    const { run, X, settle, settlePid } = await startHeldAfltablesSettle('B1');
    const b1: Record<string, number> = {};
    timings.B1 = b1;

    const promotionStarted = Date.now();
    const promotion = startPromotion('B1 promotion', fileId);
    const promotionPid = await waitUntil('B1: the promotion queues behind the settle', () => newWaiterBehind(settlePid), [settle, promotion]);
    const wait = await waitUntil('B1: the promotion\'s gate wait is stamped', () => waitingOn(promotionPid, settlePid), [settle, promotion]);
    // On the gate (an advisory lock), not on MB or MC: the settle holds both, and the promotion never reached them.
    expect({ waits: wait.waits, blockers: wait.blockers }).toEqual({ waits: ['advisory'], blockers: [settlePid] });
    const rows = await gateRows();
    expect(gateRowOf(rows, promotionPid)).toMatchObject({ mode: 'ExclusiveLock', granted: false });
    expect(gateRowOf(rows, settlePid)).toMatchObject({ mode: 'ShareLock', granted: true });
    expect(await matchesRowLockModes(promotionPid)).toEqual([]);

    // The settle is held past the promotion's 5 s bound (X is released only after the refusal).
    b1.gateWaitSamples = await watchGateWait('B1 promotion wait', promotion as Run<unknown>, promotionPid, settlePid);
    expect(b1.gateWaitSamples).toBeGreaterThan(0);
    const refused = await within('B1 promotion (5 s hook bound)', promotion.promise, 30_000);
    const elapsed = (promotion.finishedAt ?? Date.now()) - promotionStarted;
    b1.promotionElapsedMs = elapsed;
    expect(settle.done).toBe(false);
    expectRefusedRetryably('B1 promotion', refused);
    expect(elapsed).toBeGreaterThanOrEqual(4500);
    expect(elapsed).toBeLessThan(20_000);
    const failed = await submissionState(fileId);
    expect(failed.status).toBe('failed');
    expect(failed.error ?? '').toContain(LEGACY_PROMOTION_LOCK_REFUSAL);
    expect(await promotionBatchCount(fileId)).toBe(0);

    X.go();
    const result = await within('B1 settle after X', settle.promise, 120_000);
    expect(await within('B1 X', X.outcome, 30_000)).toBeNull();
    expectCommitted('B1 settle', result);
    // MA to MD all applied, with no finding at all: no unit lost a lock.
    for (const k of A1_KEYS) expect((await matchRow(a1Key(k)))?.attendance).toBe(run.attendance);
    expect(await allFindings()).toEqual(findingsBefore);

    // Retry: the same file, once the settle has committed.
    const retried = await within('B1 re-promotion', startPromotion('B1 re-promotion', fileId).promise, 30_000);
    expect(retried).toMatchObject({ ok: true });
    expect((await submissionState(fileId)).status).toBe('promoted');
    expect(await promotionBatchCount(fileId)).toBe(1);
  }, 240_000);

  it('B2: AFL Tables · match_results · the promotion waits at the gate, then succeeds once the settle commits', async () => {
    const fileId = await stageApprovedFile('match_results', [mrFileRow('MA'), mrFileRow('MB')]);
    const { run, X, settle, settlePid } = await startHeldAfltablesSettle('B2', 'MD');
    const b2: Record<string, number> = {};
    timings.B2 = b2;

    const promotionStarted = Date.now();
    const promotion = startPromotion('B2 promotion', fileId);
    const promotionPid = await waitUntil('B2: the promotion queues behind the settle', () => newWaiterBehind(settlePid), [settle, promotion]);
    const wait = await waitUntil('B2: the promotion\'s gate wait is stamped', () => waitingOn(promotionPid, settlePid), [settle, promotion]);
    expect({ waits: wait.waits, blockers: wait.blockers }).toEqual({ waits: ['advisory'], blockers: [settlePid] });
    const waitStart = wait.waitStartMs as number;

    // Every stall is released only now that the promotion is observed on the gate.
    X.go();
    let grantedAt: number | null = null;
    const deadline = Date.now() + 20_000;
    while (grantedAt === null && !promotion.done && Date.now() < deadline) {
      const mine = gateRowOf(await gateRows(), promotionPid);
      if (mine?.granted) grantedAt = mine.serverNowMs;
      else await pause(40);
    }
    const result = await within('B2 settle after X', settle.promise, 120_000);
    const promoted = await within('B2 promotion', promotion.promise, 60_000);
    const elapsed = (promotion.finishedAt ?? Date.now()) - promotionStarted;
    b2.promotionElapsedMs = elapsed;
    if (grantedAt !== null) b2.gateWaitServerMs = grantedAt - waitStart;
    expect(await within('B2 X', X.outcome, 30_000)).toBeNull();
    expectCommitted('B2 settle', result);

    // Inconclusive guard (review F-003): a gate wait that ran into the promotion's 5 s bound proves nothing
    // about a promotion that SUCCEEDS after the settle, so it fails as INCONCLUSIVE, never as a pass.
    const gateWaitMs = grantedAt === null ? elapsed : grantedAt - waitStart;
    if (gateWaitMs >= 4000) {
      throw new Error(
        `B2 INCONCLUSIVE: the promotion's gate wait was ${Math.round(gateWaitMs)} ms, within 1 s of its 5 s bound `
        + `(settle remainder too slow on this link); outcome ${promoted.ok ? 'ok' : promoted.error}`,
      );
    }
    expect(promoted).toMatchObject({ ok: true });
    expect((await submissionState(fileId)).status).toBe('promoted');
    expect(await promotionBatchCount(fileId)).toBe(1);
    for (const k of A1_KEYS) expect((await matchRow(a1Key(k)))?.attendance).toBe(run.attendance);
  }, 240_000);

  /* ---------------------------------------------------------------- *
   * B3, B4 — AFL API · player_match_stats
   * ---------------------------------------------------------------- */

  it('B3: AFL API · player_match_stats · the promotion waits at the gate, not on (p, M1); the M2 unit applies; a retry succeeds', async () => {
    const p = playerIds.get('p')!;
    const q = playerIds.get('q')!;
    const run = nextRun();
    const line = lineOf(run.n);
    const venue = venueOf(run.n);
    const findingsBefore = await allFindings();
    const fileId = await stageApprovedFile('player_match_stats', [
      statsFileRow('M1', 'p', legacyStats(line)),
      statsFileRow('M2', 'q', { goals: '2' }),
    ]);
    const b3: Record<string, number> = {};
    timings.B3 = b3;

    // X holds M2 FOR SHARE (the settle's UPDATE of M2 waits); Y will stall the settle at M3.
    const X = await hold('B3 X on M2', lockMatch(apiId.M2, 'FOR SHARE'));
    const Y = await hold('B3 Y on M3', lockMatch(apiId.M3, 'FOR SHARE'));
    const settle = startAflApiSettle('B3 settle', apiBundle(run.label, [
      apiUnit('M1', API_VENUE_SEED, line), apiUnit('M2', venue), apiUnit('M3', venue),
    ]), run.observedAt);
    const settlePid = await waitUntil('B3: the settle queues behind X on M2', () => newWaiterBehind(X.pid), [settle]);

    const promotionStarted = Date.now();
    const promotion = startPromotion('B3 promotion', fileId);
    const promotionPid = await waitUntil('B3: the promotion queues behind the settle', () => newWaiterBehind(settlePid), [settle, promotion]);
    const wait = await waitUntil('B3: the promotion\'s gate wait is stamped', () => waitingOn(promotionPid, settlePid), [settle, promotion]);
    // The gate, not the (p, M1) row the settle has already written and still holds.
    expect({ waits: wait.waits, blockers: wait.blockers }).toEqual({ waits: ['advisory'], blockers: [settlePid] });
    expect(await matchesRowLockModes(promotionPid)).toEqual([]);

    // The M2 unit now applies (no deadlock cycle is possible), and the settle stalls at M3.
    X.go();
    // The promotion is NOT watched here: it may legitimately be refused (its 5 s bound) before the settle reaches M3.
    await waitUntil('B3: the settle (M2 applied) queues behind Y on M3', () => isBehind(Y.pid, settlePid), [settle]);

    b3.gateWaitSamples = await watchGateWait('B3 promotion wait', promotion as Run<unknown>, promotionPid, settlePid);
    expect(b3.gateWaitSamples).toBeGreaterThan(0);
    const refused = await within('B3 promotion (5 s hook bound)', promotion.promise, 30_000);
    const elapsed = (promotion.finishedAt ?? Date.now()) - promotionStarted;
    b3.promotionElapsedMs = elapsed;
    expect(settle.done).toBe(false);
    expectRefusedRetryably('B3 promotion', refused);
    expect(elapsed).toBeGreaterThanOrEqual(4500);
    expect(await promotionBatchCount(fileId)).toBe(0);
    expect(await statsRow(q, apiKey('M2'))).toBeNull();

    Y.go();
    const result = await within('B3 settle after Y', settle.promise, 120_000);
    expect(await within('B3 X', X.outcome, 30_000)).toBeNull();
    expect(await within('B3 Y', Y.outcome, 30_000)).toBeNull();
    expectCommitted('B3 settle', result);
    expect(await allFindings()).toEqual(findingsBefore);
    expect((await matchRow(apiKey('M2')))?.venueRaw).toBe(venue);
    expect((await matchRow(apiKey('M3')))?.venueRaw).toBe(venue);
    expect(await statsRow(p, apiKey('M1'))).toMatchObject({ kicks: line.kicks, disposals: line.disposals });
    apiLine = line;

    // Retry once the settle has committed.
    expect(await within('B3 re-promotion', startPromotion('B3 re-promotion', fileId).promise, 30_000)).toMatchObject({ ok: true });
    expect((await submissionState(fileId)).status).toBe('promoted');
    expect(await promotionBatchCount(fileId)).toBe(1);
    expect(await statsRow(q, apiKey('M2'))).toMatchObject({ goals: 2 });
    expect(await statsRow(p, apiKey('M1'))).toMatchObject({ kicks: line.kicks, disposals: line.disposals });
  }, 240_000);

  it('B4: AFL API · F-265-1 · the attendance enrichment no longer loses the whole run; the promotion waits at the gate', async () => {
    const p = playerIds.get('p')!;
    const run = nextRun();
    const line = lineOf(run.n);
    const venue = venueOf(run.n);
    const m4Key = apiKey('M4');
    const b4: Record<string, number> = {};
    timings.B4 = b4;

    // The fixture: a complete AFL Tables attendance row for the afl_api-owned M4, keyed (as the AFL Tables
    // match family is) by the match key, with the spine version its ledger row would cite.
    fixtureSpineKeys.add(m4Key);
    const [fixtureBatch] = await owner<{ id: string }[]>`
      INSERT INTO import_batches (source_id, tool, target_table, notes)
      VALUES (${refs.afltablesSourceId}, ${FIXTURE_TOOL}, 'staging.source_record_versions', ${`${TAG} B4 enrichment fixture`})
      RETURNING id::text AS id
    `;
    fixtureBatchIds.add(fixtureBatch.id);
    await owner.begin(async (tx) => {
      await persistSourceObservation(tx, {
        contract: getSourceFamily(registry, 'afltables', 'match'),
        sourceId: refs.afltablesSourceId,
        externalRecordId: m4Key,
        scopeKey: `${AFLT_NS}b4-enrichment`,
        payload: { issue265_fixture: true, season: SEASON, round_code: apiRoundCode('M4'), match_date: API.M4.date, attendance: 30123 },
      }, asImportBatchId(fixtureBatch.id), nextRun().observedAt);
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

    // The promotion's (p, M4) row equals the line the settle writes, so the two never disagree.
    const fileId = await stageApprovedFile('player_match_stats', [statsFileRow('M4', 'p', legacyStats(line))]);
    const Z = await hold('B4 Z on M5', lockMatch(apiId.M5, 'FOR SHARE'));
    // The settle writes (p, M4) under FOR SHARE on M4, then waits on Z at M5.
    const settle = startAflApiSettle('B4 settle', apiBundle(run.label, [
      apiUnit('M4', API_VENUE_SEED, line), apiUnit('M5', venue),
    ]), run.observedAt);
    const settlePid = await waitUntil('B4: the settle queues behind Z on M5', () => newWaiterBehind(Z.pid), [settle]);

    const promotionStarted = Date.now();
    const promotion = startPromotion('B4 promotion', fileId);
    const promotionPid = await waitUntil('B4: the promotion queues behind the settle', () => newWaiterBehind(settlePid), [settle, promotion]);
    const wait = await waitUntil('B4: the promotion\'s gate wait is stamped', () => waitingOn(promotionPid, settlePid), [settle, promotion]);
    expect({ waits: wait.waits, blockers: wait.blockers }).toEqual({ waits: ['advisory'], blockers: [settlePid] });

    // The settle finishes M5 and reaches the enrichment, whose FOR UPDATE on M4 (canonical-apply.ts, before every
    // gate) used to close the cycle and roll the whole run back. The promotion holds nothing, so it cannot.
    Z.go();
    const outcome = await within('B4 settle after Z', settled(settle), 120_000);
    expect(await within('B4 Z', Z.outcome, 30_000)).toBeNull();
    if (!outcome.ok) throw outcome.error;
    const result = outcome.value;
    expectCommitted('B4 settle', result);
    expect(result.batchId).not.toBeNull();
    const [batch] = await owner<{ n: number }[]>`SELECT count(*)::int AS n FROM import_batches WHERE id = ${result.batchId as string}::bigint`;
    expect(batch.n).toBe(1);
    expect((await matchRow(m4Key))?.attendance).toBe(30123);
    expect((await matchRow(apiKey('M5')))?.venueRaw).toBe(venue);
    expect(await statsRow(p, m4Key)).toMatchObject({ kicks: line.kicks, disposals: line.disposals });

    // The promotion waited on the gate, then either succeeded or was refused retryably; never a deadlock victim.
    let promoted = await within('B4 promotion after the settle commits', promotion.promise, 60_000);
    if (!promoted.ok) {
      expectRefusedRetryably('B4 promotion', promoted);
      // The refusal text is the same for a lock timeout (55P03) and a deadlock victim (40P01), so the text cannot
      // tell them apart. The 5 s bound can: a victim is chosen after about 1 s (deadlock_timeout), a timeout at 5 s.
      expect((promotion.finishedAt ?? Date.now()) - promotionStarted).toBeGreaterThanOrEqual(4500);
      promoted = await within('B4 re-promotion', startPromotion('B4 re-promotion', fileId).promise, 30_000);
    }
    expect(promoted).toMatchObject({ ok: true });
    expect((await submissionState(fileId)).status).toBe('promoted');
    expect(await promotionBatchCount(fileId)).toBe(1);
    expect(await statsRow(p, m4Key)).toMatchObject({ kicks: line.kicks, disposals: line.disposals });
  }, 240_000);

  /* ---------------------------------------------------------------- *
   * B6 — a settle waits behind a promotion that is stuck after its hook
   * ---------------------------------------------------------------- */

  it('B6: a settle waits behind a promotion that is stuck after its hook, holding nothing, and then completes', async () => {
    const run = nextRun();
    const b6: Record<string, number> = {};
    timings.B6 = b6;
    const findingsBefore = await allFindings();
    const { fileId, Xrow, promotion, promotionPid } = await startStuckPromotion('B6');

    const settleStarted = Date.now();
    const settle = startAfltablesSettle('B6 settle', a1Bundle(run.label, A1_KEYS, run.attendance), run.observedAt);
    const settlePid = await waitUntil('B6: the settle queues behind the promotion', () => newWaiterBehind(promotionPid), [settle]);
    const wait = await waitUntil('B6: the settle\'s gate wait is stamped', () => waitingOn(settlePid, promotionPid), [settle]);
    // The settle's only wait is the gate: ShareLock, blocker = the promotion.
    expect({ waits: wait.waits, blockers: wait.blockers }).toEqual({ waits: ['advisory'], blockers: [promotionPid] });
    expect(gateRowOf(await gateRows(), settlePid)).toMatchObject({ mode: 'ShareLock', granted: false });
    // Before any write and any table lock: no xid, and not even loadRefs has run.
    expect(await writesAndTableLocksOf(settlePid)).toEqual({ xidLocks: 0, relationLocks: 0, backendXid: null });

    await pause(1500);
    expect(settle.done).toBe(false);
    expect(promotion.done).toBe(false);
    b6.settleGateWaitObservedMs = (await serverNowMs()) - (wait.waitStartMs as number);

    Xrow.go();
    const promoted = await within('B6 promotion', promotion.promise, 60_000);
    expect(await within('B6 X', Xrow.outcome, 30_000)).toBeNull();
    expect(promoted).toMatchObject({ ok: true });
    const result = await within('B6 settle', settle.promise, 120_000);
    b6.settleElapsedMs = (settle.finishedAt ?? Date.now()) - settleStarted;
    expectCommitted('B6 settle', result);
    expect(await promotionBatchCount(fileId)).toBe(1);
    expect(await allFindings()).toEqual(findingsBefore);
    for (const k of A1_KEYS) expect((await matchRow(a1Key(k)))?.attendance).toBe(run.attendance);
  }, 240_000);

  /* ---------------------------------------------------------------- *
   * B7 — the 300 s timeout, rollback and connection reuse, both providers
   * ---------------------------------------------------------------- */

  it('B7: both settles give up at the gate after the full wait with a named error, write nothing, and their connections are reused', async () => {
    const wait = SETTLE_PROMOTION_GATE_WAIT_MS;
    const p = playerIds.get('p')!;
    const runTables = nextRun();
    const runApi = nextRun();
    const lineApi = lineOf(runApi.n);
    const venueApi = venueOf(runApi.n);
    const b7: Record<string, number> = {};
    timings.B7 = b7;

    // The promotion's (p, M1) row equals `lineApi`, so the AFL API retry below leaves the same value.
    const { fileId, Xrow, promotion, promotionPid } = await startStuckPromotion('B7', lineApi);

    // Two clients, each max 1. The AFL API client opens with a SESSION statement_timeout of 60 s, below the wait;
    // the AFL Tables client opens with none, so it reads the server default.
    const tablesClient = client('B7 afltables settle', null);
    const apiClient = client('B7 afl api settle', 60_000);
    const settingsOf = async (connection: postgres.Sql) => {
      const [row] = await connection<{ pid: number; lockTimeout: string; statementTimeout: string }[]>`
        SELECT pg_backend_pid()::int AS pid, current_setting('lock_timeout') AS "lockTimeout",
               current_setting('statement_timeout') AS "statementTimeout"
      `;
      await observe(row.pid);
      return { ...row };
    };
    const tablesBefore = await settingsOf(tablesClient);
    const apiBefore = await settingsOf(apiClient);
    expect(apiBefore.statementTimeout).toBe('1min');
    const stateBefore = await persistedState();

    const started = Date.now();
    const tablesBundle = a1Bundle(runTables.label, A1_KEYS, runTables.attendance);
    const apiBundleB7 = apiBundle(runApi.label, [apiUnit('M1', API_VENUE_SEED, lineApi), apiUnit('M3', venueApi)]);
    const tablesRun = track('B7 afltables settle', runAfltables(tablesClient, tablesBundle, runTables.observedAt));
    const apiRun = track('B7 afl api settle', runAflApi(apiClient, apiBundleB7, runApi.observedAt));

    // Both queue at the gate behind the promotion: ShareLock requests, each blocked only by the promotion.
    const queued = await waitUntil('B7: both settles queue at the gate behind the promotion', async () => {
      const rows = await gateRows();
      const waiting = rows.filter((row) => !row.granted).map((row) => row.pid);
      return waiting.includes(tablesBefore.pid) && waiting.includes(apiBefore.pid) ? rows : null;
    }, [tablesRun, apiRun, promotion]);
    expect(gateRowOf(queued, promotionPid)).toMatchObject({ mode: 'ExclusiveLock', granted: true });
    const waitStarts: Record<string, number> = {};
    for (const [name, pid] of [['afltables', tablesBefore.pid], ['aflapi', apiBefore.pid]] as const) {
      const snap = await waitUntil(`B7: the ${name} settle's gate wait is stamped`, () => waitingOn(pid, promotionPid), [tablesRun, apiRun, promotion]);
      expect({ name, waits: snap.waits, blockers: snap.blockers }).toEqual({ name, waits: ['advisory'], blockers: [promotionPid] });
      waitStarts[name] = snap.waitStartMs as number;
    }

    // Held past the full wait. The promotion stays stuck on X's row throughout: if it ended early (for example an
    // import-role statement_timeout), the settles would be granted and this case would be meaningless.
    const deadline = Date.now() + wait + 120_000;
    while (!(tablesRun.done && apiRun.done)) {
      if (promotion.done) {
        throw new Error(`B7: the promotion finished (${describeRun(promotion as Run<unknown>)}) before both settles gave up; it cannot hold the gate for ${wait} ms here`);
      }
      if (Date.now() > deadline) throw new Error(`B7: the settles had not given up ${wait + 120_000} ms after they queued`);
      await pause(1000);
    }
    const nowServer = await serverNowMs();
    b7.tablesElapsedMs = (tablesRun.finishedAt ?? Date.now()) - started;
    b7.apiElapsedMs = (apiRun.finishedAt ?? Date.now()) - started;
    b7.serverMsSinceTablesWait = nowServer - waitStarts.afltables;
    b7.serverMsSinceApiWait = nowServer - waitStarts.aflapi;
    expect(promotion.done).toBe(false);

    // Both reject with the named error (cause 55P03), never a 57014, and not before the full wait elapsed.
    for (const [name, run, elapsed, serverSince] of [
      ['afltables', tablesRun, b7.tablesElapsedMs, b7.serverMsSinceTablesWait],
      ['aflapi', apiRun, b7.apiElapsedMs, b7.serverMsSinceApiWait],
    ] as const) {
      const outcome = await settled(run as Run<unknown>);
      expect({ name, ok: outcome.ok }).toEqual({ name, ok: false });
      const error = outcome.ok ? null : outcome.error;
      expect(error).toBeInstanceOf(SettlePromotionGateTimeout);
      expect({ name, code: sqlstate(error) }).toEqual({ name, code: '55P03' });
      expect(sqlstate(error)).not.toBe('57014');
      expect(messageOf(error)).toMatch(/legacy CSV promotion/);
      expect({ name, elapsedAtLeastWait: elapsed >= wait }).toEqual({ name, elapsedAtLeastWait: true });
      // Server clock, with 500 ms for the gap between the statement reaching the server and its wait being stamped.
      expect({ name, serverAtLeastWait: serverSince >= wait - 500 }).toEqual({ name, serverAtLeastWait: true });
    }

    // Nothing persists: no batch, no finding, no ledger, spine or canonical change.
    expect(await persistedState()).toEqual(stateBefore);

    // Reuse: the same backends, no advisory lock held, and BOTH previous settings restored, not reset or left raised.
    const rowsAfter = await gateRows();
    for (const [name, connection, before] of [['afltables', tablesClient, tablesBefore], ['aflapi', apiClient, apiBefore]] as const) {
      expect(await settingsOf(connection)).toEqual(before);
      expect({ name, heldGate: gateRowOf(rowsAfter, before.pid) !== undefined }).toEqual({ name, heldGate: false });
    }

    // Retry: release the stall. The promotion commits, then both settles re-run on the SAME clients and complete
    // (one after the other: two settles' end-of-run recomputes are not what B7 tests).
    Xrow.go();
    const promoted = await within('B7 promotion', promotion.promise, 60_000);
    expect(await within('B7 X', Xrow.outcome, 30_000)).toBeNull();
    expect(promoted).toMatchObject({ ok: true });
    expect(await promotionBatchCount(fileId)).toBe(1);
    const tablesResult = await within('B7 afltables retry', runAfltables(tablesClient, tablesBundle, runTables.observedAt), 120_000);
    expectCommitted('B7 afltables retry', tablesResult);
    const apiResult = await within('B7 afl api retry', runAflApi(apiClient, apiBundleB7, runApi.observedAt), 120_000);
    expectCommitted('B7 afl api retry', apiResult);
    apiLine = lineApi;
    expect(await statsRow(p, apiKey('M1'))).toMatchObject({ kicks: lineApi.kicks, disposals: lineApi.disposals });
    expect((await matchRow(apiKey('M3')))?.venueRaw).toBe(venueApi);
    for (const k of A1_KEYS) expect((await matchRow(a1Key(k)))?.attendance).toBe(runTables.attendance);
    // The same two backends served the retries.
    expect((await settingsOf(tablesClient)).pid).toBe(tablesBefore.pid);
    expect((await settingsOf(apiClient)).pid).toBe(apiBefore.pid);
  }, 720_000);

  /* ---------------------------------------------------------------- *
   * B8 — concurrent settles; a rolled-back settle releases the gate
   * ---------------------------------------------------------------- */

  it('B8: two settles hold the shared gate at once, neither waits on the other, and a dry-run rollback releases it', async () => {
    const b8: Record<string, number> = {};
    timings.B8 = b8;
    const findingsBefore = await allFindings();
    const tables = await startHeldAfltablesSettle('B8 afltables');
    const api = await startHeldApiSettle('B8 afl api');

    // One snapshot with two GRANTED ShareLock entries, and nobody waiting at the gate.
    const rows = await waitUntil('B8: both settles hold the shared gate at once', async () => {
      const snapshot = await gateRows();
      const shared = grantedShared(snapshot);
      return shared.includes(tables.settlePid) && shared.includes(api.settlePid) ? snapshot : null;
    }, [tables.settle, api.settle]);
    expect(rows.filter((row) => !row.granted)).toEqual([]);
    expect(rows.filter((row) => row.granted && row.mode !== 'ShareLock')).toEqual([]);

    // Released one after the other: both settles' end-of-run recomputes at once is not what B8 tests.
    tables.X.go();
    const tablesResult = await within('B8 afltables settle', tables.settle.promise, 120_000);
    expectCommitted('B8 afltables settle', tablesResult);
    api.Y.go();
    const apiResult = await within('B8 afl api settle', api.settle.promise, 120_000);
    expectCommitted('B8 afl api settle', apiResult);
    expect(await within('B8 X', tables.X.outcome, 30_000)).toBeNull();
    expect(await within('B8 Y', api.Y.outcome, 30_000)).toBeNull();
    apiLine = api.line;
    expect(await allFindings()).toEqual(findingsBefore);

    // A dry-run settle takes the gate and rolls back; the rollback releases it.
    const dry = nextRun();
    const dryResult = await within('B8 dry-run settle',
      startAfltablesSettle('B8 dry-run', a1Bundle(dry.label, A1_KEYS, dry.attendance), dry.observedAt, false).promise, 120_000);
    expect(dryResult.applied).toBe(false);
    expect(dryResult.batchId).toBeNull();
    expect((await matchRow(a1Key('MA')))?.attendance).toBe(tables.run.attendance);
    expect(await gateRows()).toEqual([]);

    // So a promotion takes the gate with no wait.
    const fileId = await stageApprovedFile('player_match_stats', [statsFileRow('M2', 'q', { goals: '2' })]);
    const started = Date.now();
    const promoted = await within('B8 promotion', startPromotion('B8 promotion', fileId).promise, 30_000);
    b8.promotionElapsedMs = Date.now() - started;
    expect(promoted).toMatchObject({ ok: true });
    expect(await promotionBatchCount(fileId)).toBe(1);
  }, 360_000);

  /* ---------------------------------------------------------------- *
   * B9 — promotions serialise
   * ---------------------------------------------------------------- */

  it('B9: promotions serialise on the gate: the second is refused while the first holds it, and succeeds once it commits', async () => {
    const q = playerIds.get('q')!;
    const b9: Record<string, number> = {};
    timings.B9 = b9;

    // Run 1: P2 waits behind a stuck P1 and is refused.
    const first = await startStuckPromotion('B9 P1');
    const file2 = await stageApprovedFile('player_match_stats', [statsFileRow('M2', 'q', { goals: '2' })]);
    const qBefore = await statsRow(q, apiKey('M2'));
    const p2Started = Date.now();
    const p2 = startPromotion('B9 P2', file2);
    const p2Pid = await waitUntil('B9: P2 queues behind P1', () => newWaiterBehind(first.promotionPid), [p2]);
    const wait = await waitUntil('B9: P2\'s gate wait is stamped', () => waitingOn(p2Pid, first.promotionPid), [p2]);
    expect({ waits: wait.waits, blockers: wait.blockers }).toEqual({ waits: ['advisory'], blockers: [first.promotionPid] });
    expect(await matchesRowLockModes(p2Pid)).toEqual([]);
    const refused = await within('B9 P2 (5 s hook bound)', p2.promise, 30_000);
    b9.refusedElapsedMs = (p2.finishedAt ?? Date.now()) - p2Started;
    expectRefusedRetryably('B9 P2', refused);
    expect(b9.refusedElapsedMs).toBeGreaterThanOrEqual(4500);
    expect(first.promotion.done).toBe(false);
    expect(await promotionBatchCount(file2)).toBe(0);
    expect(await statsRow(q, apiKey('M2'))).toEqual(qBefore);

    first.Xrow.go();
    expect(await within('B9 P1', first.promotion.promise, 60_000)).toMatchObject({ ok: true });
    expect(await within('B9 X', first.Xrow.outcome, 30_000)).toBeNull();
    expect(await promotionBatchCount(first.fileId)).toBe(1);
    // Retry of P2 after P1 has committed.
    expect(await within('B9 P2 retry', startPromotion('B9 P2 retry', file2).promise, 30_000)).toMatchObject({ ok: true });
    expect(await promotionBatchCount(file2)).toBe(1);

    // Run 2: P1 is allowed to commit within P2's bound, so P2 succeeds.
    const second = await startStuckPromotion('B9 P1b');
    const file4 = await stageApprovedFile('player_match_stats', [statsFileRow('M2', 'q', { goals: '2' })]);
    const p2bStarted = Date.now();
    const p2b = startPromotion('B9 P2b', file4);
    const p2bPid = await waitUntil('B9: P2b queues behind P1b', () => newWaiterBehind(second.promotionPid), [p2b]);
    await waitUntil('B9: P2b\'s gate wait is stamped', () => waitingOn(p2bPid, second.promotionPid), [p2b]);
    second.Xrow.go();
    const promotedB = await within('B9 P2b', p2b.promise, 60_000);
    const elapsedB = (p2b.finishedAt ?? Date.now()) - p2bStarted;
    b9.secondRunElapsedMs = elapsedB;
    expect(await within('B9 P1b', second.promotion.promise, 60_000)).toMatchObject({ ok: true });
    expect(await within('B9 X2', second.Xrow.outcome, 30_000)).toBeNull();
    // Inconclusive guard (as B2): a refusal here means P1b did not commit within the bound on this link.
    if (!promotedB.ok) throw new Error(`B9 INCONCLUSIVE: P2b did not obtain the gate within its 5 s bound after P1b was released (${elapsedB} ms): ${promotedB.error}`);
    expect(promotedB).toMatchObject({ ok: true });
    expect(await promotionBatchCount(second.fileId)).toBe(1);
    expect(await promotionBatchCount(file4)).toBe(1);
  }, 240_000);

  /* ---------------------------------------------------------------- *
   * B10 — the helper restores both previous settings inside the transaction
   * ---------------------------------------------------------------- */

  it('B10: acquireSettlePromotionGate restores both previous settings, holds the gate to commit and releases it after', async () => {
    const connection = client('B10 gate helper', null);
    const inside = await connection.begin(async (tx) => {
      await tx`SELECT set_config('lock_timeout', '7s', true), set_config('statement_timeout', '45s', true)`;
      await acquireSettlePromotionGate(tx);
      const [row] = await tx<{ pid: number; lockTimeout: string; statementTimeout: string; mode: string | null; granted: boolean | null }[]>`
        SELECT pg_backend_pid()::int AS pid, current_setting('lock_timeout') AS "lockTimeout",
               current_setting('statement_timeout') AS "statementTimeout",
               (SELECT mode::text FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'advisory'
                   AND classid = ${SETTLE_PROMOTION_GATE.classId}::oid AND objid = ${SETTLE_PROMOTION_GATE.objId}::oid) AS mode,
               (SELECT granted FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'advisory'
                   AND classid = ${SETTLE_PROMOTION_GATE.classId}::oid AND objid = ${SETTLE_PROMOTION_GATE.objId}::oid) AS granted
      `;
      return { ...row };
    });
    // Both previous values come back, not 0 and not the gate's own 300 s / 330 s; the gate is held, shared, to commit.
    expect(inside).toMatchObject({ lockTimeout: '7s', statementTimeout: '45s', mode: 'ShareLock', granted: true });
    // After commit the gate is gone, and the settings are back to the session's own.
    expect(gateRowOf(await gateRows(), inside.pid)).toBeUndefined();
    const [after] = await connection<{ pid: number; lockTimeout: string; statementTimeout: string }[]>`
      SELECT pg_backend_pid()::int AS pid, current_setting('lock_timeout') AS "lockTimeout",
             current_setting('statement_timeout') AS "statementTimeout"
    `;
    expect(after.pid).toBe(inside.pid);
    expect(after.lockTimeout).not.toBe('7s');
    expect(after.statementTimeout).not.toBe('45s');
    expect(after.lockTimeout).not.toBe('5min');
    expect(after.statementTimeout).not.toBe('330s');
  }, 60_000);

  /* ---------------------------------------------------------------- *
   * B11 — queue ordering at the gate (both shapes, runbook §20.3)
   * ---------------------------------------------------------------- */

  it('B11: a waiting promotion delays a later settle, and a waiting settle delays a later promotion', async () => {
    const q = playerIds.get('q')!;
    const b11: Record<string, number> = {};
    timings.B11 = b11;
    const findingsBefore = await allFindings();

    // ---- (a) a shared request queues behind a WAITING exclusive one ----
    const mrFile = await stageApprovedFile('match_results', [mrFileRow('MA'), mrFileRow('MB')]);
    const s1 = await startHeldAfltablesSettle('B11a S1');
    const pStarted = Date.now();
    const promotionA = startPromotion('B11a P', mrFile);
    const pPid = await waitUntil('B11a: P queues behind S1', () => newWaiterBehind(s1.settlePid), [s1.settle, promotionA]);
    await waitUntil('B11a: P\'s gate wait is stamped', () => waitingOn(pPid, s1.settlePid), [s1.settle, promotionA]);

    // S2 (AFL API) arrives while P waits, and is held open by a stall once granted.
    const s2Run = nextRun();
    const s2Line = lineOf(s2Run.n);
    const s2Venue = venueOf(s2Run.n);
    const Y = await hold('B11a Y on M3', lockMatch(apiId.M3, 'FOR SHARE'));
    const s2 = startAflApiSettle('B11a S2', apiBundle(s2Run.label, [apiUnit('M1', API_VENUE_SEED, s2Line), apiUnit('M3', s2Venue)]), s2Run.observedAt);
    const s2Pid = await waitUntil('B11a: S2 queues behind P at the gate', () => newWaiterBehind(pPid), [s1.settle, promotionA, s2]);
    const s2Wait = await waitUntil('B11a: S2\'s gate wait is stamped', () => waitingOn(s2Pid, pPid), [s1.settle, promotionA, s2]);
    // A SOFT block: S2 is blocked by the waiting promotion ahead of it, NOT by S1 (shared does not conflict with shared).
    expect({ waits: s2Wait.waits, blockers: s2Wait.blockers }).toEqual({ waits: ['advisory'], blockers: [pPid] });
    expect(gateRowOf(await gateRows(), s2Pid)).toMatchObject({ mode: 'ShareLock', granted: false });

    // P is refused at its 5 s bound; S2 is then granted while S1 still holds, so two ShareLocks are granted at once.
    expectRefusedRetryably('B11a P', await within('B11a P (5 s hook bound)', promotionA.promise, 30_000));
    b11.promotionAElapsedMs = (promotionA.finishedAt ?? Date.now()) - pStarted;
    expect(b11.promotionAElapsedMs).toBeGreaterThanOrEqual(4500);
    expect(await promotionBatchCount(mrFile)).toBe(0);
    const both = await waitUntil('B11a: S2 is granted while S1 still holds the gate', async () => {
      const snapshot = await gateRows();
      const shared = grantedShared(snapshot);
      return shared.includes(s1.settlePid) && shared.includes(s2Pid) ? snapshot : null;
    }, [s1.settle, s2]);
    expect(both.filter((row) => !row.granted)).toEqual([]);
    // Released one after the other (see B8).
    s1.X.go();
    expectCommitted('B11a S1', await within('B11a S1', s1.settle.promise, 120_000));
    Y.go();
    expectCommitted('B11a S2', await within('B11a S2', s2.promise, 120_000));
    expect(await within('B11a X', s1.X.outcome, 30_000)).toBeNull();
    expect(await within('B11a Y', Y.outcome, 30_000)).toBeNull();
    apiLine = s2Line;
    expect(await allFindings()).toEqual(findingsBefore);

    // ---- (b) a promotion queues behind a WAITING shared request ----
    const stuck = await startStuckPromotion('B11b P1');
    const sRun = nextRun();
    // The settle, once granted, is held open by X2 on MA's spine record after it has written MB and MC.
    const X2 = await hold('B11b X2 on the MA spine record', lockSpineRecord(A1.MA.record));
    const s = startAfltablesSettle('B11b S', a1Bundle(sRun.label, STALL_ORDER, sRun.attendance), sRun.observedAt);
    const sPid = await waitUntil('B11b: S queues behind P1 at the gate', () => newWaiterBehind(stuck.promotionPid), [s]);
    await waitUntil('B11b: S\'s gate wait is stamped', () => waitingOn(sPid, stuck.promotionPid), [s]);
    const file2 = await stageApprovedFile('player_match_stats', [statsFileRow('M2', 'q', { goals: '2' })]);
    const qBefore = await statsRow(q, apiKey('M2'));
    const p2Started = Date.now();
    const p2 = startPromotion('B11b P2', file2);
    // Both S and P2 queue behind P1 (S directly, P2 behind both), so P2 is the waiter that is not S.
    const p2Pid = await waitUntil('B11b: P2 queues behind P1 and S', () => newWaiterBehind(stuck.promotionPid, new Set([sPid])), [p2]);
    const p2Wait = await waitUntil('B11b: P2\'s gate wait is stamped', async () => {
      const snapshot = await waitSnapshot(p2Pid);
      return snapshot.waitStartMs !== null && snapshot.blockers.includes(sPid) ? snapshot : null;
    }, [p2]);
    // P2 is blocked by the waiting settle S (a soft block) as well as by P1, which holds the gate.
    expect(p2Wait.waits).toEqual(['advisory']);
    expect(p2Wait.blockers).toContain(sPid);
    expect(p2Wait.blockers).toContain(stuck.promotionPid);

    // Release P1: it commits, and S is granted FIRST, ahead of the later promotion P2.
    stuck.Xrow.go();
    expect(await within('B11b P1', stuck.promotion.promise, 60_000)).toMatchObject({ ok: true });
    expect(await within('B11b X', stuck.Xrow.outcome, 30_000)).toBeNull();
    const order = await waitUntil('B11b: S is granted while P2 still waits', async () => {
      const snapshot = await gateRows();
      return gateRowOf(snapshot, sPid)?.granted === true && gateRowOf(snapshot, p2Pid)?.granted === false ? snapshot : null;
    }, [s]);
    expect(gateRowOf(order, sPid)).toMatchObject({ mode: 'ShareLock', granted: true });
    expect(gateRowOf(order, p2Pid)).toMatchObject({ mode: 'ExclusiveLock', granted: false });

    // P2 is refused at its 5 s bound, with nothing written, while S still runs (X2 holds it).
    const refusedB = await within('B11b P2 (5 s hook bound)', p2.promise, 30_000);
    b11.promotionBElapsedMs = (p2.finishedAt ?? Date.now()) - p2Started;
    expect(s.done).toBe(false);
    expectRefusedRetryably('B11b P2', refusedB);
    expect(b11.promotionBElapsedMs).toBeGreaterThanOrEqual(4500);
    expect(await promotionBatchCount(file2)).toBe(0);
    expect(await statsRow(q, apiKey('M2'))).toEqual(qBefore);

    X2.go();
    expectCommitted('B11b S', await within('B11b S', s.promise, 120_000));
    expect(await within('B11b X2', X2.outcome, 30_000)).toBeNull();
    for (const k of A1_KEYS) expect((await matchRow(a1Key(k)))?.attendance).toBe(sRun.attendance);
    // Retry of P2 after S has committed.
    expect(await within('B11b P2 retry', startPromotion('B11b P2 retry', file2).promise, 30_000)).toMatchObject({ ok: true });
    expect(await promotionBatchCount(file2)).toBe(1);
    expect(await promotionBatchCount(stuck.fileId)).toBe(1);
  }, 360_000);

  /* ---------------------------------------------------------------- *
   * B5 — match_attendance, the third legacy writer (last: it changes attendance on matches the other API cases settle)
   * ---------------------------------------------------------------- */

  it('B5: match_attendance · refused at the gate with nothing written; its re-promotion locks the matches in ascending id', async () => {
    const run = nextRun();
    const venue = venueOf(run.n);
    const b5: Record<string, number> = {};
    timings.B5 = b5;
    const findingsBefore = await allFindings();
    const [m1, m2] = [apiId.M1, apiId.M2];
    const attendanceBefore = [(await matchRow(apiKey('M1')))?.attendance ?? null, (await matchRow(apiKey('M2')))?.attendance ?? null];

    // The attendance file is ordered M2, M1 (the opposite of ascending id).
    const fileId = await stageApprovedFile('match_attendance', [
      { match_id: String(m2), attendance: '41000' },
      { match_id: String(m1), attendance: '42000' },
    ]);
    // The settle writes M1 (its venue changes), then waits at M2 (a changed venue; Y holds M2 FOR SHARE).
    const Y = await hold('B5 Y on M2', lockMatch(m2, 'FOR SHARE'));
    const settle = startAflApiSettle('B5 settle', apiBundle(run.label, [
      apiUnit('M1', venue, apiLine), apiUnit('M2', venue),
    ]), run.observedAt);
    const settlePid = await waitUntil('B5: the settle queues behind Y on M2', () => newWaiterBehind(Y.pid), [settle]);

    const promotionStarted = Date.now();
    const promotion = startPromotion('B5 promotion', fileId);
    const promotionPid = await waitUntil('B5: the promotion queues behind the settle', () => newWaiterBehind(settlePid), [settle, promotion]);
    const wait = await waitUntil('B5: the promotion\'s gate wait is stamped', () => waitingOn(promotionPid, settlePid), [settle, promotion]);
    expect({ waits: wait.waits, blockers: wait.blockers }).toEqual({ waits: ['advisory'], blockers: [settlePid] });
    expect(await matchesRowLockModes(promotionPid)).toEqual([]);

    b5.gateWaitSamples = await watchGateWait('B5 promotion wait', promotion as Run<unknown>, promotionPid, settlePid);
    expect(b5.gateWaitSamples).toBeGreaterThan(0);
    const refused = await within('B5 promotion (5 s hook bound)', promotion.promise, 30_000);
    b5.promotionElapsedMs = (promotion.finishedAt ?? Date.now()) - promotionStarted;
    expect(settle.done).toBe(false);
    expectRefusedRetryably('B5 promotion', refused);
    expect(b5.promotionElapsedMs).toBeGreaterThanOrEqual(4500);
    expect(await promotionBatchCount(fileId)).toBe(0);
    expect([(await matchRow(apiKey('M1')))?.attendance ?? null, (await matchRow(apiKey('M2')))?.attendance ?? null]).toEqual(attendanceBefore);

    Y.go();
    expectCommitted('B5 settle', await within('B5 settle after Y', settle.promise, 120_000));
    expect(await within('B5 Y', Y.outcome, 30_000)).toBeNull();
    expect(await allFindings()).toEqual(findingsBefore);
    expect((await matchRow(apiKey('M1')))?.venueRaw).toBe(venue);
    expect((await matchRow(apiKey('M2')))?.venueRaw).toBe(venue);

    // Ascending order, in the database: a side transaction holds M2 FOR SHARE, so the re-promotion's one locking
    // statement takes M1 (the lower id) and then waits on M2. M1 is therefore held although the file lists M2 first.
    // The probe connects BEFORE the re-promotion starts, so its connect is not spent from the hook's 5 s bound.
    const probe = client('B5 probe', null);
    await probe`SELECT 1`;
    const Z = await hold('B5 Z on M2', lockMatch(m2, 'FOR SHARE'));
    const retry = startPromotion('B5 re-promotion', fileId);
    const retryPid = await waitUntil('B5: the re-promotion queues behind Z at M2', () => newWaiterBehind(Z.pid), [retry]);
    expect(await matchesRowLockModes(retryPid)).toContain('RowShareLock');
    const probed = await probe.begin((tx) => tx`SELECT id FROM matches WHERE id = ${m1} FOR UPDATE NOWAIT`).then(() => null, (error: unknown) => error);
    expect({ m1HeldByThePromotion: sqlstate(probed) }).toEqual({ m1HeldByThePromotion: '55P03' });
    Z.go();
    expect(await within('B5 Z', Z.outcome, 30_000)).toBeNull();
    expect(await within('B5 re-promotion', retry.promise, 60_000)).toMatchObject({ ok: true });
    expect(await promotionBatchCount(fileId)).toBe(1);
    expect([(await matchRow(apiKey('M2')))?.attendance, (await matchRow(apiKey('M1')))?.attendance]).toEqual([41000, 42000]);
  }, 240_000);
});
