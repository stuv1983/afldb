import { redirect } from 'next/navigation';

import { toSearchParams } from '@/search/table-filters';

/**
 * Send a past-the-end page number to the last page that exists.
 *
 * A page number beyond the result set is a real URL people arrive at,
 * from stale links and hand-edited query strings. Rendering it would put
 * an empty table under a full result count — a page that says a thousand
 * rows match and then reports that nothing does. Redirecting keeps the
 * count and the table telling the same story, and keeps the URL
 * shareable.
 *
 * Call it after the query has run: the last page is only knowable from
 * the total. Returns normally when the page is in range.
 */
export function redirectPastEnd(options: {
  basePath: string;
  params: Record<string, string | string[] | undefined>;
  page: number;
  pageSize: number;
  total: number;
}): void {
  const { basePath, params, page, pageSize, total } = options;
  if (total <= 0) return;

  const lastPage = Math.ceil(total / pageSize);
  if (page <= lastPage) return;

  const query = toSearchParams(params);
  // Page one is the default, so it is left out and the URL stays clean.
  if (lastPage > 1) query.set('page', String(lastPage));
  const search = query.toString();
  redirect(search ? `${basePath}?${search}` : basePath);
}
