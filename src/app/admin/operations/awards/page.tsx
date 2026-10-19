import type { Metadata } from 'next';
import Link from 'next/link';

import { hasCapability } from '@/lib/auth/capabilities';
import { requireCapability } from '@/lib/auth/session';

import { ProposalQueueTable, QueueFilterBar } from '../_components/AwardsViews';
import { CreateProposalsForm } from '../_components/OperationsClientForms';
import { LoadedSection } from '../_components/Shared';
import { QUEUE_PAGE_LIMIT, loadAwardsQueue } from '../page-data';
import { parseQueueFilter } from '../views';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Award proposals',
  robots: { index: false, follow: false },
};

/**
 * `/admin/operations/awards` — the curated award proposal queue (AFLDB V2 Stage 5, plan D9; ADR 0008).
 *
 * Any Admin may read the queue (`data.awards.read`). The "create proposals from a local file" form is
 * offered only to a viewer who holds `data.awards.edit` (Super Admin), and the Server Action behind
 * it checks that capability first again. The status filter comes from `?status=`; in Next 16
 * `searchParams` is a Promise, awaited after the guard.
 */
export default async function AwardProposalsPage(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  const admin = await requireCapability('data.awards.read');
  const params = await searchParams;
  const filter = parseQueueFilter(params.status);
  const queue = await loadAwardsQueue(admin, filter);
  const canEdit = hasCapability(admin, 'data.awards.edit');

  return (
    <>
      <div className="page-header">
        <p className="muted"><Link href="/admin/operations">← Operations centre</Link></p>
        <h1>Award proposals</h1>
        <p className="subtitle">
          Curated award entries move through proposal, validation and a reviewed, transactional
          approval. Nothing here reaches the public record until a Super Admin approves a validated
          proposal, and every decision is recorded in an append-only ledger.
        </p>
        {!canEdit && (
          <p className="muted">
            You can read every proposal and its history. Creating, validating, approving and
            rejecting are Super Admin actions.
          </p>
        )}
      </div>

      <QueueFilterBar active={filter} />
      <LoadedSection id="proposal-queue" title="Queue" what="The proposal queue" loaded={queue}>
        {(proposals) => <ProposalQueueTable proposals={proposals} limit={QUEUE_PAGE_LIMIT} />}
      </LoadedSection>

      {canEdit && <CreateProposalsForm actingEmail={admin.email} />}
    </>
  );
}
