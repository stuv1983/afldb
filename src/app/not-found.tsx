import type { Metadata } from 'next';
import Link from 'next/link';

/**
 * Rendered with a real HTTP 404, which is what every `notFound()` call on
 * the site produces. It is explicitly `noindex` as well: the status code is
 * the control that matters, but a 404 body that is reachable at a URL a
 * crawler retries should not be a candidate for indexing on the retry.
 */
export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="empty">
      {/* An h1, not an h2: this is the page's own subject, and the site's
          only page whose <h1> was missing entirely. */}
      <h1>Page not found</h1>
      <p>
        That player, club, season or match isn’t in AFLDB — the address may be
        mistyped or out of date.
      </p>
      <p style={{ marginTop: '1rem' }}>
        <Link className="btn" href="/">Search AFL history</Link>
      </p>
    </div>
  );
}
