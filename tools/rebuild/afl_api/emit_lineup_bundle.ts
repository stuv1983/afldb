#!/usr/bin/env node
/**
 * AFLDB-ISSUE-100 L2 — emit the `afl_api.lineup` observation bundle from one
 * bounded acquisition.
 *
 * The thin filesystem shell around `src/lib/acquisition/lineup-bundle.ts`: it
 * reads the acquisition's manifest and artefact, hands them to the pure
 * assembler and writes the deterministic bundle. Every decision — identity,
 * scope, completeness, fidelity, ordering — lives in the library and is unit
 * tested there; nothing is decided here.
 *
 * DB-free by construction. No driver is imported and no connection is opened:
 * this reads two files and writes one. Persisting the bundle into the
 * migration-074 spine is a LATER stage and is deliberately not wired up.
 *
 * Usage:
 *   npx tsx tools/rebuild/afl_api/emit_lineup_bundle.ts \
 *     --acquisition data/sources/afl_api/lineups/afl-api-lineups-2026-r20 [--out <path>]
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import {
  getSourceFamily,
  parseSourceFamilyRegistry,
} from '../../../src/lib/acquisition/source-families';
import {
  buildLineupBundle,
  lineupAcquisitionInput,
  serialiseLineupBundle,
} from '../../../src/lib/acquisition/lineup-bundle';

const REGISTRY_PATH = 'data/reference/source-families.json';

function opt(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  const value = process.argv[i + 1];
  if (value === undefined) throw new Error(`${flag} requires a value`);
  return value;
}

const dir = opt('--acquisition');
if (dir === null) {
  throw new Error(
    '--acquisition <dir> is REQUIRED: the directory written by '
    + 'tools/rebuild/afl_api/acquire_lineups.R.',
  );
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

const manifestPath = join(dir, 'manifest.json');
const manifest = readJson(manifestPath) as Record<string, unknown>;

const files = manifest.files as { file?: unknown }[] | undefined;
if (!Array.isArray(files) || files.length !== 1 || typeof files[0]?.file !== 'string') {
  throw new Error('The manifest must name exactly one artefact file.');
}
const artefactPath = join(dir, files[0].file);

// Re-verify the manifest's own SHA-256 binding before trusting the artefact.
// The acquirer hashed it; this proves the bytes have not changed since.
const actualSha = createHash('sha256').update(readFileSync(artefactPath)).digest('hex');
const declaredSha = (files[0] as { sha256?: unknown }).sha256;
if (actualSha !== declaredSha) {
  throw new Error(
    `Artefact ${basename(artefactPath)} does not match its manifest SHA-256 `
    + `(declared ${String(declaredSha)}, actual ${actualSha}). Refusing.`,
  );
}

const registry = parseSourceFamilyRegistry(readJson(REGISTRY_PATH));
const contract = getSourceFamily(registry, 'afl_api', 'lineup');

const bundle = buildLineupBundle(
  lineupAcquisitionInput(contract, manifest, readJson(artefactPath)),
);
const serialised = serialiseLineupBundle(bundle);

const outPath = opt('--out') ?? join(dir, 'observations.json');
writeFileSync(outPath, serialised, 'utf8');

const [enumeration] = bundle.enumerations;
process.stdout.write(
  `AFLDB-ISSUE-100 lineup observation bundle\n`
  + `  scope:   ${enumeration.scope_key}\n`
  + `  records: ${bundle.counts.records} (from ${bundle.counts.lineup_rows} source row(s))\n`
  + `  digest:  ${createHash('sha256').update(serialised).digest('hex')}\n`
  + `  out:     ${outPath}\n`
  + `  enumeration.complete: ${enumeration.complete} `
  + `(absence sweeping is disabled for this family)\n`
  + `  STAGING-ONLY: no canonical participation is asserted or implied.\n`,
);
