import type { Metadata } from 'next';

import { readSettleRunStatus, type SettleRunStatus } from '@/lib/acquisition/settle-status';
import { requireSuperAdmin } from '@/lib/auth/session';
import { getCurrentSeasonReport } from '@/lib/external-afl/current-season-import';

import {
  CurrentSeasonControls,
  CurrentSeasonReportTable,
} from './CurrentSeasonControls';
import { SettleRunPanel } from './SettleRunPanel';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Current season refresh',
  robots: { index: false, follow: false },
};

export default async function CurrentSeasonPage() {
  await requireSuperAdmin();

  const year = new Date().getFullYear();

  // AFLDB-ISSUE-127. Never allowed to take the page down: a host without
  // systemd, or a database that refuses the batch read, must still render the
  // fallback diagnostics below.
  let settleStatus: SettleRunStatus | undefined;
  try {
    settleStatus = await readSettleRunStatus();
  } catch {
    settleStatus = undefined;
  }

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
        <h1>Current season</h1>
        <p className="subtitle">
          AFL Tables is the canonical automatic authority. Squiggle and Kali remain here as
          deprecated fallback diagnostics only.
        </p>
      </div>

      <SettleRunPanel initialStatus={settleStatus} />

      <div className="page-header">
        <h2>Fallback diagnostics</h2>
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
