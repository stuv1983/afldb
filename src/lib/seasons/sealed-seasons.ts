import 'server-only';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sealedSeasonsFrom, type SealedSeasons, type SeasonRegistry } from '@afldb/domain';

/**
 * The season registry and the sealed range for SERVER callers (AFLDB V2 Stage 5, plan D9;
 * V2-GAP-021 / R-029).
 *
 * The sealed range is the V2 season seal's input (`evaluateSeasonWrite`): a season from
 * `first_season` to the last season that is not in progress is sealed historical data, and a write
 * to it needs an audited correction. The settle CLIs build it with `loadSealedSeasonsFor` in
 * tools/current-season/settle-season-seal.ts, which a CLI can import but a Next server module
 * cannot (and which stays unchanged); this is the `src/` counterpart, with the same source file
 * (`data/reference/seasons.json`) and the same builder (`sealedSeasonsFrom`, `@afldb/domain`).
 *
 * FAIL CLOSED. An unreadable or malformed registry THROWS {@link SeasonRegistryError}; it never
 * degrades to "nothing is sealed". A caller that cannot read the seal must refuse the write it was
 * about to make (the operations centre maps this to the typed code `season_registry_unavailable`).
 *
 * The file is read on every call (a few hundred bytes): the registry changes at a season rollover,
 * and a stale in-process copy would let a freshly sealed season look open. `projectRoot` defaults
 * to `process.cwd()`, the repository root under `next start` (the same convention as
 * src/db/queries/admin-draft.ts).
 */

/** Path segments of the registry, relative to the project root. */
export const SEASON_REGISTRY_SEGMENTS = ['data', 'reference', 'seasons.json'] as const;

/** The registry could not be read or is not a valid season registry. Callers must refuse. */
export class SeasonRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeasonRegistryError';
  }
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/**
 * Read and validate `data/reference/seasons.json`, returning the subset the seal reads
 * (`first_season`, `last_season`, `in_progress_seasons`). Throws {@link SeasonRegistryError}.
 */
export function loadSeasonRegistry(projectRoot: string = process.cwd()): SeasonRegistry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(projectRoot, ...SEASON_REGISTRY_SEGMENTS), 'utf8'));
  } catch (error) {
    throw new SeasonRegistryError(
      `The season registry (${SEASON_REGISTRY_SEGMENTS.join('/')}) could not be read: ${
        error instanceof Error ? error.message.split('\n')[0] : 'unknown error'
      }`,
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SeasonRegistryError('The season registry is not a JSON object.');
  }
  const record = parsed as Record<string, unknown>;
  const inProgress = record.in_progress_seasons;
  if (!isInteger(record.first_season) || !isInteger(record.last_season)) {
    throw new SeasonRegistryError('The season registry needs integer first_season and last_season.');
  }
  if (!Array.isArray(inProgress) || !inProgress.every(isInteger)) {
    throw new SeasonRegistryError('The season registry needs in_progress_seasons as a list of integers.');
  }
  const registry: SeasonRegistry = {
    first_season: record.first_season,
    last_season: record.last_season,
    in_progress_seasons: [...inProgress],
  };
  // A registry that defines no sealed range (first > last, or every season in progress) is unusable
  // by every caller, so it is refused here once rather than by each of them.
  sealedRangeOrThrow(registry);
  return registry;
}

function sealedRangeOrThrow(registry: SeasonRegistry): SealedSeasons {
  try {
    return sealedSeasonsFrom(registry);
  } catch (error) {
    throw new SeasonRegistryError(
      `The season registry does not define a sealed range: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
}

/** The sealed range of the registry under `projectRoot`. Throws {@link SeasonRegistryError}. */
export function loadSealedSeasons(projectRoot: string = process.cwd()): SealedSeasons {
  return sealedRangeOrThrow(loadSeasonRegistry(projectRoot));
}
