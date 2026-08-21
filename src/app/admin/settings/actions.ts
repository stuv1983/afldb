'use server';

import { revalidatePath } from 'next/cache';

import { authSql } from '@/db/authClient';
import { audit, requireSuperAdmin } from '@/lib/auth/session';
import { sendEmail } from '@/lib/email/send';
import {
  SETTING_KEYS,
  DEFAULT_AFL_PLACEHOLDERS,
  DEFAULT_AFLW_PLACEHOLDERS,
  parseAflwLeaders,
  parseEarlyAccessIntro,
  parseEarlyAccessNotifyTo,
  parseEarlyAccessQuestions,
  parseGridAudience,
  parseHomeLayout,
  parseHomeRecord,
  parsePlaceholderInterval,
  parsePlaceholders,
  parseSearchAnimation,
  parseSiteTheme,
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
 * The rows are written in one transaction so a half-applied layout is
 * never observable, and the home and search pages are revalidated.
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

  // The question list arrives as one JSON field from the client editor.
  let submittedQuestions: unknown = [];
  try {
    submittedQuestions = JSON.parse(String(formData.get('earlyAccessQuestions') ?? '[]'));
  } catch {
    submittedQuestions = [];
  }
  const earlyAccessQuestions = parseEarlyAccessQuestions(submittedQuestions);
  const earlyAccessOpen = formData.get('earlyAccessOpen') === 'on';
  const earlyAccessIntro = parseEarlyAccessIntro(formData.get('earlyAccessIntro'));
  const earlyAccessNotify = formData.get('earlyAccessNotify') === 'on';
  const earlyAccessNotifyTo = parseEarlyAccessNotifyTo(formData.get('earlyAccessNotifyTo'));

  // Search placeholder settings (see changeLog.md)
  const searchPlaceholdersAfl = parsePlaceholders(
    formData.get('searchPlaceholdersAfl'),
    DEFAULT_AFL_PLACEHOLDERS,
  );
  const searchPlaceholdersAflw = parsePlaceholders(
    formData.get('searchPlaceholdersAflw'),
    DEFAULT_AFLW_PLACEHOLDERS,
  );
  const searchPlaceholderInterval = parsePlaceholderInterval(
    formData.get('searchPlaceholderInterval'),
  );
  const searchPlaceholderAnimation = parseSearchAnimation(
    formData.get('searchPlaceholderAnimation'),
  );
  
  const frontendTheme = parseSiteTheme(formData.get('frontendTheme'));

  await authSql.begin(async (tx) => {
    for (const [key, value] of [
      [SETTING_KEYS.homeLayout, layout],
      [SETTING_KEYS.homeRecord, homeRecord],
      [SETTING_KEYS.aflwLeaders, aflwLeaders],
      [SETTING_KEYS.gridAudience, gridAudience],
      [SETTING_KEYS.earlyAccessOpen, earlyAccessOpen],
      [SETTING_KEYS.earlyAccessIntro, earlyAccessIntro],
      [SETTING_KEYS.earlyAccessQuestions, earlyAccessQuestions],
      [SETTING_KEYS.earlyAccessNotify, earlyAccessNotify],
      [SETTING_KEYS.earlyAccessNotifyTo, earlyAccessNotifyTo],
      [SETTING_KEYS.searchPlaceholdersAfl, searchPlaceholdersAfl],
      [SETTING_KEYS.searchPlaceholdersAflw, searchPlaceholdersAflw],
      [SETTING_KEYS.searchPlaceholderInterval, searchPlaceholderInterval],
      [SETTING_KEYS.searchPlaceholderAnimation, searchPlaceholderAnimation],
      [SETTING_KEYS.frontendTheme, frontendTheme],
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
    hidden: layout.hidden,
    order: layout.order,
    homeRecord,
    aflwLeaders,
    gridAudience,
    earlyAccessOpen,
    earlyAccessNotify,
    earlyAccessNotifyTo,
    earlyAccessQuestionCount: earlyAccessQuestions.length,
    searchPlaceholderInterval,
    searchPlaceholderAnimation,
    frontendTheme,
  }, { userId: admin.id, label: admin.email });

  revalidatePath('/');
  revalidatePath('/aflw');
  revalidatePath('/search');
  revalidatePath('/admin/settings');

  return { message: 'Saved. Settings have been updated.' };
}

/**
 * Send a test message to the configured recipient.
 *
 * Its own action, and its own form on the page, because it must not be able
 * to submit the settings above: an admin checking whether mail works should
 * not also write whatever half-edited state the form is in. Reads the
 * recipient from the submitted field rather than from the database, so the
 * address can be tested before it is saved.
 */
export async function sendTestEmail(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const admin = await requireSuperAdmin();
  const to = parseEarlyAccessNotifyTo(formData.get('testTo'));

  const result = await sendEmail({
    to,
    subject: 'AFLDB test message',
    text: 'This is a test from /admin/settings. If it arrived, early-access '
      + 'notifications will too.',
  });

  await audit('settings.test_email', { to, ok: result.ok }, {
    userId: admin.id, label: admin.email,
  });

  if (result.ok) return { message: `Sent to ${to}. Check that it arrives.` };
  if (result.reason === 'not-configured') {
    return { error: 'No SMTP relay is configured. Set AFLDB_SMTP_* in .env on the server.' };
  }
  // The relay's own message is the only useful diagnostic here, and this
  // form is super-admin only, so it is shown rather than swallowed.
  return { error: `Could not send: ${result.detail ?? 'unknown error'}` };
}
