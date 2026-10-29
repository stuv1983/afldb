/**
 * AFLDB V2 Stage 3 (docs/v2/plan.md §3 D1) — the machine-readable AFL API reconciliation report
 * (packages/acquisition/src/reconciliation-report.ts).
 *
 * DATA. The bundle is REPLAYED from a real hash-bound snapshot built from the committed provider
 * fixtures (tests/afl-api-snapshot-fixture.ts). The RUN RESULT and the EXCEPTION REPORT are
 * SYNTHETIC: no settle was run (no database exists in this suite), so the counters, the two
 * refusal-evidence entries and the empty exception report below are invented to exercise the
 * report's shape and ordering. They are not the result of any real run and must never be read as
 * one. Nothing here proves a promotion; it proves the report is deterministic, self-consistent
 * and refuses malformed input.
 */
import { rmSync } from 'node:fs';

import { afterAll, describe, expect, it } from 'vitest';

import {
  AFL_API_COUNTER_KEYS,
  AFL_API_RECONCILIATION_REPORT_FORMAT,
  AFL_API_RECONCILIATION_REPORT_JSON_SCHEMA,
  AFL_API_RECONCILIATION_REPORT_VERSION,
  AFL_API_RECONCILIATION_REQUIRED,
  buildAflApiReconciliationReport,
  parseAflApiIdentities,
  parseSourceFamilyRegistry,
  replayAflApiSnapshot,
  serialiseAflApiReconciliationReport,
  validateAflApiReconciliationReport,
  type AflApiReconciliationReport,
  type AflApiReconciliationReportInput,
} from '@afldb/acquisition';
import {
  buildAflApiSettleBundle,
  type AflApiSettleCounters,
  type AflApiSettleRunResult,
} from '@/lib/acquisition/settle-afl-api';
import type { SettleExceptionReport } from '@/lib/acquisition/settle-report';
import {
  committedUnit,
  makeScratchProject,
  referenceJson,
  undeclaredColumnUnit,
} from './afl-api-snapshot-fixture';

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const registry = parseSourceFamilyRegistry(referenceJson('source-families.json'));
const identities = parseAflApiIdentities(referenceJson('afl-api-identities.json'));

const MAP_COUNTERS: readonly string[] = ['recordsDeferred', 'seasonFeedStatusCounts'];

/** SYNTHETIC counters: all zero, then a few set so the report has something to carry. */
function syntheticCounters(snapshotMatches: number, buildFailures: number): AflApiSettleCounters {
  const counters: Record<string, unknown> = {};
  for (const key of AFL_API_COUNTER_KEYS) counters[key] = MAP_COUNTERS.includes(key) ? {} : 0;
  counters.snapshotMatches = snapshotMatches;
  counters.buildFailures = buildFailures;
  counters.canonicalApplyRefusals = 2;
  counters.recordsDeferred = { status_not_concluded: 1, roster_not_concluded: 3 };
  counters.seasonFeedStatusCounts = { SCHEDULED: 4, CONCLUDED: 9 };
  return counters as unknown as AflApiSettleCounters;
}

// SYNTHETIC refusal evidence, deliberately supplied OUT of census order and with unsorted renderedFields.
const SYNTHETIC_REFUSALS = [
  {
    family: 'player_match_stats', externalRecordId: 'CD_M20260142801|CD_T80|CD_I1', targetTable: 'player_match_stats',
    refusal: 'foreign_source_owner', matchKey: '2026-R1-SYN', renderedFields: ['kicks', 'disposals'], ownerSourceKey: 'afltables',
  },
  {
    family: 'match', externalRecordId: 'CD_M20260142801', targetTable: 'matches',
    refusal: 'no_canonical_match', matchKey: '2026-R1-SYN', renderedFields: ['venue_id', 'attendance'], ownerSourceKey: null,
  },
] as unknown as AflApiSettleRunResult['refusalEvidence'];

// SYNTHETIC exception report: the shape of settle-report.ts SettleExceptionReport with nothing in it.
const SYNTHETIC_EXCEPTIONS: SettleExceptionReport = {
  sourceKey: 'afl_api', season: 2026, latestBatch: null, unresolvedRecords: [],
  candidates: { active: [], moot: [] }, applyFailures: [], disagreements: [],
  findingsTruncated: false, deferredRecords: {},
};

function inputFor(units = [committedUnit()], refusals = SYNTHETIC_REFUSALS): AflApiReconciliationReportInput {
  const made = makeScratchProject('report-snapshot', units);
  scratch.push(made.projectRoot);
  const replayed = replayAflApiSnapshot({
    snapshotDir: made.snapshotDir, registry, identities, buildBundle: buildAflApiSettleBundle,
  });
  return {
    generatedAt: '2026-10-19T09:30:00.000Z',
    mode: 'dry_run',
    bundle: replayed.bundle,
    manifestSha256: replayed.manifestSha256,
    run: {
      applied: false,
      batchId: null,
      counters: syntheticCounters(replayed.bundle.units.length, replayed.bundle.buildFailures.length),
      halt: null,
      rollbackReason: 'dry_run',
      refusalEvidence: refusals,
    },
    exceptions: SYNTHETIC_EXCEPTIONS,
  };
}

describe('buildAflApiReconciliationReport', () => {
  it('builds a valid report from a replayed bundle and a SYNTHETIC run result', () => {
    const input = inputFor();
    const report = buildAflApiReconciliationReport(input);
    expect(validateAflApiReconciliationReport(report)).toEqual([]);
    expect(report.format).toBe('afldb.v2.afl-api-reconciliation-report');
    expect(report.format).toBe(AFL_API_RECONCILIATION_REPORT_FORMAT);
    expect(report.formatVersion).toBe(AFL_API_RECONCILIATION_REPORT_VERSION);
    expect(report.generatedAt).toBe('2026-10-19T09:30:00.000Z');
    expect(report.source).toEqual({
      sourceKey: 'afl_api', season: 2026, snapshotLabel: 'report-snapshot', manifestSha256: input.manifestSha256,
    });
    expect(report.run).toEqual({ mode: 'dry_run', batchId: null, applied: false, halt: null, rollbackReason: 'dry_run' });
    expect(report.seasonFeed).toEqual({ complete: false, matches: 0, statusCounts: {}, gaps: report.seasonFeed.gaps });
    expect(report.seasonFeed.gaps.length).toBeGreaterThan(0); // no feed retained: the gap is stated, not hidden
    expect(report.buildFailures).toEqual([]);
    expect(report.exceptions).toEqual(SYNTHETIC_EXCEPTIONS);
  });

  it('puts refusals in the settle census order with renderedFields sorted, whatever order they arrive in', () => {
    const forward = buildAflApiReconciliationReport(inputFor());
    const reversed = buildAflApiReconciliationReport(inputFor(undefined, [...SYNTHETIC_REFUSALS].reverse()));
    expect(forward.refusals.map((r) => r.family)).toEqual(['match', 'player_match_stats']);
    expect(forward.refusals.map((r) => r.renderedFields)).toEqual([['attendance', 'venue_id'], ['disposals', 'kicks']]);
    expect(serialiseAflApiReconciliationReport(reversed)).toBe(serialiseAflApiReconciliationReport(forward));
  });

  it('carries a unit that failed to build as a build failure, sorted, with the counter agreeing', () => {
    const report = buildAflApiReconciliationReport(inputFor([committedUnit(), undeclaredColumnUnit('CD_M20260142802')]));
    expect(validateAflApiReconciliationReport(report)).toEqual([]);
    expect(report.buildFailures).toHaveLength(1);
    expect(report.buildFailures[0].providerMatchId).toBe('CD_M20260142802');
    expect(report.buildFailures[0].error).toMatch(/undeclared column/);
    expect(report.counters.buildFailures).toBe(1);
  });

  it('is deterministic and does not mutate its input or read a clock', () => {
    const input = inputFor();
    const snapshot = JSON.stringify(input);
    const a = buildAflApiReconciliationReport(input);
    const b = buildAflApiReconciliationReport(input);
    expect(b).toEqual(a);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(buildAflApiReconciliationReport({ ...input, generatedAt: '2027-01-01T00:00:00Z' }).generatedAt)
      .toBe('2027-01-01T00:00:00Z');
  });

  it('carries a HALT and a committed batch id faithfully', () => {
    const input = inputFor();
    const halted = buildAflApiReconciliationReport({
      ...input, mode: 'apply',
      run: { ...input.run, applied: false, batchId: null, rollbackReason: null, halt: { reason: 'absence_unacknowledged', detail: { newlyAbsent: 1 } } },
    });
    expect(halted.run.halt).toEqual({ reason: 'absence_unacknowledged', detail: { newlyAbsent: 1 } });
    expect(validateAflApiReconciliationReport(halted)).toEqual([]);
    const applied = buildAflApiReconciliationReport({
      ...input, mode: 'apply', run: { ...input.run, applied: true, batchId: '4242', rollbackReason: null },
    });
    expect(applied.run).toEqual({ mode: 'apply', batchId: '4242', applied: true, halt: null, rollbackReason: null });
    expect(validateAflApiReconciliationReport(applied)).toEqual([]);
  });
});

describe('serialiseAflApiReconciliationReport', () => {
  it('serialises byte-identically twice, ends with one newline, sorts keys, and round-trips', () => {
    const report = buildAflApiReconciliationReport(inputFor());
    const first = serialiseAflApiReconciliationReport(report);
    const second = serialiseAflApiReconciliationReport(buildAflApiReconciliationReport(inputFor()));
    expect(second).toBe(first);
    expect(first.endsWith('}\n')).toBe(true);
    expect(first.endsWith('\n\n')).toBe(false);
    const parsed = JSON.parse(first) as AflApiReconciliationReport;
    expect(parsed).toEqual(report);
    expect(validateAflApiReconciliationReport(parsed)).toEqual([]);
    expect(serialiseAflApiReconciliationReport(parsed)).toBe(first);
    expect(Object.keys(parsed)).toEqual([...Object.keys(parsed)].sort());
    expect(Object.keys(parsed.counters)).toEqual([...Object.keys(parsed.counters)].sort());
  });
});

describe('validateAflApiReconciliationReport rejects malformed reports', () => {
  const good = (): AflApiReconciliationReport => buildAflApiReconciliationReport(inputFor());
  const clone = (): Record<string, any> => JSON.parse(serialiseAflApiReconciliationReport(good())); // eslint-disable-line @typescript-eslint/no-explicit-any -- mutated under test

  it('a missing top-level field', () => {
    for (const key of AFL_API_RECONCILIATION_REQUIRED.report) {
      const bad = clone();
      delete bad[key];
      expect(validateAflApiReconciliationReport(bad), key).toContain(`report.${key} is required.`);
    }
  });

  it('a missing nested field and a missing counter', () => {
    const bad = clone();
    delete bad.source.manifestSha256;
    delete bad.run.halt;
    delete bad.counters.derivedRecomputePlayers;
    delete bad.seasonFeed.gaps;
    const problems = validateAflApiReconciliationReport(bad);
    expect(problems).toContain('report.source.manifestSha256 is required.');
    expect(problems).toContain('report.run.halt is required.');
    expect(problems).toContain('report.counters.derivedRecomputePlayers is required.');
    expect(problems).toContain('report.seasonFeed.gaps is required.');
  });

  it('the wrong format, the wrong version, a non-ISO time', () => {
    const bad = clone();
    bad.format = 'afldb.v2.something-else';
    bad.formatVersion = 2;
    bad.generatedAt = '19 Oct 2026';
    const problems = validateAflApiReconciliationReport(bad);
    expect(problems.some((p) => p.startsWith('report.format must be'))).toBe(true);
    expect(problems.some((p) => p.startsWith('report.formatVersion must be'))).toBe(true);
    expect(problems.some((p) => p.startsWith('report.generatedAt must be'))).toBe(true);
  });

  it('unsorted refusals', () => {
    const bad = clone();
    bad.refusals = [...bad.refusals].reverse();
    expect(validateAflApiReconciliationReport(bad)).toContain('report.refusals is not in census order at index 1.');
  });

  it('unsorted renderedFields and unsorted build failures', () => {
    const bad = clone();
    bad.refusals[0].renderedFields = ['venue_id', 'attendance'];
    bad.buildFailures = [
      { providerMatchId: 'CD_M2', error: 'b' },
      { providerMatchId: 'CD_M1', error: 'a' },
    ];
    const problems = validateAflApiReconciliationReport(bad);
    expect(problems).toContain('report.refusals[0].renderedFields must be sorted.');
    expect(problems).toContain('report.buildFailures is not sorted by (providerMatchId, error) at index 1.');
  });

  it('inconsistent run state: a dry run applied, a HALT that committed', () => {
    const dry = clone();
    dry.run.applied = true;
    expect(validateAflApiReconciliationReport(dry)).toContain('report.run: a dry_run cannot be applied.');
    const halted = clone();
    halted.run.mode = 'apply';
    halted.run.halt = { reason: 'x', detail: {} };
    halted.run.batchId = '7';
    expect(validateAflApiReconciliationReport(halted))
      .toContain('report.run: a HALT commits nothing, so applied must be false and batchId null.');
  });

  it('wrong value types: a negative counter, a bad batch id, a bad manifest hash, a non-object', () => {
    const bad = clone();
    bad.counters.snapshotMatches = -1;
    bad.counters.recordsDeferred = { x: 'one' };
    bad.run.batchId = 'forty-two';
    bad.source.manifestSha256 = 'ABC';
    const problems = validateAflApiReconciliationReport(bad);
    expect(problems).toContain('report.counters.snapshotMatches must be a non-negative integer.');
    expect(problems).toContain('report.counters.recordsDeferred must map names to non-negative integers.');
    expect(problems).toContain('report.run.batchId must be decimal text or null.');
    expect(problems).toContain('report.source.manifestSha256 must be 64 lower-case hex characters or null.');
    expect(validateAflApiReconciliationReport(null)).toEqual(['report must be an object.']);
    expect(validateAflApiReconciliationReport([])).toEqual(['report must be an object.']);
  });

  it('a malformed exceptions object', () => {
    const bad = clone();
    bad.exceptions = { sourceKey: 'afl_api' };
    const problems = validateAflApiReconciliationReport(bad);
    expect(problems).toContain('report.exceptions.candidates is required.');
    expect(problems).toContain('report.exceptions.findingsTruncated is required.');
  });
});

/* ------------------------------------------------------------------ *
 * The JSON Schema agrees with the validator
 * ------------------------------------------------------------------ */

type Schema = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- JSON Schema subset walker

/** A tiny checker for exactly the JSON Schema 2020-12 keywords the report schema uses. */
function schemaProblems(schema: Schema, value: unknown, path: string): string[] {
  const out: string[] = [];
  if ('const' in schema && value !== schema.const) out.push(`${path}: const`);
  if (schema.enum && !(schema.enum as unknown[]).includes(value)) out.push(`${path}: enum`);
  if (schema.oneOf) {
    const matching = (schema.oneOf as Schema[]).filter((s) => schemaProblems(s, value, path).length === 0);
    if (matching.length !== 1) out.push(`${path}: oneOf matched ${matching.length}`);
  }
  if (schema.type) {
    const kinds = Array.isArray(schema.type) ? schema.type as string[] : [schema.type as string];
    const kindOf = (v: unknown): string[] => {
      if (v === null) return ['null'];
      if (Array.isArray(v)) return ['array'];
      if (typeof v === 'number') return Number.isInteger(v) ? ['integer', 'number'] : ['number'];
      return [typeof v];
    };
    if (!kinds.some((k) => kindOf(value).includes(k))) {
      out.push(`${path}: type ${kinds.join('|')}`);
      return out;
    }
  }
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern as string).test(value)) out.push(`${path}: pattern`);
    if (schema.minLength && value.length < (schema.minLength as number)) out.push(`${path}: minLength`);
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < (schema.minimum as number)) out.push(`${path}: minimum`);
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => out.push(...schemaProblems(schema.items as Schema, item, `${path}[${i}]`)));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    for (const key of (schema.required ?? []) as string[]) if (!(key in object)) out.push(`${path}.${key}: required`);
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
    for (const key of Object.keys(object)) {
      if (properties[key]) out.push(...schemaProblems(properties[key], object[key], `${path}.${key}`));
      else if (schema.additionalProperties === false) out.push(`${path}.${key}: additional property`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        out.push(...schemaProblems(schema.additionalProperties as Schema, object[key], `${path}.${key}`));
      }
    }
  }
  return out;
}

describe('AFL_API_RECONCILIATION_REPORT_JSON_SCHEMA', () => {
  const schema = AFL_API_RECONCILIATION_REPORT_JSON_SCHEMA as unknown as Schema;

  it('is a JSON Schema 2020-12 object schema', () => {
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.type).toBe('object');
    expect(typeof schema.$id).toBe('string');
    expect(() => JSON.stringify(schema)).not.toThrow();
  });

  it("its `required` lists equal the validator's required fields, object by object", () => {
    const required = AFL_API_RECONCILIATION_REQUIRED;
    const p = schema.properties as Record<string, Schema>;
    expect(schema.required).toEqual([...required.report]);
    expect(Object.keys(p).sort()).toEqual([...required.report].sort());
    expect(p.source.required).toEqual([...required.source]);
    expect(p.run.required).toEqual([...required.run]);
    expect(p.seasonFeed.required).toEqual([...required.seasonFeed]);
    expect(p.seasonFeed.properties.gaps.items.required).toEqual([...required.gap]);
    expect(p.buildFailures.items.required).toEqual([...required.buildFailure]);
    expect(p.refusals.items.required).toEqual([...required.refusal]);
    expect(p.exceptions.oneOf[1].required).toEqual([...required.exceptions]);
    expect(p.counters.required).toEqual([...AFL_API_COUNTER_KEYS]);
    expect(Object.keys(p.counters.properties).sort()).toEqual([...AFL_API_COUNTER_KEYS].sort());
  });

  it('a validator-clean report conforms to the schema, and a malformed one does not', () => {
    const report = JSON.parse(serialiseAflApiReconciliationReport(buildAflApiReconciliationReport(inputFor())));
    expect(validateAflApiReconciliationReport(report)).toEqual([]);
    expect(schemaProblems(schema, report, '$')).toEqual([]);

    const noFormat = { ...report };
    delete noFormat.format;
    expect(schemaProblems(schema, noFormat, '$')).toContain('$.format: required');
    expect(schemaProblems(schema, { ...report, format: 'x' }, '$')).toContain('$.format: const');
    expect(schemaProblems(schema, { ...report, extra: 1 }, '$')).toContain('$.extra: additional property');
    expect(schemaProblems(schema, { ...report, source: { ...report.source, manifestSha256: 'zz' } }, '$').length).toBeGreaterThan(0);
    expect(schemaProblems(schema, { ...report, run: { ...report.run, rollbackReason: 'nope' } }, '$').length).toBeGreaterThan(0);
  });
});
