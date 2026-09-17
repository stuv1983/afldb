/**
 * AFLDB-ISSUE-155 Phase C2 — operator-facing labels for the Brownlow admin UI.
 *
 * Pure and free of `server-only`: the season list (a Server Component), the
 * match editor (a Client Component) and the action-state tests all read the
 * same words from here, so a state can never be described one way in a table
 * and another way on a card. The backend vocabulary
 * (`src/lib/brownlow/entry.ts`) stays authoritative for behaviour; this file
 * only decides how each state reads on screen.
 */

import type {
  BrownlowEntryStatus,
  BrownlowSeasonAuthority,
  BrownlowSeasonStatus,
  MatchAssignment,
} from '@/lib/brownlow/entry';

/** A visual weight for a badge, mapped to the existing `.badge` classes. */
export type LabelTone = 'ok' | 'warn' | 'info' | 'muted';

export const SEASON_STATUS_LABEL: Record<BrownlowSeasonStatus, string> = {
  not_polled: 'No medal awarded',
  not_started: 'Not started',
  in_progress: 'In progress',
  entered: 'Entered — ready to publish',
  published: 'Published',
  published_stale: 'Published — needs re-publish',
  source_published: 'Source published',
};

export const SEASON_STATUS_TONE: Record<BrownlowSeasonStatus, LabelTone> = {
  not_polled: 'muted',
  not_started: 'muted',
  in_progress: 'info',
  entered: 'info',
  published: 'ok',
  published_stale: 'warn',
  source_published: 'info',
};

export const SEASON_AUTHORITY_LABEL: Record<BrownlowSeasonAuthority, string> = {
  none: 'No published total yet',
  source: 'Source-authoritative',
  manual: 'Manually published',
};

/**
 * How a single match reads, from its workflow status and the shape of the
 * canonical facts that already exist for it (§27.7).
 *
 *   - a workflow row wins: `draft` / `final` / `void` are shown as-is;
 *   - with no workflow row, a complete 3/2/1 in the source facts is
 *     `imported` (already public), a positive-but-incomplete set is
 *     `imported_partial`, and nothing at all is `no_decision`.
 */
export type MatchDisplayState =
  | 'no_decision'
  | 'draft'
  | 'final'
  | 'void'
  | 'imported'
  | 'imported_partial';

export function matchDisplayState(
  status: BrownlowEntryStatus | null,
  assignment: MatchAssignment,
): MatchDisplayState {
  if (status) return status;
  if (assignment === 'complete') return 'imported';
  if (assignment === 'partial') return 'imported_partial';
  return 'no_decision';
}

export const MATCH_STATE_LABEL: Record<MatchDisplayState, string> = {
  no_decision: 'No decision',
  draft: 'Draft',
  final: 'Final',
  void: 'Void — no votes awarded',
  imported: 'Source votes',
  imported_partial: 'Source votes (incomplete)',
};

export const MATCH_STATE_TONE: Record<MatchDisplayState, LabelTone> = {
  no_decision: 'muted',
  draft: 'info',
  final: 'ok',
  void: 'muted',
  imported: 'info',
  imported_partial: 'warn',
};

/** The `.badge` variant for a tone. `ok` uses the plain badge (green-ish accent). */
export function badgeClass(tone: LabelTone): string {
  return tone === 'warn' ? 'badge badge-warn' : 'badge';
}

/**
 * The count of home-and-away matches still without a finalise/void/complete
 * source decision, from a season summary's own fields (§27.9 `complete`).
 */
export function incompleteMatchCount(summary: {
  expected: number;
  final: number;
  voided: number;
  imported: number;
}): number {
  return Math.max(0, summary.expected - summary.final - summary.voided - summary.imported);
}
