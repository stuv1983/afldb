'use client';

import { useRef, useState } from 'react';

import { CONTENT_LIMITS, uploadedSrc, type ApexImage } from '@/lib/site-content';

/**
 * One image slot on the coming-soon page: pick an existing image, upload a
 * replacement, and write its alternative text.
 *
 * Uploading posts to /admin/content/media rather than going through the form
 * that surrounds this component, because an image has to be stored before the
 * page can reference it — the reference is a name, and the name is assigned by
 * the server from the file's sniffed format. The upload is therefore immediate
 * and the page reference is what Save writes.
 *
 * A consequence worth stating: an uploaded image that is never referenced and
 * never saved still exists in `site_media`. That is why the editor lists every
 * upload with a Delete beside it.
 */

export type ImageOption = {
  src: string;
  width: number;
  height: number;
  /** Where it came from, which is also whether a publish may prune it. */
  kind: 'shipped' | 'uploaded';
  /** Default alternative text, offered when a slot has none of its own. */
  alt?: string;
};

export function ImageField({
  label,
  help,
  value,
  options,
  optional = false,
  onChange,
  onUploaded,
}: {
  label: string;
  help?: string;
  value: ApexImage | null;
  options: ImageOption[];
  optional?: boolean;
  onChange: (image: ApexImage | null) => void;
  onUploaded: (option: ImageOption) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const missing = value !== null && !options.some((option) => option.src === value.src);

  function select(src: string) {
    if (!src) {
      onChange(null);
      return;
    }
    const option = options.find((candidate) => candidate.src === src);
    if (!option) return;
    onChange({
      src: option.src,
      // Keep whatever description the slot already had — the admin may have
      // written it for this slot rather than for the file — and fall back to
      // the image's own default only when there is nothing to keep.
      alt: value?.alt || option.alt || '',
      width: option.width,
      height: option.height,
    });
  }

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set('file', file);
      body.set('name', file.name);
      if (value?.alt) body.set('alt', value.alt);

      const response = await fetch('/admin/content/media', { method: 'POST', body });
      const payload = await response.json() as {
        name?: string; width?: number; height?: number; error?: string;
      };

      if (!response.ok || !payload.name) {
        setError(payload.error ?? 'Upload failed.');
        return;
      }

      const option: ImageOption = {
        src: uploadedSrc(payload.name),
        width: payload.width ?? 0,
        height: payload.height ?? 0,
        kind: 'uploaded',
      };
      onUploaded(option);
      onChange({
        src: option.src,
        alt: value?.alt ?? '',
        width: option.width,
        height: option.height,
      });
    } catch {
      setError('Upload failed — the server did not respond.');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  const megabytes = Math.round(CONTENT_LIMITS.mediaBytes / 1024 / 1024);

  return (
    <fieldset
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '0.7rem',
        margin: '0 0 0.75rem',
      }}
    >
      <legend style={{ fontSize: '0.8rem', padding: '0 0.35rem' }}>{label}</legend>

      {help && (
        <p className="muted" style={{ fontSize: '0.78rem', margin: '0 0 0.5rem' }}>{help}</p>
      )}

      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
        <div
          style={{
            flex: '0 0 8rem',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            background: 'var(--bg-subtle)',
            minHeight: '5rem',
            display: 'grid',
            placeItems: 'center',
            overflow: 'hidden',
          }}
        >
          {value
            ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/admin/content/asset${value.src}`}
                alt=""
                style={{ maxWidth: '100%', height: 'auto', display: 'block' }}
              />
            )
            : <span className="muted" style={{ fontSize: '0.75rem' }}>No image</span>}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <select
            value={value?.src ?? ''}
            onChange={(event) => select(event.target.value)}
            aria-label={`${label} — image`}
          >
            {optional && <option value="">No image</option>}
            {missing && value && (
              <option value={value.src}>{value.src} — missing</option>
            )}
            {options.map((option) => (
              <option key={option.src} value={option.src}>
                {option.src.replace('/img/', '')}
                {option.kind === 'uploaded' ? ' (uploaded)' : ''}
                {option.width > 0 ? ` — ${option.width}×${option.height}` : ''}
              </option>
            ))}
          </select>

          {missing && (
            <p className="muted" style={{ fontSize: '0.78rem', margin: '0.35rem 0 0' }}>
              This slot points at <code>{value?.src}</code>, which no longer exists.
              Pick another image, or the published page will show a broken one.
            </p>
          )}

          <div style={{ marginTop: '0.5rem' }}>
            <label htmlFor={`${label}-alt`}>Alternative text</label>
            <input
              id={`${label}-alt`}
              value={value?.alt ?? ''}
              maxLength={CONTENT_LIMITS.altChars}
              disabled={value === null}
              placeholder="What the image shows, for a reader who cannot see it"
              onChange={(event) => value && onChange({ ...value, alt: event.target.value })}
            />
          </div>

          <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy}
              style={{ fontSize: '0.78rem' }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            {busy && <span className="muted" style={{ fontSize: '0.78rem' }}>Uploading…</span>}
          </div>

          <p className="muted" style={{ fontSize: '0.75rem', margin: '0.35rem 0 0' }}>
            PNG, JPEG or WebP, up to {megabytes} MB. WebP keeps a screenshot small.
            Uploading a file whose name matches an existing upload replaces it everywhere.
          </p>

          {error && (
            <p style={{ color: 'var(--danger, crimson)', fontSize: '0.8rem', margin: '0.35rem 0 0' }}>
              {error}
            </p>
          )}
        </div>
      </div>
    </fieldset>
  );
}
