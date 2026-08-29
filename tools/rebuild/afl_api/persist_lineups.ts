#!/usr/bin/env node
/**
 * AFLDB-ISSUE-100 L3B2 — persist an emitted lineup bundle.
 *
 * The thin operator shell around `src/lib/acquisition/lineup-store.ts`. It
 * verifies the bundle against the artefact actually on disk, then hands it to
 * the persistence module; every decision — source ownership, projection,
 * version linkage, upsert — lives in that module and is tested there.
 *
 * Offline and fail-closed BEFORE the database: the bundle is read, the
 * artefact it names is re-hashed from disk, and the family contract is
 * validated. Only then is a connection opened, so an unverified bundle cannot
 * reach PostgreSQL. This mirrors `tools/current-season/settle-afltables.ts`.
 *
 * STAGING-ONLY. Writes `import_batches`, the migration-074 spine and
 * `staging.afl_api_lineup`. Writes no canonical row, creates no promotion
 * candidate, runs no absence sweep, and issues no DELETE or TRUNCATE.
 *
 * Usage:
 *   npx tsx tools/rebuild/afl_api/persist_lineups.ts \
 *     --acquisition data/sources/afl_api/lineups/afl-api-lineups-2026-r20
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import type { LineupBundle } from '../../../src/lib/acquisition/lineup-bundle';
import { persistLineupBundle } from '../../../src/lib/acquisition/lineup-store';
import {
  getSourceFamily,
  parseSourceFamilyRegistry,
} from '../../../src/lib/acquisition/source-families';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..');

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

function opt(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  const value = process.argv[i + 1];
  if (value === undefined) throw new Error(`${flag} requires a value`);
  return value;
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

function main(): Promise<void> {
  const dir = opt('--acquisition');
  if (dir === null) {
    throw new Error(
      '--acquisition <dir> is REQUIRED: the directory holding observations.json, '
      + 'written by tools/rebuild/afl_api/emit_lineup_bundle.ts.',
    );
  }

  const bundle = readJson(join(dir, 'observations.json')) as LineupBundle;

  // The bundle is only evidence of what it describes if the artefact it names
  // still hashes to what it recorded.
  const manifest = readJson(join(dir, 'manifest.json')) as {
    files?: { file?: unknown; sha256?: unknown }[];
  };
  const file = manifest.files?.[0];
  if (!file || typeof file.file !== 'string') {
    throw new Error('The manifest must name exactly one artefact file.');
  }
  const actual = createHash('sha256')
    .update(readFileSync(join(dir, file.file)))
    .digest('hex');
  if (actual !== file.sha256) {
    throw new Error(
      `Artefact ${file.file} does not match its manifest SHA-256. Refusing.`,
    );
  }
  if (bundle.artefact_sha256 !== actual) {
    throw new Error(
      'The bundle was emitted from a different artefact than the one on disk. Refusing.',
    );
  }

  const registry = parseSourceFamilyRegistry(
    readJson(join(PROJECT_ROOT, 'data', 'reference', 'source-families.json')),
  );
  const contract = getSourceFamily(registry, 'afl_api', 'lineup');

  loadEnv();
  const dsn = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!dsn) throw new Error('AFLDB_IMPORT_DATABASE_URL is not set.');
  const sql = postgres(dsn, { max: 1, onnotice: () => {}, transform: { undefined: null } });

  return persistLineupBundle(sql, bundle, contract)
    .then(({ batchId, counters }) => {
      process.stdout.write(
        'AFLDB-ISSUE-100 lineup staging\n'
        + `  batch:                    ${batchId}\n`
        + `  records read:             ${counters.recordsRead}\n`
        + `  spine versions inserted:  ${counters.versionsInserted}\n`
        + `  spine heads refreshed:    ${counters.headsRefreshed}\n`
        + `  projections inserted:     ${counters.projectionsInserted}\n`
        + `  projections updated:      ${counters.projectionsUpdated}\n`
        + `  observations marked absent: ${counters.observationsMarkedAbsent} `
        + '(absence sweeping is disabled for this family)\n'
        + `  canonical rows written:   ${counters.canonicalRowsWritten}\n`
        + `  match/club/player ids resolved: ${counters.matchIdsResolved}/`
        + `${counters.clubIdsResolved}/${counters.playerIdsResolved} `
        + '(no approved provider-id path exists; NULL is expected)\n'
        + '  STAGING-ONLY: announced is not played; no canonical participation written.\n',
      );
    })
    .finally(() => sql.end());
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
