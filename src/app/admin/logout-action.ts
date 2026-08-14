'use server';

import { redirect } from 'next/navigation';

import { audit, destroyAdminSession, getAdminUser } from '@/lib/auth/session';

export async function adminLogout(): Promise<void> {
  const admin = await getAdminUser();
  if (admin) {
    await audit('admin.logout', null, { userId: admin.id, label: admin.email });
  }
  await destroyAdminSession();
  redirect('/admin/login');
}
