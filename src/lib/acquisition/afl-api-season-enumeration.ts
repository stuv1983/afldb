/**
 * AFLDB-ISSUE-231 — the `afl_api` season enumeration: the one representation
 * of "which matches did the AFL season feed publish, and is that list known to
 * be complete".
 *
 * WHERE IT COMES FROM. Every acquisition (`acquire-afl-api.ts`, both the full
 * and the `--fixtures-only` mode) already writes the season matches response
 * verbatim as `00-season-matches.json` and hash-binds it in the manifest. This
 * module reads those retained bytes. It makes no request and opens no
 * database, and it reuses `parseAflApiSeasonMatchesEnvelope()` for the entries
 * rather than growing a second season-feed parser.
 *
 * WHAT IT IS NOT. It is not season discovery (AFLDB-ISSUE-233). Discovery
 * answers "does AFL publish a season we have not registered"; this answers
 * "for a season we already registered, did this response list every match".
 * A discovered season proves nothing about the completeness of any response,
 * and a complete response proves nothing about which seasons exist, so the two
 * are kept apart.
 *
 * It is also not the acquisition's SELECTION. A nightly acquisition fetches
 * stats and rosters only for `CONCLUDED` matches, so the settle bundle carries
 * a subset of the feed. Absence and retirement must be judged against the
 * whole feed, never against that subset: a scheduled match the run did not
 * select is still published. `providerMatchIds` is therefore always the full
 * feed.
 *
 * COMPLETENESS IS PROVED, NEVER ASSUMED (§13.5, §14). A response is complete
 * only when every check below passes. Any failure makes it incomplete, and an
 * incomplete enumeration authorises nothing: no retired-identity search, no
 * absence. The worst a wrong reading can do is fall back to today's behaviour.
 *
 *   - `meta.pagination.numEntries` is a non-negative integer. MEASURED
 *     2026-09-26 from authentic retained bytes
 *     (`tests/fixtures/afl_api/seasons/00-season-matches-2026.raw.json`,
 *     original response sha256 9c358984…75ee; the fixture is a sanitised
 *     derivative, sha256 4f8235e0…babb): the envelope is
 *     `{meta{code, pagination{page, numPages, pageSize, numEntries}}, matches[]}`.
 *     ISSUE-228 §2.1 wrote it as `{meta, pagination{numEntries}, matches[]}`,
 *     which placed `pagination` at the top level; the bytes say otherwise;
 *   - it equals the number of entries actually returned;
 *   - `meta.pagination` reports page 0 of exactly 1, and the number returned
 *     is below the requested page size, so no page was cut off;
 *   - the feed is not empty (an empty feed never proves a season has no
 *     matches);
 *   - every entry names the expected season (`compSeason.providerId`);
 *   - no provider id appears twice.
 *
 * STATUS IS OBSERVED, NEVER MAPPED. `statusCounts` records each `status`
 * string exactly as the provider sent it. Nothing here decides what a status
 * means. AFLDB-ISSUE-229's pre-match vocabulary must be measured from these
 * counts, and an unfamiliar value stays visible instead of being coerced.
 */
import { createHash } from 'node:crypto';

import { AFL_API_SEASON_PAGE_SIZE, parseAflApiSeasonMatchesEnvelope } from './afl-api-client';
import type { MatchRekeyScope } from './match-rekey';

/** The retained season matches response inside every acquired snapshot (§5.4). */
export const AFL_API_SEASON_FEED_FILE = '00-season-matches.json';

export type AflApiSeasonEnumerationGapReason =
  | 'season_feed_not_in_snapshot'
  | 'pagination_missing'
  | 'pagination_mismatch'
  | 'page_limit_reached'
  | 'empty_season_feed'
  | 'foreign_comp_season'
  | 'duplicate_provider_id';

export type AflApiSeasonEnumerationGap = {
  reason: AflApiSeasonEnumerationGapReason;
  detail: string;
};

export type AflApiSeasonEnumeration = {
  season: number;
  /** The match family's own spine scope, exactly as `buildAflApiSettleRecords()` writes it. */
  scopeKey: string;
  compSeasonProviderId: string;
  /** Every provider match id the feed published, in feed order. Never the run's selection. */
  providerMatchIds: readonly string[];
  /** Each `status` string verbatim, with how many entries carried it. */
  statusCounts: Readonly<Record<string, number>>;
  /** `meta.pagination.numEntries` as sent, or null when absent or not an integer. */
  numEntries: number | null;
  complete: boolean;
  /** Empty exactly when `complete`. */
  gaps: readonly AflApiSeasonEnumerationGap[];
  /**
   * sha256 of exactly the text assessed (UTF-8), or null when no feed was
   * retained. For bytes a manifest verified this equals the manifest's own
   * hash, so a finding that records it names the feed it was decided on
   * (AFLDB-ISSUE-231 D-231-3).
   */
  sourceSha256: string | null;
};

export function aflApiSeasonScopeKey(season: number): string {
  return `season=${season}`;
}

/**
 * The enumeration of a snapshot that retained no season feed. It lists
 * nothing and is incomplete, so it authorises nothing.
 */
export function missingAflApiSeasonEnumeration(
  season: number, compSeasonProviderId: string,
): AflApiSeasonEnumeration {
  return {
    season,
    scopeKey: aflApiSeasonScopeKey(season),
    compSeasonProviderId,
    providerMatchIds: [],
    statusCounts: {},
    numEntries: null,
    complete: false,
    sourceSha256: null,
    gaps: [{
      reason: 'season_feed_not_in_snapshot',
      detail: `The snapshot's manifest does not list ${AFL_API_SEASON_FEED_FILE}.`,
    }],
  };
}

function compSeasonProviderIdOf(entry: unknown): string | null {
  if (entry === null || typeof entry !== 'object') return null;
  const compSeason = (entry as Record<string, unknown>).compSeason;
  if (compSeason === null || typeof compSeason !== 'object') return null;
  const providerId = (compSeason as Record<string, unknown>).providerId;
  return typeof providerId === 'string' ? providerId : null;
}

function objectAt(value: unknown, key: string): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  const child = (value as Record<string, unknown>)[key];
  return child !== null && typeof child === 'object' && !Array.isArray(child)
    ? child as Record<string, unknown>
    : null;
}

function nonNegativeIntegerOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/** `meta.pagination`, exactly where the measured envelope carries it. */
function paginationOf(parsed: unknown): Record<string, unknown> | null {
  return objectAt(objectAt(parsed, 'meta'), 'pagination');
}

/**
 * Read one retained season matches response. A malformed envelope (not JSON,
 * no `matches` array, an entry with no provider id or status) throws, exactly
 * as it does at acquisition: bytes the manifest verified cannot be half-read.
 * Every other shortfall is reported as a gap, never thrown.
 */
export function assessAflApiSeasonEnumeration(
  bodyText: string,
  expected: { season: number; compSeasonProviderId: string },
): AflApiSeasonEnumeration {
  const summaries = parseAflApiSeasonMatchesEnvelope(bodyText);
  const parsed: unknown = JSON.parse(bodyText);
  const entries = (parsed as { matches: unknown[] }).matches;

  const gaps: AflApiSeasonEnumerationGap[] = [];
  const pagination = paginationOf(parsed);
  const numEntries = nonNegativeIntegerOrNull(pagination?.numEntries);
  if (numEntries === null) {
    gaps.push({
      reason: 'pagination_missing',
      detail: 'The response carries no integer meta.pagination.numEntries, so its length cannot be checked.',
    });
  } else if (numEntries !== summaries.length) {
    gaps.push({
      reason: 'pagination_mismatch',
      detail: `meta.pagination.numEntries is ${numEntries} but the response returned ${summaries.length} match(es).`,
    });
  }
  if (pagination !== null && (pagination.page !== 0 || pagination.numPages !== 1)) {
    gaps.push({
      reason: 'page_limit_reached',
      detail: `meta.pagination reports page ${String(pagination.page)} of ${String(pagination.numPages)}; `
        + 'a complete season is exactly page 0 of 1.',
    });
  }
  if (summaries.length >= AFL_API_SEASON_PAGE_SIZE) {
    gaps.push({
      reason: 'page_limit_reached',
      detail: `The response filled the ${AFL_API_SEASON_PAGE_SIZE}-entry page, so it may have been cut off.`,
    });
  }
  if (summaries.length === 0) {
    gaps.push({
      reason: 'empty_season_feed',
      detail: 'The response lists no matches. An empty feed never proves a season has none.',
    });
  }

  const foreign = entries
    .map((entry, index) => ({ index, providerId: compSeasonProviderIdOf(entry) }))
    .filter((entry) => entry.providerId !== expected.compSeasonProviderId);
  if (foreign.length > 0) {
    const first = foreign[0];
    gaps.push({
      reason: 'foreign_comp_season',
      detail: `${foreign.length} entr${foreign.length === 1 ? 'y does' : 'ies do'} not name `
        + `${expected.compSeasonProviderId} (first: entry ${first.index}, `
        + `compSeason.providerId ${first.providerId ?? 'absent'}).`,
    });
  }

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const statusCounts: Record<string, number> = {};
  for (const summary of summaries) {
    if (seen.has(summary.providerId)) duplicates.add(summary.providerId);
    seen.add(summary.providerId);
    statusCounts[summary.status] = (statusCounts[summary.status] ?? 0) + 1;
  }
  if (duplicates.size > 0) {
    gaps.push({
      reason: 'duplicate_provider_id',
      detail: `Listed more than once: ${[...duplicates].sort().join(', ')}.`,
    });
  }

  return {
    season: expected.season,
    scopeKey: aflApiSeasonScopeKey(expected.season),
    compSeasonProviderId: expected.compSeasonProviderId,
    providerMatchIds: summaries.map((summary) => summary.providerId),
    statusCounts,
    numEntries,
    complete: gaps.length === 0,
    gaps,
    sourceSha256: createHash('sha256').update(bodyText, 'utf8').digest('hex'),
  };
}

/**
 * The AFLDB-ISSUE-131 retirement proof this enumeration supports. Only a
 * complete enumeration names a scope, and the published ids are the whole
 * feed, so a match the run merely did not select is never read as retired.
 * An incomplete enumeration yields the scope that proves nothing, which is
 * the `NO_MATCH_REKEY_SCOPE` behaviour.
 */
export function aflApiMatchRekeyScope(enumeration: AflApiSeasonEnumeration): MatchRekeyScope {
  if (!enumeration.complete) return { completeScopeKeys: [], publishedRecordIds: [] };
  return {
    completeScopeKeys: [enumeration.scopeKey],
    publishedRecordIds: [...enumeration.providerMatchIds],
  };
}

/* ------------------------------------------------------------------ *
 * AFLDB-ISSUE-231 residual 2 — the absence sweep's decision, DB-free.
 * ------------------------------------------------------------------ */

/**
 * D-231-1 (operator, 2026-09-26): ANY record disappearing from an otherwise
 * complete season enumeration stops the settle. No positive tolerance, and
 * deliberately no flag or registry field that could declare one.
 */
export const AFL_API_ABSENCE_TOLERANCE = 0;

/** One `afl_api` `match` spine record in the enumeration's scope. */
export type AflApiAbsenceSpineRecord = {
  externalRecordId: string;
  absentSince: string | null;
};

export type AflApiAbsencePlan = {
  /** False exactly when the enumeration is incomplete: then every list is empty. */
  applicable: boolean;
  scopeKey: string;
  /** In scope, not in the complete feed, not yet stamped. The D-231-1 count. */
  newlyAbsent: readonly string[];
  /** In scope, not in the feed, already stamped by an earlier run. */
  stillAbsent: readonly string[];
  /** D-231-2: stamped, and listed again by the complete feed, whether or not
   * this run selected it. Presence in a complete feed is presence evidence. */
  reappeared: readonly string[];
  /** `newlyAbsent.length > AFL_API_ABSENCE_TOLERANCE`. */
  exceedsTolerance: boolean;
};

/**
 * Id-list semantics, never batch semantics. AFL Tables'
 * `markMissingObservationsAbsent()` stamps whatever this batch did not touch;
 * a nightly `afl_api` run touches only the CONCLUDED matches it selected, so
 * that rule would stamp every match it merely did not re-select. Here a
 * record is absent only when the WHOLE complete feed omits its provider id.
 *
 * The caller supplies the spine records of `(afl_api, match, scopeKey)` only.
 * This function decides; it writes nothing and throws nothing.
 */
export function planAflApiAbsenceSweep(
  enumeration: AflApiSeasonEnumeration,
  spineRecords: readonly AflApiAbsenceSpineRecord[],
): AflApiAbsencePlan {
  if (!enumeration.complete) {
    return {
      applicable: false, scopeKey: enumeration.scopeKey,
      newlyAbsent: [], stillAbsent: [], reappeared: [], exceedsTolerance: false,
    };
  }
  const listed = new Set(enumeration.providerMatchIds);
  const newlyAbsent: string[] = [];
  const stillAbsent: string[] = [];
  const reappeared: string[] = [];
  for (const record of spineRecords) {
    if (listed.has(record.externalRecordId)) {
      if (record.absentSince !== null) reappeared.push(record.externalRecordId);
    } else if (record.absentSince === null) {
      newlyAbsent.push(record.externalRecordId);
    } else {
      stillAbsent.push(record.externalRecordId);
    }
  }
  const sorted = (ids: string[]) => ids.sort((a, b) => a.localeCompare(b));
  return {
    applicable: true,
    scopeKey: enumeration.scopeKey,
    newlyAbsent: sorted(newlyAbsent),
    stillAbsent: sorted(stillAbsent),
    reappeared: sorted(reappeared),
    exceedsTolerance: newlyAbsent.length > AFL_API_ABSENCE_TOLERANCE,
  };
}

/** One operator line: the size, the verdict and the observed status vocabulary. */
export function describeAflApiSeasonEnumeration(enumeration: AflApiSeasonEnumeration): string {
  const statuses = Object.entries(enumeration.statusCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${status} ${count}`)
    .join(', ');
  const verdict = enumeration.complete
    ? 'complete'
    : `INCOMPLETE (${enumeration.gaps.map((gap) => gap.reason).join(', ')})`;
  return `Season feed ${enumeration.compSeasonProviderId}: ${enumeration.providerMatchIds.length} match(es), `
    + `${verdict}; statuses observed: ${statuses === '' ? 'none' : statuses}.`;
}
