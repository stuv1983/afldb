import Link from 'next/link';

/**
 * Server-rendered pagination. Page state lives in the URL so every
 * result page is shareable and indexable.
 */
export function Pagination({
  basePath,
  params,
  page,
  pageSize,
  total,
}: {
  basePath: string;
  /** A repeated parameter (a multi-select filter) is carried as an array. */
  params: Record<string, string | string[] | undefined>;
  page: number;
  pageSize: number;
  total: number;
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  const href = (target: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') continue;
      if (Array.isArray(value)) for (const item of value) query.append(key, item);
      else query.set(key, value);
    }
    if (target > 1) query.set('page', String(target));
    else query.delete('page');
    const qs = query.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="count">
        {from.toLocaleString('en-AU')}–{to.toLocaleString('en-AU')} of{' '}
        {total.toLocaleString('en-AU')}
      </span>
      <span className="spacer" />
      {page > 1 ? (
        <Link className="btn btn-secondary" href={href(page - 1)} rel="prev">
          ← Previous
        </Link>
      ) : (
        <span className="btn btn-secondary" aria-disabled="true"
              style={{ opacity: 0.45, pointerEvents: 'none' }}>← Previous</span>
      )}
      <span className="count">Page {page} of {lastPage.toLocaleString('en-AU')}</span>
      {page < lastPage ? (
        <Link className="btn btn-secondary" href={href(page + 1)} rel="next">
          Next →
        </Link>
      ) : (
        <span className="btn btn-secondary" aria-disabled="true"
              style={{ opacity: 0.45, pointerEvents: 'none' }}>Next →</span>
      )}
    </nav>
  );
}
