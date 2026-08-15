import type { Metadata } from 'next';

import { UploadForm } from '@/app/admin/upload/UploadForm';
import { requireAdmin } from '@/lib/auth/session';
import { DATASETS } from '@/lib/ingest/datasets';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Upload data',
  robots: { index: false, follow: false },
};

export default async function UploadPage() {
  await requireAdmin();

  const datasets = Object.values(DATASETS).map((d) => ({
    key: d.key,
    title: d.title,
    description: d.description,
    requiredColumns: d.requiredColumns,
  }));

  return (
    <>
      <div className="page-header">
        <h1>Upload data</h1>
        <p className="subtitle">
          CSV in, staged for review. Nothing touches the statistical tables until a
          validated file is approved and promoted.
        </p>
      </div>

      <UploadForm datasets={datasets} />

      <section className="section">
        <h2>Accepted layouts</h2>
        <p className="section-note">
          Each sample below shows the expected columns with a couple of placeholder rows —
          a format template, not real data to promote as-is.
        </p>
        {datasets.map((d) => (
          <p className="section-note" key={d.key}>
            <strong>{d.title}</strong> — {d.description}
            <br />
            Required columns: <code>{d.requiredColumns.join(', ')}</code>
            <br />
            <a href={`/samples/${d.key.replace(/_/g, '-')}.csv`} download>Download sample CSV</a>
          </p>
        ))}
      </section>
    </>
  );
}
