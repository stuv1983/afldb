import type { Metadata } from 'next';

import { AwardWinnerForm } from '@/app/admin/awards/AwardWinnerForm';
import { domainListPath } from '@/app/admin/awards/labels';
import { AwardsCrumb } from '@/app/admin/awards/RecordFacts';
import { listAwards } from '@/db/queries/awards';
import { listClubs } from '@/db/queries/clubs';
import { requireCapability } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Record an award winner', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * `/admin/awards/winners/new` (AFLDB-ISSUE-165 §6.5).
 *
 * Guarded by `data.awards.edit` rather than `.read`, following the
 * `/admin/draft/new` precedent: every path this page reaches is a mutation,
 * so an Admin who cannot make one is turned away at the door rather than
 * shown a form that will refuse them. `.edit` is strictly narrower than
 * `.read`, so this admits nobody `.read` would not.
 */
export default async function NewAwardWinnerPage() {
  await requireCapability('data.awards.edit');
  const [awards, clubs] = await Promise.all([listAwards(), listClubs()]);

  return (
    <>
      <div className="page-header">
        <AwardsCrumb href={domainListPath('winners')} label="Award winners" />
        <h1>Record an award winner</h1>
        <p className="subtitle">
          A record created here is owned by the administrator who made it, not by a source: nothing
          reloads its fields, and its durable record is what carries it through a rebuild. Brownlow
          Medallists are not recorded here — they come from the authoritative season-votes dataset.
        </p>
      </div>

      <AwardWinnerForm awards={awards} clubs={clubs} />
    </>
  );
}
