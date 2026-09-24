/**
 * AFLDB-ISSUE-235 OD-5 (runbook D15 (i)–(iii)) — the `afl_api` human identity adjudication
 * ledger carried through the destructive `db:test:rebuild`.
 *
 *     npx tsx tools/migration/rebuild_afl_api_adjudications.ts capture [--recover]
 *     npx tsx tools/migration/rebuild_afl_api_adjudications.ts reinstate
 *     npx tsx tools/migration/rebuild_afl_api_adjudications.ts bijection
 *
 * Run ONLY by tools/db/rebuild-test.ts, as three of its stages:
 *
 *   capture    BEFORE the reset. Every `afl_api_identity_adjudications` row, with its stored
 *              `player_identity`, every audit field, its ORIGINAL id and `supersedes_id`, and
 *              its actor's email and role, is written to a hashed capture file under
 *              `backups/rebuild/<target>/` (gitignored: it holds admin emails and notes). A
 *              failure here stops the rebuild before anything is destroyed. An empty ledger —
 *              or a database that predates migration 104 — is captured as empty.
 *   reinstate  AFTER `draftguru`, the last stage that adds players. ONE transaction:
 *              the ledger is reinstated under its original ids (OVERRIDING SYSTEM VALUE, so
 *              `supersedes_id` stays true), `player_id` is remapped from the row's own
 *              `player_identity` through the replay adapter's own lookup, `admin_user_id` is
 *              remapped by email (ACTOR ATTRIBUTION below), the identity sequence is advanced
 *              past the maximum id, the rows are read back and compared, and then the D15
 *              replay and the bijection
 *              check run. Any failure rolls ALL of it back: no partial ledger and no partial
 *              human identity can survive.
 *   bijection  READ-ONLY, its own validation stage straight after: D15 point 3.
 *
 * WHY A CHILD PROCESS, NOT AN IN-PROCESS TRANSACTION. `executeRebuild()` is synchronous by
 * design and every stage it runs is a child process or a psql stream (see the runner's
 * `runSql` comment: an un-awaited postgres.js call there once silently never ran). An
 * in-process `sql.begin()` would need the whole runner made async. A child process fits the
 * existing stage contract exactly: a non-zero exit fails the stage and stops the rebuild.
 *
 * NO POLICY LIVES HERE. The D15 decisions stay in `src/lib/acquisition/afl-api-adjudication.ts`
 * and `replay_afl_api_adjudications.ts`; this file only moves the ledger across the reset and
 * calls them. The player remap is `resolveAflApiPlayerIdentity()` from the replay adapter —
 * no second identity lookup — and the replay re-derives it again independently afterwards.
 *
 * ACTOR ATTRIBUTION (the one mechanism the runbook does not specify). `admin_user_id` is
 * NOT NULL REFERENCES auth_users, and the rebuild reinstates no auth state. The actor is
 * captured by email and role alone — never a password hash, TOTP secret or session. The
 * captured role must be one `auth_users_role_check` allows (migration 033, the
 * `isLifecycleRole` contract); any other value refuses the capture, and a capture file
 * carrying one refuses before the reinstate transaction writes anything. It is never
 * coerced to another role. On reinstate an existing `auth_users` row with that email
 * (case-insensitive, the `uq_auth_users_email_lower` rule) is reused AS IT IS: its role,
 * credentials and state are not touched. Otherwise an ATTRIBUTION-ONLY row is created: the
 * captured email, the CAPTURED role, no password hash, no TOTP secret, no session,
 * `disabled_at` set at creation. It cannot sign in (login needs both factors and
 * `disabled_at IS NULL`, src/lib/auth/session.ts). It preserves who acted, and in which
 * role they were recorded when the ledger was captured. It is NOT evidence that the actor
 * held that role for the whole of the ledger's history, and it is not a restored account.
 *
 * RECOVERY. A pending capture that the live ledger already equals, row for row, is not
 * lost work. It is what a run leaves when it died after the reinstate transaction
 * COMMITTED but before the capture file was archived. The capture step verifies that
 * state in its own READ-ONLY transaction: the ledger equals the capture, the identity
 * sequence is above the maximum id, a replay would insert nothing (`replayAflApiAdjudications()`
 * itself, which a read-only transaction cannot let write), and the bijection holds. Only
 * then does it archive the pending capture as reinstated and capture the live ledger
 * afresh. It never re-inserts the ledger. Any failed check refuses with
 * `already_reinstated_unverified` and leaves the pending capture exactly where it is.
 *
 * TARGET SAFETY. The runner passes the target name and ONE DSN in dedicated variables
 * (never AFLDB_DATABASE_URL or any development variable). The DSN's database must pass the
 * rebuild's own `assertRebuildTargetName()` and equal the named target, so a DEV/PROD DSN
 * is refused here even if it were ever routed to this tool. No DSN is ever printed.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import postgres, { type TransactionSql } from 'postgres';

import {
  AFL_API_PROVIDER_ID_RE,
  type AflApiPlayerRemapResult,
} from '../../src/lib/acquisition/afl-api-adjudication';
import { isLifecycleRole, type LifecycleRole } from '../../src/lib/auth/admin-lifecycle';
import {
  AFL_API_ADJUDICATION_DSN_ENV,
  AFL_API_ADJUDICATION_TARGET_ENV,
  assertRebuildTargetName,
  databaseOf,
} from '../db/rebuild-test';
import { redact } from '../db/psql';
import {
  assertAflApiAdjudicationBijection,
  replayAflApiAdjudications,
  resolveAflApiPlayerIdentity,
  type AflApiReplayCounts,
} from './replay_afl_api_adjudications';

/** Any refusal. Thrown before the reset (capture) or inside the transaction (reinstate). */
export class AdjudicationRebuildRefused extends Error {}

export const CAPTURE_FORMAT = 'afldb.afl_api_identity_adjudications.rebuild_capture';
/** 2: each row carries its actor's role. A version-1 file is refused, never guessed at. */
export const CAPTURE_VERSION = 2;
/** Migration 104 names this sequence in its own GRANT, so the name is fixed. */
export const LEDGER_ID_SEQUENCE = 'afl_api_identity_adjudications_id_seq';
/** The pending capture: taken by this or an earlier run and not yet reinstated. */
export const PENDING_CAPTURE_FILE = 'afl-api-adjudications.capture.json';

const CREATED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// The capture format
// ---------------------------------------------------------------------------

export type CapturedLedgerRow = {
  id: number;
  sourceKey: string;
  externalId: string;
  action: 'linked' | 'revoked';
  /** The CAPTURED database's surrogate. Audit only: never reinstated, always remapped. */
  playerId: number;
  playerIdentity: string;
  /** `previous_state::text` exactly as PostgreSQL rendered it; re-cast to jsonb on reinstate. */
  previousState: string | null;
  /** `evidence::text`, likewise. */
  evidence: string;
  evidenceSha256: string;
  surnameDisagreementAcknowledged: boolean;
  supersedesId: number | null;
  /** The CAPTURED database's surrogate. Audit only: never reinstated, always remapped. */
  adminUserId: number;
  /** The actor's stable identity across a rebuild. */
  adminEmail: string;
  /** The actor's `auth_users.role` AT CAPTURE. Used only to create an attribution-only row. */
  adminRole: LifecycleRole;
  note: string;
  /** UTC with microseconds, `YYYY-MM-DDTHH:MM:SS.ffffffZ`: round-trips `timestamptz` exactly. */
  createdAt: string;
};

export type LedgerCapture = {
  format: typeof CAPTURE_FORMAT;
  version: typeof CAPTURE_VERSION;
  database: string;
  capturedAt: string;
  /** False when the captured database predates migration 104. Its `rows` are then empty. */
  ledgerTablePresent: boolean;
  rows: CapturedLedgerRow[];
  payloadSha256: string;
};

/** Every LEDGER column, in one fixed order, so a comparison never depends on JSON key order. */
function ledgerTuple(r: ReinstatementRow): unknown[] {
  return [r.id, r.sourceKey, r.externalId, r.action, r.playerId, r.playerIdentity, r.previousState,
    r.evidence, r.evidenceSha256, r.surnameDisagreementAcknowledged, r.supersedesId, r.adminUserId,
    r.note, r.createdAt];
}

/** Every captured field — the ledger columns plus the actor — for the payload hash. */
function rowTuple(r: CapturedLedgerRow): unknown[] {
  return [...ledgerTuple(r), r.adminEmail, r.adminRole];
}

export function capturePayloadSha256(c: Omit<LedgerCapture, 'payloadSha256'>): string {
  const canonical = JSON.stringify(
    [c.format, c.version, c.database, c.capturedAt, c.ledgerTablePresent, c.rows.map(rowTuple)]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

const isPositiveId = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

/**
 * Structural problems with a captured ledger. Not D15 policy: only what a faithful
 * reinstatement needs — unique ascending ids, and every `supersedes_id` naming an EARLIER
 * captured row, so inserting in id order always satisfies the self-reference.
 */
export function capturedRowProblems(rows: readonly CapturedLedgerRow[]): string[] {
  const problems: string[] = [];
  const seen = new Set<number>();
  /** lower(email) -> the first row's id and role, so one actor never carries two roles. */
  const actorRole = new Map<string, { id: number; role: unknown }>();
  let previousId = 0;
  for (const r of rows) {
    const at = `ledger row ${String(r.id)}`;
    if (!isPositiveId(r.id)) { problems.push(`${at}: id is not a positive integer`); continue; }
    if (r.id <= previousId) problems.push(`${at}: ids are not strictly ascending`);
    previousId = Math.max(previousId, r.id);
    if (r.sourceKey !== 'afl_api') problems.push(`${at}: source_key is not 'afl_api'`);
    if (typeof r.externalId !== 'string' || !AFL_API_PROVIDER_ID_RE.test(r.externalId)) {
      problems.push(`${at}: external_id is not a CD_I provider id`);
    }
    if (r.action !== 'linked' && r.action !== 'revoked') problems.push(`${at}: action is not linked/revoked`);
    if ((r.action === 'revoked') !== (r.supersedesId !== null)) {
      problems.push(`${at}: supersedes_id must be set exactly on a revoked row`);
    }
    if (r.supersedesId !== null && !(isPositiveId(r.supersedesId) && seen.has(r.supersedesId))) {
      problems.push(`${at}: supersedes_id ${String(r.supersedesId)} is not an earlier captured row`);
    }
    if (!isPositiveId(r.playerId)) problems.push(`${at}: player_id is not a positive integer`);
    if (typeof r.playerIdentity !== 'string' || r.playerIdentity === '') {
      problems.push(`${at}: player_identity is empty`);
    }
    if (r.previousState !== null && typeof r.previousState !== 'string') {
      problems.push(`${at}: previous_state is not jsonb text or null`);
    }
    if (typeof r.evidence !== 'string' || r.evidence === '') problems.push(`${at}: evidence is empty`);
    if (typeof r.evidenceSha256 !== 'string' || !SHA256_RE.test(r.evidenceSha256)) {
      problems.push(`${at}: evidence_sha256 is not 64 lowercase hex`);
    }
    if (typeof r.surnameDisagreementAcknowledged !== 'boolean') {
      problems.push(`${at}: surname_disagreement_acknowledged is not a boolean`);
    }
    if (!isPositiveId(r.adminUserId)) problems.push(`${at}: admin_user_id is not a positive integer`);
    if (typeof r.adminEmail !== 'string' || r.adminEmail.trim() === '') {
      problems.push(`${at}: the actor has no email to remap by`);
    } else {
      const first = actorRole.get(r.adminEmail.toLowerCase());
      if (!first) actorRole.set(r.adminEmail.toLowerCase(), { id: r.id, role: r.adminRole });
      else if (first.role !== r.adminRole) {
        problems.push(`${at}: its actor is captured with a different role from ledger row ${first.id}'s`);
      }
    }
    if (!isLifecycleRole(r.adminRole)) {
      problems.push(`${at}: the actor's role '${String(r.adminRole)}' is not one auth_users.role allows`);
    }
    if (typeof r.note !== 'string') problems.push(`${at}: note is not text`);
    if (typeof r.createdAt !== 'string' || !CREATED_AT_RE.test(r.createdAt)) {
      problems.push(`${at}: created_at is not UTC microsecond ISO text`);
    }
    seen.add(r.id);
  }
  return problems;
}

export function buildLedgerCapture(input: {
  database: string; capturedAt: string; ledgerTablePresent: boolean; rows: readonly CapturedLedgerRow[];
}): LedgerCapture {
  if (!input.ledgerTablePresent && input.rows.length > 0) {
    throw new AdjudicationRebuildRefused('A capture with no ledger table cannot carry rows.');
  }
  const problems = capturedRowProblems(input.rows);
  if (problems.length > 0) {
    throw new AdjudicationRebuildRefused(
      `The afl_api adjudication ledger is not structurally reinstatable: ${problems.join('; ')}`);
  }
  const body: Omit<LedgerCapture, 'payloadSha256'> = {
    format: CAPTURE_FORMAT, version: CAPTURE_VERSION, database: input.database,
    capturedAt: input.capturedAt, ledgerTablePresent: input.ledgerTablePresent, rows: [...input.rows],
  };
  return { ...body, payloadSha256: capturePayloadSha256(body) };
}

/** Parse and PROVE a capture file: format, target, row structure and payload hash. */
export function parseLedgerCapture(text: string, expectedDatabase: string): LedgerCapture {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new AdjudicationRebuildRefused('The adjudication capture file is not valid JSON.');
  }
  if (raw.format !== CAPTURE_FORMAT || raw.version !== CAPTURE_VERSION) {
    throw new AdjudicationRebuildRefused('The adjudication capture file has an unknown format or version.');
  }
  if (raw.database !== expectedDatabase) {
    throw new AdjudicationRebuildRefused(
      `The adjudication capture was taken from '${String(raw.database)}', not '${expectedDatabase}'. `
      + 'A capture is only ever reinstated into the database it came from.');
  }
  if (typeof raw.capturedAt !== 'string' || typeof raw.ledgerTablePresent !== 'boolean'
      || !Array.isArray(raw.rows) || typeof raw.payloadSha256 !== 'string') {
    throw new AdjudicationRebuildRefused('The adjudication capture file is missing required fields.');
  }
  const rows = (raw.rows as Record<string, unknown>[]).map((r) => ({
    id: r.id, sourceKey: r.sourceKey, externalId: r.externalId, action: r.action,
    playerId: r.playerId, playerIdentity: r.playerIdentity, previousState: r.previousState,
    evidence: r.evidence, evidenceSha256: r.evidenceSha256,
    surnameDisagreementAcknowledged: r.surnameDisagreementAcknowledged, supersedesId: r.supersedesId,
    adminUserId: r.adminUserId, adminEmail: r.adminEmail, adminRole: r.adminRole, note: r.note,
    createdAt: r.createdAt,
  }) as CapturedLedgerRow);
  const capture = buildLedgerCapture({
    database: expectedDatabase, capturedAt: raw.capturedAt, ledgerTablePresent: raw.ledgerTablePresent, rows,
  });
  if (capture.payloadSha256 !== raw.payloadSha256) {
    throw new AdjudicationRebuildRefused(
      'The adjudication capture file does not match its own payload hash: it was altered after capture.');
  }
  return capture;
}

// ---------------------------------------------------------------------------
// The pending-capture guard: a capture is the recovery source for a re-run
// ---------------------------------------------------------------------------

/**
 * Two ledgers are the same ledger when every ledger column agrees except the two
 * surrogates a reinstatement legitimately changes (`player_id`, `admin_user_id`). The
 * actor email is compared case-insensitively, the `uq_auth_users_email_lower` rule. The
 * actor ROLE is not compared: it lives on `auth_users`, not in the ledger, and a reused
 * account keeps whatever role it has now.
 */
export function sameLedger(a: readonly CapturedLedgerRow[], b: readonly CapturedLedgerRow[]): boolean {
  if (a.length !== b.length) return false;
  const key = (r: CapturedLedgerRow) => JSON.stringify(
    [...ledgerTuple({ ...r, playerId: 0, adminUserId: 0 }), r.adminEmail.toLowerCase()]);
  return a.every((r, i) => key(r) === key(b[i]));
}

export type PendingCaptureDecision =
  | { action: 'capture-live' }
  | { action: 'verify-reinstated' }
  | { action: 'adopt-pending' }
  | { action: 'refuse'; reason: string };

/**
 * A pending capture exists only when an earlier run captured and never archived it. That
 * run failed somewhere after the capture, possibly AFTER the reset, and possibly after
 * its reinstate transaction had already committed. Capturing the live ledger over it
 * could then silently record the destroyed ledger as empty. So:
 *
 *   no pending capture                          -> capture the live ledger
 *   pending capture empty, live ledger empty    -> nothing to lose; capture the live ledger
 *   pending capture equals a non-empty live one -> VERIFY it is completely reinstated
 *                                                  (verifyReinstatedCapture), then archive
 *                                                  the pending capture and capture the live
 *                                                  ledger; --recover changes nothing here
 *   --recover, live ledger empty or absent      -> adopt the pending capture as this run's
 *   anything else                               -> REFUSE, before the reset
 */
export function decidePendingCapture(input: {
  pending: LedgerCapture | null; liveRows: readonly CapturedLedgerRow[]; recover: boolean;
}): PendingCaptureDecision {
  const { pending, liveRows, recover } = input;
  if (!pending) {
    return recover
      ? { action: 'refuse', reason: '--recover was given, but there is no pending capture to recover from.' }
      : { action: 'capture-live' };
  }
  if (sameLedger(pending.rows, liveRows)) {
    return pending.rows.length === 0 ? { action: 'capture-live' } : { action: 'verify-reinstated' };
  }
  if (recover && liveRows.length === 0) return { action: 'adopt-pending' };
  if (liveRows.length === 0) {
    return {
      action: 'refuse',
      reason: `An earlier rebuild captured ${pending.rows.length} adjudication row(s) at `
        + `${pending.capturedAt} and never reinstated them, and the live ledger is now empty or absent `
        + '(that run most likely failed after the reset). Capturing now would record the lost ledger '
        + 'as empty. Re-run with --recover-afl-api-adjudications to reinstate from that capture.',
    };
  }
  return {
    action: 'refuse',
    reason: `An earlier rebuild's capture (${pending.rows.length} row(s), ${pending.capturedAt}) was never `
      + `reinstated, and the live ledger (${liveRows.length} row(s)) differs from it. Neither can be `
      + 'chosen automatically; reconcile them by hand before rebuilding.',
  };
}

/**
 * What the capture step observes of a live database that already holds the pending
 * capture's ledger. Read in a READ-ONLY transaction (`observeLiveReinstatement`).
 */
export type LiveReinstatementObservation = {
  sequence: { lastValue: number; isCalled: boolean };
  /** `replayAflApiAdjudications()` run read-only: its counts, or why it could not complete. */
  replay: AflApiReplayCounts | { error: string };
  bijection: 'ok' | { error: string };
};

/**
 * Every reason the live database is NOT a completed reinstatement of `pending`. Empty means
 * the earlier run's reinstate transaction committed in full: the same ledger, a sequence
 * that cannot collide with it, human identities a replay would not change, and the bijection.
 */
export function reinstatedCaptureProblems(
  pending: LedgerCapture, liveRows: readonly CapturedLedgerRow[], observed: LiveReinstatementObservation,
): string[] {
  const problems: string[] = [];
  if (!sameLedger(pending.rows, liveRows)) problems.push('the live ledger differs from the pending capture');
  const maxId = liveRows.reduce((max, r) => Math.max(max, r.id), 0);
  try {
    assertSequenceAboveLedger(observed.sequence, maxId);
  } catch (error) {
    problems.push((error as Error).message);
  }
  if ('error' in observed.replay) {
    problems.push(`a replay could not confirm the human identities: ${observed.replay.error}`);
  } else if (observed.replay.inserted !== 0 || observed.replay.stops.length !== 0) {
    problems.push(`a replay would still insert ${observed.replay.inserted} human identity row(s)`);
  }
  if (observed.bijection !== 'ok') problems.push(`the bijection does not hold: ${observed.bijection.error}`);
  return problems;
}

/**
 * The file half of the capture step, after the live ledger has been read (and, for
 * `verify-reinstated`, observed). Never touches the database.
 *
 *   refuse             -> throws; nothing written, pending capture untouched
 *   adopt-pending      -> the pending capture is this run's; nothing written
 *   verify-reinstated  -> verified: archive the pending capture, then capture the live
 *                         ledger. Not verified: throws `already_reinstated_unverified`,
 *                         pending capture untouched.
 *   capture-live       -> capture the live ledger
 */
export function settleCapture(input: {
  dir: string; database: string; capturedAt: string;
  pending: LedgerCapture | null;
  live: { present: boolean; rows: readonly CapturedLedgerRow[] };
  decision: PendingCaptureDecision;
  observed: LiveReinstatementObservation | null;
}): {
  adopted: LedgerCapture | null;
  archived: string | null;
  captured: { capture: LedgerCapture; path: string; sha256: string } | null;
} {
  const { dir, database, pending, live, decision } = input;
  if (decision.action === 'refuse') throw new AdjudicationRebuildRefused(decision.reason);
  if (decision.action === 'adopt-pending') return { adopted: pending!, archived: null, captured: null };
  let archived: string | null = null;
  if (decision.action === 'verify-reinstated') {
    const problems = input.observed
      ? reinstatedCaptureProblems(pending!, live.rows, input.observed)
      : ['the live database was not observed'];
    if (problems.length > 0) {
      throw new AdjudicationRebuildRefused(
        `already_reinstated_unverified: the live ledger holds the same ${pending!.rows.length} row(s) as the `
        + `pending capture from ${pending!.capturedAt}, but it cannot be proven to be a completed `
        + `reinstatement: ${problems.join('; ')}. The pending capture was left in place. Resolve this `
        + 'by hand before rebuilding.');
    }
    archived = archivePendingCapture(dir, pending!);
  }
  const capture = buildLedgerCapture({
    database, capturedAt: input.capturedAt, ledgerTablePresent: live.present, rows: live.rows,
  });
  return { adopted: null, archived, captured: { capture, ...writePendingCapture(dir, capture) } };
}

// ---------------------------------------------------------------------------
// Reinstatement planning (pure)
// ---------------------------------------------------------------------------

export type ReinstatementRow = Omit<CapturedLedgerRow, 'adminEmail' | 'adminRole'>;

/** An `auth_users` row the reinstate may reuse. */
export type ExistingActor = { id: number; email: string; role: string };

/** An attribution-only account to create: email and role, and nothing else (header). */
export type AttributionActor = { email: string; role: LifecycleRole };

export type ActorRemapPlan = {
  /** lower(email) -> the existing account reused for it. */
  reuse: Map<string, number>;
  create: AttributionActor[];
  /** Reused accounts whose CURRENT role differs from the captured one. Left unchanged. */
  reusedWithDifferentRole: number;
};

/**
 * One actor per case-insensitive email: reuse the existing account if there is one,
 * otherwise create an attribution-only account with the captured role. Throws on an
 * invalid or inconsistent captured role, or on an email that matches more than one account.
 */
export function planActorRemap(
  rows: readonly CapturedLedgerRow[], existing: readonly ExistingActor[],
): ActorRemapPlan {
  const problems = capturedRowProblems(rows);
  const actors = new Map<string, AttributionActor>();
  for (const r of rows) {
    const key = r.adminEmail.toLowerCase();
    if (!actors.has(key)) actors.set(key, { email: r.adminEmail, role: r.adminRole });
  }
  const plan: ActorRemapPlan = { reuse: new Map(), create: [], reusedWithDifferentRole: 0 };
  for (const [key, actor] of actors) {
    const matches = existing.filter((e) => e.email.toLowerCase() === key);
    if (matches.length > 1) {
      problems.push(`the actor of ledger row ${rows.find((r) => r.adminEmail.toLowerCase() === key)!.id} `
        + `matches ${matches.length} auth_users rows`);
    } else if (matches.length === 1) {
      plan.reuse.set(key, matches[0].id);
      if (matches[0].role !== actor.role) plan.reusedWithDifferentRole += 1;
    } else {
      plan.create.push({ email: actor.email, role: actor.role });
    }
  }
  if (problems.length > 0) {
    throw new AdjudicationRebuildRefused(
      `The afl_api adjudication actors cannot be remapped; nothing was written: ${problems.join('; ')}`);
  }
  return plan;
}

/** Every row whose stored identity does not remap to exactly one rebuilt player. */
export function ledgerPlayerRemapProblems(
  rows: readonly CapturedLedgerRow[],
  remapByIdentity: ReadonlyMap<string, AflApiPlayerRemapResult>,
): string[] {
  const problems: string[] = [];
  for (const r of rows) {
    const remap = remapByIdentity.get(r.playerIdentity);
    if (!remap || !remap.ok) {
      problems.push(`ledger row ${r.id} (${r.externalId}): player_identity '${r.playerIdentity}' `
        + `${remap?.ok === false && remap.reason === 'ambiguous' ? 'names more than one' : 'names no'} rebuilt player`);
    } else if (remap.remappedIdentity !== r.playerIdentity) {
      problems.push(`ledger row ${r.id} (${r.externalId}): the remapped identity differs from the stored one`);
    }
  }
  return problems;
}

/**
 * The rows to INSERT, in id order, with ONLY the two surrogates replaced: `player_id` from
 * the row's own `player_identity`, `admin_user_id` from its actor email (looked up
 * lower-cased). Every other field, the id and `supersedes_id` included, is the captured
 * value. Throws on any unmapped row.
 */
export function planLedgerReinstatement(input: {
  rows: readonly CapturedLedgerRow[];
  remapByIdentity: ReadonlyMap<string, AflApiPlayerRemapResult>;
  /** Keyed by lower(email). */
  actorIdByEmail: ReadonlyMap<string, number>;
}): { rows: ReinstatementRow[]; maxId: number } {
  const problems = [
    ...capturedRowProblems(input.rows),
    ...ledgerPlayerRemapProblems(input.rows, input.remapByIdentity),
  ];
  const actorId = (r: CapturedLedgerRow) => input.actorIdByEmail.get(r.adminEmail.toLowerCase());
  for (const r of input.rows) {
    if (!isPositiveId(actorId(r))) {
      problems.push(`ledger row ${r.id} (${r.externalId}): its actor was not remapped`);
    }
  }
  if (problems.length > 0) {
    throw new AdjudicationRebuildRefused(
      `The afl_api adjudication ledger cannot be reinstated; nothing was written: ${problems.join('; ')}`);
  }
  const rows = input.rows.map((r): ReinstatementRow => {
    const remap = input.remapByIdentity.get(r.playerIdentity) as Extract<AflApiPlayerRemapResult, { ok: true }>;
    const { adminEmail: _email, adminRole: _role, ...rest } = r;
    return { ...rest, playerId: remap.newPlayerId, adminUserId: actorId(r)! };
  });
  return { rows, maxId: rows.reduce((max, r) => Math.max(max, r.id), 0) };
}

/** The value the identity sequence hands out next, from its `last_value`/`is_called`. */
export function nextIdentityValue(state: { lastValue: number; isCalled: boolean }): number {
  return state.isCalled ? state.lastValue + 1 : state.lastValue;
}

/** A future INSERT must never collide with a reinstated id. */
export function assertSequenceAboveLedger(
  state: { lastValue: number; isCalled: boolean }, maxId: number,
): void {
  const next = nextIdentityValue(state);
  if (!(next > maxId)) {
    throw new AdjudicationRebuildRefused(
      `${LEDGER_ID_SEQUENCE} would next hand out ${next}, which does not exceed the reinstated `
      + `maximum id ${maxId}.`);
  }
}

/** The reinstated rows, read back, must be exactly the planned rows. */
export function reinstatedLedgerProblems(
  planned: readonly ReinstatementRow[], readBack: readonly ReinstatementRow[],
): string[] {
  if (planned.length !== readBack.length) {
    return [`${planned.length} row(s) planned but ${readBack.length} read back`];
  }
  const problems: string[] = [];
  planned.forEach((p, i) => {
    if (JSON.stringify(ledgerTuple(readBack[i])) !== JSON.stringify(ledgerTuple(p))) {
      problems.push(`ledger row ${p.id} was not reinstated byte-for-byte`);
    }
  });
  return problems;
}

// ---------------------------------------------------------------------------
// Target, paths and files
// ---------------------------------------------------------------------------

/**
 * The target and DSN the runner handed this process, proven. Only the two dedicated
 * variables are read; a DSN naming anything but the allowlisted target is refused.
 */
export function resolveAdjudicationTarget(
  env: Record<string, string | undefined>,
): { database: string; dsn: string } {
  const database = env[AFL_API_ADJUDICATION_TARGET_ENV];
  if (!database) {
    throw new AdjudicationRebuildRefused(
      `${AFL_API_ADJUDICATION_TARGET_ENV} is not set. This tool runs only as a db:test:rebuild stage.`);
  }
  assertRebuildTargetName(database);
  const dsn = env[AFL_API_ADJUDICATION_DSN_ENV];
  if (!dsn) throw new AdjudicationRebuildRefused(`${AFL_API_ADJUDICATION_DSN_ENV} is not set.`);
  let named: string;
  try {
    named = databaseOf(dsn);
  } catch {
    throw new AdjudicationRebuildRefused(`${AFL_API_ADJUDICATION_DSN_ENV} is not a valid connection URL.`);
  }
  assertRebuildTargetName(named);
  if (named !== database) {
    throw new AdjudicationRebuildRefused(
      `${AFL_API_ADJUDICATION_DSN_ENV} names database '${named}', not the rebuild target '${database}'.`);
  }
  return { database, dsn };
}

/** Per target, so a capture can never be reinstated into the other rebuild target. */
export function captureDirectory(repoRoot: string, database: string): string {
  return join(repoRoot, 'backups', 'rebuild', database);
}

export function readPendingCapture(dir: string, database: string): LedgerCapture | null {
  const path = join(dir, PENDING_CAPTURE_FILE);
  return existsSync(path) ? parseLedgerCapture(readFileSync(path, 'utf8'), database) : null;
}

const fileSha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Written to a temporary name and renamed, so a half-written capture never exists. */
export function writePendingCapture(dir: string, capture: LedgerCapture): { path: string; sha256: string } {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, PENDING_CAPTURE_FILE);
  const text = `${JSON.stringify(capture, null, 2)}\n`;
  writeFileSync(`${path}.tmp`, text, 'utf8');
  renameSync(`${path}.tmp`, path);
  return { path, sha256: fileSha256(text) };
}

export function archivedCaptureName(capture: LedgerCapture): string {
  return `afl-api-adjudications.${capture.capturedAt.replace(/[-:.]/g, '')}`
    + `.${capture.payloadSha256.slice(0, 12)}.reinstated.json`;
}

/** After a COMMITTED reinstatement the capture is no longer pending; it is kept, renamed. */
export function archivePendingCapture(dir: string, capture: LedgerCapture): string {
  const archived = join(dir, archivedCaptureName(capture));
  renameSync(join(dir, PENDING_CAPTURE_FILE), archived);
  return archived;
}

// ---------------------------------------------------------------------------
// Database steps
// ---------------------------------------------------------------------------

function parseId(value: string | null, what: string): number | null {
  if (value === null) return null;
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new AdjudicationRebuildRefused(`${what} '${value}' is not a safe positive integer.`);
  }
  return Number(value);
}

/** The whole ledger with each actor's email, in id order; `present: false` before migration 104. */
export async function readLedger(
  tx: TransactionSql,
): Promise<{ present: boolean; rows: CapturedLedgerRow[] }> {
  const [{ present }] = await tx<{ present: boolean }[]>`
    SELECT to_regclass('public.afl_api_identity_adjudications') IS NOT NULL AS present
  `;
  if (!present) return { present: false, rows: [] };
  const raw = await tx<(Omit<CapturedLedgerRow, 'id' | 'supersedesId'> & { id: string; supersedesId: string | null })[]>`
    SELECT a.id::text AS id, a.source_key AS "sourceKey", a.external_id AS "externalId", a.action,
           a.player_id AS "playerId", a.player_identity AS "playerIdentity",
           a.previous_state::text AS "previousState", a.evidence::text AS evidence,
           a.evidence_sha256 AS "evidenceSha256",
           a.surname_disagreement_acknowledged AS "surnameDisagreementAcknowledged",
           a.supersedes_id::text AS "supersedesId", a.admin_user_id AS "adminUserId",
           u.email AS "adminEmail", u.role AS "adminRole", a.note,
           to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt"
      FROM afl_api_identity_adjudications a
      JOIN auth_users u ON u.id = a.admin_user_id
     ORDER BY a.id
  `;
  const [{ total }] = await tx<{ total: number }[]>`
    SELECT count(*)::int AS total FROM afl_api_identity_adjudications
  `;
  if (total !== raw.length) {
    throw new AdjudicationRebuildRefused(
      `The ledger holds ${total} row(s) but only ${raw.length} carry a resolvable actor.`);
  }
  return {
    present: true,
    rows: raw.map((r) => ({
      ...r,
      id: parseId(r.id, 'ledger id')!,
      supersedesId: parseId(r.supersedesId, 'supersedes_id'),
    })),
  };
}

/**
 * Reuse the account with each captured actor's email, untouched; otherwise create the
 * attribution-only account (header): the captured email and role, NULL password hash,
 * NULL TOTP secret, disabled at creation. No session, no other auth state.
 */
export async function remapActors(
  tx: TransactionSql, rows: readonly CapturedLedgerRow[],
): Promise<{ actorIdByEmail: Map<string, number>; reused: number; created: number; reusedWithDifferentRole: number }> {
  const emails = [...new Set(rows.map((r) => r.adminEmail.toLowerCase()))];
  const existing = emails.length === 0 ? [] : await tx<ExistingActor[]>`
    SELECT id, email, role FROM auth_users WHERE lower(email) = ANY(${emails}::text[])
  `;
  const plan = planActorRemap(rows, existing);
  const actorIdByEmail = new Map(plan.reuse);
  for (const actor of plan.create) {
    const [row] = await tx<{ id: number }[]>`
      INSERT INTO auth_users (email, role, password_hash, totp_secret, disabled_at)
      VALUES (${actor.email}, ${actor.role}, NULL, NULL, now())
      RETURNING id
    `;
    actorIdByEmail.set(actor.email.toLowerCase(), row.id);
  }
  return {
    actorIdByEmail, reused: plan.reuse.size, created: plan.create.length,
    reusedWithDifferentRole: plan.reusedWithDifferentRole,
  };
}

/** The ledger's identity sequence, proven to be the one migration 104 created. */
async function ledgerSequenceName(tx: TransactionSql): Promise<string> {
  const [seq] = await tx<{ name: string | null }[]>`
    SELECT pg_get_serial_sequence('afl_api_identity_adjudications', 'id') AS name
  `;
  if (seq?.name !== `public.${LEDGER_ID_SEQUENCE}`) {
    throw new AdjudicationRebuildRefused(
      `The ledger's identity sequence is '${String(seq?.name)}', not public.${LEDGER_ID_SEQUENCE}.`);
  }
  return seq.name;
}

async function readSequenceState(tx: TransactionSql): Promise<{ lastValue: number; isCalled: boolean }> {
  const [state] = await tx<{ lastValue: string; isCalled: boolean }[]>`
    SELECT last_value::text AS "lastValue", is_called AS "isCalled" FROM ${tx(LEDGER_ID_SEQUENCE)}
  `;
  return { lastValue: parseId(state.lastValue, 'sequence last_value')!, isCalled: state.isCalled };
}

/**
 * The recovery observation (header, RECOVERY), inside the caller's READ-ONLY transaction.
 * The replay is the authority itself, run in a savepoint: in a read-only transaction any
 * INSERT it would need fails instead of writing, and that failure is recorded, not thrown.
 */
export async function observeLiveReinstatement(tx: TransactionSql): Promise<LiveReinstatementObservation> {
  const [{ readOnly }] = await tx<{ readOnly: string }[]>`
    SELECT current_setting('transaction_read_only') AS "readOnly"
  `;
  if (readOnly !== 'on') {
    throw new AdjudicationRebuildRefused('The recovery observation must run in a read-only transaction.');
  }
  await ledgerSequenceName(tx);
  const sequence = await readSequenceState(tx);
  let bijection: LiveReinstatementObservation['bijection'] = 'ok';
  try {
    await tx.savepoint((sp) => assertAflApiAdjudicationBijection(sp));
  } catch (error) {
    bijection = { error: (error as Error).message };
  }
  let replay: LiveReinstatementObservation['replay'];
  try {
    replay = await tx.savepoint((sp) => replayAflApiAdjudications(sp));
  } catch (error) {
    replay = { error: (error as Error).message };
  }
  return { sequence, replay, bijection };
}

export type ReinstateReport = {
  ledgerRows: number;
  actorsReused: number;
  actorsReusedWithDifferentRole: number;
  actorsCreated: number;
  nextLedgerId: number;
  replay: AflApiReplayCounts;
};

/**
 * OD-5 (ii), whole, inside the CALLER'S transaction: reinstate, remap, sequence, read-back,
 * D15 replay, bijection. Throws on the first problem, so the caller's rollback leaves no
 * ledger row, no attribution row and no human identity behind.
 */
export async function reinstateAndReplay(
  tx: TransactionSql, capture: LedgerCapture,
): Promise<ReinstateReport> {
  // Structure and actor roles first: an invalid capture refuses before any statement runs.
  const structural = capturedRowProblems(capture.rows);
  if (structural.length > 0) {
    throw new AdjudicationRebuildRefused(
      `The afl_api adjudication capture cannot be reinstated; nothing was written: ${structural.join('; ')}`);
  }
  const existing = await readLedger(tx);
  if (!existing.present) {
    throw new AdjudicationRebuildRefused(
      'afl_api_identity_adjudications does not exist on the rebuilt database: migration 104 has not run.');
  }
  if (existing.rows.length > 0) {
    throw new AdjudicationRebuildRefused(
      `The rebuilt ledger already holds ${existing.rows.length} row(s); reinstatement needs it empty.`);
  }

  // Players first, so a bad identity refuses before any attribution row is created.
  const remapByIdentity = new Map<string, AflApiPlayerRemapResult>();
  for (const identity of new Set(capture.rows.map((r) => r.playerIdentity))) {
    remapByIdentity.set(identity, await resolveAflApiPlayerIdentity(tx, identity));
  }
  const playerProblems = ledgerPlayerRemapProblems(capture.rows, remapByIdentity);
  if (playerProblems.length > 0) {
    throw new AdjudicationRebuildRefused(
      `The afl_api adjudication ledger cannot be reinstated; nothing was written: ${playerProblems.join('; ')}`);
  }

  const actors = await remapActors(tx, capture.rows);
  const plan = planLedgerReinstatement({
    rows: capture.rows, remapByIdentity, actorIdByEmail: actors.actorIdByEmail,
  });

  // The captured jsonb and timestamptz fields are PostgreSQL's own text renderings, bound as
  // `text` and parsed by the server. postgres.js serialises a parameter by the type the server
  // infers for it: bound straight as `jsonb` the captured text would be JSON-encoded a second
  // time, and bound as `timestamptz` it would pass through a JS Date and lose its microseconds.
  for (const r of plan.rows) {
    await tx`
      INSERT INTO afl_api_identity_adjudications
            (id, source_key, external_id, action, player_id, player_identity, previous_state,
             evidence, evidence_sha256, surname_disagreement_acknowledged, supersedes_id,
             admin_user_id, note, created_at)
      OVERRIDING SYSTEM VALUE
      VALUES (${r.id}::bigint, ${r.sourceKey}, ${r.externalId}, ${r.action}, ${r.playerId},
              ${r.playerIdentity}, ${r.previousState}::text::jsonb, ${r.evidence}::text::jsonb,
              ${r.evidenceSha256}, ${r.surnameDisagreementAcknowledged}, ${r.supersedesId}::bigint,
              ${r.adminUserId}, ${r.note}, ${r.createdAt}::text::timestamptz)
    `;
  }

  const sequenceName = await ledgerSequenceName(tx);
  if (plan.rows.length > 0) {
    await tx`SELECT setval(${sequenceName}::regclass, ${plan.maxId}::bigint, true)`;
  }
  const sequenceState = await readSequenceState(tx);
  assertSequenceAboveLedger(sequenceState, plan.maxId);

  const readBack = await readLedger(tx);
  const readBackProblems = reinstatedLedgerProblems(
    plan.rows, readBack.rows.map(({ adminEmail: _email, ...rest }) => rest));
  if (readBackProblems.length > 0) {
    throw new AdjudicationRebuildRefused(
      `The reinstated ledger does not match its capture: ${readBackProblems.join('; ')}`);
  }

  const replay = await replayAflApiAdjudications(tx);
  await assertAflApiAdjudicationBijection(tx);

  return {
    ledgerRows: plan.rows.length,
    actorsReused: actors.reused,
    actorsReusedWithDifferentRole: actors.reusedWithDifferentRole,
    actorsCreated: actors.created,
    nextLedgerId: nextIdentityValue(sequenceState),
    replay,
  };
}

// ---------------------------------------------------------------------------
// CLI — invoked by tools/db/rebuild-test.ts only
// ---------------------------------------------------------------------------

const REPO_ROOT = process.cwd();

function connect(dsn: string) {
  return postgres(dsn, {
    max: 1, onnotice: () => {},
    connection: { application_name: 'afldb-rebuild-afl-api-adjudications' },
  });
}

async function runCapture(database: string, dsn: string, recover: boolean): Promise<void> {
  const dir = captureDirectory(REPO_ROOT, database);
  const pending = readPendingCapture(dir, database);
  const sql = connect(dsn);
  let observedState: {
    live: { present: boolean; rows: CapturedLedgerRow[] };
    decision: PendingCaptureDecision;
    observed: LiveReinstatementObservation | null;
  };
  try {
    // ONE read-only snapshot: the ledger the decision is made on is the ledger observed.
    observedState = await sql.begin('isolation level repeatable read read only', async (tx) => {
      const live = await readLedger(tx);
      const decision = decidePendingCapture({ pending, liveRows: live.rows, recover });
      const observed = decision.action === 'verify-reinstated' ? await observeLiveReinstatement(tx) : null;
      return { live, decision, observed };
    });
  } finally {
    await sql.end();
  }
  const { live } = observedState;
  const outcome = settleCapture({
    dir, database, capturedAt: new Date().toISOString(), pending, ...observedState,
  });
  if (outcome.adopted) {
    console.log(`    RECOVER: reinstating the pending capture from ${outcome.adopted.capturedAt} `
      + `(${outcome.adopted.rows.length} row(s), payload ${outcome.adopted.payloadSha256}).`);
    return;
  }
  if (outcome.archived) {
    console.log(`    RECOVERED: the pending capture from ${pending!.capturedAt} (${pending!.rows.length} row(s)) `
      + 'is already fully reinstated (ledger, sequence, replay no-op, bijection); archived as '
      + `${relative(REPO_ROOT, outcome.archived)}`);
  }
  const { capture, path, sha256 } = outcome.captured!;
  console.log(`    captured ${capture.rows.length} adjudication row(s)`
    + `${live.present ? '' : ' (no ledger table yet: migration 104 not applied)'}`);
  console.log(`    file    : ${relative(REPO_ROOT, path)}`);
  console.log(`    sha256  : ${sha256}`);
  console.log(`    payload : ${capture.payloadSha256}`);
}

async function runReinstate(database: string, dsn: string): Promise<void> {
  const dir = captureDirectory(REPO_ROOT, database);
  const capture = readPendingCapture(dir, database);
  if (!capture) {
    throw new AdjudicationRebuildRefused(
      `No pending adjudication capture in ${relative(REPO_ROOT, dir)}: the capture stage did not run.`);
  }
  const sql = connect(dsn);
  let report: ReinstateReport;
  try {
    report = await sql.begin((tx) => reinstateAndReplay(tx, capture));
  } finally {
    await sql.end();
  }
  const archived = archivePendingCapture(dir, capture);
  console.log(`    reinstated ${report.ledgerRows} ledger row(s) under their original ids; `
    + `next id ${report.nextLedgerId}`);
  console.log(`    actors  : ${report.actorsReused} reused (${report.actorsReusedWithDifferentRole} with a `
    + `different current role, left unchanged), ${report.actorsCreated} attribution-only created `
    + '(captured role, disabled, no credentials)');
  console.log(`    replay  : ${report.replay.inserted} inserted, ${report.replay.noops} no-op; bijection OK`);
  console.log(`    capture : payload ${capture.payloadSha256}, archived as ${relative(REPO_ROOT, archived)}`);
}

async function runBijection(dsn: string): Promise<void> {
  const sql = connect(dsn);
  try {
    await sql.begin('read only', (tx) => assertAflApiAdjudicationBijection(tx));
  } finally {
    await sql.end();
  }
  console.log('    afl_api adjudication bijection: OK');
}

async function main(argv: string[]): Promise<void> {
  const [step, ...rest] = argv;
  const recover = rest.includes('--recover');
  const unknown = rest.filter((a) => a !== '--recover');
  if (unknown.length > 0 || (recover && step !== 'capture')) {
    throw new AdjudicationRebuildRefused(`Unexpected argument(s): ${rest.join(' ')}`);
  }
  const { database, dsn } = resolveAdjudicationTarget(process.env);
  if (step === 'capture') return runCapture(database, dsn, recover);
  if (step === 'reinstate') return runReinstate(database, dsn);
  if (step === 'bijection') return runBijection(dsn);
  throw new AdjudicationRebuildRefused(`Unknown step '${String(step)}': capture, reinstate or bijection.`);
}

if (process.argv[1] && /rebuild_afl_api_adjudications\.ts$/.test(process.argv[1])) {
  main(process.argv.slice(2))
    .then(() => process.exit(0))
    .catch((error) => {
      // Refusal text names tables, ids and paths, never the DSN; a driver error is redacted
      // through the same helper the psql stages use, in case one ever quotes a connection.
      console.error(`    REFUSED: ${redact((error as Error).message)}`);
      process.exit(1);
    });
}
