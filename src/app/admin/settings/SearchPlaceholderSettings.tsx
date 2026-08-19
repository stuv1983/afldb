'use client';

import { useEffect, useState } from 'react';

import { AdminSection } from '@/app/admin/AdminSection';
import {
  SEARCH_ANIMATIONS,
  type SearchAnimationType,
} from '@/lib/site-settings';

/**
 * Super Admin editor for dynamic search box placeholders & fillout animation (see changeLog.md).
 * Includes an interactive live preview so the administrator can test typing/fade/slide animations.
 */
export function SearchPlaceholderSettings({
  placeholdersAfl,
  placeholdersAflw,
  intervalSeconds,
  animation,
}: {
  placeholdersAfl: string[];
  placeholdersAflw: string[];
  intervalSeconds: number;
  animation: SearchAnimationType;
}) {
  const [aflText, setAflText] = useState(placeholdersAfl.join('\n'));
  const [aflwText, setAflwText] = useState(placeholdersAflw.join('\n'));
  const [interval, setIntervalVal] = useState(intervalSeconds);
  const [selectedAnimation, setSelectedAnimation] = useState<SearchAnimationType>(animation);
  const [previewScope, setPreviewScope] = useState<'afl' | 'aflw'>('afl');

  // Preview animation state
  const currentList = (previewScope === 'afl' ? aflText : aflwText)
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const effectiveList = currentList.length > 0 ? currentList : ['Search…'];

  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewText, setPreviewText] = useState(effectiveList[0] ?? '');
  const [isTyping, setIsTyping] = useState(true);

  useEffect(() => {
    setPreviewIndex(0);
    setPreviewText(effectiveList[0] ?? '');
  }, [previewScope, aflText, aflwText]);

  useEffect(() => {
    const target = effectiveList[previewIndex % effectiveList.length] ?? '';

    if (selectedAnimation === 'typewriter') {
      let charIdx = 0;
      let isDeleting = false;
      let timeoutId: NodeJS.Timeout;

      function step() {
        if (!isDeleting) {
          charIdx++;
          setPreviewText(target.slice(0, charIdx));
          if (charIdx >= target.length) {
            isDeleting = true;
            timeoutId = setTimeout(step, Math.max(1000, interval * 1000));
          } else {
            timeoutId = setTimeout(step, 40);
          }
        } else {
          charIdx--;
          setPreviewText(target.slice(0, charIdx));
          if (charIdx <= 0) {
            isDeleting = false;
            setPreviewIndex((prev) => (prev + 1) % effectiveList.length);
          } else {
            timeoutId = setTimeout(step, 25);
          }
        }
      }

      timeoutId = setTimeout(step, 100);
      return () => clearTimeout(timeoutId);
    } else {
      setPreviewText(target);
      const timer = setTimeout(() => {
        setPreviewIndex((prev) => (prev + 1) % effectiveList.length);
      }, Math.max(1000, interval * 1000));
      return () => clearTimeout(timer);
    }
  }, [previewIndex, selectedAnimation, interval, effectiveList]);

  return (
    <AdminSection id="settings-search-placeholders" title="Search box placeholders & animation">
      <p className="section-note">
        Configure rotating sample queries displayed in the main AFL and AFLW search boxes,
        the rotation interval, and the placeholder animation style.
      </p>

      {/* Live Preview Box */}
      <div
        style={{
          background: 'var(--bg-subtle)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <strong style={{ fontSize: '0.88rem' }}>Live Animation Preview</strong>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className={`btn btn-small ${previewScope === 'afl' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setPreviewScope('afl')}
              style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
            >
              AFL Preview
            </button>
            <button
              type="button"
              className={`btn btn-small ${previewScope === 'aflw' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setPreviewScope('aflw')}
              style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
            >
              AFLW Preview
            </button>
          </div>
        </div>

        <div style={{ position: 'relative', maxWidth: '540px' }}>
          <input
            type="text"
            readOnly
            placeholder={previewText + (selectedAnimation === 'typewriter' ? '▍' : '')}
            style={{
              width: '100%',
              padding: '0.65rem 1rem',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border-strong)',
              background: 'var(--bg-raised)',
              fontSize: '0.95rem',
              transition: selectedAnimation === 'fade' ? 'all 0.4s ease' : undefined,
            }}
          />
        </div>
        <p className="muted" style={{ fontSize: '0.75rem', marginTop: '0.4rem', marginBottom: 0 }}>
          Simulating {selectedAnimation} mode with a {interval}s rotation period.
        </p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.25rem' }}>
        <div>
          <label htmlFor="searchPlaceholdersAfl">
            AFL search sample queries
            <span className="muted" style={{ display: 'block', fontSize: '0.75rem', fontWeight: 'normal' }}>
              One query per line. These will rotate in the global and home search boxes.
            </span>
          </label>
          <textarea
            id="searchPlaceholdersAfl"
            name="searchPlaceholdersAfl"
            rows={6}
            value={aflText}
            onChange={(e) => setAflText(e.target.value)}
            style={{
              width: '100%',
              fontFamily: 'monospace',
              fontSize: '0.85rem',
              lineHeight: 1.4,
              padding: '0.5rem',
            }}
          />
        </div>

        <div>
          <label htmlFor="searchPlaceholdersAflw">
            AFLW search sample queries
            <span className="muted" style={{ display: 'block', fontSize: '0.75rem', fontWeight: 'normal' }}>
              One query per line. These will rotate in the AFLW search boxes.
            </span>
          </label>
          <textarea
            id="searchPlaceholdersAflw"
            name="searchPlaceholdersAflw"
            rows={6}
            value={aflwText}
            onChange={(e) => setAflwText(e.target.value)}
            style={{
              width: '100%',
              fontFamily: 'monospace',
              fontSize: '0.85rem',
              lineHeight: 1.4,
              padding: '0.5rem',
            }}
          />
        </div>
      </div>

      <div style={{ marginTop: '1.25rem' }}>
        <label htmlFor="searchPlaceholderInterval">
          Rotation interval (seconds)
        </label>
        <input
          id="searchPlaceholderInterval"
          name="searchPlaceholderInterval"
          type="number"
          min={2}
          max={60}
          value={interval}
          onChange={(e) => setIntervalVal(Math.max(2, Math.min(60, Number(e.target.value) || 5)))}
          style={{ width: '120px', display: 'block', marginBottom: '1.25rem' }}
        />

        <label style={{ display: 'block', marginBottom: '0.5rem' }}>
          Placeholder fillout animation
        </label>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.5rem' }}>
          {SEARCH_ANIMATIONS.map((anim) => (
            <label
              key={anim.value}
              style={{
                display: 'block',
                padding: '0.5rem 0.75rem',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                background: selectedAnimation === anim.value ? 'var(--bg-hover)' : 'var(--bg-subtle)',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="searchPlaceholderAnimation"
                value={anim.value}
                checked={selectedAnimation === anim.value}
                onChange={() => setSelectedAnimation(anim.value)}
                style={{ marginRight: '0.45rem' }}
              />
              <strong>{anim.label}</strong>
              <span className="muted" style={{ display: 'block', fontSize: '0.75rem', marginTop: '0.2rem' }}>
                {anim.help}
              </span>
            </label>
          ))}
        </div>
      </div>
    </AdminSection>
  );
}
