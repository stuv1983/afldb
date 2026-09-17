import type { Metadata } from 'next';

import { SettingsForm } from '@/app/admin/settings/SettingsForm';
import { TestEmailForm } from '@/app/admin/settings/TestEmailForm';
import { getSiteSettingsForAdmin } from '@/db/queries/site-settings';
import { requireCapability } from '@/lib/auth/session';
import { emailConfigured } from '@/lib/email/send';
import { homeRecordOptionGroups } from '@/lib/home-records';

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
  await requireCapability('site.settings');
  const settings = await getSiteSettingsForAdmin();
  const smtpConfigured = emailConfigured();

  const recordGroups = homeRecordOptionGroups();

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
        recordGroups={recordGroups}
        smtpConfigured={smtpConfigured}
      />

      <TestEmailForm defaultTo={settings.earlyAccessNotifyTo} />
    </>
  );
}
