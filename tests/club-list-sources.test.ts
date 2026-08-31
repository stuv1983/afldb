import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

/**
 * AFLDB-ISSUE-093 Phase 3 — five-club-list canonical source contract.
 *
 * Static validation of tools/migration/enrich_birth_dates_from_club_lists.py's
 * canonical-source wiring (runbook §4/§13.4): the exact five expected
 * filenames and their deterministic source keys, the canonical directory,
 * the required CSV headers, and the fail-closed behaviour for a missing or
 * malformed source file. No database and no network: the importer's source
 * validation runs before any environment/database access, so the spawn
 * tests exercise it directly.
 */
const root = process.cwd();
const importerPath = join(root, 'tools', 'migration', 'enrich_birth_dates_from_club_lists.py');
const importerSource = readFileSync(importerPath, 'utf8');

// The canonical contract, pinned literally (issues/closed/AFLDB-ISSUE-093.md §4). The
// filenames must match FILE_ORGS exactly; the keys are the importer's
// deterministic derivation (org name lowercased, spaces to hyphens) and
// are the stable prefix of every club-list external_id
// (`club-list:<key>:cap<n>`).
const EXPECTED_FILES: Record<string, { org: string; key: string }> = {
  'Brisbane_Bears_-_All_Time_Player_List.csv': { org: 'Brisbane Bears', key: 'brisbane-bears' },
  'Fitzroy_-_All_Time_Player_List.csv': { org: 'Fitzroy', key: 'fitzroy' },
  'North_Melbourne_-_All_Time_Player_List.csv': { org: 'North Melbourne', key: 'north-melbourne' },
  'Sydney(South Melbourne)_-_All_Time_Player_List.csv': { org: 'Sydney', key: 'sydney' },
  'University_-_All_Time_Player_List.csv': { org: 'University', key: 'university' },
};
const CANONICAL_DIR_SEGMENTS = ['data', 'sources', 'afltables', 'club_lists'];
const REQUIRED_HEADERS = ['Cap', 'Player', 'DOB', 'Games (W-D-L)', 'Goals', 'Seasons'];
const CSV_HEADER = 'Cap,#,Player,DOB,HT,WT,Games (W-D-L),Goals,Seasons,Debut,Last';

const venvPython = process.platform === 'win32'
  ? join(root, '.venv', 'Scripts', 'python.exe')
  : join(root, '.venv', 'bin', 'python');
const python = process.env.AFLDB_PYTHON
  ?? (existsSync(venvPython) ? venvPython : (process.platform === 'win32' ? 'python' : 'python3'));

function hasPsycopg(): boolean {
  const probe = spawnSync(python, ['-c', 'import psycopg'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
}
const canSpawn = hasPsycopg();

const tempDirs: string[] = [];
function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'issue093-club-lists-'));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function runImporter(args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(python, [importerPath, '--quiet', ...args], {
    cwd: root, encoding: 'utf8',
  });
}

describe('club-list canonical source contract (AFLDB-ISSUE-093 Phase 3)', () => {
  it('FILE_ORGS carries exactly the five canonical filenames and organizations', () => {
    for (const [file, { org }] of Object.entries(EXPECTED_FILES)) {
      expect(importerSource).toContain(`"${file}": "${org}",`);
    }
    // No sixth entry: FILE_ORGS holds exactly five filename keys.
    const block = importerSource.slice(
      importerSource.indexOf('FILE_ORGS = {'),
      importerSource.indexOf('}', importerSource.indexOf('FILE_ORGS = {')),
    );
    expect(block.match(/_All_Time_Player_List\.csv/g)).toHaveLength(5);
  });

  it('source keys are deterministic and unique', () => {
    // Mirror the importer's derivation: org_name.lower().replace(" ", "-").
    const derived = Object.values(EXPECTED_FILES).map(({ org }) =>
      org.toLowerCase().replace(/ /g, '-'));
    expect(derived.sort()).toEqual(
      Object.values(EXPECTED_FILES).map(({ key }) => key).sort());
    expect(new Set(derived).size).toBe(5);
  });

  it('the canonical directory and required headers are pinned in the importer', () => {
    expect(importerSource).toContain(
      `"${CANONICAL_DIR_SEGMENTS.join('" / "')}"`,
    );
    for (const header of REQUIRED_HEADERS) {
      expect(importerSource).toContain(`"${header}"`);
    }
    // Canonical mode (no --csv-dir) implies completeness.
    expect(importerSource).toContain('args.require_complete or args.csv_dir is None');
  });

  it('the importer never silently substitutes or downloads a source', () => {
    for (const marker of ['urllib.request', 'requests', 'http://', 'curl']) {
      expect(importerSource).not.toContain(marker);
    }
  });

  describe.skipIf(!canSpawn)('fail-closed source validation (no database touched)', () => {
    it('a missing expected file fails closed under --require-complete', () => {
      const dir = makeDir();
      writeFileSync(join(dir, 'University_-_All_Time_Player_List.csv'),
        `${CSV_HEADER}\n`, 'utf8');
      const result = runImporter(['--csv-dir', dir, '--require-complete', '--dry-run']);
      expect(result.status).not.toBe(0);
      expect(String(result.stderr)).toContain('expected club-list files missing');
      expect(String(result.stderr)).toContain('Brisbane_Bears_-_All_Time_Player_List.csv');
      expect(String(result.stderr)).toContain('Fitzroy_-_All_Time_Player_List.csv');
    });

    it('a file missing a required header fails closed before any write', () => {
      const dir = makeDir();
      writeFileSync(join(dir, 'University_-_All_Time_Player_List.csv'),
        'Cap,#,Player,HT,WT\n', 'utf8');
      const result = runImporter(['--csv-dir', dir, '--dry-run']);
      expect(result.status).not.toBe(0);
      expect(String(result.stderr)).toContain('missing required column(s)');
      expect(String(result.stderr)).toContain('DOB');
    });

    it('a nonexistent source directory fails closed', () => {
      const result = runImporter([
        '--csv-dir', join(tmpdir(), 'issue093-does-not-exist'), '--dry-run',
      ]);
      expect(result.status).not.toBe(0);
      expect(String(result.stderr)).toContain('source directory not found');
    });

    it('a directory with no recognised files fails closed', () => {
      const dir = makeDir();
      writeFileSync(join(dir, 'Unrelated.csv'), `${CSV_HEADER}\n`, 'utf8');
      const result = runImporter(['--csv-dir', dir, '--dry-run']);
      expect(result.status).not.toBe(0);
      expect(String(result.stderr)).toContain('no recognised club list CSVs');
    });
  });
});
