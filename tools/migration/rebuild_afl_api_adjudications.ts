/**
 * AFLDB-ISSUE-235 OD-5 / AFLDB-ISSUE-237 D1-D13 — the `afl_api` identity state carried
 * through the destructive `db:test:rebuild`: the human `afl_api_identity_adjudications`
 * ledger (ISSUE-235), and the importer-created `external_identities` rows (ISSUE-237, D5).
 *
 *     npx tsx tools/migration/rebuild_afl_api_adjudications.ts capture [--recover]
 *     npx tsx tools/migration/rebuild_afl_api_adjudications.ts registrations-reinstate
 *     npx tsx tools/migration/rebuild_afl_api_adjudications.ts registrations-verify
 *     npx tsx tools/migration/rebuild_afl_api_adjudications.ts reinstate
 *     npx tsx tools/migration/rebuild_afl_api_adjudications.ts bijection
 *
 * AFLDB-ISSUE-245 adds a THIRD section to the one combined capture: the manual/post-baseline
 * player registrations (`data_overrides('players', 'manual_admin_edit:<token>', 'identity')`,
 * rebuild_manual_registrations.ts). It is captured, verified, adopted or refused together with
 * the other two — never apart — under the same file, hash and marker, and reinstated by two
 * stages of its own (`registrations-reinstate`, `registrations-verify`) around the production
 * `replay_admin_overrides(players)` (replay_manual_registrations.py), all BEFORE `draftguru`
 * and so before Stage 18 below, which can therefore assume every registered player exists.
 *
 * Run ONLY by tools/db/rebuild-test.ts, as its capture/reinstate/validation stages:
 *
 *   capture    BEFORE the reset. ONE combined capture (D10): every ledger row (as before),
 *              PLUS every importer-created `afl_api` row (D5/D6), each with its own forward
 *              stable identity. A capture failure is a stage failure: the reset never runs.
 *              D7 fail-closed: any importer row whose player does not resolve to exactly one
 *              accepted stable identity refuses BEFORE destruction. OD-6: a live snapshot
 *              where a `unique` importer row and an effective LINKED ledger decision agree
 *              for the same provider is broken pre-existing state and also refuses before
 *              destruction (E_rebuild must be empty). After the file is durably written, a
 *              database marker (D11b, a `COMMENT ON DATABASE`) records that a capture is
 *              pending, so a retry — from ANY worktree, via the shared capture root D11a —
 *              can tell a genuinely-empty database from a destroyed one.
 *   reinstate  AFTER `draftguru`, the last stage that adds players. ONE transaction:
 *              (a) importer replay by stable identity, (b) ledger reinstatement, (c) the D15
 *              human replay with expectedSupersedes = {} (rebuild semantics: E_rebuild = ∅
 *              always), (d) exact parity against the capture plus the combined invariant,
 *              (e) clear the marker. Any failure rolls ALL of it back, and the marker is kept.
 *   bijection  READ-ONLY, its own validation stage straight after: the combined D13 invariant,
 *              plus proof that no rebuild marker remains.
 *
 * WHY A CHILD PROCESS, NOT AN IN-PROCESS TRANSACTION. See rebuild-test.ts's `runSql` comment:
 * an un-awaited postgres.js call there once silently never ran. A child process fits the
 * existing stage contract exactly: a non-zero exit fails the stage and stops the rebuild.
 *
 * NO POLICY LIVES HERE. The D5/D7/D9/D13/D15 decisions stay in
 * `src/lib/acquisition/afl-api-adjudication.ts` and `replay_afl_api_adjudications.ts`; this
 * file only moves state across the reset, resolves the capture root and the database marker,
 * and calls them.
 *
 * THE CAPTURE ROOT (D11a/F5). `AFLDB_REBUILD_CAPTURE_ROOT` (`resolveCaptureRoot`,
 * tools/db/rebuild-test.ts) is the ONE shared resolution both this tool and the runner's
 * `precheck` stage use. It must be absolute, usable/creatable and OUTSIDE the invoking
 * checkout, so a retry after a mid-rebuild failure — from another worktree, or after this one
 * has been removed — still finds the same pending capture. No path here is ever derived from
 * `process.cwd()`.
 *
 * THE DATABASE MARKER (D11b). A `COMMENT ON DATABASE` on the target itself: `{format,
 * version, capturedAt, payloadSha256, fileSha256}`. It attaches to the database OBJECT, not a
 * schema, so it survives `RESET_SQL` (proven non-destructively by prerequisite P-M point 2,
 * `tools/db/prove-reset.ts`, and rehearsed destructively by P-M points 3-4, operator-gated).
 * It is set only after the capture file is durably written and before `recreate`, and cleared
 * only inside the Stage 18 commit — so a rolled-back Stage 18 can never permanently lose it
 * (P-M point 4, proven DB-free below). `setRebuildMarker` refuses rather than silently
 * overwrite ANY pre-existing comment, foreign or stale.
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
  aflApiRebuildIdentityRefusalReason,
  aflApiContinuityContradictionText,
  capturedOverlapProviders,
  censusAflApiRows,
  computeAflApiAgreeingProviders,
  importerCaptureStructureProblems,
  importerParityProblems,
  netLedgerRowsByExternalId,
  type AflApiAdjudicationLedgerRow,
  type AflApiForwardIdentityResult,
  type AflApiImporterProjection,
  type AflApiPlayerRemapResult,
  type CapturedImporterRow,
  type CapturedImporterRowProblem,
} from '../../src/lib/acquisition/afl-api-adjudication';
import { isLifecycleRole, type LifecycleRole } from '../../src/lib/auth/admin-lifecycle';
import {
  AFL_API_ADJUDICATION_DSN_ENV,
  AFL_API_ADJUDICATION_TARGET_ENV,
  CAPTURE_ROOT_ENV,
  assertRebuildTargetName,
  databaseOf,
  resolveCaptureRoot,
} from '../db/rebuild-test';
import { redact } from '../db/psql';
import {
  assertAflApiAdjudicationBijection,
  assertAflApiIdentityInvariant,
  readAflApiImporterRows,
  replayAflApiAdjudications,
  replayAflApiImporterRows,
  resolveAflApiPlayerIdentity,
  type AflApiReplayCounts,
} from './replay_afl_api_adjudications';
import {
  insertAttributionOnlyActor,
  manualRegistrationVerificationProblems,
  readLiveRegistrationState,
  registrationCaptureStructureProblems,
  registrationTuple,
  registrationsFromLive,
  reinstateManualRegistrations,
  sameRegistrations,
  sortRegistrations,
  type CapturedRegistration,
  type RegistrationReinstateReport,
} from './rebuild_manual_registrations';

/** Moved to rebuild_manual_registrations.ts (AFLDB-ISSUE-245); re-exported unchanged for its
 * ISSUE-235/237 callers, so the attribution-only shape is still written exactly once. */
export { insertAttributionOnlyActor };

/** Any refusal. Thrown before the reset (capture) or inside the transaction (reinstate). */
export class AdjudicationRebuildRefused extends Error {}

/** AFLDB-ISSUE-237 D10/§7.1: the ONE combined format. A v1/ledger-only file is a different,
 * superseded format (below) and is refused outright, never upgraded. AFLDB-ISSUE-245: version 2
 * adds the registration section; a version-1 combined file cannot say what registrations the
 * database held, so it is refused by name too, never read as "no registrations". */
export const CAPTURE_FORMAT = 'afldb.afl_api_identities.rebuild_capture';
export const CAPTURE_VERSION = 2;
const PRE_REGISTRATION_CAPTURE_VERSION = 1;
/** The ISSUE-235-era ledger-only format this one replaces. Recognised only so it can be named
 * in a clear refusal rather than an opaque "unknown format" one. */
const LEGACY_LEDGER_CAPTURE_FORMAT = 'afldb.afl_api_identity_adjudications.rebuild_capture';
/** Migration 104 names this sequence in its own GRANT, so the name is fixed. */
export const LEDGER_ID_SEQUENCE = 'afl_api_identity_adjudications_id_seq';
/** The pending capture: taken by this or an earlier run and not yet reinstated. */
export const PENDING_CAPTURE_FILE = 'afl-api-identities.capture.json';

const CREATED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// The combined capture format (D10)
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

/**
 * D10's one combined file: ISSUE-235's ledger section, unchanged in shape, plus ISSUE-237's
 * importer section (D6). The sections never travel apart — no importer-only file, marker or
 * decision exists anywhere.
 */
export type CombinedCapture = {
  format: typeof CAPTURE_FORMAT;
  version: typeof CAPTURE_VERSION;
  database: string;
  capturedAt: string;
  /** False when the captured database predates migration 104. `ledgerRows` is then empty. */
  ledgerTablePresent: boolean;
  ledgerRows: CapturedLedgerRow[];
  /** D6, ordered by externalId so the file's byte layout is deterministic. */
  importerRows: CapturedImporterRow[];
  /** AFLDB-ISSUE-245, ordered by token. Empty is valid: a database with no registrations. */
  registrations: CapturedRegistration[];
  payloadSha256: string;
};

/** Every LEDGER column, in one fixed order, so a comparison never depends on JSON key order. */
function ledgerTuple(r: ReinstatementRow): unknown[] {
  return [r.id, r.sourceKey, r.externalId, r.action, r.playerId, r.playerIdentity, r.previousState,
    r.evidence, r.evidenceSha256, r.surnameDisagreementAcknowledged, r.supersedesId, r.adminUserId,
    r.note, r.createdAt];
}

/** Every captured field — the ledger columns plus the actor — for the payload hash. */
function ledgerRowTuple(r: CapturedLedgerRow): unknown[] {
  return [...ledgerTuple(r), r.adminEmail, r.adminRole];
}

/** Every captured field of an importer row EXCEPT `playerId` (audit-only, D6 — excluded from
 * the hash exactly as the OD-4 recovery export excludes it, so a rebuild that only renumbers
 * players never changes the payload hash). */
function importerRowTuple(r: CapturedImporterRow): unknown[] {
  return [r.externalId, r.playerIdentity, r.matchMethod, r.status, r.candidateCount,
    r.externalName, r.externalUrl, r.notes];
}

export function capturePayloadSha256(c: Omit<CombinedCapture, 'payloadSha256'>): string {
  // The registration tuple, like the importer one, leaves out the audit-only surrogates
  // (`playerId`, `adminUserId`), so a rebuild that only renumbers never changes the hash.
  const canonical = JSON.stringify([
    c.format, c.version, c.database, c.capturedAt, c.ledgerTablePresent,
    c.ledgerRows.map(ledgerRowTuple), c.importerRows.map(importerRowTuple),
    c.registrations.map(registrationTuple),
  ]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

const isPositiveId = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

/**
 * Structural problems with the captured LEDGER section only. Not D15 policy: only what a
 * faithful reinstatement needs — unique ascending ids, and every `supersedes_id` naming an
 * EARLIER captured row, so inserting in id order always satisfies the self-reference.
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

function describeImporterProblem(p: CapturedImporterRowProblem): string {
  switch (p.kind) {
    case 'duplicate_provider': return `importer row ${p.externalId}: duplicate provider id`;
    case 'duplicate_identity': return `importer rows: duplicate player identity '${p.playerIdentity}'`;
    case 'unsupported_method': return `importer row ${p.externalId}: unsupported match_method '${p.matchMethod}'`;
    case 'unexpected_candidate_count':
      return `importer row ${p.externalId}: candidate_count ${p.candidateCount}, expected 1`;
    case 'non_null_external_url': return `importer row ${p.externalId}: external_url is not NULL`;
    case 'empty_identity': return `importer row ${p.externalId}: player_identity is empty`;
    default: return 'importer row: unrecognised structural problem';
  }
}

/**
 * AFLDB-ISSUE-245: one actor, one role, across BOTH attributed sections. The registration stage
 * recreates each actor before Stage 18 reuses it by email, so a ledger actor captured in a
 * different role from the same actor's registrations is conflicting actor state, refused here
 * rather than resolved by whichever stage runs first.
 */
function crossSectionActorProblems(
  ledgerRows: readonly CapturedLedgerRow[], registrations: readonly CapturedRegistration[],
): string[] {
  const ledgerRole = new Map<string, unknown>();
  for (const r of ledgerRows) {
    if (typeof r.adminEmail === 'string' && !ledgerRole.has(r.adminEmail.toLowerCase())) {
      ledgerRole.set(r.adminEmail.toLowerCase(), r.adminRole);
    }
  }
  const problems: string[] = [];
  for (const r of registrations) {
    const key = typeof r.adminEmail === 'string' ? r.adminEmail.toLowerCase() : '';
    if (ledgerRole.has(key) && ledgerRole.get(key) !== r.adminRole) {
      problems.push(`registration ${r.token}: its actor ${key} is captured as '${String(r.adminRole)}' `
        + `but as '${String(ledgerRole.get(key))}' in the ledger (conflicting actor state)`);
    }
  }
  return problems;
}

/** D13's combined structural check: the ledger section (unchanged rules), the importer
 * section (D5/D6, `importerCaptureStructureProblems`) and, AFLDB-ISSUE-245, the registration
 * section with the one-role-per-actor rule across it and the ledger. */
export function combinedCaptureStructureProblems(
  ledgerRows: readonly CapturedLedgerRow[], importerRows: readonly CapturedImporterRow[],
  registrations: readonly CapturedRegistration[] = [],
): string[] {
  return [
    ...capturedRowProblems(ledgerRows),
    ...importerCaptureStructureProblems(importerRows).map(describeImporterProblem),
    ...registrationCaptureStructureProblems(registrations),
    ...crossSectionActorProblems(ledgerRows, registrations),
  ];
}

export function buildCombinedCapture(input: {
  database: string; capturedAt: string; ledgerTablePresent: boolean;
  ledgerRows: readonly CapturedLedgerRow[]; importerRows: readonly CapturedImporterRow[];
  registrations?: readonly CapturedRegistration[];
}): CombinedCapture {
  if (!input.ledgerTablePresent && input.ledgerRows.length > 0) {
    throw new AdjudicationRebuildRefused('A capture with no ledger table cannot carry ledger rows.');
  }
  const registrations = sortRegistrations(input.registrations ?? []);
  const problems = combinedCaptureStructureProblems(input.ledgerRows, input.importerRows, registrations);
  if (problems.length > 0) {
    throw new AdjudicationRebuildRefused(
      `The afl_api combined capture is not structurally reinstatable: ${problems.join('; ')}`);
  }
  const importerRows = [...input.importerRows].sort((a, b) => a.externalId.localeCompare(b.externalId));
  const body: Omit<CombinedCapture, 'payloadSha256'> = {
    format: CAPTURE_FORMAT, version: CAPTURE_VERSION, database: input.database,
    capturedAt: input.capturedAt, ledgerTablePresent: input.ledgerTablePresent,
    ledgerRows: [...input.ledgerRows], importerRows, registrations,
  };
  return { ...body, payloadSha256: capturePayloadSha256(body) };
}

/** Parse and PROVE a capture file: format, target, both sections' structure and the hash. A
 * v1/ledger-only (ISSUE-235-era) file is named and refused, never upgraded (D10). */
export function parseCombinedCapture(text: string, expectedDatabase: string): CombinedCapture {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new AdjudicationRebuildRefused('The adjudication capture file is not valid JSON.');
  }
  if (raw.format === LEGACY_LEDGER_CAPTURE_FORMAT) {
    throw new AdjudicationRebuildRefused(
      'The adjudication capture file is the superseded ISSUE-235 ledger-only format '
      + `(${LEGACY_LEDGER_CAPTURE_FORMAT}). It is refused, never upgraded (D10): it can exist `
      + 'only after a failed ISSUE-235-era run, and the operator reconciles it by hand.');
  }
  if (raw.format === CAPTURE_FORMAT && raw.version === PRE_REGISTRATION_CAPTURE_VERSION) {
    throw new AdjudicationRebuildRefused(
      `The adjudication capture file is the pre-AFLDB-ISSUE-245 combined format (v${PRE_REGISTRATION_CAPTURE_VERSION}), `
      + 'which carries no registration section. It is refused, never upgraded: reading it as "no '
      + 'registrations" would silently drop every manual player the database held. It can exist '
      + 'only after a failed pre-ISSUE-245 run; the operator reconciles it by hand.');
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
      || !Array.isArray(raw.ledgerRows) || !Array.isArray(raw.importerRows)
      || !Array.isArray(raw.registrations) || typeof raw.payloadSha256 !== 'string') {
    throw new AdjudicationRebuildRefused('The adjudication capture file is missing required fields.');
  }
  const ledgerRows = (raw.ledgerRows as Record<string, unknown>[]).map((r) => ({
    id: r.id, sourceKey: r.sourceKey, externalId: r.externalId, action: r.action,
    playerId: r.playerId, playerIdentity: r.playerIdentity, previousState: r.previousState,
    evidence: r.evidence, evidenceSha256: r.evidenceSha256,
    surnameDisagreementAcknowledged: r.surnameDisagreementAcknowledged, supersedesId: r.supersedesId,
    adminUserId: r.adminUserId, adminEmail: r.adminEmail, adminRole: r.adminRole, note: r.note,
    createdAt: r.createdAt,
  }) as CapturedLedgerRow);
  const importerRows = (raw.importerRows as Record<string, unknown>[]).map((r) => ({
    externalId: r.externalId, playerIdentity: r.playerIdentity, matchMethod: r.matchMethod,
    status: r.status, candidateCount: r.candidateCount, externalName: r.externalName,
    externalUrl: r.externalUrl, notes: r.notes, playerId: r.playerId,
  }) as CapturedImporterRow);
  const registrations = (raw.registrations as Record<string, unknown>[]).map((r) => ({
    token: r.token, overrideValues: r.overrideValues, afltablesProfilePath: r.afltablesProfilePath,
    createdAt: r.createdAt, updatedAt: r.updatedAt, adminEmail: r.adminEmail, adminRole: r.adminRole,
    adminUserId: r.adminUserId, playerId: r.playerId,
  }) as CapturedRegistration);
  const capture = buildCombinedCapture({
    database: expectedDatabase, capturedAt: raw.capturedAt as string,
    ledgerTablePresent: raw.ledgerTablePresent as boolean, ledgerRows, importerRows, registrations,
  });
  if (capture.payloadSha256 !== raw.payloadSha256) {
    throw new AdjudicationRebuildRefused(
      'The adjudication capture file does not match its own payload hash: it was altered after capture.');
  }
  return capture;
}

// ---------------------------------------------------------------------------
// The pending-capture guard (D11c): a capture is the recovery source for a re-run
// ---------------------------------------------------------------------------

/**
 * Two LEDGER sections are the same ledger when every column agrees except the two surrogates
 * a reinstatement legitimately changes (`player_id`, `admin_user_id`). The actor email is
 * compared case-insensitively, the `uq_auth_users_email_lower` rule. The actor ROLE is not
 * compared: it lives on `auth_users`, not in the ledger, and a reused account keeps whatever
 * role it has now.
 */
export function sameLedger(a: readonly CapturedLedgerRow[], b: readonly CapturedLedgerRow[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((r, i) => sameLedgerRow(r, b[i]));
}

/** `sameLedger`'s per-row rule, exported for AFLDB-ISSUE-239's recovery, which compares a
 * recovery source row with the target's row of the same id. */
export function sameLedgerRow(a: CapturedLedgerRow, b: CapturedLedgerRow): boolean {
  const key = (r: CapturedLedgerRow) => JSON.stringify(
    [...ledgerTuple({ ...r, playerId: 0, adminUserId: 0 }), r.adminEmail.toLowerCase()]);
  return key(a) === key(b);
}

/** Two IMPORTER sections are the same, ignoring only the `playerId` surrogate (D11c: "Equal
 * means both sections are equal, ignoring only the player_id/admin_user_id surrogates"). */
export function sameImporterRows(a: readonly CapturedImporterRow[], b: readonly CapturedImporterRow[]): boolean {
  if (a.length !== b.length) return false;
  const sorted = (rows: readonly CapturedImporterRow[]) =>
    [...rows].sort((x, y) => x.externalId.localeCompare(y.externalId));
  const key = (r: CapturedImporterRow) => JSON.stringify(importerRowTuple(r));
  const sa = sorted(a);
  const sb = sorted(b);
  return sa.every((r, i) => key(r) === key(sb[i]));
}

export type PendingCaptureDecision =
  | { action: 'capture-live' }
  | { action: 'verify-reinstated' }
  | { action: 'adopt-pending' }
  | { action: 'refuse'; reason: string };

/**
 * D11c's whole decision table, generalised to the marker plus BOTH sections. No decision ever
 * splits the sections: they are captured, verified, adopted or refused together, or not at
 * all. See the runbook table for the full row-by-row rationale; the short version:
 *
 *   marker present, no pending file           -> REFUSE (the other-worktree/other-host loss
 *                                                  path F5 describes; NEVER capture-live)
 *   marker present, pending file, live empty   -> --recover adopts it; otherwise REFUSE
 *   marker present, pending equals live        -> verify-reinstated (marker then cleared)
 *   marker present, pending differs from live  -> REFUSE
 *   marker absent,  pending equals live        -> verify-reinstated (post-commit/pre-archive)
 *   marker absent,  pending file, live empty   -> --recover adopts it; otherwise REFUSE
 *   marker absent,  pending file, live differs -> REFUSE
 *   no pending file                            -> capture-live (REFUSE if --recover was given
 *                                                  with nothing to recover from)
 *
 * AFLDB-ISSUE-245: "equal" now means all THREE sections are equal. "Live empty" means both
 * afl_api sections are empty AND the live registrations are either empty or exactly the pending
 * capture's. The second arm is the state a run leaves when it dies after the registration
 * stages committed but before Stage 18 did: the marker is still set (only Stage 18 clears it),
 * the reset is the rollback, and --recover resets and replays every section again from the
 * ORIGINAL capture. Live registrations that differ from the pending ones are never adopted over.
 */
export function decidePendingCapture(input: {
  markerPresent: boolean;
  pending: CombinedCapture | null;
  liveLedgerRows: readonly CapturedLedgerRow[];
  liveImporterRows: readonly CapturedImporterRow[];
  liveRegistrations?: readonly CapturedRegistration[];
  recover: boolean;
}): PendingCaptureDecision {
  const { markerPresent, pending, liveLedgerRows, liveImporterRows, recover } = input;
  const liveRegistrations = input.liveRegistrations ?? [];
  const liveEmpty = liveLedgerRows.length === 0 && liveImporterRows.length === 0
    && (liveRegistrations.length === 0
        || (pending !== null && sameRegistrations(pending.registrations, liveRegistrations)));
  const equalsPending = (c: CombinedCapture) =>
    sameLedger(c.ledgerRows, liveLedgerRows) && sameImporterRows(c.importerRows, liveImporterRows)
    && sameRegistrations(c.registrations, liveRegistrations);

  if (!pending) {
    if (markerPresent) {
      return {
        action: 'refuse',
        reason: 'A rebuild marker is present on the database but no pending capture file was '
          + 'found at the capture root. This is the other-worktree/other-host silent-loss path '
          + '(F5): refusing rather than capturing the live state as a new baseline. Point '
          + `${CAPTURE_ROOT_ENV} at the location holding the pending capture, or resolve by hand.`,
      };
    }
    return recover
      ? { action: 'refuse', reason: '--recover was given, but there is no pending capture to recover from.' }
      : { action: 'capture-live' };
  }

  if (markerPresent) {
    if (liveEmpty) {
      return recover
        ? { action: 'adopt-pending' }
        : {
            action: 'refuse',
            reason: `A rebuild marker and a pending capture (${pending.ledgerRows.length} ledger `
              + `row(s), ${pending.importerRows.length} importer row(s), `
              + `${pending.registrations.length} registration(s), ${pending.capturedAt}) `
              + 'exist, and the live database is empty (most likely reset by an earlier failed '
              + 'run). Re-run with --recover-afl-api-adjudications to reinstate from that capture.',
          };
    }
    if (equalsPending(pending)) return { action: 'verify-reinstated' };
    return {
      action: 'refuse',
      reason: `A rebuild marker and a pending capture (${pending.capturedAt}) exist, but the `
        + 'live database differs from it. Neither can be chosen automatically; reconcile by hand.',
    };
  }

  // marker absent, pending file present
  if (equalsPending(pending)) return { action: 'verify-reinstated' }; // the post-commit/pre-archive crash
  if (liveEmpty) {
    return recover
      ? { action: 'adopt-pending' }
      : {
          action: 'refuse',
          reason: `A pending capture (${pending.ledgerRows.length} ledger row(s), `
            + `${pending.importerRows.length} importer row(s), ${pending.registrations.length} `
            + `registration(s), ${pending.capturedAt}) exists with `
            + 'no rebuild marker, and the live database is empty. Re-run with '
            + '--recover-afl-api-adjudications to adopt it, or reconcile by hand.',
        };
  }
  return {
    action: 'refuse',
    reason: `A pending capture (${pending.capturedAt}) exists with no rebuild marker, and the `
      + 'live database differs from it. Reconcile by hand before rebuilding.',
  };
}

/**
 * What the capture step observes of a live database that already holds the pending capture's
 * state. Read in a READ-ONLY transaction (`observeLiveReinstatement`).
 */
export type LiveReinstatementObservation = {
  sequence: { lastValue: number; isCalled: boolean };
  /** `replayAflApiAdjudications()` run read-only: its counts, or why it could not complete. */
  replay: AflApiReplayCounts | { error: string };
  /** `replayAflApiImporterRows()` run read-only, likewise. */
  importerReplay: { inserted: number; noops: number } | { error: string };
  bijection: 'ok' | { error: string };
  /**
   * AFLDB-ISSUE-245: `manualRegistrationVerificationProblems` against the live registration
   * state — the registration verify stage's own check, re-run read-only. Absent means not
   * observed, which counts as a problem whenever the pending capture carries registrations.
   */
  registrations?: readonly string[];
};

/**
 * Every reason the live database is NOT a completed reinstatement of `pending`. Empty means
 * the earlier run's reinstate transactions committed in full: all three sections match, a
 * sequence that cannot collide with the ledger, human/importer identities a replay would not
 * change, the bijection, and registrations that re-capture exactly (AFLDB-ISSUE-245).
 */
export function reinstatedCaptureProblems(
  pending: CombinedCapture, liveLedgerRows: readonly CapturedLedgerRow[],
  liveImporterRows: readonly CapturedImporterRow[], observed: LiveReinstatementObservation,
  liveRegistrations: readonly CapturedRegistration[] = [],
): string[] {
  const problems: string[] = [];
  if (!sameLedger(pending.ledgerRows, liveLedgerRows)) problems.push('the live ledger differs from the pending capture');
  if (!sameImporterRows(pending.importerRows, liveImporterRows)) {
    problems.push('the live importer identities differ from the pending capture');
  }
  if (!sameRegistrations(pending.registrations, liveRegistrations)) {
    problems.push('the live registrations differ from the pending capture');
  }
  if (observed.registrations === undefined) {
    if (pending.registrations.length > 0) problems.push('the live registrations were not verified');
  } else {
    for (const p of observed.registrations) problems.push(`registration verification: ${p}`);
  }
  const maxId = liveLedgerRows.reduce((max, r) => Math.max(max, r.id), 0);
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
  if ('error' in observed.importerReplay) {
    problems.push(`a replay could not confirm the importer identities: ${observed.importerReplay.error}`);
  } else if (observed.importerReplay.inserted !== 0) {
    problems.push(`a replay would still insert ${observed.importerReplay.inserted} importer identity row(s)`);
  }
  if (observed.bijection !== 'ok') problems.push(`the bijection does not hold: ${observed.bijection.error}`);
  return problems;
}

/**
 * The file half of the capture step, after the live state has been read (and, for
 * `verify-reinstated`, observed). Never touches the database itself — it returns the marker
 * action the CALLER must apply, in its own short transaction (D11b).
 */
export function settleCapture(input: {
  dir: string; database: string; capturedAt: string;
  pending: { capture: CombinedCapture; fileSha256: string } | null;
  live: {
    ledgerPresent: boolean; ledgerRows: readonly CapturedLedgerRow[]; importerRows: readonly CapturedImporterRow[];
    registrations?: readonly CapturedRegistration[];
  };
  decision: PendingCaptureDecision;
  observed: LiveReinstatementObservation | null;
}): {
  adopted: CombinedCapture | null;
  archived: string | null;
  captured: { capture: CombinedCapture; path: string; sha256: string } | null;
  markerAction:
    | { kind: 'none' }
    | { kind: 'set-if-absent' | 'clear-then-set' | 'set'; payloadSha256: string; fileSha256: string; capturedAt: string };
} {
  const { dir, database, pending, live, decision } = input;
  if (decision.action === 'refuse') throw new AdjudicationRebuildRefused(decision.reason);
  if (decision.action === 'adopt-pending') {
    return {
      adopted: pending!.capture, archived: null, captured: null,
      markerAction: {
        kind: 'set-if-absent', payloadSha256: pending!.capture.payloadSha256,
        fileSha256: pending!.fileSha256, capturedAt: pending!.capture.capturedAt,
      },
    };
  }
  let archived: string | null = null;
  if (decision.action === 'verify-reinstated') {
    const problems = input.observed
      ? reinstatedCaptureProblems(pending!.capture, live.ledgerRows, live.importerRows, input.observed,
        live.registrations ?? [])
      : ['the live database was not observed'];
    if (problems.length > 0) {
      throw new AdjudicationRebuildRefused(
        `already_reinstated_unverified: the live database holds the same state as the pending `
        + `capture from ${pending!.capture.capturedAt}, but it cannot be proven to be a completed `
        + `reinstatement: ${problems.join('; ')}. The pending capture was left in place. Resolve `
        + 'this by hand before rebuilding.');
    }
    archived = archivePendingCapture(dir, pending!.capture);
  }
  const capture = buildCombinedCapture({
    database, capturedAt: input.capturedAt, ledgerTablePresent: live.ledgerPresent,
    ledgerRows: live.ledgerRows, importerRows: live.importerRows, registrations: live.registrations ?? [],
  });
  const written = writePendingCapture(dir, capture);
  return {
    adopted: null, archived, captured: { capture, ...written },
    markerAction: {
      kind: decision.action === 'verify-reinstated' ? 'clear-then-set' : 'set',
      payloadSha256: capture.payloadSha256, fileSha256: written.sha256, capturedAt: capture.capturedAt,
    },
  };
}

// ---------------------------------------------------------------------------
// Reinstatement planning (pure) — the LEDGER section; unchanged from ISSUE-235
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
// Target, capture root and files
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

/** AFLDB-ISSUE-237 D11a: per target, under the shared capture root — never `process.cwd()`. */
export function captureDirectory(captureRoot: string, database: string): string {
  return join(captureRoot, database);
}

export function readPendingCapture(dir: string, database: string): CombinedCapture | null {
  const path = join(dir, PENDING_CAPTURE_FILE);
  return existsSync(path) ? parseCombinedCapture(readFileSync(path, 'utf8'), database) : null;
}

const fileSha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Also returns the FILE's own bytes hash, for the marker's `fileSha256` cross-check (D11c):
 * a marker can name the wrong, or a tampered, capture even when its `payloadSha256` alone
 * would not reveal that. */
export function readPendingCaptureWithHash(
  dir: string, database: string,
): { capture: CombinedCapture; fileSha256: string } | null {
  const path = join(dir, PENDING_CAPTURE_FILE);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  return { capture: parseCombinedCapture(text, database), fileSha256: fileSha256(text) };
}

/** Written to a temporary name and renamed, so a half-written capture never exists. */
export function writePendingCapture(dir: string, capture: CombinedCapture): { path: string; sha256: string } {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, PENDING_CAPTURE_FILE);
  const text = `${JSON.stringify(capture, null, 2)}\n`;
  writeFileSync(`${path}.tmp`, text, 'utf8');
  renameSync(`${path}.tmp`, path);
  return { path, sha256: fileSha256(text) };
}

export function archivedCaptureName(capture: CombinedCapture): string {
  return `afl-api-identities.${capture.capturedAt.replace(/[-:.]/g, '')}`
    + `.${capture.payloadSha256.slice(0, 12)}.reinstated.json`;
}

/** After a COMMITTED reinstatement the capture is no longer pending; it is kept, renamed. */
export function archivePendingCapture(dir: string, capture: CombinedCapture): string {
  const archived = join(dir, archivedCaptureName(capture));
  renameSync(join(dir, PENDING_CAPTURE_FILE), archived);
  return archived;
}

// ---------------------------------------------------------------------------
// The database marker (D11b)
// ---------------------------------------------------------------------------

/** `{format, version, capturedAt, payloadSha256, fileSha256}` — the SAME format/version as the
 * capture file, so one string names both (the OD-4 recovery tool's own marker guard already
 * checks for this exact `format` substring). */
export type RebuildMarker = {
  format: typeof CAPTURE_FORMAT;
  version: typeof CAPTURE_VERSION;
  capturedAt: string;
  payloadSha256: string;
  fileSha256: string;
};

function parseRebuildMarker(raw: string): RebuildMarker {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new AdjudicationRebuildRefused(
      'The database carries a comment that is not valid JSON. It is not a rebuild marker this '
      + 'tool set, and it is left untouched — manual marker changes are outside the supported '
      + 'procedure (D11c). Resolve this by hand.');
  }
  const m = obj as Partial<RebuildMarker>;
  if (m.format !== CAPTURE_FORMAT || m.version !== CAPTURE_VERSION
      || typeof m.capturedAt !== 'string'
      || typeof m.payloadSha256 !== 'string' || !SHA256_RE.test(m.payloadSha256)
      || typeof m.fileSha256 !== 'string' || !SHA256_RE.test(m.fileSha256)) {
    throw new AdjudicationRebuildRefused(
      'The database carries a comment that does not match the rebuild marker format/version '
      + `(expected ${CAPTURE_FORMAT} v${CAPTURE_VERSION}). It is not a marker this tool set, and `
      + 'it is left untouched. Resolve this by hand.');
  }
  return {
    format: CAPTURE_FORMAT, version: CAPTURE_VERSION, capturedAt: m.capturedAt,
    payloadSha256: m.payloadSha256, fileSha256: m.fileSha256,
  };
}

async function assertConnectedToTarget(tx: TransactionSql, database: string): Promise<void> {
  const [row] = await tx<{ actual: string }[]>`SELECT current_database() AS actual`;
  if (row.actual !== database) {
    throw new AdjudicationRebuildRefused(`Connected to '${row.actual}', not the expected target '${database}'.`);
  }
}

/** Strict parse; unknown/malformed payload refuses rather than being ignored or guessed at. */
export async function readRebuildMarker(tx: TransactionSql, database: string): Promise<RebuildMarker | null> {
  assertRebuildTargetName(database);
  await assertConnectedToTarget(tx, database);
  const [row] = await tx<{ comment: string | null }[]>`
    SELECT shobj_description(oid, 'pg_database') AS comment FROM pg_database WHERE datname = current_database()
  `;
  const comment = row?.comment ?? null;
  return comment === null ? null : parseRebuildMarker(comment);
}

/** Never overwrites an unrelated/pre-existing database comment silently — it refuses instead
 * whenever ANY comment (ours or foreign) is already present; the caller's decision logic is
 * what proves a marker SHOULD be absent before this is ever called. */
export async function setRebuildMarker(
  tx: TransactionSql, database: string,
  marker: { capturedAt: string; payloadSha256: string; fileSha256: string },
): Promise<void> {
  assertRebuildTargetName(database);
  await assertConnectedToTarget(tx, database);
  if (!SHA256_RE.test(marker.payloadSha256) || !SHA256_RE.test(marker.fileSha256)) {
    throw new AdjudicationRebuildRefused('setRebuildMarker: payloadSha256/fileSha256 must be 64 lowercase hex.');
  }
  const [row] = await tx<{ comment: string | null }[]>`
    SELECT shobj_description(oid, 'pg_database') AS comment FROM pg_database WHERE datname = current_database()
  `;
  if (row?.comment != null) {
    throw new AdjudicationRebuildRefused(
      `${database} already carries a database comment; refusing to overwrite it silently (D11b). `
      + 'Resolve the existing comment by hand before capturing.');
  }
  const full: RebuildMarker = { format: CAPTURE_FORMAT, version: CAPTURE_VERSION, ...marker };
  // COMMENT ON DATABASE's text position is a literal (Sconst), not a bind parameter, so the
  // JSON payload is embedded with dollar-quoting rather than a placeholder. It is pure JSON
  // (only double quotes; the fixed field set here never contains '$'), and `database` is
  // proven above to be one of exactly two allowlisted names, so no value here is attacker- or
  // operator-controlled free text.
  await tx.unsafe(
    `COMMENT ON DATABASE "${database}" IS $afldb_rebuild_marker$${JSON.stringify(full)}$afldb_rebuild_marker$`);
}

/** Sets the comment to NULL, inside the CALLER's transaction (D11b: cleared only inside the
 * Stage 18 commit, so a rolled-back reinstate keeps the marker in place — P-M point 4). */
export async function clearRebuildMarker(tx: TransactionSql, database: string): Promise<void> {
  assertRebuildTargetName(database);
  await assertConnectedToTarget(tx, database);
  await tx.unsafe(`COMMENT ON DATABASE "${database}" IS NULL`);
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
 * attribution-only account (`insertAttributionOnlyActor`).
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
    actorIdByEmail.set(actor.email.toLowerCase(), await insertAttributionOnlyActor(tx, actor));
  }
  return {
    actorIdByEmail, reused: plan.reuse.size, created: plan.create.length,
    reusedWithDifferentRole: plan.reusedWithDifferentRole,
  };
}

/** The ledger's identity sequence, proven to be the one migration 104 created. Exported for
 * AFLDB-ISSUE-239's recovery, which reinstates ids the same way. */
export async function ledgerSequenceName(tx: TransactionSql): Promise<string> {
  const [seq] = await tx<{ name: string | null }[]>`
    SELECT pg_get_serial_sequence('afl_api_identity_adjudications', 'id') AS name
  `;
  if (seq?.name !== `public.${LEDGER_ID_SEQUENCE}`) {
    throw new AdjudicationRebuildRefused(
      `The ledger's identity sequence is '${String(seq?.name)}', not public.${LEDGER_ID_SEQUENCE}.`);
  }
  return seq.name;
}

export async function readSequenceState(tx: TransactionSql): Promise<{ lastValue: number; isCalled: boolean }> {
  const [state] = await tx<{ lastValue: string; isCalled: boolean }[]>`
    SELECT last_value::text AS "lastValue", is_called AS "isCalled" FROM ${tx(LEDGER_ID_SEQUENCE)}
  `;
  return { lastValue: parseId(state.lastValue, 'sequence last_value')!, isCalled: state.isCalled };
}

async function fetchAflApiSourceId(tx: TransactionSql): Promise<number> {
  const [row] = await tx<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afl_api'`;
  if (!row) throw new AdjudicationRebuildRefused("sources.key = 'afl_api' not found on this database.");
  return row.id;
}

/**
 * The capture stage's source lookup (AFLDB-ISSUE-237 L2). `null` when `sources` or
 * `external_identities` does not exist (after RESET_SQL) or holds no afl_api source yet (after
 * `migrations`, before `reference`). Either way no afl_api identity row can exist
 * (`external_identities.source_id REFERENCES sources`, migration 002), so an empty importer
 * section is the truth, not a guess.
 */
export async function fetchAflApiSourceIdIfPresent(tx: TransactionSql): Promise<number | null> {
  const [shape] = await tx<{ sources: boolean; identities: boolean }[]>`
    SELECT to_regclass('public.sources') IS NOT NULL AS sources,
           to_regclass('public.external_identities') IS NOT NULL AS identities
  `;
  if (!shape.sources || !shape.identities) return null;
  const [row] = await tx<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afl_api'`;
  return row?.id ?? null;
}

/**
 * The recovery observation (RECOVERY, header), inside the caller's READ-ONLY transaction.
 * Both replays are the authorities themselves, each run in its own savepoint: in a read-only
 * transaction any INSERT they would need fails instead of writing, and that failure is
 * recorded, not thrown.
 */
export async function observeLiveReinstatement(
  tx: TransactionSql, capturedImporterRows: readonly CapturedImporterRow[],
  capturedRegistrations?: readonly CapturedRegistration[],
): Promise<LiveReinstatementObservation> {
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
  let importerReplay: LiveReinstatementObservation['importerReplay'];
  try {
    importerReplay = await tx.savepoint((sp) => replayAflApiImporterRows(sp, capturedImporterRows));
  } catch (error) {
    importerReplay = { error: (error as Error).message };
  }
  // AFLDB-ISSUE-245: the registration verify stage's own check, re-run on this snapshot. Only
  // when the caller asks for it, so the ISSUE-237 fixture's existing observation is unchanged.
  if (capturedRegistrations === undefined) return { sequence, replay, importerReplay, bijection };
  const registrations = manualRegistrationVerificationProblems(capturedRegistrations, await readLiveRegistrationState(tx));
  return { sequence, replay, importerReplay, bijection, registrations };
}

export type ReinstateReport = {
  importerInserted: number;
  importerNoops: number;
  ledgerRows: number;
  actorsReused: number;
  actorsReusedWithDifferentRole: number;
  actorsCreated: number;
  nextLedgerId: number;
  replay: AflApiReplayCounts;
};

/**
 * Stage 18, whole, inside the CALLER'S transaction, in order: (a) importer replay by stable
 * identity, (b) ledger reinstatement, (c) the D15 human replay with `expectedSupersedes = {}`
 * (rebuild semantics: `E_rebuild` is always empty), (d) exact parity against the capture plus
 * the combined invariant, (e) clear the marker. Throws on the first problem, so the caller's
 * rollback leaves no ledger row, no importer row, no attribution row, no human identity and
 * (P-M point 4) NO marker change behind.
 */
export async function reinstateAndReplay(
  tx: TransactionSql, capture: CombinedCapture,
): Promise<ReinstateReport> {
  // Structure first, both sections: an invalid capture refuses before any statement runs.
  const structural = combinedCaptureStructureProblems(capture.ledgerRows, capture.importerRows);
  if (structural.length > 0) {
    throw new AdjudicationRebuildRefused(
      `The afl_api combined capture cannot be reinstated; nothing was written: ${structural.join('; ')}`);
  }

  // D9/OD-6: E_rebuild re-derived from the capture file ALONE, independent of Stage 2, BEFORE
  // any mutation. A non-empty result is a hard STOP; the marker is kept (nothing below runs).
  const overlap = capturedOverlapProviders({ ledgerRows: capture.ledgerRows, importerRows: capture.importerRows });
  if (overlap.length > 0) {
    throw new AdjudicationRebuildRefused(
      `E_rebuild is not empty in the capture file (OD-6); nothing was written, the marker is `
      + `kept: ${overlap.join(', ')}`);
  }

  // Precondition: the marker must be present and match this capture exactly.
  const marker = await readRebuildMarker(tx, capture.database);
  if (!marker) {
    throw new AdjudicationRebuildRefused(
      'No rebuild marker is present on this database; refusing to reinstate. Nothing was written.');
  }
  if (marker.payloadSha256 !== capture.payloadSha256) {
    throw new AdjudicationRebuildRefused(
      'The rebuild marker does not match the pending capture file; refusing to reinstate. '
      + 'Nothing was written.');
  }

  const existingLedger = await readLedger(tx);
  if (!existingLedger.present) {
    throw new AdjudicationRebuildRefused(
      'afl_api_identity_adjudications does not exist on the rebuilt database: migration 104 has not run.');
  }
  if (existingLedger.rows.length > 0) {
    throw new AdjudicationRebuildRefused(
      `The rebuilt ledger already holds ${existingLedger.rows.length} row(s); reinstatement needs it empty.`);
  }
  const sourceId = await fetchAflApiSourceId(tx);
  const { rows: existingImporterRows } = await readAflApiImporterRows(tx, sourceId);
  if (existingImporterRows.length > 0) {
    throw new AdjudicationRebuildRefused(
      `The rebuilt database already holds ${existingImporterRows.length} importer identity `
      + 'row(s); reinstatement needs it empty.');
  }

  // (a) Importer replay by stable identity. Any STOP throws and rolls back everything.
  const importer = await replayAflApiImporterRows(tx, capture.importerRows);

  // (b) Ledger reinstatement (ISSUE-235, unchanged): players first, so a bad identity refuses
  // before any attribution row is created.
  const remapByIdentity = new Map<string, AflApiPlayerRemapResult>();
  for (const identity of new Set(capture.ledgerRows.map((r) => r.playerIdentity))) {
    remapByIdentity.set(identity, await resolveAflApiPlayerIdentity(tx, identity));
  }
  const playerProblems = ledgerPlayerRemapProblems(capture.ledgerRows, remapByIdentity);
  if (playerProblems.length > 0) {
    throw new AdjudicationRebuildRefused(
      `The afl_api adjudication ledger cannot be reinstated; nothing was written: ${playerProblems.join('; ')}`);
  }
  const actors = await remapActors(tx, capture.ledgerRows);
  const plan = planLedgerReinstatement({
    rows: capture.ledgerRows, remapByIdentity, actorIdByEmail: actors.actorIdByEmail,
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

  // (c) The D15 replay. Rebuild semantics (OD-6): expectedSupersedes = {} always; ANY actual
  // supersede is a hard STOP (aflApiSupersedeMismatch, inside replayAflApiAdjudications).
  const replay = await replayAflApiAdjudications(tx, new Set());

  // (d) Exact parity against the capture, plus the combined invariant (D13).
  const { rows: liveImporterRows } = await readAflApiImporterRows(tx, sourceId);
  const projectionOf = (r: CapturedImporterRow): AflApiImporterProjection => ({
    externalId: r.externalId, playerIdentity: r.playerIdentity, status: r.status,
    candidateCount: r.candidateCount, matchMethod: r.matchMethod, externalName: r.externalName,
    externalUrl: r.externalUrl, notes: r.notes,
  });
  const parityProblems = importerParityProblems({
    captured: capture.importerRows.map(projectionOf), live: liveImporterRows.map(projectionOf),
  });
  if (parityProblems.length > 0) {
    throw new AdjudicationRebuildRefused(
      `The reinstated importer identities do not match the capture (${parityProblems.length} `
      + `problem(s)): ${parityProblems.map((p) => JSON.stringify(p)).join('; ')}`);
  }
  await assertAflApiIdentityInvariant(tx);

  // (e) Clear the marker, INSIDE this same transaction (P-M point 4): a thrown failure at any
  // point above never reaches this line, and a rollback after it still undoes it.
  await clearRebuildMarker(tx, capture.database);

  return {
    importerInserted: importer.inserted, importerNoops: importer.noops,
    ledgerRows: plan.rows.length, actorsReused: actors.reused,
    actorsReusedWithDifferentRole: actors.reusedWithDifferentRole, actorsCreated: actors.created,
    nextLedgerId: nextIdentityValue(sequenceState), replay,
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

type MarkerAction =
  | { kind: 'none' }
  | { kind: 'set-if-absent' | 'clear-then-set' | 'set'; payloadSha256: string; fileSha256: string; capturedAt: string };

/** Applies the marker action `settleCapture` computed, in its OWN short transaction(s) —
 * D11b: "in a separate short transaction, set the marker." */
async function applyMarkerAction(dsn: string, database: string, action: MarkerAction): Promise<void> {
  if (action.kind === 'none') return;
  const sql = connect(dsn);
  try {
    await sql.begin(async (tx) => {
      if (action.kind === 'clear-then-set') {
        const existing = await readRebuildMarker(tx, database);
        if (existing) await clearRebuildMarker(tx, database);
        await setRebuildMarker(tx, database, action);
      } else if (action.kind === 'set-if-absent') {
        const existing = await readRebuildMarker(tx, database);
        if (!existing) await setRebuildMarker(tx, database, action);
      } else {
        await setRebuildMarker(tx, database, action);
      }
    });
  } finally {
    await sql.end();
  }
}

async function runCapture(database: string, dsn: string, recover: boolean): Promise<void> {
  const root = resolveCaptureRoot(process.env, REPO_ROOT);
  const dir = captureDirectory(root, database);
  const pendingInfo = readPendingCaptureWithHash(dir, database);

  const sql = connect(dsn);
  let state: CaptureObservation;
  try {
    // ONE read-only snapshot: the state the decision is made on is the state observed.
    state = await sql.begin('isolation level repeatable read read only',
      (tx) => observeCaptureState(tx, { database, dir, pendingInfo, recover }));
  } finally {
    await sql.end();
  }

  const outcome = settleCapture({
    dir, database, capturedAt: new Date().toISOString(), pending: pendingInfo,
    live: {
      ledgerPresent: state.ledgerLive.present, ledgerRows: state.ledgerLive.rows,
      importerRows: state.importerLive, registrations: state.registrationsLive,
    },
    decision: state.decision, observed: state.observed,
  });

  await applyMarkerAction(dsn, database, outcome.markerAction);

  if (outcome.adopted) {
    console.log(`    RECOVER: reinstating the pending capture from ${outcome.adopted.capturedAt} `
      + `(${outcome.adopted.ledgerRows.length} ledger row(s), ${outcome.adopted.importerRows.length} `
      + `importer row(s), ${outcome.adopted.registrations.length} registration(s), `
      + `payload ${outcome.adopted.payloadSha256}).`);
    return;
  }
  if (outcome.archived) {
    console.log(`    RECOVERED: the pending capture from ${pendingInfo!.capture.capturedAt} `
      + `(${pendingInfo!.capture.ledgerRows.length} ledger row(s), `
      + `${pendingInfo!.capture.importerRows.length} importer row(s), `
      + `${pendingInfo!.capture.registrations.length} registration(s)) is already fully `
      + `reinstated; archived as ${relative(REPO_ROOT, outcome.archived)}`);
  }
  const { capture, path, sha256 } = outcome.captured!;
  console.log(`    captured ${capture.ledgerRows.length} adjudication row(s), `
    + `${capture.importerRows.length} importer identity row(s) and `
    + `${capture.registrations.length} manual player registration(s)`
    + `${state.ledgerLive.present ? '' : ' (no ledger table yet: migration 104 not applied)'}`);
  console.log(`    file    : ${relative(REPO_ROOT, path)}`);
  console.log(`    sha256  : ${sha256}`);
  console.log(`    payload : ${capture.payloadSha256}`);
  console.log('    marker  : set');
}

export type CaptureObservation = {
  ledgerLive: { present: boolean; rows: CapturedLedgerRow[] };
  importerLive: readonly CapturedImporterRow[];
  /** AFLDB-ISSUE-245: the live registration section, already proven carriable. */
  registrationsLive: readonly CapturedRegistration[];
  decision: PendingCaptureDecision;
  observed: LiveReinstatementObservation | null;
};

/**
 * The capture step's database half, inside the caller's READ-ONLY repeatable-read transaction:
 * every before-destruction check on the live state, then D11c's decision on it. Never writes;
 * the file and the marker are `settleCapture`/`applyMarkerAction`'s, after this returns.
 */
export async function observeCaptureState(
  tx: TransactionSql,
  input: {
    database: string; dir: string;
    pendingInfo: { capture: CombinedCapture; fileSha256: string } | null;
    recover: boolean;
  },
): Promise<CaptureObservation> {
  const { database, dir, pendingInfo, recover } = input;
  const marker = await readRebuildMarker(tx, database);
  if (marker && pendingInfo
      && (marker.payloadSha256 !== pendingInfo.capture.payloadSha256
          || marker.fileSha256 !== pendingInfo.fileSha256)) {
    throw new AdjudicationRebuildRefused(
      `The rebuild marker (payload ${marker.payloadSha256.slice(0, 12)}…, file `
      + `${marker.fileSha256.slice(0, 12)}…, captured ${marker.capturedAt}) does not match `
      + `the pending capture at ${join(dir, PENDING_CAPTURE_FILE)} (payload `
      + `${pendingInfo.capture.payloadSha256.slice(0, 12)}…, file `
      + `${pendingInfo.fileSha256.slice(0, 12)}…). This is the wrong or a tampered capture; `
      + 'reconcile by hand.');
  }
  if (marker && !pendingInfo) {
    // decidePendingCapture also refuses this case; caught here first only so the message
    // can name the marker's own hashes (D11c: "names the marker's hashes and the expected path").
    throw new AdjudicationRebuildRefused(
      `A rebuild marker (payload ${marker.payloadSha256.slice(0, 12)}…, file `
      + `${marker.fileSha256.slice(0, 12)}…, captured ${marker.capturedAt}) is present on `
      + `${database}, but no pending capture file exists at `
      + `${join(dir, PENDING_CAPTURE_FILE)}. Never capturing live over this: point `
      + `${CAPTURE_ROOT_ENV} at the location holding the pending capture, or resolve by hand.`);
  }

  // `present: false` only when `to_regclass` finds no ledger table (a database older than
  // migration 104, e.g. a pre-ISSUE-235 bootstrap): the human section is then exactly `[]`.
  // An existing table is read strictly; any failure reading it propagates.
  const ledgerLive = await readLedger(tx);
  // A database the real RESET_SQL has emptied (a run halted or crashed between `recreate`
  // and `reference`) has no `sources`/`external_identities`, or no afl_api source yet. That
  // is the exact state `--recover` must adopt from, so it reads as an empty importer section
  // here instead of failing the capture stage; the MARKER decision below, not this read, is
  // what stops such an empty snapshot ever being taken as a new baseline.
  const sourceId = await fetchAflApiSourceIdIfPresent(tx);
  if (sourceId === null && ledgerLive.rows.length > 0) {
    throw new AdjudicationRebuildRefused(
      "The adjudication ledger holds rows but the database has no afl_api source or identity table. "
      + 'This is not a state any supported path produces; nothing has been destroyed. Resolve by hand.');
  }
  const { rows: importerLive, identityByPlayerId, census } = sourceId === null
    ? { rows: [] as readonly CapturedImporterRow[], identityByPlayerId: new Map<number, AflApiForwardIdentityResult>(), census: [] }
    : await readAflApiImporterRows(tx, sourceId);

  const censusResult = censusAflApiRows(census);
  if (censusResult.anomalies.length > 0) {
    throw new AdjudicationRebuildRefused(
      'D5 census anomalies before destruction, nothing has been destroyed: '
      + censusResult.anomalies.join('; '));
  }
  const identityProblems: string[] = [];
  for (const row of censusResult.importerRows) {
    if (row.playerId === null) continue;
    const identity: AflApiForwardIdentityResult =
      identityByPlayerId.get(row.playerId) ?? { ok: false, reason: 'no_identity' };
    const reason = aflApiRebuildIdentityRefusalReason(identity);
    if (reason) identityProblems.push(`${row.externalId} (player ${row.playerId}): ${reason}`);
  }
  if (identityProblems.length > 0) {
    throw new AdjudicationRebuildRefused(
      `D7: before-destruction identity check failed for ${identityProblems.length} importer `
      + `row(s), nothing has been destroyed: ${identityProblems.join('; ')}`);
  }
  const structuralProblems = importerCaptureStructureProblems(importerLive).map(describeImporterProblem);
  if (structuralProblems.length > 0) {
    throw new AdjudicationRebuildRefused(
      `D13 capture-structure check failed before destruction: ${structuralProblems.join('; ')}`);
  }
  // No source means no afl_api row and (checked above) no ledger row: nothing to biject. With a
  // source but no ledger table, the bijection still runs against an empty ledger, so an
  // admin-resolved row with no ledger behind it still refuses.
  if (sourceId !== null) await assertAflApiAdjudicationBijection(tx, { ledgerTablePresent: ledgerLive.present });

  const net = netLedgerRowsByExternalId(ledgerLive.rows as unknown as AflApiAdjudicationLedgerRow[]);
  const remapByExternalId = new Map<string, AflApiPlayerRemapResult>();
  for (const [externalId, row] of net) {
    if (row.action !== 'linked') continue;
    remapByExternalId.set(externalId, await resolveAflApiPlayerIdentity(tx, row.playerIdentity));
  }
  const importerByExternalId = new Map(importerLive.map((r) => [r.externalId, {
    status: r.status, matchMethod: r.matchMethod, candidateCount: r.candidateCount,
    externalUrl: r.externalUrl, playerId: r.playerId, playerIdentity: r.playerIdentity,
  }]));
  const agreeing = computeAflApiAgreeingProviders({
    ledgerRows: ledgerLive.rows as unknown as AflApiAdjudicationLedgerRow[],
    importerByExternalId, remapByExternalId,
  });
  if (agreeing.size > 0) {
    throw new AdjudicationRebuildRefused(
      `E_rebuild is not empty before destruction (OD-6), nothing has been destroyed: a live `
      + `'unique' importer row and an effective LINKED ledger decision agree for provider(s) `
      + `${[...agreeing].sort().join(', ')}. This is broken pre-existing state -- ISSUE-235 `
      + 'writes the ledger decision and its resolved row atomically -- and it is never '
      + 'carried across the reset. Repair it by hand before rebuilding.');
  }

  // AFLDB-ISSUE-245: the registration section, with every before-destruction refusal. A reset
  // database (a halted or crashed run) reads as empty here, exactly like the importer section;
  // the marker decision below is what stops that ever becoming a new baseline.
  const registrationState = registrationsFromLive(await readLiveRegistrationState(tx));
  const registrationRefusal = registrationState.problems.length === 0 ? null : new AdjudicationRebuildRefused(
    `AFLDB-ISSUE-245: ${registrationState.problems.length} manual player registration problem(s) `
    + `before destruction, nothing has been destroyed: ${registrationState.problems.join('; ')}`);
  // A live database (no marker) with a problem is never captured. A marked database is mid-rebuild:
  // a run that died after Stage 17 committed the creation records but before the registration
  // replay did leaves records whose tokens name no player. Nothing is captured from that state;
  // only --recover's adopt-pending -- which resets and replays every section from the ORIGINAL
  // capture -- may proceed past it. Every other decision still refuses on the problem.
  if (registrationRefusal && marker === null) throw registrationRefusal;
  const registrationsLive = registrationState.registrations;

  const decision = decidePendingCapture({
    markerPresent: marker !== null, pending: pendingInfo?.capture ?? null,
    liveLedgerRows: ledgerLive.rows, liveImporterRows: importerLive, liveRegistrations: registrationsLive, recover,
  });
  if (registrationRefusal && decision.action !== 'adopt-pending') throw registrationRefusal;
  const observed = decision.action === 'verify-reinstated'
    ? await observeLiveReinstatement(tx, pendingInfo!.capture.importerRows, pendingInfo!.capture.registrations)
    : null;
  return { ledgerLive, importerLive, registrationsLive, decision, observed };
}

/**
 * The precondition every post-reset reinstate stage shares (Stage 17 and Stage 21): the marker
 * is present and names exactly this capture. Anything else refuses before any write.
 */
async function assertMarkerMatchesCapture(tx: TransactionSql, capture: CombinedCapture): Promise<void> {
  const marker = await readRebuildMarker(tx, capture.database);
  if (!marker) {
    throw new AdjudicationRebuildRefused(
      'No rebuild marker is present on this database; refusing to reinstate. Nothing was written.');
  }
  if (marker.payloadSha256 !== capture.payloadSha256) {
    throw new AdjudicationRebuildRefused(
      'The rebuild marker does not match the pending capture file; refusing to reinstate. '
      + 'Nothing was written.');
  }
}

/**
 * AFLDB-ISSUE-245 Stage 17, inside the CALLER'S transaction: the marker precondition, then
 * `reinstateManualRegistrations` (plan, refuse, actors, creation records, read-back). The
 * marker is NOT cleared and the capture NOT archived: both stay pending until Stage 21 commits,
 * so a failure anywhere before that is recovered by resetting and replaying every section from
 * this same capture.
 */
export async function reinstateRegistrationsStage(
  tx: TransactionSql, capture: CombinedCapture,
): Promise<RegistrationReinstateReport> {
  await assertMarkerMatchesCapture(tx, capture);
  return reinstateManualRegistrations(tx, capture.registrations);
}

/**
 * AFLDB-ISSUE-245 Stage 19, inside the caller's READ-ONLY transaction: the marker is still
 * pending for this capture, and the live registrations re-capture exactly (the player, the
 * manual identity, the AFL Tables identity and the creation record, all by stable identity).
 */
export async function verifyRegistrationsStage(tx: TransactionSql, capture: CombinedCapture): Promise<void> {
  const [{ readOnly }] = await tx<{ readOnly: string }[]>`
    SELECT current_setting('transaction_read_only') AS "readOnly"
  `;
  if (readOnly !== 'on') {
    throw new AdjudicationRebuildRefused('The registration verification must run in a read-only transaction.');
  }
  await assertMarkerMatchesCapture(tx, capture);
  const problems = manualRegistrationVerificationProblems(capture.registrations, await readLiveRegistrationState(tx));
  if (problems.length > 0) {
    throw new AdjudicationRebuildRefused(
      `The replayed registrations do not match the capture (${problems.length} problem(s)): ${problems.join('; ')}`);
  }
}

function readRequiredPendingCapture(database: string): { capture: CombinedCapture; dir: string } {
  const dir = captureDirectory(resolveCaptureRoot(process.env, REPO_ROOT), database);
  const capture = readPendingCapture(dir, database);
  if (!capture) {
    throw new AdjudicationRebuildRefused(
      `No pending adjudication capture in ${relative(REPO_ROOT, dir)}: the capture stage did not run.`);
  }
  return { capture, dir };
}

async function runRegistrationsReinstate(database: string, dsn: string): Promise<void> {
  const { capture } = readRequiredPendingCapture(database);
  const sql = connect(dsn);
  let report: RegistrationReinstateReport;
  try {
    report = await sql.begin((tx) => reinstateRegistrationsStage(tx, capture));
  } finally {
    await sql.end();
  }
  console.log(`    registrations: ${report.registrations} creation record(s) reinstated `
    + `(${report.creates} to re-create, ${report.binds} to bind to a source-owned player)`);
  console.log(`    actors       : ${report.actorsReused} reused, ${report.actorsCreated} attribution-only created `
    + '(captured role, disabled, no credentials)');
  console.log('    marker       : kept (cleared only by the AFL API reinstate stage)');
}

async function runRegistrationsVerify(database: string, dsn: string): Promise<void> {
  const { capture } = readRequiredPendingCapture(database);
  const sql = connect(dsn);
  try {
    await sql.begin('read only', (tx) => verifyRegistrationsStage(tx, capture));
  } finally {
    await sql.end();
  }
  console.log(`    registrations: ${capture.registrations.length} replayed exactly `
    + '(player, manual identity, AFL Tables identity, creation record)');
}

async function runReinstate(database: string, dsn: string): Promise<void> {
  const root = resolveCaptureRoot(process.env, REPO_ROOT);
  const dir = captureDirectory(root, database);
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
  console.log(`    importer: ${report.importerInserted} inserted, ${report.importerNoops} no-op`);
  console.log(`    ledger  : reinstated ${report.ledgerRows} row(s) under their original ids; `
    + `next id ${report.nextLedgerId}`);
  console.log(`    actors  : ${report.actorsReused} reused (${report.actorsReusedWithDifferentRole} with a `
    + `different current role, left unchanged), ${report.actorsCreated} attribution-only created `
    + '(captured role, disabled, no credentials)');
  console.log(`    replay  : ${report.replay.inserted} inserted, ${report.replay.noops} no-op, `
    + `${report.replay.supersedes.length} superseded (expected 0); bijection OK`);
  console.log('    marker  : cleared inside this transaction');
  console.log(`    capture : payload ${capture.payloadSha256}, archived as ${relative(REPO_ROOT, archived)}`);
}

async function runBijection(database: string, dsn: string): Promise<void> {
  const sql = connect(dsn);
  try {
    await sql.begin('read only', async (tx) => {
      await assertAflApiIdentityInvariant(tx);
      const marker = await readRebuildMarker(tx, database);
      if (marker) {
        throw new AdjudicationRebuildRefused(
          `A rebuild marker is still present on ${database} after the reinstate stage; the `
          + 'combined invariant requires no marker to remain (D13, Stage 19).');
      }
    });
  } finally {
    await sql.end();
  }
  console.log('    afl_api combined importer/human identity invariant: OK (no rebuild marker remains)');
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
  if (step === 'registrations-reinstate') return runRegistrationsReinstate(database, dsn);
  if (step === 'registrations-verify') return runRegistrationsVerify(database, dsn);
  if (step === 'reinstate') return runReinstate(database, dsn);
  if (step === 'bijection') return runBijection(database, dsn);
  throw new AdjudicationRebuildRefused(
    `Unknown step '${String(step)}': capture, registrations-reinstate, registrations-verify, reinstate or bijection.`);
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
