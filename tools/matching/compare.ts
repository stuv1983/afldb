/**
 * Compare two saved player-link matching reports (AFLDB-ISSUE-164 P1).
 *
 * Deliberately a separate entry point from backtest.ts: comparing two JSON
 * files needs no evidence, no DSN and no environment, and backtest.ts
 * cannot be imported without one (it pulls in the application db client,
 * which throws at module load when DATABASE_URL is unset).
 *
 *   npm run match:compare -- backtest-v1-baseline.json backtest-p1b-normalised.json
 *   npm run match:compare -- queue-v1-baseline.json queue-p1b-normalised.json \
 *                            --out compare-queue-v1-to-p1b.json
 *
 * Both a labelled backtest report and a queue report are accepted; the kind
 * is detected from the payload and the two must match. Neither input file is
 * ever written. Exit code 2 means the D-9 draft-bulk stop condition was met.
 */
import { runComparison } from './compare-reports';

function valueFor(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function main(): void {
  const argv = process.argv.slice(2);
  const outPath = valueFor(argv, '--out');
  const positional = argv.filter(
    (arg, i) => !arg.startsWith('--') && argv[i - 1] !== '--out',
  );
  if (positional.length !== 2) {
    throw new Error(
      'Usage: npm run match:compare -- <baseline.json> <candidate.json> [--out <comparison.json>]',
    );
  }
  runComparison(positional[0], positional[1], outPath);
}

main();
