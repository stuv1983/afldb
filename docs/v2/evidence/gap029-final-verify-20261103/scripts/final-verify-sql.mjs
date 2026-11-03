// GAP-029 FINAL verification: targeted READ-ONLY checks of the four stages' resulting data on the fresh post-S4 restore, plus a differential against the retained
// post-S2 and post-S3 restores. Every connection is read-only (default_transaction_read_only) and the script issues SELECTs only.
// Usage (run from the pinned checkout so `postgres` resolves): node .final-verify-sql.mjs <final-db> <expect-dir> <post-S3-restore-db> <post-S2-restore-db>
//   env AFLDB_TEST_DATABASE_URL (set by the guarded runner) supplies host/credentials; only the database name is swapped.
import postgres from 'postgres';
import { readFileSync } from 'node:fs';

const [db, dir, s4db, s3db] = process.argv.slice(2);
const base = new URL(process.env.AFLDB_TEST_DATABASE_URL);
const open = (name) => { const u = new URL(base); u.pathname = `/${name}`; return postgres(u.toString(), { max: 1, onnotice: () => {}, connect_timeout: 10, connection: { default_transaction_read_only: true } }); };
let fails = 0;
const res = (ok, name, detail = '') => { if (!ok) fails += 1; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`); };
const info = (name, detail) => console.log(`INFO ${name} -- ${detail}`);
const plan = (f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
const sql = open(db);
try {
  const [id] = await sql`SELECT current_database() AS db, (SELECT max(name) FROM afldb_meta.schema_migrations) AS ledger, (SELECT count(*) FROM afldb_meta.schema_migrations)::int AS n, current_setting('transaction_read_only') AS ro`;
  info('restored database', JSON.stringify(id));
  res(id.db === db && id.ro === 'on' && id.n === 118, 'identity: guarded restored database, read-only session, ledger 118');

  // ---- S1: seven co-captain rows -------------------------------------------------------------------------------------------------------------------
  const p1 = plan('s1-plan.json');
  res(p1.entries.length === 7, 'S1 plan names exactly 7 entries', String(p1.entries.length));
  const batches1 = new Set();
  for (const e of p1.entries) {
    const rows = await sql`SELECT c.id::int AS id, c.season::int AS season, c.club_id::int AS club_id, c.player_id::int AS player_id, c.player_name_raw, c.link_status_value::text AS link,
        c.role, c.period, c.notes, c.import_batch_id::text AS batch, so.key AS source FROM captaincies c LEFT JOIN sources so ON so.id = c.source_id WHERE c.source_record_id = ${e.sourceKey}`;
    const r = rows[0];
    const ok = rows.length === 1 && r.season === e.season && r.club_id === e.clubId && r.player_id === e.playerId && r.role === e.role && r.period === e.period && r.notes === e.note && ['unique', 'resolved'].includes(r.link) && r.batch !== null;
    if (r?.batch) batches1.add(r.batch);
    res(ok, `S1 ${e.season} ${e.club} ${e.player}`, ok ? `id ${r.id} source ${r.source} batch ${r.batch} name_raw "${r.player_name_raw}"` : JSON.stringify({ n: rows.length, r }).slice(0, 400));
  }
  res(batches1.size === 1, 'S1 all seven rows carry one import batch', [...batches1].join(','));
  const [cap] = await sql`SELECT count(*)::int AS n, count(DISTINCT (season, club_id, player_name_raw, role))::int AS nat FROM captaincies`;
  res(cap.n === 1781 && cap.nat === cap.n, 'S1 captaincies total 1781 (1774 + 7), natural keys unique', JSON.stringify(cap));

  // ---- S3: eight audited rookie selections, their overrides and correction notes ---------------------------------------------------------------------
  const p3 = plan('s3-plan.json');
  res(p3.entries.length === 8 && p3.actorUserId === 1, 'S3 plan names exactly 8 selections as actor 1', String(p3.entries.length));
  for (const e of p3.entries) {
    const picks = await sql`SELECT dp.id::int AS id, dp.draft_year::int AS year, dp.pick_number::int AS pick, dp.club_id::int AS club_id, dp.player_id::int AS player_id, dp.draft_kind::text AS kind,
        dp.draft_type, dp.detail, so.key AS source FROM draft_picks dp LEFT JOIN sources so ON so.id = dp.source_id WHERE dp.player_id = ${e.playerId} AND dp.draft_year = ${e.draftEventYear} AND dp.draft_kind::text = 'rookie'`;
    const k = picks[0];
    const pickOk = picks.length === 1 && k.pick === e.pick && k.club_id === e.clubId && k.draft_type === 'Rookie' && k.detail === e.detail && k.source === 'manual_admin_edit';
    res(pickOk, `S3 pick ${e.draftEventYear} #${e.pick} ${e.player} (${e.clubName})`, pickOk ? `draft_picks id ${k.id}` : JSON.stringify({ n: picks.length, k }).slice(0, 300));
    const ov = await sql`SELECT id::int AS id, admin_user_id::int AS admin, is_active, entity_key, field_group, override_values FROM data_overrides WHERE entity_type = 'draft_picks' AND field_group = 'selection' AND override_values ->> 'detail' = ${e.detail}`;
    const o = ov[0];
    const ovOk = ov.length === 1 && o.is_active === true && o.admin === 1 && o.override_values.draft_kind === 'rookie';
    res(ovOk, `S3 override ${e.player}`, ovOk ? `data_overrides id ${o.id} actor ${o.admin} key ${o.entity_key}` : JSON.stringify({ n: ov.length, o }).slice(0, 300));
    const ed = await sql`SELECT id::int AS id, admin_user_id::int AS admin, row_id::int AS row_id FROM data_edits WHERE table_name = 'players' AND field_group = 'draft_selection' AND row_id = ${e.playerId} AND note = ${e.correctionNote}`;
    const edOk = ed.length === 1 && ed[0].admin === 1;
    res(edOk, `S3 correction note ${e.player}`, edOk ? `data_edits id ${ed[0].id} actor ${ed[0].admin}` : `rows ${ed.length}`);
  }
  const [ne] = await sql`SELECT count(*)::int AS n, count(DISTINCT row_id)::int AS players, min(admin_user_id)::int AS amin, max(admin_user_id)::int AS amax FROM data_edits WHERE table_name = 'players' AND field_group = 'draft_selection' AND note LIKE 'V2-GAP-029 owner-approved correction%'`;
  res(ne.n === 8 && ne.players === 8 && ne.amin === 1 && ne.amax === 1, 'S3 exactly 8 reviewed correction notes, 8 players, actor 1 only', JSON.stringify(ne));
  const [no] = await sql`SELECT count(*)::int AS n FROM data_overrides WHERE entity_type = 'draft_picks' AND field_group = 'selection' AND is_active AND admin_user_id = 1 AND override_values ->> 'detail' LIKE 'V2-GAP-029;%' AND override_values ->> 'draft_kind' = 'rookie'`;
  res(no.n === 8, 'S3 exactly 8 active selection overrides name actor 1', String(no.n));
  const [dp] = await sql`SELECT count(*)::int AS n, count(*) FILTER (WHERE link_status_value::text IN ('unique','resolved'))::int AS linked FROM draft_picks`;
  res(dp.n === 6818, 'S3 draft_picks total 6818 (6810 + 8)', JSON.stringify(dp));

  // ---- batches (information) ----------------------------------------------------------------------------------------------------------------------
  const [ib] = await sql`SELECT count(*)::int AS n, max(id)::text AS max_id FROM import_batches`;
  info('import_batches', JSON.stringify(ib));

  // ---- differential: nothing outside a stage's write set changed after that stage ---------------------------------------------------------------------
  const probes = {
    captaincies: `SELECT count(*)::int AS n, md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY id), '')) AS d FROM captaincies t`,
    draft_persons: `SELECT count(*)::int AS n, md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY id), '')) AS d FROM draft_persons t`,
    external_identities: `SELECT count(*)::int AS n, md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY id), '')) AS d FROM external_identities t`,
    draft_picks: `SELECT count(*)::int AS n, md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY id), '')) AS d FROM draft_picks t`,
    draft_overrides: `SELECT count(*)::int AS n, md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY id), '')) AS d FROM data_overrides t WHERE entity_type = 'draft_picks'`,
    data_edits: `SELECT count(*)::int AS n, md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY id), '')) AS d FROM data_edits t`,
    sibling_rows_ex_new: `SELECT count(*)::int AS n, md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY id), '')) AS d FROM player_relationships t WHERE source_record_id IS DISTINCT FROM 'siblings:afldb-sibling-supplement:015' AND source_record_id LIKE 'siblings:%'`,
  };
  const measure = async (name) => { const s = open(name); try { const out = {}; for (const [k, q] of Object.entries(probes)) out[k] = (await s.unsafe(q))[0]; return out; } finally { await s.end({ timeout: 5 }); } };
  const fin = await measure(db); const post3 = await measure(s4db); const post2 = await measure(s3db);
  // final vs the post-S3 restore (taken just before S4): S4 changed only the sibling rows (+1) and import_batches
  for (const k of ['captaincies', 'draft_persons', 'external_identities', 'draft_picks', 'draft_overrides', 'data_edits', 'sibling_rows_ex_new']) {
    res(fin[k].n === post3[k].n && fin[k].d === post3[k].d, `persisted through S4: ${k} identical to the post-S3 restore`, `${fin[k].n} rows vs ${post3[k].n}`);
  }
  // post-S3 restore vs the post-S2 restore (taken just before S3): S3 must not have touched the S1/S2 surfaces
  for (const k of ['captaincies', 'draft_persons', 'external_identities']) {
    res(post3[k].n === post2[k].n && post3[k].d === post2[k].d, `S3 left ${k} untouched (post-S3 restore equals post-S2 restore)`, `${post3[k].n} rows vs ${post2[k].n}`);
  }
  info('S3 surface growth (post-S2 restore -> final)', JSON.stringify({ draft_picks: [post2.draft_picks.n, fin.draft_picks.n], draft_overrides: [post2.draft_overrides.n, fin.draft_overrides.n] }));
} finally { await sql.end({ timeout: 5 }); }
console.log(fails === 0 ? 'SQL VERIFICATION PASS' : `SQL VERIFICATION FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
