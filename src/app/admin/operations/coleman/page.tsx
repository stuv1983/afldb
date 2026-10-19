import type { Metadata } from 'next';
import Link from 'next/link';

import { hasCapability } from '@/lib/auth/capabilities';
import { requireCapability } from '@/lib/auth/session';

import { ColemanPublicationsTable } from '../_components/ColemanViews';
import { ColemanWorkbench } from '../_components/OperationsClientForms';
import { LoadedSection } from '../_components/Shared';
import { loadColemanPage } from '../page-data';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Coleman Medal derivation',
  robots: { index: false, follow: false },
};

/**
 * `/admin/operations/coleman` — the Coleman Medal derivation (AFLDB V2 Stage 5, plan D9; ADR 0006).
 *
 * Any Admin (`data.awards.read`) sees the current publications and may run the read-only
 * comparison. Publishing is offered only to a viewer holding `data.awards.edit` (Super Admin), and
 * its Server Action checks that capability first again. A publication is an append-only record in
 * `derived_award_results`; it never touches the public `award_winners` rows (V2-GAP-021).
 */
export default async function ColemanPage() {
  const admin = await requireCapability('data.awards.read');
  const page = await loadColemanPage(admin);
  const canPublish = hasCapability(admin, 'data.awards.edit');
  const defaultSeason = page.sealed.ok ? page.sealed.value.through : null;

  return (
    <>
      <div className="page-header">
        <p className="muted"><Link href="/admin/operations">← Operations centre</Link></p>
        <h1>Coleman Medal derivation</h1>
        <p className="subtitle">
          The Coleman Medal result is derived from the recorded home-and-away goals, compared with the
          stored winners, and published as an audited, append-only record. A season with a goal that
          is not recorded cannot be derived: a missing statistic is never counted as zero.
        </p>
      </div>

      <LoadedSection
        id="coleman-publications"
        title="Current publications"
        what="The Coleman publications"
        loaded={page.publications}
        intro="One row per season: the publication that no later row supersedes."
      >
        {(publications) => <ColemanPublicationsTable publications={publications} />}
      </LoadedSection>

      {!page.sealed.ok && (
        <p className="notice" role="alert">
          The season registry could not be read, so the sealed range is unknown and publication will
          be refused. {page.sealed.error}
        </p>
      )}

      <ColemanWorkbench canPublish={canPublish} actingEmail={admin.email} defaultSeason={defaultSeason} />
    </>
  );
}
