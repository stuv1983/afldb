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
      <h2>Something went wrong</h2>
      <p>This page could not be loaded. The problem has been logged.</p>
      <p style={{ marginTop: '1rem' }}>
        <button className="btn" type="button" onClick={reset}>Try again</button>{' '}
        <Link className="btn btn-secondary" href="/">Go to search</Link>
      </p>
      {error.digest && (
        <p className="muted mono" style={{ marginTop: '1.5rem', fontSize: '0.75rem' }}>
          Reference: {error.digest}
        </p>
      )}
    </div>
  );
}
