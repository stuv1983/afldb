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
};

/** V2 rows carry `id`; V1 rows carry `expected.id` and verdict names instead of severities. */
async function loadRun(dir: string): Promise<RunInfo> {
  const label: Record<string, unknown> = {};
  for (const name of ['run.json', 'summary.json']) {
    const path = join(dir, name);
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      for (const key of ['corpus', 'corpusSha256', 'database', 'parserVersion', 'gitCommit', 'mode', 'status', 'totals']) {
        if (parsed[key] !== undefined) label[key] = parsed[key];
      }
      break;
    }
  }

  const resultsPath = join(dir, 'results.jsonl');
  if (!existsSync(resultsPath)) throw new Error(`${dir} has no results.jsonl.`);

  const rows = new Map<string, RowState>();
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
      // V2 record.
      rows.set(String(record.id), {
        severity: record.severity,
        classes: (record.findings ?? []).map((f) => f.class).join(' '),
        question: record.question ?? '',
      });
    } else if (record.expected?.id !== undefined) {
      // V1 record: results.jsonl holds raw observations; severity is
      // derived from findings only when the line carries them (report-only
      // reruns) -- otherwise fall back to unknown-as-clean, which keeps
      // V1-to-V1 comparisons possible without re-scoring here.
      const findings = (record as { findings?: { class: string; severity: string }[] }).findings ?? [];
      const severity = findings.some((f) => f.severity === 'hard') ? 'hard'
        : findings.some((f) => f.severity === 'soft') ? 'soft' : 'clean';
      rows.set(String(record.expected.id), {
        severity,
        classes: findings.map((f) => f.class).join(' '),
        question: record.expected.question ?? '',
      });
    }
  }
  return { dir, label, rows };
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
  const movement = { fixedHard: [] as string[], newHard: [] as string[], fixedSoft: 0, newSoft: 0 };
  for (const id of shared) {
    const wasHard = a.rows.get(id)!.severity === 'hard';
    const isHard = b.rows.get(id)!.severity === 'hard';
    const wasSoft = a.rows.get(id)!.severity === 'soft';
    const isSoft = b.rows.get(id)!.severity === 'soft';
    if (wasHard && !isHard) movement.fixedHard.push(id);
    if (!wasHard && isHard) movement.newHard.push(id);
    if (wasSoft && !isSoft && !isHard) movement.fixedSoft++;
    if (!wasSoft && !wasHard && isSoft) movement.newSoft++;
  }

  out.push(`## Movement across ${shared.length.toLocaleString('en-AU')} shared rows`);
  out.push('');
  out.push(`- Hard failures fixed: **${movement.fixedHard.length}**`);
  out.push(`- Hard failures introduced: **${movement.newHard.length}**`);
  out.push(`- Soft findings cleared: ${movement.fixedSoft}`);
  out.push(`- Soft findings introduced: ${movement.newSoft}`);
  out.push('');

  if (movement.newHard.length > 0) {
    out.push('## REGRESSIONS — correct in A, wrong in B');
    out.push('');
    out.push('| Id | Question | B findings |');
    out.push('| --- | --- | --- |');
    for (const id of movement.newHard.slice(0, 40)) {
      const row = b.rows.get(id)!;
      out.push(`| ${id} | ${row.question.replace(/\|/g, '\\|')} | ${row.classes} |`);
    }
    if (movement.newHard.length > 40) out.push(`| ... | +${movement.newHard.length - 40} more | |`);
    out.push('');
  }

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
