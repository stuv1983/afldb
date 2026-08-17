#!/usr/bin/env tsx
/**
 * Compare two completed stress runs.
 *
 *   npm run nl:stress:compare -- <run-A-dir> <run-B-dir>
 *
 * A is the baseline, B the candidate. The headline numbers come from
 * each run's own metadata (run.json for V2, summary.json for V1); the
 * row-level movement comes from streaming both results.jsonl files and
 * joining on the row id.
 *
 * The one table that matters most is the regressions: rows that were
 * correct in A and wrong in B. An overall percentage can improve while
 * previously-correct answers break, and a comparison that only showed
 * the percentage would bless exactly that trade.
 *
 * Database-free: everything needed was written at run time.
 */
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

type RowState = {
  severity: 'clean' | 'soft' | 'hard';
  classes: string;
  question: string;
};

type RunInfo = {
  dir: string;
  label: Record<string, unknown>;
  rows: Map<string, RowState>;
  /**
   * True when every row's severity was actually read from the file rather
   * than assumed. A V1 results.jsonl written by a normal run holds raw
   * observations and no findings, so severity cannot be recovered from it
   * -- and the old fallback of scoring those rows `clean` made a 12,000-row
   * V1 run whose own summary.json said "11,212 clean, 788 soft" compare as
   * "100.00% clean, +0" against itself. A comparison that cannot see soft
   * findings must say so; printing a confident +0 invents a green signal,
   * which is worse than printing nothing at all.
   */
  scored: boolean;
};

/** V2 rows carry `id`; V1 rows carry `expected.id` and verdict names instead of severities. */
async function loadRun(dir: string): Promise<RunInfo> {
  const label: Record<string, unknown> = {};
  for (const name of ['run.json', 'summary.json']) {
    const path = join(dir, name);
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      for (const key of [
        'corpus', 'corpusSha256', 'database', 'parserVersion', 'gitCommit', 'mode', 'status', 'totals',
        // V1's summary.json spells its totals as flat fields.
        'total', 'pass', 'softFail', 'fail',
      ]) {
        if (parsed[key] !== undefined) label[key] = parsed[key];
      }
      break;
    }
  }

  const resultsPath = join(dir, 'results.jsonl');
  if (!existsSync(resultsPath)) throw new Error(`${dir} has no results.jsonl.`);

  const rows = new Map<string, RowState>();
  let unscoredRows = 0;
  const lines = createInterface({ input: createReadStream(resultsPath) });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const record = JSON.parse(line) as {
      id?: string; severity?: 'clean' | 'soft' | 'hard';
      findings?: { class: string; severity?: string }[];
      question?: string;
      expected?: { id?: number | string; question?: string };
      actual?: unknown;
    };
    if (record.id !== undefined && record.severity !== undefined) {
      // V2 record: severity is written at run time, always present.
      rows.set(String(record.id), {
        severity: record.severity,
        classes: (record.findings ?? []).map((f) => f.class).join(' '),
        question: record.question ?? '',
      });
    } else if (record.expected?.id !== undefined) {
      // V1 record. results.jsonl holds raw observations, and carries
      // findings only on a --report-only rerun. A line without them has an
      // UNKNOWN severity, which is counted here and reported rather than
      // quietly rounded down to clean.
      const findings = (record as { findings?: { class: string; severity: string }[] }).findings;
      if (findings === undefined) unscoredRows += 1;
      const severity = (findings ?? []).some((f) => f.severity === 'hard') ? 'hard'
        : (findings ?? []).some((f) => f.severity === 'soft') ? 'soft' : 'clean';
      rows.set(String(record.expected.id), {
        severity,
        classes: (findings ?? []).map((f) => f.class).join(' '),
        question: record.expected.question ?? '',
      });
    }
  }
  return { dir, label, rows, scored: unscoredRows === 0 };
}

function pct(part: number, whole: number): string {
  return whole === 0 ? '—' : `${((part / whole) * 100).toFixed(2)}%`;
}

async function main(): Promise<void> {
  const [dirA, dirB] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  if (!dirA || !dirB) throw new Error('Usage: npm run nl:stress:compare -- <baseline-dir> <candidate-dir>');

  const [a, b] = await Promise.all([loadRun(dirA), loadRun(dirB)]);

  const out: string[] = [];
  out.push('# Stress-run comparison');
  out.push('');
  out.push(`- **Baseline (A)**: ${dirA} — ${JSON.stringify(a.label.gitCommit ?? a.label.mode ?? '')} parser v${String(a.label.parserVersion ?? '?')}, ${a.rows.size.toLocaleString('en-AU')} rows`);
  out.push(`- **Candidate (B)**: ${dirB} — ${JSON.stringify(b.label.gitCommit ?? b.label.mode ?? '')} parser v${String(b.label.parserVersion ?? '?')}, ${b.rows.size.toLocaleString('en-AU')} rows`);
  out.push('');

  // Refuse to draw the severity table from severities that were never in
  // the file. summary.json's own totals are authoritative and are shown
  // instead, with the one command that makes a real comparison possible.
  const unscored = [a, b].filter((run) => !run.scored);
  if (unscored.length > 0) {
    out.push('## Comparison unavailable');
    out.push('');
    out.push(`${unscored.map((r) => r.dir).join(' and ')} ${unscored.length === 1 ? 'has' : 'have'} a \`results.jsonl\` without findings, so row severities cannot be recovered from it. That is what a normal V1 run writes; only \`--report-only\` adds findings.`);
    out.push('');
    out.push('Re-score first, then compare:');
    out.push('');
    out.push('```bash');
    for (const run of unscored) out.push(`npm run nl:stress -- --corpus <corpus> --out ${run.dir} --report-only`);
    out.push('```');
    out.push('');
    out.push('Each run\'s own authoritative totals, from `summary.json`/`run.json`:');
    out.push('');
    out.push('| | A | B |');
    out.push('| --- | --- | --- |');
    const totals = (run: RunInfo) => JSON.stringify(run.label.totals ?? {
      total: run.label.total, pass: run.label.pass, softFail: run.label.softFail, fail: run.label.fail,
    });
    out.push(`| totals | ${totals(a)} | ${totals(b)} |`);
    out.push('');
    process.stdout.write(`${out.join('\n')}\n`);
    return;
  }

  const count = (run: RunInfo, severity: RowState['severity']) =>
    [...run.rows.values()].filter((r) => r.severity === severity).length;
  out.push('| | A | B | Movement |');
  out.push('| --- | --- | --- | --- |');
  for (const severity of ['clean', 'soft', 'hard'] as const) {
    const ca = count(a, severity);
    const cb = count(b, severity);
    out.push(`| ${severity} | ${ca.toLocaleString('en-AU')} (${pct(ca, a.rows.size)}) | ${cb.toLocaleString('en-AU')} (${pct(cb, b.rows.size)}) | ${cb - ca >= 0 ? '+' : ''}${cb - ca} |`);
  }
  out.push('');

  // Row-level movement over the ids both runs contain.
  const shared = [...a.rows.keys()].filter((id) => b.rows.has(id));
  const movement = {
    fixedHard: [] as string[],
    cleanToHard: [] as string[],
    softToHard: [] as string[],
    fixedSoft: 0,
    newSoft: 0,
  };
  for (const id of shared) {
    const was = a.rows.get(id)!.severity;
    const is = b.rows.get(id)!.severity;
    if (was === 'hard' && is !== 'hard') movement.fixedHard.push(id);
    if (was === 'clean' && is === 'hard') movement.cleanToHard.push(id);
    if (was === 'soft' && is === 'hard') movement.softToHard.push(id);
    if (was === 'soft' && is === 'clean') movement.fixedSoft++;
    if (was === 'clean' && is === 'soft') movement.newSoft++;
  }

  out.push(`## Movement across ${shared.length.toLocaleString('en-AU')} shared rows`);
  out.push('');
  out.push(`- Hard failures fixed: **${movement.fixedHard.length}**`);
  out.push(`- **Regressions (clean -> hard): ${movement.cleanToHard.length}**`);
  out.push(`- Declines that became wrong answers (soft -> hard): ${movement.softToHard.length}`);
  out.push(`- Soft findings cleared: ${movement.fixedSoft}`);
  out.push(`- Soft findings introduced: ${movement.newSoft}`);
  out.push('');

  // These two were one table headed "correct in A, wrong in B", which was
  // false of half its rows: a soft finding is a DECLINE, not a correct
  // answer, so pooling the two hid the distinction that matters most when
  // a fix unblocks questions in bulk. clean -> hard means the change broke
  // something that worked. soft -> hard means it unmasked a bug that was
  // already there, behind a refusal -- bad for a reader either way, but a
  // completely different thing to have caused.
  const table = (ids: string[], heading: string, gloss: string, limit: number) => {
    if (ids.length === 0) return;
    out.push(`## ${heading}`);
    out.push('');
    out.push(gloss);
    out.push('');
    out.push('| Id | Question | B findings |');
    out.push('| --- | --- | --- |');
    for (const id of ids.slice(0, limit)) {
      const row = b.rows.get(id)!;
      out.push(`| ${id} | ${row.question.replace(/\|/g, '\\|')} | ${row.classes} |`);
    }
    if (ids.length > limit) out.push(`| ... | +${ids.length - limit} more | |`);
    out.push('');
  };

  table(
    movement.cleanToHard,
    'REGRESSIONS — correct in A, wrong in B',
    'Rows the candidate broke. Nothing else in this report outranks these.',
    40,
  );
  table(
    movement.softToHard,
    'UNMASKED — declined in A, wrong in B',
    'Previously refused, now answered wrongly. Not caused by the candidate, but newly reaching readers, so they count against the absolute hard total just the same.',
    20,
  );

  if (movement.fixedHard.length > 0) {
    out.push('## Fixed since A');
    out.push('');
    out.push('| Id | Question | Was |');
    out.push('| --- | --- | --- |');
    for (const id of movement.fixedHard.slice(0, 20)) {
      const row = a.rows.get(id)!;
      out.push(`| ${id} | ${row.question.replace(/\|/g, '\\|')} | ${row.classes} |`);
    }
    if (movement.fixedHard.length > 20) out.push(`| ... | +${movement.fixedHard.length - 20} more | |`);
    out.push('');
  }

  // Latency movement, when both runs recorded it.
  const latency = (dir: string) => {
    const path = join(dir, 'latency.json');
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as {
      throughputPerSecond: number; percentiles: { full: Record<string, number> };
    } : null;
  };
  const latA = latency(dirA);
  const latB = latency(dirB);
  if (latA && latB) {
    out.push('## Latency');
    out.push('');
    out.push('| | A | B |');
    out.push('| --- | --- | --- |');
    out.push(`| throughput | ${latA.throughputPerSecond.toFixed(0)} q/s | ${latB.throughputPerSecond.toFixed(0)} q/s |`);
    for (const p of ['p50', 'p95', 'p99'] as const) {
      out.push(`| ${p} | ${latA.percentiles.full[p]} ms | ${latB.percentiles.full[p]} ms |`);
    }
    out.push('');
  }

  process.stdout.write(`${out.join('\n')}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
