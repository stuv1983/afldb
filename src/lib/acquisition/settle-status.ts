/**
 * AFLDB-ISSUE-127 — the one bounded status view of the settle pipeline.
 *
 * Two independent facts, reported separately because they ARE separate and
 * conflating them would mislead:
 *
 *  1. **The unit** — what `afldb-settle-afltables.service` is doing right
 *     now, from systemd. This is the only thing that knows a run is in
 *     flight.
 *  2. **The latest run** — the newest `import_batches` row the settle wrote,
 *     with its counters. This is the only thing that knows what a run DID.
 *
 * They cannot be merged, because the settle's batch row is written inside the
 * run's transaction and is invisible until it commits. While a run is going
 * the database still shows the PREVIOUS run. Presenting the previous run's
 * counters as "the current run's result" would be a lie; the panel therefore
 * labels them separately and the caller compares batch ids (§8).
 *
 * Read-only and side-effect free.
 */
import 'server-only';

import {
  getLatestSettleRun, SETTLE_BATCH_TOOLS, type SettleRunRecord,
} from '@/db/queries/settle-runs';

import {
  readUnitState,
  readUnitStateOf,
  settleTriggerConfigured,
  type SettleUnitKey,
  type SettleUnitState,
} from './settle-trigger';

export type SettleRunStatus = {
  /** Whether this host is provisioned for the on-demand trigger at all. */
  configured: boolean;
  /** Why the unit could not be read, when it could not. Safe, bounded text. */
  unitError: string | null;
  unit: SettleUnitState | null;
  latestRun: SettleRunRecord | null;
  /** Why the batch read failed, when it did. */
  latestRunError: string | null;
};

/**
 * Compose the status.
 *
 * Neither half is allowed to take the other down: a host with no systemd
 * still shows the last run's counters, and a database that refuses the read
 * still shows that a run is in flight. Each failure is reported in its own
 * field rather than thrown, because this is a diagnostic surface and a blank
 * page is the least useful possible answer.
 */
export async function readSettleRunStatus(): Promise<SettleRunStatus> {
  const configured = settleTriggerConfigured();

  let unit: SettleUnitState | null = null;
  let unitError: string | null = null;
  const state = await readUnitState();
  if ('available' in state) unitError = state.reason;
  else unit = state;

  let latestRun: SettleRunRecord | null = null;
  let latestRunError: string | null = null;
  try {
    latestRun = await getLatestSettleRun();
  } catch (error) {
    latestRunError = error instanceof Error ? error.message : String(error);
  }

  return { configured, unitError, unit, latestRun, latestRunError };
}

/** One row of the S8/§17 unit-status table below. */
export type SettleUnitStatus = {
  unit: SettleUnitState | null;
  unitError: string | null;
  latestRun: SettleRunRecord | null;
  latestRunError: string | null;
};

/**
 * AFLDB-ISSUE-228 S8 (§17): "`settle-status.ts` gains a unit table
 * `{afltables, afl_api, afl_api_brownlow}`". Same shape and the same
 * neither-half-takes-the-other-down composition as `readSettleRunStatus()`
 * above, generalised over the three `SettleUnitKey`s; `configured` stays one
 * flag because all three units are read through the same
 * `AFLDB_SETTLE_TRIGGER=systemd` gate. `getLatestSettleRun()`'s `counters`
 * are `null` for `afl_api`/`afl_api_brownlow` (see that function's doc
 * comment) — this table reports run identity/status, not yet the full
 * counter breakdown, for the two new units.
 *
 * Wiring this into the rendered `/admin/current-season` panel is a disclosed
 * follow-up, not done in this pass (CLAUDE.md: no untested UI change under an
 * inspect/edit-only session).
 */
export async function readSettleUnitTableStatus(): Promise<Record<SettleUnitKey, SettleUnitStatus>> {
  const configured = settleTriggerConfigured();

  const keys: readonly SettleUnitKey[] = ['afltables', 'afl_api', 'afl_api_brownlow'];
  const rows = await Promise.all(keys.map(async (key): Promise<[SettleUnitKey, SettleUnitStatus]> => {
    let unit: SettleUnitState | null = null;
    let unitError: string | null = null;
    if (configured) {
      const state = await readUnitStateOf(key);
      if ('available' in state) unitError = state.reason;
      else unit = state;
    } else {
      unitError = 'On-demand refresh is not enabled on this host.';
    }

    let latestRun: SettleRunRecord | null = null;
    let latestRunError: string | null = null;
    try {
      latestRun = await getLatestSettleRun(SETTLE_BATCH_TOOLS[key]);
    } catch (error) {
      latestRunError = error instanceof Error ? error.message : String(error);
    }

    return [key, { unit, unitError, latestRun, latestRunError }];
  }));

  return Object.fromEntries(rows) as Record<SettleUnitKey, SettleUnitStatus>;
}
