/**
 * Pure classification for comparing two PlayerProfiles.
 *
 * No database import, same spirit as lib/format.ts: this only decides
 * which stats are honestly comparable, never how they're formatted or
 * fetched. Narrower than sports_data_lab's generic `stats: list[str]`
 * on purpose -- PlayerProfile is a fixed shape with exactly seven
 * nullable career stats (one per *_recorded_games column on
 * player_career_stats), so there is no schema to introspect.
 */
import type { PlayerProfile } from '@/db/queries/players';

/** Every era-limited career stat PlayerProfile carries, in display order. */
export const ERA_LIMITED_STATS = [
  'behinds',
  'kicks',
  'handballs',
  'disposals',
  'marks',
  'tackles',
  'hitouts',
] as const;

export type EraLimitedStat = (typeof ERA_LIMITED_STATS)[number];

/** Stats both players have at least one recorded value for -- a fair comparison. */
export function comparableStats(a: PlayerProfile, b: PlayerProfile): EraLimitedStat[] {
  return ERA_LIMITED_STATS.filter((stat) => a[stat] !== null && b[stat] !== null);
}

export type EraGap = { stat: EraLimitedStat; have: 'a' | 'b' };

/**
 * Stats only one player could have recorded -- a fact about the eras they
 * played in, not a comparison. A stat neither player has is not a gap
 * between them; it is simply absent from `comparableStats` too.
 */
export function eraGaps(a: PlayerProfile, b: PlayerProfile): EraGap[] {
  const gaps: EraGap[] = [];
  for (const stat of ERA_LIMITED_STATS) {
    const inA = a[stat] !== null;
    const inB = b[stat] !== null;
    if (inA !== inB) gaps.push({ stat, have: inA ? 'a' : 'b' });
  }
  return gaps;
}
