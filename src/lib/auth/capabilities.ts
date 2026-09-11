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
 *
 * Since AFLDB-ISSUE-158 (ISSUE-156 P2) the table is also the check: every
 * admin page, route handler and Server Action under src/app/admin calls
 * `requireCapability()` with one of these names, except the dashboard, the
 * submission review actions and the account lifecycle, which keep their
 * role guards for the reasons recorded there. tests/auth.test.ts reads the
 * source and fails if a capability is declared here but enforced nowhere,
 * or if an admin mutation ships without a server-side guard.
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
  | 'data.coaches.read'
  | 'data.coaches.edit'
  | 'data.draft.read'
  | 'data.draft.edit'
  | 'data.seasonLists.read'
  | 'data.seasonLists.edit'
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
  // Coach administration (AFLDB-ISSUE-159 §8.1). Reading coach provenance
  // widens no boundary an Admin does not already have -- coach data is
  // public, and operations.audit.read already gives an Admin the full edit
  // trail. A coach edit becomes a public statistical fact immediately, with
  // no draft stage, so only a Super Admin may mutate -- matching
  // data.dataEditor and data.playerLinks.
  'data.coaches.read': ADMIN_AND_UP,
  'data.coaches.edit': SUPER_ADMIN_ONLY,
  // Draft administration (AFLDB-ISSUE-160 D-6). Reading draft provenance and
  // override state widens no boundary an Admin does not already have -- draft
  // selections are public, and operations.audit.read already gives an Admin
  // the full edit trail. New-player-through-draft creation and AFL Tables
  // identity attachment are covered by data.draft.edit, not a third
  // capability: both are person-identity decisions, exactly the class of
  // mutation data.draft.edit already gates.
  'data.draft.read': ADMIN_AND_UP,
  'data.draft.edit': SUPER_ADMIN_ONLY,
  // Season list administration (AFLDB-ISSUE-161 §16). Reading a club's list
  // widens no boundary an Admin does not already have -- lists are (future)
  // public facts and operations.audit.read already gives an Admin the full
  // edit trail. A list change becomes a public fact the moment a consumer
  // ships, there is no draft stage, and copy-forward is a bulk write --
  // matching data.coaches.edit / data.draft.edit. No Admin mutation.
  'data.seasonLists.read': ADMIN_AND_UP,
  'data.seasonLists.edit': SUPER_ADMIN_ONLY,
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
  // denied. The four Server Actions still call requireSuperAdmin() first
  // and assert this capability beside it (AFLDB-ISSUE-158) -- this entry
  // describes that guard, it does not replace it.
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
    // The delegation reaches an admin and nobody else. A contributor row
    // carrying can_manage_admins (nothing in the app writes one -- invites
    // refuse it and demotion clears it -- but no constraint forbids it) is
    // still a contributor: requireAdminManager() bounced it at requireAdmin()
    // before this table existed, and the capability may not be the weaker
    // of the two now that it is the guard (AFLDB-ISSUE-158).
    return viewer.role === 'super_admin' || (viewer.role === 'admin' && viewer.canManageAdmins);
  }
  return CAPABILITY_ROLES[capability].includes(viewer.role);
}
