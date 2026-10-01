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
 * The copy lands at `standalone/<relative(outputFileTracingRoot, appDir)>/`,
 * which is the standalone root for this repository's layout today, so the
 * top-level removal below is the known case. `findEnvFilesRecursive` is the
 * guard for every other case: a nested credential file means Next's layout
 * or the tracing root changed, and that deserves inspection, not a silent
 * delete, so it is only ever reported.
 *
 * Isolated from tools/build/prepare-standalone.mjs, whose top-level code
 * runs against the real build output the moment it is imported, so this
 * module's contract test can exercise the real removal logic against a
 * throwaway directory instead.
 */
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

function isEnvFileName(name) {
  return name === '.env' || name.startsWith('.env.');
}

export async function findEnvFiles(dir) {
  const entries = await readdir(dir);
  return entries.filter(isEnvFileName);
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

/**
 * Every `.env`/`.env.*` entry anywhere under `dir`, as sorted POSIX paths
 * relative to `dir`. Names only: no file is opened or read. A symbolic link
 * (or Windows junction) is never followed; one that is itself named like an
 * env file is reported, since it would still expose its target.
 */
export async function findEnvFilesRecursive(dir) {
  const found = [];
  async function walk(relDir) {
    const entries = await readdir(join(dir, relDir), { withFileTypes: true });
    for (const entry of entries) {
      const relPath = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await walk(relPath);
      } else if (isEnvFileName(entry.name)) {
        found.push(relPath);
      }
    }
  }
  await walk('');
  return found.sort();
}
