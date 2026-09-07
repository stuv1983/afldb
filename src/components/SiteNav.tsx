'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import {
  AFLW_PRIMARY_NAV,
  AFLW_QUICK_TABS,
  PRIMARY_NAV,
  QUICK_TABS,
  inAflw,
  isCurrentSection,
} from '@/lib/site-nav-model';

/**
 * Primary navigation, in two presentations of ONE set of routes
 * (`src/lib/site-nav-model.ts`).
 *
 * The masthead renders the whole list on a wide screen; on a phone that
 * row is hidden and a fixed bar of the four most-travelled sections sits
 * within thumb reach, with a "More" button that opens a sheet listing the
 * SAME full list. Nothing can be reachable from the desktop nav and not
 * the phone: both the masthead and the sheet map `PRIMARY_NAV` directly,
 * and `tests/e2e/responsive-nav` asserts every entry is reachable at
 * mobile width.
 *
 * These are client components only because they mark the current section.
 */

// Re-exported for continuity; the source of truth is the model module.
export { PRIMARY_NAV, AFLW_PRIMARY_NAV, BROWSE_SECTIONS } from '@/lib/site-nav-model';

export function PrimaryNav() {
  const pathname = usePathname();
  const items = inAflw(pathname) ? AFLW_PRIMARY_NAV : PRIMARY_NAV;

  return (
    <nav className="site-nav" aria-label="Primary">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          prefetch={false}
          aria-current={isCurrentSection(pathname, item.href) ? 'page' : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function TabBar() {
  const pathname = usePathname();
  const aflw = inAflw(pathname);
  const quick = aflw ? AFLW_QUICK_TABS : QUICK_TABS;
  const full = aflw ? AFLW_PRIMARY_NAV : PRIMARY_NAV;

  const [open, setOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  const panelId = useId();

  const close = useCallback((restore: boolean) => {
    restoreFocus.current = restore;
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) {
      if (restoreFocus.current) {
        moreRef.current?.focus();
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
      // Keep Tab inside the panel: it is a modal sheet over a
      // scroll-locked page, and focus wandering to the content behind the
      // backdrop is the "inaccessible drawer state" this needs to avoid.
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>('a[href], button');
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
    // A link in the sheet closes it in its own onClick; this covers a
    // navigation the sheet did not start (Android back, a browser
    // gesture) so it cannot be left hanging over the next page.
    const onPop = () => close(false);
    document.addEventListener('keydown', onKey);
    window.addEventListener('popstate', onPop);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Move focus into the sheet so a keyboard or screen-reader user is
    // taken to it rather than left on the bar behind the backdrop.
    panelRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, close]);

  return (
    <>
      <nav className="tab-bar" aria-label="Sections">
        {quick.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            aria-current={isCurrentSection(pathname, item.href) ? 'page' : undefined}
          >
            {item.label}
          </Link>
        ))}
        <button
          ref={moreRef}
          type="button"
          className="tab-more"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => (open ? close(true) : setOpen(true))}
        >
          More
        </button>
      </nav>

      {open && (
        <div
          className="nav-sheet"
          onClick={(event) => {
            if (event.target === event.currentTarget) close(true);
          }}
        >
          <div
            ref={panelRef}
            id={panelId}
            className="nav-sheet-panel"
            role="dialog"
            aria-modal="true"
            aria-label="All sections"
          >
            <div className="nav-sheet-head">
              <span>All sections</span>
              <button type="button" className="nav-sheet-close" onClick={() => close(true)}>
                Close
              </button>
            </div>
            <div className="nav-sheet-list">
              {full.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  aria-current={isCurrentSection(pathname, item.href) ? 'page' : undefined}
                  onClick={() => close(false)}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
