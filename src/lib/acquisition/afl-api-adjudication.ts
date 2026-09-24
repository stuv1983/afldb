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
  | 'T20_revoke_importer_link';

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
};

/** D10/D6/D7's whole revoke-time decision. */
export function decideAflApiRevoke(input: AflApiRevokeDecisionInput): AflApiDecision {
  if (!input.fingerprintMatches) return refuse('T6_stale_fingerprint'); // T6
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

export type AflApiAdjudicationLedgerRow = {
  id: number;
  externalId: string;
  action: 'linked' | 'revoked';
  playerId: number;
  playerIdentity: string;
  supersedesId: number | null;
};

export type AflApiPlayerRemapResult =
  | { ok: true; newPlayerId: number; remappedIdentity: string }
  | { ok: false; reason: 'unresolvable' | 'ambiguous' };

export type AflApiCandidateIdentityRow = {
  externalId: string;
  status: string;
  matchMethod: string | null;
  playerId: number | null;
};

export type AflApiReplayPlan = {
  inserts: readonly { externalId: string; playerId: number }[];
  noops: readonly { externalId: string }[];
  stops: readonly { externalId: string; reason: string }[];
};

/** The ledger reduced to one row per external_id: the LATEST action (highest id) wins. */
export function netLedgerRowsByExternalId(
  ledgerRows: readonly AflApiAdjudicationLedgerRow[],
): ReadonlyMap<string, AflApiAdjudicationLedgerRow> {
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
}): AflApiReplayPlan {
  const net = netLedgerRowsByExternalId(input.ledgerRows);
  const inserts: { externalId: string; playerId: number }[] = [];
  const noops: { externalId: string }[] = [];
  const stops: { externalId: string; reason: string }[] = [];

  for (const [externalId, row] of net) {
    if (row.action !== 'linked') continue; // net-revoked: nothing to replay

    const remap = input.remapByExternalId.get(externalId);
    if (!remap || !remap.ok) {
      stops.push({
        externalId,
        reason: remap?.reason === 'ambiguous'
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
    if (candidate) {
      const identical = candidate.status === 'resolved'
        && candidate.matchMethod === AFL_API_ADMIN_MATCH_METHOD
        && candidate.playerId === remap.newPlayerId;
      if (identical) { noops.push({ externalId }); continue; }
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

  return { inserts, noops, stops };
}

export type AflApiBijectionMismatch =
  | { kind: 'ledger_without_row'; externalId: string }
  | { kind: 'row_without_ledger'; externalId: string };

/**
 * D15's consistency proof, in both directions: every net-`linked` ledger entry must have
 * its matching `resolved`/`afl_api_admin_adjudication` row, and every such row must have
 * its net-`linked` ledger entry. Usable both as a promotion/rebuild gate and as a
 * standalone read-only invariant check (runbook §10.1 C5).
 */
export function checkAflApiAdjudicationBijection(input: {
  ledgerRows: readonly AflApiAdjudicationLedgerRow[];
  resolvedRows: readonly { externalId: string; status: string; matchMethod: string | null }[];
}): readonly AflApiBijectionMismatch[] {
  const net = netLedgerRowsByExternalId(input.ledgerRows);
  const netLinkedIds = new Set(
    [...net.entries()].filter(([, r]) => r.action === 'linked').map(([externalId]) => externalId),
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
