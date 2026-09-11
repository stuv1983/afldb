import type { FixtureRoundType, PlayedState } from '@/db/queries/admin-fixtures';

/**
 * Shared display strings for the fixture admin surface (AFLDB-ISSUE-162
 * Stage 2). Pure and presentation-only — the backend never renders a label,
 * only the enum/code values §9 defines.
 */

export const ROUND_TYPE_LABELS: Record<FixtureRoundType, string> = {
  home_and_away: 'Home and away',
  wildcard_final: 'Wildcard Final',
  elimination_final: 'Elimination Final',
  qualifying_final: 'Qualifying Final',
  semi_final: 'Semi Final',
  preliminary_final: 'Preliminary Final',
  grand_final: 'Grand Final',
};

/** One round's heading, from what a fixture row already carries. */
export function roundHeading(input: { roundType: FixtureRoundType; roundNumber: number | null }): string {
  if (input.roundType === 'home_and_away') return `Round ${input.roundNumber ?? '?'}`;
  return ROUND_TYPE_LABELS[input.roundType];
}

export const PLAYED_STATE_LABELS: Record<PlayedState, string> = {
  unplayed: 'Unplayed',
  played: 'Played',
  played_home_away_differs: 'Played (home/away reversed)',
  ambiguous: 'Ambiguous — unlinked',
};

export const FIXTURE_STATUS_LABELS = {
  scheduled: 'Scheduled',
  cancelled: 'Cancelled',
  void: 'Void',
} as const;
