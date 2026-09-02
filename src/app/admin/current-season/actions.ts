'use server';

import { revalidatePath } from 'next/cache';

import {
  getCurrentSeasonReport,
  parseCurrentSeasonSources,
  runCurrentSeasonRefresh,
  validateCurrentSeasonYear,
  type CurrentSeasonReport,
  type CurrentSeasonRunResult,
} from '@/lib/external-afl/current-season-import';
import { getLatestSettleRun } from '@/db/queries/settle-runs';
import { readSettleRunStatus, type SettleRunStatus } from '@/lib/acquisition/settle-status';
import { SETTLE_UNIT, startSettleRun } from '@/lib/acquisition/settle-trigger';
import { audit, requireSuperAdmin } from '@/lib/auth/session';

export type CurrentSeasonAdminState = {
  error?: string;
  message?: string;
  result?: CurrentSeasonRunResult;
  report?: CurrentSeasonReport;
};

/** AFLDB-ISSUE-127 — what the on-demand settle panel renders. */
export type SettleRunAdminState = {
  outcome?: 'started' | 'already-running' | 'unavailable' | 'error' | 'status';
  message?: string;
  error?: string;
  status?: SettleRunStatus;
  /**
   * The batch id that was newest immediately BEFORE this start. The panel
   * compares it against the newest batch afterwards to tell this run's result
   * apart from the previous run's, which is the only correlation available
   * while the run's own batch row is still uncommitted.
   */
  batchIdAtStart?: string | null;
};

function parseYear(formData: FormData): number {
  return validateCurrentSeasonYear(Number(formData.get('year') ?? new Date().getFullYear()));
}

export async function runCurrentSeasonAdminAction(
  _previous: CurrentSeasonAdminState,
  formData: FormData,
): Promise<CurrentSeasonAdminState> {
  const admin = await requireSuperAdmin();
  const mode = String(formData.get('mode') ?? 'auto');

  try {
    const year = parseYear(formData);
    if (mode === 'report') {
      const report = await getCurrentSeasonReport(year);
      await audit('current_season.reported', { year }, { userId: admin.id, label: admin.email });
      return {
        message: `Loaded current-season staging report for ${year}.`,
        report,
      };
    }

    const sources = mode === 'auto'
      ? ['kali'] as const
      : parseCurrentSeasonSources(String(formData.get('source') ?? 'kali'));
    const apply = mode === 'auto' || formData.get('apply') === 'on';
    const insertMissingMatches = false;

    const result = await runCurrentSeasonRefresh({
      year,
      sources: [...sources],
      apply,
      insertMissingMatches,
    });
    const report = await getCurrentSeasonReport(year);

    await audit('current_season.refreshed', {
      year,
      mode,
      sources,
      apply,
      insertMissingMatches,
      observationsFetched: result.observationsFetched,
      sourceCounts: result.sourceCounts,
      independenceGroupCounts: result.independenceGroupCounts,
      completeObservations: result.completeObservations,
      observationsWithScores: result.observationsWithScores,
      observationsStaged: result.observationsStaged,
      observationVersionsInserted: result.observationVersionsInserted,
      observationsMarkedAbsent: result.observationsMarkedAbsent,
      canonicalMatchesResolved: result.canonicalMatchesResolved,
      canonicalRowsInserted: result.canonicalRowsInserted,
      canonicalRowsUpdated: result.canonicalRowsUpdated,
      unresolvedObservations: result.unresolvedObservations,
      incompleteSourceRecords: result.incompleteSourceRecords,
      rejectedOrConflicted: result.rejectedOrConflicted,
      sourceDisagreements: result.sourceDisagreements,
      sameGroupConflicts: result.sameGroupConflicts,
    }, { userId: admin.id, label: admin.email });

    revalidatePath('/admin/current-season');

    return {
      message: result.applied
        ? `Refreshed ${year} fallback evidence: staged ${result.observationsStaged} observations and resolved ${result.canonicalMatchesResolved} local matches for diagnostics. Canonical current-season rows were not changed.`
        : `Dry run for ${year}: fetched ${result.observationsFetched} observations; nothing was written.`,
      result,
      report,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/* ------------------------------------------------------------------ *
 * AFLDB-ISSUE-127 — on-demand AFL Tables current-season refresh
 * ------------------------------------------------------------------ */

/**
 * Start one run of the approved AFLDB-ISSUE-122 chain, now.
 *
 * SUPER ADMIN ONLY, enforced here on the server. `requireSuperAdmin()` is the
 * first statement and redirects a plain admin, a contributor and an
 * unauthenticated visitor before anything else happens — the disabled button
 * in the UI is a courtesy, never the control.
 *
 * NO ARGUMENTS — structurally, not by convention. This action takes none, so
 * there is no season, label, path, source, force or bypass value to validate
 * and no `FormData` for a crafted field to ride in on. It is called directly
 * from the panel rather than bound to a form for exactly that reason. Every
 * argument the host boundary passes is a module constant in
 * `settle-trigger.ts`.
 *
 * NOT SYNCHRONOUS. `startSettleRun()` returns once systemd has queued the
 * job. A season backfill took about an hour (`AFLDB-ISSUE-123`); no HTTP
 * request is held open for it. The panel polls `refreshSettleRunStatusAction`
 * for the result.
 *
 * AUDIT. One `auth_audit_log` row per attempt, carrying the actor, the unit,
 * the outcome and the pre-start batch id. It is written AFTER the boundary
 * returns, so it records what actually happened rather than an intent; it
 * cannot be transactional with a systemd job, and a failure to write it is
 * deliberately not swallowed.
 */
export async function startSettleRunAction(): Promise<SettleRunAdminState> {
  const admin = await requireSuperAdmin();

  // Captured before the start so the panel can tell this run's batch from the
  // previous one. Just the batch id, not the whole status: the unit state is
  // read again below and once by the boundary itself. A failed read is not a
  // reason to refuse to start.
  let batchIdAtStart: string | null = null;
  try {
    batchIdAtStart = (await getLatestSettleRun())?.batchId ?? null;
  } catch {
    batchIdAtStart = null;
  }

  const started = await startSettleRun();

  await audit('current_season.settle_triggered', {
    unit: SETTLE_UNIT,
    outcome: started.outcome,
    batchIdAtStart,
  }, { userId: admin.id, label: admin.email });

  const status = await readSettleRunStatus();

  switch (started.outcome) {
    case 'started':
      return {
        outcome: 'started',
        batchIdAtStart,
        status,
        message:
          `Started ${SETTLE_UNIT}. AFL Tables is being acquired, adjudicated and settled by `
          + `the same pipeline the nightly timer runs. Refresh the status below for the `
          + `result; a full pass can take a while.`,
      };
    case 'already-running':
      return {
        outcome: 'already-running',
        batchIdAtStart,
        status,
        message:
          `A settle run is already in progress (${started.unit.activeState}). Nothing was `
          + `started — systemd runs this unit once at a time, so a scheduled run and a `
          + `manual one can never overlap.`,
      };
    case 'unavailable':
      return { outcome: 'unavailable', batchIdAtStart, status, error: started.reason };
    default:
      return { outcome: 'error', batchIdAtStart, status, error: started.reason };
  }
}

/**
 * Re-read the settle status. Read-only, Super Admin only, takes no arguments
 * and writes no audit row — it is a refresh, not an action.
 *
 * It deliberately does not return `batchIdAtStart`: that correlation belongs
 * to the start the panel performed and is kept by the panel, so a refresh
 * cannot be used to assert one.
 */
export async function refreshSettleRunStatusAction(): Promise<SettleRunAdminState> {
  await requireSuperAdmin();
  return { outcome: 'status', status: await readSettleRunStatus() };
}
