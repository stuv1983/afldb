'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * Public error boundary.
 *
 * Deliberately shows nothing about the cause: no SQL, hostnames, paths,
 * stack traces or environment values. Diagnostics stay server-side.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest correlates this page with the server log entry.
    console.error('[render] page failed', error.digest);
  }, [error]);

  return (
    <div className="empty">
      {/* An h1: this page's subject IS the message, the same way the 404's
          is. An empty table inside a larger page keeps its section's level. */}
      <h1>Something went wrong</h1>
      <p>This page could not be loaded. The problem has been logged.</p>
      <p className="empty-actions">
        <button className="btn" type="button" onClick={reset}>Try again</button>{' '}
        <Link className="btn btn-secondary" href="/">Search AFLDB</Link>
      </p>
      {error.digest && (
        <p className="empty-reference mono">Reference: {error.digest}</p>
      )}
    </div>
  );
}
