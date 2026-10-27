import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { spawn as nodeSpawn, spawnSync, type ChildProcess, type spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * AFL API cutover — the one switch for AFL Tables network fetching,
 * `data/reference/afltables-network.json`, every path that contacts
 * afltables.com, the season rollover that retires it, and the DB-free
 * readiness report.
 *
 * NOTHING HERE CAN REACH THE NETWORK. The application half mocks
 * `node:child_process` so `systemctl` is never spawned. The script half runs
 * the real gate code with the working directory (or project root) set to a
 * fresh temporary tree that holds only a control file and an in-progress
 * register: past the gate there is no contract, no R runtime fragment and no
 * snapshot, so an `active` run stops on the first missing file, long before
 * any fetch. Each script case is skipped when its interpreter is not installed.
 */

const root = path.resolve(__dirname, '..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
import { predecessorJson, predecessorText } from './rollover-predecessor-fixture';

/**
 * Test-process cleanup. A bare PID read from a file or a log line is never a termination handle: once the
 * original process has exited and been reaped the number can belong to an unrelated process, so nothing here
 * ever sends a terminating signal to one. The contract of `teardownRegisteredProcesses`, which both
 * process-owning `afterAll` hooks call unchanged:
 *   1. every registered sandbox's own, unique run token is written to its shutdown file before anything waits;
 *   2. PIDs are recovered at teardown from the run-bound files the fixtures leave (`watchdog.pid`, a
 *      descendant's pid file, a report), not only from what the test body managed to register;
 *   3. one shared deadline (5 s by default) covers every PID together, probed with signal 0 only: `ESRCH` is the
 *      only proof a PID is gone, `EPERM` (or any other error) leaves it unconfirmed;
 *   4. a process the test owns through its exact ChildProcess handle may be ended through that handle once the
 *      deadline has passed, and an already-exited handle is neither probed nor signalled;
 *   5. any PID left makes the hook FAIL, naming the PID, run token and evidence directory; that sandbox's
 *      directory and shutdown file are kept. A sandbox is deleted only after all of its PIDs are confirmed gone.
 */
const pidPresence = (pid: number): 'alive' | 'gone' | 'unconfirmed' => {
  try { process.kill(pid, 0); return 'alive'; } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'gone' : 'unconfirmed';
  }
};
const pidAlive = (pid: number): boolean => pidPresence(pid) !== 'gone';
const waitGone = async (pid: number, waitMs = 5000): Promise<boolean> => {
  for (let waited = 0; waited < waitMs && pidAlive(pid); waited += 50) await new Promise((r) => setTimeout(r, 50));
  return !pidAlive(pid);
};
interface CleanupSandbox {
  /** The temporary root: removed only once every process recorded for this sandbox is confirmed gone. */
  root: string;
  evidence: string;
  /** Unique to this sandbox; a fixture ends itself only on exactly this content in the shutdown file. */
  runToken: string;
  shutdownFile: string;
  /** Run-bound files that hold a PID (`watchdog.pid`, a descendant's pid file), read at teardown. */
  pidFiles: string[];
  /** JSON reports whose `output` may carry `GRANDCHILD <pid>`, read at teardown. */
  reportFiles: string[];
  /** PIDs the test body registered itself. */
  pids: Set<number>;
  /** Processes the test owns through their exact handle. */
  handles: ChildProcess[];
}
/** Registers the sandbox (directory, token, files) before any process can be spawned into it. */
const registerSandbox = (registry: CleanupSandbox[], prefix: string, shutdownName: string): CleanupSandbox => {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  const evidence = path.join(root, 'evidence');
  const sandbox: CleanupSandbox = {
    root,
    evidence,
    runToken: `${prefix}${randomUUID()}`,
    shutdownFile: path.join(evidence, shutdownName),
    pidFiles: [path.join(evidence, 'watchdog.pid')],
    reportFiles: [],
    pids: new Set(),
    handles: [],
  };
  registry.push(sandbox);
  mkdirSync(evidence);
  return sandbox;
};
const readPidFile = (file: string): number | undefined => {
  try {
    const pid = Number(readFileSync(file, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch { return undefined; }
};
const readReportPid = (file: string): number | undefined => {
  try {
    const pid = Number(String(JSON.parse(readFileSync(file, 'utf8')).output ?? '').match(/GRANDCHILD (\d+)/)?.[1]);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch { return undefined; }
};
const handleRunning = (handle: ChildProcess): boolean => handle.exitCode === null && handle.signalCode === null;
const recoverPids = (sandbox: CleanupSandbox): number[] => {
  const found = new Set(sandbox.pids);
  for (const file of sandbox.pidFiles) { const pid = readPidFile(file); if (pid !== undefined) found.add(pid); }
  for (const file of sandbox.reportFiles) { const pid = readReportPid(file); if (pid !== undefined) found.add(pid); }
  // An exited handle's number is already reaped and may belong to someone else: it is never probed.
  for (const handle of sandbox.handles) {
    if (handle.pid === undefined) continue;
    if (handleRunning(handle)) found.add(handle.pid); else found.delete(handle.pid);
  }
  return [...found];
};
const teardownRegisteredProcesses = async (registry: CleanupSandbox[], opts: { waitMs?: number; pollMs?: number; handleWaitMs?: number } = {}): Promise<void> => {
  const { waitMs = 5000, pollMs = 50, handleWaitMs = 2000 } = opts;
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  // 1. Every token first, before any wait. A sandbox that is already gone has nothing left to ask.
  for (const sandbox of registry) {
    try { writeFileSync(sandbox.shutdownFile, sandbox.runToken); } catch { /* confirmed or not below, by PID */ }
  }
  // 2. Recovery happens now, whatever the test body reached.
  const recorded = registry.map((sandbox) => ({ sandbox, pids: recoverPids(sandbox) }));
  const remaining = (): Array<{ sandbox: CleanupSandbox; pid: number; state: 'alive' | 'unconfirmed' }> => recorded.flatMap(({ sandbox, pids }) => pids.flatMap((pid) => {
    const state = pidPresence(pid);
    return state === 'gone' ? [] : [{ sandbox, pid, state }];
  }));
  // 3. One deadline for all of them.
  const deadline = Date.now() + waitMs;
  let pending = remaining();
  while (pending.length > 0 && Date.now() < deadline) {
    await sleep(pollMs);
    pending = remaining();
  }
  // 4. Only an exact, still-running handle is ended by signal, and only through the handle.
  if (pending.length > 0) {
    const stillRunning = registry.flatMap((sandbox) => sandbox.handles.filter(handleRunning));
    if (stillRunning.length > 0) {
      const exits = stillRunning.map((handle) => new Promise<void>((resolve) => { handle.once('exit', () => resolve()); }));
      for (const handle of stillRunning) handle.kill();
      await Promise.race([Promise.all(exits), sleep(handleWaitMs)]);
      pending = remaining();
    }
  }
  // 5. Delete what is confirmed; fail loudly about the rest and keep its evidence.
  const unresolved = new Set(pending.map(({ sandbox }) => sandbox));
  const kept = registry.filter((sandbox) => unresolved.has(sandbox));
  for (const sandbox of registry) {
    if (!unresolved.has(sandbox)) rmSync(sandbox.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
  registry.splice(0, registry.length, ...kept);
  if (pending.length > 0) {
    throw new Error(`test cleanup could not confirm ${pending.length} process(es) gone; evidence and shutdown files kept:\n${pending
      .map(({ sandbox, pid, state }) => `  pid ${pid} (${state}), run token ${sandbox.runToken}, evidence ${sandbox.evidence}`)
      .join('\n')}`);
  }
};

const RETIRED_MARKER = 'AFLDB_AFLTABLES_RETIRED';
const OUT_OF_BOUNDS_MARKER = 'AFLDB_AFLTABLES_OUT_OF_BOUNDS';

/* ------------------------------------------------------------------ *
 * Application: the switch reader and the Super Admin on-demand start
 * ------------------------------------------------------------------ */

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  control: { status: 'active', last_season: 2026 } as unknown,
  seasons: { in_progress_seasons: [2026] } as unknown,
}));

vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFile: mocks.execFile,
}));

vi.mock('../data/reference/afltables-network.json', () => ({
  get default() { return mocks.control; },
}));

vi.mock('../data/reference/seasons.json', () => ({
  get default() { return mocks.seasons; },
}));

import {
  AFLTABLES_NETWORK_OUT_OF_BOUNDS,
  AFLTABLES_NETWORK_RETIRED,
  afltablesNetworkStatus,
  parseAfltablesNetworkStatus,
} from '@/lib/acquisition/afltables-network';
import { startSettleRun } from '@/lib/acquisition/settle-trigger';
import { assessAflApiCutoverReadiness } from '@/lib/acquisition/afl-api-cutover-readiness';
import {
  AFLTABLES_RETIREMENT_DECISIONS,
  parseAfltablesRetirementDecision,
  planAfltablesNetworkRetirement,
} from '@/lib/rollover/afltables-network-retirement';
import { RolloverRefused } from '@/lib/rollover/season-rollover';
import { runAflApiCutoverReadiness, venueRowsCheck } from '../tools/current-season/afl-api-cutover-readiness';
import {
  ACQUIRE_SCRIPT,
  AFL_API_SERVICE_FILE,
  C4B_DECISION,
  C4B_SETTING_KEY,
  SETTLE_SCRIPT,
  WATCHDOG_READY_KIND,
  WATCHDOG_READY_MARKER,
  WATCHDOG_STAND_DOWN_KIND,
  WATCHDOG_STAND_DOWN_MARKER,
  armWatchdogProcess,
  armWatchdogWithHandshake,
  assessWatchdogReady,
  awaitWatchdogReady,
  childEnvironment,
  main as c4bMain,
  parseC4bArgs,
  publishWatchdogReady,
  readStandDown,
  recordDifferences,
  runC4bRehearsal,
  runChildStep,
  restoreSettingOff,
  runRestoreOnly,
  runWatchdog,
  runWatchdogProcess,
  stepCommand,
  tsxLoaderArgs,
  watchdogCommand,
  watchdogStartup,
  type ArmEffects,
  type C4bDeps,
  type RehearsalRecord,
  type SettingValue,
  type StepResult,
  type WatchdogDeps,
  type WatchdogReadyMarker,
} from '../tools/current-season/afl-api-c4b-rehearsal';

/* ------------------------------------------------------------------ *
 * The tracked control
 * ------------------------------------------------------------------ */

describe('data/reference/afltables-network.json', () => {
  const control = JSON.parse(read('data/reference/afltables-network.json'));
  const seasons = JSON.parse(read('data/reference/seasons.json'));

  it('ships retired by D-316-1 at the 2026 rollover, still bounded to 2026 (AFLDB-ISSUE-316)', () => {
    expect(control.status).toBe('retired');
    expect(control.last_season).toBe(2026);
    expect(control.decision).toBe('D-316-1');
    expect(control.changed_at).toBe('2026-10-27');
    // Every reader sees it retired against the 2027 in-progress season, never out of bounds.
    expect(seasons.in_progress_seasons).toEqual([2027]);
    expect(parseAfltablesNetworkStatus(control, seasons)).toBe('retired');
  });

  it('shipped active and bounded to 2026 in the explicit predecessor, which altered no live behaviour', () => {
    const before = JSON.parse(predecessorText('data/reference/afltables-network.json'));
    expect(before).toMatchObject({ status: 'active', last_season: 2026, decision: null, changed_at: null });
    expect(parseAfltablesNetworkStatus(before, predecessorJson('data/reference/seasons.json'))).toBe('active');
  });

  // The repository-level half of "a rollover to [2027] cannot ship with the
  // switch active": an active switch must bound every tracked in-progress
  // season. A commit that moves the register past last_season without
  // retiring the switch fails here (and every gate refuses at run time).
  it('INVARIANT: the tracked switch is retired, or active and bounding every in-progress season', () => {
    const status = parseAfltablesNetworkStatus(control, seasons);
    expect(status).not.toBe('out_of_bounds');
    if (control.status === 'active') expect(status).toBe('active');
  });

  it('is serialised exactly as the rollover rewrites it (2-space JSON, trailing newline)', () => {
    expect(read('data/reference/afltables-network.json')).toBe(`${JSON.stringify(control, null, 2)}\n`);
  });

  it('documents every gated path, and the rollover that retires it, in its own comment', () => {
    for (const p of [
      'deploy/afldb-settle-afltables.sh',
      'legacy/offline/tools/rebuild/fitzroy/acquire_core.R',
      'legacy/offline/tools/rebuild/afltables/acquire_club_lists.R',
      'legacy/offline/tools/rebuild/afltables/acquire_coaches.py',
      'src/lib/acquisition/settle-trigger.ts',
      'tools/db/rollover-season.ts',
      'last_season',
    ]) {
      expect(control.$comment).toContain(p);
    }
  });
});

describe('parseAfltablesNetworkStatus (fail closed)', () => {
  const in2026 = { in_progress_seasons: [2026] };
  it.each([
    [{ status: 'active', last_season: 2026 }, in2026, 'active'],
    [{ status: 'active', last_season: 2027 }, in2026, 'active'],
    [{ status: 'active', last_season: 2026 }, { in_progress_seasons: [] }, 'active'],
    [{ status: 'active', last_season: 2026 }, { in_progress_seasons: [2027] }, 'out_of_bounds'],
    [{ status: 'active', last_season: 2026 }, { in_progress_seasons: [2026, 2027] }, 'out_of_bounds'],
    [{ status: 'active', last_season: 2026 }, { in_progress_seasons: ['2026'] }, 'out_of_bounds'],
    [{ status: 'active', last_season: 2026 }, {}, 'out_of_bounds'],
    [{ status: 'active', last_season: 2026 }, undefined, 'out_of_bounds'],
    [{ status: 'active' }, in2026, 'retired'],
    [{ status: 'active', last_season: '2026' }, in2026, 'retired'],
    [{ status: 'active', last_season: 2026.5 }, in2026, 'retired'],
    [{ status: 'active', last_season: true }, in2026, 'retired'],
    [{ status: 'retired', last_season: 2026 }, in2026, 'retired'],
    [{ status: 'retired', last_season: 2026 }, { in_progress_seasons: [2027] }, 'retired'],
    [{ status: 'Active', last_season: 2026 }, in2026, 'retired'],
    [{ status: 'active ', last_season: 2026 }, in2026, 'retired'],
    [{ status: true, last_season: 2026 }, in2026, 'retired'],
    [{}, in2026, 'retired'],
    [null, in2026, 'retired'],
    ['active', in2026, 'retired'],
    [undefined, in2026, 'retired'],
  ])('%j with %j -> %s', (raw, seasons, expected) => {
    expect(parseAfltablesNetworkStatus(raw, seasons)).toBe(expected);
  });
});

describe('startSettleRun() and the switch', () => {
  const saved = process.env.AFLDB_SETTLE_TRIGGER;
  beforeEach(() => {
    mocks.execFile.mockReset();
    mocks.seasons = { in_progress_seasons: [2026] };
    process.env.AFLDB_SETTLE_TRIGGER = 'systemd';
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.AFLDB_SETTLE_TRIGGER;
    else process.env.AFLDB_SETTLE_TRIGGER = saved;
    mocks.control = { status: 'active', last_season: 2026 };
    mocks.seasons = { in_progress_seasons: [2026] };
  });

  it('retired: refuses as unavailable and never spawns systemctl', async () => {
    mocks.control = { status: 'retired', last_season: 2026 };
    expect(afltablesNetworkStatus()).toBe('retired');
    await expect(startSettleRun()).resolves.toEqual({
      outcome: 'unavailable',
      reason: AFLTABLES_NETWORK_RETIRED,
    });
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it('retired wins even on a host not provisioned for the trigger', async () => {
    mocks.control = { status: 'retired', last_season: 2026 };
    delete process.env.AFLDB_SETTLE_TRIGGER;
    await expect(startSettleRun()).resolves.toEqual({
      outcome: 'unavailable',
      reason: AFLTABLES_NETWORK_RETIRED,
    });
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it('a malformed or unbounded control is retired', async () => {
    for (const control of [{ state: 'active', last_season: 2026 }, { status: 'active' }]) {
      mocks.control = control;
      await expect(startSettleRun()).resolves.toEqual({
        outcome: 'unavailable', reason: AFLTABLES_NETWORK_RETIRED,
      });
    }
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it('active but the register has rolled past last_season: refused, never spawns systemctl', async () => {
    mocks.control = { status: 'active', last_season: 2026 };
    mocks.seasons = { in_progress_seasons: [2027] };
    expect(afltablesNetworkStatus()).toBe('out_of_bounds');
    await expect(startSettleRun()).resolves.toEqual({
      outcome: 'unavailable',
      reason: AFLTABLES_NETWORK_OUT_OF_BOUNDS,
    });
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it('active and bounded: unchanged — reads the unit, then starts exactly the one unit', async () => {
    mocks.control = { status: 'active', last_season: 2026 };
    mocks.execFile.mockImplementation(
      (_bin: string, argv: string[], _opts: unknown, cb: (e: null, out: string, err: string) => void) => {
        cb(null, argv[0] === 'show' ? 'LoadState=loaded\nActiveState=inactive\n' : '', '');
      },
    );
    await expect(startSettleRun()).resolves.toEqual({ outcome: 'started' });
    const argvs = mocks.execFile.mock.calls.map((c) => c[1]);
    expect(argvs[0][0]).toBe('show');
    expect(argvs[1]).toEqual(['start', '--no-block', 'afldb-settle-afltables.service']);
  });
});

/* ------------------------------------------------------------------ *
 * Scripts: the real gate code against a temporary tree
 * ------------------------------------------------------------------ */

const have = (bin: string, arg: string) =>
  spawnSync(bin, [arg], { encoding: 'utf8', windowsHide: true }).status === 0;
const HAVE_RSCRIPT = have('Rscript', '--version');
const PYTHON = ['python3', 'python'].find((b) => have(b, '--version'));
// `sh` is on PATH on Linux; on a Windows workstation it is Git's, which is
// usually not on PATH outside Git Bash.
const SH = ['sh', 'C:/Program Files/Git/bin/sh.exe'].find(
  (b) => spawnSync(b, ['-c', 'exit 0'], { windowsHide: true }).status === 0,
);
const HAVE_SH = SH !== undefined;

const temps: string[] = [];
afterAll(() => { for (const t of temps) rmSync(t, { recursive: true, force: true }); });

/**
 * `active` is bounded to 2026 with [2026] in progress; `unbounded` is active
 * with no last_season (retired); `beyond` is the state a rollover to [2027]
 * would leave if the switch stayed active.
 */
type Control = 'active' | 'retired' | 'missing' | 'garbage' | 'unbounded' | 'beyond';
const REFUSED: readonly Control[] = ['retired', 'missing', 'garbage', 'unbounded'];

/** AFLDB-ISSUE-319: the quarantined coach adapter imports this tools/ parser at load. */
const COACH_PARSER = 'tools/rebuild/afltables/coach_snapshot_parser.py';

/** A temporary tree holding ONLY the control, the register (and `extra` files, CR-stripped). */
function tree(control: Control, extra: Record<string, string> = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'afltables-network-'));
  temps.push(dir);
  mkdirSync(path.join(dir, 'data/reference'), { recursive: true });
  const file = path.join(dir, 'data/reference/afltables-network.json');
  if (control === 'active' || control === 'beyond') {
    writeFileSync(file, JSON.stringify({ status: 'active', last_season: 2026 }));
  } else if (control === 'retired') {
    writeFileSync(file, JSON.stringify({ status: 'retired', last_season: 2026 }));
  } else if (control === 'unbounded') {
    writeFileSync(file, JSON.stringify({ status: 'active' }));
  } else if (control === 'garbage') {
    writeFileSync(file, '{ not json');
  }
  writeFileSync(path.join(dir, 'data/reference/seasons.json'),
    JSON.stringify({ in_progress_seasons: [control === 'beyond' ? 2027 : 2026] }));
  for (const [rel, src] of Object.entries(extra)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), read(src));
  }
  return dir;
}

function run(bin: string, args: string[], cwd: string, env: Record<string, string> = {}) {
  const r = spawnSync(bin, args, {
    cwd, encoding: 'utf8', windowsHide: true, timeout: 60_000,
    env: { ...process.env, ...env },
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe.skipIf(!HAVE_RSCRIPT)('acquire_core.R gate (fitzRoy: player stats, results, details, ladder)', () => {
  const script = path.join(root, 'legacy/offline/tools/rebuild/fitzroy/acquire_core.R');
  const argv = [script, '--acquire', '--in-season', '--label', 'x', '--from', '2026', '--to', '2026'];
  for (const control of REFUSED) {
    it(`${control}: refuses before fitzRoy is loaded`, () => {
      const r = run('Rscript', argv, tree(control));
      expect(r.status).not.toBe(0);
      expect(r.out).toContain(RETIRED_MARKER);
      if (control === 'missing') expect(r.out).toContain('run from the repository root');
      else expect(r.out).toContain('does not say status');
    });
  }
  it('beyond: an active switch behind the register refuses as out of bounds', () => {
    const r = run('Rscript', argv, tree('beyond'));
    expect(r.status).not.toBe(0);
    expect(r.out).toContain(OUT_OF_BOUNDS_MARKER);
  });
  it('active: passes the gate (then stops on the missing contract or package, offline)', () => {
    const r = run('Rscript', [script, '--probe'], tree('active'));
    expect(r.status).not.toBe(0);
    expect(r.out).not.toContain(RETIRED_MARKER);
    expect(r.out).not.toContain(OUT_OF_BOUNDS_MARKER);
  });
});

describe.skipIf(!HAVE_RSCRIPT)('acquire_club_lists.R gate (httr club pages)', () => {
  const script = path.join(root, 'legacy/offline/tools/rebuild/afltables/acquire_club_lists.R');
  for (const control of REFUSED) {
    it(`${control}: refuses before httr is loaded`, () => {
      const r = run('Rscript', [script], tree(control));
      expect(r.status).not.toBe(0);
      expect(r.out).toContain(RETIRED_MARKER);
    });
  }
  it('beyond: refuses as out of bounds', () => {
    const r = run('Rscript', [script], tree('beyond'));
    expect(r.status).not.toBe(0);
    expect(r.out).toContain(OUT_OF_BOUNDS_MARKER);
  });
  it('active: passes the gate', () => {
    const r = run('Rscript', [script], tree('active'));
    expect(r.status).not.toBe(0);
    expect(r.out).not.toContain(RETIRED_MARKER);
    expect(r.out).not.toContain(OUT_OF_BOUNDS_MARKER);
  });
});

describe.skipIf(!PYTHON)('acquire_coaches.py gate (urllib coach pages)', () => {
  const rel = 'legacy/offline/tools/rebuild/afltables/acquire_coaches.py';
  // The script resolves its repository root from its own path, so it is copied
  // into the temporary tree beside the control rather than run in place, with the
  // shared coach parser it imports (AFLDB-ISSUE-319; network-free, no gate of its own).
  const py = (control: Control) => {
    const dir = tree(control, { [rel]: rel, [COACH_PARSER]: COACH_PARSER });
    return run(PYTHON!, ['-I', path.join(dir, rel), '--out-dir', path.join(dir, 'out')], dir);
  };
  for (const control of REFUSED) {
    it(`${control}: refuses before the contract is read`, () => {
      const r = py(control);
      expect(r.status).not.toBe(0);
      expect(r.out).toContain(RETIRED_MARKER);
    });
  }
  it('beyond: refuses as out of bounds before the contract is read', () => {
    const r = py('beyond');
    expect(r.status).not.toBe(0);
    expect(r.out).toContain(OUT_OF_BOUNDS_MARKER);
    expect(r.out).not.toContain('missing acquisition contract');
  });
  it('active: passes the gate (then stops on the missing contract)', () => {
    const r = py('active');
    expect(r.status).not.toBe(0);
    expect(r.out).not.toContain(RETIRED_MARKER);
    expect(r.out).not.toContain(OUT_OF_BOUNDS_MARKER);
    expect(r.out).toContain('missing acquisition contract');
  });
});

describe.skipIf(!HAVE_SH || !PYTHON)('deploy/afldb-settle-afltables.sh gate (timer and on-demand unit)', () => {
  const rel = 'deploy/afldb-settle-afltables.sh';
  const sh = (control: Control) => {
    const dir = tree(control, { [rel]: rel });
    return run(SH!, [path.join(dir, rel)], dir, { AFLDB_PROJECT_ROOT: dir, AFLDB_PYTHON: PYTHON! });
  };
  for (const control of REFUSED) {
    it(`${control}: exits 0 with the marker and reaches no step`, () => {
      const r = sh(control);
      expect(r.status).toBe(0);
      expect(r.out).toContain(RETIRED_MARKER);
      expect(r.out).not.toContain('[1/3]');
    });
  }
  it('beyond: FAILS the unit (exit 1, out-of-bounds marker) and reaches no step', () => {
    const r = sh('beyond');
    expect(r.status).toBe(1);
    expect(r.out).toContain(OUT_OF_BOUNDS_MARKER);
    expect(r.out).not.toContain(RETIRED_MARKER);
    expect(r.out).not.toContain('[1/3]');
  });
  it('active: passes the gate (then fails closed on the missing R runtime fragment)', () => {
    const r = sh('active');
    expect(r.out).not.toContain(RETIRED_MARKER);
    expect(r.out).not.toContain(OUT_OF_BOUNDS_MARKER);
    expect(r.out).not.toContain('[1/3]');
    expect(r.status).not.toBe(0);
  });
  it('V2 active/bounded: refuses even with the R environment present, before acquisition or Node', () => {
    const dir = tree('active', { [rel]: rel });
    // Reach V2's independent runtime retirement, rather than stopping on a
    // missing host fragment. No acquisition implementation exists in this tree.
    writeFileSync(path.join(dir, 'deploy/afldb-r-env.sh'), 'RSCRIPT=/must-not-run-Rscript\n');
    const r = run(SH!, [path.join(dir, rel)], dir, {
      AFLDB_PROJECT_ROOT: dir, AFLDB_PYTHON: PYTHON!, AFLDB_NODE: '/must-not-run-node',
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain('AFLDB_LEGACY_RETIRED_V2');
    expect(r.out).not.toContain('[1/3]');
    expect(r.out).not.toContain('[3/3]');
    expect(existsSync(path.join(dir, 'data/sources'))).toBe(false);
  });
  it('an interpreter that cannot run fails the unit (not a quiet retired success)', () => {
    const dir = tree('active', { [rel]: rel });
    const r = run(SH!, [path.join(dir, rel)], dir, {
      AFLDB_PROJECT_ROOT: dir, AFLDB_PYTHON: path.join(dir, 'no-such-python'),
    });
    expect(r.status).not.toBe(0);
    expect(r.out).not.toContain(RETIRED_MARKER);
    expect(r.out).toContain('could not run');
  });
  it('the gate precedes the R runtime, the season and acquisition in the source', () => {
    const src = read(rel);
    const gate = src.indexOf('afltables-network.json');
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(src.indexOf('. "$PROJECT_ROOT/deploy/afldb-r-env.sh"'));
    expect(gate).toBeLessThan(src.indexOf('tools/rebuild/fitzroy/acquire_core.R'));
  });
});

/* ------------------------------------------------------------------ *
 * The number contract: every gate reads last_season and the register the same way
 * ------------------------------------------------------------------ */

/**
 * `last_season` and every in-progress season must be a finite, integer-valued JSON number. `2026` and `2026.0`
 * are one value to every gate; a boolean, string, null, fraction or non-finite number is not a season. The cases
 * are raw file text because `JSON.stringify` cannot write `2026.0`. Each runs through the TypeScript parser, both
 * R gates, the Python gate and the shell gate's embedded Python, which must all agree.
 */
type GateOutcome = 'active' | 'retired' | 'out_of_bounds';
interface NumberCase { label: string; status?: string; last: string; register: string; expected: GateOutcome }
const NUMBER_CONTRACT: readonly NumberCase[] = [
  { label: 'integer 2026 bounds [2026]', last: '2026', register: '[2026]', expected: 'active' },
  { label: '2026.0 bounds [2026]', last: '2026.0', register: '[2026]', expected: 'active' },
  { label: '2.026e3 (an exponent form of 2026) bounds [2026]', last: '2.026e3', register: '[2026]', expected: 'active' },
  { label: '2026.0 bounds [2026.0]', last: '2026.0', register: '[2026.0]', expected: 'active' },
  { label: '2027.0 bounds [2026]', last: '2027.0', register: '[2026]', expected: 'active' },
  { label: '2026.0 bounds an empty register', last: '2026.0', register: '[]', expected: 'active' },
  { label: '2026.0 with [2027] is out of bounds', last: '2026.0', register: '[2027]', expected: 'out_of_bounds' },
  { label: '2026.0 with [2027.0] is out of bounds', last: '2026.0', register: '[2027.0]', expected: 'out_of_bounds' },
  { label: '2026.0 with [2026, 2027.0] is out of bounds', last: '2026.0', register: '[2026, 2027.0]', expected: 'out_of_bounds' },
  { label: 'a fractional season in the register', last: '2026', register: '[2026.5]', expected: 'out_of_bounds' },
  { label: 'a boolean season in the register', last: '2026', register: '[true]', expected: 'out_of_bounds' },
  { label: 'a string season in the register', last: '2026', register: '["2026"]', expected: 'out_of_bounds' },
  { label: 'a null season in the register', last: '2026', register: '[null]', expected: 'out_of_bounds' },
  { label: 'a non-finite season in the register (1e999)', last: '2026', register: '[1e999]', expected: 'out_of_bounds' },
  { label: 'a fractional last_season', last: '2026.5', register: '[2026]', expected: 'retired' },
  { label: 'a boolean last_season', last: 'true', register: '[2026]', expected: 'retired' },
  { label: 'a string last_season', last: '"2026"', register: '[2026]', expected: 'retired' },
  { label: 'a null last_season', last: 'null', register: '[2026]', expected: 'retired' },
  { label: 'a non-finite last_season (1e999)', last: '1e999', register: '[2026]', expected: 'retired' },
  { label: 'a NaN last_season (not valid JSON)', last: 'NaN', register: '[2026]', expected: 'retired' },
  { label: 'an Infinity last_season (not valid JSON)', last: 'Infinity', register: '[2026]', expected: 'retired' },
  { label: 'a retired switch with 2026.0', status: 'retired', last: '2026.0', register: '[2026]', expected: 'retired' },
  { label: 'a retired switch with 2026.0 and [2027]', status: 'retired', last: '2026.0', register: '[2027]', expected: 'retired' },
];
const controlText = (c: NumberCase) => `{"status": "${c.status ?? 'active'}", "last_season": ${c.last}}`;
const registerText = (c: NumberCase) => `{"in_progress_seasons": ${c.register}}`;

/** The marker, or its absence, a gate left in its output. */
const outcomeOf = (out: string): GateOutcome => (
  out.includes(OUT_OF_BOUNDS_MARKER) ? 'out_of_bounds' : out.includes(RETIRED_MARKER) ? 'retired' : 'active');

/** Like `tree()`, but the control and register are written verbatim. */
function rawTree(c: NumberCase, extra: Record<string, string> = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'afltables-network-'));
  temps.push(dir);
  mkdirSync(path.join(dir, 'data/reference'), { recursive: true });
  writeFileSync(path.join(dir, 'data/reference/afltables-network.json'), controlText(c));
  writeFileSync(path.join(dir, 'data/reference/seasons.json'), registerText(c));
  for (const [rel, src] of Object.entries(extra)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), read(src));
  }
  return dir;
}

describe('the last_season number contract is the same in every gate', () => {
  const parsed = (text: string): unknown => { try { return JSON.parse(text); } catch { return undefined; } };

  it.each(NUMBER_CONTRACT)('TypeScript: $label -> $expected', (c) => {
    expect(parseAfltablesNetworkStatus(parsed(controlText(c)), parsed(registerText(c)))).toBe(c.expected);
  });

  describe.skipIf(!HAVE_RSCRIPT)('R', () => {
    const core = path.join(root, 'legacy/offline/tools/rebuild/fitzroy/acquire_core.R');
    const clubs = path.join(root, 'legacy/offline/tools/rebuild/afltables/acquire_club_lists.R');
    it.each(NUMBER_CONTRACT)('acquire_core.R: $label -> $expected', (c) => {
      const r = run('Rscript', [core, '--probe'], rawTree(c));
      expect(outcomeOf(r.out)).toBe(c.expected);
      expect(r.status !== 0).toBe(true);
    });
    it.each(NUMBER_CONTRACT)('acquire_club_lists.R: $label -> $expected', (c) => {
      const r = run('Rscript', [clubs], rawTree(c));
      expect(outcomeOf(r.out)).toBe(c.expected);
      expect(r.status !== 0).toBe(true);
    });
  });

  describe.skipIf(!PYTHON)('Python', () => {
    const rel = 'legacy/offline/tools/rebuild/afltables/acquire_coaches.py';
    it.each(NUMBER_CONTRACT)('acquire_coaches.py: $label -> $expected', (c) => {
      const dir = rawTree(c, { [rel]: rel, [COACH_PARSER]: COACH_PARSER });
      const r = run(PYTHON!, ['-I', path.join(dir, rel), '--out-dir', path.join(dir, 'out')], dir);
      expect(outcomeOf(r.out)).toBe(c.expected);
      expect(r.status).not.toBe(0);
      // An active gate is passed, and the script then stops on the contract that this bare tree lacks.
      if (c.expected === 'active') expect(r.out).toContain('missing acquisition contract');
    });
  });

  describe.skipIf(!HAVE_SH || !PYTHON)('the settle unit script', () => {
    const rel = 'deploy/afldb-settle-afltables.sh';
    it.each(NUMBER_CONTRACT)('afldb-settle-afltables.sh: $label -> $expected', (c) => {
      const dir = rawTree(c, { [rel]: rel });
      const r = run(SH!, [path.join(dir, rel)], dir, { AFLDB_PROJECT_ROOT: dir, AFLDB_PYTHON: PYTHON! });
      expect(outcomeOf(r.out)).toBe(c.expected);
      expect(r.out).not.toContain('[1/3]');
      // retired is a quiet success, out of bounds fails the unit, active stops later on the bare tree
      if (c.expected === 'retired') expect(r.status).toBe(0);
      else expect(r.status).not.toBe(0);
    });
  });
});

/* ------------------------------------------------------------------ *
 * The season rollover retires the switch in the same write (C2)
 * ------------------------------------------------------------------ */

describe('rollover: AFL Tables retirement (AFLDB-ISSUE-316 C2)', () => {
  // The switch the 2026 rollover consumes: the explicit predecessor (active, bounded to 2026). The tracked
  // file is its retired result since D-316-1.
  const trackedSource = predecessorText('data/reference/afltables-network.json').replace(/\r\n/g, '\n');
  const plan = (over: Partial<Parameters<typeof planAfltablesNetworkRetirement>[0]> = {}) =>
    planAfltablesNetworkRetirement({
      completedSeason: 2026,
      rolloverDate: '2026-11-03',
      decision: 'D-316-1',
      currentSource: trackedSource,
      currentSeasons: { in_progress_seasons: [2026] },
      ...over,
    });

  it('the decision flag is required and must be a decision id', () => {
    expect(() => parseAfltablesRetirementDecision([])).toThrow(RolloverRefused);
    expect(() => parseAfltablesRetirementDecision(['--afltables-retirement-decision']))
      .toThrow(/is required/);
    expect(() => parseAfltablesRetirementDecision(['--afltables-retirement-decision', '--apply']))
      .toThrow(/is required/);
    expect(() => parseAfltablesRetirementDecision(['--afltables-retirement-decision', 'yes']))
      .toThrow(/must be a decision id/);
    expect(parseAfltablesRetirementDecision(['--season', '2026', '--afltables-retirement-decision', 'D-316-1']))
      .toBe('D-316-1');
  });

  it.each(['d-316-1', ' D-316-1', 'D-316-1 ', 'D316-1', 'D-316-1\n', '', 'D-', 'D--316-1', 'D-316_1'])(
    'a malformed value %j is refused by the parser, and by the planner if it got that far',
    (value) => {
      expect(() => parseAfltablesRetirementDecision(['--afltables-retirement-decision', value]))
        .toThrow(/must be a decision id/);
      expect(() => plan({ decision: value })).toThrow(RolloverRefused);
    },
  );

  it('the flag given twice is refused, even with the same value', () => {
    for (const second of ['D-999-1', 'D-316-1']) {
      expect(() => parseAfltablesRetirementDecision([
        '--afltables-retirement-decision', 'D-316-1', '--afltables-retirement-decision', second,
      ])).toThrow(/more than once/);
    }
  });

  it('exactly D-316-1 authorises the 2026 rollover, and the retired switch records it', () => {
    expect(AFLTABLES_RETIREMENT_DECISIONS).toEqual({ 2026: 'D-316-1' });
    expect(Object.isFrozen(AFLTABLES_RETIREMENT_DECISIONS)).toBe(true);
    const next = JSON.parse(plan({ decision: 'D-316-1' }).file.content);
    expect(next).toMatchObject({ status: 'retired', last_season: 2026, decision: 'D-316-1' });
  });

  it.each(['D-316-2', 'D-316-13', 'D-316-10', 'D-316-1a', 'D-316-1-1', 'D-999-1', 'D-233-3', 'D-316'])(
    'a well-formed but unrelated decision %s does not authorise retirement',
    (decision) => {
      expect(parseAfltablesRetirementDecision(['--afltables-retirement-decision', decision])).toBe(decision);
      expect(() => plan({ decision })).toThrow(RolloverRefused);
      expect(() => plan({ decision }))
        .toThrow(/does not authorise retiring AFL Tables at the 2026 rollover: the recorded owner decision is D-316-1/);
    },
  );

  it('a season with no registered decision refuses even D-316-1 (a re-activation must register its own)', () => {
    expect(() => plan({
      completedSeason: 2027,
      decision: 'D-316-1',
      currentSource: JSON.stringify({ status: 'active', last_season: 2027 }),
      currentSeasons: { in_progress_seasons: [2027] },
    })).toThrow(/No owner decision is registered for retiring AFL Tables at the 2027 rollover/);
  });

  it('from the tracked switch: writes retired, keeps last_season and the comment, records the decision', () => {
    const { file, note } = plan();
    expect(file.path).toBe('data/reference/afltables-network.json');
    expect(file.reformatted).toBe(false);
    const next = JSON.parse(file.content);
    const before = JSON.parse(trackedSource);
    expect(next).toEqual({ ...before, status: 'retired', decision: 'D-316-1', changed_at: '2026-11-03' });
    expect(Object.keys(next)).toEqual(Object.keys(before));
    // After the rollover lands, every reader sees it retired, never out of bounds.
    expect(parseAfltablesNetworkStatus(next, { in_progress_seasons: [2027] })).toBe('retired');
    expect(note).toContain('D-316-1');
  });

  it('keeps a CRLF source CRLF', () => {
    const { file } = plan({ currentSource: trackedSource.replace(/\n/g, '\r\n') });
    expect(file.content).toContain('\r\n');
    expect(file.content.replace(/\r\n/g, '')).not.toContain('\n');
    expect(file.reformatted).toBe(false);
  });

  it.each([
    ['retired', JSON.stringify({ status: 'retired', last_season: 2026 }), /reads 'retired'/],
    ['unbounded', JSON.stringify({ status: 'active' }), /reads 'retired'/],
    ['garbage', '{ not json', /not valid JSON/],
    ['bounded to another season', JSON.stringify({ status: 'active', last_season: 2027 }), /last_season 2027/],
  ])('refuses a switch that is %s', (_label, currentSource, message) => {
    expect(() => plan({ currentSource })).toThrow(RolloverRefused);
    expect(() => plan({ currentSource })).toThrow(message);
  });

  it('refuses when the register is already past the switch (an out-of-bounds start)', () => {
    expect(() => plan({ currentSeasons: { in_progress_seasons: [2027] } })).toThrow(/reads 'out_of_bounds'/);
  });

  it('a post-retirement rollover (2027) is refused and names D-316-6', () => {
    const retired = plan().file.content;
    expect(() => plan({
      completedSeason: 2027, currentSource: retired, currentSeasons: { in_progress_seasons: [2027] },
    })).toThrow(/D-316-6/);
  });

  it('the CLI parses the decision first, plans the retirement before any gate, and writes the switch first', () => {
    const cli = read('tools/db/rollover-season.ts');
    const parse = cli.indexOf('parseAfltablesRetirementDecision(argv)');
    const planned = cli.indexOf('planAfltablesNetworkRetirement({');
    const firstGate = cli.indexOf('runPython(fullHistoryArgv');
    // The switch leads the write set, ahead of every other file, and the set is only written by
    // the one staged apply that follows the authority check and the dry-run return.
    const switchFirst = cli.indexOf('[networkRetirement.file, ...plan.files]');
    const applyCall = cli.indexOf('applyStagedWrites(repoIo, args.season, writeSet, binding)');
    expect(parse).toBeGreaterThan(0);
    expect(parse).toBeLessThan(cli.indexOf('parseJsonFile(args.coreManifest'));
    expect(planned).toBeGreaterThan(cli.indexOf('planSuccessorContract({'));
    expect(planned).toBeLessThan(firstGate);
    expect(switchFirst).toBeGreaterThan(cli.indexOf('assertPreApplyAuthority({'));
    expect(applyCall).toBeGreaterThan(switchFirst);
    expect(applyCall).toBeGreaterThan(cli.indexOf('if (!apply)'));
  });
});

/* ------------------------------------------------------------------ *
 * Readiness report (repository and season feed preconditions, DB-free)
 * ------------------------------------------------------------------ */

describe('AFL API cutover readiness', () => {
  // Identities and round tables are the tracked files; the in-progress register
  // and the switch are fixtures, because the 2026 rollover rewrites the tracked
  // ones and these cases must not change meaning when it does. The feed is the
  // sanitised authentic 2026 season matches response (ISSUE-231).
  const FEED_PATH = 'tests/fixtures/afl_api/seasons/00-season-matches-2026.raw.json';
  const feedText = readFileSync(path.join(root, FEED_PATH), 'utf8');
  const real = {
    seasons: { in_progress_seasons: [2026] },
    identities: JSON.parse(read('data/reference/afl-api-identities.json')),
    sourceFamilies: JSON.parse(read('data/reference/source-families.json')),
    afltablesNetwork: { status: 'active', last_season: 2026 },
    seasonFeed: { path: FEED_PATH, text: feedText },
  };
  const ALL = ['in_progress_season', 'season_identity', 'round_vocabulary', 'season_feed',
    'venue_coverage', 'team_coverage', 'round_coverage'];
  const byId = (r: ReturnType<typeof assessAflApiCutoverReadiness>) =>
    Object.fromEntries(r.checks.map((c) => [c.id, c]));
  /** Deliberately loose: each case edits whatever path it is about. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type FeedBody = { meta: { pagination?: Record<string, unknown> }; matches: any[] };
  /** The 2026 feed with `edit` applied to its parsed body. */
  const feedWith = (edit: (body: FeedBody) => void) => {
    const body = JSON.parse(feedText);
    edit(body);
    return { path: 'edited.json', text: JSON.stringify(body) };
  };

  it('2026 (tracked files + authentic feed): every precondition holds, including full feed coverage', () => {
    const r = assessAflApiCutoverReadiness(2026, real);
    expect(r.checks.map((c) => [c.id, c.ok])).toEqual(ALL.map((id) => [id, true]));
    expect(r.ready).toBe(true);
    expect(r.afltablesNetwork).toBe('active');
    expect(byId(r).season_feed.detail).toContain('218 match(es), complete for CD_S2026014');
    expect(byId(r).venue_coverage.detail).toContain('17 distinct provider venue(s)');
    expect(r.feedVenueLegacyNames.length).toBeGreaterThan(0);
  });

  it('no feed: NOT READY, and every coverage check fails as unproved', () => {
    const r = assessAflApiCutoverReadiness(2026, { ...real, seasonFeed: undefined });
    expect(r.ready).toBe(false);
    const c = byId(r);
    expect(c.season_feed.ok).toBe(false);
    expect(c.season_feed.detail).toContain('No season matches feed');
    for (const id of ['venue_coverage', 'team_coverage', 'round_coverage']) {
      expect(c[id].ok).toBe(false);
      expect(c[id].detail).toMatch(/^Unproved/);
    }
    expect(r.feedVenueLegacyNames).toEqual([]);
  });

  it('an unmapped feed venue fails venue coverage and names it', () => {
    const r = assessAflApiCutoverReadiness(2026, {
      ...real,
      seasonFeed: feedWith((b) => { b.matches[3].venue = { ...b.matches[3].venue, providerId: 'CD_V99999', name: 'New Oval' }; }),
    });
    expect(r.ready).toBe(false);
    expect(byId(r).venue_coverage.ok).toBe(false);
    expect(byId(r).venue_coverage.detail).toContain("CD_V99999 'New Oval' (1 match(es))");
    expect(byId(r).team_coverage.ok).toBe(true);
  });

  it('a feed entry without a venue provider id fails (malformed evidence never passes)', () => {
    const r = assessAflApiCutoverReadiness(2026, {
      ...real, seasonFeed: feedWith((b) => { delete b.matches[0].venue.providerId; }),
    });
    expect(byId(r).venue_coverage.ok).toBe(false);
    expect(byId(r).venue_coverage.detail).toContain('venue.providerId is not a non-empty string');
    expect(r.ready).toBe(false);
  });

  it.each([
    ['an unmapped venue', (b: FeedBody) => {
      const last = b.matches[b.matches.length - 1];
      last.venue = { ...last.venue, providerId: 'CD_V99999', name: 'New Oval' };
    }],
    ['a venue without a provider id', (b: FeedBody) => { delete b.matches[b.matches.length - 1].venue.providerId; }],
    ['a venue that is not an object', (b: FeedBody) => { b.matches[b.matches.length - 1].venue = 'MCG'; }],
    ['an unmapped venue midway', (b: FeedBody) => {
      b.matches[100].venue = { ...b.matches[100].venue, providerId: 'CD_V99998', name: 'Midway Oval' };
    }],
  ])('%s after mapped venues: NOT READY, no venue names, and no partial venues SQL', (_label, edit) => {
    const feed = feedWith(edit);
    const r = assessAflApiCutoverReadiness(2026, { ...real, seasonFeed: feed });
    expect(byId(r).season_feed.ok).toBe(true);
    expect(byId(r).venue_coverage.ok).toBe(false);
    expect(r.ready).toBe(false);
    expect(r.feedVenueLegacyNames).toEqual([]);
    expect(venueRowsCheck(r)).toBeNull();

    const dir = tree('active', {
      'data/reference/afl-api-identities.json': 'data/reference/afl-api-identities.json',
      'data/reference/source-families.json': 'data/reference/source-families.json',
    });
    writeFileSync(path.join(dir, 'feed.json'), feed.text);
    const cli = runAflApiCutoverReadiness(['--season', '2026', '--season-feed', 'feed.json'], dir);
    const text = cli.lines.join('\n');
    expect(cli.exitCode).toBe(1);
    expect(text).toContain('VERDICT: NOT READY');
    expect(text).not.toMatch(/FROM venues/);
    expect(text).not.toMatch(/legacy_name/);
    expect(text).toContain('not printed, because venue_coverage did not pass');
  });

  it('the venues SQL is all or nothing: only from a passing venue_coverage, naming every venue', () => {
    const ok = assessAflApiCutoverReadiness(2026, real);
    const sql = venueRowsCheck(ok);
    expect(sql).toContain(`-- expect ${ok.feedVenueLegacyNames.length}`);
    for (const name of ok.feedVenueLegacyNames) expect(sql).toContain(`'${name.replace(/'/g, "''")}'`);
    // A readiness whose venue_coverage did not pass prints nothing, whatever names it carries.
    const forged = { ...ok, checks: ok.checks.map((c) => (c.id === 'venue_coverage' ? { ...c, ok: false } : c)) };
    expect(venueRowsCheck(forged)).toBeNull();
    expect(venueRowsCheck({ ...ok, checks: ok.checks.filter((c) => c.id !== 'venue_coverage') })).toBeNull();
  });

  it('an unmapped team or an untranslatable round fails its own check', () => {
    const team = assessAflApiCutoverReadiness(2026, {
      ...real, seasonFeed: feedWith((b) => { b.matches[5].away.team.providerId = 'CD_T999'; }),
    });
    expect(byId(team).team_coverage.ok).toBe(false);
    expect(byId(team).team_coverage.detail).toContain('CD_T999');
    const round = assessAflApiCutoverReadiness(2026, {
      ...real, seasonFeed: feedWith((b) => { b.matches[5].round.roundNumber = 99; }),
    });
    expect(byId(round).round_coverage.ok).toBe(false);
    expect(byId(round).round_coverage.detail).toContain('round 99');
  });

  it.each([
    ['a truncated feed', (b: FeedBody) => { b.matches.pop(); }, 'pagination_mismatch'],
    ['another season', (b: FeedBody) => { b.matches[0].compSeason.providerId = 'CD_S2025014'; }, 'foreign_comp_season'],
    ['no pagination', (b: FeedBody) => { delete b.meta.pagination; }, 'pagination_missing'],
  ])('%s: season_feed fails and coverage stays unproved', (_label, edit, reason) => {
    const r = assessAflApiCutoverReadiness(2026, { ...real, seasonFeed: feedWith(edit) });
    expect(byId(r).season_feed.ok).toBe(false);
    expect(byId(r).season_feed.detail).toContain(reason);
    expect(byId(r).venue_coverage.detail).toMatch(/^Unproved/);
    expect(r.ready).toBe(false);
  });

  it('a feed that is not JSON fails', () => {
    const r = assessAflApiCutoverReadiness(2026, { ...real, seasonFeed: { path: 'x', text: '{ nope' } });
    expect(byId(r).season_feed.ok).toBe(false);
    expect(r.ready).toBe(false);
  });

  it('2027 (tracked files): NOT READY, each check naming what is missing', () => {
    const r = assessAflApiCutoverReadiness(2027, real);
    expect(r.ready).toBe(false);
    const c = byId(r);
    expect(c.in_progress_season.ok).toBe(false);
    expect(c.in_progress_season.detail).toContain('[2026]');
    expect(c.season_identity.ok).toBe(false);
    expect(c.season_identity.detail).toContain('seasons.2027');
    expect(c.round_vocabulary.ok).toBe(false);
    expect(c.round_vocabulary.detail).toContain('afl_api_2027');
    expect(c.season_feed.ok).toBe(false);
    expect(c.season_feed.detail).toContain('seasons.2027');
  });

  it('a registered 2027 with its own complete, fully mapped feed is REPOSITORY READY', () => {
    const identities = structuredClone(real.identities);
    identities.seasons['2027'] = { compSeasonId: 999, providerId: 'CD_S2027014' };
    const sourceFamilies = structuredClone(real.sourceFamilies);
    sourceFamilies.round_vocabularies.afl_api_2027 = {
      ...structuredClone(sourceFamilies.round_vocabularies.afl_api_2026), season: 2027,
    };
    const feed2027 = feedWith((b) => { for (const m of b.matches) m.compSeason.providerId = 'CD_S2027014'; });
    const inputs = {
      seasons: { in_progress_seasons: [2027] },
      identities, sourceFamilies,
      afltablesNetwork: { status: 'retired', last_season: 2026, decision: 'D-316-1' },
      seasonFeed: feed2027,
    };
    const r = assessAflApiCutoverReadiness(2027, inputs);
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(r.ready).toBe(true);
    expect(r.afltablesNetwork).toBe('retired');
    // The 2026 feed against a 2027 registration is another season's evidence.
    expect(assessAflApiCutoverReadiness(2027, { ...inputs, seasonFeed: real.seasonFeed }).ready).toBe(false);
  });

  it('reports an active switch left behind a rolled register as out_of_bounds', () => {
    const r = assessAflApiCutoverReadiness(2027, { ...real, seasons: { in_progress_seasons: [2027] } });
    expect(r.afltablesNetwork).toBe('out_of_bounds');
  });

  it('missing or garbage inputs fail, never pass', () => {
    const r = assessAflApiCutoverReadiness(2026, {
      seasons: undefined, identities: undefined, sourceFamilies: undefined, afltablesNetwork: undefined,
      seasonFeed: undefined,
    });
    expect(r.ready).toBe(false);
    expect(r.checks.every((c) => !c.ok)).toBe(true);
    expect(r.afltablesNetwork).toBe('retired');
  });

  it('the CLI: REPOSITORY READY only with a feed, never claims the cutover go, prints the venue SQL; 0/1/2', () => {
    mocks.execFile.mockReset();
    const dir = tree('active', {
      'data/reference/afl-api-identities.json': 'data/reference/afl-api-identities.json',
      'data/reference/source-families.json': 'data/reference/source-families.json',
    });
    writeFileSync(path.join(dir, 'feed.json'), feedText);
    const ok = runAflApiCutoverReadiness(['--season', '2026', '--season-feed', 'feed.json'], dir);
    const text = ok.lines.join('\n');
    expect(ok.exitCode).toBe(0);
    expect(text).toContain('VERDICT: REPOSITORY READY');
    expect(text).toContain('NOT the cutover go (D-316-4)');
    expect(text).toContain('not run by this tool');
    expect(text).toMatch(/SELECT count\(\*\) FROM venues WHERE legacy_name IN \(.+\);\s+-- expect \d+/);
    // No feed: NOT READY, never READY.
    expect(runAflApiCutoverReadiness(['--season', '2026'], dir).exitCode).toBe(1);
    expect(runAflApiCutoverReadiness(['--season', '2027', '--season-feed', 'feed.json'], dir).exitCode).toBe(1);
    expect(runAflApiCutoverReadiness([], dir).exitCode).toBe(2);
    expect(runAflApiCutoverReadiness(['--season', '2026', '--season-feed'], dir).exitCode).toBe(2);
    expect(runAflApiCutoverReadiness(['--season', '2026', '--season-feed', 'absent.json'], dir).exitCode).toBe(2);
    // Every file missing: NOT READY, never READY.
    expect(runAflApiCutoverReadiness(['--season', '2026'], tree('missing')).exitCode).toBe(1);
    expect(mocks.execFile).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * C4b: the D1 rehearsal restores the setting however it ends
 * ------------------------------------------------------------------ */

describe('C4b rehearsal (AFLDB-ISSUE-316 §7): the setting is restored however the run ends', () => {
  const ACQ_OK = 'AFLDB-ISSUE-228 acquire — season 2027 (compSeasonId 99), label 20270301T000000Z\n';
  const DRY_OK = ['', 'Season feed', '  seasonFeedComplete: true', 'Canonical',
    '  canonicalRowsInserted: 0', '  canonicalRowsUpdated: 0'].join('\n');
  const OFF: SettingValue = { present: true, value: 'false' };
  const baseFiles = (): Record<string, string> => ({
    'data/reference/seasons.json': JSON.stringify({ in_progress_seasons: [2027] }),
    'data/reference/afltables-network.json': JSON.stringify({ status: 'retired', last_season: 2026, decision: 'D-316-1' }),
    [AFL_API_SERVICE_FILE]: read(AFL_API_SERVICE_FILE),
  });
  type Opts = {
    setting?: SettingValue;
    files?: Record<string, string | undefined>;
    steps?: Partial<Record<string, (abort: AbortSignal) => StepResult | Promise<StepResult>>>;
    afterRecord?: Partial<RehearsalRecord>;
    deps?: Partial<C4bDeps>;
  };

  function harness(opts: Opts = {}) {
    const events: string[] = [];
    const state = {
      setting: opts.setting ?? OFF,
      writes: [] as boolean[],
      interrupt: null as null | ((signal: string) => void),
      deadline: null as null | (() => void),
      evidence: {} as Record<string, string>,
      records: 0,
    };
    const files = { ...baseFiles(), ...opts.files };
    const deps: C4bDeps = {
      log: () => {},
      projectFile: (rel) => files[rel],
      systemctl: (verb, unit) => {
        events.push(`systemctl ${verb} ${unit}`);
        return verb === 'is-enabled' ? 'disabled' : 'inactive';
      },
      sameDatabase: async () => {},
      readSetting: async () => state.setting,
      controlSeesEnabled: async () => state.setting.present && state.setting.value === 'true',
      writeSetting: async (enabled) => {
        events.push(`write ${enabled}`);
        state.writes.push(enabled);
        state.setting = { present: true, value: String(enabled) };
      },
      record: async () => {
        events.push('record');
        state.records += 1;
        const base: RehearsalRecord = {
          matchesInSeason: 0,
          aflApiOwnedMatches: 0,
          acquisitionSettings: {
            'acquisition.afl_api_brownlow_enabled': 'false',
            ...(state.setting.present ? { [C4B_SETTING_KEY]: state.setting.value } : {}),
          },
        };
        return state.records > 1 ? { ...base, ...opts.afterRecord } : base;
      },
      runStep: async (script, argv, abort) => {
        events.push(`step ${script} ${argv.join(' ')}`);
        const step = opts.steps?.[script];
        if (step) return step(abort);
        return { exitCode: 0, signal: null, output: script === ACQUIRE_SCRIPT ? ACQ_OK : DRY_OK };
      },
      readiness: (_season, feedPath) => {
        events.push(`readiness ${feedPath}`);
        return { exitCode: 0, lines: ['VERDICT: REPOSITORY READY'] };
      },
      armWatchdog: async () => { events.push('watchdog'); },
      markRestoreVerified: () => { events.push('marker'); },
      writeEvidence: (name, content) => { state.evidence[name] = content; },
      onInterrupt: (handler) => {
        state.interrupt = handler;
        return () => { state.interrupt = null; };
      },
      scheduleDeadline: (_ms, fn) => {
        state.deadline = fn;
        return () => { state.deadline = null; };
      },
      now: () => new Date('2027-02-01T00:00:00Z'),
      sleep: async () => {},
      ...opts.deps,
    };
    return { deps, events, state };
  }
  const run = (h: ReturnType<typeof harness>) => runC4bRehearsal({ season: 2027, maxMinutes: 30, runId: 'test' }, h.deps);
  const writes = (h: ReturnType<typeof harness>) => h.events.filter((e) => e.startsWith('write '));
  /** Records every evidence write in `events`, so a test can prove the setting was restored before `result.json`. */
  const recordEvidenceOrder = (h: ReturnType<typeof harness>): void => {
    const real = h.deps.writeEvidence;
    h.deps.writeEvidence = (name, content) => {
      h.events.push(`evidence ${name}`);
      real(name, content);
    };
  };
  const restoredBeforeResult = (h: ReturnType<typeof harness>): boolean => {
    const off = h.events.lastIndexOf('write false');
    const marker = h.events.indexOf('marker');
    const result = h.events.indexOf('evidence result.json');
    return off >= 0 && marker > off && result > marker;
  };

  it('success: preconditions, BEFORE, watchdog, on, acquire, dry-run settle, off and verified, then the checks', async () => {
    const h = harness();
    const outcome = await run(h);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.verdict).toBe('CLEAR');
    expect(outcome.reasons.join(' ')).toContain('not the record');
    const order = h.events.filter((e) => !e.startsWith('systemctl'));
    expect(order).toEqual([
      'record', 'watchdog', 'write true',
      `step ${ACQUIRE_SCRIPT} --season 2027`,
      `step ${SETTLE_SCRIPT} --label 20270301T000000Z --dry-run --auto-apply --require-complete-source`,
      'write false', 'marker', 'record',
      'readiness data/sources/afl_api/matches/20270301T000000Z/00-season-matches.json',
    ]);
    expect(h.state.setting).toEqual(OFF);
    // Only read-only systemctl verbs, before and after.
    expect(h.events.filter((e) => e.startsWith('systemctl')).every((e) => /^systemctl is-(enabled|active) /.test(e))).toBe(true);
    expect(h.events.filter((e) => e.startsWith('systemctl is-enabled'))).toHaveLength(4);
    expect(Object.keys(h.state.evidence).sort()).toEqual(
      ['acquire.log', 'after.json', 'before.json', 'readiness.txt', 'result.json', 'settle-dry-run.log']);
    expect(h.state.interrupt).toBeNull();
    expect(h.state.deadline).toBeNull();
  });

  it.each([
    ['the acquisition fails', { [ACQUIRE_SCRIPT]: () => ({ exitCode: 1, signal: null, output: 'boom' }) }, /acquire-afl-api.ts ended with exit 1/, false],
    ['the dry-run settle fails', { [SETTLE_SCRIPT]: () => ({ exitCode: 1, signal: null, output: 'refused' }) }, /settle-afl-api.ts --dry-run ended with exit 1/, true],
    ['a step throws', { [ACQUIRE_SCRIPT]: () => { throw new Error('postgres://u:secret@h/db'); } }, /stopped on a database or process error/, false],
    ['the acquisition prints no label (early exit)', { [ACQUIRE_SCRIPT]: () => ({ exitCode: 0, signal: null, output: 'nothing' }) }, /could not determine the acquired snapshot label/, false],
  ])('%s: HALT, the setting is written off and verified', async (_label, steps, reason, settleRan) => {
    const h = harness({ steps });
    const outcome = await run(h);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.verdict).toBe('HALT');
    expect(outcome.reasons.join('\n')).toMatch(reason);
    expect(outcome.reasons.join('\n')).not.toContain('secret');
    expect(writes(h)).toEqual(['write true', 'write false']);
    expect(h.events).toContain('marker');
    expect(h.state.setting).toEqual(OFF);
    expect(h.events.some((e) => e.startsWith(`step ${SETTLE_SCRIPT}`))).toBe(settleRan);
  });

  it.each(['SIGINT', 'SIGTERM', 'SIGHUP'])('interrupted by %s during the acquisition: the step is aborted, then restored', async (signal) => {
    let aborted = false;
    const h = harness({
      steps: {
        [ACQUIRE_SCRIPT]: (abort) => {
          h.state.interrupt!(signal);
          aborted = abort.aborted;
          return { exitCode: null, signal, output: '' };
        },
      },
    });
    const outcome = await run(h);
    expect(aborted).toBe(true);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.reasons[0]).toBe(`interrupted by ${signal}`);
    expect(writes(h)).toEqual(['write true', 'write false']);
    expect(h.events.some((e) => e.startsWith(`step ${SETTLE_SCRIPT}`))).toBe(false);
    expect(h.state.setting).toEqual(OFF);
  });

  it('interrupted between the steps: the settle never starts; a second signal during restore changes nothing', async () => {
    const h = harness({
      steps: { [ACQUIRE_SCRIPT]: () => { h.state.interrupt!('SIGINT'); return { exitCode: 0, signal: null, output: ACQ_OK }; } },
      deps: {
        writeSetting: async (enabled) => {
          if (!enabled) h.state.interrupt?.('SIGTERM');
          h.events.push(`write ${enabled}`);
          h.state.setting = { present: true, value: String(enabled) };
        },
      },
    });
    const outcome = await run(h);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.reasons[0]).toBe('interrupted by SIGINT');
    expect(h.events.some((e) => e.startsWith(`step ${SETTLE_SCRIPT}`))).toBe(false);
    expect(h.state.setting).toEqual(OFF);
  });

  it('the deadline stops the run and restores', async () => {
    const h = harness({
      steps: { [ACQUIRE_SCRIPT]: (abort) => { h.state.deadline!(); return { exitCode: null, signal: abort.aborted ? 'SIGTERM' : null, output: '' }; } },
    });
    const outcome = await run(h);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.reasons[0]).toBe('the 30-minute deadline was reached');
    expect(h.state.setting).toEqual(OFF);
  });

  it('a turn-on write that fails after committing is still restored', async () => {
    const h = harness({
      deps: {
        writeSetting: async (enabled) => {
          h.events.push(`write ${enabled}`);
          h.state.setting = { present: true, value: String(enabled) };
          if (enabled) throw Object.assign(new Error('connection lost'), { code: 'ECONNRESET' });
        },
      },
    });
    const outcome = await run(h);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.reasons.join(' ')).toContain('(ECONNRESET)');
    expect(writes(h)).toEqual(['write true', 'write false']);
    expect(h.state.setting).toEqual(OFF);
  });

  it.each([
    ['every write fails', (h: ReturnType<typeof harness>) => async (enabled: boolean) => {
      h.events.push(`write ${enabled}`);
      if (enabled) h.state.setting = { present: true, value: 'true' };
      else throw new Error('down');
    }],
    ['the write lands but the setting still reads on', (h: ReturnType<typeof harness>) => async (enabled: boolean) => {
      h.events.push(`write ${enabled}`);
      h.state.setting = { present: true, value: 'true' };
    }],
  ])('restoration not verified (%s): exit 3, three attempts, no marker so the watchdog stays armed', async (_label, writer) => {
    const h = harness();
    h.deps.writeSetting = writer(h);
    const outcome = await run(h);
    expect(outcome.exitCode).toBe(3);
    expect(outcome.verdict).toBe('RESTORATION NOT VERIFIED');
    expect(outcome.reasons[0]).toContain('MAY STILL BE ON');
    expect(outcome.reasons[0]).toContain('--restore-only');
    expect(writes(h)).toEqual(['write true', 'write false', 'write false', 'write false']);
    expect(h.events).not.toContain('marker');
    expect(h.events.filter((e) => e === 'record')).toHaveLength(1);
  });

  it.each([
    ['an AFL API timer is enabled', { deps: { systemctl: (verb: string, unit: string) => (verb === 'is-enabled' && unit === 'afldb-settle-afl-api.timer' ? 'enabled' : verb === 'is-enabled' ? 'disabled' : 'inactive') } }, /afldb-settle-afl-api.timer is enabled/],
    ['the Brownlow service is running', { deps: { systemctl: (verb: string, unit: string) => (verb === 'is-enabled' ? 'disabled' : unit === 'afldb-settle-afl-api-brownlow.service' ? 'active' : 'inactive') } }, /brownlow.service is active/],
    ['systemctl cannot answer', { deps: { systemctl: () => 'unknown (exit null)' } }, /not disabled \/ inactive/],
    ['the setting is already on', { setting: { present: true, value: 'true' } as SettingValue }, /is true; it must be absent or false/],
    ['the setting is malformed', { setting: { present: true, value: '"yes"' } as SettingValue }, /is "yes"; it must be absent or false/],
    ['the register is still [2026]', { files: { 'data/reference/seasons.json': JSON.stringify({ in_progress_seasons: [2026] }) } }, /not \[2027\] \(the C2 rollover writes this register: C2 not deployed\?\)/],
    ['the AFL Tables switch is not retired', { files: { 'data/reference/afltables-network.json': JSON.stringify({ status: 'active', last_season: 2027 }) } }, /not an explicit 'retired'/],
    ['the AFL Tables switch is missing', { files: { 'data/reference/afltables-network.json': undefined } }, /not an explicit 'retired'/],
    ['the unit file has no UnsetEnvironment', { files: { [AFL_API_SERVICE_FILE]: '[Service]\n' } }, /no UnsetEnvironment= line/],
    ['the writer and control databases differ', { deps: { sameDatabase: async () => { throw new Error('x'); } } }, /could not be proved/],
    ['the control path cannot be read', { deps: { controlSeesEnabled: async () => { throw new Error('x'); } } }, /could not be proved/],
    ['the BEFORE record cannot be read', { deps: { record: async () => { throw new Error('x'); } } }, /BEFORE record could not be read/],
    ['the watchdog cannot be armed', { deps: { armWatchdog: () => { throw new Error('x'); } } }, /watchdog could not be armed/],
  ])('refuses before any write when %s', async (_label, opts, reason) => {
    const h = harness(opts as Opts);
    const outcome = await run(h);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.verdict).toBe('REFUSED');
    expect(outcome.reasons.join('\n')).toMatch(reason);
    expect(writes(h)).toEqual([]);
    expect(h.events.some((e) => e.startsWith('step '))).toBe(false);
  });

  describe('evidence that cannot be written: refusals and restoration keep their exit codes, a CLEAR needs its evidence', () => {
    /** Writes evidence normally except for the named files, which fail like a full or unwritable disk. */
    const failOn = (h: ReturnType<typeof harness>, ...names: string[]) => (name: string, content: string): void => {
      if (names.includes(name)) throw Object.assign(new Error("ENOSPC: no space left on device, write '/secret/path'"), { code: 'ENOSPC' });
      h.state.evidence[name] = content;
    };
    const logged = (h: ReturnType<typeof harness>): string[] => {
      const lines: string[] = [];
      h.deps.log = (line) => { lines.push(line); };
      return lines;
    };
    const noStep = (h: ReturnType<typeof harness>) => h.events.some((e) => e.startsWith('step '));

    it.each([
      ['a precondition fails', { files: { 'data/reference/seasons.json': JSON.stringify({ in_progress_seasons: [2026] }) } }, /not \[2027\]/],
      ['the BEFORE record cannot be read', { deps: { record: async () => { throw new Error('x'); } } }, /BEFORE record could not be read/],
      ['the watchdog cannot be armed', { deps: { armWatchdog: async () => { throw new Error('x'); } } }, /watchdog could not be armed/],
    ])('a refusal when %s stays exit 2 though result.json cannot be written: no rejection, no setting write, no step', async (_label, opts, reason) => {
      const h = harness(opts as Opts);
      const lines = logged(h);
      h.deps.writeEvidence = failOn(h, 'result.json');
      const outcome = await run(h);
      expect(outcome).toMatchObject({ exitCode: 2, verdict: 'REFUSED' });
      expect(outcome.evidenceError).toBe('result.json could not be written: a database or process error (ENOSPC)');
      expect(outcome.reasons.join('\n')).toMatch(reason);
      expect(writes(h)).toEqual([]);
      expect(h.state.writes).toEqual([]);
      expect(noStep(h)).toBe(false);
      expect(h.state.evidence['result.json']).toBeUndefined();
      expect(lines.join('\n')).toContain('result.json could not be written: a database or process error (ENOSPC)');
      expect(lines.join('\n')).not.toContain('/secret/path');
    });

    it('a refusal stays exit 2 when no evidence can be written at all', async () => {
      const h = harness({ files: { 'data/reference/seasons.json': JSON.stringify({ in_progress_seasons: [2026] }) } });
      h.deps.writeEvidence = () => { throw new Error('read-only file system'); };
      const outcome = await run(h);
      expect(outcome).toMatchObject({ exitCode: 2, verdict: 'REFUSED' });
      expect(writes(h)).toEqual([]);
      expect(noStep(h)).toBe(false);
    });

    it('a BEFORE record that cannot be saved is a refusal before the watchdog and any setting write', async () => {
      const h = harness();
      h.deps.writeEvidence = failOn(h, 'before.json');
      const outcome = await run(h);
      expect(outcome).toMatchObject({ exitCode: 2, verdict: 'REFUSED' });
      expect(outcome.reasons.join('\n')).toMatch(/the BEFORE record could not be saved as evidence: before.json could not be written/);
      expect(h.events).not.toContain('watchdog');
      expect(writes(h)).toEqual([]);
      expect(noStep(h)).toBe(false);
      expect(h.state.evidence['result.json']).toContain('REFUSED');
    });

    it('a nominally successful run whose result.json cannot be written is a HALT, never exit 0, and the setting is restored', async () => {
      const h = harness();
      const lines = logged(h);
      h.deps.writeEvidence = failOn(h, 'result.json');
      const outcome = await run(h);
      expect(outcome).toMatchObject({ exitCode: 1, verdict: 'HALT' });
      expect(outcome.reasons[0]).toMatch(/result.json could not be written.*requires reviewable evidence.*not a CLEAR/);
      expect(outcome.evidenceError).toContain('result.json could not be written');
      expect(writes(h)).toEqual(['write true', 'write false']);
      expect(h.events).toContain('marker');
      expect(h.state.setting).toEqual(OFF);
      expect(lines.join('\n')).toContain('C4B HALT');
      expect(lines.join('\n')).not.toContain('C4B CLEAR');
    });

    it.each([
      ['acquire.log', false],
      ['settle-dry-run.log', true],
      ['after.json', true],
      ['readiness.txt', true],
    ])('%s that cannot be written is a HALT, further steps stop, and the setting is still restored', async (name, settleRan) => {
      const h = harness();
      h.deps.writeEvidence = failOn(h, name);
      const outcome = await run(h);
      expect(outcome).toMatchObject({ exitCode: 1, verdict: 'HALT' });
      expect(outcome.reasons.join('\n')).toContain(`${name} could not be written: a database or process error (ENOSPC)`);
      expect(writes(h)).toEqual(['write true', 'write false']);
      expect(h.events).toContain('marker');
      expect(h.state.setting).toEqual(OFF);
      expect(h.events.some((e) => e.startsWith(`step ${SETTLE_SCRIPT}`))).toBe(settleRan);
      expect(h.state.interrupt).toBeNull();
      expect(h.state.deadline).toBeNull();
    });

    it('a restore-verified marker that cannot be written is a HALT; the verified restore and the handlers stand', async () => {
      const h = harness();
      h.deps.markRestoreVerified = () => { throw new Error('read-only file system'); };
      const outcome = await run(h);
      expect(outcome).toMatchObject({ exitCode: 1, verdict: 'HALT' });
      expect(outcome.reasons.join('\n')).toMatch(/restore-verified.json could not be written.*already false/s);
      expect(writes(h)).toEqual(['write true', 'write false']);
      expect(h.state.setting).toEqual(OFF);
      expect(h.state.interrupt).toBeNull();
      expect(h.state.deadline).toBeNull();
    });

    it('an unverified restoration stays exit 3 though result.json cannot be written', async () => {
      const h = harness();
      h.deps.writeSetting = async (enabled) => {
        h.events.push(`write ${enabled}`);
        if (enabled) h.state.setting = { present: true, value: 'true' };
        else throw new Error('down');
      };
      h.deps.writeEvidence = failOn(h, 'result.json');
      const outcome = await run(h);
      expect(outcome).toMatchObject({ exitCode: 3, verdict: 'RESTORATION NOT VERIFIED' });
      expect(outcome.reasons[0]).toContain('MAY STILL BE ON');
      expect(outcome.evidenceError).toContain('result.json could not be written');
      expect(h.events).not.toContain('marker');
    });

    it('a HALT stays exit 1 though result.json cannot be written', async () => {
      const h = harness({ steps: { [ACQUIRE_SCRIPT]: () => ({ exitCode: 1, signal: null, output: 'boom' }) } });
      h.deps.writeEvidence = failOn(h, 'result.json');
      const outcome = await run(h);
      expect(outcome).toMatchObject({ exitCode: 1, verdict: 'HALT' });
      expect(outcome.reasons.join('\n')).toMatch(/acquire-afl-api.ts ended with exit 1/);
      expect(outcome.evidenceError).toContain('result.json');
      expect(h.state.setting).toEqual(OFF);
    });

    it('a log that throws changes nothing', async () => {
      const h = harness();
      h.deps.log = () => { throw new Error('terminal lost'); };
      const outcome = await run(h);
      expect(outcome).toMatchObject({ exitCode: 0, verdict: 'CLEAR' });
      expect(writes(h)).toEqual(['write true', 'write false']);
    });
  });

  describe('a step that cannot be confirmed stopped, and dependencies that throw', () => {
    const unconfirmed = (): StepResult => ({ exitCode: null, signal: null, output: '', unconfirmed: true });

    it.each([
      [ACQUIRE_SCRIPT, 'acquire-afl-api.ts could not be confirmed stopped; it may still be running (check the host for a stray acquire-afl-api.ts process)', false],
      [SETTLE_SCRIPT, 'settle-afl-api.ts --dry-run could not be confirmed stopped; it may still be running (check the host for a stray settle-afl-api.ts process)', true],
    ])('%s unconfirmed: a HALT naming it, the setting still restored, no later step', async (script, reason, settleRan) => {
      const h = harness({ steps: { [script]: unconfirmed } });
      const outcome = await run(h);
      expect(outcome).toMatchObject({ exitCode: 1, verdict: 'HALT' });
      expect(outcome.reasons).toContain(reason);
      expect(outcome.reasons.join('\n')).not.toMatch(/ended with exit null/);
      expect(writes(h)).toEqual(['write true', 'write false']);
      expect(h.state.setting).toEqual(OFF);
      expect(h.events).toContain('marker');
      expect(h.events.some((e) => e.startsWith(`step ${SETTLE_SCRIPT}`))).toBe(settleRan);
    });

    it.each([
      ['acquire', ACQUIRE_SCRIPT, 'SIGSEGV', 'acquire-afl-api.ts ended SIGSEGV', false],
      ['dry-run settle', SETTLE_SCRIPT, 'SIGKILL', 'settle-afl-api.ts --dry-run ended SIGKILL', true],
    ])('a %s that ends by signal is a HALT, restored (with its marker) before the result, and nothing later runs', async (_n, script, signal, reason, settleRan) => {
      const h = harness({ steps: { [script]: () => ({ exitCode: null, signal, output: 'partial' }) } });
      recordEvidenceOrder(h);
      const outcome = await run(h);
      expect(outcome).toMatchObject({ exitCode: 1, verdict: 'HALT' });
      expect(outcome.reasons).toContain(reason);
      expect(writes(h)).toEqual(['write true', 'write false']);
      expect(h.state.setting).toEqual(OFF);
      expect(restoredBeforeResult(h)).toBe(true);
      expect(h.events.some((e) => e.startsWith(`step ${SETTLE_SCRIPT}`))).toBe(settleRan);
      // A signal-ended acquire gives no label, so neither the settle nor the readiness evaluation starts.
      expect(h.events.some((e) => e.startsWith('readiness'))).toBe(settleRan);
    });

    it.each([
      ['acquire', ACQUIRE_SCRIPT],
      ['dry-run settle', SETTLE_SCRIPT],
    ])('an unconfirmed %s is restored (with its marker) before the result and stays identified for the operator', async (_n, script) => {
      const h = harness({ steps: { [script]: unconfirmed } });
      recordEvidenceOrder(h);
      const outcome = await run(h);
      expect(outcome).toMatchObject({ exitCode: 1, verdict: 'HALT' });
      expect(restoredBeforeResult(h)).toBe(true);
      const named = script === ACQUIRE_SCRIPT ? 'acquire-afl-api.ts' : 'settle-afl-api.ts';
      expect(outcome.reasons.some((r) => r.includes(`could not be confirmed stopped; it may still be running (check the host for a stray ${named} process)`))).toBe(true);
      expect(JSON.parse(h.state.evidence['result.json']).reasons.join('\n')).toContain(`stray ${named} process`);
    });

    it('an unconfirmed step is still exit 3 when the restore cannot be verified', async () => {
      const h = harness({ steps: { [ACQUIRE_SCRIPT]: unconfirmed } });
      h.deps.writeSetting = async (enabled) => {
        h.events.push(`write ${enabled}`);
        if (enabled) h.state.setting = { present: true, value: 'true' };
        else throw new Error('down');
      };
      const outcome = await run(h);
      expect(outcome).toMatchObject({ exitCode: 3, verdict: 'RESTORATION NOT VERIFIED' });
      expect(outcome.reasons.join('\n')).toContain('could not be confirmed stopped');
    });

    const thrower = (): never => {
      throw Object.assign(new Error('postgres://u:secret@h/db'), { code: 'EPERM' });
    };

    it('systemd state that cannot be read after the restore is a HALT reason: exit 1, setting off, recorded, no driver text', async () => {
      const h = harness();
      const real = h.deps.systemctl;
      h.deps.systemctl = (verb, unit) => (h.state.writes.length >= 2 ? thrower() : real(verb, unit));
      const outcome = await run(h);
      expect(outcome).toMatchObject({ exitCode: 1, verdict: 'HALT' });
      expect(outcome.reasons).toContain('AFTER: the state of afldb-settle-afl-api.timer could not be read: a database or process error (EPERM)');
      expect(outcome.reasons).toContain('AFTER: the state of afldb-settle-afl-api-brownlow.timer could not be read: a database or process error (EPERM)');
      expect(writes(h)).toEqual(['write true', 'write false']);
      expect(h.state.setting).toEqual(OFF);
      expect(JSON.parse(h.state.evidence['result.json']).reasons.join('\n')).toContain('could not be read');
      expect(JSON.stringify(outcome)).not.toContain('secret');
    });

    it('readiness that throws after the restore is a HALT reason: exit 1, setting off, recorded, no driver text', async () => {
      const h = harness();
      h.deps.readiness = thrower;
      const outcome = await run(h);
      expect(outcome).toMatchObject({ exitCode: 1, verdict: 'HALT' });
      expect(outcome.reasons).toContain('readiness against the acquired feed could not be evaluated: a database or process error (EPERM)');
      expect(writes(h)).toEqual(['write true', 'write false']);
      expect(h.state.setting).toEqual(OFF);
      expect(h.state.evidence['result.json']).toContain('could not be evaluated');
      expect(JSON.stringify(outcome)).not.toContain('secret');
    });

    it('readiness that throws is still exit 1 when result.json cannot be written either', async () => {
      const h = harness();
      h.deps.readiness = thrower;
      h.deps.writeEvidence = (name, content) => {
        if (name === 'result.json') throw new Error('read-only file system');
        h.state.evidence[name] = content;
      };
      const outcome = await run(h);
      expect(outcome).toMatchObject({ exitCode: 1, verdict: 'HALT' });
      expect(outcome.evidenceError).toContain('result.json could not be written');
      expect(h.state.setting).toEqual(OFF);
    });

    it('systemd state that cannot be read before any write is a refusal: exit 2, no write, no step', async () => {
      const h = harness();
      h.deps.systemctl = thrower;
      const outcome = await run(h);
      expect(outcome).toMatchObject({ exitCode: 2, verdict: 'REFUSED' });
      expect(outcome.reasons.join('\n')).toContain('the state of afldb-settle-afl-api.timer could not be read: a database or process error (EPERM)');
      expect(outcome.reasons.join('\n')).toContain('the state of afldb-settle-afl-api.service could not be read');
      expect(h.state.writes).toEqual([]);
      expect(h.events.some((e) => e.startsWith('step '))).toBe(false);
      expect(JSON.stringify(outcome)).not.toContain('secret');
    });
  });

  it('an absent setting is an acceptable BEFORE; it is restored to exactly false', async () => {
    const h = harness({ setting: { present: false } });
    expect((await run(h)).exitCode).toBe(0);
    expect(h.state.setting).toEqual(OFF);
  });

  it.each([
    ['canonical rows inserted', { [SETTLE_SCRIPT]: () => ({ exitCode: 0, signal: null, output: DRY_OK.replace('canonicalRowsInserted: 0', 'canonicalRowsInserted: 1') }) }, {}, /canonicalRowsInserted is 1, not 0/],
    ['canonical rows updated', { [SETTLE_SCRIPT]: () => ({ exitCode: 0, signal: null, output: DRY_OK.replace('canonicalRowsUpdated: 0', 'canonicalRowsUpdated: 2') }) }, {}, /canonicalRowsUpdated is 2, not 0/],
    ['no dry-run report', { [SETTLE_SCRIPT]: () => ({ exitCode: 0, signal: null, output: 'ok' }) }, {}, /no canonicalRowsInserted line/],
    ['an incomplete season feed', { [SETTLE_SCRIPT]: () => ({ exitCode: 0, signal: null, output: DRY_OK.replace('seasonFeedComplete: true', 'seasonFeedComplete: false') }) }, {}, /seasonFeedComplete false/],
    ['a canonical change between BEFORE and AFTER', {}, { afterRecord: { aflApiOwnedMatches: 1 } }, /afl_api-owned matches: BEFORE 0, AFTER 1/],
    ['another acquisition setting changed', {}, { afterRecord: { acquisitionSettings: { 'acquisition.afl_api_brownlow_enabled': 'true', [C4B_SETTING_KEY]: 'false' } } }, /afl_api_brownlow_enabled: BEFORE false, AFTER true/],
  ])('HALT on %s, with the setting already off', async (_label, steps, extra, reason) => {
    const h = harness({ steps, ...extra } as Opts);
    const outcome = await run(h);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.reasons.join('\n')).toMatch(reason);
    expect(h.state.setting).toEqual(OFF);
  });

  it('HALT when a timer is enabled AFTER, or readiness on the acquired feed is NOT READY', async () => {
    const h = harness({
      deps: {
        // Enabled only once the setting has been restored, i.e. in the AFTER check.
        systemctl: (verb, unit) => (verb !== 'is-enabled' ? 'inactive'
          : unit === 'afldb-settle-afl-api.timer' && h.state.writes.includes(false) ? 'enabled' : 'disabled'),
        readiness: () => ({ exitCode: 1, lines: ['VERDICT: NOT READY'] }),
      },
    });
    const outcome = await run(h);
    expect(outcome.exitCode).toBe(1);
    const text = outcome.reasons.join('\n');
    expect(text).toMatch(/AFTER: afldb-settle-afl-api.timer is enabled/);
    expect(text).toMatch(/readiness against the acquired feed exited 1/);
  });

  it('recordDifferences: the toggled setting may only go from absent or false to exactly false', () => {
    const r = (setting?: string): RehearsalRecord => ({
      matchesInSeason: 3, aflApiOwnedMatches: 0,
      acquisitionSettings: setting === undefined ? {} : { [C4B_SETTING_KEY]: setting },
    });
    expect(recordDifferences(r(), r('false'))).toEqual([]);
    expect(recordDifferences(r('false'), r('false'))).toEqual([]);
    expect(recordDifferences(r('false'), r('true'))).toHaveLength(1);
    expect(recordDifferences(r('false'), r())).toHaveLength(1);
    expect(recordDifferences(r('true'), r('false'))).toHaveLength(1);
    expect(recordDifferences({ ...r('false'), matchesInSeason: 4 }, r('false'))[0]).toContain('BEFORE 4, AFTER 3');
  });

  it('parses its arguments strictly: exactly D-316-13, a season, an evidence directory, a bounded deadline', () => {
    const ok = ['--season', '2027', '--decision', C4B_DECISION, '--evidence-dir', 'ev'];
    expect(parseC4bArgs(ok)).toEqual({ mode: 'rehearse', season: 2027, evidenceDir: 'ev', maxMinutes: 30 });
    expect(parseC4bArgs([...ok, '--max-minutes', '45'])).toMatchObject({ maxMinutes: 45 });
    for (const decision of ['D-316-1', 'D-316-2', 'D-999-13', 'd-316-13', 'D-316-13 ']) {
      expect(() => parseC4bArgs(['--season', '2027', '--decision', decision, '--evidence-dir', 'ev']))
        .toThrow(/must be exactly D-316-13/);
    }
    expect(() => parseC4bArgs(['--season', '2027', '--evidence-dir', 'ev'])).toThrow(/must be exactly D-316-13/);
    expect(() => parseC4bArgs([...ok, '--decision', C4B_DECISION])).toThrow(/more than once/);
    expect(() => parseC4bArgs(['--season', '2026', '--decision', C4B_DECISION, '--evidence-dir', 'ev'])).toThrow(/--season/);
    expect(() => parseC4bArgs(['--season', '2027', '--decision', C4B_DECISION])).toThrow(/--evidence-dir/);
    for (const m of ['4', '121', '2.5', 'x']) expect(() => parseC4bArgs([...ok, '--max-minutes', m])).toThrow(/--max-minutes/);
    expect(parseC4bArgs(['--restore-only', '--evidence-dir', 'ev'])).toEqual({ mode: 'restore-only', evidenceDir: 'ev' });
  });

  it('parses the watchdog arguments strictly: parent PID, deadline, evidence directory and a well-formed run id', () => {
    const wd = ['--watchdog', '--parent-pid', '4242', '--deadline', '2027-02-01T00:30:00Z', '--evidence-dir', 'ev', '--run-id', 'run-1'];
    expect(parseC4bArgs(wd)).toEqual({
      mode: 'watchdog', evidenceDir: 'ev', parentPid: 4242, deadline: new Date('2027-02-01T00:30:00Z'), runId: 'run-1',
    });
    const without = (flag: string) => wd.filter((_, i) => wd[i] !== flag && wd[i - 1] !== flag);
    for (const flag of ['--parent-pid', '--deadline', '--run-id']) {
      expect(() => parseC4bArgs(without(flag))).toThrow(/--watchdog needs/);
    }
    for (const bad of ['a b', '../x', '', 'x'.repeat(81)]) {
      expect(() => parseC4bArgs([...without('--run-id'), '--run-id', bad])).toThrow(/--watchdog needs/);
    }
  });

  it("the steps get the AFL API unit's narrowed environment, never the auth DSN", () => {
    const env = childEnvironment({
      DATABASE_URL: 'a', AFLDB_IMPORT_DATABASE_URL: 'b', AFLDB_AUTH_DATABASE_URL: 'c',
      AFLDB_OWNER_DATABASE_URL: 'd', AFLDB_REVALIDATE_SECRET: 'e', PATH: '/bin',
    }, read(AFL_API_SERVICE_FILE));
    expect(env).toEqual({ DATABASE_URL: 'a', AFLDB_IMPORT_DATABASE_URL: 'b', PATH: '/bin', AFLDB_SKIP_DOTENV: '1' });
    expect(() => childEnvironment({}, undefined)).toThrow(/UnsetEnvironment/);
  });

  it('the tool source runs only read-only systemctl verbs and never settles with --apply', () => {
    const src = read('tools/current-season/afl-api-c4b-rehearsal.ts');
    expect(src.match(/spawnSync\('systemctl'/g)).toHaveLength(1);
    expect(src).toContain("verb: 'is-enabled' | 'is-active'");
    expect(src).not.toMatch(/'(enable|disable|start|stop|restart)'/);
    expect(src).not.toMatch(/'--apply'/);
  });

  describe('watchdog startup handshake: the parent waits for proof, never for a PID alone', () => {
    const READY = (over: Record<string, unknown> = {}): string => `${JSON.stringify({
      kind: WATCHDOG_READY_KIND, runId: 'run-1', watchdogPid: 777, parentPid: 100, at: '2027-02-01T00:00:00.000Z', ...over,
    })}\n`;
    const EXPECTED = { runId: 'run-1', watchdogPid: 777, parentPid: 100 };

    type ArmState = { marker: string | undefined; alive: boolean; readFails: boolean };
    type ArmScript = {
      marker?: string;
      onPoll?: (poll: number, state: ArmState) => void;
      launchThrows?: boolean;
      afterLaunchThrows?: boolean;
      /** Makes the log call throw when its line contains this text. */
      logThrowsOn?: string;
      stopFails?: boolean;
      standDownFails?: boolean;
    };
    function armHarness(script: ArmScript = {}) {
      const state: ArmState = { marker: script.marker, alive: true, readFails: false };
      const log: string[] = [];
      const calls = {
        launch: 0,
        afterLaunch: 0,
        stop: 0,
        standDown: [] as Array<{ runId: string; watchdogPid: number | null; reason: string }>,
      };
      let clock = 0;
      let polls = 0;
      const effects: ArmEffects = {
        runId: 'run-1',
        parentPid: 100,
        readMarker: () => {
          if (state.readFails) throw Object.assign(new Error('denied'), { code: 'EACCES' });
          return state.marker;
        },
        watchdogAlive: () => state.alive,
        now: () => new Date(Date.UTC(2027, 1, 1) + clock),
        sleep: async (ms) => { clock += ms; polls += 1; script.onPoll?.(polls, state); },
        log: (line) => {
          if (script.logThrowsOn && line.includes(script.logThrowsOn)) throw new Error('terminal lost');
          log.push(line);
        },
        launch: () => {
          calls.launch += 1;
          if (script.launchThrows) throw new Error('spawn failed');
          return {
            pid: 777,
            stop: async () => {
              calls.stop += 1;
              if (script.stopFails) return false;
              state.alive = false;
              return true;
            },
          };
        },
        afterLaunch: () => {
          calls.afterLaunch += 1;
          if (script.afterLaunchThrows) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
        },
        writeStandDown: (detail) => {
          if (script.standDownFails) throw new Error('read-only');
          calls.standDown.push(detail);
        },
      };
      return { effects, state, calls, log, elapsed: () => clock };
    }

    it.each([
      ['absent', undefined, 'pending'],
      ['exact', READY(), 'ready'],
      ['another run', READY({ runId: 'run-0' }), /another run/],
      ['the wrong watchdog PID', READY({ watchdogPid: 776 }), /watchdog PID 776, not 777/],
      ['the watchdog PID as a string', READY({ watchdogPid: '777' }), /watchdog PID "777"/],
      ['no watchdog PID', READY({ watchdogPid: undefined }), /watchdog PID null/],
      ['the wrong parent PID', READY({ parentPid: 101 }), /parent PID 101, not 100/],
      ['another kind of marker', READY({ kind: 'other' }), /not a C4b watchdog readiness marker/],
      ['no timestamp', READY({ at: undefined }), /no valid timestamp/],
      ['an unparseable timestamp', READY({ at: 'yesterday' }), /no valid timestamp/],
      ['truncated JSON', '{"kind":', /not valid JSON/],
      ['an empty file', '', /not valid JSON/],
      ['an array', '[]', /not a JSON object/],
      ['null', 'null', /not a JSON object/],
      ['a number', '777', /not a JSON object/],
    ])('assessWatchdogReady: %s', (_label, text, want) => {
      const got = assessWatchdogReady(text, EXPECTED);
      if (typeof want === 'string') expect(got).toEqual({ state: want });
      else expect(got).toMatchObject({ state: 'refused', reason: expect.stringMatching(want) });
    });

    it('a matching marker from a running watchdog is ready', async () => {
      const a = armHarness({ onPoll: (n, s) => { if (n === 2) s.marker = READY(); } });
      await expect(armWatchdogWithHandshake(a.effects, 5000, 100)).resolves.toBeUndefined();
      expect(a.calls).toMatchObject({ launch: 1, stop: 0, standDown: [] });
      expect(a.log.join('\n')).toContain('watchdog ready: pid 777 proved run run-1, parent 100');
    });

    it('a marker that is published and then abandoned by an exited watchdog is not ready', async () => {
      const a = armHarness({ onPoll: (n, s) => { if (n === 1) { s.marker = READY(); s.alive = false; } } });
      await expect(armWatchdogWithHandshake(a.effects, 5000, 100)).rejects.toThrow(/published readiness and then exited/);
      expect(a.calls.standDown).toHaveLength(1);
    });

    it('a pre-existing marker is stale by definition: refused before the watchdog is even started', async () => {
      for (const stale of [READY(), READY({ runId: 'run-0' }), '{"kind":']) {
        const a = armHarness({ marker: stale });
        await expect(armWatchdogWithHandshake(a.effects, 5000, 100)).rejects.toThrow(/already exists/);
        expect(a.calls).toMatchObject({ launch: 0, stop: 0, standDown: [] });
      }
      const unreadable = armHarness();
      unreadable.state.readFails = true;
      await expect(armWatchdogWithHandshake(unreadable.effects, 5000, 100)).rejects.toThrow(/could not be checked/);
      expect(unreadable.calls.launch).toBe(0);
    });

    it('a startup timeout is bounded, stands the watchdog down and refuses', async () => {
      const a = armHarness();
      await expect(armWatchdogWithHandshake(a.effects, 5000, 100)).rejects.toThrow(/did not publish readiness within 5 seconds/);
      expect(a.elapsed()).toBeGreaterThanOrEqual(5000);
      expect(a.elapsed()).toBeLessThan(5300);
      expect(a.calls.stop).toBe(1);
      expect(a.calls.standDown).toEqual([{ runId: 'run-1', watchdogPid: 777, reason: expect.stringContaining('within 5 seconds') }]);
    });

    it('a watchdog that has a PID but exits before readiness is refused at once', async () => {
      const a = armHarness({ onPoll: (n, s) => { if (n === 3) s.alive = false; } });
      await expect(armWatchdogWithHandshake(a.effects, 45_000, 100)).rejects.toThrow(/exited before publishing readiness/);
      expect(a.elapsed()).toBeLessThan(1000);
      expect(a.calls.standDown).toHaveLength(1);
    });

    it.each([
      ['a marker for another run', READY({ runId: 'run-0' }), /another run/],
      ['the wrong watchdog PID', READY({ watchdogPid: 776 }), /watchdog PID 776/],
      ['the wrong parent PID', READY({ parentPid: 101 }), /parent PID 101/],
      ['malformed evidence', '{"kind":', /not valid JSON/],
      ['evidence that is not an object', '[]', /not a JSON object/],
    ])('%s published after the start is refused at once, not waited out', async (_label, marker, why) => {
      const a = armHarness({ onPoll: (n, s) => { if (n === 1) s.marker = marker; } });
      await expect(armWatchdogWithHandshake(a.effects, 45_000, 100)).rejects.toThrow(why);
      expect(a.elapsed()).toBeLessThan(1000);
      expect(a.calls).toMatchObject({ launch: 1, stop: 1 });
      expect(a.calls.standDown).toHaveLength(1);
    });

    it('a marker that stops being readable mid-wait is refused', async () => {
      const a = armHarness({ onPoll: (n, s) => { if (n === 1) s.readFails = true; } });
      await expect(awaitWatchdogReady(a.effects, EXPECTED, 5000, 100)).resolves.toMatchObject({
        ready: false, reason: expect.stringContaining('could not be read'),
      });
    });

    it('a failed launch propagates; a failed stand-down marker does not hide the refusal or skip the stop', async () => {
      const launchFails = armHarness({ launchThrows: true });
      await expect(armWatchdogWithHandshake(launchFails.effects, 5000, 100)).rejects.toThrow(/spawn failed/);
      expect(launchFails.calls.standDown).toEqual([]);
      const standDownFails = armHarness({ standDownFails: true });
      await expect(armWatchdogWithHandshake(standDownFails.effects, 1000, 100)).rejects.toThrow(/did not become ready/);
      expect(standDownFails.calls.stop).toBe(1);
      expect(standDownFails.log.join('\n')).toContain('stand-down marker not written');
    });

    it('post-spawn work that fails stands the launched watchdog down and stops that exact child, before any readiness wait', async () => {
      const a = armHarness({ afterLaunchThrows: true });
      await expect(armWatchdogWithHandshake(a.effects, 5000, 100)).rejects.toThrow(/post-spawn startup work failed: a database or process error \(ENOSPC\)/);
      expect(a.calls).toMatchObject({ launch: 1, afterLaunch: 1, stop: 1 });
      expect(a.calls.standDown).toEqual([{ runId: 'run-1', watchdogPid: 777, reason: expect.stringContaining('(ENOSPC)') }]);
      expect(a.elapsed()).toBe(0);
      expect(a.log.join('\n')).toContain('watchdog 777 stopped');
    });

    it('a readiness log that fails after the watchdog proved itself is post-spawn work too: stood down and stopped', async () => {
      const a = armHarness({ logThrowsOn: 'watchdog ready:', onPoll: (n, s) => { if (n === 1) s.marker = READY(); } });
      await expect(armWatchdogWithHandshake(a.effects, 5000, 100)).rejects.toThrow(/post-spawn startup work failed: a database or process error/);
      expect(a.calls).toMatchObject({ launch: 1, stop: 1 });
      expect(a.calls.standDown).toHaveLength(1);
    });

    it('a failing log, stand-down write and stop together never replace the refusal, and an unconfirmed stop is reported', async () => {
      const a = armHarness({ afterLaunchThrows: true, standDownFails: true, stopFails: true, logThrowsOn: 'watchdog' });
      await expect(armWatchdogWithHandshake(a.effects, 5000, 100)).rejects.toThrow(/did not become ready: post-spawn startup work failed/);
      expect(a.calls).toMatchObject({ stop: 1, standDown: [] });
      const quiet = armHarness({ afterLaunchThrows: true, stopFails: true });
      await expect(armWatchdogWithHandshake(quiet.effects, 5000, 100)).rejects.toThrow(/post-spawn/);
      expect(quiet.log.join('\n')).toContain('watchdog 777 NOT confirmed stopped');
    });

    describe('a readiness wait that itself fails: watchdogAlive, now or sleep throws or rejects', () => {
      const boom = (): never => {
        throw Object.assign(new Error('probe failed: postgres://u:secret@h/db'), { code: 'EPERM' });
      };
      const breakers: Array<[string, (a: ReturnType<typeof armHarness>) => void]> = [
        ['watchdogAlive throws', (a) => { a.effects.watchdogAlive = boom; }],
        ['now throws on its first call', (a) => { a.effects.now = boom; }],
        ['now throws on a later call', (a) => {
          let calls = 0;
          const real = a.effects.now;
          a.effects.now = () => { calls += 1; return calls > 2 ? boom() : real(); };
        }],
        ['sleep rejects', (a) => { a.effects.sleep = async () => boom(); }],
      ];

      it.each(breakers)('%s: the refusal survives, the stand-down is attempted and the exact child is stopped', async (_label, breakIt) => {
        const a = armHarness();
        breakIt(a);
        const error = await armWatchdogWithHandshake(a.effects, 5000, 100).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(Error);
        const message = (error as Error).message;
        expect(message).toBe('the watchdog did not become ready: the readiness wait failed: a database or process error (EPERM)');
        expect(message).not.toContain('secret');
        expect(a.calls).toMatchObject({ launch: 1, afterLaunch: 1, stop: 1 });
        expect(a.calls.standDown).toEqual([
          { runId: 'run-1', watchdogPid: 777, reason: expect.stringContaining('the readiness wait failed') },
        ]);
        expect(a.log.join('\n')).toContain('watchdog 777 stopped');
      });

      it.each(breakers)('%s, with a failing stand-down write, stop and log: the same refusal, nothing thrown instead', async (_label, breakIt) => {
        const a = armHarness({ standDownFails: true, stopFails: true, logThrowsOn: 'watchdog' });
        breakIt(a);
        await expect(armWatchdogWithHandshake(a.effects, 5000, 100)).rejects.toThrow(
          /^the watchdog did not become ready: the readiness wait failed: a database or process error \(EPERM\)$/,
        );
        expect(a.calls).toMatchObject({ launch: 1, stop: 1, standDown: [] });
      });

      it.each(breakers)('through the rehearsal, %s: exit 2 before any setting write or acquisition step', async (_label, breakIt) => {
        const a = armHarness();
        breakIt(a);
        const h = harness({ deps: { armWatchdog: () => armWatchdogWithHandshake(a.effects, 5000, 100) } });
        const outcome = await run(h);
        expect(outcome.exitCode).toBe(2);
        expect(outcome.verdict).toBe('REFUSED');
        expect(outcome.reasons.join('\n')).toMatch(/the watchdog could not be armed: the watchdog did not become ready: the readiness wait failed/);
        expect(outcome.reasons.join('\n')).not.toContain('secret');
        expect(writes(h)).toEqual([]);
        expect(h.state.writes).toEqual([]);
        expect(h.events.some((e) => e.startsWith('step '))).toBe(false);
        expect(h.events).not.toContain('marker');
        expect(h.state.setting).toEqual(OFF);
        expect(a.calls).toMatchObject({ launch: 1, stop: 1 });
        expect(a.calls.standDown).toHaveLength(1);
        expect(h.state.evidence['result.json']).toContain('REFUSED');
      });
    });

    describe('through the rehearsal: a refused startup is exit 2 with zero setting writes', () => {
      const refusals: Array<[string, ArmScript, RegExp]> = [
        ['post-spawn work fails after the process was created', { afterLaunchThrows: true }, /post-spawn startup work failed/],
        ['the watchdog gets a PID but exits before readiness', { onPoll: (n, s) => { if (n === 2) s.alive = false; } }, /exited before publishing readiness/],
        ['the startup times out', {}, /did not publish readiness within 5 seconds/],
        ['a stale marker is already present', { marker: READY() }, /already exists/],
        ['the marker is for another run', { onPoll: (n, s) => { if (n === 1) s.marker = READY({ runId: 'run-0' }); } }, /another run/],
        ['the marker names the wrong watchdog PID', { onPoll: (n, s) => { if (n === 1) s.marker = READY({ watchdogPid: 778 }); } }, /watchdog PID 778/],
        ['the marker names the wrong parent PID', { onPoll: (n, s) => { if (n === 1) s.marker = READY({ parentPid: 99 }); } }, /parent PID 99/],
        ['the marker is malformed', { onPoll: (n, s) => { if (n === 1) s.marker = '{"kind":'; } }, /not valid JSON/],
        ['the watchdog cannot be started at all', { launchThrows: true }, /could not be armed/],
      ];

      it.each(refusals)('%s', async (_label, script, reason) => {
        const a = armHarness(script);
        const h = harness({ deps: { armWatchdog: () => armWatchdogWithHandshake(a.effects, 5000, 100) } });
        const outcome = await run(h);
        expect(outcome.exitCode).toBe(2);
        expect(outcome.verdict).toBe('REFUSED');
        expect(outcome.reasons.join('\n')).toMatch(/the watchdog could not be armed/);
        expect(outcome.reasons.join('\n')).toMatch(reason);
        expect(writes(h)).toEqual([]);
        expect(h.state.writes).toEqual([]);
        expect(h.events.some((e) => e.startsWith('step '))).toBe(false);
        expect(h.events).not.toContain('marker');
        expect(h.state.setting).toEqual(OFF);
        expect(h.state.evidence['result.json']).toContain('REFUSED');
      });

      it('a matching handshake lets the rehearsal proceed through the existing success and restoration path', async () => {
        const a = armHarness({ onPoll: (n, s) => { if (n === 2) s.marker = READY(); } });
        const h = harness({
          deps: {
            armWatchdog: async () => {
              await armWatchdogWithHandshake(a.effects, 5000, 100);
              h.events.push('watchdog');
            },
          },
        });
        const outcome = await run(h);
        expect(outcome.exitCode).toBe(0);
        expect(outcome.verdict).toBe('CLEAR');
        expect(a.calls).toMatchObject({ launch: 1, stop: 0, standDown: [] });
        expect(h.events.filter((e) => !e.startsWith('systemctl'))).toEqual([
          'record', 'watchdog', 'write true',
          `step ${ACQUIRE_SCRIPT} --season 2027`,
          `step ${SETTLE_SCRIPT} --label 20270301T000000Z --dry-run --auto-apply --require-complete-source`,
          'write false', 'marker', 'record',
          'readiness data/sources/afl_api/matches/20270301T000000Z/00-season-matches.json',
        ]);
        expect(h.state.setting).toEqual(OFF);
      });

      it('a ready watchdog followed by a failing step still ends with the setting restored', async () => {
        const a = armHarness({ onPoll: (n, s) => { if (n === 1) s.marker = READY(); } });
        const h = harness({
          steps: { [ACQUIRE_SCRIPT]: () => ({ exitCode: 1, signal: null, output: 'boom' }) },
          deps: { armWatchdog: () => armWatchdogWithHandshake(a.effects, 5000, 100) },
        });
        const outcome = await run(h);
        expect(outcome.exitCode).toBe(1);
        expect(writes(h)).toEqual(['write true', 'write false']);
        expect(h.events).toContain('marker');
        expect(h.state.setting).toEqual(OFF);
      });
    });
  });

  describe('the production watchdog adapter: real spawn, real files, real liveness', () => {
    const registry: CleanupSandbox[] = [];
    const alive = pidAlive;
    const untilDead = (pid: number): Promise<boolean> => waitGone(pid);
    // The one shared cleanup (see teardownRegisteredProcesses): returned, so a failure fails the hook.
    afterAll(() => teardownRegisteredProcesses(registry));

    const STAND_IN_SHUTDOWN = 'stand-in.shutdown';
    // A stand-in for the watchdog command: the adapter cannot start the real one without a database.
    const STAND_IN = [
      "import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      'const [dir, mode, runId, parentPid] = process.argv.slice(2);',
      'const publish = (over) => {',
      "  const temp = join(dir, 'stand-in.temp');",
      '  writeFileSync(temp, JSON.stringify({',
      "    kind: 'afl-api-c4b-watchdog-ready', runId, watchdogPid: process.pid, parentPid: Number(parentPid), at: new Date().toISOString(), ...over,",
      '  }));',
      "  renameSync(temp, join(dir, 'watchdog-ready.json'));",
      '};',
      "if (mode === 'exit') process.exit(3);",
      "if (mode === 'ready') publish({});",
      "if (mode === 'wrong-run') publish({ runId: 'another-run' });",
      "if (mode === 'wrong-pid') publish({ watchdogPid: process.pid + 1 });",
      "if (mode === 'wrong-parent') publish({ parentPid: Number(parentPid) + 1 });",
      "if (mode === 'malformed') writeFileSync(join(dir, 'watchdog-ready.json'), '{\"kind\":');",
      // Run-bound cooperative shutdown: only this run's token ends it, and its own deadline bounds it regardless.
      // `stand-in.seen` records each different content it read from the shutdown file, and `stand-in.polling`
      // (this run's token) is written only once the poll is running, so a test can wait on facts, not on time.
      `const shutdown = join(dir, '${STAND_IN_SHUTDOWN}');`,
      'let seen = null;',
      'setInterval(() => { try {',
      '  if (!existsSync(shutdown)) return;',
      "  const content = readFileSync(shutdown, 'utf8');",
      "  if (content !== seen) { seen = content; writeFileSync(join(dir, 'stand-in.seen'), content); }",
      '  if (content === runId) process.exit(0);',
      '} catch {} }, 50);',
      "writeFileSync(join(dir, 'stand-in.polling'), runId);",
      'setTimeout(() => process.exit(0), 20000);',
    ].join('\n');

    // Reading the PID is only for the assertions: the teardown recovers it from the same run-bound file itself.
    const pidIn = (evidence: string): number => Number(readFileSync(path.join(evidence, 'watchdog.pid'), 'utf8'));
    /**
     * Registered first, then populated: whatever fails after this point, the teardown knows the directory, the
     * unique run token and where the fixture leaves its PID.
     */
    function sandboxIn(reg: CleanupSandbox[], prepare?: (evidence: string, runToken: string) => void) {
      const registered = registerSandbox(reg, 'c4b-arm-', STAND_IN_SHUTDOWN);
      const script = path.join(registered.root, 'stand-in.mjs');
      writeFileSync(script, STAND_IN);
      prepare?.(registered.evidence, registered.runToken);
      return { dir: registered.root, script, evidence: registered.evidence, runToken: registered.runToken, registered };
    }
    function sandbox(prepare?: (evidence: string, runToken: string) => void) {
      return sandboxIn(registry, prepare);
    }
    const armArgs = (sb: ReturnType<typeof sandbox>, mode: string) => [sb.script, sb.evidence, mode, sb.runToken, String(process.pid)];
    const arm = (sb: ReturnType<typeof sandbox>, mode: string, timeoutMs = 15_000) => armWatchdogProcess({
      command: process.execPath,
      args: armArgs(sb, mode),
      cwd: root,
      env: process.env,
      evidenceDir: sb.evidence,
      runId: sb.runToken,
      parentPid: process.pid,
      timeoutMs,
      pollMs: 25,
      log: () => {},
    });
    const standDownIn = (evidence: string) => JSON.parse(readFileSync(path.join(evidence, WATCHDOG_STAND_DOWN_MARKER), 'utf8'));

    // These call the same function the two hooks call. Each uses its own registry: a teardown that is made to
    // fail on purpose must not leave anything for the suite's hook, which is the real one.
    describe('teardownRegisteredProcesses: the cleanup both afterAll hooks run', () => {
      const signalsSent = (spy: { mock: { calls: unknown[][] } }): unknown[] => spy.mock.calls.map((c) => c[1]).filter((signal) => signal !== 0);
      const fileText = (file: string): string | undefined => { try { return readFileSync(file, 'utf8'); } catch { return undefined; } };
      const until = async (condition: () => boolean, what: string, ms = 10_000): Promise<void> => {
        const end = Date.now() + ms;
        while (!condition()) {
          if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
          await new Promise((r) => setTimeout(r, 25));
        }
      };
      // Never rejects, so an unawaited one cannot become an unhandled rejection; the test's own timeout bounds a wait.
      const exitOf = (child: ChildProcess): Promise<void> => new Promise<void>((resolve) => { child.once('exit', () => resolve()); });
      /** Ends whatever the test still owns through its own handle, then removes what the test created. */
      const disposeLocal = async (reg: CleanupSandbox[], children: ChildProcess[]): Promise<void> => {
        const exits = children.filter(handleRunning).map((c) => new Promise<void>((resolve) => { c.once('exit', () => resolve()); c.kill(); }));
        await Promise.race([Promise.all(exits), new Promise((r) => setTimeout(r, 3000))]);
        for (const s of reg.splice(0)) rmSync(s.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      };
      const failureOf = (promise: Promise<void>): Promise<Error | undefined> => promise.then(() => undefined, (error: Error) => error);
      /** A stand-in that polls its sandbox's shutdown file, started in that sandbox. */
      const startStandIn = (sb: ReturnType<typeof sandbox>): ChildProcess => nodeSpawn(process.execPath, armArgs(sb, 'silent'), { stdio: 'ignore' });
      const polling = (sb: ReturnType<typeof sandbox>): string => path.join(sb.evidence, 'stand-in.polling');
      const refusingKill = (code: string) => vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
        if (signal !== 0) throw new Error(`unexpected process.kill(${pid}, ${String(signal)})`);
        throw Object.assign(new Error(`kill ${code}`), { code });
      }) as typeof process.kill);
      const occupiedKill = () => vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
        if (signal === 0) return true;
        throw new Error(`unexpected process.kill(${pid}, ${String(signal)})`);
      }) as typeof process.kill);

      it('every sandbox gets its own unique run token, never the old shared value', () => {
        const reg: CleanupSandbox[] = [];
        try {
          const a = sandboxIn(reg);
          const b = sandboxIn(reg);
          expect(a.runToken).not.toBe(b.runToken);
          expect(a.registered.shutdownFile).not.toBe(b.registered.shutdownFile);
          for (const token of [a.runToken, b.runToken]) {
            expect(token).not.toBe('run-real');
            expect(token).toMatch(/^c4b-arm-[0-9a-f-]{36}$/);
          }
        } finally {
          for (const s of reg.splice(0)) rmSync(s.root, { recursive: true, force: true });
        }
      });

      it('a cooperative shutdown: the fixture ends itself on its token, the sandbox is removed, no signal is sent', async () => {
        const reg: CleanupSandbox[] = [];
        const sb = sandboxIn(reg);
        const child = startStandIn(sb);
        const exited = exitOf(child);
        const kill = vi.spyOn(process, 'kill');
        try {
          await until(() => fileText(polling(sb)) === sb.runToken, 'the stand-in to start polling');
          writeFileSync(path.join(sb.evidence, 'watchdog.pid'), `${child.pid}\n`);
          await teardownRegisteredProcesses(reg);
          await exited;
          expect(child.exitCode).toBe(0);
          expect(child.signalCode).toBeNull();
          expect(existsSync(sb.dir)).toBe(false);
          expect(reg).toEqual([]);
          expect(kill.mock.calls.length).toBeGreaterThan(0);
          expect(signalsSent(kill)).toEqual([]);
        } finally {
          kill.mockRestore();
          await disposeLocal(reg, [child]);
        }
      });

      it('a fixture that ignores its token fails the teardown with its PID, run token and evidence directory, and nothing is deleted', async () => {
        const reg: CleanupSandbox[] = [];
        const sb = sandboxIn(reg);
        // Ignores every shutdown file; the test ends it itself, through its own handle, at the end.
        const child = nodeSpawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
        const pid = child.pid as number;
        const exited = exitOf(child);
        const kill = vi.spyOn(process, 'kill');
        try {
          writeFileSync(path.join(sb.evidence, 'watchdog.pid'), `${pid}\n`);
          const failure = await failureOf(teardownRegisteredProcesses(reg, { waitMs: 300 }));
          expect(failure).toBeInstanceOf(Error);
          expect(failure?.message).toContain(`pid ${pid} (alive), run token ${sb.runToken}, evidence ${sb.evidence}`);
          // Evidence and the shutdown file are preserved, the registry still holds the sandbox, the process lives.
          expect(existsSync(sb.dir)).toBe(true);
          expect(fileText(sb.registered.shutdownFile)).toBe(sb.runToken);
          expect(reg).toEqual([sb.registered]);
          expect(handleRunning(child)).toBe(true);
          expect(signalsSent(kill)).toEqual([]);
          // Once the process really is gone the same teardown confirms it, and only then deletes.
          child.kill();
          await exited;
          await teardownRegisteredProcesses(reg);
          expect(existsSync(sb.dir)).toBe(false);
          expect(reg).toEqual([]);
        } finally {
          kill.mockRestore();
          await disposeLocal(reg, [child]);
        }
      });

      it('the teardown recovers a PID from watchdog.pid when the test never registered it (the watchdog was left running)', async () => {
        const reg: CleanupSandbox[] = [];
        const sb = sandboxIn(reg);
        try {
          await arm(sb, 'ready');
          // The test body stops here: it never reads the PID, pushes it anywhere or asserts on it.
          const pid = pidIn(sb.evidence);
          expect(alive(pid)).toBe(true);
          expect(sb.registered.pids.size).toBe(0);
          await teardownRegisteredProcesses(reg);
          expect(await untilDead(pid)).toBe(true);
          expect(existsSync(sb.dir)).toBe(false);
        } finally {
          await disposeLocal(reg, []);
        }
      });

      it('the teardown recovers a descendant PID from its report when nothing else recorded it', async () => {
        const reg: CleanupSandbox[] = [];
        const sb = sandboxIn(reg);
        const child = startStandIn(sb);
        const exited = exitOf(child);
        try {
          await until(() => fileText(polling(sb)) === sb.runToken, 'the stand-in to start polling');
          const report = path.join(sb.evidence, 'report.json');
          writeFileSync(report, JSON.stringify({ exitCode: 0, output: `GRANDCHILD ${child.pid}\n` }));
          sb.registered.reportFiles.push(report);
          await teardownRegisteredProcesses(reg);
          await exited;
          expect(child.exitCode).toBe(0);
          expect(existsSync(sb.dir)).toBe(false);
        } finally {
          await disposeLocal(reg, [child]);
        }
      });

      it('several unresponsive processes share one bounded deadline, after every token has been written', async () => {
        const reg: CleanupSandbox[] = [];
        const count = 4;
        const waitMs = 400;
        const sandboxes = Array.from({ length: count }, (_, i) => {
          const s = registerSandbox(reg, 'c4b-deadline-', 'x.shutdown');
          s.pids.add(900_001 + i);
          return s;
        });
        const tokensAtFirstProbe: Array<string | undefined> = [];
        let probes = 0;
        const kill = vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
          if (probes === 0) for (const s of sandboxes) tokensAtFirstProbe.push(fileText(s.shutdownFile));
          probes += 1;
          if (signal === 0) return true;
          throw new Error(`unexpected process.kill(${pid}, ${String(signal)})`);
        }) as typeof process.kill);
        try {
          const startedAt = Date.now();
          const failure = await failureOf(teardownRegisteredProcesses(reg, { waitMs, pollMs: 20 }));
          const elapsed = Date.now() - startedAt;
          expect(failure).toBeInstanceOf(Error);
          // Waited out the one deadline, not once per PID (that would take about count x waitMs).
          expect(elapsed).toBeGreaterThanOrEqual(waitMs - 50);
          expect(elapsed).toBeLessThan(waitMs * 2.5);
          expect(tokensAtFirstProbe).toEqual(sandboxes.map((s) => s.runToken));
          for (const s of sandboxes) {
            const [pid] = [...s.pids];
            expect(failure?.message).toContain(`pid ${pid} (alive), run token ${s.runToken}, evidence ${s.evidence}`);
            expect(existsSync(s.root)).toBe(true);
          }
          expect(signalsSent(kill)).toEqual([]);
        } finally {
          kill.mockRestore();
          await disposeLocal(reg, []);
        }
      });

      it('EPERM leaves a PID unconfirmed and fails the teardown; only ESRCH proves it gone', async () => {
        const reg: CleanupSandbox[] = [];
        const sb = registerSandbox(reg, 'c4b-eperm-', 'x.shutdown');
        sb.pids.add(900_010);
        let kill = refusingKill('EPERM');
        try {
          const failure = await failureOf(teardownRegisteredProcesses(reg, { waitMs: 200, pollMs: 20 }));
          expect(failure?.message).toContain(`pid 900010 (unconfirmed), run token ${sb.runToken}, evidence ${sb.evidence}`);
          expect(existsSync(sb.root)).toBe(true);
          expect(reg).toEqual([sb]);
          kill.mockRestore();
          kill = refusingKill('ESRCH');
          await teardownRegisteredProcesses(reg, { waitMs: 200, pollMs: 20 });
          expect(existsSync(sb.root)).toBe(false);
          expect(reg).toEqual([]);
          expect(signalsSent(kill)).toEqual([]);
        } finally {
          kill.mockRestore();
          await disposeLocal(reg, []);
        }
      });

      it('a PID whose process has exited and been reaped is only probed, and a recorded bare PID is never sent a terminating signal', async () => {
        const reg: CleanupSandbox[] = [];
        const sb = registerSandbox(reg, 'c4b-reaped-', 'x.shutdown');
        const child = nodeSpawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
        sb.pids.add(child.pid as number);
        const kill = vi.spyOn(process, 'kill');
        try {
          await exitOf(child);
          await teardownRegisteredProcesses(reg, { waitMs: 1000 });
          expect(kill.mock.calls.length).toBeGreaterThan(0);
          expect(kill.mock.calls.every(([, signal]) => signal === 0)).toBe(true);
          expect(existsSync(sb.root)).toBe(false);
        } finally {
          kill.mockRestore();
          await disposeLocal(reg, [child]);
        }
      });

      it('an owned handle that has already exited is neither probed nor signalled', async () => {
        const reg: CleanupSandbox[] = [];
        const sb = registerSandbox(reg, 'c4b-exited-', 'x.shutdown');
        const handleKill = vi.fn();
        const exited = Object.assign(new EventEmitter(), { pid: 900_020, exitCode: 0, signalCode: null, kill: handleKill }) as unknown as ChildProcess;
        sb.handles.push(exited);
        const kill = refusingKill('EPERM');
        try {
          await teardownRegisteredProcesses(reg, { waitMs: 200, pollMs: 20 });
          expect(kill).not.toHaveBeenCalled();
          expect(handleKill).not.toHaveBeenCalled();
          expect(existsSync(sb.root)).toBe(false);
        } finally {
          kill.mockRestore();
          await disposeLocal(reg, []);
        }
      });

      it('a still-running owned handle that outlives the deadline is ended through the handle, never by PID', async () => {
        const reg: CleanupSandbox[] = [];
        const sb = registerSandbox(reg, 'c4b-handle-', 'x.shutdown');
        const child = nodeSpawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
        sb.handles.push(child);
        const kill = vi.spyOn(process, 'kill');
        try {
          await teardownRegisteredProcesses(reg, { waitMs: 300, pollMs: 20 });
          expect(handleRunning(child)).toBe(false);
          expect(existsSync(sb.root)).toBe(false);
          expect(signalsSent(kill)).toEqual([]);
        } finally {
          kill.mockRestore();
          await disposeLocal(reg, [child]);
        }
      });

      it('a token written for another sandbox does not stop the stand-in; its own unique token does (no timing involved)', async () => {
        const reg: CleanupSandbox[] = [];
        const sb = sandboxIn(reg);
        const other = sandboxIn(reg);
        const child = startStandIn(sb);
        const exited = exitOf(child);
        const seen = path.join(sb.evidence, 'stand-in.seen');
        try {
          // The marker is written only after the stand-in has started polling, and carries this sandbox's token.
          await until(() => fileText(polling(sb)) === sb.runToken, 'the stand-in to start polling');
          expect(other.runToken).not.toBe(sb.runToken);
          writeFileSync(sb.registered.shutdownFile, other.runToken);
          // It reports what it read, so the wrong token is known to have been seen and ignored.
          await until(() => fileText(seen) === other.runToken, 'the stand-in to read the other sandbox\'s token');
          expect(child.exitCode).toBeNull();
          expect(child.signalCode).toBeNull();
          expect(alive(child.pid as number)).toBe(true);
          writeFileSync(sb.registered.shutdownFile, sb.runToken);
          await exited;
          expect(child.exitCode).toBe(0);
          expect(child.signalCode).toBeNull();
          expect(fileText(seen)).toBe(sb.runToken);
        } finally {
          await disposeLocal(reg, [child]);
        }
      });

      it('a PID that now looks occupied by an unrelated process is waited for within the bound, reported, and never signalled', async () => {
        const reg: CleanupSandbox[] = [];
        const sb = registerSandbox(reg, 'c4b-occupied-', 'x.shutdown');
        sb.pids.add(999_999);
        const kill = occupiedKill();
        try {
          const startedAt = Date.now();
          const failure = await failureOf(teardownRegisteredProcesses(reg, { waitMs: 200, pollMs: 20 }));
          expect(failure?.message).toContain('pid 999999 (alive)');
          expect(Date.now() - startedAt).toBeLessThan(5000);
          expect(signalsSent(kill)).toEqual([]);
        } finally {
          kill.mockRestore();
          await disposeLocal(reg, []);
        }
      });

      // Supplementary only: the behaviour above is what proves the contract.
      it('source tripwire: both process-owning hooks are the named teardown, returned, and no bare PID is sent a named signal', () => {
        const source = readFileSync(path.join(__dirname, 'afl-api-cutover.test.ts'), 'utf8');
        expect(source.match(/afterAll\(\(\) => teardownRegisteredProcesses\(/g)).toHaveLength(2);
        expect(source.match(/process\.kill\(\s*[^,()]+,\s*['"]SIG[A-Z]+['"]\s*\)/g)).toBeNull();
      });
    });

    it('a watchdog that publishes the matching marker is accepted and left running', async () => {
      const sb = sandbox();
      await arm(sb, 'ready');
      const pid = pidIn(sb.evidence);
      expect(alive(pid)).toBe(true);
      const marker = JSON.parse(readFileSync(path.join(sb.evidence, WATCHDOG_READY_MARKER), 'utf8'));
      expect(marker).toMatchObject({ kind: WATCHDOG_READY_KIND, runId: sb.runToken, watchdogPid: pid, parentPid: process.pid });
      expect(existsSync(path.join(sb.evidence, WATCHDOG_STAND_DOWN_MARKER))).toBe(false);
    });

    it('a watchdog that starts and exits before readiness is refused', async () => {
      const sb = sandbox();
      await expect(arm(sb, 'exit')).rejects.toThrow(/exited before publishing readiness/);
      const pid = pidIn(sb.evidence);
      expect(standDownIn(sb.evidence)).toMatchObject({ kind: WATCHDOG_STAND_DOWN_KIND, runId: sb.runToken, watchdogPid: pid });
    });

    it('a watchdog that never publishes times out, is stopped, and leaves a stand-down marker', async () => {
      const sb = sandbox();
      const startedAt = Date.now();
      await expect(arm(sb, 'silent', 1500)).rejects.toThrow(/did not publish readiness within/);
      expect(Date.now() - startedAt).toBeLessThan(10_000);
      const pid = pidIn(sb.evidence);
      expect(await untilDead(pid)).toBe(true);
      expect(standDownIn(sb.evidence)).toMatchObject({ runId: sb.runToken, watchdogPid: pid });
    });

    it.each([
      ['another run', 'wrong-run', /another run/],
      ['the wrong watchdog PID', 'wrong-pid', /watchdog PID/],
      ['the wrong parent PID', 'wrong-parent', /parent PID/],
      ['malformed evidence', 'malformed', /not valid JSON/],
    ])('a marker for %s is refused, the watchdog is stopped, and the evidence is left in place', async (_label, mode, why) => {
      const sb = sandbox();
      await expect(arm(sb, mode)).rejects.toThrow(why);
      const pid = pidIn(sb.evidence);
      expect(await untilDead(pid)).toBe(true);
      expect(existsSync(path.join(sb.evidence, WATCHDOG_READY_MARKER))).toBe(true);
      expect(existsSync(path.join(sb.evidence, WATCHDOG_STAND_DOWN_MARKER))).toBe(true);
    });

    it('a stale marker already in the evidence directory is refused before anything is started or touched', async () => {
      let stale = '';
      const sb = sandbox((evidence, runToken) => {
        stale = `${JSON.stringify({ kind: WATCHDOG_READY_KIND, runId: runToken, watchdogPid: 1, parentPid: process.pid, at: new Date().toISOString() })}`;
        writeFileSync(path.join(evidence, WATCHDOG_READY_MARKER), stale);
      });
      await expect(arm(sb, 'ready')).rejects.toThrow(/already exists/);
      expect(readdirSync(sb.evidence)).toEqual([WATCHDOG_READY_MARKER]);
      expect(readFileSync(path.join(sb.evidence, WATCHDOG_READY_MARKER), 'utf8')).toBe(stale);
    });

    it('a command that cannot start is refused', async () => {
      const sb = sandbox();
      await expect(armWatchdogProcess({
        command: path.join(sb.dir, 'no-such-binary'),
        args: [],
        cwd: sb.dir,
        env: process.env,
        evidenceDir: sb.evidence,
        runId: sb.runToken,
        parentPid: process.pid,
        timeoutMs: 5000,
        pollMs: 25,
        log: () => {},
      })).rejects.toThrow(/did not start|exited before publishing readiness/);
    });

    describe('post-spawn failure after a real process exists: refused, that exact child ended, nothing signalled by PID', () => {
      /** The watchdog PID the run reported in its final log line (for the assertions only). */
      const pidFromLog = (lines: string[]): number => {
        const m = lines.join('\n').match(/watchdog (\d+) (?:stopped|NOT confirmed stopped)/);
        if (!m) throw new Error(`no stop report in log: ${lines.join(' | ')}`);
        return Number(m[1]);
      };
      // Registered the moment the line is produced, before the caller's log runs (which may throw): a started
      // watchdog, or one the run could not confirm stopped, is known to the teardown whatever the test then does.
      const registerLoggedPids = (sb: ReturnType<typeof sandbox>, line: string): void => {
        for (const pattern of [/watchdog started: pid (\d+)/, /watchdog (\d+) NOT confirmed stopped/]) {
          const m = line.match(pattern);
          if (m) sb.registered.pids.add(Number(m[1]));
        }
      };
      const armLogged = (sb: ReturnType<typeof sandbox>, log: (line: string) => void) => armWatchdogProcess({
        command: process.execPath,
        args: armArgs(sb, 'silent'),
        cwd: root,
        env: process.env,
        evidenceDir: sb.evidence,
        runId: sb.runToken,
        parentPid: process.pid,
        timeoutMs: 15_000,
        pollMs: 25,
        log: (line) => { registerLoggedPids(sb, line); log(line); },
      });

      it('a watchdog.pid write that fails: refusal, a run-bound stand-down marker, the child terminated, no PID signalled', async () => {
        // A directory where the PID file belongs makes the write fail for real (EISDIR).
        const sb = sandbox((evidence) => mkdirSync(path.join(evidence, 'watchdog.pid')));
        const log: string[] = [];
        const kill = vi.spyOn(process, 'kill');
        try {
          const startedAt = Date.now();
          await expect(armLogged(sb, (l) => log.push(l))).rejects.toThrow(/did not become ready: post-spawn startup work failed/);
          expect(Date.now() - startedAt).toBeLessThan(10_000);
          const pid = pidFromLog(log);
          expect(log.join('\n')).toContain(`watchdog ${pid} stopped`);
          expect(await untilDead(pid)).toBe(true);
          expect(standDownIn(sb.evidence)).toMatchObject({ kind: WATCHDOG_STAND_DOWN_KIND, runId: sb.runToken, watchdogPid: pid });
          expect(existsSync(path.join(sb.evidence, WATCHDOG_READY_MARKER))).toBe(false);
          // Termination went through the child handle; process.kill was only ever the signal-0 liveness probe.
          expect(kill.mock.calls.filter(([, signal]) => signal !== undefined && signal !== 0)).toEqual([]);
        } finally {
          kill.mockRestore();
        }
      });

      it('a failed stand-down write does not stop the child being terminated', async () => {
        const sb = sandbox((evidence) => {
          mkdirSync(path.join(evidence, 'watchdog.pid'));
          writeFileSync(path.join(evidence, WATCHDOG_STAND_DOWN_MARKER), 'not this run\n');
        });
        const log: string[] = [];
        await expect(armLogged(sb, (l) => log.push(l))).rejects.toThrow(/did not become ready/);
        const pid = pidFromLog(log);
        expect(log.join('\n')).toContain('stand-down marker not written');
        expect(await untilDead(pid)).toBe(true);
        expect(readFileSync(path.join(sb.evidence, WATCHDOG_STAND_DOWN_MARKER), 'utf8')).toBe('not this run\n');
      });

      it('a start log that throws after the spawn is cleaned up the same way', async () => {
        const sb = sandbox();
        const log: string[] = [];
        await expect(armLogged(sb, (l) => {
          if (l.startsWith('watchdog started:')) throw new Error('terminal lost');
          log.push(l);
        })).rejects.toThrow(/post-spawn startup work failed: a database or process error/);
        const pid = pidFromLog(log);
        expect(await untilDead(pid)).toBe(true);
        expect(standDownIn(sb.evidence)).toMatchObject({ runId: sb.runToken, watchdogPid: pid });
        expect(existsSync(path.join(sb.evidence, WATCHDOG_READY_MARKER))).toBe(false);
      });

      it('through the rehearsal: exit 2, zero setting writes, no acquisition or settle step, the child gone', async () => {
        const sb = sandbox((evidence) => mkdirSync(path.join(evidence, 'watchdog.pid')));
        const log: string[] = [];
        const h = harness({ deps: { armWatchdog: () => armLogged(sb, (l) => log.push(l)) } });
        const outcome = await run(h);
        expect(outcome.exitCode).toBe(2);
        expect(outcome.verdict).toBe('REFUSED');
        expect(outcome.reasons.join('\n')).toMatch(/the watchdog could not be armed.*post-spawn startup work failed/s);
        expect(writes(h)).toEqual([]);
        expect(h.state.writes).toEqual([]);
        expect(h.events.some((e) => e.startsWith('step '))).toBe(false);
        expect(h.state.setting).toEqual(OFF);
        const pid = pidFromLog(log);
        expect(await untilDead(pid)).toBe(true);
      });
    });

    describe('child exit accounting: only an actual exit is confirmed termination, and an exited child is never signalled', () => {
      const FAKE_PID = 999_999;
      /** Stands in for the ChildProcess where a real one cannot be made to show the failure (an undeliverable signal). */
      class FakeChild extends EventEmitter {
        pid = FAKE_PID;
        exitCode: number | null = null;
        signalCode: string | null = null;
        readonly signals: string[] = [];
        constructor(private readonly onKill: (self: FakeChild, signal: string) => boolean) { super(); }
        unref(): void {}
        kill(signal: string): boolean {
          this.signals.push(signal);
          return this.onKill(this, signal);
        }
      }
      const kills = () => vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
        // The liveness probe only: any real signal to a PID would be a bug.
        if (signal === 0) return true;
        throw new Error(`unexpected process.kill(${pid}, ${String(signal)})`);
      }) as typeof process.kill);
      const failKill = (self: FakeChild): boolean => {
        process.nextTick(() => self.emit('error', Object.assign(new Error('kill EPERM'), { code: 'EPERM' })));
        return false;
      };
      const armFake = (sb: ReturnType<typeof sandbox>, child: FakeChild, log: string[]) => armWatchdogProcess({
        command: 'not-started',
        args: [],
        cwd: root,
        env: process.env,
        evidenceDir: sb.evidence,
        runId: 'run-fake',
        parentPid: process.pid,
        timeoutMs: 150,
        pollMs: 5,
        stopPollMs: 1,
        log: (l) => log.push(l),
        spawnProcess: (() => child) as unknown as typeof spawn,
      });

      it('a kill() error while the child keeps running is NOT a confirmed stop', async () => {
        const probe = kills();
        try {
          const sb = sandbox();
          const log: string[] = [];
          const child = new FakeChild(failKill);
          await expect(armFake(sb, child, log)).rejects.toThrow(/did not become ready/);
          expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);
          expect(child.exitCode).toBeNull();
          expect(log.join('\n')).toContain(`watchdog ${FAKE_PID} NOT confirmed stopped`);
          expect(log.join('\n')).not.toMatch(new RegExp(`watchdog ${FAKE_PID} stopped`));
          expect(standDownIn(sb.evidence)).toMatchObject({ runId: 'run-fake', watchdogPid: FAKE_PID });
          expect(probe.mock.calls.filter(([, signal]) => signal !== 0)).toEqual([]);
        } finally {
          probe.mockRestore();
        }
      });

      it('an undeliverable SIGTERM followed by a SIGKILL that ends the child is confirmed, by the exit', async () => {
        const probe = kills();
        try {
          const sb = sandbox();
          const log: string[] = [];
          const child = new FakeChild((self, signal) => {
            if (signal === 'SIGTERM') return failKill(self);
            process.nextTick(() => {
              self.signalCode = 'SIGKILL';
              self.emit('exit', null, 'SIGKILL');
            });
            return true;
          });
          await expect(armFake(sb, child, log)).rejects.toThrow(/did not become ready/);
          expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);
          expect(log.join('\n')).toContain(`watchdog ${FAKE_PID} stopped`);
          expect(log.join('\n')).not.toContain('NOT confirmed stopped');
        } finally {
          probe.mockRestore();
        }
      });

      it.each([
        ['an exit event', (c: FakeChild) => { c.exitCode = 3; c.emit('exit', 3, null); }],
        ['an exit code seen on the handle', (c: FakeChild) => { c.exitCode = 3; }],
        ['a signal code seen on the handle', (c: FakeChild) => { c.signalCode = 'SIGSEGV'; }],
      ])('a child that has genuinely exited (%s) is reported stopped and is never signalled, so a reused PID is safe', async (_label, exitIt) => {
        const probe = kills();
        try {
          const sb = sandbox();
          const log: string[] = [];
          const child = new FakeChild(() => { throw new Error('an exited child must not be signalled'); });
          setImmediate(() => exitIt(child));
          await expect(armFake(sb, child, log)).rejects.toThrow(/exited before publishing readiness/);
          expect(child.signals).toEqual([]);
          expect(log.join('\n')).toContain(`watchdog ${FAKE_PID} stopped`);
          expect(probe.mock.calls.filter(([, signal]) => signal !== 0)).toEqual([]);
        } finally {
          probe.mockRestore();
        }
      });
    });

    it('publishWatchdogReady: temp file, read back, atomic rename; no leftovers; never overwrites; unusable location throws', () => {
      const sb = sandbox();
      const marker: WatchdogReadyMarker = {
        kind: WATCHDOG_READY_KIND, runId: 'r1', watchdogPid: 9001, parentPid: 4242, at: '2027-02-01T00:00:00.000Z',
      };
      publishWatchdogReady(sb.evidence, marker);
      expect(readdirSync(sb.evidence)).toEqual([WATCHDOG_READY_MARKER]);
      const text = readFileSync(path.join(sb.evidence, WATCHDOG_READY_MARKER), 'utf8');
      expect(assessWatchdogReady(text, { runId: 'r1', watchdogPid: 9001, parentPid: 4242 })).toEqual({ state: 'ready' });
      expect(() => publishWatchdogReady(sb.evidence, { ...marker, runId: 'r2' })).toThrow(/already exists/);
      expect(readFileSync(path.join(sb.evidence, WATCHDOG_READY_MARKER), 'utf8')).toBe(text);
      expect(() => publishWatchdogReady(path.join(sb.dir, 'missing'), marker)).toThrow();
    });

    it('readStandDown is true only for a well-formed stand-down marker naming this run', () => {
      const sb = sandbox();
      const file = path.join(sb.evidence, WATCHDOG_STAND_DOWN_MARKER);
      expect(readStandDown(sb.evidence, 'r1')).toBe(false);
      writeFileSync(file, '{"kind":');
      expect(readStandDown(sb.evidence, 'r1')).toBe(false);
      writeFileSync(file, JSON.stringify({ kind: WATCHDOG_STAND_DOWN_KIND, runId: 'r0' }));
      expect(readStandDown(sb.evidence, 'r1')).toBe(false);
      writeFileSync(file, JSON.stringify({ kind: 'other', runId: 'r1' }));
      expect(readStandDown(sb.evidence, 'r1')).toBe(false);
      writeFileSync(file, JSON.stringify({ kind: WATCHDOG_STAND_DOWN_KIND, runId: 'r1' }));
      expect(readStandDown(sb.evidence, 'r1')).toBe(true);
    });

    it('the watchdog command runs through the tsx loader with no wrapper, so the spawned PID is the watchdog\'s own', () => {
      const sb = sandbox();
      const deadline = new Date('2027-02-01T00:30:00Z');
      const { command, args } = watchdogCommand(root, path.join(root, 'tools/current-season/afl-api-c4b-rehearsal.ts'),
        { pid: 4242, runId: 'run-1', evidenceDir: sb.evidence, deadline });
      expect(command).toBe(process.execPath);
      expect(args[0]).toBe('--import');
      expect(args[1]).toMatch(/^file:\/\/.*\/node_modules\/tsx\/dist\/loader\.mjs$/);
      expect(args.join(' ')).not.toContain('cli.mjs');
      expect(args.slice(3)).toEqual(['--watchdog', '--parent-pid', '4242', '--deadline', deadline.toISOString(),
        '--evidence-dir', sb.evidence, '--run-id', 'run-1']);
      // The same loader flags, run for real on a TypeScript file: the process that was spawned is the one running it.
      const script = path.join(sb.dir, 'pid.ts');
      const out = path.join(sb.dir, 'pid.txt');
      writeFileSync(script, [
        "import { writeFileSync } from 'node:fs';",
        'writeFileSync(process.argv[2], String(process.pid));',
      ].join('\n'));
      const r = spawnSync(command, [...args.slice(0, 2), script, out], { cwd: root, encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(Number(readFileSync(out, 'utf8'))).toBe(r.pid);
    });

    it('the tool source starts the acquire and settle steps through the same direct loader command, never the tsx CLI wrapper', () => {
      const src = read('tools/current-season/afl-api-c4b-rehearsal.ts');
      expect(src).toContain('stepCommand(projectRoot, script, argv)');
      expect(src).toContain('stepCommand(projectRoot, scriptPath, [\'--watchdog\'');
      expect(src).not.toMatch(/cli\.mjs'\)/);
      expect(src).not.toMatch(/args:\s*\[tsx,/);
    });

    it('the tool source has no deletion path and publishes readiness by rename', () => {
      const src = read('tools/current-season/afl-api-c4b-rehearsal.ts');
      expect(src).not.toMatch(/\b(unlinkSync|rmSync|rmdirSync|rmdir|unlink)\b/);
      expect(src).toContain('renameSync(tempPath, finalPath)');
    });
  });

  describe('runChildStep: one acquire or settle process, from spawn to a confirmed end', () => {
    type Pipe = EventEmitter & { destroy: () => void };
    /** Stands in for the ChildProcess where a real one cannot be made to show the failure (an undeliverable signal). */
    class FakeStep extends EventEmitter {
      pid: number | undefined = 987_654;
      exitCode: number | null = null;
      signalCode: string | null = null;
      readonly signals: string[] = [];
      destroyed = 0;
      unrefs = 0;
      readonly stdout: Pipe = Object.assign(new EventEmitter(), { destroy: () => { this.destroyed += 1; } });
      readonly stderr: Pipe = Object.assign(new EventEmitter(), { destroy: () => { this.destroyed += 1; } });
      constructor(private readonly onKill: (self: FakeStep, signal: string) => boolean = () => true) { super(); }
      unref(): void { this.unrefs += 1; }
      kill(signal: string): boolean {
        this.signals.push(signal);
        return this.onKill(this, signal);
      }
    }
    const failKill = (self: FakeStep): boolean => {
      process.nextTick(() => self.emit('error', Object.assign(new Error('kill EPERM'), { code: 'EPERM' })));
      return false;
    };
    const exitWith = (self: FakeStep, code: number | null, signal: string | null): boolean => {
      process.nextTick(() => {
        self.exitCode = code;
        self.signalCode = signal;
        self.emit('exit', code, signal);
        self.emit('close', code, signal);
      });
      return true;
    };
    const timing = { termGraceMs: 5, killWaitMs: 25, drainMs: 25 };
    const start = (child: FakeStep, abort: AbortController, extra: Partial<Parameters<typeof runChildStep>[0]> = {}) => runChildStep({
      command: 'not-started',
      args: [],
      cwd: root,
      env: process.env,
      abort: abort.signal,
      spawnProcess: (() => child) as unknown as typeof spawn,
      ...timing,
      ...extra,
    });
    const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    it('an error event after the process exists is not completion: only the exit ends the step, output intact', async () => {
      const child = new FakeStep();
      const abort = new AbortController();
      const lines: string[] = [];
      let done = false;
      const result = start(child, abort, { onLine: (l) => lines.push(l) }).then((r) => { done = true; return r; });
      child.emit('error', Object.assign(new Error('kill EPERM'), { code: 'EPERM' }));
      await pause(10);
      expect(done).toBe(false);
      child.stdout.emit('data', Buffer.from('hello\nworld\n'));
      child.exitCode = 0;
      child.emit('exit', 0, null);
      child.emit('close', 0, null);
      expect(await result).toEqual({ exitCode: 0, signal: null, output: 'hello\nworld\n' });
      expect(lines).toEqual(['hello', 'world']);
      expect(child.signals).toEqual([]);
    });

    it('an error event with no process (no PID) resolves at once as a step that could not start', async () => {
      const child = new FakeStep();
      child.pid = undefined;
      process.nextTick(() => child.emit('error', Object.assign(new Error('spawn x ENOENT'), { code: 'ENOENT' })));
      const result = await start(child, new AbortController());
      expect(result).toMatchObject({ exitCode: 1, signal: null });
      expect(result.output).toContain('could not start the step');
      expect(result.output).not.toContain('ENOENT');
    });

    it('a starter that throws is a step that could not start, not an exception', async () => {
      const result = await start(new FakeStep(), new AbortController(), {
        spawnProcess: (() => { throw new Error('EINVAL'); }) as unknown as typeof spawn,
      });
      expect(result).toMatchObject({ exitCode: 1, signal: null, output: '(could not start the step)' });
    });

    it('an abort whose SIGTERM cannot be delivered but whose SIGKILL ends the child is confirmed, by the exit', async () => {
      const child = new FakeStep((self, signal) => (signal === 'SIGTERM' ? failKill(self) : exitWith(self, null, 'SIGKILL')));
      const abort = new AbortController();
      const result = start(child, abort);
      abort.abort();
      expect(await result).toEqual({ exitCode: null, signal: 'SIGKILL', output: '' });
      expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);
    });

    it('an abort that neither signal can deliver is reported unconfirmed, never as finished', async () => {
      const child = new FakeStep(failKill);
      const abort = new AbortController();
      const result = start(child, abort);
      abort.abort();
      expect(await result).toEqual({ exitCode: null, signal: null, output: '', unconfirmed: true });
      expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);
      expect(child.exitCode).toBeNull();
      expect(child.destroyed).toBe(2);
      expect(child.unrefs).toBe(1);
    });

    it('an abort that SIGTERM satisfies sends nothing more', async () => {
      const child = new FakeStep((self) => exitWith(self, null, 'SIGTERM'));
      const abort = new AbortController();
      const result = start(child, abort);
      abort.abort();
      expect(await result).toMatchObject({ exitCode: null, signal: 'SIGTERM' });
      await pause(timing.termGraceMs * 3);
      expect(child.signals).toEqual(['SIGTERM']);
    });

    it('a child that has genuinely exited is never signalled, and its pipes are not waited on for ever', async () => {
      const child = new FakeStep(() => { throw new Error('an exited child must not be signalled'); });
      const abort = new AbortController();
      const result = start(child, abort);
      child.exitCode = 2;
      child.emit('exit', 2, null);
      abort.abort();
      expect(await result).toEqual({ exitCode: 2, signal: null, output: '' });
      expect(child.signals).toEqual([]);
    });

    it('an abort already raised terminates the step as soon as it exists', async () => {
      const child = new FakeStep((self) => exitWith(self, null, 'SIGTERM'));
      const abort = new AbortController();
      abort.abort();
      expect(await start(child, abort)).toMatchObject({ signal: 'SIGTERM' });
      expect(child.signals).toEqual(['SIGTERM']);
    });

    it('over a real process: output and exit code come back', async () => {
      const result = await runChildStep({
        command: process.execPath,
        args: ['-e', "console.log('real-ok'); process.exit(3)"],
        cwd: root,
        env: process.env,
        abort: new AbortController().signal,
      });
      expect(result.exitCode).toBe(3);
      expect(result.output).toContain('real-ok');
      expect(result.unconfirmed).toBeUndefined();
    });

    it('over a real process: an abort ends it, confirmed by its exit, and the process is gone', async () => {
      let pid: number | undefined;
      const abort = new AbortController();
      const result = runChildStep({
        command: process.execPath,
        args: ['-e', 'setTimeout(() => {}, 30000)'],
        cwd: root,
        env: process.env,
        abort: abort.signal,
        termGraceMs: 3000,
        spawnProcess: ((...a: Parameters<typeof nodeSpawn>) => {
          const c = nodeSpawn(...a);
          pid = c.pid;
          return c;
        }) as unknown as typeof spawn,
      });
      await pause(400);
      abort.abort();
      const done = await result;
      expect(done.unconfirmed).toBeUndefined();
      expect(done.signal !== null || done.exitCode !== 0).toBe(true);
      expect(pid).toBeDefined();
      const alive = (): boolean => {
        try { process.kill(pid as number, 0); return true; } catch { return false; }
      };
      for (let i = 0; i < 100 && alive(); i += 1) await pause(50);
      expect(alive()).toBe(false);
    });

    describe('pipes are released on every terminal path, and the monitored PID is the script\'s own', () => {
      const stepRegistry: CleanupSandbox[] = [];
      const alive = pidAlive;
      const untilDead = (pid: number): Promise<boolean> => waitGone(pid);
      // The descendant ends itself on its run-bound shutdown file (or its own 25 s deadline); its PID is only
      // probed while waiting, never signalled, because the original process may be gone and the number reused.
      // The same shared cleanup as the adapter block, returned so a failure fails the hook.
      afterAll(() => teardownRegisteredProcesses(stepRegistry));
      const stepSandbox = (): CleanupSandbox => registerSandbox(stepRegistry, 'c4b-step-', 'grandchild.shutdown');
      const sandboxDir = (): string => stepSandbox().root;
      const released = (child: FakeStep): void => {
        expect(child.destroyed).toBe(2);
        expect(child.unrefs).toBe(1);
      };

      it('a normal close releases both pipes and unrefs the handle', async () => {
        const child = new FakeStep();
        const result = start(child, new AbortController());
        child.stdout.emit('data', Buffer.from('out\n'));
        child.exitCode = 0;
        child.emit('exit', 0, null);
        child.emit('close', 0, null);
        expect(await result).toEqual({ exitCode: 0, signal: null, output: 'out\n' });
        released(child);
      });

      it('an exit whose pipes a descendant holds open keeps output up to the drain deadline, then releases the pipes', async () => {
        const child = new FakeStep();
        const result = start(child, new AbortController(), { drainMs: 40 });
        child.exitCode = 0;
        child.emit('exit', 0, null);
        child.stdout.emit('data', Buffer.from('late\n'));
        expect(child.destroyed).toBe(0);
        expect(await result).toEqual({ exitCode: 0, signal: null, output: 'late\n' });
        released(child);
      });

      it('a spawn that produced no process releases the pipes too', async () => {
        const child = new FakeStep();
        child.pid = undefined;
        process.nextTick(() => child.emit('error', Object.assign(new Error('spawn x ENOENT'), { code: 'ENOENT' })));
        expect(await start(child, new AbortController())).toMatchObject({ exitCode: 1, signal: null });
        released(child);
      });

      it('SIGTERM that is delivered and honoured ends the step, confirmed by the exit, and releases the pipes', async () => {
        const child = new FakeStep((self) => exitWith(self, null, 'SIGTERM'));
        const abort = new AbortController();
        const result = start(child, abort);
        abort.abort();
        expect(await result).toEqual({ exitCode: null, signal: 'SIGTERM', output: '' });
        expect(child.signals).toEqual(['SIGTERM']);
        released(child);
      });

      it('SIGTERM that is delivered but ignored escalates to SIGKILL after the grace, which ends the child', async () => {
        const child = new FakeStep((self, signal) => (signal === 'SIGTERM' ? true : exitWith(self, null, 'SIGKILL')));
        const abort = new AbortController();
        const result = start(child, abort);
        abort.abort();
        expect(await result).toEqual({ exitCode: null, signal: 'SIGKILL', output: '' });
        expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);
        released(child);
      });

      it('a throw while setting the step up ends the child through its handle and is unconfirmed, with the pipes released', async () => {
        const child = new FakeStep();
        (child.stdout as { on: unknown }).on = () => { throw new Error('listener setup failed'); };
        expect(await start(child, new AbortController())).toEqual({ exitCode: null, signal: null, output: '', unconfirmed: true });
        expect(child.signals).toEqual(['SIGKILL']);
        released(child);
      });

      it('a throw while setting the step up reports an exit only when the handle shows one, and never signals that child', async () => {
        const child = new FakeStep(() => { throw new Error('an exited child must not be signalled'); });
        child.exitCode = 7;
        (child.stderr as { on: unknown }).on = () => { throw new Error('listener setup failed'); };
        expect(await start(child, new AbortController())).toEqual({ exitCode: 7, signal: null, output: '' });
        expect(child.signals).toEqual([]);
        released(child);
      });

      it('over a real process: the tsx loader runs the script in the spawned PID itself, where the tsx CLI does not', async () => {
        expect(stepCommand(root, 'tools/x.ts', ['--season', '2027']).args.slice(2)).toEqual(['tools/x.ts', '--season', '2027']);
        const dir = sandboxDir();
        const script = path.join(dir, 'whoami.ts');
        writeFileSync(script, 'console.log(`PID ${process.pid}`);\n');
        const observe = async (command: string, args: string[]) => {
          let spawnedPid: number | undefined;
          const result = await runChildStep({
            command,
            args,
            cwd: root,
            env: process.env,
            abort: new AbortController().signal,
            spawnProcess: ((...a: Parameters<typeof nodeSpawn>) => {
              const c = nodeSpawn(...a);
              spawnedPid = c.pid;
              return c;
            }) as unknown as typeof spawn,
          });
          return { spawnedPid, reportedPid: Number(result.output.match(/PID (\d+)/)?.[1]), exitCode: result.exitCode };
        };
        const direct = stepCommand(root, script, []);
        const viaLoader = await observe(direct.command, direct.args);
        expect(viaLoader.exitCode).toBe(0);
        expect(viaLoader.reportedPid).toBe(viaLoader.spawnedPid);
        // Control: the tsx CLI is a wrapper that starts the script in a second process, which is what this replaced.
        const viaCli = await observe(process.execPath, [path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), script]);
        expect(viaCli.exitCode).toBe(0);
        expect(viaCli.reportedPid).not.toBe(viaCli.spawnedPid);
      });

      it('over a real process: a descendant that keeps the inherited pipes open does not keep the parent alive once the result is produced', async () => {
        // Registered before anything is spawned. The teardown finds the descendant from the PID file it writes
        // itself, or from the report, even if this test fails before it reads either.
        const sb = stepSandbox();
        const dir = sb.root;
        const reportPath = path.join(sb.evidence, 'report.json');
        const pidPath = path.join(sb.evidence, 'grandchild.pid');
        sb.reportFiles.push(reportPath);
        sb.pidFiles.push(pidPath);
        const toolUrl = pathToFileURL(path.join(root, 'tools', 'current-season', 'afl-api-c4b-rehearsal.ts')).href;
        // Detached, as a real survivor must be: on Windows a non-detached child is killed with its parent's job.
        // The descendant ends itself: on this sandbox's unique token in its shutdown file, or at its own 25 s deadline.
        const lives = "const fs = require('node:fs'); const [file, token, pidFile] = process.argv.slice(1); "
          + 'fs.writeFileSync(pidFile, String(process.pid)); '
          + "setInterval(() => { try { if (fs.readFileSync(file, 'utf8') === token) process.exit(0); } catch {} }, 50); "
          + 'setTimeout(() => process.exit(0), 25000)';
        const holder = "const { spawn } = require('node:child_process'); "
          + `const g = spawn(process.execPath, ['-e', ${JSON.stringify(lives)}, ${JSON.stringify(sb.shutdownFile)}, ${JSON.stringify(sb.runToken)}, ${JSON.stringify(pidPath)}], { detached: true, stdio: ['ignore', 'inherit', 'inherit'] }); `
          + "console.log('GRANDCHILD ' + g.pid); g.unref();";
        const harnessPath = path.join(dir, 'holder-harness.mts');
        // Never calls process.exit: the process ends only if the runner has released everything it holds.
        writeFileSync(harnessPath, [
          "import { writeFileSync } from 'node:fs';",
          `import { runChildStep } from ${JSON.stringify(toolUrl)};`,
          'const started = Date.now();',
          'try {',
          '  const result = await runChildStep({',
          `    command: process.execPath, args: ['-e', ${JSON.stringify(holder)}], cwd: process.cwd(), env: process.env,`,
          '    abort: new AbortController().signal, drainMs: 300,',
          '  });',
          '  writeFileSync(process.argv[2], JSON.stringify({ exitCode: result.exitCode, signal: result.signal, unconfirmed: result.unconfirmed ?? null, output: result.output, ms: Date.now() - started }));',
          '} catch (error) {',
          '  writeFileSync(process.argv[2], JSON.stringify({ error: String(error) }));',
          '}',
        ].join('\n'));
        const r = spawnSync(process.execPath, [...tsxLoaderArgs(root), harnessPath, reportPath], {
          cwd: root, stdio: 'ignore', timeout: 20_000,
        });
        let grandchild = Number.NaN;
        try {
          const report = JSON.parse(readFileSync(reportPath, 'utf8'));
          grandchild = Number(report.output?.match(/GRANDCHILD (\d+)/)?.[1]);
          // The parent ended on its own (not by the timeout) while the descendant, which lives 25 s, was still running.
          expect(r.error).toBeUndefined();
          expect(r.status).toBe(0);
          expect(report).toMatchObject({ exitCode: 0, signal: null, unconfirmed: null });
          expect(report.output).toContain('GRANDCHILD');
          expect(report.ms).toBeLessThan(5000);
          expect(alive(grandchild)).toBe(true);
        } finally {
          // Whatever failed above, the descendant is registered; the teardown also recovers it from the two files.
          if (Number.isInteger(grandchild) && grandchild > 0) sb.pids.add(grandchild);
        }
      });

      it.skipIf(process.platform === 'win32')('over a real process that ignores SIGTERM (POSIX): SIGKILL ends it after the grace', async () => {
        const abort = new AbortController();
        const done = await runChildStep({
          command: process.execPath,
          args: ['-e', "process.on('SIGTERM', () => {}); console.log('ready'); setTimeout(() => {}, 30000)"],
          cwd: root,
          env: process.env,
          abort: abort.signal,
          termGraceMs: 300,
          killWaitMs: 5000,
          onLine: (line) => { if (line === 'ready') abort.abort(); },
        });
        expect(done).toMatchObject({ exitCode: null, signal: 'SIGKILL' });
        expect(done.unconfirmed).toBeUndefined();
      });

      it.skipIf(process.platform === 'win32')('over a real process (POSIX): SIGTERM alone ends a default process, reported by its signal', async () => {
        const abort = new AbortController();
        const done = await runChildStep({
          command: process.execPath,
          args: ['-e', "console.log('ready'); setTimeout(() => {}, 30000)"],
          cwd: root,
          env: process.env,
          abort: abort.signal,
          onLine: (line) => { if (line === 'ready') abort.abort(); },
        });
        expect(done).toMatchObject({ exitCode: null, signal: 'SIGTERM' });
        expect(done.unconfirmed).toBeUndefined();
      });

      describe('through the rehearsal, over the real runner', () => {
        const stepOver = (child: FakeStep) => (abort: AbortSignal) => runChildStep({
          command: 'not-started',
          args: [],
          cwd: root,
          env: process.env,
          abort,
          spawnProcess: (() => child) as unknown as typeof spawn,
          ...timing,
        });
        const until = async (condition: () => boolean): Promise<void> => {
          for (let i = 0; i < 200 && !condition(); i += 1) await pause(10);
          expect(condition()).toBe(true);
        };

        it.each([
          ['acquire', ACQUIRE_SCRIPT, 'acquire-afl-api.ts'],
          ['dry-run settle', SETTLE_SCRIPT, 'settle-afl-api.ts'],
        ])('an unconfirmed %s: HALT naming it, pipes released, restored before the result, nothing later runs', async (_n, script, named) => {
          const child = new FakeStep(failKill);
          const h = harness({ steps: { [script]: stepOver(child) } });
          recordEvidenceOrder(h);
          const outcome = run(h);
          await until(() => h.events.some((e) => e.startsWith(`step ${script}`)) && h.state.interrupt !== null);
          h.state.interrupt?.('SIGINT');
          const done = await outcome;
          expect(done).toMatchObject({ exitCode: 1, verdict: 'HALT' });
          expect(done.reasons[0]).toBe('interrupted by SIGINT');
          expect(done.reasons.some((r) => r.includes(`${named}`) && r.includes('could not be confirmed stopped'))).toBe(true);
          expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);
          released(child);
          expect(writes(h)).toEqual(['write true', 'write false']);
          expect(restoredBeforeResult(h)).toBe(true);
          expect(h.events.some((e) => e.startsWith(`step ${SETTLE_SCRIPT}`))).toBe(script === SETTLE_SCRIPT);
        });

        it('a real acquire process stopped by the deadline: HALT, the process gone, restored before the result, no settle', async () => {
          let pid: number | undefined;
          const h = harness({
            steps: {
              [ACQUIRE_SCRIPT]: (abort) => runChildStep({
                command: process.execPath,
                args: ['-e', 'setTimeout(() => {}, 30000)'],
                cwd: root,
                env: process.env,
                abort,
                termGraceMs: 3000,
                spawnProcess: ((...a: Parameters<typeof nodeSpawn>) => {
                  const c = nodeSpawn(...a);
                  pid = c.pid;
                  return c;
                }) as unknown as typeof spawn,
              }),
            },
          });
          recordEvidenceOrder(h);
          const outcome = run(h);
          await until(() => pid !== undefined && h.state.deadline !== null);
          await pause(300);
          h.state.deadline?.();
          const done = await outcome;
          expect(done).toMatchObject({ exitCode: 1, verdict: 'HALT' });
          expect(done.reasons[0]).toBe('the 30-minute deadline was reached');
          expect(done.reasons.some((r) => /^acquire-afl-api\.ts ended/.test(r))).toBe(true);
          expect(writes(h)).toEqual(['write true', 'write false']);
          expect(restoredBeforeResult(h)).toBe(true);
          expect(h.events.some((e) => e.startsWith(`step ${SETTLE_SCRIPT}`))).toBe(false);
          expect(await untilDead(pid as number)).toBe(true);
        });
      });
    });
  });

  describe('main: setup failures are exit codes, never unhandled rejections', () => {
    const dirs: string[] = [];
    afterAll(() => {
      for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });
    const tmp = (): string => {
      const dir = mkdtempSync(path.join(tmpdir(), 'c4b-main-'));
      dirs.push(dir);
      return dir;
    };

    it('an evidence path that is a file: refused (2), or unrestored (3) for --restore-only; nothing is written', async () => {
      const file = path.join(tmp(), 'not-a-directory');
      writeFileSync(file, 'x');
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        expect(await c4bMain(['--season', '2027', '--decision', C4B_DECISION, '--evidence-dir', file])).toBe(2);
        expect(await c4bMain(['--restore-only', '--evidence-dir', file])).toBe(3);
        expect(err.mock.calls.flat().join('\n')).toContain('setup failed before any setting write: a database or process error');
        expect(readFileSync(file, 'utf8')).toBe('x');
      } finally {
        err.mockRestore();
      }
    });

    it('a non-empty evidence directory and a missing watchdog directory are still exit 2; bad arguments too', async () => {
      const dir = tmp();
      writeFileSync(path.join(dir, 'earlier-run.json'), '{}');
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        expect(await c4bMain(['--season', '2027', '--decision', C4B_DECISION, '--evidence-dir', dir])).toBe(2);
        expect(await c4bMain(['--watchdog', '--parent-pid', '4242', '--deadline', '2027-02-01T00:30:00Z',
          '--run-id', 'r', '--evidence-dir', path.join(dir, 'missing')])).toBe(2);
        expect(await c4bMain(['--season', '2027', '--decision', 'D-316-1', '--evidence-dir', dir])).toBe(2);
        expect(readdirSync(dir)).toEqual(['earlier-run.json']);
      } finally {
        err.mockRestore();
      }
    });
  });

  describe('--restore-only and the watchdog', () => {
    function restoreHarness(initial: SettingValue, opts: { alive?: () => boolean; marker?: () => boolean; standDown?: () => boolean; publishFails?: boolean; failWrites?: boolean; failReads?: boolean; failWritesFirst?: number; failEvidence?: boolean; now?: () => Date } = {}) {
      const s = { setting: initial, writes: 0, sleeps: 0, sleepMs: [] as number[], evidenceAttempts: 0, evidence: {} as Record<string, string>, published: [] as WatchdogReadyMarker[], logs: [] as string[] };
      const deps: WatchdogDeps = {
        log: (line) => { s.logs.push(line); },
        readSetting: async () => {
          if (opts.failReads) throw new Error('postgres://u:secret@h/db');
          return s.setting;
        },
        controlSeesEnabled: async () => s.setting.present && s.setting.value === 'true',
        writeSetting: async (enabled) => {
          s.writes += 1;
          if (opts.failWrites || s.writes <= (opts.failWritesFirst ?? 0)) throw new Error('down');
          s.setting = { present: true, value: String(enabled) };
        },
        sleep: async (ms) => { s.sleeps += 1; s.sleepMs.push(ms); },
        now: opts.now ?? (() => new Date('2027-02-01T00:00:00Z')),
        processAlive: opts.alive ?? (() => true),
        restoreVerified: opts.marker ?? (() => false),
        standDownRequested: opts.standDown ?? (() => false),
        publishReady: (marker) => {
          if (opts.publishFails) throw new Error('read-only file system');
          s.published.push(marker);
        },
        writeEvidence: (name, content) => {
          s.evidenceAttempts += 1;
          if (opts.failEvidence) throw Object.assign(new Error("ENOSPC: no space left on device, write '/secret/path'"), { code: 'ENOSPC' });
          s.evidence[name] = content;
        },
      };
      return { deps, s };
    }
    const deadline = new Date('2027-02-01T00:30:00Z');

    it('--restore-only writes nothing when the setting already reads false, else writes it off and verifies', async () => {
      const off = restoreHarness(OFF);
      expect(await runRestoreOnly(off.deps, 'r')).toBe(0);
      expect(off.s.writes).toBe(0);
      const on = restoreHarness({ present: true, value: 'true' });
      expect(await runRestoreOnly(on.deps, 'r')).toBe(0);
      expect(on.s.setting).toEqual(OFF);
      const broken = restoreHarness({ present: true, value: 'true' }, { failWrites: true });
      expect(await runRestoreOnly(broken.deps, 'r')).toBe(3);
    });

    it('stands down without a write once the parent has verified its restore', async () => {
      let polls = 0;
      const w = restoreHarness({ present: true, value: 'true' }, { marker: () => { polls += 1; return polls > 3; } });
      expect(await runWatchdog({ parentPid: 4242, deadline, runId: 'r' }, w.deps)).toBe(0);
      expect(w.s.writes).toBe(0);
      expect(w.s.sleeps).toBeGreaterThan(0);
    });

    it('restores when the parent dies without a verified restore (SIGKILL, lost session)', async () => {
      const w = restoreHarness({ present: true, value: 'true' }, { alive: () => false });
      expect(await runWatchdog({ parentPid: 4242, deadline, runId: 'r' }, w.deps)).toBe(0);
      expect(w.s.setting).toEqual(OFF);
      expect(JSON.parse(w.s.evidence['watchdog-result.json'])).toMatchObject({ verified: true, reason: expect.stringContaining('4242') });
    });

    it('a dead parent with the setting already false: recorded, nothing written', async () => {
      const w = restoreHarness(OFF, { alive: () => false });
      expect(await runWatchdog({ parentPid: 4242, deadline, runId: 'r' }, w.deps)).toBe(0);
      expect(w.s.writes).toBe(0);
      expect(w.s.evidence['watchdog-result.json']).toBeDefined();
    });

    it('restores after the deadline plus grace even while the parent is still alive', async () => {
      const w = restoreHarness({ present: true, value: 'true' }, { now: () => new Date('2027-02-01T00:32:01Z') });
      expect(await runWatchdog({ parentPid: 4242, deadline, runId: 'r' }, w.deps)).toBe(0);
      expect(w.s.setting).toEqual(OFF);
      expect(JSON.parse(w.s.evidence['watchdog-result.json']).reason).toBe('the deadline passed');
    });

    it('gives up with exit 3 when it cannot restore past its give-up time', async () => {
      const w = restoreHarness({ present: true, value: 'true' }, { alive: () => false, failWrites: true, now: () => new Date('2027-02-01T02:00:00Z') });
      expect(await runWatchdog({ parentPid: 4242, deadline, runId: 'r' }, w.deps)).toBe(3);
      expect(JSON.parse(w.s.evidence['watchdog-result.json']).verified).toBe(false);
    });
    describe('retry timing: the watchdog cycle and the restoration backoff are the documented ones', () => {
      const LATE = new Date('2027-02-01T00:32:01Z');
      const GIVE_UP = new Date('2027-02-01T02:00:00Z');

      it('restoration backs off 2 s then 4 s between its three attempts, and sleeps after none of the last', async () => {
        const sleeps: number[] = [];
        const failing = await restoreSettingOff({
          writeSetting: async () => { throw new Error('down'); },
          readSetting: async () => OFF,
          controlSeesEnabled: async () => false,
          sleep: async (ms) => { sleeps.push(ms); },
        }, {});
        expect(failing).toMatchObject({ verified: false, attempts: 3 });
        expect(sleeps).toEqual([2000, 4000]);

        const later: number[] = [];
        let tries = 0;
        const second = await restoreSettingOff({
          writeSetting: async () => { tries += 1; if (tries < 2) throw new Error('down'); },
          readSetting: async () => OFF,
          controlSeesEnabled: async () => false,
          sleep: async (ms) => { later.push(ms); },
        }, {});
        expect(second).toMatchObject({ verified: true, attempts: 2 });
        expect(later).toEqual([2000]);

        const first: number[] = [];
        await restoreSettingOff({
          writeSetting: async () => {}, readSetting: async () => OFF, controlSeesEnabled: async () => false,
          sleep: async (ms) => { first.push(ms); },
        }, {});
        expect(first).toEqual([]);
      });

      it('the watchdog polls every 5 s while the parent is alive and before the deadline plus grace', async () => {
        let polls = 0;
        const w = restoreHarness({ present: true, value: 'true' }, { marker: () => { polls += 1; return polls > 3; } });
        expect(await runWatchdog({ parentPid: 4242, deadline, runId: 'r' }, w.deps)).toBe(0);
        expect(w.s.sleepMs).toEqual([5000, 5000, 5000]);
      });

      it('after a failed restore round the watchdog waits 30 s, and each round restores with the 2 s / 4 s backoff', async () => {
        const w: ReturnType<typeof restoreHarness> = restoreHarness({ present: true, value: 'true' }, {
          alive: () => false, failWrites: true, now: () => (w.s.sleepMs.length >= 5 ? GIVE_UP : LATE),
        });
        expect(await runWatchdog({ parentPid: 4242, deadline, runId: 'r' }, w.deps)).toBe(3);
        // Round 1: restore (2 s, 4 s), the 30 s cycle. Round 2: restore (2 s, 4 s), then past the give-up time.
        expect(w.s.sleepMs).toEqual([2000, 4000, 30_000, 2000, 4000]);
        expect(w.s.writes).toBe(6);
      });

      it('a restore that succeeds on the second round is followed by no further 30 s wait', async () => {
        const w = restoreHarness({ present: true, value: 'true' }, { alive: () => false, failWritesFirst: 3, now: () => LATE });
        expect(await runWatchdog({ parentPid: 4242, deadline, runId: 'r' }, w.deps)).toBe(0);
        expect(w.s.sleepMs).toEqual([2000, 4000, 30_000]);
        expect(w.s.setting).toEqual(OFF);
      });
    });

    describe('the watchdog when its own evidence cannot be written: restoration retries are never lost', () => {
      const LATE = new Date('2027-02-01T00:32:01Z');
      const GIVE_UP = new Date('2027-02-01T02:00:00Z');
      const run = (w: ReturnType<typeof restoreHarness>) => runWatchdog({ parentPid: 4242, deadline, runId: 'r' }, w.deps);

      it('failed restoration with an unwritable evidence directory keeps retrying, then restores and returns 0', async () => {
        const w: ReturnType<typeof restoreHarness> = restoreHarness({ present: true, value: 'true' }, {
          alive: () => false, failWritesFirst: 4, failEvidence: true, now: () => LATE,
        });
        expect(await run(w)).toBe(0);
        expect(w.s.setting).toEqual(OFF);
        // Round 1: three failed writes. Round 2: one failed write, then the good one.
        expect(w.s.writes).toBe(5);
        expect(w.s.evidenceAttempts).toBe(2);
        expect(w.s.evidence['watchdog-result.json']).toBeUndefined();
        const logs = w.s.logs.join('\n');
        expect(logs).toContain('RESTORATION NOT VERIFIED; watchdog-result.json could not be written: a database or process error (ENOSPC)');
        expect(logs).toContain('setting off, verified; watchdog-result.json could not be written: a database or process error (ENOSPC)');
        expect(logs).not.toContain('/secret/path');
      });

      it('final give-up: exit 3 after bounded retries, with no exception though the evidence never writes', async () => {
        const w: ReturnType<typeof restoreHarness> = restoreHarness({ present: true, value: 'true' }, {
          alive: () => false, failWrites: true, failEvidence: true, now: () => (w.s.sleeps >= 5 ? GIVE_UP : LATE),
        });
        expect(await run(w)).toBe(3);
        expect(w.s.writes).toBe(6);
        expect(w.s.evidenceAttempts).toBe(2);
        expect(w.s.setting).toEqual({ present: true, value: 'true' });
        expect(w.s.logs.join('\n')).not.toContain('/secret/path');
      });

      it('a restore that succeeds first time reports the evidence failure and still returns 0', async () => {
        const w = restoreHarness({ present: true, value: 'true' }, { alive: () => false, failEvidence: true });
        expect(await run(w)).toBe(0);
        expect(w.s.setting).toEqual(OFF);
        expect(w.s.writes).toBe(1);
        expect(w.s.evidenceAttempts).toBe(1);
        expect(w.s.logs.join('\n')).toContain('setting off, verified; watchdog-result.json could not be written');
      });

      it('a log that throws changes nothing, with or without writable evidence', async () => {
        for (const failEvidence of [false, true]) {
          const w = restoreHarness({ present: true, value: 'true' }, { alive: () => false, failEvidence });
          w.deps.log = () => { throw new Error('terminal lost'); };
          expect(await run(w)).toBe(0);
          expect(w.s.setting).toEqual(OFF);
        }
      });
    });

    describe('the watchdog process: startup, readiness, then the monitor loop', () => {
      const args = { parentPid: 4242, deadline, runId: 'r', pid: 9001 };

      it('reads the setting on both paths, then publishes readiness naming the run, its own PID and the parent', async () => {
        const w: ReturnType<typeof restoreHarness> = restoreHarness(OFF, { marker: () => w.s.published.length > 0 });
        expect(await runWatchdogProcess(args, w.deps)).toBe(0);
        expect(w.s.published).toHaveLength(1);
        expect(w.s.published[0]).toMatchObject({ kind: WATCHDOG_READY_KIND, runId: 'r', watchdogPid: 9001, parentPid: 4242 });
        expect(assessWatchdogReady(JSON.stringify(w.s.published[0]), { runId: 'r', watchdogPid: 9001, parentPid: 4242 }))
          .toEqual({ state: 'ready' });
        expect(w.s.writes).toBe(0);
        expect(w.s.logs.join('\n')).toContain('ready, monitoring parent 4242');
      });

      it.each([
        ['the setting cannot be read', { failReads: true }],
        ['the evidence location is not usable', { publishFails: true }],
      ])('startup failure (%s): exit 2, readiness NOT published, nothing written, no driver text logged', async (_label, opts) => {
        const w = restoreHarness({ present: true, value: 'true' }, opts);
        expect(await runWatchdogProcess(args, w.deps)).toBe(2);
        expect(w.s.published).toEqual([]);
        expect(w.s.writes).toBe(0);
        expect(w.s.logs.join('\n')).toContain('startup failed, readiness NOT published');
        expect(w.s.logs.join('\n')).not.toContain('secret');
      });

      it('startup with the parent already gone publishes nothing and goes straight to the restore', async () => {
        const w = restoreHarness({ present: true, value: 'true' }, { alive: () => false });
        expect(await runWatchdogProcess(args, w.deps)).toBe(0);
        expect(w.s.published).toEqual([]);
        expect(w.s.setting).toEqual(OFF);
        expect(JSON.parse(w.s.evidence['watchdog-result.json']).reason).toContain('4242');
      });

      it('after a successful startup the parent dying still triggers the restore (no regression)', async () => {
        let aliveChecks = 0;
        const w = restoreHarness({ present: true, value: 'true' }, { alive: () => { aliveChecks += 1; return aliveChecks === 1; } });
        expect(await runWatchdogProcess(args, w.deps)).toBe(0);
        expect(w.s.published).toHaveLength(1);
        expect(w.s.setting).toEqual(OFF);
        expect(JSON.parse(w.s.evidence['watchdog-result.json'])).toMatchObject({ verified: true, reason: expect.stringContaining('4242') });
      });

      it('after a successful startup the deadline plus grace still triggers the restore (no regression)', async () => {
        const w = restoreHarness({ present: true, value: 'true' }, { now: () => new Date('2027-02-01T00:32:01Z') });
        expect(await runWatchdogProcess(args, w.deps)).toBe(0);
        expect(w.s.published).toHaveLength(1);
        expect(w.s.setting).toEqual(OFF);
        expect(JSON.parse(w.s.evidence['watchdog-result.json']).reason).toBe('the deadline passed');
      });

      it('a stand-down request wins over a dead parent and a deadline: the watchdog writes nothing', async () => {
        const dead = restoreHarness({ present: true, value: 'true' }, { alive: () => false, standDown: () => true });
        expect(await runWatchdogProcess(args, dead.deps)).toBe(0);
        expect(dead.s.writes).toBe(0);
        expect(dead.s.evidence['watchdog-result.json']).toBeUndefined();
        const late = restoreHarness({ present: false }, { standDown: () => true, now: () => new Date('2027-02-01T00:32:01Z') });
        expect(await runWatchdog({ parentPid: 4242, deadline, runId: 'r' }, late.deps)).toBe(0);
        expect(late.s.writes).toBe(0);
      });

      it('watchdogStartup returns ready or parent-gone, and throws before publishing when a read fails', async () => {
        const ok = restoreHarness(OFF);
        expect(await watchdogStartup({ parentPid: 4242, runId: 'r', pid: 9001 }, ok.deps)).toBe('ready');
        const gone = restoreHarness(OFF, { alive: () => false });
        expect(await watchdogStartup({ parentPid: 4242, runId: 'r', pid: 9001 }, gone.deps)).toBe('parent-gone');
        const broken = restoreHarness(OFF, { failReads: true });
        await expect(watchdogStartup({ parentPid: 4242, runId: 'r', pid: 9001 }, broken.deps)).rejects.toThrow();
        expect(broken.s.published).toEqual([]);
      });
    });

  });
});
