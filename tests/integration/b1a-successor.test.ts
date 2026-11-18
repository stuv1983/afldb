// tests | AFLDB-ISSUE-366 B1a successor: interrupted commit, pre-write baseline drift and same-count reversal drift on real PostgreSQL
import './guard';

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { md5Hex, sha256Hex } from '../../tools/v2/b1a-successor/lib';

/**
 * Every case builds a DISPOSABLE SCHEMA in the test database: the seven tables the repair locks, created LIKE their public
 * definitions (types, defaults, CHECKs, keys; no foreign keys), seeded with a synthetic 2026 of exactly 669 player rows, and
 * dropped afterwards. The tools under test are the real CLIs, run as child processes against a DSN whose search_path puts the
 * schema first, so every real public row is untouched. Each tool prints `schema|<name>` in its capture, and the runner and
 * reversal refuse a session whose current_schema differs from the baseline's, so a tool that reached `public` cannot pass.
 *
 * A STATEMENT-level AFTER UPDATE trigger on the sandbox player_season_stats is the controlled pause: for a session named
 * `afldb-b1a <attempt>` it counts the attempt in a sequence (sequences survive rollback) and then waits while the gate row
 * says `hold`, so the runner sits after its UPDATE and before its COMMIT with its locks held; `abort` makes it fail.
 */
const OWNER = process.env.AFLDB_TEST_DATABASE_URL!;
const IMPORT = process.env.AFLDB_TEST_IMPORT_DATABASE_URL ?? OWNER;
const linux = process.platform === 'linux' && spawnSync('pgrep', ['-V']).status === 0;
const REPO = process.cwd();
const T = 'tools/v2/b1a-successor';
const STAMP = '20261201T010203Z';
const ATT = `${STAMP}-commit-1`;
const DRY = `${STAMP}-dry-1`;
const N = 669;
const FIRST = 900001;

const owner = postgres(OWNER, { max: 2, onnotice: () => {} });
let ident: { db: string; oid: string; sysid: string };
let work: string;
const ids = Array.from({ length: N }, (_v, i) => FIRST + i);
const IDS_MD5 = md5Hex(ids.join(','));

interface Box { schema: string; dsn: string; dir: string; baseline: string; sha: string }

function dsnFor(url: string, schema: string) {
  const u = new URL(url);
  u.searchParams.set('options', `-c search_path=${schema},public`);
  return u.toString();
}

function tool(file: string, args: string[], dsn: string) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', `${T}/${file}`, ...args], {
    cwd: REPO, encoding: 'utf8', env: { ...process.env, B1A_TEST_DSN: dsn }, timeout: 120_000,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const idArgs = () => ['--dsn-env', 'B1A_TEST_DSN', '--expect-db', ident.db, '--expect-oid', ident.oid, '--expect-sysid', ident.sysid];
const runnerArgs = (b: Box, attempt: string) => [...idArgs(), '--expect-ids-md5', IDS_MD5, '--attempt', attempt, '--baseline', b.baseline, '--baseline-sha256', b.sha];
const recover = (b: Box, dsn = b.dsn, extra: string[] = []) => tool('recover.mts', [...idArgs(), '--expect-ids-md5', IDS_MD5,
  '--recover-attempt', ATT, '--record-dir', b.dir, '--baseline', b.baseline, '--baseline-sha256', b.sha, ...extra], dsn);
const accept = (b: Box, expectState: 'original' | 'repaired') => tool('capture.mts', [...idArgs(), '--sitting', STAMP, '--compare', b.baseline,
  '--baseline-sha256', b.sha, '--expect', expectState], b.dsn);
const reverse = (b: Box, extra: string[]) => tool('reverse.mts', [...idArgs(), '--expect-ids-md5', IDS_MD5, '--sitting', STAMP,
  '--baseline', b.baseline, '--baseline-sha256', b.sha, ...extra], b.dsn);

async function makeBox(): Promise<Box> {
  const schema = `b1a366_${Math.random().toString(36).slice(2, 10)}`;
  const s = owner;
  await s.unsafe(`CREATE SCHEMA ${schema}`);
  for (const t of ['seasons', 'stat_availability', 'brownlow_season_votes', 'brownlow_season_authority', 'brownlow_vote_entry_state',
    'brownlow_round_votes', 'player_season_stats']) {
    await s.unsafe(`CREATE TABLE ${schema}.${t} (LIKE public.${t} INCLUDING ALL)`);
  }
  await s.unsafe(`
    INSERT INTO ${schema}.seasons (year, league, status) VALUES (2025, 'AFL', 'complete'), (2026, 'AFL', 'complete');
    INSERT INTO ${schema}.stat_availability (stat_key, season, is_recorded, coverage, populated_rows, total_rows) VALUES
      ('brownlow_match_votes', 2026, false, 'pending', NULL, NULL), ('brownlow_round_votes', 2026, false, 'pending', NULL, NULL),
      ('brownlow_season_total', 2026, false, 'pending', NULL, NULL), ('brownlow_season_total', 2025, true, 'complete', 40, 40),
      ('goals', 2025, true, 'complete', 40, 40);
    INSERT INTO ${schema}.player_season_stats (player_id, season, games, brownlow_status, brownlow_votes)
      SELECT g, 2026, 1 + g % 22, 'not_applicable', NULL FROM generate_series(${FIRST}, ${FIRST + N - 1}) g;
    INSERT INTO ${schema}.player_season_stats (player_id, season, games, brownlow_status, brownlow_votes)
      SELECT g, 2025, 10, 'complete', g % 4 FROM generate_series(${FIRST}, ${FIRST + 39}) g;
    INSERT INTO ${schema}.brownlow_round_votes (season, player_id, round_number, played, votes)
      SELECT 2026, ${FIRST} + (r % 30), r, true, CASE WHEN r % 3 = 0 THEN NULL ELSE 1 + r % 3 END FROM generate_series(1, 24) r;
    INSERT INTO ${schema}.brownlow_vote_entry_state (match_id, season, status, three_player_id, two_player_id, one_player_id, created_by, updated_by,
                                                    finalised_by, finalised_at, finalised_revision)
      VALUES (1, 2026, 'final', ${FIRST}, ${FIRST + 1}, ${FIRST + 2}, 1, 1, 1, '2026-09-01T00:00:00Z', 1),
             (2, 2026, 'final', ${FIRST + 3}, ${FIRST + 4}, ${FIRST + 5}, 1, 1, 1, '2026-09-01T00:00:00Z', 1),
             (3, 2026, 'draft', ${FIRST + 6}, NULL, NULL, 1, 1, NULL, NULL, NULL);
    INSERT INTO ${schema}.brownlow_season_authority (season, updated_by) VALUES (2026, 1);
    CREATE TABLE ${schema}.b1a_test_gate (v text NOT NULL);
    INSERT INTO ${schema}.b1a_test_gate VALUES ('pass');
    CREATE SEQUENCE ${schema}.b1a_test_update_attempts;
    CREATE FUNCTION ${schema}.b1a_test_pause() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ${schema}, public AS $$
    DECLARE g text;
    BEGIN
      IF current_setting('application_name') LIKE 'afldb-b1a %' THEN
        PERFORM nextval('${schema}.b1a_test_update_attempts');
        LOOP
          SELECT v INTO g FROM ${schema}.b1a_test_gate;
          EXIT WHEN g <> 'hold';
          PERFORM pg_sleep(0.05);
        END LOOP;
        IF g = 'abort' THEN RAISE EXCEPTION 'b1a test gate: abort'; END IF;
      END IF;
      RETURN NULL;
    END $$;
    CREATE TRIGGER b1a_test_pause AFTER UPDATE ON ${schema}.player_season_stats FOR EACH STATEMENT EXECUTE FUNCTION ${schema}.b1a_test_pause();`);
  const importUser = decodeURIComponent(new URL(IMPORT).username);
  const ownerUser = decodeURIComponent(new URL(OWNER).username);
  if (importUser !== ownerUser) {
    await s.unsafe(`GRANT USAGE ON SCHEMA ${schema} TO ${importUser};
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${importUser};`);
  }
  const dir = mkdtempSync(join(work, `${schema}-`));
  const box: Box = { schema, dsn: dsnFor(IMPORT, schema), dir, baseline: join(dir, 'baseline-v2.txt'), sha: '' };
  const cap = tool('capture.mts', [...idArgs(), '--sitting', STAMP, '--out', box.baseline, '--verify-before', '--expect-ids-md5', IDS_MD5], box.dsn);
  expect(cap.out).toContain('BEFORE-CHECK PASS');
  expect(cap.code, cap.out).toBe(0);
  box.sha = sha256Hex(readFileSync(box.baseline));
  expect(readFileSync(box.baseline, 'utf8')).toContain(`schema|${schema}\n`);
  return box;
}
const dropBox = (b: Box) => owner.unsafe(`DROP SCHEMA IF EXISTS ${b.schema} CASCADE`);

const q1 = async <R>(text: string) => (await owner.unsafe(text))[0] as R;
const attempts = async (b: Box) => Number((await q1<{ n: string }>(`SELECT CASE WHEN is_called THEN last_value ELSE 0 END AS n FROM ${b.schema}.b1a_test_update_attempts`)).n);
const status2026 = async (b: Box) => (await owner.unsafe(`SELECT brownlow_status::text AS s, count(*)::int AS n FROM ${b.schema}.player_season_stats
  WHERE season = 2026 GROUP BY 1 ORDER BY 1`)).map((r) => `${r.s}:${r.n}`).join(',');
const xmin2026 = async (b: Box) => (await q1<{ h: string }>(`SELECT md5(string_agg(xmin::text, ',' ORDER BY player_id)) AS h
  FROM ${b.schema}.player_season_stats WHERE season = 2026`)).h;
const gate = (b: Box, v: 'pass' | 'hold' | 'abort') => owner.unsafe(`UPDATE ${b.schema}.b1a_test_gate SET v = '${v}'`);
const appBackends = async (attempt: string) => Number((await owner`SELECT count(*)::int AS n FROM pg_stat_activity
  WHERE application_name = ${`afldb-b1a ${attempt}`}`)[0].n);
async function until(what: string, f: () => Promise<boolean>, ms = 60_000) {
  const t0 = Date.now();
  while (!(await f())) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 100)); }
}

/** The P6 block's record, as written by a block whose caller was lost: ATTEMPT-START and RUNNER-PID, no RUNNER-EXIT. */
function blockRecord(b: Box, wrapper: { pid: number; start: string }, runnerPid?: number) {
  writeFileSync(join(b.dir, 'p6-attempt.txt'), `ATTEMPT-START ${ATT} wrapper_pid=${wrapper.pid} wrapper_start=${wrapper.start} 2026-12-01T01:02:03Z\n`
    + (runnerPid ? `RUNNER-PID ${runnerPid}\n` : ''));
}
const procStart = (pid: number) => { const s = readFileSync(`/proc/${pid}/stat`, 'utf8'); return s.slice(s.lastIndexOf(')') + 2).split(' ')[19]; };
/** A pid that has exited (the lost caller's block). */
const deadWrapper = () => ({ pid: Number(spawnSync('sh', ['-c', 'echo $$'], { encoding: 'utf8' }).stdout.trim()), start: '1' });

/** Starts the commit runner exactly as p6-commit.sh does: stdout and stderr straight into the record's commit.txt. */
function startRunner(b: Box): ChildProcess {
  const fd = openSync(join(b.dir, 'commit.txt'), 'w');
  const child = spawn(process.execPath, ['--import', 'tsx', `${T}/repair.mts`, ...runnerArgs(b, ATT), '--commit'],
    { cwd: REPO, env: { ...process.env, B1A_TEST_DSN: b.dsn }, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  return child;
}
const exited = (c: ChildProcess) => new Promise<number | null>((res) => { if (c.exitCode !== null || c.signalCode) res(c.exitCode); else c.on('exit', (code) => res(code)); });

beforeAll(async () => {
  const [r] = await owner`SELECT current_database() AS db, d.oid::text AS oid, c.system_identifier::text AS sysid
    FROM pg_database d CROSS JOIN pg_control_system() c WHERE d.datname = current_database()`;
  ident = { db: r.db, oid: r.oid, sysid: r.sysid };
  work = mkdtempSync(join(tmpdir(), 'afldb-b1a366-'));
});
afterAll(async () => {
  await owner`SELECT 1`;
  const left = await owner`SELECT nspname FROM pg_namespace WHERE nspname LIKE 'b1a366\\_%'`;
  for (const { nspname } of left) await owner.unsafe(`DROP SCHEMA IF EXISTS ${nspname} CASCADE`);
  await owner.end({ timeout: 5 });
  if (work) rmSync(work, { recursive: true, force: true });
});

describe.runIf(linux)('ISSUE-366 §1 — interrupted commit recovery withholds S3 until the attempt is terminal', () => {
  it('COMMIT: a paused writer is live while an ordinary reader sees the original rows; recovery STOPs, then reports COMMITTED', async () => {
    const b = await makeBox();
    try {
      blockRecord(b, deadWrapper());
      await gate(b, 'hold');
      const runner = startRunner(b);
      await until('the runner to reach its UPDATE', async () => (await attempts(b)) === 1);
      // The visibility race: the update is done but uncommitted, so any other session's fresh snapshot shows the original.
      expect(await status2026(b)).toBe(`not_applicable:${N}`);
      expect((await accept(b, 'original')).out).toContain('ACCEPTANCE original EXACT');
      const live = recover(b);
      expect(live.out).toMatch(/R1 DECISION STOP: attempt .* is not terminal/);
      expect(live.out).not.toMatch(/^PROBE/m); // no snapshot is even taken while the attempt is live
      expect(live.code).toBe(3);
      await gate(b, 'pass');
      expect(await exited(runner)).toBe(0);
      expect(readFileSync(join(b.dir, 'commit.txt'), 'utf8')).toMatch(/^OUTCOME COMMITTED$/m);
      const done = recover(b);
      expect(done.out).toContain('R1 DECISION COMMITTED: OUTCOME COMMITTED and the exact repaired state');
      expect(done.code).toBe(0);
      expect(await attempts(b)).toBe(1);
      expect(await status2026(b)).toBe(`pending:${N}`);
    } finally { await dropBox(b); }
  }, 180_000);

  it('ROLLBACK: the same pause ending in an error is NOT-COMMITTED only after it is terminal', async () => {
    const b = await makeBox();
    try {
      blockRecord(b, deadWrapper());
      await gate(b, 'hold');
      const runner = startRunner(b);
      await until('the runner to reach its UPDATE', async () => (await attempts(b)) === 1);
      const live = recover(b);
      expect(live.out).toMatch(/R1 DECISION STOP: attempt .* is not terminal/);
      expect(live.code).toBe(3);
      await gate(b, 'abort');
      expect(await exited(runner)).toBe(2);
      expect(readFileSync(join(b.dir, 'commit.txt'), 'utf8')).toMatch(/^OUTCOME ERROR .*b1a test gate: abort/m);
      const done = recover(b);
      expect(done.out).toContain('R1 DECISION NOT-COMMITTED: OUTCOME ERROR, terminal, and the pinned original state');
      expect(done.code).toBe(10);
      expect(await attempts(b)).toBe(1);
      expect(await status2026(b)).toBe(`not_applicable:${N}`);
    } finally { await dropBox(b); }
  }, 180_000);

  it('a killed runner whose transaction is still open: the process listing is empty but recovery still STOPs', async () => {
    const b = await makeBox();
    try {
      blockRecord(b, deadWrapper());
      await gate(b, 'hold');
      const runner = startRunner(b);
      await until('the runner to reach its UPDATE', async () => (await attempts(b)) === 1);
      runner.kill('SIGKILL');
      await exited(runner);
      expect(spawnSync('pgrep', ['-f', '--', `(^| )--attempt ${ATT}( |$)`]).status).toBe(1);
      expect(await appBackends(ATT)).toBe(1); // the backend is still inside the paused UPDATE, holding the locks
      const live = recover(b);
      expect(live.out).toMatch(/R1 DECISION STOP: attempt .* still has 1 database backend/);
      expect(live.code).toBe(3);
      await gate(b, 'pass');
      await until('the orphaned backend to end', async () => (await appBackends(ATT)) === 0);
      const done = recover(b);
      expect(done.out).toContain('R1 DECISION NOT-COMMITTED: no OUTCOME line (runner exit unrecorded); terminal; the pinned original state');
      expect(done.code).toBe(10);
      expect(await attempts(b)).toBe(1);
    } finally { await dropBox(b); }
  }, 180_000);

  it('unconfirmed live attempts STOP: the block still running before launch, and a launched runner not yet connected', async () => {
    const b = await makeBox();
    const sleeper = spawn('sleep', ['60']);
    let notYet: ChildProcess | null = null;
    try {
      // The block is still alive and has not launched anything: no runner process, no backend, no OUTCOME, original rows.
      blockRecord(b, { pid: sleeper.pid!, start: procStart(sleeper.pid!) });
      const r1 = recover(b);
      expect(r1.out).toMatch(/R1 DECISION STOP: .*P6 block \(pid \d+\) is still running/);
      expect(r1.code).toBe(3);
      // A runner that is launched (its argv carries the attempt) but has not connected yet.
      notYet = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', '--', '--attempt', ATT]);
      await until('the launched process to appear', async () => spawnSync('pgrep', ['-f', '--', `(^| )--attempt ${ATT}( |$)`]).status === 0);
      blockRecord(b, deadWrapper());
      const r2 = recover(b);
      expect(r2.out).toMatch(/R1 DECISION STOP: attempt .* is not terminal .*carry --attempt/);
      expect(r2.code).toBe(3);
      notYet.kill('SIGKILL'); await exited(notYet);
      // Both gone: an attempt that never reached the database, with the original rows, did not commit.
      const r3 = recover(b);
      expect(r3.out).toContain('R1 DECISION NOT-COMMITTED: no OUTCOME line (runner exit unrecorded); terminal; the pinned original state');
      expect(r3.code).toBe(10);
      expect(await attempts(b)).toBe(0);
    } finally { sleeper.kill('SIGKILL'); notYet?.kill('SIGKILL'); await dropBox(b); }
  }, 180_000);

  it('a failed probe, a wrong identity and a historical capture each STOP', async () => {
    const b = await makeBox();
    try {
      blockRecord(b, deadWrapper());
      const unreachable = new URL(b.dsn); unreachable.port = '1';
      const down = recover(b, unreachable.toString());
      expect(down.out).toMatch(/R1 DECISION STOP: database liveness check before the snapshot failed/);
      expect(down.code).toBe(3);
      const wrongOid = tool('recover.mts', ['--dsn-env', 'B1A_TEST_DSN', '--expect-db', ident.db, '--expect-oid', '1', '--expect-sysid', ident.sysid,
        '--expect-ids-md5', IDS_MD5, '--recover-attempt', ATT, '--record-dir', b.dir, '--baseline', b.baseline, '--baseline-sha256', b.sha], b.dsn);
      expect(wrongOid.out).toMatch(/R1 DECISION STOP: baseline evidence: .*identity/);
      expect(wrongOid.code).toBe(3);
      const old = join(b.dir, 'historical.txt');
      writeFileSync(old, readFileSync(b.baseline, 'utf8').split('\n').filter((l) => !/^(format|sitting|schema|fp_(season|medal|authority|entry|round)2026)\|/.test(l)).join('\n'));
      const hist = tool('recover.mts', [...idArgs(), '--expect-ids-md5', IDS_MD5, '--recover-attempt', ATT, '--record-dir', b.dir,
        '--baseline', old, '--baseline-sha256', sha256Hex(readFileSync(old))], b.dsn);
      expect(hist.out).toMatch(/R1 DECISION STOP: baseline evidence: .*packet 6R capture cannot qualify/);
      expect(hist.code).toBe(3);
    } finally { await dropBox(b); }
  }, 180_000);
});

describe.runIf(linux)('ISSUE-366 §2 — P6 is bound to the verified P3 BEFORE capture and refuses drift before any UPDATE', () => {
  const drifts: Array<[string, (s: string) => string, RegExp]> = [
    ['H1 (another season)', (s) => `UPDATE ${s}.player_season_stats SET games = games + 1 WHERE season = 2025 AND player_id = ${FIRST}`, /fp_pss_other\(H1\)/],
    ['H2 (2026, a column other than status)', (s) => `UPDATE ${s}.player_season_stats SET games = games + 1 WHERE season = 2026 AND player_id = ${FIRST + 7}`, /fp_pss2026_nonstatus\(H2\)/],
    ['H3 (any coverage row, count unchanged)', (s) => `UPDATE ${s}.stat_availability SET populated_rows = 39 WHERE season = 2025 AND stat_key = 'goals'`, /fp_stat_availability\(H3\)/],
    ['a captured input (one more 2026 round vote)', (s) => `INSERT INTO ${s}.brownlow_round_votes (season, player_id, round_number, played, votes) VALUES (2026, ${FIRST + 50}, 25, true, 1)`, /inputs2026/],
  ];
  for (const [name, edit, line] of drifts) {
    it(`drift in ${name} after a passing dry run: commit refuses before UPDATE and keeps the edit`, async () => {
      const b = await makeBox();
      try {
        const dry = tool('repair.mts', runnerArgs(b, DRY), b.dsn);
        expect(dry.out).toContain('BASELINE-CHECK PASS');
        expect(dry.out).toMatch(/^OUTCOME DRY-RUN-PASS \(rolled back\)$/m);
        expect(dry.code).toBe(0);
        expect(await attempts(b)).toBe(1);
        await owner.unsafe(edit(b.schema));
        const xmin = await xmin2026(b);
        const committed = tool('repair.mts', [...runnerArgs(b, ATT), '--commit'], b.dsn);
        expect(committed.out).toMatch(/^OUTCOME REFUSED BASELINE DRIFT before any write: /m);
        expect(committed.out.split('\n').find((l) => l.startsWith('OUTCOME'))).toMatch(line);
        expect(committed.out).not.toContain('BASELINE-CHECK PASS');
        expect(committed.code).toBe(1);
        expect(await attempts(b)).toBe(1); // no UPDATE by the commit attempt
        expect(await xmin2026(b)).toBe(xmin); // no 2026 row version changed
        expect(await status2026(b)).toBe(`not_applicable:${N}`);
        const after = await accept(b, 'original');
        expect(after.out).toContain('ACCEPTANCE NOT EXACT'); // the legitimate edit is still there
      } finally { await dropBox(b); }
    }, 180_000);
  }

  it('missing, malformed or mismatched evidence is refused without a connection', async () => {
    const b = await makeBox();
    try {
      const bad = (args: string[]) => tool('repair.mts', args, b.dsn);
      const wrongSha = bad([...runnerArgs(b, ATT).slice(0, -1), 'f'.repeat(64), '--commit']);
      expect(wrongSha.out).toMatch(/^OUTCOME REFUSED baseline evidence: baseline sha256 .* differs/m);
      const cut = join(b.dir, 'cut.txt'); writeFileSync(cut, readFileSync(b.baseline, 'utf8').split('\n').slice(0, 8).join('\n'));
      const truncated = bad([...runnerArgs(b, ATT).slice(0, -3), cut, '--baseline-sha256', sha256Hex(readFileSync(cut)), '--commit']);
      expect(truncated.out).toMatch(/^OUTCOME REFUSED baseline evidence: .*missing/m);
      const otherSitting = bad([...runnerArgs(b, '20261202T000000Z-commit-1'), '--commit']);
      expect(otherSitting.out).toMatch(/baseline is for sitting 20261201T010203Z/);
      const missing = bad(runnerArgs(b, ATT).filter((a, i, all) => a !== '--baseline' && all[i - 1] !== '--baseline').concat('--commit'));
      expect(missing.out).toMatch(/^OUTCOME REFUSED usage/m);
      for (const r of [wrongSha, truncated, otherSitting, missing]) { expect(r.code).toBe(1); expect(r.out).not.toMatch(/^LAUNCH/m); }
      expect(await attempts(b)).toBe(0);
    } finally { await dropBox(b); }
  }, 180_000);

  it('clean control: dry run, then exactly one committing UPDATE and an exact independent acceptance', async () => {
    const b = await makeBox();
    try {
      expect(tool('repair.mts', runnerArgs(b, DRY), b.dsn).code).toBe(0);
      const before = await attempts(b);
      const committed = tool('repair.mts', [...runnerArgs(b, ATT), '--commit'], b.dsn);
      expect(committed.out).toMatch(/^LAUNCH \{"attempt":"20261201T010203Z-commit-1"/m);
      expect(committed.out).toContain('BASELINE-CHECK PASS');
      expect(committed.out).toMatch(/^OUTCOME COMMITTED$/m);
      expect(committed.code).toBe(0);
      expect((await attempts(b)) - before).toBe(1);
      const after = await accept(b, 'repaired');
      expect(after.out).toContain('ACCEPTANCE repaired EXACT');
      expect(after.code).toBe(0);
      const again = tool('repair.mts', [...runnerArgs(b, `${STAMP}-commit-2`), '--commit'], b.dsn);
      expect(again.out).toMatch(/^OUTCOME ALREADY-APPLIED/m);
      expect(again.code).toBe(3);
    } finally { await dropBox(b); }
  }, 180_000);
});

describe.runIf(linux)('ISSUE-366 §3 — the reversal refuses same-count and same-status-total drift', () => {
  async function repairedBox() {
    const b = await makeBox();
    const c = tool('repair.mts', [...runnerArgs(b, ATT), '--commit'], b.dsn);
    expect(c.code, c.out).toBe(0);
    return b;
  }
  const approval = ['--commit', '--approval-ref', 'TEST-366-simulated-owner-approval'];
  const legacyLines = (b: Box) => tool('capture.mts', [...idArgs(), '--sitting', STAMP, '--out', join(b.dir, `now-${Math.random()}.txt`)], b.dsn);
  const legacyOf = (text: string) => text.split('\n').filter((l) => /^(ids2026|inputs2026|fp_pss_other|fp_pss2026_nonstatus|fp_stat_availability|cov2026|pss2026)/.test(l)).join('\n');

  for (const [name, edit, fp] of [
    ['one round vote changed, row count unchanged', (s: string) => `UPDATE ${s}.brownlow_round_votes SET votes = 3 WHERE season = 2026 AND round_number = 1`, 'fp_round2026'],
    ['a decision row edited, status totals unchanged', (s: string) => `UPDATE ${s}.brownlow_vote_entry_state SET three_player_id = two_player_id, two_player_id = three_player_id WHERE match_id = 1`, 'fp_entry2026'],
  ] as const) {
    it(`${name}: dry run and commit both refuse; repaired rows and the edit stay`, async () => {
      const b = await repairedBox();
      try {
        const pre = await xmin2026(b);
        const before = legacyLines(b);
        await owner.unsafe(edit(b.schema));
        const after = legacyLines(b);
        // The packet 6R guard inputs (counts, H1, H2, H3, inputs2026) cannot see this edit.
        const read = (o: string) => readFileSync(/CAPTURE (\S+)/.exec(o)![1], 'utf8');
        expect(legacyOf(read(after.out))).toBe(legacyOf(read(before.out)));
        for (const extra of [[], approval]) {
          const r = reverse(b, extra);
          expect(r.out).toMatch(new RegExp(`^OUTCOME REFUSED the state is not exactly the repaired image .*${fp}`, 'm'));
          expect(r.code).toBe(1);
        }
        expect(await status2026(b)).toBe(`pending:${N}`);
        expect(await xmin2026(b)).toBe(pre);
        expect(read(legacyLines(b).out)).toContain(read(after.out).split('\n').find((l) => l.startsWith(fp))!);
      } finally { await dropBox(b); }
    }, 180_000);
  }

  it('unchanged fixture: the dry run rolls back, commit needs the separate approval, and the commit restores the BEFORE capture exactly', async () => {
    const b = await repairedBox();
    try {
      const dry = reverse(b, []);
      expect(dry.out).toContain('GUARD PASS');
      expect(dry.out).toMatch(/^OUTCOME REVERSE DRY-RUN-PASS \(rolled back\)$/m);
      expect(dry.code).toBe(0);
      expect((await accept(b, 'repaired')).code).toBe(0);
      const unapproved = reverse(b, ['--commit']);
      expect(unapproved.out).toMatch(/^OUTCOME REFUSED --commit needs --approval-ref/m);
      expect(unapproved.code).toBe(1);
      const done = reverse(b, approval);
      expect(done.out).toMatch(/^OUTCOME REVERSE COMMITTED: 669 rows back to not_applicable \(approval TEST-366-simulated-owner-approval\)$/m);
      expect(done.code).toBe(0);
      const exact = await accept(b, 'original');
      expect(exact.out).toContain('ACCEPTANCE original EXACT');
      const old = join(b.dir, 'historical.txt');
      writeFileSync(old, readFileSync(b.baseline, 'utf8').replace(/^fp_round2026\|.*\n/m, ''));
      const hist = tool('reverse.mts', [...idArgs(), '--expect-ids-md5', IDS_MD5, '--sitting', STAMP, '--baseline', old,
        '--baseline-sha256', sha256Hex(readFileSync(old))], b.dsn);
      expect(hist.out).toMatch(/^OUTCOME REFUSED baseline evidence: .*fp_round2026 missing/m);
      expect(hist.code).toBe(1);
    } finally { await dropBox(b); }
  }, 180_000);
});
