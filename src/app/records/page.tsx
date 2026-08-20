import type { Metadata } from 'next';
import Link from 'next/link';

import { RECORD_CATEGORIES } from '@/db/queries/records';
import { getSiteSettings } from '@/db/queries/site-settings';
import { pageMetadata } from '@/lib/seo';

export const revalidate = 3600;

export const metadata: Metadata = pageMetadata({
  title: 'AFL & VFL Records — Career, Season and Single-Match Leaders',
  description:
    'AFL/VFL records: most games, most goals, most finals, most premierships, '
    + 'most Brownlow votes, and single-game and single-season records.',
  path: '/records',
});

export default async function RecordsPage() {
  const categories = Object.values(RECORD_CATEGORIES);
  const settings = await getSiteSettings();

  return (
    <>
      <div className="page-header">
        <h1>Records</h1>
        {settings.pageIntros.records && (
          <p className="subtitle" style={{ whiteSpace: 'pre-wrap' }}>
            {settings.pageIntros.records}
          </p>
        )}
      </div>

      <div className="grid grid-wide">
        {categories.map((category) => (
          <Link key={category.slug} href={`/records/${category.slug}`} className="card">
            <h3>{category.title}</h3>
            <div className="meta">{category.definition}</div>
          </Link>
        ))}

        {/* Listed by hand rather than from RECORD_CATEGORIES: that
            catalogue drives the computed /records/[category] leaderboards,
            and this is a curated list from a cited source, with no
            underlying column to rank. */}
        <Link href="/records/first-kick-goal" className="card">
          <h3>Goal with first VFL/AFL kick</h3>
          <div className="meta">
            Players recognised as having kicked a goal with their first kick in a senior
            VFL/AFL match.
          </div>
        </Link>
      </div>
    </>
  );
}
