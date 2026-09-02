/**
 * AFLDB-ISSUE-127 — the host boundary for the on-demand AFL Tables settle.
 *
 * This module is the ONLY place in the application that touches the host,
 * and it can do exactly two things: start `afldb-settle-afltables.service`,
 * and read that one unit's state. It cannot name another unit, pass another
 * argument, or run another program, because every argv element below is a
 * module-level string literal.
 *
 * WHAT IT DOES NOT DO. It does not acquire, adjudicate, reconcile, write
 * canonically or recompute anything. `AFLDB-ISSUE-122` already built that
 * chain and production already runs it nightly; this starts the same unit the
 * timer starts, so there is one ingestion implementation, not two. See
 * `deploy/afldb-settle-afltables.sh`.
 *
 * WHY NOT sudo. `deploy/afldb.service` sets `NoNewPrivileges=true` (and
 * `RestrictSUIDSGID=true`) on the web service. Under `NoNewPrivileges` the
 * kernel ignores the setuid bit, so sudo cannot elevate no matter what
 * `/etc/sudoers.d` permits — making it work would mean deleting that line
 * from the public web service. `systemctl start` as a non-root user is
 * instead a D-Bus call to PID 1 authorized by polkit, which needs no setuid
 * binary and so works unchanged under that hardening. The grant is one rule
 * scoped to one action, one verb, one unit and one user:
 * `deploy/afldb-settle-afltables-trigger.rules`. `systemctl show` is
 * read-only and needs no permission at all.
 *
 * CONCURRENCY. The lock is systemd's. A start job for a unit that already has
 * one is merged into the existing job, so a second Super Admin, or a click
 * landing during the 04:30 timer run, cannot start a second ingestion
 * transaction. `readUnitState()` is consulted first only so the operator gets
 * "already running" instead of silence; that pre-check is advisory and
 * narrowly racy (two clicks in the same instant can both read `inactive`),
 * which can change the MESSAGE and never the safety property.
 *
 * FAIL CLOSED. Nothing here runs unless `AFLDB_SETTLE_TRIGGER` is exactly
 * `systemd`. Unset, empty or anything else means the host has not been
 * provisioned for this (see `docs/deployment.md` §7b) and the caller is told
 * so without a process being spawned.
 */
import { execFile } from 'node:child_process';

/** The one unit this module may ever name. Fixed; never configurable. */
export const SETTLE_UNIT = 'afldb-settle-afltables.service';

/**
 * Absolute and hardcoded. A configurable binary path would be an injection
 * vector for anything that could write `.env`, and buys nothing: systemd
 * hosts put `systemctl` here.
 */
const SYSTEMCTL = '/usr/bin/systemctl';

/**
 * `--no-block` is what keeps the HTTP request short. Without it, `systemctl
 * start` on a `Type=oneshot` unit blocks until `ExecStart` returns — which
 * for a season backfill was about an hour (`AFLDB-ISSUE-123`).
 */
const START_ARGV: readonly string[] = ['start', '--no-block', SETTLE_UNIT] as const;

/**
 * Exactly the properties the panel reports. `systemctl show` prints one
 * `Key=Value` line per property, in the order requested, and prints an empty
 * value rather than failing for a unit that has never run.
 */
const SHOW_ARGV: readonly string[] = [
  'show', SETTLE_UNIT,
  '--property=ActiveState',
  '--property=SubState',
  '--property=Result',
  '--property=ExecMainStatus',
  '--property=ActiveEnterTimestamp',
  '--property=InactiveEnterTimestamp',
] as const;

/** Both calls are quick; a stalled D-Bus call must not hold an admin request. */
const EXEC_TIMEOUT_MS = 10_000;

/** Never return an unbounded blob of child output to a browser. */
const MESSAGE_LIMIT = 300;

/** The exact value `AFLDB_SETTLE_TRIGGER` must carry for the control to exist. */
export const SETTLE_TRIGGER_ENV = 'AFLDB_SETTLE_TRIGGER';
export const SETTLE_TRIGGER_MODE = 'systemd';

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

/**
 * What the unit is doing right now.
 *
 * `running` covers systemd's `activating` and `active`: a `Type=oneshot`
 * unit is `activating` for the whole of `ExecStart` and only reaches `active`
 * if it declares `RemainAfterExit`, which this one does not. Treating both as
 * running means a future `RemainAfterExit` would not silently unlock a second
 * start.
 */
export type SettleUnitPhase = 'running' | 'idle' | 'failed' | 'unknown';

export type SettleUnitState = {
  phase: SettleUnitPhase;
  /** systemd's own words, passed through for display: `activating`, `failed`, … */
  activeState: string;
  subState: string;
  /** `success`, `exit-code`, `timeout`, … — why the last run ended as it did. */
  result: string;
  /** The last `ExecStart` exit status, or null when the unit has never run. */
  exitStatus: number | null;
  /** systemd's formatted timestamps, display-only. Empty before the first run. */
  activeEnterTimestamp: string;
  inactiveEnterTimestamp: string;
};

/** Why the trigger is not available, when it is not. */
export type SettleTriggerUnavailable = {
  available: false;
  /** Safe, bounded operator text. Never a path, DSN or environment value. */
  reason: string;
};

export type SettleStartOutcome =
  | { outcome: 'started' }
  | { outcome: 'already-running'; unit: SettleUnitState }
  | { outcome: 'unavailable'; reason: string }
  | { outcome: 'error'; reason: string };

/* ------------------------------------------------------------------ *
 * The boundary
 * ------------------------------------------------------------------ */

/**
 * Whether this host is provisioned for the on-demand trigger.
 *
 * Deliberately a strict equality against one literal rather than a
 * truthiness test: `AFLDB_SETTLE_TRIGGER=off` must not enable it.
 */
export function settleTriggerConfigured(): boolean {
  return process.env[SETTLE_TRIGGER_ENV] === SETTLE_TRIGGER_MODE;
}

/** The operator sentence shown when it is not configured. */
export const SETTLE_TRIGGER_UNCONFIGURED =
  `On-demand refresh is not enabled on this host. It needs the polkit rule from `
  + `deploy/afldb-settle-afltables-trigger.rules installed and `
  + `${SETTLE_TRIGGER_ENV}=${SETTLE_TRIGGER_MODE} set in .env (docs/deployment.md §7b). `
  + `The nightly timer is unaffected.`;

type ExecResult = { code: number; stdout: string; stderr: string };

/**
 * The single `execFile` call every path below funnels through.
 *
 * `execFile` with an argv ARRAY, never `exec` and never `shell: true`, so
 * there is no shell to inject into even if an argument could be influenced —
 * and none can, because every caller passes a frozen module constant.
 *
 * A non-zero exit is resolved, not thrown: `systemctl show` exits non-zero
 * for a unit systemd does not know, and that is information rather than a
 * crash.
 */
function run(argv: readonly string[]): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      SYSTEMCTL, [...argv],
      { timeout: EXEC_TIMEOUT_MS, maxBuffer: 64 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        // Node reports a non-zero exit and a failure to spawn through the
        // same callback. `code` is a number only in the former case; the
        // latter (ENOENT, EACCES, the timeout kill) has none and is a real
        // failure of the boundary itself.
        const code = (error as NodeJS.ErrnoException & { code?: number | string }).code;
        if (typeof code === 'number') {
          resolve({ code, stdout, stderr });
          return;
        }
        reject(error);
      },
    );
  });
}

/**
 * Collapse child output to one bounded, single-line sentence.
 *
 * systemctl's failures are short and safe to show — "Access denied",
 * "Unit not found" — and they are exactly what an operator needs to fix a
 * provisioning mistake. Bounding them anyway means a future systemd cannot
 * turn this into an unrestricted output channel.
 */
export function summariseFailure(stderr: string, stdout: string, fallback: string): string {
  const text = (stderr.trim() || stdout.trim()).replace(/\s+/g, ' ').trim();
  if (text === '') return fallback;
  return text.length > MESSAGE_LIMIT ? `${text.slice(0, MESSAGE_LIMIT)}…` : text;
}

/**
 * Parse `systemctl show`'s `Key=Value` lines.
 *
 * Only the keys asked for are kept; anything else systemd decides to print is
 * ignored rather than passed on. A value may itself contain `=`, so the split
 * is on the FIRST separator only.
 */
export function parseUnitShow(stdout: string): SettleUnitState {
  const props = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    props.set(line.slice(0, eq), line.slice(eq + 1).trim());
  }

  const activeState = props.get('ActiveState') ?? '';
  const rawExit = props.get('ExecMainStatus') ?? '';
  const exitStatus = /^-?\d+$/.test(rawExit) ? Number(rawExit) : null;

  return {
    phase: unitPhaseOf(activeState),
    activeState,
    subState: props.get('SubState') ?? '',
    result: props.get('Result') ?? '',
    exitStatus,
    activeEnterTimestamp: props.get('ActiveEnterTimestamp') ?? '',
    inactiveEnterTimestamp: props.get('InactiveEnterTimestamp') ?? '',
  };
}

/** systemd's `ActiveState` vocabulary, reduced to what the operator needs. */
export function unitPhaseOf(activeState: string): SettleUnitPhase {
  switch (activeState) {
    // `deactivating` is the tail of a run: still not a moment to start another.
    case 'activating': case 'active': case 'reloading': case 'deactivating':
      return 'running';
    case 'inactive':
      return 'idle';
    case 'failed':
      return 'failed';
    default:
      return 'unknown';
  }
}

/**
 * Read the settle unit's current state. Unprivileged: `systemctl show` is a
 * read-only D-Bus call any local user may make, so this works whether or not
 * the polkit rule is installed.
 */
export async function readUnitState(): Promise<SettleUnitState | SettleTriggerUnavailable> {
  if (!settleTriggerConfigured()) {
    return { available: false, reason: SETTLE_TRIGGER_UNCONFIGURED };
  }
  try {
    const { code, stdout, stderr } = await run(SHOW_ARGV);
    if (code !== 0) {
      return {
        available: false,
        reason: summariseFailure(stderr, stdout, `systemctl show ${SETTLE_UNIT} failed.`),
      };
    }
    return parseUnitShow(stdout);
  } catch {
    // A spawn failure means systemctl is not there (a development machine, a
    // container) or was killed by the timeout. Neither is a fact about the
    // settle run, and neither should surface a Node error object.
    return {
      available: false,
      reason: `Could not read ${SETTLE_UNIT} state on this host.`,
    };
  }
}

/**
 * Start one run of the approved chain, now.
 *
 * Takes no parameters, and could not use one if it had it: `START_ARGV` is a
 * module constant. Returns as soon as systemd has queued the job.
 */
export async function startSettleRun(): Promise<SettleStartOutcome> {
  if (!settleTriggerConfigured()) {
    return { outcome: 'unavailable', reason: SETTLE_TRIGGER_UNCONFIGURED };
  }

  // Advisory: see the CONCURRENCY note at the top. systemd is the lock.
  const before = await readUnitState();
  if ('available' in before) return { outcome: 'unavailable', reason: before.reason };
  if (before.phase === 'running') return { outcome: 'already-running', unit: before };

  try {
    const { code, stdout, stderr } = await run(START_ARGV);
    if (code !== 0) {
      return {
        outcome: 'error',
        reason: summariseFailure(
          stderr, stdout,
          `systemctl start ${SETTLE_UNIT} exited ${code}.`,
        ),
      };
    }
    return { outcome: 'started' };
  } catch {
    return { outcome: 'error', reason: `Could not start ${SETTLE_UNIT} on this host.` };
  }
}
