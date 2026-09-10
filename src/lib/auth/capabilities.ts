/**
 * The Admin Centre capability policy (AFLDB-ISSUE-155 Phase A).
 *
 * One table naming which staff role each admin surface is open to, so the
 * sidebar (`src/app/admin/nav-model.ts`, a Client Component's import) and
 * the server guard that actually enforces access (`requireCapability` in
 * `src/lib/auth/session.ts`) read the same list instead of two hand-copied
 * ones drifting apart.
 *
 * Deliberately free of `server-only`, matching nav-model.ts's own reason for
 * being pure: `AdminNav` is a Client Component and imports from here too, so
 * nothing in this file may reach the database, cookies or `next/navigation`.
 * The redirecting guard that does those things lives in session.ts instead,
 * built on top of `hasCapability`.
 *
 * Every entry here is a description of a check that already exists on the
 * page or action it names (verified against src/app/admin/**\/page.tsx
 * during Phase A) -- this table does not itself grant anything new.
 */

export type CapabilityRole = 'contributor' | 'admin' | 'super_admin';

export type CapabilityViewer = {
  role: CapabilityRole;
  canManageAdmins: boolean;
};

export type Capability =
  | 'data.playerLinks'
  | 'data.dataEditor'
  | 'data.brownlow.read'
  | 'data.brownlow.draft'
  | 'data.brownlow.finalise'
  | 'acquisition.legacyIntake'
  | 'acquisition.currentSeason'
  | 'people.betaAccess'
  | 'people.admins.read'
  | 'people.admins.manage'
  | 'people.admins.lifecycle'
  | 'site.content'
  | 'site.settings'
  | 'operations.queryBuilder'
  | 'operations.dbHealth'
  | 'operations.appHealth'
  | 'operations.nlTelemetry'
  | 'operations.audit.read';

const ALL_STAFF: readonly CapabilityRole[] = ['contributor', 'admin', 'super_admin'];
const ADMIN_AND_UP: readonly CapabilityRole[] = ['admin', 'super_admin'];
const SUPER_ADMIN_ONLY: readonly CapabilityRole[] = ['super_admin'];

/**
 * The baseline role list for each capability. `people.admins.manage` is
 * checked separately below: `can_manage_admins` delegates it to a plain
 * admin without making that admin a super admin, the same distinction
 * `hasAdminManagementAccess` in session.ts already draws.
 */
const CAPABILITY_ROLES: Record<Capability, readonly CapabilityRole[]> = {
  'data.playerLinks': SUPER_ADMIN_ONLY,
  'data.dataEditor': SUPER_ADMIN_ONLY,
  // Brownlow administration (AFLDB-ISSUE-155 Phase C §27.8). An Admin may
  // enter and save a draft -- work that reaches no public query -- while
  // only a Super Admin may finalise, correct, void or publish, which is
  // the moment a vote becomes a public statistical fact.
  'data.brownlow.read': ADMIN_AND_UP,
  'data.brownlow.draft': ADMIN_AND_UP,
  'data.brownlow.finalise': SUPER_ADMIN_ONLY,
  // requireUploader-gated (src/app/admin/upload/page.tsx): a contributor's
  // one reachable route, so it stays open to every staff role.
  'acquisition.legacyIntake': ALL_STAFF,
  'acquisition.currentSeason': SUPER_ADMIN_ONLY,
  'people.betaAccess': ADMIN_AND_UP,
  'people.admins.read': ADMIN_AND_UP,
  'people.admins.manage': SUPER_ADMIN_ONLY,
  // Promote/demote/deactivate/reactivate (AFLDB-ISSUE-155 Phase B §26.3).
  // Deliberately NOT delegated by `can_manage_admins`: unlike the entry
  // above, this one takes the plain role list, so a delegated manager is
  // denied. The page and the four Server Actions still call
  // requireSuperAdmin() themselves -- this entry describes that guard, it
  // does not replace it.
  'people.admins.lifecycle': SUPER_ADMIN_ONLY,
  'site.content': SUPER_ADMIN_ONLY,
  'site.settings': SUPER_ADMIN_ONLY,
  'operations.queryBuilder': SUPER_ADMIN_ONLY,
  'operations.dbHealth': SUPER_ADMIN_ONLY,
  'operations.appHealth': SUPER_ADMIN_ONLY,
  'operations.nlTelemetry': SUPER_ADMIN_ONLY,
  // The read-only audit viewer over auth_audit_log and data_edits
  // (AFLDB-ISSUE-157, ISSUE-156 §2 row `ops.audit.read`; the identifier
  // takes this file's `operations.` prefix and the `.read` suffix of
  // `data.brownlow.read` / `people.admins.read`). Open to any Admin, not
  // only a Super Admin: the /admin dashboard already shows every admin the
  // fifteen most recent auth_audit_log rows for every actor, and an Admin's
  // own Brownlow drafts land in data_edits, so a full-scope read here
  // widens no boundary that exists today. The viewer has no write path.
  'operations.audit.read': ADMIN_AND_UP,
};

export function hasCapability(viewer: CapabilityViewer, capability: Capability): boolean {
  if (capability === 'people.admins.manage') {
    return viewer.role === 'super_admin' || viewer.canManageAdmins;
  }
  return CAPABILITY_ROLES[capability].includes(viewer.role);
}
