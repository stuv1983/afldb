'use server';

import { revalidatePath } from 'next/cache';

import { authSql } from '@/db/authClient';
import { audit, requireSuperAdmin } from '@/lib/auth/session';
import {
  SETTING_KEYS,
  parseAflwLeaders,
  parseGridAudience,
  parseHomeLayout,
  parseHomeRecord,
  type HomeSectionId,
} from '@/lib/site-settings';

export type SettingsState = { error?: string; message?: string };

/**
 * Write the runtime settings (migration 034).
 *
 * Super admin only, and every submitted value goes through the same parser
 * the read path uses: the form is a convenience, not the validation. A
 * hand-posted `gridAudience=everyone` therefore lands on the default rather
 * than in the database, which matters because that one value decides who can
 * reach a page.
 *
 * The four rows are written in one transaction so a half-applied layout is
 * never observable, and the two home pages are revalidated because both are
 * ISR-cached for an hour — without this an admin would change a setting and
 * see no difference until the window rolled over.
 */
export async function saveSiteSettings(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const admin = await requireSuperAdmin();

  const order = String(formData.get('order') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean) as HomeSectionId[];
  // Checkboxes only appear in the payload when ticked, so "shown" is read
  // from the ticked set and everything else in the order is hidden.
  const shown = new Set(formData.getAll('shown').map(String));
  const layout = parseHomeLayout({
    order,
    hidden: order.filter((id) => !shown.has(id)),
  });

  const homeRecord = parseHomeRecord(formData.get('homeRecord'));
  const aflwLeaders = parseAflwLeaders(formData.get('aflwLeaders'));
  const gridAudience = parseGridAudience(formData.get('gridAudience'));

  await authSql.begin(async (tx) => {
    for (const [key, value] of [
      [SETTING_KEYS.homeLayout, layout],
      [SETTING_KEYS.homeRecord, homeRecord],
      [SETTING_KEYS.aflwLeaders, aflwLeaders],
      [SETTING_KEYS.gridAudience, gridAudience],
    ] as const) {
      await tx`
        INSERT INTO site_settings (key, value, updated_by)
        VALUES (${key}, ${JSON.stringify(value)}::jsonb, ${admin.id})
        ON CONFLICT (key) DO UPDATE
          SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
      `;
    }
  });

  await audit('settings.saved', {
    hidden: layout.hidden, order: layout.order, homeRecord, aflwLeaders, gridAudience,
  }, { userId: admin.id, label: admin.email });

  revalidatePath('/');
  revalidatePath('/aflw');
  revalidatePath('/admin/settings');

  return { message: 'Saved. The home pages have been rebuilt with the new layout.' };
}
