// AFLDB-ISSUE-336: read-only export of draft_picks from the isolated restore. Run via isolated-pg run <db> --.
import postgres from 'postgres';
import { writeFileSync } from 'node:fs';

if (process.env.AFLDB_V2_ISOLATED_PG !== '1') throw new Error('isolated launcher required');
const url = new URL(process.env.AFLDB_TEST_DATABASE_URL);
if (!/^\/afldb_v2_.+_test$/.test(url.pathname) || url.hostname !== '127.0.0.1') throw new Error('isolated target required');
const sql = postgres(process.env.AFLDB_TEST_DATABASE_URL, { max: 1 });
const out = process.argv[2];
try {
  await sql.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (tx) => {
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
    writeFileSync(out, JSON.stringify({ rows, overrides, fatherSonSelections: fs[0].n }));
    console.log(`rows=${rows.length} overrides=${JSON.stringify(overrides)} father_son_selections=${fs[0].n}`);
  });
} finally {
  await sql.end();
}
