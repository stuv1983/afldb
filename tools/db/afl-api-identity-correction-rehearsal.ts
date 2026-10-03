/**
 * AFLDB-ISSUE-238 Slice 10 — the code_test_db rehearsal of the ORIGINAL identity correction
 * (`tools/migration/correct_afl_api_identity.ts`), against real PostgreSQL, one §12.1 case at a time.
 *
 *     AFLDB_CODE_TEST_DATABASE_URL=<afldb_owner DSN naming code_test_db> \
 *     AFLDB_CODE_TEST_IMPORT_DATABASE_URL=<afldb_import DSN naming code_test_db> \
 *       npx tsx tools/db/afl-api-identity-correction-rehearsal.ts run --case 1 --acknowledge code_test_db
 *     ... run --case 29 --acknowledge code_test_db   (Brownlow: settled coverage baseline, byte-identical stat_availability)
 *     ... run --case 87 --acknowledge code_test_db   (lock timeout against a live settle-resolver holder)
 *     npx tsx --conditions=react-server tools/db/afl-api-identity-correction-rehearsal.ts run --case 91 --acknowledge code_test_db
 *     ... run --case 100 --variant match-sheet|brownlow-draft --acknowledge code_test_db
 *       (91 and 100 drive the REAL server-only writers in-process; see "Concurrency infrastructure")
 *     player_match_stats closure families (see "player_match_stats closure families"):
 *       Family A: --case 2 --variant votes-0|votes-3; --case 16 (react-server); --case 23; --case 48; --case 51
 *       Family B: --case 9 --variant pms-foreign-identical|brownlow-foreign-zero;
 *                 --case 10 --variant kicks|null-vs-zero|jumper-whitespace; --case 11; --case 12 --variant pms|brownlow;
 *                 --case 52 --variant pms-identical|pms-differing|brownlow-zero
 *       Family E: --case 70 | 88 | 101 (react-server: the real match-sheet writer after a real correction)
 *     Brownlow Family C (see "Brownlow Family C"): --case 5 | 6 | 7 | 54 | 76 | 78 | 79;
 *       --case 8 --variant malformed-entry|other-record; --case 53 --variant source-positive|counterpart-positive;
 *       --case 83 --variant no-participation|null-match-zero|null-match-two|paired-pms-move
 *     Brownlow / dependent guard Family D (see "Brownlow / dependent guard Family D"):
 *       --case 3 --variant demote|claim; --case 4 --variant draft (react-server)|final;
 *       --case 17 --variant votes-written|round-reowned (react-server); --case 18 --variant after-siren|unresolved;
 *       --case 19 --variant achievement|debut-change; --case 56 --variant round-vote|games (react-server);
 *       --case 84 --variant draft|final; --case 85 --variant loses-participation|keeps-participation
 *     Corrected-state / Q2 group (see "Corrected-state / Q2 group"): --case 20 | 21;
 *       --case 27 --variant same-target|other-target; --case 69 | 72 (react-server: the real finalise / deleteMatch)
 *       --case 73; --case 94 --variant audited|no-audit, --case 98, --case 99 (react-server: the real finalise / draft)
 *     Target-absence / admin-revoke group (see "Target-absence / admin-revoke group"): --case 14 (react-server:
 *       the real deleteMatch); --case 15 --variant match-exists|match-gone; --case 32 (react-server: the real
 *       admin page loader and revokeAflApiLink)
 *     Family F, authority / CLI (see "Family F"): --case 24 --variant importer-unique|admin-linked (react-server:
 *       the real linkAflApiProvider); --case 28; --case 30; --case 31 (react-server: the real page loader and
 *       linkAflApiProvider); --case 58 --variant disagreement-no-ack|disagreement-ack|ack-no-disagreement|ack-no-observation
 *     Real manifest season (see "Case 82"): --case 82 --variant independent|extra-row (the affected season is the
 *       committed manifest's artefact.last_season, a REAL season; its corpus is fingerprinted, never written)
 *     Full derived-rebuild parity (see "Case 47"): --case 47 (runs the REAL tools/migration/rebuild_derived.py,
 *       COMMITTED, on code_test_db, as afldb_import; needs `python` with psycopg on PATH)
 *     ... residue      (read-only: counts every fixture row; expect 0)
 *     ... teardown --acknowledge code_test_db   (only after a run that died before its own teardown)
 *
 * WHAT IT PROVES that the DB-free suites cannot: the correction's real SQL, locks, grants and
 * post-write re-plan. The harness builds only PRE-STATE (as owner, in one transaction); the REAL
 * CLI, run as a subprocess under `afldb_import`, performs the correction: `--validate-only` for the
 * fingerprint, then `--apply --expect-fingerprint`. Nothing here re-implements a correction
 * decision, manufactures a correction row, or bypasses the fingerprint. The CLI's stdout is read
 * through an explicit marker parser (`parseCorrectionCliOutput`) that fails closed.
 *
 * TARGET AND ISOLATION. code_test_db ONLY: `resolveRehearsalDsns` (the ISSUE-237 fixture's guard:
 * both DSNs must name code_test_db, and the owner DSN must pass the rebuild's name guard), then each
 * session proves `current_database()` and its role before anything is written. No `.env` is read.
 * SAT-1 is whole-table, so cases run strictly one at a time: a run refuses to start on any fixture
 * residue or a failing identity invariant, always tears down in `finally`, and proves zero residue
 * after. A FOREIGN fingerprint (row count and row-text hash of every non-fixture row of each table
 * the fixture or the correction can write) is taken before the fixture exists, after the
 * correction, and after teardown; all three must be equal, which proves neither the correction nor
 * the teardown touched a row outside the namespace.
 *
 * Fixture namespace (deterministic; ids come from INSERT ... RETURNING): season 2092 (must be
 * absent), players `issue238-rh-<ccc>-*`, AFL Tables paths `players/Z/Zz238_<ccc>_*.html`,
 * providers `CD_I99923800<ccc><n>`, provider matches `CD_M99923800<ccc><n>`, teams `CD_T992238H|A`,
 * match keys `2092|issue238-rehearsal:<ccc>:<n>` (the `YYYY|` season prefix is required by
 * ISSUE-257's durable Match Sheet authority key, `seasonOfMatchKeyForAuthority`), batch tool `issue238-rehearsal-fixture`, actor
 * `issue238-rehearsal-fixture@example.test` (attribution only: no credential, disabled). Two real
 * clubs are READ only. Identity sequences, once advanced, are not wound back.
 *
 * DEV, PROD and afldb_test are never contacted. No DSN is printed.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres, { type Sql, type TransactionSql } from 'postgres';

import {
  recomputeBrownlowCoverage, recomputeClubSeasons, recomputePlayerDerivedStats, recomputeSeasonMetadata,
} from '../../src/db/queries/player-derived';
import type {
  finaliseBrownlowMatch as finaliseBrownlowMatchType, publishBrownlowSeason as publishBrownlowSeasonType,
  saveDraftBrownlowMatch as saveDraftBrownlowMatchType, voidBrownlowMatch as voidBrownlowMatchType,
} from '../../src/db/queries/admin-brownlow';
import type {
  loadMatchSheetStaleToken as loadMatchSheetStaleTokenType, saveMatchSheet as saveMatchSheetType,
} from '../../src/db/queries/match-sheet';
import { AUTHORITY_UNAVAILABLE_REFUSAL } from '../../src/lib/acquisition/match-sheet-authority';
import { playerMatchStatsAuthorityStorable } from '../../src/lib/acquisition/manual-authority';
import type { deleteMatch as deleteMatchType } from '../../src/db/queries/match-admin';
import type {
  linkAflApiProvider as linkAflApiProviderType,
  readAflApiProviderEvidence as readAflApiProviderEvidenceType, revokeAflApiLink as revokeAflApiLinkType,
} from '../../src/db/queries/afl-api-player-links';
import { normaliseSurname } from '../../src/lib/acquisition/afl-api-player-evidence';
import { adjudicationFingerprint, aflApiRefusalMessage } from '../../src/lib/acquisition/afl-api-adjudication';
import { applyCanonicalUnit, type CanonicalApplyUnitInput } from '../../src/lib/acquisition/canonical-apply';
import { baselineCanonicalHash } from '../../src/lib/acquisition/promotion-review';
import { diffFields } from '../../src/lib/acquisition/reconciliation';
import { automaticProposal, PLAYER_MATCH_STAT_COLUMNS } from '../../src/lib/acquisition/settle-afltables';
import { asImportBatchId } from '../../src/lib/import-batch-id';
import { gateAflApiCorrectedCensus, Report } from './promotion-check';
import { resolveAflApiPlayer } from '../../src/lib/acquisition/afl-api-player-resolver';
import { entrySourceRecordId, MIN_CLUB_LINEUP_ROWS, publishSourceRecordId } from '../../src/lib/brownlow/entry';
import { canonicalJson, HASH_ALGORITHM, HASH_VERSION, type JsonValue } from '../../src/lib/acquisition/observations';
import {
  evaluateSeasonTotalIndependence, PLAYER_MATCH_STATS_CONTRACT_FIELDS, PLAYER_MATCH_STATS_SUBSTANTIVE_FIELDS, rowContractHash,
  type SeasonIndependenceEvidence,
} from '../../src/lib/acquisition/afl-api-identity-correction';
import { REHEARSAL_IMPORT_ENV, REHEARSAL_OWNER_ENV, resolveRehearsalDsns } from '../migration/afl_api_identity_rebuild_rehearsal_fixture';
import {
  citedPayloadVoterProof, classifySeasonTotals, correctionLedgerChainValid, dbCorrectionSatisfactionReader, evaluateSv2aEvidence,
  extractBrownlowVoterEntries, type LedgerRow, type SeasonTotalLiveRow,
} from '../migration/correct_afl_api_identity';
import { assertAflApiIdentityInvariant, replayAflApiAdjudications } from '../migration/replay_afl_api_adjudications';
import { redact } from './psql';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORRECTION_CLI = join(PROJECT_ROOT, 'tools', 'migration', 'correct_afl_api_identity.ts');

export const CORRECTION_REHEARSAL = {
  database: 'code_test_db',
  ownerRole: 'afldb_owner',
  importRole: 'afldb_import',
  season: 2092,
  slugPrefix: 'issue238-rh-',
  pathPrefix: 'players/Z/Zz238_',
  providerPrefix: 'CD_I99923800',
  matchProviderPrefix: 'CD_M99923800',
  teamPrefix: 'CD_T992238',
  matchKeyPrefix: '2092|issue238-rehearsal:',
  fixtureTool: 'issue238-rehearsal-fixture',
  correctionTool: 'correct_afl_api_identity',
  actorEmail: 'issue238-rehearsal-fixture@example.test',
} as const;

const R = CORRECTION_REHEARSAL;

class RehearsalRefused extends Error {}

/* ==================================================================== *
 * CLI output parser (the correction's documented stdout/stderr markers)
 * ==================================================================== */

export type CorrectionCliStop = { table: string; rowId: number | null; step: string; code: string; detail: string | null };

export type CorrectionCliResult =
  | { kind: 'PLANNED'; fingerprint: string; rowsPlanned: number }
  | { kind: 'COMMITTED' | 'ROLLED_BACK'; fingerprint: string; adjudicationId: number; batchId: number;
    moved: number; deleted: number; reportIncomplete: boolean }
  | { kind: 'STOP'; stops: CorrectionCliStop[]; referenceFingerprint: string | null }
  | { kind: 'ALREADY_SATISFIED' }
  | { kind: 'REFUSED'; message: string };

export type CorrectionCliExpectation = { mode: 'validate-only' | 'dry-run' | 'apply'; providerId: string; toPlayerId: number };

const FINGERPRINT = /^[0-9a-f]{64}$/;
const TERMINAL = /^ {2}(STOP|PLAN OK \(validate-only\)|COMMITTED|ROLLED_BACK|ALREADY_SATISFIED): (.*)$/;
const STOP_LINE = /^ {4}([a-z_]+)(?:#(\d+))? \[([^\]]+)\] ([a-z0-9_]+)(?:: (.*))?$/;

class CliOutputMalformed extends RehearsalRefused {}

/**
 * Classify one correction CLI run from its exit status and output, failing closed: exactly one
 * terminal marker (or, for a refusal, none and a `REFUSED:` on stderr), the header naming the
 * expected mode/provider/player, a 64-hex fingerprint wherever one is emitted, every count line
 * present, and the exit status the CLI documents for that outcome (1 for STOP/REFUSED, else 0).
 */
export function parseCorrectionCliOutput(
  run: { status: number | null; stdout: string; stderr: string }, expected: CorrectionCliExpectation,
): CorrectionCliResult {
  const malformed = (why: string) => new CliOutputMalformed(`correction CLI output malformed: ${why}`);
  const lines = run.stdout.replace(/\r/g, '').split('\n');
  const terminals = lines.map((line, index) => ({ index, m: TERMINAL.exec(line) })).filter((t) => t.m !== null);
  const refusal = run.stderr.replace(/\r/g, '').split('\n').find((l) => l.startsWith('REFUSED: '));

  if (terminals.length === 0) {
    if (refusal === undefined) throw malformed(`no terminal marker and no REFUSED (exit ${String(run.status)})`);
    if (run.status !== 1) throw malformed(`REFUSED with exit ${String(run.status)}, expected 1`);
    return { kind: 'REFUSED', message: refusal.slice('REFUSED: '.length) };
  }
  if (terminals.length > 1) throw malformed(`${terminals.length} terminal markers: ${terminals.map((t) => t.m![1]).join(', ')}`);
  if (refusal !== undefined) throw malformed('a terminal marker and a REFUSED together');

  const [{ index, m }] = terminals;
  const [, marker, rest] = m!;
  // Every formatted outcome opens with this header; only main's post-COMMIT catch
  // (`formatCommittedReportIncomplete`) prints the three COMMITTED lines without it.
  const header = `  mode ${expected.mode}, provider ${expected.providerId} -> player ${expected.toPlayerId}`;
  const headerless = marker === 'COMMITTED' && index === 0 && lines.some((l) => l.startsWith('  REPORT INCOMPLETE: '));
  if (!lines.includes(header) && !headerless) throw malformed(`header '${header.trim()}' absent`);
  const after = lines.slice(index + 1);
  const wantExit = (code: number) => {
    if (run.status !== code) throw malformed(`${marker} with exit ${String(run.status)}, expected ${code}`);
  };
  const fingerprintOf = (text: string) => {
    if (!FINGERPRINT.test(text)) throw malformed(`fingerprint '${text}' is not 64 lowercase hex`);
    return text;
  };

  switch (marker) {
    case 'PLAN OK (validate-only)': {
      wantExit(0);
      if (expected.mode !== 'validate-only') throw malformed(`PLAN OK in mode ${expected.mode}`);
      const fp = /^fingerprint (\S+)$/.exec(rest);
      const planned = /^ {4}rows planned: (\d+)$/.exec(after[0] ?? '');
      if (!fp || !planned) throw malformed('PLAN OK without fingerprint / rows planned');
      return { kind: 'PLANNED', fingerprint: fingerprintOf(fp[1]), rowsPlanned: Number(planned[1]) };
    }
    case 'COMMITTED':
    case 'ROLLED_BACK': {
      wantExit(0);
      if (marker === 'COMMITTED' && expected.mode !== 'apply') throw malformed(`COMMITTED in mode ${expected.mode}`);
      if (marker === 'ROLLED_BACK' && expected.mode !== 'dry-run') throw malformed(`ROLLED_BACK in mode ${expected.mode}`);
      const fp = /^fingerprint (\S+)$/.exec(rest);
      const ids = /^ {4}adjudication id (\d+), batch id (\d+)$/.exec(after[0] ?? '');
      const counts = /^ {4}moved (\d+), deleted (\d+)$/.exec(after[1] ?? '');
      if (!fp || !ids || !counts) throw malformed(`${marker} without fingerprint / ids / counts`);
      return {
        kind: marker, fingerprint: fingerprintOf(fp[1]), adjudicationId: Number(ids[1]), batchId: Number(ids[2]),
        moved: Number(counts[1]), deleted: Number(counts[2]),
        reportIncomplete: lines.some((l) => l.startsWith('  REPORT INCOMPLETE: ')),
      };
    }
    case 'STOP': {
      wantExit(1);
      const n = /^(\d+) stop\(s\); nothing written$/.exec(rest);
      if (!n) throw malformed(`STOP line '${rest}'`);
      const stops: CorrectionCliStop[] = [];
      for (const line of after.slice(0, Number(n[1]))) {
        const s = STOP_LINE.exec(line);
        if (!s) throw malformed(`stop line '${line}'`);
        stops.push({ table: s[1], rowId: s[2] === undefined ? null : Number(s[2]), step: s[3], code: s[4], detail: s[5] ?? null });
      }
      if (stops.length !== Number(n[1]) || stops.length === 0) throw malformed(`STOP announces ${n[1]} stop(s), ${stops.length} listed`);
      const ref = /^ {4}fingerprint \(for reference only, do not apply\): (\S+)$/.exec(after[stops.length] ?? '');
      return { kind: 'STOP', stops, referenceFingerprint: ref ? fingerprintOf(ref[1]) : null };
    }
    case 'ALREADY_SATISFIED':
      wantExit(0);
      return { kind: 'ALREADY_SATISFIED' };
    default:
      throw malformed(`unknown marker ${marker}`);
  }
}

/* ==================================================================== *
 * Target guard
 * ==================================================================== */

export type Targets = { owner: Sql; importer: Sql; ownerDsn: string; importDsn: string; ownPids: readonly number[]; describe: string };

function describeDsn(dsn: string): string {
  const u = new URL(dsn);
  return `${decodeURIComponent(u.username)}@${u.hostname}:${u.port || '5432'}/${decodeURIComponent(u.pathname.slice(1))}`;
}

/** Resolve both DSNs from the explicit environment (never `.env`), refuse anything but
 * code_test_db under the expected roles on one server, and print the redacted target. */
export async function connectTargets(): Promise<Targets> {
  const dsns = resolveRehearsalDsns(process.env, { allowOwnerImportDsn: false });
  const ownerTarget = new URL(dsns.ownerDsn);
  const importTarget = new URL(dsns.importDsn);
  if (ownerTarget.host !== importTarget.host) {
    throw new RehearsalRefused(`${REHEARSAL_OWNER_ENV} and ${REHEARSAL_IMPORT_ENV} name different servers`);
  }
  const owner = postgres(dsns.ownerDsn, { max: 1, onnotice: () => {}, connection: { application_name: 'afldb-issue238-rehearsal-owner' } });
  const importer = postgres(dsns.importDsn, { max: 1, onnotice: () => {}, connection: { application_name: 'afldb-issue238-rehearsal-import' } });
  const ownPids: number[] = [];
  try {
    for (const [sql, role] of [[owner, R.ownerRole], [importer, R.importRole]] as const) {
      const [who] = await sql<{ database: string; role: string; pid: number }[]>`
        SELECT current_database() AS database, current_user AS role, pg_backend_pid() AS pid`;
      if (who.database !== R.database) throw new RehearsalRefused(`a session is connected to '${who.database}', not ${R.database}`);
      if (who.role !== role) throw new RehearsalRefused(`a session runs as '${who.role}', expected '${role}'`);
      ownPids.push(who.pid);
    }
  } catch (error) {
    await Promise.all([owner.end({ timeout: 5 }), importer.end({ timeout: 5 })]);
    throw error;
  }
  const describe = `owner ${describeDsn(dsns.ownerDsn)}; import ${describeDsn(dsns.importDsn)}`;
  console.log(`target: ${describe} (current_database() and current_user verified; harness pids owner ${ownPids[0]}, import ${ownPids[1]})`);
  return { owner, importer, ownerDsn: dsns.ownerDsn, importDsn: dsns.importDsn, ownPids, describe };
}

/* ==================================================================== *
 * Namespace, residue and the foreign fingerprint
 * ==================================================================== */

/** SQL predicates selecting fixture-owned rows of each table the fixture or the correction writes.
 * Every constant here is a literal of this file, never input. */
const FIXTURE_PLAYERS = `SELECT id FROM players WHERE slug LIKE '${R.slugPrefix}%'`;
const FIXTURE_MATCHES = `SELECT id FROM matches WHERE match_key LIKE '${R.matchKeyPrefix}%' OR season = ${R.season}`;
const FIXTURE_BATCHES = `SELECT id FROM import_batches WHERE tool = '${R.fixtureTool}'
  OR (tool = '${R.correctionTool}' AND COALESCE(validation_result->>'externalId' LIKE '${R.providerPrefix}%', false))`;
const FIXTURE_ACTOR = `SELECT id FROM auth_users WHERE lower(email) = '${R.actorEmail}'`;

/** In FK-safe DELETE order (teardown walks it top to bottom). The real writers of the concurrency
 * cases (match sheet, Brownlow admin) audit into `data_edits` and may create entry state, always as
 * the fixture actor against a fixture match, so both are fixture rows by those predicates. */
export const FIXTURE_TABLES: readonly { table: string; fixture: string }[] = [
  { table: 'data_edits',
    fixture: `admin_user_id IN (${FIXTURE_ACTOR})
      OR (table_name IN ('matches', 'brownlow_vote_entry_state') AND row_id IN (${FIXTURE_MATCHES}))` },
  { table: 'brownlow_vote_entry_state', fixture: `match_id IN (${FIXTURE_MATCHES}) OR season = ${R.season}` },
  // AFLDB-ISSUE-257 (State B): the real Match Sheet writer's durable authority, keyed `<match_key>|<identity>`.
  { table: 'data_overrides', fixture: `entity_type = 'player_match_stats' AND entity_key LIKE '${R.matchKeyPrefix}%'` },
  // Family D's guard/dependent state (the real Brownlow admin writers' season authority and
  // published totals; the special-record dependents). Season 2092 is fixture-only by precondition.
  { table: 'brownlow_season_authority', fixture: `season = ${R.season}` },
  { table: 'brownlow_season_votes', fixture: `season = ${R.season} OR player_id IN (${FIXTURE_PLAYERS})` },
  { table: 'after_siren_kicks',
    fixture: `season = ${R.season} OR player_id IN (${FIXTURE_PLAYERS}) OR match_id IN (${FIXTURE_MATCHES})` },
  { table: 'player_achievements',
    fixture: `season = ${R.season} OR player_id IN (${FIXTURE_PLAYERS}) OR match_id IN (${FIXTURE_MATCHES})` },
  { table: 'canonical_applications',
    fixture: `external_record_id LIKE '${R.matchProviderPrefix}%' OR import_batch_id IN (${FIXTURE_BATCHES})` },
  // Family F: the retained pending `unresolved_identity` candidates (the surname gate's source and
  // the admin link's evidence). They cite a fixture observation, so they go before the versions.
  { table: 'promotion_candidates',
    fixture: `external_record_id LIKE '${R.matchProviderPrefix}%' OR created_by_batch_id IN (${FIXTURE_BATCHES})` },
  { table: 'staging.afl_api_player_match', fixture: `provider_player_id LIKE '${R.providerPrefix}%'` },
  { table: 'staging.afl_api_brownlow_vote',
    fixture: `provider_player_id LIKE '${R.providerPrefix}%' OR provider_match_id LIKE '${R.matchProviderPrefix}%'` },
  { table: 'staging.source_record_versions', fixture: `external_record_id LIKE '${R.matchProviderPrefix}%'` },
  { table: 'staging.source_payloads',
    fixture: `COALESCE(raw_payload #>> '{playerStats,player,playerId}' LIKE '${R.providerPrefix}%', false)
      OR COALESCE(family = 'brownlow_match_votes' AND raw_payload->>'providerMatchId' LIKE '${R.matchProviderPrefix}%', false)` },
  { table: 'data_issues', fixture: `COALESCE(details->>'external_id' LIKE '${R.providerPrefix}%', false)` },
  { table: 'import_rejections', fixture: `import_batch_id IN (${FIXTURE_BATCHES})` },
  { table: 'player_match_stats', fixture: `player_id IN (${FIXTURE_PLAYERS}) OR match_id IN (${FIXTURE_MATCHES})` },
  { table: 'brownlow_round_votes', fixture: `player_id IN (${FIXTURE_PLAYERS}) OR season = ${R.season}` },
  { table: 'player_clubs', fixture: `player_id IN (${FIXTURE_PLAYERS})` },
  { table: 'player_club_season_stats', fixture: `player_id IN (${FIXTURE_PLAYERS}) OR season = ${R.season}` },
  { table: 'player_season_stats', fixture: `player_id IN (${FIXTURE_PLAYERS}) OR season = ${R.season}` },
  { table: 'player_career_stats', fixture: `player_id IN (${FIXTURE_PLAYERS})` },
  { table: 'stat_availability', fixture: `season = ${R.season}` },
  // The real deleteMatch rebuilds 2092's ladder (`recomputeClubSeasons`, case 72).
  { table: 'club_seasons', fixture: `season = ${R.season}` },
  { table: 'matches', fixture: `id IN (${FIXTURE_MATCHES})` },
  { table: 'afl_api_identity_adjudications', fixture: `external_id LIKE '${R.providerPrefix}%'` },
  { table: 'external_identities',
    fixture: `external_id LIKE '${R.providerPrefix}%' OR external_id LIKE '${R.pathPrefix}%' OR player_id IN (${FIXTURE_PLAYERS})` },
  { table: 'players', fixture: `id IN (${FIXTURE_PLAYERS})` },
  { table: 'seasons', fixture: `year = ${R.season}` },
  { table: 'import_batches', fixture: `id IN (${FIXTURE_BATCHES})` },
  { table: 'auth_users', fixture: `id IN (${FIXTURE_ACTOR})` },
];

/** A fixture predicate that is never NULL: `player_id IN (...)` on a nullable column is NULL, not
 * false, and `NOT NULL` would silently drop that row from the foreign fingerprint. */
const isFixture = (t: { fixture: string }) => `COALESCE((${t.fixture}), false)`;

export type Census = Record<string, number>;
export type Fingerprint = Record<string, string>;

export async function residue(tx: TransactionSql): Promise<Census> {
  const out: Census = {};
  for (const t of FIXTURE_TABLES) {
    const [row] = await tx.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${t.table} WHERE ${isFixture(t)}`);
    out[t.table] = row.n;
  }
  return out;
}

export const residueTotal = (c: Census) => Object.values(c).reduce((a, b) => a + b, 0);
export const readResidue = (sql: Sql) => sql.begin('isolation level repeatable read read only', (tx) => residue(tx));
export const nonZero = (c: Census) => JSON.stringify(Object.fromEntries(Object.entries(c).filter(([, n]) => n !== 0)));

/** Columns a derive writer regenerates on every insert, per table (case 47 only; see
 * `REBUILD_LOCAL`). Every other case compares the full row text. */
export type RebuildLocal = Readonly<Record<string, readonly string[]>>;

/** The row text a fingerprint hashes: the whole row, or its jsonb minus the rebuild-local columns. */
const fingerprintRowText = (table: string, local: RebuildLocal) => (local[table]
  ? `(to_jsonb(x) - ARRAY[${local[table].map((c) => `'${c}'`).join(', ')}]::text[])::text`
  : 'x::text');

/** Count and order-independent row-text hash of every NON-fixture row, per table. */
export async function foreignFingerprint(sql: Sql, local: RebuildLocal = {}): Promise<Fingerprint> {
  return sql.begin('isolation level repeatable read read only', async (tx) => {
    const out: Fingerprint = {};
    for (const t of FIXTURE_TABLES) {
      const [row] = await tx.unsafe<{ n: string; h: string | null }[]>(
        `SELECT count(*)::text AS n, sum(hashtextextended(${fingerprintRowText(t.table, local)}, 0)::numeric)::text AS h
           FROM ${t.table} x WHERE NOT ${isFixture(t)}`);
      out[t.table] = `${row.n}:${row.h ?? '-'}`;
    }
    return out;
  });
}

export function fingerprintDiff(a: Fingerprint, b: Fingerprint): string[] {
  return Object.keys(a).filter((k) => a[k] !== b[k]).map((k) => `${k} ${a[k]} -> ${b[k]}`);
}

/** FK-ordered delete of exactly the fixture predicates, in one transaction. */
export async function teardownFixture(owner: Sql): Promise<void> {
  await owner.begin(async (tx) => {
    // Bounded: a lock left behind by a failed concurrency case makes teardown fail, never hang.
    await tx`SELECT set_config('lock_timeout', '10s', true)`;
    for (const t of FIXTURE_TABLES) await tx.unsafe(`DELETE FROM ${t.table} WHERE ${isFixture(t)}`);
  });
}

/* ==================================================================== *
 * Fixture builders (pre-state only; the real CLI performs every correction write)
 * ==================================================================== */

type Club = { id: number };
export type World = {
  caseCode: string; season: number; sourceIds: { aflApi: number; afltables: number };
  actorId: number; settleBatchId: number; clubs: { home: Club; away: Club };
  providerId: string; p: { id: number; path: string }; pPrime: { id: number; path: string };
};

const caseCode = (n: number) => String(n).padStart(3, '0');

async function sourceId(tx: TransactionSql, key: string): Promise<number> {
  const [row] = await tx<{ id: number }[]>`SELECT id FROM sources WHERE key = ${key}`;
  if (!row) throw new RehearsalRefused(`sources.key '${key}' is missing`);
  return row.id;
}

async function insertPlayer(tx: TransactionSql, code: string, role: string, sources: World['sourceIds'], surname = `Zz238-${code}-${role}`) {
  const path = `${R.pathPrefix}${code}_${role}.html`;
  const [player] = await tx<{ id: number }[]>`
    INSERT INTO players (display_name, sort_name, search_name, slug, given_name, surname, notes)
    VALUES (${`Rehearsal ${surname}`}, ${`${surname}, Rehearsal`}, ${`rehearsal ${surname.toLowerCase()}`},
            ${`${R.slugPrefix}${code}-${role.toLowerCase()}`}, 'Rehearsal', ${surname},
            'AFLDB-ISSUE-238 Slice 10 rehearsal fixture')
    RETURNING id
  `;
  await tx`
    INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method, notes)
    VALUES (${sources.afltables}, ${path}, ${player.id}, 'unique', 1, 'afltables_profile_url',
            'AFLDB-ISSUE-238 Slice 10 rehearsal fixture')
  `;
  return { id: player.id, path };
}

/**
 * `world`: the attribution-only actor, one completed synthetic settle batch, season 2092, P and P′
 * (each with an accepted AFL Tables identity) and `CD_I` held at P as a D5 importer row
 * (`unique`, candidate_count 1, a D5 importer match_method, NULL external_url).
 * `importerLink: false` leaves CD_I with NO identity row (a provider the admin surface links, case
 * 31); `surnames` overrides P's / P′'s canonical surname (Family F's surname gate).
 * `realSeason` (case 82 only) places the world in an EXISTING season instead of 2092: its `seasons`
 * row is read, never inserted, and the two clubs are two of that season's own (READ only).
 */
export type WorldOptions = { importerLink?: boolean; surnames?: { p?: string; pPrime?: string }; realSeason?: number };

export async function world(tx: TransactionSql, caseNumber: number, options: WorldOptions = {}): Promise<World> {
  const code = caseCode(caseNumber);
  const sourceIds = { aflApi: await sourceId(tx, 'afl_api'), afltables: await sourceId(tx, 'afltables') };
  const [actor] = await tx<{ id: number }[]>`
    INSERT INTO auth_users (email, role, password_hash, disabled_at)
    VALUES (${R.actorEmail}, 'super_admin', NULL, now()) RETURNING id
  `;
  const [batch] = await tx<{ id: string }[]>`
    INSERT INTO import_batches (source_id, tool, target_table, status, completed_at, notes)
    VALUES (${sourceIds.aflApi}, ${R.fixtureTool}, 'player_match_stats', 'completed', now(),
            ${`AFLDB-ISSUE-238 Slice 10 rehearsal case ${code}: synthetic settle batch`})
    RETURNING id::text AS id
  `;
  const season = options.realSeason ?? R.season;
  if (options.realSeason === undefined) {
    await tx`INSERT INTO seasons (year, league, status, notes) VALUES (${R.season}, 'AFL', 'complete', 'AFLDB-ISSUE-238 Slice 10 rehearsal fixture')`;
  } else {
    const [existing] = await tx<{ status: string }[]>`SELECT status::text AS status FROM seasons WHERE year = ${season}`;
    if (existing?.status !== 'complete') throw new RehearsalRefused(`real season ${season} is not a complete seasons row`);
  }
  const clubs = await tx<Club[]>`
    SELECT DISTINCT home_club_id AS id FROM matches
     WHERE season = ${options.realSeason === undefined ? tx`(SELECT max(season) FROM matches WHERE season < ${R.season})` : tx`${season}`}
     ORDER BY 1 LIMIT 2
  `;
  if (clubs.length !== 2) throw new RehearsalRefused(`code_test_db has no two clubs in season ${options.realSeason ?? 'latest'}`);
  const p = await insertPlayer(tx, code, 'P', sourceIds, options.surnames?.p);
  const pPrime = await insertPlayer(tx, code, 'Pprime', sourceIds, options.surnames?.pPrime);
  const providerId = `${R.providerPrefix}${code}1`;
  if (options.importerLink ?? true) {
    await tx`
      INSERT INTO external_identities (source_id, external_id, external_name, player_id, status, candidate_count, match_method, notes)
      VALUES (${sourceIds.aflApi}, ${providerId}, ${`Rehearsal Zz238-${code}-P`}, ${p.id}, 'unique', 1,
              'afl_api_stat_vector_bootstrap', 'AFLDB-ISSUE-238 Slice 10 rehearsal fixture')
    `;
  }
  return {
    caseCode: code, season, sourceIds, actorId: actor.id, settleBatchId: Number(batch.id),
    clubs: { home: clubs[0], away: clubs[1] }, providerId, p, pPrime,
  };
}

export type PmsClosureRow = {
  matchId: number; rowId: number; family: 'player_match_stats'; externalRecordId: string; versionSeq: number;
  insertApplicationId: number; values: Record<string, JsonValue>; contractSha256: string;
};

/** The settled statistics of the closure row: every §5.8 contract field except `brownlow_votes`,
 * which the AFL API never writes (so it is absent from the insert's new_values and NULL on the row). */
function settledValues(clubId: number): Record<string, JsonValue> {
  return {
    club_id: clubId, jumper_number: '23', kicks: 14, marks: 5, handballs: 9, disposals: 23, goals: 2, behinds: 1,
    hitouts: 0, tackles: 4, rebounds: 2, inside_50s: 5, clearances: 3, clangers: 2, frees_for: 1, frees_against: 1,
    contested: 9, uncontested: 14, contested_marks: 1, marks_inside_50: 2, one_percenters: 3, bounces: 1, goal_assists: 1,
  };
}

/**
 * `pmsClosureRow`: match M, the settle's stored observation (payload + version 1), its `insert`
 * application at `{player_id: P, match_id: M}`, the `afl_api`-owned row stamped `<CD_M>|<team>|CD_I`
 * with the settle batch, and CD_I's typed projection naming P -- the shape `writePlayerMatchStats`
 * and `writeLedgerRow` leave (`canonical-apply.ts`).
 */
export type FixtureMatch = { id: number; providerMatchId: string; matchKey: string; roundNumber: number };

/** A home-and-away match of round `round` (default 1), season 2092, between the two real clubs,
 * named by fixture number `n` (match key, and the provider match id `CD_M` its AFL API
 * observations cite). */
export async function fixtureMatch(tx: TransactionSql, w: World, n: number, round = 1): Promise<FixtureMatch> {
  const providerMatchId = `${R.matchProviderPrefix}${w.caseCode}${n}`;
  const matchKey = `${R.matchKeyPrefix}${w.caseCode}:${n}`;
  const [match] = await tx<{ id: number }[]>`
    INSERT INTO matches (match_key, season, round_code, round_number, round_type, is_final, match_date, venue_raw,
                         home_club_id, away_club_id, home_goals, home_behinds, home_score,
                         away_goals, away_behinds, away_score, result, winner_club_id, margin, attendance_status, notes)
    VALUES (${matchKey}, ${w.season}, ${String(round)}, ${round}, 'home_and_away', false, ${`${w.season}-03-${String(19 + round)}`}, 'Rehearsal Oval',
            ${w.clubs.home.id}, ${w.clubs.away.id}, 10, 10, 70, 8, 8, 56, 'home_win', ${w.clubs.home.id}, 14,
            'not_collected', 'AFLDB-ISSUE-238 Slice 10 rehearsal fixture')
    RETURNING id
  `;
  return { id: match.id, providerMatchId, matchKey, roundNumber: round };
}

/** Store one AFL API observation (payload + version `versionSeq`, default 1, opened by `batchId`,
 * default the settle batch) exactly as the settle's spine does, and return its payload hash.
 * `observedHoursAgo` backdates `observed_from` (a superseding version must start where the version
 * it closes ended: the spine's interval chain has no gaps). */
async function storeObservation(
  tx: TransactionSql, w: World, family: string, externalRecordId: string, payload: JsonValue,
  options: { versionSeq?: number; batchId?: number; observedHoursAgo?: number } = {},
): Promise<string> {
  const payloadHash = await storePayload(tx, w, family, payload);
  await tx`
    INSERT INTO staging.source_record_versions (source_id, family, external_record_id, version_seq, payload_hash, observed_from, opened_by_batch_id)
    VALUES (${w.sourceIds.aflApi}, ${family}, ${externalRecordId}, ${options.versionSeq ?? 1}, ${payloadHash},
            now() - make_interval(hours => ${options.observedHoursAgo ?? 0}), ${options.batchId ?? w.settleBatchId})
  `;
  return payloadHash;
}

/** The content-addressed payload row alone (`staging.source_payloads`), as the spine stores it. */
async function storePayload(tx: TransactionSql, w: World, family: string, payload: JsonValue): Promise<string> {
  const canonical = canonicalJson(payload);
  const payloadHash = createHash(HASH_ALGORITHM).update(canonical, 'utf8').digest('hex');
  await tx`
    INSERT INTO staging.source_payloads (source_id, family, payload_hash, hash_recipe, raw_payload)
    VALUES (${w.sourceIds.aflApi}, ${family}, ${payloadHash}, ${`${HASH_ALGORITHM}/v${HASH_VERSION}()`},
            ${tx.json(JSON.parse(canonical) as never)})
  `;
  return payloadHash;
}

/** A further completed synthetic settle batch (a later settle run), for multi-batch histories. */
async function laterSettleBatch(tx: TransactionSql, w: World, targetTable: string, what: string): Promise<number> {
  const [batch] = await tx<{ id: string }[]>`
    INSERT INTO import_batches (source_id, tool, target_table, status, completed_at, notes)
    VALUES (${w.sourceIds.aflApi}, ${R.fixtureTool}, ${targetTable}, 'completed', now(),
            ${`AFLDB-ISSUE-238 Slice 10 rehearsal case ${w.caseCode}: ${what}`})
    RETURNING id::text AS id
  `;
  return Number(batch.id);
}

/** The settle's per-player `player_match_stats` observation of `providerId` at CD_M; `surname` is the
 * provider's published surname (default: P's, the name the observation was settled under). */
function pmsPayload(
  w: World, providerMatchId: string, providerTeamId: string, providerId: string, values: Record<string, JsonValue>,
  surname = `Zz238-${w.caseCode}-P`,
): JsonValue {
  return {
    providerMatchId, teamId: providerTeamId,
    playerStats: {
      player: { playerId: providerId, jumperNumber: 23, playerName: { givenName: 'Rehearsal', surname } },
      stats: Object.fromEntries(Object.entries(values).filter(([k]) => k !== 'club_id' && k !== 'jumper_number')),
    },
  };
}

/** CD_I's typed `staging.afl_api_player_match` projection naming `playerId`, projected by `batchId`. */
async function projectPlayerMatch(
  tx: TransactionSql, w: World, match: FixtureMatch, externalRecordId: string, providerTeamId: string,
  playerId: number, values: Record<string, JsonValue>, batchId: number,
): Promise<void> {
  const { club_id: clubId, jumper_number: jumper, ...stats } = values;
  await tx`
    INSERT INTO staging.afl_api_player_match ${tx({
      source_id: w.sourceIds.aflApi, family: 'player_match_stats', external_record_id: externalRecordId, version_seq: 1,
      provider_match_id: match.providerMatchId, provider_team_id: providerTeamId, provider_player_id: w.providerId,
      season: w.season, match_key: match.matchKey, player_id: playerId, club_id: clubId, jumper_number: jumper, ...stats,
      projected_by_batch_id: batchId,
    } as never)}
  `;
}

/** `onMatch`: settle the row on an existing fixture match (a Brownlow closure row pairs with it);
 * `observedSurname`: the surname CD_I's observation publishes (default P's). */
export async function pmsClosureRow(
  tx: TransactionSql, w: World, n: number, onMatch?: FixtureMatch, observedSurname?: string,
): Promise<PmsClosureRow> {
  return settlePmsClosure(tx, w, await observePmsClosure(tx, w, n, onMatch, observedSurname));
}

/** The first half of `pmsClosureRow`: match M and CD_I's stored observation (payload + version 1)
 * only -- what exists after a settle run that saw CD_I but could not resolve it (case 31 links CD_I
 * between the two halves, as the admin surface does). */
type ObservedPms = { match: FixtureMatch; providerTeamId: string; externalRecordId: string; values: Record<string, JsonValue> };

async function observePmsClosure(
  tx: TransactionSql, w: World, n: number, onMatch?: FixtureMatch, observedSurname?: string,
): Promise<ObservedPms> {
  const match = onMatch ?? await fixtureMatch(tx, w, n);
  const { providerMatchId } = match;
  const providerTeamId = `${R.teamPrefix}H`;
  const externalRecordId = `${providerMatchId}|${providerTeamId}|${w.providerId}`;
  const values = settledValues(w.clubs.home.id);
  await storeObservation(tx, w, 'player_match_stats', externalRecordId,
    pmsPayload(w, providerMatchId, providerTeamId, w.providerId, values, observedSurname));
  return { match, providerTeamId, externalRecordId, values };
}

/** The second half: the settle's `insert` application at (P, M), the afl_api-owned row and CD_I's
 * typed projection naming P, all citing the observation's version 1. */
async function settlePmsClosure(tx: TransactionSql, w: World, observed: ObservedPms): Promise<PmsClosureRow> {
  const { match, providerTeamId, externalRecordId, values } = observed;
  const [application] = await tx<{ id: string }[]>`
    INSERT INTO canonical_applications (import_batch_id, source_id, family, external_record_id, source_version_seq,
                                        target_table, target_key, verb, previous_values, new_values)
    VALUES (${w.settleBatchId}, ${w.sourceIds.aflApi}, 'player_match_stats', ${externalRecordId}, 1,
            'player_match_stats', ${tx.json({ player_id: w.p.id, match_id: match.id })}, 'insert', NULL,
            ${tx.json(values as never)})
    RETURNING id::text AS id
  `;
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO player_match_stats ${tx({
      player_id: w.p.id, match_id: match.id, ...values,
      source_id: w.sourceIds.aflApi, source_record_id: externalRecordId, import_batch_id: w.settleBatchId,
    } as never)}
    RETURNING id::text AS id
  `;
  await projectPlayerMatch(tx, w, match, externalRecordId, providerTeamId, w.p.id, values, w.settleBatchId);
  return {
    matchId: match.id, rowId: Number(row.id), family: 'player_match_stats', externalRecordId, versionSeq: 1,
    insertApplicationId: Number(application.id), values,
    contractSha256: rowContractHash(Object.fromEntries(PLAYER_MATCH_STATS_CONTRACT_FIELDS.map((f) => [f, values[f] ?? null]))),
  };
}

export type TwoProviderPmsRow = PmsClosureRow & {
  otherProviderId: string; otherExternalRecordId: string; otherInsertApplicationId: number;
  updateApplicationId: number; laterBatchId: number;
};

/**
 * `insertedThroughAnotherProvider` (case 23's history, §5.2 P3 "a history where another provider
 * (CD_J -> P, later revoked) wrote it"): another AFL API provider CD_J, then resolved to P, settled
 * the row's `insert` at {P, M} (goals 2) in the settle batch. CD_J's link is gone: it holds no
 * identity row and no ledger row. CD_I, now resolved to P, later settled CD_M in batch B2 and
 * UPDATED the same row (goals 2 -> 3), restamping it `<CD_M>|<team>|CD_I` with B2 and projecting
 * CD_I -> P. Every application is `afl_api`-sourced, P4 (insert first), P2 (CD_I stamp, latest
 * batch), P5 and P7 (current = insert + update) all hold, so only P3's provider rule can refuse it.
 * CD_J uses a provider-namespace slot (`...<ccc>2`) because the provider CHECK allows `CD_I<digits>` only.
 */
async function insertedThroughAnotherProvider(tx: TransactionSql, w: World, n: number): Promise<TwoProviderPmsRow> {
  const match = await fixtureMatch(tx, w, n);
  const providerTeamId = `${R.teamPrefix}H`;
  const otherProviderId = `${R.providerPrefix}${w.caseCode}2`;
  const otherExternalRecordId = `${match.providerMatchId}|${providerTeamId}|${otherProviderId}`;
  const externalRecordId = `${match.providerMatchId}|${providerTeamId}|${w.providerId}`;
  const inserted = settledValues(w.clubs.home.id);
  const values: Record<string, JsonValue> = { ...inserted, goals: 3 };
  const key = { player_id: w.p.id, match_id: match.id };

  await storeObservation(tx, w, 'player_match_stats', otherExternalRecordId, pmsPayload(w, match.providerMatchId, providerTeamId, otherProviderId, inserted));
  const [insert] = await tx<{ id: string }[]>`
    INSERT INTO canonical_applications (import_batch_id, source_id, family, external_record_id, source_version_seq,
                                        target_table, target_key, verb, previous_values, new_values)
    VALUES (${w.settleBatchId}, ${w.sourceIds.aflApi}, 'player_match_stats', ${otherExternalRecordId}, 1,
            'player_match_stats', ${tx.json(key)}, 'insert', NULL, ${tx.json(inserted as never)})
    RETURNING id::text AS id
  `;
  const laterBatchId = await laterSettleBatch(tx, w, 'player_match_stats', `later settle, ${w.providerId} (now at P) updates the row CD_J inserted`);
  await storeObservation(tx, w, 'player_match_stats', externalRecordId,
    pmsPayload(w, match.providerMatchId, providerTeamId, w.providerId, values), { batchId: laterBatchId });
  const [update] = await tx<{ id: string }[]>`
    INSERT INTO canonical_applications (import_batch_id, source_id, family, external_record_id, source_version_seq,
                                        target_table, target_key, verb, previous_values, new_values)
    VALUES (${laterBatchId}, ${w.sourceIds.aflApi}, 'player_match_stats', ${externalRecordId}, 1,
            'player_match_stats', ${tx.json(key)}, 'update', ${tx.json({ goals: 2 })}, ${tx.json({ goals: 3 })})
    RETURNING id::text AS id
  `;
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO player_match_stats ${tx({
      ...key, ...values, source_id: w.sourceIds.aflApi, source_record_id: externalRecordId, import_batch_id: laterBatchId,
    } as never)}
    RETURNING id::text AS id
  `;
  await projectPlayerMatch(tx, w, match, externalRecordId, providerTeamId, w.p.id, values, laterBatchId);
  return {
    matchId: match.id, rowId: Number(row.id), family: 'player_match_stats', externalRecordId, versionSeq: 1,
    insertApplicationId: Number(insert.id), values,
    contractSha256: rowContractHash(Object.fromEntries(PLAYER_MATCH_STATS_CONTRACT_FIELDS.map((f) => [f, values[f] ?? null]))),
    otherProviderId, otherExternalRecordId, otherInsertApplicationId: Number(insert.id),
    updateApplicationId: Number(update.id), laterBatchId,
  };
}

/**
 * `participation`: a FOREIGN (AFL Tables-owned, no AFL API lineage) `player_match_stats` row for
 * `playerId` at match M. It is the C1c participation a Brownlow-only MOVE needs at P′, and it is
 * never a closure candidate (the planner reads candidates at P only).
 */
export async function participation(tx: TransactionSql, w: World, playerId: number, matchId: number): Promise<number> {
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO player_match_stats ${tx({
      player_id: playerId, match_id: matchId, ...settledValues(w.clubs.home.id), jumper_number: '31',
      source_id: w.sourceIds.afltables, source_record_id: null, import_batch_id: null,
    } as never)}
    RETURNING id::text AS id
  `;
  return Number(row.id);
}

/**
 * A P′ COUNTERPART at the closure row's key (§5.4 C2-C9), by its owner: `foreign` is an AFL
 * Tables-owned row with no AFL API stamps (a real non-afl_api source), `null_owned` a row whose
 * `source_id` is NULL (the planner maps it to `null_owned`, the same policy as foreign, case 52).
 * Neither carries any CD_I lineage.
 */
type CounterpartOwner = 'foreign' | 'null_owned';

const counterpartSourceId = (w: World, owner: CounterpartOwner) => (owner === 'foreign' ? w.sourceIds.afltables : null);

/** The counterpart's statistics, as named value mutations of the closure row's settled values. */
const identicalTo = (closure: PmsClosureRow): Record<string, JsonValue> => ({ ...closure.values });
const differingIn = (closure: PmsClosureRow, field: string, value: JsonValue): Record<string, JsonValue> => ({ ...closure.values, [field]: value });

/** `counterpart` (player_match_stats): P′'s row at match M with `values`, owned by `owner`. */
async function pmsCounterpart(
  tx: TransactionSql, w: World, matchId: number, owner: CounterpartOwner, values: Record<string, JsonValue>,
): Promise<number> {
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO player_match_stats ${tx({
      player_id: w.pPrime.id, match_id: matchId, ...values,
      source_id: counterpartSourceId(w, owner), source_record_id: null, import_batch_id: null,
    } as never)}
    RETURNING id::text AS id
  `;
  return Number(row.id);
}

/** `counterpart` (brownlow_round_votes): P′'s round row at the closure row's (season, round). */
async function brownlowCounterpart(
  tx: TransactionSql, w: World, match: FixtureMatch, owner: CounterpartOwner,
  values: { played: boolean; votes: number | null; match_id: number | null },
): Promise<number> {
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO brownlow_round_votes ${tx({
      season: w.season, player_id: w.pPrime.id, round_number: match.roundNumber, ...values,
      source_id: counterpartSourceId(w, owner), source_record_id: null, import_batch_id: null,
    } as never)}
    RETURNING id::text AS id
  `;
  return Number(row.id);
}

export type BrownlowVoter ={ role: string; providerId: string; playerId: number; providerTeamId: string; votes: 1 | 2 | 3 };

type BrownlowValues = { played: boolean; votes: number; match_id: number | null };

export type BrownlowClosureRow = {
  match: FixtureMatch; rowId: number; family: 'brownlow_match_votes'; externalRecordId: string; versionSeq: number;
  insertApplicationId: number; naturalKey: { season: number; player_id: number; round_number: number };
  values: BrownlowValues; contractSha256: string;
  /** The other two voters of the same 3/2/1 vote set, each a settled row of its own fixture player. */
  companions: readonly (BrownlowVoter & { rowId: number; applicationId: number })[];
};

/** A companion voter: a fixture player with its AFL Tables identity and a D5 importer `afl_api`
 * identity for `CD_I<...><slot>`, so the vote set resolves the way a real settle resolves it. */
async function voter(tx: TransactionSql, w: World, role: string, slot: number, providerTeamId: string, votes: 1 | 2 | 3): Promise<BrownlowVoter> {
  const player = await insertPlayer(tx, w.caseCode, role, w.sourceIds);
  const providerId = `${R.providerPrefix}${w.caseCode}${slot}`;
  await tx`
    INSERT INTO external_identities (source_id, external_id, external_name, player_id, status, candidate_count, match_method, notes)
    VALUES (${w.sourceIds.aflApi}, ${providerId}, ${`Rehearsal Zz238-${w.caseCode}-${role}`}, ${player.id}, 'unique', 1,
            'afl_api_stat_vector_bootstrap', 'AFLDB-ISSUE-238 Slice 10 rehearsal fixture')
  `;
  return { role, providerId, playerId: player.id, providerTeamId, votes };
}

/**
 * `brownlowClosureRow`: match M's AFL API Brownlow vote set, settled -- the shape
 * `applyAflApiBrownlowVoteSet` leaves (`afl-api-brownlow.ts` `unitInputFor`, projection upsert;
 * `canonical-apply.ts` `writeBrownlowRoundVotes`):
 *   - ONE stored observation of family `brownlow_match_votes`, external record `CD_M`, whose payload
 *     is the per-match `{providerMatchId, apiRoundNumber, votes: [{providerPlayerId, providerTeamId,
 *     votes, eligible}]}` record naming CD_I (3) and two companion voters (2, 1);
 *   - per voter: the `insert` application at `{season, player_id, round_number}` with new_values
 *     `{played: true, votes, match_id: M}`, the `afl_api`-owned `brownlow_round_votes` row stamped
 *     `CD_M` with the settle batch, and its typed `staging.afl_api_brownlow_vote` projection.
 * CD_I's row is at P: the closure row. The Family-C variants are named mutations of this base
 * (`demoteToZero`, `releaseAndClaim`, `withoutClosureProjection`, `corruptInsertPayload`,
 * `adminResolveStep`) or of its settle shape (`BrownlowSettleShape`).
 */
export type BrownlowSettleShape = {
  /** Settle the vote set on an existing fixture match (a paired `player_match_stats` closure row shares it). */
  match?: FixtureMatch;
  /** `resolved` (default): the F007 insert `{played, votes, match_id: M}`. `unresolved`: the pre-F007
   * insert `{played, votes}` of a vote set whose canonical match was not resolved at settle time
   * (`match_id` joined the rendered fields only in I244-F007): every voter's row, and its
   * projection, carries `match_id` NULL. */
  matchIdAtSettle?: 'resolved' | 'unresolved';
  /** CD_I's own inserted `played` (default true). `false` is §5.3 case 2's "a row whose `played`
   * was not `true`", the pre-state a `{votes: 0, played: true}` demotion (case 79) needs. */
  closurePlayed?: boolean;
};

export async function brownlowClosureRow(tx: TransactionSql, w: World, n: number, shape: BrownlowSettleShape = {}): Promise<BrownlowClosureRow> {
  const match = shape.match ?? await fixtureMatch(tx, w, n);
  const resolved = (shape.matchIdAtSettle ?? 'resolved') === 'resolved';
  const home = `${R.teamPrefix}H`;
  const away = `${R.teamPrefix}A`;
  const closureVoter: BrownlowVoter = { role: 'P', providerId: w.providerId, playerId: w.p.id, providerTeamId: home, votes: 3 };
  const voters = [closureVoter, await voter(tx, w, 'V2', 2, away, 2), await voter(tx, w, 'V3', 3, home, 1)];
  const payload: JsonValue = {
    providerMatchId: match.providerMatchId, apiRoundNumber: match.roundNumber,
    votes: voters.map((v) => ({ providerPlayerId: v.providerId, providerTeamId: v.providerTeamId, votes: v.votes, eligible: true })),
  };
  await storeObservation(tx, w, 'brownlow_match_votes', match.providerMatchId, payload);

  const written: (BrownlowVoter & { rowId: number; applicationId: number })[] = [];
  for (const v of voters) {
    const naturalKey = { season: w.season, player_id: v.playerId, round_number: match.roundNumber };
    const played = v === closureVoter ? shape.closurePlayed ?? true : true;
    const values = { played, votes: v.votes, match_id: resolved ? match.id : null };
    // An insert records every field it set: the pre-F007 applier never set `match_id`.
    const inserted = resolved ? values : { played, votes: v.votes };
    const [application] = await tx<{ id: string }[]>`
      INSERT INTO canonical_applications (import_batch_id, source_id, family, external_record_id, source_version_seq,
                                          target_table, target_key, verb, previous_values, new_values)
      VALUES (${w.settleBatchId}, ${w.sourceIds.aflApi}, 'brownlow_match_votes', ${match.providerMatchId}, 1,
              'brownlow_round_votes', ${tx.json(naturalKey)}, 'insert', NULL, ${tx.json(inserted)})
      RETURNING id::text AS id
    `;
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO brownlow_round_votes ${tx({
        ...naturalKey, ...values,
        source_id: w.sourceIds.aflApi, source_record_id: match.providerMatchId, import_batch_id: w.settleBatchId,
      } as never)}
      RETURNING id::text AS id
    `;
    await tx`
      INSERT INTO staging.afl_api_brownlow_vote ${tx({
        source_id: w.sourceIds.aflApi, family: 'brownlow_match_votes', external_record_id: match.providerMatchId, version_seq: 1,
        provider_match_id: match.providerMatchId, provider_player_id: v.providerId, provider_team_id: v.providerTeamId,
        season: w.season, api_round_number: match.roundNumber, canonical_round_number: match.roundNumber,
        votes: v.votes, eligible: true, match_id: resolved ? match.id : null, player_id: v.playerId, club_id: null,
        projected_by_batch_id: w.settleBatchId,
      } as never)}
    `;
    written.push({ ...v, rowId: Number(row.id), applicationId: Number(application.id) });
  }
  const [closure, ...companions] = written;
  const values: BrownlowValues = { played: shape.closurePlayed ?? true, votes: closure.votes, match_id: resolved ? match.id : null };
  return {
    match, rowId: closure.rowId, family: 'brownlow_match_votes', externalRecordId: match.providerMatchId, versionSeq: 1,
    insertApplicationId: closure.applicationId,
    naturalKey: { season: w.season, player_id: w.p.id, round_number: match.roundNumber },
    values, contractSha256: rowContractHash(values),
    companions,
  };
}

export type DemotedBrownlowClosureRow = BrownlowClosureRow & {
  demotion: {
    batchId: number; applicationId: number; previous: Record<string, JsonValue>; next: Record<string, JsonValue>;
    /** The bare F007 `match_id` heals of V2/V3 (an `unresolved` base only). */
    healApplicationIds: number[];
    newVoter: BrownlowVoter & { rowId: number; applicationId: number };
  };
};

/**
 * `demoteToZero` (named mutation of `brownlowClosureRow`; I244-F002, B3-C case 2): a later settle
 * (its own batch B2) observes version 2 of CD_M's vote set, in which CD_I no longer appears -- a
 * new voter V4 now holds 3, V2 and V3 keep 2 and 1. That is the only way an AFL API round row
 * reaches `votes = 0`, the C4 precondition. Exactly what `applyAflApiBrownlowVoteSet` leaves:
 *   - version 1 closed by B2 where version 2 opens (the spine's interval chain, no gap);
 *   - CD_I's stale-recipient demotion FIRST, citing version 2, row restamped with B2,
 *     `source_record_id` still CD_M, so V4's claim of (M, 3) never collides on
 *     `ux_brownlow_round_votes_match_value`; then V4's `insert` and projection. The demotion
 *     proposes `{played: true, votes: 0, match_id: M}` and records only the CHANGED fields
 *     (`canonical-apply.ts` `diffFields`): `{votes: 3} -> {votes: 0}` on the resolved base; with the
 *     F007 heal `{votes: 3, match_id: null} -> {votes: 0, match_id: M}` on an `unresolved` base
 *     (case 78); with `{votes: 3, played: false} -> {votes: 0, played: true}` when CD_I's row was
 *     not `played` (case 79);
 *   - V2/V3: an identical replay writes no application (projections re-versioned only), except the
 *     bare F007 heal `{match_id: null} -> {match_id: M}` of an `unresolved` base, row and projection;
 *   - CD_I's own projection row stays at version 1 naming P (a departed recipient is not projected).
 * Case 6 (the demotion accepted as a MOVE) is Family C; cases 9/12/52 use it as the C4 precondition.
 */
async function demoteToZero(
  tx: TransactionSql, w: World, closure: BrownlowClosureRow, options: { stillUnresolved?: boolean } = {},
): Promise<DemotedBrownlowClosureRow> {
  const { match } = closure;
  // stillUnresolved (case 99): M is STILL unresolved at the later settle, so nothing is healed and
  // every proposal of the vote set carries match_id NULL (the demotion's diff is then {votes} alone).
  const resolvedId = options.stillUnresolved && closure.values.match_id === null ? null : match.id;
  const v4 = await voter(tx, w, 'V4', 4, `${R.teamPrefix}H`, 3);
  const [v2, v3] = closure.companions;
  const batchId = await nextVoteSetVersion(tx, w, match, [v4, v2, v3], 'CD_I demoted');

  const change = changedBrownlowFields({ played: true, votes: 0, match_id: resolvedId }, closure.values);
  const [demotion] = await tx<{ id: string }[]>`
    INSERT INTO canonical_applications (import_batch_id, source_id, family, external_record_id, source_version_seq,
                                        target_table, target_key, verb, previous_values, new_values)
    VALUES (${batchId}, ${w.sourceIds.aflApi}, 'brownlow_match_votes', ${match.providerMatchId}, 2,
            'brownlow_round_votes', ${tx.json(closure.naturalKey)}, 'update', ${tx.json(change.previous)}, ${tx.json(change.next)})
    RETURNING id::text AS id
  `;
  await tx`
    UPDATE brownlow_round_votes SET played = true, votes = 0, match_id = ${resolvedId}, import_batch_id = ${batchId}
     WHERE id = ${closure.rowId}
  `;

  const v4Key = { season: w.season, player_id: v4.playerId, round_number: match.roundNumber };
  const v4Values = { played: true, votes: 3, match_id: resolvedId };
  const [v4App] = await tx<{ id: string }[]>`
    INSERT INTO canonical_applications (import_batch_id, source_id, family, external_record_id, source_version_seq,
                                        target_table, target_key, verb, previous_values, new_values)
    VALUES (${batchId}, ${w.sourceIds.aflApi}, 'brownlow_match_votes', ${match.providerMatchId}, 2,
            'brownlow_round_votes', ${tx.json(v4Key)}, 'insert', NULL, ${tx.json(v4Values)})
    RETURNING id::text AS id
  `;
  const [v4Row] = await tx<{ id: string }[]>`
    INSERT INTO brownlow_round_votes ${tx({
      ...v4Key, ...v4Values, source_id: w.sourceIds.aflApi, source_record_id: match.providerMatchId, import_batch_id: batchId,
    } as never)}
    RETURNING id::text AS id
  `;
  await tx`
    INSERT INTO staging.afl_api_brownlow_vote ${tx({
      source_id: w.sourceIds.aflApi, family: 'brownlow_match_votes', external_record_id: match.providerMatchId, version_seq: 2,
      provider_match_id: match.providerMatchId, provider_player_id: v4.providerId, provider_team_id: v4.providerTeamId,
      season: w.season, api_round_number: match.roundNumber, canonical_round_number: match.roundNumber,
      votes: 3, eligible: true, match_id: resolvedId, player_id: v4.playerId, club_id: null, projected_by_batch_id: batchId,
    } as never)}
  `;
  const healApplicationIds: number[] = [];
  if (closure.values.match_id === null && resolvedId !== null) {
    // The bare F007 heal of the unchanged recipients V2/V3 (their pre-F007 rows carry match_id NULL).
    for (const v of [v2, v3]) {
      const key = { season: w.season, player_id: v.playerId, round_number: match.roundNumber };
      const [heal] = await tx<{ id: string }[]>`
        INSERT INTO canonical_applications (import_batch_id, source_id, family, external_record_id, source_version_seq,
                                            target_table, target_key, verb, previous_values, new_values)
        VALUES (${batchId}, ${w.sourceIds.aflApi}, 'brownlow_match_votes', ${match.providerMatchId}, 2,
                'brownlow_round_votes', ${tx.json(key)}, 'update', ${tx.json({ match_id: null })}, ${tx.json({ match_id: match.id })})
        RETURNING id::text AS id
      `;
      healApplicationIds.push(Number(heal.id));
      await tx`UPDATE brownlow_round_votes SET match_id = ${match.id}, import_batch_id = ${batchId} WHERE id = ${v.rowId}`;
    }
  }
  await tx`
    UPDATE staging.afl_api_brownlow_vote
       SET version_seq = 2, match_id = ${resolvedId}, projected_by_batch_id = ${batchId}, projected_at = now()
     WHERE source_id = ${w.sourceIds.aflApi} AND family = 'brownlow_match_votes' AND external_record_id = ${match.providerMatchId}
       AND provider_player_id = ANY(${[v2.providerId, v3.providerId]})
  `;
  const values: BrownlowValues = { played: true, votes: 0, match_id: resolvedId };
  return {
    ...closure, values, contractSha256: rowContractHash(values),
    demotion: {
      batchId, applicationId: Number(demotion.id), previous: change.previous, next: change.next, healApplicationIds,
      newVoter: { ...v4, rowId: Number(v4Row.id), applicationId: Number(v4App.id) },
    },
  };
}

/** The applier's changed-field diff of a Brownlow proposal against the row's current contract
 * (`canonical-apply.ts` `diffFields`: only changed fields reach `previous_values`/`new_values`). */
function changedBrownlowFields(proposal: BrownlowValues, current: BrownlowValues): { previous: Record<string, JsonValue>; next: Record<string, JsonValue> } {
  const fields = (['played', 'votes', 'match_id'] as const).filter((f) => proposal[f] !== current[f]);
  return {
    previous: Object.fromEntries(fields.map((f) => [f, current[f]])),
    next: Object.fromEntries(fields.map((f) => [f, proposal[f]])),
  };
}

/** A later settle (its own batch B2) observes version 2 of CD_M's vote set, naming `recipients`:
 * version 1 closed by B2 exactly where version 2 opens (the spine's interval chain, no gap).
 * Returns B2. */
async function nextVoteSetVersion(
  tx: TransactionSql, w: World, match: FixtureMatch, recipients: readonly BrownlowVoter[], what: string,
): Promise<number> {
  const batchId = await laterSettleBatch(tx, w, 'brownlow_round_votes', `later settle, ${match.providerMatchId} version 2 (${what})`);
  await tx`
    UPDATE staging.source_record_versions
       SET observed_from = now() - interval '2 hours', observed_to = now() - interval '1 hour', closed_by_batch_id = ${batchId}
     WHERE source_id = ${w.sourceIds.aflApi} AND family = 'brownlow_match_votes'
       AND external_record_id = ${match.providerMatchId} AND version_seq = 1
  `;
  await storeObservation(tx, w, 'brownlow_match_votes', match.providerMatchId, {
    providerMatchId: match.providerMatchId, apiRoundNumber: match.roundNumber,
    votes: recipients.map((v) => ({ providerPlayerId: v.providerId, providerTeamId: v.providerTeamId, votes: v.votes, eligible: true })),
  }, { versionSeq: 2, batchId, observedHoursAgo: 1 });
  return batchId;
}

export type ReleasedAndClaimedBrownlowClosureRow = BrownlowClosureRow & {
  releaseClaim: {
    batchId: number; releaseApplicationId: number; claimApplicationId: number; claimedVotes: number;
    /** V2's own release/claim at its own key (the permutation's other half). */
    companionReleaseApplicationId: number; companionClaimApplicationId: number;
  };
};

/**
 * `releaseAndClaim` (named mutation of `brownlowClosureRow`; I244-F007 two-phase positive-slot
 * update, B3-C case 3): a later settle (batch B2) observes version 2 of CD_M's vote set as the
 * PERMUTATION CD_I 2, V2 3, V3 1 (was 3/2/1). Exactly what `applyAflApiBrownlowVoteSet` leaves:
 *   - phase 1 RELEASE of every current recipient whose positive value differs from its target:
 *     CD_I `{votes: 3} -> {votes: 0}`, then V2 `{votes: 2} -> {votes: 0}`;
 *   - phase 2 CLAIM of the final 3/2/1: V2 `{votes: 0} -> {votes: 3}`, then CD_I
 *     `{votes: 0} -> {votes: 2}`; V3 unchanged (no application);
 * every application in B2 citing version 2 (which names CD_I exactly once, with 2), only changed
 * fields recorded, rows restamped with B2, projections upserted at version 2 with the new votes.
 * CD_I's own history at its key is [insert v1 (3), release v2, claim v2]: r and q ADJACENT.
 */
async function releaseAndClaim(tx: TransactionSql, w: World, closure: BrownlowClosureRow): Promise<ReleasedAndClaimedBrownlowClosureRow> {
  const { match } = closure;
  const [v2, v3] = closure.companions;
  const cdI: BrownlowVoter & { rowId: number } = {
    role: 'P', providerId: w.providerId, playerId: w.p.id, providerTeamId: `${R.teamPrefix}H`, votes: 2, rowId: closure.rowId,
  };
  const v2Target = { ...v2, votes: 3 as const };
  const batchId = await nextVoteSetVersion(tx, w, match, [cdI, v2Target, v3], 'F007 permutation: CD_I 3 -> 2, V2 2 -> 3');
  const keyOf = (playerId: number) => ({ season: w.season, player_id: playerId, round_number: match.roundNumber });
  const write = async (v: { playerId: number; rowId: number }, from: number, to: number): Promise<number> => {
    const [app] = await tx<{ id: string }[]>`
      INSERT INTO canonical_applications (import_batch_id, source_id, family, external_record_id, source_version_seq,
                                          target_table, target_key, verb, previous_values, new_values)
      VALUES (${batchId}, ${w.sourceIds.aflApi}, 'brownlow_match_votes', ${match.providerMatchId}, 2,
              'brownlow_round_votes', ${tx.json(keyOf(v.playerId))}, 'update', ${tx.json({ votes: from })}, ${tx.json({ votes: to })})
      RETURNING id::text AS id
    `;
    await tx`UPDATE brownlow_round_votes SET votes = ${to}, import_batch_id = ${batchId} WHERE id = ${v.rowId}`;
    return Number(app.id);
  };
  const release = await write(cdI, 3, 0);
  const companionRelease = await write(v2, 2, 0);
  const companionClaim = await write(v2, 0, 3);
  const claim = await write(cdI, 0, 2);
  for (const [providerId, votes] of [[cdI.providerId, 2], [v2.providerId, 3], [v3.providerId, 1]] as const) {
    await tx`
      UPDATE staging.afl_api_brownlow_vote
         SET version_seq = 2, votes = ${votes}, projected_by_batch_id = ${batchId}, projected_at = now()
       WHERE source_id = ${w.sourceIds.aflApi} AND family = 'brownlow_match_votes'
         AND external_record_id = ${match.providerMatchId} AND provider_player_id = ${providerId}
    `;
  }
  const values: BrownlowValues = { ...closure.values, votes: 2 };
  return {
    ...closure, values, contractSha256: rowContractHash(values),
    companions: [{ ...v2, votes: 3 }, v3],
    releaseClaim: {
      batchId, releaseApplicationId: release, claimApplicationId: claim, claimedVotes: 2,
      companionReleaseApplicationId: companionRelease, companionClaimApplicationId: companionClaim,
    },
  };
}

/** `withoutClosureProjection` (case 7/8): CD_I's typed projection row at CD_M is absent. Only
 * CD_I's own row goes; the companions' projections, the payload and the history are untouched. */
async function withoutClosureProjection(tx: TransactionSql, w: World, closure: BrownlowClosureRow): Promise<void> {
  const removed = await tx`
    DELETE FROM staging.afl_api_brownlow_vote
     WHERE source_id = ${w.sourceIds.aflApi} AND family = 'brownlow_match_votes'
       AND external_record_id = ${closure.externalRecordId} AND provider_player_id = ${w.providerId}
  `;
  if (removed.count !== 1) throw new RehearsalRefused(`withoutClosureProjection removed ${removed.count} row(s), not 1`);
}

/** The case-8 payload defects: each leaves the version row and a payload in place (both are FK-bound
 * to the insert application, so a truly ABSENT payload cannot exist in this schema) but makes the
 * payload UNPARSEABLE for the real extractor. */
export type InsertPayloadDefect = 'malformed-entry' | 'other-record';

/**
 * `corruptInsertPayload` (case 8, on case 7's topology): version 1 of CD_M -- the version CD_I's
 * insert cites -- is re-pointed at a stored payload carrying exactly one defect:
 *   - `malformed-entry`: CD_I's own voter entry carries `votes` as the string "3";
 *   - `other-record`: the record names a different provider match than the one the insert cites.
 * Everything else about the payload (and the version, application, row and companions) is unchanged.
 */
async function corruptInsertPayload(
  tx: TransactionSql, w: World, closure: BrownlowClosureRow, defect: InsertPayloadDefect,
): Promise<{ originalHash: string; defectiveHash: string }> {
  const [version] = await tx<{ payloadHash: string; payload: { providerMatchId: string; apiRoundNumber: number; votes: Record<string, JsonValue>[] } }[]>`
    SELECT v.payload_hash AS "payloadHash", p.raw_payload AS payload
      FROM staging.source_record_versions v
      JOIN staging.source_payloads p ON p.source_id = v.source_id AND p.family = v.family AND p.payload_hash = v.payload_hash
     WHERE v.source_id = ${w.sourceIds.aflApi} AND v.family = 'brownlow_match_votes'
       AND v.external_record_id = ${closure.externalRecordId} AND v.version_seq = 1
  `;
  const original = version.payload;
  const defective: JsonValue = defect === 'malformed-entry'
    ? { ...original, votes: original.votes.map((e) => (e.providerPlayerId === w.providerId ? { ...e, votes: String(e.votes) } : e)) }
    : { ...original, providerMatchId: `${R.matchProviderPrefix}${w.caseCode}9` };
  const defectiveHash = await storePayload(tx, w, 'brownlow_match_votes', defective);
  await tx`
    UPDATE staging.source_record_versions SET payload_hash = ${defectiveHash}
     WHERE source_id = ${w.sourceIds.aflApi} AND family = 'brownlow_match_votes'
       AND external_record_id = ${closure.externalRecordId} AND version_seq = 1
  `;
  return { originalHash: version.payloadHash, defectiveHash };
}

/**
 * `adminResolveStep` (case 54): step 1 of the admin Brownlow writer's `writeMatchFacts`
 * (`admin-brownlow.ts` "1. Resolve"), verbatim: attach match M to every unresolved round row of
 * (S, R) whose player has a `player_match_stats` row at M, provenance untouched. It writes no
 * `canonical_applications` row. It is not exported on its own: the real writer runs it only inside a
 * finalise/correct, which then demotes and claims (re-owning the rows, case 17's territory) and
 * needs a polled season and complete line-ups; so the fixture runs this one statement as the owner.
 * Returns the ids it resolved.
 */
async function adminResolveStep(tx: TransactionSql, match: FixtureMatch & { season: number }): Promise<number[]> {
  const rows = await tx<{ id: number }[]>`
    UPDATE brownlow_round_votes brv
       SET match_id = ${match.id}
     WHERE brv.match_id IS NULL
       AND brv.season = ${match.season}
       AND brv.round_number = ${match.roundNumber}
       AND EXISTS (
         SELECT 1 FROM player_match_stats pms
          WHERE pms.match_id = ${match.id} AND pms.player_id = brv.player_id
       )
    RETURNING brv.id::int AS id
  `;
  return rows.map((r) => r.id);
}

/**
 * `settleDerived`: the real targeted recompute the settle and the correction both run, and, for a
 * fixture holding settled Brownlow rows, the real `recomputeBrownlowCoverage` the AFL API settle
 * runs after a canonical Brownlow change (`runSettleAflApiBrownlow`). Without it `stat_availability` has no row for 2092 yet,
 * the correction's own recompute would INSERT three, and its byte-identical assertion (§4.D) would
 * rightly refuse: the baseline must be the settled one.
 */
export async function settleDerived(tx: TransactionSql, w: World, options: { brownlow?: boolean } = {}): Promise<void> {
  await recomputePlayerDerivedStats(tx, [w.p.id, w.pPrime.id], w.season);
  if (options.brownlow) await recomputeBrownlowCoverage(tx, w.season);
}

/* ==================================================================== *
 * The real correction CLI, as a subprocess
 * ==================================================================== */

/** `acknowledgeSurname`: pass `--acknowledge-surname-disagreement` (§10 M1; case 58). */
type CorrectInput = { w: World; importDsn: string; evidenceFile: string; note: string; acknowledgeSurname?: boolean };

const TSX_CLI = join(PROJECT_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
/** The correction's own `application_name` (`main`: `afldb-correct-afl-api-identity-<mode>`): how the
 * lock probe finds the subprocess's backend, never by connection order. */
const correctionApplicationName = (mode: CorrectionCliExpectation['mode']) => `afldb-correct-afl-api-identity-${mode}`;

function cliArgv(input: CorrectInput, mode: CorrectionCliExpectation['mode'], expectFingerprint: string | null): string[] {
  return [
    TSX_CLI, CORRECTION_CLI,
    `--${mode}`, '--provider-id', input.w.providerId, '--to-player-id', String(input.w.pPrime.id),
    '--admin-user-id', String(input.w.actorId), '--note', input.note, '--evidence-file', input.evidenceFile,
    '--expect-database', R.database, ...(expectFingerprint === null ? [] : ['--expect-fingerprint', expectFingerprint]),
    ...(input.acknowledgeSurname ? ['--acknowledge-surname-disagreement'] : []),
  ];
}

type CliRun = { status: number | null; stdout: string; stderr: string };
const cliEnv = (input: CorrectInput) => ({ ...process.env, AFLDB_IMPORT_DATABASE_URL: input.importDsn });

function parseCli(input: CorrectInput, mode: CorrectionCliExpectation['mode'], run: CliRun) {
  const expectation = { mode, providerId: input.w.providerId, toPlayerId: input.w.pPrime.id };
  return { result: parseCorrectionCliOutput(run, expectation), ...run };
}

function runCli(input: CorrectInput, mode: CorrectionCliExpectation['mode'], expectFingerprint: string | null) {
  const child = spawnSync(process.execPath, cliArgv(input, mode, expectFingerprint), {
    cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 180_000, env: cliEnv(input),
  });
  if (child.error) throw new RehearsalRefused(`could not run the correction CLI: ${child.error.message}`);
  return parseCli(input, mode, { status: child.status, stdout: child.stdout, stderr: child.stderr });
}

/** The same CLI invocation, started WITHOUT waiting: the concurrency cases observe its backend while
 * it runs. `exited` never rejects on a CLI outcome; a hard 180 s kill bounds a hung child. */
type SpawnedCli = { child: ChildProcess; exited: Promise<CliRun>; running: () => boolean };

function spawnCli(input: CorrectInput, mode: CorrectionCliExpectation['mode'], expectFingerprint: string | null): SpawnedCli {
  const child = spawn(process.execPath, cliArgv(input, mode, expectFingerprint), {
    cwd: PROJECT_ROOT, env: cliEnv(input), stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let running = true;
  child.stdout!.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
  child.stderr!.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  const kill = setTimeout(() => child.kill(), 180_000);
  const exited = new Promise<CliRun>((resolve, reject) => {
    child.on('error', (error) => { running = false; clearTimeout(kill); reject(new RehearsalRefused(`could not run the correction CLI: ${error.message}`)); });
    child.on('close', (status) => { running = false; clearTimeout(kill); resolve({ status, stdout, stderr }); });
  });
  exited.catch(() => {});
  return { child, exited, running: () => running };
}

/* ==================================================================== *
 * Case 1 (§12.1): basic P -> P′, a player_match_stats row proven through CD_I, no P′ counterpart
 * ==================================================================== */

type Check = { name: string; pass: boolean; detail: string };
type CaseContext = {
  owner: Sql; importDsn: string; check: (name: string, pass: boolean, detail?: string) => void;
  /** The concurrency cases' observer: the harness's own `afldb_import` session, which sees the
   * correction's and the writers' backends in full (same role) and every session's pid and locks. */
  observer: Sql; ownerDsn: string; variant: string | null;
  /** Register a check that runs AFTER the run's teardown (case 82: the historical corpus re-proof). */
  afterTeardown: (fn: () => Promise<void>) => void;
};

type RowSnapshot = Record<string, JsonValue>;

async function pmsRow(owner: Sql, id: number): Promise<RowSnapshot | null> {
  const [row] = await owner<{ row: RowSnapshot }[]>`SELECT to_jsonb(p.*) AS row FROM player_match_stats p WHERE id = ${id}`;
  return row?.row ?? null;
}

const contractOf = (row: RowSnapshot) => Object.fromEntries(PLAYER_MATCH_STATS_CONTRACT_FIELDS.map((f) => [f, row[f] ?? null]));

type CommittedResult = Extract<CorrectionCliResult, { kind: 'COMMITTED' | 'ROLLED_BACK' }>;
type Corrected = {
  fingerprint: string; r: CommittedResult; evidenceSha256: string; validateStdout: string; applyStdout: string;
  /** The CLI invocation the correction used: a Q2 re-run repeats it exactly. */
  input: CorrectInput;
};

/**
 * `correct`: the real CLI, as the operator runs it -- `--validate-only` (PLAN OK, nothing written,
 * the fingerprint), then `--apply --expect-fingerprint <that>` (COMMITTED with the expected counts).
 * Any other outcome prints the CLI output and aborts the case; the run's `finally` still tears down.
 */
/** The operator's inputs: the evidence file (and its hash, which the ledger must carry) and the note. */
function prepareCorrection(ctx: CaseContext, w: World, evidenceText?: string): { input: CorrectInput; evidenceSha256: string } {
  const evidenceDir = join(tmpdir(), 'afldb-issue238-slice10-rehearsal');
  mkdirSync(evidenceDir, { recursive: true });
  const evidenceFile = join(evidenceDir, `case-${w.caseCode}.txt`);
  evidenceText ??= `AFLDB-ISSUE-238 Slice 10 code_test_db rehearsal, case ${w.caseCode}: synthetic provider ${w.providerId} `
    + `was settled onto the wrong player (${w.p.path}); the correct player is ${w.pPrime.path}.\n`;
  writeFileSync(evidenceFile, evidenceText, 'utf8');
  const evidenceSha256 = createHash('sha256').update(evidenceText, 'utf8').digest('hex');
  const input: CorrectInput = {
    w, importDsn: ctx.importDsn, evidenceFile,
    note: `AFLDB-ISSUE-238 Slice 10 rehearsal case ${w.caseCode}: correct ${w.providerId} from P to P′.`,
  };
  return { input, evidenceSha256 };
}

/** `--validate-only`: PLAN OK with the expected row count, nothing written; returns the fingerprint. */
async function validateOnly(ctx: CaseContext, input: CorrectInput, rowsPlanned: number): Promise<{ fingerprint: string; stdout: string }> {
  const { owner, check } = ctx;
  const stateBefore = await readResidue(owner);
  const validate = runCli(input, 'validate-only', null);
  console.log(`  validate-only: exit ${String(validate.status)}, ${JSON.stringify(validate.result)}`);
  check(`validate-only: PLAN OK, exit 0, ${rowsPlanned} row(s) planned`,
    validate.result.kind === 'PLANNED' && validate.result.rowsPlanned === rowsPlanned, JSON.stringify(validate.result));
  check('validate-only wrote nothing (fixture census unchanged)',
    JSON.stringify(await readResidue(owner)) === JSON.stringify(stateBefore));
  if (validate.result.kind !== 'PLANNED') {
    console.log(validate.stdout, validate.stderr);
    throw new RehearsalRefused('validate-only did not plan; apply is not attempted');
  }
  return { fingerprint: validate.result.fingerprint, stdout: validate.stdout };
}

async function correct(
  ctx: CaseContext, w: World, expected: { rowsPlanned: number; moved: number; deleted: number },
  options: { acknowledgeSurname?: boolean } = {},
): Promise<Corrected> {
  const { check } = ctx;
  const prepared = prepareCorrection(ctx, w);
  const input: CorrectInput = { ...prepared.input, acknowledgeSurname: options.acknowledgeSurname };
  const { evidenceSha256 } = prepared;
  const { fingerprint, stdout: validateStdout } = await validateOnly(ctx, input, expected.rowsPlanned);
  const validate = { stdout: validateStdout };

  const apply = runCli(input, 'apply', fingerprint);
  console.log(`  apply: exit ${String(apply.status)}, ${JSON.stringify(apply.result)}`);
  const r = apply.result;
  check(`apply: COMMITTED, exit 0, the validate-only fingerprint, moved ${expected.moved}, deleted ${expected.deleted}, report complete`,
    r.kind === 'COMMITTED' && r.fingerprint === fingerprint && r.moved === expected.moved && r.deleted === expected.deleted
      && !r.reportIncomplete, JSON.stringify(r));
  if (r.kind !== 'COMMITTED') {
    console.log(apply.stdout, apply.stderr);
    throw new RehearsalRefused('apply did not commit');
  }
  return { fingerprint, r, evidenceSha256, validateStdout: validate.stdout, applyStdout: apply.stdout, input };
}

/** `c` (§5.6 "Audit time ordering"): the `applied_at` of batch K's correction application for the
 * closure row's cited external record, as UTC text with microseconds. */
async function cutoffOf(owner: Sql, batchId: number, externalRecordId: string): Promise<string | null> {
  const [c] = await owner<{ appliedAt: string }[]>`
    SELECT to_char(applied_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "appliedAt"
      FROM canonical_applications WHERE import_batch_id = ${batchId} AND external_record_id = ${externalRecordId}
  `;
  return c?.appliedAt ?? null;
}

async function case1(ctx: CaseContext): Promise<void> {
  const { owner, check } = ctx;
  const { w, closure } = await owner.begin(async (tx) => {
    const built = await world(tx, 1);
    const row = await pmsClosureRow(tx, built, 1);
    await settleDerived(tx, built);
    return { w: built, closure: row };
  });
  console.log(`  fixture: P=${w.p.id} (${w.p.path}), P'=${w.pPrime.id} (${w.pPrime.path}), provider ${w.providerId}, `
    + `match M=${closure.matchId}, closure row player_match_stats#${closure.rowId}, settle batch ${w.settleBatchId}, actor ${w.actorId}`);

  // ---- pre-state proof ----
  const before = await pmsRow(owner, closure.rowId);
  check('pre: closure row exists at (P, M), afl_api-owned, stamped <CD_M>|<team>|CD_I with the settle batch, brownlow_votes NULL',
    before !== null && before.player_id === w.p.id && before.match_id === closure.matchId
      && before.source_id === w.sourceIds.aflApi && before.source_record_id === closure.externalRecordId
      && Number(before.import_batch_id) === w.settleBatchId && before.brownlow_votes === null,
    JSON.stringify(before && { player_id: before.player_id, source_record_id: before.source_record_id }));
  check('pre: its contract equals the insert application (P7 reconstruction)',
    before !== null && rowContractHash(contractOf(before)) === closure.contractSha256);
  const [{ counterpart, pRows, projection }] = await owner<{ counterpart: number; pRows: number; projection: number | null }[]>`
    SELECT (SELECT count(*)::int FROM player_match_stats WHERE player_id = ${w.pPrime.id} AND match_id = ${closure.matchId}) AS counterpart,
           (SELECT count(*)::int FROM player_match_stats WHERE player_id = ${w.p.id}) AS "pRows",
           (SELECT player_id FROM staging.afl_api_player_match WHERE provider_player_id = ${w.providerId}) AS projection
  `;
  check('pre: no P′ counterpart at M; P holds exactly the one row; the projection names P',
    counterpart === 0 && pRows === 1 && projection === w.p.id, JSON.stringify({ counterpart, pRows, projection }));
  const [{ identity }] = await owner<{ identity: { id: number; player_id: number; status: string; match_method: string } }[]>`
    SELECT to_jsonb(ei.*) AS identity FROM external_identities ei WHERE ei.source_id = ${w.sourceIds.aflApi} AND ei.external_id = ${w.providerId}
  `;
  check('pre: CD_I is an importer row at P (unique, afl_api_stat_vector_bootstrap)',
    identity.player_id === w.p.id && identity.status === 'unique' && identity.match_method === 'afl_api_stat_vector_bootstrap');
  await owner.begin('read only', (tx) => assertAflApiIdentityInvariant(tx));
  check('pre: the combined identity invariant holds with the fixture in place', true);

  // ---- the real CLI: validate-only, then apply with that fingerprint ----
  const { fingerprint, r, evidenceSha256 } = await correct(ctx, w, { rowsPlanned: 1, moved: 1, deleted: 0 });

  // ---- post-state proof ----
  const after = await pmsRow(owner, closure.rowId);
  check('post: the SAME row id now sits at (P′, M)', after !== null && after.player_id === w.pPrime.id && after.match_id === closure.matchId);
  check('post: its contract is byte-identical (MOVE changes player_id only)',
    after !== null && rowContractHash(contractOf(after)) === closure.contractSha256);
  check('post: provenance kept (D3: source_id, source_record_id, import_batch_id unchanged)',
    after !== null && before !== null && after.source_id === before.source_id
      && after.source_record_id === before.source_record_id && after.import_batch_id === before.import_batch_id);
  const [{ pLeft, pPrimeRows }] = await owner<{ pLeft: number; pPrimeRows: number }[]>`
    SELECT (SELECT count(*)::int FROM player_match_stats WHERE player_id = ${w.p.id}) AS "pLeft",
           (SELECT count(*)::int FROM player_match_stats WHERE player_id = ${w.pPrime.id}) AS "pPrimeRows"
  `;
  check('post: P holds no row; P′ holds exactly the moved one', pLeft === 0 && pPrimeRows === 1, JSON.stringify({ pLeft, pPrimeRows }));

  const apps = await owner<{ id: number; importBatchId: number; family: string; externalRecordId: string; versionSeq: number;
    targetKey: JsonValue; verb: string; previousValues: JsonValue; newValues: JsonValue }[]>`
    SELECT id::int AS id, import_batch_id::int AS "importBatchId", family, external_record_id AS "externalRecordId",
           source_version_seq AS "versionSeq", target_key AS "targetKey", verb, previous_values AS "previousValues", new_values AS "newValues"
      FROM canonical_applications WHERE external_record_id = ${closure.externalRecordId} ORDER BY id
  `;
  const move = apps[1];
  check('post: exactly one correction application, bound to batch K, citing the insert\'s version, update {player_id: P} -> {player_id: P′} at (P′, M)',
    apps.length === 2 && apps[0].id === closure.insertApplicationId && move.importBatchId === r.batchId
      && move.family === closure.family && move.versionSeq === closure.versionSeq && move.verb === 'update'
      && canonicalJson(move.targetKey) === canonicalJson({ player_id: w.pPrime.id, match_id: closure.matchId })
      && canonicalJson(move.previousValues) === canonicalJson({ player_id: w.p.id })
      && canonicalJson(move.newValues) === canonicalJson({ player_id: w.pPrime.id }), JSON.stringify(apps.slice(1)));

  await checkLedgerAndIdentity(ctx, w, identity.id, { r, evidenceSha256 });

  const [batch] = await owner<{ tool: string; status: string; recordsInserted: number; vr: Record<string, JsonValue> }[]>`
    SELECT tool, status::text AS status, records_inserted::int AS "recordsInserted", validation_result AS vr
      FROM import_batches WHERE id = ${r.batchId}
  `;
  const proofs = (batch?.vr.rowProofs ?? []) as Record<string, JsonValue>[];
  check('post: batch K completed and bound: adjudication id, closure fingerprint, one update rowProof with the pre-correction contract hash',
    batch?.tool === R.correctionTool && batch.status === 'completed' && batch.recordsInserted === 1
      && batch.vr.kind === 'afl_api_identity_correction' && batch.vr.mode === 'original'
      && batch.vr.adjudicationId === r.adjudicationId && batch.vr.externalId === w.providerId
      && batch.vr.closureFingerprint === fingerprint && batch.vr.adjudicationEvidenceSha256 === evidenceSha256
      && proofs.length === 1 && proofs[0].verb === 'update' && proofs[0].preCorrectionContractSha256 === closure.contractSha256,
    JSON.stringify(batch?.vr.counts));
  const counts = batch?.vr.counts as { moved?: Record<string, number>; deleted?: Record<string, number>; projectionsMoved?: number } | undefined;
  check('post: batch counts: moved player_match_stats 1, deleted 0, projections moved 1',
    counts?.moved?.player_match_stats === 1 && counts.moved.brownlow_round_votes === 0
      && counts.deleted?.player_match_stats === 0 && counts.deleted.brownlow_round_votes === 0 && counts.projectionsMoved === 1);
  const [{ projectionAfter }] = await owner<{ projectionAfter: number }[]>`
    SELECT player_id AS "projectionAfter" FROM staging.afl_api_player_match WHERE provider_player_id = ${w.providerId}
  `;
  check('post: the typed projection of CD_I names P′ (SAT-5)', projectionAfter === w.pPrime.id);

  const derived = await owner<{ playerId: number; season: number | null; games: number; career: number }[]>`
    SELECT p.id AS "playerId", pss.season::int AS season, COALESCE(pss.games, 0)::int AS games, pcs.games::int AS career
      FROM players p
      LEFT JOIN player_season_stats pss ON pss.player_id = p.id AND pss.season = ${w.season}
      LEFT JOIN player_career_stats pcs ON pcs.player_id = p.id
     WHERE p.id IN (${w.p.id}, ${w.pPrime.id}) ORDER BY p.id
  `;
  const dP = derived.find((d) => d.playerId === w.p.id);
  const dPrime = derived.find((d) => d.playerId === w.pPrime.id);
  check('post: targeted recompute: P has no 2092 season row and 0 career games; P′ has 1 game in 2092 and in career',
    dP?.season === null && dP.career === 0 && dPrime?.games === 1 && dPrime.career === 1, JSON.stringify(derived));

  await owner.begin('read only', (tx) => assertAflApiIdentityInvariant(tx));
  check('post: the combined identity invariant (SAT-1 basis) holds', true);
}

/* ==================================================================== *
 * Case 29 (§12.1, R half): the byte-identical stat_availability success path of a Brownlow correction
 * ==================================================================== */

type Hashed = { rows: JsonValue[]; sha256: string };

const hashed = (rows: JsonValue[]): Hashed => ({
  rows, sha256: createHash('sha256').update(canonicalJson(rows), 'utf8').digest('hex'),
});

/** Every `stat_availability` row of `season` (the exact set §8.2 step 8 compares), in key order. */
async function statAvailabilityOf(sql: Sql | TransactionSql, season: number): Promise<Hashed> {
  const rows = await sql<{ row: JsonValue }[]>`
    SELECT to_jsonb(sa.*) AS row FROM stat_availability sa WHERE sa.season = ${season} ORDER BY sa.stat_key
  `;
  return hashed(rows.map((r) => r.row));
}

/** Every derived row of the players: season, club-season, career and club-membership grains. */
async function derivedOf(sql: Sql, playerIds: readonly number[]): Promise<Hashed> {
  const ids = [...playerIds];
  const rows = await sql<{ row: JsonValue }[]>`
    SELECT jsonb_build_object('table', t, 'row', r) AS row FROM (
      SELECT 'player_season_stats' AS t, to_jsonb(x.*) AS r FROM player_season_stats x WHERE x.player_id = ANY(${ids})
      UNION ALL SELECT 'player_club_season_stats', to_jsonb(x.*) FROM player_club_season_stats x WHERE x.player_id = ANY(${ids})
      UNION ALL SELECT 'player_career_stats', to_jsonb(x.*) FROM player_career_stats x WHERE x.player_id = ANY(${ids})
      UNION ALL SELECT 'player_clubs', to_jsonb(x.*) FROM player_clubs x WHERE x.player_id = ANY(${ids})
    ) s ORDER BY t, r::text
  `;
  return hashed(rows.map((r) => r.row));
}

async function rowsById(sql: Sql, table: 'brownlow_round_votes' | 'player_match_stats', ids: readonly number[]): Promise<Map<number, RowSnapshot>> {
  const rows = await sql<{ id: number; row: RowSnapshot }[]>`
    SELECT x.id::int AS id, to_jsonb(x.*) AS row FROM ${sql(table)} x WHERE x.id = ANY(${[...ids]})
  `;
  return new Map(rows.map((r) => [r.id, r.row]));
}

class CoverageProbeRollback extends Error {
  constructor(readonly before: Hashed, readonly after: Hashed) { super('coverage probe: rolled back by design'); }
}

/** Is the settled baseline a FIXED POINT of the real `recomputeBrownlowCoverage`? Run it on the
 * committed state inside a transaction that is always rolled back, and compare. */
async function coverageFixedPoint(owner: Sql, season: number): Promise<{ before: Hashed; after: Hashed }> {
  try {
    await owner.begin(async (tx) => {
      const before = await statAvailabilityOf(tx, season);
      await recomputeBrownlowCoverage(tx, season);
      throw new CoverageProbeRollback(before, await statAvailabilityOf(tx, season));
    });
  } catch (error) {
    if (error instanceof CoverageProbeRollback) return { before: error.before, after: error.after };
    throw error;
  }
  throw new RehearsalRefused('the coverage probe transaction committed; it must always roll back');
}

/** The ledger row the correction must have written. The defaults are importer origin (no prior
 * ledger row, `supersedes_id` NULL), no surname acknowledgement, and an importer `unique` identity
 * snapshot in `previous_state`. Family F overrides them (cases 31 and 58). */
type LedgerExpectation = { priorRows?: number; supersedesId?: number | null; surnameAck?: boolean; previousStatus?: string };

async function checkLedgerAndIdentity(
  ctx: CaseContext, w: World, identityId: number, c: Pick<Corrected, 'r' | 'evidenceSha256'>, expect: LedgerExpectation = {},
): Promise<void> {
  const { owner, check } = ctx;
  const priorRows = expect.priorRows ?? 0;
  const supersedesId = expect.supersedesId ?? null;
  const surnameAck = expect.surnameAck ?? false;
  const previousStatus = expect.previousStatus ?? 'unique';
  const ledger = await owner<{ id: number; action: string; playerId: number; playerIdentity: string; previousPlayerIdentity: string;
    supersedesId: number | null; adminUserId: number; evidenceSha256: string; previousState: JsonValue; surnameAck: boolean }[]>`
    SELECT id::int AS id, action, player_id AS "playerId", player_identity AS "playerIdentity",
           previous_player_identity AS "previousPlayerIdentity", supersedes_id::int AS "supersedesId",
           admin_user_id AS "adminUserId", evidence_sha256 AS "evidenceSha256", previous_state AS "previousState",
           surname_disagreement_acknowledged AS "surnameAck"
      FROM afl_api_identity_adjudications WHERE external_id = ${w.providerId} ORDER BY id
  `;
  const a = ledger[ledger.length - 1];
  check(`post: one new \`corrected\` ledger row after ${priorRows} prior row(s): P′ at its identity, previous identity P, `
    + `supersedes ${supersedesId === null ? 'NULL (importer origin)' : `#${supersedesId}`}, surname ack ${String(surnameAck)}, actor, evidence hash, `
    + `previous_state ${previousStatus} at P`,
    ledger.length === priorRows + 1 && a.id === c.r.adjudicationId && a.action === 'corrected' && a.playerId === w.pPrime.id
      && a.playerIdentity === w.pPrime.path && a.previousPlayerIdentity === w.p.path && a.supersedesId === supersedesId
      && a.adminUserId === w.actorId && a.evidenceSha256 === c.evidenceSha256 && a.surnameAck === surnameAck
      && canonicalJson(a.previousState) === canonicalJson({ id: identityId, playerId: w.p.id, status: previousStatus }),
    JSON.stringify(ledger));
  const [idAfter] = await owner<{ id: number; playerId: number; status: string; candidateCount: number; matchMethod: string; externalName: string | null }[]>`
    SELECT id, player_id AS "playerId", status::text AS status, candidate_count AS "candidateCount",
           match_method AS "matchMethod", external_name AS "externalName"
      FROM external_identities WHERE source_id = ${w.sourceIds.aflApi} AND external_id = ${w.providerId}
  `;
  check('post: CD_I updated in place to P′ (same id, resolved, candidate_count 0, afl_api_admin_adjudication)',
    idAfter.id === identityId && idAfter.playerId === w.pPrime.id && idAfter.status === 'resolved'
      && idAfter.candidateCount === 0 && idAfter.matchMethod === 'afl_api_admin_adjudication' && idAfter.externalName === null,
    JSON.stringify(idAfter));
}

/** The `stat_availability` rows the settled baseline must hold for fixture season 2092: one H&A
 * match whose 3/2/1 vote set is complete, no medal, no admin decisions, no mirrored match votes. */
const SETTLED_BROWNLOW_COVERAGE: Record<string, { is_recorded: boolean; coverage: string; populated_rows: number | null; total_rows: number | null }> = {
  brownlow_match_votes: { is_recorded: false, coverage: 'not_applicable', populated_rows: 0, total_rows: 1 },
  brownlow_round_votes: { is_recorded: true, coverage: 'complete', populated_rows: null, total_rows: null },
  brownlow_season_total: { is_recorded: false, coverage: 'not_applicable', populated_rows: null, total_rows: null },
};

/**
 * Case 29, R half (§12.1: "the normal rehearsal proves the byte-identical success path"): a
 * Brownlow-only correction. CD_I's `brownlow_round_votes` row (3 votes at M) is at P; P′ plays M
 * through a foreign AFL Tables row (C1c); no P′ counterpart (C1 -> MOVE). The correction's §8.2
 * step 8 recomputes 2092's Brownlow coverage and asserts `stat_availability` byte-identical inside
 * its transaction; this case proves the assertion PASSES on a settled baseline and the correction
 * commits, and independently re-proves the same parity from outside after COMMIT.
 *
 * Comparison sets. MUST CHANGE (the correction's own writes): the closure row's `player_id` only;
 * one correction application; the ledger row; CD_I's identity; CD_I's Brownlow projection; batch K.
 * MUST NOT CHANGE: every `stat_availability` row of 2092 (sorted `to_jsonb`, SHA-256), every other
 * column of the closure row, both companion rows, P′'s participation row, P and P′'s derived rows,
 * and every non-fixture row of every table the fixture or the correction writes.
 *
 * Case 5 (Family C, "safe Brownlow closure move: B1-B5, no P′ counterpart, P′ participation in M
 * (C1c), guards pass -> MOVE (C1)") is exactly this topology and proof, run under its own number.
 */
async function case29(ctx: CaseContext): Promise<void> {
  await safeBrownlowMove(ctx, 29);
}

async function safeBrownlowMove(ctx: CaseContext, caseNumber: number): Promise<void> {
  const { owner, check } = ctx;
  const { w, closure, participationRowId } = await owner.begin(async (tx) => {
    const built = await world(tx, caseNumber);
    const row = await brownlowClosureRow(tx, built, 1);
    const participationRow = await participation(tx, built, built.pPrime.id, row.match.id);
    await settleDerived(tx, built, { brownlow: true });
    return { w: built, closure: row, participationRowId: participationRow };
  });
  const companionIds = closure.companions.map((c) => c.rowId);
  console.log(`  fixture: P=${w.p.id} (${w.p.path}), P'=${w.pPrime.id} (${w.pPrime.path}), provider ${w.providerId}, `
    + `match M=${closure.match.id} (${closure.externalRecordId}, round ${closure.match.roundNumber}), closure row brownlow_round_votes#${closure.rowId}, `
    + `companions ${closure.companions.map((c) => `${c.providerId}->player ${c.playerId} brownlow_round_votes#${c.rowId} (${c.votes})`).join(', ')}, `
    + `P' participation player_match_stats#${participationRowId}, settle batch ${w.settleBatchId}, actor ${w.actorId}`);

  // ---- pre-state proof ----
  const brvBefore = await rowsById(owner, 'brownlow_round_votes', [closure.rowId, ...companionIds]);
  const before = brvBefore.get(closure.rowId) ?? null;
  check('pre: closure row at (2092, P, round 1): afl_api-owned, stamped CD_M with the settle batch, played true, votes 3, match_id M',
    before !== null && before.player_id === w.p.id && before.season === w.season && before.round_number === closure.match.roundNumber
      && before.source_id === w.sourceIds.aflApi && before.source_record_id === closure.externalRecordId
      && Number(before.import_batch_id) === w.settleBatchId && before.played === true && before.votes === 3
      && before.match_id === closure.match.id, JSON.stringify(before));
  check('pre: its contract {played, votes, match_id} equals the insert application (B5 reconstruction)',
    before !== null && rowContractHash({ played: before.played, votes: before.votes, match_id: before.match_id }) === closure.contractSha256);
  const [insertApp] = await owner<{ id: number; verb: string; family: string; externalRecordId: string; versionSeq: number;
    targetKey: JsonValue; previousValues: JsonValue; newValues: JsonValue }[]>`
    SELECT id::int AS id, verb, family, external_record_id AS "externalRecordId", source_version_seq AS "versionSeq",
           target_key AS "targetKey", previous_values AS "previousValues", new_values AS "newValues"
      FROM canonical_applications WHERE id = ${closure.insertApplicationId}
  `;
  check('pre: the insert application cites CD_M\'s brownlow_match_votes version 1 at {2092, P, 1} with {played, votes 3, match_id M}',
    insertApp.verb === 'insert' && insertApp.family === 'brownlow_match_votes' && insertApp.externalRecordId === closure.externalRecordId
      && insertApp.versionSeq === 1 && insertApp.previousValues === null
      && canonicalJson(insertApp.targetKey) === canonicalJson(closure.naturalKey)
      && canonicalJson(insertApp.newValues) === canonicalJson(closure.values), JSON.stringify(insertApp));
  const [{ payload }] = await owner<{ payload: unknown }[]>`
    SELECT p.raw_payload AS payload FROM staging.source_record_versions v
      JOIN staging.source_payloads p ON p.source_id = v.source_id AND p.family = v.family AND p.payload_hash = v.payload_hash
     WHERE v.source_id = ${w.sourceIds.aflApi} AND v.family = 'brownlow_match_votes'
       AND v.external_record_id = ${closure.externalRecordId} AND v.version_seq = 1
  `;
  const proof = citedPayloadVoterProof(payload, closure.externalRecordId, w.providerId);
  const voters = extractBrownlowVoterEntries(payload, closure.externalRecordId);
  check('pre: the cited payload parses (real extractor), is a 3/2/1 vote set, and names CD_I exactly once with 3 (B3-I)',
    proof.count === 1 && proof.vote === 3 && voters !== null && voters.map((v) => v.votes).sort().join(',') === '1,2,3',
    JSON.stringify({ proof, voters }));
  const projections = await owner<{ providerPlayerId: string; playerId: number; votes: number; matchId: number }[]>`
    SELECT provider_player_id AS "providerPlayerId", player_id AS "playerId", votes::int AS votes, match_id AS "matchId"
      FROM staging.afl_api_brownlow_vote WHERE provider_match_id = ${closure.externalRecordId} ORDER BY provider_player_id
  `;
  const projectionOf = (providerId: string) => projections.find((p) => p.providerPlayerId === providerId);
  check('pre: the typed projection holds the whole vote set; CD_I\'s names P, each companion\'s names its own player',
    projections.length === 3 && projectionOf(w.providerId)?.playerId === w.p.id
      && closure.companions.every((c) => projectionOf(c.providerId)?.playerId === c.playerId), JSON.stringify(projections));
  const [pre] = await owner<{ pPms: number; pBrv: number; pPrimeBrv: number; pPrimeAtM: number; foreignOwner: string | null }[]>`
    SELECT (SELECT count(*)::int FROM player_match_stats WHERE player_id = ${w.p.id}) AS "pPms",
           (SELECT count(*)::int FROM brownlow_round_votes WHERE player_id = ${w.p.id}) AS "pBrv",
           (SELECT count(*)::int FROM brownlow_round_votes WHERE player_id = ${w.pPrime.id}) AS "pPrimeBrv",
           (SELECT count(*)::int FROM player_match_stats WHERE player_id = ${w.pPrime.id} AND match_id = ${closure.match.id}) AS "pPrimeAtM",
           (SELECT s.key FROM player_match_stats x JOIN sources s ON s.id = x.source_id WHERE x.id = ${participationRowId}) AS "foreignOwner"
  `;
  check('pre: P holds the one Brownlow row and no match row; P′ holds no Brownlow row (no counterpart) and one foreign afltables row at M (C1c)',
    pre.pPms === 0 && pre.pBrv === 1 && pre.pPrimeBrv === 0 && pre.pPrimeAtM === 1 && pre.foreignOwner === 'afltables', JSON.stringify(pre));
  const [{ identity }] = await owner<{ identity: { id: number; player_id: number; status: string; match_method: string } }[]>`
    SELECT to_jsonb(ei.*) AS identity FROM external_identities ei WHERE ei.source_id = ${w.sourceIds.aflApi} AND ei.external_id = ${w.providerId}
  `;
  check('pre: CD_I is an importer row at P (unique, afl_api_stat_vector_bootstrap)',
    identity.player_id === w.p.id && identity.status === 'unique' && identity.match_method === 'afl_api_stat_vector_bootstrap');

  // ---- the settled Brownlow baseline ----
  const saBaseline = await statAvailabilityOf(owner, w.season);
  const brownlowCoverage = Object.fromEntries((saBaseline.rows as RowSnapshot[])
    .filter((r) => String(r.stat_key).startsWith('brownlow_'))
    .map((r) => [String(r.stat_key), { is_recorded: r.is_recorded, coverage: r.coverage, populated_rows: r.populated_rows, total_rows: r.total_rows }]));
  console.log(`  stat_availability 2092 baseline (${saBaseline.rows.length} row(s), sha256 ${saBaseline.sha256}): ${canonicalJson(saBaseline.rows)}`);
  check('baseline: the real recomputeBrownlowCoverage established exactly the three settled Brownlow coverage rows for 2092',
    canonicalJson(brownlowCoverage as JsonValue) === canonicalJson(SETTLED_BROWNLOW_COVERAGE as JsonValue), JSON.stringify(brownlowCoverage));
  const fixedPoint = await coverageFixedPoint(owner, w.season);
  check('baseline: it is a fixed point -- the real recompute, re-run on the committed state (rolled back), leaves 2092 byte-identical',
    fixedPoint.before.sha256 === saBaseline.sha256 && fixedPoint.after.sha256 === saBaseline.sha256,
    `${fixedPoint.before.sha256} -> ${fixedPoint.after.sha256}`);
  const derivedBefore = await derivedOf(owner, [w.p.id, w.pPrime.id]);
  const participationBefore = (await rowsById(owner, 'player_match_stats', [participationRowId])).get(participationRowId) ?? null;
  await owner.begin('read only', (tx) => assertAflApiIdentityInvariant(tx));
  check('pre: the combined identity invariant holds with the fixture in place', true);
  const censusBefore = await readResidue(owner);

  // ---- the real CLI: validate-only, then apply with that fingerprint ----
  const c = await correct(ctx, w, { rowsPlanned: 1, moved: 1, deleted: 0 });
  const seasonLine = `    season ${w.season}: brownlow season-total independence PASS (empty)`;
  check('validate-only: §5.10 ran for 2092 on the positive Brownlow move and passed as `empty`',
    c.validateStdout.replace(/\r/g, '').split('\n').includes(seasonLine));

  // ---- post-state proof ----
  const brvAfter = await rowsById(owner, 'brownlow_round_votes', [closure.rowId, ...companionIds]);
  const after = brvAfter.get(closure.rowId) ?? null;
  const withoutPlayer = (row: RowSnapshot | null) => (row === null ? null : canonicalJson({ ...row, player_id: null }));
  check('post: the SAME brownlow_round_votes row id now sits at (2092, P′, round 1)',
    after !== null && after.player_id === w.pPrime.id && after.season === w.season && after.round_number === closure.match.roundNumber);
  check('post: every other column is byte-identical (contract, provenance stamp, batch, imported_at): MOVE changes player_id only',
    after !== null && withoutPlayer(after) === withoutPlayer(before), JSON.stringify(after));
  check('post: both companion rows of the vote set are byte-identical',
    companionIds.every((id) => brvAfter.has(id) && canonicalJson(brvAfter.get(id)!) === canonicalJson(brvBefore.get(id)!)));
  const [post] = await owner<{ pBrv: number; pPrimeBrv: number; pPms: number; atKey: number }[]>`
    SELECT (SELECT count(*)::int FROM brownlow_round_votes WHERE player_id = ${w.p.id}) AS "pBrv",
           (SELECT count(*)::int FROM brownlow_round_votes WHERE player_id = ${w.pPrime.id}) AS "pPrimeBrv",
           (SELECT count(*)::int FROM player_match_stats WHERE player_id = ${w.p.id}) AS "pPms",
           (SELECT count(*)::int FROM brownlow_round_votes
             WHERE season = ${w.season} AND player_id = ${w.pPrime.id} AND round_number = ${closure.match.roundNumber}) AS "atKey"
  `;
  check('post: P holds no Brownlow row; P′ holds exactly the moved one; no collision/counterpart row created; no match row appeared at P',
    post.pBrv === 0 && post.pPrimeBrv === 1 && post.atKey === 1 && post.pPms === 0, JSON.stringify(post));
  const participationAfter = (await rowsById(owner, 'player_match_stats', [participationRowId])).get(participationRowId) ?? null;
  check('post: P′\'s foreign participation row at M is byte-identical',
    participationAfter !== null && canonicalJson(participationAfter) === canonicalJson(participationBefore!));

  const apps = await owner<{ id: number; importBatchId: number; family: string; externalRecordId: string; versionSeq: number;
    targetKey: JsonValue; verb: string; previousValues: JsonValue; newValues: JsonValue }[]>`
    SELECT id::int AS id, import_batch_id::int AS "importBatchId", family, external_record_id AS "externalRecordId",
           source_version_seq AS "versionSeq", target_key AS "targetKey", verb, previous_values AS "previousValues", new_values AS "newValues"
      FROM canonical_applications WHERE external_record_id = ${closure.externalRecordId} AND target_table = 'brownlow_round_votes' ORDER BY id
  `;
  const corrections = apps.filter((a) => a.importBatchId === c.r.batchId);
  const move = corrections[0];
  check('post: exactly one correction application, bound to batch K, citing the insert\'s CD_M version 1, update {player_id: P} -> {player_id: P′} at {2092, P′, 1}',
    apps.length === 4 && apps.filter((a) => a.verb === 'insert' && a.importBatchId === w.settleBatchId).length === 3
      && corrections.length === 1 && move.family === closure.family && move.externalRecordId === closure.externalRecordId
      && move.versionSeq === closure.versionSeq && move.verb === 'update'
      && canonicalJson(move.targetKey) === canonicalJson({ ...closure.naturalKey, player_id: w.pPrime.id })
      && canonicalJson(move.previousValues) === canonicalJson({ player_id: w.p.id })
      && canonicalJson(move.newValues) === canonicalJson({ player_id: w.pPrime.id }), JSON.stringify(corrections));

  await checkLedgerAndIdentity(ctx, w, identity.id, c);

  const [batch] = await owner<{ tool: string; status: string; recordsInserted: number; vr: Record<string, JsonValue> }[]>`
    SELECT tool, status::text AS status, records_inserted::int AS "recordsInserted", validation_result AS vr
      FROM import_batches WHERE id = ${c.r.batchId}
  `;
  const proofs = (batch?.vr.rowProofs ?? []) as Record<string, JsonValue>[];
  check('post: batch K completed and bound: adjudication id, closure fingerprint, one brownlow_round_votes update rowProof (old/new key, pre-correction contract hash)',
    batch?.tool === R.correctionTool && batch.status === 'completed' && batch.recordsInserted === 1
      && batch.vr.kind === 'afl_api_identity_correction' && batch.vr.mode === 'original'
      && batch.vr.adjudicationId === c.r.adjudicationId && batch.vr.externalId === w.providerId
      && batch.vr.closureFingerprint === c.fingerprint && batch.vr.adjudicationEvidenceSha256 === c.evidenceSha256
      && proofs.length === 1 && proofs[0].table === 'brownlow_round_votes' && proofs[0].verb === 'update'
      && canonicalJson(proofs[0].oldKey) === canonicalJson(closure.naturalKey)
      && canonicalJson(proofs[0].newKey) === canonicalJson({ ...closure.naturalKey, player_id: w.pPrime.id })
      && proofs[0].preCorrectionContractSha256 === closure.contractSha256,
    JSON.stringify(proofs));
  const counts = batch?.vr.counts as { moved?: Record<string, number>; deleted?: Record<string, number>; projectionsMoved?: number } | undefined;
  check('post: batch counts: moved brownlow_round_votes 1 / player_match_stats 0, deleted 0/0, projections moved 1',
    counts?.moved?.brownlow_round_votes === 1 && counts.moved.player_match_stats === 0
      && counts.deleted?.brownlow_round_votes === 0 && counts.deleted.player_match_stats === 0 && counts.projectionsMoved === 1,
    JSON.stringify(counts));
  const projectionsAfter = await owner<{ providerPlayerId: string; playerId: number }[]>`
    SELECT provider_player_id AS "providerPlayerId", player_id AS "playerId"
      FROM staging.afl_api_brownlow_vote WHERE provider_match_id = ${closure.externalRecordId} ORDER BY provider_player_id
  `;
  check('post: CD_I\'s Brownlow projection names P′ (SAT-5); the companions\' still name their own players',
    projectionsAfter.length === 3 && projectionsAfter.find((p) => p.providerPlayerId === w.providerId)?.playerId === w.pPrime.id
      && closure.companions.every((cc) => projectionsAfter.find((p) => p.providerPlayerId === cc.providerId)?.playerId === cc.playerId),
    JSON.stringify(projectionsAfter));

  const saAfter = await statAvailabilityOf(owner, w.season);
  console.log(`  stat_availability 2092 after COMMIT (${saAfter.rows.length} row(s), sha256 ${saAfter.sha256})`);
  check('post: stat_availability for 2092 is byte-identical to the settled baseline (sorted to_jsonb, SHA-256)',
    saAfter.sha256 === saBaseline.sha256, `${saBaseline.sha256} -> ${saAfter.sha256}: ${canonicalJson(saAfter.rows)}`);
  const derivedAfter = await derivedOf(owner, [w.p.id, w.pPrime.id]);
  check('post: P and P′ derived rows (season, club-season, career, clubs) are byte-identical: no Brownlow-derived drift',
    derivedAfter.sha256 === derivedBefore.sha256, `${derivedBefore.rows.length} -> ${derivedAfter.rows.length} row(s)`);
  const censusAfter = await readResidue(owner);
  const delta = Object.fromEntries(Object.keys(censusAfter)
    .filter((t) => censusAfter[t] !== censusBefore[t]).map((t) => [t, censusAfter[t] - censusBefore[t]]));
  check('post: fixture census changed by exactly the correction\'s own rows (+1 application, +1 ledger row, +1 batch)',
    canonicalJson(delta) === canonicalJson({ afl_api_identity_adjudications: 1, canonical_applications: 1, import_batches: 1 }),
    JSON.stringify(delta));

  await owner.begin('read only', (tx) => assertAflApiIdentityInvariant(tx));
  check('post: the combined identity invariant (SAT-1 basis) holds', true);
}

/* ==================================================================== *
 * Concurrency infrastructure (cases 87, 91, 100): sessions, lock probe, gate, real writers
 * ==================================================================== *
 *
 * Every concurrent party is its own PostgreSQL session with a unique `application_name`:
 *   - the correction: the real CLI subprocess, found by its own name
 *     (`afldb-correct-afl-api-identity-apply`, exactly one backend or the probe refuses);
 *   - a holder/gate: a harness session holding one open transaction (`holdTransaction`), which
 *     reports its own `pg_backend_pid()` and transaction id;
 *   - a writer: the REAL production writer (`saveMatchSheet`, `saveDraftBrownlowMatch`), which opens
 *     its own `afldb_import` connection from `AFLDB_IMPORT_DATABASE_URL` at call time; the harness
 *     names it by adding `application_name` to that DSN for the one call (postgres.js passes unknown
 *     URL parameters as startup parameters), so no production code changes;
 *   - the observer: the harness's `afldb_import` session, which sees same-role backends in full.
 * The probe (`awaitLockWait`) polls `pg_stat_activity` + `pg_blocking_pids` + `pg_locks` until the
 * named backend is WAITING on a heavyweight lock, bounded; the case then checks WHO blocks it and on
 * WHAT. Elapsed time alone is never evidence. Cleanup (`settleConcurrency`) releases every holder,
 * bounds the subprocess and every writer, and cancels only this harness's own backends.
 */

const HARNESS_APP = 'afldb-issue238-';
/** A statement's text on one line, for evidence logs. */
const oneLine = (query: string | null) => (query ?? '').replace(/\s+/g, ' ').trim();
const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new RehearsalRefused(`${label}: not finished within ${ms} ms`)), ms);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

/** A 32-bit transaction id as text: the grain of `pg_locks.transactionid`, `backend_xid` and `xmax`. */
const XID32 = (expression: 'pg_current_xact_id_if_assigned()') => `(${expression}::text::bigint % 4294967296)::text`;

type Backend = {
  pid: number; applicationName: string; role: string | null; state: string | null;
  waitEventType: string | null; waitEvent: string | null; query: string | null;
  blockingPids: number[]; backendXid: string | null; waitedMs: number | null;
};

async function backendsNamed(observer: Sql, applicationName: string): Promise<Backend[]> {
  return observer<Backend[]>`
    SELECT a.pid, a.application_name AS "applicationName", a.usename::text AS role, a.state,
           a.wait_event_type AS "waitEventType", a.wait_event AS "waitEvent", left(a.query, 2000) AS query,
           pg_blocking_pids(a.pid) AS "blockingPids", a.backend_xid::text AS "backendXid",
           (extract(epoch FROM clock_timestamp() - a.query_start) * 1000)::int AS "waitedMs"
      FROM pg_stat_activity a
     WHERE a.datname = current_database() AND a.application_name = ${applicationName}
  `;
}

type LockRow = { locktype: string; relation: string | null; mode: string; granted: boolean; page: number | null; tuple: number | null; transactionId: string | null };

/** The locks of `pid` that locate a wait: every ungranted lock, every tuple lock, and every relation
 * lock on the three tables these cases contend on. */
async function locksOf(observer: Sql, pid: number): Promise<LockRow[]> {
  return observer<LockRow[]>`
    SELECT l.locktype, l.relation::regclass::text AS relation, l.mode, l.granted, l.page, l.tuple::int AS tuple,
           l.transactionid::text AS "transactionId"
      FROM pg_locks l
     WHERE l.pid = ${pid}
       AND (NOT l.granted OR l.locktype = 'tuple'
            OR (l.locktype = 'relation' AND l.relation::regclass::text IN ('external_identities', 'matches', 'players')))
     ORDER BY l.granted, l.locktype, l.relation::regclass::text, l.mode
  `;
}

async function pollUntil<T>(label: string, timeoutMs: number, probe: () => Promise<T | null>, abort: () => string | null = () => null): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hit = await probe();
    if (hit !== null) return hit;
    const why = abort();
    if (why !== null) throw new RehearsalRefused(`${label}: ${why}`);
    if (Date.now() > deadline) throw new RehearsalRefused(`${label}: not observed within ${timeoutMs} ms`);
    await sleep(10);
  }
}

/** Poll until the ONE backend named `applicationName` is waiting on a heavyweight lock that some
 * other backend holds. Returns that snapshot; the caller proves who and what. */
async function awaitLockWait(observer: Sql, applicationName: string, timeoutMs: number, abort?: () => string | null): Promise<Backend> {
  return pollUntil(`backend '${applicationName}' waiting on a lock`, timeoutMs, async () => {
    const rows = await backendsNamed(observer, applicationName);
    if (rows.length > 1) throw new RehearsalRefused(`${rows.length} backends are named '${applicationName}'; the probe needs exactly one`);
    const backend = rows[0];
    return backend !== undefined && backend.waitEventType === 'Lock' && backend.blockingPids.length > 0 ? backend : null;
  }, abort);
}

class HolderRelease extends Error {}

type Holder = { name: string; pid: number; xid: string | null; held: string; open: () => boolean; release: () => Promise<void> };

/**
 * Open a session named `applicationName`, prove its database and role, run `body` (which takes the
 * lock and describes it), and keep that transaction OPEN until `release()` rolls it back. The lock
 * is held from the moment this resolves. `release` is idempotent and bounded.
 */
async function holdTransaction(
  dsn: string, applicationName: string, role: string, body: (tx: TransactionSql) => Promise<string>,
): Promise<Holder> {
  const sql = postgres(dsn, { max: 1, onnotice: () => {}, connection: { application_name: applicationName } });
  let letGo!: () => void;
  const released = new Promise<void>((resolve) => { letGo = resolve; });
  type Acquired = { pid: number; xid: string | null; held: string };
  let ready!: (value: Acquired) => void;
  let notReady!: (error: unknown) => void;
  const acquired = new Promise<Acquired>((resolve, reject) => { ready = resolve; notReady = reject; });
  acquired.catch(() => {});
  let open = true;
  const finished = sql.begin(async (tx) => {
    const [who] = await tx<{ pid: number; database: string; role: string }[]>`
      SELECT pg_backend_pid() AS pid, current_database() AS database, current_user AS role`;
    if (who.database !== R.database || who.role !== role) {
      throw new RehearsalRefused(`${applicationName} connected as ${who.role}@${who.database}, expected ${role}@${R.database}`);
    }
    const held = await body(tx);
    const [{ xid }] = await tx.unsafe<{ xid: string | null }[]>(`SELECT ${XID32('pg_current_xact_id_if_assigned()')} AS xid`);
    ready({ pid: who.pid, xid, held });
    await released;
    throw new HolderRelease('rolled back by design');
  }).then(() => { open = false; }, (error: unknown) => {
    open = false;
    if (error instanceof HolderRelease) return;
    notReady(error);
    throw error;
  });
  finished.catch(() => {});
  let releasing: Promise<void> | null = null;
  const release = () => {
    releasing ??= (async () => {
      letGo();
      try {
        await withTimeout(finished, 10_000, `${applicationName} rolling back`);
      } finally {
        await sql.end({ timeout: 5 });
      }
    })();
    return releasing;
  };
  try {
    const got = await withTimeout(acquired, 20_000, `${applicationName} acquiring its lock`);
    return { name: applicationName, ...got, open: () => open, release };
  } catch (error) {
    await release().catch(() => {});
    throw error;
  }
}

type SaveMatchSheet = typeof saveMatchSheetType;
type LoadMatchSheetStaleToken = typeof loadMatchSheetStaleTokenType;
type SaveDraftBrownlowMatch = typeof saveDraftBrownlowMatchType;
type FinaliseBrownlowMatch = typeof finaliseBrownlowMatchType;
type VoidBrownlowMatch = typeof voidBrownlowMatchType;
type PublishBrownlowSeason = typeof publishBrownlowSeasonType;
type DeleteMatch = typeof deleteMatchType;
type Writers = {
  saveMatchSheet: SaveMatchSheet; saveDraftBrownlowMatch: SaveDraftBrownlowMatch;
  /** AFLDB-ISSUE-257: the editor's page-load freshness token and the stale-save refusal text. */
  loadMatchSheetStaleToken: LoadMatchSheetStaleToken; staleSheetRefusal: string;
  /** Family D (cases 17, 56): the Brownlow admin finalise / void and the season publication. */
  finaliseBrownlowMatch: FinaliseBrownlowMatch; voidBrownlowMatch: VoidBrownlowMatch; publishBrownlowSeason: PublishBrownlowSeason;
  /** Corrected-state case 72: the Data Editor's match deletion (`match-admin.ts`). */
  deleteMatch: DeleteMatch;
};

/**
 * The REAL writers. Both modules are `server-only` (the marker package throws unless resolved under
 * the `react-server` export condition, which is how Next.js loads them), so a concurrency case needs
 * `npx tsx --conditions=react-server`. `admin-brownlow` also imports `@/db/client`, which builds (and
 * never connects) a pool from `DATABASE_URL`: that must name code_test_db too, or be unset.
 */
async function loadWriters(): Promise<Writers> {
  const database = process.env.DATABASE_URL;
  if (database !== undefined && decodeURIComponent(new URL(database).pathname.slice(1)) !== R.database) {
    throw new RehearsalRefused('DATABASE_URL (read by @/db/client, which the Brownlow admin module imports) must name code_test_db or be unset');
  }
  const exported = <T>(mod: Record<string, unknown>, name: string): T => {
    const value = mod[name] ?? (mod.default as Record<string, unknown> | undefined)?.[name];
    if (typeof value !== 'function') throw new RehearsalRefused(`writer '${name}' is not exported`);
    return value as T;
  };
  try {
    const sheet = await import('../../src/db/queries/match-sheet') as Record<string, unknown>;
    const brownlow = await import('../../src/db/queries/admin-brownlow') as Record<string, unknown>;
    const matchAdmin = await import('../../src/db/queries/match-admin') as Record<string, unknown>;
    return {
      deleteMatch: exported<DeleteMatch>(matchAdmin, 'deleteMatch'),
      saveMatchSheet: exported<SaveMatchSheet>(sheet, 'saveMatchSheet'),
      loadMatchSheetStaleToken: exported<LoadMatchSheetStaleToken>(sheet, 'loadMatchSheetStaleToken'),
      staleSheetRefusal: String(sheet.STALE_SHEET_REFUSAL ?? (sheet.default as Record<string, unknown> | undefined)?.STALE_SHEET_REFUSAL),
      saveDraftBrownlowMatch: exported<SaveDraftBrownlowMatch>(brownlow, 'saveDraftBrownlowMatch'),
      finaliseBrownlowMatch: exported<FinaliseBrownlowMatch>(brownlow, 'finaliseBrownlowMatch'),
      voidBrownlowMatch: exported<VoidBrownlowMatch>(brownlow, 'voidBrownlowMatch'),
      publishBrownlowSeason: exported<PublishBrownlowSeason>(brownlow, 'publishBrownlowSeason'),
    };
  } catch (error) {
    if (error instanceof RehearsalRefused) throw error;
    throw new RehearsalRefused(`the real writers are server-only modules: run this harness as \`npx tsx --conditions=react-server ...\` (${(error as Error).message})`);
  }
}

/** Issue one real writer call with its connection named `applicationName`. The writers read
 * `AFLDB_IMPORT_DATABASE_URL` synchronously on entry, before their first await, so the DSN is
 * restored as soon as the call has started; the probe then proves the named backend exists. */
function writerCall<T>(importDsn: string, applicationName: string, call: () => Promise<T>): Promise<T> {
  const previous = process.env.AFLDB_IMPORT_DATABASE_URL;
  const dsn = new URL(importDsn);
  dsn.searchParams.set('application_name', applicationName);
  process.env.AFLDB_IMPORT_DATABASE_URL = dsn.toString();
  try {
    const pending = call();
    pending.catch(() => {});
    return pending;
  } finally {
    if (previous === undefined) delete process.env.AFLDB_IMPORT_DATABASE_URL;
    else process.env.AFLDB_IMPORT_DATABASE_URL = previous;
  }
}

/** Failure-path cleanup, in dependency order: release every holder (a correction or writer waiting
 * on one resumes or fails), bound the subprocess (kill after 30 s), bound every writer (then cancel
 * this harness's own `afldb_import` backends, the only ones the observer may signal). */
async function settleConcurrency(
  observer: Sql, parts: { holders: (Holder | null)[]; spawned: (SpawnedCli | null)[]; writers: Promise<unknown>[] },
): Promise<void> {
  for (const holder of parts.holders) {
    if (holder) await holder.release().catch((error: unknown) => console.log(`  cleanup: ${holder.name}: ${(error as Error).message}`));
  }
  for (const s of parts.spawned) {
    if (s?.running()) {
      await withTimeout(s.exited, 30_000, 'correction subprocess').catch(() => {
        console.log('  cleanup: killing the correction subprocess');
        s.child.kill();
      });
    }
  }
  if (parts.writers.length === 0) return;
  try {
    await withTimeout(Promise.allSettled(parts.writers), 30_000, 'writers');
  } catch {
    console.log('  cleanup: cancelling the harness\'s own writer backends');
    await observer`
      SELECT pg_cancel_backend(pid) FROM pg_stat_activity
       WHERE datname = current_database() AND usename = current_user AND pid <> pg_backend_pid()
         AND application_name LIKE ${`${HARNESS_APP}%`}
    `;
    await withTimeout(Promise.allSettled(parts.writers), 10_000, 'writers after cancel').catch(() => {});
  }
}

/** Every backend this harness or the correction started, other than the harness's own two sessions.
 * Read from BOTH role sessions (a non-privileged session sees another role's pid and name only). */
async function lingeringBackends(owner: Sql, observer: Sql, ownPids: readonly number[]): Promise<Backend[]> {
  const rows: Backend[] = [];
  const seen = new Set<number>();
  for (const sql of [owner, observer]) {
    const found = await sql<Backend[]>`
      SELECT a.pid, a.application_name AS "applicationName", a.usename::text AS role, a.state,
             a.wait_event_type AS "waitEventType", a.wait_event AS "waitEvent", left(a.query, 2000) AS query,
             pg_blocking_pids(a.pid) AS "blockingPids", a.backend_xid::text AS "backendXid", NULL::int AS "waitedMs"
        FROM pg_stat_activity a
       WHERE a.datname = current_database() AND a.pid <> ALL(${[...ownPids]}::int[])
         AND (a.application_name LIKE ${`${HARNESS_APP}%`} OR a.application_name LIKE 'afldb-correct-afl-api-identity-%')
    `;
    for (const b of found) if (!seen.has(b.pid)) { seen.add(b.pid); rows.push(b); }
  }
  return rows;
}

/** Poll (bounded, 5 s: a finished child's backend exits asynchronously) until none remain. */
async function awaitNoLingeringBackends(owner: Sql, observer: Sql, ownPids: readonly number[]): Promise<Backend[]> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const rows = await lingeringBackends(owner, observer, ownPids);
    if (rows.length === 0 || Date.now() > deadline) return rows;
    await sleep(50);
  }
}

async function identityOf(owner: Sql, w: World): Promise<RowSnapshot | null> {
  const [row] = await owner<{ row: RowSnapshot }[]>`
    SELECT to_jsonb(ei.*) AS row FROM external_identities ei WHERE ei.source_id = ${w.sourceIds.aflApi} AND ei.external_id = ${w.providerId}
  `;
  return row?.row ?? null;
}

/** The pre-state every pms-closure concurrency case shares: case 1's shape (one CD_I row at (P, M),
 * no P′ counterpart). */
async function checkPmsPreState(
  ctx: CaseContext, w: World, closure: PmsClosureRow, lineUpRows = 0,
): Promise<{ before: RowSnapshot; identityId: number }> {
  const { owner, check } = ctx;
  const before = await pmsRow(owner, closure.rowId);
  check('pre: closure row at (P, M), afl_api-owned, stamped <CD_M>|<team>|CD_I with the settle batch; contract = the insert application',
    before !== null && before.player_id === w.p.id && before.match_id === closure.matchId
      && before.source_id === w.sourceIds.aflApi && before.source_record_id === closure.externalRecordId
      && Number(before.import_batch_id) === w.settleBatchId && rowContractHash(contractOf(before)) === closure.contractSha256,
    JSON.stringify(before && { player_id: before.player_id, source_record_id: before.source_record_id }));
  const [pre] = await owner<{ counterpart: number; pRows: number; atM: number }[]>`
    SELECT (SELECT count(*)::int FROM player_match_stats WHERE player_id = ${w.pPrime.id} AND match_id = ${closure.matchId}) AS counterpart,
           (SELECT count(*)::int FROM player_match_stats WHERE player_id = ${w.p.id}) AS "pRows",
           (SELECT count(*)::int FROM player_match_stats WHERE match_id = ${closure.matchId}) AS "atM"
  `;
  check(`pre: no P′ counterpart at M; P holds exactly the one row; M holds only it${lineUpRows === 0 ? '' : ` and ${lineUpRows} foreign line-up row(s) of other fixture players`}`,
    pre.counterpart === 0 && pre.pRows === 1 && pre.atM === 1 + lineUpRows, JSON.stringify(pre));
  const identity = await identityOf(owner, w);
  check('pre: CD_I is an importer row at P (unique, afl_api_stat_vector_bootstrap)',
    identity?.player_id === w.p.id && identity.status === 'unique' && identity.match_method === 'afl_api_stat_vector_bootstrap');
  await owner.begin('read only', (tx) => assertAflApiIdentityInvariant(tx));
  check('pre: the combined identity invariant holds with the fixture in place', true);
  return { before: before!, identityId: Number(identity?.id) };
}

/* ---- Case 87 ---- */

/**
 * Case 87 (§12.1, R): ORIGINAL lock timeout against an in-flight settle -> STOP, nothing written.
 * The settle's real lock on the identity table is the ACCESS SHARE its resolver's plain SELECT takes
 * (`resolveAflApiPlayer`, `afl-api-player-resolver.ts:64-71`), held for the settle's transaction.
 * Blocker H is that: an `afldb_import` transaction that has run the REAL resolver for CD_I and stays
 * open. The correction's §8.2 step 1 `LOCK TABLE external_identities IN ACCESS EXCLUSIVE MODE`
 * (`correct_afl_api_identity.ts:405-414`) conflicts with it, waits `lock_timeout = 5s`, and refuses.
 */
async function case87(ctx: CaseContext): Promise<void> {
  const { owner, observer, check } = ctx;
  const { w, closure } = await owner.begin(async (tx) => {
    const built = await world(tx, 87);
    const row = await pmsClosureRow(tx, built, 1);
    await settleDerived(tx, built);
    return { w: built, closure: row };
  });
  console.log(`  fixture: P=${w.p.id}, P'=${w.pPrime.id}, provider ${w.providerId}, match M=${closure.matchId}, `
    + `closure row player_match_stats#${closure.rowId}, settle batch ${w.settleBatchId}, actor ${w.actorId}`);
  const { before: rowBefore } = await checkPmsPreState(ctx, w, closure);
  const identityBefore = await identityOf(owner, w);

  // The fixture is otherwise valid for correction: validate-only plans it (it takes no lock).
  const { input } = prepareCorrection(ctx, w);
  const { fingerprint } = await validateOnly(ctx, input, 1);
  const censusBefore = await readResidue(owner);

  const holderName = `${HARNESS_APP}case087-settle-holder`;
  let holder: Holder | null = null;
  let apply: SpawnedCli | null = null;
  try {
    holder = await holdTransaction(ctx.importDsn, holderName, R.importRole, async (tx) => {
      const resolution = await resolveAflApiPlayer(tx, w.sourceIds.aflApi, w.providerId);
      if (resolution.outcome !== 'resolved' || resolution.playerId !== w.p.id) {
        throw new RehearsalRefused(`the settle resolver did not resolve ${w.providerId} to P: ${JSON.stringify(resolution)}`);
      }
      return `resolveAflApiPlayer(${w.providerId}) -> player ${resolution.playerId}`;
    });
    const holderLocks = await locksOf(observer, holder.pid);
    const identityLocks = holderLocks.filter((l) => l.locktype === 'relation' && l.relation === 'external_identities');
    console.log(`  blocker H: pid ${holder.pid} ('${holderName}', ${R.importRole}), transaction open after the real settle resolver `
      + `(${holder.held}); its external_identities locks ${JSON.stringify(identityLocks)}`);
    check('blocker: H (afldb_import, open transaction) holds the settle resolver\'s lock on external_identities: AccessShareLock, granted',
      holder.open() && identityLocks.length === 1 && identityLocks[0].mode === 'AccessShareLock' && identityLocks[0].granted,
      JSON.stringify(identityLocks));

    const spawned = spawnCli(input, 'apply', fingerprint);
    apply = spawned;
    const waiting = await awaitLockWait(observer, correctionApplicationName('apply'), 90_000,
      () => (spawned.running() ? null : 'the correction exited before it was observed waiting'));
    const observedAt = Date.now();
    const ungranted = (await locksOf(observer, waiting.pid)).filter((l) => !l.granted);
    console.log(`  correction: pid ${waiting.pid} (${String(waiting.role)}), wait ${String(waiting.waitEventType)}/${String(waiting.waitEvent)}, `
      + `pg_blocking_pids = {${waiting.blockingPids.join(',')}}, waiting ${String(waiting.waitedMs)} ms so far, backend_xid ${String(waiting.backendXid)}, `
      + `query '${String(waiting.query)}'; ungranted ${JSON.stringify(ungranted)}`);
    check('correction: its backend (afldb_import, afldb-correct-afl-api-identity-apply) is waiting on a heavyweight RELATION lock',
      waiting.role === R.importRole && waiting.waitEventType === 'Lock' && waiting.waitEvent === 'relation', JSON.stringify(waiting));
    check('correction: pg_blocking_pids(correction) = {H} exactly', canonicalJson(waiting.blockingPids) === canonicalJson([holder.pid]),
      `{${waiting.blockingPids.join(',')}} vs H ${holder.pid}`);
    check('correction: its one ungranted lock is AccessExclusiveLock on external_identities, issued by §8.2 step 1\'s LOCK TABLE',
      ungranted.length === 1 && ungranted[0].locktype === 'relation' && ungranted[0].relation === 'external_identities'
        && ungranted[0].mode === 'AccessExclusiveLock' && /LOCK TABLE external_identities IN ACCESS EXCLUSIVE MODE/.test(waiting.query ?? ''),
      JSON.stringify(ungranted));
    // Not evidence either way: PostgreSQL assigns a transaction id when an ACCESS EXCLUSIVE relation
    // lock is REQUESTED (it is WAL-logged for hot standby), so `backend_xid` is set here. "Nothing
    // written" is proven by the post-state below, never by the xid.
    console.log(`  correction backend_xid ${String(waiting.backendXid)} (assigned by the ACCESS EXCLUSIVE request itself)`);

    const run = await withTimeout(spawned.exited, 30_000, 'the correction giving up on its lock');
    const waitedMs = (waiting.waitedMs ?? 0) + (Date.now() - observedAt);
    check('blocker: H was still open when the correction gave up (the timeout was against a live holder)', holder.open());
    const parsed = parseCli(input, 'apply', run);
    console.log(`  apply: exit ${String(run.status)}, ${JSON.stringify(parsed.result)}; stderr ${JSON.stringify(run.stderr.trim())}; `
      + `waited ~${waitedMs} ms from its LOCK TABLE to exit (lock_timeout 5s)`);
    check('apply: REFUSED, exit 1, with the lock_timeout refusal for external_identities and "nothing was written" (§8.2 step 1 STOP)',
      parsed.result.kind === 'REFUSED'
        && parsed.result.message === 'REFUSED: lock_timeout waiting for external_identities (an in-flight settle holds it)'
        && run.stderr.includes('nothing was written (the transaction rolled back or was never opened)'), JSON.stringify(parsed.result));
    check('apply: it gave up after the configured lock_timeout (>= 5 s of waiting, and bounded: < 15 s)',
      waitedMs >= 4_900 && waitedMs < 15_000, `${waitedMs} ms`);
  } finally {
    await settleConcurrency(observer, { holders: [holder], spawned: [apply], writers: [] });
  }
  check('cleanup: H rolled back and closed', holder !== null && !holder.open());

  // ---- nothing written ----
  check('post: fixture census byte-identical to the pre-apply census (no batch, ledger row, application or row change)',
    canonicalJson(await readResidue(owner)) === canonicalJson(censusBefore), nonZero(await readResidue(owner)));
  const rowAfter = await pmsRow(owner, closure.rowId);
  check('post: the closure row is byte-identical (still at P)', rowAfter !== null && canonicalJson(rowAfter) === canonicalJson(rowBefore));
  check('post: CD_I\'s identity row is byte-identical (still unique at P)',
    identityBefore !== null && canonicalJson(await identityOf(owner, w)) === canonicalJson(identityBefore));
  const [post] = await owner<{ ledger: number; batches: number; apps: number }[]>`
    SELECT (SELECT count(*)::int FROM afl_api_identity_adjudications WHERE external_id = ${w.providerId}) AS ledger,
           (SELECT count(*)::int FROM import_batches WHERE tool = ${R.correctionTool} AND validation_result->>'externalId' = ${w.providerId}) AS batches,
           (SELECT count(*)::int FROM canonical_applications WHERE external_record_id = ${closure.externalRecordId}) AS apps
  `;
  check('post: no ledger row, no correction batch, only the settle\'s insert application', post.ledger === 0 && post.batches === 0 && post.apps === 1, JSON.stringify(post));
  await owner.begin('read only', (tx) => assertAflApiIdentityInvariant(tx));
  check('post: the combined identity invariant holds', true);
}

/* ---- Gated writer topology (cases 91, 100) ---- */

type GatedRun<T> = {
  gate: Holder; correction: Backend; writer: Backend; writerLocks: LockRow[]; correctionRun: CliRun; writerResult: T;
  lockedXmax: { match: string | null; row: string | null }; releasedAfterMs: number;
};

/**
 * The approved gate topology. Gate G (`afldb_owner`) holds `players` P′ `FOR UPDATE`. The correction
 * takes its closure locks (`player_match_stats … FOR UPDATE OF pms, m`, which also locks matches M),
 * then its first write that references P′ needs `FOR KEY SHARE` on P′ and waits on G. While it waits:
 *   1. prove it is blocked by G, and that it ALREADY holds M and the closure row (both rows' `xmax`
 *      is the correction's transaction id: a row lock is recorded in the tuple, not in pg_locks);
 *   2. issue the REAL writer; prove it is waiting on the correction's transaction id (the row lock on
 *      M) and that `pg_blocking_pids(writer)` is exactly {correction} -- a writer blocked by G, or by
 *      anything else, fails the run;
 *   3. release G well inside the correction's 5 s lock_timeout (checked against the correction's own
 *      wait time), then wait (bounded) for the correction to exit and the writer to return.
 */
async function gatedWriter<T>(
  ctx: CaseContext, w: World, closure: PmsClosureRow, input: CorrectInput, fingerprint: string,
  writerName: string, issueWriter: () => Promise<T>,
): Promise<GatedRun<T>> {
  const { observer, check } = ctx;
  const gateName = `${HARNESS_APP}case${w.caseCode}-gate`;
  let gate: Holder | null = null;
  let apply: SpawnedCli | null = null;
  const writers: Promise<unknown>[] = [];
  try {
    gate = await holdTransaction(ctx.ownerDsn, gateName, R.ownerRole, async (tx) => {
      const locked = await tx<{ id: number }[]>`SELECT id FROM players WHERE id = ${w.pPrime.id} FOR UPDATE`;
      if (locked.length !== 1) throw new RehearsalRefused('the gate could not lock P′');
      return `players#${w.pPrime.id} (P′) FOR UPDATE`;
    });
    console.log(`  gate G: pid ${gate.pid} ('${gateName}', ${R.ownerRole}), holds ${gate.held}, xid ${String(gate.xid)}`);
    check('gate: G holds players P′ FOR UPDATE in an open transaction with an assigned xid', gate.open() && gate.xid !== null);

    const spawned = spawnCli(input, 'apply', fingerprint);
    apply = spawned;
    const correctionExited = () => (spawned.running() ? null : 'the correction exited');
    const correction = await awaitLockWait(observer, correctionApplicationName('apply'), 90_000, correctionExited);
    const correctionUngranted = (await locksOf(observer, correction.pid)).filter((l) => !l.granted);
    const [lockedXmax] = await observer<{ match: string | null; row: string | null; matchCtid: string }[]>`
      SELECT (SELECT xmax::text FROM matches WHERE id = ${closure.matchId}) AS match,
             (SELECT xmax::text FROM player_match_stats WHERE id = ${closure.rowId}) AS row,
             (SELECT ctid::text FROM matches WHERE id = ${closure.matchId}) AS "matchCtid"
    `;
    console.log(`  correction: pid ${correction.pid} (${String(correction.role)}), backend_xid ${String(correction.backendXid)}, `
      + `wait ${String(correction.waitEventType)}/${String(correction.waitEvent)}, pg_blocking_pids = {${correction.blockingPids.join(',')}}, `
      + `waiting ${String(correction.waitedMs)} ms, query '${oneLine(correction.query)}'; ungranted ${JSON.stringify(correctionUngranted)}; `
      + `xmax matches#${closure.matchId} (ctid ${lockedXmax.matchCtid}) = ${String(lockedXmax.match)}, player_match_stats#${closure.rowId} = ${String(lockedXmax.row)}`);
    check('correction: blocked by the gate: pg_blocking_pids(correction) = {G}, waiting on G\'s transaction id',
      canonicalJson(correction.blockingPids) === canonicalJson([gate.pid]) && correction.waitEventType === 'Lock'
        && correctionUngranted.some((l) => l.locktype === 'transactionid' && l.transactionId === gate!.xid), JSON.stringify(correctionUngranted));
    check('correction: it ALREADY holds the closure locks: matches M and the closure row both carry its transaction id as xmax',
      correction.backendXid !== null && lockedXmax.match === correction.backendXid && lockedXmax.row === correction.backendXid,
      `xid ${String(correction.backendXid)}: ${JSON.stringify(lockedXmax)}`);

    let writerSettled = false;
    const pending = writerCall(ctx.importDsn, writerName, issueWriter);
    writers.push(pending);
    void pending.finally(() => { writerSettled = true; });
    const writer = await awaitLockWait(observer, writerName, 4_000, () => correctionExited()
      ?? (writerSettled ? 'the writer returned without waiting' : null));
    const writerLocks = await locksOf(observer, writer.pid);
    const [margin] = await backendsNamed(observer, correctionApplicationName('apply'));
    console.log(`  writer: pid ${writer.pid} ('${writerName}', ${String(writer.role)}), wait ${String(writer.waitEventType)}/${String(writer.waitEvent)}, `
      + `pg_blocking_pids = {${writer.blockingPids.join(',')}}, query '${oneLine(writer.query)}'; locks ${JSON.stringify(writerLocks)}`);
    check('writer: its own afldb_import backend, issued its first statement (matches … FOR UPDATE) and is WAITING on a lock',
      writer.role === R.importRole && writer.waitEventType === 'Lock' && /FROM\s+matches[\s\S]*FOR UPDATE/.test(writer.query ?? ''), oneLine(writer.query));
    check('writer: pg_blocking_pids(writer) = {correction} exactly -- NOT the gate',
      canonicalJson(writer.blockingPids) === canonicalJson([correction.pid]) && !writer.blockingPids.includes(gate.pid),
      `{${writer.blockingPids.join(',')}}; correction ${correction.pid}, gate ${gate.pid}`);
    check('writer: waiting on the correction\'s transaction id while holding the tuple lock on EXACTLY M\'s row (matches ctid)',
      writerLocks.some((l) => !l.granted && l.locktype === 'transactionid' && l.transactionId === correction.backendXid)
        && writerLocks.some((l) => l.granted && l.locktype === 'tuple' && l.relation === 'matches'
          && `(${String(l.page)},${String(l.tuple)})` === lockedXmax.matchCtid), `M ctid ${lockedXmax.matchCtid}: ${JSON.stringify(writerLocks)}`);
    check('timing: the correction is still waiting on G, well inside its 5 s lock_timeout (< 4 s), when G is released',
      margin !== undefined && canonicalJson(margin.blockingPids) === canonicalJson([gate.pid]) && (margin.waitedMs ?? 99_999) < 4_000,
      `waited ${String(margin?.waitedMs)} ms`);

    await gate.release();
    console.log(`  gate G released after the correction had waited ~${String(margin?.waitedMs)} ms`);
    const correctionRun = await withTimeout(spawned.exited, 90_000, 'the correction finishing after the gate');
    const writerResult = await withTimeout(pending, 30_000, 'the writer finishing after the correction');
    return { gate, correction, writer, writerLocks, correctionRun, writerResult, lockedXmax, releasedAfterMs: margin?.waitedMs ?? -1 };
  } finally {
    await settleConcurrency(observer, { holders: [gate], spawned: [apply], writers });
  }
}

type MatchSheetLine = Parameters<SaveMatchSheet>[0]['players'][number];

/** A match-sheet line carrying every field the sheet writes (its upsert sets all twelve). */
function matchSheetLine(playerId: number, v: Record<string, JsonValue>): MatchSheetLine {
  const n = (k: string) => (v[k] === null || v[k] === undefined ? null : Number(v[k]));
  return {
    playerId, clubId: Number(v.club_id), jumperNumber: String(v.jumper_number), goals: n('goals'), behinds: n('behinds'),
    kicks: n('kicks'), handballs: n('handballs'), disposals: n('disposals'), marks: n('marks'), tackles: n('tackles'),
    hitouts: n('hitouts'), freesFor: n('frees_for'), freesAgainst: n('frees_against'),
  };
}

type CommittedCorrection = { r: CommittedResult; cutoff: string };

/** The correction's COMMITTED outcome and `c` (its correction application's `applied_at`). */
async function committedCorrection(ctx: CaseContext, input: CorrectInput, fingerprint: string, run: CliRun, closure: PmsClosureRow): Promise<CommittedCorrection> {
  const { owner, check } = ctx;
  const parsed = parseCli(input, 'apply', run);
  console.log(`  apply: exit ${String(run.status)}, ${JSON.stringify(parsed.result)}`);
  const r = parsed.result;
  check('apply: COMMITTED (exit 0) with the validate-only fingerprint, moved 1, deleted 0, report complete -- the gate did not cost it its lock_timeout',
    r.kind === 'COMMITTED' && r.fingerprint === fingerprint && r.moved === 1 && r.deleted === 0 && !r.reportIncomplete, JSON.stringify(r));
  if (r.kind !== 'COMMITTED') {
    console.log(run.stdout, run.stderr);
    throw new RehearsalRefused('the gated correction did not commit');
  }
  const [c] = await owner<{ appliedAt: string }[]>`
    SELECT to_char(applied_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "appliedAt"
      FROM canonical_applications WHERE import_batch_id = ${r.batchId} AND external_record_id = ${closure.externalRecordId}
  `;
  check('apply: exactly one correction application, bound to batch K', c !== undefined);
  return { r, cutoff: c.appliedAt };
}

type AuditRow = { id: number; createdAt: string; fieldGroup: string; afterCutoff: boolean; newValues: JsonValue };

async function auditsAt(owner: Sql, tableName: string, rowId: number, cutoff: string): Promise<AuditRow[]> {
  return owner<AuditRow[]>`
    SELECT id::int AS id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
           field_group AS "fieldGroup", created_at >= ${cutoff}::timestamptz AS "afterCutoff", new_values AS "newValues"
      FROM data_edits WHERE table_name = ${tableName} AND row_id = ${rowId} ORDER BY id
  `;
}

/**
 * AFLDB-ISSUE-257 compatibility. The real `saveMatchSheet` now needs the editor's freshness token
 * (taken at the emulated page load, BEFORE any gate) and writes durable `data_overrides` authority,
 * which needs migration 110 (State B). Without it (State A) an authority-requiring save is refused.
 */
async function overrideRows(owner: Sql, matchId: number): Promise<{ entityKey: string; fieldGroup: string; isActive: boolean }[]> {
  return owner<{ entityKey: string; fieldGroup: string; isActive: boolean }[]>`
    SELECT d.entity_key AS "entityKey", d.field_group AS "fieldGroup", d.is_active AS "isActive"
      FROM data_overrides d JOIN matches m ON m.id = ${matchId}
     WHERE d.entity_type = 'player_match_stats' AND starts_with(d.entity_key, m.match_key::text || '|')
     ORDER BY d.entity_key, d.field_group
  `;
}

/** Detect the schema state on the rehearsal connection and log it (State B = migration 110 applied). */
async function detectAuthorityState(owner: Sql): Promise<boolean> {
  const storable = await playerMatchStatsAuthorityStorable(owner);
  console.log(`  schema state: ${storable ? 'B (migration 110 applied: authority is storable)' : 'A (no migration 110: authority-requiring saves refuse)'}`);
  return storable;
}

/**
 * The schema-state-dependent outcome of one sequential `saveMatchSheet`. Returns true when the save
 * landed (State B). State A: refused as authority-unavailable, no authority written (the caller
 * asserts its canonical rows are unchanged). State B: saved and the authority row exists.
 */
async function checkSheetSaveOutcome(
  ctx: CaseContext, storable: boolean, result: Awaited<ReturnType<SaveMatchSheet>>, matchId: number,
  fieldGroup: 'match_sheet' | 'lineup', playerCount: number, what: string,
): Promise<boolean> {
  const { owner, check } = ctx;
  const rows = await overrideRows(owner, matchId);
  if (!storable) {
    check(`State A: ${what} refused as authority-unavailable (nothing saved)`,
      !result.ok && result.error === AUTHORITY_UNAVAILABLE_REFUSAL, JSON.stringify(result));
    check('State A: no player_match_stats data_overrides row exists for M', rows.length === 0, JSON.stringify(rows));
    return false;
  }
  check(`State B: ${what} saved ({ok: true, playerCount ${playerCount}})`, result.ok && result.playerCount === playerCount, JSON.stringify(result));
  check(`State B: durable authority written: an active player_match_stats data_overrides '${fieldGroup}' row exists for M's changed player`,
    rows.some((r) => r.isActive && r.fieldGroup === fieldGroup), JSON.stringify(rows));
  return true;
}

/* ---- Case 91 ---- */

/**
 * Case 91 (§12.1, R half; U is Slice 9's source pin): while the ORIGINAL correction holds the closure
 * row's locks, a real match-sheet writer on THAT row waits; once the correction commits, the writer's
 * edit is post-correction state -- explained (L8-d `post_correction_edit match_sheet`) if its audit is
 * at or after c, otherwise STOP. The writer edits the closure row itself (its line names P′ -- the
 * row's key once the MOVE commits -- with every field as settled except goals 2 -> 3), so its upsert
 * lands on the moved row, not a new one. The Q2 outcome is OBSERVED and checked against the audit's
 * actual relation to c, not assumed.
 */
async function case91(ctx: CaseContext): Promise<void> {
  const { owner, check } = ctx;
  const writers = await loadWriters();
  const { w, closure } = await owner.begin(async (tx) => {
    const built = await world(tx, 91);
    const row = await pmsClosureRow(tx, built, 1);
    await settleDerived(tx, built);
    return { w: built, closure: row };
  });
  console.log(`  fixture: P=${w.p.id}, P'=${w.pPrime.id}, provider ${w.providerId}, match M=${closure.matchId}, `
    + `closure row player_match_stats#${closure.rowId}, settle batch ${w.settleBatchId}, actor ${w.actorId}`);
  const { before, identityId } = await checkPmsPreState(ctx, w, closure);
  const { input, evidenceSha256 } = prepareCorrection(ctx, w);
  const { fingerprint } = await validateOnly(ctx, input, 1);

  const line = matchSheetLine(w.pPrime.id, { ...closure.values, goals: 3 });
  // AFLDB-ISSUE-257: the page-load token, taken BEFORE the gate (and so before the correction's MOVE).
  const staleToken = await writers.loadMatchSheetStaleToken(owner, closure.matchId);
  const run = await gatedWriter(ctx, w, closure, input, fingerprint, `${HARNESS_APP}case091-writer-match-sheet`,
    () => writers.saveMatchSheet({
      matchId: closure.matchId, syncMatchScores: false, players: [line], adminUserId: w.actorId, staleToken,
      note: 'AFLDB-ISSUE-238 Slice 10 rehearsal case 091: concurrent match-sheet edit of the closure row',
    }));
  const { r, cutoff } = await committedCorrection(ctx, input, fingerprint, run.correctionRun, closure);
  console.log(`  writer: ${JSON.stringify(run.writerResult)}`);
  check('writer: saveMatchSheet refused as a stale save once the correction released M (the MOVE changed the sheet the token was taken from)',
    !run.writerResult.ok && run.writerResult.error === writers.staleSheetRefusal, JSON.stringify(run.writerResult));

  // ---- post-state: the MOVE only; the refused writer left the closure row untouched ----
  const after = await pmsRow(owner, closure.rowId);
  check('post: the SAME row id is at (P′, M) with its settled contract byte-identical (goals still 2): the stale save wrote nothing',
    after !== null && after.player_id === w.pPrime.id && after.match_id === closure.matchId
      && rowContractHash(contractOf(after)) === closure.contractSha256, JSON.stringify(after && contractOf(after)));
  check('post: provenance kept (source_id, source_record_id, import_batch_id)',
    after !== null && after.source_id === before.source_id && after.source_record_id === before.source_record_id
      && after.import_batch_id === before.import_batch_id);
  const [atM] = await owner<{ n: number; pRows: number }[]>`
    SELECT (SELECT count(*)::int FROM player_match_stats WHERE match_id = ${closure.matchId}) AS n,
           (SELECT count(*)::int FROM player_match_stats WHERE player_id = ${w.p.id}) AS "pRows"
  `;
  check('post: M holds exactly the one (moved) row; P holds none', atM.n === 1 && atM.pRows === 0, JSON.stringify(atM));
  await checkLedgerAndIdentity(ctx, w, identityId, { r, evidenceSha256 });

  const audits = await auditsAt(owner, 'matches', closure.matchId, BEFORE_ANY_AUDIT);
  check('post: NO writer audit for M (the refusal precedes every write)', audits.length === 0, JSON.stringify(audits));
  const overrides = await overrideRows(owner, closure.matchId);
  check('post: no player_match_stats data_overrides row for M (the refusal precedes the authority writes)', overrides.length === 0, JSON.stringify(overrides));
  console.log(`  c (correction application applied_at) = ${cutoff}`);

  // ---- Q2: the validate-only re-run on a CORRECTED net state is correction satisfaction only ----
  const censusBefore = await readResidue(owner);
  const q2 = runCli(input, 'validate-only', null);
  const q2Lines = q2.stdout.replace(/\r/g, '').split('\n');
  console.log(`  Q2 re-run: exit ${String(q2.status)}, ${JSON.stringify(q2.result)}`);
  for (const l of q2Lines.filter((x) => /post_correction|NOOP|STOP|ALREADY_SATISFIED/.test(x))) console.log(`    | ${l.trim()}`);
  check('Q2: ALREADY_SATISFIED with no post_correction_edit divergence (the refused writer left the corrected row as settled)',
    q2.result.kind === 'ALREADY_SATISFIED' && !q2Lines.some((l) => /post_correction_edit/.test(l)), JSON.stringify(q2.result));
  check('Q2 re-run wrote nothing (fixture census unchanged)', canonicalJson(await readResidue(owner)) === canonicalJson(censusBefore));
  await owner.begin('read only', (tx) => assertAflApiIdentityInvariant(tx));
  check('post: the combined identity invariant (SAT-1 basis) holds', true);
}

/* ---- Case 100 ---- */

/**
 * Case 100 (§12.1, R; Pass 5a `R238-P5-03`): the entry-state insertion race. After a MOVE frees
 * (P, M), a concurrent writer that would insert at (P, M) or create entry state for M must be blocked
 * by the correction's `matches … FOR UPDATE` until it commits, so no interleaved insertion is
 * possible. The row names BOTH writer forms, so each is its own run (`--variant`):
 *   - `match-sheet`: the real `saveMatchSheet` inserting a line for P at M (a stale sheet: P was on
 *     it). After the correction commits, its upsert finds (P, M) FREE and inserts a NEW row; the moved
 *     closure row at (P′, M) is untouched. Without the lock it would have updated the closure row
 *     before the MOVE, and the correction's conditional write would have refused.
 *   - `brownlow-draft`: the real `saveDraftBrownlowMatch` for M selecting P (a stale page: P was a
 *     participant). After the commit it re-reads M's participants, finds P gone, and refuses
 *     `not_participant`: no entry state naming P is created (the BG3 hazard the lock closes). Its
 *     season-polled precondition (`stat_availability` brownlow_season_total <> not_applicable) is
 *     fixture pre-state, so the refusal can only come from the post-correction participants.
 */
async function case100(ctx: CaseContext): Promise<void> {
  const { owner, check, variant } = ctx;
  if (variant !== 'match-sheet' && variant !== 'brownlow-draft') {
    throw new RehearsalRefused('case 100 needs --variant match-sheet | brownlow-draft (each writer form is its own run)');
  }
  const writers = await loadWriters();
  const { w, closure } = await owner.begin(async (tx) => {
    const built = await world(tx, 100);
    const row = await pmsClosureRow(tx, built, 1);
    await settleDerived(tx, built);
    if (variant === 'brownlow-draft') {
      await tx`
        INSERT INTO stat_availability (stat_key, season, is_recorded, coverage)
        VALUES ('brownlow_season_total', ${built.season}, false, 'pending')
      `;
    }
    return { w: built, closure: row };
  });
  console.log(`  variant ${variant}; fixture: P=${w.p.id}, P'=${w.pPrime.id}, provider ${w.providerId}, match M=${closure.matchId}, `
    + `closure row player_match_stats#${closure.rowId}, settle batch ${w.settleBatchId}, actor ${w.actorId}`);
  const { identityId } = await checkPmsPreState(ctx, w, closure);
  const { input, evidenceSha256 } = prepareCorrection(ctx, w);
  const { fingerprint } = await validateOnly(ctx, input, 1);

  if (variant === 'match-sheet') {
    const fresh = { club_id: w.clubs.home.id, jumper_number: '7', goals: 1, behinds: 0, kicks: 10, handballs: 5, disposals: 15,
      marks: 4, tackles: 3, hitouts: 0, frees_for: 0, frees_against: 2 };
    // AFLDB-ISSUE-257: the page-load token, taken BEFORE the gate (and so before the correction's MOVE).
    const staleToken = await writers.loadMatchSheetStaleToken(owner, closure.matchId);
    const run = await gatedWriter(ctx, w, closure, input, fingerprint, `${HARNESS_APP}case100-writer-match-sheet`,
      () => writers.saveMatchSheet({
        matchId: closure.matchId, syncMatchScores: false, players: [matchSheetLine(w.p.id, fresh)], adminUserId: w.actorId, staleToken,
        note: 'AFLDB-ISSUE-238 Slice 10 rehearsal case 100: concurrent match-sheet insert at (P, M)',
      }));
    const { r, cutoff } = await committedCorrection(ctx, input, fingerprint, run.correctionRun, closure);
    console.log(`  writer: ${JSON.stringify(run.writerResult)}`);
    check('writer: saveMatchSheet refused as a stale save once the correction released M (the MOVE changed the sheet the token was taken from)',
      !run.writerResult.ok && run.writerResult.error === writers.staleSheetRefusal, JSON.stringify(run.writerResult));
    const rows = await owner<{ id: number; playerId: number; row: RowSnapshot }[]>`
      SELECT id::int AS id, player_id AS "playerId", to_jsonb(p.*) AS row FROM player_match_stats p WHERE match_id = ${closure.matchId} ORDER BY id
    `;
    const moved = rows.find((x) => x.id === closure.rowId);
    check('post: the closure row (same id) is at (P′, M) with its settled contract byte-identical -- the refused writer never touched it',
      moved !== undefined && moved.playerId === w.pPrime.id && rowContractHash(contractOf(moved.row)) === closure.contractSha256);
    check('post: the refused writer INSERTED nothing: M holds only the moved closure row, (P, M) stays free',
      rows.length === 1 && moved !== undefined, JSON.stringify(rows.map((x) => ({ id: x.id, player_id: x.playerId, source_id: x.row.source_id }))));
    await checkLedgerAndIdentity(ctx, w, identityId, { r, evidenceSha256 });
    const audits = await auditsAt(owner, 'matches', closure.matchId, BEFORE_ANY_AUDIT);
    console.log(`  c = ${cutoff}; writer audit ${JSON.stringify(audits.map((a) => ({ id: a.id, fieldGroup: a.fieldGroup, createdAt: a.createdAt, afterCutoff: a.afterCutoff })))}`);
    check('post: NO writer audit for M (the refusal precedes every write)', audits.length === 0, JSON.stringify(audits));
    const overrides = await overrideRows(owner, closure.matchId);
    check('post: no player_match_stats data_overrides row for M (the refusal precedes the authority writes)', overrides.length === 0, JSON.stringify(overrides));
    // Observed only: what Q2 makes of the reappearance at (P, M) is case 101's contract, not claimed here.
    const censusBefore = await readResidue(owner);
    const q2 = runCli(input, 'validate-only', null);
    console.log(`  Q2 re-run (observed, informational; case 101 owns its contract): exit ${String(q2.status)}, ${JSON.stringify(q2.result)}`);
    for (const l of q2.stdout.replace(/\r/g, '').split('\n').filter((x) => /post_correction|NOOP|STOP|ALREADY_SATISFIED/.test(x))) console.log(`    | ${l.trim()}`);
    check('Q2 re-run wrote nothing (fixture census unchanged)', canonicalJson(await readResidue(owner)) === canonicalJson(censusBefore));
  } else {
    const [coverage] = await owner<{ coverage: string }[]>`
      SELECT coverage::text AS coverage FROM stat_availability WHERE stat_key = 'brownlow_season_total' AND season = ${w.season}
    `;
    check('pre: M is a home-and-away match of a POLLED season (brownlow_season_total coverage pending): the draft\'s lockMatch precondition holds',
      coverage?.coverage === 'pending', JSON.stringify(coverage));
    const run = await gatedWriter(ctx, w, closure, input, fingerprint, `${HARNESS_APP}case100-writer-brownlow-draft`,
      () => writers.saveDraftBrownlowMatch({
        matchId: closure.matchId, selection: { three: w.p.id, two: null, one: null }, expectedRevision: 0, actorId: w.actorId,
        note: 'AFLDB-ISSUE-238 Slice 10 rehearsal case 100: concurrent Brownlow draft naming P',
      }));
    const { r } = await committedCorrection(ctx, input, fingerprint, run.correctionRun, closure);
    console.log(`  writer: ${JSON.stringify(run.writerResult)}`);
    check('writer: saveDraftBrownlowMatch resumed after the commit, re-read M\'s participants, and refused not_participant (P no longer plays M)',
      !run.writerResult.ok && run.writerResult.code === 'not_participant', JSON.stringify(run.writerResult));
    const [post] = await owner<{ entry: number; audits: number; pAtM: number; movedAt: number | null }[]>`
      SELECT (SELECT count(*)::int FROM brownlow_vote_entry_state WHERE match_id = ${closure.matchId}) AS entry,
             (SELECT count(*)::int FROM data_edits WHERE table_name = 'brownlow_vote_entry_state' AND row_id = ${closure.matchId}) AS audits,
             (SELECT count(*)::int FROM player_match_stats WHERE player_id = ${w.p.id} AND match_id = ${closure.matchId}) AS "pAtM",
             (SELECT player_id FROM player_match_stats WHERE id = ${closure.rowId}) AS "movedAt"
    `;
    check('post: NO brownlow_vote_entry_state for M and no entry-state audit (no entry state naming P was interleaved)',
      post.entry === 0 && post.audits === 0, JSON.stringify(post));
    check('post: the closure row is at (P′, M); P holds nothing at M', post.movedAt === w.pPrime.id && post.pAtM === 0, JSON.stringify(post));
    await checkLedgerAndIdentity(ctx, w, identityId, { r, evidenceSha256 });
  }
  await owner.begin('read only', (tx) => assertAflApiIdentityInvariant(tx));
  check('post: the combined identity invariant (SAT-1 basis) holds', true);
}

/* ==================================================================== *
 * player_match_stats closure families (§12.1): Family A (2, 16, 23, 48, 51), Family B (9, 10, 11,
 * 12, 52 -- 9, 12 and 52 each also carry a Brownlow C4 half), Family E's match-sheet subset (70, 88,
 * 101). Each is case 1's base plus one named mutation, or case 1's CORRECTED base plus one real
 * later writer. A row with several required variants runs each on its own (`--variant`), with its
 * own teardown; the case counts only when every variant passes.
 * ==================================================================== */

type ClosureTable = 'player_match_stats' | 'brownlow_round_votes';
/** A cutoff earlier than any audit, for "every audit of M". postgres.js serialises a `::timestamptz`
 * parameter through `new Date()`, so it must be a real instant (`-infinity` throws client-side). */
const BEFORE_ANY_AUDIT = '1970-01-01T00:00:00.000Z';
type PmsFixture<T> ={ w: World; closure: PmsClosureRow; extra: T };

function logPmsFixture(w: World, closure: PmsClosureRow): void {
  console.log(`  fixture: P=${w.p.id} (${w.p.path}), P'=${w.pPrime.id} (${w.pPrime.path}), provider ${w.providerId}, `
    + `match M=${closure.matchId}, closure row player_match_stats#${closure.rowId}, settle batch ${w.settleBatchId}, actor ${w.actorId}`);
}

/** Case 1's base (world, CD_I's settled closure row at (P, M)) plus the named `mutate`, then the
 * settled derived rows, all in one owner transaction. */
async function buildPms<T>(
  ctx: CaseContext, caseNumber: number, mutate: (tx: TransactionSql, w: World, closure: PmsClosureRow) => Promise<T>,
): Promise<PmsFixture<T>> {
  const built = await ctx.owner.begin(async (tx) => {
    const w = await world(tx, caseNumber);
    const closure = await pmsClosureRow(tx, w, 1);
    const extra = await mutate(tx, w, closure);
    await settleDerived(tx, w);
    return { w, closure, extra };
  }) as unknown as PmsFixture<T>;
  logPmsFixture(built.w, built.closure);
  return built;
}

/** The closure row is CD_I's: at (P, M), `afl_api`-owned, stamped `<CD_M>|<team>|CD_I` with
 * `batchId`; CD_I is an importer row at P; the invariant holds. Returns CD_I's identity row id. */
async function checkClosureStamp(
  ctx: CaseContext, w: World, closure: PmsClosureRow, row: RowSnapshot | null, batchId = w.settleBatchId,
): Promise<number> {
  const { owner, check } = ctx;
  check('pre: the closure row is at (P, M), afl_api-owned, stamped <CD_M>|<team>|CD_I with its settle batch',
    row !== null && row.player_id === w.p.id && row.match_id === closure.matchId && row.source_id === w.sourceIds.aflApi
      && row.source_record_id === closure.externalRecordId && Number(row.import_batch_id) === batchId,
    JSON.stringify(row && { player_id: row.player_id, source_record_id: row.source_record_id, import_batch_id: row.import_batch_id }));
  const identity = await identityOf(owner, w);
  check('pre: CD_I is an importer row at P (unique, afl_api_stat_vector_bootstrap)',
    identity?.player_id === w.p.id && identity.status === 'unique' && identity.match_method === 'afl_api_stat_vector_bootstrap');
  await owner.begin('read only', (tx) => assertAflApiIdentityInvariant(tx));
  check('pre: the combined identity invariant holds with the fixture in place', true);
  return Number(identity?.id);
}

async function pmsCounts(owner: Sql, w: World, matchId: number) {
  const [n] = await owner<{ pRows: number; pPrimeRows: number; pAtM: number; pPrimeAtM: number; atM: number }[]>`
    SELECT (SELECT count(*)::int FROM player_match_stats WHERE player_id = ${w.p.id}) AS "pRows",
           (SELECT count(*)::int FROM player_match_stats WHERE player_id = ${w.pPrime.id}) AS "pPrimeRows",
           (SELECT count(*)::int FROM player_match_stats WHERE player_id = ${w.p.id} AND match_id = ${matchId}) AS "pAtM",
           (SELECT count(*)::int FROM player_match_stats WHERE player_id = ${w.pPrime.id} AND match_id = ${matchId}) AS "pPrimeAtM",
           (SELECT count(*)::int FROM player_match_stats WHERE match_id = ${matchId}) AS "atM"
  `;
  return n;
}

type AppRow = {
  id: number; importBatchId: number; sourceKey: string | null; family: string; externalRecordId: string; versionSeq: number;
  targetKey: JsonValue; verb: string; previousValues: JsonValue; newValues: JsonValue;
};

/** Every `canonical_applications` row at `(table, key)`, id-ascending (the §5.2 attribution history).
 * The key is bound as TEXT and cast: a string bound straight to `::jsonb` is JSON-encoded again by
 * postgres.js and compares as a jsonb string, never an object. */
async function applicationsAt(owner: Sql, table: ClosureTable, key: Record<string, JsonValue>): Promise<AppRow[]> {
  return owner<AppRow[]>`
    SELECT ca.id::int AS id, ca.import_batch_id::int AS "importBatchId", s.key AS "sourceKey", ca.family,
           ca.external_record_id AS "externalRecordId", ca.source_version_seq AS "versionSeq", ca.target_key AS "targetKey",
           ca.verb, ca.previous_values AS "previousValues", ca.new_values AS "newValues"
      FROM canonical_applications ca LEFT JOIN sources s ON s.id = ca.source_id
     WHERE ca.target_table = ${table} AND ca.target_key = ${canonicalJson(key)}::text::jsonb ORDER BY ca.id
  `;
}

const describeCliStop = (s: CorrectionCliStop) => `${s.table}${s.rowId === null ? '' : `#${s.rowId}`} [${s.step}] ${s.code}${s.detail === null ? '' : `: ${s.detail}`}`;
const stopLinesOf = (stdout: string) => stdout.replace(/\r/g, '').split('\n').filter((l) => /^ {2}STOP: /.test(l) || STOP_LINE.test(l));

type ExpectedStop = {
  table: ClosureTable; rowId: number | null; step: string; code: string;
  /** Where §12.1 requires the STOP to NAME its evidence (§5.7 "the differing fields"): the exact text. */
  detail?: string;
};

/**
 * A Q1 STOP (MUTATION ELIGIBILITY) case: `--validate-only` STOPs with exactly `expected` and nothing
 * else; then the LOCKING `--apply`, handed the STOP's reference fingerprint (the CLI compares it only
 * after planning), re-plans under §8.2's locks and STOPs identically. Neither writes anything: the
 * fixture census, CD_I's identity row and every `protect`ed row are byte-identical afterwards, and no
 * ledger row or correction batch exists. Returns the CLI input (its evidence file).
 */
async function expectQ1Stop(
  ctx: CaseContext, w: World, expected: ExpectedStop,
  options: {
    protect: readonly { table: ClosureTable; id: number }[]; evidenceText?: string;
    /** Report-context lines the STOP's output must carry (trimmed, exact): the §5.10/§5.11 evidence
     * of a plan-level STOP (SV-1, DP-4), whose stop line itself names no detail. */
    expectOutput?: readonly { label: string; line: string }[];
    /** Report-context lines the STOP's output must NOT carry (a guard disjunct that must not fire). */
    forbidOutput?: readonly { label: string; line: string }[];
  },
): Promise<CorrectInput> {
  const { owner, check } = ctx;
  const snapshot = async () => canonicalJson({
    census: await readResidue(owner),
    identity: await identityOf(owner, w),
    rows: await Promise.all(options.protect.map(async (p) => (await rowsById(owner, p.table, [p.id])).get(p.id) ?? null)),
  } as JsonValue);
  const before = await snapshot();
  const { input } = prepareCorrection(ctx, w, options.evidenceText);
  const want = `${expected.table}${expected.rowId === null ? '' : `#${expected.rowId}`} [${expected.step}] ${expected.code}`;
  const isExpected = (stops: readonly CorrectionCliStop[]) => stops.length === 1 && stops[0].table === expected.table
    && stops[0].rowId === expected.rowId && stops[0].step === expected.step && stops[0].code === expected.code;

  const validate = runCli(input, 'validate-only', null);
  const v = validate.result;
  console.log(`  validate-only: exit ${String(validate.status)}, ${JSON.stringify(v)}`);
  for (const l of stopLinesOf(validate.stdout)) console.log(`    | ${l.trim()}`);
  check(`validate-only: STOP (exit 1) with exactly one stop, ${want}`, v.kind === 'STOP' && isExpected(v.stops), JSON.stringify(v));
  if (expected.detail !== undefined) {
    const named = v.kind === 'STOP' && (v.stops[0]?.detail === expected.detail || validate.stdout.includes(expected.detail));
    check(`validate-only: the STOP names its evidence exactly, "${expected.detail}" (§5.7; §12.1)`, named,
      v.kind === 'STOP' ? `printed: ${v.stops.map(describeCliStop).join(' | ')}; "${expected.detail}" appears nowhere in the CLI output` : '');
  }
  const printed = validate.stdout.replace(/\r/g, '').split('\n').map((l) => l.trim());
  for (const e of options.expectOutput ?? []) {
    check(`validate-only: the STOP's report context carries ${e.label}: "${e.line}"`, printed.includes(e.line));
  }
  for (const e of options.forbidOutput ?? []) {
    check(`validate-only: the STOP's report context does NOT carry ${e.label}`, !printed.includes(e.line), e.line);
  }
  if (v.kind !== 'STOP') {
    console.log(validate.stdout, validate.stderr);
    throw new RehearsalRefused('validate-only did not STOP; apply is not attempted');
  }

  const apply = runCli(input, 'apply', v.referenceFingerprint ?? '0'.repeat(64));
  console.log(`  apply (--expect-fingerprint = the STOP's reference fingerprint): exit ${String(apply.status)}, ${JSON.stringify(apply.result)}`);
  check('apply (the locking re-plan): STOP (exit 1) with the identical stop set -- the STOP holds under §8.2\'s locks',
    apply.result.kind === 'STOP' && canonicalJson(apply.result.stops as unknown as JsonValue) === canonicalJson(v.stops as unknown as JsonValue),
    JSON.stringify(apply.result));
  check('nothing written by either run: fixture census, CD_I\'s identity row and every protected row byte-identical', (await snapshot()) === before);
  const [post] = await owner<{ ledger: number; batches: number }[]>`
    SELECT (SELECT count(*)::int FROM afl_api_identity_adjudications WHERE external_id = ${w.providerId}) AS ledger,
           (SELECT count(*)::int FROM import_batches WHERE tool = ${R.correctionTool} AND validation_result->>'externalId' = ${w.providerId}) AS batches
  `;
  check('no ledger row and no correction batch for CD_I', post.ledger === 0 && post.batches === 0, JSON.stringify(post));
  await owner.begin('read only', (tx) => assertAflApiIdentityInvariant(tx));
  check('post: the combined identity invariant holds', true);
  return input;
}

/** Batch K's `validation_result` (§8.7): completed, bound to A, the closure fingerprint and evidence
 * hash, exactly one rowProof as given, and the given counts. Returns `projectionsMoved`. */
async function checkBatchK(
  ctx: CaseContext, w: World, c: Corrected,
  proof: { table: ClosureTable; verb: 'update' | 'delete'; oldKey: Record<string, JsonValue>; newKey: Record<string, JsonValue> | null; preHash: string },
  counts: { moved: Record<ClosureTable, number>; deleted: Record<ClosureTable, number> },
): Promise<number | undefined> {
  const { owner, check } = ctx;
  const [batch] = await owner<{ tool: string; status: string; vr: Record<string, JsonValue> }[]>`
    SELECT tool, status::text AS status, validation_result AS vr FROM import_batches WHERE id = ${c.r.batchId}
  `;
  const proofs = (batch?.vr.rowProofs ?? []) as Record<string, JsonValue>[];
  check(`post: batch K completed and bound (adjudication, fingerprint, evidence hash); exactly one ${proof.table} ${proof.verb} rowProof with the pre-correction contract hash`,
    batch?.tool === R.correctionTool && batch.status === 'completed' && batch.vr.kind === 'afl_api_identity_correction'
      && batch.vr.mode === 'original' && batch.vr.adjudicationId === c.r.adjudicationId && batch.vr.externalId === w.providerId
      && batch.vr.closureFingerprint === c.fingerprint && batch.vr.adjudicationEvidenceSha256 === c.evidenceSha256
      && proofs.length === 1 && proofs[0].table === proof.table && proofs[0].verb === proof.verb
      && canonicalJson(proofs[0].oldKey) === canonicalJson(proof.oldKey) && canonicalJson(proofs[0].newKey ?? null) === canonicalJson(proof.newKey)
      && proofs[0].preCorrectionContractSha256 === proof.preHash, JSON.stringify(proofs));
  const got = batch?.vr.counts as { moved?: Record<string, number>; deleted?: Record<string, number>; projectionsMoved?: number } | undefined;
  check(`post: batch counts moved ${canonicalJson(counts.moved)}, deleted ${canonicalJson(counts.deleted)}`,
    got?.moved?.player_match_stats === counts.moved.player_match_stats && got.moved.brownlow_round_votes === counts.moved.brownlow_round_votes
      && got.deleted?.player_match_stats === counts.deleted.player_match_stats && got.deleted.brownlow_round_votes === counts.deleted.brownlow_round_votes,
    JSON.stringify(got));
  return got?.projectionsMoved;
}

/** P's and P′'s 2092 season games and career games after the correction's targeted recompute. */
async function gamesOf(owner: Sql, w: World) {
  const rows = await owner<{ playerId: number; season: number | null; career: number | null }[]>`
    SELECT p.id AS "playerId", pss.games::int AS season, pcs.games::int AS career
      FROM players p
      LEFT JOIN player_season_stats pss ON pss.player_id = p.id AND pss.season = ${w.season}
      LEFT JOIN player_career_stats pcs ON pcs.player_id = p.id
     WHERE p.id IN (${w.p.id}, ${w.pPrime.id})
  `;
  const of = (id: number) => rows.find((r) => r.playerId === id);
  return { p: of(w.p.id), pPrime: of(w.pPrime.id) };
}

/* ---- Family A ---- */

/** Case 2: case 1 + the closure row's `brownlow_votes` = 0 (and, separately, 3) -> STOP
 * `brownlow_state_present`, nothing written. P6 is §5.2's statement of BG1 and is the first rule to
 * see a non-NULL `brownlow_votes` (mutation eligibility precedes C1b). */
async function case2(ctx: CaseContext): Promise<void> {
  const { owner, check, variant } = ctx;
  const votes = ({ 'votes-0': 0, 'votes-3': 3 } as Record<string, number>)[variant ?? ''];
  if (votes === undefined) throw new RehearsalRefused('case 2 needs --variant votes-0 | votes-3');
  const { w, closure } = await buildPms(ctx, 2, async (tx, _w, row) => {
    await tx`UPDATE player_match_stats SET brownlow_votes = ${votes} WHERE id = ${row.rowId}`;
  });
  const row = await pmsRow(owner, closure.rowId);
  await checkClosureStamp(ctx, w, closure, row);
  check(`pre: the closure row carries player_match_stats.brownlow_votes = ${votes} (Brownlow state the AFL API never writes); every other contract field is the insert application's`,
    row !== null && row.brownlow_votes === votes && rowContractHash({ ...contractOf(row), brownlow_votes: null }) === closure.contractSha256,
    JSON.stringify(row && { brownlow_votes: row.brownlow_votes }));
  const n = await pmsCounts(owner, w, closure.matchId);
  check('pre: no P′ counterpart at M; P holds exactly the closure row', n.pPrimeAtM === 0 && n.pRows === 1, JSON.stringify(n));
  await expectQ1Stop(ctx, w, { table: 'player_match_stats', rowId: closure.rowId, step: 'P6', code: 'brownlow_state_present' },
    { protect: [{ table: 'player_match_stats', id: closure.rowId }] });
}

/** Case 16: the REAL `saveMatchSheet` edits the AFL API-owned closure row before any correction
 * (goals 2 -> 3), writing its production `data_edits` audit and no application -> STOP
 * `out_of_ledger_edit` naming the field (P7). */
async function case16(ctx: CaseContext): Promise<void> {
  const { owner, check } = ctx;
  const writers = await loadWriters();
  const { w, closure } = await buildPms(ctx, 16, async () => {});
  const { before } = await checkPmsPreState(ctx, w, closure);
  const storable = await detectAuthorityState(owner);
  const staleToken = await writers.loadMatchSheetStaleToken(owner, closure.matchId);
  const result = await writerCall(ctx.importDsn, `${HARNESS_APP}case016-writer-match-sheet`, () => writers.saveMatchSheet({
    matchId: closure.matchId, syncMatchScores: false, players: [matchSheetLine(w.p.id, { ...closure.values, goals: 3 })],
    adminUserId: w.actorId, staleToken, note: 'AFLDB-ISSUE-238 Slice 10 rehearsal case 016: match-sheet edit of the closure row before correction',
  }));
  console.log(`  writer saveMatchSheet (before any correction): ${JSON.stringify(result)}`);
  if (!(await checkSheetSaveOutcome(ctx, storable, result, closure.matchId, 'match_sheet', 1, 'the real saveMatchSheet edit of M\'s closure row'))) {
    // State A: the edit never happened, so P7's out_of_ledger_edit has nothing to find.
    const unchanged = await pmsRow(owner, closure.rowId);
    check('State A: the closure row is byte-identical to its settled pre-state (nothing saved)',
      unchanged !== null && canonicalJson(unchanged as unknown as JsonValue) === canonicalJson(before as unknown as JsonValue));
    check('State A: no writer audit for M', (await auditsAt(owner, 'matches', closure.matchId, BEFORE_ANY_AUDIT)).length === 0);
    return;
  }
  const edited = await pmsRow(owner, closure.rowId);
  check('pre: the SAME closure row, still at (P, M), now goals 2 -> 3; every other contract field as settled',
    edited !== null && edited.player_id === w.p.id
      && canonicalJson(contractOf(edited)) === canonicalJson({ ...contractOf(before), goals: 3 } as Record<string, JsonValue>),
    JSON.stringify(edited && contractOf(edited)));
  check('pre: ownership and stamps untouched by the sheet (afl_api, <CD_M>|<team>|CD_I, settle batch): it still looks CD_I-settled',
    edited !== null && edited.source_id === before.source_id && edited.source_record_id === before.source_record_id
      && edited.import_batch_id === before.import_batch_id);
  const audits = await auditsAt(owner, 'matches', closure.matchId, BEFORE_ANY_AUDIT);
  check('pre: the writer\'s production audit exists: exactly one data_edits matches/match_sheet row for M', audits.length === 1 && audits[0].fieldGroup === 'match_sheet',
    JSON.stringify(audits));
  const apps = await applicationsAt(owner, 'player_match_stats', { player_id: w.p.id, match_id: closure.matchId });
  check('pre: the key\'s application history is still only the settle\'s insert: the edit is outside the ledger',
    apps.length === 1 && apps[0].id === closure.insertApplicationId && apps[0].verb === 'insert', JSON.stringify(apps.map((a) => a.id)));
  // State B: the edit wrote manual authority, so the ORIGINAL correction STOPs at the ISSUE-257 guard (A257), before P7.
  const activeKeys = (await overrideRows(owner, closure.matchId)).filter((r) => r.isActive && r.fieldGroup === 'match_sheet');
  check('pre: exactly one active match_sheet authority key exists for M', activeKeys.length === 1, JSON.stringify(activeKeys));
  await expectQ1Stop(ctx, w, {
    table: 'player_match_stats', rowId: closure.rowId, step: 'A257', code: 'manual_authority_present',
    detail: `active Match Sheet authority ${activeKeys[0]?.entityKey ?? '<missing>'} [match_sheet]`,
  }, { protect: [{ table: 'player_match_stats', id: closure.rowId }] });
}

/** Case 23: the history at the old key {P, M} ran through ANOTHER provider (`insertedThroughAnotherProvider`)
 * -> STOP P3 `mixed_provider_application_history`, nothing written. */
async function case23(ctx: CaseContext): Promise<void> {
  const { owner, check } = ctx;
  const { w, closure } = await owner.begin(async (tx) => {
    const built = await world(tx, 23);
    const row = await insertedThroughAnotherProvider(tx, built, 1);
    await settleDerived(tx, built);
    return { w: built, closure: row };
  });
  logPmsFixture(w, closure);
  console.log(`  other provider CD_J ${closure.otherProviderId} (record ${closure.otherExternalRecordId}), insert application ${closure.otherInsertApplicationId}; `
    + `CD_I update application ${closure.updateApplicationId}, later batch B2 ${closure.laterBatchId}`);
  const row = await pmsRow(owner, closure.rowId);
  await checkClosureStamp(ctx, w, closure, row, closure.laterBatchId);
  check('pre: the row\'s contract = CD_J\'s insert with CD_I\'s update applied (goals 3): P7 would pass',
    row !== null && rowContractHash(contractOf(row)) === closure.contractSha256 && row.goals === 3);
  const apps = await applicationsAt(owner, 'player_match_stats', { player_id: w.p.id, match_id: closure.matchId });
  console.log(`  history at {P, M}: ${JSON.stringify(apps.map((a) => ({ id: a.id, verb: a.verb, source: a.sourceKey, record: a.externalRecordId, batch: a.importBatchId })))}`);
  check('pre: the history at {P, M} is exactly [CD_J insert (settle batch), CD_I update goals 2 -> 3 (B2)], all afl_api-sourced: P1, P2, P4 hold',
    apps.length === 2 && apps.every((a) => a.sourceKey === 'afl_api')
      && apps[0].id === closure.otherInsertApplicationId && apps[0].verb === 'insert'
      && apps[0].externalRecordId === closure.otherExternalRecordId && apps[0].importBatchId === w.settleBatchId
      && apps[1].id === closure.updateApplicationId && apps[1].verb === 'update' && apps[1].externalRecordId === closure.externalRecordId
      && apps[1].importBatchId === closure.laterBatchId && canonicalJson(apps[1].previousValues) === canonicalJson({ goals: 2 })
      && canonicalJson(apps[1].newValues) === canonicalJson({ goals: 3 }), JSON.stringify(apps));
  const [other] = await owner<{ identities: number; ledger: number; projections: number; projection: number | null }[]>`
    SELECT (SELECT count(*)::int FROM external_identities WHERE external_id = ${closure.otherProviderId}) AS identities,
           (SELECT count(*)::int FROM afl_api_identity_adjudications WHERE external_id = ${closure.otherProviderId}) AS ledger,
           (SELECT count(*)::int FROM staging.afl_api_player_match WHERE provider_player_id = ${closure.otherProviderId}) AS projections,
           (SELECT player_id FROM staging.afl_api_player_match WHERE provider_player_id = ${w.providerId}) AS projection
  `;
  check('pre: CD_J is genuinely OUTSIDE CD_I\'s lineage: its record ends |CD_J (not |CD_I); it holds no identity, ledger or projection row',
    closure.otherExternalRecordId.endsWith(`|${closure.otherProviderId}`) && !closure.otherExternalRecordId.endsWith(`|${w.providerId}`)
      && other.identities === 0 && other.ledger === 0 && other.projections === 0, JSON.stringify(other));
  check('pre: CD_I\'s projection names P (P5 holds)', other.projection === w.p.id);
  const n = await pmsCounts(owner, w, closure.matchId);
  check('pre: no P′ counterpart at M (not a collision case); P holds exactly this row', n.pPrimeAtM === 0 && n.pRows === 1, JSON.stringify(n));
  await expectQ1Stop(ctx, w, { table: 'player_match_stats', rowId: closure.rowId, step: 'P3', code: 'mixed_provider_application_history' },
    { protect: [{ table: 'player_match_stats', id: closure.rowId }] });
}

/**
 * Case 48 (D9, O-6): the evidence file is present, and says in terms that the row is CD_I's, but
 * the DATABASE evidence is insufficient -- `withoutApplicationHistory`: the settle's insert
 * application at {P, M} is absent (the stored observation and CD_I's projection remain) -> still
 * STOP P3 `no_application_evidence`. The evidence file is audit evidence only: it can neither
 * replace a missing `canonical_applications` row nor override a STOP.
 */
async function case48(ctx: CaseContext): Promise<void> {
  const { owner, check } = ctx;
  const { w, closure } = await buildPms(ctx, 48, async (tx, _w, row) => {
    await tx`DELETE FROM canonical_applications WHERE id = ${row.insertApplicationId}`;
  });
  const row = await pmsRow(owner, closure.rowId);
  await checkClosureStamp(ctx, w, closure, row);
  check('pre: its contract is exactly the settled one', row !== null && rowContractHash(contractOf(row)) === closure.contractSha256);
  const apps = await applicationsAt(owner, 'player_match_stats', { player_id: w.p.id, match_id: closure.matchId });
  const [obs] = await owner<{ versions: number; projection: number | null }[]>`
    SELECT (SELECT count(*)::int FROM staging.source_record_versions WHERE external_record_id = ${closure.externalRecordId}) AS versions,
           (SELECT player_id FROM staging.afl_api_player_match WHERE provider_player_id = ${w.providerId}) AS projection
  `;
  check('pre: database evidence insufficient: NO canonical_applications row at {P, M}; the stored observation and CD_I\'s projection (naming P) remain',
    apps.length === 0 && obs.versions === 1 && obs.projection === w.p.id, JSON.stringify({ apps: apps.length, ...obs }));
  const evidenceText = `AFLDB-ISSUE-238 Slice 10 code_test_db rehearsal, case 048 (D9 evidence file): the operator states that `
    + `player_match_stats#${closure.rowId} at match ${closure.matchId} was written by AFL API provider ${w.providerId}'s settle `
    + `(record ${closure.externalRecordId}), that ${w.providerId} is ${w.pPrime.path}, not ${w.p.path}, and asks for it to be moved.\n`;
  const input = await expectQ1Stop(ctx, w, { table: 'player_match_stats', rowId: closure.rowId, step: 'P3', code: 'no_application_evidence' },
    { protect: [{ table: 'player_match_stats', id: closure.rowId }], evidenceText });
  check('the D9 evidence file was present and read: the CLI got the stated file (a missing one is REFUSED before planning, not a STOP)',
    readFileSync(input.evidenceFile, 'utf8') === evidenceText, input.evidenceFile);
}

/** Case 51: case 1 + a FOREIGN (AFL Tables-owned, no CD_I lineage) row at P in another match M2,
 * with no Brownlow event dependency -> the correction COMMITS the closure row's MOVE and reports the
 * foreign row NOOP `foreign` (C11); it stays at P, byte-identical. */
async function case51(ctx: CaseContext): Promise<void> {
  const { owner, check } = ctx;
  const { w, closure, extra } = await buildPms(ctx, 51, async (tx, built) => {
    const m2 = await fixtureMatch(tx, built, 2, 2);
    return { m2, foreignRowId: await participation(tx, built, built.p.id, m2.id) };
  });
  const { m2, foreignRowId } = extra;
  console.log(`  foreign row at P: player_match_stats#${foreignRowId} at match M2=${m2.id} (round ${m2.roundNumber})`);
  const row = await pmsRow(owner, closure.rowId);
  const identityId = await checkClosureStamp(ctx, w, closure, row);
  check('pre: the closure row\'s contract is the settled one', row !== null && rowContractHash(contractOf(row)) === closure.contractSha256);
  const foreignBefore = await pmsRow(owner, foreignRowId);
  const [f] = await owner<{ ownerKey: string | null; apps: number; brv: number }[]>`
    SELECT (SELECT s.key FROM player_match_stats x JOIN sources s ON s.id = x.source_id WHERE x.id = ${foreignRowId}) AS "ownerKey",
           (SELECT count(*)::int FROM canonical_applications WHERE target_table = 'player_match_stats'
             AND target_key = ${canonicalJson({ player_id: w.p.id, match_id: m2.id })}::text::jsonb) AS apps,
           (SELECT count(*)::int FROM brownlow_round_votes WHERE player_id = ${w.p.id}) AS brv
  `;
  check('pre: the foreign row is at (P, M2), AFL Tables-owned, with no stamp, batch or application at its key; P has no Brownlow row (no event dependency)',
    foreignBefore !== null && foreignBefore.player_id === w.p.id && foreignBefore.match_id === m2.id && f.ownerKey === 'afltables'
      && foreignBefore.source_record_id === null && foreignBefore.import_batch_id === null && f.apps === 0 && f.brv === 0, JSON.stringify(f));
  const n0 = await pmsCounts(owner, w, closure.matchId);
  check('pre: P holds two rows (closure + foreign); no P′ counterpart at M', n0.pRows === 2 && n0.pPrimeAtM === 0, JSON.stringify(n0));

  const c = await correct(ctx, w, { rowsPlanned: 1, moved: 1, deleted: 0 });
  const noop = `NOOP foreign (C11): player_match_stats#${foreignRowId} (player ${w.p.id}, match ${m2.id}) is not afl_api-owned and carries no ${w.providerId} lineage; preserved untouched`;
  check('validate-only: the foreign row is classified NOOP foreign (C11) and reported; only the closure row is planned',
    c.validateStdout.replace(/\r/g, '').split('\n').some((l) => l.trim() === noop), noop);

  const after = await pmsRow(owner, closure.rowId);
  check('post: the closure row (same id) is at (P′, M), contract byte-identical, provenance kept',
    after !== null && after.player_id === w.pPrime.id && after.match_id === closure.matchId && rowContractHash(contractOf(after)) === closure.contractSha256
      && after.source_record_id === row!.source_record_id && after.import_batch_id === row!.import_batch_id);
  // `career_game_no` is recompute-owned (runbook §4 derived table, §5.8 contract exclusions): the
  // correction's targeted `recomputePlayerDerivedStats` re-sequences P's remaining career, so it is
  // compared on its own, never as part of the row's (untouched) canonical content.
  const foreignAfter = await pmsRow(owner, foreignRowId);
  const withoutDerived = (r: RowSnapshot | null) => (r === null ? null : canonicalJson({ ...r, career_game_no: null }));
  check('post: the foreign row is byte-identical apart from recompute-owned career_game_no, and still at (P, M2): never moved, deleted or rewritten',
    foreignAfter !== null && withoutDerived(foreignAfter) === withoutDerived(foreignBefore),
    JSON.stringify(Object.keys({ ...foreignBefore, ...foreignAfter })
      .filter((k) => canonicalJson(foreignBefore?.[k] ?? null) !== canonicalJson(foreignAfter?.[k] ?? null))
      .map((k) => ({ [k]: [foreignBefore?.[k] ?? null, foreignAfter?.[k] ?? null] }))));
  check('post: its career_game_no is re-sequenced 2 -> 1 by the targeted recompute (M2 is now P\'s only, first, game)',
    foreignBefore?.career_game_no === 2 && foreignAfter?.career_game_no === 1,
    `${String(foreignBefore?.career_game_no)} -> ${String(foreignAfter?.career_game_no)}`);
  const n1 = await pmsCounts(owner, w, closure.matchId);
  check('post: P holds exactly the foreign row; P′ holds exactly the moved row', n1.pRows === 1 && n1.pPrimeRows === 1 && n1.pPrimeAtM === 1, JSON.stringify(n1));
  const [{ appsAtForeign }] = await owner<{ appsAtForeign: number }[]>`
    SELECT count(*)::int AS "appsAtForeign" FROM canonical_applications WHERE target_table = 'player_match_stats'
       AND target_key IN (${canonicalJson({ player_id: w.p.id, match_id: m2.id })}::text::jsonb, ${canonicalJson({ player_id: w.pPrime.id, match_id: m2.id })}::text::jsonb)
  `;
  check('post: no application was written at the foreign row\'s key (or at P′ for M2)', appsAtForeign === 0);
  await checkBatchK(ctx, w, c, {
    table: 'player_match_stats', verb: 'update', oldKey: { player_id: w.p.id, match_id: closure.matchId },
    newKey: { player_id: w.pPrime.id, match_id: closure.matchId }, preHash: closure.contractSha256,
  }, { moved: { player_match_stats: 1, brownlow_round_votes: 0 }, deleted: { player_match_stats: 0, brownlow_round_votes: 0 } });
  await checkLedgerAndIdentity(ctx, w, identityId, c);
  const games = await gamesOf(owner, w);
  check('post: targeted recompute: P keeps 1 game in 2092 (the foreign M2 row) and 1 career game; P′ has 1 and 1',
    games.p?.season === 1 && games.p.career === 1 && games.pPrime?.season === 1 && games.pPrime.career === 1, JSON.stringify(games));
  await owner.begin('read only', (tx) => assertAflApiIdentityInvariant(tx));
  check('post: the combined identity invariant (SAT-1 basis) holds', true);
}

/* ---- Family B ---- */

type PmsCollision = {
  w: World; closure: PmsClosureRow; counterpartId: number; identityId: number;
  before: RowSnapshot; counterpartBefore: RowSnapshot; differing: string[];
};

/** Case 1's base + a P′ `counterpart` at M owned by `owner` with `values` (+ optionally the closure
 * row's `brownlow_votes`); pre-state proven; returns the §5.5 fields that differ. */
async function pmsCollisionFixture(
  ctx: CaseContext, caseNumber: number, owner: CounterpartOwner,
  values: (closure: PmsClosureRow) => Record<string, JsonValue>, closureBrownlowVotes: number | null = null,
): Promise<PmsCollision> {
  const { owner: sql, check } = ctx;
  const { w, closure, extra: counterpartId } = await buildPms(ctx, caseNumber, async (tx, built, row) => {
    if (closureBrownlowVotes !== null) await tx`UPDATE player_match_stats SET brownlow_votes = ${closureBrownlowVotes} WHERE id = ${row.rowId}`;
    return pmsCounterpart(tx, built, row.matchId, owner, values(row));
  });
  console.log(`  counterpart: player_match_stats#${counterpartId} at (P′, M), owner ${owner}`);
  const before = await pmsRow(sql, closure.rowId);
  const identityId = await checkClosureStamp(ctx, w, closure, before);
  check(`pre: the closure row's brownlow_votes is ${String(closureBrownlowVotes)}; every other contract field is the insert application's`,
    before !== null && before.brownlow_votes === closureBrownlowVotes
      && rowContractHash({ ...contractOf(before), brownlow_votes: null }) === closure.contractSha256);
  const counterpartBefore = await pmsRow(sql, counterpartId);
  const [{ ownerKey }] = await sql<{ ownerKey: string | null }[]>`
    SELECT s.key AS "ownerKey" FROM player_match_stats x LEFT JOIN sources s ON s.id = x.source_id WHERE x.id = ${counterpartId}
  `;
  check(`pre: P′'s counterpart at M is ${owner === 'foreign' ? 'AFL Tables-owned (foreign)' : 'NULL-owned (source_id NULL)'}, with no stamp or batch (no CD_I lineage)`,
    counterpartBefore !== null && counterpartBefore.player_id === w.pPrime.id && counterpartBefore.match_id === closure.matchId
      && ownerKey === (owner === 'foreign' ? 'afltables' : null) && (owner === 'foreign') === (counterpartBefore.source_id !== null)
      && counterpartBefore.source_record_id === null && counterpartBefore.import_batch_id === null, JSON.stringify({ ownerKey }));
  const differing = PLAYER_MATCH_STATS_SUBSTANTIVE_FIELDS.filter((f) => canonicalJson(before?.[f] ?? null) !== canonicalJson(counterpartBefore?.[f] ?? null));
  console.log(`  §5.5 substantive fields differing between the closure row and the counterpart: [${differing.join(', ')}]`
    + (differing.length === 0 ? '' : ` (${differing.map((f) => `${f}: ${canonicalJson(before?.[f] ?? null)} vs ${canonicalJson(counterpartBefore?.[f] ?? null)}`).join('; ')})`));
  return { w, closure, counterpartId, identityId, before: before!, counterpartBefore: counterpartBefore!, differing };
}

/** C2: an IDENTICAL `owner` counterpart -> COMMITTED, the closure row deleted beside it
 * (DELETE_AS_FOREIGN_COLLISION), P′'s row untouched, one `delete` application at the old key. */
async function pmsC2Delete(ctx: CaseContext, caseNumber: number, owner: CounterpartOwner): Promise<PmsCollision & { c: Corrected }> {
  const { owner: sql, check } = ctx;
  const fx = await pmsCollisionFixture(ctx, caseNumber, owner, identicalTo);
  const { w, closure, counterpartId } = fx;
  check('pre: the counterpart is substantively IDENTICAL to the closure row (every §5.5 field equal): C2', fx.differing.length === 0, fx.differing.join(', '));
  const n0 = await pmsCounts(sql, w, closure.matchId);
  check('pre: P holds exactly the closure row; P′ exactly the counterpart', n0.pRows === 1 && n0.pPrimeRows === 1 && n0.atM === 2, JSON.stringify(n0));

  const c = await correct(ctx, w, { rowsPlanned: 1, moved: 0, deleted: 1 });
  check('post: the closure row is DELETED (no row with its id; nothing at (P, M))', (await pmsRow(sql, closure.rowId)) === null);
  check('post: P′\'s counterpart is byte-identical (never moved, merged or rewritten)',
    canonicalJson(await pmsRow(sql, counterpartId)) === canonicalJson(fx.counterpartBefore));
  const n1 = await pmsCounts(sql, w, closure.matchId);
  check('post: P holds no row; P′ holds exactly its counterpart; M holds only it', n1.pRows === 0 && n1.pPrimeRows === 1 && n1.atM === 1, JSON.stringify(n1));
  const oldKey = { player_id: w.p.id, match_id: closure.matchId };
  const apps = await applicationsAt(sql, 'player_match_stats', oldKey);
  const del = apps[1];
  const prev = (del?.previousValues ?? {}) as RowSnapshot;
  check('post: exactly one correction application at the OLD key {P, M}: `delete`, batch K, citing CD_I\'s record version 1, '
    + 'previous_values = the full pre-delete row (its id, P, M, its contract), new_values {}',
    apps.length === 2 && apps[0].id === closure.insertApplicationId && del.verb === 'delete' && del.importBatchId === c.r.batchId
      && del.sourceKey === 'afl_api' && del.family === 'player_match_stats' && del.externalRecordId === closure.externalRecordId && del.versionSeq === 1
      && Number(prev.id) === closure.rowId && prev.player_id === w.p.id && prev.match_id === closure.matchId
      && rowContractHash(contractOf(prev)) === closure.contractSha256 && canonicalJson(del.newValues) === '{}',
    JSON.stringify(apps.slice(1).map((a) => ({ id: a.id, verb: a.verb, batch: a.importBatchId, newValues: a.newValues }))));
  const atNew = await applicationsAt(sql, 'player_match_stats', { player_id: w.pPrime.id, match_id: closure.matchId });
  check('post: no application at (P′, M): the counterpart\'s key is not the correction\'s', atNew.length === 0);
  const projectionsMoved = await checkBatchK(ctx, w, c, {
    table: 'player_match_stats', verb: 'delete', oldKey, newKey: null, preHash: closure.contractSha256,
  }, { moved: { player_match_stats: 0, brownlow_round_votes: 0 }, deleted: { player_match_stats: 1, brownlow_round_votes: 0 } });
  const [{ projection }] = await sql<{ projection: number | null }[]>`
    SELECT player_id AS projection FROM staging.afl_api_player_match WHERE provider_player_id = ${w.providerId}
  `;
  check(`post: CD_I's typed projection names P′, not P (SAT-5; projections moved ${String(projectionsMoved)})`, projection === w.pPrime.id);
  await checkLedgerAndIdentity(ctx, w, fx.identityId, c);
  const games = await gamesOf(sql, w);
  check('post: targeted recompute: P has no 2092 season row and 0 career games; P′ has 1 and 1 (its own counterpart)',
    games.p?.season === null && games.p.career === 0 && games.pPrime?.season === 1 && games.pPrime.career === 1, JSON.stringify(games));
  await sql.begin('read only', (tx) => assertAflApiIdentityInvariant(tx));
  check('post: the combined identity invariant (SAT-1 basis) holds', true);
  return { ...fx, c };
}

/** C3: an `owner` counterpart differing in exactly ONE §5.5 field -> STOP `collision_values_disagree`
 * naming that field, nothing written. */
async function pmsC3Stop(ctx: CaseContext, caseNumber: number, owner: CounterpartOwner, field: string, value: JsonValue): Promise<void> {
  const { check } = ctx;
  const fx = await pmsCollisionFixture(ctx, caseNumber, owner, (closure) => differingIn(closure, field, value));
  check(`pre: exactly ONE §5.5 field differs, ${field}: closure ${canonicalJson(fx.before[field] ?? null)} vs counterpart ${canonicalJson(value)}`,
    fx.differing.length === 1 && fx.differing[0] === field && canonicalJson(fx.counterpartBefore[field] ?? null) === canonicalJson(value),
    fx.differing.join(', '));
  await expectQ1Stop(ctx, fx.w, {
    table: 'player_match_stats', rowId: fx.closure.rowId, step: 'C3', code: 'collision_values_disagree', detail: `field(s) differ: ${field}`,
  }, { protect: [{ table: 'player_match_stats', id: fx.closure.rowId }, { table: 'player_match_stats', id: fx.counterpartId }] });
}

type BrownlowCollision = {
  w: World; closure: DemotedBrownlowClosureRow; participationRowId: number; counterpartId: number; identityId: number;
  saBaseline: Hashed; before: RowSnapshot;
};

async function citedPayload(owner: Sql, w: World, externalRecordId: string, versionSeq: number): Promise<unknown> {
  const [row] = await owner<{ payload: unknown }[]>`
    SELECT p.raw_payload AS payload FROM staging.source_record_versions v
      JOIN staging.source_payloads p ON p.source_id = v.source_id AND p.family = v.family AND p.payload_hash = v.payload_hash
     WHERE v.source_id = ${w.sourceIds.aflApi} AND v.family = 'brownlow_match_votes'
       AND v.external_record_id = ${externalRecordId} AND v.version_seq = ${versionSeq}
  `;
  return row?.payload ?? null;
}

/**
 * The Brownlow C4 fixture: CD_I's round row at (2092, P, 1) demoted to 0 by a later settle
 * (`demoteToZero`), P′ participating in M through a foreign row (C1c), and P′'s round row at
 * (2092, P′, 1) owned by `owner` with votes 0, played true, match_id M -- identical under §5.5
 * (both votes 0). Coverage settled with the real recompute; pre-state proven.
 */
async function brownlowCollisionFixture(ctx: CaseContext, caseNumber: number, owner: CounterpartOwner): Promise<BrownlowCollision> {
  const { owner: sql, check } = ctx;
  const built = await sql.begin(async (tx) => {
    const w = await world(tx, caseNumber);
    const closure = await demoteToZero(tx, w, await brownlowClosureRow(tx, w, 1));
    const participationRowId = await participation(tx, w, w.pPrime.id, closure.match.id);
    const counterpartId = await brownlowCounterpart(tx, w, closure.match, owner, { played: true, votes: 0, match_id: closure.match.id });
    await settleDerived(tx, w, { brownlow: true });
    return { w, closure, participationRowId, counterpartId };
  }) as unknown as { w: World; closure: DemotedBrownlowClosureRow; participationRowId: number; counterpartId: number };
  const { w, closure, participationRowId, counterpartId } = built;
  console.log(`  fixture: P=${w.p.id}, P'=${w.pPrime.id}, provider ${w.providerId}, match M=${closure.match.id} (${closure.externalRecordId}), `
    + `closure row brownlow_round_votes#${closure.rowId} (demoted by batch B2 ${closure.demotion.batchId}, application ${closure.demotion.applicationId}), `
    + `voters now V4 ${closure.demotion.newVoter.providerId} (3), ${closure.companions.map((c) => `${c.role} ${c.providerId} (${c.votes})`).join(', ')}; `
    + `P' participation player_match_stats#${participationRowId}; counterpart brownlow_round_votes#${counterpartId} (${owner})`);

  const before = (await rowsById(sql, 'brownlow_round_votes', [closure.rowId])).get(closure.rowId) ?? null;
  check('pre: closure row at (2092, P, 1): afl_api-owned, stamped CD_M, restamped with the demoting batch B2; played true, votes 0, match_id M',
    before !== null && before.player_id === w.p.id && before.source_id === w.sourceIds.aflApi && before.source_record_id === closure.externalRecordId
      && Number(before.import_batch_id) === closure.demotion.batchId && before.played === true && before.votes === 0
      && before.match_id === closure.match.id, JSON.stringify(before));
  const apps = await applicationsAt(sql, 'brownlow_round_votes', closure.naturalKey);
  check('pre: its chain is [insert (v1, votes 3, settle batch), update {votes: 3} -> {votes: 0} (v2, B2)]',
    apps.length === 2 && apps[0].id === closure.insertApplicationId && apps[0].verb === 'insert' && apps[0].versionSeq === 1
      && apps[1].id === closure.demotion.applicationId && apps[1].verb === 'update' && apps[1].versionSeq === 2
      && apps[1].importBatchId === closure.demotion.batchId && canonicalJson(apps[1].previousValues) === canonicalJson({ votes: 3 })
      && canonicalJson(apps[1].newValues) === canonicalJson({ votes: 0 }), JSON.stringify(apps.map((a) => ({ id: a.id, verb: a.verb, v: a.versionSeq }))));
  const v1 = citedPayloadVoterProof(await citedPayload(sql, w, closure.externalRecordId, 1), closure.externalRecordId, w.providerId);
  const v2Payload = await citedPayload(sql, w, closure.externalRecordId, 2);
  const v2 = citedPayloadVoterProof(v2Payload, closure.externalRecordId, w.providerId);
  const v2Voters = extractBrownlowVoterEntries(v2Payload, closure.externalRecordId);
  check('pre: version 1 names CD_I once with 3 (B3-I); version 2 (real extractor) is a 3/2/1 set WITHOUT CD_I (B3-C case 2, I244-F002)',
    v1.count === 1 && v1.vote === 3 && v2.count === 0 && v2Voters !== null && v2Voters.map((v) => v.votes).sort().join(',') === '1,2,3',
    JSON.stringify({ v1, v2, v2Voters }));
  const counterpart = (await rowsById(sql, 'brownlow_round_votes', [counterpartId])).get(counterpartId) ?? null;
  const [{ ownerKey }] = await sql<{ ownerKey: string | null }[]>`
    SELECT s.key AS "ownerKey" FROM brownlow_round_votes x LEFT JOIN sources s ON s.id = x.source_id WHERE x.id = ${counterpartId}
  `;
  check(`pre: P′'s round row at (2092, P′, 1) is ${owner === 'foreign' ? 'AFL Tables-owned' : 'NULL-owned'}, no stamps; votes 0, played true, match_id M: equal under §5.5 (C4)`,
    counterpart !== null && counterpart.player_id === w.pPrime.id && ownerKey === (owner === 'foreign' ? 'afltables' : null)
      && counterpart.source_record_id === null && counterpart.import_batch_id === null
      && counterpart.votes === 0 && counterpart.played === true && counterpart.match_id === closure.match.id, JSON.stringify(counterpart));
  const [pre] = await sql<{ pPms: number; pPrimeAtM: number }[]>`
    SELECT (SELECT count(*)::int FROM player_match_stats WHERE player_id = ${w.p.id}) AS "pPms",
           (SELECT count(*)::int FROM player_match_stats WHERE player_id = ${w.pPrime.id} AND match_id = ${closure.match.id}) AS "pPrimeAtM"
  `;
  check('pre: P holds no match row; P′ participates in M through its foreign row (C1c)', pre.pPms === 0 && pre.pPrimeAtM === 1, JSON.stringify(pre));
  const identity = await identityOf(sql, w);
  check('pre: CD_I is an importer row at P (unique, afl_api_stat_vector_bootstrap)',
    identity?.player_id === w.p.id && identity.status === 'unique' && identity.match_method === 'afl_api_stat_vector_bootstrap');
  const saBaseline = await statAvailabilityOf(sql, w.season);
  const fixedPoint = await coverageFixedPoint(sql, w.season);
  console.log(`  stat_availability 2092 baseline (${saBaseline.rows.length} row(s), sha256 ${saBaseline.sha256})`);
  check('baseline: the settled 2092 coverage is a fixed point of the real recomputeBrownlowCoverage (rolled-back re-run byte-identical)',
    fixedPoint.before.sha256 === saBaseline.sha256 && fixedPoint.after.sha256 === saBaseline.sha256);
  await sql.begin('read only', (tx) => assertAflApiIdentityInvariant(tx));
  check('pre: the combined identity invariant holds with the fixture in place', true);
  return { w, closure, participationRowId, counterpartId, identityId: Number(identity?.id), saBaseline, before: before! };
}

/** C4: the zero-vote closure row beside an identical `owner` counterpart -> COMMITTED, deleted 1. */
async function brownlowC4Delete(ctx: CaseContext, caseNumber: number, owner: CounterpartOwner): Promise<BrownlowCollision & { c: Corrected }> {
  const { owner: sql, check } = ctx;
  const fx = await brownlowCollisionFixture(ctx, caseNumber, owner);
  const { w, closure } = fx;
  const keepIds = [fx.counterpartId, ...closure.companions.map((x) => x.rowId), closure.demotion.newVoter.rowId];
  const keptBefore = await rowsById(sql, 'brownlow_round_votes', keepIds);
  const participationBefore = await pmsRow(sql, fx.participationRowId);

  const c = await correct(ctx, w, { rowsPlanned: 1, moved: 0, deleted: 1 });
  check('post: the closure round row is DELETED (DELETE_AS_FOREIGN_COLLISION, C4)',
    !(await rowsById(sql, 'brownlow_round_votes', [closure.rowId])).has(closure.rowId));
  const keptAfter = await rowsById(sql, 'brownlow_round_votes', keepIds);
  check('post: P′\'s counterpart and the three current voters\' rows (V4, V2, V3) are byte-identical',
    keepIds.every((id) => keptAfter.has(id) && canonicalJson(keptAfter.get(id)!) === canonicalJson(keptBefore.get(id)!)));
  check('post: P′\'s participation row is byte-identical', canonicalJson(await pmsRow(sql, fx.participationRowId)) === canonicalJson(participationBefore));
  const apps = await applicationsAt(sql, 'brownlow_round_votes', closure.naturalKey);
  const del = apps[2];
  const prev = (del?.previousValues ?? {}) as RowSnapshot;
  check('post: exactly one correction application at the OLD key {2092, P, 1}: `delete`, batch K, citing the latest (version 2) application, '
    + 'previous_values = the full pre-delete row (its id, votes 0), new_values {}',
    apps.length === 3 && del.verb === 'delete' && del.importBatchId === c.r.batchId && del.family === 'brownlow_match_votes'
      && del.externalRecordId === closure.externalRecordId && del.versionSeq === 2 && Number(prev.id) === closure.rowId
      && prev.player_id === w.p.id && prev.votes === 0 && canonicalJson(del.newValues) === '{}',
    JSON.stringify(apps.slice(2)));
  const projectionsMoved = await checkBatchK(ctx, w, c, {
    table: 'brownlow_round_votes', verb: 'delete', oldKey: closure.naturalKey, newKey: null, preHash: closure.contractSha256,
  }, { moved: { player_match_stats: 0, brownlow_round_votes: 0 }, deleted: { player_match_stats: 0, brownlow_round_votes: 1 } });
  const [{ projection }] = await sql<{ projection: number | null }[]>`
    SELECT player_id AS projection FROM staging.afl_api_brownlow_vote WHERE provider_player_id = ${w.providerId}
  `;
  check(`post: CD_I's (stale, version 1) Brownlow projection names P′, not P (SAT-5; projections moved ${String(projectionsMoved)})`, projection === w.pPrime.id);
  const saAfter = await statAvailabilityOf(sql, w.season);
  check('post: stat_availability for 2092 is byte-identical to the settled baseline', saAfter.sha256 === fx.saBaseline.sha256,
    `${fx.saBaseline.sha256} -> ${saAfter.sha256}`);
  await checkLedgerAndIdentity(ctx, w, fx.identityId, c);
  await sql.begin('read only', (tx) => assertAflApiIdentityInvariant(tx));
  check('post: the combined identity invariant (SAT-1 basis) holds', true);
  return { ...fx, c };
}

/** Case 9: a safe identical collision against a FOREIGN P′ row -> DELETE_AS_FOREIGN_COLLISION. */
async function case9(ctx: CaseContext): Promise<void> {
  if (ctx.variant === 'pms-foreign-identical') await pmsC2Delete(ctx, 9, 'foreign');
  else if (ctx.variant === 'brownlow-foreign-zero') await brownlowC4Delete(ctx, 9, 'foreign');
  else throw new RehearsalRefused('case 9 needs --variant pms-foreign-identical | brownlow-foreign-zero');
}

/** Case 10: one substantive value differs -> STOP C3 naming it: an ordinary value (kicks), NULL vs 0
 * (hitouts), and a whitespace-only `jumper_number` difference. */
async function case10(ctx: CaseContext): Promise<void> {
  const differences: Record<string, [string, JsonValue]> = {
    kicks: ['kicks', 15], 'null-vs-zero': ['hitouts', null], 'jumper-whitespace': ['jumper_number', '23 '],
  };
  const d = differences[ctx.variant ?? ''];
  if (!d) throw new RehearsalRefused('case 10 needs --variant kicks | null-vs-zero | jumper-whitespace');
  await pmsC3Stop(ctx, 10, 'foreign', d[0], d[1]);
}

/** Case 11: the closure row's `brownlow_votes` is non-NULL (0) beside an otherwise IDENTICAL foreign
 * counterpart -> STOP `brownlow_state_present` (P6/BG1), never the C2 DELETE it would otherwise be. */
async function case11(ctx: CaseContext): Promise<void> {
  const { check } = ctx;
  const fx = await pmsCollisionFixture(ctx, 11, 'foreign', identicalTo, 0);
  check('pre: the counterpart is substantively IDENTICAL (every §5.5 field equal): only the closure row\'s Brownlow state separates this from C2',
    fx.differing.length === 0, fx.differing.join(', '));
  await expectQ1Stop(ctx, fx.w, { table: 'player_match_stats', rowId: fx.closure.rowId, step: 'P6', code: 'brownlow_state_present' },
    { protect: [{ table: 'player_match_stats', id: fx.closure.rowId }, { table: 'player_match_stats', id: fx.counterpartId }] });
}

/** A Q2 re-run (§8.5): on a CORRECTED net state the CLI answers CORRECTION SATISFACTION only.
 * Proves it wrote nothing; returns its result and trimmed output lines. */
async function q2Rerun(ctx: CaseContext, c: Corrected, mode: 'validate-only' | 'apply'): Promise<{ result: CorrectionCliResult; lines: string[] }> {
  const { owner, check } = ctx;
  const censusBefore = await readResidue(owner);
  const run = runCli(c.input, mode, mode === 'apply' ? c.fingerprint : null);
  const lines = run.stdout.replace(/\r/g, '').split('\n').map((l) => l.trim());
  console.log(`  Q2 re-run (${mode}): exit ${String(run.status)}, ${JSON.stringify(run.result)}`);
  for (const l of lines.filter((x) => /post_correction|NOOP|STOP|ALREADY_SATISFIED|SATISFACTION|\] [a-z_]+/.test(x))) console.log(`    | ${l}`);
  check(`Q2 re-run (${mode}) wrote nothing (fixture census unchanged)`, canonicalJson(await readResidue(owner)) === canonicalJson(censusBefore));
  return { result: run.result, lines };
}

const SAT_PASS = 'CORRECTION SATISFACTION: SAT-1..SAT-5 PASS';

/**
 * Case 12: DELETE re-plan from immutable history. The fixture is case 9's topology CORRECTED by the
 * real CLI (that COMMIT is fixture construction here, not a re-acceptance of case 9); the re-run is
 * then NOOP `already_corrected_deleted` from D-1..D-6 alone -- the deleted row is gone, so there is
 * nothing to compare it with -- in both `--validate-only` and `--apply`, and writes nothing.
 */
async function case12(ctx: CaseContext): Promise<void> {
  const { owner, check, variant } = ctx;
  let c: Corrected;
  let label: string;
  let untouched: { table: ClosureTable; id: number };
  if (variant === 'pms') {
    const done = await pmsC2Delete(ctx, 12, 'foreign');
    c = done.c;
    label = `player_match_stats ${canonicalJson({ player_id: done.w.p.id, match_id: done.closure.matchId })}`;
    untouched = { table: 'player_match_stats', id: done.counterpartId };
  } else if (variant === 'brownlow') {
    const done = await brownlowC4Delete(ctx, 12, 'foreign');
    c = done.c;
    label = `brownlow_round_votes ${canonicalJson(done.closure.naturalKey)}`;
    untouched = { table: 'brownlow_round_votes', id: done.counterpartId };
  } else {
    throw new RehearsalRefused('case 12 needs --variant pms | brownlow');
  }
  console.log('  -- the correction above is case 12\'s fixture construction; case 12 proper is the re-run below --');
  const counterpartBefore = (await rowsById(owner, untouched.table, [untouched.id])).get(untouched.id);
  for (const mode of ['validate-only', 'apply'] as const) {
    const q2 = await q2Rerun(ctx, c, mode);
    check(`Q2 (${mode}): ALREADY_SATISFIED, NOOP already_corrected_deleted for ${label}; SAT-1..SAT-5 PASS; no MOVE lineage involved`,
      q2.result.kind === 'ALREADY_SATISFIED' && q2.lines.includes(`NOOP already_corrected_deleted: ${label}`) && q2.lines.includes(SAT_PASS)
        && !q2.lines.some((l) => l.startsWith('NOOP already_corrected_moved')), q2.lines.filter((l) => l.startsWith('NOOP')).join(' | '));
    check(`Q2 (${mode}): the deleted row stays deleted (never recreated) and P′'s counterpart is byte-identical`,
      canonicalJson((await rowsById(owner, untouched.table, [untouched.id])).get(untouched.id) ?? null) === canonicalJson(counterpartBefore ?? null));
  }
  const [{ ledger }] = await owner<{ ledger: number }[]>`
    SELECT count(*)::int AS ledger FROM afl_api_identity_adjudications WHERE external_id = ${c.input.w.providerId}
  `;
  check('post: still exactly one ledger row (no second `corrected`)', ledger === 1);
}

/** Case 52: a NULL-owned P′ counterpart gets exactly the foreign policy of cases 9/10. */
async function case52(ctx: CaseContext): Promise<void> {
  if (ctx.variant === 'pms-identical') await pmsC2Delete(ctx, 52, 'null_owned');
  else if (ctx.variant === 'pms-differing') await pmsC3Stop(ctx, 52, 'null_owned', 'kicks', 15);
  else if (ctx.variant === 'brownlow-zero') await brownlowC4Delete(ctx, 52, 'null_owned');
  else throw new RehearsalRefused('case 52 needs --variant pms-identical | pms-differing | brownlow-zero');
}

/* ==================================================================== *
 * Brownlow Family C (§12.1): 5, 6, 7, 8, 53, 54, 76, 78, 79, 83
 * ==================================================================== *
 *
 * Each case is `brownlowClosureRow` (its settle shape) plus named mutations, built as owner in one
 * transaction, then the real `recomputeBrownlowCoverage` (the settled baseline, proven a fixed
 * point). A COMMITTED case goes through `commitBrownlowMove`; a Q1 STOP through
 * `brownlowQ1Stop` (`expectQ1Stop` plus the stat_availability and projection parity). The evidence
 * source each case is ABOUT (payload, projection, chain, participation) is read back and asserted
 * present or absent before the CLI runs, never assumed from the builder.
 *
 * stat_availability: every Family-C scenario requires 2092 byte-identical. For a COMMITTED case
 * that is the CLI's own commit precondition (§8.2 step 8 throws inside the transaction otherwise,
 * `correct_afl_api_identity.ts` "stat_availability changed"), re-proven from outside; for a STOP,
 * nothing may be written at all.
 */

type BrownlowProjectionRow = { providerPlayerId: string; playerId: number | null; votes: number; matchId: number | null; versionSeq: number };

/** Every typed projection row of CD_M's exploded vote set. */
async function voteSetProjections(owner: Sql, w: World, providerMatchId: string): Promise<BrownlowProjectionRow[]> {
  return owner<BrownlowProjectionRow[]>`
    SELECT provider_player_id AS "providerPlayerId", player_id AS "playerId", votes::int AS votes,
           match_id AS "matchId", version_seq AS "versionSeq"
      FROM staging.afl_api_brownlow_vote
     WHERE source_id = ${w.sourceIds.aflApi} AND provider_match_id = ${providerMatchId}
     ORDER BY provider_player_id
  `;
}

/** The real B3 reader over one cited version of CD_M: CD_I's entry count and vote (-1 = unparseable). */
async function payloadProofAt(owner: Sql, w: World, closure: BrownlowClosureRow, versionSeq: number) {
  return citedPayloadVoterProof(await citedPayload(owner, w, closure.externalRecordId, versionSeq), closure.externalRecordId, w.providerId);
}

type ExpectedApp = { id: number; batchId: number; versionSeq: number; verb: string; previous: JsonValue; next: JsonValue };
const appShape = (a: AppRow): ExpectedApp => ({
  id: a.id, batchId: a.importBatchId, versionSeq: a.versionSeq, verb: a.verb, previous: a.previousValues, next: a.newValues,
});

/** The closure row's history at its key {2092, P, R}, id order, is exactly `expected`. */
async function checkBrownlowChain(ctx: CaseContext, closure: BrownlowClosureRow, label: string, expected: readonly ExpectedApp[]): Promise<AppRow[]> {
  const apps = await applicationsAt(ctx.owner, 'brownlow_round_votes', closure.naturalKey);
  ctx.check(`pre: the history at {2092, P, ${closure.match.roundNumber}} is exactly ${label}`,
    canonicalJson(apps.map(appShape) as unknown as JsonValue) === canonicalJson(expected as unknown as JsonValue)
      && apps.every((a) => a.sourceKey === 'afl_api' && a.family === 'brownlow_match_votes' && a.externalRecordId === closure.externalRecordId),
    JSON.stringify(apps.map(appShape)));
  return apps;
}

/** The closure row at (2092, P, R): afl_api-owned, stamped CD_M with `batchId`, contract =
 * `closure.values`; CD_I an importer row at P; the invariant holds. Returns CD_I's identity id. */
async function checkBrownlowClosurePre(ctx: CaseContext, w: World, closure: BrownlowClosureRow, batchId: number): Promise<number> {
  const { owner, check } = ctx;
  const row = (await rowsById(owner, 'brownlow_round_votes', [closure.rowId])).get(closure.rowId) ?? null;
  check(`pre: closure row brownlow_round_votes#${closure.rowId} at (2092, P, ${closure.match.roundNumber}): afl_api-owned, stamped CD_M, `
    + `import batch ${batchId}; {played, votes, match_id} = ${canonicalJson(closure.values)}`,
    row !== null && row.player_id === w.p.id && row.season === w.season && row.round_number === closure.match.roundNumber
      && row.source_id === w.sourceIds.aflApi && row.source_record_id === closure.externalRecordId && Number(row.import_batch_id) === batchId
      && canonicalJson({ played: row.played, votes: row.votes, match_id: row.match_id }) === canonicalJson(closure.values),
    JSON.stringify(row));
  const identity = await identityOf(owner, w);
  check('pre: CD_I is an importer row at P (unique, afl_api_stat_vector_bootstrap)',
    identity?.player_id === w.p.id && identity.status === 'unique' && identity.match_method === 'afl_api_stat_vector_bootstrap');
  await owner.begin('read only', (tx) => assertAflApiIdentityInvariant(tx));
  check('pre: the combined identity invariant holds with the fixture in place', true);
  return Number(identity?.id);
}

/** The settled 2092 coverage, proven a fixed point of the real `recomputeBrownlowCoverage`. */
async function settledBaseline(ctx: CaseContext, w: World): Promise<Hashed> {
  const sa = await statAvailabilityOf(ctx.owner, w.season);
  const fixedPoint = await coverageFixedPoint(ctx.owner, w.season);
  console.log(`  stat_availability 2092 baseline (${sa.rows.length} row(s), sha256 ${sa.sha256})`);
  ctx.check('baseline: the settled 2092 coverage is a fixed point of the real recomputeBrownlowCoverage (rolled-back re-run byte-identical)',
    fixedPoint.before.sha256 === sa.sha256 && fixedPoint.after.sha256 === sa.sha256, `${fixedPoint.before.sha256} -> ${fixedPoint.after.sha256}`);
  return sa;
}

async function participationAt(owner: Sql, playerId: number, matchIds: readonly number[]): Promise<number[]> {
  const rows = await owner<{ matchId: number }[]>`
    SELECT match_id AS "matchId" FROM player_match_stats WHERE player_id = ${playerId} AND match_id = ANY(${[...matchIds]}) ORDER BY match_id
  `;
  return rows.map((r) => r.matchId);
}

/** Build `world(caseNumber)` + `build`, then the settled derived rows and Brownlow coverage, in one owner transaction. */
async function buildBrownlow<T extends { closure: BrownlowClosureRow }>(
  ctx: CaseContext, caseNumber: number, build: (tx: TransactionSql, w: World) => Promise<T>,
): Promise<T & { w: World }> {
  const built = await ctx.owner.begin(async (tx) => {
    const w = await world(tx, caseNumber);
    const extra = await build(tx, w);
    await settleDerived(tx, w, { brownlow: true });
    return { ...extra, w };
  }) as unknown as T & { w: World };
  const { w, closure } = built;
  console.log(`  fixture: P=${w.p.id} (${w.p.path}), P'=${w.pPrime.id} (${w.pPrime.path}), provider ${w.providerId}, `
    + `match M=${closure.match.id} (${closure.externalRecordId}, round ${closure.match.roundNumber}), closure row brownlow_round_votes#${closure.rowId} `
    + `${canonicalJson(closure.values)}, companions ${closure.companions.map((c) => `${c.role} ${c.providerId}->player ${c.playerId} #${c.rowId} (${c.votes})`).join(', ')}, `
    + `settle batch ${w.settleBatchId}, actor ${w.actorId}`);
  return built;
}

type BrownlowMoveSpec = {
  w: World; closure: BrownlowClosureRow; identityId: number; saBaseline: Hashed;
  /** The version the latest non-correction application at the key cites: the correction cites it too. */
  citedVersionSeq: number;
  /** Fixture rows the correction must leave byte-identical. */
  keepBrownlow: readonly number[]; keepPms: readonly number[];
  /** CD_I's Brownlow projection names P (true), or the case removed it (false). */
  hasProjection: boolean;
  /** A paired `player_match_stats` closure row of CD_I at M, moved by the same correction (case 83). */
  pairedPms?: PmsClosureRow;
};

/**
 * A COMMITTED Family-C MOVE, proven: the real CLI (validate-only, apply with that fingerprint),
 * then the same row id at P′ with every other column byte-identical, the kept rows byte-identical,
 * the old key's history immutable, exactly one bound correction application per moved row at its
 * new key citing `citedVersionSeq`, the ledger row and identity, batch K, the projections (CD_I's
 * names P′, or stays absent), stat_availability byte-identical, the derived rows, the census delta.
 */
async function commitBrownlowMove(ctx: CaseContext, s: BrownlowMoveSpec): Promise<Corrected> {
  const { owner, check } = ctx;
  const { w, closure } = s;
  const paired = s.pairedPms !== undefined;
  const n = paired ? 2 : 1;
  const rowBefore = (await rowsById(owner, 'brownlow_round_votes', [closure.rowId])).get(closure.rowId) ?? null;
  const keptBrownlowBefore = await rowsById(owner, 'brownlow_round_votes', s.keepBrownlow);
  const keptPmsBefore = await rowsById(owner, 'player_match_stats', s.keepPms);
  const projectionsBefore = await voteSetProjections(owner, w, closure.externalRecordId);
  const oldKeyBefore = await applicationsAt(owner, 'brownlow_round_votes', closure.naturalKey);
  const derivedBefore = await derivedOf(owner, [w.p.id, w.pPrime.id]);
  const censusBefore = await readResidue(owner);

  const c = await correct(ctx, w, { rowsPlanned: n, moved: n, deleted: 0 });

  const rowAfter = (await rowsById(owner, 'brownlow_round_votes', [closure.rowId])).get(closure.rowId) ?? null;
  const withoutPlayer = (row: RowSnapshot | null) => (row === null ? null : canonicalJson({ ...row, player_id: null }));
  check('post: the SAME brownlow_round_votes row id now sits at (2092, P′, R); every other column byte-identical (MOVE changes player_id only)',
    rowAfter !== null && rowAfter.player_id === w.pPrime.id && withoutPlayer(rowAfter) === withoutPlayer(rowBefore), JSON.stringify(rowAfter));
  const keptBrownlowAfter = await rowsById(owner, 'brownlow_round_votes', s.keepBrownlow);
  const keptPmsAfter = await rowsById(owner, 'player_match_stats', s.keepPms);
  check(`post: the ${s.keepBrownlow.length} other fixture brownlow row(s) and ${s.keepPms.length} kept player_match_stats row(s) are byte-identical`,
    s.keepBrownlow.every((id) => canonicalJson(keptBrownlowAfter.get(id) ?? null) === canonicalJson(keptBrownlowBefore.get(id) ?? null))
      && s.keepPms.every((id) => canonicalJson(keptPmsAfter.get(id) ?? null) === canonicalJson(keptPmsBefore.get(id) ?? null)));
  const oldKeyAfter = await applicationsAt(owner, 'brownlow_round_votes', closure.naturalKey);
  check('post: the old key\'s history is immutable (the same applications, byte-identical)',
    canonicalJson(oldKeyAfter.map(appShape) as unknown as JsonValue) === canonicalJson(oldKeyBefore.map(appShape) as unknown as JsonValue));
  const newKey = { ...closure.naturalKey, player_id: w.pPrime.id };
  const atNewKey = await applicationsAt(owner, 'brownlow_round_votes', newKey);
  const move = atNewKey[0];
  check(`post: exactly one correction application at {2092, P′, R}: update {player_id: P} -> {player_id: P′}, batch K, citing CD_M version ${s.citedVersionSeq}`,
    atNewKey.length === 1 && move.verb === 'update' && move.importBatchId === c.r.batchId && move.family === closure.family
      && move.externalRecordId === closure.externalRecordId && move.versionSeq === s.citedVersionSeq
      && canonicalJson(move.previousValues) === canonicalJson({ player_id: w.p.id })
      && canonicalJson(move.newValues) === canonicalJson({ player_id: w.pPrime.id }), JSON.stringify(atNewKey));
  if (s.pairedPms) {
    const pms = s.pairedPms;
    const pmsAfter = await pmsRow(owner, pms.rowId);
    check('post: the paired player_match_stats closure row (same id) now sits at (P′, M) with a byte-identical contract',
      pmsAfter !== null && pmsAfter.player_id === w.pPrime.id && pmsAfter.match_id === pms.matchId
        && rowContractHash(contractOf(pmsAfter)) === pms.contractSha256);
    const pmsApps = await applicationsAt(owner, 'player_match_stats', { player_id: w.pPrime.id, match_id: pms.matchId });
    check('post: exactly one pms correction application at (P′, M), batch K, update {player_id: P} -> {player_id: P′}',
      pmsApps.length === 1 && pmsApps[0].verb === 'update' && pmsApps[0].importBatchId === c.r.batchId
        && canonicalJson(pmsApps[0].newValues) === canonicalJson({ player_id: w.pPrime.id }), JSON.stringify(pmsApps));
  }

  await checkLedgerAndIdentity(ctx, w, s.identityId, c);

  const [batch] = await owner<{ tool: string; status: string; vr: Record<string, JsonValue> }[]>`
    SELECT tool, status::text AS status, validation_result AS vr FROM import_batches WHERE id = ${c.r.batchId}
  `;
  const proofs = (batch?.vr.rowProofs ?? []) as Record<string, JsonValue>[];
  const brvProof = proofs.find((p) => p.table === 'brownlow_round_votes');
  const pmsProof = proofs.find((p) => p.table === 'player_match_stats');
  check(`post: batch K completed and bound (adjudication, fingerprint, evidence hash); ${n} rowProof(s): the brownlow update with the pre-correction contract hash`
    + `${paired ? ' and the paired pms update' : ''}`,
    batch?.tool === R.correctionTool && batch.status === 'completed' && batch.vr.kind === 'afl_api_identity_correction'
      && batch.vr.mode === 'original' && batch.vr.adjudicationId === c.r.adjudicationId && batch.vr.externalId === w.providerId
      && batch.vr.closureFingerprint === c.fingerprint && batch.vr.adjudicationEvidenceSha256 === c.evidenceSha256
      && proofs.length === n && brvProof?.verb === 'update' && canonicalJson(brvProof.oldKey) === canonicalJson(closure.naturalKey)
      && canonicalJson(brvProof.newKey) === canonicalJson(newKey) && brvProof.preCorrectionContractSha256 === closure.contractSha256
      && (!paired || (pmsProof?.verb === 'update' && pmsProof.preCorrectionContractSha256 === s.pairedPms!.contractSha256)),
    JSON.stringify(proofs));
  const counts = batch?.vr.counts as { moved?: Record<string, number>; deleted?: Record<string, number>; projectionsMoved?: number } | undefined;
  const projectionsMoved = (s.hasProjection ? 1 : 0) + (paired ? 1 : 0);
  check(`post: batch counts: moved brownlow 1 / pms ${paired ? 1 : 0}, deleted 0/0, projections moved ${projectionsMoved}`,
    counts?.moved?.brownlow_round_votes === 1 && counts.moved.player_match_stats === (paired ? 1 : 0)
      && counts.deleted?.brownlow_round_votes === 0 && counts.deleted.player_match_stats === 0 && counts.projectionsMoved === projectionsMoved,
    JSON.stringify(counts));

  const projectionsAfter = await voteSetProjections(owner, w, closure.externalRecordId);
  const expectedProjections = projectionsBefore.map((p) => (p.providerPlayerId === w.providerId ? { ...p, playerId: w.pPrime.id } : p));
  check(s.hasProjection
    ? 'post: CD_I\'s Brownlow projection names P′ (SAT-5); every other projection row of the vote set byte-identical'
    : 'post: CD_I still has no Brownlow projection (none manufactured); every other projection row of the vote set byte-identical',
    canonicalJson(projectionsAfter as unknown as JsonValue) === canonicalJson(expectedProjections as unknown as JsonValue)
      && projectionsAfter.some((p) => p.providerPlayerId === w.providerId) === s.hasProjection, JSON.stringify(projectionsAfter));

  const saAfter = await statAvailabilityOf(owner, w.season);
  check('post: stat_availability for 2092 is byte-identical to the settled baseline (sorted to_jsonb, SHA-256)',
    saAfter.sha256 === s.saBaseline.sha256, `${s.saBaseline.sha256} -> ${saAfter.sha256}`);
  if (paired) {
    const games = await gamesOf(owner, w);
    check('post: targeted recompute: P has no 2092 season row and 0 career games; P′ has 1 game in 2092 and in career (the paired pms MOVE)',
      games.p?.season === null && games.p.career === 0 && games.pPrime?.season === 1 && games.pPrime.career === 1, JSON.stringify(games));
  } else {
    const derivedAfter = await derivedOf(owner, [w.p.id, w.pPrime.id]);
    check('post: P and P′ derived rows (season, club-season, career, clubs) byte-identical: a Brownlow-only MOVE moves no game',
      derivedAfter.sha256 === derivedBefore.sha256, `${derivedBefore.rows.length} -> ${derivedAfter.rows.length} row(s)`);
  }
  const censusAfter = await readResidue(owner);
  const delta = Object.fromEntries(Object.keys(censusAfter)
    .filter((t) => censusAfter[t] !== censusBefore[t]).map((t) => [t, censusAfter[t] - censusBefore[t]]));
  check(`post: fixture census changed by exactly the correction's own rows (+${n} application(s), +1 ledger row, +1 batch)`,
    canonicalJson(delta) === canonicalJson({ afl_api_identity_adjudications: 1, canonical_applications: n, import_batches: 1 }), JSON.stringify(delta));
  await owner.begin('read only', (tx) => assertAflApiIdentityInvariant(tx));
  check('post: the combined identity invariant (SAT-1 basis) holds', true);
  return c;
}

/** A Family-C Q1 STOP: `expectQ1Stop`, then 2092's stat_availability and CD_M's projections unchanged. */
async function brownlowQ1Stop(
  ctx: CaseContext, w: World, closure: BrownlowClosureRow, saBaseline: Hashed, expected: ExpectedStop,
  protect: readonly { table: ClosureTable; id: number }[],
): Promise<void> {
  const projectionsBefore = await voteSetProjections(ctx.owner, w, closure.externalRecordId);
  await expectQ1Stop(ctx, w, expected, { protect });
  const saAfter = await statAvailabilityOf(ctx.owner, w.season);
  ctx.check('post: stat_availability for 2092 byte-identical to the settled baseline (a STOP writes nothing)',
    saAfter.sha256 === saBaseline.sha256, `${saBaseline.sha256} -> ${saAfter.sha256}`);
  ctx.check('post: CD_M\'s projection rows byte-identical',
    canonicalJson(await voteSetProjections(ctx.owner, w, closure.externalRecordId) as unknown as JsonValue)
      === canonicalJson(projectionsBefore as unknown as JsonValue));
}

const brownlowRows = (closure: BrownlowClosureRow) => [
  { table: 'brownlow_round_votes' as const, id: closure.rowId },
  ...closure.companions.map((c) => ({ table: 'brownlow_round_votes' as const, id: c.rowId })),
];
const pmsRows = (...ids: number[]) => ids.map((id) => ({ table: 'player_match_stats' as const, id }));
const insertOf = (closure: BrownlowClosureRow, batchId: number): ExpectedApp => ({
  id: closure.insertApplicationId, batchId, versionSeq: 1, verb: 'insert', previous: null,
  next: closure.values.match_id === null
    ? { played: closure.values.played, votes: 3 } : { played: closure.values.played, votes: 3, match_id: closure.values.match_id },
});

/* ---- Case 5 ---- */

/** Case 5: the safe Brownlow closure move (B1-B5, no counterpart, C1c via a foreign P′ row) -> MOVE. */
async function case5(ctx: CaseContext): Promise<void> {
  await safeBrownlowMove(ctx, 5);
}

/* ---- Case 6 ---- */

/**
 * Case 6: I244-F002 demotion lineage -- inserted through CD_I with 3, later demoted to 0 by a
 * settle whose cited payload has no CD_I entry (the real `demoteToZero` chain) -> B3-C case 2
 * accepted; the reconstructed (and final) vote is 0; the row is in the closure and MOVEs.
 */
async function case6(ctx: CaseContext): Promise<void> {
  const { owner, check } = ctx;
  const fx = await buildBrownlow(ctx, 6, async (tx, w) => {
    const closure = await demoteToZero(tx, w, await brownlowClosureRow(tx, w, 1));
    return { closure, participationRowId: await participation(tx, w, w.pPrime.id, closure.match.id) };
  });
  const { w, closure } = fx;
  const d = closure.demotion;
  const identityId = await checkBrownlowClosurePre(ctx, w, closure, d.batchId);
  await checkBrownlowChain(ctx, closure, '[insert v1 {played, votes 3, match_id M} (settle batch), update v2 {votes: 3} -> {votes: 0} (B2)]', [
    insertOf({ ...closure, values: { ...closure.values, votes: 3 } }, w.settleBatchId),
    { id: d.applicationId, batchId: d.batchId, versionSeq: 2, verb: 'update', previous: { votes: 3 }, next: { votes: 0 } },
  ]);
  const v1 = await payloadProofAt(owner, w, closure, 1);
  const v2 = await payloadProofAt(owner, w, closure, 2);
  const v2Voters = extractBrownlowVoterEntries(await citedPayload(owner, w, closure.externalRecordId, 2), closure.externalRecordId);
  check('pre: the insert\'s payload (v1) names CD_I once with 3 (B3-I); the demotion\'s payload (v2, real extractor) is a parseable 3/2/1 set WITHOUT CD_I',
    v1.count === 1 && v1.vote === 3 && v2.count === 0 && v2Voters !== null && v2Voters.map((v) => v.votes).sort().join(',') === '1,2,3',
    JSON.stringify({ v1, v2, v2Voters }));
  const projections = await voteSetProjections(owner, w, closure.externalRecordId);
  check('pre: CD_I\'s projection is its stale version-1 row naming P (a departed recipient is not re-projected)',
    projections.some((p) => p.providerPlayerId === w.providerId && p.playerId === w.p.id && p.versionSeq === 1), JSON.stringify(projections));
  check('pre: P′ participates in M through a foreign afltables row (C1c)',
    canonicalJson(await participationAt(owner, w.pPrime.id, [closure.match.id])) === canonicalJson([closure.match.id]));
  const saBaseline = await settledBaseline(ctx, w);
  await commitBrownlowMove(ctx, {
    w, closure, identityId, saBaseline, citedVersionSeq: 2, hasProjection: true,
    keepBrownlow: [...closure.companions.map((c) => c.rowId), d.newVoter.rowId], keepPms: [fx.participationRowId],
  });
  const [final] = await owner<{ votes: number | null; playerId: number }[]>`
    SELECT votes::int AS votes, player_id AS "playerId" FROM brownlow_round_votes WHERE id = ${closure.rowId}
  `;
  check('post: the final vote at P′ is 0, the F002 demotion\'s value (never re-promoted, never NULL)', final?.votes === 0 && final.playerId === w.pPrime.id, JSON.stringify(final));
}

/* ---- Cases 7 and 8 ---- */

/**
 * Case 7: no typed projection for CD_I, the insert's cited payload intact -> B3-I proven through the
 * payload alone; in the closure; MOVE. Only CD_I's projection row is removed (`withoutClosureProjection`).
 */
async function case7(ctx: CaseContext): Promise<void> {
  const { owner, check } = ctx;
  const fx = await buildBrownlow(ctx, 7, async (tx, w) => {
    const closure = await brownlowClosureRow(tx, w, 1);
    await withoutClosureProjection(tx, w, closure);
    return { closure, participationRowId: await participation(tx, w, w.pPrime.id, closure.match.id) };
  });
  const { w, closure } = fx;
  const identityId = await checkBrownlowClosurePre(ctx, w, closure, w.settleBatchId);
  await checkBrownlowChain(ctx, closure, '[insert v1 {played, votes 3, match_id M}] (no later application)', [insertOf(closure, w.settleBatchId)]);
  const projections = await voteSetProjections(owner, w, closure.externalRecordId);
  check('pre: CD_I has NO typed projection; both companions\' projections are present, each naming its own player',
    !projections.some((p) => p.providerPlayerId === w.providerId) && projections.length === 2
      && closure.companions.every((c) => projections.some((p) => p.providerPlayerId === c.providerId && p.playerId === c.playerId)),
    JSON.stringify(projections));
  const proof = await payloadProofAt(owner, w, closure, 1);
  check('pre: the insert\'s cited payload (v1) is present, parses (real extractor) and names CD_I exactly once with the inserted 3 (B3-I by payload)',
    proof.count === 1 && proof.vote === 3, JSON.stringify(proof));
  check('pre: P′ participates in M through a foreign afltables row (C1c)',
    canonicalJson(await participationAt(owner, w.pPrime.id, [closure.match.id])) === canonicalJson([closure.match.id]));
  const saBaseline = await settledBaseline(ctx, w);
  await commitBrownlowMove(ctx, {
    w, closure, identityId, saBaseline, citedVersionSeq: 1, hasProjection: false,
    keepBrownlow: closure.companions.map((c) => c.rowId), keepPms: [fx.participationRowId],
  });
}

/**
 * Case 8: case 7's topology (no projection) with the insert's cited payload UNPARSEABLE -> STOP
 * `brownlow_insert_unproven` (B3-I). Variants: `malformed-entry` (CD_I's entry votes "3"),
 * `other-record` (the payload names another provider match). An ABSENT payload cannot be built:
 * the insert application's version row and that row's payload are both foreign keys.
 */
async function case8(ctx: CaseContext): Promise<void> {
  const { owner, check, variant } = ctx;
  if (variant !== 'malformed-entry' && variant !== 'other-record') throw new RehearsalRefused('case 8 needs --variant malformed-entry | other-record');
  const fx = await buildBrownlow(ctx, 8, async (tx, w) => {
    const closure = await brownlowClosureRow(tx, w, 1);
    await withoutClosureProjection(tx, w, closure);
    const hashes = await corruptInsertPayload(tx, w, closure, variant);
    return { closure, hashes, participationRowId: await participation(tx, w, w.pPrime.id, closure.match.id) };
  });
  const { w, closure } = fx;
  await checkBrownlowClosurePre(ctx, w, closure, w.settleBatchId);
  await checkBrownlowChain(ctx, closure, '[insert v1 {played, votes 3, match_id M}] (no later application)', [insertOf(closure, w.settleBatchId)]);
  const projections = await voteSetProjections(owner, w, closure.externalRecordId);
  check('pre: CD_I has NO typed projection (as case 7); both companions\' projections are present',
    !projections.some((p) => p.providerPlayerId === w.providerId) && projections.length === 2, JSON.stringify(projections));
  const [version] = await owner<{ payloadHash: string; payloadRows: number }[]>`
    SELECT v.payload_hash AS "payloadHash",
           (SELECT count(*)::int FROM staging.source_payloads p WHERE p.source_id = v.source_id AND p.family = v.family AND p.payload_hash = v.payload_hash) AS "payloadRows"
      FROM staging.source_record_versions v
     WHERE v.source_id = ${w.sourceIds.aflApi} AND v.family = 'brownlow_match_votes' AND v.external_record_id = ${closure.externalRecordId} AND v.version_seq = 1
  `;
  check(`pre: the version the insert cites (v1) EXISTS and its payload row EXISTS, now the ${variant} payload (the only change from case 7)`,
    version?.payloadHash === fx.hashes.defectiveHash && version.payloadRows === 1 && fx.hashes.defectiveHash !== fx.hashes.originalHash, JSON.stringify(version));
  const payload = await citedPayload(owner, w, closure.externalRecordId, 1);
  const proof = citedPayloadVoterProof(payload, closure.externalRecordId, w.providerId);
  check('pre: the real extractor finds that payload UNPARSEABLE (count -1: never "no CD_I entry")',
    proof.count === -1 && extractBrownlowVoterEntries(payload, closure.externalRecordId) === null, JSON.stringify(proof));
  check('pre: P′ participates in M (C1c would pass: the STOP is B3-I\'s alone)',
    canonicalJson(await participationAt(owner, w.pPrime.id, [closure.match.id])) === canonicalJson([closure.match.id]));
  const saBaseline = await settledBaseline(ctx, w);
  await brownlowQ1Stop(ctx, w, closure, saBaseline, {
    table: 'brownlow_round_votes', rowId: closure.rowId, step: 'B3-I', code: 'brownlow_insert_unproven',
    detail: 'no projection and no parseable insert payload evidence',
  }, [...brownlowRows(closure), ...pmsRows(fx.participationRowId)]);
}

/* ---- Cases 53 and 54 ---- */

/**
 * Case 53 (pass-3 #10): a Brownlow collision with a positive vote on either side -> STOP C5.
 *   - `source-positive`: the closure row holds 3 (case 5's row); P′'s foreign counterpart holds 0 at M.
 *   - `counterpart-positive`: the closure row is demoted to 0 (`demoteToZero`); P′'s foreign
 *     counterpart holds 2. M's three positive slots are held by V4/V2/V3
 *     (`ux_brownlow_round_votes_match_value`), so the positive counterpart is the round row an AFL
 *     Tables round-grain import left unresolved (`match_id` NULL): C5 refuses before C6 compares match_id.
 * Both: P′ participates in M (C1c passes), the counterpart is foreign (not C7).
 */
async function case53(ctx: CaseContext): Promise<void> {
  const { owner, check, variant } = ctx;
  if (variant !== 'source-positive' && variant !== 'counterpart-positive') {
    throw new RehearsalRefused('case 53 needs --variant source-positive | counterpart-positive');
  }
  const fx = await buildBrownlow(ctx, 53, async (tx, w) => {
    const base = await brownlowClosureRow(tx, w, 1);
    const closure = variant === 'source-positive' ? base : await demoteToZero(tx, w, base);
    const participationRowId = await participation(tx, w, w.pPrime.id, closure.match.id);
    const counterpartId = await brownlowCounterpart(tx, w, closure.match, 'foreign', variant === 'source-positive'
      ? { played: true, votes: 0, match_id: closure.match.id } : { played: true, votes: 2, match_id: null });
    return { closure, participationRowId, counterpartId };
  });
  const { w, closure } = fx;
  const batchId = variant === 'source-positive' ? w.settleBatchId : (closure as DemotedBrownlowClosureRow).demotion.batchId;
  await checkBrownlowClosurePre(ctx, w, closure, batchId);
  const counterpart = (await rowsById(owner, 'brownlow_round_votes', [fx.counterpartId])).get(fx.counterpartId) ?? null;
  const [{ ownerKey }] = await owner<{ ownerKey: string | null }[]>`
    SELECT s.key AS "ownerKey" FROM brownlow_round_votes x LEFT JOIN sources s ON s.id = x.source_id WHERE x.id = ${fx.counterpartId}
  `;
  const positive = (v: JsonValue) => typeof v === 'number' && v > 0;
  check(variant === 'source-positive'
    ? 'pre: the POSITIVE side is the closure row (votes 3); P′\'s counterpart at (2092, P′, 1) is afltables-owned, no stamps, votes 0, played, match_id M'
    : 'pre: the POSITIVE side is P′\'s counterpart (afltables-owned, no stamps, votes 2, played, match_id NULL); the closure row holds 0 (F002)',
    counterpart !== null && counterpart.player_id === w.pPrime.id && counterpart.round_number === closure.match.roundNumber
      && ownerKey === 'afltables' && counterpart.source_record_id === null && counterpart.import_batch_id === null
      && (variant === 'source-positive'
        ? closure.values.votes === 3 && counterpart.votes === 0 && counterpart.match_id === closure.match.id
        : closure.values.votes === 0 && positive(counterpart.votes) && counterpart.match_id === null),
    JSON.stringify({ closure: closure.values, counterpart }));
  check('pre: exactly one side is positive (C5\'s trigger), and P′ participates in M (C1c passes)',
    [closure.values.votes, counterpart?.votes ?? null].filter(positive).length === 1
      && canonicalJson(await participationAt(owner, w.pPrime.id, [closure.match.id])) === canonicalJson([closure.match.id]));
  const saBaseline = await settledBaseline(ctx, w);
  const others = variant === 'source-positive' ? [] : [(closure as DemotedBrownlowClosureRow).demotion.newVoter.rowId];
  await brownlowQ1Stop(ctx, w, closure, saBaseline, {
    table: 'brownlow_round_votes', rowId: closure.rowId, step: 'C5', code: 'collision_values_disagree',
    detail: 'a positive-vote or NULL-vote destructive collision is refused',
  }, [...brownlowRows(closure), { table: 'brownlow_round_votes', id: fx.counterpartId },
    ...others.map((id) => ({ table: 'brownlow_round_votes' as const, id })), ...pmsRows(fx.participationRowId)]);
}

/**
 * Case 54: the admin resolve step set `match_id` on an AFL API-owned round row -> STOP
 * `out_of_ledger_edit` naming `match_id` (B5) alone. The vote set was settled pre-F007 with M
 * unresolved (insert `{played, votes}`, `match_id` NULL); P plays M through an AFL Tables row, which
 * is what the resolve step's predicate joins on; `adminResolveStep` then attaches M to P's row only
 * (the companions have no line-up row), provenance untouched, no application. P′ participates in M,
 * so without the edit the row would MOVE (round event (2092, 1) = {M}, P′ in M).
 */
async function case54(ctx: CaseContext): Promise<void> {
  const { owner, check } = ctx;
  const fx = await buildBrownlow(ctx, 54, async (tx, w) => {
    const settled = await brownlowClosureRow(tx, w, 1, { matchIdAtSettle: 'unresolved' });
    const pLineupRowId = await participation(tx, w, w.p.id, settled.match.id);
    const participationRowId = await participation(tx, w, w.pPrime.id, settled.match.id);
    const resolvedIds = await adminResolveStep(tx, { ...settled.match, season: w.season });
    const closure: BrownlowClosureRow = { ...settled, values: { ...settled.values, match_id: settled.match.id } };
    return { closure, settledValues: settled.values, pLineupRowId, participationRowId, resolvedIds };
  });
  const { w, closure } = fx;
  await checkBrownlowClosurePre(ctx, w, closure, w.settleBatchId);
  check('pre: the admin resolve step resolved exactly one row, the closure row (the companions have no line-up row at M)',
    canonicalJson(fx.resolvedIds) === canonicalJson([closure.rowId]), JSON.stringify(fx.resolvedIds));
  await checkBrownlowChain(ctx, closure, '[insert v1 {played, votes 3} (pre-F007: no match_id)] (no later application)',
    [insertOf({ ...closure, values: fx.settledValues }, w.settleBatchId)]);
  const companions = await rowsById(owner, 'brownlow_round_votes', closure.companions.map((c) => c.rowId));
  check('pre: reconstruction from the history gives match_id NULL; the row now holds M; played and votes equal their reconstruction (only match_id differs)',
    fx.settledValues.match_id === null && closure.values.match_id === closure.match.id
      && closure.values.played === fx.settledValues.played && closure.values.votes === fx.settledValues.votes
      && [...companions.values()].every((c) => c.match_id === null), JSON.stringify(fx.settledValues));
  const proof = await payloadProofAt(owner, w, closure, 1);
  check('pre: B3-I holds (payload names CD_I once with 3); CD_I\'s projection names P',
    proof.count === 1 && proof.vote === 3
      && (await voteSetProjections(owner, w, closure.externalRecordId)).some((p) => p.providerPlayerId === w.providerId && p.playerId === w.p.id));
  const [lineup] = await owner<{ ownerKey: string }[]>`
    SELECT s.key AS "ownerKey" FROM player_match_stats x JOIN sources s ON s.id = x.source_id WHERE x.id = ${fx.pLineupRowId}
  `;
  check('pre: P\'s line-up row at M is afltables-owned (C11 foreign, not a closure row); P′ participates in M',
    lineup?.ownerKey === 'afltables' && canonicalJson(await participationAt(owner, w.pPrime.id, [closure.match.id])) === canonicalJson([closure.match.id]));
  const saBaseline = await settledBaseline(ctx, w);
  await brownlowQ1Stop(ctx, w, closure, saBaseline, {
    table: 'brownlow_round_votes', rowId: closure.rowId, step: 'B5', code: 'out_of_ledger_edit',
    detail: 'field(s) differ from reconstruction: match_id',
  }, [...brownlowRows(closure), ...pmsRows(fx.pLineupRowId, fx.participationRowId)]);
}

/* ---- Case 76 ---- */

/**
 * Case 76: I244-F007 release -> claim. Adjacent r/q at CD_I's key in one batch (B2) citing one
 * source version (v2) whose payload names CD_I once (with 2) -> B3-C case 3 accepted; the
 * reconstructed vote is the claim (2); in the closure; not a second provider; MOVE.
 */
async function case76(ctx: CaseContext): Promise<void> {
  const { owner, check } = ctx;
  const fx = await buildBrownlow(ctx, 76, async (tx, w) => {
    const closure = await releaseAndClaim(tx, w, await brownlowClosureRow(tx, w, 1));
    return { closure, participationRowId: await participation(tx, w, w.pPrime.id, closure.match.id) };
  });
  const { w, closure } = fx;
  const rc = closure.releaseClaim;
  const identityId = await checkBrownlowClosurePre(ctx, w, closure, rc.batchId);
  const apps = await checkBrownlowChain(ctx, closure, '[insert v1 (3), release v2 {votes: 3} -> {votes: 0} (B2), claim v2 {votes: 0} -> {votes: 2} (B2)]', [
    insertOf({ ...closure, values: { ...closure.values, votes: 3 } }, w.settleBatchId),
    { id: rc.releaseApplicationId, batchId: rc.batchId, versionSeq: 2, verb: 'update', previous: { votes: 3 }, next: { votes: 0 } },
    { id: rc.claimApplicationId, batchId: rc.batchId, versionSeq: 2, verb: 'update', previous: { votes: 0 }, next: { votes: 2 } },
  ]);
  check('pre: release and claim are ADJACENT in the key\'s history, in that order, in ONE batch citing ONE version',
    apps.length === 3 && apps[1].id === rc.releaseApplicationId && apps[2].id === rc.claimApplicationId
      && apps[1].importBatchId === apps[2].importBatchId && apps[1].versionSeq === apps[2].versionSeq && apps[1].id < apps[2].id);
  const v1 = await payloadProofAt(owner, w, closure, 1);
  const v2 = await payloadProofAt(owner, w, closure, 2);
  check('pre: v1 names CD_I once with 3 (B3-I); v2 names CD_I exactly once with the claimed 2 (so the pair is one transition, not a demotion)',
    v1.count === 1 && v1.vote === 3 && v2.count === 1 && v2.vote === 2, JSON.stringify({ v1, v2 }));
  const [v2Voter, v3Voter] = closure.companions;
  const companionApps = await applicationsAt(owner, 'brownlow_round_votes', { season: w.season, player_id: v2Voter.playerId, round_number: closure.match.roundNumber });
  const companionRows = await rowsById(owner, 'brownlow_round_votes', [v2Voter.rowId, v3Voter.rowId]);
  check('pre: the permutation\'s other half: V2 released 2 -> 0 then claimed 0 -> 3 in B2; V2 holds 3 and V3 still 1',
    companionApps.map((a) => a.id).join(',') === [v2Voter.applicationId, rc.companionReleaseApplicationId, rc.companionClaimApplicationId].join(',')
      && companionRows.get(v2Voter.rowId)?.votes === 3 && companionRows.get(v3Voter.rowId)?.votes === 1);
  const projections = await voteSetProjections(owner, w, closure.externalRecordId);
  check('pre: projections at v2: CD_I 2 naming P, V2 3, V3 1',
    canonicalJson(projections.map((p) => [p.providerPlayerId, p.playerId, p.votes, p.versionSeq]) as JsonValue)
      === canonicalJson([[w.providerId, w.p.id, 2, 2], [v2Voter.providerId, v2Voter.playerId, 3, 2], [v3Voter.providerId, v3Voter.playerId, 1, 2]] as JsonValue),
    JSON.stringify(projections));
  check('pre: P′ participates in M through a foreign afltables row (C1c)',
    canonicalJson(await participationAt(owner, w.pPrime.id, [closure.match.id])) === canonicalJson([closure.match.id]));
  const identitiesBefore = await owner<{ externalId: string; playerId: number; status: string }[]>`
    SELECT external_id AS "externalId", player_id AS "playerId", status::text AS status FROM external_identities
     WHERE source_id = ${w.sourceIds.aflApi} AND external_id = ANY(${[v2Voter.providerId, v3Voter.providerId]}) ORDER BY external_id
  `;
  const saBaseline = await settledBaseline(ctx, w);
  await commitBrownlowMove(ctx, {
    w, closure, identityId, saBaseline, citedVersionSeq: 2, hasProjection: true,
    keepBrownlow: closure.companions.map((c) => c.rowId), keepPms: [fx.participationRowId],
  });
  const [final] = await owner<{ votes: number | null; playerId: number }[]>`
    SELECT votes::int AS votes, player_id AS "playerId" FROM brownlow_round_votes WHERE id = ${closure.rowId}
  `;
  check('post: the final vote at P′ is the claim (2)', final?.votes === rc.claimedVotes && final.playerId === w.pPrime.id, JSON.stringify(final));
  const identitiesAfter = await owner<{ externalId: string; playerId: number; status: string }[]>`
    SELECT external_id AS "externalId", player_id AS "playerId", status::text AS status FROM external_identities
     WHERE source_id = ${w.sourceIds.aflApi} AND external_id = ANY(${[v2Voter.providerId, v3Voter.providerId]}) ORDER BY external_id
  `;
  const [{ ledger }] = await owner<{ ledger: number }[]>`
    SELECT count(*)::int AS ledger FROM afl_api_identity_adjudications WHERE external_id LIKE ${`${R.providerPrefix}${w.caseCode}%`}
  `;
  check('post: not a second provider: exactly one ledger row in the case namespace (CD_I\'s), the other voters\' identities unchanged',
    ledger === 1 && canonicalJson(identitiesAfter) === canonicalJson(identitiesBefore), JSON.stringify({ ledger, identitiesAfter }));
}

/* ---- Cases 78 and 79 ---- */

/**
 * Cases 78 and 79: an I244-F002 demotion whose `new_values` carries a second FR field beside
 * `votes: 0` (`demoteToZero`'s changed-field diff):
 *   - 78, `{votes: 0, match_id: m}`: the vote set was settled pre-F007 with M unresolved (the
 *     insert `{played, votes}`, `match_id` NULL); the demotion heals NULL -> M, and m equals its
 *     siblings' (V4's insert, V2/V3's bare heals in the same batch and version);
 *   - 79, `{votes: 0, played: true}`: CD_I's inserted row was not `played`; the demotion raises it.
 * Both: accepted (B3-C case 2, FR) and in the closure; the row MOVEs.
 */
async function demotionWithFieldRule(ctx: CaseContext, caseNumber: 78 | 79): Promise<void> {
  const { owner, check } = ctx;
  const shape: BrownlowSettleShape = caseNumber === 78 ? { matchIdAtSettle: 'unresolved' } : { closurePlayed: false };
  const fx = await buildBrownlow(ctx, caseNumber, async (tx, w) => {
    const settled = await brownlowClosureRow(tx, w, 1, shape);
    const closure = await demoteToZero(tx, w, settled);
    return { closure, settledValues: settled.values, participationRowId: await participation(tx, w, w.pPrime.id, closure.match.id) };
  });
  const { w, closure } = fx;
  const d = closure.demotion;
  const M = closure.match.id;
  const identityId = await checkBrownlowClosurePre(ctx, w, closure, d.batchId);
  const demotion: { previous: Record<string, JsonValue>; next: Record<string, JsonValue> } = caseNumber === 78
    ? { previous: { votes: 3, match_id: null }, next: { votes: 0, match_id: M } }
    : { previous: { votes: 3, played: false }, next: { votes: 0, played: true } };
  await checkBrownlowChain(ctx, closure, `[insert v1 ${canonicalJson(insertOf({ ...closure, values: fx.settledValues }, 0).next)}, `
    + `update v2 ${canonicalJson(demotion.previous as JsonValue)} -> ${canonicalJson(demotion.next as JsonValue)} (B2)]`, [
    insertOf({ ...closure, values: fx.settledValues }, w.settleBatchId),
    { id: d.applicationId, batchId: d.batchId, versionSeq: 2, verb: 'update', previous: demotion.previous, next: demotion.next },
  ]);
  check(caseNumber === 78
    ? 'pre: the distinguishing state: the demotion\'s new_values is exactly {votes: 0, match_id: M} with previous match_id NULL (a NULL -> M heal)'
    : 'pre: the distinguishing state: the demotion\'s new_values is exactly {votes: 0, played: true}; the inserted row was played = false',
    canonicalJson(d.next) === canonicalJson(demotion.next as JsonValue) && canonicalJson(d.previous) === canonicalJson(demotion.previous as JsonValue)
      && (caseNumber === 78 ? fx.settledValues.match_id === null : fx.settledValues.played === false), JSON.stringify(d));
  if (caseNumber === 78) {
    const [v2, v3] = closure.companions;
    const siblingApps = await owner<{ key: JsonValue; verb: string; newValues: JsonValue }[]>`
      SELECT target_key AS key, verb, new_values AS "newValues" FROM canonical_applications
       WHERE import_batch_id = ${d.batchId} AND family = 'brownlow_match_votes' AND external_record_id = ${closure.externalRecordId}
         AND source_version_seq = 2 AND id <> ${d.applicationId} AND new_values ? 'match_id' ORDER BY id
    `;
    const siblings = await rowsById(owner, 'brownlow_round_votes', [d.newVoter.rowId, v2.rowId, v3.rowId]);
    check('pre: m equals its siblings\': every other application of (B2, CD_M, v2) naming match_id names M (V4 insert, V2/V3 heals); V4/V2/V3 rows hold M',
      siblingApps.length === 3 && siblingApps.every((a) => (a.newValues as RowSnapshot).match_id === M)
        && d.healApplicationIds.length === 2 && [...siblings.values()].length === 3 && [...siblings.values()].every((r) => r.match_id === M),
      JSON.stringify(siblingApps));
  }
  const v1 = await payloadProofAt(owner, w, closure, 1);
  const v2p = await payloadProofAt(owner, w, closure, 2);
  check('pre: v1 names CD_I once with 3 (B3-I); v2 parses and has no CD_I entry (F002)',
    v1.count === 1 && v1.vote === 3 && v2p.count === 0, JSON.stringify({ v1, v2p }));
  check('pre: P′ participates in M through a foreign afltables row (C1c: the demoted row is played)',
    canonicalJson(await participationAt(owner, w.pPrime.id, [M])) === canonicalJson([M]));
  const saBaseline = await settledBaseline(ctx, w);
  await commitBrownlowMove(ctx, {
    w, closure, identityId, saBaseline, citedVersionSeq: 2, hasProjection: true,
    keepBrownlow: [...closure.companions.map((c) => c.rowId), d.newVoter.rowId], keepPms: [fx.participationRowId],
  });
}

const case78 = (ctx: CaseContext) => demotionWithFieldRule(ctx, 78);
const case79 = (ctx: CaseContext) => demotionWithFieldRule(ctx, 79);

/* ---- Case 83 ---- */

/**
 * Case 83: a Brownlow MOVE with no P′ participation in M -> STOP `brownlow_move_without_participation`
 * (C1c); separately, with a paired player_match_stats MOVE giving P′ participation -> allowed.
 *   - `no-participation`: case 5's row (match_id M), P′ has no row at M;
 *   - `null-match-zero`: the row's `match_id` NULL (pre-F007, M unresolved), round 1 = {M}; P′ plays
 *     only a ROUND-2 match: zero candidate matches of (2092, 1);
 *   - `null-match-two`: the row's `match_id` NULL, round 1 = {M, M2}; P′ plays both: two candidates;
 *   - `paired-pms-move`: case 5's row plus CD_I's `player_match_stats` closure row for P at M, no
 *     P′ row at M: the planned pms MOVE is P′'s participation -> COMMITTED (both rows move).
 */
async function case83(ctx: CaseContext): Promise<void> {
  const { owner, check, variant } = ctx;
  const variants = ['no-participation', 'null-match-zero', 'null-match-two', 'paired-pms-move'];
  if (variant === null || !variants.includes(variant)) throw new RehearsalRefused(`case 83 needs --variant ${variants.join(' | ')}`);
  const fx = await buildBrownlow(ctx, 83, async (tx, w) => {
    const unresolved = variant === 'null-match-zero' || variant === 'null-match-two';
    const closure = await brownlowClosureRow(tx, w, 1, { matchIdAtSettle: unresolved ? 'unresolved' : 'resolved' });
    let other: FixtureMatch | null = null;
    const participationRowIds: number[] = [];
    let pairedPms: PmsClosureRow | undefined;
    if (variant === 'null-match-zero') {
      other = await fixtureMatch(tx, w, 2, 2);
      participationRowIds.push(await participation(tx, w, w.pPrime.id, other.id));
    } else if (variant === 'null-match-two') {
      other = await fixtureMatch(tx, w, 2, 1);
      participationRowIds.push(await participation(tx, w, w.pPrime.id, closure.match.id), await participation(tx, w, w.pPrime.id, other.id));
    } else if (variant === 'paired-pms-move') {
      pairedPms = await pmsClosureRow(tx, w, 1, closure.match);
    }
    return { closure, other, participationRowIds, pairedPms };
  });
  const { w, closure } = fx;
  const identityId = await checkBrownlowClosurePre(ctx, w, closure, w.settleBatchId);
  const proof = await payloadProofAt(owner, w, closure, 1);
  check('pre: B1-B5 hold on the row itself (payload names CD_I once with 3; CD_I\'s projection names P): only participation is under test',
    proof.count === 1 && proof.vote === 3
      && (await voteSetProjections(owner, w, closure.externalRecordId)).some((p) => p.providerPlayerId === w.providerId && p.playerId === w.p.id));
  const [{ roundMatches }] = await owner<{ roundMatches: number[] }[]>`
    SELECT COALESCE(array_agg(id ORDER BY id), '{}') AS "roundMatches" FROM matches WHERE season = ${w.season} AND round_number = 1
  `;
  const pPrimeInRound = await participationAt(owner, w.pPrime.id, roundMatches);
  const saBaseline = await settledBaseline(ctx, w);
  const protect = [...brownlowRows(closure), ...pmsRows(...fx.participationRowIds)];
  const c1c: ExpectedStop = {
    table: 'brownlow_round_votes', rowId: closure.rowId, step: 'C1c', code: 'brownlow_move_without_participation',
    detail: 'P\' has no canonical participation in this match under the plan',
  };

  if (variant === 'no-participation') {
    const [{ pPrimeRows }] = await owner<{ pPrimeRows: number }[]>`SELECT count(*)::int AS "pPrimeRows" FROM player_match_stats WHERE player_id = ${w.pPrime.id}`;
    check('pre: the row is resolved to M, played; P′ holds no player_match_stats row at all (none at M); no pms closure row at P',
      closure.values.match_id === closure.match.id && closure.values.played === true && pPrimeRows === 0
        && (await pmsCounts(owner, w, closure.match.id)).pRows === 0);
    await brownlowQ1Stop(ctx, w, closure, saBaseline, c1c, protect);
  } else if (variant === 'null-match-zero') {
    check('pre: match_id NULL; round (2092, 1) = {M}; P′ plays none of it (zero candidates) but does play a round-2 match',
      closure.values.match_id === null && canonicalJson(roundMatches) === canonicalJson([closure.match.id]) && pPrimeInRound.length === 0
        && canonicalJson(await participationAt(owner, w.pPrime.id, [fx.other!.id])) === canonicalJson([fx.other!.id]),
      JSON.stringify({ roundMatches, pPrimeInRound }));
    await brownlowQ1Stop(ctx, w, closure, saBaseline, c1c, protect);
  } else if (variant === 'null-match-two') {
    check('pre: match_id NULL; round (2092, 1) = {M, M2}; P′ plays BOTH (two candidates)',
      closure.values.match_id === null && canonicalJson(roundMatches) === canonicalJson([closure.match.id, fx.other!.id].sort((a, b) => a - b))
        && pPrimeInRound.length === 2, JSON.stringify({ roundMatches, pPrimeInRound }));
    await brownlowQ1Stop(ctx, w, closure, saBaseline, c1c, protect);
  } else {
    const pms = fx.pairedPms!;
    const pmsNow = await pmsRow(owner, pms.rowId);
    check('pre: CD_I\'s player_match_stats closure row is at (P, M), afl_api-owned, stamped <CD_M>|<team>|CD_I; P′ has NO row at M (participation comes only from the plan)',
      pmsNow !== null && pmsNow.player_id === w.p.id && pmsNow.match_id === closure.match.id && pmsNow.source_id === w.sourceIds.aflApi
        && pmsNow.source_record_id === pms.externalRecordId && pmsNow.brownlow_votes === null && pPrimeInRound.length === 0);
    await commitBrownlowMove(ctx, {
      w, closure, identityId, saBaseline, citedVersionSeq: 1, hasProjection: true, pairedPms: pms,
      keepBrownlow: closure.companions.map((cc) => cc.rowId), keepPms: [],
    });
  }
}

/* ---- Family E (match-sheet subset) ---- */

type CorrectedPmsBase<T = void> = { w: World; closure: PmsClosureRow; corrected: RowSnapshot; identityId: number; c: Corrected; cutoff: string; extra: T };

/**
 * Case 1's base CORRECTED by the real CLI (validate-only, apply): the canonical application, batch
 * K, `c`, the moved row and the ledger/identity baseline, proven. Nothing is forged. `mutate` adds
 * pre-correction state a later writer needs (a season in progress, a complete line-up) and
 * `brownlowCoverage` settles 2092's Brownlow coverage (the real recompute) before the correction.
 */
async function correctedPmsBase<T = void>(
  ctx: CaseContext, caseNumber: number,
  mutate: (tx: TransactionSql, w: World, closure: PmsClosureRow) => Promise<T> = async () => undefined as T,
  options: { brownlowCoverage?: boolean } = {},
): Promise<CorrectedPmsBase<T>> {
  const { owner, check } = ctx;
  const { w, closure, extra } = await buildGuardPms(ctx, caseNumber, mutate, options);
  // A `mutate` may complete M's line-up: foreign (afltables-owned) rows of other fixture players.
  const [{ lineUpRows }] = await owner<{ lineUpRows: number }[]>`
    SELECT count(*)::int AS "lineUpRows" FROM player_match_stats
     WHERE match_id = ${closure.matchId} AND player_id NOT IN (${w.p.id}, ${w.pPrime.id}) AND source_id = ${w.sourceIds.afltables}
       AND player_id IN (${owner.unsafe(FIXTURE_PLAYERS)})
  `;
  const { before, identityId } = await checkPmsPreState(ctx, w, closure, lineUpRows);
  const c = await correct(ctx, w, { rowsPlanned: 1, moved: 1, deleted: 0 });
  const cutoff = await cutoffOf(owner, c.r.batchId, closure.externalRecordId);
  const corrected = await pmsRow(owner, closure.rowId);
  check('corrected base: the SAME row id at (P′, M), contract byte-identical, provenance kept (D3)',
    corrected !== null && corrected.player_id === w.pPrime.id && corrected.match_id === closure.matchId
      && rowContractHash(contractOf(corrected)) === closure.contractSha256 && corrected.source_record_id === before.source_record_id
      && corrected.import_batch_id === before.import_batch_id);
  const n = await pmsCounts(owner, w, closure.matchId);
  check(`corrected base: (P, M) is free after the MOVE${lineUpRows === 0 ? '' : ` (M also holds its ${lineUpRows} untouched line-up rows)`}`,
    n.pAtM === 0 && n.pPrimeAtM === 1 && n.atM === 1 + lineUpRows, JSON.stringify(n));
  await checkLedgerAndIdentity(ctx, w, identityId, c);
  check('corrected base: c = the correction application\'s applied_at exists', cutoff !== null);
  const audits = await auditsAt(owner, 'matches', closure.matchId, cutoff ?? BEFORE_ANY_AUDIT);
  check('corrected base: no data_edits audit for M yet', audits.length === 0, JSON.stringify(audits));
  console.log(`  corrected base: adjudication ${c.r.adjudicationId}, batch K ${c.r.batchId}, c = ${String(cutoff)}`);
  return { w, closure, corrected: corrected!, identityId, c, cutoff: cutoff!, extra };
}

function logWriterAudit(cutoff: string, audits: readonly AuditRow[]): void {
  console.log(`  c = ${cutoff}; writer audit(s) ${JSON.stringify(audits.map((a) => ({ id: a.id, fieldGroup: a.fieldGroup, createdAt: a.createdAt, afterCutoff: a.afterCutoff })))}`);
}

/** Case 70: after the correction, the REAL `saveMatchSheet` edits a match-sheet field of P′'s
 * corrected row (goals 2 -> 3) -> Q2 PASS, `post_correction_edit match_sheet` reported; never
 * overwritten by a re-apply. */
async function case70(ctx: CaseContext): Promise<void> {
  const { owner, check } = ctx;
  const writers = await loadWriters();
  const { w, closure, corrected, c, cutoff } = await correctedPmsBase(ctx, 70);
  const storable = await detectAuthorityState(owner);
  const staleToken = await writers.loadMatchSheetStaleToken(owner, closure.matchId);
  const result = await writerCall(ctx.importDsn, `${HARNESS_APP}case070-writer-match-sheet`, () => writers.saveMatchSheet({
    matchId: closure.matchId, syncMatchScores: false, players: [matchSheetLine(w.pPrime.id, { ...closure.values, goals: 3 })],
    adminUserId: w.actorId, staleToken, note: 'AFLDB-ISSUE-238 Slice 10 rehearsal case 070: post-correction match-sheet edit of the corrected row',
  }));
  console.log(`  writer saveMatchSheet (after the correction): ${JSON.stringify(result)}`);
  if (!(await checkSheetSaveOutcome(ctx, storable, result, closure.matchId, 'match_sheet', 1, 'the real saveMatchSheet edit of the corrected row'))) {
    check('State A: the corrected row is byte-identical afterwards (nothing saved)',
      canonicalJson(await pmsRow(owner, closure.rowId) as unknown as JsonValue) === canonicalJson(corrected as unknown as JsonValue));
    check('State A: no writer audit for M after c', (await auditsAt(owner, 'matches', closure.matchId, cutoff)).length === 0);
    return;
  }
  const edited = await pmsRow(owner, closure.rowId);
  check('post-writer: the corrected row (same id, still at (P′, M)) now has goals 2 -> 3; every other contract field and its ownership/stamps unchanged',
    edited !== null && edited.player_id === w.pPrime.id
      && canonicalJson(contractOf(edited)) === canonicalJson({ ...contractOf(corrected), goals: 3 } as Record<string, JsonValue>)
      && edited.source_id === corrected.source_id && edited.source_record_id === corrected.source_record_id
      && edited.import_batch_id === corrected.import_batch_id, JSON.stringify(edited && contractOf(edited)));
  const audits = await auditsAt(owner, 'matches', closure.matchId, cutoff);
  logWriterAudit(cutoff, audits);
  const audit = audits[0];
  check('the writer\'s production audit: exactly one data_edits matches/match_sheet row for M, created at or after c',
    audits.length === 1 && audit.fieldGroup === 'match_sheet' && audit.afterCutoff, JSON.stringify(audits));
  const key = canonicalJson({ player_id: w.pPrime.id, match_id: closure.matchId });
  const report = `post_correction_edit match_sheet: player_match_stats ${key} goals 2 -> 3 (audit ${String(audit?.id)})`;
  const entry = `post_correction_edit match_sheet (PASS): player_match_stats ${key} goals 2 -> 3 (audit ${String(audit?.id)})`;
  for (const mode of ['validate-only', 'apply'] as const) {
    const q2 = await q2Rerun(ctx, c, mode);
    check(`Q2 (${mode}): ALREADY_SATISFIED; the goals divergence explained as post_correction_edit match_sheet citing the writer's audit; SAT-1..SAT-5 PASS`,
      q2.result.kind === 'ALREADY_SATISFIED' && q2.lines.includes(report) && q2.lines.includes(entry) && q2.lines.includes(SAT_PASS)
        && q2.lines.includes(`NOOP already_corrected_moved: player_match_stats ${key}`), report);
    check(`Q2 (${mode}): the edited row is byte-identical afterwards (a re-run never overwrites the edit)`,
      canonicalJson(await pmsRow(owner, closure.rowId)) === canonicalJson(edited));
  }
  await owner.begin('read only', (tx) => assertAflApiIdentityInvariant(tx));
  check('post: the combined identity invariant (SAT-1 basis) holds', true);
}

/** Case 88: after the correction, the REAL `saveMatchSheet` REMOVES P′ from M's sheet: the corrected
 * row vanishes, M still exists, and only a `match_sheet` audit (no `match_deletion`) follows c ->
 * STOP `correction_target_absent_unexplained` (D-P5-3: a match-sheet removal is not durably provable). */
async function case88(ctx: CaseContext): Promise<void> {
  const { owner, check } = ctx;
  const writers = await loadWriters();
  const { w, closure, corrected, c, cutoff } = await correctedPmsBase(ctx, 88);
  const storable = await detectAuthorityState(owner);
  const staleToken = await writers.loadMatchSheetStaleToken(owner, closure.matchId);
  const result = await writerCall(ctx.importDsn, `${HARNESS_APP}case088-writer-match-sheet`, () => writers.saveMatchSheet({
    matchId: closure.matchId, syncMatchScores: false, players: [], removedPlayerIds: [w.pPrime.id],
    adminUserId: w.actorId, staleToken, note: 'AFLDB-ISSUE-238 Slice 10 rehearsal case 088: post-correction match-sheet removal of P′',
  }));
  console.log(`  writer saveMatchSheet (removedPlayerIds [P′]): ${JSON.stringify(result)}`);
  if (!(await checkSheetSaveOutcome(ctx, storable, result, closure.matchId, 'lineup', 0, 'the real saveMatchSheet removal of P′ from M\'s sheet'))) {
    check('State A: the corrected row is byte-identical afterwards (nothing removed)',
      canonicalJson(await pmsRow(owner, closure.rowId) as unknown as JsonValue) === canonicalJson(corrected as unknown as JsonValue));
    check('State A: no writer audit for M after c', (await auditsAt(owner, 'matches', closure.matchId, cutoff)).length === 0);
    return;
  }
  const [post] = await owner<{ row: number; atM: number; match: number }[]>`
    SELECT (SELECT count(*)::int FROM player_match_stats WHERE id = ${closure.rowId}) AS row,
           (SELECT count(*)::int FROM player_match_stats WHERE match_id = ${closure.matchId}) AS "atM",
           (SELECT count(*)::int FROM matches WHERE id = ${closure.matchId}) AS match
  `;
  check('post-writer: the corrected row is GONE (its id, and anything at M); M itself still exists', post.row === 0 && post.atM === 0 && post.match === 1, JSON.stringify(post));
  const audits = await auditsAt(owner, 'matches', closure.matchId, cutoff);
  logWriterAudit(cutoff, audits);
  check('the only audit after c is the writer\'s match_sheet one: no match_deletion audit exists for M',
    audits.length === 1 && audits[0].fieldGroup === 'match_sheet' && audits[0].afterCutoff, JSON.stringify(audits));
  const expected = 'player_match_stats [C14] correction_target_absent_unexplained: no durable match_deletion audit explains the absence';
  for (const mode of ['validate-only', 'apply'] as const) {
    const q2 = await q2Rerun(ctx, c, mode);
    const r = q2.result;
    check(`Q2 (${mode}): STOP (exit 1) with exactly one stop, ${expected}`,
      r.kind === 'STOP' && r.stops.length === 1 && describeCliStop(r.stops[0]) === expected, JSON.stringify(r));
    check(`Q2 (${mode}): nothing recreated (no row with the corrected id, none at M)`,
      (await pmsRow(owner, closure.rowId)) === null && (await pmsCounts(owner, w, closure.matchId)).atM === 0);
  }
  await owner.begin('read only', (tx) => assertAflApiIdentityInvariant(tx));
  check('post: the combined identity invariant (SAT-1 basis) holds', true);
}

/** Case 101: after the MOVE frees (P, M), the REAL `saveMatchSheet` inserts a fresh line for P at M:
 * a NULL-owned row beside the corrected (P′, M) row -> Q2 PASS, reported distinctly as
 * `post_correction_reappearance`; not deleted, merged or reattributed; a re-run never touches it. */
async function case101(ctx: CaseContext): Promise<void> {
  const { owner, check } = ctx;
  const writers = await loadWriters();
  const { w, closure, corrected, c, cutoff } = await correctedPmsBase(ctx, 101);
  const fresh = { club_id: w.clubs.home.id, jumper_number: '7', goals: 1, behinds: 0, kicks: 10, handballs: 5, disposals: 15,
    marks: 4, tackles: 3, hitouts: 0, frees_for: 0, frees_against: 2 };
  const storable = await detectAuthorityState(owner);
  const staleToken = await writers.loadMatchSheetStaleToken(owner, closure.matchId);
  const result = await writerCall(ctx.importDsn, `${HARNESS_APP}case101-writer-match-sheet`, () => writers.saveMatchSheet({
    matchId: closure.matchId, syncMatchScores: false, players: [matchSheetLine(w.p.id, fresh)],
    adminUserId: w.actorId, staleToken, note: 'AFLDB-ISSUE-238 Slice 10 rehearsal case 101: post-correction match-sheet line for P at M',
  }));
  console.log(`  writer saveMatchSheet (a line for P at M): ${JSON.stringify(result)}`);
  if (!(await checkSheetSaveOutcome(ctx, storable, result, closure.matchId, 'match_sheet', 1, 'the real saveMatchSheet line for P at M'))) {
    const only = await owner<{ id: number; row: RowSnapshot }[]>`
      SELECT id::int AS id, to_jsonb(p.*) AS row FROM player_match_stats p WHERE match_id = ${closure.matchId} ORDER BY id
    `;
    check('State A: M still holds only the corrected row, byte-identical; nothing reappeared at (P, M)',
      only.length === 1 && only[0].id === closure.rowId && canonicalJson(only[0].row) === canonicalJson(corrected));
    check('State A: no writer audit for M after c', (await auditsAt(owner, 'matches', closure.matchId, cutoff)).length === 0);
    return;
  }
  const rows = await owner<{ id: number; playerId: number; row: RowSnapshot }[]>`
    SELECT id::int AS id, player_id AS "playerId", to_jsonb(p.*) AS row FROM player_match_stats p WHERE match_id = ${closure.matchId} ORDER BY id
  `;
  const moved = rows.find((x) => x.id === closure.rowId);
  const reappeared = rows.find((x) => x.id !== closure.rowId);
  console.log(`  rows at M: ${JSON.stringify(rows.map((x) => ({ id: x.id, player_id: x.playerId, source_id: x.row.source_id })))}`);
  check('post-writer: the corrected row (same id) is byte-identical at (P′, M)', moved !== undefined && canonicalJson(moved.row) === canonicalJson(corrected));
  check('post-writer: a NEW row reappeared at (P, M): the writer\'s line, NULL-owned (source_id / source_record_id / import_batch_id NULL)',
    rows.length === 2 && reappeared !== undefined && reappeared.playerId === w.p.id && reappeared.id > closure.rowId
      && reappeared.row.goals === 1 && reappeared.row.kicks === 10 && reappeared.row.jumper_number === '7'
      && reappeared.row.source_id === null && reappeared.row.source_record_id === null && reappeared.row.import_batch_id === null);
  const audits = await auditsAt(owner, 'matches', closure.matchId, cutoff);
  logWriterAudit(cutoff, audits);
  check('the writer\'s production audit: exactly one data_edits matches/match_sheet row for M, created at or after c',
    audits.length === 1 && audits[0].fieldGroup === 'match_sheet' && audits[0].afterCutoff, JSON.stringify(audits));
  const oldKey = canonicalJson({ player_id: w.p.id, match_id: closure.matchId });
  const newKey = canonicalJson({ player_id: w.pPrime.id, match_id: closure.matchId });
  const report = `post_correction_reappearance: a new row not attributed through ${w.providerId} occupies the vacated player_match_stats key ${oldKey}; not touched`;
  const entry = `post_correction_reappearance: player_match_stats ${oldKey} (a new row not attributed through the provider; not touched)`;
  for (const mode of ['validate-only', 'apply'] as const) {
    const q2 = await q2Rerun(ctx, c, mode);
    check(`Q2 (${mode}): ALREADY_SATISFIED, the reappearance reported distinctly as post_correction_reappearance; the MOVE still already_corrected_moved; SAT-1..SAT-5 PASS (SAT-5 did not fire)`,
      q2.result.kind === 'ALREADY_SATISFIED' && q2.lines.includes(report) && q2.lines.includes(entry)
        && q2.lines.includes(`NOOP already_corrected_moved: player_match_stats ${newKey}`) && q2.lines.includes(SAT_PASS)
        && !q2.lines.some((l) => /SAT-5/.test(l) && !l.startsWith(SAT_PASS)), report);
    const after = await owner<{ id: number; row: RowSnapshot }[]>`
      SELECT id::int AS id, to_jsonb(p.*) AS row FROM player_match_stats p WHERE match_id = ${closure.matchId} ORDER BY id
    `;
    check(`Q2 (${mode}): both rows byte-identical afterwards -- the reappeared row is never deleted, merged or reattributed; the corrected row unchanged`,
      canonicalJson(after as unknown as JsonValue) === canonicalJson(rows.map((x) => ({ id: x.id, row: x.row })) as unknown as JsonValue));
  }
  await owner.begin('read only', (tx) => assertAflApiIdentityInvariant(tx));
  check('post: the combined identity invariant (SAT-1 basis) holds', true);
}

/* ==================================================================== *
 * Brownlow / dependent guard Family D (§12.1): 3, 4, 17, 18, 19, 56, 84, 85
 * ==================================================================== *
 *
 * Each scenario is a VALID correction base plus ONE named guard or dependent state:
 *   - case 1's base (CD_I's pms closure row at (P, M)): 3, 4, 17 votes-written, 18, 19, 56 games, 85;
 *   - case 83's paired base (CD_I's round row and its pms row at M): 17 round-reowned;
 *   - case 5's Brownlow safe-move base (CD_I's round row, P′ participation at M): 56 round-vote, 84.
 * Each base alone plans (cases 1, 5 and 83 paired-pms-move COMMIT). The named state is read back
 * and asserted present, and the neighbouring guards of the same rule asserted absent, before the
 * CLI runs, so the STOP or report is attributable to that one state.
 *
 * Writers. Where the §12.1 row is about writer-produced state (17 "an admin Brownlow edit", 56
 * "admin-published", 4's draft) the REAL exported writer produces it (react-server). Where the row
 * is pre-existing guard state and the exported operation would add a second guard -- a finalise
 * always writes the pms mirror (BG1) and claims/demotes round rows (BG2) as well as its entry
 * state (BG3) -- the single production statement is reproduced in the harness, and says so.
 *
 * Derived state. A Brownlow-bearing fixture gets the real `recomputeBrownlowCoverage` (the settled
 * baseline, proven a fixed point). Every STOP then requires every guard/dependent row, every 2092
 * round row, 2092 `stat_availability` and P/P′'s derived rows byte-identical (`guardSnapshot`).
 * A COMMITTED branch proves the correction's own canonical result, the report line, and the
 * dependent row byte-identical in the database (the report never substitutes for the row).
 */

const AFTER_SIREN_SOURCE_KEY = 'wikipedia_after_siren_kicks';
const FIRST_KICK_GOAL_SOURCE_KEY = 'wikipedia_first_kick_goal';
const MANUAL_SOURCE_KEY = 'manual_admin_edit';

/** The real Brownlow admin writers refuse a season whose `brownlow_season_total` coverage is
 * `not_applicable` (`admin-brownlow.ts` `lockMatch`, `publishBrownlowSeason`). 2092 becomes a season
 * IN PROGRESS -- the state a new season is in when first administered -- and the real
 * `recomputeBrownlowCoverage` then derives `pending` itself: no stat_availability row is hand-written. */
async function seasonInProgress(tx: TransactionSql, w: World): Promise<void> {
  await tx`UPDATE seasons SET status = 'in_progress' WHERE year = ${w.season}`;
}

/** A FOREIGN (AFL Tables-owned, no AFL API lineage) `player_match_stats` row for `playerId` at the
 * match, for `clubId` (`participation` with the club named). */
async function foreignParticipation(tx: TransactionSql, w: World, playerId: number, matchId: number, clubId: number, jumper = '31'): Promise<number> {
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO player_match_stats ${tx({
      player_id: playerId, match_id: matchId, ...settledValues(clubId), jumper_number: jumper,
      source_id: w.sourceIds.afltables, source_record_id: null, import_batch_id: null,
    } as never)}
    RETURNING id::text AS id
  `;
  return Number(row.id);
}

/** Complete the match's line-up to `MIN_CLUB_LINEUP_ROWS` per club with fixture players of their own
 * (`L01`...), each a foreign participation row: the §27.6 precondition of a real finalise or void
 * (`assessParticipants`). Returns the filler player ids by side. */
async function fillLineUp(tx: TransactionSql, w: World, matchId: number): Promise<{ home: number[]; away: number[] }> {
  const [have] = await tx<{ home: number; away: number }[]>`
    SELECT count(*) FILTER (WHERE club_id = ${w.clubs.home.id})::int AS home, count(*) FILTER (WHERE club_id = ${w.clubs.away.id})::int AS away
      FROM player_match_stats WHERE match_id = ${matchId}
  `;
  const out: { home: number[]; away: number[] } = { home: [], away: [] };
  let slot = 0;
  for (const side of ['home', 'away'] as const) {
    for (let i = have[side]; i < MIN_CLUB_LINEUP_ROWS; i += 1) {
      slot += 1;
      const player = await insertPlayer(tx, w.caseCode, `L${String(slot).padStart(2, '0')}`, w.sourceIds);
      await foreignParticipation(tx, w, player.id, matchId, w.clubs[side].id, String(40 + slot));
      out[side].push(player.id);
    }
  }
  return out;
}

/** An AFL Tables-owned round row (no stamp, no batch): a foreign vote fact of `playerId` at the match. */
async function foreignRoundRow(tx: TransactionSql, w: World, playerId: number, match: { id: number; roundNumber: number }, votes: 1 | 2 | 3): Promise<number> {
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO brownlow_round_votes ${tx({
      season: w.season, player_id: playerId, round_number: match.roundNumber, match_id: match.id, played: true, votes,
      source_id: w.sourceIds.afltables, source_record_id: null, import_batch_id: null,
    } as never)}
    RETURNING id::text AS id
  `;
  return Number(row.id);
}

/**
 * `manualRoundRow` (case 3): P's `brownlow_round_votes` row at M exactly as `writeMatchFacts`
 * (`admin-brownlow.ts`) leaves it -- step 2 demote `{votes: 0, played: true}` or step 3 claim
 * `{votes: 3, played: true, match_id: M}`, source `manual_admin_edit`, `entry:<M>:r1`, import batch
 * NULL. Exact production statement values reproduced in the harness: the exported finalise that runs
 * them also writes the pms mirror onto the closure row (BG1) and a final entry state naming P (BG3),
 * two guards outside case 3's contract (they are cases 17 and 4).
 */
async function manualRoundRow(tx: TransactionSql, w: World, match: { id: number; roundNumber: number }, votes: 0 | 3): Promise<number> {
  const manual = await sourceId(tx, MANUAL_SOURCE_KEY);
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO brownlow_round_votes (season, player_id, round_number, match_id, played, votes,
                                      source_id, source_record_id, import_batch_id, imported_at)
    VALUES (${w.season}, ${w.p.id}, ${match.roundNumber}, ${match.id}, true, ${votes}, ${manual}, ${entrySourceRecordId(match.id, 1)}, NULL, now())
    RETURNING id::text AS id
  `;
  return Number(row.id);
}

/**
 * `entryStateRow` (cases 4 final, 84): the `brownlow_vote_entry_state` row `runMatchMutation`
 * (`admin-brownlow.ts`) writes on a first mutation (revision 1): a draft carries no finalisation, a
 * final carries finalised_by/at/revision. Exact production statement reproduced in the harness: the
 * exported finalise also writes the canonical facts (the pms mirror, BG1; claims, BG2), and the
 * exported draft refuses to name a non-participant (case 84's P plays no pms row at M). Its
 * `data_edits` audit is not reproduced: no Q1 rule reads it.
 */
async function entryStateRow(
  tx: TransactionSql, w: World, matchId: number, status: 'draft' | 'final',
  slots: { three: number; two: number; one: number },
): Promise<void> {
  const finalising = status !== 'draft';
  await tx`
    INSERT INTO brownlow_vote_entry_state
          (match_id, season, status, three_player_id, two_player_id, one_player_id,
           revision, created_by, updated_by, updated_at,
           finalised_by, finalised_at, finalised_revision, last_reason)
    VALUES (${matchId}, ${w.season}, ${status}, ${slots.three}, ${slots.two}, ${slots.one},
            1, ${w.actorId}, ${w.actorId}, now(),
            ${finalising ? w.actorId : null}, CASE WHEN ${finalising}::boolean THEN now() ELSE NULL END,
            ${finalising ? 1 : null}, NULL)
  `;
}

/**
 * `afterSirenKick`: one `after_siren_kicks` row in the loader's shape (`after_siren.py`
 * WRITTEN_COLUMNS + provenance `wikipedia_after_siren_kicks`), P's club (home) against the away club.
 *   - at a match (premiership, competition 'VFL/AFL'): M's final score becomes the kick's own
 *     10.10 (70) - 10.4 (64), since the loader resolves the match by that score; a goal after the
 *     siren that won by six;
 *   - match-less: a pre-season ('NAB Cup') winning goal, premiership false, match_id NULL (such a row
 *     can never resolve to a `matches` row; it is resolved by club-season participation, DP-4).
 * `playerId` NULL is an unresolved row (`ambiguous`, two candidates).
 */
async function afterSirenKick(
  tx: TransactionSql, w: World, spec: { playerId: number | null; matchId: number | null; n: number },
): Promise<number> {
  const source = await sourceId(tx, AFTER_SIREN_SOURCE_KEY);
  const atMatch = spec.matchId !== null;
  if (atMatch) {
    await tx`
      UPDATE matches SET home_goals = 10, home_behinds = 10, home_score = 70, away_goals = 10, away_behinds = 4, away_score = 64, margin = 6
       WHERE id = ${spec.matchId}
    `;
  }
  const name = `Rehearsal Zz238-${w.caseCode}-P`;
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO after_siren_kicks ${tx({
      player_id: spec.playerId, player_name_raw: name, player_name_clean: name,
      link_status_value: spec.playerId === null ? 'ambiguous' : 'unique', candidate_count: spec.playerId === null ? 2 : 1,
      club_id: w.clubs.home.id, club_name_raw: 'Rehearsal Home', opponent_club_id: w.clubs.away.id, opponent_name_raw: 'Rehearsal Away',
      competition: atMatch ? 'VFL/AFL' : 'NAB Cup', premiership_season: atMatch, season: w.season, round_raw: 'Round 1', match_id: spec.matchId,
      kick_scored: 'goal', kick_effect: 'won', shot_detail: null, kicker_result: 'win', siren: 'final',
      kicker_score_raw: atMatch ? '10.10.70' : '9.10.64', opponent_score_raw: atMatch ? '10.4.64' : '8.12.60',
      kicker_points: atMatch ? 70 : 64, opponent_points: atMatch ? 64 : 60, supergoal_scoring: false,
      cited: true, source_annotation: null, notes: 'AFLDB-ISSUE-238 Slice 10 rehearsal fixture',
      source_id: source, source_record_id: `${w.season}-${atMatch ? 'vfl-afl' : 'nab-cup'}-r1-issue238-rh-${w.caseCode}-${spec.n}`, import_batch_id: null,
    } as never)}
    RETURNING id::text AS id
  `;
  return Number(row.id);
}

/** `firstKickGoal`: a linked `player_achievements` `first_kick_goal` row for `playerId` at the match,
 * in the importer's shape (`import-first-kick-goal.ts`, provenance `wikipedia_first_kick_goal`, a
 * stable `fkg-<n>` id). */
async function firstKickGoal(
  tx: TransactionSql, w: World, player: { id: number; role: string }, match: { id: number; roundNumber: number }, n: number,
): Promise<number> {
  const source = await sourceId(tx, FIRST_KICK_GOAL_SOURCE_KEY);
  const name = `Rehearsal Zz238-${w.caseCode}-${player.role}`;
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO player_achievements ${tx({
      achievement_type: 'first_kick_goal', player_id: player.id, player_name_raw: name, player_name_clean: name,
      link_status_value: 'unique', candidate_count: 1, club_id: w.clubs.home.id, club_name_raw: 'Rehearsal Home',
      season: w.season, round_raw: String(match.roundNumber), match_id: match.id, notes: 'AFLDB-ISSUE-238 Slice 10 rehearsal fixture',
      source_id: source, source_record_id: `fkg-99238${w.caseCode}${n}`, import_batch_id: null,
    } as never)}
    RETURNING id::text AS id
  `;
  return Number(row.id);
}

/** Every 2092 row of the guard/dependent tables, the 2092 round rows and stat_availability, and P/P′'s
 * derived rows: what a STOP must leave byte-identical. */
async function guardSnapshot(sql: Sql, w: World): Promise<Hashed> {
  const rows = await sql<{ row: JsonValue }[]>`
    SELECT jsonb_build_object('table', t, 'row', r) AS row FROM (
      SELECT 'brownlow_vote_entry_state' AS t, to_jsonb(x.*) AS r FROM brownlow_vote_entry_state x WHERE x.season = ${w.season}
      UNION ALL SELECT 'brownlow_season_authority', to_jsonb(x.*) FROM brownlow_season_authority x WHERE x.season = ${w.season}
      UNION ALL SELECT 'brownlow_season_votes', to_jsonb(x.*) FROM brownlow_season_votes x WHERE x.season = ${w.season}
      UNION ALL SELECT 'after_siren_kicks', to_jsonb(x.*) FROM after_siren_kicks x WHERE x.season = ${w.season}
      UNION ALL SELECT 'player_achievements', to_jsonb(x.*) FROM player_achievements x WHERE x.season = ${w.season}
      UNION ALL SELECT 'brownlow_round_votes', to_jsonb(x.*) FROM brownlow_round_votes x WHERE x.season = ${w.season}
      UNION ALL SELECT 'stat_availability', to_jsonb(x.*) FROM stat_availability x WHERE x.season = ${w.season}
    ) s ORDER BY t, r::text
  `;
  const derived = await derivedOf(sql, [w.p.id, w.pPrime.id]);
  return hashed([...rows.map((r) => r.row), ...derived.rows]);
}

/** A special-record dependent row, whole (`to_jsonb`). */
async function dependentRow(sql: Sql, table: 'after_siren_kicks' | 'player_achievements', id: number): Promise<RowSnapshot | null> {
  const [row] = await sql<{ row: RowSnapshot }[]>`SELECT to_jsonb(x.*) AS row FROM ${sql(table)} x WHERE x.id = ${id}`;
  return row?.row ?? null;
}

/** A Family-D Q1 STOP: `expectQ1Stop`, then `guardSnapshot` byte-identical (and, for a Brownlow
 * closure, CD_M's projection rows). */
async function guardQ1Stop(
  ctx: CaseContext, w: World, expected: ExpectedStop, protect: readonly { table: ClosureTable; id: number }[],
  more: { expectOutput?: readonly { label: string; line: string }[]; forbidOutput?: readonly { label: string; line: string }[]; brownlow?: BrownlowClosureRow } = {},
): Promise<void> {
  const before = await guardSnapshot(ctx.owner, w);
  const projectionsBefore = more.brownlow ? await voteSetProjections(ctx.owner, w, more.brownlow.externalRecordId) : null;
  await expectQ1Stop(ctx, w, expected, { protect, expectOutput: more.expectOutput, forbidOutput: more.forbidOutput });
  const after = await guardSnapshot(ctx.owner, w);
  ctx.check(`post: every guard/dependent row (entry state, season authority and totals, after_siren_kicks, player_achievements), every 2092 round row, `
    + `2092 stat_availability and P/P′ derived rows byte-identical (${before.rows.length} row(s)): the STOP wrote nothing`,
  after.sha256 === before.sha256, `${before.sha256} -> ${after.sha256}`);
  if (more.brownlow) {
    ctx.check('post: CD_M\'s projection rows byte-identical',
      canonicalJson(await voteSetProjections(ctx.owner, w, more.brownlow.externalRecordId) as unknown as JsonValue)
        === canonicalJson(projectionsBefore as unknown as JsonValue));
  }
}

/** Build case 1's base plus `mutate` (in one owner transaction, with the settled derived rows), then
 * optionally settle 2092's Brownlow coverage in a second: the Family-C baseline step for a fixture
 * whose guard state touches the Brownlow tables. */
async function buildGuardPms<T>(
  ctx: CaseContext, caseNumber: number, mutate: (tx: TransactionSql, w: World, closure: PmsClosureRow) => Promise<T>,
  options: { brownlowCoverage?: boolean } = {},
): Promise<PmsFixture<T>> {
  const built = await buildPms(ctx, caseNumber, mutate);
  if (options.brownlowCoverage) await ctx.owner.begin((tx) => recomputeBrownlowCoverage(tx, built.w.season));
  return built;
}

/** No Brownlow state for P anywhere and no entry state at M: BG1/BG2/BG3 all absent at the closure row. */
async function brownlowGuardsAbsent(owner: Sql, w: World, closure: PmsClosureRow) {
  const [g] = await owner<{ votes: number | null; pRounds: number; entries: number }[]>`
    SELECT (SELECT brownlow_votes FROM player_match_stats WHERE id = ${closure.rowId}) AS votes,
           (SELECT count(*)::int FROM brownlow_round_votes WHERE player_id = ${w.p.id}) AS "pRounds",
           (SELECT count(*)::int FROM brownlow_vote_entry_state WHERE match_id = ${closure.matchId}) AS entries
  `;
  return g;
}

/** Dependents DP-1..DP-3 at (P, M) and at M: the counts `readDependentsForRow` reads. */
async function dependentsAt(owner: Sql, w: World, matchId: number) {
  const [d] = await owner<{ sirenAtPM: number; achievementAtPM: number; unresolvedAtM: number; matchLessForP: number }[]>`
    SELECT (SELECT count(*)::int FROM after_siren_kicks WHERE player_id = ${w.p.id} AND match_id = ${matchId}) AS "sirenAtPM",
           (SELECT count(*)::int FROM player_achievements WHERE player_id = ${w.p.id} AND match_id = ${matchId}) AS "achievementAtPM",
           (SELECT count(*)::int FROM after_siren_kicks WHERE player_id IS NULL AND match_id = ${matchId})
             + (SELECT count(*)::int FROM player_achievements WHERE player_id IS NULL AND match_id = ${matchId}) AS "unresolvedAtM",
           (SELECT count(*)::int FROM after_siren_kicks WHERE player_id = ${w.p.id} AND match_id IS NULL)
             + (SELECT count(*)::int FROM player_achievements WHERE player_id = ${w.p.id} AND match_id IS NULL) AS "matchLessForP"
  `;
  return d;
}

const printedLines = (stdout: string) => stdout.replace(/\r/g, '').split('\n').map((l) => l.trim());

/** A COMMITTED pms-only Family-D branch: the real CLI (validate-only, apply), then the closure row
 * (same id) at (P′, M) with its contract byte-identical, each `reportLines` entry printed by the
 * phase(s) named, batch K, the ledger row and identity. The case then proves its dependent's row. */
async function commitPmsWithReport(
  ctx: CaseContext, w: World, closure: PmsClosureRow, identityId: number,
  reportLines: readonly { label: string; line: string; phases: readonly ('validate-only' | 'apply')[] }[],
): Promise<Corrected> {
  const { owner, check } = ctx;
  const c = await correct(ctx, w, { rowsPlanned: 1, moved: 1, deleted: 0 });
  const printed = { 'validate-only': printedLines(c.validateStdout), apply: printedLines(c.applyStdout) };
  for (const r of reportLines) {
    for (const phase of r.phases) check(`${phase}: the report carries ${r.label}: "${r.line}"`, printed[phase].includes(r.line));
  }
  const after = await pmsRow(owner, closure.rowId);
  check('post: the closure row (same id) is at (P′, M), contract byte-identical, provenance kept',
    after !== null && after.player_id === w.pPrime.id && after.match_id === closure.matchId
      && rowContractHash(contractOf(after)) === closure.contractSha256 && after.source_record_id === closure.externalRecordId
      && Number(after.import_batch_id) === w.settleBatchId);
  await checkBatchK(ctx, w, c, {
    table: 'player_match_stats', verb: 'update', oldKey: { player_id: w.p.id, match_id: closure.matchId },
    newKey: { player_id: w.pPrime.id, match_id: closure.matchId }, preHash: closure.contractSha256,
  }, { moved: { player_match_stats: 1, brownlow_round_votes: 0 }, deleted: { player_match_stats: 0, brownlow_round_votes: 0 } });
  await checkLedgerAndIdentity(ctx, w, identityId, c);
  await owner.begin('read only', (tx) => assertAflApiIdentityInvariant(tx));
  check('post: the combined identity invariant (SAT-1 basis) holds', true);
  return c;
}

const BG2_DETAIL = 'a foreign brownlow_round_votes row exists for this player at this event';
const BG3_DETAIL = 'the match entry-state names this player in a vote slot';

/* ---- Case 3 ---- */

/** Case 3: case 1 + a MANUAL-owned (admin demote / claim) round row for P at M beside the pms closure
 * row -> STOP `foreign_brownlow_dependency` (BG2) at the pms row. BG1 (brownlow_votes) and BG3
 * (entry state) are absent: only the manual row is under test. */
async function case3(ctx: CaseContext): Promise<void> {
  const { owner, check, variant } = ctx;
  const votes = ({ demote: 0, claim: 3 } as Record<string, 0 | 3>)[variant ?? ''];
  if (votes === undefined) throw new RehearsalRefused('case 3 needs --variant demote | claim');
  const { w, closure, extra } = await buildGuardPms(ctx, 3, async (tx, built, row) => ({
    manualRowId: await manualRoundRow(tx, built, { id: row.matchId, roundNumber: 1 }, votes),
  }), { brownlowCoverage: true });
  const row = await pmsRow(owner, closure.rowId);
  await checkClosureStamp(ctx, w, closure, row);
  const manual = (await rowsById(owner, 'brownlow_round_votes', [extra.manualRowId])).get(extra.manualRowId) ?? null;
  const [{ sourceKey }] = await owner<{ sourceKey: string | null }[]>`
    SELECT s.key AS "sourceKey" FROM brownlow_round_votes b LEFT JOIN sources s ON s.id = b.source_id WHERE b.id = ${extra.manualRowId}
  `;
  check(`pre: brownlow_round_votes#${extra.manualRowId} for P at M is manual_admin_edit-owned exactly as the admin ${variant} leaves it `
    + `(${canonicalJson({ played: true, votes, match_id: closure.matchId })}, entry:${closure.matchId}:r1, import batch NULL)`,
  manual !== null && manual.player_id === w.p.id && manual.match_id === closure.matchId && manual.played === true && manual.votes === votes
      && sourceKey === MANUAL_SOURCE_KEY && manual.source_record_id === entrySourceRecordId(closure.matchId, 1) && manual.import_batch_id === null,
  JSON.stringify(manual));
  const apps = await applicationsAt(owner, 'brownlow_round_votes', { season: w.season, player_id: w.p.id, round_number: 1 });
  check('pre: the manual row has no canonical_applications history (never an AFL API closure row)', apps.length === 0, JSON.stringify(apps.map((a) => a.id)));
  const g = await brownlowGuardsAbsent(owner, w, closure);
  check('pre: BG1 absent (the closure row\'s brownlow_votes is NULL) and BG3 absent (no entry state at M); P\'s only round row is the manual one',
    g.votes === null && g.entries === 0 && g.pRounds === 1, JSON.stringify(g));
  const n = await pmsCounts(owner, w, closure.matchId);
  check('pre: no P′ counterpart at M; P holds exactly the closure row', n.pPrimeAtM === 0 && n.pRows === 1, JSON.stringify(n));
  await settledBaseline(ctx, w);
  await guardQ1Stop(ctx, w, { table: 'player_match_stats', rowId: closure.rowId, step: 'BG2', code: 'foreign_brownlow_dependency', detail: BG2_DETAIL },
    [...pmsRows(closure.rowId), { table: 'brownlow_round_votes', id: extra.manualRowId }]);
}

/* ---- Case 4 ---- */

/**
 * Case 4: case 1 + a `brownlow_vote_entry_state` for M naming P (three-vote slot; two participants
 * A, B in the others) -> STOP `brownlow_entry_names_player` (BG3) at the pms closure row. Draft: the
 * REAL `saveDraftBrownlowMatch` writes it (react-server; a draft writes no canonical fact). Final:
 * the entry-state statement reproduced (`entryStateRow`), since the exported finalise would also
 * write the pms mirror (BG1) and claim P's round row (BG2). BG1 and BG2 are asserted absent.
 */
async function case4(ctx: CaseContext): Promise<void> {
  const { owner, check, variant } = ctx;
  if (variant !== 'draft' && variant !== 'final') throw new RehearsalRefused('case 4 needs --variant draft | final');
  const writers = variant === 'draft' ? await loadWriters() : null;
  const { w, closure, extra } = await buildGuardPms(ctx, 4, async (tx, built, row) => {
    await seasonInProgress(tx, built);
    const a = await insertPlayer(tx, built.caseCode, 'A', built.sourceIds);
    const b = await insertPlayer(tx, built.caseCode, 'B', built.sourceIds);
    await foreignParticipation(tx, built, a.id, row.matchId, built.clubs.home.id, '32');
    await foreignParticipation(tx, built, b.id, row.matchId, built.clubs.away.id, '33');
    if (variant === 'final') await entryStateRow(tx, built, row.matchId, 'final', { three: built.p.id, two: a.id, one: b.id });
    return { a: a.id, b: b.id };
  }, { brownlowCoverage: true });
  if (writers !== null) {
    const result = await writerCall(ctx.importDsn, `${HARNESS_APP}case004-writer-brownlow-draft`, () => writers.saveDraftBrownlowMatch({
      matchId: closure.matchId, selection: { three: w.p.id, two: extra.a, one: extra.b }, expectedRevision: 0, actorId: w.actorId,
      note: 'AFLDB-ISSUE-238 Slice 10 rehearsal case 004: Brownlow draft naming P',
    }));
    console.log(`  writer saveDraftBrownlowMatch: ${JSON.stringify(result)}`);
    check('writer: the real saveDraftBrownlowMatch saved a draft for M (revision 1)', result.ok && result.value.status === 'draft' && result.value.revision === 1,
      JSON.stringify(result));
  }
  const row = await pmsRow(owner, closure.rowId);
  await checkClosureStamp(ctx, w, closure, row);
  const [entry] = await owner<{ row: RowSnapshot }[]>`SELECT to_jsonb(e.*) AS row FROM brownlow_vote_entry_state e WHERE e.match_id = ${closure.matchId}`;
  const e = entry?.row ?? null;
  check(`pre: M's entry state is ${variant}, revision 1, and names P in the three-vote slot (A, B in two/one)`
    + (variant === 'final' ? ', finalised (by, at, revision 1)' : ', not finalised'),
  e !== null && e.status === variant && e.revision === 1 && e.three_player_id === w.p.id && e.two_player_id === extra.a && e.one_player_id === extra.b
      && (variant === 'final' ? e.finalised_by === w.actorId && e.finalised_at !== null && e.finalised_revision === 1
        : e.finalised_by === null && e.finalised_at === null && e.finalised_revision === null),
  JSON.stringify(e));
  if (variant === 'draft') {
    const audits = await owner<{ fieldGroup: string }[]>`
      SELECT field_group AS "fieldGroup" FROM data_edits WHERE table_name = 'brownlow_vote_entry_state' AND row_id = ${closure.matchId}
    `;
    check('pre: the writer\'s production audit exists: exactly one data_edits brownlow_vote_entry_state/draft row for M',
      audits.length === 1 && audits[0].fieldGroup === 'draft', JSON.stringify(audits));
  }
  const g = await brownlowGuardsAbsent(owner, w, closure);
  check('pre: BG1 absent (the closure row\'s brownlow_votes is NULL; a draft or reproduced entry writes no mirror) and BG2 absent (P has no round row)',
    g.votes === null && g.pRounds === 0 && g.entries === 1, JSON.stringify(g));
  const n = await pmsCounts(owner, w, closure.matchId);
  check('pre: no P′ counterpart at M; P holds exactly the closure row', n.pPrimeAtM === 0 && n.pRows === 1, JSON.stringify(n));
  await settledBaseline(ctx, w);
  await guardQ1Stop(ctx, w, { table: 'player_match_stats', rowId: closure.rowId, step: 'BG3', code: 'brownlow_entry_names_player', detail: BG3_DETAIL },
    pmsRows(closure.rowId));
}

/* ---- Case 17 ---- */

/**
 * Case 17: an admin Brownlow edit on a closure row, by the REAL admin writers (react-server; 2092
 * in progress, M's line-up complete at 18 + 18 so the §27.6 precondition holds). Two branches:
 *   - votes-written: case 1's base; a real FINALISE of M selecting three other participants writes
 *     the per-match mirror, so P's closure row gets `brownlow_votes = 0` ("played, polled nothing").
 *     P is not selected, so no round row is claimed for P (no BG2) and the entry state does not name
 *     P (no BG3) -> STOP `brownlow_state_present` (P6, the §5.2 statement of BG1; it precedes P7's
 *     `out_of_ledger_edit` for the same field);
 *   - round-reowned: case 83's paired base (CD_I's round row with 3 votes and its pms row at M); a
 *     real VOID of M withdraws every value on M, re-owning CD_I's round row to `manual_admin_edit`
 *     (`entry:<M>:r1`, votes NULL, batch NULL); the mirror is untouched (already NULL, no BG1) and the
 *     void entry state names nobody (no BG3). The re-owned row is now foreign (C11) and blocks the pms
 *     closure row at its event -> STOP `foreign_brownlow_dependency` (BG2).
 */
async function case17(ctx: CaseContext): Promise<void> {
  const { owner, check, variant } = ctx;
  if (variant !== 'votes-written' && variant !== 'round-reowned') throw new RehearsalRefused('case 17 needs --variant votes-written | round-reowned');
  const writers = await loadWriters();
  if (variant === 'votes-written') {
    const built = await owner.begin(async (tx) => {
      const w = await world(tx, 17);
      await seasonInProgress(tx, w);
      const closure = await pmsClosureRow(tx, w, 1);
      const fillers = await fillLineUp(tx, w, closure.matchId);
      await settleDerived(tx, w, { brownlow: true });
      return { w, closure, fillers };
    }) as unknown as { w: World; closure: PmsClosureRow; fillers: { home: number[]; away: number[] } };
    const { w, closure, fillers } = built;
    logPmsFixture(w, closure);
    const before = await pmsRow(owner, closure.rowId);
    await checkClosureStamp(ctx, w, closure, before);
    check('pre (before the admin edit): the closure row\'s brownlow_votes is NULL and its contract is the settled one: a valid case-1 base',
      before !== null && before.brownlow_votes === null && rowContractHash(contractOf(before)) === closure.contractSha256);
    const selection = { three: fillers.away[0], two: fillers.home[0], one: fillers.away[1] };
    const result = await writerCall(ctx.importDsn, `${HARNESS_APP}case017-writer-finalise`, () => writers.finaliseBrownlowMatch({
      matchId: closure.matchId, selection, expectedRevision: 0, actorId: w.actorId,
      note: 'AFLDB-ISSUE-238 Slice 10 rehearsal case 017: admin finalise of M (P not selected)',
    }));
    console.log(`  writer finaliseBrownlowMatch: ${JSON.stringify(result)}`);
    check('writer: the real finaliseBrownlowMatch finalised M (revision 1), P not among the selected', result.ok && result.value.status === 'final'
      && result.value.revision === 1 && ![selection.three, selection.two, selection.one].includes(w.p.id), JSON.stringify(result));
    const edited = await pmsRow(owner, closure.rowId);
    check('pre: the SAME closure row, still at (P, M), now brownlow_votes = 0 (the real mirror); every other contract field as settled',
      edited !== null && edited.player_id === w.p.id && edited.brownlow_votes === 0
        && rowContractHash({ ...contractOf(edited), brownlow_votes: null }) === closure.contractSha256, JSON.stringify(edited && { brownlow_votes: edited.brownlow_votes }));
    check('pre: ownership and stamps untouched by the admin edit (afl_api, <CD_M>|<team>|CD_I, settle batch)',
      edited !== null && before !== null && edited.source_id === before.source_id && edited.source_record_id === before.source_record_id
        && edited.import_batch_id === before.import_batch_id);
    const claimed = await owner<{ playerId: number; votes: number; sourceKey: string; sourceRecordId: string }[]>`
      SELECT b.player_id AS "playerId", b.votes::int AS votes, s.key AS "sourceKey", b.source_record_id AS "sourceRecordId"
        FROM brownlow_round_votes b JOIN sources s ON s.id = b.source_id WHERE b.match_id = ${closure.matchId} ORDER BY b.votes DESC
    `;
    check('pre: the finalise claimed exactly the three selected players\' round rows at M (manual_admin_edit, entry:<M>:r1)',
      canonicalJson(claimed as unknown as JsonValue) === canonicalJson([
        { playerId: selection.three, votes: 3, sourceKey: MANUAL_SOURCE_KEY, sourceRecordId: entrySourceRecordId(closure.matchId, 1) },
        { playerId: selection.two, votes: 2, sourceKey: MANUAL_SOURCE_KEY, sourceRecordId: entrySourceRecordId(closure.matchId, 1) },
        { playerId: selection.one, votes: 1, sourceKey: MANUAL_SOURCE_KEY, sourceRecordId: entrySourceRecordId(closure.matchId, 1) },
      ]), JSON.stringify(claimed));
    const [entry] = await owner<{ status: string; names: boolean }[]>`
      SELECT status, (three_player_id = ${w.p.id} OR two_player_id = ${w.p.id} OR one_player_id = ${w.p.id}) AS names
        FROM brownlow_vote_entry_state WHERE match_id = ${closure.matchId}
    `;
    const g = await brownlowGuardsAbsent(owner, w, closure);
    check('pre: BG2 absent (P holds no round row) and BG3 absent (the final entry state does not name P): only BG1 is under test',
      g.pRounds === 0 && entry?.status === 'final' && entry.names === false, JSON.stringify({ ...g, entry }));
    const audits = await owner<{ fieldGroup: string }[]>`
      SELECT field_group AS "fieldGroup" FROM data_edits WHERE table_name = 'brownlow_vote_entry_state' AND row_id = ${closure.matchId}
    `;
    check('pre: the writer\'s production audit exists (data_edits brownlow_vote_entry_state/finalise for M)',
      audits.length === 1 && audits[0].fieldGroup === 'finalise', JSON.stringify(audits));
    await settledBaseline(ctx, w);
    await guardQ1Stop(ctx, w, { table: 'player_match_stats', rowId: closure.rowId, step: 'P6', code: 'brownlow_state_present', detail: 'brownlow_votes is not NULL' },
      pmsRows(closure.rowId));
    return;
  }

  const fx = await buildBrownlow(ctx, 17, async (tx, w) => {
    await seasonInProgress(tx, w);
    const closure = await brownlowClosureRow(tx, w, 1);
    const pairedPms = await pmsClosureRow(tx, w, 1, closure.match);
    const [v2, v3] = closure.companions;
    await foreignParticipation(tx, w, v2.playerId, closure.match.id, w.clubs.away.id, '32');
    await foreignParticipation(tx, w, v3.playerId, closure.match.id, w.clubs.home.id, '33');
    await fillLineUp(tx, w, closure.match.id);
    return { closure, pairedPms };
  });
  const { w, closure, pairedPms } = fx;
  const identityId = await checkBrownlowClosurePre(ctx, w, closure, w.settleBatchId);
  await checkClosureStamp(ctx, w, pairedPms, await pmsRow(owner, pairedPms.rowId));
  check('pre (before the admin edit): the paired base is case 83\'s (CD_I\'s round row with 3 at M and its pms row at M; no P′ row at M)',
    identityId > 0 && (await pmsCounts(owner, w, closure.match.id)).pPrimeAtM === 0);
  const result = await writerCall(ctx.importDsn, `${HARNESS_APP}case017-writer-void`, () => writers.voidBrownlowMatch({
    matchId: closure.match.id, expectedRevision: 0, actorId: w.actorId,
    reason: 'AFLDB-ISSUE-238 Slice 10 rehearsal case 017: admin void of M (re-owns every round row holding a value)',
  }));
  console.log(`  writer voidBrownlowMatch: ${JSON.stringify(result)}`);
  check('writer: the real voidBrownlowMatch voided M (revision 1)', result.ok && result.value.status === 'void' && result.value.revision === 1, JSON.stringify(result));
  const reowned = (await rowsById(owner, 'brownlow_round_votes', [closure.rowId])).get(closure.rowId) ?? null;
  const [{ sourceKey }] = await owner<{ sourceKey: string | null }[]>`
    SELECT s.key AS "sourceKey" FROM brownlow_round_votes b LEFT JOIN sources s ON s.id = b.source_id WHERE b.id = ${closure.rowId}
  `;
  check(`pre: the SAME round row (#${closure.rowId}, still P at M) is RE-OWNED by the void: manual_admin_edit, entry:<M>:r1, import batch NULL, votes NULL, played kept`,
    reowned !== null && reowned.player_id === w.p.id && reowned.match_id === closure.match.id && sourceKey === MANUAL_SOURCE_KEY
      && reowned.source_record_id === entrySourceRecordId(closure.match.id, 1) && reowned.import_batch_id === null
      && reowned.votes === null && reowned.played === true, JSON.stringify(reowned));
  await checkBrownlowChain(ctx, closure, 'still only the settle\'s CD_M insert (the admin edit writes no application)', [insertOf(closure, w.settleBatchId)]);
  const pmsNow = await pmsRow(owner, pairedPms.rowId);
  const [entry] = await owner<{ status: string; three: number | null; two: number | null; one: number | null }[]>`
    SELECT status, three_player_id AS three, two_player_id AS two, one_player_id AS one FROM brownlow_vote_entry_state WHERE match_id = ${closure.match.id}
  `;
  check('pre: BG1 absent (the pms closure row\'s brownlow_votes still NULL, contract as settled) and BG3 absent (the void entry state names nobody)',
    pmsNow !== null && pmsNow.brownlow_votes === null && rowContractHash(contractOf(pmsNow)) === pairedPms.contractSha256
      && entry?.status === 'void' && entry.three === null && entry.two === null && entry.one === null, JSON.stringify({ entry }));
  await settledBaseline(ctx, w);
  await guardQ1Stop(ctx, w, { table: 'player_match_stats', rowId: pairedPms.rowId, step: 'BG2', code: 'foreign_brownlow_dependency', detail: BG2_DETAIL },
    [...pmsRows(pairedPms.rowId), ...brownlowRows(closure)], { brownlow: closure });
}

/* ---- Case 18 ---- */

/** Case 18: case 1 + an `after_siren_kicks` row for (P, M) -> STOP `dependent_record_would_be_stale`
 * (DP-1); separately, an UNRESOLVED row (player NULL) at M -> the correction COMMITS and reports it
 * (DP-3), the row untouched. */
async function case18(ctx: CaseContext): Promise<void> {
  const { owner, check, variant } = ctx;
  if (variant !== 'after-siren' && variant !== 'unresolved') throw new RehearsalRefused('case 18 needs --variant after-siren | unresolved');
  const { w, closure, extra } = await buildGuardPms(ctx, 18, async (tx, built, row) => ({
    kickId: await afterSirenKick(tx, built, { playerId: variant === 'after-siren' ? built.p.id : null, matchId: row.matchId, n: 1 }),
  }));
  const row = await pmsRow(owner, closure.rowId);
  const identityId = await checkClosureStamp(ctx, w, closure, row);
  const kick = await dependentRow(owner, 'after_siren_kicks', extra.kickId);
  const d = await dependentsAt(owner, w, closure.matchId);
  const g = await brownlowGuardsAbsent(owner, w, closure);
  check('pre: no Brownlow state for P and no entry state at M (nothing ahead of the dependents can stop the row)',
    g.votes === null && g.pRounds === 0 && g.entries === 0, JSON.stringify(g));
  const n = await pmsCounts(owner, w, closure.matchId);
  check('pre: no P′ counterpart at M; P holds exactly the closure row', n.pPrimeAtM === 0 && n.pRows === 1, JSON.stringify(n));
  if (variant === 'after-siren') {
    check(`pre: after_siren_kicks#${extra.kickId} is a linked (unique) premiership kick of P at M; it is the ONLY dependent (DP-1 1, DP-2 0, DP-3 0, match-less 0)`,
      kick !== null && kick.player_id === w.p.id && kick.match_id === closure.matchId && kick.link_status_value === 'unique'
        && d.sirenAtPM === 1 && d.achievementAtPM === 0 && d.unresolvedAtM === 0 && d.matchLessForP === 0, JSON.stringify(d));
    await guardQ1Stop(ctx, w, {
      table: 'player_match_stats', rowId: closure.rowId, step: 'DP-1', code: 'dependent_record_would_be_stale',
      detail: 'an after_siren_kicks row depends on this participation',
    }, pmsRows(closure.rowId));
    return;
  }
  check(`pre: after_siren_kicks#${extra.kickId} at M is UNRESOLVED (player NULL, ambiguous, 2 candidates); it is the only dependent (DP-1 0, DP-2 0, DP-3 1)`,
    kick !== null && kick.player_id === null && kick.match_id === closure.matchId && kick.link_status_value === 'ambiguous'
      && d.sirenAtPM === 0 && d.achievementAtPM === 0 && d.unresolvedAtM === 1 && d.matchLessForP === 0, JSON.stringify(d));
  const dp3 = `DP-3 REPORT: unresolved after_siren_kicks#${extra.kickId} at match ${closure.matchId} (closure row player_match_stats#${closure.rowId}): its resolution evidence changes`;
  await commitPmsWithReport(ctx, w, closure, identityId, [
    { label: 'the DP-3 report naming the unresolved row', line: dp3, phases: ['validate-only', 'apply'] },
    { label: 'the plan report DP-3 line', line: `player_match_stats#${closure.rowId}: DP-3: an unresolved dependent row exists at this match`, phases: ['validate-only', 'apply'] },
  ]);
  const kickAfter = await dependentRow(owner, 'after_siren_kicks', extra.kickId);
  check('post: the unresolved after_siren_kicks row is byte-identical (report only: still player NULL at M, never resolved or rewritten)',
    canonicalJson(kickAfter) === canonicalJson(kick), JSON.stringify(kickAfter && { player_id: kickAfter.player_id, match_id: kickAfter.match_id }));
}

/* ---- Case 19 ---- */

/** Case 19: case 1 + a `player_achievements` `first_kick_goal` row for (P, M) -> STOP (DP-2);
 * separately, a P′ debut-match change (P′'s first_kick_goal row at its current debut M2, and M is
 * earlier) -> the correction COMMITS and reports DP-5; the achievement row is untouched. */
async function case19(ctx: CaseContext): Promise<void> {
  const { owner, check, variant } = ctx;
  if (variant !== 'achievement' && variant !== 'debut-change') throw new RehearsalRefused('case 19 needs --variant achievement | debut-change');
  const { w, closure, extra } = await buildGuardPms(ctx, 19, async (tx, built, row) => {
    if (variant === 'achievement') {
      return { fkgId: await firstKickGoal(tx, built, { id: built.p.id, role: 'P' }, { id: row.matchId, roundNumber: 1 }, 1), m2: null, m2RowId: null };
    }
    const m2 = await fixtureMatch(tx, built, 2, 2);
    const m2RowId = await foreignParticipation(tx, built, built.pPrime.id, m2.id, built.clubs.home.id);
    return { fkgId: await firstKickGoal(tx, built, { id: built.pPrime.id, role: 'Pprime' }, m2, 2), m2, m2RowId };
  });
  const row = await pmsRow(owner, closure.rowId);
  const identityId = await checkClosureStamp(ctx, w, closure, row);
  const fkg = await dependentRow(owner, 'player_achievements', extra.fkgId);
  const d = await dependentsAt(owner, w, closure.matchId);
  const g = await brownlowGuardsAbsent(owner, w, closure);
  check('pre: no Brownlow state for P and no entry state at M', g.votes === null && g.pRounds === 0 && g.entries === 0, JSON.stringify(g));
  if (variant === 'achievement') {
    check(`pre: player_achievements#${extra.fkgId} is P's linked first_kick_goal at M; the ONLY dependent (DP-1 0, DP-2 1, DP-3 0, match-less 0)`,
      fkg !== null && fkg.achievement_type === 'first_kick_goal' && fkg.player_id === w.p.id && fkg.match_id === closure.matchId
        && d.sirenAtPM === 0 && d.achievementAtPM === 1 && d.unresolvedAtM === 0 && d.matchLessForP === 0, JSON.stringify(d));
    await guardQ1Stop(ctx, w, {
      table: 'player_match_stats', rowId: closure.rowId, step: 'DP-2', code: 'dependent_record_would_be_stale',
      detail: 'a player_achievements row depends on this participation',
    }, pmsRows(closure.rowId));
    return;
  }
  const m2 = extra.m2!;
  const debutOf = async (playerId: number) => owner<{ matchId: number; careerGameNo: number | null }[]>`
    SELECT p.match_id AS "matchId", p.career_game_no AS "careerGameNo" FROM player_match_stats p JOIN matches m ON m.id = p.match_id
     WHERE p.player_id = ${playerId} ORDER BY m.match_date, m.id
  `;
  const pPrimeBefore = await debutOf(w.pPrime.id);
  check(`pre: P′'s career is only M2=${m2.id} (career_game_no 1, a later date than M); player_achievements#${extra.fkgId} is P′'s first_kick_goal AT M2 (its debut)`,
    canonicalJson(pPrimeBefore) === canonicalJson([{ matchId: m2.id, careerGameNo: 1 }]) && fkg !== null && fkg.player_id === w.pPrime.id
      && fkg.match_id === m2.id && fkg.achievement_type === 'first_kick_goal', JSON.stringify(pPrimeBefore));
  check('pre: no dependent at (P, M) or at M, none match-less for P (DP-1..DP-4 all absent); P has no first_kick_goal row',
    d.sirenAtPM === 0 && d.achievementAtPM === 0 && d.unresolvedAtM === 0 && d.matchLessForP === 0, JSON.stringify(d));
  const n = await pmsCounts(owner, w, closure.matchId);
  check('pre: no P′ counterpart at M; P holds exactly the closure row', n.pPrimeAtM === 0 && n.pRows === 1, JSON.stringify(n));
  const dp5 = `DP-5 REPORT: first_kick_goal player_achievements#${extra.fkgId} for P′ (player ${w.pPrime.id}): debut match ${m2.id} -> ${closure.matchId}; `
    + 'the importer\'s tie-break evidence changes (import-first-kick-goal.ts:446-457)';
  await commitPmsWithReport(ctx, w, closure, identityId, [
    { label: 'the DP-5 debut-change report (prospective)', line: dp5, phases: ['validate-only'] },
    { label: 'the DP-5 debut-change report (committed)', line: dp5, phases: ['apply'] },
  ]);
  const fkgAfter = await dependentRow(owner, 'player_achievements', extra.fkgId);
  check('post: the first_kick_goal row is byte-identical (report only: still P′ at M2, never re-pointed)', canonicalJson(fkgAfter) === canonicalJson(fkg));
  const pPrimeAfter = await debutOf(w.pPrime.id);
  check(`post: the change the report names is real: P′'s debut (career_game_no 1) is now M=${closure.matchId} (the moved row), M2 re-sequenced to 2`,
    canonicalJson(pPrimeAfter) === canonicalJson([{ matchId: closure.matchId, careerGameNo: 1 }, { matchId: m2.id, careerGameNo: 2 }]), JSON.stringify(pPrimeAfter));
}

/* ---- Case 56 ---- */

/**
 * Case 56 (SV-1): a season PUBLISHED by the REAL `publishBrownlowSeason` (react-server; 2092 in
 * progress, every home-and-away match accounted 3/2/1, every polled player with a season games row)
 * -> STOP `season_total_depends_on_correction`. SV-1 has two disjuncts; each branch drives one:
 *   - round-vote: case 5's Brownlow base (CD_I's 3-vote round row at M, P′ participation), with
 *     P's, V2's and V3's games from foreign participation at M -> the closure MOVEs a positive round
 *     vote in the season (P, as a polled player, is necessarily in the totals too; both checks print);
 *   - games: case 1's base (a pms MOVE of one of P's games); P polls at another match M2 (foreign
 *     rows, round 2, not M's event: no BG2), so P is in the totals; CD_I holds no round row -> only
 *     "P or P′ has a brownlow_season_votes row" fires; the positive-round-vote check must not.
 */
async function case56(ctx: CaseContext): Promise<void> {
  const { owner, check, variant } = ctx;
  if (variant !== 'round-vote' && variant !== 'games') throw new RehearsalRefused('case 56 needs --variant round-vote | games');
  const writers = await loadWriters();
  const seasonLine = `season ${R.season}: STOP SV-1 (admin_published) [SV-1] season_total_depends_on_correction: not proven independent: the admin-published season depends on the corrected facts`;
  const positiveLine = 'failed: SV-1: the closure moves or deletes a Brownlow round row with votes > 0 in this season';
  const totalsLine = 'failed: SV-1: P or P′ has a brownlow_season_votes row in this season (its games input changes)';
  const sv1: ExpectedStop = { table: 'player_match_stats', rowId: null, step: 'SV-1', code: 'season_total_depends_on_correction' };

  const publish = async (w: World, expectedRows: number) => {
    const result = await writerCall(ctx.importDsn, `${HARNESS_APP}case056-writer-publish`, () => writers.publishBrownlowSeason({
      season: w.season, ineligiblePlayerIds: [], expectedRevision: 0, actorId: w.actorId,
      note: 'AFLDB-ISSUE-238 Slice 10 rehearsal case 056: publish 2092',
    }));
    console.log(`  writer publishBrownlowSeason: ${JSON.stringify(result)}`);
    // A never-administered season's first publication is revision 2: `lockSeasonAuthority` inserts
    // the authority row at its default revision 1 and the publication takes revision + 1.
    check(`writer: the real publishBrownlowSeason published 2092 (the first publication: revision 2; ${expectedRows} season rows)`,
      result.ok && result.value.revision === 2 && result.value.rowCount === expectedRows, JSON.stringify(result));
    const revision = result.ok ? result.value.revision : -1;
    const rows = await owner<{ playerId: number; votes: number; sourceKey: string; sourceRecordId: string }[]>`
      SELECT b.player_id AS "playerId", b.votes::int AS votes, s.key AS "sourceKey", b.source_record_id AS "sourceRecordId"
        FROM brownlow_season_votes b JOIN sources s ON s.id = b.source_id WHERE b.season = ${w.season} ORDER BY b.player_id
    `;
    const [authority] = await owner<{ publishedRevision: number | null }[]>`
      SELECT published_revision AS "publishedRevision" FROM brownlow_season_authority WHERE season = ${w.season}
    `;
    check(`pre: 2092 is ADMIN-PUBLISHED (SV-1's class, bound to the CURRENT revision): published_revision ${revision}, and every season row `
      + `manual_admin_edit stamped ${publishSourceRecordId(w.season, revision)}`,
    authority?.publishedRevision === revision && rows.length === expectedRows
        && rows.every((r) => r.sourceKey === MANUAL_SOURCE_KEY && r.sourceRecordId === publishSourceRecordId(w.season, revision)), JSON.stringify({ authority, rows }));
    return rows;
  };

  if (variant === 'round-vote') {
    const fx = await buildBrownlow(ctx, 56, async (tx, w) => {
      await seasonInProgress(tx, w);
      const closure = await brownlowClosureRow(tx, w, 1);
      const [v2, v3] = closure.companions;
      const participationRowIds = [
        await participation(tx, w, w.pPrime.id, closure.match.id),
        await foreignParticipation(tx, w, w.p.id, closure.match.id, w.clubs.home.id, '32'),
        await foreignParticipation(tx, w, v2.playerId, closure.match.id, w.clubs.away.id, '33'),
        await foreignParticipation(tx, w, v3.playerId, closure.match.id, w.clubs.home.id, '34'),
      ];
      await recomputePlayerDerivedStats(tx, [v2.playerId, v3.playerId], w.season);
      return { closure, participationRowIds };
    });
    const { w, closure } = fx;
    await checkBrownlowClosurePre(ctx, w, closure, w.settleBatchId);
    const proof = await payloadProofAt(owner, w, closure, 1);
    check('pre: B1-B5 hold (payload names CD_I once with 3; CD_I\'s projection names P); P′ plays M (C1c); no P′ round row (C1 MOVE)',
      proof.count === 1 && proof.vote === 3 && canonicalJson(await participationAt(owner, w.pPrime.id, [closure.match.id])) === canonicalJson([closure.match.id])
        && (await owner<{ n: number }[]>`SELECT count(*)::int AS n FROM brownlow_round_votes WHERE player_id = ${w.pPrime.id}`)[0].n === 0);
    const rows = await publish(w, 3);
    const [{ pRounds, entries }] = await owner<{ pRounds: number; entries: number }[]>`
      SELECT (SELECT count(*)::int FROM brownlow_round_votes WHERE player_id = ${w.p.id}) AS "pRounds",
             (SELECT count(*)::int FROM brownlow_vote_entry_state WHERE season = ${w.season}) AS entries
    `;
    check('pre: the season rows are the vote set (P 3, V2 2, V3 1); P\'s only round row is the closure row (no BG2); no entry state (no BG3)',
      canonicalJson(rows.map((r) => [r.playerId, r.votes])) === canonicalJson([[w.p.id, 3], [closure.companions[0].playerId, 2], [closure.companions[1].playerId, 1]]
        .sort((a, b) => a[0] - b[0])) && pRounds === 1 && entries === 0, JSON.stringify({ pRounds, entries }));
    await settledBaseline(ctx, w);
    await guardQ1Stop(ctx, w, sv1, [...brownlowRows(closure), ...pmsRows(...fx.participationRowIds)], {
      brownlow: closure,
      expectOutput: [
        { label: 'the SV-1 season verdict', line: seasonLine },
        { label: 'the positive-round-vote SV-1 check (the disjunct under test)', line: positiveLine },
        { label: 'the P-in-totals SV-1 check (P polled)', line: totalsLine },
      ],
    });
    return;
  }

  const built = await owner.begin(async (tx) => {
    const w = await world(tx, 56);
    await seasonInProgress(tx, w);
    const closure = await pmsClosureRow(tx, w, 1);
    const m = { id: closure.matchId, roundNumber: 1 };
    const a = await insertPlayer(tx, w.caseCode, 'A', w.sourceIds);
    const b = await insertPlayer(tx, w.caseCode, 'B', w.sourceIds);
    const cc = await insertPlayer(tx, w.caseCode, 'C', w.sourceIds);
    const m2 = await fixtureMatch(tx, w, 2, 2);
    const foreignPms = [
      await foreignParticipation(tx, w, a.id, m.id, w.clubs.home.id, '32'),
      await foreignParticipation(tx, w, b.id, m.id, w.clubs.away.id, '33'),
      await foreignParticipation(tx, w, cc.id, m.id, w.clubs.home.id, '34'),
      await foreignParticipation(tx, w, w.p.id, m2.id, w.clubs.home.id, '23'),
      await foreignParticipation(tx, w, a.id, m2.id, w.clubs.home.id, '32'),
      await foreignParticipation(tx, w, b.id, m2.id, w.clubs.away.id, '33'),
    ];
    const roundRows = [
      await foreignRoundRow(tx, w, a.id, m, 3), await foreignRoundRow(tx, w, b.id, m, 2), await foreignRoundRow(tx, w, cc.id, m, 1),
      await foreignRoundRow(tx, w, w.p.id, m2, 3), await foreignRoundRow(tx, w, a.id, m2, 2), await foreignRoundRow(tx, w, b.id, m2, 1),
    ];
    await settleDerived(tx, w, { brownlow: true });
    await recomputePlayerDerivedStats(tx, [a.id, b.id, cc.id], w.season);
    return { w, closure, m2, foreignPms, roundRows, pM2RoundRow: roundRows[3] };
  }) as unknown as { w: World; closure: PmsClosureRow; m2: FixtureMatch; foreignPms: number[]; roundRows: number[]; pM2RoundRow: number };
  const { w, closure, m2 } = built;
  logPmsFixture(w, closure);
  const row = await pmsRow(owner, closure.rowId);
  await checkClosureStamp(ctx, w, closure, row);
  const rows = await publish(w, 4);
  const pRound = (await rowsById(owner, 'brownlow_round_votes', [built.pM2RoundRow])).get(built.pM2RoundRow) ?? null;
  const [{ cdIRounds, entries }] = await owner<{ cdIRounds: number; entries: number }[]>`
    SELECT (SELECT count(*)::int FROM brownlow_round_votes b JOIN sources s ON s.id = b.source_id WHERE s.key = 'afl_api' AND b.season = ${w.season}) AS "cdIRounds",
           (SELECT count(*)::int FROM brownlow_vote_entry_state WHERE season = ${w.season}) AS entries
  `;
  check(`pre: P is in the published totals (3 votes, polled at M2=${m2.id}); P′ is not; no afl_api round row in 2092 (no Brownlow closure row: the positive-vote disjunct cannot hold); no entry state`,
    rows.some((r) => r.playerId === w.p.id && r.votes === 3) && !rows.some((r) => r.playerId === w.pPrime.id) && cdIRounds === 0 && entries === 0,
    JSON.stringify({ rows: rows.map((r) => [r.playerId, r.votes]), cdIRounds, entries }));
  check(`pre: P's only round row (#${built.pM2RoundRow}) is foreign at M2, round 2 -- not the closure row's event (M, round 1): no BG2 at M`,
    pRound !== null && pRound.player_id === w.p.id && pRound.match_id === m2.id && pRound.round_number === 2
      && (await owner<{ n: number }[]>`SELECT count(*)::int AS n FROM brownlow_round_votes WHERE player_id = ${w.p.id}`)[0].n === 1
      && row !== null && row.brownlow_votes === null, JSON.stringify(pRound));
  const n = await pmsCounts(owner, w, closure.matchId);
  check('pre: no P′ counterpart at M; P holds the closure row and the foreign M2 row', n.pPrimeAtM === 0 && n.pRows === 2, JSON.stringify(n));
  await settledBaseline(ctx, w);
  await guardQ1Stop(ctx, w, sv1, [...pmsRows(closure.rowId, ...built.foreignPms), ...built.roundRows.map((id) => ({ table: 'brownlow_round_votes' as const, id }))], {
    expectOutput: [
      { label: 'the SV-1 season verdict', line: seasonLine },
      { label: 'the P-in-totals SV-1 check (the disjunct under test)', line: totalsLine },
    ],
    forbidOutput: [{ label: 'the positive-round-vote SV-1 check', line: positiveLine }],
  });
}

/* ---- Case 84 ---- */

/**
 * Case 84: case 5's Brownlow-ONLY base (CD_I's round row with 3 at M, P′ participation, no pms row
 * of P anywhere) + an entry state for M naming P (draft; final) -> STOP `brownlow_entry_names_player`
 * (BG3) at the ROUND row; the entry state is not rewritten. Not case 4 again: case 4 is BG3 on a
 * `player_match_stats` closure row (the planner's pms loop, `readEntryStateNamesPlayer(M, P)` for
 * the row's match); this is BG3 on a `brownlow_round_votes` closure row (the Brownlow loop, over the
 * row's event), in the topology where P has no participation at M at all -- so the exported draft
 * cannot name P (not a participant) and both variants reproduce the entry-state statement.
 */
async function case84(ctx: CaseContext): Promise<void> {
  const { owner, check, variant } = ctx;
  if (variant !== 'draft' && variant !== 'final') throw new RehearsalRefused('case 84 needs --variant draft | final');
  const fx = await buildBrownlow(ctx, 84, async (tx, w) => {
    const closure = await brownlowClosureRow(tx, w, 1);
    const participationRowId = await participation(tx, w, w.pPrime.id, closure.match.id);
    await entryStateRow(tx, w, closure.match.id, variant, { three: w.p.id, two: closure.companions[0].playerId, one: closure.companions[1].playerId });
    return { closure, participationRowId };
  });
  const { w, closure } = fx;
  await checkBrownlowClosurePre(ctx, w, closure, w.settleBatchId);
  const proof = await payloadProofAt(owner, w, closure, 1);
  check('pre: B1-B5 hold on the round row (payload names CD_I once with 3; CD_I\'s projection names P)',
    proof.count === 1 && proof.vote === 3
      && (await voteSetProjections(owner, w, closure.externalRecordId)).some((p) => p.providerPlayerId === w.providerId && p.playerId === w.p.id));
  const [t] = await owner<{ pPms: number; pRounds: number; pPrimeRounds: number }[]>`
    SELECT (SELECT count(*)::int FROM player_match_stats WHERE player_id = ${w.p.id}) AS "pPms",
           (SELECT count(*)::int FROM brownlow_round_votes WHERE player_id = ${w.p.id}) AS "pRounds",
           (SELECT count(*)::int FROM brownlow_round_votes WHERE player_id = ${w.pPrime.id}) AS "pPrimeRounds"
  `;
  check('pre: Brownlow-ONLY topology: P holds no player_match_stats row at all; P′ plays M (C1c holds); no P′ round row (C1); '
    + 'P\'s only round row is the closure row (no BG2)',
  t.pPms === 0 && t.pRounds === 1 && t.pPrimeRounds === 0
      && canonicalJson(await participationAt(owner, w.pPrime.id, [closure.match.id])) === canonicalJson([closure.match.id]), JSON.stringify(t));
  const [entry] = await owner<{ row: RowSnapshot }[]>`SELECT to_jsonb(e.*) AS row FROM brownlow_vote_entry_state e WHERE e.match_id = ${closure.match.id}`;
  const e = entry?.row ?? null;
  check(`pre: M's entry state is ${variant}, revision 1, naming P (three), V2 (two), V3 (one)`,
    e !== null && e.status === variant && e.revision === 1 && e.three_player_id === w.p.id
      && e.two_player_id === closure.companions[0].playerId && e.one_player_id === closure.companions[1].playerId, JSON.stringify(e));
  await settledBaseline(ctx, w);
  await guardQ1Stop(ctx, w, { table: 'brownlow_round_votes', rowId: closure.rowId, step: 'BG3', code: 'brownlow_entry_names_player', detail: BG3_DETAIL },
    [...brownlowRows(closure), ...pmsRows(fx.participationRowId)], { brownlow: closure });
  const [after] = await owner<{ row: RowSnapshot }[]>`SELECT to_jsonb(e.*) AS row FROM brownlow_vote_entry_state e WHERE e.match_id = ${closure.match.id}`;
  check('post: the entry state is NOT rewritten (byte-identical; still names P)', canonicalJson(after?.row ?? null) === canonicalJson(e));
}

/* ---- Case 85 ---- */

/**
 * Case 85 (DP-4): case 1 + a MATCH-LESS `after_siren_kicks` row for P (a 2092 pre-season kick for the
 * home club, resolved by club-season participation):
 *   - loses-participation: the closure row is P's only 2092 participation for that club; the MOVE
 *     removes it -> STOP `dependent_record_would_be_stale` (DP-4, plan level);
 *   - keeps-participation: P also plays M2 (2092, home club) through a foreign row -> the
 *     correction COMMITS; the dependent is reported as affected and still valid, untouched.
 */
async function case85(ctx: CaseContext): Promise<void> {
  const { owner, check, variant } = ctx;
  if (variant !== 'loses-participation' && variant !== 'keeps-participation') {
    throw new RehearsalRefused('case 85 needs --variant loses-participation | keeps-participation');
  }
  const { w, closure, extra } = await buildGuardPms(ctx, 85, async (tx, built) => {
    const kickId = await afterSirenKick(tx, built, { playerId: built.p.id, matchId: null, n: 1 });
    if (variant === 'loses-participation') return { kickId, m2: null, m2RowId: null };
    const m2 = await fixtureMatch(tx, built, 2, 2);
    return { kickId, m2, m2RowId: await foreignParticipation(tx, built, built.p.id, m2.id, built.clubs.home.id) };
  });
  const row = await pmsRow(owner, closure.rowId);
  const identityId = await checkClosureStamp(ctx, w, closure, row);
  const kick = await dependentRow(owner, 'after_siren_kicks', extra.kickId);
  const [org] = await owner<{ homeOrg: number | null }[]>`SELECT organization_id AS "homeOrg" FROM clubs WHERE id = ${w.clubs.home.id}`;
  check(`pre: after_siren_kicks#${extra.kickId} is match-less (NAB Cup, premiership false), P's, season 2092, for the home club (organization ${String(org?.homeOrg)})`,
    kick !== null && kick.match_id === null && kick.player_id === w.p.id && kick.season === w.season && kick.club_id === w.clubs.home.id
      && kick.premiership_season === false && org?.homeOrg !== null && org?.homeOrg !== undefined, JSON.stringify(kick && { match_id: kick.match_id, club_id: kick.club_id }));
  const d = await dependentsAt(owner, w, closure.matchId);
  const g = await brownlowGuardsAbsent(owner, w, closure);
  check('pre: DP-1/DP-2/DP-3 absent at (P, M) and M; no Brownlow or entry state: only DP-4 is under test',
    d.sirenAtPM === 0 && d.achievementAtPM === 0 && d.unresolvedAtM === 0 && d.matchLessForP === 1
      && g.votes === null && g.pRounds === 0 && g.entries === 0, JSON.stringify({ ...d, ...g }));
  const participationOfP = await owner<{ rowId: number; matchId: number; clubId: number }[]>`
    SELECT p.id::int AS "rowId", p.match_id AS "matchId", p.club_id AS "clubId" FROM player_match_stats p JOIN matches m ON m.id = p.match_id
     WHERE p.player_id = ${w.p.id} AND m.season = ${w.season} ORDER BY p.match_id
  `;
  const keepsLine = `DP-4 REPORT: match-less after_siren_kicks#${extra.kickId} (player ${w.p.id}, season ${w.season}) keeps its justifying participation; affected, still valid`;
  if (variant === 'loses-participation') {
    check(`pre: P's ONLY 2092 participation is the closure row #${closure.rowId} at M (home club): the MOVE removes the dependent's last justification`,
      canonicalJson(participationOfP) === canonicalJson([{ rowId: closure.rowId, matchId: closure.matchId, clubId: w.clubs.home.id }]), JSON.stringify(participationOfP));
    await guardQ1Stop(ctx, w, { table: 'player_match_stats', rowId: null, step: 'DP-4', code: 'dependent_record_would_be_stale' }, pmsRows(closure.rowId), {
      expectOutput: [{
        label: 'the DP-4 STOP naming the dependent',
        line: `DP-4 STOP: match-less after_siren_kicks#${extra.kickId} (player ${w.p.id}, season ${w.season}) loses its justifying club-season participation`,
      }],
      forbidOutput: [{ label: 'a DP-4 "keeps its justifying participation" report (D14 fail-open)', line: keepsLine }],
    });
    return;
  }
  const m2 = extra.m2!;
  check(`pre: P also plays M2=${m2.id} (2092, home club) through foreign row #${String(extra.m2RowId)}, distinct from closure row #${closure.rowId}, so P keeps a justifying participation after the MOVE`,
    extra.m2RowId !== null && extra.m2RowId !== closure.rowId
      && canonicalJson(participationOfP) === canonicalJson([{ rowId: closure.rowId, matchId: closure.matchId, clubId: w.clubs.home.id },
        { rowId: extra.m2RowId, matchId: m2.id, clubId: w.clubs.home.id }].sort((a, b) => a.matchId - b.matchId)), JSON.stringify(participationOfP));
  await commitPmsWithReport(ctx, w, closure, identityId, [
    { label: 'the DP-4 affected-dependent report', line: keepsLine, phases: ['validate-only', 'apply'] },
    { label: 'the plan report DP-4 line', line: `DP-4 affected dependent (reported): after_siren_kicks#${extra.kickId} (player ${w.p.id}, season ${w.season})`,
      phases: ['validate-only', 'apply'] },
  ]);
  const kickAfter = await dependentRow(owner, 'after_siren_kicks', extra.kickId);
  check('post: the match-less after_siren_kicks row is byte-identical (report only: still P\'s, match-less, never rewritten)', canonicalJson(kickAfter) === canonicalJson(kick));
  const [kept] = await owner<{ playerId: number; clubId: number; season: number }[]>`
    SELECT p.player_id AS "playerId", p.club_id AS "clubId", m.season::int AS season FROM player_match_stats p JOIN matches m ON m.id = p.match_id WHERE p.id = ${extra.m2RowId}
  `;
  check('post: the justification the report relies on is real: P still holds the M2 row, home club, season 2092',
    kept?.playerId === w.p.id && kept.clubId === w.clubs.home.id && kept.season === w.season, JSON.stringify(kept));
}

/* ==================================================================== *
 * Corrected-state / Q2 group (§12.1): 20, 21, 27, 69, 72 (73, 94, 98, 99 follow)
 * ==================================================================== *
 *
 * Every scenario starts from a GENUINE committed correction: case 1's base (`correctedPmsBase`) or
 * case 5's Brownlow safe-move base (`correctedBrownlowBase`), corrected by the real CLI
 * (validate-only, then apply with that fingerprint): canonical application c, batch K, the
 * `corrected` ledger row, CD_I resolved at P′, `c` = the correction application's `applied_at`.
 * Only then does the case apply its later state -- a real writer wherever the case is about
 * recognised provenance -- and re-run the CLI (Q2: `runAlreadyCorrectedRerun`) in `--validate-only`
 * and in the locking `--apply`. A report line is never accepted without the database state it
 * describes: the corrected row, the writer's audit and its `created_at` against `c` (DB timestamps),
 * and the correction footprint (ledger, correction batches, applications, identity, projections),
 * byte-identical across every re-run.
 */

/** Everything a correction or a re-run could add or change for CD_I: its ledger rows, its
 * correction batches, every application citing `externalRecordId`, its identity row and its typed
 * projections. A Q2 re-run must leave it byte-identical ("no second correction"). */
async function correctionFootprint(owner: Sql, w: World, externalRecordId: string): Promise<string> {
  const [row] = await owner<{ f: JsonValue }[]>`
    SELECT jsonb_build_object(
      'ledger', (SELECT jsonb_agg(to_jsonb(a.*) ORDER BY a.id) FROM afl_api_identity_adjudications a WHERE a.external_id = ${w.providerId}),
      'batches', (SELECT jsonb_agg(to_jsonb(b.*) ORDER BY b.id) FROM import_batches b
                   WHERE b.tool = ${R.correctionTool} AND b.validation_result->>'externalId' = ${w.providerId}),
      'applications', (SELECT jsonb_agg(to_jsonb(ca.*) ORDER BY ca.id) FROM canonical_applications ca WHERE ca.external_record_id = ${externalRecordId}),
      'identity', (SELECT to_jsonb(ei.*) FROM external_identities ei WHERE ei.source_id = ${w.sourceIds.aflApi} AND ei.external_id = ${w.providerId}),
      'pmsProjection', (SELECT jsonb_agg(to_jsonb(x.*)) FROM staging.afl_api_player_match x WHERE x.provider_player_id = ${w.providerId}),
      'brownlowProjection', (SELECT jsonb_agg(to_jsonb(x.*)) FROM staging.afl_api_brownlow_vote x WHERE x.provider_player_id = ${w.providerId})
    ) AS f
  `;
  return canonicalJson(row.f);
}

/** CD_I's ledger: exactly one row, the `corrected` one (never a second correction). */
async function ledgerActions(owner: Sql, w: World): Promise<string[]> {
  const rows = await owner<{ action: string }[]>`
    SELECT action::text AS action FROM afl_api_identity_adjudications WHERE external_id = ${w.providerId} ORDER BY id
  `;
  return rows.map((r) => r.action);
}

const Q2_MODES = ['validate-only', 'apply'] as const;
const hasLine = (lines: readonly string[], line: string) => lines.includes(line);
/** A line that is a STOP, or any post-correction classification, which an unqualified NOOP must not carry. */
const classificationLines = (lines: readonly string[]) => lines.filter((l) => /^STOP\b|post_correction|correction_target_absent/.test(l));

/**
 * The Q2 re-run pair on a corrected state: `--validate-only`, then the locking `--apply` (with the
 * correction's own fingerprint). Each must be ALREADY_SATISFIED carrying `expectLines` (and SAT
 * PASS, and the MOVE's `NOOP already_corrected_moved`), must carry no classification line beyond
 * `expectLines`, and must leave the correction footprint and every `watch`ed state byte-identical.
 */
async function q2Satisfied(
  ctx: CaseContext, c: Corrected, w: World, externalRecordId: string, table: ClosureTable, key: Record<string, JsonValue>,
  expectLines: readonly { label: string; line: string }[], watch: { label: string; read: () => Promise<string> },
): Promise<void> {
  const { owner, check } = ctx;
  const noop = `NOOP already_corrected_moved: ${table} ${canonicalJson(key)}`;
  const footprint = await correctionFootprint(owner, w, externalRecordId);
  const watched = await watch.read();
  for (const mode of Q2_MODES) {
    const q2 = await q2Rerun(ctx, c, mode);
    check(`Q2 (${mode}): ALREADY_SATISFIED (exit 0), "${noop}", ${SAT_PASS}`,
      q2.result.kind === 'ALREADY_SATISFIED' && hasLine(q2.lines, noop) && hasLine(q2.lines, SAT_PASS), JSON.stringify(q2.result));
    for (const e of expectLines) check(`Q2 (${mode}): carries ${e.label}: "${e.line}"`, hasLine(q2.lines, e.line));
    const extra = classificationLines(q2.lines).filter((l) => !expectLines.some((e) => e.line === l));
    check(`Q2 (${mode}): no other STOP / post-correction classification line`, extra.length === 0, extra.join(' | '));
    check(`Q2 (${mode}): the correction footprint (ledger, correction batches, applications, identity, projections) is byte-identical: no second correction`,
      (await correctionFootprint(owner, w, externalRecordId)) === footprint);
    check(`Q2 (${mode}): ${watch.label} byte-identical`, (await watch.read()) === watched);
  }
  check('post: CD_I\'s ledger is exactly one `corrected` row', canonicalJson(await ledgerActions(owner, w)) === canonicalJson(['corrected']));
  await owner.begin('read only', (tx) => assertAflApiIdentityInvariant(tx));
  check('post: the combined identity invariant (SAT-1 basis) holds', true);
}

const rowText = (owner: Sql, table: ClosureTable, id: number) => async () => canonicalJson((await rowsById(owner, table, [id])).get(id) ?? null);

/* ---- Case 20 ---- */

/** Case 20: the L1-L8 corrected MOVE lineage re-run with no later activity at all -> NOOP
 * `already_corrected_moved`, zero mutations (the fundamental idempotence case). The correction that
 * builds the base is fixture construction; the acceptance is the two re-runs after it. */
async function case20(ctx: CaseContext): Promise<void> {
  const { owner, check } = ctx;
  const { w, closure, corrected, c, cutoff } = await correctedPmsBase(ctx, 20);
  const key = { player_id: w.pPrime.id, match_id: closure.matchId };
  const apps = await applicationsAt(owner, 'player_match_stats', key);
  check('corrected base: k′ holds exactly c (batch K, update {player_id: P} -> {player_id: P′}); no later application, no audit after c',
    apps.length === 1 && apps[0].importBatchId === c.r.batchId && apps[0].verb === 'update'
      && (await auditsAt(owner, 'matches', closure.matchId, BEFORE_ANY_AUDIT)).length === 0, JSON.stringify(apps.map(appShape)));
  console.log(`  c = ${cutoff}`);
  await q2Satisfied(ctx, c, w, closure.externalRecordId, 'player_match_stats', key, [],
    { label: 'the corrected row (same id, at (P′, M))', read: rowText(owner, 'player_match_stats', closure.rowId) });
  check('post: the corrected row is still the one the correction left (byte-identical to the corrected base)',
    (await rowText(owner, 'player_match_stats', closure.rowId)()) === canonicalJson(corrected));
}

/* ---- Case 27 ---- */

/**
 * Case 27: ORIGINAL attempted on an already-CORRECTED provider (§8.2 step 2 -> §8.5). Each branch on
 * its own fresh corrected base:
 *   - same-target: `--to-player-id P′` again -> the ADJUDICATION re-plan is zero -> ALREADY_SATISFIED;
 *   - other-target: `--to-player-id P″` (a clean fixture player created after the correction) ->
 *     STOP `[§5.4] already_corrected_provider` (a correction of a correction is a chain, D8).
 * Neither ever writes a second `corrected` row, a batch, an application, or touches P″.
 */
async function case27(ctx: CaseContext): Promise<void> {
  const { owner, check, variant } = ctx;
  if (variant !== 'same-target' && variant !== 'other-target') throw new RehearsalRefused('case 27 needs --variant same-target | other-target');
  const { w, closure, corrected, c } = await correctedPmsBase(ctx, 27);
  const key = { player_id: w.pPrime.id, match_id: closure.matchId };
  const correctedRow = rowText(owner, 'player_match_stats', closure.rowId);
  if (variant === 'same-target') {
    await q2Satisfied(ctx, c, w, closure.externalRecordId, 'player_match_stats', key, [],
      { label: 'the corrected row', read: correctedRow });
    check('post: the corrected row is byte-identical to the corrected base', (await correctedRow()) === canonicalJson(corrected));
    return;
  }
  const pDouble = await owner.begin((tx) => insertPlayer(tx, w.caseCode, 'Pdprime', w.sourceIds));
  console.log(`  P″ = ${pDouble.id} (${pDouble.path}), created after the correction`);
  const other: CorrectInput = { ...c.input, w: { ...w, pPrime: pDouble } };
  const expected = `player_match_stats [§5.4] already_corrected_provider: the net ledger state is already CORRECTED; a correction of a correction is a chain (D8) `
    + `(A corrected ${w.providerId} to player ${w.pPrime.id}; --to-player-id is ${pDouble.id})`;
  const footprint = await correctionFootprint(owner, w, closure.externalRecordId);
  const census = await readResidue(owner);
  for (const mode of Q2_MODES) {
    const run = runCli(other, mode, mode === 'apply' ? c.fingerprint : null);
    console.log(`  ORIGINAL --to-player-id P″ (${mode}): exit ${String(run.status)}, ${JSON.stringify(run.result)}`);
    for (const l of stopLinesOf(run.stdout)) console.log(`    | ${l.trim()}`);
    const r = run.result;
    check(`${mode} --to-player-id P″: STOP (exit 1) with exactly one stop, ${expected}`,
      r.kind === 'STOP' && r.stops.length === 1 && describeCliStop(r.stops[0]) === expected, JSON.stringify(r));
    check(`${mode} --to-player-id P″: nothing written (fixture census and the correction footprint byte-identical)`,
      canonicalJson(await readResidue(owner)) === canonicalJson(census) && (await correctionFootprint(owner, w, closure.externalRecordId)) === footprint);
  }
  const [held] = await owner<{ pms: number; brv: number; identities: number }[]>`
    SELECT (SELECT count(*)::int FROM player_match_stats WHERE player_id = ${pDouble.id}) AS pms,
           (SELECT count(*)::int FROM brownlow_round_votes WHERE player_id = ${pDouble.id}) AS brv,
           (SELECT count(*)::int FROM external_identities WHERE player_id = ${pDouble.id} AND source_id = ${w.sourceIds.aflApi}) AS identities
  `;
  check('post: P″ holds no match row, no round row and no afl_api identity', held.pms === 0 && held.brv === 0 && held.identities === 0, JSON.stringify(held));
  check('post: the corrected row (P′, M) is byte-identical to the corrected base; CD_I still resolved at P′',
    (await correctedRow()) === canonicalJson(corrected) && (await identityOf(owner, w))?.player_id === w.pPrime.id);
  check('post: CD_I\'s ledger is exactly one `corrected` row (never a second corrected row)',
    canonicalJson(await ledgerActions(owner, w)) === canonicalJson(['corrected']));
  await owner.begin('read only', (tx) => assertAflApiIdentityInvariant(tx));
  check('post: the combined identity invariant (SAT-1 basis) holds', true);
}

/* ---- Case 69 ---- */

/**
 * Case 69 (§5.12 scenario): the ORIGINAL moves (P, M) with `brownlow_votes` NULL; the Brownlow admin
 * workflow later FINALISES M through the real `finaliseBrownlowMatch` (react-server; 2092 in progress,
 * 18 + 18 line-up), naming P′ for three votes, which writes the per-match mirror `brownlow_votes = 3`
 * onto the corrected row with its `finalise` audit. Q2 PASS with `post_correction_edit brownlow_admin`;
 * the re-run `--apply` is ALREADY_SATISFIED (no batch, adjudication or write); the §5 corrected Q2
 * census (`gateAflApiCorrectedCensus`, the promotion checker's own gate) PASSes; D15
 * (`replayAflApiAdjudications`, read-only) is ALREADY_SATISFIED; the Brownlow state is untouched.
 */
async function case69(ctx: CaseContext): Promise<void> {
  const { owner, check } = ctx;
  const writers = await loadWriters();
  const { w, closure, corrected, c, cutoff, extra: fillers } = await correctedPmsBase(ctx, 69, async (tx, built, row) => {
    await seasonInProgress(tx, built);
    return fillLineUp(tx, built, row.matchId);
  }, { brownlowCoverage: true });
  check('corrected base: the corrected row\'s brownlow_votes is NULL (the §5.12 pre-state)', corrected.brownlow_votes === null);
  const selection = { three: w.pPrime.id, two: fillers.home[0], one: fillers.away[0] };
  const result = await writerCall(ctx.importDsn, `${HARNESS_APP}case069-writer-finalise`, () => writers.finaliseBrownlowMatch({
    matchId: closure.matchId, selection, expectedRevision: 0, actorId: w.actorId,
    note: 'AFLDB-ISSUE-238 Slice 10 rehearsal case 069: post-correction admin finalise of M naming P′',
  }));
  console.log(`  writer finaliseBrownlowMatch (after the correction, P′ three votes): ${JSON.stringify(result)}`);
  check('writer: the real finaliseBrownlowMatch finalised M (revision 1), P′ in the three-vote slot',
    result.ok && result.value.status === 'final' && result.value.revision === 1, JSON.stringify(result));
  const edited = await pmsRow(owner, closure.rowId);
  check('post-writer: the corrected row (same id, still (P′, M)) now carries brownlow_votes = 3 (the real mirror); every other contract field and its ownership/stamps unchanged',
    edited !== null && edited.player_id === w.pPrime.id && edited.brownlow_votes === 3
      && canonicalJson(contractOf(edited)) === canonicalJson({ ...contractOf(corrected), brownlow_votes: 3 } as Record<string, JsonValue>)
      && edited.source_id === corrected.source_id && edited.source_record_id === corrected.source_record_id
      && edited.import_batch_id === corrected.import_batch_id, JSON.stringify(edited && { brownlow_votes: edited.brownlow_votes }));
  const audits = await auditsAt(owner, 'brownlow_vote_entry_state', closure.matchId, cutoff);
  logWriterAudit(cutoff, audits);
  const audit = audits[0];
  check('the writer\'s production audit: exactly one data_edits brownlow_vote_entry_state/finalise row for M, revision 1, created at or after c',
    audits.length === 1 && audit.fieldGroup === 'finalise' && audit.afterCutoff
      && (audit.newValues as Record<string, JsonValue>).revision === 1, JSON.stringify(audits));
  const [entry] = await owner<{ status: string; three: number }[]>`
    SELECT status, three_player_id AS three FROM brownlow_vote_entry_state WHERE match_id = ${closure.matchId}
  `;
  check('post-writer: M\'s entry state is final and names P′ in the three-vote slot', entry?.status === 'final' && entry.three === w.pPrime.id, JSON.stringify(entry));

  const key = { player_id: w.pPrime.id, match_id: closure.matchId };
  const k = canonicalJson(key);
  const report = `post_correction_edit brownlow_admin: player_match_stats ${k} brownlow_votes null -> 3 (audit ${String(audit?.id)})`;
  const reportEntry = `post_correction_edit brownlow_admin (PASS): player_match_stats ${k} brownlow_votes null -> 3 (audit ${String(audit?.id)})`;
  const brownlowState = async () => canonicalJson({ guard: (await guardSnapshot(owner, w)).sha256, row: await pmsRow(owner, closure.rowId) } as JsonValue);
  await q2Satisfied(ctx, c, w, closure.externalRecordId, 'player_match_stats', key,
    [{ label: 'the explained divergence', line: report }, { label: 'its satisfaction entry', line: reportEntry }],
    { label: 'the Brownlow state (entry state, 2092 round rows, season authority/totals, stat_availability, P/P′ derived) and the edited row', read: brownlowState });

  // ---- §5 corrected Q2 census: the promotion checker's own gate, on a read-only afldb_import transaction ----
  const [ledger] = await owner<{ corrected: number; adjudicationId: number }[]>`
    SELECT count(*)::int AS corrected, max(id)::int AS "adjudicationId" FROM afl_api_identity_adjudications WHERE action = 'corrected'
  `;
  check('§5 census input: the database\'s net-corrected set is exactly CD_I\'s one ledger row', ledger.corrected === 1 && ledger.adjudicationId === c.r.adjudicationId,
    JSON.stringify(ledger));
  const censusReport = new Report();
  const before = await brownlowState();
  await ctx.observer.begin('read only', (tx) => gateAflApiCorrectedCensus(dbCorrectionSatisfactionReader(tx),
    [{ externalId: w.providerId, adjudicationId: c.r.adjudicationId }], censusReport));
  const gate = censusReport.results[0];
  check('§5 census (gateAflApiCorrectedCensus): PASS, 1 net-corrected provider, 1 satisfied, 0 not satisfied; the brownlow_admin edit shown as recognised',
    censusReport.results.length === 1 && gate.verdict === 'PASS'
      && gate.lines.includes('net-corrected providers on the live target: 1; correction satisfied: 1; not satisfied: 0')
      && gate.lines.includes(`${w.providerId}: recognised, not a failure — ${report}`), JSON.stringify(gate));
  // ---- D15: the adjudication replay, asserting CD_I ALREADY_SATISFIED exactly, on a READ ONLY transaction ----
  const d15 = await owner.begin('read only', (tx) => replayAflApiAdjudications(tx, new Set(), { expectedAlreadySatisfied: new Set([w.providerId]) }));
  console.log(`  D15 replay (read only): ${JSON.stringify(d15)}`);
  check('D15 (replayAflApiAdjudications, expectedAlreadySatisfied = {CD_I}, read only): ALREADY_SATISFIED 1, inserted 0, no supersede, no stop',
    d15.alreadySatisfied === 1 && d15.inserted === 0 && d15.supersedes.length === 0 && d15.stops.length === 0, JSON.stringify(d15));
  check('post: the Brownlow state and the edited row byte-identical after the census and D15', (await brownlowState()) === before);
}

/* ---- Case 21 ---- */

/**
 * Case 21 (L7): a later write in the valid direction -- a later settle through CD_I at P′. The later
 * settle's canonical write is the PRODUCTION writer, `applyCanonicalUnit()` (`canonical-apply.ts`),
 * handed exactly the unit `settlePlayerUnit()` (`settle-afl-api.ts`) builds, on one `afldb_import`
 * transaction: the settle's identity resolution (`resolveAflApiPlayer`: CD_I -> P′, the corrected
 * link), the automatic proposal of CD_I's version-2 statistics (goals 2 -> 3) diffed against P′'s
 * current row, the E1-E6 gates, the UPDATE, the provenance restamp and the ledger row -- then the
 * settle's typed-projection upsert (its ON CONFLICT branch, same values) and targeted recompute. The
 * settle's staging input (batch B2, the version-2 observation closing version 1) is fixture spine,
 * as every other case's settle history is. -> Q2 NOOP `already_corrected_moved`; L7 passes; no
 * post-correction classification (the change is ledgered, not an out-of-ledger edit).
 */
async function case21(ctx: CaseContext): Promise<void> {
  const { owner, check } = ctx;
  const { w, closure, corrected, c, cutoff } = await correctedPmsBase(ctx, 21);
  const [providerMatchId, providerTeamId] = closure.externalRecordId.split('|');
  const later: Record<string, JsonValue> = { ...closure.values, goals: 3 };
  const unitResult = await ctx.observer.begin(async (tx) => {
    const batchId = await laterSettleBatch(tx, w, 'player_match_stats', `later settle through CD_I at P′: ${closure.externalRecordId} version 2 (goals 2 -> 3)`);
    await tx`
      UPDATE staging.source_record_versions
         SET observed_from = now() - interval '2 hours', observed_to = now() - interval '1 hour', closed_by_batch_id = ${batchId}
       WHERE source_id = ${w.sourceIds.aflApi} AND family = 'player_match_stats'
         AND external_record_id = ${closure.externalRecordId} AND version_seq = 1
    `;
    await storeObservation(tx, w, 'player_match_stats', closure.externalRecordId,
      pmsPayload(w, providerMatchId, providerTeamId, w.providerId, later), { versionSeq: 2, batchId, observedHoursAgo: 1 });
    // settlePlayerUnit: the resolver, then P′'s current values, the automatic proposal and its diff.
    const resolution = await resolveAflApiPlayer(tx, w.sourceIds.aflApi, w.providerId);
    if (resolution.outcome !== 'resolved' || resolution.playerId !== w.pPrime.id) {
      throw new RehearsalRefused(`the settle resolver did not resolve ${w.providerId} to P′ after the correction: ${JSON.stringify(resolution)}`);
    }
    const [row] = await tx<Record<string, JsonValue>[]>`SELECT * FROM player_match_stats WHERE player_id = ${w.pPrime.id} AND match_id = ${closure.matchId}`;
    const existing: Record<string, JsonValue> = { club_id: row.club_id ?? null, career_game_no: row.career_game_no ?? null, jumper_number: row.jumper_number ?? null };
    for (const f of PLAYER_MATCH_STAT_COLUMNS) existing[f] = row[f] ?? null;
    const proposed: Record<string, JsonValue> = { club_id: later.club_id, career_game_no: null, jumper_number: later.jumper_number };
    for (const f of PLAYER_MATCH_STAT_COLUMNS) proposed[f] = later[f] ?? null;
    const automatic = automaticProposal('player_match_stats', proposed);
    const fields = diffFields(automatic, existing);
    const sourceKeysById = new Map<number, string>((await tx<{ id: number; key: string }[]>`SELECT id::int AS id, key FROM sources`).map((s) => [s.id, s.key]));
    const unit: CanonicalApplyUnitInput = {
      family: 'player_match_stats', externalRecordId: closure.externalRecordId, season: w.season,
      sourceId: w.sourceIds.aflApi, sourceKey: 'afl_api', sourceKeysById, batchId: asImportBatchId(String(batchId)),
      inProgressSeasons: [w.season], completionProven: true, matchKey: (await tx<{ k: string }[]>`SELECT match_key AS k FROM matches WHERE id = ${closure.matchId}`)[0].k,
      matchRekey: null, playerId: resolution.playerId, brownlowRoundNumber: null,
      targets: [{
        targetTable: 'player_match_stats', invitation: 'candidate', proposedValues: automatic, renderedFields: fields,
        renderedBaselineCanonicalHash: baselineCanonicalHash(fields, existing), sourceVersionSeq: 2,
      }],
    };
    const outcome = await applyCanonicalUnit(tx as never, unit);
    // projectAflApiPlayerMatch's ON CONFLICT (source_id, family, external_record_id) DO UPDATE branch.
    await tx`
      UPDATE staging.afl_api_player_match
         SET version_seq = 2, player_id = ${w.pPrime.id}, goals = ${Number(later.goals)}, projected_by_batch_id = ${batchId}, projected_at = now()
       WHERE source_id = ${w.sourceIds.aflApi} AND family = 'player_match_stats' AND external_record_id = ${closure.externalRecordId}
    `;
    await recomputePlayerDerivedStats(tx, [w.pPrime.id], w.season);
    return { batchId, fields, outcome };
  });
  const { batchId: b2, fields, outcome } = unitResult as unknown as { batchId: number; fields: string[]; outcome: Awaited<ReturnType<typeof applyCanonicalUnit>> };
  console.log(`  later settle B2 ${b2}: rendered fields ${JSON.stringify(fields)}; applyCanonicalUnit ${JSON.stringify(outcome)}`);
  check('later settle: the settle resolver resolved CD_I to P′ (the corrected link); the automatic proposal differs in goals only',
    canonicalJson(fields as JsonValue) === canonicalJson(['goals']));
  check('later settle: the production applyCanonicalUnit applied the one player_match_stats target (no failure, no refusal)',
    outcome.failure === null && outcome.results.length === 1 && outcome.results[0].applied === true, JSON.stringify(outcome.results));

  const key = { player_id: w.pPrime.id, match_id: closure.matchId };
  const settled = await pmsRow(owner, closure.rowId);
  check('post-settle: the corrected row (same id, (P′, M)) has goals 3, every other contract field as corrected; afl_api-owned, stamp <CD_M>|<team>|CD_I, restamped with B2',
    settled !== null && settled.player_id === w.pPrime.id
      && canonicalJson(contractOf(settled)) === canonicalJson({ ...contractOf(corrected), goals: 3 } as Record<string, JsonValue>)
      && settled.source_id === w.sourceIds.aflApi && settled.source_record_id === closure.externalRecordId && Number(settled.import_batch_id) === b2,
    JSON.stringify(settled && { goals: settled.goals, import_batch_id: settled.import_batch_id }));
  const apps = await applicationsAt(owner, 'player_match_stats', key);
  const [order] = await owner<{ laterAfterC: boolean; laterAt: string }[]>`
    SELECT applied_at >= ${cutoff}::timestamptz AS "laterAfterC",
           to_char(applied_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "laterAt"
      FROM canonical_applications WHERE id = ${apps[1]?.id ?? 0}
  `;
  console.log(`  c = ${cutoff}; L7 application ${String(apps[1]?.id)} applied_at ${String(order?.laterAt)}`);
  check('post-settle: k′ holds [c (batch K), the L7 application (B2, afl_api, through CD_I, version 2, update {goals: 2} -> {goals: 3})], the L7 one applied at or after c',
    apps.length === 2 && apps[0].importBatchId === c.r.batchId && apps[1].id > apps[0].id && apps[1].importBatchId === b2
      && apps[1].sourceKey === 'afl_api' && apps[1].externalRecordId === closure.externalRecordId && apps[1].versionSeq === 2 && apps[1].verb === 'update'
      && canonicalJson(apps[1].previousValues) === canonicalJson({ goals: 2 }) && canonicalJson(apps[1].newValues) === canonicalJson({ goals: 3 })
      && order?.laterAfterC === true, JSON.stringify(apps.map(appShape)));
  check('post-settle: the old key\'s history is still only the settle\'s insert',
    (await applicationsAt(owner, 'player_match_stats', { player_id: w.p.id, match_id: closure.matchId })).map((a) => a.id).join() === String(closure.insertApplicationId));
  const [projection] = await owner<{ playerId: number; versionSeq: number; goals: number }[]>`
    SELECT player_id AS "playerId", version_seq AS "versionSeq", goals::int AS goals FROM staging.afl_api_player_match WHERE provider_player_id = ${w.providerId}
  `;
  check('post-settle: CD_I\'s projection names P′ at version 2 (goals 3)', projection?.playerId === w.pPrime.id && projection.versionSeq === 2 && projection.goals === 3, JSON.stringify(projection));
  await q2Satisfied(ctx, c, w, closure.externalRecordId, 'player_match_stats', key, [],
    { label: 'the settled corrected row', read: rowText(owner, 'player_match_stats', closure.rowId) });
}

/* ---- Case 72 ---- */

/** Case 5's Brownlow safe-move base (CD_I's 3-vote round row at (2092, P, 1), companions V2/V3, P′'s
 * foreign participation at M) CORRECTED by the real CLI through `commitBrownlowMove`. */
type CorrectedBrownlowOptions = {
  /** Case 72: a second, empty 2092 match (plus one unrelated staging observation resolved to it). */
  siblingMatch?: boolean;
  /** The real Brownlow admin writers' preconditions, all PRE-correction: 2092 in progress, V2/V3
   * foreign line-up rows at M, and M's 18 + 18 line-up (`fillLineUp`; the fillers are returned). */
  adminReady?: boolean;
  /** Case 99: the pre-F007 settle left M unresolved and a later settle, M STILL unresolved, demoted
   * CD_I to 0 (`demoteToZero` stillUnresolved): an afl_api row {played, votes 0, match_id NULL}. */
  unresolvedZero?: boolean;
};

async function correctedBrownlowBase(ctx: CaseContext, caseNumber: number, options: CorrectedBrownlowOptions = {}) {
  const fx = await buildBrownlow(ctx, caseNumber, async (tx, w) => {
    if (options.adminReady) await seasonInProgress(tx, w);
    const settled = await brownlowClosureRow(tx, w, 1, options.unresolvedZero ? { matchIdAtSettle: 'unresolved' } : {});
    const closure: BrownlowClosureRow & { demotion?: DemotedBrownlowClosureRow['demotion'] } = options.unresolvedZero
      ? await demoteToZero(tx, w, settled, { stillUnresolved: true }) : settled;
    const participationRowId = await participation(tx, w, w.pPrime.id, closure.match.id);
    let fillers: { home: number[]; away: number[] } | null = null;
    if (options.adminReady) {
      const [v2, v3] = closure.companions;
      await foreignParticipation(tx, w, v2.playerId, closure.match.id, w.clubs.away.id, '32');
      await foreignParticipation(tx, w, v3.playerId, closure.match.id, w.clubs.home.id, '33');
      fillers = await fillLineUp(tx, w, closure.match.id);
    }
    // A second, empty home-and-away match of 2092 (round 2): deleting M must not empty the season,
    // which `recomputeClubSeasons` refuses by design (a real season is never one match).
    const sibling = options.siblingMatch ? await fixtureMatch(tx, w, 2, 2) : null;
    if (sibling) {
      // One unrelated staging Brownlow observation, resolved to the SIBLING match (companion V2, one
      // vote): the ISSUE-253 detach must leave it byte-identical. It has no canonical row.
      const v2 = closure.companions[0];
      await storeObservation(tx, w, 'brownlow_match_votes', sibling.providerMatchId, {
        providerMatchId: sibling.providerMatchId, apiRoundNumber: sibling.roundNumber,
        votes: [{ providerPlayerId: v2.providerId, providerTeamId: v2.providerTeamId, votes: 1, eligible: true }],
      });
      await tx`
        INSERT INTO staging.afl_api_brownlow_vote ${tx({
          source_id: w.sourceIds.aflApi, family: 'brownlow_match_votes', external_record_id: sibling.providerMatchId, version_seq: 1,
          provider_match_id: sibling.providerMatchId, provider_player_id: v2.providerId, provider_team_id: v2.providerTeamId,
          season: w.season, api_round_number: sibling.roundNumber, canonical_round_number: sibling.roundNumber,
          votes: 1, eligible: true, match_id: sibling.id, player_id: v2.playerId, club_id: null,
          projected_by_batch_id: w.settleBatchId,
        } as never)}
      `;
    }
    return { closure, participationRowId, sibling, fillers };
  });
  const { w, closure, participationRowId, sibling, fillers } = fx;
  const demotion = closure.demotion ?? null;
  const identityId = await checkBrownlowClosurePre(ctx, w, closure, demotion?.batchId ?? w.settleBatchId);
  if (options.adminReady) {
    const [{ status }] = await ctx.owner<{ status: string }[]>`SELECT status::text AS status FROM seasons WHERE year = ${w.season}`;
    const [{ home, away }] = await ctx.owner<{ home: number; away: number }[]>`
      SELECT count(*) FILTER (WHERE club_id = ${w.clubs.home.id})::int AS home, count(*) FILTER (WHERE club_id = ${w.clubs.away.id})::int AS away
        FROM player_match_stats WHERE match_id = ${closure.match.id}
    `;
    ctx.check('pre (admin-ready, before the correction): 2092 in_progress; M\'s line-up is complete (>= 18 + 18, P′ and V2/V3 among it)',
      status === 'in_progress' && home >= MIN_CLUB_LINEUP_ROWS && away >= MIN_CLUB_LINEUP_ROWS, JSON.stringify({ status, home, away }));
  }
  if (demotion) {
    ctx.check('pre (unresolved zero): CD_I\'s row is {played true, votes 0, match_id NULL}; the demotion is exactly {votes: 3} -> {votes: 0} (M still unresolved: no heal)',
      closure.values.match_id === null && closure.values.votes === 0 && demotion.healApplicationIds.length === 0
        && canonicalJson(demotion.previous) === canonicalJson({ votes: 3 }) && canonicalJson(demotion.next) === canonicalJson({ votes: 0 }), JSON.stringify(demotion));
  }
  const saBaseline = await settledBaseline(ctx, w);
  const c = await commitBrownlowMove(ctx, {
    w, closure, identityId, saBaseline, citedVersionSeq: demotion ? 2 : 1, hasProjection: true,
    keepBrownlow: [...closure.companions.map((cc) => cc.rowId), ...(demotion ? [demotion.newVoter.rowId] : [])], keepPms: [participationRowId],
  });
  const cutoff = await cutoffOf(ctx.owner, c.r.batchId, closure.externalRecordId);
  ctx.check('corrected base: c = the Brownlow correction application\'s applied_at exists', cutoff !== null);
  const corrected = (await rowsById(ctx.owner, 'brownlow_round_votes', [closure.rowId])).get(closure.rowId)!;
  console.log(`  corrected base: adjudication ${c.r.adjudicationId}, batch K ${c.r.batchId}, c = ${String(cutoff)}`);
  return { w, closure, participationRowId, sibling, fillers, c, cutoff: cutoff!, corrected, key: { ...closure.naturalKey, player_id: w.pPrime.id } };
}

/** `staging.afl_api_brownlow_vote` rows, in key order: those naming `matchId` (`at`), every other
 * one (`other`), or those with the given `external_record_id`s (`keys`, the ISSUE-253 detach check). */
async function brownlowStagingRows(owner: Sql, matchId: number, which: 'at' | 'other' | 'keys', keys: readonly string[] = []): Promise<RowSnapshot[]> {
  const rows = await owner<{ r: RowSnapshot }[]>`
    SELECT to_jsonb(x.*) AS r FROM staging.afl_api_brownlow_vote x
     WHERE ${which === 'at' ? owner`x.match_id = ${matchId}`
       : which === 'other' ? owner`x.match_id IS DISTINCT FROM ${matchId} AND NOT (x.external_record_id = ANY(${owner.array([...keys, ''])}::text[]))`
         : owner`x.external_record_id = ANY(${owner.array([...keys])}::text[])`}
     ORDER BY x.source_id, x.family, x.external_record_id, x.provider_player_id
  `;
  return rows.map((row) => row.r);
}

/** Every single-column foreign key referencing `public.matches(id)`, with the count of rows naming `matchId`. */
async function referencesToMatch(owner: Sql, matchId: number): Promise<{ column: string; n: number }[]> {
  const fks = await owner<{ rel: string; col: string }[]>`
    SELECT con.conrelid::regclass::text AS rel, a.attname AS col
      FROM pg_constraint con
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
     WHERE con.contype = 'f' AND con.confrelid = 'public.matches'::regclass AND array_length(con.conkey, 1) = 1
     ORDER BY 1, 2
  `;
  const out: { column: string; n: number }[] = [];
  for (const fk of fks) {
    const [row] = await owner.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${fk.rel} WHERE "${fk.col}" = $1`, [matchId]);
    out.push({ column: `${fk.rel}.${fk.col}`, n: row.n });
  }
  return out;
}

/**
 * Case 72: after a corrected Brownlow MOVE, the REAL `deleteMatch` (react-server) deletes M. The
 * corrected round row survives (`brownlow_round_votes.match_id` is ON DELETE SET NULL) with
 * `match_id` -> NULL beside the `match_deletion` audit -> Q2 PASS, `post_correction_edit
 * match_deleted` reported. A real-writer refusal is a production finding: the case STOPs and names
 * the dependency, never works around it in fixture SQL.
 */
async function case72(ctx: CaseContext): Promise<void> {
  const { owner, check } = ctx;
  const writers = await loadWriters();
  const { w, closure, c, cutoff, corrected, key, sibling } = await correctedBrownlowBase(ctx, 72, { siblingMatch: true });
  const matchId = closure.match.id;
  const [pre] = await owner<{ match: number; projections: number; entry: number }[]>`
    SELECT (SELECT count(*)::int FROM matches WHERE id = ${matchId}) AS match,
           (SELECT count(*)::int FROM staging.afl_api_brownlow_vote WHERE match_id = ${matchId}) AS projections,
           (SELECT count(*)::int FROM brownlow_vote_entry_state WHERE match_id = ${matchId}) AS entry
  `;
  check('pre-writer: M exists immediately after the correction; the corrected round row names M; no entry state at M',
    pre.match === 1 && corrected.match_id === matchId && pre.entry === 0, JSON.stringify({ ...pre, correctedMatchId: corrected.match_id }));
  console.log(`  pre-writer: ${pre.projections} staging.afl_api_brownlow_vote row(s) name M (the settle's resolved-match projection, migration 103 FK, no ON DELETE)`);
  // ISSUE-253 contract evidence: the staging observations at M (detached, never deleted) and every other one (untouched).
  const stagingAtM = await brownlowStagingRows(owner, matchId, 'at');
  const stagingOther = await brownlowStagingRows(owner, matchId, 'other', stagingAtM.map((r) => String(r.external_record_id)));
  check('pre-writer: the settle\'s staging Brownlow observations name M (at least CD_I\'s)',
    stagingAtM.length === pre.projections && stagingAtM.length > 0
      && stagingAtM.some((r) => r.provider_player_id === w.providerId), JSON.stringify(stagingAtM.map((r) => r.external_record_id)));
  const result = await writerCall(ctx.importDsn, `${HARNESS_APP}case072-writer-delete-match`, () => writers.deleteMatch({
    matchId, adminUserId: w.actorId, reason: 'AFLDB-ISSUE-238 Slice 10 rehearsal case 072: post-correction match deletion',
  }));
  console.log(`  writer deleteMatch (after the correction): ${JSON.stringify(result)}`);
  check('writer: the real deleteMatch deleted M', result.ok === true && result.deletedId === matchId, JSON.stringify(result));
  if (!result.ok) {
    const [after] = await owner<{ match: number; audits: number; row: RowSnapshot | null }[]>`
      SELECT (SELECT count(*)::int FROM matches WHERE id = ${matchId}) AS match,
             (SELECT count(*)::int FROM data_edits WHERE table_name = 'matches' AND row_id = ${matchId}) AS audits,
             (SELECT to_jsonb(b.*) FROM brownlow_round_votes b WHERE b.id = ${closure.rowId}) AS row
    `;
    console.log(`  post-refusal: ${JSON.stringify({ match: after.match, audits: after.audits, correctedRowMatchId: after.row?.match_id })}`);
    throw new RehearsalRefused(`PRODUCTION FINDING (case 72 STOP): the real deleteMatch refused M after the correction: ${result.error}`);
  }
  const deleted = (await rowsById(owner, 'brownlow_round_votes', [closure.rowId])).get(closure.rowId) ?? null;
  check('post-writer: the corrected round row (same id, (2092, P′, 1)) survives with match_id NULL; every other column unchanged',
    deleted !== null && deleted.match_id === null && canonicalJson({ ...deleted, match_id: matchId }) === canonicalJson(corrected), JSON.stringify(deleted));
  const audits = await auditsAt(owner, 'matches', matchId, cutoff);
  logWriterAudit(cutoff, audits);
  const audit = audits[0];
  check('the writer\'s production audit: exactly one data_edits matches/match_deletion row for M, created at or after c',
    audits.length === 1 && audit.fieldGroup === 'match_deletion' && audit.afterCutoff, JSON.stringify(audits));
  const [gone] = await owner<{ match: number; auditsAll: number }[]>`
    SELECT (SELECT count(*)::int FROM matches WHERE id = ${matchId}) AS match,
           (SELECT count(*)::int FROM data_edits WHERE table_name = 'matches' AND row_id = ${matchId}) AS "auditsAll"
  `;
  check('post-writer: M no longer exists; exactly one data_edits row names M at all (the match_deletion audit)',
    gone.match === 0 && gone.auditsAll === 1, JSON.stringify(gone));
  check('post-writer: the sibling 2092 match survives (the season is not emptied)', (await owner<{ n: number }[]>`SELECT count(*)::int AS n FROM matches WHERE id = ${sibling!.id}`)[0].n === 1);
  const detached = await brownlowStagingRows(owner, matchId, 'keys', stagingAtM.map((r) => String(r.external_record_id)));
  const withoutMatch = (rows: readonly RowSnapshot[]) => canonicalJson(rows.map((r) => ({ ...r, match_id: null })) as JsonValue);
  check('post-writer (ISSUE-253): every staging Brownlow observation that named M survives with match_id NULL; every other column (votes, version, provider ids, player, batch) unchanged',
    detached.length === stagingAtM.length && detached.every((r) => r.match_id === null) && withoutMatch(detached) === withoutMatch(stagingAtM),
    JSON.stringify(detached.map((r) => ({ key: r.external_record_id, match_id: r.match_id }))));
  check('post-writer (ISSUE-253): every other staging Brownlow observation (including the one resolved to the sibling match) is byte-identical',
    stagingOther.some((r) => r.match_id === sibling!.id) && canonicalJson(await brownlowStagingRows(owner, matchId, 'other', stagingAtM.map((r) => String(r.external_record_id))) as JsonValue) === canonicalJson(stagingOther as JsonValue), `${stagingOther.length} other row(s)`);
  const dangling = await referencesToMatch(owner, matchId);
  check('post-writer: no foreign-key column referencing matches(id) holds M', dangling.every((d) => d.n === 0), JSON.stringify(dangling.filter((d) => d.n !== 0)));
  console.log(`  post-writer: ${detached.length} staging observation(s) detached; ${stagingOther.length} other(s) unchanged; ${dangling.length} FK column(s) to matches checked, 0 name M`);
  const k = canonicalJson(key);
  const report = `post_correction_edit match_deleted: brownlow_round_votes ${k} match_id ${matchId} -> null (audit ${String(audit?.id)})`;
  const reportEntry = `post_correction_edit match_deleted (PASS): brownlow_round_votes ${k} match_id ${matchId} -> null (audit ${String(audit?.id)})`;
  await q2Satisfied(ctx, c, w, closure.externalRecordId, 'brownlow_round_votes', key,
    [{ label: 'the explained match_id divergence', line: report }, { label: 'its satisfaction entry', line: reportEntry }],
    { label: 'the surviving corrected round row', read: rowText(owner, 'brownlow_round_votes', closure.rowId) });
}

/**
 * The Q2 STOP pair on a corrected state whose later change has no recognised explanation:
 * `--validate-only`, then the locking `--apply`. Each must STOP with exactly `expected`, print no
 * ALREADY_SATISFIED or post-correction line, and leave the correction footprint and `watch`
 * byte-identical (nothing commits).
 */
async function q2Stop(
  ctx: CaseContext, c: Corrected, w: World, externalRecordId: string, expected: string,
  watch: { label: string; read: () => Promise<string> },
): Promise<void> {
  const { owner, check } = ctx;
  const footprint = await correctionFootprint(owner, w, externalRecordId);
  const watched = await watch.read();
  for (const mode of Q2_MODES) {
    const q2 = await q2Rerun(ctx, c, mode);
    const r = q2.result;
    check(`Q2 (${mode}): STOP (exit 1) with exactly one stop, ${expected}`,
      r.kind === 'STOP' && r.stops.length === 1 && describeCliStop(r.stops[0]) === expected, JSON.stringify(r));
    const explained = q2.lines.filter((l) => /^ALREADY_SATISFIED|post_correction_edit |^NOOP already_corrected/.test(l));
    check(`Q2 (${mode}): nothing reported as satisfied or explained`, explained.length === 0, explained.join(' | '));
    check(`Q2 (${mode}): the correction footprint is byte-identical (nothing committed)`, (await correctionFootprint(owner, w, externalRecordId)) === footprint);
    check(`Q2 (${mode}): ${watch.label} byte-identical`, (await watch.read()) === watched);
  }
  check('post: CD_I\'s ledger is exactly one `corrected` row', canonicalJson(await ledgerActions(owner, w)) === canonicalJson(['corrected']));
  await owner.begin('read only', (tx) => assertAflApiIdentityInvariant(tx));
  check('post: the combined identity invariant (SAT-1 basis) holds', true);
}

const sourceIdOf = async (owner: Sql, key: string) => (await owner<{ id: number }[]>`SELECT id::int AS id FROM sources WHERE key = ${key}`)[0].id;

/** Every data_edits row naming M in the two tables Q2's audit reader reads, in id order. */
async function auditsForMatch(owner: Sql, matchId: number, cutoff: string): Promise<(AuditRow & { tableName: string })[]> {
  return owner<(AuditRow & { tableName: string })[]>`
    SELECT id::int AS id, table_name AS "tableName", to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
           field_group AS "fieldGroup", created_at >= ${cutoff}::timestamptz AS "afterCutoff", new_values AS "newValues"
      FROM data_edits WHERE table_name IN ('matches', 'brownlow_vote_entry_state') AND row_id = ${matchId} ORDER BY id
  `;
}

/* ---- Case 73 ---- */

/**
 * Case 73 (DOCUMENTED PARTIAL, D-S9-1): after the corrected Brownlow MOVE, a later legitimate FOREIGN
 * round row appears for P′ and for P: AFL Tables-owned (no stamp, batch or application), round 2 of
 * 2092 (not the vacated key), match unlinked (the historical AFL Tables shape). Q2 is NOT widened to
 * foreign Brownlow rows: it stays ALREADY_SATISFIED with no line about them, and both rows are
 * untouched. The §12.1 "NOOP foreign, reported" half is NOT claimed.
 */
async function case73(ctx: CaseContext): Promise<void> {
  const { owner, check } = ctx;
  const { w, closure, c, cutoff, corrected, key } = await correctedBrownlowBase(ctx, 73);
  const foreign = await owner.begin(async (tx) => {
    const ids: Record<'pPrime' | 'p', number> = { pPrime: 0, p: 0 };
    for (const [who, playerId, votes] of [['pPrime', w.pPrime.id, 2], ['p', w.p.id, 1]] as const) {
      const [row] = await tx<{ id: string }[]>`
        INSERT INTO brownlow_round_votes ${tx({
          season: w.season, player_id: playerId, round_number: 2, match_id: null, played: true, votes,
          source_id: w.sourceIds.afltables, source_record_id: null, import_batch_id: null,
        } as never)}
        RETURNING id::text AS id
      `;
      ids[who] = Number(row.id);
    }
    return ids;
  }) as unknown as Record<'pPrime' | 'p', number>;
  const rows = await rowsById(owner, 'brownlow_round_votes', [foreign.pPrime, foreign.p]);
  const [prov] = await owner<{ afterC: boolean; apps: number; aflApiKeys: number }[]>`
    SELECT bool_and(b.imported_at >= ${cutoff}::timestamptz) AS "afterC",
           (SELECT count(*)::int FROM canonical_applications ca WHERE ca.target_table = 'brownlow_round_votes' AND ca.target_key->>'round_number' = '2'
               AND (ca.target_key->>'player_id')::int IN (${w.p.id}, ${w.pPrime.id}) AND (ca.target_key->>'season')::int = ${w.season}) AS apps,
           (SELECT count(*)::int FROM brownlow_round_votes x WHERE x.id IN (${foreign.pPrime}, ${foreign.p}) AND x.source_id = ${w.sourceIds.aflApi}) AS "aflApiKeys"
      FROM brownlow_round_votes b WHERE b.id IN (${foreign.pPrime}, ${foreign.p})
  `;
  const [{ afltablesKey }] = await owner<{ afltablesKey: string }[]>`SELECT key AS "afltablesKey" FROM sources WHERE id = ${w.sourceIds.afltables}`;
  console.log(`  later foreign rows (source ${afltablesKey}): P′ #${foreign.pPrime} ${canonicalJson(rows.get(foreign.pPrime) ?? null)}; P #${foreign.p} ${canonicalJson(rows.get(foreign.p) ?? null)}`);
  check('later: two foreign round rows, (2092, P′, 2) votes 2 and (2092, P, 2) votes 1: afltables-owned, no source_record_id, no import batch, no application at either key, imported at or after c',
    afltablesKey === 'afltables' && [foreign.pPrime, foreign.p].every((id) => {
      const r = rows.get(id);
      return r !== undefined && r.source_id === w.sourceIds.afltables && r.source_record_id === null && r.import_batch_id === null && r.round_number === 2;
    }) && prov.apps === 0 && prov.aflApiKeys === 0 && prov.afterC === true, JSON.stringify(prov));
  const foreignRows = async () => canonicalJson([...(await rowsById(owner, 'brownlow_round_votes', [foreign.pPrime, foreign.p])).entries()] as unknown as JsonValue);
  const correctedRow = rowText(owner, 'brownlow_round_votes', closure.rowId);
  check('later: the corrected row is untouched by the foreign rows (byte-identical to the corrected base)', (await correctedRow()) === canonicalJson(corrected));
  await q2Satisfied(ctx, c, w, closure.externalRecordId, 'brownlow_round_votes', key, [],
    { label: 'both foreign round rows and the corrected row', read: async () => `${await foreignRows()}|${await correctedRow()}` });
  const q2Lines = (await q2Rerun(ctx, c, 'validate-only')).lines;
  const mentions = q2Lines.filter((l) => l.includes(`#${foreign.pPrime}`) || l.includes(`#${foreign.p}`) || /NOOP foreign/.test(l));
  check('PARTIAL (D-S9-1, recorded): Q2 prints no line about either foreign row (no NOOP foreign): it does not validate them', mentions.length === 0, mentions.join(' | '));
}

/* ---- Case 94 ---- */

/**
 * Case 94: a post-correction Brownlow admin RE-OWN of the corrected round row, on one admin-ready
 * base (2092 in progress, M's full line-up, all pre-correction). The two branches differ ONLY in
 * recognised provenance:
 *   - `audited`: the REAL `finaliseBrownlowMatch` names P′ three (V2 two, V3 one): the row becomes
 *     manual_admin_edit / entry:<M>:r1 / batch NULL, votes 3, with the brownlow_vote_entry_state
 *     `finalise` audit revision 1 after c -> Q2 PASS `post_correction_edit brownlow_admin_reowned`;
 *   - `no-audit`: the SAME row state by fixture SQL on that row alone, with no entry state and no
 *     audit for M -> STOP `ownership_or_stamp_contradicts` (L8-b).
 */
async function case94(ctx: CaseContext): Promise<void> {
  const { owner, check, variant } = ctx;
  if (variant !== 'audited' && variant !== 'no-audit') throw new RehearsalRefused('case 94 needs --variant audited | no-audit');
  const writers = variant === 'audited' ? await loadWriters() : null;
  const { w, closure, c, cutoff, corrected, key } = await correctedBrownlowBase(ctx, 94, { adminReady: true });
  const M = closure.match.id;
  const [v2, v3] = closure.companions;
  const manualId = await sourceIdOf(owner, MANUAL_SOURCE_KEY);
  check('corrected base: the corrected round row is afl_api-owned at (2092, P′, 1) with votes 3 at M; no entry state and no audit for M',
    corrected.player_id === w.pPrime.id && corrected.source_id === w.sourceIds.aflApi && corrected.votes === 3 && corrected.match_id === M
      && (await auditsForMatch(owner, M, cutoff)).length === 0
      && (await owner<{ n: number }[]>`SELECT count(*)::int AS n FROM brownlow_vote_entry_state WHERE match_id = ${M}`)[0].n === 0);
  if (writers) {
    const result = await writerCall(ctx.importDsn, `${HARNESS_APP}case094-writer-finalise`, () => writers.finaliseBrownlowMatch({
      matchId: M, selection: { three: w.pPrime.id, two: v2.playerId, one: v3.playerId }, expectedRevision: 0, actorId: w.actorId,
      note: 'AFLDB-ISSUE-238 Slice 10 rehearsal case 094: post-correction admin finalise of M re-owning the corrected row',
    }));
    console.log(`  writer finaliseBrownlowMatch (after the correction; P′ three, V2 two, V3 one): ${JSON.stringify(result)}`);
    check('writer: the real finaliseBrownlowMatch finalised M (revision 1)', result.ok && result.value.status === 'final' && result.value.revision === 1, JSON.stringify(result));
  } else {
    await owner`
      UPDATE brownlow_round_votes
         SET source_id = ${manualId}, source_record_id = ${entrySourceRecordId(M, 1)}, import_batch_id = NULL, imported_at = now()
       WHERE id = ${closure.rowId}
    `;
    console.log('  out-of-band re-own (fixture SQL, the corrected row only): manual_admin_edit, entry:<M>:r1, import batch NULL');
  }
  const reowned = (await rowsById(owner, 'brownlow_round_votes', [closure.rowId])).get(closure.rowId) ?? null;
  const ownership = (r: RowSnapshot | null) => r && { source_id: r.source_id, source_record_id: r.source_record_id, import_batch_id: r.import_batch_id };
  const facts = (r: RowSnapshot | null) => r && { player_id: r.player_id, season: r.season, round_number: r.round_number, votes: r.votes, played: r.played, match_id: r.match_id };
  check('post-change (both branches, identical): the SAME row is re-owned to manual_admin_edit / entry:<M>:r1 / import batch NULL; player, key, votes 3, played, match_id M unchanged',
    reowned !== null && canonicalJson(ownership(reowned)) === canonicalJson({ source_id: manualId, source_record_id: entrySourceRecordId(M, 1), import_batch_id: null })
      && canonicalJson(facts(reowned)) === canonicalJson(facts(corrected)), JSON.stringify(reowned));
  const audits = await auditsForMatch(owner, M, cutoff);
  logWriterAudit(cutoff, audits);
  const [entry] = await owner<{ status: string; revision: number; three: number }[]>`
    SELECT status, revision, three_player_id AS three FROM brownlow_vote_entry_state WHERE match_id = ${M}
  `;
  const rowState = rowText(owner, 'brownlow_round_votes', closure.rowId);
  if (variant === 'audited') {
    const audit = audits[0];
    check('the writer\'s provenance: exactly one data_edits row for M, brownlow_vote_entry_state/finalise, revision 1, created at or after c; entry state final r1 naming P′ three',
      audits.length === 1 && audit.tableName === 'brownlow_vote_entry_state' && audit.fieldGroup === 'finalise' && audit.afterCutoff
        && (audit.newValues as Record<string, JsonValue>).revision === 1 && entry?.status === 'final' && entry.revision === 1 && entry.three === w.pPrime.id,
      JSON.stringify({ audits, entry }));
    const k = canonicalJson(key);
    await q2Satisfied(ctx, c, w, closure.externalRecordId, 'brownlow_round_votes', key, [
      { label: 'the recognised re-own', line: `post_correction_edit brownlow_admin_reowned: brownlow_round_votes ${k} (audit ${String(audit?.id)})` },
      { label: 'its satisfaction entry', line: `post_correction_edit brownlow_admin_reowned (PASS): brownlow_round_votes ${k} (audit ${String(audit?.id)})` },
    ], { label: 'the re-owned corrected row and the Brownlow state', read: async () => `${await rowState()}|${(await guardSnapshot(owner, w)).sha256}` });
    return;
  }
  check('no-audit branch: no data_edits row names M in either audited table, and M has no entry state (no recognised writer)',
    audits.length === 0 && entry === undefined, JSON.stringify({ audits, entry }));
  await q2Stop(ctx, c, w, closure.externalRecordId,
    `brownlow_round_votes#${closure.rowId} [L8-b] ownership_or_stamp_contradicts: ownership or stamp columns no longer match L8-b`,
    { label: 'the re-owned corrected row', read: rowState });
}

/* ---- Case 98 ---- */

/**
 * Case 98 (audit scope, `R238-P5-01`): after the correction, the REAL `saveDraftBrownlowMatch` saves
 * a draft for M (a legitimate audit after c, `field_group = 'draft'`, no canonical fact), and then,
 * independently, the corrected row's `votes` changes 3 -> 0 out of band (fixture SQL, that column
 * only; still afl_api, stamps unchanged). There is no finalise/correct/void audit -> STOP
 * `post_correction_edit_unexplained` on `votes`: the draft audit explains nothing.
 */
async function case98(ctx: CaseContext): Promise<void> {
  const { owner, check } = ctx;
  const writers = await loadWriters();
  const { w, closure, c, cutoff, corrected } = await correctedBrownlowBase(ctx, 98, { adminReady: true });
  const M = closure.match.id;
  const [v2, v3] = closure.companions;
  const result = await writerCall(ctx.importDsn, `${HARNESS_APP}case098-writer-brownlow-draft`, () => writers.saveDraftBrownlowMatch({
    matchId: M, selection: { three: w.pPrime.id, two: v2.playerId, one: v3.playerId }, expectedRevision: 0, actorId: w.actorId,
    note: 'AFLDB-ISSUE-238 Slice 10 rehearsal case 098: post-correction Brownlow draft of M',
  }));
  console.log(`  writer saveDraftBrownlowMatch (after the correction): ${JSON.stringify(result)}`);
  check('writer: the real saveDraftBrownlowMatch saved a draft for M', result.ok === true, JSON.stringify(result));
  const afterDraft = (await rowsById(owner, 'brownlow_round_votes', [closure.rowId])).get(closure.rowId) ?? null;
  check('post-draft: the corrected row is byte-identical to the corrected base (a draft writes no canonical Brownlow fact)',
    canonicalJson(afterDraft) === canonicalJson(corrected));
  await owner`UPDATE brownlow_round_votes SET votes = 0 WHERE id = ${closure.rowId}`;
  const mutated = (await rowsById(owner, 'brownlow_round_votes', [closure.rowId])).get(closure.rowId) ?? null;
  check('out-of-band change: ONLY votes differs (3 -> 0); still afl_api, source_record_id CD_M, import batch, played, match_id M unchanged',
    mutated !== null && mutated.votes === 0 && corrected.votes === 3 && canonicalJson({ ...mutated, votes: 3 }) === canonicalJson(corrected), JSON.stringify(mutated));
  const audits = await auditsForMatch(owner, M, cutoff);
  logWriterAudit(cutoff, audits);
  const [entry] = await owner<{ status: string }[]>`SELECT status FROM brownlow_vote_entry_state WHERE match_id = ${M}`;
  check('audit scope: exactly one data_edits row names M: brownlow_vote_entry_state/draft, created at or after c; entry state draft; NO finalise/correct/void audit',
    audits.length === 1 && audits[0].tableName === 'brownlow_vote_entry_state' && audits[0].fieldGroup === 'draft' && audits[0].afterCutoff
      && entry?.status === 'draft' && !audits.some((a) => ['finalise', 'correct', 'void'].includes(a.fieldGroup)), JSON.stringify({ audits, entry }));
  await q2Stop(ctx, c, w, closure.externalRecordId,
    `brownlow_round_votes#${closure.rowId} [L8-d] post_correction_edit_unexplained: field votes diverges with no recognised writer's audit`,
    { label: 'the mutated corrected row and the Brownlow state', read: async () => `${await rowText(owner, 'brownlow_round_votes', closure.rowId)()}|${(await guardSnapshot(owner, w)).sha256}` });
}

/* ---- Case 99 ---- */

/**
 * Case 99 (`R238-P5-01`): the corrected round row is {played, votes 0, match_id NULL}, still afl_api
 * (the unresolved-zero base). After c the REAL `finaliseBrownlowMatch` finalises M naming three
 * line-up fillers: its resolve step sets the row's match_id NULL -> M (P′ plays M) and, the row
 * holding 0, its demote/claim steps leave it afl_api-owned and stamped -> Q2 PASS,
 * `post_correction_edit brownlow_admin` on `match_id` only.
 */
async function case99(ctx: CaseContext): Promise<void> {
  const { owner, check } = ctx;
  const writers = await loadWriters();
  const { w, closure, c, cutoff, corrected, key, fillers } = await correctedBrownlowBase(ctx, 99, { adminReady: true, unresolvedZero: true });
  const M = closure.match.id;
  check('pre-writer: the corrected row at (2092, P′, 1) is afl_api-owned, stamped CD_M, votes 0, played, match_id NULL',
    corrected.player_id === w.pPrime.id && corrected.source_id === w.sourceIds.aflApi && corrected.source_record_id === closure.externalRecordId
      && corrected.votes === 0 && corrected.played === true && corrected.match_id === null, JSON.stringify(corrected));
  const selection = { three: fillers!.home[0], two: fillers!.away[0], one: fillers!.home[1] };
  const result = await writerCall(ctx.importDsn, `${HARNESS_APP}case099-writer-finalise`, () => writers.finaliseBrownlowMatch({
    matchId: M, selection, expectedRevision: 0, actorId: w.actorId,
    note: 'AFLDB-ISSUE-238 Slice 10 rehearsal case 099: post-correction admin finalise of M resolving the corrected row',
  }));
  console.log(`  writer finaliseBrownlowMatch (after the correction; three line-up fillers): ${JSON.stringify(result)}`);
  check('writer: the real finaliseBrownlowMatch finalised M (revision 1); P′ not selected',
    result.ok && result.value.status === 'final' && result.value.revision === 1 && ![selection.three, selection.two, selection.one].includes(w.pPrime.id), JSON.stringify(result));
  const resolved = (await rowsById(owner, 'brownlow_round_votes', [closure.rowId])).get(closure.rowId) ?? null;
  check('post-writer: the SAME row now has match_id M; EVERY other column (player, votes 0, played, afl_api, CD_M, import batch, imported_at) byte-identical',
    resolved !== null && resolved.match_id === M && canonicalJson({ ...resolved, match_id: null }) === canonicalJson(corrected), JSON.stringify(resolved));
  const audits = await auditsForMatch(owner, M, cutoff);
  logWriterAudit(cutoff, audits);
  const audit = audits[0];
  check('the writer\'s provenance: exactly one data_edits row for M, brownlow_vote_entry_state/finalise, revision 1, created at or after c',
    audits.length === 1 && audit.tableName === 'brownlow_vote_entry_state' && audit.fieldGroup === 'finalise' && audit.afterCutoff
      && (audit.newValues as Record<string, JsonValue>).revision === 1, JSON.stringify(audits));
  const k = canonicalJson(key);
  await q2Satisfied(ctx, c, w, closure.externalRecordId, 'brownlow_round_votes', key, [
    { label: 'the recognised match_id resolve', line: `post_correction_edit brownlow_admin: brownlow_round_votes ${k} match_id null -> ${M} (audit ${String(audit?.id)})` },
    { label: 'its satisfaction entry', line: `post_correction_edit brownlow_admin (PASS): brownlow_round_votes ${k} match_id null -> ${M} (audit ${String(audit?.id)})` },
  ], { label: 'the resolved corrected row and the Brownlow state', read: async () => `${await rowText(owner, 'brownlow_round_votes', closure.rowId)()}|${(await guardSnapshot(owner, w)).sha256}` });
}

/* ==================================================================== *
 * Target-absence / admin-revoke group (§12.1): 14, 15, 32
 * ==================================================================== *
 *
 * 14 and 15 are one intentional pair on ONE corrected base (`correctedAbsenceBase`): case 1's CD_I
 * closure row at (P, M) CORRECTED by the real CLI, plus an empty sibling 2092 match (round 2) so that
 * deleting M never empties the season (the real deleteMatch's `recomputeClubSeasons` refuses that).
 * The pair differs ONLY in the provenance of the moved row's later disappearance:
 *   - 14: the REAL `deleteMatch` (react-server) removes M, and with it the moved row, and writes its
 *     durable `data_edits` matches/match_deletion audit after c -> NOOP correction_target_absent;
 *   - 15: the same row disappears OUT OF BAND (owner SQL, no writer, no audit): `match-exists` removes
 *     only the row; `match-gone` also removes M, detaching only what M's foreign keys force (P′'s derived
 *     player_clubs first/last match) -> STOP correction_target_absent_unexplained.
 * 32 is case 1's corrected base, then the REAL `revokeAflApiLink` with the fingerprint the REAL admin
 * page loader (`readAflApiProviderEvidence`) yields -> refused T21 before the non-use proof, no write.
 */

type CorrectedAbsenceBase = CorrectedPmsBase<FixtureMatch> & { sibling: FixtureMatch; applicationId: number };

async function correctedAbsenceBase(ctx: CaseContext, caseNumber: 14 | 15): Promise<CorrectedAbsenceBase> {
  const { owner, check } = ctx;
  const base = await correctedPmsBase(ctx, caseNumber, (tx, w) => fixtureMatch(tx, w, 2, 2));
  const { closure, c, cutoff } = base;
  const sibling = base.extra;
  const [pre] = await owner<{ match: number; sibling: number; atSibling: number }[]>`
    SELECT (SELECT count(*)::int FROM matches WHERE id = ${closure.matchId}) AS match,
           (SELECT count(*)::int FROM matches WHERE id = ${sibling.id}) AS sibling,
           (SELECT count(*)::int FROM player_match_stats WHERE match_id = ${sibling.id}) AS "atSibling"
  `;
  check('absence base: M and the empty sibling 2092 match (round 2) both exist; the sibling holds no row', pre.match === 1 && pre.sibling === 1 && pre.atSibling === 0, JSON.stringify(pre));
  const apps = await owner<{ id: number }[]>`
    SELECT id::int AS id FROM canonical_applications WHERE import_batch_id = ${c.r.batchId} AND external_record_id = ${closure.externalRecordId}
  `;
  check('absence base: exactly one correction application in batch K for the closure row', apps.length === 1, JSON.stringify(apps));
  console.log(`  correction: adjudication ${c.r.adjudicationId}, batch K ${c.r.batchId}, application ${apps[0]?.id}, c = ${cutoff}; sibling match ${sibling.id}`);
  return { ...base, sibling, applicationId: apps[0].id };
}

/** The moved row's absence, as one comparable text: the corrected row id, anything at (P′, M) or
 * (P, M), and whether M exists. A Q2 re-run must leave it byte-identical (nothing recreated). */
async function absenceState(owner: Sql, w: World, closure: PmsClosureRow): Promise<string> {
  const [s] = await owner<{ s: JsonValue }[]>`
    SELECT jsonb_build_object(
      'rowById', (SELECT to_jsonb(p.*) FROM player_match_stats p WHERE p.id = ${closure.rowId}),
      'pPrimeAtM', (SELECT count(*)::int FROM player_match_stats WHERE player_id = ${w.pPrime.id} AND match_id = ${closure.matchId}),
      'pAtM', (SELECT count(*)::int FROM player_match_stats WHERE player_id = ${w.p.id} AND match_id = ${closure.matchId}),
      'atM', (SELECT count(*)::int FROM player_match_stats WHERE match_id = ${closure.matchId}),
      'match', (SELECT count(*)::int FROM matches WHERE id = ${closure.matchId})
    ) AS s
  `;
  return canonicalJson(s.s);
}

/** A foreign-key reference to M, named without the schema qualifier `regclass::text` may carry. */
const referenceName = (column: string) => column.replace(/^public\./, '');

/**
 * The Q2 pair on a corrected base whose moved row is gone: `--validate-only`, then the locking
 * `--apply`. `expected` is either ALREADY_SATISFIED carrying `lines` (and SAT PASS), or a STOP with
 * exactly one stop `stop`. Either way: no `NOOP already_corrected_moved` (the row is absent, not moved
 * and present), no other classification line, the correction footprint byte-identical (no second
 * correction), and the absence itself byte-identical (nothing recreated at (P′, M) or (P, M)).
 */
async function q2Absence(
  ctx: CaseContext, base: CorrectedAbsenceBase,
  expected: { kind: 'ALREADY_SATISFIED'; lines: readonly { label: string; line: string }[] } | { kind: 'STOP'; stop: string },
): Promise<void> {
  const { owner, check } = ctx;
  const { w, closure, c } = base;
  const footprint = await correctionFootprint(owner, w, closure.externalRecordId);
  const absent = await absenceState(owner, w, closure);
  for (const mode of Q2_MODES) {
    const q2 = await q2Rerun(ctx, c, mode);
    const r = q2.result;
    if (expected.kind === 'ALREADY_SATISFIED') {
      check(`Q2 (${mode}): ALREADY_SATISFIED (exit 0), ${SAT_PASS}`, r.kind === 'ALREADY_SATISFIED' && hasLine(q2.lines, SAT_PASS), JSON.stringify(r));
      for (const e of expected.lines) check(`Q2 (${mode}): carries ${e.label}: "${e.line}"`, hasLine(q2.lines, e.line));
      const extra = classificationLines(q2.lines).filter((l) => !expected.lines.some((e) => e.line === l));
      check(`Q2 (${mode}): no other STOP / post-correction / target-absence line`, extra.length === 0, extra.join(' | '));
    } else {
      check(`Q2 (${mode}): STOP (exit 1) with exactly one stop, ${expected.stop}`,
        r.kind === 'STOP' && r.stops.length === 1 && describeCliStop(r.stops[0]) === expected.stop, JSON.stringify(r));
      const explained = q2.lines.filter((l) => /^ALREADY_SATISFIED|post_correction_edit |NOOP correction_target_absent|correction_target_absent \(satisfied\)/.test(l));
      check(`Q2 (${mode}): nothing reported as satisfied or explained`, explained.length === 0, explained.join(' | '));
    }
    const moved = q2.lines.filter((l) => l.startsWith('NOOP already_corrected_moved'));
    check(`Q2 (${mode}): no "NOOP already_corrected_moved" (the target is absent, never read as moved and present)`, moved.length === 0, moved.join(' | '));
    check(`Q2 (${mode}): the correction footprint (ledger, correction batches, applications, identity, projections) is byte-identical: no second correction`,
      (await correctionFootprint(owner, w, closure.externalRecordId)) === footprint);
    check(`Q2 (${mode}): nothing recreated: no row with the corrected id, nothing at (P′, M) or (P, M), M's existence unchanged`,
      (await absenceState(owner, w, closure)) === absent, absent);
  }
  check('post: CD_I\'s ledger is exactly one `corrected` row', canonicalJson(await ledgerActions(owner, w)) === canonicalJson(['corrected']));
  await owner.begin('read only', (tx) => assertAflApiIdentityInvariant(tx));
  check('post: the combined identity invariant (SAT-1 basis) holds', true);
}

/**
 * Case 14 (§12.1 pass 5): the moved row later removed by the REAL match deletion, WITH the durable
 * `data_edits` match_deletion audit for M after c -> NOOP `correction_target_absent` (satisfied),
 * reported, not recreated; ALREADY_SATISFIED. A real-writer refusal is a production finding.
 */
async function case14(ctx: CaseContext): Promise<void> {
  const { owner, check } = ctx;
  const writers = await loadWriters();
  const base = await correctedAbsenceBase(ctx, 14);
  const { w, closure, cutoff, sibling } = base;
  const M = closure.matchId;
  const refsBefore = (await referencesToMatch(owner, M)).filter((r) => r.n !== 0);
  console.log(`  pre-writer: foreign keys naming M: ${JSON.stringify(refsBefore)}`);
  check('pre-writer: the corrected row is at (P′, M) and no data_edits row names M at all',
    JSON.parse(await absenceState(owner, w, closure)).pPrimeAtM === 1 && (await auditsForMatch(owner, M, BEFORE_ANY_AUDIT)).length === 0);
  const result = await writerCall(ctx.importDsn, `${HARNESS_APP}case014-writer-delete-match`, () => writers.deleteMatch({
    matchId: M, adminUserId: w.actorId, reason: 'AFLDB-ISSUE-238 Slice 10 rehearsal case 014: post-correction match deletion of M',
  }));
  console.log(`  writer deleteMatch (after the correction): ${JSON.stringify(result)}`);
  check('writer: the real deleteMatch deleted M', result.ok === true && result.deletedId === M, JSON.stringify(result));
  if (!result.ok) throw new RehearsalRefused(`PRODUCTION FINDING (case 14 STOP): the real deleteMatch refused M after the correction: ${result.error}`);
  const post = JSON.parse(await absenceState(owner, w, closure)) as Record<string, JsonValue>;
  check('post-writer: the moved row is GONE (its id, (P′, M), (P, M), anything at M); M no longer exists',
    post.rowById === null && post.pPrimeAtM === 0 && post.pAtM === 0 && post.atM === 0 && post.match === 0, JSON.stringify(post));
  check('post-writer: the sibling 2092 match survives (the season is not emptied)',
    (await owner<{ n: number }[]>`SELECT count(*)::int AS n FROM matches WHERE id = ${sibling.id}`)[0].n === 1);
  const audits = await auditsForMatch(owner, M, cutoff);
  logWriterAudit(cutoff, audits);
  const audit = audits[0];
  check('the writer\'s durable audit: exactly one data_edits row names M -- matches/match_deletion, created at or after c',
    audits.length === 1 && audit.tableName === 'matches' && audit.fieldGroup === 'match_deletion' && audit.afterCutoff, JSON.stringify(audits));
  const dangling = await referencesToMatch(owner, M);
  check('post-writer: no foreign-key column referencing matches(id) holds M', dangling.every((d) => d.n === 0), JSON.stringify(dangling.filter((d) => d.n !== 0)));
  const k = canonicalJson({ player_id: w.pPrime.id, match_id: M });
  await q2Absence(ctx, base, { kind: 'ALREADY_SATISFIED', lines: [
    { label: 'the target-absent NOOP', line: `NOOP correction_target_absent: player_match_stats ${k} (match ${M} deleted after the correction, audited); lineage L1-L7 retained, never recreated` },
    { label: 'its satisfaction entry citing the writer\'s audit', line: `correction_target_absent (satisfied): player_match_stats ${k}, match ${M} deleted after the correction (audit ${String(audit?.id)})` },
  ] });
}

/**
 * Case 15 (§12.1 pass 5): the moved row absent with NO durable match-deletion audit -> STOP
 * `correction_target_absent_unexplained`. The disappearance is deliberately out of band (the owner's
 * SQL; no writer, no audit), and minimal:
 *   - match-exists: DELETE the moved row only; M still exists;
 *   - match-gone: DELETE the moved row, NULL the derived player_clubs references to M (P′'s first/last
 *     match, from the correction's own derived recompute: M's only other foreign-key references, proven
 *     before the mutation), DELETE M.
 */
async function case15(ctx: CaseContext): Promise<void> {
  const { owner, check, variant } = ctx;
  if (variant !== 'match-exists' && variant !== 'match-gone') throw new RehearsalRefused('case 15 needs --variant match-exists | match-gone');
  const base = await correctedAbsenceBase(ctx, 15);
  const { w, closure, cutoff, sibling } = base;
  const M = closure.matchId;
  const refsBefore = (await referencesToMatch(owner, M)).filter((r) => r.n !== 0).map((r) => ({ column: referenceName(r.column), n: r.n }));
  console.log(`  pre-mutation: foreign keys naming M: ${JSON.stringify(refsBefore)}`);
  const forced = new Set(['player_match_stats.match_id', 'player_clubs.first_match_id', 'player_clubs.last_match_id']);
  const clubRefs = await owner<{ playerId: number }[]>`
    SELECT player_id AS "playerId" FROM player_clubs WHERE first_match_id = ${M} OR last_match_id = ${M} ORDER BY player_id
  `;
  check('pre-mutation: M is named only by the moved row and P′\'s derived player_clubs first/last match (the correction\'s own derived recompute; so the out-of-band removal below is complete and minimal)',
    refsBefore.every((r) => forced.has(r.column)) && refsBefore.some((r) => r.column === 'player_match_stats.match_id' && r.n === 1)
      && canonicalJson(clubRefs.map((r) => r.playerId)) === canonicalJson(refsBefore.some((r) => r.column.startsWith('player_clubs.')) ? [w.pPrime.id] : []),
    JSON.stringify({ refsBefore, clubRefs }));
  const mutation = await owner.begin(async (tx) => {
    const rows = await tx<{ id: number }[]>`DELETE FROM player_match_stats WHERE id = ${closure.rowId} RETURNING id::int AS id`;
    if (variant === 'match-exists') return { rows: rows.length, playerClubs: 0, matches: 0, playerClubPlayers: [] as number[] };
    const playerClubs = await tx<{ playerId: number }[]>`
      UPDATE player_clubs
         SET first_match_id = NULLIF(first_match_id, ${M}), last_match_id = NULLIF(last_match_id, ${M})
       WHERE first_match_id = ${M} OR last_match_id = ${M}
      RETURNING player_id AS "playerId"
    `;
    const matches = await tx<{ id: number }[]>`DELETE FROM matches WHERE id = ${M} RETURNING id`;
    return { rows: rows.length, playerClubs: playerClubs.length, matches: matches.length, playerClubPlayers: playerClubs.map((p) => p.playerId) };
  });
  console.log(`  out-of-band mutation (owner SQL, after c): ${JSON.stringify(mutation)}`);
  check(variant === 'match-exists'
    ? 'mutation: exactly the moved row deleted; nothing else'
    : 'mutation: the moved row deleted, P′\'s derived player_clubs reference(s) to M detached (P′ only), M deleted',
  mutation.rows === 1 && (variant === 'match-exists'
    ? mutation.matches === 0 && mutation.playerClubs === 0
    : mutation.matches === 1 && mutation.playerClubs >= 1 && mutation.playerClubPlayers.every((id) => id === w.pPrime.id)), JSON.stringify(mutation));
  const post = JSON.parse(await absenceState(owner, w, closure)) as Record<string, JsonValue>;
  check(`post-mutation: the moved row is GONE (its id, (P′, M), (P, M)); M ${variant === 'match-exists' ? 'STILL exists' : 'no longer exists'}`,
    post.rowById === null && post.pPrimeAtM === 0 && post.pAtM === 0 && post.atM === 0 && post.match === (variant === 'match-exists' ? 1 : 0), JSON.stringify(post));
  check('post-mutation: the sibling 2092 match is untouched', (await owner<{ n: number }[]>`SELECT count(*)::int AS n FROM matches WHERE id = ${sibling.id}`)[0].n === 1);
  const audits = await auditsForMatch(owner, M, cutoff);
  const [edits] = await owner<{ byActor: number; afterC: number }[]>`
    SELECT (SELECT count(*)::int FROM data_edits WHERE admin_user_id = ${w.actorId}) AS "byActor",
           (SELECT count(*)::int FROM data_edits WHERE created_at >= ${cutoff}::timestamptz
               AND (admin_user_id = ${w.actorId} OR (table_name IN ('matches', 'brownlow_vote_entry_state', 'player_match_stats') AND row_id IN (${M}, ${closure.rowId})))) AS "afterC"
  `;
  console.log(`  c = ${cutoff}; data_edits naming M: ${JSON.stringify(audits)}; by the fixture actor: ${edits.byActor}; after c naming M / the row / the actor: ${edits.afterC}`);
  check('no recognised provenance: no data_edits row names M (no match_deletion, no match_sheet), none by the fixture actor, none after c naming M or the moved row',
    audits.length === 0 && edits.byActor === 0 && edits.afterC === 0, JSON.stringify({ audits, edits }));
  await q2Absence(ctx, base, { kind: 'STOP', stop: 'player_match_stats [C14] correction_target_absent_unexplained: no durable match_deletion audit explains the absence' });
}

/* ---- Case 32 ---- */

type RevokeAflApiLink = typeof revokeAflApiLinkType;
type LinkAflApiProvider = typeof linkAflApiProviderType;
type ReadAflApiProviderEvidence = typeof readAflApiProviderEvidenceType;

/** The admin player-link surface's real server-only operations (react-server), and a closer for the
 * app/auth pools its page loader opens (`@/db/client`, `@/db/authClient`, both global singletons). */
async function loadPlayerLinkSurface(): Promise<{
  readEvidence: ReadAflApiProviderEvidence; revoke: RevokeAflApiLink; link: LinkAflApiProvider; closePools: () => Promise<void>;
}> {
  let mod: Record<string, unknown>;
  try {
    mod = await import('../../src/db/queries/afl-api-player-links') as Record<string, unknown>;
  } catch (error) {
    throw new RehearsalRefused(`the admin player-link surface is server-only: run this harness as \`npx tsx --conditions=react-server ...\` (${(error as Error).message})`);
  }
  const pick = <T>(name: string): T => {
    const value = mod[name] ?? (mod.default as Record<string, unknown> | undefined)?.[name];
    if (typeof value !== 'function') throw new RehearsalRefused(`'${name}' is not exported`);
    return value as T;
  };
  const pools = globalThis as unknown as { __afldbSql?: Sql; __afldbAuthSql?: Sql };
  return {
    readEvidence: pick<ReadAflApiProviderEvidence>('readAflApiProviderEvidence'),
    revoke: pick<RevokeAflApiLink>('revokeAflApiLink'),
    link: pick<LinkAflApiProvider>('linkAflApiProvider'),
    closePools: async () => {
      await Promise.all([pools.__afldbSql?.end({ timeout: 5 }), pools.__afldbAuthSql?.end({ timeout: 5 })]);
    },
  };
}

/**
 * Case 32 (§12.1): admin revoke of a CORRECTED provider -> refused (`T21`) before the non-use proof;
 * no write. The fingerprint is the one the REAL admin page computes from the REAL page loader, so the
 * refusal is not T6 (stale); the page loader classifies CD_I `L-H` (its identity row alone cannot tell
 * corrected from linked), so T21 can only come from the ledger check that precedes the state rules and
 * the non-use proof. Afterwards Q2 is still ALREADY_SATISFIED on a byte-identical correction.
 */
async function case32(ctx: CaseContext): Promise<void> {
  const { owner, check } = ctx;
  const surface = await loadPlayerLinkSurface();
  const { w, closure, c, cutoff } = await correctedPmsBase(ctx, 32);
  const identityBefore = await identityOf(owner, w);
  check('corrected base: CD_I\'s identity row names P′ (the correction re-pointed it)', identityBefore?.player_id === w.pPrime.id, JSON.stringify(identityBefore));
  const ledger = await owner<{ id: number; action: string; createdAt: string; afterCutoff: boolean }[]>`
    SELECT id::int AS id, action::text AS action, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
           created_at >= ${cutoff}::timestamptz AS "afterCutoff"
      FROM afl_api_identity_adjudications WHERE external_id = ${w.providerId} ORDER BY id
  `;
  console.log(`  c = ${cutoff}; CD_I ledger: ${JSON.stringify(ledger)}`);
  check('corrected base: CD_I\'s ledger is exactly the one `corrected` row, the correction\'s adjudication (net action corrected)',
    ledger.length === 1 && ledger[0].action === 'corrected' && ledger[0].id === c.r.adjudicationId, JSON.stringify(ledger));

  let evidence: Awaited<ReturnType<ReadAflApiProviderEvidence>>;
  try {
    evidence = await surface.readEvidence(w.providerId);
  } finally {
    await surface.closePools();
  }
  console.log(`  page loader: ${JSON.stringify(evidence && { state: evidence.state, existing: evidence.existing, pendingCandidates: evidence.pendingCandidates, latestAdjudicationId: evidence.latestAdjudicationId })}`);
  // `latestAdjudicationId` is an int8 the loader passes through uncast (postgres.js: a string). The
  // revoke recomputes it with the SAME reader, so the fingerprint is used exactly as the page yields it.
  check('page loader (real readAflApiProviderEvidence): CD_I is L-H at P′, no pending candidate, latest adjudication = the corrected row',
    evidence !== null && evidence.state === 'L-H' && evidence.existing?.playerId === w.pPrime.id && evidence.existing.id === Number(identityBefore?.id)
      && evidence.pendingCandidates.length === 0 && Number(evidence.latestAdjudicationId) === c.r.adjudicationId,
    `latestAdjudicationId ${typeof evidence?.latestAdjudicationId} ${String(evidence?.latestAdjudicationId)}`);
  if (evidence === null || evidence.existing === null) throw new RehearsalRefused('the page loader returned no evidence for CD_I; the revoke is not attempted');
  // Byte-for-byte the page's revoke fingerprint (`admin/player-links/afl-api/[providerId]/page.tsx`).
  const fingerprint = adjudicationFingerprint({
    providerId: w.providerId, existing: evidence.existing, pendingCandidates: evidence.pendingCandidates,
    latestAdjudicationId: evidence.latestAdjudicationId, chosenPlayerId: evidence.existing.playerId ?? 0,
    chosenPlayerExistingRows: [{ id: evidence.existing.id, status: evidence.existing.status, matchMethod: evidence.existing.matchMethod }],
  });

  const [use] = await owner<{ n: number }[]>`
    SELECT count(*)::int AS n FROM player_match_stats
     WHERE player_id = ${w.pPrime.id} AND source_id = ${w.sourceIds.aflApi} AND split_part(source_record_id, '|', 3) = ${w.providerId}
  `;
  check('pre-revoke: the link is USED (P′ holds the corrected row stamped through CD_I), so a non-use proof that ran could only refuse (T19)', use.n === 1, JSON.stringify(use));
  const footprint = await correctionFootprint(owner, w, closure.externalRecordId);
  const correctedRow = rowText(owner, 'player_match_stats', closure.rowId);
  const rowBefore = await correctedRow();
  const [editsBefore] = await owner<{ n: number }[]>`SELECT count(*)::int AS n FROM data_edits WHERE admin_user_id = ${w.actorId}`;

  const result = await writerCall(ctx.importDsn, `${HARNESS_APP}case032-writer-revoke`, () => surface.revoke({
    providerId: w.providerId, adminUserId: w.actorId, fingerprint,
    note: 'AFLDB-ISSUE-238 Slice 10 rehearsal case 032: admin revoke of a corrected provider',
  }));
  const [{ at, afterCutoff }] = await owner<{ at: string; afterCutoff: boolean }[]>`
    SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at, now() >= ${cutoff}::timestamptz AS "afterCutoff"
  `;
  console.log(`  writer revokeAflApiLink (after the correction; db clock ${at}, after c: ${String(afterCutoff)}): ${JSON.stringify(result)}`);
  check('writer: the real revokeAflApiLink REFUSED with T21_revoke_corrected and its exact message (not T6: the page fingerprint matched; not T8/T20/T19: the state rules and the non-use proof never ran)',
    !result.ok && result.code === 'T21_revoke_corrected' && result.error === aflApiRefusalMessage('T21_revoke_corrected'), JSON.stringify(result));
  check('no write: CD_I\'s identity row byte-identical (still at P′)', canonicalJson(await identityOf(owner, w)) === canonicalJson(identityBefore));
  check('no write: CD_I\'s ledger is still exactly the one `corrected` row (no `revoked` row)', canonicalJson(await ledgerActions(owner, w)) === canonicalJson(['corrected']));
  check('no write: the correction footprint (ledger, correction batches, applications, identity, projections) is byte-identical',
    (await correctionFootprint(owner, w, closure.externalRecordId)) === footprint);
  check('no write: the corrected row is byte-identical', (await correctedRow()) === rowBefore);
  const [editsAfter] = await owner<{ n: number }[]>`SELECT count(*)::int AS n FROM data_edits WHERE admin_user_id = ${w.actorId}`;
  check('no write: no data_edits row by the fixture actor', editsBefore.n === 0 && editsAfter.n === 0, JSON.stringify({ before: editsBefore.n, after: editsAfter.n }));
  await owner.begin('read only', (tx) => assertAflApiIdentityInvariant(tx));
  check('post-revoke: the combined identity invariant holds', true);

  // The correction is untouched by the refused revoke: the Q2 pair is still ALREADY_SATISFIED.
  await q2Satisfied(ctx, c, w, closure.externalRecordId, 'player_match_stats', { player_id: w.pPrime.id, match_id: closure.matchId }, [],
    { label: 'the corrected row', read: correctedRow });
}

/* ==================================================================== *
 * Family F -- authority / CLI acceptance (§12.1 cases 24, 28, 30, 31, 58)
 *
 * These cases exercise the ORIGINAL authority block and the CLI's preconditions, not new row
 * mechanics: every base is case 1's (one CD_I row at (P, M), no P′ counterpart), and the correction
 * that would otherwise run is proven valid (`--validate-only` PLAN OK) in the SAME fixture before the
 * condition under test is introduced or the flag under test is given.
 *
 * - 24 (D8): a second provider CD_K is the live AFL API authority at P′. Its evidence is a real
 *   `unresolved_identity` observation; the authority is then either an importer bootstrap row
 *   (`unique`) or the REAL admin link (`resolved` + `linked`). The STOP is whole-plan (§5.4) and
 *   precedes the closure build, so it prints no reference fingerprint; the locking `--apply` is handed
 *   the base's real fingerprint and must STOP identically.
 * - 28: the CLI's `--expect-fingerprint` contract (§8.2 step 2): a wrong but well-formed value is
 *   refused inside the apply transaction before batch K is opened. The state snapshot includes the
 *   batch / ledger / application id sequences, whose advance survives a rollback, so an unchanged
 *   sequence proves no INSERT was even attempted. A control apply with the real value then commits.
 * - 30 / 31: the predecessor rule (§10 M1; `correctionLedgerChainValid`): `supersedes_id` is the
 *   provider's NET ledger row when that row is `linked` (human origin), else NULL (importer origin).
 *   The pair shares everything but the authority lineage: P and P′ carry the same surname (the admin
 *   or the importer chose the wrong one of two same-surname players), the provider's observation
 *   publishes it, and its `unresolved_identity` candidate is retained (nothing in the product
 *   resolves one), so the surname gate runs and agrees. 30's CD_I is an importer bootstrap row with no
 *   ledger history; 31's is the REAL admin link (page-loader fingerprint), and a later decoy `linked`
 *   row for another provider (a third player Q) must never be chosen as the predecessor.
 * - 58 (§10 M1): the observed surname is the provider's retained candidate payload (the only source
 *   the CLI reads, `readObservedSurname`), compared with P′'s canonical surname by the production
 *   `normaliseSurname`. Variants: disagreement without the flag (STOP M1), with it (COMMITTED, stored
 *   `true`), the flag against an agreeing observation (REFUSED), and the flag with no observation at
 *   all (REFUSED; the ORIGINAL norm, an extra variant).
 * ==================================================================== */

/**
 * A retained pending `unresolved_identity` candidate for observation `externalRecordId` v1, exactly
 * what the settle writes for a player it cannot resolve (`settle-afl-api.ts` `writePromotionCandidate`:
 * no target, no fields, no groups), raised by its own earlier settle run. Nothing in the product ever
 * resolves such a candidate (moot but retained, `settle-report.ts` `classifyCandidate`), so it outlives
 * a link, a bootstrap and the later settle. Returns its id.
 */
async function retainedUnresolvedCandidate(tx: TransactionSql, w: World, externalRecordId: string): Promise<number> {
  const run = await laterSettleBatch(tx, w, 'player_match_stats',
    `settle run that could not resolve ${externalRecordId.split('|')[2]} (unresolved_identity candidate)`);
  const [candidate] = await tx<{ id: string }[]>`
    INSERT INTO promotion_candidates (source_id, family, external_record_id, source_version_seq, verb, season,
                                      target_table, target_id, proposed_fields, baseline_canonical_hash,
                                      agreeing_groups, disagreeing_groups, created_by_batch_id)
    VALUES (${w.sourceIds.aflApi}, 'player_match_stats', ${externalRecordId}, 1, 'unresolved_identity', ${w.season},
            'player_match_stats', NULL, '{}'::jsonb, NULL, '{}'::text[], '{}'::text[], ${run})
    RETURNING id::text AS id
  `;
  return Number(candidate.id);
}

/** Another provider's unresolved observation at its own fixture match `n` (published surname
 * `surname`), with its retained candidate: the evidence an importer bootstrap or an admin link acts on. */
async function otherProviderEvidence(tx: TransactionSql, w: World, n: number, surname: string) {
  const match = await fixtureMatch(tx, w, n);
  const providerId = `${R.providerPrefix}${w.caseCode}${n}`;
  const providerTeamId = `${R.teamPrefix}H`;
  const externalRecordId = `${match.providerMatchId}|${providerTeamId}|${providerId}`;
  await storeObservation(tx, w, 'player_match_stats', externalRecordId,
    pmsPayload(w, match.providerMatchId, providerTeamId, providerId, settledValues(w.clubs.home.id), surname));
  const candidateId = await retainedUnresolvedCandidate(tx, w, externalRecordId);
  return { providerId, externalRecordId, candidateId, matchId: match.id };
}

/** The surname gate's inputs exactly as the CLI reads them (`readObservedSurname`'s query, verbatim,
 * and `players.surname`), and its verdict through the production `normaliseSurname`. */
async function surnameGate(owner: Sql, w: World) {
  const [row] = await owner<{ payload: { playerStats?: { player?: { playerName?: { surname?: unknown } } } } }[]>`
    SELECT p.raw_payload AS payload
      FROM promotion_candidates c
      JOIN staging.source_record_versions v
        ON v.source_id = c.source_id AND v.family = c.family
       AND v.external_record_id = c.external_record_id AND v.version_seq = c.source_version_seq
      JOIN staging.source_payloads p
        ON p.source_id = v.source_id AND p.family = v.family AND p.payload_hash = v.payload_hash
     WHERE c.source_id = (SELECT id FROM sources WHERE key = 'afl_api')
       AND split_part(c.external_record_id, '|', 3) = ${w.providerId}
     ORDER BY c.id DESC LIMIT 1
  `;
  const raw = row?.payload.playerStats?.player?.playerName?.surname;
  const observed = typeof raw === 'string' ? raw : null;
  const players = await owner<{ id: number; surname: string | null }[]>`SELECT id, surname FROM players WHERE id IN (${w.p.id}, ${w.pPrime.id})`;
  const pSurname = players.find((p) => p.id === w.p.id)?.surname ?? null;
  const pPrimeSurname = players.find((p) => p.id === w.pPrime.id)?.surname ?? null;
  const disagrees = observed !== null && normaliseSurname(observed) !== '' && normaliseSurname(pPrimeSurname) !== ''
    && normaliseSurname(observed) !== normaliseSurname(pPrimeSurname);
  const gate = {
    observed, observedNormalised: normaliseSurname(observed), pSurname, pNormalised: normaliseSurname(pSurname),
    pPrimeSurname, pPrimeNormalised: normaliseSurname(pPrimeSurname), disagrees,
  };
  console.log(`  surname gate inputs (CLI query + production normaliseSurname): ${JSON.stringify(gate)}`);
  return gate;
}

/**
 * Everything a Family-F refusal must leave untouched, as one canonical string: every fixture
 * provider's identity row and ledger rows (CD_K's included), every correction batch, every fixture
 * application, the closure row, every CD_* projection, the retained candidates, the fixture findings,
 * P's and P′'s derived rows, the fixture census, and the id sequences of `import_batches`,
 * `afl_api_identity_adjudications` and `canonical_applications`.
 */
async function familyFState(owner: Sql, w: World, closure: PmsClosureRow): Promise<string> {
  const providers = `${R.providerPrefix}%`;
  const records = `${R.matchProviderPrefix}%`;
  const [row] = await owner<{ s: JsonValue }[]>`
    SELECT jsonb_build_object(
      'identities', (SELECT jsonb_agg(to_jsonb(ei.*) ORDER BY ei.id) FROM external_identities ei
                      WHERE ei.source_id = ${w.sourceIds.aflApi} AND ei.external_id LIKE ${providers}),
      'ledger', (SELECT jsonb_agg(to_jsonb(a.*) ORDER BY a.id) FROM afl_api_identity_adjudications a WHERE a.external_id LIKE ${providers}),
      'correctionBatches', (SELECT jsonb_agg(to_jsonb(b.*) ORDER BY b.id) FROM import_batches b
                             WHERE b.tool = ${R.correctionTool} AND b.validation_result->>'externalId' LIKE ${providers}),
      'applications', (SELECT jsonb_agg(to_jsonb(ca.*) ORDER BY ca.id) FROM canonical_applications ca WHERE ca.external_record_id LIKE ${records}),
      'closureRow', (SELECT to_jsonb(p.*) FROM player_match_stats p WHERE p.id = ${closure.rowId}),
      'projections', (SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.external_record_id) FROM staging.afl_api_player_match x
                       WHERE x.provider_player_id LIKE ${providers}),
      'candidates', (SELECT jsonb_agg(to_jsonb(c.*) ORDER BY c.id) FROM promotion_candidates c WHERE c.external_record_id LIKE ${records}),
      'findings', (SELECT jsonb_agg(to_jsonb(d.*) ORDER BY d.id) FROM data_issues d WHERE d.details->>'external_id' LIKE ${providers}),
      'sequences', (SELECT jsonb_object_agg(t.tbl, s.last_value)
                      FROM (VALUES ('import_batches'), ('afl_api_identity_adjudications'), ('canonical_applications')) t(tbl)
                      JOIN pg_sequences s ON format('%I.%I', s.schemaname, s.sequencename) = pg_get_serial_sequence('public.' || t.tbl, 'id'))
    ) AS s
  `;
  return canonicalJson({
    state: row.s, census: await readResidue(owner), derived: (await derivedOf(owner, [w.p.id, w.pPrime.id])).sha256,
  } as JsonValue);
}

const sequencesOf = (state: string) => (JSON.parse(state) as { state: { sequences: JsonValue } }).state.sequences;

type FamilyFRefusal = { kind: 'STOP'; stop: string } | { kind: 'REFUSED'; message: string };
const NOTHING_WRITTEN = '  nothing was written (the transaction rolled back or was never opened)';

/**
 * `--validate-only`, then the locking `--apply --expect-fingerprint <applyFingerprint>` (the base's
 * REAL plan fingerprint), both with `input`'s flags: each must give exactly `expected` and leave
 * `familyFState` byte-identical. A whole-plan STOP (D8, M1) precedes the closure build, so it must
 * print no reference fingerprint.
 */
async function familyFRefusal(
  ctx: CaseContext, w: World, closure: PmsClosureRow, input: CorrectInput, applyFingerprint: string, expected: FamilyFRefusal,
): Promise<void> {
  const { owner, check } = ctx;
  const before = await familyFState(owner, w, closure);
  console.log(`  pre-refusal sequences: ${canonicalJson(sequencesOf(before))}`);
  for (const mode of ['validate-only', 'apply'] as const) {
    const run = runCli(input, mode, mode === 'apply' ? applyFingerprint : null);
    const r = run.result;
    const flags = `${input.acknowledgeSurname ? ' --acknowledge-surname-disagreement' : ''}${mode === 'apply' ? ' --expect-fingerprint <base fingerprint>' : ''}`;
    console.log(`  ${mode}${flags}: exit ${String(run.status)}, ${JSON.stringify(r)}`);
    for (const l of stopLinesOf(run.stdout)) console.log(`    | ${l.trim()}`);
    if (expected.kind === 'STOP') {
      check(`${mode}${flags}: STOP (exit 1) with exactly one stop, "${expected.stop}", and no reference fingerprint (whole-plan STOP)`,
        r.kind === 'STOP' && r.stops.length === 1 && describeCliStop(r.stops[0]) === expected.stop && r.referenceFingerprint === null,
        JSON.stringify(r));
    } else {
      check(`${mode}${flags}: REFUSED (exit 1), exactly "${expected.message}", and "nothing was written"`,
        r.kind === 'REFUSED' && r.message === expected.message && run.stderr.replace(/\r/g, '').split('\n').includes(NOTHING_WRITTEN),
        `${JSON.stringify(r)} ${run.stderr.trim()}`);
    }
    check(`${mode}${flags}: nothing written -- identities (CD_K's too), ledger, correction batches, applications, closure row, projections, `
      + 'candidates, findings, derived rows, fixture census and id sequences byte-identical', (await familyFState(owner, w, closure)) === before);
  }
  const [post] = await owner<{ ledger: number; batches: number; atP: number }[]>`
    SELECT (SELECT count(*)::int FROM afl_api_identity_adjudications WHERE external_id = ${w.providerId} AND action = 'corrected') AS ledger,
           (SELECT count(*)::int FROM import_batches WHERE tool = ${R.correctionTool} AND validation_result->>'externalId' = ${w.providerId}) AS batches,
           (SELECT count(*)::int FROM player_match_stats WHERE id = ${closure.rowId} AND player_id = ${w.p.id}) AS "atP"
  `;
  check('no `corrected` ledger row and no correction batch for CD_I; the closure row is still at P', post.ledger === 0 && post.batches === 0 && post.atP === 1,
    JSON.stringify(post));
  await owner.begin('read only', (tx) => assertAflApiIdentityInvariant(tx));
  check('post: the combined identity invariant holds', true);
}

/** The ledger rows of `providerId` in the CLI's own `LedgerRow` shape (for `correctionLedgerChainValid`). */
async function ledgerRowsOf(owner: Sql, providerId: string): Promise<LedgerRow[]> {
  return owner<LedgerRow[]>`
    SELECT id::int AS id, action, player_id AS "playerId", player_identity AS "playerIdentity",
           supersedes_id::int AS "supersedesId", previous_player_identity AS "previousPlayerIdentity",
           evidence_sha256 AS "evidenceSha256"
      FROM afl_api_identity_adjudications WHERE source_key = 'afl_api' AND external_id = ${providerId} ORDER BY id
  `;
}

const ledgerRowText = async (owner: Sql, id: number) => {
  const [row] = await owner<{ row: JsonValue }[]>`SELECT to_jsonb(a.*) AS row FROM afl_api_identity_adjudications a WHERE a.id = ${id}`;
  return canonicalJson(row?.row ?? null);
};

/** The real admin link (`linkAflApiProvider`), with the link fingerprint the REAL detail page computes
 * from the REAL page loader (`page.tsx`: `chosenPlayerId` 0, no rows); expects `{ ok: true }` and
 * returns the `linked` ledger row it wrote. */
async function adminLink(
  ctx: CaseContext, surface: Awaited<ReturnType<typeof loadPlayerLinkSurface>>, w: World,
  link: { providerId: string; playerId: number; candidateId: number; label: string },
): Promise<LedgerRow> {
  const { owner, check } = ctx;
  // The loader's app/auth pools are global singletons: the CASE closes them once, in its `finally`.
  const evidence = await surface.readEvidence(link.providerId);
  console.log(`  page loader (${link.providerId}): ${JSON.stringify(evidence && { state: evidence.state, existing: evidence.existing, pendingCandidates: evidence.pendingCandidates, latestAdjudicationId: evidence.latestAdjudicationId, observedSurname: evidence.observedSurname })}`);
  check(`${link.label}: the real page loader classifies ${link.providerId} U1 (no identity row, the retained candidate #${link.candidateId} pending, no ledger row)`,
    evidence !== null && evidence.state === 'U1' && evidence.existing === null && evidence.latestAdjudicationId === null
      && evidence.pendingCandidates.length === 1 && Number(evidence.pendingCandidates[0].id) === link.candidateId);
  if (evidence === null) throw new RehearsalRefused(`the page loader returned no evidence for ${link.providerId}; the link is not attempted`);
  const fingerprint = adjudicationFingerprint({
    providerId: link.providerId, existing: evidence.existing, pendingCandidates: evidence.pendingCandidates,
    latestAdjudicationId: evidence.latestAdjudicationId, chosenPlayerId: 0, chosenPlayerExistingRows: [],
  });
  const result = await writerCall(ctx.importDsn, `${HARNESS_APP}case${w.caseCode}-writer-link`, () => surface.link({
    providerId: link.providerId, playerId: link.playerId, adminUserId: w.actorId, surnameAcknowledged: false, fingerprint,
    note: `AFLDB-ISSUE-238 Slice 10 rehearsal case ${w.caseCode}: ${link.label}`,
  }));
  console.log(`  writer linkAflApiProvider(${link.providerId} -> player ${link.playerId}): ${JSON.stringify(result)}`);
  check(`${link.label}: the real linkAflApiProvider returns ok (page fingerprint matched; no surname acknowledgement needed)`, result.ok, JSON.stringify(result));
  const rows = await ledgerRowsOf(owner, link.providerId);
  const [identity] = await owner<{ playerId: number; status: string; matchMethod: string }[]>`
    SELECT player_id AS "playerId", status::text AS status, match_method AS "matchMethod"
      FROM external_identities WHERE source_id = ${w.sourceIds.aflApi} AND external_id = ${link.providerId}
  `;
  const [ack] = await owner<{ ack: boolean; adminUserId: number }[]>`
    SELECT surname_disagreement_acknowledged AS ack, admin_user_id AS "adminUserId" FROM afl_api_identity_adjudications WHERE id = ${rows[0]?.id ?? 0}
  `;
  check(`${link.label}: exactly one \`linked\` ledger row (supersedes NULL, surname ack false, the fixture actor) and a \`resolved\` admin identity row at player ${link.playerId}`,
    rows.length === 1 && rows[0].action === 'linked' && rows[0].playerId === link.playerId && rows[0].supersedesId === null
      && ack?.ack === false && ack.adminUserId === w.actorId
      && identity?.playerId === link.playerId && identity.status === 'resolved' && identity.matchMethod === 'afl_api_admin_adjudication',
    JSON.stringify({ rows, identity }));
  return rows[0];
}

/** Exactly one correction happened for CD_I: one `corrected` ledger row, one correction batch, one
 * correction application (after the settle's insert), and CD_I resolved at P′. */
async function correctedExactlyOnce(ctx: CaseContext, w: World, closure: PmsClosureRow, c: Corrected): Promise<void> {
  const { owner, check } = ctx;
  const [n] = await owner<{ corrected: number; batches: number; applications: number; identityAtPPrime: number; rowAtPPrime: number }[]>`
    SELECT (SELECT count(*)::int FROM afl_api_identity_adjudications WHERE external_id = ${w.providerId} AND action = 'corrected') AS corrected,
           (SELECT count(*)::int FROM import_batches WHERE tool = ${R.correctionTool} AND validation_result->>'externalId' = ${w.providerId}) AS batches,
           (SELECT count(*)::int FROM canonical_applications WHERE external_record_id = ${closure.externalRecordId} AND import_batch_id = ${c.r.batchId}) AS applications,
           (SELECT count(*)::int FROM external_identities WHERE source_id = ${w.sourceIds.aflApi} AND external_id = ${w.providerId}
               AND player_id = ${w.pPrime.id} AND status = 'resolved') AS "identityAtPPrime",
           (SELECT count(*)::int FROM player_match_stats WHERE id = ${closure.rowId} AND player_id = ${w.pPrime.id}) AS "rowAtPPrime"
  `;
  check('post: CD_I resolved P -> P′ exactly once: one `corrected` row, one correction batch (K), one correction application in K, identity and the row at P′',
    n.corrected === 1 && n.batches === 1 && n.applications === 1 && n.identityAtPPrime === 1 && n.rowAtPPrime === 1, JSON.stringify(n));
  await checkBatchK(ctx, w, c,
    { table: 'player_match_stats', verb: 'update', oldKey: { player_id: w.p.id, match_id: closure.matchId }, newKey: { player_id: w.pPrime.id, match_id: closure.matchId }, preHash: closure.contractSha256 },
    { moved: { player_match_stats: 1, brownlow_round_votes: 0 }, deleted: { player_match_stats: 0, brownlow_round_votes: 0 } });
  const [projection] = await owner<{ playerId: number }[]>`
    SELECT player_id AS "playerId" FROM staging.afl_api_player_match WHERE provider_player_id = ${w.providerId}
  `;
  check('post: CD_I\'s typed projection names P′', projection?.playerId === w.pPrime.id);
  await owner.begin('read only', (tx) => assertAflApiIdentityInvariant(tx));
  check('post: the combined identity invariant (SAT-1 basis) holds', true);
}

/** The committed correction's report lists the retained candidate as pending (report only). */
function checkCandidateReported(ctx: CaseContext, c: Corrected, candidateId: number, externalRecordId: string): void {
  const prefix = `promotion_candidates#${candidateId} player_match_stats ${externalRecordId} -> player_match_stats (unresolved_identity, season ${R.season};`;
  ctx.check('post: the apply report lists the retained candidate under "pending promotion candidates" (reported, never resolved)',
    c.applyStdout.replace(/\r/g, '').split('\n').some((l) => l.trim().startsWith(prefix)), prefix);
}

/* ---- Case 24 ---- */

/**
 * Case 24 (§12.1, D8): P′ already holds another AFL API provider -> STOP. `importer-unique`: CD_K is
 * bootstrapped to P′ by the importer (`unique`, fixture SQL, no ledger row). `admin-linked`: the REAL
 * admin link writes CD_K `resolved` at P′ plus its `linked` row. Both variants carry the same CD_K
 * evidence (an unresolved observation publishing P′'s surname, candidate retained), and in both the
 * base correction plans (PLAN OK) before CD_K becomes an authority.
 */
async function case24(ctx: CaseContext): Promise<void> {
  const variant = ctx.variant as 'importer-unique' | 'admin-linked';
  const surface = variant === 'admin-linked' ? await loadPlayerLinkSurface() : null;
  try {
    await case24Body(ctx, variant, surface);
  } finally {
    await surface?.closePools();
  }
}

async function case24Body(
  ctx: CaseContext, variant: 'importer-unique' | 'admin-linked', surface: Awaited<ReturnType<typeof loadPlayerLinkSurface>> | null,
): Promise<void> {
  const { owner, check } = ctx;
  const { w, closure, extra: cdK } = await buildPms(ctx, 24, (tx, w) => otherProviderEvidence(tx, w, 2, `Zz238-${w.caseCode}-Pprime`));
  console.log(`  CD_K ${cdK.providerId}: unresolved observation ${cdK.externalRecordId} (match #${cdK.matchId}), retained candidate #${cdK.candidateId}`);
  const identityId = await checkClosureStamp(ctx, w, closure, await pmsRow(owner, closure.rowId));
  const heldAtPPrime = async () => owner<{ externalId: string; status: string; matchMethod: string }[]>`
    SELECT ei.external_id AS "externalId", ei.status::text AS status, ei.match_method AS "matchMethod"
      FROM external_identities ei JOIN sources s ON s.id = ei.source_id
     WHERE s.key = 'afl_api' AND ei.player_id = ${w.pPrime.id} AND ei.external_id <> ${w.providerId} AND ei.status IN ('unique', 'resolved')
  `;
  check('pre: P′ holds no AFL API provider; CD_K has no identity row (its observation is evidence, not authority)',
    (await heldAtPPrime()).length === 0 && (await owner`SELECT 1 FROM external_identities WHERE external_id = ${cdK.providerId}`).length === 0);

  // The base correction is otherwise valid: it plans, and that plan's fingerprint is what apply gets.
  const { input } = prepareCorrection(ctx, w);
  const { fingerprint } = await validateOnly(ctx, input, 1);
  check('base: without the conflicting authority the correction plans (PLAN OK, 1 row)', true, fingerprint);

  if (variant === 'importer-unique') {
    await owner`
      INSERT INTO external_identities (source_id, external_id, external_name, player_id, status, candidate_count, match_method, notes)
      VALUES (${w.sourceIds.aflApi}, ${cdK.providerId}, ${`Rehearsal Zz238-${w.caseCode}-Pprime`}, ${w.pPrime.id}, 'unique', 1,
              'afl_api_stat_vector_bootstrap', 'AFLDB-ISSUE-238 Slice 10 rehearsal fixture: CD_K importer bootstrap at P′')
    `;
  } else {
    await adminLink(ctx, surface!, w, { providerId: cdK.providerId, playerId: w.pPrime.id, candidateId: cdK.candidateId,
      label: 'admin links CD_K to P′ (the conflicting authority)' });
  }
  const held = await heldAtPPrime();
  const expectStatus = variant === 'importer-unique' ? 'unique' : 'resolved';
  console.log(`  AFL API providers held at P′ (the CLI's D8 query, CD_I excluded): ${JSON.stringify(held)}`);
  check(`conflict: exactly one other live AFL API provider at P′, CD_K (${cdK.providerId} ≠ ${w.providerId}), ${expectStatus}`,
    held.length === 1 && held[0].externalId === cdK.providerId && cdK.providerId !== w.providerId && held[0].status === expectStatus,
    JSON.stringify(held));
  const cdKLedger = await ledgerRowsOf(owner, cdK.providerId);
  check(`conflict: CD_K's ledger is ${variant === 'importer-unique' ? 'empty (importer origin)' : 'exactly its `linked` row at P′'}`,
    variant === 'importer-unique' ? cdKLedger.length === 0 : cdKLedger.length === 1 && cdKLedger[0].action === 'linked' && cdKLedger[0].playerId === w.pPrime.id,
    JSON.stringify(cdKLedger));
  check('conflict: CD_I is still the importer row at P (the correction\'s own authority is unchanged)',
    Number((await identityOf(owner, w))?.id) === identityId && (await identityOf(owner, w))?.player_id === w.p.id);
  await owner.begin('read only', (tx) => assertAflApiIdentityInvariant(tx));
  check('conflict: the combined identity invariant holds (CD_K at P′ is a legal state)', true);

  await familyFRefusal(ctx, w, closure, input, fingerprint, { kind: 'STOP', stop: 'player_match_stats [D8] p_prime_holds_another_provider' });
}

/* ---- Case 28 ---- */

/**
 * Case 28 (§12.1): fingerprint mismatch at `--apply` -> STOP; nothing written. The CLI's form is a
 * REFUSED thrown inside the apply transaction (§8.2 step 2: "a mismatch inside the apply transaction
 * is a STOP"), after the locking re-plan and before `openCorrectionBatch`.
 */
async function case28(ctx: CaseContext): Promise<void> {
  const { owner, check } = ctx;
  const { w, closure } = await buildPms(ctx, 28, async () => null);
  const identityId = await checkClosureStamp(ctx, w, closure, await pmsRow(owner, closure.rowId));
  const { input, evidenceSha256 } = prepareCorrection(ctx, w);
  const { fingerprint } = await validateOnly(ctx, input, 1);
  const wrong = `${fingerprint.slice(0, -1)}${fingerprint.endsWith('0') ? '1' : '0'}`;
  console.log(`  real fingerprint F       ${fingerprint}\n  --expect-fingerprint F'  ${wrong}`);
  check('F\' is well-formed (64 lowercase hex) and differs from F in exactly its last digit', FINGERPRINT.test(wrong) && wrong !== fingerprint
    && wrong.slice(0, -1) === fingerprint.slice(0, -1));

  const before = await familyFState(owner, w, closure);
  console.log(`  pre-apply sequences: ${canonicalJson(sequencesOf(before))}`);
  const apply = runCli(input, 'apply', wrong);
  console.log(`  apply --expect-fingerprint F': exit ${String(apply.status)}, ${JSON.stringify(apply.result)}`);
  const message = `REFUSED: recomputed fingerprint ${fingerprint} does not match --expect-fingerprint ${wrong}`;
  check(`apply --expect-fingerprint F': REFUSED (exit 1), exactly "${message}", and "nothing was written"`,
    apply.result.kind === 'REFUSED' && apply.result.message === message
      && apply.stderr.replace(/\r/g, '').split('\n').includes(NOTHING_WRITTEN), `${JSON.stringify(apply.result)} ${apply.stderr.trim()}`);
  check('nothing written, and nothing even attempted: identities, ledger, correction batches, applications, closure row, projections, '
    + 'findings, derived rows, census AND the batch / ledger / application id sequences byte-identical (a rolled-back INSERT would still have advanced one)',
    (await familyFState(owner, w, closure)) === before);
  const [post] = await owner<{ ledger: number; batches: number; applications: number; identityAtP: number; projection: number }[]>`
    SELECT (SELECT count(*)::int FROM afl_api_identity_adjudications WHERE external_id = ${w.providerId}) AS ledger,
           (SELECT count(*)::int FROM import_batches WHERE tool = ${R.correctionTool} AND validation_result->>'externalId' = ${w.providerId}) AS batches,
           (SELECT count(*)::int FROM canonical_applications WHERE external_record_id = ${closure.externalRecordId}) AS applications,
           (SELECT count(*)::int FROM external_identities WHERE id = ${identityId} AND player_id = ${w.p.id} AND status = 'unique') AS "identityAtP",
           (SELECT player_id FROM staging.afl_api_player_match WHERE provider_player_id = ${w.providerId}) AS projection
  `;
  check('no ledger row, no correction batch, only the settle\'s insert application; CD_I still unique at P; the projection still names P',
    post.ledger === 0 && post.batches === 0 && post.applications === 1 && post.identityAtP === 1 && post.projection === w.p.id, JSON.stringify(post));
  check('the closure row is byte-identical at (P, M)', (await pmsRow(owner, closure.rowId))?.player_id === w.p.id);

  // The state is unchanged, so the real fingerprint is unchanged.
  const again = runCli(input, 'validate-only', null);
  console.log(`  validate-only again: exit ${String(again.status)}, ${JSON.stringify(again.result)}`);
  check('validate-only again: PLAN OK with the SAME fingerprint F (the refusal changed nothing)',
    again.result.kind === 'PLANNED' && again.result.fingerprint === fingerprint && again.result.rowsPlanned === 1, JSON.stringify(again.result));

  // Control: the same invocation with F commits, so the refusal was the fingerprint contract alone.
  const ok = runCli(input, 'apply', fingerprint);
  console.log(`  control apply --expect-fingerprint F: exit ${String(ok.status)}, ${JSON.stringify(ok.result)}`);
  check('control: apply --expect-fingerprint F COMMITS (fingerprint F, moved 1, deleted 0, report complete)',
    ok.result.kind === 'COMMITTED' && ok.result.fingerprint === fingerprint && ok.result.moved === 1 && ok.result.deleted === 0 && !ok.result.reportIncomplete,
    JSON.stringify(ok.result));
  if (ok.result.kind !== 'COMMITTED') throw new RehearsalRefused('the control apply did not commit');
  const c: Corrected = { fingerprint, r: ok.result, evidenceSha256, validateStdout: '', applyStdout: ok.stdout, input };
  await checkLedgerAndIdentity(ctx, w, identityId, c);
  await correctedExactlyOnce(ctx, w, closure, c);
}

/* ---- Cases 30 and 31 ---- */

/** P's and P′'s shared surname (two same-surname players, the classic wrong pick). */
const twinSurname = (n: number) => `Zz238-${caseCode(n)}-Twin`;

async function checkSurnameAgrees(ctx: CaseContext, w: World): Promise<void> {
  const gate = await surnameGate(ctx.owner, w);
  ctx.check('surname gate: the retained candidate publishes the shared surname; P and P′ carry it; normalised equal -> no disagreement, no flag',
    gate.observed === twinSurname(Number(w.caseCode)) && gate.pSurname === gate.observed && gate.pPrimeSurname === gate.observed
      && gate.observedNormalised === gate.pPrimeNormalised && gate.observedNormalised !== '' && !gate.disagrees, JSON.stringify(gate));
}

/** The predecessor rule on the committed state: CD_I's ledger through the CLI's own chain rule. */
function checkChainRule(ctx: CaseContext, rows: readonly LedgerRow[], c: Corrected, expectedPredecessor: number | null): void {
  const corrected = rows.find((r) => r.id === c.r.adjudicationId);
  const prior = rows.filter((r) => corrected !== undefined && r.id < corrected.id);
  const priorNet = prior.length > 0 ? prior[prior.length - 1] : null;
  ctx.check(`chain: the net ledger row before the correction is ${priorNet === null ? 'none (NONE)' : `#${priorNet.id} ${priorNet.action}`}; `
    + `supersedes_id = ${String(expectedPredecessor)}; the CLI's correctionLedgerChainValid accepts it`,
    corrected !== undefined && corrected.supersedesId === expectedPredecessor && (expectedPredecessor === null ? priorNet === null : priorNet?.id === expectedPredecessor)
      && correctionLedgerChainValid(rows, corrected), JSON.stringify(rows));
}

/**
 * Case 30 (§12.1): importer-origin ORIGINAL (`unique`, net state NONE) -> one `corrected` row,
 * `supersedes_id` NULL. The importer bootstrapped CD_I to P, the wrong one of two same-surname
 * players, after a settle run that could not resolve it (candidate retained). No ledger row exists
 * for CD_I: no importer writes the ledger (only the admin link/revoke, this CLI and the replays do).
 */
async function case30(ctx: CaseContext): Promise<void> {
  const { owner, check } = ctx;
  const twin = twinSurname(30);
  const { w, closure, candidateId } = await owner.begin(async (tx) => {
    const built = await world(tx, 30, { surnames: { p: twin, pPrime: twin } });
    const observed = await observePmsClosure(tx, built, 1, undefined, twin);
    const candidate = await retainedUnresolvedCandidate(tx, built, observed.externalRecordId);
    const row = await settlePmsClosure(tx, built, observed);
    await settleDerived(tx, built);
    return { w: built, closure: row, candidateId: candidate };
  });
  logPmsFixture(w, closure);
  const identityId = await checkClosureStamp(ctx, w, closure, await pmsRow(owner, closure.rowId));
  const [{ ledger, pending }] = await owner<{ ledger: number; pending: number }[]>`
    SELECT (SELECT count(*)::int FROM afl_api_identity_adjudications WHERE external_id = ${w.providerId}) AS ledger,
           (SELECT count(*)::int FROM promotion_candidates WHERE id = ${candidateId} AND status = 'pending' AND verb = 'unresolved_identity') AS pending
  `;
  check('pre: importer origin -- CD_I has NO ledger row (net state NONE); its unresolved_identity candidate is retained, pending',
    ledger === 0 && pending === 1, JSON.stringify({ ledger, pending }));
  await checkSurnameAgrees(ctx, w);

  const c = await correct(ctx, w, { rowsPlanned: 1, moved: 1, deleted: 0 });
  await checkLedgerAndIdentity(ctx, w, identityId, c);
  checkChainRule(ctx, await ledgerRowsOf(owner, w.providerId), c, null);
  await correctedExactlyOnce(ctx, w, closure, c);
  checkCandidateReported(ctx, c, candidateId, closure.externalRecordId);
}

/**
 * Case 31 (§12.1): human-origin ORIGINAL (`resolved`, net `LINKED(P)`) -> one `corrected` row,
 * `supersedes_id` = the linked row. CD_I is observed but unresolved (candidate retained, no identity
 * row: U1); the REAL admin link (page-loader fingerprint) links it to P, the wrong twin, writing H;
 * the later settle then settles CD_I's row at P. Just before the correction an unrelated provider
 * CD_K is really linked to a third player Q, so the newest `linked` row in the ledger is NOT H.
 */
async function case31(ctx: CaseContext): Promise<void> {
  const surface = await loadPlayerLinkSurface();
  try {
    await case31Body(ctx, surface);
  } finally {
    await surface.closePools();
  }
}

async function case31Body(ctx: CaseContext, surface: Awaited<ReturnType<typeof loadPlayerLinkSurface>>): Promise<void> {
  const { owner, check } = ctx;
  const twin = twinSurname(31);
  const { w, observed, candidateId, q, decoy } = await owner.begin(async (tx) => {
    const built = await world(tx, 31, { importerLink: false, surnames: { p: twin, pPrime: twin } });
    const obs = await observePmsClosure(tx, built, 1, undefined, twin);
    const candidate = await retainedUnresolvedCandidate(tx, built, obs.externalRecordId);
    const third = await insertPlayer(tx, built.caseCode, 'Q', built.sourceIds);
    const other = await otherProviderEvidence(tx, built, 2, `Zz238-${built.caseCode}-Q`);
    return { w: built, observed: obs, candidateId: candidate, q: third, decoy: other };
  });
  console.log(`  fixture: P=${w.p.id} (${w.p.path}), P'=${w.pPrime.id} (${w.pPrime.path}), Q=${q.id} (${q.path}), provider ${w.providerId} `
    + `(observed at ${observed.externalRecordId}, candidate #${candidateId}), decoy provider ${decoy.providerId} (candidate #${decoy.candidateId}), actor ${w.actorId}`);
  check('pre: CD_I has no identity row and no ledger row (U1: observed, unresolved, candidate retained)',
    (await identityOf(owner, w)) === null && (await ledgerRowsOf(owner, w.providerId)).length === 0);

  const h = await adminLink(ctx, surface, w, { providerId: w.providerId, playerId: w.p.id, candidateId, label: 'admin links CD_I to P (the wrong twin)' });
  check('H: the `linked` row names P at P\'s stable identity', h.playerId === w.p.id && h.playerIdentity === w.p.path, JSON.stringify(h));
  const hText = await ledgerRowText(owner, h.id);

  // The later settle, now that CD_I resolves to P: the insert at (P, M), the row, the projection.
  const closure = await owner.begin(async (tx) => {
    const row = await settlePmsClosure(tx, w, observed);
    await settleDerived(tx, w);
    return row;
  });
  logPmsFixture(w, closure);
  const before = await pmsRow(owner, closure.rowId);
  check('pre: the closure row is at (P, M), afl_api-owned, stamped <CD_M>|<team>|CD_I with its settle batch',
    before?.player_id === w.p.id && before.match_id === closure.matchId && before.source_record_id === closure.externalRecordId
      && Number(before.import_batch_id) === w.settleBatchId);
  const identity = await identityOf(owner, w);
  check('pre: CD_I is the admin row at P (resolved, afl_api_admin_adjudication): net ledger state LINKED(P) = H',
    identity?.player_id === w.p.id && identity.status === 'resolved' && identity.match_method === 'afl_api_admin_adjudication', JSON.stringify(identity));
  const identityId = Number(identity?.id);

  const d = await adminLink(ctx, surface, w, { providerId: decoy.providerId, playerId: q.id, candidateId: decoy.candidateId,
    label: 'admin links the unrelated CD_K to Q (the decoy: the newest linked row in the ledger)' });
  const decoyText = await ledgerRowText(owner, d.id);
  check('decoy: its `linked` row is newer than H and names neither P nor P′', d.id > h.id && d.playerId === q.id);
  await owner.begin('read only', (tx) => assertAflApiIdentityInvariant(tx));
  check('pre: the combined identity invariant holds', true);
  await checkSurnameAgrees(ctx, w);

  const c = await correct(ctx, w, { rowsPlanned: 1, moved: 1, deleted: 0 });
  await checkLedgerAndIdentity(ctx, w, identityId, c, { priorRows: 1, supersedesId: h.id, previousStatus: 'resolved' });
  const rows = await ledgerRowsOf(owner, w.providerId);
  check('post: CD_I\'s ledger is exactly [H linked, C corrected]', canonicalJson(rows.map((r) => [r.id, r.action])) === canonicalJson([[h.id, 'linked'], [c.r.adjudicationId, 'corrected']]),
    JSON.stringify(rows));
  checkChainRule(ctx, rows, c, h.id);
  check(`post: C does not supersede the decoy #${d.id} (the newest linked row overall)`, rows[rows.length - 1]?.supersedesId !== d.id);
  check('post: H is byte-identical (an append-only predecessor is never rewritten)', (await ledgerRowText(owner, h.id)) === hText);
  check('post: the decoy row is byte-identical, and the decoy provider is still at Q', (await ledgerRowText(owner, d.id)) === decoyText
    && (await owner`SELECT 1 FROM external_identities WHERE external_id = ${decoy.providerId} AND player_id = ${q.id} AND status = 'resolved'`).length === 1);
  await correctedExactlyOnce(ctx, w, closure, c);
  checkCandidateReported(ctx, c, candidateId, closure.externalRecordId);
}

/* ---- Case 58 ---- */

type SurnameVariant = 'disagreement-no-ack' | 'disagreement-ack' | 'ack-no-disagreement' | 'ack-no-observation';
const ACK_REFUSED = 'REFUSED: --acknowledge-surname-disagreement was given but the observed surname does not disagree';

/**
 * Case 58 (§12.1, §10 M1): surname disagreement without acknowledgement -> STOP; with it -> stored
 * `true`; the flag without a disagreement -> refused. CD_I is case 1's importer row at P, and its
 * observation publishes: P's surname (a real disagreement with P′), P′'s exact surname (agreement),
 * or -- `ack-no-observation` -- nothing the CLI can read (no retained candidate).
 */
async function case58(ctx: CaseContext): Promise<void> {
  const { owner, check } = ctx;
  const variant = ctx.variant as SurnameVariant;
  const disagreement = variant === 'disagreement-no-ack' || variant === 'disagreement-ack';
  const published = variant === 'ack-no-disagreement' ? `Zz238-058-Pprime` : `Zz238-058-P`;
  const { w, closure, candidateId } = await owner.begin(async (tx) => {
    const built = await world(tx, 58);
    const observed = await observePmsClosure(tx, built, 1, undefined, published);
    const candidate = variant === 'ack-no-observation' ? null : await retainedUnresolvedCandidate(tx, built, observed.externalRecordId);
    const row = await settlePmsClosure(tx, built, observed);
    await settleDerived(tx, built);
    return { w: built, closure: row, candidateId: candidate };
  });
  logPmsFixture(w, closure);
  console.log(`  CD_I's observation publishes surname '${published}'; retained candidate: ${candidateId === null ? 'none' : `#${candidateId}`}`);
  const identityId = await checkClosureStamp(ctx, w, closure, await pmsRow(owner, closure.rowId));
  const gate = await surnameGate(owner, w);
  if (disagreement) {
    check('surname gate: the observed surname is P\'s; it and P′\'s normalise to different non-empty values -> DISAGREES (only the surname differs)',
      gate.observed === 'Zz238-058-P' && gate.observed === gate.pSurname && gate.pPrimeSurname === 'Zz238-058-Pprime'
        && gate.observedNormalised === 'ZZP' && gate.pPrimeNormalised === 'ZZPPRIME' && gate.disagrees, JSON.stringify(gate));
  } else if (variant === 'ack-no-disagreement') {
    check('surname gate: the observed surname is exactly P′\'s -> normalised equal -> NO disagreement',
      gate.observed === 'Zz238-058-Pprime' && gate.observed === gate.pPrimeSurname && gate.observedNormalised === gate.pPrimeNormalised && !gate.disagrees,
      JSON.stringify(gate));
  } else {
    check('surname gate: no retained candidate, so no observed surname -> NO disagreement', gate.observed === null && !gate.disagrees, JSON.stringify(gate));
  }

  const { input: plain, evidenceSha256 } = prepareCorrection(ctx, w);
  const acknowledged: CorrectInput = { ...plain, acknowledgeSurname: true };

  if (variant === 'disagreement-no-ack') {
    // The correction is otherwise valid: acknowledged, it plans; that plan's fingerprint goes to apply.
    const { fingerprint } = await validateOnly(ctx, acknowledged, 1);
    check('base: with the acknowledgement the correction plans (PLAN OK, 1 row): the surname gate is the only obstacle', true, fingerprint);
    await familyFRefusal(ctx, w, closure, plain, fingerprint, { kind: 'STOP', stop: 'player_match_stats [M1] identity_unresolvable' });
    return;
  }
  if (variant === 'disagreement-ack') {
    const c = await correct(ctx, w, { rowsPlanned: 1, moved: 1, deleted: 0 }, { acknowledgeSurname: true });
    check('the validate-only and apply invocations both carried --acknowledge-surname-disagreement', c.input.acknowledgeSurname === true);
    await checkLedgerAndIdentity(ctx, w, identityId, { r: c.r, evidenceSha256 }, { surnameAck: true });
    const [stored] = await owner<{ ack: string; type: string; evidenceFingerprint: string }[]>`
      SELECT surname_disagreement_acknowledged::text AS ack, pg_typeof(surname_disagreement_acknowledged)::text AS type,
             evidence->>'closureFingerprint' AS "evidenceFingerprint"
        FROM afl_api_identity_adjudications WHERE id = ${c.r.adjudicationId}
    `;
    check('post: the stored acknowledgement is boolean `true` in the real schema, written by the CLI\'s own INSERT',
      stored?.ack === 'true' && stored.type === 'boolean', JSON.stringify(stored));
    check('post: the fingerprint is the ordinary plan fingerprint: validate-only = apply = batch K = the ledger evidence\'s closureFingerprint',
      stored?.evidenceFingerprint === c.fingerprint && c.r.fingerprint === c.fingerprint, JSON.stringify({ stored, fingerprint: c.fingerprint }));
    await correctedExactlyOnce(ctx, w, closure, c);
    checkCandidateReported(ctx, c, candidateId!, closure.externalRecordId);
    return;
  }
  // The flag without a disagreement: the plain correction plans; the flag is refused in both modes.
  const { fingerprint } = await validateOnly(ctx, plain, 1);
  check('base: without the flag the correction plans (PLAN OK, 1 row): nothing but the flag is wrong', true, fingerprint);
  await familyFRefusal(ctx, w, closure, acknowledged, fingerprint, { kind: 'REFUSED', message: ACK_REFUSED });
}

/* ==================================================================== *
 * Case 82 -- the schema-1 master manifest season (§5.10 SV-2a), against the REAL corpus
 * ==================================================================== */

/**
 * Case 82 (§12.1): "independent when V matches the CSV row-for-row and the CSV hash equals
 * `csv_sha256`; STOP `season_artefact_unprovable` on one differing value, an extra or missing row, an
 * unresolvable or ambiguous profile path, or a hash mismatch".
 *
 * Unlike every other case the affected season is NOT 2092. It is a REAL season of the committed
 * master manifest `data/brownlow/season-votes.manifest.json` -- its `artefact.last_season`, read from
 * the manifest, never hard-coded -- whose `brownlow_season_votes` rows code_test_db already holds from
 * the artefact loader. That real corpus is read, fingerprinted and proved provable with the product's
 * own `evaluateSv2aEvidence`, and never written. The fixture adds only namespaced rows to that season:
 * case 1's P, P′, CD_I, match M (fixture match key) and the closure row, whose MOVE makes the season
 * an affected season, so the real CLI runs SV-2a against the real corpus.
 *
 * - `independent`: the real season untouched -> the CLI's own verdict `INDEPENDENT SV-2a (artefact)` ->
 *   COMMITTED (validate-only, then apply with that fingerprint).
 * - `extra-row`: + ONE namespaced artefact-class row (`fixtureSeasonArtefact`: source `afltables`,
 *   `brownlow-season:<s>:<fixture path>`, a third fixture player resolvable to exactly one player) ->
 *   V holds a row the CSV lacks -> STOP `[SV-2a] season_artefact_unprovable`, SV-2a(4) the only
 *   failed check, in validate-only and in the locking apply; nothing written.
 *
 * The other §12.1 STOP flavours need a real row or a committed file changed (a differing value, a
 * missing row, an unresolvable path, a hash mismatch), and an ambiguous path is impossible under
 * `external_identities_uq (source_id, external_id)`; the U tests keep them
 * (`tests/correct-afl-api-identity-cli.test.ts`, "case 82").
 */
type ManifestVariant = 'independent' | 'extra-row';

type ManifestContract = {
  manifestSha256: string; schemaVersion: unknown; firstSeason: number; lastSeason: number;
  coverage: readonly (readonly number[])[]; rows: number; seasons: number;
  artefactCsvSha256: unknown; identityCsvSha256: unknown;
  /** Exactly the CLI's SV-2a file inputs (`readSeasonArtefactFiles`), from the same committed paths. */
  files: { manifest: unknown; seasonVotesCsvSha256: string | null; seasonVotesCsvText: string | null; identityCsvSha256: string | null };
  /** Every file of `data/brownlow/` with its sha256: no temporary artefact may appear or change. */
  listing: string;
};

const BROWNLOW_DIR = join(PROJECT_ROOT, 'data', 'brownlow');

function readManifestContract(): ManifestContract {
  const bytes = (name: string): Buffer | null => {
    try {
      return readFileSync(join(BROWNLOW_DIR, name));
    } catch {
      return null;
    }
  };
  const sha = (b: Buffer | null) => (b === null ? null : createHash('sha256').update(b).digest('hex'));
  const manifestBytes = bytes('season-votes.manifest.json');
  if (manifestBytes === null) throw new RehearsalRefused('data/brownlow/season-votes.manifest.json is missing');
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as {
    schema_version?: unknown;
    artefact?: { csv_sha256?: unknown; rows?: number; seasons?: number; first_season?: number; last_season?: number; season_coverage?: number[][] };
    identity?: { csv_sha256?: unknown };
  };
  const artefact = manifest.artefact ?? {};
  if (typeof artefact.first_season !== 'number' || typeof artefact.last_season !== 'number'
    || typeof artefact.rows !== 'number' || typeof artefact.seasons !== 'number' || !Array.isArray(artefact.season_coverage)) {
    throw new RehearsalRefused('the committed manifest has no artefact range/row block');
  }
  const csv = bytes('season-votes.csv');
  return {
    manifestSha256: sha(manifestBytes)!, schemaVersion: manifest.schema_version,
    firstSeason: artefact.first_season, lastSeason: artefact.last_season, coverage: artefact.season_coverage,
    rows: artefact.rows, seasons: artefact.seasons,
    artefactCsvSha256: artefact.csv_sha256, identityCsvSha256: manifest.identity?.csv_sha256,
    files: {
      manifest, seasonVotesCsvSha256: sha(csv), seasonVotesCsvText: csv === null ? null : csv.toString('utf8'),
      identityCsvSha256: sha(bytes('player-identity.csv')),
    },
    listing: readdirSync(BROWNLOW_DIR).sort().map((f) => `${f}:${sha(bytes(f)) ?? 'unreadable'}`).join(' '),
  };
}

/** The real corpus, by the fixture predicate's complement: never physical order (every hash is over
 * rows sorted by the table's natural key). */
type ManifestCorpus = {
  historical: {
    rows: number; seasons: number; first: number | null; last: number | null; maxId: number | null; sha256: string;
    seasonRows: number; seasonSha256: string; profileIdentities: number; profileIdentitiesSha256: string;
  };
  fixtureInSeason: number; allMaxId: number | null; sequence: string;
};

const BSV_FIXTURE = FIXTURE_TABLES.find((t) => t.table === 'brownlow_season_votes')!;
const sortedSha = (expr: string, order: string) =>
  `encode(sha256(convert_to(COALESCE(string_agg(${expr}, chr(10) ORDER BY ${order}), ''), 'UTF8')), 'hex')`;

async function manifestCorpus(sql: Sql, season: number): Promise<ManifestCorpus> {
  return sql.begin('isolation level repeatable read read only', async (tx) => {
    const historic = `NOT ${isFixture(BSV_FIXTURE)}`;
    const [all] = await tx.unsafe<{ rows: number; seasons: number; first: number | null; last: number | null; maxId: number | null; sha256: string }[]>(
      `SELECT count(*)::int AS rows, count(DISTINCT season)::int AS seasons, min(season)::int AS first, max(season)::int AS last,
              max(id)::int AS "maxId", ${sortedSha('to_jsonb(b.*)::text', 'b.season, b.player_id')} AS sha256
         FROM brownlow_season_votes b WHERE ${historic}`);
    const [inSeason] = await tx.unsafe<{ rows: number; sha256: string }[]>(
      `SELECT count(*)::int AS rows, ${sortedSha('to_jsonb(b.*)::text', 'b.player_id')} AS sha256
         FROM brownlow_season_votes b WHERE b.season = $1 AND ${historic}`, [season]);
    const [identities] = await tx.unsafe<{ n: number; sha256: string }[]>(
      `SELECT count(*)::int AS n, ${sortedSha('to_jsonb(ei.*)::text', 'ei.id')} AS sha256
         FROM external_identities ei JOIN sources s ON s.id = ei.source_id
        WHERE s.key = 'afltables' AND ei.external_id IN (
          SELECT substr(b.source_record_id, length('brownlow-season:' || b.season || ':') + 1)
            FROM brownlow_season_votes b WHERE b.season = $1 AND ${historic})`, [season]);
    const [fixture] = await tx.unsafe<{ n: number; allMaxId: number | null; seq: string | null }[]>(
      `SELECT (SELECT count(*)::int FROM brownlow_season_votes WHERE season = $1 AND ${isFixture(BSV_FIXTURE)}) AS n,
              (SELECT max(id)::int FROM brownlow_season_votes) AS "allMaxId",
              pg_get_serial_sequence('public.brownlow_season_votes', 'id') AS seq`, [season]);
    const [sequence] = fixture.seq === null ? [null]
      : await tx.unsafe<{ v: string }[]>(`SELECT last_value::text || CASE WHEN is_called THEN '' ELSE ' (not called)' END AS v FROM ${fixture.seq}`);
    return {
      historical: {
        rows: all.rows, seasons: all.seasons, first: all.first, last: all.last, maxId: all.maxId, sha256: all.sha256,
        seasonRows: inSeason.rows, seasonSha256: inSeason.sha256,
        profileIdentities: identities.n, profileIdentitiesSha256: identities.sha256,
      },
      fixtureInSeason: fixture.n, allMaxId: fixture.allMaxId, sequence: sequence === null ? 'none' : `${fixture.seq} ${sequence.v}`,
    };
  });
}

const sameHistorical = (a: ManifestCorpus, b: ManifestCorpus) => canonicalJson(a.historical) === canonicalJson(b.historical);

/**
 * The PRODUCT's SV-2a (`classifySeasonTotals` + `evaluateSv2aEvidence` + `evaluateSeasonTotalIndependence`)
 * over the committed files and the live season rows, read with the CLI's own column set and
 * `ProfileResolver` predicate. A precondition only: the decisive verdict is the CLI's own output.
 */
async function sv2aProof(sql: Sql, season: number, contract: ManifestContract) {
  return sql.begin('isolation level repeatable read read only', async (tx) => {
    const rows = await tx<SeasonTotalLiveRow[]>`
      SELECT s.key AS "sourceKey", bsv.source_record_id AS "sourceRecordId", bsv.player_id AS "playerId",
             bsv.votes::int AS votes, bsv.vote_rank::int AS "voteRank", bsv.eligible_rank::int AS "eligibleRank",
             bsv.is_ineligible AS "isIneligible", bsv.is_winner AS "isWinner", bsv.games::int AS games,
             bsv.three_vote_games::int AS "threeVoteGames", bsv.two_vote_games::int AS "twoVoteGames",
             bsv.one_vote_games::int AS "oneVoteGames", bsv.polling_games::int AS "pollingGames",
             bsv.link_status_value::text AS "linkStatusValue"
        FROM brownlow_season_votes bsv JOIN sources s ON s.id = bsv.source_id
       WHERE bsv.season = ${season}
    `;
    const [authority] = await tx<{ publishedRevision: number | null }[]>`
      SELECT published_revision AS "publishedRevision" FROM brownlow_season_authority WHERE season = ${season}
    `;
    const seasonClass = classifySeasonTotals(season, rows, authority?.publishedRevision ?? null);
    const prefix = `brownlow-season:${season}:`;
    const urls = new Set(rows.map((r) => r.sourceRecordId.slice(prefix.length)));
    // Which paths to resolve: V's, plus every CSV path of season s (evaluateSv2aEvidence re-parses strictly).
    for (const line of (contract.files.seasonVotesCsvText ?? '').split('\n').slice(1)) {
      const [s, url] = line.replace(/\r$/, '').split(',');
      if (s === String(season) && url) urls.add(url);
    }
    const resolved = await tx<{ url: string; playerId: number }[]>`
      SELECT ei.external_id AS url, ei.player_id AS "playerId"
        FROM external_identities ei JOIN sources s ON s.id = ei.source_id
       WHERE s.key = 'afltables' AND ei.match_method = 'afltables_profile_url'
         AND ei.status IN ('unique', 'resolved') AND ei.player_id IS NOT NULL
         AND ei.external_id = ANY(${tx.array([...urls])}::text[])
    `;
    const profileResolution = new Map<string, number[]>();
    for (const r of resolved) profileResolution.set(r.url, [...(profileResolution.get(r.url) ?? []), r.playerId]);
    const evidence: SeasonIndependenceEvidence = seasonClass === 'artefact'
      ? evaluateSv2aEvidence({ season, ...contract.files, liveRows: rows, profileResolution })
      : { kind: 'unprovable' };
    return { seasonClass, liveRows: rows.length, evidence, independent: evaluateSeasonTotalIndependence(evidence).independent };
  });
}

const SV2A_PROOF = 'schema-1 master: identity.csv_sha256 and artefact.csv_sha256 match, every profile path resolves to exactly one player, '
  + 'and the live rows equal the mapped CSV row-for-row';
const SV2A_FAILED = {
  identity: 'failed: SV-2a(0): manifest identity.csv_sha256 is missing or differs from sha256(data/brownlow/player-identity.csv)',
  artefact: 'failed: SV-2a(1): manifest artefact.csv_sha256 differs from sha256(data/brownlow/season-votes.csv), or the CSV is missing',
  profile: 'failed: SV-2a(3): a season profile path resolves to zero or several players, or the CSV is unparseable',
  rowForRow: 'failed: SV-2a(4): the live season rows are not equal row-for-row to the mapped schema-1 CSV rows',
} as const;

async function case82(ctx: CaseContext): Promise<void> {
  const { owner, check } = ctx;
  const variant = ctx.variant as ManifestVariant;

  // ---- the authoritative contract: the committed master manifest (never a hard-coded range) ----
  const contract = readManifestContract();
  const season = contract.lastSeason;
  console.log(`  manifest contract: schema_version ${String(contract.schemaVersion)}, artefact seasons ${contract.firstSeason}-${contract.lastSeason} `
    + `(season_coverage ${JSON.stringify(contract.coverage)}), ${contract.rows} rows over ${contract.seasons} seasons; manifest sha256 ${contract.manifestSha256}`);
  console.log(`  data/brownlow: ${contract.listing}`);
  check('contract: the committed master manifest is schema 1, and artefact.csv_sha256 / identity.csv_sha256 equal the committed CSVs (SV-2a steps 1 and 0)',
    contract.schemaVersion === 1 && contract.files.seasonVotesCsvSha256 === contract.artefactCsvSha256
      && contract.files.identityCsvSha256 === contract.identityCsvSha256,
    JSON.stringify({ artefact: contract.artefactCsvSha256, csv: contract.files.seasonVotesCsvSha256, identity: contract.identityCsvSha256, identityCsv: contract.files.identityCsvSha256 }));
  check(`contract: the target season ${season} is the manifest's artefact.last_season and lies inside its season_coverage`,
    contract.coverage.some(([from, to]) => season >= from && season <= to));

  // ---- manifestBaseline: the real corpus, before any fixture row exists ----
  const manifestBaseline = await manifestCorpus(owner, season);
  console.log(`  manifestBaseline: ${JSON.stringify(manifestBaseline)}`);
  const h = manifestBaseline.historical;
  check(`baseline: code_test_db holds the real manifest corpus -- ${h.rows} rows, ${h.seasons} seasons, ${String(h.first)}-${String(h.last)} = the manifest's artefact block; `
    + `season ${season}: ${h.seasonRows} rows, ${h.profileIdentities} AFL Tables profile identities; no fixture row in the season`,
    h.rows === contract.rows && h.seasons === contract.seasons && h.first === contract.firstSeason && h.last === contract.lastSeason
      && h.seasonRows > 0 && h.profileIdentities === h.seasonRows && manifestBaseline.fixtureInSeason === 0);
  const baselineProof = await sv2aProof(owner, season, contract);
  check(`baseline: season ${season} is artefact-class and PROVABLE under the product's SV-2a (all four executable checks true -> independent), before any fixture row`,
    baselineProof.seasonClass === 'artefact' && baselineProof.independent && baselineProof.liveRows === h.seasonRows, JSON.stringify(baselineProof));

  // ---- the namespaced fixture: case 1's correction world, in the real season ----
  const { w, closure, fixtureSeasonArtefact } = await owner.begin(async (tx) => {
    const built = await world(tx, 82, { realSeason: season });
    const row = await pmsClosureRow(tx, built, 1);
    await settleDerived(tx, built);
    let extra: { id: number; playerId: number; sourceRecordId: string } | null = null;
    if (variant === 'extra-row') {
      const x = await insertPlayer(tx, built.caseCode, 'Extra', built.sourceIds);
      const sourceRecordId = `brownlow-season:${season}:${x.path}`;
      const [inserted] = await tx<{ id: number }[]>`
        INSERT INTO brownlow_season_votes (season, player_id, votes, vote_rank, eligible_rank, is_ineligible, is_winner, games,
                                           link_status_value, source_id, source_record_id, import_batch_id)
        VALUES (${season}, ${x.id}, 0, NULL, NULL, false, false, 1, 'unique', ${built.sourceIds.afltables}, ${sourceRecordId}, NULL)
        RETURNING id
      `;
      extra = { id: inserted.id, playerId: x.id, sourceRecordId };
    }
    return { w: built, closure: row, fixtureSeasonArtefact: extra };
  });
  console.log(`  fixture: P=${w.p.id} (${w.p.path}), P'=${w.pPrime.id} (${w.pPrime.path}), provider ${w.providerId}, match M=${closure.matchId} `
    + `(season ${w.season}), closure row player_match_stats#${closure.rowId}; fixtureSeasonArtefact ${JSON.stringify(fixtureSeasonArtefact)}`);
  const [m] = await owner<{ season: number; matchKey: string }[]>`SELECT season::int AS season, match_key AS "matchKey" FROM matches WHERE id = ${closure.matchId}`;
  check(`fixture: M is a namespaced match (${m?.matchKey}) in the REAL season ${season}; the closure row is at (P, M)`,
    m?.season === season && m.matchKey.startsWith(R.matchKeyPrefix) && (await pmsRow(owner, closure.rowId))?.player_id === w.p.id);
  const afterSetup = await manifestCorpus(owner, season);
  const expectedFixtureRows = fixtureSeasonArtefact === null ? 0 : 1;
  check(`fixture: the historical corpus is byte-identical after setup; namespaced rows in season ${season}'s V: ${expectedFixtureRows}`,
    sameHistorical(afterSetup, manifestBaseline) && afterSetup.fixtureInSeason === expectedFixtureRows, JSON.stringify(afterSetup));
  const fixtureProof = await sv2aProof(owner, season, contract);
  if (variant === 'independent') {
    check('fixture: the product\'s SV-2a still proves the season independent (the fixture adds no season-total row)',
      fixtureProof.seasonClass === 'artefact' && fixtureProof.independent, JSON.stringify(fixtureProof));
  } else {
    check('fixture: the product\'s SV-2a now fails ONLY step (4) -- still artefact-class (not SV-3), both hashes match, every CSV path resolves once, '
      + 'but V holds one row the CSV lacks',
      fixtureProof.seasonClass === 'artefact' && !fixtureProof.independent && fixtureProof.liveRows === h.seasonRows + 1
        && canonicalJson(fixtureProof.evidence as unknown as JsonValue) === canonicalJson({
          kind: 'artefact_schema_1', artefactCsvSha256Matches: true, identityCsvSha256Matches: true,
          rowForRowMatch: false, profilePathResolvesToExactlyOnePlayer: true,
        }), JSON.stringify(fixtureProof));
  }

  const independentLine = `season ${season}: INDEPENDENT SV-2a (artefact): ${SV2A_PROOF}`;
  const stopLine = `season ${season}: STOP SV-2a (artefact) [SV-2a] season_artefact_unprovable: `
    + 'not proven independent: the schema-1 executable predicate did not fully pass';
  if (variant === 'independent') {
    const [identity] = await owner<{ id: number }[]>`
      SELECT id FROM external_identities WHERE source_id = ${w.sourceIds.aflApi} AND external_id = ${w.providerId}
    `;
    const c = await correct(ctx, w, { rowsPlanned: 1, moved: 1, deleted: 0 });
    for (const [label, stdout] of [['validate-only', c.validateStdout], ['apply', c.applyStdout]] as const) {
      const printed = printedLines(stdout);
      check(`${label}: the CLI's own §5.10 verdict is "${independentLine}", with no failed SV-2a check`,
        printed.includes(independentLine) && !printed.some((l) => l.startsWith('failed: SV-')),
        printed.filter((l) => l.startsWith(`season ${season}:`) || l.startsWith('failed:')).join(' | '));
    }
    await checkLedgerAndIdentity(ctx, w, identity.id, { r: c.r, evidenceSha256: c.evidenceSha256 });
    await correctedExactlyOnce(ctx, w, closure, c);
    const after = await pmsRow(owner, closure.rowId);
    check(`post: the SAME row id now sits at (P′, M) in season ${season}, contract byte-identical`,
      after !== null && after.player_id === w.pPrime.id && after.match_id === closure.matchId
        && rowContractHash(contractOf(after)) === closure.contractSha256);
  } else {
    const artefactRow = async () => {
      const [row] = await owner<{ row: JsonValue }[]>`SELECT to_jsonb(b.*) AS row FROM brownlow_season_votes b WHERE id = ${fixtureSeasonArtefact!.id}`;
      return canonicalJson(row?.row ?? null);
    };
    const artefactBefore = await artefactRow();
    await expectQ1Stop(ctx, w, { table: 'player_match_stats', rowId: null, step: 'SV-2a', code: 'season_artefact_unprovable' }, {
      protect: [{ table: 'player_match_stats', id: closure.rowId }],
      expectOutput: [
        { label: 'the season\'s SV-2a STOP verdict', line: stopLine },
        { label: 'SV-2a(4), the row-for-row failure', line: SV2A_FAILED.rowForRow },
      ],
      forbidOutput: [
        { label: 'SV-2a(0) (identity hash)', line: SV2A_FAILED.identity },
        { label: 'SV-2a(1) (artefact hash)', line: SV2A_FAILED.artefact },
        { label: 'SV-2a(3) (profile resolution)', line: SV2A_FAILED.profile },
        { label: 'an INDEPENDENT verdict', line: independentLine },
      ],
    });
    check('post: the fixtureSeasonArtefact row is byte-identical (the STOP wrote nothing to V)', (await artefactRow()) === artefactBefore);
    const [left] = await owner<{ applications: number; rowAtP: number }[]>`
      SELECT (SELECT count(*)::int FROM canonical_applications WHERE external_record_id = ${closure.externalRecordId}) AS applications,
             (SELECT count(*)::int FROM player_match_stats WHERE id = ${closure.rowId} AND player_id = ${w.p.id}) AS "rowAtP"
    `;
    check('post: no correction application (only the settle insert) and the closure row still at P', left.applications === 1 && left.rowAtP === 1, JSON.stringify(left));
  }

  // ---- the real corpus and the committed files, after the correction / STOP ----
  const afterRun = await manifestCorpus(owner, season);
  check('post: the historical corpus is byte-identical to manifestBaseline (whole table, season, profile identities)',
    sameHistorical(afterRun, manifestBaseline), JSON.stringify(afterRun.historical));
  check('post: data/brownlow is unchanged (same files, same sha256; no temporary manifest or artefact)', readManifestContract().listing === contract.listing);

  ctx.afterTeardown(async () => {
    const afterTeardown = await manifestCorpus(owner, season);
    console.log(`  after teardown: ${JSON.stringify(afterTeardown)}`);
    check(`after teardown: the historical corpus is byte-identical to manifestBaseline; namespaced rows in season ${season}: 0; `
      + 'max(id) of the whole table back to the baseline (no residue)',
      sameHistorical(afterTeardown, manifestBaseline) && afterTeardown.fixtureInSeason === 0 && afterTeardown.allMaxId === manifestBaseline.allMaxId,
      JSON.stringify(afterTeardown));
    console.log(`  brownlow_season_votes id sequence: ${manifestBaseline.sequence} -> ${afterTeardown.sequence} `
      + `(${fixtureSeasonArtefact === null ? 'no fixture INSERT' : 'advanced by the fixture INSERT; never wound back, and no row holds the value'})`);
    const evidenceFile = join(tmpdir(), 'afldb-issue238-slice10-rehearsal', `case-${w.caseCode}.txt`);
    rmSync(evidenceFile, { force: true });
    check('after teardown: the case\'s operator evidence file is removed; data/brownlow unchanged',
      !existsSync(evidenceFile) && readManifestContract().listing === contract.listing);
  });
}

/* ==================================================================== *
 * Case 47 (§12.1): full derived-rebuild parity after a real correction
 * ==================================================================== */

/**
 * The columns a derive writer regenerates on every insert, proven from production behaviour and
 * never chosen to make a comparison pass:
 * - `club_seasons.id` is GENERATED ALWAYS; `rebuild_derived.py` (TRUNCATE + INSERT) and
 *   `recomputeClubSeasons` (DELETE + INSERT) both insert without it, so every rebuild renumbers the
 *   ladder. Case 47 re-proves that no foreign key references it.
 * - `player_career_stats.rebuilt_at` defaults to now(); both writers insert without it.
 * The business keys (`club_seasons (season, club_id)`, `player_career_stats (player_id)`) and every
 * other column are compared.
 */
const REBUILD_LOCAL: RebuildLocal = { club_seasons: ['id'], player_career_stats: ['rebuilt_at'] };

const semanticNote = (local: RebuildLocal) => (Object.keys(local).length === 0 ? ''
  : ` [semantic: rebuild-local ${Object.entries(local).map(([t, cs]) => cs.map((c) => `${t}.${c}`).join(', ')).join(', ')} excluded]`);

/** Every relation `rebuild_derived.py` writes (its ORDER), with its business key. */
const DERIVED_RELATIONS: readonly { table: string; key: readonly string[] }[] = [
  { table: 'seasons', key: ['year'] },
  { table: 'player_clubs', key: ['player_id', 'club_id'] },
  { table: 'player_club_season_stats', key: ['player_id', 'season', 'club_id'] },
  { table: 'player_season_stats', key: ['player_id', 'season'] },
  { table: 'player_career_stats', key: ['player_id'] },
  { table: 'club_seasons', key: ['season', 'club_id'] },
  { table: 'players', key: ['id'] },
];

const REBUILD_TARGETS = ['season_metadata', 'player_clubs', 'player_club_season_stats', 'player_season_stats',
  'player_career_stats', 'club_seasons', 'search_rank'] as const;

const fixturePredicate = (table: string) => {
  const t = FIXTURE_TABLES.find((x) => x.table === table);
  if (!t) throw new RehearsalRefused(`no fixture predicate for ${table}`);
  return isFixture(t);
};

const semanticJson = (table: string) => (REBUILD_LOCAL[table]
  ? `to_jsonb(x) - ARRAY[${REBUILD_LOCAL[table].map((c) => `'${c}'`).join(', ')}]::text[]`
  : 'to_jsonb(x)');

type KeyedRows = Map<string, Record<string, JsonValue>>;

/** The fixture's derived state, keyed `table|business key`: every derived row of P and P′, 2092's
 * `seasons` row and ladder, both `players` rows, and every `player_match_stats` row at M or of P/P′
 * (not rebuilt, but `career_game_no` is recompute-owned and must not move). */
async function fixtureDerived(owner: Sql, w: World, matchId: number): Promise<KeyedRows> {
  const ids = [w.p.id, w.pPrime.id];
  return owner.begin('isolation level repeatable read read only', async (tx) => {
    const out: KeyedRows = new Map();
    const scopes: { table: string; key: readonly string[]; where: string }[] = [
      ...DERIVED_RELATIONS.map((d) => ({
        ...d,
        where: d.table === 'seasons' ? `x.year = ${w.season}` : d.table === 'club_seasons' ? `x.season = ${w.season}`
          : d.table === 'players' ? 'x.id = ANY($1::int[])' : 'x.player_id = ANY($1::int[])',
      })),
      { table: 'player_match_stats', key: ['id'], where: `x.player_id = ANY($1::int[]) OR x.match_id = ${matchId}` },
    ];
    for (const s of scopes) {
      const rows = await tx.unsafe<{ k: string; row: Record<string, JsonValue> }[]>(
        `SELECT concat_ws(',', ${s.key.map((k) => `x.${k}`).join(', ')}) AS k, ${semanticJson(s.table)} AS row
           FROM ${s.table} x WHERE ${s.where}`, s.where.includes('$1') ? [ids] : []);
      for (const r of rows) out.set(`${s.table}|${r.k}`, r.row);
    }
    return out;
  });
}

type KeyedDiff = { key: string; kind: 'only-before' | 'only-after' | 'changed'; columns: { column: string; before: JsonValue; after: JsonValue }[] };

function diffKeyed(before: KeyedRows, after: KeyedRows): KeyedDiff[] {
  const out: KeyedDiff[] = [];
  for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const b = before.get(key);
    const a = after.get(key);
    if (b === undefined || a === undefined) {
      out.push({ key, kind: b === undefined ? 'only-after' : 'only-before', columns: [] });
      continue;
    }
    const columns = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort()
      .filter((c) => canonicalJson(b[c] ?? null) !== canonicalJson(a[c] ?? null))
      .map((c) => ({ column: c, before: b[c] ?? null, after: a[c] ?? null }));
    if (columns.length > 0) out.push({ key, kind: 'changed', columns });
  }
  return out;
}

const describeDiff = (d: KeyedDiff) => (d.kind === 'changed'
  ? `${d.key}: ${d.columns.map((c) => `${c.column} ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`).join(', ')}`
  : `${d.key}: ${d.kind === 'only-before' ? 'row REMOVED' : 'row ADDED'}`);

/** Per business key, the md5 of the semantic row text of every NON-fixture row of every relation the
 * full rebuild writes: the global drift instrument (a whole-table hash says THAT, this says WHERE). */
async function corpusDigest(owner: Sql): Promise<Map<string, Map<string, string>>> {
  return owner.begin('isolation level repeatable read read only', async (tx) => {
    const out = new Map<string, Map<string, string>>();
    for (const d of DERIVED_RELATIONS) {
      const rows = await tx.unsafe<{ k: string; h: string }[]>(
        `SELECT concat_ws(',', ${d.key.map((k) => `x.${k}`).join(', ')}) AS k, md5((${semanticJson(d.table)})::text) AS h
           FROM ${d.table} x WHERE NOT ${fixturePredicate(d.table)}`);
      out.set(d.table, new Map(rows.map((r) => [r.k, r.h])));
    }
    return out;
  });
}

function digestDrift(before: Map<string, Map<string, string>>, after: Map<string, Map<string, string>>) {
  return DERIVED_RELATIONS.map(({ table }) => {
    const b = before.get(table)!;
    const a = after.get(table)!;
    const keys = [...new Set([...b.keys(), ...a.keys()])].filter((k) => b.get(k) !== a.get(k)).sort();
    return { table, before: b.size, after: a.size, drifted: keys };
  });
}

/** Rows of `table` at the given business keys (non-fixture drift detail). */
async function rowsAtKeys(owner: Sql, table: string, key: readonly string[], keys: readonly string[]): Promise<JsonValue[]> {
  if (keys.length === 0) return [];
  return (await owner.unsafe<{ row: JsonValue }[]>(
    `SELECT to_jsonb(x) AS row FROM ${table} x WHERE concat_ws(',', ${key.map((k) => `x.${k}`).join(', ')}) = ANY($1::text[])`,
    [[...keys]])).map((r) => r.row);
}

type RebuildRun = { status: number | null; stdout: string; stderr: string; seconds: number };

const REBUILD_SCRIPT = join(PROJECT_ROOT, 'tools', 'migration', 'rebuild_derived.py');

/** The DSN `rebuild_derived.py` WILL use, resolved through its own helpers in its own order
 * (`load_env` never overwrites; `require_env('AFLDB_IMPORT_DATABASE_URL')`; `connect_pg`), with one
 * read-only SELECT that is rolled back. */
const PY_TARGET_PROBE = [
  'import json, sys',
  "sys.path.insert(0, 'tools/migration')",
  'from common import connect_pg, load_env, require_env, safe_dsn',
  'load_env()',
  "dsn = require_env('AFLDB_IMPORT_DATABASE_URL')",
  'pg = connect_pg(dsn)',
  'cur = pg.cursor()',
  "cur.execute('SELECT current_database(), current_user')",
  'db, user = cur.fetchone()',
  'pg.rollback()',
  'pg.close()',
  "print(json.dumps({'safeDsn': safe_dsn(dsn), 'database': db, 'user': user}))",
].join('\n');

/** The REAL full rebuild, committed, pinned to code_test_db and proven so before it starts. */
async function fullRebuild(ctx: CaseContext): Promise<RebuildRun> {
  const { check } = ctx;
  const u = new URL(ctx.importDsn);
  const expected = `${R.importRole}@127.0.0.1:55432/${R.database}`;
  if (`${decodeURIComponent(u.username)}@${u.hostname}:${u.port}/${decodeURIComponent(u.pathname.slice(1))}` !== expected) {
    throw new RehearsalRefused(`the import DSN is not ${expected}; the full rebuild is not run`);
  }
  const env = { ...process.env, AFLDB_IMPORT_DATABASE_URL: ctx.importDsn };
  const probe = spawnSync('python', ['-c', PY_TARGET_PROBE], { cwd: PROJECT_ROOT, env, encoding: 'utf8', timeout: 60_000 });
  const resolved = probe.status === 0 ? JSON.parse(probe.stdout.trim()) as { safeDsn: string; database: string; user: string } : null;
  console.log(`  rebuild target probe (the script's own load_env/require_env/connect_pg): exit ${String(probe.status)}, ${JSON.stringify(resolved)}`);
  const pinned = resolved?.safeDsn === expected && resolved.database === R.database && resolved.user === R.importRole;
  check(`rebuild target proven BEFORE it runs: ${expected}, current_database() ${R.database}, current_user ${R.importRole}`, pinned,
    probe.stderr.trim());
  if (!pinned) throw new RehearsalRefused('rebuild_derived.py does not resolve to code_test_db; it is not run');

  const command = `python tools/migration/rebuild_derived.py   (AFLDB_IMPORT_DATABASE_URL = ${expected}, cwd ${PROJECT_ROOT})`;
  console.log(`  full rebuild: ${command}`);
  const started = Date.now();
  const child = spawnSync('python', [REBUILD_SCRIPT], { cwd: PROJECT_ROOT, env, encoding: 'utf8', timeout: 1_200_000 });
  const seconds = (Date.now() - started) / 1000;
  if (child.error) throw new RehearsalRefused(`could not run rebuild_derived.py: ${child.error.message}`);
  for (const line of `${child.stdout}${child.stderr}`.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '')) {
    console.log(`    | ${line}`);
  }
  console.log(`  full rebuild: exit ${String(child.status)} after ${seconds.toFixed(1)} s`);
  return { status: child.status, stdout: child.stdout, stderr: child.stderr, seconds };
}

type RebuildLogRow = { id: number; target: string; scope: string; status: string; rowCount: number | null; error: string | null };

async function rebuildLogAfter(owner: Sql, afterId: number): Promise<RebuildLogRow[]> {
  return owner<RebuildLogRow[]>`
    SELECT id::int AS id, target, scope, status::text AS status, row_count::int AS "rowCount", error
      FROM derived_rebuilds WHERE id > ${afterId} ORDER BY id
  `;
}

async function sequenceState(owner: Sql) {
  const [s] = await owner<{ clubSeasonsSeq: string | null; clubSeasonsMaxId: number | null; rebuildsMaxId: number | null; referencingFks: number }[]>`
    SELECT (SELECT last_value::text FROM club_seasons_id_seq) AS "clubSeasonsSeq",
           (SELECT max(id)::int FROM club_seasons) AS "clubSeasonsMaxId",
           (SELECT max(id)::int FROM derived_rebuilds) AS "rebuildsMaxId",
           (SELECT count(*)::int FROM pg_constraint WHERE contype = 'f' AND confrelid = 'public.club_seasons'::regclass) AS "referencingFks"
  `;
  return s;
}

/**
 * Case 47 (§12.1 "`rebuild_derived.py` parity after a correction, where applicable -> the derived
 * tables equal a full re-derive", R). The correction's derived writes are its §8.2 step 8 targeted
 * recompute (`recomputePlayerDerivedStats` for P and P′ in M's season); the full re-derive is the
 * REAL `tools/migration/rebuild_derived.py`, run and COMMITTED on code_test_db (never a rolled-back
 * surrogate, never its SQL re-implemented here).
 *
 * Topology: case 1's (P, P′, CD_I at P, match M, one afl_api pms closure row at P), with the fixture
 * season's OWN derived state settled by the product before the correction: `recomputeSeasonMetadata`
 * and `recomputeClubSeasons` for 2092 (what a real match write leaves), then the targeted recompute.
 *
 * A = settled pre-correction state; B = after the real correction (validate-only -> apply
 * --expect-fingerprint, COMMITTED); C = after the real full rebuild. B must equal C for every fixture
 * derived row (business key + every column except the proven rebuild-local ones), the correction's
 * footprint (ledger, batch K, application, identity, projections) must be byte-identical, and no
 * non-fixture row of any relation the rebuild writes may change semantically.
 */
async function case47(ctx: CaseContext): Promise<void> {
  const { owner, check } = ctx;
  const { w, closure } = await owner.begin(async (tx) => {
    const built = await world(tx, 47);
    const row = await pmsClosureRow(tx, built, 1);
    await recomputeSeasonMetadata(tx, built.season);
    await settleDerived(tx, built);
    await recomputeClubSeasons(tx, built.season);
    return { w: built, closure: row };
  });
  console.log(`  fixture: P=${w.p.id} (${w.p.path}), P'=${w.pPrime.id} (${w.pPrime.path}), provider ${w.providerId}, `
    + `match M=${closure.matchId}, closure row player_match_stats#${closure.rowId}, settle batch ${w.settleBatchId}, actor ${w.actorId}`);

  // ---- A: pre-correction ----
  const stateA = await fixtureDerived(owner, w, closure.matchId);
  console.log(`  A (pre-correction) fixture derived rows: ${stateA.size}`);
  for (const [k, v] of stateA) console.log(`    A ${k} ${canonicalJson(v)}`);
  const [identityA] = await owner<{ id: number }[]>`
    SELECT id FROM external_identities WHERE source_id = ${w.sourceIds.aflApi} AND external_id = ${w.providerId}
  `;
  // The targeted recompute gives a match-less listed player a zero-games career row ("remains
  // discoverable"), so P′ holds one in A.
  check('A: closure row at (P, M); P′ plays nothing (its career row is the zero-games one); 2092 settled by the product '
    + '(seasons in_progress, one ladder row per club)',
    stateA.get(`player_match_stats|${closure.rowId}`)?.player_id === w.p.id
      && stateA.get(`player_career_stats|${w.pPrime.id}`)?.games === 0
      && ![...stateA].some(([k, r]) => k.startsWith('player_match_stats|') && r.player_id === w.pPrime.id)
      && stateA.get(`seasons|${w.season}`)?.status === 'in_progress'
      && [...stateA.keys()].filter((k) => k.startsWith('club_seasons|')).length === 2);

  // ---- the real correction ----
  const c = await correct(ctx, w, { rowsPlanned: 1, moved: 1, deleted: 0 });
  await checkLedgerAndIdentity(ctx, w, identityA.id, c);

  // ---- B: post-correction, pre-full-rebuild ----
  const stateB = await fixtureDerived(owner, w, closure.matchId);
  const footprintB = await correctionFootprint(owner, w, closure.externalRecordId);
  const corpusB = await corpusDigest(owner);
  const semanticB = await foreignFingerprint(owner, REBUILD_LOCAL);
  const exactB = await foreignFingerprint(owner);
  const seqB = await sequenceState(owner);
  console.log(`  B (post-correction) fixture derived rows: ${stateB.size}; A -> B (the correction's own derived writes):`);
  for (const d of diffKeyed(stateA, stateB)) console.log(`    A->B ${describeDiff(d)}`);
  check('B: the closure row is at (P′, M), same id, contract byte-identical; P holds no row',
    stateB.get(`player_match_stats|${closure.rowId}`)?.player_id === w.pPrime.id
      && rowContractHash(contractOf(stateB.get(`player_match_stats|${closure.rowId}`)!)) === closure.contractSha256
      && ![...stateB].some(([k, r]) => k.startsWith('player_match_stats|') && r.player_id === w.p.id));
  console.log(`  B sequences: ${JSON.stringify(seqB)}`);
  check('club_seasons.id is referenced by no foreign key (a rebuild-local surrogate)', seqB.referencingFks === 0);
  const corpusCounts = (d: Map<string, Map<string, string>>) => Object.fromEntries([...d].map(([t, m]) => [t, m.size]));
  console.log(`  B non-fixture corpus (rows per relation): ${JSON.stringify(corpusCounts(corpusB))}`);

  // ---- the REAL full rebuild, committed ----
  const rebuild = await fullRebuild(ctx);
  check('full rebuild: exit 0, printed target is code_test_db, completed', rebuild.status === 0
    && rebuild.stdout.replace(/\r/g, '').split('\n').includes(`  target: ${R.importRole}@127.0.0.1:55432/${R.database}`)
    && /Completed in [0-9.]+s/.test(rebuild.stdout), rebuild.stderr.slice(0, 400));
  const log = await rebuildLogAfter(owner, seqB.rebuildsMaxId ?? 0);
  console.log(`  derived_rebuilds written by this run: ${JSON.stringify(log)}`);
  check('full rebuild: derived_rebuilds holds exactly its 7 targets in ORDER, scope full, every one completed, no error',
    log.length === REBUILD_TARGETS.length && log.every((l, i) => l.target === REBUILD_TARGETS[i] && l.scope === 'full'
      && l.status === 'completed' && l.error === null), JSON.stringify(log));

  // ---- C: post-full-rebuild ----
  const stateC = await fixtureDerived(owner, w, closure.matchId);
  const footprintC = await correctionFootprint(owner, w, closure.externalRecordId);
  const corpusC = await corpusDigest(owner);
  const semanticC = await foreignFingerprint(owner, REBUILD_LOCAL);
  const exactC = await foreignFingerprint(owner);
  const seqC = await sequenceState(owner);
  for (const [k, v] of stateC) console.log(`    C ${k} ${canonicalJson(v)}`);

  const bc = diffKeyed(stateB, stateC);
  console.log(`  B -> C fixture differences: ${bc.length}`);
  for (const d of bc) console.log(`    B->C ${describeDiff(d)}`);
  for (const table of [...DERIVED_RELATIONS.map((d) => d.table), 'player_match_stats']) {
    const ofTable = bc.filter((d) => d.key.startsWith(`${table}|`));
    check(`parity B == C (fixture ${table}: business key + every semantic column)`, ofTable.length === 0, ofTable.map(describeDiff).join('; '));
  }
  const movedC = stateC.get(`player_match_stats|${closure.rowId}`);
  check('C: the canonical row is still at (P′, M), same id, contract byte-identical; nothing moved back to P; no duplicate at M',
    movedC?.player_id === w.pPrime.id && rowContractHash(contractOf(movedC)) === closure.contractSha256
      && [...stateC].filter(([k, r]) => k.startsWith('player_match_stats|') && r.match_id === closure.matchId
        && (r.player_id === w.p.id || r.player_id === w.pPrime.id)).length === 1);
  check('C: the correction footprint (ledger, batch K, applications, CD_I identity, projections) is byte-identical to B',
    footprintC === footprintB);

  // ---- non-fixture drift ----
  const drift = digestDrift(corpusB, corpusC);
  for (const d of drift) {
    console.log(`  non-fixture ${d.table}: rows ${d.before} -> ${d.after}, semantic drift ${d.drifted.length}`);
    if (d.drifted.length > 0) {
      const key = DERIVED_RELATIONS.find((r) => r.table === d.table)!.key;
      console.log(`    first drifted keys: ${d.drifted.slice(0, 10).join(' ; ')}`);
      console.log(`    C rows: ${JSON.stringify(await rowsAtKeys(owner, d.table, key, d.drifted.slice(0, 5)))}`);
    }
  }
  check('non-fixture: no semantic drift in any relation the rebuild writes (per business key)',
    drift.every((d) => d.before === d.after && d.drifted.length === 0), JSON.stringify(drift.map((d) => ({ t: d.table, n: d.drifted.length }))));
  const semanticDiff = fingerprintDiff(semanticB, semanticC);
  check('non-fixture: semantic foreign fingerprint B == C (every table the fixture or the correction writes)', semanticDiff.length === 0, semanticDiff.join('; '));
  const exactDiff = fingerprintDiff(exactB, exactC);
  console.log(`  whole-row fingerprint B -> C differs only in: ${exactDiff.map((l) => l.split(' ')[0]).join(', ') || '(none)'} `
    + '(expected: the rebuild-local columns of club_seasons and player_career_stats)');
  check('non-fixture: whole-row differences are confined to the tables holding rebuild-local columns',
    exactDiff.every((l) => Object.keys(REBUILD_LOCAL).includes(l.split(' ')[0])), exactDiff.join('; '));
  console.log(`  sequences B -> C: ${JSON.stringify(seqB)} -> ${JSON.stringify(seqC)}`);

  ctx.afterTeardown(async () => {
    const corpusT = await corpusDigest(owner);
    const after = digestDrift(corpusC, corpusT);
    check('after teardown: the non-fixture corpus is exactly the verified post-rebuild state (per business key)',
      after.every((d) => d.before === d.after && d.drifted.length === 0), JSON.stringify(after.map((d) => ({ t: d.table, n: d.drifted.length }))));
    rmSync(join(tmpdir(), 'afldb-issue238-slice10-rehearsal', `case-${w.caseCode}.txt`), { force: true });
  });
}

/** `rebuildLocal` (case 47 only): the columns run()'s foreign fingerprint leaves out because a derive
 * writer regenerates them on every insert (`REBUILD_LOCAL`); every other case compares whole rows. */
type CaseDefinition ={ title: string; run: (ctx: CaseContext) => Promise<void>; variants?: readonly string[]; rebuildLocal?: RebuildLocal };

/** §12.1 cases implemented so far. Every other case is refused, never approximated. */
const CASES: ReadonlyMap<number, CaseDefinition> = new Map([
  [1, { title: 'Basic P -> P′: player_match_stats row proven through CD_I (P1-P7), no P′ counterpart -> MOVE (C1)', run: case1 }],
  [29, { title: 'Brownlow correction, R half: settled coverage baseline, brownlow_round_votes MOVE (B1-B5, C1c, C1) -> COMMITTED, stat_availability byte-identical', run: case29 }],
  [87, { title: 'ORIGINAL lock timeout against an in-flight settle (settle resolver ACCESS SHARE on external_identities) -> STOP, nothing written', run: case87 }],
  [91, { title: 'R half: a real match-sheet writer on the closure row waits on the correction\'s row lock; its edit is post-correction state (L8-d or STOP, observed)', run: case91 }],
  [100, { title: 'Entry-state insertion race: a real match-sheet insert at (P, M) / a real Brownlow draft for M waits on the correction\'s matches FOR UPDATE',
    run: case100, variants: ['match-sheet', 'brownlow-draft'] }],
  // Family A
  [2, { title: 'As 1, but the closure row\'s brownlow_votes is 0 (and separately 3) -> STOP brownlow_state_present (P6/BG1), nothing written',
    run: case2, variants: ['votes-0', 'votes-3'] }],
  [16, { title: 'A real match-sheet edit changed a statistic on the AFL API-owned closure row before correction -> STOP out_of_ledger_edit naming the field', run: case16 }],
  [23, { title: 'Mixed-provider application history at the old key (inserted through CD_J, updated through CD_I) -> STOP P3', run: case23 }],
  [48, { title: 'D9 evidence file present but database evidence insufficient (no application history) -> still STOP', run: case48 }],
  [51, { title: 'Foreign-owned row at P (another match), no Brownlow event dependency -> NOOP foreign (C11); the closure row still MOVEs', run: case51 }],
  // Family B
  [9, { title: 'Safe identical collision against a foreign P′ row: player_match_stats C2 / Brownlow votes 0 C4 -> DELETE_AS_FOREIGN_COLLISION',
    run: case9, variants: ['pms-foreign-identical', 'brownlow-foreign-zero'] }],
  [10, { title: 'Collision where one substantive value differs (a value; NULL vs 0; jumper_number whitespace) -> STOP collision_values_disagree naming the field (C3)',
    run: case10, variants: ['kicks', 'null-vs-zero', 'jumper-whitespace'] }],
  [11, { title: 'Collision where the closure row\'s brownlow_votes is non-NULL -> STOP (P6/BG1), not C2', run: case11 }],
  [12, { title: 'DELETE re-plan from immutable history (after a real C2/C4 correction) -> NOOP already_corrected_deleted', run: case12, variants: ['pms', 'brownlow'] }],
  [52, { title: 'NULL-owned P′ counterpart: the policy of 9/10 (identical C2 delete; differing C3 STOP; Brownlow zero C4 delete)',
    run: case52, variants: ['pms-identical', 'pms-differing', 'brownlow-zero'] }],
  // Brownlow Family C
  [5, { title: 'Safe Brownlow closure move: B1-B5 proven, no P′ counterpart, P′ participation in M (C1c), guards pass -> MOVE (C1)', run: case5 }],
  [6, { title: 'I244-F002 demotion lineage (insert 3 through CD_I, demoted to 0 citing a payload without CD_I) -> B3-C case 2 accepted, vote 0, MOVE', run: case6 }],
  [7, { title: 'Brownlow insert-payload identity proof with NO projection -> B3-I via the insert\'s cited payload, MOVE', run: case7 }],
  [8, { title: 'No projection and the insert\'s cited payload unparseable -> STOP brownlow_insert_unproven (B3-I)',
    run: case8, variants: ['malformed-entry', 'other-record'] }],
  [53, { title: 'Brownlow collision with a positive vote on either side (foreign P′ counterpart) -> STOP C5',
    run: case53, variants: ['source-positive', 'counterpart-positive'] }],
  [54, { title: 'The admin resolve step set match_id on an AFL API-owned round row -> STOP out_of_ledger_edit (match_id) (B5)', run: case54 }],
  [76, { title: 'I244-F007 release -> claim (adjacent, one batch, one version naming CD_I once) -> B3-C case 3 accepted, vote = the claim, MOVE', run: case76 }],
  [78, { title: 'I244-F002 demotion with match_id ({votes: 0, match_id: m}, previous NULL, m = siblings\') -> accepted (case 2, FR), MOVE', run: case78 }],
  [79, { title: 'I244-F002 demotion with played ({votes: 0, played: true}) -> accepted (case 2, FR), MOVE', run: case79 }],
  [83, { title: 'Brownlow MOVE without P′ participation (match M; match_id NULL with zero / two candidates) -> STOP C1c; with a paired pms MOVE -> allowed',
    run: case83, variants: ['no-participation', 'null-match-zero', 'null-match-two', 'paired-pms-move'] }],
  // Brownlow / dependent guard Family D
  [3, { title: 'A manual-owned (admin demote / claim) round row for P at M beside a pms closure row -> STOP foreign_brownlow_dependency (BG2)',
    run: case3, variants: ['demote', 'claim'] }],
  [4, { title: 'brownlow_vote_entry_state for M names P (draft by the real writer; final) -> STOP brownlow_entry_names_player (BG3) at the pms row',
    run: case4, variants: ['draft', 'final'] }],
  [17, { title: 'A real admin Brownlow edit on a closure row (finalise writes brownlow_votes; void re-owns the round row) -> STOP (P6/BG1; BG2)',
    run: case17, variants: ['votes-written', 'round-reowned'] }],
  [18, { title: 'An after_siren_kicks row for (P, M) -> STOP dependent_record_would_be_stale (DP-1); an unresolved row at M -> reported (DP-3), COMMITTED',
    run: case18, variants: ['after-siren', 'unresolved'] }],
  [19, { title: 'A first_kick_goal row for (P, M) -> STOP (DP-2); a P′ debut-match change -> reported (DP-5), COMMITTED',
    run: case19, variants: ['achievement', 'debut-change'] }],
  [56, { title: 'Admin-published season (the real publish), a closure MOVE of a positive round vote / of P\'s games -> STOP season_total_depends_on_correction (SV-1)',
    run: case56, variants: ['round-vote', 'games'] }],
  [84, { title: 'Brownlow-only MOVE plus an entry state naming P (draft, final) -> STOP brownlow_entry_names_player (BG3) at the round row; entry state not rewritten',
    run: case84, variants: ['draft', 'final'] }],
  [85, { title: 'DP-4: a match-less after_siren_kicks row for P losing its last justifying participation -> STOP; with participation remaining -> reported, COMMITTED',
    run: case85, variants: ['loses-participation', 'keeps-participation'] }],
  // Family E (match-sheet subset)
  [70, { title: 'Post-correction real match-sheet edit of P′\'s corrected row -> Q2 PASS post_correction_edit match_sheet; never overwritten by a re-apply', run: case70 }],
  [88, { title: 'Post-correction real match-sheet removal of P′ (M still exists, only a match_sheet audit) -> STOP correction_target_absent_unexplained', run: case88 }],
  [101, { title: 'Post-correction reappearance: a real match-sheet line inserts a fresh NULL-owned row at (P, M) -> Q2 PASS post_correction_reappearance', run: case101 }],
  // Corrected-state / Q2 group
  [20, { title: 'L1-L8 corrected MOVE lineage re-run, no later activity -> NOOP already_corrected_moved; zero mutations', run: case20 }],
  [21, { title: 'L7: a later settle through CD_I at P′ (the production applyCanonicalUnit) -> NOOP; L7 passes', run: case21 }],
  [27, { title: 'ORIGINAL on an already-CORRECTED provider: same P′ -> ALREADY_SATISFIED; another player P″ -> STOP already_corrected_provider; never a second corrected row',
    run: case27, variants: ['same-target', 'other-target'] }],
  [69, { title: 'Post-correction real Brownlow finalise of M naming P′ -> Q2 PASS post_correction_edit brownlow_admin; re-run ALREADY_SATISFIED; §5 census PASS; D15 ALREADY_SATISFIED', run: case69 }],
  [72, { title: 'Post-correction real match deletion, Brownlow side: the corrected round row survives with match_id NULL -> Q2 PASS post_correction_edit match_deleted', run: case72 }],
  [73, { title: 'PARTIAL: post-correction legitimate foreign (afltables) round rows for P′ and P -> Q2 ALREADY_SATISFIED, no line about them (Q2 not widened, D-S9-1)', run: case73 }],
  [94, { title: 'Post-correction admin re-own of the corrected round row: real finalise + its audit -> Q2 PASS brownlow_admin_reowned; the same state with no audit -> STOP ownership_or_stamp_contradicts',
    run: case94, variants: ['audited', 'no-audit'] }],
  [98, { title: 'Real Brownlow draft audit after c + out-of-band votes change -> STOP post_correction_edit_unexplained (a draft explains nothing)', run: case98 }],
  [99, { title: 'Real finalise resolves the corrected afl_api round row match_id NULL -> M after c -> Q2 PASS post_correction_edit brownlow_admin (match_id only)', run: case99 }],
  // Target-absence / admin-revoke group
  [14, { title: 'Moved row later removed by the real match deletion, with its match_deletion audit after c -> NOOP correction_target_absent; ALREADY_SATISFIED; not recreated', run: case14 }],
  [15, { title: 'Moved row absent with no match-deletion audit (out of band; M still exists / M gone) -> STOP correction_target_absent_unexplained',
    run: case15, variants: ['match-exists', 'match-gone'] }],
  [32, { title: 'Real admin revoke of a CORRECTED provider (page-loader fingerprint) -> refused T21 before the non-use proof; no write; Q2 still ALREADY_SATISFIED', run: case32 }],
  // Family F: authority / CLI
  [24, { title: 'D8: P′ already holds another AFL API provider CD_K (importer bootstrap / the real admin link) -> STOP p_prime_holds_another_provider; nothing written',
    run: case24, variants: ['importer-unique', 'admin-linked'] }],
  [28, { title: '--apply with a wrong (well-formed) --expect-fingerprint -> REFUSED before batch K; nothing written or attempted; F unchanged; control apply with F commits', run: case28 }],
  [30, { title: 'Importer-origin ORIGINAL (unique, net NONE, candidate retained, surnames agree) -> one corrected row, supersedes_id NULL', run: case30 }],
  [31, { title: 'Human-origin ORIGINAL (the real admin link H, net LINKED(P); a newer decoy linked row) -> one corrected row, supersedes_id = H', run: case31 }],
  [58, { title: 'Surname disagreement: no flag -> STOP M1; flag -> COMMITTED, stored true; flag with an agreeing / no observation -> REFUSED',
    run: case58, variants: ['disagreement-no-ack', 'disagreement-ack', 'ack-no-disagreement', 'ack-no-observation'] }],
  // The schema-1 master manifest season, against the real corpus
  [82, { title: 'Real manifest season (SV-2a): the real corpus as loaded -> INDEPENDENT, COMMITTED; + one namespaced extra artefact row -> STOP season_artefact_unprovable; corpus byte-identical',
    run: case82, variants: ['independent', 'extra-row'] }],
  // The full derived rebuild (the real, committed tools/migration/rebuild_derived.py)
  [47, { title: 'rebuild_derived.py parity after a real correction: the derived tables after the correction\'s targeted recompute equal a full re-derive; footprint unchanged; no non-fixture drift',
    run: case47, rebuildLocal: REBUILD_LOCAL }],
]);

/* ==================================================================== *
 * Commands
 * ==================================================================== */

async function run(caseNumber: number, variant: string | null): Promise<number> {
  const definition = CASES.get(caseNumber);
  if (!definition) throw new RehearsalRefused(`case ${caseNumber} is not implemented by this harness (implemented: ${[...CASES.keys()].join(', ')})`);
  const variants = definition.variants ?? null;
  if (variants === null ? variant !== null : variant === null || !variants.includes(variant)) {
    throw new RehearsalRefused(`case ${caseNumber} takes ${variants === null ? 'no --variant' : `--variant ${variants.join(' | ')}`}`);
  }
  const { owner, importer, ownerDsn, importDsn, ownPids } = await connectTargets();
  const checks: Check[] = [];
  const check = (name: string, pass: boolean, detail = '') => {
    checks.push({ name, pass, detail });
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail.length > 400 ? `${detail.slice(0, 400)}...` : detail}` : ''}`);
  };
  let failure: unknown = null;
  let foreignBefore: Fingerprint | null = null;
  const afterTeardown: (() => Promise<void>)[] = [];
  try {
    // ---- preconditions: zero residue, invariant holds, season absent ----
    const residue0 = await readResidue(owner);
    if (residueTotal(residue0) !== 0) throw new RehearsalRefused(`ISSUE-238 fixture residue before the run: ${nonZero(residue0)}; run teardown first`);
    await owner.begin('read only', (tx) => assertAflApiIdentityInvariant(tx));
    const local = definition.rebuildLocal ?? {};
    foreignBefore = await foreignFingerprint(owner, local);
    console.log(`AFLDB-ISSUE-238 Slice 10 rehearsal, case ${caseNumber}${variant === null ? '' : `, variant ${variant}`}: ${definition.title}`);
    console.log(`  preconditions: fixture residue 0; identity invariant holds; foreign fingerprint taken${semanticNote(local)}`);

    await definition.run({ owner, importDsn, check, observer: importer, ownerDsn, variant, afterTeardown: (fn) => { afterTeardown.push(fn); } });

    const foreignAfter = await foreignFingerprint(owner, local);
    const diff = fingerprintDiff(foreignBefore, foreignAfter);
    check(`no non-fixture row changed across fixture setup and the correction (foreign fingerprint equal)${semanticNote(local)}`, diff.length === 0, diff.join('; '));
  } catch (error) {
    failure = error;
    console.log(`  ABORTED: ${redact((error as Error).message)}`);
  } finally {
    try {
      // No holder, gate, writer or correction backend may outlive the case (in any state, idle in
      // transaction included) when teardown starts.
      const lingering = await awaitNoLingeringBackends(owner, importer, ownPids);
      check('cleanup: no harness or correction backend remains (no open transaction, no lock holder)', lingering.length === 0,
        JSON.stringify(lingering.map((b) => ({ pid: b.pid, name: b.applicationName, role: b.role, state: b.state }))));
      if (lingering.length > 0) throw new RehearsalRefused('backends outlived the case; teardown is not attempted and no further case may run');
      if (foreignBefore !== null) {
        await teardownFixture(owner);
        const residue1 = await readResidue(owner);
        check('teardown: zero ISSUE-238 fixture residue', residueTotal(residue1) === 0, nonZero(residue1));
        const local = definition.rebuildLocal ?? {};
        const diff = fingerprintDiff(foreignBefore, await foreignFingerprint(owner, local));
        check(`teardown: no non-fixture row changed (foreign fingerprint equal to the pre-run one)${semanticNote(local)}`, diff.length === 0, diff.join('; '));
        for (const fn of afterTeardown) {
          try {
            await fn();
          } catch (error) {
            check('after teardown: the case\'s post-teardown proof completed', false, redact((error as Error).message));
          }
        }
      }
    } finally {
      await Promise.all([owner.end({ timeout: 5 }), importer.end({ timeout: 5 })]);
    }
  }
  const failed = checks.filter((c) => !c.pass);
  const ok = failure === null && failed.length === 0 && checks.length > 0;
  console.log(`\nAFLDB-ISSUE-238 Slice 10 case ${caseNumber}${variant === null ? '' : ` (${variant})`}: ${checks.length - failed.length}/${checks.length} checks PASS`
    + `${failure === null ? '' : ' (run ABORTED)'} -> ${ok ? 'PASS' : 'FAIL'}`);
  return ok ? 0 : 1;
}

async function residueOnly(): Promise<number> {
  const { owner, importer } = await connectTargets();
  try {
    const census = await readResidue(owner);
    console.log(`ISSUE-238 fixture residue: total ${residueTotal(census)} ${nonZero(census)}`);
    return residueTotal(census) === 0 ? 0 : 1;
  } finally {
    await Promise.all([owner.end({ timeout: 5 }), importer.end({ timeout: 5 })]);
  }
}

async function teardownOnly(): Promise<number> {
  const { owner, importer } = await connectTargets();
  try {
    const before = await readResidue(owner);
    await teardownFixture(owner);
    const after = await readResidue(owner);
    console.log(`teardown: removed ${residueTotal(before)} fixture row(s) ${nonZero(before)}; residue now ${residueTotal(after)} ${nonZero(after)}`);
    return residueTotal(after) === 0 ? 0 : 1;
  } finally {
    await Promise.all([owner.end({ timeout: 5 }), importer.end({ timeout: 5 })]);
  }
}

const USAGE = 'usage: run --case <n> [--variant <v>] --acknowledge code_test_db | residue | teardown --acknowledge code_test_db '
  + `(needs ${REHEARSAL_OWNER_ENV} and ${REHEARSAL_IMPORT_ENV}, both naming code_test_db; cases 4 (draft), 14, 16, 17, 24 (admin-linked), 31, 32, 56, 69, 70, 72, 88, 91, 100 and 101 `
  + 'load the real server-only writers, so run them as `npx tsx --conditions=react-server ...`)';

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  const flag = (name: string) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
  const known = new Set(['--case', '--variant', '--acknowledge']);
  for (let i = 0; i < rest.length; i += 2) if (!known.has(rest[i])) throw new RehearsalRefused(`unknown argument '${rest[i]}'. ${USAGE}`);
  if (command === 'residue') {
    if (rest.length > 0) throw new RehearsalRefused(`residue takes no arguments. ${USAGE}`);
    return residueOnly();
  }
  if (command !== 'run' && command !== 'teardown') throw new RehearsalRefused(USAGE);
  if (flag('--acknowledge') !== R.database) throw new RehearsalRefused(`${command} needs --acknowledge ${R.database}.`);
  if (command === 'teardown') {
    if (flag('--case') !== undefined || flag('--variant') !== undefined) throw new RehearsalRefused(`teardown takes no --case or --variant. ${USAGE}`);
    return teardownOnly();
  }
  const caseArg = flag('--case');
  if (caseArg === undefined || !/^[1-9][0-9]*$/.test(caseArg)) throw new RehearsalRefused(`run needs --case <n>. ${USAGE}`);
  return run(Number(caseArg), flag('--variant') ?? null);
}

if (process.argv[1] && /afl-api-identity-correction-rehearsal\.ts$/.test(process.argv[1])) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(`REFUSED: ${redact((error as Error).message)}`);
      process.exit(1);
    });
}
