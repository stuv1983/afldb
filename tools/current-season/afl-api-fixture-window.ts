#!/usr/bin/env node
/**
 * AFLDB-ISSUE-229 F-229-SWITCH — the BOUNDED TEMPORARY ENABLE of
 * `acquisition.afl_api_current_season_enabled` for the FIRST 2027 fixture apply (block M3), as ONE command.
 *
 * WHY A WINDOW. `settle-afl-api-fixture-schedule.ts` refuses `--dry-run` and `--apply` unless the switch reads true,
 * through a SEPARATE `afldb_app` connection (afl-api-ingestion-control.ts). An enable inside the writer's own
 * transaction is therefore invisible to the gate, and a bypass flag would weaken the contract, so no transaction-scoped
 * route exists without weakening it. The existing, proven mechanism is C4b's bounded window (preconditions, BEFORE record,
 * detached watchdog, three-layer restore). This tool reuses those exact primitives and adds what a WRITING window needs.
 *
 *   node --import tsx tools/current-season/afl-api-fixture-window.ts \
 *     --label <fixtures-only-snapshot> --expect-initial absent|false --expect-created <N> \
 *     --expect-feed-sha256 <64 hex> --decision "<owner approval reference, 20+ characters>" \
 *     --evidence-dir <new or empty dir> [--max-minutes <5-60>] [--check-only]
 *   ... --restore-only --evidence-dir <dir>      force the setting off and verify it (recovery)
 *
 * ABSENT SYSTEMD UNITS ARE NOT PROOF. The AFL API units not being installed says nothing about a cron line, an `at` job,
 * another unit with another name, a shell another operator is typing in, an admin promotion running as the import role,
 * or a second Super Admin pressing the toggle. So the preconditions are an INVENTORY, each source recorded:
 *   - systemd: timers, running services and unit files that name a switch consumer; unit states `not-found` are recorded
 *     as exactly that and never as "safe";
 *   - cron, /etc/cron.d, `at`;
 *   - the process table: no process running any switch consumer;
 *   - the database: no other session in this database as `afldb_import` or `afldb_owner` (the roles that write);
 *   - a session-level advisory lock held for the whole window, so a second window or tool refuses, and which dies with
 *     the process;
 *   - the audit trail: afterwards, every `current_season.afl_api_ingestion_set` row since BEFORE must carry this run's id;
 *     a foreign row means another operator toggled the switch inside the window and the run HALTs.
 * The consumers are a REVIEWED REGISTRY (SWITCH_REFERENCES): a test fails when a new file reads the switch, so a new entry
 * point cannot appear without this protocol being re-read. The inventory is re-taken immediately before the apply.
 *
 * EXPECTED INITIAL STATE. `--expect-initial absent|false` must equal the stored state exactly (the admin toggle's
 * double-encoded JSON string `"false"` and a real boolean both normalise to `false`; the RAW stored text is recorded).
 * `true`, a number or anything else refuses before any write.
 *
 * SEQUENCE. validate-only (offline, no connection, the feed hash re-checked) -> preconditions -> BEFORE record -> lock ->
 * watchdog armed AND PROVEN READY -> switch ON -> `--dry-run` must report exactly `created=<N>`, rolled back, fixtures
 * unchanged -> inventory again -> `--apply` must report exactly `created=<N>` -> switch OFF, verified on the writer and the
 * control path -> AFTER record, audit reconciliation, fixtures = BEFORE + N -> `transition.json`.
 *
 * RESTORATION (restoreSettingOff, the C4b loop): after success, a refusal by the settle tool, an error, a signal, the
 * deadline, and, via the detached C4b watchdog (this tool arms `afl-api-c4b-rehearsal.ts --watchdog`), the death of this
 * process. The restored value is a real boolean `false`; an `absent` start therefore ends as an explicit `false` row,
 * which C4b and the application's reader accept (recorded, not hidden).
 *
 * Not authorised by this file: running it. Exit: 0 CLEAR; 1 HALT (restored and verified); 2 refused before any write;
 * 3 RESTORATION NOT VERIFIED (run `--restore-only`).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import { parseAfltablesNetworkStatus } from '../../src/lib/acquisition/afltables-network';
import * as c4b from './afl-api-c4b-rehearsal';
import { loadEnv } from './load-env';

const __filename = fileURLToPath(import.meta.url);
const DEFAULT_PROJECT_ROOT = join(dirname(__filename), '..', '..');

export const FIXTURE_WINDOW_SCRIPT = 'tools/current-season/settle-afl-api-fixture-schedule.ts';
export const SWITCH_KEY = c4b.C4B_SETTING_KEY;
export const AUDIT_ACTION = 'current_season.afl_api_ingestion_set';
export const WINDOW_LOCK_KEYS = [717276, 1] as const;
/** Database roles that WRITE; their sessions in this database other than ours block the window. */
export const WRITER_ROLES = ['afldb_import', 'afldb_owner'] as const;

/**
 * Every non-test source file that references the switch, REVIEWED. `writer-cli` entries are the processes the inventory looks
 * for. tests/afl-api-cutover.test.ts fails when the repository's references and this list differ.
 */
export const SWITCH_REFERENCES: Readonly<Record<string, 'writer-cli' | 'toggle-ui' | 'reader' | 'tooling' | 'unit'>> = Object.freeze({
  'src/app/admin/current-season/AflApiIngestionControls.tsx': 'toggle-ui',
  'src/app/admin/current-season/actions.ts': 'toggle-ui',
  'src/app/admin/current-season/page.tsx': 'toggle-ui',
  'src/lib/acquisition/afl-api-ingestion-control.ts': 'reader',
  'src/lib/acquisition/afl-api-ingestion-safety.ts': 'reader',
  'src/lib/site-settings.ts': 'reader',
  'deploy/afldb-settle-afl-api.service': 'unit',
  'deploy/afldb-settle-afl-api-brownlow.service': 'unit',
  'tools/current-season/acquire-afl-api.ts': 'writer-cli',
  'tools/current-season/acquire-afl-api-brownlow.ts': 'writer-cli',
  'tools/current-season/discover-afl-api-seasons.ts': 'writer-cli',
  'tools/current-season/settle-afl-api-fixture-schedule.ts': 'writer-cli',
  'tools/current-season/settle-afl-api-fixtures.ts': 'writer-cli',
  'tools/current-season/settle-afl-api.ts': 'writer-cli',
  'tools/current-season/settle-afl-api-brownlow.ts': 'writer-cli',
  'tools/current-season/afl-api-c4b-rehearsal.ts': 'tooling',
  'tools/current-season/afl-api-fixture-window.ts': 'tooling',
  'tools/db/prepare-promotion-source.ts': 'tooling',
  'tools/db/promotion-source-dependencies.ts': 'tooling',
  'tools/db/promotion-source-dependency-rehearsal.ts': 'tooling',
  'tools/v2/c4b-isolated-e2e.mts': 'tooling',
  'tools/v2/fixture-window-isolated-e2e.mts': 'tooling',
});

/** A process or scheduler line that runs a switch consumer. The Brownlow settle unit is matched too (conservative). */
export const CONSUMER_PATTERN = /(?:acquire-afl-api|discover-afl-api-seasons|settle-afl-api-fixture-schedule|settle-afl-api-fixtures|settle-afl-api)/;

/** Where systemd unit files live; every .timer/.service text here is read for a switch consumer. */
export const SYSTEMD_UNIT_DIRS = ['/etc/systemd/system', '/run/systemd/system', '/usr/lib/systemd/system', '/lib/systemd/system'] as const;

/**
 * The switch as the application reads it: the admin toggle stores the JSON STRING `"false"`, a real boolean stores `false`; both are `false`.
 * `readSetting` returns the stored text unchanged, so every comparison goes through here.
 */
export const stateOf = (s: c4b.SettingValue): string => (s.present ? c4b.normaliseStoredSetting(s.value) : 'absent');

/** A refusal or HALT reason written by this tool: safe to print in full. */
export class WindowError extends Error {}
export function errorText(error: unknown): string {
  if (error instanceof WindowError) return error.message;
  return c4b.errorText(error);
}

/* ------------------------------------------------------------------ *
 * Arguments
 * ------------------------------------------------------------------ */

export type WindowArgs =
  | { mode: 'run' | 'check-only'; label: string; expectInitial: 'absent' | 'false'; expectCreated: number; expectFeedSha256: string; decision: string; evidenceDir: string; maxMinutes: number }
  | { mode: 'restore-only'; evidenceDir: string };

export const WINDOW_USAGE = 'Usage: afl-api-fixture-window.ts --label <snapshot> --expect-initial absent|false --expect-created <N> '
  + '--expect-feed-sha256 <64 hex> --decision "<reference>" --evidence-dir <new or empty dir> [--max-minutes <5-60>] [--check-only]'
  + '  |  --restore-only --evidence-dir <dir>';

export function parseWindowArgs(argv: readonly string[]): WindowArgs {
  const known = new Set(['--label', '--expect-initial', '--expect-created', '--expect-feed-sha256', '--decision', '--evidence-dir', '--max-minutes', '--check-only', '--restore-only']);
  const flags = new Set(['--check-only', '--restore-only']);
  for (let i = 0; i < argv.length; i += 1) {
    if (!known.has(argv[i])) throw new WindowError(`Unknown argument '${argv[i]}'.`);
    if (!flags.has(argv[i])) i += 1;
  }
  const valueOf = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    if (i >= 0 && argv.indexOf(flag, i + 1) >= 0) throw new WindowError(`${flag} was given more than once.`);
    const v = i >= 0 ? argv[i + 1] : undefined;
    return v === undefined || v.startsWith('--') ? undefined : v;
  };
  const evidenceDir = valueOf('--evidence-dir');
  if (evidenceDir === undefined) throw new WindowError('--evidence-dir <dir> is required.');
  if (argv.includes('--restore-only')) return { mode: 'restore-only', evidenceDir };
  const label = valueOf('--label');
  if (!label || !/^[A-Za-z0-9_-]+$/.test(label)) throw new WindowError('--label must be a snapshot directory name.');
  const expectInitial = valueOf('--expect-initial');
  if (expectInitial !== 'absent' && expectInitial !== 'false') throw new WindowError('--expect-initial must be exactly absent or false (the state the switch is expected to be in now).');
  const created = Number(valueOf('--expect-created'));
  if (!Number.isInteger(created) || created < 1 || created > 5000) throw new WindowError('--expect-created must be the whole number of fixtures the dry-run is expected to create.');
  const feed = valueOf('--expect-feed-sha256');
  if (!feed || !/^[0-9a-f]{64}$/.test(feed)) throw new WindowError('--expect-feed-sha256 must be the 64-hex sha256 of the snapshot\'s 00-season-matches.json.');
  const decision = valueOf('--decision');
  if (!decision || decision.trim().length < 20) throw new WindowError('--decision must quote the owner approval reference (20 or more characters).');
  const rawMinutes = valueOf('--max-minutes');
  const maxMinutes = rawMinutes === undefined ? 15 : Number(rawMinutes);
  if (!Number.isInteger(maxMinutes) || maxMinutes < 5 || maxMinutes > 60) throw new WindowError('--max-minutes must be a whole number from 5 to 60.');
  return { mode: argv.includes('--check-only') ? 'check-only' : 'run', label, expectInitial, expectCreated: created, expectFeedSha256: feed, decision: decision.trim(), evidenceDir, maxMinutes };
}

/* ------------------------------------------------------------------ *
 * Pure helpers
 * ------------------------------------------------------------------ */

export type InventoryLine =
  | { source: 'process'; pid: number; text: string }
  | { source: 'systemd-timer' | 'systemd-service' | 'systemd-unit-file' | 'systemd-unit' | 'cron' | 'at'; text: string }
  | { source: 'session'; pid: number; role: string; state: string | null };
export type Inventory = {
  lines: InventoryLine[];
  /** Sources that could not be read for a reason other than "the mechanism is not installed". Any entry refuses. */
  unreadable: string[];
  /** Mechanisms confirmed not installed (for example no `at`). Recorded; never counted as safety. */
  notInstalled: string[];
};

/** The reasons the window must not open (or continue). Empty means this inventory shows no other writer. */
export function writerFindings(inventory: Inventory, own: ReadonlySet<number>): string[] {
  const out: string[] = [];
  for (const source of inventory.unreadable) out.push(`the inventory source '${source}' could not be read, so it proves nothing`);
  for (const line of inventory.lines) {
    if (line.source === 'process') {
      if (!own.has(line.pid) && CONSUMER_PATTERN.test(line.text)) out.push(`process ${line.pid} is running a switch consumer: ${line.text.slice(0, 140)}`);
    } else if (line.source === 'session') {
      // A session pid is a database backend pid, a different number space from `own` (operating-system pids): never compared.
      if ((WRITER_ROLES as readonly string[]).includes(line.role)) {
        out.push(`another database session (pid ${line.pid}) is connected as ${line.role}${line.state ? ` (${line.state})` : ''}`);
      }
    } else if (line.source === 'systemd-unit-file') {
      // A raw list-unit-files row is '<unit> <state> <preset>': only the unit NAME and its state (column 2) are read.
      const [unit = '', state = ''] = line.text.trim().split(/\s+/);
      if (CONSUMER_PATTERN.test(unit) && unit.endsWith('.timer') && /^(enabled|enabled-runtime|linked|linked-runtime|alias|static|generated|transient)$/.test(state)) {
        out.push(`a switch-consumer timer is installed and would start: ${line.text.trim().slice(0, 140)}`);
      }
    } else if (line.source === 'systemd-unit') {
      // A composed row: '<unit> <is-enabled> <is-active> <ExecStart lines>'. A unit that runs a switch consumer matters when it can start.
      const [unit = '', enabled = '', active = ''] = line.text.trim().split(/\s+/);
      const startable = unit.endsWith('.timer')
        ? /^(enabled|enabled-runtime|linked|linked-runtime|alias|static|generated|transient)$/.test(enabled) || /^(active|activating)$/.test(active)
        : /^(enabled|enabled-runtime)$/.test(enabled) || /^(active|activating)$/.test(active);
      if (startable && CONSUMER_PATTERN.test(line.text)) out.push(`a unit that runs a switch consumer can start: ${line.text.trim().slice(0, 140)}`);
    } else if (CONSUMER_PATTERN.test(line.text)) {
      out.push(`${line.source} names a switch consumer: ${line.text.trim().slice(0, 140)}`);
    }
  }
  return out;
}

/** `Actions: created=218` -> { created: 218 }. Missing is not zero. */
export function parseActions(output: string): Record<string, number> | null {
  const line = output.match(/^Actions: (.+)$/m)?.[1];
  if (line === undefined) return null;
  const out: Record<string, number> = {};
  for (const part of line.split(',')) {
    const m = part.trim().match(/^([a-z_]+)=(\d+)$/);
    if (!m) return null;
    out[m[1]] = Number(m[2]);
  }
  return out;
}

/** Exactly the expected outcome and the expected `created` count, with no other action and no refusal. */
export function stepOutcomeProblem(name: string, output: string, wantStatus: 'dry_run' | 'applied', expectCreated: number): string | null {
  const status = output.match(/^Outcome: (\S+)/m)?.[1];
  if (status !== wantStatus) return `${name}: outcome was ${status ?? 'absent'}, not ${wantStatus}`;
  if (/^\s*REFUSED\b/m.test(output)) return `${name}: the tool reported a refusal`;
  const actions = parseActions(output);
  if (actions === null) return `${name}: no parsable Actions line`;
  const keys = Object.keys(actions);
  if (keys.length !== 1 || keys[0] !== 'created' || actions.created !== expectCreated) {
    return `${name}: actions were ${JSON.stringify(actions)}, not exactly created=${expectCreated}`;
  }
  return null;
}

export type AuditRow = { id: number; actorLabel: string | null; detail: Record<string, unknown> };

/** Every switch-audit row since BEFORE must be ours; the first must switch it on and the last off. Foreign rows mean a concurrent toggle. */
export function auditProblems(rows: readonly AuditRow[], runId: string): string[] {
  const out: string[] = [];
  const foreign = rows.filter((r) => r.detail.run_id !== runId);
  if (foreign.length > 0) out.push(`${foreign.length} switch-audit row(s) were written by something other than this run (ids ${foreign.map((r) => r.id).join(', ')}): a concurrent toggle`);
  const ours = rows.filter((r) => r.detail.run_id === runId);
  if (ours.length < 2) out.push(`expected an ON and an OFF audit row for this run, found ${ours.length}`);
  else {
    if (ours[0].detail.enabled !== true) out.push('the first audit row of this run is not the switch-on');
    if (ours[ours.length - 1].detail.enabled !== false) out.push('the last audit row of this run is not the switch-off');
    let seenOff = false;
    for (const r of ours) {
      if (r.detail.enabled === false) seenOff = true;
      else if (seenOff) out.push('the switch was turned on again after this run turned it off');
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The window, over injected effects
 * ------------------------------------------------------------------ */

export type Counts = { fixtures: number; matches: number };

export type WindowDeps = Pick<c4b.C4bDeps,
  'log' | 'projectFile' | 'systemctl' | 'sameDatabase' | 'readSetting' | 'controlSeesEnabled' | 'writeSetting' | 'runStep' | 'armWatchdog'
  | 'markRestoreVerified' | 'writeEvidence' | 'onInterrupt' | 'scheduleDeadline' | 'now' | 'sleep'> & {
  fileSha256: (rel: string) => string | undefined;
  /** The raw stored text (`site_settings.value::text`), or null when absent. */
  rawSetting: () => Promise<string | null>;
  inventory: () => Promise<Inventory>;
  /** The pids that belong to this run (this process, its parent, the watchdog, a running step); they are never findings. */
  ownPids: () => ReadonlySet<number>;
  holdWindowLock: () => Promise<{ release: () => Promise<void> } | null>;
  counts: () => Promise<Counts>;
  maxAuditId: () => Promise<number>;
  auditSince: (id: number) => Promise<AuditRow[]>;
};

export type WindowOutcome = c4b.C4bOutcome;

async function preconditions(args: Extract<WindowArgs, { label: string }>, deps: WindowDeps): Promise<{ problems: string[]; notes: Record<string, unknown> }> {
  const problems: string[] = [];
  const notes: Record<string, unknown> = {};
  const json = (rel: string): unknown => { try { return JSON.parse(deps.projectFile(rel) ?? ''); } catch { return undefined; } };
  // 1. The pinned feed, offline.
  const feedRel = `data/sources/afl_api/fixtures/${args.label}/00-season-matches.json`;
  const feedSha = deps.fileSha256(feedRel);
  notes.feedSha256 = feedSha ?? null;
  if (feedSha !== args.expectFeedSha256) problems.push(`the snapshot's 00-season-matches.json sha256 is ${feedSha ?? 'unreadable'}, not the approved ${args.expectFeedSha256}`);
  // 2. The AFL Tables switch is retired, so that settle cannot be a concurrent writer.
  const seasons = json('data/reference/seasons.json');
  const network = parseAfltablesNetworkStatus(json('data/reference/afltables-network.json'), seasons);
  if (network !== 'retired') problems.push(`the AFL Tables switch reads '${network}', not an explicit 'retired'`);
  // 3. systemd, recorded exactly. `not-found` is a fact about the unit, not proof about the host.
  const units: Record<string, string> = {};
  for (const unit of c4b.AFL_API_TIMERS) {
    for (const verb of ['is-enabled', 'is-active'] as const) {
      try { units[`${unit} ${verb}`] = deps.systemctl(verb, unit); } catch (error) { problems.push(`the state of ${unit} could not be read: ${errorText(error)}`); }
    }
    const e = units[`${unit} is-enabled`]; const a = units[`${unit} is-active`];
    if (e === 'enabled' || e === 'enabled-runtime' || a === 'active' || a === 'activating') problems.push(`${unit} is ${e} / ${a}`);
  }
  for (const unit of c4b.AFL_API_SERVICES) {
    try {
      const a = deps.systemctl('is-active', unit); units[`${unit} is-active`] = a;
      if (a === 'active' || a === 'activating') problems.push(`${unit} is ${a}`);
    } catch (error) { problems.push(`the state of ${unit} could not be read: ${errorText(error)}`); }
  }
  notes.units = units;
  notes.absentUnitsAreNotProof = Object.values(units).some((v) => /not-found|unknown/.test(v));
  // 4. The independent inventory: scheduler entries, processes, database sessions.
  try {
    const inventory = await deps.inventory();
    notes.inventory = inventory;
    problems.push(...writerFindings(inventory, deps.ownPids()));
  } catch (error) {
    problems.push(`the writer inventory could not be taken: ${errorText(error)}`);
  }
  if (problems.length > 0) return { problems, notes };
  // 5. Database: same database, and the EXPECTED initial state exactly.
  try {
    await deps.sameDatabase();
    const stored = await deps.readSetting();
    const raw = await deps.rawSetting();
    const state = stateOf(stored);
    notes.initial = { state, raw };
    if (state !== args.expectInitial) problems.push(`${SWITCH_KEY} is ${state}${raw !== null ? ` (stored as ${raw})` : ''}, not the expected ${args.expectInitial}`);
    if (await deps.controlSeesEnabled()) problems.push(`the control path already sees ${SWITCH_KEY} enabled`);
  } catch (error) {
    problems.push(`the database preconditions could not be proved: ${errorText(error)}`);
  }
  return { problems, notes };
}

export async function runFixtureWindow(args: Extract<WindowArgs, { label: string }>, runId: string, deps: WindowDeps): Promise<WindowOutcome> {
  const audit = { via: 'afl-api-fixture-window', decision: args.decision, run_id: runId };
  const say = (line: string): void => { try { deps.log(line); } catch { /* the outcome stands */ } };
  const evidenceFailures: string[] = [];
  const keep = (name: string, content: string): boolean => {
    try { deps.writeEvidence(name, content); return true; } catch (error) { evidenceFailures.push(`${name} could not be written: ${errorText(error)}`); return false; }
  };
  const transition: Record<string, unknown> = { run_id: runId, decision: args.decision, label: args.label, expectInitial: args.expectInitial, expectCreated: args.expectCreated, events: [] as unknown[] };
  const event = (what: string, extra: Record<string, unknown> = {}): void => { (transition.events as unknown[]).push({ at: deps.now().toISOString(), what, ...extra }); };
  const finish = (outcome: WindowOutcome, extra: Record<string, unknown> = {}): WindowOutcome => {
    let final = outcome;
    const doc = { ...outcome, ...extra, run_id: runId, at: deps.now().toISOString() };
    try {
      deps.writeEvidence('transition.json', `${JSON.stringify({ ...transition, verdict: outcome.verdict }, null, 2)}\n`);
      deps.writeEvidence('result.json', `${JSON.stringify(doc, null, 2)}\n`);
    } catch (error) {
      const why = `result evidence could not be written: ${errorText(error)}`;
      final = outcome.exitCode === 0
        ? { exitCode: 1, verdict: 'HALT', reasons: [`${why}. A window with no record is a HALT, not a CLEAR.`, ...outcome.reasons], evidenceError: why }
        : { ...outcome, evidenceError: why };
    }
    say(`FIXTURE WINDOW ${final.verdict}`);
    for (const reason of final.reasons) say(`  - ${reason}`);
    return final;
  };

  // 1. Preconditions; nothing has been written.
  const { problems, notes } = await preconditions(args, deps);
  transition.preconditions = notes;
  keep('preconditions.json', `${JSON.stringify({ problems, ...notes }, null, 2)}\n`);
  if (problems.length > 0) return finish({ exitCode: 2, verdict: 'REFUSED', reasons: problems });
  if (args.mode === 'check-only') {
    return finish({ exitCode: 0, verdict: 'CLEAR', reasons: ['--check-only: every precondition holds; nothing was written and no watchdog was armed.'] });
  }
  // 2. The offline validation of the snapshot, then the single-window lock.
  const validate = await deps.runStep(FIXTURE_WINDOW_SCRIPT, ['--label', args.label, '--validate-only'], new AbortController().signal);
  keep('validate-only.log', validate.output);
  if (validate.exitCode !== 0 || validate.signal !== null) {
    return finish({ exitCode: 2, verdict: 'REFUSED', reasons: [`--validate-only of the snapshot ended ${validate.signal ?? `with exit ${String(validate.exitCode)}`}; no connection was opened`] });
  }
  let lock: { release: () => Promise<void> } | null;
  try { lock = await deps.holdWindowLock(); } catch (error) {
    return finish({ exitCode: 2, verdict: 'REFUSED', reasons: [`the window lock could not be taken: ${errorText(error)}`] });
  }
  if (lock === null) return finish({ exitCode: 2, verdict: 'REFUSED', reasons: ['another fixture window (or tool holding the window lock) is running; there is one window at a time'] });
  const releaseLock = async (): Promise<void> => { try { await lock!.release(); } catch { /* the session ending releases it */ } };

  let before: Counts; let auditBefore: number; let rawBefore: string | null;
  try {
    before = await deps.counts(); auditBefore = await deps.maxAuditId(); rawBefore = await deps.rawSetting();
  } catch (error) {
    await releaseLock();
    return finish({ exitCode: 2, verdict: 'REFUSED', reasons: [`the BEFORE record could not be read: ${errorText(error)}`] });
  }
  transition.before = { counts: before, switchRaw: rawBefore, auditMaxId: auditBefore };
  if (!keep('before.json', `${JSON.stringify(transition.before, null, 2)}\n`)) {
    await releaseLock();
    return finish({ exitCode: 2, verdict: 'REFUSED', reasons: [`the BEFORE record could not be saved: ${evidenceFailures.splice(0).join('; ')}`] });
  }
  const deadline = new Date(deps.now().getTime() + args.maxMinutes * 60_000);
  try { await deps.armWatchdog(deadline); } catch (error) {
    await releaseLock();
    return finish({ exitCode: 2, verdict: 'REFUSED', reasons: [`the watchdog could not be armed: ${errorText(error)}`] });
  }

  // 3. On, dry-run, apply, and off again whatever happens.
  const halts: string[] = [];
  const controller = new AbortController();
  let stopReason: string | null = null;
  const stop = (reason: string): void => { if (stopReason === null) { stopReason = reason; say(`STOPPING: ${reason}; the switch is restored next`); controller.abort(); } };
  const removeHandlers = deps.onInterrupt((signal) => stop(`interrupted by ${signal}`));
  const cancelDeadline = deps.scheduleDeadline(args.maxMinutes * 60_000, () => stop(`the ${args.maxMinutes}-minute deadline was reached`));
  const proceed = (): boolean => stopReason === null && evidenceFailures.length === 0;
  let restore: c4b.RestoreResult;
  let applied = false;
  try {
    await deps.writeSetting(true, { ...audit, step: 'on' });
    event('switch-on'); say(`${SWITCH_KEY} ON at ${deps.now().toISOString()}`);
    if (proceed()) {
      const dry = await deps.runStep(FIXTURE_WINDOW_SCRIPT, ['--label', args.label, '--dry-run'], controller.signal);
      keep('dry-run.log', dry.output); event('dry-run', { exit: dry.exitCode });
      const dryProblem = (dry.exitCode !== 0 || dry.signal !== null) ? `dry-run ended ${dry.signal ?? `with exit ${String(dry.exitCode)}`}` : stepOutcomeProblem('dry-run', dry.output, 'dry_run', args.expectCreated);
      if (dryProblem !== null) halts.push(dryProblem);
      else {
        const afterDry = await deps.counts();
        if (afterDry.fixtures !== before.fixtures || afterDry.matches !== before.matches) halts.push(`the dry-run changed row counts (fixtures ${before.fixtures} -> ${afterDry.fixtures}); it must roll back`);
      }
    }
    if (halts.length === 0 && proceed()) {
      // A writer that appeared during the dry-run must stop the apply.
      const second = writerFindings(await deps.inventory(), deps.ownPids());
      const stored = await deps.readSetting();
      const foreign = (await deps.auditSince(auditBefore)).filter((r) => r.detail.run_id !== runId);
      if (second.length > 0) halts.push(...second.map((f) => `before the apply: ${f}`));
      else if (stateOf(stored) !== 'true') halts.push(`before the apply the switch reads ${stateOf(stored)}, not true: someone else changed it`);
      else if (foreign.length > 0) halts.push(`before the apply: ${foreign.length} switch-audit row(s) not written by this run (ids ${foreign.map((r) => r.id).join(', ')}): a concurrent toggle, so the apply is not started`);
    }
    if (halts.length === 0 && proceed()) {
      const apply = await deps.runStep(FIXTURE_WINDOW_SCRIPT, ['--label', args.label, '--apply'], controller.signal);
      keep('apply.log', apply.output); event('apply', { exit: apply.exitCode });
      applied = apply.exitCode === 0;
      const problem = (apply.exitCode !== 0 || apply.signal !== null) ? `apply ended ${apply.signal ?? `with exit ${String(apply.exitCode)}`}` : stepOutcomeProblem('apply', apply.output, 'applied', args.expectCreated);
      if (problem !== null) halts.push(problem);
    }
  } catch (error) {
    halts.push(`the window stopped on ${errorText(error)}`);
  } finally {
    cancelDeadline();
    try {
      restore = await c4b.restoreSettingOff(deps, { ...audit, step: 'restore' });
      event('switch-off', { verified: restore.verified, attempts: restore.attempts });
      if (restore.verified) {
        try { deps.markRestoreVerified({ run_id: runId, attempts: restore.attempts }); } catch (error) {
          evidenceFailures.push(`${c4b.RESTORE_VERIFIED_MARKER} could not be written: ${errorText(error)} (the switch itself is verified off)`);
        }
        say(`${SWITCH_KEY} OFF at ${deps.now().toISOString()}, verified on the writer and the control path`);
      }
    } finally { removeHandlers(); await releaseLock(); }
  }
  if (stopReason !== null) halts.unshift(stopReason);
  halts.push(...evidenceFailures.splice(0));
  if (!restore.verified) {
    return finish({
      exitCode: 3, verdict: 'RESTORATION NOT VERIFIED',
      reasons: [`${SWITCH_KEY} MAY STILL BE ON. The watchdog stays armed. Run at once: afl-api-fixture-window.ts --restore-only --evidence-dir <the same dir>, then confirm it reads false`, ...restore.reads, ...halts],
    }, { applied });
  }

  // 4. With the switch off: AFTER record, audit reconciliation, counts.
  let after: Counts | undefined;
  try { after = await deps.counts(); } catch (error) { halts.push(`the AFTER record could not be read: ${errorText(error)}`); }
  let rawAfter: string | null = null;
  try { rawAfter = await deps.rawSetting(); } catch { /* recorded as null */ }
  transition.after = { counts: after, switchRaw: rawAfter };
  if (after !== undefined) {
    keep('after.json', `${JSON.stringify(transition.after, null, 2)}\n`);
    if (applied && halts.length === 0) {
      if (after.fixtures !== before.fixtures + args.expectCreated) halts.push(`fixtures went ${before.fixtures} -> ${after.fixtures}, not +${args.expectCreated}`);
    } else if (!applied && after.fixtures !== before.fixtures) {
      halts.push(`the apply did not run to success but fixtures changed (${before.fixtures} -> ${after.fixtures})`);
    }
    if (after.matches !== before.matches) halts.push(`canonical matches changed (${before.matches} -> ${after.matches}); the fixture settle must not write matches`);
  }
  try {
    const rows = await deps.auditSince(auditBefore);
    transition.audit = rows;
    halts.push(...auditProblems(rows, runId));
  } catch (error) { halts.push(`the audit trail could not be reconciled: ${errorText(error)}`); }
  try {
    const stored = await deps.readSetting();
    if (stateOf(stored) !== 'false') halts.push(`the switch finally reads ${stateOf(stored)}, not false`);
    if (await deps.controlSeesEnabled()) halts.push('the control path still sees the switch enabled');
  } catch (error) { halts.push(`the final switch state could not be read: ${errorText(error)}`); }
  for (const unit of c4b.AFL_API_TIMERS) {
    try {
      const e = deps.systemctl('is-enabled', unit); const a = deps.systemctl('is-active', unit);
      if (e === 'enabled' || e === 'enabled-runtime' || a === 'active' || a === 'activating') halts.push(`AFTER: ${unit} is ${e} / ${a}`);
    } catch (error) { halts.push(`AFTER: the state of ${unit} could not be read: ${errorText(error)}`); }
  }
  halts.push(...evidenceFailures.splice(0));
  if (halts.length > 0) return finish({ exitCode: 1, verdict: 'HALT', reasons: halts }, { applied });
  return finish({
    exitCode: 0, verdict: 'CLEAR',
    reasons: [`the dry-run and the apply each reported exactly created=${args.expectCreated}; fixtures ${before.fixtures} -> ${after!.fixtures}; the switch is off and verified; every audit row is this run's. `
      + 'This is the evidence for the M3 record, not the record.'],
  }, { applied });
}

/* ------------------------------------------------------------------ *
 * Production effects
 * ------------------------------------------------------------------ */

function run(command: string, args: string[]): { status: number | null; stdout: string; stderr: string; missing: boolean } {
  const r = spawnSync(command, args, { encoding: 'utf8', timeout: 15_000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', missing: (r.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT' };
}

/** The host inventory. Exported so the isolated harness runs the real code with a host it can fake. */
export function hostInventory(sessions: () => Promise<{ pid: number; role: string; state: string | null }[]>) {
  return async (): Promise<Inventory> => {
    const inv: Inventory = { lines: [], unreadable: [], notInstalled: [] };
    const take = (source: Exclude<InventoryLine['source'], 'process' | 'session'>, text: string): void => {
      for (const l of text.split('\n').map((x) => x.trim()).filter(Boolean)) inv.lines.push({ source, text: l });
    };
    if (process.platform === 'win32') {
      inv.notInstalled.push('systemd', 'cron', 'at');
    } else {
      const ps = run('ps', ['-eo', 'pid=,args=']);
      if (ps.missing || ps.status !== 0) inv.unreadable.push('process table');
      else for (const l of ps.stdout.split('\n')) { const m = l.trim().match(/^(\d+)\s+(.*)$/); if (m) inv.lines.push({ source: 'process', pid: Number(m[1]), text: m[2] }); }
      const sd = run('systemctl', ['list-timers', '--no-legend', '--no-pager']);
      if (sd.missing) inv.notInstalled.push('systemd'); else if (sd.status !== 0) inv.unreadable.push('systemd timers'); else take('systemd-timer', sd.stdout);
      if (!sd.missing) {
        const sv = run('systemctl', ['list-units', '--type=service', '--state=active,activating', '--no-legend', '--no-pager']);
        if (sv.status !== 0) inv.unreadable.push('systemd services'); else take('systemd-service', sv.stdout);
        const uf = run('systemctl', ['list-unit-files', '--no-legend', '--no-pager']);
        if (uf.status !== 0) inv.unreadable.push('systemd unit files'); else take('systemd-unit-file', uf.stdout);
        // Every unit file whose TEXT runs a switch consumer is found, whatever it is called (a differently named timer is the case this exists for).
        for (const dir of SYSTEMD_UNIT_DIRS) {
          let entries: string[] = [];
          try { entries = readdirSync(dir); } catch { continue; }
          for (const entry of entries.filter((e) => /\.(timer|service)$/.test(e))) {
            let text: string;
            try { text = readFileSync(join(dir, entry), 'utf8'); } catch { inv.unreadable.push(join(dir, entry)); continue; }
            if (!CONSUMER_PATTERN.test(text) && !CONSUMER_PATTERN.test(entry)) continue;
            const en = run('systemctl', ['is-enabled', entry]).stdout.trim() || 'unknown'; const ac = run('systemctl', ['is-active', entry]).stdout.trim() || 'unknown';
            inv.lines.push({ source: 'systemd-unit', text: `${entry} ${en} ${ac} ${text.split('\n').filter((l) => /^(ExecStart|ExecStartPre)=/.test(l.trim())).join(' ; ')}` });
          }
        }
      }
      const cron = run('crontab', ['-l']);
      if (cron.missing) inv.notInstalled.push('crontab'); else if (cron.status === 0) take('cron', cron.stdout); else if (!/no crontab/i.test(cron.stderr)) inv.unreadable.push('crontab');
      for (const f of ['/etc/crontab']) { if (existsSync(f)) { try { take('cron', readFileSync(f, 'utf8')); } catch { inv.unreadable.push(f); } } }
      if (existsSync('/etc/cron.d')) {
        try { for (const f of readdirSync('/etc/cron.d')) take('cron', readFileSync(join('/etc/cron.d', f), 'utf8')); } catch { inv.unreadable.push('/etc/cron.d'); }
      }
      const at = run('atq', []);
      if (at.missing) inv.notInstalled.push('at'); else if (at.status === 0) take('at', at.stdout); else inv.unreadable.push('at');
    }
    try { for (const s of await sessions()) inv.lines.push({ source: 'session', pid: s.pid, role: s.role, state: s.state }); } catch { inv.unreadable.push('database sessions'); }
    return inv;
  };
}

async function withSql<T>(dsnEnv: string, fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const dsn = process.env[dsnEnv];
  if (!dsn) throw new WindowError(`${dsnEnv} is not set.`);
  const sql = postgres(dsn, { max: 1, connect_timeout: 10, onnotice: () => {}, transform: { undefined: null }, connection: { statement_timeout: 15_000 } });
  try { return await fn(sql); } finally { try { await sql.end({ timeout: 5 }); } catch { /* never replace the result */ } }
}

/** Every other session in this database (the caller's own backend excluded). The window refuses when one is a writer role. */
export const databaseSessions = (): Promise<{ pid: number; role: string; state: string | null }[]> => withSql('AFLDB_AUTH_DATABASE_URL', (sql) => sql<{ pid: number; role: string; state: string | null }[]>`
  SELECT pid, usename AS role, state FROM pg_stat_activity
   WHERE datname = current_database() AND pid <> pg_backend_pid() AND usename IS NOT NULL`);

export function productionWindowDeps(projectRoot: string, evidenceDir: string, runId: string): WindowDeps {
  const base = c4b.productionDeps(projectRoot, evidenceDir, runId);
  let stepPid: number | null = null;
  let watchdogPid: number | null = null;
  return {
    log: base.log,
    projectFile: base.projectFile,
    systemctl: base.systemctl,
    sameDatabase: base.sameDatabase,
    readSetting: base.readSetting,
    controlSeesEnabled: base.controlSeesEnabled,
    writeSetting: base.writeSetting,
    runStep: async (script, argv, abort) => {
      const r = await base.runStep(script, argv, abort);
      stepPid = null;
      return r;
    },
    armWatchdog: async (deadline) => {
      await base.armWatchdog(deadline);
      try { watchdogPid = Number(JSON.parse(readFileSync(join(evidenceDir, c4b.WATCHDOG_READY_MARKER), 'utf8')).watchdogPid); } catch { watchdogPid = null; }
    },
    markRestoreVerified: base.markRestoreVerified,
    writeEvidence: base.writeEvidence,
    onInterrupt: base.onInterrupt,
    scheduleDeadline: base.scheduleDeadline,
    now: base.now,
    sleep: base.sleep,
    fileSha256: (rel) => { try { return createHash('sha256').update(readFileSync(join(projectRoot, rel))).digest('hex'); } catch { return undefined; } },
    rawSetting: () => withSql('AFLDB_AUTH_DATABASE_URL', async (sql) => (await sql<{ v: string }[]>`SELECT value::text AS v FROM site_settings WHERE key = ${SWITCH_KEY}`)[0]?.v ?? null),
    inventory: hostInventory(databaseSessions),
    ownPids: () => new Set([process.pid, process.ppid, ...(watchdogPid ? [watchdogPid] : []), ...(stepPid ? [stepPid] : [])]),
    holdWindowLock: async () => {
      const dsn = process.env.AFLDB_AUTH_DATABASE_URL;
      if (!dsn) throw new WindowError('AFLDB_AUTH_DATABASE_URL is not set.');
      const sql = postgres(dsn, { max: 1, connect_timeout: 10, onnotice: () => {}, transform: { undefined: null } });
      const [row] = await sql<{ ok: boolean }[]>`SELECT pg_try_advisory_lock(${WINDOW_LOCK_KEYS[0]}, ${WINDOW_LOCK_KEYS[1]}) AS ok`;
      if (!row?.ok) { await sql.end({ timeout: 5 }); return null; }
      return { release: async () => { try { await sql`SELECT pg_advisory_unlock(${WINDOW_LOCK_KEYS[0]}, ${WINDOW_LOCK_KEYS[1]})`; } finally { await sql.end({ timeout: 5 }); } } };
    },
    counts: () => withSql('DATABASE_URL', async (sql) => {
      const [r] = await sql<{ fixtures: number; matches: number }[]>`SELECT (SELECT count(*) FROM fixtures)::int AS fixtures, (SELECT count(*) FROM matches)::int AS matches`;
      return { fixtures: r.fixtures, matches: r.matches };
    }),
    maxAuditId: () => withSql('AFLDB_AUTH_DATABASE_URL', async (sql) => Number((await sql<{ m: string | null }[]>`SELECT max(id)::text AS m FROM auth_audit_log WHERE action = ${AUDIT_ACTION}`)[0]?.m ?? 0)),
    auditSince: (id) => withSql('AFLDB_AUTH_DATABASE_URL', async (sql) => (await sql<{ id: string; actor_label: string | null; detail: Record<string, unknown> }[]>`
      SELECT id::text AS id, actor_label, detail FROM auth_audit_log WHERE action = ${AUDIT_ACTION} AND id > ${id} ORDER BY id`)
      .map((r) => ({ id: Number(r.id), actorLabel: r.actor_label, detail: r.detail }))),
  };
}

export async function main(argv: string[]): Promise<number> {
  process.stdout.on('error', () => {}); process.stderr.on('error', () => {});
  let args: WindowArgs;
  try { args = parseWindowArgs(argv); } catch (error) {
    console.error(errorText(error)); console.error(WINDOW_USAGE); return 2;
  }
  let evidenceDir: string; let runId: string;
  try {
    evidenceDir = resolve(args.evidenceDir);
    if (args.mode !== 'restore-only' && existsSync(evidenceDir) && readdirSync(evidenceDir).length > 0) {
      console.error(`--evidence-dir ${evidenceDir} is not empty; every window gets its own directory.`); return 2;
    }
    mkdirSync(evidenceDir, { recursive: true });
    loadEnv(DEFAULT_PROJECT_ROOT);
    runId = `fxw-${new Date().toISOString().replace(/[:.]/g, '')}-${process.pid}`;
  } catch (error) {
    console.error(`setup failed before any switch write: ${errorText(error)}`);
    return args.mode === 'restore-only' ? 3 : 2;
  }
  try {
    if (args.mode === 'restore-only') return await c4b.runRestoreOnly(c4b.productionDeps(DEFAULT_PROJECT_ROOT, evidenceDir, runId), runId);
    const deps = productionWindowDeps(DEFAULT_PROJECT_ROOT, evidenceDir, runId);
    deps.log(`AFLDB-ISSUE-229 fixture window ${runId}: snapshot ${args.label}, expect initial ${args.expectInitial}, expect created ${args.expectCreated}, `
      + `deadline ${args.maxMinutes} minute(s), mode ${args.mode}, evidence ${evidenceDir}`);
    return (await runFixtureWindow(args, runId, deps)).exitCode;
  } catch (error) {
    console.error(`unexpected error (${errorText(error)}): the switch's state is not proved. Run --restore-only --evidence-dir <the same dir> and confirm it reads false.`);
    return 3;
  }
}

const invokedDirectly = process.argv[1] !== undefined && relative(resolve(process.argv[1]), __filename) === '';
if (invokedDirectly) main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, () => { process.exitCode = 3; });
