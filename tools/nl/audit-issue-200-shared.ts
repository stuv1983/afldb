/**
 * AFLDB-ISSUE-200 -- constants and small pure helpers shared between
 * audit-issue-200-extract.ts and audit-issue-200-cluster.ts.
 *
 * Kept in one place so the two scripts' invariants (the exact soft-class
 * counts from the parser-v50 baseline, the closed disposition vocabulary,
 * the audit CSV's column order) cannot drift out of sync -- both import the
 * same values rather than each hardcoding its own copy. See AFLDB-ISSUE-200.md
 * for the full runbook this tooling implements.
 */
import type { StressFinding, StressFindingClass } from './corpus';

// ---------------------------------------------------------- target classes

/**
 * The three ISSUE-200 soft classes. scoreRow (tools/nl/corpus.ts) fires
 * each in its own early-return branch, so every row carries at most one --
 * see AFLDB-ISSUE-200.md S1's mutual-exclusivity proof. selectTargetFinding
 * below re-verifies this per row rather than trusting it silently.
 */
export const TARGET_CLASSES = ['GRAIN_EQUIVALENT', 'UNEXPECTED_DECLINE', 'WRONG_FAILURE_REASON'] as const;
export type TargetClass = (typeof TARGET_CLASSES)[number];

export function isTargetClass(cls: string): cls is TargetClass {
  return (TARGET_CLASSES as readonly string[]).includes(cls);
}

/** The parser-v50 baseline this issue audits (AFLDB-ISSUE-200.md S1, ISSUE-199 resolution evidence). */
export const EXPECTED_CLASS_COUNTS: Record<TargetClass, number> = {
  GRAIN_EQUIVALENT: 72,
  UNEXPECTED_DECLINE: 921,
  WRONG_FAILURE_REASON: 70,
};

export const EXPECTED_TOTAL = Object.values(EXPECTED_CLASS_COUNTS).reduce((sum, n) => sum + n, 0);

/**
 * Selects the one target-class finding a row contributes.
 *
 * Returns `{ kind: 'none' }` for a row that carries none of the three
 * (excluded from the audit, not an error), and `{ kind: 'multiple' }` for a
 * row that carries more than one -- which scoreRow's current branch
 * structure cannot produce, so this is the mechanical proof that the
 * mutual-exclusivity assumption still holds rather than an assertion taken
 * on faith.
 */
export type TargetSelection =
  | { kind: 'none' }
  | { kind: 'one'; class: TargetClass; finding: StressFinding }
  | { kind: 'multiple'; classes: StressFindingClass[] };

export function selectTargetFinding(findings: readonly StressFinding[]): TargetSelection {
  const matches = findings.filter((f) => isTargetClass(f.class));
  if (matches.length === 0) return { kind: 'none' };
  if (matches.length > 1) return { kind: 'multiple', classes: matches.map((f) => f.class) };
  return { kind: 'one', class: matches[0].class as TargetClass, finding: matches[0] };
}

// ------------------------------------------------------------ dispositions

/** The eight dispositions AFLDB-ISSUE-200.md S5 defines. Closed set: an unrecognised value is refused, never coerced. */
export const DISPOSITIONS = [
  'STALE_CORPUS_EXPECTATION',
  'PARSER_BUG',
  'PLANNER_VALIDATOR_BUG',
  'INTENTIONAL_CONSERVATIVE_DECLINE',
  'TAXONOMY_DRIFT',
  'GRAIN_EQUIVALENT_LEGITIMATE',
  'SCORER_HARNESS_ARTIFACT',
  'DUPLICATE_MANIFESTATION',
] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export function isDisposition(value: string): value is Disposition {
  return (DISPOSITIONS as readonly string[]).includes(value);
}

// ------------------------------------------------------------- audit rows

/**
 * Column order for the per-row audit CSV (AFLDB-ISSUE-200.md S4a). `cluster`
 * and `provisional_disposition` are written blank by the extractor and
 * filled in by audit-issue-200-cluster.ts's --apply-dispositions pass.
 */
export const AUDIT_COLUMNS = [
  'id', 'class', 'question', 'category', 'template',
  'expected_status', 'expected_grain', 'expected_mode', 'expected_metric', 'expected_metric_alternatives',
  'expected_aggregation', 'expected_top_n', 'expected_player', 'expected_club', 'expected_opponent',
  'expected_venue', 'expected_season_from', 'expected_season_to', 'expected_match_type',
  'expected_boundary_event', 'expected_conditions', 'expected_failure_reason', 'expected_min_confidence',
  'actual_status', 'actual_failure_reason', 'actual_confidence', 'actual_unsupported_terms',
  'actual_grain', 'actual_mode', 'actual_metric', 'actual_aggregation', 'actual_top_n',
  'actual_player', 'actual_club_for', 'actual_club_against', 'actual_venue',
  'actual_season_min', 'actual_season_max', 'actual_match_type', 'actual_career_conditions',
  'finding_expected', 'finding_actual', 'auto_cluster_key', 'cluster', 'provisional_disposition', 'notes',
] as const;
export type AuditColumn = (typeof AUDIT_COLUMNS)[number];
export type AuditRow = Record<AuditColumn, string>;

/** undefined/null -> '', everything else -> String(value). Never collapses 0 or false to blank. */
export function str(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}
