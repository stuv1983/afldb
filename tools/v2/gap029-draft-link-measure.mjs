/**
 * V2-GAP-029 / owner decision D2: READ-ONLY fingerprint of the DraftGuru draft-link surfaces.
 *
 *   AFLDB_GAP029_DSN=<read DSN> node tools/v2/gap029-draft-link-measure.mjs <out.json>
 *
 * It reads only (default_transaction_read_only on, one repeatable-read read-only transaction), never prints the DSN, and
 * writes the JSON exclusively. For `draft_persons`, `draft_picks` and the draftguru `external_identities` it records:
 *   - `nonlink`: a digest of every column EXCEPT the link columns (equal before and after a link-only import);
 *   - `link`: a digest of the link columns only (the expected value after a reviewed import is known from the rehearsal);
 *   - counts, link breakdowns by method/kind/year, the explicit admin decisions, and the draft-related import batches.
 * Compare a production run with the rehearsal's before/after files to prove (a) production equals the rehearsed starting
 * state and (b) the applied state equals the rehearsed end state.
 */
import { existsSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';

const out = process.argv[2];
const dsn = process.env.AFLDB_GAP029_DSN ?? process.env.AFLDB_TEST_DATABASE_URL ?? '';
if (!out || existsSync(out)) throw new Error('an output path that does not exist yet is required');
if (!dsn) throw new Error('AFLDB_GAP029_DSN is required');
const sql = postgres(dsn, { max: 1, connect_timeout: 5, onnotice: () => {}, connection: { default_transaction_read_only: true } });
const PERSON_LINK = "ARRAY['player_id','link_status','match_method','confidence_notes','is_matching_backlog']";
const PICK_LINK = "ARRAY['player_id','link_status_value','match_method','confidence_notes']";
const IDENTITY_LINK = "ARRAY['player_id','status','match_method']";
try {
  const report = await sql.begin('read only isolation level repeatable read', async (tx) => {
    const one = async (q) => (await tx.unsafe(q))[0];
    const many = (q) => tx.unsafe(q);
    return {
      database: (await one('select current_database() as d'))?.d,
      persons: await one(`SELECT count(*)::int n, count(player_id)::int linked, count(*) FILTER (WHERE is_matching_backlog)::int backlog,
        md5(string_agg((to_jsonb(t) - ${PERSON_LINK})::text, '|' ORDER BY id)) nonlink,
        md5(string_agg(concat_ws(',',id,player_id,link_status,match_method,is_matching_backlog), '|' ORDER BY id)) link FROM draft_persons t`),
      picks: await one(`SELECT count(*)::int n, count(player_id)::int linked, count(DISTINCT player_id)::int linked_players,
        md5(string_agg((to_jsonb(t) - ${PICK_LINK})::text, '|' ORDER BY id)) nonlink,
        md5(string_agg(concat_ws(',',id,player_id,link_status_value,match_method), '|' ORDER BY id)) link FROM draft_picks t`),
      identities: await one(`SELECT count(*)::int n, count(player_id)::int linked,
        md5(string_agg((to_jsonb(t) - ${IDENTITY_LINK})::text, '|' ORDER BY id)) nonlink,
        md5(string_agg(concat_ws(',',id,player_id,status,match_method), '|' ORDER BY id)) link
        FROM external_identities t WHERE source_id = (SELECT id FROM sources WHERE key = 'draftguru')`),
      afltablesRegistration: await one(`SELECT count(*)::int n FROM external_identities ei JOIN sources s ON s.id = ei.source_id AND s.key = 'afltables'
        WHERE ei.player_id IS NOT NULL AND ei.status::text IN ('unique','resolved') AND ei.match_method = 'afltables_profile_url'`),
      pickStatus: await many("SELECT link_status_value::text s, match_method m, count(*)::int n FROM draft_picks GROUP BY 1,2 ORDER BY 3 DESC"),
      byKind: await many('SELECT draft_kind::text k, count(*)::int n, count(player_id)::int linked FROM draft_picks GROUP BY 1 ORDER BY 1'),
      byYear: await many('SELECT draft_year y, count(*)::int n, count(player_id)::int linked FROM draft_picks GROUP BY 1 ORDER BY 1'),
      adminDecisions: await many("SELECT id, draft_year, draft_kind::text, pick_number, player_id, link_status_value::text, match_method FROM draft_picks WHERE match_method = 'draftguru_explicit_admin_decision' ORDER BY id"),
      batches: await many("SELECT id::text, tool, status::text, left(coalesce(notes,''),100) notes, left(coalesce(error,''),60) error FROM import_batches WHERE tool ILIKE '%draft%' ORDER BY id"),
    };
  });
  writeFileSync(out, `${JSON.stringify(report, null, 1)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ persons: report.persons, picks: report.picks, identities: report.identities }));
} finally {
  await sql.end({ timeout: 5 });
}
