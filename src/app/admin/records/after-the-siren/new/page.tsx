import type { Metadata } from 'next';

import { familyListPath } from '@/app/admin/records/labels';
import { SpecialRecordCreatePanel } from '@/app/admin/records/SpecialRecordCreatePanel';
import { RecordsCrumb } from '@/app/admin/records/SpecialRecordFacts';
import { requireCapability } from '@/lib/auth/session';

export const metadata: Metadata = {
  title: 'Record a kick after the siren',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

/**
 * `/admin/records/after-the-siren/new` (AFLDB-ISSUE-167 §10.1, §10.2).
 *
 * Guarded by `data.specialRecords.edit` rather than `.read`, for the reason the
 * first-kick creator gives: every path here is a mutation.
 *
 * The five coupled event fields are validated as a combination before any SQL
 * is issued, so a combination migration 089's CHECK constraints would refuse
 * comes back as a sentence about football rather than a constraint name.
 */
export default async function NewAfterSirenPage() {
  await requireCapability('data.specialRecords.edit');

  return (
    <>
      <div className="page-header">
        <RecordsCrumb href={familyListPath('after-the-siren')} label="After the siren" />
        <h1>Record a kick after the siren</h1>
        <p className="subtitle">
          A record created here is owned by the administrator who made it, not by a source: the
          curated artefact never reloads it, no importer retirement can delete it, and its durable
          record is what carries it through a full rebuild.
        </p>
      </div>

      <SpecialRecordCreatePanel family="after-the-siren" />
    </>
  );
}
