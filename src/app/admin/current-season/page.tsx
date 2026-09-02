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
        <h1>Current-season fallback diagnostics</h1>
        <p className="subtitle">
          Acquire Squiggle and Kali observations server-side and retain staging and history for
          diagnostics or explicit human fallback investigation without exposing provider keys.
        </p>
      </div>

      <p className="notice">
        Squiggle and Kali are deprecated fallback sources. These controls never insert or update
        canonical current-season matches; AFL Tables remains the canonical automatic authority.
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
