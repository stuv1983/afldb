/**
 * AFLDB V2 Stage 6 — the shadow PARITY comparison (docs/v2/plan.md §3; docs/v2/shadow-rehearsal.md).
 *
 * A shadow rehearsal runs V2 steps against a RESTORED COPY of the database. Before and after those
 * steps the operator captures a small set of content-free artefacts; this module compares the
 * "before" and "after" artefacts and emits ONE machine-readable verdict. It is EVIDENCE: it
 * decides nothing about the database and writes nothing.
 *
 * Five REQUIRED checks, each `pass` | `fail` | `incomplete`:
 *   1. `historical_manifest` — two sealed-history manifests (zero tolerance on sealed history);
 *   2. `table_row_counts`    — two `afldb.v2.table-row-counts` inventories;
 *   3. `coleman`             — two `afldb.v2.coleman-comparison-report` files;
 *   4. `brownlow`            — `afldb.v2.brownlow-reconciliation-report` files, paired by season;
 *   5. `coverage`            — two `afldb.v2.coverage-registry-export` files (format defined here).
 *
 * Fail-closed: an input that is not supplied makes its check `incomplete` (INPUT_MISSING); an
 * input that cannot be read or fails its validator makes its check `incomplete` (INPUT_INVALID,
 * carrying the validator's message and never the file's content). Verdict precedence: any `fail`
 * -> FAIL; else any `incomplete` -> INCOMPLETE; else PASS. A missing input can never yield PASS.
 *
 * Pure: no database, no network, no file system, no clock (`generatedAt` is caller-supplied). The
 * thin CLI is `tools/v2/shadow-parity.ts`. Labels are file BASENAMES only.
 */
import {
  COVERAGE_FAMILIES,
  COVERAGE_STATUSES,
  V2_ADDED_TABLES,
  checkCoverageEvidence,
  compareManifests,
  coverageFor,
  isV2AddedTable,
  parseManifest,
  parseTableRowCounts,
  validateCoverageRegistry,
  type CoverageEntry,
  type CoverageFamily,
  type CoverageStatus,
  type HistoricalManifest,
  type SeasonRegistry,
  type TableRowCounts,
} from '@afldb/domain';

import { validateBrownlowReconciliationReport, type BrownlowReconciliationReport } from './brownlow-reconciliation-report';
import { sortKeysDeep } from './coleman';
import { validateColemanComparisonReport, type ColemanComparisonReport } from './coleman-comparison';

export const SHADOW_PARITY_REPORT_FORMAT = 'afldb.v2.shadow-parity-report';
export const SHADOW_PARITY_REPORT_VERSION = 1;
/** Versions the thresholds below. Bump it whenever a rule, a code or a severity changes. */
export const SHADOW_PARITY_POLICY_VERSION = 'v2.parity.1';

export const SHADOW_PARITY_CHECK_IDS = ['historical_manifest', 'table_row_counts', 'coleman', 'brownlow', 'coverage'] as const;
export type ShadowParityCheckId = (typeof SHADOW_PARITY_CHECK_IDS)[number];

export const SHADOW_PARITY_STATUSES = ['pass', 'fail', 'incomplete'] as const;
export type ShadowParityStatus = (typeof SHADOW_PARITY_STATUSES)[number];

export const SHADOW_PARITY_VERDICTS = ['PASS', 'FAIL', 'INCOMPLETE'] as const;
export type ShadowParityVerdict = (typeof SHADOW_PARITY_VERDICTS)[number];

export type ShadowParityFindingSeverity = 'fail' | 'info';

export interface ShadowParityFinding {
  readonly code: string;
  readonly severity: ShadowParityFindingSeverity;
  readonly subject: string;
  readonly detail: string;
}

export interface ShadowParityCheck {
  readonly id: ShadowParityCheckId;
  readonly required: true;
  readonly status: ShadowParityStatus;
  readonly inputs: {
    readonly before: string | readonly string[] | null;
    readonly after: string | readonly string[] | null;
  };
  /** The embedded rule for this check, one line. */
  readonly thresholds: string;
  /** Always carries `fail` and `info` finding counts, plus check-specific counts. */
  readonly counts: Readonly<Record<string, number>>;
  readonly findings: readonly ShadowParityFinding[];
}

export interface ShadowParityReport {
  readonly format: typeof SHADOW_PARITY_REPORT_FORMAT;
  readonly formatVersion: typeof SHADOW_PARITY_REPORT_VERSION;
  readonly policyVersion: typeof SHADOW_PARITY_POLICY_VERSION;
  /** Caller-supplied ISO-8601 UTC instant. Never a clock read. */
  readonly generatedAt: string;
  readonly verdict: ShadowParityVerdict;
  readonly checks: readonly ShadowParityCheck[];
  readonly summary: { readonly pass: number; readonly fail: number; readonly incomplete: number };
}

/** The embedded, versioned thresholds (policy v2.parity.1), one line per check. */
export const SHADOW_PARITY_THRESHOLDS: Readonly<Record<ShadowParityCheckId, string>> = {
  historical_manifest: 'Zero tolerance on sealed history: every comparator violation, unverified and review finding FAILS '
    + '(including METADATA_CHANGED on a sealed bucket, REFERENCE_CHANGED, REFERENCE_ROWS_DECREASED, METADATA_COLUMNS_CHANGED, '
    + 'SPEC_VERSION_DIFFERS and every definition change) and a moved seal (SEALED_RANGE_DIFFERS) FAILS; only OPEN_SEASON_CHANGED '
    + 'and TABLE_ADDED are info. The manifest digests stable id columns as facts and reference tables whole, so any id change '
    + 'surfaces as a fail finding.',
  table_row_counts: 'Schemas must match; a dropped table FAILS; a table added after FAILS unless it is one of the V2-added tables '
    + '(award_proposals, award_proposal_decisions, derived_award_results), which must all be present after; fewer rows in a non-V2 '
    + 'table FAILS; more rows in a non-V2 table and any change in a V2-added table are info.',
  coleman: 'Per season present before: missing after, category, stored active rows, derived winners, input checksum or refusal '
    + 'code changed all FAIL, as does any change in stored seasons without an outcome; a season that disagrees (or is not derivable '
    + 'with the same refusal code) in both is info for owner reconciliation (V2-GAP-015); a season only after is info.',
  brownlow: 'Reports pair by season (a duplicate season on one side is an invalid input). For a season complete before: missing '
    + 'after, state, outcome, raw player totals, award presentation (status, refusal, leaders, eligibility rule) or finding counts '
    + 'changed all FAIL; discrepancies or refused in both, unchanged, is info; an in-progress season may change (info); a season '
    + 'only after is info.',
  coverage: 'Either registry export with registry problems FAILS; a coverage cell missing on either side FAILS; any status change '
    + 'FAILS (claims never move during a rehearsal).',
};

/* ------------------------------------------------------------------ *
 * Inputs
 * ------------------------------------------------------------------ */

/** One input slot as the caller read it: null = not supplied; `text` null = supplied but unreadable. */
export interface ShadowParityInputFile {
  /** A file name. Any directory part is stripped: labels are BASENAMES only. */
  readonly label: string;
  readonly text: string | null;
}
export type ShadowParityInput = ShadowParityInputFile | null;

export interface ShadowParityInputs {
  readonly manifest: { readonly before: ShadowParityInput; readonly after: ShadowParityInput };
  readonly rowCounts: { readonly before: ShadowParityInput; readonly after: ShadowParityInput };
  readonly coleman: { readonly before: ShadowParityInput; readonly after: ShadowParityInput };
  /** One report per season on each side. */
  readonly brownlow: { readonly before: readonly ShadowParityInputFile[]; readonly after: readonly ShadowParityInputFile[] };
  readonly coverage: { readonly before: ShadowParityInput; readonly after: ShadowParityInput };
}

const codeUnitCompare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const basenameOf = (label: string): string => {
  const base = label.split(/[\\/]/).pop() ?? '';
  return base === '' ? '(unnamed)' : base;
};

/** Printable ASCII only, bounded: a message can never carry a long or binary payload. */
const safeText = (text: string, max = 300): string => text.replace(/[^\x20-\x7e]/g, '?').slice(0, max);

class InputProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputProblem';
  }
}

function summariseProblems(problems: readonly string[]): string {
  const shown = problems.slice(0, 3).join(' ');
  return problems.length > 3 ? `${shown} (+${problems.length - 3} more)` : shown;
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new InputProblem(`${label}: not valid JSON`);
  }
}

type Loaded<T> =
  | { readonly ok: true; readonly label: string; readonly value: T }
  | { readonly ok: false; readonly label: string | null };

interface Collector {
  readonly findings: ShadowParityFinding[];
}

const add = (c: Collector, code: string, severity: ShadowParityFindingSeverity, subject: string, detail: string): void => {
  c.findings.push({ code, severity, subject, detail });
};

/** Loads one input slot; records INPUT_MISSING / INPUT_INVALID instead of throwing. */
function load<T>(
  c: Collector,
  slot: string,
  what: string,
  input: ShadowParityInput,
  parse: (text: string, label: string) => T,
): Loaded<T> {
  if (input === null) {
    add(c, 'INPUT_MISSING', 'fail', slot, `no ${what} was supplied for ${slot}`);
    return { ok: false, label: null };
  }
  const label = basenameOf(input.label);
  if (input.text === null) {
    add(c, 'INPUT_INVALID', 'fail', `${slot}:${label}`, `the ${what} file could not be read`);
    return { ok: false, label };
  }
  try {
    return { ok: true, label, value: parse(input.text, label) };
  } catch (error) {
    const known = error instanceof InputProblem
      || (error instanceof Error && (error.name === 'ManifestFormatError' || error.name === 'TableRowCountsFormatError'));
    // The format errors echo an unsupported formatVersion VALUE; drop it so no file content is repeated.
    const message = known ? (error as Error).message.replace(/(unsupported formatVersion).*$/, '$1') : `${label}: could not be validated`;
    add(c, 'INPUT_INVALID', 'fail', `${slot}:${label}`, safeText(`${what}: ${message}`));
    return { ok: false, label };
  }
}

function parseColeman(text: string, label: string): ColemanComparisonReport {
  const value = parseJson(text, label);
  const problems = validateColemanComparisonReport(value);
  if (problems.length > 0) throw new InputProblem(`${label}: ${summariseProblems(problems)}`);
  return value as ColemanComparisonReport;
}

function parseBrownlow(text: string, label: string): BrownlowReconciliationReport {
  const value = parseJson(text, label);
  const problems = validateBrownlowReconciliationReport(value);
  if (problems.length > 0) throw new InputProblem(`${label}: ${summariseProblems(problems)}`);
  return value as BrownlowReconciliationReport;
}

/* ------------------------------------------------------------------ *
 * Check assembly
 * ------------------------------------------------------------------ */

const severityRank = (s: ShadowParityFindingSeverity): number => (s === 'fail' ? 0 : 1);

function sortFindings(findings: readonly ShadowParityFinding[]): ShadowParityFinding[] {
  return [...findings].sort((a, b) =>
    severityRank(a.severity) - severityRank(b.severity)
    || codeUnitCompare(a.code, b.code)
    || codeUnitCompare(a.subject, b.subject)
    || codeUnitCompare(a.detail, b.detail));
}

const isInputCode = (code: string): boolean => code === 'INPUT_MISSING' || code === 'INPUT_INVALID';

function statusOf(findings: readonly ShadowParityFinding[]): ShadowParityStatus {
  if (findings.some((f) => f.severity === 'fail' && !isInputCode(f.code))) return 'fail';
  if (findings.some((f) => isInputCode(f.code))) return 'incomplete';
  return 'pass';
}

function finish(
  id: ShadowParityCheckId,
  inputs: ShadowParityCheck['inputs'],
  c: Collector,
  extraCounts: Readonly<Record<string, number>>,
): ShadowParityCheck {
  const findings = sortFindings(c.findings);
  const counts: Record<string, number> = {
    ...extraCounts,
    fail: findings.filter((f) => f.severity === 'fail').length,
    info: findings.filter((f) => f.severity === 'info').length,
  };
  const sorted: Record<string, number> = {};
  for (const key of Object.keys(counts).sort(codeUnitCompare)) sorted[key] = counts[key];
  return { id, required: true, status: statusOf(findings), inputs, thresholds: SHADOW_PARITY_THRESHOLDS[id], counts: sorted, findings };
}

const labelOrNull = (loaded: Loaded<unknown>, input: ShadowParityInput): string | null =>
  input === null ? null : (loaded.label ?? basenameOf(input.label));

/* ------------------------------------------------------------------ *
 * 1. historical_manifest
 * ------------------------------------------------------------------ */

function checkHistoricalManifest(before: ShadowParityInput, after: ShadowParityInput): ShadowParityCheck {
  const c: Collector = { findings: [] };
  const b = load<HistoricalManifest>(c, 'before', 'historical manifest', before, parseManifest);
  const a = load<HistoricalManifest>(c, 'after', 'historical manifest', after, parseManifest);
  const counts: Record<string, number> = { comparatorInfo: 0, review: 0, unverified: 0, violation: 0 };
  if (b.ok && a.ok) {
    const comparison = compareManifests(b.value, a.value);
    counts.violation = comparison.counts.violation;
    counts.unverified = comparison.counts.unverified;
    counts.review = comparison.counts.review;
    counts.comparatorInfo = comparison.counts.info;
    for (const f of comparison.findings) {
      // The comparator grades a moved seal info when the ranges overlap; a rehearsal must not move it.
      const severity: ShadowParityFindingSeverity = f.code === 'SEALED_RANGE_DIFFERS' || f.severity !== 'info' ? 'fail' : 'info';
      const subject = f.table === null ? 'manifest' : (f.season === null ? f.table : `${f.table} ${f.season}`);
      add(c, f.code, severity, subject, `comparator ${f.severity}: ${f.detail}`);
    }
  }
  return finish('historical_manifest', { before: labelOrNull(b, before), after: labelOrNull(a, after) }, c, counts);
}

/* ------------------------------------------------------------------ *
 * 2. table_row_counts
 * ------------------------------------------------------------------ */

function checkTableRowCounts(before: ShadowParityInput, after: ShadowParityInput): ShadowParityCheck {
  const c: Collector = { findings: [] };
  const b = load<TableRowCounts>(c, 'before', 'table row-count inventory', before, parseTableRowCounts);
  const a = load<TableRowCounts>(c, 'after', 'table row-count inventory', after, parseTableRowCounts);
  const counts: Record<string, number> = { tablesAfter: 0, tablesBefore: 0 };
  if (b.ok && a.ok) {
    counts.tablesBefore = b.value.tables.length;
    counts.tablesAfter = a.value.tables.length;
    const key = (t: { schema: string; table: string }): string => `${t.schema}.${t.table}`;
    if (b.value.schemas.length !== a.value.schemas.length || b.value.schemas.some((s, i) => s !== a.value.schemas[i])) {
      add(c, 'SCHEMAS_DIFFER', 'fail', 'schemas', `[${b.value.schemas.join(', ')}] -> [${a.value.schemas.join(', ')}]`);
    }
    const beforeMap = new Map(b.value.tables.map((t) => [key(t), t]));
    const afterMap = new Map(a.value.tables.map((t) => [key(t), t]));
    for (const [name, t] of beforeMap) {
      const x = afterMap.get(name);
      if (x === undefined) {
        add(c, 'TABLE_DROPPED', 'fail', name, `present before (${t.rows} rows), absent after`);
      } else if (isV2AddedTable(t.schema, t.table)) {
        if (x.rows !== t.rows) add(c, 'V2_TABLE_ROWS_CHANGED', 'info', name, `rows ${t.rows} -> ${x.rows} (V2-added table)`);
      } else if (x.rows < t.rows) {
        add(c, 'ROWS_DECREASED', 'fail', name, `rows ${t.rows} -> ${x.rows}`);
      } else if (x.rows > t.rows) {
        add(c, 'ROWS_INCREASED', 'info', name, `rows ${t.rows} -> ${x.rows}`);
      }
    }
    for (const [name, x] of afterMap) {
      if (beforeMap.has(name)) continue;
      if (isV2AddedTable(x.schema, x.table)) add(c, 'V2_TABLE_ADDED', 'info', name, `created by the V2 migrations; ${x.rows} rows after`);
      else add(c, 'UNEXPECTED_TABLE_ADDED', 'fail', name, `absent before, present after (${x.rows} rows), and not a V2-added table`);
    }
    for (const v2 of V2_ADDED_TABLES) {
      const name = `${v2.schema}.${v2.table}`;
      if (!afterMap.has(name)) {
        add(c, 'V2_TABLE_ABSENT', 'fail', name, `the after state must carry migration ${v2.migration}; the table is absent`);
      }
    }
  }
  return finish('table_row_counts', { before: labelOrNull(b, before), after: labelOrNull(a, after) }, c, counts);
}

/* ------------------------------------------------------------------ *
 * 3. coleman
 * ------------------------------------------------------------------ */

const canon = (value: unknown): string => JSON.stringify(sortKeysDeep(value));

/** A canonical, sorted set of JSON values. */
const canonicalSet = (items: readonly unknown[]): string[] => items.map(canon).sort(codeUnitCompare);

function setDifference(before: readonly string[], after: readonly string[]): { onlyBefore: number; onlyAfter: number } | null {
  if (before.length === after.length && before.every((v, i) => v === after[i])) return null;
  const a = new Set(after);
  const b = new Set(before);
  return { onlyBefore: before.filter((v) => !a.has(v)).length, onlyAfter: after.filter((v) => !b.has(v)).length };
}

function checkColeman(before: ShadowParityInput, after: ShadowParityInput): ShadowParityCheck {
  const c: Collector = { findings: [] };
  const b = load<ColemanComparisonReport>(c, 'before', 'Coleman comparison report', before, parseColeman);
  const a = load<ColemanComparisonReport>(c, 'after', 'Coleman comparison report', after, parseColeman);
  const counts: Record<string, number> = { seasonsAfter: 0, seasonsBefore: 0, seasonsCompared: 0 };
  if (b.ok && a.ok) {
    counts.seasonsBefore = b.value.seasons.length;
    counts.seasonsAfter = a.value.seasons.length;
    const afterBySeason = new Map(a.value.seasons.map((s) => [s.season, s]));
    const beforeSeasons = new Set(b.value.seasons.map((s) => s.season));
    for (const x of b.value.seasons) {
      const subject = `season ${x.season}`;
      const y = afterBySeason.get(x.season);
      if (y === undefined) {
        add(c, 'SEASON_MISSING', 'fail', subject, 'present in the before report, absent from the after report');
        continue;
      }
      counts.seasonsCompared += 1;
      if (x.category !== y.category) add(c, 'CATEGORY_CHANGED', 'fail', subject, `${x.category} -> ${y.category}`);
      const stored = setDifference(canonicalSet(x.stored), canonicalSet(y.stored));
      if (stored) {
        add(c, 'STORED_WINNERS_CHANGED', 'fail', subject,
          `stored active rows ${x.stored.length} -> ${y.stored.length} (${stored.onlyBefore} only before, ${stored.onlyAfter} only after)`);
      }
      const derived = setDifference(canonicalSet(x.derivedWinners), canonicalSet(y.derivedWinners));
      if (derived) {
        add(c, 'DERIVED_WINNERS_CHANGED', 'fail', subject,
          `derived winners ${x.derivedWinners.length} -> ${y.derivedWinners.length} (${derived.onlyBefore} only before, ${derived.onlyAfter} only after)`);
      }
      if (x.inputChecksum !== y.inputChecksum) {
        add(c, 'INPUT_CHANGED', 'fail', subject,
          `derivation input checksum changed${x.inputChecksum === null || y.inputChecksum === null ? ' (one side has no derivation)' : ''}`);
      }
      if (x.category === 'not_derivable' && y.category === 'not_derivable') {
        if (x.refusal?.code !== y.refusal?.code) {
          add(c, 'REFUSAL_CHANGED', 'fail', subject, `refusal code ${String(x.refusal?.code)} -> ${String(y.refusal?.code)}`);
        } else {
          add(c, 'PREEXISTING_NOT_DERIVABLE', 'info', subject, `not derivable in both (${String(x.refusal?.code)}); unchanged`);
        }
      }
      if (x.category === 'disagree' && y.category === 'disagree') {
        add(c, 'PREEXISTING_DISAGREEMENT', 'info', subject,
          `derived and stored winners disagree in both (missing ${y.missing.length}, extra ${y.extra.length}, duplicates ${y.duplicates.length}); `
          + 'listed for owner reconciliation (V2-GAP-015)');
      }
    }
    for (const y of a.value.seasons) {
      if (!beforeSeasons.has(y.season)) add(c, 'SEASON_ADDED', 'info', `season ${y.season}`, `only in the after report (${y.category})`);
    }
    const withoutB = b.value.storedSeasonsWithoutOutcome;
    const withoutA = a.value.storedSeasonsWithoutOutcome;
    if (withoutB.length !== withoutA.length || withoutB.some((s, i) => s !== withoutA[i])) {
      add(c, 'STORED_SEASONS_WITHOUT_OUTCOME_CHANGED', 'fail', 'storedSeasonsWithoutOutcome',
        `[${withoutB.join(', ')}] -> [${withoutA.join(', ')}]`);
    }
  }
  return finish('coleman', { before: labelOrNull(b, before), after: labelOrNull(a, after) }, c, counts);
}

/* ------------------------------------------------------------------ *
 * 4. brownlow
 * ------------------------------------------------------------------ */

interface BrownlowSide {
  readonly labels: string[];
  readonly bySeason: Map<number, BrownlowReconciliationReport>;
  readonly usable: boolean;
}

function loadBrownlowSide(c: Collector, slot: string, files: readonly ShadowParityInputFile[]): BrownlowSide {
  const labels = files.map((f) => basenameOf(f.label)).sort(codeUnitCompare);
  const bySeason = new Map<number, BrownlowReconciliationReport>();
  let usable = true;
  if (files.length === 0) {
    add(c, 'INPUT_MISSING', 'fail', slot, `no Brownlow reconciliation report was supplied for ${slot}`);
    return { labels, bySeason, usable: false };
  }
  const ordered = [...files].sort((x, y) => codeUnitCompare(basenameOf(x.label), basenameOf(y.label)));
  const seasonLabel = new Map<number, string>();
  for (const file of ordered) {
    const loaded = load<BrownlowReconciliationReport>(c, slot, 'Brownlow reconciliation report', file, parseBrownlow);
    if (!loaded.ok) {
      usable = false;
      continue;
    }
    const season = loaded.value.source.season;
    if (bySeason.has(season)) {
      add(c, 'INPUT_INVALID', 'fail', `${slot}:${loaded.label}`,
        `Brownlow reconciliation report: season ${season} is also reported by ${seasonLabel.get(season)}; one report per season per side`);
      usable = false;
      continue;
    }
    bySeason.set(season, loaded.value);
    seasonLabel.set(season, loaded.label);
  }
  return { labels, bySeason, usable };
}

function brownlowSnapshot(r: BrownlowReconciliationReport): string {
  return canon({
    seasonState: r.source.seasonState,
    outcome: r.outcome,
    rawVotes: { basis: r.rawVotes.basis, playerTotals: r.rawVotes.playerTotals },
    award: {
      status: r.awardResultPresentation.status,
      refusalCode: r.awardResultPresentation.refusalCode,
      leaders: r.awardResultPresentation.leaders,
      eligibilityRule: r.awardResultPresentation.eligibilityRule,
    },
    findingCounts: r.findingCounts,
  });
}

function checkBrownlow(before: readonly ShadowParityInputFile[], after: readonly ShadowParityInputFile[]): ShadowParityCheck {
  const c: Collector = { findings: [] };
  const b = loadBrownlowSide(c, 'before', before);
  const a = loadBrownlowSide(c, 'after', after);
  const counts: Record<string, number> = { seasonsAfter: 0, seasonsBefore: 0, seasonsCompared: 0 };
  if (b.usable && a.usable) {
    counts.seasonsBefore = b.bySeason.size;
    counts.seasonsAfter = a.bySeason.size;
    for (const season of [...b.bySeason.keys()].sort((x, y) => x - y)) {
      const x = b.bySeason.get(season) as BrownlowReconciliationReport;
      const y = a.bySeason.get(season);
      const subject = `season ${season}`;
      if (x.source.seasonState === 'in_progress') {
        if (y === undefined) add(c, 'IN_PROGRESS_SEASON_CHANGED', 'info', subject, 'in progress before; no after report');
        else {
          counts.seasonsCompared += 1;
          if (brownlowSnapshot(x) !== brownlowSnapshot(y)) {
            add(c, 'IN_PROGRESS_SEASON_CHANGED', 'info', subject, `in progress before; outcome ${x.outcome} -> ${y.outcome}, state ${x.source.seasonState} -> ${y.source.seasonState}`);
          }
        }
        continue;
      }
      if (y === undefined) {
        add(c, 'SEASON_MISSING', 'fail', subject, 'complete in the before reports, absent from the after reports');
        continue;
      }
      counts.seasonsCompared += 1;
      if (y.source.seasonState !== 'complete') {
        add(c, 'SEASON_STATE_CHANGED', 'fail', subject, `${x.source.seasonState} -> ${y.source.seasonState}; a complete season must stay complete`);
      }
      if (x.outcome !== y.outcome) add(c, 'OUTCOME_CHANGED', 'fail', subject, `${x.outcome} -> ${y.outcome}`);
      if (canon({ basis: x.rawVotes.basis, totals: x.rawVotes.playerTotals }) !== canon({ basis: y.rawVotes.basis, totals: y.rawVotes.playerTotals })) {
        add(c, 'PLAYER_TOTALS_CHANGED', 'fail', subject,
          `raw player totals or evidence basis changed (${x.rawVotes.playerTotals.length} -> ${y.rawVotes.playerTotals.length} vote-getters)`);
      }
      const award = (r: BrownlowReconciliationReport): string => canon({
        status: r.awardResultPresentation.status,
        refusalCode: r.awardResultPresentation.refusalCode,
        leaders: r.awardResultPresentation.leaders,
        eligibilityRule: r.awardResultPresentation.eligibilityRule,
      });
      if (award(x) !== award(y)) {
        add(c, 'AWARD_PRESENTATION_CHANGED', 'fail', subject,
          `award presentation changed (status ${x.awardResultPresentation.status} -> ${y.awardResultPresentation.status}, `
          + `eligibility rule ${x.awardResultPresentation.eligibilityRule} -> ${y.awardResultPresentation.eligibilityRule})`);
      }
      if (canon(x.findingCounts) !== canon(y.findingCounts)) {
        add(c, 'FINDINGS_CHANGED', 'fail', subject, 'finding counts by code changed');
      }
      if (x.outcome === y.outcome && (x.outcome === 'discrepancies' || x.outcome === 'refused')) {
        add(c, `PREEXISTING_${x.outcome.toUpperCase()}`, 'info', subject, `outcome ${x.outcome} in both; listed for owner reconciliation`);
      }
    }
    for (const season of [...a.bySeason.keys()].sort((x, y) => x - y)) {
      if (!b.bySeason.has(season)) {
        add(c, 'SEASON_ADDED', 'info', `season ${season}`, `only in the after reports (${(a.bySeason.get(season) as BrownlowReconciliationReport).outcome})`);
      }
    }
  }
  return finish('brownlow', { before: b.labels.length ? b.labels : null, after: a.labels.length ? a.labels : null }, c, counts);
}

/* ------------------------------------------------------------------ *
 * 5. coverage (and the coverage-registry export format)
 * ------------------------------------------------------------------ */

export const COVERAGE_EXPORT_FORMAT = 'afldb.v2.coverage-registry-export';
export const COVERAGE_EXPORT_FORMAT_VERSION = 1;

export interface CoverageExportCell {
  readonly season: number;
  readonly family: CoverageFamily;
  readonly status: CoverageStatus;
}

export interface CoverageRegistryExport {
  readonly format: typeof COVERAGE_EXPORT_FORMAT;
  readonly formatVersion: typeof COVERAGE_EXPORT_FORMAT_VERSION;
  readonly producedAt: string;
  /** Validation problems of the registry and its evidence; empty when the registry is sound. */
  readonly registryProblems: readonly string[];
  /** Every (season, family) the registry covers, sorted by season then family. */
  readonly cells: readonly CoverageExportCell[];
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const isIsoInstant = (value: unknown): value is string =>
  typeof value === 'string' && ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value));

/**
 * Pure. Builds the coverage-registry export: the registry validated against the season registry
 * and its evidence files (via `readFile`, which returns a file's text or null), and one cell per
 * covered (season, family). Throws only when the season registry itself is malformed.
 */
export function buildCoverageRegistryExport(input: {
  readonly producedAt: string;
  readonly registry: readonly CoverageEntry[];
  readonly seasons: SeasonRegistry;
  readonly readFile: (path: string) => string | null;
}): CoverageRegistryExport {
  if (!isIsoInstant(input.producedAt)) throw new RangeError('coverage export: producedAt must be an ISO-8601 UTC instant');
  const registryProblems = [
    ...validateCoverageRegistry(input.registry, input.seasons),
    ...checkCoverageEvidence(input.registry, input.readFile),
  ];
  const cells: CoverageExportCell[] = [];
  for (let season = input.seasons.first_season; season <= input.seasons.last_season; season += 1) {
    for (const family of COVERAGE_FAMILIES) {
      const entry = coverageFor(input.registry, season, family);
      if (entry !== null) cells.push({ season, family, status: entry.status });
    }
  }
  cells.sort((x, y) => x.season - y.season || codeUnitCompare(x.family, y.family));
  return { format: COVERAGE_EXPORT_FORMAT, formatVersion: COVERAGE_EXPORT_FORMAT_VERSION, producedAt: input.producedAt, registryProblems, cells };
}

export function serialiseCoverageRegistryExport(value: CoverageRegistryExport): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Every problem found in `value`; empty means a valid coverage-registry export of this version. */
export function validateCoverageRegistryExport(value: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(value)) return ['export must be an object.'];
  for (const key of ['format', 'formatVersion', 'producedAt', 'registryProblems', 'cells']) {
    if (!(key in value)) problems.push(`export.${key} is required.`);
  }
  if ('format' in value && value.format !== COVERAGE_EXPORT_FORMAT) problems.push(`export.format must be '${COVERAGE_EXPORT_FORMAT}'.`);
  if ('formatVersion' in value && value.formatVersion !== COVERAGE_EXPORT_FORMAT_VERSION) {
    problems.push(`export.formatVersion must be ${COVERAGE_EXPORT_FORMAT_VERSION}.`);
  }
  if ('producedAt' in value && !isIsoInstant(value.producedAt)) problems.push('export.producedAt must be an ISO-8601 UTC instant.');
  if ('registryProblems' in value
    && !(Array.isArray(value.registryProblems) && value.registryProblems.every((p) => typeof p === 'string'))) {
    problems.push('export.registryProblems must be an array of strings.');
  }
  if ('cells' in value) {
    if (!Array.isArray(value.cells)) problems.push('export.cells must be an array.');
    else {
      let previous: string | null = null;
      for (let i = 0; i < value.cells.length; i += 1) {
        const cell: unknown = value.cells[i];
        const path = `export.cells[${i}]`;
        if (!isRecord(cell) || !Number.isInteger(cell.season)
          || !(COVERAGE_FAMILIES as readonly unknown[]).includes(cell.family)
          || !(COVERAGE_STATUSES as readonly unknown[]).includes(cell.status)) {
          problems.push(`${path} must be { season: integer, family: a coverage family, status: a coverage status }.`);
          break;
        }
        const key = `${String(cell.season).padStart(6, '0')}:${String(cell.family)}`;
        if (previous !== null && codeUnitCompare(previous, key) >= 0) {
          problems.push(`${path} is not strictly sorted by season then family (or is a duplicate).`);
          break;
        }
        previous = key;
      }
    }
  }
  return problems;
}

export function parseCoverageRegistryExport(text: string, label: string): CoverageRegistryExport {
  const value = parseJson(text, label);
  const problems = validateCoverageRegistryExport(value);
  if (problems.length > 0) throw new InputProblem(`${label}: ${summariseProblems(problems)}`);
  return value as CoverageRegistryExport;
}

function checkCoverage(before: ShadowParityInput, after: ShadowParityInput): ShadowParityCheck {
  const c: Collector = { findings: [] };
  const b = load<CoverageRegistryExport>(c, 'before', 'coverage registry export', before, parseCoverageRegistryExport);
  const a = load<CoverageRegistryExport>(c, 'after', 'coverage registry export', after, parseCoverageRegistryExport);
  const counts: Record<string, number> = { cellsAfter: 0, cellsBefore: 0, cellsChanged: 0 };
  if (b.ok && a.ok) {
    counts.cellsBefore = b.value.cells.length;
    counts.cellsAfter = a.value.cells.length;
    for (const [slot, side] of [['before', b.value], ['after', a.value]] as const) {
      if (side.registryProblems.length > 0) {
        add(c, 'COVERAGE_REGISTRY_INVALID', 'fail', slot, safeText(`${side.registryProblems.length} registry problem(s); first: ${side.registryProblems[0]}`));
      }
    }
    const key = (cell: CoverageExportCell): string => `${cell.season} ${cell.family}`;
    const beforeMap = new Map(b.value.cells.map((cell) => [key(cell), cell]));
    const afterMap = new Map(a.value.cells.map((cell) => [key(cell), cell]));
    for (const [name, cell] of beforeMap) {
      const other = afterMap.get(name);
      if (other === undefined) add(c, 'COVERAGE_CELL_MISSING', 'fail', name, 'covered before, absent after');
      else if (other.status !== cell.status) {
        counts.cellsChanged += 1;
        add(c, 'COVERAGE_CHANGED', 'fail', name, `${cell.status} -> ${other.status}`);
      }
    }
    for (const name of afterMap.keys()) {
      if (!beforeMap.has(name)) add(c, 'COVERAGE_CELL_MISSING', 'fail', name, 'covered after, absent before');
    }
  }
  return finish('coverage', { before: labelOrNull(b, before), after: labelOrNull(a, after) }, c, counts);
}

/* ------------------------------------------------------------------ *
 * The report
 * ------------------------------------------------------------------ */

export function shadowParityVerdict(checks: readonly Pick<ShadowParityCheck, 'status'>[]): ShadowParityVerdict {
  if (checks.some((check) => check.status === 'fail')) return 'FAIL';
  if (checks.some((check) => check.status === 'incomplete')) return 'INCOMPLETE';
  return 'PASS';
}

/** Process exit code for a verdict: 0 PASS, 1 FAIL, 2 INCOMPLETE (3 is reserved for tool errors). */
export const shadowParityExitCode = (verdict: ShadowParityVerdict): 0 | 1 | 2 =>
  (verdict === 'PASS' ? 0 : verdict === 'FAIL' ? 1 : 2);

/** Pure and deterministic: the same inputs and `generatedAt` yield a deep-equal report. */
export function buildShadowParityReport(inputs: ShadowParityInputs, generatedAt: string): ShadowParityReport {
  if (!isIsoInstant(generatedAt)) throw new RangeError('shadow parity: generatedAt must be an ISO-8601 UTC instant');
  const checks: ShadowParityCheck[] = [
    checkHistoricalManifest(inputs.manifest.before, inputs.manifest.after),
    checkTableRowCounts(inputs.rowCounts.before, inputs.rowCounts.after),
    checkColeman(inputs.coleman.before, inputs.coleman.after),
    checkBrownlow(inputs.brownlow.before, inputs.brownlow.after),
    checkCoverage(inputs.coverage.before, inputs.coverage.after),
  ];
  return {
    format: SHADOW_PARITY_REPORT_FORMAT,
    formatVersion: SHADOW_PARITY_REPORT_VERSION,
    policyVersion: SHADOW_PARITY_POLICY_VERSION,
    generatedAt,
    verdict: shadowParityVerdict(checks),
    checks,
    summary: {
      pass: checks.filter((check) => check.status === 'pass').length,
      fail: checks.filter((check) => check.status === 'fail').length,
      incomplete: checks.filter((check) => check.status === 'incomplete').length,
    },
  };
}

/** Two-space indent JSON with one trailing newline. Byte-identical for equal reports. */
export function serialiseShadowParityReport(report: ShadowParityReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** Every problem found in `value`; an empty array means it is a valid report of this format version. */
export function validateShadowParityReport(value: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(value)) return ['report must be an object.'];
  for (const key of ['format', 'formatVersion', 'policyVersion', 'generatedAt', 'verdict', 'checks', 'summary']) {
    if (!(key in value)) problems.push(`report.${key} is required.`);
  }
  if ('format' in value && value.format !== SHADOW_PARITY_REPORT_FORMAT) problems.push(`report.format must be '${SHADOW_PARITY_REPORT_FORMAT}'.`);
  if ('formatVersion' in value && value.formatVersion !== SHADOW_PARITY_REPORT_VERSION) {
    problems.push(`report.formatVersion must be ${SHADOW_PARITY_REPORT_VERSION}.`);
  }
  if ('policyVersion' in value && value.policyVersion !== SHADOW_PARITY_POLICY_VERSION) {
    problems.push(`report.policyVersion must be '${SHADOW_PARITY_POLICY_VERSION}'.`);
  }
  if ('generatedAt' in value && !isIsoInstant(value.generatedAt)) problems.push('report.generatedAt must be an ISO-8601 UTC instant.');
  const verdictValid = 'verdict' in value && (SHADOW_PARITY_VERDICTS as readonly unknown[]).includes(value.verdict);
  if ('verdict' in value && !verdictValid) problems.push(`report.verdict must be one of ${SHADOW_PARITY_VERDICTS.join(', ')}.`);

  const statuses: ShadowParityStatus[] = [];
  let checksOk = true;
  if ('checks' in value) {
    if (!Array.isArray(value.checks)) {
      problems.push('report.checks must be an array.');
      checksOk = false;
    } else {
      if (value.checks.length !== SHADOW_PARITY_CHECK_IDS.length) {
        problems.push(`report.checks must list exactly the ${SHADOW_PARITY_CHECK_IDS.length} required checks in order.`);
        checksOk = false;
      }
      value.checks.forEach((raw: unknown, i: number) => {
        const path = `report.checks[${i}]`;
        if (!isRecord(raw)) {
          problems.push(`${path} must be an object.`);
          checksOk = false;
          return;
        }
        if (raw.id !== SHADOW_PARITY_CHECK_IDS[i]) {
          problems.push(`${path}.id must be '${SHADOW_PARITY_CHECK_IDS[i] ?? '(none)'}'.`);
          checksOk = false;
        }
        if (raw.required !== true) problems.push(`${path}.required must be true.`);
        if (typeof raw.thresholds !== 'string' || raw.thresholds === '') problems.push(`${path}.thresholds must be a non-empty string.`);
        const inputOk = (v: unknown): boolean =>
          v === null || typeof v === 'string' || (Array.isArray(v) && v.every((s) => typeof s === 'string'));
        if (!isRecord(raw.inputs) || !inputOk(raw.inputs.before) || !inputOk(raw.inputs.after)) {
          problems.push(`${path}.inputs must be { before, after } of a label, a list of labels or null.`);
        }
        const status = raw.status;
        if (!(SHADOW_PARITY_STATUSES as readonly unknown[]).includes(status)) {
          problems.push(`${path}.status must be one of ${SHADOW_PARITY_STATUSES.join(', ')}.`);
          checksOk = false;
          return;
        }
        statuses.push(status as ShadowParityStatus);
        if (!Array.isArray(raw.findings)) {
          problems.push(`${path}.findings must be an array.`);
          checksOk = false;
          return;
        }
        let fails = 0;
        let infos = 0;
        let inputFindings = 0;
        let otherFails = 0;
        raw.findings.forEach((f: unknown, j: number) => {
          if (!isRecord(f) || typeof f.code !== 'string' || f.code === '' || typeof f.subject !== 'string'
            || typeof f.detail !== 'string' || (f.severity !== 'fail' && f.severity !== 'info')) {
            problems.push(`${path}.findings[${j}] must be { code, severity: 'fail' | 'info', subject, detail }.`);
            return;
          }
          if (f.severity === 'fail') fails += 1;
          else infos += 1;
          if (isInputCode(f.code)) inputFindings += 1;
          else if (f.severity === 'fail') otherFails += 1;
        });
        if (!isRecord(raw.counts) || !Object.values(raw.counts).every(isCount)) {
          problems.push(`${path}.counts must map names to non-negative integers.`);
        } else if (raw.counts.fail !== fails || raw.counts.info !== infos) {
          problems.push(`${path}.counts.fail and counts.info must match the findings.`);
        }
        const expected: ShadowParityStatus = otherFails > 0 ? 'fail' : inputFindings > 0 ? 'incomplete' : 'pass';
        if (status !== expected) problems.push(`${path}.status is '${String(status)}' but its findings imply '${expected}'.`);
      });
    }
  }
  if (checksOk && verdictValid && statuses.length > 0 && value.verdict !== shadowParityVerdict(statuses.map((status) => ({ status })))) {
    problems.push('report.verdict does not follow from the check statuses (fail beats incomplete beats pass).');
  }
  if ('summary' in value) {
    const summary = value.summary;
    if (!isRecord(summary) || !isCount(summary.pass) || !isCount(summary.fail) || !isCount(summary.incomplete)) {
      problems.push('report.summary must be { pass, fail, incomplete } of non-negative integers.');
    } else if (checksOk && (summary.pass !== statuses.filter((s) => s === 'pass').length
      || summary.fail !== statuses.filter((s) => s === 'fail').length
      || summary.incomplete !== statuses.filter((s) => s === 'incomplete').length)) {
      problems.push('report.summary does not match the check statuses.');
    }
  }
  return problems;
}

/** Human summary lines for a (valid) report. */
export function renderShadowParitySummary(report: ShadowParityReport): string[] {
  const label = (v: string | readonly string[] | null): string => (v === null ? '(not supplied)' : typeof v === 'string' ? v : v.join(', '));
  const lines = [
    `AFLDB V2 shadow parity (policy ${report.policyVersion}) generated ${report.generatedAt}`,
    `VERDICT: ${report.verdict}  (checks: ${report.summary.pass} pass, ${report.summary.fail} fail, ${report.summary.incomplete} incomplete)`,
  ];
  for (const check of report.checks) {
    lines.push(`${check.status.toUpperCase().padEnd(10)} ${check.id}  [fail ${check.counts.fail}, info ${check.counts.info}]`);
    lines.push(`           before: ${label(check.inputs.before)}`);
    lines.push(`           after : ${label(check.inputs.after)}`);
    for (const f of check.findings) {
      lines.push(`           ${f.severity.toUpperCase().padEnd(5)} ${f.code} ${f.subject}: ${f.detail}`);
    }
  }
  return lines;
}
