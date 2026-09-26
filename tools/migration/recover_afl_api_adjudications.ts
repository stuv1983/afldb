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
 * combined capture (`afldb.afl_api_identities.rebuild_capture` v2) and archives it after the
 * reinstate, and `export` below writes the ledger section of any readable database (a restored
 * backup included) in the same shape, UNTRACKED (outside every checkout, never overwritten). The
 * recovery accepts either, and reads only the ledger section.
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
 *   - the source is not a recovery export or a v2 combined capture, fails its own hash, or is not
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
  netLedgerRowsByExternalId,
  planAflApiAdjudicationReplay,
  type AflApiAdjudicationLedgerRow,
  type AflApiPlayerRemapResult,
} from '../../src/lib/acquisition/afl-api-adjudication';
import { redact } from '../db/psql';
import {
  CAPTURE_FORMAT,
  capturedRowProblems,
  insertAttributionOnlyActor,
  ledgerPlayerRemapProblems,
  ledgerSequenceName,
  nextIdentityValue,
  parseCombinedCapture,
  planActorRemap,
  planLedgerReinstatement,
  readLedger,
  readSequenceState,
  sameLedgerRow,
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
export const ADJUDICATION_RECOVERY_VERSION = 1;

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

export type AdjudicationRecoveryExport = {
  format: typeof ADJUDICATION_RECOVERY_FORMAT;
  version: typeof ADJUDICATION_RECOVERY_VERSION;
  /** The deployment whose decisions these are: the only database they may be recovered into. */
  ledgerDatabase: RecoveryLedgerDatabase;
  /** The database actually read (the ledger database itself, or a restored scratch copy of it). */
  sourceDatabase: string;
  capturedAt: string;
  ledgerRows: CapturedLedgerRow[];
  payloadSha256: string;
};

/** Every field of every row in one fixed order, so the hash never depends on key order. */
function exportPayloadSha256(body: Omit<AdjudicationRecoveryExport, 'payloadSha256'>): string {
  const rows = body.ledgerRows.map((r) => [
    r.id, r.sourceKey, r.externalId, r.action, r.playerId, r.playerIdentity, r.previousState, r.evidence,
    r.evidenceSha256, r.surnameDisagreementAcknowledged, r.supersedesId, r.adminUserId, r.adminEmail,
    r.adminRole, r.note, r.createdAt,
  ]);
  return createHash('sha256').update(JSON.stringify([
    body.format, body.version, body.ledgerDatabase, body.sourceDatabase, body.capturedAt, rows,
  ]), 'utf8').digest('hex');
}

export function buildAdjudicationRecoveryExport(input: {
  ledgerDatabase: RecoveryLedgerDatabase; sourceDatabase: string; capturedAt: string;
  ledgerRows: readonly CapturedLedgerRow[];
}): AdjudicationRecoveryExport {
  const problems = capturedRowProblems(input.ledgerRows);
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
  ledgerRows: CapturedLedgerRow[];
  payloadSha256: string;
  fileSha256: string;
};

/**
 * Parse and PROVE a recovery source: a recovery export, or a v2 combined rebuild capture of which
 * only the ledger section is used. Either must match its own hash and the payload hash the
 * operator names. Anything else — including the superseded ledger-only and pre-ISSUE-245
 * captures, which `parseCombinedCapture` itself names and refuses — is refused.
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
    if (raw.version !== ADJUDICATION_RECOVERY_VERSION) {
      throw new AdjudicationRecoveryRefused(`The recovery export version is ${String(raw.version)}, not ${ADJUDICATION_RECOVERY_VERSION}.`);
    }
    if (!isRecoveryDatabase(raw.ledgerDatabase) || typeof raw.sourceDatabase !== 'string'
        || typeof raw.capturedAt !== 'string' || !Array.isArray(raw.ledgerRows) || typeof raw.payloadSha256 !== 'string') {
      throw new AdjudicationRecoveryRefused('The recovery export is missing a required field or names an unsupported ledger database.');
    }
    const rebuilt = buildAdjudicationRecoveryExport({
      ledgerDatabase: raw.ledgerDatabase, sourceDatabase: raw.sourceDatabase, capturedAt: raw.capturedAt,
      ledgerRows: raw.ledgerRows as CapturedLedgerRow[],
    });
    if (rebuilt.payloadSha256 !== raw.payloadSha256) {
      throw new AdjudicationRecoveryRefused('The recovery export does not match its own payload hash: it was altered after export.');
    }
    source = { kind: 'recovery_export', ...rebuilt };
  } else if (raw.format === CAPTURE_FORMAT) {
    if (!isRecoveryDatabase(raw.database)) {
      throw new AdjudicationRecoveryRefused(`The rebuild capture names '${String(raw.database)}', which is not a recoverable ledger database.`);
    }
    let capture;
    try {
      capture = parseCombinedCapture(text, raw.database);
    } catch (error) {
      throw new AdjudicationRecoveryRefused(`The rebuild capture is refused: ${(error as Error).message}`);
    }
    if (!capture.ledgerTablePresent) {
      throw new AdjudicationRecoveryRefused('The rebuild capture predates migration 104: it carries no ledger to recover.');
    }
    source = {
      kind: 'rebuild_capture', ledgerDatabase: raw.database, sourceDatabase: capture.database,
      capturedAt: capture.capturedAt, ledgerRows: capture.ledgerRows, payloadSha256: capture.payloadSha256,
    };
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
  toInsert: CapturedLedgerRow[];
  identicalIds: number[];
  stops: string[];
};

/**
 * Source ledger vs target ledger, row by id. Only ever ADDS source rows the target lacks; a target
 * row the source does not hold, or a same-id row that differs, is a stop (reconciled by hand).
 */
export function planLedgerRecovery(input: {
  source: readonly CapturedLedgerRow[];
  target: readonly CapturedLedgerRow[];
}): LedgerRecoveryPlan {
  const stops = capturedRowProblems(input.source).map((p) => `recovery source: ${p}`);
  const targetById = new Map(input.target.map((r) => [r.id, r]));
  const sourceIds = new Set(input.source.map((r) => r.id));
  const toInsert: CapturedLedgerRow[] = [];
  const identicalIds: number[] = [];
  for (const row of input.source) {
    const existing = targetById.get(row.id);
    if (!existing) { toInsert.push(row); continue; }
    if (sameLedgerRow(row, existing)) identicalIds.push(row.id);
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
  targetLedger: CapturedLedgerRow[];
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

  const identities = [...new Set([...source.ledgerRows, ...target.rows].map((r) => r.playerIdentity))];
  const remapByIdentity = await resolveAflApiPlayerIdentities(tx, identities);
  const stops = [...ledger.stops, ...ledgerPlayerRemapProblems(source.ledgerRows, remapByIdentity)];
  for (const row of target.rows) {
    const remap = remapByIdentity.get(row.playerIdentity);
    if (remap?.ok && remap.newPlayerId !== row.playerId) {
      stops.push(`target ledger row ${row.id} (${row.externalId}) holds player_id ${row.playerId}, but its identity `
        + `'${row.playerIdentity}' names player ${remap.newPlayerId}`);
    }
  }
  if (stops.length > 0) {
    throw new AdjudicationRecoveryRefused(`The ledger cannot be recovered; nothing was written: ${stops.join('; ')}`);
  }

  const emails = [...new Set(source.ledgerRows.map((r) => r.adminEmail.toLowerCase()))];
  const existingActors = emails.length === 0 ? [] : await tx<ExistingActor[]>`
    SELECT id, email, role FROM auth_users WHERE lower(email) = ANY (${tx.array(emails)}::text[])
  `;
  try {
    planActorRemap(source.ledgerRows, existingActors);
  } catch (error) {
    throw new AdjudicationRecoveryRefused((error as Error).message);
  }

  // The D15 replay's own planner over the ledger as it WILL be (target rows plus the rows to
  // reinstate, each at its identity's current player), against the live outcome rows.
  const projected: AflApiAdjudicationLedgerRow[] = [...target.rows, ...ledger.toInsert].map((r) => {
    const remap = remapByIdentity.get(r.playerIdentity) as Extract<AflApiPlayerRemapResult, { ok: true }>;
    return {
      id: r.id, externalId: r.externalId, action: r.action, playerId: remap.newPlayerId,
      playerIdentity: r.playerIdentity, supersedesId: r.supersedesId,
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
      const actorPlan = planActorRemap(source.ledgerRows, planned.existingActors);
      return {
        ...base, outcome: 'READ_ONLY',
        ledgerRowsReinstated: planned.ledger.toInsert.map((r) => r.id),
        ledgerRowsIdentical: planned.ledger.identicalIds.length,
        actorsToCreate: actorPlan.create.length,
        outcomeInserts: planned.outcome.inserts.map((i) => i.externalId),
        outcomeNoops: planned.outcome.noops.length,
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
      const actorPlan = planActorRemap(source.ledgerRows, planned.existingActors);
      const actorIdByEmail = new Map(actorPlan.reuse);
      for (const actor of actorPlan.create) {
        actorIdByEmail.set(actor.email.toLowerCase(), await insertAttributionOnlyActor(tx, actor));
      }

      // Ledger rows: the D15 reinstatement's own plan, restricted to the rows the target lacks.
      const reinstatement = planLedgerReinstatement({
        rows: source.ledgerRows, remapByIdentity: planned.remapByIdentity, actorIdByEmail,
      });
      const missing = new Set(planned.ledger.toInsert.map((r) => r.id));
      const inserts = reinstatement.rows.filter((r) => missing.has(r.id));
      for (const r of inserts) {
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
        return !live || !sameLedgerRow(r, live);
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

      state.report = {
        ...base,
        outcome: wrote ? 'COMMITTED' : 'ALREADY_RECOVERED',
        ledgerRowsReinstated: inserts.map((r) => r.id),
        ledgerRowsIdentical: planned.ledger.identicalIds.length,
        actorsToCreate: actorPlan.create.length,
        outcomeInserts: planned.outcome.inserts.map((i) => i.externalId),
        outcomeNoops: replay.noops,
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
    `    human outcome rows already present: ${report.outcomeNoops}`,
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
