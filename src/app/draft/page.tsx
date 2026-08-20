import type { Metadata } from 'next';
import Link from 'next/link';

import { getDraftYears } from '@/db/queries/draft';
import { getSiteSettings } from '@/db/queries/site-settings';
import { pageMetadata } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = pageMetadata({
  title: 'AFL Draft History — Every Pick by Year and Club',
  description:
    'AFL national and rookie draft history from 1981, with every pick, club and player.',
  path: '/draft',
});

export default async function DraftPage() {
  const years = await getDraftYears();
  const settings = await getSiteSettings();

  return (
    <>
      <div className="page-header">
        <h1>Draft</h1>
        {settings.pageIntros.draft ? (
          <p className="subtitle" style={{ whiteSpace: 'pre-wrap' }}>
            {settings.pageIntros.draft}
          </p>
        ) : (
          <p className="subtitle">
            AFL national and rookie draft history from 1981.
          </p>
        )}
      </div>

      <div className="grid grid-wide">
        {years.map((year) => (
          <Link key={year} href={`/draft/${year}`} className="card">
            <h3>{year} AFL Draft</h3>
          </Link>
        ))}
      </div>
    </>
  );
}
