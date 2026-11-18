/**
 * AFLDB-ISSUE-366 §1: interrupted-commit recovery (successor of the packet 6R R1 `probe` branch and its §4.2 table).
 * Read-only. Decides whether a P6 attempt that did not end in a clean `P6 RESULT COMMITTED EXACT` committed, did not commit,
 * or must stop the sitting. It never retries P6 and never writes to the database.
 *
 *   recover.mts --dsn-env <VAR> --expect-db <db> --expect-oid <oid> --expect-sysid <sysid> --expect-ids-md5 <32 hex> \
 *               --recover-attempt <STAMP>-commit-<n> --record-dir <dir> --baseline <file> --baseline-sha256 <64 hex>
 *
 * Order (lib.ts decideRecovery): process check (attempt token in argv; the recording block's pid and start time), database
 * liveness in its own transaction (backends carrying the attempt's application_name; the repair advisory lock), only then a
 * fresh REPEATABLE READ READ ONLY snapshot, then both checks again. A process listing, a missing OUTCOME line or an MVCC
 * snapshot alone never establishes that the attempt is terminal.
 *
 * Last line: `R1 DECISION COMMITTED|NOT-COMMITTED|STOP: <reason>`. Exit 0 COMMITTED (continue to S3 as committed),
 * 10 NOT-COMMITTED (B1a abandoned for the sitting; S3 may proceed), 3 STOP (no S3), 2 usage.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';

import { captureLines, pinOutputSettings, readIdentity, readLiveness, redact } from './db';
import {
  RECOVERY_EXIT, bindBaseline, classifyState, decideRecovery, parseAttempt, parseAttemptRecord, type AttemptRecord,
  type ProcessCheck, type StateClass,
} from './lib';

const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const say = (label: string, value: unknown) => console.log(label, typeof value === 'string' ? value : JSON.stringify(value));
const decide = (verdict: keyof typeof RECOVERY_EXIT, reason: string): never => {
  console.log(`R1 DECISION ${verdict}: ${reason}`);
  process.exit(RECOVERY_EXIT[verdict]);
};

const attempt = parseAttempt(arg('recover-attempt'));
const dsnEnv = arg('dsn-env'); const db = arg('expect-db'); const oid = arg('expect-oid'); const sysid = arg('expect-sysid');
const ids = arg('expect-ids-md5'); const recordDir = arg('record-dir'); const baselinePath = arg('baseline');
if (!attempt || attempt.mode !== 'commit' || !dsnEnv || !db || !/^\d+$/.test(oid ?? '') || !/^\d+$/.test(sysid ?? '')
    || !/^[0-9a-f]{32}$/.test(ids ?? '') || !recordDir || !baselinePath) {
  decide('USAGE', 'required: --dsn-env --expect-db --expect-oid --expect-sysid --expect-ids-md5 --recover-attempt <STAMP>-commit-<n> --record-dir --baseline --baseline-sha256');
}
const readOpt = (p: string): string | null => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
let baselineBytes: Buffer | null = null;
try { baselineBytes = readFileSync(baselinePath!); } catch { /* reported below */ }
if (!baselineBytes) decide('STOP', `baseline ${baselinePath} unreadable`);
const bound = bindBaseline(baselineBytes!, { sha256: arg('baseline-sha256') ?? '', sitting: attempt!.sitting, db: db!, oid: oid!, sysid: sysid!, idsMd5: ids! });
if (!bound.baseline) decide('STOP', `baseline evidence: ${bound.problems.join('; ')}`);
const dsn = process.env[dsnEnv!];
if (!dsn) decide('STOP', `${dsnEnv} is not set: probe cannot run`);

const record: AttemptRecord = parseAttemptRecord(readOpt(join(recordDir!, 'p6-attempt.txt')), readOpt(join(recordDir!, 'commit.txt')));
say('RECORD', record);

/** Linux process start time (clock ticks since boot, field 22 of /proc/<pid>/stat), or null when no such process. */
function procStart(pid: number): string | null {
  const stat = readOpt(`/proc/${pid}/stat`);
  if (stat === null) return null;
  return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? '?';
}

function processCheck(): ProcessCheck {
  if (process.platform !== 'linux') return { kind: 'error', detail: 'process checks need Linux /proc and pgrep' };
  const p = spawnSync('pgrep', ['-f', '--', `(^| )--attempt ${attempt!.id}( |$)`], { encoding: 'utf8' });
  if (p.error) return { kind: 'error', detail: `pgrep failed: ${p.error.message}` };
  if (p.status === 0) {
    const pids = p.stdout.split(/\s+/).filter((x) => x && Number(x) !== process.pid);
    if (pids.length) return { kind: 'live', detail: `runner process(es) ${pids.join(',')} carry --attempt ${attempt!.id}` };
  } else if (p.status !== 1) return { kind: 'error', detail: `pgrep exit ${p.status}: ${p.stderr.trim()}` };
  if (record.wrapper) {
    const now = procStart(record.wrapper.pid);
    if (now !== null && now === record.wrapper.start) {
      return { kind: 'live', detail: `the P6 block (pid ${record.wrapper.pid}) is still running: it may not have launched the runner yet` };
    }
  }
  if (record.started && record.exitCode === null && record.runnerPid === null && !record.launchAttempt && !record.wrapper) {
    return { kind: 'error', detail: 'the attempt was started but neither the block nor the runner left an identifiable process record' };
  }
  return { kind: 'none' };
}

const sql = postgres(dsn!, { max: 1, onnotice: () => {}, connection: { application_name: `afldb-b1a-recover ${attempt!.sitting}` } });
let decision;
try {
  const processBefore = processCheck(); say('PROCESS-BEFORE', processBefore);
  const dbBefore = await readLiveness(sql, attempt!.id); say('DB-BEFORE', dbBefore);
  let probe: { ok: boolean; error?: string; state?: StateClass } = { ok: false, error: 'not run: the attempt was not shown terminal' };
  let processAfter: ProcessCheck | null = null;
  let dbAfter = null;
  if (processBefore.kind === 'none' && dbBefore.ok && dbBefore.sameAttempt === 0 && dbBefore.otherAttempts.length === 0 && dbBefore.lockFree) {
    try {
      // A fresh snapshot, begun only after the liveness transaction above has ended.
      const lines = await sql.begin('isolation level repeatable read read only', async (tx) => {
        await pinOutputSettings(tx);
        const id = await readIdentity(tx);
        if (id.db !== db || id.oid !== oid || id.sysid !== sysid || id.ro !== 'on' || id.schema !== bound.baseline!.schema) {
          throw new Error(`identity/read-only mismatch: ${JSON.stringify(id)}`);
        }
        return captureLines(tx, attempt!.sitting);
      });
      for (const l of lines) console.log(`  ${l}`);
      probe = { ok: true, state: classifyState(bound.baseline!.lines, lines) };
    } catch (e) {
      probe = { ok: false, error: redact((e as Error).message) };
    }
    say('PROBE', probe);
    processAfter = processCheck(); say('PROCESS-AFTER', processAfter);
    dbAfter = await readLiveness(sql, attempt!.id); say('DB-AFTER', dbAfter);
  }
  decision = decideRecovery({ attempt: attempt!.id, record, processBefore, processAfter, dbBefore, dbAfter, probe });
} finally {
  await sql.end({ timeout: 5 });
}
decide(decision.verdict, decision.reason);
