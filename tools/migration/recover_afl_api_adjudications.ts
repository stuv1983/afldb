#!/usr/bin/env node
/**
 * AFLDB-ISSUE-239 — recovering AFL API human adjudications OUTSIDE D15.
 *
 *     npx tsx tools/migration/recover_afl_api_adjudications.ts export \
 *       --ledger-of <afldb_test|afldb_dev|code_test_db> --output <absolute .json outside any checkout>
 *     npx tsx tools/migration/recover_afl_api_adjudications.ts recover \
 *       --source <file> --expected-payload-sha256 <hex> --target <afldb_test|afldb_dev|code_test_db> \
 *       --validate-only | --dry-run | --apply
 *
 * WHAT D15 ALREADY COVERS, AND WHAT IT DOES NOT. ISSUE-235 D15 (with ISSUE-237) carries the
 * `afl_api_identity_adjudications` ledger and its `resolved` outcome through a promotion and
 * through `db:test:rebuild`: the ledger is reinstated or captured/reinstated, the outcome is
 * replayed, and a bijection gates the result. None of that runs when a LIVE database loses the
 * ledger itself — a table restored from an older backup, an accidental truncate, a database
 * restored from a dump taken before the decisions. The bijection then fails
 * (`row_without_ledger`), every later promotion and rebuild refuses (fail-closed, but stuck), and
 * the human decisions exist nowhere the lifecycle can reach. This tool is that recovery and only
 * that: it is never called by promotion or rebuild, and it changes neither.
 *
 * WHY NO NEW TRACKED ARTEFACT. The ledger holds admin e-mail addresses and free-text notes, and
 * it grows continuously in the live database; a tracked copy would expose both and always lag.
 * The durable, hash-bound record already exists: every `db:test:rebuild` Stage 2 writes a
 * combined capture (`afldb.afl_api_identities.rebuild_capture`, v3 since AFLDB-ISSUE-238 slice 7)
 * and archives it after the reinstate, and `export` below writes the ledger section of any
 * readable database (a restored backup included) in the same shape, UNTRACKED (outside every
 * checkout, never overwritten). The recovery accepts either, and reads only the ledger section.
 * A v3 capture can hold `corrected` rows; their `previous_player_identity` is carried verbatim and
 * resolved, never remapped. An ARCHIVED v2 capture (written before slice 7, so it could never hold
 * a corrected row) stays readable through a narrow recovery-only reader
 * (`parseArchivedV2RebuildCaptureLedger`); the rebuild pipeline itself refuses v2.
 *
 * WHAT IT PRESERVES. Every recovered ledger row is the source row verbatim — id, provider,
 * action, `player_identity`, previous state, evidence and its hash, the surname acknowledgement,
 * `supersedes_id`, note and `created_at` — with only the two surrogates remapped, exactly as the
 * D15 rebuild reinstatement does (`planLedgerReinstatement`): `player_id` from the row's OWN
 * stable identity (the shared reverse lookup, continuity rules included), `admin_user_id` from
 * the actor's e-mail (an existing account is reused untouched; otherwise an attribution-only,
 * sign-in-incapable account is created, `planActorRemap`). No decision is created, altered or
 * inferred: the outcome is then produced by the D15 replay itself (`replayAflApiAdjudications`,
 * `expectedSupersedes = {}`), and the transaction ends on the bijection and the combined identity
 * invariant.
 *
 * FAIL-CLOSED. The recovery refuses, writing nothing, when:
 *   - the source is not a recovery export or a v3 (or archived v2) combined capture, fails its own hash, or is not
 *     the payload the operator named (`--expected-payload-sha256`);
 *   - the source's ledger database is not the target (a decision is recovered only into the
 *     deployment that made it), or the target is not on the closed list (no PROD entry);
 *   - a `db:test:rebuild` capture is pending on the target (its D11b marker is set);
 *   - the target ledger holds a row the source does not (a decision taken after the source), or a
 *     row with the same id that differs, or a row whose `player_id` is not its identity's player;
 *   - any source identity resolves to no player, several players, or contradicts a tracked
 *     continuity rule;
 *   - an actor cannot be remapped;
 *   - the D15 replay STOPs: an importer or other row for the provider, or the player already
 *     holding another provider (current importer/human state always wins; nothing is overwritten);
 *   - the bijection or the combined invariant fails afterwards.
 *
 * IDEMPOTENT. A rerun finds every source row already present and identical and the replay all
 * no-ops: it writes nothing, not even an import batch.
 *
 * AUDIT. An apply that writes records one `import_batches` row (source `afl_api`, target table
 * `afl_api_identity_adjudications`) whose `validation_result` names the source kind, its payload
 * and file hashes, the ledger database, every reinstated ledger id, the actors created and the
 * replay counts. The reinstated rows keep their original authorship and time.
 *
 * ROLE. Recovery writes `auth_users` (attribution-only actors) and may have to raise the ledger's
 * identity sequence, which `afldb_import` cannot do: use the owner DSN in
 * `AFLDB_AFL_API_ADJUDICATION_RECOVERY_DATABASE_URL`. A missing privilege fails the transaction.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres, { type TransactionSql } from 'postgres';

import {
  AFL_API_LEDGER_ACTIONS,
  AFL_API_PROVIDER_ID_RE,
  aflApiAlreadySatisfiedCount,
  aflApiContinuityContradictionText,
  aflApiLedgerStructureProblems,
  netLedgerRowsByExternalId,
  planAflApiAdjudicationReplay,
  type AflApiAdjudicationLedgerRow,
  type AflApiLedgerNetAction,
  type AflApiPlayerRemapResult,
} from '../../src/lib/acquisition/afl-api-adjudication';
import { isLifecycleRole, type LifecycleRole } from '../../src/lib/auth/admin-lifecycle';
import { redact } from '../db/psql';
import {
  CAPTURE_FORMAT,
  insertAttributionOnlyActor,
  ledgerSequenceName,
  nextIdentityValue,
  parseCombinedCapture,
  readLedger,
  readSequenceState,
  type ActorRemapPlan,
  type AttributionActor,
  type CapturedLedgerRow,
  type ExistingActor,
} from './rebuild_afl_api_adjudications';
import { resolveR3OutputPath, writeNewFileAtomically } from './recover_afl_api_importer_identities';
import {
  assertAflApiAdjudicationBijection,
  assertAflApiIdentityInvariant,
  readCandidateAflApiState,
  replayAflApiAdjudications,
  resolveAflApiPlayerIdentities,
} from './replay_afl_api_adjudications';

export const TOOL = 'tools/migration/recover_afl_api_adjudications.ts';

export const ADJUDICATION_RECOVERY_FORMAT = 'afldb.afl_api_identity_adjudications.recovery_export';
/** AFLDB-ISSUE-238 (DD-11): v1 -> v2 adds `previousPlayerIdentity` (a `corrected` row's FROM
 * identity, M1) to every exported/recovered row. A v1 export cannot represent that column, so
 * it is refused BY NAME wherever it is met, never silently upgraded (`parseAdjudicationRecoverySource`). */
export const ADJUDICATION_RECOVERY_VERSION = 2;

/** The deployments whose ledger may be exported or recovered. No PROD entry exists. */
export const RECOVERY_LEDGER_DATABASES = ['afldb_test', 'afldb_dev', 'code_test_db'] as const;
export type RecoveryLedgerDatabase = typeof RECOVERY_LEDGER_DATABASES[number];

/** Never read or written by this tool, under any flag. */
const FORBIDDEN_DATABASES = ['afldb', 'afldb_prod'];
/** Live names an export may read only as themselves (a restored scratch copy has its own name). */
const LIVE_DATABASES = [...FORBIDDEN_DATABASES, ...RECOVERY_LEDGER_DATABASES];

export const RECOVERY_SOURCE_DSN_ENV = 'AFLDB_AFL_API_ADJUDICATION_EXPORT_SOURCE_DATABASE_URL';
export const RECOVERY_TARGET_DSN_ENV = 'AFLDB_AFL_API_ADJUDICATION_RECOVERY_DATABASE_URL';

export class AdjudicationRecoveryRefused extends Error {}

const SHA256_RE = /^[0-9a-f]{64}$/;

const isRecoveryDatabase = (name: unknown): name is RecoveryLedgerDatabase =>
  typeof name === 'string' && (RECOVERY_LEDGER_DATABASES as readonly string[]).includes(name);

/* ------------------------------------------------------------------ *
 * The recovery source (pure)
 * ------------------------------------------------------------------ */

/**
 * AFLDB-ISSUE-238 (R238-S4-01, DD-11): recovery-owned. It carries the third action and
 * `previousPlayerIdentity` (M1's FROM identity — never remapped, no FK, migration 106). Since
 * slice 7 the rebuild's own capture-v3 `CapturedLedgerRow` has the same shape; the recovery keeps
 * this type, its validator, comparator and plan as its own (DD-11) so its behaviour never moves
 * with the rebuild pipeline's, and so an ARCHIVED v2 capture maps into it too (OD-S7-1).
 */
export type RecoveryLedgerRow = Omit<CapturedLedgerRow, 'action'> & {
  action: AflApiLedgerNetAction;
  previousPlayerIdentity: string | null;
};

const isPositiveId = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const CREATED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/**
 * AFLDB-ISSUE-238 (DD-11): the recovery-owned structural validator. Reproduces
 * `capturedRowProblems`' (rebuild, pinned) v2 rules for `linked`/`revoked` rows byte-for-byte,
 * PLUS the `corrected` rules (M1, DD-2) via the shared `aflApiLedgerStructureProblems` and the
 * `previous_state IS NOT NULL` check migration 106's CHECK enforces on a real database. Used
 * INSTEAD of `capturedRowProblems` everywhere on the recovery path (DD-11: the v2-era
 * `capturedRowProblems` refused any `corrected` row outright, the HIGH finding R238-S4-01; the
 * recovery keeps its own validator rather than following the rebuild's).
 */
export function recoveryRowProblems(rows: readonly RecoveryLedgerRow[]): string[] {
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
    if (!(AFL_API_LEDGER_ACTIONS as readonly string[]).includes(r.action)) {
      problems.push(`${at}: action is not linked/revoked/corrected`);
    }
    if (r.action === 'revoked' && r.supersedesId === null) {
      problems.push(`${at}: supersedes_id must be set on a revoked row`);
    }
    if (r.action === 'linked' && r.supersedesId !== null) {
      problems.push(`${at}: supersedes_id must be null on a linked row`);
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
    if (r.action === 'corrected' && r.previousState === null) {
      problems.push(`${at}: a corrected row has no previous_state (M1, migration 106)`);
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
  // DD-2's corrected-row structural rules (previous_player_identity shape, supersede/preceding
  // row, at most one per provider, terminal in v1) — the same validator every OTHER ledger
  // reader runs, so recovery never invents its own reading of the corrected contract.
  problems.push(...aflApiLedgerStructureProblems(rows.map((r): AflApiAdjudicationLedgerRow => ({
    id: r.id, externalId: r.externalId, action: r.action, playerId: r.playerId,
    playerIdentity: r.playerIdentity, supersedesId: r.supersedesId,
    previousPlayerIdentity: r.previousPlayerIdentity, evidenceSha256: r.evidenceSha256,
  }))));
  return problems;
}

/* HISTORY NOTE (AFLDB-ISSUE-238 slice 7). The "(rebuild, pinned)" notes on the mirrors below
 * describe the v2-era rebuild shapes they were written against (slice 4, DD-10/DD-11): then
 * two-action and refusing `corrected`. Since slice 7 the rebuild's own shapes are capture v3,
 * three-action, and `ledgerTuple` also appends `previousPlayerIdentity` last. The recovery keeps
 * its own mirrors by decision (DD-11), so its behaviour does not move with the rebuild's. */

/** The v2 `ledgerTuple` (rebuild, pinned) field order, mirrored rather than imported —
 * `RecoveryLedgerRow`'s three-action union is not assignable to `ledgerTuple`'s pinned
 * two-action `ReinstatementRow` parameter (DD-10) — plus `previousPlayerIdentity` (DD-11). */
function recoveryLedgerTuple(r: RecoveryLedgerRow): unknown[] {
  return [r.id, r.sourceKey, r.externalId, r.action, r.playerId, r.playerIdentity, r.previousState,
    r.evidence, r.evidenceSha256, r.surnameDisagreementAcknowledged, r.supersedesId, r.adminUserId,
    r.note, r.createdAt, r.previousPlayerIdentity];
}

/** `sameLedgerRow`'s (rebuild, pinned) rule, mirrored on `RecoveryLedgerRow` with
 * `previousPlayerIdentity` in the compared tuple: a same-id target row differing ONLY in
 * `previous_player_identity` is NOT identical (R238-S4-01 case (c)). */
export function sameRecoveryLedgerRow(a: RecoveryLedgerRow, b: RecoveryLedgerRow): boolean {
  const key = (r: RecoveryLedgerRow) => JSON.stringify(
    [...recoveryLedgerTuple({ ...r, playerId: 0, adminUserId: 0 }), r.adminEmail.toLowerCase()]);
  return key(a) === key(b);
}

/** `ledgerPlayerRemapProblems` (rebuild, pinned) checks only `playerIdentity`/`id`/`externalId`,
 * never `action` — but its TYPE is pinned to the two-action `CapturedLedgerRow`, so
 * `RecoveryLedgerRow`'s wider action union is not assignable to it. Mirrored here rather than
 * cast through `unknown`. */
function recoveryLedgerPlayerRemapProblems(
  rows: readonly RecoveryLedgerRow[],
  remapByIdentity: ReadonlyMap<string, AflApiPlayerRemapResult>,
): string[] {
  const problems: string[] = [];
  for (const r of rows) {
    const remap = remapByIdentity.get(r.playerIdentity);
    if (remap?.ok === false && remap.reason === 'continuity_contradiction') {
      problems.push(`ledger row ${r.id} (${r.externalId}): player_identity '${r.playerIdentity}' `
        + aflApiContinuityContradictionText(remap));
    } else if (!remap || !remap.ok) {
      problems.push(`ledger row ${r.id} (${r.externalId}): player_identity '${r.playerIdentity}' `
        + `${remap?.ok === false && remap.reason === 'ambiguous' ? 'names more than one' : 'names no'} rebuilt player`);
    } else if (remap.remappedIdentity !== r.playerIdentity) {
      problems.push(`ledger row ${r.id} (${r.externalId}): the remapped identity differs from the stored one`);
    }
  }
  return problems;
}

/** `planActorRemap` (rebuild, pinned) calls `capturedRowProblems` internally, which refuses any
 * `corrected` row outright — the same HIGH finding (R238-S4-01) `recoveryRowProblems` exists to
 * avoid, just for actor remapping. Mirrored on `RecoveryLedgerRow`/`recoveryRowProblems`
 * instead: "capturedRowProblems is not called on the recovery path" (DD-11) applies here too,
 * since `planActorRemap` is not a mechanical wrapper around it. */
function recoveryPlanActorRemap(
  rows: readonly RecoveryLedgerRow[], existing: readonly ExistingActor[],
): ActorRemapPlan {
  const problems = recoveryRowProblems(rows);
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
    throw new AdjudicationRecoveryRefused(
      `The afl_api adjudication actors cannot be remapped; nothing was written: ${problems.join('; ')}`);
  }
  return plan;
}

/**
 * `planLedgerReinstatement` (rebuild, pinned) is typed on the two-action `CapturedLedgerRow` and
 * calls `capturedRowProblems`, which refuses a `corrected` row outright — exactly the HIGH
 * finding (R238-S4-01) this recovery-owned mirror avoids. Same two-surrogate remap (`player_id`
 * from the row's OWN identity, `admin_user_id` from the actor email); `previousPlayerIdentity`
 * is carried VERBATIM, never remapped (it has no FK, migration 106). The caller has already run
 * `recoveryRowProblems` and the identity/actor checks above; this never re-validates.
 */
function planRecoveryReinstatement(input: {
  rows: readonly RecoveryLedgerRow[];
  remapByIdentity: ReadonlyMap<string, AflApiPlayerRemapResult>;
  /** Keyed by lower(email). */
  actorIdByEmail: ReadonlyMap<string, number>;
}): RecoveryLedgerRow[] {
  return input.rows.map((r): RecoveryLedgerRow => {
    const remap = input.remapByIdentity.get(r.playerIdentity) as Extract<AflApiPlayerRemapResult, { ok: true }>;
    const actorId = input.actorIdByEmail.get(r.adminEmail.toLowerCase());
    if (actorId === undefined) {
      throw new AdjudicationRecoveryRefused(`ledger row ${r.id} (${r.externalId}): its actor was not remapped`);
    }
    return { ...r, playerId: remap.newPlayerId, adminUserId: actorId };
  });
}

export type AdjudicationRecoveryExport = {
  format: typeof ADJUDICATION_RECOVERY_FORMAT;
  version: typeof ADJUDICATION_RECOVERY_VERSION;
  /** The deployment whose decisions these are: the only database they may be recovered into. */
  ledgerDatabase: RecoveryLedgerDatabase;
  /** The database actually read (the ledger database itself, or a restored scratch copy of it). */
  sourceDatabase: string;
  capturedAt: string;
  ledgerRows: RecoveryLedgerRow[];
  payloadSha256: string;
};

/** Every field of every row in one fixed order, so the hash never depends on key order. AFLDB-
 * ISSUE-238 (DD-11): `previousPlayerIdentity` is appended last, so a zero-corrected export (every
 * row's value `null`) still hashes deterministically and the v1 tuple prefix stays recognisable. */
function exportPayloadSha256(body: Omit<AdjudicationRecoveryExport, 'payloadSha256'>): string {
  const rows = body.ledgerRows.map((r) => [
    r.id, r.sourceKey, r.externalId, r.action, r.playerId, r.playerIdentity, r.previousState, r.evidence,
    r.evidenceSha256, r.surnameDisagreementAcknowledged, r.supersedesId, r.adminUserId, r.adminEmail,
    r.adminRole, r.note, r.createdAt, r.previousPlayerIdentity,
  ]);
  return createHash('sha256').update(JSON.stringify([
    body.format, body.version, body.ledgerDatabase, body.sourceDatabase, body.capturedAt, rows,
  ]), 'utf8').digest('hex');
}

export function buildAdjudicationRecoveryExport(input: {
  ledgerDatabase: RecoveryLedgerDatabase; sourceDatabase: string; capturedAt: string;
  ledgerRows: readonly RecoveryLedgerRow[];
}): AdjudicationRecoveryExport {
  const problems = recoveryRowProblems(input.ledgerRows);
  if (problems.length > 0) {
    throw new AdjudicationRecoveryRefused(`The ledger is not structurally recoverable: ${problems.join('; ')}`);
  }
  const body: Omit<AdjudicationRecoveryExport, 'payloadSha256'> = {
    format: ADJUDICATION_RECOVERY_FORMAT, version: ADJUDICATION_RECOVERY_VERSION,
    ledgerDatabase: input.ledgerDatabase, sourceDatabase: input.sourceDatabase,
    capturedAt: input.capturedAt, ledgerRows: [...input.ledgerRows],
  };
  return { ...body, payloadSha256: exportPayloadSha256(body) };
}

export type AdjudicationRecoverySource = {
  kind: 'recovery_export' | 'rebuild_capture';
  ledgerDatabase: RecoveryLedgerDatabase;
  sourceDatabase: string;
  capturedAt: string;
  ledgerRows: RecoveryLedgerRow[];
  payloadSha256: string;
  fileSha256: string;
};

/* ------------------------------------------------------------------ *
 * AFLDB-ISSUE-238 OD-S7-1: the ARCHIVED v2 rebuild capture, recovery-only
 * ------------------------------------------------------------------ */

/** The combined rebuild capture's pre-ISSUE-238 version. The rebuild pipeline refuses it by name
 * (`parseCombinedCapture`, v3 only); only this recovery tool still reads an archived one. */
export const ARCHIVED_V2_CAPTURE_VERSION = 2;

/**
 * The v2 combined capture's payload hash, exactly as the v2 tooling computed it — FROZEN here,
 * mirrored field for field rather than imported, so a later change to the live (v3) tuples can
 * never make a genuine v2 archive verify differently: `[format, 2, database, capturedAt,
 * ledgerTablePresent, ledger tuples, importer tuples (by externalId), registration tuples (by
 * token)]`, the v2 ledger tuple having no `previousPlayerIdentity`. Exported for the DB-free suite.
 */
export function archivedV2RebuildCapturePayloadSha256(body: {
  format: unknown; database: unknown; capturedAt: unknown; ledgerTablePresent: unknown;
  ledgerRows: readonly Record<string, unknown>[];
  importerRows: readonly Record<string, unknown>[];
  registrations: readonly Record<string, unknown>[];
}): string {
  const byKey = (key: string) => (a: Record<string, unknown>, b: Record<string, unknown>) =>
    String(a[key]).localeCompare(String(b[key]));
  const byCodeUnits = (key: string) => (a: Record<string, unknown>, b: Record<string, unknown>) =>
    (String(a[key]) < String(b[key]) ? -1 : String(a[key]) > String(b[key]) ? 1 : 0);
  const canonical = JSON.stringify([
    body.format, ARCHIVED_V2_CAPTURE_VERSION, body.database, body.capturedAt, body.ledgerTablePresent,
    body.ledgerRows.map((r) => [r.id, r.sourceKey, r.externalId, r.action, r.playerId, r.playerIdentity,
      r.previousState, r.evidence, r.evidenceSha256, r.surnameDisagreementAcknowledged, r.supersedesId,
      r.adminUserId, r.note, r.createdAt, r.adminEmail, r.adminRole]),
    [...body.importerRows].sort(byKey('externalId')).map((r) => [r.externalId, r.playerIdentity, r.matchMethod,
      r.status, r.candidateCount, r.externalName, r.externalUrl, r.notes]),
    [...body.registrations].sort(byCodeUnits('token')).map((r) => [r.token, r.overrideValues,
      r.afltablesProfilePath, r.createdAt, r.updatedAt, r.adminEmail, r.adminRole]),
  ]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * AFLDB-ISSUE-238 OD-S7-1: the narrow, recovery-only reader for an ARCHIVED v2 combined rebuild
 * capture. It validates the HISTORICAL v2 format — never upgrading it to v3 and never routing it
 * through the rebuild pipeline — and returns only the ledger material recovery needs:
 *
 *   - format, `version: 2`, the named database, every section present, a ledger table;
 *   - the v2 payload hash (`archivedV2RebuildCapturePayloadSha256`) over all three sections;
 *   - ledger rows in the v2 shape only: `linked`/`revoked`, and NO `previousPlayerIdentity` key
 *     (a v2 row could not carry one), each then held to `recoveryRowProblems`.
 *
 * `previousPlayerIdentity: null` is then EXACT, not a guess: v2 refused every corrected row before
 * destruction (DD-10), so no v2 capture can hold one. The importer and registration sections are
 * hashed, never read.
 */
export function parseArchivedV2RebuildCaptureLedger(text: string, database: RecoveryLedgerDatabase): {
  sourceDatabase: string; capturedAt: string; ledgerRows: RecoveryLedgerRow[]; payloadSha256: string;
} {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new AdjudicationRecoveryRefused('The archived v2 rebuild capture is not valid JSON.');
  }
  if (raw.format !== CAPTURE_FORMAT || raw.version !== ARCHIVED_V2_CAPTURE_VERSION) {
    throw new AdjudicationRecoveryRefused('The archived rebuild capture is not the v2 combined format.');
  }
  if (raw.database !== database) {
    throw new AdjudicationRecoveryRefused(`The archived v2 rebuild capture names '${String(raw.database)}', not '${database}'.`);
  }
  const isObjectArray = (v: unknown): v is Record<string, unknown>[] =>
    Array.isArray(v) && v.every((e) => e !== null && typeof e === 'object' && !Array.isArray(e));
  if (typeof raw.capturedAt !== 'string' || typeof raw.ledgerTablePresent !== 'boolean'
      || !isObjectArray(raw.ledgerRows) || !isObjectArray(raw.importerRows) || !isObjectArray(raw.registrations)
      || typeof raw.payloadSha256 !== 'string') {
    throw new AdjudicationRecoveryRefused('The archived v2 rebuild capture is missing a required field.');
  }
  const ledgerRowsRaw = raw.ledgerRows;
  if (archivedV2RebuildCapturePayloadSha256({
    format: raw.format, database: raw.database, capturedAt: raw.capturedAt, ledgerTablePresent: raw.ledgerTablePresent,
    ledgerRows: ledgerRowsRaw, importerRows: raw.importerRows, registrations: raw.registrations,
  }) !== raw.payloadSha256) {
    throw new AdjudicationRecoveryRefused(
      'The archived v2 rebuild capture does not match its own (v2) payload hash: it was altered after capture.');
  }
  if (!raw.ledgerTablePresent) {
    throw new AdjudicationRecoveryRefused('The rebuild capture predates migration 104: it carries no ledger to recover.');
  }
  const shapeProblems: string[] = [];
  for (const r of ledgerRowsRaw) {
    if (r.action !== 'linked' && r.action !== 'revoked') {
      shapeProblems.push(`ledger row ${String(r.id)}: action ${JSON.stringify(r.action)} is not a v2 action (linked/revoked)`);
    }
    if ('previousPlayerIdentity' in r) {
      shapeProblems.push(`ledger row ${String(r.id)}: carries previousPlayerIdentity, which no v2 capture could hold`);
    }
  }
  const ledgerRows = ledgerRowsRaw.map((r) => ({
    id: r.id, sourceKey: r.sourceKey, externalId: r.externalId, action: r.action,
    playerId: r.playerId, playerIdentity: r.playerIdentity, previousState: r.previousState,
    evidence: r.evidence, evidenceSha256: r.evidenceSha256,
    surnameDisagreementAcknowledged: r.surnameDisagreementAcknowledged, supersedesId: r.supersedesId,
    adminUserId: r.adminUserId, adminEmail: r.adminEmail, adminRole: r.adminRole, note: r.note,
    createdAt: r.createdAt, previousPlayerIdentity: null,
  }) as RecoveryLedgerRow);
  const problems = [...shapeProblems, ...(shapeProblems.length > 0 ? [] : recoveryRowProblems(ledgerRows))];
  if (problems.length > 0) {
    throw new AdjudicationRecoveryRefused(`The archived v2 rebuild capture's ledger is not a valid v2 ledger: ${problems.join('; ')}`);
  }
  return { sourceDatabase: database, capturedAt: raw.capturedAt, ledgerRows, payloadSha256: raw.payloadSha256 };
}

/**
 * Parse and PROVE a recovery source: a recovery export, a v3 combined rebuild capture, or
 * (AFLDB-ISSUE-238 OD-S7-1) an ARCHIVED v2 one, of which only the ledger section is used. Each
 * must match its own hash and the payload hash the operator names. Anything else — including the
 * superseded ledger-only and pre-ISSUE-245 captures, which `parseCombinedCapture` itself names and
 * refuses — is refused.
 */
export function parseAdjudicationRecoverySource(text: string, expectedPayloadSha256: string): AdjudicationRecoverySource {
  const expected = expectedPayloadSha256.trim().toLowerCase();
  if (!SHA256_RE.test(expected)) {
    throw new AdjudicationRecoveryRefused('--expected-payload-sha256 must be 64 hex characters.');
  }
  const fileSha256 = createHash('sha256').update(text, 'utf8').digest('hex');
  let raw: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    raw = parsed as Record<string, unknown>;
  } catch {
    throw new AdjudicationRecoveryRefused('The recovery source is not a JSON object.');
  }

  let source: Omit<AdjudicationRecoverySource, 'fileSha256'>;
  if (raw.format === ADJUDICATION_RECOVERY_FORMAT) {
    // AFLDB-ISSUE-238 (DD-11): a v1 export cannot carry `previousPlayerIdentity` (there is no
    // column to read it from); refused BY NAME, never silently upgraded to v2.
    if (raw.version === 1) {
      throw new AdjudicationRecoveryRefused(
        'The recovery export is version 1, which carries no previous_player_identity column and '
        + `cannot represent a corrected row; it is refused, never silently upgraded to v${ADJUDICATION_RECOVERY_VERSION}. `
        + 'Re-export with the current tool.');
    }
    if (raw.version !== ADJUDICATION_RECOVERY_VERSION) {
      throw new AdjudicationRecoveryRefused(`The recovery export version is ${String(raw.version)}, not ${ADJUDICATION_RECOVERY_VERSION}.`);
    }
    if (!isRecoveryDatabase(raw.ledgerDatabase) || typeof raw.sourceDatabase !== 'string'
        || typeof raw.capturedAt !== 'string' || !Array.isArray(raw.ledgerRows) || typeof raw.payloadSha256 !== 'string') {
      throw new AdjudicationRecoveryRefused('The recovery export is missing a required field or names an unsupported ledger database.');
    }
    const rebuilt = buildAdjudicationRecoveryExport({
      ledgerDatabase: raw.ledgerDatabase, sourceDatabase: raw.sourceDatabase, capturedAt: raw.capturedAt,
      ledgerRows: raw.ledgerRows as RecoveryLedgerRow[],
    });
    if (rebuilt.payloadSha256 !== raw.payloadSha256) {
      throw new AdjudicationRecoveryRefused('The recovery export does not match its own payload hash: it was altered after export.');
    }
    source = { kind: 'recovery_export', ...rebuilt };
  } else if (raw.format === CAPTURE_FORMAT) {
    if (!isRecoveryDatabase(raw.database)) {
      throw new AdjudicationRecoveryRefused(`The rebuild capture names '${String(raw.database)}', which is not a recoverable ledger database.`);
    }
    if (raw.version === ARCHIVED_V2_CAPTURE_VERSION) {
      // AFLDB-ISSUE-238 OD-S7-1: an ARCHIVED v2 capture, through the recovery-only reader below.
      // The rebuild pipeline itself (`parseCombinedCapture`) refuses v2 by name; nothing here
      // relaxes it.
      const archived = parseArchivedV2RebuildCaptureLedger(text, raw.database);
      source = { kind: 'rebuild_capture', ledgerDatabase: raw.database, ...archived };
    } else {
      let capture;
      try {
        capture = parseCombinedCapture(text, raw.database);
      } catch (error) {
        throw new AdjudicationRecoveryRefused(`The rebuild capture is refused: ${(error as Error).message}`);
      }
      if (!capture.ledgerTablePresent) {
        throw new AdjudicationRecoveryRefused('The rebuild capture predates migration 104: it carries no ledger to recover.');
      }
      // AFLDB-ISSUE-238 capture v3: a corrected row and every row's `previousPlayerIdentity` are
      // carried VERBATIM (never remapped; the plan below RESOLVES it on the target, R238-S4-05).
      source = {
        kind: 'rebuild_capture', ledgerDatabase: raw.database, sourceDatabase: capture.database,
        capturedAt: capture.capturedAt,
        ledgerRows: capture.ledgerRows.map((r): RecoveryLedgerRow => ({ ...r })),
        payloadSha256: capture.payloadSha256,
      };
    }
  } else {
    throw new AdjudicationRecoveryRefused(
      `The recovery source format ${JSON.stringify(raw.format ?? null)} is neither ${ADJUDICATION_RECOVERY_FORMAT} `
      + `nor ${CAPTURE_FORMAT}.`);
  }
  if (source.payloadSha256 !== expected) {
    throw new AdjudicationRecoveryRefused(
      `The recovery source's payload hash is ${source.payloadSha256}, not the expected ${expected}.`);
  }
  return { ...source, fileSha256 };
}

/* ------------------------------------------------------------------ *
 * The ledger plan (pure)
 * ------------------------------------------------------------------ */

export type LedgerRecoveryPlan = {
  toInsert: RecoveryLedgerRow[];
  identicalIds: number[];
  stops: string[];
};

/**
 * Source ledger vs target ledger, row by id. Only ever ADDS source rows the target lacks; a target
 * row the source does not hold, or a same-id row that differs, is a stop (reconciled by hand).
 * AFLDB-ISSUE-238 (DD-11): `recoveryRowProblems`/`sameRecoveryLedgerRow` instead of
 * `capturedRowProblems`/`sameLedgerRow` — `capturedRowProblems` is not called on the recovery path.
 */
export function planLedgerRecovery(input: {
  source: readonly RecoveryLedgerRow[];
  target: readonly RecoveryLedgerRow[];
}): LedgerRecoveryPlan {
  const stops = recoveryRowProblems(input.source).map((p) => `recovery source: ${p}`);
  const targetById = new Map(input.target.map((r) => [r.id, r]));
  const sourceIds = new Set(input.source.map((r) => r.id));
  const toInsert: RecoveryLedgerRow[] = [];
  const identicalIds: number[] = [];
  for (const row of input.source) {
    const existing = targetById.get(row.id);
    if (!existing) { toInsert.push(row); continue; }
    if (sameRecoveryLedgerRow(row, existing)) identicalIds.push(row.id);
    else stops.push(`target ledger row ${row.id} (${existing.externalId}) differs from the recovery source's row ${row.id}`);
  }
  for (const row of input.target) {
    if (!sourceIds.has(row.id)) {
      stops.push(`target ledger row ${row.id} (${row.externalId}, ${row.action}) is not in the recovery source: a `
        + 'decision recorded after the source was taken is never merged automatically');
    }
  }
  return { toInsert, identicalIds, stops };
}

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

export type RecoveryMode = 'validate-only' | 'dry-run' | 'apply';

export type RecoveryConnection = {
  begin: <T>(options: string, fn: (tx: TransactionSql) => Promise<T>) => Promise<T>;
};

export type AdjudicationRecoveryReport = {
  mode: RecoveryMode;
  outcome: 'READ_ONLY' | 'ROLLED_BACK' | 'COMMITTED' | 'ALREADY_RECOVERED';
  source: { kind: AdjudicationRecoverySource['kind']; payloadSha256: string; fileSha256: string; ledgerDatabase: string; rows: number };
  ledgerRowsReinstated: number[];
  ledgerRowsIdentical: number;
  actorsToCreate: number;
  outcomeInserts: string[];
  outcomeNoops: number;
  /** AFLDB-ISSUE-238 (R238-S4-02): how many of `outcomeNoops` are corrected ALREADY_SATISFIED
   * providers, discriminated via `aflApiAlreadySatisfiedCount`. Zero on every zero-corrected run. */
  outcomeAlreadySatisfied: number;
  importBatchId: string | null;
};

class DryRunRollback extends Error {}

async function assertTarget(tx: TransactionSql, database: string, readOnly: boolean): Promise<void> {
  const [row] = await tx<{ database: string; readOnly: string }[]>`
    SELECT current_database() AS database, current_setting('transaction_read_only') AS "readOnly"
  `;
  if (row?.database !== database) {
    throw new AdjudicationRecoveryRefused(`Connected to '${String(row?.database)}', not the recovery target '${database}'.`);
  }
  if (readOnly && row.readOnly !== 'on') throw new AdjudicationRecoveryRefused('validate-only requires a read-only transaction.');
}

type Planned = {
  ledger: LedgerRecoveryPlan;
  targetLedger: RecoveryLedgerRow[];
  remapByIdentity: ReadonlyMap<string, AflApiPlayerRemapResult>;
  existingActors: ExistingActor[];
  outcome: ReturnType<typeof planAflApiAdjudicationReplay>;
};

/** Everything the recovery decides, from reads alone. Throws on every stop. */
async function planRecovery(tx: TransactionSql, source: AdjudicationRecoverySource): Promise<Planned> {
  // A pending db:test:rebuild capture owns the ledger until its Stage 18 reinstates it (D11b);
  // recovering into that window would make Stage 18 refuse, or worse, race it.
  const [marker] = await tx<{ comment: string | null }[]>`
    SELECT shobj_description(oid, 'pg_database') AS comment FROM pg_database WHERE datname = current_database()
  `;
  if (marker?.comment?.includes(CAPTURE_FORMAT)) {
    throw new AdjudicationRecoveryRefused(
      'A db:test:rebuild capture is pending on the target (its rebuild marker is set); finish or recover that '
      + 'rebuild first. Nothing was written.');
  }
  const target = await readLedger(tx);
  if (!target.present) {
    throw new AdjudicationRecoveryRefused('afl_api_identity_adjudications does not exist on the target: migration 104 has not run.');
  }
  const ledger = planLedgerRecovery({ source: source.ledgerRows, target: target.rows });

  // AFLDB-ISSUE-238 (DD-11): every source/target identity, PLUS every corrected row's
  // `previousPlayerIdentity` (the same namespace, resolved by the same reverse classifier) --
  // one batched call, not a per-row round trip.
  const previousIdentities = source.ledgerRows
    .map((r) => r.previousPlayerIdentity)
    .filter((v): v is string => v !== null);
  const identities = [...new Set([
    ...source.ledgerRows.map((r) => r.playerIdentity), ...previousIdentities,
    ...target.rows.map((r) => r.playerIdentity),
  ])];
  const remapByIdentity = await resolveAflApiPlayerIdentities(tx, identities);
  const stops = [...ledger.stops, ...recoveryLedgerPlayerRemapProblems(source.ledgerRows, remapByIdentity)];
  for (const row of target.rows) {
    const remap = remapByIdentity.get(row.playerIdentity);
    if (remap?.ok && remap.newPlayerId !== row.playerId) {
      stops.push(`target ledger row ${row.id} (${row.externalId}) holds player_id ${row.playerId}, but its identity `
        + `'${row.playerIdentity}' names player ${remap.newPlayerId}`);
    }
  }
  // R238-S4-05: a corrected source row's `previousPlayerIdentity`, resolved on the TARGET with
  // the same reverse classifier as `player_identity` -- unresolvable/ambiguous/a continuity
  // contradiction, or resolving to the SAME player as the row's remapped `player_identity`
  // (P === P′), is a STOP naming the row. The resolved P is validation only; never written.
  for (const row of source.ledgerRows) {
    if (row.action !== 'corrected' || row.previousPlayerIdentity === null) continue;
    const previousRemap = remapByIdentity.get(row.previousPlayerIdentity);
    if (!previousRemap || !previousRemap.ok) {
      stops.push(`recovery source row ${row.id} (${row.externalId}): previous_player_identity `
        + `'${row.previousPlayerIdentity}' `
        + (previousRemap?.ok === false && previousRemap.reason === 'continuity_contradiction'
          ? aflApiContinuityContradictionText(previousRemap)
          : previousRemap?.ok === false && previousRemap.reason === 'ambiguous'
            ? 'names more than one target player'
            : 'names no target player'));
      continue;
    }
    const currentRemap = remapByIdentity.get(row.playerIdentity);
    if (currentRemap?.ok && previousRemap.newPlayerId === currentRemap.newPlayerId) {
      stops.push(`recovery source row ${row.id} (${row.externalId}): previous_player_identity `
        + `'${row.previousPlayerIdentity}' resolves to the same target player `
        + `(${currentRemap.newPlayerId}) as its corrected player_identity '${row.playerIdentity}' (R238-S4-05)`);
    }
  }
  if (stops.length > 0) {
    throw new AdjudicationRecoveryRefused(`The ledger cannot be recovered; nothing was written: ${stops.join('; ')}`);
  }

  const emails = [...new Set(source.ledgerRows.map((r) => r.adminEmail.toLowerCase()))];
  const existingActors = emails.length === 0 ? [] : await tx<ExistingActor[]>`
    SELECT id, email, role FROM auth_users WHERE lower(email) = ANY (${tx.array(emails)}::text[])
  `;
  // Throws its own AdjudicationRecoveryRefused directly (recoveryPlanActorRemap, DD-11); never
  // planActorRemap (rebuild, pinned), which calls capturedRowProblems and refuses corrected rows.
  recoveryPlanActorRemap(source.ledgerRows, existingActors);

  // The D15 replay's own planner over the ledger as it WILL be (target rows plus the rows to
  // reinstate, each at its identity's current player), against the live outcome rows. A
  // corrected row's `previousPlayerIdentity`/`evidenceSha256` are carried through so the shared
  // structural validator (inside `netLedgerRowsByExternalId`) sees the real M1 shape rather than
  // hashing `undefined` (R238-S4-04's failure mode).
  const projected: AflApiAdjudicationLedgerRow[] = [...target.rows, ...ledger.toInsert].map((r) => {
    const remap = remapByIdentity.get(r.playerIdentity) as Extract<AflApiPlayerRemapResult, { ok: true }>;
    return {
      id: r.id, externalId: r.externalId, action: r.action, playerId: remap.newPlayerId,
      playerIdentity: r.playerIdentity, supersedesId: r.supersedesId,
      previousPlayerIdentity: r.previousPlayerIdentity, evidenceSha256: r.evidenceSha256,
    };
  });
  const remapByExternalId = new Map<string, AflApiPlayerRemapResult>();
  for (const [externalId, row] of netLedgerRowsByExternalId(projected)) {
    remapByExternalId.set(externalId, remapByIdentity.get(row.playerIdentity) as AflApiPlayerRemapResult);
  }
  const [afl] = await tx<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afl_api'`;
  if (!afl) throw new AdjudicationRecoveryRefused("sources.key = 'afl_api' not found on the target.");
  const candidate = await readCandidateAflApiState(tx, afl.id);
  const outcome = planAflApiAdjudicationReplay({
    ledgerRows: projected, remapByExternalId, ...candidate, expectedSupersedes: new Set(),
  });
  if (outcome.stops.length > 0) {
    throw new AdjudicationRecoveryRefused(
      `The D15 replay would stop on ${outcome.stops.length} provider id(s); nothing was written: `
      + outcome.stops.map((s) => `${s.externalId} (${s.reason})`).join('; '));
  }
  return { ledger, targetLedger: target.rows, remapByIdentity, existingActors, outcome };
}

export async function recoverAflApiAdjudications(input: {
  mode: RecoveryMode;
  connection: RecoveryConnection;
  targetDatabase: string;
  source: AdjudicationRecoverySource;
}): Promise<AdjudicationRecoveryReport> {
  const { mode, source, targetDatabase } = input;
  if (!isRecoveryDatabase(targetDatabase)) {
    throw new AdjudicationRecoveryRefused(`'${targetDatabase}' is not a recovery target (${RECOVERY_LEDGER_DATABASES.join(', ')}).`);
  }
  if (source.ledgerDatabase !== targetDatabase) {
    throw new AdjudicationRecoveryRefused(
      `The source holds ${source.ledgerDatabase}'s decisions; they are recovered only into ${source.ledgerDatabase}, `
      + `never into ${targetDatabase}.`);
  }
  const base = {
    mode,
    source: { kind: source.kind, payloadSha256: source.payloadSha256, fileSha256: source.fileSha256,
      ledgerDatabase: source.ledgerDatabase, rows: source.ledgerRows.length },
  };

  if (mode === 'validate-only') {
    return input.connection.begin('isolation level repeatable read read only', async (tx) => {
      await assertTarget(tx, targetDatabase, true);
      const planned = await planRecovery(tx, source);
      const actorPlan = recoveryPlanActorRemap(source.ledgerRows, planned.existingActors);
      return {
        ...base, outcome: 'READ_ONLY',
        ledgerRowsReinstated: planned.ledger.toInsert.map((r) => r.id),
        ledgerRowsIdentical: planned.ledger.identicalIds.length,
        actorsToCreate: actorPlan.create.length,
        outcomeInserts: planned.outcome.inserts.map((i) => i.externalId),
        outcomeNoops: planned.outcome.noops.length,
        outcomeAlreadySatisfied: aflApiAlreadySatisfiedCount(planned.outcome.noops),
        importBatchId: null,
      };
    });
  }

  const state: { report: AdjudicationRecoveryReport | null } = { report: null };
  try {
    await input.connection.begin('isolation level read committed', async (tx) => {
      await assertTarget(tx, targetDatabase, false);
      const planned = await planRecovery(tx, source);

      // Actors, exactly as the D15 reinstatement remaps them.
      const actorPlan = recoveryPlanActorRemap(source.ledgerRows, planned.existingActors);
      const actorIdByEmail = new Map(actorPlan.reuse);
      for (const actor of actorPlan.create) {
        actorIdByEmail.set(actor.email.toLowerCase(), await insertAttributionOnlyActor(tx, actor));
      }

      // Ledger rows: the recovery-owned reinstatement plan (DD-11), restricted to the rows the
      // target lacks. `planLedgerReinstatement` (rebuild, pinned) is never called here: it is
      // typed on the two-action `CapturedLedgerRow` and calls `capturedRowProblems`, which
      // refuses any `corrected` row outright.
      const reinstatement = planRecoveryReinstatement({
        rows: source.ledgerRows, remapByIdentity: planned.remapByIdentity, actorIdByEmail,
      });
      const missing = new Set(planned.ledger.toInsert.map((r) => r.id));
      const inserts = reinstatement.filter((r) => missing.has(r.id));
      for (const r of inserts) {
        await tx`
          INSERT INTO afl_api_identity_adjudications
                (id, source_key, external_id, action, player_id, player_identity, previous_state,
                 evidence, evidence_sha256, surname_disagreement_acknowledged, supersedes_id,
                 admin_user_id, note, created_at, previous_player_identity)
          OVERRIDING SYSTEM VALUE
          VALUES (${r.id}::bigint, ${r.sourceKey}, ${r.externalId}, ${r.action}, ${r.playerId},
                  ${r.playerIdentity}, ${r.previousState}::text::jsonb, ${r.evidence}::text::jsonb,
                  ${r.evidenceSha256}, ${r.surnameDisagreementAcknowledged}, ${r.supersedesId}::bigint,
                  ${r.adminUserId}, ${r.note}, ${r.createdAt}::text::timestamptz, ${r.previousPlayerIdentity})
        `;
      }

      // The identity sequence must hand out ids above every ledger row, recovered ones included
      // (a restore can leave it behind even when no row is missing). Only ever raised.
      const maxId = Math.max(0, ...source.ledgerRows.map((r) => r.id), ...planned.targetLedger.map((r) => r.id));
      const sequenceName = await ledgerSequenceName(tx);
      let sequenceRaised = false;
      if (nextIdentityValue(await readSequenceState(tx)) <= maxId) {
        await tx`SELECT setval(${sequenceName}::regclass, ${maxId}::bigint, true)`;
        sequenceRaised = true;
      }
      if (nextIdentityValue(await readSequenceState(tx)) <= maxId) {
        throw new AdjudicationRecoveryRefused(`The ledger identity sequence would reuse an id at or below ${maxId}.`);
      }

      // Every source row must now be present, byte for byte except the surrogates.
      const readBack = await readLedger(tx);
      const byId = new Map(readBack.rows.map((r) => [r.id, r]));
      const missingAfter = source.ledgerRows.filter((r) => {
        const live = byId.get(r.id);
        return !live || !sameRecoveryLedgerRow(r, live);
      });
      if (missingAfter.length > 0 || readBack.rows.length !== source.ledgerRows.length) {
        throw new AdjudicationRecoveryRefused(
          `The recovered ledger does not equal its source (rows ${missingAfter.map((r) => r.id).join(', ') || 'none'} `
          + `differ; ${readBack.rows.length} row(s) present for ${source.ledgerRows.length} in the source).`);
      }

      // The outcome, by the D15 replay itself, then the gates.
      const replay = await replayAflApiAdjudications(tx, new Set());
      if (replay.inserted !== planned.outcome.inserts.length || replay.noops !== planned.outcome.noops.length) {
        throw new AdjudicationRecoveryRefused(
          `The D15 replay did ${replay.inserted} insert(s) and ${replay.noops} no-op(s), not the planned `
          + `${planned.outcome.inserts.length} and ${planned.outcome.noops.length}.`);
      }
      await assertAflApiAdjudicationBijection(tx);
      await assertAflApiIdentityInvariant(tx);

      const wrote = inserts.length > 0 || actorPlan.create.length > 0 || replay.inserted > 0 || sequenceRaised;
      let importBatchId: string | null = null;
      if (wrote) {
        const [afl] = await tx<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afl_api'`;
        const validation = {
          issue: 'AFLDB-ISSUE-239', source_kind: source.kind, payload_sha256: source.payloadSha256,
          file_sha256: source.fileSha256, ledger_database: source.ledgerDatabase, source_database: source.sourceDatabase,
          source_captured_at: source.capturedAt, ledger_ids_reinstated: inserts.map((r) => r.id),
          actors_created: actorPlan.create.map((a) => a.email.toLowerCase()),
          ledger_sequence_raised_to: sequenceRaised ? maxId : null,
          replay: { inserted: replay.inserted, noops: replay.noops },
        };
        const [batch] = await tx<{ id: string }[]>`
          INSERT INTO import_batches (source_id, tool, target_table, status, completed_at, records_read,
                                      records_inserted, validation_result, notes)
          VALUES (${afl.id}, ${TOOL}, 'afl_api_identity_adjudications', 'completed', now(), ${source.ledgerRows.length},
                  ${inserts.length}, ${tx.json(validation as never)},
                  ${`AFLDB-ISSUE-239 human-adjudication recovery from ${source.kind} ${source.payloadSha256}`})
          RETURNING id::text AS id
        `;
        importBatchId = batch.id;
      }

      // AFLDB-ISSUE-238 (R238-S4-02): the EXECUTED side's own discriminant -- `AflApiReplayCounts`
      // now carries `alreadySatisfied` directly (the replay tool's own D15 planner run for real).
      state.report = {
        ...base,
        outcome: wrote ? 'COMMITTED' : 'ALREADY_RECOVERED',
        ledgerRowsReinstated: inserts.map((r) => r.id),
        ledgerRowsIdentical: planned.ledger.identicalIds.length,
        actorsToCreate: actorPlan.create.length,
        outcomeInserts: planned.outcome.inserts.map((i) => i.externalId),
        outcomeNoops: replay.noops,
        outcomeAlreadySatisfied: replay.alreadySatisfied ?? 0,
        importBatchId,
      };
      if (mode === 'dry-run') throw new DryRunRollback();
    });
  } catch (error) {
    if (error instanceof DryRunRollback && state.report !== null) {
      return { ...state.report, outcome: 'ROLLED_BACK', importBatchId: null };
    }
    throw error;
  }
  if (state.report === null) throw new AdjudicationRecoveryRefused('The recovery transaction produced no report.');
  return state.report;
}

/* ------------------------------------------------------------------ *
 * Export (read-only)
 * ------------------------------------------------------------------ */

/** Which database an export may read for `ledgerOf`: that database, or a non-live scratch copy. */
export function assertExportSourceDatabase(sourceDatabase: string, ledgerOf: RecoveryLedgerDatabase): void {
  if (FORBIDDEN_DATABASES.includes(sourceDatabase) || /prod/i.test(sourceDatabase)) {
    throw new AdjudicationRecoveryRefused(`Refusing to read '${sourceDatabase}': PROD is never contacted by this tool.`);
  }
  if (sourceDatabase !== ledgerOf && LIVE_DATABASES.includes(sourceDatabase)) {
    throw new AdjudicationRecoveryRefused(
      `Refusing to export '${sourceDatabase}' as ${ledgerOf}'s ledger: a live database is exported only as itself.`);
  }
}

export async function exportAdjudicationLedger(
  tx: TransactionSql, input: { ledgerOf: RecoveryLedgerDatabase; capturedAt: string },
): Promise<AdjudicationRecoveryExport> {
  const [row] = await tx<{ database: string; readOnly: string }[]>`
    SELECT current_database() AS database, current_setting('transaction_read_only') AS "readOnly"
  `;
  if (row?.readOnly !== 'on') throw new AdjudicationRecoveryRefused('The export must run in a read-only transaction.');
  assertExportSourceDatabase(row.database, input.ledgerOf);
  const ledger = await readLedger(tx);
  if (!ledger.present) throw new AdjudicationRecoveryRefused(`'${row.database}' has no afl_api_identity_adjudications table.`);
  return buildAdjudicationRecoveryExport({
    ledgerDatabase: input.ledgerOf, sourceDatabase: row.database, capturedAt: input.capturedAt, ledgerRows: ledger.rows,
  });
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

type ExportArgs = { command: 'export'; ledgerOf: RecoveryLedgerDatabase; output: string };
type RecoverArgs = {
  command: 'recover'; mode: RecoveryMode; source: string; expectedPayloadSha256: string; target: RecoveryLedgerDatabase;
};

export function parseRecoveryArgs(argv: readonly string[]): ExportArgs | RecoverArgs {
  const [command, ...rest] = argv;
  const values = new Map<string, string>();
  const modes: RecoveryMode[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (flag === '--validate-only' || flag === '--dry-run' || flag === '--apply') {
      modes.push(flag.slice(2) as RecoveryMode);
      continue;
    }
    if (!['--ledger-of', '--output', '--source', '--expected-payload-sha256', '--target'].includes(flag)) {
      throw new AdjudicationRecoveryRefused(`Unknown argument '${flag}'.`);
    }
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) throw new AdjudicationRecoveryRefused(`${flag} needs a value.`);
    if (values.has(flag)) throw new AdjudicationRecoveryRefused(`${flag} is given twice.`);
    values.set(flag, value);
    i += 1;
  }
  const database = (flag: string): RecoveryLedgerDatabase => {
    const value = values.get(flag);
    if (!isRecoveryDatabase(value)) {
      throw new AdjudicationRecoveryRefused(`${flag} must be one of ${RECOVERY_LEDGER_DATABASES.join(', ')}; no PROD entry exists.`);
    }
    return value;
  };
  if (command === 'export') {
    if (modes.length > 0 || values.has('--source') || values.has('--target') || values.has('--expected-payload-sha256')) {
      throw new AdjudicationRecoveryRefused('export takes only --ledger-of and --output.');
    }
    const output = values.get('--output');
    if (!output) throw new AdjudicationRecoveryRefused('export needs --output.');
    return { command, ledgerOf: database('--ledger-of'), output };
  }
  if (command === 'recover') {
    if (modes.length !== 1) throw new AdjudicationRecoveryRefused('recover needs exactly one of --validate-only, --dry-run, --apply.');
    if (values.has('--ledger-of') || values.has('--output')) throw new AdjudicationRecoveryRefused('recover does not take --ledger-of or --output.');
    const source = values.get('--source');
    const expectedPayloadSha256 = values.get('--expected-payload-sha256');
    if (!source || !expectedPayloadSha256) {
      throw new AdjudicationRecoveryRefused('recover needs --source and --expected-payload-sha256.');
    }
    return { command, mode: modes[0], source, expectedPayloadSha256, target: database('--target') };
  }
  throw new AdjudicationRecoveryRefused("The first argument must be 'export' or 'recover'.");
}

/** A DSN from `envName` that names exactly `database` (never printed). */
export function resolveRecoveryDsn(env: Record<string, string | undefined>, envName: string, database: string | null): string {
  const dsn = env[envName]?.trim();
  if (!dsn) throw new AdjudicationRecoveryRefused(`${envName} is not set.`);
  let named: string;
  try {
    named = decodeURIComponent(new URL(dsn).pathname.replace(/^\//, ''));
  } catch {
    throw new AdjudicationRecoveryRefused(`${envName} is not a valid connection URL.`);
  }
  if (FORBIDDEN_DATABASES.includes(named) || /prod/i.test(named)) {
    throw new AdjudicationRecoveryRefused(`${envName} names '${named}': PROD is never contacted by this tool.`);
  }
  if (database !== null && named !== database) {
    throw new AdjudicationRecoveryRefused(`${envName} names '${named}', not '${database}'.`);
  }
  return dsn;
}

export function formatRecoveryReport(report: AdjudicationRecoveryReport): string {
  return [
    `  source ${report.source.kind} (${report.source.rows} ledger row(s) of ${report.source.ledgerDatabase})`,
    `    payload sha256 ${report.source.payloadSha256}, file sha256 ${report.source.fileSha256}`,
    `  mode ${report.mode}: ${report.outcome}`,
    `    ledger rows ${report.mode === 'validate-only' ? 'to reinstate' : 'reinstated'}: ${report.ledgerRowsReinstated.length}`
      + (report.ledgerRowsReinstated.length > 0 ? ` (${report.ledgerRowsReinstated.join(', ')})` : ''),
    `    ledger rows already present and identical: ${report.ledgerRowsIdentical}`,
    `    attribution-only actors ${report.mode === 'validate-only' ? 'to create' : 'created'}: ${report.actorsToCreate}`,
    `    human outcome rows ${report.mode === 'validate-only' ? 'to replay' : 'replayed'}: ${report.outcomeInserts.length}`
      + (report.outcomeInserts.length > 0 ? ` (${report.outcomeInserts.join(', ')})` : ''),
    `    human outcome rows already present: ${report.outcomeNoops}`
      + ` (${report.outcomeAlreadySatisfied} already-satisfied correction(s))`,
    ...(report.importBatchId !== null ? [`    import_batches.id ${report.importBatchId}`] : []),
  ].join('\n');
}

async function main(argv: readonly string[]): Promise<void> {
  const args = parseRecoveryArgs(argv);
  if (args.command === 'export') {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const output = resolveR3OutputPath(args.output, [process.cwd(), repoRoot]);
    const dsn = resolveRecoveryDsn(process.env, RECOVERY_SOURCE_DSN_ENV, null);
    const sql = postgres(dsn, {
      max: 1, onnotice: () => {},
      connection: { application_name: 'afldb-issue239-adjudication-export', default_transaction_read_only: true },
    });
    try {
      const exported = await sql.begin('isolation level repeatable read read only',
        (tx) => exportAdjudicationLedger(tx, { ledgerOf: args.ledgerOf, capturedAt: new Date().toISOString() })) as AdjudicationRecoveryExport;
      writeNewFileAtomically(output, `${JSON.stringify(exported, null, 2)}\n`);
      console.log(`  exported ${exported.ledgerRows.length} ledger row(s) of ${exported.ledgerDatabase} `
        + `(read from ${exported.sourceDatabase}) to ${output}`);
      console.log(`  payloadSha256 ${exported.payloadSha256}`);
    } finally {
      await sql.end({ timeout: 5 });
    }
    return;
  }
  const source = parseAdjudicationRecoverySource(readFileSync(args.source, 'utf8'), args.expectedPayloadSha256);
  const dsn = resolveRecoveryDsn(process.env, RECOVERY_TARGET_DSN_ENV, args.target);
  const readOnly = args.mode === 'validate-only';
  const sql = postgres(dsn, {
    max: 1, onnotice: () => {},
    connection: {
      application_name: `afldb-issue239-adjudication-recovery-${args.mode}`,
      ...(readOnly ? { default_transaction_read_only: true } : {}),
    },
  });
  try {
    const report = await recoverAflApiAdjudications({
      mode: args.mode, targetDatabase: args.target, source,
      connection: { begin: (options, fn) => sql.begin(options, fn) as never },
    });
    console.log(formatRecoveryReport(report));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const invokedDirectly = process.argv[1] !== undefined
  && relative(resolve(process.argv[1]), fileURLToPath(import.meta.url)) === '';

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(`REFUSED: ${redact((error as Error).message)}`);
      console.error('  nothing was written (the transaction rolled back or was never opened)');
      process.exit(1);
    });
}
