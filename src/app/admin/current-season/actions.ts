'use server';

import { revalidatePath } from 'next/cache';

import type { RetiredAdminRefusal } from '@afldb/domain';

import { isAflApiBrownlowEnabled } from '@/lib/acquisition/afl-api-brownlow';
import {
  combineAflApiBrownlowGates,
  type AflApiBrownlowEffectiveState,
} from '@/lib/acquisition/afl-api-ingestion-control';
import { readSettleRunStatus, type SettleRunStatus } from '@/lib/acquisition/settle-status';
import { authSql } from '@/db/authClient';
import { refuseRetiredAdminAction } from '@/lib/admin/retired-admin';
import { audit, requireCapability } from '@/lib/auth/session';
import { parseSiteSettings, SETTING_KEYS } from '@/lib/site-settings';

/**
 * The state a (retired) Squiggle/Kali control used to render. V2 Stage 5 retired the control;
 * the type stays so a stale `useActionState` client still type-checks against `error`.
 */
export type CurrentSeasonAdminState = {
  error?: string;
  message?: string;
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

/**
 * RETIRED (AFLDB V2 Stage 5, V2-GAP-013, legacy-disposition L6). The Squiggle / Kali refresh and
 * staged report were removed from the admin surface: Squiggle and Kali are retired sources
 * (AFLDB-ISSUE-122/128, plan D10). The existing guard stays the first statement, so who is
 * refused, and who is redirected away, is unchanged; an authorised caller gets the typed
 * refusal and one audit row. The importer library is NOT called: this module no longer imports
 * it, and tests/v2-module-boundaries.test.ts keeps it that way.
 *
 * It declares no parameters: a stale `useActionState` client still posts (previous state, form
 * data), which JavaScript ignores, so nothing the form carried can reach any code here.
 */
export async function runCurrentSeasonAdminAction(): Promise<CurrentSeasonAdminState | RetiredAdminRefusal> {
  const admin = await requireCapability('acquisition.currentSeason');
  return refuseRetiredAdminAction('admin.squiggle_kali_refresh', admin, 'runCurrentSeasonAdminAction');
}

/* ------------------------------------------------------------------ *
 * RETIRED (AFLDB V2 Stage 5, V2-GAP-013, legacy-disposition L5): the on-demand AFL Tables settle
 * trigger. The nightly AFL Tables settle still runs on the host behind AFLDB-ISSUE-316 until the
 * owner's decision D-316-2; V2 neither starts nor stops it, and this admin control no longer
 * starts it either.
 * ------------------------------------------------------------------ */

/**
 * Refuse the retired AFL Tables settle trigger.
 *
 * SUPER ADMIN ONLY, enforced here on the server: `requireCapability('acquisition.currentSeason')`
 * is the first statement and redirects a plain admin, a contributor and an unauthenticated
 * visitor exactly as before. It still takes no arguments, so there is nothing for a crafted
 * request to carry. An authorised caller gets the typed refusal and one audit row; the systemd
 * boundary (`startSettleRun`) is not imported by this module and is never called.
 */
export async function startSettleRunAction(): Promise<SettleRunAdminState | RetiredAdminRefusal> {
  const admin = await requireCapability('acquisition.currentSeason');
  return refuseRetiredAdminAction('admin.afltables_settle_trigger', admin, 'startSettleRunAction');
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

/**
 * Read for the page's initial render and the panel's own refresh.
 *
 * AFLDB-ISSUE-228 — must go through `parseSiteSettings()`, not a bare
 * `=== true` on the raw row value. jsonb arrives as raw TEXT on this
 * project's client (see `src/lib/site-settings.ts` `fromStore()`, and the
 * same note in `awards.ts`/`early-access.ts`/`site-content.ts`): an
 * enabled row reads back as the STRING `'true'`, which a bare `=== true`
 * can never match. That silently pinned this view to "disabled" no matter
 * what was actually stored — the switch persisted correctly the whole
 * time, but this read could never show it.
 */
export async function readAflApiIngestionAdminView(): Promise<AflApiIngestionAdminView> {
  await requireCapability('acquisition.currentSeason');
  const rows = await authSql<{ key: string; value: unknown }[]>`
    SELECT key, value FROM site_settings
     WHERE key IN (${SETTING_KEYS.aflApiCurrentSeasonEnabled}, ${SETTING_KEYS.aflApiBrownlowEnabled})
  `;
  const settings = parseSiteSettings(rows);
  return {
    currentSeasonEnabled: settings.aflApiCurrentSeasonEnabled,
    brownlow: combineAflApiBrownlowGates(isAflApiBrownlowEnabled(), settings.aflApiBrownlowEnabled),
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
