import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Clears the previous run's per-worker observation files, exactly once,
 * before any worker starts.
 *
 * It has to happen here rather than in the spec's `beforeAll`, which
 * runs once per WORKER: whichever worker got there second would delete
 * observations the first had already written. Stale files matter because
 * the summary merges every `observations-*.jsonl` it finds -- a run at 8
 * workers followed by a run at 4 would otherwise silently fold half of
 * the older run into the newer one's totals.
 */
export default function globalSetup() {
  const outDir = resolve('nl-ui-out');
  mkdirSync(outDir, { recursive: true });

  if (process.env.NL_UI_APPEND === '1') return;
  for (const entry of readdirSync(outDir)) {
    if (/^observations.*\.jsonl$/.test(entry)) rmSync(resolve(outDir, entry), { force: true });
  }
}
