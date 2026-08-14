import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { LoginForm } from '@/app/admin/login/LoginForm';
import { getAdminUser } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Administrator sign-in',
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage() {
  if (await getAdminUser()) redirect('/admin');

  return (
    <div style={{ maxWidth: '24rem', margin: '4rem auto' }}>
      <div className="page-header">
        <h1>Administrator sign-in</h1>
        <p className="subtitle">Password and authenticator code required.</p>
      </div>
      <LoginForm />
    </div>
  );
}
