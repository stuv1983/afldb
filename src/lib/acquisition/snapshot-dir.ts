/**
 * AFLDB-ISSUE-228 shared snapshot-directory claim, used by every `acquire-*`
 * CLI tool that writes an immutable evidence snapshot under
 * `data/sources/afl_api/<kind>/<label>/`.
 *
 * `fs.mkdirSync(dir, { recursive: true })` is silently a no-op when `dir`
 * already exists — it neither throws nor reports the collision — so two
 * acquisitions whose generated label collides (same season, same wall-clock
 * minute/second) would otherwise write into the SAME directory and one
 * payload's raw files/manifest would silently overwrite the other's.
 * `claimSnapshotDir` makes that collision impossible to miss:
 * `mkdirSync(dir)` (no `recursive`) throws `EEXIST` on an existing
 * directory, so a collision is caught before any file is written, and a
 * deterministic numeric suffix is appended and retried rather than reusing
 * or overwriting the existing snapshot. An existing snapshot directory is
 * never deleted, truncated or written into by this function.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type ClaimedSnapshotDir = { label: string; dir: string };

export function claimSnapshotDir(
  parentDir: string,
  baseLabel: string,
  maxAttempts = 1000,
): ClaimedSnapshotDir {
  mkdirSync(parentDir, { recursive: true });
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const label = attempt === 1 ? baseLabel : `${baseLabel}-${attempt}`;
    const dir = join(parentDir, label);
    try {
      mkdirSync(dir);
      return { label, dir };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error(
    `Could not claim a unique snapshot directory under '${parentDir}' for base label `
    + `'${baseLabel}' after ${maxAttempts} attempt(s) — every candidate is already taken.`,
  );
}
