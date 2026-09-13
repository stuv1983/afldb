import type { Metadata } from 'next';

import { HonourTeamForm } from '@/app/admin/awards/HonourTeamForm';
import { domainListPath } from '@/app/admin/awards/labels';
import { AwardsCrumb } from '@/app/admin/awards/RecordFacts';
import { listHonourTeamNamesForAdmin } from '@/db/queries/admin-awards';
import { requireCapability } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Record a team selection', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/** `/admin/awards/honour-teams/new` (AFLDB-ISSUE-165 §6.5). Super Admin only. */
export default async function NewHonourTeamMemberPage() {
  await requireCapability('data.awards.edit');
  const teams = await listHonourTeamNamesForAdmin();

  return (
    <>
      <div className="page-header">
        <AwardsCrumb href={domainListPath('honour-teams')} label="Honour &amp; representative teams" />
        <h1>Record a team selection</h1>
        <p className="subtitle">
          A selection already recorded for this team — the same linked player, or a same-name entry
          that cannot be told apart from one — is refused with the reason rather than silently
          duplicated. Choosing an existing team keeps the selection with the rest of it; a new name
          starts a new team.
        </p>
      </div>

      <HonourTeamForm existingTeams={teams} />
    </>
  );
}
