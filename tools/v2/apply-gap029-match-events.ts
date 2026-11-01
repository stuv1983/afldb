/** V2-GAP-029: apply the reviewed marquee-match event labels through the audited Data Editor writer.
 *
 * Isolated databases only (the guarded launcher sets AFLDB_V2_ISOLATED_PG=1). Defaults to a read-only plan.
 * --apply writes each label with the editor's own `saveEdit` (matches / match_event), so every change keeps
 * its `data_overrides` replay row and its `data_edits` audit row. The whole plan is validated BEFORE the first
 * write: every match id must still carry the expected season, date, round, clubs and final scores and a NULL
 * event (or already the intended label, which makes a re-run idempotent). Nothing is inferred from dates or
 * clubs here: the evidence file names each match id.
 *
 *   node tools/v2/isolated-pg.ts run <db> -- node --conditions=react-server tsx tools/v2/apply-gap029-match-events.ts \
 *        [--apply] [--report=<path>] [--evidence=<path>]
 */
import 'server-only';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';
import { checkIsolatedTestDsn, checkIsolatedTestServer } from '@afldb/domain';
import { saveEdit } from '../../src/db/queries/data-edits';
import { sql as appSql } from '../../src/db/client';

const dsn = process.env.AFLDB_TEST_DATABASE_URL ?? '';
const port = Number(process.env.AFLDB_V2_ISOLATED_PORT);
if (process.env.AFLDB_V2_ISOLATED_PG !== '1' || checkIsolatedTestDsn(dsn, port).length) throw new Error('Guarded isolated target required');
const apply = process.argv.includes('--apply');
const argOf = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const evidencePath = argOf('evidence') ?? 'docs/v2/evidence/gap-029-match-event-correction-2026-11-01-r2.json';
const reportPath = argOf('report');

interface Entry {
  family: string; label: string; year: number; matchId: number;
  expect: { season: number; matchDate: string; roundCode: string; venueRaw: string | null; homeClub: string; awayClub: string; homeScore: number; awayScore: number };
}
const raw = readFileSync(evidencePath);
const evidence = JSON.parse(raw.toString('utf8')) as { entries: Entry[]; counts: Record<string, number> };
const sql = postgres(dsn, { max: 1, onnotice: () => {} });

interface Row { id: number; season: number; match_date: string; round_code: string; venue_raw: string | null; hn: string; an: string; hs: number; aws: number; match_event: string | null }
async function read(ids: number[]): Promise<Map<number, Row>> {
  const rows = await sql<Row[]>`
    SELECT m.id, m.season::int AS season, m.match_date::text AS match_date, m.round_code, m.venue_raw,
           hc.name AS hn, ac.name AS an, m.home_score::int AS hs, m.away_score::int AS aws, m.match_event
      FROM matches m JOIN clubs hc ON hc.id = m.home_club_id JOIN clubs ac ON ac.id = m.away_club_id
     WHERE m.id = ANY(${ids})`;
  return new Map(rows.map((r) => [r.id, r]));
}

async function main() {
  try {
    const [facts] = await sql`SELECT current_database() AS database, current_setting('cluster_name') AS cluster,
      shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname = current_database()`;
    if (checkIsolatedTestServer(new URL(dsn).pathname.slice(1), {
      currentDatabase: facts.database, clusterName: facts.cluster, databaseComment: facts.marker,
    }).length) throw new Error('Live isolated identity mismatch');

    const entries = evidence.entries;
    if (new Set(entries.map((e) => e.matchId)).size !== entries.length) throw new Error('Duplicate match id in the evidence');
    const labels = new Set(["Anzac Day", "Dreamtime at the 'G", "King's Birthday"]);
    if (entries.some((e) => !labels.has(e.label))) throw new Error('Unrecognised label in the evidence');
    const current = await read(entries.map((e) => e.matchId));

    // 1. Validate the WHOLE plan before any write.
    const plan = entries.map((e) => {
      const r = current.get(e.matchId);
      if (!r) throw new Error(`Match ${e.matchId} not found`);
      const x = e.expect;
      const same = r.season === x.season && r.match_date === x.matchDate && r.round_code === x.roundCode
        && r.hn === x.homeClub && r.an === x.awayClub && r.hs === x.homeScore && r.aws === x.awayScore;
      if (!same) throw new Error(`Match ${e.matchId} no longer has the expected identity (${JSON.stringify(r)})`);
      if (r.match_event !== null && r.match_event !== e.label) throw new Error(`Match ${e.matchId} already carries a different event: ${r.match_event}`);
      return { e, before: r.match_event, action: r.match_event === e.label ? 'already labelled' : 'to label' };
    });

    // 2. Apply through the audited editor writer, one transaction per match (its own).
    let actorId: number | null = null;
    if (apply && plan.some((p) => p.action === 'to label')) {
      const [actor] = await sql<{ id: number }[]>`INSERT INTO auth_users (email, role)
        VALUES ('v2-gap-029-event-correction@example.invalid', 'super_admin')
        ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`;
      actorId = actor.id;
    }
    const results: unknown[] = [];
    for (const p of plan) {
      const outcome = p.action === 'already labelled' ? 'already labelled' : apply ? 'written' : 'planned';
      if (apply && p.action === 'to label') {
        const result = await saveEdit({
          entityKey: 'matches', rowId: p.e.matchId, groupKey: 'match_event',
          raw: { match_event: p.e.label }, adminUserId: actorId!,
          note: `V2-GAP-029: ${p.e.label} ${p.e.year} named by first-party club/league sources; see ${evidencePath}`,
        });
        if (!result.ok) throw new Error(`Audited writer refused match ${p.e.matchId}: ${result.error}`);
      }
      results.push({ matchId: p.e.matchId, family: p.e.family, year: p.e.year, date: p.e.expect.matchDate, before: p.before, label: p.e.label, outcome });
    }

    // 3. Verify.
    const after = await read(entries.map((e) => e.matchId));
    const verified = apply ? entries.every((e) => after.get(e.matchId)?.match_event === e.label) : null;
    const distribution = await sql`SELECT match_event, count(*)::int AS n FROM matches WHERE match_event IS NOT NULL GROUP BY 1 ORDER BY 1`;
    const audit = apply ? await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM data_edits WHERE table_name = 'matches' AND field_group = 'match_event' AND row_id = ANY(${entries.map((e) => e.matchId)})` : null;
    const overrides = apply ? await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM data_overrides WHERE entity_type = 'matches' AND field_group = 'match_event' AND is_active` : null;
    const report = {
      database: facts.database, apply, planned: plan.length, counts: evidence.counts, verified,
      auditRows: audit?.[0]?.n ?? null, activeOverrides: overrides?.[0]?.n ?? null,
      labelledAfter: distribution, evidenceSha256: createHash('sha256').update(raw).digest('hex'), results,
    };
    if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ ...report, results: undefined, resultCount: results.length }));
    if (apply && !verified) throw new Error('Post-write verification failed');
  } finally { await sql.end(); await appSql.end(); }
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Event label correction failed');
  process.exitCode = 1;
});
