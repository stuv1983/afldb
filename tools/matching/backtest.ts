/**
 * Player-link matching backtest.
 *
 * Confirmed links are the only ground truth AFLDB has, so the model is
 * measured by pretending each one is unresolved and asking whether it
 * would have been found again. The known player_id is read into
 * expectedPlayerId and never reaches candidate generation or scoring --
 * those take SourceEvidence, which has no field to carry it.
 *
 * Nothing here writes. It opens a read-only connection, refuses the
 * import URL outright, and every statement is a SELECT.
 *
 *   npx tsx tools/matching/backtest.ts [--table award_winners] [--limit 500]
 *                                      [--out report.json]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import {
  assessSources,
  fetchSourceEvidence,
  type SourceEvidenceRow,
} from '@/db/queries/player-match-candidates';
import { isLinkTargetTable, type LinkTargetTable } from '@/db/queries/player-links';
import { ALGORITHM_VERSION, MATCH_POLICY } from '@/lib/player-matching/confidence';
import { resolutionKey, type ConfidenceBand, type MatchAssessment } from '@/lib/player-matching/types';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

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

/**
 * A read-only connection, or nothing.
 *
 * AFLDB_IMPORT_DATABASE_URL is deliberately not consulted: a
 * measurement run has no business holding a handle that could write.
 */
function backtestUrl(): string {
  const url =
    process.env.AFLDB_MATCH_BACKTEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'Set AFLDB_MATCH_BACKTEST_DATABASE_URL (preferred) or DATABASE_URL to a read-only role.',
    );
  }
  return url;
}

function valueFor(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function gitCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

type CaseResult = {
  key: string;
  /**
   * The LOGICAL source type. Draft rows report 'draft_person', not
   * 'draft_picks': one person owning four picks is one decision, and
   * counting it four times would inflate both the population and the
   * apparent precision of the draft class.
   */
  sourceType: string;
  targetTable: LinkTargetTable;
  targetId: number;
  rawName: string;
  context: string;
  expectedPlayerId: number;
  chosenPlayerId: number | null;
  chosenName: string | null;
  correct: boolean;
  /** 1-based rank of the true player, or null when blocking missed it. */
  rank: number | null;
  candidateCount: number;
  score: number | null;
  gap: number | null;
  band: ConfidenceBand;
  ambiguous: boolean;
  hardConflict: boolean;
  bulkEligible: boolean;
  /** Why the top candidate was contradicted, if it was. */
  conflictReasons: string[];
  /** Which signals paid, for calibration. */
  signals: string[];
};

function toCaseResult(row: SourceEvidenceRow, assessment: MatchAssessment): CaseResult {
  const ranked = assessment.best
    ? [assessment.best, ...assessment.alternatives]
    : [];
  const index = ranked.findIndex((c) => c.playerId === row.knownPlayerId);
  return {
    key: resolutionKey(row.source.target),
    sourceType: row.source.target.resolutionEntityType,
    targetTable: row.source.target.targetTable,
    targetId: row.source.target.targetId,
    rawName: row.source.rawName,
    context: row.source.context,
    expectedPlayerId: row.knownPlayerId!,
    chosenPlayerId: assessment.best?.playerId ?? null,
    chosenName: assessment.best?.displayName ?? null,
    correct: assessment.best?.playerId === row.knownPlayerId,
    rank: index >= 0 ? index + 1 : null,
    candidateCount: ranked.length,
    score: assessment.best?.score ?? null,
    gap: assessment.gap,
    band: assessment.band,
    ambiguous: assessment.ambiguous,
    hardConflict: assessment.hardConflict,
    bulkEligible: assessment.bulkEligible,
    conflictReasons: (assessment.best?.conflicts ?? []).map((c) => c.reason),
    signals: (assessment.best?.evidence ?? []).map((e) => e.signal),
  };
}

function pct(part: number, whole: number): string {
  if (whole === 0) return 'n/a';
  return `${((part / whole) * 100).toFixed(2)}%`;
}

const BANDS: ConfidenceBand[] = ['very_high', 'high', 'medium', 'low', 'none'];

function report(cases: CaseResult[]): void {
  const total = cases.length;
  const withCandidates = cases.filter((c) => c.candidateCount > 0);
  const recalled = cases.filter((c) => c.rank !== null);

  console.log('');
  console.log('=== POPULATION ===');
  console.log(`ground-truth rows tested        ${total}`);
  console.log(`no candidate generated          ${total - withCandidates.length}`);
  console.log(
    `candidate-generation recall     ${recalled.length}/${total} (${pct(recalled.length, total)})`,
  );
  console.log(
    `true player missing from set    ${total - recalled.length}`,
  );

  const topN = (n: number) => cases.filter((c) => c.rank !== null && c.rank <= n).length;
  console.log('');
  console.log('=== ACCURACY ===');
  console.log(`Top-1  ${topN(1)}/${total} (${pct(topN(1), total)})`);
  console.log(`Top-3  ${topN(3)}/${total} (${pct(topN(3), total)})`);
  console.log(`Top-5  ${topN(5)}/${total} (${pct(topN(5), total)})`);

  console.log('');
  console.log('=== BY BAND (precision = correct / suggested at that band) ===');
  for (const band of BANDS) {
    const inBand = cases.filter((c) => c.band === band);
    const correct = inBand.filter((c) => c.correct).length;
    console.log(
      `${band.padEnd(10)} n=${String(inBand.length).padStart(5)}  `
      + `correct=${String(correct).padStart(5)}  `
      + `precision=${pct(correct, inBand.length).padStart(7)}  `
      + `recall=${pct(correct, total).padStart(7)}`,
    );
  }

  const bulk = cases.filter((c) => c.bulkEligible);
  const bulkCorrect = bulk.filter((c) => c.correct).length;
  console.log('');
  console.log('=== BULK ELIGIBILITY ===');
  console.log(
    `bulk-eligible n=${bulk.length}  correct=${bulkCorrect}  `
    + `precision=${pct(bulkCorrect, bulk.length)}  false positives=${bulk.length - bulkCorrect}`,
  );

  console.log('');
  console.log('=== FLAGS ===');
  console.log(`ambiguous        ${cases.filter((c) => c.ambiguous).length}`);
  console.log(`hard conflict    ${cases.filter((c) => c.hardConflict).length}`);
  console.log(
    `uniqueness collisions (subset of hard conflicts) reported per-candidate in dossiers`,
  );

  console.log('');
  console.log('=== SCORE DISTRIBUTION (top candidate: correct vs wrong) ===');
  const edges = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 101];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const lo = edges[i];
    const hi = edges[i + 1];
    const inRange = cases.filter((c) => c.score !== null && c.score >= lo && c.score < hi);
    if (inRange.length === 0) continue;
    const wrong = inRange.filter((c) => !c.correct).length;
    console.log(
      `${String(lo).padStart(3)}-${String(hi - 1).padEnd(3)} n=${String(inRange.length).padStart(5)}  `
      + `correct=${String(inRange.length - wrong).padStart(5)}  wrong=${String(wrong).padStart(4)}  `
      + `precision=${pct(inRange.length - wrong, inRange.length)}`,
    );
  }

  console.log('');
  console.log('=== HARD CONFLICTS ON KNOWN-CORRECT LINKS (false contradictions) ===');
  const reasons = new Map<string, { total: number; onCorrect: number }>();
  for (const c of cases) {
    for (const reason of new Set(c.conflictReasons)) {
      const entry = reasons.get(reason) ?? { total: 0, onCorrect: 0 };
      entry.total += 1;
      if (c.correct) entry.onCorrect += 1;
      reasons.set(reason, entry);
    }
  }
  for (const [reason, entry] of [...reasons.entries()].sort((a, b) => b[1].total - a[1].total)) {
    console.log(
      `${reason.padEnd(28)} fired=${String(entry.total).padStart(5)}  `
      + `on the CORRECT player=${String(entry.onCorrect).padStart(5)}`,
    );
  }

  console.log('');
  console.log('=== SIGNAL FREQUENCY (top candidate) ===');
  const signals = new Map<string, number>();
  for (const c of cases) {
    for (const signal of c.signals) signals.set(signal, (signals.get(signal) ?? 0) + 1);
  }
  for (const [signal, count] of [...signals.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${signal.padEnd(28)} ${count}`);
  }

  console.log('');
  console.log('=== WRONG TOP-1 CASES ===');
  for (const c of cases.filter((x) => !x.correct && x.chosenPlayerId !== null).slice(0, 20)) {
    console.log(
      `  ${c.targetTable}#${c.targetId} "${c.rawName}" (${c.context}) `
      + `chose ${c.chosenName} #${c.chosenPlayerId} score=${c.score} gap=${c.gap} `
      + `band=${c.band} expected=#${c.expectedPlayerId} rank=${c.rank ?? 'absent'}`,
    );
  }

  console.log('');
  console.log('=== SCORE GAP DISTRIBUTION (top candidate) ===');
  const buckets: Array<[string, (g: number | null) => boolean]> = [
    ['alone (no rival)', (g) => g === null],
    ['0', (g) => g === 0],
    ['1-4', (g) => g !== null && g >= 1 && g <= 4],
    ['5-9', (g) => g !== null && g >= 5 && g <= 9],
    ['10-19', (g) => g !== null && g >= 10 && g <= 19],
    ['20+', (g) => g !== null && g >= 20],
  ];
  for (const [label, test] of buckets) {
    console.log(`${label.padEnd(18)} ${cases.filter((c) => test(c.gap)).length}`);
  }

  console.log('');
  console.log('=== BY LOGICAL SOURCE TYPE ===');
  console.log(
    'Aggregate precision hides which source class carries the risk, and bulk',
  );
  console.log(
    'eligibility is decided per class from these numbers -- never from the total.',
  );
  console.log('');
  const header = [
    'source'.padEnd(21),
    'n'.padStart(6),
    'recall'.padStart(8),
    'top1'.padStart(8),
    'vhigh'.padStart(6),
    'vh prec'.padStart(9),
    'vh FP'.padStart(6),
    'bulk'.padStart(6),
    'bulk prec'.padStart(10),
    'bulk FP'.padStart(8),
    'conflict'.padStart(9),
  ].join(' ');
  console.log(header);
  console.log('-'.repeat(header.length));

  const sourceTypes = [...new Set(cases.map((c) => c.sourceType))].sort();
  for (const sourceType of sourceTypes) {
    const rows = cases.filter((c) => c.sourceType === sourceType);
    const recalled = rows.filter((c) => c.rank !== null).length;
    const top1 = rows.filter((c) => c.correct).length;
    const veryHigh = rows.filter((c) => c.band === 'very_high');
    const vhCorrect = veryHigh.filter((c) => c.correct).length;
    const bulk = rows.filter((c) => c.bulkEligible);
    const bulkCorrect = bulk.filter((c) => c.correct).length;
    console.log([
      sourceType.padEnd(21),
      String(rows.length).padStart(6),
      pct(recalled, rows.length).padStart(8),
      pct(top1, rows.length).padStart(8),
      String(veryHigh.length).padStart(6),
      pct(vhCorrect, veryHigh.length).padStart(9),
      String(veryHigh.length - vhCorrect).padStart(6),
      String(bulk.length).padStart(6),
      pct(bulkCorrect, bulk.length).padStart(10),
      String(bulk.length - bulkCorrect).padStart(8),
      String(rows.filter((c) => c.hardConflict).length).padStart(9),
    ].join(' '));
  }

  console.log('');
  console.log('=== EVERY BULK-ELIGIBLE FALSE POSITIVE ===');
  const bulkFps = cases.filter((c) => c.bulkEligible && !c.correct);
  if (bulkFps.length === 0) console.log('none');
  for (const c of bulkFps) {
    console.log(
      `  ${c.sourceType} ${c.targetTable}#${c.targetId} "${c.rawName}" (${c.context})`,
    );
    console.log(
      `      chose ${c.chosenName} #${c.chosenPlayerId} score=${c.score} gap=${c.gap} `
      + `expected #${c.expectedPlayerId} rank=${c.rank ?? 'absent'} signals=${c.signals.join(',')}`,
    );
  }

  console.log('');
  console.log('=== EVERY VERY-HIGH FALSE POSITIVE ===');
  const vhFps = cases.filter((c) => c.band === 'very_high' && !c.correct);
  if (vhFps.length === 0) console.log('none');
  for (const c of vhFps) {
    console.log(
      `  ${c.sourceType} ${c.targetTable}#${c.targetId} "${c.rawName}" (${c.context})`,
    );
    console.log(
      `      chose ${c.chosenName} #${c.chosenPlayerId} score=${c.score} gap=${c.gap} `
      + `expected #${c.expectedPlayerId} rank=${c.rank ?? 'absent'} bulk=${c.bulkEligible}`,
    );
  }
}

/**
 * Everything a false positive in an approvable band needs in order to
 * be understood rather than merely counted.
 */
type Dossier = {
  key: string;
  targetTable: string;
  targetId: number;
  sourceName: string;
  sourceContext: string;
  band: ConfidenceBand;
  gap: number | null;
  expectedPlayerId: number;
  expectedRank: number | null;
  chosen: unknown;
  expected: unknown;
  runnersUp: unknown;
};

function buildDossier(
  row: SourceEvidenceRow,
  assessment: MatchAssessment,
  result: CaseResult,
): Dossier {
  const ranked = assessment.best ? [assessment.best, ...assessment.alternatives] : [];
  const expected = ranked.find((c) => c.playerId === row.knownPlayerId) ?? null;
  return {
    key: result.key,
    targetTable: result.targetTable,
    targetId: result.targetId,
    sourceName: row.source.rawName,
    sourceContext: row.source.context,
    band: result.band,
    gap: result.gap,
    expectedPlayerId: result.expectedPlayerId,
    expectedRank: result.rank,
    chosen: assessment.best,
    expected,
    runnersUp: assessment.alternatives.slice(0, 3),
  };
}

/**
 * What the model would propose for the unresolved queue.
 *
 * Reported, never applied. Precision here can only be established by a
 * human reading the evidence, which is why the samples are printed in
 * full rather than summarised.
 */
async function reportQueue(
  sql: postgres.Sql<Record<string, never>>,
  table: LinkTargetTable | undefined,
  limit: number | undefined,
  outPath: string | null,
): Promise<void> {
  const rows = await fetchSourceEvidence(sql, { status: 'unresolved', table, limit });
  const proposals: Array<Record<string, unknown>> = [];
  const counts = new Map<string, number>();
  let bulkCount = 0;

  const BATCH = 250;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const assessments = await assessSources(sql, batch.map((r) => r.source));
    for (const row of batch) {
      const a = assessments.get(resolutionKey(row.source.target))!;
      counts.set(a.band, (counts.get(a.band) ?? 0) + 1);
      if (a.bulkEligible) bulkCount += 1;
      proposals.push({
        target: `${row.source.target.targetTable}#${row.source.target.targetId}`,
        entity: resolutionKey(row.source.target),
        sourceName: row.source.rawName,
        context: row.source.context,
        band: a.band,
        bulkEligible: a.bulkEligible,
        ambiguous: a.ambiguous,
        hardConflict: a.hardConflict,
        gap: a.gap,
        score: a.best?.score ?? null,
        suggested: a.best?.displayName ?? null,
        suggestedId: a.best?.playerId ?? null,
        signals: (a.best?.evidence ?? []).map((e) => e.signal),
        conflicts: (a.best?.conflicts ?? []).map((c) => c.reason),
        alternatives: a.alternatives.slice(0, 3).map((c) => `${c.displayName} #${c.playerId} (${c.score})`),
      });
    }
  }

  console.log('=== UNRESOLVED QUEUE: WHAT WOULD BE PROPOSED ===');
  console.log(`queue rows (resolution grain) ${rows.length}`);
  for (const band of BANDS) {
    console.log(`${band.padEnd(10)} ${counts.get(band) ?? 0}`);
  }
  console.log(`bulk-eligible ${bulkCount}`);

  for (const band of BANDS) {
    const sample = proposals.filter((p) => p.band === band).slice(0, 20);
    if (sample.length === 0) continue;
    console.log('');
    console.log(`--- sample: ${band} ---`);
    for (const p of sample) {
      console.log(
        `  ${p.target} "${p.sourceName}" (${p.context})`,
      );
      console.log(
        `      -> ${p.suggested} #${p.suggestedId} score=${p.score} gap=${p.gap} `
        + `bulk=${p.bulkEligible} signals=${(p.signals as string[]).join(',')}`
        + ((p.conflicts as string[]).length ? ` conflicts=${(p.conflicts as string[]).join(',')}` : ''),
      );
    }
  }

  if (outPath) {
    writeFileSync(outPath, JSON.stringify({ proposals }, null, 2), 'utf8');
    console.log(`
queue proposals written to ${outPath}`);
  }
}

async function main(): Promise<void> {
  loadEnv();
  const argv = process.argv.slice(2);
  const tableArg = valueFor(argv, '--table');
  const table = tableArg && isLinkTargetTable(tableArg) ? tableArg : undefined;
  if (tableArg && !table) throw new Error(`Unknown table: ${tableArg}`);
  const limitArg = valueFor(argv, '--limit');
  const limit = limitArg ? Number(limitArg) : undefined;
  const outPath = valueFor(argv, '--out');
  // Score the live review queue instead of confirmed links. There is no
  // ground truth here -- that is the point of the queue -- so this mode
  // reports what would be PROPOSED, for manual inspection. It is the
  // only way to see the population the feature actually runs against:
  // rows import-time matching already failed on, which are far richer
  // in people who have no AFLDB player record at all.
  const queueMode = argv.includes('--queue');

  const sql = postgres(backtestUrl(), { max: 1, onnotice: () => {} });
  const startedAt = new Date().toISOString();

  try {
    if (queueMode) {
      await reportQueue(sql, table, limit, outPath);
      return;
    }

    const rows = (await fetchSourceEvidence(sql, { status: 'trusted', table, limit }))
      .filter((r) => r.knownPlayerId !== null);

    console.log('=== POLICY UNDER TEST ===');
    console.log(`algorithm version  ${ALGORITHM_VERSION}`);
    console.log(`git commit         ${gitCommit()}`);
    console.log(`run started        ${startedAt}`);
    console.log(`table filter       ${table ?? 'all'}`);
    console.log(JSON.stringify(MATCH_POLICY, null, 2));

    const cases: CaseResult[] = [];
    const dossiers: Dossier[] = [];
    const BATCH = 250;

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const assessments = await assessSources(sql, batch.map((r) => r.source));
      for (const row of batch) {
        const assessment = assessments.get(resolutionKey(row.source.target))!;
        const result = toCaseResult(row, assessment);
        cases.push(result);
        if (!result.correct && (result.band === 'very_high' || result.band === 'high')) {
          dossiers.push(buildDossier(row, assessment, result));
        }
      }
      process.stderr.write(`  scored ${Math.min(i + BATCH, rows.length)}/${rows.length}\r`);
    }
    process.stderr.write('\n');

    report(cases);

    console.log('');
    console.log('=== HIGH / VERY HIGH FALSE POSITIVES ===');
    console.log(`count ${dossiers.length}`);
    for (const d of dossiers.slice(0, 25)) {
      console.log(
        `  ${d.targetTable}#${d.targetId} "${d.sourceName}" [${d.band}] `
        + `chose ${(d.chosen as { playerId: number; displayName: string } | null)?.displayName}`
        + ` (#${(d.chosen as { playerId: number } | null)?.playerId})`
        + ` expected #${d.expectedPlayerId} rank=${d.expectedRank ?? 'absent'} gap=${d.gap}`,
      );
    }

    if (outPath) {
      writeFileSync(
        outPath,
        JSON.stringify(
          {
            algorithmVersion: ALGORITHM_VERSION,
            gitCommit: gitCommit(),
            startedAt,
            tableFilter: table ?? null,
            policy: MATCH_POLICY,
            cases,
            falsePositives: dossiers,
          },
          null,
          2,
        ),
        'utf8',
      );
      console.log(`\nfull results written to ${outPath}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
