/**
 * AFLDB-ISSUE-316 C7 — the READ-ONLY observer for "acceptance of the first concluded round".
 *
 * WHAT THIS IS. A pure classifier (`classifyC7`) over facts, and a reader (`readC7Facts`) that
 * gathers those facts from PostgreSQL with SELECTs only. It makes no provider request, writes
 * nothing and starts nothing. It does NOT approve the C7 criteria (the owner does, in advance, per
 * `docs/v2/issue316-closeout-and-seasonal-obligations-2026-11-02.md` section 3.2) and it never
 * records an acceptance: its best verdict is `MEASURED_CRITERIA_MET`, which says the criteria that a
 * database read can measure held, and lists what it could NOT measure. The owner accepts.
 *
 * THE FIVE VERDICTS (each distinct, by design):
 *   NO_BATCH               no `settle-afl-api.ts` batch retained since the cutover: the run did not
 *                          happen, or it refused and rolled back. The database cannot say which; read
 *                          the unit result and the journal.
 *   NO_CONCLUDED_MATCHES   a settle ran and retained a batch, and the retained season feed shows no
 *                          CONCLUDED match (and no canonical `afl_api` match exists). This is the
 *                          expected state until the first round concludes. It is not a failure.
 *   INCOMPLETE_ACQUISITION the source was not proven complete, or fewer canonical matches than the
 *                          feed's CONCLUDED count exist, or concluded matches lack period scores or
 *                          both sides' player statistics, with clean runs.
 *   FAILED_PROCESSING      a settle batch is not completed, a run counter shows a refusal or failure
 *                          (unresolved identity, build failure, apply failure or refusal, rejection,
 *                          collision, disagreement), derived data did not recompute, AFL Tables
 *                          batches appeared after the cutover, the unit failed, or the counts
 *                          contradict each other.
 *   MEASURED_CRITERIA_MET  every measurable criterion held. Criterion 8 (public pages within the
 *                          ISR window) is never measurable here, criterion 1 only when the unit
 *                          result is supplied, and the AFL Tables snapshot-label and timer checks are
 *                          host-side: all are returned in `notMeasured`.
 */
import type postgres from 'postgres';

/** The provider's own status string for a finished match (kept verbatim in `seasonFeedStatusCounts`). */
export const C7_CONCLUDED_STATUS = 'CONCLUDED';
export const C7_SETTLE_TOOL = 'settle-afl-api.ts';
export const C7_AFLTABLES_SETTLE_TOOL = 'settle-afltables.ts';
export const C7_SOURCE_KEY = 'afl_api';

export type C7Verdict =
  | 'NO_BATCH'
  | 'NO_CONCLUDED_MATCHES'
  | 'INCOMPLETE_ACQUISITION'
  | 'FAILED_PROCESSING'
  | 'MEASURED_CRITERIA_MET';

/** Process exit codes, one per verdict; 2 is reserved for helper or usage errors. */
export const C7_EXIT_CODES: Readonly<Record<C7Verdict, number>> = {
  MEASURED_CRITERIA_MET: 0,
  NO_CONCLUDED_MATCHES: 10,
  INCOMPLETE_ACQUISITION: 11,
  FAILED_PROCESSING: 12,
  NO_BATCH: 13,
};

export type C7Batch = {
  id: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  /** Parsed from the batch notes (`season=2027`), or null when the notes carry none. */
  season: number | null;
  /** The `validation_result` jsonb, or null when the run failed before stamping it. */
  counters: Record<string, unknown> | null;
};

export type C7Facts = {
  database: string;
  season: number;
  since: string;
  /** Round scope for the canonical counts, or null for the whole season. */
  round: string | null;
  /** Owner-supplied CONCLUDED count for the round; required when `round` is set. */
  expectedConcluded: number | null;
  /** `settle-afl-api.ts` batches since `since`, newest first, any season, any status. */
  batches: readonly C7Batch[];
  canonical: {
    /** Canonical matches in the season (and round) owned by source `afl_api`. */
    matches: number;
    /** Of those, matches with at least eight quarter rows (two clubs, periods 1 to 4). */
    withPeriodScores: number;
    /** Of those, matches with player statistics for both clubs. */
    withPlayerStatsBothClubs: number;
    /** Canonical matches in the season (and round) owned by any other source. Informational. */
    otherSource: number;
  };
  /** `settle-afltables.ts` batches since `since`. After the cutover this must be 0. */
  afltablesBatchesSince: number;
  /** The unit's result when supplied (systemd view), or null = not measured. */
  unit: { result: string; execMainStatus: string } | null;
};

export type C7Report = {
  verdict: C7Verdict;
  /** Why, in order of the check that decided it. */
  reasons: string[];
  /** Facts that were computed, for the printed report. */
  figures: Record<string, string | number | null>;
  /** What this observation could not measure (never empty on `MEASURED_CRITERIA_MET`). */
  notMeasured: string[];
};

/** Counters that must be zero on the newest completed batch for a clean run. */
export const C7_ERROR_COUNTERS = [
  'unresolvedIdentityPlayer',
  'unresolvedIdentityClub',
  'unresolvedIdentityVenue',
  'unresolvedIdentityMatch',
  'buildFailures',
  'canonicalApplyFailures',
  'canonicalApplyRefusals',
  'snapshotRejections',
  'snapshotUnkeyedRejections',
  'foreignOwnedCollision',
  'sourceDisagreement',
  'manualAuthorityRefusals',
] as const;

const num = (source: Record<string, unknown> | null, key: string): number => {
  const value = source?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

const concludedOf = (counters: Record<string, unknown> | null): number => {
  const counts = counters?.seasonFeedStatusCounts;
  if (counts === null || typeof counts !== 'object') return 0;
  const value = (counts as Record<string, unknown>)[C7_CONCLUDED_STATUS];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

/** A batch belongs to the season when its notes say so, or say nothing (then it cannot be excluded). */
const inSeason = (batch: C7Batch, season: number): boolean => batch.season === null || batch.season === season;

export function classifyC7(facts: C7Facts): C7Report {
  const reasons: string[] = [];
  const figures: Record<string, string | number | null> = {
    database: facts.database, season: facts.season, since: facts.since, round: facts.round,
  };
  const notMeasured: string[] = [
    'criterion 8: public season pages show the round within the ISR window the owner chose (D-316-10); a database read cannot measure it',
    'criterion 7, host-side part: no new AFL Tables snapshot label, timer disabled, register retired (c5-accept covers the timers and register; the snapshot-label listing is host-side)',
  ];
  if (facts.unit === null) {
    notMeasured.unshift('criterion 1: the scheduled unit ended Result=success, ExecMainStatus=0 on each night of the round week (pass --systemd on the host, and read each night)');
  }

  if (facts.round !== null && facts.expectedConcluded === null) {
    throw new Error('a round-scoped observation needs --expected-concluded: the per-round CONCLUDED count is the owner\'s reading of the retained feed');
  }

  const batches = facts.batches.filter((b) => inSeason(b, facts.season));
  const completed = batches.filter((b) => b.status === 'completed');
  const notCompleted = batches.filter((b) => b.status !== 'completed');
  const latest = completed[0] ?? null;
  figures.settleBatchesSinceCutover = batches.length;
  figures.completedBatches = completed.length;
  figures.notCompletedBatches = notCompleted.length;
  figures.newestCompletedBatch = latest?.id ?? null;
  figures.canonicalAflApiMatches = facts.canonical.matches;
  figures.canonicalOtherSourceMatches = facts.canonical.otherSource;
  figures.afltablesBatchesSince = facts.afltablesBatchesSince;

  // 1. Hard processing failures that do not depend on the feed.
  if (notCompleted.length > 0) {
    reasons.push(`${notCompleted.length} settle-afl-api.ts batch(es) not completed since the cutover (ids ${notCompleted.map((b) => b.id).join(', ')}; statuses ${[...new Set(notCompleted.map((b) => b.status))].join(', ')})`);
  }
  if (facts.afltablesBatchesSince > 0) {
    reasons.push(`${facts.afltablesBatchesSince} AFL Tables settle batch(es) since the cutover: AFL Tables is retired, so this contradicts the cutover`);
  }
  if (facts.unit !== null && (facts.unit.result !== 'success' || facts.unit.execMainStatus !== '0')) {
    reasons.push(`the unit's last run is Result=${facts.unit.result} ExecMainStatus=${facts.unit.execMainStatus}, not success/0`);
  }
  if (reasons.length > 0) return { verdict: 'FAILED_PROCESSING', reasons, figures, notMeasured };

  // 2. Nothing retained at all.
  if (latest === null) {
    reasons.push('no completed settle-afl-api.ts batch since the cutover: no scheduled run retained one (it did not run, or it refused and rolled back); read the unit result and journal');
    return { verdict: 'NO_BATCH', reasons, figures, notMeasured };
  }

  const counters = latest.counters;
  const concludedWholeFeed = concludedOf(counters);
  const expected = facts.expectedConcluded ?? concludedWholeFeed;
  figures.seasonFeedMatches = num(counters, 'seasonFeedMatches');
  figures.seasonFeedComplete = num(counters, 'seasonFeedComplete');
  figures.concludedInFeed = concludedWholeFeed;
  figures.expectedConcluded = expected;

  // 3. Nothing concluded yet.
  if (expected === 0) {
    if (facts.canonical.matches > 0) {
      reasons.push(`the feed shows 0 ${C7_CONCLUDED_STATUS} but ${facts.canonical.matches} canonical ${C7_SOURCE_KEY} match(es) exist: the counts contradict each other and need review`);
      return { verdict: 'FAILED_PROCESSING', reasons, figures, notMeasured };
    }
    reasons.push(`batch ${latest.id} completed and the retained season feed shows 0 ${C7_CONCLUDED_STATUS} match(es); no canonical ${C7_SOURCE_KEY} match exists. Expected before the first round concludes; nothing to accept yet`);
    return { verdict: 'NO_CONCLUDED_MATCHES', reasons, figures, notMeasured };
  }

  // 4. The source was not proven complete.
  if (num(counters, 'seasonFeedComplete') !== 1) {
    reasons.push(`batch ${latest.id}: seasonFeedComplete is ${num(counters, 'seasonFeedComplete')}, not 1: the season feed was not proven complete`);
    return { verdict: 'INCOMPLETE_ACQUISITION', reasons, figures, notMeasured };
  }

  // 5. Run counters that show a refusal or failure.
  const errors = C7_ERROR_COUNTERS.filter((key) => num(counters, key) > 0).map((key) => `${key}=${num(counters, key)}`);
  if (errors.length > 0) {
    reasons.push(`batch ${latest.id} counters show refusals or failures: ${errors.join(', ')}`);
    return { verdict: 'FAILED_PROCESSING', reasons, figures, notMeasured };
  }
  const derivedRuns = completed.reduce((sum, b) => sum + num(b.counters, 'derivedRecomputeRuns'), 0);
  figures.derivedRecomputeRuns = derivedRuns;

  // 6. Canonical results against the concluded count.
  if (facts.canonical.matches > expected) {
    reasons.push(`${facts.canonical.matches} canonical ${C7_SOURCE_KEY} match(es) but only ${expected} ${C7_CONCLUDED_STATUS}: the counts contradict each other`);
    return { verdict: 'FAILED_PROCESSING', reasons, figures, notMeasured };
  }
  if (facts.canonical.matches < expected) {
    reasons.push(`${facts.canonical.matches} canonical ${C7_SOURCE_KEY} match(es) for ${expected} ${C7_CONCLUDED_STATUS}: ${expected - facts.canonical.matches} concluded match(es) are not settled yet`);
    return { verdict: 'INCOMPLETE_ACQUISITION', reasons, figures, notMeasured };
  }
  const missingPeriods = facts.canonical.matches - facts.canonical.withPeriodScores;
  const missingStats = facts.canonical.matches - facts.canonical.withPlayerStatsBothClubs;
  if (missingPeriods > 0 || missingStats > 0) {
    if (missingPeriods > 0) reasons.push(`${missingPeriods} settled match(es) lack the eight quarter rows`);
    if (missingStats > 0) reasons.push(`${missingStats} settled match(es) lack player statistics for both clubs`);
    return { verdict: 'INCOMPLETE_ACQUISITION', reasons, figures, notMeasured };
  }
  if (derivedRuns === 0) {
    reasons.push('no completed batch reports a derived-data recompute (derivedRecomputeRuns is 0 across the batches)');
    return { verdict: 'FAILED_PROCESSING', reasons, figures, notMeasured };
  }

  reasons.push(`${facts.canonical.matches} of ${expected} ${C7_CONCLUDED_STATUS} match(es) settled with period scores and both sides' statistics; batch ${latest.id} clean; derived recompute ran; no non-completed settle batch; no AFL Tables batch since the cutover`);
  return { verdict: 'MEASURED_CRITERIA_MET', reasons, figures, notMeasured };
}

type Sql = postgres.Sql | postgres.TransactionSql;

/**
 * Gather the facts with SELECTs only. The caller supplies the connection and is responsible for it
 * being read-only (the CLI opens `sql.begin('read only', ...)`); this function issues no write.
 */
export async function readC7Facts(
  sql: Sql,
  options: {
    season: number; since: string; round: string | null; expectedConcluded: number | null;
    unit: C7Facts['unit'];
  },
): Promise<C7Facts> {
  const [{ database }] = await sql<{ database: string }[]>`SELECT current_database() AS database`;

  const batchRows = await sql<{
    id: string; status: string; startedAt: string; completedAt: string | null; notes: string | null; validationResult: unknown;
  }[]>`
    SELECT b.id::text AS id, b.status::text AS status, b.started_at::text AS "startedAt",
           b.completed_at::text AS "completedAt", b.notes AS notes, b.validation_result AS "validationResult"
      FROM import_batches b
     WHERE b.tool = ${C7_SETTLE_TOOL}
       AND b.started_at >= ${options.since}::timestamptz
     ORDER BY b.id DESC
     LIMIT 1000`;
  const batches: C7Batch[] = batchRows.map((row) => {
    const season = row.notes === null ? null : /season=(\d{4})/.exec(row.notes)?.[1];
    let counters = row.validationResult;
    // postgres.js normally decodes jsonb; tolerate the raw-text form too (the project's fromStore rule).
    if (typeof counters === 'string') {
      try { counters = JSON.parse(counters); } catch { counters = null; }
    }
    return {
      id: row.id, status: row.status, startedAt: row.startedAt, completedAt: row.completedAt,
      season: season === undefined || season === null ? null : Number(season),
      counters: counters !== null && typeof counters === 'object' ? (counters as Record<string, unknown>) : null,
    };
  });

  const round = options.round;
  const [canonical] = await sql<{ matches: number; withPeriodScores: number; withPlayerStatsBothClubs: number; otherSource: number }[]>`
    SELECT count(*) FILTER (WHERE src.key = ${C7_SOURCE_KEY})::int AS matches,
           count(*) FILTER (WHERE src.key = ${C7_SOURCE_KEY} AND (
             SELECT count(*) FROM match_period_scores p
              WHERE p.match_id = m.id AND p.period BETWEEN 1 AND 4) >= 8)::int AS "withPeriodScores",
           count(*) FILTER (WHERE src.key = ${C7_SOURCE_KEY} AND (
             SELECT count(DISTINCT s.club_id) FROM player_match_stats s WHERE s.match_id = m.id) = 2)::int AS "withPlayerStatsBothClubs",
           count(*) FILTER (WHERE src.key IS DISTINCT FROM ${C7_SOURCE_KEY})::int AS "otherSource"
      FROM matches m
      LEFT JOIN sources src ON src.id = m.source_id
     WHERE m.season = ${options.season}
       AND (${round}::text IS NULL OR m.round_code = ${round}::text)`;

  const [{ n: afltablesBatchesSince }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM import_batches
     WHERE tool = ${C7_AFLTABLES_SETTLE_TOOL} AND started_at >= ${options.since}::timestamptz`;

  return {
    database, season: options.season, since: options.since, round,
    expectedConcluded: options.expectedConcluded, batches, canonical,
    afltablesBatchesSince, unit: options.unit,
  };
}
