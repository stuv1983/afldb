import type { Metadata } from 'next';

import { SettingsForm } from '@/app/admin/settings/SettingsForm';
import { TestEmailForm } from '@/app/admin/settings/TestEmailForm';
import { RECORD_CATEGORIES } from '@/db/queries/records';
import { getSiteSettingsForAdmin } from '@/db/queries/site-settings';
import { requireSuperAdmin } from '@/lib/auth/session';
import { emailConfigured } from '@/lib/email/send';
import { HOME_RECORD_CATEGORIES } from '@/lib/site-settings';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Site settings',
  robots: { index: false, follow: false },
};

/**
 * The site's runtime configuration, super admin only.
 *
 * Deliberately not open to a plain admin, delegated or not: what the front
 * page shows and who may reach the grid solver are publication decisions,
 * which is the same line `requireSuperAdmin` already draws for the query
 * builder.
 */
export default async function SettingsPage() {
  await requireSuperAdmin();
  const settings = await getSiteSettingsForAdmin();
  const smtpConfigured = emailConfigured();

  // Titles come from the record catalogue rather than being restated here,
  // so a reworded category reaches this form too.
  const recordOptions = HOME_RECORD_CATEGORIES.map((slug) => ({
    value: slug,
    label: RECORD_CATEGORIES[slug].title,
  }));

  return (
    <>
      <div className="page-header">
        <h1>Site settings</h1>
        <p className="subtitle">
          What the front page shows, who may reach the grid solver, and the early-access
          form on afldb.com. Changes take effect immediately — both home pages are
          rebuilt on save.
        </p>
      </div>

      <SettingsForm
        settings={settings}
        recordOptions={recordOptions}
        smtpConfigured={smtpConfigured}
      />

      <TestEmailForm defaultTo={settings.earlyAccessNotifyTo} />
    </>
  );
}
