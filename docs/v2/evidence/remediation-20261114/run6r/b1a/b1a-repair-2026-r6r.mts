/**
 * ISSUE-365 B1a, packet 6R: the 2026 Brownlow player-season status repair as ONE exact, locked transaction.
 * OPERATIONAL EXECUTABLE ARTIFACT (packet 6R §3). Not executed against production. Supersedes run5/b1a/b1a-repair-2026.mts.
 *
 * Scope, fixed in code (the approval names exactly this and nothing else):
 *   season 2026; player_season_stats rows: exactly 669, every one brownlow_status = 'not_applicable' AND brownlow_votes IS NULL,
 *   and the ordered player_id set must hash to --expect-ids-md5. Writes ONLY player_season_stats.brownlow_status of those 669 rows,
 *   'not_applicable' -> 'pending'. brownlow_votes is not assigned (stays NULL). Coverage is NEVER recomputed or written.
 *
 * Usage (all identity flags REQUIRED; there are no defaults):
 *   node --import tsx <this file> --dsn-env AFLDB_IMPORT_DATABASE_URL --expect-db afldb_prod --expect-oid 66668 \
 *        --expect-sysid 7674454702926115004 --expect-ids-md5 <32 hex> [--commit]
 * Without --commit it ALWAYS rolls back (dry run), after performing and verifying the update inside the transaction.
 *
 * OUTCOME line and exit code (decide on both; they agree):
 *   0 DRY-RUN-PASS (rolled back) | COMMITTED
 *   1 REFUSED <reason>            precondition or acceptance failed; rolled back; nothing written
 *   2 ERROR <message>             e.g. lock_timeout / statement_timeout / connection; rolled back by the server
 *   3 ALREADY-APPLIED             the exact repaired state (669 x pending, same ids, NULL votes); nothing written
 *   4 COMMIT-UNKNOWN <message>    the connection failed during COMMIT: run b1a-accept-r6r.sql to learn which state holds
 * Prints aggregates and hashes only; never a DSN, never row data.
 *
 * Concurrency (packet 6R §2): one LOCK TABLE statement takes SHARE ROW EXCLUSIVE, in the fixed order below, on every table the
 * repair reads or writes, BEFORE any precondition is read. That mode conflicts with every INSERT/UPDATE/DELETE/TRUNCATE/DDL lock
 * (ROW EXCLUSIVE and above) and with itself, so from the moment the locks are granted until COMMIT/ROLLBACK no other session can
 * change any of these tables; readers (ACCESS SHARE) are unaffected. The 2026 rows are then also row-locked FOR UPDATE. READ COMMITTED:
 * every check statement takes its snapshot after the locks are held, so it sees every write committed before them.
 */
import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { brownlowStatusSql } from '../../../../../../src/db/queries/brownlow-readiness';

const SEASON = 2026;
const EXPECTED_ROWS = 669;
const COVERAGE_KEYS = ['brownlow_match_votes', 'brownlow_round_votes', 'brownlow_season_total'] as const;
// Fixed lock order. Every table read by the precondition or by the shipped status derivation, then the written table last.
const LOCKED_TABLES = ['seasons', 'stat_availability', 'brownlow_season_votes', 'brownlow_season_authority',
  'brownlow_vote_entry_state', 'brownlow_round_votes', 'player_season_stats'] as const;

const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const known = new Set(['--dsn-env', '--expect-db', '--expect-oid', '--expect-sysid', '--expect-ids-md5', '--commit']);
const commit = args.includes('--commit');
const dsnEnv = arg('dsn-env');
const expectDb = arg('expect-db');
const expectOid = arg('expect-oid');
const expectSysid = arg('expect-sysid');
const expectIds = arg('expect-ids-md5');

let outcome = 'NOT-RUN';
let code = 1;
const finish = () => { console.log('OUTCOME', outcome); process.exitCode = code; };

const usage = args.filter((a) => a.startsWith('--') && !known.has(a));
if (usage.length || !dsnEnv || !expectDb || !/^\d+$/.test(expectOid ?? '') || !/^\d+$/.test(expectSysid ?? '')
    || !/^[0-9a-f]{32}$/.test(expectIds ?? '')) {
  outcome = `REFUSED usage: --dsn-env, --expect-db, --expect-oid, --expect-sysid and --expect-ids-md5 are all required${usage.length ? `; unknown ${usage.join(' ')}` : ''}`;
  finish();
  process.exit();
}
const dsn = process.env[dsnEnv!];
if (!dsn) { outcome = `REFUSED ${dsnEnv} is not set`; finish(); process.exit(); }

class Refuse extends Error {}
class AlreadyApplied extends Error {}
class DryRun extends Error {}

const sql = postgres(dsn, { max: 1, onnotice: () => {}, connection: { TimeZone: 'Etc/UTC', application_name: 'issue365-b1a-r6r' } });
type Tx = postgres.TransactionSql;

async function capture(tx: Tx) {
  const [rows] = await tx<{ n: number; na: number; pending: number; votes: number; ids: string | null; nonbrownlow: string | null }[]>`
    SELECT count(*)::int AS n,
           count(*) FILTER (WHERE brownlow_status = 'not_applicable')::int AS na,
           count(*) FILTER (WHERE brownlow_status = 'pending')::int AS pending,
           count(brownlow_votes)::int AS votes,
           md5(string_agg(player_id::text, ',' ORDER BY player_id)) AS ids,
           md5(string_agg(((to_jsonb(p) - 'brownlow_status'))::text, E'\n' ORDER BY player_id)) AS nonbrownlow
      FROM player_season_stats p WHERE season = ${SEASON}`;
  const [other] = await tx<{ fp: string | null }[]>`
    SELECT md5(string_agg(p::text, E'\n' ORDER BY p.season, p.player_id)) AS fp FROM player_season_stats p WHERE season <> ${SEASON}`;
  const [sa] = await tx<{ fp: string | null; n: number }[]>`
    SELECT md5(string_agg(sa::text, E'\n' ORDER BY sa.season, sa.stat_key)) AS fp, count(*)::int AS n FROM stat_availability sa`;
  const coverage = await tx<{ stat_key: string; coverage: string; is_recorded: boolean; populated_rows: number | null; total_rows: number | null }[]>`
    SELECT stat_key, coverage::text AS coverage, is_recorded, populated_rows, total_rows FROM stat_availability
     WHERE season = ${SEASON} AND stat_key LIKE 'brownlow%' ORDER BY stat_key`;
  const [inputs] = await tx<{ season: string | null; medal: number; published: number; authority: number; roundRows: number; entry: string | null }[]>`
    SELECT (SELECT status::text FROM seasons WHERE year = ${SEASON}) AS season,
           (SELECT count(*)::int FROM brownlow_season_votes WHERE season = ${SEASON}) AS medal,
           (SELECT count(*)::int FROM brownlow_season_authority WHERE season = ${SEASON} AND published_revision IS NOT NULL) AS published,
           (SELECT count(*)::int FROM brownlow_season_authority WHERE season = ${SEASON}) AS authority,
           (SELECT count(*)::int FROM brownlow_round_votes WHERE season = ${SEASON}) AS "roundRows",
           (SELECT string_agg(status || ':' || k, ',' ORDER BY status)
              FROM (SELECT status::text AS status, count(*) AS k FROM brownlow_vote_entry_state WHERE season = ${SEASON} GROUP BY 1) q) AS entry`;
  const [derived] = await tx.unsafe<{ s: string }[]>(`SELECT (${brownlowStatusSql(String(SEASON))})::text AS s`);
  return { pss: rows, fpOtherSeasons: other.fp, fpStatAvailability: sa.fp, statAvailabilityRows: sa.n, coverage, ...inputs, derived: derived.s };
}
type Capture = Awaited<ReturnType<typeof capture>>;
const show = (label: string, c: Capture) => console.log(label, JSON.stringify({
  pss2026: `${c.pss.n} rows, not_applicable ${c.pss.na}, pending ${c.pss.pending}, votes ${c.pss.votes}`, ids: c.pss.ids,
  fp2026NonStatus: c.pss.nonbrownlow, fpOtherSeasons: c.fpOtherSeasons, fpStatAvailability: c.fpStatAvailability,
  coverage: c.coverage.map((r) => `${r.stat_key}=${r.coverage}/${r.is_recorded ? 'recorded' : 'unrecorded'}/${r.populated_rows ?? '-'}/${r.total_rows ?? '-'}`),
  season: c.season, medalRows: c.medal, publishedAuthority: c.published, authorityRows: c.authority, roundRows: c.roundRows,
  entryState: c.entry ?? 'none', derivedStatus: c.derived }));

/** Everything except the 2026 player-season status must be exactly the approved start state. */
function preconditions(c: Capture): string[] {
  const f: string[] = [];
  if (c.season !== 'complete') f.push(`seasons.status ${SEASON} is ${c.season}, expected complete`);
  if (c.medal !== 0) f.push(`${c.medal} brownlow_season_votes rows for ${SEASON} (a loaded medal result is out of scope)`);
  if (c.published !== 0) f.push(`${c.published} published brownlow_season_authority rows for ${SEASON}`);
  if (c.derived !== 'pending') f.push(`the shipped derivation gives '${c.derived}' for ${SEASON}, not 'pending'`);
  const cov = c.coverage.map((r) => `${r.stat_key}=${r.coverage}/${r.is_recorded}/${r.populated_rows}/${r.total_rows}`).join(',');
  const want = COVERAGE_KEYS.map((k) => `${k}=pending/false/null/null`).join(',');
  if (cov !== want) f.push(`2026 Brownlow coverage rows are [${cov}], expected [${want}] (a different coverage state needs a separate reviewed operation)`);
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
    const [id] = await tx<{ db: string; oid: string; sysid: string; ro: string; iso: string }[]>`
      SELECT current_database() AS db, d.oid::text AS oid, c.system_identifier::text AS sysid,
             current_setting('transaction_read_only') AS ro, current_setting('transaction_isolation') AS iso
        FROM pg_database d CROSS JOIN pg_control_system() c WHERE d.datname = current_database()`;
    if (id.db !== expectDb || id.oid !== expectOid || id.sysid !== expectSysid || id.ro !== 'off' || id.iso !== 'read committed')
      throw new Refuse(`identity or session mismatch: ${JSON.stringify(id)}`);
    const t0 = Date.now();
    await tx.unsafe(`LOCK TABLE ${LOCKED_TABLES.join(', ')} IN SHARE ROW EXCLUSIVE MODE`);
    // Row locks on the exact 2026 rows, in primary-key order (no other writer can hold one now except a SELECT ... FOR SHARE/UPDATE).
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

    // The only write. brownlow_votes is not assigned. RETURNING gives the exact identities touched.
    const changed = await tx<{ player_id: number }[]>`
      UPDATE player_season_stats SET brownlow_status = 'pending'
       WHERE season = ${SEASON} AND brownlow_status = 'not_applicable' AND brownlow_votes IS NULL
      RETURNING player_id`;
    const changedIds = changed.map((r) => r.player_id).sort((a, b) => a - b).join(',');
    const h = createHash('md5').update(changedIds).digest('hex');

    const after = await capture(tx);
    show('AFTER(in tx)', after);
    const a: string[] = [];
    if (changed.length !== EXPECTED_ROWS) a.push(`UPDATE touched ${changed.length} rows, expected ${EXPECTED_ROWS}`);
    if (h !== expectIds) a.push('the updated player_id set differs from --expect-ids-md5');
    if (after.pss.n !== EXPECTED_ROWS || after.pss.pending !== EXPECTED_ROWS || after.pss.votes !== 0 || after.pss.ids !== expectIds)
      a.push('2026 rows are not exactly the expected ids x pending x NULL votes');
    if (after.pss.nonbrownlow !== before.pss.nonbrownlow) a.push('a 2026 player-season column other than brownlow_status changed');
    if (after.fpOtherSeasons !== before.fpOtherSeasons) a.push('player_season_stats of another season changed');
    if (after.fpStatAvailability !== before.fpStatAvailability || after.statAvailabilityRows !== before.statAvailabilityRows)
      a.push('stat_availability changed (coverage must not be written)');
    if (JSON.stringify(preconditions(after)) !== '[]') a.push(`post-state inputs: ${preconditions(after).join('; ')}`);
    if (after.derived !== 'pending') a.push('derived status is no longer pending');
    if (a.length) throw new Refuse(`ACCEPTANCE FAILED: ${a.join('; ')}`);
    if (!commit) throw new DryRun();
    commitStage = true; // returning from the callback sends COMMIT
  });
  outcome = 'COMMITTED'; code = 0;
} catch (e) {
  if (e instanceof DryRun) { outcome = 'DRY-RUN-PASS (rolled back)'; code = 0; }
  else if (e instanceof AlreadyApplied) { outcome = 'ALREADY-APPLIED (nothing written)'; code = 3; }
  else if (e instanceof Refuse) { outcome = `REFUSED ${e.message}`; code = 1; }
  else {
    const msg = String((e as Error).message).replace(/postgres(ql)?:\/\/\S+/g, '<dsn>').slice(0, 300);
    if (commitStage) { outcome = `COMMIT-UNKNOWN ${msg}`; code = 4; } else { outcome = `ERROR ${msg}`; code = 2; }
  }
} finally {
  await sql.end({ timeout: 5 });
}
finish();
