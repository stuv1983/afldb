import 'server-only';

import { after } from 'next/server';

import { authSql } from '@/db/authClient';
import { isUuid } from '@/lib/nl-session';

/**
 * Mirrors app_health_events.event_type's CHECK constraint
 * (src/db/migrations/052_app_health_events.sql) exactly.
 *
 * RECOVERABLE_HYDRATION_ERROR is the one the client-side reporter
 * (src/lib/health-init-script.ts) currently detects and classifies
 * automatically, alongside UNHANDLED_CLIENT_ERROR for anything else
 * uncaught, and PAGE_CRASH from the root error boundary
 * (src/app/error.tsx). The rest of the taxonomy exists in the schema for
 * future instrumentation (a search returning wrong/missing content, a
 * broken nav, a failed interaction, an API/DB error) -- nothing in this
 * codebase emits them yet, and none should be inferred from a hydration
 * event. The whole point of this table is that those are NOT the same
 * thing as a recoverable hydration mismatch.
 */
export type AppHealthEventType =
  | 'RECOVERABLE_HYDRATION_ERROR' | 'UNHANDLED_CLIENT_ERROR' | 'PAGE_CRASH'
  | 'NAVIGATION_FAILURE' | 'INTERACTION_FAILURE' | 'CONTENT_MISMATCH'
  | 'API_ERROR' | 'DATABASE_ERROR';

export const APP_HEALTH_EVENT_TYPES: readonly AppHealthEventType[] = [
  'RECOVERABLE_HYDRATION_ERROR', 'UNHANDLED_CLIENT_ERROR', 'PAGE_CRASH',
  'NAVIGATION_FAILURE', 'INTERACTION_FAILURE', 'CONTENT_MISMATCH',
  'API_ERROR', 'DATABASE_ERROR',
];

export function isAppHealthEventType(value: unknown): value is AppHealthEventType {
  return typeof value === 'string' && (APP_HEALTH_EVENT_TYPES as readonly string[]).includes(value);
}

export type AppHealthEventEntry = {
  eventType: AppHealthEventType;
  route?: string | null;
  buildVersion?: string | null;
  /** The nl_sid cookie value, resolved server-side from the request -- never client-supplied. */
  sessionId?: string | null;
  /** Client-generated per page load, purely a grouping key for the admin view -- not trusted for anything else. */
  navigationId?: string | null;
  reactErrorCode?: string | null;
  recovered?: boolean | null;
  /**
   * The clientRef an answer panel carries (migration 049), if the
   * reporter found one on the page -- resolved to nl_search_log's id via
   * the same correlated-subquery pattern logNlSearch uses for
   * parent_search_id, never trusted as a raw foreign key from the client.
   */
  relatedSearchClientRef?: string | null;
  workerId?: string | null;
  requestId?: string | null;
  timeSinceNavigationMs?: number | null;
  detail?: string | null;
};

/**
 * Fire-and-forget, same shape as logNlSearch (db/queries/nl/log.ts): a
 * slow or unreachable write here must never be why a reader's page is
 * slow, and a write failure must never surface as a page failure --
 * this table exists to tell those apart, so it cannot itself become one.
 */
export function logAppHealthEvent(entry: AppHealthEventEntry): void {
  after(async () => {
    try {
      const clientRef = isUuid(entry.relatedSearchClientRef) ? entry.relatedSearchClientRef : null;
      // Resolved via a correlated subquery in the INSERT itself, matching
      // logNlSearch's parent_search_id pattern: `client_ref = NULL::uuid`
      // is never true in SQL, so a null/absent clientRef correctly
      // resolves related_search_id to NULL without a separate branch.
      await authSql`
        INSERT INTO app_health_events (
          event_type, route, build_version, session_id, navigation_id,
          react_error_code, recovered, related_search_id, worker_id,
          request_id, time_since_navigation_ms, detail
        )
        VALUES (
          ${entry.eventType},
          ${entry.route?.slice(0, 200) ?? null},
          ${entry.buildVersion ?? null},
          ${isUuid(entry.sessionId) ? entry.sessionId : null}::uuid,
          ${isUuid(entry.navigationId) ? entry.navigationId : null}::uuid,
          ${entry.reactErrorCode?.slice(0, 20) ?? null},
          ${entry.recovered ?? null},
          (SELECT id FROM nl_search_log WHERE client_ref = ${clientRef}::uuid ORDER BY at DESC LIMIT 1),
          ${entry.workerId ?? null},
          ${entry.requestId ?? null},
          ${entry.timeSinceNavigationMs ?? null},
          ${entry.detail?.slice(0, 500) ?? null}
        )
      `;
    } catch (error) {
      console.error('failed to write app_health_events row', error);
    }
  });
}

// --- Admin reads (super-admin only; see src/app/admin/app-health/page.tsx) ---

/** The periods the UI offers, matching nl-search-log.ts's NL_LOG_PERIODS shape exactly. */
export const APP_HEALTH_PERIODS = [1, 7, 30, 90] as const;
export type AppHealthPeriod = (typeof APP_HEALTH_PERIODS)[number];
export const APP_HEALTH_DEFAULT_PERIOD: AppHealthPeriod = 1;

export function parseAppHealthPeriod(value: string | undefined): AppHealthPeriod {
  const n = Number(value);
  return (APP_HEALTH_PERIODS as readonly number[]).includes(n) ? (n as AppHealthPeriod) : APP_HEALTH_DEFAULT_PERIOD;
}

export type AppHealthOverview = {
  totalEvents: number;
  byType: Record<AppHealthEventType, number>;
  /**
   * nl_search_log's row count over the same period, as a denominator for
   * a /search-specific rate -- not a site-wide page-view count, which
   * this deliberately does not track (see migration 052's comment).
   * Meaningful because every hydration incident this table has ever
   * recorded happened on /search.
   */
  searchLoads: number;
};

export async function getAppHealthOverview(days: number): Promise<AppHealthOverview> {
  const [counts, [{ searchLoads }]] = await Promise.all([
    authSql<{ eventType: AppHealthEventType; count: string }[]>`
      SELECT event_type AS "eventType", count(*)::text AS count
        FROM app_health_events
       WHERE at > now() - make_interval(days => ${days})
       GROUP BY event_type
    `,
    authSql<{ searchLoads: string }[]>`
      SELECT count(*)::text AS "searchLoads"
        FROM nl_search_log
       WHERE at > now() - make_interval(days => ${days})
    `,
  ]);

  const byType = Object.fromEntries(
    APP_HEALTH_EVENT_TYPES.map((t) => [t, 0]),
  ) as Record<AppHealthEventType, number>;
  let totalEvents = 0;
  for (const row of counts) {
    const n = Number(row.count);
    byType[row.eventType] = n;
    totalEvents += n;
  }

  return { totalEvents, byType, searchLoads: Number(searchLoads) };
}

export type AppHealthEventRow = {
  id: number;
  at: Date;
  eventType: AppHealthEventType;
  buildVersion: string | null;
  route: string | null;
  reactErrorCode: string | null;
  recovered: boolean | null;
  workerId: string | null;
  detail: string | null;
};

export async function getRecentAppHealthEvents(days: number, limit: number): Promise<AppHealthEventRow[]> {
  return authSql<AppHealthEventRow[]>`
    SELECT id, at, event_type AS "eventType", build_version AS "buildVersion",
           route, react_error_code AS "reactErrorCode", recovered,
           worker_id AS "workerId", detail
      FROM app_health_events
     WHERE at > now() - make_interval(days => ${days})
     ORDER BY at DESC
     LIMIT ${limit}
  `;
}

export type AppHealthByBuild = {
  buildVersion: string | null;
  totalEvents: number;
  hydrationEvents: number;
};

/**
 * Grouped by build so a redeploy that changes the hydration rate shows up
 * as a change between rows, not buried in one aggregate -- the exact
 * bisection aid the 2026-08-18 investigation's memory notes ask for.
 */
export async function getAppHealthByBuild(days: number): Promise<AppHealthByBuild[]> {
  const rows = await authSql<{ buildVersion: string | null; total: string; hydration: string }[]>`
    SELECT build_version AS "buildVersion",
           count(*)::text AS total,
           count(*) FILTER (WHERE event_type = 'RECOVERABLE_HYDRATION_ERROR')::text AS hydration
      FROM app_health_events
     WHERE at > now() - make_interval(days => ${days})
     GROUP BY build_version
     ORDER BY max(at) DESC
  `;
  return rows.map((r) => ({
    buildVersion: r.buildVersion,
    totalEvents: Number(r.total),
    hydrationEvents: Number(r.hydration),
  }));
}
