import { formatNumber } from '@/lib/format';

/**
 * The one-line summary shown next to the Coaching Career heading while it
 * is collapsed -- enough for a reader to know whether opening it is worth
 * it, without a hard-coded example number in sight.
 */
export function coachingCareerSummary(totals: { games: number; premierships: number }): string {
  const games = `${formatNumber(totals.games)} game${totals.games === 1 ? '' : 's'}`;
  if (totals.premierships === 0) return games;
  return `${games} · ${totals.premierships} premiership${totals.premierships === 1 ? '' : 's'}`;
}
