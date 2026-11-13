set -euo pipefail
cd /home/arm/ops/gap029-stages/a25306f9/cand
export STEPG_DSN="$(sed -n 's/^AFLDB_BACKUP_DATABASE_URL=//p' /home/arm/projects/afldb/.env | tail -1 | sed 's/^"\(.*\)"$/\1/')"
/home/arm/.nvm/versions/node/v22.23.2/bin/node --input-type=module <<'JS'
import { createRequire } from 'node:module';
const require=createRequire('/home/arm/ops/gap029-stages/a25306f9/cand/package.json');
const postgres=require('postgres');
const sql = postgres(process.env.STEPG_DSN, { max: 1, connection: { default_transaction_read_only: true, TimeZone: 'Etc/UTC' } });

try {
  await sql.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (tx) => {
    const [identity] = await tx`SELECT current_database() AS db, d.oid::text AS oid, c.system_identifier::text AS sysid, current_setting('transaction_read_only') AS ro FROM pg_database d CROSS JOIN pg_control_system() c WHERE d.datname=current_database()`;
    if(identity.db!=='afldb_prod'||identity.oid!=='66668'||identity.sysid!=='7674454702926115004'||identity.ro!=='on') throw Error('production identity/read-only mismatch');
    const rows = await tx`
      SELECT dp.id, dp.draft_year::int AS year, dp.draft_type AS type, dp.draft_kind AS kind,
             dp.pick_number::int AS pick, dp.pick_note, dp.player_name_raw AS player, dp.player_id::int AS player_id,
             dp.link_status_value::text AS link, dp.club_name_raw AS club_raw, c.name AS club, c.slug AS club_slug,
             dp.signing, dp.signing_kind, so.key AS source, dp.player_url, dp.detail,
             dp.original_club_raw AS origin, dp.draft_age::int AS age, dp.height_cm::int AS height,
             p.display_name AS player_display
        FROM draft_picks dp
        LEFT JOIN clubs c ON c.id = dp.club_id
        LEFT JOIN sources so ON so.id = dp.source_id
        LEFT JOIN players p ON p.id = dp.player_id
       ORDER BY dp.id`;
    const overrides = await tx`
      SELECT field_group, count(*)::int AS n, count(*) FILTER (WHERE is_active)::int AS active,
             count(*) FILTER (WHERE is_active AND override_values ->> 'detail' LIKE 'V2-GAP-029;%')::int AS gap029
        FROM data_overrides WHERE entity_type = 'draft_picks' GROUP BY field_group ORDER BY field_group`;
    const fs = await tx`SELECT count(*)::int AS n FROM father_son_selections`;
    console.log(JSON.stringify({ identity, rows, overrides, fatherSonSelections: fs[0].n }));
    // console.log(`rows=${rows.length} overrides=${JSON.stringify(overrides)} father_son_selections=${fs[0].n}`);
  });
} finally {
  await sql.end();
}

JS
