/**
 * Presentation vocabulary for /clubs/compare (AFLDB-ISSUE-144 Stage 8).
 *
 * Pure and database-free on purpose. Every function here turns a value
 * the Stage 1-6 query layer already decided into the words a reader
 * sees; none of them decides anything. In particular:
 *
 *  - a coverage state is READ, never inferred from a null number;
 *  - an unavailable statistic is never rendered as `0`;
 *  - a record label always names the organisation whose record it is,
 *    because one meeting can hold two opposite records at once (match
 *    14132 is Adelaide's biggest quarter-time lead AND Brisbane Lions'
 *    biggest comeback from quarter time).
 *
 * The type imports are `import type` only, so nothing here pulls the
 * server-only query module into a test or a client bundle.
 */
import type {
  ClubSeasonTeamMetric,
  CrossoverDirection,
  H2HOutcome,
  H2HPeriodRecordKind,
  H2HRecordKind,
  H2HTurnaroundSegment,
  MatchType,
  MetricCoverage,
} from '@/db/queries/club-comparison';

export const MATCH_TYPE_LABELS: Record<MatchType, string> = {
  'all': 'All matches',
  'home-and-away': 'Home and away',
  'finals': 'Finals',
};

export function matchTypeLabel(matchType: MatchType): string {
  return MATCH_TYPE_LABELS[matchType];
}

/**
 * What a runtime `stat_availability` state means in words. `missing`
 * says there is no coverage row at all, which is not the same claim as
 * "recorded as nothing".
 */
export function coverageLabel(coverage: MetricCoverage): string {
  switch (coverage) {
    case 'complete': return 'Complete';
    case 'partial': return 'Partially recorded';
    case 'pending': return 'Pending';
    case 'not_collected': return 'Not recorded';
    case 'not_applicable': return 'Not applicable';
    case 'missing': return 'No coverage record';
  }
}

/**
 * How one team-stat average should be presented.
 *
 * `kind` exists so a caller can style an unavailable state without
 * re-testing the coverage flags, and so a test can assert that an
 * unavailable metric is not a number.
 */
export type MetricPresentation = {
  kind: 'value' | 'unavailable';
  /** The number, or the words explaining why there is none. Never '0'. */
  text: string;
  /** The honest denominator, when it is not the whole season. */
  note: string | null;
};

/** A count of matches, e.g. `23 of 24 matches`. */
export function denominatorNote(eligible: number, total: number): string {
  return `${eligible.toLocaleString('en-AU')} of ${total.toLocaleString('en-AU')} ${
    total === 1 ? 'match' : 'matches'
  }`;
}

export function teamMetricPresentation(metric: ClubSeasonTeamMetric): MetricPresentation {
  if (!metric.isAvailable || metric.average === null) {
    return { kind: 'unavailable', text: coverageLabel(metric.coverage), note: null };
  }
  // A complete season can still be short a match's player rows, so the
  // denominator is disclosed on any discrepancy, not only on `partial`.
  const note = metric.isPartial || metric.hasDenominatorDiscrepancy
    ? denominatorNote(metric.eligibleMatches, metric.totalTeamMatches)
    : null;
  return { kind: 'value', text: metric.average.toFixed(1), note };
}

/**
 * True when the two clubs' figures for one metric are not measured over
 * the same population, in which case the page must not present them as
 * a like-for-like contest.
 */
export function hasUnequalCoverage(
  a: ClubSeasonTeamMetric | undefined,
  b: ClubSeasonTeamMetric | undefined,
): boolean {
  if (!a || !b) return true;
  if (a.coverage !== b.coverage) return true;
  if (a.isAvailable !== b.isAvailable) return true;
  return a.eligibleMatches !== b.eligibleMatches;
}

export function recordKindLabel(kind: H2HRecordKind, aName: string, bName: string): string {
  switch (kind) {
    case 'biggest-win-a': return `Biggest win — ${aName}`;
    case 'biggest-win-b': return `Biggest win — ${bName}`;
    case 'closest-game': return 'Closest game (excluding draws)';
    case 'highest-score-a': return `Highest score — ${aName}`;
    case 'highest-score-b': return `Highest score — ${bName}`;
    case 'lowest-score-a': return `Lowest score — ${aName}`;
    case 'lowest-score-b': return `Lowest score — ${bName}`;
    case 'highest-combined-score': return 'Highest combined score';
  }
}

/** The unit the record's `value` is measured in. */
export function recordKindUnit(kind: H2HRecordKind): string {
  switch (kind) {
    case 'biggest-win-a':
    case 'biggest-win-b':
    case 'closest-game':
      return 'Margin';
    default:
      return 'Points';
  }
}

export function periodRecordLabel(
  kind: H2HPeriodRecordKind,
  aName: string,
  bName: string,
): string {
  const who = kind.endsWith('-a') ? aName : bName;
  if (kind.startsWith('biggest-quarter-time-lead')) return `Biggest quarter-time lead — ${who}`;
  if (kind.startsWith('biggest-half-time-lead')) return `Biggest half-time lead — ${who}`;
  if (kind.startsWith('biggest-three-quarter-time-lead')) {
    return `Biggest three-quarter-time lead — ${who}`;
  }
  if (kind.startsWith('biggest-comeback-from-quarter-time')) {
    return `Biggest comeback from quarter time — ${who}`;
  }
  if (kind.startsWith('biggest-comeback-from-half-time')) {
    return `Biggest comeback from half time — ${who}`;
  }
  if (kind.startsWith('biggest-comeback-from-three-quarter-time')) {
    return `Biggest comeback from three-quarter time — ${who}`;
  }
  return `Largest turnaround between consecutive breaks — ${who}`;
}

export function turnaroundSegmentLabel(segment: H2HTurnaroundSegment | null): string | null {
  switch (segment) {
    case 'quarter-time-to-half-time': return 'Quarter time to half time';
    case 'half-time-to-three-quarter-time': return 'Half time to three-quarter time';
    case 'three-quarter-time-to-full-time': return 'Three-quarter time to full time';
    default: return null;
  }
}

export function decadeLabel(decade: number): string {
  return `${decade}s`;
}

/**
 * The scope sentence for an era-aware section (Club Rivalry Explorer
 * follow-up, FR-2): all-time by default, or narrowed to one decade of the
 * rivalry when the reader has chosen an era chip. `era` is always one of
 * the pair's own decades by the time this is called -- the state layer
 * has already rejected anything else.
 */
export function eraScopeSentence(era: number | null): string {
  if (era === null) return 'All-time, over every meeting of the two clubs.';
  return `The ${decadeLabel(era)} only, over meetings from that decade of the rivalry.`;
}

/** ` (2000s)`, or nothing for all time -- a caption suffix, not a sentence. */
export function eraCaptionSuffix(era: number | null): string {
  return era === null ? '' : ` (${decadeLabel(era)})`;
}

export function outcomeLabel(outcome: H2HOutcome, aName: string, bName: string): string {
  if (outcome === 'a-win') return aName;
  if (outcome === 'b-win') return bName;
  return 'Draw';
}

/**
 * V1 records the FIRST representation only. It does not know that a
 * player was traded, transferred or moved directly, so the wording never
 * says so.
 */
export function crossoverDirectionLabel(
  direction: CrossoverDirection,
  aName: string,
  bName: string,
): string {
  if (direction === 'a-to-b') return `${aName} first`;
  if (direction === 'b-to-a') return `${bName} first`;
  return 'Order not recorded';
}

/** `Recorded H2H Brownlow votes from X of Y eligible meetings.` */
export function h2hBrownlowCoverageSentence(covered: number, eligible: number): string {
  return `Recorded H2H Brownlow votes from ${covered.toLocaleString('en-AU')} of `
    + `${eligible.toLocaleString('en-AU')} eligible meetings.`;
}

/** `Period-score data available for X of Y rivalry meetings.` */
export function periodCoverageSentence(usable: number, meetings: number): string {
  return `Period-score data available for ${usable.toLocaleString('en-AU')} of `
    + `${meetings.toLocaleString('en-AU')} rivalry meetings.`;
}

export function didNotCompeteMessage(season: number): string {
  return `Did not compete in ${season}`;
}
