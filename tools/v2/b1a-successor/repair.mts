/**
 * AFLDB-ISSUE-366: successor of the packet 6R B1a runner (docs/v2/evidence/remediation-20261114/run6r/b1a/b1a-repair-2026-r6r.mts,
 * which stays as historical evidence). The 2026 Brownlow player-season status repair as ONE exact, locked transaction.
 * Not approved for any database by this file: each use needs its own owner approval (README.md in this directory).
 *
 * Scope is unchanged and fixed in code: season 2026; exactly 669 player_season_stats rows, all 'not_applicable' with NULL
 * brownlow_votes, whose ordered player_id set hashes to --expect-ids-md5. It writes ONLY their brownlow_status, to 'pending'.
 *
 * What the successor adds:
 *   --attempt <STAMP>-<dry|commit>-<n>  the sitting/attempt identity. It is printed (LAUNCH) before any connection, carried as
 *       the session's application_name, and the transaction holds the repair advisory lock, so recover.mts can tell a live
 *       attempt (even one that has not reached its locks) from a terminal one.
 *   --baseline <file> --baseline-sha256 <hex>  the verified, sitting-specific P3 BEFORE capture (capture.mts). Under the locks
 *       and BEFORE the UPDATE the runner recaptures every line and refuses unless they all equal the baseline: identity,
 *       player set, starting status and NULL votes, coverage, inputs, H1, H2, H3 (with its count) and the row-content
 *       fingerprints. After the UPDATE (still in the transaction) the recapture must equal the exact repaired image.
 *
 *   node --import tsx tools/v2/b1a-successor/repair.mts --dsn-env AFLDB_IMPORT_DATABASE_URL --expect-db <db> --expect-oid <oid> \
 *        --expect-sysid <sysid> --expect-ids-md5 <32 hex> --attempt <id> --baseline <file> --baseline-sha256 <64 hex> [--commit]
 *
 * OUTCOME line and exit code (unchanged): 0 DRY-RUN-PASS (rolled back) | COMMITTED; 1 REFUSED <reason> (nothing written);
 * 2 ERROR <message> (rolled back by the server); 3 ALREADY-APPLIED; 4 COMMIT-UNKNOWN <message> (recover.mts decides).
 * Prints aggregates and hashes only; never a DSN, never row data.
 */
import { readFileSync } from 'node:fs';

import postgres from 'postgres';

import { brownlowStatusSql } from '../../../src/db/queries/brownlow-readiness';
import { captureLines, lockStatement, pinOutputSettings, readIdentity, redact, tryRepairLock } from './db';
import {
  COVERAGE_KEYS, EXPECTED_ROWS, LOCKED_TABLES, SEASON, applicationName, bindBaseline, describeDiff, diffLines, md5Hex, parseAttempt,
  repairedImage, sameCapture,
} from './lib';

const args = process.argv.slice(2);
const valued = ['--dsn-env', '--expect-db', '--expect-oid', '--expect-sysid', '--expect-ids-md5', '--attempt', '--baseline', '--baseline-sha256'];
const arg = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const commit = args.includes('--commit');

let outcome = 'NOT-RUN';
let code = 1;
const finish = () => { console.log('OUTCOME', outcome); process.exitCode = code; };
const refuseEarly = (why: string) => { outcome = `REFUSED ${why}`; code = 1; finish(); process.exit(); };

const unknown = args.filter((a, i) => a.startsWith('--') && a !== '--commit' && !valued.includes(a) && !valued.includes(args[i - 1]));
const dsnEnv = arg('dsn-env'); const expectDb = arg('expect-db'); const expectOid = arg('expect-oid');
const expectSysid = arg('expect-sysid'); const expectIds = arg('expect-ids-md5'); const attempt = parseAttempt(arg('attempt'));
const baselinePath = arg('baseline'); const baselineSha = arg('baseline-sha256') ?? '';
if (unknown.length || !dsnEnv || !expectDb || !/^\d+$/.test(expectOid ?? '') || !/^\d+$/.test(expectSysid ?? '')
    || !/^[0-9a-f]{32}$/.test(expectIds ?? '') || !attempt || !baselinePath) {
  refuseEarly(`usage: --dsn-env, --expect-db, --expect-oid, --expect-sysid, --expect-ids-md5, --attempt <STAMP>-<dry|commit>-<n> and --baseline/--baseline-sha256 are all required${unknown.length ? `; unknown ${unknown.join(' ')}` : ''}`);
}
if ((attempt!.mode === 'commit') !== commit) refuseEarly(`attempt ${attempt!.id} is a ${attempt!.mode} attempt but --commit is ${commit ? 'present' : 'absent'}`);
let baselineBytes: Buffer;
try { baselineBytes = readFileSync(baselinePath!); } catch (e) { refuseEarly(`baseline unreadable: ${(e as Error).message}`); }
const bound = bindBaseline(baselineBytes!, { sha256: baselineSha, sitting: attempt!.sitting, db: expectDb!, oid: expectOid!, sysid: expectSysid!, idsMd5: expectIds! });
if (!bound.baseline) refuseEarly(`baseline evidence: ${bound.problems.join('; ')}`);
const baseline = bound.baseline!;
const dsn = process.env[dsnEnv!];
if (!dsn) refuseEarly(`${dsnEnv} is not set`);

// Before any connection: the record that this attempt exists (recover.mts reads it; a process listing alone is not enough).
console.log('LAUNCH', JSON.stringify({ attempt: attempt!.id, mode: attempt!.mode, pid: process.pid, baselineSha256: baselineSha }));

class Refuse extends Error {}
class AlreadyApplied extends Error {}
class DryRun extends Error {}

const sql = postgres(dsn!, { max: 1, onnotice: () => {}, connection: { TimeZone: 'Etc/UTC', application_name: applicationName(attempt!.id) } });
type Tx = postgres.TransactionSql;

async function capture(tx: Tx) {
  const [rows] = await tx<{ n: number; na: number; pending: number; votes: number; ids: string | null }[]>`
    SELECT count(*)::int AS n,
           count(*) FILTER (WHERE brownlow_status = 'not_applicable')::int AS na,
           count(*) FILTER (WHERE brownlow_status = 'pending')::int AS pending,
           count(brownlow_votes)::int AS votes,
           md5(string_agg(player_id::text, ',' ORDER BY player_id)) AS ids
      FROM player_season_stats WHERE season = ${SEASON}`;
  const coverage = await tx<{ stat_key: string; coverage: string; is_recorded: boolean; populated_rows: number | null; total_rows: number | null }[]>`
    SELECT stat_key, coverage::text AS coverage, is_recorded, populated_rows, total_rows FROM stat_availability
     WHERE season = ${SEASON} AND stat_key LIKE 'brownlow%' ORDER BY stat_key`;
  const [inputs] = await tx<{ season: string | null; medal: number; published: number }[]>`
    SELECT (SELECT status::text FROM seasons WHERE year = ${SEASON}) AS season,
           (SELECT count(*)::int FROM brownlow_season_votes WHERE season = ${SEASON}) AS medal,
           (SELECT count(*)::int FROM brownlow_season_authority WHERE season = ${SEASON} AND published_revision IS NOT NULL) AS published`;
  const [derived] = await tx.unsafe<{ s: string }[]>(`SELECT (${brownlowStatusSql(String(SEASON))})::text AS s`);
  const lines = await captureLines(tx, attempt!.sitting);
  return { pss: rows, coverage, ...inputs, derived: derived.s, lines };
}
type Capture = Awaited<ReturnType<typeof capture>>;
const show = (label: string, c: Capture) => console.log(label, JSON.stringify({
  pss2026: `${c.pss.n} rows, not_applicable ${c.pss.na}, pending ${c.pss.pending}, votes ${c.pss.votes}`, ids: c.pss.ids,
  season: c.season, medalRows: c.medal, publishedAuthority: c.published, derivedStatus: c.derived,
  lines: Object.fromEntries(c.lines.filter((l) => /^(fp_|inputs2026|na_)/.test(l)).map((l) => [l.split('|', 1)[0], l.slice(l.indexOf('|') + 1)])),
}));

/** Everything except the 2026 player-season status must be exactly the approved start state (packet 6R, unchanged). */
function preconditions(c: Capture): string[] {
  const f: string[] = [];
  if (c.season !== 'complete') f.push(`seasons.status ${SEASON} is ${c.season}, expected complete`);
  if (c.medal !== 0) f.push(`${c.medal} brownlow_season_votes rows for ${SEASON} (a loaded medal result is out of scope)`);
  if (c.published !== 0) f.push(`${c.published} published brownlow_season_authority rows for ${SEASON}`);
  if (c.derived !== 'pending') f.push(`the shipped derivation gives '${c.derived}' for ${SEASON}, not 'pending'`);
  const cov = c.coverage.map((r) => `${r.stat_key}=${r.coverage}/${r.is_recorded}/${r.populated_rows}/${r.total_rows}`).join(',');
  const want = COVERAGE_KEYS.map((k) => `${k}=pending/false/null/null`).join(',');
  if (cov !== want) f.push(`2026 Brownlow coverage rows are [${cov}], expected [${want}]`);
  if (c.pss.ids !== expectIds) f.push(`2026 player_id set hash ${c.pss.ids} differs from --expect-ids-md5`);
  if (c.pss.n !== EXPECTED_ROWS) f.push(`${c.pss.n} player_season_stats rows for ${SEASON}, expected ${EXPECTED_ROWS}`);
  if (c.pss.votes !== 0) f.push(`${c.pss.votes} non-NULL 2026 brownlow_votes`);
  return f;
}

let commitStage = false;
try {
  await sql.begin(async (tx) => {
    await tx`SET LOCAL lock_timeout = '5s'`;
    await tx`SET LOCAL statement_timeout = '60s'`;
    await tx`SET LOCAL idle_in_transaction_session_timeout = '60s'`;
    await pinOutputSettings(tx);
    const id = await readIdentity(tx);
    if (id.db !== expectDb || id.oid !== expectOid || id.sysid !== expectSysid || id.ro !== 'off' || id.iso !== 'read committed' || id.schema !== baseline.schema)
      throw new Refuse(`identity or session mismatch: ${JSON.stringify(id)}`);
    if (!(await tryRepairLock(tx))) throw new Refuse('another B1a repair or reversal transaction holds the repair lock');
    const t0 = Date.now();
    await tx.unsafe(lockStatement);
    const locked = await tx<{ player_id: number }[]>`
      SELECT player_id FROM player_season_stats WHERE season = ${SEASON} ORDER BY player_id FOR UPDATE`;
    console.log('LOCKED', JSON.stringify({ tables: LOCKED_TABLES, mode: 'SHARE ROW EXCLUSIVE', rows2026: locked.length, waitMs: Date.now() - t0 }));

    const before = await capture(tx);
    show('BEFORE', before);
    const f = preconditions(before);
    if (f.length) throw new Refuse(f.join('; '));
    if (before.pss.pending === EXPECTED_ROWS && before.pss.na === 0) throw new AlreadyApplied();
    if (before.pss.na !== EXPECTED_ROWS)
      throw new Refuse(`2026 statuses are mixed or changed: not_applicable ${before.pss.na}, pending ${before.pss.pending}, other ${before.pss.n - before.pss.na - before.pss.pending}`);
    // ISSUE-366 §2: the pre-write state must be the verified P3 BEFORE capture, line for line, before the first UPDATE.
    if (!sameCapture(baseline.lines, before.lines))
      throw new Refuse(`BASELINE DRIFT before any write: ${describeDiff(diffLines(baseline.lines, before.lines))}`);
    console.log('BASELINE-CHECK PASS', JSON.stringify({ lines: before.lines.length, sha256: baselineSha }));

    const changed = await tx<{ player_id: number }[]>`
      UPDATE player_season_stats SET brownlow_status = 'pending'
       WHERE season = ${SEASON} AND brownlow_status = 'not_applicable' AND brownlow_votes IS NULL
      RETURNING player_id`;
    const changedIds = changed.map((r) => r.player_id).sort((a, b) => a - b).join(',');
    const after = await capture(tx);
    show('AFTER(in tx)', after);
    const a: string[] = [];
    if (changed.length !== EXPECTED_ROWS) a.push(`UPDATE touched ${changed.length} rows, expected ${EXPECTED_ROWS}`);
    if (md5Hex(changedIds) !== expectIds) a.push('the updated player_id set differs from --expect-ids-md5');
    if (after.pss.n !== EXPECTED_ROWS || after.pss.pending !== EXPECTED_ROWS || after.pss.votes !== 0 || after.pss.ids !== expectIds)
      a.push('2026 rows are not exactly the expected ids x pending x NULL votes');
    if (after.derived !== 'pending') a.push('derived status is no longer pending');
    const image = repairedImage(baseline.lines);
    if (!sameCapture(image, after.lines)) a.push(`post-state is not the exact repaired image: ${describeDiff(diffLines(image, after.lines))}`);
    if (a.length) throw new Refuse(`ACCEPTANCE FAILED: ${a.join('; ')}`);
    if (!commit) throw new DryRun();
    commitStage = true; // returning from the callback sends COMMIT
  });
  outcome = 'COMMITTED'; code = 0;
} catch (e) {
  if (e instanceof DryRun) { outcome = 'DRY-RUN-PASS (rolled back)'; code = 0; }
  else if (e instanceof AlreadyApplied) { outcome = 'ALREADY-APPLIED (nothing written)'; code = 3; }
  else if (e instanceof Refuse) { outcome = `REFUSED ${e.message}`; code = 1; }
  else if (commitStage) { outcome = `COMMIT-UNKNOWN ${redact((e as Error).message)}`; code = 4; }
  else { outcome = `ERROR ${redact((e as Error).message)}`; code = 2; }
} finally {
  await sql.end({ timeout: 5 });
}
finish();
