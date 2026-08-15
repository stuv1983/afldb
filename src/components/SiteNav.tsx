'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Primary navigation, in two presentations of the same routes.
 *
 * The masthead carries the full set on a wide screen; on a phone that row
 * is hidden and the four most-travelled sections sit in a fixed bar within
 * thumb reach instead. Both mark the current section, which is the only
 * reason these are client components.
 *
 * The competition switches the whole nav, not just one link: once a reader
 * is anywhere under /aflw, AFLW doesn't have Records/Brownlow/Awards/Draft
 * equivalents, so showing the AFL versions of those would 404-adjacent
 * dead-end them. Instead the nav swaps wholesale to the AFLW route set,
 * with a link back to AFL playing the role AFLW plays in the AFL nav.
 */

export const PRIMARY_NAV = [
  { href: '/players', label: 'Players' },
  { href: '/clubs', label: 'Clubs' },
  { href: '/seasons', label: 'Seasons' },
  { href: '/records', label: 'Records' },
  { href: '/brownlow', label: 'Brownlow' },
  { href: '/awards', label: 'Awards' },
  { href: '/draft', label: 'Draft' },
  // No separate "Player Search": Players IS the search — the index carries
  // the whole career filter set that Advanced Player Search used to.
  { href: '/match-search', label: 'Match Search' },
  { href: '/aflw', label: 'AFLW' },
];

export const AFLW_PRIMARY_NAV = [
  { href: '/aflw/players', label: 'Players' },
  { href: '/aflw/clubs', label: 'Clubs' },
  { href: '/aflw/seasons', label: 'Seasons' },
  { href: '/aflw/venues', label: 'Venues' },
  { href: '/aflw/match-search', label: 'Match Search' },
  { href: '/', label: 'AFL' },
];

const TABS = [
  { href: '/', label: 'Home' },
  { href: '/players', label: 'Players' },
  { href: '/seasons', label: 'Seasons' },
  { href: '/records', label: 'Records' },
  { href: '/aflw', label: 'AFLW' },
];

const AFLW_TABS = [
  { href: '/aflw', label: 'Home' },
  { href: '/aflw/players', label: 'Players' },
  { href: '/aflw/seasons', label: 'Seasons' },
  { href: '/aflw/clubs', label: 'Clubs' },
  { href: '/', label: 'AFL' },
];

function inAflw(pathname: string): boolean {
  return pathname === '/aflw' || pathname.startsWith('/aflw/');
}

/** True for the section's own page and anything beneath it. */
function isCurrent(pathname: string, href: string): boolean {
  // '/' and '/aflw' are each a section root as well as that section's own
  // "Home" tab; matching by prefix would keep Home lit up on every page
  // below it too, alongside whichever tab is actually current.
  if (href === '/' || href === '/aflw') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PrimaryNav() {
  const pathname = usePathname();
  const items = inAflw(pathname) ? AFLW_PRIMARY_NAV : PRIMARY_NAV;

  return (
    <nav className="site-nav" aria-label="Primary">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={isCurrent(pathname, item.href) ? 'page' : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function TabBar() {
  const pathname = usePathname();
  const items = inAflw(pathname) ? AFLW_TABS : TABS;

  return (
    <nav className="tab-bar" aria-label="Sections">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={isCurrent(pathname, item.href) ? 'page' : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
