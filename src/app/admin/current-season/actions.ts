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
import { isAflApiBrownlowEnabled } from '@/lib/acquisition/afl-api-brownlow';
import {
  combineAflApiBrownlowGates,
  type AflApiBrownlowEffectiveState,
} from '@/lib/acquisition/afl-api-ingestion-control';
import { readSettleRunStatus, type SettleRunStatus } from '@/lib/acquisition/settle-status';
import { SETTLE_UNIT, startSettleRun } from '@/lib/acquisition/settle-trigger';
import { authSql } from '@/db/authClient';
import { audit, requireCapability } from '@/lib/auth/session';
import { SETTING_KEYS } from '@/lib/site-settings';

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
  const admin = await requireCapability('acquisition.currentSeason');
  const mode = String(formData.get('mode') ?? 'report');

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

    // AFLDB-ISSUE-128. The legacy `auto` mode is GONE. It meant "refresh Kali
    // and persist", which is the shape of the pre-ISSUE-122 automatic writer
    // and was the last thing on this page still calling a deprecated fallback
    // provider "automatic". Automatic current-season ingestion is the AFL
    // Tables settle chain and nothing else; a `mode=auto` post is now refused
    // rather than quietly reinterpreted, so an old bookmark or a stale client
    // cannot resurrect the behaviour by name.
    if (mode !== 'manual') {
      throw new Error(
        `Unknown current-season fallback mode '${mode}'. Automatic current-season ingestion `
        + 'is the AFL Tables settle chain, not a Squiggle/Kali refresh; the only fallback '
        + 'modes here are manual diagnostics and report.',
      );
    }
    const sources = parseCurrentSeasonSources(String(formData.get('source') ?? ''));
    const apply = formData.get('apply') === 'on';
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
        ? `Refreshed ${year} fallback evidence from ${sources.join(', ')}: staged ${result.observationsStaged} observations and resolved ${result.canonicalMatchesResolved} local matches for diagnostics. Canonical current-season rows were not changed; only the AFL Tables settle chain writes those.`
        : `Dry run for ${year} over ${sources.join(', ')}: fetched ${result.observationsFetched} observations; nothing was written.`,
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
 * SUPER ADMIN ONLY, enforced here on the server.
 * `requireCapability('acquisition.currentSeason')` -- a super-admin-only
 * capability, the same boundary requireSuperAdmin() drew before
 * AFLDB-ISSUE-158 -- is the first statement and redirects a plain admin, a
 * contributor and an unauthenticated visitor before anything else happens —
 * the disabled button in the UI is a courtesy, never the control.
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
  const admin = await requireCapability('acquisition.currentSeason');

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
  await requireCapability('acquisition.currentSeason');
  return { outcome: 'status', status: await readSettleRunStatus() };
}

/* ------------------------------------------------------------------ *
 * AFLDB-ISSUE-228 follow-up — super-admin AFL API ingestion switches.
 *
 * SUPER ADMIN ONLY (`requireCapability('acquisition.currentSeason')`, the
 * same boundary the settle controls above use — the capability table
 * (`src/lib/auth/capabilities.ts`) declares it SUPER_ADMIN_ONLY). Writes
 * through `authSql` exactly like `saveSiteSettings()`
 * (`/admin/settings/actions.ts`): one upsert, then one `auth_audit_log` row
 * via `audit()`, recording actor, action and old/new state. There is no
 * disabled-button-only control anywhere in this file: every acquire/settle
 * CLI in `tools/current-season/` reads the same `site_settings` row itself
 * (`src/lib/acquisition/afl-api-ingestion-control.ts`), so a direct CLI
 * invocation or a systemd timer is bound by the same switch this action
 * writes.
 * ------------------------------------------------------------------ */

export type IngestionControlsAdminState = {
  error?: string;
  message?: string;
};

export type AflApiIngestionAdminView = {
  currentSeasonEnabled: boolean;
  brownlow: AflApiBrownlowEffectiveState;
};

/** Read for the page's initial render and the panel's own refresh. */
export async function readAflApiIngestionAdminView(): Promise<AflApiIngestionAdminView> {
  await requireCapability('acquisition.currentSeason');
  const rows = await authSql<{ key: string; value: unknown }[]>`
    SELECT key, value FROM site_settings
     WHERE key IN (${SETTING_KEYS.aflApiCurrentSeasonEnabled}, ${SETTING_KEYS.aflApiBrownlowEnabled})
  `;
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const currentSeasonEnabled = byKey.get(SETTING_KEYS.aflApiCurrentSeasonEnabled) === true;
  const brownlowAdminEnabled = byKey.get(SETTING_KEYS.aflApiBrownlowEnabled) === true;
  return {
    currentSeasonEnabled,
    brownlow: combineAflApiBrownlowGates(isAflApiBrownlowEnabled(), brownlowAdminEnabled),
  };
}

async function writeIngestionSwitch(
  key: string, enabled: boolean, auditAction: string, actor: { id: number; email: string },
): Promise<void> {
  await authSql`
    INSERT INTO site_settings (key, value, updated_by)
    VALUES (${key}, ${JSON.stringify(enabled)}::jsonb, ${actor.id})
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
  `;
  await audit(auditAction, { enabled }, { userId: actor.id, label: actor.email });
}

/**
 * AFL API current-season ingestion (hard requirement E). No deployment-level
 * gate exists for this family — this switch is the whole of "enabled".
 */
export async function setAflApiCurrentSeasonIngestionAction(
  enabled: boolean,
): Promise<IngestionControlsAdminState> {
  const admin = await requireCapability('acquisition.currentSeason');
  await writeIngestionSwitch(
    SETTING_KEYS.aflApiCurrentSeasonEnabled, enabled, 'current_season.afl_api_ingestion_set', admin,
  );
  revalidatePath('/admin/current-season');
  return {
    message: enabled
      ? 'AFL API current-season ingestion enabled. The nightly timer and any on-demand CLI run will now acquire and settle.'
      : 'AFL API current-season ingestion disabled. Acquisition and settle both refuse before making a network request.',
  };
}

/**
 * Brownlow live ingestion admin control (hard requirement D). This is only
 * HALF the gate: `AFLDB_AFL_API_BROWNLOW_ENABLED` (deployment/environment)
 * is the other, and this action can never set or clear it. Enabling this
 * setting while the deployment gate is off changes nothing observable.
 */
export async function setAflApiBrownlowIngestionAction(
  enabled: boolean,
): Promise<IngestionControlsAdminState> {
  const admin = await requireCapability('acquisition.currentSeason');
  await writeIngestionSwitch(
    SETTING_KEYS.aflApiBrownlowEnabled, enabled, 'current_season.afl_api_brownlow_ingestion_set', admin,
  );
  revalidatePath('/admin/current-season');
  const gate = combineAflApiBrownlowGates(isAflApiBrownlowEnabled(), enabled);
  return {
    message: gate.effectiveEnabled
      ? 'Brownlow live ingestion admin control enabled, and the deployment gate is also enabled — '
        + 'acquisition and settle will now run.'
      : enabled
        ? 'Brownlow live ingestion admin control enabled, but the deployment gate '
          + '(AFLDB_AFL_API_BROWNLOW_ENABLED) is not — nothing changes until that is set on the host.'
        : 'Brownlow live ingestion admin control disabled. Acquisition and settle both refuse before '
          + 'making a network request, regardless of the deployment gate.',
  };
}
