/**
 * AFLDB V2 Stage 4 — the machine-readable Brownlow reconciliation report (docs/v2/plan.md §3 D7,
 * docs/v2/adr/0007-brownlow-reconciliation.md).
 *
 * One JSON document per season reconciled: what evidence was supplied, every typed finding, the
 * RAW VOTES section (what the sources said, per match and per player, plus each comparison's
 * state) and, kept strictly apart from it, the AWARD-RESULT PRESENTATION section (what, if
 * anything, may be stated as the season's leader(s)). Owner rule: "clear separation between raw
 * votes and award-result presentation".
 *
 * This is a SIBLING of the Stage 3 settle-run report (@afldb/acquisition reconciliation-report.ts):
 * same conventions (format id + version, caller-supplied `generatedAt`, sorted-key serialisation,
 * a hand-written validator, a JSON Schema), different subject. That report describes one settle
 * RUN; this one describes one SEASON's vote evidence, so its shape does not fit and is not reused.
 *
 * PURE: no database, no IO, no clock, no imports. The serialisation is byte-identical for equal
 * reports. The validator also checks the report's INTERNAL CONSISTENCY (outcome vs finding
 * severities, leaders vs status, sort order), not only its field types.
 */

export const BROWNLOW_RECONCILIATION_REPORT_FORMAT = 'afldb.v2.brownlow-reconciliation-report';
export const BROWNLOW_RECONCILIATION_REPORT_VERSION = 1;

export const BROWNLOW_SEASON_STATES = ['complete', 'in_progress'] as const;
export type BrownlowSeasonState = (typeof BROWNLOW_SEASON_STATES)[number];

/**
 * How ineligible vote-getters affect the leader determination.
 *   - `unrecorded` (default): no rule is applied; any ineligible vote-getter REFUSES the determination.
 *   - `stored_eligible_rank_one`: the convention measured on the stored AFL Tables artefact and
 *     reproduced by publication (src/lib/brownlow/entry.ts:664-679 and :796): ineligible players are
 *     excluded and the leaders are the eligible players with the highest total; tied eligible leaders
 *     are joint leaders. A caller must choose it explicitly; this module never assumes it.
 */
export const BROWNLOW_ELIGIBILITY_RULES = ['unrecorded', 'stored_eligible_rank_one'] as const;
export type BrownlowEligibilityRule = (typeof BROWNLOW_ELIGIBILITY_RULES)[number];

export const BROWNLOW_OUTCOMES = ['reconciled', 'discrepancies', 'refused'] as const;
export type BrownlowOutcome = (typeof BROWNLOW_OUTCOMES)[number];

export const BROWNLOW_EVIDENCE_BASES = ['api_round_votes', 'api_leaderboard', 'stored_totals'] as const;
export type BrownlowEvidenceBasis = (typeof BROWNLOW_EVIDENCE_BASES)[number];

export const BROWNLOW_COMPARISON_STATES = ['not_supplied', 'not_run', 'skipped_season_incomplete', 'compared'] as const;
export type BrownlowComparisonState = (typeof BROWNLOW_COMPARISON_STATES)[number];

export const BROWNLOW_AWARD_STATUSES = [
  'determined',
  'season_incomplete',
  'no_vote_evidence',
  'refused_whole_set',
  'refused_unreconciled_evidence',
  'refused_eligibility_rule_unrecorded',
] as const;
export type BrownlowAwardStatus = (typeof BROWNLOW_AWARD_STATUSES)[number];

export const BROWNLOW_FINDING_SEVERITIES = ['refusal', 'discrepancy', 'info', 'determination_refusal'] as const;
export type BrownlowFindingSeverity = (typeof BROWNLOW_FINDING_SEVERITIES)[number];

/** Every finding code and the severity it always carries. */
export const BROWNLOW_FINDING_CODES = {
  // Whole-set refusals: nothing is totalled, compared or determined.
  input_schema_invalid: 'refusal',
  unresolved_player_identity: 'refusal',
  unresolved_match_identity: 'refusal',
  // Vote-set structure.
  duplicate_match_vote_record: 'discrepancy',
  invalid_vote_value: 'discrepancy',
  duplicate_player_in_match: 'discrepancy',
  duplicate_vote_value_in_match: 'discrepancy',
  too_many_vote_getters_in_match: 'discrepancy',
  too_few_vote_getters_in_match: 'discrepancy',
  // Round / match / club consistency.
  match_not_in_context: 'discrepancy',
  match_wrong_season: 'discrepancy',
  match_is_final: 'discrepancy',
  round_mismatch: 'discrepancy',
  vote_club_not_in_match: 'discrepancy',
  match_without_votes: 'discrepancy',
  club_unverifiable: 'info',
  // Eligibility evidence.
  eligibility_flag_inconsistent: 'discrepancy',
  // API round votes versus the API leaderboard.
  duplicate_leaderboard_entry: 'discrepancy',
  leaderboard_total_mismatch: 'discrepancy',
  leaderboard_only_player: 'discrepancy',
  round_votes_only_player: 'discrepancy',
  // API versus the stored authoritative season totals.
  stored_total_mismatch: 'discrepancy',
  api_only_player: 'discrepancy',
  stored_only_player: 'discrepancy',
  // The stored totals against themselves (ranks and winner flags).
  stored_rank_inconsistent: 'discrepancy',
  stored_winner_flag_inconsistent: 'discrepancy',
  // The award-result determination only.
  eligibility_rule_unrecorded: 'determination_refusal',
} as const satisfies Record<string, BrownlowFindingSeverity>;
export type BrownlowFindingCode = keyof typeof BROWNLOW_FINDING_CODES;

export type BrownlowFindingDetail = Record<string, string | number | boolean | null>;

export interface BrownlowFinding {
  code: BrownlowFindingCode;
  severity: BrownlowFindingSeverity;
  providerMatchId: string | null;
  playerId: number | null;
  providerPlayerId: string | null;
  detail: BrownlowFindingDetail;
}

export interface BrownlowReportVote {
  providerPlayerId: string;
  providerTeamId: string;
  playerId: number | null;
  clubId: number | null;
  votes: number;
  eligible: boolean;
}

export interface BrownlowReportMatch {
  providerMatchId: string;
  matchId: number | null;
  apiRoundNumber: number;
  canonicalRoundNumber: number | null;
  votes: BrownlowReportVote[];
}

export interface BrownlowPlayerTotal {
  playerId: number;
  votes: number;
  /** Matches the player polled in; null when the basis is not round-level. */
  matchesPolled: number | null;
  eligible: boolean;
}

export interface BrownlowComparisonSummary {
  state: BrownlowComparisonState;
  compared: number;
  mismatches: number;
}

export interface BrownlowAwardLeader {
  playerId: number;
  votes: number;
}

export interface BrownlowReconciliationReport {
  format: typeof BROWNLOW_RECONCILIATION_REPORT_FORMAT;
  formatVersion: typeof BROWNLOW_RECONCILIATION_REPORT_VERSION;
  /** Caller-supplied ISO-8601 UTC instant. Never a clock read. */
  generatedAt: string;
  source: {
    sourceKey: 'afl_api';
    season: number;
    seasonState: BrownlowSeasonState;
    leaderboardStatus: string | null;
    evidence: {
      matchVoteRecords: number;
      leaderboardEntries: number | null;
      storedRows: number | null;
      contextMatches: number;
    };
  };
  outcome: BrownlowOutcome;
  findings: BrownlowFinding[];
  findingCounts: Record<string, number>;
  /** RAW VOTES: what the sources said. Never contains a winner or a leader of record. */
  rawVotes: {
    basis: BrownlowEvidenceBasis | null;
    matches: BrownlowReportMatch[];
    playerTotals: BrownlowPlayerTotal[];
    /** Highest raw totals over ALL vote-getters, ineligible included. Not an award result. */
    topVoteGetters: { playerId: number; votes: number; eligible: boolean }[];
    comparisons: {
      leaderboard: BrownlowComparisonSummary;
      stored: BrownlowComparisonSummary;
      storedInternal: BrownlowComparisonSummary;
    };
  };
  /** AWARD-RESULT PRESENTATION: what, if anything, may be stated as the season's leader(s). */
  awardResultPresentation: {
    status: BrownlowAwardStatus;
    refusalCode: string | null;
    seasonState: BrownlowSeasonState;
    eligibilityRule: BrownlowEligibilityRule;
    basis: BrownlowEvidenceBasis | null;
    /** Joint leaders when `status` is `determined`; empty otherwise. Never a "winner" field. */
    leaders: BrownlowAwardLeader[];
    tie: boolean | null;
    /** What the provider and the stored table CLAIM. Reported, never used to choose a leader. */
    providerClaims: {
      leaderboardWinners: number[] | null;
      leaderboardLeaders: number[] | null;
      storedWinners: number[] | null;
    };
    note: string;
  };
}

/* ------------------------------------------------------------------ *
 * Ordering shared by the builder and the validator
 * ------------------------------------------------------------------ */

export function brownlowCodeUnitCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareNullableNumber(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a - b;
}

function compareNullableString(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return brownlowCodeUnitCompare(a, b);
}

function detailKey(detail: BrownlowFindingDetail): string {
  return Object.keys(detail).sort().map((key) => `${key}=${String(detail[key])}`).join('&');
}

export function compareBrownlowFindings(a: BrownlowFinding, b: BrownlowFinding): number {
  return brownlowCodeUnitCompare(a.code, b.code)
    || compareNullableString(a.providerMatchId, b.providerMatchId)
    || compareNullableNumber(a.playerId, b.playerId)
    || compareNullableString(a.providerPlayerId, b.providerPlayerId)
    || brownlowCodeUnitCompare(detailKey(a.detail), detailKey(b.detail));
}

export function compareBrownlowTotals(
  a: { playerId: number; votes: number },
  b: { playerId: number; votes: number },
): number {
  return b.votes - a.votes || a.playerId - b.playerId;
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
export function serialiseBrownlowReconciliationReport(report: BrownlowReconciliationReport): string {
  return `${JSON.stringify(sortKeys(report), null, 2)}\n`;
}

/* ------------------------------------------------------------------ *
 * Validate
 * ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isCount(value: unknown): value is number {
  return isInt(value) && value >= 0;
}

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export function isBrownlowIsoInstant(value: unknown): value is string {
  return typeof value === 'string' && ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value));
}

export const BROWNLOW_REPORT_REQUIRED = {
  report: ['format', 'formatVersion', 'generatedAt', 'source', 'outcome', 'findings', 'findingCounts',
    'rawVotes', 'awardResultPresentation'],
  source: ['sourceKey', 'season', 'seasonState', 'leaderboardStatus', 'evidence'],
  evidence: ['matchVoteRecords', 'leaderboardEntries', 'storedRows', 'contextMatches'],
  finding: ['code', 'severity', 'providerMatchId', 'playerId', 'providerPlayerId', 'detail'],
  rawVotes: ['basis', 'matches', 'playerTotals', 'topVoteGetters', 'comparisons'],
  match: ['providerMatchId', 'matchId', 'apiRoundNumber', 'canonicalRoundNumber', 'votes'],
  vote: ['providerPlayerId', 'providerTeamId', 'playerId', 'clubId', 'votes', 'eligible'],
  playerTotal: ['playerId', 'votes', 'matchesPolled', 'eligible'],
  topVoteGetter: ['playerId', 'votes', 'eligible'],
  comparison: ['state', 'compared', 'mismatches'],
  award: ['status', 'refusalCode', 'seasonState', 'eligibilityRule', 'basis', 'leaders', 'tie',
    'providerClaims', 'note'],
  claims: ['leaderboardWinners', 'leaderboardLeaders', 'storedWinners'],
} as const;

function missing(path: string, value: Record<string, unknown>, required: readonly string[], problems: string[]): void {
  for (const key of required) {
    if (!(key in value)) problems.push(`${path}.${key} is required.`);
  }
}

function checkNullableInt(path: string, value: unknown, problems: string[]): void {
  if (value !== null && !isInt(value)) problems.push(`${path} must be an integer or null.`);
}

function checkDetail(path: string, value: unknown, problems: string[]): void {
  if (!isRecord(value)) {
    problems.push(`${path} must be an object.`);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!(entry === null || typeof entry === 'string' || typeof entry === 'boolean'
      || (typeof entry === 'number' && Number.isFinite(entry)))) {
      problems.push(`${path}.${key} must be a string, finite number, boolean or null.`);
    }
  }
}

function checkFinding(path: string, value: unknown, problems: string[]): value is BrownlowFinding {
  if (!isRecord(value)) {
    problems.push(`${path} must be an object.`);
    return false;
  }
  const before = problems.length;
  missing(path, value, BROWNLOW_REPORT_REQUIRED.finding, problems);
  if ('code' in value) {
    if (typeof value.code !== 'string' || !(value.code in BROWNLOW_FINDING_CODES)) {
      problems.push(`${path}.code must be a known finding code.`);
    } else if ('severity' in value
      && BROWNLOW_FINDING_CODES[value.code as BrownlowFindingCode] !== value.severity) {
      problems.push(`${path}.severity must be '${BROWNLOW_FINDING_CODES[value.code as BrownlowFindingCode]}' for ${value.code}.`);
    }
  }
  if ('severity' in value && !isOneOf(BROWNLOW_FINDING_SEVERITIES, value.severity)) {
    problems.push(`${path}.severity must be one of ${BROWNLOW_FINDING_SEVERITIES.join(', ')}.`);
  }
  if ('providerMatchId' in value && value.providerMatchId !== null && typeof value.providerMatchId !== 'string') {
    problems.push(`${path}.providerMatchId must be a string or null.`);
  }
  if ('playerId' in value) checkNullableInt(`${path}.playerId`, value.playerId, problems);
  if ('providerPlayerId' in value && value.providerPlayerId !== null && typeof value.providerPlayerId !== 'string') {
    problems.push(`${path}.providerPlayerId must be a string or null.`);
  }
  if ('detail' in value) checkDetail(`${path}.detail`, value.detail, problems);
  return problems.length === before;
}

function checkComparison(path: string, value: unknown, problems: string[]): void {
  if (!isRecord(value)) {
    problems.push(`${path} must be an object.`);
    return;
  }
  missing(path, value, BROWNLOW_REPORT_REQUIRED.comparison, problems);
  if ('state' in value && !isOneOf(BROWNLOW_COMPARISON_STATES, value.state)) {
    problems.push(`${path}.state must be one of ${BROWNLOW_COMPARISON_STATES.join(', ')}.`);
  }
  if ('compared' in value && !isCount(value.compared)) problems.push(`${path}.compared must be a non-negative integer.`);
  if ('mismatches' in value && !isCount(value.mismatches)) problems.push(`${path}.mismatches must be a non-negative integer.`);
  if (value.state !== 'compared' && (value.compared !== 0 || value.mismatches !== 0)) {
    problems.push(`${path}: a comparison that did not run has compared 0 and mismatches 0.`);
  }
}

function checkIdList(path: string, value: unknown, problems: string[]): void {
  if (value === null) return;
  if (!Array.isArray(value) || !value.every(isInt)) {
    problems.push(`${path} must be null or an array of integers.`);
  } else if (value.some((id, i) => i > 0 && (value[i - 1] as number) >= id)) {
    problems.push(`${path} must be strictly ascending.`);
  }
}

/** Every problem found in `value`; an empty array means it is a valid report of this format version. */
export function validateBrownlowReconciliationReport(value: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(value)) return ['report must be an object.'];
  const required = BROWNLOW_REPORT_REQUIRED;
  missing('report', value, required.report, problems);

  if ('format' in value && value.format !== BROWNLOW_RECONCILIATION_REPORT_FORMAT) {
    problems.push(`report.format must be '${BROWNLOW_RECONCILIATION_REPORT_FORMAT}'.`);
  }
  if ('formatVersion' in value && value.formatVersion !== BROWNLOW_RECONCILIATION_REPORT_VERSION) {
    problems.push(`report.formatVersion must be ${BROWNLOW_RECONCILIATION_REPORT_VERSION}.`);
  }
  if ('generatedAt' in value && !isBrownlowIsoInstant(value.generatedAt)) {
    problems.push('report.generatedAt must be an ISO-8601 UTC instant (YYYY-MM-DDTHH:MM:SS[.fff]Z).');
  }

  let seasonState: unknown = null;
  if ('source' in value) {
    const source = value.source;
    if (!isRecord(source)) problems.push('report.source must be an object.');
    else {
      missing('report.source', source, required.source, problems);
      if ('sourceKey' in source && source.sourceKey !== 'afl_api') problems.push("report.source.sourceKey must be 'afl_api'.");
      if ('season' in source && !isInt(source.season)) problems.push('report.source.season must be an integer.');
      if ('seasonState' in source) {
        if (isOneOf(BROWNLOW_SEASON_STATES, source.seasonState)) seasonState = source.seasonState;
        else problems.push(`report.source.seasonState must be one of ${BROWNLOW_SEASON_STATES.join(', ')}.`);
      }
      if ('leaderboardStatus' in source && source.leaderboardStatus !== null && typeof source.leaderboardStatus !== 'string') {
        problems.push('report.source.leaderboardStatus must be a string or null.');
      }
      if ('evidence' in source) {
        const evidence = source.evidence;
        if (!isRecord(evidence)) problems.push('report.source.evidence must be an object.');
        else {
          missing('report.source.evidence', evidence, required.evidence, problems);
          for (const key of ['matchVoteRecords', 'contextMatches'] as const) {
            if (key in evidence && !isCount(evidence[key])) problems.push(`report.source.evidence.${key} must be a non-negative integer.`);
          }
          for (const key of ['leaderboardEntries', 'storedRows'] as const) {
            if (key in evidence && evidence[key] !== null && !isCount(evidence[key])) {
              problems.push(`report.source.evidence.${key} must be a non-negative integer or null.`);
            }
          }
        }
      }
    }
  }

  const outcomeValid = 'outcome' in value && isOneOf(BROWNLOW_OUTCOMES, value.outcome);
  if ('outcome' in value && !outcomeValid) {
    problems.push(`report.outcome must be one of ${BROWNLOW_OUTCOMES.join(', ')}.`);
  }

  // Findings: shapes, sort order, counts, and the outcome they imply.
  let findingList: BrownlowFinding[] | null = null;
  if ('findings' in value) {
    const findings = value.findings;
    if (!Array.isArray(findings)) problems.push('report.findings must be an array.');
    else {
      const shapes = findings.map((finding, i) => checkFinding(`report.findings[${i}]`, finding, problems));
      if (shapes.every(Boolean)) {
        findingList = findings as BrownlowFinding[];
        for (let i = 1; i < findingList.length; i += 1) {
          if (compareBrownlowFindings(findingList[i - 1], findingList[i]) > 0) {
            problems.push(`report.findings is not sorted at index ${i}.`);
            break;
          }
        }
      }
    }
  }
  if ('findingCounts' in value) {
    const counts = value.findingCounts;
    if (!isRecord(counts) || !Object.values(counts).every(isCount)) {
      problems.push('report.findingCounts must map finding codes to non-negative integers.');
    } else if (findingList !== null) {
      const expected: Record<string, number> = {};
      for (const finding of findingList) expected[finding.code] = (expected[finding.code] ?? 0) + 1;
      const same = Object.keys(expected).length === Object.keys(counts).length
        && Object.keys(expected).every((code) => counts[code] === expected[code]);
      if (!same) problems.push('report.findingCounts does not match report.findings.');
    }
  }
  if (findingList !== null && outcomeValid) {
    const hasRefusal = findingList.some((f) => f.severity === 'refusal');
    const hasDiscrepancy = findingList.some((f) => f.severity === 'discrepancy');
    const expected = hasRefusal ? 'refused' : hasDiscrepancy ? 'discrepancies' : 'reconciled';
    if (value.outcome !== expected) problems.push(`report.outcome must be '${expected}' for these findings.`);
  }

  if ('rawVotes' in value) {
    const raw = value.rawVotes;
    if (!isRecord(raw)) problems.push('report.rawVotes must be an object.');
    else {
      missing('report.rawVotes', raw, required.rawVotes, problems);
      if ('basis' in raw && raw.basis !== null && !isOneOf(BROWNLOW_EVIDENCE_BASES, raw.basis)) {
        problems.push(`report.rawVotes.basis must be null or one of ${BROWNLOW_EVIDENCE_BASES.join(', ')}.`);
      }
      if ('matches' in raw) {
        if (!Array.isArray(raw.matches)) problems.push('report.rawVotes.matches must be an array.');
        else {
          raw.matches.forEach((match, i) => {
            const path = `report.rawVotes.matches[${i}]`;
            if (!isRecord(match)) {
              problems.push(`${path} must be an object.`);
              return;
            }
            missing(path, match, required.match, problems);
            if ('providerMatchId' in match && typeof match.providerMatchId !== 'string') problems.push(`${path}.providerMatchId must be a string.`);
            if ('matchId' in match) checkNullableInt(`${path}.matchId`, match.matchId, problems);
            if ('apiRoundNumber' in match && !isInt(match.apiRoundNumber)) problems.push(`${path}.apiRoundNumber must be an integer.`);
            if ('canonicalRoundNumber' in match) checkNullableInt(`${path}.canonicalRoundNumber`, match.canonicalRoundNumber, problems);
            if ('votes' in match) {
              if (!Array.isArray(match.votes)) problems.push(`${path}.votes must be an array.`);
              else {
                match.votes.forEach((vote, j) => {
                  const votePath = `${path}.votes[${j}]`;
                  if (!isRecord(vote)) {
                    problems.push(`${votePath} must be an object.`);
                    return;
                  }
                  missing(votePath, vote, required.vote, problems);
                  if ('providerPlayerId' in vote && typeof vote.providerPlayerId !== 'string') problems.push(`${votePath}.providerPlayerId must be a string.`);
                  if ('providerTeamId' in vote && typeof vote.providerTeamId !== 'string') problems.push(`${votePath}.providerTeamId must be a string.`);
                  if ('playerId' in vote) checkNullableInt(`${votePath}.playerId`, vote.playerId, problems);
                  if ('clubId' in vote) checkNullableInt(`${votePath}.clubId`, vote.clubId, problems);
                  if ('votes' in vote && !isInt(vote.votes)) problems.push(`${votePath}.votes must be an integer.`);
                  if ('eligible' in vote && typeof vote.eligible !== 'boolean') problems.push(`${votePath}.eligible must be a boolean.`);
                });
              }
            }
          });
          const ids = raw.matches.map((m) => (isRecord(m) && typeof m.providerMatchId === 'string' ? m.providerMatchId : ''));
          if (ids.some((id, i) => i > 0 && ids[i - 1] > id)) {
            problems.push('report.rawVotes.matches is not sorted by providerMatchId.');
          }
        }
      }
      if ('playerTotals' in raw) {
        if (!Array.isArray(raw.playerTotals)) problems.push('report.rawVotes.playerTotals must be an array.');
        else {
          let shapesOk = true;
          raw.playerTotals.forEach((total, i) => {
            const path = `report.rawVotes.playerTotals[${i}]`;
            if (!isRecord(total)) {
              problems.push(`${path} must be an object.`);
              shapesOk = false;
              return;
            }
            const before = problems.length;
            missing(path, total, required.playerTotal, problems);
            if ('playerId' in total && !isInt(total.playerId)) problems.push(`${path}.playerId must be an integer.`);
            if ('votes' in total && !isInt(total.votes)) problems.push(`${path}.votes must be an integer.`);
            if ('matchesPolled' in total && total.matchesPolled !== null && !isCount(total.matchesPolled)) {
              problems.push(`${path}.matchesPolled must be a non-negative integer or null.`);
            }
            if ('eligible' in total && typeof total.eligible !== 'boolean') problems.push(`${path}.eligible must be a boolean.`);
            if (problems.length > before) shapesOk = false;
          });
          if (shapesOk) {
            const list = raw.playerTotals as { playerId: number; votes: number }[];
            for (let i = 1; i < list.length; i += 1) {
              if (compareBrownlowTotals(list[i - 1], list[i]) >= 0) {
                problems.push(`report.rawVotes.playerTotals is not sorted (votes descending, playerId ascending, unique) at index ${i}.`);
                break;
              }
            }
          }
        }
      }
      if ('topVoteGetters' in raw) {
        if (!Array.isArray(raw.topVoteGetters)) problems.push('report.rawVotes.topVoteGetters must be an array.');
        else {
          raw.topVoteGetters.forEach((top, i) => {
            const path = `report.rawVotes.topVoteGetters[${i}]`;
            if (!isRecord(top)) {
              problems.push(`${path} must be an object.`);
              return;
            }
            missing(path, top, required.topVoteGetter, problems);
            if ('playerId' in top && !isInt(top.playerId)) problems.push(`${path}.playerId must be an integer.`);
            if ('votes' in top && !isInt(top.votes)) problems.push(`${path}.votes must be an integer.`);
            if ('eligible' in top && typeof top.eligible !== 'boolean') problems.push(`${path}.eligible must be a boolean.`);
          });
        }
      }
      if ('comparisons' in raw) {
        const comparisons = raw.comparisons;
        if (!isRecord(comparisons)) problems.push('report.rawVotes.comparisons must be an object.');
        else {
          for (const key of ['leaderboard', 'stored', 'storedInternal'] as const) {
            if (!(key in comparisons)) problems.push(`report.rawVotes.comparisons.${key} is required.`);
            else checkComparison(`report.rawVotes.comparisons.${key}`, comparisons[key], problems);
          }
        }
      }
    }
  }

  if ('awardResultPresentation' in value) {
    const award = value.awardResultPresentation;
    if (!isRecord(award)) problems.push('report.awardResultPresentation must be an object.');
    else {
      const path = 'report.awardResultPresentation';
      missing(path, award, required.award, problems);
      if ('winner' in award || 'winnerOfRecord' in award) {
        problems.push(`${path} must not carry a winner field; joint leaders are reported as leaders.`);
      }
      const statusValid = 'status' in award && isOneOf(BROWNLOW_AWARD_STATUSES, award.status);
      if ('status' in award && !statusValid) problems.push(`${path}.status must be one of ${BROWNLOW_AWARD_STATUSES.join(', ')}.`);
      if ('refusalCode' in award && award.refusalCode !== null && typeof award.refusalCode !== 'string') {
        problems.push(`${path}.refusalCode must be a string or null.`);
      }
      if ('seasonState' in award) {
        if (!isOneOf(BROWNLOW_SEASON_STATES, award.seasonState)) problems.push(`${path}.seasonState must be one of ${BROWNLOW_SEASON_STATES.join(', ')}.`);
        else if (seasonState !== null && award.seasonState !== seasonState) problems.push(`${path}.seasonState must equal report.source.seasonState.`);
      }
      if ('eligibilityRule' in award && !isOneOf(BROWNLOW_ELIGIBILITY_RULES, award.eligibilityRule)) {
        problems.push(`${path}.eligibilityRule must be one of ${BROWNLOW_ELIGIBILITY_RULES.join(', ')}.`);
      }
      if ('basis' in award && award.basis !== null && !isOneOf(BROWNLOW_EVIDENCE_BASES, award.basis)) {
        problems.push(`${path}.basis must be null or one of ${BROWNLOW_EVIDENCE_BASES.join(', ')}.`);
      }
      if ('tie' in award && award.tie !== null && typeof award.tie !== 'boolean') problems.push(`${path}.tie must be a boolean or null.`);
      if ('note' in award && typeof award.note !== 'string') problems.push(`${path}.note must be a string.`);
      let leadersValid = false;
      if ('leaders' in award) {
        const leaders = award.leaders;
        if (!Array.isArray(leaders)) problems.push(`${path}.leaders must be an array.`);
        else {
          leadersValid = leaders.every((leader) => isRecord(leader) && isInt(leader.playerId) && isInt(leader.votes));
          if (!leadersValid) problems.push(`${path}.leaders entries must be { playerId: integer, votes: integer }.`);
        }
      }
      if ('providerClaims' in award) {
        const claims = award.providerClaims;
        if (!isRecord(claims)) problems.push(`${path}.providerClaims must be an object.`);
        else {
          missing(`${path}.providerClaims`, claims, required.claims, problems);
          for (const key of required.claims) {
            if (key in claims) checkIdList(`${path}.providerClaims.${key}`, claims[key], problems);
          }
        }
      }
      if (statusValid && leadersValid && Array.isArray(award.leaders)) {
        const leaders = award.leaders as BrownlowAwardLeader[];
        if (award.status === 'determined') {
          if (leaders.length === 0) problems.push(`${path}: a determined result has at least one leader.`);
          if (award.refusalCode !== null) problems.push(`${path}: a determined result has no refusalCode.`);
          if (award.tie !== (leaders.length > 1)) problems.push(`${path}.tie must be true exactly when there is more than one leader.`);
          if (new Set(leaders.map((l) => l.votes)).size > 1) problems.push(`${path}: joint leaders share one vote total.`);
          if (leaders.some((l, i) => i > 0 && leaders[i - 1].playerId >= l.playerId)) problems.push(`${path}.leaders must be strictly ascending by playerId.`);
          if (award.basis === null) problems.push(`${path}: a determined result names its basis.`);
          if (seasonState === 'in_progress') problems.push(`${path}: an in-progress season cannot have a determined result.`);
        } else {
          if (leaders.length > 0) problems.push(`${path}: only a determined result carries leaders.`);
          if (award.tie !== null) problems.push(`${path}.tie must be null unless the result is determined.`);
        }
        if (award.status === 'season_incomplete' && award.refusalCode !== null) problems.push(`${path}: an incomplete season is not a refusal.`);
        if (String(award.status).startsWith('refused_') && typeof award.refusalCode !== 'string') {
          problems.push(`${path}: a refused result carries a refusalCode.`);
        }
        if (outcomeValid && value.outcome === 'refused' && award.status !== 'refused_whole_set') {
          problems.push(`${path}.status must be 'refused_whole_set' when the outcome is refused.`);
        }
        if (outcomeValid && value.outcome !== 'refused' && award.status === 'refused_whole_set') {
          problems.push(`${path}.status 'refused_whole_set' requires the outcome 'refused'.`);
        }
      }
    }
  }

  return problems;
}

/* ------------------------------------------------------------------ *
 * JSON Schema (draft 2020-12) — the same field contract for consumers outside TypeScript.
 * Cross-field consistency (outcome vs findings, leaders vs status, sort order) is enforced by
 * validateBrownlowReconciliationReport, which JSON Schema cannot express.
 * ------------------------------------------------------------------ */

const STRING = { type: 'string' } as const;
const INT = { type: 'integer' } as const;
const COUNT = { type: 'integer', minimum: 0 } as const;
const NULLABLE_INT = { type: ['integer', 'null'] } as const;
const NULLABLE_STRING = { type: ['string', 'null'] } as const;
const ID_LIST = { oneOf: [{ type: 'null' }, { type: 'array', items: INT }] } as const;
const BASIS = { enum: [null, ...BROWNLOW_EVIDENCE_BASES] } as const;
const COMPARISON = {
  type: 'object',
  required: [...BROWNLOW_REPORT_REQUIRED.comparison],
  additionalProperties: false,
  properties: { state: { enum: [...BROWNLOW_COMPARISON_STATES] }, compared: COUNT, mismatches: COUNT },
} as const;

export const BROWNLOW_RECONCILIATION_REPORT_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://afldb.example/schemas/brownlow-reconciliation-report/1.json',
  title: 'Brownlow reconciliation report (AFLDB V2)',
  type: 'object',
  required: [...BROWNLOW_REPORT_REQUIRED.report],
  additionalProperties: false,
  properties: {
    format: { const: BROWNLOW_RECONCILIATION_REPORT_FORMAT },
    formatVersion: { const: BROWNLOW_RECONCILIATION_REPORT_VERSION },
    generatedAt: {
      type: 'string',
      pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$',
    },
    source: {
      type: 'object',
      required: [...BROWNLOW_REPORT_REQUIRED.source],
      additionalProperties: false,
      properties: {
        sourceKey: { const: 'afl_api' },
        season: INT,
        seasonState: { enum: [...BROWNLOW_SEASON_STATES] },
        leaderboardStatus: NULLABLE_STRING,
        evidence: {
          type: 'object',
          required: [...BROWNLOW_REPORT_REQUIRED.evidence],
          additionalProperties: false,
          properties: {
            matchVoteRecords: COUNT,
            leaderboardEntries: { type: ['integer', 'null'], minimum: 0 },
            storedRows: { type: ['integer', 'null'], minimum: 0 },
            contextMatches: COUNT,
          },
        },
      },
    },
    outcome: { enum: [...BROWNLOW_OUTCOMES] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: [...BROWNLOW_REPORT_REQUIRED.finding],
        additionalProperties: false,
        properties: {
          code: { enum: Object.keys(BROWNLOW_FINDING_CODES) },
          severity: { enum: [...BROWNLOW_FINDING_SEVERITIES] },
          providerMatchId: NULLABLE_STRING,
          playerId: NULLABLE_INT,
          providerPlayerId: NULLABLE_STRING,
          detail: {
            type: 'object',
            additionalProperties: { type: ['string', 'number', 'boolean', 'null'] },
          },
        },
      },
    },
    findingCounts: { type: 'object', additionalProperties: COUNT },
    rawVotes: {
      type: 'object',
      required: [...BROWNLOW_REPORT_REQUIRED.rawVotes],
      additionalProperties: false,
      properties: {
        basis: BASIS,
        matches: {
          type: 'array',
          items: {
            type: 'object',
            required: [...BROWNLOW_REPORT_REQUIRED.match],
            additionalProperties: false,
            properties: {
              providerMatchId: STRING,
              matchId: NULLABLE_INT,
              apiRoundNumber: INT,
              canonicalRoundNumber: NULLABLE_INT,
              votes: {
                type: 'array',
                items: {
                  type: 'object',
                  required: [...BROWNLOW_REPORT_REQUIRED.vote],
                  additionalProperties: false,
                  properties: {
                    providerPlayerId: STRING,
                    providerTeamId: STRING,
                    playerId: NULLABLE_INT,
                    clubId: NULLABLE_INT,
                    votes: INT,
                    eligible: { type: 'boolean' },
                  },
                },
              },
            },
          },
        },
        playerTotals: {
          type: 'array',
          items: {
            type: 'object',
            required: [...BROWNLOW_REPORT_REQUIRED.playerTotal],
            additionalProperties: false,
            properties: {
              playerId: INT,
              votes: INT,
              matchesPolled: { type: ['integer', 'null'], minimum: 0 },
              eligible: { type: 'boolean' },
            },
          },
        },
        topVoteGetters: {
          type: 'array',
          items: {
            type: 'object',
            required: [...BROWNLOW_REPORT_REQUIRED.topVoteGetter],
            additionalProperties: false,
            properties: { playerId: INT, votes: INT, eligible: { type: 'boolean' } },
          },
        },
        comparisons: {
          type: 'object',
          required: ['leaderboard', 'stored', 'storedInternal'],
          additionalProperties: false,
          properties: { leaderboard: COMPARISON, stored: COMPARISON, storedInternal: COMPARISON },
        },
      },
    },
    awardResultPresentation: {
      type: 'object',
      required: [...BROWNLOW_REPORT_REQUIRED.award],
      additionalProperties: false,
      properties: {
        status: { enum: [...BROWNLOW_AWARD_STATUSES] },
        refusalCode: NULLABLE_STRING,
        seasonState: { enum: [...BROWNLOW_SEASON_STATES] },
        eligibilityRule: { enum: [...BROWNLOW_ELIGIBILITY_RULES] },
        basis: BASIS,
        leaders: {
          type: 'array',
          items: {
            type: 'object',
            required: ['playerId', 'votes'],
            additionalProperties: false,
            properties: { playerId: INT, votes: INT },
          },
        },
        tie: { type: ['boolean', 'null'] },
        providerClaims: {
          type: 'object',
          required: [...BROWNLOW_REPORT_REQUIRED.claims],
          additionalProperties: false,
          properties: { leaderboardWinners: ID_LIST, leaderboardLeaders: ID_LIST, storedWinners: ID_LIST },
        },
        note: STRING,
      },
    },
  },
} as const;
