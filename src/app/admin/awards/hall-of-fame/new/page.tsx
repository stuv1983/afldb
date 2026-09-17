import type { Metadata } from 'next';

import { HallOfFameForm } from '@/app/admin/awards/HallOfFameForm';
import { domainListPath } from '@/app/admin/awards/labels';
import { AwardsCrumb } from '@/app/admin/awards/RecordFacts';
import { requireCapability } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Record a Hall of Fame induction', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/** `/admin/awards/hall-of-fame/new` (AFLDB-ISSUE-165 §6.5). Super Admin only. */
export default async function NewHallOfFamePage() {
  await requireCapability('data.awards.edit');

  return (
    <>
      <div className="page-header">
        <AwardsCrumb href={domainListPath('hall-of-fame')} label="Hall of Fame" />
        <h1>Record a Hall of Fame induction</h1>
        <p className="subtitle">
          The name is recorded exactly as typed and is never taken from a linked player: with the
          induction year it is what identifies the entry, both in the database and in the durable
          record that survives a rebuild. Link a player as well when there is one — that is a
          separate fact, and it can be changed later without moving the entry.
        </p>
      </div>

      <HallOfFameForm />
    </>
  );
}
