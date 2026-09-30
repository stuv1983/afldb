/**
 * AFLDB-ISSUE-238 — pure, DB-free planner for correcting a consumed trusted
 * `afl_api` player link with canonical reattribution (Slice 2, runbook §12).
 *
 * No database, clock, filesystem or network access. Every fact this module
 * needs (canonical rows, their `canonical_applications` history, the
 * Brownlow admin/match-sheet audit trail, the D10 identity/ledger state) is
 * read by a future adapter and passed in here as plain data, so every
 * decision is a pure function of that data (runbook §5.1: "The planner is
 * pure: DB reads happen in the adapter and are passed in").
 *
 * This module lives outside ISSUE-237's shared tooling and modifies no
 * shared file (runbook §12, pass 4 `R238-P3-12`; the L5 isolation rule).
 * It implements the runbook's §5 evidence-bound correction closure:
 *
 *   §5.1  authorities and the closure/fingerprint model
 *   §5.2  `player_match_stats` attribution (P1-P7)
 *   §5.3  `brownlow_round_votes` attribution (B1-B5, B3-I/B3-C)
 *   §5.4  dispositions and collision policy (C1-C14)
 *   §5.5  the substantive comparison projection
 *   §5.6  canonical-application lineage (already-corrected rows)
 *   §5.8  out-of-ledger edit detection / reconstruction
 *   §5.9  Brownlow admin-state guards BG1-BG3
 *   §5.10 season-total artefact independence predicate (SV-0, SV-1, SV-2a)
 *   §5.11 special-record dependents (DP-1-DP-5)
 *   §5.12 MUTATION ELIGIBILITY vs CORRECTION SATISFACTION (Q1/Q2), and
 *         `post_correction_edit` / `post_correction_reappearance` (pass 5,
 *         pass 5a `R238-P5-01`, `R238-P5-05`)
 *   §8.2 step 11 the Slice-8 structured operator report (§4.F-§4.H, §5.10
 *         verdicts, §5.11 DP-3...DP-5): report-only, never fingerprinted
 *
 * Two questions, never mixed for one row (§5.12):
 *   - MUTATION ELIGIBILITY (Q1): may this row be mutated now? Runs every
 *     correction-time guard.
 *   - CORRECTION SATISFACTION (Q2): is an existing correction still the
 *     authoritative identity state? Proved from durable lineage only; never
 *     re-runs Q1's guards.
 */
import { createHash } from 'node:crypto';

import { clubPath, matchPath, playerPath, seasonPath } from '../format';
import { canonicalJson, type JsonValue } from './observations';

/* ==================================================================== *
 * §5.1 Shared primitives
 * ==================================================================== */

/** Bumped on any change to this module's §5 semantics (runbook §5.1). */
export const PLANNER_VERSION = 2;

export type CanonicalTable = 'player_match_stats' | 'brownlow_round_votes';

export type Authority = 'ORIGINAL' | 'ADJUDICATION' | 'PREDICT';

export type Question = 'MUTATION_ELIGIBILITY' | 'CORRECTION_SATISFACTION' | 'ATTRIBUTION_ONLY';

export type Disposition = 'MOVE' | 'DELETE_AS_FOREIGN_COLLISION' | 'NOOP' | 'STOP';

/** Every STOP code this module can raise, named after its runbook step. */
export type StopCode =
  // §5.2/§5.3 attribution and mutation-eligibility failures
  | 'no_application_evidence'
  | 'mixed_provider_application_history'
  | 'row_stamp_names_another_provider'
  | 'provenance_unexplained'
  | 'projection_disagrees'
  | 'brownlow_state_present'
  | 'out_of_ledger_edit'
  | 'reconstruction_inconsistent'
  | 'brownlow_insert_unproven'
  | 'brownlow_chain_inconsistent'
  // §5.4 collision and whole-plan
  | 'collision_values_disagree'
  | 'brownlow_move_without_participation'
  | 'p_equals_p_prime'
  | 'p_prime_holds_another_provider'
  | 'manual_admin_edit_identity'
  | 'identity_unresolvable'
  | 'already_corrected_provider'
  | 'season_total_depends_on_correction'
  | 'season_artefact_unprovable'
  | 'dependent_record_would_be_stale'
  // §5.9 Brownlow admin-state guards
  | 'brownlow_entry_names_player'
  | 'foreign_brownlow_dependency'
  // §5.6 lineage
  | 'correction_not_bound'
  | 'ambiguous_correction'
  | 'correction_values_contradict'
  | 'key_components_contradict'
  | 'correction_not_joinable'
  | 'missing_pre_correction_history'
  | 'row_proof_mismatch'
  | 'mixed_provider_after_correction'
  | 'ownership_or_stamp_contradicts'
  | 'correction_target_absent_unexplained'
  // §5.12 satisfaction
  | 'post_correction_edit_unexplained'
  | 'unmoved_closure_row'
  | 'identity_contradicts'
  | 'authority_invalid';

export type NoopReason =
  | 'foreign'
  | 'already_corrected_moved'
  | 'already_corrected_deleted'
  | 'attributed_through_corrected_link'
  | 'correction_target_absent'
  /** pass 5a, `R238-P5-05`: a new, independent row at a vacated old key. */
  | 'post_correction_reappearance';

export type Stop = { readonly step: string; readonly code: StopCode; readonly detail: string };

function stop(step: string, code: StopCode, detail: string): Stop {
  return { step, code, detail };
}

/** A single field divergence between a reconstruction and the current row (§5.8). */
export type FieldDivergence = {
  readonly field: string;
  readonly reconstructed: JsonValue;
  readonly current: JsonValue;
};

/* ==================================================================== *
 * §5.8 Out-of-ledger edit detection / reconstruction
 * ==================================================================== */

/** One application in a row's automatic history, exactly as `canonical_applications` records it. */
export type Application = {
  readonly id: number;
  readonly verb: 'insert' | 'update' | 'delete';
  readonly previousValues: Readonly<Record<string, JsonValue>> | null;
  readonly newValues: Readonly<Record<string, JsonValue>>;
  readonly sourceId: string;
  readonly externalRecordId: string;
  readonly sourceVersionSeq: number;
  readonly importBatchId: number;
};

export type ReconstructionResult = {
  /** The reconstructed value of every contract field, defaults included. */
  readonly fields: Readonly<Record<string, JsonValue>>;
  /** True only when every application's `previousValues` matched the running state. */
  readonly chainConsistent: boolean;
  /** Populated when `chainConsistent` is false: the first broken step. */
  readonly chainBreak: FieldDivergence | null;
};

function valuesEqual(a: JsonValue, b: JsonValue): boolean {
  // IS NOT DISTINCT FROM: NULL equals NULL, NULL !== 0 (§5.5).
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Reconstruct a row's contract fields from NULL defaults through its
 * ordered automatic application history (§5.8 steps 1-3). Applications must
 * already be sorted by `id` ascending and must exclude ISSUE-238
 * correction/replay applications (those are §5.6 lineage, applied
 * separately by the caller when reconstructing a post-correction state).
 */
export function reconstructContract(
  contractFields: readonly string[],
  applications: readonly Application[],
): ReconstructionResult {
  const fields: Record<string, JsonValue> = {};
  for (const field of contractFields) fields[field] = null;

  for (const [index, app] of applications.entries()) {
    if (index === 0) {
      if (app.verb !== 'insert') {
        // An insert-less history cannot be reconstructed from NULL; the
        // caller is responsible for supplying a history that begins with
        // the AFL API insert (P4/B2). Treat every named field as set.
      }
      for (const field of contractFields) {
        if (field in app.newValues) fields[field] = app.newValues[field];
      }
      continue;
    }
    if (app.previousValues) {
      for (const field of contractFields) {
        if (field in app.previousValues && !valuesEqual(app.previousValues[field], fields[field])) {
          return {
            fields,
            chainConsistent: false,
            chainBreak: { field, reconstructed: fields[field], current: app.previousValues[field] },
          };
        }
      }
    }
    for (const field of contractFields) {
      if (field in app.newValues) fields[field] = app.newValues[field];
    }
  }

  return { fields, chainConsistent: true, chainBreak: null };
}

/** Compare a reconstruction with the current row, naming every divergent field (§5.8). */
export function compareReconstruction(
  reconstruction: ReconstructionResult,
  current: Readonly<Record<string, JsonValue>>,
  contractFields: readonly string[],
): readonly FieldDivergence[] {
  const divergences: FieldDivergence[] = [];
  for (const field of contractFields) {
    const reconstructed = reconstruction.fields[field] ?? null;
    const currentValue = current[field] ?? null;
    if (!valuesEqual(reconstructed, currentValue)) {
      divergences.push({ field, reconstructed, current: currentValue });
    }
  }
  return divergences;
}

export const PLAYER_MATCH_STATS_CONTRACT_FIELDS = [
  'club_id', 'jumper_number',
  'kicks', 'marks', 'handballs', 'disposals', 'goals', 'behinds', 'hitouts', 'tackles',
  'rebounds', 'inside_50s', 'clearances', 'clangers', 'frees_for', 'frees_against',
  'contested', 'uncontested', 'contested_marks', 'marks_inside_50', 'one_percenters',
  'bounces', 'goal_assists',
  'brownlow_votes', // §5.8: reconstructed value is always NULL (the AFL API never writes it)
] as const;

export const BROWNLOW_ROUND_VOTES_CONTRACT_FIELDS = ['played', 'votes', 'match_id'] as const;

/* ==================================================================== *
 * §5.2 `player_match_stats` attribution and mutation eligibility (P1-P7)
 * ==================================================================== */

export type PlayerMatchStatsRowEvidence = {
  readonly sourceId: string; // P1: must be 'afl_api'
  readonly sourceRecordId: string; // P2: `${matchProviderId}|${team}|${playerProviderId}`
  readonly importBatchId: number;
  /** Every `canonical_applications` row at this row's own key, id-ascending, excluding any ISSUE-238 correction application. */
  readonly applications: readonly Application[];
  /** A present typed projection row naming the currently-attributed player, or null if absent (§2.4). */
  readonly projectionPlayerId: number | null;
  readonly currentPlayerId: number;
  readonly current: Readonly<Record<string, JsonValue>>;
  readonly expectedSourceRecordId: string;
  readonly expectedImportBatchId: number;
};

export type AttributionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly stop: Stop };

/** P1-P5: attribution only — proves `player_id` came from `CD_I` (pass 5, `R238-P4-01`). */
export function evaluatePlayerMatchStatsAttribution(
  evidence: PlayerMatchStatsRowEvidence,
): AttributionResult {
  if (evidence.sourceId !== 'afl_api') {
    return { ok: false, stop: stop('P1', 'row_stamp_names_another_provider', 'source_id is not afl_api') };
  }
  if (evidence.applications.length === 0) {
    return { ok: false, stop: stop('P3', 'no_application_evidence', 'no canonical_applications row at this key') };
  }
  if (evidence.applications.some((a) => a.sourceId !== 'afl_api')) {
    return { ok: false, stop: stop('P3', 'mixed_provider_application_history', 'an application in the history is not afl_api') };
  }
  if (evidence.applications[0].verb !== 'insert') {
    return { ok: false, stop: stop('P4', 'no_application_evidence', 'the earliest application is not an insert') };
  }
  if (evidence.sourceRecordId !== evidence.expectedSourceRecordId
    || evidence.importBatchId !== evidence.expectedImportBatchId) {
    return { ok: false, stop: stop('P2', 'provenance_unexplained', 'source_record_id/import_batch_id do not match the latest non-correction application') };
  }
  if (evidence.projectionPlayerId !== null && evidence.projectionPlayerId !== evidence.currentPlayerId) {
    return { ok: false, stop: stop('P5', 'projection_disagrees', 'the typed projection names a different player') };
  }
  return { ok: true };
}

/** P6/P7: mutation eligibility only (pass 5, `R238-P4-01`) — never a satisfaction predicate. */
export function evaluatePlayerMatchStatsMutationEligibility(
  evidence: PlayerMatchStatsRowEvidence,
): AttributionResult {
  const attribution = evaluatePlayerMatchStatsAttribution(evidence);
  if (!attribution.ok) return attribution;

  if (evidence.current.brownlow_votes !== null && evidence.current.brownlow_votes !== undefined) {
    return { ok: false, stop: stop('P6', 'brownlow_state_present', 'brownlow_votes is not NULL') };
  }

  const reconstruction = reconstructContract(PLAYER_MATCH_STATS_CONTRACT_FIELDS, evidence.applications);
  if (!reconstruction.chainConsistent) {
    return { ok: false, stop: stop('P7', 'reconstruction_inconsistent', 'an application previous_values disagrees with the reconstructed prior value') };
  }
  const divergences = compareReconstruction(reconstruction, evidence.current, PLAYER_MATCH_STATS_CONTRACT_FIELDS);
  if (divergences.length > 0) {
    return {
      ok: false,
      stop: stop('P7', 'out_of_ledger_edit', `field(s) differ from reconstruction: ${divergences.map((d) => d.field).join(', ')}`),
    };
  }
  return { ok: true };
}

/* ==================================================================== *
 * §5.3 `brownlow_round_votes` attribution and mutation eligibility (B1-B5)
 * ==================================================================== */

/** One later application in a Brownlow row's chain, with the B3-C evidence needed to classify it. */
export type BrownlowChainApplication = Application & {
  /** The cited payload's voter-entry count for CD_I in this application's source version. */
  readonly citedPayloadVoterCountForCdI: number;
  /** CD_I's own vote in the cited payload, when it holds exactly one entry for CD_I. */
  readonly citedPayloadVoteForCdI: number | null;
};

export type BrownlowRowEvidence = {
  readonly sourceId: string; // B1
  readonly sourceRecordId: string; // B1: the provider match id (CD_M)
  readonly expectedSourceRecordId: string;
  readonly importBatchId: number;
  readonly expectedImportBatchId: number;
  /** The original insert application (B2/B3-I). */
  readonly insertApplication: Application;
  /** B3-I: does the insert's cited payload hold exactly one voter entry for CD_I, and does it equal the inserted votes? */
  readonly insertProvenByPayload: boolean;
  /** Or B3-I via the typed projection (§2.4). */
  readonly projectionPlayerId: number | null;
  readonly currentPlayerId: number;
  /** Every later application in id order (excluding ISSUE-238 corrections), for B3-C. */
  readonly chain: readonly BrownlowChainApplication[];
  /** B4: did any other provider in the insert's cited vote set also resolve to the current player? */
  readonly anotherProviderAlsoResolved: boolean;
  readonly current: { readonly played: JsonValue; readonly votes: JsonValue; readonly matchId: JsonValue };
};

export type BrownlowChainClassification =
  | { readonly ok: true; readonly case: 1 | 2 | 3 }
  | { readonly ok: false; readonly stop: Stop };

function violatesFieldRule(app: BrownlowChainApplication): boolean {
  const names = Object.keys(app.newValues);
  // FR: `played`, when named, must be `true`.
  if (names.includes('played') && app.newValues.played !== true) return true;
  // FR: `match_id`, when named, heals NULL -> non-NULL only.
  if (names.includes('match_id') && (app.previousValues?.match_id !== null || app.newValues.match_id === null)) {
    return true;
  }
  return false;
}

/**
 * B3-C, a single application (pass 5 rewrite, `R238-P4-02`). Classifies it
 * as case 1 (consistent voter) or case 2 (I244-F002 demotion). Case 3 (an
 * F007 release/claim pair) can only be decided across two adjacent
 * applications together — see `classifyBrownlowChain`.
 */
export function classifyBrownlowChainApplication(
  app: BrownlowChainApplication,
  priorVotes: JsonValue,
): BrownlowChainClassification {
  if (violatesFieldRule(app)) {
    return { ok: false, stop: stop('B3-C', 'brownlow_chain_inconsistent', 'violates the field rule (FR)') };
  }
  const names = Object.keys(app.newValues);

  if (app.citedPayloadVoterCountForCdI === 1) {
    if (names.includes('votes') && app.citedPayloadVoteForCdI !== app.newValues.votes) {
      return { ok: false, stop: stop('B3-C', 'brownlow_chain_inconsistent', 'new votes value does not match the cited payload entry for CD_I') };
    }
    return { ok: true, case: 1 };
  }

  if (app.citedPayloadVoterCountForCdI === 0) {
    const priorVotesNumber = typeof priorVotes === 'number' ? priorVotes : null;
    if (app.newValues.votes === 0 && priorVotesNumber !== null && priorVotesNumber > 0) {
      const otherKeysAreFrOnly = names.every((k) => k === 'votes' || k === 'played' || k === 'match_id');
      if (otherKeysAreFrOnly) return { ok: true, case: 2 };
    }
  }

  return { ok: false, stop: stop('B3-C', 'brownlow_chain_inconsistent', 'application fits none of cases 1-3') };
}

/** Are `r` and `q` the same cited source version (same batch/family/external record/seq)? */
function sameCitedVersion(r: BrownlowChainApplication, q: BrownlowChainApplication): boolean {
  return (
    r.importBatchId === q.importBatchId
    && r.sourceId === q.sourceId
    && r.externalRecordId === q.externalRecordId
    && r.sourceVersionSeq === q.sourceVersionSeq
  );
}

/**
 * B3-C case 3 (I244-F007 release -> claim pair): verifies two ADJACENT
 * applications together. Neither can be classified alone, because the
 * cited payload already names CD_I once with a positive vote `v` at both
 * steps — the pair is one provider transition through that same version,
 * not two independent applications (§5.3).
 */
export function verifyBrownlowReleaseClaimPair(
  release: BrownlowChainApplication,
  claim: BrownlowChainApplication,
  priorVotesBeforeRelease: JsonValue,
): BrownlowChainClassification {
  if (violatesFieldRule(release) || violatesFieldRule(claim)) {
    return { ok: false, stop: stop('B3-C', 'brownlow_chain_inconsistent', 'the release or claim violates the field rule (FR)') };
  }
  if (!sameCitedVersion(release, claim)) {
    return { ok: false, stop: stop('B3-C', 'brownlow_chain_inconsistent', 'the release and claim do not cite the same source version') };
  }
  if (release.citedPayloadVoterCountForCdI !== 1 || claim.citedPayloadVoterCountForCdI !== 1) {
    return { ok: false, stop: stop('B3-C', 'brownlow_chain_inconsistent', 'the cited payload does not name CD_I exactly once at both steps') };
  }
  const v = release.citedPayloadVoteForCdI;
  if (v === null || v <= 0 || claim.citedPayloadVoteForCdI !== v) {
    return { ok: false, stop: stop('B3-C', 'brownlow_chain_inconsistent', 'the payload vote for CD_I is not a consistent positive value across the pair') };
  }
  const priorVotesNumber = typeof priorVotesBeforeRelease === 'number' ? priorVotesBeforeRelease : null;
  if (release.newValues.votes !== 0 || priorVotesNumber === null || priorVotesNumber <= 0 || priorVotesNumber === v) {
    return { ok: false, stop: stop('B3-C', 'brownlow_chain_inconsistent', 'the release does not drop a differing positive value to 0') };
  }
  if (claim.previousValues?.votes !== 0 || claim.newValues.votes !== v) {
    return { ok: false, stop: stop('B3-C', 'brownlow_chain_inconsistent', 'the claim does not raise 0 to the cited value v') };
  }
  return { ok: true, case: 3 };
}

/**
 * Walks a Brownlow row's later application chain (§5.3 B3-C), recognising
 * adjacent F007 release/claim pairs before falling back to single-step
 * classification. Returns the STOP of the first application that fits none
 * of cases 1-3, or `ok: true` with the final reconstructed `votes`.
 */
export function classifyBrownlowChain(
  chain: readonly BrownlowChainApplication[],
  insertVotes: JsonValue,
): { readonly ok: true; readonly finalVotes: JsonValue } | { readonly ok: false; readonly stop: Stop } {
  let priorVotes = insertVotes;
  let i = 0;
  while (i < chain.length) {
    const app = chain[i];
    const next = chain[i + 1];
    if (
      next
      && app.citedPayloadVoterCountForCdI === 1
      && app.newValues.votes === 0
      && next.citedPayloadVoterCountForCdI === 1
    ) {
      const pair = verifyBrownlowReleaseClaimPair(app, next, priorVotes);
      if (pair.ok) {
        priorVotes = next.newValues.votes ?? priorVotes;
        i += 2;
        continue;
      }
    }
    const single = classifyBrownlowChainApplication(app, priorVotes);
    if (!single.ok) return single;
    if ('votes' in app.newValues) priorVotes = app.newValues.votes;
    i += 1;
  }
  return { ok: true, finalVotes: priorVotes };
}

/** B1-B4: attribution only. */
export function evaluateBrownlowAttribution(evidence: BrownlowRowEvidence): AttributionResult {
  if (evidence.sourceId !== 'afl_api') {
    return { ok: false, stop: stop('B1', 'row_stamp_names_another_provider', 'source_id is not afl_api') };
  }
  if (evidence.insertApplication.verb !== 'insert') {
    return { ok: false, stop: stop('B2', 'no_application_evidence', 'the earliest application is not an insert') };
  }
  if (!evidence.insertProvenByPayload && evidence.projectionPlayerId === null) {
    return { ok: false, stop: stop('B3-I', 'brownlow_insert_unproven', 'no projection and no parseable insert payload evidence') };
  }
  if (evidence.projectionPlayerId !== null && evidence.projectionPlayerId !== evidence.currentPlayerId) {
    return { ok: false, stop: stop('B3-I', 'projection_disagrees', 'the typed projection names a different player') };
  }
  if (evidence.anotherProviderAlsoResolved) {
    return { ok: false, stop: stop('B4', 'mixed_provider_application_history', 'another provider in the insert vote set also resolved to this player') };
  }

  const chainResult = classifyBrownlowChain(evidence.chain, evidence.insertApplication.newValues.votes ?? null);
  if (!chainResult.ok) return chainResult;

  if (evidence.sourceRecordId !== evidence.expectedSourceRecordId
    || evidence.importBatchId !== evidence.expectedImportBatchId) {
    return { ok: false, stop: stop('B1', 'provenance_unexplained', 'source_record_id/import_batch_id do not match the latest non-correction application') };
  }
  return { ok: true };
}

/** B5: mutation eligibility only (pass 5, `R238-P4-01`). */
export function evaluateBrownlowMutationEligibility(evidence: BrownlowRowEvidence): AttributionResult {
  const attribution = evaluateBrownlowAttribution(evidence);
  if (!attribution.ok) return attribution;

  const applications: Application[] = [evidence.insertApplication, ...evidence.chain];
  const reconstruction = reconstructContract(BROWNLOW_ROUND_VOTES_CONTRACT_FIELDS, applications);
  if (!reconstruction.chainConsistent) {
    return { ok: false, stop: stop('B5', 'reconstruction_inconsistent', 'an application previous_values disagrees with the reconstructed prior value') };
  }
  const current = { played: evidence.current.played, votes: evidence.current.votes, match_id: evidence.current.matchId };
  const divergences = compareReconstruction(reconstruction, current, BROWNLOW_ROUND_VOTES_CONTRACT_FIELDS);
  if (divergences.length > 0) {
    return {
      ok: false,
      stop: stop('B5', 'out_of_ledger_edit', `field(s) differ from reconstruction: ${divergences.map((d) => d.field).join(', ')}`),
    };
  }
  return { ok: true };
}

/* ==================================================================== *
 * §5.9 Brownlow admin-state guards BG1-BG3
 * ==================================================================== */

export type BrownlowGuardEvidence = {
  /** BG1: the `player_match_stats` closure row's `brownlow_votes` (already checked by P6, kept here for a standalone guard check). */
  readonly playerMatchStatsBrownlowVotes: JsonValue;
  /** BG2: any `brownlow_round_votes` row for P at the same event that is not itself a proven closure row of this correction. */
  readonly foreignBrownlowRowAtEvent: boolean;
  /** BG3: does the match's `brownlow_vote_entry_state` name P in any of the three slots, at any status? */
  readonly entryStateNamesPlayer: boolean;
};

export function evaluateBrownlowGuards(evidence: BrownlowGuardEvidence): AttributionResult {
  if (evidence.playerMatchStatsBrownlowVotes !== null && evidence.playerMatchStatsBrownlowVotes !== undefined) {
    return { ok: false, stop: stop('BG1', 'brownlow_state_present', 'brownlow_votes is not NULL') };
  }
  if (evidence.foreignBrownlowRowAtEvent) {
    return { ok: false, stop: stop('BG2', 'foreign_brownlow_dependency', 'a foreign brownlow_round_votes row exists for this player at this event') };
  }
  if (evidence.entryStateNamesPlayer) {
    return { ok: false, stop: stop('BG3', 'brownlow_entry_names_player', 'the match entry-state names this player in a vote slot') };
  }
  return { ok: true };
}

/** C1c (pass 5, D-P5-2/P4-05): a Brownlow-only MOVE with `played` not false needs P' participation. */
export function evaluateBrownlowParticipation(
  played: JsonValue, playerPrimeHasParticipation: boolean,
): AttributionResult {
  const playedIsNotFalse = played !== false;
  if (playedIsNotFalse && !playerPrimeHasParticipation) {
    return { ok: false, stop: stop('C1c', 'brownlow_move_without_participation', "P' has no canonical participation in this match under the plan") };
  }
  return { ok: true };
}

/* ==================================================================== *
 * §5.5 The substantive comparison projection, and §5.4 dispositions
 * ==================================================================== */

export const PLAYER_MATCH_STATS_SUBSTANTIVE_FIELDS = [
  'club_id', 'jumper_number',
  'kicks', 'marks', 'handballs', 'disposals', 'goals', 'behinds', 'hitouts', 'tackles',
  'rebounds', 'inside_50s', 'clearances', 'clangers', 'frees_for', 'frees_against',
  'contested', 'uncontested', 'contested_marks', 'marks_inside_50', 'one_percenters',
  'bounces', 'goal_assists',
] as const;

export type SubstantiveComparison = {
  readonly equal: boolean;
  readonly differingFields: readonly FieldDivergence[];
};

export function compareSubstantivePlayerMatchStats(
  closureRow: Readonly<Record<string, JsonValue>>,
  counterpart: Readonly<Record<string, JsonValue>>,
): SubstantiveComparison {
  const differing: FieldDivergence[] = [];
  for (const field of PLAYER_MATCH_STATS_SUBSTANTIVE_FIELDS) {
    const a = closureRow[field] ?? null;
    const b = counterpart[field] ?? null;
    if (!valuesEqual(a, b)) differing.push({ field, reconstructed: a, current: b });
  }
  return { equal: differing.length === 0, differingFields: differing };
}

export function compareSubstantiveBrownlow(
  closureRow: { readonly votes: JsonValue; readonly played: JsonValue; readonly matchId: JsonValue },
  counterpart: { readonly votes: JsonValue; readonly played: JsonValue; readonly matchId: JsonValue },
): SubstantiveComparison {
  const differing: FieldDivergence[] = [];
  const bothZero = closureRow.votes === 0 && counterpart.votes === 0;
  if (!bothZero) {
    differing.push({ field: 'votes', reconstructed: closureRow.votes, current: counterpart.votes });
  }
  if (!valuesEqual(closureRow.played, counterpart.played)) {
    differing.push({ field: 'played', reconstructed: closureRow.played, current: counterpart.played });
  }
  if (!valuesEqual(closureRow.matchId, counterpart.matchId)) {
    differing.push({ field: 'match_id', reconstructed: closureRow.matchId, current: counterpart.matchId });
  }
  return { equal: differing.length === 0, differingFields: differing };
}

export type CounterpartOwnership = 'foreign' | 'null_owned' | 'afl_api' | 'third_identity_implicated';

export type DispositionResult =
  | { readonly disposition: 'MOVE' }
  | { readonly disposition: 'DELETE_AS_FOREIGN_COLLISION' }
  | { readonly disposition: 'STOP'; readonly stop: Stop };

/**
 * C1-C9 (§5.4): the single collision rule for a `player_match_stats`
 * closure row that has passed mutation eligibility and every guard.
 */
export function decidePlayerMatchStatsDisposition(input: {
  readonly counterpart: { readonly exists: boolean; readonly ownership: CounterpartOwnership; readonly row: Readonly<Record<string, JsonValue>> | null };
  readonly closureRow: Readonly<Record<string, JsonValue>>;
  readonly wouldViolateUniqueConstraint: boolean;
}): DispositionResult {
  const closureBrownlowVotes = input.closureRow.brownlow_votes ?? null;
  if (closureBrownlowVotes !== null) {
    return { disposition: 'STOP', stop: stop('C1b', 'brownlow_state_present', 'brownlow_votes is not NULL') };
  }
  if (!input.counterpart.exists) {
    return { disposition: 'MOVE' }; // C1
  }
  if (input.counterpart.ownership === 'afl_api') {
    return { disposition: 'STOP', stop: stop('C7', 'p_prime_holds_another_provider', "P' counterpart is afl_api-owned") };
  }
  if (input.counterpart.ownership === 'third_identity_implicated') {
    return { disposition: 'STOP', stop: stop('C9', 'p_prime_holds_another_provider', "the counterpart's evidence implicates another provider identity") };
  }
  if (input.wouldViolateUniqueConstraint) {
    return { disposition: 'STOP', stop: stop('C8', 'collision_values_disagree', 'the move would violate a UNIQUE constraint') };
  }
  const comparison = compareSubstantivePlayerMatchStats(input.closureRow, input.counterpart.row ?? {});
  if (!comparison.equal) {
    return {
      disposition: 'STOP',
      stop: stop('C3', 'collision_values_disagree', `field(s) differ: ${comparison.differingFields.map((d) => d.field).join(', ')}`),
    };
  }
  return { disposition: 'DELETE_AS_FOREIGN_COLLISION' }; // C2
}

/** C1c/C4-C6 (§5.4): the Brownlow collision rule. */
export function decideBrownlowDisposition(input: {
  readonly counterpart: { readonly exists: boolean; readonly ownership: CounterpartOwnership; readonly row: { readonly votes: JsonValue; readonly played: JsonValue; readonly matchId: JsonValue } | null };
  readonly closureRow: { readonly votes: JsonValue; readonly played: JsonValue; readonly matchId: JsonValue };
}): DispositionResult {
  if (!input.counterpart.exists) return { disposition: 'MOVE' };
  if (input.counterpart.ownership === 'afl_api') {
    return { disposition: 'STOP', stop: stop('C7', 'p_prime_holds_another_provider', "P' counterpart is afl_api-owned") };
  }
  const votesArePositiveOrNull = (v: JsonValue) => v === null || (typeof v === 'number' && v > 0);
  if (votesArePositiveOrNull(input.closureRow.votes) || votesArePositiveOrNull(input.counterpart.row?.votes ?? null)) {
    return { disposition: 'STOP', stop: stop('C5', 'collision_values_disagree', 'a positive-vote or NULL-vote destructive collision is refused') };
  }
  const comparison = compareSubstantiveBrownlow(input.closureRow, input.counterpart.row!);
  if (!comparison.equal) {
    return {
      disposition: 'STOP',
      stop: stop('C6', 'collision_values_disagree', `field(s) differ: ${comparison.differingFields.map((d) => d.field).join(', ')}`),
    };
  }
  return { disposition: 'DELETE_AS_FOREIGN_COLLISION' }; // C4
}

/* ==================================================================== *
 * §5.6 Canonical-application lineage (already-corrected rows)
 * ==================================================================== */

export type BoundBatch = {
  readonly sourceId: string;
  readonly tool: string;
  readonly targetTable: string;
  readonly status: 'running' | 'completed' | 'current_transaction';
  readonly adjudicationId: number;
  readonly externalId: string;
  readonly adjudicationEvidenceSha256: string;
};

/** Is `batch` bound to adjudication `A` (§5.6, "Bound correction batch")? */
export function isBatchBoundToAdjudication(
  batch: BoundBatch, adjudicationId: number,
): boolean {
  return (
    batch.sourceId === 'afl_api'
    && batch.tool === 'correct_afl_api_identity'
    && batch.targetTable === 'canonical_applications'
    && batch.adjudicationId === adjudicationId
    && (batch.status === 'completed' || batch.status === 'current_transaction')
  );
}

export type MoveLineageEvidence = {
  readonly correctionApplication: Application & { readonly targetKey: Readonly<Record<string, JsonValue>> };
  readonly boundBatchCount: number;
  readonly previousPlayerId: number;
  readonly nextPlayerId: number;
  /** L3: every non-player_id key component of target_key equals the current row's, under the derived old key rule. */
  readonly keyComponentsMatch: boolean;
  /** L4: does c cite the same source version as H's latest application? */
  readonly bindsToOldHistory: boolean;
  /** L5: H, the pre-correction history at the old key (attribution + chain-consistency already evaluated by the caller). */
  readonly preCorrectionHistoryNonEmpty: boolean;
  readonly preCorrectionAttributionOk: boolean;
  readonly preCorrectionChainConsistent: boolean;
  /** L5 row proof (pass 5): the recorded pre-correction contract hash equals the reconstruction. */
  readonly rowProofMatches: boolean;
  /** L6: exactly one old key is derived; no other bound application cites the same source version for the same non-player key. */
  readonly joinIsUnique: boolean;
  /** L7: every later application at k' is afl_api and through CD_I. */
  readonly postCorrectionHistoryAllThroughCdI: boolean;
};

export type MoveLineageResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly stop: Stop };

/** L1-L7 (§5.6): is this row already corrected (moved)? */
export function evaluateMoveLineage(evidence: MoveLineageEvidence): MoveLineageResult {
  if (evidence.correctionApplication.verb !== 'update') {
    return { ok: false, stop: stop('L1', 'correction_not_bound', 'the earliest application at k\' bound to A is not an update') };
  }
  if (evidence.boundBatchCount !== 1) {
    return { ok: false, stop: stop('L1', 'ambiguous_correction', `${evidence.boundBatchCount} bound batches hold applications for A`) };
  }
  const prev = evidence.correctionApplication.previousValues;
  const next = evidence.correctionApplication.newValues;
  const previousMatches = prev !== null && Object.keys(prev).length === 1 && prev.player_id === evidence.previousPlayerId;
  const nextMatches = Object.keys(next).length === 1 && next.player_id === evidence.nextPlayerId;
  if (!previousMatches || !nextMatches) {
    return { ok: false, stop: stop('L2', 'correction_values_contradict', 'previous_values/new_values do not carry exactly a player_id change from P to P\'') };
  }
  if (!evidence.keyComponentsMatch) {
    return { ok: false, stop: stop('L3', 'key_components_contradict', 'a non-player_id key component does not match the current row') };
  }
  if (!evidence.bindsToOldHistory) {
    return { ok: false, stop: stop('L4', 'correction_not_joinable', 'the correction does not cite the same source version as the old-key history') };
  }
  if (!evidence.preCorrectionHistoryNonEmpty || !evidence.preCorrectionAttributionOk || !evidence.preCorrectionChainConsistent) {
    return { ok: false, stop: stop('L5', 'missing_pre_correction_history', 'the pre-correction history is empty, unattributed, or chain-inconsistent') };
  }
  if (!evidence.rowProofMatches) {
    return { ok: false, stop: stop('L5', 'row_proof_mismatch', 'the recorded pre-correction contract hash does not match the reconstruction') };
  }
  if (!evidence.joinIsUnique) {
    return { ok: false, stop: stop('L6', 'ambiguous_correction', 'more than one old key is derivable, or the source version is cited by another bound application') };
  }
  if (!evidence.postCorrectionHistoryAllThroughCdI) {
    return { ok: false, stop: stop('L7', 'mixed_provider_after_correction', 'a later application at the new key is not afl_api through CD_I') };
  }
  return { ok: true };
}

export type PostCorrectionExplanation = {
  readonly field: string;
  readonly writer: 'brownlow_admin' | 'brownlow_admin_reowned' | 'match_sheet' | 'match_deleted' | 'later_settle';
  readonly auditId: string;
};

export type L8Evidence = {
  /** L8-a. */
  readonly rowExists: boolean;
  /** L8-b (`player_match_stats`) / L8-b' (`brownlow_round_votes`). */
  readonly ownershipAndStampsOk: boolean;
  readonly reownedByBrownlowAdmin: boolean;
  readonly reownershipAuditOk: boolean;
  /** L8-c: a present typed projection still names the current player. */
  readonly projectionOk: boolean;
  /** L8-d: every divergence between the post-correction reconstruction and the current row. */
  readonly divergences: readonly FieldDivergence[];
  /** For each divergence (by field), a recognised writer's audit, if any (pass 5a `R238-P5-01` restricts what a Brownlow-admin explanation may cover). */
  readonly explanations: ReadonlyMap<string, PostCorrectionExplanation>;
  readonly table: CanonicalTable;
  /** pass 5a `R238-P5-01`: is the row still `source_id = afl_api` (only relevant for `brownlow_round_votes`)? */
  readonly stillAflApiOwned: boolean;
};

export type L8Result =
  | { readonly ok: true; readonly postCorrectionEdits: readonly PostCorrectionExplanation[] }
  | { readonly ok: false; readonly stop: Stop };

/** L8-a...L8-d (§5.6, pass 5 rewrite; narrowed pass 5a `R238-P5-01`). */
export function evaluateL8(evidence: L8Evidence): L8Result {
  if (!evidence.rowExists) {
    return { ok: false, stop: stop('L8-a', 'correction_target_absent_unexplained', 'row absent; see evaluateCorrectionTargetAbsent') };
  }
  if (!evidence.ownershipAndStampsOk) {
    if (!(evidence.reownedByBrownlowAdmin && evidence.reownershipAuditOk)) {
      return { ok: false, stop: stop('L8-b', 'ownership_or_stamp_contradicts', 'ownership or stamp columns no longer match L8-b') };
    }
  }
  if (!evidence.projectionOk) {
    return { ok: false, stop: stop('L8-c', 'projection_disagrees', 'a present typed projection names a different player after the correction') };
  }

  const explained: PostCorrectionExplanation[] = [];
  for (const divergence of evidence.divergences) {
    const explanation = evidence.explanations.get(divergence.field);
    if (!explanation) {
      return { ok: false, stop: stop('L8-d', 'post_correction_edit_unexplained', `field ${divergence.field} diverges with no recognised writer's audit`) };
    }
    // pass 5a R238-P5-01: on a brownlow_round_votes row still afl_api-owned,
    // a Brownlow-admin explanation may cover match_id only; a draft audit
    // (modelled by the caller never constructing a 'brownlow_admin'
    // explanation for votes/played without reownership) never suffices.
    if (
      evidence.table === 'brownlow_round_votes'
      && evidence.stillAflApiOwned
      && explanation.writer === 'brownlow_admin'
      && divergence.field !== 'match_id'
    ) {
      return {
        ok: false,
        stop: stop('L8-d', 'post_correction_edit_unexplained', `field ${divergence.field} cannot be explained on an afl_api-owned row: only match_id NULL -> M is (R238-P5-01)`),
      };
    }
    explained.push(explanation);
  }
  return { ok: true, postCorrectionEdits: explained };
}

/**
 * `correction_target_absent` (C14), narrowed pass 5a `R238-P5-02`:
 * `player_match_stats` only. A missing `brownlow_round_votes` row is
 * unconditionally a STOP, because its FK is `ON DELETE SET NULL`, never
 * `CASCADE` — a match deletion cannot be the cause of its absence.
 */
export function evaluateCorrectionTargetAbsent(input: {
  readonly table: CanonicalTable;
  readonly rowExists: boolean;
  readonly matchDeletedAuditAfterCorrection: boolean;
  readonly matchStillExists: boolean;
}): { readonly satisfied: boolean; readonly noop?: NoopReason; readonly stop?: Stop } {
  if (input.rowExists) return { satisfied: true };
  if (input.table === 'brownlow_round_votes') {
    return {
      satisfied: false,
      stop: stop('C14', 'correction_target_absent_unexplained', 'brownlow_round_votes.match_id is ON DELETE SET NULL; the row is never removed by a match deletion (R238-P5-02)'),
    };
  }
  if (!input.matchStillExists && input.matchDeletedAuditAfterCorrection) {
    return { satisfied: true, noop: 'correction_target_absent' };
  }
  return {
    satisfied: false,
    stop: stop('C14', 'correction_target_absent_unexplained', 'no durable match_deletion audit explains the absence'),
  };
}

/**
 * `post_correction_reappearance` (pass 5a, `R238-P5-05`): a new row at the
 * vacated old key that is NOT attributed through CD_I. Reported distinctly;
 * never mutated; never read as evidence the correction failed.
 */
export function detectPostCorrectionReappearance(input: {
  readonly rowExistsAtOldKey: boolean;
  readonly attributedThroughCdI: boolean;
}): { readonly reappeared: boolean } {
  return { reappeared: input.rowExistsAtOldKey && !input.attributedThroughCdI };
}

export type DeleteLineageEvidence = {
  readonly deleteApplication: Application;
  readonly boundBatchCount: number;
  readonly previousPlayerId: number;
  readonly keyComponentsMatch: boolean;
  readonly previousValuesContractComplete: boolean;
  readonly previousValuesSourceIdIsAflApi: boolean;
  readonly previousValuesBrownlowVotesIsNull: boolean | null; // null = not applicable (Brownlow table)
  readonly preCorrectionHistoryNonEmpty: boolean;
  readonly reconstructionMatchesPreviousValues: boolean;
  readonly noConflictingLaterHistory: boolean;
};

export function evaluateDeleteLineage(evidence: DeleteLineageEvidence): MoveLineageResult {
  if (evidence.deleteApplication.verb !== 'delete') {
    return { ok: false, stop: stop('D-1', 'correction_not_bound', 'the bound application is not a delete') };
  }
  if (!evidence.keyComponentsMatch || evidence.deleteApplication.previousValues?.player_id !== evidence.previousPlayerId) {
    return { ok: false, stop: stop('D-1', 'key_components_contradict', 'the delete key does not name P and the original natural key') };
  }
  if (!evidence.previousValuesContractComplete) {
    return { ok: false, stop: stop('D-2', 'row_proof_mismatch', 'previous_values does not hold the full deleted field set') };
  }
  if (!evidence.previousValuesSourceIdIsAflApi) {
    return { ok: false, stop: stop('D-3', 'row_proof_mismatch', 'previous_values.source_id is not afl_api') };
  }
  if (evidence.previousValuesBrownlowVotesIsNull === false) {
    return { ok: false, stop: stop('D-3', 'brownlow_state_present', 'previous_values.brownlow_votes is not NULL') };
  }
  if (evidence.boundBatchCount !== 1) {
    return { ok: false, stop: stop('D-4', 'ambiguous_correction', `${evidence.boundBatchCount} bound delete applications exist for this key`) };
  }
  if (!evidence.preCorrectionHistoryNonEmpty || !evidence.reconstructionMatchesPreviousValues) {
    return { ok: false, stop: stop('D-5', 'row_proof_mismatch', 'the reconstruction of the pre-correction history does not equal previous_values') };
  }
  if (!evidence.noConflictingLaterHistory) {
    return { ok: false, stop: stop('D-6', 'mixed_provider_after_correction', 'a later application at this key continues the deleted row through CD_I') };
  }
  return { ok: true };
}

/* ==================================================================== *
 * §5.12 MUTATION ELIGIBILITY vs CORRECTION SATISFACTION
 * ==================================================================== */

export type SatCheck = 'SAT-1' | 'SAT-2' | 'SAT-3' | 'SAT-4' | 'SAT-5';

export type SatisfactionResult =
  | { readonly satisfied: true }
  | { readonly satisfied: false; readonly stop: Stop };

export type SatisfactionEvidence = {
  /** SAT-1. */
  readonly identityResolvedToPPrime: boolean;
  readonly ledgerNetStateIsCorrected: boolean;
  readonly ledgerChainValid: boolean;
  /** SAT-2. */
  readonly boundBatchCount: number;
  readonly boundBatchIsCompletedOrCurrent: boolean;
  /** SAT-3/SAT-4: the caller has already evaluated every bound MOVE/DELETE via evaluateMoveLineage/evaluateDeleteLineage. */
  readonly moveLineageResults: readonly MoveLineageResult[];
  readonly deleteLineageResults: readonly MoveLineageResult[];
  /** SAT-5. */
  readonly unmovedClosureRowAtP: boolean;
  readonly laterApplicationAtOldKeyThroughCdI: boolean;
  readonly secondCorrectedRowForExternalId: boolean;
};

/** SAT-1...SAT-5 (§5.12): never re-runs P6/P7/B5, BG1-BG3, C1-C11, §5.10 or §5.11. */
export function evaluateCorrectionSatisfaction(evidence: SatisfactionEvidence): SatisfactionResult {
  if (!evidence.identityResolvedToPPrime || !evidence.ledgerChainValid) {
    return { satisfied: false, stop: stop('SAT-1', 'identity_contradicts', 'the external identity or ledger chain is not resolved to P\' with a valid chain') };
  }
  if (!evidence.ledgerNetStateIsCorrected) {
    return { satisfied: false, stop: stop('SAT-1', 'authority_invalid', 'the ledger net state for this provider is not CORRECTED') };
  }
  if (evidence.boundBatchCount > 1) {
    return { satisfied: false, stop: stop('SAT-2', 'ambiguous_correction', 'more than one bound batch holds applications for this adjudication') };
  }
  if (evidence.boundBatchCount === 1 && !evidence.boundBatchIsCompletedOrCurrent) {
    return { satisfied: false, stop: stop('SAT-2', 'correction_not_bound', 'the bound batch is neither completed nor the current transaction') };
  }
  for (const result of evidence.moveLineageResults) {
    if (!result.ok) return { satisfied: false, stop: result.stop };
  }
  for (const result of evidence.deleteLineageResults) {
    if (!result.ok) return { satisfied: false, stop: result.stop };
  }
  if (evidence.unmovedClosureRowAtP) {
    return { satisfied: false, stop: stop('SAT-5', 'unmoved_closure_row', 'a CD_I-attributed row remains at P') };
  }
  if (evidence.laterApplicationAtOldKeyThroughCdI) {
    return { satisfied: false, stop: stop('SAT-5', 'identity_contradicts', 'an application through CD_I exists at the old key after the correction') };
  }
  if (evidence.secondCorrectedRowForExternalId) {
    return { satisfied: false, stop: stop('SAT-5', 'authority_invalid', 'a second corrected row exists for this external_id') };
  }
  return { satisfied: true };
}

/* ==================================================================== *
 * §5.10 Season-total artefact independence predicate (SV-0, SV-1, SV-2a)
 * ==================================================================== */

export type SeasonTotalRow = Readonly<Record<string, JsonValue>>;

export type SeasonIndependenceEvidence =
  | { readonly kind: 'empty' } // SV-0
  | {
    readonly kind: 'admin_published';
    readonly closureMovesOrDeletesPositiveBrownlowRowInSeason: boolean;
    readonly pOrPPrimeHasRowInSeasonTotals: boolean;
  } // SV-1
  | {
    // SV-2a: schema-1 executable predicate (pass 5 rewrite `R238-P4-04`).
    readonly kind: 'artefact_schema_1';
    /** pass 5a `R238-P5-06`: bind manifest.identity.csv_sha256 as well as artefact.csv_sha256. */
    readonly artefactCsvSha256Matches: boolean;
    readonly identityCsvSha256Matches: boolean;
    readonly rowForRowMatch: boolean;
    readonly profilePathResolvesToExactlyOnePlayer: boolean;
  }
  | { readonly kind: 'unprovable' }; // SV-3

export type SeasonIndependenceVerdict =
  | { readonly independent: true }
  | { readonly independent: false; readonly stop: Stop };

export function evaluateSeasonTotalIndependence(evidence: SeasonIndependenceEvidence): SeasonIndependenceVerdict {
  switch (evidence.kind) {
    case 'empty':
      return { independent: true };
    case 'admin_published':
      if (evidence.closureMovesOrDeletesPositiveBrownlowRowInSeason || evidence.pOrPPrimeHasRowInSeasonTotals) {
        return { independent: false, stop: stop('SV-1', 'season_total_depends_on_correction', 'the admin-published season depends on the corrected facts') };
      }
      return { independent: true };
    case 'artefact_schema_1':
      if (
        evidence.artefactCsvSha256Matches
        && evidence.identityCsvSha256Matches
        && evidence.rowForRowMatch
        && evidence.profilePathResolvesToExactlyOnePlayer
      ) {
        return { independent: true };
      }
      return { independent: false, stop: stop('SV-2a', 'season_artefact_unprovable', 'the schema-1 executable predicate did not fully pass') };
    case 'unprovable':
      return { independent: false, stop: stop('SV-3', 'season_artefact_unprovable', 'mixed classes, an unknown source/stamp, or unprovable bridge independence') };
  }
}

/* ==================================================================== *
 * §5.11 Special-record dependents (DP-1-DP-5)
 * ==================================================================== */

export type DependentEvidence = {
  readonly afterSirenKicksRowForP: boolean; // DP-1
  readonly achievementRowForP: boolean; // DP-2
  readonly unresolvedRowAtMatch: boolean; // DP-3 (report only)
  /** DP-4: a match-less dependent row whose justifying participation the plan would remove. */
  readonly matchLessDependentLosesParticipation: boolean;
  readonly matchLessDependentParticipationRemains: boolean;
  /** DP-5 (report only): does the correction change the tie-break inputs? */
  readonly firstKickGoalTieBreakChanges: boolean;
};

export type DependentResult = {
  readonly stops: readonly Stop[];
  readonly reports: readonly string[];
};

export function evaluateDependents(evidence: DependentEvidence): DependentResult {
  const stops: Stop[] = [];
  const reports: string[] = [];
  if (evidence.afterSirenKicksRowForP) {
    stops.push(stop('DP-1', 'dependent_record_would_be_stale', 'an after_siren_kicks row depends on this participation'));
  }
  if (evidence.achievementRowForP) {
    stops.push(stop('DP-2', 'dependent_record_would_be_stale', 'a player_achievements row depends on this participation'));
  }
  if (evidence.unresolvedRowAtMatch) reports.push('DP-3: an unresolved dependent row exists at this match');
  if (evidence.matchLessDependentLosesParticipation) {
    stops.push(stop('DP-4', 'dependent_record_would_be_stale', 'the match-less dependent loses its justifying participation'));
  } else if (evidence.matchLessDependentParticipationRemains) {
    reports.push('DP-4: a match-less dependent remains valid and is reported as affected');
  }
  if (evidence.firstKickGoalTieBreakChanges) reports.push('DP-5: the first-kick-goal tie-break evidence changes');
  return { stops, reports };
}

/* ==================================================================== *
 * §8.2 step 11 / §5.1 `context.reports`: the Slice-8 structured operator report
 *
 * Everything below is REPORT-ONLY. None of it is part of `MutationPlan`, so none of it can change
 * the fingerprint (§5.1, P4-03), and none of it decides a disposition or a STOP: the §5.10 and
 * §5.11 decisions stay with `evaluateSeasonTotalIndependence` / `evaluateDependents`, and these
 * functions only describe their outcome, or compute report-only facts (cache paths, Coleman,
 * DP-5, findings, candidates) from evidence the adapter reads after the transaction (S8-D2).
 * ==================================================================== */

/** A committed ORIGINAL correction, or a prospective one (`--dry-run` / `--validate-only`). */
export type ImpactPhase = 'committed' | 'prospective';

/** One MOVE/DELETE closure row, as the report needs it. */
export type ClosureImpactRow = {
  readonly table: CanonicalTable;
  readonly rowId: number;
  readonly disposition: 'MOVE' | 'DELETE_AS_FOREIGN_COLLISION';
  /** The row's match; null only for a match-less Brownlow row. */
  readonly matchId: number | null;
  readonly season: number;
  /** `player_match_stats.club_id`; always null for a Brownlow row. */
  readonly clubId: number | null;
  /** `player_match_stats.goals` (NULL = not recorded, never 0); always null for a Brownlow row. */
  readonly goals: number | null;
};

/* ---- §5.10 per-season verdicts ---- */

/** The adapter's SV class of V (`classifySeasonTotals`). */
export type SeasonTotalsClassName = 'empty' | 'admin_published' | 'artefact' | 'unprovable';

export type SeasonVerdictReport = {
  readonly season: number;
  readonly seasonClass: SeasonTotalsClassName;
  readonly verdict: 'INDEPENDENT' | 'STOP';
  readonly rule: 'SV-0' | 'SV-1' | 'SV-2a' | 'SV-3';
  /** How independence was proved, or why it could not be. */
  readonly proof: string;
  /** Exactly the plan's STOP for this season (step and code), or null. */
  readonly stop: { readonly step: string; readonly code: StopCode } | null;
  /** §5.7: every failing condition, named. Empty for an INDEPENDENT season. */
  readonly failedChecks: readonly string[];
};

/**
 * Describe one §5.10 verdict for the report. It never re-decides: `verdict` is exactly what
 * `evaluateSeasonTotalIndependence(evidence)` returned, and the STOP (when any) is its own.
 */
export function describeSeasonVerdict(input: {
  readonly season: number;
  readonly seasonClass: SeasonTotalsClassName;
  readonly evidence: SeasonIndependenceEvidence;
  readonly verdict: SeasonIndependenceVerdict;
}): SeasonVerdictReport {
  const { season, seasonClass, evidence, verdict } = input;
  const failedChecks: string[] = [];
  switch (evidence.kind) {
    case 'admin_published':
      if (evidence.closureMovesOrDeletesPositiveBrownlowRowInSeason) {
        failedChecks.push('SV-1: the closure moves or deletes a Brownlow round row with votes > 0 in this season');
      }
      if (evidence.pOrPPrimeHasRowInSeasonTotals) {
        failedChecks.push('SV-1: P or P′ has a brownlow_season_votes row in this season (its games input changes)');
      }
      break;
    case 'artefact_schema_1':
      if (!evidence.identityCsvSha256Matches) {
        failedChecks.push('SV-2a(0): manifest identity.csv_sha256 is missing or differs from sha256(data/brownlow/player-identity.csv)');
      }
      if (!evidence.artefactCsvSha256Matches) {
        failedChecks.push('SV-2a(1): manifest artefact.csv_sha256 differs from sha256(data/brownlow/season-votes.csv), or the CSV is missing');
      }
      if (!evidence.profilePathResolvesToExactlyOnePlayer) {
        failedChecks.push('SV-2a(3): a season profile path resolves to zero or several players, or the CSV is unparseable');
      }
      if (!evidence.rowForRowMatch) {
        failedChecks.push('SV-2a(4): the live season rows are not equal row-for-row to the mapped schema-1 CSV rows');
      }
      break;
    case 'unprovable':
      failedChecks.push(seasonClass === 'artefact'
        ? 'SV-3: the season-votes manifest is missing, unparseable or not schema 1'
        : 'SV-3: mixed classes, an unknown source or stamp, or a stale published revision');
      break;
    case 'empty':
      break;
  }
  if (!verdict.independent) {
    const rule: SeasonVerdictReport['rule'] = verdict.stop.step === 'SV-1' ? 'SV-1' : verdict.stop.step === 'SV-2a' ? 'SV-2a' : 'SV-3';
    return {
      season, seasonClass, verdict: 'STOP', rule,
      proof: `not proven independent: ${verdict.stop.detail}`,
      stop: { step: verdict.stop.step, code: verdict.stop.code },
      failedChecks,
    };
  }
  const passed = {
    empty: { rule: 'SV-0', proof: 'no brownlow_season_votes rows exist for this season' },
    admin_published: {
      rule: 'SV-1',
      proof: 'every row is admin-published at the current revision; no positive Brownlow closure row, and neither P nor P′ holds a row',
    },
    artefact_schema_1: {
      rule: 'SV-2a',
      proof: 'schema-1 master: identity.csv_sha256 and artefact.csv_sha256 match, every profile path resolves to exactly one player, and the live rows equal the mapped CSV row-for-row',
    },
  } as const;
  const matched = evidence.kind === 'unprovable' ? null : passed[evidence.kind];
  if (matched === null) {
    // evaluateSeasonTotalIndependence never returns independent for SV-3; fail closed if it ever did.
    return { season, seasonClass, verdict: 'STOP', rule: 'SV-3', proof: 'unprovable', stop: { step: 'SV-3', code: 'season_artefact_unprovable' }, failedChecks };
  }
  return { season, seasonClass, verdict: 'INDEPENDENT', rule: matched.rule, proof: matched.proof, stop: null, failedChecks: [] };
}

/** §4.G / O-3: the artefact recurrence risk, reported on every correction (report only). */
export function artefactRecurrenceRisk(input: {
  readonly providerId: string;
  readonly seasonVerdicts: readonly SeasonVerdictReport[];
}): readonly string[] {
  const stopped = input.seasonVerdicts.filter((v) => v.verdict === 'STOP').map((v) => v.season);
  const seasons = input.seasonVerdicts.length === 0
    ? 'no affected season'
    : stopped.length === 0
      ? `every affected season proved independent (${input.seasonVerdicts.map((v) => v.season).join(', ')})`
      : `NOT proven independent: season(s) ${stopped.join(', ')} (whole-plan STOP)`;
  return [
    `bridge artefacts (data/reference/afl-api-player-bridge-*.json, the S5b name-bridge) are not rewritten and may still map ${input.providerId} to P`,
    'live target: the loader cannot re-apply that mapping (first trusted writer wins, migration 104); a replay records an ISSUE-240 contradiction finding instead',
    `season-total Brownlow artefacts (§4.E): fail-closed by §5.10 -- ${seasons}`,
    'promotion source lineage (afldb_test) and its promotion candidate: governed by the corrected-promotion replay (§9); CORRECTED_PROMOTION_REHEARSAL_REQUIRED remains',
    'correction-aware bridge and artefact handling is deferred (O-3)',
  ];
}

/* ---- §5.11 dependent reports (DP-3, DP-4, DP-5) ---- */

export type DependentTable = 'after_siren_kicks' | 'player_achievements';

export type DependentReportEntry = {
  readonly rule: 'DP-3' | 'DP-4' | 'DP-5';
  /** DP-4 alone can be a STOP here (the plan already carries it); DP-3 and DP-5 are report-only. */
  readonly outcome: 'REPORT' | 'STOP';
  readonly table: DependentTable;
  readonly rowId: number;
  readonly playerId: number | null;
  readonly matchId: number | null;
  readonly season: number | null;
  readonly detail: string;
  /** §5.11: the operator refresh path. Reported, never run. */
  readonly refreshPath: readonly string[];
};

/** §5.11 "the operator refresh path is reported, never run". */
export function dependentRefreshPath(table: DependentTable, rowId: number, outcome: 'REPORT' | 'STOP'): readonly string[] {
  const family = table === 'after_siren_kicks' ? 'after-the-siren' : 'first-kick-goal';
  const stages = table === 'after_siren_kicks' ? 'stages after-siren, after-siren-reconcile' : 'stage first-kick-goal';
  return [
    `live target: correct ${table}#${rowId} through its special-records admin surface /admin/records/${family}/${rowId}`
      + (outcome === 'STOP' ? ', then re-run the correction' : ''),
    `afldb_test: the next db:test:rebuild re-resolves it (${stages})`,
  ];
}

/** DP-3 (report only): the unresolved (`player_id IS NULL`) dependents at a closure row's match. */
export function unresolvedDependentReports(input: {
  readonly closureRowId: number;
  readonly matchId: number;
  readonly rows: readonly { readonly table: DependentTable; readonly id: number }[];
}): DependentReportEntry[] {
  return [...input.rows]
    .sort((a, b) => (a.table === b.table ? a.id - b.id : a.table.localeCompare(b.table)))
    .map((row) => ({
      rule: 'DP-3', outcome: 'REPORT', table: row.table, rowId: row.id, playerId: null, matchId: input.matchId, season: null,
      detail: `unresolved ${row.table}#${row.id} at match ${input.matchId} (closure row player_match_stats#${input.closureRowId}): its resolution evidence changes`,
      refreshPath: dependentRefreshPath(row.table, row.id, 'REPORT'),
    }));
}

/** DP-4: the exact loader-participation verdict (unchanged), described per row with its refresh path. */
export function matchLessDependentReports(verdict: {
  readonly losesParticipation: readonly MatchLessDependentRef[];
  readonly participationRemains: readonly MatchLessDependentRef[];
  readonly pPrimeReported: readonly MatchLessDependentRef[];
}): DependentReportEntry[] {
  const entry = (d: MatchLessDependentRef, outcome: 'REPORT' | 'STOP', detail: string): DependentReportEntry => ({
    rule: 'DP-4', outcome, table: d.table, rowId: d.id, playerId: d.playerId, matchId: null, season: d.season, detail,
    refreshPath: dependentRefreshPath(d.table, d.id, outcome),
  });
  return [
    ...verdict.losesParticipation.map((d) => entry(d, 'STOP',
      `match-less ${d.table}#${d.id} (player ${d.playerId}, season ${d.season}) loses its justifying club-season participation`)),
    ...verdict.participationRemains.map((d) => entry(d, 'REPORT',
      `match-less ${d.table}#${d.id} (player ${d.playerId}, season ${d.season}) keeps its justifying participation; affected, still valid`)),
    ...verdict.pPrimeReported.map((d) => entry(d, 'REPORT',
      `match-less ${d.table}#${d.id} (P′ player ${d.playerId}, season ${d.season}) only gains participation; affected`)),
  ];
}

/** The fields of a match-less dependent the DP-4 report needs (the adapter's `MatchLessDependent`). */
export type MatchLessDependentRef = {
  readonly table: DependentTable;
  readonly id: number;
  readonly playerId: number;
  readonly season: number;
};

/** One `player_match_stats` participation of a player, in career order terms (§4.D). */
export type CareerMatch = {
  readonly matchId: number;
  /** `matches.match_date` as ISO `YYYY-MM-DD` text, so string order is date order. */
  readonly matchDate: string;
  readonly season: number;
};

/** A `player_achievements` `first_kick_goal` row naming P or P′. */
export type FirstKickGoalRow = {
  readonly id: number;
  readonly playerId: number;
  readonly matchId: number | null;
  readonly season: number;
};

/**
 * The debut under the repository's own derived contract (`player-derived.ts`): `career_game_no = 1`
 * is the first match by `(match_date, match_id)`, and `debut_season` is the minimum season.
 */
export function careerDebut(career: readonly CareerMatch[]): { readonly matchId: number | null; readonly season: number | null } {
  let first: CareerMatch | null = null;
  let season: number | null = null;
  for (const m of career) {
    if (first === null || m.matchDate < first.matchDate || (m.matchDate === first.matchDate && m.matchId < first.matchId)) first = m;
    if (season === null || m.season < season) season = m.season;
  }
  return { matchId: first?.matchId ?? null, season };
}

/**
 * The pre-correction careers of P and P′. A prospective report reads them before any write (the
 * dry-run rolled back), so they are the current state. A committed report reads after COMMIT, so
 * the correction is undone in memory: P regains every MOVE and DELETE row, P′ loses the MOVE rows.
 */
export function careersBeforeCorrection(input: {
  readonly phase: ImpactPhase;
  readonly pCurrent: readonly CareerMatch[];
  readonly pPrimeCurrent: readonly CareerMatch[];
  readonly moved: readonly CareerMatch[];
  readonly deleted: readonly CareerMatch[];
}): { readonly pBefore: readonly CareerMatch[]; readonly pPrimeBefore: readonly CareerMatch[] } {
  if (input.phase === 'prospective') return { pBefore: input.pCurrent, pPrimeBefore: input.pPrimeCurrent };
  const movedIds = new Set(input.moved.map((m) => m.matchId));
  return {
    pBefore: uniqueCareer([...input.pCurrent, ...input.moved, ...input.deleted]),
    pPrimeBefore: input.pPrimeCurrent.filter((m) => !movedIds.has(m.matchId)),
  };
}

function uniqueCareer(rows: readonly CareerMatch[]): CareerMatch[] {
  const byMatch = new Map<number, CareerMatch>();
  for (const row of rows) if (!byMatch.has(row.matchId)) byMatch.set(row.matchId, row);
  return [...byMatch.values()];
}

/**
 * §5.11 DP-5 (report only; never a STOP, never in the plan): a `first_kick_goal` row for P or P′
 * whose player's debut match (`career_game_no = 1`) or `debut_season` the correction changes. P
 * loses every `player_match_stats` MOVE and DELETE row; P′ gains the MOVE rows only (a DELETE adds
 * nothing to P′).
 */
export function evaluateFirstKickGoalDebutChanges(input: {
  readonly pId: number;
  readonly pPrimeId: number;
  readonly pBefore: readonly CareerMatch[];
  readonly pPrimeBefore: readonly CareerMatch[];
  readonly moved: readonly CareerMatch[];
  readonly deleted: readonly CareerMatch[];
  readonly firstKickGoals: readonly FirstKickGoalRow[];
}): DependentReportEntry[] {
  const removed = new Set([...input.moved, ...input.deleted].map((m) => m.matchId));
  const after = new Map<number, readonly CareerMatch[]>([
    [input.pId, input.pBefore.filter((m) => !removed.has(m.matchId))],
    [input.pPrimeId, uniqueCareer([...input.pPrimeBefore, ...input.moved])],
  ]);
  const before = new Map<number, readonly CareerMatch[]>([[input.pId, input.pBefore], [input.pPrimeId, input.pPrimeBefore]]);
  const out: DependentReportEntry[] = [];
  for (const playerId of [input.pId, input.pPrimeId]) {
    const rows = input.firstKickGoals.filter((r) => r.playerId === playerId).sort((a, b) => a.id - b.id);
    if (rows.length === 0) continue;
    const was = careerDebut(before.get(playerId)!);
    const now = careerDebut(after.get(playerId)!);
    if (was.matchId === now.matchId && was.season === now.season) continue;
    const role = playerId === input.pId ? 'P' : 'P′';
    const changes = [
      ...(was.matchId !== now.matchId ? [`debut match ${String(was.matchId)} -> ${String(now.matchId)}`] : []),
      ...(was.season !== now.season ? [`debut season ${String(was.season)} -> ${String(now.season)}`] : []),
    ].join(', ');
    for (const row of rows) {
      out.push({
        rule: 'DP-5', outcome: 'REPORT', table: 'player_achievements', rowId: row.id, playerId,
        matchId: row.matchId, season: row.season,
        detail: `first_kick_goal player_achievements#${row.id} for ${role} (player ${playerId}): ${changes}; the importer's tie-break evidence changes (import-first-kick-goal.ts:446-457)`,
        refreshPath: dependentRefreshPath('player_achievements', row.id, 'REPORT'),
      });
    }
  }
  return out;
}

/* ---- §4.F Coleman ---- */

/** A `player_match_stats` closure row with the Coleman derivation's inputs (coleman-derivation.json). */
export type ColemanRowFacts = {
  readonly rowId: number;
  readonly season: number;
  readonly matchId: number;
  /** `matches.is_final` (= round_type <> 'home_and_away', migration 003). */
  readonly isFinal: boolean;
  /** `seasons.status = 'complete'`. */
  readonly seasonComplete: boolean;
  readonly goals: number | null;
};

export type ColemanStaleReason = 'goal_totals_change' | 'winner_club_attribution';

export type ColemanSeasonImpact = {
  readonly season: number;
  readonly reasons: readonly ColemanStaleReason[];
  readonly rowIds: readonly number[];
};

/**
 * §4.F (report only): the completed seasons whose derived Coleman `award_winners` the correction
 * can make stale. A row counts only in the derivation's own scope: home-and-away (`NOT is_final`),
 * `seasons.status = 'complete'`, `season >= first_season`. Then:
 *   - `goals > 0`: P's (and, for a MOVE, P′'s) home-and-away total changes;
 *   - otherwise (0 or NULL goals): only the winner's club attribution (the derivation's DISTINCT
 *     club count over the winner's home-and-away rows) can change, and only when P or P′ is a
 *     current Coleman winner of that season.
 * Seasons are sorted and deduplicated. Nothing is recomputed or written.
 */
export function evaluateColemanImpact(input: {
  readonly rows: readonly ColemanRowFacts[];
  readonly firstSeason: number;
  readonly winnerSeasonsForPOrPPrime: ReadonlySet<number>;
}): ColemanSeasonImpact[] {
  const bySeason = new Map<number, { reasons: Set<ColemanStaleReason>; rowIds: Set<number> }>();
  for (const row of input.rows) {
    if (row.isFinal || !row.seasonComplete || row.season < input.firstSeason) continue;
    let reason: ColemanStaleReason | null = null;
    if (row.goals !== null && row.goals > 0) reason = 'goal_totals_change';
    else if (input.winnerSeasonsForPOrPPrime.has(row.season)) reason = 'winner_club_attribution';
    if (reason === null) continue;
    const entry = bySeason.get(row.season) ?? { reasons: new Set<ColemanStaleReason>(), rowIds: new Set<number>() };
    entry.reasons.add(reason);
    entry.rowIds.add(row.rowId);
    bySeason.set(row.season, entry);
  }
  const order: readonly ColemanStaleReason[] = ['goal_totals_change', 'winner_club_attribution'];
  return [...bySeason.entries()]
    .sort(([a], [b]) => a - b)
    .map(([season, e]) => ({
      season,
      reasons: order.filter((r) => e.reasons.has(r)),
      rowIds: [...e.rowIds].sort((a, b) => a - b),
    }));
}

/* ---- §4.H caches (D10, O-4: report only, never invalidated here) ---- */

export type CacheImpact = {
  readonly canonicalRowsChanged: boolean;
  /** Exact, deterministic, deduplicated. */
  readonly paths: readonly string[];
  /** The seasons whose `/seasons/<year>` the existing CLI-reachable revalidation can refresh (O-4). */
  readonly seasonRevalidations: readonly number[];
  /** Entities whose exact path could not be composed (a slug that was not found). */
  readonly unresolved: readonly string[];
};

/**
 * The exact ISR routes (§4.H) the MOVE/DELETE closure can make stale, in a fixed group order:
 * P, P′, matches, seasons, Brownlow seasons, clubs, then `/records`, `/records/[category]` (the
 * existing contract revalidates every category page, `admin/brownlow/actions.ts`) and `/`.
 * `/brownlow/<year>` only for a season with a Brownlow closure row. With no canonical row moved
 * or deleted, no route is claimed.
 */
export function affectedCachePaths(input: {
  readonly rows: readonly ClosureImpactRow[];
  /** P then P′; `slug` null when the player could not be read. */
  readonly players: readonly { readonly id: number; readonly slug: string | null }[];
  readonly clubSlugs: ReadonlyMap<number, string>;
}): CacheImpact {
  if (input.rows.length === 0) return { canonicalRowsChanged: false, paths: [], seasonRevalidations: [], unresolved: [] };
  const sortedNumbers = (values: Iterable<number>) => [...new Set(values)].sort((a, b) => a - b);
  const paths: string[] = [];
  const unresolved: string[] = [];
  for (const player of input.players) {
    if (player.slug === null) unresolved.push(`player ${player.id}: slug unavailable (/players/<slug>-${player.id})`);
    else paths.push(playerPath(player.slug, player.id));
  }
  for (const id of sortedNumbers(input.rows.flatMap((r) => (r.matchId === null ? [] : [r.matchId])))) paths.push(matchPath(id));
  const seasons = sortedNumbers(input.rows.map((r) => r.season));
  for (const season of seasons) paths.push(seasonPath(season));
  for (const season of sortedNumbers(input.rows.filter((r) => r.table === 'brownlow_round_votes').map((r) => r.season))) {
    paths.push(`/brownlow/${season}`);
  }
  const clubPaths: string[] = [];
  for (const clubId of sortedNumbers(input.rows.flatMap((r) => (r.clubId === null ? [] : [r.clubId])))) {
    const slug = input.clubSlugs.get(clubId);
    if (slug === undefined) unresolved.push(`club ${clubId}: slug unavailable (/clubs/<slug>)`);
    else clubPaths.push(clubPath(slug));
  }
  paths.push(...clubPaths.sort(), '/records', '/records/[category]', '/');
  return { canonicalRowsChanged: true, paths: [...new Set(paths)], seasonRevalidations: seasons, unresolved };
}

/* ---- §4.B open findings and pending candidates (report only; never resolved here) ---- */

export type FindingScope = {
  readonly providerId: string;
  readonly pId: number;
  readonly pPrimeId: number;
  readonly pIdentity: string;
  readonly pPrimeIdentity: string;
};

/** One `data_issues` row as the reporter reads it. */
export type OpenFindingRow = {
  readonly id: string;
  readonly issueType: string;
  readonly issueKey: string;
  readonly resolved: boolean;
  readonly details: Readonly<Record<string, JsonValue>> | null;
};

export type FindingReport = {
  readonly id: string;
  readonly issueType: string;
  readonly issueKey: string;
  readonly selector: 'canonical_apply_failed_for_provider' | 'contradiction_for_provider' | 'contradiction_names_player';
  /** §8.2 step 7's own predicate: a contradiction this correction adjudicates (resolved in its transaction). */
  readonly adjudicatedByThisCorrection: boolean;
};

/**
 * §4.B: the OPEN findings the correction reports and does not resolve:
 *   - `canonical_apply_failed` of `afl_api` keyed on a `…|CD_I` record;
 *   - ISSUE-240 `afl_api_identity_contradiction` for CD_I, or naming P or P′ (by player id or
 *     stable identity).
 * A resolved row is never reported as open.
 */
export function selectOpenFindings(rows: readonly OpenFindingRow[], scope: FindingScope): FindingReport[] {
  const players = new Set([String(scope.pId), String(scope.pPrimeId)]);
  const identities = new Set([scope.pIdentity, scope.pPrimeIdentity]);
  const text = (v: JsonValue | undefined) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);
  const out: FindingReport[] = [];
  for (const row of rows) {
    if (row.resolved) continue;
    const d: Readonly<Record<string, JsonValue>> = row.details ?? {};
    if (row.issueType === 'canonical_apply_failed') {
      const record = text(d.external_record_id);
      if (text(d.source_key) === 'afl_api' && record !== null && record.endsWith(`|${scope.providerId}`)) {
        out.push({ id: row.id, issueType: row.issueType, issueKey: row.issueKey, selector: 'canonical_apply_failed_for_provider', adjudicatedByThisCorrection: false });
      }
      continue;
    }
    if (row.issueType !== 'afl_api_identity_contradiction') continue;
    const adjudicated = text(d.external_id) === scope.providerId && text(d.proposed_player_identity) === scope.pPrimeIdentity;
    if (text(d.external_id) === scope.providerId || text(d.existing_external_id) === scope.providerId) {
      out.push({ id: row.id, issueType: row.issueType, issueKey: row.issueKey, selector: 'contradiction_for_provider', adjudicatedByThisCorrection: adjudicated });
    } else if (
      [d.proposed_player_id, d.existing_player_id].some((v) => players.has(text(v) ?? ''))
      || [d.proposed_player_identity, d.existing_player_ref].some((v) => identities.has(text(v) ?? ''))
    ) {
      out.push({ id: row.id, issueType: row.issueType, issueKey: row.issueKey, selector: 'contradiction_names_player', adjudicatedByThisCorrection: false });
    }
  }
  return out.sort((a, b) => (a.id.length === b.id.length ? a.id.localeCompare(b.id) : a.id.length - b.id.length));
}

/** One `promotion_candidates` row as the reporter reads it. */
export type PendingCandidateRow = {
  readonly id: string;
  readonly family: string;
  readonly externalRecordId: string;
  readonly targetTable: string;
  readonly verb: string;
  readonly season: number;
  readonly status: string;
  /** `proposed_fields->>'player_id'`. */
  readonly proposedPlayerId: string | null;
};

export type PendingCandidateReport = Omit<PendingCandidateRow, 'status'> & {
  readonly selector: 'provider_record' | 'proposes_p';
};

/**
 * §4.B: the PENDING candidates the correction reports (it cannot resolve one): `external_record_id`
 * ending `|CD_I`, or `proposed_fields->>'player_id'` = P. Accepted, rejected and superseded rows
 * are never reported.
 */
export function selectPendingCandidates(
  rows: readonly PendingCandidateRow[], scope: { readonly providerId: string; readonly pId: number },
): PendingCandidateReport[] {
  const out: PendingCandidateReport[] = [];
  for (const { status, ...row } of rows) {
    if (status !== 'pending') continue;
    if (row.externalRecordId.endsWith(`|${scope.providerId}`)) out.push({ ...row, selector: 'provider_record' });
    else if (row.proposedPlayerId === String(scope.pId)) out.push({ ...row, selector: 'proposes_p' });
  }
  return out.sort((a, b) => (a.id.length === b.id.length ? a.id.localeCompare(b.id) : a.id.length - b.id.length));
}

/* ---- §5.12 Q2 report outcomes (already decided by Q2; exposed, never re-decided) ---- */

export type SatisfactionReportEntry =
  | {
    readonly kind: 'correction_target_absent';
    readonly table: CanonicalTable;
    readonly key: string;
    readonly matchId: number | null;
    readonly auditId: string | null;
  }
  | {
    readonly kind: 'post_correction_edit';
    readonly table: CanonicalTable;
    readonly key: string;
    readonly writer: PostCorrectionExplanation['writer'];
    /** Null for a Brownlow-admin re-ownership (no single field). */
    readonly field: string | null;
    readonly from: JsonValue;
    readonly to: JsonValue;
    readonly auditId: string | null;
  }
  | { readonly kind: 'post_correction_reappearance'; readonly table: CanonicalTable; readonly key: string };

/**
 * The report-only context of one planned closure (§5.1 `context`): built pre-commit from evidence
 * the plan already read, so a STOP is explained without any post-transaction read (S8-D4).
 */
export type CorrectionReportContext = {
  readonly closureRows: readonly ClosureImpactRow[];
  readonly seasonVerdicts: readonly SeasonVerdictReport[];
  /** DP-3 and DP-4; DP-5 is gathered after the transaction. */
  readonly dependents: readonly DependentReportEntry[];
  readonly artefactRisk: readonly string[];
  /**
   * §5.7: the named evidence of each row STOP (the planner's `detail`, for example the differing
   * fields), keyed by the STOP's index in the plan's `stops`. The plan's STOP objects never carry
   * it, so neither the plan nor its fingerprint changes; it is attached only to the printed STOP.
   */
  readonly stopDetails?: readonly { readonly index: number; readonly detail: string }[];
};

/* ==================================================================== *
 * §5.1 Fingerprint
 * ==================================================================== */

export type ClosureRowFingerprintInput = {
  readonly table: CanonicalTable;
  readonly rowId: number;
  readonly naturalKey: JsonValue;
  readonly disposition: 'MOVE' | 'DELETE_AS_FOREIGN_COLLISION';
  readonly contractSha256: string;
  readonly provenance: { readonly sourceKey: string; readonly sourceRecordId: string; readonly importBatchId: number };
  /** Runbook §5.1 (S6-D1): the link evidence the disposition rests on. */
  readonly evidence: {
    readonly applicationIds: readonly number[];
    readonly citedVersion: {
      readonly sourceId: number;
      readonly family: string;
      readonly externalRecordId: string;
      readonly seq: number;
    };
    /** B3-I, Brownlow only; null otherwise. */
    readonly insertPayloadSha256: string | null;
  };
  /** Runbook §5.1/§5.4 (S6-D1): the collision counterpart, or null when none. */
  readonly collision: {
    readonly counterpartRowId: number;
    readonly counterpartContractSha256: string;
    readonly outcome: 'C2' | 'C4';
  } | null;
};

export type AuthorityBlock =
  | {
    readonly mode: 'ORIGINAL';
    readonly netState: 'LINKED' | 'NONE';
    readonly ledgerId: number | null;
    readonly liveIdentityRowId: number;
    readonly previousPlayerIdentity: string;
    readonly playerIdentity: string;
  }
  | {
    readonly mode: 'ADJUDICATION' | 'PREDICT';
    readonly adjudicationId: number;
    readonly externalId: string;
    readonly evidenceSha256: string;
    readonly previousPlayerIdentity: string;
    readonly playerIdentity: string;
  };

export type MutationPlan = {
  readonly plannerVersion: number;
  readonly provider: { readonly externalId: string; readonly sourceKey: 'afl_api' };
  readonly authority: AuthorityBlock;
  readonly identityAction: 'update_in_place' | 'upgrade_in_place' | 'insert' | 'none';
  readonly rows: readonly ClosureRowFingerprintInput[];
  readonly stops: readonly { readonly table: CanonicalTable; readonly rowId: number | null; readonly step: string; readonly code: StopCode }[];
};

function sortedRows(rows: readonly ClosureRowFingerprintInput[]): readonly ClosureRowFingerprintInput[] {
  return [...rows].sort((a, b) => (a.table === b.table ? a.rowId - b.rowId : a.table.localeCompare(b.table)));
}

function sortedStops(stops: MutationPlan['stops']): MutationPlan['stops'] {
  return [...stops].sort((a, b) => {
    if (a.table !== b.table) return a.table.localeCompare(b.table);
    if ((a.rowId ?? -1) !== (b.rowId ?? -1)) return (a.rowId ?? -1) - (b.rowId ?? -1);
    return a.step.localeCompare(b.step);
  });
}

/** sha256(canonicalJson(mutationPlan)) — the single fingerprinted object (§5.1). */
export function mutationPlanFingerprint(plan: MutationPlan): string {
  // Runbook §5.1 (J-1): the same planned mutation fingerprints identically at §6 PREDICT and
  // §7.4e REPLAY (ADJUDICATION), so PREDICT is hashed as ADJUDICATION. The plan value keeps its mode.
  const authority: AuthorityBlock = plan.authority.mode === 'PREDICT'
    ? { ...plan.authority, mode: 'ADJUDICATION' }
    : plan.authority;
  const rows = sortedRows(plan.rows).map((row) => ({
    ...row,
    evidence: { ...row.evidence, applicationIds: [...row.evidence.applicationIds].sort((a, b) => a - b) },
  }));
  const canonical = {
    plannerVersion: plan.plannerVersion,
    provider: plan.provider,
    authority,
    identityAction: plan.identityAction,
    rows,
    stops: sortedStops(plan.stops),
  } as unknown as JsonValue;
  return createHash('sha256').update(canonicalJson(canonical)).digest('hex');
}

/** sha256 of a row's full column set, for `beforeFingerprint`/`contractSha256` (§5.1, §5.6 L5 row proof). */
export function rowContractHash(row: Readonly<Record<string, JsonValue>>): string {
  return createHash('sha256').update(canonicalJson(row as unknown as JsonValue)).digest('hex');
}

/* ==================================================================== *
 * §5.4 Whole-plan STOPs (mutation-eligibility set)
 * ==================================================================== */

export type WholePlanEvidence = {
  readonly pEqualsPPrimeByPlayerId: boolean;
  readonly pEqualsPPrimeByStableIdentity: boolean;
  readonly pPrimeHoldsAnotherAflApiProvider: boolean;
  readonly stableIdentityMissingOrAmbiguous: boolean;
  readonly identityIsManualAdminEditToken: boolean;
  readonly netStateAlreadyCorrected: boolean; // ORIGINAL only: a chain attempt
};

export function evaluateWholePlanStops(evidence: WholePlanEvidence): readonly Stop[] {
  const stops: Stop[] = [];
  if (evidence.pPrimeHoldsAnotherAflApiProvider) {
    stops.push(stop('D8', 'p_prime_holds_another_provider', "P' already owns another AFL API provider"));
  }
  if (evidence.pEqualsPPrimeByPlayerId || evidence.pEqualsPPrimeByStableIdentity) {
    stops.push(stop('§5.4', 'p_equals_p_prime', 'P and P\' are the same player or the same stable identity'));
  }
  if (evidence.stableIdentityMissingOrAmbiguous) {
    stops.push(stop('D7', 'identity_unresolvable', 'the stable identity of P or P\' is missing or ambiguous'));
  }
  if (evidence.identityIsManualAdminEditToken) {
    stops.push(stop('O-2', 'manual_admin_edit_identity', 'the identity of P or P\' is a manual_admin_edit token'));
  }
  if (evidence.netStateAlreadyCorrected) {
    stops.push(stop('§5.4', 'already_corrected_provider', 'the net ledger state is already CORRECTED; a correction of a correction is a chain (D8)'));
  }
  return stops;
}

/* ==================================================================== *
 * §9.1 CPC: the corrected-candidate classifier (pure, no database)
 * ==================================================================== */

/** The resolution of `A.previous_player_identity` (Pc) or `A.player_identity` remapped (P'c) in the candidate. */
export type CpcIdentityResolution =
  | { readonly kind: 'unique'; readonly playerId: number }
  | { readonly kind: 'unevaluable'; readonly reason: 'manual_admin_token' | 'unresolved' | 'ambiguous' };

/** The candidate's `afl_api` identity row for CD_I. `importerOwned=false` (a human row) is UNEVALUABLE. */
export type CpcProviderRow = {
  readonly id: number;
  readonly playerId: number;
  readonly status: string;
  readonly matchMethod: string | null;
  readonly importerOwned: boolean;
};

export type CpcMutationCounts = { readonly player_match_stats: number; readonly brownlow_round_votes: number };

/** The §5.1 closure PREDICTED on the candidate; null when nothing was planned. */
export type CpcPrediction = {
  readonly stops: readonly { readonly code: StopCode; readonly step?: string }[];
  readonly moveOrDeleteRowCount: number;
  readonly fingerprint: string;
  readonly plannerVersion: number;
  readonly moved: CpcMutationCounts;
  readonly deleted: CpcMutationCounts;
};

export type CpcInput = {
  readonly externalId: string;
  readonly adjudicationId: number;
  readonly pc: CpcIdentityResolution;
  readonly pPrime: CpcIdentityResolution;
  readonly providerRow: CpcProviderRow | null;
  /** S6-D4 class 5 sources. `externalId` itself is excluded by the classifier. */
  readonly collisions: {
    readonly candidateImporterProvidersAtPPrime: readonly string[];
    readonly targetHumanProvidersRemappingToPPrime: readonly string[];
  };
  /** Class 3 guard. */
  readonly pcStillImplicated: { readonly rowsImplicatingCdIAtPc: number; readonly unprovableCdILineage: boolean };
  readonly prediction: CpcPrediction | null;
};

export type CpcFailCode =
  | 'UNEVALUABLE'
  | 'DISAGREE'
  | 'COLLISION'
  | 'PREDICT_STOP'
  | 'IDENTITY_ONLY_CLOSURE_NOT_EMPTY'
  | 'PC_STILL_IMPLICATED';

export type CpcResult =
  | {
    readonly outcome: 'PASS';
    readonly externalId: string;
    readonly adjudicationId: number;
    readonly candidateClass: 1 | 2 | 3;
    readonly predictedIdentityAction: 'update_in_place' | 'upgrade_in_place' | 'insert';
    readonly providerRowId: number | null;
    readonly plannerVersion: number;
    readonly predictedClosureFingerprint: string;
    readonly predictedMutations: { readonly moved: CpcMutationCounts; readonly deleted: CpcMutationCounts };
  }
  | {
    readonly outcome: 'FAIL';
    readonly externalId: string;
    readonly adjudicationId: number;
    /** 4/5/6 for DISAGREE/COLLISION/PREDICT_STOP; 1-3 for a class-specific check; null for UNEVALUABLE. */
    readonly candidateClass: 1 | 2 | 3 | 4 | 5 | 6 | null;
    readonly code: CpcFailCode;
    readonly detail: string;
  };

function cpcFail(input: CpcInput, candidateClass: 1 | 2 | 3 | 4 | 5 | 6 | null, code: CpcFailCode, detail: string): CpcResult {
  return { outcome: 'FAIL', externalId: input.externalId, adjudicationId: input.adjudicationId, candidateClass, code, detail };
}

/**
 * Classify one CORRECTED provider against the candidate (runbook §9.1 CPC table, S6-D4).
 * Deterministic precedence: UNEVALUABLE -> COLLISION (5) -> DISAGREE (4) -> PREDICT STOP (6) ->
 * class-specific checks (class 2: identity-only closure must be empty; class 3: Pc no longer implicated).
 */
export function classifyCorrectedCandidate(input: CpcInput): CpcResult {
  // 1. UNEVALUABLE
  const unevaluable: string[] = [];
  if (input.pc.kind === 'unevaluable') unevaluable.push(`Pc: ${input.pc.reason}`);
  if (input.pPrime.kind === 'unevaluable') unevaluable.push(`P'c: ${input.pPrime.reason}`);
  if (input.pc.kind === 'unique' && input.pPrime.kind === 'unique' && input.pc.playerId === input.pPrime.playerId) {
    unevaluable.push("Pc equals P'c (not a correction)");
  }
  if (input.providerRow !== null && !input.providerRow.importerOwned) {
    unevaluable.push(`provider row #${input.providerRow.id} is not importer-owned (${input.providerRow.status}/${input.providerRow.matchMethod ?? 'null'})`);
  }
  if (unevaluable.length > 0 || input.pc.kind !== 'unique' || input.pPrime.kind !== 'unique') {
    return cpcFail(input, null, 'UNEVALUABLE', unevaluable.join('; '));
  }
  const pcId = input.pc.playerId;
  const pPrimeId = input.pPrime.playerId;

  // 2. COLLISION (class 5, D8/S6-D4): another provider holds or maps to P'c. CD_I itself is excluded.
  const others = (ids: readonly string[]) => ids.filter((id) => id !== input.externalId);
  const candidateHolders = others(input.collisions.candidateImporterProvidersAtPPrime);
  const targetHolders = others(input.collisions.targetHumanProvidersRemappingToPPrime);
  if (candidateHolders.length > 0 || targetHolders.length > 0) {
    const parts: string[] = [];
    if (candidateHolders.length > 0) parts.push(`candidate importer provider(s) at P'c: ${[...candidateHolders].sort().join(',')}`);
    if (targetHolders.length > 0) parts.push(`target human provider(s) remapping to P'c: ${[...targetHolders].sort().join(',')}`);
    return cpcFail(input, 5, 'COLLISION', parts.join('; '));
  }

  // 3. DISAGREE (class 4): the row is at a third identity.
  const row = input.providerRow;
  if (row !== null && row.playerId !== pcId && row.playerId !== pPrimeId) {
    return cpcFail(input, 4, 'DISAGREE', `provider row #${row.id} is at player ${row.playerId}, neither Pc ${pcId} nor P'c ${pPrimeId}`);
  }

  // 4. PREDICT STOP (class 6)
  const prediction = input.prediction;
  if (prediction === null) return cpcFail(input, 6, 'PREDICT_STOP', 'no closure prediction was produced');
  if (prediction.plannerVersion !== PLANNER_VERSION) {
    return cpcFail(input, 6, 'PREDICT_STOP', `prediction plannerVersion ${prediction.plannerVersion} != ${PLANNER_VERSION}`);
  }
  if (prediction.stops.length > 0) {
    return cpcFail(input, 6, 'PREDICT_STOP', [...new Set(prediction.stops.map((s) => s.code))].sort().join(','));
  }

  // 5. class-specific checks
  const predictedMutations = { moved: prediction.moved, deleted: prediction.deleted };
  const pass = (candidateClass: 1 | 2 | 3, predictedIdentityAction: 'update_in_place' | 'upgrade_in_place' | 'insert'): CpcResult => ({
    outcome: 'PASS', externalId: input.externalId, adjudicationId: input.adjudicationId, candidateClass,
    predictedIdentityAction, providerRowId: row?.id ?? null, plannerVersion: prediction.plannerVersion,
    predictedClosureFingerprint: prediction.fingerprint, predictedMutations,
  });
  if (row !== null && row.playerId === pcId) return pass(1, 'update_in_place');
  if (row !== null) {
    // row.playerId === P'c: identity-only upgrade; there must be nothing left to MOVE/DELETE.
    if (prediction.moveOrDeleteRowCount !== 0) {
      return cpcFail(input, 2, 'IDENTITY_ONLY_CLOSURE_NOT_EMPTY', `${prediction.moveOrDeleteRowCount} row(s) would still MOVE/DELETE for an identity-only upgrade`);
    }
    return pass(2, 'upgrade_in_place');
  }
  if (input.pcStillImplicated.rowsImplicatingCdIAtPc > 0 || input.pcStillImplicated.unprovableCdILineage) {
    return cpcFail(
      input, 3, 'PC_STILL_IMPLICATED',
      `${input.pcStillImplicated.rowsImplicatingCdIAtPc} candidate row(s) implicate CD_I at Pc; unprovable lineage=${input.pcStillImplicated.unprovableCdILineage}`,
    );
  }
  return pass(3, 'insert');
}

/**
 * C_promotion (§9.1): the sorted providers in classes 1-3, which must be disjoint from E_promotion.
 * Any FAIL, any overlap with `ePromotion`, and any duplicate externalId is a problem.
 */
export function deriveCorrectedPromotionSet(
  results: readonly CpcResult[], ePromotion: ReadonlySet<string>,
): { readonly ok: true; readonly cPromotion: string[] } | { readonly ok: false; readonly problems: string[] } {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (seen.has(r.externalId)) problems.push(`${r.externalId}: duplicate CPC result`);
    seen.add(r.externalId);
    if (r.outcome === 'FAIL') problems.push(`${r.externalId}: CPC FAIL ${r.code}${r.candidateClass === null ? '' : ` (class ${r.candidateClass})`}: ${r.detail}`);
    if (ePromotion.has(r.externalId)) problems.push(`${r.externalId}: in both C_promotion and E_promotion (must be disjoint)`);
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, cPromotion: results.map((r) => r.externalId).sort() };
}
