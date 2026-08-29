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

  it('accepts a row whose stable ID is absent but whose profile URL is canonical', () => {
    // Measured on the real 1897-2025 acquisition: 83 rows across 5 players carry a
    // canonical URL and no ID. The ID never reaches a database column, so requiring it
    // would discard five real players for a value the schema does not keep.
    const snapshot = buildSnapshot({
      playerStats: {
        'player_stats_2024.csv': {
          rows: [psRow(M1, { ...P_A, id: '' }), psRow(M1, P_B),
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
