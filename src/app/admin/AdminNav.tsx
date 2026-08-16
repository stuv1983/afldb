'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { adminLogout } from '@/app/admin/logout-action';
import {
  isCurrentAdminPath,
  type AdminNavGroup,
} from '@/app/admin/nav-model';

/**
 * The admin sidebar.
 *
 * The admin area used to navigate from a single row of interpuncted links in
 * the breadcrumb slot. That worked while there were four destinations; there
 * are now ten across four unrelated concerns, and a flat row gives no clue
 * which of them is which — "Beta access" and "Page content" read as peers of
 * "Upload" when one is people, one is publishing and one is data.
 *
 * So: grouped, down the side, with the current page marked. Collapsing is
 * REMEMBERED rather than reset per page, because the reason to collapse it is
 * a wide form (the content editor, the settings screen) and those are exactly
 * the pages a person moves between while working. Held in localStorage rather
 * than a cookie: it is a display preference, it never needs to reach the
 * server, and a cookie would make every admin response vary on it.
 *
 * Read in an effect rather than during render. The server has no localStorage,
 * so consulting it while rendering would hydrate a different tree than was
 * sent; the cost of doing it properly is one frame with the sidebar open,
 * which is the state most people want anyway.
 */

const STORAGE_KEY = 'afldb.admin.nav';

export function AdminNav({
  groups,
  email,
  roleLabel,
}: {
  groups: AdminNavGroup[];
  email: string;
  roleLabel: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      // Default to collapsed on a narrow screen, where a 15rem sidebar above
      // the page would push the actual work off the first screenful.
      if (stored === 'open' || stored === 'closed') setOpen(stored === 'open');
      else setOpen(window.innerWidth > 760);
    } catch {
      // Private browsing, or storage disabled. The default stands.
    }
    setReady(true);
  }, []);

  function toggle() {
    setOpen((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? 'open' : 'closed');
      } catch {
        // Not being able to remember the choice does not stop it being made.
      }
      return next;
    });
  }

  return (
    <nav
      className={`admin-nav${open ? '' : ' collapsed'}`}
      aria-label="Admin sections"
      // Until the stored preference has been read, the sidebar is in its
      // server-rendered state and a transition would animate a value nobody
      // chose. See `.admin-nav:not(.ready)` in globals.css.
      data-ready={ready ? 'yes' : 'no'}
    >
      <div className="admin-nav-head">
        <button
          type="button"
          className="admin-nav-toggle"
          onClick={toggle}
          aria-expanded={open}
          aria-controls="admin-nav-body"
          title={open ? 'Collapse the menu' : 'Expand the menu'}
        >
          <span aria-hidden="true">{open ? '«' : '»'}</span>
          <span className="visually-hidden">
            {open ? 'Collapse the admin menu' : 'Expand the admin menu'}
          </span>
        </button>
        {open && <span className="admin-nav-brand">Admin</span>}
      </div>

      <div id="admin-nav-body" className="admin-nav-body" hidden={!open}>
        {groups.map((group) => (
          <div key={group.id} className="admin-nav-group">
            <h2 className="admin-nav-group-label">{group.label}</h2>
            <ul>
              {group.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={isCurrentAdminPath(pathname, link) ? 'page' : undefined}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div className="admin-nav-group admin-nav-foot">
          <p className="admin-nav-who">
            {email}
            <span>{roleLabel}</span>
          </p>
          <ul>
            <li><Link href="/">View site</Link></li>
          </ul>
          {/* A server action in a client component: the form posts to it
              directly, so signing out needs no route of its own. */}
          <form action={adminLogout}>
            <button className="btn btn-secondary" type="submit">Sign out</button>
          </form>
        </div>
      </div>
    </nav>
  );
}
