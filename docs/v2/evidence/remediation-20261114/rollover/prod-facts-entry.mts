/**
 * AFLDB-ISSUE-350 evidence entry (READ-ONLY). Bundled with esbuild (the tracked contract JSON and the tracked
 * src/lib/rollover/season-opening.ts are inlined, `postgres` stays external) and piped to `node` on stdin, so the
 * production host receives a script on a pipe and nothing is written there. It opens ONE `read only` REPEATABLE READ
 * transaction, asserts the reviewed identity before any other read, and prints aggregates and ids only (never a DSN).
 *
 * The DSN comes from RV_DSN (the host's backup-role DSN, read on the host by the calling shell and never printed).
 * RV_EXPECT_DB / RV_EXPECT_OID / RV_EXPECT_SYSID are the asserted identity; RV_EXPECT_DB may be empty only for DEV,
 * where no OID/system identifier was ever recorded: the identity is then RECORDED, not asserted, and the report says so.
 */
import postgres from 'postgres';

import seasonsDoc from '../../../../../data/reference/seasons.json';
import clubsDoc from '../../../../../data/reference/clubs.json';
import {
  changesOf, classifyOpening, expectedOpening, readOpeningFacts, surfaceDigest,
} from '../../../../../src/lib/rollover/season-opening';

const dsn = process.env.RV_DSN;
if (!dsn) { console.log('ERROR no RV_DSN'); process.exit(2); }
const sql = postgres(dsn, { max: 1, connect_timeout: 10, onnotice: () => {}, connection: { default_transaction_read_only: true, TimeZone: process.env.RV_TZ ?? 'Etc/UTC', statement_timeout: 60000 } });
try {
  const out = await sql.begin('isolation level repeatable read read only', async (tx) => {
    const [id] = await tx<Record<string, string>[]>`
      SELECT current_database() AS db, d.oid::text AS oid, c.system_identifier::text AS sysid, current_setting('transaction_read_only') AS ro,
             current_setting('TimeZone') AS tz, current_user AS usr, inet_server_port()::text AS port, current_setting('server_version') AS pg,
             (SELECT max(name) FROM afldb_meta.schema_migrations) AS ledger, (SELECT count(*)::text FROM afldb_meta.schema_migrations) AS ledger_n,
             now()::text AS at
        FROM pg_database d CROSS JOIN pg_control_system() c WHERE d.datname = current_database()`;
    if (id.ro !== 'on') throw new Error('transaction is not read only');
    const asserted = { db: process.env.RV_EXPECT_DB ?? '', oid: process.env.RV_EXPECT_OID ?? '', sysid: process.env.RV_EXPECT_SYSID ?? '' };
    if (asserted.db && (id.db !== asserted.db || (asserted.oid && id.oid !== asserted.oid) || (asserted.sysid && id.sysid !== asserted.sysid))) {
      throw new Error('identity differs from the asserted identity; no further read');
    }
    const exp = expectedOpening(seasonsDoc, clubsDoc);
    const facts = await readOpeningFacts(tx, exp.year);
    const verdict = classifyOpening(exp, facts);
    const changes = changesOf(verdict);
    const seasonsTail = facts.seasons.filter((s) => Number(s.year) >= exp.year - 2)
      .map((s) => ({ year: s.year, league: s.league, status: s.status, notes: s.notes, matchCount: s.match_count ?? null, dataThrough: s.data_through_date ?? null }));
    const currentClubs = facts.clubs.filter((c) => c.is_current_afl_club)
      .map((c) => ({ id: c.id, slug: c.slug, first: c.first_season, last: c.last_season, org: c.organization_id }));
    const [counts] = await tx<{ fixtures_year: number; matches_year: number; matches_prev: number; fk_fixtures_year: number }[]>`
      SELECT (SELECT count(*)::int FROM fixtures WHERE season = ${exp.year}) AS fixtures_year,
             (SELECT count(*)::int FROM matches WHERE season = ${exp.year}) AS matches_year,
             (SELECT count(*)::int FROM matches WHERE season = ${exp.previousYear}) AS matches_prev,
             (SELECT count(*)::int FROM fixtures f WHERE f.season = ${exp.year} AND NOT EXISTS (SELECT 1 FROM seasons s WHERE s.year = f.season)) AS fk_fixtures_year`;
    const [dependents] = await tx<{ n: number }[]>`
      SELECT (SELECT count(*)::int FROM matches WHERE season = ${exp.year}) + (SELECT count(*)::int FROM club_seasons WHERE season = ${exp.year})
           + (SELECT count(*)::int FROM staging.afl_api_match WHERE season = ${exp.year}) AS n`;
    // O-6: the writer role the apply uses must hold exactly these privileges (has_table_privilege reads the catalog; no row is touched)
    const privileges = await tx<{ role: string; relation: string; privilege: string; granted: boolean }[]>`
      SELECT r.role, t.relation, p.privilege, has_table_privilege(r.role, t.relation, p.privilege) AS granted
        FROM (VALUES ('afldb_import'), ('afldb_app'), ('afldb_backup')) AS r(role)
        CROSS JOIN (VALUES ('seasons'), ('clubs'), ('club_organizations'), ('import_batches'), ('sources')) AS t(relation)
        CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(privilege)
       WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.role)
       ORDER BY 1, 2, 3`;
    return { id, privileges, asserted: asserted.db ? 'asserted' : 'recorded-only', verdict: verdict.state, problems: verdict.problems, seasonRow: verdict.season,
      openIdentities: exp.open.length, clubsToChange: changes.clubIds.length, orgsToChange: changes.orgIds.length, maxYear: facts.maxYear,
      seasonsTail, currentClubs, orgsLast: facts.orgs.map((o) => ({ id: o.id, last: o.last_season })),
      identityResolvedForYear: facts.identityForYear.filter((r) => r.club !== null).length, listPrevious: facts.listPrevious.length, listYear: facts.listYear.length,
      surfaceDigest: surfaceDigest(facts), importBatches: facts.batches, counts, dependentsOfYear: dependents.n };
  });
  console.log(JSON.stringify(out));
} catch (e) {
  console.log('ERROR', String((e as Error).message).replace(/postgres(ql)?:\/\/\S+/g, '<dsn>').slice(0, 300));
} finally {
  await sql.end();
}
