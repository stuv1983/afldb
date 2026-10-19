import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { hasCapability } from '@/lib/auth/capabilities';
import { requireCapability } from '@/lib/auth/session';

import {
  ProposalEvidence,
  ProposalHistoryView,
  ProposalValidation,
  ProposalValues,
} from '../../_components/AwardsViews';
import { DecisionPanel, ReviseApprovedPanel } from '../../_components/OperationsClientForms';
import { ReviseApprovedUnavailable } from '../../_components/ReviseApprovedViews';
import { LoadFailure } from '../../_components/Shared';
import { loadProposalPage } from '../../page-data';
import { parseRouteId, proposalHref } from '../../views';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Award proposal',
  robots: { index: false, follow: false },
};

/**
 * `/admin/operations/awards/[id]` — one proposal: its values, evidence, validation and the full
 * revision and decision history (AFLDB V2 Stage 5, plan D9; ADR 0008).
 *
 * Reading needs `data.awards.read`. The decision panel (validate, approve, reject) is offered only
 * to a viewer holding `data.awards.edit`, and only for the newest revision of the proposal; its
 * Server Actions check the capability first again. An APPROVED newest revision instead offers the
 * revise-approved panel (V2-GAP-018), with the reason shown when the viewer may not use it. The
 * decision panel asks for a self-approval attestation when the viewer created the revision (V2-GAP-019). A malformed id is a 404; a well-formed id that
 * does not exist is an inline notice. `params` is a Promise in Next 16, awaited after the guard.
 */
export default async function AwardProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireCapability('data.awards.read');
  const { id: rawId } = await params;
  const proposalId = parseRouteId(rawId);
  if (proposalId === null) notFound();

  const loaded = await loadProposalPage(admin, proposalId);
  const canEdit = hasCapability(admin, 'data.awards.edit');

  return (
    <>
      <div className="page-header">
        <p className="muted"><Link href="/admin/operations/awards">← Award proposals</Link></p>
        <h1>Award proposal #{proposalId}</h1>
      </div>

      {!loaded.ok ? (
        <LoadFailure what={`Proposal #${proposalId}`} error={loaded.error} code={loaded.code} />
      ) : (
        <>
          {loaded.value.current.id !== loaded.value.latest.id && (
            <p className="notice" data-superseded-revision="true">
              This revision was superseded. The newest revision is{' '}
              <Link href={proposalHref(loaded.value.latest.id)}>#{loaded.value.latest.id}</Link>; decisions
              are only offered on the newest revision.
            </p>
          )}
          <ProposalValues proposal={loaded.value.current} />
          <ProposalEvidence proposal={loaded.value.current} />
          <ProposalValidation proposal={loaded.value.current} />
          {canEdit && loaded.value.current.id === loaded.value.latest.id && (
            <DecisionPanel
              proposal={loaded.value.current}
              actingEmail={admin.email}
              sealedSeason={loaded.value.sealedSeason}
              viewerCreatedRevision={loaded.value.current.createdBy === admin.id}
            />
          )}
          {loaded.value.current.status === 'approved' && loaded.value.current.id === loaded.value.latest.id && (
            canEdit
              ? (
                <ReviseApprovedPanel
                  proposal={loaded.value.current}
                  actingEmail={admin.email}
                  sealedSeason={loaded.value.sealedSeason}
                />
              )
              : <ReviseApprovedUnavailable reason="permission" />
          )}
          {!canEdit && (
            <p className="muted" data-read-only="true">
              You can read this proposal and its history. Validating, approving, rejecting and revising an approved winner are Super Admin actions.
            </p>
          )}
          <ProposalHistoryView history={loaded.value.history} />
        </>
      )}
    </>
  );
}
