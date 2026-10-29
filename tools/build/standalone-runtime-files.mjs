/**
 * V2-GAP-036: repository files the server reads at RUNTIME, by a path built
 * from `process.cwd()`, that must therefore ship inside the standalone bundle.
 *
 * The standalone `server.js` chdir()s into `.next/standalone`, so a loader's
 * `join(process.cwd(), 'data', 'reference', …)` resolves inside the bundle in
 * production and at the repository root under `next dev` and in the test
 * suites. Next's output file tracing finds some of these files and misses
 * others: it traced `seasons.json` (also imported as a module elsewhere) but
 * not `coleman-derivation.json`, which only a spread of path segments names,
 * so every Coleman compare and publish was refused in the production build
 * while every repository-root test passed.
 *
 * Tracing is therefore not relied on. tools/build/prepare-standalone.mjs
 * copies every file listed here into the bundle and refuses to ship unless
 * each one is present and byte-identical to the repository file.
 * tests/deploy-web-unit.test.ts scans `src/` for runtime reads of `data/` and
 * `tools/` JSON so that a new loader cannot be added without listing its file.
 *
 * Isolated from prepare-standalone.mjs (whose top-level code runs against the
 * real build output on import), as env-in-standalone.mjs is, so the contract
 * test can exercise the real copy and check against a throwaway directory.
 */
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** POSIX paths relative to the repository root, each with the loader that reads it. */
export const STANDALONE_RUNTIME_FILES = [
  // src/db/queries/coleman-inputs.ts loadColemanContract (V2-GAP-036)
  'data/reference/coleman-derivation.json',
  // src/lib/seasons/sealed-seasons.ts loadSeasonRegistry
  'data/reference/seasons.json',
  // src/lib/brownlow/provider-team-identities.ts loadProviderTeamIdentities
  'data/reference/afl-api-identities.json',
  // src/db/queries/admin-draft.ts DRAFT_EVENT_PAIRS (degrades to no choices when missing)
  'data/reference/draftguru-event-kinds.json',
  // src/db/queries/admin-draft.ts NO_DRAFT_YEARS (degrades to none when missing)
  'tools/rebuild/draftguru/draftguru-contract.json',
  // src/db/queries/admin-coaches.ts loadProfileLinkCorrections
  'tools/rebuild/afltables/afltables-contract.json',
  // continuity rules: src/db/queries/match-sheet.ts, afl-api-player-links.ts, admin-draft.ts,
  // src/lib/ingest/datasets.ts, src/lib/acquisition/fitzroy-profile-continuity.ts
  'tools/rebuild/fitzroy/fitzroy-contract.json',
];

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy every runtime file from `root` into the same relative path under
 * `standalone`. A file missing from the repository is skipped, not thrown on,
 * so that checkRuntimeFiles names it instead of a bare ENOENT stack.
 */
export async function copyRuntimeFiles(root, standalone, files = STANDALONE_RUNTIME_FILES) {
  for (const file of files) {
    if (!(await exists(join(root, ...file.split('/'))))) continue;
    const target = join(standalone, ...file.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(root, ...file.split('/')), target);
  }
}

/**
 * Every runtime file that is missing from `standalone` or differs from the
 * repository copy under `root`, as `{ file, problem }`. Empty means the
 * bundle can read everything the server reads.
 */
export async function checkRuntimeFiles(root, standalone, files = STANDALONE_RUNTIME_FILES) {
  const problems = [];
  // The files only help if they sit beside the server.js that chdir()s here. A nested layout
  // (standalone/<subdir>/server.js, after a tracing-root change) would leave them unread.
  if (!(await exists(join(standalone, 'server.js')))) {
    problems.push({ file: 'server.js', problem: 'not at the bundle root, so the server would not read these files' });
  }
  for (const file of files) {
    const source = join(root, ...file.split('/'));
    const target = join(standalone, ...file.split('/'));
    if (!(await exists(source))) {
      problems.push({ file, problem: 'missing from the repository' });
    } else if (!(await exists(target))) {
      problems.push({ file, problem: 'missing from the bundle' });
    } else if ((await sha256(source)) !== (await sha256(target))) {
      problems.push({ file, problem: 'differs from the repository file' });
    }
  }
  return problems;
}
