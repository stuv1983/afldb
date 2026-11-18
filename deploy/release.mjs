#!/usr/bin/env node
/**
 * AFLDB-ISSUE-329: non-destructive production build, promotion and rollback.
 *
 * An in-place `npm run build` in the serving checkout deletes the live
 * `.next/standalone` before it compiles (`next build`'s clean step), so any
 * failed or interrupted build took the site's assets with it (2026-10-31).
 * This tool builds somewhere else and switches only a finished, validated
 * release into service:
 *
 *   <root>/releases/<rev12>-<BUILD_ID>/   immutable release: deploy/server-cluster.mjs,
 *                                         .next/standalone, release.json, MANIFEST.sha256
 *   <root>/current  -> releases/<id>      what the service starts from (systemd drop-in
 *                                         deploy/afldb.service.d/release-route.conf)
 *   <root>/previous -> releases/<id>      the last working release, the rollback target
 *   <root>/builds/<stamp>-<rev12>/        disposable workspace and logs
 *   <root>/events.log                     append-only JSON lines
 *
 *   node deploy/release.mjs build    --checkout <dir> --revision <sha> --afldb-env production
 *                                    [--typecheck off-host --typecheck-evidence <text>] [--smoke-paths /a,/b]
 *   node deploy/release.mjs verify   <id>
 *   node deploy/release.mjs promote  <id> --attended [--skip-host-gate "<reason>"] [--window-min 90] [--strict]
 *   node deploy/release.mjs rollback [--to <id>] --attended [--ledger-head <name> [--accept-schema-ahead <name>]]
 *   node deploy/release.mjs status   [--expect <id>] [--url http://127.0.0.1:3100] [--checkout <dir>]
 *                                    [--confirm-restart-invocation <InvocationID>]   owner-attested restart, that invocation only
 *                                    [--confirm-attended-restart]                    legacy unbound form, kept for compatibility
 *   node deploy/release.mjs host-gate [--mode promote|rollback] [--strict] [--window-min 90]     read-only packet gate
 *   node deploy/release.mjs check-node-modules --checkout <dir>                                  installed tree vs lock
 *   node deploy/release.mjs adopt    --checkout <dir> --revision <sha> --afldb-env production
 *                                    [--from-manifest <sha256sum file>] [--expect-build-id <id>]
 *
 * Every command takes --root (default /home/arm/afldb-releases).
 *
 * Every build write lands under builds/ until one final rename(2) into
 * releases/, and promote/rollback only ever replace a symlink by rename(2).
 * Nothing here restarts the service, deletes a release, touches the database
 * or writes to the checkout. Linux only; Node built-ins only, so it runs
 * before any `npm ci`. Design and proof: issues/closed/AFLDB-ISSUE-329.md.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
  appendFileSync, closeSync, constants as fsConstants, copyFileSync, existsSync, lstatSync, mkdirSync,
  openSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, statfsSync,
  symlinkSync, writeFileSync, writeSync,
} from 'node:fs';
import { createConnection } from 'node:net';
import { hostname } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

import { findEnvFilesRecursive } from '../tools/build/env-in-standalone.mjs';

export const DEFAULT_ROOT = '/home/arm/afldb-releases';
export const DEFAULTS = Object.freeze({
  heapMb: 3072, // the heap the 2026-10-31 recovery build passed with
  buildWorkers: 1,
  minAvailableMb: 384, // guard floor: below this the build's process group is killed
  // Admission: do not start a build below this MemAvailable. Measured fall (Linux, 2026-10-31) plus
  // the guard floor: about 2.8 GB with the build's type-check, about 1.7 GB without it.
  requireAvailableMb: Object.freeze({ 'in-build': 3200, 'off-host': 2100 }),
  requireFreeGb: 6,
  smokePort: 3199,
  typecheck: 'in-build', // or 'off-host': skip the build's type-check (about 1 GB less peak; needs --typecheck-evidence)
  url: 'http://127.0.0.1:3100',
  unit: 'afldb',
  pgUnit: 'postgresql@16-main.service',
});
const MANIFEST = 'MANIFEST.sha256';
const RELEASE_JSON = 'release.json';
const STANDALONE = join('.next', 'standalone');
const PAGE_BYTES = 4096;

// ------------------------------------------------------------------ pure helpers

export function isRevision(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

export function isBuildId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

export function releaseId(revision, buildId) {
  if (!isRevision(revision)) throw new Error(`not a full 40-hex revision: ${revision}`);
  if (!isBuildId(buildId)) throw new Error(`not a BUILD_ID: ${buildId}`);
  return `${revision.slice(0, 12)}-${buildId}`;
}

export function isReleaseId(value) {
  return typeof value === 'string' && /^[0-9a-f]{12}-[A-Za-z0-9_-]{1,64}$/.test(value);
}

/** MemTotal/MemAvailable/SwapTotal/SwapFree in MB from /proc/meminfo text. */
export function parseMeminfo(text) {
  const kb = (name) => {
    const match = new RegExp(`^${name}:\\s+(\\d+)\\s+kB$`, 'm').exec(text);
    return match ? Math.floor(Number(match[1]) / 1024) : null;
  };
  return {
    memTotalMb: kb('MemTotal'),
    memAvailableMb: kb('MemAvailable'),
    swapTotalMb: kb('SwapTotal'),
    swapFreeMb: kb('SwapFree'),
  };
}

/**
 * Every name in the unit's `UnsetEnvironment=` lines. Read from the unit file
 * of the revision being built, never retyped here: a hand-typed copy of that
 * deny list is how AFLDB-ISSUE-220 leaked credentials.
 */
export function parseUnsetEnvironment(unitText) {
  const names = [];
  for (const line of unitText.split(/\r?\n/)) {
    const match = /^\s*UnsetEnvironment=(.*)$/.exec(line);
    if (match) names.push(...match[1].trim().split(/\s+/).filter(Boolean));
  }
  return names;
}

/** `Environment=KEY=VALUE` assignments of the unit, in order (unquoted values only). */
export function parseUnitEnvironment(unitText) {
  const env = {};
  for (const line of unitText.split(/\r?\n/)) {
    const match = /^\s*Environment=([A-Za-z_][A-Za-z0-9_]*)=(\S*)\s*$/.exec(line);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

/** The interpreter path of the unit's ExecStart=, or null. */
export function parseExecStartNode(unitText) {
  const match = /^\s*ExecStart=(\S+)/m.exec(unitText);
  return match ? match[1] : null;
}

/**
 * The environment the service would start with: the unit's EnvironmentFile
 * (the checkout's .env) minus its UnsetEnvironment= names, then its
 * Environment= lines (systemd applies those after the file).
 */
/** @returns {Record<string, string>} */
export function serviceEnvironment(envFileText, unitText) {
  const env = { ...parseEnv(envFileText) };
  for (const name of parseUnsetEnvironment(unitText)) delete env[name];
  return { ...env, ...parseUnitEnvironment(unitText) };
}

/**
 * Output the running server itself writes into a release: the ISR cache and
 * regenerated page data. Drift there is reported, never failed; everything
 * else (code, chunks, assets, manifests, node_modules) must be unchanged.
 */
export function isServerOutput(path) {
  const p = path.split(sep).join('/');
  if (p.startsWith('.next/standalone/.next/cache/')) return true;
  const m = /^\.next\/standalone\/\.next\/server\/(app|pages)\/(.+)$/.exec(p);
  if (!m) return false;
  return /\.(html|rsc|meta|body)$/.test(m[2]) || m[2].split('/').some((part) => part.endsWith('.segments'));
}

/** sha256sum-format text, sorted by path. Symlinks hash their target text with a `symlink:` prefix. */
export function formatManifest(entries) {
  return entries
    .slice()
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((e) => `${e.sha256}  ${e.path}\n`)
    .join('');
}

export function parseManifest(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    if (line === '') continue;
    const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (!match) throw new Error(`malformed manifest line: ${line.slice(0, 80)}`);
    entries.push({ sha256: match[1], path: match[2] });
  }
  return entries;
}

/** Compare a recorded manifest with the tree now. `ok` ignores server output only. */
export function classifyDrift(expected, actual) {
  const want = new Map(expected.map((e) => [e.path, e.sha256]));
  const have = new Map(actual.map((e) => [e.path, e.sha256]));
  const result = { ok: false, missing: [], changed: [], added: [], serverOutput: [] };
  for (const [path, sha] of want) {
    if (!have.has(path)) (isServerOutput(path) ? result.serverOutput : result.missing).push(path);
    else if (have.get(path) !== sha) (isServerOutput(path) ? result.serverOutput : result.changed).push(path);
  }
  for (const path of have.keys()) {
    if (!want.has(path)) (isServerOutput(path) ? result.serverOutput : result.added).push(path);
  }
  result.ok = result.missing.length === 0 && result.changed.length === 0 && result.added.length === 0;
  return result;
}

// ------------------------------------------------------------------ AFLDB-ISSUE-351: host patching gate (pure)

/** `systemctl show -p A -p B` output as an object (first `=` splits). */
export function parseShowProps(text) {
  const out = {};
  for (const line of String(text).split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  return out;
}

/** `Sat 2026-11-14 06:35:21 UTC` (systemctl --timestamp=utc) as epoch ms; null for anything else, including local-zone text. */
export function parseSystemdTimestampUtc(text) {
  const m = /^(?:\w{3} )?(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.\d+)? UTC$/.exec(String(text).trim());
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}

/** The unit snapshot recorded at promote time and compared by `status`. */
export function unitSnapshot(props) {
  return {
    activeState: props.ActiveState ?? null,
    mainPid: props.MainPID && props.MainPID !== '0' ? Number(props.MainPID) : null,
    invocationId: props.InvocationID || null,
    nRestarts: props.NRestarts !== undefined && props.NRestarts !== '' ? Number(props.NRestarts) : null,
    activeEnterMs: parseSystemdTimestampUtc(props.ActiveEnterTimestamp ?? ''),
  };
}

/**
 * /var/log/apt/history.log blocks as `{startMs, endMs, command}`. Start-Date/End-Date are in the host's
 * local zone, which is also this process's zone on the host (tests pin TZ).
 */
export function parseAptHistory(text) {
  const entries = [];
  let cur = null;
  const when = (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(v.trim());
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : null;
  };
  for (const line of String(text).split('\n')) {
    const m = /^(Start-Date|End-Date|Commandline):\s*(.*)$/.exec(line);
    if (!m) continue;
    if (m[1] === 'Start-Date') { cur = { startMs: when(m[2]), endMs: null, command: '' }; entries.push(cur); }
    else if (cur && m[1] === 'End-Date') cur.endMs = when(m[2]);
    else if (cur) cur.command = m[2];
  }
  return entries.filter((e) => e.startMs !== null);
}

/** Apt runs overlapping [fromMs, toMs]; an unfinished run counts as running until toMs. */
export function aptRunsBetween(entries, fromMs, toMs) {
  return entries.filter((e) => (e.endMs ?? toMs) >= fromMs && e.startMs <= toMs);
}

/** True when the service (re)started during or just after an apt run: the unattended-upgrade signature (needrestart). */
export function restartCoincidesWithApt(entries, activeEnterMs, slackMs = 5 * 60_000) {
  if (activeEnterMs === null) return null;
  return entries.find((e) => activeEnterMs >= e.startMs && activeEnterMs <= (e.endMs ?? e.startMs) + slackMs) ?? null;
}

/**
 * Does needrestart config (conf.d/*.conf text) stop it restarting `afldb` and PostgreSQL? Recognises the two
 * documented single-line forms: `$nrconf{override_rc}->{qr(^afldb)} = 0;` and the hash form `qr(^afldb) => 0,`.
 */
export function needrestartHold(confText) {
  const live = String(confText).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const holds = (name) => new RegExp(`override_rc[^\\n]*\\b${name}\\b[^\\n]*=\\s*0\\b|qr\\(\\^?${name}[^\\n]*=>\\s*0\\b`).test(live);
  return { afldb: holds('afldb'), postgresql: holds('postgresql') };
}

/**
 * The gate over a host-state snapshot. Refusals stop promote; warnings are reported and recorded.
 * `mode` 'rollback' never refuses (it only moves links; the emergency path must stay open), it warns instead.
 */
export function evaluateHostGate(state, { windowMin = 90, strict = false, mode = 'promote' } = {}) {
  const refusals = [];
  const warnings = [];
  const facts = [];
  const nowMs = state.nowMs;
  const problem = (message) => (mode === 'rollback' ? warnings : refusals).push(message);
  if ((state.aptActive ?? []).length > 0) problem(`apt is running now (${state.aptActive.join(', ')}): a restart could land during the activation window`);
  if ((state.aptProcesses ?? []).length > 0) problem(`package-manager process(es) running: ${state.aptProcesses.join(', ')}`);
  if (state.nextAptUpgradeMs === undefined || state.nextAptUpgradeMs === null) {
    warnings.push('the next apt-daily-upgrade time could not be read (timer absent or systemctl unavailable)');
  } else {
    const inMin = Math.round((state.nextAptUpgradeMs - nowMs) / 60_000);
    facts.push(`next apt-daily-upgrade in ${inMin} min`);
    if (inMin <= windowMin) problem(`apt-daily-upgrade is due in ${inMin} min (gate window ${windowMin} min); it may restart the service`);
  }
  if (state.rebootRequired?.present) {
    warnings.push(`reboot pending (${(state.rebootRequired.pkgs ?? []).filter((p) => p.startsWith('linux-image')).length} kernel package(s)); `
      + 'a reboot is a separate owner operation (docs/deployment.md §3a)');
  }
  const hold = state.needrestartHold;
  if (hold === null || hold === undefined) warnings.push('needrestart configuration unreadable');
  else if (!hold.afldb || !hold.postgresql) {
    const text = `needrestart hold missing for ${[!hold.afldb && 'afldb', !hold.postgresql && 'postgresql'].filter(Boolean).join(' and ')}: `
      + 'an unattended upgrade restarts it';
    (strict ? refusals : warnings).push(text);
  } else facts.push('needrestart holds afldb and postgresql');
  for (const [unit, snap] of Object.entries(state.units ?? {})) {
    facts.push(`${unit} ${snap.activeState ?? '?'} MainPID=${snap.mainPid ?? '-'} InvocationID=${snap.invocationId ?? '-'} NRestarts=${snap.nRestarts ?? '-'} ActiveEnter=${snap.activeEnterMs ? new Date(snap.activeEnterMs).toISOString() : '-'}`);
  }
  return { ok: refusals.length === 0, refusals, warnings, facts };
}

/** `118_x.sql` -> 118; null when the name has no numeric prefix. */
export function migrationNumber(name) {
  const m = /^(\d+)_/.exec(String(name ?? ''));
  return m ? Number(m[1]) : null;
}

/** Highest migration file name in a list of paths/names (numeric prefix), or null. */
export function migrationHeadOf(names) {
  let best = null;
  for (const raw of names) {
    const name = String(raw).split('/').pop();
    if (/\.sql$/.test(name) && migrationNumber(name) !== null && (best === null || migrationNumber(name) > migrationNumber(best))) best = name;
  }
  return best;
}

/**
 * Rollback compatibility with the database ledger. Refuses ONLY a proven mismatch: the ledger head is known (the
 * operator read it) and the target release was built before it, or after it. Everything unknown proceeds with a
 * recorded warning: rollback is the emergency path and must work when the database is down (ISSUE-351 H-6).
 */
export function checkRollbackLedger({ targetHead, ledgerHead, accept }) {
  if (!ledgerHead) return { ok: true, status: 'not-checked', message: 'database ledger head not supplied (--ledger-head): compatibility NOT checked' };
  if (migrationNumber(ledgerHead) === null) return { ok: false, status: 'bad-input', message: `--ledger-head ${ledgerHead} is not a migration file name` };
  if (!targetHead) return { ok: true, status: 'target-unknown', message: 'the target release records no migration head (built before ISSUE-351): compatibility NOT checked' };
  const t = migrationNumber(targetHead);
  const l = migrationNumber(ledgerHead);
  if (t === l) return { ok: true, status: 'match', message: `target migration head ${targetHead} equals the ledger head` };
  const direction = t < l ? `the database is ${l - t} migration(s) ahead of the target (${ledgerHead} applied, target built at ${targetHead})`
    : `the target expects ${t - l} migration(s) the database has not applied (${targetHead} vs ledger ${ledgerHead})`;
  if (accept === ledgerHead) return { ok: true, status: 'accepted', message: `${direction}; accepted with --accept-schema-ahead ${accept}` };
  return { ok: false, status: 'mismatch', message: `${direction}; confirm the older/newer application tolerates this schema (docs/deployment.md §11, `
    + `ISSUE-257 guard), then repeat with --accept-schema-ahead ${ledgerHead}` };
}

/**
 * Installed tree versus the lock (ISSUE-364): every package in npm's hidden lockfile (node_modules/.package-lock.json,
 * the record of what is installed) must be in package-lock.json with the same version and integrity, and every
 * non-optional locked package must be installed. `unknown` when the installed record is missing.
 */
export function compareNodeModulesToLock(lock, installed) {
  if (!installed?.packages) return { status: 'unknown', changed: [], extraneous: [], missing: [], checked: 0 };
  const want = lock?.packages ?? {};
  const have = installed.packages;
  const changed = [];
  const extraneous = [];
  const missing = [];
  for (const [path, pkg] of Object.entries(have)) {
    const locked = want[path];
    if (!locked) { extraneous.push(path); continue; }
    if (pkg.link || locked.link) continue;
    if (pkg.version !== locked.version || (pkg.integrity && locked.integrity && pkg.integrity !== locked.integrity)) {
      changed.push(`${path} installed ${pkg.version} locked ${locked.version}`);
    }
  }
  // An install made with --omit=dev holds no dev package at all; that is a choice, not drift.
  const devOmitted = !Object.entries(want).some(([path, locked]) => locked.dev && have[path]);
  for (const [path, locked] of Object.entries(want)) {
    if (path === '' || locked.optional || locked.link || have[path] || (devOmitted && locked.dev)) continue;
    missing.push(path);
  }
  return { status: changed.length + extraneous.length + missing.length === 0 ? 'ok' : 'mismatch', changed, extraneous, missing, checked: Object.keys(have).length };
}

// ------------------------------------------------------------------ filesystem helpers

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Every file under `dir` (symlinks not followed), as { path (POSIX, relative), sha256, size }. */
export function hashTree(dir, { exclude = [] } = {}) {
  const entries = [];
  const walk = (rel) => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (exclude.includes(relPath)) continue;
      const abs = join(dir, ...relPath.split('/'));
      if (entry.isSymbolicLink()) {
        const target = readlinkSync(abs);
        entries.push({ path: relPath, sha256: createHash('sha256').update(`symlink:${target}`).digest('hex'), size: 0 });
      } else if (entry.isDirectory()) {
        walk(relPath);
      } else if (entry.isFile()) {
        entries.push({ path: relPath, sha256: sha256File(abs), size: lstatSync(abs).size });
      }
    }
  };
  walk('');
  return entries;
}

function releaseTree(releaseDir) {
  return hashTree(releaseDir, { exclude: [MANIFEST, RELEASE_JSON] });
}

/** Replace `<root>/<name>` with a symlink to `target` in one rename(2). */
export function switchLink(root, name, target) {
  const tmp = join(root, `.${name}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`);
  symlinkSync(target, tmp);
  try {
    renameSync(tmp, join(root, name));
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

/** The release id a root-level link names, or null when absent. Throws on a foreign target. */
export function readReleaseLink(root, name) {
  const path = join(root, name);
  let target;
  try {
    target = readlinkSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const match = /^releases\/([^/]+)$/.exec(target);
  if (!match || !isReleaseId(match[1])) throw new Error(`${path} points at ${target}, not releases/<id>`);
  return match[1];
}

function readRelease(root, id) {
  const dir = join(root, 'releases', id);
  const info = JSON.parse(readFileSync(join(dir, RELEASE_JSON), 'utf8'));
  if (info.id !== id) throw new Error(`${dir}/${RELEASE_JSON} names ${info.id}`);
  return { dir, info };
}

function freeGb(path) {
  const s = statfsSync(path);
  return (s.bavail * s.bsize) / 1024 ** 3;
}

function readMeminfo() {
  return parseMeminfo(readFileSync('/proc/meminfo', 'utf8'));
}

/** Resident memory (MB) of every process in process group `pgid`. */
function groupRssMb(pgid) {
  let pages = 0;
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      if (Number(fields[2]) !== pgid) continue; // fields: state ppid pgrp …
      pages += Number(readFileSync(`/proc/${name}/statm`, 'utf8').split(' ')[1]);
    } catch { /* the process exited between readdir and read */ }
  }
  return Math.round((pages * PAGE_BYTES) / 1024 ** 2);
}

// ------------------------------------------------------------------ operation context

class Refusal extends Error {}

function log(message) {
  console.log(`release: ${message}`);
}

function event(root, op, fields) {
  appendFileSync(join(root, 'events.log'), `${JSON.stringify({ ts: new Date().toISOString(), op, ...fields })}\n`);
}

const active = { groups: new Set(), interrupted: null, buildLock: null };

function killGroup(pgid, signal) {
  try {
    process.kill(-pgid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function onSignal(signal) {
  if (active.interrupted) return;
  active.interrupted = signal;
  console.error(`release: ${signal} received; stopping the build and leaving every release untouched`);
  for (const pgid of active.groups) {
    killGroup(pgid, 'SIGTERM');
    setTimeout(() => killGroup(pgid, 'SIGKILL'), 5000).unref();
  }
}

/** Field 22 of /proc/<pid>/stat (start time in clock ticks), or null when the process is gone. */
function processStart(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  } catch {
    return null;
  }
}

function writeLock(lockPath, record) {
  const tmp = `${lockPath}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(record), { mode: 0o600 });
  renameSync(tmp, lockPath);
}

/**
 * Two locks, so that a long build never blocks an emergency rollback:
 * `build.lock` covers builds/ and is held for a whole build; `links.lock`
 * covers releases/, `current` and `previous` and is held only for a publish,
 * promote, rollback or adopt. A lock whose process is gone (pid dead, or
 * reused with a different start time) is stale and is broken; a stale build
 * lock's process groups are killed first if they still run in builds/, so an
 * orphaned build from a SIGKILLed tool cannot keep running unguarded.
 */
async function withLock(root, name, op, fn) {
  mkdirSync(root, { recursive: true });
  const lockPath = join(root, `${name}.lock`);
  const record = { pid: process.pid, start: processStart(process.pid), op, host: hostname(), startedAt: new Date().toISOString(), groups: [] };
  for (let attempt = 0; ; attempt += 1) {
    try {
      const fd = openSync(lockPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
      writeSync(fd, JSON.stringify(record));
      closeSync(fd);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST' || attempt > 0) {
        if (error.code !== 'EEXIST') throw error;
        throw new Refusal(`${lockPath} could not be taken after breaking a stale lock`);
      }
    }
    let held;
    try { held = JSON.parse(readFileSync(lockPath, 'utf8')); } catch { held = null; }
    // A lock is created empty and written a moment later: an unreadable one is
    // a holder mid-write, not a stale lock, until it has been unreadable a while.
    if (!held) {
      let ageMs = Infinity;
      try { ageMs = Date.now() - lstatSync(lockPath).mtimeMs; } catch { /* removed meanwhile */ }
      if (ageMs < 60_000) throw new Refusal(`${lockPath} is being taken by another operation`);
    }
    const live = held && held.host === hostname() && processStart(held.pid) !== null && processStart(held.pid) === held.start;
    if (live || (held && held.host !== hostname())) {
      throw new Refusal(`${lockPath} is held by ${held.op} (pid ${held.pid}, since ${held.startedAt})`);
    }
    const builds = join(realpathSync(root), 'builds') + sep;
    for (const pgid of held?.groups ?? []) {
      let cwd = null;
      try { cwd = readlinkSync(`/proc/${pgid}/cwd`); } catch { /* gone */ }
      if (cwd && cwd.startsWith(builds)) {
        log(`stale ${name}: killing the orphaned process group ${pgid} (${cwd})`);
        killGroup(pgid, 'SIGKILL');
      }
    }
    log(`breaking stale ${name} (${held ? `${held.op}, pid ${held.pid}, since ${held.startedAt}` : 'unreadable'})`);
    event(root, 'stale-lock', { lock: name, held });
    rmSync(lockPath, { force: true });
  }
  if (name === 'build') active.buildLock = { path: lockPath, record };
  try {
    return await fn();
  } finally {
    if (name === 'build') active.buildLock = null;
    rmSync(lockPath, { force: true });
  }
}

/** Record a process group in the build lock, so a later run can reap it if this tool is killed. */
function trackGroup(pgid) {
  active.groups.add(pgid);
  if (active.buildLock) {
    active.buildLock.record.groups.push(pgid);
    writeLock(active.buildLock.path, active.buildLock.record);
  }
}

function untrackGroup(pgid) {
  active.groups.delete(pgid);
  if (active.buildLock) {
    active.buildLock.record.groups = active.buildLock.record.groups.filter((g) => g !== pgid);
    writeLock(active.buildLock.path, active.buildLock.record);
  }
}

/**
 * Run a command in its own process group, output to `logFile`, under the
 * memory guard. The group gets oom_score_adj 1000 so that, should the kernel
 * have to choose, it kills the build rather than PostgreSQL or the service.
 */
function runGuarded(command, args, { cwd, env, logFile, guard, label }) {
  return new Promise((resolvePromise, reject) => {
    if (active.interrupted) {
      reject(new Refusal(`${label}: not started, ${active.interrupted} received`));
      return;
    }
    const fd = openSync(logFile, 'a');
    const child = spawn(
      '/bin/sh',
      ['-c', 'echo 1000 > /proc/self/oom_score_adj 2>/dev/null; exec "$0" "$@"', command, ...args],
      { cwd, env, detached: true, stdio: ['ignore', fd, fd] },
    );
    closeSync(fd);
    const pgid = child.pid;
    trackGroup(pgid);
    let aborted = null;
    const sample = () => {
      const mem = readMeminfo();
      guard.minAvailableMb = Math.min(guard.minAvailableMb ?? Infinity, mem.memAvailableMb);
      guard.peakGroupRssMb = Math.max(guard.peakGroupRssMb ?? 0, groupRssMb(pgid));
      if (!aborted && mem.memAvailableMb < guard.floorMb) {
        aborted = `memory guard: MemAvailable ${mem.memAvailableMb} MB < ${guard.floorMb} MB`;
        console.error(`release: ${label}: ${aborted}; killing the build`);
        appendFileSync(logFile, `\nrelease: ${aborted}; process group ${pgid} killed\n`);
        killGroup(pgid, 'SIGTERM');
        setTimeout(() => killGroup(pgid, 'SIGKILL'), 5000).unref();
      }
    };
    const timer = setInterval(sample, 500);
    sample();
    child.on('error', (error) => {
      clearInterval(timer);
      untrackGroup(pgid);
      reject(error);
    });
    child.on('exit', (code, signal) => {
      clearInterval(timer);
      // Nothing of a finished or failed step may keep running and writing.
      killGroup(pgid, 'SIGKILL');
      untrackGroup(pgid);
      if (aborted) reject(new Refusal(`${label}: ${aborted}`));
      else if (active.interrupted) reject(new Refusal(`${label}: interrupted by ${active.interrupted}`));
      else if (code !== 0) reject(new Refusal(`${label}: exit ${code ?? signal}; see ${logFile}`));
      else resolvePromise();
    });
  });
}

function runQuiet(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  return result;
}

// ------------------------------------------------------------------ validation

function readBuildId(standalone) {
  const id = readFileSync(join(standalone, '.next', 'BUILD_ID'), 'utf8').trim();
  if (!isBuildId(id)) throw new Refusal(`unexpected BUILD_ID ${JSON.stringify(id)}`);
  return id;
}

/** V4: HSTS is in the routes manifest exactly when the build was production (next.config.ts). */
function checkTransportFlag(standalone, afldbEnv) {
  const manifest = JSON.parse(readFileSync(join(standalone, '.next', 'routes-manifest.json'), 'utf8'));
  const hsts = (manifest.headers ?? []).some((rule) =>
    (rule.headers ?? []).some((h) => String(h.key).toLowerCase() === 'strict-transport-security'));
  if (hsts !== (afldbEnv === 'production')) {
    throw new Refusal(`transport flag: HSTS ${hsts ? 'present' : 'absent'} but --afldb-env ${afldbEnv}`);
  }
}

async function checkNoEnvFiles(dir) {
  const found = await findEnvFilesRecursive(dir);
  if (found.length > 0) throw new Refusal(`credential-named file(s) in the release: ${found.join(', ')}`);
}

/**
 * Every symlink in a release must resolve inside it. A link into a build
 * workspace or the checkout would make the release depend on a directory
 * that is deleted or changes later.
 */
export function linksOutside(dir) {
  const outside = [];
  const walk = (rel) => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
      const abs = join(dir, ...relPath.split('/'));
      if (entry.isSymbolicLink()) {
        const inside = relative(dir, resolve(dirname(abs), readlinkSync(abs)));
        if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) outside.push(`${relPath} -> ${readlinkSync(abs)}`);
      } else if (entry.isDirectory()) {
        walk(relPath);
      }
    }
  };
  walk('');
  return outside;
}

function checkLinks(dir) {
  const outside = linksOutside(dir);
  if (outside.length > 0) throw new Refusal(`symlink(s) leave the release: ${outside.slice(0, 10).join(', ')}`);
}

function sameTree(a, b, label) {
  if (!existsSync(a) && !existsSync(b)) return;
  if (!existsSync(a) || !existsSync(b)) throw new Refusal(`${label}: present on one side only`);
  const drift = classifyDrift(hashTree(a), hashTree(b));
  if (!drift.ok || drift.serverOutput.length > 0) {
    throw new Refusal(`${label} differs from the build output: ${JSON.stringify(drift).slice(0, 400)}`);
  }
}

/** V1, V3, links and the manifest, for a stored release. Returns the drift (ok may be false). */
export async function verifyRelease(root, id) {
  if (!isReleaseId(id)) throw new Refusal(`not a release id: ${id}`);
  const { dir, info } = readRelease(root, id);
  const standalone = join(dir, STANDALONE);
  for (const file of [join(standalone, 'server.js'), join(dir, 'deploy', 'server-cluster.mjs')]) {
    if (!existsSync(file)) throw new Refusal(`${id}: ${relative(dir, file)} missing`);
  }
  if (readBuildId(standalone) !== info.buildId) throw new Refusal(`${id}: BUILD_ID differs from release.json`);
  await checkNoEnvFiles(dir);
  checkLinks(dir);
  const manifestText = readFileSync(join(dir, MANIFEST), 'utf8');
  if (createHash('sha256').update(manifestText).digest('hex') !== info.manifest.sha256) {
    throw new Refusal(`${id}: ${MANIFEST} does not match the hash in release.json`);
  }
  const drift = classifyDrift(parseManifest(manifestText), releaseTree(dir));
  return { info, drift };
}

function reportDrift(id, drift) {
  if (drift.serverOutput.length > 0) {
    log(`${id}: ${drift.serverOutput.length} server-output file(s) differ (ISR; allowed)`);
  }
  if (!drift.ok) {
    const show = (name) => drift[name].slice(0, 10).join(', ');
    throw new Refusal(
      `${id}: release changed since it was built: missing ${drift.missing.length} [${show('missing')}], `
      + `changed ${drift.changed.length} [${show('changed')}], added ${drift.added.length} [${show('added')}]`,
    );
  }
}

function portInUse(port) {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolvePromise(true); });
    socket.once('error', () => resolvePromise(false));
  });
}

async function get(url, cookie = null) {
  const headers = cookie ? { cookie } : {};
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: 'manual', headers });
  const body = await response.text();
  return {
    status: response.status,
    type: response.headers.get('content-type') ?? '',
    location: response.headers.get('location'),
    cache: response.headers.get('x-nextjs-cache') ?? '',
    body,
  };
}

function firstCss(staticDir) {
  const found = hashTree(staticDir).map((e) => e.path).filter((p) => p.endsWith('.css')).sort();
  return found[0] ?? null;
}

/** Server log lines that mean a render or the database failed, however the response looked. */
export function smokeLogErrors(text) {
  return text.split('\n').filter((line) => /⨯|\bError:|\[health\]|Unhandled|EADDRINUSE/.test(line));
}

/**
 * A short-lived beta claim for the smoke's own requests, in the format
 * src/lib/auth/tokens.ts signClaim writes and the middleware verifies, so the
 * smoke renders real pages behind the beta gate. Signed with the service's own
 * AFLDB_SESSION_SECRET; null without one. Never logged.
 */
export function smokeClaimCookie(env, nowSeconds = Math.floor(Date.now() / 1000)) {
  const secret = env.AFLDB_SESSION_SECRET;
  if (!secret) return null;
  const epoch = env.AFLDB_BETA_EPOCH ? Number(env.AFLDB_BETA_EPOCH) : 1;
  if (!Number.isInteger(epoch)) return null;
  const payload = Buffer.from(JSON.stringify({ v: 1, kind: 'beta', sub: 'release-smoke', exp: nowSeconds + 300, epoch }));
  const mac = createHmac('sha256', secret).update(payload).digest();
  return `afldb_beta=${payload.toString('base64url')}.${mac.toString('base64url')}`;
}

/**
 * V6: boot the candidate as the service would and prove it serves its own
 * build and renders. The BUILD_ID-specific _buildManifest.js is what proves
 * the listener is the candidate and not some other server on the port. PORT,
 * AFLDB_WORKERS and HOSTNAME are set LAST: the production .env names the live
 * port and worker count.
 */
async function smokeStart({ candidate, buildId, unitText, envFileText, node, port, paths, logFile, guard }) {
  if (await portInUse(port)) throw new Refusal(`smoke: 127.0.0.1:${port} is already in use`);
  const env = {
    PATH: childPath(),
    ...serviceEnvironment(envFileText, unitText),
    PORT: String(port),
    AFLDB_WORKERS: '1',
    HOSTNAME: '127.0.0.1',
  };
  const fd = openSync(logFile, 'a');
  // A second Next server beside the live one: same oom_score_adj and memory guard as the build.
  const child = spawn(
    '/bin/sh',
    ['-c', 'echo 1000 > /proc/self/oom_score_adj 2>/dev/null; exec "$0" "$@"', node, 'deploy/server-cluster.mjs'],
    { cwd: candidate, env, detached: true, stdio: ['ignore', fd, fd] },
  );
  closeSync(fd);
  trackGroup(child.pid);
  let exited = null;
  child.on('exit', (code, signal) => { exited = code ?? signal; });
  let memoryAbort = null;
  const sample = () => {
    const mem = readMeminfo();
    guard.minAvailableMb = Math.min(guard.minAvailableMb ?? Infinity, mem.memAvailableMb);
    if (!memoryAbort && mem.memAvailableMb < guard.floorMb) {
      memoryAbort = `memory guard: MemAvailable ${mem.memAvailableMb} MB < ${guard.floorMb} MB`;
      console.error(`release: smoke: ${memoryAbort}; killing the smoke server`);
      killGroup(child.pid, 'SIGTERM');
    }
  };
  const timer = setInterval(sample, 500);
  sample();
  const cookie = smokeClaimCookie(env);
  const base = `http://127.0.0.1:${port}`;
  const page = (path) => get(`${base}${path}`, cookie);
  const result = { authenticated: cookie !== null };
  try {
    const deadline = Date.now() + 90_000;
    for (;;) {
      if (memoryAbort) throw new Refusal(`smoke: ${memoryAbort}`);
      if (exited !== null) throw new Refusal(`smoke: server exited (${exited}); see ${logFile}`);
      if (active.interrupted) throw new Refusal(`smoke: interrupted by ${active.interrupted}`);
      try {
        const health = await get(`${base}/api/health`);
        const json = JSON.parse(health.body);
        if (health.status === 200 && json.status === 'ok' && json.database === 'ok') {
          result.health = 'ok';
          break;
        }
        result.health = `${health.status} ${health.body.slice(0, 120)}`;
      } catch { /* not listening yet */ }
      if (Date.now() > deadline) throw new Refusal(`smoke: /api/health not ok within 90 s (${result.health ?? 'no answer'})`);
      await new Promise((r) => setTimeout(r, 1000));
    }
    const manifest = await get(`${base}/_next/static/${buildId}/_buildManifest.js`);
    if (manifest.status !== 200) throw new Refusal(`smoke: own _buildManifest.js answered ${manifest.status}`);
    result.buildManifest = 200;
    const css = firstCss(join(candidate, STANDALONE, '.next', 'static'));
    if (!css) throw new Refusal('smoke: the bundle holds no CSS asset');
    const asset = await get(`${base}/_next/static/${css}`);
    if (asset.status !== 200 || !asset.type.includes('text/css')) {
      throw new Refusal(`smoke: /_next/static/${css} answered ${asset.status} ${asset.type}`);
    }
    result.css = `/_next/static/${css}`;
    // Rendered pages, with the smoke's beta claim when the service has a session
    // secret. `/` must render; without a claim the beta gate redirects it to
    // /beta, and then /beta (the gate's own page) must render.
    result.pages = {};
    const html = (response) => response.status === 200 && response.type.includes('text/html');
    const home = await page('/');
    if (html(home)) {
      result.pages['/'] = `200 ${home.cache}`.trim();
    } else if ([307, 308].includes(home.status) && /^(https?:\/\/[^/]+)?\/beta(\?|$)/.test(home.location ?? '')) {
      result.pages['/'] = `${home.status} -> /beta (gate on)`;
      const beta = await get(`${base}/beta`);
      if (!html(beta)) throw new Refusal(`smoke: /beta answered ${beta.status}`);
      result.pages['/beta'] = 200;
    } else {
      throw new Refusal(`smoke: / answered ${home.status} ${home.location ?? ''}`);
    }
    for (const path of paths) {
      const response = await page(path);
      if (response.status !== 200) throw new Refusal(`smoke: ${path} answered ${response.status}`);
      // x-nextjs-cache HIT is a prerender served from disk; MISS or none rendered just now.
      result.pages[path] = `200 ${response.cache}`.trim();
    }
    const errors = smokeLogErrors(readFileSync(logFile, 'utf8'));
    if (errors.length > 0) throw new Refusal(`smoke: server logged errors: ${errors.slice(0, 5).join(' | ')}`);
    if (memoryAbort) throw new Refusal(`smoke: ${memoryAbort}`);
    return result;
  } finally {
    clearInterval(timer);
    killGroup(child.pid, 'SIGTERM');
    const stopBy = Date.now() + 10_000;
    while (exited === null && Date.now() < stopBy) await new Promise((r) => setTimeout(r, 200));
    killGroup(child.pid, 'SIGKILL');
    untrackGroup(child.pid);
  }
}

function writeReleaseRecord(dir, info, manifestText = formatManifest(releaseTree(dir))) {
  writeFileSync(join(dir, MANIFEST), manifestText);
  const entries = parseManifest(manifestText);
  const record = {
    ...info,
    manifest: {
      sha256: createHash('sha256').update(manifestText).digest('hex'),
      files: entries.length,
    },
  };
  writeFileSync(join(dir, RELEASE_JSON), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/** Publish under links.lock, waiting up to 60 s for a promote or rollback to finish. */
async function publishWhenFree(root, candidate, id) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      return await withLock(root, 'links', 'publish', () => publish(root, candidate, id));
    } catch (error) {
      const busy = error instanceof Refusal && /is held by|is being taken/.test(error.message);
      if (!busy || Date.now() > deadline || active.interrupted) throw error;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

/** The one rename that makes a release exist. Under links.lock. */
function publish(root, candidate, id) {
  const target = join(root, 'releases', id);
  mkdirSync(join(root, 'releases'), { recursive: true });
  if (existsSync(target)) throw new Refusal(`${target} already exists; a release is never overwritten`);
  renameSync(candidate, target);
  return target;
}

// ------------------------------------------------------------------ commands

/** Children (npm, next, the smoke server) run on the same Node as this tool. */
function childPath() {
  return `${dirname(process.execPath)}:${process.env.PATH ?? '/usr/bin:/bin'}`;
}

/**
 * The service runs the Node its unit pins. Where that interpreter exists on
 * this host, the build and the smoke must run on it too: a non-interactive
 * shell's PATH can resolve a much older Node (deploy/sync-dev.ps1 notes).
 */
function resolveNode(unitText, opts) {
  const unitNode = parseExecStartNode(unitText);
  if (unitNode && existsSync(unitNode)) {
    if (realpathSync(unitNode) !== realpathSync(process.execPath) && !opts['allow-node-mismatch']) {
      throw new Refusal(`this tool runs on ${process.execPath} (${process.version}) but the unit pins ${unitNode}; `
        + 'run it with that interpreter');
    }
    return unitNode;
  }
  log(`the unit's interpreter ${unitNode} is not on this host; building and smoking with ${process.execPath} (${process.version})`);
  return process.execPath;
}

function checkRootOutsideCheckout(root, checkout) {
  const rel = relative(checkout, root);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    throw new Refusal(`the release root ${root} must be outside the checkout ${checkout}`);
  }
}

function checkRevision(checkout, revision) {
  if (!isRevision(revision)) throw new Refusal(`--revision must be a full 40-hex commit, got ${revision}`);
  const r = runQuiet('git', ['-C', checkout, 'cat-file', '-e', `${revision}^{commit}`]);
  if (r.status !== 0) throw new Refusal(`${revision} is not a commit in ${checkout}`);
}

function gitShow(checkout, revision, path) {
  const r = runQuiet('git', ['-C', checkout, 'show', `${revision}:${path}`], { encoding: 'buffer' });
  if (r.status !== 0) throw new Refusal(`git show ${revision}:${path} failed`);
  return r.stdout;
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

/** A fresh workspace under builds/; never an existing one, however close two runs are. */
function newWorkspace(root, label) {
  mkdirSync(join(root, 'builds'), { recursive: true });
  const workspace = join(root, 'builds', `${stamp()}-${label}-${randomBytes(3).toString('hex')}`);
  mkdirSync(workspace);
  return workspace;
}

async function extract(checkout, revision, dest, logFile) {
  mkdirSync(dest, { recursive: true });
  await new Promise((resolvePromise, reject) => {
    const fd = openSync(logFile, 'a');
    const git = spawn('git', ['-C', checkout, 'archive', '--format=tar', revision], { stdio: ['ignore', 'pipe', fd] });
    const tar = spawn('tar', ['-x', '-f', '-', '-C', dest], { stdio: ['pipe', fd, fd] });
    closeSync(fd);
    git.stdout.pipe(tar.stdin);
    let pending = 2;
    let failed = null;
    const done = (name) => (code) => {
      if (code !== 0) failed ??= `${name} exit ${code}`;
      if (--pending === 0) (failed ? reject(new Refusal(`extract: ${failed}; see ${logFile}`)) : resolvePromise());
    };
    git.on('exit', done('git archive'));
    tar.on('exit', done('tar'));
    git.on('error', reject);
    tar.on('error', reject);
  });
}

async function cmdBuild(opts) {
  const root = resolve(opts.root);
  const checkout = resolve(required(opts, 'checkout'));
  const revision = required(opts, 'revision');
  const afldbEnv = required(opts, 'afldb-env');
  if (!['production', 'development'].includes(afldbEnv)) throw new Refusal('--afldb-env must be production or development');
  if (!['in-build', 'off-host'].includes(opts.typecheck)) throw new Refusal('--typecheck must be in-build or off-host');
  if (opts.typecheck === 'off-host' && !opts['typecheck-evidence']) {
    throw new Refusal('--typecheck off-host needs --typecheck-evidence: where this exact revision passed `npm run typecheck`');
  }
  const envFile = resolve(opts['env-file'] ?? join(checkout, '.env'));
  const smokePaths = opts['smoke-paths'] ? String(opts['smoke-paths']).split(',').filter(Boolean) : [];
  checkRootOutsideCheckout(root, checkout);
  checkRevision(checkout, revision);
  if (!existsSync(envFile)) throw new Refusal(`${envFile} not found`);
  const unitText = gitShow(checkout, revision, 'deploy/afldb.service').toString('utf8');
  const node = resolveNode(unitText, opts);

  return withLock(root, 'build', 'build', async () => {
    const mem = readMeminfo();
    const disk = freeGb(root);
    log(`admission: MemAvailable ${mem.memAvailableMb} MB of ${mem.memTotalMb} MB, swap ${mem.swapTotalMb} MB, `
      + `free disk ${disk.toFixed(1)} GB`);
    const admitMb = opts['require-available-mb'] === undefined
      ? DEFAULTS.requireAvailableMb[opts.typecheck]
      : num(opts, 'require-available-mb');
    if (mem.memAvailableMb < admitMb) {
      throw new Refusal(`admission: MemAvailable ${mem.memAvailableMb} MB < ${admitMb} MB for typecheck ${opts.typecheck} `
        + '(the measured build need plus the guard floor; see docs/deployment.md §3a)');
    }
    if (disk < num(opts, 'require-free-gb')) throw new Refusal(`admission: ${disk.toFixed(1)} GB free < ${num(opts, 'require-free-gb')} GB`);

    const workspace = newWorkspace(root, revision.slice(0, 12));
    const src = join(workspace, 'src');
    const candidate = join(workspace, 'candidate');
    const guard = { floorMb: num(opts, 'min-available-mb') };
    const phases = {};
    // The checkout's .env decides every name it defines, as it does for the service: the
    // operator's shell may not override one (Next lets process.env win over .env).
    const envFileNames = new Set(Object.keys(parseEnv(readFileSync(envFile, 'utf8'))));
    const shadowed = Object.keys(process.env).filter((name) => envFileNames.has(name));
    if (shadowed.length > 0) log(`build environment: ignoring the shell's ${shadowed.join(', ')} (.env defines them)`);
    const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !envFileNames.has(name)));
    Object.assign(baseEnv, { PATH: childPath(), NEXT_TELEMETRY_DISABLED: '1' });
    const heapEnv = { NODE_OPTIONS: `--max-old-space-size=${num(opts, 'heap-mb')}` };
    // One guarded npm step; its own memory figures, folded into the build's.
    const step = async (label, args, extraEnv, logName) => {
      const sofar = { min: guard.minAvailableMb, peak: guard.peakGroupRssMb };
      guard.minAvailableMb = undefined;
      guard.peakGroupRssMb = undefined;
      const started = Date.now();
      try {
        await runGuarded('npm', args, {
          cwd: src, env: { ...baseEnv, ...extraEnv }, logFile: join(workspace, logName), guard, label,
        });
      } finally {
        phases[label] = {
          seconds: Math.round((Date.now() - started) / 1000),
          minAvailableMb: guard.minAvailableMb,
          peakRssMb: guard.peakGroupRssMb,
        };
        log(`${label}: ${phases[label].seconds} s, min MemAvailable ${guard.minAvailableMb} MB, peak RSS ${guard.peakGroupRssMb} MB`);
        guard.minAvailableMb = Math.min(sofar.min ?? Infinity, guard.minAvailableMb ?? Infinity);
        guard.peakGroupRssMb = Math.max(sofar.peak ?? 0, guard.peakGroupRssMb ?? 0);
      }
    };
    event(root, 'build-start', { revision, workspace, afldbEnv, memAvailableMb: mem.memAvailableMb });
    log(`workspace ${workspace}`);
    try {
      await extract(checkout, revision, src, join(workspace, 'extract.log'));
      symlinkSync(envFile, join(src, '.env'));
      await step('npm ci', ['ci', '--no-audit', '--no-fund'], {}, 'npm-ci.log');
      await step('build', ['run', 'build'], {
        ...heapEnv,
        AFLDB_ENV: afldbEnv,
        AFLDB_BUILD_WORKERS: String(num(opts, 'build-workers')),
        // The type-check is the build's memory peak (the 2026-10-31 OOM). off-host skips it
        // here, on the strength of the recorded evidence that this revision passed it elsewhere.
        // Always set: an empty value also shadows any AFLDB_BUILD_TYPECHECK in .env.
        AFLDB_BUILD_TYPECHECK: opts.typecheck === 'off-host' ? 'off-host' : '',
      }, 'build.log');

      // Assemble: the bundle moves out of the build tree, the supervisor of the same revision goes beside it.
      const buildStandalone = join(src, STANDALONE);
      const buildId = readBuildId(buildStandalone);
      if (readFileSync(join(src, '.next', 'BUILD_ID'), 'utf8').trim() !== buildId) {
        throw new Refusal('V1: .next/BUILD_ID and the bundle BUILD_ID differ');
      }
      const id = releaseId(revision, buildId);
      mkdirSync(join(candidate, 'deploy'), { recursive: true });
      mkdirSync(join(candidate, '.next'), { recursive: true });
      renameSync(buildStandalone, join(candidate, STANDALONE));
      copyFileSync(join(src, 'deploy', 'server-cluster.mjs'), join(candidate, 'deploy', 'server-cluster.mjs'));
      const standalone = join(candidate, STANDALONE);
      if (!existsSync(join(standalone, 'server.js'))) throw new Refusal('V1: server.js missing from the bundle');
      sameTree(join(src, '.next', 'static'), join(standalone, '.next', 'static'), 'V2 .next/static');
      sameTree(join(src, 'public'), join(standalone, 'public'), 'V2 public');
      await checkNoEnvFiles(candidate);
      checkLinks(candidate);
      checkTransportFlag(standalone, afldbEnv);
      // The build tree is no longer needed; free its disk before the smoke.
      rmSync(src, { recursive: true, force: true });
      // V5 before the smoke, so nothing the smoke server writes enters the baseline.
      const manifestText = formatManifest(releaseTree(candidate));
      log(`candidate ${id} passed V1-V5; boot smoke on 127.0.0.1:${num(opts, 'smoke-port')}`);
      const smoke = await smokeStart({
        guard,
        candidate,
        buildId,
        unitText,
        envFileText: readFileSync(envFile, 'utf8'),
        node,
        port: num(opts, 'smoke-port'),
        paths: smokePaths,
        logFile: join(workspace, 'smoke.log'),
      });
      log(`smoke: health ${smoke.health}, _buildManifest.js 200, ${smoke.css} 200, pages ${JSON.stringify(smoke.pages)}`
        + `${smoke.authenticated ? ' (beta claim)' : ''}`);
      if (active.interrupted) throw new Refusal(`interrupted by ${active.interrupted}`);
      // V7: the smoke may only have written the server's own ISR output.
      const afterSmoke = classifyDrift(parseManifest(manifestText), releaseTree(candidate));
      if (!afterSmoke.ok) {
        throw new Refusal(`V7: the smoke changed the release: ${[...afterSmoke.missing, ...afterSmoke.changed, ...afterSmoke.added].slice(0, 5).join(', ')}`);
      }
      smoke.serverOutputWritten = afterSmoke.serverOutput;
      const record = writeReleaseRecord(candidate, {
        schema: 'afldb-release/1',
        id,
        revision,
        buildId,
        afldbEnv,
        createdBy: 'build',
        migrationHead: gitMigrationHead(checkout, revision),
        createdAt: new Date().toISOString(),
        host: hostname(),
        node: process.version,
        build: {
          heapMb: num(opts, 'heap-mb'),
          workers: num(opts, 'build-workers'),
          typecheck: opts.typecheck,
          typecheckEvidence: opts.typecheck === 'off-host' ? opts['typecheck-evidence'] : null,
          minAvailableMb: guard.minAvailableMb,
          peakBuildRssMb: guard.peakGroupRssMb,
          phases,
          memTotalMb: mem.memTotalMb,
          memAvailableAtStartMb: mem.memAvailableMb,
          swapTotalMb: mem.swapTotalMb,
          buildLogSha256: sha256File(join(workspace, 'build.log')),
        },
        smoke,
      }, manifestText);
      if (active.interrupted) throw new Refusal(`interrupted by ${active.interrupted}`);
      const target = await publishWhenFree(root, candidate, id);
      event(root, 'build-pass', { id, revision, buildId, manifest: record.manifest.sha256, workspace });
      log(`RELEASE READY ${id} (${record.manifest.files} files, manifest ${record.manifest.sha256.slice(0, 12)}…) at ${target}`);
      log(`next: node deploy/release.mjs promote ${id} --attended${rootArg(root)}`);
      return 0;
    } catch (error) {
      // Keep the logs and the source for inspection; drop the dependency tree and the build
      // output, which can hold the transient .env copy Next makes before prepare-standalone strips it.
      rmSync(join(src, 'node_modules'), { recursive: true, force: true });
      rmSync(join(src, '.next'), { recursive: true, force: true });
      event(root, 'build-fail', { revision, workspace, reason: String(error.message ?? error) });
      log(`BUILD FAILED; nothing was promoted and no release changed. Workspace kept for inspection: ${workspace}`);
      throw error;
    }
  });
}

function rootArg(root) {
  return root === DEFAULT_ROOT ? '' : ` --root ${root}`;
}

async function cmdVerify(opts, id) {
  const root = resolve(opts.root);
  const { info, drift } = await verifyRelease(root, id);
  reportDrift(id, drift);
  log(`VERIFY PASS ${id} (revision ${info.revision}, BUILD_ID ${info.buildId}, ${info.manifest.files} files)`);
  return 0;
}

/** The service's main process and the directory it runs in; both null when it is not running. */
function serviceRelease(opts) {
  let pid = opts.pid ? Number(opts.pid) : null;
  if (!pid) pid = Number(runQuiet('systemctl', ['show', '-p', 'MainPID', '--value', opts.unit]).stdout.trim());
  if (!pid) return { pid: null, cwd: null };
  return { pid, cwd: readlinkSync(`/proc/${pid}/cwd`) };
}

function afterSwitch(id, root, attendedWindow) {
  log('next, NOW and attended: sudo systemctl restart afldb');
  log(`then: node deploy/release.mjs status --expect ${id}${rootArg(root)}`);
  if (attendedWindow) {
    log('the activation window is OPEN: `current` names the new release but the service still runs the old one; any '
      + 'restart before yours (an unattended upgrade, a PostgreSQL restart) activates it without the gate (ISSUE-351)');
  }
  log('the database is not rolled back: migrations are forward-only (docs/deployment.md §11, including the '
    + 'ISSUE-257 guard); check a release older than an applied migration against it before the restart');
}

// ------------------------------------------------------------------ AFLDB-ISSUE-351: host state and the attended gate

function systemctlUnit(unit) {
  try {
    const r = runQuiet('systemctl', ['show', unit, '--timestamp=utc', '-p', 'ActiveState', '-p', 'MainPID', '-p', 'InvocationID',
      '-p', 'NRestarts', '-p', 'ActiveEnterTimestamp']);
    return r.status === 0 ? unitSnapshot(parseShowProps(r.stdout)) : null;
  } catch {
    return null; // no systemd (a test host): unknown, never a guess
  }
}

/**
 * Command lines (ERE, for `pgrep -f`) of a RUNNING apt upgrade: the `unattended-upgrade` binary itself or the
 * `apt.systemd.daily` driver. The long-lived `unattended-upgrade-shutdown --wait-for-signal` handler (always running, so
 * not evidence of an upgrade) and a path merely containing "unattended-upgrades/" do not match (ISSUE-351, found by the
 * real-systemd smoke of host-gate: matching the process name refused a clear host).
 */
export const APT_RUN_COMMAND_PATTERN = '(^|/)(unattended-upgrade( |$)|apt\\.systemd\\.daily)';

/**
 * The host facts the gate reads. READ-ONLY: `systemctl show/is-active/list-timers`, `pgrep`, two world-readable
 * paths. Nothing here runs apt, needrestart or unattended-upgrade. `--host-state <json>` replaces the reads with a
 * fixture (tests, rehearsal) and is reported as such. With `--pid` (a service that is not the systemd unit) the
 * unit is not read at all.
 */
export function collectHostState(opts) {
  if (opts['host-state']) {
    const fixture = JSON.parse(readFileSync(resolve(opts['host-state']), 'utf8'));
    return { ...fixture, nowMs: fixture.nowMs ?? Date.now(), source: 'fixture' };
  }
  const state = { source: 'host', nowMs: Date.now(), aptActive: [], aptProcesses: [], nextAptUpgradeMs: null, rebootRequired: null, needrestartHold: null, units: {} };
  const quiet = (command, args) => { try { return runQuiet(command, args); } catch { return { status: 127, stdout: '' }; } };
  for (const unit of ['apt-daily.service', 'apt-daily-upgrade.service']) {
    if (['active', 'activating', 'reloading'].includes(quiet('systemctl', ['is-active', unit]).stdout.trim())) state.aptActive.push(unit);
  }
  for (const name of ['apt', 'apt-get', 'dpkg']) {
    if (quiet('pgrep', ['-x', name]).status === 0) state.aptProcesses.push(name);
  }
  // NOT `pgrep -x unattended-upgr`: the always-running shutdown handler has that process name and would refuse every promote.
  if (quiet('pgrep', ['-f', APT_RUN_COMMAND_PATTERN]).status === 0) state.aptProcesses.push('unattended-upgrade');
  try {
    const timers = JSON.parse(quiet('systemctl', ['list-timers', 'apt-daily-upgrade.timer', '--all', '-o', 'json', '--no-pager']).stdout);
    const next = timers.find((t) => t.unit === 'apt-daily-upgrade.timer')?.next;
    state.nextAptUpgradeMs = next ? Math.floor(next / 1000) : null;
  } catch { /* leave null: reported as unknown */ }
  if (existsSync('/var/run/reboot-required')) {
    let pkgs = [];
    try { pkgs = readFileSync('/var/run/reboot-required.pkgs', 'utf8').split('\n').filter(Boolean); } catch { /* optional file */ }
    state.rebootRequired = { present: true, pkgs };
  } else {
    state.rebootRequired = { present: false, pkgs: [] };
  }
  try {
    const dir = '/etc/needrestart/conf.d';
    state.needrestartHold = needrestartHold(readdirSync(dir).filter((n) => n.endsWith('.conf')).sort()
      .map((n) => readFileSync(join(dir, n), 'utf8')).join('\n'));
  } catch { /* leave null */ }
  if (!opts.pid) {
    for (const unit of [opts.unit, opts['pg-unit']]) state.units[unit] = systemctlUnit(unit) ?? { activeState: null, mainPid: null, invocationId: null, nRestarts: null, activeEnterMs: null };
  }
  return state;
}

/** ISSUE-351: promote and rollback are one attended step with the owner's restart, never a standalone switch. */
function requireAttended(opts, what) {
  if (opts.attended) return;
  throw new Refusal(`${what} switches the release the service starts from, and the service restarts on any unattended `
    + 'package upgrade or PostgreSQL restart (ISSUE-351). Run it only as one attended step with your own restart and '
    + `status gate, and say so with --attended. Nothing was changed.`);
}

/** The pre-switch host gate; returns what is recorded in the event. Rollback only warns; promote refuses. */
function runHostGate(opts, mode) {
  if (opts['no-live']) return { skipped: '--no-live (service deliberately stopped)', window: null };
  if (opts['skip-host-gate']) {
    log(`WARNING host gate skipped: ${opts['skip-host-gate']}`);
    return { skipped: String(opts['skip-host-gate']), window: null };
  }
  const state = collectHostState(opts);
  const verdict = evaluateHostGate(state, { windowMin: opts['window-min'] ? num(opts, 'window-min') : 90, strict: Boolean(opts.strict), mode });
  log(`host gate (${state.source}, ${mode}):`);
  for (const fact of verdict.facts) log(`  ${fact}`);
  for (const w of verdict.warnings) log(`  WARNING ${w}`);
  for (const r of verdict.refusals) log(`  REFUSE ${r}`);
  if (!verdict.ok) {
    throw new Refusal(`host gate refused ${mode}: ${verdict.refusals.join('; ')}. Wait, or pass --skip-host-gate "<reason>" (recorded)`);
  }
  return {
    skipped: null,
    window: {
      at: new Date(state.nowMs).toISOString(),
      afldb: state.units?.[opts.unit] ?? null,
      postgres: state.units?.[opts['pg-unit']] ?? null,
      warnings: verdict.warnings,
    },
  };
}

/** Migration head recorded in a release, or derived from a checkout for a release built before ISSUE-351. */
function gitMigrationHead(checkout, revision) {
  try {
    const r = runQuiet('git', ['-C', checkout, 'ls-tree', '--name-only', '-r', revision, '--', 'src/db/migrations']);
    return r.status === 0 ? migrationHeadOf(r.stdout.split('\n').filter(Boolean)) : null;
  } catch {
    return null;
  }
}

/**
 * Promote only from a settled state: the service must be running the release
 * `current` names. Otherwise an earlier promotion is still waiting for its
 * restart, and `previous` would name a release that never served.
 */
async function cmdPromote(opts, id) {
  const root = resolve(opts.root);
  requireAttended(opts, 'promote');
  return withLock(root, 'links', 'promote', async () => {
    const { drift } = await verifyRelease(root, id);
    reportDrift(id, drift);
    const current = readReleaseLink(root, 'current');
    if (current === id) throw new Refusal(`${id} is already current`);
    if (current && !opts['no-live']) {
      const live = serviceRelease(opts);
      const want = realpathSync(join(root, 'releases', current));
      if (live.cwd !== want) {
        throw new Refusal(`the service (MainPID ${live.pid ?? 'none'}) is not running current ${current} `
          + `(${live.cwd ?? 'not running'}); restart and check status before promoting again, or pass --no-live `
          + 'when the service is deliberately stopped');
      }
    }
    const gate = runHostGate(opts, 'promote');
    if (current) switchLink(root, 'previous', `releases/${current}`);
    switchLink(root, 'current', `releases/${id}`);
    event(root, 'promote', { id, previous: current, attended: true, hostGateSkipped: gate.skipped, window: gate.window });
    log(`PROMOTED ${id}; previous ${current ?? '(none)'}. The running service is unchanged until it restarts.`);
    afterSwitch(id, root, true);
    return 0;
  });
}

function everPassed(root, id) {
  try {
    return readFileSync(join(root, 'events.log'), 'utf8').split('\n')
      .some((line) => line.includes('"op":"status-pass"') && line.includes(`"id":"${id}"`));
  } catch {
    return false;
  }
}

/**
 * Point `current` at a retained release: `previous` by default, or any
 * release named with --to. No build, npm or Git. `current` moves first, so a
 * crash between the two renames leaves the service pointed at the target.
 */
async function cmdRollback(opts) {
  const root = resolve(opts.root);
  requireAttended(opts, 'rollback');
  return withLock(root, 'links', 'rollback', async () => {
    const current = readReleaseLink(root, 'current');
    const target = opts.to ?? readReleaseLink(root, 'previous');
    if (!target) throw new Refusal('no previous release; name one with --to <id>');
    if (target === current) throw new Refusal(`${target} is already current`);
    const { info, drift } = await verifyRelease(root, target);
    reportDrift(target, drift);
    if (!everPassed(root, target)) log(`warning: ${target} has no recorded status PASS in events.log`);
    // ISSUE-351: schema compatibility. Refuses only a PROVEN mismatch against a ledger head the operator supplied;
    // with no ledger head (database down) it proceeds and records that nothing was checked.
    const targetHead = info.migrationHead ?? (opts.checkout ? gitMigrationHead(resolve(opts.checkout), info.revision) : null);
    const ledger = checkRollbackLedger({ targetHead, ledgerHead: opts['ledger-head'], accept: opts['accept-schema-ahead'] });
    log(`ledger: ${ledger.message}`);
    if (!ledger.ok) throw new Refusal(`rollback: ${ledger.message}`);
    const gate = runHostGate(opts, 'rollback');
    event(root, 'rollback-start', { id: target, from: current });
    switchLink(root, 'current', `releases/${target}`);
    if (current) switchLink(root, 'previous', `releases/${current}`);
    event(root, 'rollback', { id: target, from: current, attended: true, ledger: ledger.status, targetMigrationHead: targetHead,
      ledgerHead: opts['ledger-head'] ?? null, hostGateSkipped: gate.skipped, window: gate.window });
    log(`ROLLED BACK to ${target} (no rebuild); previous is now ${current ?? '(none)'}.`);
    afterSwitch(target, root, true);
    return 0;
  });
}

// ------------------------------------------------------------------ AFLDB-ISSUE-351 status: the activation window audit

function readEvents(root) {
  try {
    return readFileSync(join(root, 'events.log'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Was the restart that made `id` live an unattended one? Compares the service identity recorded at promote time with now,
 * and whether the (re)start coincides with an apt run (the unattended-upgrade + needrestart signature). Read-only.
 * `confirmInvocation` (ISSUE-366 §5): the systemd InvocationID the owner attested; it accepts only that one restart.
 * @param {{ events: any[], id: string, now: any, aptEntries: any[], confirmed: boolean, confirmInvocation?: string | null, nowMs: number }} input
 * @returns {{ problems: string[], notes: string[] }}
 */
export function auditActivation({ events, id, now, aptEntries, confirmed, confirmInvocation = null, nowMs }) {
  const out = { problems: [], notes: [] };
  const opened = [...events].reverse().find((e) => (e.op === 'promote' || e.op === 'rollback') && e.id === id);
  // AFLDB-ISSUE-366 §5: an owner confirmation bound to one restart (InvocationID). It covers that invocation only: a new
  // invocation needs its own attestation, and nothing (promote --attended, an earlier status PASS) stands in for one.
  if (confirmInvocation) {
    if (!now?.invocationId) {
      out.problems.push(`--confirm-restart-invocation ${confirmInvocation} given, but the service InvocationID cannot be read: the confirmation cannot be matched`);
      return out;
    }
    if (now.invocationId !== confirmInvocation) {
      out.problems.push(`--confirm-restart-invocation names InvocationID ${confirmInvocation}, but the service is now InvocationID ${now.invocationId}: `
        + 'a confirmation covers only the restart it names; this invocation needs its own attestation');
    }
  }
  if (!now) return out;
  const attested = confirmInvocation ? now.invocationId === confirmInvocation : Boolean(confirmed);
  out.notes.push(`service InvocationID ${now.invocationId ?? '?'} NRestarts ${now.nRestarts ?? '?'} ActiveEnter ${now.activeEnterMs ? new Date(now.activeEnterMs).toISOString() : '?'}`);
  if (confirmInvocation && attested) out.notes.push(`owner-attested restart: InvocationID ${confirmInvocation} (this invocation only)`);
  if (!opened?.window?.afldb) { out.notes.push(`no recorded activation window for ${id} (promoted before ISSUE-351 or with the gate skipped)`); return out; }
  const before = opened.window.afldb;
  const openedMs = Date.parse(opened.window.at);
  if (before.invocationId && now.invocationId && before.invocationId !== now.invocationId) {
    out.notes.push(`restarted since ${opened.op} (InvocationID ${before.invocationId} -> ${now.invocationId})`);
    const hit = restartCoincidesWithApt(aptEntries ?? [], now.activeEnterMs);
    if (hit && !attested) {
      out.problems.push(`the service (re)started at ${new Date(now.activeEnterMs).toISOString()}, during/after an apt run `
        + `(${new Date(hit.startMs).toISOString()} ${hit.command}): that is the unattended-upgrade signature, so this may not be your attended restart. `
        + `If it was yours, rerun with --confirm-restart-invocation ${now.invocationId ?? '<InvocationID>'}`);
    }
  }
  const runs = aptRunsBetween(aptEntries ?? [], openedMs, nowMs);
  if (runs.length > 0) out.notes.push(`${runs.length} apt run(s) since the ${opened.op}: ${runs.map((r) => new Date(r.startMs).toISOString()).join(', ')}`);
  return out;
}

/**
 * Build identity without request tracing: the running process's working
 * directory is the release systemd resolved `current` to when it started, and
 * only that build answers its own BUILD_ID's _buildManifest.js.
 */
async function cmdStatus(opts) {
  const root = resolve(opts.root);
  const problems = [];
  const confirmInvocation = opts['confirm-restart-invocation'];
  if (confirmInvocation !== undefined) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(confirmInvocation)) throw new Refusal('--confirm-restart-invocation needs the InvocationID of the restart the owner attests');
    if (!opts.expect || opts['no-live']) throw new Refusal('--confirm-restart-invocation applies only to a live status --expect <id>');
  }
  const current = readReleaseLink(root, 'current');
  const previous = readReleaseLink(root, 'previous');
  const describe = (id) => {
    if (!id) return { id: null };
    const { info } = readRelease(root, id);
    return { id, revision: info.revision, buildId: info.buildId, afldbEnv: info.afldbEnv, createdBy: info.createdBy };
  };
  const cur = describe(current);
  const prev = describe(previous);
  log(`current  ${cur.id ?? '(none)'}${cur.id ? ` revision ${cur.revision} BUILD_ID ${cur.buildId} ${cur.afldbEnv}` : ''}`);
  log(`previous ${prev.id ?? '(none)'}${prev.id ? ` revision ${prev.revision} BUILD_ID ${prev.buildId}` : ''}`);
  if (!cur.id) problems.push('no current release');
  if (opts.expect && opts.expect !== cur.id) problems.push(`current is ${cur.id}, expected ${opts.expect}`);

  if (!opts['no-live'] && cur.id) {
    let live = { pid: null, cwd: null };
    try { live = serviceRelease(opts); } catch (error) { problems.push(`cannot read the service process: ${error.message}`); }
    if (!opts.pid) {
      const memory = runQuiet('systemctl', ['show', '-p', 'MemoryCurrent', '--value', opts.unit]).stdout.trim();
      if (/^\d+$/.test(memory)) log(`memory   ${opts.unit} MemoryCurrent ${Math.round(Number(memory) / 1024 ** 2)} MB`);
    }
    if (!live.pid) {
      problems.push(`${opts.unit} has no MainPID (not running)`);
    } else if (live.cwd !== null) {
      log(`process  ${live.pid} runs in ${live.cwd}`);
      const want = realpathSync(join(root, 'releases', cur.id));
      if (live.cwd !== want) problems.push(`process ${live.pid} runs in ${live.cwd}, not ${want} (restart pending?)`);
    }
    const base = opts.url.replace(/\/$/, '');
    try {
      const health = await get(`${base}/api/health`);
      const json = JSON.parse(health.body);
      log(`health   ${health.status} status=${json.status} database=${json.database}`);
      if (health.status !== 200 || json.status !== 'ok' || json.database !== 'ok') problems.push('health not ok');
      const own = await get(`${base}/_next/static/${cur.buildId}/_buildManifest.js`);
      log(`build    /_next/static/${cur.buildId}/_buildManifest.js ${own.status}`);
      if (own.status !== 200) problems.push(`current BUILD_ID manifest answered ${own.status}`);
      if (prev.id && prev.buildId !== cur.buildId) {
        const old = await get(`${base}/_next/static/${prev.buildId}/_buildManifest.js`);
        log(`build    /_next/static/${prev.buildId}/_buildManifest.js ${old.status} (previous; expect 404)`);
        if (old.status !== 404) problems.push(`previous BUILD_ID manifest answered ${old.status}`);
      }
    } catch (error) {
      problems.push(`HTTP probe of ${base} failed: ${error.message}`);
    }
  }
  // ISSUE-351: who made this release live? Service identity (InvocationID, NRestarts, ActiveEnter) against the window
  // recorded at promote/rollback, and against apt activity. Read-only; a host without systemd reports nothing.
  let serviceNow = null;
  if (!opts['no-live'] && cur.id) {
    let nowMs = Date.now();
    if (opts['host-state']) {
      const fixture = collectHostState(opts);
      serviceNow = fixture.units?.[opts.unit] ?? null;
      nowMs = fixture.nowMs;
    } else if (!opts.pid) {
      serviceNow = systemctlUnit(opts.unit);
    }
    const hostState = { nowMs };
    let aptEntries = [];
    try { aptEntries = parseAptHistory(readFileSync(opts['apt-history'] ?? '/var/log/apt/history.log', 'utf8')); } catch { log('apt history unreadable: activation audit limited to service identity'); }
    const audit = auditActivation({
      events: readEvents(root), id: cur.id, now: serviceNow, aptEntries, confirmed: Boolean(opts['confirm-attended-restart']),
      confirmInvocation: opts['confirm-restart-invocation'] ?? null, nowMs: hostState.nowMs,
    });
    for (const note of audit.notes) log(`activation ${note}`);
    if (opts.expect) problems.push(...audit.problems);
    const lastPass = [...readEvents(root)].reverse().find((e) => e.op === 'status-pass' && e.id === cur.id);
    if (!opts.expect && lastPass?.invocationId && serviceNow?.invocationId && lastPass.invocationId !== serviceNow.invocationId) {
      log(`note: the service restarted since the last attested PASS (InvocationID ${lastPass.invocationId} -> ${serviceNow.invocationId}); `
        + 'compare with your maintenance log: this was not a restart you attested');
    }
  }
  if (opts.checkout) {
    const nm = checkNodeModules(resolve(opts.checkout));
    log(`node_modules ${nm.status}${nm.status === 'unknown' ? ' (no installed record)' : `, ${nm.checked} installed packages`}`);
    if (nm.status === 'mismatch') problems.push(`node_modules differ from package-lock.json: ${nodeModulesSummary(nm)}`);
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(`release: FAIL ${p}`);
    log('STATUS FAIL');
    return 1;
  }
  // A live, expected PASS is what makes a release a known-good rollback target.
  if (opts.expect && !opts['no-live']) {
    event(root, 'status-pass', {
      id: cur.id, invocationId: serviceNow?.invocationId ?? null, nRestarts: serviceNow?.nRestarts ?? null,
      // Recorded for audit only: a later status run never reads it as a confirmation (ISSUE-366 §5).
      restartConfirmation: confirmInvocation ? { invocationId: confirmInvocation } : opts['confirm-attended-restart'] ? 'unbound-flag' : null,
    });
  }
  log(`STATUS PASS ${cur.id}`);
  return 0;
}

/** ISSUE-364: the serving checkout's installed tree against its lockfile (the settle timers run from it). */
export function checkNodeModules(checkout) {
  const read = (file) => { try { return JSON.parse(readFileSync(join(checkout, file), 'utf8')); } catch { return null; } };
  const lock = read('package-lock.json');
  if (!lock) return { status: 'unknown', changed: [], extraneous: [], missing: [], checked: 0, reason: 'package-lock.json unreadable' };
  return compareNodeModulesToLock(lock, read(join('node_modules', '.package-lock.json')));
}

function nodeModulesSummary(nm) {
  const part = (label, list) => (list.length ? `${label} ${list.length} [${list.slice(0, 3).join('; ')}]` : null);
  return [part('changed', nm.changed), part('extraneous', nm.extraneous), part('missing', nm.missing)].filter(Boolean).join(', ');
}

/** `check-node-modules --checkout <dir>`: exit 0 ok/unknown, 1 mismatch. The settle wrapper only warns on 1 (H-7). */
async function cmdCheckNodeModules(opts) {
  const nm = checkNodeModules(resolve(required(opts, 'checkout')));
  if (nm.status === 'mismatch') {
    console.error(`release: node_modules differ from package-lock.json: ${nodeModulesSummary(nm)}`);
    log('NODE_MODULES MISMATCH');
    return 1;
  }
  log(`NODE_MODULES ${nm.status.toUpperCase()}${nm.status === 'ok' ? ` (${nm.checked} installed packages match the lock)` : ` (${nm.reason ?? 'no installed record'}; not verified)`}`);
  return 0;
}

/** `host-gate [--mode promote|rollback] [--strict] [--window-min N]`: the packet gate. Read-only; exit 1 on refusal. */
async function cmdHostGate(opts) {
  const mode = opts.mode ?? 'promote';
  if (!['promote', 'rollback'].includes(mode)) throw new Refusal('--mode must be promote or rollback');
  const state = collectHostState(opts);
  const verdict = evaluateHostGate(state, { windowMin: opts['window-min'] ? num(opts, 'window-min') : 90, strict: Boolean(opts.strict), mode });
  log(`host gate (${state.source}, ${mode}) at ${new Date(state.nowMs).toISOString()}`);
  for (const fact of verdict.facts) log(`  ${fact}`);
  for (const w of verdict.warnings) log(`  WARNING ${w}`);
  for (const r of verdict.refusals) console.error(`release: REFUSE ${r}`);
  log(verdict.ok ? 'HOST GATE PASS' : 'HOST GATE REFUSED');
  return verdict.ok ? 0 : 1;
}

/**
 * Copy the files a recorded manifest lists from `source` into `dest`, each
 * checked against its recorded hash. Paths are relative to `source`; a
 * leading `./` and sha256sum's binary marker are accepted.
 */
function copyFromManifest(manifestFile, source, dest) {
  const text = readFileSync(manifestFile, 'utf8').replace(/^([0-9a-f]{64}) [ *](?:\.\/)?/gm, '$1  ');
  const entries = parseManifest(text);
  // Manifest paths are relative to the standalone bundle; isServerOutput takes release-relative paths.
  const serverOutput = [];
  for (const { path, sha256 } of entries) {
    const from = join(source, ...path.split('/'));
    const inside = relative(source, from);
    if (inside.startsWith('..') || isAbsolute(inside)) throw new Refusal(`manifest path leaves the bundle: ${path}`);
    const to = join(dest, ...path.split('/'));
    if (!existsSync(from)) {
      // The server may delete and rewrite its own ISR output; a page it lacks regenerates on demand.
      if (isServerOutput(`.next/standalone/${path}`)) { serverOutput.push(path); continue; }
      throw new Refusal(`adopt: ${path} is in the manifest but not in ${source}`);
    }
    mkdirSync(dirname(to), { recursive: true });
    if (sha256File(from) === sha256) {
      copyFileSync(from, to);
      if (sha256File(to) !== sha256) throw new Refusal(`adopt: the copy of ${path} differs from the recorded manifest`);
      continue;
    }
    if (!isServerOutput(`.next/standalone/${path}`)) throw new Refusal(`adopt: ${path} differs from the recorded manifest`);
    // A page the running server regenerated since the build: copy the live version only
    // if it is settled (older than 5 s) and unchanged across the copy, so it is never torn.
    const before = lstatSync(from);
    if (Date.now() - before.mtimeMs < 5000) throw new Refusal(`adopt: ${path} is being rewritten by the server; retry`);
    copyFileSync(from, to);
    const after = lstatSync(from);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || lstatSync(to).size !== before.size) {
      throw new Refusal(`adopt: ${path} changed while it was copied; retry`);
    }
    serverOutput.push(path);
  }
  // prepare-standalone creates the (empty) ISR cache directory, which no file manifest lists.
  mkdirSync(join(dest, '.next', 'cache'), { recursive: true });
  return { files: entries.length, serverOutput };
}

/**
 * One-time registration of the bundle the service serves in place today, so
 * that the first build through this route has a release to roll back to.
 * It copies; the in-place bundle stays where it is and keeps serving. With
 * --from-manifest only the recorded build's files are copied, each checked
 * against its recorded hash, so a page the server is regenerating cannot be
 * caught half-written and the copy is proven to be that build.
 */
async function cmdAdopt(opts) {
  const root = resolve(opts.root);
  const checkout = resolve(required(opts, 'checkout'));
  const revision = required(opts, 'revision');
  const afldbEnv = required(opts, 'afldb-env');
  checkRootOutsideCheckout(root, checkout);
  checkRevision(checkout, revision);
  const source = join(checkout, STANDALONE);
  if (!existsSync(join(source, 'server.js'))) throw new Refusal(`${source}/server.js not found`);
  return withLock(root, 'build', 'adopt', async () => {
    const buildId = readBuildId(source);
    if (opts['expect-build-id'] && opts['expect-build-id'] !== buildId) {
      throw new Refusal(`in-place BUILD_ID is ${buildId}, expected ${opts['expect-build-id']}`);
    }
    const id = releaseId(revision, buildId);
    const candidate = join(newWorkspace(root, `adopt-${revision.slice(0, 12)}`), 'candidate');
    const standalone = join(candidate, STANDALONE);
    mkdirSync(join(candidate, '.next'), { recursive: true });
    mkdirSync(join(candidate, 'deploy'), { recursive: true });
    let copied;
    let adoptedServerOutput = null;
    if (opts['from-manifest']) {
      const result = copyFromManifest(resolve(opts['from-manifest']), source, standalone);
      adoptedServerOutput = result.serverOutput;
      copied = `${result.files} files from ${opts['from-manifest']}`
        + (result.serverOutput.length ? `; ${result.serverOutput.length} regenerated ISR file(s) taken live or left to regenerate` : '');
    } else {
      const cp = runQuiet('cp', ['-a', source, standalone]);
      if (cp.status !== 0) throw new Refusal(`copy failed: ${cp.stderr}`);
      copied = 'the whole in-place tree, including its ISR output';
    }
    // The supervisor of the adopted revision, from Git: the checkout may already be on a newer commit.
    writeFileSync(join(candidate, 'deploy', 'server-cluster.mjs'), gitShow(checkout, revision, 'deploy/server-cluster.mjs'));
    if (readBuildId(standalone) !== buildId) throw new Refusal('adopt: the copied BUILD_ID differs');
    if (!existsSync(join(standalone, 'server.js'))) throw new Refusal('adopt: server.js was not copied');
    await checkNoEnvFiles(candidate);
    checkLinks(candidate);
    checkTransportFlag(standalone, afldbEnv);
    const record = writeReleaseRecord(candidate, {
      schema: 'afldb-release/1',
      id,
      revision,
      buildId,
      afldbEnv,
      createdBy: 'adopt',
      migrationHead: gitMigrationHead(checkout, revision),
      createdAt: new Date().toISOString(),
      host: hostname(),
      adoptedFrom: source,
      adoptedCopy: copied,
      adoptedManifestSha256: opts['from-manifest'] ? sha256File(resolve(opts['from-manifest'])) : null,
      adoptedServerOutput,
    });
    return withLock(root, 'links', 'adopt', () => {
      publish(root, candidate, id);
      const current = readReleaseLink(root, 'current');
      if (!current) switchLink(root, 'current', `releases/${id}`);
      event(root, 'adopt', { id, revision, buildId, manifest: record.manifest.sha256, setCurrent: !current, copied });
      log(`ADOPTED ${id} (${record.manifest.files} files; ${copied})${current ? `; current stays ${current}` : '; current set'}`);
      return 0;
    });
  });
}

// ------------------------------------------------------------------ CLI

function required(opts, name) {
  if (!opts[name]) throw new Refusal(`--${name} is required`);
  return opts[name];
}

function num(opts, name) {
  const value = Number(opts[name]);
  if (!Number.isFinite(value) || value <= 0) throw new Refusal(`--${name} must be a positive number`);
  return value;
}

/** @returns {{ command: string | undefined, args: string[], opts: Record<string, any> }} */
export function parseArgs(argv) {
  /** @type {Record<string, any>} */
  const opts = {
    root: DEFAULT_ROOT,
    'heap-mb': DEFAULTS.heapMb,
    'build-workers': DEFAULTS.buildWorkers,
    'min-available-mb': DEFAULTS.minAvailableMb,
    'require-free-gb': DEFAULTS.requireFreeGb,
    'smoke-port': DEFAULTS.smokePort,
    typecheck: DEFAULTS.typecheck,
    url: DEFAULTS.url,
    unit: DEFAULTS.unit,
    'pg-unit': DEFAULTS.pgUnit,
  };
  const positional = [];
  const flags = new Set(['no-live', 'allow-node-mismatch', 'attended', 'strict', 'confirm-attended-restart']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const name = arg.slice(2);
    if (flags.has(name)) { opts[name] = true; continue; }
    if (i + 1 >= argv.length) throw new Refusal(`${arg} needs a value`);
    opts[name] = argv[++i];
  }
  return { command: positional[0], args: positional.slice(1), opts };
}

export async function main(argv) {
  const { command, args, opts } = parseArgs(argv);
  if (process.platform !== 'linux') throw new Refusal('the release route runs on the Linux host only');
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => onSignal(signal));
  // A dropped SSH session turns writes to the terminal into EIO; keep cleaning up regardless.
  process.stdout.on('error', () => {});
  process.stderr.on('error', () => {});
  switch (command) {
    case 'build': return cmdBuild(opts);
    case 'verify': return cmdVerify(opts, args[0]);
    case 'promote': return cmdPromote(opts, args[0]);
    case 'rollback': return cmdRollback(opts);
    case 'status': return cmdStatus(opts);
    case 'adopt': return cmdAdopt(opts);
    case 'host-gate': return cmdHostGate(opts);
    case 'check-node-modules': return cmdCheckNodeModules(opts);
    default:
      console.error('usage: node deploy/release.mjs build|verify|promote|rollback|status|adopt|host-gate|check-node-modules [options]; see the file header');
      return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error) => {
      console.error(`release: ${error instanceof Refusal ? 'REFUSED' : 'ERROR'}: ${error.message}`);
      if (!(error instanceof Refusal)) console.error(error.stack);
      process.exitCode = active.interrupted ? 130 : 1;
    },
  );
}

export { Refusal };
