import {
  mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type postgres from 'postgres';
import {
  afterEach, beforeEach, describe, expect, it,
} from 'vitest';

import { emptyAflApiBrownlowCounters, runSettleAflApiBrownlow } from '@/lib/acquisition/afl-api-brownlow';
import {
  proveAflApiIngestionPreflight,
  requireSameAflApiDatabase,
} from '@/lib/acquisition/afl-api-ingestion-safety';
import type { CanonicalApplyTargetInput } from '@/lib/acquisition/canonical-apply';
import { missingAflApiSeasonEnumeration } from '@/lib/acquisition/afl-api-season-enumeration';
import { POSSIBLE_EXISTING_MATCH } from '@/lib/acquisition/match-rekey';
import type { JsonValue } from '@/lib/acquisition/observations';
import { baselineCanonicalHash } from '@/lib/acquisition/promotion-review';
import { diffFields } from '@/lib/acquisition/reconciliation';
import {
  automaticApplyTargets,
  normaliseAflApiCountersAfterFullRollback,
  runSettleAflApi,
  type AflApiSettleBundle,
  type AflApiSettleCounters,
} from '@/lib/acquisition/settle-afl-api';
import {
  applySeasonGateIssueKey,
  canonicalApplyIssueKey,
  clearMatchIdentityFinding,
  clearSeasonGateFinding,
  closeApplyFindingIfOpen,
  describeApplyRefusal,
  draftApplyRefusalIssue,
  draftMatchIdentityIssue,
  emptySettleCounters,
  finalizeSettleImportBatch,
  MATCH_IDENTITY_FIELDS,
  MATCH_IDENTITY_REFUSAL,
  matchIdentityIssueKey,
  newApplyFindingLedger,
  recordApplyOutcomeFindings,
  recordMatchIdentityFinding,
  SettleCoreError,
  settleImportBatchTerminalFields,
  splitMatchIdentityChange,
  type ApplyFindingScope,
  type MatchIdentityIssueInput,
} from '@/lib/acquisition/settle-core';
import { asImportBatchId } from '@/lib/import-batch-id';
import { parseSourceFamilyRegistry } from '@/lib/acquisition/source-families';
import { loadEnv, SKIP_DOTENV_ENV } from '../tools/current-season/load-env';

const ROOT = join(__dirname, '..');
const readSource = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

describe('AFLDB-ISSUE-244 F005 — deployed AFL API service gate environment', () => {
  for (const unitPath of [
    'deploy/afldb-settle-afl-api.service',
    'deploy/afldb-settle-afl-api-brownlow.service',
  ]) {
    it(`${unitPath} retains DATABASE_URL but still treats the writer connection as a distinct supplied secret`, () => {
      const unit = readSource(unitPath);
      expect(unit).not.toMatch(/^\s*UnsetEnvironment=.*\bDATABASE_URL\b/m);
      expect(unit).toMatch(/^EnvironmentFile=/m);
      expect(unit).not.toMatch(/^\s*UnsetEnvironment=.*\bAFLDB_IMPORT_DATABASE_URL\b/m);
    });
  }
});

describe('AFLDB-ISSUE-244 F016 — live database identity invariant', () => {
  it('allows distinct roles on the same live database', () => {
    expect(() => requireSameAflApiDatabase(
      { database: 'afldb_test', role: 'afldb_app' },
      { database: 'afldb_test', role: 'afldb_import' },
    )).not.toThrow();
  });

  it('refuses a different live writer database and names databases without exposing DSNs', () => {
    expect(() => requireSameAflApiDatabase(
      { database: 'afldb_dev', role: 'afldb_app' },
      { database: 'afldb_test', role: 'afldb_import' },
    )).toThrow(/afldb_dev.*afldb_test/);
    try {
      requireSameAflApiDatabase(
        { database: 'afldb_dev', role: 'afldb_app' },
        { database: 'afldb_test', role: 'afldb_import' },
      );
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain('postgresql://');
    }
  });
});

describe('AFLDB-ISSUE-244 F016 — both canonical writer CLIs preflight before settle', () => {
  for (const [path, settleCall] of [
    ['tools/current-season/settle-afl-api.ts', 'runSettleAflApi(sql,'],
    ['tools/current-season/settle-afl-api-brownlow.ts', 'runSettleAflApiBrownlow(sql,'],
  ]) {
    it(`${path} proves live control/writer identity before invoking its canonical settle`, () => {
      const source = readSource(path);
      expect(source.indexOf('proveAflApiIngestionPreflight(sql)'))
        .toBeLessThan(source.indexOf(settleCall));
    });
  }
});

describe('AFLDB-ISSUE-244 F004 — completeness gate wiring and outcome reporting', () => {
  it('passes --require-complete-source into the transactional writer before its commit decision', () => {
    const settle = readSource('src/lib/acquisition/settle-afl-api.ts');
    const cli = readSource('tools/current-season/settle-afl-api.ts');
    expect(cli).toContain('requireCompleteSource: args.requireCompleteSource');
    expect(settle.indexOf('throw new RequireCompleteSourceRollback'))
      .toBeLessThan(settle.indexOf('if (!options.apply) throw new DryRunRollback'));
  });

  it('renders completeness refusal separately from dry-run rollback and committed apply', () => {
    const cli = readSource('tools/current-season/settle-afl-api.ts');
    expect(cli).toContain("result.rollbackReason === 'require_complete_source'");
    expect(cli).toContain('COMPLETENESS GATE REFUSED COMMIT');
    expect(cli).toContain('Dry-run rollback.');
    expect(cli).toContain('Applied as import batch');
  });
});

describe('AFLDB-ISSUE-244 F016 — malformed control DSN safety', () => {
  it('fails closed without echoing a malformed control DSN secret before touching the writer', async () => {
    const secret = 'issue244-malformed-control-secret';
    let writerTouched = false;
    const writerSql = new Proxy(function writerSqlStub() {}, {
      apply() {
        writerTouched = true;
        throw new Error('writer must not be touched for a malformed control DSN');
      },
    }) as unknown as postgres.Sql;

    const error = await proveAflApiIngestionPreflight(
      writerSql,
      { DATABASE_URL: `postgresql://control:${secret}@[::1` },
    ).then(() => null, (failure: unknown) => failure);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      'AFL API ingestion refused: unable to read the control database or prove live writer identity.',
    );
    expect((error as Error).message).not.toContain(secret);
    expect(writerTouched).toBe(false);
  });
});

describe('AFLDB-ISSUE-244 F004 — full rollback counter truth', () => {
  it('zeros durable effects while retaining source, input and planning facts', () => {
    const counters: AflApiSettleCounters = {
      ...emptySettleCounters(),
      snapshotMatches: 7,
      snapshotPlayerMatchRows: 42,
      buildFailures: 3,
      venueProviderUnmapped: 2,
      seasonFeedMatches: 218,
      seasonFeedComplete: 1,
      seasonFeedStatusCounts: { CONCLUDED: 218 },
    };
    Object.assign(counters, {
      payloadsCreated: 1,
      versionsAppended: 2,
      observationsCorrected: 3,
      observationsHistoryOnly: 4,
      observationsMarkedAbsent: 5,
      observationsReappeared: 6,
      projectionRowsWritten: 7,
      candidatesCreated: 8,
      candidatesRefreshed: 9,
      dataIssuesOpened: 10,
      dataIssuesRefreshed: 11,
      dataIssuesResolved: 12,
      canonicalRowsInserted: 13,
      canonicalRowsUpdated: 14,
      canonicalApplicationsLogged: 15,
      attendanceEnrichmentsApplied: 16,
      derivedRecomputeRuns: 17,
      derivedRecomputePlayers: 18,
      observationsSeen: 19,
      payloadsReused: 20,
      observationsUnchanged: 21,
      absenceSweepSkipped: 22,
      unresolvedIdentityPlayer: 23,
      unresolvedIdentityMatch: 24,
      corroboratedForeignOwned: 25,
      canonicalApplyFailures: 26,
      canonicalApplyRefusals: 27,
      candidatesMootLeftPending: 28,
      recordsDeferred: { awaiting_identity: 29 },
    });

    normaliseAflApiCountersAfterFullRollback(counters);

    for (const counter of [
      'payloadsCreated', 'versionsAppended', 'observationsCorrected',
      'observationsHistoryOnly', 'observationsMarkedAbsent', 'observationsReappeared',
      'projectionRowsWritten', 'candidatesCreated', 'candidatesRefreshed',
      'dataIssuesOpened', 'dataIssuesRefreshed', 'dataIssuesResolved',
      'canonicalRowsInserted', 'canonicalRowsUpdated', 'canonicalApplicationsLogged',
      'attendanceEnrichmentsApplied', 'derivedRecomputeRuns', 'derivedRecomputePlayers',
    ] as const) {
      expect(counters[counter]).toBe(0);
    }
    expect(counters).toMatchObject({
      snapshotMatches: 7,
      snapshotPlayerMatchRows: 42,
      buildFailures: 3,
      venueProviderUnmapped: 2,
      // AFLDB-ISSUE-231: the season feed is an input fact, retained on a rollback.
      seasonFeedMatches: 218,
      seasonFeedComplete: 1,
      seasonFeedStatusCounts: { CONCLUDED: 218 },
      observationsSeen: 19,
      payloadsReused: 20,
      observationsUnchanged: 21,
      absenceSweepSkipped: 22,
      unresolvedIdentityPlayer: 23,
      unresolvedIdentityMatch: 24,
      corroboratedForeignOwned: 25,
      canonicalApplyFailures: 26,
      canonicalApplyRefusals: 27,
      candidatesMootLeftPending: 28,
      recordsDeferred: { awaiting_identity: 29 },
    });
  });
});

/* ------------------------------------------------------------------ *
 * AFLDB-ISSUE-244 F008 — import_batches terminal lifecycle
 * ------------------------------------------------------------------ */

describe('AFLDB-ISSUE-244 F008 — terminal batch field mapping (pure)', () => {
  it('maps a committed run: completed, versions appended -> records_inserted, canonical counters kept in validation_result', () => {
    const counters: AflApiSettleCounters = {
      ...emptySettleCounters(), snapshotMatches: 4, snapshotPlayerMatchRows: 90, buildFailures: 0, venueProviderUnmapped: 0,
      seasonFeedMatches: 0, seasonFeedComplete: 0, seasonFeedStatusCounts: {},
      observationsSeen: 7, versionsAppended: 5, observationsUnchanged: 2,
      canonicalRowsInserted: 3, canonicalRowsUpdated: 1, canonicalApplicationsLogged: 4,
    };
    const fields = settleImportBatchTerminalFields(counters, 1);
    expect(fields).toMatchObject({
      status: 'completed', recordsInserted: 5, recordsUpdated: 0, recordsRejected: 1,
    });
    // The counters travel by reference into validation_result — nothing is re-derived.
    expect(fields.validationResult).toBe(counters);
    expect(fields.validationResult).toMatchObject({
      canonicalRowsInserted: 3, canonicalRowsUpdated: 1, canonicalApplicationsLogged: 4,
    });
  });

  it('counts records_rejected from the persisted import_rejections rows, not from an in-memory counter', () => {
    // Three unresolved-identity counters but only two rejection rows were written
    // (one refusal produced a data_issues row, not an import_rejections row).
    const counters: AflApiSettleCounters = {
      ...emptySettleCounters(), snapshotMatches: 1, snapshotPlayerMatchRows: 3, buildFailures: 0, venueProviderUnmapped: 0,
      seasonFeedMatches: 0, seasonFeedComplete: 0, seasonFeedStatusCounts: {},
      unresolvedIdentityPlayer: 3, versionsAppended: 4,
    };
    expect(settleImportBatchTerminalFields(counters, 2).recordsRejected).toBe(2);
  });

  it('maps an idempotent replay to a terminal zero-change batch — no false inserts, updates or rejections', () => {
    const counters: AflApiSettleCounters = {
      ...emptySettleCounters(), snapshotMatches: 217, snapshotPlayerMatchRows: 9890, buildFailures: 0, venueProviderUnmapped: 0,
      seasonFeedMatches: 0, seasonFeedComplete: 0, seasonFeedStatusCounts: {},
      observationsSeen: 434, versionsAppended: 0, observationsUnchanged: 434,
    };
    expect(settleImportBatchTerminalFields(counters, 0)).toMatchObject({
      status: 'completed', recordsInserted: 0, recordsUpdated: 0, recordsRejected: 0,
    });
    expect(counters).toMatchObject({
      canonicalRowsInserted: 0, canonicalRowsUpdated: 0, canonicalApplicationsLogged: 0,
    });
  });

  it('maps a Brownlow-shaped run: refused vote sets stay in validation_result, only persisted rejection rows are counted', () => {
    const counters = emptyAflApiBrownlowCounters();
    Object.assign(counters, {
      voteSetsSeen: 3, voteSetsPlanned: 2, voteSetsRefused: { unknown_match: 1, match_identity_conflict: 1 },
      observationsSeen: 3, versionsAppended: 3, canonicalRowsInserted: 3, canonicalApplicationsLogged: 3,
    });
    // unknown_match writes an import_rejections row; the apply-time
    // match_identity_conflict writes a data_issues row only.
    const fields = settleImportBatchTerminalFields(counters, 1);
    expect(fields).toMatchObject({ status: 'completed', recordsInserted: 3, recordsUpdated: 0, recordsRejected: 1 });
    expect(fields.validationResult).toMatchObject({
      voteSetsRefused: { unknown_match: 1, match_identity_conflict: 1 }, canonicalRowsInserted: 3,
    });
  });

  it.each([
    ['a negative versions count', { versionsAppended: -1 }, 0],
    ['a fractional versions count', { versionsAppended: 1.5 }, 0],
    ['a NaN versions count', { versionsAppended: Number.NaN }, 0],
    ['a negative rejection count', { versionsAppended: 1 }, -1],
  ])('refuses to finalise from %s', (_label, counters, rejected) => {
    expect(() => settleImportBatchTerminalFields(counters, rejected)).toThrow(SettleCoreError);
  });
});

type BatchStubOptions = {
  /** `import_rejections` rows the stub reports for the batch. */
  rejectionRows?: number;
  /** Rows the finalising UPDATE reports closing (default 1); 0 simulates "no running batch row". */
  closedRows?: number;
  /** Makes the finalising UPDATE itself fail. */
  closeError?: Error;
};

/**
 * A stand-in `postgres.Sql` that answers only the statements a run over an EMPTY
 * bundle issues, records every statement in order, and reports whether the
 * transaction callback committed or rolled back. Anything else is an error, so
 * a new write the run starts making must be taught to this stub deliberately.
 */
function makeBatchLifecycleSql(options: BatchStubOptions = {}) {
  const statements: { text: string; values: unknown[] }[] = [];
  const state: { outcome: 'committed' | 'rolled_back' | null } = { outcome: null };
  const tx = Object.assign(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?').replace(/\s+/g, ' ').trim();
      statements.push({ text, values });
      if (text === 'SELECT id, key FROM sources') return [{ id: 1, key: 'afl_api' }];
      if (text === "SELECT id FROM sources WHERE key = 'afl_api'") return [{ id: 1 }];
      if (text.startsWith('INSERT INTO import_batches')) return [{ id: '42' }];
      if (text.startsWith('SELECT count(*)::int AS n FROM import_rejections')) {
        return [{ n: options.rejectionRows ?? 0 }];
      }
      if (text.startsWith('UPDATE import_batches')) {
        if (options.closeError) throw options.closeError;
        return options.closedRows === 0 ? [] : [{ id: '42' }];
      }
      throw new Error(`unexpected statement in the batch-lifecycle stub: ${text}`);
    },
    { json: (value: unknown) => ({ jsonValue: value }) },
  );
  const sql = {
    begin: async (callback: (t: typeof tx) => Promise<unknown>) => {
      try {
        const result = await callback(tx);
        state.outcome = 'committed';
        return result;
      } catch (error) {
        state.outcome = 'rolled_back';
        throw error;
      }
    },
  } as unknown as postgres.Sql;
  const kinds = () => statements.map((s) => s.text.split(' ').slice(0, 3).join(' '));
  return { sql, statements, state, kinds };
}

const SOURCE_FAMILIES = parseSourceFamilyRegistry(
  JSON.parse(readSource('data/reference/source-families.json')),
);

function emptyBundle(buildFailures: AflApiSettleBundle['buildFailures'] = []): AflApiSettleBundle {
  return {
    snapshotLabel: 'issue244-f008', season: 2026, bundleContractVersion: 2, units: [], buildFailures,
    seasonFeed: missingAflApiSeasonEnumeration(2026, 'CD_S2026014'),
  };
}

describe('AFLDB-ISSUE-244 F008 — finalizeSettleImportBatch()', () => {
  it('counts persisted rejections then closes exactly the running batch row, stamping the terminal columns', async () => {
    const { sql, statements } = makeBatchLifecycleSql({ rejectionRows: 2 });
    const counters = { ...emptySettleCounters(), versionsAppended: 6 };
    const fields = await sql.begin((tx) => finalizeSettleImportBatch(tx, asImportBatchId('42'), counters));

    expect(fields).toMatchObject({ recordsInserted: 6, recordsUpdated: 0, recordsRejected: 2 });
    expect(statements).toHaveLength(2);
    expect(statements[0].text).toContain('FROM import_rejections WHERE import_batch_id = ?');
    expect(statements[0].values).toEqual(['42']);
    const update = statements[1];
    expect(update.text).toContain("status = 'completed'");
    expect(update.text).toContain('completed_at = clock_timestamp()');
    expect(update.text).toContain("WHERE id = ? AND status = 'running'");
    expect(update.values).toEqual([6, 0, 2, { jsonValue: counters }, '42']);
  });

  it('fails when the batch row cannot be closed, so the surrounding transaction cannot commit', async () => {
    const { sql, state } = makeBatchLifecycleSql({ closedRows: 0 });
    await expect(sql.begin((tx) => finalizeSettleImportBatch(
      tx, asImportBatchId('42'), emptySettleCounters(),
    ))).rejects.toThrow(/expected to close exactly one running batch row/);
    expect(state.outcome).toBe('rolled_back');
  });
});

describe('AFLDB-ISSUE-244 F008 — runSettleAflApi() batch lifecycle', () => {
  const base = { registry: SOURCE_FAMILIES, autoApply: false, inProgressSeasons: [2026] } as const;

  it('a committed apply finalises the batch inside the transaction, after the writes and before commit', async () => {
    const { sql, state, kinds, statements } = makeBatchLifecycleSql({ rejectionRows: 0 });
    const result = await runSettleAflApi(sql, { ...base, bundle: emptyBundle(), apply: true });

    expect(result.applied).toBe(true);
    expect(result.batchId).toBe('42');
    expect(state.outcome).toBe('committed');
    expect(kinds().slice(-3)).toEqual(['INSERT INTO import_batches', 'SELECT count(*)::int AS', 'UPDATE import_batches SET']);
    // What the batch says is what the run returned.
    expect(statements.at(-1)?.values[3]).toEqual({ jsonValue: result.counters });
  });

  it('a dry-run still exercises the real finalising UPDATE, then rolls back and presents no committed batch', async () => {
    const { sql, state, kinds } = makeBatchLifecycleSql();
    const result = await runSettleAflApi(sql, { ...base, bundle: emptyBundle(), apply: false });

    expect(kinds().at(-1)).toBe('UPDATE import_batches SET');
    expect(state.outcome).toBe('rolled_back');
    expect(result.applied).toBe(false);
    expect(result.batchId).toBeNull();
    expect(result.rollbackReason).toBe('dry_run');
  });

  it('a --require-complete-source refusal never finalises the batch and rolls the whole transaction back (F004 preserved)', async () => {
    const { sql, state, kinds } = makeBatchLifecycleSql();
    const result = await runSettleAflApi(sql, {
      ...base, apply: true, requireCompleteSource: true,
      bundle: emptyBundle([{ providerMatchId: null, error: 'unkeyed' }]),
    });

    expect(result.rollbackReason).toBe('require_complete_source');
    expect(result.applied).toBe(false);
    expect(result.batchId).toBeNull();
    expect(state.outcome).toBe('rolled_back');
    expect(kinds().some((kind) => kind.startsWith('UPDATE import_batches'))).toBe(false);
  });

  it('a finalisation failure fails the run and rolls the transaction back — nothing is committed beside a running batch', async () => {
    const zeroClosed = makeBatchLifecycleSql({ closedRows: 0 });
    await expect(runSettleAflApi(zeroClosed.sql, { ...base, bundle: emptyBundle(), apply: true }))
      .rejects.toThrow(/expected to close exactly one running batch row/);
    expect(zeroClosed.state.outcome).toBe('rolled_back');

    const dbError = makeBatchLifecycleSql({ closeError: new Error('permission denied for table import_batches') });
    await expect(runSettleAflApi(dbError.sql, { ...base, bundle: emptyBundle(), apply: true }))
      .rejects.toThrow(/permission denied/);
    expect(dbError.state.outcome).toBe('rolled_back');
  });
});

describe('AFLDB-ISSUE-244 F008 — runSettleAflApiBrownlow() batch lifecycle', () => {
  const base = {
    registry: SOURCE_FAMILIES, season: 2026, matchVotes: [], inProgressSeasons: [2026], autoApply: false,
    leaderboardStatus: 'LIVE' as string | null,
    leaderboard: [{
      providerPlayerId: 'CD_I1', providerTeamId: 'CD_T1', votes: 5, eligible: true, winner: false, leader: false, roundVotes: [],
    }],
  };

  it('a committed observe-only run is a committed batch and is closed like an applying one', async () => {
    const { sql, state, kinds } = makeBatchLifecycleSql();
    const result = await runSettleAflApiBrownlow(sql, { ...base, apply: true, observeOnly: true });

    expect(result.applied).toBe(true);
    expect(result.batchId).toBe('42');
    expect(state.outcome).toBe('committed');
    expect(kinds().slice(-3)).toEqual(['INSERT INTO import_batches', 'SELECT count(*)::int AS', 'UPDATE import_batches SET']);
  });

  it('the batch validation_result carries the FINAL counters, leaderboard reconciliation included', async () => {
    const { sql, statements } = makeBatchLifecycleSql();
    const result = await runSettleAflApiBrownlow(sql, { ...base, apply: true, observeOnly: false });

    expect(result.counters.leaderboardPlayersCompared).toBe(1);
    expect(result.counters.leaderboardMismatches).toBe(1);
    // Stamped inside the transaction, so it must already agree with what the caller gets back.
    expect(statements.at(-1)?.values[3]).toEqual({ jsonValue: result.counters });
  });

  it('a dry-run finalises (real UPDATE) then rolls back and presents no committed batch', async () => {
    const { sql, state, kinds } = makeBatchLifecycleSql();
    const result = await runSettleAflApiBrownlow(sql, { ...base, apply: false, observeOnly: false });

    expect(kinds().at(-1)).toBe('UPDATE import_batches SET');
    expect(state.outcome).toBe('rolled_back');
    expect(result.applied).toBe(false);
    expect(result.batchId).toBeNull();
  });

  it('a finalisation failure fails the run and rolls the transaction back', async () => {
    const { sql, state } = makeBatchLifecycleSql({ closedRows: 0 });
    await expect(runSettleAflApiBrownlow(sql, { ...base, apply: true, observeOnly: false }))
      .rejects.toThrow(/expected to close exactly one running batch row/);
    expect(state.outcome).toBe('rolled_back');
  });
});

describe('AFLDB-ISSUE-244 F008 — finalisation placement in the fixtures-only tool and the writers', () => {
  it('every committing AFL API writer finalises after its last write/gate and before its dry-run rollback', () => {
    const normal = readSource('src/lib/acquisition/settle-afl-api.ts');
    expect(normal.indexOf('throw new RequireCompleteSourceRollback'))
      .toBeLessThan(normal.indexOf('await finalizeSettleImportBatch('));
    expect(normal.indexOf('await finalizeSettleImportBatch('))
      .toBeLessThan(normal.indexOf('if (!options.apply) throw new DryRunRollback'));

    const brownlow = readSource('src/lib/acquisition/afl-api-brownlow.ts');
    expect(brownlow.indexOf('await recomputeBrownlowCoverage(tx'))
      .toBeLessThan(brownlow.indexOf('await finalizeSettleImportBatch('));
    expect(brownlow.indexOf('await finalizeSettleImportBatch('))
      .toBeLessThan(brownlow.indexOf('if (!options.apply) throw new DryRunRollback'));

    const fixtures = readSource('tools/current-season/settle-afl-api-fixtures.ts');
    expect(fixtures.indexOf('await persistAflApiFixtureObservations('))
      .toBeLessThan(fixtures.indexOf('await finalizeSettleImportBatch('));
    expect(fixtures.indexOf('await finalizeSettleImportBatch('))
      .toBeLessThan(fixtures.indexOf('if (!args.apply) throw new DryRunRollback'));
  });

  it('no AFL API writer closes its batch outside the settle transaction', () => {
    for (const path of [
      'src/lib/acquisition/settle-afl-api.ts',
      'src/lib/acquisition/afl-api-brownlow.ts',
      'tools/current-season/settle-afl-api-fixtures.ts',
      'tools/current-season/settle-afl-api.ts',
      'tools/current-season/settle-afl-api-brownlow.ts',
    ]) {
      expect(readSource(path), path).not.toMatch(/UPDATE\s+import_batches/);
    }
  });
});

/* ------------------------------------------------------------------ *
 * AFLDB-ISSUE-244 I244-F009 — durable evidence for an automatic-apply refusal
 * ------------------------------------------------------------------ */

type StubIssueRow = {
  entityType: string;
  entityId: number | null;
  issueType: string;
  issueKey: string;
  severity: string;
  description: string;
  details: Record<string, unknown>;
  resolvedAt: string | null;
  resolution: string | null;
};

/**
 * A stand-in transaction holding a tiny in-memory `data_issues` table that
 * models exactly the three statements the F009 helpers issue: the once-per-run
 * open-key read, `writeSettleDataIssue()`'s upsert (one OPEN row per
 * `(issue_type, issue_key)`, refreshed in place) and the owner-scoped resolver.
 * `transact()` snapshots the table and restores it when the callback throws —
 * the rollback a dry-run, an F004 refusal or a HALT delivers. Any other
 * statement is an error, so a write to `promotion_candidates`,
 * `promotion_decisions` or `import_rejections` fails the test by construction.
 */
function makeApplyFindingStub(seed: StubIssueRow[] = []) {
  let rows: StubIssueRow[] = structuredClone(seed);
  const statements: { text: string; values: unknown[] }[] = [];
  const tx = Object.assign(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?').replace(/\s+/g, ' ').trim();
      statements.push({ text, values });
      if (text.startsWith('SELECT issue_key AS "issueKey" FROM data_issues')) {
        const [issueType, owner, sourceKey] = values;
        return rows
          .filter((row) => row.issueType === issueType && row.resolvedAt === null
            && row.details.owner === owner && row.details.source_key === sourceKey)
          .map((row) => ({ issueKey: row.issueKey }));
      }
      if (text.startsWith('INSERT INTO data_issues')) {
        const [entityType, entityId, issueType, issueKey, severity, description, json] = values as [
          string, number | null, string, string, string, string, { jsonValue: Record<string, unknown> },
        ];
        const details = structuredClone(json.jsonValue);
        const open = rows.find((row) => row.issueType === issueType && row.issueKey === issueKey
          && row.resolvedAt === null);
        if (open) {
          Object.assign(open, { entityId, severity, description, details });
          return [{ inserted: false }];
        }
        rows.push({
          entityType, entityId, issueType, issueKey, severity, description, details,
          resolvedAt: null, resolution: null,
        });
        return [{ inserted: true }];
      }
      if (text.startsWith('UPDATE data_issues SET resolved_at = now(), resolution = ?')) {
        const [resolution, issueType, issueKey, owner] = values;
        const hit = rows.filter((row) => row.issueType === issueType && row.issueKey === issueKey
          && row.resolvedAt === null && row.details.owner === owner);
        for (const row of hit) {
          row.resolvedAt = 'resolved-by-settle';
          row.resolution = resolution as string;
        }
        return hit.map((_row, index) => ({ id: String(index) }));
      }
      throw new Error(`unexpected statement in the apply-finding stub: ${text}`);
    },
    { json: (value: unknown) => ({ jsonValue: value }) },
  ) as unknown as postgres.TransactionSql;
  const transact = async <T>(callback: (t: postgres.TransactionSql) => Promise<T>): Promise<T> => {
    const snapshot = structuredClone(rows);
    try {
      return await callback(tx);
    } catch (error) {
      rows = snapshot;
      throw error;
    }
  };
  return {
    tx,
    transact,
    statements,
    rows: () => rows,
    open: () => rows.filter((row) => row.resolvedAt === null),
    kinds: () => statements.map((s) => s.text.split(' ').slice(0, 2).join(' ')),
  };
}

const APPLY_SCOPE: ApplyFindingScope = {
  issueType: 'canonical_apply_failed', issueOwner: 'AFLDB-ISSUE-122', sourceKey: 'afl_api',
};

function playerApplyUnit(externalRecordId = 'M1|T1|P1') {
  return {
    family: 'player_match_stats',
    externalRecordId,
    season: 2026,
    matchKey: '2026|R1|2026-03-12|Carlton|Richmond',
    inProgressSeasons: [2026] as readonly number[],
    targets: [{
      targetTable: 'player_match_stats', renderedFields: ['kicks', 'marks'], sourceVersionSeq: 3,
    }],
  };
}

const refusedResult = (targetTable: string, refusal: string) => ({ targetTable, applied: false, refusal });
const appliedResult = (targetTable: string) => ({ targetTable, applied: true, refusal: null });
const PLAYER_KEY = 'afl_api|apply|player_match_stats|M1|T1|P1|player_match_stats';

describe('AFLDB-ISSUE-244 F009 — refusal finding draft', () => {
  it('names the machine refusal code, the target and only the FIELD NAMES — never values, payloads or errors', () => {
    const draft = draftApplyRefusalIssue({
      scope: APPLY_SCOPE, family: 'player_match_stats', externalRecordId: 'M1|T1|P1',
      targetTable: 'player_match_stats', targetId: 77, refusal: 'foreign_source_owner',
      sourceVersionSeq: 3, fields: ['kicks', 'marks'], matchKey: '2026|R1|2026-03-12|Carlton|Richmond',
    });

    expect(draft.issueType).toBe('canonical_apply_failed');
    expect(draft.issueKey).toBe(PLAYER_KEY);
    expect(draft.issueKey).toBe(canonicalApplyIssueKey('afl_api', 'player_match_stats', 'M1|T1|P1', 'player_match_stats'));
    expect(draft.entityType).toBe('player_match_stats');
    expect(draft.entityId).toBe(77);
    expect(draft.description).toContain('(foreign_source_owner)');
    expect(Object.keys(draft.details).sort()).toEqual([
      'external_record_id', 'family', 'fields', 'issue', 'match_key', 'owner', 'refusal',
      'source_key', 'source_version_seq', 'target_table',
    ]);
    expect(draft.details).toMatchObject({
      owner: 'AFLDB-ISSUE-122', source_key: 'afl_api', refusal: 'foreign_source_owner',
      fields: ['kicks', 'marks'], source_version_seq: 3,
    });
    expect(JSON.stringify(draft)).not.toMatch(/postgres(ql)?:\/\/|password|error|stack/i);
  });

  it('keeps the applier vocabulary verbatim and grades fail-closed refusals as errors', () => {
    expect(describeApplyRefusal('foreign_source_owner').severity).toBe('warning');
    expect(describeApplyRefusal('manual_authority_conflict').severity).toBe('warning');
    expect(describeApplyRefusal('stale_canonical_target').severity).toBe('warning');
    expect(describeApplyRefusal('ownership_indeterminate').severity).toBe('error');
    expect(describeApplyRefusal('manual_authority_indeterminate').severity).toBe('error');
    expect(describeApplyRefusal('some_future_refusal').explanation).toBe('the applier refused the write');
  });

  it('I244-F030: possible_existing_match has a specific operator explanation and error severity (an INSERT would duplicate a fixture)', () => {
    const described = describeApplyRefusal(POSSIBLE_EXISTING_MATCH);
    expect(POSSIBLE_EXISTING_MATCH).toBe('possible_existing_match');
    expect(described.severity).toBe('error');
    // Not the generic fallback: the vocabulary names this refusal.
    expect(described.explanation).not.toBe('the applier refused the write');
    expect(described.explanation).toContain('may already be this fixture');
    expect(described.explanation).toContain('never performed');
  });
});

describe('AFLDB-ISSUE-244 F009 — recordApplyOutcomeFindings() lifecycle', () => {
  it('A: a refused player target opens exactly one finding carrying the machine reason, and writes nothing else', async () => {
    const stub = makeApplyFindingStub();
    const counters = emptySettleCounters();
    await recordApplyOutcomeFindings(
      stub.tx, APPLY_SCOPE, newApplyFindingLedger(), playerApplyUnit(),
      [refusedResult('player_match_stats', 'foreign_source_owner')],
      { player_match_stats: 77 }, counters,
    );

    expect(stub.open()).toHaveLength(1);
    expect(stub.open()[0]).toMatchObject({
      issueKey: PLAYER_KEY, entityType: 'player_match_stats', entityId: 77, severity: 'warning',
    });
    expect(stub.open()[0].details.refusal).toBe('foreign_source_owner');
    expect(counters).toMatchObject({ dataIssuesOpened: 1, dataIssuesRefreshed: 0, dataIssuesResolved: 0 });
    // The caller's refusal counter is not double-counted by the finding writer.
    expect(counters.canonicalApplyRefusals).toBe(0);
    // No candidate, decision, rejection or canonical-application write.
    expect(stub.statements.every((s) => /data_issues/.test(s.text))).toBe(true);
  });

  it('B: an identical replay refreshes the one open finding in place — no duplicate pending spam', async () => {
    const stub = makeApplyFindingStub();
    const counters = emptySettleCounters();
    for (let run = 0; run < 3; run += 1) {
      await recordApplyOutcomeFindings(
        stub.tx, APPLY_SCOPE, newApplyFindingLedger(), playerApplyUnit(),
        [refusedResult('player_match_stats', 'foreign_source_owner')],
        { player_match_stats: 77 }, counters,
      );
    }

    expect(stub.rows()).toHaveLength(1);
    expect(stub.open()).toHaveLength(1);
    expect(counters).toMatchObject({ dataIssuesOpened: 1, dataIssuesRefreshed: 2 });
  });

  it('B2: a changed refusal reason refreshes the same finding rather than opening a second', async () => {
    const stub = makeApplyFindingStub();
    const counters = emptySettleCounters();
    await recordApplyOutcomeFindings(
      stub.tx, APPLY_SCOPE, newApplyFindingLedger(), playerApplyUnit(),
      [refusedResult('player_match_stats', 'foreign_source_owner')], {}, counters,
    );
    await recordApplyOutcomeFindings(
      stub.tx, APPLY_SCOPE, newApplyFindingLedger(), playerApplyUnit(),
      [refusedResult('player_match_stats', 'manual_authority_conflict')], {}, counters,
    );

    expect(stub.rows()).toHaveLength(1);
    expect(stub.open()[0].details.refusal).toBe('manual_authority_conflict');
  });

  it('C: a dependent refusal is per target — an applied sibling closes ITS finding and opens nothing', async () => {
    const stub = makeApplyFindingStub();
    const counters = emptySettleCounters();
    const unit = {
      ...playerApplyUnit('M1'),
      family: 'match',
      targets: [
        { targetTable: 'matches', renderedFields: ['home_score'], sourceVersionSeq: 1 },
        { targetTable: 'match_period_scores', renderedFields: ['period_scores'], sourceVersionSeq: 1 },
      ],
    };
    await recordApplyOutcomeFindings(
      stub.tx, APPLY_SCOPE, newApplyFindingLedger(), unit,
      [appliedResult('matches'), refusedResult('match_period_scores', 'foreign_source_owner')],
      { matches: 5, match_period_scores: 5 }, counters,
    );

    expect(stub.open().map((row) => row.issueKey)).toEqual(['afl_api|apply|match|M1|match_period_scores']);
    expect(stub.open()[0].entityId).toBe(5);
  });

  it('D: a later successful auto-apply closes the pending refusal (self-heal)', async () => {
    const stub = makeApplyFindingStub();
    const counters = emptySettleCounters();
    await recordApplyOutcomeFindings(
      stub.tx, APPLY_SCOPE, newApplyFindingLedger(), playerApplyUnit(),
      [refusedResult('player_match_stats', 'ownership_indeterminate')], {}, counters,
    );
    expect(stub.open()).toHaveLength(1);

    await recordApplyOutcomeFindings(
      stub.tx, APPLY_SCOPE, newApplyFindingLedger(), playerApplyUnit(),
      [appliedResult('player_match_stats')], {}, counters,
    );

    expect(stub.open()).toHaveLength(0);
    expect(stub.rows()[0]).toMatchObject({ resolution: 'canonical_apply_succeeded' });
    expect(counters.dataIssuesResolved).toBe(1);
  });

  it('D2: a target that no longer differs (nothing_to_write / not offered) closes the refusal as moot, and opens no finding', async () => {
    const stub = makeApplyFindingStub();
    const counters = emptySettleCounters();
    await recordApplyOutcomeFindings(
      stub.tx, APPLY_SCOPE, newApplyFindingLedger(), playerApplyUnit(),
      [refusedResult('player_match_stats', 'foreign_source_owner')], {}, counters,
    );

    await recordApplyOutcomeFindings(
      stub.tx, APPLY_SCOPE, newApplyFindingLedger(), playerApplyUnit(),
      [refusedResult('player_match_stats', 'nothing_to_write')], {}, counters,
    );
    expect(stub.open()).toHaveLength(0);
    expect(stub.rows()[0].resolution).toBe('canonical_apply_not_needed');

    // Same outcome through the no-diff path the writer takes without invoking the applier.
    const stub2 = makeApplyFindingStub();
    const ledger2 = newApplyFindingLedger();
    const counters2 = emptySettleCounters();
    await recordApplyOutcomeFindings(
      stub2.tx, APPLY_SCOPE, ledger2, playerApplyUnit(),
      [refusedResult('player_match_stats', 'stale_canonical_target')], {}, counters2,
    );
    await closeApplyFindingIfOpen(
      stub2.tx, APPLY_SCOPE, newApplyFindingLedger(), PLAYER_KEY, 'canonical_apply_not_needed', counters2,
    );
    expect(stub2.open()).toHaveLength(0);
  });

  it('D3: healing is bounded — the open set is read ONCE per run and an unchanged target costs no statement', async () => {
    const stub = makeApplyFindingStub();
    const ledger = newApplyFindingLedger();
    const counters = emptySettleCounters();
    for (let player = 0; player < 50; player += 1) {
      await closeApplyFindingIfOpen(
        stub.tx, APPLY_SCOPE, ledger,
        canonicalApplyIssueKey('afl_api', 'player_match_stats', `M1|T1|P${player}`, 'player_match_stats'),
        'canonical_apply_not_needed', counters,
      );
    }
    expect(stub.statements).toHaveLength(1);
    expect(stub.kinds()).toEqual(['SELECT issue_key']);
  });

  it('E: replay never overwrites a finding a human already resolved — a recurrence opens a fresh row beside the untouched one', async () => {
    const human: StubIssueRow = {
      entityType: 'player_match_stats', entityId: 77, issueType: 'canonical_apply_failed', issueKey: PLAYER_KEY,
      severity: 'warning', description: 'triaged by a super admin', resolvedAt: '2026-09-20',
      resolution: 'accepted: AFL Tables is authoritative for this row',
      details: { owner: 'AFLDB-ISSUE-122', source_key: 'afl_api', refusal: 'foreign_source_owner' },
    };
    const stub = makeApplyFindingStub([human]);
    const counters = emptySettleCounters();

    // A healing outcome cannot reach a resolved row: it was never in the open set.
    await recordApplyOutcomeFindings(
      stub.tx, APPLY_SCOPE, newApplyFindingLedger(), playerApplyUnit(),
      [appliedResult('player_match_stats')], {}, counters,
    );
    expect(stub.statements.some((s) => s.text.startsWith('UPDATE data_issues'))).toBe(false);
    expect(stub.rows()[0]).toEqual(human);

    // The refusal condition still holds: the resolved row is byte-identical; a NEW open row is added.
    await recordApplyOutcomeFindings(
      stub.tx, APPLY_SCOPE, newApplyFindingLedger(), playerApplyUnit(),
      [refusedResult('player_match_stats', 'foreign_source_owner')], {}, counters,
    );
    expect(stub.rows()).toHaveLength(2);
    expect(stub.rows()[0]).toEqual(human);
    expect(stub.open()).toHaveLength(1);
  });

  it('E2: another writer\'s finding on the same type is never closed (owner and source scoped)', async () => {
    const foreign = (details: Record<string, unknown>): StubIssueRow => ({
      entityType: 'player_match_stats', entityId: null, issueType: 'canonical_apply_failed', issueKey: PLAYER_KEY,
      severity: 'error', description: 'someone else\'s', resolvedAt: null, resolution: null, details,
    });
    for (const details of [
      { owner: 'AFLDB-ISSUE-999', source_key: 'afl_api' },
      { owner: 'AFLDB-ISSUE-122', source_key: 'afltables' },
    ]) {
      const stub = makeApplyFindingStub([foreign(details)]);
      const counters = emptySettleCounters();
      await recordApplyOutcomeFindings(
        stub.tx, APPLY_SCOPE, newApplyFindingLedger(), playerApplyUnit(),
        [appliedResult('player_match_stats')], {}, counters,
      );
      expect(stub.open()).toHaveLength(1);
      expect(counters.dataIssuesResolved).toBe(0);
    }
  });

  it('F: the season gate is ONE run-level finding, not one per refused target, and closes when the season is in progress', async () => {
    const stub = makeApplyFindingStub();
    const ledger = newApplyFindingLedger();
    const counters = emptySettleCounters();
    for (let player = 0; player < 40; player += 1) {
      await recordApplyOutcomeFindings(
        stub.tx, APPLY_SCOPE, ledger, { ...playerApplyUnit(`M1|T1|P${player}`), inProgressSeasons: [] },
        [refusedResult('player_match_stats', 'season_not_in_progress')], {}, counters,
      );
    }
    expect(stub.rows()).toHaveLength(1);
    expect(stub.rows()[0].issueKey).toBe(applySeasonGateIssueKey(APPLY_SCOPE, 2026));
    expect(stub.rows()[0].details).toMatchObject({ refusal: 'season_not_in_progress', season: 2026 });
    expect(counters.dataIssuesOpened).toBe(1);

    // Still not in progress: nothing is closed.
    await clearSeasonGateFinding(stub.tx, APPLY_SCOPE, newApplyFindingLedger(), 2026, [], counters);
    expect(stub.open()).toHaveLength(1);

    await clearSeasonGateFinding(stub.tx, APPLY_SCOPE, newApplyFindingLedger(), 2026, [2026], counters);
    expect(stub.open()).toHaveLength(0);
    expect(stub.rows()[0].resolution).toBe('canonical_apply_refusal_cleared');
  });

  it('G: findings are written on the run transaction only, so a dry-run / F004 / HALT rollback leaves none', async () => {
    const stub = makeApplyFindingStub();
    const counters = emptySettleCounters();
    await expect(stub.transact(async (tx) => {
      await recordApplyOutcomeFindings(
        tx, APPLY_SCOPE, newApplyFindingLedger(), playerApplyUnit(),
        [refusedResult('player_match_stats', 'foreign_source_owner')], {}, counters,
      );
      expect(stub.open()).toHaveLength(1);
      throw new Error('deliberate rollback');
    })).rejects.toThrow('deliberate rollback');
    expect(stub.rows()).toHaveLength(0);

    // The healing UPDATE is transactional too: a rolled-back heal leaves the finding open.
    await recordApplyOutcomeFindings(
      stub.tx, APPLY_SCOPE, newApplyFindingLedger(), playerApplyUnit(),
      [refusedResult('player_match_stats', 'foreign_source_owner')], {}, counters,
    );
    await expect(stub.transact(async (tx) => {
      await recordApplyOutcomeFindings(
        tx, APPLY_SCOPE, newApplyFindingLedger(), playerApplyUnit(),
        [appliedResult('player_match_stats')], {}, counters,
      );
      throw new Error('deliberate rollback');
    })).rejects.toThrow('deliberate rollback');
    expect(stub.open()).toHaveLength(1);
  });
});

describe('AFLDB-ISSUE-244 F009 — runSettleAflApi() wiring and boundaries', () => {
  it('an automatic-apply run with nothing to evaluate issues no apply-finding statement and finalises exactly as before (F008 unchanged)', async () => {
    const { sql, state, kinds, statements } = makeBatchLifecycleSql();
    const result = await runSettleAflApi(sql, {
      registry: SOURCE_FAMILIES, autoApply: true, inProgressSeasons: [2026], bundle: emptyBundle(), apply: true,
    });

    expect(result.applied).toBe(true);
    expect(state.outcome).toBe('committed');
    expect(statements.some((statement) => statement.text.includes('data_issues'))).toBe(false);
    expect(kinds().slice(-3)).toEqual(['INSERT INTO import_batches', 'SELECT count(*)::int AS', 'UPDATE import_batches SET']);
  });

  it('a refusal finding is never an import_rejection, a candidate or a decision, and no new counter exists', () => {
    const core = readSource('src/lib/acquisition/settle-core.ts');
    const start = core.indexOf('Automatic-apply refusal findings (AFLDB-ISSUE-244 I244-F009)');
    const end = core.indexOf('import_batches terminal lifecycle (AFLDB-ISSUE-244 I244-F008)');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const section = core.slice(start, end);
    expect(section).not.toMatch(/INSERT\s+INTO\s+(import_rejections|promotion_candidates|promotion_decisions|canonical_applications)/);
    expect(section).not.toMatch(/UPDATE\s+(import_batches|promotion_candidates)/);
    // Existing counters only: F009 adds no refusal counter to the shared shape.
    expect(Object.keys(emptySettleCounters()).filter((key) => /refus/i.test(key)).sort())
      .toEqual(['canonicalApplyRefusals', 'manualAuthorityRefusals']);

    const normal = readSource('src/lib/acquisition/settle-afl-api.ts');
    expect(normal).toContain('await recordApplyOutcomeFindings(');
    // Only a unit that did NOT roll back reaches the refusal writer; a failed unit keeps its
    // own `canonical_apply_failed` finding and is not duplicated.
    expect(normal.indexOf('if (outcome.failure === null) {'))
      .toBeLessThan(normal.indexOf('await recordApplyOutcomeFindings('));
    expect(normal.indexOf('await recordApplyOutcomeFindings('))
      .toBeLessThan(normal.indexOf('counters.canonicalApplyFailures += 1;'));
    // The no-diff self-heal exists for both the player and the match targets.
    expect(normal).toMatch(/closeMootApplyFinding\(\s*tx, refs, 'player_match_stats'/);
    expect(normal).toMatch(/closeMootApplyFinding\(tx, refs, 'match', bundle\.match\.sourceRecordId, 'matches'/);
    // F008: records_rejected still counts import_rejections rows alone.
    expect(normal).not.toMatch(/records_rejected/);
  });

  it('the Brownlow writer and the fixtures-only tool are untouched by F009 (already durable / no canonical promotion)', () => {
    expect(readSource('src/lib/acquisition/afl-api-brownlow.ts')).not.toContain('recordApplyOutcomeFindings');
    expect(readSource('tools/current-season/settle-afl-api-fixtures.ts')).not.toContain('applyCanonicalUnit');
    expect(readSource('tools/current-season/settle-afl-api-fixtures.ts')).not.toContain('recordApplyOutcomeFindings');
  });
});

/* ------------------------------------------------------------------ *
 * AFLDB-ISSUE-244 I244-F010 — identity-bearing canonical corrections
 * ------------------------------------------------------------------ */

const IDENTITY_CURRENT: Record<string, JsonValue> = {
  season: 2026,
  round_code: '1', round_number: 1, round_type: 'home_and_away', is_final: false,
  match_date: '2026-03-12', match_time: '19:25', venue_id: 10, venue_raw: 'M.C.G.',
  home_club_id: 5, away_club_id: 9,
  home_goals: 10, home_behinds: 8, home_score: 68,
  away_goals: 9, away_behinds: 7, away_score: 61,
  result: 'home_win', winner_club_id: 5, margin: 7,
};
const IDENTITY_KEYS = [...MATCH_IDENTITY_FIELDS] as string[];
const proposedWith = (patch: Record<string, JsonValue>): Record<string, JsonValue> => ({ ...IDENTITY_CURRENT, ...patch });
const matchTargetFor = (proposed: Record<string, JsonValue>): CanonicalApplyTargetInput => {
  const rendered = diffFields(proposed, IDENTITY_CURRENT);
  return {
    targetTable: 'matches', invitation: 'candidate', proposedValues: proposed, renderedFields: rendered,
    renderedBaselineCanonicalHash: baselineCanonicalHash(rendered, IDENTITY_CURRENT), sourceVersionSeq: 4,
  };
};

describe('AFLDB-ISSUE-244 F010 — identity-bearing field partition (pure)', () => {
  it('the identity field set is exactly the columns match_key renders plus the columns CHECK-bound to round_code', () => {
    expect([...MATCH_IDENTITY_FIELDS].sort()).toEqual([
      'away_club_id', 'home_club_id', 'is_final', 'match_date', 'round_code', 'round_number', 'round_type', 'season',
    ]);
    // In NO match_key and NO unique/CHECK relationship: they stay ordinary auto-apply fields.
    for (const field of ['venue_id', 'venue_raw', 'match_time', 'attendance', 'home_score', 'away_score', 'margin', 'result']) {
      expect(IDENTITY_KEYS).not.toContain(field);
    }
  });

  it('A: a non-identity correction (scores, venue, kick-off time) is untouched by F010', () => {
    const proposed = proposedWith({
      home_score: 74, home_behinds: 14, margin: 13, venue_id: 11, venue_raw: 'S.C.G.', match_time: '19:40',
    });
    const rendered = diffFields(proposed, IDENTITY_CURRENT);
    const split = splitMatchIdentityChange(proposed, rendered);

    expect(split.changedIdentityFields).toEqual([]);
    expect(split.renderedFields).toEqual(rendered);
    expect(split.renderedFields).toEqual(expect.arrayContaining(['home_score', 'margin', 'venue_id', 'venue_raw', 'match_time']));
  });

  it('B: a change to EACH identity-bearing field is detected and withheld', () => {
    const changed: Record<string, JsonValue> = {
      season: 2027, round_code: '2', round_number: 2, round_type: 'qualifying_final', is_final: true,
      match_date: '2026-03-13', home_club_id: 6, away_club_id: 10,
    };
    expect(Object.keys(changed).sort()).toEqual([...IDENTITY_KEYS].sort());
    for (const [field, value] of Object.entries(changed)) {
      const proposed = proposedWith({ [field]: value });
      const split = splitMatchIdentityChange(proposed, diffFields(proposed, IDENTITY_CURRENT));
      expect(split.changedIdentityFields).toEqual([field]);
      expect(split.renderedFields).toEqual([]);
      for (const key of IDENTITY_KEYS) expect(Object.keys(split.proposedValues)).not.toContain(key);
    }
  });

  it('C: no partial identity update — a mixed correction offers the applier NO identity field, only the rest', () => {
    const proposed = proposedWith({ match_date: '2026-03-13', round_code: '2', round_number: 2, home_score: 70, margin: 9, venue_id: 11 });
    const rendered = diffFields(proposed, IDENTITY_CURRENT);
    const split = splitMatchIdentityChange(proposed, rendered);

    expect(split.changedIdentityFields).toEqual(['match_date', 'round_code', 'round_number']);
    expect(split.renderedFields).toEqual(rendered.filter((field) => !IDENTITY_KEYS.includes(field)));
    expect(split.renderedFields).toEqual(['home_score', 'margin', 'venue_id']);
    for (const key of IDENTITY_KEYS) expect(Object.keys(split.proposedValues)).not.toContain(key);
    expect(split.proposedValues.home_score).toBe(70);
  });

  it('C2: race safety — even when identity AGREES, no identity field is offered, so a concurrent move cannot be written back with match_key untouched', () => {
    const proposed = proposedWith({ home_score: 70, margin: 9 });
    const split = splitMatchIdentityChange(proposed, diffFields(proposed, IDENTITY_CURRENT));
    expect(split.changedIdentityFields).toEqual([]);
    for (const key of IDENTITY_KEYS) expect(Object.keys(split.proposedValues)).not.toContain(key);
    expect(split.renderedFields).toEqual(['home_score', 'margin']);
  });
});

describe('AFLDB-ISSUE-244 F010 — automaticApplyTargets() (what the applier may be offered)', () => {
  const periodTarget: CanonicalApplyTargetInput = {
    targetTable: 'match_period_scores', invitation: 'candidate',
    proposedValues: { period_scores: [] }, renderedFields: ['period_scores'],
    renderedBaselineCanonicalHash: 'a'.repeat(64), sourceVersionSeq: 4,
  };

  it('rebuilds the matches target without identity fields and re-derives the E5 baseline over what remains', () => {
    const proposed = proposedWith({ match_date: '2026-03-13', home_score: 70, margin: 9 });
    const full = matchTargetFor(proposed);
    const split = splitMatchIdentityChange(proposed, full.renderedFields);
    const offered = automaticApplyTargets([full, periodTarget], split, IDENTITY_CURRENT);

    expect(offered).toHaveLength(2);
    const [match, period] = offered;
    expect(match.targetTable).toBe('matches');
    expect(match.renderedFields).toEqual(['home_score', 'margin']);
    for (const key of IDENTITY_KEYS) expect(Object.keys(match.proposedValues)).not.toContain(key);
    // The hash must describe the reduced list (E5 recomputes it over the same list inside the savepoint).
    expect(match.renderedBaselineCanonicalHash).toBe(baselineCanonicalHash(['home_score', 'margin'], IDENTITY_CURRENT));
    expect(match.renderedBaselineCanonicalHash).not.toBe(full.renderedBaselineCanonicalHash);
    expect(match.sourceVersionSeq).toBe(4);
    // A non-matches target is passed through untouched.
    expect(period).toBe(periodTarget);
    // The whole proposal is not mutated: a review-first run still sees identity.
    expect(Object.keys(full.proposedValues)).toEqual(expect.arrayContaining(IDENTITY_KEYS));
  });

  it('drops the matches target when nothing but identity differs, and keeps the rest of the unit', () => {
    const proposed = proposedWith({ match_date: '2026-03-13', round_code: '2', round_number: 2 });
    const full = matchTargetFor(proposed);
    const split = splitMatchIdentityChange(proposed, full.renderedFields);
    expect(automaticApplyTargets([full], split, IDENTITY_CURRENT)).toEqual([]);
    expect(automaticApplyTargets([full, periodTarget], split, IDENTITY_CURRENT)).toEqual([periodTarget]);
  });

  it('an INSERT is not split: it defines the identity, so every field including match_key inputs is offered', () => {
    const insert: CanonicalApplyTargetInput = {
      targetTable: 'matches', invitation: 'candidate', proposedValues: IDENTITY_CURRENT,
      renderedFields: diffFields(IDENTITY_CURRENT, null), renderedBaselineCanonicalHash: null, sourceVersionSeq: 4,
    };
    const offered = automaticApplyTargets([insert], null, null);
    expect(offered).toEqual([insert]);
    expect(offered[0]).toBe(insert);
  });
});

describe('AFLDB-ISSUE-244 F010 — identity finding draft', () => {
  const draftInput = (patch: Partial<MatchIdentityIssueInput> = {}): MatchIdentityIssueInput => ({
    scope: APPLY_SCOPE, family: 'match', externalRecordId: 'CD_M20260010101', matchId: 501, sourceVersionSeq: 4,
    changedFields: ['match_date', 'round_code'],
    proposedValues: proposedWith({ match_date: '2026-03-13', round_code: '2' }),
    currentValues: IDENTITY_CURRENT,
    canonicalMatchKey: '2026|1|2026-03-12|Carlton|Richmond',
    providerMatchKey: '2026|2|2026-03-13|Carlton|Richmond',
    ...patch,
  });

  it('carries the machine reason, both identities and only the differing identity fields — no payload, secrets or errors', () => {
    const draft = draftMatchIdentityIssue(draftInput());

    expect(draft.issueType).toBe('canonical_apply_failed');
    expect(draft.entityType).toBe('matches');
    expect(draft.entityId).toBe(501);
    expect(draft.severity).toBe('warning');
    expect(draft.issueKey).toBe('afl_api|apply|match|CD_M20260010101|matches:identity');
    expect(draft.issueKey).toBe(matchIdentityIssueKey(APPLY_SCOPE, 'match', 'CD_M20260010101'));
    expect(draft.description).toContain('match_date, round_code');
    expect(draft.description).toContain('No identity-bearing field was written');
    expect(Object.keys(draft.details).sort()).toEqual([
      'canonical_match_key', 'changes', 'external_record_id', 'family', 'fields', 'issue', 'match_id', 'owner',
      'provider_match_key', 'refusal', 'source_key', 'source_version_seq', 'target_table',
    ]);
    expect(draft.details).toMatchObject({
      owner: 'AFLDB-ISSUE-122', source_key: 'afl_api', refusal: MATCH_IDENTITY_REFUSAL, match_id: 501,
      target_table: 'matches', fields: ['match_date', 'round_code'],
      canonical_match_key: '2026|1|2026-03-12|Carlton|Richmond',
      provider_match_key: '2026|2|2026-03-13|Carlton|Richmond',
      changes: [
        { field: 'match_date', canonical: '2026-03-12', provider: '2026-03-13' },
        { field: 'round_code', canonical: '1', provider: '2' },
      ],
    });
    expect(MATCH_IDENTITY_REFUSAL).toBe('identity_change_requires_review');
    // Bounded: the score / venue fields the proposal also carried are never persisted.
    expect(JSON.stringify(draft)).not.toMatch(/home_score|venue_raw|postgres(ql)?:\/\/|password|stack/i);
  });

  it('has its own key: it can never collide with, be healed by, or heal the F009 matches refusal finding', () => {
    const identityKey = matchIdentityIssueKey(APPLY_SCOPE, 'match', 'CD_M20260010101');
    const f009Key = canonicalApplyIssueKey('afl_api', 'match', 'CD_M20260010101', 'matches');
    expect(identityKey).not.toBe(f009Key);
    expect(describeApplyRefusal(MATCH_IDENTITY_REFUSAL).explanation).toContain('never applied automatically');
    expect(describeApplyRefusal(MATCH_IDENTITY_REFUSAL).severity).toBe('warning');
  });

  it('refuses to draft a finding that names no differing identity field (no unsupported evidence)', () => {
    expect(() => draftMatchIdentityIssue(draftInput({ changedFields: [] }))).toThrow(SettleCoreError);
  });
});

describe('AFLDB-ISSUE-244 F010 — identity finding lifecycle (F009 semantics preserved)', () => {
  const input = (patch: Partial<MatchIdentityIssueInput> = {}): MatchIdentityIssueInput => ({
    scope: APPLY_SCOPE, family: 'match', externalRecordId: 'CD_M20260010101', matchId: 501, sourceVersionSeq: 4,
    changedFields: ['match_date'], proposedValues: proposedWith({ match_date: '2026-03-13' }),
    currentValues: IDENTITY_CURRENT,
    canonicalMatchKey: '2026|1|2026-03-12|Carlton|Richmond',
    providerMatchKey: '2026|1|2026-03-13|Carlton|Richmond',
    ...patch,
  });
  const KEY = 'afl_api|apply|match|CD_M20260010101|matches:identity';

  it('G/first: one open finding; an identical replay refreshes that one row, never a duplicate', async () => {
    const stub = makeApplyFindingStub();
    const counters = emptySettleCounters();
    for (let run = 0; run < 3; run += 1) {
      await recordMatchIdentityFinding(stub.tx, newApplyFindingLedger(), input(), counters);
    }
    expect(stub.rows()).toHaveLength(1);
    expect(stub.open()[0]).toMatchObject({ issueKey: KEY, entityType: 'matches', entityId: 501 });
    expect(counters).toMatchObject({ dataIssuesOpened: 1, dataIssuesRefreshed: 2, dataIssuesResolved: 0 });
  });

  it('a provider that moves to a DIFFERENT identity refreshes the same row with the current evidence', async () => {
    const stub = makeApplyFindingStub();
    const counters = emptySettleCounters();
    await recordMatchIdentityFinding(stub.tx, newApplyFindingLedger(), input(), counters);
    await recordMatchIdentityFinding(stub.tx, newApplyFindingLedger(), input({
      changedFields: ['match_date'], proposedValues: proposedWith({ match_date: '2026-03-14' }),
      providerMatchKey: '2026|1|2026-03-14|Carlton|Richmond',
    }), counters);
    expect(stub.rows()).toHaveLength(1);
    expect(stub.open()[0].details.changes).toEqual([{ field: 'match_date', canonical: '2026-03-12', provider: '2026-03-14' }]);
    expect(stub.open()[0].details.provider_match_key).toBe('2026|1|2026-03-14|Carlton|Richmond');
  });

  it('H/self-heal: when source and canonical agree on identity again the finding closes, and an untouched record costs one read', async () => {
    const stub = makeApplyFindingStub();
    const counters = emptySettleCounters();
    await recordMatchIdentityFinding(stub.tx, newApplyFindingLedger(), input(), counters);

    const ledger = newApplyFindingLedger();
    await clearMatchIdentityFinding(stub.tx, APPLY_SCOPE, ledger, 'match', 'CD_M20260010101', counters);
    expect(stub.open()).toHaveLength(0);
    expect(stub.rows()[0].resolution).toBe('canonical_apply_not_needed');
    expect(counters.dataIssuesResolved).toBe(1);

    // Bounded: 50 healthy records on the same run add no statement beyond the one open-key read.
    const before = stub.statements.length;
    for (let record = 0; record < 50; record += 1) {
      await clearMatchIdentityFinding(stub.tx, APPLY_SCOPE, ledger, 'match', `CD_M2026${record}`, counters);
    }
    expect(stub.statements.length).toBe(before);
  });

  it('is independent of the F009 matches finding: neither lifecycle closes the other', async () => {
    const f009: StubIssueRow = {
      entityType: 'matches', entityId: 501, issueType: 'canonical_apply_failed',
      issueKey: canonicalApplyIssueKey('afl_api', 'match', 'CD_M20260010101', 'matches'),
      severity: 'warning', description: 'F009 refusal', resolvedAt: null, resolution: null,
      details: { owner: 'AFLDB-ISSUE-122', source_key: 'afl_api', refusal: 'foreign_source_owner' },
    };
    const stub = makeApplyFindingStub([f009]);
    const counters = emptySettleCounters();

    await recordMatchIdentityFinding(stub.tx, newApplyFindingLedger(), input(), counters);
    expect(stub.open()).toHaveLength(2);

    // Identity agrees: only the identity finding closes.
    await clearMatchIdentityFinding(stub.tx, APPLY_SCOPE, newApplyFindingLedger(), 'match', 'CD_M20260010101', counters);
    expect(stub.open().map((row) => row.issueKey)).toEqual([f009.issueKey]);

    // The non-identity fields agree: only the F009 finding closes, an identity finding stays open.
    await recordMatchIdentityFinding(stub.tx, newApplyFindingLedger(), input(), counters);
    await closeApplyFindingIfOpen(
      stub.tx, APPLY_SCOPE, newApplyFindingLedger(), f009.issueKey, 'canonical_apply_not_needed', counters,
    );
    expect(stub.open().map((row) => row.issueKey)).toEqual([KEY]);
  });

  it('E: a finding a human resolved is never rewritten — a persisting difference opens one fresh row beside it', async () => {
    const human: StubIssueRow = {
      entityType: 'matches', entityId: 501, issueType: 'canonical_apply_failed', issueKey: KEY, severity: 'warning',
      description: 'triaged', resolvedAt: '2026-09-20', resolution: 'accepted: the provider date is wrong',
      details: { owner: 'AFLDB-ISSUE-122', source_key: 'afl_api', refusal: MATCH_IDENTITY_REFUSAL },
    };
    const stub = makeApplyFindingStub([human]);
    const counters = emptySettleCounters();

    await clearMatchIdentityFinding(stub.tx, APPLY_SCOPE, newApplyFindingLedger(), 'match', 'CD_M20260010101', counters);
    expect(stub.rows()[0]).toEqual(human);

    await recordMatchIdentityFinding(stub.tx, newApplyFindingLedger(), input(), counters);
    await recordMatchIdentityFinding(stub.tx, newApplyFindingLedger(), input(), counters);
    expect(stub.rows()).toHaveLength(2);
    expect(stub.rows()[0]).toEqual(human);
    expect(stub.open()).toHaveLength(1);
  });

  it('another writer\'s finding under the same key is never closed (owner and source scoped)', async () => {
    for (const details of [
      { owner: 'AFLDB-ISSUE-999', source_key: 'afl_api' },
      { owner: 'AFLDB-ISSUE-122', source_key: 'afltables' },
    ]) {
      const stub = makeApplyFindingStub([{
        entityType: 'matches', entityId: null, issueType: 'canonical_apply_failed', issueKey: KEY,
        severity: 'error', description: 'someone else\'s', resolvedAt: null, resolution: null, details,
      }]);
      const counters = emptySettleCounters();
      await clearMatchIdentityFinding(stub.tx, APPLY_SCOPE, newApplyFindingLedger(), 'match', 'CD_M20260010101', counters);
      expect(stub.open()).toHaveLength(1);
      expect(counters.dataIssuesResolved).toBe(0);
    }
  });

  it('is written on the run transaction only: a dry-run / F004 / HALT rollback leaves no finding, and a rolled-back heal leaves it open', async () => {
    const stub = makeApplyFindingStub();
    const counters = emptySettleCounters();
    await expect(stub.transact(async (tx) => {
      await recordMatchIdentityFinding(tx, newApplyFindingLedger(), input(), counters);
      expect(stub.open()).toHaveLength(1);
      throw new Error('deliberate rollback');
    })).rejects.toThrow('deliberate rollback');
    expect(stub.rows()).toHaveLength(0);

    await recordMatchIdentityFinding(stub.tx, newApplyFindingLedger(), input(), counters);
    await expect(stub.transact(async (tx) => {
      await clearMatchIdentityFinding(tx, APPLY_SCOPE, newApplyFindingLedger(), 'match', 'CD_M20260010101', counters);
      throw new Error('deliberate rollback');
    })).rejects.toThrow('deliberate rollback');
    expect(stub.open()).toHaveLength(1);
  });

  it('writes and reads data_issues only (the stub throws on anything else): no rejection, candidate, decision, ledger or batch write', async () => {
    const stub = makeApplyFindingStub();
    const counters = emptySettleCounters();
    await recordMatchIdentityFinding(stub.tx, newApplyFindingLedger(), input(), counters);
    await clearMatchIdentityFinding(stub.tx, APPLY_SCOPE, newApplyFindingLedger(), 'match', 'CD_M20260010101', counters);
    for (const statement of stub.statements) expect(statement.text).toMatch(/data_issues/);
  });
});

describe('AFLDB-ISSUE-244 F010 — wiring and boundaries', () => {
  const normal = readSource('src/lib/acquisition/settle-afl-api.ts');

  it('the AFL API settle neither rekeys nor writes match_key: the applier is never told to, and never offered identity on an UPDATE', () => {
    expect(normal).toMatch(/matchRekey: null,/);
    // Canonical `matches` is written only through applyCanonicalUnit(); the typed staging projections
    // (`staging.afl_api_*`) legitimately carry a match_key column and are not the canonical table.
    expect(normal).not.toMatch(/UPDATE\s+matches\b/);
    expect(normal).not.toMatch(/INSERT\s+INTO\s+matches\b/);
    // An UPDATE is split; an INSERT is not.
    expect(normal).toContain('const identitySplit = isInsert ? null : splitMatchIdentityChange(');
    // The automatic unit is built from the split targets, never from the whole proposal.
    expect(normal).toContain('targets: routedTargets,');
    expect(normal).toContain('const routedTargets = autoApply ? applyTargets : targets;');
  });

  it('the identity finding is written and healed only on the automatic path, in the run transaction', () => {
    const start = normal.indexOf('if (autoApply && identitySplit !== null) {');
    expect(start).toBeGreaterThan(-1);
    const block = normal.slice(start, normal.indexOf('// I244-F009 self-heal', start));
    expect(block).toContain('await recordMatchIdentityFinding(tx, refs.applyFindings');
    expect(block).toContain('await clearMatchIdentityFinding(');
    expect(block).toContain('counters.canonicalApplyRefusals += 1;');
    expect(block).not.toMatch(/import_rejections|promotion_|canonical_applications|import_batches/);
  });

  it('F009 self-heal for matches is judged on what the automatic path may write, so an identity-only difference cannot mask it', () => {
    expect(normal).toMatch(/if \(!applyTargets\.some\(\(target\) => target\.targetTable === 'matches'\)\) \{\s*await closeMootApplyFinding\(tx, refs, 'match'/);
  });

  it('the shared applier and the AFL Tables settle are untouched by F010: the AFL API path adds no rekey support', () => {
    for (const path of [
      'src/lib/acquisition/canonical-apply.ts',
      'src/lib/acquisition/settle-afltables.ts',
      'src/lib/acquisition/match-rekey.ts',
    ]) {
      const source = readSource(path);
      expect(source).not.toContain('MATCH_IDENTITY_FIELDS');
      expect(source).not.toContain('splitMatchIdentityChange');
      expect(source).not.toContain('recordMatchIdentityFinding');
    }
  });

  it('Brownlow stays fail-closed on X -> Y: F010 adds nothing there and match_identity_conflict still refuses the whole set', () => {
    const brownlow = readSource('src/lib/acquisition/afl-api-brownlow.ts');
    expect(brownlow).toContain('match_identity_conflict');
    expect(brownlow).not.toContain('splitMatchIdentityChange');
    expect(brownlow).not.toContain('MATCH_IDENTITY_FIELDS');
    expect(brownlow).not.toContain('recordMatchIdentityFinding');
  });

  it('F010 adds no refusal counter: the identity finding rides canonicalApplyRefusals and the data_issues lifecycle counters', () => {
    expect(Object.keys(emptySettleCounters()).filter((key) => /refus/i.test(key)).sort())
      .toEqual(['canonicalApplyRefusals', 'manualAuthorityRefusals']);
  });
});

/*
 * I244-F030 — wiring and boundaries. The ambiguity predicate is SQL and is proven in
 * tests/integration/settle-afl-api.test.ts; these lexical checks pin only the call-order and
 * scoping contracts a behavioural test cannot see (WEAK by class, and honestly labelled so).
 */
describe('AFLDB-ISSUE-244 F030 — wiring and boundaries', () => {
  const rekey = readSource('src/lib/acquisition/match-rekey.ts');
  const plan = readSource('src/lib/acquisition/afl-api-settle-plan.ts');
  const applier = readSource('src/lib/acquisition/canonical-apply.ts');
  const writer = readSource('src/lib/acquisition/settle-afl-api.ts');

  it('the retired-identity search and the F030 helper share ONE predicate, and the helper adds no authority requirement', () => {
    expect(rekey.match(/\$\{sameFixtureIdentity\(sql, identity\)\}/g)).toHaveLength(2);
    // The one-component budget is written exactly once, inside the shared fragment.
    expect(rekey.match(/\)::int\) <= 1`/g)).toHaveLength(1);
    const start = rekey.indexOf('export async function findPlausibleCanonicalFixtures(');
    expect(start).toBeGreaterThan(-1);
    const helper = rekey.slice(start, rekey.indexOf('Human overrides across a rekey', start));
    expect(helper.length).toBeGreaterThan(0);
    // No ownership restriction, no spine join, no retirement / completeness proof.
    expect(helper).not.toMatch(/m\.source_id\s*=/);
    expect(helper).not.toMatch(/staging\.source_records|absent_since|completeScopeKeys|MatchRetirementEvidence/);
  });

  it('the planner asks BEFORE offering new_target, and never resolves a target from the candidates', () => {
    const start = plan.indexOf("if (resolution.outcome === 'unresolved') {");
    expect(start).toBeGreaterThan(-1);
    const block = plan.slice(start, plan.indexOf('return classifyResolvedMatch(', start));
    expect(block.indexOf('findPlausibleCanonicalFixtures(sql, identity)')).toBeGreaterThan(-1);
    expect(block.indexOf('findPlausibleCanonicalFixtures(sql, identity)'))
      .toBeLessThan(block.indexOf("mode: 'new_target'"));
    expect(block).toContain('reason: POSSIBLE_EXISTING_MATCH');
    expect(block).not.toMatch(/targetId:\s*(plausible|candidate)/);
  });

  it('the applier re-asks inside readFreshTarget() before a matches target is declared insertable, under FOR UPDATE', () => {
    const start = applier.indexOf('async function readFreshTarget(');
    const block = applier.slice(start, applier.indexOf("if (target.targetTable === 'match_period_scores') {", start));
    const ask = block.indexOf('findPlausibleCanonicalFixtures(');
    expect(ask).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(block.indexOf("identity: { status: 'new_target', entity: 'matches', targetKey }"));
    expect(block).toMatch(/true,\s*\);\s*if \(plausible\.length > 0\) return POSSIBLE_EXISTING_MATCH;/);
    // The refusal blocks the whole fixture, so the unit's dependent target refuses with the same reason.
    expect(applier).toMatch(/isRekeyRefusal\(fresh\) \|\| fresh === POSSIBLE_EXISTING_MATCH/);
  });

  it('only the AFL API match writer opts in: AFL Tables, the AFL API player unit and Brownlow never pass matchAmbiguity', () => {
    expect(writer).toContain('matchAmbiguity: isInsert');
    // The player unit is built later in the file and carries no ambiguity input.
    expect(writer.match(/matchAmbiguity:/g)).toHaveLength(1);
    for (const path of [
      'src/lib/acquisition/settle-afltables.ts',
      'src/lib/acquisition/afl-api-brownlow.ts',
    ]) {
      const source = readSource(path);
      expect(source).not.toContain('matchAmbiguity');
      expect(source).not.toContain('findPlausibleCanonicalFixtures');
    }
  });

  it('a refused match returns before any period, player or typed-projection write, and self-heal follows the refusal return', () => {
    const start = writer.indexOf("if (plan.match.status === 'refused') {");
    expect(start).toBeGreaterThan(-1);
    const refusal = writer.slice(start, writer.indexOf('await healMatchIdentityRefusal(tx, bundle.match.sourceRecordId, counters);', start));
    expect(refusal).toMatch(/\n    return;\r?\n  \}/); // CRLF-safe: worktrees check out with autocrlf
    expect(refusal).not.toMatch(/projectAflApiMatch|settlePlayerUnit|applyCanonicalUnit/);
    expect(writer).toContain('APPLY_FINDING_RESOLUTION.identityResolved');
  });
});

/* ------------------------------------------------------------------
 * AFLDB-ISSUE-244 I244-F029 — a stripped variable stays stripped
 *
 * The settle/acquisition units load .env through EnvironmentFile= and then
 * drop the credentials the job has no business holding through
 * UnsetEnvironment=. Every unit-invoked CLI then called its own private
 * loadEnv(), reopened the SAME .env and repopulated anything currently
 * unset — handing back exactly what systemd had just removed.
 *
 * These are the behaviour tests for the one shared loader that replaced
 * those five copies. They touch no database and no network.
 * ------------------------------------------------------------------ */

describe('AFLDB-ISSUE-244 F029 — the shared current-season .env loader', () => {
  const MANAGED = ['F029_TEST_VALUE', 'F029_TEST_SECRET', SKIP_DOTENV_ENV] as const;

  let scratch = '';
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved = {};
    for (const name of MANAGED) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
    scratch = mkdtempSync(join(tmpdir(), 'afldb-f029-'));
  });

  afterEach(() => {
    // No test variable may leak into the next case, or into the rest of the
    // suite: this file's other describes read the real process environment.
    for (const name of MANAGED) {
      const previous = saved[name];
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
    rmSync(scratch, { recursive: true, force: true });
  });

  const writeEnv = (body: string): void => {
    writeFileSync(join(scratch, '.env'), body, 'utf8');
  };

  it('A — populates a variable the process does not already hold', () => {
    writeEnv('F029_TEST_VALUE=from_file\n');
    loadEnv(scratch);
    expect(process.env.F029_TEST_VALUE).toBe('from_file');
  });

  it('B — never overwrites a value the process already holds', () => {
    // This is what keeps I244-F016 intact: a DSN systemd supplied wins over
    // whatever the file happens to say.
    process.env.F029_TEST_VALUE = 'already_set';
    writeEnv('F029_TEST_VALUE=from_file\n');
    loadEnv(scratch);
    expect(process.env.F029_TEST_VALUE).toBe('already_set');
  });

  it('C — skip mode does not rehydrate a variable that was stripped', () => {
    // The defect, reproduced: a secret the unit deliberately removed from the
    // environment must not come back out of the file.
    process.env.F029_TEST_SECRET = 'supplied_then_stripped';
    delete process.env.F029_TEST_SECRET; // systemd's UnsetEnvironment=
    writeEnv('F029_TEST_SECRET=should_not_load\n');

    process.env[SKIP_DOTENV_ENV] = '1';
    loadEnv(scratch);

    expect(process.env.F029_TEST_SECRET).toBeUndefined();
  });

  it('D — skip mode leaves an already-set value exactly as it was', () => {
    process.env.F029_TEST_VALUE = 'already_set';
    process.env[SKIP_DOTENV_ENV] = '1';
    writeEnv('F029_TEST_VALUE=from_file\n');
    loadEnv(scratch);
    expect(process.env.F029_TEST_VALUE).toBe('already_set');
  });

  it('E — skip mode needs no .env to exist at all', () => {
    process.env[SKIP_DOTENV_ENV] = '1';
    expect(() => loadEnv(join(scratch, 'no-such-checkout'))).not.toThrow();
    expect(process.env.F029_TEST_VALUE).toBeUndefined();
  });

  it('only "1" skips: any other value loads normally', () => {
    // The flag is an explicit opt-out set by the wrappers, not a
    // truthiness test that a stray "0" or "false" could silently satisfy.
    process.env[SKIP_DOTENV_ENV] = '0';
    writeEnv('F029_TEST_VALUE=from_file\n');
    loadEnv(scratch);
    expect(process.env.F029_TEST_VALUE).toBe('from_file');
  });

  it('preserves the parsing the five CLIs relied on before consolidation', () => {
    writeEnv([
      '# a comment',
      '',
      '   ',
      'not_an_assignment',
      '  F029_TEST_VALUE = postgres://u:p@h/db?a=b  ',
      '# F029_TEST_SECRET=commented_out',
    ].join('\r\n'));
    loadEnv(scratch);
    // Everything after the FIRST '=' is the value, so a DSN keeps its own.
    expect(process.env.F029_TEST_VALUE).toBe('postgres://u:p@h/db?a=b');
    // A commented assignment is not an assignment, and the CRLF of a Windows
    // checkout is trimmed rather than carried into the value.
    expect(process.env.F029_TEST_SECRET).toBeUndefined();
  });

  it('a missing .env is a no-op, not an error', () => {
    expect(() => loadEnv(join(scratch, 'no-such-checkout'))).not.toThrow();
    expect(process.env.F029_TEST_VALUE).toBeUndefined();
  });

  it('decides to skip before it opens the file, and never writes the flag', () => {
    // Both directions of "the skip is process-environment policy": the guard
    // precedes the read, and the loader never touches the flag itself (which
    // would let a .env value decide whether .env may be read).
    const loader = readSource('tools/current-season/load-env.ts').replace(/\r\n/g, '\n');
    const body = loader.slice(loader.indexOf('export function loadEnv('));
    const guard = body.indexOf("if (process.env[SKIP_DOTENV_ENV] === '1') return;");
    const read = body.indexOf('readFileSync(');
    expect(guard).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(guard);
    // The flag is the caller's policy; the loader reads it and nothing else.
    expect(body).not.toMatch(/process\.env\[SKIP_DOTENV_ENV\]\s*=[^=]/);
  });
});

describe('AFLDB-ISSUE-244 F029 — the unit-invoked CLIs share one loader', () => {
  for (const cliPath of [
    'tools/current-season/settle-afl-api.ts',
    'tools/current-season/settle-afl-api-brownlow.ts',
    'tools/current-season/acquire-afl-api.ts',
    'tools/current-season/acquire-afl-api-brownlow.ts',
    'tools/current-season/settle-afltables.ts',
    // AFLDB-ISSUE-232 O1: now invoked by the systemd Brownlow wrapper.
    'tools/current-season/settle-afl-api-fixtures.ts',
  ]) {
    it(`${cliPath} imports the shared loader and keeps no private copy`, () => {
      const cli = readSource(cliPath).replace(/\r\n/g, '\n');
      expect(cli).toMatch(/^import \{ loadEnv \} from '\.\/load-env';$/m);
      // A second, private implementation would silently reintroduce the
      // defect for whichever CLI kept it.
      expect(cli).not.toMatch(/function loadEnv\s*\(/);
      expect(cli).toContain('loadEnv(DEFAULT_PROJECT_ROOT)');
    });
  }
});

describe('AFLDB-ISSUE-244 F029 — the AFL API systemd wrappers set the skip flag', () => {
  for (const { script, unit } of [
    {
      script: 'deploy/afldb-settle-afl-api.sh',
      unit: 'deploy/afldb-settle-afl-api.service',
    },
    {
      script: 'deploy/afldb-settle-afl-api-brownlow.sh',
      unit: 'deploy/afldb-settle-afl-api-brownlow.service',
    },
  ]) {
    it(`${script} exports the flag under systemd, before its first Node invocation`, () => {
      const shell = readSource(script).replace(/\r\n/g, '\n');
      const guard = shell.indexOf('if [ -n "${INVOCATION_ID:-}" ]; then');
      const exported = shell.indexOf('export AFLDB_SKIP_DOTENV=1');
      const firstNode = shell.indexOf('"$NODE" "$TSX"');
      expect(guard).toBeGreaterThan(-1);
      expect(exported).toBeGreaterThan(guard);
      // Too late to matter if it lands after the CLI has already started.
      expect(firstNode).toBeGreaterThan(exported);
      // Conditional on systemd's own invocation context, never unconditional:
      // a manual run of the wrapper keeps its .env convenience.
      expect(shell).not.toMatch(/^export AFLDB_SKIP_DOTENV=1$/m);
    });

    it(`${unit} keeps stripping the credentials and declares no Environment= of its own`, () => {
      const source = readSource(unit);
      expect(source).toMatch(/^EnvironmentFile=/m);
      expect(source).toMatch(/^UnsetEnvironment=.*AFLDB_OWNER_DATABASE_URL/m);
      expect(source).toMatch(/^UnsetEnvironment=.*AFLDB_SESSION_SECRET/m);
      // The flag is carried by the wrapper, not by a tracked Environment=
      // line — the AFL Tables unit is already test-constrained against those,
      // and the three units stay the same shape.
      expect(source).not.toMatch(/^Environment=/m);
    });
  }
});

describe('AFLDB-ISSUE-232 D-232-1 = B + O1 — the scheduled Brownlow wrapper refreshes fixture identity itself', () => {
  const shell = readSource('deploy/afldb-settle-afl-api-brownlow.sh').replace(/\r\n/g, '\n');
  const unit = readSource('deploy/afldb-settle-afl-api-brownlow.service').replace(/\r\n/g, '\n');
  // Executable lines only: the header comments name every command too.
  const code = shell.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n');

  it('runs fixtures-only acquire -> fixtures settle -> Brownlow acquire -> Brownlow settle, in that order', () => {
    const steps = [
      'tools/current-season/acquire-afl-api.ts --season "$season" --fixtures-only',
      'tools/current-season/settle-afl-api-fixtures.ts',
      'tools/current-season/acquire-afl-api-brownlow.ts --season "$season"',
      'tools/current-season/settle-afl-api-brownlow.ts',
    ].map((needle) => code.indexOf(needle));
    for (const index of steps) expect(index).toBeGreaterThan(-1);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
    // Exactly four Node invocations: no fifth step (no revalidation, no match settle).
    expect(code.match(/"\$NODE" "\$TSX"/g)).toHaveLength(4);
  });

  it('hands each settle the label ITS OWN acquisition printed, never the other one', () => {
    expect(code).toContain('fixtures_label=$(printf \'%s\\n\' "$fixtures_output" | sed -n');
    expect(code).toContain('label=$(printf \'%s\\n\' "$acquire_output" | sed -n');
    expect(code).toMatch(/settle-afl-api-fixtures\.ts \\\n\s+--label "\$fixtures_label" --apply\n/);
    expect(code).toMatch(
      /settle-afl-api-brownlow\.ts \\\n\s+--label "\$label" --apply --auto-apply --use-fixture-identity\n/,
    );
    // Each label is checked non-empty before use.
    expect(code).toContain('if [ -z "$fixtures_label" ]; then');
    expect(code).toContain('if [ -z "$label" ]; then');
  });

  it('propagates every failure: set -eu, both acquisitions fail the run, the EXIT trap marks it', () => {
    expect(code).toMatch(/^set -eu$/m);
    expect(code).toMatch(/^trap report_failure EXIT$/m);
    expect(code).toContain('|| { printf \'%s\\n\' "$fixtures_output"; exit 1; }');
    expect(code).toContain('|| { printf \'%s\\n\' "$acquire_output"; exit 1; }');
    // The two settles run as plain commands under `set -e`: never masked.
    expect(code).not.toMatch(/settle-afl-api-(fixtures|brownlow)\.ts[^\n]*(\|\| true|; true)/);
    // Success is printed only after the last step.
    // (The monitoring block names the marker earlier; this is the echo.)
    expect(code.indexOf('echo "AFLDB_SETTLE_SUCCESS')).toBeGreaterThan(code.indexOf('settle-afl-api-brownlow.ts'));
  });

  it('keeps D-232-3: no automatic revalidation, and the unit still strips the revalidation secret', () => {
    expect(code).not.toMatch(/AFLDB_REVALIDATE_(URL|SECRET)|revalidateSeason|\/api\/revalidate|curl|wget/);
    expect(unit).toMatch(/^UnsetEnvironment=.*\bAFLDB_REVALIDATE_SECRET\b/m);
  });

  it('orders by the wrapper, not systemd: no After=/Requires=/Wants= on the match unit', () => {
    expect(unit).not.toMatch(/^(After|Requires|Wants|BindsTo)=.*afldb-settle-afl-api\.service/m);
  });

  it('its ReadWritePaths= covers both subtrees the run writes (fixtures and brownlow)', () => {
    const grants = [...unit.matchAll(/^ReadWritePaths=(.+)$/gm)].map((match) => match[1].trim());
    const covers = (path: string) => grants.some((grant) => path === grant || path.startsWith(`${grant}/`));
    expect(covers('/home/arm/projects/afldb/data/sources/afl_api/fixtures/afl-api-2026-2026-09-26-050000')).toBe(true);
    expect(covers('/home/arm/projects/afldb/data/sources/afl_api/brownlow/x')).toBe(true);
    // And nothing wider than the afl_api subtree.
    expect(covers('/home/arm/projects/afldb/data/sources/afltables/x')).toBe(false);
  });

  it('the unit still bounds a run below the 5-minute timer period', () => {
    const timeout = Number(/^TimeoutStartSec=(\d+)$/m.exec(unit)?.[1]);
    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThan(300);
  });
});
