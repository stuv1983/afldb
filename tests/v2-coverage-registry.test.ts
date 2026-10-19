/**
 * AFLDB V2 Stage 3 — the evidence-backed coverage registry (plan D11, ADR 0011): the real registry
 * against the real season registry and the real evidence files, the generated matrix document, and
 * negative controls on SYNTHETIC registries (every synthetic registry below is labelled so and is
 * never presented as coverage). No database, no network.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  COVERAGE_FAMILIES,
  COVERAGE_REGISTRY,
  COVERAGE_STATUSES,
  checkCoverageEvidence,
  coverageFor,
  renderCoverageMatrix,
  validateCoverageRegistry,
  type CoverageEntry,
  type CoverageEvidence,
  type CoverageFamily,
  type SeasonRegistry,
} from '@afldb/domain';

import { MATRIX_DOC, SEASONS_REGISTRY, buildMatrix, runCli } from '../tools/v2/coverage-matrix';

const ROOT = process.cwd();
const seasons = JSON.parse(readFileSync(join(ROOT, SEASONS_REGISTRY), 'utf8')) as SeasonRegistry;
const readRepo = (path: string): string | null => {
  const full = join(ROOT, path);
  return existsSync(full) ? readFileSync(full, 'utf8') : null;
};

// ---------------------------------------------------------------------------------------------
// SYNTHETIC registries for the negative controls: a tiny season range 2000-2002 with 2002 open.
// ---------------------------------------------------------------------------------------------
const SYNTHETIC_SEASONS: SeasonRegistry = { first_season: 2000, last_season: 2002, in_progress_seasons: [2002] };
const SYNTHETIC_FILES: Record<string, string> = {
  'fixtures/feed.json': '{"season":2001,"marker":"FIXTURE-ANCHOR"}',
  'tests/sample.test.ts': 'describe(\'suite\', () => {\n  it(\'projects the synthetic sample\', () => {});\n  // projects the synthetic comment\n});\n',
  'docs/note.md': 'Synthetic document text DOC-ANCHOR.',
};
const syntheticRead = (path: string): string | null => SYNTHETIC_FILES[path] ?? null;
const FIXTURE: CoverageEvidence = { kind: 'stored_fixture', path: 'fixtures/feed.json', anchor: 'FIXTURE-ANCHOR' };
const TEST: CoverageEvidence = { kind: 'test', path: 'tests/sample.test.ts', anchor: 'projects the synthetic sample' };
const DOC: CoverageEvidence = { kind: 'document', path: 'docs/note.md', anchor: 'DOC-ANCHOR' };

const entry = (family: CoverageFamily, from: number, through: number, status: CoverageEntry['status'], evidence: CoverageEvidence[], note = 'synthetic note'): CoverageEntry =>
  ({ family, from, through, status, evidence, note });

/** A valid synthetic registry: sealed 2000-2001 as baseline, open 2002 api_verified, every family. */
function syntheticValid(): CoverageEntry[] {
  return COVERAGE_FAMILIES.flatMap((family) => [
    entry(family, 2000, 2001, 'historical_baseline', [DOC]),
    entry(family, 2002, 2002, 'api_verified', [FIXTURE, TEST]),
  ]);
}
/** The synthetic registry with the entries of one family replaced. */
const withFamily = (family: CoverageFamily, replacement: CoverageEntry[]): CoverageEntry[] =>
  [...syntheticValid().filter((e) => e.family !== family), ...replacement];

// ---------------------------------------------------------------------------------------------
describe('the real coverage registry', () => {
  it('is valid against data/reference/seasons.json (every season of every family exactly once)', () => {
    expect(validateCoverageRegistry(COVERAGE_REGISTRY, seasons)).toEqual([]);
    for (let season = seasons.first_season; season <= seasons.last_season; season += 1) {
      for (const family of COVERAGE_FAMILIES) {
        expect(coverageFor(COVERAGE_REGISTRY, season, family), `${family} ${season}`).not.toBeNull();
      }
    }
    expect(coverageFor(COVERAGE_REGISTRY, seasons.first_season - 1, 'results')).toBeNull();
    expect(coverageFor(COVERAGE_REGISTRY, seasons.last_season + 1, 'results')).toBeNull();
  });

  it('every evidence file exists on disk and contains its anchor (a test anchor is a real test title)', () => {
    expect(checkCoverageEvidence(COVERAGE_REGISTRY, readRepo)).toEqual([]);
    const evidence = COVERAGE_REGISTRY.flatMap((e) => e.evidence);
    expect(evidence.length).toBeGreaterThan(0);
    for (const item of evidence) expect(existsSync(join(ROOT, item.path)), item.path).toBe(true);
  });

  it('answers coverageFor with the honest status per season and family', () => {
    expect(coverageFor(COVERAGE_REGISTRY, 2026, 'results')?.status).toBe('api_verified');
    expect(coverageFor(COVERAGE_REGISTRY, 2026, 'player_stats')?.status).toBe('api_partial');
    expect(coverageFor(COVERAGE_REGISTRY, 2026, 'fixtures')?.status).toBe('api_partial');
    expect(coverageFor(COVERAGE_REGISTRY, 2026, 'match_stats')?.status).toBe('api_partial');
    expect(coverageFor(COVERAGE_REGISTRY, 2026, 'brownlow')?.status).toBe('api_partial');
    // Registered 2022-2025 is NOT API-verified: no match or fixture snapshot is committed.
    for (const family of COVERAGE_FAMILIES) {
      expect(coverageFor(COVERAGE_REGISTRY, 2024, family)?.status, family).toBe('historical_baseline');
    }
    // The Brownlow Medal was not awarded before 1924 or in the war years 1942-1945.
    for (const season of [1897, 1923, 1942, 1945]) expect(coverageFor(COVERAGE_REGISTRY, season, 'brownlow')?.status).toBe('unsupported');
    for (const season of [1924, 1941, 1946, 2025]) expect(coverageFor(COVERAGE_REGISTRY, season, 'brownlow')?.status).toBe('historical_baseline');
    expect(coverageFor(COVERAGE_REGISTRY, 1897, 'fixtures')?.status).toBe('historical_baseline');
  });

  it('no manual_curated entry exists yet, and nothing is api_* for a sealed season', () => {
    expect(COVERAGE_REGISTRY.filter((e) => e.status === 'manual_curated')).toEqual([]);
    for (const e of COVERAGE_REGISTRY.filter((x) => x.status === 'api_verified' || x.status === 'api_partial')) {
      expect(e.from, `${e.family} ${e.from}`).toBeGreaterThan(2025);
    }
  });

  it('every api_verified cell cites a resolvable stored_fixture and a resolvable test', () => {
    const verified = COVERAGE_REGISTRY.filter((e) => e.status === 'api_verified');
    expect(verified.length).toBeGreaterThan(0);
    for (const e of verified) {
      const fixtures = e.evidence.filter((item) => item.kind === 'stored_fixture');
      const tests = e.evidence.filter((item) => item.kind === 'test');
      expect(fixtures.length, `${e.family} fixture`).toBeGreaterThan(0);
      expect(tests.length, `${e.family} test`).toBeGreaterThan(0);
      for (const item of [...fixtures, ...tests]) {
        expect(readRepo(item.path), item.path).toContain(item.anchor);
      }
    }
  });

  it('api_partial entries name their limitation, and the doc says no manual_curated exists yet', () => {
    for (const e of COVERAGE_REGISTRY.filter((x) => x.status === 'api_partial')) {
      expect(e.note.trim().length, `${e.family} note`).toBeGreaterThan(20);
      expect(e.evidence.length).toBeGreaterThan(0);
    }
    const matrix = renderCoverageMatrix(COVERAGE_REGISTRY, seasons);
    expect(matrix).toContain('None today (curated awards are Stage 4, plan D8)');
  });

  it('counts the season-family cells per status', () => {
    const counts: Record<string, number> = {};
    for (const e of COVERAGE_REGISTRY) counts[e.status] = (counts[e.status] ?? 0) + (e.through - e.from + 1);
    const total = COVERAGE_STATUSES.reduce((sum, status) => sum + (counts[status] ?? 0), 0);
    expect(total).toBe(COVERAGE_FAMILIES.length * (seasons.last_season - seasons.first_season + 1));
    expect(counts.api_verified).toBe(1);
    expect(counts.api_partial).toBe(4);
    expect(counts.unsupported).toBe(31);
    expect(counts.historical_baseline).toBe(614);
  });
});

describe('the generated matrix document', () => {
  it('the committed docs/v2/coverage-matrix.md equals renderCoverageMatrix(COVERAGE_REGISTRY, seasons)', () => {
    const committed = readFileSync(join(ROOT, MATRIX_DOC), 'utf8').replace(/\r\n/g, '\n');
    expect(committed).toBe(renderCoverageMatrix(COVERAGE_REGISTRY, seasons));
    expect(committed).toContain('GENERATED by `tools/v2/coverage-matrix.ts`');
  });

  it('rendering is deterministic and ends with one newline', () => {
    const a = renderCoverageMatrix(COVERAGE_REGISTRY, seasons);
    expect(renderCoverageMatrix(COVERAGE_REGISTRY, seasons)).toBe(a);
    expect(a.endsWith('\n') && !a.endsWith('\n\n')).toBe(true);
  });

  it('the CLI --check passes on the committed file and builds with no problems', () => {
    expect(buildMatrix(ROOT).problems).toEqual([]);
    expect(runCli(['--check'], ROOT).code).toBe(0);
    expect(runCli([], ROOT).code).toBe(2);
    expect(runCli(['--write', '--check'], ROOT).code).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------
describe('negative controls (SYNTHETIC registries, never real coverage)', () => {
  it('control: the synthetic baseline registry is itself valid', () => {
    expect(validateCoverageRegistry(syntheticValid(), SYNTHETIC_SEASONS)).toEqual([]);
    expect(checkCoverageEvidence(syntheticValid(), syntheticRead)).toEqual([]);
  });

  it('an api_verified entry without a test is a problem', () => {
    const problems = validateCoverageRegistry(withFamily('results', [
      entry('results', 2000, 2001, 'historical_baseline', [DOC]),
      entry('results', 2002, 2002, 'api_verified', [FIXTURE]),
    ]), SYNTHETIC_SEASONS);
    expect(problems).toEqual(['results 2002-2002: api_verified requires at least one test evidence']);
  });

  it('an api_verified entry without a stored fixture is a problem', () => {
    const problems = validateCoverageRegistry(withFamily('results', [
      entry('results', 2000, 2001, 'historical_baseline', [DOC]),
      entry('results', 2002, 2002, 'api_verified', [TEST]),
    ]), SYNTHETIC_SEASONS);
    expect(problems).toEqual(['results 2002-2002: api_verified requires at least one stored_fixture evidence']);
  });

  it('an evidence path that does not exist is a problem', () => {
    const missing: CoverageEvidence = { kind: 'stored_fixture', path: 'fixtures/absent.json', anchor: 'X' };
    const problems = checkCoverageEvidence(withFamily('results', [
      entry('results', 2000, 2001, 'historical_baseline', [DOC]),
      entry('results', 2002, 2002, 'api_verified', [missing, TEST]),
    ]), syntheticRead);
    expect(problems).toEqual(['results 2002-2002: stored_fixture fixtures/absent.json: evidence file not found']);
  });

  it('an anchor that is not in the file is a problem', () => {
    const wrong: CoverageEvidence = { kind: 'document', path: 'docs/note.md', anchor: 'NOT-IN-THE-FILE' };
    const problems = checkCoverageEvidence(withFamily('results', [
      entry('results', 2000, 2001, 'historical_baseline', [wrong]),
      entry('results', 2002, 2002, 'api_verified', [FIXTURE, TEST]),
    ]), syntheticRead);
    expect(problems).toEqual(['results 2000-2001: document docs/note.md: anchor not found: NOT-IN-THE-FILE']);
  });

  it('a test anchor must be an actual test title, not text that merely appears in the file', () => {
    const comment: CoverageEvidence = { kind: 'test', path: 'tests/sample.test.ts', anchor: 'projects the synthetic comment' };
    const problems = checkCoverageEvidence(withFamily('results', [
      entry('results', 2000, 2001, 'historical_baseline', [DOC]),
      entry('results', 2002, 2002, 'api_verified', [FIXTURE, comment]),
    ]), syntheticRead);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('anchor is not a test title');
    // A describe( title is a title too.
    const suite: CoverageEvidence = { kind: 'test', path: 'tests/sample.test.ts', anchor: 'suite' };
    expect(checkCoverageEvidence([entry('results', 2002, 2002, 'api_verified', [FIXTURE, suite])], syntheticRead)).toEqual([]);
  });

  it('historical_baseline on an open season is a problem', () => {
    const problems = validateCoverageRegistry(withFamily('results', [
      entry('results', 2000, 2002, 'historical_baseline', [DOC]),
    ]), SYNTHETIC_SEASONS);
    expect(problems).toEqual(['results 2000-2002: historical_baseline is only for sealed seasons; not sealed: 2002']);
  });

  it('historical_baseline on the real 2026 season is a problem (it is open in data/reference/seasons.json)', () => {
    const mutated = COVERAGE_REGISTRY.map((e) => (e.family === 'results' && e.from === 2026 ? { ...e, status: 'historical_baseline' as const } : e));
    expect(validateCoverageRegistry(mutated, seasons)).toEqual(['results 2026-2026: historical_baseline is only for sealed seasons; not sealed: 2026']);
  });

  it('api_partial for a sealed season without a stored fixture is a problem', () => {
    const problems = validateCoverageRegistry(withFamily('results', [
      entry('results', 2000, 2001, 'api_partial', [DOC], 'only some matches'),
      entry('results', 2002, 2002, 'api_verified', [FIXTURE, TEST]),
    ]), SYNTHETIC_SEASONS);
    expect(problems).toEqual(['results 2000-2001: api_partial for sealed season(s) 2000, 2001 requires a stored_fixture evidence']);
  });

  it('a gap is a problem', () => {
    const problems = validateCoverageRegistry(withFamily('results', [
      entry('results', 2000, 2000, 'historical_baseline', [DOC]),
      entry('results', 2002, 2002, 'api_verified', [FIXTURE, TEST]),
    ]), SYNTHETIC_SEASONS);
    expect(problems).toEqual(['results: gap, seasons 2001-2001 have no entry']);
  });

  it('an overlap is a problem', () => {
    const problems = validateCoverageRegistry(withFamily('results', [
      entry('results', 2000, 2001, 'historical_baseline', [DOC]),
      entry('results', 2001, 2002, 'api_verified', [FIXTURE, TEST]),
    ]), SYNTHETIC_SEASONS);
    expect(problems).toEqual(['results: overlap, season(s) 2001-2001 are covered more than once']);
  });

  it('a family with no entry, a missing tail and an out-of-range entry are problems', () => {
    expect(validateCoverageRegistry(syntheticValid().filter((e) => e.family !== 'brownlow'), SYNTHETIC_SEASONS))
      .toEqual(['brownlow: gap, seasons 2000-2002 have no entry']);
    expect(validateCoverageRegistry(syntheticValid().filter((e) => !(e.family === 'results' && e.from === 2002)), SYNTHETIC_SEASONS))
      .toEqual(['results: gap, seasons 2002-2002 have no entry']);
    const outside = validateCoverageRegistry(withFamily('results', [
      entry('results', 1999, 2001, 'historical_baseline', [DOC]),
      entry('results', 2002, 2002, 'api_verified', [FIXTURE, TEST]),
    ]), SYNTHETIC_SEASONS);
    // The out-of-range entry does not count as covering anything, so the range is also a gap.
    expect(outside).toEqual(['results 1999-2001: outside the season range 2000-2002', 'results: gap, seasons 2000-2001 have no entry']);
  });

  it('unsupported and manual_curated need evidence; every entry needs a note; evidence paths must be repo-relative POSIX', () => {
    const problems = validateCoverageRegistry(withFamily('brownlow', [
      entry('brownlow', 2000, 2000, 'unsupported', []),
      entry('brownlow', 2001, 2001, 'manual_curated', []),
      entry('brownlow', 2002, 2002, 'api_partial', [{ kind: 'document', path: 'C:\\repo\\docs\\x.md', anchor: 'x' }], ' '),
    ]), SYNTHETIC_SEASONS);
    expect(problems).toContain('brownlow 2000-2000: unsupported requires at least one evidence');
    expect(problems).toContain('brownlow 2001-2001: manual_curated requires at least one evidence');
    expect(problems).toContain('brownlow 2002-2002: a non-empty note is required');
    expect(problems.some((p) => p.includes('evidence path must be repository-relative POSIX'))).toBe(true);
    const traversal = validateCoverageRegistry(withFamily('brownlow', [
      entry('brownlow', 2000, 2001, 'historical_baseline', [{ kind: 'document', path: '../secret.md', anchor: 'x' }]),
      entry('brownlow', 2002, 2002, 'api_verified', [FIXTURE, TEST]),
    ]), SYNTHETIC_SEASONS);
    expect(traversal.some((p) => p.includes('repository-relative POSIX'))).toBe(true);
  });

  it('a synthetic registry renders deterministically and counts cells per status', () => {
    const text = renderCoverageMatrix(syntheticValid(), SYNTHETIC_SEASONS);
    expect(text).toBe(renderCoverageMatrix(syntheticValid(), SYNTHETIC_SEASONS));
    expect(text).toContain('5 families x 3 seasons = 15 cells');
    expect(text).toContain('| `api_verified` | 1 | 1 | 1 | 1 | 1 | 5 |');
    expect(text).toContain('| `historical_baseline` | 2 | 2 | 2 | 2 | 2 | 10 |');
  });
});
