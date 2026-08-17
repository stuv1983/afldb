/**
 * What the admin sidebar contains, for a given signed-in staff member.
 *
 * Pure and free of `server-only` imports on purpose: the layout (a Server
 * Component) calls it to build the list, and `AdminNav` (a Client Component)
 * receives the result. Keeping the model here rather than inside either one
 * means the ROUTES and the ROLES that may see them are stated once, in a
 * file that can be read top to bottom, instead of being spelt out in JSX
 * conditionals the way the old single-line breadcrumb bar spelt them out.
 *
 * This is furniture, never a gate. Every page still calls its own
 * `requireAdmin` / `requireSuperAdmin`, and a link omitted here is not a link
 * that is protected — `src/lib/auth/session.ts` says the same thing at more
 * length. What this file gets wrong is at worst a link that 404s or bounces;
 * what it must never be is the only thing standing between a contributor and
 * the settings page.
 */

export type AdminRole = 'contributor' | 'admin' | 'super_admin';

export type AdminNavLink = {
  href: string;
  label: string;
  /** True for the section's own page only — see `isCurrentAdminPath`. */
  exact?: boolean;
};

export type AdminNavGroup = {
  id: string;
  label: string;
  links: AdminNavLink[];
};

export type AdminNavViewer = {
  role: AdminRole;
  canManageAdmins: boolean;
};

/**
 * The groups, in the order they appear.
 *
 * A contributor sees one item, because there is one they can reach: the
 * upload form. Everything else in the admin area bounces them back to it
 * (`requireAdmin` redirects a contributor to /admin/upload), so listing more
 * would be listing places to be turned away from.
 */
export function adminNavFor(viewer: AdminNavViewer): AdminNavGroup[] {
  const superAdmin = viewer.role === 'super_admin';

  if (viewer.role === 'contributor') {
    return [
      {
        id: 'data',
        label: 'Data',
        links: [{ href: '/admin/upload', label: 'Upload a file' }],
      },
      {
        id: 'account',
        label: 'Account',
        links: [{ href: '/admin/password', label: 'Change password' }],
      },
    ];
  }

  const groups: AdminNavGroup[] = [
    {
      id: 'overview',
      label: 'Overview',
      links: [{ href: '/admin', label: 'Dashboard', exact: true }],
    },
    {
      id: 'data',
      label: 'Data',
      links: [
        { href: '/admin/upload', label: 'Upload a file' },
        // /grid-solver, not /admin/grid-solver: the latter is only a
        // permanent redirect kept for old bookmarks. The page left the admin
        // area when who may reach it became a setting (migration 034).
        { href: '/grid-solver', label: 'Grid solver' },
        ...(superAdmin
          ? [
            { href: '/admin/query-builder', label: 'Data QA search' },
            { href: '/admin/db-health', label: 'Database health' },
            { href: '/admin/nl-search', label: 'Search telemetry' },
          ]
          : []),
      ],
    },
    {
      id: 'people',
      label: 'People',
      links: [
        { href: '/admin/access', label: 'Beta access' },
        { href: '/admin/admins', label: 'Administrators' },
      ],
    },
  ];

  if (superAdmin) {
    groups.push({
      id: 'site',
      label: 'Site',
      links: [
        { href: '/admin/content', label: 'Page content' },
        { href: '/admin/settings', label: 'Settings' },
      ],
    });
  }

  groups.push({
    id: 'account',
    label: 'Account',
    links: [{ href: '/admin/password', label: 'Change password' }],
  });

  return groups;
}

/** Whether a nav link should be marked as the page the reader is on. */
export function isCurrentAdminPath(pathname: string, link: AdminNavLink): boolean {
  // /admin is both the dashboard and the prefix of every other admin route,
  // so a prefix match would light it up on every page in the area alongside
  // whichever link is actually current. Same reasoning as SiteNav's '/'.
  if (link.exact) return pathname === link.href;
  return pathname === link.href || pathname.startsWith(`${link.href}/`);
}
