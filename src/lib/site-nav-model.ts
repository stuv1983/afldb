/**
 * The canonical public navigation model — one list of primary
 * destinations, consumed by both presentations of the site nav
 * (`SiteNav.tsx`: the wide-screen masthead and the phone bar + "More"
 * sheet) and by the home "Browse the record" grid (`app/page.tsx`).
 *
 * A plain module, deliberately not `'use client'`: a Server Component
 * that imports from a client module gets a reference proxy rather than
 * the real exported value, so the home grid's `BROWSE_SECTIONS.map` would
 * fail at build time. Keeping the data here lets the server page and the
 * client nav share exactly the same source.
 *
 * The rule this enforces: a destination cannot be reachable from the
 * desktop nav and not the phone nav. Both map `PRIMARY_NAV`; the phone
 * "More" sheet renders the whole list, and `tests/e2e/responsive-nav`
 * asserts parity against what the masthead actually renders.
 */

export type NavItem = { href: string; label: string };

export const PRIMARY_NAV: NavItem[] = [
  { href: '/players', label: 'Players' },
  { href: '/clubs', label: 'Clubs' },
  { href: '/seasons', label: 'Seasons' },
  { href: '/venues', label: 'Venues' },
  { href: '/records', label: 'Records' },
  { href: '/coaches', label: 'Coaches' },
  { href: '/awards', label: 'Awards' },
  { href: '/draft', label: 'Draft' },
  // No separate "Player Search": Players IS the search — the index carries
  // the whole career filter set that Advanced Player Search used to.
  //
  // Brownlow and Match Search are deliberately NOT top-level items
  // (AFLDB-ISSUE-172): Brownlow is discoverable from Awards, and Match
  // Search overlaps the Players filter set. Both routes stay live and
  // both keep their home "Browse the record" tile — see
  // `BROWSE_ONLY_LABELS` below, which is what keeps that tile from
  // disappearing along with the nav entry.
  { href: '/aflw', label: 'AFLW' },
];

/**
 * Under /aflw the nav swaps wholesale: AFLW has no Records/Brownlow/
 * Awards/Draft equivalents, so showing the AFL versions would dead-end
 * the reader. "AFL" plays the role AFLW plays in the AFL nav.
 */
export const AFLW_PRIMARY_NAV: NavItem[] = [
  { href: '/aflw/players', label: 'Players' },
  { href: '/aflw/clubs', label: 'Clubs' },
  { href: '/aflw/seasons', label: 'Seasons' },
  { href: '/aflw/venues', label: 'Venues' },
  { href: '/aflw/match-search', label: 'Match Search' },
  { href: '/', label: 'AFL' },
];

/**
 * The four sections that get a one-tap slot in the phone bar; the rest of
 * `PRIMARY_NAV` is one tap further, behind "More". Home is the bar's own
 * first slot, not a `PRIMARY_NAV` entry.
 */
export const QUICK_TABS: NavItem[] = [
  { href: '/', label: 'Home' },
  { href: '/players', label: 'Players' },
  { href: '/clubs', label: 'Clubs' },
  { href: '/seasons', label: 'Seasons' },
];

export const AFLW_QUICK_TABS: NavItem[] = [
  { href: '/aflw', label: 'Home' },
  { href: '/aflw/players', label: 'Players' },
  { href: '/aflw/clubs', label: 'Clubs' },
  { href: '/aflw/seasons', label: 'Seasons' },
];

/**
 * Blurbs for the home "Browse the record" grid, and this map's own keys
 * are what decide grid membership and order (see `BROWSE_SECTIONS`) — not
 * `PRIMARY_NAV` membership. A route with no blurb here is simply left off
 * the grid; a route absent from `PRIMARY_NAV` can still appear (its label
 * comes from `BROWSE_ONLY_LABELS`). AFLW is a mode switch, not a "record"
 * section, so it has none.
 */
const BROWSE_META: Record<string, string> = {
  '/players': 'Every player since 1897, filtered by career statistics',
  '/clubs': 'Current and historical clubs',
  '/seasons': 'Ladders, results and finals',
  '/venues': 'Every ground since 1897, and the matches played there',
  '/records': 'Career, season and single-game',
  '/coaches': 'Every coach, and their match record',
  '/brownlow': 'Vote counts by season',
  '/awards': 'All-Australian, Rising Star, Hall of Fame',
  '/draft': 'Every selection, by year and club',
  '/match-search': 'Find games by scoreline and margin',
};

/**
 * Labels for a browse tile whose route is no longer a `PRIMARY_NAV` entry
 * (AFLDB-ISSUE-172). Deliberately the minimum needed — not a second copy
 * of the nav model — so `BROWSE_SECTIONS` below stays sourced from
 * `BROWSE_META` (membership and order) with `PRIMARY_NAV` only consulted
 * first, this map second, for the label.
 */
const BROWSE_ONLY_LABELS: Record<string, string> = {
  '/brownlow': 'Brownlow',
  '/match-search': 'Match Search',
};

export const BROWSE_SECTIONS: (NavItem & { meta: string })[] = Object.entries(BROWSE_META)
  .map(([href, meta]) => {
    const label = PRIMARY_NAV.find((item) => item.href === href)?.label ?? BROWSE_ONLY_LABELS[href];
    return label ? { href, label, meta } : null;
  })
  .filter((item): item is NavItem & { meta: string } => item !== null);

export function inAflw(pathname: string): boolean {
  return pathname === '/aflw' || pathname.startsWith('/aflw/');
}

/** True for the section's own page and anything beneath it. */
export function isCurrentSection(pathname: string, href: string): boolean {
  // '/' and '/aflw' are each a section root as well as that section's own
  // "Home" tab; matching by prefix would keep Home lit on every page below.
  if (href === '/' || href === '/aflw') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
