import { describe, expect, it, vi, beforeEach } from 'vitest';
import { revalidatePath } from 'next/cache';
import { saveSiteSettings } from '@/app/admin/settings/actions';
import { SETTING_KEYS } from '@/lib/site-settings';

// Populated by the `authSql.begin` mock below with every `(key, value)` pair
// `saveSiteSettings` writes, so tests can assert what was actually persisted
// rather than only that the transaction ran. Declared via `vi.hoisted` because
// `vi.mock` factories are hoisted above ordinary top-level declarations.
const insertedRows: { key: unknown; value: unknown }[] = vi.hoisted(() => []);

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/db/authClient', () => ({
  authSql: {
    begin: vi.fn().mockImplementation(async (cb) => {
      const tx = vi.fn((_strings: TemplateStringsArray, key: unknown, value: unknown) => {
        insertedRows.push({ key, value: typeof value === 'string' ? JSON.parse(value) : value });
        return Promise.resolve([]);
      });
      return cb(tx);
    }),
  },
}));

vi.mock('@/lib/auth/session', () => ({
  // site.settings (super-admin-only) since AFLDB-ISSUE-158.
  requireCapability: vi.fn().mockResolvedValue({ id: 1, email: 'admin@example.com' }),
  audit: vi.fn().mockResolvedValue(undefined),
}));

describe('saveSiteSettings', () => {
  beforeEach(() => {
    insertedRows.length = 0;
    vi.mocked(revalidatePath).mockClear();
  });

  it('revalidates the entire site layout when settings are saved', async () => {
    const formData = new FormData();
    formData.set('frontendTheme', 'modern');

    await saveSiteSettings({}, formData);

    // The fix for AFLDB-ISSUE-077 requires that saving settings revalidates the entire app layout,
    // because frontendTheme affects the root layout which wraps every page on the site.
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    expect(revalidatePath).toHaveBeenCalledTimes(1);
  });

  it('persists a valid frontendLayout value and still revalidates exactly once', async () => {
    // AFLDB-ISSUE-173: frontendLayout goes through the same save transaction
    // and the same unconditional revalidation as every other setting — no
    // second cache-invalidation path is introduced for it.
    const formData = new FormData();
    formData.set('frontendLayout', 'sidebar');

    await saveSiteSettings({}, formData);

    expect(insertedRows).toContainEqual({ key: SETTING_KEYS.frontendLayout, value: 'sidebar' });
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    expect(revalidatePath).toHaveBeenCalledTimes(1);
  });

  it('falls back an invalid submitted frontendLayout to classic rather than storing it', async () => {
    const formData = new FormData();
    formData.set('frontendLayout', 'not-a-real-layout');

    await saveSiteSettings({}, formData);

    expect(insertedRows).toContainEqual({ key: SETTING_KEYS.frontendLayout, value: 'classic' });
  });

  it('writes frontendTheme and frontendLayout independently in the same save', async () => {
    const formData = new FormData();
    formData.set('frontendTheme', 'modern');
    formData.set('frontendLayout', 'sidebar');

    await saveSiteSettings({}, formData);

    expect(insertedRows).toContainEqual({ key: SETTING_KEYS.frontendTheme, value: 'modern' });
    expect(insertedRows).toContainEqual({ key: SETTING_KEYS.frontendLayout, value: 'sidebar' });
  });
});
