/**
 * AFLDB V2 Stage 4 — the Coleman comparison report (docs/v2/plan.md §3 D6; ADR 0006).
 *
 * Compares what the pure derivation (./coleman) says each season's winners are with the Coleman
 * `award_winners` rows STORED in the database, and emits one machine-readable JSON document. The
 * report is EVIDENCE: building one decides nothing and writes nothing. It is the review step that
 * precedes an explicit, audited publication.
 *
 * Per season, exactly one category:
 *  - `agree`          the derivation succeeded and the stored ACTIVE winners are exactly the derived winners;
 *  - `disagree`       the derivation succeeded and differs: `missing` (derived winners with no stored
 *                     active row), `extra` (stored active rows that match no derived winner) and/or
 *                     `duplicates` (a derived winner matched by more than one stored active row);
 *  - `not_derivable`  the derivation refused (`refusal.code`); stored rows are listed, not judged.
 *
 * Matching: a stored row matches a derived winner when its `sourceRecordId` equals the winner's
 * durable key (`coleman:<season>:<profile path>`) OR, failing that, when its `playerId` equals the
 * winner's player id. The key is the primary, rebuild-stable identity; the player id fallback lets
 * a legacy-keyed row (`coleman:1982:<numeric>`, source draftguru) for the right player count as
 * agreeing on WHO won, which is the question this report answers. Provenance differences are
 * visible in the per-row `sourceKey` / `sourceRecordId`.
 *
 * Stored rows with a status other than 'active' (today: 'void', recorded-in-error rows that are
 * excluded from every public projection) take no part in the comparison. They are never silently
 * dropped: each is listed under `ignored` with its status so a reviewer can see it.
 *
 * Pure: no database, no IO, no clock. `generatedAt` is supplied by the caller.
 */
import { sortKeysDeep, type ColemanDerivationOutcome, type ColemanId } from './coleman';

export const COLEMAN_COMPARISON_REPORT_FORMAT = 'afldb.v2.coleman-comparison-report';
export const COLEMAN_COMPARISON_REPORT_VERSION = 1;

export const COLEMAN_COMPARISON_CATEGORIES = ['agree', 'disagree', 'not_derivable'] as const;
export type ColemanComparisonCategory = (typeof COLEMAN_COMPARISON_CATEGORIES)[number];

/** A stored Coleman `award_winners` row, as the caller read it. */
export interface ColemanStoredWinner {
  readonly season: number;
  /** award_winners.player_id; null for an unlinked row. int8/int ids may arrive as strings. */
  readonly playerId: ColemanId | null;
  readonly sourceKey: string | null;
  readonly sourceRecordId: string | null;
  /** award_winners.status: 'active' | 'void'. Only 'active' rows are compared. */
  readonly status: string;
}

export interface ColemanComparisonInput {
  /** Caller-supplied ISO-8601 UTC instant. Never a clock read. */
  readonly generatedAt: string;
  /** One derivation outcome per season being compared (success or refusal). Seasons must be unique. */
  readonly outcomes: readonly ColemanDerivationOutcome[];
  /** Every stored Coleman row the caller holds, for any season. */
  readonly stored: readonly ColemanStoredWinner[];
}

export interface ColemanReportDerivedWinner {
  playerId: string;
  profilePath: string;
  goals: number;
  key: string;
}

export interface ColemanReportStoredRow {
  playerId: string | null;
  sourceKey: string | null;
  sourceRecordId: string | null;
  status: string;
}

export interface ColemanComparisonSeason {
  season: number;
  category: ColemanComparisonCategory;
  methodVersion: number;
  derivationVersion: string;
  /** The derivation's input checksum; null when the derivation refused. */
  inputChecksum: string | null;
  derivedWinners: ColemanReportDerivedWinner[];
  /** Stored ACTIVE rows for the season. */
  stored: ColemanReportStoredRow[];
  /** Derived winners with no stored active row (disagree only). */
  missing: ColemanReportDerivedWinner[];
  /** Stored active rows matching no derived winner (disagree only). */
  extra: ColemanReportStoredRow[];
  /** Derived winners matched by more than one stored active row (disagree only). */
  duplicates: { winner: ColemanReportDerivedWinner; rows: ColemanReportStoredRow[] }[];
  /** Stored rows whose status is not 'active': listed, never compared. */
  ignored: ColemanReportStoredRow[];
  /** Present iff category is not_derivable. */
  refusal: { code: string; message: string } | null;
}

export interface ColemanComparisonReport {
  format: typeof COLEMAN_COMPARISON_REPORT_FORMAT;
  formatVersion: typeof COLEMAN_COMPARISON_REPORT_VERSION;
  generatedAt: string;
  summary: { seasons: number; agree: number; disagree: number; notDerivable: number };
  /** Sorted by season ascending, unique. */
  seasons: ColemanComparisonSeason[];
  /** Seasons that have stored rows but no derivation outcome in this comparison, sorted. */
  storedSeasonsWithoutOutcome: number[];
}

export const COLEMAN_COMPARISON_REQUIRED = {
  report: ['format', 'formatVersion', 'generatedAt', 'summary', 'seasons', 'storedSeasonsWithoutOutcome'],
  summary: ['seasons', 'agree', 'disagree', 'notDerivable'],
  season: ['season', 'category', 'methodVersion', 'derivationVersion', 'inputChecksum', 'derivedWinners',
    'stored', 'missing', 'extra', 'duplicates', 'ignored', 'refusal'],
} as const;

/* ------------------------------------------------------------------ *
 * Build
 * ------------------------------------------------------------------ */

function codeUnitCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareStoredRows(a: ColemanReportStoredRow, b: ColemanReportStoredRow): number {
  return codeUnitCompare(a.sourceRecordId ?? '', b.sourceRecordId ?? '')
    || codeUnitCompare(a.playerId ?? '', b.playerId ?? '')
    || codeUnitCompare(a.sourceKey ?? '', b.sourceKey ?? '')
    || codeUnitCompare(a.status, b.status);
}

function toStoredRow(row: ColemanStoredWinner): ColemanReportStoredRow {
  return {
    playerId: row.playerId === null ? null : String(row.playerId),
    sourceKey: row.sourceKey,
    sourceRecordId: row.sourceRecordId,
    status: row.status,
  };
}

/** Build the report. Pure and deterministic: the same input yields a deep-equal report. */
export function buildColemanComparisonReport(input: ColemanComparisonInput): ColemanComparisonReport {
  const seen = new Set<number>();
  const storedBySeason = new Map<number, ColemanReportStoredRow[]>();
  for (const row of input.stored) {
    const list = storedBySeason.get(row.season) ?? [];
    list.push(toStoredRow(row));
    storedBySeason.set(row.season, list);
  }

  const seasons: ColemanComparisonSeason[] = input.outcomes.map((outcome) => {
    const season = outcome.ok ? outcome.result.season : outcome.refusal.season;
    if (seen.has(season)) throw new RangeError(`Coleman comparison: season ${season} has more than one derivation outcome`);
    seen.add(season);
    const rows = storedBySeason.get(season) ?? [];
    const active = rows.filter((row) => row.status === 'active').sort(compareStoredRows);
    const ignored = rows.filter((row) => row.status !== 'active').sort(compareStoredRows);

    if (!outcome.ok) {
      return {
        season,
        category: 'not_derivable',
        methodVersion: outcome.refusal.methodVersion,
        derivationVersion: outcome.refusal.derivationVersion,
        inputChecksum: null,
        derivedWinners: [],
        stored: active,
        missing: [],
        extra: [],
        duplicates: [],
        ignored,
        refusal: { code: outcome.refusal.code, message: outcome.refusal.message },
      };
    }

    const result = outcome.result;
    const derivedWinners = result.winners
      .map((w) => ({ playerId: w.playerId, profilePath: w.profilePath, goals: w.goals, key: w.key }))
      .sort((a, b) => codeUnitCompare(a.key, b.key));
    const matchedBy = new Map<string, ColemanReportStoredRow[]>(derivedWinners.map((w) => [w.key, []]));
    const extra: ColemanReportStoredRow[] = [];
    for (const row of active) {
      const winner = derivedWinners.find((w) => w.key === row.sourceRecordId)
        ?? derivedWinners.find((w) => row.playerId !== null && w.playerId === row.playerId);
      if (winner) (matchedBy.get(winner.key) as ColemanReportStoredRow[]).push(row);
      else extra.push(row);
    }
    const missing = derivedWinners.filter((w) => (matchedBy.get(w.key) as ColemanReportStoredRow[]).length === 0);
    const duplicates = derivedWinners
      .filter((w) => (matchedBy.get(w.key) as ColemanReportStoredRow[]).length > 1)
      .map((winner) => ({ winner, rows: matchedBy.get(winner.key) as ColemanReportStoredRow[] }));
    const agree = missing.length === 0 && extra.length === 0 && duplicates.length === 0;
    return {
      season,
      category: agree ? 'agree' : 'disagree',
      methodVersion: result.methodVersion,
      derivationVersion: result.derivationVersion,
      inputChecksum: result.inputChecksum,
      derivedWinners,
      stored: active,
      missing,
      extra,
      duplicates,
      ignored,
      refusal: null,
    };
  });
  seasons.sort((a, b) => a.season - b.season);

  return {
    format: COLEMAN_COMPARISON_REPORT_FORMAT,
    formatVersion: COLEMAN_COMPARISON_REPORT_VERSION,
    generatedAt: input.generatedAt,
    summary: {
      seasons: seasons.length,
      agree: seasons.filter((s) => s.category === 'agree').length,
      disagree: seasons.filter((s) => s.category === 'disagree').length,
      notDerivable: seasons.filter((s) => s.category === 'not_derivable').length,
    },
    seasons,
    storedSeasonsWithoutOutcome: [...storedBySeason.keys()].filter((s) => !seen.has(s)).sort((a, b) => a - b),
  };
}

/** Sorted-key JSON, two-space indent, one trailing newline. Byte-identical for equal reports. */
export function serialiseColemanComparisonReport(report: ColemanComparisonReport): string {
  return `${JSON.stringify(sortKeysDeep(report), null, 2)}\n`;
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

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** Every problem found in `value`; an empty array means it is a valid report of this format version. */
export function validateColemanComparisonReport(value: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(value)) return ['report must be an object.'];
  for (const key of COLEMAN_COMPARISON_REQUIRED.report) {
    if (!(key in value)) problems.push(`report.${key} is required.`);
  }
  if ('format' in value && value.format !== COLEMAN_COMPARISON_REPORT_FORMAT) {
    problems.push(`report.format must be '${COLEMAN_COMPARISON_REPORT_FORMAT}'.`);
  }
  if ('formatVersion' in value && value.formatVersion !== COLEMAN_COMPARISON_REPORT_VERSION) {
    problems.push(`report.formatVersion must be ${COLEMAN_COMPARISON_REPORT_VERSION}.`);
  }
  if ('generatedAt' in value
    && !(typeof value.generatedAt === 'string' && ISO_INSTANT.test(value.generatedAt) && !Number.isNaN(Date.parse(value.generatedAt)))) {
    problems.push('report.generatedAt must be an ISO-8601 UTC instant (YYYY-MM-DDTHH:MM:SS[.fff]Z).');
  }
  if ('storedSeasonsWithoutOutcome' in value) {
    const list = value.storedSeasonsWithoutOutcome;
    if (!Array.isArray(list) || !list.every((s) => typeof s === 'number' && Number.isInteger(s))
      || list.some((s, i) => i > 0 && list[i - 1] >= s)) {
      problems.push('report.storedSeasonsWithoutOutcome must be a strictly ascending array of integers.');
    }
  }

  const counts = { agree: 0, disagree: 0, notDerivable: 0 };
  let seasonsOk = true;
  if ('seasons' in value) {
    const seasons = value.seasons;
    if (!Array.isArray(seasons)) {
      problems.push('report.seasons must be an array.');
      seasonsOk = false;
    } else {
      let previous: number | null = null;
      seasons.forEach((entry, i) => {
        const path = `report.seasons[${i}]`;
        if (!isRecord(entry)) {
          problems.push(`${path} must be an object.`);
          seasonsOk = false;
          return;
        }
        for (const key of COLEMAN_COMPARISON_REQUIRED.season) {
          if (!(key in entry)) {
            problems.push(`${path}.${key} is required.`);
            seasonsOk = false;
          }
        }
        if ('season' in entry) {
          if (!(typeof entry.season === 'number' && Number.isInteger(entry.season))) {
            problems.push(`${path}.season must be an integer.`);
            seasonsOk = false;
          } else {
            if (previous !== null && previous >= entry.season) {
              problems.push(`${path}.season must be strictly ascending (no duplicate seasons).`);
            }
            previous = entry.season;
          }
        }
        if ('methodVersion' in entry && !(isCount(entry.methodVersion) && entry.methodVersion >= 1)) {
          problems.push(`${path}.methodVersion must be a positive integer.`);
        }
        if ('derivationVersion' in entry && !(typeof entry.derivationVersion === 'string' && entry.derivationVersion !== '')) {
          problems.push(`${path}.derivationVersion must be a non-empty string.`);
        }
        for (const key of ['derivedWinners', 'stored', 'missing', 'extra', 'duplicates', 'ignored'] as const) {
          if (key in entry && !Array.isArray(entry[key])) {
            problems.push(`${path}.${key} must be an array.`);
            seasonsOk = false;
          }
        }
        const category = entry.category;
        if ('category' in entry && !(COLEMAN_COMPARISON_CATEGORIES as readonly unknown[]).includes(category)) {
          problems.push(`${path}.category must be one of ${COLEMAN_COMPARISON_CATEGORIES.join(', ')}.`);
          seasonsOk = false;
          return;
        }
        if (!('category' in entry) || !seasonsOk) return;
        const len = (key: string): number => (Array.isArray(entry[key]) ? (entry[key] as unknown[]).length : 0);
        const checksum = entry.inputChecksum;
        if (category === 'not_derivable') {
          counts.notDerivable += 1;
          if (!(isRecord(entry.refusal) && typeof entry.refusal.code === 'string' && typeof entry.refusal.message === 'string')) {
            problems.push(`${path}.refusal must be { code, message } for not_derivable.`);
          }
          if (checksum !== null) problems.push(`${path}.inputChecksum must be null for not_derivable.`);
          if (len('derivedWinners') + len('missing') + len('extra') + len('duplicates') > 0) {
            problems.push(`${path}: not_derivable carries no derived winners and no differences.`);
          }
        } else {
          if (category === 'agree') counts.agree += 1;
          else counts.disagree += 1;
          if (entry.refusal !== null) problems.push(`${path}.refusal must be null unless not_derivable.`);
          if (!(typeof checksum === 'string' && SHA256.test(checksum))) {
            problems.push(`${path}.inputChecksum must be 64 lower-case hex characters.`);
          }
          const differences = len('missing') + len('extra') + len('duplicates');
          if (category === 'agree' && differences > 0) problems.push(`${path}: agree carries no differences.`);
          if (category === 'disagree' && differences === 0) problems.push(`${path}: disagree must carry at least one difference.`);
        }
      });
    }
  }

  if ('summary' in value) {
    const summary = value.summary;
    if (!isRecord(summary)) problems.push('report.summary must be an object.');
    else {
      for (const key of COLEMAN_COMPARISON_REQUIRED.summary) {
        if (!(key in summary)) problems.push(`report.summary.${key} is required.`);
        else if (!isCount(summary[key])) problems.push(`report.summary.${key} must be a non-negative integer.`);
      }
      if (seasonsOk && Array.isArray(value.seasons)) {
        if (summary.seasons !== value.seasons.length) problems.push('report.summary.seasons does not match report.seasons.');
        if (summary.agree !== counts.agree || summary.disagree !== counts.disagree || summary.notDerivable !== counts.notDerivable) {
          problems.push('report.summary category counts do not match report.seasons.');
        }
      }
    }
  }
  return problems;
}
