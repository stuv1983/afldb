/**
 * V2 stress-corpus support: streaming CSV, schema detection, validation,
 * canonical semantics, oracle scoring, metamorphic groups, and
 * bounded-memory statistics.
 *
 * Deliberately database-free, like corpus.ts, so every scoring rule is
 * unit-testable without a connection (tests/nl-stress-v2.test.ts). The
 * runner in v2-runner.ts supplies observations; everything that decides
 * pass or fail lives here.
 *
 * THE V2 CONTRACT, as distinct from V1
 *
 * V1 asserted interpretation through its own column vocabulary, which
 * needed a translation table. V2's `expected_semantics_json` is this
 * codebase's own NlQueryPlan IR -- same grain names, same metric keys,
 * same agg objects, canonical club/venue names -- so the comparison here
 * is direct: canonicalise both sides, then diff.
 *
 * Five oracle modes, each scored differently:
 *
 *   plan         parser only; canonical semantics must equal expectation.
 *                NEVER fails because execution would return zero rows --
 *                a valid interpretation of an empty scope is still valid.
 *   plan+policy  same, except the expected status may be a decline
 *                (era-coverage policy): the engine must REFUSE, for the
 *                right reason, rather than plan.
 *   answer       parser AND execution; the football result must match
 *                the hand-verified expectation, ties as complete sets.
 *                Scored independently of semantics so a right number can
 *                never hide a wrong interpretation, or vice versa.
 *   decline      parser only; must not produce a confident plan. A wrong
 *                decline REASON is a soft finding; answering at all is
 *                UNSAFE_ANSWER, the suite's most serious failure.
 *   metamorphic  rows sharing a metamorphic_group are alternative
 *                wordings of one question and must all produce the same
 *                canonical semantics as each other (and, when supplied,
 *                as the group's expected semantics).
 *
 * SEVERITY follows the corpus's hard_safety_rule: a confidently wrong
 * interpretation or answer is hard; declines are soft -- except on a row
 * that explicitly expects an answer, where a decline is a hard failure
 * of the suite's own verified set.
 */
import { createHash } from 'node:crypto';

import type { NlQueryPlan } from '@/search/nl/plan';

// ------------------------------------------------------------ CSV streaming

/**
 * Incremental RFC 4180 reader over an async chunk source. corpus.ts's
 * parseCsv reads a whole string, which at 103 MB would be a single
 * resident copy of the corpus plus its parsed rows; this holds one row
 * at a time. Quoted fields may contain commas, doubled quotes and even
 * newlines (none observed in the corpus, but the reader must not corrupt
 * silently if a regenerated corpus adds one).
 */
export async function* streamCsvRows(
  chunks: AsyncIterable<string | Buffer>,
): AsyncGenerator<string[]> {
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let first = true;
  let pendingQuote = false;

  for await (const chunk of chunks) {
    let text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (first) {
      text = text.replace(/^﻿/, '');
      first = false;
    }
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      // A closing quote seen at the very end of the previous chunk: decide
      // now whether it was an escaped pair or the end of the quoted run.
      if (pendingQuote) {
        pendingQuote = false;
        if (c === '"') { field += '"'; continue; }
        quoted = false;
        // fall through to process c unquoted
      }
      if (quoted) {
        if (c !== '"') { field += c; continue; }
        if (i === text.length - 1) { pendingQuote = true; continue; }
        if (text[i + 1] === '"') { field += '"'; i++; continue; }
        quoted = false;
        continue;
      }
      if (c === '"') { quoted = true; continue; }
      if (c === ',') { row.push(field); field = ''; continue; }
      if (c === '\n') { row.push(field); yield row; row = []; field = ''; continue; }
      if (c === '\r') continue;
      field += c;
    }
  }
  if (pendingQuote) quoted = false;
  if (field !== '' || row.length > 0) { row.push(field); yield row; }
}

// --------------------------------------------------------- schema detection

/**
 * V1 and V2 are told apart by their headers, never by a flag: the V2
 * columns that matter (`oracle`, `expected_semantics_json`) cannot appear
 * in a V1 file and vice versa. Null means neither -- the caller must
 * refuse with the header it saw, not guess.
 */
export function detectSchema(header: string[]): 'v1' | 'v2' | null {
  const names = new Set(header.map((h) => h.trim()));
  if (names.has('case_id') && names.has('oracle') && names.has('expected_semantics_json')) return 'v2';
  if (names.has('id') && names.has('verification_level') && names.has('equivalence_group')) return 'v1';
  return null;
}

// ------------------------------------------------------------------- cases

export const V2_ORACLES = ['plan', 'plan+policy', 'answer', 'decline', 'metamorphic'] as const;
export type V2Oracle = (typeof V2_ORACLES)[number];

export type V2ExpectedStatus = 'plan' | 'decline' | 'answer';

/** expected_semantics_json, as written: this codebase's IR with entity NAMES where the live plan carries refs. */
export type ExpectedSemantics = {
  grain: string;
  metric?: string | null;
  mode?: 'single' | 'sum';
  agg?: { kind: string; n?: number };
  player?: string;
  scope?: {
    clubFor?: string; clubAgainst?: string; venue?: string;
    seasonMin?: number; seasonMax?: number; matchType?: string;
  };
  careerConditions?: { kind: string; column?: string; awardKey?: string; op: string; value: number }[];
  clubSeasonConditions?: { kind: string }[];
  boundary?: { event: string; where: string };
  tiePolicy?: 'all' | 'first';
  limit?: number;
};

export type ExpectedAnswer = {
  /** Every member of the (possibly tied) expected result. */
  names: string[];
  value?: number;
  unit?: string;
};

export type V2Case = {
  id: string;
  category: string;
  oracle: V2Oracle;
  difficulty: string;
  question: string;
  expectedStatus: V2ExpectedStatus;
  expectedReason?: string;
  expectedSemantics?: ExpectedSemantics;
  expectedAnswer?: ExpectedAnswer;
  metamorphicGroup?: string;
  /**
   * Set when the row's own expectation contradicts the question it ships
   * with -- see oracleDefect(). Such a row cannot be passed by a correct
   * parser, so it is quarantined out of every rate rather than counted as
   * a failure. Nothing is deleted: the id, the question and the
   * contradiction are all reported, so a generator fix stays auditable.
   */
  oracleDefect?: string;
};

/**
 * Surface phrase -> comparison operator, for auditing the CORPUS against
 * itself. Deliberately a separate, dumber reader than src/search/nl: if
 * this shared the parser's vocabulary, a parser bug would excuse the very
 * expectations it should be measured against, which is the failure mode
 * this whole harness exists to prevent.
 */
const STATED_OPERATOR_PHRASES: [RegExp, string][] = [
  [/\bat least\s+(\d+)\b/g, 'gte'],
  [/\bat most\s+(\d+)\b/g, 'lte'],
  [/\bno more than\s+(\d+)\b/g, 'lte'],
  [/\bno fewer than\s+(\d+)\b/g, 'gte'],
  [/\bmore than\s+(\d+)\b/g, 'gt'],
  [/\bfewer than\s+(\d+)\b/g, 'lt'],
  [/\bless than\s+(\d+)\b/g, 'lt'],
  [/\bover\s+(\d+)\b/g, 'gt'],
  [/\bunder\s+(\d+)\b/g, 'lt'],
  [/\bexactly\s+(\d+)\b/g, 'eq'],
  [/\b(\d+)\+/g, 'gte'],
];

/** Every (operator, value) pair the question states in plain English. */
function statedOperators(question: string): { op: string; value: number }[] {
  const found: { op: string; value: number }[] = [];
  for (const [re, op] of STATED_OPERATOR_PHRASES) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(question)) !== null) found.push({ op, value: Number(match[1]) });
  }
  return found;
}

/**
 * Why this row's expectation contradicts its own question text, or null
 * when it does not.
 *
 * A corpus is only an oracle while it agrees with itself. The 250k
 * generator emitted 4,421 numeric-condition rows whose surface text says
 * "exactly 300" and whose expectation asserts `gt 300` -- rows a correct
 * parser must fail and an incorrect one could pass. Scoring them rewards
 * wrong parsing, so they are quarantined.
 *
 * Two deliberate conservatism rules, both erring toward NOT quarantining:
 *
 *  - A value the question states no operator for is unjudgeable, and is
 *    skipped rather than assumed.
 *  - A value stated with several operators ("at least 5 finals and at
 *    most 5 goals" both state 5) counts as agreeing with any of them. So
 *    a corpus that swapped two same-valued clauses is invisible here, and
 *    the count this produces is a floor, not a total.
 */
export function oracleDefect(v2Case: V2Case): string | null {
  const conditions = v2Case.expectedSemantics?.careerConditions;
  if (!conditions || conditions.length === 0) return null;

  const stated = statedOperators(v2Case.question.toLowerCase());
  if (stated.length === 0) return null;

  for (const condition of conditions) {
    const sameValue = stated.filter((s) => s.value === condition.value);
    if (sameValue.length === 0) continue;
    if (sameValue.some((s) => s.op === condition.op)) continue;
    const says = [...new Set(sameValue.map((s) => s.op))].join('/');
    return `question states ${says} ${condition.value}, expectation asserts `
      + `${condition.column ?? condition.awardKey ?? '?'} ${condition.op} ${condition.value}`;
  }
  return null;
}

/** One CSV record -> a case, or the reason it is malformed. */
export function toV2Case(record: Record<string, string>): { v2Case?: V2Case; error?: string } {
  const id = (record.case_id ?? '').trim();
  if (!id) return { error: 'missing case_id' };
  const question = (record.question ?? '').trim();
  if (!question) return { error: `${id}: missing question` };

  const oracle = record.oracle as V2Oracle;
  if (!(V2_ORACLES as readonly string[]).includes(oracle)) {
    return { error: `${id}: unknown oracle "${record.oracle}"` };
  }
  const expectedStatus = record.expected_status as V2ExpectedStatus;
  if (!['plan', 'decline', 'answer'].includes(expectedStatus)) {
    return { error: `${id}: unknown expected_status "${record.expected_status}"` };
  }

  // Oracle/status coherence -- catching a mislabelled corpus before it
  // spends hours running.
  if (oracle === 'answer' && expectedStatus !== 'answer') return { error: `${id}: answer oracle with status ${expectedStatus}` };
  if (oracle === 'decline' && expectedStatus !== 'decline') return { error: `${id}: decline oracle with status ${expectedStatus}` };
  if ((oracle === 'plan' || oracle === 'metamorphic') && expectedStatus !== 'plan') {
    return { error: `${id}: ${oracle} oracle with status ${expectedStatus}` };
  }

  let expectedSemantics: ExpectedSemantics | undefined;
  if (record.expected_semantics_json) {
    try {
      expectedSemantics = JSON.parse(record.expected_semantics_json) as ExpectedSemantics;
    } catch {
      return { error: `${id}: expected_semantics_json is not valid JSON` };
    }
    if (!expectedSemantics.grain) return { error: `${id}: expected semantics has no grain` };
    if (!expectedSemantics.agg?.kind) return { error: `${id}: expected semantics has no aggregation` };
  }
  if (expectedStatus === 'plan' && !expectedSemantics) {
    return { error: `${id}: expects a plan but carries no expected_semantics_json` };
  }

  let expectedAnswer: ExpectedAnswer | undefined;
  if (record.expected_answer_json) {
    try {
      const raw = JSON.parse(record.expected_answer_json) as { names?: unknown; value?: unknown; unit?: unknown };
      const names = Array.isArray(raw.names) ? raw.names.filter((n): n is string => typeof n === 'string') : [];
      expectedAnswer = {
        names,
        value: typeof raw.value === 'number' ? raw.value : undefined,
        unit: typeof raw.unit === 'string' ? raw.unit : undefined,
      };
    } catch {
      return { error: `${id}: expected_answer_json is not valid JSON` };
    }
  }
  if (oracle === 'answer' && (!expectedAnswer || (expectedAnswer.names.length === 0 && expectedAnswer.value === undefined))) {
    return { error: `${id}: answer oracle with no usable expected answer` };
  }

  const metamorphicGroup = record.metamorphic_group?.trim() || undefined;
  if (oracle === 'metamorphic' && !metamorphicGroup) return { error: `${id}: metamorphic oracle with no group` };

  const v2Case: V2Case = {
    id,
    category: record.category ?? '',
    oracle,
    difficulty: record.difficulty ?? '',
    question,
    expectedStatus,
    expectedReason: record.expected_reason?.trim() || undefined,
    expectedSemantics,
    expectedAnswer,
    metamorphicGroup,
  };
  // A self-contradicting row is NOT a validation error: it is well-formed
  // and must still run, be recorded and be reported. Only its scoring is
  // suspended.
  v2Case.oracleDefect = oracleDefect(v2Case) ?? undefined;
  return { v2Case };
}

// -------------------------------------------------------- canonical semantics

export function normaliseName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Person names tolerate a generational suffix and word-level containment
 * ("Gary Ablett Snr" vs "Gary Ablett"); club and venue names do not,
 * because containment is exactly the Sydney / Greater Western Sydney trap
 * -- those compare by id or exact normalised name only.
 */
export function samePersonName(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  const strip = (s: string) => normaliseName(s).replace(/(snr|sr|jnr|jr)$/, '');
  const left = strip(a);
  const right = strip(b);
  return left === right || left.includes(right) || right.includes(left);
}

/**
 * Name -> stable-id lookups, built by the runner from the very
 * directories the parser resolves against (plus a pre-resolved player
 * name memo). Ids are the semantic identity (spec: a cosmetic naming
 * difference must never fail a row whose entity is the same); names are
 * kept alongside purely for diff output.
 */
export type EntityLookup = {
  clubOrgId(name: string): number | undefined;
  venueId(name: string): number | undefined;
  playerId(name: string): number | undefined;
};

export type CanonicalEntity = { id?: number; name: string };

export type CanonicalSemantics = {
  grain: string;
  metric: string | null;
  mode?: 'single' | 'sum';
  agg: { kind: string; n?: number };
  player?: CanonicalEntity;
  clubFor?: CanonicalEntity;
  clubAgainst?: CanonicalEntity;
  venue?: CanonicalEntity;
  seasonMin?: number;
  seasonMax?: number;
  matchType?: string;
  /** Sorted "column|op|value" strings -- order carries no meaning. */
  careerConditions: string[];
  clubSeasonConditions: string[];
  boundary?: { event: string; where: string };
  tiePolicy: 'all' | 'first';
  /** Asserted only when the expectation names one. */
  limit?: number;
};

function conditionKey(c: { kind: string; column?: string; awardKey?: string; op: string; value: number }): string {
  return `${c.kind === 'award_count' ? (c.awardKey ?? '?') : (c.column ?? '?')}|${c.op}|${c.value}`;
}

export function canonicaliseExpected(sem: ExpectedSemantics, lookup: EntityLookup): CanonicalSemantics {
  const entity = (name: string | undefined, id: number | undefined): CanonicalEntity | undefined =>
    name === undefined ? undefined : { ...(id !== undefined ? { id } : {}), name };
  const scope = sem.scope ?? {};
  return {
    grain: sem.grain,
    metric: sem.metric ?? null,
    ...(sem.mode !== undefined ? { mode: sem.mode } : {}),
    agg: { kind: sem.agg?.kind ?? 'max', ...(sem.agg?.n !== undefined ? { n: sem.agg.n } : {}) },
    ...(sem.player !== undefined ? { player: entity(sem.player, lookup.playerId(sem.player)) } : {}),
    ...(scope.clubFor !== undefined ? { clubFor: entity(scope.clubFor, lookup.clubOrgId(scope.clubFor)) } : {}),
    ...(scope.clubAgainst !== undefined ? { clubAgainst: entity(scope.clubAgainst, lookup.clubOrgId(scope.clubAgainst)) } : {}),
    ...(scope.venue !== undefined ? { venue: entity(scope.venue, lookup.venueId(scope.venue)) } : {}),
    ...(scope.seasonMin !== undefined ? { seasonMin: Number(scope.seasonMin) } : {}),
    ...(scope.seasonMax !== undefined ? { seasonMax: Number(scope.seasonMax) } : {}),
    ...(scope.matchType !== undefined ? { matchType: scope.matchType } : {}),
    careerConditions: (sem.careerConditions ?? []).map(conditionKey).sort(),
    clubSeasonConditions: (sem.clubSeasonConditions ?? []).map((c) => c.kind).sort(),
    ...(sem.boundary ? { boundary: { event: sem.boundary.event, where: sem.boundary.where } } : {}),
    tiePolicy: sem.tiePolicy ?? 'all',
    ...(sem.limit !== undefined ? { limit: sem.limit } : {}),
  };
}

/**
 * The live plan -> the same canonical shape. Parser diagnostics
 * (confidence, consumed tokens, notes, entity certainty) are exactly what
 * this does NOT carry: they are not query semantics, and two plans that
 * ask the database the same question must hash identically whatever
 * their parses looked like. `limit` is dropped -- it is a display cap the
 * corpus never asserts.
 */
export function canonicalisePlan(plan: NlQueryPlan): CanonicalSemantics {
  return {
    grain: plan.grain,
    metric: plan.metric,
    ...(plan.mode !== undefined ? { mode: plan.mode } : {}),
    agg: { kind: plan.agg.kind, ...(plan.agg.kind === 'top_n' ? { n: plan.agg.n } : {}) },
    ...(plan.player ? { player: { id: plan.player.id, name: plan.player.name } } : {}),
    ...(plan.scope.clubFor ? { clubFor: { id: plan.scope.clubFor.organizationId, name: plan.scope.clubFor.name } } : {}),
    ...(plan.scope.clubAgainst ? { clubAgainst: { id: plan.scope.clubAgainst.organizationId, name: plan.scope.clubAgainst.name } } : {}),
    ...(plan.scope.venue ? { venue: { id: plan.scope.venue.id, name: plan.scope.venue.name } } : {}),
    ...(plan.scope.seasonMin !== undefined ? { seasonMin: plan.scope.seasonMin } : {}),
    ...(plan.scope.seasonMax !== undefined ? { seasonMax: plan.scope.seasonMax } : {}),
    ...(plan.scope.matchType !== undefined ? { matchType: plan.scope.matchType } : {}),
    careerConditions: plan.careerConditions.map((c) => conditionKey(
      c.kind === 'column'
        ? { kind: 'column', column: c.column, op: c.op, value: c.value }
        : { kind: 'award_count', awardKey: c.awardKey, op: c.op, value: c.value },
    )).sort(),
    clubSeasonConditions: plan.clubSeasonConditions.map((c) => c.kind).sort(),
    ...(plan.boundary ? { boundary: { event: plan.boundary.event, where: plan.boundary.where } } : {}),
    tiePolicy: plan.tiePolicy,
  };
}

function entityKey(e: CanonicalEntity | undefined): string {
  if (!e) return '';
  return e.id !== undefined ? `#${e.id}` : normaliseName(e.name);
}

/** A stable string identity for one canonical semantics -- what metamorphic grouping and hashing compare. */
export function semanticKey(c: CanonicalSemantics): string {
  return [
    c.grain, c.metric ?? '', c.mode ?? '', `${c.agg.kind}${c.agg.n !== undefined ? `:${c.agg.n}` : ''}`,
    entityKey(c.player), entityKey(c.clubFor), entityKey(c.clubAgainst), entityKey(c.venue),
    c.seasonMin ?? '', c.seasonMax ?? '', c.matchType ?? '',
    c.careerConditions.join(';'), c.clubSeasonConditions.join(';'),
    c.boundary ? `${c.boundary.event}@${c.boundary.where}` : '',
    c.tiePolicy, c.limit ?? '',
  ].join('|');
}

export function semanticHash(c: CanonicalSemantics): string {
  return createHash('sha1').update(semanticKey(c)).digest('hex').slice(0, 12);
}

// --------------------------------------------------------------- findings

export type V2FindingClass =
  | 'WRONG_GRAIN' | 'WRONG_METRIC' | 'WRONG_MODE' | 'WRONG_AGGREGATION'
  | 'WRONG_PLAYER' | 'WRONG_CLUB' | 'WRONG_OPPONENT' | 'WRONG_VENUE'
  | 'WRONG_SEASON_RANGE' | 'WRONG_MATCH_TYPE'
  | 'DROPPED_FILTER' | 'EXTRA_FILTER'
  | 'WRONG_BOUNDARY' | 'WRONG_TIE_POLICY' | 'WRONG_LIMIT' | 'SEMANTIC_MISMATCH'
  | 'WRONG_ANSWER' | 'MISSING_TIED_RESULT' | 'EXTRA_RESULT' | 'WRONG_VALUE'
  | 'UNEXPECTED_DECLINE' | 'UNSAFE_ANSWER' | 'WRONG_FAILURE_REASON'
  | 'METAMORPHIC_DIVERGENCE' | 'METAMORPHIC_STATUS_DIVERGENCE'
  | 'QUERY_TIMEOUT' | 'DATABASE_ERROR' | 'INTERNAL_ERROR';

export type V2Severity = 'hard' | 'soft';

export type V2Finding = {
  class: V2FindingClass;
  severity: V2Severity;
  /** The semantic field the finding is about, when there is one -- drives the object-level diff output. */
  field?: string;
  expected: string;
  actual: string;
};

function finding(
  cls: V2FindingClass, severity: V2Severity, expected: unknown, actual: unknown, field?: string,
): V2Finding {
  return {
    class: cls, severity,
    ...(field ? { field } : {}),
    expected: String(expected ?? '(absent)'),
    actual: String(actual ?? '(absent)'),
  };
}

function sameEntity(a: CanonicalEntity, b: CanonicalEntity, person: boolean): boolean {
  if (a.id !== undefined && b.id !== undefined) return a.id === b.id;
  return person ? samePersonName(a.name, b.name) : normaliseName(a.name) === normaliseName(b.name);
}

/**
 * The classified object-level diff between expected and actual canonical
 * semantics. Every applicable check runs; a plan wrong in two ways
 * reports both, and always as the specific class -- a WRONG_OPPONENT is
 * never reported as a generic mismatch.
 */
export function semanticFindings(expected: CanonicalSemantics, actual: CanonicalSemantics): V2Finding[] {
  const out: V2Finding[] = [];
  const severity: V2Severity = 'hard';

  if (expected.grain !== actual.grain) out.push(finding('WRONG_GRAIN', severity, expected.grain, actual.grain, 'grain'));
  if ((expected.metric ?? null) !== (actual.metric ?? null)) {
    out.push(finding('WRONG_METRIC', severity, expected.metric, actual.metric, 'metric'));
  }
  if ((expected.mode ?? '') !== (actual.mode ?? '')) {
    out.push(finding('WRONG_MODE', severity, expected.mode, actual.mode, 'mode'));
  }
  if (expected.agg.kind !== actual.agg.kind || (expected.agg.n ?? null) !== (actual.agg.n ?? null)) {
    const fmt = (a: { kind: string; n?: number }) => (a.n !== undefined ? `${a.kind} ${a.n}` : a.kind);
    out.push(finding('WRONG_AGGREGATION', severity, fmt(expected.agg), fmt(actual.agg), 'agg'));
  }

  const slots: { field: 'player' | 'clubFor' | 'clubAgainst' | 'venue'; cls: V2FindingClass; person: boolean }[] = [
    { field: 'player', cls: 'WRONG_PLAYER', person: true },
    { field: 'clubFor', cls: 'WRONG_CLUB', person: false },
    { field: 'clubAgainst', cls: 'WRONG_OPPONENT', person: false },
    { field: 'venue', cls: 'WRONG_VENUE', person: false },
  ];
  for (const slot of slots) {
    const want = expected[slot.field];
    const got = actual[slot.field];
    if (want && !got) out.push(finding('DROPPED_FILTER', severity, `${slot.field}=${want.name}`, undefined, slot.field));
    else if (!want && got) out.push(finding('EXTRA_FILTER', severity, undefined, `${slot.field}=${got.name}`, slot.field));
    else if (want && got && !sameEntity(want, got, slot.person)) {
      out.push(finding(slot.cls, severity, want.name, got.name, slot.field));
    }
  }

  if ((expected.seasonMin ?? null) !== (actual.seasonMin ?? null) || (expected.seasonMax ?? null) !== (actual.seasonMax ?? null)) {
    const fmt = (s: CanonicalSemantics) => `${s.seasonMin ?? 'open'}..${s.seasonMax ?? 'open'}`;
    const cls: V2FindingClass = (expected.seasonMin !== undefined || expected.seasonMax !== undefined)
      && actual.seasonMin === undefined && actual.seasonMax === undefined
      ? 'DROPPED_FILTER' : 'WRONG_SEASON_RANGE';
    out.push(finding(cls, severity, fmt(expected), fmt(actual), 'seasons'));
  }
  if ((expected.matchType ?? '') !== (actual.matchType ?? '')) {
    out.push(finding(
      expected.matchType !== undefined && actual.matchType === undefined ? 'DROPPED_FILTER' : 'WRONG_MATCH_TYPE',
      severity, expected.matchType, actual.matchType, 'matchType',
    ));
  }

  for (const [field, cls] of [['careerConditions', 'careerConditions'], ['clubSeasonConditions', 'clubSeasonConditions']] as const) {
    const want = new Set(expected[field]);
    const got = new Set(actual[field]);
    const missing = [...want].filter((k) => !got.has(k));
    const extra = [...got].filter((k) => !want.has(k));
    if (missing.length > 0) out.push(finding('DROPPED_FILTER', severity, missing.join('; '), [...got].join('; ') || undefined, cls));
    if (extra.length > 0) out.push(finding('EXTRA_FILTER', severity, [...want].join('; ') || undefined, extra.join('; '), cls));
  }

  const boundaryKey = (b?: { event: string; where: string }) => (b ? `${b.event}@${b.where}` : '');
  if (boundaryKey(expected.boundary) !== boundaryKey(actual.boundary)) {
    out.push(finding('WRONG_BOUNDARY', severity, boundaryKey(expected.boundary) || undefined, boundaryKey(actual.boundary) || undefined, 'boundary'));
  }
  if (expected.tiePolicy !== actual.tiePolicy) {
    out.push(finding('WRONG_TIE_POLICY', severity, expected.tiePolicy, actual.tiePolicy, 'tiePolicy'));
  }
  if (expected.limit !== undefined && actual.limit !== undefined && expected.limit !== actual.limit) {
    out.push(finding('WRONG_LIMIT', severity, expected.limit, actual.limit, 'limit'));
  }

  // No semanticKey catch-all here, deliberately: the field checks above
  // cover every field CanonicalSemantics has, while the keys can differ
  // representationally (an id on one side, a name-only fallback on the
  // other) for entities the field checks correctly matched. A key
  // comparison as insurance would turn that representation gap into a
  // phantom failure. SEMANTIC_MISMATCH stays in the class union for the
  // report's vocabulary, reserved for scorers that have no field-level
  // story to tell.
  return out;
}

// ------------------------------------------------------------ observations

/** What the engine actually did with one question -- the runner produces these. */
export type V2Observation = {
  status: 'plan' | 'decline' | 'error';
  /** For declines: the NlFailureReason the live pipeline would log. */
  failureReason?: string;
  confidence: number | null;
  canonical: CanonicalSemantics | null;
  unsupportedTerms: string[];
  parseMs: number;
  /** Answer oracle only. */
  execMs?: number;
  leadValue?: number | null;
  /** Every row sharing the lead value -- the tie set, by display name. */
  tieNames?: string[];
  total?: number | null;
  errorMessage?: string;
  errorCode?: string;
};

// ----------------------------------------------------------------- scoring

/**
 * Row-level scoring for every oracle except the group half of
 * metamorphic (scoreMetaGroup below). Metamorphic rows still pass
 * through here for their per-row expected-semantics comparison.
 */
export function scoreV2(v2Case: V2Case, actual: V2Observation, lookup: EntityLookup): V2Finding[] {
  if (actual.status === 'error') {
    const cls: V2FindingClass = actual.errorCode === '57014'
      ? 'QUERY_TIMEOUT'
      : actual.errorCode ? 'DATABASE_ERROR' : 'INTERNAL_ERROR';
    return [finding(cls, 'hard', v2Case.expectedStatus, actual.errorMessage ?? 'error')];
  }

  // ---- rows that must NOT answer ----------------------------------------
  if (v2Case.expectedStatus === 'decline') {
    if (actual.status === 'plan') {
      // The suite's most serious failure: adversarial or unanswerable
      // input turned into a confident answer.
      return [finding('UNSAFE_ANSWER', 'hard', `decline (${v2Case.expectedReason ?? 'any reason'})`, 'a confident plan')];
    }
    if (v2Case.expectedReason && actual.failureReason && actual.failureReason !== v2Case.expectedReason) {
      // Declined safely, for a differently-worded reason: the reader got
      // no wrong answer, so this is message quality, not safety.
      return [finding('WRONG_FAILURE_REASON', 'soft', v2Case.expectedReason, actual.failureReason)];
    }
    return [];
  }

  // ---- rows that must answer --------------------------------------------
  if (actual.status === 'decline') {
    // On a plan row this is conservatism (soft); on an answer row the
    // corpus explicitly expects the verified answer, so failing to
    // produce one is a hard failure of the suite's own gold set.
    const severity: V2Severity = v2Case.expectedStatus === 'answer' ? 'hard' : 'soft';
    return [finding(
      'UNEXPECTED_DECLINE', severity, v2Case.expectedStatus,
      `declined (${actual.failureReason ?? 'unknown'}${actual.unsupportedTerms.length ? `: ${actual.unsupportedTerms.join(', ')}` : ''})`,
    )];
  }

  const out: V2Finding[] = [];

  // Layer A -- semantics, whenever the corpus supplies them. Plan rows
  // always do; the current corpus's answer rows do not, and skipping an
  // absent layer is honest (scoring a missing expectation would
  // manufacture failures).
  if (v2Case.expectedSemantics && actual.canonical) {
    out.push(...semanticFindings(canonicaliseExpected(v2Case.expectedSemantics, lookup), actual.canonical));
  }

  // Layer B -- the football result, answer oracle only, scored
  // independently so a right number can never hide a wrong plan.
  if (v2Case.oracle === 'answer' && v2Case.expectedAnswer) {
    const expected = v2Case.expectedAnswer;
    if ((actual.total ?? 0) === 0) {
      out.push(finding('WRONG_ANSWER', 'hard', expected.names.join(' | ') || expected.value, 'no result'));
      return out;
    }
    if (expected.value !== undefined && actual.leadValue !== null && actual.leadValue !== undefined
      && actual.leadValue !== expected.value) {
      out.push(finding('WRONG_VALUE', 'hard', `${expected.value}${expected.unit ? ` ${expected.unit}` : ''}`, actual.leadValue));
    }
    if (expected.names.length > 0) {
      const tie = actual.tieNames ?? [];
      const missing = expected.names.filter((name) => !tie.some((t) => samePersonName(name, t)));
      const extra = tie.filter((t) => !expected.names.some((name) => samePersonName(name, t)));
      if (missing.length === expected.names.length) {
        // No overlap at all: not a tie-handling defect, the wrong answer.
        out.push(finding('WRONG_ANSWER', 'hard', expected.names.join(' | '), tie.join(' | ') || '(none)'));
      } else {
        // Partial overlap: the tie set itself is wrong. tiePolicy 'all'
        // means EVERY tied holder comes back -- the first name being
        // right is not a pass.
        if (missing.length > 0) out.push(finding('MISSING_TIED_RESULT', 'hard', expected.names.join(' | '), tie.join(' | ')));
        if (extra.length > 0) out.push(finding('EXTRA_RESULT', 'hard', expected.names.join(' | '), extra.join(' | ')));
      }
    }
  }

  return out;
}

// ------------------------------------------------------------- metamorphic

/**
 * Bounded per-group state: counts, and a capped set of representative
 * questions per distinct semantic hash. Groups reach 2,490 rows in this
 * corpus; the full forensic record is already in results.jsonl, so the
 * group state keeps only what the divergence report needs.
 */
export type MetaGroupState = {
  rows: number;
  planCount: number;
  declineCount: number;
  hashes: Map<string, { count: number; question: string; key: string }>;
  /** Distinct hashes beyond the representative cap -- still counted, just without a stored example. */
  hashOverflow: number;
  declineExample?: string;
  expectedHash?: string;
  expectedKey?: string;
};

const META_HASH_CAP = 8;

export function newMetaGroupState(): MetaGroupState {
  return { rows: 0, planCount: 0, declineCount: 0, hashes: new Map(), hashOverflow: 0 };
}

export function metaAccumulate(
  state: MetaGroupState,
  row: {
    status: 'plan' | 'decline' | 'error';
    hash?: string; key?: string; question: string;
    expectedHash?: string; expectedKey?: string;
  },
): void {
  state.rows++;
  if (row.expectedHash && state.expectedHash === undefined) {
    state.expectedHash = row.expectedHash;
    state.expectedKey = row.expectedKey;
  }
  if (row.status === 'plan' && row.hash) {
    state.planCount++;
    const entry = state.hashes.get(row.hash);
    if (entry) entry.count++;
    else if (state.hashes.size < META_HASH_CAP) state.hashes.set(row.hash, { count: 1, question: row.question, key: row.key ?? '' });
    else state.hashOverflow++;
  } else {
    state.declineCount++;
    if (!state.declineExample) state.declineExample = row.question;
  }
}

export type MetaGroupResult = {
  group: string;
  rows: number;
  consistent: boolean;
  findings: V2Finding[];
  distinctSemantics: number;
  planCount: number;
  declineCount: number;
  majority?: { hash: string; count: number; question: string; key: string };
  outliers: { hash: string; count: number; question: string; key: string }[];
  declineExample?: string;
};

/**
 * Group-level verdict once every member has been accumulated.
 *
 * Two confident plans that differ is the hard case -- the same question
 * got two different answers depending on phrasing. A mix of plan and
 * decline is softer: some phrasings were refused, none were answered
 * wrongly relative to the group. All-decline produces no group finding
 * at all (each row already carries its own UNEXPECTED_DECLINE), so a
 * vocabulary gap is not double-counted as a divergence too.
 *
 * The first row in a group is never assumed correct: majority/outlier is
 * decided by count, and the per-row expected-semantics comparison (every
 * metamorphic row also carries the group's expected semantics) is what
 * anchors the group to the truth rather than to itself.
 */
export function scoreMetaGroup(group: string, state: MetaGroupState): MetaGroupResult {
  const ranked = [...state.hashes.entries()]
    .map(([hash, entry]) => ({ hash, ...entry }))
    .sort((a, b) => b.count - a.count);
  const distinct = state.hashes.size + state.hashOverflow;
  const findings: V2Finding[] = [];

  if (distinct > 1) {
    findings.push(finding(
      'METAMORPHIC_DIVERGENCE', 'hard',
      `one interpretation across ${state.rows} phrasings`,
      `${distinct} distinct interpretations`,
    ));
  }
  if (state.planCount > 0 && state.declineCount > 0) {
    findings.push(finding(
      'METAMORPHIC_STATUS_DIVERGENCE', 'soft',
      'every phrasing answered',
      `${state.planCount} answered, ${state.declineCount} declined`,
    ));
  }

  return {
    group,
    rows: state.rows,
    consistent: findings.length === 0,
    findings,
    distinctSemantics: distinct,
    planCount: state.planCount,
    declineCount: state.declineCount,
    majority: ranked[0],
    outliers: ranked.slice(1),
    declineExample: state.declineExample,
  };
}

// ------------------------------------------------------------------- stats

/** One results.jsonl line -- the full forensic record, and the unit of replay for --resume. */
export type V2ResultRecord = {
  id: string;
  category: string;
  oracle: V2Oracle;
  question: string;
  expectedStatus: V2ExpectedStatus;
  expectedReason?: string;
  group?: string;
  expectedHash?: string;
  expectedKey?: string;
  actual: {
    status: 'plan' | 'decline' | 'error';
    failureReason?: string;
    confidence: number | null;
    hash?: string;
    key?: string;
    canonical?: CanonicalSemantics;
    unsupportedTerms: string[];
    parseMs: number;
    execMs?: number;
    leadValue?: number | null;
    tieNames?: string[];
    total?: number | null;
    errorMessage?: string;
  };
  findings: V2Finding[];
  severity: 'clean' | 'soft' | 'hard';
  /** Present when the row's expectation contradicts its own question. */
  oracleDefect?: string;
};

export function recordSeverity(findings: V2Finding[]): 'clean' | 'soft' | 'hard' {
  if (findings.some((f) => f.severity === 'hard')) return 'hard';
  if (findings.some((f) => f.severity === 'soft')) return 'soft';
  return 'clean';
}

type CategoryStats = {
  rows: number; hard: number; soft: number;
  semScored: number; semPass: number;
  ansScored: number; ansPass: number;
  declineScored: number; declinePass: number;
};

const LATENCY_CEILING_MS = 10_000;
const SAMPLES_PER_CLASS = 50;
const LEVERAGE_KEY_CAP = 8_000;
const UNSUPPORTED_TERM_CAP = 20_000;

/**
 * Everything the report needs, in bounded memory: counters, an
 * exact-to-the-millisecond latency histogram (one Int32Array slot per ms
 * up to 10s, an overflow list past it), capped failure samples, capped
 * leverage keys. Rows themselves are never retained -- results.jsonl is
 * the archive. Accumulation is commutative, so scores are deterministic
 * whatever order the concurrent pool finishes in.
 */
export class V2Stats {
  total = 0;
  clean = 0;
  soft = 0;
  hard = 0;
  errors = 0;

  byOracle = new Map<string, { rows: number; hard: number; soft: number }>();
  byCategory = new Map<string, CategoryStats>();
  byClass = new Map<string, number>();
  classSamples = new Map<string, { id: string; question: string; expected: string; actual: string }[]>();
  statusMatrix = new Map<string, number>();
  leverage = new Map<string, { count: number; example: string }>();
  leverageOverflow = 0;
  unsupportedTerms = new Map<string, { count: number; example: string }>();
  unsupportedOverflow = 0;

  private histFull = new Int32Array(LATENCY_CEILING_MS + 1);
  private histParse = new Int32Array(LATENCY_CEILING_MS + 1);
  private histExec = new Int32Array(LATENCY_CEILING_MS + 1);
  private slow: { id: string; ms: number; question: string }[] = [];
  maxMs = 0;
  private sumMs = 0;

  quarantined = 0;
  quarantineShapes = new Map<string, number>();
  quarantineSamples: { id: string; question: string; defect: string }[] = [];

  addRow(record: V2ResultRecord): void {
    // A row whose expectation contradicts its own question is scored by
    // nothing: not the totals, not the per-category rates, not the
    // failure classes, not the leverage table. It cannot be passed by a
    // correct parser, so counting it as a failure would make the suite
    // reward wrong parsing -- and counting it as a pass would hide the
    // generator bug. It is recorded and reported on its own instead.
    if (record.oracleDefect) {
      this.quarantined++;
      const shape = record.oracleDefect.replace(/\b\d+\b/g, 'N');
      this.quarantineShapes.set(shape, (this.quarantineShapes.get(shape) ?? 0) + 1);
      if (this.quarantineSamples.length < SAMPLES_PER_CLASS) {
        this.quarantineSamples.push({ id: record.id, question: record.question, defect: record.oracleDefect });
      }
      return;
    }

    this.total++;
    if (record.severity === 'clean') this.clean++;
    else if (record.severity === 'soft') this.soft++;
    else this.hard++;
    if (record.actual.status === 'error') this.errors++;

    const oracle = this.byOracle.get(record.oracle) ?? { rows: 0, hard: 0, soft: 0 };
    oracle.rows++;
    if (record.severity === 'hard') oracle.hard++;
    if (record.severity === 'soft') oracle.soft++;
    this.byOracle.set(record.oracle, oracle);

    const cat = this.byCategory.get(record.category) ?? {
      rows: 0, hard: 0, soft: 0, semScored: 0, semPass: 0, ansScored: 0, ansPass: 0, declineScored: 0, declinePass: 0,
    };
    cat.rows++;
    if (record.severity === 'hard') cat.hard++;
    if (record.severity === 'soft') cat.soft++;

    const semanticClasses = new Set([
      'WRONG_GRAIN', 'WRONG_METRIC', 'WRONG_MODE', 'WRONG_AGGREGATION', 'WRONG_PLAYER', 'WRONG_CLUB',
      'WRONG_OPPONENT', 'WRONG_VENUE', 'WRONG_SEASON_RANGE', 'WRONG_MATCH_TYPE', 'DROPPED_FILTER',
      'EXTRA_FILTER', 'WRONG_BOUNDARY', 'WRONG_TIE_POLICY', 'WRONG_LIMIT', 'SEMANTIC_MISMATCH',
    ]);
    const answerClasses = new Set(['WRONG_ANSWER', 'MISSING_TIED_RESULT', 'EXTRA_RESULT', 'WRONG_VALUE']);

    if (record.expectedStatus === 'plan' || (record.expectedStatus === 'answer' && record.expectedHash !== undefined)) {
      cat.semScored++;
      const semanticFail = record.findings.some((f) => semanticClasses.has(f.class))
        || (record.expectedStatus === 'plan' && record.actual.status !== 'plan');
      if (!semanticFail) cat.semPass++;
    }
    if (record.oracle === 'answer') {
      cat.ansScored++;
      const answerFail = record.findings.some((f) => answerClasses.has(f.class)) || record.actual.status !== 'plan';
      if (!answerFail) cat.ansPass++;
    }
    if (record.expectedStatus === 'decline') {
      cat.declineScored++;
      if (record.actual.status === 'decline') cat.declinePass++;
    }
    this.byCategory.set(record.category, cat);

    const matrixKey = `${record.expectedStatus}->${record.actual.status}`;
    this.statusMatrix.set(matrixKey, (this.statusMatrix.get(matrixKey) ?? 0) + 1);

    for (const f of record.findings) {
      this.byClass.set(f.class, (this.byClass.get(f.class) ?? 0) + 1);
      const samples = this.classSamples.get(f.class) ?? [];
      if (samples.length < SAMPLES_PER_CLASS) {
        samples.push({ id: record.id, question: record.question, expected: f.expected, actual: f.actual });
        this.classSamples.set(f.class, samples);
      }
      const leverageKey = `${f.class} | ${record.category} | ${f.expected} -> ${f.actual}`;
      const entry = this.leverage.get(leverageKey);
      if (entry) entry.count++;
      else if (this.leverage.size < LEVERAGE_KEY_CAP) this.leverage.set(leverageKey, { count: 1, example: record.question });
      else this.leverageOverflow++;
    }

    for (const term of record.actual.unsupportedTerms) {
      const entry = this.unsupportedTerms.get(term);
      if (entry) entry.count++;
      else if (this.unsupportedTerms.size < UNSUPPORTED_TERM_CAP) this.unsupportedTerms.set(term, { count: 1, example: record.question });
      else this.unsupportedOverflow++;
    }

    const fullMs = record.actual.parseMs + (record.actual.execMs ?? 0);
    this.histFull[Math.min(fullMs, LATENCY_CEILING_MS)]++;
    this.histParse[Math.min(record.actual.parseMs, LATENCY_CEILING_MS)]++;
    if (record.actual.execMs !== undefined) this.histExec[Math.min(record.actual.execMs, LATENCY_CEILING_MS)]++;
    this.sumMs += fullMs;
    if (fullMs > this.maxMs) this.maxMs = fullMs;
    if (fullMs > 3000) {
      this.slow.push({ id: record.id, ms: fullMs, question: record.question });
      this.slow.sort((a, b) => b.ms - a.ms);
      if (this.slow.length > 15) this.slow.length = 15;
    }
  }

  meanMs(): number {
    return this.total === 0 ? 0 : this.sumMs / this.total;
  }

  slowest(): readonly { id: string; ms: number; question: string }[] {
    return this.slow;
  }

  percentile(which: 'full' | 'parse' | 'exec', q: number): number {
    const hist = which === 'full' ? this.histFull : which === 'parse' ? this.histParse : this.histExec;
    let count = 0;
    for (const bucket of hist) count += bucket;
    if (count === 0) return 0;
    const target = Math.min(count - 1, Math.floor(count * q));
    let seen = 0;
    for (let ms = 0; ms < hist.length; ms++) {
      seen += hist[ms];
      if (seen > target) return ms;
    }
    return LATENCY_CEILING_MS;
  }
}
