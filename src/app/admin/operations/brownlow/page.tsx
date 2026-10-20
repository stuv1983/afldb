import type { Metadata } from 'next';
import Link from 'next/link';

import { hasCapability } from '@/lib/auth/capabilities';
import { requireCapability } from '@/lib/auth/session';

import {
  MedalDeterminationSection,
  reviewPlayersOf,
} from '../_components/BrownlowDeterminationViews';
import { BrownlowDecisionWorkbench } from '../_components/BrownlowEligibilityClient';
import {
  BrownlowCaveats,
  BrownlowReportView,
  BrownlowSeasonPicker,
} from '../_components/BrownlowViews';
import { LoadFailure } from '../_components/Shared';
import { loadBrownlowDetermination, loadBrownlowReport } from '../page-data';
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
 * the match context and reports agreement, discrepancies and refusals. The reconciliation below
 * writes and audits nothing: the season and eligibility rule come from the query string
 * (`searchParams` is a Promise in Next 16, awaited after the guard). Two caveats are stated up
 * front: no eligibility rule is recorded for API-era seasons (V2-GAP-016), and what the staged API
 * leaderboard and the provider-team-to-club mapping contributed (V2-GAP-023; before the settle
 * stages a leaderboard the page says so, as F-WB1-005 did).
 *
 * LAUNCH F F-D (ADR 0014) adds the eligibility-aware MEDAL DETERMINATION above the reconciliation.
 * Its decision form is the only thing here that writes, and only for `data.brownlow.finalise`
 * (Super Admin): an Admin sees the same evidence and history read-only. The form posts to a Server
 * Action that records evidence and projects eligibility/medal metadata transactionally; raw votes stay unchanged.
 */
export default async function BrownlowReconciliationPage(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  const admin = await requireCapability('data.brownlow.read');
  const params = await searchParams;
  const query = parseBrownlowQuery(params);
  const report = await loadBrownlowReport(admin, query);
  const determination = await loadBrownlowDetermination(admin, query);
  const canDecide = hasCapability(admin, 'data.brownlow.finalise');

  return (
    <>
      <div className="page-header">
        <p className="muted"><Link href="/admin/operations">← Operations centre</Link></p>
        <h1>Brownlow reconciliation</h1>
        <p className="subtitle">
          Compares the staged AFL API Brownlow votes with the stored authoritative totals for one
          season and states the medal winner only where eligibility is established. The reconciliation
          only reads. A Super Admin can record an audited eligibility decision and publish its effect
          on the medal result in the same transaction. Raw votes and totals are preserved.
        </p>
      </div>

      <BrownlowCaveats staging={report !== null && report.ok ? report.value.staging : null} />
      <BrownlowSeasonPicker season={query.season} rule={query.rule} seasonError={query.seasonError} />
      {determination !== null && (
        determination.ok ? (
          <MedalDeterminationSection
            view={determination.value}
            reviewPanel={(
              <BrownlowDecisionWorkbench
                season={determination.value.season}
                players={reviewPlayersOf(determination.value)}
                canDecide={canDecide}
                actingEmail={admin.email}
                sealedSeason={determination.value.sealed}
              />
            )}
          />
        ) : (
          <LoadFailure what={`The ${query.season} medal determination`} error={determination.error} code={determination.code} />
        )
      )}
      {report === null ? (
        <p className="muted" data-no-season="true">Choose a season to see its reconciliation.</p>
      ) : !report.ok ? (
        <LoadFailure what={`The ${query.season} reconciliation`} error={report.error} code={report.code} />
      ) : (
        <BrownlowReportView report={report.value.report} staging={report.value.staging} />
      )}
    </>
  );
}
