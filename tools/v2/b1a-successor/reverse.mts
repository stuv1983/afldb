/**
 * AFLDB-ISSUE-366 §3: the guarded B1a reversal (successor of run6r/b1a/b1a-reverse-r6r.sql, which stays as historical evidence).
 * Puts the 669 repaired rows back to 'not_applicable'. It re-introduces the ISSUE-365 defect, so it is only for a fault caused
 * by the repaired rows themselves, and every commit needs its own, separate owner approval (packet 6R §4.3). A failed release
 * never triggers it; a whole-database restore is a different, separately approved operation.
 *
 *   reverse.mts --dsn-env AFLDB_IMPORT_DATABASE_URL --expect-db <db> --expect-oid <oid> --expect-sysid <sysid> \
 *               --expect-ids-md5 <32 hex> --sitting <STAMP> --baseline <file> --baseline-sha256 <64 hex> \
 *               [--commit --approval-ref <owner approval reference>]
 * Without --commit it always rolls back (dry run), after performing and verifying the reversal inside the transaction.
 *
 * Guards, under the packet 6R locks (same tables, order and mode) and the repair advisory lock, BEFORE the UPDATE: the whole
 * v2 capture must equal the exact repaired image of the approved BEFORE capture. That keeps the packet 6R guards (identity,
 * the 669 ids all 'pending' with NULL votes, no medal or published authority, coverage, inputs2026, H1, H2, H3) and adds
 * row-content fingerprints of the 2026 round votes (identities and values), the entry-workflow decision rows, the season
 * authority, the medal rows and the season row, so a same-count or same-status-total edit is refused. A capture without
 * that evidence (any packet 6R capture) cannot qualify. After the UPDATE the recapture must equal the BEFORE capture exactly.
 *
 * OUTCOME and exit: 0 REVERSE DRY-RUN-PASS (rolled back) | REVERSE COMMITTED; 1 REFUSED; 2 ERROR; 4 COMMIT-UNKNOWN.
 */
import { readFileSync } from 'node:fs';

import postgres from 'postgres';

import { captureLines, lockStatement, pinOutputSettings, readIdentity, redact, tryRepairLock } from './db';
import {
  EXPECTED_ROWS, REVERSE_APP_NAME_PREFIX, SEASON, bindBaseline, describeDiff, diffLines, isStamp, repairedImage, sameCapture,
} from './lib';

const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const commit = args.includes('--commit');
let outcome = 'NOT-RUN'; let code = 1;
const finish = () => { console.log('OUTCOME', outcome); process.exitCode = code; };
const refuseEarly = (why: string): never => { outcome = `REFUSED ${why}`; code = 1; finish(); process.exit(); };

const valued = ['--dsn-env', '--expect-db', '--expect-oid', '--expect-sysid', '--expect-ids-md5', '--sitting', '--baseline', '--baseline-sha256', '--approval-ref'];
const unknown = args.filter((a, i) => a.startsWith('--') && a !== '--commit' && !valued.includes(a) && !valued.includes(args[i - 1]));
const dsnEnv = arg('dsn-env'); const db = arg('expect-db'); const oid = arg('expect-oid'); const sysid = arg('expect-sysid');
const ids = arg('expect-ids-md5'); const sitting = arg('sitting'); const approval = arg('approval-ref');
if (unknown.length || !dsnEnv || !db || !/^\d+$/.test(oid ?? '') || !/^\d+$/.test(sysid ?? '') || !/^[0-9a-f]{32}$/.test(ids ?? '')
    || !isStamp(sitting) || !arg('baseline')) {
  refuseEarly(`usage: --dsn-env --expect-db --expect-oid --expect-sysid --expect-ids-md5 --sitting --baseline --baseline-sha256 are required${unknown.length ? `; unknown ${unknown.join(' ')}` : ''}`);
}
if (commit && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{7,119}$/.test(approval ?? '')) {
  refuseEarly('--commit needs --approval-ref naming the owner\'s separate reversal approval (a release failure is never one)');
}
let bytes: Buffer | null = null;
try { bytes = readFileSync(arg('baseline')!); } catch (e) { refuseEarly(`baseline unreadable: ${(e as Error).message}`); }
const bound = bindBaseline(bytes!, { sha256: arg('baseline-sha256') ?? '', sitting: sitting!, db: db!, oid: oid!, sysid: sysid!, idsMd5: ids! });
if (!bound.baseline) refuseEarly(`baseline evidence: ${bound.problems.join('; ')}`);
const baseline = bound.baseline!;
const dsn = process.env[dsnEnv!];
if (!dsn) refuseEarly(`${dsnEnv} is not set`);
console.log('REVERSE', JSON.stringify({ sitting, mode: commit ? 'commit' : 'dry-run', approvalRef: commit ? approval : null }));

class Refuse extends Error {}
class DryRun extends Error {}
const sql = postgres(dsn!, { max: 1, onnotice: () => {}, connection: { application_name: `${REVERSE_APP_NAME_PREFIX}${sitting}` } });
let commitStage = false;
try {
  await sql.begin(async (tx) => {
    await tx`SET LOCAL lock_timeout = '5s'`;
    await tx`SET LOCAL statement_timeout = '60s'`;
    await tx`SET LOCAL idle_in_transaction_session_timeout = '60s'`;
    await pinOutputSettings(tx);
    const id = await readIdentity(tx);
    if (id.db !== db || id.oid !== oid || id.sysid !== sysid || id.ro !== 'off' || id.iso !== 'read committed' || id.schema !== baseline.schema) {
      throw new Refuse(`identity or session mismatch: ${JSON.stringify(id)}`);
    }
    if (!(await tryRepairLock(tx))) throw new Refuse('another B1a repair or reversal transaction holds the repair lock');
    await tx.unsafe(lockStatement);
    await tx`SELECT player_id FROM player_season_stats WHERE season = ${SEASON} ORDER BY player_id FOR UPDATE`;
    const now = await captureLines(tx, sitting!);
    const want = repairedImage(baseline.lines);
    if (!sameCapture(want, now)) throw new Refuse(`the state is not exactly the repaired image of the approved BEFORE capture: ${describeDiff(diffLines(want, now))}`);
    console.log('GUARD PASS', JSON.stringify({ lines: now.length }));
    const changed = await tx<{ player_id: number }[]>`
      UPDATE player_season_stats SET brownlow_status = 'not_applicable'
       WHERE season = ${SEASON} AND brownlow_status = 'pending' AND brownlow_votes IS NULL RETURNING player_id`;
    if (changed.length !== EXPECTED_ROWS) throw new Refuse(`REVERSE ABORTED: updated ${changed.length} rows, expected ${EXPECTED_ROWS}`);
    const after = await captureLines(tx, sitting!);
    if (!sameCapture(baseline.lines, after)) throw new Refuse(`REVERSE ABORTED: the post-state is not the BEFORE capture: ${describeDiff(diffLines(baseline.lines, after))}`);
    if (!commit) throw new DryRun();
    commitStage = true;
  });
  outcome = `REVERSE COMMITTED: ${EXPECTED_ROWS} rows back to not_applicable (approval ${approval})`; code = 0;
} catch (e) {
  if (e instanceof DryRun) { outcome = 'REVERSE DRY-RUN-PASS (rolled back)'; code = 0; }
  else if (e instanceof Refuse) { outcome = `REFUSED ${e.message}`; code = 1; }
  else if (commitStage) { outcome = `COMMIT-UNKNOWN ${redact((e as Error).message)}`; code = 4; }
  else { outcome = `ERROR ${redact((e as Error).message)}`; code = 2; }
} finally {
  await sql.end({ timeout: 5 });
}
finish();
