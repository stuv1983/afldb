import { describe, expect, it, vi } from 'vitest';
import { revalidatePath } from 'next/cache';
import { saveSiteSettings } from '@/app/admin/settings/actions';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/db/authClient', () => ({
  authSql: {
    begin: vi.fn().mockImplementation(async (cb) => {
      const tx = vi.fn().mockResolvedValue([]);
      return cb(tx);
    }),
  },
}));

vi.mock('@/lib/auth/session', () => ({
  requireSuperAdmin: vi.fn().mockResolvedValue({ id: 1, email: 'admin@example.com' }),
  audit: vi.fn().mockResolvedValue(undefined),
}));

describe('saveSiteSettings', () => {
  it('revalidates the entire site layout when settings are saved', async () => {
    const formData = new FormData();
    formData.set('frontendTheme', 'modern');

    await saveSiteSettings({}, formData);

    // The fix for AFLDB-ISSUE-077 requires that saving settings revalidates the entire app layout,
    // because frontendTheme affects the root layout which wraps every page on the site.
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    expect(revalidatePath).toHaveBeenCalledTimes(1);
  });
});
