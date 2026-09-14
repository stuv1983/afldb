'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

/**
 * Gives a table section an "Expand table" control that grows it to fill the
 * viewport (AFLDB-ISSUE-172) — a reusable, opt-in primitive, not a
 * `.table-wrap` retrofit (that convention is used on well over a hundred
 * pages; touching all of them is out of scope for this issue). Wired in for
 * the Coaches list only for now; other tables adopt it opportunistically,
 * and the Coaches page's own layout otherwise stays exactly as it was — the
 * full visual/layout review is a separate, later Claude Design pass.
 *
 * Deliberately CSS-only, not a React portal: `children` renders in exactly
 * one place in the component tree, on every render, expanded or not — only
 * a class toggles, switching the wrapper between its normal static position
 * and `position: fixed; inset: 0`. Nothing ever unmounts, so whatever state
 * already lives in `children` (an in-memory client sort, or a server-
 * rendered set of rows/links for a URL-driven filtered/sorted/paginated
 * table) survives expanding and collapsing untouched — there is no second
 * copy to keep in sync and no remount to lose it to. No ancestor of this
 * component sets `transform`/`filter`/`contain`, so `position: fixed` here
 * resolves against the real viewport, not some clipped ancestor box.
 *
 * The overlay/dialog behaviour (`role="dialog"`, Escape-to-close, a focus
 * trap, body-scroll lock, focus restored to the trigger on close) follows
 * the same convention already proven by `SiteNav.tsx`'s "More" sheet — not
 * a new interaction model, and not the Fullscreen API.
 */
export function ExpandableTableFrame({
  title,
  children,
}: {
  /** The expanded dialog's accessible name; the table itself is unchanged. */
  title: string;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  const panelId = useId();

  const close = useCallback((restore: boolean) => {
    restoreFocus.current = restore;
    setExpanded(false);
  }, []);

  useEffect(() => {
    if (!expanded) {
      if (restoreFocus.current) {
        triggerRef.current?.focus();
        restoreFocus.current = false;
      }
      return undefined;
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close(true);
        return;
      }
      if (event.key !== 'Tab') return;
      // Keep Tab inside the expanded view, the same trap SiteNav's sheet
      // uses: focus wandering to whatever now sits behind this fixed
      // overlay would be an inaccessible-drawer state.
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button, select, input, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panelRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [expanded, close]);

  return (
    <div
      ref={panelRef}
      className={expanded ? 'table-expand table-expand-open' : 'table-expand'}
      role={expanded ? 'dialog' : undefined}
      aria-modal={expanded ? true : undefined}
      aria-label={expanded ? title : undefined}
    >
      <div className="table-expand-bar">
        <button
          ref={triggerRef}
          type="button"
          className="table-expand-toggle"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => (expanded ? close(true) : setExpanded(true))}
        >
          {expanded ? 'Close expanded view' : 'Expand table'}
        </button>
      </div>
      <div id={panelId}>{children}</div>
    </div>
  );
}
