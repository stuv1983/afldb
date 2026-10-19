import type { Metadata } from 'next';
import Link from 'next/link';

import { requireCapability } from '@/lib/auth/session';

import {
  BrownlowCaveats,
  BrownlowReportView,
  BrownlowSeasonPicker,
} from '../_components/BrownlowViews';
import { LoadFailure } from '../_components/Shared';
import { loadBrownlowReport } from '../page-data';
import { parseBrownlowQuery } from '../views';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Brownlow reconciliation',
  robots: { index: false, follow: false },
};

/**
 * `/admin/operations/brownlow` — the read-only Brownlow reconciliation (AFLDB V2 Stage 5, plan D9;
 * ADR 0007).
 *
 * Needs `data.brownlow.read`. It reads the staged AFL API votes, the stored authoritative totals and
 * the match context and reports agreement, discrepancies and refusals. It writes and audits nothing
 * and carries no form that changes data: the season and eligibility rule come from the query string
 * (`searchParams` is a Promise in Next 16, awaited after the guard). Two caveats are stated up
 * front: no eligibility rule is recorded for API-era seasons (V2-GAP-016) and the API leaderboard is
 * not staged (F-WB1-005).
 */
export default async function BrownlowReconciliationPage(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  const admin = await requireCapability('data.brownlow.read');
  const params = await searchParams;
  const query = parseBrownlowQuery(params);
  const report = await loadBrownlowReport(admin, query);

  return (
    <>
      <div className="page-header">
        <p className="muted"><Link href="/admin/operations">← Operations centre</Link></p>
        <h1>Brownlow reconciliation</h1>
        <p className="subtitle">
          Compares the staged AFL API Brownlow votes with the stored authoritative totals for one
          season. This page only reads: it changes no vote, total or award.
        </p>
      </div>

      <BrownlowCaveats />
      <BrownlowSeasonPicker season={query.season} rule={query.rule} seasonError={query.seasonError} />
      {report === null ? (
        <p className="muted" data-no-season="true">Choose a season to see its reconciliation.</p>
      ) : !report.ok ? (
        <LoadFailure what={`The ${query.season} reconciliation`} error={report.error} code={report.code} />
      ) : (
        <BrownlowReportView report={report.value} />
      )}
    </>
  );
}
