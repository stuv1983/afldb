import type { DecisionRecord, ProposalHistory, ProposalRecord, ProposalStatus } from '@afldb/admin';
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';

import { formatInstant } from '../format';
import {
  PROPOSAL_STATUS_LABELS,
  proposalHref,
  type QueueFilter,
} from '../views';

/**
 * Pure presentation of the curated-award queue and of one proposal (AFLDB V2 Stage 5, plan D9).
 * Props in, markup out; the forms (create, validate, approve, reject) are in `OperationForms.tsx`.
 *
 * A proposal's player is shown by its stable identity and the source's raw name, never by a name
 * alone; a missing statistic stays "not recorded" (never 0).
 */

const STATUS_FILTERS: readonly QueueFilter[] = [
  'all', 'proposed', 'validated', 'validation_failed', 'approved', 'rejected', 'superseded',
];

export const queueFilterHref = (filter: QueueFilter): string => (
  filter === 'all' ? '/admin/operations/awards' : `/admin/operations/awards?status=${filter}`
);

const statusBadgeClass = (status: ProposalStatus): string => {
  if (status === 'validation_failed' || status === 'rejected') return 'badge badge-danger';
  if (status === 'proposed' || status === 'superseded') return 'badge badge-warn';
  return 'badge';
};

export function StatusBadge({ status }: { status: ProposalStatus }) {
  return <span className={statusBadgeClass(status)}>{PROPOSAL_STATUS_LABELS[status]}</span>;
}

export function QueueFilterBar({ active }: { active: QueueFilter }) {
  return (
    <nav aria-label="Filter proposals by status">
      <p>
        Show:{' '}
        {STATUS_FILTERS.map((filter, index) => {
          const label = filter === 'all' ? 'All current' : PROPOSAL_STATUS_LABELS[filter];
          return (
            <Fragment key={filter}>
              {index > 0 && ' · '}
              {filter === active
                ? <strong aria-current="page">{label}</strong>
                : <Link href={queueFilterHref(filter)}>{label}</Link>}
            </Fragment>
          );
        })}
      </p>
    </nav>
  );
}

const NOT_RECORDED = <span className="muted">not recorded</span>;

function errorCount(proposal: ProposalRecord): number {
  return (proposal.validationResult?.issues ?? []).filter((issue) => issue.severity === 'error').length;
}

export function ProposalQueueTable({ proposals, limit }: { proposals: readonly ProposalRecord[]; limit: number }) {
  if (proposals.length === 0) {
    return <p className="empty" data-empty-queue="true">No award proposals match this filter.</p>;
  }
  return (
    <>
      <div className="table-wrap">
        <table>
          <caption className="visually-hidden">Award proposals, newest first</caption>
          <thead>
            <tr>
              <th scope="col" className="num">#</th>
              <th scope="col">Status</th>
              <th scope="col" className="num">Season</th>
              <th scope="col">Award</th>
              <th scope="col">Player (source name)</th>
              <th scope="col">Stable identity</th>
              <th scope="col">Club</th>
              <th scope="col" className="num">Votes / value</th>
              <th scope="col">Source</th>
              <th scope="col" className="num">Validation errors</th>
              <th scope="col">Created</th>
            </tr>
          </thead>
          <tbody>
            {proposals.map((proposal) => (
              <tr key={proposal.id}>
                <td className="num"><Link href={proposalHref(proposal.id)}>#{proposal.id}</Link></td>
                <td><StatusBadge status={proposal.status} /></td>
                <td className="num">{proposal.season}</td>
                <td className="mono">{proposal.awardSlug}</td>
                <td>{proposal.playerNameRaw}</td>
                <td className="mono">{proposal.playerIdentity ?? <span className="muted">unresolved</span>}</td>
                <td className="mono">{proposal.clubSlug ?? '—'}</td>
                <td className="num">{proposal.votes ?? NOT_RECORDED}</td>
                <td className="mono">{proposal.sourceKind}</td>
                <td className="num">{proposal.validationResult === null ? '—' : errorCount(proposal)}</td>
                <td className="nowrap">{formatInstant(proposal.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {proposals.length >= limit && (
        <p className="section-note">Showing the newest {limit} proposals; narrow the filter to see older ones.</p>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * One proposal
 * ------------------------------------------------------------------ */

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

export function ProposalValues({ proposal }: { proposal: ProposalRecord }) {
  return (
    <section className="section" id="proposal-values" aria-labelledby="proposal-values-heading">
      <h2 id="proposal-values-heading">Proposed values</h2>
      <dl className="audit-kv">
        <Fact label="Status"><StatusBadge status={proposal.status} /> (revision {proposal.revision})</Fact>
        <Fact label="Award"><span className="mono">{proposal.awardSlug}</span></Fact>
        <Fact label="Season">{proposal.season}</Fact>
        <Fact label="Source name">{proposal.playerNameRaw}</Fact>
        <Fact label="Stable identity">
          {proposal.playerIdentity === null
            ? <span className="muted">unresolved — link the player first (/admin/player-links)</span>
            : <span className="mono" style={{ overflowWrap: 'anywhere' }}>{proposal.playerIdentity}</span>}
        </Fact>
        <Fact label="Club">{proposal.clubSlug === null ? '—' : <span className="mono">{proposal.clubSlug}</span>}</Fact>
        <Fact label="Votes / value">{proposal.votes ?? NOT_RECORDED}</Fact>
        <Fact label="Position">{proposal.position ?? '—'}</Fact>
        <Fact label="Captain / vice-captain">{proposal.isCaptain ? 'captain' : proposal.isViceCaptain ? 'vice-captain' : 'neither'}</Fact>
        <Fact label="Note">{proposal.note ?? '—'}</Fact>
        <Fact label="Duplicate confirmed">{proposal.duplicateConfirmed ? 'yes (a legitimate repeat was confirmed)' : 'no'}</Fact>
        <Fact label="Created">{formatInstant(proposal.createdAt)} by user #{proposal.createdBy}</Fact>
        {proposal.approvedEntityKey !== null && (
          <Fact label="Approved as"><span className="mono" style={{ overflowWrap: 'anywhere' }}>{proposal.approvedEntityKey}</span> at {formatInstant(proposal.approvedAt)}</Fact>
        )}
      </dl>
    </section>
  );
}

export function ProposalEvidence({ proposal }: { proposal: ProposalRecord }) {
  return (
    <section className="section" id="proposal-evidence" aria-labelledby="proposal-evidence-heading">
      <h2 id="proposal-evidence-heading">Evidence</h2>
      <dl className="audit-kv">
        <Fact label="Source kind"><span className="mono">{proposal.sourceKind}</span></Fact>
        <Fact label="Source URL">{proposal.sourceUrl === null ? '—' : <span className="mono" style={{ overflowWrap: 'anywhere' }}>{proposal.sourceUrl}</span>}</Fact>
        <Fact label="Citation">{proposal.citation ?? '—'}</Fact>
        <Fact label="Acquired on">{proposal.acquiredOn}</Fact>
      </dl>
      {proposal.sourceKind === 'wikipedia_offline_file' && (
        <p className="notice">
          Wikipedia-derived input is never self-certifying: approving it needs a decision note
          recording the independent source that verified it.
        </p>
      )}
    </section>
  );
}

export function ProposalValidation({ proposal }: { proposal: ProposalRecord }) {
  const result = proposal.validationResult;
  return (
    <section className="section" id="proposal-validation" aria-labelledby="proposal-validation-heading">
      <h2 id="proposal-validation-heading">Validation</h2>
      {result === null ? (
        <p className="muted">Not validated yet. Validation checks the player identity, award, season, club and duplicates against the database.</p>
      ) : (
        <>
          <p>
            <span className={result.ok ? 'badge' : 'badge badge-danger'}>{result.ok ? 'Passed' : 'Failed'}</span>
            {' '}checked {formatInstant(result.checkedAt)}.
          </p>
          {result.issues.length === 0 ? (
            <p className="muted">No issues.</p>
          ) : (
            <ul className="ruled-list">
              {result.issues.map((issue, index) => (
                <li key={`${issue.code}-${index}`}>
                  <span className={issue.severity === 'error' ? 'badge badge-danger' : 'badge badge-warn'}>{issue.severity}</span>{' '}
                  <span className="mono">{issue.code}</span>
                  {issue.field !== undefined && <> on <span className="mono">{issue.field}</span></>}: {issue.message}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function revisionOf(decision: DecisionRecord, history: ProposalHistory): string {
  const revision = history.revisions.find((candidate) => candidate.id === decision.proposalId);
  return revision === undefined ? `#${decision.proposalId}` : `#${decision.proposalId} (rev ${revision.revision})`;
}

export function ProposalHistoryView({ history }: { history: ProposalHistory }) {
  return (
    <section className="section" id="proposal-history" aria-labelledby="proposal-history-heading">
      <h2 id="proposal-history-heading">Revision and decision history</h2>
      <p className="section-note">
        The ledger is append-only: every create, validation, revision, approval and rejection is a
        row here, oldest first, naming the administrator by user id.
      </p>
      <h3>Revisions</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col" className="num">#</th>
              <th scope="col" className="num">Revision</th>
              <th scope="col">Status</th>
              <th scope="col">Created</th>
              <th scope="col">Updated</th>
            </tr>
          </thead>
          <tbody>
            {history.revisions.map((revision) => (
              <tr key={revision.id}>
                <td className="num"><Link href={proposalHref(revision.id)}>#{revision.id}</Link></td>
                <td className="num">{revision.revision}</td>
                <td><StatusBadge status={revision.status} /></td>
                <td className="nowrap">{formatInstant(revision.createdAt)}</td>
                <td className="nowrap">{formatInstant(revision.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Decisions</h3>
      {history.decisions.length === 0 ? (
        <p className="muted">No decisions recorded.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Action</th>
                <th scope="col">Proposal</th>
                <th scope="col">From → to</th>
                <th scope="col">By</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {history.decisions.map((decision) => (
                <tr key={decision.id}>
                  <td className="nowrap">{formatInstant(decision.decidedAt)}</td>
                  <td className="mono">{decision.action}</td>
                  <td>{revisionOf(decision, history)}</td>
                  <td className="nowrap">{decision.fromStatus ?? 'new'} → {decision.toStatus}</td>
                  <td>user #{decision.adminUserId}</td>
                  <td>{decision.note ?? <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
