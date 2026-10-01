/**
 * AFLDB-ISSUE-235 — pure decision logic for `afl_api` human identity
 * adjudication (`/admin/player-links/afl-api`).
 *
 * No database, clock or network access. Every fact this module needs (the
 * existing `external_identities` row, pending candidates, the chosen
 * player's own rows, the D10 non-use proof's raw counts) is read by the
 * query module (`src/db/queries/afl-api-player-links.ts`) and passed in
 * here as plain data, so every decision is a pure function of that data and
 * is testable without a connection (runbook §10.1 A1-A12).
 *
 * Four responsibilities, matching the runbook's own structure:
 *   1. state classification (§5) and the refusal decisions for T2-T9, T19, T20;
 *   2. `adjudicationFingerprint()` (D7) and input validation (D12, OD-4);
 *   3. the D10 player-reference manifest, its catalogue validator and the
 *      non-use proof evaluator (plan-review R1, R2, R5);
 *   4. the D15 replay planner and the audit/identity bijection checker
 *      (OD-3, plan-review R3, R8).
 */
import { createHash } from 'node:crypto';

import type { AflApiProviderClassification, AflApiPlayerEvidenceResult } from './afl-api-player-evidence';
import type {
  FitzroyProfileContinuityRule, ValidatedFitzroyProfileContinuityRules,
} from './fitzroy-profile-continuity';
import { canonicalJson, type JsonValue } from './observations';

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

/** afl_api provider player ids are stable across seasons (roster contract, E22). */
export const AFL_API_PROVIDER_ID_RE = /^CD_I[0-9]+$/;

/** The only (status, match_method) pair this issue ever writes (D1, D8). */
export const AFL_API_ADMIN_MATCH_METHOD = 'afl_api_admin_adjudication';

/** OD-4: every manual adjudication needs a non-trivial note, agreement or not. */
export const ADJUDICATION_NOTE_MIN_LENGTH = 20;
export const ADJUDICATION_NOTE_MAX_LENGTH = 2000;

/* ------------------------------------------------------------------ *
 * 1. State model (§5) and refusal decisions (T2-T9, T19, T20)
 * ------------------------------------------------------------------ */

export type AflApiIdentityState =
  | 'U0' // unobserved: no pending candidate, no row
  | 'U1' // unresolved: pending candidate(s) exist, no row -- actionable
  | 'L-I' // importer-linked: status = 'unique'
  | 'L-H' // human-linked: status = 'resolved' AND match_method = afl_api_admin_adjudication
  | 'X'; // anomalous: NULL player, untrusted status, or resolved under a foreign method

export type AflApiIdentityRow = {
  id: number;
  status: string;
  playerId: number | null;
  matchMethod: string | null;
};

/** Pure classification straight from §5's table -- no writer today produces `X`. */
export function classifyAflApiIdentityState(input: {
  row: AflApiIdentityRow | null;
  hasPendingCandidate: boolean;
}): AflApiIdentityState {
  const { row, hasPendingCandidate } = input;
  if (row === null) return hasPendingCandidate ? 'U1' : 'U0';
  if (row.playerId === null) return 'X';
  if (row.status !== 'unique' && row.status !== 'resolved') return 'X';
  if (row.status === 'unique') return 'L-I';
  return row.matchMethod === AFL_API_ADMIN_MATCH_METHOD ? 'L-H' : 'X';
}

export type AflApiRefusalCode =
  | 'T2_already_linked_same_player'
  | 'T3_already_linked_different_player'
  | 'T4_player_holds_another_provider'
  | 'T5_no_evidence'
  | 'T6_stale_fingerprint'
  | 'T7_player_not_stable'
  | 'T8_anomalous_row'
  | 'T9_surname_ack_required'
  | 'T19_revoke_unprovable'
  | 'T20_revoke_importer_link'
  /** AFLDB-ISSUE-238 §8.6: the provider's net ledger state is `corrected`; not revocable here. */
  | 'T21_revoke_corrected';

export type AflApiDecision =
  | { allow: true }
  | { allow: false; code: AflApiRefusalCode; message: string };

function refuse(code: AflApiRefusalCode, detail?: string): AflApiDecision {
  return { allow: false, code, message: aflApiRefusalMessage(code, detail) };
}

/** One message per refusal code (T2-T9, T19, T20), independent of caller. */
export function aflApiRefusalMessage(code: AflApiRefusalCode, detail?: string): string {
  switch (code) {
    case 'T2_already_linked_same_player':
      return 'This provider is already linked to the chosen player.';
    case 'T3_already_linked_different_player':
      return 'This provider is already linked to a different player. Correcting an existing '
        + 'link is out of scope for this surface.';
    case 'T4_player_holds_another_provider':
      return detail
        ? `The chosen player already holds a different afl_api provider (${detail}).`
        : 'The chosen player already holds a different afl_api provider.';
    case 'T5_no_evidence':
      return 'No canonical player to link: register the player first, then return.';
    case 'T6_stale_fingerprint':
      return 'The evidence changed after this page was loaded; reload and review again.';
    case 'T7_player_not_stable':
      return 'The chosen player has no stable identity (an AFL Tables profile or an '
        + 'administrator-created identity); this action cannot proceed.';
    case 'T8_anomalous_row':
      return 'This provider is in an anomalous state and cannot be actioned from this surface.';
    case 'T9_surname_ack_required':
      return 'The observed surname disagrees with the chosen player; acknowledge the '
        + 'disagreement before submitting.';
    case 'T19_revoke_unprovable':
      return detail ?? 'This link cannot be revoked: it has been used, or non-use cannot be proven.';
    case 'T20_revoke_importer_link':
      return 'This provider was linked by the importer, not by a human decision, and cannot be '
        + 'revoked from this surface.';
    case 'T21_revoke_corrected':
      return 'This provider\'s link was corrected by a recorded human correction (AFLDB-ISSUE-238). '
        + 'A correction cannot be revoked from this surface; undoing a correction is a separate '
        + 'operation that does not exist yet.';
    default: {
      const exhaustive: never = code;
      throw new Error(`unhandled refusal code: ${exhaustive as string}`);
    }
  }
}

export type AflApiLinkDecisionInput = {
  state: AflApiIdentityState;
  /** The provider's own existing row, if any -- populated only for L-I/L-H/X. */
  existingRow: AflApiIdentityRow | null;
  chosenPlayerId: number;
  /** D6-2: the chosen player's OWN existing afl_api row under a different provider, if any. */
  chosenPlayerOtherAflApiProviderId: string | null;
  /** D6-3. */
  chosenPlayerHasStableIdentity: boolean;
  /** D5: at least one pending unresolved_identity candidate for this provider. */
  hasPendingEvidence: boolean;
  fingerprintMatches: boolean;
  surnameDisagrees: boolean;
  surnameAcknowledged: boolean;
};

/** D6/D7/D12's whole link-time decision, as one pure function of pre-fetched facts. */
export function decideAflApiLink(input: AflApiLinkDecisionInput): AflApiDecision {
  if (!input.fingerprintMatches) return refuse('T6_stale_fingerprint'); // T6
  if (input.state === 'X') return refuse('T8_anomalous_row'); // T8
  if (input.state === 'L-I' || input.state === 'L-H') {
    return input.existingRow?.playerId === input.chosenPlayerId
      ? refuse('T2_already_linked_same_player') // T2
      : refuse('T3_already_linked_different_player'); // T3
  }
  // state is U0 or U1.
  if (!input.hasPendingEvidence) return refuse('T5_no_evidence'); // T5 (U0, or evidence pruned)
  if (input.chosenPlayerOtherAflApiProviderId) {
    return refuse('T4_player_holds_another_provider', input.chosenPlayerOtherAflApiProviderId); // T4
  }
  if (!input.chosenPlayerHasStableIdentity) return refuse('T7_player_not_stable'); // T7
  if (input.surnameDisagrees && !input.surnameAcknowledged) return refuse('T9_surname_ack_required'); // T9
  return { allow: true }; // T1
}

export type AflApiRevokeDecisionInput = {
  state: AflApiIdentityState;
  fingerprintMatches: boolean;
  /** The D10 non-use proof's verdict (evaluated by `evaluateNonUseProof` below). */
  nonUseProven: boolean;
  nonUseRefusalReason?: string;
  /**
   * AFLDB-ISSUE-238 §8.6: the provider's NET ledger action (latest row), read under the revoke's
   * locks. The identity row alone classifies a corrected provider as `L-H` (D7), so only the
   * ledger can tell corrected from linked. Omitted/null = no ledger row, the pre-ISSUE-238 input.
   */
  ledgerNetAction?: AflApiLedgerNetAction | null;
};

/**
 * D10/D6/D7's whole revoke-time decision. AFLDB-ISSUE-238: T21 (net ledger state `corrected`) is
 * checked immediately after T6 and BEFORE every state rule and the non-use proof -- by decision,
 * a corrected provider reports T21 even when its identity row is also anomalous (T8).
 */
export function decideAflApiRevoke(input: AflApiRevokeDecisionInput): AflApiDecision {
  if (!input.fingerprintMatches) return refuse('T6_stale_fingerprint'); // T6
  if (input.ledgerNetAction === 'corrected') return refuse('T21_revoke_corrected'); // T21
  if (input.state === 'X') return refuse('T8_anomalous_row'); // T8
  if (input.state === 'L-I') return refuse('T20_revoke_importer_link'); // T20
  if (input.state !== 'L-H') return refuse('T8_anomalous_row'); // U0/U1: nothing to revoke
  if (!input.nonUseProven) return refuse('T19_revoke_unprovable', input.nonUseRefusalReason); // T19
  return { allow: true }; // T18
}

/* ------------------------------------------------------------------ *
 * 2. Fingerprint (D7) and input validation (D12, OD-4)
 * ------------------------------------------------------------------ */

export type AdjudicationFingerprintInput = {
  providerId: string;
  /** The provider's existing row, or null. */
  existing: AflApiIdentityRow | null;
  /** Sorted internally -- order of the caller's array never affects the hash. */
  pendingCandidates: readonly { id: number; sourceVersionSeq: number }[];
  latestAdjudicationId: number | null;
  chosenPlayerId: number;
  /** The chosen player's own existing afl_api rows, if any (D6-2 evidence). */
  chosenPlayerExistingRows: readonly { id: number; status: string; matchMethod: string | null }[];
};

/**
 * D7's server-computed fingerprint: a sha256 over the canonical JSON of every fact the
 * detail page rendered. Deterministic and independent of input order (A1). Any change to
 * any field -- the row, a candidate's version, the latest audit id, or either player's
 * links -- changes the digest, so a stale submit is refused (T6) rather than silently
 * trusted.
 */
export function adjudicationFingerprint(input: AdjudicationFingerprintInput): string {
  const canonical: JsonValue = {
    providerId: input.providerId,
    existing: input.existing === null ? null : {
      id: input.existing.id, status: input.existing.status,
      playerId: input.existing.playerId, matchMethod: input.existing.matchMethod,
    },
    pendingCandidates: [...input.pendingCandidates]
      .sort((a, b) => a.id - b.id || a.sourceVersionSeq - b.sourceVersionSeq)
      .map((c) => ({ id: c.id, sourceVersionSeq: c.sourceVersionSeq })),
    latestAdjudicationId: input.latestAdjudicationId,
    chosenPlayerId: input.chosenPlayerId,
    chosenPlayerExistingRows: [...input.chosenPlayerExistingRows]
      .sort((a, b) => a.id - b.id)
      .map((r) => ({ id: r.id, status: r.status, matchMethod: r.matchMethod })),
  };
  return createHash('sha256').update(canonicalJson(canonical)).digest('hex');
}

export type AdjudicationInputProblem =
  | 'invalid_provider_id'
  | 'invalid_player_id'
  | 'note_too_short'
  | 'note_too_long'
  | 'missing_surname_acknowledgement';

/**
 * D12/OD-4's mandatory-field checks, run server-side regardless of what the client sent.
 * Lengths are raw `string.length`, matching migration 104's `length(note) BETWEEN 20 AND
 * 2000` CHECK exactly -- never trimmed here, so the two never disagree.
 */
export function validateAdjudicationInput(input: {
  providerId: string;
  playerId: number;
  note: string;
  surnameDisagrees: boolean;
  surnameAcknowledged: boolean;
}): readonly AdjudicationInputProblem[] {
  const problems: AdjudicationInputProblem[] = [];
  if (!AFL_API_PROVIDER_ID_RE.test(input.providerId)) problems.push('invalid_provider_id');
  if (!Number.isInteger(input.playerId) || input.playerId <= 0) problems.push('invalid_player_id');
  if (input.note.length < ADJUDICATION_NOTE_MIN_LENGTH) problems.push('note_too_short');
  if (input.note.length > ADJUDICATION_NOTE_MAX_LENGTH) problems.push('note_too_long');
  if (input.surnameDisagrees && !input.surnameAcknowledged) problems.push('missing_surname_acknowledgement');
  return problems;
}

/* ------------------------------------------------------------------ *
 * Evidence classification and snapshot (§6, D11)
 * ------------------------------------------------------------------ */

/** `null` when the bridge's own rule produced no classification for this provider at all. */
export function extractProviderClassification(
  evidenceResult: AflApiPlayerEvidenceResult, providerId: string,
): AflApiProviderClassification | null {
  return evidenceResult.providers.find((p) => p.providerId === providerId) ?? null;
}

export type AdjudicationEvidenceSnapshot = {
  providerId: string;
  /** Reduced form of block 3 (§6): ids, verdicts and counts, never raw payloads. */
  classification: {
    disposition: string;
    reason: string | null;
    candidatePlayerId: number | null;
    matchedEvidenceCount: number;
    hits: readonly { providerMatchId: string; canonicalPlayerId: number; agreeingStatCount: number }[];
    competingCandidates: readonly {
      canonicalPlayerId: number;
      providerMatchIds: readonly string[];
    }[];
  } | null;
  pendingCandidateIds: readonly number[];
  latestAdjudicationId: number | null;
  chosenPlayerId: number;
  fingerprint: string;
};

/**
 * The evidence-snapshot reducer persisted in the audit row's `evidence` column (D8): the
 * §6 blocks 1-5 reduced to ids, versions, verdicts and counts, plus the fingerprint they
 * were computed against. No raw spine payload ever reaches this column.
 */
export function reduceAdjudicationEvidence(input: {
  providerId: string;
  classification: AflApiProviderClassification | null;
  pendingCandidateIds: readonly number[];
  latestAdjudicationId: number | null;
  chosenPlayerId: number;
  fingerprint: string;
}): AdjudicationEvidenceSnapshot {
  return {
    providerId: input.providerId,
    classification: input.classification === null ? null : {
      disposition: input.classification.disposition,
      reason: input.classification.reason,
      candidatePlayerId: input.classification.candidatePlayerId,
      matchedEvidenceCount: input.classification.matchedEvidenceCount,
      hits: input.classification.matches.map((m) => ({
        providerMatchId: m.providerMatchId,
        canonicalPlayerId: m.canonicalPlayerId,
        agreeingStatCount: m.agreeingStatCount,
      })),
      competingCandidates: input.classification.competingCandidates.map((c) => ({
        canonicalPlayerId: c.canonicalPlayerId,
        providerMatchIds: c.providerMatchIds,
      })),
    },
    pendingCandidateIds: [...input.pendingCandidateIds].sort((a, b) => a - b),
    latestAdjudicationId: input.latestAdjudicationId,
    chosenPlayerId: input.chosenPlayerId,
    fingerprint: input.fingerprint,
  };
}

/* ------------------------------------------------------------------ *
 * 3. The D10 player-reference manifest (plan-review R1, R2, R5)
 * ------------------------------------------------------------------ */

export type AflApiReferenceClass = 'LINK_DEPENDENT' | 'LINK_INDEPENDENT' | 'NOT_SOURCE_BEARING';

export type AflApiReferenceManifestEntry = {
  schema: string;
  table: string;
  /** Every column on this table with a FK to players(id) — a table may declare more than one. */
  playerColumns: readonly string[];
  class: AflApiReferenceClass;
  /**
   * Column(s) that could carry `afl_api` provenance, e.g. `source_id`. Empty for a table
   * that structurally cannot (no such column at all).
   */
  provenanceColumns: readonly string[];
  /** One-line evidence: the writer function/file:line that decides the classification. */
  reason: string;
};

/**
 * AFLDB-ISSUE-235 D10/R1/R2. Every table with a player FK, in every non-system schema,
 * classified. Pinned against the live migration set by A11b and against the live
 * `afldb_test` catalogue by I17 -- an unclassified, missing-column or reclassified table
 * refuses a revoke rather than silently passing (`validateManifestAgainstCatalogue` below).
 *
 * Derived from `REFERENCES players(id)` across every `src/db/migrations/*.sql` file
 * (public, staging; `staging_aflw` has none), confirmed 2026-09-23. Two traps a plain
 * single-line grep for `source_id` misses, both caught here:
 *   - `add_provenance_columns()` (001:110) ADDs `source_id`/`source_record_id`/
 *     `import_batch_id`/`imported_at` by a later `SELECT add_provenance_columns('<table>')`
 *     call, never inline in the `CREATE TABLE`. It reaches `player_achievements` (053:107)
 *     and `after_siren_kicks` (089:136) -- both LINK_INDEPENDENT below, not
 *     NOT_SOURCE_BEARING, because of it.
 *   - `staging_aflw.player_match_stats.player_id` is a plain integer with NO
 *     `REFERENCES players(id)` at all (025) -- a resolution target, never constrained --
 *     so it is correctly outside this manifest's own definition (a player FK), and is
 *     named here only so its absence is not mistaken for an oversight.
 *
 * `LINK_INDEPENDENT` is used, never `NOT_SOURCE_BEARING`, for EVERY table that has a real
 * provenance column (`source_id`/`source_key`), even where no CURRENT writer ever sets it
 * to `afl_api` -- some empirically (no afl_api feed exists for that domain), some
 * structurally (a hardcoded `sources.key` literal in the writer, e.g. `club_leadership`,
 * `brownlow_season_votes`). `NOT_SOURCE_BEARING` is reserved for tables with NO provenance
 * column at all (derived/recomputed tables, audit ledgers, regenerated caches, admin
 * workflow state) -- see `validateManifestAgainstCatalogue`'s third fail-closed rule, which
 * refuses a `NOT_SOURCE_BEARING` entry the live catalogue shows has since gained one.
 */
export const AFL_API_PLAYER_REFERENCE_MANIFEST: readonly AflApiReferenceManifestEntry[] = [
  // --- LINK_DEPENDENT: player attribution established THROUGH the afl_api link ---------
  {
    schema: 'public', table: 'player_match_stats', playerColumns: ['player_id'],
    class: 'LINK_DEPENDENT', provenanceColumns: ['source_id'],
    reason: 'The afl_api match settle writes this table by resolving player_id through '
      + 'resolveAflApiPlayer() (afl-api-settle-plan.ts:417) inside the settle write '
      + 'transaction (settle-afl-api.ts:1137,1722).',
  },
  {
    schema: 'public', table: 'brownlow_round_votes', playerColumns: ['player_id'],
    class: 'LINK_DEPENDENT', provenanceColumns: ['source_id'],
    reason: 'The afl_api Brownlow settle writes this table by resolving player_id through '
      + 'resolveAflApiPlayer() (afl-api-brownlow.ts:707) inside its own write transaction '
      + '(afl-api-brownlow.ts:1438,1499). A F002-demoted votes=0 row still counts: the row '
      + "still carries the resolved player_id and source_id = 'afl_api'.",
  },
  {
    schema: 'staging', table: 'afl_api_player_match', playerColumns: ['player_id'],
    class: 'LINK_DEPENDENT', provenanceColumns: ['source_id'],
    reason: 'The typed projection (103:311-325) the match settle upserts before resolving '
      + 'player_id onward into player_match_stats; provider_player_id + a resolved '
      + 'player_id both live here.',
  },
  {
    schema: 'staging', table: 'afl_api_brownlow_vote', playerColumns: ['player_id'],
    class: 'LINK_DEPENDENT', provenanceColumns: ['source_id'],
    reason: 'The typed projection (103:456-480) the Brownlow settle upserts before '
      + 'resolving player_id onward into brownlow_round_votes.',
  },

  // --- LINK_INDEPENDENT: may carry afl_api provenance, but attributed independently ----
  {
    schema: 'public', table: 'player_height_evidence', playerColumns: ['player_id'],
    class: 'LINK_INDEPENDENT', provenanceColumns: ['source_id'],
    reason: 'enrich_heights_afl_api.py resolves player_id by name + club + season matching '
      + '(enrich_heights_afl_api.py:23-27,187-216), never by reading external_identities.',
  },
  {
    schema: 'public', table: 'external_identities', playerColumns: ['player_id'],
    class: 'LINK_INDEPENDENT', provenanceColumns: ['source_id'],
    reason: 'The identity ledger itself: the row being adjudicated/revoked IS a row of this '
      + 'table, never a fact attached THROUGH a pre-existing link -- counting it here would '
      + 'be circular. A different row here (this or another source, same player) is '
      + 'independent identity information. Revoke\'s own D6/D7 logic reads this table '
      + 'directly, outside the D10 use-proof loop.',
  },
  {
    schema: 'public', table: 'afl_api_identity_adjudications', playerColumns: ['player_id'],
    class: 'LINK_INDEPENDENT', provenanceColumns: ['source_key'],
    reason: "This issue's own ledger: source_key is always 'afl_api' by CHECK (migration "
      + '104), but a row here RECORDS a human decision that CREATES a link, never a fact '
      + 'attached through one that already existed -- excluded from the use predicate for '
      + 'the same circularity reason as external_identities.',
  },
  {
    schema: 'public', table: 'player_name_aliases', playerColumns: ['player_id'],
    class: 'LINK_INDEPENDENT', provenanceColumns: ['source_id'],
    reason: 'Writers are import_fitzroy_core.py (afltables) and the legacy AFL loader; no '
      + 'afl_api writer exists, and no current tool sets source_id to afl_api here.',
  },
  {
    schema: 'public', table: 'brownlow_season_votes', playerColumns: ['player_id'],
    class: 'LINK_INDEPENDENT', provenanceColumns: ['source_id'],
    reason: "import_brownlow_season.py hardcodes SOURCE_KEY = 'afltables' for every row it "
      + 'writes; build_brownlow_season_artefact_from_afl_api.py only emits an artefact and '
      + 'resolves players via the afltables_profile_url identity, never DB afl_api links, '
      + 'and never writes this table directly (I3, plan review).',
  },
  {
    schema: 'public', table: 'award_winners', playerColumns: ['player_id'],
    class: 'LINK_INDEPENDENT', provenanceColumns: ['source_id'],
    reason: "import_awards.py's source keys are 'draftguru' and 'wikipedia_22under22' only; "
      + 'no afl_api awards feed exists.',
  },
  {
    schema: 'public', table: 'award_nominations', playerColumns: ['player_id'],
    class: 'LINK_INDEPENDENT', provenanceColumns: ['source_id'],
    reason: 'Same writer/source family as award_winners (import_awards.py); no afl_api source.',
  },
  {
    schema: 'public', table: 'hall_of_fame', playerColumns: ['player_id'],
    class: 'LINK_INDEPENDENT', provenanceColumns: ['source_id'],
    reason: 'Same writer family as award_winners; no afl_api source.',
  },
  {
    schema: 'public', table: 'honour_team_members', playerColumns: ['player_id'],
    class: 'LINK_INDEPENDENT', provenanceColumns: ['source_id'],
    reason: 'Same writer family as award_winners; no afl_api source.',
  },
  {
    schema: 'public', table: 'captaincies', playerColumns: ['player_id'],
    class: 'LINK_INDEPENDENT', provenanceColumns: ['source_id'],
    reason: "captaincies.py's SOURCE_CITATIONS = {'wikipedia'}; no afl_api source.",
  },
  {
    schema: 'public', table: 'draft_picks', playerColumns: ['player_id'],
    class: 'LINK_INDEPENDENT', provenanceColumns: ['source_id'],
    reason: 'tools/rebuild/draftguru/import_draftguru.py is the only writer; no afl_api source.',
  },
  {
    schema: 'public', table: 'player_relationships',
    playerColumns: ['person_a_player_id', 'person_b_player_id'],
    class: 'LINK_INDEPENDENT', provenanceColumns: ['source_id'],
    reason: "family_siblings.py's SOURCE_KEY = 'wikipedia'; no afl_api source.",
  },
  {
    schema: 'public', table: 'father_son_selections',
    playerColumns: ['drafted_player_id', 'father_player_id'],
    class: 'LINK_INDEPENDENT', provenanceColumns: ['source_id'],
    reason: "father_son.py's SOURCE_KEY = 'wikipedia'; no afl_api source.",
  },
  {
    schema: 'public', table: 'player_birth_evidence', playerColumns: ['player_id'],
    class: 'LINK_INDEPENDENT', provenanceColumns: ['source_id'],
    reason: 'Writers (enrich_birth_dates*.py, import_fitzroy_core.py) are afltables/club-list '
      + 'enrichment; none reads external_identities or sets source_id to afl_api.',
  },
  {
    schema: 'public', table: 'draft_persons', playerColumns: ['player_id'],
    class: 'LINK_INDEPENDENT', provenanceColumns: ['source_id'],
    reason: 'tools/rebuild/draftguru/import_draftguru.py is the only writer; no afl_api source.',
  },
  {
    schema: 'public', table: 'player_achievements', playerColumns: ['player_id'],
    class: 'LINK_INDEPENDENT', provenanceColumns: ['source_id'],
    reason: 'source_id was added by add_provenance_columns (053:107), not inline in the '
      + 'CREATE TABLE. The first-kick-goal import path (AFLDB-ISSUE-078/167) is afltables/ '
      + 'manual; no afl_api writer exists.',
  },
  {
    schema: 'public', table: 'coaches', playerColumns: ['player_id'],
    class: 'LINK_INDEPENDENT', provenanceColumns: ['source_id'],
    reason: "import_match_coaches.py's SOURCE_KEY = 'afltables'; no afl_api source.",
  },
  {
    schema: 'public', table: 'after_siren_kicks', playerColumns: ['player_id'],
    class: 'LINK_INDEPENDENT', provenanceColumns: ['source_id'],
    reason: 'source_id was added by add_provenance_columns (089:136), not inline in the '
      + "CREATE TABLE. The source is Wikipedia's kicks-after-the-siren list; no afl_api "
      + 'source.',
  },
  {
    schema: 'public', table: 'season_list_members', playerColumns: ['player_id'],
    class: 'LINK_INDEPENDENT', provenanceColumns: ['source_id'],
    reason: "origin is one of 'added'/'copied_list'/'transferred' today ('imported' is "
      + 'reserved for a future list source, 096); no afl_api writer exists.',
  },
  {
    schema: 'public', table: 'club_leadership', playerColumns: ['player_id'],
    class: 'LINK_INDEPENDENT', provenanceColumns: ['source_id'],
    reason: "replay_admin_overrides() (common.py:2539) hardcodes source_id to the "
      + "'manual_admin_edit' sources row on every INSERT; structurally never afl_api.",
  },
  {
    schema: 'public', table: 'player_match_period_stats', playerColumns: ['player_id'],
    class: 'LINK_INDEPENDENT', provenanceColumns: ['source_id'],
    reason: 'No tracked writer inserts into this table today (read-only from match-admin.ts '
      + 'and NL queries); source_id is nullable and currently always NULL. Revisit if a '
      + 'writer is ever added.',
  },
  {
    schema: 'staging', table: 'afl_api_lineup', playerColumns: ['player_id'],
    class: 'LINK_INDEPENDENT', provenanceColumns: ['source_id'],
    reason: 'No writer sets player_id: lineup-store.ts\'s insert type explicitly excludes '
      + 'match_id/club_id/player_id (077 header: "an announced player is NOT a player who '
      + 'played"), and no UPDATE resolves it anywhere in the tree. Revisit if a resolver is '
      + 'ever added.',
  },
  {
    schema: 'staging', table: 'afltables_player_match', playerColumns: ['player_id'],
    class: 'LINK_INDEPENDENT', provenanceColumns: ['source_id'],
    reason: 'Source-dedicated staging table (076): only the afltables settle writes it, so '
      + 'source_id is always the afltables sources.id in practice, but this is by writer '
      + 'convention, not a CHECK constraint -- classified defensively rather than as '
      + 'NOT_SOURCE_BEARING.',
  },

  // --- NOT_SOURCE_BEARING: no provenance column exists at all --------------------------
  {
    schema: 'public', table: 'player_season_stats', playerColumns: ['player_id'],
    class: 'NOT_SOURCE_BEARING', provenanceColumns: [],
    reason: 'No source_id column (007, recreated 015); recomputed wholesale from '
      + 'player_match_stats by recomputeSeasonMetadata() (player-derived.ts).',
  },
  {
    schema: 'public', table: 'player_club_season_stats', playerColumns: ['player_id'],
    class: 'NOT_SOURCE_BEARING', provenanceColumns: [],
    reason: "No source_id column (007's player_season_stats, renamed in 015; 065 adds only "
      + 'frees columns); DERIVED club-grain record, recomputed from player_match_stats + '
      + 'matches by recomputePlayerDerivedStats() (player-derived.ts) and rebuilt wholesale '
      + "by rebuild_derived.py's REBUILDS['player_club_season_stats'].",
  },
  {
    schema: 'public', table: 'player_career_stats', playerColumns: ['player_id'],
    class: 'NOT_SOURCE_BEARING', provenanceColumns: [],
    reason: 'No source_id column; player_id is the PRIMARY KEY itself (007); recomputed the '
      + 'same way as player_season_stats.',
  },
  {
    schema: 'public', table: 'player_clubs', playerColumns: ['player_id'],
    class: 'NOT_SOURCE_BEARING', provenanceColumns: [],
    reason: 'No source_id column (007); recomputed wholesale by recomputeClubSeasons() '
      + '(player-derived.ts).',
  },
  {
    schema: 'public', table: 'player_link_resolutions', playerColumns: ['player_id'],
    class: 'NOT_SOURCE_BEARING', provenanceColumns: [],
    reason: 'No source_id column (056); the honours-link admin audit ledger, a different '
      + 'domain from afl_api identity.',
  },
  {
    schema: 'public', table: 'player_link_match_candidates', playerColumns: ['player_id'],
    class: 'NOT_SOURCE_BEARING', provenanceColumns: [],
    reason: 'No source_id column (067); regenerated wholesale by the admin refresh action '
      + "from rebuilt players plus reinstated resolutions (promotion-inventory.ts's own "
      + "'regenerate' treatment for this table).",
  },
  {
    schema: 'public', table: 'brownlow_vote_entry_state',
    playerColumns: ['three_player_id', 'two_player_id', 'one_player_id'],
    class: 'NOT_SOURCE_BEARING', provenanceColumns: [],
    reason: 'No source_id column (094); admin draft/final/void workflow state, keyed on '
      + 'auth_users via created_by/updated_by, not on any source.',
  },
];

export type CatalogueColumn = { schema: string; table: string; column: string };

export type ManifestValidationProblem =
  | { kind: 'unclassified_table'; schema: string; table: string; columns: readonly string[] }
  | { kind: 'missing_column'; schema: string; table: string; column: string }
  | { kind: 'not_source_bearing_gained_source_id'; schema: string; table: string };

/**
 * R1/R2's fail-closed catalogue check: every real player-FK column must appear in the
 * manifest under its actual table/column, every manifest entry's declared columns must
 * still exist, and a `NOT_SOURCE_BEARING` entry must not have since gained a provenance
 * column. Any problem here means the revoke refuses as unprovable (D10).
 */
export function validateManifestAgainstCatalogue(
  catalogueRows: readonly CatalogueColumn[],
  manifest: readonly AflApiReferenceManifestEntry[] = AFL_API_PLAYER_REFERENCE_MANIFEST,
): readonly ManifestValidationProblem[] {
  const problems: ManifestValidationProblem[] = [];
  const byTable = new Map<string, CatalogueColumn[]>();
  for (const row of catalogueRows) {
    const key = `${row.schema}.${row.table}`;
    if (!byTable.has(key)) byTable.set(key, []);
    byTable.get(key)!.push(row);
  }
  const manifestByTable = new Map<string, AflApiReferenceManifestEntry>(
    manifest.map((e) => [`${e.schema}.${e.table}`, e]),
  );

  for (const [key, columns] of byTable) {
    const entry = manifestByTable.get(key);
    if (!entry) {
      const [schema, table] = key.split('.');
      problems.push({ kind: 'unclassified_table', schema, table, columns: columns.map((c) => c.column) });
      continue;
    }
    const actualColumns = new Set(columns.map((c) => c.column));
    for (const column of entry.playerColumns) {
      if (!actualColumns.has(column)) problems.push({ kind: 'missing_column', schema: entry.schema, table: entry.table, column });
    }
  }

  for (const entry of manifest) {
    if (entry.class !== 'NOT_SOURCE_BEARING') continue;
    const columns = byTable.get(`${entry.schema}.${entry.table}`) ?? [];
    const hasSourceIdLike = columns.some((c) => /source_id|source_key|provenance/i.test(c.column));
    if (hasSourceIdLike && entry.provenanceColumns.length === 0) {
      problems.push({ kind: 'not_source_bearing_gained_source_id', schema: entry.schema, table: entry.table });
    }
  }

  return problems;
}

/**
 * D10 point 2's two "ledger checks", kept separate from the FK-column manifest above
 * because neither table carries a direct `player_id`/`REFERENCES players` column: both are
 * jsonb-keyed, so their use predicate is a different shape (`target_key->>'player_id'` /
 * `proposed_fields->>'player_id'`, plus an `external_record_id LIKE '%|' || CD_I` fallback
 * for a non-`matches` target). These are LINK_DEPENDENT by construction -- only the AFL API
 * settle's link-resolved writes produce `afl_api` rows in them -- and are ALWAYS run,
 * alongside every manifest entry's own predicate, as part of the D10 non-use proof.
 */
export type AflApiLedgerCheck = {
  schema: string;
  table: string;
  /** Human-readable predicate description; the query module (§7.2) renders the real SQL. */
  predicate: string;
};

export const AFL_API_LEDGER_CHECKS: readonly AflApiLedgerCheck[] = [
  {
    schema: 'public', table: 'canonical_applications',
    predicate: "source_id = <afl_api> AND (target_key->>'player_id' = <P> OR "
      + "external_record_id LIKE '%|' || <CD_I>) -- append-only: proves use even after a "
      + 'canonical row is rewritten by another owner or its projection is gone; catches the '
      + "Brownlow case, whose external_record_id is a match id, not '...|CD_I'.",
  },
  {
    schema: 'public', table: 'promotion_candidates',
    predicate: "source_id = <afl_api> AND (proposed_fields->>'player_id' = <P> OR "
      + "(verb <> 'unresolved_identity' AND external_record_id LIKE '%|' || <CD_I>)) -- "
      + 'target_id is NEVER read here (R5): it is the target row\'s id (074:163-164), not a '
      + 'player id. A pending unresolved_identity candidate is the queue\'s own evidence and '
      + 'is not use.',
  },
];

export type LinkDependentUseHit = { schema: string; table: string; count: number };

export type NonUseProofInput = {
  manifestProblems: readonly ManifestValidationProblem[];
  /** One count per LINK_DEPENDENT table's use predicate (D10 point 2), plus the two ledger checks (b)/(d). */
  useCounts: readonly LinkDependentUseHit[];
  /** T (`55P03`) lock timeout on the ACCESS EXCLUSIVE table lock (D10 point 1). */
  lockTimedOut: boolean;
};

export type NonUseProofResult =
  | { proven: true }
  | { proven: false; reason: string };

/**
 * D10's fail-closed evaluator: any manifest problem, any lock timeout, or any non-zero use
 * count refuses. Proof requires EVERY check to come back clean, never a partial pass.
 */
export function evaluateNonUseProof(input: NonUseProofInput): NonUseProofResult {
  if (input.lockTimedOut) {
    return { proven: false, reason: 'an AFL API ingestion run or another identity transaction is in progress; retry' };
  }
  if (input.manifestProblems.length > 0) {
    return { proven: false, reason: 'non-use cannot be proven: the player-reference manifest does not match the live catalogue' };
  }
  const used = input.useCounts.filter((h) => h.count > 0);
  if (used.length > 0) {
    return {
      proven: false,
      reason: `used: ${used.map((h) => `${h.schema}.${h.table} (${h.count})`).join(', ')}`,
    };
  }
  return { proven: true };
}

/* ------------------------------------------------------------------ *
 * 4. D15 replay planner and bijection checker (OD-3, plan-review R3, R8)
 * ------------------------------------------------------------------ */

/**
 * AFLDB-ISSUE-238 (M1, migration 106): the ledger's complete action vocabulary. Every reader
 * handles exactly these three; any other value throws or refuses (runbook §8.6).
 */
export const AFL_API_LEDGER_ACTIONS = ['linked', 'revoked', 'corrected'] as const;
export type AflApiLedgerNetAction = typeof AFL_API_LEDGER_ACTIONS[number];

/**
 * One `afl_api_identity_adjudications` row as every ledger reader sees it. AFLDB-ISSUE-238 widens
 * the ISSUE-235 two-member action union with `corrected` (D2): human authority, live at P′
 * (`playerId`/`playerIdentity`), recording P in `previousPlayerIdentity` (never remapped: it has
 * no FK, §10 M1) and binding its `evidenceSha256` into the ledger digest (§8.6).
 *
 * The two new fields are optional in the TYPE so every ISSUE-235/237 reader and fixture of a
 * `linked`/`revoked` row stays valid unchanged; their per-action shape (required and well-formed
 * on `corrected`, absent/NULL otherwise) is enforced at RUNTIME by `aflApiLedgerStructureProblems`,
 * which every net-view reader and both digests run first -- a reader that forgot to select them
 * fails closed on the first `corrected` row it meets.
 */
export type AflApiAdjudicationLedgerRow = {
  id: number;
  externalId: string;
  action: AflApiLedgerNetAction;
  /** For a `corrected` row: P′, the corrected live player (M1, D2). */
  playerId: number;
  /** For a `corrected` row: P′'s stable identity. */
  playerIdentity: string;
  /** `revoked`: the `linked` row it undoes. `corrected`: the `linked` row it supersedes
   * (human-origin) or NULL (importer-origin), D2. `linked`: always NULL. */
  supersedesId: number | null;
  /** `corrected` only: P's stable identity (M1 `previous_player_identity`). NULL/absent otherwise. */
  previousPlayerIdentity?: string | null;
  /** The row's `evidence_sha256`; required (64 hex) on a `corrected` row, digested only there. */
  evidenceSha256?: string;
};

/** Raised when a ledger read violates the ISSUE-238 structural contract (`aflApiLedgerStructureProblems`). */
export class AflApiLedgerMalformed extends Error {}

const LEDGER_SHA256_RE = /^[0-9a-f]{64}$/;

/**
 * The ONE canonical in-memory form of a ledger id (`id` / `supersedes_id`, both `bigint`): a positive safe
 * integer `number`, the form the supersede artefact stores and `readAflApiLedgerRows` produces. A decimal
 * string (what postgres.js returns for an uncast `bigint`) is accepted and converted; anything else,
 * including a value beyond `Number.MAX_SAFE_INTEGER`, throws rather than rounding.
 */
export function canonicalAflApiLedgerId(value: unknown, label: string, field: string): number {
  const n = typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n <= 0) {
    throw new Error(`${label}: ${field} ${String(value)} is not a positive integer id.`);
  }
  return n;
}

/** bigint ids arrive as strings from postgres.js unless cast; compare them as numbers. */
function ledgerIdNumber(value: unknown): number {
  return typeof value === 'string' ? Number(value) : (value as number);
}

/**
 * AFLDB-ISSUE-238 §8.6 / DD-2: the ledger's structural contract, checked centrally so no reader
 * interprets a malformed ledger. Only `corrected`-related structure is new; `linked`/`revoked`
 * supersede structure is deliberately NOT re-validated here (zero-`corrected` parity):
 *
 * 1. `action` is one of `linked`/`revoked`/`corrected`;
 * 2. a `linked`/`revoked` row carries no `previousPlayerIdentity`;
 * 3. a `corrected` row carries a non-blank `previousPlayerIdentity` distinct from its
 *    `playerIdentity` (M1's string guard);
 * 4. a `corrected` row carries a 64-hex `evidenceSha256`;
 * 5. a human-origin `corrected` row (`supersedesId` set) supersedes the immediately preceding
 *    row for its provider, which must be `linked` (D2);
 * 6. an importer-origin `corrected` row (`supersedesId` NULL) follows no net-`linked` state
 *    (D2: net state NONE -- no row, or net `revoked`);
 * 7. at most one `corrected` row per provider (D8: v1 refuses correction chains);
 * 8. nothing follows a `corrected` row for its provider (v1: the link path refuses an `L-H`
 *    provider (T2/T3) and the revoke path refuses a corrected one (T21)).
 */
export function aflApiLedgerStructureProblems(rows: readonly AflApiAdjudicationLedgerRow[]): string[] {
  const problems: string[] = [];
  const byExternalId = new Map<string, AflApiAdjudicationLedgerRow[]>();
  for (const row of [...rows].sort((a, b) => ledgerIdNumber(a.id) - ledgerIdNumber(b.id))) {
    const at = `ledger row ${String(row.id)} (${String(row.externalId)})`;
    const action = (row as { action: unknown }).action;
    if (!(AFL_API_LEDGER_ACTIONS as readonly unknown[]).includes(action)) {
      problems.push(`${at}: action ${JSON.stringify(action)} is not linked/revoked/corrected`);
      continue;
    }
    const previous = (row as { previousPlayerIdentity?: unknown }).previousPlayerIdentity;
    if (row.action === 'corrected') {
      if (typeof previous !== 'string' || previous.trim() === '') {
        problems.push(`${at}: a corrected row has no previous_player_identity`);
      } else if (previous === row.playerIdentity) {
        problems.push(`${at}: a corrected row's previous_player_identity equals its player_identity`);
      }
      const evidenceSha256 = (row as { evidenceSha256?: unknown }).evidenceSha256;
      if (typeof evidenceSha256 !== 'string' || !LEDGER_SHA256_RE.test(evidenceSha256)) {
        problems.push(`${at}: a corrected row has no 64-hex evidence_sha256`);
      }
    } else if (previous !== undefined && previous !== null) {
      problems.push(`${at}: a ${row.action} row carries a previous_player_identity`);
    }
    if (!byExternalId.has(row.externalId)) byExternalId.set(row.externalId, []);
    byExternalId.get(row.externalId)!.push(row);
  }
  for (const [externalId, history] of byExternalId) {
    let correctedSeen = false;
    for (let i = 0; i < history.length; i += 1) {
      const row = history[i];
      const at = `ledger row ${String(row.id)} (${externalId})`;
      if (correctedSeen) {
        problems.push(`${at}: follows a corrected row for the same provider (a corrected state is terminal in v1)`);
      }
      if (row.action !== 'corrected') continue;
      if (correctedSeen) problems.push(`${at}: a second corrected row for the same provider (a correction chain, D8)`);
      correctedSeen = true;
      const preceding = i > 0 ? history[i - 1] : null;
      if (row.supersedesId !== null && row.supersedesId !== undefined) {
        if (!preceding || ledgerIdNumber(preceding.id) !== ledgerIdNumber(row.supersedesId)) {
          problems.push(`${at}: a human-origin corrected row does not supersede the immediately preceding row for its provider`);
        } else if (preceding.action !== 'linked') {
          problems.push(`${at}: a human-origin corrected row supersedes a ${preceding.action} row, not a linked one`);
        }
      } else if (preceding?.action === 'linked') {
        problems.push(`${at}: an importer-origin corrected row (no supersedes_id) follows a net-linked state`);
      }
    }
  }
  return problems;
}

/** Throws `AflApiLedgerMalformed` naming every structural problem; a no-op on a valid ledger. */
export function assertAflApiLedgerStructure(rows: readonly AflApiAdjudicationLedgerRow[]): void {
  const problems = aflApiLedgerStructureProblems(rows);
  if (problems.length > 0) {
    throw new AflApiLedgerMalformed(`the afl_api identity ledger is malformed: ${problems.join('; ')}`);
  }
}

/**
 * Why a stable identity named by a tracked `profile_url_continuity` rule does not resolve on a
 * target (AFLDB-ISSUE-237 continuity amendment, reverse direction): the rule asserts its two
 * paths are one footballer, so the target must prove it — both paths, exactly one player each,
 * the same player.
 */
export type AflApiContinuityRefusal =
  | 'continuing_missing' | 'continuing_ambiguous'
  | 'renumbered_missing' | 'renumbered_ambiguous'
  | 'split';

export type AflApiPlayerRemapResult =
  | { ok: true; newPlayerId: number; remappedIdentity: string }
  | { ok: false; reason: 'unresolvable' | 'ambiguous' }
  | {
    ok: false; reason: 'continuity_contradiction'; ruleId: string; refusal: AflApiContinuityRefusal;
    continuingPlayerIds: readonly number[]; renumberedPlayerIds: readonly number[];
  };

export type AflApiContinuityContradiction = Extract<AflApiPlayerRemapResult, { reason: 'continuity_contradiction' }>;

/** The tracked rules naming `identity` on EITHER side. Exact string equality, contract order. */
export function aflApiContinuityRulesNaming(
  identity: string, continuityRules: ValidatedFitzroyProfileContinuityRules,
): readonly FitzroyProfileContinuityRule[] {
  return continuityRules.filter((r) => r.continuingUrl === identity || r.renumberedUrl === identity);
}

/**
 * Every path a reverse lookup of `identity` must read on the target: the identity itself, plus
 * both paths of every tracked rule naming it. A caller reads exactly these (no more) and hands
 * the result to `classifyAflApiReverseIdentity`.
 */
export function aflApiReverseIdentityPaths(
  identity: string, continuityRules: ValidatedFitzroyProfileContinuityRules,
): readonly string[] {
  const paths = new Set([identity]);
  for (const rule of aflApiContinuityRulesNaming(identity, continuityRules)) {
    paths.add(rule.continuingUrl);
    paths.add(rule.renumberedUrl);
  }
  return [...paths];
}

/**
 * The reverse (identity -> target player) lookup, the single classification behind every
 * remap: the replay adapter's `resolveAflApiPlayerIdentity` (Stage 18, D15, R4) and the
 * promotion checker's G2 reader, so they cannot disagree.
 *
 * - An identity NO tracked rule names: exactly one player -> it; none -> `unresolvable`;
 *   several -> `ambiguous`. Unchanged.
 * - An identity a tracked rule names (either side — membership is looked up in the validated
 *   contract, never inferred from the path's shape): for EVERY such rule, `continuing_url` and
 *   `renumbered_url` must each resolve to exactly one player, and it must be the SAME player,
 *   and every rule must agree on it. Only then does the identity resolve, to that player. Any
 *   other target state is `continuity_contradiction` — never a fallback to the identity's own
 *   path alone, because a target holding the two paths on two players contradicts the rule.
 *
 * `playerIdsByPath` holds the players each accepted identity path names on the target (at
 * least every path `aflApiReverseIdentityPaths` returns); duplicates collapse.
 */
export function classifyAflApiReverseIdentity(input: {
  identity: string;
  playerIdsByPath: ReadonlyMap<string, readonly number[]>;
  continuityRules: ValidatedFitzroyProfileContinuityRules;
}): AflApiPlayerRemapResult {
  const playersOf = (path: string) => [...new Set(input.playerIdsByPath.get(path) ?? [])].sort((a, b) => a - b);
  const rules = aflApiContinuityRulesNaming(input.identity, input.continuityRules);
  if (rules.length === 0) {
    const players = playersOf(input.identity);
    if (players.length === 0) return { ok: false, reason: 'unresolvable' };
    if (players.length > 1) return { ok: false, reason: 'ambiguous' };
    return { ok: true, newPlayerId: players[0], remappedIdentity: input.identity };
  }

  let resolved: number | null = null;
  for (const rule of rules) {
    const continuingPlayerIds = playersOf(rule.continuingUrl);
    const renumberedPlayerIds = playersOf(rule.renumberedUrl);
    const refuse = (refusal: AflApiContinuityRefusal): AflApiPlayerRemapResult => ({
      ok: false, reason: 'continuity_contradiction', ruleId: rule.id, refusal, continuingPlayerIds, renumberedPlayerIds,
    });
    if (continuingPlayerIds.length === 0) return refuse('continuing_missing');
    if (continuingPlayerIds.length > 1) return refuse('continuing_ambiguous');
    if (renumberedPlayerIds.length === 0) return refuse('renumbered_missing');
    if (renumberedPlayerIds.length > 1) return refuse('renumbered_ambiguous');
    if (continuingPlayerIds[0] !== renumberedPlayerIds[0]) return refuse('split');
    // Two rules sharing one path must land on one player too.
    if (resolved !== null && resolved !== continuingPlayerIds[0]) return refuse('split');
    resolved = continuingPlayerIds[0];
  }
  return { ok: true, newPlayerId: resolved as number, remappedIdentity: input.identity };
}

const CONTINUITY_REFUSAL_TEXT: Record<AflApiContinuityRefusal, string> = {
  continuing_missing: 'its continuing_url resolves to no target player',
  continuing_ambiguous: 'its continuing_url resolves to more than one target player',
  renumbered_missing: 'its renumbered_url resolves to no target player',
  renumbered_ambiguous: 'its renumbered_url resolves to more than one target player',
  split: 'its continuing_url and renumbered_url resolve to different target players',
};

/** The one human-readable wording of a continuity contradiction, shared by every refusal site. */
export function aflApiContinuityContradictionText(result: AflApiContinuityContradiction): string {
  return `is named by tracked profile_url_continuity rule ${result.ruleId} and the target contradicts it: `
    + `${CONTINUITY_REFUSAL_TEXT[result.refusal]} (continuing -> [${result.continuingPlayerIds.join(', ')}], `
    + `renumbered -> [${result.renumberedPlayerIds.join(', ')}])`;
}

export type AflApiCandidateIdentityRow = {
  externalId: string;
  status: string;
  matchMethod: string | null;
  playerId: number | null;
  /**
   * AFLDB-ISSUE-237 D9 (OD-2): needed to test the "full D5 importer row" precondition for a
   * supersede. Optional so every ISSUE-235-era caller/fixture that never populates these two
   * fields keeps compiling unchanged; `undefined` is treated as "not a full D5 row" (never a
   * supersede candidate), which is always at least as strict as omitting the fields entirely.
   */
  candidateCount?: number;
  externalUrl?: string | null;
};

export type AflApiReplayNoop = { externalId: string; satisfied?: 'already_satisfied' };

/** How many of a plan's no-ops are corrected ALREADY_SATISFIED entries (R238-S4-02). */
export function aflApiAlreadySatisfiedCount(noops: readonly AflApiReplayNoop[]): number {
  return noops.filter((n) => n.satisfied === 'already_satisfied').length;
}

export type AflApiReplayPlan = {
  inserts: readonly { externalId: string; playerId: number }[];
  /**
   * Nothing to write: the identical human row already exists. AFLDB-ISSUE-238 (§8.6, §9.1 D15,
   * R238-S4-02): a net-`corrected` provider whose `resolved` P′ row is present is reported here
   * as ALREADY_SATISFIED, discriminated by `satisfied: 'already_satisfied'`; the field is absent
   * on every other no-op, so a zero-`corrected` plan is byte-identical to the ISSUE-237 one.
   */
  noops: readonly AflApiReplayNoop[];
  stops: readonly { externalId: string; reason: string }[];
  /** AFLDB-ISSUE-237 D9/OD-2: providers whose agreeing importer row was superseded. Always
   * empty unless the caller's `expectedSupersedes` names the provider (D9: the replay never
   * decides its own supersedes). */
  supersedes: readonly { externalId: string; playerId: number }[];
};

/**
 * The ledger reduced to one row per external_id: the LATEST action (highest id) wins.
 * AFLDB-ISSUE-238: validates the whole ledger first (`assertAflApiLedgerStructure`), so every
 * reader built on the net view fails closed on an unknown action or a malformed corrected row.
 */
export function netLedgerRowsByExternalId(
  ledgerRows: readonly AflApiAdjudicationLedgerRow[],
): ReadonlyMap<string, AflApiAdjudicationLedgerRow> {
  assertAflApiLedgerStructure(ledgerRows);
  const byExternalId = new Map<string, AflApiAdjudicationLedgerRow>();
  for (const row of [...ledgerRows].sort((a, b) => a.id - b.id)) byExternalId.set(row.externalId, row);
  return byExternalId;
}

/**
 * D15's whole replay decision table, as a pure function of the reinstated ledger, the
 * already-computed player remap, and the candidate database's current afl_api state. Never
 * overwrites: every disagreement is a STOP, and only an identical existing row is a no-op.
 */
export function planAflApiAdjudicationReplay(input: {
  ledgerRows: readonly AflApiAdjudicationLedgerRow[];
  /** Keyed by external_id -- the D15-point-1 remap of that row's OWN player_id. */
  remapByExternalId: ReadonlyMap<string, AflApiPlayerRemapResult>;
  /** Keyed by external_id -- the candidate database's current external_identities row, if any. */
  candidateByExternalId: ReadonlyMap<string, AflApiCandidateIdentityRow>;
  /** Keyed by the REMAPPED (candidate) player id -- that player's current afl_api row, if any. */
  candidatePlayerAflApiRow: ReadonlyMap<number, AflApiCandidateIdentityRow>;
  /**
   * AFLDB-ISSUE-237 D9/OD-2: the EXACT set of provider ids this call is permitted to
   * supersede, fixed by the caller before any mutation (`E_rebuild` -- always empty -- for a
   * rebuild/OD-4 recovery call, `E_promotion = G2.AGREE` for a promotion call). Defaults to
   * empty, i.e. the pre-ISSUE-237 rebuild behaviour, so every existing ISSUE-235-era call
   * site keeps compiling and keeps its exact prior semantics unchanged.
   */
  expectedSupersedes?: ReadonlySet<string>;
}): AflApiReplayPlan {
  const expectedSupersedes = input.expectedSupersedes ?? new Set<string>();
  const net = netLedgerRowsByExternalId(input.ledgerRows);
  const inserts: { externalId: string; playerId: number }[] = [];
  const noops: AflApiReplayNoop[] = [];
  const stops: { externalId: string; reason: string }[] = [];
  const supersedes: { externalId: string; playerId: number }[] = [];

  for (const [externalId, row] of net) {
    switch (row.action) {
      case 'revoked': continue; // net-revoked: nothing to replay
      case 'linked': break;
      case 'corrected': break; // below: ALREADY_SATISFIED or STOP, never a write
      default: {
        const exhaustive: never = row.action;
        throw new AflApiLedgerMalformed(`unhandled ledger action ${String(exhaustive)}`);
      }
    }

    const remap = input.remapByExternalId.get(externalId);
    if (!remap || !remap.ok) {
      stops.push({
        externalId,
        reason: remap?.reason === 'continuity_contradiction'
          ? `the ledger row's player_identity ${aflApiContinuityContradictionText(remap)}`
          : remap?.reason === 'ambiguous'
            ? 'the ledger row\'s player_identity resolves to more than one candidate player'
            : 'the ledger row\'s player_identity does not resolve to any candidate player',
      });
      continue;
    }
    if (remap.remappedIdentity !== row.playerIdentity) {
      stops.push({
        externalId,
        reason: 'the remapped player\'s identity does not equal the ledger row\'s stored player_identity',
      });
      continue;
    }

    const candidate = input.candidateByExternalId.get(externalId);

    // AFLDB-ISSUE-238 §8.6 / §9.1 D15 / §9.2 (c): a net-`corrected` provider is live human
    // authority at P′. D15 only ever CONFIRMS it (ALREADY_SATISFIED when the `resolved` P′ row is
    // present); it never inserts, supersedes or writes a ledger row -- the ISSUE-238 REPLAY is
    // the only identity writer for a corrected provider. Anything else is a hard STOP; in
    // particular a stale importer row at P never replaces (or is superseded into) the correction.
    if (row.action === 'corrected') {
      if (expectedSupersedes.has(externalId)) {
        stops.push({
          externalId,
          reason: 'a corrected provider is named in the expected supersede set (C_promotion and '
            + 'E_promotion must be disjoint)',
        });
        continue;
      }
      if (candidate
        && candidate.status === 'resolved'
        && candidate.matchMethod === AFL_API_ADMIN_MATCH_METHOD
        && candidate.playerId === remap.newPlayerId) {
        noops.push({ externalId, satisfied: 'already_satisfied' });
        continue;
      }
      stops.push({
        externalId,
        reason: candidate
          ? 'the ledger records a correction for this provider, but its external_identities row is '
            + 'not the resolved corrected identity (a stale or conflicting row never replaces a correction)'
          : 'the ledger records a correction for this provider, but no resolved external_identities row '
            + 'exists for it (D15 never creates corrected authority)',
      });
      continue;
    }

    if (candidate) {
      const identicalHuman = candidate.status === 'resolved'
        && candidate.matchMethod === AFL_API_ADMIN_MATCH_METHOD
        && candidate.playerId === remap.newPlayerId;
      if (identicalHuman) { noops.push({ externalId }); continue; }

      // AFLDB-ISSUE-237 D9/OD-2: the ONE new transition. `candidate.playerId ===
      // remap.newPlayerId` already proves D9 conditions 2 and 6 together -- `remap` is the
      // resolution of THIS ledger row's own stored identity, so a candidate row on that same
      // resolved player is, by construction, a row whose forward identity agrees with the
      // ledger's stored identity. Conditions 1 (same provider, the map key) and 5 (LINKED,
      // this loop's own scope) hold structurally; only 3/4 (a full D5 importer row) are
      // checked explicitly below.
      const isFullImporterRow = candidate.status === 'unique'
        && isAflApiImporterMatchMethod(candidate.matchMethod)
        && candidate.candidateCount === 1
        && candidate.externalUrl === null
        && candidate.playerId !== null;
      if (isFullImporterRow && candidate.playerId === remap.newPlayerId) {
        if (!expectedSupersedes.has(externalId)) {
          stops.push({
            externalId,
            reason: 'an agreeing importer row exists for this provider but is not in the '
              + 'expected supersede set',
          });
          continue;
        }
        supersedes.push({ externalId, playerId: remap.newPlayerId });
        continue;
      }

      stops.push({ externalId, reason: 'a conflicting external_identities row already exists for this provider id' });
      continue;
    }

    const playerExisting = input.candidatePlayerAflApiRow.get(remap.newPlayerId);
    if (playerExisting) {
      stops.push({
        externalId,
        reason: `player ${remap.newPlayerId} already holds a different afl_api provider `
          + `(${playerExisting.externalId})`,
      });
      continue;
    }

    inserts.push({ externalId, playerId: remap.newPlayerId });
  }

  return { inserts, noops, stops, supersedes };
}

/**
 * AFLDB-ISSUE-238: does this NET ledger action leave a live `resolved` human identity row?
 * `linked` (at P) and `corrected` (at P′) do; `revoked` does not. Exhaustive by construction.
 */
export function aflApiNetIsHumanLive(action: AflApiLedgerNetAction): boolean {
  switch (action) {
    case 'linked': return true;
    case 'corrected': return true;
    case 'revoked': return false;
    default: {
      const exhaustive: never = action;
      throw new AflApiLedgerMalformed(`unhandled ledger action ${String(exhaustive)}`);
    }
  }
}

export type AflApiBijectionMismatch =
  | { kind: 'ledger_without_row'; externalId: string }
  | { kind: 'row_without_ledger'; externalId: string };

/**
 * D15's consistency proof, in both directions: every net-`linked` (or, AFLDB-ISSUE-238,
 * net-`corrected`) ledger entry must have its matching `resolved`/`afl_api_admin_adjudication`
 * row, and every such row must have its net-`linked`/`corrected` ledger entry. Usable both as a promotion/rebuild gate and as a
 * standalone read-only invariant check (runbook §10.1 C5).
 */
export function checkAflApiAdjudicationBijection(input: {
  ledgerRows: readonly AflApiAdjudicationLedgerRow[];
  resolvedRows: readonly { externalId: string; status: string; matchMethod: string | null }[];
}): readonly AflApiBijectionMismatch[] {
  const net = netLedgerRowsByExternalId(input.ledgerRows);
  // AFLDB-ISSUE-238 §8.6: the live human-authority set is every net LINKED or CORRECTED entry --
  // a corrected provider is `resolved` at P′ (D7), never a revoked one.
  const netLinkedIds = new Set(
    [...net.entries()].filter(([, r]) => aflApiNetIsHumanLive(r.action)).map(([externalId]) => externalId),
  );
  const resolvedAdminIds = new Set(
    input.resolvedRows
      .filter((r) => r.status === 'resolved' && r.matchMethod === AFL_API_ADMIN_MATCH_METHOD)
      .map((r) => r.externalId),
  );
  const mismatches: AflApiBijectionMismatch[] = [];
  for (const externalId of netLinkedIds) {
    if (!resolvedAdminIds.has(externalId)) mismatches.push({ kind: 'ledger_without_row', externalId });
  }
  for (const externalId of resolvedAdminIds) {
    if (!netLinkedIds.has(externalId)) mismatches.push({ kind: 'row_without_ledger', externalId });
  }
  return mismatches;
}

/* ------------------------------------------------------------------ *
 * AFLDB-ISSUE-238: the stage-aware PRE-SWAP promotion contract (pending D15)
 *
 * A promotion candidate legitimately holds, before the swap, exactly the `resolved` rows of
 * `C_promotion` (the corrected providers the REPLAY wrote). Every OTHER net-`linked` provider of the
 * reinstated ledger is materialised by D15 only AFTER the swap, so until then it has a ledger entry and
 * no resolved row. The whole-table bijection (`checkAflApiAdjudicationBijection`, and so the extended
 * bijection of SAT-1) reports each of those as `ledger_without_row`, which made the pre-swap candidate
 * contract and SAT-1 impossible to satisfy together (the 2026-10-01 DEV rehearsal, Run C).
 *
 * The contract below tolerates EXACTLY the pending-D15 providers the bound promotion artefact declares
 * (`AflApiSupersedeFile.pendingD15Providers`) and nothing else. It never changes the global invariant:
 * callers that do not pass a contract (ordinary correction, rebuild, post-swap acceptance, E3) keep the
 * strict whole-table behaviour, so the exemption cannot outlive the pre-swap stage.
 * ------------------------------------------------------------------ */

/** One net-`linked` provider the promotion's D15 replay materialises after the swap. */
export type AflApiPendingD15Entry = {
  externalId: string;
  /** The NET ledger row (a `linked` row) this entry is bound to. */
  adjudicationId: number;
  /** That ledger row's stable player identity. */
  playerIdentity: string;
  /** `insert`: the candidate holds no row for the provider. `supersede`: it holds an agreeing importer row (E_promotion). */
  d15Action: 'insert' | 'supersede';
};

/** What the pre-swap stages (REPLAY 7.4e and CRV) are allowed to see. Comes only from the bound artefact. */
export type AflApiPreSwapPromotionContract = {
  readonly cPromotion: ReadonlySet<string>;
  readonly pendingD15: readonly AflApiPendingD15Entry[];
};

export type AflApiPendingD15Problem =
  | { kind: 'pending_d15_unbound'; externalId: string; detail: string }
  | { kind: 'pending_d15_materialised_early'; externalId: string }
  | { kind: 'pending_d15_not_observed'; externalId: string };

/**
 * The pre-swap filter over a bijection result. Returns the mismatches that REMAIN (every
 * `row_without_ledger`, every undeclared `ledger_without_row`, anything else) and the contract's own
 * problems. A declared provider is tolerated only when ALL hold: it is bound to its net ledger row
 * (action `linked`, that row id, that stable identity), it is not in `C_promotion`, it is listed once, the
 * candidate holds no `resolved` row for it, and its `ledger_without_row` is actually observed. The
 * observed tolerated set therefore equals the declared set exactly.
 */
export function applyAflApiPendingD15(input: {
  ledgerRows: readonly AflApiAdjudicationLedgerRow[];
  resolvedRows: readonly { externalId: string; status: string; matchMethod: string | null }[];
  mismatches: readonly AflApiBijectionMismatch[];
  contract: AflApiPreSwapPromotionContract;
}): { remaining: AflApiBijectionMismatch[]; contractProblems: AflApiPendingD15Problem[] } {
  const net = netLedgerRowsByExternalId(input.ledgerRows);
  const anyResolved = new Set(input.resolvedRows.filter((r) => r.status === 'resolved').map((r) => r.externalId));
  const contractProblems: AflApiPendingD15Problem[] = [];
  const bound = new Set<string>();
  const seen = new Set<string>();
  for (const entry of input.contract.pendingD15) {
    const unbound = (detail: string) => { contractProblems.push({ kind: 'pending_d15_unbound', externalId: entry.externalId, detail }); };
    if (seen.has(entry.externalId)) { unbound('declared more than once'); continue; }
    seen.add(entry.externalId);
    const row = net.get(entry.externalId);
    if (input.contract.cPromotion.has(entry.externalId)) { unbound('a C_promotion provider can never be pending D15'); continue; }
    if (!row) { unbound('no ledger entry'); continue; }
    if (row.action !== 'linked') { unbound(`its net ledger state is ${row.action}, not linked`); continue; }
    if (row.id !== entry.adjudicationId) { unbound(`its net ledger row is ${row.id}, the artefact binds ${entry.adjudicationId}`); continue; }
    if (row.playerIdentity !== entry.playerIdentity) { unbound('its net ledger stable identity differs from the artefact\'s'); continue; }
    if (anyResolved.has(entry.externalId)) {
      contractProblems.push({ kind: 'pending_d15_materialised_early', externalId: entry.externalId });
      continue;
    }
    bound.add(entry.externalId);
  }
  const observed = new Set<string>();
  const remaining: AflApiBijectionMismatch[] = [];
  for (const m of input.mismatches) {
    if (m.kind === 'ledger_without_row' && bound.has(m.externalId)) { observed.add(m.externalId); continue; }
    remaining.push(m);
  }
  for (const id of bound) {
    if (!observed.has(id)) contractProblems.push({ kind: 'pending_d15_not_observed', externalId: id });
  }
  return { remaining, contractProblems };
}

/**
 * The pending-D15 set as the restored gate can derive it: every net-`linked` provider of the target ledger
 * (a net-corrected one is `C_promotion`, a net-revoked one replays nothing). `supersede` for E_promotion
 * (G2 AGREE), `insert` for the rest; the candidate must hold no row for an `insert` provider and must hold
 * one for a `supersede` provider, or this refuses (G2 would already have refused the promotion).
 * Sorted by code-unit order of the provider id.
 */
export function deriveAflApiPendingD15(input: {
  ledgerRows: readonly AflApiAdjudicationLedgerRow[];
  ePromotion: ReadonlySet<string>;
  cPromotion: ReadonlySet<string>;
  candidateExternalIds: ReadonlySet<string>;
}): AflApiPendingD15Entry[] {
  const out: AflApiPendingD15Entry[] = [];
  for (const [externalId, row] of netLedgerRowsByExternalId(input.ledgerRows)) {
    if (row.action !== 'linked') continue;
    if (input.cPromotion.has(externalId)) {
      throw new Error(`deriveAflApiPendingD15: net-linked provider ${externalId} is also in C_promotion.`);
    }
    const supersede = input.ePromotion.has(externalId);
    if (supersede !== input.candidateExternalIds.has(externalId)) {
      throw new Error(`deriveAflApiPendingD15: provider ${externalId} is ${supersede ? 'in E_promotion without' : 'not in E_promotion but with'} a candidate row.`);
    }
    out.push({ externalId, adjudicationId: row.id, playerIdentity: row.playerIdentity, d15Action: supersede ? 'supersede' : 'insert' });
  }
  for (const externalId of input.ePromotion) {
    if (!out.some((e) => e.externalId === externalId)) {
      throw new Error(`deriveAflApiPendingD15: E_promotion provider ${externalId} is not net-linked in the ledger.`);
    }
  }
  return out.sort((a, b) => compareCodeUnits(a.externalId, b.externalId));
}

/**
 * Post-swap: D15's own plan must be exactly the declared pending set. Every planned insert/supersede is a
 * declared provider with that action; every declared provider is planned or (an idempotent re-run) already
 * materialised identically; nothing else. `[]` = exact.
 */
export function aflApiPendingD15PlanProblems(input: {
  plan: Pick<AflApiReplayPlan, 'inserts' | 'supersedes' | 'noops'>;
  pending: readonly AflApiPendingD15Entry[];
}): string[] {
  const problems: string[] = [];
  const byId = new Map(input.pending.map((e) => [e.externalId, e]));
  if (byId.size !== input.pending.length) problems.push('the pending D15 list names a provider more than once');
  const inserts = new Set(input.plan.inserts.map((i) => i.externalId));
  const supersedes = new Set(input.plan.supersedes.map((s) => s.externalId));
  const materialised = new Set(input.plan.noops.filter((n) => n.satisfied === undefined).map((n) => n.externalId));
  for (const id of inserts) {
    if (byId.get(id)?.d15Action !== 'insert') problems.push(`D15 would insert ${id}, which the artefact does not declare as a pending insert`);
  }
  for (const id of supersedes) {
    if (byId.get(id)?.d15Action !== 'supersede') problems.push(`D15 would supersede ${id}, which the artefact does not declare as a pending supersede`);
  }
  for (const entry of input.pending) {
    const done = entry.d15Action === 'insert' ? inserts.has(entry.externalId) : supersedes.has(entry.externalId);
    if (!done && !materialised.has(entry.externalId)) {
      problems.push(`the declared pending ${entry.d15Action} for ${entry.externalId} is neither planned nor already materialised`);
    }
  }
  return problems.sort();
}

/* ------------------------------------------------------------------ *
 * 5. AFLDB-ISSUE-237 — importer identity capture, replay and promotion
 *    gates (D5, D6, D9, D13, D14; runbook §6.1, §6.2, §6.3, §7.2)
 *
 * Everything below is pure: no database, clock or network access. The
 * adapters (`tools/migration/replay_afl_api_adjudications.ts`,
 * `tools/migration/rebuild_afl_api_adjudications.ts`,
 * `tools/db/promotion-check.ts`) read the live facts these functions need
 * and pass them in as plain data, exactly the ISSUE-235 §4 pattern above.
 * ------------------------------------------------------------------ */

/** D5 — the exact importer-created `match_method` set, pinned against the loader's
 * `ALLOWED_MATCH_METHODS` by a DB-free test that reads the `.py` source text (runbook §9). */
export const AFL_API_IMPORTER_MATCH_METHODS = [
  'afl_api_stat_vector_bootstrap',
  'afl_api_name_team_season_bootstrap',
  'afl_api_manual_adjudication',
  'afl_api_stat_vector_season',
] as const;

export type AflApiImporterMatchMethod = typeof AFL_API_IMPORTER_MATCH_METHODS[number];

export function isAflApiImporterMatchMethod(method: string | null): method is AflApiImporterMatchMethod {
  return method !== null
    && (AFL_API_IMPORTER_MATCH_METHODS as readonly string[]).includes(method);
}

/* --- D6: the captured importer row shape ---------------------------- */

/**
 * D6's captured-row fields. `playerId` is audit-only (never written back, D6); every other
 * field is either IDENTITY (must resolve/compare exactly) or MEANING (must be reproduced
 * exactly) or FIDELITY (carried verbatim, never compared for identity).
 */
export type CapturedImporterRow = {
  externalId: string;
  /** The unprefixed lineage value (§5) -- the forward identity of the row's player at capture time. */
  playerIdentity: string;
  matchMethod: AflApiImporterMatchMethod;
  status: 'unique';
  candidateCount: 1;
  externalName: string | null;
  externalUrl: null;
  notes: string | null;
  /** Audit only -- the captured database's own surrogate id. Never trusted by the replay (D3). */
  playerId: number;
};

export type CapturedImporterRowProblem =
  | { kind: 'duplicate_provider'; externalId: string }
  | { kind: 'duplicate_identity'; playerIdentity: string }
  | { kind: 'unsupported_method'; externalId: string; matchMethod: string }
  | { kind: 'unexpected_candidate_count'; externalId: string; candidateCount: number }
  | { kind: 'non_null_external_url'; externalId: string }
  | { kind: 'empty_identity'; externalId: string };

/**
 * D13's capture-structure checks, run at Stage 2 over the live snapshot and at Stage 18 over
 * the parsed capture file: providers unique, identities unique (the migration 104 per-player
 * index, checked here before any database round-trip), and every row's own D5 shape held.
 */
export function importerCaptureStructureProblems(
  rows: readonly CapturedImporterRow[],
): readonly CapturedImporterRowProblem[] {
  const problems: CapturedImporterRowProblem[] = [];
  const seenProviders = new Set<string>();
  const seenIdentities = new Set<string>();
  for (const row of rows) {
    if (seenProviders.has(row.externalId)) problems.push({ kind: 'duplicate_provider', externalId: row.externalId });
    seenProviders.add(row.externalId);

    if (!row.playerIdentity) {
      problems.push({ kind: 'empty_identity', externalId: row.externalId });
    } else {
      if (seenIdentities.has(row.playerIdentity)) {
        problems.push({ kind: 'duplicate_identity', playerIdentity: row.playerIdentity });
      }
      seenIdentities.add(row.playerIdentity);
    }

    if (!isAflApiImporterMatchMethod(row.matchMethod)) {
      problems.push({ kind: 'unsupported_method', externalId: row.externalId, matchMethod: row.matchMethod });
    }
    if (row.candidateCount !== 1) {
      problems.push({ kind: 'unexpected_candidate_count', externalId: row.externalId, candidateCount: row.candidateCount });
    }
    if (row.externalUrl !== null) {
      problems.push({ kind: 'non_null_external_url', externalId: row.externalId });
    }
  }
  return problems;
}

/* --- D5 census: classify a raw afl_api row into importer / human / anomaly ---------------- */

export type AflApiCensusRow = {
  externalId: string;
  status: string;
  matchMethod: string | null;
  playerId: number | null;
  candidateCount: number;
  externalUrl: string | null;
};

export type AflApiCensusRowClassification =
  | { kind: 'importer'; matchMethod: AflApiImporterMatchMethod }
  | { kind: 'human' }
  | { kind: 'anomaly'; reason: string };

/** D5's exhaustive per-row classification. The only admissible rows are a full D5 importer
 * row or ISSUE-235's human row (`resolved`/`afl_api_admin_adjudication`, D5); every other
 * shape is an anomaly, named by reason. Nothing is silently copied or silently dropped. */
export function classifyAflApiCensusRow(row: AflApiCensusRow): AflApiCensusRowClassification {
  if (row.status === 'unique') {
    if (row.playerId === null) return { kind: 'anomaly', reason: `unique row ${row.externalId} has a NULL player_id` };
    if (!isAflApiImporterMatchMethod(row.matchMethod)) {
      return { kind: 'anomaly', reason: `unique row ${row.externalId} has an unsupported match_method ${String(row.matchMethod)}` };
    }
    if (row.candidateCount !== 1) {
      return { kind: 'anomaly', reason: `unique row ${row.externalId} has candidate_count ${row.candidateCount}, expected 1` };
    }
    if (row.externalUrl !== null) {
      return { kind: 'anomaly', reason: `unique row ${row.externalId} has a non-NULL external_url` };
    }
    return { kind: 'importer', matchMethod: row.matchMethod };
  }
  if (row.status === 'resolved') {
    if (row.playerId === null) return { kind: 'anomaly', reason: `resolved row ${row.externalId} has a NULL player_id` };
    if (row.matchMethod !== AFL_API_ADMIN_MATCH_METHOD) {
      return { kind: 'anomaly', reason: `resolved row ${row.externalId} is under match_method ${String(row.matchMethod)}, expected ${AFL_API_ADMIN_MATCH_METHOD}` };
    }
    return { kind: 'human' };
  }
  return { kind: 'anomaly', reason: `row ${row.externalId} has an unsupported status ${row.status}` };
}

export type AflApiCensusResult = {
  importerRows: readonly (AflApiCensusRow & { matchMethod: AflApiImporterMatchMethod })[];
  humanRows: readonly AflApiCensusRow[];
  anomalies: readonly string[];
  countsByMethod: ReadonlyMap<AflApiImporterMatchMethod, number>;
};

/** The whole D5 census over a set of `afl_api` rows -- the shared basis for G1, the
 * pre-cutover target census and the standalone `assertAflApiIdentityInvariant`. */
export function censusAflApiRows(rows: readonly AflApiCensusRow[]): AflApiCensusResult {
  const importerRows: (AflApiCensusRow & { matchMethod: AflApiImporterMatchMethod })[] = [];
  const humanRows: AflApiCensusRow[] = [];
  const anomalies: string[] = [];
  const countsByMethod = new Map<AflApiImporterMatchMethod, number>();

  for (const row of rows) {
    const classification = classifyAflApiCensusRow(row);
    if (classification.kind === 'anomaly') { anomalies.push(classification.reason); continue; }
    if (classification.kind === 'human') { humanRows.push(row); continue; }
    importerRows.push({ ...row, matchMethod: classification.matchMethod });
    countsByMethod.set(classification.matchMethod, (countsByMethod.get(classification.matchMethod) ?? 0) + 1);
  }
  return { importerRows, humanRows, anomalies, countsByMethod };
}

/* --- D7: the forward stable-identity lookup, and its lifecycle-specific refusals ---------- */

/**
 * §5's forward lookup outcome for one player: an accepted stable identity (`unique` or
 * `resolved`, §5), or why none exists. `via` distinguishes the two identity namespaces
 * because D7's rebuild refusal and G2's UNEVALUABLE grade apply ONLY to the
 * `manual_admin_edit` namespace -- §5 itself accepts both.
 */
export type AflApiForwardIdentityResult =
  | { ok: true; identity: string; via: 'afltables' | 'manual_admin_edit' }
  | { ok: false; reason: 'no_identity' | 'ambiguous' };

/**
 * §5/D7's forward stable-identity classification for ONE player — the single implementation
 * behind every forward lookup (`readAflApiForwardIdentities` in the replay adapter, and the
 * promotion checker's own reader), so rebuild, recovery and promotion cannot disagree.
 *
 * - exactly one accepted AFL Tables path -> that path;
 * - exactly two, and they are EXACTLY one tracked `profile_url_continuity` rule's
 *   {continuing_url, renumbered_url} (continuity amendment, operator-approved 2026-09-25) ->
 *   the rule's `continuing_url`. The rule, never the sort order, picks the path: the fitzRoy
 *   importer registers both paths on the one folded player, and the continuing path is the
 *   ID-bearing one it folds INTO;
 * - any other count, or two paths no single rule names exactly -> `ambiguous`;
 * - no AFL Tables path -> the `manual_admin_edit` fallback, unchanged: one token -> it,
 *   several -> `ambiguous`, none -> `no_identity`.
 *
 * AFL Tables precedence is unchanged: a resolved AFL Tables identity (single path or exact
 * pair) wins over any manual token. Names, player ids and path order are never read.
 */
export function classifyAflApiForwardIdentity(input: {
  afltablesPaths: readonly string[];
  manualIdentities: readonly string[];
  continuityRules: ValidatedFitzroyProfileContinuityRules;
}): AflApiForwardIdentityResult {
  const afltables = [...new Set(input.afltablesPaths)];
  const manual = [...new Set(input.manualIdentities)];
  if (afltables.length === 1) return { ok: true, identity: afltables[0], via: 'afltables' };
  if (afltables.length === 2) {
    const [a, b] = afltables;
    const rules = input.continuityRules.filter((r) =>
      (r.continuingUrl === a && r.renumberedUrl === b) || (r.continuingUrl === b && r.renumberedUrl === a));
    if (rules.length === 1) return { ok: true, identity: rules[0].continuingUrl, via: 'afltables' };
    return { ok: false, reason: 'ambiguous' };
  }
  if (afltables.length > 2) return { ok: false, reason: 'ambiguous' };
  if (manual.length > 1) return { ok: false, reason: 'ambiguous' };
  if (manual.length === 1) return { ok: true, identity: manual[0], via: 'manual_admin_edit' };
  return { ok: false, reason: 'no_identity' };
}

/**
 * `classifyAflApiForwardIdentity` over the accepted-identity rows of a SET of players (the
 * rows both forward readers select: `afltables`/`afltables_profile_url` and
 * `manual_admin_edit`/`manual_admin_edit`, status `unique` or `resolved`). Every requested
 * player gets a result; a player with no row is `no_identity`.
 */
export function classifyAflApiForwardIdentityRows(input: {
  playerIds: readonly number[];
  rows: readonly { playerId: number; externalId: string; sourceKey: string }[];
  continuityRules: ValidatedFitzroyProfileContinuityRules;
}): Map<number, AflApiForwardIdentityResult> {
  const byPlayer = new Map<number, { afltables: string[]; manual: string[] }>();
  for (const row of input.rows) {
    if (!byPlayer.has(row.playerId)) byPlayer.set(row.playerId, { afltables: [], manual: [] });
    const own = byPlayer.get(row.playerId)!;
    if (row.sourceKey === 'afltables') own.afltables.push(row.externalId);
    else if (row.sourceKey === 'manual_admin_edit') own.manual.push(row.externalId);
  }
  const result = new Map<number, AflApiForwardIdentityResult>();
  for (const playerId of input.playerIds) {
    const own = byPlayer.get(playerId) ?? { afltables: [], manual: [] };
    result.set(playerId, classifyAflApiForwardIdentity({
      afltablesPaths: own.afltables, manualIdentities: own.manual, continuityRules: input.continuityRules,
    }));
  }
  return result;
}

/**
 * D7's REBUILD-specific refusal (Stage 2, and the OD-4 export, R3): every captured row's
 * player must resolve to exactly one accepted identity, AND that identity must not be a bare
 * `manual_admin_edit` token. Since AFLDB-ISSUE-245, a supported manual-registration-backed
 * player (carried in the combined capture's registrations section) IS recreated by Stages
 * 17-19, before the AFL API replay stage runs; an unsupported or manual-token-only player is
 * not, and still refuses before the reset (ISSUE-245 Stage 2). This function refuses every
 * `manual_admin_edit`-only identity regardless, because ISSUE-237 itself never creates
 * canonical players and this check cannot tell a supported registration from an unsupported
 * one. Returns a human-readable reason, or `null` when the rebuild may proceed for this player.
 */
export function aflApiRebuildIdentityRefusalReason(result: AflApiForwardIdentityResult): string | null {
  if (!result.ok) {
    return result.reason === 'ambiguous'
      ? 'the player holds more than one AFL Tables profile identity, and they are not exactly '
        + 'one tracked profile_url_continuity pair'
      : 'the player has no accepted stable identity';
  }
  if (result.via === 'manual_admin_edit') {
    return 'the player is identified only by a manual_admin_edit token; ISSUE-237 creates no '
      + 'canonical players itself, so this refuses here even when AFLDB-ISSUE-245 registration '
      + 'reinstatement would recreate the player before replay';
  }
  return null;
}

/* --- D9: the importer replay planner (rebuild, and the OD-4 recovery path) ---------------- */

export type AflApiImporterCandidateRow = {
  externalId: string;
  status: string;
  matchMethod: string | null;
  playerId: number | null;
};

export type AflApiImporterReplayPlan = {
  inserts: readonly { externalId: string; playerId: number; row: CapturedImporterRow }[];
  noops: readonly { externalId: string }[];
  stops: readonly { externalId: string; reason: string }[];
};

/**
 * D9's importer replay table, a pure planner with the same shape as
 * `planAflApiAdjudicationReplay`. Used by `db:test:rebuild`'s Stage 18 (a) and the OD-4
 * recovery tool (§11a) -- never by promotion, which carries importer rows in the dump (D2).
 */
export function planAflApiImporterReplay(input: {
  capturedRows: readonly CapturedImporterRow[];
  /** Keyed by external_id -- the reverse resolution of that row's OWN playerIdentity. */
  remapByExternalId: ReadonlyMap<string, AflApiPlayerRemapResult>;
  /** Keyed by external_id -- the candidate database's current external_identities row, if any. */
  candidateByExternalId: ReadonlyMap<string, AflApiImporterCandidateRow>;
  /** Keyed by the REMAPPED (candidate) player id -- that player's current afl_api row, if any. */
  candidatePlayerAflApiRow: ReadonlyMap<number, AflApiImporterCandidateRow>;
}): AflApiImporterReplayPlan {
  const inserts: { externalId: string; playerId: number; row: CapturedImporterRow }[] = [];
  const noops: { externalId: string }[] = [];
  const stops: { externalId: string; reason: string }[] = [];

  for (const row of input.capturedRows) {
    const remap = input.remapByExternalId.get(row.externalId);
    if (!remap || !remap.ok) {
      stops.push({
        externalId: row.externalId,
        reason: remap?.reason === 'continuity_contradiction'
          ? `the captured row's player identity ${aflApiContinuityContradictionText(remap)}`
          : remap?.reason === 'ambiguous'
            ? 'the captured row\'s player identity resolves to more than one candidate player'
            : 'the captured row\'s player identity does not resolve to any candidate player',
      });
      continue;
    }
    if (remap.remappedIdentity !== row.playerIdentity) {
      stops.push({
        externalId: row.externalId,
        reason: 'the remapped player\'s identity does not equal the captured row\'s player identity',
      });
      continue;
    }

    const candidate = input.candidateByExternalId.get(row.externalId);
    if (candidate) {
      if (candidate.status === 'resolved') {
        stops.push({
          externalId: row.externalId,
          reason: 'a human resolved row already exists for this provider id -- cannot occur from '
            + 'a single consistent snapshot (the importer runs first)',
        });
        continue;
      }
      const identical = candidate.status === row.status
        && candidate.matchMethod === row.matchMethod
        && candidate.playerId === remap.newPlayerId;
      if (identical) { noops.push({ externalId: row.externalId }); continue; }
      stops.push({
        externalId: row.externalId,
        reason: candidate.playerId === remap.newPlayerId
          ? 'an importer row for this provider already exists under a different method or field'
          : 'an importer row for this provider already exists, resolved to a different player',
      });
      continue;
    }

    const playerExisting = input.candidatePlayerAflApiRow.get(remap.newPlayerId);
    if (playerExisting) {
      stops.push({
        externalId: row.externalId,
        reason: `player ${remap.newPlayerId} already holds a different afl_api provider `
          + `(${playerExisting.externalId})`,
      });
      continue;
    }

    inserts.push({ externalId: row.externalId, playerId: remap.newPlayerId, row });
  }

  return { inserts, noops, stops };
}

/* --- D13: exact parity between a capture and the live projection -------------------------- */

export type AflApiImporterProjection = {
  externalId: string;
  playerIdentity: string;
  status: 'unique';
  candidateCount: number;
  matchMethod: string;
  externalName: string | null;
  externalUrl: string | null;
  notes: string | null;
};

export type AflApiImporterParityProblem =
  | { kind: 'missing_row'; externalId: string }
  | { kind: 'extra_row'; externalId: string }
  | { kind: 'retargeted_identity'; externalId: string; captured: string; live: string }
  | { kind: 'changed_method'; externalId: string; captured: string; live: string }
  | { kind: 'changed_field'; externalId: string; field: string; captured: unknown; live: unknown };

/**
 * D13's exact-parity check: the live (post-reinstate) importer projection must equal the
 * captured projection as a set, covering count parity, provider-set equality, the
 * provider-to-identity bijection, method equality and no silent retargeting all in one
 * comparison.
 */
export function importerParityProblems(input: {
  captured: readonly AflApiImporterProjection[];
  live: readonly AflApiImporterProjection[];
}): readonly AflApiImporterParityProblem[] {
  const problems: AflApiImporterParityProblem[] = [];
  const capturedByExternalId = new Map(input.captured.map((r) => [r.externalId, r]));
  const liveByExternalId = new Map(input.live.map((r) => [r.externalId, r]));
  const fields: (keyof AflApiImporterProjection)[] =
    ['status', 'candidateCount', 'externalName', 'externalUrl', 'notes'];

  for (const [externalId, capturedRow] of capturedByExternalId) {
    const liveRow = liveByExternalId.get(externalId);
    if (!liveRow) { problems.push({ kind: 'missing_row', externalId }); continue; }
    if (liveRow.playerIdentity !== capturedRow.playerIdentity) {
      problems.push({ kind: 'retargeted_identity', externalId, captured: capturedRow.playerIdentity, live: liveRow.playerIdentity });
    }
    if (liveRow.matchMethod !== capturedRow.matchMethod) {
      problems.push({ kind: 'changed_method', externalId, captured: capturedRow.matchMethod, live: liveRow.matchMethod });
    }
    for (const field of fields) {
      if (capturedRow[field] !== liveRow[field]) {
        problems.push({ kind: 'changed_field', externalId, field, captured: capturedRow[field], live: liveRow[field] });
      }
    }
  }
  for (const externalId of liveByExternalId.keys()) {
    if (!capturedByExternalId.has(externalId)) problems.push({ kind: 'extra_row', externalId });
  }
  return problems;
}

/* --- D9: the agreement predicate agrees(P), shared by E_rebuild and E_promotion ------------ */

export type AflApiAgreementImporterRow = {
  status: string;
  matchMethod: string | null;
  candidateCount: number;
  externalUrl: string | null;
  playerId: number | null;
  /** This row's OWN forward identity (§5). */
  playerIdentity: string;
};

export type AflApiAgreementLedgerEntry = {
  playerIdentity: string;
  /** AFLDB-ISSUE-238: `CORRECTED` never agrees (condition 5 needs LINKED); it is routed to CPC. */
  effectiveState: 'LINKED' | 'REVOKED' | 'CORRECTED';
};

/**
 * D9's six-condition `agrees(P)` predicate, shared verbatim by rebuild semantics (where
 * agreement signals corruption, `E_rebuild` must be empty) and promotion semantics (where
 * agreement is the permitted supersede set, `E_promotion = G2.AGREE`). Both call sites decide
 * what agreement MEANS; this function only decides whether it holds.
 */
export function aflApiAgrees(input: {
  importerRow: AflApiAgreementImporterRow | null;
  ledgerEntry: AflApiAgreementLedgerEntry | null;
  /** The reverse resolution of the ledger entry's OWN player_identity. */
  ledgerRemap: AflApiPlayerRemapResult | null;
}): boolean {
  const { importerRow, ledgerEntry, ledgerRemap } = input;
  if (!importerRow || !ledgerEntry) return false; // condition 1: both sides must name the same provider
  if (importerRow.status !== 'unique') return false; // condition 3
  if (!isAflApiImporterMatchMethod(importerRow.matchMethod)) return false; // condition 4
  if (importerRow.candidateCount !== 1) return false; // part of the D5 shape a full row requires
  if (importerRow.externalUrl !== null) return false; // part of the D5 shape a full row requires
  if (importerRow.playerId === null) return false;
  if (ledgerEntry.effectiveState !== 'LINKED') return false; // condition 5
  if (ledgerEntry.playerIdentity !== importerRow.playerIdentity) return false; // condition 2
  if (!ledgerRemap || !ledgerRemap.ok) return false;
  if (ledgerRemap.newPlayerId !== importerRow.playerId) return false; // condition 6
  return true;
}

/**
 * The `{ P : agrees(P) }` set over a combined ledger + importer snapshot -- `E_rebuild` at
 * Stage 2 (the live snapshot) and Stage 18 (the capture file alone, condition 6 not required
 * to refuse per §6.1's Stage 18 bullet -- see the runbook note there; this function still
 * evaluates all six when a remap is supplied, which is only stricter).
 */
export function computeAflApiAgreeingProviders(input: {
  ledgerRows: readonly AflApiAdjudicationLedgerRow[];
  importerByExternalId: ReadonlyMap<string, AflApiAgreementImporterRow>;
  /** The reverse resolution of each ledger row's OWN player_identity. */
  remapByExternalId: ReadonlyMap<string, AflApiPlayerRemapResult>;
}): ReadonlySet<string> {
  const net = netLedgerRowsByExternalId(input.ledgerRows);
  const agreeing = new Set<string>();
  for (const [externalId, ledgerRow] of net) {
    switch (ledgerRow.action) {
      case 'linked': break;
      case 'revoked': continue;
      // AFLDB-ISSUE-238 §8.6: a correction is never AGREE -- never in E_rebuild/E_promotion,
      // never superseded by an importer row; the promotion routes it to CPC (§9.1) and the
      // rebuild capture refuses it outright (§9.2).
      case 'corrected': continue;
      default: {
        const exhaustive: never = ledgerRow.action;
        throw new AflApiLedgerMalformed(`unhandled ledger action ${String(exhaustive)}`);
      }
    }
    const importerRow = input.importerByExternalId.get(externalId) ?? null;
    const remap = input.remapByExternalId.get(externalId) ?? null;
    if (aflApiAgrees({
      importerRow,
      ledgerEntry: { playerIdentity: ledgerRow.playerIdentity, effectiveState: 'LINKED' },
      ledgerRemap: remap,
    })) agreeing.add(externalId);
  }
  return agreeing;
}

/**
 * D9/OD-6 -- Stage 18's INDEPENDENT pre-mutation `E_rebuild` recheck, over the CAPTURE FILE
 * ALONE (no database read; runbook §6.1 Stage 18: "It does not rely on Stage 2 having
 * checked"). Evaluates conditions 1-5 of `agrees(P)` only: condition 6 (the remap) needs a
 * database and is not required to refuse here, because agreement on 1-5 alone is already
 * refused -- which is STRICTER, not weaker. Conditions 3 and 4 (status `unique`, an approved
 * importer method) are guaranteed by `CapturedImporterRow`'s own D5 shape once the caller has
 * already proven `importerCaptureStructureProblems([...]) .length === 0`; condition 5 (the
 * ledger's effective state is LINKED) is exactly what `netLedgerRowsByExternalId` with
 * `action === 'linked'` means. Only conditions 1 (same provider) and 2 (same stable identity)
 * remain to check here.
 */
export function capturedOverlapProviders(input: {
  ledgerRows: readonly AflApiAdjudicationLedgerRow[];
  importerRows: readonly CapturedImporterRow[];
}): readonly string[] {
  const importerByExternalId = new Map(input.importerRows.map((r) => [r.externalId, r]));
  const net = netLedgerRowsByExternalId(input.ledgerRows);
  const overlapping: string[] = [];
  for (const [externalId, ledgerRow] of net) {
    const importerRow = importerByExternalId.get(externalId);
    switch (ledgerRow.action) {
      case 'revoked': continue;
      case 'linked':
        if (importerRow && importerRow.playerIdentity === ledgerRow.playerIdentity) overlapping.push(externalId);
        continue;
      // AFLDB-ISSUE-238 §8.6/§9.2: a corrected provider is `resolved` on the captured database,
      // so the importer section cannot hold it at ALL -- any captured importer row for it (at
      // P, P′ or a third identity) is an overlap, i.e. a capture refusal.
      case 'corrected':
        if (importerRow) overlapping.push(externalId);
        continue;
      default: {
        const exhaustive: never = ledgerRow.action;
        throw new AflApiLedgerMalformed(`unhandled ledger action ${String(exhaustive)}`);
      }
    }
  }
  return overlapping.sort();
}

/**
 * D13's Stage 18 (c) check and the promotion §8-step-1 check: the ACTUAL superseded provider
 * set (from `AflApiReplayPlan.supersedes`) must equal the EXPECTED set exactly. Empty/empty
 * arrays mean a match.
 */
export function aflApiSupersedeMismatch(input: {
  expected: ReadonlySet<string>;
  actual: readonly { externalId: string }[];
}): { missing: readonly string[]; extra: readonly string[] } {
  const actualSet = new Set(input.actual.map((s) => s.externalId));
  const missing = [...input.expected].filter((id) => !actualSet.has(id)).sort();
  const extra = [...actualSet].filter((id) => !input.expected.has(id)).sort();
  return { missing, extra };
}

/* --- The standalone invariant (D13; Stage 19, G1, and any-time validation) ----------------- */

export type AflApiInvariantProblem =
  | { kind: 'census_anomaly'; detail: string }
  | { kind: 'bijection_mismatch'; mismatch: AflApiBijectionMismatch }
  | { kind: 'player_holds_multiple_rows'; playerId: number; externalIds: readonly string[] }
  | { kind: 'unresolved_identity'; externalId: string; reason: string };

/**
 * `assertAflApiIdentityInvariant()`'s pure core (D13, Stage 19): the D5 census holds no
 * anomaly, the D15 bijection holds, one row per player, and every importer row's player has
 * exactly one accepted stable identity. Needs no capture -- usable at any time.
 */
export function checkAflApiIdentityInvariant(input: {
  rows: readonly AflApiCensusRow[];
  ledgerRows: readonly AflApiAdjudicationLedgerRow[];
  /** Keyed by player id -- the D7 forward lookup for every importer row's player. */
  identityByPlayerId: ReadonlyMap<number, AflApiForwardIdentityResult>;
}): readonly AflApiInvariantProblem[] {
  const problems: AflApiInvariantProblem[] = [];
  const census = censusAflApiRows(input.rows);
  for (const anomaly of census.anomalies) problems.push({ kind: 'census_anomaly', detail: anomaly });

  const bijectionMismatches = checkAflApiAdjudicationBijection({
    ledgerRows: input.ledgerRows,
    resolvedRows: census.humanRows.map((r) => ({ externalId: r.externalId, status: r.status, matchMethod: r.matchMethod })),
  });
  for (const mismatch of bijectionMismatches) problems.push({ kind: 'bijection_mismatch', mismatch });

  const byPlayer = new Map<number, string[]>();
  for (const row of [...census.importerRows, ...census.humanRows]) {
    if (row.playerId === null) continue;
    if (!byPlayer.has(row.playerId)) byPlayer.set(row.playerId, []);
    byPlayer.get(row.playerId)!.push(row.externalId);
  }
  for (const [playerId, externalIds] of byPlayer) {
    if (externalIds.length > 1) {
      problems.push({ kind: 'player_holds_multiple_rows', playerId, externalIds: [...externalIds].sort() });
    }
  }

  for (const row of census.importerRows) {
    if (row.playerId === null) continue;
    const identity = input.identityByPlayerId.get(row.playerId);
    if (!identity || !identity.ok) {
      problems.push({
        externalId: row.externalId,
        kind: 'unresolved_identity',
        reason: identity && !identity.ok ? identity.reason : 'no_identity',
      });
    }
  }
  return problems;
}

/* --- G1: source/candidate census gate (D14) ------------------------------------------------ */

export type AflApiG1Problem =
  | { kind: 'census_anomaly'; detail: string }
  | { kind: 'resolved_row_present'; externalId: string }
  | { kind: 'resolved_row_unexpected'; externalId: string }
  | { kind: 'resolved_row_missing'; externalId: string }
  | { kind: 'ledger_row_present'; count: number }
  | { kind: 'unresolved_identity'; externalId: string; reason: string }
  | { kind: 'player_holds_multiple_rows'; playerId: number; externalIds: readonly string[] }
  | { kind: 'rebuild_marker_present' }
  | {
    kind: 'ledger_not_bound_target_state';
    boundRowCount: number; actualRowCount: number; boundSha256: string; actualSha256: string;
  };

/**
 * G1 (§6.2's `--phase source` and `--phase candidate` rows, D14): FAIL on any D5 anomaly, any
 * `resolved` row, an importer row without exactly one accepted identity, a player holding more
 * than one `afl_api` row, or a rebuild marker present. Any non-empty result is FAIL; there is
 * no partial pass.
 *
 * The ledger rule depends on WHOSE ledger the database may legitimately hold (F-L4-3):
 *
 * - `boundLedger` omitted (the `source` phase, and the default): the database is SOURCE
 *   lineage, which must carry no human authority at all — any ledger row is
 *   `ledger_row_present`.
 * - `boundLedger` given (`--phase candidate`, after the promotion plan reinstated the TARGET's
 *   durable ledger): the ledger must be EXACTLY the target ledger G2 evaluated at `--phase
 *   restored` — same row count, same stable-field digest (`aflApiLedgerStateSha256`). A
 *   missing, extra or altered human row is `ledger_not_bound_target_state`; nothing is dropped
 *   or downgraded silently. `resolved` rows still refuse: D15 has not run yet.
 */
export function classifyAflApiG1(input: {
  rows: readonly AflApiCensusRow[];
  ledgerRowCount: number;
  identityByPlayerId: ReadonlyMap<number, AflApiForwardIdentityResult>;
  rebuildMarkerPresent: boolean;
  boundLedger?: { boundRowCount: number; boundSha256: string; actualSha256: string };
  /**
   * AFLDB-ISSUE-238 §9.1 (`--phase candidate` after CPC): the provider ids of `C_promotion`, the
   * ONLY `resolved` rows the candidate may legitimately hold. Omitted or empty = the old rule
   * (any `resolved` row is `resolved_row_present`). Non-empty: the resolved set must equal this
   * set EXACTLY -- an extra row is `resolved_row_unexpected`, an absent one `resolved_row_missing`.
   */
  expectedResolvedExternalIds?: ReadonlySet<string>;
}): readonly AflApiG1Problem[] {
  const problems: AflApiG1Problem[] = [];
  if (input.rebuildMarkerPresent) problems.push({ kind: 'rebuild_marker_present' });
  if (input.boundLedger === undefined) {
    if (input.ledgerRowCount > 0) problems.push({ kind: 'ledger_row_present', count: input.ledgerRowCount });
  } else if (input.ledgerRowCount !== input.boundLedger.boundRowCount
    || input.boundLedger.actualSha256 !== input.boundLedger.boundSha256) {
    problems.push({
      kind: 'ledger_not_bound_target_state',
      boundRowCount: input.boundLedger.boundRowCount, actualRowCount: input.ledgerRowCount,
      boundSha256: input.boundLedger.boundSha256, actualSha256: input.boundLedger.actualSha256,
    });
  }

  const census = censusAflApiRows(input.rows);
  for (const anomaly of census.anomalies) problems.push({ kind: 'census_anomaly', detail: anomaly });
  const expectedResolved = input.expectedResolvedExternalIds ?? new Set<string>();
  if (expectedResolved.size === 0) {
    for (const row of census.humanRows) problems.push({ kind: 'resolved_row_present', externalId: row.externalId });
  } else {
    const actualResolved = new Set(census.humanRows.map((r) => r.externalId));
    for (const id of [...actualResolved].sort(compareCodeUnits)) {
      if (!expectedResolved.has(id)) problems.push({ kind: 'resolved_row_unexpected', externalId: id });
    }
    for (const id of [...expectedResolved].sort(compareCodeUnits)) {
      if (!actualResolved.has(id)) problems.push({ kind: 'resolved_row_missing', externalId: id });
    }
  }

  const byPlayer = new Map<number, string[]>();
  for (const row of census.importerRows) {
    if (row.playerId === null) continue;
    if (!byPlayer.has(row.playerId)) byPlayer.set(row.playerId, []);
    byPlayer.get(row.playerId)!.push(row.externalId);

    const identity = input.identityByPlayerId.get(row.playerId);
    if (!identity || !identity.ok) {
      problems.push({
        externalId: row.externalId,
        kind: 'unresolved_identity',
        reason: identity && !identity.ok ? identity.reason : 'no_identity',
      });
    }
  }
  for (const [playerId, externalIds] of byPlayer) {
    if (externalIds.length > 1) {
      problems.push({ kind: 'player_holds_multiple_rows', playerId, externalIds: [...externalIds].sort() });
    }
  }
  return problems;
}

/* --- G2: human-vs-importer overlap gate (`--phase restored`) ------------------------------- */

export type AflApiG2EntryInput = {
  externalId: string;
  ledgerNetAction: AflApiLedgerNetAction;
  /** True when the ledger entry's stored player_identity is a manual_admin_edit token. */
  identityIsManualToken: boolean;
  /** The candidate's own afl_api row for the SAME provider (external_id), if any. */
  candidateRow: AflApiAgreementImporterRow | null;
  /** The candidate player the ledger entry's OWN identity remaps to, if resolvable. */
  remappedCandidatePlayerId: number | null;
  /** A DIFFERENT provider's external_id that already holds this identity's player in the candidate. */
  collidingProviderId: string | null;
  /**
   * AFLDB-ISSUE-237 continuity amendment: set when the ledger entry's identity is named by a
   * tracked `profile_url_continuity` rule the candidate contradicts
   * (`classifyAflApiReverseIdentity`). Optional so earlier callers keep compiling.
   */
  continuityContradiction?: AflApiContinuityContradiction | null;
  /**
   * AFLDB-ISSUE-237 F-L4-2: set when the ledger entry's own identity does not resolve to
   * exactly one candidate player (`classifyAflApiReverseIdentity` `unresolvable`/`ambiguous`).
   * The post-swap D15 replay STOPs on exactly that, so G2 refuses it before the swap. Optional
   * so earlier callers keep compiling; omitted means "not evaluated", the pre-fix behaviour.
   */
  remapFailure?: 'unresolvable' | 'ambiguous' | null;
};

export type AflApiG2Grade =
  | { externalId: string; outcome: 'AGREE' }
  | { externalId: string; outcome: 'DISAGREE' }
  | { externalId: string; outcome: 'COLLISION'; collidingProviderId: string }
  | { externalId: string; outcome: 'UNSUPPORTED' }
  | { externalId: string; outcome: 'UNEVALUABLE' }
  | { externalId: string; outcome: 'CONTINUITY_CONTRADICTION'; reason: string }
  | { externalId: string; outcome: 'UNRESOLVED'; reason: 'unresolvable' | 'ambiguous' }
  | { externalId: string; outcome: 'INFO_REVOKED_CANDIDATE' }
  /**
   * AFLDB-ISSUE-238 §8.6/§9.1: a net-`corrected` target entry is NOT graded by G2 (neither AGREE
   * nor the revoked INFO); it belongs to CPC. `CORRECTED_CPC_REPLAY`: CPC classified it into
   * candidate class 1-3 (its provider is in `opts.cpcCorrected`); it is a `correctedReplays`
   * entry, never a supersede, and does NOT refuse here. `CORRECTED_NOT_CPC_CLASSIFIED`: no CPC
   * classification for it (the default when `cpcCorrected` is omitted) and it REFUSES -- a
   * corrected provider can never reach the swap and a post-swap D15 uncorrected.
   */
  | { externalId: string; outcome: 'CORRECTED_CPC_REPLAY' }
  | { externalId: string; outcome: 'CORRECTED_NOT_CPC_CLASSIFIED' };

/** Every G2 outcome that refuses the promotion before the swap. Only AGREE, CORRECTED_CPC_REPLAY and the INFO grade pass. */
export const AFL_API_G2_REFUSING_OUTCOMES: ReadonlySet<AflApiG2Grade['outcome']> = new Set([
  'DISAGREE', 'COLLISION', 'UNSUPPORTED', 'UNEVALUABLE', 'CONTINUITY_CONTRADICTION', 'UNRESOLVED',
  'CORRECTED_NOT_CPC_CLASSIFIED',
]);

/**
 * G2 (§6.2), evaluated per net entry of the reinstated ledger. A net-linked entry with no
 * candidate importer row for the same provider is outside this table -- the ordinary D15
 * INSERT case, unaffected by ISSUE-237. A net-revoked entry is graded only as INFO, and only
 * when the candidate still carries an importer row for that provider (a revoke is an undo,
 * never a negative assertion).
 */
export function classifyAflApiG2(
  entries: readonly AflApiG2EntryInput[],
  opts?: {
    /** Providers CPC classified into candidate class 1-3 (AFLDB-ISSUE-238 §9.1). Omitted = none: every
     * net-`corrected` entry refuses (fail-closed). */
    cpcCorrected?: ReadonlySet<string>;
  },
): readonly AflApiG2Grade[] {
  const grades: AflApiG2Grade[] = [];
  const cpcCorrected = opts?.cpcCorrected ?? new Set<string>();
  for (const entry of entries) {
    switch (entry.ledgerNetAction) {
      case 'revoked':
        if (entry.candidateRow) grades.push({ externalId: entry.externalId, outcome: 'INFO_REVOKED_CANDIDATE' });
        continue;
      case 'corrected':
        grades.push({
          externalId: entry.externalId,
          outcome: cpcCorrected.has(entry.externalId) ? 'CORRECTED_CPC_REPLAY' : 'CORRECTED_NOT_CPC_CLASSIFIED',
        });
        continue;
      case 'linked': break;
      default: {
        const exhaustive: never = entry.ledgerNetAction;
        throw new AflApiLedgerMalformed(`unhandled ledger action ${String(exhaustive)}`);
      }
    }
    if (entry.identityIsManualToken) {
      grades.push({ externalId: entry.externalId, outcome: 'UNEVALUABLE' });
      continue;
    }
    // Graded before the "no importer row" skip: the post-promotion D15 replay would STOP on
    // this entry either way, so the checker refuses it here, not only after the swap.
    if (entry.continuityContradiction) {
      grades.push({
        externalId: entry.externalId, outcome: 'CONTINUITY_CONTRADICTION',
        reason: `player_identity ${aflApiContinuityContradictionText(entry.continuityContradiction)}`,
      });
      continue;
    }
    if (entry.collidingProviderId) {
      grades.push({ externalId: entry.externalId, outcome: 'COLLISION', collidingProviderId: entry.collidingProviderId });
      continue;
    }
    if (entry.remapFailure) {
      grades.push({ externalId: entry.externalId, outcome: 'UNRESOLVED', reason: entry.remapFailure });
      continue;
    }
    if (!entry.candidateRow) continue; // no importer row for this provider: outside the table
    const isFullImporterRow = entry.candidateRow.status === 'unique'
      && isAflApiImporterMatchMethod(entry.candidateRow.matchMethod)
      && entry.candidateRow.candidateCount === 1
      && entry.candidateRow.externalUrl === null
      && entry.candidateRow.playerId !== null;
    if (!isFullImporterRow) {
      grades.push({ externalId: entry.externalId, outcome: 'UNSUPPORTED' });
      continue;
    }
    const agrees = entry.candidateRow.playerId === entry.remappedCandidatePlayerId;
    grades.push({ externalId: entry.externalId, outcome: agrees ? 'AGREE' : 'DISAGREE' });
  }
  return grades;
}

/** `E_promotion = G2.AGREE` (D9, promotion semantics; §6.2). */
export function aflApiG2AgreeSet(grades: readonly AflApiG2Grade[]): ReadonlySet<string> {
  return new Set(grades.filter((g) => g.outcome === 'AGREE').map((g) => g.externalId));
}

/* --- G3: cross-lineage importer comparison (`--phase restored`, production and DEV) -------- */

export type AflApiG3Row = { externalId: string; playerIdentity: string; matchMethod: string };

export type AflApiDevRegenerationClassificationEntry = {
  externalId: string;
  playerIdentity: string;
  matchMethod: string;
};

export type AflApiG3Grade =
  | { externalId: string; outcome: 'PASS' }
  | { externalId: string; outcome: 'FAIL'; reason: 'method_changed' | 'disagreement' | 'collision' | 'hard_loss' }
  | { externalId: string; outcome: 'WARN'; reason: 'method_changed' | 'hard_loss_regeneration' }
  | { externalId: string; outcome: 'INFO'; reason: 'gained_coverage' };

/**
 * G3 (§6.2 production, §6.3 DEV), one grade per target-census row plus INFO for a candidate
 * provider the target never held. Production has no WARN grade of any kind (`environment:
 * 'production'` never consults `devRegenerationEntries`, even if one is supplied).
 */
export function classifyAflApiG3(input: {
  environment: 'production' | 'dev';
  targetRows: readonly AflApiG3Row[];
  candidateRows: readonly AflApiG3Row[];
  devRegenerationEntries?: readonly AflApiDevRegenerationClassificationEntry[];
}): readonly AflApiG3Grade[] {
  const candidateByExternalId = new Map(input.candidateRows.map((r) => [r.externalId, r]));
  const candidateByIdentity = new Map(input.candidateRows.map((r) => [r.playerIdentity, r]));
  const targetExternalIds = new Set(input.targetRows.map((r) => r.externalId));
  const classificationByExternalId = input.environment === 'dev'
    ? new Map((input.devRegenerationEntries ?? []).map((e) => [e.externalId, e]))
    : new Map<string, AflApiDevRegenerationClassificationEntry>();

  const grades: AflApiG3Grade[] = [];

  for (const target of input.targetRows) {
    const candidate = candidateByExternalId.get(target.externalId);

    // "The target's identity is held in the candidate by another provider" -- checked FIRST
    // and independent of whether the SAME provider also has a (necessarily different) row,
    // or has no row at all: either way the target's identity is not free in the candidate.
    const collidingElsewhere = candidateByIdentity.get(target.playerIdentity);
    if (collidingElsewhere && collidingElsewhere.externalId !== target.externalId) {
      grades.push({ externalId: target.externalId, outcome: 'FAIL', reason: 'collision' });
      continue;
    }

    if (!candidate) {
      const classification = classificationByExternalId.get(target.externalId);
      const eligible = input.environment === 'dev'
        && classification !== undefined
        && classification.playerIdentity === target.playerIdentity
        && classification.matchMethod === target.matchMethod
        && target.matchMethod === 'afl_api_stat_vector_season';
      grades.push(
        eligible
          ? { externalId: target.externalId, outcome: 'WARN', reason: 'hard_loss_regeneration' }
          : { externalId: target.externalId, outcome: 'FAIL', reason: 'hard_loss' },
      );
      continue;
    }
    if (candidate.playerIdentity !== target.playerIdentity) {
      grades.push({ externalId: target.externalId, outcome: 'FAIL', reason: 'disagreement' });
      continue;
    }
    if (candidate.matchMethod !== target.matchMethod) {
      grades.push(
        input.environment === 'dev'
          ? { externalId: target.externalId, outcome: 'WARN', reason: 'method_changed' }
          : { externalId: target.externalId, outcome: 'FAIL', reason: 'method_changed' },
      );
      continue;
    }
    grades.push({ externalId: target.externalId, outcome: 'PASS' });
  }

  for (const candidate of input.candidateRows) {
    if (!targetExternalIds.has(candidate.externalId)) {
      grades.push({ externalId: candidate.externalId, outcome: 'INFO', reason: 'gained_coverage' });
    }
  }

  return grades;
}

export type AflApiDevRegenerationClassificationProblem =
  | { kind: 'entry_does_not_match_target'; externalId: string }
  | { kind: 'entry_class_not_eligible'; externalId: string; matchMethod: string }
  | { kind: 'entry_not_absent_from_candidate'; externalId: string }
  | { kind: 'entry_collides_in_candidate'; externalId: string };

/**
 * §6.3 point 3's classification-file validator: every entry must equal a target row exactly
 * (provider, identity and method), that row must be absent from the candidate, its method
 * must be the eligible season class, and its identity must not collide with another candidate
 * provider. A stale or wrong entry is a problem in its own right, independent of G3's grading
 * of the target row it names.
 */
export function validateAflApiDevRegenerationClassification(input: {
  entries: readonly AflApiDevRegenerationClassificationEntry[];
  targetRows: readonly AflApiG3Row[];
  candidateRows: readonly AflApiG3Row[];
}): readonly AflApiDevRegenerationClassificationProblem[] {
  const problems: AflApiDevRegenerationClassificationProblem[] = [];
  const targetByExternalId = new Map(input.targetRows.map((r) => [r.externalId, r]));
  const candidateByExternalId = new Map(input.candidateRows.map((r) => [r.externalId, r]));
  const candidateByIdentity = new Map(input.candidateRows.map((r) => [r.playerIdentity, r]));

  for (const entry of input.entries) {
    const target = targetByExternalId.get(entry.externalId);
    if (!target || target.playerIdentity !== entry.playerIdentity || target.matchMethod !== entry.matchMethod) {
      problems.push({ kind: 'entry_does_not_match_target', externalId: entry.externalId });
      continue;
    }
    if (entry.matchMethod !== 'afl_api_stat_vector_season') {
      problems.push({ kind: 'entry_class_not_eligible', externalId: entry.externalId, matchMethod: entry.matchMethod });
      continue;
    }
    if (candidateByExternalId.has(entry.externalId)) {
      problems.push({ kind: 'entry_not_absent_from_candidate', externalId: entry.externalId });
      continue;
    }
    const colliding = candidateByIdentity.get(entry.playerIdentity);
    if (colliding) problems.push({ kind: 'entry_collides_in_candidate', externalId: entry.externalId });
  }
  return problems;
}

export type AflApiDevRegenerationCensusRow = {
  externalId: string;
  playerIdentity: string;
  matchMethod: string;
  status: string;
};

export type AflApiDevRegenerationCensusOutcome =
  | { externalId: string; outcome: 'PASS' }
  | { externalId: string; outcome: 'FAIL'; reason: 'absent' | 'different_identity' | 'different_method_or_status' };

/**
 * §6.3's mandatory post-re-acquisition verification census: every listed entry must again be
 * present, under the same identity, `match_method='afl_api_stat_vector_season'` and
 * `status='unique'`.
 */
export function classifyAflApiDevRegenerationCensus(input: {
  entries: readonly AflApiDevRegenerationClassificationEntry[];
  afterRows: readonly AflApiDevRegenerationCensusRow[];
}): readonly AflApiDevRegenerationCensusOutcome[] {
  const afterByExternalId = new Map(input.afterRows.map((r) => [r.externalId, r]));
  return input.entries.map((entry): AflApiDevRegenerationCensusOutcome => {
    const after = afterByExternalId.get(entry.externalId);
    if (!after) return { externalId: entry.externalId, outcome: 'FAIL', reason: 'absent' };
    if (after.playerIdentity !== entry.playerIdentity) {
      return { externalId: entry.externalId, outcome: 'FAIL', reason: 'different_identity' };
    }
    if (after.matchMethod !== 'afl_api_stat_vector_season' || after.status !== 'unique') {
      return { externalId: entry.externalId, outcome: 'FAIL', reason: 'different_method_or_status' };
    }
    return { externalId: entry.externalId, outcome: 'PASS' };
  });
}

/* ------------------------------------------------------------------ *
 * AFLDB-ISSUE-237 L4 hardening (F-L4-1..F-L4-5): the rebuild marker tag, deterministic state
 * digests, and the two operator files the promotion checker writes and later re-reads. Every
 * format below is written by code and verified by code; none is meant to be hand-authored.
 * ------------------------------------------------------------------ */

/**
 * The format tag every rebuild marker carries (`rebuild_afl_api_adjudications.ts`
 * `CAPTURE_FORMAT`, pinned equal by tests/db-promotion-check.test.ts). A database comment
 * containing it is a pending `db:test:rebuild` capture.
 */
export const AFL_API_REBUILD_MARKER_FORMAT = 'afldb.afl_api_identities.rebuild_capture';

/** True when a DATABASE comment (read with `shobj_description`, F-L4-1) is a rebuild marker. */
export function isAflApiRebuildMarkerComment(comment: unknown): boolean {
  return typeof comment === 'string' && comment.includes(AFL_API_REBUILD_MARKER_FORMAT);
}

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Code-unit order: locale-independent, so every host sorts identically. */
function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export type AflApiImporterStateRow = {
  externalId: string;
  status: string;
  matchMethod: string;
  /** The row's player's forward stable identity (§5/D7), or null when it has none. */
  playerIdentity: string | null;
};

/**
 * SHA-256 of a set of importer rows over STABLE fields only: provider id, status, method and
 * the forward stable identity. No player id and no row id, so the candidate read before the
 * swap and the same database read after it (renamed, overrides replayed) hash equally, and two
 * databases hash equally exactly when they hold the same importer decisions. Order-independent;
 * a repeated provider id refuses (it is a D5 anomaly, never a state to bind).
 */
export function aflApiImporterStateSha256(rows: readonly AflApiImporterStateRow[]): string {
  const sorted = [...rows].sort((a, b) => compareCodeUnits(a.externalId, b.externalId));
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].externalId === sorted[i - 1].externalId) {
      throw new Error(`aflApiImporterStateSha256: provider id ${sorted[i].externalId} appears twice.`);
    }
  }
  return sha256Hex(canonicalJson(sorted.map((r) => [r.externalId, r.status, r.matchMethod, r.playerIdentity])));
}

/**
 * SHA-256 of the `afl_api` adjudication ledger over the fields the promotion reinstatement
 * preserves: row id (reinstated id-preserving), provider id, action, stored stable identity and
 * `supersedes_id`. `player_id` is deliberately excluded — the promotion plan REMAPS it into the
 * candidate's lineage — so the target's ledger read live at `--phase restored` and the same
 * ledger reinstated into the candidate hash equally. A repeated row id refuses.
 *
 * `id` and `supersedes_id` are `bigint`, which postgres.js returns as a STRING unless the
 * reader casts it; both are normalised to a safe integer here, so the checker's reader (which
 * converts) and the replay adapter's (which does not) cannot hash one ledger two ways.
 */
export function aflApiLedgerStateSha256(rows: readonly AflApiAdjudicationLedgerRow[]): string {
  return sha256Hex(canonicalJson(ledgerDigestTuples(rows, 'aflApiLedgerStateSha256')));
}

/**
 * The digest tuples, sorted by id. AFLDB-ISSUE-238 §8.6: a `corrected` row's tuple ALSO binds
 * `previous_player_identity` and `evidence_sha256` -- the fields that define correction
 * authority -- while a `linked`/`revoked` tuple is exactly ISSUE-237's five fields, so a ledger
 * with zero `corrected` rows hashes byte-identically to the ISSUE-237 digest. The structural
 * contract is asserted first (R238-S4-04): a reader that omitted the two new columns makes a
 * corrected row malformed here and fails closed, never hashing `undefined`.
 */
function ledgerDigestTuples(
  rows: readonly AflApiAdjudicationLedgerRow[], label: string,
  /** The caller already validated the WHOLE ledger this subset came from (the corrected-subset
   * digest): a subset alone lacks the superseded rows cross-row validation needs. */
  alreadyValidated = false,
): JsonValue[] {
  if (!alreadyValidated) assertAflApiLedgerStructure(rows);
  const asId = (value: unknown, field: string): number => canonicalAflApiLedgerId(value, label, field);
  const normalised = rows.map((r) => ({
    row: r, id: asId(r.id, 'id'),
    supersedesId: r.supersedesId === null || r.supersedesId === undefined ? null : asId(r.supersedesId, 'supersedes_id'),
  })).sort((a, b) => a.id - b.id);
  for (let i = 1; i < normalised.length; i += 1) {
    if (normalised[i].id === normalised[i - 1].id) throw new Error(`${label}: ledger id ${normalised[i].id} appears twice.`);
  }
  return normalised.map(({ row, id, supersedesId }): JsonValue => {
    const base: JsonValue[] = [id, row.externalId, row.action, row.playerIdentity, supersedesId];
    // Validated above: on a `corrected` row both are well-formed strings.
    return row.action === 'corrected' ? [...base, row.previousPlayerIdentity as string, row.evidenceSha256 as string] : base;
  });
}

/**
 * AFLDB-ISSUE-238 §8.6 (pass 5, P4-08): the corrected-subset digest -- count and sha256 over the
 * `corrected` rows' tuples only. DIAGNOSTIC: it shows which kind of ledger write changed; every
 * gate compares the whole-ledger `aflApiLedgerStateSha256`. The whole ledger is validated first.
 */
export function aflApiCorrectedLedgerStateSha256(
  rows: readonly AflApiAdjudicationLedgerRow[],
): { rowCount: number; sha256: string } {
  assertAflApiLedgerStructure(rows);
  const corrected = rows.filter((r) => r.action === 'corrected');
  return {
    rowCount: corrected.length,
    sha256: sha256Hex(canonicalJson(ledgerDigestTuples(corrected, 'aflApiCorrectedLedgerStateSha256', true))),
  };
}

/** Raised when an operator file is malformed, foreign, stale or tampered. */
export class AflApiPromotionFileRefused extends Error {}

function refuseFile(label: string, why: string): never {
  throw new AflApiPromotionFileRefused(`${label}: ${why}`);
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    refuseFile(label, 'not valid JSON.');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) refuseFile(label, 'not a JSON object.');
  return parsed as Record<string, unknown>;
}

function requireExactKeys(obj: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(obj).sort(compareCodeUnits);
  const expected = [...keys].sort(compareCodeUnits);
  if (actual.length !== expected.length || actual.some((k, i) => k !== expected[i])) {
    refuseFile(label, `unexpected field set [${actual.join(', ')}]; expected exactly [${expected.join(', ')}] — `
      + 'a foreign, older or hand-edited file is refused.');
  }
}

function requireString(obj: Record<string, unknown>, key: string, label: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.trim() === '') refuseFile(label, `${key} must be a non-empty string.`);
  return value;
}

function requireSha256(obj: Record<string, unknown>, key: string, label: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || !SHA256_HEX_RE.test(value)) refuseFile(label, `${key} must be 64 lowercase hex characters.`);
  return value;
}

function requireCount(obj: Record<string, unknown>, key: string, label: string): number {
  const value = obj[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) refuseFile(label, `${key} must be a non-negative integer.`);
  return value;
}

/* --- E_promotion: the bound supersede file (F-L4-4) ----------------------------------------- */

export const AFL_API_SUPERSEDE_FORMAT = 'afldb.afl_api_supersede_expected';
/**
 * Version 1 carried the provider list only and bound nothing; version 2 bound the importer and
 * ledger digests but not the ISSUE-238 corrected-replay prediction. Both are refused as stale.
 * Version 3 (AFLDB-ISSUE-238 §9.1) bound the corrected-replay prediction and is ALWAYS written, even with zero
 * corrected providers. Version 4 adds `pendingD15Providers` (the exact net-linked providers D15 materialises
 * after the swap), which the stage-aware pre-swap contract (`applyAflApiPendingD15`) and the post-swap D15
 * replay are bound to; a v3 file carries no such binding and is refused as stale.
 */
export const AFL_API_SUPERSEDE_VERSION = 4;

// Temporary S6-D3 gates, owned by Slice 11 / the S6-D2 freeze binding: a prod promotion carrying corrected replays is refused until they are lifted.
export const CORRECTED_PROMOTION_REHEARSAL_REQUIRED = 'CORRECTED_PROMOTION_REHEARSAL_REQUIRED';
export const CORRECTED_PROMOTION_REQUIRES_FREEZE = 'CORRECTED_PROMOTION_REQUIRES_FREEZE';

/** AFLDB-ISSUE-238 §9.1 candidate classes 1-3 (the CPC table) and the replay each predicts. */
export type AflApiCorrectedReplayClass = 1 | 2 | 3;
export type AflApiCorrectedReplayAction = 'update_in_place' | 'upgrade_in_place' | 'insert';

const CORRECTED_REPLAY_ACTION_BY_CLASS: Readonly<Record<AflApiCorrectedReplayClass, AflApiCorrectedReplayAction>> = {
  1: 'update_in_place', 2: 'upgrade_in_place', 3: 'insert',
};

export type AflApiPredictedMutationCounts = { player_match_stats: number; brownlow_round_votes: number };

/** One C_promotion provider's predicted correction replay (AFLDB-ISSUE-238 §9.1). */
export type AflApiCorrectedReplayEntry = {
  externalId: string;
  adjudicationId: number;
  adjudicationEvidenceSha256: string;
  previousPlayerIdentity: string;
  playerIdentity: string;
  candidateClass: AflApiCorrectedReplayClass;
  predictedIdentityAction: AflApiCorrectedReplayAction;
  plannerVersion: number;
  predictedClosureFingerprint: string;
  predictedMutations: { moved: AflApiPredictedMutationCounts; deleted: AflApiPredictedMutationCounts };
};

/** One row of the candidate's whole `afl_api` identity state: stable fields only, never a player id. */
export type AflApiIdentityStateRow = {
  externalId: string;
  status: string;
  matchMethod: string;
  /** The row's player's forward stable identity, or null when it has none. */
  playerIdentity: string | null;
};

/**
 * AFLDB-ISSUE-238 §9.1 post-replay PREDICTION of the candidate importer state: the pre-replay
 * rows minus every provider in C_promotion (class 1/2 rows leave the importer set by becoming
 * `resolved`; a class-3 provider had no importer row). Count and sha256 use
 * `aflApiImporterStateSha256`, the one importer canonicalisation. A class-1/2 entry with no
 * pre-replay row, or a class-3 entry WITH one, is a contradiction and refuses.
 */
export function predictAflApiPostReplayImporterState(
  preReplayImporterRows: readonly AflApiImporterStateRow[],
  cPromotion: readonly Pick<AflApiCorrectedReplayEntry, 'externalId' | 'candidateClass'>[],
): { rowCount: number; sha256: string } {
  const byId = new Set(preReplayImporterRows.map((r) => r.externalId));
  const promoted = new Set<string>();
  for (const entry of cPromotion) {
    if (promoted.has(entry.externalId)) {
      throw new Error(`predictAflApiPostReplayImporterState: provider ${entry.externalId} appears twice in C_promotion.`);
    }
    promoted.add(entry.externalId);
    const hasRow = byId.has(entry.externalId);
    if (entry.candidateClass === 3 ? hasRow : !hasRow) {
      throw new Error(`predictAflApiPostReplayImporterState: class ${entry.candidateClass} provider ${entry.externalId} `
        + `${hasRow ? 'unexpectedly has a' : 'has no'} pre-replay importer row.`);
    }
  }
  const remaining = preReplayImporterRows.filter((r) => !promoted.has(r.externalId));
  return { rowCount: remaining.length, sha256: aflApiImporterStateSha256(remaining) };
}

/**
 * SHA-256 over the candidate's WHOLE `afl_api` identity state: per row `(external_id, status,
 * match_method, stable identity)` sorted by external_id (code-unit order). No player id, no row
 * id. A repeated provider id refuses. It covers importer AND resolved rows, so a class-3 insert
 * changes it while leaving `aflApiImporterStateSha256` of the importer subset untouched.
 */
export function aflApiIdentityStateSha256(rows: readonly AflApiIdentityStateRow[]): string {
  const sorted = [...rows].sort((a, b) => compareCodeUnits(a.externalId, b.externalId));
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].externalId === sorted[i - 1].externalId) {
      throw new Error(`aflApiIdentityStateSha256: provider id ${sorted[i].externalId} appears twice.`);
    }
  }
  return sha256Hex(canonicalJson(sorted.map((r) => [r.externalId, r.status, r.matchMethod, r.playerIdentity])));
}

/**
 * The identity digest AFTER the D15 correction replay. Mirrors the write shape of
 * `replayAflApiAdjudications` (`tools/migration/replay_afl_api_adjudications.ts:460-482`): an
 * INSERT (class 3) and an in-place UPDATE (class 1/2) both leave `status = 'resolved'`,
 * `match_method = afl_api_admin_adjudication`, the player being the entry's `playerIdentity`.
 */
export function predictAflApiPostReplayIdentityState(
  preReplayIdentityRows: readonly AflApiIdentityStateRow[],
  correctedReplays: readonly Pick<AflApiCorrectedReplayEntry, 'externalId' | 'candidateClass' | 'playerIdentity'>[],
): { rowCount: number; sha256: string } {
  const rows = new Map<string, AflApiIdentityStateRow>();
  for (const r of preReplayIdentityRows) {
    if (rows.has(r.externalId)) {
      throw new Error(`predictAflApiPostReplayIdentityState: provider id ${r.externalId} appears twice.`);
    }
    rows.set(r.externalId, r);
  }
  const seen = new Set<string>();
  for (const entry of correctedReplays) {
    if (seen.has(entry.externalId)) {
      throw new Error(`predictAflApiPostReplayIdentityState: provider ${entry.externalId} appears twice in C_promotion.`);
    }
    seen.add(entry.externalId);
    const hasRow = rows.has(entry.externalId);
    if (entry.candidateClass === 3 ? hasRow : !hasRow) {
      throw new Error(`predictAflApiPostReplayIdentityState: class ${entry.candidateClass} provider ${entry.externalId} `
        + `${hasRow ? 'unexpectedly has a' : 'has no'} pre-replay identity row.`);
    }
    rows.set(entry.externalId, {
      externalId: entry.externalId, status: 'resolved', matchMethod: AFL_API_ADMIN_MATCH_METHOD,
      playerIdentity: entry.playerIdentity,
    });
  }
  return { rowCount: rows.size, sha256: aflApiIdentityStateSha256([...rows.values()]) };
}

/**
 * What E_promotion was derived FROM, at `--phase restored`: the candidate's importer state
 * (the side importer rows come from and identities are remapped against) and the target's
 * durable human ledger (the side the ledger comes from), plus the names of both databases.
 */
export type AflApiSupersedeBinding = {
  environment: 'prod' | 'dev';
  candidateDatabase: string;
  targetDatabase: string;
  candidateImporterRowCount: number;
  candidateImporterSha256: string;
  targetLedgerRowCount: number;
  targetLedgerSha256: string;
};

export type AflApiSupersedeFile = AflApiSupersedeBinding & {
  issue: 'AFLDB-ISSUE-237';
  format: typeof AFL_API_SUPERSEDE_FORMAT;
  version: typeof AFL_API_SUPERSEDE_VERSION;
  /** E_promotion = G2.AGREE, sorted in code-unit order, no duplicates. May be empty. */
  expectedSupersedes: readonly string[];
  /** Corrected-subset digest of the target ledger at §6 (diagnostic; gates compare the whole ledger). */
  targetCorrectedLedgerRowCount: number;
  targetCorrectedLedgerSha256: string;
  /** C_promotion's predicted replays, sorted by externalId, disjoint from `expectedSupersedes`. May be empty. */
  correctedReplays: readonly AflApiCorrectedReplayEntry[];
  /** Candidate importer state after replay (pre-replay minus the class-1/2 providers). */
  predictedPostReplayImporterRowCount: number;
  predictedPostReplayImporterSha256: string;
  /** = correctedReplays.length (the candidate held zero `resolved` rows at §6). */
  predictedPostReplayResolvedRowCount: number;
  /** `aflApiIdentityStateSha256` of the candidate's whole `afl_api` identity state after replay. */
  predictedPostReplayIdentitySha256: string;
  /**
   * AFLDB-ISSUE-238 (v4): the EXACT net-linked providers that stay without a resolved row until D15 runs after
   * the swap, each bound to its net ledger row and stable identity. Sorted by externalId, disjoint from
   * `correctedReplays`; its `supersede` entries equal `expectedSupersedes`. May be empty.
   */
  pendingD15Providers: readonly AflApiPendingD15Entry[];
  /** SHA-256 of the canonical JSON of every other field. */
  payloadSha256: string;
};

const PENDING_D15_ENTRY_KEYS = ['externalId', 'adjudicationId', 'playerIdentity', 'd15Action'] as const;

const SUPERSEDE_FILE_KEYS = [
  'issue', 'format', 'version', 'environment', 'candidateDatabase', 'targetDatabase',
  'candidateImporterRowCount', 'candidateImporterSha256', 'targetLedgerRowCount', 'targetLedgerSha256',
  'expectedSupersedes', 'targetCorrectedLedgerRowCount', 'targetCorrectedLedgerSha256', 'correctedReplays',
  'predictedPostReplayImporterRowCount', 'predictedPostReplayImporterSha256',
  'predictedPostReplayResolvedRowCount', 'predictedPostReplayIdentitySha256', 'pendingD15Providers', 'payloadSha256',
] as const;

const CORRECTED_REPLAY_ENTRY_KEYS = [
  'externalId', 'adjudicationId', 'adjudicationEvidenceSha256', 'previousPlayerIdentity', 'playerIdentity',
  'candidateClass', 'predictedIdentityAction', 'plannerVersion', 'predictedClosureFingerprint', 'predictedMutations',
] as const;
const PREDICTED_MUTATIONS_KEYS = ['moved', 'deleted'] as const;
const PREDICTED_MUTATION_COUNT_KEYS = ['player_match_stats', 'brownlow_round_votes'] as const;

function correctedReplayEntryJson(e: AflApiCorrectedReplayEntry): JsonValue {
  const counts = (c: AflApiPredictedMutationCounts): JsonValue => ({
    player_match_stats: c.player_match_stats, brownlow_round_votes: c.brownlow_round_votes,
  });
  return {
    externalId: e.externalId, adjudicationId: e.adjudicationId,
    adjudicationEvidenceSha256: e.adjudicationEvidenceSha256,
    previousPlayerIdentity: e.previousPlayerIdentity, playerIdentity: e.playerIdentity,
    candidateClass: e.candidateClass, predictedIdentityAction: e.predictedIdentityAction,
    plannerVersion: e.plannerVersion, predictedClosureFingerprint: e.predictedClosureFingerprint,
    predictedMutations: { moved: counts(e.predictedMutations.moved), deleted: counts(e.predictedMutations.deleted) },
  };
}

function supersedePayloadSha256(file: Omit<AflApiSupersedeFile, 'payloadSha256'>): string {
  return sha256Hex(canonicalJson({
    issue: file.issue, format: file.format, version: file.version, environment: file.environment,
    candidateDatabase: file.candidateDatabase, targetDatabase: file.targetDatabase,
    candidateImporterRowCount: file.candidateImporterRowCount, candidateImporterSha256: file.candidateImporterSha256,
    targetLedgerRowCount: file.targetLedgerRowCount, targetLedgerSha256: file.targetLedgerSha256,
    expectedSupersedes: [...file.expectedSupersedes],
    targetCorrectedLedgerRowCount: file.targetCorrectedLedgerRowCount,
    targetCorrectedLedgerSha256: file.targetCorrectedLedgerSha256,
    correctedReplays: file.correctedReplays.map(correctedReplayEntryJson),
    predictedPostReplayImporterRowCount: file.predictedPostReplayImporterRowCount,
    predictedPostReplayImporterSha256: file.predictedPostReplayImporterSha256,
    predictedPostReplayResolvedRowCount: file.predictedPostReplayResolvedRowCount,
    predictedPostReplayIdentitySha256: file.predictedPostReplayIdentitySha256,
    pendingD15Providers: file.pendingD15Providers.map((e) => ({
      externalId: e.externalId, adjudicationId: e.adjudicationId, playerIdentity: e.playerIdentity, d15Action: e.d15Action,
    })),
  }));
}

function requirePositiveInt(obj: Record<string, unknown>, key: string, label: string): number {
  const value = obj[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) refuseFile(label, `${key} must be a positive integer.`);
  return value;
}

function asRecord(value: unknown, label: string, what: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) refuseFile(label, `${what} must be an object.`);
  return value as Record<string, unknown>;
}

function requireMutationCounts(value: unknown, label: string, what: string): AflApiPredictedMutationCounts {
  const obj = asRecord(value, label, what);
  requireExactKeys(obj, PREDICTED_MUTATION_COUNT_KEYS, `${label} ${what}`);
  return {
    player_match_stats: requireCount(obj, 'player_match_stats', `${label} ${what}`),
    brownlow_round_votes: requireCount(obj, 'brownlow_round_votes', `${label} ${what}`),
  };
}

function requireCorrectedReplays(value: unknown, label: string): AflApiCorrectedReplayEntry[] {
  if (!Array.isArray(value)) refuseFile(label, 'correctedReplays must be an array.');
  const entries = value.map((raw, i): AflApiCorrectedReplayEntry => {
    const where = `${label} correctedReplays[${i}]`;
    const obj = asRecord(raw, label, `correctedReplays[${i}]`);
    requireExactKeys(obj, CORRECTED_REPLAY_ENTRY_KEYS, where);
    const externalId = requireString(obj, 'externalId', where);
    if (!AFL_API_PROVIDER_ID_RE.test(externalId)) refuseFile(where, 'externalId must be an afl_api provider id (CD_I<digits>).');
    const candidateClass = obj.candidateClass;
    if (candidateClass !== 1 && candidateClass !== 2 && candidateClass !== 3) refuseFile(where, 'candidateClass must be 1, 2 or 3.');
    const action = obj.predictedIdentityAction;
    if (action !== 'update_in_place' && action !== 'upgrade_in_place' && action !== 'insert') {
      refuseFile(where, 'predictedIdentityAction must be update_in_place, upgrade_in_place or insert.');
    }
    if (CORRECTED_REPLAY_ACTION_BY_CLASS[candidateClass] !== action) {
      refuseFile(where, `candidateClass ${candidateClass} requires predictedIdentityAction ${CORRECTED_REPLAY_ACTION_BY_CLASS[candidateClass]}, not ${action}.`);
    }
    const mutations = asRecord(obj.predictedMutations, label, `correctedReplays[${i}].predictedMutations`);
    requireExactKeys(mutations, PREDICTED_MUTATIONS_KEYS, `${where} predictedMutations`);
    const moved = requireMutationCounts(mutations.moved, where, 'predictedMutations.moved');
    const deleted = requireMutationCounts(mutations.deleted, where, 'predictedMutations.deleted');
    if (candidateClass === 2 && (moved.player_match_stats + moved.brownlow_round_votes
      + deleted.player_match_stats + deleted.brownlow_round_votes) !== 0) {
      refuseFile(where, 'a class 2 (identity-only upgrade) entry must predict zero moved and zero deleted rows.');
    }
    return {
      externalId,
      adjudicationId: requirePositiveInt(obj, 'adjudicationId', where),
      adjudicationEvidenceSha256: requireSha256(obj, 'adjudicationEvidenceSha256', where),
      previousPlayerIdentity: requireString(obj, 'previousPlayerIdentity', where),
      playerIdentity: requireString(obj, 'playerIdentity', where),
      candidateClass, predictedIdentityAction: action,
      plannerVersion: requirePositiveInt(obj, 'plannerVersion', where),
      predictedClosureFingerprint: requireSha256(obj, 'predictedClosureFingerprint', where),
      predictedMutations: { moved, deleted },
    };
  });
  for (let i = 1; i < entries.length; i += 1) {
    if (compareCodeUnits(entries[i - 1].externalId, entries[i].externalId) >= 0) {
      refuseFile(label, 'correctedReplays must be sorted by externalId and free of duplicates.');
    }
  }
  return entries;
}

function requirePendingD15(value: unknown, label: string): AflApiPendingD15Entry[] {
  if (!Array.isArray(value)) refuseFile(label, 'pendingD15Providers must be an array.');
  const entries = value.map((raw, i): AflApiPendingD15Entry => {
    const where = `${label} pendingD15Providers[${i}]`;
    const obj = asRecord(raw, label, `pendingD15Providers[${i}]`);
    requireExactKeys(obj, PENDING_D15_ENTRY_KEYS, where);
    const externalId = requireString(obj, 'externalId', where);
    if (!AFL_API_PROVIDER_ID_RE.test(externalId)) refuseFile(where, 'externalId must be an afl_api provider id (CD_I<digits>).');
    const d15Action = obj.d15Action;
    if (d15Action !== 'insert' && d15Action !== 'supersede') refuseFile(where, 'd15Action must be insert or supersede.');
    return {
      externalId, adjudicationId: requirePositiveInt(obj, 'adjudicationId', where),
      playerIdentity: requireString(obj, 'playerIdentity', where), d15Action,
    };
  });
  for (let i = 1; i < entries.length; i += 1) {
    if (compareCodeUnits(entries[i - 1].externalId, entries[i].externalId) >= 0) {
      refuseFile(label, 'pendingD15Providers must be sorted by externalId and free of duplicates.');
    }
  }
  return entries;
}

/**
 * Cross-field contract shared by the builder (through the parser round-trip) and the reader:
 * disjointness from E_promotion, the resolved-row count, and the zero-corrected parity rule.
 */
function assertSupersedeConsistency(file: AflApiSupersedeFile, label: string): void {
  const supersedes = new Set(file.expectedSupersedes);
  for (const entry of file.correctedReplays) {
    if (supersedes.has(entry.externalId)) {
      refuseFile(label, `correctedReplays provider ${entry.externalId} is also in expectedSupersedes; C_promotion must be disjoint from E_promotion.`);
    }
  }
  // AFLDB-ISSUE-238 (v4): the pending-D15 set is disjoint from C_promotion, and its `supersede` entries ARE E_promotion.
  const pendingSupersedes = file.pendingD15Providers.filter((e) => e.d15Action === 'supersede').map((e) => e.externalId);
  for (const entry of file.pendingD15Providers) {
    if (file.correctedReplays.some((c) => c.externalId === entry.externalId)) {
      refuseFile(label, `pendingD15Providers provider ${entry.externalId} is also in correctedReplays; a corrected provider can never be pending D15.`);
    }
  }
  if (pendingSupersedes.length !== supersedes.size || pendingSupersedes.some((id) => !supersedes.has(id))) {
    refuseFile(label, 'the pendingD15Providers entries with d15Action supersede must equal expectedSupersedes exactly.');
  }
  if (file.predictedPostReplayResolvedRowCount !== file.correctedReplays.length) {
    refuseFile(label, `predictedPostReplayResolvedRowCount ${file.predictedPostReplayResolvedRowCount} must equal the correctedReplays length ${file.correctedReplays.length}.`);
  }
  if (file.targetCorrectedLedgerRowCount < file.correctedReplays.length) {
    refuseFile(label, `targetCorrectedLedgerRowCount ${file.targetCorrectedLedgerRowCount} is below the ${file.correctedReplays.length} corrected replays it must cover.`);
  }
  const leavingImporterSet = file.correctedReplays.filter((e) => e.candidateClass !== 3).length;
  if (file.predictedPostReplayImporterRowCount !== file.candidateImporterRowCount - leavingImporterSet) {
    refuseFile(label, `predictedPostReplayImporterRowCount ${file.predictedPostReplayImporterRowCount} must equal candidateImporterRowCount ${file.candidateImporterRowCount} minus the ${leavingImporterSet} class 1/2 replays.`);
  }
  if (leavingImporterSet === 0 && file.predictedPostReplayImporterSha256 !== file.candidateImporterSha256) {
    refuseFile(label, 'with no class 1/2 replay the predicted post-replay importer sha256 must equal the pre-replay candidateImporterSha256.');
  }
  // Deliberately NOT forced to the empty-set digest when correctedReplays is empty: a target can hold
  // corrected rows that a later revoke nets away, so the corrected-subset digest is diagnostic
  // only (§9.1). The ledger-wide gates compare targetLedger*.
}

function requireProviderList(value: unknown, label: string, key: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !AFL_API_PROVIDER_ID_RE.test(v))) {
    refuseFile(label, `${key} must be an array of afl_api provider ids (CD_I<digits>).`);
  }
  const list = value as string[];
  for (let i = 1; i < list.length; i += 1) {
    if (compareCodeUnits(list[i - 1], list[i]) >= 0) refuseFile(label, `${key} must be sorted and free of duplicates.`);
  }
  return list;
}

/** The only writer of a supersede file's content: deterministic for a given binding and set. */
export type AflApiSupersedeBuildInput = AflApiSupersedeBinding & {
  expectedSupersedes: Iterable<string>;
  targetCorrectedLedgerRowCount: number;
  targetCorrectedLedgerSha256: string;
  /** Sorted by externalId here; duplicates are refused by the parser round-trip. Empty when no corrected provider. */
  correctedReplays: Iterable<AflApiCorrectedReplayEntry>;
  predictedPostReplayImporterRowCount: number;
  predictedPostReplayImporterSha256: string;
  predictedPostReplayIdentitySha256: string;
  /** AFLDB-ISSUE-238 (v4): see `deriveAflApiPendingD15`. Sorted here; duplicates are refused by the parser round-trip. */
  pendingD15Providers: Iterable<AflApiPendingD15Entry>;
};

export function buildAflApiSupersedeFile(input: AflApiSupersedeBuildInput): AflApiSupersedeFile {
  const expectedSupersedes = [...new Set(input.expectedSupersedes)].sort(compareCodeUnits);
  const correctedReplays = [...input.correctedReplays].sort((a, b) => compareCodeUnits(a.externalId, b.externalId));
  const draft: Omit<AflApiSupersedeFile, 'payloadSha256'> = {
    issue: 'AFLDB-ISSUE-237', format: AFL_API_SUPERSEDE_FORMAT, version: AFL_API_SUPERSEDE_VERSION,
    environment: input.environment, candidateDatabase: input.candidateDatabase, targetDatabase: input.targetDatabase,
    candidateImporterRowCount: input.candidateImporterRowCount, candidateImporterSha256: input.candidateImporterSha256,
    targetLedgerRowCount: input.targetLedgerRowCount, targetLedgerSha256: input.targetLedgerSha256,
    expectedSupersedes,
    targetCorrectedLedgerRowCount: input.targetCorrectedLedgerRowCount,
    targetCorrectedLedgerSha256: input.targetCorrectedLedgerSha256,
    correctedReplays,
    predictedPostReplayImporterRowCount: input.predictedPostReplayImporterRowCount,
    predictedPostReplayImporterSha256: input.predictedPostReplayImporterSha256,
    predictedPostReplayResolvedRowCount: correctedReplays.length,
    predictedPostReplayIdentitySha256: input.predictedPostReplayIdentitySha256,
    pendingD15Providers: [...input.pendingD15Providers].sort((a, b) => compareCodeUnits(a.externalId, b.externalId)),
  };
  // Round-trip through the strict parser, so a writer can never emit what a reader refuses.
  const file: AflApiSupersedeFile = { ...draft, payloadSha256: supersedePayloadSha256(draft) };
  return parseAflApiSupersedeFile(JSON.stringify(file));
}

/** Strict: exact field set, exact format/version, well-formed values, and an untampered payload. */
export function parseAflApiSupersedeFile(text: string, label = 'afl_api supersede file'): AflApiSupersedeFile {
  const obj = parseJsonObject(text, label);
  if (obj.issue !== 'AFLDB-ISSUE-237' || obj.format !== AFL_API_SUPERSEDE_FORMAT) {
    refuseFile(label, `not an ${AFL_API_SUPERSEDE_FORMAT} file.`);
  }
  // Version BEFORE the key set: a v1/v2 file lacks the v3 keys, and must be refused as STALE by name.
  if (obj.version !== AFL_API_SUPERSEDE_VERSION) {
    refuseFile(label, `stale supersede file: version ${String(obj.version)} is not ${AFL_API_SUPERSEDE_VERSION}; `
      + 'a v1, v2 or v3 file (no corrected-replay or pending-D15 binding) is refused — regenerate it with the current build.');
  }
  requireExactKeys(obj, SUPERSEDE_FILE_KEYS, label);
  if (obj.environment !== 'prod' && obj.environment !== 'dev') refuseFile(label, 'environment must be prod or dev.');
  const file: AflApiSupersedeFile = {
    issue: 'AFLDB-ISSUE-237', format: AFL_API_SUPERSEDE_FORMAT, version: AFL_API_SUPERSEDE_VERSION,
    environment: obj.environment,
    candidateDatabase: requireString(obj, 'candidateDatabase', label),
    targetDatabase: requireString(obj, 'targetDatabase', label),
    candidateImporterRowCount: requireCount(obj, 'candidateImporterRowCount', label),
    candidateImporterSha256: requireSha256(obj, 'candidateImporterSha256', label),
    targetLedgerRowCount: requireCount(obj, 'targetLedgerRowCount', label),
    targetLedgerSha256: requireSha256(obj, 'targetLedgerSha256', label),
    expectedSupersedes: requireProviderList(obj.expectedSupersedes, label, 'expectedSupersedes'),
    targetCorrectedLedgerRowCount: requireCount(obj, 'targetCorrectedLedgerRowCount', label),
    targetCorrectedLedgerSha256: requireSha256(obj, 'targetCorrectedLedgerSha256', label),
    correctedReplays: requireCorrectedReplays(obj.correctedReplays, label),
    predictedPostReplayImporterRowCount: requireCount(obj, 'predictedPostReplayImporterRowCount', label),
    predictedPostReplayImporterSha256: requireSha256(obj, 'predictedPostReplayImporterSha256', label),
    predictedPostReplayResolvedRowCount: requireCount(obj, 'predictedPostReplayResolvedRowCount', label),
    predictedPostReplayIdentitySha256: requireSha256(obj, 'predictedPostReplayIdentitySha256', label),
    pendingD15Providers: requirePendingD15(obj.pendingD15Providers, label),
    payloadSha256: requireSha256(obj, 'payloadSha256', label),
  };
  // Payload hash first: a tampered file is reported as tampered, not as a cross-field inconsistency.
  if (supersedePayloadSha256(file) !== file.payloadSha256) {
    refuseFile(label, 'payloadSha256 does not match the file content — refusing a tampered or hand-edited file.');
  }
  assertSupersedeConsistency(file, label);
  return file;
}

export type AflApiBindingProblem =
  | { kind: 'environment_mismatch'; bound: string; actual: string }
  | { kind: 'candidate_database_mismatch'; bound: string; actual: string }
  | { kind: 'target_database_mismatch'; bound: string; actual: string }
  | { kind: 'importer_state_mismatch'; side: 'candidate' | 'target'; boundRowCount?: number; actualRowCount?: number; boundSha256: string; actualSha256: string }
  | { kind: 'ledger_state_mismatch'; boundRowCount: number; actualRowCount: number; boundSha256: string; actualSha256: string };

/**
 * Whether a supersede file belongs to the database state now in front of the caller. Every
 * caller supplies the environment, the target name and both digests it can compute; the
 * candidate NAME is supplied only where it is still observable (`--phase candidate`), because
 * after the swap the candidate has been renamed to the target.
 */
export function aflApiSupersedeBindingProblems(file: AflApiSupersedeFile, actual: {
  environment: string;
  targetDatabase: string;
  candidateDatabase?: string;
  importer: { rowCount: number; sha256: string };
  ledger: { rowCount: number; sha256: string };
}): readonly AflApiBindingProblem[] {
  const problems: AflApiBindingProblem[] = [];
  if (file.environment !== actual.environment) {
    problems.push({ kind: 'environment_mismatch', bound: file.environment, actual: actual.environment });
  }
  if (file.targetDatabase !== actual.targetDatabase) {
    problems.push({ kind: 'target_database_mismatch', bound: file.targetDatabase, actual: actual.targetDatabase });
  }
  if (actual.candidateDatabase !== undefined && file.candidateDatabase !== actual.candidateDatabase) {
    problems.push({ kind: 'candidate_database_mismatch', bound: file.candidateDatabase, actual: actual.candidateDatabase });
  }
  if (file.candidateImporterRowCount !== actual.importer.rowCount || file.candidateImporterSha256 !== actual.importer.sha256) {
    problems.push({
      kind: 'importer_state_mismatch', side: 'candidate',
      boundRowCount: file.candidateImporterRowCount, actualRowCount: actual.importer.rowCount,
      boundSha256: file.candidateImporterSha256, actualSha256: actual.importer.sha256,
    });
  }
  if (file.targetLedgerRowCount !== actual.ledger.rowCount || file.targetLedgerSha256 !== actual.ledger.sha256) {
    problems.push({
      kind: 'ledger_state_mismatch',
      boundRowCount: file.targetLedgerRowCount, actualRowCount: actual.ledger.rowCount,
      boundSha256: file.targetLedgerSha256, actualSha256: actual.ledger.sha256,
    });
  }
  return problems;
}

/* --- The DEV regeneration classification (§6.3 point 3; F-L4-5) ----------------------------- */

export const AFL_API_DEV_REGENERATION_FORMAT = 'afldb.afl_api_dev_regeneration_classification';
/**
 * Version 1 hashed only `{database, season, entries}`, left `reason`/`reacquisitionPlan` outside
 * the hash, bound no compared state and had no generator; it is refused as stale.
 */
export const AFL_API_DEV_REGENERATION_VERSION = 2;

export type AflApiDevRegenerationClassification = {
  format: typeof AFL_API_DEV_REGENERATION_FORMAT;
  version: typeof AFL_API_DEV_REGENERATION_VERSION;
  /** The DEV target the lost rows belong to (and the database the post-re-acquisition census reads). */
  database: string;
  candidateDatabase: string;
  season: number;
  reason: string;
  reacquisitionPlan: string;
  /** The two importer states G3 compared when the file was generated. */
  targetImporterSha256: string;
  candidateImporterSha256: string;
  /** Sorted by provider id; `afl_api_stat_vector_season` rows only. */
  entries: readonly AflApiDevRegenerationClassificationEntry[];
  payloadSha256: string;
};

const DEV_REGENERATION_KEYS = [
  'format', 'version', 'database', 'candidateDatabase', 'season', 'reason', 'reacquisitionPlan',
  'targetImporterSha256', 'candidateImporterSha256', 'entries', 'payloadSha256',
] as const;

function devRegenerationPayloadSha256(file: Omit<AflApiDevRegenerationClassification, 'payloadSha256'>): string {
  return sha256Hex(canonicalJson({
    format: file.format, version: file.version, database: file.database, candidateDatabase: file.candidateDatabase,
    season: file.season, reason: file.reason, reacquisitionPlan: file.reacquisitionPlan,
    targetImporterSha256: file.targetImporterSha256, candidateImporterSha256: file.candidateImporterSha256,
    entries: file.entries.map((e) => ({ externalId: e.externalId, playerIdentity: e.playerIdentity, matchMethod: e.matchMethod })),
  }));
}

/** Strict: exact fields, v2 only, eligible class only, sorted unique entries, untampered payload. */
export function parseAflApiDevRegenerationClassification(
  text: string, label = 'afl_api DEV regeneration classification',
): AflApiDevRegenerationClassification {
  const obj = parseJsonObject(text, label);
  requireExactKeys(obj, DEV_REGENERATION_KEYS, label);
  if (obj.format !== AFL_API_DEV_REGENERATION_FORMAT) refuseFile(label, `not an ${AFL_API_DEV_REGENERATION_FORMAT} file.`);
  if (obj.version !== AFL_API_DEV_REGENERATION_VERSION) {
    refuseFile(label, `version ${String(obj.version)} is not ${AFL_API_DEV_REGENERATION_VERSION}; an unbound older file is stale.`);
  }
  const season = obj.season;
  if (typeof season !== 'number' || !Number.isInteger(season) || season < 1897 || season > 2999) {
    refuseFile(label, 'season must be a four-digit year.');
  }
  if (!Array.isArray(obj.entries)) refuseFile(label, 'entries must be an array.');
  const entries: AflApiDevRegenerationClassificationEntry[] = [];
  for (const raw of obj.entries as unknown[]) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) refuseFile(label, 'every entry must be an object.');
    const entry = raw as Record<string, unknown>;
    requireExactKeys(entry, ['externalId', 'playerIdentity', 'matchMethod'], `${label} entry`);
    const externalId = requireString(entry, 'externalId', label);
    if (!AFL_API_PROVIDER_ID_RE.test(externalId)) refuseFile(label, `entry ${externalId} is not an afl_api provider id.`);
    const matchMethod = requireString(entry, 'matchMethod', label);
    if (matchMethod !== 'afl_api_stat_vector_season') {
      refuseFile(label, `entry ${externalId} is ${matchMethod}; only afl_api_stat_vector_season rows may be classified.`);
    }
    entries.push({ externalId, playerIdentity: requireString(entry, 'playerIdentity', label), matchMethod });
  }
  for (let i = 1; i < entries.length; i += 1) {
    if (compareCodeUnits(entries[i - 1].externalId, entries[i].externalId) >= 0) {
      refuseFile(label, 'entries must be sorted by externalId and free of duplicates.');
    }
  }
  const file: AflApiDevRegenerationClassification = {
    format: AFL_API_DEV_REGENERATION_FORMAT, version: AFL_API_DEV_REGENERATION_VERSION,
    database: requireString(obj, 'database', label),
    candidateDatabase: requireString(obj, 'candidateDatabase', label),
    season,
    reason: requireString(obj, 'reason', label),
    reacquisitionPlan: requireString(obj, 'reacquisitionPlan', label),
    targetImporterSha256: requireSha256(obj, 'targetImporterSha256', label),
    candidateImporterSha256: requireSha256(obj, 'candidateImporterSha256', label),
    entries,
    payloadSha256: requireSha256(obj, 'payloadSha256', label),
  };
  if (devRegenerationPayloadSha256(file) !== file.payloadSha256) {
    refuseFile(label, 'payloadSha256 does not match the file content — refusing a tampered or hand-edited classification.');
  }
  return file;
}

/** The only writer of a classification's content (`--afl-api-dev-regeneration-out`). */
export function buildAflApiDevRegenerationClassification(
  input: Omit<AflApiDevRegenerationClassification, 'format' | 'version' | 'payloadSha256' | 'entries'> & {
    entries: readonly AflApiDevRegenerationClassificationEntry[];
  },
): AflApiDevRegenerationClassification {
  const draft: Omit<AflApiDevRegenerationClassification, 'payloadSha256'> = {
    format: AFL_API_DEV_REGENERATION_FORMAT, version: AFL_API_DEV_REGENERATION_VERSION,
    database: input.database, candidateDatabase: input.candidateDatabase, season: input.season,
    reason: input.reason, reacquisitionPlan: input.reacquisitionPlan,
    targetImporterSha256: input.targetImporterSha256, candidateImporterSha256: input.candidateImporterSha256,
    entries: [...input.entries]
      .map((e) => ({ externalId: e.externalId, playerIdentity: e.playerIdentity, matchMethod: e.matchMethod }))
      .sort((a, b) => compareCodeUnits(a.externalId, b.externalId)),
  };
  return parseAflApiDevRegenerationClassification(
    JSON.stringify({ ...draft, payloadSha256: devRegenerationPayloadSha256(draft) }));
}

/**
 * Whether a classification belongs to the compared states. `--phase restored` supplies all of
 * them; the post-re-acquisition census supplies only the target name (both importer states have
 * legitimately moved on by then).
 */
export function aflApiDevRegenerationBindingProblems(file: AflApiDevRegenerationClassification, actual: {
  targetDatabase: string;
  candidateDatabase?: string;
  targetImporterSha256?: string;
  candidateImporterSha256?: string;
}): readonly AflApiBindingProblem[] {
  const problems: AflApiBindingProblem[] = [];
  if (file.database !== actual.targetDatabase) {
    problems.push({ kind: 'target_database_mismatch', bound: file.database, actual: actual.targetDatabase });
  }
  if (actual.candidateDatabase !== undefined && file.candidateDatabase !== actual.candidateDatabase) {
    problems.push({ kind: 'candidate_database_mismatch', bound: file.candidateDatabase, actual: actual.candidateDatabase });
  }
  if (actual.targetImporterSha256 !== undefined && file.targetImporterSha256 !== actual.targetImporterSha256) {
    problems.push({ kind: 'importer_state_mismatch', side: 'target', boundSha256: file.targetImporterSha256, actualSha256: actual.targetImporterSha256 });
  }
  if (actual.candidateImporterSha256 !== undefined && file.candidateImporterSha256 !== actual.candidateImporterSha256) {
    problems.push({ kind: 'importer_state_mismatch', side: 'candidate', boundSha256: file.candidateImporterSha256, actualSha256: actual.candidateImporterSha256 });
  }
  return problems;
}

/**
 * The generator's selection rule, from G3's OWN grades (no second classifier): every G3 `FAIL
 * (hard_loss)` of a target row whose method is `afl_api_stat_vector_season` becomes an entry,
 * copied from the target row. Anything else G3 failed — a hard loss of
 * `afl_api_stat_vector_bootstrap`, `afl_api_name_team_season_bootstrap` or
 * `afl_api_manual_adjudication`, a collision, a disagreement — is a refusal: the exception can
 * never admit it, so no file is produced at all.
 */
export function aflApiDevRegenerationEntriesFromG3(input: {
  g3Grades: readonly AflApiG3Grade[];
  targetRows: readonly AflApiG3Row[];
}): {
  entries: readonly AflApiDevRegenerationClassificationEntry[];
  refusals: readonly { externalId: string; reason: string }[];
} {
  const targetByExternalId = new Map(input.targetRows.map((r) => [r.externalId, r]));
  const entries: AflApiDevRegenerationClassificationEntry[] = [];
  const refusals: { externalId: string; reason: string }[] = [];
  for (const grade of input.g3Grades) {
    if (grade.outcome !== 'FAIL') continue;
    const target = targetByExternalId.get(grade.externalId);
    if (grade.reason !== 'hard_loss' || !target) {
      refusals.push({ externalId: grade.externalId, reason: `G3 FAIL (${grade.reason}) is never regenerable` });
      continue;
    }
    if (target.matchMethod !== 'afl_api_stat_vector_season') {
      refusals.push({ externalId: grade.externalId, reason: `hard loss of ${target.matchMethod} is never regenerable` });
      continue;
    }
    entries.push({ externalId: target.externalId, playerIdentity: target.playerIdentity, matchMethod: target.matchMethod });
  }
  entries.sort((a, b) => compareCodeUnits(a.externalId, b.externalId));
  return { entries, refusals };
}
