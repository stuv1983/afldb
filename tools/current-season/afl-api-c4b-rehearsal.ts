#!/usr/bin/env node
/**
 * AFLDB-ISSUE-316 C4b — the ISSUE-232 §7 D1 rehearsal on PROD as ONE command,
 * which turns `acquisition.afl_api_current_season_enabled` on for the rehearsal
 * only and back off however the run ends (issues/open/AFLDB-ISSUE-316.md §7).
 *
 *   node node_modules/tsx/dist/cli.mjs tools/current-season/afl-api-c4b-rehearsal.ts \
 *     --season 2027 --decision D-316-13 --evidence-dir ~/backups/afldb/c4b-<stamp> [--max-minutes 30]
 *
 *   ... --restore-only --evidence-dir <dir>   force the setting off and verify it (recovery)
 *
 * SEQUENCE. Preconditions, read-only, any surprise refuses before a write: the
 * in-progress register is exactly [season]; the AFL Tables switch is retired
 * (C2); both AFL API timers are `disabled` and `inactive` and both services
 * `inactive`; the setting is absent or exactly `false`; the connection that
 * writes it and the CLIs' control connection name the same live database.
 * BEFORE record. Watchdog armed AND PROVEN READY. Setting on. `acquire-afl-api.ts --season S`.
 * `settle-afl-api.ts --label L --dry-run --auto-apply --require-complete-source`.
 * Setting off, verified. Timers re-checked. AFTER record. Readiness on the
 * acquisition's own feed. Then the automated HALT criteria.
 *
 * RESTORATION, IN THREE LAYERS.
 *   1. A `finally` writes the setting off after success, a failed or refused
 *      step, a thrown error, an early exit (no label) and the deadline, then
 *      verifies it reads exactly `false` on the writer and off on the control
 *      path the CLIs use. Up to three attempts.
 *   2. SIGINT, SIGTERM and SIGHUP are caught: the running step is stopped and
 *      the same `finally` runs. A signal during restoration does not stop it.
 *   3. A detached watchdog, armed BEFORE the setting is turned on, outlives this
 *      process (SIGKILL, an OOM kill, a lost SSH session). When this process is
 *      gone, or the deadline plus two minutes has passed, without a verified
 *      restore, it writes the setting off itself and records that.
 *
 * WATCHDOG STARTUP HANDSHAKE. A child PID proves only that a process was
 * created. The setting is never written until the watchdog has PROVEN it is
 * ready: it parses its arguments, reads the setting on both connection paths
 * (so its credentials and database work), checks that the parent is alive, then
 * publishes `watchdog-ready.json` (temp file, read back, atomic rename) naming
 * this run, its own PID and the parent PID. This process accepts it only when
 * all three match exactly and the watchdog is still running; a missing marker
 * past the timeout, an early exit, a stale, wrong-run, wrong-PID or malformed
 * marker, or any startup error refuses with exit 2 before any write. A watchdog
 * left from a refused startup is stood down (`watchdog-stand-down.json`, which
 * it honours before any write, then a signal to the child handle it started).
 * Nothing is ever deleted.
 *
 * Not covered: a host reboot while the setting is on (no AFL API timer is
 * enabled, so nothing runs; `--restore-only` is the recovery), the watchdog
 * killed together with its parent, and a watchdog that dies AFTER it was proven
 * ready. The preflight refuses to start while the setting is on, so a leftover
 * is never silently reused.
 *
 * WHAT IT NEVER DOES. It never enables, starts or stops a unit or timer (it
 * runs `systemctl is-enabled` and `is-active` only), never runs settle with
 * `--apply`, never deletes the snapshot, and never claims the C4b PASS. Exit 0
 * means the automated HALT criteria are clear; the evidence directory is what
 * the reviewed C4b record is made from, and C5 requires that record.
 *
 * CREDENTIALS. The setting is written as `AFLDB_AUTH_DATABASE_URL` (afldb_auth,
 * the role the admin toggle writes it with), with an `auth_audit_log` row in the
 * same transaction. The two steps run with the AFL API unit's
 * `UnsetEnvironment=` list removed and `AFLDB_SKIP_DOTENV=1`, so they hold the
 * credentials the timer-run unit would, and not the auth DSN.
 *
 * EVIDENCE. A file that cannot be written never changes which exit code the run
 * ends with, and never escapes as an unhandled rejection. A refusal stays exit 2
 * (the reason is kept; `result.json` may then be absent) and an unverified restore
 * stays exit 3. Evidence the C4b record is made from (`before.json`, `acquire.log`,
 * `settle-dry-run.log`, `after.json`, `readiness.txt`, `restore-verified.json`,
 * `result.json`) is required for a CLEAR: if the BEFORE record cannot be saved the
 * run refuses before any write; any later failure stops further steps, restores as
 * usual and ends as a HALT (exit 1), never exit 0. The watchdog's `watchdog-result.json`
 * is evidence only: when it cannot be written the restore loop carries on and the
 * outcome is decided by the restore alone. A dependency that throws after the restore
 * (the AFTER systemd check, readiness) is a HALT reason, never an unhandled rejection;
 * before the restore it is a refusal. An error that escapes setup is exit 2 (3 for
 * `--restore-only`); one that escapes the run itself is exit 3, because the setting's
 * state is then not proved.
 *
 * STEP COMPLETION. Once an acquire or settle process exists, only its own exit ends the
 * step: a ChildProcess `error` event (for example a signal that could not be delivered)
 * is not proof of it. An abort sends SIGTERM then SIGKILL through the child handle; a
 * child that still has not exited afterwards is reported `unconfirmed` and the run
 * HALTs naming it, with the setting restored as usual. Each step is started as
 * `node --import <tsx loader> <script>` (the watchdog's pattern, no `tsx` wrapper), so the
 * PID and handle that are monitored and signalled belong to the script itself. Every
 * terminal path of a step destroys both output pipes and unrefs the handle, so a
 * descendant holding the inherited descriptors cannot keep this process alive.
 *
 * Exit: 0 automated HALT criteria clear; 1 HALT (setting restored and verified);
 * 2 refused before any write, or bad arguments; 3 RESTORATION NOT VERIFIED.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import postgres from 'postgres';

import { readAflApiIngestionControls } from '../../src/lib/acquisition/afl-api-ingestion-control';
import { requireSameAflApiDatabase, type AflApiDatabaseIdentity } from '../../src/lib/acquisition/afl-api-ingestion-safety';
import { parseAfltablesNetworkStatus } from '../../src/lib/acquisition/afltables-network';
import { SETTING_KEYS } from '../../src/lib/site-settings';
import { runAflApiCutoverReadiness } from './afl-api-cutover-readiness';
import { loadEnv } from './load-env';

const __filename = fileURLToPath(import.meta.url);
const DEFAULT_PROJECT_ROOT = join(dirname(__filename), '..', '..');

export const C4B_DECISION = 'D-316-13';
export const C4B_SETTING_KEY = SETTING_KEYS.aflApiCurrentSeasonEnabled;
export const AFL_API_TIMERS = ['afldb-settle-afl-api.timer', 'afldb-settle-afl-api-brownlow.timer'] as const;
export const AFL_API_SERVICES = ['afldb-settle-afl-api.service', 'afldb-settle-afl-api-brownlow.service'] as const;
export const ACQUIRE_SCRIPT = 'tools/current-season/acquire-afl-api.ts';
export const SETTLE_SCRIPT = 'tools/current-season/settle-afl-api.ts';
export const AFL_API_SERVICE_FILE = 'deploy/afldb-settle-afl-api.service';
export const RESTORE_VERIFIED_MARKER = 'restore-verified.json';
export const WATCHDOG_READY_MARKER = 'watchdog-ready.json';
export const WATCHDOG_STAND_DOWN_MARKER = 'watchdog-stand-down.json';
export const WATCHDOG_READY_KIND = 'afl-api-c4b-watchdog-ready';
export const WATCHDOG_STAND_DOWN_KIND = 'afl-api-c4b-watchdog-stand-down';
/** Covers the watchdog's own startup, including its two bounded database reads (10 s connect each). */
export const WATCHDOG_READY_TIMEOUT_MS = 45_000;
const WATCHDOG_READY_POLL_MS = 100;
const RESTORE_ATTEMPTS = 3;
const WATCHDOG_GRACE_MS = 2 * 60_000;
const WATCHDOG_GIVE_UP_MS = 60 * 60_000;

/** A refusal or HALT reason written by this tool: safe to print in full. */
class C4bError extends Error {}

/** Never a driver message, which can carry connection details; at most an error code. */
export function errorText(error: unknown): string {
  if (error instanceof C4bError) return error.message;
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return `a database or process error${typeof code === 'string' && /^[A-Za-z0-9_]{2,40}$/.test(code) ? ` (${code})` : ''}`;
}

/* ------------------------------------------------------------------ *
 * Arguments
 * ------------------------------------------------------------------ */

export type C4bArgs =
  | { mode: 'rehearse'; season: number; evidenceDir: string; maxMinutes: number }
  | { mode: 'restore-only'; evidenceDir: string }
  | { mode: 'watchdog'; evidenceDir: string; parentPid: number; deadline: Date; runId: string };

export const C4B_USAGE = 'Usage: afl-api-c4b-rehearsal.ts --season <YYYY> --decision D-316-13 '
  + '--evidence-dir <new or empty dir> [--max-minutes <5-120>]  |  --restore-only --evidence-dir <dir>';

export function parseC4bArgs(argv: readonly string[]): C4bArgs {
  const valueOf = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    if (i >= 0 && argv.indexOf(flag, i + 1) >= 0) throw new C4bError(`${flag} was given more than once.`);
    const value = i >= 0 ? argv[i + 1] : undefined;
    return value === undefined || value.startsWith('--') ? undefined : value;
  };
  const evidenceDir = valueOf('--evidence-dir');
  if (evidenceDir === undefined) throw new C4bError('--evidence-dir <dir> is required.');
  if (argv.includes('--watchdog')) {
    const parentPid = Number(valueOf('--parent-pid'));
    const deadline = new Date(valueOf('--deadline') ?? '');
    const runId = valueOf('--run-id');
    if (!Number.isInteger(parentPid) || parentPid <= 1 || Number.isNaN(deadline.getTime())
      || runId === undefined || !/^[A-Za-z0-9_-]{1,80}$/.test(runId)) {
      throw new C4bError('--watchdog needs --parent-pid, --deadline and --run-id.');
    }
    return { mode: 'watchdog', evidenceDir, parentPid, deadline, runId };
  }
  if (argv.includes('--restore-only')) return { mode: 'restore-only', evidenceDir };

  const decision = valueOf('--decision');
  if (decision !== C4B_DECISION) {
    throw new C4bError(`--decision must be exactly ${C4B_DECISION}, the owner decision that authorises the C4b `
      + `window (AFLDB-ISSUE-316 §8); got ${JSON.stringify(decision ?? null)}.`);
  }
  const season = Number(valueOf('--season'));
  if (!Number.isInteger(season) || season < 2027) {
    throw new C4bError('--season <YYYY> is required: the registered, in-progress AFL API season (2027 or later).');
  }
  const rawMinutes = valueOf('--max-minutes');
  const maxMinutes = rawMinutes === undefined ? 30 : Number(rawMinutes);
  if (!Number.isInteger(maxMinutes) || maxMinutes < 5 || maxMinutes > 120) {
    throw new C4bError('--max-minutes must be a whole number from 5 to 120.');
  }
  return { mode: 'rehearse', season, evidenceDir, maxMinutes };
}

/* ------------------------------------------------------------------ *
 * Pure helpers
 * ------------------------------------------------------------------ */

/** The setting as stored: absent, or its jsonb value as text (`false`, `true`, anything else). */
export type SettingValue = { present: false } | { present: true; value: string };

export const describeSetting = (s: SettingValue): string => (s.present ? s.value : 'absent');
const isExactlyFalse = (s: SettingValue): boolean => s.present && s.value === 'false';

/** The two steps get the AFL API unit's narrowed environment, never the auth DSN. */
export function childEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  serviceText: string | undefined,
): Record<string, string> {
  const line = serviceText?.match(/^UnsetEnvironment=(.+)$/m)?.[1];
  const names = line?.trim().split(/\s+/) ?? [];
  if (!names.includes('AFLDB_AUTH_DATABASE_URL')) {
    throw new C4bError(`${AFL_API_SERVICE_FILE} has no UnsetEnvironment= line naming AFLDB_AUTH_DATABASE_URL, `
      + 'so the steps cannot be given the unit\'s narrowed environment.');
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !names.includes(k)) out[k] = v;
  out.AFLDB_SKIP_DOTENV = '1';
  return out;
}

/** Same parse as `deploy/afldb-settle-afl-api.sh`. */
export function parseAcquiredLabel(output: string): string | null {
  return output.match(/, label ([A-Za-z0-9_-]+)/)?.[1] ?? null;
}

/** The dry-run report's own counter lines (`settle-afl-api.ts` counterLines). Missing is not zero. */
export function dryRunHalts(output: string): string[] {
  const counter = (key: string): string | null =>
    output.match(new RegExp(`^\\s*${key}:\\s*(\\S+)\\s*$`, 'm'))?.[1] ?? null;
  const halts: string[] = [];
  for (const key of ['canonicalRowsInserted', 'canonicalRowsUpdated']) {
    const value = counter(key);
    if (value === null) halts.push(`the dry-run report has no ${key} line`);
    else if (value !== '0') halts.push(`dry-run ${key} is ${value}, not 0`);
  }
  const feed = counter('seasonFeedComplete');
  if (feed !== 'true') halts.push(`the dry-run Season feed (AFLDB-ISSUE-231) evidence is ${feed === null ? 'absent' : `seasonFeedComplete ${feed}`}`);
  return halts;
}

export type RehearsalRecord = {
  matchesInSeason: number;
  aflApiOwnedMatches: number;
  /** Every `acquisition.%` row, key to jsonb text. */
  acquisitionSettings: Record<string, string>;
};

/** BEFORE vs AFTER. The toggled setting may only go from off (absent or false) to exactly false. */
export function recordDifferences(before: RehearsalRecord, after: RehearsalRecord): string[] {
  const out: string[] = [];
  if (before.matchesInSeason !== after.matchesInSeason) {
    out.push(`matches in the season: BEFORE ${before.matchesInSeason}, AFTER ${after.matchesInSeason}`);
  }
  if (before.aflApiOwnedMatches !== after.aflApiOwnedMatches) {
    out.push(`afl_api-owned matches: BEFORE ${before.aflApiOwnedMatches}, AFTER ${after.aflApiOwnedMatches}`);
  }
  const keys = new Set([...Object.keys(before.acquisitionSettings), ...Object.keys(after.acquisitionSettings)]);
  for (const key of [...keys].sort()) {
    const b = before.acquisitionSettings[key];
    const a = after.acquisitionSettings[key];
    if (key === C4B_SETTING_KEY) {
      if (!(b === undefined || b === 'false') || a !== 'false') out.push(`${key}: BEFORE ${b ?? 'absent'}, AFTER ${a ?? 'absent'}`);
    } else if (a !== b) {
      out.push(`${key}: BEFORE ${b ?? 'absent'}, AFTER ${a ?? 'absent'}`);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The rehearsal, over injected effects
 * ------------------------------------------------------------------ */

export type StepResult = {
  exitCode: number | null;
  signal: string | null;
  output: string;
  /** Set only when an abort could not be confirmed to have ended the step: it may still be running. */
  unconfirmed?: boolean;
};

/** One halt reason for a finished step, or null when it ended cleanly. */
function stepProblem(name: string, step: StepResult, extra = ''): string | null {
  if (step.unconfirmed === true) {
    return `${name}${extra} could not be confirmed stopped; it may still be running (check the host for a stray ${name} process)`;
  }
  if (step.exitCode !== 0 || step.signal !== null) {
    return `${name}${extra} ended ${step.signal ?? `with exit ${String(step.exitCode)}`}`;
  }
  return null;
}

export type C4bDeps = {
  log: (line: string) => void;
  /** A tracked file's text, or undefined when it cannot be read. */
  projectFile: (rel: string) => string | undefined;
  systemctl: (verb: 'is-enabled' | 'is-active', unit: string) => string;
  /** Throws unless the setting's writer and the CLIs' control connection name the same live database. */
  sameDatabase: () => Promise<void>;
  /** The stored value, on the writer connection. */
  readSetting: () => Promise<SettingValue>;
  /** What the acquire/settle CLIs will read. Throws on a read failure. */
  controlSeesEnabled: () => Promise<boolean>;
  /** Upsert plus its `auth_audit_log` row, one transaction. */
  writeSetting: (enabled: boolean, detail: Record<string, unknown>) => Promise<void>;
  record: (season: number) => Promise<RehearsalRecord>;
  runStep: (script: string, argv: string[], abort: AbortSignal) => Promise<StepResult>;
  readiness: (season: number, feedPath: string) => { exitCode: number; lines: string[] };
  /** Resolves only once the watchdog has PROVEN it is ready (the handshake); throws on anything else. */
  armWatchdog: (deadline: Date) => Promise<void>;
  markRestoreVerified: (detail: Record<string, unknown>) => void;
  writeEvidence: (name: string, content: string) => void;
  onInterrupt: (handler: (signal: string) => void) => () => void;
  scheduleDeadline: (ms: number, fn: () => void) => () => void;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
};

export type C4bOutcome = {
  exitCode: 0 | 1 | 2 | 3;
  verdict: 'CLEAR' | 'HALT' | 'REFUSED' | 'RESTORATION NOT VERIFIED';
  reasons: string[];
  /** Set when `result.json` itself could not be written; the exit code is then the run's own, except that a CLEAR becomes a HALT. */
  evidenceError?: string;
};

export type RestoreResult = { verified: boolean; attempts: number; reads: string[] };

/** Write off, then prove it on both paths. Never throws. */
export async function restoreSettingOff(
  deps: Pick<C4bDeps, 'writeSetting' | 'readSetting' | 'controlSeesEnabled' | 'sleep'>,
  detail: Record<string, unknown>,
): Promise<RestoreResult> {
  const reads: string[] = [];
  for (let attempt = 1; attempt <= RESTORE_ATTEMPTS; attempt += 1) {
    try {
      await deps.writeSetting(false, { ...detail, attempt });
      const stored = await deps.readSetting();
      const seen = await deps.controlSeesEnabled();
      reads.push(`attempt ${attempt}: stored ${describeSetting(stored)}, control path ${seen ? 'ENABLED' : 'off'}`);
      if (isExactlyFalse(stored) && !seen) return { verified: true, attempts: attempt, reads };
    } catch (error) {
      reads.push(`attempt ${attempt}: ${errorText(error)}`);
    }
    if (attempt < RESTORE_ATTEMPTS) await deps.sleep(2000 * attempt);
  }
  return { verified: false, attempts: RESTORE_ATTEMPTS, reads };
}

async function preconditions(season: number, deps: C4bDeps): Promise<string[]> {
  const problems: string[] = [];
  const json = (rel: string): unknown => {
    try { return JSON.parse(deps.projectFile(rel) ?? ''); } catch { return undefined; }
  };
  const seasons = json('data/reference/seasons.json');
  const register = (seasons as { in_progress_seasons?: unknown } | undefined)?.in_progress_seasons;
  if (!Array.isArray(register) || register.length !== 1 || register[0] !== season) {
    problems.push(`data/reference/seasons.json in_progress_seasons is ${JSON.stringify(register ?? null)}, not [${season}] (the C2 rollover writes this register: C2 not deployed?)`);
  }
  const network = parseAfltablesNetworkStatus(json('data/reference/afltables-network.json'), seasons);
  const switchStatus = (json('data/reference/afltables-network.json') as { status?: unknown } | undefined)?.status;
  if (network !== 'retired' || switchStatus !== 'retired') {
    problems.push(`the AFL Tables switch reads '${network}', not an explicit 'retired' (C2 not deployed?)`);
  }
  // A check that cannot be made is a refusal like any other, never an exception.
  for (const unit of AFL_API_TIMERS) {
    try {
      const enabled = deps.systemctl('is-enabled', unit);
      const active = deps.systemctl('is-active', unit);
      if (enabled !== 'disabled' || active !== 'inactive') {
        problems.push(`${unit} is ${enabled} / ${active}, not disabled / inactive`);
      }
    } catch (error) {
      problems.push(`the state of ${unit} could not be read: ${errorText(error)}`);
    }
  }
  for (const unit of AFL_API_SERVICES) {
    try {
      const active = deps.systemctl('is-active', unit);
      if (active !== 'inactive') problems.push(`${unit} is ${active}, not inactive (C3 not installed, or a run in progress)`);
    } catch (error) {
      problems.push(`the state of ${unit} could not be read: ${errorText(error)}`);
    }
  }
  try {
    childEnvironment({}, deps.projectFile(AFL_API_SERVICE_FILE));
  } catch (error) {
    problems.push(errorText(error));
  }
  if (problems.length > 0) return problems;
  try {
    await deps.sameDatabase();
    const stored = await deps.readSetting();
    if (stored.present && stored.value !== 'false') {
      problems.push(`${C4B_SETTING_KEY} is ${stored.value}; it must be absent or false before C4b `
        + '(a leftover is recovered with --restore-only, then investigated)');
    }
    if (await deps.controlSeesEnabled()) problems.push(`the control path already sees ${C4B_SETTING_KEY} enabled`);
  } catch (error) {
    problems.push(`the database preconditions could not be proved: ${errorText(error)}`);
  }
  return problems;
}

export async function runC4bRehearsal(
  args: { season: number; maxMinutes: number; runId: string },
  deps: C4bDeps,
): Promise<C4bOutcome> {
  const { season, runId } = args;
  const audit = { via: 'afl-api-c4b-rehearsal', decision: C4B_DECISION, run_id: runId };
  // A lost log line or an unwritable evidence file must never change which exit code the run ends with.
  const say = (line: string): void => {
    try { deps.log(line); } catch { /* the outcome stands */ }
  };
  const evidenceFailures: string[] = [];
  const keep = (name: string, content: string): boolean => {
    try {
      deps.writeEvidence(name, content);
      return true;
    } catch (error) {
      evidenceFailures.push(`${name} could not be written: ${errorText(error)}`);
      return false;
    }
  };
  const finish = (outcome: C4bOutcome, extra: Record<string, unknown> = {}): C4bOutcome => {
    let final = outcome;
    try {
      deps.writeEvidence('result.json',
        `${JSON.stringify({ ...outcome, ...extra, run_id: runId, at: deps.now().toISOString() }, null, 2)}\n`);
    } catch (error) {
      const why = `result.json could not be written: ${errorText(error)}`;
      // A refusal stays a refusal (2) and an unverified restoration stays 3; only a CLEAR needs the record to stand.
      final = outcome.exitCode === 0
        ? {
          exitCode: 1,
          verdict: 'HALT',
          reasons: [`${why}. C4b requires reviewable evidence, so a run with no result record is a HALT, not a CLEAR.`,
            ...outcome.reasons],
          evidenceError: why,
        }
        : { ...outcome, evidenceError: why };
    }
    say(`C4B ${final.verdict}`);
    if (final.evidenceError !== undefined) say(`  - ${final.evidenceError}`);
    for (const reason of final.reasons) say(`  - ${reason}`);
    return final;
  };

  // 1. Preconditions and the BEFORE record. Nothing has been written.
  const problems = await preconditions(season, deps);
  if (problems.length > 0) return finish({ exitCode: 2, verdict: 'REFUSED', reasons: problems });
  let before: RehearsalRecord;
  try {
    before = await deps.record(season);
  } catch (error) {
    return finish({ exitCode: 2, verdict: 'REFUSED', reasons: [`the BEFORE record could not be read: ${errorText(error)}`] });
  }
  if (!keep('before.json', `${JSON.stringify(before, null, 2)}\n`)) {
    return finish({
      exitCode: 2,
      verdict: 'REFUSED',
      reasons: [`the BEFORE record could not be saved as evidence: ${evidenceFailures.splice(0).join('; ')}`],
    });
  }
  const deadline = new Date(deps.now().getTime() + args.maxMinutes * 60_000);
  try {
    await deps.armWatchdog(deadline);
  } catch (error) {
    return finish({ exitCode: 2, verdict: 'REFUSED', reasons: [`the watchdog could not be armed: ${errorText(error)}`] });
  }

  // 2. On, the two steps, and off again whatever happens.
  const halts: string[] = [];
  const controller = new AbortController();
  let stopReason: string | null = null;
  const stop = (reason: string): void => {
    if (stopReason !== null) return;
    stopReason = reason;
    say(`STOPPING: ${reason}; the setting is restored next`);
    controller.abort();
  };
  const removeHandlers = deps.onInterrupt((signal) => stop(`interrupted by ${signal}`));
  const cancelDeadline = deps.scheduleDeadline(args.maxMinutes * 60_000,
    () => stop(`the ${args.maxMinutes}-minute deadline was reached`));
  let label: string | null = null;
  let settleOutput: string | null = null;
  let restore: RestoreResult;
  // Another step is never started once the run is stopping or its evidence can no longer be kept.
  const proceed = (): boolean => stopReason === null && evidenceFailures.length === 0;
  try {
    await deps.writeSetting(true, { ...audit, step: 'on' });
    say(`${C4B_SETTING_KEY} ON at ${deps.now().toISOString()}`);
    if (proceed()) {
      const acquire = await deps.runStep(ACQUIRE_SCRIPT, ['--season', String(season)], controller.signal);
      keep('acquire.log', acquire.output);
      const acquireProblem = stepProblem('acquire-afl-api.ts', acquire);
      if (acquireProblem !== null) {
        halts.push(acquireProblem);
      } else {
        label = parseAcquiredLabel(acquire.output);
        if (label === null) halts.push('could not determine the acquired snapshot label (early exit before the settle)');
      }
    }
    if (label !== null && proceed()) {
      const settle = await deps.runStep(SETTLE_SCRIPT,
        ['--label', label, '--dry-run', '--auto-apply', '--require-complete-source'], controller.signal);
      keep('settle-dry-run.log', settle.output);
      settleOutput = settle.output;
      const settleProblem = stepProblem('settle-afl-api.ts', settle, ' --dry-run');
      if (settleProblem !== null) halts.push(settleProblem);
    }
  } catch (error) {
    halts.push(`the rehearsal stopped on ${errorText(error)}`);
  } finally {
    cancelDeadline();
    try {
      restore = await restoreSettingOff(deps, { ...audit, step: 'restore' });
      if (restore.verified) {
        try {
          deps.markRestoreVerified({ run_id: runId, attempts: restore.attempts });
        } catch (error) {
          evidenceFailures.push(`${RESTORE_VERIFIED_MARKER} could not be written: ${errorText(error)} `
            + '(the setting itself is verified off, so the watchdog finds it already false)');
        }
        say(`${C4B_SETTING_KEY} OFF at ${deps.now().toISOString()}, verified on the writer and the control path`);
      }
    } finally {
      removeHandlers();
    }
  }
  if (stopReason !== null) halts.unshift(stopReason);
  halts.push(...evidenceFailures.splice(0));
  if (!restore.verified) {
    return finish({
      exitCode: 3,
      verdict: 'RESTORATION NOT VERIFIED',
      reasons: [`${C4B_SETTING_KEY} MAY STILL BE ON. The watchdog stays armed. Run at once: `
        + 'afl-api-c4b-rehearsal.ts --restore-only --evidence-dir <the same dir>, then confirm it reads false',
      ...restore.reads, ...halts],
    }, { label });
  }

  // 3. The automated HALT criteria, with the setting already off.
  // The setting is already restored and verified: a dependency that throws here becomes a HALT reason, nothing else.
  for (const unit of AFL_API_TIMERS) {
    try {
      const enabled = deps.systemctl('is-enabled', unit);
      const active = deps.systemctl('is-active', unit);
      if (enabled !== 'disabled' || active !== 'inactive') halts.push(`AFTER: ${unit} is ${enabled} / ${active}`);
    } catch (error) {
      halts.push(`AFTER: the state of ${unit} could not be read: ${errorText(error)}`);
    }
  }
  let after: RehearsalRecord | undefined;
  try {
    after = await deps.record(season);
  } catch (error) {
    halts.push(`the AFTER record could not be read: ${errorText(error)}`);
  }
  if (after !== undefined) {
    keep('after.json', `${JSON.stringify(after, null, 2)}\n`);
    halts.push(...recordDifferences(before, after).map((d) => `BEFORE/AFTER differ: ${d}`));
  }
  if (settleOutput !== null) halts.push(...dryRunHalts(settleOutput));
  if (label !== null) {
    try {
      const readiness = deps.readiness(season, `data/sources/afl_api/matches/${label}/00-season-matches.json`);
      keep('readiness.txt', `${readiness.lines.join('\n')}\n`);
      if (readiness.exitCode !== 0) halts.push(`readiness against the acquired feed exited ${readiness.exitCode} (NOT READY)`);
    } catch (error) {
      halts.push(`readiness against the acquired feed could not be evaluated: ${errorText(error)}`);
    }
  }
  // Evidence the C4b record is made from: its absence is a HALT, never a CLEAR.
  halts.push(...evidenceFailures.splice(0));
  if (halts.length > 0) return finish({ exitCode: 1, verdict: 'HALT', reasons: halts }, { label });
  return finish({
    exitCode: 0,
    verdict: 'CLEAR',
    reasons: ['every automated HALT criterion is clear; the setting is off and verified; both timers disabled. '
      + 'This is the evidence for the C4b record, not the record: C5 still needs the reviewed, recorded C4b PASS.'],
  }, { label });
}

/* ------------------------------------------------------------------ *
 * Recovery and the watchdog
 * ------------------------------------------------------------------ */

type RestoreDeps = Pick<C4bDeps, 'writeSetting' | 'readSetting' | 'controlSeesEnabled' | 'sleep' | 'log' | 'now'>;

async function alreadyOff(deps: RestoreDeps): Promise<boolean> {
  try {
    return isExactlyFalse(await deps.readSetting()) && !(await deps.controlSeesEnabled());
  } catch {
    return false;
  }
}

/** `--restore-only`: no write when it already reads exactly false; otherwise write it off and verify. */
export async function runRestoreOnly(deps: RestoreDeps, runId: string): Promise<0 | 3> {
  if (await alreadyOff(deps)) {
    deps.log(`${C4B_SETTING_KEY} already reads false on the writer and off on the control path; nothing written`);
    return 0;
  }
  const r = await restoreSettingOff(deps, { via: 'afl-api-c4b-rehearsal', step: 'restore-only', run_id: runId });
  for (const line of r.reads) deps.log(`  ${line}`);
  deps.log(r.verified ? `${C4B_SETTING_KEY} OFF, verified` : `${C4B_SETTING_KEY} RESTORATION NOT VERIFIED`);
  return r.verified ? 0 : 3;
}

export type WatchdogReadyMarker = {
  kind: typeof WATCHDOG_READY_KIND;
  runId: string;
  watchdogPid: number;
  parentPid: number;
  at: string;
};

export type WatchdogDeps = RestoreDeps & {
  processAlive: (pid: number) => boolean;
  restoreVerified: () => boolean;
  /** True once the parent has refused this run's startup and asked the watchdog to stand down. */
  standDownRequested: () => boolean;
  /** Atomically publishes the readiness marker, after proving the evidence location is writable. Throws. */
  publishReady: (marker: WatchdogReadyMarker) => void;
  writeEvidence: (name: string, content: string) => void;
};

/**
 * The watchdog's startup, run after its arguments are parsed and its production
 * dependencies built. Throws on any failure and publishes nothing then. Reads the
 * setting on both paths (the calls a restore needs), checks the parent is alive,
 * and only then publishes readiness. Returns 'parent-gone' (nothing published, the
 * monitor loop restores at once) when the parent has already ended.
 */
export async function watchdogStartup(
  args: { parentPid: number; runId: string; pid: number },
  deps: WatchdogDeps,
): Promise<'ready' | 'parent-gone'> {
  await deps.readSetting();
  await deps.controlSeesEnabled();
  if (!deps.processAlive(args.parentPid)) return 'parent-gone';
  deps.publishReady({
    kind: WATCHDOG_READY_KIND,
    runId: args.runId,
    watchdogPid: args.pid,
    parentPid: args.parentPid,
    at: deps.now().toISOString(),
  });
  return 'ready';
}

/** The watchdog process: startup, then the monitor loop. Exit 2 = startup failed, nothing published. */
export async function runWatchdogProcess(
  args: { parentPid: number; deadline: Date; runId: string; pid: number },
  deps: WatchdogDeps,
): Promise<0 | 2 | 3> {
  try {
    const started = await watchdogStartup(args, deps);
    deps.log(started === 'ready'
      ? `watchdog ${args.pid}: ready, monitoring parent ${args.parentPid}`
      : `watchdog ${args.pid}: parent ${args.parentPid} already gone; no readiness published`);
  } catch (error) {
    deps.log(`watchdog ${args.pid}: startup failed, readiness NOT published: ${errorText(error)}`);
    return 2;
  }
  return runWatchdog(args, deps);
}

/** Polls until the parent's verified restore, or restores itself once the parent is gone or late. */
export async function runWatchdog(
  args: { parentPid: number; deadline: Date; runId: string },
  deps: WatchdogDeps,
): Promise<0 | 3> {
  const lateAt = args.deadline.getTime() + WATCHDOG_GRACE_MS;
  const giveUpAt = lateAt + WATCHDOG_GIVE_UP_MS;
  // A lost log line or an unwritable evidence file must never end this loop: it is the last layer of restoration.
  const say = (line: string): void => {
    try { deps.log(line); } catch { /* the loop continues */ }
  };
  for (;;) {
    if (deps.restoreVerified()) return 0;
    if (deps.standDownRequested()) {
      say('watchdog: the parent refused this startup; standing down without any write');
      return 0;
    }
    const now = deps.now().getTime();
    const parentGone = !deps.processAlive(args.parentPid);
    if (parentGone || now > lateAt) {
      // The parent may have written either marker between the reads above.
      if (deps.restoreVerified()) return 0;
      if (deps.standDownRequested()) return 0;
      const reason = parentGone ? `parent ${args.parentPid} ended without a verified restore` : 'the deadline passed';
      const off = await alreadyOff(deps);
      const r = off
        ? { verified: true, attempts: 0, reads: ['already exactly false; nothing written'] }
        : await restoreSettingOff(deps, { via: 'afl-api-c4b-watchdog', step: 'watchdog', run_id: args.runId, reason });
      // The record is evidence, never a precondition: the outcome below is decided by the restore alone.
      let evidenceNote = '';
      try {
        deps.writeEvidence('watchdog-result.json',
          `${JSON.stringify({ reason, ...r, at: deps.now().toISOString() }, null, 2)}\n`);
      } catch (error) {
        evidenceNote = `; watchdog-result.json could not be written: ${errorText(error)}`;
      }
      say(`watchdog: ${reason}; ${r.verified ? 'setting off, verified' : 'RESTORATION NOT VERIFIED'}${evidenceNote}`);
      if (r.verified) return 0;
      if (deps.now().getTime() > giveUpAt) return 3;
      await deps.sleep(30_000);
      continue;
    }
    await deps.sleep(5_000);
  }
}

/* ------------------------------------------------------------------ *
 * The watchdog startup handshake, parent side
 * ------------------------------------------------------------------ */

export type ExpectedWatchdog = { runId: string; watchdogPid: number; parentPid: number };

export type ReadyAssessment = { state: 'pending' } | { state: 'ready' } | { state: 'refused'; reason: string };

/** Pure decision on the marker's text: only an exact match for this run and these two PIDs is ready. */
export function assessWatchdogReady(text: string | undefined, expected: ExpectedWatchdog): ReadyAssessment {
  if (text === undefined) return { state: 'pending' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { state: 'refused', reason: 'the readiness marker is not valid JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { state: 'refused', reason: 'the readiness marker is not a JSON object' };
  }
  const m = parsed as Record<string, unknown>;
  if (m.kind !== WATCHDOG_READY_KIND) return { state: 'refused', reason: 'the readiness marker is not a C4b watchdog readiness marker' };
  if (typeof m.at !== 'string' || Number.isNaN(new Date(m.at).getTime())) {
    return { state: 'refused', reason: 'the readiness marker has no valid timestamp' };
  }
  if (m.runId !== expected.runId) return { state: 'refused', reason: 'the readiness marker belongs to another run' };
  if (m.watchdogPid !== expected.watchdogPid) {
    return { state: 'refused', reason: `the readiness marker names watchdog PID ${JSON.stringify(m.watchdogPid ?? null)}, not ${expected.watchdogPid}` };
  }
  if (m.parentPid !== expected.parentPid) {
    return { state: 'refused', reason: `the readiness marker names parent PID ${JSON.stringify(m.parentPid ?? null)}, not ${expected.parentPid}` };
  }
  return { state: 'ready' };
}

export type ReadyWaitEffects = {
  /** The marker's text, undefined when absent. Throws on any other read failure. */
  readMarker: () => string | undefined;
  /** True only while the watchdog process is still running. */
  watchdogAlive: () => boolean;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
};

/**
 * Waits, bounded, for the matching marker from a watchdog that is still running.
 * Order matters: a marker is read first and the watchdog's liveness after it, so a
 * watchdog that published and then exited never counts as ready.
 */
export async function awaitWatchdogReady(
  effects: ReadyWaitEffects,
  expected: ExpectedWatchdog,
  timeoutMs: number,
  pollMs: number = WATCHDOG_READY_POLL_MS,
): Promise<{ ready: true } | { ready: false; reason: string }> {
  const startedAt = effects.now().getTime();
  for (;;) {
    let assessment: ReadyAssessment;
    try {
      assessment = assessWatchdogReady(effects.readMarker(), expected);
    } catch (error) {
      return { ready: false, reason: `the readiness marker could not be read: ${errorText(error)}` };
    }
    if (assessment.state === 'refused') return { ready: false, reason: assessment.reason };
    if (!effects.watchdogAlive()) {
      return {
        ready: false,
        reason: assessment.state === 'ready'
          ? 'the watchdog published readiness and then exited'
          : 'the watchdog exited before publishing readiness',
      };
    }
    if (assessment.state === 'ready') return { ready: true };
    if (effects.now().getTime() - startedAt >= timeoutMs) {
      return { ready: false, reason: `the watchdog did not publish readiness within ${Math.round(timeoutMs / 1000)} seconds` };
    }
    await effects.sleep(pollMs);
  }
}

export type WatchdogLaunch = {
  pid: number;
  /** Best effort: ask the process this tool started to end; resolves to whether it has. */
  stop: () => Promise<boolean>;
};

export type ArmEffects = ReadyWaitEffects & {
  runId: string;
  parentPid: number;
  /**
   * Starts the detached watchdog and returns the exact handle the moment the process
   * exists, doing nothing else fallible. Throws only when no process started.
   */
  launch: () => WatchdogLaunch;
  /**
   * Every other post-spawn step (detaching, the PID record, the start log). It runs
   * inside the cleanup-protected startup sequence: a throw stands the launched
   * watchdog down and stops that exact child.
   */
  afterLaunch: (launch: WatchdogLaunch) => void;
  /** Writes the stand-down marker for this run. Never deletes anything. */
  writeStandDown: (detail: { runId: string; watchdogPid: number | null; reason: string }) => void;
  log: (line: string) => void;
};

/**
 * Starts the watchdog and returns only once it has proved itself ready. On every
 * other outcome it stands the watchdog down where possible and throws a C4bError,
 * which the rehearsal turns into exit 2 before any setting write.
 */
export async function armWatchdogWithHandshake(
  effects: ArmEffects,
  timeoutMs: number = WATCHDOG_READY_TIMEOUT_MS,
  pollMs: number = WATCHDOG_READY_POLL_MS,
): Promise<void> {
  // A marker that exists before this run's watchdog starts is stale by definition.
  let existing: string | undefined;
  try {
    existing = effects.readMarker();
  } catch (error) {
    throw new C4bError(`the watchdog was not started: the readiness marker location could not be checked: ${errorText(error)}`);
  }
  if (existing !== undefined) {
    throw new C4bError('the watchdog was not started: a readiness marker already exists in the evidence directory (stale or reused).');
  }

  // From here a process exists and this handle is the only way to end it: every later step is protected.
  const launch = effects.launch();
  // A lost log line must never skip the stand-down or the stop.
  const note = (line: string): void => {
    try { effects.log(line); } catch { /* cleanup continues */ }
  };
  const expected: ExpectedWatchdog = { runId: effects.runId, watchdogPid: launch.pid, parentPid: effects.parentPid };
  const outcome = await (async (): Promise<{ ready: true } | { ready: false; reason: string }> => {
    try {
      effects.afterLaunch(launch);
    } catch (error) {
      return { ready: false, reason: `post-spawn startup work failed: ${errorText(error)}` };
    }
    const waited = await awaitWatchdogReady(effects, expected, timeoutMs, pollMs)
      .catch((error: unknown) => ({ ready: false as const, reason: `the readiness wait failed: ${errorText(error)}` }));
    if (!waited.ready) return waited;
    try {
      effects.log(`watchdog ready: pid ${launch.pid} proved run ${effects.runId}, parent ${effects.parentPid}`);
    } catch (error) {
      return { ready: false, reason: `post-spawn startup work failed: ${errorText(error)}` };
    }
    return waited;
  })();
  if (outcome.ready) return;
  try {
    effects.writeStandDown({ runId: effects.runId, watchdogPid: launch.pid, reason: outcome.reason });
  } catch (error) {
    note(`watchdog stand-down marker not written: ${errorText(error)}`);
  }
  let stopped = false;
  try {
    stopped = await launch.stop();
  } catch { /* reported below */ }
  note(`watchdog startup refused: ${outcome.reason}; watchdog ${launch.pid} ${stopped ? 'stopped' : 'NOT confirmed stopped (it honours the stand-down marker)'}`);
  throw new C4bError(`the watchdog did not become ready: ${outcome.reason}`);
}

/* ------------------------------------------------------------------ *
 * Production effects
 * ------------------------------------------------------------------ */

const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';

/** A marker's text, or undefined when the file does not exist. Any other failure throws. */
function readOptionalFile(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

/**
 * Temp file, read back, atomic rename. Proves the evidence location is writable and
 * readable, never overwrites an existing marker, and never deletes anything.
 */
export function publishWatchdogReady(evidenceDir: string, marker: WatchdogReadyMarker): void {
  const finalPath = join(evidenceDir, WATCHDOG_READY_MARKER);
  if (existsSync(finalPath)) throw new C4bError('a watchdog readiness marker already exists in the evidence directory.');
  const text = `${JSON.stringify(marker)}\n`;
  const tempPath = join(evidenceDir, `${WATCHDOG_READY_MARKER}.${marker.watchdogPid}.tmp`);
  writeFileSync(tempPath, text, { flag: 'wx' });
  if (readFileSync(tempPath, 'utf8') !== text) throw new C4bError('the evidence directory did not read back what was written.');
  renameSync(tempPath, finalPath);
}

/** True only when the stand-down marker exists and names this run. */
export function readStandDown(evidenceDir: string, runId: string): boolean {
  try {
    const text = readOptionalFile(join(evidenceDir, WATCHDOG_STAND_DOWN_MARKER));
    if (text === undefined) return false;
    const m = JSON.parse(text) as { kind?: unknown; runId?: unknown };
    return m.kind === WATCHDOG_STAND_DOWN_KIND && m.runId === runId;
  } catch {
    return false;
  }
}

/** `node --import <tsx loader>`: Node runs the script itself, so there is no `tsx` wrapper process between this tool and it. */
export function tsxLoaderArgs(projectRoot: string): string[] {
  return ['--import', pathToFileURL(join(projectRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href];
}

/** `node --import <tsx loader> <script> <args>`: the spawned PID is the script's own `process.pid`, so signals and exit status are its own. */
export function stepCommand(
  projectRoot: string,
  script: string,
  argv: readonly string[],
): { command: string; args: string[] } {
  return { command: process.execPath, args: [...tsxLoaderArgs(projectRoot), script, ...argv] };
}

/** `node --import <tsx loader> afl-api-c4b-rehearsal.ts --watchdog ...`: no wrapper process, so the spawned PID is the watchdog's own. */
export function watchdogCommand(
  projectRoot: string,
  scriptPath: string,
  parent: { pid: number; runId: string; evidenceDir: string; deadline: Date },
): { command: string; args: string[] } {
  return stepCommand(projectRoot, scriptPath, ['--watchdog', '--parent-pid', String(parent.pid),
    '--deadline', parent.deadline.toISOString(), '--evidence-dir', parent.evidenceDir, '--run-id', parent.runId]);
}

/**
 * The production watchdog adapter: real `spawn`, real files, real liveness. Used by
 * the tool, and by the tests with a stand-in command in place of the watchdog.
 */
export async function armWatchdogProcess(opts: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  evidenceDir: string;
  runId: string;
  parentPid: number;
  timeoutMs?: number;
  pollMs?: number;
  /** How often `stop()` re-checks that the child has exited (default 100 ms). */
  stopPollMs?: number;
  /** The process starter; the tests substitute a fake child for the failure paths a real one cannot be made to show. */
  spawnProcess?: typeof spawn;
  log: (line: string) => void;
}): Promise<void> {
  const { evidenceDir, runId } = opts;
  const stopPollMs = opts.stopPollMs ?? 100;
  const start = opts.spawnProcess ?? spawn;
  // Set only by the child's own `exit`. An `error` event is never proof of exit: a failed
  // `kill()` emits one while the process is still running.
  let exited = false;
  let child: ReturnType<typeof spawn> | undefined;
  const hasExited = (): boolean => exited
    || (child !== undefined && (child.exitCode !== null || child.signalCode !== null));
  const processAlive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  };
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  const effects: ArmEffects = {
    runId,
    parentPid: opts.parentPid,
    readMarker: () => readOptionalFile(join(evidenceDir, WATCHDOG_READY_MARKER)),
    watchdogAlive: () => !hasExited() && child?.pid !== undefined && processAlive(child.pid),
    now: () => new Date(),
    sleep,
    log: opts.log,
    launch: () => {
      // The handle is kept the instant the process exists; nothing fallible sits between spawn and return.
      const spawned = start(opts.command, opts.args, {
        cwd: opts.cwd, detached: true, stdio: 'ignore', env: opts.env, windowsHide: true,
      });
      child = spawned;
      try {
        spawned.on('exit', () => { exited = true; });
        // A listener must exist (an unhandled `error` event throws), but it proves nothing about the process.
        spawned.on('error', () => {});
      } catch (error) {
        // No handle will be returned, so end the exact child here rather than orphan it.
        try { spawned.kill('SIGKILL'); } catch { /* nothing more can be done with it */ }
        throw error;
      }
      const pid = spawned.pid;
      if (pid === undefined) throw new C4bError('the watchdog process did not start.');
      return {
        pid,
        stop: async () => {
          // Only the handle this tool created: an exited child is never signalled, so a reused PID is safe.
          // Confirmed only by an actual exit; a signal that could not be delivered leaves the child running.
          if (hasExited()) return true;
          try { spawned.kill('SIGTERM'); } catch { /* checked below */ }
          for (let i = 0; i < 20 && !hasExited(); i += 1) await sleep(stopPollMs);
          if (!hasExited()) {
            try { spawned.kill('SIGKILL'); } catch { /* checked below */ }
            for (let i = 0; i < 20 && !hasExited(); i += 1) await sleep(stopPollMs);
          }
          return hasExited();
        },
      };
    },
    afterLaunch: ({ pid }) => {
      child?.unref();
      writeFileSync(join(evidenceDir, 'watchdog.pid'), `${pid}\n`);
      opts.log(`watchdog started: pid ${pid}; waiting for it to prove readiness`);
    },
    writeStandDown: (detail) => {
      writeFileSync(join(evidenceDir, WATCHDOG_STAND_DOWN_MARKER),
        `${JSON.stringify({ kind: WATCHDOG_STAND_DOWN_KIND, ...detail, at: new Date().toISOString() })}\n`, { flag: 'wx' });
    },
  };
  await armWatchdogWithHandshake(effects, opts.timeoutMs, opts.pollMs);
}

export type ChildStepOptions = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  abort: AbortSignal;
  /** Every complete output line, as it arrives. */
  onLine?: (line: string) => void;
  /** The process starter; the tests substitute a fake child for the failure paths a real one cannot be made to show. */
  spawnProcess?: typeof spawn;
  /** SIGTERM to SIGKILL (default 10 s). */
  termGraceMs?: number;
  /** After SIGKILL, how long to wait for the exit before reporting the step unconfirmed (default 10 s). */
  killWaitMs?: number;
  /** After the child's exit, how long to wait for its output pipes to close (default 5 s). */
  drainMs?: number;
};

/**
 * Runs one step to completion. Once the process exists, only its own exit (or close)
 * ends the step: an `error` event is never proof of it, because a failed `kill()`
 * emits one while the child keeps running. An abort sends SIGTERM, then SIGKILL, through
 * the child handle only, and a child that still has not exited after that is reported
 * `unconfirmed` rather than finished. An already-exited child is never signalled.
 *
 * Every terminal path (a close, an exit followed by the drain deadline, an unconfirmed
 * termination, a spawn failure, a throw while setting the step up) releases the output
 * pipes: both streams are destroyed and the child handle is unref'd, so a descendant
 * that still holds the inherited descriptors cannot keep this process alive once the
 * result has been produced. Output is kept up to that point. A process that cannot be
 * shown to have ended is never reported as stopped.
 */
export function runChildStep(opts: ChildStepOptions): Promise<StepResult> {
  const start = opts.spawnProcess ?? spawn;
  const termGraceMs = opts.termGraceMs ?? 10_000;
  const killWaitMs = opts.killWaitMs ?? 10_000;
  const drainMs = opts.drainMs ?? 5_000;
  const onLine = (line: string): void => {
    try { opts.onLine?.(line); } catch { /* a lost log line never ends a step */ }
  };
  return new Promise((resolveStep) => {
    let child: ReturnType<typeof spawn> | undefined;
    let output = '';
    let settled = false;
    let exited = false;
    const timers = new Set<NodeJS.Timeout>();
    const later = (ms: number, fn: () => void): void => {
      const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
      timers.add(t);
    };
    const hasExited = (): boolean => exited
      || (child !== undefined && (child.exitCode !== null || child.signalCode !== null));
    const signalChild = (signal: NodeJS.Signals): void => {
      try { child?.kill(signal); } catch { /* confirmed (or not) by the exit below */ }
    };
    // Each release is attempted on its own, so one that throws never leaves the others undone.
    const releasePipes = (): void => {
      for (const stream of [child?.stdout, child?.stderr]) {
        try { stream?.destroy(); } catch { /* best effort */ }
      }
      try { child?.unref(); } catch { /* best effort */ }
    };
    const finish = (result: StepResult): void => {
      if (settled) return;
      settled = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      opts.abort.removeEventListener('abort', onAbort);
      releasePipes();
      resolveStep(result);
    };
    function onAbort(): void {
      if (hasExited()) return;
      signalChild('SIGTERM');
      later(termGraceMs, () => {
        if (hasExited()) return;
        signalChild('SIGKILL');
        later(killWaitMs, () => {
          if (hasExited()) return;
          // Cannot be shown stopped: release its pipes (in `finish`) and let the tool end, but do not call it finished.
          finish({ exitCode: null, signal: null, output, unconfirmed: true });
        });
      });
    }

    try {
      child = start(opts.command, opts.args, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      finish({ exitCode: 1, signal: null, output: '(could not start the step)' });
      return;
    }
    const spawned = child;
    const take = (chunk: Buffer): void => {
      const text = chunk.toString('utf8');
      output += text;
      for (const line of text.split(/\r?\n/)) if (line) onLine(line);
    };
    try {
      spawned.stdout?.on('data', take);
      spawned.stderr?.on('data', take);
      spawned.on('error', () => {
        // No process exists: nothing to wait for. Otherwise this proves nothing about the child.
        if (spawned.pid === undefined) finish({ exitCode: 1, signal: null, output: `${output}\n(could not start the step)` });
      });
      spawned.on('exit', (code, signal) => {
        exited = true;
        // Output pipes can be held open by a grandchild; do not wait for them forever (`finish` then releases them).
        later(drainMs, () => finish({ exitCode: code, signal, output }));
      });
      spawned.on('close', (code, signal) => finish({ exitCode: code, signal, output }));
      if (opts.abort.aborted) onAbort(); else opts.abort.addEventListener('abort', onAbort, { once: true });
    } catch {
      // A process exists but could not be monitored: end it through the handle, and report it stopped only if the handle shows it.
      if (!hasExited()) signalChild('SIGKILL');
      finish(hasExited()
        ? { exitCode: spawned.exitCode, signal: spawned.signalCode, output }
        : { exitCode: null, signal: null, output, unconfirmed: true });
    }
  });
}

async function withSql<T>(dsnEnv: string, fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const dsn = process.env[dsnEnv];
  if (!dsn) throw new C4bError(`${dsnEnv} is not set.`);
  const sql = postgres(dsn, {
    max: 1, connect_timeout: 10, onnotice: () => {}, transform: { undefined: null },
    connection: { statement_timeout: 15_000 },
  });
  try {
    return await fn(sql);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch { /* never replace the result with a driver message */ }
  }
}

function productionDeps(projectRoot: string, evidenceDir: string, runId: string): C4bDeps & WatchdogDeps {
  const log = (line: string): void => {
    try { appendFileSync(join(evidenceDir, 'run.log'), `${new Date().toISOString()} ${line}\n`); } catch { /* evidence is best effort */ }
    try { console.log(line); } catch { /* a lost terminal must not stop restoration */ }
  };
  const projectFile = (rel: string): string | undefined => {
    try { return readFileSync(join(projectRoot, rel), 'utf8'); } catch { return undefined; }
  };
  return {
    log,
    projectFile,
    systemctl: (verb, unit) => {
      const r = spawnSync('systemctl', [verb, unit], { encoding: 'utf8' });
      return (r.stdout ?? '').trim() || `unknown (exit ${String(r.status)})`;
    },
    sameDatabase: async () => {
      const id = (dsnEnv: string) => withSql(dsnEnv,
        (sql) => sql<AflApiDatabaseIdentity[]>`SELECT current_database() AS database, current_user AS role`);
      const [writer] = await id('AFLDB_AUTH_DATABASE_URL');
      const [control] = await id('DATABASE_URL');
      if (!writer || !control) throw new C4bError('a live database identity query returned no row.');
      try {
        requireSameAflApiDatabase(control, writer);
      } catch {
        throw new C4bError(`the setting's writer names database '${writer.database}' but the control path names `
          + `'${control.database}'.`);
      }
    },
    readSetting: () => withSql('AFLDB_AUTH_DATABASE_URL', async (sql) => {
      const rows = await sql<{ value: string }[]>`SELECT value::text AS value FROM site_settings WHERE key = ${C4B_SETTING_KEY}`;
      return rows[0] ? { present: true, value: rows[0].value } : { present: false };
    }),
    controlSeesEnabled: async () => {
      const controls = await readAflApiIngestionControls(process.env);
      if (controls.readFailure) throw new C4bError(`the control path could not be read: ${controls.readFailure}`);
      return controls.currentSeasonEnabled;
    },
    writeSetting: (enabled, detail) => withSql('AFLDB_AUTH_DATABASE_URL', async (sql) => {
      await sql.begin(async (tx) => {
        await tx`
          INSERT INTO site_settings (key, value, updated_by)
          VALUES (${C4B_SETTING_KEY}, ${JSON.stringify(enabled)}::jsonb, NULL)
          ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
        `;
        await tx`
          INSERT INTO auth_audit_log (actor_user_id, actor_label, action, detail, ip)
          VALUES (NULL, 'afl-api-c4b-rehearsal', 'current_season.afl_api_ingestion_set',
                  ${tx.json({ enabled, ...detail } as postgres.JSONValue)}, NULL)
        `;
      });
    }),
    record: (season) => withSql('DATABASE_URL', (sql) => sql.begin('read only', async (tx) => {
      const [matches] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM matches WHERE season = ${season}`;
      const [owned] = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM matches m JOIN sources s ON s.id = m.source_id WHERE s.key = 'afl_api'`;
      const settings = await tx<{ key: string; value: string }[]>`
        SELECT key, value::text AS value FROM site_settings WHERE key LIKE 'acquisition.%' ORDER BY key`;
      return {
        matchesInSeason: matches?.n ?? -1,
        aflApiOwnedMatches: owned?.n ?? -1,
        acquisitionSettings: Object.fromEntries(settings.map((r) => [r.key, r.value])),
      };
    })),
    runStep: (script, argv, abort) => {
      let env: Record<string, string>;
      try {
        env = childEnvironment(process.env, projectFile(AFL_API_SERVICE_FILE));
      } catch (error) {
        return Promise.resolve({ exitCode: 1, signal: null, output: errorText(error) });
      }
      log(`RUN ${script} ${argv.join(' ')}`);
      // The loader runs the script in the spawned process itself, so the PID being monitored and signalled is the script's.
      const { command, args } = stepCommand(projectRoot, script, argv);
      return runChildStep({
        command,
        args,
        cwd: projectRoot,
        env: env as NodeJS.ProcessEnv,
        abort,
        onLine: (line) => log(`  | ${line}`),
      });
    },
    readiness: (season, feedPath) => {
      const r = runAflApiCutoverReadiness(['--season', String(season), '--season-feed', feedPath], projectRoot);
      return { exitCode: r.exitCode, lines: r.lines };
    },
    armWatchdog: async (deadline) => {
      const { command, args } = watchdogCommand(projectRoot, __filename,
        { pid: process.pid, runId, evidenceDir, deadline });
      await armWatchdogProcess({
        command, args, cwd: projectRoot, env: process.env, evidenceDir, runId, parentPid: process.pid, log,
      });
      log(`watchdog armed and proven ready; it acts after ${new Date(deadline.getTime() + WATCHDOG_GRACE_MS).toISOString()} or when this process ends`);
    },
    markRestoreVerified: (detail) => {
      writeFileSync(join(evidenceDir, RESTORE_VERIFIED_MARKER), `${JSON.stringify({ ...detail, at: new Date().toISOString() })}\n`);
    },
    restoreVerified: () => existsSync(join(evidenceDir, RESTORE_VERIFIED_MARKER)),
    standDownRequested: () => readStandDown(evidenceDir, runId),
    publishReady: (marker) => publishWatchdogReady(evidenceDir, marker),
    writeEvidence: (name, content) => writeFileSync(join(evidenceDir, name), content),
    onInterrupt: (handler) => {
      const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
      const listeners = signals.map((s) => [s, () => handler(s)] as const);
      for (const [s, fn] of listeners) process.on(s, fn);
      return () => { for (const [s, fn] of listeners) process.off(s, fn); };
    },
    scheduleDeadline: (ms, fn) => {
      const t = setTimeout(fn, ms);
      return () => clearTimeout(t);
    },
    processAlive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EPERM';
      }
    },
    now: () => new Date(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

/**
 * Exit codes are decided here, never by an unhandled rejection. Setup (arguments, the
 * evidence directory, the environment) runs before any write, so its failure is a
 * refusal (2); `--restore-only` did not restore, so its setup failure is 3. An error
 * that escapes the run itself leaves the setting's state unproved, so it is 3 as well:
 * run `--restore-only`, which writes nothing when the setting already reads false.
 */
export async function main(argv: string[]): Promise<number> {
  // A lost terminal (SSH hangup) must not turn a console write into a crash before the restore.
  process.stdout.on('error', () => {});
  process.stderr.on('error', () => {});
  let args: C4bArgs;
  try {
    args = parseC4bArgs(argv);
  } catch (error) {
    console.error(errorText(error));
    console.error(C4B_USAGE);
    return 2;
  }
  let evidenceDir: string;
  let runId: string;
  let deps: C4bDeps & WatchdogDeps;
  try {
    evidenceDir = resolve(args.evidenceDir);
    if (args.mode === 'rehearse' && existsSync(evidenceDir) && readdirSync(evidenceDir).length > 0) {
      console.error(`--evidence-dir ${evidenceDir} is not empty; every C4b run gets its own directory.`);
      return 2;
    }
    // The watchdog never creates the directory: one that is missing is a startup failure, not something to repair.
    if (args.mode === 'watchdog' && !existsSync(evidenceDir)) {
      console.error(`--evidence-dir ${evidenceDir} does not exist; the watchdog does not start.`);
      return 2;
    }
    mkdirSync(evidenceDir, { recursive: true });
    loadEnv(DEFAULT_PROJECT_ROOT);
    runId = args.mode === 'watchdog'
      ? args.runId
      : `c4b-${new Date().toISOString().replace(/[:.]/g, '')}-${process.pid}`;
    deps = productionDeps(DEFAULT_PROJECT_ROOT, evidenceDir, runId);
  } catch (error) {
    console.error(`setup failed before any setting write: ${errorText(error)}`);
    return args.mode === 'restore-only' ? 3 : 2;
  }
  try {
    if (args.mode === 'watchdog') {
      return await runWatchdogProcess({ parentPid: args.parentPid, deadline: args.deadline, runId, pid: process.pid }, deps);
    }
    if (args.mode === 'restore-only') return await runRestoreOnly(deps, runId);
    deps.log(`AFLDB-ISSUE-316 C4b rehearsal ${runId}: season ${args.season}, decision ${C4B_DECISION}, `
      + `deadline ${args.maxMinutes} minute(s), evidence ${evidenceDir}`);
    return (await runC4bRehearsal({ season: args.season, maxMinutes: args.maxMinutes, runId }, deps)).exitCode;
  } catch (error) {
    console.error(`unexpected error (${errorText(error)}): the setting's state is not proved. `
      + 'Run --restore-only --evidence-dir <the same dir> and confirm it reads false.');
    return 3;
  }
}

const invokedDirectly = process.argv[1] !== undefined
  && relative(resolve(process.argv[1]), __filename) === '';

if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, () => { process.exitCode = 3; });
}
