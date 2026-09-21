/**
 * AFLDB-ISSUE-228 follow-up (2026-09-21) — super-admin-controlled,
 * fail-closed ingestion switches for the AFL API acquisition/settle chains.
 *
 * WHY A SEPARATE CONNECTION, NOT `AFLDB_IMPORT_DATABASE_URL`. Every
 * acquire/settle CLI already opens a connection as `afldb_import` for its
 * canonical write path, but migration 045 deliberately denies that role ANY
 * access — not even SELECT — to `site_settings` ("a super admin's runtime
 * choices ... not the ETL's business"). Widening that grant to serve this
 * check would cross a boundary 045 drew on purpose. `afldb_app` (the
 * `DATABASE_URL` role) already holds SELECT on `site_settings` (migration
 * 034: it is deliberately public-readable, the home page renders it), so
 * this module opens its own short-lived, single-use connection with that
 * DSN, reads the two flags, and closes it immediately — never reusing or
 * widening either role's existing grants.
 *
 * FAIL CLOSED (hard requirement B). `DATABASE_URL` unset, a connection
 * failure, a missing `site_settings` table and a malformed row all return
 * the same disabled result as an explicit `false` row — there is no code
 * path here that can produce `true` from anything but a stored `true`
 * (`parseBooleanSetting` in `site-settings.ts`). Callers that need the
 * acquisition to REFUSE on a read failure (rather than silently treat it as
 * "disabled" and exit 0) get that from their own calling convention: every
 * acquire/settle CLI in this codebase already throws when its enable check
 * fails, and `false` here still trips those throws.
 */
import postgres from 'postgres';

import { parseSiteSettings, SETTING_KEYS } from '../site-settings';

export type AflApiIngestionControls = {
  /** site_settings 'acquisition.afl_api_current_season_enabled'. No outer environment gate exists for this family. */
  currentSeasonEnabled: boolean;
  /** site_settings 'acquisition.afl_api_brownlow_enabled'. One half of a two-key gate — see `combineAflApiBrownlowGates`. */
  brownlowAdminEnabled: boolean;
};

export const DISABLED_AFL_API_INGESTION_CONTROLS: AflApiIngestionControls = {
  currentSeasonEnabled: false,
  brownlowAdminEnabled: false,
};

const CONNECT_TIMEOUT_S = 10;
const END_TIMEOUT_S = 5;

/**
 * Reads both switches in one round trip through a dedicated `afldb_app`
 * connection. Never throws: any failure (unset DSN, refused connection,
 * timeout, missing table) resolves to `DISABLED_AFL_API_INGESTION_CONTROLS`,
 * matching this table's own read path (`src/db/queries/site-settings.ts`
 * `getSiteSettings()`) for the one failure mode it also swallows — a
 * database that has not run migration 034 yet.
 */
export async function readAflApiIngestionControls(
  env: Partial<Record<string, string | undefined>> = process.env,
): Promise<AflApiIngestionControls> {
  const dsn = env.DATABASE_URL;
  if (!dsn) return DISABLED_AFL_API_INGESTION_CONTROLS;

  let sql: postgres.Sql | null = null;
  try {
    sql = postgres(dsn, {
      max: 1,
      connect_timeout: CONNECT_TIMEOUT_S,
      onnotice: () => {},
      transform: { undefined: null },
    });
    const rows = await sql<{ key: string; value: unknown }[]>`
      SELECT key, value FROM site_settings
       WHERE key IN (${SETTING_KEYS.aflApiCurrentSeasonEnabled}, ${SETTING_KEYS.aflApiBrownlowEnabled})
    `;
    const settings = parseSiteSettings(rows);
    return {
      currentSeasonEnabled: settings.aflApiCurrentSeasonEnabled,
      brownlowAdminEnabled: settings.aflApiBrownlowEnabled,
    };
  } catch {
    return DISABLED_AFL_API_INGESTION_CONTROLS;
  } finally {
    if (sql) await sql.end({ timeout: END_TIMEOUT_S });
  }
}

export type AflApiBrownlowEffectiveState = {
  /** `AFLDB_AFL_API_BROWNLOW_ENABLED === 'true'` (`isAflApiBrownlowEnabled`). The outer, deployment-level gate. */
  deploymentGateEnabled: boolean;
  /** site_settings 'acquisition.afl_api_brownlow_enabled'. The inner, super-admin-controlled gate. */
  adminEnabled: boolean;
  /** Hard requirement D: BOTH must be true. Neither can override the other. */
  effectiveEnabled: boolean;
};

/**
 * Composes the Brownlow two-key gate (hard requirement D). Pure — takes both
 * already-read booleans rather than reading either itself, so the admin UI
 * (which must show all three states) and the CLI enforcement points (which
 * only need `effectiveEnabled`) share one derivation.
 */
export function combineAflApiBrownlowGates(
  deploymentGateEnabled: boolean,
  adminEnabled: boolean,
): AflApiBrownlowEffectiveState {
  return {
    deploymentGateEnabled,
    adminEnabled,
    effectiveEnabled: deploymentGateEnabled && adminEnabled,
  };
}
