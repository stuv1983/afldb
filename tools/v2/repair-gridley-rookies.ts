/** GAP-029: replay the already-reviewed rookie coverage records through the audited manual writer.
 * Isolated databases only. Defaults to a read-only plan; --apply persists each selection atomically.
 * Never edits DraftGuru-owned facts or identifies a player by name.
 */
import 'server-only';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';
import { checkIsolatedTestDsn, checkIsolatedTestServer } from '@afldb/domain';
import { createManualPick } from '../../src/db/queries/admin-draft';
import { sql as appSql } from '../../src/db/client';
import { loadRookieRelistingOutcomes } from '../../tests/rookie-relisting-outcomes';

const dsn = process.env.AFLDB_TEST_DATABASE_URL ?? '';
const port = Number(process.env.AFLDB_V2_ISOLATED_PORT);
if (process.env.AFLDB_V2_ISOLATED_PG !== '1' || checkIsolatedTestDsn(dsn, port).length) throw new Error('Guarded isolated target required');
const sql = postgres(dsn, { max: 1, onnotice: () => {} });
const apply = process.argv.includes('--apply');
const output = process.argv.find((arg) => arg.startsWith('--report='))?.slice('--report='.length);
const clubSlugs: Record<string, string> = {
  'St Kilda': 'st-kilda', Geelong: 'geelong', 'Greater Western Sydney': 'greater-western-sydney',
  Sydney: 'sydney', Adelaide: 'adelaide', 'Gold Coast': 'gold-coast',
};
async function main() {
try {
  const [facts] = await sql`SELECT current_database() AS database, current_setting('cluster_name') AS cluster,
    shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname = current_database()`;
  if (checkIsolatedTestServer(new URL(dsn).pathname.slice(1), {
    currentDatabase: facts.database, clusterName: facts.cluster, databaseComment: facts.marker,
  }).length) throw new Error('Live isolated identity mismatch');
  const outcomes = loadRookieRelistingOutcomes();
  if (outcomes.length !== 8 || outcomes.some((row) => row.verdict !== 'gridley_supported')) throw new Error('Reviewed rookie population changed');
  // Resolve and validate the entire plan before any mutation.
  const plan = [];
  for (const row of outcomes) {
    const players = await sql<{ id: number }[]>`SELECT DISTINCT ei.player_id AS id
      FROM external_identities ei JOIN sources s ON s.id = ei.source_id
      WHERE s.key = 'afltables' AND ei.external_id = ${row.afltablesProfile}
        AND ei.status IN ('unique', 'resolved') AND ei.player_id IS NOT NULL`;
    if (players.length !== 1 || !clubSlugs[row.eventClub]) throw new Error(`Unresolved stable identity or club: ${row.afltablesProfile}`);
    const picks = await sql<{ id: number; pick: number | null; club: string; detail: string | null }[]>`
      SELECT dp.id, dp.pick_number AS pick, c.slug AS club, dp.detail FROM draft_picks dp
      JOIN clubs c ON c.id = dp.club_id
      WHERE dp.player_id = ${players[0].id} AND dp.draft_year = ${row.eventYear} AND dp.draft_kind = 'rookie'`;
    if (picks.length > 1 || picks.some((p) => p.pick !== row.pick || p.club !== clubSlugs[row.eventClub])) throw new Error(`Conflicting selection: ${row.afltablesProfile}`);
    plan.push({ row, playerId: players[0].id, existingPick: picks[0]?.id ?? null });
  }
  let actorId: number | null = null;
  if (apply && plan.some((item) => item.existingPick === null)) {
    const [actor] = await sql<{ id: number }[]>`INSERT INTO auth_users (email, role)
      VALUES ('v2-gap-029-reference-repair@example.invalid', 'super_admin')
      ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`;
    actorId = actor.id;
  }
  const results = [];
  for (const item of plan) {
    const { row } = item;
    let pickId = item.existingPick;
    if (apply && pickId === null) {
      const result = await createManualPick({ playerId: item.playerId, adminUserId: actorId!,
        draftYear: row.eventYear, draftType: 'Rookie', draftKind: 'rookie', pickNumber: row.pick,
        clubSlug: clubSlugs[row.eventClub], confirmed: true,
        detail: `V2-GAP-029; ${row.reference}; evidence strength=${row.evidenceStrength}; ${row.evidence}`,
        note: `V2-GAP-029: recover reviewed rookie coverage, ${row.afltablesProfile}; ${row.reference}`,
      });
      if (!result.ok) throw new Error(`Audited writer refused ${row.afltablesProfile}: ${result.error}`);
      pickId = result.pickId;
    }
    results.push({ profile: row.afltablesProfile, eventYear: row.eventYear, club: row.eventClub,
      pick: row.pick, evidenceStrength: row.evidenceStrength, action: item.existingPick !== null ? 'already present' : apply ? 'created through createManualPick' : 'planned', pickId });
  }
  const report = { database: facts.database, apply, records: results,
    source: 'data/players/rookie-relisting-outcomes.csv',
    sourceSha256: createHash('sha256').update(readFileSync('data/players/rookie-relisting-outcomes.csv')).digest('hex') };
  if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report));
} finally { await sql.end(); await appSql.end(); }
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Rookie repair failed');
  process.exitCode = 1;
});
