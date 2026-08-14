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
 */

export const PRIMARY_NAV = [
  { href: '/players', label: 'Players' },
  { href: '/clubs', label: 'Clubs' },
  { href: '/seasons', label: 'Seasons' },
  { href: '/records', label: 'Records' },
  { href: '/brownlow', label: 'Brownlow' },
  { href: '/awards', label: 'Awards' },
  { href: '/advanced-search', label: 'Player Search' },
  { href: '/match-search', label: 'Match Search' },
  { href: '/aflw', label: 'AFLW' },
];

const TABS = [
  { href: '/', label: 'Home' },
  { href: '/players', label: 'Players' },
  { href: '/seasons', label: 'Seasons' },
  { href: '/records', label: 'Records' },
  { href: '/aflw', label: 'AFLW' },
];

/** True for the section's own page and anything beneath it. */
function isCurrent(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PrimaryNav() {
  const pathname = usePathname();

  return (
    <nav className="site-nav" aria-label="Primary">
      {PRIMARY_NAV.map((item) => (
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

  return (
    <nav className="tab-bar" aria-label="Sections">
      {TABS.map((item) => (
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
