// app | Pure presentation of the revise approved winner panel for curated awards
// Soft size threshold: 500 LOC. Run `phaneslight loc-check` if uncertain.
import type { ProposalRecord } from '@afldb/admin';

import type { CuratedActionState } from '../action-state';
import { describeConsequences } from '../consequences';

import { ActionConsequences } from './ActionConsequences';
import type { FormBinding } from './OperationForms';
import { ActionOutcome, FieldError } from './Shared';

/**
 * The revise-approved-winner panel (AFLDB V2 Launch F, V2-GAP-018; ADR 0008). PURE: props in, markup
 * out, no hooks. The Client wrapper in `OperationsClientForms.tsx` supplies the binding from
 * `useActionState`; a test supplies synthetic ones. Class names are the existing globals.css ones.
 *
 * Offered only to a viewer holding `data.awards.edit` and only on the newest, approved revision;
 * {@link ReviseApprovedUnavailable} says why otherwise. The fields start from the approved values, and
 * the D9 action card above the button spells out what the submit will do BEFORE it is pressed.
 */

const textareaStyle = { width: '100%', font: 'inherit', padding: '0.55rem 0.7rem' } as const;

export function ReviseApprovedPanelView({
  proposal, actingEmail, sealedSeason, binding,
}: {
  proposal: ProposalRecord;
  actingEmail: string;
  /** True/false when the season registry could be read; null when it could not (it fails closed). */
  sealedSeason: boolean | null;
  binding: FormBinding<CuratedActionState>;
}) {
  const { state, pending, onSubmit } = binding;
  const context = {
    actingEmail,
    proposalId: proposal.id,
    season: proposal.season,
    proposalStatus: proposal.status,
    sealedSeason,
  };
  return (
    <section className="section" id="revise-approved" aria-labelledby="revise-approved-heading">
      <h2 id="revise-approved-heading">Revise approved winner</h2>
      <p className="section-note">
        This winner is already in the public record. Changing the votes, position, captaincy, note or
        club corrects the row in place. Changing the award, season, player or the source&apos;s player
        name voids the row and records a replacement, so the mistake stays visible as history. If the
        player is not linked to a stable identity, link it first in /admin/player-links, then revise here.
      </p>
      <ActionConsequences consequences={describeConsequences('revise_approved_winner', context)} />
      <form onSubmit={onSubmit} aria-describedby="revise-approved-heading">
        <input type="hidden" name="proposalId" value={proposal.id} />
        <fieldset className="filter-group">
          <legend>Who and what</legend>
          <div className="filter-grid">
            <div>
              <label htmlFor="revise-award">Award (slug)</label>
              <input id="revise-award" name="awardSlug" type="text" defaultValue={proposal.awardSlug} disabled={pending} />
              <FieldError state={state} name="awardSlug" />
            </div>
            <div>
              <label htmlFor="revise-season">Season</label>
              <input id="revise-season" name="season" type="text" inputMode="numeric" maxLength={4} defaultValue={String(proposal.season)} disabled={pending} />
              <FieldError state={state} name="season" />
            </div>
            <div>
              <label htmlFor="revise-player-name">Player (source name)</label>
              <input id="revise-player-name" name="playerNameRaw" type="text" defaultValue={proposal.playerNameRaw} disabled={pending} />
              <FieldError state={state} name="playerNameRaw" />
            </div>
            <div>
              <label htmlFor="revise-player-identity">Stable player identity</label>
              <input id="revise-player-identity" name="playerIdentity" type="text" defaultValue={proposal.playerIdentity ?? ''} disabled={pending} />
              <FieldError state={state} name="playerIdentity" />
            </div>
            <div>
              <label htmlFor="revise-club">Club (slug)</label>
              <input id="revise-club" name="clubSlug" type="text" defaultValue={proposal.clubSlug ?? ''} disabled={pending} />
              <FieldError state={state} name="clubSlug" />
            </div>
          </div>
        </fieldset>
        <fieldset className="filter-group">
          <legend>Value</legend>
          <div className="filter-grid">
            <div>
              <label htmlFor="revise-votes">Votes / value (blank = not recorded)</label>
              <input id="revise-votes" name="votes" type="text" inputMode="decimal" defaultValue={proposal.votes ?? ''} disabled={pending} />
              <FieldError state={state} name="votes" />
            </div>
            <div>
              <label htmlFor="revise-position">Position</label>
              <input id="revise-position" name="position" type="text" defaultValue={proposal.position ?? ''} disabled={pending} />
              <FieldError state={state} name="position" />
            </div>
          </div>
          <p>
            <label htmlFor="revise-captain">
              <input id="revise-captain" name="isCaptain" type="checkbox" defaultChecked={proposal.isCaptain} disabled={pending} />
              {' '}Captain
            </label>
            {' '}
            <label htmlFor="revise-vice">
              <input id="revise-vice" name="isViceCaptain" type="checkbox" defaultChecked={proposal.isViceCaptain} disabled={pending} />
              {' '}Vice-captain
            </label>
          </p>
          <p>
            <label htmlFor="revise-duplicate">
              <input id="revise-duplicate" name="duplicateConfirmed" type="checkbox" defaultChecked={proposal.duplicateConfirmed} disabled={pending} />
              {' '}Confirm a legitimate repeat of this player in this award and season
            </label>
          </p>
          <p>
            <label htmlFor="revise-note">Note on the winner (public citation)</label>
            <textarea id="revise-note" name="note" rows={2} style={textareaStyle} defaultValue={proposal.note ?? ''} disabled={pending} />
            <FieldError state={state} name="note" />
          </p>
        </fieldset>
        <fieldset className="filter-group">
          <legend>Evidence</legend>
          <div className="filter-grid">
            <div>
              <label htmlFor="revise-source-kind">Source kind</label>
              <select id="revise-source-kind" name="sourceKind" defaultValue={proposal.sourceKind} disabled={pending}>
                <option value="manual_entry">Manual entry</option>
                <option value="offline_file">Offline file</option>
                <option value="wikipedia_offline_file">Wikipedia-derived offline file</option>
              </select>
              <FieldError state={state} name="sourceKind" />
            </div>
            <div>
              <label htmlFor="revise-source-url">Source URL</label>
              <input id="revise-source-url" name="sourceUrl" type="text" defaultValue={proposal.sourceUrl ?? ''} disabled={pending} />
              <FieldError state={state} name="sourceUrl" />
            </div>
            <div>
              <label htmlFor="revise-citation">Citation</label>
              <input id="revise-citation" name="citation" type="text" defaultValue={proposal.citation ?? ''} disabled={pending} />
              <FieldError state={state} name="citation" />
            </div>
            <div>
              <label htmlFor="revise-acquired">Acquired on (YYYY-MM-DD)</label>
              <input id="revise-acquired" name="acquiredOn" type="text" inputMode="numeric" placeholder="YYYY-MM-DD" defaultValue={proposal.acquiredOn} disabled={pending} />
              <FieldError state={state} name="acquiredOn" />
            </div>
          </div>
        </fieldset>
        <p>
          <label htmlFor="revise-decision-note">Why is the approved record being changed? (20 to 2000 characters, required)</label>
          <textarea id="revise-decision-note" name="decisionNote" rows={3} style={textareaStyle} disabled={pending} />
          <FieldError state={state} name="decisionNote" />
          <FieldError state={state} name="proposalId" />
        </p>
        <button className="btn btn-danger" type="submit" disabled={pending}>
          {pending ? 'Revising…' : 'Revise the approved winner'}
        </button>
      </form>
      <ActionOutcome state={state} />
      {state.entityKey !== undefined && (
        <p className="muted" data-revision-result={state.mode ?? 'unknown'}>
          Winner row now <span className="mono" style={{ overflowWrap: 'anywhere' }}>{state.entityKey}</span>
          {state.mode === 'replace' ? ' (a replacement; the previous row is void)' : ''}
          {state.proposal === undefined ? '' : `, recorded as proposal #${state.proposal.id} (revision ${state.proposal.revision})`}
          {state.sealedSeason === true ? ' (an audited correction of a sealed season)' : ''}.
        </p>
      )}
      {state.revalidatePaths !== undefined && state.revalidatePaths.length > 0 && (
        <p className="muted" data-revalidated-paths="true">
          Public pages refreshed: <span className="mono" style={{ overflowWrap: 'anywhere' }}>{state.revalidatePaths.join(' ')}</span>
        </p>
      )}
    </section>
  );
}

/** Why the revise panel is not offered: shown instead of the panel, never silently omitted. */
export function ReviseApprovedUnavailable({ reason }: { reason: 'permission' | 'not_newest' }) {
  return (
    <section className="section" id="revise-approved" aria-labelledby="revise-approved-heading">
      <h2 id="revise-approved-heading">Revise approved winner</h2>
      <p className="muted" data-revise-unavailable={reason}>
        {reason === 'permission'
          ? 'Revising an approved winner is a Super Admin action. You can read this proposal and its history.'
          : 'Only the newest revision of an approved proposal can be revised. Open the newest revision from the history below.'}
      </p>
    </section>
  );
}
