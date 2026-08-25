/**
 * AFLDB-ISSUE-093 Phase 1: the static/reference datasets under data/reference/
 * and their standalone loader, tools/migration/load_reference_data.py.
 *
 * The datasets replace hand-curated constants that lived inside the
 * legacy-dependent import_legacy_afl.py. These tests pin what porting must
 * not change: stable identifiers (club hist strings, slugs, stat keys), the
 * organization model (mergers link, never combine), and the loader's zero
 * dependency on AFLDB_LEGACY_SQLITE. No database is touched: the loader run
 * here is --print-plan only, which validates and counts without connecting.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const refDir = join(root, 'data', 'reference');

function readJson(name: string): any {
  return JSON.parse(readFileSync(join(refDir, name), 'utf8'));
}

const sources = readJson('sources.json');
const seasons = readJson('seasons.json');
const clubs = readJson('clubs.json');
const statDefs = readJson('stat-definitions.json');
const statAvail = readJson('stat-availability.json');
const venueCanonical = readJson('venue-canonical.json');

describe('sources dataset', () => {
  it('carries the seven registry rows with unique keys and valid kinds', () => {
    const keys = sources.sources.map((s: any) => s.key);
    expect(keys).toEqual([
      'fitzroy_afldata', 'afltables', 'wikipedia', 'wikipedia_22under22',
      'draftguru', 'footywire', 'sports_data_lab',
    ]);
    const kinds = new Set(['upstream_dataset', 'scrape', 'manual', 'derived']);
    for (const s of sources.sources) expect(kinds.has(s.kind)).toBe(true);
  });
});

describe('seasons dataset', () => {
  it('starts at 1897 and tiles the league eras contiguously', () => {
    expect(seasons.first_season).toBe(1897);
    expect(seasons.last_season).toBeGreaterThanOrEqual(2026);
    let year = seasons.first_season;
    for (const era of seasons.league_eras) {
      expect(era.first_season).toBe(year);
      year = (era.last_season ?? seasons.last_season) + 1;
    }
    expect(year).toBe(seasons.last_season + 1);
    // The league renamed for 1990: VFL through 1989, AFL after.
    expect(seasons.league_eras).toEqual([
      { league: 'VFL', first_season: 1897, last_season: 1989 },
      { league: 'AFL', first_season: 1990, last_season: null },
    ]);
  });

  it('keeps in-progress seasons inside the range', () => {
    for (const y of seasons.in_progress_seasons) {
      expect(y).toBeGreaterThanOrEqual(seasons.first_season);
      expect(y).toBeLessThanOrEqual(seasons.last_season);
    }
  });
});

describe('clubs dataset', () => {
  const identities = clubs.identities;
  const byHist = new Map(identities.map((c: any) => [c.hist, c]));

  it('holds all 24 historical identities with unique stable identifiers', () => {
    expect(identities).toHaveLength(24);
    for (const field of ['hist', 'slug', 'name']) {
      expect(new Set(identities.map((c: any) => c[field])).size).toBe(24);
    }
    expect(identities.filter((c: any) => c.is_current_afl_club)).toHaveLength(18);
  });

  it('preserves the succession model exactly', () => {
    expect((byHist.get('Footscray') as any).successor_hist).toBe('Western Bulldogs');
    expect((byHist.get('Kangaroos') as any).successor_hist).toBe('North Melbourne');
    expect((byHist.get('South Melbourne') as any).successor_hist).toBe('Sydney');
    // Mergers do NOT point at a successor identity: Fitzroy's and the
    // Bears' records stay their own; the link is an organization relation.
    expect((byHist.get('Fitzroy') as any).successor_hist).toBeNull();
    expect((byHist.get('Brisbane Bears') as any).successor_hist).toBeNull();
    expect((byHist.get('University') as any).succession).toBe('defunct');
    for (const c of identities) {
      if (c.successor_hist !== null) expect(byHist.has(c.successor_hist)).toBe(true);
      expect(c.is_current_afl_club).toBe(c.succession === 'current');
    }
  });

  it('keeps the three organization relations, targeting organizations only', () => {
    const orgSlugs = new Set(
      identities.filter((c: any) => c.successor_hist === null).map((c: any) => c.slug),
    );
    expect(clubs.organization_relations).toHaveLength(3);
    for (const rel of clubs.organization_relations) {
      expect(orgSlugs.has(rel.from_slug)).toBe(true);
      if (rel.relation === 'folded') expect(rel.to_slug).toBeNull();
      else expect(orgSlugs.has(rel.to_slug)).toBe(true);
    }
    const merged = clubs.organization_relations
      .filter((r: any) => r.relation === 'merged_into')
      .map((r: any) => r.from_slug)
      .sort();
    expect(merged).toEqual(['brisbane-bears', 'fitzroy']);
  });

  it('keeps identity spans inside the season range', () => {
    for (const c of identities) {
      const last = c.last_season ?? seasons.last_season;
      expect(c.first_season).toBeGreaterThanOrEqual(seasons.first_season);
      expect(last).toBeGreaterThanOrEqual(c.first_season);
      // Only non-current identities may have a closed span.
      if (c.last_season !== null) expect(c.is_current_afl_club).toBe(false);
    }
  });
});

describe('stat definitions dataset', () => {
  it('carries the 21 per-match keys plus the three Brownlow grains, never the generic key', () => {
    const keys = statDefs.definitions.map((d: any) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(24);
    for (const grain of ['brownlow_match_votes', 'brownlow_round_votes', 'brownlow_season_total']) {
      expect(keys).toContain(grain);
    }
    // The single 'brownlow' key gave one answer to three questions; the
    // importer deletes it and the static dataset must never resurrect it.
    expect(keys).not.toContain('brownlow');
    expect(keys).toContain('marks_i50');
    expect(keys).toContain('inside50s');
  });
});

describe('stat availability dataset', () => {
  it('is either pending extraction or a valid coverage grid', () => {
    expect(['PENDING_EXTRACTION', 'READY']).toContain(statAvail.status);
    if (statAvail.status !== 'READY') {
      expect(statAvail.coverage_ranges).toHaveLength(0);
      return;
    }
    const defined = new Set(statDefs.definitions.map((d: any) => d.key));
    const coverage = new Set(['complete', 'partial', 'not_collected', 'not_applicable', 'pending']);
    const seen = new Set<string>();
    for (const r of statAvail.coverage_ranges) {
      expect(defined.has(r.stat_key)).toBe(true);
      expect(coverage.has(r.coverage)).toBe(true);
      expect(r.first_season).toBeGreaterThanOrEqual(seasons.first_season);
      expect(r.last_season).toBeLessThanOrEqual(seasons.last_season);
      for (let y = r.first_season; y <= r.last_season; y++) {
        const cell = `${r.stat_key}:${y}`;
        expect(seen.has(cell), `${cell} covered twice`).toBe(false);
        seen.add(cell);
      }
    }
    // The NULL-era semantics ISSUE-093 exists to preserve: the 1935-1983
    // per-match Brownlow gap must survive the port. Inside it, 1942-1945 is
    // not_applicable (no medal awarded in the war years), not not_collected —
    // as extracted from the pre-rebuild baseline.
    for (let y = 1935; y <= 1983; y++) {
      const gap = statAvail.coverage_ranges.find(
        (r: any) => r.stat_key === 'brownlow_match_votes'
          && r.first_season <= y && y <= r.last_season,
      );
      expect(gap, `brownlow_match_votes ${y} missing from grid`).toBeDefined();
      expect(gap.coverage).toBe(y >= 1942 && y <= 1945 ? 'not_applicable' : 'not_collected');
    }
  });
});

describe('venue canonical dataset', () => {
  it('carries the three unambiguous expansions unchanged', () => {
    expect(venueCanonical.canonical_names).toEqual({
      'M.C.G.': 'Melbourne Cricket Ground',
      'S.C.G.': 'Sydney Cricket Ground',
      'W.A.C.A.': 'WACA Ground',
    });
  });
});

describe('load_reference_data.py', () => {
  const loaderSource = readFileSync(
    join(root, 'tools', 'migration', 'load_reference_data.py'), 'utf8');

  it('has zero dependency on the legacy SQLite path', () => {
    // The docstring may name AFLDB_LEGACY_SQLITE to say it is not used; the
    // code must never read it or open the legacy database.
    expect(loaderSource).not.toContain('require_env("AFLDB_LEGACY_SQLITE"');
    expect(loaderSource).not.toContain("require_env('AFLDB_LEGACY_SQLITE'");
    expect(loaderSource).not.toContain('connect_legacy');
    expect(loaderSource).not.toMatch(/import sqlite|sqlite3/);
  });

  // .venv layout differs by platform: POSIX venvs put the interpreter under
  // bin/, Windows venvs under Scripts/ with a .exe suffix.
  const venvPython = process.platform === 'win32'
    ? join(root, '.venv', 'Scripts', 'python.exe')
    : join(root, '.venv', 'bin', 'python');
  const python = process.env.AFLDB_PYTHON
    ?? (existsSync(venvPython) ? venvPython : (process.platform === 'win32' ? 'python' : 'python3'));
  // common.py imports psycopg at module level, so --print-plan needs it even
  // though it never connects.
  const probe = spawnSync(python, ['-c', 'import psycopg'], { encoding: 'utf8' });
  const canRun = !probe.error && probe.status === 0;

  it.skipIf(!canRun)('--print-plan validates the datasets and is deterministic', () => {
    const run = () => spawnSync(
      python, ['tools/migration/load_reference_data.py', '--print-plan'],
      { cwd: root, encoding: 'utf8' },
    );
    const first = run();
    expect(first.status, `stderr:\n${first.stderr}`).toBe(0);
    expect(first.stdout).toContain('reference datasets valid');
    expect(first.stdout).toContain('clubs:            24');
    expect(first.stdout).toContain('stat definitions: 24');
    const second = run();
    expect(second.status).toBe(0);
    expect(second.stdout).toBe(first.stdout);
  });
});
