import type { Metadata } from 'next';
import Link from 'next/link';

import { getDraftCategoryCounts } from '@/db/queries/draft';
import { getSiteSettings } from '@/db/queries/site-settings';
import { DRAFT_CATEGORIES, FATHER_SON_LABEL } from '@/lib/draft-categories';
import { formatNumber } from '@/lib/format';
import { pageMetadata } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = pageMetadata({
  title: 'AFL Draft History — Every Pick by Year, Draft and Club',
  description:
    'AFL National, Rookie, Pre-Season and Mid-Season draft history and trades from 1981, each pick numbered within its own draft.',
  path: '/draft',
});

type YearSummary = { year: number; byKind: Map<string, number>; total: number; fatherSon: number };

export default async function DraftPage() {
  const [counts, settings] = await Promise.all([getDraftCategoryCounts({}), getSiteSettings()]);

  const byYear = new Map<number, YearSummary>();
  for (const c of counts) {
    const summary = byYear.get(c.draftYear)
      ?? { year: c.draftYear, byKind: new Map<string, number>(), total: 0, fatherSon: 0 };
    summary.byKind.set(c.draftKind ?? '', (summary.byKind.get(c.draftKind ?? '') ?? 0) + c.total);
    summary.total += c.total;
    summary.fatherSon += c.fatherSon;
    byYear.set(c.draftYear, summary);
  }
  const years = [...byYear.values()].sort((a, b) => b.year - a.year);

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
            AFL draft and trade-period history from 1981. Each year separates the National,
            Rookie, Pre-Season and Mid-Season drafts from trades and other acquisitions, and
            numbers every pick within its own draft.
          </p>
        )}
      </div>

      <div className="grid grid-wide">
        {years.map((y) => (
          <Link key={y.year} href={`/draft/${y.year}`} className="card">
            <h3>{y.year} AFL Draft</h3>
            <p className="meta draft-card-counts">
              {DRAFT_CATEGORIES.filter((c) => (y.byKind.get(c.kind) ?? 0) > 0)
                .map((c) => `${c.short} ${formatNumber(y.byKind.get(c.kind) ?? 0)}`)
                .join(' · ')}
              {y.fatherSon > 0 ? ` · ${FATHER_SON_LABEL} ${formatNumber(y.fatherSon)}` : ''}
            </p>
          </Link>
        ))}
      </div>
    </>
  );
}
