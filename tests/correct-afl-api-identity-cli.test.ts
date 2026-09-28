/**
 * AFLDB-ISSUE-238 Slice 5: DB-free unit tests for the ORIGINAL correction CLI/adapter
 * (`tools/migration/correct_afl_api_identity.ts`). No database, network or real filesystem
 * access beyond a scratch temp file this suite creates and deletes itself.
 *
 * This is the CLI's own semantic home (mirroring `tests/afl-api-adjudication-recovery.test.ts`
 * for `recover_afl_api_adjudications.ts`): the pure planner's DB-free suite
 * (`tests/afl-api-identity-correction.test.ts`) covers the planner module itself, not this
 * adapter's argument parsing, DSN guard, evidence-file handling or report formatting.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TransactionSql } from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

import {
  AFL_API_ADMIN_MATCH_METHOD,
  CORRECTED_PROMOTION_REHEARSAL_REQUIRED,
  CORRECTED_PROMOTION_REQUIRES_FREEZE,
  aflApiIdentityStateSha256,
  aflApiImporterStateSha256,
  aflApiLedgerStateSha256,
  classifyAflApiForwardIdentityRows,
  type AflApiAdjudicationLedgerRow,
  type AflApiCensusRow,
  type AflApiCorrectedReplayEntry,
  type AflApiForwardIdentityResult,
  type AflApiSupersedeFile,
} from '../src/lib/acquisition/afl-api-adjudication';
import {
  BROWNLOW_ROUND_VOTES_CONTRACT_FIELDS,
  PLANNER_VERSION,
  PLAYER_MATCH_STATS_CONTRACT_FIELDS,
  classifyBrownlowChainApplication,
  evaluateBrownlowAttribution,
  evaluateBrownlowGuards,
  evaluateBrownlowMutationEligibility,
  evaluateBrownlowParticipation,
  evaluateDependents,
  evaluatePlayerMatchStatsAttribution,
  evaluatePlayerMatchStatsMutationEligibility,
  evaluateSeasonTotalIndependence,
  reconstructContract,
  rowContractHash,
  type AttributionResult,
  type BrownlowRowEvidence,
  type CanonicalTable,
  type CpcResult,
} from '../src/lib/acquisition/afl-api-identity-correction';
import { loadFitzroyProfileContinuityRules } from '../src/lib/acquisition/fitzroy-profile-continuity';
import { canonicalJson, type JsonValue } from '../src/lib/acquisition/observations';
import {
  CorrectionRefused,
  ORIGINAL_BATCH_CONTRACT,
  TOOL,
  assertReplayPromotionGuards,
  isPreRebuildDatabaseName,
  parseReplayPromotionArgs,
  proveSession,
  replayBatchContract,
  replayEntryMismatches,
  replayLedgerProblems,
  replayNoSecondCorrectedProblems,
  replayPostStateProblems,
  replayPromotionGuardProblems,
  resolveCandidateDsn,
  runReplayPromotion,
  brownlowAnotherProviderResolvedToPlayer,
  brownlowClosureOwnership,
  brownlowHistoryShowsAnotherVoter,
  brownlowInsertProvenByPayload,
  brownlowRowRefersToEvent,
  buildPlayerMatchStatsEvidence,
  checkCorrectionSatisfaction,
  citedPayloadVoterProof,
  classifySeasonTotals,
  decideAlreadyCorrectedRerun,
  evaluateMatchLessDependentParticipation,
  evaluateSv2aEvidence,
  expectedPlayerMatchStatsStamp,
  extractBrownlowVoterEntries,
  foreignBrownlowRowsAtEvent,
  formatOutcome,
  loadEvidenceFile,
  naturalKeyString,
  ownerKeyForPlanner,
  parseCorrectAflApiIdentityArgs,
  participationMatchIdsAfterPlan,
  playerMatchStatsClosureOwnership,
  playerMatchStatsHistoryThroughProvider,
  provenBrownlowClosureRowIdsOf,
  readEntryStateNamesPlayer,
  readStatAvailability,
  resolveAdjudicatedContradictions,
  resolveImportDsn,
  runAlreadyCorrectedRerun,
  sat1ExtendedBijectionProblems,
  sat5ProjectionContradictions,
  type BrownlowEvent,
  type BrownlowEventRow,
  type CanonicalApplicationRow,
  type ClosureOwnership,
  type CorrectionArgs,
  type CorrectionOutcome,
  type CorrectionSatisfactionReader,
  type ExistingIdentityRow,
  type LedgerRow,
  type MatchLessDependent,
  type ParticipationRow,
  type PlayerMatchStatsCandidate,
  type PostCorrectionAudit,
  type Q2Application,
  type Q2BatchRow,
  type Q2CurrentRow,
  type SeasonTotalLiveRow,
} from '../tools/migration/correct_afl_api_identity';

const scratchDir = mkdtempSync(join(tmpdir(), 'afldb-issue-238-s5-'));
afterAll(() => rmSync(scratchDir, { recursive: true, force: true }));

function writeScratchFile(name: string, contents: string): string {
  const path = join(scratchDir, name);
  writeFileSync(path, contents, 'utf8');
  return path;
}

const VALID_NOTE = 'This is a valid 20+ character admin note for the correction.';

function baseArgv(mode: '--validate-only' | '--dry-run' | '--apply', extra: string[] = []): string[] {
  return [
    mode,
    '--provider-id', 'CD_I1',
    '--to-player-id', '42',
    '--admin-user-id', '7',
    '--note', VALID_NOTE,
    '--evidence-file', writeScratchFile(`evidence-${Math.random()}.txt`, 'supporting evidence only'),
    '--expect-database', 'afldb_dev',
    ...extra,
  ];
}

describe('parseCorrectAflApiIdentityArgs (D9)', () => {
  it('parses a valid --validate-only invocation', () => {
    const args = parseCorrectAflApiIdentityArgs(baseArgv('--validate-only'));
    expect(args.mode).toBe('validate-only');
    expect(args.providerId).toBe('CD_I1');
    expect(args.toPlayerId).toBe(42);
    expect(args.adminUserId).toBe(7);
    expect(args.expectFingerprint).toBeNull();
    expect(args.acknowledgeSurnameDisagreement).toBe(false);
  });

  it('requires exactly one of --validate-only/--dry-run/--apply', () => {
    expect(() => parseCorrectAflApiIdentityArgs([
      '--provider-id', 'CD_I1', '--to-player-id', '1', '--admin-user-id', '1',
      '--note', VALID_NOTE, '--evidence-file', writeScratchFile('e1.txt', 'x'), '--expect-database', 'afldb_dev',
    ])).toThrow(CorrectionRefused);
    expect(() => parseCorrectAflApiIdentityArgs([
      '--validate-only', '--dry-run',
      '--provider-id', 'CD_I1', '--to-player-id', '1', '--admin-user-id', '1',
      '--note', VALID_NOTE, '--evidence-file', writeScratchFile('e2.txt', 'x'), '--expect-database', 'afldb_dev',
    ])).toThrow(CorrectionRefused);
  });

  it('requires --expect-fingerprint with --apply, and refuses it otherwise', () => {
    expect(() => parseCorrectAflApiIdentityArgs(baseArgv('--apply'))).toThrow(/--expect-fingerprint is mandatory/);
    expect(() => parseCorrectAflApiIdentityArgs(baseArgv('--validate-only', ['--expect-fingerprint', 'a'.repeat(64)])))
      .toThrow(/only accepted with --apply/);
  });

  it('accepts --apply with a fingerprint', () => {
    const fingerprint = 'a'.repeat(64);
    const args = parseCorrectAflApiIdentityArgs(baseArgv('--apply', ['--expect-fingerprint', fingerprint]));
    expect(args.mode).toBe('apply');
    expect(args.expectFingerprint).toBe(fingerprint);
  });

  it('rejects a note shorter than 20 or longer than 2000 characters (the ledger CHECK, mirrored client-side)', () => {
    const argvShort = baseArgv('--validate-only').map((v) => (v === VALID_NOTE ? 'too short' : v));
    expect(() => parseCorrectAflApiIdentityArgs(argvShort)).toThrow(/--note is mandatory/);
  });

  it('rejects a non-positive --to-player-id or --admin-user-id', () => {
    expect(() => parseCorrectAflApiIdentityArgs(baseArgv('--validate-only').map((v) => (v === '42' ? '0' : v))))
      .toThrow(/--to-player-id must be a positive integer/);
  });

  it('requires --evidence-file (O-6: supporting evidence only, never a substitute for missing DB evidence)', () => {
    const argv = baseArgv('--validate-only').filter((v, i, all) => !(all[i - 1] === '--evidence-file' || v === '--evidence-file'));
    expect(() => parseCorrectAflApiIdentityArgs(argv)).toThrow(/--evidence-file is mandatory/);
  });

  it('rejects an unknown flag', () => {
    expect(() => parseCorrectAflApiIdentityArgs([...baseArgv('--validate-only'), '--bogus'])).toThrow(/Unknown argument/);
  });

  it('rejects a flag missing its value', () => {
    expect(() => parseCorrectAflApiIdentityArgs(['--validate-only', '--provider-id'])).toThrow(/needs a value/);
  });
});

describe('resolveImportDsn (§8.8 role model)', () => {
  it('accepts a postgresql:// DSN naming the expected database', () => {
    const dsn = resolveImportDsn({ AFLDB_IMPORT_DATABASE_URL: 'postgresql://user:pass@host:5432/afldb_dev' }, 'afldb_dev');
    expect(dsn).toContain('afldb_dev');
  });

  it('refuses when the env var is unset', () => {
    expect(() => resolveImportDsn({}, 'afldb_dev')).toThrow(/is not set/);
  });

  it('refuses a non-postgresql DSN', () => {
    expect(() => resolveImportDsn({ AFLDB_IMPORT_DATABASE_URL: 'mysql://host/afldb_dev' }, 'afldb_dev')).toThrow(/not a postgresql/);
  });

  it('refuses a DSN naming a different database than --expect-database', () => {
    expect(() => resolveImportDsn({ AFLDB_IMPORT_DATABASE_URL: 'postgresql://user@host/afldb_prod' }, 'afldb_dev'))
      .toThrow(/does not target \/afldb_dev/);
  });
});

describe('loadEvidenceFile (D9, O-6: hash and summary only, never parsed as DB evidence)', () => {
  it('hashes the file and returns a bounded summary', () => {
    const path = writeScratchFile('evidence.txt', 'short evidence text');
    const loaded = loadEvidenceFile(path);
    expect(loaded.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(loaded.summary).toBe('short evidence text');
  });

  it('truncates a long evidence file summary to 500 characters plus a length note', () => {
    const path = writeScratchFile('evidence-long.txt', 'x'.repeat(1000));
    const loaded = loadEvidenceFile(path);
    expect(loaded.summary.startsWith('x'.repeat(500))).toBe(true);
    expect(loaded.summary).toContain('1000 bytes total');
  });

  it('refuses a missing file', () => {
    expect(() => loadEvidenceFile(join(scratchDir, 'does-not-exist.txt'))).toThrow(CorrectionRefused);
  });
});

/** The exact stored shape of one `brownlow_match_votes` source version (`AflApiBrownlowMatchVoteRecord`,
 * persisted by `afl-api-brownlow.ts:1466-1473`). */
function storedVoteRecord(providerMatchId: string, votes: { id: string; votes: number }[]): JsonValue {
  return {
    providerMatchId,
    apiRoundNumber: 5,
    votes: votes.map((v) => ({ providerPlayerId: v.id, providerTeamId: 'T1', votes: v.votes, eligible: true })),
  };
}

describe('B3-I/B3-C cited-payload parser (§5.3), over the stored AflApiBrownlowMatchVoteRecord shape', () => {
  const valid = storedVoteRecord('CD_M1', [{ id: 'CD_I', votes: 3 }, { id: 'CD_X', votes: 2 }, { id: 'CD_Y', votes: 1 }]);

  it('parses the expected valid stored payload and proves CD_I once, with its vote', () => {
    expect(extractBrownlowVoterEntries(valid, 'CD_M1')).toEqual([
      { playerId: 'CD_I', votes: 3 }, { playerId: 'CD_X', votes: 2 }, { playerId: 'CD_Y', votes: 1 },
    ]);
    const proof = citedPayloadVoterProof(valid, 'CD_M1', 'CD_I');
    expect(proof).toEqual({ count: 1, vote: 3 });
    expect(brownlowInsertProvenByPayload(proof, { played: true, votes: 3, match_id: null })).toBe(true);
  });

  it('absent provider/player: a valid payload without CD_I is count 0 (a real absence), which never proves B3-I', () => {
    const proof = citedPayloadVoterProof(valid, 'CD_M1', 'CD_ABSENT');
    expect(proof).toEqual({ count: 0, vote: null });
    expect(brownlowInsertProvenByPayload(proof, { votes: 3 })).toBe(false);
  });

  it('a missing payload (no cited source version) is UNPROVEN (-1), never "CD_I absent"', () => {
    expect(citedPayloadVoterProof(null, 'CD_M1', 'CD_I')).toEqual({ count: -1, vote: null });
  });

  it.each([
    ['votes is not an array', { providerMatchId: 'CD_M1', votes: 'three' }],
    ['providerPlayerId wrongly typed', { providerMatchId: 'CD_M1', votes: [{ providerPlayerId: 1234, votes: 3 }] }],
    ['providerPlayerId empty', { providerMatchId: 'CD_M1', votes: [{ providerPlayerId: '', votes: 3 }] }],
    ['votes wrongly typed', { providerMatchId: 'CD_M1', votes: [{ providerPlayerId: 'CD_I', votes: '3' }] }],
    ['votes not an integer', { providerMatchId: 'CD_M1', votes: [{ providerPlayerId: 'CD_I', votes: 2.5 }] }],
    ['a null entry', { providerMatchId: 'CD_M1', votes: [null] }],
    ['one malformed entry beside a valid CD_I entry', { providerMatchId: 'CD_M1', votes: [{ providerPlayerId: 'CD_I', votes: 3 }, { providerPlayerId: 'CD_X' }] }],
    ['providerMatchId missing', { votes: [{ providerPlayerId: 'CD_I', votes: 3 }] }],
  ])('malformed or wrongly typed relevant fields (%s) -> unparseable (null, count -1)', (_label, payload) => {
    expect(extractBrownlowVoterEntries(payload, 'CD_M1')).toBeNull();
    expect(citedPayloadVoterProof(payload, 'CD_M1', 'CD_I').count).toBe(-1);
  });

  it('a contradictory payload never proves CD_I: another provider match, CD_I twice, or a different vote', () => {
    expect(extractBrownlowVoterEntries(valid, 'CD_M2')).toBeNull(); // cites CD_M2, payload is CD_M1's
    const twice = storedVoteRecord('CD_M1', [{ id: 'CD_I', votes: 3 }, { id: 'CD_I', votes: 2 }, { id: 'CD_Y', votes: 1 }]);
    expect(citedPayloadVoterProof(twice, 'CD_M1', 'CD_I')).toEqual({ count: 2, vote: null });
    expect(brownlowInsertProvenByPayload(citedPayloadVoterProof(twice, 'CD_M1', 'CD_I'), { votes: 3 })).toBe(false);
    expect(brownlowInsertProvenByPayload(citedPayloadVoterProof(valid, 'CD_M1', 'CD_I'), { votes: 1 })).toBe(false);
  });

  it.each([
    ['the raw brownlowSeason API envelope', { brownlowSeason: { matchVotes: [{ matchId: 'CD_M1', votes: [{ player: { playerId: 'CD_I' }, team: { teamId: 'T1' }, votes: 3, eligible: true }] }] } }],
    ['a player-stats payload naming CD_I', { playerStats: { player: { playerId: 'CD_I', playerName: { surname: 'X' } } } }],
    ['an array', [{ providerPlayerId: 'CD_I', votes: 3 }]],
    ['a string', 'CD_I'],
  ])('an unrelated payload (%s) cannot accidentally prove attribution', (_label, payload) => {
    expect(extractBrownlowVoterEntries(payload, 'CD_M1')).toBeNull();
    const proof = citedPayloadVoterProof(payload, 'CD_M1', 'CD_I');
    expect(proof.count).toBe(-1);
    expect(brownlowInsertProvenByPayload(proof, { votes: 3 })).toBe(false);
  });

  it('why unparseable must not read as absent: count 0 admits a B3-C demotion (case 2), -1 fits no case', () => {
    const demotion = {
      id: 5, verb: 'update' as const, previousValues: { votes: 3 }, newValues: { votes: 0 },
      sourceId: 'afl_api', externalRecordId: 'CD_M1', sourceVersionSeq: 2, importBatchId: 9,
    };
    expect(classifyBrownlowChainApplication({ ...demotion, citedPayloadVoterCountForCdI: 0, citedPayloadVoteForCdI: null }, 3).ok).toBe(true);
    const unproven = classifyBrownlowChainApplication({ ...demotion, citedPayloadVoterCountForCdI: -1, citedPayloadVoteForCdI: null }, 3);
    expect(unproven.ok).toBe(false);
    if (!unproven.ok) expect(unproven.stop.code).toBe('brownlow_chain_inconsistent');
  });
});

describe('P1/P2/P3 binding to CD_I (§5.2)', () => {
  it('maps the numeric to_jsonb source_id to afl_api only when it IS the afl_api source id', () => {
    expect(ownerKeyForPlanner(7, 7)).toBe('afl_api');
    expect(ownerKeyForPlanner(8, 7)).not.toBe('afl_api');
    expect(ownerKeyForPlanner('afl_api', 7)).not.toBe('afl_api');
    expect(ownerKeyForPlanner(null, 7)).not.toBe('afl_api');
  });

  it('builds the expected P2 stamp for CD_I, so a …|CD_J row fails P2 instead of matching itself', () => {
    expect(expectedPlayerMatchStatsStamp('M1|T1|CD_J', 'CD_I')).toBe('M1|T1|CD_I');
    const history = [{
      id: 1, verb: 'insert' as const, previousValues: null, newValues: {},
      sourceId: 'afl_api', externalRecordId: 'M1|T1|CD_J', sourceVersionSeq: 1, importBatchId: 4,
    }];
    const attribution = evaluatePlayerMatchStatsAttribution({
      sourceId: 'afl_api', sourceRecordId: 'M1|T1|CD_J', importBatchId: 4, applications: history,
      projectionPlayerId: null, currentPlayerId: 10, current: {},
      expectedSourceRecordId: expectedPlayerMatchStatsStamp('M1|T1|CD_J', 'CD_I'), expectedImportBatchId: 4,
    });
    expect(attribution.ok).toBe(false);
    if (!attribution.ok) expect(attribution.stop.step).toBe('P2');
  });

  it('P3 requires EVERY application at the key to end |CD_I', () => {
    expect(playerMatchStatsHistoryThroughProvider([{ externalRecordId: 'M|T|CD_I' }, { externalRecordId: 'M|T|CD_I' }], 'CD_I')).toBe(true);
    expect(playerMatchStatsHistoryThroughProvider([{ externalRecordId: 'M|T|CD_J' }, { externalRecordId: 'M|T|CD_I' }], 'CD_I')).toBe(false);
  });
});

/* ==================================================================== *
 * §8.4 / §8.5 / §5.12 Q2: CORRECTION SATISFACTION over an in-memory reader
 * ==================================================================== */

const CD_I = 'CD_I';
const P = 10;
const P2 = 20;
const M = 500;
const AFL_API_SOURCE_ID = 7;
const K = 60; // the correction batch
const SETTLE_BATCH = 50;
const EVIDENCE_SHA = 'e'.repeat(64);
const STAMP = `CD_M1|T1|${CD_I}`;
const PMS_OLD_KEY = { player_id: P, match_id: M };
const PMS_NEW_KEY = { player_id: P2, match_id: M };
const BRW_OLD_KEY = { season: 2025, player_id: P, round_number: 5 };
const BRW_NEW_KEY = { season: 2025, player_id: P2, round_number: 5 };

const PMS_INSERT_VALUES: Record<string, JsonValue> = Object.fromEntries(
  PLAYER_MATCH_STATS_CONTRACT_FIELDS.filter((f) => f !== 'brownlow_votes').map((f, i) => [f, i + 1]),
);

function app(fields: Partial<Q2Application> & Pick<Q2Application, 'id' | 'verb' | 'targetTable' | 'targetKey' | 'importBatchId'>): Q2Application {
  return {
    previousValues: null, newValues: {}, sourceId: 'afl_api', family: 'afl_api_player_stats',
    externalRecordId: STAMP, sourceVersionSeq: 1, voterProof: null, ...fields,
  };
}

type World = {
  identityRow: ExistingIdentityRow | null;
  ledger: LedgerRow[];
  identities: Record<string, number | null>;
  batches: Q2BatchRow[];
  applications: Q2Application[];
  rows: { table: CanonicalTable; key: Record<string, JsonValue>; current: Q2CurrentRow }[];
  /** Every typed projection row of CD_I (SAT-5); `projectionPlayer` (P5/L8-c) reads the same set. */
  projections: { table: CanonicalTable; providerMatchId: string; playerId: number | null }[];
  matches: number[];
  audits: PostCorrectionAudit[];
  attributedKeysAtP: string[];
  /** SAT-1's extended-bijection facts: the whole `afl_api` identity census, other providers' ledger rows, D7 identities. */
  census: AflApiCensusRow[];
  otherLedger: AflApiAdjudicationLedgerRow[];
  forwardIdentities: Map<number, AflApiForwardIdentityResult>;
};

/** An in-memory `CorrectionSatisfactionReader`. It has no write method, like the real one. */
function fakeReader(world: World): CorrectionSatisfactionReader {
  const byId = (a: Q2Application, b: Q2Application) => a.id - b.id;
  const same = (a: JsonValue, b: JsonValue) => canonicalJson(a) === canonicalJson(b);
  return {
    aflApiSourceId: async () => AFL_API_SOURCE_ID,
    identityRow: async () => world.identityRow,
    ledgerRows: async () => world.ledger,
    resolvePlayerIdentity: async (identity) => world.identities[identity] ?? null,
    batchesClaimingAdjudication: async (adjudicationId) => world.batches.filter((b) => (
      (b.validationResult as { adjudicationId?: unknown } | null)?.adjudicationId === adjudicationId)),
    batchApplications: async (batchId) => world.applications.filter((a) => a.importBatchId === batchId).sort(byId),
    applicationsAt: async (table, key) => world.applications.filter((a) => a.targetTable === table && same(a.targetKey, key)).sort(byId),
    currentRowAt: async (table, key) => world.rows.find((r) => r.table === table && same(r.key, key))?.current ?? null,
    projectionPlayer: async (table, providerMatchId) => {
      const ps = world.projections.filter((p) => p.table === table && p.providerMatchId === providerMatchId);
      return ps.length === 0 ? null : ps.length === 1 ? ps[0].playerId : -1;
    },
    matchExists: async (matchId) => world.matches.includes(matchId),
    auditsFor: async (matchIds) => world.audits.filter((a) => matchIds.includes(a.rowId)),
    attributedKeysAtPlayer: async () => world.attributedKeysAtP,
    identityInvariantFacts: async () => ({
      censusRows: world.census,
      ledgerRows: [
        ...world.ledger.map((r): AflApiAdjudicationLedgerRow => ({
          id: r.id, externalId: CD_I, action: r.action, playerId: r.playerId, playerIdentity: r.playerIdentity,
          supersedesId: r.supersedesId, previousPlayerIdentity: r.previousPlayerIdentity, evidenceSha256: r.evidenceSha256 ?? undefined,
        })),
        ...world.otherLedger,
      ],
      identityByPlayerId: world.forwardIdentities,
    }),
    providerProjections: async () => world.projections.map((p) => ({ table: p.table, providerMatchId: p.providerMatchId, playerId: p.playerId })),
  };
}

/** CD_I's own live row after the correction: `resolved`/`afl_api_admin_adjudication` at P′. */
function correctedCensusRow(): AflApiCensusRow {
  return { externalId: CD_I, status: 'resolved', matchMethod: AFL_API_ADMIN_MATCH_METHOD, playerId: P2, candidateCount: 0, externalUrl: null };
}

function correctionBatch(rowProofs: JsonValue[], status = 'completed'): Q2BatchRow {
  return {
    id: K, sourceKey: 'afl_api', tool: TOOL, targetTable: 'canonical_applications', status,
    validationResult: {
      kind: 'afl_api_identity_correction', mode: 'original', context: 'live_target', plannerVersion: 2,
      adjudicationId: 2, externalId: CD_I, adjudicationEvidenceSha256: EVIDENCE_SHA,
      closureFingerprint: 'f'.repeat(64), mutationEligibility: 'PASS', rowProofs,
    },
  };
}

function baseWorld(): Omit<World, 'batches' | 'applications' | 'rows' | 'projections'> {
  return {
    identityRow: { id: 99, status: 'resolved', playerId: P2, candidateCount: 0, matchMethod: AFL_API_ADMIN_MATCH_METHOD },
    ledger: [
      { id: 1, action: 'linked', playerId: P, playerIdentity: 'id:P', supersedesId: null, previousPlayerIdentity: null, evidenceSha256: null },
      { id: 2, action: 'corrected', playerId: P2, playerIdentity: 'id:P2', supersedesId: 1, previousPlayerIdentity: 'id:P', evidenceSha256: EVIDENCE_SHA },
    ],
    identities: { 'id:P': P, 'id:P2': P2 },
    matches: [M, 600],
    audits: [],
    attributedKeysAtP: [],
    census: [correctedCensusRow()],
    otherLedger: [],
    forwardIdentities: new Map(),
  };
}

const pmsInsert = app({ id: 100, verb: 'insert', targetTable: 'player_match_stats', targetKey: PMS_OLD_KEY, importBatchId: SETTLE_BATCH, newValues: PMS_INSERT_VALUES });
const pmsCorrection = app({
  id: 200, verb: 'update', targetTable: 'player_match_stats', targetKey: PMS_NEW_KEY, importBatchId: K,
  previousValues: { player_id: P }, newValues: { player_id: P2 },
});
const PMS_PRE_HASH = rowContractHash(reconstructContract(PLAYER_MATCH_STATS_CONTRACT_FIELDS, [pmsInsert]).fields);

/** A validly corrected `player_match_stats` MOVE (P, M) -> (P′, M), as ORIGINAL left it. */
function pmsWorld(): World {
  return {
    ...baseWorld(),
    batches: [correctionBatch([{ table: 'player_match_stats', verb: 'update', oldKey: PMS_OLD_KEY, newKey: PMS_NEW_KEY, preCorrectionContractSha256: PMS_PRE_HASH }])],
    applications: [pmsInsert, pmsCorrection],
    rows: [{
      table: 'player_match_stats', key: PMS_NEW_KEY,
      current: {
        ownerKey: 'afl_api',
        row: {
          id: 900, player_id: P2, match_id: M, source_id: AFL_API_SOURCE_ID, source_record_id: STAMP,
          import_batch_id: SETTLE_BATCH, ...PMS_INSERT_VALUES, brownlow_votes: null,
        },
      },
    }],
    projections: [{ table: 'player_match_stats', providerMatchId: 'CD_M1', playerId: P2 }],
  };
}

function setPmsRow(world: World, patch: Record<string, JsonValue>, ownerKey?: string | null): void {
  const target = world.rows.find((r) => r.table === 'player_match_stats' && canonicalJson(r.key) === canonicalJson(PMS_NEW_KEY))!;
  target.current = { ownerKey: ownerKey === undefined ? target.current.ownerKey : ownerKey, row: { ...target.current.row, ...patch } };
}

function audit(tableName: string, rowId: number, fieldGroup: string, afterCorrection = true, revision: number | null = null): PostCorrectionAudit {
  return { id: `de-${tableName}-${rowId}-${fieldGroup}-${String(afterCorrection)}`, tableName, rowId, fieldGroup, revision, afterCorrection };
}

const brwInsert = app({
  id: 110, verb: 'insert', targetTable: 'brownlow_round_votes', targetKey: BRW_OLD_KEY, importBatchId: 51,
  family: 'brownlow_match_votes', externalRecordId: 'CD_M1', newValues: { played: true, votes: 3, match_id: null },
  voterProof: { count: 1, vote: 3 },
});
const brwCorrection = app({
  id: 210, verb: 'update', targetTable: 'brownlow_round_votes', targetKey: BRW_NEW_KEY, importBatchId: K,
  family: 'brownlow_match_votes', externalRecordId: 'CD_M1', previousValues: { player_id: P }, newValues: { player_id: P2 },
  voterProof: { count: 1, vote: 3 },
});

/** A validly corrected Brownlow round-row MOVE, still afl_api-owned. */
function brownlowWorld(insertValues: Record<string, JsonValue> = { played: true, votes: 3, match_id: null }): World {
  const insert = { ...brwInsert, newValues: insertValues };
  return {
    ...baseWorld(),
    batches: [correctionBatch([{
      table: 'brownlow_round_votes', verb: 'update', oldKey: BRW_OLD_KEY, newKey: BRW_NEW_KEY,
      preCorrectionContractSha256: rowContractHash(reconstructContract(BROWNLOW_ROUND_VOTES_CONTRACT_FIELDS, [insert]).fields),
    }])],
    applications: [insert, brwCorrection],
    rows: [{
      table: 'brownlow_round_votes', key: BRW_NEW_KEY,
      current: {
        ownerKey: 'afl_api',
        row: {
          id: 901, season: 2025, player_id: P2, round_number: 5, ...insertValues,
          source_id: AFL_API_SOURCE_ID, source_record_id: 'CD_M1', import_batch_id: 51,
        },
      },
    }],
    projections: [],
  };
}

function setBrownlowRow(world: World, patch: Record<string, JsonValue>, ownerKey?: string | null): void {
  const target = world.rows.find((r) => r.table === 'brownlow_round_votes')!;
  target.current = { ownerKey: ownerKey === undefined ? target.current.ownerKey : ownerKey, row: { ...target.current.row, ...patch } };
}

const RERUN_ARGS: CorrectionArgs = {
  mode: 'apply', providerId: CD_I, toPlayerId: P2, adminUserId: 7, note: VALID_NOTE,
  evidenceFile: 'evidence.txt', expectDatabase: 'afldb_dev', expectFingerprint: 'a'.repeat(64),
  acknowledgeSurnameDisagreement: false,
};

async function rerun(world: World, args: CorrectionArgs = RERUN_ARGS): Promise<CorrectionOutcome> {
  return runAlreadyCorrectedRerun(fakeReader(world), args, 2);
}

function expectStop(outcome: CorrectionOutcome, step: string, code: string): void {
  expect(outcome.kind).toBe('STOP');
  if (outcome.kind !== 'STOP') return;
  expect(outcome.stops.map((s) => `${s.step}:${s.code}`)).toContain(`${step}:${code}`);
}

function expectSatisfied(outcome: CorrectionOutcome): readonly string[] {
  expect(outcome.kind).toBe('ALREADY_SATISFIED');
  return outcome.kind === 'ALREADY_SATISFIED' ? outcome.reports : [];
}

describe('§8.5 re-run on an already-CORRECTED provider is Q2, never "CORRECTED means satisfied"', () => {
  it('a valid correction re-run is ALREADY_SATISFIED through SAT-1..SAT-5 and L1-L8', async () => {
    const reports = expectSatisfied(await rerun(pmsWorld()));
    expect(reports).toContain('CORRECTION SATISFACTION: SAT-1..SAT-5 PASS');
    expect(reports.some((r) => r.startsWith('NOOP already_corrected_moved: player_match_stats'))).toBe(true);
  });

  it('opens no batch, appends no ledger row and mutates nothing: the outcome carries no batch/adjudication and the state is byte-identical', async () => {
    const world = pmsWorld();
    const before = structuredClone(world);
    const outcome = await rerun(world);
    expect(outcome.kind).toBe('ALREADY_SATISFIED');
    expect(outcome).not.toHaveProperty('batchId');
    expect(outcome).not.toHaveProperty('adjudicationId');
    expect(world).toEqual(before);
    expect(world.batches).toHaveLength(1);
    expect(world.ledger.filter((r) => r.action === 'corrected')).toHaveLength(1);
  });

  it('the re-run branch precedes every write in runCorrection, and the Q2 section issues no write SQL', () => {
    const source = readFileSync(join(process.cwd(), 'tools', 'migration', 'correct_afl_api_identity.ts'), 'utf8');
    const run = source.slice(source.indexOf('async function runCorrection('));
    const branch = run.indexOf('return runAlreadyCorrectedRerun(dbCorrectionSatisfactionReader(tx), args, net.id);');
    expect(branch).toBeGreaterThan(0);
    expect(branch).toBeLessThan(run.indexOf('INSERT INTO import_batches'));
    expect(branch).toBeLessThan(run.indexOf('assertManifestValidatesAgainstCatalogue(tx)')); // §5.12: Q2 never evaluates D10
    const q2 = source.slice(source.indexOf('§8.4 / §8.5 / §5.12 Q2: CORRECTION SATISFACTION'), source.indexOf(' * Reporting'));
    expect(q2.length).toBeGreaterThan(1000);
    expect(q2).not.toMatch(/\b(INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+[a-z_.]+\s+SET|LOCK\s+TABLE)\b/);
  });

  it('a different --to-player-id is a chain: STOP already_corrected_provider, not a second correction', async () => {
    expectStop(await rerun(pmsWorld(), { ...RERUN_ARGS, toPlayerId: 31 }), '§5.4', 'already_corrected_provider');
  });

  describe('cases 14/15/88: correction_target_absent (C14)', () => {
    it('case 14: moved row removed by an audited match deletion after c -> satisfied, reported, not recreated', async () => {
      const world = pmsWorld();
      world.rows = [];
      world.matches = [600];
      world.audits = [audit('matches', M, 'match_deletion')];
      const reports = expectSatisfied(await rerun(world));
      expect(reports.some((r) => r.startsWith('NOOP correction_target_absent'))).toBe(true);
      expect(world.rows).toEqual([]);
    });

    it('case 15: absent with M still present -> STOP correction_target_absent_unexplained', async () => {
      const world = pmsWorld();
      world.rows = [];
      expectStop(await rerun(world), 'C14', 'correction_target_absent_unexplained');
    });

    it('case 15: absent, M gone, but no match_deletion audit (or only one from before c) -> STOP', async () => {
      const world = pmsWorld();
      world.rows = [];
      world.matches = [600];
      expectStop(await rerun(world), 'C14', 'correction_target_absent_unexplained');
      world.audits = [audit('matches', M, 'match_deletion', false)];
      expectStop(await rerun(world), 'C14', 'correction_target_absent_unexplained');
    });

    it('case 88: a hypothesised match-sheet removal (M exists, match_sheet audit after c) -> STOP', async () => {
      const world = pmsWorld();
      world.rows = [];
      world.audits = [audit('matches', M, 'match_sheet')];
      expectStop(await rerun(world), 'C14', 'correction_target_absent_unexplained');
    });

    it('a vanished Brownlow round row is always a STOP, even with a match_deletion audit (R238-P5-02)', async () => {
      const world = brownlowWorld({ played: true, votes: 3, match_id: 600 });
      world.rows = [];
      world.matches = [];
      world.audits = [audit('matches', 600, 'match_deletion')];
      expectStop(await rerun(world), 'C14', 'correction_target_absent_unexplained');
    });
  });

  describe('legitimate post-correction edits (§5.12) pass and are reported', () => {
    it('case 70: a match-sheet field edited after c, with the match_sheet audit -> PASS, post_correction_edit match_sheet', async () => {
      const world = pmsWorld();
      setPmsRow(world, { goals: 99 });
      world.audits = [audit('matches', M, 'match_sheet')];
      const reports = expectSatisfied(await rerun(world));
      expect(reports.some((r) => r.startsWith('post_correction_edit match_sheet') && r.includes('goals'))).toBe(true);
    });

    it('case 69: Brownlow finalisation writes brownlow_votes on the corrected row, with a finalise audit -> PASS', async () => {
      const world = pmsWorld();
      setPmsRow(world, { brownlow_votes: 3 });
      world.audits = [audit('brownlow_vote_entry_state', M, 'finalise')];
      const reports = expectSatisfied(await rerun(world));
      expect(reports.some((r) => r.startsWith('post_correction_edit brownlow_admin') && r.includes('brownlow_votes'))).toBe(true);
    });

    it('case 96: an L7 settle after a match-sheet edit re-seeds from previous_values and passes with the audit', async () => {
      const world = pmsWorld();
      const kicksBefore = PMS_INSERT_VALUES.kicks as number;
      world.applications.push(app({
        id: 300, verb: 'update', targetTable: 'player_match_stats', targetKey: PMS_NEW_KEY, importBatchId: 70,
        sourceVersionSeq: 2, previousValues: { goals: 99, kicks: kicksBefore }, newValues: { goals: 100, kicks: kicksBefore + 1 },
      }));
      setPmsRow(world, { goals: 100, kicks: kicksBefore + 1, import_batch_id: 70 });
      world.audits = [audit('matches', M, 'match_sheet')];
      expectSatisfied(await rerun(world));
      world.audits = [];
      expectStop(await rerun(world), 'L8-d', 'post_correction_edit_unexplained');
    });

    it('case 99: Brownlow match_id NULL -> m on a still-afl_api row with a finalise audit for m -> PASS (match_id only)', async () => {
      const world = brownlowWorld();
      setBrownlowRow(world, { match_id: 600 });
      world.audits = [audit('brownlow_vote_entry_state', 600, 'finalise')];
      const reports = expectSatisfied(await rerun(world));
      expect(reports.some((r) => r.startsWith('post_correction_edit brownlow_admin') && r.includes('match_id'))).toBe(true);
    });

    it('case 72: Brownlow match_id -> NULL after an audited match deletion -> PASS match_deleted', async () => {
      const world = brownlowWorld({ played: true, votes: 3, match_id: 600 });
      setBrownlowRow(world, { match_id: null });
      world.matches = [M];
      world.audits = [audit('matches', 600, 'match_deletion')];
      const reports = expectSatisfied(await rerun(world));
      expect(reports.some((r) => r.startsWith('post_correction_edit match_deleted'))).toBe(true);
    });

    it('case 94: a round row re-owned by the Brownlow admin after c, with the revision-n audit -> PASS brownlow_admin_reowned', async () => {
      const world = brownlowWorld({ played: true, votes: 3, match_id: 600 });
      setBrownlowRow(world, { votes: 2, source_record_id: 'entry:600:r2' }, 'manual_admin_edit');
      world.audits = [audit('brownlow_vote_entry_state', 600, 'correct', true, 2)];
      const reports = expectSatisfied(await rerun(world));
      expect(reports.some((r) => r.startsWith('post_correction_edit brownlow_admin_reowned'))).toBe(true);
    });

    it('case 101: a fresh row at the vacated old key is reported as post_correction_reappearance and does not fail Q2', async () => {
      const world = pmsWorld();
      world.rows.push({ table: 'player_match_stats', key: PMS_OLD_KEY, current: { ownerKey: null, row: { id: 950, player_id: P, match_id: M, source_id: null } } });
      const reports = expectSatisfied(await rerun(world));
      expect(reports.some((r) => r.startsWith('post_correction_reappearance'))).toBe(true);
    });
  });

  describe('case 71/98: unexplained post-correction divergences STOP', () => {
    it('case 71: contested (outside the match-sheet set) changed with no L7 application, even with a match_sheet audit', async () => {
      const world = pmsWorld();
      setPmsRow(world, { contested: 1234 });
      world.audits = [audit('matches', M, 'match_sheet')];
      expectStop(await rerun(world), 'L8-d', 'post_correction_edit_unexplained');
    });

    it('case 71: a match-sheet field changed with its only match_sheet audit BEFORE c', async () => {
      const world = pmsWorld();
      setPmsRow(world, { goals: 99 });
      world.audits = [audit('matches', M, 'match_sheet', false)];
      expectStop(await rerun(world), 'L8-d', 'post_correction_edit_unexplained');
    });

    it('a brownlow_votes change with only a draft Brownlow audit -> STOP (a draft writes no canonical fact)', async () => {
      const world = pmsWorld();
      setPmsRow(world, { brownlow_votes: 1 });
      world.audits = [audit('brownlow_vote_entry_state', M, 'draft')];
      expectStop(await rerun(world), 'L8-d', 'post_correction_edit_unexplained');
    });

    it('case 98: a still-afl_api round row with a votes divergence and only a draft audit -> STOP post_correction_edit_unexplained', async () => {
      const world = brownlowWorld({ played: true, votes: 3, match_id: 600 });
      setBrownlowRow(world, { votes: 1 });
      world.audits = [audit('brownlow_vote_entry_state', 600, 'draft')];
      expectStop(await rerun(world), 'L8-d', 'post_correction_edit_unexplained');
    });

    it('R238-P5-01: even a finalise audit cannot explain votes/played on a still-afl_api round row', async () => {
      const world = brownlowWorld({ played: true, votes: 3, match_id: 600 });
      setBrownlowRow(world, { votes: 1 });
      world.audits = [audit('brownlow_vote_entry_state', 600, 'finalise')];
      expectStop(await rerun(world), 'L8-d', 'post_correction_edit_unexplained');
      setBrownlowRow(world, { votes: 3, played: false });
      expectStop(await rerun(world), 'L8-d', 'post_correction_edit_unexplained');
    });

    it('case 99 inverse: a match_id NULL -> m resolve with only a draft audit -> STOP', async () => {
      const world = brownlowWorld();
      setBrownlowRow(world, { match_id: 600 });
      world.audits = [audit('brownlow_vote_entry_state', 600, 'draft')];
      expectStop(await rerun(world), 'L8-d', 'post_correction_edit_unexplained');
    });
  });

  describe('case 97 and L8-b′/L8-c: ownership, stamps and projection are never "legitimate edits"', () => {
    it.each([
      ['source_id no longer afl_api', { source_id: 3 }, 'afltables'],
      ['source_record_id no longer the P2 stamp', { source_record_id: 'CD_M1|T1|CD_J' }, undefined],
      ['import_batch_id no longer the latest application batch', { import_batch_id: 51 }, undefined],
    ])('case 97: %s -> STOP L8-b ownership_or_stamp_contradicts', async (_label, patch, ownerKey) => {
      const world = pmsWorld();
      setPmsRow(world, patch, ownerKey);
      expectStop(await rerun(world), 'L8-b', 'ownership_or_stamp_contradicts');
    });

    it('case 94 inverse: a re-owned round row with no matching revision-n audit -> STOP ownership_or_stamp_contradicts', async () => {
      const world = brownlowWorld({ played: true, votes: 3, match_id: 600 });
      setBrownlowRow(world, { votes: 2, source_record_id: 'entry:600:r2' }, 'manual_admin_edit');
      world.audits = [audit('brownlow_vote_entry_state', 600, 'correct', true, 1)];
      expectStop(await rerun(world), 'L8-b', 'ownership_or_stamp_contradicts');
    });

    it('L8-c: a typed projection naming P after the correction -> STOP projection_disagrees', async () => {
      const world = pmsWorld();
      world.projections = [{ table: 'player_match_stats', providerMatchId: 'CD_M1', playerId: P }];
      expectStop(await rerun(world), 'L8-c', 'projection_disagrees');
    });
  });

  describe('immutable lineage (L1-L7) and SAT-1/2/5 are still enforced on a re-run', () => {
    it('case 93: a recorded preCorrectionContractSha256 that differs from the H reconstruction -> STOP L5 row_proof_mismatch', async () => {
      const world = pmsWorld();
      world.batches = [correctionBatch([{ table: 'player_match_stats', verb: 'update', oldKey: PMS_OLD_KEY, newKey: PMS_NEW_KEY, preCorrectionContractSha256: 'b'.repeat(64) }])];
      expectStop(await rerun(world), 'L5', 'row_proof_mismatch');
    });

    it('case 49: the old-key history H is missing -> STOP L5 missing_pre_correction_history, never NOOP', async () => {
      const world = pmsWorld();
      world.applications = world.applications.filter((a) => a.id !== pmsInsert.id);
      expectStop(await rerun(world), 'L5', 'missing_pre_correction_history');
    });

    it('case 93: rowProofs omitting a bound application -> STOP SAT-2 correction_not_bound', async () => {
      const world = pmsWorld();
      world.applications.push(app({ id: 201, verb: 'update', targetTable: 'player_match_stats', targetKey: { player_id: P2, match_id: 501 }, importBatchId: K, previousValues: { player_id: P }, newValues: { player_id: P2 } }));
      expectStop(await rerun(world), 'SAT-2', 'correction_not_bound');
    });

    it('case 22: another provider writes at k′ after c -> STOP L7 mixed_provider_after_correction', async () => {
      const world = pmsWorld();
      world.applications.push(app({ id: 300, verb: 'update', targetTable: 'player_match_stats', targetKey: PMS_NEW_KEY, importBatchId: 70, externalRecordId: 'CD_M1|T1|CD_J', sourceVersionSeq: 2, previousValues: { goals: 1 }, newValues: { goals: 2 } }));
      expectStop(await rerun(world), 'L7', 'mixed_provider_after_correction');
    });

    it('case 95: an unmoved CD_I-attributed row still at P -> STOP unmoved_closure_row', async () => {
      const world = pmsWorld();
      world.attributedKeysAtP = [naturalKeyString('player_match_stats', { player_id: P, match_id: 777 })];
      expectStop(await rerun(world), 'SAT-5', 'unmoved_closure_row');
    });

    it('SAT-5: a later application through CD_I at the vacated old key -> STOP identity_contradicts', async () => {
      const world = pmsWorld();
      world.applications.push(app({ id: 400, verb: 'insert', targetTable: 'player_match_stats', targetKey: PMS_OLD_KEY, importBatchId: 80, sourceVersionSeq: 3, newValues: PMS_INSERT_VALUES }));
      expectStop(await rerun(world), 'SAT-5', 'identity_contradicts');
    });

    it('SAT-1: the live identity no longer names P′ -> STOP identity_contradicts', async () => {
      const world = pmsWorld();
      world.identityRow = { ...world.identityRow!, playerId: P };
      expectStop(await rerun(world), 'SAT-1', 'identity_contradicts');
    });

    it('case 86: A.previous_player_identity unresolvable on the live target -> STOP identity_unresolvable', async () => {
      const world = pmsWorld();
      world.identities = { 'id:P2': P2 };
      expectStop(await rerun(world), 'SAT-1', 'identity_unresolvable');
    });
  });

  it('case 12: a historical DELETE is satisfied from immutable history alone (D-1..D-6), even with a later foreign insert', async () => {
    const snapshot = { id: 900, player_id: P, match_id: M, source_id: AFL_API_SOURCE_ID, source_record_id: STAMP, import_batch_id: SETTLE_BATCH, ...PMS_INSERT_VALUES, brownlow_votes: null };
    const world: World = {
      ...baseWorld(),
      batches: [correctionBatch([{ table: 'player_match_stats', verb: 'delete', oldKey: PMS_OLD_KEY, newKey: null, preCorrectionContractSha256: PMS_PRE_HASH }])],
      applications: [
        pmsInsert,
        app({ id: 205, verb: 'delete', targetTable: 'player_match_stats', targetKey: PMS_OLD_KEY, importBatchId: K, previousValues: snapshot, newValues: {} }),
        app({ id: 300, verb: 'insert', targetTable: 'player_match_stats', targetKey: PMS_OLD_KEY, importBatchId: 90, sourceId: 'afltables', externalRecordId: 'afltables-row', newValues: PMS_INSERT_VALUES }),
      ],
      rows: [],
      projections: [],
    };
    const reports = expectSatisfied(await rerun(world));
    expect(reports.some((r) => r.startsWith('NOOP already_corrected_deleted'))).toBe(true);
    world.applications.push(app({ id: 301, verb: 'update', targetTable: 'player_match_stats', targetKey: PMS_OLD_KEY, importBatchId: 91, sourceVersionSeq: 4, previousValues: { goals: 1 }, newValues: { goals: 2 } }));
    expectStop(await rerun(world), 'D-6', 'mixed_provider_after_correction');
  });
});

describe('§8.4: the post-write re-plan runs the SAME Q2 evaluator, with K as the current batch', () => {
  it('passes while K is still running when K is the current transaction\'s batch', async () => {
    const world = pmsWorld();
    world.batches = [correctionBatch((world.batches[0].validationResult as { rowProofs: JsonValue[] }).rowProofs, 'running')];
    const result = await checkCorrectionSatisfaction(fakeReader(world), { providerId: CD_I, adjudicationId: 2, currentBatchId: K });
    expect(result.satisfied).toBe(true);
  });

  it('the same running batch outside its own transaction is not bound (SAT-2)', async () => {
    const world = pmsWorld();
    world.batches = [correctionBatch((world.batches[0].validationResult as { rowProofs: JsonValue[] }).rowProofs, 'running')];
    expectStop(await rerun(world), 'SAT-2', 'correction_not_bound');
  });

  it('an unexplained divergence fails the post-write path exactly as it fails a re-run', async () => {
    const world = pmsWorld();
    setPmsRow(world, { contested: 1234 });
    const postWrite = await checkCorrectionSatisfaction(fakeReader(world), { providerId: CD_I, adjudicationId: 2, currentBatchId: K });
    expect(postWrite.satisfied).toBe(false);
    expect(postWrite.stops.map((s) => `${s.step}:${s.code}`)).toContain('L8-d:post_correction_edit_unexplained');
    const outcome = decideAlreadyCorrectedRerun(RERUN_ARGS, postWrite);
    expectStop(outcome, 'L8-d', 'post_correction_edit_unexplained');
  });
});

/* ==================================================================== *
 * Slice-5 remediation (2026-09-28, second pass). Runbook clauses covered, by describe block:
 *   §5.9 BG2 (event binding, proven-closure exemption) and §5.4 C1c for a match-less row;
 *   §5.4 C11 / §5.2 "P1 false is foreign" (foreign NOOP vs indeterminate STOP);
 *   §5.3 B4 (gathered evidence, Q1 and the Q2 L5 re-run);
 *   §5.12 SAT-1 (the §8.6 extended bijection) and SAT-5 (every typed projection of CD_I);
 *   fail-closed reads inside the transaction (§5.9 BG3, §8.2 steps 7/8).
 * Everything here is pure, in-memory or a source-contract read. None of it is DB integration:
 * the SQL these readers issue is exercised only by the operator's DB rehearsal.
 * ==================================================================== */

function toolSource(): string {
  return readFileSync(join(process.cwd(), 'tools', 'migration', 'correct_afl_api_identity.ts'), 'utf8');
}

/** A B1-B5-provable AFL API round row of P, as `buildBrownlowEvidence` hands it to the planner. */
function brownlowRowEvidence(overrides: Partial<BrownlowRowEvidence> = {}): BrownlowRowEvidence {
  return {
    sourceId: 'afl_api', sourceRecordId: 'CD_M1', expectedSourceRecordId: 'CD_M1',
    importBatchId: 51, expectedImportBatchId: 51,
    insertApplication: {
      id: 110, verb: 'insert', previousValues: null, newValues: { played: true, votes: 3, match_id: M },
      sourceId: 'afl_api', externalRecordId: 'CD_M1', sourceVersionSeq: 1, importBatchId: 51,
    },
    insertProvenByPayload: true, projectionPlayerId: null, currentPlayerId: P, chain: [],
    anotherProviderAlsoResolved: false, current: { played: true, votes: 3, matchId: M },
    ...overrides,
  };
}

/** A `player_match_stats` closure row's event: (P, M) with M in season 2025, round 5. */
const PMS_EVENT: BrownlowEvent = { kind: 'match', matchId: M, season: 2025, roundNumber: 5 };

type Assessment = { candidate: { id: number }; ownership: ClosureOwnership; verdict: AttributionResult };

/** BG2 for the PMS closure row at PMS_EVENT, composed exactly as `buildClosure` composes it. */
function bg2ForPmsRow(rows: BrownlowEventRow[], assessments: Assessment[]) {
  const blockers = foreignBrownlowRowsAtEvent({
    rows, provenClosureRowIds: provenBrownlowClosureRowIdsOf(assessments), ownRowId: null, event: PMS_EVENT,
  });
  const guards = evaluateBrownlowGuards({
    playerMatchStatsBrownlowVotes: null, foreignBrownlowRowAtEvent: blockers.length > 0, entryStateNamesPlayer: false,
  });
  return { blockers: blockers.map((b) => b.id), guards };
}

function claimed(id: number, evidence: BrownlowRowEvidence): Assessment {
  return { candidate: { id }, ownership: 'claimed', verdict: evaluateBrownlowMutationEligibility(evidence) };
}

function brownlowOwnership(currentRow: Record<string, JsonValue>, applications: CanonicalApplicationRow[] = []): ClosureOwnership {
  return brownlowClosureOwnership({ currentRow, applications }, AFL_API_SOURCE_ID);
}

const BRW_INSERT_ROW: CanonicalApplicationRow = {
  id: 110, verb: 'insert', previousValues: null, newValues: { played: true, votes: 3, match_id: M },
  sourceId: 'afl_api', family: 'brownlow_match_votes', externalRecordId: 'CD_M1', sourceVersionSeq: 1,
  importBatchId: 51, targetKey: BRW_OLD_KEY,
};

describe('§5.9 BG2: a Brownlow row blocks unless it is itself a PROVEN closure row at the event', () => {
  it('BG2 case 1: PMS closure row + its legitimate paired Brownlow closure row (same CD_I closure) -> no STOP', () => {
    const paired = claimed(901, brownlowRowEvidence());
    expect(paired.verdict.ok).toBe(true);
    const { blockers, guards } = bg2ForPmsRow([{ id: 901, season: 2025, roundNumber: 5, matchId: M }], [paired]);
    expect(blockers).toEqual([]);
    expect(guards.ok).toBe(true);
  });

  it('BG2 case 2: a foreign (manual-owned) Brownlow row for P at the same match -> STOP foreign_brownlow_dependency, even beside a paired row', () => {
    const ownership = brownlowOwnership({ source_id: 9, source_record_id: 'entry:500:r1', import_batch_id: null }, [BRW_INSERT_ROW]);
    expect(ownership).toBe('foreign');
    const { blockers, guards } = bg2ForPmsRow(
      [{ id: 901, season: 2025, roundNumber: 5, matchId: M }, { id: 902, season: 2025, roundNumber: 5, matchId: M }],
      [claimed(901, brownlowRowEvidence()), { candidate: { id: 902 }, ownership, verdict: { ok: true } }],
    );
    expect(blockers).toEqual([902]);
    expect(guards.ok).toBe(false);
    if (!guards.ok) expect(`${guards.stop.step}:${guards.stop.code}`).toBe('BG2:foreign_brownlow_dependency');
  });

  it('BG2 case 3: an unrelated unresolved row elsewhere in the same season is not at the event (season alone never binds)', () => {
    const elsewhere: BrownlowEventRow = { id: 903, season: 2025, roundNumber: 9, matchId: null };
    expect(brownlowRowRefersToEvent(elsewhere, PMS_EVENT)).toBe(false);
    const { blockers, guards } = bg2ForPmsRow([elsewhere], [{ candidate: { id: 903 }, ownership: 'foreign', verdict: { ok: true } }]);
    expect(blockers).toEqual([]);
    expect(guards.ok).toBe(true);
    // A final has R(M) NULL: the admin resolve step (`round_number = NULL`) binds no unresolved row to it.
    expect(brownlowRowRefersToEvent({ id: 903, season: 2025, roundNumber: 5, matchId: null }, { ...PMS_EVENT, roundNumber: null })).toBe(false);
    // A resolved row binds by its own match only.
    expect(brownlowRowRefersToEvent({ id: 903, season: 2025, roundNumber: 5, matchId: 777 }, PMS_EVENT)).toBe(false);
  });

  it('BG2 case 4: an unresolved row in the event\'s own (S(M), R(M)) is at the event; proven in this closure it is exempt, unproven it blocks', () => {
    const sameEvent: BrownlowEventRow = { id: 904, season: 2025, roundNumber: 5, matchId: null };
    expect(brownlowRowRefersToEvent(sameEvent, PMS_EVENT)).toBe(true);
    const provenEvidence = brownlowRowEvidence({
      insertApplication: { ...brownlowRowEvidence().insertApplication, newValues: { played: true, votes: 3, match_id: null } },
      current: { played: true, votes: 3, matchId: null },
    });
    expect(bg2ForPmsRow([sameEvent], [claimed(904, provenEvidence)]).blockers).toEqual([]);
    expect(bg2ForPmsRow([sameEvent], [{ candidate: { id: 904 }, ownership: 'foreign', verdict: { ok: true } }]).blockers).toEqual([904]);
  });

  it('BG2 case 5: insufficient evidence is never "paired" -- an afl_api row failing B3-I, or an indeterminate row, still blocks', () => {
    const unproven = claimed(905, brownlowRowEvidence({ insertProvenByPayload: false, projectionPlayerId: null }));
    expect(unproven.verdict.ok).toBe(false);
    if (!unproven.verdict.ok) expect(unproven.verdict.stop.code).toBe('brownlow_insert_unproven');
    const row = { id: 905, season: 2025, roundNumber: 5, matchId: M };
    expect(bg2ForPmsRow([row], [unproven]).guards.ok).toBe(false);
    const indeterminate = brownlowOwnership({ source_id: null, source_record_id: 'CD_M1', import_batch_id: null }, [BRW_INSERT_ROW]);
    expect(indeterminate).toBe('indeterminate');
    expect(bg2ForPmsRow([row], [{ candidate: { id: 905 }, ownership: indeterminate, verdict: { ok: true } }]).guards.ok).toBe(false);
    // A row with no assessment at all (never proven) blocks too.
    expect(bg2ForPmsRow([row], []).blockers).toEqual([905]);
  });

  it('a match-less Brownlow closure row\'s event is its (S, R): rows resolved to any match of (S, R) are at it, others are not', () => {
    const roundEvent: BrownlowEvent = { kind: 'round', season: 2025, roundNumber: 5, matchIds: [M, 501] };
    expect(brownlowRowRefersToEvent({ id: 1, season: 2025, roundNumber: 5, matchId: 501 }, roundEvent)).toBe(true);
    expect(brownlowRowRefersToEvent({ id: 2, season: 2025, roundNumber: 6, matchId: 777 }, roundEvent)).toBe(false);
    expect(foreignBrownlowRowsAtEvent({
      rows: [{ id: 3, season: 2025, roundNumber: 5, matchId: null }], provenClosureRowIds: new Set(), ownRowId: 3, event: roundEvent,
    })).toEqual([]);
  });

  it('C1c for a match-less row: P′ participation in EXACTLY one match of (S, R) after the plan, planned PMS rows included', () => {
    const none = participationMatchIdsAfterPlan({ candidateMatchIds: [M, 501], pPrimeRowMatchIds: new Set(), plannedPlayerMatchStatsMatchIds: new Set() });
    expect(evaluateBrownlowParticipation(true, none.length === 1).ok).toBe(false);
    const planned = participationMatchIdsAfterPlan({ candidateMatchIds: [M, 501], pPrimeRowMatchIds: new Set(), plannedPlayerMatchStatsMatchIds: new Set([M]) });
    expect(planned).toEqual([M]);
    const two = participationMatchIdsAfterPlan({ candidateMatchIds: [M, 501], pPrimeRowMatchIds: new Set([501]), plannedPlayerMatchStatsMatchIds: new Set([M]) });
    expect(evaluateBrownlowParticipation(true, two.length === 1).ok).toBe(false);
    expect(evaluateBrownlowParticipation(false, two.length === 1).ok).toBe(true);
  });

  it('source contract: buildClosure proves the Brownlow closure set BEFORE any PMS BG2, and the season-only predicate is gone', () => {
    const source = toolSource();
    const closure = source.slice(source.indexOf('async function buildClosure('), source.indexOf('async function ownerKeyOf('));
    const proven = closure.indexOf('provenBrownlowClosureRowIdsOf(brownlowAssessments)');
    expect(proven).toBeGreaterThan(0);
    expect(proven).toBeLessThan(closure.indexOf('/* ---- player_match_stats candidates ---- */'));
    expect(closure).toContain('provenClosureRowIds: provenBrownlowClosureRowIds, ownRowId: null');
    expect(closure).toContain('for (const matchId of eventMatchIds) bg3 ||= await readEntryStateNamesPlayer(tx, matchId, pId);');
    expect(source).not.toMatch(/b\.match_id IS NULL AND b\.season = m\.season\)/);
  });
});

function pmsCandidate(current: Record<string, JsonValue>, applications: CanonicalApplicationRow[]): PlayerMatchStatsCandidate {
  return { id: 800, matchId: M, season: 2025, roundNumber: 5, current, applications, projectionPlayerId: null };
}

const CD_I_PMS_HISTORY: CanonicalApplicationRow[] = [{
  id: 100, verb: 'insert', previousValues: null, newValues: PMS_INSERT_VALUES, sourceId: 'afl_api',
  family: 'afl_api_player_stats', externalRecordId: STAMP, sourceVersionSeq: 1, importBatchId: SETTLE_BATCH, targetKey: PMS_OLD_KEY,
}];

describe('§5.4 C11: a foreign row at P is a NOOP; only a row carrying CD_I lineage without its owner is a STOP', () => {
  const pmsRow = (patch: Record<string, JsonValue>) => ({ id: 800, player_id: P, match_id: M, ...PMS_INSERT_VALUES, brownlow_votes: null, ...patch });

  it('a foreign-owned PMS row at P WITH historical CD_I applications at its key -> foreign (NOOP), not a closure STOP', () => {
    const candidate = pmsCandidate(pmsRow({ source_id: 3, source_record_id: 'afltables:2025:500:10', import_batch_id: 99 }), CD_I_PMS_HISTORY);
    expect(playerMatchStatsClosureOwnership(candidate, CD_I, AFL_API_SOURCE_ID)).toBe('foreign');
  });

  it('a NULL-owned row with no lineage of its own (the match-sheet INSERT shape) -> foreign, whatever history its key has', () => {
    const candidate = pmsCandidate(pmsRow({ source_id: null, source_record_id: null, import_batch_id: null }), CD_I_PMS_HISTORY);
    expect(playerMatchStatsClosureOwnership(candidate, CD_I, AFL_API_SOURCE_ID)).toBe('foreign');
  });

  it('a NULL-owned row carrying CD_I\'s stamp or CD_I\'s application batch -> indeterminate (fail-closed STOP, never NOOP)', () => {
    expect(playerMatchStatsClosureOwnership(
      pmsCandidate(pmsRow({ source_id: null, source_record_id: STAMP, import_batch_id: null }), CD_I_PMS_HISTORY), CD_I, AFL_API_SOURCE_ID,
    )).toBe('indeterminate');
    expect(playerMatchStatsClosureOwnership(
      pmsCandidate(pmsRow({ source_id: null, source_record_id: null, import_batch_id: SETTLE_BATCH }), CD_I_PMS_HISTORY), CD_I, AFL_API_SOURCE_ID,
    )).toBe('indeterminate');
    // A foreign owner holding CD_I's own stamp is equally contradictory.
    expect(playerMatchStatsClosureOwnership(
      pmsCandidate(pmsRow({ source_id: 3, source_record_id: STAMP, import_batch_id: 99 }), CD_I_PMS_HISTORY), CD_I, AFL_API_SOURCE_ID,
    )).toBe('indeterminate');
  });

  it('a current afl_api-owned row is claimed and keeps every P-check: contradictory provenance STOPs (P2), no history STOPs (P3)', () => {
    const contradictory = pmsCandidate(pmsRow({ source_id: AFL_API_SOURCE_ID, source_record_id: 'CD_M1|T1|CD_J', import_batch_id: SETTLE_BATCH }), CD_I_PMS_HISTORY);
    expect(playerMatchStatsClosureOwnership(contradictory, CD_I, AFL_API_SOURCE_ID)).toBe('claimed');
    const p2 = evaluatePlayerMatchStatsMutationEligibility(buildPlayerMatchStatsEvidence(contradictory, CD_I, AFL_API_SOURCE_ID));
    expect(p2.ok ? 'ok' : `${p2.stop.step}:${p2.stop.code}`).toBe('P2:provenance_unexplained');

    const noHistory = pmsCandidate(pmsRow({ source_id: AFL_API_SOURCE_ID, source_record_id: STAMP, import_batch_id: SETTLE_BATCH }), []);
    expect(playerMatchStatsClosureOwnership(noHistory, CD_I, AFL_API_SOURCE_ID)).toBe('claimed');
    const p3 = evaluatePlayerMatchStatsMutationEligibility(buildPlayerMatchStatsEvidence(noHistory, CD_I, AFL_API_SOURCE_ID));
    expect(p3.ok ? 'ok' : `${p3.stop.step}:${p3.stop.code}`).toBe('P3:no_application_evidence');

    const valid = pmsCandidate(pmsRow({ source_id: AFL_API_SOURCE_ID, source_record_id: STAMP, import_batch_id: SETTLE_BATCH }), CD_I_PMS_HISTORY);
    expect(evaluatePlayerMatchStatsMutationEligibility(buildPlayerMatchStatsEvidence(valid, CD_I, AFL_API_SOURCE_ID)).ok).toBe(true);
  });

  it('Brownlow equivalents: an admin re-owned round row with AFL API history is foreign; NULL-owned with CD_M\'s stamp or batch is indeterminate', () => {
    expect(brownlowOwnership({ source_id: 9, source_record_id: 'entry:500:r2', import_batch_id: null }, [BRW_INSERT_ROW])).toBe('foreign');
    expect(brownlowOwnership({ source_id: null, source_record_id: null, import_batch_id: null }, [BRW_INSERT_ROW])).toBe('foreign');
    expect(brownlowOwnership({ source_id: null, source_record_id: 'CD_M1', import_batch_id: null }, [BRW_INSERT_ROW])).toBe('indeterminate');
    expect(brownlowOwnership({ source_id: null, source_record_id: null, import_batch_id: 51 }, [BRW_INSERT_ROW])).toBe('indeterminate');
    expect(brownlowOwnership({ source_id: AFL_API_SOURCE_ID, source_record_id: 'CD_M1', import_batch_id: 51 }, [BRW_INSERT_ROW])).toBe('claimed');
  });

  it('source contract: a foreign row is reported and skipped before any P/B check; an indeterminate one is a C11 STOP', () => {
    const source = toolSource();
    const closure = source.slice(source.indexOf('async function buildClosure('), source.indexOf('async function ownerKeyOf('));
    const pms = closure.slice(closure.indexOf('/* ---- player_match_stats candidates ---- */'), closure.indexOf('/* ---- brownlow_round_votes candidates ---- */'));
    expect(pms.indexOf("if (ownership === 'foreign')")).toBeLessThan(pms.indexOf('evaluatePlayerMatchStatsMutationEligibility('));
    expect(pms).toContain('NOOP foreign (C11)');
    expect(pms).toContain("step: 'C11', code: 'provenance_unexplained'");
    const brw = closure.slice(closure.indexOf('/* ---- brownlow_round_votes candidates ---- */'));
    expect(brw).toContain('NOOP foreign (C11)');
    expect(brw).toContain("step: 'C11', code: 'provenance_unexplained'");
    // Every row at P is read: the readers no longer drop a row with no application history.
    expect(source).not.toContain('if (applications.length === 0) continue');
  });
});

describe('§5.3 B4: another provider of the insert vote set resolving to P is gathered evidence, never a hard-coded false', () => {
  it('the key\'s own history: a positive vote that is not CD_I\'s entry came from another voter; 0 and unparseable prove nothing', () => {
    expect(brownlowHistoryShowsAnotherVoter([{ newValues: { votes: 3 }, voterProof: { count: 1, vote: 3 } }])).toBe(false);
    expect(brownlowHistoryShowsAnotherVoter([{ newValues: { votes: 2 }, voterProof: { count: 1, vote: 3 } }])).toBe(true);
    expect(brownlowHistoryShowsAnotherVoter([{ newValues: { votes: 1 }, voterProof: { count: 0, vote: null } }])).toBe(true);
    expect(brownlowHistoryShowsAnotherVoter([{ newValues: { votes: 0 }, voterProof: { count: 0, vote: null } }])).toBe(false);
    expect(brownlowHistoryShowsAnotherVoter([{ newValues: { votes: 2 }, voterProof: { count: -1, vote: null } }])).toBe(false);
    expect(brownlowHistoryShowsAnotherVoter([{ newValues: { match_id: 600 }, voterProof: { count: 1, vote: 3 } }])).toBe(false);
  });

  it('each of the three gathered halves makes B4 true on its own', () => {
    const none = { otherProviderProjectionsNamingPlayer: 0, otherVoterIdentitiesAtPlayer: 0, historyShowsAnotherVoter: false };
    expect(brownlowAnotherProviderResolvedToPlayer(none)).toBe(false);
    expect(brownlowAnotherProviderResolvedToPlayer({ ...none, otherProviderProjectionsNamingPlayer: 1 })).toBe(true);
    expect(brownlowAnotherProviderResolvedToPlayer({ ...none, otherVoterIdentitiesAtPlayer: 1 })).toBe(true);
    expect(brownlowAnotherProviderResolvedToPlayer({ ...none, historyShowsAnotherVoter: true })).toBe(true);
  });

  it('B4 PASS/STOP through the planner: false -> attribution PASS; true -> STOP B4', () => {
    expect(evaluateBrownlowAttribution(brownlowRowEvidence()).ok).toBe(true);
    const stopped = evaluateBrownlowAttribution(brownlowRowEvidence({ anotherProviderAlsoResolved: true }));
    expect(stopped.ok ? 'ok' : `${stopped.stop.step}:${stopped.stop.code}`).toBe('B4:mixed_provider_application_history');
  });

  it('Q2 (L5 over H): another voter\'s positive vote at the old key STOPs the re-run with B4', async () => {
    const world = brownlowWorld();
    world.applications.push(app({
      id: 150, verb: 'update', targetTable: 'brownlow_round_votes', targetKey: BRW_OLD_KEY, importBatchId: 52,
      family: 'brownlow_match_votes', externalRecordId: 'CD_M1', previousValues: { votes: 3 }, newValues: { votes: 2 },
      voterProof: { count: 1, vote: 3 },
    }));
    expectStop(await rerun(world), 'B4', 'mixed_provider_application_history');
  });

  it('source contract: no Brownlow evidence construction hard-codes B4 to the permissive value', () => {
    const source = toolSource();
    expect(source).not.toMatch(/anotherProviderAlsoResolved:\s*false/);
    expect(source).toContain('anotherProviderAlsoResolved: brownlowAnotherProviderResolvedToPlayer({');
    expect(source).toContain('anotherProviderAlsoResolved: brownlowHistoryShowsAnotherVoter(history)');
  });
});

describe('§5.12 SAT-1: the §8.6 extended bijection is identity authority, evaluated independently of L8', () => {
  it('a normal corrected provider satisfies the bijection (no SAT-1 stop), on the re-run and the post-write path alike', async () => {
    const world = pmsWorld();
    const facts = await fakeReader(world).identityInvariantFacts();
    expect(sat1ExtendedBijectionProblems({ facts, providerId: CD_I, pPrimeId: P2, pPrimeIdentity: 'id:P2' })).toEqual([]);
    // The shared bijection is what runs: the same census without CD_I's ledger is a named mismatch.
    expect(sat1ExtendedBijectionProblems({
      facts: { ...facts, ledgerRows: [] }, providerId: CD_I, pPrimeId: P2, pPrimeIdentity: 'id:P2',
    })).toEqual(['{"kind":"bijection_mismatch","mismatch":{"kind":"row_without_ledger","externalId":"CD_I"}}']);
    expectSatisfied(await rerun(world));
    const postWrite = await checkCorrectionSatisfaction(fakeReader(world), { providerId: CD_I, adjudicationId: 2, currentBatchId: K });
    expect(postWrite.satisfied).toBe(true);
  });

  it('a second provider resolved to P′ (a human row at P′ with its own linked ledger entry) -> SAT-1 STOP identity_contradicts', async () => {
    const world = pmsWorld();
    world.census.push({ externalId: 'CD_J', status: 'resolved', matchMethod: AFL_API_ADMIN_MATCH_METHOD, playerId: P2, candidateCount: 0, externalUrl: null });
    world.otherLedger.push({ id: 5, externalId: 'CD_J', action: 'linked', playerId: P2, playerIdentity: 'id:P2', supersedesId: null, previousPlayerIdentity: null });
    expectStop(await rerun(world), 'SAT-1', 'identity_contradicts');
    const postWrite = await checkCorrectionSatisfaction(fakeReader(world), { providerId: CD_I, adjudicationId: 2, currentBatchId: K });
    expect(postWrite.stops.map((s) => `${s.step}:${s.code}`)).toContain('SAT-1:identity_contradicts');
  });

  it('an importer row for another provider at P′ -> SAT-1 STOP (one afl_api row per player)', async () => {
    const world = pmsWorld();
    world.census.push({ externalId: 'CD_J', status: 'unique', matchMethod: 'afl_api_stat_vector_season', playerId: P2, candidateCount: 1, externalUrl: null });
    world.forwardIdentities.set(P2, { ok: true, identity: 'id:P2', via: 'afltables' });
    expectStop(await rerun(world), 'SAT-1', 'identity_contradicts');
  });

  it('another provider whose net linked ledger entry names P′ (§8.6 "at its player_identity"), even with its row elsewhere -> STOP', async () => {
    const world = pmsWorld();
    world.census.push({ externalId: 'CD_J', status: 'resolved', matchMethod: AFL_API_ADMIN_MATCH_METHOD, playerId: 30, candidateCount: 0, externalUrl: null });
    world.otherLedger.push({ id: 5, externalId: 'CD_J', action: 'linked', playerId: 30, playerIdentity: 'id:P2', supersedesId: null, previousPlayerIdentity: null });
    expectStop(await rerun(world), 'SAT-1', 'identity_contradicts');
    // The same provider linked to its own, different identity is no collision.
    world.otherLedger[0] = { ...world.otherLedger[0], playerIdentity: 'id:30' };
    expectSatisfied(await rerun(world));
  });

  it('the net CORRECTED ledger entry without its resolved row (bijection ledger_without_row) -> STOP', async () => {
    const world = pmsWorld();
    world.census = [];
    expectStop(await rerun(world), 'SAT-1', 'identity_contradicts');
  });

  it('the invariant\'s one permitted alias -- a tracked profile_url_continuity pair -- stays permitted; an untracked pair does not', async () => {
    const rules = loadFitzroyProfileContinuityRules();
    expect(rules.length).toBeGreaterThan(0);
    const rule = rules[0];
    const importer: AflApiCensusRow = { externalId: 'CD_K', status: 'unique', matchMethod: 'afl_api_stat_vector_season', playerId: 40, candidateCount: 1, externalUrl: null };
    const identities = (paths: string[]) => classifyAflApiForwardIdentityRows({
      playerIds: [40], rows: paths.map((externalId) => ({ playerId: 40, externalId, sourceKey: 'afltables' })), continuityRules: rules,
    });

    const permitted = pmsWorld();
    permitted.census.push(importer);
    permitted.forwardIdentities = identities([rule.continuingUrl, rule.renumberedUrl]);
    expectSatisfied(await rerun(permitted));

    const untracked = pmsWorld();
    untracked.census.push(importer);
    untracked.forwardIdentities = identities([rule.continuingUrl, 'players/Z/Zzz_Unrelated.html']);
    expectStop(await rerun(untracked), 'SAT-1', 'identity_contradicts');
  });
});

describe('§5.12 SAT-5: no typed projection of CD_I may still identify P, bound to a row or not', () => {
  it('a stray player_match projection for CD_I -> P with no bound row -> SAT-5 STOP (L8-c never sees it)', async () => {
    const world = pmsWorld();
    world.projections.push({ table: 'player_match_stats', providerMatchId: 'CD_M9', playerId: P });
    const outcome = await rerun(world);
    expectStop(outcome, 'SAT-5', 'identity_contradicts');
    if (outcome.kind === 'STOP') expect(outcome.stops.some((s) => s.step === 'L8-c')).toBe(false);
  });

  it('a stray Brownlow projection for CD_I -> P -> SAT-5 STOP', async () => {
    const world = pmsWorld();
    world.projections.push({ table: 'brownlow_round_votes', providerMatchId: 'CD_M9', playerId: P });
    expectStop(await rerun(world), 'SAT-5', 'identity_contradicts');
  });

  it('only corrected projections (P′), and an unresolved (NULL) Brownlow projection -> PASS', async () => {
    const world = pmsWorld();
    world.projections.push(
      { table: 'player_match_stats', providerMatchId: 'CD_M9', playerId: P2 },
      { table: 'brownlow_round_votes', providerMatchId: 'CD_M9', playerId: P2 },
      { table: 'brownlow_round_votes', providerMatchId: 'CD_M8', playerId: null },
    );
    expectSatisfied(await rerun(world));
  });

  it('conflicting projections (one CD_M, two players), or a third player -> STOP', async () => {
    expect(sat5ProjectionContradictions([
      { table: 'player_match_stats', providerMatchId: 'CD_M9', playerId: P2 },
      { table: 'player_match_stats', providerMatchId: 'CD_M9', playerId: 30 },
    ], P, P2)).toHaveLength(2);
    const world = pmsWorld();
    world.projections.push({ table: 'player_match_stats', providerMatchId: 'CD_M9', playerId: 30 });
    expectStop(await rerun(world), 'SAT-5', 'identity_contradicts');
    const conflicting = pmsWorld();
    conflicting.projections.push(
      { table: 'brownlow_round_votes', providerMatchId: 'CD_M9', playerId: P2 },
      { table: 'brownlow_round_votes', providerMatchId: 'CD_M9', playerId: null },
    );
    expectStop(await rerun(conflicting), 'SAT-5', 'identity_contradicts');
  });

  it('source contract: the ORIGINAL write moves EVERY CD_I projection still naming P, in both tables, not only a MOVE row\'s', () => {
    const source = toolSource();
    const run = source.slice(source.indexOf('async function runCorrection('), source.indexOf('export async function readStatAvailability('));
    expect(run).toContain('UPDATE staging.afl_api_player_match SET player_id = ${pPrimeId}');
    expect(run).toContain('UPDATE staging.afl_api_brownlow_vote SET player_id = ${pPrimeId}');
    expect(run.match(/AND provider_player_id = \$\{args\.providerId\} AND player_id = \$\{pId\}/g)).toHaveLength(2);
    expect(run).not.toContain('provider_match_id = ${providerMatchId}');
  });
});

describe('fail-closed reads: no in-transaction SQL failure becomes a default value (§5.9 BG3, §8.2 steps 7/8)', () => {
  /** A transaction whose every query fails, as a missing relation or a broken connection would. */
  const failingTx = (() => Promise.reject(new Error('relation does not exist'))) as unknown as TransactionSql;

  it('a BG3 read error propagates; it never becomes "no entry state names P"', async () => {
    await expect(readEntryStateNamesPlayer(failingTx, M, P)).rejects.toThrow('relation does not exist');
  });

  it('a stat_availability read error propagates, so the byte-identical assertion can never compare two empty defaults', async () => {
    await expect(readStatAvailability(failingTx, 2025)).rejects.toThrow('relation does not exist');
  });

  it('an ISSUE-240 finding read error propagates; it never becomes "zero findings"', async () => {
    await expect(resolveAdjudicatedContradictions(failingTx, CD_I, 'id:P2')).rejects.toThrow('relation does not exist');
  });

  it('the ONLY .catch( left in the tool is the top-level CLI handler, which still reports REFUSED and exits 1', () => {
    const source = toolSource();
    expect(source.match(/\.catch\(/g)).toHaveLength(1);
    const cli = source.slice(source.indexOf('if (invokedDirectly) {'));
    expect(cli).toMatch(/main\(process\.argv\.slice\(2\)\)\s*\.then\(\(code\) => process\.exit\(code\)\)\s*\.catch\(/);
    expect(cli).toContain('console.error(`REFUSED: ${(error as Error).message}`);');
    expect(cli).toContain('process.exit(1);');
  });

  it('Q2 stays one pure evaluator: evaluateCorrectionSatisfactionQ2 awaits nothing and issues no SQL', () => {
    const source = toolSource();
    const evaluator = source.slice(
      source.indexOf('export function evaluateCorrectionSatisfactionQ2('), source.indexOf('function auditMatchIds('),
    );
    expect(evaluator.length).toBeGreaterThan(500);
    expect(evaluator).not.toMatch(/\bawait\b|\btx`|\breader\./);
  });
});

/* ==================================================================== *
 * §5.11 DP-4 (case 85)
 * ==================================================================== */

describe('§5.11 DP-4: match-less dependents keep their loader-justifying participation, or STOP', () => {
  const dependent = (over: Partial<MatchLessDependent> = {}): MatchLessDependent => ({
    table: 'after_siren_kicks', id: 1, playerId: P, season: 2025, clubOrganizationId: 3, ...over,
  });
  const participation = (pmsRowId: number, season: number, clubOrganizationId: number | null): ParticipationRow => ({ pmsRowId, season, clubOrganizationId });
  const affected = new Set([2025]);
  const run = (dependents: MatchLessDependent[], rows: ParticipationRow[], removed: number[]) => evaluateMatchLessDependentParticipation({
    pId: P, pPrimeId: P2, affectedSeasons: affected, dependents, pParticipation: rows, removedPlayerMatchStatsRowIds: new Set(removed),
  });

  it('case 85: the MOVE removes P\'s last justifying participation -> DP-4 STOP dependent_record_would_be_stale', () => {
    const verdict = run([dependent()], [participation(11, 2025, 3)], [11]);
    expect(verdict.losesParticipation).toHaveLength(1);
    const result = evaluateDependents({
      afterSirenKicksRowForP: false, achievementRowForP: false, unresolvedRowAtMatch: false,
      matchLessDependentLosesParticipation: verdict.losesParticipation.length > 0,
      matchLessDependentParticipationRemains: false, firstKickGoalTieBreakChanges: false,
    });
    expect(result.stops.map((s) => `${s.step}:${s.code}`)).toEqual(['DP-4:dependent_record_would_be_stale']);
  });

  it('case 85: participation for the same club organisation and season remains -> reported, not stopped', () => {
    const verdict = run([dependent()], [participation(11, 2025, 3), participation(12, 2025, 3)], [11]);
    expect(verdict.losesParticipation).toHaveLength(0);
    expect(verdict.participationRemains).toHaveLength(1);
  });

  it('participation that remains only for another club organisation, or another season, does not justify it -> STOP', () => {
    expect(run([dependent()], [participation(11, 2025, 3), participation(12, 2025, 4)], [11]).losesParticipation).toHaveLength(1);
    expect(run([dependent()], [participation(11, 2025, 3), participation(12, 2024, 3)], [11]).losesParticipation).toHaveLength(1);
  });

  it('a dependent or participation row naming no club can never justify the resolution (stricter than the loader)', () => {
    expect(run([dependent({ clubOrganizationId: null })], [participation(12, 2025, 3)], []).losesParticipation).toHaveLength(1);
    expect(run([dependent()], [participation(12, 2025, null)], []).losesParticipation).toHaveLength(1);
  });

  it('P′ dependents are reported; dependents outside the affected seasons are not examined', () => {
    const verdict = run([dependent({ playerId: P2, id: 2 }), dependent({ season: 2019, id: 3 })], [], []);
    expect(verdict.pPrimeReported.map((d) => d.id)).toEqual([2]);
    expect(verdict.losesParticipation).toHaveLength(0);
  });

  it('is never looser than the literal rule: exhaustive differential against an independent oracle', () => {
    // Literal §5.11 DP-4: STOP iff, after removing every MOVE/DELETE closure row, P has no
    // player_match_stats participation in the dependent's season for the dependent's club.
    const seasons = [2024, 2025];
    const orgs: (number | null)[] = [3, 4, null];
    const cells = seasons.flatMap((season) => orgs.map((org) => ({ season, org })));
    let checked = 0;
    for (let mask = 0; mask < 1 << cells.length; mask += 1) {
      const rows = cells.flatMap((cell, i) => ((mask >> i) & 1 ? [participation(100 + i, cell.season, cell.org)] : []));
      for (let removedMask = 0; removedMask < 1 << rows.length; removedMask += 1) {
        const removed = rows.filter((_r, i) => (removedMask >> i) & 1).map((r) => r.pmsRowId);
        for (const org of orgs) {
          const d = dependent({ clubOrganizationId: org });
          const remaining = rows.filter((r) => !removed.includes(r.pmsRowId));
          const oracleStops = !remaining.some((r) => r.season === d.season && r.clubOrganizationId !== null && r.clubOrganizationId === d.clubOrganizationId);
          const implStops = run([d], rows, removed).losesParticipation.length > 0;
          if (oracleStops) expect(implStops).toBe(true); // never looser
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});

/* ==================================================================== *
 * §5.10 SV-0/SV-1/SV-2a (case 82)
 * ==================================================================== */

describe('§5.10 season-total independence: classification and the executable SV-2a predicate', () => {
  const HEADER = 'season,afltables_profile_url,votes,vote_rank,eligible_rank,is_ineligible,is_winner,games,three_vote_games,two_vote_games,one_vote_games,polling_games,link_status_value,bootstrap_player_id,display_name,legacy_source_record_id';
  const csv = [
    HEADER,
    '2024,players/A/Alpha.html,5,1,1,f,t,20,1,1,0,2,unique,1,Alpha,legacy-1',
    '2025,players/B/Bravo.html,12,1,1,f,t,22,3,1,1,5,unique,2,Bravo,legacy-2',
    '2025,players/C/Charlie.html,3,2,,f,f,,0,1,1,2,resolved,3,Charlie,legacy-3',
  ].join('\n') + '\n';
  const sha = (text: string) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
  const IDENTITY_SHA = 'd'.repeat(64);
  const manifest = { schema_version: 1, artefact: { csv_sha256: sha(csv) }, identity: { csv_sha256: IDENTITY_SHA } };
  const live = (playerId: number, url: string, values: Partial<SeasonTotalLiveRow>): SeasonTotalLiveRow => ({
    sourceKey: 'afltables', sourceRecordId: `brownlow-season:2025:${url}`, playerId,
    votes: null, voteRank: null, eligibleRank: null, isIneligible: null, isWinner: null, games: null,
    threeVoteGames: null, twoVoteGames: null, oneVoteGames: null, pollingGames: null, linkStatusValue: null, ...values,
  });
  const liveRows = [
    live(201, 'players/B/Bravo.html', { votes: 12, voteRank: 1, eligibleRank: 1, isIneligible: false, isWinner: true, games: 22, threeVoteGames: 3, twoVoteGames: 1, oneVoteGames: 1, pollingGames: 5, linkStatusValue: 'unique' }),
    live(202, 'players/C/Charlie.html', { votes: 3, voteRank: 2, eligibleRank: null, isIneligible: false, isWinner: false, games: null, threeVoteGames: 0, twoVoteGames: 1, oneVoteGames: 1, pollingGames: 2, linkStatusValue: 'resolved' }),
  ];
  const resolution = new Map<string, number[]>([['players/B/Bravo.html', [201]], ['players/C/Charlie.html', [202]]]);
  const verdictFor = (over: Partial<Parameters<typeof evaluateSv2aEvidence>[0]>) => evaluateSeasonTotalIndependence(evaluateSv2aEvidence({
    season: 2025, manifest, seasonVotesCsvSha256: sha(csv), seasonVotesCsvText: csv, identityCsvSha256: IDENTITY_SHA,
    liveRows, profileResolution: resolution, ...over,
  }));

  it('case 82: V equal to the schema-1 CSV row-for-row, with both hashes matching -> independent', () => {
    expect(verdictFor({}).independent).toBe(true);
  });

  it.each([
    ['one differing value', { liveRows: [{ ...liveRows[0], games: 21 }, liveRows[1]] }],
    ['NULL vs 0 (empty CSV cell is NULL, never 0)', { liveRows: [liveRows[0], { ...liveRows[1], games: 0 }] }],
    ['a missing row', { liveRows: [liveRows[0]] }],
    ['an extra row', { liveRows: [...liveRows, live(203, 'players/D/Delta.html', { votes: 1 })] }],
    ['a source_record_id that is not the mapped path', { liveRows: [{ ...liveRows[0], sourceRecordId: 'brownlow-season:2025:players/X/X.html' }, liveRows[1]] }],
    ['an unresolvable profile path', { profileResolution: new Map([['players/B/Bravo.html', [201]]]) }],
    ['an ambiguous profile path', { profileResolution: new Map([['players/B/Bravo.html', [201, 299]], ['players/C/Charlie.html', [202]]]) }],
    ['a CSV hash mismatch', { seasonVotesCsvSha256: 'c'.repeat(64) }],
    ['an identity.csv_sha256 mismatch', { identityCsvSha256: 'a'.repeat(64) }],
    ['a missing identity.csv_sha256 field', { manifest: { schema_version: 1, artefact: { csv_sha256: sha(csv) } } }],
    ['a missing CSV file', { seasonVotesCsvText: null, seasonVotesCsvSha256: null }],
    ['a malformed CSV row', { seasonVotesCsvText: csv.replace(',f,t,22,', ',x,t,22,') }],
  ])('case 82: %s -> STOP season_artefact_unprovable', (_label, over) => {
    const verdict = verdictFor(over);
    expect(verdict.independent).toBe(false);
    if (!verdict.independent) expect(verdict.stop.code).toBe('season_artefact_unprovable');
  });

  it('a manifest that is not schema 1 is SV-3', () => {
    const verdict = verdictFor({ manifest: { ...manifest, schema_version: 2 } });
    expect(verdict.independent).toBe(false);
    if (!verdict.independent) expect(verdict.stop.step).toBe('SV-3');
  });

  it('classifies V: empty, current-revision admin-published, artefact, and everything else (stale revision, mixed) SV-3', () => {
    expect(classifySeasonTotals(2025, [], null)).toBe('empty');
    expect(classifySeasonTotals(2025, [{ sourceKey: 'manual_admin_edit', sourceRecordId: 'publish:2025:r3' }], 3)).toBe('admin_published');
    expect(classifySeasonTotals(2025, [{ sourceKey: 'manual_admin_edit', sourceRecordId: 'publish:2025:r2' }], 3)).toBe('unprovable');
    expect(classifySeasonTotals(2025, [{ sourceKey: 'afltables', sourceRecordId: 'brownlow-season:2025:players/B/Bravo.html' }], null)).toBe('artefact');
    expect(classifySeasonTotals(2025, [
      { sourceKey: 'afltables', sourceRecordId: 'brownlow-season:2025:players/B/Bravo.html' },
      { sourceKey: 'manual_admin_edit', sourceRecordId: 'publish:2025:r3' },
    ], 3)).toBe('unprovable');
  });
});

describe('S6-D1/S6-D4 source contract: fingerprint evidence, collision and ORIGINAL identity label', () => {
  const closureSource = () => {
    const source = toolSource();
    return source.slice(source.indexOf('async function buildClosure('), source.indexOf('async function ownerKeyOf('));
  };

  it('ORIGINAL P->P\' is update_in_place for importer-origin AND human-origin (upgrade_in_place is CPC class 2 only)', () => {
    const source = toolSource();
    expect(source).not.toContain('humanOrigin ? \'update_in_place\' : \'upgrade_in_place\'');
    expect(source).not.toMatch(/identityAction: [^\n]*'upgrade_in_place'/);
    expect(source).toMatch(/identityAction: 'update_in_place', manifestOk, lockRows: takeLocks/);
  });

  it('buildClosure populates evidence and collision on BOTH fingerprint row kinds', () => {
    const closure = closureSource();
    const pushes = closure.match(/rows\.push\(\{[\s\S]*?\n    \}\);/g) ?? [];
    expect(pushes).toHaveLength(2);
    for (const push of pushes) {
      expect(push).toContain('evidence: closureEvidence(');
      expect(push).toContain('collision:');
      expect(push).toContain('counterpartRowId');
      expect(push).toContain('counterpartContractSha256: rowContractHash(');
    }
    expect(pushes[0]).toContain("outcome: 'C2'");
    expect(pushes[1]).toContain("outcome: 'C4'");
    expect(pushes[1]).toContain('readCitedPayloadSha256(');
    expect(pushes[0]).toContain('aflApiSourceId, null)');
  });

  it('closureEvidence carries every application id and the latest cited version with the numeric source id', () => {
    const source = toolSource();
    const helper = source.slice(source.indexOf('function closureEvidence('), source.indexOf('function projectContract('));
    expect(helper).toContain('applicationIds: applications.map((a) => a.id)');
    expect(helper).toContain('sourceId: aflApiSourceId');
    expect(helper).toContain('seq: cited.sourceVersionSeq');
    expect(helper).toContain('insertPayloadSha256');
  });
});

describe('formatOutcome (report formatting)', () => {
  const args: CorrectionArgs = {
    mode: 'validate-only', providerId: 'CD_I1', toPlayerId: 42, adminUserId: 7, note: VALID_NOTE,
    evidenceFile: 'evidence.txt', expectDatabase: 'afldb_dev', expectFingerprint: null,
    acknowledgeSurnameDisagreement: false,
  };

  it('formats a STOP outcome naming every stop', () => {
    const text = formatOutcome({
      kind: 'STOP',
      stops: [{ table: 'player_match_stats', rowId: 1, step: 'P6', code: 'brownlow_state_present' }],
      fingerprint: 'abc',
    }, args);
    expect(text).toContain('STOP: 1 stop(s)');
    expect(text).toContain('player_match_stats#1');
    expect(text).toContain('brownlow_state_present');
  });

  it('formats an ALREADY_SATISFIED outcome', () => {
    const text = formatOutcome({ kind: 'ALREADY_SATISFIED', reports: ['CORRECTION SATISFACTION: SAT-1..SAT-5 PASS'] }, args);
    expect(text).toContain('ALREADY_SATISFIED');
    expect(text).toContain('SAT-1..SAT-5 PASS');
  });

  it('formats a PLANNED (validate-only) outcome with the fingerprint', () => {
    const text = formatOutcome({
      kind: 'PLANNED', fingerprint: 'f'.repeat(64),
      plan: {
        plannerVersion: 2, provider: { externalId: 'CD_I1', sourceKey: 'afl_api' },
        authority: { mode: 'ORIGINAL', netState: 'NONE', ledgerId: null, liveIdentityRowId: 1, previousPlayerIdentity: 'p', playerIdentity: 'p2' },
        identityAction: 'update_in_place', rows: [], stops: [],
      },
      reports: ['season 2025: brownlow season-total artefact independence PASS'],
    }, args);
    expect(text).toContain('PLAN OK');
    expect(text).toContain('f'.repeat(64));
  });

  it('formats a COMMITTED outcome with move/delete counts', () => {
    const text = formatOutcome({
      kind: 'COMMITTED', fingerprint: 'g'.repeat(64), adjudicationId: 5, batchId: '99',
      moved: 2, deleted: 1, reports: [],
    }, args);
    expect(text).toContain('COMMITTED');
    expect(text).toContain('moved 2, deleted 1');
    expect(text).toContain('adjudication id 5, batch id 99');
  });
});

/* ==================================================================== *
 * Slice 6 M3a: promotion REPLAY (§8.3, §8.7, §8.8) over the shared mechanics
 * ==================================================================== */

describe('Slice 6 M3a: REPLAY guards, role model and batch contract (§8.7, §8.8)', () => {
  const CANDIDATE = 'afldb_dev_candidate_20260929';
  const HASH = (c: string) => c.repeat(64);

  function replayEntry(overrides: Partial<AflApiCorrectedReplayEntry> = {}): AflApiCorrectedReplayEntry {
    return {
      externalId: 'CD_I1', adjudicationId: 7, adjudicationEvidenceSha256: HASH('a'),
      previousPlayerIdentity: 'players/A/A.html', playerIdentity: 'players/B/B.html',
      candidateClass: 1, predictedIdentityAction: 'update_in_place', plannerVersion: PLANNER_VERSION,
      predictedClosureFingerprint: HASH('f'),
      predictedMutations: {
        moved: { player_match_stats: 2, brownlow_round_votes: 0 },
        deleted: { player_match_stats: 0, brownlow_round_votes: 1 },
      },
      ...overrides,
    };
  }

  type Artefact = Pick<AflApiSupersedeFile, 'environment' | 'candidateDatabase' | 'targetDatabase' | 'correctedReplays'>;
  const artefact = (overrides: Partial<Artefact> = {}): Artefact => ({
    environment: 'dev', candidateDatabase: CANDIDATE, targetDatabase: 'afldb_dev', correctedReplays: [replayEntry()], ...overrides,
  });
  const guards = (overrides: Partial<Parameters<typeof replayPromotionGuardProblems>[0]> = {}) => replayPromotionGuardProblems({
    environment: 'dev', expectDatabase: CANDIDATE, expectRole: 'afldb_owner', artefact: artefact(), ...overrides,
  });

  /** A transaction whose tagged template records its SQL text and answers only the session proof. */
  function fakeTx(database: string, role: string, log: string[]): TransactionSql {
    const tag = (strings: TemplateStringsArray) => {
      const text = strings.join('?');
      log.push(text);
      if (text.includes('current_database()')) return Promise.resolve([{ database, role }]);
      if (text.includes('FROM sources WHERE key')) return Promise.resolve([{ id: 1 }]);
      return Promise.resolve([]);
    };
    return tag as unknown as TransactionSql;
  }

  describe('proveSession is role-aware', () => {
    it('ORIGINAL proves afldb_import and REPLAY proves afldb_owner, on the expected database', async () => {
      await expect(proveSession(fakeTx('afldb_dev', 'afldb_import', []), 'afldb_dev', 'afldb_import')).resolves.toBeUndefined();
      await expect(proveSession(fakeTx(CANDIDATE, 'afldb_owner', []), CANDIDATE, 'afldb_owner')).resolves.toBeUndefined();
    });

    it('refuses the wrong role for the mode and the wrong database', async () => {
      await expect(proveSession(fakeTx(CANDIDATE, 'afldb_import', []), CANDIDATE, 'afldb_owner'))
        .rejects.toThrow(/session role is 'afldb_import', not 'afldb_owner'/);
      await expect(proveSession(fakeTx('afldb_dev', 'afldb_owner', []), 'afldb_dev', 'afldb_import'))
        .rejects.toThrow(/session role is 'afldb_owner', not 'afldb_import'/);
      await expect(proveSession(fakeTx('afldb_dev', 'afldb_owner', []), CANDIDATE, 'afldb_owner'))
        .rejects.toThrow(/connected database is 'afldb_dev'/);
    });
  });

  describe('parseReplayPromotionArgs and resolveCandidateDsn', () => {
    const argv = (extra: string[] = []) => [
      '--replay-promotion', '--supersede-in', 'e.json', '--environment', 'dev',
      '--expect-database', CANDIDATE, '--expect-role', 'afldb_owner', ...extra,
    ];

    it('parses a valid invocation, with --dry-run optional', () => {
      expect(parseReplayPromotionArgs(argv())).toEqual({
        dryRun: false, supersedeIn: 'e.json', environment: 'dev', expectDatabase: CANDIDATE, expectRole: 'afldb_owner',
      });
      expect(parseReplayPromotionArgs(argv(['--dry-run'])).dryRun).toBe(true);
    });

    it('requires every flag, only afldb_owner, dev|prod, and refuses ORIGINAL flags and a generic DSN selector', () => {
      expect(() => parseReplayPromotionArgs(argv().filter((a) => a !== '--supersede-in' && a !== 'e.json'))).toThrow(CorrectionRefused);
      expect(() => parseReplayPromotionArgs(argv().map((a) => (a === 'afldb_owner' ? 'afldb_import' : a)))).toThrow(/afldb_owner/);
      expect(() => parseReplayPromotionArgs(argv().map((a) => (a === 'dev' ? 'staging' : a)))).toThrow(/dev or prod/);
      expect(() => parseReplayPromotionArgs(argv(['--apply']))).toThrow(/Unknown argument/);
      expect(() => parseReplayPromotionArgs(argv(['--dsn-env', 'AFLDB_IMPORT_DATABASE_URL']))).toThrow(/Unknown argument/);
    });

    it('reads CANDIDATE_DSN only: the import DSN is never a fallback', () => {
      const candidate = `postgresql://afldb_owner:pw@localhost:5432/${CANDIDATE}`;
      expect(resolveCandidateDsn({ CANDIDATE_DSN: candidate }, CANDIDATE)).toBe(candidate);
      expect(() => resolveCandidateDsn({ AFLDB_IMPORT_DATABASE_URL: candidate }, CANDIDATE)).toThrow(/CANDIDATE_DSN is not set/);
      expect(() => resolveCandidateDsn({ CANDIDATE_DSN: candidate }, 'afldb_dev')).toThrow(/does not target \/afldb_dev/);
      expect(() => resolveCandidateDsn({ CANDIDATE_DSN: 'mysql://x/y' }, 'y')).toThrow(/not a postgresql/);
    });
  });

  describe('replayPromotionGuardProblems / assertReplayPromotionGuards', () => {
    it('a candidate database, the owner role, a matching environment and a dev corrected replay pass', () => {
      expect(guards()).toEqual([]);
      expect(() => assertReplayPromotionGuards({ environment: 'dev', expectDatabase: CANDIDATE, expectRole: 'afldb_owner', artefact: artefact() })).not.toThrow();
    });

    it('refuses a database other than the artefact candidateDatabase', () => {
      expect(guards({ expectDatabase: 'afldb_dev_candidate_other' }).join('|')).toMatch(/not the artefact candidateDatabase/);
    });

    it('refuses any role other than afldb_owner', () => {
      expect(guards({ expectRole: 'afldb_import' }).join('|')).toMatch(/not 'afldb_owner'/);
    });

    it('refuses the environment\'s live database, both live names, and the artefact targetDatabase', () => {
      const live = guards({ expectDatabase: 'afldb_dev', artefact: artefact({ candidateDatabase: 'afldb_dev' }) }).join('|');
      expect(live).toMatch(/is a live database/);
      expect(live).toMatch(/is the artefact targetDatabase/);
      expect(guards({ expectDatabase: 'afldb_prod', artefact: artefact({ candidateDatabase: 'afldb_prod' }) }).join('|')).toMatch(/is a live database/);
      const target = guards({ artefact: artefact({ targetDatabase: CANDIDATE }) }).join('|');
      expect(target).toMatch(/is the artefact targetDatabase/);
    });

    it('refuses a pre_rebuild database', () => {
      expect(isPreRebuildDatabaseName('afldb_prod_pre_rebuild_20260929')).toBe(true);
      expect(isPreRebuildDatabaseName(CANDIDATE)).toBe(false);
      const db = 'afldb_dev_pre_rebuild_20260929';
      expect(guards({ expectDatabase: db, artefact: artefact({ candidateDatabase: db }) }).join('|')).toMatch(/pre_rebuild/);
    });

    it('refuses an artefact for the other environment', () => {
      expect(guards({ environment: 'prod' }).join('|')).toMatch(/does not match --environment 'prod'/);
    });

    it('S6-D3: prod + non-empty correctedReplays is CORRECTED_PROMOTION_REHEARSAL_REQUIRED; prod with none, and dev with some, are not', () => {
      const prod = guards({ environment: 'prod', artefact: artefact({ environment: 'prod' }) });
      expect(prod.join('|')).toContain(CORRECTED_PROMOTION_REHEARSAL_REQUIRED);
      expect(() => assertReplayPromotionGuards({
        environment: 'prod', expectDatabase: CANDIDATE, expectRole: 'afldb_owner', artefact: artefact({ environment: 'prod' }),
      })).toThrow(CORRECTED_PROMOTION_REHEARSAL_REQUIRED);
      expect(guards({ environment: 'prod', artefact: artefact({ environment: 'prod', correctedReplays: [] }) })).toEqual([]);
      expect(CORRECTED_PROMOTION_REQUIRES_FREEZE).toBe('CORRECTED_PROMOTION_REQUIRES_FREEZE');
    });

    it('S6-D3 and every guard fire BEFORE any SQL: a refused REPLAY issues no statement at all', async () => {
      const log: string[] = [];
      const file = { ...artefact({ environment: 'prod' }) } as unknown as AflApiSupersedeFile;
      await expect(runReplayPromotion(fakeTx(CANDIDATE, 'afldb_owner', log), {
        dryRun: false, supersedeIn: 'e.json', environment: 'prod', expectDatabase: CANDIDATE, expectRole: 'afldb_owner',
      }, file)).rejects.toThrow(CORRECTED_PROMOTION_REHEARSAL_REQUIRED);
      expect(log).toEqual([]);
    });
  });

  describe('the artefact is reproduced exactly, or REPLAY refuses (§8.3 steps 2-4, 8)', () => {
    const pass = (overrides: Partial<Extract<CpcResult, { outcome: 'PASS' }>> = {}): CpcResult => ({
      outcome: 'PASS', externalId: 'CD_I1', adjudicationId: 7, candidateClass: 1,
      predictedIdentityAction: 'update_in_place', providerRowId: 5, plannerVersion: PLANNER_VERSION,
      predictedClosureFingerprint: HASH('f'),
      predictedMutations: {
        moved: { player_match_stats: 2, brownlow_round_votes: 0 },
        deleted: { player_match_stats: 0, brownlow_round_votes: 1 },
      },
      ...overrides,
    });

    it('an identical PASS has no mismatch', () => {
      expect(replayEntryMismatches(replayEntry(), pass(), PLANNER_VERSION)).toEqual([]);
    });

    it('class, identity action, fingerprint, counts and both plannerVersions each refuse', () => {
      expect(replayEntryMismatches(replayEntry(), pass({ candidateClass: 2 }), PLANNER_VERSION).join('|')).toMatch(/class 2 != artefact class 1/);
      expect(replayEntryMismatches(replayEntry(), pass({ predictedIdentityAction: 'insert' }), PLANNER_VERSION).join('|')).toMatch(/identity action insert/);
      expect(replayEntryMismatches(replayEntry(), pass({ predictedClosureFingerprint: HASH('e') }), PLANNER_VERSION).join('|')).toMatch(/closure fingerprint/);
      expect(replayEntryMismatches(replayEntry(), pass({
        predictedMutations: { moved: { player_match_stats: 3, brownlow_round_votes: 0 }, deleted: { player_match_stats: 0, brownlow_round_votes: 1 } },
      }), PLANNER_VERSION).join('|')).toMatch(/mutation counts differ/);
      expect(replayEntryMismatches(replayEntry({ plannerVersion: PLANNER_VERSION + 1 }), pass(), PLANNER_VERSION).join('|')).toMatch(/running plannerVersion/);
      expect(replayEntryMismatches(replayEntry(), pass({ plannerVersion: PLANNER_VERSION + 1 }), PLANNER_VERSION).join('|')).toMatch(/classification plannerVersion/);
    });

    it('a CPC FAIL (DISAGREE, COLLISION, PREDICT STOP, ...) is a refusal that names the code', () => {
      const fail: CpcResult = {
        outcome: 'FAIL', externalId: 'CD_I1', adjudicationId: 7, candidateClass: 5, code: 'COLLISION', detail: "candidate importer provider(s) at P'c: CD_X",
      };
      expect(replayEntryMismatches(replayEntry(), fail, PLANNER_VERSION)[0]).toMatch(/CPC FAIL COLLISION \(class 5\)/);
    });

    const corrected = (over: Partial<AflApiAdjudicationLedgerRow> = {}): AflApiAdjudicationLedgerRow => ({
      id: 7, externalId: 'CD_I1', action: 'corrected', playerId: 900, playerIdentity: 'players/B/B.html',
      supersedesId: null, previousPlayerIdentity: 'players/A/A.html', evidenceSha256: HASH('a'), ...over,
    });
    const fileFor = (rows: readonly AflApiAdjudicationLedgerRow[], entries = [replayEntry()]) => ({
      correctedReplays: entries, targetLedgerRowCount: rows.length, targetLedgerSha256: aflApiLedgerStateSha256(rows),
    });

    it('the net CORRECTED set must equal correctedReplays exactly, and the ledger must be the artefact\'s', () => {
      const rows = [corrected()];
      expect(replayLedgerProblems(rows, fileFor(rows))).toEqual([]);
      expect(replayLedgerProblems(rows, fileFor(rows, []) ).join('|')).toMatch(/not in correctedReplays/);
      expect(replayLedgerProblems([], { ...fileFor(rows), targetLedgerRowCount: 0, targetLedgerSha256: aflApiLedgerStateSha256([]) }).join('|'))
        .toMatch(/not net CORRECTED in the reinstated ledger/);
      expect(replayLedgerProblems(rows, { ...fileFor(rows), targetLedgerSha256: HASH('0') }).join('|')).toMatch(/ledger digest differs/);
      expect(replayLedgerProblems(rows, { ...fileFor(rows), targetLedgerRowCount: 2 }).join('|')).toMatch(/row count 1 != artefact/);
      expect(replayLedgerProblems(rows, fileFor(rows, [replayEntry({ adjudicationId: 8 })])).join('|')).toMatch(/adjudication id 7 != artefact 8/);
    });

    it('a second (or replaced) corrected row for A is refused', () => {
      expect(replayNoSecondCorrectedProblems([corrected()], [replayEntry()])).toEqual([]);
      expect(replayNoSecondCorrectedProblems([corrected(), corrected({ id: 8 })], [replayEntry()]).join('|')).toMatch(/found 2/);
      expect(replayNoSecondCorrectedProblems([corrected({ id: 9 })], [replayEntry()]).join('|')).toMatch(/expected exactly one/);
    });

    it('the post-replay importer, resolved and identity state must equal the prediction', () => {
      const importer = { rowCount: 1, sha256: aflApiImporterStateSha256([{ externalId: 'CD_A', status: 'unique', matchMethod: 'afl_api_stat_vector_season', playerIdentity: 'players/A/A.html' }]) };
      const identity = { rowCount: 2, sha256: aflApiIdentityStateSha256([{ externalId: 'CD_A', status: 'unique', matchMethod: 'afl_api_stat_vector_season', playerIdentity: null }]) };
      const file = {
        predictedPostReplayImporterRowCount: 1, predictedPostReplayImporterSha256: importer.sha256,
        predictedPostReplayResolvedRowCount: 1, predictedPostReplayIdentitySha256: identity.sha256,
      };
      expect(replayPostStateProblems({ importer, identity, resolvedRowCount: 1 }, file)).toEqual([]);
      expect(replayPostStateProblems({ importer, identity, resolvedRowCount: 2 }, file).join('|')).toMatch(/resolved row count 2 != predicted 1/);
      expect(replayPostStateProblems({ importer: { ...importer, sha256: HASH('0') }, identity, resolvedRowCount: 1 }, file).join('|')).toMatch(/importer state digest/);
      expect(replayPostStateProblems({ importer, identity: { ...identity, sha256: HASH('0') }, resolvedRowCount: 1 }, file).join('|')).toMatch(/identity state digest/);
    });
  });

  describe('batch contract (§8.7): K and R differ only in mode, context, notes and predictedClosureFingerprint', () => {
    it('ORIGINAL batch K is unchanged: original / live_target / no predicted fingerprint / the ISSUE-238 correction notes', () => {
      expect(ORIGINAL_BATCH_CONTRACT.mode).toBe('original');
      expect(ORIGINAL_BATCH_CONTRACT.context).toBe('live_target');
      expect(ORIGINAL_BATCH_CONTRACT.predictedClosureFingerprint).toBeNull();
      expect(ORIGINAL_BATCH_CONTRACT.openNotes).toBe('AFLDB-ISSUE-238 correction; authority afl_api_identity_adjudications id <pending>');
      expect(ORIGINAL_BATCH_CONTRACT.boundNotes(9)).toBe('AFLDB-ISSUE-238 correction; authority afl_api_identity_adjudications id 9');
    });

    it('REPLAY batch R is replay / promotion, carries predictedClosureFingerprint, and the promotion replay notes', () => {
      const contract = replayBatchContract(HASH('c'));
      expect(contract.mode).toBe('replay');
      expect(contract.context).toBe('promotion');
      expect(contract.predictedClosureFingerprint).toBe(HASH('c'));
      expect(contract.boundNotes(9)).toBe('AFLDB-ISSUE-238 promotion replay; authority afl_api_identity_adjudications id 9');
    });

    it('source contract: one validation_result builder serves both, and predictedClosureFingerprint is REPLAY-only', () => {
      const source = toolSource();
      const builder = source.slice(source.indexOf('function correctionBatchValidationResult('), source.indexOf('function correctionCountsFor('));
      expect(builder).toContain("kind: 'afl_api_identity_correction', mode: contract.mode, context: contract.context");
      expect(builder).toContain('closureFingerprint: input.closureFingerprint');
      expect(builder).toContain("mutationEligibility: 'PASS'");
      expect(builder).toContain('contract.predictedClosureFingerprint === null ? {} : { predictedClosureFingerprint: contract.predictedClosureFingerprint }');
      const original = source.slice(source.indexOf('async function runCorrection('), source.indexOf('function correctionBatchValidationResult('));
      expect(original).toContain('correctionBatchValidationResult(ORIGINAL_BATCH_CONTRACT');
      expect(original).toContain('openCorrectionBatch(tx, closure.rows.length, ORIGINAL_BATCH_CONTRACT.openNotes)');
      expect(original).toContain("proveSession(tx, args.expectDatabase, 'afldb_import')");
    });
  });

  describe('REPLAY source contracts (§8.8 allow-list, F-005)', () => {
    const source = toolSource();
    const between = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end));
    const replaySection = between('REPLAY_SECTION_BEGIN', 'REPLAY_SECTION_END');
    const sharedMechanics = between('Shared mechanics: ONE implementation', 'export async function readStatAvailability(');
    const cpcSection = between('§5.1 / §9.1: planning and CPC classification', '§8.2: the ORIGINAL transaction');
    const replayReachable = [replaySection, sharedMechanics, cpcSection].join('\n');

    it('the sections are found and non-trivial', () => {
      expect(replaySection.length).toBeGreaterThan(5000);
      expect(sharedMechanics.length).toBeGreaterThan(3000);
      expect(cpcSection.length).toBeGreaterThan(3000);
    });

    it('REPLAY reads CANDIDATE_DSN and never references the import DSN, resolveImportDsn or the .env loader', () => {
      expect(replaySection).toContain('env.CANDIDATE_DSN');
      expect(replaySection).not.toContain('AFLDB_IMPORT_DATABASE_URL');
      expect(replaySection).not.toContain('resolveImportDsn');
      expect(replaySection).not.toMatch(/\bloadEnv\(/);
      expect(replaySection).toContain("proveSession(tx, args.expectDatabase, 'afldb_owner')");
      const main = source.slice(source.indexOf('async function main('));
      expect(main.indexOf("argv.includes('--replay-promotion')")).toBeGreaterThan(0);
      expect(main.indexOf("argv.includes('--replay-promotion')")).toBeLessThan(main.indexOf('loadEnv(REPO_ROOT)'));
    });

    it('ORIGINAL still resolves AFLDB_IMPORT_DATABASE_URL through resolveImportDsn', () => {
      const original = source.slice(source.indexOf('async function main('));
      expect(original).toContain('resolveImportDsn(process.env, args.expectDatabase)');
      expect(source.slice(source.indexOf('export function resolveImportDsn('), source.indexOf('export type CorrectionSessionRole'))).toContain('env.AFLDB_IMPORT_DATABASE_URL');
    });

    it('nothing REPLAY can reach writes afl_api_identity_adjudications or resolves findings', () => {
      expect(replayReachable).not.toMatch(/INSERT\s+INTO\s+afl_api_identity_adjudications/);
      expect(replayReachable).not.toMatch(/UPDATE\s+afl_api_identity_adjudications/);
      expect(replayReachable).not.toMatch(/DELETE\s+FROM\s+afl_api_identity_adjudications/);
      expect(replaySection).not.toContain('resolveAdjudicatedContradictions');
      expect(replaySection).not.toMatch(/\bdata_issues\b.*\bSET\b/);
    });

    it('every write statement REPLAY can reach targets an allow-listed table', () => {
      const inserts = [...replayReachable.matchAll(/INSERT\s+INTO\s+([a-z_.]+)/g)].map((m) => m[1]);
      expect(new Set(inserts)).toEqual(new Set(['canonical_applications', 'import_batches', 'external_identities']));
      const updates = [...replayReachable.matchAll(/UPDATE\s+(\$\{tx\(row\.table\)\}|[a-z_.]+)\s+SET/g)].map((m) => m[1]);
      expect(new Set(updates)).toEqual(new Set([
        'import_batches', 'external_identities', '${tx(row.table)}', 'staging.afl_api_player_match', 'staging.afl_api_brownlow_vote',
      ]));
      const deletes = [...replayReachable.matchAll(/DELETE\s+FROM\s+(\$\{tx\(row\.table\)\}|[a-z_.]+)/g)].map((m) => m[1]);
      expect(new Set(deletes)).toEqual(new Set(['${tx(row.table)}']));
    });

    it('a batch is opened only when the closure has a MOVE or DELETE, and only once in REPLAY', () => {
      expect(replaySection.match(/openCorrectionBatch\(/g)).toHaveLength(1);
      expect(replaySection).toMatch(
        /if \(closureRows\.length > 0\) \{\s+batchId = await openCorrectionBatch\(tx, closureRows\.length, contract\.openNotes\);\s+await bindCorrectionBatch\(/,
      );
      expect(replaySection).toMatch(/\} else \{\s+projectionsMoved = await moveProviderProjections\(/);
    });

    it('ALREADY_REPLAYED: a resolved D15-shape row at P′c whose Q2 passes is skipped before classification and writes nothing', () => {
      const detect = between('async function detectAlreadyReplayed(', 'async function writeReplayedIdentity(');
      expect(detect).toContain("row.status !== 'resolved' || row.matchMethod !== AFL_API_ADMIN_MATCH_METHOD || row.candidateCount !== 0");
      expect(detect).toContain('pPrime.playerId !== row.playerId');
      expect(detect).toContain('checkCorrectionSatisfaction(dbCorrectionSatisfactionReader(tx)');
      expect(detect).not.toMatch(/\b(INSERT|UPDATE|DELETE|LOCK)\b/);
      const run = between('export async function runReplayPromotion(', 'export function formatReplayOutcome(');
      expect(run.indexOf('if (already.has(entry.externalId)) continue;')).toBeGreaterThan(0);
      expect(run.indexOf('if (already.has(entry.externalId)) continue;')).toBeLessThan(run.indexOf('classifyCorrectedProviderInDatabase('));
    });

    it('REPLAY classifies under ADJUDICATION authority with row locks, then requires class, version and fingerprint', () => {
      const run = between('export async function runReplayPromotion(', 'export function formatReplayOutcome(');
      expect(run).toContain("authorityMode: 'ADJUDICATION', lockRows: true");
      expect(run).toContain('replayEntryMismatches(entry, classified.result, PLANNER_VERSION)');
      expect(run).toContain('replayLedgerProblems(ledgerRows, file)');
      expect(run).toContain('replayPostStateProblems(post, file)');
      expect(run).toContain('replayNoSecondCorrectedProblems(ledgerAfter, entries)');
      expect(run).toContain('aflApiLedgerStateSha256(ledgerAfter) !== h0');
    });

    it('no catch inside any REPLAY transaction callback, and the tool still has exactly one .catch(', () => {
      const run = between('export async function runReplayPromotion(', 'export function formatReplayOutcome(');
      expect(run).not.toMatch(/\bcatch\b/);
      const cli = between('export async function runReplayPromotionCli(', 'REPLAY_SECTION_END');
      const dryCallback = cli.slice(cli.indexOf('async (tx) => {'), cli.indexOf('});'));
      expect(dryCallback).not.toMatch(/\bcatch\b/);
      expect(source.match(/\.catch\(/g)).toHaveLength(1);
    });

    it('predictCorrectionClosure never proves the session or takes a table/advisory lock, and takes lockRows from the caller', () => {
      const predict = between('export async function predictCorrectionClosure(', 'export async function resolveCandidateIdentity(');
      expect(predict).not.toMatch(/proveSession|takeIdentityTableLock|takeCorrectionLocks|LOCK TABLE|pg_advisory|FOR UPDATE/);
      expect(predict).toContain('lockRows: input.lockRows');
      expect(predict).toContain('mutationPlanFingerprint(closure.plan)');
    });
  });

  describe('REPLAY with an empty correctedReplays writes nothing (fake transaction)', () => {
    it('validates role and database, reads the ledger, and issues no INSERT/UPDATE/DELETE/LOCK', async () => {
      const log: string[] = [];
      const importerSha = aflApiImporterStateSha256([]);
      const file = {
        environment: 'dev', candidateDatabase: CANDIDATE, targetDatabase: 'afldb_dev', correctedReplays: [],
        targetLedgerRowCount: 0, targetLedgerSha256: aflApiLedgerStateSha256([]),
        predictedPostReplayImporterRowCount: 0, predictedPostReplayImporterSha256: importerSha,
        predictedPostReplayResolvedRowCount: 0, predictedPostReplayIdentitySha256: aflApiIdentityStateSha256([]),
      } as unknown as AflApiSupersedeFile;
      const outcome = await runReplayPromotion(fakeTx(CANDIDATE, 'afldb_owner', log), {
        dryRun: false, supersedeIn: 'e.json', environment: 'dev', expectDatabase: CANDIDATE, expectRole: 'afldb_owner',
      }, file);
      expect(outcome.kind).toBe('NOTHING_TO_REPLAY');
      expect(outcome.providers).toEqual([]);
      expect(log.length).toBeGreaterThan(2);
      expect(log.filter((text) => /\b(INSERT|UPDATE|DELETE|LOCK)\b/i.test(text))).toEqual([]);
    });

    it('refuses a wrong session role before reading anything else', async () => {
      const log: string[] = [];
      const file = { ...artefact({ correctedReplays: [] }) } as unknown as AflApiSupersedeFile;
      await expect(runReplayPromotion(fakeTx(CANDIDATE, 'afldb_import', log), {
        dryRun: false, supersedeIn: 'e.json', environment: 'dev', expectDatabase: CANDIDATE, expectRole: 'afldb_owner',
      }, file)).rejects.toThrow(/session role is 'afldb_import', not 'afldb_owner'/);
      expect(log).toHaveLength(1);
    });
  });
});
