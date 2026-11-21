import {
  isPlausibleSeason,
  readRevalidateConfig,
  revalidateSeason,
  type RevalidateConfig,
  type RevalidateOutcome,
} from '@/lib/acquisition/season-revalidation';

/**
 * AFLDB-ISSUE-372 option B: the award-season refresh at publication.
 *
 * `/admin/awards/revalidate` (the follow-up every awards and Coleman mutation
 * posts once it has committed) calls `revalidatePath` for its allowlisted
 * paths, but only in the worker that answered it. A first-published award
 * season (`/awards/<slug>/<season>`, `revalidate = 86400`) can then keep a
 * cached 404 on every OTHER worker, and Next's background regeneration of a
 * stale 404 persists a 200 body under the not-found `<head>` (`noindex`) for
 * up to 24 h (ISSUE-371 README §3, ISSUE-372).
 *
 * This posts the existing cross-worker season fan-out
 * (`/api/internal/revalidate-season`, AFLDB-ISSUE-134), which since ISSUE-372
 * also expires the `/awards/[slug]/[season]` route pattern on every worker.
 *
 * Bounded and best-effort, exactly like the Brownlow action's `fanOutSeason`:
 * - the seasons come only from paths the allowlist already admitted, and only
 *   plausible years (`isPlausibleSeason`), deduplicated in first-seen order;
 * - at most `MAX_AWARD_FANOUT_SEASONS` fan-outs per request. Nothing is lost by
 *   the cap for award pages: the pattern each fan-out expires covers every
 *   award season of every year, so ONE successful fan-out already reaches them
 *   all; the extra years only add their `/seasons/<y>` and `/brownlow/<y>`;
 * - never throws: the mutation is committed before this runs, and a host with
 *   no `AFLDB_REVALIDATE_URL`/`SECRET` keeps the acting-worker behaviour.
 *
 * Route handler only, never a Server Action (the ISSUE-156 R-7 hang rule).
 */

export const MAX_AWARD_FANOUT_SEASONS = 3;

const AWARD_SEASON_PATH = /^\/awards\/[a-z0-9-]+\/(\d{4})$/;

/** The distinct plausible seasons named by award-season paths, capped. */
export function awardSeasonsToFanOut(paths: readonly unknown[]): number[] {
  const seasons: number[] = [];
  for (const path of paths) {
    if (typeof path !== 'string') continue;
    const match = AWARD_SEASON_PATH.exec(path);
    if (!match) continue;
    const season = Number(match[1]);
    if (!isPlausibleSeason(season) || seasons.includes(season)) continue;
    seasons.push(season);
    if (seasons.length === MAX_AWARD_FANOUT_SEASONS) break;
  }
  return seasons;
}

export type AwardFanOutDeps = {
  env?: Record<string, string | undefined>;
  revalidate?: (config: RevalidateConfig, season: number) => Promise<RevalidateOutcome>;
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
  const revalidate = deps.revalidate ?? revalidateSeason;
  for (const season of seasons) {
    try {
      const outcome = await revalidate(config, season);
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
