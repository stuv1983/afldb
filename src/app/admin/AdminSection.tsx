'use client';

import { useEffect, useState } from 'react';

/**
 * One collapsible section of a long admin form.
 *
 * The content editor is eight sections and some nine hundred lines of form;
 * the settings screen is not much shorter. Editing the footer meant scrolling
 * past the whole page's copy, and finding the hero statistics meant scrolling
 * past the footer. Sections that fold solve that, and folding is only useful
 * if it STAYS folded — so each one remembers its own state under its own key,
 * and a person who only ever touches the hero can leave everything else shut.
 *
 * `<details>`, not a div and a state variable, so the section still works
 * before hydration, keyboard support comes from the browser, and — the part
 * that matters inside a form — the fields stay in the DOM while collapsed and
 * therefore still submit. A React-conditional section would silently drop
 * everything the author had typed into it.
 *
 * The stored state is read in an effect for the reason `AdminNav` gives: the
 * server cannot see localStorage, so consulting it during render would hydrate
 * a tree different from the one that was sent.
 */

const STORAGE_PREFIX = 'afldb.admin.section.';

export function AdminSection({
  id,
  title,
  note,
  defaultOpen = true,
  children,
}: {
  /** Stable across renders and deploys: it is the storage key. */
  id: string;
  title: string;
  /** A word or two beside the heading, e.g. how many cards are inside. */
  note?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_PREFIX + id);
      if (stored === 'open' || stored === 'closed') setOpen(stored === 'open');
    } catch {
      // Storage unavailable; the default stands.
    }
  }, [id]);

  function remember(next: boolean) {
    setOpen(next);
    try {
      window.localStorage.setItem(STORAGE_PREFIX + id, next ? 'open' : 'closed');
    } catch {
      // As above: the choice still applies to this page view.
    }
  }

  return (
    <details
      className="section admin-section"
      open={open}
      // onToggle rather than an onClick on the summary: the element can also
      // be opened by find-in-page and by the keyboard, and both go through
      // the toggle event only.
      onToggle={(event) => {
        const isOpen = (event.currentTarget as HTMLDetailsElement).open;
        if (isOpen !== open) remember(isOpen);
      }}
    >
      <summary>
        <h2>{title}</h2>
        {note && <span className="admin-section-note">{note}</span>}
      </summary>
      <div className="admin-section-body">{children}</div>
    </details>
  );
}
