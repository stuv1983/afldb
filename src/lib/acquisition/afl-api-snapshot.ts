/**
 * AFLDB-ISSUE-228 S9 — the shared, offline AFL API snapshot reader.
 *
 * These two functions were previously PRIVATE to
 * `tools/current-season/settle-afl-api.ts`. This is a BEHAVIOUR-PRESERVING
 * EXTRACTION of them: same checks, same ordering, same refusal messages, with
 * those messages pinned by `tests/afl-api-player-evidence.test.ts` so a future
 * edit cannot drift them.
 *
 * The point of the extraction is that a second, read-only consumer — the S9
 * full-season player identity evidence emitter
 * (`tools/current-season/emit-afl-api-player-bridge.ts`) — reads an acquired
 * snapshot through EXACTLY the same manifest verification and unit discovery
 * the settle CLI already uses, rather than growing a second implementation
 * that could drift from it.
 *
 * Nothing here opens a database connection, makes a network request or writes
 * anything. `verifyAflApiSnapshotManifest()` is fail-closed by design: a
 * missing manifest, a file the manifest names that is not on disk, or a
 * sha256 mismatch refuses before any caller can act on the snapshot.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AFL_API_SEASON_FEED_FILE } from './afl-api-season-enumeration';
import type { AflApiSettleUnitSource } from './settle-afl-api';

export type AflApiManifestFile = { file: string; sha256: string; status?: string };

export type AflApiSnapshotManifest = {
  manifest: Record<string, unknown>;
  files: readonly AflApiManifestFile[];
};

/** `data/sources/afl_api/matches` under a project root (§5.4). */
export function aflApiSnapshotRoot(projectRoot: string): string {
  return join(projectRoot, 'data', 'sources', 'afl_api', 'matches');
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Offline, fail-closed manifest verification (§5.4/§7.1 step 4): every file
 * the manifest names is re-hashed from disk, exactly as
 * `settle-afltables.ts`'s `loadBundle()` does for the AFL Tables snapshot. A
 * missing manifest or a hash mismatch refuses before any database connection
 * opens.
 */
export function verifyAflApiSnapshotManifest(snapshotDir: string): AflApiSnapshotManifest {
  const manifestPath = join(snapshotDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`No manifest.json under ${snapshotDir} — the acquisition did not complete (§5.4/§7.1).`);
  }
  const manifest = readJson(manifestPath) as {
    source_key?: unknown; acquisition_kind?: unknown; season?: unknown; files?: unknown;
  };
  if (manifest.source_key !== 'afl_api') {
    throw new Error(`manifest.json names source_key '${String(manifest.source_key)}', expected 'afl_api'.`);
  }
  if (manifest.acquisition_kind === 'afl_api_fixture_snapshot') {
    throw new Error(
      `'${snapshotDir}' is a --fixtures-only acquisition (acquisition_kind `
      + "'afl_api_fixture_snapshot') and carries no player-stats.json/match-roster.json — this tool "
      + "cannot settle it. Use 'settle-afl-api-fixtures.ts --label <snapshot> --apply' instead "
      + '(AFLDB-ISSUE-228 S7 follow-up).',
    );
  }
  const files = Array.isArray(manifest.files) ? (manifest.files as AflApiManifestFile[]) : [];
  for (const entry of files) {
    if (entry.status === 'fixture_absent') continue;
    const full = join(snapshotDir, entry.file);
    if (!existsSync(full)) throw new Error(`Manifest names '${entry.file}' but it is not on disk.`);
    const actual = createHash('sha256').update(readFileSync(full)).digest('hex');
    if (actual !== entry.sha256) {
      throw new Error(`'${entry.file}' has changed since acquisition (sha256 mismatch) — refusing to settle it.`);
    }
  }
  return { manifest: manifest as Record<string, unknown>, files };
}

/**
 * Discover every acquired match directory (one per `CD_M...` provider id)
 * from the manifest's own file list, rather than re-listing the directory —
 * the manifest is the one proof of what acquisition actually wrote (§5.4).
 */
export function aflApiUnitSourcesFrom(
  snapshotDir: string, files: readonly AflApiManifestFile[],
): AflApiSettleUnitSource[] {
  const matchDirs = new Set<string>();
  for (const entry of files) {
    const parts = entry.file.split('/');
    if (parts.length === 2 && parts[1] === 'fixture.json') matchDirs.add(parts[0]);
  }
  return [...matchDirs].sort().map((dir) => ({
    fixtureRaw: readJson(join(snapshotDir, dir, 'fixture.json')),
    rosterRaw: readJson(join(snapshotDir, dir, 'match-roster.json')),
    playerStatsRaw: readJson(join(snapshotDir, dir, 'player-stats.json')),
  }));
}

/**
 * AFLDB-ISSUE-231 — the retained season matches response, as text, when the
 * manifest lists it. `verifyAflApiSnapshotManifest()` has already re-hashed
 * every listed file, so these are the acquired bytes. `null` means the
 * snapshot retained no feed, which the caller reads as "completeness not
 * proven", never as an empty season.
 */
export function aflApiSeasonFeedTextFrom(
  snapshotDir: string, files: readonly AflApiManifestFile[],
): string | null {
  if (!files.some((entry) => entry.file === AFL_API_SEASON_FEED_FILE)) return null;
  return readFileSync(join(snapshotDir, AFL_API_SEASON_FEED_FILE), 'utf8');
}

/**
 * The snapshot's OWN identity for provenance: sha256 of `manifest.json`
 * itself. The manifest already hash-binds every payload file
 * (`verifyAflApiSnapshotManifest()` re-checks all of them), so recording this
 * ONE hash pins the whole snapshot without pinning hundreds of untracked
 * files individually into a tracked artefact.
 *
 * Read separately from `verifyAflApiSnapshotManifest()` so that function's
 * behaviour and return shape stay byte-identical to the private version it
 * replaces.
 */
export function aflApiSnapshotManifestSha256(snapshotDir: string): string {
  const manifestPath = join(snapshotDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`No manifest.json under ${snapshotDir} — the acquisition did not complete (§5.4/§7.1).`);
  }
  return createHash('sha256').update(readFileSync(manifestPath)).digest('hex');
}
