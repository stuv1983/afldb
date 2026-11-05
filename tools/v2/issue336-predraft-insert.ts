/**
 * AFLDB-ISSUE-336 — bounded, insert-only repair of the 35 DraftGuru Pre-Draft rows that the
 * owner-supplied CSV exports and the live DraftGuru year pages carry but `draft_picks` lacks.
 *
 *   node --import tsx tools/v2/issue336-predraft-insert.ts <plan.json> --plan-sha256 <hex>
 *        [--apply] [--accept-signing-head "Intl Schol"]
 *
 * Without --apply the whole write runs inside a transaction that is ROLLED BACK (dry run) and
 * the explicit differences are printed. With --apply it commits. It refuses:
 *   - any target that is not an isolated `afldb_v2_*_test` database (no production or DEV path
 *     exists in this tool; a production run needs its own reviewed approval and a new tool gate);
 *   - a plan whose sha256 differs from --plan-sha256;
 *   - a signing head outside the stored vocabulary unless it is explicitly accepted (D-336-1);
 *   - a row whose reload key (source, player_url, draft_year, draft_kind) already exists;
 *   - any change to a pre-existing draft_picks / draft_persons row (digest compared after the write).
 *
 * Identity: a person is the DraftGuru person URL, never a name. A URL already stored keeps its
 * draft_persons row and that row's link; a new URL becomes a new, UNMATCHED person (player_id
 * NULL). Nothing is matched by name. No career statistic, height or award is written from the
 * CSV: reported_games/goals stay NULL and height/age come from the live page's own cells.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import postgres from 'postgres';

type PlanRow = {
  draft_year: number; event_type_raw: string; player_name_raw: string; player_url: string;
  club_name_raw: string; club_slug_source: string | null; signing_raw: string | null;
  pick_number: number | null; pick_note_raw: string | null; age_raw: string | null;
  height_raw: string | null; original_club_raw: string | null; source_url: string; row_index: number;
};
type Plan = { format: string; draftguru_pages: Record<string, { sha256: string; fetched_at_utc: string }>; rows: PlanRow[] };

const args = process.argv.slice(2);
const planPath = args[0];
const opt = (name: string) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; };
const apply = args.includes('--apply');
const accepted = new Set(args.flatMap((a, i) => (a === '--accept-signing-head' ? [args[i + 1]] : [])));

if (!planPath) throw new Error('usage: issue336-predraft-insert.ts <plan.json> --plan-sha256 <hex> [--apply]');
const body = readFileSync(planPath);
const sha = createHash('sha256').update(body).digest('hex');
if (sha !== opt('--plan-sha256')) throw new Error(`plan sha256 ${sha} does not match --plan-sha256`);
const plan = JSON.parse(body.toString('utf8')) as Plan;
if (plan.format !== 'afldb.issue336.predraft-insert-plan.1' || plan.rows.length !== 35) throw new Error('unexpected plan shape');

if (process.env.AFLDB_V2_ISOLATED_PG !== '1') throw new Error('isolated launcher required');
const dsn = process.env.AFLDB_TEST_IMPORT_DATABASE_URL ?? '';
const url = new URL(dsn);
if (!/^\/afldb_v2_.+_test$/.test(url.pathname) || url.hostname !== '127.0.0.1') throw new Error('isolated _test target required');

const clubContract = JSON.parse(readFileSync('tools/rebuild/draftguru/draftguru-contract.json', 'utf8')) as {
  club_resolution: { deliberate_null: { club_slug: string }[] };
};
const DELIBERATE_NULL_CLUBS = new Set(clubContract.club_resolution.deliberate_null.map((d) => d.club_slug));

const leadingInt = (raw: string | null) => { const m = raw ? /^\s*(\d+)/.exec(raw) : null; return m ? Number(m[1]) : null; };
const signingHead = (raw: string | null) => (raw === null ? null : raw.replace(/\s*\(.*$/s, '').trim());
const nameKey = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

const sql = postgres(dsn, { max: 1, onnotice: () => {} });
type Tx = postgres.TransactionSql;
const DIGEST = (tx: Tx, table: 'draft_picks' | 'draft_persons', maxId: number) =>
  tx<{ n: number; d: string }[]>`SELECT count(*)::int AS n, md5(string_agg(t::text, '|' ORDER BY t.id)) AS d FROM ${tx(table)} t WHERE t.id <= ${maxId}`;

class DryRun extends Error {}

async function main(): Promise<void> {
try {
  await sql.begin('ISOLATION LEVEL REPEATABLE READ', async (tx) => {
    const [{ id: sourceId }] = await tx<{ id: number }[]>`SELECT id FROM sources WHERE key = 'draftguru'`;
    const vocab = new Set((await tx<{ k: string }[]>`SELECT DISTINCT signing_kind AS k FROM draft_picks WHERE signing_kind IS NOT NULL`).map((r) => r.k));
    const [{ maxPick }] = await tx<{ maxPick: number }[]>`SELECT max(id)::int AS "maxPick" FROM draft_picks`;
    const [{ maxPerson, maxRank }] = await tx<{ maxPerson: number; maxRank: number }[]>`
      SELECT max(id)::int AS "maxPerson", max(dg_person_id)::int AS "maxRank" FROM draft_persons WHERE source_id = ${sourceId}`;
    const before = { picks: (await DIGEST(tx, 'draft_picks', maxPick))[0], persons: (await DIGEST(tx, 'draft_persons', maxPerson))[0] };
    const clubs = new Map((await tx<{ slug: string; id: number }[]>`SELECT slug, id FROM clubs`).map((c) => [c.slug, c.id]));
    const overridesBefore = await tx`SELECT md5(string_agg(o::text, '|' ORDER BY o.id)) AS d, count(*)::int AS n FROM data_overrides o WHERE entity_type = 'draft_picks'`;

    const unknownHeads = [...new Set(plan.rows.map((r) => signingHead(r.signing_raw)).filter((h): h is string => h !== null && !vocab.has(h)))];
    const refused = unknownHeads.filter((h) => !accepted.has(h));
    if (refused.length > 0) throw new Error(`signing head(s) outside the stored vocabulary need an explicit decision (D-336-1): ${refused.join(', ')}`);

    let rank = maxRank;
    const created: string[] = []; const reused: string[] = [];
    for (const r of plan.rows) {
      if (r.event_type_raw !== 'Pre-Draft' || r.pick_number !== null) throw new Error(`row ${r.player_url}: not an unnumbered Pre-Draft row`);
      const clash = await tx`SELECT id FROM draft_picks WHERE source_id = ${sourceId} AND player_url = ${r.player_url}
                              AND draft_year = ${r.draft_year} AND draft_kind = 'pre_draft'`;
      if (clash.length > 0) throw new Error(`row ${r.player_url} ${r.draft_year}: reload key already stored (id ${clash[0].id})`);
      // The importer's reviewed club rules: an exact clubs.slug, or a contract-declared deliberate
      // NULL ('brisbane' spans the Bears and the Lions), else refuse. Never by name or alias.
      const clubId = r.club_slug_source ? clubs.get(r.club_slug_source) : undefined;
      if (r.club_slug_source && clubId === undefined && !DELIBERATE_NULL_CLUBS.has(r.club_slug_source)) {
        throw new Error(`club slug ${r.club_slug_source} is neither a clubs.slug nor a reviewed deliberate NULL`);
      }

      let [person] = await tx<{ id: number; dg_person_id: number; player_id: number | null; link_status: string; match_method: string | null; confidence_notes: string | null }[]>`
        SELECT id, dg_person_id, player_id, link_status::text AS link_status, match_method, confidence_notes
          FROM draft_persons WHERE source_id = ${sourceId} AND player_url = ${r.player_url}`;
      if (person) {
        reused.push(`${r.player_url} -> person ${person.id} (${person.link_status}${person.player_id ? `, player ${person.player_id}` : ''})`);
      } else {
        rank += 1;
        const display = r.player_name_raw;
        [person] = await tx`
          INSERT INTO draft_persons (source_id, dg_person_id, player_url, display_name_raw, name_key, player_id,
                                     link_status, candidate_count, match_method, confidence_notes,
                                     reported_games, reported_goals, is_matching_backlog)
          VALUES (${sourceId}, ${rank}, ${r.player_url}, ${display}, ${nameKey(display)}, NULL, 'unmatched', 0, NULL,
                  ${'AFLDB-ISSUE-336 bounded insert: identity unresolved; dg_person_id assigned past the stored maximum and renumbered by the next full reload'},
                  NULL, NULL, false)
          RETURNING id, dg_person_id, player_id, link_status::text AS link_status, match_method, confidence_notes`;
        created.push(`${r.player_url} -> new person ${person.id} (unmatched)`);
      }
      const page = plan.draftguru_pages[String(r.draft_year)];
      await tx`
        INSERT INTO draft_picks (draft_year, draft_type, draft_kind, pick_number, pick_note, player_id, player_name_raw,
                                 link_status_value, candidate_count, match_method, confidence_notes, club_id, club_name_raw,
                                 original_club_raw, draft_age, height_cm, signing, signing_kind, detail, source_id,
                                 source_record_id, draft_person_id, dg_person_id, player_url)
        VALUES (${r.draft_year}, 'Pre-Draft', 'pre_draft', NULL, ${r.pick_note_raw}, ${person.player_id}, ${r.player_name_raw},
                ${person.link_status}, 0, ${person.match_method},
                ${`AFLDB-ISSUE-336 bounded insert from ${r.source_url} (fetched ${page.fetched_at_utc}, sha256 ${page.sha256.slice(0, 16)})`},
                ${clubId ?? null}, ${r.club_name_raw}, ${r.original_club_raw}, ${leadingInt(r.age_raw)}, ${leadingInt(r.height_raw)},
                ${r.signing_raw}, ${signingHead(r.signing_raw)}, NULL, ${sourceId},
                ${`${r.source_url}#${r.row_index}`}, ${person.id}, ${person.dg_person_id}, ${r.player_url})`;
    }

    const after = { picks: (await DIGEST(tx, 'draft_picks', maxPick))[0], persons: (await DIGEST(tx, 'draft_persons', maxPerson))[0] };
    const overridesAfter = await tx`SELECT md5(string_agg(o::text, '|' ORDER BY o.id)) AS d, count(*)::int AS n FROM data_overrides o WHERE entity_type = 'draft_picks'`;
    const [{ newPicks }] = await tx<{ newPicks: number }[]>`SELECT count(*)::int AS "newPicks" FROM draft_picks WHERE id > ${maxPick}`;
    const [{ newPersons }] = await tx<{ newPersons: number }[]>`SELECT count(*)::int AS "newPersons" FROM draft_persons WHERE id > ${maxPerson}`;
    const checks = {
      pre_existing_picks_unchanged: before.picks.d === after.picks.d && before.picks.n === after.picks.n,
      pre_existing_persons_unchanged: before.persons.d === after.persons.d && before.persons.n === after.persons.n,
      draft_overrides_unchanged: overridesBefore[0].d === overridesAfter[0].d,
      new_picks_35: newPicks === 35,
      new_persons_match_plan: newPersons === created.length,
    };
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', planSha256: sha, acceptedSigningHeads: [...accepted],
      unknownHeadsAccepted: unknownHeads, newPicks, newPersons, reusedPersons: reused, createdPersons: created.length, checks }, null, 1));
    if (!Object.values(checks).every(Boolean)) throw new Error('post-write checks failed; rolled back');
    if (!apply) throw new DryRun('dry run: rolled back');
  });
  console.log('COMMITTED');
} catch (e) {
  if (e instanceof DryRun) console.log('ROLLED BACK (dry run)');
  else { console.error(String((e as Error).message).replace(/postgres(ql)?:\/\/\S+/g, '<dsn>')); process.exitCode = 1; }
} finally {
  await sql.end();
}
}

void main();
