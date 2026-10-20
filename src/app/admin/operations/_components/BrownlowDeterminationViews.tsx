import type { FormEventHandler, ReactNode } from 'react';

import type {
  BrownlowEligibilityStatus,
  BrownlowMedalStatus,
  BrownlowPlayerEligibility,
} from '@afldb/derived';

import type { BrownlowDeterminationView } from '@/lib/admin/operations-centre';

import { formatInstant } from '../format';
import type { BrownlowEligibilityActionState } from '../brownlow/action-state';
import { describeBrownlowEligibilityConsequences } from '../brownlow/eligibility-consequences';

import { ActionOutcome, FieldError } from './Shared';

/**
 * Pure presentation of the eligibility-aware Brownlow Medal determination and of the audited
 * eligibility decision form (AFLDB V2 Launch F F-D; docs/v2/adr/0014-brownlow-eligibility.md).
 *
 * PURE: props in, markup out, no hooks, no `server-only`, only erased type imports from the server
 * modules, so a Client Component may import it and a test can render it from synthetic props. Class
 * names are the existing `src/styles/globals.css` ones; this adds no CSS. A player appears by stable
 * id and durable identity only, never by name. Long identities wrap (`overflow-wrap: anywhere`).
 *
 * WHAT THE PAGE SAYS, AND DOES NOT. A winner is stated only when the status is `determined`. The
 * raw vote leaderboard is shown for EVERY vote-getter beside each player's eligibility status and
 * source. Recording a decision adds one ledger row and recomputes; it changes no raw vote and not the
 * published table.
 */

/** The rows of the raw leaderboard listed before the rest fold into a disclosure; every row is still shown. */
export const LEADERBOARD_VISIBLE_ROWS = 25;
/** The most ledger rows listed. */
export const DECISION_HISTORY_ROW_LIMIT = 50;

const wrap = { overflowWrap: 'anywhere' } as const;
const textareaStyle = { width: '100%', font: 'inherit', padding: '0.55rem 0.7rem' } as const;

export const MEDAL_STATUS_WORDS: Record<BrownlowMedalStatus, { label: string; text: string; ok: boolean }> = {
  determined: {
    label: 'Winner determined',
    text: 'The highest total among players who are eligible on authoritative evidence.',
    ok: true,
  },
  requires_review: {
    label: 'Requires review',
    text: 'The eligibility of a leading player is missing or ambiguous, so no winner is stated. An administrator can resolve it below.',
    ok: false,
  },
  no_eligible_winner: {
    label: 'No eligible winner',
    text: 'Every player who polled votes is ruled ineligible, so there is no winner.',
    ok: false,
  },
  season_incomplete: {
    label: 'Season in progress',
    text: 'A winner is not stated for a season that is not complete. The raw leaderboard below is the votes so far.',
    ok: false,
  },
  no_vote_evidence: {
    label: 'No vote evidence',
    text: 'No Brownlow votes are recorded for this season, so there is nothing to determine.',
    ok: false,
  },
  refused_whole_set: {
    label: 'Refused: unresolved evidence',
    text: 'A player or match in the vote evidence is unresolved, so nothing is totalled and no winner is stated.',
    ok: false,
  },
  refused_unreconciled_evidence: {
    label: 'Refused: evidence does not reconcile',
    text: 'The vote evidence has discrepancies (see the reconciliation below), so no winner is stated.',
    ok: false,
  },
};

const ELIGIBILITY_WORDS: Record<BrownlowEligibilityStatus, string> = {
  eligible: 'eligible',
  ineligible: 'ineligible',
  missing: 'unknown (not recorded)',
  ambiguous: 'unknown (ambiguous)',
};

const SOURCE_WORDS: Record<BrownlowPlayerEligibility['source'], string> = {
  admin_decision: 'Administrator decision',
  stored_season_votes: 'Stored season table',
  provider_snapshot: 'AFL API snapshot (provider evidence)',
  none: '—',
};

function eligibilityBadge(status: BrownlowEligibilityStatus): ReactNode {
  return (
    <span className={status === 'eligible' ? 'badge' : status === 'ineligible' ? 'badge badge-danger' : 'badge badge-warn'} data-eligibility={status}>
      {ELIGIBILITY_WORDS[status]}
    </span>
  );
}

/** A player the page offers a decision for, with everything the card needs. */
export type ReviewPlayerView = {
  playerId: number;
  votes: number;
  status: 'missing' | 'ambiguous';
  reason: string;
  identityState: 'resolved' | 'missing' | 'ambiguous';
  identity: string | null;
  /** The decision the form is rendered against (the current one), or null. */
  currentDecisionId: number | null;
  currentVerdict: 'eligible' | 'ineligible' | null;
};

/** The players requiring review, joined with their identity and current decision. Pure. */
export function reviewPlayersOf(view: BrownlowDeterminationView): ReviewPlayerView[] {
  const identities = new Map(view.identities.map((identity) => [identity.playerId, identity]));
  const currentByIdentity = new Map(view.decisions.filter((decision) => decision.current).map((decision) => [decision.playerIdentity, decision]));
  // Every unknown vote-getter needs a decision before ranks can be published, not only the deciding group.
  return view.determination.unresolvedPlayers.map((player) => {
    const identity = identities.get(player.playerId);
    const current = identity?.identity == null ? undefined : currentByIdentity.get(identity.identity);
    return {
      playerId: player.playerId,
      votes: player.votes,
      status: player.status,
      reason: player.reason,
      identityState: identity?.state ?? 'missing',
      identity: identity?.identity ?? null,
      currentDecisionId: current === undefined ? null : current.id,
      currentVerdict: current === undefined ? null : current.verdict,
    };
  });
}

/* ------------------------------------------------------------------ *
 * The determination
 * ------------------------------------------------------------------ */

export function MedalDeterminationSection({
  view, reviewPanel,
}: {
  view: BrownlowDeterminationView;
  /** Rendered inside the "Players requiring review" section (the Client Component workbench). */
  reviewPanel: ReactNode;
}) {
  const determination = view.determination;
  const words = MEDAL_STATUS_WORDS[determination.status];
  const leaderboard = determination.rawLeaderboard;
  const visible = leaderboard.slice(0, LEADERBOARD_VISIBLE_ROWS);
  const folded = leaderboard.slice(LEADERBOARD_VISIBLE_ROWS);
  const decisions = view.decisions.slice(-DECISION_HISTORY_ROW_LIMIT);

  return (
    <div data-brownlow-determination={view.season} data-medal-status={determination.status}>
      <section className="section" id="brownlow-medal" aria-labelledby="brownlow-medal-heading">
        <h2 id="brownlow-medal-heading">Medal determination (eligibility-aware), season {view.season}</h2>
        <p className="section-note">
          Every player&apos;s raw votes are kept. A player is left out of the winner only when
          authoritative evidence (an administrator decision, a recorded stored statement or a consistent
          explicit AFL API flag) marks them ineligible. Eligibility is eligible, ineligible or unknown;
          unknown is never treated as either. If an unknown player could change the winner, no winner is
          invented and the result asks for a review.
        </p>
        <dl className="audit-kv">
          <dt>Status</dt>
          <dd>
            <span className={words.ok ? 'badge' : 'badge badge-warn'} data-medal-status-badge={determination.status}>{words.label}</span>
            {' '}{words.text}
          </dd>
          <dt>{determination.tie === true ? 'Joint winners' : 'Winner'}</dt>
          <dd data-medal-winners="true">
            {determination.status !== 'determined'
              ? 'none stated'
              : determination.winners.map((winner) => `player ${winner.playerId} (${winner.votes} votes)`).join(', ')}
            {determination.tie === true && ' — a tie between eligible leaders; no tie-break exists'}
          </dd>
          <dt>Season</dt>
          <dd>
            {view.report.seasonState === 'complete' ? 'complete' : 'in progress'}
            {view.sealed ? ', sealed (a decision is an audited correction)' : ', open'}
            {view.seasonAdminPublished ? ', published by an administrator' : ''}
          </dd>
          <dt>Vote evidence</dt>
          <dd><span className="mono">{view.report.basis ?? 'none'}</span>, {view.report.voteGetters} vote-getters</dd>
          <dt>Input checksum</dt>
          <dd className="mono" style={wrap}>{determination.inputChecksum}</dd>
          <dt>Computed</dt>
          <dd>{formatInstant(view.generatedAt)}</dd>
        </dl>
        {determination.status === 'refused_unreconciled_evidence' && determination.blockingFindings.length > 0 && (
          <p className="notice" data-medal-blocking="true">
            Blocking findings ({determination.blockingFindingCount}):{' '}
            <span className="mono" style={wrap}>
              {determination.blockingFindings.map((finding) => `${finding.code}${finding.playerId === null ? '' : ` (player ${finding.playerId})`}`).join(', ')}
            </span>
          </p>
        )}
        {view.storedFlagCheck.state === 'disagrees' && (
          <p className="notice" role="note" data-stored-flag-disagreement="true">
            <strong>The stored winner flags disagree with this determination.</strong> The stored
            season table flags {view.storedFlagCheck.storedWinners?.map((id) => `player ${id}`).join(', ') || 'no player'} as
            the winner; this determination names {view.storedFlagCheck.determinedWinners.map((id) => `player ${id}`).join(', ')}.
            This read changed nothing. An authorised eligibility decision recomputes and publishes
            the medal flags transactionally, preserving raw votes.
          </p>
        )}
        {view.storedFlagCheck.state === 'agrees' && (
          <p className="muted" data-stored-flag-agreement="true">The stored winner flags agree with this determination.</p>
        )}
        {determination.unresolvedPlayers.length > 0 && (
          <p className="notice" role="note" data-ranking-indeterminate="true">
            <strong>Eligible ranks are not stated and nothing is published.</strong>{' '}
            {determination.unresolvedPlayers.length} vote-getter{determination.unresolvedPlayers.length === 1 ? ' has' : 's have'} unknown
            eligibility ({determination.unresolvedPlayers.map((player) => `player ${player.playerId}, ${player.votes} votes`).join('; ')}).
            {determination.status === 'determined'
              ? ' The winner is unaffected because no unknown player polled as many votes as the winner, but every eligible rank below an unknown player is uncertain.'
              : ''}
            {' '}The stored winner flags and eligible ranks are left exactly as they were until each one is resolved by an audited decision.
          </p>
        )}
        {determination.excludedIneligible.length > 0 && (
          <p className="section-note" data-medal-excluded="true">
            Excluded as ineligible (their votes are still in the leaderboard):{' '}
            {determination.excludedIneligible.map((entry) => `player ${entry.playerId} (${entry.votes} votes)`).join(', ')}.
          </p>
        )}
      </section>

      <section className="section" id="brownlow-review" aria-labelledby="brownlow-review-heading">
        <h2 id="brownlow-review-heading">Players requiring review</h2>
        {determination.unresolvedPlayers.length === 0 && (
          <p className="muted" data-no-review="true">No player needs an eligibility decision for this season right now.</p>
        )}
        {reviewPanel}
      </section>

      <section className="section" id="brownlow-leaderboard" aria-labelledby="brownlow-leaderboard-heading">
        <h2 id="brownlow-leaderboard-heading">Raw vote leaderboard</h2>
        <p className="section-note">
          Every vote-getter, exactly as the evidence reports, with the eligibility status that applies
          and where it comes from. Ineligible players are listed, never dropped.
        </p>
        {leaderboard.length === 0 ? (
          <p className="muted" data-empty-leaderboard="true">No vote totals could be formed for this season.</p>
        ) : (
          <>
            <LeaderboardTable rows={visible} />
            {folded.length > 0 && (
              <details>
                <summary>Show the other {folded.length} vote-getters</summary>
                <LeaderboardTable rows={folded} />
              </details>
            )}
          </>
        )}
      </section>

      <section className="section" id="brownlow-decisions" aria-labelledby="brownlow-decisions-heading">
        <h2 id="brownlow-decisions-heading">Eligibility decisions for {view.season}</h2>
        {view.decisions.length === 0 ? (
          <p className="muted" data-no-decisions="true">No administrator has recorded an eligibility decision for this season.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col" className="num">Decision</th>
                    <th scope="col" className="num">Player id</th>
                    <th scope="col">Verdict</th>
                    <th scope="col">Basis</th>
                    <th scope="col">Decided</th>
                    <th scope="col">Citation</th>
                    <th scope="col">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {decisions.map((decision) => (
                    <tr key={decision.id} data-decision-current={decision.current}>
                      <td className="num">#{decision.id}{decision.current ? '' : ' (superseded)'}</td>
                      <td className="num">{decision.playerIdAtDecision}</td>
                      <td>{eligibilityBadge(decision.verdict)}</td>
                      <td className="mono">{decision.basis}</td>
                      <td>{formatInstant(decision.decidedAt)} by user {decision.decidedBy}</td>
                      <td style={wrap}>{decision.citation}</td>
                      <td style={wrap}>{decision.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {view.decisions.length > decisions.length && (
              <p className="section-note">Showing the latest {decisions.length} of {view.decisions.length} decisions.</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function LeaderboardTable({ rows }: { rows: BrownlowDeterminationView['determination']['rawLeaderboard'] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col" className="num">Rank</th>
            <th scope="col" className="num">Player id</th>
            <th scope="col" className="num">Votes</th>
            <th scope="col" className="num">Eligible rank</th>
            <th scope="col">Eligibility</th>
            <th scope="col">Source</th>
            <th scope="col">Why</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((entry) => (
            <tr key={entry.playerId} data-leaderboard-player={entry.playerId}>
              <td className="num">{entry.rank}</td>
              <td className="num">{entry.playerId}</td>
              <td className="num">{entry.votes}</td>
              <td className="num" data-eligible-rank={entry.eligibleRank ?? 'not-stated'}>
                {entry.eligibleRank ?? (entry.eligibility.status === 'ineligible' ? '—' : 'not stated')}
              </td>
              <td>{eligibilityBadge(entry.eligibility.status)}</td>
              <td>{SOURCE_WORDS[entry.eligibility.source]}</td>
              <td style={wrap}>{entry.eligibility.detail.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The decision form
 * ------------------------------------------------------------------ */

export type DecisionFormBinding = {
  state: BrownlowEligibilityActionState;
  pending: boolean;
  /** Set by the Client wrapper; absent in static markup. */
  onSubmit?: FormEventHandler<HTMLFormElement>;
};

/** The action card, in the D9 six terms; same markup as the shared card. */
function DecisionCard({ consequences }: { consequences: ReturnType<typeof describeBrownlowEligibilityConsequences> }) {
  const c = consequences;
  return (
    <div className="notice" role="note" aria-label={`Consequences: ${c.title}`} data-consequences="brownlow_eligibility">
      <p style={{ margin: 0 }}><strong>Before you submit: {c.title}</strong></p>
      <dl className="audit-kv" style={{ margin: '0.6rem 0 0' }}>
        <dt>Will change</dt>
        <dd>
          <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {c.changes.map((change) => <li key={change}>{change}</li>)}
          </ul>
        </dd>
        <dt>Affects</dt>
        <dd style={wrap}>{c.affected}</dd>
        <dt>Validation</dt>
        <dd>{c.validationState}</dd>
        <dt>Reversible</dt>
        <dd>
          <span className="badge badge-warn">Not reversible</span>
          {' '}{c.reversibility}
        </dd>
        <dt>Acting user</dt>
        <dd style={wrap}>{c.actingUser}</dd>
        <dt>Audit entries</dt>
        <dd>
          {c.audit.durable}
          {' '}{c.audit.activity}
          {' '}
          <span className="mono" style={wrap}>{c.audit.activityActions.join(' · ')}</span>
        </dd>
      </dl>
    </div>
  );
}

/** The state of the form for ONE player: errors only on the form the last submit was about. */
function stateFor(state: BrownlowEligibilityActionState, playerId: number): BrownlowEligibilityActionState {
  return state.playerId === playerId ? state : { ...state, fieldErrors: undefined };
}

export function DecisionWorkbenchView({
  season, players, canDecide, actingEmail, sealedSeason, binding,
}: {
  season: number;
  players: readonly ReviewPlayerView[];
  canDecide: boolean;
  actingEmail: string;
  sealedSeason: boolean | null;
  binding: DecisionFormBinding;
}) {
  const { state } = binding;
  return (
    <div data-decision-workbench={season}>
      {state.decision !== undefined && (
        <div data-decision-result={state.decision.verdict}>
          <p className="notice" role="status">
            <strong>Decision #{state.decision.id} recorded.</strong>{' '}
            Verdict <span className="mono">{state.decision.verdict}</span>, basis{' '}
            <span className="mono">{state.decision.basis}</span>.
            {state.determination == null
              ? ' The determination could not be recomputed here; reload the page to see it.'
              : (
                <>
                  {' '}Recomputed determination: <strong>{MEDAL_STATUS_WORDS[state.determination.status].label}</strong>
                  {state.determination.status === 'determined' && (
                    <> — {state.determination.winners.map((winner) => `player ${winner.playerId} (${winner.votes} votes)`).join(', ')}{state.determination.tie === true ? ' (tie)' : ''}</>
                  )}
                  {state.determination.stillRequiringReview.length > 0 && (
                    <> — still needs review: {state.determination.stillRequiringReview.map((id) => `player ${id}`).join(', ')}</>
                  )}
                  .
                </>
              )}
          </p>
        </div>
      )}
      {/* The success notice is the result block above; this shows refusals, warnings and a failed recompute only. */}
      <ActionOutcome state={{ ...state, ok: undefined, message: undefined }} />
      {players.map((player) => (
        <DecisionCardForPlayer
          key={player.playerId}
          season={season}
          player={player}
          canDecide={canDecide}
          actingEmail={actingEmail}
          sealedSeason={sealedSeason}
          binding={{ ...binding, state: stateFor(state, player.playerId) }}
        />
      ))}
    </div>
  );
}

function DecisionCardForPlayer({
  season, player, canDecide, actingEmail, sealedSeason, binding,
}: {
  season: number;
  player: ReviewPlayerView;
  canDecide: boolean;
  actingEmail: string;
  sealedSeason: boolean | null;
  binding: DecisionFormBinding;
}) {
  const { state, pending, onSubmit } = binding;
  const id = `brownlow-${player.playerId}`;
  return (
    <div className="notice" data-review-player={player.playerId} style={{ marginTop: '0.8rem' }}>
      <p style={{ margin: 0 }}>
        <strong>Player {player.playerId}</strong>, {player.votes} votes —{' '}
        <span className="badge badge-warn" data-eligibility={player.status}>{ELIGIBILITY_WORDS[player.status]}</span>
      </p>
      <p style={{ margin: '0.4rem 0 0', ...wrap }}>{player.reason}</p>
      <dl className="audit-kv" style={{ margin: '0.6rem 0 0' }}>
        <dt>Durable identity</dt>
        <dd className="mono" style={wrap}>
          {player.identity ?? (player.identityState === 'ambiguous' ? 'ambiguous: more than one AFL Tables identity' : 'none held')}
        </dd>
        <dt>Current decision</dt>
        <dd>{player.currentDecisionId === null ? 'none' : `#${player.currentDecisionId}, ruled ${player.currentVerdict}`}</dd>
      </dl>
      {!canDecide ? (
        <p className="muted" data-decision-unavailable="role">
          Recording an eligibility decision is a Super Admin action. You can see the evidence and the
          history; this form is not offered to your role.
        </p>
      ) : player.identityState !== 'resolved' ? (
        <p className="muted" data-decision-unavailable="identity">
          A decision cannot be recorded for this player: it is filed under the player&apos;s durable
          identity, and the player holds {player.identityState === 'ambiguous' ? 'more than one' : 'none'}.
          Reconcile the identity first.
        </p>
      ) : (
        <>
          <DecisionCard
            consequences={describeBrownlowEligibilityConsequences({
              actingEmail,
              season,
              playerId: player.playerId,
              identity: player.identity,
              sealedSeason,
              supersedesId: player.currentDecisionId,
            })}
          />
          <form onSubmit={onSubmit} aria-labelledby={`${id}-legend`}>
            <input type="hidden" name="season" value={season} />
            <input type="hidden" name="playerId" value={player.playerId} />
            <input type="hidden" name="expectedCurrentDecisionId" value={player.currentDecisionId ?? ''} />
            <fieldset className="filter-group">
              <legend id={`${id}-legend`}>Ruling for player {player.playerId}</legend>
              <p>
                <label htmlFor={`${id}-eligible`}>
                  <input id={`${id}-eligible`} type="radio" name="verdict" value="eligible" required disabled={pending} />
                  {' '}Eligible for the {season} Brownlow Medal
                </label>
                <br />
                <label htmlFor={`${id}-ineligible`}>
                  <input id={`${id}-ineligible`} type="radio" name="verdict" value="ineligible" required disabled={pending} />
                  {' '}Ineligible for the {season} Brownlow Medal
                </label>
                <FieldError state={state} name="verdict" />
              </p>
              <p>
                <label htmlFor={`${id}-citation`}>Citation: a URL or source reference for the ruling</label>
                <input id={`${id}-citation`} name="citation" type="text" maxLength={2000} required style={{ width: '100%' }} disabled={pending} />
                <FieldError state={state} name="citation" />
              </p>
              <p>
                <label htmlFor={`${id}-note`}>Note: the reasoning, 20 to 2000 characters (recorded in the audit)</label>
                <textarea id={`${id}-note`} name="note" rows={3} minLength={20} maxLength={2000} required style={textareaStyle} disabled={pending} />
                <FieldError state={state} name="note" />
              </p>
              <FieldError state={state} name="season" />
              <FieldError state={state} name="playerId" />
              <FieldError state={state} name="expectedCurrentDecisionId" />
            </fieldset>
            <button className="btn" type="submit" disabled={pending}>
              {pending ? 'Recording…' : 'Record the decision'}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
