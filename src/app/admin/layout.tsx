import Link from 'next/link';

import { getAdminUser } from '@/lib/auth/session';

/**
 * Admin chrome. Session checks live in each page (and in middleware),
 * not here: a layout persists across client navigations and is the
 * wrong place to hang security. This is furniture only -- the one
 * read here is display-only (which links to show), never a gate.
 */
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdminUser();
  const isContributor = admin?.role === 'contributor';

  return (
    <>
      <nav className="breadcrumbs" aria-label="Admin">
        {isContributor ? (
          <Link href="/admin/upload">Upload</Link>
        ) : (
          <>
            <Link href="/admin">Admin</Link>
            <span aria-hidden="true">·</span>
            <Link href="/admin/upload">Upload</Link>
            <span aria-hidden="true">·</span>
            <Link href="/admin/access">Beta access</Link>
            <span aria-hidden="true">·</span>
            <Link href="/admin/admins">Administrators</Link>
            {admin?.role === 'super_admin' && (
              <>
                <span aria-hidden="true">·</span>
                <Link href="/admin/content">Page content</Link>
                <span aria-hidden="true">·</span>
                <Link href="/admin/settings">Settings</Link>
              </>
            )}
          </>
        )}
        <span aria-hidden="true">·</span>
        <Link href="/">View site</Link>
      </nav>
      {children}
    </>
  );
}
