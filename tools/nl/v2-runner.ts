/**
 * The V2 (250k) corpus runner: validation pass, streaming execution,
 * streaming JSONL output, metamorphic grouping, and the structured
 * output directory. All scoring rules live in v2.ts; this file is the
 * plumbing that feeds them.
 *
 * MEMORY DISCIPLINE
 *
 * The corpus is ~103 MB / 250,000 rows and the forensic results run to
 * hundreds of megabytes, so nothing here accumulates rows: the CSV is
 * streamed, each result is written to results.jsonl the moment it
 * exists (with backpressure honoured), and the only resident state is
 * V2Stats' bounded aggregates plus one small MetaGroupState per
 * metamorphic group.
 *
 * TWO PASSES
 *
 * Pass 1 validates the whole file (schema contract, JSON, id
 * uniqueness) and computes its SHA-256 before any query runs --
 * discovering a malformed row 4 hours into a 250k run is the failure
 * mode this buys out. It also collects the distinct expected entity
 * names so player resolution happens once per name, not once per row.
 * Pass 2 executes.
 */
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import type { WriteStream } from 'node:fs';

import { toCsv } from '@/lib/csv';

import type { StressEngine } from './engine';
import { normaliseKey, runPoolStream } from './engine';
import {
  canonicaliseExpected, canonicalisePlan, detectSchema, metaAccumulate, newMetaGroupState,
  recordSeverity, scoreMetaGroup, scoreV2, semanticHash, semanticKey, streamCsvRows, toV2Case,
  V2Stats,
  type EntityLookup, type MetaGroupResult, type MetaGroupState, type V2Case, type V2Observation,
  type V2ResultRecord,
} from './v2';

export type V2RunOptions = {
  corpusPath: string;
  outDir: string;
  concurrency: number;
  resume: boolean;
  database: string;
  /** Optional cap for pilots; 0 = whole corpus. */
  limit: number;
};

// ------------------------------------------------------------- validation

type ValidationSummary = {
  rows: number;
  byOracle: Map<string, number>;
  byCategory: Map<string, number>;
  byStatus: Map<string, number>;
  metamorphicGroups: number;
  malformed: string[];
  sha256: string;
  playerNames: Set<string>;
  clubNames: Set<string>;
  venueNames: Set<string>;
};

async function validateCorpus(path: string): Promise<ValidationSummary> {
  const hash = createHash('sha256');
  const summary: ValidationSummary = {
    rows: 0,
    byOracle: new Map(),
    byCategory: new Map(),
    byStatus: new Map(),
    metamorphicGroups: 0,
    malformed: [],
    sha256: '',
    playerNames: new Set(),
    clubNames: new Set(),
    venueNames: new Set(),
  };
  const ids = new Set<string>();
  const groups = new Set<string>();

  const stream = createReadStream(path);
  stream.on('data', (chunk) => hash.update(chunk));

  let header: string[] | null = null;
  for await (const row of streamCsvRows(stream)) {
    if (!header) {
      header = row;
      const schema = detectSchema(header);
      if (schema !== 'v2') throw new Error(`${path} does not look like a V2 corpus (schema: ${schema ?? 'unknown'}).`);
      continue;
    }
    if (row.length === 1 && row[0] === '') continue;
    const record: Record<string, string> = {};
    header.forEach((name, i) => { record[name] = row[i] ?? ''; });

    const { v2Case, error } = toV2Case(record);
    if (error) {
      if (summary.malformed.length < 20) summary.malformed.push(error);
      else if (summary.malformed.length === 20) summary.malformed.push('...');
      continue;
    }
    const c = v2Case!;
    summary.rows++;
    summary.byOracle.set(c.oracle, (summary.byOracle.get(c.oracle) ?? 0) + 1);
    summary.byCategory.set(c.category, (summary.byCategory.get(c.category) ?? 0) + 1);
    summary.byStatus.set(c.expectedStatus, (summary.byStatus.get(c.expectedStatus) ?? 0) + 1);
    if (ids.has(c.id)) {
      if (summary.malformed.length < 20) summary.malformed.push(`duplicate case_id ${c.id}`);
    }
    ids.add(c.id);
    if (c.metamorphicGroup) groups.add(c.metamorphicGroup);
    const sem = c.expectedSemantics;
    if (sem?.player) summary.playerNames.add(sem.player);
    if (sem?.scope?.clubFor) summary.clubNames.add(sem.scope.clubFor);
    if (sem?.scope?.clubAgainst) summary.clubNames.add(sem.scope.clubAgainst);
    if (sem?.scope?.venue) summary.venueNames.add(sem.scope.venue);
  }
  summary.metamorphicGroups = groups.size;
  summary.sha256 = hash.digest('hex');
  return summary;
}

// -------------------------------------------------------------- observation

/**
 * One question through the real pipeline, mirroring answerNlQuestion's
 * branch order exactly (the same discipline the V1 runner documents).
 * SQL runs only when `execute` is set -- which the caller sets only for
 * the answer oracle, because a plan row's correctness is its
 * interpretation: a valid plan over an empty scope must never fail for
 * returning zero rows.
 */
async function observe(
  question: string,
  engine: StressEngine,
  execute: boolean,
): Promise<V2Observation> {
  const parseStart = Date.now();
  try {
    const parsed = await engine.parseNlQuestion(question, engine.ctx);
    const report = parsed.report;
    const base = {
      confidence: report.confidence,
      unsupportedTerms: report.unsupportedTerms,
      canonical: null,
    };

    if (parsed.status === 'unanswerable') {
      return { status: 'decline', failureReason: 'unsupported_topic', parseMs: Date.now() - parseStart, ...base };
    }
    if (parsed.status === 'none') {
      const failureReason = report.ambiguousPlayer !== undefined
        ? 'ambiguous_player'
        : report.unsupportedTerms.length > 0
          ? 'unsupported_term'
          : parsed.reason === 'ambiguous' ? 'ambiguous_player' : parsed.reason;
      return { status: 'decline', failureReason, parseMs: Date.now() - parseStart, ...base };
    }

    const validated = engine.validatePlan(parsed.plan);
    if ('error' in validated) {
      return {
        status: 'decline', failureReason: 'coverage_unavailable',
        errorMessage: validated.error, parseMs: Date.now() - parseStart, ...base,
      };
    }

    const canonical = canonicalisePlan(validated);
    const parseMs = Date.now() - parseStart;
    if (!execute) {
      return { status: 'plan', canonical, confidence: report.confidence, unsupportedTerms: report.unsupportedTerms, parseMs };
    }

    const execStart = Date.now();
    const payload = await engine.executePlan(validated) as {
      kind: string; lead?: unknown; rows?: unknown[]; total?: number; value?: number;
    };
    const execMs = Date.now() - execStart;

    const rows = (payload.rows ?? []) as Record<string, unknown>[];
    const lead = payload.lead as Record<string, unknown> | null | undefined;
    const leadValue = typeof lead?.value === 'number' ? lead.value : null;
    const nameOf = (row: Record<string, unknown>) => [row.playerName, row.displayName, row.clubName]
      .find((n): n is string => typeof n === 'string') ?? '';
    const tieNames = leadValue === null
      ? rows.slice(0, 1).map(nameOf).filter(Boolean)
      : rows.filter((row) => row.value === leadValue).map(nameOf).filter(Boolean);

    return {
      status: 'plan', canonical,
      confidence: report.confidence, unsupportedTerms: report.unsupportedTerms,
      parseMs, execMs,
      leadValue,
      tieNames,
      total: payload.kind === 'count' ? 1 : (payload.total ?? rows.length),
    };
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : undefined;
    return {
      status: 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
      errorCode: code,
      confidence: null, canonical: null, unsupportedTerms: [],
      parseMs: Date.now() - parseStart,
    };
  }
}

// -------------------------------------------------------------- jsonl output

/** write() with backpressure honoured: when the buffer is full, wait for drain before the next row. */
async function writeLine(stream: WriteStream, line: string): Promise<void> {
  if (!stream.write(`${line}\n`)) await once(stream, 'drain');
}

function closeStream(stream: WriteStream): Promise<void> {
  return new Promise((resolve) => stream.end(resolve));
}

// ---------------------------------------------------------------- reporting

function pct(part: number, whole: number): string {
  return whole === 0 ? '—' : `${((part / whole) * 100).toFixed(2)}%`;
}

function table(header: string[], rows: (string | number)[][]): string {
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function md(value: unknown): string {
  return String(value ?? '').replace(/\|/g, '\\|');
}

function buildV2Report(
  stats: V2Stats,
  metaResults: MetaGroupResult[],
  runMeta: Record<string, unknown>,
): string {
  const out: string[] = [];
  out.push('# AFLDB natural-language qualification run (V2)');
  out.push('');
  out.push(Object.entries(runMeta).map(([k, v]) => `- **${k}**: ${v}`).join('\n'));
  out.push('');

  // ---- headline: the five quality dimensions, not one blended number.
  let semScored = 0; let semPass = 0; let ansScored = 0; let ansPass = 0;
  let declineScored = 0; let declinePass = 0;
  for (const cat of stats.byCategory.values()) {
    semScored += cat.semScored; semPass += cat.semPass;
    ansScored += cat.ansScored; ansPass += cat.ansPass;
    declineScored += cat.declineScored; declinePass += cat.declinePass;
  }
  const metaConsistent = metaResults.filter((g) => g.consistent).length;
  const unsafe = stats.byClass.get('UNSAFE_ANSWER') ?? 0;
  const wrongReason = stats.byClass.get('WRONG_FAILURE_REASON') ?? 0;

  out.push('## Headline');
  out.push('');
  out.push(table(['Dimension', 'Pass', 'Of', 'Rate'], [
    ['Semantic correctness (expected-plan rows interpreted exactly)', semPass, semScored, pct(semPass, semScored)],
    ['Answer correctness (verified football results)', ansPass, ansScored, pct(ansPass, ansScored)],
    ['Safe declines (adversarial/unanswerable rows refused)', declinePass, declineScored, pct(declinePass, declineScored)],
    ['Metamorphic consistency (groups with one interpretation)', metaConsistent, metaResults.length, pct(metaConsistent, metaResults.length)],
  ]));
  out.push('');
  out.push('**Safety:**');
  out.push('');
  out.push(table(['Outcome', 'Rows', 'Rate of corpus'], [
    ['**Confidently wrong** (hard failures: wrong interpretation, wrong verified answer, unsafe answer)', stats.hard, pct(stats.hard, stats.total)],
    ['Unsafe answers to expected-decline rows (subset of the above)', unsafe, pct(unsafe, stats.total)],
    ['Soft findings (declined an answerable row, wrong decline reason, status-divergent group)', stats.soft, pct(stats.soft, stats.total)],
    ['Wrong decline reason (subset of soft)', wrongReason, pct(wrongReason, stats.total)],
    ['Clean', stats.clean, pct(stats.clean, stats.total)],
  ]));
  out.push('');
  out.push(
    'The hierarchy, best to worst: correct answer > correct safe decline > wrong decline reason > '
    + 'unexpected decline > confidently wrong answer. A rising clean rate must never excuse a rising '
    + 'confidently-wrong count -- compare the absolute hard number between runs, not the percentage alone.',
  );
  out.push('');

  // ---- failure classes
  out.push('## Failure classes');
  out.push('');
  const classRows = [...stats.byClass.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cls, count]) => [cls, count, pct(count, stats.total)]);
  out.push(table(['Class', 'Rows', 'Share'], classRows));
  out.push('');

  // ---- examples per class, with the object-level diff
  out.push('## What each class looks like');
  out.push('');
  for (const [cls] of [...stats.byClass.entries()].sort((a, b) => b[1] - a[1])) {
    const samples = stats.classSamples.get(cls) ?? [];
    if (samples.length === 0) continue;
    out.push(`### ${cls} — ${stats.byClass.get(cls)} rows`);
    out.push('');
    out.push(table(
      ['Case', 'Question', 'Expected', 'Actual'],
      samples.slice(0, 6).map((s) => [s.id, md(s.question), md(s.expected), md(s.actual)]),
    ));
    out.push('');
  }

  // ---- metamorphic
  const divergent = metaResults.filter((g) => !g.consistent)
    .sort((a, b) => b.rows - a.rows);
  out.push('## Metamorphic groups');
  out.push('');
  out.push(`${metaConsistent} of ${metaResults.length} groups consistent. `
    + `${divergent.filter((g) => g.distinctSemantics > 1).length} groups diverge semantically; `
    + `${divergent.filter((g) => g.planCount > 0 && g.declineCount > 0).length} split between answering and declining.`);
  out.push('');
  for (const group of divergent.slice(0, 12)) {
    out.push(`### ${group.group} — ${group.rows} phrasings, ${group.distinctSemantics} interpretations`
      + `${group.declineCount > 0 ? `, ${group.declineCount} declined` : ''}`);
    out.push('');
    if (group.majority) {
      out.push(`- **Majority** (${group.majority.count}): \`${group.majority.key}\``);
      out.push(`  - e.g. "${md(group.majority.question)}"`);
    }
    for (const outlier of group.outliers.slice(0, 3)) {
      out.push(`- **Outlier** (${outlier.count}): \`${outlier.key}\``);
      out.push(`  - e.g. "${md(outlier.question)}"`);
    }
    if (group.declineExample) out.push(`- Declined phrasing: "${md(group.declineExample)}"`);
    out.push('');
  }

  // ---- by category
  out.push('## By corpus category');
  out.push('');
  const catRows = [...stats.byCategory.entries()]
    .sort((a, b) => b[1].hard - a[1].hard || b[1].soft - a[1].soft)
    .map(([name, c]) => [
      name, c.rows,
      c.semScored ? pct(c.semPass, c.semScored) : '—',
      c.ansScored ? pct(c.ansPass, c.ansScored) : '—',
      c.declineScored ? pct(c.declinePass, c.declineScored) : '—',
      c.soft, c.hard, pct(c.hard, c.rows),
    ]);
  out.push(table(['Category', 'Rows', 'Semantic', 'Answer', 'Decline', 'Soft', 'Hard', 'Hard rate'], catRows));
  out.push('');

  // ---- highest-leverage fixes
  out.push('## Highest-leverage fixes');
  out.push('');
  out.push('One line per (class, category, expected -> actual) cluster: fixing the rule behind it should clear every row counted.');
  out.push('');
  const leverageRows = [...stats.leverage.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 30)
    .map(([key, entry]) => {
      const [cls, category, detail] = key.split(' | ');
      return [entry.count, cls, category, md(detail), md(entry.example)];
    });
  out.push(table(['Rows', 'Class', 'Category', 'Expected -> actual', 'Example'], leverageRows));
  out.push('');

  // ---- status matrix
  out.push('## Expected vs actual status');
  out.push('');
  out.push(table(
    ['Expected -> actual', 'Rows'],
    [...stats.statusMatrix.entries()].sort((a, b) => b[1] - a[1]),
  ));
  out.push('');

  // ---- timing
  out.push('## Timing');
  out.push('');
  out.push(table(
    ['Path', 'p50', 'p90', 'p95', 'p99', 'p99.9', 'max', 'mean'],
    [
      ['Full (parse + any execution)',
        `${stats.percentile('full', 0.5)} ms`, `${stats.percentile('full', 0.9)} ms`,
        `${stats.percentile('full', 0.95)} ms`, `${stats.percentile('full', 0.99)} ms`,
        `${stats.percentile('full', 0.999)} ms`, `${stats.maxMs} ms`, `${stats.meanMs().toFixed(1)} ms`],
      ['Parser only',
        `${stats.percentile('parse', 0.5)} ms`, `${stats.percentile('parse', 0.9)} ms`,
        `${stats.percentile('parse', 0.95)} ms`, `${stats.percentile('parse', 0.99)} ms`,
        `${stats.percentile('parse', 0.999)} ms`, '—', '—'],
      ['Database execution (answer rows)',
        `${stats.percentile('exec', 0.5)} ms`, `${stats.percentile('exec', 0.9)} ms`,
        `${stats.percentile('exec', 0.95)} ms`, `${stats.percentile('exec', 0.99)} ms`,
        `${stats.percentile('exec', 0.999)} ms`, '—', '—'],
    ],
  ));
  out.push('');
  const slow = stats.slowest();
  if (slow.length > 0) {
    out.push('Slowest questions:');
    out.push('');
    out.push(table(['Case', 'ms', 'Question'], slow.map((s) => [s.id, s.ms, md(s.question)])));
    out.push('');
  }

  // ---- unsupported vocabulary
  if (stats.unsupportedTerms.size > 0) {
    out.push('## Words the parser recognised but could not act on');
    out.push('');
    out.push(table(
      ['Term', 'Questions'],
      [...stats.unsupportedTerms.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 40)
        .map(([term, entry]) => [md(term), entry.count]),
    ));
    out.push('');
  }

  return out.join('\n');
}

// --------------------------------------------------------------------- run

function gitSha(): string {
  try {
    return execSync('git rev-parse HEAD', { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch {
    return 'unknown';
  }
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export async function runV2(options: V2RunOptions, engine: StressEngine): Promise<void> {
  mkdirSync(options.outDir, { recursive: true });
  const resultsPath = join(options.outDir, 'results.jsonl');
  const runJsonPath = join(options.outDir, 'run.json');

  // ---- pass 1: validate, hash, inventory ---------------------------------
  process.stdout.write('Validating corpus...\n');
  const validation = await validateCorpus(options.corpusPath);
  if (validation.malformed.length > 0) {
    throw new Error(
      `Corpus failed validation -- refusing to run.\n  ${validation.malformed.join('\n  ')}`,
    );
  }
  const fmt = (m: Map<string, number>) => [...m.entries()].map(([k, v]) => `${v.toLocaleString('en-AU')} ${k}`).join(', ');
  process.stdout.write(
    `Corpus validated: ${validation.rows.toLocaleString('en-AU')} rows, 0 malformed\n`
    + `  by oracle: ${fmt(validation.byOracle)}\n`
    + `  by status: ${fmt(validation.byStatus)}\n`
    + `  metamorphic groups: ${validation.metamorphicGroups.toLocaleString('en-AU')}\n`
    + `  sha256: ${validation.sha256}\n`,
  );

  // ---- entity lookups ----------------------------------------------------
  // Player names resolve through the SAME resolver the parser uses, once
  // per distinct name; club/venue names through the parser's directories.
  // Ids are the comparison identity; an unresolvable name falls back to
  // name equality and is announced now, not discovered as phantom
  // failures later.
  const playerIds = new Map<string, number>();
  const unresolvable: string[] = [];
  for (const name of validation.playerNames) {
    const candidates = await engine.ctx.resolvePlayer(name);
    const top = candidates[0];
    if (top && top.score >= 500) playerIds.set(normaliseKey(name), top.ref.id);
    else unresolvable.push(`player: ${name}`);
  }
  for (const name of validation.clubNames) {
    if (engine.clubByName.get(normaliseKey(name)) === undefined) unresolvable.push(`club: ${name}`);
  }
  for (const name of validation.venueNames) {
    if (engine.venueByName.get(normaliseKey(name)) === undefined) unresolvable.push(`venue: ${name}`);
  }
  const lookup: EntityLookup = {
    clubOrgId: (name) => engine.clubByName.get(normaliseKey(name)),
    venueId: (name) => engine.venueByName.get(normaliseKey(name)),
    playerId: (name) => playerIds.get(normaliseKey(name)),
  };
  process.stdout.write(unresolvable.length === 0
    ? 'Every entity the corpus names resolves to a database identity.\n\n'
    : `WARNING: ${unresolvable.length} corpus names fall back to name-equality comparison:\n  ${unresolvable.join('\n  ')}\n\n`);

  // ---- run.json, written before the first query so an interrupted run
  // still says what it was.
  const startedAt = Date.now();
  const runMeta = {
    status: 'running',
    schema: 'v2',
    corpus: options.corpusPath,
    corpusSha256: validation.sha256,
    corpusRows: validation.rows,
    database: options.database,
    parserVersion: engine.PARSER_VERSION,
    gitCommit: gitSha(),
    concurrency: options.concurrency,
    resume: options.resume,
    node: process.version,
    host: hostname(),
    startedAt: new Date(startedAt).toISOString(),
  };
  writeFileSync(runJsonPath, `${JSON.stringify(runMeta, null, 2)}\n`, 'utf8');

  // ---- resume: replay already-completed rows into the aggregates --------
  const stats = new V2Stats();
  const metaGroups = new Map<string, MetaGroupState>();
  const done = new Set<string>();
  if (options.resume && existsSync(resultsPath)) {
    const replay = createInterface({ input: createReadStream(resultsPath) });
    for await (const line of replay) {
      if (!line.trim()) continue;
      const record = JSON.parse(line) as V2ResultRecord;
      if (done.has(record.id)) continue;
      done.add(record.id);
      stats.addRow(record);
      if (record.group) {
        const state = metaGroups.get(record.group) ?? newMetaGroupState();
        metaAccumulate(state, {
          status: record.actual.status, hash: record.actual.hash, key: record.actual.key,
          question: record.question, expectedHash: record.expectedHash, expectedKey: record.expectedKey,
        });
        metaGroups.set(record.group, state);
      }
    }
    process.stdout.write(`Resuming: ${done.size.toLocaleString('en-AU')} rows already complete.\n\n`);
  }

  // ---- pass 2: execute ---------------------------------------------------
  const results = createWriteStream(resultsPath, { flags: options.resume ? 'a' : 'w' });
  const failures = createWriteStream(join(options.outDir, 'failures.jsonl'), { flags: options.resume ? 'a' : 'w' });

  const source = (async function* rows(): AsyncGenerator<V2Case> {
    const stream = createReadStream(options.corpusPath);
    let header: string[] | null = null;
    let yielded = 0;
    for await (const row of streamCsvRows(stream)) {
      if (!header) { header = row; continue; }
      if (row.length === 1 && row[0] === '') continue;
      const record: Record<string, string> = {};
      header.forEach((name, i) => { record[name] = row[i] ?? ''; });
      const { v2Case } = toV2Case(record);
      if (!v2Case || done.has(v2Case.id)) continue;
      yield v2Case;
      yielded++;
      if (options.limit > 0 && yielded >= options.limit) return;
    }
  })();

  let completed = done.size;
  const target = options.limit > 0 ? Math.min(validation.rows, done.size + options.limit) : validation.rows;
  let lastReport = Date.now();

  try {
    await runPoolStream(source, async (v2Case) => {
      const execute = v2Case.oracle === 'answer';
      const observation = await observe(v2Case.question, engine, execute);

      const expectedCanonical = v2Case.expectedSemantics
        ? canonicaliseExpected(v2Case.expectedSemantics, lookup)
        : undefined;
      const findings = [...scoreV2(v2Case, observation, lookup)];

      const record: V2ResultRecord = {
        id: v2Case.id,
        category: v2Case.category,
        oracle: v2Case.oracle,
        question: v2Case.question,
        expectedStatus: v2Case.expectedStatus,
        ...(v2Case.expectedReason ? { expectedReason: v2Case.expectedReason } : {}),
        ...(v2Case.metamorphicGroup ? { group: v2Case.metamorphicGroup } : {}),
        ...(expectedCanonical ? { expectedHash: semanticHash(expectedCanonical), expectedKey: semanticKey(expectedCanonical) } : {}),
        actual: {
          status: observation.status,
          ...(observation.failureReason ? { failureReason: observation.failureReason } : {}),
          confidence: observation.confidence,
          ...(observation.canonical ? {
            hash: semanticHash(observation.canonical),
            key: semanticKey(observation.canonical),
            canonical: observation.canonical,
          } : {}),
          unsupportedTerms: observation.unsupportedTerms,
          parseMs: observation.parseMs,
          ...(observation.execMs !== undefined ? { execMs: observation.execMs } : {}),
          ...(observation.leadValue !== undefined ? { leadValue: observation.leadValue } : {}),
          ...(observation.tieNames !== undefined ? { tieNames: observation.tieNames } : {}),
          ...(observation.total !== undefined ? { total: observation.total } : {}),
          ...(observation.errorMessage ? { errorMessage: observation.errorMessage } : {}),
        },
        findings,
        severity: recordSeverity(findings),
      };

      await writeLine(results, JSON.stringify(record));
      if (record.severity !== 'clean') await writeLine(failures, JSON.stringify(record));

      stats.addRow(record);
      if (record.group) {
        const state = metaGroups.get(record.group) ?? newMetaGroupState();
        metaAccumulate(state, {
          status: record.actual.status, hash: record.actual.hash, key: record.actual.key,
          question: record.question, expectedHash: record.expectedHash, expectedKey: record.expectedKey,
        });
        metaGroups.set(record.group, state);
      }

      completed++;
      const now = Date.now();
      if (completed % 5000 === 0 || now - lastReport > 15_000) {
        lastReport = now;
        const elapsed = (now - startedAt) / 1000;
        const rate = (completed - done.size) / Math.max(elapsed, 0.001);
        process.stdout.write(
          `  ${completed.toLocaleString('en-AU')} / ${target.toLocaleString('en-AU')}  ${pct(completed, target)}  `
          + `${rate.toFixed(0)} q/s  hard=${stats.hard} soft=${stats.soft}  `
          + `p50=${stats.percentile('full', 0.5)}ms p95=${stats.percentile('full', 0.95)}ms p99=${stats.percentile('full', 0.99)}ms  `
          + `elapsed=${formatElapsed(now - startedAt)}\n`,
        );
      }
    }, options.concurrency);
  } finally {
    await Promise.all([closeStream(results), closeStream(failures)]);
  }

  // ---- metamorphic group scoring ----------------------------------------
  const metaResults: MetaGroupResult[] = [];
  const metaFailures = createWriteStream(join(options.outDir, 'metamorphic-failures.jsonl'));
  for (const [group, state] of metaGroups) {
    const result = scoreMetaGroup(group, state);
    metaResults.push(result);
    for (const f of result.findings) {
      stats.byClass.set(f.class, (stats.byClass.get(f.class) ?? 0) + 1);
    }
    if (!result.consistent) await writeLine(metaFailures, JSON.stringify(result));
  }
  await closeStream(metaFailures);

  // ---- outputs -----------------------------------------------------------
  const finishedAt = Date.now();
  const reportMeta = {
    corpus: options.corpusPath,
    corpusSha256: validation.sha256,
    database: options.database,
    parserVersion: engine.PARSER_VERSION,
    gitCommit: runMeta.gitCommit,
    concurrency: options.concurrency,
    ran: new Date(finishedAt).toISOString(),
    wallClock: formatElapsed(finishedAt - startedAt),
    rows: stats.total,
  };
  writeFileSync(join(options.outDir, 'report.md'), buildV2Report(stats, metaResults, reportMeta), 'utf8');

  writeFileSync(join(options.outDir, 'latency.json'), `${JSON.stringify({
    throughputPerSecond: stats.total / Math.max((finishedAt - startedAt) / 1000, 0.001),
    meanMs: stats.meanMs(),
    maxMs: stats.maxMs,
    percentiles: Object.fromEntries((['full', 'parse', 'exec'] as const).map((path) => [
      path,
      Object.fromEntries([0.5, 0.9, 0.95, 0.99, 0.999].map((q) => [`p${q * 100}`, stats.percentile(path, q)])),
    ])),
  }, null, 2)}\n`, 'utf8');

  const termRows = [...stats.unsupportedTerms.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([term, entry]) => ({ term, count: entry.count, example: entry.example }));
  writeFileSync(join(options.outDir, 'unsupported-terms.csv'), `﻿${toCsv(['term', 'count', 'example'], termRows)}`, 'utf8');

  let semScored = 0; let semPass = 0; let ansScored = 0; let ansPass = 0;
  let declineScored = 0; let declinePass = 0;
  for (const cat of stats.byCategory.values()) {
    semScored += cat.semScored; semPass += cat.semPass;
    ansScored += cat.ansScored; ansPass += cat.ansPass;
    declineScored += cat.declineScored; declinePass += cat.declinePass;
  }
  writeFileSync(runJsonPath, `${JSON.stringify({
    ...runMeta,
    status: 'complete',
    finishedAt: new Date(finishedAt).toISOString(),
    wallClockSeconds: Math.round((finishedAt - startedAt) / 1000),
    totals: {
      rows: stats.total, clean: stats.clean, soft: stats.soft, hard: stats.hard, errors: stats.errors,
      semantic: { pass: semPass, of: semScored },
      answer: { pass: ansPass, of: ansScored },
      decline: { pass: declinePass, of: declineScored },
      metamorphic: { consistent: metaResults.filter((g) => g.consistent).length, of: metaResults.length },
      unsafeAnswers: stats.byClass.get('UNSAFE_ANSWER') ?? 0,
      byClass: Object.fromEntries([...stats.byClass.entries()].sort((a, b) => b[1] - a[1])),
    },
  }, null, 2)}\n`, 'utf8');

  process.stdout.write(
    `\n${stats.total.toLocaleString('en-AU')} scored: ${stats.clean.toLocaleString('en-AU')} clean, `
    + `${stats.soft.toLocaleString('en-AU')} soft, ${stats.hard.toLocaleString('en-AU')} hard`
    + ` (${stats.byClass.get('UNSAFE_ANSWER') ?? 0} unsafe answers). `
    + `${metaResults.filter((g) => !g.consistent).length} of ${metaResults.length} metamorphic groups diverge.\n`
    + `Report: ${join(options.outDir, 'report.md')}\n`,
  );
}
