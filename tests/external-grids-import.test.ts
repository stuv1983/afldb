/**
 * AFLDB-ISSUE-118 Stage 1 — the external grid corpus contract.
 *
 * Two halves, one home:
 *
 *   1. Migration 080 and its `privileges.sql` reconciliation, asserted as SQL
 *      before the migration is applied — application freezes its checksum, so
 *      an intent proved afterwards is proved too late. Follows the precedent
 *      of `tests/afl-api-lineup-migration.test.ts` and
 *      `tests/audit-link-fk-indexes.test.ts`.
 *   2. `tools/migration/import_external_grids.py`, driven for real against
 *      throwaway SQLite fixtures this suite builds, on the pattern
 *      `tests/under-22-importer.test.ts` uses for `import_awards.py`.
 *
 * DB-FREE. Nothing here connects to PostgreSQL and the migration is not
 * applied. The importer's PostgreSQL path is asserted structurally — that the
 * dry run cannot reach a write — because executing it needs a database, which
 * `CLAUDE.md` §9 reserves for the operator.
 *
 * Every SQL assertion runs over COMMENT-STRIPPED SQL unless it says otherwise.
 * Migration 080 explains each invariant in prose directly above the statement
 * that upholds it, so a regex over the raw file matches the explanation rather
 * than the rule. The handful of assertions that deliberately read the prose —
 * the immutability record §19 asks the migration to carry — say so.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');

const MIGRATION_PATH = 'src/db/migrations/080_external_grids.sql';
const IMPORTER_PATH = 'tools/migration/import_external_grids.py';

const migrationRaw = read(...MIGRATION_PATH.split('/'));
const privileges = read('tools', 'maintenance', 'privileges.sql');
const importer = read(...IMPORTER_PATH.split('/'));

/** Comment-stripped SQL. Structural assertions read this, not the raw file. */
const executable = migrationRaw.replace(/--[^\n]*/g, '');
/** One whitespace-collapsed string, for cross-line phrase checks. */
const flat = executable.replace(/\s+/g, ' ');
const statements = executable
  .split(';')
  .map((s) => s.replace(/\s+/g, ' ').trim())
  .filter(Boolean);

const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const pythonEnv = { ...process.env, PYTHONIOENCODING: 'utf-8' };

/**
 * The importer with its prose removed — docstrings and `#` comments.
 *
 * Several assertions below say a verb must not appear ANYWHERE in the file
 * (`TRUNCATE`, `UPDATE external_grid`). The file explains at length why it
 * never issues those, so a match over the raw source finds the explanation
 * rather than the statement. Same false positive the migration assertions
 * avoid by stripping `--`, one language over.
 */
const importerCode = importer
  .replace(/"""[\s\S]*?"""/g, '""')
  .replace(/'''[\s\S]*?'''/g, "''")
  .replace(/#[^\n]*/g, '');

/** `privileges.sql` with its `--` commentary removed, for the same reason. */
const privilegesCode = privileges.replace(/--[^\n]*/g, '');

const workspaces: string[] = [];
function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'afldb-grids-'));
  workspaces.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Python helpers
// ---------------------------------------------------------------------------

type LegacyRow = {
  grid_num: number | string | null;
  date: string | null;
  source: string;
  rows_json: string | null;
  cols_json: string | null;
  unsupported_json?: string | null;
  note?: string | null;
};

const BOARD_ONE: LegacyRow = {
  grid_num: 1,
  date: '2023-07-17',
  source: 'Gridley',
  rows_json: '["Port Adelaide", "North Melbourne", "Melbourne"]',
  cols_json: '["Essendon", "Western Bulldogs", "CLUB CAPTAIN"]',
  unsupported_json: '[]',
  note: '',
};

const BOARD_TWO: LegacyRow = {
  grid_num: 2,
  date: '2023-07-18',
  source: 'Gridley',
  rows_json: '["Essendon", "Richmond", "Fremantle"]',
  cols_json: '["Western Bulldogs", "Adelaide Crows", "PICK 1 NATIONAL DRAFT"]',
  unsupported_json: '[]',
  note: '',
};

function runPython(program: string, args: string[] = []): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(python, ['-c', program, ...args], { cwd: root, encoding: 'utf8', env: pythonEnv });
  if (result.error) throw result.error;
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** Build a throwaway `historic_grids` archive. Returns its path. */
function buildArchive(rows: LegacyRow[], options: { table?: string } = {}): string {
  const dir = workspace();
  const dbPath = join(dir, 'archive.db');
  const specPath = join(dir, 'rows.json');
  writeFileSync(specPath, JSON.stringify({ table: options.table ?? 'historic_grids', rows }), 'utf8');
  const program = [
    'import json, sqlite3, sys',
    'spec = json.load(open(sys.argv[2], encoding="utf-8"))',
    'con = sqlite3.connect(sys.argv[1])',
    'con.execute(f"CREATE TABLE {spec[\'table\']} (grid_num INTEGER PRIMARY KEY, date TEXT,'
      + ' source TEXT, rows_json TEXT, cols_json TEXT, unsupported_json TEXT, note TEXT)")',
    'con.executemany(f"INSERT INTO {spec[\'table\']} VALUES (?,?,?,?,?,?,?)", [',
    '    (r.get("grid_num"), r.get("date"), r.get("source"), r.get("rows_json"),',
    '     r.get("cols_json"), r.get("unsupported_json"), r.get("note"))',
    '    for r in spec["rows"]])',
    'con.commit(); con.close()',
  ].join('\n');
  const built = runPython(program, [dbPath, specPath]);
  expect(built.status, built.stderr).toBe(0);
  return dbPath;
}

/** Run the importer's DB-free dry run over an archive. */
function dryRun(dbPath: string, extra: string[] = []): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(
    python,
    [IMPORTER_PATH, '--dry-run', '--no-db', '--sqlite', dbPath, ...extra],
    { cwd: root, encoding: 'utf8', env: pythonEnv },
  );
  if (result.error) throw result.error;
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

// ---------------------------------------------------------------------------
// Migration 080
// ---------------------------------------------------------------------------

describe('migration 080 — external grid corpus schema (UNAPPLIED)', () => {
  it('creates exactly the three Stage 1 tables and defers the rest', () => {
    const created = statements
      .map((s) => /^CREATE TABLE (\w+)/.exec(s)?.[1])
      .filter((name): name is string => Boolean(name));
    expect(created.sort()).toEqual(['external_grid_axes', 'external_grid_sources', 'external_grids']);

    // Stage 6 and Stage 3 respectively. Creating either here would invite a
    // mapping to be written before the evidence that decides it exists.
    expect(flat).not.toContain('external_grid_answers');
    expect(flat).not.toContain('external_grid_criterion_map');
  });

  it('keeps the corpus out of the canonical model entirely', () => {
    // No foreign key into a canonical entity, and no trigger of any kind.
    for (const table of ['players', 'player_clubs', 'clubs', 'matches', 'seasons']) {
      expect(flat).not.toContain(`REFERENCES ${table}`);
    }
    expect(flat).not.toMatch(/CREATE (OR REPLACE )?(TRIGGER|RULE)/i);
    // The Grid Solver is not touched, named or mapped to.
    expect(flat).not.toMatch(/builder_key|GRID_BUILDERS|played_for_club/);
  });

  it('registers the platform in both registries so they cannot disagree', () => {
    expect(flat).toMatch(/INSERT INTO sources \(key, name, url, kind, description\) VALUES \( 'gridley'/);
    expect(flat).toContain("'scrape'");
    expect(flat).toMatch(/ON CONFLICT \(key\) DO NOTHING/);
    expect(flat).toMatch(/INSERT INTO external_grid_sources \(code, name, base_url, ingest_source_id, notes\)/);
    expect(flat).toMatch(/ingest_source_id\s+smallint\s+NOT NULL UNIQUE REFERENCES sources\(id\)/);
  });

  it('makes one current revision per board per provenance, and no more', () => {
    const byNumber = statements.find((s) => s.includes('ux_external_grids_current_number'));
    expect(byNumber).toBeDefined();
    expect(byNumber).toContain('CREATE UNIQUE INDEX');
    expect(byNumber).toContain('ON external_grids (source_id, provenance, board_number)');
    expect(byNumber).toContain('WHERE is_current');
  });

  it('asserts the board-number/board-date 1:1 relationship over current revisions', () => {
    const byDate = statements.find((s) => s.includes('ux_external_grids_current_date'));
    expect(byDate).toBeDefined();
    expect(byDate).toContain('ON external_grids (source_id, provenance, board_date)');
    expect(byDate).toContain('WHERE is_current');
  });

  it('keys the revision chain by provenance, so two capture paths coexist', () => {
    // ISSUE-118 §11 proposed (source_id, board_number, revision); §10.1 and
    // §12B require the archive and the API capture to be held at once. The
    // provenance-scoped key is what reconciles them, so a regression to the
    // narrower key must fail here.
    expect(flat).toContain('UNIQUE (source_id, provenance, board_number, revision)');
    expect(flat).not.toMatch(/UNIQUE \(source_id, board_number, revision\)/);
  });

  it('constrains provenance to the two acquisition paths that exist', () => {
    expect(flat).toMatch(/CHECK \(provenance IN \('legacy_sqlite', 'gridley_api'\)\)/);
  });

  it('lets a rescued board admit it has no capture timestamp', () => {
    // fetched_at must be nullable: the archive records no fetch time, and
    // DEFAULT now() would fabricate one for a board captured years earlier.
    const table = statements.find((s) => s.startsWith('CREATE TABLE external_grids'))!;
    expect(table).toMatch(/fetched_at\s+timestamptz,/);
    expect(table).not.toMatch(/fetched_at[^,]*NOT NULL/);
    expect(table).not.toMatch(/fetched_at[^,]*DEFAULT now\(\)/);
  });

  it('ties every captured row to the run that captured it', () => {
    const table = statements.find((s) => s.startsWith('CREATE TABLE external_grids'))!;
    expect(table).toMatch(/import_batch_id\s+bigint\s+NOT NULL REFERENCES import_batches\(id\)/);
    expect(table).toMatch(/payload_sha256\s+char\(64\)\s+NOT NULL/);
    expect(table).toMatch(/raw_payload\s+jsonb\s+NOT NULL/);
    expect(table).toContain("CHECK (payload_sha256 ~ '^[0-9a-f]{64}$')");
    expect(table).toContain("CHECK (jsonb_typeof(raw_payload) = 'object')");
  });

  it('shapes the axis table as exactly six addressable criteria per revision', () => {
    const table = statements.find((s) => s.startsWith('CREATE TABLE external_grid_axes'))!;
    expect(table).toContain('UNIQUE (grid_id, orientation, position)');
    expect(table).toContain("CHECK (orientation IN ('row', 'col'))");
    expect(table).toContain('CHECK (position BETWEEN 0 AND 2)');
    expect(table).toContain("CHECK (btrim(raw_label) <> '')");
    expect(table).toMatch(/raw_label\s+text\s+NOT NULL/);
    // The detail the legacy capture destroyed, present but nullable: an
    // archive row genuinely has none, and NOT NULL would force a fabrication.
    for (const column of ['criterion_key', 'raw_title', 'raw_subtitle', 'raw_description', 'item_type']) {
      expect(table).toMatch(new RegExp(`${column}\\s+text,`));
    }
    expect(table).toContain('REFERENCES external_grids(id) ON DELETE CASCADE');
  });

  it('registers all three tables app-readable, because app read is fail-closed', () => {
    for (const table of ['external_grid_sources', 'external_grids', 'external_grid_axes']) {
      expect(flat).toContain(`afldb_meta.grant_app_read('${table}')`);
    }
  });

  it('refuses the import-write registry, which would hand back DELETE and TRUNCATE', () => {
    // grant_import_write() grants SELECT, INSERT, UPDATE, DELETE, TRUNCATE and
    // privileges.sql regenerates that set from the registry every run, so
    // registering these tables would silently undo their immutability.
    expect(flat).not.toContain('grant_import_write');
    expect(flat).not.toMatch(/GRANT[^;]*\bDELETE\b[^;]*external_grid/);
    expect(flat).not.toMatch(/GRANT[^;]*\bTRUNCATE\b[^;]*external_grid/);
  });

  it('grants the importer append-only access, with is_current the one mutable column', () => {
    expect(flat).toContain('GRANT SELECT, INSERT ON external_grids TO afldb_import');
    expect(flat).toContain('GRANT UPDATE (is_current) ON external_grids TO afldb_import');
    expect(flat).toContain('GRANT SELECT, INSERT ON external_grid_axes TO afldb_import');
    // The platform registry is seeded by this migration; the importer reads it.
    expect(flat).toContain('GRANT SELECT ON external_grid_sources TO afldb_import');
    expect(flat).not.toMatch(/GRANT[^;]*INSERT[^;]*ON external_grid_sources/);
    // Every grant is guarded, because the role may not exist yet on a cluster
    // whose migrations run before role setup.
    expect(flat).toMatch(/IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'afldb_import'\) THEN/);
  });

  it('records in the table comments that captured evidence is immutable', () => {
    // DELIBERATELY asserts prose: ISSUE-118 §19.3 requires the migration to
    // carry this in its comments, so the record is the requirement.
    const comments = migrationRaw.match(/COMMENT ON [^;]+;/g) ?? [];
    const joined = comments.join(' ');
    expect(joined).toMatch(/never overwritten/i);
    expect(joined).toMatch(/revision/i);
    expect(joined).toMatch(/NULL for rescued archive rows/i);
  });
});

describe('privileges.sql reconciliation for the corpus', () => {
  it('re-grants the narrow set after the revoke loop, so a reconcile keeps it', () => {
    // The afldb_import loop REVOKEs ALL on every public table absent from
    // import_writable_tables, so a migration-time grant does not survive
    // `npm run db:privileges` unless it is restated here.
    expect(privileges).toContain("IF to_regclass('public.external_grids') IS NOT NULL THEN");
    expect(privileges).toContain('GRANT SELECT, INSERT ON external_grids TO afldb_import;');
    expect(privileges).toContain('GRANT UPDATE (is_current) ON external_grids TO afldb_import;');
    expect(privileges).toContain('GRANT SELECT, INSERT ON external_grid_axes TO afldb_import;');
    expect(privileges).toContain('GRANT SELECT ON external_grid_sources TO afldb_import;');
  });

  it('never widens the corpus grants past append-only', () => {
    // Comment-stripped: the block's own commentary NAMES the DELETE and
    // TRUNCATE it refuses to grant, so a raw match would find the refusal.
    const blockStart = privilegesCode.indexOf("IF to_regclass('public.external_grid_sources') IS NOT NULL THEN");
    expect(blockStart).toBeGreaterThan(0);
    // Searched FROM the block start: the afldb_app section has its own
    // staging guard earlier in the file.
    const block = privilegesCode.slice(
      blockStart,
      privilegesCode.indexOf("IF to_regnamespace('staging') IS NOT NULL THEN", blockStart),
    );
    expect(block.length).toBeGreaterThan(0);
    expect(block).not.toMatch(/\bDELETE\b/);
    expect(block).not.toMatch(/\bTRUNCATE\b/);
    // The only UPDATE is column-scoped to is_current.
    const updates = block.match(/GRANT UPDATE[^;]*;/g) ?? [];
    expect(updates).toEqual(['GRANT UPDATE (is_current) ON external_grids TO afldb_import;']);
  });

  it('does not add the corpus to the afldb_auth spec', () => {
    // Nothing in the site or the admin surface writes this corpus.
    const spec = privileges.slice(privileges.indexOf('spec CONSTANT text[][]'), privileges.indexOf('written CONSTANT text[]'));
    expect(spec).not.toContain('external_grid');
  });
});

// ---------------------------------------------------------------------------
// Importer — source contract
// ---------------------------------------------------------------------------

describe('import_external_grids.py — source access', () => {
  it('opens the archive read-only twice over and never writes to it', () => {
    expect(importer).toContain('mode=ro');
    expect(importer).toContain('PRAGMA query_only=ON');
    // No statement that could mutate the archive exists in the file at all.
    const sqliteWrites = /con\.execute\(\s*f?["'](INSERT|UPDATE|DELETE|DROP|CREATE|VACUUM|ATTACH|REPLACE)/i;
    expect(importerCode).not.toMatch(sqliteWrites);
  });

  it('imports psycopg lazily, so the DB-free dry run needs no driver', () => {
    // Module scope: everything above the first section rule.
    const header = importer.slice(0, importer.indexOf('\n# ---'));
    expect(header.length).toBeGreaterThan(0);
    expect(header).not.toMatch(/^import psycopg/m);
    expect(header).not.toMatch(/^from common import/m);
    expect(importer).toMatch(/^\s+from common import connect_pg, import_batch/m);
  });

  it('is importable without psycopg installed', () => {
    // The lazy import proved behaviourally, not just by inspection.
    const result = runPython([
      'import sys, importlib',
      'sys.modules["psycopg"] = None',
      'sys.path.insert(0, "tools/migration")',
      'm = importlib.import_module("import_external_grids")',
      'print(m.AXIS_LENGTH, m.PROVENANCE, m.GRID_SOURCE_CODE)',
    ].join('\n'));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('3 legacy_sqlite gridley');
  });

  it('refuses an archive whose table is missing', () => {
    const archive = buildArchive([BOARD_ONE], { table: 'something_else' });
    const run = dryRun(archive);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("'historic_grids' is not present");
  });

  it('refuses an archive holding another game\u2019s grids', () => {
    const archive = buildArchive([BOARD_ONE, { ...BOARD_TWO, source: 'Immaculate Grid' }]);
    const run = dryRun(archive);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('non-Gridley source value');
    // Refused before any row is imported, not filtered silently.
    expect(run.stdout).not.toContain('boards parsed');
  });
});

// ---------------------------------------------------------------------------
// Importer — parsing and rejection
// ---------------------------------------------------------------------------

describe('import_external_grids.py — structural rejection', () => {
  it('accepts a well-formed archive and reports what it read', () => {
    const run = dryRun(buildArchive([BOARD_ONE, BOARD_TWO]));
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('boards parsed        : 2');
    expect(run.stdout).toContain('rows rejected        : 0');
    expect(run.stdout).toContain('axis occurrences     : 12');
    expect(run.stdout).toContain('No database was contacted.');
  });

  const rejections: Array<[string, LegacyRow, string]> = [
    ['malformed JSON', { ...BOARD_TWO, rows_json: '["a", "b", ' }, 'rows_json_malformed'],
    ['a JSON object instead of an array', { ...BOARD_TWO, cols_json: '{"a": 1}' }, 'cols_json_not_array'],
    ['two criteria instead of three', { ...BOARD_TWO, rows_json: '["a", "b"]' }, 'rows_json_wrong_length'],
    ['four criteria instead of three', { ...BOARD_TWO, cols_json: '["a","b","c","d"]' }, 'cols_json_wrong_length'],
    ['a non-string criterion', { ...BOARD_TWO, rows_json: '["a", 7, "c"]' }, 'rows_json_non_string'],
    ['a blank criterion', { ...BOARD_TWO, cols_json: '["a", "   ", "c"]' }, 'cols_json_blank'],
    ['a NULL axis column', { ...BOARD_TWO, rows_json: null }, 'rows_json_missing'],
    ['a non-ISO date', { ...BOARD_TWO, date: '18/07/2023' }, 'date_not_iso'],
    ['a compact date the stdlib would have accepted', { ...BOARD_TWO, date: '20230718' }, 'date_not_iso'],
    ['an impossible date', { ...BOARD_TWO, date: '2023-02-30' }, 'date_invalid'],
    ['a NULL date', { ...BOARD_TWO, date: null }, 'date_missing'],
    ['malformed unsupported_json', { ...BOARD_TWO, unsupported_json: '[[' }, 'unsupported_json_malformed'],
  ];

  for (const [label, row, reason] of rejections) {
    it(`rejects and names ${label}`, () => {
      const run = dryRun(buildArchive([BOARD_ONE, row]));
      expect(run.status).toBe(1);
      expect(run.stdout).toContain(reason);
      expect(run.stdout).toContain('rows rejected        : 1');
      // Fails closed for the WHOLE corpus: the good board is not written
      // either, so a defect cannot leave a half-rescued archive behind.
      expect(run.stderr).toContain('Nothing was written.');
    });
  }

  it('rejects two boards claiming the same date', () => {
    const run = dryRun(buildArchive([BOARD_ONE, { ...BOARD_TWO, date: BOARD_ONE.date }]));
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('duplicate_date');
    expect(run.stderr).toContain('Nothing was written.');
  });

  it('reports a gap in the board-number sequence without failing on it', () => {
    // A gap is an observation about the archive, not a structural defect:
    // the corpus is still importable and the gap is what a later backfill
    // would close.
    const run = dryRun(buildArchive([BOARD_ONE, { ...BOARD_TWO, grid_num: 3, date: '2023-07-19' }]));
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('gaps in number range : 1 - 2');
  });

  it('preserves criterion text exactly, without trimming or case folding', () => {
    const result = runPython([
      'import json, sys',
      'sys.path.insert(0, "tools/migration")',
      'from import_external_grids import parse_axis',
      'raw = json.dumps(["  PLAYED IN 2010s  ", "Brisbane Lions", "IRISH PLAYER \\U0001F1EE\\U0001F1EA"])',
      'print(json.dumps(list(parse_axis(raw, "rows_json"))))',
    ].join('\n'));
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual([
      '  PLAYED IN 2010s  ',
      'Brisbane Lions',
      'IRISH PLAYER \u{1F1EE}\u{1F1EA}',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Importer — determinism and idempotency
// ---------------------------------------------------------------------------

describe('import_external_grids.py — determinism', () => {
  it('hashes a board identically on every run, over a key-ordered payload', () => {
    const program = [
      'import sys',
      'sys.path.insert(0, "tools/migration")',
      'from import_external_grids import canonical_json, payload_hash',
      'a = {"b": 1, "a": {"z": "\\u00e9", "y": 2}}',
      'b = {"a": {"y": 2, "z": "\\u00e9"}, "b": 1}',
      'print(canonical_json(a))',
      'print(payload_hash(a))',
      'print(payload_hash(b))',
    ].join('\n');
    const first = runPython(program);
    const second = runPython(program);
    expect(first.status, first.stderr).toBe(0);
    const [canonical, hashA, hashB] = first.stdout.trim().split(/\r?\n/);
    // Sorted keys, no insignificant whitespace: the recipe a verifier can
    // reproduce from the jsonb PostgreSQL stores.
    expect(canonical).toBe('{"a":{"y":2,"z":"\u00e9"},"b":1}');
    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[0-9a-f]{64}$/);
    expect(second.stdout).toBe(first.stdout);
  });

  it('produces byte-identical output for the same archive twice', () => {
    const archive = buildArchive([BOARD_ONE, BOARD_TWO]);
    const first = dryRun(archive);
    const second = dryRun(archive);
    expect(first.status, first.stderr).toBe(0);
    expect(second.stdout).toBe(first.stdout);
  });

  it('leaves the source archive byte-identical', () => {
    const archive = buildArchive([BOARD_ONE, BOARD_TWO]);
    const before = sha256(archive);
    expect(dryRun(archive).status).toBe(0);
    expect(sha256(archive)).toBe(before);
    // No journal, WAL or shared-memory file was created beside it either.
    for (const suffix of ['-journal', '-wal', '-shm']) {
      expect(existsSync(archive + suffix)).toBe(false);
    }
  });

  it('classifies an already-captured board as unchanged, never as a rewrite', () => {
    // The upsert decision itself, exercised directly: the same classifier the
    // real import uses, so a dry run cannot report something the import would
    // not do. Executing it against PostgreSQL is the operator's gate.
    const result = runPython([
      'import json, sqlite3, sys',
      'sys.path.insert(0, "tools/migration")',
      'import import_external_grids as m',
      'con = sqlite3.connect(":memory:")',
      'con.row_factory = sqlite3.Row',
      'con.execute("CREATE TABLE historic_grids (grid_num INTEGER PRIMARY KEY, date TEXT,'
        + ' source TEXT, rows_json TEXT, cols_json TEXT, unsupported_json TEXT, note TEXT)")',
      'con.execute("INSERT INTO historic_grids VALUES (1, \'2023-07-17\', \'Gridley\','
        + ' \'[\\"a\\",\\"b\\",\\"c\\"]\', \'[\\"d\\",\\"e\\",\\"f\\"]\', \'[]\', \'\')")',
      'board = m.parse_board(con.execute("SELECT * FROM historic_grids").fetchone())',
      'fresh = m.classify([board], {}, {})',
      'same = m.classify([board], {1: board.payload_sha256}, {"2023-07-17": 1})',
      'differs = m.classify([board], {1: "0" * 64}, {"2023-07-17": 1})',
      'moved = m.classify([board], {}, {"2023-07-17": 99})',
      'print(json.dumps({',
      '  "fresh": [fresh.inserted, fresh.unchanged, len(fresh.conflicts)],',
      '  "same": [same.inserted, same.unchanged, len(same.conflicts)],',
      '  "differs": [differs.inserted, differs.unchanged, len(differs.conflicts)],',
      '  "moved": [moved.inserted, moved.unchanged, len(moved.conflicts)],',
      '  "axes": board.axes(),',
      '}))',
    ].join('\n'));
    expect(result.status, result.stderr).toBe(0);
    const out = JSON.parse(result.stdout.trim());
    expect(out.fresh).toEqual([[1], [], 0]);
    // A rerun is a no-op, which is what makes the importer restartable.
    expect(out.same).toEqual([[], [1], 0]);
    // Different content for a captured board never overwrites it.
    expect(out.differs).toEqual([[], [], 1]);
    // A date already held by another board is a conflict, caught before the
    // write rather than as a unique-index violation part-way through it.
    expect(out.moved).toEqual([[], [], 1]);
    expect(out.axes).toEqual([
      ['row', 0, 'a'], ['row', 1, 'b'], ['row', 2, 'c'],
      ['col', 0, 'd'], ['col', 1, 'e'], ['col', 2, 'f'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Importer — the dry run cannot write
// ---------------------------------------------------------------------------

describe('import_external_grids.py — a dry run writes nothing', () => {
  const runBody = importer.slice(importer.indexOf('def run('));
  const dryRunBranch = runBody.slice(
    runBody.indexOf('        if args.dry_run:'),
    runBody.indexOf('        to_insert = set(outcome.inserted)'),
  );

  it('has a dry-run branch that reaches neither an import batch nor an INSERT', () => {
    expect(dryRunBranch.length).toBeGreaterThan(0);
    expect(dryRunBranch).not.toContain('import_batch(');
    expect(dryRunBranch).not.toContain('insert_board(');
    expect(dryRunBranch).not.toMatch(/INSERT INTO/i);
    // Opening an import batch is itself a committed INSERT, so the dry run
    // must not open one, and it rolls the read transaction back regardless.
    expect(dryRunBranch).toContain('conn.rollback()');
  });

  it('refuses --no-db outside a dry run', () => {
    const result = spawnSync(python, [IMPORTER_PATH, '--no-db'], { cwd: root, encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--no-db is a dry-run mode');
  });

  it('refuses --limit outside a dry run, so a partial rescue cannot look complete', () => {
    const result = spawnSync(python, [IMPORTER_PATH, '--limit', '5'], { cwd: root, encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--limit is a dry-run diagnostic');
  });

  it('never writes a captured column, in any mode', () => {
    // The only UPDATE the importer may ever issue is the revision supersession
    // the grants allow; Stage 1 issues none at all.
    expect(importerCode).not.toMatch(/UPDATE external_grid/i);
    expect(importerCode).not.toMatch(/DELETE FROM external_grid/i);
    expect(importerCode).not.toMatch(/TRUNCATE/i);
    expect(importerCode).not.toMatch(/ON CONFLICT[^;]*DO UPDATE/i);
  });
});

// ---------------------------------------------------------------------------
// The real archive
// ---------------------------------------------------------------------------

describe('the rescued Gridley archive', () => {
  const legacyPath = process.env.AFLDB_LEGACY_SQLITE ?? 'D:/dev/sports_data_lab/data/afl/afl.db';
  const available = existsSync(legacyPath);

  it.skipIf(!available)(
    'validates all 1,123 archived boards without a single rejection',
    () => {
      const run = dryRun(legacyPath);
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout).toContain('boards parsed        : 1123');
      expect(run.stdout).toContain('rows rejected        : 0');
      expect(run.stdout).toContain('board number range   : #1 - #1123');
      expect(run.stdout).toContain('board date range     : 2023-07-17 - 2026-08-12');
      expect(run.stdout).toContain('gaps in number range : 0');
      expect(run.stdout).toContain('duplicate numbers    : 0');
      expect(run.stdout).toContain('duplicate dates      : 0');
      // ISSUE-118 §3 and §4, reproduced by the importer rather than trusted:
      // 1,123 x 6 axis occurrences over 788 distinct raw criteria.
      expect(run.stdout).toContain('axis occurrences     : 6738');
      expect(run.stdout).toContain('distinct raw labels  : 788');
    },
    120_000,
  );

  if (!available) {
    // Explicit, not silent: the archive is a 537 MB operator-supplied artefact
    // that is never committed, so CI skips this and says why.
    console.warn(
      `[AFLDB-ISSUE-118] legacy archive not present at ${legacyPath}; `
      + 'the 1,123-board validation was skipped. Set AFLDB_LEGACY_SQLITE to run it.',
    );
  }
});
