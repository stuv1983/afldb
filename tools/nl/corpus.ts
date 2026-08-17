/**
 * Stress-test corpus: reading, vocabulary translation and scoring.
 *
 * Deliberately database-free and side-effect-free so the scoring rules can
 * be unit tested (tests/nl-stress-corpus.test.ts) without a connection. The
 * runner in tools/nl/stress-test.ts supplies the observations; everything
 * that decides pass or fail lives here.
 *
 * WHY A TRANSLATION LAYER
 *
 * The corpus was written against its own description of AFL semantics, not
 * against this codebase's plan IR, so the two vocabularies differ in half a
 * dozen places. Translating the corpus into NlQueryPlan terms in one place
 * -- rather than sprinkling special cases through the comparison -- keeps
 * the scoring honest: a mismatch reported by this file is a real
 * disagreement about meaning, not a naming difference.
 *
 *   corpus                          this codebase
 *   ------------------------------  --------------------------------------
 *   metric "margin" + result win    metric "win_margin"
 *   metric "margin" + result loss   metric "loss_margin"
 *   metric "margin", no result      either margin metric accepted
 *   metric "finals_played"          player_career metric "finals"
 *   match_type "final"              match type "finals"
 *   boundary "first"                boundary { event: 'debut' }
 *   predicate field "brownlow_wins" career column "brownlow_medals"
 *   predicate op ">=" / "="         compare op "gte" / "eq"
 *
 * WHAT COUNTS AS A FAILURE
 *
 * A row passes when every expectation it actually asserts is met. Blank
 * expectation columns assert nothing and are not checked -- that is the
 * corpus's own rule, and inventing an expectation for a blank field would
 * manufacture failures.
 *
 * Findings are split by severity because they are not equally alarming:
 *
 *   hard  A confidently wrong interpretation -- the answer looked fine and
 *         meant something else. This is the failure mode this site treats
 *         as the worst one, so it alone decides pass/fail.
 *   soft  The engine was conservative or under-confident: it declined
 *         something it should have answered, or answered with confidence
 *         below the corpus's floor. Worth fixing, never dangerous.
 *   info  Neither side is wrong: chiefly a semantically correct plan that
 *         matched no rows ("Dustin Martin against St Kilda in 2025" is a
 *         perfectly good question about a season he did not play). The
 *         corpus asserts meaning, not row counts, so an empty result is
 *         reported and not scored.
 */
import type {
  NlCareerCondition, NlCompareOp, NlGrain, NlMatchType, NlQueryPlan,
} from '@/search/nl/plan';

// --------------------------------------------------------------- CSV reading

/**
 * RFC 4180 reader. src/lib/csv.ts writes CSV; nothing in the application
 * has needed to read it until now, and the corpus quotes embedded commas
 * and doubled quotes inside expected_plan_json, so a split(',') would
 * shred every row that carries a plan.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  const source = text.replace(/^﻿/, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char !== '"') { field += char; continue; }
      if (source[i + 1] === '"') { field += '"'; i++; continue; }
      quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { row.push(field); field = ''; continue; }
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (char === '\r') continue;
    field += char;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// ------------------------------------------------------------- expectations

export type StressVerificationLevel = 'SEMANTIC' | 'VERIFIED_RESULT' | 'EXPECTED_DECLINE';

export type StressCondition = { column: string; op: NlCompareOp; value: number };

export type StressExpectation = {
  id: number;
  category: string;
  difficulty: number;
  verificationLevel: StressVerificationLevel;
  equivalenceGroup: string;
  question: string;
  status: 'success' | 'decline';
  grain?: NlGrain;
  mode?: 'single' | 'sum';
  /** Already translated into this codebase's metric names. */
  metric?: string;
  /** More than one metric is acceptable (a bare "margin" with no win/loss side named). */
  metricAlternatives?: string[];
  aggregation?: 'max' | 'min' | 'top_n' | 'list' | 'count';
  topN?: number;
  player?: string;
  club?: string;
  opponent?: string;
  venue?: string;
  seasonFrom?: number;
  seasonTo?: number;
  matchType?: NlMatchType;
  boundaryEvent?: 'debut' | 'last_game';
  conditions?: StressCondition[];
  failureReason?: string;
  coverageBehaviour?: 'full' | 'partial' | 'none';
  minConfidence?: number;
  /** Split on '|': a verified tie lists every player who shares the record. */
  answerPrimary?: string[];
  answerValue?: number;
  resultCount?: number;
  tieCount?: number;
  notes: string;
};

const MATCH_TYPES: Record<string, NlMatchType> = {
  final: 'finals',
  finals: 'finals',
  grand_final: 'grand_final',
  preliminary_final: 'preliminary_final',
  semi_final: 'semi_final',
  qualifying_final: 'qualifying_final',
  elimination_final: 'elimination_final',
  home_and_away: 'home_and_away',
};

const CAREER_COLUMN_ALIASES: Record<string, string> = {
  brownlow_wins: 'brownlow_medals',
  brownlow_medals: 'brownlow_medals',
  finals_played: 'finals',
};

const COMPARE_OPS: Record<string, NlCompareOp> = {
  '>=': 'gte', '<=': 'lte', '>': 'gt', '<': 'lt', '=': 'eq', '==': 'eq',
};

/** Corpus metric name -> this codebase's metric name, where the two differ and the mapping does not depend on other columns. */
const METRIC_ALIASES: Record<string, string> = {
  finals_played: 'finals',
};

/**
 * Club names the corpus spells in a way the club directory does not carry
 * as one alias. The directory knows "gws", "giants" and "greater western
 * sydney" separately -- and the parser resolves "GWS Giants" from them
 * perfectly well -- but the exact string is not a key, so the identity
 * lookup would miss and fall back to comparing names, which then reports
 * 21 phantom failures. Keep this list as short as the startup warning
 * allows: an entry here is a translation, not a fix.
 */
export const CORPUS_CLUB_SPELLINGS: Record<string, string> = {
  'GWS Giants': 'Greater Western Sydney',
};

function num(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseConditions(json: string | undefined): StressCondition[] | undefined {
  if (!json) return undefined;
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return undefined; }
  if (!Array.isArray(raw)) return undefined;

  const conditions: StressCondition[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { field, op, value } = entry as Record<string, unknown>;
    if (typeof field !== 'string' || typeof op !== 'string' || typeof value !== 'number') continue;
    const mappedOp = COMPARE_OPS[op];
    if (!mappedOp) continue;
    conditions.push({ column: CAREER_COLUMN_ALIASES[field] ?? field, op: mappedOp, value });
  }
  return conditions.length > 0 ? conditions : undefined;
}

/**
 * One CSV row -> one expectation, with corpus vocabulary translated.
 *
 * Returns null for a row that carries no question at all, which is how a
 * trailing blank line in the file arrives here.
 */
export function toExpectation(row: Record<string, string>): StressExpectation | null {
  const question = (row.question ?? '').trim();
  if (!question) return null;

  const status = row.expected_status === 'decline' ? 'decline' : 'success';
  const rawMetric = row.expected_metric || undefined;
  const resultSide = row.expected_result || undefined;

  // "margin" is the corpus's single team-match metric; this codebase keeps
  // the winning and losing sides apart, because which one a question means
  // is exactly what "worst loss" got wrong before.
  let metric: string | undefined;
  let metricAlternatives: string[] | undefined;
  if (rawMetric === 'margin') {
    if (resultSide === 'win') metric = 'win_margin';
    else if (resultSide === 'loss') metric = 'loss_margin';
    else metricAlternatives = ['win_margin', 'loss_margin'];
  } else if (rawMetric) {
    metric = METRIC_ALIASES[rawMetric] ?? rawMetric;
  }

  const rawMatchType = row.expected_match_type || undefined;
  const boundary = row.expected_boundary || undefined;

  return {
    id: Number(row.id),
    category: row.category ?? '',
    difficulty: num(row.difficulty) ?? 0,
    verificationLevel: (row.verification_level as StressVerificationLevel) ?? 'SEMANTIC',
    equivalenceGroup: row.equivalence_group ?? '',
    question,
    status,
    grain: (row.expected_grain || undefined) as NlGrain | undefined,
    mode: (row.expected_mode || undefined) as 'single' | 'sum' | undefined,
    metric,
    metricAlternatives,
    aggregation: (row.expected_aggregation || undefined) as StressExpectation['aggregation'],
    topN: num(row.expected_limit),
    player: row.expected_player || undefined,
    club: row.expected_club || undefined,
    opponent: row.expected_opponent || undefined,
    venue: row.expected_venue || undefined,
    seasonFrom: num(row.expected_season_from),
    seasonTo: num(row.expected_season_to),
    matchType: rawMatchType ? MATCH_TYPES[rawMatchType] : undefined,
    boundaryEvent: boundary === 'first' ? 'debut' : boundary === 'last' ? 'last_game' : undefined,
    conditions: parseConditions(row.expected_predicates_json),
    failureReason: row.expected_failure_reason || undefined,
    coverageBehaviour: (row.expected_coverage_behavior || undefined) as StressExpectation['coverageBehaviour'],
    minConfidence: num(row.expected_min_confidence),
    answerPrimary: row.expected_answer_primary
      ? row.expected_answer_primary.split('|').map((name) => name.trim()).filter(Boolean)
      : undefined,
    answerValue: num(row.expected_answer_value),
    resultCount: num(row.expected_result_count),
    tieCount: num(row.expected_tie_count),
    notes: row.notes ?? '',
  };
}

export function readCorpus(text: string): StressExpectation[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0];
  const expectations: StressExpectation[] = [];
  for (const row of rows.slice(1)) {
    const record: Record<string, string> = {};
    header.forEach((name, index) => { record[name] = row[index] ?? ''; });
    const expectation = toExpectation(record);
    if (expectation) expectations.push(expectation);
  }
  return expectations;
}

// ------------------------------------------------------------ observations

/**
 * What the engine actually did with one question. Mirrors the terminal
 * branches of answerNlQuestion, with the plan and parse report kept rather
 * than discarded -- an answer alone cannot say whether the right question
 * was asked of the database.
 */
export type StressObservation = {
  /** 'no_results' is a plan that executed and matched nothing; 'error' is a thrown exception. */
  status: 'success' | 'decline' | 'no_results' | 'error';
  /** False in --parse-only runs, where no SQL ran and there is therefore no answer to check a verified fact against. */
  executed: boolean;
  /** For a decline: the NlFailureReason the engine would have logged. */
  failureReason?: string;
  confidence: number | null;
  plan: NlQueryPlan | null;
  unsupportedTerms: string[];
  coverageNote: string | null;
  leadName: string | null;
  leadValue: number | null;
  total: number | null;
  /** How many rows share the lead value -- the corpus's tie_count. */
  tieCount: number | null;
  durationMs: number;
  errorMessage?: string;
  errorCode?: string;
};

// ---------------------------------------------------------------- findings

/**
 * Failure classes. The corpus README suggests a set; these are those,
 * split finer where one of its names would have merged two genuinely
 * different bugs (a wrong opponent and a wrong venue cluster separately
 * and get fixed separately, so WRONG_ENTITY is broken out per slot).
 */
export type StressFindingClass =
  | 'WRONG_GRAIN' | 'GRAIN_EQUIVALENT' | 'WRONG_MODE' | 'WRONG_METRIC' | 'WRONG_RESULT_SIDE'
  | 'WRONG_AGGREGATION' | 'WRONG_TOP_N'
  | 'WRONG_PLAYER' | 'WRONG_CLUB' | 'WRONG_OPPONENT' | 'WRONG_VENUE'
  | 'WRONG_SEASON' | 'WRONG_MATCH_TYPE' | 'WRONG_BOUNDARY' | 'WRONG_PREDICATES'
  | 'DROPPED_FILTER' | 'EXTRA_FILTER'
  | 'UNEXPECTED_DECLINE' | 'AMBIGUITY_NOT_DETECTED' | 'WRONG_FAILURE_REASON'
  | 'COVERAGE_WRONG' | 'LOW_CONFIDENCE' | 'NO_RESULTS'
  | 'WRONG_VERIFIED_ANSWER' | 'WRONG_VERIFIED_VALUE' | 'WRONG_TIE_COUNT'
  | 'TIMEOUT' | 'DATABASE_ERROR' | 'INTERNAL_ERROR';

export type StressSeverity = 'hard' | 'soft' | 'info';

export type StressFinding = {
  class: StressFindingClass;
  severity: StressSeverity;
  expected: string;
  actual: string;
};

function finding(
  cls: StressFindingClass,
  severity: StressSeverity,
  expected: unknown,
  actual: unknown,
): StressFinding {
  return { class: cls, severity, expected: String(expected ?? '(none)'), actual: String(actual ?? '(none)') };
}

/**
 * Resolves a corpus entity name to the identity the plan carries.
 *
 * The corpus writes "GWS Giants" where the database says "Greater Western
 * Sydney", so names cannot be compared as strings -- and loosening the
 * comparison to substrings is worse than useless here, because "Sydney"
 * is a substring of "Greater Western Sydney" and "Melbourne" of "North
 * Melbourne": the two mix-ups most worth catching would both score as
 * matches. Ids settle it exactly, and the runner builds this from the
 * very club and venue directories the parser itself resolves against, so
 * every alias either side knows is already accounted for.
 */
export type EntityIndex = {
  clubOrgId(name: string): number | undefined;
  venueId(name: string): number | undefined;
};

function normaliseName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Exact once case and punctuation are set aside. Deliberately not fuzzy -- see EntityIndex. */
function sameName(a: string | undefined | null, b: string | undefined | null): boolean {
  return Boolean(a && b && normaliseName(a) === normaliseName(b));
}

/**
 * Looser, for the 51 hand-verified answers only: a person's name can be
 * recorded with or without a generational suffix ("Gary Ablett Snr"), and
 * every one of these rows is also printed in full in the report for a
 * human to read, so a near-match here cannot hide a wrong answer.
 */
function samePersonName(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  const strip = (s: string) => normaliseName(s).replace(/(snr|sr|jnr|jr)$/, '');
  const left = strip(a);
  const right = strip(b);
  return left === right || left.includes(right) || right.includes(left);
}

function conditionKey(c: { column: string; op: string; value: number }): string {
  return `${c.column} ${c.op} ${c.value}`;
}

function planConditionKey(c: NlCareerCondition): string {
  return c.kind === 'column'
    ? conditionKey({ column: c.column, op: c.op, value: c.value })
    : conditionKey({ column: c.awardKey, op: c.op, value: c.value });
}

/**
 * Compare one expectation against one observation.
 *
 * Order matters only for readability of the output; every applicable check
 * runs, so a row with both a wrong opponent and a wrong metric reports
 * both and clusters into both groups.
 */
export function scoreRow(
  expected: StressExpectation,
  actual: StressObservation,
  index?: EntityIndex,
): StressFinding[] {
  const findings: StressFinding[] = [];

  if (actual.status === 'error') {
    const cls: StressFindingClass = actual.errorCode === '57014'
      ? 'TIMEOUT'
      : actual.errorCode ? 'DATABASE_ERROR' : 'INTERNAL_ERROR';
    findings.push(finding(cls, 'hard', expected.status, actual.errorMessage ?? 'error'));
    return findings;
  }

  // ---- status ------------------------------------------------------------

  if (expected.status === 'decline') {
    if (actual.status === 'success') {
      // Answering something the corpus says is ambiguous, subjective or
      // unsupported is the one decline failure that is genuinely unsafe.
      findings.push(finding('AMBIGUITY_NOT_DETECTED', 'hard', 'decline', 'answered'));
    } else if (
      actual.status === 'decline'
      && expected.failureReason
      && actual.failureReason
      && actual.failureReason !== expected.failureReason
    ) {
      // Declined, but for a different stated reason: the reader still gets
      // no wrong answer, so this is a message-quality problem.
      findings.push(finding('WRONG_FAILURE_REASON', 'soft', expected.failureReason, actual.failureReason));
    }
    // A decline that produced no plan has nothing further to compare.
    if (actual.status !== 'success') return findings;
  } else if (actual.status === 'decline') {
    findings.push(finding(
      'UNEXPECTED_DECLINE', 'soft', 'answered',
      `declined (${actual.failureReason ?? 'unknown'}${actual.unsupportedTerms.length ? `: ${actual.unsupportedTerms.join(', ')}` : ''})`,
    ));
    return findings;
  }

  const plan = actual.plan;
  if (!plan) {
    findings.push(finding('UNEXPECTED_DECLINE', 'soft', 'a query plan', 'no plan'));
    return findings;
  }

  // ---- semantics ---------------------------------------------------------

  /**
   * "Sydney's leading goalkicker in 1897" can be planned two ways that ask
   * the database the same question: rank player-seasons, or sum a player's
   * match rows inside one pinned season and rank that. The corpus names
   * the first; this engine builds the second, and both return Dinny McKay
   * on 14.
   *
   * Reported, because the two read different tables and could diverge
   * where season aggregates exist and match rows do not -- but soft,
   * because calling it a wrong interpretation would put thousands of rows
   * that produce the right answer ahead of the handful that produce the
   * wrong one. The pinned-season test is load-bearing: with an open range
   * ("most tackles since 1900") the two are genuinely different questions,
   * one asking for a best season and the other for a career total, and
   * that difference stays a hard failure.
   */
  const pinnedSeason = plan.scope.seasonMin !== undefined && plan.scope.seasonMin === plan.scope.seasonMax;
  const seasonSumForSeasonRank = expected.grain === 'player_season'
    && plan.grain === 'player_game' && plan.mode === 'sum' && pinnedSeason;

  if (expected.grain && plan.grain !== expected.grain) {
    findings.push(seasonSumForSeasonRank
      ? finding('GRAIN_EQUIVALENT', 'soft', expected.grain, `${plan.grain}/sum over one season`)
      : finding('WRONG_GRAIN', 'hard', expected.grain, plan.grain));
  }

  if (expected.mode && plan.mode !== expected.mode) {
    findings.push(finding('WRONG_MODE', 'hard', expected.mode, plan.mode));
  }

  // A pure list question ("players with at least 24 games") has no ranked
  // metric in this IR -- the column lives in the condition instead, which
  // is where the check below finds it. The corpus names a metric for these
  // rows anyway, so a null here is only a finding when the column it names
  // is not among the conditions.
  const metricIsACondition = expected.aggregation === 'list'
    && plan.metric === null
    && expected.metric !== undefined
    && plan.careerConditions.some((c) => c.kind === 'column' && c.column === expected.metric);

  if (metricIsACondition) {
    // Nothing to report: the plan carries the column as a filter.
  } else if (expected.metric && plan.metric !== expected.metric) {
    // win_margin vs loss_margin is the polarity bug class, not a metric
    // lookup failure, and clusters separately because one parser rule
    // fixes every instance of it at once.
    const bothMargins = /_margin$/.test(expected.metric) && /_margin$/.test(plan.metric ?? '');
    findings.push(finding(bothMargins ? 'WRONG_RESULT_SIDE' : 'WRONG_METRIC', 'hard', expected.metric, plan.metric));
  } else if (expected.metricAlternatives && !expected.metricAlternatives.includes(plan.metric ?? '')) {
    findings.push(finding('WRONG_METRIC', 'hard', expected.metricAlternatives.join(' or '), plan.metric));
  }

  if (expected.aggregation && plan.agg.kind !== expected.aggregation) {
    findings.push(finding('WRONG_AGGREGATION', 'hard', expected.aggregation, plan.agg.kind));
  }

  if (expected.topN !== undefined && expected.aggregation === 'top_n') {
    const actualN = plan.agg.kind === 'top_n' ? plan.agg.n : undefined;
    if (actualN !== expected.topN) {
      findings.push(finding('WRONG_TOP_N', 'hard', expected.topN, actualN));
    }
  }

  // Each slot compares identity where the runner could index the corpus's
  // name, and falls back to an exact name match where it could not (which
  // the runner reports separately at startup rather than letting it pass
  // silently).
  const slots: {
    label: string;
    cls: StressFindingClass;
    want: string | undefined;
    got: string | undefined;
    wantId?: number;
    gotId?: number;
  }[] = [
    { label: 'player', cls: 'WRONG_PLAYER', want: expected.player, got: plan.player?.name },
    {
      label: 'club', cls: 'WRONG_CLUB', want: expected.club, got: plan.scope.clubFor?.name,
      wantId: expected.club ? index?.clubOrgId(expected.club) : undefined,
      gotId: plan.scope.clubFor?.organizationId,
    },
    {
      label: 'opponent', cls: 'WRONG_OPPONENT', want: expected.opponent, got: plan.scope.clubAgainst?.name,
      wantId: expected.opponent ? index?.clubOrgId(expected.opponent) : undefined,
      gotId: plan.scope.clubAgainst?.organizationId,
    },
    {
      label: 'venue', cls: 'WRONG_VENUE', want: expected.venue, got: plan.scope.venue?.name,
      wantId: expected.venue ? index?.venueId(expected.venue) : undefined,
      gotId: plan.scope.venue?.id,
    },
  ];
  for (const slot of slots) {
    if (!slot.want) continue;
    if (!slot.got) {
      findings.push(finding('DROPPED_FILTER', 'hard', `${slot.label}=${slot.want}`, 'absent'));
      continue;
    }
    const matched = slot.wantId !== undefined
      ? slot.wantId === slot.gotId
      : sameName(slot.want, slot.got);
    if (!matched) findings.push(finding(slot.cls, 'hard', slot.want, slot.got));
  }

  if (expected.seasonFrom !== undefined && plan.scope.seasonMin !== expected.seasonFrom) {
    findings.push(finding(
      plan.scope.seasonMin === undefined ? 'DROPPED_FILTER' : 'WRONG_SEASON',
      'hard', `seasonMin=${expected.seasonFrom}`, plan.scope.seasonMin,
    ));
  }
  if (expected.seasonTo !== undefined && plan.scope.seasonMax !== expected.seasonTo) {
    findings.push(finding(
      plan.scope.seasonMax === undefined ? 'DROPPED_FILTER' : 'WRONG_SEASON',
      'hard', `seasonMax=${expected.seasonTo}`, plan.scope.seasonMax,
    ));
  }

  // A boundary question carries its finals/Grand Final target inside the
  // boundary itself, so scope.matchType is not asserted for those rows --
  // the parser is free to leave it set or clear it.
  if (expected.boundaryEvent) {
    if (plan.boundary?.event !== expected.boundaryEvent) {
      findings.push(finding('WRONG_BOUNDARY', 'hard', expected.boundaryEvent, plan.boundary?.event));
    } else if (expected.matchType) {
      const wantWhere = expected.matchType === 'grand_final' ? 'grand_final' : 'final';
      if (plan.boundary.where !== wantWhere) {
        findings.push(finding('WRONG_MATCH_TYPE', 'hard', wantWhere, plan.boundary.where));
      }
    }
  } else if (expected.matchType && plan.scope.matchType !== expected.matchType) {
    findings.push(finding(
      plan.scope.matchType === undefined ? 'DROPPED_FILTER' : 'WRONG_MATCH_TYPE',
      'hard', `matchType=${expected.matchType}`, plan.scope.matchType,
    ));
  }

  if (expected.conditions) {
    const want = new Set(expected.conditions.map(conditionKey));
    const got = new Set(plan.careerConditions.map(planConditionKey));
    const missing = [...want].filter((key) => !got.has(key));
    const extra = [...got].filter((key) => !want.has(key));
    if (missing.length > 0) {
      findings.push(finding('DROPPED_FILTER', 'hard', missing.join('; '), [...got].join('; ') || 'none'));
    }
    if (extra.length > 0) {
      findings.push(finding('EXTRA_FILTER', 'hard', [...want].join('; ') || 'none', extra.join('; ')));
    }
  }

  // ---- coverage ----------------------------------------------------------

  if (expected.coverageBehaviour === 'partial' && !actual.coverageNote) {
    findings.push(finding('COVERAGE_WRONG', 'soft', 'a coverage caveat', 'none shown'));
  }

  // ---- verified facts ----------------------------------------------------

  // Only checkable when SQL actually ran: a --parse-only run has a plan
  // and no answer, and scoring a missing answer as a wrong one would
  // fail all 51 hand-verified rows for the wrong reason.
  if (actual.executed) {
    if (expected.answerPrimary && expected.answerPrimary.length > 0) {
      const matched = expected.answerPrimary.some((name) => samePersonName(name, actual.leadName));
      if (!matched) {
        findings.push(finding('WRONG_VERIFIED_ANSWER', 'hard', expected.answerPrimary.join(' | '), actual.leadName));
      }
    }
    if (expected.answerValue !== undefined && actual.leadValue !== expected.answerValue) {
      findings.push(finding('WRONG_VERIFIED_VALUE', 'hard', expected.answerValue, actual.leadValue));
    }
    if (expected.tieCount !== undefined && actual.tieCount !== expected.tieCount) {
      findings.push(finding('WRONG_TIE_COUNT', 'hard', expected.tieCount, actual.tieCount));
    }
    if (expected.resultCount !== undefined && actual.total !== expected.resultCount) {
      findings.push(finding('WRONG_VERIFIED_VALUE', 'hard', `${expected.resultCount} results`, `${actual.total} results`));
    }
  }

  // ---- confidence and emptiness -----------------------------------------

  if (expected.minConfidence !== undefined && actual.confidence !== null && actual.confidence < expected.minConfidence) {
    findings.push(finding('LOW_CONFIDENCE', 'soft', `>= ${expected.minConfidence}`, actual.confidence.toFixed(3)));
  }

  if (actual.status === 'no_results') {
    findings.push(finding('NO_RESULTS', 'info', 'rows', '0 rows'));
  }

  return findings;
}

export function verdict(findings: StressFinding[]): 'pass' | 'soft_fail' | 'fail' {
  if (findings.some((f) => f.severity === 'hard')) return 'fail';
  if (findings.some((f) => f.severity === 'soft')) return 'soft_fail';
  return 'pass';
}
