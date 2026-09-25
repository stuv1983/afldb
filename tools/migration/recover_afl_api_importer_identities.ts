/**
 * AFLDB-ISSUE-237 §11a (R3–R5) — the OD-4 one-off recovery path for `afldb_test`'s importer
 * `afl_api` identity coverage, lost since ISSUE-235's I18 (802 -> 0 importer rows).
 *
 * NOT the bridge loader (`import_afl_api_player_bridge.py`): it reads no artefact
 * `candidate_player_id`, adds no loader target, and is a one-off recovery tool, never a
 * lifecycle mechanism (D1, D15 "no tracked or exported importer-identity artefact").
 *
 * R1/R2 (proving the pre-I18 backup authoritative, and freezing it) are operator-gated and
 * are NOT implemented here — this file starts from R3, which assumes an already-proven
 * authoritative source database. R1.1–R1.5 must all pass, recorded in `issues.md` and the
 * runbook, before this tool's export (R3) is ever run against that source. This file itself
 * is implemented but NOT run under S1–S7 (runbook §14): no database has been contacted from
 * this tool this session.
 *
 * R4 OPERATOR CLI (three modes, run strictly in this order; bound to the R3 PASS export):
 *
 *     $env:AFLDB_TEST_IMPORT_DATABASE_URL = '<afldb_import DSN naming afldb_test>'
 *     npm run db:issue237:recover-importer-identities -- validate-only `
 *         --export D:\afldb-rebuild-captures\issue-237-recovery\afl-api-importer-identities.json `
 *         --source-dump-sha256 B6552DC4583AFCBE28C61EE605FC995146D112FDB3424FCE4A82144BBAE3C436
 *     (then the identical command with dry-run, then with apply)
 *
 * `--allow-owner-import-dsn` runs it through the owner `AFLDB_TEST_DATABASE_URL` instead, and
 * only when `AFLDB_TEST_IMPORT_DATABASE_URL` is unset. See `executeR4Recovery` for the
 * transaction semantics of each mode.
 *
 * R3 OPERATOR CLI (export):
 *
 *     $env:AFLDB_ISSUE237_R1_DATABASE_URL = '<owner DSN naming issue237_r1_restore>'
 *     npm run db:issue237:export-importer-recovery -- `
 *         --source-database issue237_r1_restore `
 *         --source-dump-sha256 B6552DC4583AFCBE28C61EE605FC995146D112FDB3424FCE4A82144BBAE3C436 `
 *         --output D:\afldb-rebuild-captures\issue-237-recovery\afl-api-importer-identities.json
 *
 * The CLI adds no identity logic: `exportAflApiImporterIdentities` stays the only export
 * semantics. It binds that export to the R1-proven source (the live database name, a
 * `REPEATABLE READ READ ONLY` transaction, `default_transaction_read_only = on`, the recorded
 * dump hash and the R1 census, all fixed constants below) and writes it once, atomically,
 * outside every checkout. The source DSN is read only from `AFLDB_ISSUE237_R1_DATABASE_URL`
 * (never argv, never `.env`, never another variable) and is never printed.
 *
 * SELF-VERIFYING, not merely trusting an earlier step, exactly the `replay_afl_api_adjudications.ts`
 * contract this file reuses (`readAflApiImporterRows`, `planAflApiImporterReplay`,
 * `replayAflApiImporterRows`, `importerParityProblems` — no second identity lookup, no
 * duplicate SQL).
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, unlinkSync, writeSync,
} from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';

import postgres, { type TransactionSql } from 'postgres';

import { canonicalJson, type JsonValue } from '../../src/lib/acquisition/observations';
import { databaseOf } from '../db/rebuild-test';
import { redact } from '../db/psql';
import {
  censusAflApiRows,
  importerCaptureStructureProblems,
  importerParityProblems,
  type AflApiCensusRow,
  type AflApiImporterProjection,
  type CapturedImporterRow,
} from '../../src/lib/acquisition/afl-api-adjudication';
import { readRebuildMarker } from './rebuild_afl_api_adjudications';
import {
  AflApiReplayAbort,
  assertAflApiAdjudicationBijection,
  assertAflApiIdentityInvariant,
  planAflApiImporterRowsLive,
  readAflApiCensusRows,
  readAflApiForwardIdentities,
  readAflApiImporterRows,
  writeAflApiImporterPlan,
} from './replay_afl_api_adjudications';

/** Raised when the recovery cannot proceed. Thrown inside the caller's transaction, so
 * nothing it has written survives (the `AflApiReplayAbort`/`SpecialRecordReplayAbort` pattern). */
export class AflApiRecoveryAbort extends Error {}

export const RECOVERY_EXPORT_FORMAT = 'afldb.afl_api_importer_identities.recovery_export';
export const RECOVERY_EXPORT_VERSION = 1;

/** §11a R3's export file (proposed format). Never tracked; stored under
 * `AFLDB_REBUILD_CAPTURE_ROOT` (D11a). */
export type AflApiImporterRecoveryExport = {
  format: typeof RECOVERY_EXPORT_FORMAT;
  version: typeof RECOVERY_EXPORT_VERSION;
  sourceDatabase: string;
  sourceDumpSha256: string;
  capturedAt: string;
  countsByMethod: Record<string, number>;
  rows: readonly CapturedImporterRow[];
  payloadSha256: string;
};

function recoveryPayloadSha256(input: { sourceDatabase: string; sourceDumpSha256: string; rows: readonly CapturedImporterRow[] }): string {
  const payload: JsonValue = {
    sourceDatabase: input.sourceDatabase,
    sourceDumpSha256: input.sourceDumpSha256,
    // `[...rows]` order is the export's own `externalId`-sorted order (readAflApiImporterRows),
    // which is deterministic -- so the hash is stable across identical exports.
    rows: input.rows.map((r) => ({
      externalId: r.externalId, playerIdentity: r.playerIdentity, matchMethod: r.matchMethod,
      status: r.status, candidateCount: r.candidateCount, externalName: r.externalName,
      externalUrl: r.externalUrl, notes: r.notes,
      // playerId is audit-only (D6) and deliberately EXCLUDED from the hash: it is the SOURCE
      // database's own surrogate, never trusted identity, and must not make two exports of the
      // same accepted state hash differently merely because a rebuild renumbered players.
    })),
  };
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

/**
 * R3. Read-only against the (already R1-proven-authoritative) source database, inside the
 * caller's `REPEATABLE READ READ ONLY` transaction. OD-1 fail-closed: ANY importer row whose
 * player does not resolve to exactly one accepted stable identity refuses the WHOLE export —
 * `readAflApiImporterRows` itself silently EXCLUDES such a row from its own `rows` (Stage 2's
 * own future caller is expected to check `identityByPlayerId`); this export does that
 * checking explicitly, because a silently smaller export is exactly the partial-export D1/OD-1
 * forbid.
 */
export async function exportAflApiImporterIdentities(
  tx: TransactionSql, input: { sourceDatabase: string; sourceDumpSha256: string },
): Promise<AflApiImporterRecoveryExport> {
  const [source] = await tx<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afl_api'`;
  if (!source) throw new AflApiRecoveryAbort("R3: sources.key = 'afl_api' not found on the source database.");

  const { rows, identityByPlayerId, census } = await readAflApiImporterRows(tx, source.id);

  const { importerRows } = censusAflApiRows(census);
  const unresolved = importerRows.filter((r) => r.playerId !== null
    && !(identityByPlayerId.get(r.playerId)?.ok ?? false));
  if (unresolved.length > 0) {
    throw new AflApiRecoveryAbort(
      `R3/OD-1: ${unresolved.length} importer row(s) do not resolve to exactly one accepted `
      + 'stable identity -- refusing the WHOLE export, nothing partially exported: '
      + unresolved.map((r) => r.externalId).join(', '),
    );
  }
  // A row with a NULL player_id is itself a D5 anomaly (never an importer row by
  // `classifyAflApiCensusRow`), so `importerRows` never contains one; the `playerId !== null`
  // guard above is therefore always true in practice and is kept only as a type narrower.

  const countsByMethod: Record<string, number> = {};
  for (const row of rows) countsByMethod[row.matchMethod] = (countsByMethod[row.matchMethod] ?? 0) + 1;

  const payloadSha256 = recoveryPayloadSha256({
    sourceDatabase: input.sourceDatabase, sourceDumpSha256: input.sourceDumpSha256, rows,
  });

  return {
    format: RECOVERY_EXPORT_FORMAT, version: RECOVERY_EXPORT_VERSION,
    sourceDatabase: input.sourceDatabase, sourceDumpSha256: input.sourceDumpSha256,
    capturedAt: new Date().toISOString(), countsByMethod, rows, payloadSha256,
  };
}

/** Structural + hash validation of a parsed export, before any database is touched. */
export function parseAflApiImporterRecoveryExport(
  parsed: unknown, expected: { sourceDumpSha256: string },
): AflApiImporterRecoveryExport {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new AflApiRecoveryAbort('R4: the export is not a JSON object.');
  }
  const p = parsed as Partial<AflApiImporterRecoveryExport>;
  if (p.format !== RECOVERY_EXPORT_FORMAT) {
    throw new AflApiRecoveryAbort(`R4: export format is ${JSON.stringify(p.format)}, expected ${JSON.stringify(RECOVERY_EXPORT_FORMAT)}.`);
  }
  if (p.version !== RECOVERY_EXPORT_VERSION) {
    throw new AflApiRecoveryAbort(`R4: export version is ${JSON.stringify(p.version)}, expected ${RECOVERY_EXPORT_VERSION}.`);
  }
  if (typeof p.sourceDatabase !== 'string' || typeof p.sourceDumpSha256 !== 'string'
    || typeof p.capturedAt !== 'string' || typeof p.payloadSha256 !== 'string' || !Array.isArray(p.rows)) {
    throw new AflApiRecoveryAbort('R4: the export is missing a required field.');
  }
  if (p.sourceDumpSha256 !== expected.sourceDumpSha256) {
    throw new AflApiRecoveryAbort(
      `R4: export sourceDumpSha256 is ${p.sourceDumpSha256}, expected the recorded R1 hash `
      + `${expected.sourceDumpSha256} -- refusing an export from an unproven or wrong source.`,
    );
  }
  const rows = p.rows as CapturedImporterRow[];
  const actualPayloadSha256 = recoveryPayloadSha256({
    sourceDatabase: p.sourceDatabase, sourceDumpSha256: p.sourceDumpSha256, rows,
  });
  if (actualPayloadSha256 !== p.payloadSha256) {
    throw new AflApiRecoveryAbort('R4: export payloadSha256 does not match its own rows -- refusing a tampered or hand-edited export.');
  }
  return {
    format: RECOVERY_EXPORT_FORMAT, version: RECOVERY_EXPORT_VERSION,
    sourceDatabase: p.sourceDatabase, sourceDumpSha256: p.sourceDumpSha256, capturedAt: p.capturedAt,
    countsByMethod: p.countsByMethod ?? {}, rows, payloadSha256: p.payloadSha256,
  };
}

export type AflApiRecoveryMode = 'validate-only' | 'dry-run' | 'apply';

export const AFL_API_RECOVERY_MODES: readonly AflApiRecoveryMode[] = ['validate-only', 'dry-run', 'apply'];

export type AflApiRecoveryResult = {
  mode: AflApiRecoveryMode;
  /** D9 plan: rows the recovery INSERTs (validate-only: would insert). */
  wouldInsert: number;
  /** D9 plan: export rows `afldb_test` already holds identically (idempotent no-ops). */
  alreadyIdentical: number;
  /** INSERT statements actually executed in this transaction: 0 for validate-only. */
  inserted: number;
  /** Importer rows `afldb_test` held before this transaction wrote anything. */
  preExistingImporterRows: number;
  /** The planned INSERT providers, sorted -- the fresh-reader rollback proof looks for each. */
  plannedProviders: readonly string[];
  /** The per-method importer census the plan yields (validate-only) or the re-read found. */
  countsByMethod: Record<string, number>;
  /** R5 parity over the PROJECTED state (live identical rows + planned INSERTs). Always run. */
  projectedParity: 'PASS';
  /** R5 parity over the re-read state after the INSERTs; validate-only writes nothing to re-read. */
  writtenParity: 'PASS' | 'NOT RUN';
  /** D15 bijection + D13 combined invariant: before any write, and again after it when written. */
  invariant: 'PASS';
  /** True only for `apply`: the rows are actually committed by the caller's transaction. */
  applied: boolean;
};

/** Forces a savepoint's own work to roll back regardless of outcome (`dry-run`). */
class RecoveryRollbackSentinel extends Error {}

const projectionOf = (r: CapturedImporterRow): AflApiImporterProjection => ({
  externalId: r.externalId, playerIdentity: r.playerIdentity, status: r.status,
  candidateCount: r.candidateCount, matchMethod: r.matchMethod, externalName: r.externalName,
  externalUrl: r.externalUrl, notes: r.notes,
});

/** R5's exact projection parity + per-method census, over any importer projection. */
function assertR5Parity(
  exported: AflApiImporterRecoveryExport, live: readonly CapturedImporterRow[], label: string,
): Record<string, number> {
  const problems = importerParityProblems({ captured: exported.rows.map(projectionOf), live: live.map(projectionOf) });
  if (problems.length > 0) {
    throw new AflApiRecoveryAbort(
      `R5 (${label}): exact parity failed (${problems.length} problem(s)): `
      + problems.map((p) => JSON.stringify(p)).join('; '),
    );
  }
  const counts: Record<string, number> = {};
  for (const r of live) counts[r.matchMethod] = (counts[r.matchMethod] ?? 0) + 1;
  const methods = new Set([...Object.keys(counts), ...Object.keys(exported.countsByMethod)]);
  for (const method of [...methods].sort()) {
    if ((counts[method] ?? 0) !== (exported.countsByMethod[method] ?? 0)) {
      throw new AflApiRecoveryAbort(
        `R5 (${label}): method ${method} count is ${counts[method] ?? 0}, expected ${exported.countsByMethod[method] ?? 0} (export census).`);
    }
  }
  return counts;
}

/**
 * R4. One call = one mode, inside the caller's ONE transaction. Order:
 *
 * 1. the live `current_database()` is exactly `afldb_test`;
 * 2. the export re-validates against the caller's expected (R1-proven) dump hash;
 * 3. no rebuild marker (`readRebuildMarker`, the rebuild's own strict reader; a foreign comment
 *    also refuses);
 * 4. D15 bijection + the D13 combined invariant hold BEFORE anything is written;
 * 5. `afldb_test` holds no importer row except one identical to an export entry;
 * 6. the D9 plan (`planAflApiImporterRowsLive`: every stable identity reverse-resolved, the
 *    continuity reverse check, provider and per-player collisions, human rows) -- any STOP
 *    refuses the whole call; planned INSERTs must also land on distinct players;
 * 7. R5 parity over the PROJECTED state (identical live rows + planned INSERTs);
 * 8. `validate-only` returns here, having written nothing. `dry-run` and `apply` INSERT the plan,
 *    re-read, and prove R5 parity, the D15 bijection and the D13 combined invariant on the
 *    written state; `dry-run` does so inside a savepoint it always rolls back.
 *
 * Every refusal throws, so the caller's transaction rolls back every row written. The caller
 * (`executeR4Recovery`) additionally rolls back the whole transaction for every mode except
 * `apply`.
 */
export async function recoverAflApiImporterIdentities(
  tx: TransactionSql,
  input: { expectedSourceDumpSha256: string; export: AflApiImporterRecoveryExport; mode: AflApiRecoveryMode },
): Promise<AflApiRecoveryResult> {
  if (!AFL_API_RECOVERY_MODES.includes(input.mode)) {
    throw new AflApiRecoveryAbort(`R4: unknown mode ${JSON.stringify(input.mode)}.`);
  }
  const [{ database }] = await tx<{ database: string }[]>`SELECT current_database() AS database`;
  if (database !== R4_TARGET_DATABASE) {
    throw new AflApiRecoveryAbort(`R4: the recovery tool's target must be ${R4_TARGET_DATABASE}, connected to '${database}'.`);
  }

  // Re-validate the export against the CALLER's own expected hash (never trust a pre-parsed
  // object passed in without re-checking): the same guard `parseAflApiImporterRecoveryExport`
  // applies at read time.
  parseAflApiImporterRecoveryExport(input.export, { sourceDumpSha256: input.expectedSourceDumpSha256 });

  // Database comments live in pg_shdescription: `readRebuildMarker` reads them with
  // shobj_description (obj_description never sees one) and refuses a foreign comment.
  const marker = await readRebuildMarker(tx, R4_TARGET_DATABASE);
  if (marker !== null) {
    throw new AflApiRecoveryAbort(
      `R4: a rebuild marker is present on ${R4_TARGET_DATABASE} (captured ${marker.capturedAt}) -- `
      + 'refusing to recover during a pending/interrupted rebuild.');
  }

  // D15 bijection and the D13 combined invariant must hold before this tool touches anything.
  await assertAflApiAdjudicationBijection(tx);
  await assertAflApiIdentityInvariant(tx);

  const [source] = await tx<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afl_api'`;
  if (!source) throw new AflApiRecoveryAbort(`R4: sources.key = 'afl_api' not found on ${R4_TARGET_DATABASE}.`);

  const { rows: liveRows } = await readAflApiImporterRows(tx, source.id);
  const exportByExternalId = new Map(input.export.rows.map((r) => [r.externalId, r]));
  const identicalFields = (a: CapturedImporterRow, b: CapturedImporterRow): boolean =>
    a.playerIdentity === b.playerIdentity && a.matchMethod === b.matchMethod && a.status === b.status
    && a.candidateCount === b.candidateCount && a.externalName === b.externalName
    && a.externalUrl === b.externalUrl && a.notes === b.notes;
  const nonIdentical = liveRows.filter((live) => {
    const exported = exportByExternalId.get(live.externalId);
    return !exported || !identicalFields(live, exported);
  });
  if (nonIdentical.length > 0) {
    throw new AflApiRecoveryAbort(
      `R4: ${R4_TARGET_DATABASE} already holds ${nonIdentical.length} importer row(s) that are not `
      + `identical to an export entry: ${nonIdentical.map((r) => r.externalId).join(', ')}`,
    );
  }

  const { sourceId, plan } = await planAflApiImporterRowsLive(tx, input.export.rows);
  if (plan.stops.length > 0) {
    throw new AflApiReplayAbort(
      `afl_api importer replay stopped on ${plan.stops.length} provider id(s), no row written: `
      + plan.stops.map((s) => `${s.externalId} (${s.reason})`).join('; '),
    );
  }
  const playersPlanned = new Map<number, string[]>();
  for (const insert of plan.inserts) {
    playersPlanned.set(insert.playerId, [...(playersPlanned.get(insert.playerId) ?? []), insert.externalId]);
  }
  const perPlayerCollisions = [...playersPlanned.entries()].filter(([, ids]) => ids.length > 1);
  if (perPlayerCollisions.length > 0) {
    throw new AflApiRecoveryAbort(
      `R4: ${perPlayerCollisions.length} target player(s) would receive more than one afl_api provider, no row written: `
      + perPlayerCollisions.map(([playerId, ids]) => `player ${playerId} <- ${ids.sort().join(' + ')}`).join('; '),
    );
  }

  // R5 over the projected state: exactly what the write set would leave behind.
  const plannedByExternalId = new Set(plan.inserts.map((i) => i.externalId));
  const projected = [...liveRows, ...input.export.rows.filter((r) => plannedByExternalId.has(r.externalId))];
  const projectedCounts = assertR5Parity(input.export, projected, 'projected');

  const base = {
    mode: input.mode,
    wouldInsert: plan.inserts.length,
    alreadyIdentical: plan.noops.length,
    preExistingImporterRows: liveRows.length,
    plannedProviders: [...plannedByExternalId].sort(),
    projectedParity: 'PASS' as const,
    invariant: 'PASS' as const,
  };
  if (input.mode === 'validate-only') {
    return { ...base, inserted: 0, countsByMethod: projectedCounts, writtenParity: 'NOT RUN', applied: false };
  }

  const writeAndProve = async (writeTx: TransactionSql): Promise<Record<string, number>> => {
    await writeAflApiImporterPlan(writeTx, sourceId, plan);
    const { rows: written } = await readAflApiImporterRows(writeTx, source.id);
    const counts = assertR5Parity(input.export, written, 'after the recovery write');
    await assertAflApiAdjudicationBijection(writeTx); // the human side is unchanged
    await assertAflApiIdentityInvariant(writeTx);
    return counts;
  };

  if (input.mode === 'dry-run') {
    let counts: Record<string, number> | undefined;
    try {
      await tx.savepoint(async (sp) => {
        counts = await writeAndProve(sp);
        throw new RecoveryRollbackSentinel(); // always roll back this savepoint
      });
    } catch (error) {
      if (!(error instanceof RecoveryRollbackSentinel)) throw error;
    }
    return { ...base, inserted: plan.inserts.length, countsByMethod: counts!, writtenParity: 'PASS', applied: false };
  }

  // apply: write for real in the caller's own transaction; the caller commits.
  const counts = await writeAndProve(tx);
  return { ...base, inserted: plan.inserts.length, countsByMethod: counts, writtenParity: 'PASS', applied: true };
}

// Re-exported so a caller building an export needs no second identity lookup or reason to
// import `censusAflApiRows`/`readAflApiForwardIdentities` directly.
export { censusAflApiRows, readAflApiForwardIdentities };
export type { AflApiCensusRow };

// ---------------------------------------------------------------------------
// R3 operator CLI — export only. Every expected value is the R1/R2 evidence recorded in the
// runbook (§11a); none is configurable, because this is a one-off recovery of ONE proven state.
// ---------------------------------------------------------------------------

export const R3_SOURCE_DSN_ENV = 'AFLDB_ISSUE237_R1_DATABASE_URL';
/** The isolated, read-only restore of the authoritative pre-I18 backup (R1.2, R2). */
export const R3_SOURCE_DATABASE = 'issue237_r1_restore';
/** R1.1's exact hash of `afldb_test-pre-i18-20260924-094554.dump`. */
export const R3_SOURCE_DUMP_SHA256 = 'B6552DC4583AFCBE28C61EE605FC995146D112FDB3424FCE4A82144BBAE3C436';
/** R1.3: exactly 802 importer rows, 802 providers, 802 stable identities. */
export const R3_EXPECTED_ROWS = 802;
/** R1.4's exact per-method census. No other method may appear. */
export const R3_EXPECTED_COUNTS_BY_METHOD: Readonly<Record<string, number>> = Object.freeze({
  afl_api_manual_adjudication: 3,
  afl_api_name_team_season_bootstrap: 129,
  afl_api_stat_vector_bootstrap: 397,
  afl_api_stat_vector_season: 273,
});
/** R1.2's refused names, plus the ISSUE-237 rehearsal target. `/prod/i` is refused separately. */
const R3_FORBIDDEN_SOURCE_DATABASES = ['afldb', 'afldb_prod', 'afldb_dev', 'afldb_test', 'code_test_db'];

export type R3ExportArgs = { sourceDatabase: string; sourceDumpSha256: string; output: string };

const R3_FLAGS = { '--source-database': 'sourceDatabase', '--source-dump-sha256': 'sourceDumpSha256', '--output': 'output' } as const;

/** `export --source-database <name> --source-dump-sha256 <hex> --output <absolute path>`; each flag exactly once. */
export function parseR3ExportArgs(argv: readonly string[]): R3ExportArgs {
  const [command, ...rest] = argv;
  if (command !== 'export') {
    throw new AflApiRecoveryAbort(`R3: the only supported command is 'export' (got ${JSON.stringify(command ?? null)}). R4 is db:issue237:recover-importer-identities.`);
  }
  const values: Partial<R3ExportArgs> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const key = (R3_FLAGS as Record<string, keyof R3ExportArgs>)[flag];
    if (!key) throw new AflApiRecoveryAbort(`R3: unknown argument ${JSON.stringify(flag)}.`);
    if (values[key] !== undefined) throw new AflApiRecoveryAbort(`R3: ${flag} was given more than once.`);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) throw new AflApiRecoveryAbort(`R3: ${flag} needs a value.`);
    values[key] = value;
  }
  for (const [flag, key] of Object.entries(R3_FLAGS)) {
    if (values[key] === undefined) throw new AflApiRecoveryAbort(`R3: ${flag} is required.`);
  }
  return values as R3ExportArgs;
}

/** Name-level refusal, applied to argv, to the DSN's own path AND to the live `current_database()`. */
export function assertR3SourceDatabaseName(database: string, label: string): void {
  if (R3_FORBIDDEN_SOURCE_DATABASES.includes(database) || /prod/i.test(database)) {
    throw new AflApiRecoveryAbort(`R3: ${label} '${database}' is refused by name as an export source.`);
  }
  if (database !== R3_SOURCE_DATABASE) {
    throw new AflApiRecoveryAbort(`R3: ${label} is '${database}'; the only R1-proven source is '${R3_SOURCE_DATABASE}'.`);
  }
}

/** Exactly 64 hex characters, equal (case-insensitively) to R1.1's hash; returned in R1's own upper case. */
export function normaliseR3SourceDumpSha256(value: string): string {
  if (!/^[0-9A-Fa-f]{64}$/.test(value)) {
    throw new AflApiRecoveryAbort('R3: --source-dump-sha256 must be exactly 64 hexadecimal characters.');
  }
  const upper = value.toUpperCase();
  if (upper !== R3_SOURCE_DUMP_SHA256) {
    throw new AflApiRecoveryAbort(`R3: --source-dump-sha256 ${upper} is not the R1-proven dump hash ${R3_SOURCE_DUMP_SHA256}.`);
  }
  return upper;
}

/** The DSN comes from ONE dedicated variable. Its path is only an early refusal: the live session decides. */
export function resolveR3SourceDsn(env: Record<string, string | undefined>, sourceDatabase: string): string {
  const dsn = env[R3_SOURCE_DSN_ENV];
  if (!dsn || dsn.trim() === '') throw new AflApiRecoveryAbort(`R3: ${R3_SOURCE_DSN_ENV} is not set.`);
  let named: string;
  try {
    named = databaseOf(dsn.trim());
  } catch {
    throw new AflApiRecoveryAbort(`R3: ${R3_SOURCE_DSN_ENV} is not a valid connection URL.`);
  }
  assertR3SourceDatabaseName(named, `${R3_SOURCE_DSN_ENV}'s database`);
  if (named !== sourceDatabase) {
    throw new AflApiRecoveryAbort(`R3: ${R3_SOURCE_DSN_ENV} names '${named}', not --source-database '${sourceDatabase}'.`);
  }
  return dsn.trim();
}

const isWithin = (child: string, parent: string): boolean => {
  const rel = relative(process.platform === 'win32' ? parent.toLowerCase() : parent,
    process.platform === 'win32' ? child.toLowerCase() : child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/**
 * `--output` must be an absolute `.json` path that does not exist and does not resolve inside
 * any Git checkout (no ancestor, after resolving junctions/symlinks of the deepest existing
 * directory, holds a `.git` entry) nor inside any of `checkoutRoots`.
 */
export function resolveR3OutputPath(output: string, checkoutRoots: readonly string[]): string {
  if (!isAbsolute(output)) throw new AflApiRecoveryAbort(`R3: --output '${output}' is not an absolute path.`);
  const target = resolve(output);
  if (extname(target).toLowerCase() !== '.json') throw new AflApiRecoveryAbort(`R3: --output '${target}' must end in .json.`);
  if (existsSync(target)) throw new AflApiRecoveryAbort(`R3: --output '${target}' already exists; an export is never overwritten.`);

  // Deepest existing ancestor, resolved through any junction/symlink, then the missing tail re-appended.
  let existing = dirname(target);
  const tail: string[] = [basename(target)];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    tail.unshift(basename(existing));
    existing = parent;
  }
  const real = join(existsSync(existing) ? realpathSync.native(existing) : existing, ...tail);

  for (const root of checkoutRoots) {
    const roots = [resolve(root), ...(existsSync(root) ? [realpathSync.native(root)] : [])];
    if (roots.some((r) => isWithin(target, r) || isWithin(real, r))) {
      throw new AflApiRecoveryAbort(`R3: --output '${target}' is inside the checkout '${root}'; the export is never tracked.`);
    }
  }
  for (let dir = dirname(real); ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) {
      throw new AflApiRecoveryAbort(`R3: --output '${target}' resolves inside the Git checkout '${dir}'; the export is never tracked.`);
    }
    if (dirname(dir) === dir) break;
  }
  return target;
}

export type R3SessionProof = {
  database: string;
  transactionReadOnly: string;
  defaultReadOnly: string;
  isolation: string;
};

/** Live proof, from the export's OWN transaction, before any importer identity is read. */
export async function assertR3LiveSource(tx: TransactionSql, sourceDatabase: string): Promise<R3SessionProof> {
  const [proof] = await tx<R3SessionProof[]>`
    SELECT current_database() AS database,
           current_setting('transaction_read_only') AS "transactionReadOnly",
           current_setting('default_transaction_read_only') AS "defaultReadOnly",
           current_setting('transaction_isolation') AS isolation
  `;
  if (!proof) throw new AflApiRecoveryAbort('R3: the live session proof returned no row.');
  assertR3SourceDatabaseName(proof.database, 'the live current_database()');
  if (proof.database !== sourceDatabase) {
    throw new AflApiRecoveryAbort(`R3: the live current_database() is '${proof.database}', not --source-database '${sourceDatabase}'.`);
  }
  if (proof.transactionReadOnly !== 'on') {
    throw new AflApiRecoveryAbort(`R3: transaction_read_only is '${proof.transactionReadOnly}', expected 'on'; refusing a writable transaction.`);
  }
  if (proof.defaultReadOnly !== 'on') {
    throw new AflApiRecoveryAbort(`R3: default_transaction_read_only is '${proof.defaultReadOnly}', expected 'on'; the source is not frozen (R2).`);
  }
  if (proof.isolation !== 'repeatable read') {
    throw new AflApiRecoveryAbort(`R3: transaction_isolation is '${proof.isolation}', expected 'repeatable read'.`);
  }
  return proof;
}

export type R3Census = {
  rows: number;
  providers: number;
  stableIdentities: number;
  countsByMethod: Record<string, number>;
  /** Evidence only (never a refusal): `afltables_profile_path` = `players/<X>/<name>.html`. */
  identityKinds: Record<string, number>;
};

/** R1 binding, re-derived from the rows themselves (never from the export's own `countsByMethod` alone). */
export function assertR3ExportBinding(exported: Pick<AflApiImporterRecoveryExport, 'rows' | 'countsByMethod'>): R3Census {
  const { rows } = exported;
  if (rows.length !== R3_EXPECTED_ROWS) {
    throw new AflApiRecoveryAbort(`R3/R1.3: the export holds ${rows.length} row(s), expected exactly ${R3_EXPECTED_ROWS}.`);
  }
  const providers = new Set(rows.map((r) => r.externalId)).size;
  if (providers !== R3_EXPECTED_ROWS) {
    throw new AflApiRecoveryAbort(`R3/R1.5: ${providers} distinct provider(s), expected exactly ${R3_EXPECTED_ROWS} (duplicate provider).`);
  }
  if (rows.some((r) => typeof r.playerIdentity !== 'string' || r.playerIdentity === '')) {
    throw new AflApiRecoveryAbort('R3/R1.5: a row carries no stable identity.');
  }
  const stableIdentities = new Set(rows.map((r) => r.playerIdentity)).size;
  if (stableIdentities !== R3_EXPECTED_ROWS) {
    throw new AflApiRecoveryAbort(`R3/R1.5: ${stableIdentities} distinct stable identit(ies), expected exactly ${R3_EXPECTED_ROWS} (duplicate stable identity).`);
  }
  const countsByMethod: Record<string, number> = {};
  for (const r of rows) countsByMethod[r.matchMethod] = (countsByMethod[r.matchMethod] ?? 0) + 1;
  const methods = new Set([...Object.keys(countsByMethod), ...Object.keys(R3_EXPECTED_COUNTS_BY_METHOD)]);
  for (const method of [...methods].sort()) {
    const actual = countsByMethod[method] ?? 0;
    const expected = R3_EXPECTED_COUNTS_BY_METHOD[method] ?? 0;
    if (actual !== expected) {
      throw new AflApiRecoveryAbort(`R3/R1.4: method ${method} count is ${actual}, expected exactly ${expected}.`);
    }
    if ((exported.countsByMethod[method] ?? 0) !== expected) {
      throw new AflApiRecoveryAbort(`R3/R1.4: the export's countsByMethod.${method} is ${exported.countsByMethod[method] ?? 0}, expected exactly ${expected}.`);
    }
  }
  if (Object.keys(exported.countsByMethod).some((m) => !(m in R3_EXPECTED_COUNTS_BY_METHOD))) {
    throw new AflApiRecoveryAbort('R3/R1.4: the export\'s countsByMethod names a method outside the R1 census.');
  }
  const identityKinds: Record<string, number> = {};
  for (const r of rows) {
    const kind = /^players\/[^/]+\/[^/]+\.html?$/.test(r.playerIdentity) ? 'afltables_profile_path' : 'other';
    identityKinds[kind] = (identityKinds[kind] ?? 0) + 1;
  }
  return { rows: rows.length, providers, stableIdentities, countsByMethod, identityKinds };
}

/** Writes once: a `wx` temp file in the target directory, fsync, then a no-clobber hard link. */
function writeNewFileAtomically(target: string, content: string): void {
  mkdirSync(dirname(target), { recursive: true });
  const temp = join(dirname(target), `.${basename(target)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  const fd = openSync(temp, 'wx');
  try {
    try {
      writeSync(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      linkSync(temp, target); // fails with EEXIST rather than replacing (rename would replace on Windows)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new AflApiRecoveryAbort(`R3: '${target}' appeared during the write; an export is never overwritten.`);
      }
      throw error;
    }
  } finally {
    try { unlinkSync(temp); } catch { /* already gone */ }
  }
}

export type R3ExportReport = {
  proof: R3SessionProof;
  census: R3Census;
  sourceDumpSha256: string;
  payloadSha256: string;
  fileSha256: string;
  output: string;
};

/**
 * R3 end to end inside the caller's `REPEATABLE READ READ ONLY` transaction: live proof, the
 * library export (sole identity semantics, OD-1 fail-closed), the R1 binding, the write, then
 * a read-back through `parseAflApiImporterRecoveryExport`. Nothing is written unless every
 * pre-write check passes; a failed read-back removes the file it just created.
 */
export async function executeR3Export(
  tx: TransactionSql, input: { sourceDatabase: string; sourceDumpSha256: string; output: string },
): Promise<R3ExportReport> {
  const proof = await assertR3LiveSource(tx, input.sourceDatabase);
  const exported = await exportAflApiImporterIdentities(tx, {
    sourceDatabase: proof.database, sourceDumpSha256: input.sourceDumpSha256,
  });
  const census = assertR3ExportBinding(exported);

  writeNewFileAtomically(input.output, `${JSON.stringify(exported, null, 2)}\n`);
  try {
    const bytes = readFileSync(input.output);
    const parsed = parseAflApiImporterRecoveryExport(JSON.parse(bytes.toString('utf8')), { sourceDumpSha256: input.sourceDumpSha256 });
    if (parsed.sourceDumpSha256 !== input.sourceDumpSha256 || parsed.sourceDatabase !== proof.database) {
      throw new AflApiRecoveryAbort('R3: the written export does not carry the proven source database and dump hash.');
    }
    if (parsed.payloadSha256 !== exported.payloadSha256) {
      throw new AflApiRecoveryAbort('R3: the written export\'s payloadSha256 differs from the in-memory export.');
    }
    assertR3ExportBinding(parsed);
    return {
      proof, census, sourceDumpSha256: parsed.sourceDumpSha256, payloadSha256: parsed.payloadSha256,
      fileSha256: createHash('sha256').update(bytes).digest('hex').toUpperCase(), output: input.output,
    };
  } catch (error) {
    try { unlinkSync(input.output); } catch { /* nothing to remove */ }
    throw error;
  }
}

export function formatR3ExportReport(report: R3ExportReport): string {
  const pad = (label: string, width: number) => label.padEnd(width);
  const methods = Object.keys(R3_EXPECTED_COUNTS_BY_METHOD).sort();
  const w = Math.max(...methods.map((m) => m.length));
  return [
    `${pad('source database', 22)}: ${report.proof.database}`,
    `${pad('transaction read-only', 22)}: ${report.proof.transactionReadOnly}`,
    `${pad('default read-only', 22)}: ${report.proof.defaultReadOnly}`,
    `${pad('isolation', 22)}: ${report.proof.isolation}`,
    `${pad('rows', 22)}: ${report.census.rows}`,
    `${pad('providers', 22)}: ${report.census.providers}`,
    `${pad('stable identities', 22)}: ${report.census.stableIdentities}`,
    `${pad('stable identity kinds', 22)}: ${Object.entries(report.census.identityKinds).sort().map(([k, n]) => `${k} ${n}`).join(', ')}`,
    '',
    ...methods.map((m) => `${pad(m, w)} : ${report.census.countsByMethod[m] ?? 0}`),
    '',
    `${pad('source dump sha256', 22)}: ${report.sourceDumpSha256}`,
    `${pad('payload sha256', 22)}: ${report.payloadSha256}`,
    `${pad('file sha256', 22)}: ${report.fileSha256}`,
    `${pad('output', 22)}: ${report.output}`,
    'R3 export: PASS',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// R4 operator CLI — validate-only, dry-run, apply, run strictly in that order. Bound to the ONE
// proven R3 export (its file SHA256, payload SHA256, source dump SHA256 and R1 census are fixed
// constants below), and to exactly one target, afldb_test. Nothing here plans or resolves an
// identity: `recoverAflApiImporterIdentities` above is the only R4 semantics.
// ---------------------------------------------------------------------------

export const R4_TARGET_DATABASE = 'afldb_test';
/** The restricted `afldb_import` credential contract `db:test:rebuild`'s data stages use. */
export const R4_IMPORT_DSN_ENV = 'AFLDB_TEST_IMPORT_DATABASE_URL';
/** The owner DSN, used ONLY with an explicit `--allow-owner-import-dsn` (runbook §11a R4 names it). */
export const R4_OWNER_DSN_ENV = 'AFLDB_TEST_DATABASE_URL';
/** The R3 PASS evidence (§11a.1): the export's own `payloadSha256` ... */
export const R4_EXPORT_PAYLOAD_SHA256 = '3cfad942dabed98d69452a71b6f57b82cc951b63109fb0152dc74f362f6bcb9b';
/** ... and the SHA256 of the export file's bytes on disk. */
export const R4_EXPORT_FILE_SHA256 = '870EA366C63E9C6C434E8A41340B024A43BC80D413E41FF99B1D398836175D35';

export type R4Args = {
  mode: AflApiRecoveryMode;
  export: string;
  sourceDumpSha256: string;
  allowOwnerImportDsn: boolean;
};

const R4_VALUE_FLAGS = { '--export': 'export', '--source-dump-sha256': 'sourceDumpSha256' } as const;

/** `<validate-only|dry-run|apply> --export <abs path> --source-dump-sha256 <hex> [--allow-owner-import-dsn]`. */
export function parseR4Args(argv: readonly string[]): R4Args {
  const [mode, ...rest] = argv;
  if (!AFL_API_RECOVERY_MODES.includes(mode as AflApiRecoveryMode)) {
    throw new AflApiRecoveryAbort(
      `R4: the mode must be one of ${AFL_API_RECOVERY_MODES.join(', ')} (got ${JSON.stringify(mode ?? null)}).`);
  }
  const values: Partial<Record<'export' | 'sourceDumpSha256', string>> = {};
  let allowOwnerImportDsn = false;
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (flag === '--allow-owner-import-dsn') {
      if (allowOwnerImportDsn) throw new AflApiRecoveryAbort('R4: --allow-owner-import-dsn was given more than once.');
      allowOwnerImportDsn = true;
      continue;
    }
    const key = (R4_VALUE_FLAGS as Record<string, 'export' | 'sourceDumpSha256'>)[flag];
    if (!key) throw new AflApiRecoveryAbort(`R4: unknown argument ${JSON.stringify(flag)}.`);
    if (values[key] !== undefined) throw new AflApiRecoveryAbort(`R4: ${flag} was given more than once.`);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) throw new AflApiRecoveryAbort(`R4: ${flag} needs a value.`);
    values[key] = value;
    i += 1;
  }
  for (const [flag, key] of Object.entries(R4_VALUE_FLAGS)) {
    if (values[key] === undefined) throw new AflApiRecoveryAbort(`R4: ${flag} is required.`);
  }
  return {
    mode: mode as AflApiRecoveryMode, export: values.export!, sourceDumpSha256: values.sourceDumpSha256!,
    allowOwnerImportDsn,
  };
}

/** Exactly `afldb_test`: applied to the DSN's own path, and again to the live `current_database()`. */
export function assertR4TargetDatabaseName(database: string, label: string): void {
  if (database !== R4_TARGET_DATABASE) {
    throw new AflApiRecoveryAbort(`R4: ${label} is '${database}'; the only recovery target is '${R4_TARGET_DATABASE}'.`);
  }
}

export type R4TargetDsn = { dsn: string; credential: string };

/**
 * The target DSN comes from the environment, never argv, and is never printed. The restricted
 * `AFLDB_TEST_IMPORT_DATABASE_URL` is the contract. The owner `AFLDB_TEST_DATABASE_URL` is used
 * only when that is unset AND `--allow-owner-import-dsn` was given; nothing is substituted
 * silently. Either DSN's path must name `afldb_test` (an early refusal; the live session decides).
 */
export function resolveR4TargetDsn(
  env: Record<string, string | undefined>, opts: { allowOwnerImportDsn: boolean },
): R4TargetDsn {
  const pick = (name: string): string => {
    const dsn = env[name]!.trim();
    let named: string;
    try {
      named = databaseOf(dsn);
    } catch {
      throw new AflApiRecoveryAbort(`R4: ${name} is not a valid connection URL.`);
    }
    assertR4TargetDatabaseName(named, `${name}'s database`);
    return dsn;
  };
  if (env[R4_IMPORT_DSN_ENV] && env[R4_IMPORT_DSN_ENV]!.trim() !== '') {
    return { dsn: pick(R4_IMPORT_DSN_ENV), credential: `${R4_IMPORT_DSN_ENV} (restricted importer)` };
  }
  if (!opts.allowOwnerImportDsn) {
    throw new AflApiRecoveryAbort(
      `R4: ${R4_IMPORT_DSN_ENV} is not set. Set it to the afldb_import DSN for ${R4_TARGET_DATABASE}, or pass `
      + `--allow-owner-import-dsn to run as owner (${R4_OWNER_DSN_ENV}) deliberately.`);
  }
  if (!env[R4_OWNER_DSN_ENV] || env[R4_OWNER_DSN_ENV]!.trim() === '') {
    throw new AflApiRecoveryAbort(
      `R4: --allow-owner-import-dsn was given but ${R4_OWNER_DSN_ENV} is not set (and ${R4_IMPORT_DSN_ENV} is not set).`);
  }
  return { dsn: pick(R4_OWNER_DSN_ENV), credential: `${R4_OWNER_DSN_ENV} (owner, --allow-owner-import-dsn)` };
}

/** What the export file must be. The CLI passes the R3 PASS constants; tests pass their own. */
export type R4ExportBinding = { sourceDumpSha256: string; payloadSha256: string; fileSha256: string };

export const R4_EXPORT_BINDING: R4ExportBinding = Object.freeze({
  sourceDumpSha256: R3_SOURCE_DUMP_SHA256,
  payloadSha256: R4_EXPORT_PAYLOAD_SHA256,
  fileSha256: R4_EXPORT_FILE_SHA256,
});

export type VerifiedR4Export = {
  path: string;
  fileSha256: string;
  exported: AflApiImporterRecoveryExport;
  census: R3Census;
};

/**
 * Before any connection: the export is an absolute path to an existing file whose bytes hash
 * to the bound file SHA256; it parses through `parseAflApiImporterRecoveryExport` (format,
 * version, dump hash, self-consistent payload hash); its payload hash, source database and
 * dump hash are the bound R3 values; and the rows carry exactly the R1 census (802 rows, 802
 * providers, 802 stable identities, 3/129/397/273) with every row a well-formed D5 importer row.
 */
export function readR4Export(path: string, binding: R4ExportBinding = R4_EXPORT_BINDING): VerifiedR4Export {
  if (!isAbsolute(path)) throw new AflApiRecoveryAbort(`R4: --export '${path}' is not an absolute path.`);
  const target = resolve(path);
  if (!existsSync(target) || !statSync(target).isFile()) {
    throw new AflApiRecoveryAbort(`R4: --export '${target}' does not exist or is not a file.`);
  }
  const bytes = readFileSync(target);
  const fileSha256 = createHash('sha256').update(bytes).digest('hex').toUpperCase();
  if (fileSha256 !== binding.fileSha256.toUpperCase()) {
    throw new AflApiRecoveryAbort(
      `R4: the export file SHA256 is ${fileSha256}, expected the R3 PASS file ${binding.fileSha256.toUpperCase()} -- `
      + 'refusing any export other than the proven one.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new AflApiRecoveryAbort(`R4: --export '${target}' is not valid JSON.`);
  }
  const exported = parseAflApiImporterRecoveryExport(parsed, { sourceDumpSha256: binding.sourceDumpSha256 });
  if (exported.payloadSha256 !== binding.payloadSha256) {
    throw new AflApiRecoveryAbort(
      `R4: the export payloadSha256 is ${exported.payloadSha256}, expected the R3 PASS payload ${binding.payloadSha256}.`);
  }
  if (exported.sourceDatabase !== R3_SOURCE_DATABASE) {
    throw new AflApiRecoveryAbort(
      `R4: the export was taken from '${exported.sourceDatabase}', not the R1-proven source '${R3_SOURCE_DATABASE}'.`);
  }
  const census = assertR3ExportBinding(exported);
  const structure = importerCaptureStructureProblems(exported.rows);
  if (structure.length > 0) {
    throw new AflApiRecoveryAbort(
      `R4: the export holds ${structure.length} malformed importer row(s): ${structure.map((p) => JSON.stringify(p)).join('; ')}`);
  }
  return { path: target, fileSha256, exported, census };
}

/** The slice of a postgres.js client R4 uses; `main` adapts the real one, tests pass a fake. */
export type R4Connection = {
  begin: <T>(options: string, fn: (tx: TransactionSql) => Promise<T>) => Promise<T>;
  end: () => Promise<void>;
};

/** `validate-only` never writes, so its transaction is READ ONLY: the server refuses any write. */
export const R4_TRANSACTION_OPTIONS: Readonly<Record<AflApiRecoveryMode, string>> = Object.freeze({
  'validate-only': 'isolation level repeatable read read only',
  'dry-run': 'isolation level repeatable read',
  apply: 'isolation level repeatable read',
});
const R4_READER_OPTIONS = 'isolation level repeatable read read only';

/** Carries a non-apply result out of `begin`, so the transaction ROLLS BACK rather than commits. */
class R4RollbackSentinel extends Error {
  constructor(readonly result: AflApiRecoveryResult) { super('R4 rollback sentinel'); }
}

/** `apply` COMMITTED, then the fresh read-only re-read failed. Nothing can be rolled back now. */
export class R4PostCommitFailure extends AflApiRecoveryAbort {}

export type R4Report = {
  mode: AflApiRecoveryMode;
  targetDatabase: string;
  credential: string;
  export: VerifiedR4Export;
  result: AflApiRecoveryResult;
  transaction: 'ROLLED BACK' | 'COMMITTED';
  /** The fresh reader's importer-row count and whether any planned provider is present. */
  freshReader: { importerRows: number; plannedProvidersPresent: number; r5Parity: 'PASS' | 'NOT RUN'; invariant: 'PASS' };
};

/**
 * R4 end to end. ONE transaction runs `recoverAflApiImporterIdentities`; for `validate-only`
 * and `dry-run` it is rolled back unconditionally, for `apply` it commits only when that call
 * returned (every guard, the plan, the INSERTs, R5 parity and the invariants all passed) —
 * any throw rolls back all rows. A SECOND, fresh read-only connection then proves the outcome:
 * after a rollback the importer census is exactly the pre-transaction one with no planned
 * provider present; after a commit R5 parity and the combined invariant hold on the committed
 * state (runbook §11a R5, "again afterwards in a read-only census").
 */
export async function executeR4Recovery(input: {
  mode: AflApiRecoveryMode;
  verified: VerifiedR4Export;
  credential: string;
  connect: () => R4Connection;
  expectedSourceDumpSha256?: string;
}): Promise<R4Report> {
  const expectedSourceDumpSha256 = input.expectedSourceDumpSha256 ?? R3_SOURCE_DUMP_SHA256;
  const exported = input.verified.exported;

  let result: AflApiRecoveryResult;
  let transaction: R4Report['transaction'];
  const writer = input.connect();
  try {
    try {
      result = await writer.begin(R4_TRANSACTION_OPTIONS[input.mode], async (tx) => {
        const outcome = await recoverAflApiImporterIdentities(tx, { expectedSourceDumpSha256, export: exported, mode: input.mode });
        if (input.mode !== 'apply') throw new R4RollbackSentinel(outcome);
        if (!outcome.applied) throw new AflApiRecoveryAbort('R4: apply returned without applying -- refusing to commit.');
        return outcome;
      });
      transaction = 'COMMITTED';
    } catch (error) {
      if (!(error instanceof R4RollbackSentinel)) throw error;
      result = error.result;
      transaction = 'ROLLED BACK';
    }
  } finally {
    await writer.end();
  }

  const reader = input.connect();
  let freshReader: R4Report['freshReader'];
  try {
    freshReader = await reader.begin(R4_READER_OPTIONS, async (tx) => {
      const [{ database }] = await tx<{ database: string }[]>`SELECT current_database() AS database`;
      assertR4TargetDatabaseName(database, 'the fresh reader\'s current_database()');
      const [source] = await tx<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afl_api'`;
      if (!source) throw new AflApiRecoveryAbort(`R4: sources.key = 'afl_api' not found on ${R4_TARGET_DATABASE}.`);
      const allAflApi = new Set((await readAflApiCensusRows(tx, source.id)).map((r) => r.externalId));
      const { rows } = await readAflApiImporterRows(tx, source.id);
      const plannedProvidersPresent = result.plannedProviders.filter((p) => allAflApi.has(p)).length;
      if (transaction === 'ROLLED BACK') {
        if (rows.length !== result.preExistingImporterRows || plannedProvidersPresent !== 0) {
          throw new AflApiRecoveryAbort(
            `R4: the fresh reader does not see the rollback: ${rows.length} importer row(s) (expected `
            + `${result.preExistingImporterRows}), ${plannedProvidersPresent} planned provider(s) present (expected 0).`);
        }
        return { importerRows: rows.length, plannedProvidersPresent, r5Parity: 'NOT RUN' as const, invariant: 'PASS' as const };
      }
      assertR5Parity(exported, rows, 'post-commit fresh reader');
      await assertAflApiIdentityInvariant(tx);
      return { importerRows: rows.length, plannedProvidersPresent, r5Parity: 'PASS' as const, invariant: 'PASS' as const };
    });
  } catch (error) {
    if (transaction === 'COMMITTED') {
      throw new R4PostCommitFailure(
        `R4 apply: the transaction COMMITTED, but the post-commit fresh read-only re-read FAILED: ${(error as Error).message}`);
    }
    throw error;
  } finally {
    await reader.end();
  }

  return {
    mode: input.mode, targetDatabase: R4_TARGET_DATABASE, credential: input.credential,
    export: input.verified, result, transaction, freshReader,
  };
}

export function formatR4Report(report: R4Report): string {
  const pad = (label: string) => label.padEnd(26);
  const { result, export: verified } = report;
  const methods = Object.keys(R3_EXPECTED_COUNTS_BY_METHOD).sort();
  const lines = [
    `${pad('target database')}: ${report.targetDatabase}`,
    `${pad('credential')}: ${report.credential}`,
    `${pad('export')}: ${verified.path}`,
    `${pad('export rows')}: ${verified.census.rows}`,
    `${pad('providers')}: ${verified.census.providers}`,
    `${pad('stable identities')}: ${verified.census.stableIdentities}`,
    `${pad('pre-existing importer rows')}: ${result.preExistingImporterRows}`,
    `${pad(report.mode === 'apply' ? 'planned inserts' : 'would insert')}: ${result.wouldInsert}`,
    `${pad('already identical')}: ${result.alreadyIdentical}`,
    `${pad('conflicts')}: 0`,
  ];
  if (report.mode !== 'validate-only') lines.push(`${pad('inserted')}: ${result.inserted}`);
  lines.push(
    '',
    ...methods.map((m) => `${pad(m.replace(/^afl_api_/, ''))}: ${result.countsByMethod[m] ?? 0}`),
    '',
    `${pad('source dump sha256')}: ${verified.exported.sourceDumpSha256}`,
    `${pad('export payload sha256')}: ${verified.exported.payloadSha256}`,
    `${pad('export file sha256')}: ${verified.fileSha256}`,
    '',
    `${pad('R5 projected parity')}: ${result.projectedParity}`,
    `${pad('R5 parity')}: ${result.writtenParity}`,
    `${pad('AFL API invariant')}: ${result.invariant}`,
    `${pad('transaction')}: ${report.transaction}`,
    `${pad('fresh reader importer rows')}: ${report.freshReader.importerRows}`,
    `${pad('fresh reader planned rows')}: ${report.freshReader.plannedProvidersPresent}`,
  );
  if (report.transaction === 'COMMITTED') {
    lines.push(
      `${pad('post-commit R5 parity')}: ${report.freshReader.r5Parity}`,
      `${pad('post-commit invariant')}: ${report.freshReader.invariant}`,
    );
  }
  lines.push(`R4 ${report.mode}: PASS`);
  return lines.join('\n');
}

async function mainR4(argv: string[]): Promise<void> {
  // Every argv/env/file refusal happens BEFORE any connection is opened.
  const args = parseR4Args(argv);
  const expectedSourceDumpSha256 = normaliseR3SourceDumpSha256(args.sourceDumpSha256);
  const { dsn, credential } = resolveR4TargetDsn(process.env, { allowOwnerImportDsn: args.allowOwnerImportDsn });
  const verified = readR4Export(args.export);

  console.log(`AFLDB-ISSUE-237 R4 — ${args.mode}`);
  console.log('');
  const connect = (): R4Connection => {
    const sql = postgres(dsn, { max: 1, onnotice: () => {}, connection: { application_name: `afldb-issue237-r4-${args.mode}` } });
    return {
      begin: <T>(options: string, fn: (tx: TransactionSql) => Promise<T>) => sql.begin(options, fn) as Promise<T>,
      end: () => sql.end(),
    };
  };
  const report = await executeR4Recovery({ mode: args.mode, verified, credential, connect, expectedSourceDumpSha256 });
  console.log(formatR4Report(report));
}

async function main(argv: string[]): Promise<void> {
  if (argv[0] === 'r4') return mainR4(argv.slice(1));
  // Every argv/env/path refusal happens BEFORE any connection is opened.
  const args = parseR3ExportArgs(argv);
  assertR3SourceDatabaseName(args.sourceDatabase, '--source-database');
  const sourceDumpSha256 = normaliseR3SourceDumpSha256(args.sourceDumpSha256);
  const dsn = resolveR3SourceDsn(process.env, args.sourceDatabase);
  const output = resolveR3OutputPath(args.output, [process.cwd(), resolve(dirname(process.argv[1]), '..', '..')]);

  console.log(`AFLDB-ISSUE-237 R3 — export importer identities from ${args.sourceDatabase} (read-only)`);
  const sql = postgres(dsn, { max: 1, onnotice: () => {}, connection: { application_name: 'afldb-issue237-r3-export' } });
  let report: R3ExportReport;
  try {
    report = await sql.begin('isolation level repeatable read read only', (tx) =>
      executeR3Export(tx, { sourceDatabase: args.sourceDatabase, sourceDumpSha256, output })) as R3ExportReport;
  } finally {
    await sql.end();
  }
  console.log(formatR3ExportReport(report));
}

if (process.argv[1] && /recover_afl_api_importer_identities\.ts$/.test(process.argv[1])) {
  const argv = process.argv.slice(2);
  main(argv)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(`    REFUSED: ${redact((error as Error).message)}`);
      if (argv[0] === 'r4') {
        const mode = AFL_API_RECOVERY_MODES.includes(argv[1] as AflApiRecoveryMode) ? argv[1] : '(no mode)';
        console.error(error instanceof R4PostCommitFailure
          ? `    R4 ${mode}: FAIL (transaction COMMITTED; the post-commit re-read failed -- report to the operator)`
          : `    R4 ${mode}: FAIL (transaction ROLLED BACK or never opened; nothing written)`);
      } else {
        console.error('    R3 export: FAIL (this run left no export file)');
      }
      process.exit(1);
    });
}
