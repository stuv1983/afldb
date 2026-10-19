/**
 * AFLDB V2 Stage 4 — the audited, transactional Coleman publisher (docs/v2/plan.md §3 D6;
 * docs/v2/adr/0006-coleman-derived.md; migration 112 `derived_award_results`).
 *
 * `deriveColeman` is a pure function. Publishing its result is a WRITE, and it is always a write to
 * SEALED history: a derivable season is a complete season, and a complete season is a sealed one
 * (`data/reference/seasons.json`). So every publication is an explicit audited operation through the
 * season seal (`evaluateSeasonWrite`, workflow `derived_award_publication`): with no correction it
 * is refused (`season_sealed`), with an invalid correction it is refused (`correction_invalid`).
 *
 * The publisher DERIVES INSIDE, from the caller's derivation input, so a caller cannot hand in a
 * forged or stale result. Every refusal happens before any SQL statement runs. The write itself is
 * ONE transaction:
 *
 *   1. lock the (award, season) with `pg_advisory_xact_lock` (the import role has no UPDATE
 *      privilege, so `SELECT ... FOR UPDATE` is unavailable by design);
 *   2. read the CURRENT row (the one no other row supersedes);
 *   3. plan: none -> `published`; same input checksum, derivation version and winners ->
 *      `unchanged` (an idempotent recompute writes nothing); anything else -> `superseded`
 *      (a recompute after an authorised correction to the goal facts), inserting a NEW row whose
 *      `supersedes_id` names the current one;
 *   4. insert at most one row.
 *
 * Any SQL error rejects the transaction callback, so nothing is written.
 *
 * This module does NOT write `award_winners`. The Coleman `award_winners` rows remain owned by the
 * offline `tools/migration/import_awards.py` coleman group. A future projection of a published
 * result into `award_winners` must call `assertSeasonWritable` with a correction and supply
 * `player_name_raw` (ADR 0006, divergence 8). Nothing here reads a clock (`published_at` is the
 * database default), the network or the file system.
 */
import type { SqlExecutor, TransactionalSqlExecutor } from '@afldb/db';
import { evaluateSeasonWrite, sealedSeasonsFrom, type AuditedCorrection } from '@afldb/domain';
import { hasCapability, type CapabilityViewer } from '@/lib/auth/capabilities';

import {
  canonicalJson,
  deriveColeman,
  serialiseColemanDerivation,
  type ColemanDerivation,
  type ColemanDerivationInput,
  type ColemanRefusal,
} from './coleman';

/** The audited-correction workflow every Coleman publication must carry (season-seal.ts). */
export const COLEMAN_PUBLICATION_WORKFLOW = 'derived_award_publication';

/** The capability that gates publication: the curated-award editor capability (super_admin). */
export const COLEMAN_PUBLICATION_CAPABILITY = 'data.awards.edit';

/** The award slug recorded in `derived_award_results.award_slug`. */
export const COLEMAN_AWARD_SLUG = 'coleman';

/** The advisory-lock namespace (first key); the second key is the season. */
const LOCK_NAMESPACE = 'derived_award_results:coleman';

export const COLEMAN_PUBLICATION_REFUSAL_CODES = [
  'capability_denied',
  'invalid_actor',
  'derivation_refused',
  'correction_invalid',
  'season_sealed',
  'actor_mismatch',
  'season_not_sealed',
] as const;
export type ColemanPublicationRefusalCode = (typeof COLEMAN_PUBLICATION_REFUSAL_CODES)[number];

export interface ColemanPublicationRefusal {
  readonly code: ColemanPublicationRefusalCode;
  readonly message: string;
  readonly season: number;
  /** Present only for `derivation_refused`: the derivation's own typed refusal, passed through. */
  readonly derivation?: ColemanRefusal;
}

export interface ColemanPublicationRequest {
  /**
   * The derivation input. The publisher derives from it itself: it never accepts a ready-made
   * result. `seasonState.registry` is also the source of the sealed range the seal checks.
   */
  readonly derivation: ColemanDerivationInput;
  /** The season seal's audited correction; `null` is always refused (a publication is a write to sealed history). */
  readonly correction: AuditedCorrection | null;
  /** The authenticated user (auth_users.id) recorded in `published_by`; must equal `correction.actorUserId`. */
  readonly publishedBy: number;
  /** The caller's capability viewer; `data.awards.edit` (super_admin) is required. */
  readonly viewer: CapabilityViewer;
}

/** The audit record the seal returned, stored verbatim in `derived_award_results.correction`. */
export interface ColemanPublicationAudit {
  readonly season: number | null;
  readonly workflow: AuditedCorrection['workflow'];
  readonly actorUserId: number;
  readonly note: string;
  readonly evidenceRef: string;
}

export type ColemanPublicationGate =
  | { readonly ok: false; readonly refusal: ColemanPublicationRefusal }
  | { readonly ok: true; readonly derivation: ColemanDerivation; readonly audit: ColemanPublicationAudit };

/** The current published row of a season, as the publisher reads it. */
export interface ColemanCurrentPublication {
  readonly id: number;
  readonly inputChecksum: string;
  readonly derivationVersion: string;
  /** The stored `winners` jsonb (already parsed). */
  readonly winners: unknown;
}

export type ColemanPublicationPlan =
  | { readonly outcome: 'published'; readonly supersedesId: null }
  | { readonly outcome: 'unchanged'; readonly currentId: number }
  | { readonly outcome: 'superseded'; readonly supersedesId: number };

export type ColemanPublicationOutcome =
  | { readonly ok: false; readonly refusal: ColemanPublicationRefusal }
  | {
    readonly ok: true;
    readonly outcome: ColemanPublicationPlan['outcome'];
    /** The row id: the new row for `published`/`superseded`, the existing current row for `unchanged`. */
    readonly id: number;
    /** The id of the row this publication replaced (`superseded` only), else null. */
    readonly supersededId: number | null;
    readonly season: number;
    readonly methodVersion: number;
    readonly derivationVersion: string;
    readonly inputChecksum: string;
    readonly winnerKeys: readonly string[];
  };

/* ------------------------------------------------------------------ *
 * Pure decisions
 * ------------------------------------------------------------------ */

function refuse(
  code: ColemanPublicationRefusalCode,
  message: string,
  season: number,
  derivation?: ColemanRefusal,
): { readonly ok: false; readonly refusal: ColemanPublicationRefusal } {
  return { ok: false, refusal: derivation === undefined ? { code, message, season } : { code, message, season, derivation } };
}

/**
 * Every refusal that can be decided without SQL, in this order: capability, actor, derivation
 * (incomplete, unsettled, incomplete rounds, NULL goals, identity ...), correction workflow, the
 * season seal, and actor agreement. Pure and total.
 */
export function checkColemanPublication(request: ColemanPublicationRequest): ColemanPublicationGate {
  const { derivation: input, correction, publishedBy, viewer } = request;
  const season = input.season;

  if (!hasCapability(viewer, COLEMAN_PUBLICATION_CAPABILITY)) {
    return refuse('capability_denied', `Refused: publishing a derived award needs the ${COLEMAN_PUBLICATION_CAPABILITY} capability.`, season);
  }
  if (!Number.isSafeInteger(publishedBy) || publishedBy <= 0) {
    return refuse('invalid_actor', 'Refused: publishedBy must be a positive integer (auth_users.id).', season);
  }

  const derived = deriveColeman(input);
  if (!derived.ok) {
    return refuse('derivation_refused', `Refused: the derivation for season ${season} is refused (${derived.refusal.code}); nothing is published.`, season, derived.refusal);
  }

  if (correction !== null && correction.workflow !== COLEMAN_PUBLICATION_WORKFLOW) {
    return refuse(
      'correction_invalid',
      `Refused: a Coleman publication must carry the '${COLEMAN_PUBLICATION_WORKFLOW}' correction workflow, not '${String(correction.workflow)}'.`,
      season,
    );
  }

  // A derived season is complete, hence sealed, so this write is always to sealed history.
  const decision = evaluateSeasonWrite({ season, sealed: sealedSeasonsFrom(input.seasonState.registry), correction });
  if (!decision.allowed) {
    return refuse(decision.code, decision.message, season);
  }
  if (decision.basis !== 'audited_correction') {
    // Defensive: a successful derivation implies a sealed season, so this cannot happen.
    return refuse('season_not_sealed', `Refused: season ${season} is not sealed, so it cannot be derived or published as a sealed result.`, season);
  }
  if (decision.audit.actorUserId !== publishedBy) {
    return refuse('actor_mismatch', 'Refused: publishedBy must equal the correction actorUserId (one accountable user).', season);
  }
  return { ok: true, derivation: derived.result, audit: decision.audit };
}

/**
 * What a publication would do given the season's current row (or none). `unchanged` requires the
 * SAME input checksum, derivation version and winners; anything else supersedes the current row.
 */
export function planColemanPublication(
  current: ColemanCurrentPublication | null,
  derivation: ColemanDerivation,
): ColemanPublicationPlan {
  if (current === null) return { outcome: 'published', supersedesId: null };
  const same = current.inputChecksum === derivation.inputChecksum
    && current.derivationVersion === derivation.derivationVersion
    && canonicalJson(current.winners) === canonicalJson(derivation.winners);
  return same
    ? { outcome: 'unchanged', currentId: current.id }
    : { outcome: 'superseded', supersedesId: current.id };
}

/* ------------------------------------------------------------------ *
 * SQL
 * ------------------------------------------------------------------ */

interface CurrentRow {
  id: number | string;
  input_checksum: string;
  derivation_version: string;
  winners: unknown;
}

/** A jsonb value as a driver may hand it back: parsed already, or (defensively) as JSON text. */
function fromStore(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function readCurrent(tx: SqlExecutor, season: number): Promise<ColemanCurrentPublication | null> {
  const rows = await tx.query<CurrentRow>(
    `SELECT r.id::int AS id, r.input_checksum, r.derivation_version, r.winners
       FROM derived_award_results r
      WHERE r.award_slug = $1 AND r.season = $2::int
        AND NOT EXISTS (SELECT 1 FROM derived_award_results s WHERE s.supersedes_id = r.id)`,
    [COLEMAN_AWARD_SLUG, season],
  );
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    throw new Error(`derived_award_results holds ${rows.length} current rows for ${COLEMAN_AWARD_SLUG} ${season}; the supersession chain is broken`);
  }
  const row = rows[0];
  return {
    id: Number(row.id),
    inputChecksum: row.input_checksum,
    derivationVersion: row.derivation_version,
    winners: fromStore(row.winners),
  };
}

/**
 * Publish the Coleman result for one season, atomically. Resolves to a typed refusal (no SQL was
 * run) or to the outcome; a SQL error rejects and rolls the whole transaction back.
 */
export async function publishColemanResult(
  executor: TransactionalSqlExecutor,
  request: ColemanPublicationRequest,
): Promise<ColemanPublicationOutcome> {
  const gate = checkColemanPublication(request);
  if (!gate.ok) return gate;
  const { derivation, audit } = gate;

  return executor.transaction(async (tx): Promise<ColemanPublicationOutcome> => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1), $2::int)', [LOCK_NAMESPACE, derivation.season]);
    const current = await readCurrent(tx, derivation.season);
    const plan = planColemanPublication(current, derivation);
    const common = {
      ok: true as const,
      season: derivation.season,
      methodVersion: derivation.methodVersion,
      derivationVersion: derivation.derivationVersion,
      inputChecksum: derivation.inputChecksum,
      winnerKeys: derivation.winners.map((winner) => winner.key),
    };
    if (plan.outcome === 'unchanged') {
      return { ...common, outcome: 'unchanged', id: plan.currentId, supersededId: null };
    }
    const inserted = await tx.query<{ id: number | string }>(
      `INSERT INTO derived_award_results
         (award_slug, season, method_version, derivation_version, input_checksum,
          result, winners, derived_at, published_by, basis, correction, supersedes_id)
       VALUES ($1, $2::int, $3::int, $4, $5, $6::jsonb, $7::jsonb, $8::timestamptz, $9::int,
               'audited_correction', $10::jsonb, $11::bigint)
       RETURNING id::int AS id`,
      [
        COLEMAN_AWARD_SLUG,
        derivation.season,
        derivation.methodVersion,
        derivation.derivationVersion,
        derivation.inputChecksum,
        serialiseColemanDerivation(derivation),
        canonicalJson(derivation.winners),
        derivation.derivedAt,
        request.publishedBy,
        JSON.stringify(audit),
        plan.supersedesId,
      ],
    );
    return {
      ...common,
      outcome: plan.outcome,
      id: Number(inserted[0].id),
      supersededId: plan.supersedesId,
    };
  });
}
