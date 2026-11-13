
set -euo pipefail
cd /home/arm/ops/gap029-stages/a25306f9/cand
export RV_DSN="$(sed -n 's/^AFLDB_BACKUP_DATABASE_URL=//p' /home/arm/projects/afldb/.env | tail -1 | sed 's/^"\(.*\)"$/\1/')"
/home/arm/.nvm/versions/node/v22.23.2/bin/node --input-type=module <<'JS'
import { createRequire } from 'node:module';
const require=createRequire('/home/arm/ops/gap029-stages/a25306f9/cand/package.json');
const postgres=require('postgres');
const sql = postgres(process.env.RV_DSN, { max: 1, onnotice: () => {}, connection: { default_transaction_read_only: true, TimeZone: 'Etc/UTC', statement_timeout: 60000 } });
const out = {};
try {
  await sql.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (tx) => {
    const [identity] = await tx`SELECT current_database() AS db, d.oid::text AS oid, c.system_identifier::text AS sysid, current_setting('transaction_read_only') AS ro, now()::text AS at, (SELECT max(name) FROM afldb_meta.schema_migrations) AS ledger FROM pg_database d CROSS JOIN pg_control_system() c WHERE d.datname=current_database()`;
    if(identity.db!=='afldb_prod'||identity.oid!=='66668'||identity.sysid!=='7674454702926115004'||identity.ro!=='on') throw Error('production identity/read-only mismatch');
    out.identity = identity;
    out.adm1 = await tx`
      SELECT 'brownlow_round_votes' AS t, count(*)::int AS n FROM brownlow_round_votes b
       WHERE b.match_id IS NOT NULL AND b.votes > 0
         AND NOT EXISTS (SELECT 1 FROM player_match_stats p WHERE p.match_id = b.match_id AND p.player_id = b.player_id)
      UNION ALL
      SELECT 'player_achievements', count(*)::int FROM player_achievements a
       WHERE a.match_id IS NOT NULL AND a.player_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM player_match_stats p WHERE p.match_id = a.match_id AND p.player_id = a.player_id)
      UNION ALL
      SELECT 'after_siren_kicks', count(*)::int FROM after_siren_kicks a
       WHERE a.match_id IS NOT NULL AND a.player_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM player_match_stats p WHERE p.match_id = a.match_id AND p.player_id = a.player_id)`;
    out.adm2_inactive = await tx`SELECT entity_type, field_group, count(*)::int AS n FROM data_overrides
      WHERE NOT is_active AND entity_type IN ('coaches','draft_picks') GROUP BY 1,2 ORDER BY 1,2`;
    out.adm2_coach_retire_then_edit = await tx`SELECT count(*)::int AS coaches_with_retire,
         count(*) FILTER (WHERE last_edit > last_retire)::int AS edited_after_retire FROM (
        SELECT row_id, max(id) FILTER (WHERE new_values ? 'retired') AS last_retire, max(id) AS last_edit
          FROM data_edits WHERE table_name = 'coaches' AND field_group = 'identity'
         GROUP BY row_id HAVING count(*) FILTER (WHERE new_values ? 'retired') > 0) s`;
    out.ing1_seasons = await tx`SELECT year, status FROM seasons WHERE year >= 2025 ORDER BY year`;
    out.ing1_fixtures_2027 = await tx`SELECT count(*)::int AS fixtures FROM fixtures WHERE season = 2027`;
    out.ing1_clubs = await tx`SELECT count(*) FILTER (WHERE last_season = 2026)::int AS ended_2026, count(*) FILTER (WHERE last_season IS NULL OR last_season >= 2027)::int AS open FROM clubs WHERE is_current_afl_club`;
    out.ing2_dg_picks = await tx`SELECT count(*)::int AS n FROM draft_picks dp JOIN sources s ON s.id = dp.source_id WHERE s.key = 'draftguru'`;
    out.ing2_dg_persons_no_identity = await tx`SELECT count(*)::int AS n FROM draft_persons p JOIN sources s ON s.id = p.source_id WHERE s.key = 'draftguru' AND NOT EXISTS (SELECT 1 FROM external_identities e WHERE e.source_id = p.source_id AND e.external_id = p.player_url)`;
  });
  console.log(JSON.stringify(out));
} catch (e) { console.log('ERROR', String(e.message).replace(/postgres(ql)?:\/\/\S+/g,'<dsn>').slice(0,300)); }
finally { await sql.end(); }
JS
# end
