/**
 * AFLDB-ISSUE-128 — the source-completeness verdict for an AFL Tables settle run.
 *
 * WHY THIS EXISTS. `AFLDB-ISSUE-122`'s chain is fail-closed at every stage
 * that could corrupt data, and correctly so: a source row AFLDB cannot
 * interpret is never guessed at, never projected and never swept as absent.
 * What it was NOT is *loud*. On 2026-09-03 the chain acquired 209 matches and
 * 9,614 player-match rows from AFL Tables, emitted a bundle carrying 207 and
 * 9,522, marked both enumerations `complete: false`, recorded 94 unkeyed
 * rejections — and exited 0, reporting a healthy run. The two missing matches
 * were the 2026 Wildcard Final round, whose `WF` / `Wildcard Final` round
 * vocabulary the importer does not know (`AFLDB-ISSUE-129` owns that).
 *
 * The defect this module fixes is not the dropped rows. It is that a run
 * could drop them and still claim success.
 *
 * THE EVIDENCE IS THE SOURCE'S OWN. Every input below is a count the settle
 * already derives from the acquired snapshot; none of it is a calendar
 * heuristic. That matters, because "there must have been a game in the last N
 * days" is wrong for byes, for the finals gap and for five months of every
 * year. A round in which nothing was acquired produces zero unrepresentable
 * rows and reads `complete` — which is the truth, not a lucky default.
 *
 * PURE. No database, no `server-only`, no I/O: the settle CLI, the admin
 * query and the admin panel (a client component) all render the same verdict
 * from the same function.
 */

/**
 * `unknown` is a first-class outcome, not an error case. A run that ended
 * before the counter stamp — or a batch row whose `validation_result` is NULL
 * — proves nothing about the source, and reporting that as `complete` would
 * be exactly the false reassurance this module exists to remove.
 */
export type SourceCompletenessStatus = 'complete' | 'incomplete' | 'unknown';

/** The stable machine codes. Rendered text is derived from these, never parsed back. */
export type SourceCompletenessReasonCode =
  | 'unrepresentable_rows'
  | 'rejected_records'
  | 'scopes_not_swept'
  | 'no_counters';

export type SourceCompletenessReason = {
  code: SourceCompletenessReasonCode;
  /** How many rows/records/scopes the code describes. 0 only for `no_counters`. */
  count: number;
  detail: string;
};

export type SourceCompletenessVerdict = {
  status: SourceCompletenessStatus;
  /**
   * Rows the source supplied whose PRESENCE AFLDB could not even represent,
   * so they are absent from the bundle's enumeration. The strongest signal
   * available: a row counted here was seen upstream and then vanished.
   */
  unrepresentableRows: number;
  /** Records that were enumerated as present but did not project. */
  rejectedRecords: number;
  /** `(family, scope)` pairs the run refused to absence-sweep because they were not proven complete. */
  scopesNotSwept: number;
  /** Records the bundle did carry — the denominator the counts above are read against. */
  enumeratedRecords: number;
  reasons: readonly SourceCompletenessReason[];
  /** One line fit for a terminal, a journal or an admin panel. */
  headline: string;
};

/**
 * Exactly the counters this verdict reads.
 *
 * Declared structurally rather than as `Pick<SettleCounters, …>` so the admin
 * surface — which projects a whitelist out of `import_batches.validation_result`
 * and legitimately has no `SettleCounters` object — can satisfy it without
 * importing the settle's internal shape.
 */
export type SourceCompletenessCounters = {
  snapshotMatches: number;
  snapshotPlayerMatchRows: number;
  snapshotRejections: number;
  snapshotUnkeyedRejections: number;
  absenceSweepSkipped: number;
};

const UNKNOWN_HEADLINE =
  'Source completeness UNKNOWN: the run recorded no counters, so whether AFL Tables '
  + 'supplied rows this run could not represent is not established.';

/**
 * The verdict.
 *
 * `null` counters mean the run did not reach its counter stamp. That is
 * `unknown`, never `complete`.
 */
export function assessSourceCompleteness(
  counters: SourceCompletenessCounters | null | undefined,
): SourceCompletenessVerdict {
  if (!counters) {
    return {
      status: 'unknown',
      unrepresentableRows: 0,
      rejectedRecords: 0,
      scopesNotSwept: 0,
      enumeratedRecords: 0,
      reasons: [{
        code: 'no_counters',
        count: 0,
        detail: 'The run did not record a counter set, so its source coverage is unproven.',
      }],
      headline: UNKNOWN_HEADLINE,
    };
  }

  const unrepresentableRows = nonNegative(counters.snapshotUnkeyedRejections);
  const rejectedRecords = nonNegative(counters.snapshotRejections);
  const scopesNotSwept = nonNegative(counters.absenceSweepSkipped);
  const enumeratedRecords =
    nonNegative(counters.snapshotMatches) + nonNegative(counters.snapshotPlayerMatchRows);

  const reasons: SourceCompletenessReason[] = [];
  if (unrepresentableRows > 0) {
    reasons.push({
      code: 'unrepresentable_rows',
      count: unrepresentableRows,
      detail:
        `${unrepresentableRows} row(s) acquired from AFL Tables had no identity AFLDB could `
        + 'represent, so they are not in the snapshot enumeration at all and cannot reach '
        + 'canonical data. They were observed upstream and dropped here.',
    });
  }
  if (rejectedRecords > 0) {
    reasons.push({
      code: 'rejected_records',
      count: rejectedRecords,
      detail:
        `${rejectedRecords} enumerated record(s) did not project, so nothing was proposed for `
        + 'them. Their presence is recorded; their content is not.',
    });
  }
  if (scopesNotSwept > 0) {
    reasons.push({
      code: 'scopes_not_swept',
      count: scopesNotSwept,
      detail:
        `${scopesNotSwept} scope(s) were not proven complete, so the absence sweep was skipped `
        + 'for them. Nothing there can be trusted to have disappeared rather than been missed.',
    });
  }

  const status: SourceCompletenessStatus = reasons.length === 0 ? 'complete' : 'incomplete';
  return {
    status,
    unrepresentableRows,
    rejectedRecords,
    scopesNotSwept,
    enumeratedRecords,
    reasons,
    headline: headlineFor(status, unrepresentableRows, rejectedRecords, scopesNotSwept,
      enumeratedRecords),
  };
}

/**
 * A counter that is missing, negative or not a finite number is read as 0.
 *
 * Deliberately NOT read as "suspicious, therefore incomplete": the admin
 * surface already reports a run with no counter set as `unknown`, and letting
 * a single malformed integer inside an otherwise-stamped counter set escalate
 * to `incomplete` would produce an alarm no operator could act on.
 */
function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function headlineFor(
  status: SourceCompletenessStatus,
  unrepresentableRows: number,
  rejectedRecords: number,
  scopesNotSwept: number,
  enumeratedRecords: number,
): string {
  if (status === 'complete') {
    return enumeratedRecords === 0
      ? 'Source complete: AFL Tables supplied no rows for this scope, and none were dropped.'
      : `Source complete: all ${enumeratedRecords} acquired record(s) were represented, `
        + 'none were dropped, and every scope was proven sweepable.';
  }
  const parts: string[] = [];
  if (unrepresentableRows > 0) parts.push(`${unrepresentableRows} unrepresentable row(s)`);
  if (rejectedRecords > 0) parts.push(`${rejectedRecords} unprojected record(s)`);
  if (scopesNotSwept > 0) parts.push(`${scopesNotSwept} unswept scope(s)`);
  return `Source INCOMPLETE: ${parts.join(', ')}. This run must not be read as a `
    + 'complete import of AFL Tables current-season data.';
}

/** The verdict as terminal/journal lines. Used by the settle CLI. */
export function renderSourceCompleteness(
  verdict: SourceCompletenessVerdict,
): string[] {
  const lines = ['', `Source completeness: ${verdict.status.toUpperCase()}`, `  ${verdict.headline}`];
  for (const reason of verdict.reasons) {
    lines.push(`  - ${reason.code}: ${reason.detail}`);
  }
  if (verdict.status === 'incomplete') {
    lines.push(
      '  Investigate before treating this season as settled. An unrepresentable row is a '
      + 'source vocabulary or identity AFLDB does not model yet, not a source outage.',
    );
  }
  return lines;
}
