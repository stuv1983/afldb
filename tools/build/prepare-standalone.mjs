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

// Incremental static regeneration writes revalidated pages here. The
// standalone output does not create it, and without it Next cannot
// persist a revalidated page, so every request past a page's stale time
// re-renders from scratch.
await mkdir(join(standalone, '.next', 'cache'), { recursive: true });
console.log('prepare-standalone: created .next/cache for ISR');

console.log('prepare-standalone: standalone bundle ready');
