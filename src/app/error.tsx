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

    // Best-effort: this boundary firing means something genuinely broke a
    // reader's page, which is exactly the category app_health_events
    // exists to separate from a recoverable hydration mismatch (see
    // src/db/queries/app-health.ts). A failed report must not compound
    // the render failure already in front of the reader.
    const payload = JSON.stringify({
      eventType: 'PAGE_CRASH',
      route: window.location.pathname,
      detail: error.digest ? `digest: ${error.digest}` : (error.message || 'unknown error').slice(0, 500),
    });
    try {
      if (typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon('/api/health-event', new Blob([payload], { type: 'application/json' }));
      } else {
        fetch('/api/health-event', {
          method: 'POST', body: payload, keepalive: true, headers: { 'Content-Type': 'application/json' },
        }).catch(() => {});
      }
    } catch {
      // Never let telemetry be the reason an already-broken page throws again.
    }
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
