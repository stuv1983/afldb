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
// Normalised on read: the structural assertions below pin multi-line source shapes
// (the fail-closed identity HALT, the contract-rule refusals), and they express those
// with \n. This repository is checked out with core.autocrlf=true on Windows, so the
// file on disk has \r\n and every such assertion missed for a reason that has nothing
// to do with what the importer does. The assertions themselves are unchanged.
const importerSource = readFileSync(importerPath, 'utf8').replace(/\r\n/g, '\n');

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

// `season` is opt-in with the historical default, so every existing fixture is unchanged.
function resultsRow(m: FixtureMatch, season = 2024): Cell[] {
  return [m.game, m.date, m.roundResults, m.home, m.hg, m.hb, m.hp,
    m.away, m.ag, m.ab, m.ap, m.venue, m.margin, season, m.roundType, m.roundNumber];
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
  /**
   * Opt-in, so every existing fixture is unchanged. The full-history gates check the
   * required dataset set before seasons, so a test that wants to reach a later gate must
   * supply this one.
   */
  withPlayerDetails?: boolean;
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
  if (spec.withPlayerDetails) {
    write('player_details', 'player_details.csv', ['ID', 'First.name', 'Surname'],
      [['101', 'John', 'Smith'], ['102', 'John', 'Smith']]);
  }

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

  it('two players sharing one profile URL in a match fail closed', () => {
    // Identity is keyed on the profile URL (the durable identity), so two rows claiming
    // the same URL in the same match are a duplicate player-match, not a merge candidate.
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
    expect(String(result.stderr)).toContain('duplicate player-match row');
  });

  it('one stable ID appearing under two profile URLs fails closed', () => {
    // The other direction: the source contradicting itself about who someone is. Caught
    // across matches, where it is a genuine conflict rather than a duplicate row.
    const snapshot = buildSnapshot({
      playerStats: {
        'player_stats_2024.csv': {
          rows: [psRow(M1, P_A), psRow(M1, P_B), psRow(M2, P_C),
            psRow(M2, { ...P_D, id: P_A.id })],
        },
      },
    });
    const result = run(snapshot);
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('refusing to collapse two players');
  });

  it('accepts a debut row whose stable ID is absent but whose profile URL is canonical', () => {
    // Measured on the real 1897-2025 acquisition: 83 rows across 5 profile URLs carry a
    // canonical URL and no ID. The ID never reaches a database column, so requiring it
    // would discard real players for a value the schema does not keep. AFLDB-ISSUE-136
    // narrowed this: a blank-ID profile is accepted as a NEW player only when AFL Tables'
    // own career-game count says it is a debut (career game 1); a blank-ID profile that
    // continues a career is refused unless a tracked continuity rule names it (below).
    const snapshot = buildSnapshot({
      playerStats: {
        'player_stats_2024.csv': {
          rows: [psRow(M1, { ...P_A, id: '', career: '1' }), psRow(M1, P_B),
            psRow(M2, P_C), psRow(M2, P_D)],
        },
      },
    });
    const result = run(snapshot);
    expect(String(result.stderr) + String(result.stdout)).not.toContain('no stable ID');
    expect(result.status).toBe(0);
  });

  it('still refuses a row with no profile URL at all', () => {
    const snapshot = buildSnapshot({
      playerStats: {
        'player_stats_2024.csv': {
          rows: [psRow(M1, { ...P_A, url: '' }), psRow(M1, P_B),
            psRow(M2, P_C), psRow(M2, P_D)],
        },
      },
    });
    const result = run(snapshot);
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('no profile URL');
    // and a name is never offered as a fallback
    expect(String(result.stderr)).toContain('never identity');
  });

  function brisbaneSnapshot(season: number) {
    const row: Cell[] = ['3', `${season}-05-05`, 'R1', 'Brisbane Lions', 10, 10, 70,
      'Melbourne', 8, 12, 60, 'M.C.G.', 10, season, 'Regular', '1'];
    return buildSnapshot({
      results: [row],
      playerStats: { [`player_stats_${season}.csv`]: { rows: [] } },
      range: { from: season, to: season },
    });
  }

  it('a club string with no era identity for the season fails closed', () => {
    // 1986: the Bears did not exist yet and the Lions would not for another decade, so
    // no tracked rule covers it and the ordinary era resolution still refuses.
    const result = run(brisbaneSnapshot(1986));
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('no unambiguous identity for season 1986');
  });
});

/*
 * AFLDB-ISSUE-093 — fitzRoy SOURCE club normalisation.
 *
 * fitzRoy emits the modern "Brisbane Lions" string for historical Brisbane Bears
 * seasons. The organizations are deliberately NOT bridged by the club model (a merger
 * is not a rename, migration 017), so this is corrected as a source-scoped, era-scoped
 * rule in the fitzRoy contract — never as a club alias, which would make the two
 * interchangeable everywhere.
 */
describe.skipIf(!canSpawn)('fitzRoy source club normalisation', () => {
  const clubs = JSON.parse(readFileSync(
    join(root, 'data', 'reference', 'clubs.json'), 'utf8'));
  const contract = JSON.parse(readFileSync(
    join(root, 'tools', 'rebuild', 'fitzroy', 'fitzroy-contract.json'), 'utf8'));
  const rules = contract.source_club_normalisation.rules;

  function brisbane(season: number) {
    const row: Cell[] = ['3', `${season}-05-05`, 'R1', 'Brisbane Lions', 10, 10, 70,
      'Melbourne', 8, 12, 60, 'M.C.G.', 10, season, 'Regular', '1'];
    return run(buildSnapshot({
      results: [row],
      playerStats: { [`player_stats_${season}.csv`]: { rows: [] } },
      range: { from: season, to: season },
    }));
  }

  it.each([1987, 1996])('%i "Brisbane Lions" resolves to Brisbane Bears', (season) => {
    const result = brisbane(season);
    expect(result.status).toBe(0);
    expect(String(result.stdout)).toContain('Brisbane Bears');
    expect(String(result.stdout)).not.toContain('Brisbane Lions');
  });

  it.each([1997, 2024])('%i "Brisbane Lions" stays Brisbane Lions', (season) => {
    const result = brisbane(season);
    expect(result.status).toBe(0);
    expect(String(result.stdout)).toContain('Brisbane Lions');
    expect(String(result.stdout)).not.toContain('Brisbane Bears');
  });

  it('keeps Bears and Lions as distinct canonical organizations', () => {
    const bears = clubs.identities.find((c: any) => c.hist === 'Brisbane Bears');
    const lions = clubs.identities.find((c: any) => c.hist === 'Brisbane Lions');
    expect(bears.slug).not.toBe(lions.slug);
    // a merger is link-only: neither succeeds the other, so nothing collapses them
    expect(bears.successor_hist).toBeNull();
    expect(lions.successor_hist).toBeNull();
    expect(bears.succession).toBe('merged');
    expect(clubs.organization_relations.some((r: any) =>
      r.from_slug === 'brisbane-bears' && r.to_slug === 'brisbane-lions'
      && r.relation === 'merged_into')).toBe(true);
  });

  it('introduces no global alias or generic brisbane mapping', () => {
    // clubs.json is untouched: the rule lives in the SOURCE contract only.
    // "Brisbane Lions" may appear as hist/name/short_name of ONE identity — what must
    // never happen is two identities answering to it, which is what an alias would do.
    const owners = clubs.identities.filter((c: any) =>
      [c.hist, c.name, c.short_name, c.abbreviation].includes('Brisbane Lions'));
    expect(owners.map((c: any) => c.hist)).toEqual(['Brisbane Lions']);
    const bearsOwners = clubs.identities.filter((c: any) =>
      [c.hist, c.name, c.short_name, c.abbreviation].includes('Brisbane Bears'));
    expect(bearsOwners.map((c: any) => c.hist)).toEqual(['Brisbane Bears']);
    // and no generic "brisbane" mapping exists anywhere
    const allAliases = clubs.identities.flatMap(
      (c: any) => [c.hist, c.name, c.short_name, c.abbreviation, c.slug]);
    expect(allAliases).not.toContain('Brisbane');
    expect(allAliases).not.toContain('brisbane');
    expect(contract.source_club_normalisation.is_alias).toBe(false);
    // and the resolver never adds these to its alias table
    expect(importerSource).toContain('never enter alias_to_hist');
  });

  it('scopes the rule to one source string and one exact season range', () => {
    const brisbane = rules.filter((r: any) => r.raw === 'Brisbane Lions');
    expect(brisbane).toHaveLength(1);
    expect(brisbane[0]).toMatchObject({
      raw: 'Brisbane Lions',
      first_season: 1987,
      last_season: 1996,
      resolves_to_hist: 'Brisbane Bears',
    });
    // the target's own era must contain the rule's range, or the resolver refuses
    const bears = clubs.identities.find((c: any) => c.hist === 'Brisbane Bears');
    expect(brisbane[0].first_season).toBeGreaterThanOrEqual(bears.first_season);
    expect(brisbane[0].last_season).toBeLessThanOrEqual(bears.last_season);
  });

  it('refuses a tracked rule that is itself inconsistent', () => {
    expect(importerSource).toContain('source_club_normalisation names unknown identity');
    expect(importerSource).toContain("outside \"\n                    f\"{target!r}'s own era");
  });
});

/*
 * AFLDB-ISSUE-093 — full-history completeness gates (--require-full-history).
 *
 * Every case here is a REFUSAL, proven with synthetic fixtures and no network. The
 * positive path is deliberately not faked: a passing full-history snapshot needs all
 * 129 required seasons and their matching results, so it is earned by the real
 * acquisition and measured then, not asserted by a fixture here.
 */
describe.skipIf(!canSpawn)('full-history completeness gates', () => {
  const CONTRACT = JSON.parse(readFileSync(
    join(root, 'tools', 'rebuild', 'fitzroy', 'fitzroy-contract.json'), 'utf8'));
  const FH = CONTRACT.full_history;
  const FIRST = FH.season_range.first_season as number;
  const LAST = FH.season_range.last_season as number;

  function runFull(snapshot: { dir: string; manifest: string }) {
    return spawnSync(python, [importerPath, '--label', LABEL,
      '--snapshot-dir', snapshot.dir, '--manifest', snapshot.manifest,
      '--validate-only', '--require-full-history'], { cwd: root, encoding: 'utf8' });
  }

  const claimFull = (m: any) => {
    m.full_history = true;
    m.completeness = 'full_history';
  };

  it('adjudicates from the artefacts, not from the manifest claim', () => {
    // The manifest's own `full_history` field is deliberately NOT consulted: the first
    // real acquisition published `full_history: true` while this validator rejected the
    // snapshot. A 2024-only snapshot is refused on the evidence — its range — whether or
    // not it claims completeness, and claiming completeness cannot save it.
    for (const mutate of [undefined, claimFull]) {
      const result = runFull(buildSnapshot({ mutateManifest: mutate }));
      expect(result.status).not.toBe(0);
      expect(String(result.stderr)).toContain('does not equal the contract');
    }
  });

  it('refuses a known trial label even when the manifest claims full history', () => {
    const result = runFull(buildSnapshot({
      mutateManifest: (m) => { claimFull(m); m.snapshot_label = FH.known_trial_labels[0]; },
    }));
    expect(result.status).not.toBe(0);
    // caught either as a label or by the label/dir mismatch — both are refusals
    expect(String(result.stderr)).toMatch(/known trial label|snapshot_label/);
  });

  it('refuses a claim whose requested_range is not the contract range', () => {
    const result = runFull(buildSnapshot({ mutateManifest: claimFull }));
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('does not equal the contract');
  });

  it('refuses a claim with required seasons absent', () => {
    // right range, but only one season of artefacts: an incomplete acquisition can never
    // publish itself as complete
    const result = runFull(buildSnapshot({
      range: { from: FIRST, to: LAST },
      withPlayerDetails: true,
      mutateManifest: claimFull,
    }));
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toMatch(/required season\(s\) absent/);
    expect(String(result.stderr)).toContain('terminal, never an absence');
  });

  it('refuses a duplicate season artefact', () => {
    const result = runFull(buildSnapshot({
      range: { from: FIRST, to: LAST },
      withPlayerDetails: true,
      mutateManifest: (m) => {
        claimFull(m);
        const ps = m.files.find((f: any) => f.dataset === 'player_stats');
        m.files.push({ ...ps });
      },
    }));
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toMatch(/duplicate player_stats artefact|required season/);
  });

  it('refuses a missing required dataset', () => {
    const result = runFull(buildSnapshot({
      range: { from: FIRST, to: LAST },
      mutateManifest: (m) => {
        claimFull(m);
        m.files = m.files.filter((f: any) => f.dataset !== 'results');
      },
    }));
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toMatch(/missing required dataset|results/);
  });

  it('still refuses on raw hash drift before any full-history gate is reached', () => {
    const result = runFull(buildSnapshot({
      range: { from: FIRST, to: LAST },
      mutateManifest: claimFull,
      afterManifest: (dir) => {
        appendFileSync(join(dir, 'results.csv'), 'x', 'utf8');
      },
    }));
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toMatch(/SHA-256 mismatch|row count/);
  });

  it('declares the identity requirement the gate enforces', () => {
    expect(FH.identity_requirement.required_columns).toEqual(['ID', 'url']);
    expect(FH.identity_requirement.rule).toMatch(/never inferred from a name/);
    expect(importerSource).toContain('identity incomplete');
  });

  it('treats a missing season as failure while no gap is approved', () => {
    expect(FH.approved_source_gaps.seasons).toEqual([]);
    expect(importerSource).toContain('approved source gap');
  });
});

/*
 * AFLDB-ISSUE-099 T2 — the in-season adjudicator.
 *
 * An in-season snapshot is a partial observation of a season still being played. It is a
 * THIRD acquisition kind with its OWN gate, never a relaxed full-history gate, and the two
 * refuse each other explicitly so an in-season partial can never drift into the historical
 * fail-closed contract or into the accepted-baseline register.
 */
describe.skipIf(!canSpawn)('in-season completeness gates (AFLDB-ISSUE-099)', () => {
  const CONTRACT = JSON.parse(readFileSync(
    join(root, 'tools', 'rebuild', 'fitzroy', 'fitzroy-contract.json'), 'utf8'));
  const SEASONS = JSON.parse(readFileSync(
    join(root, 'data', 'reference', 'seasons.json'), 'utf8'));
  const INS = CONTRACT.in_season;
  const SEASON = SEASONS.in_progress_seasons[0] as number;
  const COMPLETED = CONTRACT.full_history.season_range.last_season as number;

  // Two regular-round matches in the in-progress season. P5 measured no finals rows
  // in-season, so neither fixture is a final.
  const IM1: FixtureMatch = { ...M1, date: `${SEASON}-03-05` };
  const IM2: FixtureMatch = {
    ...M2, date: `${SEASON}-05-16`, roundResults: 'R10', roundStats: '10',
    roundType: 'Regular', roundNumber: '10',
  };

  const inSeasonSpec = (
    over: Partial<SnapshotSpec> = {},
    season = SEASON,
    rowOverrides: Record<string, Cell> = {},
  ): SnapshotSpec => ({
    results: [resultsRow(IM1, season), resultsRow(IM2, season)],
    playerStats: {
      [`player_stats_${season}.csv`]: {
        rows: [
          psRow(IM1, P_A, { Season: season, ...rowOverrides }),
          psRow(IM1, P_B, { Season: season }),
          psRow(IM2, P_C, { Season: season }),
          psRow(IM2, P_D, { Season: season }),
        ],
      },
    },
    range: { from: season, to: season },
    mutateManifest: (m: any) => { m.acquisition_kind = 'in_season_partial'; },
    ...over,
  });

  const runWith = (snapshot: { dir: string; manifest: string }, ...gates: string[]) =>
    spawnSync(python, [importerPath, '--label', LABEL,
      '--snapshot-dir', snapshot.dir, '--manifest', snapshot.manifest,
      '--validate-only', ...gates], { cwd: root, encoding: 'utf8' });

  const runInSeason = (snapshot: { dir: string; manifest: string }) =>
    runWith(snapshot, '--require-in-season');

  it('passes a single in-progress season acquired as an in_season_partial', () => {
    const result = runInSeason(buildSnapshot(inSeasonSpec()));
    expect(result.status).toBe(0);
    expect(String(result.stdout)).toContain('in-season gates PASSED');
    expect(String(result.stdout)).toContain('no database access');
  });

  it('refuses a snapshot that is not an in_season_partial acquisition', () => {
    // No acquisition_kind at all: a pre-ISSUE-099 manifest reads as a core snapshot, and
    // absence must never read as "unknown, allow".
    const result = runInSeason(buildSnapshot(inSeasonSpec({ mutateManifest: undefined })));
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('in_season_partial');
    expect(String(result.stderr)).toContain('adjudicates in-season partials ONLY');
  });

  it('refuses a range covering more than one season', () => {
    const result = runInSeason(buildSnapshot(inSeasonSpec({
      range: { from: SEASON - 1, to: SEASON },
    })));
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('covers exactly one season');
  });

  it('refuses a completed season, whatever the manifest claims', () => {
    // The most important negative: the in-season gate is not a back door into the
    // historical range. seasons.json is the one authority for what is still being played.
    const result = runInSeason(buildSnapshot(inSeasonSpec({}, COMPLETED)));
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('not declared in progress');
    expect(String(result.stderr)).toContain('never in-season');
  });

  it('refuses a dataset the in-season contract does not permit', () => {
    const result = runInSeason(buildSnapshot(inSeasonSpec({ withPlayerDetails: true })));
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('not permitted in an in-season snapshot');
    expect(String(result.stderr)).toContain('player_details');
  });

  it('tolerates an absent fitzRoy ID but never an absent profile URL (P5)', () => {
    // AFLDB-ISSUE-099 §2.1: 82 in-season rows carried no ID and none carried no url.
    // Requiring ID in-season would reject real appearances.
    const ok = runInSeason(buildSnapshot(inSeasonSpec({}, SEASON, { ID: '' })));
    expect(ok.status).toBe(0);
    expect(String(ok.stdout)).toMatch(/missing_id\s+1/);
    expect(String(ok.stdout)).toMatch(/missing_url\s+0/);

    const bad = runInSeason(buildSnapshot(inSeasonSpec({}, SEASON, { url: '' })));
    expect(bad.status).not.toBe(0);
    expect(String(bad.stderr)).toMatch(/profile URL|no usable/);
  });

  it('--require-full-history refuses an in_season_partial explicitly, not by range', () => {
    const result = runWith(buildSnapshot(inSeasonSpec()), '--require-full-history');
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('in_season_partial');
    expect(String(result.stderr)).toContain('can NEVER satisfy --require-full-history');
    // The refusal is for WHAT IT IS, on top of the range check — not incidentally for the
    // range it happens to cover.
    expect(String(result.stderr)).not.toContain('does not equal the contract');
  });

  it('--require-accepted-baseline refuses an in_season_partial before the register', () => {
    const result = runWith(buildSnapshot(inSeasonSpec()), '--require-accepted-baseline');
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('can NEVER satisfy --require-accepted-baseline');
    // It never reaches the acceptance register, so it can never be reported as merely
    // "not the accepted baseline" — a label problem the operator might try to fix.
    expect(String(result.stderr)).not.toContain('is not the accepted baseline');
  });

  it('refuses to combine the in-season and historical gates', () => {
    for (const gate of ['--require-full-history', '--require-accepted-baseline']) {
      const result = runWith(buildSnapshot(inSeasonSpec()), '--require-in-season', gate);
      expect(result.status).not.toBe(0);
      expect(String(result.stderr)).toContain('cannot be combined');
    }
  });

  it('never reaches the database import path', () => {
    // AFLDB-ISSUE-099 F4/§15: the canonical writers upsert with no ownership predicate and
    // delete by match and season. An in-season snapshot reaches PostgreSQL only through
    // the reviewed settle pass, so --require-in-season without --validate-only refuses
    // BEFORE any connection is attempted.
    const snapshot = buildSnapshot(inSeasonSpec());
    const result = spawnSync(python, [importerPath, '--label', LABEL,
      '--snapshot-dir', snapshot.dir, '--manifest', snapshot.manifest,
      '--require-in-season'], { cwd: root, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('OFFLINE ONLY');
    expect(String(result.stderr)).toContain('settle-afltables.ts');
    expect(String(result.stdout)).not.toContain('AFLDB fitzRoy core import');
  });

  it('declares the in-season contract the gate re-derives', () => {
    expect(INS.acquisition_kind).toBe('in_season_partial');
    expect(INS.required_datasets).toEqual(['player_stats', 'results']);
    expect(INS.allowed_datasets).toEqual(['player_stats', 'results']);
    expect(INS.identity_requirement.required_columns).toEqual(['url']);
    expect(INS.identity_requirement.enrichment_columns).toEqual(['ID']);
    expect(INS.never_admissible_for.gates).toEqual([
      '--require-full-history', '--require-accepted-baseline',
    ]);
    expect(importerSource).toContain('def enforce_in_season');
    expect(importerSource).toContain('--require-in-season');
    // The gate reads the contract and the season register, never the manifest's claim.
    expect(importerSource).toContain('def load_in_progress_seasons');
    expect(importerSource).toContain('in_progress_seasons');
  });

  it('keeps ONE implementation of the identity-coverage contract', () => {
    // Both gates measure identity the same way; a second copy would be the acquirer/
    // validator drift ISSUE-093 §H11 was burned by, in miniature.
    expect(importerSource.match(/def measure_identity_coverage/g)).toHaveLength(1);
    expect(importerSource.match(/measure_identity_coverage\(entries, snapshot_dir/g))
      .toHaveLength(2);
    expect(importerSource.match(/identity incomplete/g)).toHaveLength(1);
  });
});

/*
 * AFLDB-ISSUE-093 — tracked per-row source corrections.
 *
 * fitzRoy emitted the CARTESIAN PRODUCT of two distinct Jim Stewarts' identities and
 * biographies for St Kilda v Essendon, Round 10, 1909: 2 urls x 2 (Age, Career.Games)
 * pairs = 4 rows where AFL Tables has 2. The correction drops the two rows that
 * correspond to no real appearance; the two genuine rows are already correct.
 */
/* ------------------------------------------------------------------ *
 * AFLDB-ISSUE-136 — a renumbered AFL Tables profile URL must not split a
 * career into two canonical players.
 *
 * fitzRoy serves completed seasons from its cached release and scrapes the
 * newest season live, so a player whose AFL Tables profile was renumbered
 * arrives under a NEW url with a BLANK ID. Identity is the url, so the
 * importer seeded a second player. The fix is a tracked, fail-closed
 * `profile_url_continuity` rule bound to source evidence (the continuing
 * ID, the seasons, the row count, and AFL Tables' own career-game count
 * continuing by exactly one); a blank-ID profile no rule names is refused
 * unless it is a career-game-1 debut. Measured on full-history-20260902:
 * four renumbered profiles (Cameron, Graham, Ross, Williams) and one
 * debutant (Billy Wilson).
 * ------------------------------------------------------------------ */
describe.skipIf(!canSpawn)('renumbered profile URL continuity (AFLDB-ISSUE-136)', () => {
  const contractPath = join(root, 'tools', 'rebuild', 'fitzroy', 'fitzroy-contract.json');
  const REAL_CONTRACT = JSON.parse(readFileSync(contractPath, 'utf8'));

  /** The 2025 fixture match: same clubs as M1, one season later. */
  const M_2025: FixtureMatch = { ...M1, game: '3', date: '2025-03-14' };

  /** P_A's profile as AFL Tables renumbered it: blank ID, new suffix, career continues. */
  const P_A_RENUMBERED: FixturePlayer = {
    ...P_A, id: '',
    url: 'https://afltables.com/afl/stats/players/J/John_Smith3.html', career: '30',
  };

  const RULE = {
    id: 'fixture-john-smith-renumbered-profile',
    dataset: 'player_stats',
    file: 'player_stats_2025.csv',
    continuing_url: 'players/J/John_Smith0.html',
    renumbered_url: 'players/J/John_Smith3.html',
    expect: {
      continuing_id: '101', continuing_last_season: 2024, continuing_last_career_game: 29,
      renumbered_first_season: 2025, renumbered_last_season: 2025,
      renumbered_first_career_game: 30, renumbered_rows: 1,
    },
    authority: 'fixture', reason: 'fixture',
  };

  /** The real contract with ONLY these continuity rules, written for --contract. */
  function contractWith(rules: unknown[]): string {
    const dir = mkdtempSync(join(tmpdir(), 'issue136-contract-'));
    tempDirs.push(dir);
    const contract = {
      ...REAL_CONTRACT,
      profile_url_continuity: { ...REAL_CONTRACT.profile_url_continuity, rules },
    };
    const path = join(dir, 'fitzroy-contract.json');
    writeFileSync(path, JSON.stringify(contract, null, 2), 'utf8');
    return path;
  }

  /** 2024 (P_A with ID) + 2025 (P_A renumbered, blank ID). */
  function splitSnapshot(
    renumbered: Partial<FixturePlayer> = {}, continuing: Partial<FixturePlayer> = {},
    extra2024: Cell[][] = [],
  ) {
    return buildSnapshot({
      results: [resultsRow(M1), resultsRow(M2), resultsRow(M_2025, 2025)],
      playerStats: {
        'player_stats_2024.csv': {
          rows: [psRow(M1, { ...P_A, ...continuing }), psRow(M1, P_B),
            psRow(M2, P_C), psRow(M2, P_D), ...extra2024],
        },
        'player_stats_2025.csv': {
          rows: [psRow(M_2025, { ...P_A_RENUMBERED, ...renumbered }, { Season: 2025 }),
            psRow(M_2025, P_B, { Season: 2025 })],
        },
      },
      range: { from: 2024, to: 2025 },
    });
  }

  const runWith = (snapshot: { dir: string; manifest: string }, contract: string) =>
    spawnSync(python, [importerPath, '--label', LABEL,
      '--snapshot-dir', snapshot.dir, '--manifest', snapshot.manifest,
      '--validate-only', '--contract', contract], { cwd: root, encoding: 'utf8' });

  type ContinuityRule = {
    id: string; file: string; continuing_url: string; renumbered_url: string;
    expect: Record<string, number> & { continuing_id: string };
  };

  it('the tracked contract names exactly the four measured renumberings, and not the debutant', () => {
    const rules: ContinuityRule[] = REAL_CONTRACT.profile_url_continuity.rules;
    expect(rules.map((r) => r.id).sort()).toEqual([
      '2025-charlie-cameron-renumbered-profile',
      '2025-jack-graham-renumbered-profile',
      '2025-jack-ross-renumbered-profile',
      '2025-jack-williams-renumbered-profile',
    ]);
    expect(rules.map((r) => [r.continuing_url, r.renumbered_url])).toEqual([
      ['players/C/Charlie_Cameron.html', 'players/C/Charlie_Cameron3.html'],
      ['players/J/Jack_Graham.html', 'players/J/Jack_Graham2.html'],
      ['players/J/Jack_Ross.html', 'players/J/Jack_Ross3.html'],
      ['players/J/Jack_Williams.html', 'players/J/Jack_Williams3.html'],
    ]);
    for (const r of rules) {
      expect(r.file).toBe('player_stats_2025.csv');
      expect(r.expect.renumbered_first_career_game)
        .toBe(r.expect.continuing_last_career_game + 1);
      expect(r.expect.continuing_last_season).toBeLessThan(r.expect.renumbered_first_season);
    }
    // 25 + 18 + 23 + 13 = the 79 blank-ID rows that are renumberings; the other 4 of the
    // 83 are Billy Wilson's debut season, which no rule may name.
    expect(rules.reduce((n, r) => n + r.expect.renumbered_rows, 0)).toBe(79);
    expect(JSON.stringify(rules)).not.toContain('Billy_Wilson');
    expect(REAL_CONTRACT.profile_url_continuity.is_alias).toBe(false);
  });

  it('pins the fail-closed structure in the importer', () => {
    expect(importerSource).toContain('def load_profile_continuity_rules');
    expect(importerSource).toContain('def apply_profile_continuity');
    expect(importerSource).toContain('def refuse_unresolved_renumbering');
    // In-season the fold and the refusal are both disabled — the settle resolves
    // registered identities and never seeds a player.
    expect(importerSource).toContain('None if args.require_in_season');
    // A database that already holds the split HALTs before the reconciliation DELETE.
    const splitHalt = importerSource.indexOf('f"external-identity split');
    const reconcileDelete = importerSource.indexOf('DELETE FROM external_identities');
    expect(splitHalt).toBeGreaterThan(-1);
    expect(splitHalt).toBeLessThan(reconcileDelete);
    // Every profile path of a player is registered to the one players.id.
    expect(importerSource).toContain('for path in sorted(fact.urls):');
    // Nothing name-based was introduced.
    expect(importerSource).not.toMatch(/fuzzy|difflib|SequenceMatcher/);
  });

  it('without a rule, a blank-ID profile that continues a career is refused, never seeded', () => {
    const result = runWith(splitSnapshot(), contractWith([]));
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('players/J/John_Smith3.html');
    expect(String(result.stderr)).toContain('career game 30');
    expect(String(result.stderr)).toContain('no profile_url_continuity rule names it');
    expect(String(result.stderr)).toContain('Refusing to seed a new player');
    expect(String(result.stderr)).toContain('never identity');
  });

  it('under a tracked rule the renumbered profile folds into the continuing player', () => {
    const result = runWith(splitSnapshot(), contractWith([RULE]));
    expect(result.status).toBe(0);
    const out = String(result.stdout);
    // Four fixture players, not five: the fold happened.
    expect(out).toMatch(/players\s+4\b/);
    expect(out).toMatch(/players_with_renumbered_profile\s+1\b/);
    expect(out).toContain('profile URL continuity applied (AFLDB-ISSUE-136)');
    expect(out).toContain('players/J/John_Smith3.html -> players/J/John_Smith0.html');
    expect(out).toContain('career games 29 -> 30');
    // Still two John Smiths: P_B (ID 102, its own url) is untouched by the fold.
    expect(out).not.toContain('John_Smith1.html ->');
  });

  it('a blank-ID profile that debuts at career game 1 is a new player and needs no rule', () => {
    // Billy Wilson's shape: no ID, first row career game 1, same surname as older
    // profiles. Never folded, never refused.
    const result = runWith(splitSnapshot({ career: '1', first: 'Billy', sur: 'Smith',
      url: 'https://afltables.com/afl/stats/players/B/Billy_Smith2.html' }), contractWith([]));
    expect(result.status).toBe(0);
    expect(String(result.stdout)).toMatch(/players\s+5\b/);
    expect(String(result.stdout)).not.toContain('continuity applied');
  });

  it('a rule is out of scope when the artefact it names is absent, and the refusal still runs', () => {
    // The real contract's four rules name player_stats_2025.csv; a 2024-only snapshot
    // has nothing to fold and passes exactly as before.
    const ok = run(buildSnapshot());
    expect(ok.status).toBe(0);
    expect(String(ok.stdout)).not.toContain('continuity applied');
    // ...but a blank-ID veteran in that same 2024-only snapshot is still refused.
    const bad = run(buildSnapshot({
      playerStats: {
        'player_stats_2024.csv': {
          rows: [psRow(M1, { ...P_A, id: '', career: '29' }), psRow(M1, P_B),
            psRow(M2, P_C), psRow(M2, P_D)],
        },
      },
    }));
    expect(bad.status).not.toBe(0);
    expect(String(bad.stderr)).toContain('no profile_url_continuity rule names it');
  });

  it('a rule in scope whose continuing profile is absent is refused (partial snapshot)', () => {
    const snapshot = buildSnapshot({
      results: [resultsRow(M_2025, 2025)],
      playerStats: {
        'player_stats_2025.csv': {
          rows: [psRow(M_2025, P_A_RENUMBERED, { Season: 2025 }),
            psRow(M_2025, P_B, { Season: 2025 })],
        },
      },
      range: { from: 2025, to: 2025 },
    });
    const result = runWith(snapshot, contractWith([RULE]));
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('has no rows in this snapshot');
  });

  it('refuses when the renumbered profile carries a fitzRoy ID', () => {
    const result = runWith(splitSnapshot({ id: '999' }), contractWith([RULE]));
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('carries fitzRoy ID 999');
  });

  it('refuses when the continuing profile does not carry the bound ID', () => {
    const result = runWith(splitSnapshot(), contractWith([
      { ...RULE, expect: { ...RULE.expect, continuing_id: '102' } }]));
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain("rule binds '102'");
  });

  it("refuses when AFL Tables' career-game numbering does not continue by one", () => {
    const result = runWith(splitSnapshot({ career: '31' }), contractWith([RULE]));
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('career games run 29 -> 31');
  });

  it('refuses when the boundary row has no career-game count to prove continuity', () => {
    const result = runWith(splitSnapshot({ career: '' }), contractWith([RULE]));
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('continuity cannot be proved');
  });

  it('refuses when the two profiles overlap in a season', () => {
    // The renumbered url also appears in 2024 (a second Sydney row in M1 under its own
    // url), so its span is 2024-2025, not 2025.
    const result = runWith(splitSnapshot({}, {}, [psRow(M1, { ...P_A_RENUMBERED, career: '29' })]),
      contractWith([RULE]));
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('spans 2024-2025');
  });

  it('refuses when the two profiles disagree on DOB or on the name fields', () => {
    const dob = runWith(splitSnapshot({ dob: '1-Jan-1990' }), contractWith([RULE]));
    expect(dob.status).not.toBe(0);
    expect(String(dob.stderr)).toContain('DOB disagrees');

    const name = runWith(splitSnapshot({ first: 'Jon' }), contractWith([RULE]));
    expect(name.status).not.toBe(0);
    expect(String(name.stderr)).toContain('name fields disagree');
  });

  it('refuses when the bound row count or seasons no longer match the artefacts', () => {
    const rows = runWith(splitSnapshot(), contractWith([
      { ...RULE, expect: { ...RULE.expect, renumbered_rows: 2 } }]));
    expect(rows.status).not.toBe(0);
    expect(String(rows.stderr)).toContain('carries 1 row(s), rule binds 2');

    const seasons = runWith(splitSnapshot(), contractWith([
      { ...RULE, expect: { ...RULE.expect, continuing_last_season: 2023 } }]));
    expect(seasons.status).not.toBe(0);
    expect(String(seasons.stderr)).toContain('continuing profile ends in 2024, rule binds 2023');
  });

  it('refuses a malformed rule before any row is read', () => {
    const same = runWith(splitSnapshot(), contractWith([
      { ...RULE, renumbered_url: RULE.continuing_url }]));
    expect(same.status).not.toBe(0);
    expect(String(same.stderr)).toContain('is malformed');

    const gap = runWith(splitSnapshot(), contractWith([
      { ...RULE, expect: { ...RULE.expect, renumbered_first_career_game: 31 } }]));
    expect(gap.status).not.toBe(0);
    expect(String(gap.stderr)).toContain('continuing_last_career_game + 1');

    const raw = runWith(splitSnapshot(), contractWith([
      { ...RULE, renumbered_url: P_A_RENUMBERED.url }]));
    expect(raw.status).not.toBe(0);
    expect(String(raw.stderr)).toContain('normalised profile path');
  });

  it('never applies in-season: a blank-ID veteran row still validates under --require-in-season', () => {
    const SEASONS = JSON.parse(readFileSync(
      join(root, 'data', 'reference', 'seasons.json'), 'utf8'));
    const season = SEASONS.in_progress_seasons[0] as number;
    const IM: FixtureMatch = { ...M1, date: `${season}-03-05` };
    const snapshot = buildSnapshot({
      results: [resultsRow(IM, season)],
      playerStats: {
        [`player_stats_${season}.csv`]: {
          rows: [psRow(IM, { ...P_A_RENUMBERED, career: '45' }, { Season: season }),
            psRow(IM, P_B, { Season: season })],
        },
      },
      range: { from: season, to: season },
      mutateManifest: (m) => { m.acquisition_kind = 'in_season_partial'; },
    });
    const result = spawnSync(python, [importerPath, '--label', LABEL,
      '--snapshot-dir', snapshot.dir, '--manifest', snapshot.manifest,
      '--validate-only', '--require-in-season'], { cwd: root, encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(String(result.stdout)).toContain('in-season gates PASSED');
    expect(String(result.stdout) + String(result.stderr)).not.toContain('continuity');
  });
});

/* ------------------------------------------------------------------ *
 * AFLDB-ISSUE-128 — an in-season run may not report success while it
 * silently drops rows AFL Tables supplied.
 * ------------------------------------------------------------------ */

/**
 * The fixture is the REAL 2026 Wildcard Final vocabulary, measured from the
 * live source on 2026-09-03, not an invented sentinel:
 *
 *   results.csv        Round = 'WF', Round.Type = 'Regular', Round.Number = ''
 *   player_stats.csv   Round = 'Wildcard Final'
 *
 * `fetch_results_afltables()` reads afltables.com/afl/stats/biglists/bg3.txt
 * live and returned both 28/29-Aug-2026 Wildcard Finals; `Round.Number` is
 * blank because fitzRoy's own `round_levels` factor has no `WF` level, and
 * `Round.Type` says `Regular` for the same reason. Neither vocabulary is in
 * `FINALS_CODES`, so both rows lose their identity here.
 *
 * What this suite pins is NOT that AFLDB imports them — it cannot, because
 * `matches.round_type` is an enum with no wildcard member (`AFLDB-ISSUE-129`
 * owns that decision). It is that the run SAYS SO. The measured behaviour
 * before this change was 209 acquired matches, 207 emitted, 94 unkeyed
 * rejections, exit 0, and a nightly job reporting success.
 */
const M_HA_2026: FixtureMatch = {
  game: '17043', date: '2026-08-23', roundResults: 'R25', roundStats: '25',
  roundType: 'Regular', roundNumber: '25', time: '1220', venue: 'Docklands',
  att: '29200', home: 'Essendon', away: 'Port Adelaide',
  hg: 14, hb: 11, hp: 95, ag: 16, ab: 9, ap: 105, margin: -10,
  hq: [[2, 5, 17], [5, 8, 38], [9, 9, 63], [14, 11, 95]],
  aq: [[3, 3, 21], [8, 6, 54], [9, 8, 62], [16, 9, 105]],
};

/** 28-Aug-2026 Wildcard Final, exactly as AFL Tables publishes it. */
const M_WF_2026: FixtureMatch = {
  game: '17046', date: '2026-08-28', roundResults: 'WF', roundStats: 'Wildcard Final',
  // fitzRoy cannot rank a round code its factor has no level for, so the
  // acquired row genuinely carries an empty Round.Number and 'Regular'.
  roundType: 'Regular', roundNumber: '', time: '1940', venue: 'M.C.G.',
  att: '61000', home: 'Footscray', away: 'Collingwood',
  hg: 14, hb: 12, hp: 96, ag: 14, ab: 9, ap: 93, margin: 3,
  hq: [[3, 4, 22], [7, 7, 49], [11, 9, 75], [14, 12, 96]],
  aq: [[4, 2, 26], [8, 4, 52], [11, 7, 73], [14, 9, 93]],
};

/** Rostered to the fixture's own clubs: the match join is by Playing.for. */
const P_ESS: FixturePlayer = {
  id: '201', first: 'Zach', sur: 'Merrett',
  url: 'https://afltables.com/afl/stats/players/Z/Zach_Merrett.html',
  dob: '', votes: '3', playingFor: 'Essendon', career: '260', jumper: '7',
};
const P_PORT: FixturePlayer = {
  id: '202', first: 'Connor', sur: 'Rozee',
  url: 'https://afltables.com/afl/stats/players/C/Connor_Rozee.html',
  dob: '', votes: '2', playingFor: 'Port Adelaide', career: '140', jumper: '8',
};
const P_COLL: FixturePlayer = {
  id: '203', first: 'Nick', sur: 'Daicos',
  url: 'https://afltables.com/afl/stats/players/N/Nick_Daicos.html',
  dob: '', votes: '', playingFor: 'Collingwood', career: '90', jumper: '35',
};

const WF_PLAYER: FixturePlayer = {
  id: '105', first: 'Adam', sur: 'Treloar',
  url: 'https://afltables.com/afl/stats/players/A/Adam_Treloar.html',
  dob: '', votes: '', playingFor: 'Footscray', career: '240', jumper: '2',
};

function inSeason2026Snapshot(): { dir: string; manifest: string } {
  const ps = (m: FixtureMatch, p: FixturePlayer) => psRow(m, p, {
    Season: 2026, Round: m.roundStats, Attendance: m.att,
  });
  return buildSnapshot({
    range: { from: 2026, to: 2026 },
    results: [resultsRow(M_HA_2026, 2026), resultsRow(M_WF_2026, 2026)],
    playerStats: {
      'player_stats_2026.csv': {
        rows: [
          ps(M_HA_2026, P_ESS), ps(M_HA_2026, P_PORT),
          ps(M_WF_2026, WF_PLAYER), ps(M_WF_2026, P_COLL),
        ],
      },
    },
    // The in-season adjudicator refuses anything that is not an
    // in_season_partial, so the fixture must declare what it really is.
    mutateManifest: (manifest) => { manifest.acquisition_kind = 'in_season_partial'; },
  });
}

function emitInSeason(
  snapshot: { dir: string; manifest: string },
): { run: ReturnType<typeof spawnSync>; bundlePath: string } {
  const bundlePath = join(snapshot.dir, 'observations.json');
  const emitted = spawnSync(python, [importerPath,
    '--label', LABEL, '--snapshot-dir', snapshot.dir, '--manifest', snapshot.manifest,
    '--require-in-season', '--on-record-error', 'reject',
    '--emit-observations', bundlePath], { cwd: root, encoding: 'utf8' });
  return { run: emitted, bundlePath };
}

/**
 * A round code neither grain recognises. AFLDB-ISSUE-129 taught the importer
 * 'WF' / 'Wildcard Final', so the ISSUE-128 reporting guarantee needs a
 * genuinely unrepresentable row to keep proving itself. This is that row, and
 * it must stay unknown: never teach the importer 'XF'.
 */
const M_UNKNOWN_2026: FixtureMatch = {
  ...M_WF_2026, game: '17048', date: '2026-08-30',
  roundResults: 'XF', roundStats: 'XF',
  home: 'Melbourne', away: 'Carlton',
};

/** The same in-season path carrying one row AFLDB genuinely cannot represent. */
function inSeason2026UnrepresentableSnapshot(): { dir: string; manifest: string } {
  const ps = (m: FixtureMatch, p: FixturePlayer) => psRow(m, p, {
    Season: 2026, Round: m.roundStats, Attendance: m.att,
  });
  return buildSnapshot({
    range: { from: 2026, to: 2026 },
    results: [resultsRow(M_HA_2026, 2026), resultsRow(M_UNKNOWN_2026, 2026)],
    playerStats: {
      'player_stats_2026.csv': {
        rows: [
          ps(M_HA_2026, P_ESS), ps(M_HA_2026, P_PORT),
          ps(M_UNKNOWN_2026, WF_PLAYER), ps(M_UNKNOWN_2026, P_COLL),
        ],
      },
    },
    mutateManifest: (manifest) => { manifest.acquisition_kind = 'in_season_partial'; },
  });
}

describe('AFLDB-ISSUE-129 — the Wildcard Final round vocabulary', () => {
  /**
   * The round normalisers, exercised through the REAL importer module rather
   * than a re-implementation. §8.4 item 6: exact deterministic mappings only,
   * so the near-misses matter as much as the hits.
   */
  function normaliseRounds(cases: [string, 'results' | 'stats'][]): string[] {
    const script = `
import json, sys, pathlib
sys.path.insert(0, "tools/migration"); sys.argv = ["x"]
import import_fitzroy_core as ifc
out = []
for raw, grain in json.loads(${JSON.stringify(JSON.stringify(cases))}):
    try:
        if grain == "results":
            code, rtype = ifc.normalise_results_round(raw, "t")
            out.append(code + "|" + rtype)
        else:
            out.append(ifc.normalise_stats_round(raw, "t"))
    except Exception as exc:
        out.append("REFUSED:" + type(exc).__name__)
print(json.dumps(out))
`;
    const run = spawnSync(python, ['-c', script], { cwd: root, encoding: 'utf8' });
    if (run.status !== 0) throw new Error(run.stderr || 'normaliser spawn failed');
    return JSON.parse(run.stdout) as string[];
  }

  it.runIf(canSpawn)('maps both source vocabularies to wildcard_final, exactly', () => {
    expect(normaliseRounds([
      ['WF', 'results'],
      ['Wildcard Final', 'stats'],
      ['WF', 'stats'],
    ])).toEqual(['WF|wildcard_final', 'WF', 'WF']);
  });

  it.runIf(canSpawn)('refuses every near miss rather than guessing', () => {
    // No case-folding, no partial match, no regex, no fallback. Each of these
    // would be a silent mis-import if the mapping were fuzzy.
    expect(normaliseRounds([
      ['wildcard final', 'stats'],
      ['WILDCARD FINAL', 'stats'],
      ['Wildcard', 'stats'],
      ['Wildcard Finals', 'stats'],
      ['Wildcard  Final', 'stats'],
      ['wf', 'results'],
      ['WFX', 'results'],
      ['W', 'results'],
      ['Wildcard Final', 'results'],
    ])).toEqual(Array(9).fill('REFUSED:MatchIdentityError'));
  });

  it.runIf(canSpawn)('keeps the existing round vocabulary unchanged', () => {
    expect(normaliseRounds([
      ['R1', 'results'], ['R25', 'results'], ['EF', 'results'], ['GF', 'results'],
      ['1', 'stats'], ['GF', 'stats'], ['ZZ', 'results'],
    ])).toEqual([
      '1|home_and_away', '25|home_and_away', 'EF|elimination_final',
      'GF|grand_final', '1', 'GF', 'REFUSED:MatchIdentityError',
    ]);
  });

  it.runIf(canSpawn)('treats a Wildcard Final as never polled for the Brownlow', () => {
    // The gate is `round_code in FINALS_CODES`, which also protects the
    // int(round_code) round-vote key from a ValueError on 'WF'.
    const script = `
import json, sys
sys.path.insert(0, "tools/migration"); sys.argv = ["x"]
import import_fitzroy_core as ifc
print(json.dumps({"wf": ifc.FINALS_CODES.get("WF"),
                  "aliases": ifc.STATS_ROUND_ALIASES}))
`;
    const run = spawnSync(python, ['-c', script], { cwd: root, encoding: 'utf8' });
    expect(run.status, String(run.stderr)).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({
      wf: 'wildcard_final', aliases: { 'Wildcard Final': 'WF' },
    });
  });
});

describe('AFLDB-ISSUE-128/129 — in-season source completeness is reported, not swallowed', () => {
  it.runIf(canSpawn)('now emits the Wildcard Final it used to drop', () => {
    // AFLDB-ISSUE-128 pinned this fixture while the rows were UNREPRESENTABLE:
    // 1 match emitted, 3 unkeyed rejections, both enumerations incomplete. Those
    // assertions are inverted here, deliberately, because ISSUE-129 made the
    // rows representable -- not deleted, so the fixture still carries the exact
    // real 2026 vocabulary measured from the live source.
    const emitted = emitInSeason(inSeason2026Snapshot());
    expect(emitted.run.status, String(emitted.run.stderr)).toBe(0);

    const bundle = JSON.parse(readFileSync(emitted.bundlePath, 'utf8'));
    expect(bundle.counts.matches).toBe(2);
    expect(bundle.counts.player_match_rows).toBe(4);
    expect(bundle.counts.unkeyed_rejections).toBe(0);

    const matches = bundle.records.filter(
      (record: { family: string }) => record.family === 'afltables.match',
    );
    const ha = matches.find(
      (r: { external_record_id: string }) => r.external_record_id.includes('|25|'),
    );
    expect(ha.rejection).toBeNull();
    expect(ha.projection).toMatchObject({
      home_score: 95, away_score: 105, round_code: '25', round_type: 'home_and_away',
      is_final: false, season: 2026,
    });

    // The row that used to vanish. Identity, round code and type are all the
    // canonical ones; round_number stays NULL, which matches_round_number_ck
    // requires for anything that is not home-and-away.
    const wildcard = matches.find(
      (r: { external_record_id: string }) => r.external_record_id.includes('|WF|'),
    );
    // The source says "Footscray"; the era-correct 2026 identity is Western
    // Bulldogs, which the club resolver applies exactly as it does elsewhere.
    expect(wildcard.external_record_id).toBe('2026|WF|2026-08-28|Western Bulldogs|Collingwood');
    expect(wildcard.rejection).toBeNull();
    expect(wildcard.projection).toMatchObject({
      season: 2026, round_code: 'WF', round_type: 'wildcard_final',
      round_number: null,
      // Structural, per ISSUE-129 §8.4 item 2: not a home-and-away
      // premiership-points match. It is NOT a finals-series appearance, which
      // matches.is_finals_series answers instead.
      is_final: true,
      home_score: 96, away_score: 93,
    });

    // The 2026-08-28 date is now present rather than absent -- the exact
    // inversion of the ISSUE-128 assertion.
    expect(JSON.stringify(bundle.records)).toContain('2026-08-28');

    // Player grain: both grains agreed on the round, so neither row was
    // rejected on a round mismatch against results.csv.
    const wfPlayers = bundle.records.filter(
      (r: { family: string; projection?: { round_code?: string } }) =>
        r.family === 'afltables.player_match_stats' && r.projection?.round_code === 'WF',
    );
    expect(wfPlayers).toHaveLength(2);
    for (const row of wfPlayers) {
      expect(row.rejection).toBeNull();
      expect(row.projection).toMatchObject({
        season: 2026, round_code: 'WF', round_number: null, is_final: true,
      });
      // Never polled: no brownlow_round_votes row is projected for a Wildcard
      // Final, and NA stays NULL rather than becoming a zero.
      expect(row.projection.brownlow_round_vote).toBeNull();
      expect(row.projection.stats.brownlow_votes).toBeNull();
    }

    for (const enumeration of bundle.enumerations) {
      expect(enumeration.complete).toBe(true);
    }
  });

  it.runIf(canSpawn)('reports COMPLETE for the Wildcard Final snapshot', () => {
    const out = String(emitInSeason(inSeason2026Snapshot()).run.stdout);
    expect(out).toContain('SOURCE COMPLETENESS: COMPLETE');
    expect(out).not.toContain('INCOMPLETE');
  });

  it.runIf(canSpawn)('still states INCOMPLETE for a round it genuinely cannot represent', () => {
    // ISSUE-128's guarantee, re-proved on a vocabulary AFLDB does not know. Teaching
    // the importer one new round must not switch the reporting off for the next one.
    const emitted = emitInSeason(inSeason2026UnrepresentableSnapshot());
    expect(emitted.run.status, String(emitted.run.stderr)).toBe(0);
    const out = String(emitted.run.stdout);

    expect(out).toContain('SOURCE COMPLETENESS: INCOMPLETE');
    expect(out).toContain('3 acquired row(s) had no identity AFLDB could represent');
    expect(out).toContain('afltables.match / no_match_identity: 1 row(s)');
    expect(out).toContain('afltables.player_match_stats / no_player_match_identity: 2 row(s)');
    expect(out).toContain('is NOT sweepable');
    expect(out).toContain('Do NOT read this run as a complete import of the season');
    expect(out).toContain('source outage');

    const bundle = JSON.parse(readFileSync(emitted.bundlePath, 'utf8'));
    expect(bundle.counts.matches).toBe(1);
    expect(bundle.counts.unkeyed_rejections).toBe(3);
    for (const enumeration of bundle.enumerations) {
      expect(enumeration.complete).toBe(false);
      expect(enumeration.incomplete_reason).toMatch(/no provable identity/);
    }
  });

  it.runIf(canSpawn)('reports COMPLETE when every acquired row is represented', () => {
    // The same in-season path with the Wildcard Final removed. Proves the
    // verdict is a measurement rather than a permanent warning, and that a bye
    // or a quiet week reads as complete instead of raising an alarm nobody can
    // act on.
    const snapshot = buildSnapshot({
      range: { from: 2026, to: 2026 },
      results: [resultsRow(M_HA_2026, 2026)],
      playerStats: {
        'player_stats_2026.csv': {
          rows: [
            psRow(M_HA_2026, P_ESS, { Season: 2026, Round: '25', Attendance: M_HA_2026.att }),
            psRow(M_HA_2026, P_PORT, { Season: 2026, Round: '25', Attendance: M_HA_2026.att }),
          ],
        },
      },
      mutateManifest: (manifest) => { manifest.acquisition_kind = 'in_season_partial'; },
    });
    const emitted = emitInSeason(snapshot);

    expect(emitted.run.status, String(emitted.run.stderr)).toBe(0);
    expect(String(emitted.run.stdout)).toContain('SOURCE COMPLETENESS: COMPLETE');
    expect(String(emitted.run.stdout)).not.toContain('INCOMPLETE');

    const bundle = JSON.parse(readFileSync(emitted.bundlePath, 'utf8'));
    expect(bundle.counts.unkeyed_rejections).toBe(0);
    for (const enumeration of bundle.enumerations) expect(enumeration.complete).toBe(true);
  });

  it.runIf(canSpawn)('is idempotent: the same input emits an identical bundle', () => {
    // Re-emission over the same acquired rows must produce the same evidence,
    // so a rerun cannot make the completeness verdict drift.
    const snapshot = inSeason2026Snapshot();
    const first = emitInSeason(snapshot);
    const firstBundle = readFileSync(first.bundlePath, 'utf8');
    const second = emitInSeason(snapshot);
    expect(second.run.status).toBe(0);
    expect(readFileSync(second.bundlePath, 'utf8')).toBe(firstBundle);
  });

  it('the historical rebuild path still ABORTS on an unknown round code', () => {
    // --on-record-error reject is in-season only by design (ISSUE-099 F6). A
    // clean rebuild must never drop a record it cannot interpret. 'WF' is no
    // longer such a record (ISSUE-129), so this uses a code that still is.
    const wildcard = resultsRow(M1);
    wildcard[2] = 'XF';
    const snapshot = buildSnapshot({ results: [wildcard, resultsRow(M2)] });
    const result = run(snapshot);
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('unrecognised results round code');
  });

});

describe('fitzRoy source row corrections', () => {
  const contract = JSON.parse(readFileSync(
    join(root, 'tools', 'rebuild', 'fitzroy', 'fitzroy-contract.json'), 'utf8'));
  const rules = contract.source_row_corrections.rules;
  const SNAP = join(root, 'data', 'sources', 'afltables', 'fitzroy_core',
    'full-history-20260827');
  const hasSnapshot = existsSync(join(SNAP, 'player_stats_1909.csv'));

  const OLDER = 'https://afltables.com/afl/stats/players/J/Jim_Stewart0.html';
  const YOUNGER = 'https://afltables.com/afl/stats/players/J/Jim_Stewart1.html';

  /** The 1909 rows that survive the tracked corrections. */
  function corrected1909() {
    // The snapshot CSV quotes every field, and a name may legitimately contain a comma,
    // so this honours quoting rather than splitting naively.
    const parseLine = (line: string): string[] => {
      const cells: string[] = [];
      let cell = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === '"' && line[i + 1] === '"') { cell += '"'; i += 1; }
          else if (ch === '"') inQuotes = false;
          else cell += ch;
        } else if (ch === '"') inQuotes = true;
        else if (ch === ',') { cells.push(cell); cell = ''; }
        else cell += ch;
      }
      cells.push(cell);
      return cells;
    };

    const text = readFileSync(join(SNAP, 'player_stats_1909.csv'), 'utf8');
    const lines = text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim());
    const header = parseLine(lines[0]);
    const rows = lines.slice(1).map((line) => {
      const cells = parseLine(line);
      return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])) as
        Record<string, string>;
    });
    const drops = rules.filter((r: any) => r.file === 'player_stats_1909.csv');
    return rows.filter((row) => !drops.some((r: any) =>
      Object.entries(r.fingerprint).every(([k, v]) => row[k] === v)));
  }

  it('binds each correction to an exact artefact and row fingerprint', () => {
    expect(rules).toHaveLength(2);
    for (const rule of rules) {
      expect(rule.action).toBe('drop_row');
      expect(rule.file).toBe('player_stats_1909.csv');
      expect(rule.expect_rows).toBe(1);
      expect(rule.authority).toMatch(/AFL Tables/);
      // the fingerprint is field values, never a name
      expect(Object.keys(rule.fingerprint)).toEqual(expect.arrayContaining(
        ['Season', 'Round', 'Date', 'url', 'ID', 'Age', 'Career.Games', 'Goals']));
      expect(Object.keys(rule.fingerprint)).not.toContain('Player');
      expect(Object.keys(rule.fingerprint)).not.toContain('Surname');
    }
  });

  it('introduces no name-based matching', () => {
    expect(importerSource).toContain('never a name');
    expect(importerSource).not.toMatch(/Surname.*==.*Stewart|Player.*==.*Stewart/);
    expect(JSON.stringify(rules)).not.toMatch(/"(Player|Surname|First\.name)":/);
  });

  it('fails closed when the raw rows no longer match the evidence', () => {
    expect(importerSource).toContain('expected to match');
    expect(importerSource).toContain('do not let a ');
    expect(importerSource).toContain('remove the rule deliberately');
  });

  it('does not re-collapse the two canonical URLs', () => {
    // Neither rule rewrites a url or an ID: both are drop_row. The surviving rows keep
    // the identities the source already had right.
    for (const rule of rules) {
      expect(rule).not.toHaveProperty('set');
      expect(rule).not.toHaveProperty('resolves_to');
    }
    const urls = rules.map((r: any) => r.fingerprint.url);
    expect(new Set(urls).size).toBe(2);
  });

  it.skipIf(!hasSnapshot)('leaves exactly the two genuine Round 10 rows', () => {
    const r10 = corrected1909().filter(
      (r) => r.url.includes('Jim_Stewart') && r.Round === '10');
    expect(r10).toHaveLength(2);

    const older = r10.find((r) => r.url === OLDER)!;
    const younger = r10.find((r) => r.url === YOUNGER)!;
    expect(older).toBeDefined();
    expect(younger).toBeDefined();

    // AFL Tables authority: older aged 25y 78d, 68th game, 2 goals
    expect(older['Career.Games']).toBe('68');
    expect(older.Goals).toBe('2');
    expect(older.Age.startsWith('25.21355')).toBe(true);
    // younger aged 20y 243d, debut, 0 goals
    expect(younger['Career.Games']).toBe('1');
    expect(younger.Goals).toBe('0');
    expect(younger.Age.startsWith('20.66529')).toBe(true);

    // and their player-match identities stay distinct
    expect(older.url).not.toBe(younger.url);
    expect(older.ID).not.toBe(younger.ID);
  });

  it.skipIf(!hasSnapshot)('leaves the younger player\'s other appearances untouched', () => {
    const mine = corrected1909().filter((r) => r.url === YOUNGER);
    // R10 (career game 1) and R11 (career game 2) — already correct in the source
    expect(mine.map((r) => r.Round).sort()).toEqual(['10', '11']);
    expect(mine.map((r) => r['Career.Games']).sort()).toEqual(['1', '2']);
    for (const row of mine) expect(row.ID).toBe('5685');
  });

  it.skipIf(!hasSnapshot)('corrects exactly two rows and nothing else in 1909', () => {
    const before = readFileSync(join(SNAP, 'player_stats_1909.csv'), 'utf8')
      .split('\n').filter((l) => l.trim()).length - 1;
    expect(before - corrected1909().length).toBe(2);
  });
});

/*
 * AFLDB-ISSUE-093 — dataset-scoped source club normalisation.
 *
 * The two fitzRoy datasets disagreed with each other for the Kangaroos era: player_stats
 * used "Kangaroos" while results used "North Melbourne", so the same match resolved to
 * two different historical identities and 9,196 player_stats rows could not join. The
 * correction is scoped to the results dataset alone.
 */
describe.skipIf(!canSpawn)('dataset-scoped club normalisation', () => {
  const contract = JSON.parse(readFileSync(
    join(root, 'tools', 'rebuild', 'fitzroy', 'fitzroy-contract.json'), 'utf8'));
  const clubs = JSON.parse(readFileSync(
    join(root, 'data', 'reference', 'clubs.json'), 'utf8'));
  const rules = contract.source_club_normalisation.rules;

  /** Resolve through the REAL ClubResolver with the REAL tracked rules. */
  function resolveMany(cases: [string, number, string | null][]): string[] {
    const script = `
import json, sys, pathlib
sys.path.insert(0, "tools/migration"); sys.argv = ["x"]
import import_fitzroy_core as ifc
contract = json.loads(pathlib.Path("tools/rebuild/fitzroy/fitzroy-contract.json").read_text(encoding="utf-8"))
clubs = ifc.ClubResolver(
    json.loads(pathlib.Path("data/reference/clubs.json").read_text(encoding="utf-8")),
    contract["source_club_normalisation"]["rules"])
out = []
for raw, season, dataset in json.loads(sys.argv[0] if False else ${JSON.stringify(JSON.stringify(cases))}):
    try:
        out.append(clubs.resolve(raw, int(season), dataset))
    except Exception as exc:
        out.append("REFUSED:" + type(exc).__name__)
print(json.dumps(out))
`;
    const run = spawnSync(python, ['-c', script], { cwd: root, encoding: 'utf8' });
    if (run.status !== 0) throw new Error(run.stderr || 'resolver spawn failed');
    return JSON.parse(run.stdout.trim().split('\n').pop() as string);
  }

  it('resolves the results dataset to Kangaroos across the era, and only there', () => {
    const [r1999, r2007, r1998, r2008] = resolveMany([
      ['North Melbourne', 1999, 'results'],
      ['North Melbourne', 2007, 'results'],
      ['North Melbourne', 1998, 'results'],
      ['North Melbourne', 2008, 'results'],
    ]);
    expect(r1999).toBe('Kangaroos');
    expect(r2007).toBe('Kangaroos');
    expect(r1998).toBe('North Melbourne');
    expect(r2008).toBe('North Melbourne');
  });

  it('never applies the results correction to player_stats', () => {
    const got = resolveMany([
      ['North Melbourne', 1999, 'player_stats'],
      ['North Melbourne', 2007, 'player_stats'],
      ['Kangaroos', 1999, 'player_stats'],
      ['Kangaroos', 2007, 'player_stats'],
    ]);
    expect(got).toEqual(['North Melbourne', 'North Melbourne', 'Kangaroos', 'Kangaroos']);
  });

  it('leaves the Brisbane rule unscoped, so it still applies to both datasets', () => {
    const got = resolveMany([
      ['Brisbane Lions', 1990, 'results'],
      ['Brisbane Lions', 1990, 'player_stats'],
      ['Brisbane Lions', 1997, 'results'],
      ['Brisbane Lions', 1986, 'results'],
    ]);
    expect(got).toEqual(['Brisbane Bears', 'Brisbane Bears', 'Brisbane Lions',
      'REFUSED:MatchIdentityError']);
    expect(rules.find((r: any) => r.raw === 'Brisbane Lions').dataset).toBeUndefined();
  });

  it('scopes the Kangaroos rule to one dataset, string and era', () => {
    const rule = rules.find((r: any) => r.raw === 'North Melbourne');
    expect(rule).toMatchObject({
      dataset: 'results',
      raw: 'North Melbourne',
      first_season: 1999,
      last_season: 2007,
      resolves_to_hist: 'Kangaroos',
    });
    const kangaroos = clubs.identities.find((c: any) => c.hist === 'Kangaroos');
    expect(rule.first_season).toBe(kangaroos.first_season);
    expect(rule.last_season).toBe(kangaroos.last_season);
  });

  it('keeps North Melbourne and Kangaroos distinct, with no global equivalence', () => {
    const nm = clubs.identities.find((c: any) => c.hist === 'North Melbourne');
    const kang = clubs.identities.find((c: any) => c.hist === 'Kangaroos');
    expect(nm.slug).not.toBe(kang.slug);
    // the lineage is a rename chain, which is what makes them one organization but two
    // era identities — and it is untouched by this correction
    expect(kang.successor_hist).toBe('North Melbourne');
    const owners = clubs.identities.filter((c: any) =>
      [c.hist, c.name, c.short_name, c.abbreviation].includes('North Melbourne'));
    expect(owners.map((c: any) => c.hist)).toEqual(['North Melbourne']);
    expect(contract.source_club_normalisation.is_alias).toBe(false);
  });

  it('refuses a tracked rule outside the target identity era or with an unknown dataset',
    () => {
      const bad = (rule: object) => {
        const script = `
import json, sys, pathlib
sys.path.insert(0, "tools/migration"); sys.argv = ["x"]
import import_fitzroy_core as ifc
try:
    ifc.ClubResolver(
        json.loads(pathlib.Path("data/reference/clubs.json").read_text(encoding="utf-8")),
        [${JSON.stringify(JSON.stringify(rule))} and json.loads(${JSON.stringify(JSON.stringify(rule))})])
    print("ACCEPTED")
except Exception as exc:
    print("REFUSED:" + str(exc))
`;
        return spawnSync(python, ['-c', script], { cwd: root, encoding: 'utf8' }).stdout.trim();
      };
      // 2008 is outside the Kangaroos era
      expect(bad({ dataset: 'results', raw: 'North Melbourne', first_season: 1999,
        last_season: 2008, resolves_to_hist: 'Kangaroos' })).toContain('outside');
      expect(bad({ dataset: 'nonsense', raw: 'North Melbourne', first_season: 1999,
        last_season: 2007, resolves_to_hist: 'Kangaroos' })).toContain('unknown dataset');
      expect(bad({ dataset: 'results', raw: 'North Melbourne', first_season: 1999,
        last_season: 2007, resolves_to_hist: 'Nowhere FC' })).toContain('unknown identity');
    });
});

/*
 * AFLDB-ISSUE-093 — blank `Player` fallback.
 *
 * `Player` is the source's own concatenation of First.name and Surname, and fitzRoy
 * leaves it blank for a few recent players whose structured name fields are present
 * (measured: 79 rows, 4 players, all 2025). The importer rebuilds it from fields it
 * already reads on the same row. Identity is unaffected: it is the profile URL.
 */
describe.skipIf(!canSpawn)('blank Player fallback', () => {
  const NAMELESS: FixturePlayer = {
    id: '901', first: 'Charlie', sur: 'Cameron',
    url: 'https://afltables.com/afl/stats/players/C/Charlie_Cameron9.html',
    dob: '', votes: '0', playingFor: 'Sydney', career: '5', jumper: '9',
  };

  function withPlayerCell(overrides: Record<string, Cell>) {
    return run(buildSnapshot({
      playerStats: {
        'player_stats_2024.csv': {
          rows: [psRow(M1, P_A), psRow(M1, NAMELESS, overrides),
            psRow(M2, P_C), psRow(M2, P_D)],
        },
      },
    }));
  }

  it('rebuilds display_name from First.name and Surname when Player is blank', () => {
    const result = withPlayerCell({ Player: '' });
    expect(String(result.stderr)).not.toContain('no usable name');
    expect(result.status).toBe(0);
  });

  it('keeps a non-blank Player winning, unchanged', () => {
    // The source's own value is preserved verbatim even when it differs from the parts.
    const result = withPlayerCell({ Player: 'Charles Cameron' });
    expect(result.status).toBe(0);
    expect(importerSource).toContain('a non-blank `Player`\n        # always wins');
  });

  it('still fails closed when Player and First.name are both absent', () => {
    const result = withPlayerCell({ Player: '', 'First.name': '' });
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('no usable name');
  });

  it('still fails closed when Player and Surname are both absent', () => {
    const result = withPlayerCell({ Player: '', Surname: '' });
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('no usable name');
  });

  it('leaves given_name, surname and sort_name derivation untouched', () => {
    // given_name/surname still come straight from the structured columns, and sort_name
    // is still built from them in import_players — the fallback only fills display_name.
    expect(importerSource).toContain('fact.given_name = clean(row["First.name"]) or fact.given_name');
    expect(importerSource).toContain('fact.surname = clean(row["Surname"]) or fact.surname');
    expect(importerSource).toMatch(/sort_name = \(f"\{fact\.surname\}, \{fact\.given_name\}"/);
  });

  it('introduces no name-based player resolution', () => {
    // identity is resolved by url only; the fallback feeds a display column
    expect(importerSource).toContain('no name matching');
    expect(importerSource).toContain('fact = players.get(url_path)');
    expect(importerSource).not.toMatch(/players\.get\(\s*(display|fact\.display_name)/);
  });

  const SNAP = join(root, 'data', 'sources', 'afltables', 'fitzroy_core',
    'full-history-20260827');
  const hasSnapshot = existsSync(join(SNAP, 'player_stats_2025.csv'));

  it.skipIf(!hasSnapshot)('covers the four real 2025 players, retaining all 79 rows', () => {
    const text = readFileSync(join(SNAP, 'player_stats_2025.csv'), 'utf8');
    const lines = text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim());
    const parse = (line: string): string[] => {
      const cells: string[] = []; let cell = ''; let q = false;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (q) {
          if (ch === '"' && line[i + 1] === '"') { cell += '"'; i += 1; }
          else if (ch === '"') q = false; else cell += ch;
        } else if (ch === '"') q = true;
        else if (ch === ',') { cells.push(cell); cell = ''; }
        else cell += ch;
      }
      cells.push(cell); return cells;
    };
    const header = parse(lines[0]);
    const rows = lines.slice(1).map((l) => Object.fromEntries(
      header.map((h, i) => [h, parse(l)[i] ?? ''])) as Record<string, string>);

    const blank = rows.filter((r) => !r.Player.trim());
    expect(blank).toHaveLength(79);

    const byUrl = new Map<string, number>();
    for (const r of blank) byUrl.set(r.url, (byUrl.get(r.url) ?? 0) + 1);
    expect([...byUrl.keys()].map((u) => u.split('/').pop()).sort()).toEqual([
      'Charlie_Cameron3.html', 'Jack_Graham2.html',
      'Jack_Ross3.html', 'Jack_Williams3.html',
    ]);

    // every one has the structured fields the fallback needs, so none is dropped
    for (const r of blank) {
      expect(r['First.name'].trim()).not.toBe('');
      expect(r.Surname.trim()).not.toBe('');
      expect(`${r['First.name'].trim()} ${r.Surname.trim()}`).toMatch(/^\S+ \S+/);
    }
    // and no source_row_correction targets 2025
    const corrections = JSON.parse(readFileSync(
      join(root, 'tools', 'rebuild', 'fitzroy', 'fitzroy-contract.json'), 'utf8'))
      .source_row_corrections.rules;
    expect(corrections.some((c: any) => c.file.includes('2025'))).toBe(false);
  });
});


/*
 * AFLDB-ISSUE-093 — the acceptance register BINDS, it never blesses.
 *
 * Every refusal below is proved by running the real importer against a synthetic snapshot
 * with a synthetic register, so a hand-edited acceptance record is shown to be insufficient
 * rather than merely asserted to be.
 */
describe.skipIf(!canSpawn)('accepted-baseline enforcement', () => {
  function runAccepted(register: unknown, label = LABEL, spec: SnapshotSpec = {}) {
    const snapshot = buildSnapshot(spec);
    const path = join(snapshot.dir, 'accepted.json');
    writeFileSync(path, JSON.stringify(register, null, 2), 'utf8');
    return spawnSync(python, [importerPath, '--label', label,
      '--snapshot-dir', snapshot.dir, '--manifest', snapshot.manifest,
      '--accepted-baselines', path, '--validate-only',
      '--require-accepted-baseline'], { cwd: root, encoding: 'utf8' });
  }

  const registerOf = (baselines: unknown[]) => ({
    contract: 'afldb.fitzroy.accepted_baselines',
    schema_version: 1,
    selection_policy: { rule: 'exactly_one_accepted' },
    baselines,
  });
  const baselineOf = (over: Record<string, unknown> = {}) => ({
    snapshot_label: LABEL,
    acceptance_status: 'accepted',
    ...over,
  });

  it('cannot bless a snapshot that fails the full-history gates', () => {
    // The whole point: an acceptance record whose every binding is HONEST — real manifest
    // hash, real artefact-set digest, real contract versions — must still be refused for a
    // snapshot covering one season, because --require-accepted-baseline IMPLIES
    // --require-full-history and the gates are re-derived from the artefacts.
    const snapshot = buildSnapshot();
    const manifestBytes = readFileSync(snapshot.manifest);
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    const contract = JSON.parse(readFileSync(
      join(root, 'tools', 'rebuild', 'fitzroy', 'fitzroy-contract.json'), 'utf8'));
    const lines = manifest.files
      .map((f: any) => `${f.filename} ${f.sha256} ${f.row_count}`).sort();
    const honest = registerOf([baselineOf({
      acquisition: {
        manifest_sha256: createHash('sha256').update(manifestBytes).digest('hex'),
        fitzroy_version_pinned: contract.pinned_version,
      },
      raw_artefacts: {
        artefact_set_sha256: createHash('sha256')
          .update(`${lines.join('\n')}\n`).digest('hex'),
        file_count: manifest.files.length,
        total_rows: manifest.files.reduce((n: number, f: any) => n + f.row_count, 0),
      },
      contract_binding: {
        contract_version: contract.contract_version,
        contract_full_history_version:
          contract.full_history.contract_full_history_version,
        required_range: {
          first_season: contract.full_history.season_range.first_season,
          last_season: contract.full_history.season_range.last_season,
        },
        required_datasets: contract.full_history.required_datasets,
      },
    })]);
    const path = join(snapshot.dir, 'accepted.json');
    writeFileSync(path, JSON.stringify(honest, null, 2), 'utf8');
    const result = spawnSync(python, [importerPath, '--label', LABEL,
      '--snapshot-dir', snapshot.dir, '--manifest', snapshot.manifest,
      '--accepted-baselines', path, '--validate-only',
      '--require-accepted-baseline'], { cwd: root, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toMatch(/season|range|full[- ]history/i);
    expect(String(result.stderr)).not.toContain('no longer matches');
    expect(String(result.stdout)).not.toContain('VERIFIED');
  });

  it('refuses when nothing is accepted', () => {
    const result = runAccepted(
      registerOf([baselineOf({ acceptance_status: 'candidate' })]));
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('no fitzRoy baseline is marked accepted');
  });

  it('refuses more than one accepted baseline instead of picking the newest', () => {
    const result = runAccepted(registerOf([
      baselineOf(),
      baselineOf({ snapshot_label: `${LABEL}-newer` }),
    ]));
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toMatch(/2 fitzRoy baselines are marked accepted/);
    expect(String(result.stderr)).toContain('not defined policy');
  });

  it('refuses a label that is not the accepted baseline', () => {
    const result = runAccepted(
      registerOf([baselineOf({ snapshot_label: 'something-else' })]));
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('is not the accepted baseline');
  });

  it('refuses an unknown selection policy rather than guessing', () => {
    const register = registerOf([baselineOf()]);
    register.selection_policy.rule = 'newest_wins';
    const result = runAccepted(register);
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('exactly_one_accepted');
  });

  it('refuses a document that is not an acceptance register', () => {
    const register = registerOf([baselineOf()]) as Record<string, unknown>;
    register.contract = 'something.else';
    const result = runAccepted(register);
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('afldb.fitzroy.accepted_baselines');
  });

  it('refuses when the acquisition manifest no longer hashes to the accepted value', () => {
    const result = runAccepted(registerOf([baselineOf({
      acquisition: { manifest_sha256: 'a'.repeat(64) },
    })]));
    expect(result.status).not.toBe(0);
    expect(String(result.stderr))
      .toMatch(/acquisition manifest's SHA-256 no longer matches/);
    expect(String(result.stderr)).toContain('do not edit the acceptance record to fit');
  });

  it('refuses when the artefact-set digest no longer matches', () => {
    // Compute the honest manifest hash, then pin a wrong artefact-set digest: the two
    // bindings are independent, so covering one does not cover the other.
    const snapshot = buildSnapshot();
    const manifestSha = createHash('sha256')
      .update(readFileSync(snapshot.manifest)).digest('hex');
    const path = join(snapshot.dir, 'accepted.json');
    writeFileSync(path, JSON.stringify(registerOf([baselineOf({
      acquisition: { manifest_sha256: manifestSha },
      raw_artefacts: { artefact_set_sha256: 'b'.repeat(64), file_count: 3, total_rows: 9 },
    })])), 'utf8');
    const result = spawnSync(python, [importerPath, '--label', LABEL,
      '--snapshot-dir', snapshot.dir, '--manifest', snapshot.manifest,
      '--accepted-baselines', path, '--validate-only',
      '--require-accepted-baseline'], { cwd: root, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toMatch(/artefact-set digest no longer matches/);
  });

  it('exposes the acceptance register path it reads, and reads only that', () => {
    expect(importerSource).toContain(
      'ACCEPTED_BASELINES_PATH = REPO_ROOT / "data" / "reference" '
      + '/ "fitzroy-accepted-baselines.json"');
  });
});

/*
 * AFLDB-ISSUE-093 §H14 — the accepted source corrections must reach the import phases.
 *
 * The second full clean rebuild died at [stats] with `NameError: name 'corrections'
 * is not defined`, after 16,838 matches had been imported: import_player_match_stats()
 * and import_brownlow_round_votes() both call iter_player_stats(files, corrections)
 * and had both lost the parameter, while main() passed it to neither.
 *
 * The contract driven here is behavioural — it binds main()'s real arguments to the
 * real signatures and reads the compiled code objects to prove `corrections` resolves
 * to a parameter rather than to module scope. That distinction is the whole defect,
 * and a source-string assertion cannot see it.
 */
describe('accepted corrections threading (§H14)', () => {
  it.skipIf(!canSpawn)('reaches every phase that applies them', () => {
    const result = spawnSync(python, ['tests/python/fitzroy_corrections_contract.py'],
      { cwd: root, encoding: 'utf8' });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('All fitzRoy corrections-threading checks hold.');
    expect(result.stdout).not.toContain('FAIL ');
    for (const scenario of [
      '2b and the corrections object it receives IS the loaded one',
      '2d and it receives the same corrections object',
      '3a `corrections` is NOT a module-level global',
      '4a the pre-repair shape raises NameError',
      '5c every iter_player_stats call passes corrections',
    ]) {
      expect(result.stdout).toContain(`PASS  ${scenario}`);
    }
  });
});

/*
 * AFLDB-ISSUE-110 Stage 2 — curated player aliases keyed by STABLE EXTERNAL IDENTITY.
 *
 * data/reference/player-name-aliases.json records established alias facts (Gary Ablett
 * Snr/Jnr) keyed by source key + the source's stable external identity — for afltables
 * the canonical profile path — never by players.id, which a clean rebuild re-seeds.
 * The `aliases` import group resolves each identity through external_identities to
 * exactly one player, derives search_alias with afldb_normalise_name() in SQL, and is
 * insert-only and idempotent. Missing, unresolved, or multiply-resolved identities
 * refuse the whole load before any row is written. There is no name matching and no
 * chronological/age/ordering inference: the fixture players below carry IDENTICAL
 * canonical names, so only the external identity can tell them apart.
 *
 * The database-backed block runs against AFLDB_TEST_DATABASE_URL inside one
 * transaction that is always rolled back, under a fixture sources row, so it leaves
 * afldb_test untouched and never reads or writes the real afltables population.
 */
const aliasReferencePath = join(root, 'data', 'reference', 'player-name-aliases.json');
const aliasReference = JSON.parse(readFileSync(aliasReferencePath, 'utf8'));
const sourceRegistry = JSON.parse(readFileSync(
  join(root, 'data', 'reference', 'sources.json'), 'utf8'));

function hasPsycopg(): boolean {
  const probe = spawnSync(python, ['-c', 'import psycopg'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
}
const aliasTestDsn = process.env.AFLDB_TEST_DATABASE_URL;
const canRunAliasDb = canSpawn && !!aliasTestDsn && hasPsycopg();

/** Run load_player_alias_reference() on a document; ACCEPTED:<entries> or REFUSED:<msg>. */
function readAliasReference(document: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'issue110-alias-ref-'));
  tempDirs.push(dir);
  const path = join(dir, 'player-name-aliases.json');
  writeFileSync(path, JSON.stringify(document));
  const script = `
import json, sys, pathlib
sys.path.insert(0, "tools/migration"); sys.argv = ["x"]
import import_fitzroy_core as ifc
try:
    print("ACCEPTED:" + json.dumps(ifc.load_player_alias_reference(pathlib.Path(${JSON.stringify(path)}))))
except Exception as exc:
    print("REFUSED:" + str(exc))
`;
  const run = spawnSync(python, ['-c', script], { cwd: root, encoding: 'utf8' });
  if (run.status !== 0) throw new Error(run.stderr || 'alias reference spawn failed');
  return run.stdout.trim().split('\n').pop() as string;
}

describe('curated player alias reference (AFLDB-ISSUE-110 Stage 2)', () => {
  it('keys every tracked entry by source + stable external identity, never players.id', () => {
    expect(Array.isArray(aliasReference.aliases)).toBe(true);
    expect(aliasReference.aliases.length).toBeGreaterThan(0);
    const sourceKeys = new Set(sourceRegistry.sources.map((s: { key: string }) => s.key));
    for (const entry of aliasReference.aliases) {
      expect(Object.keys(entry)).not.toContain('player_id');
      expect(Object.keys(entry)).not.toContain('id');
      expect(sourceKeys.has(entry.source)).toBe(true);
      expect(typeof entry.alias).toBe('string');
      if (entry.source === 'afltables') {
        // The canonical profile path is exactly what external_identities stores
        // under match_method afltables_profile_url.
        expect(entry.external_id).toMatch(/^players\/[A-Z]\/[^/]+\.html$/);
      }
    }
    const byIdentity = Object.fromEntries(
      aliasReference.aliases.map((e: any) => [`${e.source}:${e.external_id}`, e.alias]));
    expect(byIdentity['afltables:players/G/Gary_Ablett0.html']).toBe('Gary Ablett Snr');
    expect(byIdentity['afltables:players/G/Gary_Ablett1.html']).toBe('Gary Ablett Jnr');
  });

  it('loads as its own import group after players, insert-only, with no player-specific logic', () => {
    expect(importerSource).toContain(
      'GROUPS = ["venues", "players", "aliases", "matches", "stats", "brownlow"]');
    expect(importerSource).toContain('data" / "reference" / "player-name-aliases.json"');
    expect(importerSource).toContain('ON CONFLICT (player_id, alias) DO NOTHING');
    expect(importerSource).not.toContain('DELETE FROM player_name_aliases');
    expect(importerSource).not.toMatch(/UPDATE player_name_aliases/);
    expect(importerSource).not.toMatch(/Ablett/);
    // Resolution goes through the fail-closed resolver before any INSERT.
    const applyStart = importerSource.indexOf('def apply_player_name_aliases(');
    const applyBody = importerSource.slice(applyStart,
      importerSource.indexOf('def import_player_name_aliases('));
    expect(applyBody.indexOf('resolve_alias_identities(')).toBeGreaterThan(-1);
    expect(applyBody.indexOf('resolve_alias_identities('))
      .toBeLessThan(applyBody.indexOf('INSERT INTO player_name_aliases'));
    expect(applyBody).toContain('afldb_normalise_name(%s)');
  });

  it.skipIf(!canSpawn)('accepts the tracked reference file exactly as written', () => {
    const result = readAliasReference(aliasReference);
    expect(result.startsWith('ACCEPTED:'), result).toBe(true);
    const entries = JSON.parse(result.slice('ACCEPTED:'.length));
    expect(entries).toHaveLength(aliasReference.aliases.length);
    expect(entries.map((e: any) => e.external_id).sort()).toEqual(
      ['players/G/Gary_Ablett0.html', 'players/G/Gary_Ablett1.html']);
  });

  it.skipIf(!canSpawn)('refuses malformed, surrogate-keyed, and duplicate entries', () => {
    const ok = { source: 'afltables', external_id: 'players/G/Gary_Ablett0.html',
      alias: 'Gary Ablett Snr' };
    expect(readAliasReference({ aliases: [{ ...ok, player_id: 4242 }] }))
      .toContain('not a stable identity');
    expect(readAliasReference({ aliases: [{ ...ok,
      external_id: 'https://afltables.com/afl/stats/players/G/Gary_Ablett0.html' }] }))
      .toContain('canonical profile path');
    expect(readAliasReference({ aliases: [ok, { ...ok, alias: 'gary ablett snr' }] }))
      .toContain('duplicate alias');
    expect(readAliasReference({ aliases: [{ ...ok, alias: '  ' }] }))
      .toContain('non-empty string');
    expect(readAliasReference({ aliases: [{ ...ok, alias: 'Gary  Ablett Snr' }] }))
      .toContain('stray whitespace');
    expect(readAliasReference({ aliases: [{ source: 'afltables', alias: 'Gary Ablett Snr' }] }))
      .toContain('`external_id` must be a non-empty string');
    expect(readAliasReference({ aliases: { source: 'afltables' } }))
      .toContain('must be a list');
    // Two different aliases for one identity, and one alias shared by two
    // identities, are both legitimate (the bare shared name is the whole point).
    expect(readAliasReference({ aliases: [ok, { ...ok, alias: 'Gary Ablett Sr' },
      { ...ok, external_id: 'players/G/Gary_Ablett1.html', alias: 'Gary Ablett Snr' }] }))
      .toMatch(/^ACCEPTED:/);
  });

  it.skipIf(!canSpawn)('refuses an identity that resolves to more than one player', () => {
    // external_identities_uq makes this state unreachable through the table, so
    // the fail-closed decision is proven on the resolver itself with the rows it
    // would otherwise have to trust.
    const script = `
import json, sys
sys.path.insert(0, "tools/migration"); sys.argv = ["x"]
import import_fitzroy_core as ifc
entries = [{"source": "afltables", "external_id": "players/X/X0.html", "alias": "X Snr"}]
out = []
for rows in ([("afltables", "players/X/X0.html", 7)],
             [("afltables", "players/X/X0.html", 7), ("afltables", "players/X/X0.html", 8)],
             [("afltables", "players/X/X1.html", 7)],
             [("other_source", "players/X/X0.html", 7)]):
    try:
        out.append("RESOLVED:" + json.dumps(sorted(ifc.resolve_alias_identities(entries, rows).values())))
    except RuntimeError as exc:
        out.append("REFUSED:" + str(exc))
print(json.dumps(out))
`;
    const run = spawnSync(python, ['-c', script], { cwd: root, encoding: 'utf8' });
    if (run.status !== 0) throw new Error(run.stderr || 'resolver spawn failed');
    const [unique, multiple, wrongId, wrongSource] = JSON.parse(
      run.stdout.trim().split('\n').pop() as string);
    expect(unique).toBe('RESOLVED:[7]');
    expect(multiple).toContain('resolves to 2 players [7, 8]');
    expect(wrongId).toContain('no resolved external identity');
    expect(wrongSource).toContain('no resolved external identity');
  });

  it.skipIf(!canRunAliasDb)(
    'loads through external identity into player_name_aliases: normalised, idempotent, '
    + 'preserving, fail-closed (rolled back)', () => {
      const script = `
import json, os, sys
from urllib.parse import urlparse
sys.path.insert(0, "tools/migration"); sys.argv = ["x"]
import import_fitzroy_core as ifc
from common import connect_pg
dsn = os.environ["AFLDB_TEST_DATABASE_URL"]
if not urlparse(dsn).path.rstrip("/").endswith("_test"):
    raise SystemExit("refusing: AFLDB_TEST_DATABASE_URL does not name a _test database")
SRC = "afltables_issue110_fixture"
ID0, ID1, IDC = ("players/I/Issue110_Fixture0.html", "players/I/Issue110_Fixture1.html",
                 "players/I/Issue110_Control0.html")
pg = connect_pg(dsn)
out = {}
try:
    with pg.cursor() as cur:
        cur.execute("INSERT INTO sources (key, name, kind) VALUES (%s, %s, 'manual') RETURNING id",
                    (SRC, "AFLDB-ISSUE-110 alias fixture source"))
        src_id = cur.fetchone()[0]
        def player(display, slug):
            cur.execute("""INSERT INTO players (display_name, sort_name, search_name, slug)
                           VALUES (%s, %s, afldb_normalise_name(%s), %s) RETURNING id""",
                        (display, display, display, slug))
            return cur.fetchone()[0]
        # Production shape: identical canonical names, distinguishable ONLY by identity.
        elder = player("Issue110 Fixture O'Elder", "issue110-fixture-oelder-0")
        younger = player("Issue110 Fixture O'Elder", "issue110-fixture-oelder-1")
        control = player("Issue110 Fixture Control", "issue110-fixture-control")
        for ext, pid in ((ID0, elder), (ID1, younger), (IDC, control)):
            cur.execute("""INSERT INTO external_identities
                             (source_id, external_id, player_id, status, match_method)
                           VALUES (%s, %s, %s, 'unique', %s)""",
                        (src_id, ext, pid, ifc.MATCH_METHOD))
        # Unresolved identity: registered, but trusted player link absent.
        cur.execute("""INSERT INTO external_identities (source_id, external_id, status)
                       VALUES (%s, 'players/I/Issue110_Unresolved0.html', 'ambiguous')""", (src_id,))
        # Pre-existing aliases that must survive untouched.
        cur.execute("""INSERT INTO player_name_aliases (player_id, alias, search_alias, alias_type)
                       VALUES (%s, 'Issue110 Manual Alias', afldb_normalise_name('Issue110 Manual Alias'), 'manual')""",
                    (elder,))
        cur.execute("""INSERT INTO player_name_aliases (player_id, alias, search_alias, alias_type)
                       SELECT id, display_name, search_name, 'source_string' FROM players WHERE id = %s""",
                    (younger,))
        cur.execute("SELECT count(*) FROM player_name_aliases")
        before = cur.fetchone()[0]
    entries = [
        {"source": SRC, "external_id": ID0, "alias": "Issue110 Fixture O'Elder Snr"},
        {"source": SRC, "external_id": ID1, "alias": "Issue110 Fixture O'Elder Jnr"},
    ]
    out["first"] = ifc.apply_player_name_aliases(pg, entries)
    out["second"] = ifc.apply_player_name_aliases(pg, entries)
    def refused(batch):
        try:
            ifc.apply_player_name_aliases(pg, batch)
            return "ACCEPTED"
        except RuntimeError as exc:
            return str(exc)
    out["missing"] = refused([{"source": SRC, "external_id": "players/I/Issue110_Missing0.html",
                               "alias": "Issue110 Missing Alias"}])
    out["partial"] = refused([
        {"source": SRC, "external_id": ID0, "alias": "Issue110 Partial Alias"},
        {"source": SRC, "external_id": "players/I/Issue110_Missing0.html", "alias": "Issue110 Missing Alias"}])
    out["unresolved"] = refused([{"source": SRC, "external_id": "players/I/Issue110_Unresolved0.html",
                                  "alias": "Issue110 Unresolved Alias"}])
    out["unknown_source"] = refused([{"source": "issue110_no_such_source", "external_id": ID0,
                                      "alias": "Issue110 Unknown Source Alias"}])
    with pg.cursor() as cur:
        cur.execute("SELECT count(*) FROM player_name_aliases")
        out["delta"] = cur.fetchone()[0] - before
        cur.execute("""SELECT player_id, alias, search_alias, alias_type FROM player_name_aliases
                       WHERE player_id = ANY(%s) ORDER BY player_id, alias""",
                    ([elder, younger, control],))
        out["rows"] = [list(r) for r in cur.fetchall()]
    out["ids"] = {"elder": elder, "younger": younger, "control": control}
finally:
    pg.rollback()
    pg.close()
print(json.dumps(out))
`;
      const run = spawnSync(python, ['-c', script], {
        cwd: root, encoding: 'utf8',
        env: { ...process.env, AFLDB_TEST_DATABASE_URL: aliasTestDsn as string },
      });
      expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
      const out = JSON.parse(run.stdout.trim().split('\n').pop() as string);
      const { elder, younger } = out.ids;

      // Resolution by external identity, with identical canonical names.
      expect(out.first).toBe(2);
      expect(out.rows).toContainEqual(
        [elder, "Issue110 Fixture O'Elder Snr", 'issue110 fixture oelder snr', 'alternate']);
      expect(out.rows).toContainEqual(
        [younger, "Issue110 Fixture O'Elder Jnr", 'issue110 fixture oelder jnr', 'alternate']);
      // search_alias came from afldb_normalise_name(): lower-cased, apostrophe dropped.
      for (const [, alias, searchAlias] of out.rows) {
        expect(searchAlias).toBe(searchAlias.toLowerCase());
        expect(searchAlias).not.toContain("'");
        expect(alias.toLowerCase().replace(/'/g, '')).toBe(searchAlias);
      }
      // Idempotent: the second load inserts nothing and the table grew by exactly two.
      expect(out.second).toBe(0);
      expect(out.delta).toBe(2);
      // Unrelated manual and source_string aliases survive; the control player is untouched.
      expect(out.rows).toContainEqual(
        [elder, 'Issue110 Manual Alias', 'issue110 manual alias', 'manual']);
      expect(out.rows).toContainEqual(
        [younger, "Issue110 Fixture O'Elder", 'issue110 fixture oelder', 'source_string']);
      expect(out.rows.filter((r: any[]) => r[0] === out.ids.control)).toHaveLength(0);
      // Fail closed, all-or-nothing: no partial row was written alongside a refusal.
      expect(out.missing).toContain('no resolved external identity');
      expect(out.partial).toContain('no resolved external identity');
      expect(out.unresolved).toContain('no resolved external identity');
      expect(out.unknown_source).toContain('no sources row');
      expect(out.rows.map((r: any[]) => r[1])).not.toContain('Issue110 Partial Alias');
    });
});
