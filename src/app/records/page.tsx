import type { Metadata } from 'next';
import Link from 'next/link';

import { RECORD_CATEGORIES } from '@/db/queries/records';
import { pageMetadata } from '@/lib/seo';

export const revalidate = 3600;

export const metadata: Metadata = pageMetadata({
  title: 'AFL & VFL Records — Career, Season and Single-Match Leaders',
  description:
    'AFL/VFL records: most games, most goals, most finals, most premierships, '
    + 'most Brownlow votes, and single-game and single-season records.',
  path: '/records',
});

export default function RecordsPage() {
  const categories = Object.values(RECORD_CATEGORIES);

  return (
    <>
      <div className="page-header">
        <h1>Records</h1>
        <p className="subtitle">
          Each record states its exact definition and the era for which the underlying
          statistic was collected.
        </p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {categories.map((category) => (
          <Link key={category.slug} href={`/records/${category.slug}`} className="card">
            <h3>{category.title}</h3>
            <div className="meta">{category.definition}</div>
          </Link>
        ))}
      </div>
    </>
  );
}
