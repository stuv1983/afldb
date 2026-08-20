import type { Metadata } from 'next';

import { requireSuperAdmin } from '@/lib/auth/session';
import { getCurrentSeasonReport } from '@/lib/external-afl/current-season-import';

import {
  CurrentSeasonControls,
  CurrentSeasonReportTable,
} from './CurrentSeasonControls';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Current season refresh',
  robots: { index: false, follow: false },
};

export default async function CurrentSeasonPage() {
  await requireSuperAdmin();

  const year = new Date().getFullYear();
  let report = null;
  let reportError: string | null = null;
  try {
    report = await getCurrentSeasonReport(year);
  } catch (error) {
    reportError = error instanceof Error ? error.message : String(error);
  }

  return (
    <>
      <div className="page-header">
        <h1>Current season refresh</h1>
        <p className="subtitle">
          Fetch current AFL match results from server-side external APIs, stage the raw payloads,
          and fill completed match gaps without exposing provider keys to the browser.
        </p>
      </div>

      <p className="notice">
        Auto update uses Kali AFL Stats, stages fresh API rows, and inserts completed matches
        that AFLDB can resolve unambiguously. Existing final scores are left alone unless the
        manual overwrite option is deliberately selected.
      </p>

      <CurrentSeasonControls year={year} />

      <section className="section">
        <h2>Staged report</h2>
        {reportError ? (
          <p className="notice" role="alert">{reportError}</p>
        ) : report ? (
          <CurrentSeasonReportTable report={report} />
        ) : (
          <p className="muted">No report loaded.</p>
        )}
      </section>
    </>
  );
}
