import { AdminNav } from '@/app/admin/AdminNav';
import { adminNavFor } from '@/app/admin/nav-model';
import { getAdminUser } from '@/lib/auth/session';

/**
 * Admin chrome. Session checks live in each page (and in middleware),
 * not here: a layout persists across client navigations and is the
 * wrong place to hang security. This is furniture only -- the one
 * read here is display-only (which links to show), never a gate.
 */
export const dynamic = 'force-dynamic';

function roleLabel(role: string, canManageAdmins: boolean): string {
  if (role === 'super_admin') return 'Super admin';
  if (role === 'contributor') return 'Contributor';
  return canManageAdmins ? 'Admin · can manage admins' : 'Admin';
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdminUser();

  // Signed out, or on the login/invite pages the middleware lets through
  // unauthenticated: there is no menu to draw, and drawing an empty rail
  // beside a login form would be worse than drawing nothing.
  //
  // An outstanding temporary password gets the same treatment for a
  // different reason: every route in that menu redirects straight back to
  // the change-password page (see `requireUploader`), so a full sidebar
  // would be eight links to nowhere.
  if (!admin || admin.mustChangePassword) return <>{children}</>;

  return (
    <div className="admin-shell">
      <AdminNav
        groups={adminNavFor({ role: admin.role, canManageAdmins: admin.canManageAdmins })}
        email={admin.email}
        roleLabel={roleLabel(admin.role, admin.canManageAdmins)}
      />
      <div className="admin-main">{children}</div>
    </div>
  );
}
