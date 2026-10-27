/**
 * AFLDB V2 Stage 6 — the shadow PARITY comparison (packages/derived/src/shadow-parity.ts) and its
 * offline CLI (tools/v2/shadow-parity.ts), plus the table row-count inventory validators in
 * @afldb/domain. No database, no network, no clock.
 *
 * FIXTURES ARE SYNTHETIC. The manifest is tests/fixtures/v2/historical-manifest/before.synthetic.json
 * (invented counts and digests); the Coleman and Brownlow inputs are built here from invented
 * clubs, players, goals and votes (`Synthetic_Player_*`, `SYN_*`, season 2090 / the label 2024) and are
 * not any real season's result; the coverage export is built from the real committed registry and
 * its real evidence files (offline). Nothing here is AFL data, except that the V2-GAP-027 block
 * replays the committed AFL API provider fixtures (tests/afl-api-snapshot-fixture.ts) under SYNTHETIC
 * settle run results.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'vitest';

import {
  AFL_API_COUNTER_KEYS,
  buildAflApiReconciliationReport,
  parseAflApiIdentities,
  parseSourceFamilyRegistry,
  replayAflApiSnapshot,
  serialiseAflApiReconciliationReport,
  validateAflApiReconciliationReport,
} from '@afldb/acquisition';

import {
  COVERAGE_REGISTRY,
  TABLE_ROW_COUNTS_FORMAT,
  TableRowCountsFormatError,
  V2_ADDED_TABLES,
  isV2AddedTable,
  parseTableRowCounts,
  validateTableRowCounts,
  type CoverageEntry,
  type SeasonRegistry,
} from '@afldb/domain';
import {
  COLEMAN_DERIVATION_VERSION,
  SHADOW_PARITY_CHECK_IDS,
  SHADOW_PARITY_CHECK_IDS_BY_POLICY,
  SHADOW_PARITY_POLICY_VERSION,
  SHADOW_PARITY_POLICY_VERSIONS,
  SHADOW_PARITY_REPORT_FORMAT,
  SHADOW_PARITY_THRESHOLDS,
  buildColemanComparisonReport,
  buildCoverageRegistryExport,
  buildShadowParityReport,
  deriveColeman,
  parseColemanContract,
  parseCoverageRegistryExport,
  reconcileBrownlowSeason,
  renderShadowParitySummary,
  serialiseCoverageRegistryExport,
  serialiseShadowParityReport,
  shadowParityExitCode,
  shadowParityVerdict,
  validateCoverageRegistryExport,
  validateShadowParityReport,
  type BrownlowLeaderboardEntryInput,
  type BrownlowMatchContextInput,
  type BrownlowSeasonState,
  type BrownlowStoredTotalInput,
  type ColemanComparisonReport,
  type ColemanDerivationInput,
  type ColemanDerivationOutcome,
  type ColemanGoalFact,
  type ColemanIdentityRow,
  type ColemanMatchRow,
  type ColemanStoredWinner,
  type CoverageRegistryExport,
  type ShadowParityCheck,
  type ShadowParityCheckId,
  type ShadowParityInputFile,
  type ShadowParityInputs,
  type ShadowParityReport,
} from '@afldb/derived';
import { buildAflApiSettleBundle } from '@/lib/acquisition/settle-afl-api';

import { committedUnit, FIXTURE_SEASON, makeScratchProject, referenceJson } from './afl-api-snapshot-fixture';
import { USAGE, defaultDeps, parseCliArgs, runCli, type CliDeps } from '../tools/v2/shadow-parity';
import { APPROVED_BROWNLOW_ALTERNATIVE, comparePreservation, digest, releaseGates, REQUIRED_PUBLIC_QUERIES,
  REQUIRED_PRESERVED_TABLES, type PreservationSnapshot } from '../tools/v2/migration-preservation';
import { runReleaseGates } from '../tools/v2/release-gates';
import { assessFreshAcceptance, FRESH_ACCEPTANCE, verifyFreshEvidence } from '../tools/v2/fresh-rehearsal-acceptance';

const ROOT = process.cwd();
const NOW = '2026-10-20T00:00:00Z';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('owner migration separation: synthetic preservation policy', () => {
  const snapshot = (): PreservationSnapshot => ({ format: 'afldb.v2.preservation.1',
    scope: { backupSha256: digest('synthetic archive'), queryContractSha256: digest('synthetic contract'), seal: 2025, phase: 'migration' },
    tables: Object.fromEntries(REQUIRED_PRESERVED_TABLES.map(t => [t, { definition: digest(t), rows: [digest(`${t}:id=1,NULL,votes=3`)] }])),
    queries: Object.fromEntries(REQUIRED_PUBLIC_QUERIES.map(q => [q, digest(q)])) });
  const evidence = { result: 'PASS', evidence: ['synthetic contract-test reference'] };
  const functional = Object.fromEntries(['ingestion', 'publication', 'permissions', 'auditing', 'rollback'].map(k => [k, evidence]));
  describe('fresh 111–117 acceptance: synthetic boundary contracts', () => {
    const inputs = () => {
      const before = snapshot(); before.scope.backupSha256 = FRESH_ACCEPTANCE.archiveSha256;
      before.tables['staging.afl_api_brownlow_vote'] = { definition: digest('NOT NULL'), rows: [digest('eligible true')] };
      const after = clone(before);
      after.tables['staging.afl_api_brownlow_vote'].definition = digest('nullable');
      after.tables['public.brownlow_correction_receipts'] = { definition: digest('receipt'), rows: [] };
      after.tables['afldb_meta.schema_migrations'].rows.push(...Object.keys(FRESH_ACCEPTANCE.migrations).map(digest));
      const parity: Loose = clone(run({ brownlow: { before: [], after: [] } }));
      const rows: Loose = checkOf(parity as ShadowParityReport, 'table_row_counts');
      rows.status = 'fail'; rows.counts.fail = 1;
      rows.findings.push({ code: 'UNEXPECTED_TABLE_ADDED', severity: 'fail', subject: 'public.brownlow_correction_receipts',
        detail: 'absent before, present after (0 rows), and not a V2-added table' });
      parity.verdict = 'FAIL'; parity.summary = { pass: 3, fail: 1, incomplete: 1 };
      return { integrity: 'PASS' as const, before, after, parity, archiveSha256: FRESH_ACCEPTANCE.archiveSha256 as string,
        sourceRevision: FRESH_ACCEPTANCE.sourceRevision as string, baseline: 110, migrations: Object.keys(FRESH_ACCEPTANCE.migrations) };
    };
    it('accepts only the reviewed migration scope and keeps original failures and operational authority separate', () => {
      const report = assessFreshAcceptance(inputs());
      expect(report.reasons).toEqual([]);
      expect(report.migrationCompatibility).toBe('PASS');
      expect(report.originalStrict.migrationCompatibility).toBe('FAIL');
      expect(report.originalStrict.preservation.findings).toHaveLength(2);
      expect(report.stagedBrownlowComparator).toBe('INCOMPLETE');
      expect(report.productionOperational).toBe('INCOMPLETE');
      expect(report.productionDecision).toBe('NO-GO');
      expect(report.productionPrivileges.productionExecutionAuthorized).toBe(false);
    });
    it.each(['archive', 'source', 'baseline', 'range', 'file', 'missing', 'hash', 'schema', 'table', 'row', 'added row', 'output', 'brownlow'])('rejects %s outside the approval', kind => {
      const input = inputs();
      if (kind === 'archive') input.archiveSha256 = digest('other archive');
      if (kind === 'source') input.sourceRevision = '0'.repeat(40);
      if (kind === 'baseline') input.baseline = 109;
      if (kind === 'range') input.migrations.push('118_unreviewed.sql');
      if (kind === 'file') input.migrations[0] = '111_changed.sql';
      if (kind === 'missing') Object.assign(input, { integrity: 'INCOMPLETE' });
      if (kind === 'hash') Object.assign(input, { integrity: 'FAIL' });
      if (kind === 'schema') input.after.tables['public.matches'].definition = digest('unreviewed schema');
      if (kind === 'table') input.after.tables['public.unreviewed'] = { definition: digest('new'), rows: [] };
      if (kind === 'row') input.after.tables['public.brownlow_round_votes'].rows = [digest('changed vote')];
      if (kind === 'added row') input.after.tables['public.players'].rows.push(digest('unapproved player'));
      if (kind === 'output') input.after.queries.brownlow_raw = digest('different result');
      if (kind === 'brownlow') { (checkOf(input.parity as ShadowParityReport, 'brownlow') as Loose).status = 'fail'; input.parity.summary = { pass: 3, fail: 2, incomplete: 0 }; }
      expect(assessFreshAcceptance(input).migrationCompatibility).toBe('FAIL');
    });
    it('refuses an absent or substituted manifest before any claimed evidence can count', () => {
      const dir = mkdtempSync(join(tmpdir(), 'fresh-acceptance-'));
      try {
        expect(verifyFreshEvidence(dir, ROOT)).toBe('INCOMPLETE');
        writeFileSync(join(dir, 'evidence-manifest.sha256'), `${digest('made up')}  after.schema.sql\n`);
        expect(verifyFreshEvidence(dir, ROOT)).toBe('FAIL');
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  });
  it('accepts identical rows, additive V2 tables and retained existing rows', () => {
    const b = snapshot(), a = clone(b);
    a.tables['public.derived_award_results'] = { definition: digest('new'), rows: [digest('new result')] };
    a.tables['afldb_meta.schema_migrations'].rows.push(digest('migration 115'));
    expect(comparePreservation(b, a).result).toBe('PASS');
  });
  it.each(['public.matches', 'public.player_clubs', 'public.player_match_stats', 'public.brownlow_round_votes',
    'public.award_winners', 'public.auth_audit_log'])('fails lost rows/coverage in %s', table => {
    const b = snapshot(), a = clone(b); a.tables[table].rows = [];
    expect(releaseGates({ functional, parity: run(), before: b, after: a }).migrationCompatibility).toBe('FAIL');
  });
  it.each([
    ['stable-id', 'public.players'], ['event-label', 'public.matches'], ['raw-vote', 'public.brownlow_round_votes'],
    ['award-provenance', 'public.award_winners'], ['NULL-to-zero', 'public.brownlow_season_votes'],
  ])('fails equal-count content replacement: %s', (change, table) => {
    const b = snapshot(), a = clone(b); a.tables[table].rows = [digest(change)];
    expect(comparePreservation(b, a).result).toBe('FAIL');
  });
  it('preserves duplicate multiplicity', () => {
    const b = snapshot(), a = clone(b); b.tables['public.matches'].rows.push(b.tables['public.matches'].rows[0]);
    expect(comparePreservation(b, a).result).toBe('FAIL');
  });
  it('fails changed FK/column definitions and unexplained public query output', () => {
    const b = snapshot(), a = clone(b); a.tables['public.matches'].definition = digest('changed FK');
    a.queries.match_detail = digest('different output');
    expect(comparePreservation(b, a).findings).toEqual(['public.matches: DEFINITION_OR_RELATIONSHIP_CHANGED', 'match_detail: PUBLIC_OUTPUT_CHANGED']);
  });
  it('fails unexpected tables', () => {
    const b = snapshot(), a = clone(b); a.tables['public.unapproved'] = { definition: digest('d'), rows: [] };
    expect(comparePreservation(b, a).result).toBe('FAIL');
  });
  it('fails a dropped baseline table', () => {
    const b = snapshot(), a = clone(b); delete a.tables['public.clubs'];
    expect(comparePreservation(b, a)).toEqual({ result: 'FAIL', findings: ['public.clubs: TABLE_LOST'] });
  });
  it.each(['backupSha256', 'queryContractSha256', 'seal'] as const)('incomplete for unlike snapshot %s', key => {
    const b = snapshot(), a = clone(b);
    if (key === 'seal') a.scope.seal++; else a.scope[key] = digest('different');
    expect(comparePreservation(b, a).result).toBe('INCOMPLETE');
  });
  it('incomplete for missing required evidence, table or query', () => {
    expect(comparePreservation(undefined, snapshot()).result).toBe('INCOMPLETE');
    const a = snapshot(); delete a.queries.match_detail;
    expect(comparePreservation(snapshot(), a).result).toBe('INCOMPLETE');
    const b = snapshot(); delete b.tables['public.player_clubs'];
    expect(comparePreservation(b, snapshot()).result).toBe('INCOMPLETE');
    expect(releaseGates({}).backendAcceptance).toBe('INCOMPLETE');
  });
  it('reports strict and conformance failures separately from complete backend acceptance', () => {
    const report = releaseGates({ functional, parity: run(), before: snapshot(), after: snapshot() });
    expect(report.backendAcceptance).toBe('PASS');
    expect(report.strictGridley).toEqual({ result: 'FAIL', findings: 149 });
    expect(report.adjudicationConformance).toEqual({ result: 'FAIL', approved: 99, unapproved: 50 });
    expect(report.productionOperational).toBe('INCOMPLETE');
    expect(report.productionDecision).toBe('NO-GO');
  });
  it('cannot pass on missing functional contracts or missing legacy parity evidence', () => {
    const missingRollback = { ...functional, rollback: { result: 'PASS', evidence: [] } };
    expect(releaseGates({ functional: missingRollback, parity: run(), before: snapshot(), after: snapshot() }).backendAcceptance).toBe('INCOMPLETE');
    expect(releaseGates({ functional, before: snapshot(), after: snapshot() }).backendAcceptance).toBe('INCOMPLETE');
    expect(releaseGates({ functional, parity: { verdict: 'PASS' }, before: snapshot(), after: snapshot() }).backendAcceptance).toBe('INCOMPLETE');
  });
  it('offline release CLI writes incomplete evidence explicitly and refuses overwrites', () => {
    const dir = mkdtempSync(join(tmpdir(), 'v2-release-gates-'));
    try {
      const out = join(dir, 'gates.json');
      expect(runReleaseGates(['--out', out])).toBe(2);
      expect(JSON.parse(readFileSync(out, 'utf8')).migrationCompatibility).toBe('INCOMPLETE');
      expect(() => runReleaseGates(['--out', out])).toThrow();
      expect(() => runReleaseGates(['--unknown', 'x', '--out', out])).toThrow();
      const attestation = join(dir, 'functional.json');
      writeFileSync(attestation, JSON.stringify(Object.fromEntries(Object.keys(functional).map(k => [k,
        { result: 'PASS', evidence: ['does-not-exist/missing.json: absent proof'] }]))));
      const missing = join(dir, 'missing-proof-gates.json');
      expect(runReleaseGates(['--functional', attestation, '--out', missing])).toBe(2);
      expect(JSON.parse(readFileSync(missing, 'utf8')).backendFunctional).toBe('INCOMPLETE');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  describe('D-V2-BROWNLOW-ALT-1: scoped alternative to the unavailable staged Brownlow comparator', () => {
    const approvedSnapshot = (): PreservationSnapshot => {
      const s = snapshot(); s.scope.backupSha256 = APPROVED_BROWNLOW_ALTERNATIVE.archiveSha256; return s;
    };
    // The staged comparator is unavailable (no authentic staged seasons); the other four checks pass.
    const stagedUnavailable = (): ShadowParityReport => run({ brownlow: { before: [], after: [] } });
    const sha = digest('complete stored-only Brownlow reports');
    const part = { result: 'PASS', evidence: ['synthetic contract-test reference'] };
    const attestation = (): Loose => ({
      decision: 'D-V2-BROWNLOW-ALT-1', archiveSha256: APPROVED_BROWNLOW_ALTERNATIVE.archiveSha256,
      migrationScope: { from: 110, to: 115 }, rawVoteAuditPreservation: part,
      storedReports: { ...part, seasons: 98, beforeSha256: sha, afterSha256: sha },
      integration: { ...part, passed: 35, total: 35 }, unitReport: { ...part, passed: 159, total: 159 },
    });
    const gates = (over: Loose = {}) => releaseGates({ functional, parity: stagedUnavailable(), before: approvedSnapshot(),
      after: approvedSnapshot(), brownlowAlternative: attestation(), ...over });

    it('accepts migration compatibility for the exact archive and scope while the staged comparator stays INCOMPLETE', () => {
      const report = gates();
      expect(stagedUnavailable().verdict).toBe('INCOMPLETE');
      expect(report.stagedBrownlowComparator).toBe('INCOMPLETE');
      expect(report.brownlowAlternative.status).toBe('APPLIED');
      expect(report.migrationCompatibility).toBe('PASS');
      expect(report.migrationCompatibilityBasis).toBe('APPROVED_BROWNLOW_ALTERNATIVE');
      expect(report.backendAcceptance).toBe('PASS');
      expect(report.brownlowAlternative.notEstablished).toMatch(/authentic AFL API vote, identity or leaderboard/);
      expect(report.brownlowOperationalReconciliation).toMatch(/^OUTSTANDING/);
      // Gridley stays separate; production, operations and release authority are untouched.
      expect(report.strictGridley).toEqual({ result: 'FAIL', findings: 149 });
      expect(report.adjudicationConformance).toEqual({ result: 'FAIL', approved: 99, unapproved: 50 });
      expect(report.productionOperational).toBe('INCOMPLETE');
      expect(report.productionDecision).toBe('NO-GO');
    });
    it('cannot be satisfied by operational evidence alone: authentic Brownlow reconciliation is a required operational contract', () => {
      const ops = Object.fromEntries(['productionCompatibility', 'linux', 'hostBackupRestoreRollback', 'legacyWritersRetired',
        'issue316Sequence', 'explicitReleaseApproval'].map(k => [k, evidence]));
      expect(gates({ operational: ops }).productionOperational).toBe('INCOMPLETE');
      expect(gates({ operational: { ...ops, authenticBrownlowReconciliation: evidence } }).productionOperational).toBe('PASS');
    });
    it('is not applied without an attestation or when the staged comparator is simply not needed', () => {
      const none = gates({ brownlowAlternative: undefined });
      expect(none.brownlowAlternative.status).toBe('NOT_APPLIED');
      expect(none.migrationCompatibility).toBe('INCOMPLETE');
      const full = gates({ parity: run() });
      expect(full.brownlowAlternative.status).toBe('NOT_REQUIRED');
      expect(full.migrationCompatibilityBasis).toBe('ALL_CHECKS_PASS');
    });
    it('rejects any other archive, whether in the attestation or in the preservation snapshots', () => {
      const other = gates({ before: snapshot(), after: snapshot() });
      expect(other.brownlowAlternative.status).toBe('NOT_APPLIED');
      expect(other.migrationCompatibility).toBe('INCOMPLETE');
      const wrong = gates({ brownlowAlternative: { ...attestation(), archiveSha256: digest('another archive') } });
      expect(wrong.brownlowAlternative.status).toBe('NOT_APPLIED');
      expect(wrong.migrationCompatibility).toBe('INCOMPLETE');
    });
    it.each([[109, 115], [110, 114], [111, 115], [110, 116]])('rejects migration scope %i -> %i', (from, to) => {
      const report = gates({ brownlowAlternative: { ...attestation(), migrationScope: { from, to } } });
      expect(report.brownlowAlternative.status).toBe('NOT_APPLIED');
      expect(report.migrationCompatibility).toBe('INCOMPLETE');
    });
    it('rejects an attestation under another decision identifier', () => {
      expect(gates({ brownlowAlternative: { ...attestation(), decision: 'D-V2-OTHER' } }).migrationCompatibility).toBe('INCOMPLETE');
    });
    it.each(['rawVoteAuditPreservation', 'storedReports', 'integration', 'unitReport'])(
      'stays INCOMPLETE when %s lacks its evidence', key => {
        const a = attestation(); a[key] = { ...a[key], evidence: [] };
        const report = gates({ brownlowAlternative: a });
        expect(report.brownlowAlternative.status).toBe('NOT_APPLIED');
        expect(report.migrationCompatibility).toBe('INCOMPLETE');
      });
    it.each([
      ['a failed raw-vote/audit result', (a: Loose) => { a.rawVoteAuditPreservation = { ...part, result: 'FAIL' }; }],
      ['97 seasons rather than 98', (a: Loose) => { a.storedReports.seasons = 97; }],
      ['differing before/after report hashes', (a: Loose) => { a.storedReports.afterSha256 = digest('changed report'); }],
      ['a failing integration check', (a: Loose) => { a.integration.passed = 34; }],
      ['a failing unit/report check', (a: Loose) => { a.unitReport.passed = 158; }],
    ])('FAILS migration compatibility for %s', (_name, mutate) => {
      const a = attestation(); mutate(a);
      const report = gates({ brownlowAlternative: a });
      expect(report.brownlowAlternative.status).toBe('FAILED');
      expect(report.migrationCompatibility).toBe('FAIL');
      expect(report.backendAcceptance).toBe('FAIL');
    });
    it('never masks data loss, a changed public output or an unlike snapshot pair', () => {
      const lost = approvedSnapshot(); lost.tables['public.brownlow_round_votes'].rows = [];
      expect(gates({ after: lost }).migrationCompatibility).toBe('FAIL');
      const changed = approvedSnapshot(); changed.queries.brownlow_raw = digest('different output');
      expect(gates({ after: changed }).migrationCompatibility).toBe('FAIL');
      const unlike = approvedSnapshot(); unlike.scope.seal++;
      const report = gates({ after: unlike });
      expect(report.migrationCompatibility).toBe('INCOMPLETE');
      expect(report.brownlowAlternative.status).toBe('NOT_APPLIED');
    });
    it('covers only the Brownlow comparator: a failed or incomplete other check is not excused', () => {
      const coverageMissing = run({ brownlow: { before: [], after: [] }, coverage: { before: null, after: null } });
      const incomplete = gates({ parity: coverageMissing });
      expect(incomplete.brownlowAlternative.status).toBe('NOT_APPLIED');
      expect(incomplete.migrationCompatibility).toBe('INCOMPLETE');
      const moved = run({ coleman: { before: file('c-b.json', COLEMAN_AGREE), after: file('c-a.json', COLEMAN_AGREE) },
        brownlow: { before: [file('b.json', B_RECONCILED)], after: [file('a.json', B_TOTALS_MOVED)] } });
      expect(checkOf(moved, 'brownlow').status).toBe('fail');
      const failed = gates({ parity: moved });
      expect(failed.migrationCompatibility).toBe('FAIL');
      expect(failed.stagedBrownlowComparator).toBe('FAIL');
      expect(failed.migrationCompatibilityBasis).toBe('NOT_ESTABLISHED');
    });
    it('reaches PASS from the committed attestation through the offline CLI, and only with readable evidence', () => {
      const dir = mkdtempSync(join(tmpdir(), 'v2-brownlow-alt-'));
      try {
        const write = (name: string, doc: unknown): string => { const p = join(dir, name); writeFileSync(p, JSON.stringify(doc)); return p; };
        const inputs = ['--before', write('b.json', approvedSnapshot()), '--after', write('a.json', approvedSnapshot()),
          '--parity', write('p.json', stagedUnavailable()), '--functional', join(ROOT, 'docs/v2/migration-functional-evidence.json')];
        const committed = join(ROOT, 'docs/v2/evidence/brownlow-migration-alternative-attestation.json');
        const pass = join(dir, 'pass.json');
        expect(runReleaseGates([...inputs, '--brownlow-alternative', committed, '--out', pass])).toBe(0);
        const report = JSON.parse(readFileSync(pass, 'utf8'));
        expect(report.brownlowAlternative.status).toBe('APPLIED');
        expect(report.stagedBrownlowComparator).toBe('INCOMPLETE');
        expect(report.productionDecision).toBe('NO-GO');
        const unreadable = attestation(); unreadable.integration.evidence = ['does-not-exist/missing.json: absent proof'];
        const missing = join(dir, 'missing.json');
        expect(runReleaseGates([...inputs, '--brownlow-alternative', write('unreadable.json', unreadable), '--out', missing])).toBe(2);
        expect(JSON.parse(readFileSync(missing, 'utf8')).brownlowAlternative.status).toBe('NOT_APPLIED');
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  });
});
// A deliberately loose view of JSON documents, so tests can mutate them freely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

/* ------------------------------------------------------------------ *
 * Input builders (all SYNTHETIC)
 * ------------------------------------------------------------------ */

const file = (name: string, doc: unknown): ShadowParityInputFile => ({ label: name, text: JSON.stringify(doc) });

// ---- manifest --------------------------------------------------------------------------------
const MANIFEST: Loose = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/v2/historical-manifest/before.synthetic.json'), 'utf8'));
const manifestTable = (m: Loose, name: string): Loose => m.tables.find((t: Loose) => t.table === name);
const manifestBucket = (m: Loose, table: string, season: number | null): Loose =>
  manifestTable(m, table).buckets.find((b: Loose) => b.season === season);

// ---- row counts ------------------------------------------------------------------------------
function rowCounts(tables: { schema?: string; table: string; rows: number }[], over: Loose = {}): Loose {
  const sorted = tables
    .map((t) => ({ schema: t.schema ?? 'public', table: t.table, rows: t.rows }))
    .sort((a, b) => (`${a.schema}.${a.table}` < `${b.schema}.${b.table}` ? -1 : 1));
  return {
    format: TABLE_ROW_COUNTS_FORMAT,
    formatVersion: 1,
    status: 'complete',
    producedAt: '2026-10-19T00:00:00.000Z',
    source: { database: 'afldb_v2_shadow_test', serverVersion: '0.0 (synthetic)', transaction: 'repeatable read, read only, rolled back' },
    schemas: ['public'],
    tables: sorted,
    ...over,
  };
}
const BASE_TABLES = [{ table: 'clubs', rows: 40 }, { table: 'matches', rows: 16000 }, { table: 'players', rows: 13000 }];
const V2_TABLES = V2_ADDED_TABLES.map((t) => ({ schema: t.schema, table: t.table, rows: 0 }));
const ROWS_BEFORE = rowCounts(BASE_TABLES);
const ROWS_AFTER = rowCounts([...BASE_TABLES, ...V2_TABLES]);

// ---- Coleman (SYNTHETIC derivation, the same shape as tests/v2-coleman.test.ts) ---------------
const REGISTRY: SeasonRegistry = JSON.parse(readFileSync(join(ROOT, 'data/reference/seasons.json'), 'utf8'));
const CONTRACT = parseColemanContract(JSON.parse(readFileSync(join(ROOT, 'data/reference/coleman-derivation.json'), 'utf8')));
const C_SEASON = 2024; // a label only; the data below is invented.
const C_PLAYERS = [
  { id: 11, letter: 'A', club: 1 }, { id: 12, letter: 'B', club: 1 }, { id: 13, letter: 'C', club: 2 },
  { id: 14, letter: 'D', club: 2 }, { id: 15, letter: 'E', club: 3 }, { id: 16, letter: 'F', club: 3 },
  { id: 17, letter: 'G', club: 4 }, { id: 18, letter: 'H', club: 4 },
];
const C_MATCHES: ColemanMatchRow[] = [
  { matchId: 1, season: C_SEASON, roundType: 'home_and_away', homeClubId: 1, awayClubId: 2 },
  { matchId: 2, season: C_SEASON, roundType: 'home_and_away', homeClubId: 3, awayClubId: 4 },
  { matchId: 3, season: C_SEASON, roundType: 'home_and_away', homeClubId: 1, awayClubId: 3 },
  { matchId: 4, season: C_SEASON, roundType: 'home_and_away', homeClubId: 2, awayClubId: 4 },
];
const C_GOALS: Record<string, number> = { '11:1': 3, '11:3': 2, '12:1': 1, '13:1': 2, '13:4': 1, '14:4': 2, '15:2': 3, '16:3': 1, '17:2': 1, '17:4': 2 };
const synthPath = (letter: string): string => `players/S/Synthetic_Player_${letter}.html`;

function cFacts(over: Record<string, number> = {}): ColemanGoalFact[] {
  const goals: Record<string, number> = { ...C_GOALS, ...over };
  const facts: ColemanGoalFact[] = [];
  for (const m of C_MATCHES) {
    for (const p of C_PLAYERS) {
      if (p.club !== m.homeClubId && p.club !== m.awayClubId) continue;
      facts.push({ matchId: m.matchId, playerId: p.id, clubId: p.club, goals: goals[`${p.id}:${m.matchId}`] ?? 0 });
    }
  }
  return facts;
}
function cInput(over: Partial<ColemanDerivationInput> = {}): ColemanDerivationInput {
  const identities: ColemanIdentityRow[] = C_PLAYERS.map((p) => ({
    playerId: p.id, matchMethod: 'afltables_profile_url', externalId: synthPath(p.letter), status: 'unique',
  }));
  return {
    contract: CONTRACT,
    season: C_SEASON,
    seasonState: { registry: REGISTRY, settled: true },
    matches: C_MATCHES,
    playerMatchGoals: cFacts(),
    identities,
    derivedAt: NOW,
    derivationVersion: COLEMAN_DERIVATION_VERSION,
    ...over,
  };
}
const cStored = (over: Partial<ColemanStoredWinner> = {}): ColemanStoredWinner => ({
  season: C_SEASON, playerId: 11, sourceKey: 'afltables', sourceRecordId: `coleman:${C_SEASON}:${synthPath('A')}`, status: 'active', ...over,
});
const cReport = (outcomes: ColemanDerivationOutcome[], stored: ColemanStoredWinner[]): ColemanComparisonReport =>
  buildColemanComparisonReport({ generatedAt: NOW, outcomes, stored });
const C_OK = deriveColeman(cInput());
const C_REFUSED = deriveColeman(cInput({ seasonState: { registry: REGISTRY, settled: false } }));
const COLEMAN_AGREE = cReport([C_OK], [cStored()]);

/** A copy of a Coleman report with one extra season (a clone of the first), summary recomputed. */
function colemanWithSeason(report: ColemanComparisonReport, season: number): Loose {
  const copy = clone(report) as Loose;
  copy.seasons = [{ ...clone(copy.seasons[0]), season }, ...copy.seasons].sort((a: Loose, b: Loose) => a.season - b.season);
  copy.summary = {
    seasons: copy.seasons.length,
    agree: copy.seasons.filter((s: Loose) => s.category === 'agree').length,
    disagree: copy.seasons.filter((s: Loose) => s.category === 'disagree').length,
    notDerivable: copy.seasons.filter((s: Loose) => s.category === 'not_derivable').length,
  };
  return copy;
}

// ---- Brownlow (SYNTHETIC season 2090, the same shape as tests/v2-brownlow-reconciliation.test.ts) -
const B_CLUB: Record<number, number> = { 1001: 1, 1002: 2, 1003: 1, 1004: 3, 1005: 4, 1006: 3 };
const B_MATCHES = [
  { providerMatchId: 'SYN_M101', matchId: 101, round: 1, home: 1, away: 2 },
  { providerMatchId: 'SYN_M102', matchId: 102, round: 1, home: 3, away: 4 },
  { providerMatchId: 'SYN_M103', matchId: 103, round: 2, home: 1, away: 3 },
];
type BVotes = [[number, number, number], [number, number, number], [number, number, number]];
const B_BASE: BVotes = [[1001, 1002, 1003], [1004, 1005, 1006], [1001, 1004, 1003]];
const competitionRank = (totals: number[]): number[] => totals.map((v) => totals.indexOf(v) + 1);

function bInput(table: BVotes = B_BASE, over: Loose = {}): Loose {
  const matchVotes = B_MATCHES.map((m, i) => ({
    providerMatchId: m.providerMatchId,
    matchId: m.matchId,
    apiRoundNumber: m.round,
    canonicalRoundNumber: m.round,
    votes: ([3, 2, 1] as const).map((value, k) => ({
      providerPlayerId: `SYN_I${table[i][k]}`, providerTeamId: `SYN_T${B_CLUB[table[i][k]]}`,
      playerId: table[i][k], clubId: B_CLUB[table[i][k]], votes: value, eligible: true,
    })),
  }));
  const totals = new Map<number, number>();
  for (const m of matchVotes) for (const v of m.votes) totals.set(v.playerId, (totals.get(v.playerId) ?? 0) + v.votes);
  const ordered = [...totals].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const rank = competitionRank(ordered.map(([, v]) => v));
  const leaderboard: BrownlowLeaderboardEntryInput[] = ordered.map(([id, v], i) => ({
    providerPlayerId: `SYN_I${id}`, providerTeamId: `SYN_T${B_CLUB[id]}`, playerId: id, totalVotes: v,
    eligible: true, winner: false, leader: rank[i] === 1,
  }));
  const storedTotals: BrownlowStoredTotalInput[] = ordered.map(([id, v], i) => ({
    playerId: id, clubId: B_CLUB[id], votes: v, voteRank: rank[i], eligibleRank: rank[i], isIneligible: false, isWinner: rank[i] === 1,
  }));
  const matchContext: BrownlowMatchContextInput[] = B_MATCHES.map((m) => ({
    matchId: m.matchId, season: 2090, roundNumber: m.round, isFinal: false, homeClubId: m.home, awayClubId: m.away,
    homeProviderTeamId: `SYN_T${m.home}`, awayProviderTeamId: `SYN_T${m.away}`,
  }));
  return {
    season: 2090, seasonState: 'complete' as BrownlowSeasonState, generatedAt: NOW, matchVotes,
    leaderboard: { status: 'CONCLUDED', entries: leaderboard }, storedTotals, matchContext, ...over,
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bReport = (input: Loose): Loose => JSON.parse(JSON.stringify(reconcileBrownlowSeason(input as any)));

const B_RECONCILED = bReport(bInput());
const B_DISCREPANCIES = (() => { const i = bInput(); i.matchVotes = i.matchVotes.slice(0, 2); return bReport(i); })();
const B_REFUSED = (() => { const i = bInput(); i.matchVotes[1].votes[0].playerId = null; return bReport(i); })();
const B_IN_PROGRESS = bReport(bInput(B_BASE, { seasonState: 'in_progress' }));
const B_IN_PROGRESS_MOVED = bReport(bInput([[1001, 1002, 1003], [1004, 1005, 1006], [1004, 1001, 1003]], { seasonState: 'in_progress' }));
const B_TOTALS_MOVED = bReport(bInput([[1001, 1002, 1003], [1004, 1005, 1006], [1004, 1001, 1003]]));
const B_OTHER_SEASON = bReport(bInput(B_BASE, { season: 2091 }));

// ---- coverage --------------------------------------------------------------------------------
const diskReader = (path: string): string | null => {
  try {
    return readFileSync(join(ROOT, path), 'utf8');
  } catch {
    return null;
  }
};
const COVERAGE: CoverageRegistryExport = buildCoverageRegistryExport({
  producedAt: NOW, registry: COVERAGE_REGISTRY, seasons: REGISTRY, readFile: diskReader,
});

// ---- the whole input set ---------------------------------------------------------------------
function passingInputs(): ShadowParityInputs {
  return {
    manifest: { before: file('manifest-before.json', MANIFEST), after: file('manifest-after.json', MANIFEST) },
    rowCounts: { before: file('rc-before.json', ROWS_BEFORE), after: file('rc-after.json', ROWS_AFTER) },
    coleman: { before: file('coleman-before.json', COLEMAN_AGREE), after: file('coleman-after.json', COLEMAN_AGREE) },
    brownlow: { before: [file('brownlow-2090-before.json', B_RECONCILED)], after: [file('brownlow-2090-after.json', B_RECONCILED)] },
    coverage: { before: file('coverage-before.json', COVERAGE), after: file('coverage-after.json', COVERAGE) },
  };
}
type InputsOverride = { [K in keyof ShadowParityInputs]?: ShadowParityInputs[K] };
const run = (over: InputsOverride = {}, generatedAt = NOW): ShadowParityReport =>
  buildShadowParityReport({ ...passingInputs(), ...over }, generatedAt);
const checkOf = (report: ShadowParityReport, id: ShadowParityCheckId): ShadowParityCheck =>
  report.checks.find((c) => c.id === id) as ShadowParityCheck;
const codes = (check: ShadowParityCheck, severity?: 'fail' | 'info'): string[] =>
  check.findings.filter((f) => severity === undefined || f.severity === severity).map((f) => f.code).sort();

/** Manifest comparison with `mutate` applied to a copy of the after manifest. */
function manifestRun(mutate: (after: Loose) => void, beforeDoc: Loose = MANIFEST): ShadowParityCheck {
  const after = clone(MANIFEST);
  mutate(after);
  return checkOf(run({ manifest: { before: file('b.json', beforeDoc), after: file('a.json', after) } }), 'historical_manifest');
}
function rowsRun(before: Loose, after: Loose): ShadowParityCheck {
  return checkOf(run({ rowCounts: { before: file('b.json', before), after: file('a.json', after) } }), 'table_row_counts');
}
function colemanRun(before: unknown, after: unknown): ShadowParityCheck {
  return checkOf(run({ coleman: { before: file('b.json', before), after: file('a.json', after) } }), 'coleman');
}
function brownlowRun(before: Loose[], after: Loose[]): ShadowParityCheck {
  return checkOf(run({
    brownlow: { before: before.map((d, i) => file(`b${i}.json`, d)), after: after.map((d, i) => file(`a${i}.json`, d)) },
  }), 'brownlow');
}
function coverageRun(mutate: (after: Loose) => void): ShadowParityCheck {
  const after = clone(COVERAGE) as Loose;
  mutate(after);
  return checkOf(run({ coverage: { before: file('b.json', COVERAGE), after: file('a.json', after) } }), 'coverage');
}

/* ------------------------------------------------------------------ *
 * The baseline
 * ------------------------------------------------------------------ */

describe('the baseline: identical rehearsal artefacts', () => {
  const report = run();

  it('passes every required check; the V2-added tables are the only info findings', () => {
    expect(report.format).toBe(SHADOW_PARITY_REPORT_FORMAT);
    expect(report.policyVersion).toBe('v2.parity.1');
    expect(report.policyVersion).toBe(SHADOW_PARITY_POLICY_VERSION);
    expect(report.generatedAt).toBe(NOW);
    expect(report.verdict).toBe('PASS');
    expect(report.summary).toEqual({ pass: 5, fail: 0, incomplete: 0 });
    expect(report.checks.map((c) => c.id)).toEqual([...SHADOW_PARITY_CHECK_IDS]);
    expect(report.checks.every((c) => c.required === true && c.status === 'pass')).toBe(true);
    expect(codes(checkOf(report, 'table_row_counts'))).toEqual(V2_TABLES.map(() => 'V2_TABLE_ADDED'));
    for (const id of ['historical_manifest', 'coleman', 'brownlow', 'coverage'] as const) {
      expect(checkOf(report, id).findings).toEqual([]);
    }
    expect(validateShadowParityReport(JSON.parse(serialiseShadowParityReport(report)))).toEqual([]);
  });

  it('embeds the versioned thresholds and the input labels (basenames only)', () => {
    for (const check of report.checks) {
      expect(check.thresholds).toBe(SHADOW_PARITY_THRESHOLDS[check.id]);
      expect(check.thresholds).not.toContain('\n');
    }
    expect(checkOf(report, 'historical_manifest').thresholds).toContain('stable id');
    expect(checkOf(report, 'historical_manifest').inputs).toEqual({ before: 'manifest-before.json', after: 'manifest-after.json' });
    expect(checkOf(report, 'brownlow').inputs).toEqual({ before: ['brownlow-2090-before.json'], after: ['brownlow-2090-after.json'] });
    const pathy = run({ coverage: { before: { label: 'D:\\x\\y\\cov-b.json', text: JSON.stringify(COVERAGE) }, after: { label: '/tmp/z/cov-a.json', text: JSON.stringify(COVERAGE) } } });
    expect(checkOf(pathy, 'coverage').inputs).toEqual({ before: 'cov-b.json', after: 'cov-a.json' });
  });

  it('is deterministic: the same inputs and instant give byte-identical JSON, whatever the Brownlow file order', () => {
    const two = { before: [file('b-2090.json', B_RECONCILED), file('b-2091.json', B_OTHER_SEASON)], after: [file('a-2090.json', B_RECONCILED), file('a-2091.json', B_OTHER_SEASON)] };
    const flipped = { before: [two.before[1], two.before[0]], after: [two.after[1], two.after[0]] };
    const one = serialiseShadowParityReport(run({ brownlow: two }));
    expect(serialiseShadowParityReport(run({ brownlow: two }))).toBe(one);
    expect(serialiseShadowParityReport(run({ brownlow: flipped }))).toBe(one);
    expect(serialiseShadowParityReport(run())).toBe(serialiseShadowParityReport(run()));
  });

  it('takes generatedAt from the caller and refuses a malformed instant', () => {
    expect(run({}, '2030-01-02T03:04:05Z').generatedAt).toBe('2030-01-02T03:04:05Z');
    expect(() => run({}, 'yesterday')).toThrow(RangeError);
    expect(() => run({}, '2026-10-20')).toThrow(RangeError);
  });

  it('renders a human summary naming the verdict, every check and each finding', () => {
    const lines = renderShadowParitySummary(run({ rowCounts: { before: file('b.json', ROWS_BEFORE), after: file('a.json', rowCounts(BASE_TABLES)) } }));
    const text = lines.join('\n');
    expect(text).toContain('VERDICT: FAIL');
    expect(text).toContain('policy v2.parity.1');
    for (const id of SHADOW_PARITY_CHECK_IDS) expect(text).toContain(id);
    expect(text).toContain('V2_TABLE_ABSENT public.award_proposals');
    expect(renderShadowParitySummary(report).join('\n')).toContain('VERDICT: PASS');
  });
});

/* ------------------------------------------------------------------ *
 * 1. historical_manifest
 * ------------------------------------------------------------------ */

describe('historical_manifest: zero tolerance on sealed history', () => {
  it('passes identical manifests with no finding', () => {
    const c = manifestRun(() => undefined);
    expect(c.status).toBe('pass');
    expect(c.findings).toEqual([]);
  });

  it.each([
    ['ROWS_CHANGED', (m: Loose) => { manifestBucket(m, 'matches', 2024).rows += 1; }],
    ['KEYS_CHANGED', (m: Loose) => { manifestBucket(m, 'matches', 2024).keyDigest = '9'.repeat(64); }],
    ['FACTS_CHANGED', (m: Loose) => { manifestBucket(m, 'matches', 2024).factDigest = '9'.repeat(64); }],
    ['METADATA_CHANGED', (m: Loose) => { manifestBucket(m, 'matches', 2024).metadataDigest = '9'.repeat(64); }],
    ['REFERENCE_CHANGED', (m: Loose) => { manifestBucket(m, 'players', null).keyDigest = '9'.repeat(64); }],
    ['REFERENCE_ROWS_DECREASED', (m: Loose) => { manifestBucket(m, 'players', null).rows -= 1; }],
    ['METADATA_COLUMNS_CHANGED', (m: Loose) => { manifestTable(m, 'matches').metadataColumns = ['source_id']; }],
    ['SPEC_VERSION_DIFFERS', (m: Loose) => { m.specVersion = 2; }],
    ['TABLE_MISSING', (m: Loose) => { m.tables = m.tables.filter((t: Loose) => t.table !== 'players'); }],
    ['KIND_CHANGED', (m: Loose) => { manifestTable(m, 'players').kind = 'fact'; }],
    ['KEY_DEFINITION_CHANGED', (m: Loose) => { manifestTable(m, 'matches').key = ['row.id']; }],
    ['SEASON_DEFINITION_CHANGED', (m: Loose) => { manifestTable(m, 'matches').season = 'row.year'; }],
    ['FACT_COLUMNS_CHANGED', (m: Loose) => { manifestTable(m, 'matches').factColumns = ['id', 'season', 'match_key']; }],
    ['SEALED_RANGE_DIFFERS', (m: Loose) => { m.sealed.through = 2024; }],
  ])('%s is a FAIL finding and fails the check', (code, mutate) => {
    const c = manifestRun(mutate);
    expect(c.status).toBe('fail');
    const hit = c.findings.filter((f) => f.code === code);
    expect(hit.length).toBeGreaterThan(0);
    expect(hit.every((f) => f.severity === 'fail')).toBe(true);
  });

  it('maps every comparator severity (violation, unverified, review) to fail, and a moved seal too', () => {
    const violation = manifestRun((m) => { manifestBucket(m, 'matches', 2024).rows += 1; });
    expect(violation.findings[0].detail).toContain('comparator violation');
    expect(manifestRun((m) => { m.specVersion = 2; }).findings.some((f) => f.detail.startsWith('comparator review'))).toBe(true);
    expect(manifestRun((m) => { manifestTable(m, 'players').kind = 'fact'; }).findings.some((f) => f.detail.startsWith('comparator unverified'))).toBe(true);
    const seal = manifestRun((m) => { m.sealed.through = 2024; });
    expect(seal.findings.find((f) => f.code === 'SEALED_RANGE_DIFFERS')).toMatchObject({ severity: 'fail', detail: expect.stringContaining('comparator info') });
    expect(seal.counts.comparatorInfo).toBeGreaterThan(0);
  });

  it('OPEN_SEASON_CHANGED and TABLE_ADDED are info only, so the check still passes', () => {
    const open = manifestRun((m) => { manifestBucket(m, 'matches', 2026).factDigest = '9'.repeat(64); });
    expect(open.status).toBe('pass');
    expect(codes(open)).toEqual(['OPEN_SEASON_CHANGED']);
    expect(open.findings[0].severity).toBe('info');
    const added = manifestRun((m) => { m.tables.push({ ...clone(manifestTable(m, 'players')), table: 'brand_new_table' }); });
    expect(added.status).toBe('pass');
    expect(codes(added)).toEqual(['TABLE_ADDED']);
  });

  it('any change to a stable id surfaces as a fail (ids are digested as facts, reference tables whole)', () => {
    // A renumbered player id changes the reference digest of players; a renumbered match id changes the sealed fact digest.
    expect(manifestRun((m) => { manifestBucket(m, 'players', null).factDigest = 'a'.repeat(64); }).status).toBe('fail');
    expect(manifestRun((m) => { manifestBucket(m, 'player_match_stats', 2025).keyDigest = 'e'.repeat(64); }).status).toBe('fail');
  });

  it('reports the finding subject as table and season', () => {
    const c = manifestRun((m) => { manifestBucket(m, 'matches', 2025).rows += 1; });
    expect(c.findings[0]).toMatchObject({ code: 'ROWS_CHANGED', severity: 'fail', subject: 'matches 2025' });
    expect(c.counts).toMatchObject({ violation: 1, fail: 1, info: 0 });
  });
});

/* ------------------------------------------------------------------ *
 * 2. table_row_counts
 * ------------------------------------------------------------------ */

describe('table_row_counts', () => {
  it('passes a before without and an after with every V2-added table (info), nothing else changed', () => {
    const c = rowsRun(ROWS_BEFORE, ROWS_AFTER);
    expect(c.status).toBe('pass');
    expect(codes(c)).toEqual(V2_TABLES.map(() => 'V2_TABLE_ADDED'));
    expect(c.counts).toMatchObject({ fail: 0, info: V2_TABLES.length, tablesBefore: 3, tablesAfter: 3 + V2_TABLES.length });
  });

  it('SCHEMAS_DIFFER fails', () => {
    const c = rowsRun(ROWS_BEFORE, rowCounts([...BASE_TABLES, ...V2_TABLES], { schemas: ['aflw', 'public'], tables: rowCounts([...BASE_TABLES, ...V2_TABLES]).tables }));
    expect(codes(c, 'fail')).toEqual(['SCHEMAS_DIFFER']);
    expect(c.status).toBe('fail');
  });

  it('TABLE_DROPPED fails', () => {
    const c = rowsRun(ROWS_BEFORE, rowCounts([BASE_TABLES[0], BASE_TABLES[1], ...V2_TABLES]));
    expect(codes(c, 'fail')).toEqual(['TABLE_DROPPED']);
    expect(c.findings.find((f) => f.code === 'TABLE_DROPPED')?.subject).toBe('public.players');
  });

  it('UNEXPECTED_TABLE_ADDED fails; a V2-added table is V2_TABLE_ADDED instead', () => {
    const c = rowsRun(ROWS_BEFORE, rowCounts([...BASE_TABLES, ...V2_TABLES, { table: 'mystery', rows: 1 }]));
    expect(codes(c, 'fail')).toEqual(['UNEXPECTED_TABLE_ADDED']);
    expect(codes(c, 'info')).toEqual(V2_TABLES.map(() => 'V2_TABLE_ADDED'));
  });

  it('V2_TABLE_ABSENT fails when a V2-added table is missing from the after state', () => {
    const c = rowsRun(ROWS_BEFORE, rowCounts([...BASE_TABLES, ...V2_TABLES.filter((t) => t.table !== 'derived_award_results')]));
    expect(codes(c, 'fail')).toEqual(['V2_TABLE_ABSENT']);
    expect(c.findings.find((f) => f.code === 'V2_TABLE_ABSENT')?.subject).toBe('public.derived_award_results');
    // Before == after with no V2 tables is also a failure: the after state is always post migration 112.
    expect(rowsRun(ROWS_BEFORE, ROWS_BEFORE).status).toBe('fail');
  });

  it('a V2 table dropped after existing before reports both TABLE_DROPPED and V2_TABLE_ABSENT', () => {
    const c = rowsRun(ROWS_AFTER, ROWS_BEFORE);
    expect(codes(c, 'fail')).toEqual([...V2_TABLES.map(() => 'TABLE_DROPPED'), ...V2_TABLES.map(() => 'V2_TABLE_ABSENT')]);
  });

  it('ROWS_DECREASED fails in a non-V2 table; ROWS_INCREASED is info', () => {
    const fewer = rowsRun(ROWS_BEFORE, rowCounts([{ table: 'clubs', rows: 40 }, { table: 'matches', rows: 15999 }, { table: 'players', rows: 13000 }, ...V2_TABLES]));
    expect(codes(fewer, 'fail')).toEqual(['ROWS_DECREASED']);
    expect(fewer.status).toBe('fail');
    const more = rowsRun(ROWS_BEFORE, rowCounts([{ table: 'clubs', rows: 40 }, { table: 'matches', rows: 16001 }, { table: 'players', rows: 13000 }, ...V2_TABLES]));
    expect(more.status).toBe('pass');
    expect(codes(more, 'info')).toContain('ROWS_INCREASED');
  });

  it('any change in a V2-added table is V2_TABLE_ROWS_CHANGED info, including a decrease', () => {
    const grew = rowsRun(ROWS_AFTER, rowCounts([...BASE_TABLES, { table: 'award_proposals', rows: 4 }, ...V2_TABLES.slice(1)]));
    expect(grew.status).toBe('pass');
    expect(codes(grew)).toEqual(['V2_TABLE_ROWS_CHANGED']);
    const shrank = rowsRun(rowCounts([...BASE_TABLES, { table: 'award_proposals', rows: 4 }, ...V2_TABLES.slice(1)]), ROWS_AFTER);
    expect(shrank.status).toBe('pass');
    expect(codes(shrank)).toEqual(['V2_TABLE_ROWS_CHANGED']);
  });
});

/* ------------------------------------------------------------------ *
 * 3. coleman
 * ------------------------------------------------------------------ */

describe('coleman', () => {
  it('passes identical reports', () => {
    expect(colemanRun(COLEMAN_AGREE, COLEMAN_AGREE)).toMatchObject({ status: 'pass', findings: [], counts: { seasonsCompared: 1 } });
  });

  it('SEASON_MISSING fails (and the stored rows left without an outcome fail too)', () => {
    const c = colemanRun(COLEMAN_AGREE, cReport([], [cStored()]));
    expect(codes(c, 'fail')).toEqual(['SEASON_MISSING', 'STORED_SEASONS_WITHOUT_OUTCOME_CHANGED']);
  });

  it('CATEGORY_CHANGED and STORED_WINNERS_CHANGED fail when the stored winner is removed', () => {
    const c = colemanRun(COLEMAN_AGREE, cReport([C_OK], []));
    expect(codes(c, 'fail')).toEqual(['CATEGORY_CHANGED', 'STORED_WINNERS_CHANGED']);
    expect(c.findings.find((f) => f.code === 'CATEGORY_CHANGED')?.detail).toBe('agree -> disagree');
  });

  it('STORED_WINNERS_CHANGED alone fails when a stored row is re-stamped but the category stays agree', () => {
    const c = colemanRun(COLEMAN_AGREE, cReport([C_OK], [cStored({ sourceKey: 'other_source' })]));
    expect(codes(c)).toEqual(['STORED_WINNERS_CHANGED']);
    expect(c.status).toBe('fail');
  });

  it('stored rows compare as a set: order does not matter', () => {
    const two = cReport([C_OK], [cStored(), cStored({ playerId: 12, sourceRecordId: 'coleman:2024:extra' })]);
    const reordered = clone(two) as Loose;
    reordered.seasons[0].stored.reverse();
    expect(colemanRun(two, reordered).findings.filter((f) => f.code === 'STORED_WINNERS_CHANGED')).toEqual([]);
  });

  it('DERIVED_WINNERS_CHANGED and INPUT_CHANGED fail when the goals change the winner', () => {
    const tie = deriveColeman(cInput({ playerMatchGoals: cFacts({ '12:1': 5 }) }));
    const c = colemanRun(COLEMAN_AGREE, cReport([tie], [cStored()]));
    expect(codes(c, 'fail')).toContain('DERIVED_WINNERS_CHANGED');
    expect(codes(c, 'fail')).toContain('INPUT_CHANGED');
  });

  it('INPUT_CHANGED alone fails when the checksum moves but the winners do not', () => {
    const moved = deriveColeman(cInput({ playerMatchGoals: cFacts({ '18:2': 1 }) }));
    const c = colemanRun(COLEMAN_AGREE, cReport([moved], [cStored()]));
    expect(codes(c)).toEqual(['INPUT_CHANGED']);
    expect(c.status).toBe('fail');
  });

  it('PREEXISTING_DISAGREEMENT is info (owner reconciliation) when a season disagrees in both', () => {
    const disagree = cReport([C_OK], []);
    const c = colemanRun(disagree, disagree);
    expect(c.status).toBe('pass');
    expect(c.findings).toMatchObject([{ code: 'PREEXISTING_DISAGREEMENT', severity: 'info', subject: 'season 2024' }]);
    expect(c.findings[0].detail).toContain('V2-GAP-015');
  });

  it('PREEXISTING_NOT_DERIVABLE is info for the same refusal code; REFUSAL_CHANGED fails otherwise', () => {
    const refused = cReport([C_REFUSED], [cStored()]);
    const same = colemanRun(refused, refused);
    expect(same.status).toBe('pass');
    expect(codes(same)).toEqual(['PREEXISTING_NOT_DERIVABLE']);
    const other = clone(refused) as Loose;
    other.seasons[0].refusal.code = 'SOME_OTHER_REFUSAL';
    const changed = colemanRun(refused, other);
    expect(codes(changed, 'fail')).toEqual(['REFUSAL_CHANGED']);
  });

  it('SEASON_ADDED is info', () => {
    const c = colemanRun(COLEMAN_AGREE, colemanWithSeason(COLEMAN_AGREE, 2023));
    expect(c.status).toBe('pass');
    expect(c.findings).toMatchObject([{ code: 'SEASON_ADDED', severity: 'info', subject: 'season 2023' }]);
  });

  it('STORED_SEASONS_WITHOUT_OUTCOME_CHANGED fails', () => {
    const c = colemanRun(COLEMAN_AGREE, cReport([C_OK], [cStored(), cStored({ season: 2023, sourceRecordId: 'coleman:2023:x' })]));
    expect(codes(c)).toEqual(['STORED_SEASONS_WITHOUT_OUTCOME_CHANGED']);
    expect(c.findings[0].detail).toBe('[] -> [2023]');
  });
});

/* ------------------------------------------------------------------ *
 * 4. brownlow
 * ------------------------------------------------------------------ */

describe('brownlow', () => {
  it('the synthetic baselines have the outcomes the cases below rely on', () => {
    expect(B_RECONCILED.outcome).toBe('reconciled');
    expect(B_DISCREPANCIES.outcome).toBe('discrepancies');
    expect(B_REFUSED.outcome).toBe('refused');
    expect(B_IN_PROGRESS.source.seasonState).toBe('in_progress');
  });

  it('passes identical reports', () => {
    expect(brownlowRun([B_RECONCILED], [B_RECONCILED])).toMatchObject({ status: 'pass', findings: [], counts: { seasonsCompared: 1 } });
  });

  it('SEASON_MISSING fails for a complete season missing after', () => {
    const c = brownlowRun([B_RECONCILED, B_OTHER_SEASON], [B_RECONCILED]);
    expect(c.findings).toMatchObject([{ code: 'SEASON_MISSING', severity: 'fail', subject: 'season 2091' }]);
  });

  it('OUTCOME_CHANGED fails', () => {
    const c = brownlowRun([B_RECONCILED], [B_REFUSED]);
    expect(codes(c, 'fail')).toContain('OUTCOME_CHANGED');
    expect(c.findings.find((f) => f.code === 'OUTCOME_CHANGED')?.detail).toBe('reconciled -> refused');
  });

  it('PLAYER_TOTALS_CHANGED and AWARD_PRESENTATION_CHANGED fail when the votes move the leaders', () => {
    const c = brownlowRun([B_RECONCILED], [B_TOTALS_MOVED]);
    expect(codes(c, 'fail')).toEqual(['AWARD_PRESENTATION_CHANGED', 'PLAYER_TOTALS_CHANGED']);
    expect(c.status).toBe('fail');
  });

  it('AWARD_PRESENTATION_CHANGED alone fails when only the eligibility rule changes', () => {
    const rule = bReport(bInput(B_BASE, { eligibilityRule: 'stored_eligible_rank_one' }));
    expect(rule.awardResultPresentation.eligibilityRule).toBe('stored_eligible_rank_one');
    const c = brownlowRun([B_RECONCILED], [rule]);
    expect(codes(c)).toEqual(['AWARD_PRESENTATION_CHANGED']);
  });

  it('FINDINGS_CHANGED fails when the finding counts move', () => {
    const c = brownlowRun([B_DISCREPANCIES], [B_REFUSED]);
    expect(codes(c, 'fail')).toContain('FINDINGS_CHANGED');
    const same = brownlowRun([B_DISCREPANCIES], [B_DISCREPANCIES]);
    expect(codes(same, 'fail')).toEqual([]);
  });

  it('PREEXISTING_DISCREPANCIES and PREEXISTING_REFUSED are info when unchanged in both', () => {
    const d = brownlowRun([B_DISCREPANCIES], [B_DISCREPANCIES]);
    expect(d.status).toBe('pass');
    expect(d.findings).toMatchObject([{ code: 'PREEXISTING_DISCREPANCIES', severity: 'info' }]);
    const r = brownlowRun([B_REFUSED], [B_REFUSED]);
    expect(r.status).toBe('pass');
    expect(r.findings).toMatchObject([{ code: 'PREEXISTING_REFUSED', severity: 'info' }]);
  });

  it('a complete season that becomes in progress fails (SEASON_STATE_CHANGED)', () => {
    const c = brownlowRun([B_RECONCILED], [B_IN_PROGRESS]);
    expect(codes(c, 'fail')).toContain('SEASON_STATE_CHANGED');
  });

  it('an in-progress season may change: IN_PROGRESS_SEASON_CHANGED is info and the check passes', () => {
    const c = brownlowRun([B_IN_PROGRESS], [B_IN_PROGRESS_MOVED]);
    expect(c.status).toBe('pass');
    expect(c.findings).toMatchObject([{ code: 'IN_PROGRESS_SEASON_CHANGED', severity: 'info', subject: 'season 2090' }]);
    expect(brownlowRun([B_IN_PROGRESS], [B_IN_PROGRESS]).findings).toEqual([]);
    expect(brownlowRun([B_IN_PROGRESS, B_RECONCILED].slice(0, 1), [B_RECONCILED]).status).toBe('pass');
  });

  it('SEASON_ADDED is info', () => {
    const c = brownlowRun([B_RECONCILED], [B_RECONCILED, B_OTHER_SEASON]);
    expect(c.status).toBe('pass');
    expect(c.findings).toMatchObject([{ code: 'SEASON_ADDED', severity: 'info', subject: 'season 2091' }]);
  });

  it('a duplicate season on one side makes the check incomplete with INPUT_INVALID', () => {
    const c = brownlowRun([B_RECONCILED, B_RECONCILED], [B_RECONCILED]);
    expect(c.status).toBe('incomplete');
    expect(c.findings).toMatchObject([{ code: 'INPUT_INVALID', severity: 'fail', subject: 'before:b1.json' }]);
    expect(c.findings[0].detail).toContain('season 2090');
    expect(brownlowRun([B_RECONCILED], [B_RECONCILED, B_RECONCILED]).status).toBe('incomplete');
  });

  it('no Brownlow report on a side is INPUT_MISSING; inputs are listed by label', () => {
    const c = brownlowRun([B_RECONCILED], []);
    expect(c.status).toBe('incomplete');
    expect(c.findings).toMatchObject([{ code: 'INPUT_MISSING', subject: 'after' }]);
    expect(c.inputs).toEqual({ before: ['b0.json'], after: null });
  });
});

/* ------------------------------------------------------------------ *
 * 5. coverage
 * ------------------------------------------------------------------ */

describe('coverage', () => {
  it('passes identical exports', () => {
    expect(coverageRun(() => undefined)).toMatchObject({ status: 'pass', findings: [] });
    expect(COVERAGE.registryProblems).toEqual([]);
  });

  it('COVERAGE_REGISTRY_INVALID fails for registry problems on either side', () => {
    const after = coverageRun((a) => { a.registryProblems = ['fixtures 2020-2025: evidence file not found']; });
    expect(after.status).toBe('fail');
    expect(after.findings).toMatchObject([{ code: 'COVERAGE_REGISTRY_INVALID', severity: 'fail', subject: 'after' }]);
    const bad = clone(COVERAGE) as Loose;
    bad.registryProblems = ['p1', 'p2'];
    const before = checkOf(run({ coverage: { before: file('b.json', bad), after: file('a.json', bad) } }), 'coverage');
    expect(before.findings.map((f) => f.subject)).toEqual(['after', 'before']);
    expect(before.status).toBe('fail');
  });

  it('COVERAGE_CELL_MISSING fails when a cell is missing on either side', () => {
    const lostAfter = coverageRun((a) => { a.cells.splice(10, 1); });
    expect(codes(lostAfter)).toEqual(['COVERAGE_CELL_MISSING']);
    expect(lostAfter.findings[0].detail).toBe('covered before, absent after');
    const extraAfter = coverageRun((a) => {
      a.cells.push({ season: 2999, family: 'fixtures', status: 'api_verified' });
    });
    expect(codes(extraAfter)).toEqual(['COVERAGE_CELL_MISSING']);
    expect(extraAfter.findings[0].detail).toBe('covered after, absent before');
  });

  it('COVERAGE_CHANGED fails on any status change', () => {
    const c = coverageRun((a) => { a.cells[0].status = a.cells[0].status === 'api_verified' ? 'api_partial' : 'api_verified'; });
    expect(c.status).toBe('fail');
    expect(c.findings).toMatchObject([{ code: 'COVERAGE_CHANGED', severity: 'fail' }]);
    expect(c.counts.cellsChanged).toBe(1);
  });
});

describe('the coverage-registry export format', () => {
  const SMALL_SEASONS: SeasonRegistry = { first_season: 2000, last_season: 2002, in_progress_seasons: [2002] };
  const SMALL: readonly CoverageEntry[] = [
    { family: 'fixtures', from: 2000, through: 2002, status: 'api_verified', evidence: [{ kind: 'document', path: 'a.md', anchor: 'x' }], note: 'n' },
    { family: 'brownlow', from: 2000, through: 2001, status: 'api_verified', evidence: [{ kind: 'document', path: 'a.md', anchor: 'x' }], note: 'n' },
  ];

  it('builds one sorted cell per covered season and family, and records registry problems', () => {
    const built = buildCoverageRegistryExport({ producedAt: NOW, registry: SMALL, seasons: SMALL_SEASONS, readFile: () => 'x' });
    expect(built.cells).toEqual([
      { season: 2000, family: 'brownlow', status: 'api_verified' }, { season: 2000, family: 'fixtures', status: 'api_verified' },
      { season: 2001, family: 'brownlow', status: 'api_verified' }, { season: 2001, family: 'fixtures', status: 'api_verified' },
      { season: 2002, family: 'fixtures', status: 'api_verified' },
    ]);
    expect(built.registryProblems.length).toBeGreaterThan(0); // the tiny registry does not cover every family
    expect(validateCoverageRegistryExport(JSON.parse(serialiseCoverageRegistryExport(built)))).toEqual([]);
    const missingEvidence = buildCoverageRegistryExport({ producedAt: NOW, registry: SMALL, seasons: SMALL_SEASONS, readFile: () => null });
    expect(missingEvidence.registryProblems.some((p) => p.includes('evidence file not found'))).toBe(true);
    expect(() => buildCoverageRegistryExport({ producedAt: 'now', registry: SMALL, seasons: SMALL_SEASONS, readFile: () => 'x' })).toThrow(RangeError);
  });

  it('the real committed registry exports with zero problems, offline', () => {
    expect(COVERAGE.format).toBe('afldb.v2.coverage-registry-export');
    expect(COVERAGE.formatVersion).toBe(1);
    expect(COVERAGE.registryProblems).toEqual([]);
    expect(COVERAGE.cells.length).toBeGreaterThan(0);
    expect(validateCoverageRegistryExport(COVERAGE)).toEqual([]);
    expect(parseCoverageRegistryExport(serialiseCoverageRegistryExport(COVERAGE), 'x.json')).toEqual(COVERAGE);
  });

  it('the validator refuses malformed exports', () => {
    const bad = (mutate: (e: Loose) => void): string => {
      const e = clone(COVERAGE) as Loose;
      mutate(e);
      return validateCoverageRegistryExport(e).join(' | ');
    };
    expect(validateCoverageRegistryExport(null)).toEqual(['export must be an object.']);
    expect(bad((e) => { e.format = 'other'; })).toContain('export.format');
    expect(bad((e) => { e.formatVersion = 2; })).toContain('formatVersion');
    expect(bad((e) => { e.producedAt = 'x'; })).toContain('producedAt');
    expect(bad((e) => { e.registryProblems = [1]; })).toContain('registryProblems');
    expect(bad((e) => { delete e.cells; })).toContain('export.cells is required');
    expect(bad((e) => { e.cells = 'x'; })).toContain('export.cells must be an array');
    expect(bad((e) => { e.cells[0].family = 'nope'; })).toContain('export.cells[0]');
    expect(bad((e) => { e.cells[0].status = 'nope'; })).toContain('export.cells[0]');
    expect(bad((e) => { e.cells[1] = e.cells[0]; })).toContain('not strictly sorted');
    expect(bad((e) => { e.cells.reverse(); })).toContain('not strictly sorted');
  });
});

/* ------------------------------------------------------------------ *
 * Missing, invalid, and the verdict
 * ------------------------------------------------------------------ */

const MARKER = 'SECRET_MARKER_postgres://user:hunter2@host/db';
type Slot = { id: ShadowParityCheckId; set: (before: unknown, after: unknown) => InputsOverride; good: unknown };
const SLOTS: Slot[] = [
  { id: 'historical_manifest', good: MANIFEST, set: (b, a) => ({ manifest: { before: b as never, after: a as never } }) },
  { id: 'table_row_counts', good: ROWS_AFTER, set: (b, a) => ({ rowCounts: { before: b as never, after: a as never } }) },
  { id: 'coleman', good: COLEMAN_AGREE, set: (b, a) => ({ coleman: { before: b as never, after: a as never } }) },
  { id: 'coverage', good: COVERAGE, set: (b, a) => ({ coverage: { before: b as never, after: a as never } }) },
];

describe('an input that is missing, unreadable or invalid makes its check incomplete (never a pass)', () => {
  it.each(SLOTS)('$id: a missing input on either side is INPUT_MISSING', ({ id, set, good }) => {
    for (const [b, a] of [[null, file('a.json', good)], [file('b.json', good), null], [null, null]] as const) {
      const c = checkOf(run(set(b, a)), id);
      expect(c.status).toBe('incomplete');
      expect(codes(c)).toContain('INPUT_MISSING');
      expect(c.findings.every((f) => f.code === 'INPUT_MISSING')).toBe(true);
    }
    expect(checkOf(run(set(null, null)), id).inputs).toEqual({ before: null, after: null });
  });

  it.each(SLOTS)('$id: an unreadable file is INPUT_INVALID', ({ id, set, good }) => {
    const c = checkOf(run(set({ label: 'dir/b.json', text: null }, file('a.json', good))), id);
    expect(c.status).toBe('incomplete');
    expect(c.findings).toMatchObject([{ code: 'INPUT_INVALID', subject: 'before:b.json' }]);
    expect(c.inputs.before).toBe('b.json');
  });

  it.each(SLOTS)('$id: invalid JSON, a wrong format and a failed validator are INPUT_INVALID and echo no file content', ({ id, set, good }) => {
    const notJson: ShadowParityInputFile = { label: 'bad.json', text: `{ ${MARKER}` };
    const wrongFormat = file('wrong.json', { format: MARKER, formatVersion: 1 });
    const wrongVersion = file('ver.json', { ...(good as Loose), formatVersion: MARKER });
    const valueEcho = file('val.json', { ...(good as Loose), status: MARKER, generatedAt: MARKER, producedAt: MARKER });
    for (const bad of [notJson, wrongFormat, wrongVersion, valueEcho]) {
      const report = run(set(bad, file('a.json', good)));
      const c = checkOf(report, id);
      expect(c.status, `${id} ${bad.label}`).toBe('incomplete');
      expect(codes(c), `${id} ${bad.label}`).toEqual(['INPUT_INVALID']);
      expect(c.findings[0].detail).toContain(bad.label);
      expect(c.findings[0].severity).toBe('fail');
      expect(JSON.stringify(report)).not.toContain('SECRET_MARKER');
      expect(JSON.stringify(report)).not.toContain('hunter2');
      expect(renderShadowParitySummary(report).join('\n')).not.toContain('SECRET_MARKER');
    }
  });

  it('brownlow: unreadable, non-JSON and invalid files are INPUT_INVALID with no content echoed', () => {
    const report = run({
      brownlow: {
        before: [file('ok.json', B_RECONCILED), { label: 'x.json', text: null }, { label: 'y.json', text: MARKER }, file('z.json', { format: MARKER })],
        after: [file('a.json', B_RECONCILED)],
      },
    });
    const c = checkOf(report, 'brownlow');
    expect(c.status).toBe('incomplete');
    expect(c.findings.map((f) => f.subject)).toEqual(['before:x.json', 'before:y.json', 'before:z.json']);
    expect(JSON.stringify(report)).not.toContain('SECRET_MARKER');
  });

  it('an input failure never produces comparison findings for that check', () => {
    const c = checkOf(run({ rowCounts: { before: file('b.json', ROWS_BEFORE), after: null } }), 'table_row_counts');
    expect(c.findings).toHaveLength(1);
    expect(c.counts).toMatchObject({ fail: 1, info: 0 });
  });
});

describe('verdict precedence: fail beats incomplete beats pass', () => {
  it('any fail makes the verdict FAIL even when another check is incomplete', () => {
    const report = run({
      rowCounts: { before: file('b.json', ROWS_BEFORE), after: file('a.json', ROWS_BEFORE) }, // V2_TABLE_ABSENT -> fail
      coverage: { before: null, after: null }, // incomplete
    });
    expect(checkOf(report, 'table_row_counts').status).toBe('fail');
    expect(checkOf(report, 'coverage').status).toBe('incomplete');
    expect(report.verdict).toBe('FAIL');
    expect(report.summary).toEqual({ pass: 3, fail: 1, incomplete: 1 });
    expect(shadowParityExitCode(report.verdict)).toBe(1);
  });

  it('an incomplete check with no fail makes the verdict INCOMPLETE (exit 2)', () => {
    const report = run({ coleman: { before: null, after: null } });
    expect(report.verdict).toBe('INCOMPLETE');
    expect(shadowParityExitCode(report.verdict)).toBe(2);
  });

  it('with every input missing the verdict is INCOMPLETE, never PASS', () => {
    const report = buildShadowParityReport({
      manifest: { before: null, after: null }, rowCounts: { before: null, after: null }, coleman: { before: null, after: null },
      brownlow: { before: [], after: [] }, coverage: { before: null, after: null },
    }, NOW);
    expect(report.checks.every((c) => c.status === 'incomplete' && c.required)).toBe(true);
    expect(report.verdict).toBe('INCOMPLETE');
    expect(report.summary).toEqual({ pass: 0, fail: 0, incomplete: 5 });
  });

  it('shadowParityVerdict and the exit code follow the precedence', () => {
    const s = (...status: ('pass' | 'fail' | 'incomplete')[]) => status.map((x) => ({ status: x }));
    expect(shadowParityVerdict(s('pass', 'pass'))).toBe('PASS');
    expect(shadowParityVerdict(s('pass', 'incomplete'))).toBe('INCOMPLETE');
    expect(shadowParityVerdict(s('incomplete', 'fail', 'pass'))).toBe('FAIL');
    expect([shadowParityExitCode('PASS'), shadowParityExitCode('FAIL'), shadowParityExitCode('INCOMPLETE')]).toEqual([0, 1, 2]);
  });
});

describe('validateShadowParityReport', () => {
  const good = (): Loose => JSON.parse(serialiseShadowParityReport(run({ rowCounts: { before: file('b.json', ROWS_BEFORE), after: file('a.json', ROWS_BEFORE) } })));
  const problemsOf = (mutate: (r: Loose) => void): string => {
    const r = good();
    mutate(r);
    return validateShadowParityReport(r).join(' | ');
  };

  it('accepts a real report and refuses non-objects', () => {
    expect(validateShadowParityReport(good())).toEqual([]);
    expect(validateShadowParityReport(null)).toEqual(['report must be an object.']);
    expect(validateShadowParityReport([])).toEqual(['report must be an object.']);
  });

  it('refuses every malformed or inconsistent shape', () => {
    expect(problemsOf((r) => { delete r.verdict; })).toContain('report.verdict is required');
    expect(problemsOf((r) => { r.format = 'x'; })).toContain('report.format');
    expect(problemsOf((r) => { r.formatVersion = 2; })).toContain('formatVersion');
    expect(problemsOf((r) => { r.policyVersion = 'v9'; })).toContain('policyVersion');
    expect(problemsOf((r) => { r.generatedAt = 'now'; })).toContain('generatedAt');
    expect(problemsOf((r) => { r.verdict = 'MAYBE'; })).toContain('report.verdict must be one of');
    expect(problemsOf((r) => { r.verdict = 'PASS'; })).toContain('does not follow');
    expect(problemsOf((r) => { r.summary.fail = 0; })).toContain('summary does not match');
    expect(problemsOf((r) => { r.checks.pop(); })).toContain('exactly the 5 required checks');
    expect(problemsOf((r) => { r.checks.reverse(); })).toContain('.id must be');
    expect(problemsOf((r) => { r.checks[0].required = false; })).toContain('required must be true');
    expect(problemsOf((r) => { r.checks[0].thresholds = ''; })).toContain('thresholds');
    expect(problemsOf((r) => { r.checks[0].inputs = 5; })).toContain('inputs');
    expect(problemsOf((r) => { r.checks[0].status = 'bad'; })).toContain('status must be one of');
    expect(problemsOf((r) => { r.checks[1].status = 'pass'; })).toContain('findings imply');
    expect(problemsOf((r) => { r.checks[1].counts.fail = 99; })).toContain('counts.fail and counts.info');
    expect(problemsOf((r) => { r.checks[1].findings[0].severity = 'warn'; })).toContain('findings[0]');
    expect(problemsOf((r) => { r.checks[1].findings = 'x'; })).toContain('findings must be an array');
  });
});

/* ------------------------------------------------------------------ *
 * The table row-count inventory validators (@afldb/domain)
 * ------------------------------------------------------------------ */

describe('validateTableRowCounts / parseTableRowCounts', () => {
  const doc = (): Loose => clone(ROWS_AFTER);
  const refused = (mutate: (d: Loose) => void, expected: string | RegExp): void => {
    const d = doc();
    mutate(d);
    expect(() => validateTableRowCounts(d, 'inv.json')).toThrow(TableRowCountsFormatError);
    expect(() => validateTableRowCounts(d, 'inv.json')).toThrow(expected);
    expect(() => parseTableRowCounts(JSON.stringify(d), 'inv.json')).toThrow(expected);
  };

  it('accepts a valid inventory and returns it', () => {
    expect(validateTableRowCounts(doc(), 'inv.json')).toEqual(ROWS_AFTER);
    expect(parseTableRowCounts(JSON.stringify(ROWS_AFTER), 'inv.json')).toEqual(ROWS_AFTER);
    expect(validateTableRowCounts(rowCounts([{ table: 'empty_table', rows: 0 }]), 'inv.json').tables[0].rows).toBe(0);
  });

  it('refuses a wrong format or version, an incomplete status, and a non-object', () => {
    refused((d) => { d.format = 'afldb.v2.other'; }, /format is not/);
    refused((d) => { d.formatVersion = 2; }, /formatVersion is not 1/);
    refused((d) => { d.status = 'incomplete'; }, /status is not "complete"/);
    refused((d) => { d.status = 'partial'; }, /status is not "complete"/);
    expect(() => validateTableRowCounts([], 'inv.json')).toThrow(/not a JSON object/);
    expect(() => parseTableRowCounts('{ not json', 'inv.json')).toThrow(/not valid JSON/);
  });

  it('refuses a duplicate table, unsorted tables, negative or non-integer rows, and an unlisted schema', () => {
    refused((d) => { d.tables.push({ ...d.tables[d.tables.length - 1] }); }, /appears twice/);
    refused((d) => { d.tables.reverse(); }, /not sorted/);
    refused((d) => { d.tables[0].rows = -1; }, /non-negative safe integer/);
    refused((d) => { d.tables[0].rows = 1.5; }, /non-negative safe integer/);
    refused((d) => { d.tables[0].rows = '5'; }, /non-negative safe integer/);
    refused((d) => { d.tables[0].rows = Number.MAX_SAFE_INTEGER + 2; }, /non-negative safe integer/);
    refused((d) => { d.tables.push({ schema: 'zeta', table: 'z', rows: 1 }); }, /schema is not in schemas/);
  });

  it('refuses a malformed header: producedAt, source, schemas, empty tables', () => {
    refused((d) => { d.producedAt = 'x'; }, /producedAt/);
    refused((d) => { d.source = { database: '' }; }, /source must state/);
    refused((d) => { d.schemas = []; }, /schemas must be a non-empty list/);
    refused((d) => { d.schemas = ['public', 'public']; }, /lists a schema twice/);
    refused((d) => { d.tables = []; }, /tables must be a non-empty list/);
    refused((d) => { d.tables[0].table = 'Bad-Name'; }, /valid schema and table name/);
  });

  it('knows exactly the five V2-added tables', () => {
    expect(V2_ADDED_TABLES.map((t) => t.table)).toEqual(['award_proposals', 'award_proposal_decisions', 'derived_award_results', 'brownlow_eligibility_decisions', 'derived_award_projections']);
    expect(isV2AddedTable('public', 'award_proposals')).toBe(true);
    expect(isV2AddedTable('other', 'award_proposals')).toBe(false);
    expect(isV2AddedTable('public', 'matches')).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 6. afl_api_reconciliation — policy v2.parity.2 (V2-GAP-027)
 *
 * DATA. The bundle is replayed from the hash-bound snapshot built from the committed provider
 * fixtures (tests/afl-api-snapshot-fixture.ts). The settle RUN RESULTS are SYNTHETIC (no settle
 * runs here); they exist to exercise the comparison rules, never to evidence a settle.
 * ------------------------------------------------------------------ */

const aflScratch: string[] = [];
afterAll(() => {
  for (const dir of aflScratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const AFL_REPLAY = (() => {
  const made = makeScratchProject('parity-afl-api', [committedUnit()]);
  aflScratch.push(made.projectRoot);
  return replayAflApiSnapshot({
    snapshotDir: made.snapshotDir,
    registry: parseSourceFamilyRegistry(referenceJson('source-families.json')),
    identities: parseAflApiIdentities(referenceJson('afl-api-identities.json')),
    buildBundle: buildAflApiSettleBundle,
  });
})();

/** A SYNTHETIC dry-run report over the replayed bundle; `over` edits the run before it is built. */
function aflReport(over: (run: Loose) => void = () => undefined, season = FIXTURE_SEASON): Loose {
  const counters: Loose = {};
  for (const key of AFL_API_COUNTER_KEYS) counters[key] = key === 'recordsDeferred' || key === 'seasonFeedStatusCounts' ? {} : 0;
  counters.snapshotMatches = AFL_REPLAY.bundle.units.length;
  const run: Loose = {
    applied: false, batchId: null, counters, halt: null, rollbackReason: 'dry_run', refusalEvidence: [],
  };
  over(run);
  return JSON.parse(serialiseAflApiReconciliationReport(buildAflApiReconciliationReport({
    generatedAt: NOW, mode: run.applied ? 'apply' : 'dry_run',
    bundle: { ...AFL_REPLAY.bundle, season }, manifestSha256: AFL_REPLAY.manifestSha256,
    run: run as never, exceptions: null,
  })));
}

const AFL_SYNTHETIC_REFUSAL = {
  family: 'match', externalRecordId: 'CD_M20260142801', targetTable: 'matches',
  refusal: 'no_canonical_match', matchKey: '2026-R1-SYN', renderedFields: ['attendance'], ownerSourceKey: null,
};

const V2_OPTIONS = { policyVersion: 'v2.parity.2', validateAflApiReport: validateAflApiReconciliationReport } as const;
const runV2 = (aflApi: ShadowParityInputs['aflApi'], over: InputsOverride = {}): ShadowParityReport =>
  buildShadowParityReport({ ...passingInputs(), ...over, aflApi }, NOW, V2_OPTIONS);
function aflRun(before: Loose[], after: Loose[]): ShadowParityCheck {
  return checkOf(runV2({
    before: before.map((d, i) => file(`afl-b${i}.json`, d)), after: after.map((d, i) => file(`afl-a${i}.json`, d)),
  }), 'afl_api_reconciliation');
}

describe('policy compatibility: v2.parity.1 stays the default and unchanged', () => {
  it('an explicit v2.parity.1 gives byte-identical output to the default; v2.parity.2 adds exactly one check', () => {
    const v1 = serialiseShadowParityReport(run());
    expect(serialiseShadowParityReport(buildShadowParityReport(passingInputs(), NOW, { policyVersion: 'v2.parity.1' }))).toBe(v1);
    expect(serialiseShadowParityReport(buildShadowParityReport({ ...passingInputs(), aflApi: { before: [], after: [] } }, NOW))).toBe(v1);
    expect(SHADOW_PARITY_POLICY_VERSIONS).toEqual(['v2.parity.1', 'v2.parity.2']);
    expect(SHADOW_PARITY_CHECK_IDS_BY_POLICY['v2.parity.1']).toEqual([...SHADOW_PARITY_CHECK_IDS]);
    const v2 = runV2({ before: [file('b.json', aflReport())], after: [file('a.json', aflReport())] });
    expect(v2.policyVersion).toBe('v2.parity.2');
    expect(v2.checks.map((c) => c.id)).toEqual([...SHADOW_PARITY_CHECK_IDS, 'afl_api_reconciliation']);
    expect(v2.checks.slice(0, 5)).toEqual(run().checks);
    expect(v2.verdict).toBe('PASS');
    expect(v2.summary).toEqual({ pass: 6, fail: 0, incomplete: 0 });
    expect(validateShadowParityReport(JSON.parse(serialiseShadowParityReport(v2)))).toEqual([]);
  });

  it('the retained real v2.parity.1 report still validates unchanged', () => {
    const evidence = JSON.parse(readFileSync(join(ROOT, 'docs/v2/evidence/fresh-rehearsal-acceptance-2026-10-21.json'), 'utf8'));
    expect(evidence.retainedOriginalParityReport.policyVersion).toBe('v2.parity.1');
    expect(validateShadowParityReport(evidence.retainedOriginalParityReport)).toEqual([]);
  });

  it('refuses AFL API reports under v2.parity.1, v2.parity.2 without the validator, and an unknown policy', () => {
    const one = { before: [file('b.json', aflReport())], after: [file('a.json', aflReport())] };
    expect(() => buildShadowParityReport({ ...passingInputs(), aflApi: one }, NOW)).toThrow(/only under policy v2.parity.2/);
    expect(() => buildShadowParityReport(passingInputs(), NOW, { policyVersion: 'v2.parity.2' })).toThrow(/needs the AFL API reconciliation report validator/);
    expect(() => buildShadowParityReport(passingInputs(), NOW, { policyVersion: 'v9' as never })).toThrow(RangeError);
  });

  it('the validator holds each policy to its own check list', () => {
    const v2 = JSON.parse(serialiseShadowParityReport(runV2({ before: [file('b.json', aflReport())], after: [file('a.json', aflReport())] })));
    const asV1 = { ...clone(v2), policyVersion: 'v2.parity.1' };
    expect(validateShadowParityReport(asV1).join(' | ')).toContain('exactly the 5 required checks');
    const v1 = JSON.parse(serialiseShadowParityReport(run()));
    expect(validateShadowParityReport({ ...v1, policyVersion: 'v2.parity.2' }).join(' | ')).toContain('exactly the 6 required checks');
  });
});

describe('afl_api_reconciliation (policy v2.parity.2)', () => {
  it('passes identical reports; generatedAt and batchId are ignored', () => {
    const later = aflReport((r) => { r.applied = true; r.batchId = '7'; r.rollbackReason = null; });
    const earlier = aflReport((r) => { r.applied = true; r.batchId = '6'; r.rollbackReason = null; });
    later.generatedAt = '2030-01-01T00:00:00Z';
    const c = aflRun([earlier], [later]);
    expect(c.status).toBe('pass');
    expect(c.findings).toEqual([]);
    expect(c.counts).toMatchObject({ seasonsBefore: 1, seasonsAfter: 1, seasonsCompared: 1 });
    expect(c.thresholds).toBe(SHADOW_PARITY_THRESHOLDS.afl_api_reconciliation);
  });

  it('is INCOMPLETE when a side is missing or a file fails the injected validator, never PASS', () => {
    expect(aflRun([], []).status).toBe('incomplete');
    expect(codes(aflRun([aflReport()], []))).toEqual(['INPUT_MISSING']);
    const broken = aflReport();
    delete broken.counters;
    const c = aflRun([aflReport()], [broken]);
    expect(c.status).toBe('incomplete');
    expect(c.findings[0]).toMatchObject({ code: 'INPUT_INVALID', subject: 'after:afl-a0.json' });
    expect(c.findings[0].detail).toContain('report.counters is required');
    expect(aflRun([aflReport()], [B_RECONCILED]).findings[0].code).toBe('INPUT_INVALID');
    const twice = aflRun([aflReport(), aflReport()], [aflReport()]);
    expect(twice.findings.map((f) => f.detail).join(' ')).toContain('one report per season per side');
  });

  it('FAILS a changed counter, naming the counter', () => {
    const c = aflRun([aflReport()], [aflReport((r) => { r.counters.canonicalRowsInserted = 2; })]);
    expect(c.status).toBe('fail');
    expect(c.findings).toEqual([{ code: 'COUNTER_CHANGED', severity: 'fail', subject: `season ${FIXTURE_SEASON} canonicalRowsInserted`, detail: '0 -> 2' }]);
  });

  it('FAILS a different snapshot, an unidentified snapshot, mode, applied and rollback changes', () => {
    const relabelled = aflReport();
    relabelled.source.snapshotLabel = 'another-snapshot';
    expect(codes(aflRun([aflReport()], [relabelled]))).toEqual(['SNAPSHOT_DIFFERS']);
    const unidentified = aflReport();
    unidentified.source.manifestSha256 = null;
    expect(codes(aflRun([aflReport()], [unidentified]))).toEqual(['SNAPSHOT_UNIDENTIFIED']);
    const applied = aflReport((r) => { r.applied = true; r.batchId = '9'; r.rollbackReason = null; });
    expect(codes(aflRun([aflReport()], [applied]))).toEqual(['APPLIED_CHANGED', 'MODE_DIFFERS', 'ROLLBACK_REASON_CHANGED']);
  });

  it('FAILS a HALT that appears; a HALT unchanged in both is info', () => {
    const halted = aflReport((r) => { r.halt = { reason: 'synthetic_halt', detail: {} }; r.rollbackReason = null; });
    const appeared = aflRun([aflReport()], [halted]);
    expect(codes(appeared, 'fail')).toEqual(['HALT_CHANGED', 'ROLLBACK_REASON_CHANGED']);
    const both = aflRun([halted], [halted]);
    expect(both.status).toBe('pass');
    expect(codes(both, 'info')).toEqual(['PREEXISTING_HALT']);
  });

  it('FAILS changed refusals, season feed or build failures; unchanged refusals are info', () => {
    const refused = aflReport((r) => { r.refusalEvidence = [AFL_SYNTHETIC_REFUSAL]; r.counters.canonicalApplyRefusals = 1; });
    expect(codes(aflRun([aflReport()], [refused]), 'fail')).toEqual(['COUNTER_CHANGED', 'REFUSALS_CHANGED']);
    expect(codes(aflRun([refused], [refused]), 'info')).toEqual(['PREEXISTING_REFUSALS']);
    const feed = aflReport();
    feed.seasonFeed.gaps = [];
    feed.seasonFeed.complete = true;
    expect(codes(aflRun([aflReport()], [feed]))).toEqual(['SEASON_FEED_CHANGED']);
    const failed = aflReport();
    failed.buildFailures = [{ providerMatchId: 'CD_M20260142802', error: 'synthetic' }];
    expect(codes(aflRun([aflReport()], [failed]))).toEqual(['BUILD_FAILURES_CHANGED']);
  });

  it('FAILS an exception report on one side only or with changed finding counts', () => {
    const exceptions = {
      sourceKey: 'afl_api', season: FIXTURE_SEASON, latestBatch: { id: '1' }, unresolvedRecords: [],
      candidates: { active: [], moot: [] }, applyFailures: [], disagreements: [], findingsTruncated: false, deferredRecords: {},
    };
    const withExceptions = { ...aflReport(), exceptions };
    expect(codes(aflRun([aflReport()], [withExceptions]))).toEqual(['EXCEPTIONS_CHANGED']);
    const otherBatch = { ...aflReport(), exceptions: { ...exceptions, latestBatch: { id: '2' } } };
    expect(aflRun([withExceptions], [otherBatch]).status).toBe('pass'); // batch identity never compared
    const moreCandidates = { ...aflReport(), exceptions: { ...exceptions, candidates: { active: [{}], moot: [] } } };
    expect(codes(aflRun([withExceptions], [moreCandidates]))).toEqual(['EXCEPTIONS_CHANGED']);
  });

  it('FAILS a season missing after; a season only after is info', () => {
    expect(codes(aflRun([aflReport(), aflReport(undefined, 2091)], [aflReport()]))).toEqual(['SEASON_MISSING']);
    const added = aflRun([aflReport()], [aflReport(), aflReport(undefined, 2091)]);
    expect(added.status).toBe('pass');
    expect(codes(added, 'info')).toEqual(['SEASON_ADDED']);
  });
});

/* ------------------------------------------------------------------ *
 * The CLI
 * ------------------------------------------------------------------ */

describe('tools/v2/shadow-parity.ts', () => {
  const scratches: string[] = [];
  afterEach(() => {
    while (scratches.length) rmSync(scratches.pop() as string, { recursive: true, force: true });
  });
  const scratch = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'afldb-v2-parity-'));
    scratches.push(dir);
    return dir;
  };
  const deps = (over: Partial<CliDeps> = {}): CliDeps => ({ ...defaultDeps(), now: () => NOW, repoRoot: ROOT, ...over });
  const put = (dir: string, name: string, doc: unknown): string => {
    const path = join(dir, name);
    writeFileSync(path, typeof doc === 'string' ? doc : JSON.stringify(doc));
    return path;
  };

  /** Writes the whole passing input set and returns the compare argv (without --out). */
  function writeSet(dir: string, over: { manifestAfter?: unknown; skip?: string[] } = {}): string[] {
    const flags: [string, string][] = [
      ['--manifest-before', put(dir, 'm-b.json', MANIFEST)],
      ['--manifest-after', put(dir, 'm-a.json', over.manifestAfter ?? MANIFEST)],
      ['--row-counts-before', put(dir, 'r-b.json', ROWS_BEFORE)],
      ['--row-counts-after', put(dir, 'r-a.json', ROWS_AFTER)],
      ['--coleman-before', put(dir, 'c-b.json', COLEMAN_AGREE)],
      ['--coleman-after', put(dir, 'c-a.json', COLEMAN_AGREE)],
      ['--brownlow-before', put(dir, 'bw-b1.json', B_RECONCILED)],
      ['--brownlow-before', put(dir, 'bw-b2.json', B_OTHER_SEASON)],
      ['--brownlow-after', put(dir, 'bw-a1.json', B_RECONCILED)],
      ['--brownlow-after', put(dir, 'bw-a2.json', B_OTHER_SEASON)],
      ['--coverage-before', put(dir, 'v-b.json', COVERAGE)],
      ['--coverage-after', put(dir, 'v-a.json', COVERAGE)],
    ];
    return flags.filter(([flag]) => !(over.skip ?? []).includes(flag)).flat();
  }

  it('exit 0 on PASS: writes a valid report and the human summary, and prints the summary', () => {
    const dir = scratch();
    const out = join(dir, 'report.json');
    const summary = join(dir, 'summary.txt');
    const result = runCli(['compare', ...writeSet(dir), '--out', out, '--summary', summary], deps());
    expect(result.code).toBe(0);
    expect(result.lines.join('\n')).toContain('VERDICT: PASS');
    const report = JSON.parse(readFileSync(out, 'utf8'));
    expect(validateShadowParityReport(report)).toEqual([]);
    expect(report.verdict).toBe('PASS');
    expect(report.generatedAt).toBe(NOW);
    expect(readFileSync(summary, 'utf8')).toContain('VERDICT: PASS');
    expect(report.checks[3].inputs).toEqual({ before: ['bw-b1.json', 'bw-b2.json'], after: ['bw-a1.json', 'bw-a2.json'] });
  });

  it('exit 1 on FAIL, and the report is still written', () => {
    const dir = scratch();
    const changed = clone(MANIFEST);
    manifestBucket(changed, 'matches', 2024).rows += 1;
    const out = join(dir, 'report.json');
    const result = runCli(['compare', ...writeSet(dir, { manifestAfter: changed }), '--out', out], deps());
    expect(result.code).toBe(1);
    expect(JSON.parse(readFileSync(out, 'utf8')).verdict).toBe('FAIL');
    expect(result.lines.join('\n')).toContain('ROWS_CHANGED');
  });

  it('exit 2 on INCOMPLETE (an input flag not given, an unreadable file), and the report is still written', () => {
    const dir = scratch();
    const out = join(dir, 'report.json');
    const result = runCli(['compare', ...writeSet(dir, { skip: ['--coverage-after'] }), '--out', out], deps());
    expect(result.code).toBe(2);
    const report = JSON.parse(readFileSync(out, 'utf8'));
    expect(report.verdict).toBe('INCOMPLETE');
    expect(report.checks[4].findings[0].code).toBe('INPUT_MISSING');

    const unreadable = join(dir, 'report2.json');
    const flags = writeSet(dir);
    flags[flags.indexOf('--manifest-after') + 1] = join(dir, 'does-not-exist.json');
    const second = runCli(['compare', ...flags, '--out', unreadable], deps());
    expect(second.code).toBe(2);
    expect(JSON.parse(readFileSync(unreadable, 'utf8')).checks[0].findings[0].code).toBe('INPUT_INVALID');
  });

  it('exit 2 when no input is given at all (never a pass)', () => {
    const dir = scratch();
    const out = join(dir, 'report.json');
    expect(runCli(['compare', '--out', out], deps()).code).toBe(2);
    expect(JSON.parse(readFileSync(out, 'utf8')).verdict).toBe('INCOMPLETE');
  });

  it('exit 3 on usage errors: no mode, unknown mode, unknown flag, missing value, duplicate flag, missing --out, positional, --summary == --out', () => {
    const dir = scratch();
    const out = join(dir, 'r.json');
    const bad: string[][] = [
      [],
      ['frobnicate'],
      ['compare', '--out', out, '--bogus', 'x'],
      ['compare', '--out'],
      ['compare', '--out', out, '--manifest-before'],
      ['compare', '--out', out, '--manifest-before', '--manifest-after'],
      ['compare', '--out', out, '--out', join(dir, 'r2.json')],
      ['compare', '--manifest-before', 'x'],
      ['compare', '--out', out, 'stray'],
      ['compare', '--out', out, '--summary', out],
      ['coverage-export'],
      ['coverage-export', '--out', out, '--manifest-before', 'x'],
      ['coverage-export', '--out', out, '--brownlow-before', 'x'],
    ];
    for (const argv of bad) {
      const result = runCli(argv, deps());
      expect(result.code, argv.join(' ')).toBe(3);
      expect(result.lines[0]).toContain('ERROR:');
    }
    expect(runCli([], deps()).lines.join('\n')).toContain('usage:');
    expect(existsSync(out)).toBe(false);
    expect(() => parseCliArgs(['compare', '--bogus', 'x'])).toThrow(/unknown option/);
    expect(USAGE.join('\n')).toContain('0 PASS, 1 FAIL, 2 INCOMPLETE, 3 ERROR');
  });

  it('exit 3 and no overwrite when an output file already exists (the `wx` refusal)', () => {
    const dir = scratch();
    const out = put(dir, 'report.json', 'ORIGINAL');
    const summary = put(dir, 'summary.txt', 'ORIGINAL-SUMMARY');
    const inputs = writeSet(dir);
    expect(runCli(['compare', ...inputs, '--out', out], deps()).code).toBe(3);
    expect(readFileSync(out, 'utf8')).toBe('ORIGINAL');
    // An existing summary file is refused before the report is written.
    const fresh = join(dir, 'fresh.json');
    const refusedSummary = runCli(['compare', ...inputs, '--out', fresh, '--summary', summary], deps());
    expect(refusedSummary.code).toBe(3);
    expect(existsSync(fresh)).toBe(false);
    expect(readFileSync(summary, 'utf8')).toBe('ORIGINAL-SUMMARY');
    // A file that appears between the check and the write is still refused by the exclusive create.
    const raced = join(dir, 'raced.json');
    const result = runCli(['compare', ...inputs, '--out', raced], deps({
      exists: () => false,
      writeExclusive: (path, text) => { writeFileSync(path, 'RACED'); defaultDeps().writeExclusive(path, text); },
    }));
    expect(result.code).toBe(3);
    expect(result.lines[0]).toContain('already exists');
    expect(readFileSync(raced, 'utf8')).toBe('RACED');
  });

  it('exit 3 on a write failure, naming the file but not the directory', () => {
    const dir = scratch();
    const result = runCli(['compare', ...writeSet(dir), '--out', join(dir, 'no-such-dir', 'report.json')], deps());
    expect(result.code).toBe(3);
    expect(result.lines[0]).toContain('could not write report.json');
    expect(result.lines.join('\n')).not.toContain(dir);
  });

  it('is deterministic: the same inputs and instant give byte-identical report files', () => {
    const dir = scratch();
    const inputs = writeSet(dir);
    runCli(['compare', ...inputs, '--out', join(dir, 'one.json')], deps());
    runCli(['compare', ...inputs, '--out', join(dir, 'two.json')], deps());
    expect(readFileSync(join(dir, 'one.json'), 'utf8')).toBe(readFileSync(join(dir, 'two.json'), 'utf8'));
  });

  it('reads no environment variable: a DSN in the environment changes nothing', () => {
    const dir = scratch();
    const inputs = writeSet(dir);
    const before = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://sentinel-user:sentinel-pass@sentinel-host/afldb';
    try {
      const result = runCli(['compare', ...inputs, '--out', join(dir, 'env.json')], deps());
      expect(result.code).toBe(0);
      expect(readFileSync(join(dir, 'env.json'), 'utf8')).not.toContain('sentinel');
      expect(result.lines.join('\n')).not.toContain('sentinel');
    } finally {
      if (before === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = before;
    }
  });

  it('coverage-export writes a valid export of the real registry with no registry problem (offline)', () => {
    const dir = scratch();
    const out = join(dir, 'coverage.json');
    const result = runCli(['coverage-export', '--out', out], deps());
    expect(result.code).toBe(0);
    expect(result.lines[0]).toContain('coverage registry export written: coverage.json');
    const exported = JSON.parse(readFileSync(out, 'utf8'));
    expect(validateCoverageRegistryExport(exported)).toEqual([]);
    expect(exported.registryProblems).toEqual([]);
    expect(exported).toEqual(COVERAGE);
    // never overwritten
    expect(runCli(['coverage-export', '--out', out], deps()).code).toBe(3);
    // an unreadable repository root is an ERROR
    expect(runCli(['coverage-export', '--out', join(dir, 'c2.json')], deps({ repoRoot: join(dir, 'nowhere') })).code).toBe(3);
  });

  it('the real process: exit codes through `tsx`, and a coverage export that feeds a PASS compare', () => {
    const dir = scratch();
    const tsx = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const cli = (args: string[]) => spawnSync(process.execPath, [tsx, 'tools/v2/shadow-parity.ts', ...args], {
      cwd: ROOT, encoding: 'utf8', timeout: 60_000,
      env: { ...process.env, DATABASE_URL: '', AFLDB_TEST_DATABASE_URL: '' },
    });
    const bad = cli(['compare', '--bogus']);
    expect(bad.status).toBe(3);
    expect(bad.stdout).toContain('ERROR: unknown option --bogus');
    const exportOut = join(dir, 'cov.json');
    const exported = cli(['coverage-export', '--out', exportOut]);
    expect(exported.status).toBe(0);
    mkdirSync(join(dir, 'in'));
    const flags = writeSet(join(dir, 'in'), { skip: ['--coverage-before', '--coverage-after'] });
    const reportOut = join(dir, 'report.json');
    const compared = cli(['compare', ...flags, '--coverage-before', exportOut, '--coverage-after', exportOut, '--out', reportOut]);
    expect(compared.status, compared.stdout).toBe(0);
    expect(compared.stdout).toContain('VERDICT: PASS');
    expect(JSON.parse(readFileSync(reportOut, 'utf8')).verdict).toBe('PASS');
    const again = cli(['compare', ...flags, '--out', reportOut]);
    expect(again.status).toBe(3);
  }, 120_000);
  it('V2-GAP-027: --policy v2.parity.2 compares the AFL API reports as a sixth check; without it they are refused', () => {
    const dir = scratch();
    const inputs = writeSet(dir);
    const afl = ['--afl-api-before', put(dir, 'afl-b.json', aflReport()), '--afl-api-after', put(dir, 'afl-a.json', aflReport())];
    const out = join(dir, 'v2.json');
    const result = runCli(['compare', ...inputs, ...afl, '--policy', 'v2.parity.2', '--out', out], deps());
    expect(result.code, result.lines.join('\n')).toBe(0);
    const report = JSON.parse(readFileSync(out, 'utf8'));
    expect(validateShadowParityReport(report)).toEqual([]);
    expect(report.policyVersion).toBe('v2.parity.2');
    expect(report.checks[5]).toMatchObject({ id: 'afl_api_reconciliation', status: 'pass', inputs: { before: ['afl-b.json'], after: ['afl-a.json'] } });

    const changed = put(dir, 'afl-a2.json', aflReport((r) => { r.counters.canonicalRowsInserted = 1; }));
    const failed = runCli(['compare', ...inputs, '--policy', 'v2.parity.2', '--afl-api-before', afl[1], '--afl-api-after', changed,
      '--out', join(dir, 'v2-fail.json')], deps());
    expect(failed.code).toBe(1);
    expect(failed.lines.join('\n')).toContain('COUNTER_CHANGED');

    const missing = runCli(['compare', ...inputs, '--policy', 'v2.parity.2', '--out', join(dir, 'v2-missing.json')], deps());
    expect(missing.code).toBe(2); // the sixth check is required under v2.parity.2: no reports, never a pass

    const v1 = join(dir, 'v1.json');
    expect(runCli(['compare', ...inputs, '--policy', 'v2.parity.1', '--out', v1], deps()).code).toBe(0);
    runCli(['compare', ...inputs, '--out', join(dir, 'v1-default.json')], deps());
    expect(readFileSync(v1, 'utf8')).toBe(readFileSync(join(dir, 'v1-default.json'), 'utf8'));

    for (const argv of [
      ['compare', ...inputs, ...afl, '--out', join(dir, 'r1.json')],
      ['compare', ...inputs, ...afl, '--policy', 'v2.parity.1', '--out', join(dir, 'r2.json')],
      ['compare', ...inputs, '--policy', 'v2.parity.9', '--out', join(dir, 'r3.json')],
    ]) {
      const refused = runCli(argv, deps());
      expect(refused.code, argv.join(' ')).toBe(3);
      expect(existsSync(argv[argv.length - 1])).toBe(false);
    }
  });
});
