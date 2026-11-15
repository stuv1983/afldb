/**
 * ISSUE-365 B1a: the conditional 2026 Brownlow status repair, as ONE transaction through the shipped code.
 * PROPOSED PROCEDURE (run 5). Not executed against production. Dry-run (rolled back) on a fresh copy of the 4 Nov snapshot,
 * whose 2026 Brownlow state equals production's as read by B0 (2026-11-15): see ./README.md.
 *
 * Run from a checkout of the published candidate (the module it imports is src/db/queries/player-derived.ts):
 *   node --import tsx <this file> --dsn-env AFLDB_IMPORT_DATABASE_URL --expect-db afldb_prod --expect-oid 66668 \
 *        --expect-sysid 7674454702926115004 --expect-rows 669 [--commit]
 * Without --commit it ALWAYS rolls back (dry run). With --commit it commits only if every precondition and acceptance
 * assertion holds inside the same transaction; any failure rolls back and exits 1. Prints aggregates only; never a DSN.
 */
import postgres from 'postgres';
import { recomputeBrownlowCoverage, recomputeSeasonBrownlowStatus } from '../../../../../../src/db/queries/player-derived';

const SEASON = 2026;
const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const commit = args.includes('--commit');
const dsnEnv = arg('dsn-env') ?? 'AFLDB_IMPORT_DATABASE_URL';
const expectDb = arg('expect-db');
const expectOid = arg('expect-oid');
const expectSysid = arg('expect-sysid');
const expectRows = Number(arg('expect-rows') ?? NaN);
const dsn = process.env[dsnEnv];
if (!dsn) throw new Error(`${dsnEnv} is not set`);
if (!expectDb || !Number.isInteger(expectRows)) throw new Error('--expect-db and --expect-rows are required');

class Abort extends Error {}
const sql = postgres(dsn, { max: 1, onnotice: () => {}, connection: { TimeZone: 'Etc/UTC', application_name: 'issue365-b1a' } });

async function state(tx: postgres.TransactionSql) {
  const coverage = await tx<{ stat_key: string; coverage: string; is_recorded: boolean }[]>`
    SELECT stat_key, coverage::text AS coverage, is_recorded FROM stat_availability
     WHERE season = ${SEASON} AND stat_key IN ('brownlow_season_total','brownlow_round_votes','brownlow_match_votes') ORDER BY stat_key`;
  const pss = await tx<{ status: string; n: number; votes: number }[]>`
    SELECT brownlow_status::text AS status, count(*)::int AS n, count(brownlow_votes)::int AS votes
      FROM player_season_stats WHERE season = ${SEASON} GROUP BY 1 ORDER BY 1`;
  const [other] = await tx<{ fp: string }[]>`
    SELECT md5(string_agg(season || ':' || brownlow_status || ':' || n || ':' || v, ',' ORDER BY season, brownlow_status)) AS fp
      FROM (SELECT season, brownlow_status::text AS brownlow_status, count(*) AS n, count(brownlow_votes) AS v
              FROM player_season_stats WHERE season <> ${SEASON} GROUP BY 1, 2) s`;
  const [cov] = await tx<{ fp: string }[]>`
    SELECT md5(string_agg(season || ':' || stat_key || ':' || coverage || ':' || is_recorded, ',' ORDER BY season, stat_key)) AS fp
      FROM stat_availability WHERE season <> ${SEASON}`;
  const [na] = await tx<{ outside: number; war: number }[]>`
    SELECT count(*) FILTER (WHERE season >= 1924 AND season NOT BETWEEN 1942 AND 1945)::int AS outside,
           count(*) FILTER (WHERE season BETWEEN 1942 AND 1945)::int AS war
      FROM stat_availability WHERE stat_key LIKE 'brownlow%' AND coverage = 'not_applicable'`;
  const [rows] = await tx<{ seasonStatus: string | null; medal: number; roundRows: number }[]>`
    SELECT (SELECT status::text FROM seasons WHERE year = ${SEASON}) AS "seasonStatus",
           (SELECT count(*)::int FROM brownlow_season_votes WHERE season = ${SEASON}) AS medal,
           (SELECT count(*)::int FROM brownlow_round_votes WHERE season = ${SEASON}) AS "roundRows"`;
  return { coverage, pss, otherSeasonsFp: other.fp, otherCoverageFp: cov.fp, na, ...rows };
}
const show = (label: string, s: Awaited<ReturnType<typeof state>>) => console.log(label, JSON.stringify({
  coverage: s.coverage.map((c) => `${c.stat_key}=${c.coverage}${c.is_recorded ? '/recorded' : ''}`),
  pss: s.pss.map((p) => `${p.status}:${p.n}/votes:${p.votes}`), season: s.seasonStatus, medalRows: s.medal, roundRows: s.roundRows,
  naOutside: s.na.outside, naWar: s.na.war }));

let outcome = 'NOT-RUN';
try {
  await sql.begin(async (tx) => {
    await tx`SET LOCAL lock_timeout = '5s'`;
    await tx`SET LOCAL statement_timeout = '120s'`;
    const [id] = await tx<{ db: string; oid: string; sysid: string; ro: string }[]>`
      SELECT current_database() AS db, d.oid::text AS oid, c.system_identifier::text AS sysid, current_setting('transaction_read_only') AS ro
        FROM pg_database d CROSS JOIN pg_control_system() c WHERE d.datname = current_database()`;
    if (id.db !== expectDb || (expectOid && id.oid !== expectOid) || (expectSysid && id.sysid !== expectSysid) || id.ro !== 'off')
      throw new Abort(`identity mismatch or read-only session: ${JSON.stringify({ db: id.db, oid: id.oid, ro: id.ro })}`);
    const before = await state(tx);
    show('BEFORE', before);
    // Preconditions (B0 read these values on production 2026-11-15; any difference is a stop, not an adaptation).
    const total = before.pss.reduce((a, p) => a + p.n, 0);
    const naRows = before.pss.find((p) => p.status === 'not_applicable')?.n ?? 0;
    const covNa = before.coverage.some((c) => c.coverage === 'not_applicable');
    if (before.seasonStatus !== 'complete') throw new Abort(`season ${SEASON} is ${before.seasonStatus}, expected complete`);
    if (before.coverage.length !== 3) throw new Abort(`expected 3 coverage rows, found ${before.coverage.length}`);
    if (before.medal !== 0) throw new Abort(`${before.medal} brownlow_season_votes rows for ${SEASON}: a loaded medal is out of this repair's scope`);
    if (total !== expectRows) throw new Abort(`${total} player_season_stats rows for ${SEASON}, expected ${expectRows}`);
    if (naRows === 0 && !covNa) { outcome = 'NOTHING-TO-REPAIR'; throw new Abort('nothing to repair'); }
    // (a) only if a coverage row reads not_applicable; (b) whenever (a) ran or any player-season row reads not_applicable.
    if (covNa) await recomputeBrownlowCoverage(tx, SEASON);
    await recomputeSeasonBrownlowStatus(tx, SEASON);
    const after = await state(tx);
    show('AFTER(in tx)', after);
    const cov = Object.fromEntries(after.coverage.map((c) => [c.stat_key, c]));
    const failures: string[] = [];
    for (const key of ['brownlow_season_total', 'brownlow_match_votes'])
      if (cov[key]?.coverage !== 'pending' || cov[key]?.is_recorded) failures.push(`${key} not pending/unrecorded`);
    const round = cov.brownlow_round_votes;
    if (!round || round.is_recorded || !(round.coverage === 'pending' || (round.coverage === 'partial' && after.roundRows > 0)))
      failures.push('brownlow_round_votes not pending (or partial with round rows)');
    if (after.pss.length !== 1 || after.pss[0].status !== 'pending' || after.pss[0].n !== expectRows || after.pss[0].votes !== 0)
      failures.push(`player_season_stats ${SEASON} is not ${expectRows} x pending with NULL votes`);
    if (after.na.outside !== 0) failures.push(`${after.na.outside} Brownlow not_applicable coverage rows outside the declared seasons`);
    if (after.na.war !== 12) failures.push(`${after.na.war} war-season Brownlow not_applicable rows, expected 12`);
    if (after.otherSeasonsFp !== before.otherSeasonsFp) failures.push('player_season_stats of another season changed');
    if (!covNa && JSON.stringify(after.coverage) !== JSON.stringify(before.coverage)) failures.push('coverage rows changed although (a) did not run');
    if (after.otherCoverageFp !== before.otherCoverageFp) failures.push('stat_availability of another season changed');
    if (failures.length) throw new Abort(`ACCEPTANCE FAILED: ${failures.join('; ')}`);
    if (!commit) { outcome = 'DRY-RUN-PASS (rolled back)'; throw new Abort('dry run'); }
    outcome = 'COMMITTED';
  });
} catch (e) {
  if (!(e instanceof Abort)) { outcome = `ERROR ${String((e as Error).message).replace(/postgres(ql)?:\/\/\S+/g, '<dsn>').slice(0, 300)}`; }
  else if (!outcome.startsWith('DRY-RUN') && outcome !== 'NOTHING-TO-REPAIR') outcome = `ROLLED-BACK ${e.message}`;
} finally {
  await sql.end();
}
console.log('OUTCOME', outcome);
process.exitCode = outcome === 'COMMITTED' || outcome.startsWith('DRY-RUN') || outcome === 'NOTHING-TO-REPAIR' ? 0 : 1;
