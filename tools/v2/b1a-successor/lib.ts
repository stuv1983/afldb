/**
 * AFLDB-ISSUE-366: the successor to the packet 6R B1a procedure (the 2026 Brownlow player-season status repair).
 *
 * Pure logic shared by the four database tools in this directory (capture, repair, recover, reverse) and by their tests:
 * attempt identity, the v2 capture format, baseline binding, state classification, the runner's outcome record and the
 * interrupted-commit recovery decision. No I/O, no database.
 *
 * The packet 6R artifacts under docs/v2/evidence/remediation-20261114/run6r/ are historical evidence and are not changed.
 * See tools/v2/b1a-successor/README.md for the procedure these tools serve.
 */
import { createHash } from 'node:crypto';

export const SEASON = 2026;
export const EXPECTED_ROWS = 669;
export const COVERAGE_KEYS = ['brownlow_match_votes', 'brownlow_round_votes', 'brownlow_season_total'] as const;
/** Fixed lock order: every table the repair reads or writes, the written table last (unchanged from packet 6R). */
export const LOCKED_TABLES = ['seasons', 'stat_availability', 'brownlow_season_votes', 'brownlow_season_authority',
  'brownlow_vote_entry_state', 'brownlow_round_votes', 'player_season_stats'] as const;
/** Transaction-level advisory lock every repair and reversal transaction holds, and recovery must be able to take. */
export const REPAIR_LOCK = [365, 2026] as const;
export const CAPTURE_FORMAT = 'afldb.b1a-successor.capture.v2';
export const APP_NAME_PREFIX = 'afldb-b1a ';
export const REVERSE_APP_NAME_PREFIX = 'afldb-b1a-reverse ';

/** Every line a v2 capture carries, in order. `pss2026` may repeat (one line per status). */
export const CAPTURE_LABELS = [
  'format', 'sitting', 'identity', 'schema', 'pss2026', 'ids2026', 'cov2026', 'inputs2026',
  'fp_pss_other(H1)', 'fp_pss2026_nonstatus(H2)', 'fp_stat_availability(H3)', 'na_cov', 'na_pss',
  'fp_season2026', 'fp_medal2026', 'fp_authority2026', 'fp_entry2026', 'fp_round2026',
] as const;
/** Row-content fingerprints the packet 6R capture lacked (ISSUE-366 §3). A baseline without them cannot qualify a reversal. */
export const CONTENT_FINGERPRINTS = ['fp_season2026', 'fp_medal2026', 'fp_authority2026', 'fp_entry2026', 'fp_round2026'] as const;

const STAMP = /^[0-9]{8}T[0-9]{6}Z$/;
const ATTEMPT = /^([0-9]{8}T[0-9]{6}Z)-(dry|commit)-([1-9])$/;

export interface Attempt { readonly id: string; readonly sitting: string; readonly mode: 'dry' | 'commit'; readonly n: number }

/** `<STAMP>-dry-<n>` or `<STAMP>-commit-<n>`: the sitting and the attempt within it. */
export function parseAttempt(id: string | undefined): Attempt | null {
  const m = ATTEMPT.exec(id ?? '');
  return m ? { id: id!, sitting: m[1], mode: m[2] as 'dry' | 'commit', n: Number(m[3]) } : null;
}
export const isStamp = (s: string | undefined): s is string => STAMP.test(s ?? '');
export const applicationName = (attempt: string) => `${APP_NAME_PREFIX}${attempt}`;

export const sha256Hex = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
export const md5Hex = (s: string) => createHash('md5').update(s).digest('hex');

/* ------------------------------------------------------------------ capture lines ------------------------------------------------------------------ */

export type CaptureLines = readonly string[];
export const labelOf = (line: string) => line.split('|', 1)[0];
export const fieldsOf = (line: string) => line.split('|').slice(1);

export interface Baseline {
  readonly lines: CaptureLines;
  readonly sitting: string;
  readonly identity: { db: string; oid: string; sysid: string };
  readonly schema: string;
  readonly ids: { n: number; md5: string };
}

/**
 * Parses a v2 capture and refuses anything malformed, incomplete or historical. A packet 6R capture (no `format` line, no
 * content fingerprints) is refused by name: it cannot qualify a successor runner or reversal.
 */
export function parseCapture(text: string): { baseline: Baseline | null; problems: string[] } {
  const problems: string[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l !== '');
  const byLabel = new Map<string, string[]>();
  for (const l of lines) {
    const label = labelOf(l);
    if (!(CAPTURE_LABELS as readonly string[]).includes(label)) problems.push(`unknown line label "${label}"`);
    byLabel.set(label, [...(byLabel.get(label) ?? []), l]);
  }
  const one = (label: string) => {
    const v = byLabel.get(label) ?? [];
    if (v.length !== 1) { problems.push(`${label}: expected exactly one line, found ${v.length}`); return null; }
    return fieldsOf(v[0]);
  };
  const format = one('format');
  if (!byLabel.has('format') || !lines.length || labelOf(lines[0]) !== 'format') {
    problems.push('not a successor (v2) capture: no leading format line (a packet 6R capture cannot qualify a successor tool)');
  } else if (format && format[0] !== CAPTURE_FORMAT) problems.push(`format ${format[0]}, expected ${CAPTURE_FORMAT}`);
  for (const k of CONTENT_FINGERPRINTS) {
    if (!byLabel.has(k)) problems.push(`${k} missing: the capture lacks the ISSUE-366 row-content evidence`);
  }
  const sitting = one('sitting');
  const identity = one('identity');
  const schema = one('schema');
  const ids = one('ids2026');
  if ((byLabel.get('pss2026') ?? []).length < 1) problems.push('pss2026: no line');
  if ((byLabel.get('cov2026') ?? []).length !== COVERAGE_KEYS.length) problems.push(`cov2026: expected ${COVERAGE_KEYS.length} lines`);
  for (const k of ['inputs2026', 'fp_pss_other(H1)', 'fp_pss2026_nonstatus(H2)', 'fp_stat_availability(H3)', 'na_cov', 'na_pss',
    ...CONTENT_FINGERPRINTS.filter((x) => byLabel.has(x))]) one(k);
  if (sitting && !isStamp(sitting[0])) problems.push(`sitting ${sitting[0]} is not a UTC stamp`);
  if (identity && (identity.length !== 3 || !/^\d+$/.test(identity[1]) || !/^\d+$/.test(identity[2]))) problems.push('identity line malformed');
  if (ids && (ids.length !== 2 || !/^\d+$/.test(ids[0]) || !/^[0-9a-f]{32}$/.test(ids[1]))) problems.push('ids2026 line malformed');
  const md5Field = (label: string, idx: number) => {
    const v = byLabel.get(label);
    if (v?.length === 1 && !/^[0-9a-f]{32}$/.test(fieldsOf(v[0])[idx] ?? '')) problems.push(`${label}: hash malformed or NULL`);
  };
  md5Field('fp_pss_other(H1)', 0); md5Field('fp_pss2026_nonstatus(H2)', 0); md5Field('fp_stat_availability(H3)', 1);
  for (const k of CONTENT_FINGERPRINTS) {
    const v = byLabel.get(k);
    if (v?.length === 1 && !/^\d+\|([0-9a-f]{32}|-)$/.test(v[0].slice(k.length + 1))) problems.push(`${k}: expected <count>|<md5 or ->`);
  }
  if (problems.length || !sitting || !identity || !schema || !ids) return { baseline: null, problems };
  return {
    baseline: {
      lines, sitting: sitting[0], identity: { db: identity[0], oid: identity[1], sysid: identity[2] }, schema: schema[0],
      ids: { n: Number(ids[0]), md5: ids[1] },
    },
    problems,
  };
}

/** Loads a baseline whose bytes must hash to the approved value, for one sitting and one database identity. */
export function bindBaseline(bytes: Buffer, want: { sha256: string; sitting: string; db: string; oid: string; sysid: string; idsMd5: string }) {
  const problems: string[] = [];
  if (!/^[0-9a-f]{64}$/.test(want.sha256)) problems.push('--baseline-sha256 must be 64 lowercase hex');
  else if (sha256Hex(bytes) !== want.sha256) problems.push(`baseline sha256 ${sha256Hex(bytes)} differs from the verified ${want.sha256}`);
  const { baseline, problems: p } = parseCapture(bytes.toString('utf8'));
  problems.push(...p);
  if (baseline) {
    if (baseline.sitting !== want.sitting) problems.push(`baseline is for sitting ${baseline.sitting}, not ${want.sitting}`);
    const i = baseline.identity;
    if (i.db !== want.db || i.oid !== want.oid || i.sysid !== want.sysid) problems.push(`baseline identity ${i.db}/${i.oid}/${i.sysid} differs from the expected database`);
    if (baseline.ids.md5 !== want.idsMd5 || baseline.ids.n !== EXPECTED_ROWS) problems.push(`baseline ids2026 ${baseline.ids.n}/${baseline.ids.md5} differs from ${EXPECTED_ROWS}/--expect-ids-md5`);
    const pss = baseline.lines.filter((l) => labelOf(l) === 'pss2026');
    if (pss.length !== 1 || pss[0] !== `pss2026|not_applicable|${EXPECTED_ROWS}|0`) problems.push(`baseline starting status is [${pss.join(', ')}], expected pss2026|not_applicable|${EXPECTED_ROWS}|0`);
  }
  return { baseline: problems.length ? null : baseline, problems };
}

/** The capture the exact repair produces from `baseline`: only pss2026 and na_pss change (packet 6R §5.3). */
export function repairedImage(baseline: CaptureLines): string[] {
  return baseline.map((l) => {
    if (l === `pss2026|not_applicable|${EXPECTED_ROWS}|0`) return `pss2026|pending|${EXPECTED_ROWS}|0`;
    const m = /^na_pss\|(\d+)\|(\d+)$/.exec(l);
    if (m) return `na_pss|${Number(m[1]) - EXPECTED_ROWS}|${m[2]}`;
    return l;
  });
}

/** Line-by-line difference, order-insensitive (a capture's lines are unique within a label group). */
export function diffLines(want: CaptureLines, got: CaptureLines): { missing: string[]; unexpected: string[] } {
  const w = new Set(want); const g = new Set(got);
  return { missing: want.filter((l) => !g.has(l)), unexpected: got.filter((l) => !w.has(l)) };
}
export const sameCapture = (a: CaptureLines, b: CaptureLines) => {
  const d = diffLines(a, b);
  return d.missing.length === 0 && d.unexpected.length === 0 && a.length === b.length;
};
export const describeDiff = (d: { missing: string[]; unexpected: string[] }) =>
  `expected [${d.missing.join('; ')}] found [${d.unexpected.join('; ')}]`;

export type StateClass = { kind: 'original' } | { kind: 'repaired' } | { kind: 'other'; detail: string };

/** Is `now` exactly the pinned original, exactly the repaired image of it, or anything else? */
export function classifyState(baseline: CaptureLines, now: CaptureLines): StateClass {
  if (sameCapture(baseline, now)) return { kind: 'original' };
  const repaired = repairedImage(baseline);
  if (sameCapture(repaired, now)) return { kind: 'repaired' };
  const vsOriginal = diffLines(baseline, now);
  return { kind: 'other', detail: `neither the pinned original nor the exact repaired state; against the original ${describeDiff(vsOriginal)}` };
}

/* ------------------------------------------------------------------ runner record ------------------------------------------------------------------ */

/** Runner exit codes (unchanged from packet 6R). */
export const OUTCOME_CODE: Readonly<Record<string, number>> = {
  COMMITTED: 0, 'DRY-RUN-PASS': 0, REFUSED: 1, ERROR: 2, 'ALREADY-APPLIED': 3, 'COMMIT-UNKNOWN': 4,
};
export const outcomeKind = (line: string) => {
  const rest = line.replace(/^OUTCOME /, '');
  return Object.keys(OUTCOME_CODE).find((k) => rest === k || rest.startsWith(`${k} `)) ?? null;
};

export interface AttemptRecord {
  /** The P6 block wrote its ATTEMPT-START line (it intended to launch the runner). */
  readonly started: boolean;
  readonly startedAttempt: string | null;
  /** The P6 block's own process, so a block that has not launched the runner yet is still seen as live. */
  readonly wrapper: { pid: number; start: string } | null;
  readonly runnerPid: number | null;
  /** RUNNER-EXIT written by the block after `wait` (absent when the caller was lost). */
  readonly exitCode: number | null;
  /** From the runner's own output. */
  readonly launchAttempt: string | null;
  readonly outcomes: readonly string[];
}

/** Reads `p6-attempt.txt` (block lifecycle) and `commit.txt` (runner output). Either may be absent or partial. */
export function parseAttemptRecord(blockText: string | null, runnerText: string | null): AttemptRecord {
  const b = (blockText ?? '').replace(/\r\n/g, '\n').split('\n');
  const r = (runnerText ?? '').replace(/\r\n/g, '\n').split('\n');
  const start = b.map((l) => /^ATTEMPT-START (\S+) wrapper_pid=(\d+) wrapper_start=(\d+)/.exec(l)).find(Boolean);
  const pid = b.map((l) => /^RUNNER-PID (\d+)$/.exec(l)).find(Boolean);
  const exit = b.map((l) => /^RUNNER-EXIT (\d+)$/.exec(l)).find(Boolean);
  const launch = r.map((l) => /^LAUNCH (\{.*\})$/.exec(l)).find(Boolean);
  let launchAttempt: string | null = null;
  if (launch) { try { launchAttempt = String(JSON.parse(launch[1]).attempt ?? ''); } catch { launchAttempt = '<unparseable>'; } }
  return {
    started: Boolean(start), startedAttempt: start?.[1] ?? null,
    wrapper: start ? { pid: Number(start[2]), start: start[3] } : null,
    runnerPid: pid ? Number(pid[1]) : null, exitCode: exit ? Number(exit[1]) : null,
    launchAttempt, outcomes: r.filter((l) => l.startsWith('OUTCOME ')),
  };
}

/* ------------------------------------------------------------------ recovery decision ------------------------------------------------------------------ */

export type ProcessCheck = { kind: 'none' } | { kind: 'live'; detail: string } | { kind: 'error'; detail: string };
export interface DbLiveness {
  readonly ok: boolean;
  readonly error?: string;
  /** Backends whose application_name names this attempt. */
  readonly sameAttempt: number;
  /** Backends of any other B1a attempt or reversal. */
  readonly otherAttempts: readonly string[];
  /** pg_try_advisory_xact_lock(REPAIR_LOCK) succeeded. */
  readonly lockFree: boolean;
}
export type RecoveryDecision =
  | { verdict: 'COMMITTED'; reason: string }
  | { verdict: 'NOT-COMMITTED'; reason: string }
  | { verdict: 'STOP'; reason: string };

/**
 * Packet 6R §4.2, made safe against a still-running attempt (ISSUE-366 §1). Advancement needs ALL of:
 *   the runner process and the block that launches it are gone (by attempt token and recorded pid), before and after the snapshot;
 *   no database backend of this attempt and the repair advisory lock free, before and after the snapshot;
 *   a successful read-only probe taken after both were established;
 *   records that agree with each other and with the observed state, which is exactly the pinned original or the exact repaired state.
 * Anything uncertain, contradictory, mixed or ALREADY-APPLIED stops the sitting. Recovery never retries P6.
 */
export function decideRecovery(input: {
  attempt: string;
  record: AttemptRecord;
  processBefore: ProcessCheck; processAfter: ProcessCheck | null;
  dbBefore: DbLiveness; dbAfter: DbLiveness | null;
  probe: { ok: boolean; error?: string; state?: StateClass };
}): RecoveryDecision {
  const { attempt, record } = input;
  const stop = (reason: string): RecoveryDecision => ({ verdict: 'STOP', reason });
  // Checked in the order they ran (process, database, before then after), so the reason names the first failure, not a later
  // check that recover.mts skipped because of it.
  const checks = [['before', input.processBefore, input.dbBefore], ['after', input.processAfter, input.dbAfter]] as const;
  for (const [when, p, d] of checks) {
    if (!p) return stop(`process check ${when} the snapshot did not run`);
    if (p.kind === 'live') return stop(`attempt ${attempt} is not terminal (${when} the snapshot): ${p.detail}`);
    if (p.kind === 'error') return stop(`process lifecycle uncertain (${when} the snapshot): ${p.detail}`);
    if (!d) return stop(`database liveness check ${when} the snapshot did not run`);
    if (!d.ok) return stop(`database liveness check ${when} the snapshot failed: ${d.error ?? 'unknown error'}`);
    if (d.sameAttempt > 0) return stop(`attempt ${attempt} still has ${d.sameAttempt} database backend(s) (${when} the snapshot): its transaction is not terminal`);
    if (d.otherAttempts.length) return stop(`another B1a session is connected (${d.otherAttempts.join(', ')}): wrong or unknown attempt identity`);
    if (!d.lockFree) return stop(`the repair advisory lock is held (${when} the snapshot): a repair or reversal transaction is live`);
  }
  if (!input.probe.ok || !input.probe.state) return stop(`acceptance probe failed: ${input.probe.error ?? 'no state'}`);
  if (record.startedAttempt && record.startedAttempt !== attempt) return stop(`the block record names attempt ${record.startedAttempt}, not ${attempt}`);
  if (record.launchAttempt && record.launchAttempt !== attempt) return stop(`the runner record names attempt ${record.launchAttempt}, not ${attempt}`);
  if (record.outcomes.length > 1) return stop(`the runner record has ${record.outcomes.length} OUTCOME lines`);
  const kind = record.outcomes.length ? outcomeKind(record.outcomes[0]) : null;
  if (record.outcomes.length && !kind) return stop(`unrecognised outcome "${record.outcomes[0]}"`);
  if (kind && record.exitCode !== null && OUTCOME_CODE[kind] !== record.exitCode) {
    return stop(`contradictory record: OUTCOME ${kind} with runner exit ${record.exitCode}`);
  }
  if (kind === 'ALREADY-APPLIED') return stop('the runner found the rows already repaired before this attempt: nothing in this sitting should have repaired them');
  if (kind === 'DRY-RUN-PASS') return stop('a dry-run outcome in the commit record: wrong attempt or wrong mode');
  const state = input.probe.state;
  if (state.kind === 'other') return stop(`mixed or unexpected state: ${state.detail}`);
  const committed = state.kind === 'repaired';
  if (!record.started && !record.launchAttempt && !kind) {
    return committed ? stop('no record of a commit attempt, yet the rows are repaired: something else changed 2026')
      : { verdict: 'NOT-COMMITTED', reason: 'no commit attempt was launched; the pinned original state holds' };
  }
  if (kind === 'COMMITTED') {
    return committed ? { verdict: 'COMMITTED', reason: 'OUTCOME COMMITTED and the exact repaired state' }
      : stop('contradictory: OUTCOME COMMITTED but the pinned original state');
  }
  if (kind === 'REFUSED' || kind === 'ERROR') {
    return committed ? stop(`contradictory: OUTCOME ${kind} but the exact repaired state`)
      : { verdict: 'NOT-COMMITTED', reason: `OUTCOME ${kind}, terminal, and the pinned original state` };
  }
  const why = kind === 'COMMIT-UNKNOWN' ? 'COMMIT-UNKNOWN' : `no OUTCOME line (runner exit ${record.exitCode ?? 'unrecorded'})`;
  return committed ? { verdict: 'COMMITTED', reason: `${why}; terminal; the exact repaired state` }
    : { verdict: 'NOT-COMMITTED', reason: `${why}; terminal; the pinned original state` };
}

/** Exit codes of recover.mts: advancement is 0 or 10, everything else stops. */
export const RECOVERY_EXIT = { COMMITTED: 0, 'NOT-COMMITTED': 10, STOP: 3, USAGE: 2 } as const;
