import type { Metadata } from 'next';

import { familyListPath } from '@/app/admin/records/labels';
import { SpecialRecordCreatePanel } from '@/app/admin/records/SpecialRecordCreatePanel';
import { RecordsCrumb } from '@/app/admin/records/SpecialRecordFacts';
import { requireCapability } from '@/lib/auth/session';

export const metadata: Metadata = {
  title: 'Record a first-kick goal',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

/**
 * `/admin/records/first-kick-goal/new` (AFLDB-ISSUE-167 §10.1, §10.2).
 *
 * Guarded by `data.specialRecords.edit` rather than `.read`, following the
 * `/admin/awards/winners/new` and `/admin/draft/new` precedent: every path this
 * page reaches is a mutation, so an Admin who cannot make one is turned away at
 * the door rather than shown a form that will refuse them. `.edit` is strictly
 * narrower than `.read`, so this admits nobody `.read` would not.
 */
export default async function NewFirstKickGoalPage() {
  await requireCapability('data.specialRecords.edit');

  return (
    <>
      <div className="page-header">
        <RecordsCrumb href={familyListPath('first-kick-goal')} label="First-kick goal" />
        <h1>Record a first-kick goal</h1>
        <p className="subtitle">
          A record created here is owned by the administrator who made it, not by a source: the
          curated manifest never reloads it, no importer retirement can delete it, and its durable
          record is what carries it through a full rebuild.
        </p>
      </div>

      <SpecialRecordCreatePanel family="first-kick-goal" />
    </>
  );
}
