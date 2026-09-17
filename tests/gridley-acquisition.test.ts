/**
 * AFLDB-ISSUE-118 Stage 2 — the Gridley acquisition and import contract.
 *
 * Two tools, one home:
 *
 *   1. `tools/migration/acquire_gridley_boards.py`, driven for real against a
 *      loopback HTTP server this suite starts, which serves the committed
 *      fixtures. Every acquisition behaviour below — first capture, resume,
 *      revision, 404, HTTP error, retry/backoff, malformed body, robots,
 *      pacing, bounding — is proved by running the tool, not by reading it.
 *   2. `tools/migration/import_gridley_boards.py`, driven over the snapshots
 *      the acquisition tests produce, in its `--dry-run --no-db` mode.
 *
 * NO NETWORK AND NO DATABASE. Nothing here contacts gridleygame.com and
 * nothing connects to PostgreSQL: the importer's write path is asserted
 * structurally, because executing it needs a database, which `CLAUDE.md` §9
 * reserves for the operator.
 *
 * THE FIXTURES ARE REAL. `tests/fixtures/gridley/*.json` are the exact
 * response bodies of two Gridley boards, captured by the Stage 0 live probe on
 * 2026-08-31 and stored byte-for-byte:
 *
 *   board-0001-2023-07-17.json  Gridley #1, the oldest board still served
 *   board-1139-2026-08-28.json  a recent board, carrying a `type: "player"`
 *                               teammate item and a `theme`
 *
 * A simplified hand-written payload would be the one thing this suite must not
 * use: the whole point of Stage 2 is that the API carries detail the rescued
 * archive lost, and an invented fixture would agree with whatever the parser
 * happened to do with it.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import {
  existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');

const ACQUIRE_PATH = 'tools/migration/acquire_gridley_boards.py';
const IMPORT_PATH = 'tools/migration/import_gridley_boards.py';
const FIXTURE_DIR = join(root, 'tests', 'fixtures', 'gridley');

const BOARD_1 = 'board-0001-2023-07-17.json';
const BOARD_1139 = 'board-1139-2026-08-28.json';
const BOARD_1_DATE = '2023-07-17';
const BOARD_1139_DATE = '2026-08-28';

const acquirerSource = read(...ACQUIRE_PATH.split('/'));
const importerSource = read(...IMPORT_PATH.split('/'));

/**
 * Both files with their prose removed — docstrings and `#` comments.
 *
 * Several assertions say a verb must not appear ANYWHERE in a file (`DELETE`,
 * `TRUNCATE`, an UPDATE of a captured column). Both files explain at length why
 * they never issue those, so a match over the raw source finds the explanation
 * rather than the statement. Same false positive the Stage 1 suite avoids.
 */
const strip = (source: string) => source
  .replace(/"""[\s\S]*?"""/g, '""')
  .replace(/'''[\s\S]*?'''/g, "''")
  .replace(/#[^\n]*/g, '');

/** The acquirer holds no SQL, so stripping its prose is safe. */
const acquirerCode = strip(acquirerSource);

/**
 * The importer's SQL, statement by statement, taken from its execute() calls.
 *
 * NOT from stripped source. The importer's SQL lives in triple-quoted strings,
 * which is exactly what the prose stripper removes — an assertion over
 * `strip(importerSource)` would be reading a file with no SQL in it and would
 * pass whatever the SQL said. Reading the statements directly also removes the
 * opposite hazard: a `DELETE` mentioned in a docstring explaining that the file
 * issues none cannot satisfy or fail an assertion about the SQL.
 */
const sql = [...importerSource.matchAll(
  /cur\.execute(?:many)?\(\s*(?:"""([\s\S]*?)"""|"([^"]*)")/g)]
  .map((match) => (match[1] ?? match[2]).replace(/\s+/g, ' ').trim());

const venvPython = process.platform === 'win32'
  ? join(root, '.venv', 'Scripts', 'python.exe')
  : join(root, '.venv', 'bin', 'python');
const python = process.env.AFLDB_PYTHON
  ?? (existsSync(venvPython) ? venvPython : (process.platform === 'win32' ? 'python' : 'python3'));
const pythonEnv = { ...process.env, PYTHONIOENCODING: 'utf-8' };

function hasPython(): boolean {
  const probe = spawnSync(python, ['--version'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
}
const canSpawn = hasPython();
const itPy = canSpawn ? it : it.skip;

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

const workspaces: string[] = [];
function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'afldb-gridley-'));
  workspaces.push(dir);
  return dir;
}
const servers: Server[] = [];
afterAll(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// A loopback stand-in for the Gridley endpoint
// ---------------------------------------------------------------------------

type Reply = { status: number; body?: Buffer | string };

type Routes = Record<string, Reply | Reply[]>;

type Stub = {
  baseUrl: string;
  /** Every path requested, in order. Proves what was and was not fetched. */
  hits: string[];
  /** Replace the routing table mid-test, e.g. to change what upstream serves. */
  setRoutes: (routes: Routes) => void;
};

const ROBOTS_ALLOW = 'User-agent: *\nAllow: /\n';

async function stubGridley(routes: Routes, robots = ROBOTS_ALLOW): Promise<Stub> {
  let table = routes;
  const hits: string[] = [];
  const pending = new Map<string, number>();

  const server = createServer((req, res) => {
    const path = req.url ?? '';
    hits.push(path);
    if (path === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(robots);
      return;
    }
    const entry = table[path];
    if (entry === undefined) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    let reply: Reply;
    if (Array.isArray(entry)) {
      const index = pending.get(path) ?? 0;
      reply = entry[Math.min(index, entry.length - 1)];
      pending.set(path, index + 1);
    } else {
      reply = entry;
    }
    const raw = reply.body ?? `status ${reply.status}`;
    const body = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw;
    if (reply.status === 200) {
      res.writeHead(200, {
        'Content-Type': 'application/json', 'Content-Length': String(body.length),
      });
      res.end(body);
      return;
    }
    res.writeHead(reply.status, { 'Content-Type': 'text/plain' });
    res.end(body);
  });
  servers.push(server);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    hits,
    setRoutes: (next: Routes) => { table = next; pending.clear(); },
  };
}

const boardPath = (isoDate: string) => `/data/grids/${isoDate}.json`;
const fixture = (name: string) => readFileSync(join(FIXTURE_DIR, name));

// ---------------------------------------------------------------------------
// Running the tools
// ---------------------------------------------------------------------------

type ToolResult = { status: number; stdout: string; stderr: string };

/**
 * Run one tool to completion.
 *
 * ASYNC ON PURPOSE. `spawnSync` blocks the Node event loop, so the stub server
 * above - which lives in this process - could not answer the request the tool
 * is blocked waiting on, and every acquisition test would deadlock until the
 * tool's own 20s timeout. Every invocation here is awaited instead.
 */
function runTool(script: string, args: string[]): Promise<ToolResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, [script, ...args], { cwd: root, env: pythonEnv });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ status: code ?? -1, stdout, stderr }));
  });
}

const acquire = (args: string[]) => runTool(ACQUIRE_PATH, args);
const importSnapshot = (args: string[]) => runTool(IMPORT_PATH, args);

/** Parse the acquirer's outcome block into a count per outcome name. */
function outcomes(stdout: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const line of stdout.split('\n')) {
    const match = /^ {2}(\w+) +: +(\d+)/.exec(line);
    if (match) counts[match[1]] = Number(match[2]);
  }
  return counts;
}

const rawFiles = (snapshot: string) => {
  const dir = join(snapshot, 'raw');
  return existsSync(dir) ? readdirSync(dir).sort() : [];
};
const rejectedFiles = (snapshot: string) => {
  const dir = join(snapshot, 'rejected');
  return existsSync(dir) ? readdirSync(dir).sort() : [];
};
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/** A snapshot root plus the `history` label the tools default to. */
function snapshotRoot(): { root: string; snapshot: string } {
  const dir = workspace();
  return { root: dir, snapshot: join(dir, 'history') };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

describe('captured Gridley fixtures', () => {
  it('are the exact bytes the Stage 0 probe received', () => {
    // Pinned so a reformat, a re-save or a CRLF checkout is a failing test and
    // not a silently different corpus. .gitattributes marks them -text.
    expect(sha256(fixture(BOARD_1)))
      .toBe('7c258cdd49c2b44814584266d9e0807aeb2503d74f01a31b1dbedf94144eef40');
    expect(sha256(fixture(BOARD_1139)))
      .toBe('960e81e177af7a7a9b8fd6c8274a772ba4dc9df1dd69debe36b57fff1827b0f9');
  });

  it('carry the detail the rescued archive lost', () => {
    for (const name of [BOARD_1, BOARD_1139]) {
      const payload = JSON.parse(fixture(name).toString('utf8'));
      expect(Object.keys(payload).sort()).toEqual([
        'completed', 'correctAnswersPlayerMap', 'correctGuesses', 'hItems',
        'level', 'scoreMap', 'social', 'started', 'vItems',
      ]);
      for (const side of ['hItems', 'vItems'] as const) {
        expect(payload[side]).toHaveLength(3);
        for (const item of payload[side]) {
          expect(typeof item.id).toBe('string');
          expect(item.id.trim().length).toBeGreaterThan(0);
          expect(typeof item.title).toBe('string');
          expect(typeof item.description).toBe('string');
          expect(Object.keys(item).sort()).toEqual([
            'description', 'emoji', 'id', 'imgUrl', 'showOnLaunch', 'subtitle',
            'theme', 'title', 'type',
          ]);
        }
      }
      // The answer key: a 3x3 grid of {gridleyPlayerId: guessCount}.
      expect(payload.correctAnswersPlayerMap).toHaveLength(3);
      for (const row of payload.correctAnswersPlayerMap) {
        expect(row).toHaveLength(3);
        for (const cell of row) {
          expect(typeof cell).toBe('object');
          expect(Object.keys(cell).length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('include the item shapes the parser has to handle', () => {
    const modern = JSON.parse(fixture(BOARD_1139).toString('utf8'));
    const typed = modern.vItems.find((item: { type: string | null }) => item.type !== null);
    expect(typed.type).toBe('player');
    expect(typed.imgUrl).toBeTruthy();
    // The lossy legacy case: the title is a substring of the subtitle, so the
    // legacy label dropped the title entirely (ISSUE-118 §4.1).
    expect(typed.subtitle.toLowerCase()).toContain(typed.title.toLowerCase());

    const oldest = JSON.parse(fixture(BOARD_1).toString('utf8'));
    expect(oldest.level).toBe(1);
    expect(oldest.hItems.some((item: { subtitle: string | null }) => item.subtitle === null))
      .toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Acquisition
// ---------------------------------------------------------------------------

describe('acquire_gridley_boards.py — capture', () => {
  itPy('saves the exact response bytes and a truthful request record', async () => {
    const stub = await stubGridley({
      [boardPath(BOARD_1_DATE)]: { status: 200, body: fixture(BOARD_1) },
    });
    const { root: dir, snapshot } = snapshotRoot();
    const result = await acquire([
      '--date', BOARD_1_DATE, '--base-url', stub.baseUrl,
      '--snapshot-root', dir, '--delay', '0',
    ]);

    expect(result.status, result.stderr).toBe(0);
    expect(outcomes(result.stdout).saved).toBe(1);

    const files = rawFiles(snapshot);
    expect(files).toHaveLength(1);
    const stored = readFileSync(join(snapshot, 'raw', files[0]));
    // Byte-for-byte, not "equivalent JSON": the payload is the evidence.
    expect(stored.equals(fixture(BOARD_1))).toBe(true);
    expect(files[0]).toBe(`${BOARD_1_DATE}__${sha256(fixture(BOARD_1)).slice(0, 16)}.json`);

    const record = JSON.parse(readFileSync(join(snapshot, 'http', files[0]), 'utf8'));
    expect(record.http_status).toBe(200);
    expect(record.body_sha256).toBe(sha256(fixture(BOARD_1)));
    expect(record.board_date).toBe(BOARD_1_DATE);
    expect(record.level).toBe(1);
    expect(record.expected_level).toBe(1);
    expect(record.byte_size).toBe(fixture(BOARD_1).length);
    expect(record.fetched_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

    // One run record, naming what happened to every date considered.
    const runs = readdirSync(join(snapshot, 'runs'));
    expect(runs).toHaveLength(1);
    const run = JSON.parse(readFileSync(join(snapshot, 'runs', runs[0]), 'utf8'));
    expect(run.status).toBe('completed');
    expect(run.counts.saved).toBe(1);
    expect(run.dates_considered).toEqual([BOARD_1_DATE]);
  });

  itPy('does not re-request a date it already holds', async () => {
    const stub = await stubGridley({
      [boardPath(BOARD_1_DATE)]: { status: 200, body: fixture(BOARD_1) },
    });
    const { root: dir, snapshot } = snapshotRoot();
    const args = ['--date', BOARD_1_DATE, '--base-url', stub.baseUrl,
      '--snapshot-root', dir, '--delay', '0'];

    expect((await acquire(args)).status).toBe(0);
    const afterFirst = stub.hits.length;

    const second = await acquire(args);
    expect(second.status, second.stderr).toBe(0);
    expect(outcomes(second.stdout).skipped).toBe(1);
    expect(outcomes(second.stdout).saved).toBe(0);
    // Resumability is the point: the board endpoint is not touched again.
    expect(stub.hits.slice(afterFirst).filter((p) => p !== '/robots.txt')).toEqual([]);
    expect(rawFiles(snapshot)).toHaveLength(1);
  });

  itPy('completes a capture a killed run left without its request record', async () => {
    const stub = await stubGridley({
      [boardPath(BOARD_1_DATE)]: { status: 200, body: fixture(BOARD_1) },
    });
    const { root: dir, snapshot } = snapshotRoot();
    const args = ['--date', BOARD_1_DATE, '--base-url', stub.baseUrl,
      '--snapshot-root', dir, '--delay', '0'];
    expect((await acquire(args)).status).toBe(0);

    // The one state a run killed between its two writes can leave: raw bytes
    // with no record of when they were fetched. The importer refuses such a
    // capture, so acquisition must not treat the date as held.
    const name = rawFiles(snapshot)[0];
    rmSync(join(snapshot, 'http', name));

    const repaired = await acquire(args);
    expect(repaired.status, repaired.stderr).toBe(0);
    expect(repaired.stdout).toContain('INCOMPLETE: 1 capture(s)');
    expect(outcomes(repaired.stdout).unchanged).toBe(1);
    expect(rawFiles(snapshot)).toEqual([name]);

    const record = JSON.parse(readFileSync(join(snapshot, 'http', name), 'utf8'));
    expect(record.capture).toBe('record_completed');
    expect(record.body_sha256).toBe(sha256(fixture(BOARD_1)));

    // And the snapshot imports cleanly again.
    const imported = await importSnapshot(['--dry-run', '--no-db', '--snapshot', snapshot]);
    expect(imported.status, imported.stderr).toBe(0);
    expect(imported.stdout).toContain('captures rejected    : 0');
  });

  itPy('keeps both captures when upstream content changes, and overwrites neither', async () => {
    const original = fixture(BOARD_1);
    const stub = await stubGridley({ [boardPath(BOARD_1_DATE)]: { status: 200, body: original } });
    const { root: dir, snapshot } = snapshotRoot();
    const args = ['--date', BOARD_1_DATE, '--base-url', stub.baseUrl,
      '--snapshot-root', dir, '--delay', '0'];

    expect((await acquire(args)).status).toBe(0);
    const firstName = rawFiles(snapshot)[0];

    // Re-fetching identical bytes is a no-op, not a second capture.
    const unchanged = await acquire([...args, '--refresh']);
    expect(unchanged.status, unchanged.stderr).toBe(0);
    expect(outcomes(unchanged.stdout).unchanged).toBe(1);
    expect(rawFiles(snapshot)).toEqual([firstName]);

    // Now upstream serves something different for the same date.
    const changed = JSON.parse(original.toString('utf8'));
    changed.completed = changed.completed + 1;
    const changedBody = JSON.stringify(changed, null, 4);
    stub.setRoutes({ [boardPath(BOARD_1_DATE)]: { status: 200, body: changedBody } });

    const revised = await acquire([...args, '--refresh']);
    expect(revised.status, revised.stderr).toBe(0);
    expect(outcomes(revised.stdout).revised).toBe(1);

    const files = rawFiles(snapshot);
    expect(files).toHaveLength(2);
    // The original capture is still there, byte-identical. This is the whole
    // difference from the legacy scraper, which UPDATEd the row in place.
    expect(readFileSync(join(snapshot, 'raw', firstName)).equals(original)).toBe(true);
    const second = files.find((name) => name !== firstName)!;
    expect(readFileSync(join(snapshot, 'raw', second), 'utf8')).toBe(changedBody);
    const record = JSON.parse(readFileSync(join(snapshot, 'http', second), 'utf8'));
    expect(record.capture).toBe('revised');
    expect(record.supersedes).toEqual([sha256(original).slice(0, 16)]);
  });
});

describe('acquire_gridley_boards.py — failure is named, never silent', () => {
  itPy('reports a clean 404 as unavailable, and as a failure under --require-complete', async () => {
    const stub = await stubGridley({});
    const { root: dir, snapshot } = snapshotRoot();
    const args = ['--date', BOARD_1_DATE, '--base-url', stub.baseUrl,
      '--snapshot-root', dir, '--delay', '0'];

    const lenient = await acquire(args);
    expect(lenient.status, lenient.stderr).toBe(0);
    expect(outcomes(lenient.stdout).unavailable).toBe(1);
    expect(rawFiles(snapshot)).toEqual([]);
    // A 404 is a clean answer and is never retried.
    expect(stub.hits.filter((p) => p === boardPath(BOARD_1_DATE))).toHaveLength(1);

    const strict = await acquire([...args, '--require-complete']);
    expect(strict.status).toBe(1);
    expect(strict.stderr).toContain('--require-complete');
  });

  itPy('reports a non-retryable HTTP status as http_error and writes nothing', async () => {
    const stub = await stubGridley({ [boardPath(BOARD_1_DATE)]: { status: 403 } });
    const { root: dir, snapshot } = snapshotRoot();
    const result = await acquire(['--date', BOARD_1_DATE, '--base-url', stub.baseUrl,
      '--snapshot-root', dir, '--delay', '0']);

    expect(result.status).toBe(1);
    expect(outcomes(result.stdout).http_error).toBe(1);
    expect(result.stderr).toContain('403');
    expect(rawFiles(snapshot)).toEqual([]);
    expect(stub.hits.filter((p) => p === boardPath(BOARD_1_DATE))).toHaveLength(1);
  });

  itPy('retries a 5xx with backoff and succeeds when the source recovers', async () => {
    // The real 2s/4s backoff, not a shortened one: the policy under test is
    // the one that will run against Gridley.
    const stub = await stubGridley({
      [boardPath(BOARD_1_DATE)]: [
        { status: 503 }, { status: 503 }, { status: 200, body: fixture(BOARD_1) },
      ],
    });
    const { root: dir, snapshot } = snapshotRoot();
    const result = await acquire(['--date', BOARD_1_DATE, '--base-url', stub.baseUrl,
      '--snapshot-root', dir, '--delay', '0']);

    expect(result.status, result.stderr).toBe(0);
    expect(outcomes(result.stdout).saved).toBe(1);
    expect(stub.hits.filter((p) => p === boardPath(BOARD_1_DATE))).toHaveLength(3);
    expect(rawFiles(snapshot)).toHaveLength(1);
  }, 30_000);

  itPy('refuses a malformed body, keeps it as evidence, and leaves raw/ empty', async () => {
    const stub = await stubGridley({
      [boardPath(BOARD_1_DATE)]: { status: 200, body: '{"level": 1, "hItems": [' },
    });
    const { root: dir, snapshot } = snapshotRoot();
    const result = await acquire(['--date', BOARD_1_DATE, '--base-url', stub.baseUrl,
      '--snapshot-root', dir, '--delay', '0']);

    expect(result.status).toBe(1);
    expect(outcomes(result.stdout).malformed_json).toBe(1);
    // Not a board: it never reaches raw/, so the importer can never see it and
    // the next run retries the date instead of trusting a bad capture.
    expect(rawFiles(snapshot)).toEqual([]);
    const rejected = rejectedFiles(snapshot);
    expect(rejected).toHaveLength(1);
    const record = JSON.parse(readFileSync(join(snapshot, 'rejected', rejected[0]), 'utf8'));
    expect(record.rejected_because).toBe('malformed_json');
    expect(record.body).toBe('{"level": 1, "hItems": [');
  });

  itPy('refuses a well-formed response that is not the board it asked for', async () => {
    // The realistic failure this catches: an endpoint that answers every date
    // with the current board. Without the check the snapshot fills with copies.
    const stub = await stubGridley({
      [boardPath(BOARD_1_DATE)]: { status: 200, body: fixture(BOARD_1139) },
    });
    const { root: dir, snapshot } = snapshotRoot();
    const args = ['--date', BOARD_1_DATE, '--base-url', stub.baseUrl,
      '--snapshot-root', dir, '--delay', '0'];

    const refused = await acquire(args);
    expect(refused.status).toBe(1);
    expect(outcomes(refused.stdout).shape_invalid).toBe(1);
    expect(refused.stderr).toMatch(/level 1139 is not the board for 2023-07-17/);
    expect(rawFiles(snapshot)).toEqual([]);

    // The escape hatch exists, is explicit, and records what it accepted.
    const allowed = await acquire([...args, '--allow-level-drift']);
    expect(allowed.status, allowed.stderr).toBe(0);
    expect(outcomes(allowed.stdout).saved).toBe(1);
    const record = JSON.parse(readFileSync(
      join(snapshot, 'http', rawFiles(snapshot)[0]), 'utf8'));
    expect(record.level).toBe(1139);
    expect(record.expected_level).toBe(1);
  });

  itPy('refuses a board whose axes are not three items', async () => {
    const broken = JSON.parse(fixture(BOARD_1).toString('utf8'));
    broken.vItems = broken.vItems.slice(0, 2);
    const stub = await stubGridley({
      [boardPath(BOARD_1_DATE)]: { status: 200, body: JSON.stringify(broken) },
    });
    const { root: dir, snapshot } = snapshotRoot();
    const result = await acquire(['--date', BOARD_1_DATE, '--base-url', stub.baseUrl,
      '--snapshot-root', dir, '--delay', '0']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('vItems has 2 item(s), expected 3');
    expect(rawFiles(snapshot)).toEqual([]);
  });

  itPy('refuses a board whose criterion id is missing', async () => {
    const broken = JSON.parse(fixture(BOARD_1).toString('utf8'));
    broken.hItems[1].id = '';
    const stub = await stubGridley({
      [boardPath(BOARD_1_DATE)]: { status: 200, body: JSON.stringify(broken) },
    });
    const { root: dir, snapshot } = snapshotRoot();
    const result = await acquire(['--date', BOARD_1_DATE, '--base-url', stub.baseUrl,
      '--snapshot-root', dir, '--delay', '0']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('hItems[1].id');
    expect(rawFiles(snapshot)).toEqual([]);
  });

  itPy('reports a transport failure as network_error without writing anything', async () => {
    const { root: dir, snapshot } = snapshotRoot();
    // Port 1 on loopback: refused immediately, no external traffic. robots.txt
    // cannot be read either, so the run stops before requesting any board.
    const result = await acquire(['--date', BOARD_1_DATE, '--base-url', 'http://127.0.0.1:1',
      '--snapshot-root', dir, '--delay', '0']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('robots.txt could not be fetched');
    expect(rawFiles(snapshot)).toEqual([]);
  }, 60_000);
});

describe('acquire_gridley_boards.py — source safety', () => {
  itPy('stops when robots.txt disallows the endpoint, and does not work around it', async () => {
    const stub = await stubGridley(
      { [boardPath(BOARD_1_DATE)]: { status: 200, body: fixture(BOARD_1) } },
      'User-agent: *\nDisallow: /data/\n',
    );
    const { root: dir, snapshot } = snapshotRoot();
    const result = await acquire(['--date', BOARD_1_DATE, '--base-url', stub.baseUrl,
      '--snapshot-root', dir, '--delay', '0']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('robots.txt disallows');
    expect(rawFiles(snapshot)).toEqual([]);
    expect(stub.hits).toEqual(['/robots.txt']);
  });

  it('offers no flag to ignore robots.txt', () => {
    expect(acquirerCode).not.toMatch(/--ignore-robots|--no-robots|--force/);
  });

  itPy('paces its requests', async () => {
    const stub = await stubGridley({
      [boardPath('2023-07-17')]: { status: 200, body: fixture(BOARD_1) },
      [boardPath('2023-07-18')]: { status: 404 },
      [boardPath('2023-07-19')]: { status: 404 },
    });
    const { root: dir } = snapshotRoot();
    const started = Date.now();
    const result = await acquire(['--from', '2023-07-17', '--to', '2023-07-19',
      '--base-url', stub.baseUrl, '--snapshot-root', dir, '--delay', '0.4']);
    const elapsed = Date.now() - started;

    expect(result.status, result.stderr).toBe(0);
    // robots + 3 boards = 4 requests = 3 enforced gaps.
    expect(elapsed).toBeGreaterThanOrEqual(1_000);
  }, 30_000);

  itPy('bounds a run and says exactly where to resume', async () => {
    const stub = await stubGridley({
      [boardPath('2023-07-17')]: { status: 200, body: fixture(BOARD_1) },
      [boardPath('2023-07-18')]: { status: 404 },
      [boardPath('2023-07-19')]: { status: 404 },
    });
    const { root: dir } = snapshotRoot();
    const result = await acquire(['--from', '2023-07-17', '--to', '2023-07-19',
      '--base-url', stub.baseUrl, '--snapshot-root', dir, '--delay', '0',
      '--max-requests', '1']);

    expect(result.status, result.stderr).toBe(0);
    expect(outcomes(result.stdout).saved).toBe(1);
    expect(result.stdout).toContain('NOT attempted      : 2 date(s)');
    expect(result.stdout).toContain('next: 2023-07-18');
    expect(stub.hits.filter((p) => p !== '/robots.txt')).toEqual([boardPath('2023-07-17')]);
  });

  itPy('makes no request at all in --dry-run', async () => {
    const stub = await stubGridley({
      [boardPath(BOARD_1_DATE)]: { status: 200, body: fixture(BOARD_1) },
    });
    const { root: dir, snapshot } = snapshotRoot();
    const result = await acquire(['--all', '--to', '2023-07-20', '--base-url', stub.baseUrl,
      '--snapshot-root', dir, '--dry-run']);

    expect(result.status, result.stderr).toBe(0);
    expect(stub.hits).toEqual([]);          // not even robots.txt
    expect(existsSync(snapshot)).toBe(false);
    expect(result.stdout).toContain('no request was made and nothing was written');
  });

  itPy('refuses a date before Gridley board #1', async () => {
    const { root: dir } = snapshotRoot();
    const result = await acquire(['--date', '2023-07-16', '--snapshot-root', dir]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('before Gridley board #1');
  });

  itPy('refuses to run with no date selection at all', async () => {
    const { root: dir } = snapshotRoot();
    const result = await acquire(['--snapshot-root', dir]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('choose what to acquire');
  });

  it('never contacts a database, in any mode', () => {
    expect(acquirerCode).not.toMatch(/psycopg|connect_pg|import_batch|external_grids/);
  });

  it('follows redirects on the source host only', () => {
    expect(acquirerCode).toContain('cross-host redirect');
    expect(acquirerCode).toMatch(/class _SameHostRedirect/);
  });

  it('retries only what a retry can fix', () => {
    const retryable = /_retryable[\s\S]*?return isinstance\(exc, \(urllib\.error\.URLError, TimeoutError, OSError\)\)/;
    expect(acquirerCode).toMatch(retryable);
    expect(acquirerCode).toMatch(/exc\.code == 429 or 500 <= exc\.code <= 599/);
  });

  it('cannot overwrite a capture', () => {
    // "xb", not "wb": the filesystem refuses, so no later edit can weaken it.
    expect(acquirerCode).toContain('open(path, "xb")');
    expect(acquirerCode).not.toMatch(/open\([^)]*"wb"\)/);
    expect(acquirerCode).not.toMatch(/\bos\.remove\b|\bshutil\.rmtree\b|\bunlink\b/);
  });
});

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * Acquire board #1 twice, with upstream content changing in between.
 *
 * The snapshot then holds what a snapshot looks like after any real revision:
 * the superseded capture AND the current one, both kept forever.
 */
async function snapshotWithRevision(): Promise<{ snapshot: string; original: Buffer }> {
  const original = fixture(BOARD_1);
  const stub = await stubGridley({ [boardPath(BOARD_1_DATE)]: { status: 200, body: original } });
  const { root: dir, snapshot } = snapshotRoot();
  const args = ['--date', BOARD_1_DATE, '--base-url', stub.baseUrl,
    '--snapshot-root', dir, '--delay', '0'];
  expect((await acquire(args)).status).toBe(0);

  const changed = JSON.parse(original.toString('utf8'));
  changed.completed = changed.completed + 1;
  stub.setRoutes({
    [boardPath(BOARD_1_DATE)]: { status: 200, body: JSON.stringify(changed, null, 4) },
  });
  const revised = await acquire([...args, '--refresh']);
  expect(revised.status, revised.stderr).toBe(0);
  expect(rawFiles(snapshot)).toHaveLength(2);
  return { snapshot, original };
}

/** Acquire both fixtures into a fresh snapshot and return its path. */
async function snapshotWithBothBoards(): Promise<string> {
  const stub = await stubGridley({
    [boardPath(BOARD_1_DATE)]: { status: 200, body: fixture(BOARD_1) },
    [boardPath(BOARD_1139_DATE)]: { status: 200, body: fixture(BOARD_1139) },
  });
  const { root: dir, snapshot } = snapshotRoot();
  const result = await acquire(['--date', BOARD_1_DATE, '--date', BOARD_1139_DATE,
    '--base-url', stub.baseUrl, '--snapshot-root', dir, '--delay', '0']);
  expect(result.status, result.stderr).toBe(0);
  return snapshot;
}

/**
 * Run a Python program that imports the tool and prints JSON on stdout.
 * The same pattern `tests/external-grids-import.test.ts` uses for Stage 1.
 */
async function inspect(program: string[], args: string[] = []): Promise<unknown> {
  const source = ['import json, sys', "sys.path.insert(0, 'tools/migration')",
    'import import_gridley_boards as tool', ...program].join('\n');
  const result = await runTool('-c', [source, ...args]);
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

describe('import_gridley_boards.py — parsing the capture', () => {
  itPy('validates a whole snapshot without a database and reports what it holds', async () => {
    const snapshot = await snapshotWithBothBoards();
    const result = await importSnapshot(['--dry-run', '--no-db', '--snapshot', snapshot]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('captures parsed      : 2');
    expect(result.stdout).toContain('captures rejected    : 0');
    expect(result.stdout).toContain('board number range   : #1 - #1139');
    expect(result.stdout).toContain('axis occurrences     : 12');
    expect(result.stdout).toContain('axes with description : 12');
    expect(result.stdout).toContain('captures with answer key: 2 of 2');
    expect(result.stdout).toContain('answer-key cells        : 18');
    expect(result.stdout).toContain('No database was contacted');
  });

  itPy('preserves the criterion id, the title/subtitle split, the description and the type', async () => {
    const snapshot = await snapshotWithBothBoards();
    const axes = await inspect([
      'report = tool.collect_captures(__import__("pathlib").Path(sys.argv[1]), False)',
      'out = {}',
      'for c in report.captures:',
      '    out[str(c.board_number)] = [a.__dict__ for a in c.axes]',
      'print(json.dumps(out))',
    ], [snapshot]) as Record<string, Array<Record<string, unknown>>>;

    const modern = JSON.parse(fixture(BOARD_1139).toString('utf8'));
    const rows = axes['1139'].filter((a) => a.orientation === 'row');
    const cols = axes['1139'].filter((a) => a.orientation === 'col');

    // Rows are the vertical axis, columns the horizontal one, in source order.
    expect(rows.map((a) => a.position)).toEqual([0, 1, 2]);
    expect(cols.map((a) => a.position)).toEqual([0, 1, 2]);
    expect(rows.map((a) => a.criterion_key)).toEqual(modern.vItems.map((i: { id: string }) => i.id));
    expect(cols.map((a) => a.criterion_key)).toEqual(modern.hItems.map((i: { id: string }) => i.id));

    // Every mapped field is the source string verbatim — no strip, no case
    // change, no defaulting of a null into an empty string.
    modern.vItems.forEach((item: Record<string, unknown>, index: number) => {
      expect(rows[index].raw_title).toBe(item.title);
      expect(rows[index].raw_subtitle).toBe(item.subtitle);
      expect(rows[index].raw_description).toBe(item.description);
      expect(rows[index].item_type).toBe(item.type);
    });

    const typedIndex = modern.vItems.findIndex((i: { type: string | null }) => i.type !== null);
    expect(rows[typedIndex].item_type).toBe('player');
    // A null stays null. It must not become the string "None" or "".
    expect(rows.filter((a) => a.item_type !== null)).toHaveLength(1);
  });

  itPy('reproduces the lossy legacy label exactly, because it is the only shared field', async () => {
    const snapshot = await snapshotWithBothBoards();
    const labels = await inspect([
      'report = tool.collect_captures(__import__("pathlib").Path(sys.argv[1]), False)',
      'out = {}',
      'for c in report.captures:',
      '    out[str(c.board_number)] = [[a.orientation, a.position, a.raw_label] for a in c.axes]',
      'print(json.dumps(out))',
    ], [snapshot]) as Record<string, Array<[string, number, string]>>;

    // Board #1 as the rescued SQLite archive holds it (ISSUE-118 §3): the
    // derived label matched the archive byte-for-byte on both overlapping
    // boards, and this pins that agreement in CI.
    expect(labels['1'].filter((a) => a[0] === 'row').map((a) => a[2]))
      .toEqual(['Port Adelaide', 'North Melbourne', 'Melbourne']);
    expect(labels['1'].filter((a) => a[0] === 'col').map((a) => a[2]))
      .toEqual(['Essendon', 'Western Bulldogs', 'CLUB CAPTAIN']);

    // The lossy case: title contained in subtitle, so the title is dropped.
    const modern = JSON.parse(fixture(BOARD_1139).toString('utf8'));
    const typed = modern.vItems.find((i: { type: string | null }) => i.type !== null);
    const typedLabel = labels['1139'].find((a) => a[2] === typed.subtitle);
    expect(typedLabel).toBeDefined();
    expect(typed.subtitle).toContain(typed.title);
  });

  itPy('keeps the answer key and everything else the columns do not model', async () => {
    const snapshot = await snapshotWithBothBoards();
    const envelopes = await inspect([
      'report = tool.collect_captures(__import__("pathlib").Path(sys.argv[1]), False)',
      'print(json.dumps({str(c.board_number): c.raw_payload for c in report.captures}))',
    ], [snapshot]) as Record<string, Record<string, unknown>>;

    const original = JSON.parse(fixture(BOARD_1139).toString('utf8'));
    const envelope = envelopes['1139'];
    expect(envelope.source).toBe('gridley_api');
    expect(envelope.board_date).toBe(BOARD_1139_DATE);
    expect(envelope.body_sha256).toBe(sha256(fixture(BOARD_1139)));

    // The payload is the response, unaltered and complete — answer key,
    // guess counts, score map, emoji, theme and image URLs included.
    expect(envelope.payload).toEqual(original);

    // fetched_at is deliberately NOT in the hashed envelope: it belongs in its
    // own column, or a re-fetch of an unchanged board would look like a change.
    expect(JSON.stringify(envelope)).not.toContain('fetched_at');
  });

  itPy('hashes the envelope by a recipe another language can reproduce', async () => {
    const snapshot = await snapshotWithBothBoards();
    const captures = await inspect([
      'report = tool.collect_captures(__import__("pathlib").Path(sys.argv[1]), False)',
      'print(json.dumps([{"payload_sha256": c.payload_sha256, "envelope": c.raw_payload}',
      '                  for c in report.captures]))',
    ], [snapshot]) as Array<{ payload_sha256: string; envelope: unknown }>;

    // Sorted keys, no insignificant whitespace. The fixtures are ASCII, so
    // JSON.stringify reproduces Python's canonical form exactly. A stored hash
    // that only its own writer can recompute is not a checkable hash.
    const canonical = (value: unknown): string => {
      if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
      if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
      }
      return JSON.stringify(value) ?? 'null';
    };

    expect(captures).toHaveLength(2);
    for (const capture of captures) {
      const recomputed = createHash('sha256')
        .update(canonical(capture.envelope), 'utf8').digest('hex');
      expect(recomputed).toBe(capture.payload_sha256);
    }
  });
});

describe('import_gridley_boards.py — the snapshot is not trusted', () => {
  itPy('refuses a capture whose bytes no longer match its name', async () => {
    const snapshot = await snapshotWithBothBoards();
    const victim = rawFiles(snapshot)[0];
    const tampered = JSON.parse(readFileSync(join(snapshot, 'raw', victim), 'utf8'));
    tampered.completed = 999_999;
    writeFileSync(join(snapshot, 'raw', victim), JSON.stringify(tampered), 'utf8');

    const result = await importSnapshot(['--dry-run', '--no-db', '--snapshot', snapshot]);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/capture_name_mismatch|http_record_mismatch/);
    expect(result.stderr).toContain('the snapshot did not validate');
  });

  itPy('refuses a capture with no request record rather than inventing a fetch time', async () => {
    const snapshot = await snapshotWithBothBoards();
    const victim = rawFiles(snapshot)[0];
    rmSync(join(snapshot, 'http', victim));

    const result = await importSnapshot(['--dry-run', '--no-db', '--snapshot', snapshot]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('http_record_missing');
    expect(result.stderr).toContain('Nothing was written');
  });

  itPy('refuses a request record with no fetched_at', async () => {
    const snapshot = await snapshotWithBothBoards();
    const victim = rawFiles(snapshot)[0];
    const recordPath = join(snapshot, 'http', victim);
    const record = JSON.parse(readFileSync(recordPath, 'utf8'));
    delete record.fetched_at;
    writeFileSync(recordPath, JSON.stringify(record), 'utf8');

    const result = await importSnapshot(['--dry-run', '--no-db', '--snapshot', snapshot]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('fetched_at_missing');
  });

  itPy('fails on an empty or absent snapshot instead of reporting success', async () => {
    const { root: dir } = snapshotRoot();
    const missing = await importSnapshot(['--dry-run', '--no-db', '--snapshot', join(dir, 'nothing')]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('does not exist');
  });

  itPy('will not write with --limit, and will not use --no-db outside a dry run', async () => {
    const noDb = await importSnapshot(['--no-db']);
    expect(noDb.status).toBe(2);
    expect(noDb.stderr).toContain('--no-db is a dry-run mode');

    const limited = await importSnapshot(['--limit', '5']);
    expect(limited.status).toBe(2);
    expect(limited.stderr).toContain('--limit is a dry-run diagnostic');
  });
});

describe('import_gridley_boards.py — revisions, idempotency and provenance', () => {
  itPy('is a complete no-op on a re-run, and reports a revert instead of guessing', async () => {
    // A snapshot that has seen a revision, which is the case a re-run must
    // handle: it permanently holds a superseded capture as well as the
    // current one, and neither may be re-imported.
    const { snapshot } = await snapshotWithRevision();
    const result = await inspect([
      'from pathlib import Path',
      'report = tool.collect_captures(Path(sys.argv[1]), False)',
      'first = tool.classify(report.captures, {}, {}, {}, {})',
      'current, chain, maxrev, bydate = {}, {}, {}, {}',
      'next_id = 100',
      'for d in first.to_write():',
      '    n = d.capture.board_number',
      '    current[n] = (d.capture.payload_sha256, next_id)',
      '    chain.setdefault(n, set()).add(d.capture.payload_sha256)',
      '    maxrev[n] = d.revision',
      '    bydate[d.capture.board_date.isoformat()] = n',
      '    next_id += 1',
      'second = tool.classify(report.captures, current, chain, maxrev, bydate)',
      'reverted = list(report.captures) + [tool.BoardCapture(',
      '    **{**report.captures[0].__dict__, "fetched_at": "2027-01-01T00:00:00Z"})]',
      'assert reverted[-1].payload_sha256 != current[reverted[-1].board_number][0]',
      'third = tool.classify(reverted, current, chain, maxrev, bydate)',
      'summary = lambda o: {a: o.count(a) for a in',
      '                     (tool.INSERTED, tool.REVISED, tool.UNCHANGED)}',
      'print(json.dumps({"first": summary(first), "first_conflicts": len(first.conflicts),',
      '                  "second": summary(second), "second_conflicts": len(second.conflicts),',
      '                  "third_conflicts": [d.detail for d in third.conflicts]}))',
    ], [snapshot]) as {
      first: Record<string, number>; first_conflicts: number;
      second: Record<string, number>; second_conflicts: number;
      third_conflicts: string[];
    };

    // Two captures of one board: the first import inserts revision 1 and then
    // supersedes it with revision 2.
    expect(result.first).toEqual({ inserted: 1, revised: 1, unchanged: 0 });
    expect(result.first_conflicts).toBe(0);

    // The requirement: re-running a completed backfill creates nothing. The
    // superseded capture is still on disk and must NOT become revision 3.
    expect(result.second).toEqual({ inserted: 0, revised: 0, unchanged: 2 });
    expect(result.second_conflicts).toBe(0);

    // A revert is refused and named, not silently renumbered.
    expect(result.third_conflicts).toHaveLength(1);
    expect(result.third_conflicts[0]).toContain('appears to have reverted');
  });

  itPy('makes a changed capture a new revision and chains it inside one run', async () => {
    const { snapshot } = await snapshotWithRevision();
    const decisions = await inspect([
      'from pathlib import Path',
      'report = tool.collect_captures(Path(sys.argv[1]), False)',
      'out = tool.classify(report.captures, {}, {}, {}, {})',
      'print(json.dumps([[d.action, d.revision, d.supersedes_id] for d in out.decisions]))',
    ], [snapshot]) as Array<[string, number, number | null]>;

    // Oldest capture first, then the revision. The second decision supersedes
    // a row this run has not written yet, so its id is resolved at write time.
    expect(decisions).toEqual([['inserted', 1, null], ['revised', 2, null]]);
  });

  it('never reads, updates or supersedes the rescued archive provenance', () => {
    expect(importerSource).toContain('PROVENANCE = "gridley_api"');
    // Every statement that touches the corpus is scoped to one provenance, and
    // the archive's is named only in prose.
    const corpus = sql.filter((statement) => statement.includes('external_grids'));
    expect(corpus.length).toBeGreaterThan(0);
    for (const statement of corpus) {
      expect(statement).not.toContain('legacy_sqlite');
      if (statement.startsWith('SELECT')) expect(statement).toContain('provenance = %s');
      if (statement.startsWith('INSERT')) expect(statement).toContain('provenance');
    }
    // The UPDATE is addressed by primary key, which is a row this run resolved
    // from a provenance-scoped SELECT.
    expect(sql).toContain('UPDATE external_grids SET is_current = false WHERE id = %s');
  });

  it('updates is_current and nothing else, and never deletes', () => {
    const updates = sql.filter((statement) => statement.startsWith('UPDATE'));
    expect(updates).toEqual(['UPDATE external_grids SET is_current = false WHERE id = %s']);
    for (const statement of sql) {
      expect(statement).not.toMatch(/^(DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/);
    }
    // The insert names its columns; nothing is written positionally.
    expect(sql.some((statement) => statement.startsWith(
      'INSERT INTO external_grids (source_id, provenance, board_number, board_date, '
      + 'revision, is_current, payload_sha256, raw_payload, fetched_at, import_batch_id)',
    ))).toBe(true);
    expect(sql.some((statement) => statement.startsWith(
      'INSERT INTO external_grid_axes (grid_id, orientation, position, criterion_key, '
      + 'raw_title, raw_subtitle, raw_description, raw_label, item_type)',
    ))).toBe(true);
  });

  it('demotes the previous revision before inserting the new one', () => {
    // Order is a correctness requirement: the partial unique index admits one
    // current revision per board per provenance.
    const body = /def write_decision[\s\S]*?return grid_id/.exec(importerSource)?.[0] ?? '';
    expect(body).toBeTruthy();
    expect(body).toContain('UPDATE external_grids');
    expect(body.indexOf('UPDATE external_grids'))
      .toBeLessThan(body.indexOf('INSERT INTO external_grids'));
  });

  it('records a revision as a data issue rather than only a log line', () => {
    expect(sql.some((statement) => statement.startsWith('INSERT INTO data_issues'))).toBe(true);
    expect(importerSource).toContain('external_grid_revision');
  });

  it('creates no Stage 3 or Stage 6 surface', () => {
    for (const source of [acquirerCode, strip(importerSource)]) {
      expect(source).not.toMatch(/external_grid_answers|external_grid_criterion_map/);
      expect(source).not.toMatch(/builder_key|GRID_BUILDERS|played_for_club|teammate_of/);
    }
    for (const statement of sql) {
      expect(statement).not.toMatch(/external_grid_answers|external_grid_criterion_map/);
    }
  });

  it('cannot write in --dry-run', () => {
    const branch = /if args\.dry_run:[\s\S]*?return 0/.exec(importerSource)?.[0] ?? '';
    expect(branch).toBeTruthy();
    expect(branch).toContain('conn.rollback()');
    expect(branch).not.toContain('import_batch(');
    expect(branch).not.toContain('write_decision(');
  });

  it('shares Stage 1 hash and source resolution rather than restating them', () => {
    // One canonicalisation and one hash recipe across both provenances: a
    // second implementation is a second answer waiting to disagree.
    expect(importerSource).toMatch(/from import_external_grids import \([\s\S]*?canonical_json[\s\S]*?payload_hash[\s\S]*?\)/);
    expect(importerSource).not.toMatch(/def canonical_json|def payload_hash/);
  });
});
