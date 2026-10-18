/**
 * AFL API cutover — the application's view of the one switch for AFL Tables
 * network fetching, `data/reference/afltables-network.json`.
 *
 * The same file is read by `deploy/afldb-settle-afltables.sh`,
 * `tools/rebuild/fitzroy/acquire_core.R`,
 * `tools/rebuild/afltables/acquire_club_lists.R` and
 * `tools/rebuild/afltables/acquire_coaches.py`, each with the same rule (see
 * `parseAfltablesNetworkStatus`). Here it gates only the Super Admin on-demand
 * start in `settle-trigger.ts`: the application never fetches AFL Tables
 * itself. `tools/db/rollover-season.ts` writes the retirement.
 *
 * Imported statically, so the value is the one the build saw. A host that
 * pulls a flipped file without rebuilding still cannot fetch: the shell chain
 * the start would launch re-reads both files at run time and does nothing.
 */
import afltablesNetworkJson from '../../../data/reference/afltables-network.json';
import seasonsJson from '../../../data/reference/seasons.json';

/**
 * `out_of_bounds` is an active switch that meets an in-progress season later
 * than its `last_season` (or an unreadable register): the state a rollover to
 * the next season would create if the switch were left active. It refuses like
 * `retired`, but the shell reports it as a failure because it is a
 * misconfiguration, not a decision.
 */
export type AfltablesNetworkStatus = 'active' | 'retired' | 'out_of_bounds';

/**
 * `active` only when the switch says exactly `status: "active"` with an
 * integer `last_season`, AND every season in the in-progress register is at
 * or before it. A switch that is not active-and-bounded — no object, no
 * `status`, a misspelling, no `last_season` — is `retired`, the same fail-closed
 * reading the shell, R and Python gates apply.
 */
export function parseAfltablesNetworkStatus(raw: unknown, seasons: unknown): AfltablesNetworkStatus {
  if (raw === null || typeof raw !== 'object') return 'retired';
  const { status, last_season: lastSeason } = raw as { status?: unknown; last_season?: unknown };
  if (status !== 'active' || typeof lastSeason !== 'number' || !Number.isInteger(lastSeason)) return 'retired';
  const inProgress = seasons !== null && typeof seasons === 'object'
    ? (seasons as { in_progress_seasons?: unknown }).in_progress_seasons
    : undefined;
  const bounded = Array.isArray(inProgress)
    && inProgress.every((year) => typeof year === 'number' && Number.isInteger(year) && year <= lastSeason);
  return bounded ? 'active' : 'out_of_bounds';
}

export function afltablesNetworkStatus(): AfltablesNetworkStatus {
  return parseAfltablesNetworkStatus(afltablesNetworkJson, seasonsJson);
}

/** The operator sentence shown when the on-demand start is refused for this reason. */
export const AFLTABLES_NETWORK_RETIRED =
  'AFL Tables network acquisition is retired (data/reference/afltables-network.json). '
  + 'Nothing was started; game and Brownlow data come from the AFL API settle units.';

export const AFLTABLES_NETWORK_OUT_OF_BOUNDS =
  'AFL Tables network acquisition is refused: data/reference/seasons.json has an in-progress season '
  + 'later than last_season in data/reference/afltables-network.json. Nothing was started.';

/** The refusal sentence for a status that is not `active`, or null when AFL Tables may be fetched. */
export function afltablesNetworkRefusal(status: AfltablesNetworkStatus): string | null {
  if (status === 'active') return null;
  return status === 'retired' ? AFLTABLES_NETWORK_RETIRED : AFLTABLES_NETWORK_OUT_OF_BOUNDS;
}
