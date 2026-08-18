import type { Metadata } from 'next';
import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import {
  APP_HEALTH_DEFAULT_PERIOD,
  APP_HEALTH_PERIODS,
  getAppHealthByBuild,
  getAppHealthOverview,
  getRecentAppHealthEvents,
  parseAppHealthPeriod,
} from '@/db/queries/app-health';
import { requireSuperAdmin } from '@/lib/auth/session';
import { formatNumber, NOT_RECORDED } from '@/lib/format';
import { firstValue } from '@/lib/params';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Application health',
  robots: { index: false, follow: false },
};

const EVENT_TYPE_LABEL: Record<string, string> = {
  RECOVERABLE_HYDRATION_ERROR: 'Recoverable hydration errors',
  UNHANDLED_CLIENT_ERROR: 'Unhandled client errors',
  PAGE_CRASH: 'Page crashes',
  NAVIGATION_FAILURE: 'Navigation failures',
  INTERACTION_FAILURE: 'Interaction failures',
  CONTENT_MISMATCH: 'Content mismatches',
  API_ERROR: 'API errors',
  DATABASE_ERROR: 'Database errors',
};

/**
 * Everything except RECOVERABLE_HYDRATION_ERROR is treated as evidence of
 * actual user impact -- this is the one distinction the whole page exists
 * to make (see migration 052 and project memory on the 2026-08-18
 * hydration investigation: a recoverable mismatch is not automatically a
 * page failure).
 */
const IMPACT_TYPES = [
  'UNHANDLED_CLIENT_ERROR', 'PAGE_CRASH', 'NAVIGATION_FAILURE',
  'INTERACTION_FAILURE', 'CONTENT_MISMATCH', 'API_ERROR', 'DATABASE_ERROR',
] as const;

function pct(part: number, whole: number): string {
  if (whole === 0) return NOT_RECORDED;
  return `${((part / whole) * 100).toFixed(2)}%`;
}

function timestamp(value: Date): string {
  return value.toISOString().slice(0, 16).replace('T', ' ');
}

export default async function AppHealthPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSuperAdmin();

  const params = await searchParams;
  const days = parseAppHealthPeriod(firstValue(params.days));
  const periodHref = (d: number) => `/admin/app-health?days=${d}`;

  const [overview, recent, byBuild] = await Promise.all([
    getAppHealthOverview(days),
    getRecentAppHealthEvents(days, 100),
    getAppHealthByBuild(days),
  ]);

  const impactTotal = IMPACT_TYPES.reduce((sum, t) => sum + overview.byType[t], 0);

  return (
    <>
      <div className="page-header">
        <h1>Application health</h1>
        <p className="subtitle">
          Client-observed technical failures, not natural-language search quality — see{' '}
          <Link href="/admin/nl-search">Search telemetry</Link> for whether AFLDB understood a
          question correctly. A recoverable hydration mismatch here is React repairing itself,
          not a demonstrated failure a reader saw — see the totals below for the distinction.
        </p>
      </div>

      <p className="section-note">
        Period:{' '}
        {APP_HEALTH_PERIODS.map((d) => (
          <span key={d}>
            {d === days ? <strong>last {d === 1 ? '24 hours' : `${d} days`}</strong>
              : <Link href={periodHref(d)}>last {d === 1 ? '24 hours' : `${d} days`}</Link>}
            {d === APP_HEALTH_PERIODS[APP_HEALTH_PERIODS.length - 1] ? '' : ' · '}
          </span>
        ))}
      </p>

      {overview.totalEvents === 0 ? (
        <p className="notice">
          No application-health events in this period{days === APP_HEALTH_DEFAULT_PERIOD ? '' : ' either'}.
          That is the expected state — this table only ever gets a row when something actually went
          wrong client-side.
        </p>
      ) : (
        <p className="notice">
          {impactTotal === 0 ? (
            <>
              {formatNumber(overview.totalEvents)} event(s) this period, all recoverable hydration
              mismatches. No demonstrated user-impacting failure in this window.
            </>
          ) : (
            <>
              <span className="badge badge-warn">
                {formatNumber(impactTotal)} event(s) with demonstrated user impact
              </span>{' '}
              this period — see the breakdown below.
            </>
          )}
        </p>
      )}

      <section className="section">
        <h2>Overview</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Event type</th>
                <th scope="col" className="num">Count</th>
                <th scope="col" className="num">% of /search loads</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="muted">/search loads (nl_search_log rows, this period)</td>
                <td className="num">{formatNumber(overview.searchLoads)}</td>
                <td className="num muted">—</td>
              </tr>
              {(['RECOVERABLE_HYDRATION_ERROR', ...IMPACT_TYPES] as const).map((t) => (
                <tr key={t}>
                  <td>{EVENT_TYPE_LABEL[t]}</td>
                  <td className="num">{formatNumber(overview.byType[t])}</td>
                  <td className="num">{pct(overview.byType[t], overview.searchLoads)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">
          The % column is against /search loads specifically (every hydration incident recorded so
          far happened there), not a site-wide page-view count, which this deliberately does not
          track — see migration 052&rsquo;s comment.
        </p>
      </section>

      {byBuild.length > 0 && (
        <section className="section">
          <h2>By build</h2>
          <p className="muted">
            A hydration rate that changes between builds is a far stronger signal than another
            hypothesis — bisect from there rather than re-investigating from scratch.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Build</th>
                  <th scope="col" className="num">Events</th>
                  <th scope="col" className="num">Recoverable hydration</th>
                </tr>
              </thead>
              <tbody>
                {byBuild.map((b) => (
                  <tr key={b.buildVersion ?? 'unknown'}>
                    <td className="mono">{b.buildVersion ?? NOT_RECORDED}</td>
                    <td className="num">{formatNumber(b.totalEvents)}</td>
                    <td className="num">{formatNumber(b.hydrationEvents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section className="section">
          <CollapsibleTable title={`Recent events (${recent.length})`}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Time</th>
                    <th scope="col">Build</th>
                    <th scope="col">Route</th>
                    <th scope="col">Event</th>
                    <th scope="col">Error</th>
                    <th scope="col">Recovered</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((e) => (
                    <tr key={e.id}>
                      <td className="nowrap muted">{timestamp(e.at)}</td>
                      <td className="mono">{e.buildVersion ?? NOT_RECORDED}</td>
                      <td className="mono">{e.route ?? NOT_RECORDED}</td>
                      <td>
                        <span className={e.eventType === 'RECOVERABLE_HYDRATION_ERROR' ? 'badge' : 'badge badge-warn'}>
                          {EVENT_TYPE_LABEL[e.eventType] ?? e.eventType}
                        </span>
                      </td>
                      <td className="muted">
                        {e.reactErrorCode ? `React #${e.reactErrorCode}` : (e.detail ?? NOT_RECORDED)}
                      </td>
                      <td>{e.recovered === null ? NOT_RECORDED : (e.recovered ? 'Yes' : 'No')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CollapsibleTable>
        </section>
      )}
    </>
  );
}
