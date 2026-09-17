/**
 * AFLDB-ISSUE-220: `next build` (`writeStandaloneDirectory` in
 * `next/dist/build/index.js`) copies `.env` and `.env.production` into
 * `.next/standalone/` unconditionally on every `output: 'standalone'`
 * build — it is a hardcoded file copy keyed on the loaded env file's own
 * name, entirely separate from output file tracing, so no
 * `next.config.ts` knob (`outputFileTracingExcludes` included) suppresses
 * it. This is the only place left to stop a credential file reaching a
 * deployed host.
 *
 * Isolated from tools/build/prepare-standalone.mjs, whose top-level code
 * runs against the real build output the moment it is imported, so this
 * module's contract test can exercise the real removal logic against a
 * throwaway directory instead.
 */
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

export async function findEnvFiles(dir) {
  const entries = await readdir(dir);
  return entries.filter((name) => name === '.env' || name.startsWith('.env.'));
}

/**
 * Deletes every `.env`/`.env.*` file at the top level of `dir` and returns
 * whatever is still there afterwards — empty on success, non-empty only if
 * a file could not be removed.
 */
export async function removeEnvFiles(dir) {
  for (const name of await findEnvFiles(dir)) {
    await rm(join(dir, name));
  }
  return findEnvFiles(dir);
}
