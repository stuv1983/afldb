'use client';

import { useActionState } from 'react';

import { republishApex, type ContentState } from '@/app/admin/content/actions';

/**
 * Where the page publishes to, when it last did, and a button to do it again.
 *
 * Republishing is the recovery path, and it is deliberately separate from
 * Save: it rebuilds `/var/www/afldb-soon` from what is already in the
 * database without writing anything new to it. That covers the three cases
 * Save does not — a rebuilt server, a deleted published directory, and a
 * deploy that changed `style.css` or a shipped screenshot, since those come
 * from git rather than from the database and only reach the apex on a publish.
 */
export function PublishPanel({
  configured,
  target,
  templateFound,
  templateDir,
  lastPublishedAt,
  writable,
  remedy,
}: {
  configured: boolean;
  target: string | null;
  templateFound: boolean;
  templateDir: string;
  lastPublishedAt: string | null;
  /** Empty when the directory is fine; otherwise why it is not. */
  writable: string;
  /** The shell that repairs it, or null. */
  remedy: string | null;
}) {
  const [state, action, publishing] = useActionState<ContentState, FormData>(republishApex, {});

  return (
    <form action={action} className="section">
      <h2>Publishing</h2>

      {/* Ahead of the button, not after it. A publish that is going to fail on
          permissions fails the same way every time, and the author should not
          have to write a page of copy to discover it. */}
      {configured && writable && (
        <div className="notice" role="alert">
          <p style={{ margin: 0 }}><strong>The page cannot be published.</strong> {writable}</p>
          {remedy && (
            <>
              <p style={{ margin: '0.6rem 0 0.3rem' }}>On the server, as a user with sudo:</p>
              <pre className="code-block"><code>{remedy}</code></pre>
            </>
          )}
        </div>
      )}

      {configured ? (
        <p className="section-note">
          The page is written to <code>{target}</code>, which Caddy serves as static
          files. Saving publishes automatically; the application is the page’s
          publisher, never its server, so <code>afldb.com</code> keeps serving even
          when this application is down.
        </p>
      ) : (
        <p className="section-note">
          <strong>Not publishing on this host.</strong> <code>AFLDB_APEX_DIR</code> is
          not set, so there is nowhere to write the page. Edits are still saved to the
          database, and the preview below renders them. This is the normal state on a
          development machine.
        </p>
      )}

      {configured && !templateFound && (
        <p className="notice" role="alert">
          The page assets are missing from <code>{templateDir}</code>. Publishing will
          fail until <code>deploy/coming-soon</code> is present — run{' '}
          <code>npm run build</code>, which copies it beside the standalone server.
        </p>
      )}

      <p className="muted" style={{ fontSize: '0.82rem' }}>
        {lastPublishedAt
          ? `Last published ${lastPublishedAt}.`
          : configured
            ? 'Never published from this application.'
            : ''}
      </p>

      {state.message && <p className="notice">{state.message}</p>}
      {state.error && <p className="notice notice-pre" role="alert">{state.error}</p>}

      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
        <button className="btn btn-secondary" type="submit" disabled={publishing || !configured}>
          {publishing ? 'Publishing…' : 'Republish now'}
        </button>
        <a
          className="btn btn-secondary"
          href="/admin/content/preview"
          target="_blank"
          rel="noreferrer"
        >
          Preview →
        </a>
      </div>
    </form>
  );
}
