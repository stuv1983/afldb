#!/usr/bin/env tsx
/**
 * Natural-language search stress-test runner.
 *
 *   npx tsx tools/nl/stress-test.ts --corpus /path/to/stressTest.csv
 *
 * Feeds a corpus of natural-language questions through the real parsing
 * and execution pipeline, compares each result against the corpus's
 * expected interpretation, and writes a clustered report saying what
 * failed, how, and how often.
 *
 * WHY THIS DOES NOT GO THROUGH HTTP
 *
 * Asking /search 12,000 times would test the same pipeline but return
 * rendered HTML, from which the one thing that matters here -- the query
 * plan the parser built -- cannot be recovered. This calls the same
 * functions answerNlQuestion calls, in the same order, and keeps the plan
 * and the parse report instead of discarding them.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 *   It never calls logNlSearch. nl_search_log is the record of what real
 *   readers asked, and it drives vocabulary and confidence tuning; twelve
 *   thousand synthetic rows would drown that signal. Nothing here writes
 *   to any table -- the whole run is SELECTs through the read-only app
 *   role.
 *
 *   It never promotes an observed value into an expected one. Only the
 *   corpus's VERIFIED_RESULT rows carry factual answers, and they were
 *   checked by hand; everything else is scored on meaning alone.
 *
 * OPTIONS
 *
 *   --corpus <path>       CSV to run. Required (unless --report-only).
 *   --out <dir>           Output directory. Default ./nl-stress-out.
 *   --concurrency <n>     Questions in flight at once. Default 6.
 *   --limit <n>           Run only the first n rows.
 *   --sample <n>          Run n evenly spaced rows -- what a pilot wants,
 *                         since the corpus is generated template by
 *                         template and its first 400 rows are 330
 *                         variations on one question.
 *   --category <name>     Run only one corpus category. Repeatable.
 *   --parse-only          Skip SQL execution; score interpretation only.
 *                         Minutes instead of hours, and enough to find
 *                         every parser bug. Verified-fact rows are then
 *                         scored on their plan alone.
 *   --resume              Skip ids already present in results.jsonl.
 *   --report-only         Re-score and re-report an existing
 *                         results.jsonl without touching the database.
 *   --allow-any-database  Bypass the _dev/_test name guard. Needed only
 *                         to run against a database whose name does not
 *                         say it is safe to hammer.
 *
 * OUTPUT (in --out)
 *
 *   results.jsonl   one line per question: expectation, observation, findings
 *   report.md       the clustered summary to read first
 *   failures.csv    every failing row, for sorting in a spreadsheet
 *   summary.json    headline numbers, for comparing run to run
 */
import { createWriteStream } from 'node:fs';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toCsv } from '@/lib/csv';

import {
  readCorpus, scoreRow, verdict,
  type EntityIndex, type StressExpectation, type StressFinding, type StressFindingClass,
  type StressObservation,
} from './corpus';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ------------------------------------------------------------------ options

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function options(name: string): string[] {
  const values: string[] = [];
  process.argv.forEach((arg, index) => {
    if (arg === `--${name}` && process.argv[index + 1]) values.push(process.argv[index + 1]);
  });
  return values;
}

const OUT_DIR = option('out') ?? join(process.cwd(), 'nl-stress-out');
const CONCURRENCY = Math.max(1, Number(option('concurrency') ?? 6));
const ROW_LIMIT = Number(option('limit') ?? 0) || Infinity;
const SAMPLE_SIZE = Number(option('sample') ?? 0) || 0;
const CATEGORIES = new Set(options('category'));
const PARSE_ONLY = flag('parse-only');
const RESUME = flag('resume');
const REPORT_ONLY = flag('report-only');

// --------------------------------------------------------------------- env

/** Same loader tools/db/migrate.ts uses: an already-exported variable always wins. */
function loadEnv(): void {
  let contents: string;
  try {
    contents = readFileSync(join(PROJECT_ROOT, '.env'), 'utf8');
  } catch {
    return;
  }
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    const name = key.trim();
    if (!process.env[name]) process.env[name] = rest.join('=').trim();
  }
}

loadEnv();

/**
 * A 12,000-question run is sustained load. It must land on a database
 * whose name says it exists to be hammered, the same allowlist rule
 * tests/setup.ts applies -- refusing only a name that looks like
 * production would leave every other database acceptable by default.
 */
function guardDatabase(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Run this from the project root on a server with a .env, or export it.');
  }
  let database: string;
  try {
    database = new URL(url).pathname.replace(/^\//, '');
  } catch {
    throw new Error('DATABASE_URL is not a valid connection URL.');
  }
  if (!/_(dev|test)$/.test(database) && !flag('allow-any-database')) {
    throw new Error(
      `DATABASE_URL points at '${database}', which is not a _dev or _test database. `
      + 'Refusing to run twelve thousand queries against it. Pass --allow-any-database if that is genuinely what you want.',
    );
  }
  return database;
}

// ------------------------------------------------------------------ running

type RunRecord = {
  expected: StressExpectation;
  actual: StressObservation;
};

/**
 * One question end to end, mirroring answerNlQuestion's branches.
 *
 * Kept as a local copy of that orchestration rather than a call to it
 * because answerNlQuestion returns only the rendered answer: the plan,
 * the confidence and the parse report -- the three things being scored --
 * are internal to it. The branch order here is the same, and a change to
 * one that is not mirrored in the other would show up as a corpus-wide
 * shift in the next run.
 */
async function runQuestion(
  question: string,
  deps: Awaited<ReturnType<typeof loadEngine>>,
): Promise<StressObservation> {
  const startedAt = Date.now();
  const empty = {
    executed: false, confidence: null, plan: null, unsupportedTerms: [], coverageNote: null,
    leadName: null, leadValue: null, total: null, tieCount: null,
  };

  try {
    const parsed = await deps.parseNlQuestion(question, deps.ctx);
    const report = parsed.report;
    const base = {
      executed: false,
      confidence: report.confidence,
      unsupportedTerms: report.unsupportedTerms,
      coverageNote: null as string | null,
      leadName: null, leadValue: null, total: null, tieCount: null,
    };

    if (parsed.status === 'unanswerable') {
      return {
        status: 'decline', failureReason: 'unsupported_topic', plan: null,
        durationMs: Date.now() - startedAt, ...base,
      };
    }

    if (parsed.status === 'none') {
      const failureReason = report.unsupportedTerms.length > 0
        ? 'unsupported_term'
        : parsed.reason === 'ambiguous' ? 'ambiguous_player' : parsed.reason;
      return {
        status: 'decline', failureReason, plan: null,
        durationMs: Date.now() - startedAt, ...base,
      };
    }

    const validated = deps.validatePlan(parsed.plan);
    if ('error' in validated) {
      return {
        status: 'decline', failureReason: 'coverage_unavailable', plan: parsed.plan,
        errorMessage: validated.error, durationMs: Date.now() - startedAt, ...base,
      };
    }

    const coverageNote = validated.grain === 'player_game' && validated.metric === 'brownlow_votes'
      ? deps.BROWNLOW_GAME_VOTE_NOTE
      : validated.metric ? (deps.NL_COVERAGE[validated.metric]?.note ?? null) : null;

    if (PARSE_ONLY) {
      return { ...base, status: 'success', plan: validated, coverageNote, durationMs: Date.now() - startedAt };
    }

    const payload = await deps.executePlan(validated);
    const { leadName, leadValue, total, tieCount } = summarisePayload(payload);

    return {
      status: total === 0 ? 'no_results' : 'success',
      executed: true,
      plan: validated, coverageNote,
      confidence: report.confidence, unsupportedTerms: report.unsupportedTerms,
      leadName, leadValue, total, tieCount,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : undefined;
    return {
      status: 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
      errorCode: code,
      durationMs: Date.now() - startedAt,
      ...empty,
    };
  }
}

type AnyPayload = { kind: string; lead?: unknown; rows?: unknown[]; total?: number; value?: number };

function summarisePayload(payload: AnyPayload): {
  leadName: string | null; leadValue: number | null; total: number | null; tieCount: number | null;
} {
  if (payload.kind === 'count') {
    return { leadName: null, leadValue: payload.value ?? null, total: 1, tieCount: null };
  }
  if (payload.kind === 'unanswerable') {
    return { leadName: null, leadValue: null, total: 0, tieCount: null };
  }

  const lead = payload.lead as Record<string, unknown> | null | undefined;
  const rows = (payload.rows ?? []) as Record<string, unknown>[];
  const leadValue = typeof lead?.value === 'number' ? lead.value : null;
  // Every row payload names its subject differently; whichever of these
  // exists is the entity the answer is about.
  const leadName = [lead?.playerName, lead?.displayName, lead?.clubName]
    .find((name): name is string => typeof name === 'string') ?? null;

  return {
    leadName,
    leadValue,
    total: payload.total ?? rows.length,
    tieCount: leadValue === null ? null : rows.filter((row) => row.value === leadValue).length,
  };
}

/**
 * Imports the engine after the environment is settled.
 *
 * src/db/client.ts builds its pool at module evaluation time, so a static
 * import would run before loadEnv() and throw "DATABASE_URL is not set".
 * Player resolution is memoised on the way through: the corpus asks about
 * a few dozen players across twelve thousand questions, and the same
 * trigram search repeated ten thousand times is the single largest
 * avoidable cost in the run.
 */
async function loadEngine() {
  // Every query module is marked `server-only`, whose default export
  // throws to stop a Client Component importing database code. Node
  // resolves that package's harmless entry under the react-server
  // condition, which `npm run nl:stress` sets -- hence the reminder
  // rather than the package's own message, which would be baffling here.
  const loaded = await Promise.all([
    import('@/db/queries/nl/resolve'),
    import('@/db/queries/nl/execute'),
    import('@/search/nl/plan'),
    import('@/search/nl/parser'),
    import('@/db/client'),
  ]).catch((error: unknown) => {
    if (error instanceof Error && /Client Component/.test(error.message)) {
      throw new Error(
        'Run this through `npm run nl:stress -- <options>`, or add '
        + '--conditions=react-server to tsx. Without it Node resolves the '
        + 'server-only guard to the copy that throws.',
      );
    }
    throw error;
  });
  const [{ buildNlParseContext }, { executePlan }, plan, { parseNlQuestion }, { sql }] = loaded;

  const ctx = await buildNlParseContext();
  const memo = new Map<string, ReturnType<typeof ctx.resolvePlayer>>();
  const resolvePlayer = (name: string) => {
    const cached = memo.get(name);
    if (cached) return cached;
    const pending = ctx.resolvePlayer(name);
    memo.set(name, pending);
    return pending;
  };

  // The scoring layer compares club and venue identity, not names, and
  // gets both from the directories the parser itself resolves against --
  // so "GWS Giants" and "Greater Western Sydney" are one club here for
  // exactly the reason they are one club to the parser.
  const clubByName = new Map<string, number>();
  for (const club of ctx.clubs) {
    for (const name of [club.name, ...club.names]) clubByName.set(normaliseKey(name), club.organizationId);
  }
  const venueByName = new Map<string, number>();
  for (const venue of ctx.venues) {
    for (const name of [venue.name, ...venue.names]) venueByName.set(normaliseKey(name), venue.id);
  }
  const index: EntityIndex = {
    clubOrgId: (name) => clubByName.get(normaliseKey(name)),
    venueId: (name) => venueByName.get(normaliseKey(name)),
  };

  return {
    ctx: { ...ctx, resolvePlayer },
    index,
    clubKeys: Object.fromEntries(clubByName),
    venueKeys: Object.fromEntries(venueByName),
    parseNlQuestion,
    executePlan,
    validatePlan: plan.validatePlan,
    NL_COVERAGE: plan.NL_COVERAGE,
    BROWNLOW_GAME_VOTE_NOTE: plan.BROWNLOW_GAME_VOTE_NOTE,
    PARSER_VERSION: plan.PARSER_VERSION,
    sql,
  };
}

function normaliseKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Every club and venue the corpus names, checked against the directories
 * before the run starts.
 *
 * An unindexed name means the scoring falls back to comparing strings,
 * which is weaker; better to see that on line three of the log than to
 * discover it in the morning as several hundred phantom failures.
 */
function reportUnindexedEntities(rows: StressExpectation[], index: EntityIndex): void {
  const missing = new Set<string>();
  for (const row of rows) {
    for (const name of [row.club, row.opponent]) {
      if (name && index.clubOrgId(name) === undefined) missing.add(`club: ${name}`);
    }
    if (row.venue && index.venueId(row.venue) === undefined) missing.add(`venue: ${row.venue}`);
  }
  if (missing.size === 0) {
    process.stdout.write('Every club and venue the corpus names resolves to a database identity.\n');
    return;
  }
  process.stdout.write(
    `WARNING: ${missing.size} corpus entity names are unknown to the club/venue directories, `
    + `so those rows fall back to exact name matching:\n  ${[...missing].join('\n  ')}\n`,
  );
}

/**
 * An evenly spaced subset, for a pilot that is worth reading.
 *
 * The corpus is generated template by template, so its first 400 rows are
 * 330 variations on one question. Taking every nth row instead covers
 * every category and template in proportion, which is what makes a small
 * run predictive of the full one. Deterministic, so two pilots of the same
 * size are comparable.
 */
function spread<T>(items: T[], count: number): T[] {
  if (count >= items.length) return items;
  const stride = items.length / count;
  return Array.from({ length: count }, (_, i) => items[Math.floor(i * stride)]);
}

/** Fixed-size worker pool: `concurrency` questions in flight, next one started as each finishes. */
async function runPool(
  rows: StressExpectation[],
  worker: (row: StressExpectation) => Promise<void>,
  concurrency: number,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= rows.length) return;
      await worker(rows[index]);
    }
  });
  await Promise.all(runners);
}

// ---------------------------------------------------------------- reporting

type Scored = RunRecord & { findings: StressFinding[]; verdict: ReturnType<typeof verdict> };

function score(records: RunRecord[], index?: EntityIndex): Scored[] {
  return records.map((record) => {
    const findings = scoreRow(record.expected, record.actual, index);
    return { ...record, findings, verdict: verdict(findings) };
  });
}

/**
 * The name->id lookups are written beside the results so `--report-only`
 * can re-score without a database. Re-scoring an existing run is how a
 * mistake in the scoring rules gets corrected without spending another
 * night on the queries.
 */
function saveEntityIndex(clubs: Record<string, number>, venues: Record<string, number>): void {
  writeFileSync(join(OUT_DIR, 'entity-index.json'), `${JSON.stringify({ clubs, venues })}\n`, 'utf8');
}

function loadEntityIndex(): EntityIndex | undefined {
  const path = join(OUT_DIR, 'entity-index.json');
  if (!existsSync(path)) return undefined;
  const { clubs, venues } = JSON.parse(readFileSync(path, 'utf8')) as {
    clubs: Record<string, number>; venues: Record<string, number>;
  };
  return {
    clubOrgId: (name) => clubs[normaliseKey(name)],
    venueId: (name) => venues[normaliseKey(name)],
  };
}

/** The stable half of an equivalence group: "tm|Adelaide|Fremantle|margin|..." -> "tm". Every row generated from one template shares it, which is what turns a list of failures into "this one rule breaks 241 questions". */
function groupPrefix(group: string): string {
  return group.split('|')[0] || '(none)';
}

function pct(part: number, whole: number): string {
  return whole === 0 ? '0.0%' : `${((part / whole) * 100).toFixed(1)}%`;
}

function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}

function table(header: string[], rows: (string | number)[][]): string {
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ];
  return lines.join('\n');
}

function buildReport(scored: Scored[], meta: Record<string, string | number>): string {
  const total = scored.length;
  const passed = scored.filter((s) => s.verdict === 'pass').length;
  const softFailed = scored.filter((s) => s.verdict === 'soft_fail').length;
  const failed = scored.filter((s) => s.verdict === 'fail').length;
  const empty = scored.filter((s) => s.actual.status === 'no_results').length;

  const out: string[] = [];
  out.push('# AFLDB natural-language stress test');
  out.push('');
  out.push(Object.entries(meta).map(([k, v]) => `- **${k}**: ${v}`).join('\n'));
  out.push('');
  out.push('## Headline');
  out.push('');
  out.push(table(
    ['Outcome', 'Rows', 'Share'],
    [
      ['Clean pass', passed, pct(passed, total)],
      ['Passed with a soft finding (declined, or under-confident)', softFailed, pct(softFailed, total)],
      ['**Failed** (wrong interpretation or wrong verified fact)', failed, pct(failed, total)],
      ['Correct plan, zero rows (not scored)', empty, pct(empty, total)],
      ['Total', total, '100%'],
    ],
  ));
  out.push('');
  out.push(
    'A row fails only on a **hard** finding -- an interpretation that was confidently wrong. '
    + 'Declines and low confidence are soft: the reader gets no answer rather than a wrong one.',
  );
  out.push('');

  // ---- by failure class
  const allFindings = scored.flatMap((s) => s.findings.map((f) => ({ ...f, row: s })));
  const hard = allFindings.filter((f) => f.severity === 'hard');
  const soft = allFindings.filter((f) => f.severity === 'soft');

  out.push('## Failure classes, most rows first');
  out.push('');
  const byClass = new Map<StressFindingClass, typeof allFindings>();
  for (const f of [...hard, ...soft]) {
    if (!byClass.has(f.class)) byClass.set(f.class, []);
    byClass.get(f.class)!.push(f);
  }
  const classRows = [...byClass.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([cls, items]) => [
      cls,
      items[0].severity,
      items.length,
      pct(items.length, total),
      [...countBy(items, (i) => groupPrefix(i.row.expected.equivalenceGroup)).entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g, n]) => `${g} (${n})`).join(', '),
    ]);
  out.push(table(['Class', 'Severity', 'Rows', 'Share', 'Mostly from'], classRows));
  out.push('');

  // ---- worked examples per class
  out.push('## What each class looks like');
  out.push('');
  for (const [cls, items] of [...byClass.entries()].sort((a, b) => b[1].length - a[1].length)) {
    out.push(`### ${cls} — ${items.length} rows`);
    out.push('');
    const examples = items.slice(0, 6);
    out.push(table(
      ['#', 'Question', 'Expected', 'Actual'],
      examples.map((f) => [
        f.row.expected.id,
        f.row.expected.question.replace(/\|/g, '\\|'),
        f.expected.replace(/\|/g, '\\|'),
        f.actual.replace(/\|/g, '\\|'),
      ]),
    ));
    out.push('');
  }

  // ---- by category
  out.push('## By corpus category');
  out.push('');
  const categories = [...new Set(scored.map((s) => s.expected.category))].sort();
  out.push(table(
    ['Category', 'Rows', 'Clean', 'Soft', 'Fail', 'Clean rate', 'Nothing wrong reached the reader'],
    categories.map((category) => {
      const rows = scored.filter((s) => s.expected.category === category);
      const p = rows.filter((s) => s.verdict === 'pass').length;
      const sf = rows.filter((s) => s.verdict === 'soft_fail').length;
      const f = rows.filter((s) => s.verdict === 'fail').length;
      return [category, rows.length, p, sf, f, pct(p, rows.length), pct(p + sf, rows.length)];
    }),
  ));
  out.push('');

  // ---- highest-leverage fixes
  out.push('## Highest-leverage fixes');
  out.push('');
  out.push('Each line is one (class, template) pair: fixing the rule behind it should clear every row counted.');
  out.push('');
  const leverage = countBy(hard, (f) => `${f.class} ${groupPrefix(f.row.expected.equivalenceGroup)} ${f.expected} -> ${f.actual}`);
  const leverageRows = [...leverage.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([key, count]) => {
      const [cls, group, detail] = key.split(' ');
      return [count, cls, group, detail.replace(/\|/g, '\\|')];
    });
  out.push(table(['Rows', 'Class', 'Template', 'Expected -> actual'], leverageRows));
  out.push('');

  // ---- verified facts
  const verified = scored.filter((s) => s.expected.verificationLevel === 'VERIFIED_RESULT');
  if (verified.length > 0) {
    out.push('## Verified facts (the only rows with hand-checked answers)');
    out.push('');
    out.push(table(
      ['#', 'Question', 'Expected', 'Got', 'Verdict'],
      verified.map((s) => [
        s.expected.id,
        s.expected.question.replace(/\|/g, '\\|'),
        `${(s.expected.answerPrimary ?? []).join(' / ')} ${s.expected.answerValue ?? ''}`.trim() || '—',
        `${s.actual.leadName ?? '—'} ${s.actual.leadValue ?? ''}`.trim(),
        s.verdict,
      ]),
    ));
    out.push('');
  }

  // ---- timing
  const durations = scored.map((s) => s.actual.durationMs).sort((a, b) => a - b);
  if (durations.length > 0) {
    const at = (q: number) => durations[Math.min(durations.length - 1, Math.floor(durations.length * q))];
    out.push('## Timing');
    out.push('');
    out.push(table(
      ['p50', 'p90', 'p99', 'max'],
      [[`${at(0.5)} ms`, `${at(0.9)} ms`, `${at(0.99)} ms`, `${durations[durations.length - 1]} ms`]],
    ));
    out.push('');
    const slow = scored.filter((s) => s.actual.durationMs > 3000)
      .sort((a, b) => b.actual.durationMs - a.actual.durationMs).slice(0, 15);
    if (slow.length > 0) {
      out.push(`${scored.filter((s) => s.actual.durationMs > 3000).length} questions took over 3 seconds. Slowest:`);
      out.push('');
      out.push(table(
        ['#', 'ms', 'Question'],
        slow.map((s) => [s.expected.id, s.actual.durationMs, s.expected.question.replace(/\|/g, '\\|')]),
      ));
      out.push('');
    }
  }

  // ---- unsupported vocabulary
  const terms = countBy(
    scored.flatMap((s) => s.actual.unsupportedTerms),
    (term) => term,
  );
  if (terms.size > 0) {
    out.push('## Words the parser recognised but could not act on');
    out.push('');
    out.push(table(
      ['Term', 'Questions'],
      [...terms.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40),
    ));
    out.push('');
  }

  return out.join('\n');
}

function buildFailuresCsv(scored: Scored[]): string {
  const rows = scored
    .filter((s) => s.verdict !== 'pass')
    .map((s) => ({
      id: s.expected.id,
      verdict: s.verdict,
      category: s.expected.category,
      template: groupPrefix(s.expected.equivalenceGroup),
      question: s.expected.question,
      classes: s.findings.filter((f) => f.severity !== 'info').map((f) => f.class).join(' '),
      detail: s.findings.filter((f) => f.severity !== 'info').map((f) => `${f.class}: ${f.expected} -> ${f.actual}`).join(' | '),
      status: s.actual.status,
      confidence: s.actual.confidence ?? '',
      grain: s.actual.plan?.grain ?? '',
      metric: s.actual.plan?.metric ?? '',
      aggregation: s.actual.plan?.agg.kind ?? '',
      player: s.actual.plan?.player?.name ?? '',
      clubFor: s.actual.plan?.scope.clubFor?.name ?? '',
      clubAgainst: s.actual.plan?.scope.clubAgainst?.name ?? '',
      matchType: s.actual.plan?.scope.matchType ?? '',
      unsupportedTerms: s.actual.unsupportedTerms.join(' '),
      leadName: s.actual.leadName ?? '',
      leadValue: s.actual.leadValue ?? '',
      total: s.actual.total ?? '',
      durationMs: s.actual.durationMs,
      equivalenceGroup: s.expected.equivalenceGroup,
    }));

  return toCsv(
    ['id', 'verdict', 'category', 'template', 'question', 'classes', 'detail', 'status',
      'confidence', 'grain', 'metric', 'aggregation', 'player', 'clubFor', 'clubAgainst',
      'matchType', 'unsupportedTerms', 'leadName', 'leadValue', 'total', 'durationMs',
      'equivalenceGroup'],
    rows,
  );
}

function buildSummary(scored: Scored[], meta: Record<string, string | number>) {
  const total = scored.length;
  const byClass: Record<string, number> = {};
  for (const s of scored) {
    for (const f of s.findings) {
      if (f.severity === 'info') continue;
      byClass[f.class] = (byClass[f.class] ?? 0) + 1;
    }
  }
  return {
    ...meta,
    total,
    pass: scored.filter((s) => s.verdict === 'pass').length,
    softFail: scored.filter((s) => s.verdict === 'soft_fail').length,
    fail: scored.filter((s) => s.verdict === 'fail').length,
    noResults: scored.filter((s) => s.actual.status === 'no_results').length,
    errors: scored.filter((s) => s.actual.status === 'error').length,
    byClass,
  };
}

function writeOutputs(
  records: RunRecord[],
  meta: Record<string, string | number>,
  index?: EntityIndex,
): void {
  const scored = score(records, index);
  writeFileSync(join(OUT_DIR, 'report.md'), buildReport(scored, meta), 'utf8');
  writeFileSync(join(OUT_DIR, 'failures.csv'), `﻿${buildFailuresCsv(scored)}`, 'utf8');
  writeFileSync(join(OUT_DIR, 'summary.json'), `${JSON.stringify(buildSummary(scored, meta), null, 2)}\n`, 'utf8');

  const total = scored.length;
  const pass = scored.filter((s) => s.verdict === 'pass').length;
  const soft = scored.filter((s) => s.verdict === 'soft_fail').length;
  const fail = scored.filter((s) => s.verdict === 'fail').length;
  process.stdout.write(
    `\n${total} scored: ${pass} clean (${pct(pass, total)}), ${soft} soft, ${fail} failed (${pct(fail, total)}).\n`
    + `Report: ${join(OUT_DIR, 'report.md')}\n`,
  );
}

function readResults(path: string): RunRecord[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as RunRecord);
}

// -------------------------------------------------------------------- main

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const resultsPath = join(OUT_DIR, 'results.jsonl');

  if (REPORT_ONLY) {
    const records = readResults(resultsPath);
    if (records.length === 0) throw new Error(`No results to report on at ${resultsPath}.`);
    writeOutputs(records, { mode: 'report-only', rows: records.length }, loadEntityIndex());
    return;
  }

  const corpusPath = option('corpus');
  if (!corpusPath) throw new Error('--corpus <path to csv> is required.');

  const database = guardDatabase();
  const all = readCorpus(readFileSync(corpusPath, 'utf8'));
  if (all.length === 0) throw new Error(`No rows read from ${corpusPath}.`);

  const done = new Set(RESUME ? readResults(resultsPath).map((r) => r.expected.id) : []);
  const selected = all
    .filter((row) => CATEGORIES.size === 0 || CATEGORIES.has(row.category))
    .filter((row) => !done.has(row.id));
  const rows = SAMPLE_SIZE > 0
    ? spread(selected, SAMPLE_SIZE)
    : selected.slice(0, ROW_LIMIT === Infinity ? undefined : ROW_LIMIT);

  process.stdout.write(
    `Corpus: ${all.length} rows from ${corpusPath}\n`
    + `Running: ${rows.length}${done.size ? ` (${done.size} already done, resuming)` : ''}\n`
    + `Database: ${database}  concurrency: ${CONCURRENCY}  ${PARSE_ONLY ? 'parse only' : 'parse + execute'}\n\n`,
  );

  const engine = await loadEngine();
  reportUnindexedEntities(rows, engine.index);
  saveEntityIndex(engine.clubKeys, engine.venueKeys);
  process.stdout.write('\n');

  const stream = createWriteStream(resultsPath, { flags: RESUME ? 'a' : 'w' });
  const records: RunRecord[] = RESUME ? readResults(resultsPath) : [];

  const startedAt = Date.now();
  let completed = 0;

  await runPool(rows, async (expected) => {
    const actual = await runQuestion(expected.question, engine);
    const record: RunRecord = { expected, actual };
    records.push(record);
    stream.write(`${JSON.stringify(record)}\n`);

    completed++;
    if (completed % 200 === 0 || completed === rows.length) {
      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = completed / elapsed;
      const remaining = Math.round((rows.length - completed) / Math.max(rate, 0.001));
      process.stdout.write(
        `  ${completed}/${rows.length}  ${rate.toFixed(1)}/s  ~${Math.floor(remaining / 60)}m ${remaining % 60}s left\n`,
      );
    }
  }, CONCURRENCY);

  await new Promise<void>((resolve) => stream.end(resolve));

  writeOutputs(records, {
    corpus: corpusPath,
    database,
    mode: PARSE_ONLY ? 'parse only' : 'parse + execute',
    parserVersion: engine.PARSER_VERSION,
    concurrency: CONCURRENCY,
    ran: new Date().toISOString(),
    wallClockSeconds: Math.round((Date.now() - startedAt) / 1000),
  }, engine.index);

  await engine.sql.end();
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
