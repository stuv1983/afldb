import Link from 'next/link';

import {
  ALL_VIEW,
  DRAFT_CATEGORIES,
  FATHER_SON_LABEL,
  FATHER_SON_VIEW,
  type DraftView,
} from '@/lib/draft-categories';
import { formatNumber } from '@/lib/format';

type Params = Record<string, string | string[] | undefined>;

/**
 * Category tabs for one draft year (AFLDB-ISSUE-336).
 *
 * Every link keeps the active filters and sort but drops `page`, so changing category
 * always starts at the first page. Primary categories always have a tab (an empty one
 * leads to a stated empty state); the remaining source categories appear when the year
 * has rows for them. Father–Son is a view over the other categories: its count is a
 * subset of theirs and is never added to "All".
 */
export function DraftCategoryNav({
  basePath,
  params,
  view,
  counts,
  fatherSonCount,
}: {
  basePath: string;
  /** Filter and sort parameters to carry over; `view` and `page` are set here. */
  params: Params;
  view: DraftView;
  counts: ReadonlyMap<string, number>;
  fatherSonCount: number;
}) {
  const href = (viewValue: string | undefined) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key === 'page' || key === 'view' || value === undefined) continue;
      for (const item of Array.isArray(value) ? value : [value]) search.append(key, item);
    }
    if (viewValue) search.set('view', viewValue);
    const qs = search.toString();
    return `${basePath}${qs ? `?${qs}` : ''}`;
  };

  const allCount = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const current = view.type === 'category' ? view.category.slug : view.type === 'father-son' ? FATHER_SON_VIEW : ALL_VIEW;
  const others = DRAFT_CATEGORIES.filter((c) => !c.primary && ((counts.get(c.kind) ?? 0) > 0 || current === c.slug));

  const tab = (key: string, label: string, count: number, viewValue: string | undefined, extra = '') => (
    <Link
      key={key}
      href={href(viewValue)}
      className={`chip draft-tab${count === 0 ? ' is-empty' : ''}${extra}`}
      aria-current={current === key ? 'page' : undefined}
      scroll={false}
    >
      {label} <span className="count">{formatNumber(count)}</span>
    </Link>
  );

  return (
    <nav className="draft-tabs" aria-label="Draft categories">
      <div className="draft-tabs-row">
        {tab(ALL_VIEW, 'All', allCount, undefined)}
        {DRAFT_CATEGORIES.filter((c) => c.primary).map((c) =>
          tab(c.slug, c.short, counts.get(c.kind) ?? 0, c.slug))}
        {tab(FATHER_SON_VIEW, FATHER_SON_LABEL, fatherSonCount, FATHER_SON_VIEW, ' draft-tab-feature')}
      </div>
      {others.length > 0 && (
        <div className="draft-tabs-row">
          <span className="draft-tabs-label">Other acquisitions</span>
          {others.map((c) => tab(c.slug, c.short, counts.get(c.kind) ?? 0, c.slug))}
        </div>
      )}
    </nav>
  );
}
