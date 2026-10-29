/**
 * Complete the Next.js standalone bundle.
 *
 * `output: 'standalone'` emits a self-contained server plus its runtime
 * dependencies, but deliberately leaves out the static assets so they
 * can be served from a CDN. AFLDB serves them from the same process, so
 * they are copied in here.
 *
 * Without this the site starts but every stylesheet and client chunk
 * 404s — a failure that only appears in the production deployment, never
 * in `next dev`.
 */
import { cp, access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { findEnvFilesRecursive, removeEnvFiles } from './env-in-standalone.mjs';
import { STANDALONE_RUNTIME_FILES, checkRuntimeFiles, copyRuntimeFiles } from './standalone-runtime-files.mjs';

const root = process.cwd();
const standalone = join(root, '.next', 'standalone');

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(standalone))) {
  console.error('prepare-standalone: .next/standalone not found — run `next build` first.');
  process.exit(1);
}

// AFLDB-ISSUE-220: next build copies `.env`/`.env.production` into the
// standalone tree unconditionally (see tools/build/env-in-standalone.mjs).
// The web unit's UnsetEnvironment= only strips the exec-time environment;
// this bundle is what put every credential straight back at start-up. Strip
// it here and refuse to ship if anything survives.
const remainingEnvFiles = await removeEnvFiles(standalone);
if (remainingEnvFiles.length > 0) {
  console.error(
    `prepare-standalone: refusing to ship — ${remainingEnvFiles.join(', ')} still present under .next/standalone`,
  );
  process.exit(1);
}
console.log('prepare-standalone: confirmed no .env* under .next/standalone');

// Check build-time AFLDB_ENV security flag (see changeLog.md).
const isProductionBuild = process.env.AFLDB_ENV === 'production';
if (isProductionBuild) {
  console.log('prepare-standalone: AFLDB_ENV=production detected (HSTS and production CSP enabled)');
} else {
  console.log('prepare-standalone: info: AFLDB_ENV is not production; building with development headers');
}

// Client chunks, CSS and build assets.
await cp(join(root, '.next', 'static'), join(standalone, '.next', 'static'), {
  recursive: true,
});
console.log('prepare-standalone: copied .next/static');

// Optional public assets.
if (await exists(join(root, 'public'))) {
  await cp(join(root, 'public'), join(standalone, 'public'), { recursive: true });
  console.log('prepare-standalone: copied public');
}

// The apex coming-soon page's template: stylesheet, form script, icon,
// robots, sitemap and the shipped screenshots. src/lib/apex-publish.ts reads
// these when publishing and copies them to the directory Caddy serves.
//
// It has to be copied in because the standalone server chdir()s into
// .next/standalone on startup, so `process.cwd()/deploy/coming-soon` resolves
// HERE in production and to the repository root under `next dev`. Both
// therefore work without the publisher having to guess which layout it is in.
if (await exists(join(root, 'deploy', 'coming-soon'))) {
  await cp(
    join(root, 'deploy', 'coming-soon'),
    join(standalone, 'deploy', 'coming-soon'),
    { recursive: true },
  );
  console.log('prepare-standalone: copied deploy/coming-soon');
}

// V2-GAP-036: reference files the server reads by a process.cwd() path
// (the Coleman derivation contract, the season registry, …). The same chdir
// makes them resolve inside the bundle, and output file tracing missed the
// Coleman contract, so every one is copied explicitly and checked byte for
// byte. A missing or different file refuses the bundle rather than shipping
// a server that refuses those operations at runtime.
await copyRuntimeFiles(root, standalone);
const runtimeFileProblems = await checkRuntimeFiles(root, standalone);
if (runtimeFileProblems.length > 0) {
  console.error(
    `prepare-standalone: refusing to ship — runtime file(s) not usable: ${runtimeFileProblems
      .map(({ file, problem }) => `${file} (${problem})`)
      .join(', ')}`,
  );
  process.exit(1);
}
console.log(`prepare-standalone: copied and verified ${STANDALONE_RUNTIME_FILES.length} runtime reference files`);

// Incremental static regeneration writes revalidated pages here. The
// standalone output does not create it, and without it Next cannot
// persist a revalidated page, so every request past a page's stale time
// re-renders from scratch.
await mkdir(join(standalone, '.next', 'cache'), { recursive: true });
console.log('prepare-standalone: created .next/cache for ISR');

// AFLDB-ISSUE-220 hardening: the top-level removal above covers where Next
// puts the copied env files today. Scan the whole finished tree — including
// everything copied in just above — and refuse to ship if a credential-named
// file survives anywhere. A nested one is reported for inspection, never
// deleted: it means the layout changed and somebody should look.
const nestedEnvFiles = await findEnvFilesRecursive(standalone);
if (nestedEnvFiles.length > 0) {
  console.error(
    `prepare-standalone: refusing to ship — .env-named file(s) under .next/standalone: ${nestedEnvFiles.join(', ')}. Inspect them; they are not deleted automatically.`,
  );
  process.exit(1);
}
console.log('prepare-standalone: confirmed no .env* anywhere under .next/standalone');

console.log('prepare-standalone: standalone bundle ready');
