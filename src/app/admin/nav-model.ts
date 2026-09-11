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
 * Which role sees which link now comes from `src/lib/auth/capabilities.ts`
 * (AFLDB-ISSUE-155 Phase A) rather than a `superAdmin ? … : …` local to this
 * file, so the nav and the server guard that actually enforces a route read
 * one shared table instead of two hand-kept ones.
 *
 * This is furniture, never a gate. Every page still calls its own
 * `requireAdmin` / `requireSuperAdmin` / `requireCapability`, and a link
 * omitted here is not a link that is protected — `src/lib/auth/session.ts`
 * says the same thing at more length. What this file gets wrong is at worst
 * a link that 404s or bounces; what it must never be is the only thing
 * standing between a contributor and the settings page.
 */

import { hasCapability, type Capability, type CapabilityViewer } from '@/lib/auth/capabilities';

export type AdminRole = CapabilityViewer['role'];

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

export type AdminNavViewer = CapabilityViewer;

/** One link, gated by the capability that already protects its route server-side. */
type GatedLink = AdminNavLink & { capability: Capability };

function visibleLinks(viewer: AdminNavViewer, links: GatedLink[]): AdminNavLink[] {
  return links
    .filter((link) => hasCapability(viewer, link.capability))
    .map((link) => ({ href: link.href, label: link.label, exact: link.exact }));
}

/**
 * The groups, in the order they appear.
 *
 * A contributor sees one item, because there is one they can reach: the
 * upload form. Everything else in the admin area bounces them back to it
 * (`requireAdmin` redirects a contributor to /admin/upload), so listing more
 * would be listing places to be turned away from.
 */
export function adminNavFor(viewer: AdminNavViewer): AdminNavGroup[] {
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
  ];

  const dataLinks = visibleLinks(viewer, [
    { href: '/admin/data-editor', label: 'Data editor', capability: 'data.dataEditor' },
    { href: '/admin/brownlow', label: 'Brownlow', capability: 'data.brownlow.read' },
    { href: '/admin/player-links', label: 'Player links', capability: 'data.playerLinks' },
    { href: '/admin/coaches', label: 'Coaches', capability: 'data.coaches.read' },
  ]);
  if (dataLinks.length > 0) groups.push({ id: 'data', label: 'Data', links: dataLinks });

  const acquisitionLinks = visibleLinks(viewer, [
    { href: '/admin/current-season', label: 'Current season', capability: 'acquisition.currentSeason' },
    { href: '/admin/upload', label: 'Legacy file intake', capability: 'acquisition.legacyIntake' },
  ]);
  if (acquisitionLinks.length > 0) groups.push({ id: 'acquisition', label: 'Acquisition', links: acquisitionLinks });

  const peopleLinks = visibleLinks(viewer, [
    { href: '/admin/access', label: 'Beta access', capability: 'people.betaAccess' },
    { href: '/admin/admins', label: 'Administrators', capability: 'people.admins.read' },
  ]);
  if (peopleLinks.length > 0) groups.push({ id: 'people', label: 'People & access', links: peopleLinks });

  const siteLinks = visibleLinks(viewer, [
    { href: '/admin/content', label: 'Page content', capability: 'site.content' },
    { href: '/admin/settings', label: 'Settings', capability: 'site.settings' },
  ]);
  if (siteLinks.length > 0) groups.push({ id: 'site', label: 'Site', links: siteLinks });

  const operationsLinks = visibleLinks(viewer, [
    { href: '/admin/query-builder', label: 'Data QA search', capability: 'operations.queryBuilder' },
    { href: '/admin/db-health', label: 'Database health', capability: 'operations.dbHealth' },
    { href: '/admin/app-health', label: 'Application health', capability: 'operations.appHealth' },
    { href: '/admin/nl-search', label: 'Search telemetry', capability: 'operations.nlTelemetry' },
    { href: '/admin/nl-search/feedback', label: 'Reader feedback', capability: 'operations.nlTelemetry' },
    { href: '/admin/audit', label: 'Audit trail', capability: 'operations.audit.read' },
  ]);
  if (operationsLinks.length > 0) groups.push({ id: 'operations', label: 'Operations', links: operationsLinks });

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
