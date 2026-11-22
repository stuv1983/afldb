import {
  isPlausibleSeason,
  isRevalidatablePlayerPath,
  MAX_REVALIDATE_PLAYER_PATHS,
  readRevalidateConfig,
  revalidateSeason,
  type RevalidateConfig,
  type RevalidateOutcome,
} from '@/lib/acquisition/season-revalidation';

/**
 * AFLDB-ISSUE-372 option B: the season refresh at award publication.
 *
 * `/admin/awards/revalidate` (the follow-up every awards and Coleman mutation
 * posts once it has committed) calls `revalidatePath` for its allowlisted
 * paths, but only in the worker that answered it. An award publication changes
 * its season's page (`/seasons/<y>`, ISR, `revalidate = 3600`), so every OTHER
 * worker kept serving the season page without the new award until its own
 * window lapsed (measured: `docs/v2/evidence/issue372-20261121/QUALIFICATION-20261122.md`).
 *
 * This posts the existing cross-worker season fan-out
 * (`/api/internal/revalidate-season`, AFLDB-ISSUE-134), which expires
 * `/seasons/<y>` and `/brownlow/<y>` on every worker. The award-season page
 * itself needs nothing: `/awards/[slug]/[season]` has no `generateStaticParams`,
 * so Next renders it dynamically and never caches it (no cached 404 can exist).
 *
 * Bounded and best-effort, exactly like the Brownlow action's `fanOutSeason`:
 * - the seasons come only from `/seasons/<yyyy>` and `/awards/<slug>/<yyyy>`
 *   paths the allowlist already admitted, and only plausible years
 *   (`isPlausibleSeason`), deduplicated in first-seen order;
 * - at most `MAX_AWARD_FANOUT_SEASONS` fan-outs per request (a mutation names
 *   one season, a correction at most two); any further season keeps the
 *   acting-worker refresh and its ISR window;
 * - never throws: the mutation is committed before this runs, and a host with
 *   no `AFLDB_REVALIDATE_URL`/`SECRET` keeps the acting-worker behaviour.
 *
 * AFLDB-ISSUE-376: a winner replacement also changes the removed and the added
 * winner's profiles (`/players/[slug]`, ISR, a copy per worker), so the admitted
 * `/players/<slug>-<id>` paths (bounded, canonical shape only) ride with the first
 * season's fan-out and are expired on every worker too. A correction naming a
 * player but no season keeps the acting-worker refresh (the fan-out is
 * season-keyed).
 *
 * Route handler only, never a Server Action (the ISSUE-156 R-7 hang rule).
 */

export const MAX_AWARD_FANOUT_SEASONS = 3;

const SEASON_NAMING_PATH = /^\/(?:seasons|awards\/[a-z0-9-]+)\/(\d{4})$/;

/** The distinct plausible seasons named by season or award-season paths, capped. */
export function awardSeasonsToFanOut(paths: readonly unknown[]): number[] {
  const seasons: number[] = [];
  for (const path of paths) {
    if (typeof path !== 'string') continue;
    const match = SEASON_NAMING_PATH.exec(path);
    if (!match) continue;
    const season = Number(match[1]);
    if (!isPlausibleSeason(season) || seasons.includes(season)) continue;
    seasons.push(season);
    if (seasons.length === MAX_AWARD_FANOUT_SEASONS) break;
  }
  return seasons;
}

/**
 * AFLDB-ISSUE-376: the distinct canonical player-profile paths among the
 * admitted paths, deduplicated, in first-seen order, capped at
 * `MAX_REVALIDATE_PLAYER_PATHS`. A winner replacement names the removed and the
 * added winner (`replacementPaths`), and `/players/[slug]` is ISR with a copy per
 * worker; shapes are the route's own (`isRevalidatablePlayerPath`), so anything
 * the internal route would refuse is dropped here rather than failing the post.
 */
export function awardPlayerPathsToFanOut(paths: readonly unknown[]): string[] {
  const players: string[] = [];
  for (const path of paths) {
    if (!isRevalidatablePlayerPath(path) || players.includes(path)) continue;
    players.push(path);
    if (players.length === MAX_REVALIDATE_PLAYER_PATHS) break;
  }
  return players;
}

export type AwardFanOutDeps = {
  env?: Record<string, string | undefined>;
  revalidate?: (
    config: RevalidateConfig, season: number, playerPaths?: readonly string[],
  ) => Promise<RevalidateOutcome>;
  logError?: (message: string, detail: unknown) => void;
};

/**
 * Fan out the seasons named by the `revalidated` list of an
 * `applyRevalidateRequest` reply. Returns the seasons attempted (for tests and
 * logs); never throws.
 */
export async function fanOutAwardSeasons(
  revalidated: readonly unknown[],
  deps: AwardFanOutDeps = {},
): Promise<number[]> {
  const logError = deps.logError ?? ((message, detail) => console.error(message, detail));
  const seasons = awardSeasonsToFanOut(revalidated);
  if (seasons.length === 0) return [];
  let config: RevalidateConfig | null;
  try {
    config = readRevalidateConfig(deps.env ?? process.env);
  } catch (error) {
    logError('[admin-awards] award-season fan-out misconfigured', error);
    return [];
  }
  if (!config) return [];
  // `revalidateSeason`'s third parameter is its transport, so the player paths
  // (this dependency's third) are passed as its fourth.
  const revalidate = deps.revalidate
    ?? ((cfg: RevalidateConfig, season: number, playerPaths?: readonly string[]) => (
      revalidateSeason(cfg, season, undefined, playerPaths)
    ));
  // The player paths ride with the FIRST season's fan-out only: that request
  // already reaches every worker, and repeating them per season would be
  // redundant cluster-wide work.
  let playerPaths = awardPlayerPathsToFanOut(revalidated);
  for (const season of seasons) {
    try {
      const outcome = playerPaths.length > 0
        ? await revalidate(config, season, playerPaths)
        : await revalidate(config, season);
      // Cleared only once every worker acknowledged: an incomplete fan-out
      // retries the player paths with the next season.
      if (outcome.ok) playerPaths = [];
      if (!outcome.ok) logError('[admin-awards] award-season fan-out incomplete', outcome.failures);
    } catch (error) {
      logError('[admin-awards] award-season fan-out failed', error);
    }
  }
  return seasons;
}

/** Read the `revalidated` list from an `applyRevalidateRequest` response without consuming it. */
export async function revalidatedPathsOf(response: Response): Promise<unknown[]> {
  try {
    const body = await response.clone().json() as { revalidated?: unknown };
    return Array.isArray(body.revalidated) ? body.revalidated : [];
  } catch {
    return [];
  }
}
