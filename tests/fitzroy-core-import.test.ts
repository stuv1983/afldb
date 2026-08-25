import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

/**
 * AFLDB-ISSUE-093 §13.4a — canonical fitzRoy snapshot → PostgreSQL core
 * importer, first (non-DB) validation gate.
 *
 * Static pins of the importer's contracts plus spawn tests of its
 * --validate-only mode, which performs the full manifest/snapshot
 * validation and scan/classification with zero database (and zero
 * psycopg) dependency. Fixtures are tiny synthetic snapshots with real
 * SHA-256 manifests, exercising the fail-closed paths: checksum, row
 * count, columns, version pin, attendance dedup, match join, player
 * identity, round codes and score integrity.
 */
const root = process.cwd();
const importerPath = join(root, 'tools', 'migration', 'import_fitzroy_core.py');
const importerSource = readFileSync(importerPath, 'utf8');

const venvPython = process.platform === 'win32'
  ? join(root, '.venv', 'Scripts', 'python.exe')
  : join(root, '.venv', 'bin', 'python');
const python = process.env.AFLDB_PYTHON
  ?? (existsSync(venvPython) ? venvPython : (process.platform === 'win32' ? 'python' : 'python3'));

function hasPython(): boolean {
  const probe = spawnSync(python, ['--version'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
}
const canSpawn = hasPython();

const LABEL = 'issue093-core-fixture';

// ---------------------------------------------------------------------------
// Column contracts (mirror the importer's required-column lists)
// ---------------------------------------------------------------------------

const RES_HEADER = [
  'Game', 'Date', 'Round', 'Home.Team', 'Home.Goals', 'Home.Behinds', 'Home.Points',
  'Away.Team', 'Away.Goals', 'Away.Behinds', 'Away.Points', 'Venue', 'Margin',
  'Season', 'Round.Type', 'Round.Number',
];

const PS_META = [
  'Season', 'Round', 'Date', 'Local.start.time', 'Venue', 'Attendance',
  'First.name', 'Surname', 'ID', 'Jumper.No.', 'Playing.for', 'Player', 'url',
  'Career.Games', 'DOB', 'Home.team', 'Away.team', 'Home.score', 'Away.score',
];
const STAT_COLS = [
  'Kicks', 'Marks', 'Handballs', 'Disposals', 'Goals', 'Behinds', 'Hit.Outs',
  'Tackles', 'Rebounds', 'Inside.50s', 'Clearances', 'Clangers', 'Frees.For',
  'Frees.Against', 'Contested.Possessions', 'Uncontested.Possessions',
  'Contested.Marks', 'Marks.Inside.50', 'One.Percenters', 'Bounces',
  'Goal.Assists', 'Brownlow.Votes',
];
const QUARTER_COLS: string[] = [];
for (const side of ['H', 'A']) {
  for (const q of [1, 2, 3, 4]) {
    for (const kind of ['G', 'B', 'P']) QUARTER_COLS.push(`${side}Q${q}${kind}`);
  }
}
const PS_HEADER = [...PS_META, ...STAT_COLS, ...QUARTER_COLS];

// The explicit snapshot-column -> player_match_stats-column mapping the
// importer must pin in code (never positional). Time.on.Ground has no
// target column and must not be imported.
const EXPECTED_STAT_MAP: Array<[string, string]> = [
  ['Kicks', 'kicks'], ['Marks', 'marks'], ['Handballs', 'handballs'],
  ['Disposals', 'disposals'], ['Goals', 'goals'], ['Behinds', 'behinds'],
  ['Hit.Outs', 'hitouts'], ['Tackles', 'tackles'], ['Rebounds', 'rebounds'],
  ['Inside.50s', 'inside_50s'], ['Clearances', 'clearances'],
  ['Clangers', 'clangers'], ['Frees.For', 'frees_for'],
  ['Frees.Against', 'frees_against'], ['Contested.Possessions', 'contested'],
  ['Uncontested.Possessions', 'uncontested'],
  ['Contested.Marks', 'contested_marks'], ['Marks.Inside.50', 'marks_inside_50'],
  ['One.Percenters', 'one_percenters'], ['Bounces', 'bounces'],
  ['Goal.Assists', 'goal_assists'], ['Brownlow.Votes', 'brownlow_votes'],
];

// ---------------------------------------------------------------------------
// Fixture snapshot
// ---------------------------------------------------------------------------

type Cell = string | number;

interface FixtureMatch {
  game: string; date: string; roundResults: string; roundStats: string;
  roundType: string; roundNumber: string; time: string; venue: string;
  att: string; home: string; away: string;
  hg: number; hb: number; hp: number; ag: number; ab: number; ap: number;
  margin: number;
  hq: number[][]; aq: number[][];
}

const M1: FixtureMatch = {
  game: '1', date: '2024-03-08', roundResults: 'R1', roundStats: '1',
  roundType: 'Regular', roundNumber: '1', time: '1930', venue: 'S.C.G.',
  att: '40012', home: 'Sydney', away: 'Melbourne',
  hg: 10, hb: 10, hp: 70, ag: 8, ab: 12, ap: 60, margin: 10,
  hq: [[3, 3, 21], [5, 5, 35], [8, 7, 55], [10, 10, 70]],
  aq: [[2, 2, 14], [4, 5, 29], [6, 9, 45], [8, 12, 60]],
};
// fitzRoy reports the Bulldogs as "Footscray" even in 2024: the importer
// must remap by organization era, never import a 2024 Footscray row.
const M2: FixtureMatch = {
  game: '2', date: '2024-09-06', roundResults: 'EF', roundStats: 'EF',
  roundType: 'Finals', roundNumber: '26', time: '1910', venue: 'M.C.G.',
  att: '55000', home: 'Footscray', away: 'Hawthorn',
  hg: 9, hb: 8, hp: 62, ag: 14, ab: 15, ap: 99, margin: -37,
  hq: [[2, 2, 14], [4, 4, 28], [7, 6, 48], [9, 8, 62]],
  aq: [[4, 3, 27], [7, 7, 49], [10, 11, 71], [14, 15, 99]],
};

function resultsRow(m: FixtureMatch): Cell[] {
  return [m.game, m.date, m.roundResults, m.home, m.hg, m.hb, m.hp,
    m.away, m.ag, m.ab, m.ap, m.venue, m.margin, 2024, m.roundType, m.roundNumber];
}

interface FixturePlayer {
  id: string; first: string; sur: string; url: string; dob: string;
  votes: string; playingFor: string; career: string; jumper: string;
}

function psRow(m: FixtureMatch, p: FixturePlayer,
  overrides: Record<string, Cell> = {}): Cell[] {
  const cells: Record<string, Cell> = {
    Season: 2024, Round: m.roundStats, Date: m.date,
    'Local.start.time': m.time, Venue: m.venue, Attendance: m.att,
    'First.name': p.first, Surname: p.sur, ID: p.id, 'Jumper.No.': p.jumper,
    'Playing.for': p.playingFor, Player: `${p.first} ${p.sur}`, url: p.url,
    'Career.Games': p.career, DOB: p.dob,
    'Home.team': m.home, 'Away.team': m.away,
    'Home.score': m.hp, 'Away.score': m.ap,
    Kicks: 10, Marks: 5, Handballs: 8, Disposals: 18, Goals: 2, Behinds: 1,
    'Hit.Outs': 0, Tackles: 3, Rebounds: 1, 'Inside.50s': 2, Clearances: 1,
    Clangers: 2, 'Frees.For': 1, 'Frees.Against': 0,
    'Contested.Possessions': 5, 'Uncontested.Possessions': 12,
    'Contested.Marks': 1, 'Marks.Inside.50': 1, 'One.Percenters': 2,
    Bounces: '', 'Goal.Assists': 1, 'Brownlow.Votes': p.votes,
    ...overrides,
  };
  for (const [q, [g, b, pts]] of m.hq.entries()) {
    cells[`HQ${q + 1}G`] = g; cells[`HQ${q + 1}B`] = b; cells[`HQ${q + 1}P`] = pts;
  }
  for (const [q, [g, b, pts]] of m.aq.entries()) {
    cells[`AQ${q + 1}G`] = g; cells[`AQ${q + 1}B`] = b; cells[`AQ${q + 1}P`] = pts;
  }
  return PS_HEADER.map((c) => cells[c] ?? '');
}

const P_A: FixturePlayer = {
  id: '101', first: 'John', sur: 'Smith',
  url: 'https://afltables.com/afl/stats/players/J/John_Smith0.html',
  dob: '2-Sep-1999', votes: '3', playingFor: 'Sydney', career: '29', jumper: '36',
};
// Same display name as P_A, different stable ID/URL: must stay distinct.
const P_B: FixturePlayer = {
  id: '102', first: 'John', sur: 'Smith',
  url: 'https://afltables.com/afl/stats/players/J/John_Smith1.html',
  dob: '', votes: '0', playingFor: 'Melbourne', career: '100', jumper: '22',
};
const P_C: FixturePlayer = {
  id: '103', first: 'Marcus', sur: 'Bontempelli',
  url: 'https://afltables.com/afl/stats/players/M/Marcus_Bontempelli.html',
  dob: '24-Nov-1995', votes: '', playingFor: 'Footscray', career: '250', jumper: '4',
};
const P_D: FixturePlayer = {
  id: '104', first: 'Jai', sur: 'Newcombe',
  url: 'https://afltables.com/afl/stats/players/J/Jai_Newcombe.html',
  dob: '', votes: '', playingFor: 'Hawthorn', career: '80', jumper: '5',
};

function csv(header: string[], rows: Cell[][]): string {
  return [header.join(','), ...rows.map((r) => r.join(','))].join('\n') + '\n';
}

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

interface SnapshotSpec {
  results?: Cell[][];
  playerStats?: Record<string, { header?: string[]; rows: Cell[][] }>;
  range?: { from: number; to: number };
  mutateManifest?: (manifest: any) => void;
  afterManifest?: (dir: string) => void;
}

function buildSnapshot(spec: SnapshotSpec = {}): { dir: string; manifest: string } {
  const dir = mkdtempSync(join(tmpdir(), 'issue093-core-'));
  tempDirs.push(dir);
  const files: any[] = [];

  const write = (dataset: string, filename: string, header: string[], rows: Cell[][]) => {
    const content = csv(header, rows);
    writeFileSync(join(dir, filename), content, 'utf8');
    files.push({
      dataset, filename, row_count: rows.length,
      sha256: createHash('sha256').update(content).digest('hex'),
      columns: header,
    });
  };

  const psFiles = spec.playerStats ?? {
    'player_stats_2024.csv': {
      rows: [psRow(M1, P_A), psRow(M1, P_B), psRow(M2, P_C), psRow(M2, P_D)],
    },
  };
  for (const [filename, { header, rows }] of Object.entries(psFiles)) {
    write('player_stats', filename, header ?? PS_HEADER, rows);
  }
  write('results', 'results.csv', RES_HEADER,
    spec.results ?? [resultsRow(M1), resultsRow(M2)]);

  const range = spec.range ?? { from: 2024, to: 2024 };
  const manifest: any = {
    source: 'AFL Tables via fitzRoy',
    adapter: 'tools/rebuild/fitzroy/acquire_core.R',
    adapter_schema_version: 1,
    fitzroy_version_installed: '1.8.0',
    fitzroy_version_pinned: '1.8.0',
    fitzroy_version_match: true,
    extraction_date: '2026-08-25',
    mode: 'acquire',
    snapshot_label: LABEL,
    requested_range: range,
    files,
  };
  spec.mutateManifest?.(manifest);
  const manifestPath = join(dir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  spec.afterManifest?.(dir);
  return { dir, manifest: manifestPath };
}

function run(snapshot: { dir: string; manifest: string }): ReturnType<typeof spawnSync> {
  return spawnSync(python, [importerPath, '--label', LABEL,
    '--snapshot-dir', snapshot.dir, '--manifest', snapshot.manifest,
    '--validate-only'], { cwd: root, encoding: 'utf8' });
}

// ---------------------------------------------------------------------------
// Static contract pins
// ---------------------------------------------------------------------------

describe('fitzRoy core importer contracts (AFLDB-ISSUE-093 §13.4a)', () => {
  it('has zero legacy-SQLite dependency and no top-level database import', () => {
    // The zero-legacy contract is functional, not lexical: the module
    // docstring may (correctly) document that the legacy variable is
    // never used, but no code may import sqlite3, call the legacy
    // connector, or look the variable up from the environment/config.
    expect(importerSource).not.toMatch(/^\s*(import|from)\s+sqlite3\b/m);
    expect(importerSource).not.toContain('connect_legacy');
    expect(importerSource).not.toContain('"AFLDB_LEGACY_SQLITE"');
    expect(importerSource).not.toContain("'AFLDB_LEGACY_SQLITE'");
    expect(importerSource).not.toMatch(/(environ|getenv|require_env|load_env)\s*[[(][^)\]]*AFLDB_LEGACY_SQLITE/);
    // --validate-only must work without psycopg: no module-level psycopg
    // or common import — database imports live inside the DB functions.
    expect(importerSource).not.toMatch(/^import psycopg/m);
    expect(importerSource).not.toMatch(/^from common import/m);
  });

  it('pins the explicit stat field mapping by name, not CSV position', () => {
    for (const [src, target] of EXPECTED_STAT_MAP) {
      expect(importerSource).toContain(`("${src}", "${target}")`);
    }
    // Time.on.Ground has no player_match_stats column and is unmapped.
    expect(importerSource).toContain('Time.on.Ground has no target');
    expect(importerSource).not.toContain('"Time.on.Ground",');
    expect(importerSource.match(/STAT_MAP = \[/g)).toHaveLength(1);
  });

  it('reuses the ISSUE-092 population-drop safety for external identities', () => {
    expect(importerSource).toContain('check_population_drop');
    expect(importerSource).toContain('--acknowledge-population-drop');
    expect(importerSource).toContain('--source-key');
    expect(importerSource).toContain('afltables_profile_url');
    // No fresh unguarded delete path: the reconciliation DELETE appears
    // once, after the gate.
    expect(importerSource.match(/DELETE FROM external_identities/g)).toHaveLength(1);
  });

  it('a stored profile-URL mapping to a different player fails closed', () => {
    // Phase-4a identity HALT: a canonical AFL Tables profile URL that
    // already maps to a different players.id must abort the import
    // before the reconciliation DELETE or the identity upsert — never
    // a warning, a data_issues row, or a heuristic choice. Behavioural
    // proof requires PostgreSQL and belongs to the later DB gate; the
    // fail-closed structure is pinned statically here.
    const conflictRaise = importerSource.indexOf('raise RuntimeError(\n                    f"external-identity conflict');
    const reconcileDelete = importerSource.indexOf('DELETE FROM external_identities');
    expect(conflictRaise).toBeGreaterThan(-1);
    expect(reconcileDelete).toBeGreaterThan(-1);
    expect(conflictRaise).toBeLessThan(reconcileDelete);
    expect(importerSource).toContain('refusing to reconcile');
    // The old downgrade path is gone.
    expect(importerSource).not.toContain('external_identity_conflict');
    expect(importerSource).not.toContain('left unchanged');
  });

  it('keeps the fitzRoy DOB evidence source distinct from the club-list layer', () => {
    // The provenance contract is functional, not lexical: the importer
    // pins its own evidence type and source key, never imports or
    // invokes the club-list enrichment pass, and never writes the
    // club-list evidence_type as a code string. An explanatory comment
    // naming club_all_time_list is allowed.
    expect(importerSource).toContain('DOB_EVIDENCE_TYPE = "fitzroy_player_stats"');
    expect(importerSource).toContain('SOURCE_KEY_FITZROY = "fitzroy_afldata"');
    // Exactly one evidence_type is ever written, and it is the pinned
    // constant: the INSERT takes it from DOB_EVIDENCE_TYPE.
    expect(importerSource).toContain('DOB_EVIDENCE_TYPE, "sourced"');
    // No functional coupling to the club-list importer or its data.
    expect(importerSource).not.toMatch(/^\s*(import|from)\s+enrich_birth_dates_from_club_lists\b/m);
    expect(importerSource).not.toMatch(/enrich_birth_dates_from_club_lists\s*[.(]/);
    expect(importerSource).not.toContain('club_lists');
    // The club-list evidence_type never appears as a Python string
    // literal (a bare mention inside a comment is fine).
    expect(importerSource).not.toContain('"club_all_time_list"');
    expect(importerSource).not.toContain("'club_all_time_list'");
  });

  it('never downloads: consumes only the acquired snapshot', () => {
    for (const marker of ['urllib.request', 'requests', 'http://', 'fetch_player_stats(']) {
      expect(importerSource).not.toContain(marker);
    }
  });
});

// ---------------------------------------------------------------------------
// --validate-only spawn tests (no database, no psycopg)
// ---------------------------------------------------------------------------

describe.skipIf(!canSpawn)('snapshot validation and scan (no database)', () => {
  it('a valid snapshot passes and reports the deterministic plan', () => {
    const result = run(buildSnapshot());
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const out = String(result.stdout);
    expect(out).toMatch(/(^|\n)\s*matches\s+2\b/);
    expect(out).toMatch(/matches_with_player_rows\s+2\b/);
    expect(out).toMatch(/attendance_known\s+2\b/);
    // Name collision does not merge: two John Smiths stay two players.
    expect(out).toMatch(/(^|\n)\s*players\s+4\b/);
    expect(out).toMatch(/players_with_dob\s+2\b/);
    expect(out).toMatch(/players_with_dob_conflict\s+0\b/);
    expect(out).toMatch(/player_match_rows\s+4\b/);
    expect(out).toMatch(/(^|\n)\s*venues\s+2\b/);
    expect(out).toMatch(/seasons\s+2024-2024/);
    // Era remap: 2024 "Footscray" resolves to the Western Bulldogs
    // identity; no Footscray-era row may be created for 2024.
    expect(out).toContain('Western Bulldogs');
    expect(out).not.toMatch(/club_identities.*Footscray/);
    // Brownlow: the 0-vote row counts, the two NA finals rows never do.
    expect(out).toMatch(/brownlow_round_vote_rows\s+2\b/);
  });

  it('a SHA-256 mismatch between snapshot and manifest fails closed', () => {
    const snapshot = buildSnapshot({
      afterManifest: (dir) => appendFileSync(join(dir, 'results.csv'), '\n'),
    });
    const result = run(snapshot);
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('SHA-256 mismatch');
  });

  it('a row-count mismatch fails closed', () => {
    const snapshot = buildSnapshot({
      mutateManifest: (m) => {
        m.files.find((f: any) => f.dataset === 'results').row_count += 1;
      },
      // Keep the checksum valid so the row-count check is what fires:
      // recompute nothing — the file is untouched, only the manifest lies.
    });
    const result = run(snapshot);
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('row count');
  });

  it('a missing required column fails closed', () => {
    const header = PS_HEADER.filter((c) => c !== 'Attendance');
    const strip = (row: Cell[]) => row.filter((_, i) => PS_HEADER[i] !== 'Attendance');
    const snapshot = buildSnapshot({
      playerStats: {
        'player_stats_2024.csv': {
          header,
          rows: [psRow(M1, P_A), psRow(M1, P_B), psRow(M2, P_C), psRow(M2, P_D)].map(strip),
        },
      },
    });
    const result = run(snapshot);
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('missing required column(s)');
    expect(String(result.stderr)).toContain('Attendance');
  });

  it('a snapshot acquired on an unpinned fitzRoy version fails closed', () => {
    const snapshot = buildSnapshot({
      mutateManifest: (m) => {
        m.fitzroy_version_installed = '1.7.0';
        m.fitzroy_version_match = false;
      },
    });
    const result = run(snapshot);
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain("not the pinned");
  });

  it('blank attendance is no observation and 0 is a real value', () => {
    // [40012, blank] -> 40012 (value-then-missing), [blank, 0] -> 0
    // (missing-then-zero): one distinct non-null observation wins
    // regardless of blank rows, and 0 counts as recorded.
    const snapshot = buildSnapshot({
      playerStats: {
        'player_stats_2024.csv': {
          rows: [psRow(M1, P_A), psRow(M1, P_B, { Attendance: '' }),
            psRow(M2, P_C, { Attendance: '' }), psRow(M2, P_D, { Attendance: '0' })],
        },
      },
    });
    const result = run(snapshot);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(String(result.stdout)).toMatch(/attendance_known\s+2\b/);
  });

  it('conflicting non-null attendance for one match fails closed', () => {
    const snapshot = buildSnapshot({
      playerStats: {
        'player_stats_2024.csv': {
          rows: [psRow(M1, P_A), psRow(M1, P_B, { Attendance: '40013' }),
            psRow(M2, P_C), psRow(M2, P_D)],
        },
      },
    });
    const result = run(snapshot);
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('attendance 40013 disagrees');
  });

  it('a player row with no results.csv match fails closed', () => {
    const snapshot = buildSnapshot({
      playerStats: {
        'player_stats_2024.csv': {
          rows: [psRow(M1, P_A), psRow(M1, P_B), psRow(M2, P_C),
            psRow(M2, P_D, { Date: '2024-09-07' })],
        },
      },
    });
    const result = run(snapshot);
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('no results.csv match');
  });

  it('a duplicate player-match row fails closed', () => {
    const snapshot = buildSnapshot({
      playerStats: {
        'player_stats_2024.csv': {
          rows: [psRow(M1, P_A), psRow(M1, P_A), psRow(M1, P_B),
            psRow(M2, P_C), psRow(M2, P_D)],
        },
      },
    });
    const result = run(snapshot);
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('duplicate player-match row');
  });

  it('an unrecognised round code fails closed', () => {
    const badRow = resultsRow(M1);
    badRow[2] = 'X1';
    const snapshot = buildSnapshot({ results: [badRow, resultsRow(M2)] });
    const result = run(snapshot);
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('unrecognised results round code');
  });

  it('goals/behinds that do not reconcile with points fail closed', () => {
    const badRow = resultsRow(M1);
    badRow[6] = 71; // Home.Points: 6*10+10 = 70, not 71
    badRow[12] = 11;
    const snapshot = buildSnapshot({ results: [badRow, resultsRow(M2)] });
    const result = run(snapshot);
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('do not reconcile');
  });

  it('one profile URL claimed by two stable IDs fails closed', () => {
    const snapshot = buildSnapshot({
      playerStats: {
        'player_stats_2024.csv': {
          rows: [psRow(M1, P_A), psRow(M1, P_B), psRow(M2, P_C),
            psRow(M2, { ...P_D, url: P_C.url })],
        },
      },
    });
    const result = run(snapshot);
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('claimed by IDs');
  });

  it('a club string with no era identity for the season fails closed', () => {
    // A merger transfers no history: pre-1997 "Brisbane Lions" cannot
    // silently become Brisbane Bears (separate organizations).
    const row: Cell[] = ['3', '1990-05-05', 'R1', 'Brisbane Lions', 10, 10, 70,
      'Melbourne', 8, 12, 60, 'M.C.G.', 10, 1990, 'Regular', '1'];
    const snapshot = buildSnapshot({
      results: [row],
      playerStats: { 'player_stats_1990.csv': { rows: [] } },
      range: { from: 1990, to: 1990 },
    });
    const result = run(snapshot);
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('no unambiguous identity for season 1990');
  });
});
