import type { Metadata } from 'next';
import Link from 'next/link';

import { requireCapability } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Upload data (retired)',
  robots: { index: false, follow: false },
};

/**
 * RETIRED (AFLDB V2 Stage 5, V2-GAP-013, docs/v2/legacy-disposition.md L1). The CSV upload form is
 * removed, and so is the dataset list it rendered (no ingest module is imported here). The guard
 * stays so the notice is shown to the same staff roles the form was; the route it posted to
 * (`./stage/route.ts`) refuses.
 */
export default async function UploadPage() {
  await requireCapability('acquisition.legacyIntake');

  return (
    <>
      <div className="page-header">
        <h1>Upload data</h1>
        <p className="subtitle">
          CSV upload has been retired and no longer accepts files.
        </p>
      </div>

      <p className="notice">
        <strong>CSV upload, CSV submission review and promotion, and email intake are retired.</strong>{' '}
        They loaded a file straight into the final statistical tables, which AFLDB V2 no longer
        allows. Nothing a file contains can be staged here any more.
      </p>

      <section className="section">
        <h2>What replaces it</h2>
        <p className="section-note">
          Curated award proposals are entered and reviewed in the operations centre:{' '}
          <Link href="/admin/operations/awards">Award proposals →</Link>. Corrections to matches,
          players and other facts go through the audited data editors in the admin sidebar.
        </p>
        <p className="section-note">
          Files already submitted stay readable as history on the{' '}
          <Link href="/admin#submissions">submissions log</Link>; they can no longer be validated,
          approved or promoted.
        </p>
      </section>
    </>
  );
}
