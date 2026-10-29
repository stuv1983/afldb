import type { Metadata } from 'next';
import Link from 'next/link';

import { requireCapability } from '@/lib/auth/session';

import { AflApiFindingsNav, AflApiFindingsPager, AflApiFindingsTable } from '../_components/AflApiFindingsViews';
import { LoadedSection } from '../_components/Shared';
import { loadAflApiFindings } from '../page-data';
import { AFL_API_FINDING_SECTION_LABELS, parseAflApiFindingsQuery } from '../views';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AFL API settle refusals',
  robots: { index: false, follow: false },
};

/**
 * `/admin/operations/afl-api-refusals` — the open AFL API settle refusals and findings (V2-GAP-025).
 *
 * READ-ONLY (`operations.centre.read`, the overview's own capability). It lists what the AFL API
 * settles refused or flagged and left open in `data_issues`; it resolves, retries and starts
 * nothing. A finding is closed only by the settle that owns it, on a later run. In Next 16
 * `searchParams` is a Promise, awaited after the guard.
 */
export default async function AflApiRefusalsPage(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  const admin = await requireCapability('operations.centre.read');
  const query = parseAflApiFindingsQuery(await searchParams);
  const findings = await loadAflApiFindings(admin, query);

  return (
    <>
      <div className="page-header">
        <p className="muted"><Link href="/admin/operations">← Operations centre</Link></p>
        <h1>AFL API settle refusals</h1>
        <p className="subtitle">
          What the AFL API settles refused or flagged and left open. A refused canonical application
          wrote nothing canonical: the settle records it as an open finding instead, and closes it
          itself on the run the target applies or no longer needs applying. This page reads; it
          resolves, retries and starts nothing.
        </p>
        <p className="muted">
          Shown: open <span className="mono">data_issues</span> with source <span className="mono">afl_api</span>,
          {' '}as written by <span className="mono">settle-afl-api.ts</span> and{' '}
          <span className="mono">settle-afl-api-brownlow.ts</span>. AFL Tables findings are not shown.
          Values, payloads and error text are never shown here.
        </p>
      </div>

      {query.cursorError !== null && <p className="notice" role="status">{query.cursorError}</p>}

      <LoadedSection
        id="afl-api-findings"
        title={AFL_API_FINDING_SECTION_LABELS[query.section]}
        what="The AFL API settle refusals"
        loaded={findings}
      >
        {(page) => (
          <>
            <AflApiFindingsNav page={page} />
            <AflApiFindingsTable page={page} />
            <AflApiFindingsPager page={page} />
          </>
        )}
      </LoadedSection>
    </>
  );
}
