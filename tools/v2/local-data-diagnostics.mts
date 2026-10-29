/** Read-only explanation of release snapshot differences. No source acquisition. */
import { writeFileSync } from 'node:fs';
import postgres from 'postgres';
import { sql as appSql } from '../../src/db/client';
import { runAdvancedSearch } from '../../src/db/queries/advanced-search';
import { parseAdvancedQuery } from '../../src/search/advanced-spec';
import { checkIsolatedTestDsn, checkIsolatedTestServer } from '@afldb/domain';

const dsn = process.env.AFLDB_TEST_DATABASE_URL ?? '';
if (process.env.AFLDB_V2_ISOLATED_PG !== '1' || checkIsolatedTestDsn(dsn, 55432).length) throw new Error('Guarded isolated target required');
const sql = postgres(dsn, { max: 1 });
try {
  const [facts] = await sql`SELECT current_database() AS database, current_setting('cluster_name') AS cluster,
    shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()`;
  if (checkIsolatedTestServer(new URL(dsn).pathname.slice(1), { currentDatabase: facts.database, clusterName: facts.cluster, databaseComment: facts.marker }).length) throw new Error('Live isolated identity mismatch');
  const cohorts = [];
  const collations = await sql<{ name: string }[]>`SELECT collname AS name FROM pg_collation
    WHERE collname IN ('en-US-x-icu','en-x-icu','und-x-icu')`;
  for (const params of [{ goals_min: '50', goals_max: '199', brownlow_votes_min: '0', brownlow_votes_max: '0' },
    { debut_min: '1960', debut_max: '1969', clubs_min: '2', clubs_max: '2' }]) {
    const ids: number[] = [];
    for (let page = 1; page <= 20; page++) {
      const { query, errors } = parseAdvancedQuery({ ...params, page_size: '100', page: String(page) });
      if (errors.length) throw new Error(JSON.stringify(errors));
      const result = await runAdvancedSearch(query);
      ids.push(...result.rows.map((r) => r.id));
      if (ids.length >= result.total) break;
    }
    const oracle = params.goals_min
      ? await sql<{ id: number }[]>`SELECT player_id AS id FROM player_career_stats
          WHERE goals BETWEEN 50 AND 199 AND brownlow_votes=0 ORDER BY player_id`
      : await sql<{ id: number }[]>`SELECT player_id AS id FROM player_career_stats
          WHERE debut_season BETWEEN 1960 AND 1969 AND clubs_played=2 ORDER BY player_id`;
    const agreesWithIndependentSql = JSON.stringify([...ids].sort((a,b) => a-b)) === JSON.stringify(oracle.map((r) => r.id));
    if (!agreesWithIndependentSql) throw new Error('Advanced Search differs from the independent cohort SQL; do not classify as a reference-only gap');
    const [hashes] = await sql`SELECT count(*)::int AS identities, count(DISTINCT ei.player_id)::int AS people,
      substr(encode(sha256(convert_to(string_agg(ei.external_id,',' ORDER BY ei.external_id),'UTF8')),'hex'),1,16) AS native,
      substr(encode(sha256(convert_to(string_agg(ei.external_id,',' ORDER BY lower(ei.external_id) COLLATE "C", ei.external_id COLLATE "C"),'UTF8')),'hex'),1,16) AS folded,
      substr(encode(sha256(convert_to(string_agg(ei.external_id,',' ORDER BY ei.external_id COLLATE "C"),'UTF8')),'hex'),1,16) AS c
      FROM external_identities ei JOIN sources s ON s.id=ei.source_id AND s.key='afltables'
      WHERE ei.match_method='afltables_profile_url' AND ei.status IN ('unique','resolved') AND ei.player_id=ANY(${ids})`;
    const localeHashes = [];
    for (const collation of collations) {
      const [row] = await sql`SELECT substr(encode(sha256(convert_to(
        string_agg(ei.external_id,',' ORDER BY ei.external_id COLLATE ${sql(collation.name)}),'UTF8')),'hex'),1,16) AS hash
        FROM external_identities ei JOIN sources s ON s.id=ei.source_id AND s.key='afltables'
        WHERE ei.match_method='afltables_profile_url' AND ei.status IN ('unique','resolved') AND ei.player_id=ANY(${ids})`;
      localeHashes.push({ collation: collation.name, hash: row.hash });
    }
    const identityKeys = await sql<{ key: string }[]>`SELECT ei.external_id AS key
      FROM external_identities ei JOIN sources s ON s.id=ei.source_id AND s.key='afltables'
      WHERE ei.match_method='afltables_profile_url' AND ei.status IN ('unique','resolved')
        AND ei.player_id=ANY(${ids}) ORDER BY ei.external_id COLLATE "C"`;
    cohorts.push({ params, count: ids.length, hashes, localeHashes,
      independentSqlCount: oracle.length, agreesWithIndependentSql, identityKeys: identityKeys.map((r) => r.key) });
  }
  const [coverage] = await sql`SELECT min(season)::int AS first, max(season)::int AS last, count(*)::int AS matches FROM matches`;
  const [locale] = await sql`SELECT datcollate,datctype FROM pg_database WHERE datname=current_database()`;
  const matchlessCoaches = await sql`SELECT c.display_name, c.afltables_coach_path, c.source_games_coached
    FROM coaches c WHERE c.player_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM match_coaches mc WHERE mc.coach_id=c.id) ORDER BY c.afltables_coach_path`;
  writeFileSync(process.argv[2], JSON.stringify({ database: facts.database, locale, coverage, cohorts, matchlessCoaches }, null, 2) + '\n', { flag: 'wx' });
  console.log('Read-only snapshot/ordering diagnostics written');
} finally { await sql.end({ timeout: 5 }); await appSql.end({ timeout: 5 }); }
