import Link from 'next/link';

import { formatNumber } from '@/lib/format';

/**
 * The admin list pager, extracted from /admin/player-links for the audit
 * viewer (AFLDB-ISSUE-157) -- the first `src/components/admin/` component,
 * created because two routes now render the identical control rather than
 * as the seed of an admin design system.
 *
 * Plain server HTML: a page number in the URL, one link either way, and a
 * one-line summary the caller phrases ("· 1,234 unresolved matching …").
 * Renders nothing at all for a single page, exactly as the inline original
 * did, so a short list carries no furniture.
 */
export function AdminPager({
  page,
  totalPages,
  pageHref,
  summary,
  label = 'Pages',
}: {
  page: number;
  totalPages: number;
  /** The URL for a given page number, carrying the caller's other filters. */
  pageHref: (page: number) => string;
  /** Rendered after "Page X of Y"; the caller includes its own separator. */
  summary?: React.ReactNode;
  label?: string;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav
      className="section"
      aria-label={label}
      style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}
    >
      {page > 1
        ? <Link href={pageHref(page - 1)} rel="prev">← Previous</Link>
        : <span className="muted">← Previous</span>}
      <span className="muted">
        Page {formatNumber(page)} of {formatNumber(totalPages)}
        {summary}
      </span>
      {page < totalPages
        ? <Link href={pageHref(page + 1)} rel="next">Next →</Link>
        : <span className="muted">Next →</span>}
    </nav>
  );
}
