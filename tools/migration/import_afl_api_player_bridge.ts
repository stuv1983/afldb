#!/usr/bin/env node
/**
 * AFLDB-ISSUE-241 / AFLDB-ISSUE-240 — the fail-closed AFL API player-identity bridge loader.
 *
 *     npx tsx tools/migration/import_afl_api_player_bridge.ts --validate-only --artefact <path> [--target afldb_test|dev]
 *     npx tsx tools/migration/import_afl_api_player_bridge.ts --dry-run       --artefact <path> [--target afldb_test|dev]
 *     npx tsx tools/migration/import_afl_api_player_bridge.ts --apply         --artefact <path> [--target afldb_test|dev]
 *
 * It replaces `import_afl_api_player_bridge.py` (AFLDB-ISSUE-228 S5/S5b/§9.10/S9), which now only
 * refuses and names this file. The port exists for one reason: ISSUE-241 requires every row to be
 * resolved on the target through its STABLE identity, and the one implementation of that lookup
 * (`classifyAflApiReverseIdentity`, continuity rules included, ISSUE-237 §5) is TypeScript. A
 * Python copy would be a second identity implementation. Everything the Python loader enforced is
 * kept, unchanged unless named below:
 *
 *   - `--artefact` is mandatory; `--target` is the closed list {afldb_test, dev}; no PROD target
 *     exists and none can be named. DSNs come only from the target's own variables, must NAME the
 *     target database, and the live session proves `current_database()` (and, on DEV, the
 *     expected role) before any statement that reads identity state.
 *   - `source_key` must be `afl_api`; `match_method` must be one of the four importer classes
 *     (`AFL_API_IMPORTER_MATCH_METHODS`, the D5 set); the value written is the artefact's own.
 *   - `afl_api_stat_vector_season` keeps its target-bound provenance gate (S9), unchanged.
 *   - Every pinned `inputs[]` file must still hash to its recorded sha256.
 *   - No `external_identities` row is ever UPDATEd or DELETEd, whichever writer owns it.
 *
 * NEW (ISSUE-241). Every artefact must declare the stable-identity contract and every linked row
 * must carry `candidate_player_identity`; the loader resolves it on the target and never reads
 * `candidate_player_id` to choose a player (`afl-api-bridge-identity.ts`). An identity that
 * resolves to no player, several players, or contradicts a tracked continuity rule refuses the
 * WHOLE run before any write.
 *
 * NEW (ISSUE-240). A withheld contradiction or player collision is recorded with a semantic
 * `issue_key` and `ON CONFLICT ... DO NOTHING` against migration 076's open-key index: an
 * identical open finding is never duplicated and never rewritten. Every detection, including a
 * duplicate, is still recorded in the apply batch's `import_rejections`.
 *
 * MODES.
 *   --validate-only  one READ ONLY REPEATABLE READ transaction; the read role; writes nothing.
 *   --dry-run        the full write path in one transaction, then rolled back. No import batch
 *                    survives (nothing happened, so nothing is recorded as having happened).
 *   --apply          the same write path, tracked by one `import_batches` row created and
 *                    completed INSIDE the same transaction: a failed apply leaves nothing.
 * A STOP exits non-zero in every mode, and nothing is written.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres, { type TransactionSql } from 'postgres';

import {
  AFL_API_IMPORTER_MATCH_METHODS,
  isAflApiImporterMatchMethod,
  type AflApiForwardIdentityResult,
  type AflApiImporterMatchMethod,
} from '../../src/lib/acquisition/afl-api-adjudication';
import {
  AFL_API_CONTRADICTION_ISSUE_TYPE,
  aflApiBridgeFindingRecord,
  aflApiBridgeLinkedRows,
  planAflApiBridgeImport,
  type AflApiBridgeExistingRow,
  type AflApiBridgeFinding,
  type AflApiBridgeLinkedRow,
  type AflApiBridgePlan,
} from '../../src/lib/acquisition/afl-api-bridge-identity';
import {
  AFL_API_SEASON_EVIDENCE_MATCH_METHOD,
  EXISTING_CLAIM_COMPARISON_UNPROVED,
} from '../../src/lib/acquisition/afl-api-player-evidence';
import { redact } from '../db/psql';
import { readAflApiForwardIdentities, resolveAflApiPlayerIdentities } from './replay_afl_api_adjudications';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

export const TOOL = 'tools/migration/import_afl_api_player_bridge.ts';
export const SOURCE_KEY = 'afl_api';

/** Refused before anything was written. Every refusal in this file is one of these. */
export class ImportRefused extends Error {}

/* ------------------------------------------------------------------ *
 * Targets (closed list; no PROD entry, none addable from the command line)
 * ------------------------------------------------------------------ */

export type BridgeTargetName = 'afldb_test' | 'dev';

export type BridgeTarget = {
  database: string;
  readDsnEnv: string;
  writeDsnEnv: string;
  /** `null`: no role gate (afldb_test keeps S5/S5b/§9.10 behaviour). */
  readRole: string | null;
  writeRole: string | null;
};

export const BRIDGE_TARGETS: Readonly<Record<BridgeTargetName, BridgeTarget>> = Object.freeze({
  afldb_test: {
    database: 'afldb_test', readDsnEnv: 'AFLDB_TEST_DATABASE_URL', writeDsnEnv: 'AFLDB_TEST_IMPORT_DATABASE_URL',
    readRole: null, writeRole: null,
  },
  dev: {
    database: 'afldb_dev', readDsnEnv: 'DATABASE_URL', writeDsnEnv: 'AFLDB_IMPORT_DATABASE_URL',
    readRole: 'afldb_app', writeRole: 'afldb_import',
  },
});

/**
 * The season class's provenance gate (AFLDB-ISSUE-228 S9), TARGET-BOUND and unchanged: accepted
 * only by the target whose own database built it, from that database's pinned emitter.
 */
export const SEASON_EVIDENCE_PROVENANCE_BY_TARGET: Readonly<Record<BridgeTargetName, { builtFromDatabase: string; tool: string }>> = Object.freeze({
  dev: { builtFromDatabase: 'afldb_dev', tool: 'tools/current-season/emit-afl-api-player-bridge.ts' },
  afldb_test: { builtFromDatabase: 'afldb_test', tool: 'tools/current-season/emit-afl-api-player-bridge-test.ts' },
});

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/* ------------------------------------------------------------------ *
 * Arguments and DSNs (every refusal here is before any connection)
 * ------------------------------------------------------------------ */

export type BridgeImportMode = 'validate-only' | 'dry-run' | 'apply';

export type BridgeImportArgs = { mode: BridgeImportMode; target: BridgeTargetName; artefact: string };

export function parseBridgeImportArgs(argv: readonly string[]): BridgeImportArgs {
  const modes: BridgeImportMode[] = [];
  let target: string | null = null;
  let artefact: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--validate-only') modes.push('validate-only');
    else if (flag === '--dry-run') modes.push('dry-run');
    else if (flag === '--apply') modes.push('apply');
    else if (flag === '--target' || flag === '--artefact') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new ImportRefused(`${flag} needs a value.`);
      if (flag === '--target') target = value; else artefact = value;
      i += 1;
    } else {
      throw new ImportRefused(`Unknown argument '${flag}'.`);
    }
  }
  if (modes.length !== 1) {
    throw new ImportRefused('Exactly one of --validate-only, --dry-run or --apply is required.');
  }
  if (artefact === null) {
    throw new ImportRefused('--artefact is mandatory: there is no default or newest-file selection.');
  }
  const targetName = target ?? 'afldb_test';
  if (!Object.prototype.hasOwnProperty.call(BRIDGE_TARGETS, targetName)) {
    throw new ImportRefused(`--target '${targetName}' is not one of ${Object.keys(BRIDGE_TARGETS).join(', ')}; `
      + 'no PROD target exists.');
  }
  return { mode: modes[0], target: targetName as BridgeTargetName, artefact };
}

/** The DSN in `envName`, proven to name `database`. The value itself is never echoed. */
export function resolveBridgeDsn(env: Record<string, string | undefined>, envName: string, database: string): string {
  const raw = env[envName];
  if (!raw || raw.trim() === '') throw new ImportRefused(`${envName} is not set -- refusing`);
  const dsn = raw.trim();
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new ImportRefused(`${envName} is not a valid postgresql:// DSN`);
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new ImportRefused(`${envName} is not a postgresql:// DSN`);
  }
  if (decodeURIComponent(url.pathname.replace(/^\//, '')) !== database) {
    throw new ImportRefused(`${envName} does not target /${database} -- refusing`);
  }
  return dsn;
}

/* ------------------------------------------------------------------ *
 * The artefact (offline)
 * ------------------------------------------------------------------ */

export type LoadedBridgeArtefact = {
  path: string;
  fileSha256: string;
  evidenceClass: AflApiImporterMatchMethod;
  rows: AflApiBridgeLinkedRow[];
};

/** The S9 season provenance gate, DB-free. `null` when acceptable, else the refusal reason. */
export function seasonEvidenceProvenanceProblem(artefact: Record<string, unknown>, target: BridgeTargetName): string | null {
  const required = SEASON_EVIDENCE_PROVENANCE_BY_TARGET[target];
  if (artefact.built_from_database !== required.builtFromDatabase) {
    return `built_from_database is ${JSON.stringify(artefact.built_from_database ?? null)}, but --target ${target} `
      + `accepts only evidence built from '${required.builtFromDatabase}'`;
  }
  if (artefact.tool !== required.tool) {
    return `tool is ${JSON.stringify(artefact.tool ?? null)}, but --target ${target} accepts only evidence emitted by `
      + `'${required.tool}'`;
  }
  if (artefact.read_only !== true) return `read_only is ${JSON.stringify(artefact.read_only ?? null)}, expected exactly true`;
  const season = artefact.season;
  if (typeof season !== 'number' || !Number.isFinite(season)) return `season is ${JSON.stringify(season ?? null)}, expected a number`;
  if (typeof artefact.snapshot_label !== 'string' || artefact.snapshot_label === '') {
    return `snapshot_label is ${JSON.stringify(artefact.snapshot_label ?? null)}, expected a non-empty string`;
  }
  if (typeof artefact.snapshot_manifest_sha256 !== 'string' || !SHA256_HEX_RE.test(artefact.snapshot_manifest_sha256)) {
    return `snapshot_manifest_sha256 is ${JSON.stringify(artefact.snapshot_manifest_sha256 ?? null)}, expected exactly 64 `
      + 'lowercase hex characters';
  }
  if (artefact.existing_claim_comparison !== EXISTING_CLAIM_COMPARISON_UNPROVED) {
    return `existing_claim_comparison is ${JSON.stringify(artefact.existing_claim_comparison ?? null)}, expected `
      + `'${EXISTING_CLAIM_COMPARISON_UNPROVED}'`;
  }
  return null;
}

/**
 * Load and PROVE an artefact: parse, class, provenance, pinned inputs and the ISSUE-241 identity
 * contract. Any problem refuses before a connection is opened.
 */
export function loadBridgeArtefact(
  path: string, target: BridgeTargetName, repoRoot: string = REPO_ROOT,
): LoadedBridgeArtefact {
  if (!existsSync(path)) throw new ImportRefused(`artefact not found: ${path}`);
  const bytes = readFileSync(path);
  let artefact: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    artefact = parsed as Record<string, unknown>;
  } catch {
    throw new ImportRefused(`${path}: is not a JSON object`);
  }
  if (artefact.source_key !== SOURCE_KEY) {
    throw new ImportRefused(`${path}: source_key is ${JSON.stringify(artefact.source_key ?? null)}, expected '${SOURCE_KEY}'`);
  }
  const evidenceClass = artefact.match_method;
  if (typeof evidenceClass !== 'string' || !isAflApiImporterMatchMethod(evidenceClass)) {
    throw new ImportRefused(`${path}: match_method is ${JSON.stringify(evidenceClass ?? null)}, expected one of `
      + `${AFL_API_IMPORTER_MATCH_METHODS.join(', ')}`);
  }
  if (evidenceClass === AFL_API_SEASON_EVIDENCE_MATCH_METHOD) {
    const problem = seasonEvidenceProvenanceProblem(artefact, target);
    if (problem !== null) throw new ImportRefused(`${path}: ${AFL_API_SEASON_EVIDENCE_MATCH_METHOD} evidence refused -- ${problem}`);
  }
  const inputs = artefact.inputs ?? [];
  if (!Array.isArray(inputs)) throw new ImportRefused(`${path}: inputs is not a list`);
  for (const entry of inputs as { file?: unknown; sha256?: unknown }[]) {
    if (typeof entry?.file !== 'string' || typeof entry.sha256 !== 'string') {
      throw new ImportRefused(`${path}: a pinned input entry is malformed`);
    }
    const file = join(repoRoot, entry.file);
    if (!existsSync(file)) throw new ImportRefused(`${path}: pinned input missing on disk: ${entry.file}`);
    const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
    if (actual !== entry.sha256) {
      throw new ImportRefused(`${path}: pinned input changed on disk since the artefact was built: ${entry.file} `
        + `(expected ${entry.sha256}, got ${actual})`);
    }
  }
  const { rows, problems } = aflApiBridgeLinkedRows(artefact, evidenceClass);
  if (problems.length > 0) {
    throw new ImportRefused(`${path}: refused by the stable-identity contract (AFLDB-ISSUE-241), nothing read or `
      + `written: ${problems.join('; ')}`);
  }
  return {
    path, evidenceClass, rows, fileSha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

/* ------------------------------------------------------------------ *
 * Database reads and the run
 * ------------------------------------------------------------------ */

/** The one connection shape the run needs; a real `postgres.Sql` satisfies it. */
export type BridgeConnection = {
  begin: <T>(options: string, fn: (tx: TransactionSql) => Promise<T>) => Promise<T>;
};

export type BridgeSessionExpectation = { database: string; role: string | null };

async function proveSession(
  tx: TransactionSql, expected: BridgeSessionExpectation, readOnly: boolean,
): Promise<void> {
  const [row] = await tx<{ database: string; role: string; readOnly: string }[]>`
    SELECT current_database() AS database, current_user AS role,
           current_setting('transaction_read_only') AS "readOnly"
  `;
  if (row?.database !== expected.database) {
    throw new ImportRefused(`REFUSED: the connected database is '${String(row?.database)}', not '${expected.database}'`);
  }
  if (expected.role !== null && row.role !== expected.role) {
    throw new ImportRefused(`REFUSED: the session role is '${row.role}', not '${expected.role}'`);
  }
  if (readOnly && row.readOnly !== 'on') {
    throw new ImportRefused('REFUSED: validate-only requires a read-only transaction');
  }
}

export type BridgeFacts = {
  sourceId: number;
  existingRows: AflApiBridgeExistingRow[];
  plan: AflApiBridgePlan;
};

/** Every fact the planner needs, read inside the caller's transaction, then the plan. */
export async function readFactsAndPlan(
  tx: TransactionSql, loaded: LoadedBridgeArtefact,
): Promise<BridgeFacts> {
  const [source] = await tx<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afl_api'`;
  if (!source) throw new ImportRefused("unknown source key: 'afl_api'");
  const existingRows = await tx<AflApiBridgeExistingRow[]>`
    SELECT id, external_id AS "externalId", status::text AS status, match_method AS "matchMethod",
           player_id AS "playerId"
      FROM external_identities WHERE source_id = ${source.id}
  `;
  const remapByIdentity = await resolveAflApiPlayerIdentities(tx, loaded.rows.map((r) => r.identity));
  const holders = [...new Set(existingRows.filter((r) => r.playerId !== null).map((r) => r.playerId as number))];
  const forwardIdentityByPlayerId: ReadonlyMap<number, AflApiForwardIdentityResult> =
    await readAflApiForwardIdentities(tx, holders);
  const plan = planAflApiBridgeImport({
    evidenceClass: loaded.evidenceClass, rows: loaded.rows, remapByIdentity, existingRows, forwardIdentityByPlayerId,
  });
  return { sourceId: source.id, existingRows, plan };
}

export type BridgeImportReport = {
  mode: BridgeImportMode;
  artefact: { path: string; sha256: string; evidenceClass: AflApiImporterMatchMethod; linkedRows: number };
  outcome: 'COMMITTED' | 'ROLLED_BACK' | 'READ_ONLY' | 'REFUSED';
  linked: number;
  alreadyLinked: number;
  alreadyLinkedHuman: number;
  contradictionsWithheld: string[];
  playerCollisionsWithheld: string[];
  /** Findings this run opened (write modes) or would open (validate-only). */
  findingsRecorded: number;
  /** Findings whose identical open row already existed: not duplicated, not rewritten. */
  findingsAlreadyOpen: number;
  hintMismatches: AflApiBridgePlan['hintMismatches'];
  stops: AflApiBridgePlan['stops'];
  importBatchId: string | null;
};

class DryRunRollback extends Error {}

async function openKeysOf(tx: TransactionSql, findings: readonly AflApiBridgeFinding[]): Promise<Set<string>> {
  if (findings.length === 0) return new Set();
  const rows = await tx<{ issueKey: string }[]>`
    SELECT issue_key AS "issueKey" FROM data_issues
     WHERE issue_type = ${AFL_API_CONTRADICTION_ISSUE_TYPE} AND resolved_at IS NULL
       AND issue_key = ANY (${tx.array(findings.map((f) => f.issueKey))}::text[])
  `;
  return new Set(rows.map((r) => r.issueKey));
}

function baseReport(mode: BridgeImportMode, loaded: LoadedBridgeArtefact, plan: AflApiBridgePlan): BridgeImportReport {
  return {
    mode,
    artefact: { path: loaded.path, sha256: loaded.fileSha256, evidenceClass: loaded.evidenceClass, linkedRows: loaded.rows.length },
    outcome: 'REFUSED',
    linked: plan.inserts.length,
    alreadyLinked: plan.alreadyLinked.length,
    alreadyLinkedHuman: plan.alreadyLinkedHuman.length,
    contradictionsWithheld: plan.contradictions.map((f) => f.externalId),
    playerCollisionsWithheld: plan.playerCollisions.map((f) => f.externalId),
    findingsRecorded: 0,
    findingsAlreadyOpen: 0,
    hintMismatches: plan.hintMismatches,
    stops: plan.stops,
    importBatchId: null,
  };
}

function refuseStops(plan: AflApiBridgePlan): void {
  if (plan.stops.length === 0) return;
  throw new ImportRefused(
    `${plan.stops.length} linked provider(s) do not resolve through their stable identity on the target; `
    + 'the whole run is refused and nothing was written: '
    + plan.stops.map((s) => `${s.externalId} (${s.reason})`).join('; '));
}

/**
 * The run, against an already-open connection. Exported for the DB-free tests and the
 * code_test_db rehearsal (tools/db/afl-api-identity-bulk-rehearsal.ts), which pass their own
 * connection and expected database; the CLI below passes the closed-list target's.
 */
export async function importAflApiBridge(input: {
  mode: BridgeImportMode;
  connection: BridgeConnection;
  expected: BridgeSessionExpectation;
  loaded: LoadedBridgeArtefact;
}): Promise<BridgeImportReport> {
  const { mode, loaded, expected } = input;

  if (mode === 'validate-only') {
    return input.connection.begin('isolation level repeatable read read only', async (tx) => {
      await proveSession(tx, expected, true);
      const { plan } = await readFactsAndPlan(tx, loaded);
      const report = baseReport(mode, loaded, plan);
      if (plan.stops.length > 0) return report;
      const findings = [...plan.contradictions, ...plan.playerCollisions];
      const open = await openKeysOf(tx, findings);
      const distinctNew = new Set(findings.filter((f) => !open.has(f.issueKey)).map((f) => f.issueKey));
      return { ...report, outcome: 'READ_ONLY', findingsRecorded: distinctNew.size, findingsAlreadyOpen: findings.length - distinctNew.size };
    });
  }

  // Assigned inside the transaction callback; a holder, because a closure assignment to a `let`
  // is invisible to TypeScript's narrowing.
  const state: { report: BridgeImportReport | null } = { report: null };
  try {
    await input.connection.begin('isolation level read committed', async (tx) => {
      await proveSession(tx, expected, false);
      const { sourceId, plan } = await readFactsAndPlan(tx, loaded);
      state.report = baseReport(mode, loaded, plan);
      refuseStops(plan);

      let batchId: string | null = null;
      if (mode === 'apply') {
        const [batch] = await tx<{ id: string }[]>`
          INSERT INTO import_batches (source_id, tool, target_table, notes)
          VALUES (${sourceId}, ${TOOL}, 'external_identities',
                  ${`apply match_method=${loaded.evidenceClass} artefact_sha256=${loaded.fileSha256}`})
          RETURNING id::text AS id
        `;
        batchId = batch.id;
      }

      // Links first, so a collision against a row this run inserts names that row's real id.
      const insertedIdByExternalId = new Map<string, number>();
      for (const insert of plan.inserts) {
        const [written] = await tx<{ id: number }[]>`
          INSERT INTO external_identities
                (source_id, external_id, external_name, player_id, status, candidate_count, match_method, notes)
          VALUES (${sourceId}, ${insert.externalId}, ${insert.row.observedName}, ${insert.playerId}, 'unique', 1,
                  ${loaded.evidenceClass}, ${insert.row.evidenceSummary})
          RETURNING id
        `;
        insertedIdByExternalId.set(insert.externalId, written.id);
      }

      const rejections: { externalId: string; payload: Record<string, unknown> }[] = [];
      let recorded = 0;
      let alreadyOpen = 0;
      for (const planned of [...plan.contradictions, ...plan.playerCollisions]) {
        const entityId = planned.entityId ?? insertedIdByExternalId.get(planned.existing.externalId) ?? null;
        if (entityId === null) {
          throw new ImportRefused(`the finding for ${planned.externalId} names no external_identities row`);
        }
        const finding = { ...planned, entityId };
        const { description, details } = aflApiBridgeFindingRecord(finding, { tool: TOOL, artefactSha256: loaded.fileSha256 });
        const inserted = await tx<{ id: string }[]>`
          INSERT INTO data_issues (entity_type, entity_id, issue_type, issue_key, severity, description, details)
          VALUES ('external_identities', ${finding.entityId}, ${AFL_API_CONTRADICTION_ISSUE_TYPE}, ${finding.issueKey},
                  'warning', ${description}, ${tx.json(details as never)})
          ON CONFLICT (issue_type, issue_key) WHERE issue_key IS NOT NULL AND resolved_at IS NULL
          DO NOTHING
          RETURNING id::text AS id
        `;
        if (inserted.length > 0) recorded += 1; else alreadyOpen += 1;
        rejections.push({
          externalId: finding.externalId,
          payload: { kind: finding.kind, issue_key: finding.issueKey, data_issue_id: inserted[0]?.id ?? null,
            already_open: inserted.length === 0, artefact_row: finding.row.raw },
        });
      }

      state.report = { ...state.report, findingsRecorded: recorded, findingsAlreadyOpen: alreadyOpen, importBatchId: batchId };

      if (mode === 'dry-run') throw new DryRunRollback();

      for (const r of rejections) {
        await tx`
          INSERT INTO import_rejections (import_batch_id, source_record_id, reason, payload)
          VALUES (${batchId}::bigint, ${r.externalId}, ${AFL_API_CONTRADICTION_ISSUE_TYPE}, ${tx.json(r.payload as never)})
        `;
      }
      const validation = {
        artefact_sha256: loaded.fileSha256, evidence_class: loaded.evidenceClass,
        linked: plan.inserts.length, already_linked: plan.alreadyLinked.length,
        already_linked_human: plan.alreadyLinkedHuman.length,
        findings_recorded: recorded, findings_already_open: alreadyOpen,
        candidate_player_id_hint_mismatches: plan.hintMismatches,
      };
      await tx`
        UPDATE import_batches
           SET completed_at = now(), status = 'completed', records_read = ${loaded.rows.length},
               records_inserted = ${plan.inserts.length}, records_updated = 0,
               records_rejected = ${rejections.length}, validation_result = ${tx.json(validation as never)}
         WHERE id = ${batchId}::bigint
      `;
    });
  } catch (error) {
    if (error instanceof DryRunRollback && state.report !== null) return { ...state.report, outcome: 'ROLLED_BACK' };
    throw error;
  }
  if (state.report === null) throw new ImportRefused('the apply transaction produced no report');
  return { ...state.report, outcome: 'COMMITTED' };
}

export function formatBridgeImportReport(report: BridgeImportReport): string {
  const line = (label: string, value: number) => `    ${label.padEnd(40)} ${String(value).padStart(9)}`;
  const lines = [
    `  artefact ${report.artefact.path}`,
    `    sha256 ${report.artefact.sha256}, match_method=${report.artefact.evidenceClass}, `
      + `${report.artefact.linkedRows} linked provider id(s)`,
    `  mode ${report.mode}: ${report.outcome}`,
  ];
  if (report.stops.length > 0) {
    lines.push(`    STOP: ${report.stops.length} identity refusal(s); the whole run is refused, nothing written:`);
    for (const s of report.stops) lines.push(`      ${s.externalId}: ${s.reason}`);
    return lines.join('\n');
  }
  const verb = report.mode === 'validate-only' ? 'would ' : '';
  lines.push(
    line(`${verb}link`, report.linked),
    line('already_linked', report.alreadyLinked),
    line('already_linked_human', report.alreadyLinkedHuman),
    line(`contradictions_withheld`, report.contradictionsWithheld.length),
    line(`player_collisions_withheld`, report.playerCollisionsWithheld.length),
    line(`${verb}record_new_finding`, report.findingsRecorded),
    line('finding_already_open (not duplicated)', report.findingsAlreadyOpen),
    line('candidate_player_id_hint_ignored', report.hintMismatches.length),
  );
  if (report.contradictionsWithheld.length > 0) lines.push(`    contradictory provider ids: ${report.contradictionsWithheld.join(', ')}`);
  if (report.playerCollisionsWithheld.length > 0) lines.push(`    player-collision provider ids: ${report.playerCollisionsWithheld.join(', ')}`);
  for (const m of report.hintMismatches) {
    lines.push(`    ${m.externalId}: candidate_player_id ${m.hintPlayerId} ignored; its identity resolves to ${m.resolvedPlayerId}`);
  }
  if (report.importBatchId !== null) lines.push(`    import_batches.id ${report.importBatchId}`);
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

function loadEnv(root: string): void {
  let contents: string;
  try {
    contents = readFileSync(join(root, '.env'), 'utf8');
  } catch {
    return;
  }
  for (const raw of contents.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    const name = key.trim();
    if (!process.env[name]) process.env[name] = rest.join('=').trim();
  }
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseBridgeImportArgs(argv);
  loadEnv(REPO_ROOT);
  const target = BRIDGE_TARGETS[args.target];
  console.log(`  loading artefact ${args.artefact} (target=${args.target})`);
  const loaded = loadBridgeArtefact(args.artefact, args.target);
  const readOnly = args.mode === 'validate-only';
  const dsn = resolveBridgeDsn(process.env, readOnly ? target.readDsnEnv : target.writeDsnEnv, target.database);
  const sql = postgres(dsn, {
    max: 1, onnotice: () => {},
    connection: {
      application_name: `afldb-import-afl-api-player-bridge-${args.mode}`,
      ...(readOnly ? { default_transaction_read_only: true } : {}),
      TimeZone: 'UTC',
    },
  });
  try {
    const report = await importAflApiBridge({
      mode: args.mode,
      connection: { begin: (options, fn) => sql.begin(options, fn) as never },
      expected: { database: target.database, role: readOnly ? target.readRole : target.writeRole },
      loaded,
    });
    console.log(formatBridgeImportReport(report));
    return report.stops.length > 0 ? 1 : 0;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const invokedDirectly = process.argv[1] !== undefined
  && relative(resolve(process.argv[1]), fileURLToPath(import.meta.url)) === '';

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(`REFUSED: ${redact((error as Error).message)}`);
      console.error('  nothing was written (the transaction rolled back or was never opened)');
      process.exit(1);
    });
}
