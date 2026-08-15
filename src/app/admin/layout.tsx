import Link from 'next/link';

/**
 * Admin chrome. Session checks live in each page (and in middleware),
 * not here: a layout persists across client navigations and is the
 * wrong place to hang security. This is furniture only.
 */
export const dynamic = 'force-dynamic';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <nav className="breadcrumbs" aria-label="Admin">
        <Link href="/admin">Admin</Link>
        <span aria-hidden="true">·</span>
        <Link href="/admin/upload">Upload</Link>
        <span aria-hidden="true">·</span>
        <Link href="/admin/access">Beta access</Link>
        <span aria-hidden="true">·</span>
        <Link href="/admin/admins">Administrators</Link>
        <span aria-hidden="true">·</span>
        <Link href="/">View site</Link>
      </nav>
      {children}
    </>
  );
}
