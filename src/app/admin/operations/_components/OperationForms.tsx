import type { FormEventHandler } from 'react';

import type { ProposalRecord } from '@afldb/admin';

import type { ColemanActionState, CuratedActionState } from '../action-state';
import { describeConsequences } from '../consequences';

import { ActionConsequences } from './ActionConsequences';
import { ColemanComparisonResult, ColemanProjectionOutcome } from './ColemanViews';
import { ActionOutcome, FieldError } from './Shared';

/**
 * The presentational halves of the operations-centre forms (AFLDB V2 Stage 5, plan D9).
 *
 * PURE: props in, markup out, no hooks. The Client Component wrappers in
 * `OperationsClientForms.tsx` supply `state`, `pending` and `onSubmit` from `useActionState`; a test
 * (or the capture step) supplies SYNTHETIC ones, so every form renders without a browser, a session
 * or a database.
 *
 * Every mutation form shows its D9 action card (what it changes, the affected season or records, the
 * validation state, whether it is reversible, the acting user, the audit entries) BEFORE the submit
 * control, and after a submit shows the outcome, its codes and any audit warning. This module imports
 * only erased types, `consequences.ts` and other pure components, so nothing server-only can reach a
 * browser bundle through it.
 */

export type FormBinding<S> = {
  state: S;
  pending: boolean;
  /** Set by the Client wrapper; absent in static markup. */
  onSubmit?: FormEventHandler<HTMLFormElement>;
};

const textareaStyle = { width: '100%', font: 'inherit', padding: '0.55rem 0.7rem' } as const;

/* ------------------------------------------------------------------ *
 * Create proposals from a local file
 * ------------------------------------------------------------------ */

export function CreateProposalsFormView({
  actingEmail, binding,
}: {
  actingEmail: string;
  binding: FormBinding<CuratedActionState>;
}) {
  const { state, pending, onSubmit } = binding;
  return (
    <section className="section" id="create-proposals" aria-labelledby="create-proposals-heading">
      <h2 id="create-proposals-heading">Create proposals from a local file</h2>
      <p className="section-note">
        Supply a proposal file you prepared offline (JSON or CSV), or paste its text. The file goes
        to this server as form data; nothing is fetched from the internet. It creates proposals only:
        none is validated or approved here.
      </p>
      <ActionConsequences consequences={describeConsequences('create_proposals', { actingEmail })} />
      <form onSubmit={onSubmit} aria-describedby="create-proposals-heading">
        <div className="filter-grid">
          <div>
            <label htmlFor="create-format">File format</label>
            <select id="create-format" name="format" defaultValue="json" disabled={pending}>
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
            </select>
            <FieldError state={state} name="format" />
          </div>
          <div>
            <label htmlFor="create-file">Proposal file (a local file)</label>
            <input id="create-file" name="file" type="file" accept=".json,.csv,application/json,text/csv" disabled={pending} />
            <FieldError state={state} name="file" />
          </div>
        </div>
        <p>
          <label htmlFor="create-text">…or the file&apos;s text, pasted</label>
          <textarea id="create-text" name="text" rows={6} style={textareaStyle} disabled={pending} />
        </p>
        <fieldset className="filter-group">
          <legend>Defaults for rows that do not carry their own</legend>
          <div className="filter-grid">
            <div>
              <label htmlFor="create-source-kind">Source kind</label>
              <select id="create-source-kind" name="sourceKind" defaultValue="" disabled={pending}>
                <option value="">From each row</option>
                <option value="offline_file">Offline file</option>
                <option value="wikipedia_offline_file">Wikipedia-derived offline file</option>
              </select>
              <FieldError state={state} name="sourceKind" />
            </div>
            <div>
              <label htmlFor="create-source-url">Source URL</label>
              <input id="create-source-url" name="sourceUrl" type="text" disabled={pending} />
              <FieldError state={state} name="sourceUrl" />
            </div>
            <div>
              <label htmlFor="create-citation">Citation</label>
              <input id="create-citation" name="citation" type="text" disabled={pending} />
              <FieldError state={state} name="citation" />
            </div>
            <div>
              <label htmlFor="create-acquired">Acquired on (YYYY-MM-DD)</label>
              <input id="create-acquired" name="acquiredOn" type="text" inputMode="numeric" placeholder="YYYY-MM-DD" disabled={pending} />
              <FieldError state={state} name="acquiredOn" />
            </div>
          </div>
        </fieldset>
        <p>
          <label htmlFor="create-note">Decision note (optional)</label>
          <textarea id="create-note" name="decisionNote" rows={2} style={textareaStyle} disabled={pending} />
          <FieldError state={state} name="decisionNote" />
        </p>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create proposals (nothing is approved)'}
        </button>
      </form>
      <ActionOutcome state={state} />
      {state.proposals !== undefined && state.proposals.length > 0 && (
        <ul className="ruled-list" aria-label="Created proposals">
          {state.proposals.map((proposal) => (
            <li key={proposal.id}>
              Proposal #{proposal.id}: season {proposal.season}, <span className="mono">{proposal.awardSlug}</span>, {proposal.playerNameRaw} ({proposal.status})
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Validate, approve, reject
 * ------------------------------------------------------------------ */

const UNDECIDED = ['proposed', 'validated', 'validation_failed'] as const;
const isUndecided = (status: ProposalRecord['status']): boolean => (UNDECIDED as readonly string[]).includes(status);

export function DecisionPanelView({
  proposal, actingEmail, sealedSeason, binding, viewerCreatedRevision = false,
}: {
  proposal: ProposalRecord;
  actingEmail: string;
  /** True/false when the season registry could be read; null when it could not (it fails closed). */
  sealedSeason: boolean | null;
  binding: FormBinding<CuratedActionState>;
  /** V2-GAP-019: the signed-in administrator created this revision, so approving it needs an attestation. */
  viewerCreatedRevision?: boolean;
}) {
  const { state, pending, onSubmit } = binding;
  const undecided = isUndecided(proposal.status);
  const canApprove = proposal.status === 'validated';
  const context = {
    actingEmail,
    proposalId: proposal.id,
    season: proposal.season,
    proposalStatus: proposal.status,
    sealedSeason,
  };

  return (
    <section className="section" id="decision-panel" aria-labelledby="decision-panel-heading">
      <h2 id="decision-panel-heading">Decide this proposal</h2>
      <p className="section-note">
        Validate, approve and reject are separate actions with separate consequences; read the card
        above each button. The decision note below is sent with whichever you press.
      </p>
      <form onSubmit={onSubmit}>
        <input type="hidden" name="proposalId" value={proposal.id} />
        <p>
          <label htmlFor="decision-note">Decision note</label>
          <textarea id="decision-note" name="decisionNote" rows={3} style={textareaStyle} disabled={pending} />
          <FieldError state={state} name="decisionNote" />
          <FieldError state={state} name="proposalId" />
        </p>

        <h3>Validate</h3>
        <ActionConsequences consequences={describeConsequences('validate_proposal', context)} />
        <p>
          <button className="btn btn-secondary" type="submit" name="intent" value="validate" disabled={pending || !undecided}>
            Validate against the database
          </button>
          {!undecided && <span className="muted"> Only an undecided proposal can be validated; this one is {proposal.status}.</span>}
        </p>

        <h3>Approve</h3>
        <ActionConsequences consequences={describeConsequences('approve_proposal', context)} />
        {viewerCreatedRevision && canApprove && (
          <div data-self-approval="true">
            <p className="notice" role="note">
              You created this revision. Four eyes: another administrator should approve it. As a
              Super Admin you may approve your own revision only by attesting below why a second
              reviewer is not used (at least 20 characters). The attestation is recorded in the
              decision ledger as a self-approval.
            </p>
            <p>
              <label htmlFor="self-approval-attestation">Self-approval attestation</label>
              <textarea id="self-approval-attestation" name="selfApprovalAttestation" rows={3} style={textareaStyle} disabled={pending} />
              <FieldError state={state} name="selfApprovalAttestation" />
            </p>
          </div>
        )}
        <p>
          <button className="btn" type="submit" name="intent" value="approve" disabled={pending || !canApprove}>
            Approve into the public record
          </button>
          {!canApprove && <span className="muted"> Approval needs a validated proposal; this one is {proposal.status}.</span>}
        </p>

        <h3>Reject</h3>
        <ActionConsequences consequences={describeConsequences('reject_proposal', context)} />
        <p>
          <button className="btn btn-danger" type="submit" name="intent" value="reject" disabled={pending || !undecided}>
            Reject this proposal
          </button>
          {!undecided && <span className="muted"> Only an undecided proposal can be rejected; this one is {proposal.status}.</span>}
        </p>
      </form>
      <ActionOutcome state={state} />
      {state.entityKey !== undefined && (
        <p className="muted">
          Written as <span className="mono">{state.entityKey}</span>
          {state.sealedSeason === true ? ' (an audited correction of a sealed season)' : ''}
          {state.selfApproval === true ? ' (self-approved with an attestation)' : ''}.
        </p>
      )}
      {state.revalidatePaths !== undefined && state.revalidatePaths.length > 0 && state.entityKey !== undefined && (
        <p className="muted" data-revalidated-paths="true">
          Public pages refreshed: <span className="mono" style={{ overflowWrap: 'anywhere' }}>{state.revalidatePaths.join(' ')}</span>
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Coleman: compare (read-only) and publish
 * ------------------------------------------------------------------ */

function comparisonContext(state: ColemanActionState) {
  const comparison = state.comparison;
  const category = comparison?.report.seasons[0]?.category;
  if (comparison === undefined || category === undefined) return null;
  const preview = comparison.projection;
  return {
    season: comparison.season,
    category,
    plan: comparison.plan,
    sealed: comparison.sealed,
    projection: preview === null || preview === undefined
      ? null
      : preview.ok
        ? { ok: true as const, ...preview.counts }
        : { ok: false as const, code: preview.refusal.code },
  };
}

export function ColemanWorkbenchView({
  canPublish, actingEmail, defaultSeason, compare, publish,
}: {
  canPublish: boolean;
  actingEmail: string;
  defaultSeason: number | null;
  compare: FormBinding<ColemanActionState>;
  publish: FormBinding<ColemanActionState>;
}) {
  const season = defaultSeason === null ? '' : String(defaultSeason);
  return (
    <>
      <section className="section" id="coleman-compare" aria-labelledby="coleman-compare-heading">
        <h2 id="coleman-compare-heading">Compare a season (read-only)</h2>
        <p className="section-note">
          Derives the Coleman Medal result for one sealed season from the database and compares it
          with the stored Coleman winners and the current publication. It publishes, writes and audits
          nothing, so any Admin may run it.
        </p>
        <form onSubmit={compare.onSubmit}>
          <div className="filter-grid">
            <div>
              <label htmlFor="compare-season">Season</label>
              <input id="compare-season" name="season" type="text" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="YYYY" defaultValue={season} disabled={compare.pending} />
              <FieldError state={compare.state} name="season" />
            </div>
          </div>
          <p>
            <label htmlFor="compare-settled">
              <input id="compare-settled" name="settled" type="checkbox" disabled={compare.pending} />
              {' '}I confirm this season is settled: every promotion and settle for it has concluded.
            </label>
            <FieldError state={compare.state} name="settled" />
          </p>
          <button className="btn btn-secondary" type="submit" disabled={compare.pending}>
            {compare.pending ? 'Comparing…' : 'Compare (read-only)'}
          </button>
        </form>
        <ActionOutcome state={compare.state} />
        {compare.state.comparison !== undefined && <ColemanComparisonResult comparison={compare.state.comparison} />}
      </section>

      <section className="section" id="coleman-publish" aria-labelledby="coleman-publish-heading">
        <h2 id="coleman-publish-heading">Publish a derived result</h2>
        {!canPublish ? (
          <p className="muted" data-publish-unavailable="true">
            Publishing is a Super Admin action. You can compare seasons, but this form is not offered to your role.
          </p>
        ) : (
          <>
            <p className="section-note">
              Publishing records the derivation as an append-only, audited correction and projects the
              derived winners into the public Coleman rows in the same transaction. Compare the season
              first: the card below shows how many rows it would insert, update, void or leave alone.
            </p>
            {compare.state.comparison === undefined && (
              <p className="muted" data-publish-empty="true">
                No season has been compared in this session. Compare a season above to see its effect
                before you publish.
              </p>
            )}
            <ActionConsequences
              consequences={describeConsequences('publish_coleman', {
                actingEmail,
                season: null,
                comparison: comparisonContext(compare.state),
              })}
            />
            <form onSubmit={publish.onSubmit}>
              <div className="filter-grid">
                <div>
                  <label htmlFor="publish-season">Season</label>
                  <input id="publish-season" name="season" type="text" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="YYYY" defaultValue={season} disabled={publish.pending} />
                  <FieldError state={publish.state} name="season" />
                </div>
              </div>
              <p>
                <label htmlFor="publish-settled">
                  <input id="publish-settled" name="settled" type="checkbox" disabled={publish.pending} />
                  {' '}I confirm this season is settled: every promotion and settle for it has concluded.
                </label>
                <FieldError state={publish.state} name="settled" />
              </p>
              <p>
                <label htmlFor="publish-note">Reason for publishing (recorded in the audit)</label>
                <textarea id="publish-note" name="note" rows={3} style={textareaStyle} disabled={publish.pending} />
                <FieldError state={publish.state} name="note" />
              </p>
              <button className="btn" type="submit" disabled={publish.pending}>
                {publish.pending ? 'Publishing…' : 'Publish the derived result'}
              </button>
            </form>
            <ActionOutcome state={publish.state} />
            {publish.state.publication !== undefined && (
              <dl className="audit-kv" data-publication-result={publish.state.publication.outcome}>
                <dt>Outcome</dt>
                <dd><span className="mono">{publish.state.publication.outcome}</span> — row #{publish.state.publication.id}{publish.state.publication.supersededId === null ? '' : `, superseding #${publish.state.publication.supersededId}`}</dd>
                <dt>Season</dt>
                <dd>{publish.state.publication.season}</dd>
                <dt>Winners</dt>
                <dd className="mono" style={{ overflowWrap: 'anywhere' }}>{publish.state.publication.winnerKeys.join(', ') || 'none'}</dd>
                {publish.state.publication.projection !== undefined && (
                  <ColemanProjectionOutcome projection={publish.state.publication.projection} />
                )}
                <dt>Evidence reference</dt>
                <dd className="mono" style={{ overflowWrap: 'anywhere' }}>{publish.state.publication.evidenceRef}</dd>
              </dl>
            )}
          </>
        )}
      </section>
    </>
  );
}
