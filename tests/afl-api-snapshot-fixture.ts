/**
 * Test support (not a test file) — builds a real, hash-bound AFL API snapshot directory from the
 * COMMITTED provider fixtures under tests/fixtures/afl_api/match, so the replay and reconciliation
 * report suites exercise the production snapshot reader and bundle builder on genuine provider
 * bodies. Nothing here is fabricated provider data: every unit is the committed fixture trio
 * (fixture result, player stats, match roster), byte for byte, unless a test deliberately mutates
 * a copy to exercise a refusal (and says so).
 *
 * The manifest carries real sha256s computed from the bytes written. A scratch PROJECT ROOT also
 * holds COPIES of the tracked data/reference files, exactly as tests/afl-api-settle-cli-gate.test.ts
 * builds them, so `loadAflApiSettleBundle(projectRoot, label)` parses them as production does.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const REPO_ROOT = join(__dirname, '..');
export const FIXTURE_SEASON = 2026;
export const FIXTURE_MATCH_ID = 'CD_M20260142801';
const REFERENCE_FILES = ['source-families.json', 'afl-api-identities.json', 'seasons.json'] as const;
const FIXTURE_DIR = join(REPO_ROOT, 'tests', 'fixtures', 'afl_api', 'match');

export type RawBody = Record<string, unknown>;

export interface SnapshotUnit {
  /** The match directory name, `CD_M...`. */
  id: string;
  fixture: RawBody;
  roster: RawBody;
  playerStats: RawBody;
}

/** Fresh deep copies of the three committed bodies of the committed match. */
export function committedUnit(id: string = FIXTURE_MATCH_ID): SnapshotUnit {
  const read = (name: string): RawBody => JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as RawBody;
  return {
    id,
    fixture: read('01-fixture-result.json'),
    playerStats: read('02-player-stats.raw.json'),
    roster: read('03-match-roster.raw.json'),
  };
}

export function sha256Of(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A scratch directory under the OS temp dir (the test runner points TEMP at the session scratchpad). */
export function makeScratchDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function referenceJson(name: (typeof REFERENCE_FILES)[number]): unknown {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'data', 'reference', name), 'utf8'));
}

/**
 * Write `units` into `snapshotDir` and seal them with a manifest.json carrying real sha256s.
 * Returns the manifest object written.
 */
export function writeSnapshot(
  snapshotDir: string, units: readonly SnapshotUnit[], season: number = FIXTURE_SEASON,
): { files: { file: string; sha256: string }[] } {
  mkdirSync(snapshotDir, { recursive: true });
  const files: { file: string; sha256: string }[] = [];
  for (const unit of units) {
    mkdirSync(join(snapshotDir, unit.id), { recursive: true });
    const bodies: [string, RawBody][] = [
      ['fixture.json', unit.fixture], ['match-roster.json', unit.roster], ['player-stats.json', unit.playerStats],
    ];
    for (const [name, body] of bodies) {
      const text = `${JSON.stringify(body, null, 2)}\n`;
      writeFileSync(join(snapshotDir, unit.id, name), text);
      files.push({ file: `${unit.id}/${name}`, sha256: sha256Of(text) });
    }
  }
  const manifest = { source_key: 'afl_api', acquisition_kind: 'afl_api_match_snapshot', season, files };
  writeFileSync(join(snapshotDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** A scratch project root holding copies of the tracked reference files and one snapshot under `label`. */
export function makeScratchProject(
  label: string, units: readonly SnapshotUnit[],
): { projectRoot: string; snapshotDir: string } {
  const projectRoot = makeScratchDir('afldb-v2-replay-');
  mkdirSync(join(projectRoot, 'data', 'reference'), { recursive: true });
  for (const name of REFERENCE_FILES) {
    writeFileSync(join(projectRoot, 'data', 'reference', name), readFileSync(join(REPO_ROOT, 'data', 'reference', name)));
  }
  const snapshotDir = join(projectRoot, 'data', 'sources', 'afl_api', 'matches', label);
  writeSnapshot(snapshotDir, units);
  return { projectRoot, snapshotDir };
}

/**
 * SYNTHETIC unit that is deliberately invalid: a copy of the committed unit under a different
 * provider id whose fixture carries a column the source-family registry does not declare. It
 * exists only to prove a validation failure becomes a build failure and proposes nothing.
 */
export function undeclaredColumnUnit(id: string = 'CD_M20260142802'): SnapshotUnit {
  const unit = committedUnit(id);
  unit.fixture.providerId = id;
  unit.fixture.somethingNew = 'SYNTHETIC: a column no registry declares';
  return unit;
}
