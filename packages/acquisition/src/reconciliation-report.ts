/**
 * AFLDB V2 Stage 3 — the machine-readable AFL API reconciliation report (docs/v2/plan.md §3 D1;
 * owner chain "... reconciliation -> transactional promotion").
 *
 * One JSON document per settle run: what snapshot was settled (identified by the sha256 of its
 * manifest), what mode and outcome the run had, every counter, the proven completeness of the
 * season feed, every unit that failed to build, every canonical refusal, and the exception report.
 * The report is EVIDENCE of a run; building one writes nothing and decides nothing.
 *
 * PURE: no database, no IO, no clock. `generatedAt` is supplied by the caller (never read here),
 * so building and serialising the same input twice is byte-identical. Field names come from the
 * real `AflApiSettleRunResult` / `AflApiSettleBundle` (settle-afl-api.ts) and `SettleExceptionReport`
 * (settle-report.ts); those modules are reached with `import type` only, because they sit on the
 * writer side of the boundary. The one runtime import, afl-api-refusal-evidence.ts, is pure.
 *
 * Ordering: `buildFailures` by (providerMatchId, error); `refusals` in the settle's own census
 * order (afl-api-refusal-evidence.ts), with `renderedFields` sorted; JSON keys sorted at every depth.
 */
import {
  aflApiRefusalCensusEntry,
  compareAflApiRefusalCensusEntries,
  type AflApiCanonicalRefusalEvidence,
} from '@/lib/acquisition/afl-api-refusal-evidence';
import type {
  AflApiBuildFailure,
  AflApiSettleBundle,
  AflApiSettleCounters,
  AflApiSettleRunResult,
} from '@/lib/acquisition/settle-afl-api';
import type { SettleExceptionReport } from '@/lib/acquisition/settle-report';

export const AFL_API_RECONCILIATION_REPORT_FORMAT = 'afldb.v2.afl-api-reconciliation-report';
export const AFL_API_RECONCILIATION_REPORT_VERSION = 1;

/** Modes that produce a settle run result. (`--validate-only` and `--report` open no transaction.) */
export const AFL_API_RECONCILIATION_RUN_MODES = ['dry_run', 'apply'] as const;
export type AflApiReconciliationRunMode = (typeof AFL_API_RECONCILIATION_RUN_MODES)[number];

export interface AflApiReconciliationReport {
  format: typeof AFL_API_RECONCILIATION_REPORT_FORMAT;
  formatVersion: typeof AFL_API_RECONCILIATION_REPORT_VERSION;
  /** Caller-supplied ISO-8601 UTC instant. Never a clock read. */
  generatedAt: string;
  source: {
    sourceKey: 'afl_api';
    season: number;
    snapshotLabel: string;
    /** sha256 of manifest.json (the snapshot's identity), or null when not supplied. */
    manifestSha256: string | null;
  };
  run: {
    mode: AflApiReconciliationRunMode;
    /** The import_batches id as decimal text, or null when nothing committed. */
    batchId: string | null;
    applied: boolean;
    halt: { reason: string; detail: Record<string, unknown> } | null;
    rollbackReason: 'dry_run' | 'require_complete_source' | null;
  };
  counters: AflApiSettleCounters;
  seasonFeed: {
    complete: boolean;
    matches: number;
    statusCounts: Record<string, number>;
    gaps: { reason: string; detail: string }[];
  };
  buildFailures: AflApiBuildFailure[];
  refusals: AflApiCanonicalRefusalEvidence[];
  exceptions: SettleExceptionReport | null;
}

export interface AflApiReconciliationReportInput {
  generatedAt: string;
  mode: AflApiReconciliationRunMode;
  bundle: Pick<AflApiSettleBundle, 'season' | 'snapshotLabel' | 'buildFailures' | 'seasonFeed'>;
  manifestSha256: string | null;
  run: Pick<AflApiSettleRunResult, 'applied' | 'batchId' | 'counters' | 'halt' | 'rollbackReason' | 'refusalEvidence'>;
  exceptions: SettleExceptionReport | null;
}

/** Every counter of `AflApiSettleCounters`; the type check below fails if one is added or removed. */
export const AFL_API_COUNTER_KEYS = [
  'observationsSeen', 'payloadsCreated', 'payloadsReused', 'versionsAppended', 'observationsUnchanged',
  'observationsCorrected', 'observationsHistoryOnly', 'observationsMarkedAbsent', 'observationsReappeared',
  'absenceSweepSkipped', 'projectionRowsWritten', 'venueUnmapped', 'unresolvedIdentityPlayer',
  'unresolvedIdentityClub', 'unresolvedIdentityMatch', 'foreignOwnedCollision', 'corroboratedForeignOwned',
  'sourceDisagreement', 'manualAuthorityRefusals', 'candidatesCreated', 'candidatesRefreshed',
  'candidatesMootLeftPending', 'dataIssuesOpened', 'dataIssuesRefreshed', 'dataIssuesResolved',
  'canonicalRowsInserted', 'canonicalRowsUpdated', 'canonicalApplicationsLogged', 'canonicalApplyFailures',
  'canonicalApplyRefusals', 'attendanceEnrichmentsApplied', 'recordsDeferred', 'derivedRecomputeRuns',
  'derivedRecomputePlayers', 'snapshotMatches', 'snapshotPlayerMatchRows', 'buildFailures',
  'venueProviderUnmapped', 'seasonFeedMatches', 'seasonFeedComplete', 'seasonFeedStatusCounts',
  'nonParticipantPlayerRows',
] as const satisfies readonly (keyof AflApiSettleCounters)[];

type CounterKey = (typeof AFL_API_COUNTER_KEYS)[number];
// Compile-time exhaustiveness: no counter of AflApiSettleCounters may be missing from the list.
const COUNTER_LIST_IS_EXHAUSTIVE: Exclude<keyof AflApiSettleCounters, CounterKey> extends never ? true : never = true;
void COUNTER_LIST_IS_EXHAUSTIVE;

/** The two counters that are maps of counts rather than counts. */
const MAP_COUNTERS: readonly CounterKey[] = ['recordsDeferred', 'seasonFeedStatusCounts'];

/** Required fields of every object in the report; the validator enforces these and the JSON Schema repeats them. */
export const AFL_API_RECONCILIATION_REQUIRED = {
  report: ['format', 'formatVersion', 'generatedAt', 'source', 'run', 'counters', 'seasonFeed',
    'buildFailures', 'refusals', 'exceptions'],
  source: ['sourceKey', 'season', 'snapshotLabel', 'manifestSha256'],
  run: ['mode', 'batchId', 'applied', 'halt', 'rollbackReason'],
  seasonFeed: ['complete', 'matches', 'statusCounts', 'gaps'],
  gap: ['reason', 'detail'],
  buildFailure: ['providerMatchId', 'error'],
  refusal: ['family', 'externalRecordId', 'targetTable', 'refusal', 'matchKey', 'renderedFields', 'ownerSourceKey'],
  exceptions: ['sourceKey', 'season', 'latestBatch', 'unresolvedRecords', 'candidates', 'applyFailures',
    'disagreements', 'findingsTruncated', 'deferredRecords'],
} as const;

/* ------------------------------------------------------------------ *
 * Build
 * ------------------------------------------------------------------ */

function codeUnitCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedRecord<T>(source: Readonly<Record<string, T>>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of Object.keys(source).sort()) out[key] = source[key];
  return out;
}

function compareBuildFailures(a: AflApiBuildFailure, b: AflApiBuildFailure): number {
  return codeUnitCompare(a.providerMatchId ?? '', b.providerMatchId ?? '') || codeUnitCompare(a.error, b.error);
}

/** Build the report. Pure and deterministic: the same input always yields a deep-equal report. */
export function buildAflApiReconciliationReport(input: AflApiReconciliationReportInput): AflApiReconciliationReport {
  const feed = input.bundle.seasonFeed;
  const counters = { ...input.run.counters } as AflApiSettleCounters;
  counters.recordsDeferred = sortedRecord(input.run.counters.recordsDeferred);
  counters.seasonFeedStatusCounts = sortedRecord(input.run.counters.seasonFeedStatusCounts);
  const halt = input.run.halt;
  return {
    format: AFL_API_RECONCILIATION_REPORT_FORMAT,
    formatVersion: AFL_API_RECONCILIATION_REPORT_VERSION,
    generatedAt: input.generatedAt,
    source: {
      sourceKey: 'afl_api',
      season: input.bundle.season,
      snapshotLabel: input.bundle.snapshotLabel,
      manifestSha256: input.manifestSha256,
    },
    run: {
      mode: input.mode,
      batchId: input.run.batchId,
      applied: input.run.applied,
      halt: halt === null ? null : { reason: halt.reason, detail: { ...halt.detail } },
      rollbackReason: input.run.rollbackReason,
    },
    counters,
    seasonFeed: {
      complete: feed.complete,
      matches: feed.providerMatchIds.length,
      statusCounts: sortedRecord(feed.statusCounts),
      gaps: feed.gaps.map((gap) => ({ reason: gap.reason, detail: gap.detail })),
    },
    buildFailures: input.bundle.buildFailures
      .map((failure) => ({ providerMatchId: failure.providerMatchId, error: failure.error }))
      .sort(compareBuildFailures),
    refusals: input.run.refusalEvidence
      .map((evidence) => ({ ...evidence, renderedFields: [...evidence.renderedFields].sort() }))
      .sort((a, b) => compareAflApiRefusalCensusEntries(aflApiRefusalCensusEntry(a), aflApiRefusalCensusEntry(b))),
    exceptions: input.exceptions,
  };
}

/* ------------------------------------------------------------------ *
 * Serialise
 * ------------------------------------------------------------------ */

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] !== undefined) out[key] = sortKeys(source[key]);
    }
    return out;
  }
  return value;
}

/** Sorted-key JSON, two-space indent, one trailing newline. Byte-identical for equal reports. */
export function serialiseAflApiReconciliationReport(report: AflApiReconciliationReport): string {
  return `${JSON.stringify(sortKeys(report), null, 2)}\n`;
}

/* ------------------------------------------------------------------ *
 * Validate
 * ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isCountMap(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every(isCount);
}

function missing(path: string, value: Record<string, unknown>, required: readonly string[], problems: string[]): void {
  for (const key of required) {
    if (!(key in value)) problems.push(`${path}.${key} is required.`);
  }
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const SHA256 = /^[0-9a-f]{64}$/;

function checkRefusal(path: string, value: unknown, problems: string[]): boolean {
  if (!isRecord(value)) {
    problems.push(`${path} must be an object.`);
    return false;
  }
  const before = problems.length;
  missing(path, value, AFL_API_RECONCILIATION_REQUIRED.refusal, problems);
  for (const key of ['family', 'externalRecordId', 'targetTable', 'refusal', 'matchKey'] as const) {
    if (key in value && typeof value[key] !== 'string') problems.push(`${path}.${key} must be a string.`);
  }
  if ('ownerSourceKey' in value && value.ownerSourceKey !== null && typeof value.ownerSourceKey !== 'string') {
    problems.push(`${path}.ownerSourceKey must be a string or null.`);
  }
  if ('renderedFields' in value) {
    const fields = value.renderedFields;
    if (!Array.isArray(fields) || !fields.every((f) => typeof f === 'string')) {
      problems.push(`${path}.renderedFields must be an array of strings.`);
    } else if (fields.some((f, i) => i > 0 && fields[i - 1] > f)) {
      problems.push(`${path}.renderedFields must be sorted.`);
    }
  }
  return problems.length === before;
}

/** Every problem found in `value`; an empty array means it is a valid report of this format version. */
export function validateAflApiReconciliationReport(value: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(value)) return ['report must be an object.'];
  const required = AFL_API_RECONCILIATION_REQUIRED;
  missing('report', value, required.report, problems);

  if ('format' in value && value.format !== AFL_API_RECONCILIATION_REPORT_FORMAT) {
    problems.push(`report.format must be '${AFL_API_RECONCILIATION_REPORT_FORMAT}'.`);
  }
  if ('formatVersion' in value && value.formatVersion !== AFL_API_RECONCILIATION_REPORT_VERSION) {
    problems.push(`report.formatVersion must be ${AFL_API_RECONCILIATION_REPORT_VERSION}.`);
  }
  if ('generatedAt' in value
    && !(typeof value.generatedAt === 'string' && ISO_INSTANT.test(value.generatedAt) && !Number.isNaN(Date.parse(value.generatedAt)))) {
    problems.push('report.generatedAt must be an ISO-8601 UTC instant (YYYY-MM-DDTHH:MM:SS[.fff]Z).');
  }

  if ('source' in value) {
    const source = value.source;
    if (!isRecord(source)) problems.push('report.source must be an object.');
    else {
      missing('report.source', source, required.source, problems);
      if ('sourceKey' in source && source.sourceKey !== 'afl_api') problems.push("report.source.sourceKey must be 'afl_api'.");
      if ('season' in source && !(typeof source.season === 'number' && Number.isInteger(source.season))) {
        problems.push('report.source.season must be an integer.');
      }
      if ('snapshotLabel' in source && !(typeof source.snapshotLabel === 'string' && source.snapshotLabel !== '')) {
        problems.push('report.source.snapshotLabel must be a non-empty string.');
      }
      if ('manifestSha256' in source && source.manifestSha256 !== null
        && !(typeof source.manifestSha256 === 'string' && SHA256.test(source.manifestSha256))) {
        problems.push('report.source.manifestSha256 must be 64 lower-case hex characters or null.');
      }
    }
  }

  if ('run' in value) {
    const run = value.run;
    if (!isRecord(run)) problems.push('report.run must be an object.');
    else {
      missing('report.run', run, required.run, problems);
      if ('mode' in run && !(AFL_API_RECONCILIATION_RUN_MODES as readonly unknown[]).includes(run.mode)) {
        problems.push(`report.run.mode must be one of ${AFL_API_RECONCILIATION_RUN_MODES.join(', ')}.`);
      }
      if ('batchId' in run && run.batchId !== null && !(typeof run.batchId === 'string' && /^\d+$/.test(run.batchId))) {
        problems.push('report.run.batchId must be decimal text or null.');
      }
      if ('applied' in run && typeof run.applied !== 'boolean') problems.push('report.run.applied must be a boolean.');
      if ('halt' in run && run.halt !== null
        && !(isRecord(run.halt) && typeof run.halt.reason === 'string' && isRecord(run.halt.detail))) {
        problems.push('report.run.halt must be null or { reason: string, detail: object }.');
      }
      if ('rollbackReason' in run && run.rollbackReason !== null
        && run.rollbackReason !== 'dry_run' && run.rollbackReason !== 'require_complete_source') {
        problems.push("report.run.rollbackReason must be null, 'dry_run' or 'require_complete_source'.");
      }
      if (run.mode === 'dry_run' && run.applied === true) problems.push('report.run: a dry_run cannot be applied.');
      if (isRecord(run.halt) && (run.applied === true || run.batchId !== null)) {
        problems.push('report.run: a HALT commits nothing, so applied must be false and batchId null.');
      }
    }
  }

  if ('counters' in value) {
    const counters = value.counters;
    if (!isRecord(counters)) problems.push('report.counters must be an object.');
    else {
      for (const key of AFL_API_COUNTER_KEYS) {
        if (!(key in counters)) problems.push(`report.counters.${key} is required.`);
        else if (MAP_COUNTERS.includes(key)) {
          if (!isCountMap(counters[key])) problems.push(`report.counters.${key} must map names to non-negative integers.`);
        } else if (!isCount(counters[key])) problems.push(`report.counters.${key} must be a non-negative integer.`);
      }
    }
  }

  if ('seasonFeed' in value) {
    const feed = value.seasonFeed;
    if (!isRecord(feed)) problems.push('report.seasonFeed must be an object.');
    else {
      missing('report.seasonFeed', feed, required.seasonFeed, problems);
      if ('complete' in feed && typeof feed.complete !== 'boolean') problems.push('report.seasonFeed.complete must be a boolean.');
      if ('matches' in feed && !isCount(feed.matches)) problems.push('report.seasonFeed.matches must be a non-negative integer.');
      if ('statusCounts' in feed && !isCountMap(feed.statusCounts)) {
        problems.push('report.seasonFeed.statusCounts must map statuses to non-negative integers.');
      }
      if ('gaps' in feed) {
        if (!Array.isArray(feed.gaps)) problems.push('report.seasonFeed.gaps must be an array.');
        else {
          feed.gaps.forEach((gap, i) => {
            if (!isRecord(gap)) problems.push(`report.seasonFeed.gaps[${i}] must be an object.`);
            else {
              missing(`report.seasonFeed.gaps[${i}]`, gap, required.gap, problems);
              if (typeof gap.reason !== 'string' || typeof gap.detail !== 'string') {
                problems.push(`report.seasonFeed.gaps[${i}] reason and detail must be strings.`);
              }
            }
          });
          if (feed.complete === true && feed.gaps.length > 0) {
            problems.push('report.seasonFeed: a complete feed has no gaps.');
          }
        }
      }
    }
  }

  if ('buildFailures' in value) {
    const failures = value.buildFailures;
    if (!Array.isArray(failures)) problems.push('report.buildFailures must be an array.');
    else {
      let shapesOk = true;
      failures.forEach((failure, i) => {
        if (!isRecord(failure)) {
          problems.push(`report.buildFailures[${i}] must be an object.`);
          shapesOk = false;
          return;
        }
        const before = problems.length;
        missing(`report.buildFailures[${i}]`, failure, required.buildFailure, problems);
        if ('providerMatchId' in failure && failure.providerMatchId !== null && typeof failure.providerMatchId !== 'string') {
          problems.push(`report.buildFailures[${i}].providerMatchId must be a string or null.`);
        }
        if ('error' in failure && typeof failure.error !== 'string') problems.push(`report.buildFailures[${i}].error must be a string.`);
        if (problems.length > before) shapesOk = false;
      });
      if (shapesOk) {
        const list = failures as AflApiBuildFailure[];
        for (let i = 1; i < list.length; i += 1) {
          if (compareBuildFailures(list[i - 1], list[i]) > 0) {
            problems.push(`report.buildFailures is not sorted by (providerMatchId, error) at index ${i}.`);
            break;
          }
        }
      }
    }
  }

  if ('refusals' in value) {
    const refusals = value.refusals;
    if (!Array.isArray(refusals)) problems.push('report.refusals must be an array.');
    else {
      const shapes = refusals.map((refusal, i) => checkRefusal(`report.refusals[${i}]`, refusal, problems));
      if (shapes.every(Boolean)) {
        const list = refusals as AflApiCanonicalRefusalEvidence[];
        for (let i = 1; i < list.length; i += 1) {
          if (compareAflApiRefusalCensusEntries(aflApiRefusalCensusEntry(list[i - 1]), aflApiRefusalCensusEntry(list[i])) > 0) {
            problems.push(`report.refusals is not in census order at index ${i}.`);
            break;
          }
        }
      }
    }
  }

  if ('exceptions' in value && value.exceptions !== null) {
    const exceptions = value.exceptions;
    if (!isRecord(exceptions)) problems.push('report.exceptions must be null or an object.');
    else {
      missing('report.exceptions', exceptions, required.exceptions, problems);
      if ('sourceKey' in exceptions && typeof exceptions.sourceKey !== 'string') problems.push('report.exceptions.sourceKey must be a string.');
      if ('season' in exceptions && typeof exceptions.season !== 'number') problems.push('report.exceptions.season must be a number.');
      if ('findingsTruncated' in exceptions && typeof exceptions.findingsTruncated !== 'boolean') {
        problems.push('report.exceptions.findingsTruncated must be a boolean.');
      }
      for (const key of ['unresolvedRecords', 'applyFailures', 'disagreements'] as const) {
        if (key in exceptions && !Array.isArray(exceptions[key])) problems.push(`report.exceptions.${key} must be an array.`);
      }
      if ('candidates' in exceptions) {
        const candidates = exceptions.candidates;
        if (!(isRecord(candidates) && Array.isArray(candidates.active) && Array.isArray(candidates.moot))) {
          problems.push('report.exceptions.candidates must be { active: [], moot: [] }.');
        }
      }
      if ('deferredRecords' in exceptions && !isCountMap(exceptions.deferredRecords)) {
        problems.push('report.exceptions.deferredRecords must map reasons to non-negative integers.');
      }
      if ('latestBatch' in exceptions && exceptions.latestBatch !== null && !isRecord(exceptions.latestBatch)) {
        problems.push('report.exceptions.latestBatch must be null or an object.');
      }
    }
  }

  return problems;
}

/* ------------------------------------------------------------------ *
 * JSON Schema (draft 2020-12) — the same contract for consumers outside TypeScript
 * ------------------------------------------------------------------ */

const STRING = { type: 'string' } as const;
const COUNT = { type: 'integer', minimum: 0 } as const;
const COUNT_MAP = { type: 'object', additionalProperties: COUNT } as const;

export const AFL_API_RECONCILIATION_REPORT_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://afldb.example/schemas/afl-api-reconciliation-report/1.json',
  title: 'AFL API reconciliation report (AFLDB V2)',
  type: 'object',
  required: ['format', 'formatVersion', 'generatedAt', 'source', 'run', 'counters', 'seasonFeed',
    'buildFailures', 'refusals', 'exceptions'],
  additionalProperties: false,
  properties: {
    format: { const: AFL_API_RECONCILIATION_REPORT_FORMAT },
    formatVersion: { const: AFL_API_RECONCILIATION_REPORT_VERSION },
    generatedAt: {
      type: 'string',
      pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$',
    },
    source: {
      type: 'object',
      required: ['sourceKey', 'season', 'snapshotLabel', 'manifestSha256'],
      additionalProperties: false,
      properties: {
        sourceKey: { const: 'afl_api' },
        season: { type: 'integer' },
        snapshotLabel: { type: 'string', minLength: 1 },
        manifestSha256: { oneOf: [{ type: 'null' }, { type: 'string', pattern: '^[0-9a-f]{64}$' }] },
      },
    },
    run: {
      type: 'object',
      required: ['mode', 'batchId', 'applied', 'halt', 'rollbackReason'],
      additionalProperties: false,
      properties: {
        mode: { enum: [...AFL_API_RECONCILIATION_RUN_MODES] },
        batchId: { oneOf: [{ type: 'null' }, { type: 'string', pattern: '^\\d+$' }] },
        applied: { type: 'boolean' },
        halt: {
          oneOf: [
            { type: 'null' },
            {
              type: 'object',
              required: ['reason', 'detail'],
              properties: { reason: STRING, detail: { type: 'object' } },
            },
          ],
        },
        rollbackReason: { enum: [null, 'dry_run', 'require_complete_source'] },
      },
    },
    counters: {
      type: 'object',
      required: [...AFL_API_COUNTER_KEYS],
      additionalProperties: false,
      properties: Object.fromEntries(
        AFL_API_COUNTER_KEYS.map((key) => [key, MAP_COUNTERS.includes(key) ? COUNT_MAP : COUNT]),
      ),
    },
    seasonFeed: {
      type: 'object',
      required: ['complete', 'matches', 'statusCounts', 'gaps'],
      additionalProperties: false,
      properties: {
        complete: { type: 'boolean' },
        matches: COUNT,
        statusCounts: COUNT_MAP,
        gaps: {
          type: 'array',
          items: {
            type: 'object',
            required: ['reason', 'detail'],
            additionalProperties: false,
            properties: { reason: STRING, detail: STRING },
          },
        },
      },
    },
    buildFailures: {
      type: 'array',
      items: {
        type: 'object',
        required: ['providerMatchId', 'error'],
        additionalProperties: false,
        properties: { providerMatchId: { type: ['string', 'null'] }, error: STRING },
      },
    },
    refusals: {
      type: 'array',
      items: {
        type: 'object',
        required: ['family', 'externalRecordId', 'targetTable', 'refusal', 'matchKey', 'renderedFields', 'ownerSourceKey'],
        additionalProperties: false,
        properties: {
          family: STRING,
          externalRecordId: STRING,
          targetTable: STRING,
          refusal: STRING,
          matchKey: STRING,
          renderedFields: { type: 'array', items: STRING },
          ownerSourceKey: { type: ['string', 'null'] },
        },
      },
    },
    exceptions: {
      oneOf: [
        { type: 'null' },
        {
          type: 'object',
          required: ['sourceKey', 'season', 'latestBatch', 'unresolvedRecords', 'candidates', 'applyFailures',
            'disagreements', 'findingsTruncated', 'deferredRecords'],
          properties: {
            sourceKey: STRING,
            season: { type: 'number' },
            latestBatch: { type: ['object', 'null'] },
            unresolvedRecords: { type: 'array' },
            candidates: {
              type: 'object',
              required: ['active', 'moot'],
              properties: { active: { type: 'array' }, moot: { type: 'array' } },
            },
            applyFailures: { type: 'array' },
            disagreements: { type: 'array' },
            findingsTruncated: { type: 'boolean' },
            deferredRecords: COUNT_MAP,
          },
        },
      ],
    },
  },
} as const;
