#!/usr/bin/env node
/**
 * AFLDB-ISSUE-238 Slice 5 — the ORIGINAL correction CLI and transaction.
 *
 *     npx tsx tools/migration/correct_afl_api_identity.ts --validate-only \
 *       --provider-id <CD_I> --to-player-id <P'> --admin-user-id <n> --note "<text>" \
 *       --evidence-file <path> --expect-database <db> [--acknowledge-surname-disagreement]
 *
 *     npx tsx tools/migration/correct_afl_api_identity.ts --dry-run       (same arguments)
 *
 *     npx tsx tools/migration/correct_afl_api_identity.ts --apply         (same arguments)
 *       --expect-fingerprint <sha256>
 *
 * Implements runbook (`issues/open/AFLDB-ISSUE-238.md`) §8.2 (the ORIGINAL transaction), §8.7
 * (the batch contract) and §8.8 (the role model) for §12 Slice 5 only:
 *
 *   - the CLI and its three modes;
 *   - the surname acknowledgement (§10 M1);
 *   - the row locks, conditional writes and `rowProofs` (§5.6 L5, §8.2 pass 5/5a);
 *   - the targeted recompute (§4.D) with the `stat_availability` byte-identical assertion;
 *   - the §8.4 post-write CORRECTION SATISFACTION re-plan;
 *   - the §8.5 ALREADY_SATISFIED re-run.
 *
 * OUT OF SCOPE for this slice (later slices, per §12): REPLAY (promotion/rebuild), the v3
 * artefact, PSG/CRV/D15-v3, and the `code_test_db` rehearsal. This file never runs the promotion
 * or rebuild lifecycle.
 *
 * The planner (`src/lib/acquisition/afl-api-identity-correction.ts`) is pure: every decision in
 * this file is made by calling its exported evaluators with evidence read here. This file is the
 * "future adapter" that module's own header names.
 *
 * EVIDENCE NOTES (disclosed, not hidden):
 *   - §5.10: SV-0, SV-1 (with the `brownlow_season_authority.published_revision` binding) and
 *     SV-2a (schema-1 manifest, both CSV hashes, row-for-row CSV parity resolved through
 *     `ProfileResolver`'s exact predicate) are implemented; everything else is the SV-3 STOP.
 *     SV-2b is not reachable (no schema-2 loader exists), so a schema-2 claim is SV-3.
 *   - §5.11 DP-4 applies the loader's `club_season_participation` rule exactly
 *     (`after_siren.py:829-845`: a `player_match_stats` row in a match of the dependent's season
 *     whose club shares the dependent club's `organization_id`), evaluated over P's rows with
 *     every MOVE/DELETE closure row removed. It is not narrowed by `search_name`, which only
 *     selects which player the loader considered, never whether P kept participation.
 *   - §5.3 B3-I/B3-C read the cited `brownlow_match_votes` source version, whose stored payload
 *     is the per-match `AflApiBrownlowMatchVoteRecord` (`afl-api-brownlow.ts:1466-1473`,
 *     `persistSourceObservation`), NOT the raw `brownlowSeason` envelope. A missing, malformed or
 *     contradictory payload is "unproven", never "CD_I absent".
 *   - §8.5/§8.4 CORRECTION SATISFACTION (Q2) is one evaluator (`evaluateCorrectionSatisfactionQ2`)
 *     over evidence one read-only reader gathers; the post-write re-plan and every re-run on a
 *     `CORRECTED` provider call the same function.
 *   - §5.4 C11: every row at P is read and classified by its CURRENT owner
 *     (`classifyClosureOwnership`): `afl_api`-owned rows are claimed and proven in full; other
 *     rows are foreign NOOPs unless they carry `CD_I`'s own lineage stamps, which is a STOP.
 *   - §5.9 BG2 excludes exactly the round rows proven (C11 + B1-B5) to be closure rows of this
 *     correction, and binds an unresolved round row to an event by (S(M), R(M)), never by season
 *     alone (`foreignBrownlowRowsAtEvent`). BG3 and C1c of a match-less round row cover every
 *     match of its (S, R).
 *   - §5.3 B4 is gathered (typed projection, live identities, the key's own history), never
 *     assumed; Q2 re-runs its immutable-history half only.
 *   - §5.12 SAT-1 evaluates the shared ISSUE-235/237 invariant (`checkAflApiIdentityInvariant`)
 *     plus §8.6's "at its player_identity" for P′; SAT-5 checks every typed projection row of
 *     `CD_I`, and the ORIGINAL write therefore moves every `CD_I` projection row still naming P.
 *   - No SQL read inside the transaction has a fallback: every failure propagates and rolls back.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres, { type TransactionSql } from 'postgres';

import {
  AFL_API_ADMIN_MATCH_METHOD,
  AFL_API_PLAYER_REFERENCE_MANIFEST,
  aflApiNetIsHumanLive,
  checkAflApiIdentityInvariant,
  netLedgerRowsByExternalId,
  validateManifestAgainstCatalogue,
  type AflApiAdjudicationLedgerRow,
  type AflApiCensusRow,
  type AflApiForwardIdentityResult,
} from '../../src/lib/acquisition/afl-api-adjudication';
import { normaliseSurname } from '../../src/lib/acquisition/afl-api-player-evidence';
import { canonicalJson, type JsonValue } from '../../src/lib/acquisition/observations';
import { CsvError, parseCsv } from '../../src/lib/ingest/csv';
import {
  recomputeBrownlowCoverage,
  recomputePlayerDerivedStats,
} from '../../src/db/queries/player-derived';
import {
  BROWNLOW_ROUND_VOTES_CONTRACT_FIELDS,
  PLANNER_VERSION,
  PLAYER_MATCH_STATS_CONTRACT_FIELDS,
  classifyBrownlowChain,
  compareReconstruction,
  compareSubstantiveBrownlow,
  compareSubstantivePlayerMatchStats,
  decideBrownlowDisposition,
  decidePlayerMatchStatsDisposition,
  detectPostCorrectionReappearance,
  evaluateBrownlowAttribution,
  evaluateBrownlowGuards,
  evaluateBrownlowMutationEligibility,
  evaluateBrownlowParticipation,
  evaluateCorrectionSatisfaction,
  evaluateCorrectionTargetAbsent,
  evaluateDeleteLineage,
  evaluateDependents,
  evaluateL8,
  evaluateMoveLineage,
  evaluatePlayerMatchStatsAttribution,
  evaluatePlayerMatchStatsMutationEligibility,
  evaluateSeasonTotalIndependence,
  evaluateWholePlanStops,
  isBatchBoundToAdjudication,
  mutationPlanFingerprint,
  reconstructContract,
  rowContractHash,
  type Application,
  type AttributionResult,
  type AuthorityBlock,
  type BrownlowChainApplication,
  type BrownlowGuardEvidence,
  type BrownlowRowEvidence,
  type CanonicalTable,
  type ClosureRowFingerprintInput,
  type DeleteLineageEvidence,
  type FieldDivergence,
  type L8Evidence,
  type MoveLineageEvidence,
  type MoveLineageResult,
  type MutationPlan,
  type PlayerMatchStatsRowEvidence,
  type PostCorrectionExplanation,
  type SatisfactionEvidence,
  type SeasonIndependenceEvidence,
  type Stop,
  type StopCode,
} from '../../src/lib/acquisition/afl-api-identity-correction';
import {
  readAflApiCensusRows,
  readAflApiForwardIdentities,
  readLedgerRows,
  resolveAflApiPlayerIdentity,
} from './replay_afl_api_adjudications';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

export const TOOL = 'correct_afl_api_identity';
export const AFL_API_SOURCE_KEY = 'afl_api';

/** Every refusal below any connection, and every in-transaction STOP that must not be swallowed. */
export class CorrectionRefused extends Error {}

/* ==================================================================== *
 * CLI arguments (D9)
 * ==================================================================== */

export type CorrectionMode = 'validate-only' | 'dry-run' | 'apply';

export type CorrectionArgs = {
  readonly mode: CorrectionMode;
  readonly providerId: string;
  readonly toPlayerId: number;
  readonly adminUserId: number;
  readonly note: string;
  readonly evidenceFile: string;
  readonly expectDatabase: string;
  readonly expectFingerprint: string | null;
  readonly acknowledgeSurnameDisagreement: boolean;
};

function requireValue(argv: readonly string[], i: number, flag: string): string {
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) throw new CorrectionRefused(`${flag} needs a value.`);
  return value;
}

export function parseCorrectAflApiIdentityArgs(argv: readonly string[]): CorrectionArgs {
  const modes: CorrectionMode[] = [];
  let providerId: string | null = null;
  let toPlayerId: number | null = null;
  let adminUserId: number | null = null;
  let note: string | null = null;
  let evidenceFile: string | null = null;
  let expectDatabase: string | null = null;
  let expectFingerprint: string | null = null;
  let acknowledgeSurnameDisagreement = false;

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    switch (flag) {
      case '--validate-only': modes.push('validate-only'); break;
      case '--dry-run': modes.push('dry-run'); break;
      case '--apply': modes.push('apply'); break;
      case '--acknowledge-surname-disagreement': acknowledgeSurnameDisagreement = true; break;
      case '--provider-id': providerId = requireValue(argv, i, flag); i += 1; break;
      case '--note': note = requireValue(argv, i, flag); i += 1; break;
      case '--evidence-file': evidenceFile = requireValue(argv, i, flag); i += 1; break;
      case '--expect-database': expectDatabase = requireValue(argv, i, flag); i += 1; break;
      case '--expect-fingerprint': expectFingerprint = requireValue(argv, i, flag); i += 1; break;
      case '--to-player-id': {
        const raw = requireValue(argv, i, flag);
        const parsed = Number(raw);
        if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new CorrectionRefused('--to-player-id must be a positive integer.');
        toPlayerId = parsed;
        i += 1;
        break;
      }
      case '--admin-user-id': {
        const raw = requireValue(argv, i, flag);
        const parsed = Number(raw);
        if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new CorrectionRefused('--admin-user-id must be a positive integer.');
        adminUserId = parsed;
        i += 1;
        break;
      }
      default:
        throw new CorrectionRefused(`Unknown argument '${flag}'.`);
    }
  }

  if (modes.length !== 1) throw new CorrectionRefused('Exactly one of --validate-only, --dry-run or --apply is required.');
  const mode = modes[0];
  if (providerId === null || providerId.trim() === '') throw new CorrectionRefused('--provider-id is mandatory.');
  if (toPlayerId === null) throw new CorrectionRefused('--to-player-id is mandatory.');
  if (adminUserId === null) throw new CorrectionRefused('--admin-user-id is mandatory.');
  if (note === null || note.length < 20 || note.length > 2000) {
    throw new CorrectionRefused('--note is mandatory and must be between 20 and 2000 characters.');
  }
  if (evidenceFile === null) throw new CorrectionRefused('--evidence-file is mandatory: it is supporting audit evidence only (O-6), never a database-evidence substitute.');
  if (expectDatabase === null) throw new CorrectionRefused('--expect-database is mandatory.');
  if (mode === 'apply' && expectFingerprint === null) {
    throw new CorrectionRefused('--expect-fingerprint is mandatory with --apply.');
  }
  if (mode !== 'apply' && expectFingerprint !== null) {
    throw new CorrectionRefused('--expect-fingerprint is only accepted with --apply.');
  }

  return {
    mode, providerId, toPlayerId, adminUserId, note, evidenceFile, expectDatabase,
    expectFingerprint, acknowledgeSurnameDisagreement,
  };
}

/* ==================================================================== *
 * Environment / DSN / session (mirrors import_afl_api_player_bridge.ts)
 * ==================================================================== */

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

export function resolveImportDsn(env: Record<string, string | undefined>, expectDatabase: string): string {
  const raw = env.AFLDB_IMPORT_DATABASE_URL;
  if (!raw || raw.trim() === '') throw new CorrectionRefused('AFLDB_IMPORT_DATABASE_URL is not set -- refusing');
  const dsn = raw.trim();
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new CorrectionRefused('AFLDB_IMPORT_DATABASE_URL is not a valid postgresql:// DSN');
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new CorrectionRefused('AFLDB_IMPORT_DATABASE_URL is not a postgresql:// DSN');
  }
  if (decodeURIComponent(url.pathname.replace(/^\//, '')) !== expectDatabase) {
    throw new CorrectionRefused(`AFLDB_IMPORT_DATABASE_URL does not target /${expectDatabase} -- refusing`);
  }
  return dsn;
}

/** §8.2 step 1's opening assertion. */
async function proveSession(tx: TransactionSql, expectDatabase: string): Promise<void> {
  const [row] = await tx<{ database: string; role: string }[]>`
    SELECT current_database() AS database, current_user AS role
  `;
  if (row?.database !== expectDatabase) {
    throw new CorrectionRefused(`REFUSED: connected database is '${String(row?.database)}', not '${expectDatabase}'`);
  }
  if (row.role !== 'afldb_import') {
    throw new CorrectionRefused(`REFUSED: session role is '${row.role}', not 'afldb_import'`);
  }
}

function jsonbOf(tx: TransactionSql, value: JsonValue): postgres.Parameter<unknown> {
  return tx.json(JSON.parse(canonicalJson(value)) as never);
}

/* ==================================================================== *
 * Evidence-file handling (D9, O-6: supporting audit evidence only)
 * ==================================================================== */

export type LoadedEvidenceFile = { readonly path: string; readonly sha256: string; readonly summary: string };

export function loadEvidenceFile(path: string): LoadedEvidenceFile {
  if (!existsSync(path)) throw new CorrectionRefused(`evidence file not found: ${path}`);
  const bytes = readFileSync(path);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  // Never parsed as a source of database evidence (O-6); only its hash and a length-bounded
  // summary of its own bytes are recorded.
  const text = bytes.toString('utf8');
  const summary = text.length > 500 ? `${text.slice(0, 500)}... (${text.length} bytes total)` : text;
  return { path, sha256, summary };
}

/* ==================================================================== *
 * Identity locks (ISSUE-235 D7 order: provider, then players ascending)
 * ==================================================================== */

function providerLockKey(providerId: string): string {
  return `afl_api_identity:provider:${providerId}`;
}
function playerLockKey(playerId: number): string {
  return `afl_api_identity:player:${playerId}`;
}

async function takeCorrectionLocks(tx: TransactionSql, providerId: string, playerIds: readonly number[]): Promise<void> {
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${providerLockKey(providerId)}, 0))`;
  for (const id of [...new Set(playerIds)].sort((a, b) => a - b)) {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${playerLockKey(id)}, 0))`;
  }
}

/* ==================================================================== *
 * §8.2 step 1: the D10 identity lock and lock_timeout
 * ==================================================================== */

async function takeIdentityTableLock(tx: TransactionSql, lockTimeout: string): Promise<void> {
  await tx`SELECT set_config('lock_timeout', ${lockTimeout}, true)`;
  try {
    await tx`LOCK TABLE external_identities IN ACCESS EXCLUSIVE MODE`;
  } catch (error) {
    const pgError = error as { code?: string };
    if (pgError.code === '55P03') throw new CorrectionRefused('REFUSED: lock_timeout waiting for external_identities (an in-flight settle holds it)');
    throw error;
  }
}

/* ==================================================================== *
 * D10 manifest / live-catalogue check, reused from the ISSUE-235 revoke
 * ==================================================================== */

async function readReferenceCatalogue(tx: TransactionSql): Promise<{
  schema: string; table: string; column: string; hasFk: boolean; fkReferencesPlayers: boolean;
}[]> {
  return tx<{ schema: string; table: string; column: string; hasFk: boolean; fkReferencesPlayers: boolean }[]>`
    SELECT n.nspname AS schema, cl.relname AS table, a.attname AS column,
           EXISTS (
             SELECT 1 FROM pg_constraint con
              WHERE con.conrelid = cl.oid AND con.contype = 'f' AND a.attnum = ANY(con.conkey)
           ) AS "hasFk",
           EXISTS (
             SELECT 1 FROM pg_constraint con
              WHERE con.conrelid = cl.oid AND con.contype = 'f' AND a.attnum = ANY(con.conkey)
                AND con.confrelid = 'players'::regclass
           ) AS "fkReferencesPlayers"
      FROM pg_attribute a
      JOIN pg_class cl ON cl.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = cl.relnamespace
     WHERE a.attname = 'player_id' AND a.attnum > 0 AND NOT a.attisdropped
       AND n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND n.nspname NOT LIKE 'pg_temp_%' AND n.nspname NOT LIKE 'pg_toast_temp_%'
  `;
}

async function assertManifestValidatesAgainstCatalogue(tx: TransactionSql): Promise<void> {
  const catalogue = await readReferenceCatalogue(tx);
  const problems = validateManifestAgainstCatalogue(catalogue, AFL_API_PLAYER_REFERENCE_MANIFEST);
  if (problems.length > 0) {
    throw new CorrectionRefused(`REFUSED: the D10 player-reference manifest no longer validates against the live catalogue: ${problems.join('; ')}`);
  }
}

/* ==================================================================== *
 * Identity / ledger reads
 * ==================================================================== */

export type ExistingIdentityRow = {
  id: number; status: string; playerId: number | null; candidateCount: number; matchMethod: string | null;
};

async function readExternalIdentityRow(tx: TransactionSql, providerId: string): Promise<ExistingIdentityRow | null> {
  const [row] = await tx<ExistingIdentityRow[]>`
    SELECT ei.id, ei.status::text AS status, ei.player_id AS "playerId",
           ei.candidate_count AS "candidateCount", ei.match_method AS "matchMethod"
      FROM external_identities ei
      JOIN sources s ON s.id = ei.source_id
     WHERE s.key = ${AFL_API_SOURCE_KEY} AND ei.external_id = ${providerId}
  `;
  return row ?? null;
}

export type LedgerRow = {
  id: number; action: 'linked' | 'revoked' | 'corrected'; playerId: number; playerIdentity: string;
  supersedesId: number | null; previousPlayerIdentity: string | null; evidenceSha256: string | null;
};

async function readLedgerRowsForProvider(tx: TransactionSql, providerId: string): Promise<readonly LedgerRow[]> {
  return tx<LedgerRow[]>`
    SELECT id::int AS id, action, player_id AS "playerId", player_identity AS "playerIdentity",
           supersedes_id::int AS "supersedesId", previous_player_identity AS "previousPlayerIdentity",
           evidence_sha256 AS "evidenceSha256"
      FROM afl_api_identity_adjudications
     WHERE source_key = ${AFL_API_SOURCE_KEY} AND external_id = ${providerId}
     ORDER BY id
  `;
}

function netLedgerAction(rows: readonly LedgerRow[]): LedgerRow | null {
  if (rows.length === 0) return null;
  return rows[rows.length - 1];
}

async function fetchAflApiSourceId(tx: TransactionSql): Promise<number> {
  const [row] = await tx<{ id: number }[]>`SELECT id FROM sources WHERE key = ${AFL_API_SOURCE_KEY}`;
  if (!row) throw new CorrectionRefused(`unknown source key: '${AFL_API_SOURCE_KEY}'`);
  return row.id;
}

async function readObservedSurname(tx: TransactionSql, providerId: string): Promise<string | null> {
  // Best-effort: an ORIGINAL correction's provider link is typically already resolved (not a
  // pending candidate), so there is usually no `promotion_candidates` row left to read the
  // observed surname from. When one still exists (an importer-origin correction of a provider
  // whose candidate row was never cleaned up) it is read the same way the link path does.
  const [row] = await tx<{ payload: { playerStats?: { player?: { playerName?: { surname?: unknown } } } } }[]>`
    SELECT p.raw_payload AS payload
      FROM promotion_candidates c
      JOIN staging.source_record_versions v
        ON v.source_id = c.source_id AND v.family = c.family
       AND v.external_record_id = c.external_record_id AND v.version_seq = c.source_version_seq
      JOIN staging.source_payloads p
        ON p.source_id = v.source_id AND p.family = v.family AND p.payload_hash = v.payload_hash
     WHERE c.source_id = (SELECT id FROM sources WHERE key = ${AFL_API_SOURCE_KEY})
       AND split_part(c.external_record_id, '|', 3) = ${providerId}
     ORDER BY c.id DESC LIMIT 1
  `;
  const observed = row?.payload.playerStats?.player?.playerName?.surname;
  return typeof observed === 'string' ? observed : null;
}

async function readPlayerSurname(tx: TransactionSql, playerId: number): Promise<string | null> {
  const [row] = await tx<{ surname: string | null }[]>`SELECT surname FROM players WHERE id = ${playerId}`;
  return row?.surname ?? null;
}

/* ==================================================================== *
 * player_match_stats closure-candidate evidence (§5.2 P1-P7)
 * ==================================================================== */

export type CanonicalApplicationRow = {
  id: number; verb: 'insert' | 'update' | 'delete';
  previousValues: Record<string, JsonValue> | null;
  newValues: Record<string, JsonValue>;
  sourceId: string; family: string; externalRecordId: string; sourceVersionSeq: number;
  importBatchId: number; targetKey: Record<string, JsonValue>;
};

async function readApplications(
  tx: TransactionSql, sourceKey: string, targetTable: string, targetKey: Record<string, unknown>,
): Promise<readonly CanonicalApplicationRow[]> {
  const rows = await tx<{
    id: number; verb: 'insert' | 'update' | 'delete';
    previousValues: Record<string, JsonValue> | null; newValues: Record<string, JsonValue>;
    sourceKey: string; family: string; externalRecordId: string; sourceVersionSeq: number;
    importBatchId: number; targetKey: Record<string, JsonValue>;
  }[]>`
    SELECT ca.id::int AS id, ca.verb, ca.previous_values AS "previousValues", ca.new_values AS "newValues",
           s.key AS "sourceKey", ca.family, ca.external_record_id AS "externalRecordId",
           ca.source_version_seq AS "sourceVersionSeq", ca.import_batch_id::int AS "importBatchId",
           ca.target_key AS "targetKey"
      FROM canonical_applications ca
      JOIN sources s ON s.id = ca.source_id
     WHERE ca.target_table = ${targetTable} AND ca.target_key = ${jsonbOf(tx, targetKey as JsonValue)}
     ORDER BY ca.id
  `;
  return rows.map((r) => ({
    id: r.id, verb: r.verb, previousValues: r.previousValues, newValues: r.newValues,
    sourceId: r.sourceKey, family: r.family, externalRecordId: r.externalRecordId,
    sourceVersionSeq: r.sourceVersionSeq, importBatchId: r.importBatchId, targetKey: r.targetKey,
  }));
}

function toApplication(r: CanonicalApplicationRow): Application {
  return {
    id: r.id, verb: r.verb, previousValues: r.previousValues, newValues: r.newValues,
    sourceId: r.sourceId, externalRecordId: r.externalRecordId, sourceVersionSeq: r.sourceVersionSeq,
    importBatchId: r.importBatchId,
  };
}

/** A `player_match_stats` row at the player, plus its evidence. EVERY row at the player is read,
 * including one with no application history: C11 (§5.4) classifies it, never the reader. */
export type PlayerMatchStatsCandidate = {
  readonly id: number;
  readonly matchId: number;
  readonly season: number;
  /** `matches.round_number` of M: R(M) in the BG2 event mapping (`admin-brownlow.ts:798-808`). */
  readonly roundNumber: number | null;
  readonly current: Record<string, JsonValue>;
  readonly applications: readonly CanonicalApplicationRow[];
  readonly projectionPlayerId: number | null;
};

async function readPlayerMatchStatsCandidatesForPlayer(
  tx: TransactionSql, providerId: string, playerId: number, lockRows: boolean,
): Promise<readonly PlayerMatchStatsCandidate[]> {
  type Raw = { id: number; matchId: number; season: number; roundNumber: number | null; row: Record<string, JsonValue> };
  const rows = lockRows
    ? await tx<Raw[]>`
        SELECT pms.id::int AS id, pms.match_id AS "matchId", m.season::int AS season,
               m.round_number::int AS "roundNumber", to_jsonb(pms.*) AS row
          FROM player_match_stats pms
          JOIN matches m ON m.id = pms.match_id
         WHERE pms.player_id = ${playerId}
           FOR UPDATE OF pms, m
      `
    : await tx<Raw[]>`
        SELECT pms.id::int AS id, pms.match_id AS "matchId", m.season::int AS season,
               m.round_number::int AS "roundNumber", to_jsonb(pms.*) AS row
          FROM player_match_stats pms
          JOIN matches m ON m.id = pms.match_id
         WHERE pms.player_id = ${playerId}
      `;
  const out: PlayerMatchStatsCandidate[] = [];
  for (const row of rows) {
    const applications = await readApplications(tx, AFL_API_SOURCE_KEY, 'player_match_stats', {
      player_id: playerId, match_id: row.matchId,
    });
    // P5's typed projection is keyed by (CD_M, CD_I); CD_M is the first component of the P2 stamp
    // this row's latest application already carries (`<CD_M>|<team>|CD_I`). A row with no
    // application history has no CD_M to key it by; it is still returned, for C11 to classify.
    const latest = applications.length > 0 ? applications[applications.length - 1] : null;
    const [projection] = latest === null ? [] : await tx<{ playerId: number }[]>`
      SELECT player_id AS "playerId" FROM staging.afl_api_player_match
       WHERE source_id = (SELECT id FROM sources WHERE key = ${AFL_API_SOURCE_KEY})
         AND provider_player_id = ${providerId}
         AND provider_match_id = ${latest.externalRecordId.split('|')[0] ?? ''}
    `;
    out.push({
      id: row.id, matchId: row.matchId, season: row.season, roundNumber: row.roundNumber, current: row.row,
      applications, projectionPlayerId: projection?.playerId ?? null,
    });
  }
  return out;
}

/**
 * The exact P2 stamp: `<CD_M>|<team>|CD_I`. At the point this is called the provider is not yet
 * (or no longer, per the caller's net-state check) `CORRECTED`, so every application in the
 * history is a genuine settle-authored one and "latest" is simply the last one read.
 */
function latestNonCorrectionApplication(applications: readonly CanonicalApplicationRow[]): CanonicalApplicationRow | null {
  return applications.length > 0 ? applications[applications.length - 1] : null;
}

/** The P2 stamp `<CD_M>|<team>|<CD_I>` for `CD_I`, built from the match/team components of an
 * application's `external_record_id`. Never the application's own id verbatim: that would make P2
 * compare a row with the very evidence it must be checked against, and accept `…|CD_J`. */
export function expectedPlayerMatchStatsStamp(externalRecordId: string, providerId: string): string {
  const parts = externalRecordId.split('|');
  return parts.length === 3 ? `${parts[0]}|${parts[1]}|${providerId}` : `<unparseable:${externalRecordId}>`;
}

/** P3's second half, which the planner's evidence cannot carry: EVERY application at the key has an
 * `external_record_id` ending `|CD_I` (§5.2 P3). */
export function playerMatchStatsHistoryThroughProvider(
  applications: readonly { readonly externalRecordId: string }[], providerId: string,
): boolean {
  return applications.every((a) => a.externalRecordId.endsWith(`|${providerId}`));
}

/** A row's owner as the planner's P1/B1 compare it: `to_jsonb(row).source_id` is the numeric
 * `sources.id`, never the key, so it is mapped to `'afl_api'` only when it IS the afl_api id. */
export function ownerKeyForPlanner(sourceId: JsonValue | undefined, aflApiSourceId: number): string {
  return typeof sourceId === 'number' && sourceId === aflApiSourceId ? AFL_API_SOURCE_KEY : `source#${String(sourceId ?? null)}`;
}

export function buildPlayerMatchStatsEvidence(
  candidate: PlayerMatchStatsCandidate, providerId: string, aflApiSourceId: number,
): PlayerMatchStatsRowEvidence {
  const latest = latestNonCorrectionApplication(candidate.applications);
  const expectedSourceRecordId = latest ? expectedPlayerMatchStatsStamp(latest.externalRecordId, providerId) : '';
  const expectedImportBatchId = latest?.importBatchId ?? -1;
  return {
    sourceId: ownerKeyForPlanner(candidate.current.source_id, aflApiSourceId),
    sourceRecordId: String(candidate.current.source_record_id ?? ''),
    importBatchId: Number(candidate.current.import_batch_id ?? -1),
    applications: candidate.applications.map(toApplication),
    projectionPlayerId: candidate.projectionPlayerId,
    currentPlayerId: Number(candidate.current.player_id),
    current: candidate.current,
    expectedSourceRecordId,
    expectedImportBatchId,
  };
}

/* ==================================================================== *
 * brownlow_round_votes closure-candidate evidence (§5.3 B1-B5)
 * ==================================================================== */

export type BrownlowCandidate = {
  readonly id: number;
  readonly season: number;
  readonly roundNumber: number;
  readonly matchId: number | null;
  /** S(M) and R(M) of `match_id` when it is set (the BG2 event of a resolved row); null otherwise. */
  readonly matchSeason: number | null;
  readonly matchRoundNumber: number | null;
  readonly current: { played: JsonValue; votes: JsonValue; matchId: JsonValue };
  readonly currentRow: Record<string, JsonValue>;
  readonly applications: readonly CanonicalApplicationRow[];
  readonly projectionPlayerId: number | null;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The voter entries of one cited `brownlow_match_votes` source version (§5.3 B3-I/B3-C).
 *
 * The stored payload is exactly the per-match `AflApiBrownlowMatchVoteRecord` the settle persists
 * (`afl-api-brownlow.ts:1466-1473`): `{providerMatchId, apiRoundNumber, votes: [{providerPlayerId,
 * providerTeamId, votes, eligible}]}`. It is never the raw `brownlowSeason` API envelope. Returns
 * `null` -- UNPROVEN, never "no entry for CD_I" -- for anything else: a non-object, a record for a
 * different provider match than the application cites, a missing `votes` array, or ANY entry with
 * a missing/wrongly typed `providerPlayerId` or a non-integer `votes`. One malformed entry poisons
 * the whole payload, because a partial read could turn "CD_I present" into "CD_I absent", which is
 * exactly what B3-C case 2 (a demotion) accepts.
 */
export function extractBrownlowVoterEntries(
  payload: unknown, providerMatchId: string,
): { playerId: string; votes: number }[] | null {
  if (!isPlainObject(payload)) return null;
  if (payload.providerMatchId !== providerMatchId) return null;
  if (!Array.isArray(payload.votes)) return null;
  const out: { playerId: string; votes: number }[] = [];
  for (const entry of payload.votes) {
    if (!isPlainObject(entry)) return null;
    const { providerPlayerId, votes } = entry;
    if (typeof providerPlayerId !== 'string' || providerPlayerId === '') return null;
    if (typeof votes !== 'number' || !Number.isInteger(votes)) return null;
    out.push({ playerId: providerPlayerId, votes });
  }
  return out;
}

/** `count` = CD_I's voter entries in the cited payload; `-1` = the payload is missing or
 * unparseable. `-1` fits no B3-C case and never proves B3-I, so it always fails closed. */
export type CitedPayloadVoterProof = { readonly count: number; readonly vote: number | null };

export function citedPayloadVoterProof(
  payload: unknown | null, providerMatchId: string, providerId: string,
): CitedPayloadVoterProof {
  if (payload === null) return { count: -1, vote: null };
  const entries = extractBrownlowVoterEntries(payload, providerMatchId);
  if (entries === null) return { count: -1, vote: null };
  const forProvider = entries.filter((e) => e.playerId === providerId);
  return { count: forProvider.length, vote: forProvider.length === 1 ? forProvider[0].votes : null };
}

/** B3-I (§5.3): the insert's cited payload names CD_I exactly once, with the inserted vote. */
export function brownlowInsertProvenByPayload(
  proof: CitedPayloadVoterProof, insertNewValues: Readonly<Record<string, JsonValue>>,
): boolean {
  return proof.count === 1 && (!('votes' in insertNewValues) || proof.vote === insertNewValues.votes);
}

async function readCitedPayload(tx: TransactionSql, app: CanonicalApplicationRow): Promise<unknown | null> {
  const [row] = await tx<{ payload: unknown }[]>`
    SELECT p.raw_payload AS payload
      FROM staging.source_record_versions v
      JOIN staging.source_payloads p
        ON p.source_id = v.source_id AND p.family = v.family AND p.payload_hash = v.payload_hash
     WHERE v.source_id = (SELECT id FROM sources WHERE key = ${app.sourceId})
       AND v.family = ${app.family} AND v.external_record_id = ${app.externalRecordId}
       AND v.version_seq = ${app.sourceVersionSeq}
  `;
  return row?.payload ?? null;
}

async function voterCountAndVoteForCdI(
  tx: TransactionSql, app: CanonicalApplicationRow, providerId: string,
): Promise<CitedPayloadVoterProof> {
  // A Brownlow application cites `CD_M`'s `brownlow_match_votes` record: its external_record_id
  // IS the provider match id the stored payload must name.
  return citedPayloadVoterProof(await readCitedPayload(tx, app), app.externalRecordId, providerId);
}

async function readBrownlowCandidatesForPlayer(
  tx: TransactionSql, providerId: string, playerId: number, lockRows: boolean,
): Promise<readonly BrownlowCandidate[]> {
  type Raw = {
    id: number; season: number; roundNumber: number; matchId: number | null;
    matchSeason: number | null; matchRoundNumber: number | null;
    played: JsonValue; votes: JsonValue; row: Record<string, JsonValue>;
  };
  const rows = lockRows
    ? await tx<Raw[]>`
        SELECT b.id::int AS id, b.season::int AS season, b.round_number::int AS "roundNumber",
               b.match_id AS "matchId", m.season::int AS "matchSeason", m.round_number::int AS "matchRoundNumber",
               b.played, b.votes, to_jsonb(b.*) AS row
          FROM brownlow_round_votes b
          LEFT JOIN matches m ON m.id = b.match_id
         WHERE b.player_id = ${playerId}
           FOR UPDATE OF b
      `
    : await tx<Raw[]>`
        SELECT b.id::int AS id, b.season::int AS season, b.round_number::int AS "roundNumber",
               b.match_id AS "matchId", m.season::int AS "matchSeason", m.round_number::int AS "matchRoundNumber",
               b.played, b.votes, to_jsonb(b.*) AS row
          FROM brownlow_round_votes b
          LEFT JOIN matches m ON m.id = b.match_id
         WHERE b.player_id = ${playerId}
      `;
  if (lockRows) {
    const matchIds = [...new Set(rows.map((r) => r.matchId).filter((id): id is number => id !== null))];
    if (matchIds.length > 0) await tx`SELECT 1 FROM matches WHERE id = ANY(${matchIds}) FOR UPDATE`;
  }
  const out: BrownlowCandidate[] = [];
  for (const row of rows) {
    const applications = await readApplications(tx, AFL_API_SOURCE_KEY, 'brownlow_round_votes', {
      season: row.season, player_id: playerId, round_number: row.roundNumber,
    });
    // Every round row of the player is returned, application history or not: C11 classifies it,
    // and every one of them is a BG2 candidate (§5.9) unless it is itself a proven closure row.
    const insertApp = applications.length > 0 ? applications[0] : null;
    const [projection] = insertApp === null ? [] : await tx<{ playerId: number }[]>`
      SELECT player_id AS "playerId" FROM staging.afl_api_brownlow_vote
       WHERE source_id = (SELECT id FROM sources WHERE key = ${AFL_API_SOURCE_KEY})
         AND provider_player_id = ${providerId} AND provider_match_id = ${insertApp.externalRecordId}
    `;
    out.push({
      id: row.id, season: row.season, roundNumber: row.roundNumber, matchId: row.matchId,
      matchSeason: row.matchSeason, matchRoundNumber: row.matchRoundNumber,
      current: { played: row.played, votes: row.votes, matchId: row.matchId },
      currentRow: row.row, applications, projectionPlayerId: projection?.playerId ?? null,
    });
  }
  return out;
}

/**
 * §5.3 B4, evidence half 1 (immutable history): an application at this key wrote a POSITIVE
 * `votes` value that is not `CD_I`'s own entry in the payload it cites. Positive per-match votes
 * are 3/2/1 to distinct voters, and every AFL API Brownlow proposal writes the vote of the voter
 * it resolved to this player (`afl-api-brownlow.ts:1021-1025`), so that write came from another
 * voter of the same vote set resolving to this player. A `0` (demotion/release) proves nothing
 * either way; an unparseable payload (`count < 0`) is B3-I/B3-C's fail-closed STOP, not B4's.
 */
export function brownlowHistoryShowsAnotherVoter(
  history: readonly { readonly newValues: Readonly<Record<string, JsonValue>>; readonly voterProof: CitedPayloadVoterProof | null }[],
): boolean {
  return history.some((app) => {
    const written = app.newValues.votes;
    if (typeof written !== 'number' || written <= 0) return false;
    const proof = app.voterProof;
    if (proof === null || proof.count < 0) return false;
    return proof.count === 0 || (proof.count === 1 && proof.vote !== written);
  });
}

/**
 * §5.3 B4 in full for MUTATION ELIGIBILITY: "no other provider in the insert application's cited
 * vote set also resolved to P". It is NOT structurally impossible: `uq_external_identities_afl_api_player`
 * (migration 104) holds one `afl_api` identity per player only at an instant, and the applier's
 * `duplicate_player_canonical_identity` refusal (`afl-api-brownlow.ts:724-727`) only sees one
 * settle's resolution. Neither binds the history at the key, nor a typed projection written by an
 * earlier settle. So all three halves are gathered from the database:
 *   - the typed projection `staging.afl_api_brownlow_vote` (the exploded vote set of `CD_M`) holds
 *     a row for another provider naming P;
 *   - another voter in the insert's cited payload currently holds a live `afl_api` identity at P;
 *   - the key's own history shows another voter's positive vote (`brownlowHistoryShowsAnotherVoter`).
 */
export function brownlowAnotherProviderResolvedToPlayer(input: {
  readonly otherProviderProjectionsNamingPlayer: number;
  readonly otherVoterIdentitiesAtPlayer: number;
  readonly historyShowsAnotherVoter: boolean;
}): boolean {
  return input.otherProviderProjectionsNamingPlayer > 0
    || input.otherVoterIdentitiesAtPlayer > 0
    || input.historyShowsAnotherVoter;
}

async function buildBrownlowEvidence(
  tx: TransactionSql, candidate: BrownlowCandidate, providerId: string, playerId: number, aflApiSourceId: number,
): Promise<BrownlowRowEvidence> {
  const insertApp = candidate.applications[0];
  const chainApps = candidate.applications.slice(1);
  const insertPayload = await readCitedPayload(tx, insertApp);
  const insertProof = citedPayloadVoterProof(insertPayload, insertApp.externalRecordId, providerId);
  const insertProvenByPayload = brownlowInsertProvenByPayload(insertProof, insertApp.newValues);

  const chain: BrownlowChainApplication[] = [];
  const history: { newValues: Record<string, JsonValue>; voterProof: CitedPayloadVoterProof }[] = [
    { newValues: insertApp.newValues, voterProof: insertProof },
  ];
  for (const app of chainApps) {
    const proof = await voterCountAndVoteForCdI(tx, app, providerId);
    chain.push({
      ...toApplication(app),
      citedPayloadVoterCountForCdI: proof.count,
      citedPayloadVoteForCdI: proof.vote,
    });
    history.push({ newValues: app.newValues, voterProof: proof });
  }

  const [projectionForCurrent] = await tx<{ playerId: number }[]>`
    SELECT player_id AS "playerId" FROM staging.afl_api_brownlow_vote
     WHERE source_id = (SELECT id FROM sources WHERE key = ${AFL_API_SOURCE_KEY})
       AND provider_player_id = ${providerId} AND provider_match_id = ${insertApp.externalRecordId}
  `;

  // B4 (§5.3): gathered, never assumed. See `brownlowAnotherProviderResolvedToPlayer`.
  const [{ n: otherProviderProjectionsNamingPlayer }] = await tx<{ n: number }[]>`
    SELECT count(*)::int AS n FROM staging.afl_api_brownlow_vote
     WHERE source_id = (SELECT id FROM sources WHERE key = ${AFL_API_SOURCE_KEY})
       AND provider_match_id = ${insertApp.externalRecordId}
       AND player_id = ${playerId} AND provider_player_id <> ${providerId}
  `;
  const otherVoterIds = (extractBrownlowVoterEntries(insertPayload, insertApp.externalRecordId) ?? [])
    .map((e) => e.playerId).filter((id) => id !== providerId);
  const otherVoterIdentitiesAtPlayer = otherVoterIds.length === 0 ? 0 : (await tx<{ n: number }[]>`
    SELECT count(*)::int AS n
      FROM external_identities ei JOIN sources s ON s.id = ei.source_id
     WHERE s.key = ${AFL_API_SOURCE_KEY} AND ei.external_id = ANY(${tx.array(otherVoterIds)}::text[])
       AND ei.player_id = ${playerId} AND ei.status IN ('unique', 'resolved')
  `)[0].n;

  return {
    sourceId: ownerKeyForPlanner(candidate.currentRow.source_id, aflApiSourceId),
    sourceRecordId: String(candidate.currentRow.source_record_id ?? ''),
    expectedSourceRecordId: insertApp.externalRecordId,
    importBatchId: Number(candidate.currentRow.import_batch_id ?? -1),
    expectedImportBatchId: (chainApps.length > 0 ? chainApps[chainApps.length - 1] : insertApp).importBatchId,
    insertApplication: toApplication(insertApp),
    insertProvenByPayload,
    projectionPlayerId: projectionForCurrent?.playerId ?? candidate.projectionPlayerId,
    currentPlayerId: playerId,
    chain,
    anotherProviderAlsoResolved: brownlowAnotherProviderResolvedToPlayer({
      otherProviderProjectionsNamingPlayer,
      otherVoterIdentitiesAtPlayer,
      historyShowsAnotherVoter: brownlowHistoryShowsAnotherVoter(history),
    }),
    current: candidate.current,
  };
}

/* ==================================================================== *
 * BG1-BG3, C1c, dependents (§5.9, §5.4 C1c, §5.11)
 * ==================================================================== */

/** One `brownlow_round_votes` row of P, as BG2 (§5.9) compares it with a closure row's event. */
export type BrownlowEventRow = {
  readonly id: number;
  readonly season: number;
  readonly roundNumber: number;
  readonly matchId: number | null;
};

/**
 * The Brownlow event of a closure row (§5.9 BG2):
 *   - `match`: a `player_match_stats` closure row at (P, M), or a Brownlow closure row whose
 *     `match_id` is M. `season`/`roundNumber` are S(M) and R(M) = `matches.season` and
 *     `matches.round_number`, the exact mapping the admin resolve step uses
 *     (`admin-brownlow.ts:798-808`);
 *   - `round`: a Brownlow closure row whose `match_id` is NULL: its (S, R), with every match of
 *     (S, R) (`matchIds`).
 */
export type BrownlowEvent =
  | { readonly kind: 'match'; readonly matchId: number; readonly season: number; readonly roundNumber: number | null }
  | { readonly kind: 'round'; readonly season: number; readonly roundNumber: number; readonly matchIds: readonly number[] };

/**
 * Does round row b refer to the event (§5.9 BG2)? "Either by `b.match_id = M`, or by
 * `b.match_id IS NULL` with `b.season = S(M)` and `b.round_number = R(M)`". Season equality alone
 * never makes an unresolved row part of an event: it must be the event's own round. When
 * R(M) is NULL (a final: `matches_round_number_ck`) the admin resolve step's
 * `brv.round_number = NULL` predicate matches nothing, so no unresolved row can refer to M.
 */
export function brownlowRowRefersToEvent(row: BrownlowEventRow, event: BrownlowEvent): boolean {
  if (event.kind === 'match') {
    if (row.matchId !== null) return row.matchId === event.matchId;
    return event.roundNumber !== null && row.season === event.season && row.roundNumber === event.roundNumber;
  }
  if (row.matchId !== null) return event.matchIds.includes(row.matchId);
  return row.season === event.season && row.roundNumber === event.roundNumber;
}

/**
 * BG2 (§5.9): every round row of P that refers to the event and is NOT itself a proven closure
 * row of this correction. "Proven" is exactly: C11-claimed (`afl_api`-owned) and B1-B5 (B3-I,
 * B3-C and gathered B4 included) passing (`provenClosureRowIds`). Such a row is MOVEd/DELETEd
 * by this plan, or its own guard/collision STOP stops the whole plan, so excluding it never lets
 * a surviving foreign dependency through. Everything else at the event blocks: manual-, AFL
 * Tables- and NULL-owned rows, and `afl_api` rows whose evidence is insufficient or contradicts.
 * Ownership alone never exempts a row.
 */
export function foreignBrownlowRowsAtEvent(input: {
  readonly rows: readonly BrownlowEventRow[];
  readonly provenClosureRowIds: ReadonlySet<number>;
  readonly ownRowId: number | null;
  readonly event: BrownlowEvent;
}): BrownlowEventRow[] {
  return input.rows.filter((row) => row.id !== input.ownRowId
    && !input.provenClosureRowIds.has(row.id)
    && brownlowRowRefersToEvent(row, input.event));
}

/** C11 (§5.4): how the CURRENT row at P relates to `CD_I`'s correction closure. */
export type ClosureOwnership = 'claimed' | 'foreign' | 'indeterminate';

/** BG2's exemption set (§5.9 "b is not itself a proven closure row"): C11-claimed AND B1-B5
 * passing. Anything else -- foreign, indeterminate, or an `afl_api` row whose evidence is
 * insufficient -- stays a BG2 candidate. */
export function provenBrownlowClosureRowIdsOf(
  assessments: readonly { readonly candidate: { readonly id: number }; readonly ownership: ClosureOwnership; readonly verdict: AttributionResult }[],
): Set<number> {
  return new Set(assessments.filter((a) => a.ownership === 'claimed' && a.verdict.ok).map((a) => a.candidate.id));
}

/**
 * C11 (§5.4, §5.2 "A row with P1 false is foreign"): the row's CURRENT owner decides, never its
 * key's application history. A key's history may belong to an earlier row there (a row
 * re-inserted after a deletion, `post_correction_reappearance`'s shape), so historical AFL API
 * applications alone never make the current row correction-owned.
 *   - `afl_api`-owned: `claimed`. Every P/B attribution and eligibility check then applies in
 *     full, and any failure is a STOP, never a NOOP.
 *   - any other owner, or NULL: `foreign` (NOOP, preserved untouched) when the row carries no
 *     `CD_I` lineage of its own;
 *   - `indeterminate` (a STOP) when a non-`afl_api` row nevertheless carries `CD_I`'s own lineage
 *     stamps: its `source_record_id` is a `CD_I` stamp, or its `import_batch_id` is the batch of an
 *     AFL API application at its key. Only the applier writes those columns (§4.I), so the row
 *     cannot be told apart from corrupted `CD_I` lineage; it is never treated as foreign.
 */
export function classifyClosureOwnership(input: {
  readonly ownerIsAflApi: boolean;
  readonly stampNamesCdILineage: boolean;
  readonly batchIsCdILineage: boolean;
}): ClosureOwnership {
  if (input.ownerIsAflApi) return 'claimed';
  return input.stampNamesCdILineage || input.batchIsCdILineage ? 'indeterminate' : 'foreign';
}

export function playerMatchStatsClosureOwnership(
  candidate: Pick<PlayerMatchStatsCandidate, 'current' | 'applications'>, providerId: string, aflApiSourceId: number,
): ClosureOwnership {
  const stamp = candidate.current.source_record_id;
  const batch = toInt(candidate.current.import_batch_id);
  return classifyClosureOwnership({
    ownerIsAflApi: toInt(candidate.current.source_id) === aflApiSourceId,
    stampNamesCdILineage: typeof stamp === 'string' && stamp.endsWith(`|${providerId}`),
    batchIsCdILineage: batch !== null && candidate.applications.some((a) => (
      a.sourceId === AFL_API_SOURCE_KEY && a.externalRecordId.endsWith(`|${providerId}`) && a.importBatchId === batch)),
  });
}

export function brownlowClosureOwnership(
  candidate: Pick<BrownlowCandidate, 'currentRow' | 'applications'>, aflApiSourceId: number,
): ClosureOwnership {
  const stamp = candidate.currentRow.source_record_id;
  const batch = toInt(candidate.currentRow.import_batch_id);
  const aflApiApplications = candidate.applications.filter((a) => a.sourceId === AFL_API_SOURCE_KEY);
  return classifyClosureOwnership({
    ownerIsAflApi: toInt(candidate.currentRow.source_id) === aflApiSourceId,
    stampNamesCdILineage: typeof stamp === 'string' && aflApiApplications.some((a) => a.externalRecordId === stamp),
    batchIsCdILineage: batch !== null && aflApiApplications.some((a) => a.importBatchId === batch),
  });
}

/** BG3 (§5.9). A read failure propagates and rolls the transaction back: it is never "no entry state". */
export async function readEntryStateNamesPlayer(tx: TransactionSql, matchId: number, playerId: number): Promise<boolean> {
  const [row] = await tx<{ n: number }[]>`
    SELECT count(*)::int AS n FROM brownlow_vote_entry_state
     WHERE match_id = ${matchId}
       AND (three_player_id = ${playerId} OR two_player_id = ${playerId} OR one_player_id = ${playerId})
  `;
  return row.n > 0;
}

/** Every match of (S, R): the event, the BG3 match set and the C1c participation set of a
 * match-less Brownlow row (§5.9, §5.4 C1c), locked `FOR UPDATE` in a locking run (§8.2 step 1). */
async function readRoundMatchIds(tx: TransactionSql, season: number, roundNumber: number, lockRows: boolean): Promise<number[]> {
  const rows = lockRows
    ? await tx<{ id: number }[]>`SELECT id FROM matches WHERE season = ${season} AND round_number = ${roundNumber} ORDER BY id FOR UPDATE`
    : await tx<{ id: number }[]>`SELECT id FROM matches WHERE season = ${season} AND round_number = ${roundNumber} ORDER BY id`;
  return rows.map((r) => r.id);
}

/** The subset of `matchIds` in which `playerId` has a `player_match_stats` row today. */
async function readParticipationMatchIds(
  tx: TransactionSql, playerId: number, matchIds: readonly number[],
): Promise<ReadonlySet<number>> {
  if (matchIds.length === 0) return new Set();
  const rows = await tx<{ matchId: number }[]>`
    SELECT DISTINCT match_id AS "matchId" FROM player_match_stats
     WHERE player_id = ${playerId} AND match_id = ANY(${tx.array([...matchIds])}::int[])
  `;
  return new Set(rows.map((r) => r.matchId));
}

/**
 * C1c (§5.4): the event matches in which P′ has participation AFTER the plan -- an existing P′
 * row (the plan never deletes a P′ row), or a `player_match_stats` closure row of this plan at
 * that match. The caller requires exactly one: for a resolved row that is "P′ plays M"; for a
 * match-less row it is "exactly one match of (S, R)", so zero or several is the fail-closed STOP.
 */
export function participationMatchIdsAfterPlan(input: {
  readonly candidateMatchIds: readonly number[];
  readonly pPrimeRowMatchIds: ReadonlySet<number>;
  readonly plannedPlayerMatchStatsMatchIds: ReadonlySet<number>;
}): number[] {
  return [...new Set(input.candidateMatchIds)].filter((id) => (
    input.pPrimeRowMatchIds.has(id) || input.plannedPlayerMatchStatsMatchIds.has(id)));
}

async function readDependentsForRow(
  tx: TransactionSql, playerId: number, matchId: number,
): Promise<{ afterSirenKicksRowForP: boolean; achievementRowForP: boolean; unresolvedRowAtMatch: boolean }> {
  const [[siren], [achievement], [unresolved]] = await Promise.all([
    tx<{ n: number }[]>`SELECT count(*)::int AS n FROM after_siren_kicks WHERE player_id = ${playerId} AND match_id = ${matchId}`,
    tx<{ n: number }[]>`SELECT count(*)::int AS n FROM player_achievements WHERE player_id = ${playerId} AND match_id = ${matchId}`,
    tx<{ n: number }[]>`
      SELECT (
        (SELECT count(*) FROM after_siren_kicks WHERE player_id IS NULL AND match_id = ${matchId})
        + (SELECT count(*) FROM player_achievements WHERE player_id IS NULL AND match_id = ${matchId})
      )::int AS n
    `,
  ]);
  return { afterSirenKicksRowForP: siren.n > 0, achievementRowForP: achievement.n > 0, unresolvedRowAtMatch: unresolved.n > 0 };
}

/** A match-less (`match_id IS NULL`) `after_siren_kicks` / `player_achievements` row (§5.11 DP-4). */
export type MatchLessDependent = {
  readonly table: 'after_siren_kicks' | 'player_achievements';
  readonly id: number;
  readonly playerId: number;
  readonly season: number;
  /** `clubs.organization_id` of the row's `club_id`; null when the row names no club. */
  readonly clubOrganizationId: number | null;
};

/** One of P's current `player_match_stats` rows, as the loader's participation query sees it. */
export type ParticipationRow = {
  readonly pmsRowId: number;
  readonly season: number;
  /** `clubs.organization_id` of `player_match_stats.club_id`; null when the row names no club. */
  readonly clubOrganizationId: number | null;
};

export type MatchLessDependentVerdict = {
  /** P's dependents whose justifying participation the plan removes: each is a DP-4 STOP. */
  readonly losesParticipation: readonly MatchLessDependent[];
  /** P's dependents whose participation survives the plan: reported. */
  readonly participationRemains: readonly MatchLessDependent[];
  /** P′'s dependents: P′ only gains participation, so they are reported (§5.11). */
  readonly pPrimeReported: readonly MatchLessDependent[];
};

/**
 * §5.11 DP-4, the literal rule: STOP if, after the proposed correction, P would no longer have
 * canonical `player_match_stats` participation for the dependent row's club in its season. The
 * participation predicate is the loader's `club_season_participation` query
 * (`after_siren.py:834-843`): a `player_match_stats` row of P in a match of season s whose club
 * has the same `organization_id` as the dependent's club. "After the correction" removes every
 * `player_match_stats` MOVE and DELETE closure row from P's set. A dependent naming no club, or a
 * participation row naming no club, can never justify the resolution: that is stricter than the
 * loader, never looser. Only affected seasons are examined.
 */
export function evaluateMatchLessDependentParticipation(input: {
  readonly pId: number;
  readonly pPrimeId: number;
  readonly affectedSeasons: ReadonlySet<number>;
  readonly dependents: readonly MatchLessDependent[];
  readonly pParticipation: readonly ParticipationRow[];
  readonly removedPlayerMatchStatsRowIds: ReadonlySet<number>;
}): MatchLessDependentVerdict {
  const losesParticipation: MatchLessDependent[] = [];
  const participationRemains: MatchLessDependent[] = [];
  const pPrimeReported: MatchLessDependent[] = [];
  const remaining = input.pParticipation.filter((r) => !input.removedPlayerMatchStatsRowIds.has(r.pmsRowId));
  for (const dependent of input.dependents) {
    if (!input.affectedSeasons.has(dependent.season)) continue;
    if (dependent.playerId === input.pPrimeId) {
      pPrimeReported.push(dependent);
      continue;
    }
    if (dependent.playerId !== input.pId) continue;
    const justified = dependent.clubOrganizationId !== null && remaining.some((r) => (
      r.season === dependent.season
      && r.clubOrganizationId !== null
      && r.clubOrganizationId === dependent.clubOrganizationId
    ));
    (justified ? participationRemains : losesParticipation).push(dependent);
  }
  return { losesParticipation, participationRemains, pPrimeReported };
}

async function readMatchLessDependents(
  tx: TransactionSql, playerIds: readonly number[], seasons: readonly number[],
): Promise<readonly MatchLessDependent[]> {
  if (seasons.length === 0) return [];
  return tx<MatchLessDependent[]>`
    SELECT 'after_siren_kicks' AS "table", d.id, d.player_id AS "playerId", d.season::int AS season,
           c.organization_id AS "clubOrganizationId"
      FROM after_siren_kicks d LEFT JOIN clubs c ON c.id = d.club_id
     WHERE d.match_id IS NULL AND d.player_id = ANY(${tx.array([...playerIds])}::int[])
       AND d.season = ANY(${tx.array([...seasons])}::int[])
    UNION ALL
    SELECT 'player_achievements' AS "table", d.id, d.player_id AS "playerId", d.season::int AS season,
           c.organization_id AS "clubOrganizationId"
      FROM player_achievements d LEFT JOIN clubs c ON c.id = d.club_id
     WHERE d.match_id IS NULL AND d.player_id = ANY(${tx.array([...playerIds])}::int[])
       AND d.season = ANY(${tx.array([...seasons])}::int[])
  `;
}

async function readParticipation(
  tx: TransactionSql, playerId: number, seasons: readonly number[],
): Promise<readonly ParticipationRow[]> {
  if (seasons.length === 0) return [];
  return tx<ParticipationRow[]>`
    SELECT pms.id AS "pmsRowId", m.season::int AS season, c.organization_id AS "clubOrganizationId"
      FROM player_match_stats pms
      JOIN matches m ON m.id = pms.match_id
      LEFT JOIN clubs c ON c.id = pms.club_id
     WHERE pms.player_id = ${playerId} AND m.season = ANY(${tx.array([...seasons])}::int[])
  `;
}

/* ==================================================================== *
 * §5.10 season-total independence (SV-0, SV-1, SV-2a; everything else SV-3)
 * ==================================================================== */

/** One live `brownlow_season_votes` row, with the eleven SV-2a value columns. */
export type SeasonTotalLiveRow = {
  readonly sourceKey: string;
  readonly sourceRecordId: string;
  readonly playerId: number;
  readonly votes: number | null;
  readonly voteRank: number | null;
  readonly eligibleRank: number | null;
  readonly isIneligible: boolean | null;
  readonly isWinner: boolean | null;
  readonly games: number | null;
  readonly threeVoteGames: number | null;
  readonly twoVoteGames: number | null;
  readonly oneVoteGames: number | null;
  readonly pollingGames: number | null;
  readonly linkStatusValue: string | null;
};

export type SeasonTotalsClass = 'empty' | 'admin_published' | 'artefact' | 'unprovable';

/** SV-0/SV-1/SV-2/SV-3 classification of V (§5.10). SV-1 binds the CURRENT published revision:
 * a stale `publish:<s>:r<n>` stamp is SV-3. */
export function classifySeasonTotals(
  season: number, rows: readonly Pick<SeasonTotalLiveRow, 'sourceKey' | 'sourceRecordId'>[],
  publishedRevision: number | null,
): SeasonTotalsClass {
  if (rows.length === 0) return 'empty';
  if (publishedRevision !== null
    && rows.every((r) => r.sourceKey === 'manual_admin_edit' && r.sourceRecordId === `publish:${season}:r${publishedRevision}`)) {
    return 'admin_published';
  }
  if (rows.every((r) => r.sourceKey === 'afltables' && r.sourceRecordId.startsWith(`brownlow-season:${season}:`))) {
    return 'artefact';
  }
  return 'unprovable';
}

/** `import_brownlow_season.py` HEADER (`:100-105`), in order. */
const SEASON_VOTES_HEADER = [
  'season', 'afltables_profile_url', 'votes', 'vote_rank', 'eligible_rank',
  'is_ineligible', 'is_winner', 'games', 'three_vote_games', 'two_vote_games',
  'one_vote_games', 'polling_games', 'link_status_value',
  'bootstrap_player_id', 'display_name', 'legacy_source_record_id',
] as const;
const PROFILE_URL = /^players\/[A-Z]\/[^/]+\.html$/;
const LINK_STATUSES = new Set(['unique', 'resolved', 'ambiguous', 'unmatched', 'implausible']);

class SeasonArtefactUnparseable extends Error {}

/** The loader's `_text`/`_int`/`_bool` rules (`import_brownlow_season.py:183-217`), strict. */
function artefactText(value: string, required: boolean): string | null {
  if (value === '') {
    if (required) throw new SeasonArtefactUnparseable('required value missing');
    return null;
  }
  if (value !== value.trim()) throw new SeasonArtefactUnparseable('leading/trailing whitespace');
  return value;
}
function artefactInt(value: string, required: boolean, min = 0, max = 32767): number | null {
  const text = artefactText(value, required);
  if (text === null) return null;
  if (!/^-?[0-9]+$/.test(text) || (text.length > 1 && text.startsWith('0'))) throw new SeasonArtefactUnparseable(`bad integer ${text}`);
  const n = Number(text);
  if (n < min || n > max) throw new SeasonArtefactUnparseable(`integer ${n} out of range`);
  return n;
}
function artefactBool(value: string): boolean {
  const text = artefactText(value, true);
  if (text === 't') return true;
  if (text === 'f') return false;
  throw new SeasonArtefactUnparseable(`bad boolean ${String(text)}`);
}

type MappedArtefactRow = Omit<SeasonTotalLiveRow, 'sourceKey'>;

export type Sv2aInput = {
  readonly season: number;
  /** Parsed `data/brownlow/season-votes.manifest.json`, or null when missing/unparseable. */
  readonly manifest: unknown;
  /** sha256 and text of `data/brownlow/season-votes.csv`; null when missing. */
  readonly seasonVotesCsvSha256: string | null;
  readonly seasonVotesCsvText: string | null;
  /** sha256 of `data/brownlow/player-identity.csv`; null when missing. */
  readonly identityCsvSha256: string | null;
  readonly liveRows: readonly SeasonTotalLiveRow[];
  /** `ProfileResolver` (`import_brownlow_season.py:639-681`): profile path -> every player id an
   * `afltables`/`afltables_profile_url` `unique`/`resolved` identity maps it to. */
  readonly profileResolution: ReadonlyMap<string, readonly number[]>;
};

/**
 * SV-2a's five executable steps (§5.10), producing the planner's `artefact_schema_1` evidence, or
 * `unprovable` (SV-3) when the manifest is not schema 1. The verdict itself is the planner's
 * `evaluateSeasonTotalIndependence`.
 */
export function evaluateSv2aEvidence(input: Sv2aInput): SeasonIndependenceEvidence {
  const manifest = isPlainObject(input.manifest) ? input.manifest : null;
  if (!manifest || manifest.schema_version !== 1) return { kind: 'unprovable' };
  const artefact: Record<string, unknown> = isPlainObject(manifest.artefact) ? manifest.artefact : {};
  const identity: Record<string, unknown> = isPlainObject(manifest.identity) ? manifest.identity : {};

  // (0) identity.csv_sha256 must exist and equal player-identity.csv's sha256.
  const identityCsvSha256Matches = typeof identity.csv_sha256 === 'string'
    && input.identityCsvSha256 !== null && identity.csv_sha256 === input.identityCsvSha256;
  // (1) artefact.csv_sha256 must equal season-votes.csv's sha256.
  const artefactCsvSha256Matches = typeof artefact.csv_sha256 === 'string'
    && input.seasonVotesCsvSha256 !== null && artefact.csv_sha256 === input.seasonVotesCsvSha256;

  let rowForRowMatch = false;
  let profilePathResolvesToExactlyOnePlayer = false;
  if (input.seasonVotesCsvText !== null) {
    try {
      // (2) select season s, after the loader's whole-file parse (it refuses any bad row anywhere).
      const table = parseCsv(input.seasonVotesCsvText, 1_000_000);
      if (table.header.join(',') !== SEASON_VOTES_HEADER.join(',')) throw new SeasonArtefactUnparseable('header');
      const mapped: MappedArtefactRow[] = [];
      let allResolve = true;
      const seenPlayers = new Set<number>();
      let duplicateTarget = false;
      for (const raw of table.rows) {
        const cell = (name: (typeof SEASON_VOTES_HEADER)[number]) => raw[SEASON_VOTES_HEADER.indexOf(name)];
        const season = artefactInt(cell('season'), true, 1897, 2100)!;
        const url = artefactText(cell('afltables_profile_url'), true)!;
        if (!PROFILE_URL.test(url)) throw new SeasonArtefactUnparseable(`bad profile path ${url}`);
        const values = {
          votes: artefactInt(cell('votes'), true),
          voteRank: artefactInt(cell('vote_rank'), false),
          eligibleRank: artefactInt(cell('eligible_rank'), false),
          isIneligible: artefactBool(cell('is_ineligible')),
          isWinner: artefactBool(cell('is_winner')),
          games: artefactInt(cell('games'), false),
          threeVoteGames: artefactInt(cell('three_vote_games'), false),
          twoVoteGames: artefactInt(cell('two_vote_games'), false),
          oneVoteGames: artefactInt(cell('one_vote_games'), false),
          pollingGames: artefactInt(cell('polling_games'), false),
          linkStatusValue: artefactText(cell('link_status_value'), true),
        };
        if (!LINK_STATUSES.has(values.linkStatusValue!)) throw new SeasonArtefactUnparseable('bad link_status_value');
        if (season !== input.season) continue;
        // (3) map under the loader's contract: exactly one canonical player per profile path.
        const candidates = input.profileResolution.get(url) ?? [];
        const distinct = [...new Set(candidates)];
        if (distinct.length !== 1) {
          allResolve = false;
          continue;
        }
        const playerId = distinct[0];
        if (seenPlayers.has(playerId)) duplicateTarget = true; // the loader rejects two paths -> one player
        seenPlayers.add(playerId);
        mapped.push({ playerId, sourceRecordId: `brownlow-season:${season}:${url}`, ...values });
      }
      profilePathResolvesToExactlyOnePlayer = allResolve;
      // (4) V equals the mapped set row-for-row, every value under IS NOT DISTINCT FROM.
      if (allResolve && !duplicateTarget && mapped.length === input.liveRows.length) {
        const live = new Map<number, SeasonTotalLiveRow>();
        for (const row of input.liveRows) live.set(row.playerId, row);
        rowForRowMatch = live.size === input.liveRows.length && mapped.every((m) => {
          const v = live.get(m.playerId);
          return v !== undefined
            && v.sourceRecordId === m.sourceRecordId
            && v.votes === m.votes && v.voteRank === m.voteRank && v.eligibleRank === m.eligibleRank
            && v.isIneligible === m.isIneligible && v.isWinner === m.isWinner && v.games === m.games
            && v.threeVoteGames === m.threeVoteGames && v.twoVoteGames === m.twoVoteGames
            && v.oneVoteGames === m.oneVoteGames && v.pollingGames === m.pollingGames
            && v.linkStatusValue === m.linkStatusValue;
        });
      }
    } catch (error) {
      if (!(error instanceof SeasonArtefactUnparseable) && !(error instanceof CsvError)) throw error;
      rowForRowMatch = false;
      profilePathResolvesToExactlyOnePlayer = false;
    }
  }

  return {
    kind: 'artefact_schema_1',
    artefactCsvSha256Matches, identityCsvSha256Matches, rowForRowMatch, profilePathResolvesToExactlyOnePlayer,
  };
}

/** The committed SV-2a inputs, read once per process (they are repository files, not DB state). */
type SeasonArtefactFiles = Pick<Sv2aInput, 'manifest' | 'seasonVotesCsvSha256' | 'seasonVotesCsvText' | 'identityCsvSha256'>;
let seasonArtefactFilesCache: SeasonArtefactFiles | null = null;

function readSeasonArtefactFiles(): SeasonArtefactFiles {
  if (seasonArtefactFilesCache) return seasonArtefactFilesCache;
  const dir = join(REPO_ROOT, 'data', 'brownlow');
  const readBytes = (name: string): Buffer | null => {
    try {
      return readFileSync(join(dir, name));
    } catch {
      return null;
    }
  };
  const sha = (bytes: Buffer | null) => (bytes === null ? null : createHash('sha256').update(bytes).digest('hex'));
  const manifestBytes = readBytes('season-votes.manifest.json');
  let manifest: unknown = null;
  try {
    manifest = manifestBytes === null ? null : JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    manifest = null;
  }
  const csv = readBytes('season-votes.csv');
  seasonArtefactFilesCache = {
    manifest,
    seasonVotesCsvSha256: sha(csv),
    seasonVotesCsvText: csv === null ? null : csv.toString('utf8'),
    identityCsvSha256: sha(readBytes('player-identity.csv')),
  };
  return seasonArtefactFilesCache;
}

async function evaluateSeasonForCorrection(
  tx: TransactionSql, season: number, pId: number, pPrimeId: number,
  closureMovesOrDeletesPositiveBrownlowRowInSeason: boolean,
): Promise<{ independent: boolean; stop: Stop | null; seasonClass: SeasonTotalsClass }> {
  const rows = await tx<SeasonTotalLiveRow[]>`
    SELECT s.key AS "sourceKey", bsv.source_record_id AS "sourceRecordId", bsv.player_id AS "playerId",
           bsv.votes::int AS votes, bsv.vote_rank::int AS "voteRank", bsv.eligible_rank::int AS "eligibleRank",
           bsv.is_ineligible AS "isIneligible", bsv.is_winner AS "isWinner", bsv.games::int AS games,
           bsv.three_vote_games::int AS "threeVoteGames", bsv.two_vote_games::int AS "twoVoteGames",
           bsv.one_vote_games::int AS "oneVoteGames", bsv.polling_games::int AS "pollingGames",
           bsv.link_status_value::text AS "linkStatusValue"
      FROM brownlow_season_votes bsv
      JOIN sources s ON s.id = bsv.source_id
     WHERE bsv.season = ${season}
  `;
  const [authority] = await tx<{ publishedRevision: number | null }[]>`
    SELECT published_revision AS "publishedRevision" FROM brownlow_season_authority WHERE season = ${season}
  `;
  const seasonClass = classifySeasonTotals(season, rows, authority?.publishedRevision ?? null);

  let evidence: SeasonIndependenceEvidence;
  switch (seasonClass) {
    case 'empty':
      evidence = { kind: 'empty' };
      break;
    case 'admin_published':
      evidence = {
        kind: 'admin_published',
        closureMovesOrDeletesPositiveBrownlowRowInSeason,
        pOrPPrimeHasRowInSeasonTotals: rows.some((r) => r.playerId === pId || r.playerId === pPrimeId),
      };
      break;
    case 'artefact': {
      const urls = rows.map((r) => r.sourceRecordId.slice(`brownlow-season:${season}:`.length));
      const files = readSeasonArtefactFiles();
      const resolved = await tx<{ url: string; playerId: number }[]>`
        SELECT ei.external_id AS url, ei.player_id AS "playerId"
          FROM external_identities ei
          JOIN sources s ON s.id = ei.source_id
         WHERE s.key = 'afltables' AND ei.match_method = 'afltables_profile_url'
           AND ei.status IN ('unique', 'resolved') AND ei.player_id IS NOT NULL
           AND ei.external_id = ANY(${tx.array(urls)}::text[])
      `;
      // Resolve every path the artefact's season rows name, not just the ones V already holds:
      // a CSV row absent from V must still be mapped to prove it is missing.
      const csvUrls = files.seasonVotesCsvText === null ? [] : artefactSeasonUrls(files.seasonVotesCsvText, season);
      const extra = csvUrls.filter((u) => !urls.includes(u));
      const resolvedExtra = extra.length === 0 ? [] : await tx<{ url: string; playerId: number }[]>`
        SELECT ei.external_id AS url, ei.player_id AS "playerId"
          FROM external_identities ei
          JOIN sources s ON s.id = ei.source_id
         WHERE s.key = 'afltables' AND ei.match_method = 'afltables_profile_url'
           AND ei.status IN ('unique', 'resolved') AND ei.player_id IS NOT NULL
           AND ei.external_id = ANY(${tx.array(extra)}::text[])
      `;
      const profileResolution = new Map<string, number[]>();
      for (const r of [...resolved, ...resolvedExtra]) {
        profileResolution.set(r.url, [...(profileResolution.get(r.url) ?? []), r.playerId]);
      }
      evidence = evaluateSv2aEvidence({ season, ...files, liveRows: rows, profileResolution });
      break;
    }
    default: // 'unprovable': SV-3
      evidence = { kind: 'unprovable' };
      break;
  }
  const verdict = evaluateSeasonTotalIndependence(evidence);
  return verdict.independent
    ? { independent: true, stop: null, seasonClass }
    : { independent: false, stop: verdict.stop, seasonClass };
}

/** The profile paths of season `season`'s artefact rows (a lenient pre-read used only to decide
 * which paths to resolve; `evaluateSv2aEvidence` re-parses the file strictly). */
function artefactSeasonUrls(csvText: string, season: number): string[] {
  try {
    const table = parseCsv(csvText, 1_000_000);
    const seasonIndex = table.header.indexOf('season');
    const urlIndex = table.header.indexOf('afltables_profile_url');
    if (seasonIndex < 0 || urlIndex < 0) return [];
    return table.rows.filter((r) => r[seasonIndex] === String(season)).map((r) => r[urlIndex]);
  } catch {
    return [];
  }
}

/* ==================================================================== *
 * The closure object this adapter builds
 * ==================================================================== */

export type BuiltRow = {
  readonly table: 'player_match_stats' | 'brownlow_round_votes';
  readonly rowId: number;
  readonly naturalKey: Record<string, JsonValue>;
  readonly disposition: 'MOVE' | 'DELETE_AS_FOREIGN_COLLISION';
  readonly contractSha256: string;
  readonly provenance: { sourceKey: string; sourceRecordId: string; importBatchId: number };
  readonly citedApplication: { family: string; externalRecordId: string; sourceVersionSeq: number };
  readonly previousValues: Record<string, JsonValue>;
  readonly currentRow: Record<string, JsonValue>;
};

export type BuiltClosure = {
  readonly plan: MutationPlan;
  readonly rows: readonly BuiltRow[];
  readonly reports: string[];
};

/** One entry of `MutationPlan.stops`. The plan exposes a readonly array; the adapter accumulates
 * into a genuinely mutable one of the same element type. */
type PlanStop = MutationPlan['stops'][number];

async function buildClosure(
  tx: TransactionSql, input: {
    providerId: string; pId: number; pPrimeId: number;
    authority: AuthorityBlock; identityAction: MutationPlan['identityAction'];
    manifestOk: boolean; lockRows: boolean;
  },
): Promise<BuiltClosure> {
  const { providerId, pId, pPrimeId, authority, identityAction, lockRows } = input;
  const stops: PlanStop[] = [];
  const rows: ClosureRowFingerprintInput[] = [];
  const built: BuiltRow[] = [];
  const reports: string[] = [];

  if (!input.manifestOk) {
    stops.push({ table: 'player_match_stats', rowId: null, step: 'D10', code: 'provenance_unexplained' });
  }

  // §5.10 affected seasons, evaluated after we know which rows would actually MOVE/DELETE
  // positive Brownlow rows -- collected in a first pass below, evaluated in a second pass.
  const affectedSeasons = new Set<number>();
  const positiveBrownlowSeasons = new Set<number>();
  const aflApiSourceId = await fetchAflApiSourceId(tx);

  const pmsCandidates = await readPlayerMatchStatsCandidatesForPlayer(tx, providerId, pId, lockRows);
  const brownlowCandidates = await readBrownlowCandidatesForPlayer(tx, providerId, pId, lockRows);

  /* ---- Brownlow pre-pass: C11 and B1-B5, so BG2 knows the PROVEN closure rows (§5.9) ---- */
  const brownlowAssessments: { candidate: BrownlowCandidate; ownership: ClosureOwnership; verdict: AttributionResult }[] = [];
  for (const candidate of brownlowCandidates) {
    const ownership = brownlowClosureOwnership(candidate, aflApiSourceId);
    let verdict: AttributionResult = { ok: true };
    if (ownership === 'claimed') {
      verdict = candidate.applications.length === 0
        ? { ok: false, stop: { step: 'B2', code: 'no_application_evidence', detail: 'an afl_api-owned round row with no canonical_applications history' } }
        : evaluateBrownlowMutationEligibility(await buildBrownlowEvidence(tx, candidate, providerId, pId, aflApiSourceId));
    }
    brownlowAssessments.push({ candidate, ownership, verdict });
  }
  const provenBrownlowClosureRowIds = provenBrownlowClosureRowIdsOf(brownlowAssessments);
  const brownlowEventRows: BrownlowEventRow[] = brownlowCandidates.map((c) => ({
    id: c.id, season: c.season, roundNumber: c.roundNumber, matchId: c.matchId,
  }));

  /* ---- player_match_stats candidates ---- */
  for (const candidate of pmsCandidates) {
    const ownership = playerMatchStatsClosureOwnership(candidate, providerId, aflApiSourceId);
    if (ownership === 'foreign') {
      reports.push(`NOOP foreign (C11): player_match_stats#${candidate.id} (player ${pId}, match ${candidate.matchId}) is not afl_api-owned and carries no ${providerId} lineage; preserved untouched`);
      continue;
    }
    if (ownership === 'indeterminate') {
      stops.push({ table: 'player_match_stats', rowId: candidate.id, step: 'C11', code: 'provenance_unexplained' });
      continue;
    }
    const evidence = buildPlayerMatchStatsEvidence(candidate, providerId, aflApiSourceId);
    const eligibility = evaluatePlayerMatchStatsMutationEligibility(evidence);
    if (!eligibility.ok) {
      stops.push({ table: 'player_match_stats', rowId: candidate.id, step: eligibility.stop.step, code: eligibility.stop.code });
      continue;
    }
    if (!playerMatchStatsHistoryThroughProvider(candidate.applications, providerId)) {
      stops.push({ table: 'player_match_stats', rowId: candidate.id, step: 'P3', code: 'mixed_provider_application_history' });
      continue;
    }

    const bg2Blockers = foreignBrownlowRowsAtEvent({
      rows: brownlowEventRows, provenClosureRowIds: provenBrownlowClosureRowIds, ownRowId: null,
      event: { kind: 'match', matchId: candidate.matchId, season: candidate.season, roundNumber: candidate.roundNumber },
    });
    const bg3 = await readEntryStateNamesPlayer(tx, candidate.matchId, pId);
    const guardEvidence: BrownlowGuardEvidence = {
      playerMatchStatsBrownlowVotes: candidate.current.brownlow_votes ?? null,
      foreignBrownlowRowAtEvent: bg2Blockers.length > 0,
      entryStateNamesPlayer: bg3,
    };
    const guards = evaluateBrownlowGuards(guardEvidence);
    if (!guards.ok) {
      stops.push({ table: 'player_match_stats', rowId: candidate.id, step: guards.stop.step, code: guards.stop.code });
      continue;
    }

    const dependents = await readDependentsForRow(tx, pId, candidate.matchId);
    const dependentResult = evaluateDependents({
      afterSirenKicksRowForP: dependents.afterSirenKicksRowForP,
      achievementRowForP: dependents.achievementRowForP,
      unresolvedRowAtMatch: dependents.unresolvedRowAtMatch,
      matchLessDependentLosesParticipation: false,
      matchLessDependentParticipationRemains: false,
      firstKickGoalTieBreakChanges: false,
    });
    if (dependentResult.stops.length > 0) {
      for (const s of dependentResult.stops) stops.push({ table: 'player_match_stats', rowId: candidate.id, step: s.step, code: s.code });
      continue;
    }
    reports.push(...dependentResult.reports.map((r) => `player_match_stats#${candidate.id}: ${r}`));

    const [counterpartRow] = lockRows
      ? await tx<Record<string, JsonValue>[]>`
          SELECT to_jsonb(pms.*) AS row FROM player_match_stats pms
           WHERE pms.player_id = ${pPrimeId} AND pms.match_id = ${candidate.matchId}
             FOR UPDATE
        `.then((r) => r.map((x) => (x as unknown as { row: Record<string, JsonValue> }).row))
      : await tx<Record<string, JsonValue>[]>`
          SELECT to_jsonb(pms.*) AS row FROM player_match_stats pms
           WHERE pms.player_id = ${pPrimeId} AND pms.match_id = ${candidate.matchId}
        `.then((r) => r.map((x) => (x as unknown as { row: Record<string, JsonValue> }).row));
    const counterpartOwnerKey = counterpartRow ? await ownerKeyOf(tx, Number(counterpartRow.source_id)) : null;
    const wouldViolateUnique = false; // C8: UNIQUE(player_id, match_id) is checked by the conditional write itself

    const dispositionResult = decidePlayerMatchStatsDisposition({
      counterpart: {
        exists: counterpartRow !== undefined,
        ownership: counterpartOwnerKey === AFL_API_SOURCE_KEY ? 'afl_api' : counterpartOwnerKey === null ? 'null_owned' : 'foreign',
        row: counterpartRow ?? null,
      },
      closureRow: candidate.current,
      wouldViolateUniqueConstraint: wouldViolateUnique,
    });
    if (dispositionResult.disposition === 'STOP') {
      stops.push({ table: 'player_match_stats', rowId: candidate.id, step: dispositionResult.stop.step, code: dispositionResult.stop.code });
      continue;
    }

    affectedSeasons.add(candidate.season);
    const latest = latestNonCorrectionApplication(candidate.applications)!;
    const contractHash = rowContractHash(projectContract(candidate.current, PLAYER_MATCH_STATS_CONTRACT_FIELDS));
    rows.push({
      table: 'player_match_stats', rowId: candidate.id, naturalKey: { player_id: pId, match_id: candidate.matchId },
      disposition: dispositionResult.disposition, contractSha256: contractHash,
      provenance: {
        sourceKey: AFL_API_SOURCE_KEY,
        sourceRecordId: String(candidate.current.source_record_id ?? ''),
        importBatchId: Number(candidate.current.import_batch_id ?? -1),
      },
    });
    built.push({
      table: 'player_match_stats', rowId: candidate.id, naturalKey: { player_id: pId, match_id: candidate.matchId },
      disposition: dispositionResult.disposition, contractSha256: contractHash,
      provenance: {
        sourceKey: AFL_API_SOURCE_KEY, sourceRecordId: String(candidate.current.source_record_id ?? ''),
        importBatchId: Number(candidate.current.import_batch_id ?? -1),
      },
      citedApplication: { family: latest.family, externalRecordId: latest.externalRecordId, sourceVersionSeq: latest.sourceVersionSeq },
      previousValues: candidate.current,
      currentRow: candidate.current,
    });
  }

  /* ---- brownlow_round_votes candidates ---- */
  for (const { candidate, ownership, verdict } of brownlowAssessments) {
    if (ownership === 'foreign') {
      // C11: never moved, deleted or merged. It still blocks (BG2) any closure row at its event,
      // because it is not in `provenBrownlowClosureRowIds`.
      reports.push(`NOOP foreign (C11): brownlow_round_votes#${candidate.id} (player ${pId}, season ${candidate.season}, round ${candidate.roundNumber}) is not afl_api-owned and carries no ${providerId} lineage; preserved untouched, and a BG2 blocker for any closure row at its event`);
      continue;
    }
    if (ownership === 'indeterminate') {
      stops.push({ table: 'brownlow_round_votes', rowId: candidate.id, step: 'C11', code: 'provenance_unexplained' });
      continue;
    }
    if (!verdict.ok) {
      stops.push({ table: 'brownlow_round_votes', rowId: candidate.id, step: verdict.stop.step, code: verdict.stop.code });
      continue;
    }

    // The row's Brownlow event (§5.9): its own match, or (S, R) with every match of (S, R).
    const roundMatchIds = candidate.matchId === null
      ? await readRoundMatchIds(tx, candidate.season, candidate.roundNumber, lockRows) : [];
    const event: BrownlowEvent = candidate.matchId !== null
      ? { kind: 'match', matchId: candidate.matchId, season: candidate.matchSeason ?? candidate.season, roundNumber: candidate.matchRoundNumber }
      : { kind: 'round', season: candidate.season, roundNumber: candidate.roundNumber, matchIds: roundMatchIds };
    const eventMatchIds = candidate.matchId !== null ? [candidate.matchId] : roundMatchIds;

    const bg2Blockers = foreignBrownlowRowsAtEvent({
      rows: brownlowEventRows, provenClosureRowIds: provenBrownlowClosureRowIds, ownRowId: candidate.id, event,
    });
    // BG3 for a match-less row covers EVERY match of (S, R) (§5.9, pass 5 D-P5-2).
    let bg3 = false;
    for (const matchId of eventMatchIds) bg3 ||= await readEntryStateNamesPlayer(tx, matchId, pId);
    const guards = evaluateBrownlowGuards({
      playerMatchStatsBrownlowVotes: null, foreignBrownlowRowAtEvent: bg2Blockers.length > 0, entryStateNamesPlayer: bg3,
    });
    if (!guards.ok) {
      stops.push({ table: 'brownlow_round_votes', rowId: candidate.id, step: guards.stop.step, code: guards.stop.code });
      continue;
    }

    // C1c (§5.4): P′ participation after the plan in the row's match, or -- for a match-less row
    // -- in exactly one match of (S, R). A `player_match_stats` closure row of this plan at that
    // match (MOVE, or C2's DELETE beside an existing P′ row) counts, as does any existing P′ row.
    const participationMatchIds = participationMatchIdsAfterPlan({
      candidateMatchIds: eventMatchIds,
      pPrimeRowMatchIds: await readParticipationMatchIds(tx, pPrimeId, eventMatchIds),
      plannedPlayerMatchStatsMatchIds: new Set(built
        .filter((b) => b.table === 'player_match_stats').map((b) => toInt(b.naturalKey.match_id))
        .filter((id): id is number => id !== null)),
    });
    const participation = evaluateBrownlowParticipation(candidate.current.played, participationMatchIds.length === 1);
    if (!participation.ok) {
      stops.push({ table: 'brownlow_round_votes', rowId: candidate.id, step: participation.stop.step, code: participation.stop.code });
      continue;
    }
    if (candidate.current.played !== false) positiveBrownlowSeasons.add(candidate.season);

    const [counterpartRow] = lockRows
      ? await tx<{ played: JsonValue; votes: JsonValue; matchId: JsonValue; sourceId: number }[]>`
          SELECT played, votes, match_id AS "matchId", source_id AS "sourceId" FROM brownlow_round_votes
           WHERE player_id = ${pPrimeId} AND season = ${candidate.season} AND round_number = ${candidate.roundNumber}
             FOR UPDATE
        `
      : await tx<{ played: JsonValue; votes: JsonValue; matchId: JsonValue; sourceId: number }[]>`
          SELECT played, votes, match_id AS "matchId", source_id AS "sourceId" FROM brownlow_round_votes
           WHERE player_id = ${pPrimeId} AND season = ${candidate.season} AND round_number = ${candidate.roundNumber}
        `;
    const counterpartOwnerKey = counterpartRow ? await ownerKeyOf(tx, counterpartRow.sourceId) : null;
    const dispositionResult = decideBrownlowDisposition({
      counterpart: {
        exists: counterpartRow !== undefined,
        ownership: counterpartOwnerKey === AFL_API_SOURCE_KEY ? 'afl_api' : counterpartOwnerKey === null ? 'null_owned' : 'foreign',
        row: counterpartRow ? { played: counterpartRow.played, votes: counterpartRow.votes, matchId: counterpartRow.matchId } : null,
      },
      closureRow: candidate.current,
    });
    if (dispositionResult.disposition === 'STOP') {
      stops.push({ table: 'brownlow_round_votes', rowId: candidate.id, step: dispositionResult.stop.step, code: dispositionResult.stop.code });
      continue;
    }

    affectedSeasons.add(candidate.season);
    const latest = candidate.applications[candidate.applications.length - 1];
    const contractHash = rowContractHash(projectContract(
      { played: candidate.current.played, votes: candidate.current.votes, match_id: candidate.current.matchId },
      BROWNLOW_ROUND_VOTES_CONTRACT_FIELDS,
    ));
    const naturalKey = { season: candidate.season, player_id: pId, round_number: candidate.roundNumber };
    rows.push({
      table: 'brownlow_round_votes', rowId: candidate.id, naturalKey, disposition: dispositionResult.disposition,
      contractSha256: contractHash,
      provenance: {
        sourceKey: AFL_API_SOURCE_KEY, sourceRecordId: String(candidate.currentRow.source_record_id ?? ''),
        importBatchId: Number(candidate.currentRow.import_batch_id ?? -1),
      },
    });
    built.push({
      table: 'brownlow_round_votes', rowId: candidate.id, naturalKey, disposition: dispositionResult.disposition,
      contractSha256: contractHash,
      provenance: {
        sourceKey: AFL_API_SOURCE_KEY, sourceRecordId: String(candidate.currentRow.source_record_id ?? ''),
        importBatchId: Number(candidate.currentRow.import_batch_id ?? -1),
      },
      citedApplication: { family: latest.family, externalRecordId: latest.externalRecordId, sourceVersionSeq: latest.sourceVersionSeq },
      previousValues: candidate.currentRow,
      currentRow: candidate.currentRow,
    });
  }

  /* ---- §5.10, per affected season ---- */
  for (const season of affectedSeasons) {
    const verdict = await evaluateSeasonForCorrection(tx, season, pId, pPrimeId, positiveBrownlowSeasons.has(season));
    if (!verdict.independent && verdict.stop) {
      stops.push({ table: 'player_match_stats', rowId: null, step: verdict.stop.step, code: verdict.stop.code });
    } else {
      reports.push(`season ${season}: brownlow season-total independence PASS (${verdict.seasonClass})`);
    }
  }

  /* ---- §5.11 DP-4, over the whole plan (it depends on every removed participation) ---- */
  const seasonList = [...affectedSeasons];
  const removedPmsRowIds = new Set(built.filter((b) => b.table === 'player_match_stats').map((b) => b.rowId));
  const dp4 = evaluateMatchLessDependentParticipation({
    pId, pPrimeId, affectedSeasons,
    dependents: await readMatchLessDependents(tx, [pId, pPrimeId], seasonList),
    pParticipation: await readParticipation(tx, pId, seasonList),
    removedPlayerMatchStatsRowIds: removedPmsRowIds,
  });
  const dp4Result = evaluateDependents({
    afterSirenKicksRowForP: false,
    achievementRowForP: false,
    unresolvedRowAtMatch: false,
    matchLessDependentLosesParticipation: dp4.losesParticipation.length > 0,
    matchLessDependentParticipationRemains: dp4.participationRemains.length > 0 || dp4.pPrimeReported.length > 0,
    firstKickGoalTieBreakChanges: false,
  });
  for (const s of dp4Result.stops) stops.push({ table: 'player_match_stats', rowId: null, step: s.step, code: s.code });
  for (const d of dp4.losesParticipation) reports.push(`DP-4 STOP: ${d.table}#${d.id} (season ${d.season}) loses its justifying participation`);
  for (const d of [...dp4.participationRemains, ...dp4.pPrimeReported]) {
    reports.push(`DP-4 affected dependent (reported): ${d.table}#${d.id} (player ${d.playerId}, season ${d.season})`);
  }

  const plan: MutationPlan = {
    plannerVersion: PLANNER_VERSION,
    provider: { externalId: providerId, sourceKey: AFL_API_SOURCE_KEY },
    authority,
    identityAction,
    rows,
    stops,
  };
  return { plan, rows: built, reports };
}

async function ownerKeyOf(tx: TransactionSql, sourceId: number | null): Promise<string | null> {
  if (sourceId === null) return null;
  const [row] = await tx<{ key: string }[]>`SELECT key FROM sources WHERE id = ${sourceId}`;
  return row?.key ?? null;
}

function projectContract(row: Record<string, JsonValue>, fields: readonly string[]): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const f of fields) out[f] = row[f] ?? null;
  return out;
}

/* ==================================================================== *
 * §8.2: the ORIGINAL transaction
 * ==================================================================== */

/** A reported STOP: the plan's stop shape, plus the planner's detail text when one exists. */
export type OutcomeStop = PlanStop & { readonly detail?: string };

export type CorrectionOutcome =
  | { readonly kind: 'STOP'; readonly stops: readonly OutcomeStop[]; readonly fingerprint: string }
  | { readonly kind: 'ALREADY_SATISFIED'; readonly reports: readonly string[] }
  | { readonly kind: 'PLANNED'; readonly fingerprint: string; readonly plan: MutationPlan; readonly reports: readonly string[] }
  | {
    readonly kind: 'COMMITTED' | 'ROLLED_BACK';
    readonly fingerprint: string; readonly adjudicationId: number; readonly batchId: string;
    readonly moved: number; readonly deleted: number; readonly reports: readonly string[];
  };

const LOCK_TIMEOUT = '5s';

/** §8.2 step 6's conditional-write guard: re-hash the row (held under `FOR UPDATE` since
 * `buildClosure` planned it) and require it still equals the planned `contractSha256`. */
async function assertRowStillMatchesContract(tx: TransactionSql, row: BuiltRow): Promise<void> {
  const [current] = await tx<{ row: Record<string, JsonValue> }[]>`
    SELECT to_jsonb(t.*) AS row FROM ${tx(row.table)} t WHERE t.id = ${row.rowId}
  `;
  if (!current) throw new CorrectionRefused(`REFUSED: row ${row.table}#${row.rowId} vanished before write (STOP, rollback)`);
  const fields = row.table === 'player_match_stats'
    ? PLAYER_MATCH_STATS_CONTRACT_FIELDS as unknown as readonly string[]
    : BROWNLOW_ROUND_VOTES_CONTRACT_FIELDS as unknown as readonly string[];
  const currentHash = rowContractHash(projectContract(current.row, fields));
  if (currentHash !== row.contractSha256) {
    throw new CorrectionRefused(`REFUSED: row ${row.table}#${row.rowId} changed between planning and write (STOP, rollback)`);
  }
}

async function runCorrection(
  tx: TransactionSql, args: CorrectionArgs, evidenceFile: LoadedEvidenceFile,
): Promise<CorrectionOutcome> {
  // §8.2: "--validate-only runs step 2's planning read-only and takes no write lock." The D10
  // identity-table lock and the D7 advisory locks are both write-shaped (they serialise against
  // concurrent settle/admin writers); validate-only never takes them, and its row reads below
  // are correspondingly never FOR UPDATE (`lockRows: false`) -- a deliberately best-effort,
  // possibly-stale snapshot, exactly what "read-only planning" means.
  const takeLocks = args.mode !== 'validate-only';

  await proveSession(tx, args.expectDatabase);
  if (takeLocks) await takeIdentityTableLock(tx, LOCK_TIMEOUT);

  const existing = await readExternalIdentityRow(tx, args.providerId);
  const ledgerRows = await readLedgerRowsForProvider(tx, args.providerId);
  const net = netLedgerAction(ledgerRows);

  if (net !== null && net.action === 'corrected') {
    // §8.2 step 2 -> §8.5: a CORRECTED net state never starts a second correction. The re-run is
    // CORRECTION SATISFACTION (Q2) only: it opens no batch, appends no ledger row and writes no
    // identity or canonical row, and it deliberately precedes the Q1-only checks below (the live
    // identity's unique/resolved status, the D10 manifest), which §5.12 says Q2 never evaluates.
    // The reader it receives exposes reads only.
    if (takeLocks) await takeCorrectionLocks(tx, args.providerId, [net.playerId, args.toPlayerId]);
    return runAlreadyCorrectedRerun(dbCorrectionSatisfactionReader(tx), args, net.id);
  }

  if (existing === null || !['unique', 'resolved'].includes(existing.status) || existing.playerId === null) {
    throw new CorrectionRefused(`REFUSED: ${args.providerId} is not a live unique/resolved afl_api identity`);
  }
  const pId = existing.playerId;
  const pPrimeId = args.toPlayerId;

  if (takeLocks) await takeCorrectionLocks(tx, args.providerId, [pId, pPrimeId]);
  await assertManifestValidatesAgainstCatalogue(tx); // read-only; safe and cheap in every mode

  const [pForward, pPrimeForward] = await Promise.all([
    readAflApiForwardIdentities(tx, [pId]).then((m) => m.get(pId)),
    readAflApiForwardIdentities(tx, [pPrimeId]).then((m) => m.get(pPrimeId)),
  ]);
  const pIdentity = pForward && pForward.ok ? pForward : null;
  const pPrimeIdentity = pPrimeForward && pPrimeForward.ok ? pPrimeForward : null;

  const [pPrimeOtherProvider] = await tx<{ n: number }[]>`
    SELECT count(*)::int AS n FROM external_identities ei JOIN sources s ON s.id = ei.source_id
     WHERE s.key = ${AFL_API_SOURCE_KEY} AND ei.player_id = ${pPrimeId} AND ei.external_id <> ${args.providerId}
       AND ei.status IN ('unique', 'resolved')
  `;

  const wholePlanStops = evaluateWholePlanStops({
    pEqualsPPrimeByPlayerId: pId === pPrimeId,
    pEqualsPPrimeByStableIdentity: !!(pIdentity && pPrimeIdentity && pIdentity.identity === pPrimeIdentity.identity),
    pPrimeHoldsAnotherAflApiProvider: pPrimeOtherProvider.n > 0,
    stableIdentityMissingOrAmbiguous: pIdentity === null || pPrimeIdentity === null,
    identityIsManualAdminEditToken: pIdentity?.via === 'manual_admin_edit' || pPrimeIdentity?.via === 'manual_admin_edit',
    netStateAlreadyCorrected: false,
  });
  if (wholePlanStops.length > 0) {
    return { kind: 'STOP', stops: wholePlanStops.map((s) => ({ table: 'player_match_stats' as const, rowId: null, step: s.step, code: s.code })), fingerprint: '' };
  }

  const observedSurname = await readObservedSurname(tx, args.providerId);
  const pPrimeSurname = await readPlayerSurname(tx, pPrimeId);
  const surnameDisagrees = observedSurname !== null
    && normaliseSurname(observedSurname) !== ''
    && normaliseSurname(pPrimeSurname) !== ''
    && normaliseSurname(observedSurname) !== normaliseSurname(pPrimeSurname);
  if (surnameDisagrees && !args.acknowledgeSurnameDisagreement) {
    return {
      kind: 'STOP',
      stops: [{ table: 'player_match_stats', rowId: null, step: 'M1', code: 'identity_unresolvable' }],
      fingerprint: '',
    };
  }
  if (!surnameDisagrees && args.acknowledgeSurnameDisagreement) {
    throw new CorrectionRefused('REFUSED: --acknowledge-surname-disagreement was given but the observed surname does not disagree');
  }

  const humanOrigin = net !== null && net.action === 'linked';
  const authority: AuthorityBlock = {
    mode: 'ORIGINAL',
    netState: humanOrigin ? 'LINKED' : 'NONE',
    ledgerId: humanOrigin ? net!.id : null,
    liveIdentityRowId: existing.id,
    previousPlayerIdentity: pIdentity!.identity,
    playerIdentity: pPrimeIdentity!.identity,
  };
  const manifestOk = true; // assertManifestValidatesAgainstCatalogue already threw if not

  const closure = await buildClosure(tx, {
    providerId: args.providerId, pId, pPrimeId, authority,
    identityAction: humanOrigin ? 'update_in_place' : 'upgrade_in_place', manifestOk, lockRows: takeLocks,
  });
  const fingerprint = mutationPlanFingerprint(closure.plan);

  if (args.mode === 'validate-only') {
    if (closure.plan.stops.length > 0) return { kind: 'STOP', stops: closure.plan.stops, fingerprint };
    return { kind: 'PLANNED', fingerprint, plan: closure.plan, reports: closure.reports };
  }

  if (closure.plan.stops.length > 0) return { kind: 'STOP', stops: closure.plan.stops, fingerprint };

  if (args.mode === 'apply' && fingerprint !== args.expectFingerprint) {
    throw new CorrectionRefused(`REFUSED: recomputed fingerprint ${fingerprint} does not match --expect-fingerprint ${args.expectFingerprint}`);
  }

  /* ---- §8.2 steps 3-10: write ---- */
  const [batch] = await tx<{ id: string }[]>`
    INSERT INTO import_batches (source_id, tool, target_table, status, records_read, notes)
    VALUES (
      (SELECT id FROM sources WHERE key = ${AFL_API_SOURCE_KEY}), ${TOOL}, 'canonical_applications',
      'running', ${closure.rows.length},
      ${`AFLDB-ISSUE-238 correction; authority afl_api_identity_adjudications id <pending>`}
    )
    RETURNING id::text AS id
  `;
  const batchId = batch.id;

  const surnameAcknowledged = args.acknowledgeSurnameDisagreement;
  const evidencePayload = {
    closureFingerprint: fingerprint,
    evidenceFile: { path: evidenceFile.path, sha256: evidenceFile.sha256, summary: evidenceFile.summary },
    reports: closure.reports,
  };
  const [adjudication] = await tx<{ id: number }[]>`
    INSERT INTO afl_api_identity_adjudications
          (source_key, external_id, action, player_id, player_identity, previous_state,
           previous_player_identity, evidence, evidence_sha256,
           surname_disagreement_acknowledged, admin_user_id, note, supersedes_id)
    VALUES (${AFL_API_SOURCE_KEY}, ${args.providerId}, 'corrected', ${pPrimeId}, ${pPrimeIdentity!.identity},
            ${jsonbOf(tx, { id: existing.id, playerId: existing.playerId, status: existing.status } as unknown as JsonValue)},
            ${pIdentity!.identity}, ${jsonbOf(tx, evidencePayload as unknown as JsonValue)}, ${evidenceFile.sha256},
            ${surnameAcknowledged}, ${args.adminUserId}, ${args.note},
            ${humanOrigin ? net!.id : null})
    RETURNING id::int AS id
  `;
  const adjudicationId = adjudication.id;

  // §8.2 step 5: bind K to A BEFORE any canonical mutation, so the step-9 re-plan (which finds
  // the bound batch through exactly this `validation_result`) examines every row it wrote. The
  // rowProofs are fully determined by the plan; the counts are re-stated at finalisation.
  const rowProofs: RowProof[] = closure.rows.map((row): RowProof => (row.disposition === 'MOVE'
    ? { table: row.table, verb: 'update', oldKey: row.naturalKey, newKey: movedNaturalKey(row, pPrimeId), preCorrectionContractSha256: row.contractSha256 }
    : { table: row.table, verb: 'delete', oldKey: row.naturalKey, newKey: null, preCorrectionContractSha256: row.contractSha256 }));
  const validationResultFor = (counts: JsonValue): JsonValue => ({
    kind: 'afl_api_identity_correction', mode: 'original', context: 'live_target',
    plannerVersion: PLANNER_VERSION, adjudicationId, externalId: args.providerId,
    adjudicationEvidenceSha256: evidenceFile.sha256, closureFingerprint: fingerprint,
    mutationEligibility: 'PASS', rowProofs: rowProofs.map(rowProofJson), counts,
  });
  const countsFor = (rows: readonly BuiltRow[], projectionsMoved: number): JsonValue => {
    const count = (disposition: BuiltRow['disposition'], table: CanonicalTable) => rows
      .filter((r) => r.disposition === disposition && r.table === table).length;
    return {
      moved: { player_match_stats: count('MOVE', 'player_match_stats'), brownlow_round_votes: count('MOVE', 'brownlow_round_votes') },
      deleted: {
        player_match_stats: count('DELETE_AS_FOREIGN_COLLISION', 'player_match_stats'),
        brownlow_round_votes: count('DELETE_AS_FOREIGN_COLLISION', 'brownlow_round_votes'),
      },
      projectionsMoved,
    };
  };
  await tx`
    UPDATE import_batches
       SET validation_result = ${jsonbOf(tx, validationResultFor(countsFor(closure.rows, 0)))},
           notes = ${`AFLDB-ISSUE-238 correction; authority afl_api_identity_adjudications id ${adjudicationId}`}
     WHERE id = ${batchId}::bigint AND status = 'running'
    RETURNING id
  `.then((r) => {
    if (r.length !== 1) throw new CorrectionRefused('REFUSED: binding the correction batch did not affect exactly one row');
  });

  await tx`
    UPDATE external_identities
       SET player_id = ${pPrimeId}, status = 'resolved', candidate_count = 0,
           match_method = ${AFL_API_ADMIN_MATCH_METHOD}, external_name = NULL,
           notes = 'AFLDB-ISSUE-238 admin correction; see afl_api_identity_adjudications'
     WHERE id = ${existing.id}
  `;

  let moved = 0;
  let deleted = 0;
  let projectionsMoved = 0;

  // Deletes first (§8.2 step 6: "deletes first so no UNIQUE is transiently violated"). Every
  // row here has been held under `FOR UPDATE` continuously since `buildClosure` computed its
  // `contractSha256` (§8.2 step 1's row locks), so no writer outside this transaction could have
  // changed it since; the re-check below is the literal "conditional write" the runbook requires
  // (§8.2 step 6) and is defence in depth against a bug elsewhere in this same transaction, not
  // a race with another session.
  for (const row of closure.rows.filter((r) => r.disposition === 'DELETE_AS_FOREIGN_COLLISION')) {
    await assertRowStillMatchesContract(tx, row);
    const deleteResult = await tx`DELETE FROM ${tx(row.table)} WHERE id = ${row.rowId}`;
    if (deleteResult.count !== 1) {
      throw new CorrectionRefused(`REFUSED: delete of ${row.table}#${row.rowId} affected ${deleteResult.count} rows, not 1 (STOP, rollback)`);
    }
    await tx`
      INSERT INTO canonical_applications (
        import_batch_id, source_id, family, external_record_id, source_version_seq,
        target_table, target_key, verb, previous_values, new_values
      ) VALUES (
        ${batchId}::bigint, (SELECT id FROM sources WHERE key = ${AFL_API_SOURCE_KEY}),
        ${row.citedApplication.family}, ${row.citedApplication.externalRecordId}, ${row.citedApplication.sourceVersionSeq},
        ${row.table}, ${jsonbOf(tx, row.naturalKey)}, 'delete',
        ${jsonbOf(tx, row.previousValues)}, ${jsonbOf(tx, {})}
      )
    `;
    deleted += 1;
  }

  for (const row of closure.rows.filter((r) => r.disposition === 'MOVE')) {
    const newKey = movedNaturalKey(row, pPrimeId);
    await assertRowStillMatchesContract(tx, row);
    const result = await tx`
      UPDATE ${tx(row.table)} SET player_id = ${pPrimeId} WHERE id = ${row.rowId}
    `;
    if (result.count !== 1) {
      throw new CorrectionRefused(`REFUSED: move of ${row.table}#${row.rowId} affected ${result.count} rows, not 1 (STOP, rollback)`);
    }
    await tx`
      INSERT INTO canonical_applications (
        import_batch_id, source_id, family, external_record_id, source_version_seq,
        target_table, target_key, verb, previous_values, new_values
      ) VALUES (
        ${batchId}::bigint, (SELECT id FROM sources WHERE key = ${AFL_API_SOURCE_KEY}),
        ${row.citedApplication.family}, ${row.citedApplication.externalRecordId}, ${row.citedApplication.sourceVersionSeq},
        ${row.table}, ${jsonbOf(tx, newKey)}, 'update',
        ${jsonbOf(tx, { player_id: pId })}, ${jsonbOf(tx, { player_id: pPrimeId })}
      )
    `;
    moved += 1;
  }

  // §8.2 step 6, "move the typed projection rows where present": EVERY typed projection row of
  // CD_I that still names P, in both tables -- the MOVE rows' (P5 / L8-c), a C2/C4 DELETE's, and
  // any stray one attached to no closure row. They are CD_I's own observations and CD_I is now
  // P′; SAT-5 (§5.12, "no typed projection ... names P for CD_I") checks exactly this set in the
  // post-write re-plan. A failure here is a real error and rolls the whole correction back.
  for (const projection of [
    await tx`
      UPDATE staging.afl_api_player_match SET player_id = ${pPrimeId}
       WHERE source_id = (SELECT id FROM sources WHERE key = ${AFL_API_SOURCE_KEY})
         AND provider_player_id = ${args.providerId} AND player_id = ${pId}
    `,
    await tx`
      UPDATE staging.afl_api_brownlow_vote SET player_id = ${pPrimeId}
       WHERE source_id = (SELECT id FROM sources WHERE key = ${AFL_API_SOURCE_KEY})
         AND provider_player_id = ${args.providerId} AND player_id = ${pId}
    `,
  ]) projectionsMoved += projection.count;

  // §8.2 step 7: resolve only the ISSUE-240 contradictions this correction adjudicates.
  const resolvedFindings = await resolveAdjudicatedContradictions(tx, args.providerId, pPrimeIdentity!.identity);

  // §8.2 step 8: targeted recompute + byte-identical stat_availability assertion.
  const affectedSeasons = new Set(closure.rows.map((r) => (r.table === 'player_match_stats' ? Number(r.naturalKey.match_id) : null)).filter((x): x is number => x !== null));
  const seasonRows = await tx<{ season: number }[]>`
    SELECT DISTINCT season FROM matches WHERE id = ANY(${[...affectedSeasons]})
  `;
  const brownlowSeasons = new Set(closure.rows.filter((r) => r.table === 'brownlow_round_votes').map((r) => Number(r.naturalKey.season)));
  for (const s of seasonRows) {
    await recomputePlayerDerivedStats(tx, [pId, pPrimeId], s.season);
  }
  for (const season of brownlowSeasons) {
    const before = await readStatAvailability(tx, season);
    await recomputeBrownlowCoverage(tx, season);
    const after = await readStatAvailability(tx, season);
    if (canonicalJson(before as unknown as JsonValue) !== canonicalJson(after as unknown as JsonValue)) {
      throw new CorrectionRefused(`REFUSED: stat_availability changed for season ${season} (STOP, rollback) -- before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
    }
  }

  // §8.2 step 9 / §8.4: the post-write re-plan is CORRECTION SATISFACTION (Q2) -- the SAME
  // evaluator a later re-run uses, with K as "the batch of the current transaction".
  const postWrite = await checkCorrectionSatisfaction(dbCorrectionSatisfactionReader(tx), {
    providerId: args.providerId, adjudicationId, currentBatchId: Number(batchId),
  });
  if (!postWrite.satisfied) {
    throw new CorrectionRefused(
      `REFUSED: post-write CORRECTION SATISFACTION re-plan failed -- STOP, rollback: ${postWrite.stops.map(describeStop).join('; ')}`,
    );
  }

  // §8.2 step 10: finalise K. The binding fields are unchanged; the counts are the actual ones.
  await tx`
    UPDATE import_batches
       SET status = 'completed', completed_at = now(), records_inserted = ${moved + deleted},
           records_updated = 0, records_rejected = 0,
           validation_result = ${jsonbOf(tx, validationResultFor(countsFor(closure.rows, projectionsMoved)))}
     WHERE id = ${batchId}::bigint AND status = 'running'
    RETURNING id
  `.then((r) => {
    if (r.length !== 1) throw new CorrectionRefused('REFUSED: batch finalisation did not affect exactly one row');
  });

  const reports = [
    ...closure.reports,
    ...postWrite.reports,
    ...(resolvedFindings > 0 ? [`resolved ${resolvedFindings} ISSUE-240 contradiction finding(s) this correction adjudicates`] : []),
    ...postCommitReportLines(),
  ];

  // The caller (`main`) decides COMMITTED vs ROLLED_BACK by whether it lets `sql.begin()`
  // return normally (apply) or throws to force a real SQL rollback (dry-run) -- this function
  // only ever reports what it actually wrote inside the still-open transaction.
  return { kind: 'COMMITTED', fingerprint, adjudicationId, batchId, moved, deleted, reports };
}

/** §8.2 step 8's before/after read. A read failure propagates and rolls the correction back: an
 * empty default on both sides would compare byte-identical and fake the assertion's PASS. */
export async function readStatAvailability(tx: TransactionSql, season: number): Promise<unknown> {
  return tx<Record<string, JsonValue>[]>`
    SELECT * FROM stat_availability WHERE season = ${season}
  `;
}

function postCommitReportLines(): string[] {
  return [
    'caches: /players/[slug], /matches/[id], /seasons/[year], /brownlow/[year], /records, /records/[category], / (3600s ISR); /clubs/[slug] (86400s); no cluster-wide invalidation beyond /api/internal/revalidate-season (O-4)',
    'Coleman: any completed-season goal move should be checked and refreshed via import_awards.py --groups coleman if applicable (§4.F, out of transaction)',
  ];
}

/** §8.2 step 7. A read failure propagates and rolls the correction back; it never reads as
 * "zero findings to resolve". */
export async function resolveAdjudicatedContradictions(tx: TransactionSql, providerId: string, pPrimeIdentity: string): Promise<number> {
  const rows = await tx<{ id: string; issueKey: string }[]>`
    SELECT id::text AS id, issue_key AS "issueKey" FROM data_issues
     WHERE issue_type = 'afl_api_identity_contradiction' AND resolved_at IS NULL
       AND details->>'external_id' = ${providerId} AND details->>'proposed_player_identity' = ${pPrimeIdentity}
  `;
  if (rows.length === 0) return 0;
  const result = await tx`
    UPDATE data_issues SET resolved_at = now(), resolution = 'afl_api_identity_corrected'
     WHERE id = ANY(${rows.map((r) => r.id)}::bigint[]) AND resolved_at IS NULL
  `;
  return result.count;
}

/* ==================================================================== *
 * §8.4 / §8.5 / §5.12 Q2: CORRECTION SATISFACTION
 *
 * ONE evaluator, `evaluateCorrectionSatisfactionQ2`, over evidence ONE read-only reader gathers.
 * Both callers use exactly this path:
 *   - the in-transaction post-write re-plan (§8.2 step 9, §8.4), with K as the current batch;
 *   - a later `--validate-only` / `--dry-run` / `--apply` on a provider whose net ledger state is
 *     already `CORRECTED(A)` (§8.5), which returns ALREADY_SATISFIED or STOP and writes nothing.
 * Every decision composes the planner's own primitives (`evaluateMoveLineage`,
 * `evaluateDeleteLineage`, `evaluateL8`, `evaluateCorrectionTargetAbsent`,
 * `evaluateCorrectionSatisfaction`, the P/B attribution and B3-C chain evaluators). Q1's
 * current-state guards (P6/P7/B5, BG1-BG3, C1-C11, C1c, §5.10, §5.11, the D10 manifest) are never
 * called from here.
 * ==================================================================== */

/** A `rowProofs` entry of a bound batch (§8.7). */
export type RowProof = {
  readonly table: CanonicalTable;
  readonly verb: 'update' | 'delete';
  readonly oldKey: Readonly<Record<string, JsonValue>>;
  readonly newKey: Readonly<Record<string, JsonValue>> | null;
  readonly preCorrectionContractSha256: string;
};

function rowProofJson(proof: RowProof): JsonValue {
  return {
    table: proof.table, verb: proof.verb, oldKey: proof.oldKey, newKey: proof.newKey,
    preCorrectionContractSha256: proof.preCorrectionContractSha256,
  };
}

/** A MOVE's new key k′: the old key with `player_id := P′`, built per table so it is a real
 * JSON object, never a union carrying `undefined` members. */
function movedNaturalKey(row: Pick<BuiltRow, 'table' | 'naturalKey'>, pPrimeId: number): Record<string, JsonValue> {
  if (row.table === 'player_match_stats') return { player_id: pPrimeId, match_id: row.naturalKey.match_id };
  return { season: row.naturalKey.season, player_id: pPrimeId, round_number: row.naturalKey.round_number };
}

/** `CD_M` as the typed projections key it: the first component of a `player_match_stats` stamp,
 * or a Brownlow application's whole `external_record_id` (it cites `CD_M`'s record). */
export function providerMatchIdOf(table: CanonicalTable, externalRecordId: string): string {
  return table === 'player_match_stats' ? (externalRecordId.split('|')[0] ?? '') : externalRecordId;
}

function describeStop(s: OutcomeStop): string {
  return `${s.table}${s.rowId !== null ? `#${s.rowId}` : ''} [${s.step}] ${s.code}${s.detail ? `: ${s.detail}` : ''}`;
}

function toInt(value: JsonValue | undefined): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?[0-9]+$/.test(value)) return Number(value);
  return null;
}

function sameJson(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  return canonicalJson(a ?? null) === canonicalJson(b ?? null);
}

function contractFieldsOf(table: CanonicalTable): readonly string[] {
  return table === 'player_match_stats' ? PLAYER_MATCH_STATS_CONTRACT_FIELDS : BROWNLOW_ROUND_VOTES_CONTRACT_FIELDS;
}

/** The non-`player_id` natural-key components L3 compares (§5.6). */
function keyComponents(table: CanonicalTable, key: Readonly<Record<string, JsonValue>>): JsonValue {
  return table === 'player_match_stats'
    ? { match_id: key.match_id ?? null }
    : { season: key.season ?? null, round_number: key.round_number ?? null };
}

export function naturalKeyString(table: CanonicalTable, key: Readonly<Record<string, JsonValue>>): string {
  return `${table}:${canonicalJson(key)}`;
}

/** An application as Q2 sees it: its row, its table and, for Brownlow only, CD_I's voter proof in
 * the payload it cites (null for `player_match_stats`). */
export type Q2Application = CanonicalApplicationRow & {
  readonly targetTable: string;
  readonly voterProof: CitedPayloadVoterProof | null;
};

/** A `data_edits` row that may explain a post-correction divergence (§5.12's writer table). */
export type PostCorrectionAudit = {
  readonly id: string;
  readonly tableName: string;
  readonly rowId: number;
  readonly fieldGroup: string;
  readonly revision: number | null;
  /** `created_at >= c.applied_at` (§5.6 "Audit time ordering"), decided in SQL. */
  readonly afterCorrection: boolean;
};

export type Q2BatchRow = {
  readonly id: number;
  readonly sourceKey: string;
  readonly tool: string;
  readonly targetTable: string;
  readonly status: string;
  readonly validationResult: unknown;
};

export type Q2CurrentRow = { readonly row: Readonly<Record<string, JsonValue>>; readonly ownerKey: string | null };

/**
 * Everything Q2 reads, and nothing else: there is no write method. A re-run on a `CORRECTED`
 * provider is handed only this, so it cannot open a batch, append a ledger row or touch a row.
 */
export type CorrectionSatisfactionReader = {
  readonly aflApiSourceId: () => Promise<number>;
  readonly identityRow: (providerId: string) => Promise<ExistingIdentityRow | null>;
  readonly ledgerRows: (providerId: string) => Promise<readonly LedgerRow[]>;
  /** A stable identity string -> exactly one player, or null (unresolvable or ambiguous). */
  readonly resolvePlayerIdentity: (identity: string) => Promise<number | null>;
  /** Every `correct_afl_api_identity` batch whose `validation_result` names this adjudication. */
  readonly batchesClaimingAdjudication: (adjudicationId: number) => Promise<readonly Q2BatchRow[]>;
  readonly batchApplications: (batchId: number, providerId: string) => Promise<readonly Q2Application[]>;
  /** Every application at `(table, key)`, any source, id-ascending. */
  readonly applicationsAt: (
    table: CanonicalTable, key: Readonly<Record<string, JsonValue>>, providerId: string,
  ) => Promise<readonly Q2Application[]>;
  readonly currentRowAt: (table: CanonicalTable, key: Readonly<Record<string, JsonValue>>) => Promise<Q2CurrentRow | null>;
  /** The typed projection's player for `(CD_M, CD_I)`: null when absent, -1 when rows disagree. */
  readonly projectionPlayer: (table: CanonicalTable, providerMatchId: string, providerId: string) => Promise<number | null>;
  readonly matchExists: (matchId: number) => Promise<boolean>;
  readonly auditsFor: (matchIds: readonly number[], correctionApplicationId: number) => Promise<readonly PostCorrectionAudit[]>;
  /** SAT-5: natural keys (`naturalKeyString`) of rows at `playerId` attributed through CD_I. */
  readonly attributedKeysAtPlayer: (providerId: string, playerId: number) => Promise<readonly string[]>;
  /** SAT-1: the whole-table facts of the ISSUE-235/237 combined invariant (`assertAflApiIdentityInvariant`'s reads). */
  readonly identityInvariantFacts: () => Promise<IdentityInvariantFacts>;
  /** SAT-5: EVERY typed projection row of `providerId`, in both AFL API projection tables. */
  readonly providerProjections: (providerId: string) => Promise<readonly ProviderProjectionRow[]>;
};

/** SAT-1's extended bijection (§5.12, §8.6): exactly what `checkAflApiIdentityInvariant` evaluates. */
export type IdentityInvariantFacts = {
  readonly censusRows: readonly AflApiCensusRow[];
  readonly ledgerRows: readonly AflApiAdjudicationLedgerRow[];
  readonly identityByPlayerId: ReadonlyMap<number, AflApiForwardIdentityResult>;
};

/** One typed projection row of CD_I: `staging.afl_api_player_match` or `staging.afl_api_brownlow_vote`. */
export type ProviderProjectionRow = {
  readonly table: CanonicalTable;
  readonly providerMatchId: string;
  /** NULL only in `staging.afl_api_brownlow_vote`, whose resolution is Option-B nullable (migration 103). */
  readonly playerId: number | null;
};

export type Q2MoveEvidence = {
  readonly batchId: number;
  readonly proof: RowProof;
  /** k′ with `player_id := P` (L3). */
  readonly derivedOldKey: Readonly<Record<string, JsonValue>>;
  readonly newKeyHistory: readonly Q2Application[];
  readonly oldKeyHistory: readonly Q2Application[];
  /** L8-a: the row at k′ today, or null. */
  readonly current: Q2CurrentRow | null;
  /** A row exists at the vacated old key today (`post_correction_reappearance` reporting). */
  readonly rowAtOldKey: boolean;
  readonly projectionPlayerId: number | null;
  /** `player_match_stats` only: does `matches` still hold M? */
  readonly matchStillExists: boolean;
  readonly audits: readonly PostCorrectionAudit[];
};

export type Q2DeleteEvidence = {
  readonly batchId: number;
  readonly proof: RowProof;
  readonly oldKeyHistory: readonly Q2Application[];
  readonly projectionPlayerId: number | null;
};

export type CorrectionSatisfactionEvidence = {
  readonly providerId: string;
  readonly adjudicationId: number;
  /** K, when this is the in-transaction post-write re-plan (§8.4); null on a re-run. */
  readonly currentBatchId: number | null;
  readonly aflApiSourceId: number;
  readonly identityRow: ExistingIdentityRow | null;
  readonly ledgerRows: readonly LedgerRow[];
  /** A.previous_player_identity (P) and A.player_identity (P′), each resolved to exactly one player. */
  readonly previousPlayerId: number | null;
  readonly correctedPlayerId: number | null;
  readonly batches: readonly (Q2BatchRow & { readonly applications: readonly Q2Application[] })[];
  readonly moves: readonly Q2MoveEvidence[];
  readonly deletes: readonly Q2DeleteEvidence[];
  /** SAT-5: rows still at P attributed through CD_I. */
  readonly attributedKeysAtP: readonly string[];
  /** SAT-1: the extended-bijection facts. */
  readonly identityInvariant: IdentityInvariantFacts;
  /** SAT-5: every typed projection row of CD_I, attached to a bound row or not. */
  readonly providerProjections: readonly ProviderProjectionRow[];
};

export type CorrectionSatisfactionResult = {
  readonly satisfied: boolean;
  readonly stops: readonly OutcomeStop[];
  readonly reports: readonly string[];
  readonly correctedPlayerId: number | null;
};

/** Parse a bound batch's `rowProofs` (§8.7). Null when missing or malformed. */
export function parseRowProofs(validationResult: unknown): RowProof[] | null {
  if (!isPlainObject(validationResult) || !Array.isArray(validationResult.rowProofs)) return null;
  const out: RowProof[] = [];
  for (const raw of validationResult.rowProofs) {
    if (!isPlainObject(raw)) return null;
    const { table, verb, oldKey, newKey, preCorrectionContractSha256 } = raw;
    if (table !== 'player_match_stats' && table !== 'brownlow_round_votes') return null;
    if (verb !== 'update' && verb !== 'delete') return null;
    if (!isPlainObject(oldKey) || typeof preCorrectionContractSha256 !== 'string') return null;
    if (verb === 'update' ? !isPlainObject(newKey) : newKey !== null) return null;
    out.push({
      table, verb, oldKey: oldKey as Record<string, JsonValue>,
      newKey: verb === 'update' ? newKey as Record<string, JsonValue> : null,
      preCorrectionContractSha256,
    });
  }
  return out;
}

/** §10 M1's chain rule for A (SAT-1): a human-origin A supersedes the `linked` row that was the
 * net state immediately before it; an importer-origin A supersedes nothing. */
export function correctionLedgerChainValid(rows: readonly LedgerRow[], adjudication: LedgerRow): boolean {
  const prior = rows.filter((r) => r.id < adjudication.id);
  const priorNet = prior.length > 0 ? prior[prior.length - 1] : null;
  if (priorNet?.action === 'corrected') return false;
  if (priorNet?.action === 'linked') return adjudication.supersedesId === priorNet.id;
  return adjudication.supersedesId === null;
}

/** §5.6 "Bound correction batch", every field except `status` (the planner's SAT-2 owns that).
 * Returns the reason a claiming batch is NOT bound, or null when it is. */
function correctionBatchBindingProblem(
  batch: Q2BatchRow, adjudication: LedgerRow, providerId: string,
): string | null {
  const v = isPlainObject(batch.validationResult) ? batch.validationResult : null;
  if (v === null) return 'validation_result is missing';
  const bound = isBatchBoundToAdjudication({
    sourceId: batch.sourceKey, tool: batch.tool, targetTable: batch.targetTable,
    status: 'completed', // status is judged by evaluateCorrectionSatisfaction's SAT-2, not here
    adjudicationId: typeof v.adjudicationId === 'number' ? v.adjudicationId : -1,
    externalId: String(v.externalId), adjudicationEvidenceSha256: String(v.adjudicationEvidenceSha256),
  }, adjudication.id);
  if (!bound) return 'source, tool, target table or adjudicationId does not bind it to A';
  if (v.kind !== 'afl_api_identity_correction') return `kind is ${String(v.kind)}`;
  if (v.mode !== 'original' && v.mode !== 'replay') return `mode is ${String(v.mode)}`;
  if (v.externalId !== providerId) return `externalId is ${String(v.externalId)}`;
  if (v.adjudicationEvidenceSha256 !== adjudication.evidenceSha256) return 'adjudicationEvidenceSha256 differs from A.evidence_sha256';
  if (typeof v.closureFingerprint !== 'string' || v.closureFingerprint === '') return 'closureFingerprint is missing';
  if (typeof v.plannerVersion !== 'number') return 'plannerVersion is missing';
  return null;
}

/** SAT-2's `rowProofs` coverage: exactly one proof per bound MOVE/DELETE application, and no other. */
function rowProofCoverageProblems(
  proofs: readonly RowProof[], applications: readonly Q2Application[],
): { readonly code: StopCode; readonly detail: string }[] {
  const problems: { code: StopCode; detail: string }[] = [];
  const matchesProof = (app: Q2Application, proof: RowProof) => proof.table === app.targetTable && (
    (proof.verb === 'update' && app.verb === 'update' && proof.newKey !== null && sameJson(proof.newKey, app.targetKey))
    || (proof.verb === 'delete' && app.verb === 'delete' && sameJson(proof.oldKey, app.targetKey)));
  for (const app of applications) {
    if (app.sourceId !== AFL_API_SOURCE_KEY || app.verb === 'insert') {
      problems.push({ code: 'correction_not_bound', detail: `bound application ${app.id} is not an afl_api update/delete` });
    } else if (!proofs.some((p) => matchesProof(app, p))) {
      problems.push({ code: 'correction_not_bound', detail: `rowProofs omits bound application ${app.id}` });
    }
  }
  for (const proof of proofs) {
    const n = applications.filter((app) => matchesProof(app, proof)).length;
    if (n === 0) problems.push({ code: 'correction_not_bound', detail: `a ${proof.verb} rowProof for ${proof.table} has no bound application` });
    if (n > 1) problems.push({ code: 'ambiguous_correction', detail: `a ${proof.verb} rowProof for ${proof.table} matches ${n} bound applications` });
  }
  return problems;
}

function toChainApplication(app: Q2Application): BrownlowChainApplication {
  return {
    ...toApplication(app),
    citedPayloadVoterCountForCdI: app.voterProof?.count ?? -1,
    citedPayloadVoteForCdI: app.voterProof?.vote ?? null,
  };
}

/**
 * The attribution predicates re-run over an immutable old-key history H (§5.6 L5, D-5):
 * P3/P4 plus P2's `CD_I` stamp for `player_match_stats`; B2, B3-I, B3-C and B4 for Brownlow.
 * P1/B1 and the row stamps are CURRENT-row facts (L8-b/L8-b′), so they are not asked of H; the
 * planner's evaluators are given H's own latest stamp as the "row" for that reason.
 */
function attributionOverHistory(
  table: CanonicalTable, history: readonly Q2Application[], providerId: string,
  attributedPlayerId: number, projectionPlayerId: number | null,
): AttributionResult {
  if (history.length === 0) return { ok: true }; // emptiness is L5's own "non-empty" check
  const latest = history[history.length - 1];
  if (table === 'player_match_stats') {
    const attribution = evaluatePlayerMatchStatsAttribution({
      sourceId: AFL_API_SOURCE_KEY,
      sourceRecordId: latest.externalRecordId,
      importBatchId: latest.importBatchId,
      applications: history.map(toApplication),
      projectionPlayerId: null, // the projection is L8-c's current-row check
      currentPlayerId: attributedPlayerId,
      current: {},
      expectedSourceRecordId: expectedPlayerMatchStatsStamp(latest.externalRecordId, providerId),
      expectedImportBatchId: latest.importBatchId,
    });
    if (!attribution.ok) return attribution;
    if (!playerMatchStatsHistoryThroughProvider(history, providerId)) {
      return { ok: false, stop: { step: 'P3', code: 'mixed_provider_application_history', detail: `an application in H is not through ${providerId}` } };
    }
    return attribution;
  }
  const insert = history[0];
  if (history.some((a) => a.sourceId !== AFL_API_SOURCE_KEY || a.externalRecordId !== insert.externalRecordId)) {
    return { ok: false, stop: { step: 'B2', code: 'mixed_provider_application_history', detail: 'an application in H is not afl_api or cites another record' } };
  }
  return evaluateBrownlowAttribution({
    sourceId: AFL_API_SOURCE_KEY,
    sourceRecordId: insert.externalRecordId,
    expectedSourceRecordId: insert.externalRecordId,
    importBatchId: latest.importBatchId,
    expectedImportBatchId: latest.importBatchId,
    insertApplication: toApplication(insert),
    insertProvenByPayload: insert.voterProof !== null && brownlowInsertProvenByPayload(insert.voterProof, insert.newValues),
    projectionPlayerId,
    currentPlayerId: attributedPlayerId,
    chain: history.slice(1).map(toChainApplication),
    // B4 over H (§5.6 L5) is the IMMUTABLE half of Q1's B4 evidence: another voter's positive vote
    // written at this key. Q1's typed-projection and live-identity halves are current state, which
    // a later legitimate link of another provider to P may change after the correction; Q2 never
    // re-reads current state as attribution (§5.12).
    anotherProviderAlsoResolved: brownlowHistoryShowsAnotherVoter(history),
    current: { played: null, votes: null, matchId: null }, // B5 only; never read by attribution
  });
}

/** Fail-closed "could this application have been written through CD_I?" for SAT-5 (an old key
 * after the correction) and D-6. An unparseable Brownlow payload counts as "yes". */
function applicationMayBeThroughProvider(table: CanonicalTable, app: Q2Application, providerId: string): boolean {
  if (app.sourceId !== AFL_API_SOURCE_KEY) return false;
  if (table === 'player_match_stats') return app.externalRecordId.endsWith(`|${providerId}`);
  const proof = app.voterProof;
  if (proof === null || proof.count < 0) return true;
  if (proof.count === 0) return false;
  // Positive per-match votes are 3/2/1 to distinct players, so a votes value that differs from
  // CD_I's own entry belongs to another voter in the same payload.
  return !('votes' in app.newValues) || proof.count !== 1 || proof.vote === app.newValues.votes;
}

/** L7: every application at k′ after c is afl_api and through CD_I (§5.6). */
function postCorrectionHistoryThroughProvider(
  table: CanonicalTable, later: readonly Q2Application[], c: Q2Application, providerId: string,
  votesAfterCorrection: JsonValue,
): boolean {
  if (later.some((a) => a.sourceId !== AFL_API_SOURCE_KEY)) return false;
  if (table === 'player_match_stats') return later.every((a) => a.externalRecordId.endsWith(`|${providerId}`));
  if (later.some((a) => a.externalRecordId !== c.externalRecordId)) return false;
  return classifyBrownlowChain(later.map(toChainApplication), votesAfterCorrection).ok;
}

const FINAL_BROWNLOW_FIELD_GROUPS = new Set(['finalise', 'correct', 'void']);
/** `match-sheet.ts:123-135`, as §5.12's writer table lists it. */
const MATCH_SHEET_FIELDS = new Set([
  'club_id', 'jumper_number', 'goals', 'behinds', 'kicks', 'handballs', 'disposals', 'marks',
  'tackles', 'hitouts', 'frees_for', 'frees_against',
]);

/**
 * The recognised post-correction writer (§5.12's table) that explains one L8-d divergence, or
 * undefined. A `field_group = 'draft'` audit explains nothing (R238-P5-01), and a Brownlow-admin
 * explanation on a still-`afl_api` round row covers only `match_id: NULL -> m`; `evaluateL8`
 * re-asserts that last restriction itself.
 */
export function explainPostCorrectionDivergence(
  table: CanonicalTable, divergence: FieldDivergence, context: {
    readonly matchId: number | null;
    readonly stillAflApiOwned: boolean;
    readonly reownershipAuditId: string | null;
    readonly audits: readonly PostCorrectionAudit[];
  },
): PostCorrectionExplanation | undefined {
  const after = context.audits.filter((a) => a.afterCorrection);
  const finalBrownlowAudit = (m: number) => after.find((a) => (
    a.tableName === 'brownlow_vote_entry_state' && a.rowId === m && FINAL_BROWNLOW_FIELD_GROUPS.has(a.fieldGroup)));
  const { field } = divergence;
  if (table === 'player_match_stats') {
    if (context.matchId === null) return undefined;
    if (MATCH_SHEET_FIELDS.has(field)) {
      const audit = after.find((a) => a.tableName === 'matches' && a.rowId === context.matchId && a.fieldGroup === 'match_sheet');
      if (audit) return { field, writer: 'match_sheet', auditId: audit.id };
    }
    if (field === 'brownlow_votes') {
      const audit = finalBrownlowAudit(context.matchId);
      if (audit) return { field, writer: 'brownlow_admin', auditId: audit.id };
    }
    return undefined;
  }
  if (context.reownershipAuditId !== null && (field === 'votes' || field === 'played' || field === 'match_id')) {
    return { field, writer: 'brownlow_admin_reowned', auditId: context.reownershipAuditId };
  }
  if (field === 'match_id') {
    const reconstructed = toInt(divergence.reconstructed);
    const current = toInt(divergence.current);
    if (context.stillAflApiOwned && divergence.reconstructed === null && current !== null) {
      const audit = finalBrownlowAudit(current);
      if (audit) return { field, writer: 'brownlow_admin', auditId: audit.id };
    }
    if (divergence.current === null && reconstructed !== null) {
      const audit = after.find((a) => a.tableName === 'matches' && a.rowId === reconstructed && a.fieldGroup === 'match_deletion');
      if (audit) return { field, writer: 'match_deleted', auditId: audit.id };
    }
  }
  return undefined;
}

/**
 * L8-d's post-correction automatic state (§5.6): H's reconstruction, then c (a `player_id` change
 * only, which is no contract field), then each L7 application in id order. An L7 application whose
 * `previous_values` disagrees with the running state is itself a divergence; the state is then
 * re-seeded from those `previous_values` and continues. Every divergence, mid-chain and final, is
 * returned for explanation.
 */
export function postCorrectionDivergences(
  table: CanonicalTable, preCorrection: readonly Application[], later: readonly Application[],
  current: Readonly<Record<string, JsonValue>>,
): FieldDivergence[] {
  const fields = contractFieldsOf(table);
  const state: Record<string, JsonValue> = { ...reconstructContract(fields, preCorrection).fields };
  const divergences: FieldDivergence[] = [];
  for (const app of later) {
    if (app.previousValues) {
      for (const field of fields) {
        if (field in app.previousValues && !sameJson(app.previousValues[field], state[field])) {
          divergences.push({ field, reconstructed: state[field] ?? null, current: app.previousValues[field] });
          state[field] = app.previousValues[field];
        }
      }
    }
    for (const field of fields) {
      if (field in app.newValues) state[field] = app.newValues[field];
    }
  }
  const finalState = { fields: state, chainConsistent: true, chainBreak: null };
  divergences.push(...compareReconstruction(finalState, current, fields));
  return divergences;
}

type RowVerdict = {
  readonly result: MoveLineageResult;
  readonly stopRef: { readonly table: CanonicalTable; readonly rowId: number | null };
  readonly reports: readonly string[];
  readonly laterOldKeyApplicationThroughCdI: boolean;
};

/** SAT-3 for one bound MOVE application: L1-L7, then L8 on the current row, or C14 (§5.6). */
function evaluateBoundMove(
  move: Q2MoveEvidence, context: {
    readonly providerId: string; readonly pId: number; readonly pPrimeId: number;
    readonly batchApplications: readonly Q2Application[]; readonly attributedKeysAtP: readonly string[];
  },
): RowVerdict {
  const { proof } = move;
  const table = proof.table;
  const fields = contractFieldsOf(table);
  const stopRef = { table, rowId: move.current ? toInt(move.current.row.id) : null };
  const keyLabel = canonicalJson(proof.newKey ?? {});
  const fail = (stop: Stop, reports: string[] = [], laterThroughCdI = false): RowVerdict => ({
    result: { ok: false, stop }, stopRef, reports, laterOldKeyApplicationThroughCdI: laterThroughCdI,
  });

  // L1: the EARLIEST application at k′ is c, an afl_api update in the bound batch.
  const c = move.newKeyHistory[0];
  if (!c || c.importBatchId !== move.batchId || c.sourceId !== AFL_API_SOURCE_KEY) {
    return fail({ step: 'L1', code: 'correction_not_bound', detail: `the earliest application at ${keyLabel} is not A's bound update` });
  }
  const preCorrection = move.oldKeyHistory.filter((a) => a.id < c.id);
  const later = move.newKeyHistory.filter((a) => a.id > c.id);
  const latestH = preCorrection.length > 0 ? preCorrection[preCorrection.length - 1] : null;
  const reconstruction = reconstructContract(fields, preCorrection.map(toApplication));

  const attribution = attributionOverHistory(table, preCorrection, context.providerId, context.pPrimeId, move.projectionPlayerId);
  if (!attribution.ok) return fail(attribution.stop); // L5: "or the underlying P/B reason"

  const cCitation = [c.sourceId, c.family, c.externalRecordId, c.sourceVersionSeq].join('\u0000');
  const sameVersionInBatch = context.batchApplications.filter((a) => (
    a.targetTable === table
    && [a.sourceId, a.family, a.externalRecordId, a.sourceVersionSeq].join('\u0000') === cCitation
    && sameJson(keyComponents(table, a.targetKey), keyComponents(table, c.targetKey))
  )).length;

  const lineage = evaluateMoveLineage({
    correctionApplication: { ...toApplication(c), targetKey: c.targetKey },
    boundBatchCount: move.newKeyHistory.filter((a) => a.importBatchId === move.batchId).length,
    previousPlayerId: context.pId,
    nextPlayerId: context.pPrimeId,
    // L3: k′ is c's target, k is k′ with player_id := P, and the current row (when present)
    // carries the same non-player key components.
    keyComponentsMatch: proof.newKey !== null && sameJson(c.targetKey, proof.newKey)
      && sameJson(move.derivedOldKey, proof.oldKey)
      && (move.current === null || sameJson(keyComponents(table, move.current.row), keyComponents(table, c.targetKey))),
    // L4: c cites H's latest source version; for player_match_stats that record is `…|CD_I`. An
    // empty H has no latest application to bind to: L5 (checked next) is the STOP that names it
    // (`missing_pre_correction_history`, case 49), so L4 does not pre-empt it.
    bindsToOldHistory: (latestH === null
      || [latestH.sourceId, latestH.family, latestH.externalRecordId, latestH.sourceVersionSeq].join('\u0000') === cCitation)
      && (table !== 'player_match_stats' || c.externalRecordId.endsWith(`|${context.providerId}`)),
    preCorrectionHistoryNonEmpty: preCorrection.length > 0,
    preCorrectionAttributionOk: attribution.ok,
    preCorrectionChainConsistent: reconstruction.chainConsistent,
    rowProofMatches: rowContractHash(reconstruction.fields) === proof.preCorrectionContractSha256,
    joinIsUnique: sameVersionInBatch === 1,
    postCorrectionHistoryAllThroughCdI: postCorrectionHistoryThroughProvider(
      table, later, c, context.providerId, reconstruction.fields.votes ?? null,
    ),
  });
  if (!lineage.ok) return fail(lineage.stop);

  const laterAtOldKey = move.oldKeyHistory.some((a) => a.id > c.id && applicationMayBeThroughProvider(table, a, context.providerId));
  const reports: string[] = [];
  const reappearance = detectPostCorrectionReappearance({
    rowExistsAtOldKey: move.rowAtOldKey,
    attributedThroughCdI: context.attributedKeysAtP.includes(naturalKeyString(table, move.derivedOldKey)),
  });
  if (reappearance.reappeared) {
    reports.push(`post_correction_reappearance: a new row not attributed through ${context.providerId} occupies the vacated ${table} key ${canonicalJson(move.derivedOldKey)}; not touched`);
  }

  // L8-a absent -> C14 (§5.6): satisfied only for player_match_stats with the match-deletion audit.
  if (move.current === null) {
    const matchId = table === 'player_match_stats' ? toInt(proof.newKey?.match_id) : null;
    const absent = evaluateCorrectionTargetAbsent({
      table,
      rowExists: false,
      matchDeletedAuditAfterCorrection: move.audits.some((a) => (
        a.afterCorrection && a.tableName === 'matches' && a.rowId === matchId && a.fieldGroup === 'match_deletion')),
      matchStillExists: move.matchStillExists,
    });
    if (!absent.satisfied) return fail(absent.stop!, reports, laterAtOldKey);
    reports.push(`NOOP correction_target_absent: ${table} ${keyLabel} (match ${String(matchId)} deleted after the correction, audited); lineage L1-L7 retained, never recreated`);
    return { result: { ok: true }, stopRef, reports, laterOldKeyApplicationThroughCdI: laterAtOldKey };
  }

  // L8-b / L8-b′: ownership and stamps against the latest non-correction application (H then L7).
  const row = move.current.row;
  const history = [...preCorrection, ...later]; // non-empty: L5 passed, so H is
  const latestNonCorrection = history[history.length - 1];
  const stampsMatch = toInt(row.import_batch_id) === latestNonCorrection.importBatchId;
  let ownershipAndStampsOk: boolean;
  let reownershipAuditId: string | null = null;
  let reownedByBrownlowAdmin = false;
  if (table === 'player_match_stats') {
    ownershipAndStampsOk = move.current.ownerKey === AFL_API_SOURCE_KEY
      && row.source_record_id === latestNonCorrection.externalRecordId && stampsMatch;
  } else {
    ownershipAndStampsOk = move.current.ownerKey === AFL_API_SOURCE_KEY
      && row.source_record_id === c.externalRecordId && stampsMatch;
    const entry = typeof row.source_record_id === 'string' ? /^entry:(\d+):r(\d+)$/.exec(row.source_record_id) : null;
    if (!ownershipAndStampsOk && move.current.ownerKey === 'manual_admin_edit' && entry) {
      reownedByBrownlowAdmin = true;
      const [m, n] = [Number(entry[1]), Number(entry[2])];
      reownershipAuditId = move.audits.find((a) => (
        a.afterCorrection && a.tableName === 'brownlow_vote_entry_state' && a.rowId === m && a.revision === n
        && FINAL_BROWNLOW_FIELD_GROUPS.has(a.fieldGroup)))?.id ?? null;
    }
  }

  // L8-d: every divergence from the post-correction automatic state needs a recognised writer.
  const divergences = postCorrectionDivergences(table, preCorrection.map(toApplication), later.map(toApplication), row);
  const explanationContext = {
    matchId: table === 'player_match_stats' ? toInt(proof.newKey?.match_id) : null,
    stillAflApiOwned: ownershipAndStampsOk,
    reownershipAuditId,
    audits: move.audits,
  };
  const explanations = new Map<string, PostCorrectionExplanation>();
  const unexplainedFields = new Set<string>();
  for (const divergence of divergences) {
    const explanation = explainPostCorrectionDivergence(table, divergence, explanationContext);
    if (!explanation) unexplainedFields.add(divergence.field);
    else if (!explanations.has(divergence.field)) explanations.set(divergence.field, explanation);
  }
  for (const field of unexplainedFields) explanations.delete(field); // one unexplained occurrence is enough to STOP

  const l8Evidence: L8Evidence = {
    rowExists: true,
    ownershipAndStampsOk,
    reownedByBrownlowAdmin,
    reownershipAuditOk: reownershipAuditId !== null,
    projectionOk: move.projectionPlayerId === null || move.projectionPlayerId === context.pPrimeId,
    divergences,
    explanations,
    table,
    stillAflApiOwned: ownershipAndStampsOk,
  };
  const l8 = evaluateL8(l8Evidence);
  if (!l8.ok) return fail(l8.stop, reports, laterAtOldKey);
  if (reownedByBrownlowAdmin) reports.push(`post_correction_edit brownlow_admin_reowned: ${table} ${keyLabel} (audit ${String(reownershipAuditId)})`);
  for (const edit of l8.postCorrectionEdits) {
    const divergence = divergences.find((d) => d.field === edit.field);
    reports.push(`post_correction_edit ${edit.writer}: ${table} ${keyLabel} ${edit.field} ${canonicalJson(divergence?.reconstructed ?? null)} -> ${canonicalJson(divergence?.current ?? null)} (audit ${edit.auditId})`);
  }
  reports.push(`NOOP already_corrected_moved: ${table} ${keyLabel}`);
  return { result: { ok: true }, stopRef, reports, laterOldKeyApplicationThroughCdI: laterAtOldKey };
}

/** The columns D-2 requires of a correction delete's `previous_values`: the full row as the
 * ORIGINAL transaction snapshots it (`to_jsonb(row.*)`), at least identity, ownership, key and
 * every reconstruction-contract field. */
function requiredDeleteSnapshotKeys(table: CanonicalTable): readonly string[] {
  const base = ['id', 'player_id', 'source_id', 'source_record_id', 'import_batch_id'];
  return table === 'player_match_stats'
    ? [...base, 'match_id', ...PLAYER_MATCH_STATS_CONTRACT_FIELDS]
    : [...base, 'season', 'round_number', ...BROWNLOW_ROUND_VOTES_CONTRACT_FIELDS];
}

/** SAT-4 for one bound DELETE application: D-1...D-6, from immutable history only (§5.6). */
function evaluateBoundDelete(
  del: Q2DeleteEvidence, context: { readonly providerId: string; readonly pId: number; readonly aflApiSourceId: number },
): RowVerdict {
  const { proof } = del;
  const table = proof.table;
  const fields = contractFieldsOf(table);
  const stopRef = { table, rowId: null };
  const fail = (stop: Stop): RowVerdict => ({ result: { ok: false, stop }, stopRef, reports: [], laterOldKeyApplicationThroughCdI: false });

  const bound = del.oldKeyHistory.filter((a) => a.verb === 'delete' && a.importBatchId === del.batchId);
  const d = bound[0];
  if (!d) return fail({ step: 'D-1', code: 'correction_not_bound', detail: `no bound delete application at ${canonicalJson(proof.oldKey)}` });
  const preCorrection = del.oldKeyHistory.filter((a) => a.id < d.id);
  const later = del.oldKeyHistory.filter((a) => a.id > d.id);
  const latestH = preCorrection.length > 0 ? preCorrection[preCorrection.length - 1] : null;
  const previous: Record<string, JsonValue> = d.previousValues ?? {};

  const attribution = attributionOverHistory(table, preCorrection, context.providerId, context.pId, del.projectionPlayerId);
  if (!attribution.ok) return fail(attribution.stop); // D-5 "satisfies L5"
  // D-3's stamp half, which the planner's evidence has no field for; its D-3 code is row_proof_mismatch.
  if (latestH !== null && (previous.source_record_id !== latestH.externalRecordId || toInt(previous.import_batch_id) !== latestH.importBatchId)) {
    return fail({ step: 'D-3', code: 'row_proof_mismatch', detail: 'previous_values stamps are not the P2 stamp of H\'s latest application' });
  }
  const reconstruction = reconstructContract(fields, preCorrection.map(toApplication));
  const citesLatest = latestH !== null
    && [latestH.sourceId, latestH.family, latestH.externalRecordId, latestH.sourceVersionSeq].join('\u0000')
      === [d.sourceId, d.family, d.externalRecordId, d.sourceVersionSeq].join('\u0000');

  const lineage = evaluateDeleteLineage({
    deleteApplication: toApplication(d),
    boundBatchCount: bound.length,
    previousPlayerId: context.pId,
    keyComponentsMatch: sameJson(d.targetKey, proof.oldKey) && toInt(proof.oldKey.player_id) === context.pId,
    previousValuesContractComplete: d.previousValues !== null
      && requiredDeleteSnapshotKeys(table).every((key) => key in previous)
      && Object.keys(d.newValues).length === 0,
    previousValuesSourceIdIsAflApi: toInt(previous.source_id) === context.aflApiSourceId,
    previousValuesBrownlowVotesIsNull: table === 'player_match_stats' ? (previous.brownlow_votes ?? null) === null : null,
    preCorrectionHistoryNonEmpty: preCorrection.length > 0,
    reconstructionMatchesPreviousValues: reconstruction.chainConsistent && citesLatest
      && sameJson(reconstruction.fields, projectContract(previous, fields))
      && rowContractHash(reconstruction.fields) === proof.preCorrectionContractSha256,
    noConflictingLaterHistory: !later.some((a) => applicationMayBeThroughProvider(table, a, context.providerId))
      && (later.length === 0 || later[0].verb === 'insert'),
  });
  if (!lineage.ok) return fail(lineage.stop);
  return { result: { ok: true }, stopRef, reports: [`NOOP already_corrected_deleted: ${table} ${canonicalJson(proof.oldKey)}`], laterOldKeyApplicationThroughCdI: false };
}

/**
 * SAT-1's "the extended bijection holds (§8.6)" -- identity authority, never inferred from L8's
 * row lineage. It is the shared ISSUE-235/237 combined invariant, `checkAflApiIdentityInvariant`,
 * unchanged: the D5 census, the D15 bijection (net `linked` OR `corrected` <-> exactly one
 * `resolved`/`afl_api_admin_adjudication` row), one `afl_api` row per player, and D7's forward
 * identity for every importer row (whose one permitted alias, an exact tracked
 * `profile_url_continuity` pair, is decided by that shared classifier, not here). Like
 * `assertAflApiIdentityInvariant` it is whole-table: an unrelated invariant breach also fails
 * SAT-1, deliberately (fail closed).
 *
 * The shared bijection pairs ledger and identity rows by `external_id` only. §8.6's "at its
 * `player_identity`" clause is added for P′ alone: no OTHER net `linked`/`corrected` provider may
 * name P′ (by stable identity or player id), because its resolved row would then collide with
 * CD_I's at P′ (`uq_external_identities_afl_api_player`, D8). A malformed ledger throws
 * `AflApiLedgerMalformed` from the shared net-state reader: never read as "no problem".
 */
export function sat1ExtendedBijectionProblems(input: {
  readonly facts: IdentityInvariantFacts;
  readonly providerId: string;
  readonly pPrimeId: number;
  readonly pPrimeIdentity: string;
}): string[] {
  const { facts } = input;
  const problems = checkAflApiIdentityInvariant({
    rows: facts.censusRows, ledgerRows: facts.ledgerRows, identityByPlayerId: facts.identityByPlayerId,
  }).map((p): string => JSON.stringify(p));
  for (const [externalId, row] of netLedgerRowsByExternalId(facts.ledgerRows)) {
    if (externalId === input.providerId || !aflApiNetIsHumanLive(row.action)) continue;
    if (row.playerIdentity === input.pPrimeIdentity || Number(row.playerId) === input.pPrimeId) {
      problems.push(`${externalId} is net ${row.action} to P′ (${row.playerIdentity}), colliding with ${input.providerId}`);
    }
  }
  return problems;
}

/**
 * SAT-5 (§5.12), "no typed projection ... names P for CD_I", over EVERY projection row of CD_I in
 * both typed tables (not only the one attached to a bound MOVE, which L8-c already checks):
 *   - a row naming P is a contradiction;
 *   - a row naming a third player (neither P nor P′) contradicts the corrected identity;
 *   - one `(table, CD_M)` whose rows disagree is a conflicting result.
 * Absence is not success or failure here: P5/L8-c's own rule (absence is not a failure, §2.4)
 * governs a bound row's projection, and a NULL Brownlow `player_id` names no one (Option B).
 */
export function sat5ProjectionContradictions(
  rows: readonly ProviderProjectionRow[], pId: number, pPrimeId: number,
): string[] {
  const problems: string[] = [];
  const byMatch = new Map<string, Set<number | null>>();
  for (const row of rows) {
    const label = `${row.table} projection (${row.providerMatchId})`;
    if (row.playerId === pId) problems.push(`${label} still names P (player ${pId})`);
    else if (row.playerId !== null && row.playerId !== pPrimeId) problems.push(`${label} names player ${row.playerId}, neither P nor P′`);
    const key = `${row.table}\u0000${row.providerMatchId}`;
    if (!byMatch.has(key)) byMatch.set(key, new Set());
    byMatch.get(key)!.add(row.playerId);
  }
  for (const [key, players] of byMatch) {
    if (players.size > 1) {
      problems.push(`conflicting ${key.replace('\u0000', ' projections for ')}: players ${[...players].map(String).join(', ')}`);
    }
  }
  return problems;
}

/**
 * CORRECTION SATISFACTION (§5.12 Q2), SAT-1...SAT-5. Pure: every fact is in `evidence`. Returns
 * `satisfied` only when no SAT check and no bound row fails; otherwise every failed condition is
 * named. Used, unchanged, by the post-write re-plan and by every re-run.
 */
export function evaluateCorrectionSatisfactionQ2(evidence: CorrectionSatisfactionEvidence): CorrectionSatisfactionResult {
  const reports: string[] = [];
  const satStop = (step: string, code: StopCode, detail: string): OutcomeStop => ({ table: 'player_match_stats', rowId: null, step, code, detail });
  const failed = (stops: OutcomeStop[]): CorrectionSatisfactionResult => ({ satisfied: false, stops, reports, correctedPlayerId: evidence.correctedPlayerId });

  // SAT-1: the authority A and its two identities.
  const adjudication = evidence.ledgerRows.find((r) => r.id === evidence.adjudicationId) ?? null;
  if (adjudication === null || adjudication.action !== 'corrected') {
    return failed([satStop('SAT-1', 'authority_invalid', `ledger row ${evidence.adjudicationId} is not a corrected adjudication for ${evidence.providerId}`)]);
  }
  const pId = evidence.previousPlayerId;
  const pPrimeId = evidence.correctedPlayerId;
  if (pId === null || pPrimeId === null || pId === pPrimeId) {
    return failed([satStop('SAT-1', 'identity_unresolvable', 'A.previous_player_identity and A.player_identity must each resolve to exactly one, distinct, player')]);
  }
  const identityResolvedToPPrime = evidence.identityRow !== null
    && evidence.identityRow.status === 'resolved'
    && evidence.identityRow.playerId === pPrimeId
    && evidence.identityRow.matchMethod === AFL_API_ADMIN_MATCH_METHOD
    && adjudication.playerId === pPrimeId;
  const net = netLedgerAction(evidence.ledgerRows);

  // SAT-1's extended bijection (§8.6): identity authority, independent of L8's row lineage.
  const preStops: OutcomeStop[] = [];
  for (const problem of sat1ExtendedBijectionProblems({
    facts: evidence.identityInvariant, providerId: evidence.providerId, pPrimeId, pPrimeIdentity: adjudication.playerIdentity,
  })) {
    preStops.push(satStop('SAT-1', 'identity_contradicts', `extended bijection: ${problem}`));
  }

  // SAT-2: at most one bound batch; each claiming batch fully bound; rowProofs cover it exactly.
  for (const batch of evidence.batches) {
    const problem = correctionBatchBindingProblem(batch, adjudication, evidence.providerId);
    if (problem) {
      preStops.push(satStop('SAT-2', 'correction_not_bound', `batch ${batch.id}: ${problem}`));
      continue;
    }
    const proofs = parseRowProofs(batch.validationResult);
    if (proofs === null) {
      preStops.push(satStop('SAT-2', 'correction_not_bound', `batch ${batch.id}: rowProofs is missing or malformed`));
      continue;
    }
    for (const p of rowProofCoverageProblems(proofs, batch.applications)) preStops.push(satStop('SAT-2', p.code, `batch ${batch.id}: ${p.detail}`));
  }

  // SAT-3 / SAT-4: every bound MOVE and DELETE.
  const rowStops: OutcomeStop[] = [];
  const moveResults: MoveLineageResult[] = [];
  const deleteResults: MoveLineageResult[] = [];
  let laterApplicationAtOldKeyThroughCdI = false;
  for (const move of evidence.moves) {
    const batch = evidence.batches.find((b) => b.id === move.batchId);
    const verdict = evaluateBoundMove(move, {
      providerId: evidence.providerId, pId, pPrimeId,
      batchApplications: batch?.applications ?? [], attributedKeysAtP: evidence.attributedKeysAtP,
    });
    moveResults.push(verdict.result);
    reports.push(...verdict.reports);
    laterApplicationAtOldKeyThroughCdI ||= verdict.laterOldKeyApplicationThroughCdI;
    if (!verdict.result.ok) rowStops.push({ ...verdict.stopRef, ...verdict.result.stop });
  }
  for (const del of evidence.deletes) {
    const verdict = evaluateBoundDelete(del, { providerId: evidence.providerId, pId, aflApiSourceId: evidence.aflApiSourceId });
    deleteResults.push(verdict.result);
    reports.push(...verdict.reports);
    if (!verdict.result.ok) rowStops.push({ ...verdict.stopRef, ...verdict.result.stop });
  }

  const satisfactionEvidence: SatisfactionEvidence = {
    identityResolvedToPPrime,
    ledgerNetStateIsCorrected: net !== null && net.id === adjudication.id,
    ledgerChainValid: correctionLedgerChainValid(evidence.ledgerRows, adjudication),
    boundBatchCount: evidence.batches.length,
    boundBatchIsCompletedOrCurrent: evidence.batches.every((b) => b.status === 'completed' || b.id === evidence.currentBatchId),
    moveLineageResults: moveResults,
    deleteLineageResults: deleteResults,
    unmovedClosureRowAtP: evidence.attributedKeysAtP.length > 0,
    laterApplicationAtOldKeyThroughCdI,
    secondCorrectedRowForExternalId: evidence.ledgerRows.filter((r) => r.action === 'corrected').length > 1,
  };
  const satisfaction = evaluateCorrectionSatisfaction(satisfactionEvidence);

  const stops: OutcomeStop[] = [...preStops];
  if (!satisfaction.satisfied) {
    const s = satisfaction.stop;
    const isRowStop = rowStops.some((r) => r.step === s.step && r.code === s.code && r.detail === s.detail);
    if (!isRowStop) {
      const detail = s.code === 'unmoved_closure_row' ? `${s.detail}: ${evidence.attributedKeysAtP.join(', ')}` : s.detail;
      stops.push(satStop(s.step, s.code, detail));
    }
  }
  // SAT-5, "no typed projection ... names P for CD_I": every projection row of CD_I, including a
  // stray one attached to no bound row, which L8-c (per bound MOVE) never sees.
  for (const problem of sat5ProjectionContradictions(evidence.providerProjections, pId, pPrimeId)) {
    stops.push(satStop('SAT-5', 'identity_contradicts', problem));
  }
  stops.push(...rowStops);
  if (stops.length > 0) return failed(stops);

  reports.push('CORRECTION SATISFACTION: SAT-1..SAT-5 PASS');
  return { satisfied: true, stops: [], reports, correctedPlayerId: pPrimeId };
}

/** The match ids whose `data_edits` audits can explain a post-correction divergence at k′. */
function auditMatchIds(
  table: CanonicalTable, newKey: Readonly<Record<string, JsonValue>>, current: Q2CurrentRow | null,
  histories: readonly (readonly Q2Application[])[],
): number[] {
  const ids = new Set<number>();
  const add = (v: JsonValue | undefined) => {
    const n = toInt(v);
    if (n !== null && n > 0) ids.add(n);
  };
  if (table === 'player_match_stats') {
    add(newKey.match_id);
  } else {
    add(current?.row.match_id);
    const entry = typeof current?.row.source_record_id === 'string' ? /^entry:(\d+):r\d+$/.exec(current.row.source_record_id) : null;
    if (entry) add(Number(entry[1]));
    for (const history of histories) {
      for (const app of history) {
        add(app.newValues.match_id);
        add(app.previousValues?.match_id);
      }
    }
  }
  return [...ids];
}

/** Gather everything `evaluateCorrectionSatisfactionQ2` needs, through the read-only reader. */
export async function gatherCorrectionSatisfactionEvidence(
  reader: CorrectionSatisfactionReader,
  input: { readonly providerId: string; readonly adjudicationId: number; readonly currentBatchId: number | null },
): Promise<CorrectionSatisfactionEvidence> {
  const { providerId, adjudicationId, currentBatchId } = input;
  const aflApiSourceId = await reader.aflApiSourceId();
  const identityRow = await reader.identityRow(providerId);
  const ledgerRows = await reader.ledgerRows(providerId);
  const adjudication = ledgerRows.find((r) => r.id === adjudicationId) ?? null;
  const previousPlayerId = adjudication?.previousPlayerIdentity
    ? await reader.resolvePlayerIdentity(adjudication.previousPlayerIdentity) : null;
  const correctedPlayerId = adjudication ? await reader.resolvePlayerIdentity(adjudication.playerIdentity) : null;

  const batches: (Q2BatchRow & { applications: readonly Q2Application[] })[] = [];
  for (const batch of await reader.batchesClaimingAdjudication(adjudicationId)) {
    batches.push({ ...batch, applications: await reader.batchApplications(batch.id, providerId) });
  }

  const moves: Q2MoveEvidence[] = [];
  const deletes: Q2DeleteEvidence[] = [];
  if (previousPlayerId !== null && correctedPlayerId !== null) {
    for (const batch of batches) {
      for (const proof of parseRowProofs(batch.validationResult) ?? []) {
        if (proof.verb === 'update' && proof.newKey !== null) {
          const derivedOldKey = { ...proof.newKey, player_id: previousPlayerId };
          const newKeyHistory = await reader.applicationsAt(proof.table, proof.newKey, providerId);
          const oldKeyHistory = await reader.applicationsAt(proof.table, derivedOldKey, providerId);
          const current = await reader.currentRowAt(proof.table, proof.newKey);
          const rowAtOldKey = (await reader.currentRowAt(proof.table, derivedOldKey)) !== null;
          const c = newKeyHistory[0];
          const projectionPlayerId = c
            ? await reader.projectionPlayer(proof.table, providerMatchIdOf(proof.table, c.externalRecordId), providerId)
            : null;
          const matchId = proof.table === 'player_match_stats' ? toInt(proof.newKey.match_id) : null;
          const matchStillExists = matchId === null ? true : await reader.matchExists(matchId);
          const audits = c
            ? await reader.auditsFor(auditMatchIds(proof.table, proof.newKey, current, [oldKeyHistory, newKeyHistory]), c.id)
            : [];
          moves.push({
            batchId: batch.id, proof, derivedOldKey, newKeyHistory, oldKeyHistory, current, rowAtOldKey,
            projectionPlayerId, matchStillExists, audits,
          });
        } else if (proof.verb === 'delete') {
          const oldKeyHistory = await reader.applicationsAt(proof.table, proof.oldKey, providerId);
          const d = oldKeyHistory.find((a) => a.verb === 'delete' && a.importBatchId === batch.id);
          const projectionPlayerId = d
            ? await reader.projectionPlayer(proof.table, providerMatchIdOf(proof.table, d.externalRecordId), providerId)
            : null;
          deletes.push({ batchId: batch.id, proof, oldKeyHistory, projectionPlayerId });
        }
      }
    }
  }

  const attributedKeysAtP = previousPlayerId !== null ? await reader.attributedKeysAtPlayer(providerId, previousPlayerId) : [];
  const identityInvariant = await reader.identityInvariantFacts();
  const providerProjections = await reader.providerProjections(providerId);
  return {
    providerId, adjudicationId, currentBatchId, aflApiSourceId, identityRow, ledgerRows,
    previousPlayerId, correctedPlayerId, batches, moves, deletes, attributedKeysAtP,
    identityInvariant, providerProjections,
  };
}

/** Gather + evaluate: the single Q2 entry point both callers use. */
export async function checkCorrectionSatisfaction(
  reader: CorrectionSatisfactionReader,
  input: { readonly providerId: string; readonly adjudicationId: number; readonly currentBatchId: number | null },
): Promise<CorrectionSatisfactionResult> {
  return evaluateCorrectionSatisfactionQ2(await gatherCorrectionSatisfactionEvidence(reader, input));
}

/**
 * §8.5: ORIGINAL on a provider whose net state is already `CORRECTED(A)`. A different
 * `--to-player-id` than A's P′ is a chain (D8) and STOPs `already_corrected_provider`; otherwise
 * the result is Q2's verdict: ALREADY_SATISFIED (reports only) or STOP. It receives only the
 * read-only reader, so no path through it can write.
 */
export async function runAlreadyCorrectedRerun(
  reader: CorrectionSatisfactionReader, args: CorrectionArgs, adjudicationId: number,
): Promise<CorrectionOutcome> {
  const q2 = await checkCorrectionSatisfaction(reader, { providerId: args.providerId, adjudicationId, currentBatchId: null });
  return decideAlreadyCorrectedRerun(args, q2);
}

export function decideAlreadyCorrectedRerun(args: CorrectionArgs, q2: CorrectionSatisfactionResult): CorrectionOutcome {
  if (q2.correctedPlayerId !== null && q2.correctedPlayerId !== args.toPlayerId) {
    const chain = evaluateWholePlanStops({
      pEqualsPPrimeByPlayerId: false, pEqualsPPrimeByStableIdentity: false, pPrimeHoldsAnotherAflApiProvider: false,
      stableIdentityMissingOrAmbiguous: false, identityIsManualAdminEditToken: false, netStateAlreadyCorrected: true,
    });
    return {
      kind: 'STOP',
      stops: chain.map((s): OutcomeStop => ({
        table: 'player_match_stats', rowId: null, step: s.step, code: s.code,
        detail: `${s.detail} (A corrected ${args.providerId} to player ${q2.correctedPlayerId}; --to-player-id is ${args.toPlayerId})`,
      })),
      fingerprint: '',
    };
  }
  if (!q2.satisfied) return { kind: 'STOP', stops: q2.stops, fingerprint: '' };
  return { kind: 'ALREADY_SATISFIED', reports: q2.reports };
}

/** A CD_I-created row still at P (SAT-5, "attribution predicates only"). Deliberately wider than
 * Q1's attribution: a later stamp or projection disagreement can never hide such a row (§5.6,
 * case 95), so only P1/P3/P4 (`player_match_stats`) or B1/B2 plus insert proof (Brownlow) count. */
export function playerMatchStatsRowIsCdIAttributed(
  ownerIsAflApi: boolean, applications: readonly { sourceId: string; verb: string; externalRecordId: string }[], providerId: string,
): boolean {
  return ownerIsAflApi && applications.length > 0 && applications[0].verb === 'insert'
    && applications.every((a) => a.sourceId === AFL_API_SOURCE_KEY)
    && playerMatchStatsHistoryThroughProvider(applications, providerId);
}

export function brownlowRowIsCdIAttributed(
  ownerIsAflApi: boolean, insert: { verb: string; sourceId: string } | undefined,
  insertProvenByPayload: boolean, projectionNamesThisPlayer: boolean,
): boolean {
  return ownerIsAflApi && insert !== undefined && insert.verb === 'insert' && insert.sourceId === AFL_API_SOURCE_KEY
    && (insertProvenByPayload || projectionNamesThisPlayer);
}

function dbCorrectionSatisfactionReader(tx: TransactionSql): CorrectionSatisfactionReader {
  const annotate = async (
    rows: readonly (CanonicalApplicationRow & { targetTable: string })[], providerId: string,
  ): Promise<Q2Application[]> => {
    const out: Q2Application[] = [];
    for (const row of rows) {
      const voterProof = row.targetTable === 'brownlow_round_votes' ? await voterCountAndVoteForCdI(tx, row, providerId) : null;
      out.push({ ...row, voterProof });
    }
    return out;
  };
  return {
    aflApiSourceId: () => fetchAflApiSourceId(tx),
    identityRow: (providerId) => readExternalIdentityRow(tx, providerId),
    ledgerRows: (providerId) => readLedgerRowsForProvider(tx, providerId),
    resolvePlayerIdentity: async (identity) => {
      const resolved = await resolveAflApiPlayerIdentity(tx, identity);
      return resolved.ok ? resolved.newPlayerId : null;
    },
    batchesClaimingAdjudication: (adjudicationId) => tx<Q2BatchRow[]>`
      SELECT ib.id::int AS id, s.key AS "sourceKey", ib.tool, ib.target_table AS "targetTable",
             ib.status::text AS status, ib.validation_result AS "validationResult"
        FROM import_batches ib
        JOIN sources s ON s.id = ib.source_id
       WHERE ib.tool = ${TOOL} AND ib.validation_result->>'adjudicationId' = ${String(adjudicationId)}
       ORDER BY ib.id
    `,
    batchApplications: async (batchId, providerId) => annotate(await tx<(CanonicalApplicationRow & { targetTable: string })[]>`
      SELECT ca.id::int AS id, ca.verb, ca.previous_values AS "previousValues", ca.new_values AS "newValues",
             s.key AS "sourceId", ca.family, ca.external_record_id AS "externalRecordId",
             ca.source_version_seq AS "sourceVersionSeq", ca.import_batch_id::int AS "importBatchId",
             ca.target_key AS "targetKey", ca.target_table AS "targetTable"
        FROM canonical_applications ca JOIN sources s ON s.id = ca.source_id
       WHERE ca.import_batch_id = ${batchId}
       ORDER BY ca.id
    `, providerId),
    applicationsAt: async (table, key, providerId) => annotate(
      (await readApplications(tx, AFL_API_SOURCE_KEY, table, key)).map((row) => ({ ...row, targetTable: table })), providerId,
    ),
    currentRowAt: async (table, key) => {
      const rows = table === 'player_match_stats'
        ? await tx<{ row: Record<string, JsonValue>; ownerKey: string | null }[]>`
            SELECT to_jsonb(t.*) AS row, s.key AS "ownerKey"
              FROM player_match_stats t LEFT JOIN sources s ON s.id = t.source_id
             WHERE t.player_id = ${toInt(key.player_id)} AND t.match_id = ${toInt(key.match_id)}
          `
        : await tx<{ row: Record<string, JsonValue>; ownerKey: string | null }[]>`
            SELECT to_jsonb(t.*) AS row, s.key AS "ownerKey"
              FROM brownlow_round_votes t LEFT JOIN sources s ON s.id = t.source_id
             WHERE t.season = ${toInt(key.season)} AND t.player_id = ${toInt(key.player_id)}
               AND t.round_number = ${toInt(key.round_number)}
          `;
      return rows[0] ?? null;
    },
    projectionPlayer: async (table, providerMatchId, providerId) => {
      const rows = table === 'player_match_stats'
        ? await tx<{ playerId: number }[]>`
            SELECT DISTINCT player_id AS "playerId" FROM staging.afl_api_player_match
             WHERE source_id = (SELECT id FROM sources WHERE key = ${AFL_API_SOURCE_KEY})
               AND provider_player_id = ${providerId} AND provider_match_id = ${providerMatchId}
          `
        : await tx<{ playerId: number }[]>`
            SELECT DISTINCT player_id AS "playerId" FROM staging.afl_api_brownlow_vote
             WHERE source_id = (SELECT id FROM sources WHERE key = ${AFL_API_SOURCE_KEY})
               AND provider_player_id = ${providerId} AND provider_match_id = ${providerMatchId}
          `;
      if (rows.length === 0) return null;
      return rows.length === 1 ? rows[0].playerId : -1;
    },
    matchExists: async (matchId) => {
      const [row] = await tx<{ exists: boolean }[]>`SELECT EXISTS (SELECT 1 FROM matches WHERE id = ${matchId}) AS exists`;
      return row.exists;
    },
    auditsFor: async (matchIds, correctionApplicationId) => {
      if (matchIds.length === 0) return [];
      const rows = await tx<(Omit<PostCorrectionAudit, 'afterCorrection'> & { afterCorrection: boolean | null })[]>`
        SELECT de.id::text AS id, de.table_name AS "tableName", de.row_id::int AS "rowId",
               de.field_group AS "fieldGroup",
               CASE WHEN jsonb_typeof(de.new_values->'revision') = 'number'
                    THEN (de.new_values->>'revision')::int END AS revision,
               de.created_at >= (SELECT applied_at FROM canonical_applications WHERE id = ${correctionApplicationId})
                 AS "afterCorrection"
          FROM data_edits de
         WHERE de.table_name IN ('matches', 'brownlow_vote_entry_state')
           AND de.row_id = ANY(${tx.array([...matchIds])}::bigint[])
      `;
      return rows.map((r) => ({ ...r, afterCorrection: r.afterCorrection === true }));
    },
    attributedKeysAtPlayer: async (providerId, playerId) => {
      const aflApiSourceId = await fetchAflApiSourceId(tx);
      const keys: string[] = [];
      for (const candidate of await readPlayerMatchStatsCandidatesForPlayer(tx, providerId, playerId, false)) {
        if (playerMatchStatsRowIsCdIAttributed(toInt(candidate.current.source_id) === aflApiSourceId, candidate.applications, providerId)) {
          keys.push(naturalKeyString('player_match_stats', { player_id: playerId, match_id: candidate.matchId }));
        }
      }
      for (const candidate of await readBrownlowCandidatesForPlayer(tx, providerId, playerId, false)) {
        const insert = candidate.applications[0];
        const proof = insert ? await voterCountAndVoteForCdI(tx, insert, providerId) : null;
        if (brownlowRowIsCdIAttributed(
          toInt(candidate.currentRow.source_id) === aflApiSourceId, insert,
          proof !== null && brownlowInsertProvenByPayload(proof, insert.newValues),
          candidate.projectionPlayerId === playerId,
        )) {
          keys.push(naturalKeyString('brownlow_round_votes', { season: candidate.season, player_id: playerId, round_number: candidate.roundNumber }));
        }
      }
      return keys;
    },
    // The same reads, with the same importer-row identity set, as `assertAflApiIdentityInvariant`.
    identityInvariantFacts: async () => {
      const sourceId = await fetchAflApiSourceId(tx);
      const ledgerRows = await readLedgerRows(tx);
      const censusRows = await readAflApiCensusRows(tx, sourceId);
      const playerIds = [...new Set(censusRows
        .filter((r) => r.status === 'unique' && r.playerId !== null).map((r) => r.playerId as number))];
      const identityByPlayerId = await readAflApiForwardIdentities(tx, playerIds);
      return { censusRows, ledgerRows, identityByPlayerId };
    },
    providerProjections: (providerId) => tx<ProviderProjectionRow[]>`
      SELECT 'player_match_stats' AS "table", provider_match_id AS "providerMatchId", player_id AS "playerId"
        FROM staging.afl_api_player_match
       WHERE source_id = (SELECT id FROM sources WHERE key = ${AFL_API_SOURCE_KEY})
         AND provider_player_id = ${providerId}
      UNION ALL
      SELECT 'brownlow_round_votes' AS "table", provider_match_id AS "providerMatchId", player_id AS "playerId"
        FROM staging.afl_api_brownlow_vote
       WHERE source_id = (SELECT id FROM sources WHERE key = ${AFL_API_SOURCE_KEY})
         AND provider_player_id = ${providerId}
    `,
  };
}

/* ==================================================================== *
 * Reporting
 * ==================================================================== */

export function formatOutcome(outcome: CorrectionOutcome, args: CorrectionArgs): string {
  const lines = [`  mode ${args.mode}, provider ${args.providerId} -> player ${args.toPlayerId}`];
  switch (outcome.kind) {
    case 'STOP':
      lines.push(`  STOP: ${outcome.stops.length} stop(s); nothing written`);
      for (const s of outcome.stops) lines.push(`    ${describeStop(s)}`);
      if (outcome.fingerprint) lines.push(`    fingerprint (for reference only, do not apply): ${outcome.fingerprint}`);
      return lines.join('\n');
    case 'ALREADY_SATISFIED':
      lines.push('  ALREADY_SATISFIED: this provider is already corrected and the correction remains satisfied');
      for (const r of outcome.reports) lines.push(`    ${r}`);
      return lines.join('\n');
    case 'PLANNED':
      lines.push(`  PLAN OK (validate-only): fingerprint ${outcome.fingerprint}`);
      lines.push(`    rows planned: ${outcome.plan.rows.length}`);
      for (const r of outcome.reports) lines.push(`    ${r}`);
      return lines.join('\n');
    case 'ROLLED_BACK':
    case 'COMMITTED':
      lines.push(`  ${outcome.kind}: fingerprint ${outcome.fingerprint}`);
      lines.push(`    adjudication id ${outcome.adjudicationId}, batch id ${outcome.batchId}`);
      lines.push(`    moved ${outcome.moved}, deleted ${outcome.deleted}`);
      for (const r of outcome.reports) lines.push(`    ${r}`);
      return lines.join('\n');
  }
}

/* ==================================================================== *
 * CLI
 * ==================================================================== */

/** Carries a COMMITTED outcome out of a deliberately-aborted transaction (`--validate-only` and
 * `--dry-run` never let `sql.begin()` return normally: both force a real SQL ROLLBACK, exactly
 * the transaction-level guarantee that must hold regardless of what the DB-logic layer computed). */
class ForcedRollback extends Error {
  constructor(readonly outcome: CorrectionOutcome) { super('forced rollback'); }
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseCorrectAflApiIdentityArgs(argv);
  loadEnv(REPO_ROOT);
  const evidenceFile = loadEvidenceFile(args.evidenceFile);
  const dsn = resolveImportDsn(process.env, args.expectDatabase);
  const sql = postgres(dsn, {
    max: 1, onnotice: () => {},
    connection: { application_name: `afldb-correct-afl-api-identity-${args.mode}`, TimeZone: 'UTC' },
  });
  try {
    let result: CorrectionOutcome;
    if (args.mode === 'apply') {
      result = await sql.begin('isolation level read committed', (tx) => runCorrection(tx, args, evidenceFile));
    } else {
      // validate-only and dry-run: always force a real ROLLBACK, whatever `runCorrection` did
      // inside the transaction (validate-only never reaches a write; dry-run executes every
      // write and must still not keep them).
      try {
        await sql.begin('isolation level read committed', async (tx) => {
          const outcome = await runCorrection(tx, args, evidenceFile);
          throw new ForcedRollback(outcome);
        });
        throw new CorrectionRefused(`internal: ${args.mode} transaction returned instead of rolling back`);
      } catch (error) {
        if (!(error instanceof ForcedRollback)) throw error;
        result = args.mode === 'dry-run' && error.outcome.kind === 'COMMITTED'
          ? { ...error.outcome, kind: 'ROLLED_BACK' }
          : error.outcome;
      }
    }
    console.log(formatOutcome(result, args));
    return result.kind === 'STOP' ? 1 : 0;
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
      console.error(`REFUSED: ${(error as Error).message}`);
      console.error('  nothing was written (the transaction rolled back or was never opened)');
      process.exit(1);
    });
}
