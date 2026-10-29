/**
 * AFLDB V2 Stage 3 (V2-GAP-006) — the seal check shared by the three AFL API settle CLIs
 * (`settle-afl-api.ts`, `settle-afl-api-fixtures.ts`, `settle-afl-api-brownlow.ts`).
 *
 * The season of a settle comes from its snapshot manifest, never a flag. Once that is known and
 * BEFORE any database client is created, a writing mode against a sealed season is refused
 * (docs/v2/historical-baseline.md §1-§2). A settle is not an audited correction, so no
 * correction is ever passed. The sealed range is built from the FULL data/reference/seasons.json
 * under the CLI's own project root; a season outside first_season..last_season (a 2027 season or
 * a synthetic 2071/2099 fixture season) is not sealed and the canonical `season_not_in_progress`
 * gate (canonical-apply.ts) continues to apply to it.
 *
 * Offline: reads one JSON file, opens nothing else.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  SealedSeasonRefusal, assertSeasonWritable, sealedSeasonsFrom, type SealedSeasons, type SeasonRegistry,
} from '@afldb/domain';

export function loadSealedSeasonsFor(projectRoot: string): SealedSeasons {
  const registry = JSON.parse(
    readFileSync(join(projectRoot, 'data', 'reference', 'seasons.json'), 'utf8'),
  ) as SeasonRegistry;
  return sealedSeasonsFrom(registry);
}

/** Throws `SealedSeasonRefusal` when `season` is sealed. A settle carries no correction. */
export function refuseSealedSeasonForSettle(projectRoot: string, season: number): void {
  assertSeasonWritable({ season, sealed: loadSealedSeasonsFor(projectRoot), correction: null });
}

/** True when `season` is sealed under `projectRoot`'s registry (used for the logged backtest basis). */
export function isSettleSeasonSealed(projectRoot: string, season: number): boolean {
  try {
    refuseSealedSeasonForSettle(projectRoot, season);
    return false;
  } catch (error) {
    if (error instanceof SealedSeasonRefusal) return true;
    throw error;
  }
}
