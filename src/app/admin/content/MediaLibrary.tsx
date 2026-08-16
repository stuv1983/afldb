'use client';

import { useActionState } from 'react';

import { deleteMedia, type ContentState } from '@/app/admin/content/actions';
import type { MediaRecord } from '@/db/queries/site-content';

/**
 * Every uploaded image, with a Delete beside each.
 *
 * This exists because uploading and referencing are separate steps: an image
 * is stored the moment it is chosen so the page can refer to it by name, which
 * means an upload that was never saved into a slot would otherwise be
 * invisible and unreachable. Listing them all is also the only way to see what
 * a publish is about to write.
 *
 * Deleting does not repoint any page slot. A slot still naming a deleted image
 * shows as “missing” in the editor above rather than silently reverting to a
 * stock screenshot nobody chose.
 */
export function MediaLibrary({ media }: { media: MediaRecord[] }) {
  const [state, action] = useActionState<ContentState, FormData>(deleteMedia, {});

  if (media.length === 0) {
    return (
      <section className="section">
        <h2>Uploaded images</h2>
        <p className="section-note">
          Nothing uploaded yet. The screenshots currently on the page ship with the
          repository; upload from any image slot above to replace one.
        </p>
      </section>
    );
  }

  return (
    <section className="section">
      <h2>Uploaded images</h2>
      <p className="section-note">
        Stored in the database and written to <code>img/u/</code> on publish. Deleting
        one removes it from the live page at the next publish; any slot still pointing
        at it is flagged above.
      </p>

      {state.message && <p className="notice">{state.message}</p>}
      {state.error && <p className="notice" role="alert">{state.error}</p>}

      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'grid',
          gap: '0.6rem',
          gridTemplateColumns: 'repeat(auto-fill, minmax(13rem, 1fr))',
        }}
      >
        {media.map((image) => (
          <li
            key={image.name}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              background: 'var(--bg-subtle)',
              padding: '0.55rem',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/admin/content/asset/img/u/${image.name}`}
              alt=""
              style={{
                width: '100%', height: 'auto', display: 'block',
                borderRadius: 'var(--radius)', marginBottom: '0.4rem',
              }}
            />
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', wordBreak: 'break-all' }}>
              {image.name}
            </div>
            <div className="muted" style={{ fontSize: '0.72rem' }}>
              {image.width}×{image.height} · {Math.round(image.byteSize / 1024)} kB
            </div>
            <form action={action} style={{ marginTop: '0.4rem' }}>
              <input type="hidden" name="name" value={image.name} />
              <button className="btn btn-secondary" type="submit">Delete</button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
