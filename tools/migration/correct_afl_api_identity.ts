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
 * Implements runbook (`issues/closed/AFLDB-ISSUE-238.md`) §8.2 (the ORIGINAL transaction), §8.7
 * (the batch contract) and §8.8 (the role model) for §12 Slice 5 only:
 *
 *   - the CLI and its three modes;
 *   - the surname acknowledgement (§10 M1);
 *   - the row locks, conditional writes and `rowProofs` (§5.6 L5, §8.2 pass 5/5a);
 *   - the targeted recompute (§4.D) with the `stat_availability` byte-identical assertion;
 *   - the §8.4 post-write CORRECTION SATISFACTION re-plan;
 *   - the §8.5 ALREADY_SATISFIED re-run.
 *
 * Slice 6 (M3a) adds promotion REPLAY (§8.3, `--replay-promotion`, the REPLAY_SECTION near the end
 * of this file) over the shared mechanics ORIGINAL uses, and exports the shared candidate
 * classification (`predictCorrectionClosure`, `resolveCandidateIdentity`,
 * `classifyCorrectedProviderInDatabase`). Slice 7 adds the rebuild REPLAY halves Stage 21 calls
 * (§9.2 (b′ write) / (b′ verify), the REBUILD_REPLAY_SECTION after the REPLAY section) and the
 * Stage 22 SAT-1 check; the `code_test_db` rehearsal is a later slice. This file never runs the
 * promotion or rebuild lifecycle itself.
 *
 * Slice 8 adds the ORIGINAL operator report (§8.2 step 11): a pre-commit report CONTEXT (§5.10
 * per-season verdicts, DP-3/DP-4 with refresh paths, the §4.G artefact risk) carried outside the
 * fingerprinted plan, and a post-transaction IMPACT report (exact cache paths, Coleman seasons,
 * open findings, pending candidates, DP-5) gathered read-only and best-effort AFTER the
 * transaction (`reportAfterTransaction`). It invalidates no cache, recomputes nothing and writes
 * nothing; a report failure after COMMIT leaves the correction COMMITTED. REPLAY never calls it.
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
  AflApiPromotionFileRefused,
  aflApiIdentityStateSha256,
  aflApiImporterStateSha256,
  aflApiLedgerStateSha256,
  aflApiNetIsHumanLive,
  applyAflApiPendingD15,
  censusAflApiRows,
  checkAflApiIdentityInvariant,
  classifyAflApiCensusRow,
  netLedgerRowsByExternalId,
  parseAflApiSupersedeFile,
  validateManifestAgainstCatalogue,
  type AflApiAdjudicationLedgerRow,
  type AflApiCensusRow,
  type AflApiCorrectedReplayEntry,
  type AflApiForwardIdentityResult,
  type AflApiIdentityStateRow,
  type AflApiImporterStateRow,
  type AflApiPreSwapPromotionContract,
  type AflApiSupersedeFile,
  type CatalogueColumn,
  type ManifestValidationProblem,
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
  affectedCachePaths,
  artefactRecurrenceRisk,
  careersBeforeCorrection,
  classifyBrownlowChain,
  classifyCorrectedCandidate,
  compareReconstruction,
  describeSeasonVerdict,
  evaluateColemanImpact,
  evaluateFirstKickGoalDebutChanges,
  matchLessDependentReports,
  selectOpenFindings,
  selectPendingCandidates,
  unresolvedDependentReports,
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
  type CacheImpact,
  type CanonicalTable,
  type CareerMatch,
  type ClosureImpactRow,
  type ClosureRowFingerprintInput,
  type ColemanRowFacts,
  type ColemanSeasonImpact,
  type CorrectionReportContext,
  type CpcIdentityResolution,
  type CpcInput,
  type CpcMutationCounts,
  type CpcPrediction,
  type CpcProviderRow,
  type CpcResult,
  type DeleteLineageEvidence,
  type DependentReportEntry,
  type DependentTable,
  type FieldDivergence,
  type FindingReport,
  type FindingScope,
  type FirstKickGoalRow,
  type ImpactPhase,
  type L8Evidence,
  type MoveLineageEvidence,
  type MoveLineageResult,
  type MutationPlan,
  type OpenFindingRow,
  type PendingCandidateReport,
  type PendingCandidateRow,
  type PlayerMatchStatsRowEvidence,
  type PostCorrectionExplanation,
  type SatisfactionEvidence,
  type SatisfactionReportEntry,
  type SeasonIndependenceEvidence,
  type SeasonVerdictReport,
  type Stop,
  type StopCode,
} from '../../src/lib/acquisition/afl-api-identity-correction';
import {
  PLAYER_MATCH_STATS_ENTITY,
  continuityPartnersOf,
  decodePlayerMatchStatsKey,
  describeManualAuthorityBlockers,
  loadContinuityRulesFailClosed,
  manualAuthorityBlockersForMatch,
  type ManualAuthorityBlocker,
} from '../../src/lib/acquisition/match-sheet-authority';
import {
  readAflApiCensusRows,
  readAflApiForwardIdentities,
  readLedgerRows,
  resolveAflApiPlayerIdentities,
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

/** The two roles a correction mode may run as (§8.8): ORIGINAL `afldb_import`, promotion REPLAY `afldb_owner`. */
export type CorrectionSessionRole = 'afldb_import' | 'afldb_owner';

/** §8.2 step 1's / §8.3 step 1's opening assertion (§8.8), role-aware. */
export async function proveSession(
  tx: TransactionSql, expectDatabase: string, expectRole: CorrectionSessionRole,
): Promise<void> {
  const [row] = await tx<{ database: string; role: string }[]>`
    SELECT current_database() AS database, current_user AS role
  `;
  if (row?.database !== expectDatabase) {
    throw new CorrectionRefused(`REFUSED: connected database is '${String(row?.database)}', not '${expectDatabase}'`);
  }
  if (row.role !== expectRole) {
    throw new CorrectionRefused(`REFUSED: session role is '${row.role}', not '${expectRole}'`);
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

export type ReferenceCatalogueRow = CatalogueColumn & { constraint: string };

/**
 * The manifest's own definition: every single-column foreign key to `players`, whatever the
 * referencing column is called (`three_player_id`, ...). The same semantics as the ISSUE-235
 * revoke's `proveNonUse` reader. An index, or a `player_id` column with no FK (the
 * `staging_aflw` resolution targets), is not a player reference and never appears here.
 */
export async function readReferenceCatalogue(tx: TransactionSql): Promise<ReferenceCatalogueRow[]> {
  return tx<ReferenceCatalogueRow[]>`
    SELECT n.nspname AS schema, cl.relname AS table, a.attname AS column, con.conname AS constraint
      FROM pg_constraint con
      JOIN pg_class cl ON cl.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = cl.relnamespace
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)
     WHERE con.contype = 'f' AND con.confrelid = 'public.players'::regclass
       AND array_length(con.conkey, 1) = 1
       AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       AND n.nspname NOT LIKE 'pg_temp_%' AND n.nspname NOT LIKE 'pg_toast_temp_%'
  `;
}

/** One line per D10 problem, naming the relation, column(s) and (where known) the FK constraint. */
export function formatManifestProblems(
  problems: readonly ManifestValidationProblem[],
  catalogue: readonly ReferenceCatalogueRow[],
): string {
  return problems.map((p) => {
    const relation = `${p.schema}.${p.table}`;
    switch (p.kind) {
      case 'unclassified_table': {
        const constraints = [...new Set(catalogue
          .filter((r) => r.schema === p.schema && r.table === p.table)
          .map((r) => r.constraint))].sort();
        return `unclassified_table ${relation}(${p.columns.join(', ')})`
          + ` -- player FK not in the manifest${constraints.length > 0 ? ` [${constraints.join(', ')}]` : ''}`;
      }
      case 'missing_column':
        return `missing_column ${relation}.${p.column} -- manifest column has no live player FK`;
      case 'not_source_bearing_gained_source_id':
        return `not_source_bearing_gained_source_id ${relation} -- NOT_SOURCE_BEARING table now has a provenance column`;
    }
  }).join('; ');
}

async function assertManifestValidatesAgainstCatalogue(tx: TransactionSql): Promise<void> {
  const catalogue = await readReferenceCatalogue(tx);
  const problems = validateManifestAgainstCatalogue(catalogue, AFL_API_PLAYER_REFERENCE_MANIFEST);
  if (problems.length > 0) {
    throw new CorrectionRefused(`REFUSED: the D10 player-reference manifest no longer validates against the live catalogue: ${formatManifestProblems(problems, catalogue)}`);
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
 * AFLDB-ISSUE-257 (F-PR-06, step A257): the Match Sheet / lineup authority records at match
 * `matchId` that block an ORIGINAL MOVE/DELETE of P's closure row there (decision:
 * `manualAuthorityBlockersForMatch`). Records are read by the §18.3 key-prefix predicate, in the
 * correction transaction after `readPlayerMatchStatsCandidatesForPlayer` has taken the match lock
 * (`FOR UPDATE OF pms, m`). Under State A (old CHECK) no record can exist, the first query returns
 * nothing and no further read happens. Identities are resolved in reverse (D-257-9) from every
 * external identity the records' keys (and tracked continuity partners) name.
 */
async function readManualAuthorityBlockersAtMatch(
  tx: TransactionSql, matchId: number, pId: number, pPrimeId: number,
): Promise<readonly ManualAuthorityBlocker[]> {
  const stored = await tx<{
    matchKey: string; entityKey: string; fieldGroup: string; isActive: boolean; overrideValues: string | null;
  }[]>`
    SELECT m.match_key AS "matchKey", d.entity_key AS "entityKey", d.field_group AS "fieldGroup",
           d.is_active AS "isActive", d.override_values::text AS "overrideValues"
      FROM matches m
      JOIN data_overrides d
        ON d.entity_type = ${PLAYER_MATCH_STATS_ENTITY}
       AND starts_with(d.entity_key, m.match_key::text || '|')
       AND strpos(substr(d.entity_key, length(m.match_key::text) + 2), '|') = 0
     WHERE m.id = ${matchId}
  `;
  if (stored.length === 0) return [];
  const continuity = loadContinuityRulesFailClosed();
  const externalIds = new Set<string>();
  for (const record of stored) {
    const decoded = decodePlayerMatchStatsKey(record.entityKey);
    if (decoded === null) continue;
    externalIds.add(decoded.externalId);
    if (decoded.sourceKey === 'afltables' && continuity.ok) {
      for (const partner of continuityPartnersOf(decoded.externalId, continuity.rules)) externalIds.add(partner);
    }
  }
  const identities = await tx<{ sourceKey: string; externalId: string; matchMethod: string | null; playerId: number }[]>`
    SELECT s.key AS "sourceKey", e.external_id AS "externalId",
           e.match_method AS "matchMethod", e.player_id::int AS "playerId"
      FROM external_identities e
      JOIN sources s ON s.id = e.source_id
     WHERE s.key IN ('afltables', 'manual_admin_edit')
       AND e.external_id = ANY(${[...externalIds]}::text[])
       AND e.status IN ('unique', 'resolved')
       AND e.player_id IS NOT NULL
  `;
  const playerIdsByIdentity = new Map<string, number[]>();
  for (const row of identities) {
    if (row.sourceKey === 'afltables' && row.matchMethod !== 'afltables_profile_url') continue;
    const identity = `${row.sourceKey}:${row.externalId}`;
    const players = playerIdsByIdentity.get(identity) ?? [];
    if (!players.includes(Number(row.playerId))) players.push(Number(row.playerId));
    playerIdsByIdentity.set(identity, players);
  }
  return manualAuthorityBlockersForMatch({
    matchKey: stored[0].matchKey,
    records: stored.map((row) => {
      let overrideValues: unknown = null;
      try { overrideValues = row.overrideValues === null ? null : JSON.parse(row.overrideValues); } catch { overrideValues = null; }
      return { entityKey: row.entityKey, fieldGroup: row.fieldGroup, isActive: row.isActive === true, overrideValues };
    }),
    playerIdsByIdentity, continuity, pId, pPrimeId,
  });
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
): Promise<{
  afterSirenKicksRowForP: boolean; achievementRowForP: boolean; unresolvedRowAtMatch: boolean;
  /** DP-3's exact rows (Slice 8 reports their ids); `unresolvedRowAtMatch` is exactly "non-empty". */
  unresolvedRows: readonly { table: DependentTable; id: number }[];
}> {
  const [[siren], [achievement], unresolved] = await Promise.all([
    tx<{ n: number }[]>`SELECT count(*)::int AS n FROM after_siren_kicks WHERE player_id = ${playerId} AND match_id = ${matchId}`,
    tx<{ n: number }[]>`SELECT count(*)::int AS n FROM player_achievements WHERE player_id = ${playerId} AND match_id = ${matchId}`,
    tx<{ table: DependentTable; id: number }[]>`
      SELECT 'after_siren_kicks' AS "table", id FROM after_siren_kicks WHERE player_id IS NULL AND match_id = ${matchId}
      UNION ALL
      SELECT 'player_achievements' AS "table", id FROM player_achievements WHERE player_id IS NULL AND match_id = ${matchId}
    `,
  ]);
  return {
    afterSirenKicksRowForP: siren.n > 0, achievementRowForP: achievement.n > 0,
    unresolvedRowAtMatch: unresolved.length > 0, unresolvedRows: unresolved,
  };
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
    SELECT pms.id::int AS "pmsRowId", m.season::int AS season, c.organization_id AS "clubOrganizationId"
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
): Promise<{ independent: boolean; stop: Stop | null; seasonClass: SeasonTotalsClass; report: SeasonVerdictReport }> {
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
  // Slice 8 (S8-D4): the structured verdict is described from the SAME evidence and verdict; it
  // decides nothing and never reaches the fingerprinted plan.
  const report = describeSeasonVerdict({ season, seasonClass, evidence, verdict });
  return verdict.independent
    ? { independent: true, stop: null, seasonClass, report }
    : { independent: false, stop: verdict.stop, seasonClass, report };
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
  /** Slice 8 (§5.1 `context`, S8-D4): report-only, NEVER part of `plan` or the fingerprint. */
  readonly context: CorrectionReportContext;
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
  // Slice 8 report context (§5.1 `context`): built from evidence this function already reads; it
  // is never part of `plan`, so it can never move the fingerprint.
  const closureImpact: ClosureImpactRow[] = [];
  const seasonVerdicts: SeasonVerdictReport[] = [];
  const dependentReports: DependentReportEntry[] = [];
  // §5.7: a row STOP's named evidence (the planner's `detail`), recorded against the STOP just
  // pushed. It goes to the report context, never into the STOP objects of `plan`.
  const stopDetails: { index: number; detail: string }[] = [];
  const detailLastStop = (stop: Stop) => { stopDetails.push({ index: stops.length - 1, detail: stop.detail }); };

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
    // AFLDB-ISSUE-257 (F-PR-06, A257): ORIGINAL only. REPLAY (ADJUDICATION) and PREDICT are governed
    // by promotion preflight (A4.4). After C11 (a foreign NOOP row is never mutated) and before P7
    // (so a Match Sheet edit with authority STOPs here, not as out_of_ledger_edit).
    if (authority.mode === 'ORIGINAL') {
      const authorityBlockers = await readManualAuthorityBlockersAtMatch(tx, candidate.matchId, pId, pPrimeId);
      if (authorityBlockers.length > 0) {
        stops.push({ table: 'player_match_stats', rowId: candidate.id, step: 'A257', code: 'manual_authority_present' });
        detailLastStop({ step: 'A257', code: 'manual_authority_present', detail: describeManualAuthorityBlockers(authorityBlockers) });
        continue;
      }
    }
    const evidence = buildPlayerMatchStatsEvidence(candidate, providerId, aflApiSourceId);
    const eligibility = evaluatePlayerMatchStatsMutationEligibility(evidence);
    if (!eligibility.ok) {
      stops.push({ table: 'player_match_stats', rowId: candidate.id, step: eligibility.stop.step, code: eligibility.stop.code });
      detailLastStop(eligibility.stop);
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
      detailLastStop(guards.stop);
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
      for (const s of dependentResult.stops) {
        stops.push({ table: 'player_match_stats', rowId: candidate.id, step: s.step, code: s.code });
        detailLastStop(s);
      }
      continue;
    }
    reports.push(...dependentResult.reports.map((r) => `player_match_stats#${candidate.id}: ${r}`));
    const unresolvedDependents = unresolvedDependentReports({
      closureRowId: candidate.id, matchId: candidate.matchId, rows: dependents.unresolvedRows,
    });

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
      detailLastStop(dispositionResult.stop);
      continue;
    }

    affectedSeasons.add(candidate.season);
    dependentReports.push(...unresolvedDependents); // DP-3, for a row this plan really moves/deletes
    closureImpact.push({
      table: 'player_match_stats', rowId: candidate.id, disposition: dispositionResult.disposition,
      matchId: candidate.matchId, season: candidate.season,
      clubId: toInt(candidate.current.club_id ?? null), goals: toInt(candidate.current.goals ?? null),
    });
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
      // S6-D1 (§5.1): the application history and cited version this disposition rests on, and the
      // C2 counterpart (its id and full contract hash) when the row is deleted beside it.
      evidence: closureEvidence(candidate.applications, latest, aflApiSourceId, null),
      collision: dispositionResult.disposition === 'DELETE_AS_FOREIGN_COLLISION' && counterpartRow !== undefined
        ? {
          counterpartRowId: Number(counterpartRow.id),
          counterpartContractSha256: rowContractHash(projectContract(counterpartRow, PLAYER_MATCH_STATS_CONTRACT_FIELDS)),
          outcome: 'C2' as const,
        }
        : null,
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
      detailLastStop(verdict.stop);
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
      detailLastStop(guards.stop);
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
      detailLastStop(participation.stop);
      continue;
    }
    if (candidate.current.played !== false) positiveBrownlowSeasons.add(candidate.season);

    const [counterpartRow] = lockRows
      ? await tx<{ id: number; played: JsonValue; votes: JsonValue; matchId: JsonValue; sourceId: number }[]>`
          SELECT id::int AS id, played, votes, match_id AS "matchId", source_id AS "sourceId" FROM brownlow_round_votes
           WHERE player_id = ${pPrimeId} AND season = ${candidate.season} AND round_number = ${candidate.roundNumber}
             FOR UPDATE
        `
      : await tx<{ id: number; played: JsonValue; votes: JsonValue; matchId: JsonValue; sourceId: number }[]>`
          SELECT id::int AS id, played, votes, match_id AS "matchId", source_id AS "sourceId" FROM brownlow_round_votes
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
      detailLastStop(dispositionResult.stop);
      continue;
    }

    affectedSeasons.add(candidate.season);
    closureImpact.push({
      table: 'brownlow_round_votes', rowId: candidate.id, disposition: dispositionResult.disposition,
      matchId: candidate.matchId, season: candidate.season, clubId: null, goals: null,
    });
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
      // S6-D1 (§5.1): B3-I insert-payload evidence (the insert application's stored payload hash),
      // and the C4 counterpart (id + contract hash) when the row is deleted beside it.
      evidence: closureEvidence(
        candidate.applications, latest, aflApiSourceId, await readCitedPayloadSha256(tx, candidate.applications[0]),
      ),
      collision: dispositionResult.disposition === 'DELETE_AS_FOREIGN_COLLISION' && counterpartRow !== undefined
        ? {
          counterpartRowId: counterpartRow.id,
          counterpartContractSha256: rowContractHash(projectContract(
            { played: counterpartRow.played, votes: counterpartRow.votes, match_id: counterpartRow.matchId },
            BROWNLOW_ROUND_VOTES_CONTRACT_FIELDS,
          )),
          outcome: 'C4' as const,
        }
        : null,
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
    seasonVerdicts.push(verdict.report); // every affected season, PASS and STOP alike (S8-D4)
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
  dependentReports.push(...matchLessDependentReports(dp4)); // the SAME verdict, with its refresh path

  const plan: MutationPlan = {
    plannerVersion: PLANNER_VERSION,
    provider: { externalId: providerId, sourceKey: AFL_API_SOURCE_KEY },
    authority,
    identityAction,
    rows,
    stops,
  };
  seasonVerdicts.sort((a, b) => a.season - b.season);
  const context: CorrectionReportContext = {
    closureRows: closureImpact,
    seasonVerdicts,
    dependents: dependentReports,
    artefactRisk: artefactRecurrenceRisk({ providerId, seasonVerdicts }),
    stopDetails,
  };
  return { plan, rows: built, reports, context };
}

async function ownerKeyOf(tx: TransactionSql, sourceId: number | null): Promise<string | null> {
  if (sourceId === null) return null;
  const [row] = await tx<{ key: string }[]>`SELECT key FROM sources WHERE id = ${sourceId}`;
  return row?.key ?? null;
}

/** The stored `payload_hash` (sha256 hex) of the source version an application cites; null if absent. */
async function readCitedPayloadSha256(tx: TransactionSql, app: CanonicalApplicationRow): Promise<string | null> {
  const [row] = await tx<{ hash: string }[]>`
    SELECT v.payload_hash AS hash
      FROM staging.source_record_versions v
     WHERE v.source_id = (SELECT id FROM sources WHERE key = ${app.sourceId})
       AND v.family = ${app.family} AND v.external_record_id = ${app.externalRecordId}
       AND v.version_seq = ${app.sourceVersionSeq}
  `;
  return row?.hash ?? null;
}

/** §5.1 fingerprint evidence: every application at the row's key, and the version the latest cites. */
function closureEvidence(
  applications: readonly CanonicalApplicationRow[], cited: CanonicalApplicationRow,
  aflApiSourceId: number, insertPayloadSha256: string | null,
): ClosureRowFingerprintInput['evidence'] {
  return {
    applicationIds: applications.map((a) => a.id),
    citedVersion: {
      sourceId: aflApiSourceId, family: cited.family, externalRecordId: cited.externalRecordId, seq: cited.sourceVersionSeq,
    },
    insertPayloadSha256,
  };
}

function projectContract(row: Record<string, JsonValue>, fields: readonly string[]): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const f of fields) out[f] = row[f] ?? null;
  return out;
}

/* ==================================================================== *
 * §5.1 / §9.1: planning and CPC classification in a database.
 * Shared by REPLAY (§8.3 steps 3-4) and by the promotion checker's PREDICT (§6): one
 * implementation, so a prediction and its replay cannot disagree.
 * ==================================================================== */

export type PredictClosureInput = {
  readonly providerId: string;
  /** P: the player the closure rows are read at (Pc in a candidate). */
  readonly pId: number;
  /** P′: the player they move to (P′c in a candidate). */
  readonly pPrimeId: number;
  /** `PREDICT` (read-only) or `ADJUDICATION` (REPLAY). ORIGINAL is planned by `runCorrection` itself. */
  readonly authority: Extract<AuthorityBlock, { readonly mode: 'ADJUDICATION' | 'PREDICT' }>;
  readonly identityAction: MutationPlan['identityAction'];
  /** true takes `FOR UPDATE` row locks (REPLAY); false is read-only planning (PREDICT: no lock of any kind). */
  readonly lockRows: boolean;
};

export type PredictedClosure = {
  readonly plan: MutationPlan;
  readonly closure: BuiltClosure;
  readonly fingerprint: string;
  readonly stops: MutationPlan['stops'];
  readonly moveOrDeleteRowCount: number;
  readonly moved: CpcMutationCounts;
  readonly deleted: CpcMutationCounts;
};

function cpcMutationCounts(rows: readonly BuiltRow[], disposition: BuiltRow['disposition']): CpcMutationCounts {
  const count = (table: CanonicalTable) => rows.filter((r) => r.disposition === disposition && r.table === table).length;
  return { player_match_stats: count('player_match_stats'), brownlow_round_votes: count('brownlow_round_votes') };
}

/**
 * Plan the §5.1 closure under PREDICT or ADJUDICATION authority. It never calls `proveSession`
 * and takes no advisory or table lock; with `lockRows: false` it issues no `FOR UPDATE` either, so
 * it runs on a read-only transaction. The D10 manifest check is evaluated non-throwing (a failure
 * is a `provenance_unexplained` STOP in the plan, exactly as `buildClosure` records it).
 */
export async function predictCorrectionClosure(tx: TransactionSql, input: PredictClosureInput): Promise<PredictedClosure> {
  const catalogue = await readReferenceCatalogue(tx);
  const manifestOk = validateManifestAgainstCatalogue(catalogue, AFL_API_PLAYER_REFERENCE_MANIFEST).length === 0;
  const closure = await buildClosure(tx, {
    providerId: input.providerId, pId: input.pId, pPrimeId: input.pPrimeId, authority: input.authority,
    identityAction: input.identityAction, manifestOk, lockRows: input.lockRows,
  });
  return {
    plan: closure.plan,
    closure,
    fingerprint: mutationPlanFingerprint(closure.plan),
    stops: closure.plan.stops,
    moveOrDeleteRowCount: closure.rows.length,
    moved: cpcMutationCounts(closure.rows, 'MOVE'),
    deleted: cpcMutationCounts(closure.rows, 'DELETE_AS_FOREIGN_COLLISION'),
  };
}

/**
 * §9.1: an identity token (A.previous_player_identity, or A.player_identity remapped) resolved in
 * THIS database by the existing lineage rule (`resolveAflApiPlayerIdentity`, the
 * `afltables_profile_url` / `manual_admin_edit` lookup) and confirmed by the same strict forward
 * lookup ORIGINAL uses. A `manual_admin_edit` token, an unresolvable or an ambiguous identity is
 * UNEVALUABLE (O-2).
 */
export async function resolveCandidateIdentity(tx: TransactionSql, identityToken: string): Promise<CpcIdentityResolution> {
  const resolved = await resolveAflApiPlayerIdentity(tx, identityToken);
  if (!resolved.ok) {
    return { kind: 'unevaluable', reason: resolved.reason === 'ambiguous' ? 'ambiguous' : 'unresolved' };
  }
  const forward = (await readAflApiForwardIdentities(tx, [resolved.newPlayerId])).get(resolved.newPlayerId);
  if (forward === undefined) return { kind: 'unevaluable', reason: 'unresolved' };
  if (!forward.ok) return { kind: 'unevaluable', reason: forward.reason === 'ambiguous' ? 'ambiguous' : 'unresolved' };
  if (forward.via === 'manual_admin_edit') return { kind: 'unevaluable', reason: 'manual_admin_token' };
  return { kind: 'unique', playerId: resolved.newPlayerId };
}

/** The A this classification is for (its ledger row's stable fields). */
export type CorrectedProviderEntry = {
  readonly externalId: string;
  readonly adjudicationId: number;
  readonly evidenceSha256: string;
  readonly previousPlayerIdentity: string;
  readonly playerIdentity: string;
};

export type ClassifiedCorrectedProvider = {
  readonly input: CpcInput;
  readonly result: CpcResult;
  /** Null when CPC failed before planning (UNEVALUABLE, COLLISION, DISAGREE). */
  readonly prediction: CpcPrediction | null;
  /** The planned closure REPLAY applies; null exactly when `prediction` is null. */
  readonly predicted: PredictedClosure | null;
  readonly identityAction: MutationPlan['identityAction'] | null;
  readonly pcId: number | null;
  readonly pPrimeId: number | null;
  /** The CD_I identity row as found, before any write. */
  readonly identityRow: ExistingIdentityRow | null;
};

/** Stop codes that mean a candidate row's CD_I lineage cannot be proved (CPC class 3's second FAIL clause). */
const UNPROVABLE_LINEAGE_STOP_CODES: ReadonlySet<string> = new Set([
  'no_application_evidence', 'mixed_provider_application_history', 'row_stamp_names_another_provider',
  'provenance_unexplained', 'brownlow_insert_unproven', 'brownlow_chain_inconsistent', 'reconstruction_inconsistent',
]);

/** The identity action the row's position implies (§9.1): at Pc update, at P′c upgrade, none insert. */
function identityActionForRow(row: CpcProviderRow | null, pPrimeId: number): MutationPlan['identityAction'] {
  if (row === null) return 'insert';
  if (row.playerId === pPrimeId) return 'upgrade_in_place';
  return 'update_in_place';
}

async function readCandidateProviderRow(
  tx: TransactionSql, externalId: string,
): Promise<{ row: ExistingIdentityRow; externalUrl: string | null } | null> {
  const [row] = await tx<(ExistingIdentityRow & { externalUrl: string | null })[]>`
    SELECT ei.id, ei.status::text AS status, ei.player_id AS "playerId",
           ei.candidate_count AS "candidateCount", ei.match_method AS "matchMethod",
           ei.external_url AS "externalUrl"
      FROM external_identities ei
      JOIN sources s ON s.id = ei.source_id
     WHERE s.key = ${AFL_API_SOURCE_KEY} AND ei.external_id = ${externalId}
  `;
  if (!row) return null;
  return {
    row: { id: row.id, status: row.status, playerId: row.playerId, candidateCount: row.candidateCount, matchMethod: row.matchMethod },
    externalUrl: row.externalUrl,
  };
}

/**
 * §9.1 CPC for ONE corrected provider, against the database `tx` is on. Reads only, except the
 * advisory locks and `FOR UPDATE` row locks a caller asks for with `lockRows: true` (REPLAY).
 *
 * Both S6-D4 collision sources are gathered: (a) providers already at P′c in this database's
 * `afl_api` identity table, (b) the caller's `targetHumanProviders` (net linked/corrected
 * providers of the durable ledger, externalId -> stable identity) whose identity remaps to P′c.
 * CD_I itself is excluded from both by the classifier.
 */
export async function classifyCorrectedProviderInDatabase(
  tx: TransactionSql,
  params: {
    readonly entry: CorrectedProviderEntry;
    readonly authorityMode: 'PREDICT' | 'ADJUDICATION';
    readonly lockRows: boolean;
    readonly targetHumanProviders: ReadonlyMap<string, string>;
  },
): Promise<ClassifiedCorrectedProvider> {
  const { entry, authorityMode, lockRows, targetHumanProviders } = params;
  const pc = await resolveCandidateIdentity(tx, entry.previousPlayerIdentity);
  const pPrime = await resolveCandidateIdentity(tx, entry.playerIdentity);
  const found = await readCandidateProviderRow(tx, entry.externalId);
  const providerRow: CpcProviderRow | null = found === null ? null : {
    id: found.row.id,
    playerId: found.row.playerId ?? -1,
    status: found.row.status,
    matchMethod: found.row.matchMethod,
    importerOwned: classifyAflApiCensusRow({
      externalId: entry.externalId, status: found.row.status, matchMethod: found.row.matchMethod,
      playerId: found.row.playerId, candidateCount: found.row.candidateCount, externalUrl: found.externalUrl,
    }).kind === 'importer',
  };

  if (lockRows && pc.kind === 'unique' && pPrime.kind === 'unique') {
    await takeCorrectionLocks(tx, entry.externalId, [pc.playerId, pPrime.playerId]);
  }

  let candidateHolders: string[] = [];
  let targetHolders: string[] = [];
  if (pPrime.kind === 'unique') {
    const pPrimeId = pPrime.playerId;
    const holders = await tx<{ externalId: string }[]>`
      SELECT ei.external_id AS "externalId"
        FROM external_identities ei JOIN sources s ON s.id = ei.source_id
       WHERE s.key = ${AFL_API_SOURCE_KEY} AND ei.player_id = ${pPrimeId}
         AND ei.external_id <> ${entry.externalId} AND ei.status IN ('unique', 'resolved')
       ORDER BY ei.external_id
    `;
    candidateHolders = holders.map((h) => h.externalId);
    const others = [...targetHumanProviders].filter(([externalId]) => externalId !== entry.externalId);
    if (others.length > 0) {
      const remaps = await resolveAflApiPlayerIdentities(tx, others.map(([, identity]) => identity));
      targetHolders = others
        .filter(([, identity]) => {
          const remap = remaps.get(identity);
          return remap !== undefined && remap.ok && remap.newPlayerId === pPrimeId;
        })
        .map(([externalId]) => externalId)
        .sort();
    }
  }

  const baseInput: CpcInput = {
    externalId: entry.externalId, adjudicationId: entry.adjudicationId, pc, pPrime, providerRow,
    collisions: { candidateImporterProvidersAtPPrime: candidateHolders, targetHumanProvidersRemappingToPPrime: targetHolders },
    pcStillImplicated: { rowsImplicatingCdIAtPc: 0, unprovableCdILineage: false },
    prediction: null,
  };
  // With no prediction the classifier stops at PREDICT_STOP exactly when UNEVALUABLE, COLLISION
  // and DISAGREE all passed; any other FAIL is final and nothing is planned (or row-locked).
  const pre = classifyCorrectedCandidate(baseInput);
  if (pre.outcome === 'FAIL' && pre.code !== 'PREDICT_STOP') {
    return {
      input: baseInput, result: pre, prediction: null, predicted: null, identityAction: null,
      pcId: pc.kind === 'unique' ? pc.playerId : null, pPrimeId: pPrime.kind === 'unique' ? pPrime.playerId : null,
      identityRow: found === null ? null : found.row,
    };
  }
  if (pc.kind !== 'unique' || pPrime.kind !== 'unique') {
    throw new CorrectionRefused(`internal: CPC reached planning for ${entry.externalId} with an unevaluable identity`);
  }

  const identityAction = identityActionForRow(providerRow, pPrime.playerId);
  const predicted = await predictCorrectionClosure(tx, {
    providerId: entry.externalId, pId: pc.playerId, pPrimeId: pPrime.playerId,
    authority: {
      mode: authorityMode, adjudicationId: entry.adjudicationId, externalId: entry.externalId,
      evidenceSha256: entry.evidenceSha256, previousPlayerIdentity: entry.previousPlayerIdentity,
      playerIdentity: entry.playerIdentity,
    },
    identityAction, lockRows,
  });
  const prediction: CpcPrediction = {
    stops: predicted.stops, moveOrDeleteRowCount: predicted.moveOrDeleteRowCount, fingerprint: predicted.fingerprint,
    plannerVersion: predicted.plan.plannerVersion, moved: predicted.moved, deleted: predicted.deleted,
  };
  const input: CpcInput = {
    ...baseInput,
    prediction,
    pcStillImplicated: providerRow === null
      ? {
        rowsImplicatingCdIAtPc: predicted.moveOrDeleteRowCount,
        unprovableCdILineage: predicted.stops.some((s) => UNPROVABLE_LINEAGE_STOP_CODES.has(s.code)),
      }
      : baseInput.pcStillImplicated,
  };
  return {
    input, result: classifyCorrectedCandidate(input), prediction, predicted, identityAction,
    pcId: pc.playerId, pPrimeId: pPrime.playerId, identityRow: found === null ? null : found.row,
  };
}

/* ==================================================================== *
 * §8.2: the ORIGINAL transaction
 * ==================================================================== */

/** A reported STOP: the plan's stop shape, plus the planner's detail text when one exists. */
export type OutcomeStop = PlanStop & { readonly detail?: string };

/**
 * Slice 8: what the post-transaction reporter needs from a planned ORIGINAL closure. All of it is
 * in memory before COMMIT (the plan's own evidence); the reporter only adds read-only reads.
 */
export type OriginalImpactInput = {
  readonly providerId: string;
  readonly pId: number;
  readonly pPrimeId: number;
  readonly pIdentity: string;
  readonly pPrimeIdentity: string;
  readonly context: CorrectionReportContext;
};

export type CorrectionOutcome =
  | {
    readonly kind: 'STOP'; readonly stops: readonly OutcomeStop[]; readonly fingerprint: string;
    /** S8-D4: the pre-commit report context explaining the STOP (never needs a post-transaction read). */
    readonly report?: CorrectionReportContext;
  }
  | {
    readonly kind: 'ALREADY_SATISFIED'; readonly reports: readonly string[];
    /** Q2's own structured outcomes (target absent, recognised post-correction edits, reappearances). */
    readonly satisfaction?: readonly SatisfactionReportEntry[];
  }
  | {
    readonly kind: 'PLANNED'; readonly fingerprint: string; readonly plan: MutationPlan; readonly reports: readonly string[];
    readonly impact?: OriginalImpactInput;
  }
  | {
    readonly kind: 'COMMITTED' | 'ROLLED_BACK';
    readonly fingerprint: string; readonly adjudicationId: number; readonly batchId: string;
    readonly moved: number; readonly deleted: number; readonly reports: readonly string[];
    readonly impact?: OriginalImpactInput;
    readonly satisfaction?: readonly SatisfactionReportEntry[];
  };

/** The written-outcome member (its `kind` is COMMITTED after --apply, ROLLED_BACK after --dry-run). */
export type WrittenOutcome = Extract<CorrectionOutcome, { kind: 'COMMITTED' | 'ROLLED_BACK' }>;

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

  await proveSession(tx, args.expectDatabase, 'afldb_import');
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
    // Importer-origin and human-origin ORIGINAL P->P' are both an in-place update (D15 supersede
    // write shape); `upgrade_in_place` is reserved for CPC class 2 (already at P', identity-only).
    identityAction: 'update_in_place', manifestOk, lockRows: takeLocks,
  });
  const fingerprint = mutationPlanFingerprint(closure.plan);
  // Slice 8: the post-transaction reporter's input; `closure.context` is outside the fingerprint.
  const impact: OriginalImpactInput = {
    providerId: args.providerId, pId, pPrimeId,
    pIdentity: pIdentity!.identity, pPrimeIdentity: pPrimeIdentity!.identity, context: closure.context,
  };

  if (args.mode === 'validate-only') {
    if (closure.plan.stops.length > 0) return { kind: 'STOP', stops: withStopDetails(closure.plan.stops, closure.context), fingerprint, report: closure.context };
    return { kind: 'PLANNED', fingerprint, plan: closure.plan, reports: closure.reports, impact };
  }

  if (closure.plan.stops.length > 0) return { kind: 'STOP', stops: withStopDetails(closure.plan.stops, closure.context), fingerprint, report: closure.context };

  if (args.mode === 'apply' && fingerprint !== args.expectFingerprint) {
    throw new CorrectionRefused(`REFUSED: recomputed fingerprint ${fingerprint} does not match --expect-fingerprint ${args.expectFingerprint}`);
  }

  /* ---- §8.2 steps 3-10: write ---- */
  const batchId = await openCorrectionBatch(tx, closure.rows.length, ORIGINAL_BATCH_CONTRACT.openNotes);

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
  const validationResultFor = (counts: JsonValue): JsonValue => correctionBatchValidationResult(ORIGINAL_BATCH_CONTRACT, {
    adjudicationId, externalId: args.providerId, adjudicationEvidenceSha256: evidenceFile.sha256,
    closureFingerprint: fingerprint, rows: closure.rows, pPrimeId, counts,
  });
  await bindCorrectionBatch(
    tx, batchId, validationResultFor(correctionCountsFor(closure.rows, 0)), ORIGINAL_BATCH_CONTRACT.boundNotes(adjudicationId),
  );

  await tx`
    UPDATE external_identities
       SET player_id = ${pPrimeId}, status = 'resolved', candidate_count = 0,
           match_method = ${AFL_API_ADMIN_MATCH_METHOD}, external_name = NULL,
           notes = 'AFLDB-ISSUE-238 admin correction; see afl_api_identity_adjudications'
     WHERE id = ${existing.id}
  `;

  // §8.2 step 6: deletes, moves and the typed projections (shared with REPLAY, §8.3 step 5).
  const { moved, deleted, projectionsMoved } = await applyClosureMutations(
    tx, args, { pId, pPrimeId, batchId }, closure.rows,
  );

  // §8.2 step 7: resolve only the ISSUE-240 contradictions this correction adjudicates.
  const resolvedFindings = await resolveAdjudicatedContradictions(tx, args.providerId, pPrimeIdentity!.identity);

  // §8.2 step 8: targeted recompute + byte-identical stat_availability assertion.
  await recomputeAfterClosureMutations(tx, closure.rows, pId, pPrimeId);

  // §8.2 step 9 / §8.4: the post-write re-plan is CORRECTION SATISFACTION (Q2) -- the SAME
  // evaluator a later re-run uses, with K as "the batch of the current transaction".
  const postWrite = await assertPostWriteSatisfactionResult(tx, args.providerId, adjudicationId, Number(batchId));

  // §8.2 step 10: finalise K. The binding fields are unchanged; the counts are the actual ones.
  await finaliseCorrectionBatch(tx, batchId, moved + deleted, validationResultFor(correctionCountsFor(closure.rows, projectionsMoved)));

  // §8.2 step 11 (cache paths, Coleman, findings, candidates, DP-5) is NOT done here: it runs
  // after COMMIT, read-only and best-effort, from `impact` (S8-D1/S8-D2; `main`).
  const reports = [
    ...closure.reports,
    ...postWrite.reports,
    ...(resolvedFindings > 0 ? [`resolved ${resolvedFindings} ISSUE-240 contradiction finding(s) this correction adjudicates`] : []),
  ];

  // The caller (`main`) decides COMMITTED vs ROLLED_BACK by whether it lets `sql.begin()`
  // return normally (apply) or throws to force a real SQL rollback (dry-run) -- this function
  // only ever reports what it actually wrote inside the still-open transaction.
  return {
    kind: 'COMMITTED', fingerprint, adjudicationId, batchId, moved, deleted, reports, impact,
    satisfaction: postWrite.satisfactionReport ?? [],
  };
}

/* ==================================================================== *
 * Shared mechanics: ONE implementation for ORIGINAL (§8.2) and REPLAY (§8.3)
 * ==================================================================== */

/** §8.7: the only columns in which batch K (ORIGINAL) and batch R (REPLAY) differ. */
export type CorrectionBatchContract = {
  readonly mode: 'original' | 'replay';
  readonly context: 'live_target' | 'promotion';
  /** REPLAY only: equals `closureFingerprint` (§8.7). */
  readonly predictedClosureFingerprint: string | null;
  readonly openNotes: string;
  readonly boundNotes: (adjudicationId: number) => string;
};

export const ORIGINAL_BATCH_CONTRACT: CorrectionBatchContract = {
  mode: 'original',
  context: 'live_target',
  predictedClosureFingerprint: null,
  openNotes: 'AFLDB-ISSUE-238 correction; authority afl_api_identity_adjudications id <pending>',
  boundNotes: (adjudicationId) => `AFLDB-ISSUE-238 correction; authority afl_api_identity_adjudications id ${adjudicationId}`,
};

export function replayBatchContract(closureFingerprint: string): CorrectionBatchContract {
  return {
    mode: 'replay',
    context: 'promotion',
    predictedClosureFingerprint: closureFingerprint,
    openNotes: 'AFLDB-ISSUE-238 promotion replay; authority afl_api_identity_adjudications id <pending>',
    boundNotes: (adjudicationId) => `AFLDB-ISSUE-238 promotion replay; authority afl_api_identity_adjudications id ${adjudicationId}`,
  };
}

/** §8.2 step 3 / §8.7: open a `running` batch. Returns its id as text (int8 arrives as a string). */
async function openCorrectionBatch(tx: TransactionSql, recordsRead: number, notes: string): Promise<string> {
  const [batch] = await tx<{ id: string }[]>`
    INSERT INTO import_batches (source_id, tool, target_table, status, records_read, notes)
    VALUES (
      (SELECT id FROM sources WHERE key = ${AFL_API_SOURCE_KEY}), ${TOOL}, 'canonical_applications',
      'running', ${recordsRead},
      ${notes}
    )
    RETURNING id::text AS id
  `;
  return batch.id;
}

/** §8.7 `validation_result`: the ORIGINAL keys, plus `predictedClosureFingerprint` for REPLAY. */
function correctionBatchValidationResult(
  contract: CorrectionBatchContract,
  input: {
    readonly adjudicationId: number; readonly externalId: string; readonly adjudicationEvidenceSha256: string;
    readonly closureFingerprint: string; readonly rows: readonly BuiltRow[]; readonly pPrimeId: number;
    readonly counts: JsonValue;
  },
): JsonValue {
  const rowProofs: RowProof[] = input.rows.map((row): RowProof => (row.disposition === 'MOVE'
    ? { table: row.table, verb: 'update', oldKey: row.naturalKey, newKey: movedNaturalKey(row, input.pPrimeId), preCorrectionContractSha256: row.contractSha256 }
    : { table: row.table, verb: 'delete', oldKey: row.naturalKey, newKey: null, preCorrectionContractSha256: row.contractSha256 }));
  return {
    kind: 'afl_api_identity_correction', mode: contract.mode, context: contract.context,
    plannerVersion: PLANNER_VERSION, adjudicationId: input.adjudicationId, externalId: input.externalId,
    adjudicationEvidenceSha256: input.adjudicationEvidenceSha256, closureFingerprint: input.closureFingerprint,
    ...(contract.predictedClosureFingerprint === null ? {} : { predictedClosureFingerprint: contract.predictedClosureFingerprint }),
    mutationEligibility: 'PASS', rowProofs: rowProofs.map(rowProofJson), counts: input.counts,
  };
}

function correctionCountsFor(rows: readonly BuiltRow[], projectionsMoved: number): JsonValue {
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
}

/** §8.2 step 5: bind the batch to A BEFORE any canonical mutation. */
async function bindCorrectionBatch(tx: TransactionSql, batchId: string, validationResult: JsonValue, notes: string): Promise<void> {
  await tx`
    UPDATE import_batches
       SET validation_result = ${jsonbOf(tx, validationResult)},
           notes = ${notes}
     WHERE id = ${batchId}::bigint AND status = 'running'
    RETURNING id
  `.then((r) => {
    if (r.length !== 1) throw new CorrectionRefused('REFUSED: binding the correction batch did not affect exactly one row');
  });
}

/** §8.2 step 10: finalise the batch. The binding fields are unchanged; the counts are the actual ones. */
async function finaliseCorrectionBatch(
  tx: TransactionSql, batchId: string, recordsInserted: number, validationResult: JsonValue,
): Promise<void> {
  await tx`
    UPDATE import_batches
       SET status = 'completed', completed_at = now(), records_inserted = ${recordsInserted},
           records_updated = 0, records_rejected = 0,
           validation_result = ${jsonbOf(tx, validationResult)}
     WHERE id = ${batchId}::bigint AND status = 'running'
    RETURNING id
  `.then((r) => {
    if (r.length !== 1) throw new CorrectionRefused('REFUSED: batch finalisation did not affect exactly one row');
  });
}

/**
 * §8.2 step 6 (also §8.3 step 5): the canonical MOVE/DELETE mutations with their
 * `canonical_applications` rows (`import_batch_id = batchId`), then EVERY typed projection row of
 * CD_I still naming P. The only statements it issues are `canonical_applications` INSERTs,
 * UPDATE/DELETE of the planned closure rows, and the two projection UPDATEs.
 */
async function applyClosureMutations(
  tx: TransactionSql,
  args: { readonly providerId: string },
  ids: { readonly pId: number; readonly pPrimeId: number; readonly batchId: string },
  closureRows: readonly BuiltRow[],
): Promise<{ moved: number; deleted: number; projectionsMoved: number }> {
  const { pId, pPrimeId, batchId } = ids;
  let moved = 0;
  let deleted = 0;

  // Deletes first (§8.2 step 6: "deletes first so no UNIQUE is transiently violated"). Every
  // row here has been held under `FOR UPDATE` continuously since `buildClosure` computed its
  // `contractSha256` (§8.2 step 1's row locks), so no writer outside this transaction could have
  // changed it since; the re-check below is the literal "conditional write" the runbook requires
  // (§8.2 step 6) and is defence in depth against a bug elsewhere in this same transaction, not
  // a race with another session.
  for (const row of closureRows.filter((r) => r.disposition === 'DELETE_AS_FOREIGN_COLLISION')) {
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

  for (const row of closureRows.filter((r) => r.disposition === 'MOVE')) {
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

  const projectionsMoved = await moveProviderProjections(tx, args, pId, pPrimeId);

  return { moved, deleted, projectionsMoved };
}

/**
 * §8.2 step 6, "move the typed projection rows where present": EVERY typed projection row of
 * CD_I that still names P, in both tables -- the MOVE rows' (P5 / L8-c), a C2/C4 DELETE's, and
 * any stray one attached to no closure row. They are CD_I's own observations and CD_I is now
 * P′; SAT-5 (§5.12, "no typed projection ... names P for CD_I") checks exactly this set in the
 * post-write re-plan. A failure here is a real error and rolls the whole correction back.
 * Returns how many projection rows moved.
 */
async function moveProviderProjections(
  tx: TransactionSql, args: { readonly providerId: string }, pId: number, pPrimeId: number,
): Promise<number> {
  let projectionsMoved = 0;
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
  return projectionsMoved;
}

/** §8.2 step 8: targeted recompute + byte-identical `stat_availability` assertion (§4.D). */
async function recomputeAfterClosureMutations(
  tx: TransactionSql, closureRows: readonly BuiltRow[], pId: number, pPrimeId: number,
): Promise<void> {
  const affectedSeasons = new Set(closureRows.map((r) => (r.table === 'player_match_stats' ? Number(r.naturalKey.match_id) : null)).filter((x): x is number => x !== null));
  const seasonRows = await tx<{ season: number }[]>`
    SELECT DISTINCT season FROM matches WHERE id = ANY(${[...affectedSeasons]})
  `;
  const brownlowSeasons = new Set(closureRows.filter((r) => r.table === 'brownlow_round_votes').map((r) => Number(r.naturalKey.season)));
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
}

/** §8.2 step 9 / §8.4: the post-write CORRECTION SATISFACTION re-plan; a failure rolls the transaction back. */
async function assertPostWriteSatisfaction(
  tx: TransactionSql, providerId: string, adjudicationId: number, currentBatchId: number | null,
  preSwapPromotion?: AflApiPreSwapPromotionContract,
): Promise<readonly string[]> {
  return (await assertPostWriteSatisfactionResult(tx, providerId, adjudicationId, currentBatchId, preSwapPromotion)).reports;
}

/** The same re-plan, returning Q2's whole result (ORIGINAL reports its structured outcomes). */
async function assertPostWriteSatisfactionResult(
  tx: TransactionSql, providerId: string, adjudicationId: number, currentBatchId: number | null,
  preSwapPromotion?: AflApiPreSwapPromotionContract,
): Promise<CorrectionSatisfactionResult> {
  const postWrite = await checkCorrectionSatisfaction(dbCorrectionSatisfactionReader(tx), {
    providerId, adjudicationId, currentBatchId, ...(preSwapPromotion === undefined ? {} : { preSwapPromotion }),
  });
  if (!postWrite.satisfied) {
    throw new CorrectionRefused(
      `REFUSED: post-write CORRECTION SATISFACTION re-plan failed -- STOP, rollback: ${postWrite.stops.map(describeStop).join('; ')}`,
    );
  }
  return postWrite;
}

/** §8.2 step 8's before/after read. A read failure propagates and rolls the correction back: an
 * empty default on both sides would compare byte-identical and fake the assertion's PASS. The rows
 * are ordered by `stat_key` (the PK is (stat_key, season)): the comparison is an order-sensitive
 * `canonicalJson` array, and `recomputeBrownlowCoverage` rewrites the rows, so an unordered scan can
 * return the same set in a different physical order and refuse spuriously (ISSUE-238 D13). */
export async function readStatAvailability(tx: TransactionSql, season: number): Promise<unknown> {
  return tx<Record<string, JsonValue>[]>`
    SELECT * FROM stat_availability WHERE season = ${season} ORDER BY stat_key
  `;
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

/** §5.7, S8-D4: the STOPs as printed -- the plan's own STOP objects (fingerprinted, never
 * modified), each copied with the named evidence the report context recorded for its index. */
export function withStopDetails(
  stops: readonly PlanStop[], context: Pick<CorrectionReportContext, 'stopDetails'>,
): OutcomeStop[] {
  return stops.map((s, index) => {
    const detail = context.stopDetails?.find((d) => d.index === index)?.detail;
    return detail === undefined ? s : { ...s, detail };
  });
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
  /**
   * AFLDB-ISSUE-238: the stage-aware PRE-SWAP promotion contract, passed ONLY by the promotion REPLAY (7.4e)
   * and CRV. Absent everywhere else (ordinary correction, rebuild, post-swap, E3): SAT-1 is then the strict
   * whole-table invariant, unchanged.
   */
  readonly preSwapPromotion?: AflApiPreSwapPromotionContract;
  /** SAT-5: every typed projection row of CD_I, attached to a bound row or not. */
  readonly providerProjections: readonly ProviderProjectionRow[];
};

export type CorrectionSatisfactionResult = {
  readonly satisfied: boolean;
  readonly stops: readonly OutcomeStop[];
  readonly reports: readonly string[];
  readonly correctedPlayerId: number | null;
  /** Slice 8: the same outcomes as `reports`, structured (report-only; decides nothing). */
  readonly satisfactionReport?: readonly SatisfactionReportEntry[];
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
  /** Slice 8: `reports`' reportable outcomes, structured. Absent = none. */
  readonly entries?: readonly SatisfactionReportEntry[];
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
  const entries: SatisfactionReportEntry[] = []; // Slice 8: structured copies of the report lines below
  const fail = (stop: Stop, reports: string[] = [], laterThroughCdI = false): RowVerdict => ({
    result: { ok: false, stop }, stopRef, reports, laterOldKeyApplicationThroughCdI: laterThroughCdI, entries,
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
    entries.push({ kind: 'post_correction_reappearance', table, key: canonicalJson(move.derivedOldKey) });
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
    // The audit the (unchanged) predicate above accepted, named for the report.
    const deletionAudit = move.audits.find((a) => (
      a.afterCorrection && a.tableName === 'matches' && a.rowId === matchId && a.fieldGroup === 'match_deletion'));
    entries.push({ kind: 'correction_target_absent', table, key: keyLabel, matchId, auditId: deletionAudit?.id ?? null });
    return { result: { ok: true }, stopRef, reports, laterOldKeyApplicationThroughCdI: laterAtOldKey, entries };
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
  if (reownedByBrownlowAdmin) {
    reports.push(`post_correction_edit brownlow_admin_reowned: ${table} ${keyLabel} (audit ${String(reownershipAuditId)})`);
    entries.push({
      kind: 'post_correction_edit', table, key: keyLabel, writer: 'brownlow_admin_reowned', field: null,
      from: null, to: null, auditId: reownershipAuditId,
    });
  }
  for (const edit of l8.postCorrectionEdits) {
    const divergence = divergences.find((d) => d.field === edit.field);
    reports.push(`post_correction_edit ${edit.writer}: ${table} ${keyLabel} ${edit.field} ${canonicalJson(divergence?.reconstructed ?? null)} -> ${canonicalJson(divergence?.current ?? null)} (audit ${edit.auditId})`);
    entries.push({
      kind: 'post_correction_edit', table, key: keyLabel, writer: edit.writer, field: edit.field,
      from: divergence?.reconstructed ?? null, to: divergence?.current ?? null, auditId: edit.auditId,
    });
  }
  reports.push(`NOOP already_corrected_moved: ${table} ${keyLabel}`);
  return { result: { ok: true }, stopRef, reports, laterOldKeyApplicationThroughCdI: laterAtOldKey, entries };
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
  del: Q2DeleteEvidence,
  context: { readonly providerId: string; readonly pId: number; readonly pPrimeId: number; readonly aflApiSourceId: number },
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

  // D-5 "satisfies L5". The typed projection is still verified, but against P′: the correction
  // moved every CD_I projection naming P to P′ in the same transaction (§8.2 step 6, SAT-5), so
  // after it the projection must name P′ -- exactly as `evaluateBoundMove` checks it (D12).
  const attribution = attributionOverHistory(table, preCorrection, context.providerId, context.pPrimeId, del.projectionPlayerId);
  if (!attribution.ok) return fail(attribution.stop);
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
  /** The stage-aware pre-swap contract (promotion REPLAY / CRV only). Omitted = the strict whole-table invariant. */
  readonly preSwap?: AflApiPreSwapPromotionContract;
}): string[] {
  const { facts } = input;
  const invariant = checkAflApiIdentityInvariant({
    rows: facts.censusRows, ledgerRows: facts.ledgerRows, identityByPlayerId: facts.identityByPlayerId,
  });
  const problems = input.preSwap === undefined
    ? invariant.map((p): string => JSON.stringify(p))
    : preSwapInvariantProblems(facts, invariant, input.preSwap);
  for (const [externalId, row] of netLedgerRowsByExternalId(facts.ledgerRows)) {
    if (externalId === input.providerId || !aflApiNetIsHumanLive(row.action)) continue;
    if (row.playerIdentity === input.pPrimeIdentity || Number(row.playerId) === input.pPrimeId) {
      problems.push(`${externalId} is net ${row.action} to P′ (${row.playerIdentity}), colliding with ${input.providerId}`);
    }
  }
  return problems;
}

/**
 * The stage-aware form of SAT-1's whole-table invariant for the promotion's pre-swap stages. EVERY invariant problem is
 * kept except the `ledger_without_row` mismatches of exactly the pending-D15 providers the bound artefact declares
 * (`applyAflApiPendingD15`: each bound to its net ledger row, absent from `C_promotion`, unresolved, and observed). Every
 * `row_without_ledger`, every undeclared `ledger_without_row` and every other problem stays a refusal.
 */
function preSwapInvariantProblems(
  facts: IdentityInvariantFacts, invariant: ReturnType<typeof checkAflApiIdentityInvariant>, contract: AflApiPreSwapPromotionContract,
): string[] {
  const mismatches = invariant.flatMap((p) => (p.kind === 'bijection_mismatch' ? [p.mismatch] : []));
  const others = invariant.filter((p) => p.kind !== 'bijection_mismatch');
  const resolvedRows = censusAflApiRows(facts.censusRows).humanRows
    .map((r) => ({ externalId: r.externalId, status: r.status, matchMethod: r.matchMethod }));
  const { remaining, contractProblems } = applyAflApiPendingD15({ ledgerRows: facts.ledgerRows, resolvedRows, mismatches, contract });
  return [
    ...others.map((p): string => JSON.stringify(p)),
    ...remaining.map((m): string => JSON.stringify({ kind: 'bijection_mismatch', mismatch: m })),
    ...contractProblems.map((p): string => JSON.stringify(p)),
  ];
}

/**
 * The pending-D15 declaration's own binding to the facts in front of the caller (no bijection verdict): every declared
 * provider is bound to its net `linked` ledger row and identity, is not in `C_promotion`, is listed once, holds no
 * `resolved` row, and shows its expected `ledger_without_row`. `[]` = bound. Used by the REPLAY before it writes.
 */
export function pendingD15BindingProblems(facts: IdentityInvariantFacts, contract: AflApiPreSwapPromotionContract): string[] {
  const invariant = checkAflApiIdentityInvariant({
    rows: facts.censusRows, ledgerRows: facts.ledgerRows, identityByPlayerId: facts.identityByPlayerId,
  });
  const mismatches = invariant.flatMap((p) => (p.kind === 'bijection_mismatch' ? [p.mismatch] : []));
  const resolvedRows = censusAflApiRows(facts.censusRows).humanRows
    .map((r) => ({ externalId: r.externalId, status: r.status, matchMethod: r.matchMethod }));
  return applyAflApiPendingD15({ ledgerRows: facts.ledgerRows, resolvedRows, mismatches, contract })
    .contractProblems.map((p): string => JSON.stringify(p));
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
  const satisfactionReport: SatisfactionReportEntry[] = [];
  const satStop = (step: string, code: StopCode, detail: string): OutcomeStop => ({ table: 'player_match_stats', rowId: null, step, code, detail });
  const failed = (stops: OutcomeStop[]): CorrectionSatisfactionResult => ({
    satisfied: false, stops, reports, correctedPlayerId: evidence.correctedPlayerId, satisfactionReport,
  });

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
    preSwap: evidence.preSwapPromotion,
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
    satisfactionReport.push(...(verdict.entries ?? []));
    laterApplicationAtOldKeyThroughCdI ||= verdict.laterOldKeyApplicationThroughCdI;
    if (!verdict.result.ok) rowStops.push({ ...verdict.stopRef, ...verdict.result.stop });
  }
  for (const del of evidence.deletes) {
    const verdict = evaluateBoundDelete(del, { providerId: evidence.providerId, pId, pPrimeId, aflApiSourceId: evidence.aflApiSourceId });
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
  return { satisfied: true, stops: [], reports, correctedPlayerId: pPrimeId, satisfactionReport };
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
  input: {
    readonly providerId: string; readonly adjudicationId: number; readonly currentBatchId: number | null;
    readonly preSwapPromotion?: AflApiPreSwapPromotionContract;
  },
): Promise<CorrectionSatisfactionEvidence> {
  const { providerId, adjudicationId, currentBatchId, preSwapPromotion } = input;
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
    ...(preSwapPromotion === undefined ? {} : { preSwapPromotion }),
  };
}

/** Gather + evaluate: the single Q2 entry point both callers use. */
export async function checkCorrectionSatisfaction(
  reader: CorrectionSatisfactionReader,
  input: {
    readonly providerId: string; readonly adjudicationId: number; readonly currentBatchId: number | null;
    /** Promotion REPLAY / CRV only (AFLDB-ISSUE-238 stage-aware pre-swap SAT-1). Omitted = strict. */
    readonly preSwapPromotion?: AflApiPreSwapPromotionContract;
  },
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
  // §8.5: no batch, no ledger row, no mutation -- so no cache/Coleman/dependent impact is carried;
  // only Q2's own reportable outcomes (target absent, recognised post-correction edits).
  return { kind: 'ALREADY_SATISFIED', reports: q2.reports, satisfaction: q2.satisfactionReport ?? [] };
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

export function dbCorrectionSatisfactionReader(tx: TransactionSql): CorrectionSatisfactionReader {
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

/*
 * §8.2 step 11 (Slice 8). The ORIGINAL report has two halves:
 *   - the pre-commit CONTEXT (`CorrectionReportContext`): §5.10 verdicts, DP-3/DP-4, the artefact
 *     recurrence risk. It is built inside the transaction from evidence the plan already read, so a
 *     STOP is fully explained without any later read (S8-D4);
 *   - the post-transaction IMPACT (`ImpactReport`): cache paths, Coleman, open findings, pending
 *     candidates, DP-5. It is read AFTER the transaction has finished (COMMIT for --apply, the
 *     forced ROLLBACK for --dry-run / --validate-only), in separate READ ONLY transactions, one per
 *     section, best-effort (S8-D2). A failed section makes the report incomplete; it never touches
 *     the correction's own outcome.
 * Nothing here invalidates a cache, recomputes Coleman, resolves a finding or writes anything
 * (S8-D1). Promotion and rebuild REPLAY never call it (S8-D3).
 */

/** O-4: the one CLI-reachable cache refresh (`docs/deployment.md`, ISSUE-134). Printed, never run. */
export function seasonRevalidationCommand(season: number): string {
  return 'curl -s -X POST http://127.0.0.1:3100/api/internal/revalidate-season'
    + ' -H "x-afldb-revalidate-secret: $(grep \'^AFLDB_REVALIDATE_SECRET=\' .env | cut -d= -f2-)"'
    + ` -H 'content-type: application/json' -d '{"season":${season}}'`;
}

/** §4.F: the operator command that refreshes the derived Coleman winners. Printed, never run. */
export const COLEMAN_REFRESH_COMMAND = 'python tools/migration/import_awards.py --groups coleman';

export type ImpactReport = {
  readonly phase: ImpactPhase;
  /** Each section is null when it could not be gathered (named in `incomplete`). */
  readonly cache: CacheImpact | null;
  readonly coleman: readonly ColemanSeasonImpact[] | null;
  readonly findings: readonly FindingReport[] | null;
  readonly pendingCandidates: readonly PendingCandidateReport[] | null;
  /** §5.11 DP-5 (report only). */
  readonly debutChanges: readonly DependentReportEntry[] | null;
  readonly incomplete: readonly { readonly section: string; readonly error: string }[];
};

/** The read-only facts the post-transaction report needs. `dbImpactReportReader` is the only DB one. */
export type ImpactReportReader = {
  readonly playerSlugs: (ids: readonly number[]) => Promise<ReadonlyMap<number, string>>;
  readonly clubSlugs: (ids: readonly number[]) => Promise<ReadonlyMap<number, string>>;
  /** `first_season` of `data/reference/coleman-derivation.json`; throws when the contract is unusable. */
  readonly colemanFirstSeason: () => number;
  readonly colemanMatchFacts: (matchIds: readonly number[]) => Promise<readonly {
    readonly matchId: number; readonly season: number; readonly isFinal: boolean; readonly seasonComplete: boolean;
  }[]>;
  /** Seasons in which one of `playerIds` is a current Coleman `award_winners` row. */
  readonly colemanWinnerSeasons: (playerIds: readonly number[], seasons: readonly number[]) => Promise<ReadonlySet<number>>;
  readonly findingRows: (scope: FindingScope) => Promise<readonly OpenFindingRow[]>;
  readonly candidateRows: (scope: { readonly providerId: string; readonly pId: number }) => Promise<readonly PendingCandidateRow[]>;
  readonly firstKickGoals: (playerIds: readonly number[]) => Promise<readonly FirstKickGoalRow[]>;
  /** Every current `player_match_stats` participation of each player, keyed by player id. */
  readonly careers: (playerIds: readonly number[]) => Promise<ReadonlyMap<number, readonly CareerMatch[]>>;
  readonly matchCareerFacts: (matchIds: readonly number[]) => Promise<readonly CareerMatch[]>;
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Gather the post-transaction impact, one section at a time. It never throws: a section that fails
 * is recorded in `incomplete` and the rest are still gathered.
 */
export async function gatherImpactReport(
  reader: ImpactReportReader, input: OriginalImpactInput, phase: ImpactPhase,
): Promise<ImpactReport> {
  const incomplete: { section: string; error: string }[] = [];
  const section = async <T>(name: string, gather: () => Promise<T>): Promise<T | null> => {
    try {
      return await gather();
    } catch (error) {
      incomplete.push({ section: name, error: describeError(error) });
      return null;
    }
  };
  const { pId, pPrimeId } = input;
  const rows = input.context.closureRows;
  const pmsRows = rows.filter((r): r is ClosureImpactRow & { matchId: number } => r.table === 'player_match_stats' && r.matchId !== null);
  const pmsMatchIds = [...new Set(pmsRows.map((r) => r.matchId))].sort((a, b) => a - b);

  const cache = await section('cache paths', async () => {
    if (rows.length === 0) return affectedCachePaths({ rows, players: [], clubSlugs: new Map() });
    const slugs = await reader.playerSlugs([pId, pPrimeId]);
    const clubIds = [...new Set(pmsRows.flatMap((r) => (r.clubId === null ? [] : [r.clubId])))];
    return affectedCachePaths({
      rows,
      players: [pId, pPrimeId].map((id) => ({ id, slug: slugs.get(id) ?? null })),
      clubSlugs: clubIds.length === 0 ? new Map() : await reader.clubSlugs(clubIds),
    });
  });

  const coleman = await section('Coleman', async () => {
    if (pmsRows.length === 0) return [];
    const firstSeason = reader.colemanFirstSeason();
    const facts = new Map((await reader.colemanMatchFacts(pmsMatchIds)).map((f) => [f.matchId, f]));
    const colemanRows: ColemanRowFacts[] = pmsRows.map((r) => {
      const f = facts.get(r.matchId);
      if (f === undefined) throw new Error(`match ${r.matchId} of player_match_stats#${r.rowId} was not found`);
      return { rowId: r.rowId, season: f.season, matchId: r.matchId, isFinal: f.isFinal, seasonComplete: f.seasonComplete, goals: r.goals };
    });
    const seasons = [...new Set(colemanRows.map((r) => r.season))];
    return evaluateColemanImpact({
      rows: colemanRows, firstSeason, winnerSeasonsForPOrPPrime: await reader.colemanWinnerSeasons([pId, pPrimeId], seasons),
    });
  });

  const scope: FindingScope = {
    providerId: input.providerId, pId, pPrimeId, pIdentity: input.pIdentity, pPrimeIdentity: input.pPrimeIdentity,
  };
  const findings = await section('open findings', async () => selectOpenFindings(await reader.findingRows(scope), scope));
  const pendingCandidates = await section('pending promotion candidates', async () => selectPendingCandidates(
    await reader.candidateRows({ providerId: input.providerId, pId }), { providerId: input.providerId, pId },
  ));

  const debutChanges = await section('DP-5 first-kick-goal debut', async () => {
    if (pmsRows.length === 0) return [];
    const firstKickGoals = await reader.firstKickGoals([pId, pPrimeId]);
    if (firstKickGoals.length === 0) return [];
    const careers = await reader.careers([pId, pPrimeId]);
    const closureMatches = new Map((await reader.matchCareerFacts(pmsMatchIds)).map((m) => [m.matchId, m]));
    const pick = (disposition: ClosureImpactRow['disposition']): CareerMatch[] => pmsRows
      .filter((r) => r.disposition === disposition)
      .map((r) => {
        const m = closureMatches.get(r.matchId);
        if (m === undefined) throw new Error(`match ${r.matchId} of player_match_stats#${r.rowId} was not found`);
        return m;
      });
    const moved = pick('MOVE');
    const deleted = pick('DELETE_AS_FOREIGN_COLLISION');
    const { pBefore, pPrimeBefore } = careersBeforeCorrection({
      phase, pCurrent: careers.get(pId) ?? [], pPrimeCurrent: careers.get(pPrimeId) ?? [], moved, deleted,
    });
    return evaluateFirstKickGoalDebutChanges({ pId, pPrimeId, pBefore, pPrimeBefore, moved, deleted, firstKickGoals });
  });

  return { phase, cache, coleman, findings, pendingCandidates, debutChanges, incomplete };
}

type Db = ReturnType<typeof postgres>;

/** One reporting read, in its own READ ONLY transaction (PostgreSQL itself refuses any write). */
async function readOnlyReport<T>(sql: Db, read: (tx: TransactionSql) => Promise<T>): Promise<T> {
  return (await sql.begin('isolation level read committed read only', read)) as unknown as T;
}

function readColemanFirstSeason(): number {
  const contract = JSON.parse(readFileSync(join(REPO_ROOT, 'data', 'reference', 'coleman-derivation.json'), 'utf8')) as unknown;
  if (!isPlainObject(contract) || !Number.isInteger(contract.first_season) || contract.completed_seasons_only !== true) {
    throw new Error('data/reference/coleman-derivation.json lacks an integer first_season or completed_seasons_only: true');
  }
  return contract.first_season as number;
}

/** The post-transaction reads. SELECT only, each in a READ ONLY transaction, never inside the correction's. */
export function dbImpactReportReader(sql: Db): ImpactReportReader {
  return {
    playerSlugs: (ids) => readOnlyReport(sql, async (tx) => new Map((await tx<{ id: number; slug: string }[]>`
      SELECT id, slug FROM players WHERE id = ANY(${tx.array([...ids])}::int[])
    `).map((r) => [r.id, r.slug]))),
    clubSlugs: (ids) => readOnlyReport(sql, async (tx) => new Map((await tx<{ id: number; slug: string }[]>`
      SELECT id, slug FROM clubs WHERE id = ANY(${tx.array([...ids])}::int[])
    `).map((r) => [r.id, r.slug]))),
    colemanFirstSeason: readColemanFirstSeason,
    colemanMatchFacts: (matchIds) => readOnlyReport(sql, (tx) => tx<{ matchId: number; season: number; isFinal: boolean; seasonComplete: boolean }[]>`
      SELECT m.id AS "matchId", m.season::int AS season, m.is_final AS "isFinal",
             (s.status::text = 'complete') AS "seasonComplete"
        FROM matches m JOIN seasons s ON s.year = m.season
       WHERE m.id = ANY(${tx.array([...matchIds])}::int[])
    `),
    colemanWinnerSeasons: (playerIds, seasons) => readOnlyReport(sql, async (tx) => new Set((await tx<{ season: number }[]>`
      SELECT DISTINCT aw.season::int AS season
        FROM award_winners aw JOIN awards a ON a.id = aw.award_id
       WHERE a.slug = 'coleman' AND aw.player_id = ANY(${tx.array([...playerIds])}::int[])
         AND aw.season = ANY(${tx.array([...seasons])}::int[])
    `).map((r) => r.season))),
    findingRows: (scope) => readOnlyReport(sql, (tx) => {
      const suffix = `|${scope.providerId}`;
      const players = [String(scope.pId), String(scope.pPrimeId)];
      const identities = [scope.pIdentity, scope.pPrimeIdentity];
      return tx<OpenFindingRow[]>`
        SELECT id::text AS id, issue_type AS "issueType", issue_key AS "issueKey",
               (resolved_at IS NOT NULL) AS resolved, details
          FROM data_issues
         WHERE resolved_at IS NULL
           AND ((issue_type = 'canonical_apply_failed' AND details->>'source_key' = ${AFL_API_SOURCE_KEY}
                  AND right(details->>'external_record_id', ${suffix.length}::int) = ${suffix})
             OR (issue_type = 'afl_api_identity_contradiction' AND (
                  details->>'external_id' = ${scope.providerId} OR details->>'existing_external_id' = ${scope.providerId}
                  OR details->>'proposed_player_id' = ANY(${tx.array(players)}::text[])
                  OR details->>'existing_player_id' = ANY(${tx.array(players)}::text[])
                  OR details->>'proposed_player_identity' = ANY(${tx.array(identities)}::text[])
                  OR details->>'existing_player_ref' = ANY(${tx.array(identities)}::text[]))))
         ORDER BY id
      `;
    }),
    candidateRows: (scope) => readOnlyReport(sql, (tx) => {
      const suffix = `|${scope.providerId}`;
      return tx<PendingCandidateRow[]>`
        SELECT id::text AS id, family, external_record_id AS "externalRecordId", target_table AS "targetTable",
               verb, season::int AS season, status, proposed_fields->>'player_id' AS "proposedPlayerId"
          FROM promotion_candidates
         WHERE status = 'pending'
           AND (right(external_record_id, ${suffix.length}::int) = ${suffix}
                OR proposed_fields->>'player_id' = ${String(scope.pId)})
         ORDER BY id
      `;
    }),
    firstKickGoals: (playerIds) => readOnlyReport(sql, (tx) => tx<FirstKickGoalRow[]>`
      SELECT id, player_id AS "playerId", match_id AS "matchId", season::int AS season
        FROM player_achievements
       WHERE achievement_type = 'first_kick_goal' AND player_id = ANY(${tx.array([...playerIds])}::int[])
    `),
    // `(match_date, match_id)` is the derived career order (player-derived.ts); a NULL date sorts
    // last there (ASC NULLS LAST), which the '9999-12-31' stand-in reproduces for string order.
    careers: (playerIds) => readOnlyReport(sql, async (tx) => {
      const rows = await tx<(CareerMatch & { playerId: number })[]>`
        SELECT pms.player_id AS "playerId", pms.match_id AS "matchId",
               COALESCE(m.match_date::text, '9999-12-31') AS "matchDate", m.season::int AS season
          FROM player_match_stats pms JOIN matches m ON m.id = pms.match_id
         WHERE pms.player_id = ANY(${tx.array([...playerIds])}::int[])
      `;
      const out = new Map<number, CareerMatch[]>();
      for (const { playerId, ...m } of rows) out.set(playerId, [...(out.get(playerId) ?? []), m]);
      return out;
    }),
    matchCareerFacts: (matchIds) => readOnlyReport(sql, (tx) => tx<CareerMatch[]>`
      SELECT id AS "matchId", COALESCE(match_date::text, '9999-12-31') AS "matchDate", season::int AS season
        FROM matches WHERE id = ANY(${tx.array([...matchIds])}::int[])
    `),
  };
}

/**
 * §8.2 step 11's lifecycle: gather (best-effort) and render. It never throws for a COMMITTED
 * outcome: a failed report is "report incomplete" and the correction stays COMMITTED (exit 0).
 * STOP and ALREADY_SATISFIED are rendered from what the transaction already holds, with no read.
 */
export async function reportAfterTransaction(
  outcome: CorrectionOutcome, args: CorrectionArgs,
  gather: (input: OriginalImpactInput, phase: ImpactPhase) => Promise<ImpactReport>,
): Promise<{ readonly text: string; readonly exitCode: number }> {
  const exitCode = outcome.kind === 'STOP' ? 1 : 0;
  let impact: ImpactReport | null = null;
  if ((outcome.kind === 'PLANNED' || outcome.kind === 'COMMITTED' || outcome.kind === 'ROLLED_BACK') && outcome.impact) {
    const phase: ImpactPhase = outcome.kind === 'COMMITTED' ? 'committed' : 'prospective';
    try {
      impact = await gather(outcome.impact, phase);
    } catch (error) {
      impact = {
        phase, cache: null, coleman: null, findings: null, pendingCandidates: null, debutChanges: null,
        incomplete: [{ section: 'report', error: describeError(error) }],
      };
    }
  }
  try {
    return { text: formatOutcome(outcome, args, impact), exitCode };
  } catch (error) {
    if (outcome.kind !== 'COMMITTED') throw error;
    return { text: formatCommittedReportIncomplete(outcome, error), exitCode: 0 };
  }
}

/** A COMMITTED correction whose report could not be produced at all: never "nothing was written". */
export function formatCommittedReportIncomplete(outcome: WrittenOutcome, error: unknown): string {
  return [
    `  COMMITTED: fingerprint ${outcome.fingerprint}`,
    `    adjudication id ${outcome.adjudicationId}, batch id ${outcome.batchId}`,
    `    moved ${outcome.moved}, deleted ${outcome.deleted}`,
    `  REPORT INCOMPLETE: ${describeError(error)}`,
    '    the correction IS COMMITTED and was not rolled back; only the post-commit report is missing',
  ].join('\n');
}

function formatDependentEntry(d: DependentReportEntry): string[] {
  return [`      ${d.rule} ${d.outcome}: ${d.detail}`, ...d.refreshPath.map((p) => `        refresh (report only): ${p}`)];
}

/** The pre-commit context: §5.10 verdicts, artefact risk, DP-3/DP-4 (every phase, STOP included). */
function formatReportContext(context: CorrectionReportContext): string[] {
  const lines = ['    §5.10 season-total verdicts:'];
  if (context.seasonVerdicts.length === 0) lines.push('      no affected season');
  for (const v of context.seasonVerdicts) {
    lines.push(`      season ${v.season}: ${v.verdict} ${v.rule} (${v.seasonClass})`
      + (v.stop ? ` [${v.stop.step}] ${v.stop.code}` : '') + `: ${v.proof}`);
    for (const check of v.failedChecks) lines.push(`        failed: ${check}`);
  }
  lines.push('    artefact recurrence risk (§4.G, O-3; report only):');
  for (const risk of context.artefactRisk) lines.push(`      - ${risk}`);
  lines.push('    dependents (§5.11 DP-3/DP-4):');
  if (context.dependents.length === 0) lines.push('      none');
  for (const d of context.dependents) lines.push(...formatDependentEntry(d));
  return lines;
}

function formatSatisfactionEntries(entries: readonly SatisfactionReportEntry[]): string[] {
  if (entries.length === 0) return [];
  const lines = ['    correction satisfaction outcomes (§5.12; already decided by Q2):'];
  for (const e of entries) {
    if (e.kind === 'correction_target_absent') {
      lines.push(`      correction_target_absent (satisfied): ${e.table} ${e.key}, match ${String(e.matchId)} deleted after the correction (audit ${String(e.auditId)})`);
    } else if (e.kind === 'post_correction_edit') {
      lines.push(`      post_correction_edit ${e.writer} (PASS): ${e.table} ${e.key}`
        + (e.field === null ? '' : ` ${e.field} ${canonicalJson(e.from)} -> ${canonicalJson(e.to)}`)
        + ` (audit ${String(e.auditId)})`);
    } else {
      lines.push(`      post_correction_reappearance: ${e.table} ${e.key} (a new row not attributed through the provider; not touched)`);
    }
  }
  return lines;
}

/** The post-transaction impact; `impact` null = not gathered. */
function formatImpact(impact: ImpactReport | null): string[] {
  if (impact === null) return ['    post-transaction report: not gathered'];
  const committed = impact.phase === 'committed';
  const verb = committed ? 'affected' : 'would affect';
  const lines = [committed
    ? '    POST-COMMIT REPORT (read-only reads after COMMIT; nothing invalidated, recomputed or resolved):'
    : '    PROSPECTIVE REPORT (would affect -- nothing was committed; read-only; nothing invalidated):'];

  lines.push('    cache (§4.H, D10/O-4):');
  if (impact.cache === null) lines.push('      unavailable (see REPORT INCOMPLETE)');
  else if (!impact.cache.canonicalRowsChanged) {
    lines.push(`      no canonical row ${committed ? 'was' : 'would be'} moved or deleted: no ISR route is claimed as affected`);
  } else {
    for (const path of impact.cache.paths) {
      lines.push(`      ${verb}: ${path}${path === '/records/[category]' ? ' (every category page)' : ''}`);
    }
    for (const u of impact.cache.unresolved) lines.push(`      ${verb} (path not composed): ${u}`);
    for (const season of impact.cache.seasonRevalidations) {
      lines.push(`      manual season revalidation available (O-4; NOT run; one POST refreshes one worker, repeat until every worker answers): ${seasonRevalidationCommand(season)}`);
    }
    lines.push('      every other route expires within its ISR window (3600 s; /clubs 86400 s)');
  }

  lines.push('    Coleman (§4.F; award_winners is never recomputed here):');
  if (impact.coleman === null) lines.push('      unavailable (see REPORT INCOMPLETE)');
  else if (impact.coleman.length === 0) lines.push('      none: no completed home-and-away season\'s derivation can change');
  else {
    for (const c of impact.coleman) {
      lines.push(`      season ${c.season}: potentially stale (${c.reasons.join(', ')}; player_match_stats ${c.rowIds.map((id) => `#${id}`).join(', ')})`);
    }
    lines.push(`      refresh (report only): ${COLEMAN_REFRESH_COMMAND}`);
  }

  lines.push('    DP-5 first-kick-goal debut (§5.11; report only):');
  if (impact.debutChanges === null) lines.push('      unavailable (see REPORT INCOMPLETE)');
  else if (impact.debutChanges.length === 0) lines.push('      none');
  else for (const d of impact.debutChanges) lines.push(...formatDependentEntry(d));

  lines.push('    open findings (§4.B; reported, never resolved by this report):');
  if (impact.findings === null) lines.push('      unavailable (see REPORT INCOMPLETE)');
  else if (impact.findings.length === 0) lines.push('      none');
  for (const f of impact.findings ?? []) {
    lines.push(`      data_issues#${f.id} ${f.issueType} (${f.selector}) ${f.issueKey}`
      + (f.adjudicatedByThisCorrection ? ` -- ${committed ? 'should have been' : 'would be'} resolved by this correction's §8.2 step 7` : ''));
  }

  lines.push('    pending promotion candidates (§4.B; reported, never resolved):');
  if (impact.pendingCandidates === null) lines.push('      unavailable (see REPORT INCOMPLETE)');
  else if (impact.pendingCandidates.length === 0) lines.push('      none');
  for (const c of impact.pendingCandidates ?? []) {
    lines.push(`      promotion_candidates#${c.id} ${c.family} ${c.externalRecordId} -> ${c.targetTable} (${c.verb}, season ${c.season}; ${c.selector})`);
  }

  if (impact.incomplete.length > 0) {
    lines.push(committed
      ? '  REPORT INCOMPLETE: the correction IS COMMITTED and was not rolled back; these report sections could not be read:'
      : '  REPORT INCOMPLETE: these report sections could not be read (nothing was committed):');
    for (const i of impact.incomplete) lines.push(`    ${i.section}: ${i.error}`);
  }
  return lines;
}

export function formatOutcome(outcome: CorrectionOutcome, args: CorrectionArgs, impact: ImpactReport | null = null): string {
  const lines = [`  mode ${args.mode}, provider ${args.providerId} -> player ${args.toPlayerId}`];
  switch (outcome.kind) {
    case 'STOP':
      lines.push(`  STOP: ${outcome.stops.length} stop(s); nothing written`);
      for (const s of outcome.stops) lines.push(`    ${describeStop(s)}`);
      if (outcome.fingerprint) lines.push(`    fingerprint (for reference only, do not apply): ${outcome.fingerprint}`);
      if (outcome.report) lines.push(...formatReportContext(outcome.report));
      return lines.join('\n');
    case 'ALREADY_SATISFIED':
      lines.push('  ALREADY_SATISFIED: this provider is already corrected and the correction remains satisfied');
      for (const r of outcome.reports) lines.push(`    ${r}`);
      lines.push(...formatSatisfactionEntries(outcome.satisfaction ?? []));
      lines.push('    no new mutation: no batch opened, no ledger row appended, no canonical row changed -- no cache, Coleman or dependent impact to report');
      return lines.join('\n');
    case 'PLANNED':
      lines.push(`  PLAN OK (validate-only): fingerprint ${outcome.fingerprint}`);
      lines.push(`    rows planned: ${outcome.plan.rows.length}`);
      for (const r of outcome.reports) lines.push(`    ${r}`);
      if (outcome.impact) lines.push(...formatReportContext(outcome.impact.context), ...formatImpact(impact));
      return lines.join('\n');
    case 'ROLLED_BACK':
    case 'COMMITTED':
      lines.push(`  ${outcome.kind}: fingerprint ${outcome.fingerprint}`);
      lines.push(`    adjudication id ${outcome.adjudicationId}, batch id ${outcome.batchId}`);
      lines.push(`    moved ${outcome.moved}, deleted ${outcome.deleted}`);
      for (const r of outcome.reports) lines.push(`    ${r}`);
      lines.push(...formatSatisfactionEntries(outcome.satisfaction ?? []));
      if (outcome.impact) lines.push(...formatReportContext(outcome.impact.context), ...formatImpact(impact));
      return lines.join('\n');
  }
}

/* ==================================================================== *
 * §8.3 promotion REPLAY (REPLAY_SECTION_BEGIN)
 *
 *     CANDIDATE_DSN=<owner DSN of the candidate> npx tsx tools/migration/correct_afl_api_identity.ts \
 *       --replay-promotion --supersede-in <v3 file> --environment dev|prod \
 *       --expect-database <candidate> --expect-role afldb_owner [--dry-run]
 *
 * §8.8: runs as the candidate OWNER on the candidate DSN the promotion plan already builds
 * (`CANDIDATE_DSN`), and takes its DSN from that variable ALONE. One transaction over every
 * provider of the v3 artefact's `correctedReplays`.
 *
 * REPLAY WRITE ALLOW-LIST (orchestrator decision F-005). It may only
 *   - INSERT `canonical_applications` (import_batch_id = R);
 *   - INSERT/UPDATE `import_batches` (batch R only);
 *   - INSERT (class 3) / UPDATE (class 1/2) `external_identities` for CD_I only;
 *   - UPDATE/DELETE the planned closure rows and UPDATE CD_I's typed projections;
 *   - the §8.2 step-8 recompute writes.
 * It never writes the adjudication ledger, and it does not resolve ISSUE-240 findings
 * (`data_issues` is outside the allow-list; a promotion has its own finding lifecycle).
 * ==================================================================== */

export type ReplayPromotionArgs = {
  readonly dryRun: boolean;
  readonly supersedeIn: string;
  readonly environment: 'dev' | 'prod';
  readonly expectDatabase: string;
  readonly expectRole: 'afldb_owner';
};

export const REPLAY_PROMOTION_USAGE =
  'correct_afl_api_identity.ts --replay-promotion --supersede-in <v3 file> --environment dev|prod '
  + '--expect-database <candidate> --expect-role afldb_owner [--dry-run]  (DSN from CANDIDATE_DSN)';

export function parseReplayPromotionArgs(argv: readonly string[]): ReplayPromotionArgs {
  let replay = false;
  let dryRun = false;
  let supersedeIn: string | null = null;
  let environment: string | null = null;
  let expectDatabase: string | null = null;
  let expectRole: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    switch (flag) {
      case '--replay-promotion': replay = true; break;
      case '--dry-run': dryRun = true; break;
      case '--supersede-in': supersedeIn = requireValue(argv, i, flag); i += 1; break;
      case '--environment': environment = requireValue(argv, i, flag); i += 1; break;
      case '--expect-database': expectDatabase = requireValue(argv, i, flag); i += 1; break;
      case '--expect-role': expectRole = requireValue(argv, i, flag); i += 1; break;
      default:
        throw new CorrectionRefused(`Unknown argument '${flag}' for --replay-promotion. Usage: ${REPLAY_PROMOTION_USAGE}`);
    }
  }
  if (!replay) throw new CorrectionRefused('--replay-promotion is required.');
  if (supersedeIn === null) throw new CorrectionRefused('--supersede-in is mandatory.');
  if (environment !== 'dev' && environment !== 'prod') throw new CorrectionRefused('--environment must be dev or prod.');
  if (expectDatabase === null) throw new CorrectionRefused('--expect-database is mandatory.');
  if (expectRole !== 'afldb_owner') throw new CorrectionRefused("--expect-role is mandatory and must be 'afldb_owner' (§8.8).");
  return { dryRun, supersedeIn, environment, expectDatabase, expectRole };
}

/** §8.8: the DSN is `CANDIDATE_DSN` and nothing else; it must name `--expect-database`. */
export function resolveCandidateDsn(env: Record<string, string | undefined>, expectDatabase: string): string {
  const raw = env.CANDIDATE_DSN;
  if (!raw || raw.trim() === '') throw new CorrectionRefused('CANDIDATE_DSN is not set -- refusing');
  const dsn = raw.trim();
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new CorrectionRefused('CANDIDATE_DSN is not a valid postgresql:// DSN');
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new CorrectionRefused('CANDIDATE_DSN is not a postgresql:// DSN');
  }
  if (decodeURIComponent(url.pathname.replace(/^\//, '')) !== expectDatabase) {
    throw new CorrectionRefused(`CANDIDATE_DSN does not target /${expectDatabase} -- refusing`);
  }
  return dsn;
}

const LIVE_DATABASE_BY_ENVIRONMENT = { prod: 'afldb_prod', dev: 'afldb_dev' } as const;

/** The promotion tooling's own rule (`<live>_pre_rebuild_<stamp>`; `tools/db/rebuild-test.ts` refuses `/pre_rebuild/i`). */
export function isPreRebuildDatabaseName(name: string): boolean {
  return /pre_rebuild/i.test(name);
}

/**
 * §8.8's guards as a pure function of the arguments and the artefact (the connected database and
 * role are proved separately by `proveSession`, which makes them equal `expectDatabase` and
 * `afldb_owner`). The temporary S6-D3 PROD refusal was retired with the DEV rehearsal (AFLDB-ISSUE-238,
 * 2026-10-01); a prod replay is still bound to the freeze by the promotion checker. An empty list means every guard passed.
 */
export function replayPromotionGuardProblems(input: {
  readonly environment: 'dev' | 'prod';
  readonly expectDatabase: string;
  readonly expectRole: string;
  readonly artefact: Pick<AflApiSupersedeFile, 'environment' | 'candidateDatabase' | 'targetDatabase' | 'correctedReplays'>;
}): string[] {
  const problems: string[] = [];
  const { environment, expectDatabase, expectRole, artefact } = input;
  if (expectRole !== 'afldb_owner') problems.push(`--expect-role is '${expectRole}', not 'afldb_owner'`);
  if (artefact.environment !== environment) {
    problems.push(`artefact environment '${artefact.environment}' does not match --environment '${environment}'`);
  }
  if (expectDatabase !== artefact.candidateDatabase) {
    problems.push(`database '${expectDatabase}' is not the artefact candidateDatabase '${artefact.candidateDatabase}'`);
  }
  if (expectDatabase === artefact.targetDatabase) {
    problems.push(`database '${expectDatabase}' is the artefact targetDatabase`);
  }
  if (expectDatabase === LIVE_DATABASE_BY_ENVIRONMENT[environment]
    || expectDatabase === LIVE_DATABASE_BY_ENVIRONMENT.prod || expectDatabase === LIVE_DATABASE_BY_ENVIRONMENT.dev) {
    problems.push(`database '${expectDatabase}' is a live database`);
  }
  if (isPreRebuildDatabaseName(expectDatabase)) {
    problems.push(`database '${expectDatabase}' is a pre_rebuild database`);
  }
  return problems;
}

export function assertReplayPromotionGuards(input: Parameters<typeof replayPromotionGuardProblems>[0]): void {
  const problems = replayPromotionGuardProblems(input);
  if (problems.length > 0) throw new CorrectionRefused(`REFUSED: ${problems.join('; ')}`);
}

/** Read and strictly parse the v3 artefact; a refusal is a `CorrectionRefused`. */
export function loadReplaySupersedeFile(path: string): AflApiSupersedeFile {
  if (!existsSync(path)) throw new CorrectionRefused(`supersede file not found: ${path}`);
  try {
    return parseAflApiSupersedeFile(readFileSync(path, 'utf8'), 'REPLAY supersede file');
  } catch (error) {
    if (error instanceof AflApiPromotionFileRefused) throw new CorrectionRefused(`REFUSED: ${error.message}`);
    throw error;
  }
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** §8.3 steps 2 and 8: the reinstated ledger against the artefact. Empty = consistent. */
export function replayLedgerProblems(
  ledgerRows: readonly AflApiAdjudicationLedgerRow[],
  file: Pick<AflApiSupersedeFile, 'correctedReplays' | 'targetLedgerRowCount' | 'targetLedgerSha256'>,
): string[] {
  const problems: string[] = [];
  const correctedNet = new Map<string, AflApiAdjudicationLedgerRow>();
  for (const [externalId, row] of netLedgerRowsByExternalId(ledgerRows)) {
    if (row.action === 'corrected') correctedNet.set(externalId, row);
  }
  const expected = new Map(file.correctedReplays.map((e) => [e.externalId, e] as const));
  for (const externalId of correctedNet.keys()) {
    if (!expected.has(externalId)) problems.push(`${externalId} is net CORRECTED in the reinstated ledger but not in correctedReplays`);
  }
  for (const [externalId, entry] of expected) {
    const row = correctedNet.get(externalId);
    if (row === undefined) {
      problems.push(`${externalId} is in correctedReplays but is not net CORRECTED in the reinstated ledger`);
      continue;
    }
    if (Number(row.id) !== entry.adjudicationId) problems.push(`${externalId}: ledger adjudication id ${String(row.id)} != artefact ${entry.adjudicationId}`);
    if (row.evidenceSha256 !== entry.adjudicationEvidenceSha256) problems.push(`${externalId}: ledger evidence_sha256 differs from the artefact`);
    if ((row.previousPlayerIdentity ?? null) !== entry.previousPlayerIdentity) problems.push(`${externalId}: ledger previous_player_identity differs from the artefact`);
    if (row.playerIdentity !== entry.playerIdentity) problems.push(`${externalId}: ledger player_identity differs from the artefact`);
  }
  if (ledgerRows.length !== file.targetLedgerRowCount) {
    problems.push(`ledger row count ${ledgerRows.length} != artefact targetLedgerRowCount ${file.targetLedgerRowCount}`);
  }
  if (aflApiLedgerStateSha256(ledgerRows) !== file.targetLedgerSha256) {
    problems.push('ledger digest differs from the artefact targetLedgerSha256');
  }
  return problems;
}

/** §8.3 step 8: exactly one `corrected` row per replayed A, and it is A. Empty = consistent. */
export function replayNoSecondCorrectedProblems(
  ledgerRows: readonly AflApiAdjudicationLedgerRow[],
  entries: readonly Pick<AflApiCorrectedReplayEntry, 'externalId' | 'adjudicationId'>[],
): string[] {
  const problems: string[] = [];
  for (const entry of entries) {
    const corrected = ledgerRows.filter((r) => r.externalId === entry.externalId && r.action === 'corrected');
    if (corrected.length !== 1 || Number(corrected[0].id) !== entry.adjudicationId) {
      problems.push(`${entry.externalId}: expected exactly one corrected ledger row (id ${entry.adjudicationId}), found ${corrected.length}`);
    }
  }
  return problems;
}

/**
 * §8.3 steps 3-4 at promotion: the database's own classification must be a PASS that equals the
 * artefact entry (class, identity action, plannerVersion of both the running planner and the
 * classification, fingerprint, mutation counts). Empty = the entry is reproduced exactly.
 */
export function replayEntryMismatches(
  entry: AflApiCorrectedReplayEntry, result: CpcResult, runningPlannerVersion: number,
): string[] {
  if (result.outcome === 'FAIL') {
    return [`CPC FAIL ${result.code}${result.candidateClass === null ? '' : ` (class ${result.candidateClass})`}: ${result.detail}`];
  }
  const problems: string[] = [];
  if (runningPlannerVersion !== entry.plannerVersion) {
    problems.push(`running plannerVersion ${runningPlannerVersion} != artefact plannerVersion ${entry.plannerVersion}`);
  }
  if (result.plannerVersion !== entry.plannerVersion) {
    problems.push(`classification plannerVersion ${result.plannerVersion} != artefact plannerVersion ${entry.plannerVersion}`);
  }
  if (result.candidateClass !== entry.candidateClass) {
    problems.push(`class ${result.candidateClass} != artefact class ${entry.candidateClass}`);
  }
  if (result.predictedIdentityAction !== entry.predictedIdentityAction) {
    problems.push(`identity action ${result.predictedIdentityAction} != artefact ${entry.predictedIdentityAction}`);
  }
  if (result.predictedClosureFingerprint !== entry.predictedClosureFingerprint) {
    problems.push(`closure fingerprint ${result.predictedClosureFingerprint} != artefact predictedClosureFingerprint ${entry.predictedClosureFingerprint}`);
  }
  const counts = (c: CpcMutationCounts) => `${c.player_match_stats}/${c.brownlow_round_votes}`;
  if (counts(result.predictedMutations.moved) !== counts(entry.predictedMutations.moved)
    || counts(result.predictedMutations.deleted) !== counts(entry.predictedMutations.deleted)) {
    problems.push('mutation counts differ from the artefact predictedMutations');
  }
  return problems;
}

export type ReplayPostState = {
  readonly importer: { readonly rowCount: number; readonly sha256: string };
  readonly identity: { readonly rowCount: number; readonly sha256: string };
  /** `resolved` rows carrying `afl_api_admin_adjudication`. */
  readonly resolvedRowCount: number;
};

/**
 * The candidate's `afl_api` state in the artefact's own digests. Importer rows are the D5 census's
 * importer rows (stable fields + forward identity, exactly `readAflApiSupersedeBindingState`'s
 * construction); the identity state is EVERY census row (`external_id`, `status`, `match_method`,
 * forward stable identity), never a player id.
 */
export async function readAflApiPostReplayState(tx: TransactionSql): Promise<ReplayPostState> {
  const sourceId = await fetchAflApiSourceId(tx);
  const census = await readAflApiCensusRows(tx, sourceId);
  const { importerRows } = censusAflApiRows(census);
  const playerIds = [...new Set(census.filter((r) => r.playerId !== null).map((r) => r.playerId as number))];
  const identityByPlayerId = await readAflApiForwardIdentities(tx, playerIds);
  const identityOf = (playerId: number | null): string | null => {
    if (playerId === null) return null;
    const identity = identityByPlayerId.get(playerId);
    return identity && identity.ok ? identity.identity : null;
  };
  const importerState: AflApiImporterStateRow[] = importerRows.map((r) => ({
    externalId: r.externalId, status: r.status, matchMethod: r.matchMethod, playerIdentity: identityOf(r.playerId),
  }));
  const identityState: AflApiIdentityStateRow[] = census.map((r) => ({
    externalId: r.externalId, status: r.status, matchMethod: r.matchMethod ?? '', playerIdentity: identityOf(r.playerId),
  }));
  return {
    importer: { rowCount: importerState.length, sha256: aflApiImporterStateSha256(importerState) },
    identity: { rowCount: identityState.length, sha256: aflApiIdentityStateSha256(identityState) },
    resolvedRowCount: census.filter((r) => r.status === 'resolved' && r.matchMethod === AFL_API_ADMIN_MATCH_METHOD).length,
  };
}

/** §8.3 step 8 at promotion: the actual post-replay state against the artefact's prediction. */
export function replayPostStateProblems(
  actual: ReplayPostState,
  file: Pick<AflApiSupersedeFile,
    'predictedPostReplayImporterRowCount' | 'predictedPostReplayImporterSha256'
    | 'predictedPostReplayResolvedRowCount' | 'predictedPostReplayIdentitySha256'>,
): string[] {
  const problems: string[] = [];
  if (actual.importer.rowCount !== file.predictedPostReplayImporterRowCount) {
    problems.push(`importer row count ${actual.importer.rowCount} != predicted ${file.predictedPostReplayImporterRowCount}`);
  }
  if (actual.importer.sha256 !== file.predictedPostReplayImporterSha256) {
    problems.push('importer state digest differs from predictedPostReplayImporterSha256');
  }
  if (actual.resolvedRowCount !== file.predictedPostReplayResolvedRowCount) {
    problems.push(`resolved row count ${actual.resolvedRowCount} != predicted ${file.predictedPostReplayResolvedRowCount}`);
  }
  if (actual.identity.sha256 !== file.predictedPostReplayIdentitySha256) {
    problems.push('identity state digest differs from predictedPostReplayIdentitySha256');
  }
  return problems;
}

type ReplayIdentityAction = 'update_in_place' | 'upgrade_in_place' | 'insert';

export type ReplayProviderOutcome = {
  readonly externalId: string;
  readonly adjudicationId: number;
  readonly result: 'ALREADY_REPLAYED' | 'REPLAYED';
  readonly candidateClass: 1 | 2 | 3;
  readonly identityAction: ReplayIdentityAction;
  readonly moved: number;
  readonly deleted: number;
  /** R's id, or null when no MOVE/DELETE existed (no batch is opened, §8.3 step 5). */
  readonly batchId: string | null;
  readonly fingerprint: string;
};

export type ReplayOutcome = {
  readonly kind: 'NOTHING_TO_REPLAY' | 'ALREADY_REPLAYED' | 'REPLAYED' | 'ROLLED_BACK';
  readonly providers: readonly ReplayProviderOutcome[];
  readonly ledger: { readonly rowCount: number; readonly sha256: string };
  readonly post: ReplayPostState;
  readonly reports: readonly string[];
};

const REPLAY_IDENTITY_NOTE = 'AFLDB-ISSUE-238 promotion replay; see afl_api_identity_adjudications';

/**
 * ALREADY_REPLAYED: CD_I's row is `resolved` at P′c with the D15 shape (`afl_api_admin_adjudication`,
 * candidate_count 0) AND CORRECTION SATISFACTION (Q2) passes. A row in that shape whose Q2 fails is
 * contradictory state and refuses; any other row is a candidate to classify.
 */
async function detectAlreadyReplayed(
  tx: TransactionSql, entry: CorrectedProviderEntry, preSwapPromotion: AflApiPreSwapPromotionContract,
): Promise<boolean> {
  const found = await readCandidateProviderRow(tx, entry.externalId);
  if (found === null) return false;
  const row = found.row;
  if (row.status !== 'resolved' || row.matchMethod !== AFL_API_ADMIN_MATCH_METHOD || row.candidateCount !== 0 || row.playerId === null) {
    return false;
  }
  const pPrime = await resolveCandidateIdentity(tx, entry.playerIdentity);
  if (pPrime.kind !== 'unique' || pPrime.playerId !== row.playerId) return false;
  const q2 = await checkCorrectionSatisfaction(dbCorrectionSatisfactionReader(tx), {
    providerId: entry.externalId, adjudicationId: entry.adjudicationId, currentBatchId: null, preSwapPromotion,
  });
  if (!q2.satisfied) {
    throw new CorrectionRefused(
      `REFUSED: ${entry.externalId} is already resolved at P′c but CORRECTION SATISFACTION fails -- STOP: ${q2.stops.map(describeStop).join('; ')}`,
    );
  }
  return true;
}

/** §8.3 step 6 / D15: the identity is written ONLY as the classification requires. `note` is the
 * row's audit text only; the rebuild REPLAY (Stage 21 (b′)) passes its own, promotion the default. */
async function writeReplayedIdentity(
  tx: TransactionSql, action: ReplayIdentityAction,
  row: ExistingIdentityRow | null, externalId: string, pPrimeId: number,
  note: string = REPLAY_IDENTITY_NOTE,
): Promise<void> {
  if (action === 'insert') {
    if (row !== null) throw new CorrectionRefused(`REFUSED: class 3 insert for ${externalId} but an identity row exists`);
    await tx`
      INSERT INTO external_identities
            (source_id, external_id, player_id, status, candidate_count, match_method, notes)
      VALUES ((SELECT id FROM sources WHERE key = ${AFL_API_SOURCE_KEY}), ${externalId}, ${pPrimeId}, 'resolved', 0,
              ${AFL_API_ADMIN_MATCH_METHOD}, ${note})
    `;
    return;
  }
  if (row === null) throw new CorrectionRefused(`REFUSED: ${action} for ${externalId} but no identity row exists`);
  const result = await tx`
    UPDATE external_identities
       SET player_id = ${pPrimeId}, status = 'resolved', candidate_count = 0,
           match_method = ${AFL_API_ADMIN_MATCH_METHOD}, external_name = NULL,
           notes = ${note}
     WHERE id = ${row.id}
  `;
  if (result.count !== 1) {
    throw new CorrectionRefused(`REFUSED: identity update for ${externalId} affected ${result.count} rows, not 1 (STOP, rollback)`);
  }
}

async function countBatchesBoundTo(tx: TransactionSql, adjudicationId: number): Promise<number> {
  const [row] = await tx<{ n: number }[]>`
    SELECT count(*)::int AS n FROM import_batches ib
     WHERE ib.tool = ${TOOL} AND ib.validation_result->>'adjudicationId' = ${String(adjudicationId)}
  `;
  return row.n;
}

/** A provider written in phase 1 whose Q2 and batch finalisation wait for every identity to be written. */
type PendingReplay = {
  readonly entry: AflApiCorrectedReplayEntry;
  readonly batchId: string | null;
  readonly closureRows: readonly BuiltRow[];
  readonly moved: number;
  readonly deleted: number;
  readonly projectionsMoved: number;
  readonly finalValidationResult: JsonValue;
  readonly outcome: ReplayProviderOutcome;
  readonly reports: readonly string[];
};

/**
 * §8.3: the whole promotion REPLAY in ONE transaction, on the candidate as its owner. Phases:
 *   0. read-only: which providers are ALREADY_REPLAYED (Q2 passes);
 *   1. per remaining provider, sorted: classify under ADJUDICATION authority with row locks,
 *      require the artefact's class/version/fingerprint, open R only when a MOVE/DELETE exists,
 *      write the identity, apply the shared mutations, recompute;
 *   2. per written provider: the shared post-write Q2 (run after every identity exists, because
 *      SAT-1's bijection is whole-ledger), then finalise R;
 *   3. ledger unchanged (`n0`, `h0`), one corrected row per A, at most one bound batch per A, and
 *      the importer/identity state equal to the artefact's prediction.
 * A repeated REPLAY finds every provider ALREADY_REPLAYED, opens no batch and writes nothing.
 * Nothing is caught: every failure propagates and rolls the transaction back.
 */
export async function runReplayPromotion(
  tx: TransactionSql, args: ReplayPromotionArgs, file: AflApiSupersedeFile,
): Promise<ReplayOutcome> {
  assertReplayPromotionGuards({
    environment: args.environment, expectDatabase: args.expectDatabase, expectRole: args.expectRole, artefact: file,
  });
  await proveSession(tx, args.expectDatabase, 'afldb_owner');

  const entries = [...file.correctedReplays].sort((a, b) => compareCodeUnits(a.externalId, b.externalId));
  if (entries.length > 0) await takeIdentityTableLock(tx, LOCK_TIMEOUT);

  const ledgerRows = await readLedgerRows(tx);
  const n0 = ledgerRows.length;
  const h0 = aflApiLedgerStateSha256(ledgerRows);
  const ledgerProblems = replayLedgerProblems(ledgerRows, file);
  if (ledgerProblems.length > 0) {
    throw new CorrectionRefused(`REFUSED: the reinstated ledger does not match the artefact: ${ledgerProblems.join('; ')}`);
  }
  // AFLDB-ISSUE-238 stage-aware pre-swap contract: C_promotion fully satisfied; exactly the providers the BOUND artefact
  // declares pending D15 may still lack a resolved row. Built only from the file; bound to the reinstated ledger here,
  // before any write, and again inside every Q2 (SAT-1) below.
  const preSwap: AflApiPreSwapPromotionContract = {
    cPromotion: new Set(entries.map((e) => e.externalId)),
    pendingD15: file.pendingD15Providers,
  };
  if (entries.length > 0) {
    const bindingProblems = pendingD15BindingProblems(await dbCorrectionSatisfactionReader(tx).identityInvariantFacts(), preSwap);
    if (bindingProblems.length > 0) {
      throw new CorrectionRefused(`REFUSED: the artefact's pending-D15 declaration is not bound to the reinstated candidate -- STOP: ${bindingProblems.join('; ')}`);
    }
  }
  const targetHumanProviders = new Map<string, string>();
  for (const [externalId, row] of netLedgerRowsByExternalId(ledgerRows)) {
    if (aflApiNetIsHumanLive(row.action)) targetHumanProviders.set(externalId, row.playerIdentity);
  }
  const asProviderEntry = (e: AflApiCorrectedReplayEntry): CorrectedProviderEntry => ({
    externalId: e.externalId, adjudicationId: e.adjudicationId, evidenceSha256: e.adjudicationEvidenceSha256,
    previousPlayerIdentity: e.previousPlayerIdentity, playerIdentity: e.playerIdentity,
  });

  // Phase 0.
  const already = new Set<string>();
  for (const entry of entries) {
    if (await detectAlreadyReplayed(tx, asProviderEntry(entry), preSwap)) already.add(entry.externalId);
  }

  // Phase 1.
  const contractFor = (fingerprint: string) => replayBatchContract(fingerprint);
  const pending: PendingReplay[] = [];
  for (const entry of entries) {
    if (already.has(entry.externalId)) continue;
    const corrected = asProviderEntry(entry);
    const classified = await classifyCorrectedProviderInDatabase(tx, {
      entry: corrected, authorityMode: 'ADJUDICATION', lockRows: true, targetHumanProviders,
    });
    const mismatches = replayEntryMismatches(entry, classified.result, PLANNER_VERSION);
    if (mismatches.length > 0) throw new CorrectionRefused(`REFUSED: ${entry.externalId}: ${mismatches.join('; ')}`);
    const result = classified.result;
    if (result.outcome !== 'PASS' || classified.predicted === null || classified.pcId === null || classified.pPrimeId === null) {
      throw new CorrectionRefused(`internal: ${entry.externalId} passed CPC without a planned closure`);
    }
    // Explicit locals: TS does not carry the property narrowing above through destructuring of a
    // non-union object type.
    const predicted: PredictedClosure = classified.predicted;
    const pcId: number = classified.pcId;
    const pPrimeId: number = classified.pPrimeId;
    const closureRows = predicted.closure.rows;
    const contract = contractFor(predicted.fingerprint);
    const validationResultFor = (counts: JsonValue): JsonValue => correctionBatchValidationResult(contract, {
      adjudicationId: entry.adjudicationId, externalId: entry.externalId,
      adjudicationEvidenceSha256: entry.adjudicationEvidenceSha256, closureFingerprint: predicted.fingerprint,
      rows: closureRows, pPrimeId, counts,
    });

    // §8.3 step 5: a batch only when the closure has a MOVE or DELETE.
    let batchId: string | null = null;
    if (closureRows.length > 0) {
      batchId = await openCorrectionBatch(tx, closureRows.length, contract.openNotes);
      await bindCorrectionBatch(
        tx, batchId, validationResultFor(correctionCountsFor(closureRows, 0)), contract.boundNotes(entry.adjudicationId),
      );
    }

    await writeReplayedIdentity(tx, result.predictedIdentityAction, classified.identityRow, entry.externalId, pPrimeId);

    let moved = 0;
    let deleted = 0;
    let projectionsMoved = 0;
    if (batchId !== null) {
      ({ moved, deleted, projectionsMoved } = await applyClosureMutations(
        tx, { providerId: entry.externalId }, { pId: pcId, pPrimeId, batchId }, closureRows,
      ));
    } else {
      projectionsMoved = await moveProviderProjections(tx, { providerId: entry.externalId }, pcId, pPrimeId);
    }
    // §8.3 step 7: recompute only when a canonical row changed.
    if (closureRows.length > 0) await recomputeAfterClosureMutations(tx, closureRows, pcId, pPrimeId);

    pending.push({
      entry, batchId, closureRows, moved, deleted, projectionsMoved,
      finalValidationResult: validationResultFor(correctionCountsFor(closureRows, projectionsMoved)),
      outcome: {
        externalId: entry.externalId, adjudicationId: entry.adjudicationId, result: 'REPLAYED',
        candidateClass: result.candidateClass, identityAction: result.predictedIdentityAction,
        moved, deleted, batchId, fingerprint: predicted.fingerprint,
      },
      reports: predicted.closure.reports,
    });
  }

  // Phase 2.
  for (const p of pending) {
    await assertPostWriteSatisfaction(
      tx, p.entry.externalId, p.entry.adjudicationId, p.batchId === null ? null : Number(p.batchId), preSwap,
    );
    if (p.batchId !== null) await finaliseCorrectionBatch(tx, p.batchId, p.moved + p.deleted, p.finalValidationResult);
  }

  // Phase 3.
  const ledgerAfter = await readLedgerRows(tx);
  if (ledgerAfter.length !== n0 || aflApiLedgerStateSha256(ledgerAfter) !== h0) {
    throw new CorrectionRefused('REFUSED: the adjudication ledger changed during REPLAY (it must never be written) -- STOP, rollback');
  }
  const secondCorrected = replayNoSecondCorrectedProblems(ledgerAfter, entries);
  if (secondCorrected.length > 0) throw new CorrectionRefused(`REFUSED: ${secondCorrected.join('; ')}`);
  for (const entry of entries) {
    const bound = await countBatchesBoundTo(tx, entry.adjudicationId);
    if (bound > 1) throw new CorrectionRefused(`REFUSED: ${bound} bound batches exist for adjudication ${entry.adjudicationId} (at most one) -- STOP, rollback`);
  }
  const post = await readAflApiPostReplayState(tx);
  const postProblems = replayPostStateProblems(post, file);
  if (postProblems.length > 0) {
    throw new CorrectionRefused(`REFUSED: the post-replay state does not equal the artefact's prediction: ${postProblems.join('; ')}`);
  }

  const providers: ReplayProviderOutcome[] = entries.map((entry): ReplayProviderOutcome => {
    const written = pending.find((p) => p.entry.externalId === entry.externalId);
    if (written) return written.outcome;
    return {
      externalId: entry.externalId, adjudicationId: entry.adjudicationId, result: 'ALREADY_REPLAYED',
      candidateClass: entry.candidateClass, identityAction: entry.predictedIdentityAction,
      moved: 0, deleted: 0, batchId: null, fingerprint: entry.predictedClosureFingerprint,
    };
  });
  const kind: ReplayOutcome['kind'] = entries.length === 0
    ? 'NOTHING_TO_REPLAY'
    : pending.length === 0 ? 'ALREADY_REPLAYED' : 'REPLAYED';
  return {
    kind, providers, ledger: { rowCount: n0, sha256: h0 }, post,
    reports: pending.flatMap((p) => p.reports.map((r) => `${p.entry.externalId}: ${r}`)),
  };
}

export function formatReplayOutcome(outcome: ReplayOutcome, args: ReplayPromotionArgs): string {
  const lines = [`  mode replay-promotion${args.dryRun ? ' (dry-run)' : ''}, ${args.environment}, database ${args.expectDatabase}`];
  if (outcome.kind === 'NOTHING_TO_REPLAY') {
    lines.push('  NOTHING_TO_REPLAY: the artefact carries no corrected providers; nothing was written');
  } else {
    lines.push(`  ${outcome.kind}: ${outcome.providers.length} corrected provider(s)`);
    for (const p of outcome.providers) {
      lines.push(`    ${p.externalId} (A ${p.adjudicationId}): ${p.result}, class ${p.candidateClass}, ${p.identityAction}, `
        + `moved ${p.moved}, deleted ${p.deleted}, batch ${p.batchId ?? 'none'}, fingerprint ${p.fingerprint}`);
    }
  }
  lines.push(`  ledger ${outcome.ledger.rowCount} row(s), sha256 ${outcome.ledger.sha256} (unchanged)`);
  lines.push(`  importer state ${outcome.post.importer.rowCount} row(s), identity state ${outcome.post.identity.rowCount} row(s), resolved ${outcome.post.resolvedRowCount}`);
  for (const r of outcome.reports) lines.push(`    ${r}`);
  return lines.join('\n');
}

/** Carries a dry-run's outcome out of a deliberately aborted transaction. */
class ReplayForcedRollback extends Error {
  constructor(readonly outcome: ReplayOutcome) { super('forced rollback'); }
}

export async function runReplayPromotionCli(argv: readonly string[]): Promise<number> {
  const args = parseReplayPromotionArgs(argv);
  const file = loadReplaySupersedeFile(args.supersedeIn);
  // Every argument/artefact guard is evaluated before any connection is opened.
  assertReplayPromotionGuards({
    environment: args.environment, expectDatabase: args.expectDatabase, expectRole: args.expectRole, artefact: file,
  });
  const dsn = resolveCandidateDsn(process.env, args.expectDatabase);
  const sql = postgres(dsn, {
    max: 1, onnotice: () => {},
    connection: { application_name: `afldb-correct-afl-api-identity-replay${args.dryRun ? '-dry-run' : ''}`, TimeZone: 'UTC' },
  });
  try {
    let outcome: ReplayOutcome;
    if (!args.dryRun) {
      outcome = await sql.begin('isolation level read committed', (tx) => runReplayPromotion(tx, args, file));
    } else {
      // --dry-run executes every step and always forces a real ROLLBACK.
      try {
        await sql.begin('isolation level read committed', async (tx) => {
          const dryOutcome = await runReplayPromotion(tx, args, file);
          throw new ReplayForcedRollback(dryOutcome);
        });
        throw new CorrectionRefused('internal: the dry-run transaction returned instead of rolling back');
      } catch (error) {
        if (!(error instanceof ReplayForcedRollback)) throw error;
        outcome = error.outcome.kind === 'REPLAYED' ? { ...error.outcome, kind: 'ROLLED_BACK' } : error.outcome;
      }
    }
    console.log(formatReplayOutcome(outcome, args));
    return 0;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
/* REPLAY_SECTION_END */

/* ==================================================================== *
 * §8.3 / §9.2 rebuild REPLAY: Stage 21 (b′) and the Stage 22 SAT-1 check
 * (REBUILD_REPLAY_SECTION_BEGIN)
 *
 * Called ONLY by `tools/migration/rebuild_afl_api_adjudications.ts`, inside the Stage 21
 * transaction it has already opened on the rebuild target's own owner/admin DSN
 * (`AFLDB_REBUILD_ADJUDICATION_DSN`) and already proven: the allowlisted target name, the
 * connected database, and a rebuild marker naming exactly the pending v3 capture (§8.8: "Stage
 * 21's role ... No new role"). No DSN, `.env` or session-role proof of its own; the connected
 * database is re-asserted only as a cheap guard.
 *
 * WHY TWO HALVES AROUND D15 (C1, binding). SAT-1 is the WHOLE-TABLE combined invariant (§13.2):
 * every net-`linked` provider must already hold its `resolved` row. D15 (Stage 21 (c)) is what
 * inserts those rows, so the corrected Q2 cannot run before it. The single Stage 21 transaction
 * is therefore: (a) importer replay; (b) ledger reinstatement and read-back; (b′ write) this
 * identity-only INSERT; (c) D15 with the corrected set as its exact expected ALREADY_SATISFIED
 * set; (b′ verify) the corrected Q2 and ledger checks; (d) parity and the combined invariant;
 * (e) the marker clear. Never split across transactions.
 *
 * WRITE ALLOW-LIST (§8.8, rebuild). (b′ write) writes exactly one `external_identities` row per
 * corrected provider, in the D15 `resolved` shape at P′ (O-1). It never writes the adjudication
 * ledger, `import_batches`, `canonical_applications`, `data_issues`, a typed projection or a
 * canonical row, and never recomputes derived state. It accepts CPC class 3 with an EMPTY closure
 * only (§9.2: the rebuild has no canonical replay path, so a non-empty closure is a hard STOP);
 * a stray projection or closure row surfaces through the planner and Q2 and STOPs. With zero
 * corrected providers neither half issues any SQL at all (§8.5).
 * ==================================================================== */

export const REBUILD_REPLAY_IDENTITY_NOTE = 'AFLDB-ISSUE-238 rebuild replay; see afl_api_identity_adjudications';

export type RebuildCorrectedReplayInput = {
  /** The rebuild target Stage 21 is connected to (already proven by Stage 21's marker check). */
  readonly expectDatabase: string;
  /** Exactly the capture's net-CORRECTED providers (A's stable fields). */
  readonly entries: readonly CorrectedProviderEntry[];
  /** Net linked/corrected providers of the capture ledger -> stable identity (S6-D4 collision source (b)). */
  readonly targetHumanProviders: ReadonlyMap<string, string>;
};

export type RebuildReplayProviderOutcome = {
  readonly externalId: string;
  readonly adjudicationId: number;
  /** P′ on the rebuilt database: the `resolved` row's player. */
  readonly pPrimeId: number;
  /** The (identity-only) closure fingerprint the gate accepted. */
  readonly fingerprint: string;
};

export type RebuildCorrectedReplayWriteResult = {
  readonly providers: readonly RebuildReplayProviderOutcome[];
  /** §8.3 step 2's n₀/h₀, read under the identity-table lock before the first INSERT. */
  readonly ledger: { readonly rowCount: number; readonly sha256: string };
};

/**
 * §8.3 step 2 at rebuild: the reinstated ledger's net-CORRECTED set must equal the capture's
 * corrected set exactly, each A carried verbatim (id, evidence hash, both stable identities).
 * Empty = consistent. A malformed ledger throws (`netLedgerRowsByExternalId`), never "no problem".
 */
export function rebuildCorrectedSetProblems(
  ledgerRows: readonly AflApiAdjudicationLedgerRow[], entries: readonly CorrectedProviderEntry[],
): string[] {
  const problems: string[] = [];
  const correctedNet = new Map<string, AflApiAdjudicationLedgerRow>();
  for (const [externalId, row] of netLedgerRowsByExternalId(ledgerRows)) {
    if (row.action === 'corrected') correctedNet.set(externalId, row);
  }
  const expected = new Map<string, CorrectedProviderEntry>();
  for (const entry of entries) {
    if (expected.has(entry.externalId)) problems.push(`${entry.externalId} appears twice in the capture's corrected set`);
    expected.set(entry.externalId, entry);
  }
  for (const externalId of correctedNet.keys()) {
    if (!expected.has(externalId)) problems.push(`${externalId} is net CORRECTED in the reinstated ledger but not in the capture's corrected set`);
  }
  for (const [externalId, entry] of expected) {
    const row = correctedNet.get(externalId);
    if (row === undefined) {
      problems.push(`${externalId} is in the capture's corrected set but is not net CORRECTED in the reinstated ledger`);
      continue;
    }
    if (Number(row.id) !== entry.adjudicationId) problems.push(`${externalId}: ledger adjudication id ${String(row.id)} != capture ${entry.adjudicationId}`);
    if (row.evidenceSha256 !== entry.evidenceSha256) problems.push(`${externalId}: ledger evidence_sha256 differs from the capture`);
    if ((row.previousPlayerIdentity ?? null) !== entry.previousPlayerIdentity) problems.push(`${externalId}: ledger previous_player_identity differs from the capture`);
    if (row.playerIdentity !== entry.playerIdentity) problems.push(`${externalId}: ledger player_identity differs from the capture`);
  }
  return problems;
}

/**
 * The rebuild REPLAY gate (§8.3 step 4 at rebuild, §9.2 (b′)): CPC class 3 EXACTLY — a PASS whose
 * identity action is `insert`, with no provider row, planned by the running `PLANNER_VERSION`, with
 * zero STOP, zero MOVE and zero DELETE. Class 1, 2, 4, 5, UNEVALUABLE, COLLISION, DISAGREE, a
 * PREDICT STOP, a Pc still implicated, or any non-empty closure is a hard STOP. Empty = PASS.
 */
export function rebuildReplayGateProblems(
  classified: {
    readonly result: CpcResult;
    /** The planned closure (a `PredictedClosure`, or the CPC's own `CpcPrediction`). */
    readonly predicted: {
      readonly stops: readonly { readonly code: StopCode }[];
      readonly moveOrDeleteRowCount: number;
      readonly moved: CpcMutationCounts;
      readonly deleted: CpcMutationCounts;
    } | null;
    readonly identityRow: ExistingIdentityRow | null;
  },
  runningPlannerVersion: number = PLANNER_VERSION,
): string[] {
  const { result, predicted, identityRow } = classified;
  if (result.outcome === 'FAIL') {
    return [`CPC FAIL ${result.code}${result.candidateClass === null ? '' : ` (class ${result.candidateClass})`}: `
      + `${result.detail} (rebuild REPLAY accepts CPC class 3 only)`];
  }
  const problems: string[] = [];
  if (result.candidateClass !== 3) {
    problems.push(`class ${result.candidateClass}: rebuild REPLAY accepts CPC class 3 (no provider row) only`);
  }
  if (result.predictedIdentityAction !== 'insert') {
    problems.push(`identity action ${result.predictedIdentityAction}: rebuild REPLAY only inserts the resolved P′ row`);
  }
  if (result.plannerVersion !== runningPlannerVersion) {
    problems.push(`classification plannerVersion ${result.plannerVersion} != running plannerVersion ${runningPlannerVersion}`);
  }
  const isZero = (c: CpcMutationCounts) => c.player_match_stats === 0 && c.brownlow_round_votes === 0;
  if (!isZero(result.predictedMutations.moved) || !isZero(result.predictedMutations.deleted)) {
    problems.push('the classification predicts a MOVE or DELETE: a rebuild has no canonical replay path (§9.2)');
  }
  if (predicted === null) {
    problems.push('no closure was planned');
  } else {
    if (predicted.stops.length > 0) {
      problems.push(`the closure carries ${predicted.stops.length} STOP(s): ${[...new Set(predicted.stops.map((s) => s.code))].sort().join(',')}`);
    }
    if (predicted.moveOrDeleteRowCount !== 0 || !isZero(predicted.moved) || !isZero(predicted.deleted)) {
      problems.push(`the closure holds ${predicted.moveOrDeleteRowCount} MOVE/DELETE row(s): a rebuild has no canonical replay path (§9.2)`);
    }
  }
  if (identityRow !== null) {
    problems.push(`an external_identities row (#${identityRow.id}) already exists for the provider`);
  }
  return problems;
}

async function assertRebuildReplayDatabase(tx: TransactionSql, expectDatabase: string): Promise<void> {
  const [row] = await tx<{ database: string }[]>`SELECT current_database() AS database`;
  if (row?.database !== expectDatabase) {
    throw new CorrectionRefused(`REFUSED: rebuild REPLAY is connected to '${String(row?.database)}', not the rebuild target '${expectDatabase}'`);
  }
}

/**
 * Stage 21 (b′ write), inside Stage 21's transaction, after (b) and BEFORE D15 (c). Per corrected
 * provider, deterministically ordered: classify under ADJUDICATION authority with the rebuilt
 * database's own evidence and row locks, require the class-3 gate, then INSERT the `resolved` P′
 * row. Returns null, issuing no SQL, when the capture holds no corrected provider. Nothing is
 * caught: any failure propagates and rolls Stage 21 back with the marker kept.
 */
export async function runRebuildCorrectedReplayWrite(
  tx: TransactionSql, input: RebuildCorrectedReplayInput,
): Promise<RebuildCorrectedReplayWriteResult | null> {
  if (input.entries.length === 0) return null;
  await assertRebuildReplayDatabase(tx, input.expectDatabase);
  await takeIdentityTableLock(tx, LOCK_TIMEOUT);

  const ledgerRows = await readLedgerRows(tx);
  const setProblems = rebuildCorrectedSetProblems(ledgerRows, input.entries);
  if (setProblems.length > 0) {
    throw new CorrectionRefused(`REFUSED: rebuild REPLAY (b′): the reinstated ledger's corrected set is not the capture's: ${setProblems.join('; ')}`);
  }
  const ledger = { rowCount: ledgerRows.length, sha256: aflApiLedgerStateSha256(ledgerRows) };

  const providers: RebuildReplayProviderOutcome[] = [];
  for (const entry of [...input.entries].sort((a, b) => compareCodeUnits(a.externalId, b.externalId))) {
    const classified = await classifyCorrectedProviderInDatabase(tx, {
      entry, authorityMode: 'ADJUDICATION', lockRows: true, targetHumanProviders: input.targetHumanProviders,
    });
    const problems = rebuildReplayGateProblems(classified);
    if (problems.length > 0) {
      throw new CorrectionRefused(`REFUSED: rebuild REPLAY (b′) ${entry.externalId}: ${problems.join('; ')} -- STOP, Stage 21 rolls back`);
    }
    if (classified.pPrimeId === null || classified.predicted === null) {
      throw new CorrectionRefused(`internal: ${entry.externalId} passed the rebuild gate without a resolved P′`);
    }
    await writeReplayedIdentity(tx, 'insert', classified.identityRow, entry.externalId, classified.pPrimeId, REBUILD_REPLAY_IDENTITY_NOTE);
    providers.push({
      externalId: entry.externalId, adjudicationId: entry.adjudicationId, pPrimeId: classified.pPrimeId,
      fingerprint: classified.predicted.fingerprint,
    });
  }
  return { providers, ledger };
}

/**
 * Stage 21 (b′ verify), inside Stage 21's transaction, AFTER D15 (c) — only then does every
 * expected identity exist for SAT-1's whole-table invariant. Requires: the ledger still n₀/h₀; the
 * exact corrected set; no second `corrected` row; zero batches bound to any A (the rebuild opens
 * none); and, per provider, the shared post-write CORRECTION SATISFACTION (Q2, SAT-1…SAT-5).
 * Returns Q2's reports. Issues no SQL when the capture holds no corrected provider.
 */
export async function verifyRebuildCorrectedReplay(
  tx: TransactionSql,
  input: {
    readonly expectDatabase: string;
    readonly entries: readonly CorrectedProviderEntry[];
    readonly written: RebuildCorrectedReplayWriteResult | null;
  },
): Promise<readonly string[]> {
  if (input.entries.length === 0) return [];
  if (input.written === null) {
    throw new CorrectionRefused('internal: rebuild REPLAY (b′ verify) reached with corrected providers but no (b′ write) result');
  }
  await assertRebuildReplayDatabase(tx, input.expectDatabase);
  const writtenIds = input.written.providers.map((p) => p.externalId).sort(compareCodeUnits);
  const entryIds = input.entries.map((e) => e.externalId).sort(compareCodeUnits);
  if (JSON.stringify(writtenIds) !== JSON.stringify(entryIds)) {
    throw new CorrectionRefused(`REFUSED: rebuild REPLAY wrote [${writtenIds.join(', ')}] but the capture's corrected set is [${entryIds.join(', ')}] -- STOP, rollback`);
  }

  const ledgerAfter = await readLedgerRows(tx);
  if (ledgerAfter.length !== input.written.ledger.rowCount || aflApiLedgerStateSha256(ledgerAfter) !== input.written.ledger.sha256) {
    throw new CorrectionRefused('REFUSED: the adjudication ledger changed during the rebuild REPLAY (it must never be written) -- STOP, rollback');
  }
  const setProblems = rebuildCorrectedSetProblems(ledgerAfter, input.entries);
  if (setProblems.length > 0) throw new CorrectionRefused(`REFUSED: ${setProblems.join('; ')} -- STOP, rollback`);
  const secondCorrected = replayNoSecondCorrectedProblems(ledgerAfter, input.entries);
  if (secondCorrected.length > 0) throw new CorrectionRefused(`REFUSED: ${secondCorrected.join('; ')} -- STOP, rollback`);
  for (const entry of input.entries) {
    const bound = await countBatchesBoundTo(tx, entry.adjudicationId);
    if (bound !== 0) {
      throw new CorrectionRefused(`REFUSED: ${bound} batch(es) are bound to adjudication ${entry.adjudicationId} on the rebuilt database (a rebuild REPLAY opens none) -- STOP, rollback`);
    }
  }

  const reports: string[] = [];
  for (const entry of [...input.entries].sort((a, b) => compareCodeUnits(a.externalId, b.externalId))) {
    const q2Reports = await assertPostWriteSatisfaction(tx, entry.externalId, entry.adjudicationId, null);
    reports.push(...q2Reports.map((r) => `${entry.externalId}: ${r}`));
  }
  return reports;
}

/** Exactly the facts Stage 22's SAT-1 needs, read through the accepted read-only Q2 reader. */
export type RebuildSat1Evidence = Pick<CorrectionSatisfactionEvidence,
  'providerId' | 'adjudicationId' | 'identityRow' | 'ledgerRows' | 'previousPlayerId' | 'correctedPlayerId' | 'identityInvariant'>;

export async function gatherRebuildSat1Evidence(
  reader: CorrectionSatisfactionReader, input: { readonly providerId: string; readonly adjudicationId: number },
): Promise<RebuildSat1Evidence> {
  const identityRow = await reader.identityRow(input.providerId);
  const ledgerRows = await reader.ledgerRows(input.providerId);
  const adjudication = ledgerRows.find((r) => r.id === input.adjudicationId) ?? null;
  const previousPlayerId = adjudication?.previousPlayerIdentity
    ? await reader.resolvePlayerIdentity(adjudication.previousPlayerIdentity) : null;
  const correctedPlayerId = adjudication ? await reader.resolvePlayerIdentity(adjudication.playerIdentity) : null;
  const identityInvariant = await reader.identityInvariantFacts();
  return {
    providerId: input.providerId, adjudicationId: input.adjudicationId, identityRow, ledgerRows,
    previousPlayerId, correctedPlayerId, identityInvariant,
  };
}

/**
 * Stage 22 (§5.12 call-path table: "Rebuild Stage 22 — SAT-1"): SAT-1 for one corrected provider,
 * composed from the same exported primitives Q2's SAT-1 uses — never a second invariant. Proves:
 * A is a `corrected` row and the provider's net state; its chain is valid (§10 M1); P and P′ each
 * resolve to exactly one, distinct, player; CD_I is `resolved`/`afl_api_admin_adjudication` at P′
 * and A's own `player_id` is P′ (Q2's conjunct: the census and ledger player ids agree); the whole-table extended bijection (`sat1ExtendedBijectionProblems`) holds. A malformed ledger
 * throws from the shared net-state reader. Empty = PASS.
 */
export function evaluateRebuildSat1(evidence: RebuildSat1Evidence): string[] {
  const adjudication = evidence.ledgerRows.find((r) => r.id === evidence.adjudicationId) ?? null;
  if (adjudication === null || adjudication.action !== 'corrected') {
    return [`authority_invalid: ledger row ${evidence.adjudicationId} is not a corrected adjudication for ${evidence.providerId}`];
  }
  const problems: string[] = [];
  const net = netLedgerAction(evidence.ledgerRows);
  if (net === null || net.id !== adjudication.id) problems.push(`authority_invalid: the net ledger state of ${evidence.providerId} is not adjudication ${adjudication.id}`);
  if (!correctionLedgerChainValid(evidence.ledgerRows, adjudication)) problems.push(`authority_invalid: adjudication ${adjudication.id}'s supersede chain is invalid (§10 M1)`);
  const pId = evidence.previousPlayerId;
  const pPrimeId = evidence.correctedPlayerId;
  if (pId === null) problems.push(`identity_unresolvable: previous_player_identity '${String(adjudication.previousPlayerIdentity)}' does not resolve to exactly one player`);
  if (pPrimeId === null) problems.push(`identity_unresolvable: player_identity '${adjudication.playerIdentity}' does not resolve to exactly one player`);
  if (pId !== null && pId === pPrimeId) problems.push(`identity_unresolvable: P and P′ resolve to the same player ${pId}`);
  if (pPrimeId !== null) {
    const row = evidence.identityRow;
    if (row === null || row.status !== 'resolved' || row.matchMethod !== AFL_API_ADMIN_MATCH_METHOD || row.playerId !== pPrimeId
      || adjudication.playerId !== pPrimeId) {
      problems.push(`identity_contradicts: ${evidence.providerId}'s external_identities row is not resolved/${AFL_API_ADMIN_MATCH_METHOD} at P′ (player ${pPrimeId})`
        + (row === null ? ': no row' : `: ${row.status}/${row.matchMethod ?? 'null'} at player ${String(row.playerId)}`)
        + `; adjudication ${adjudication.id} names player ${String(adjudication.playerId)}`);
    }
    for (const problem of sat1ExtendedBijectionProblems({
      facts: evidence.identityInvariant, providerId: evidence.providerId, pPrimeId, pPrimeIdentity: adjudication.playerIdentity,
    })) {
      problems.push(`identity_contradicts: extended bijection: ${problem}`);
    }
  }
  return problems;
}

/** Stage 22's database half: read-only, on Stage 22's own connection. Empty = SAT-1 PASS. */
export async function checkRebuildCorrectedSat1(
  tx: TransactionSql, input: { readonly providerId: string; readonly adjudicationId: number },
): Promise<string[]> {
  return evaluateRebuildSat1(await gatherRebuildSat1Evidence(dbCorrectionSatisfactionReader(tx), input));
}
/* REBUILD_REPLAY_SECTION_END */

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
  // Promotion REPLAY (§8.3) has its own DSN contract and never loads the repository .env.
  if (argv.includes('--replay-promotion')) return runReplayPromotionCli(argv);
  const args = parseCorrectAflApiIdentityArgs(argv);
  loadEnv(REPO_ROOT);
  const evidenceFile = loadEvidenceFile(args.evidenceFile);
  const dsn = resolveImportDsn(process.env, args.expectDatabase);
  const sql = postgres(dsn, {
    max: 1, onnotice: () => {},
    connection: { application_name: `afldb-correct-afl-api-identity-${args.mode}`, TimeZone: 'UTC' },
  });
  // Set once `sql.begin()` has returned a COMMITTED outcome: from then on no failure may be
  // reported as "nothing was written" or as a rollback (S8-D2).
  let committed: WrittenOutcome | null = null;
  try {
    let result: CorrectionOutcome;
    if (args.mode === 'apply') {
      result = await sql.begin('isolation level read committed', (tx) => runCorrection(tx, args, evidenceFile));
      if (result.kind === 'COMMITTED') committed = result;
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
    // §8.2 step 11: the transaction has finished (committed, or really rolled back). Only now may
    // the read-only, best-effort report run, on its own READ ONLY transactions.
    const rendered = await reportAfterTransaction(
      result, args, (input, phase) => gatherImpactReport(dbImpactReportReader(sql), input, phase),
    );
    console.log(rendered.text);
    return rendered.exitCode;
  } catch (error) {
    // A failure BEFORE the commit keeps the top-level "nothing was written" handler. After it, the
    // correction is durable: report the commit and the missing report, and succeed.
    if (committed === null) throw error;
    console.log(formatCommittedReportIncomplete(committed, error));
    return 0;
  } finally {
    await closeCorrectionConnection(sql, committed !== null);
  }
}

/** Close the pool. After a COMMIT a close failure is a warning, never "nothing was written". */
async function closeCorrectionConnection(sql: Db, afterCommit: boolean): Promise<void> {
  if (!afterCommit) {
    await sql.end({ timeout: 5 });
    return;
  }
  try {
    await sql.end({ timeout: 5 });
  } catch (error) {
    console.error(`WARNING: closing the connection after COMMIT failed (${describeError(error)}); the correction IS COMMITTED`);
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
