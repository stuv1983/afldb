/** ISSUE-363 G-1 PROTOTYPE ONLY (2026-11-21), evidence tooling, not part of any rebuild, runbook, tool or test contract.
 *
 * The audited GAP-029 Rookie tool (tools/v2/gap029-rookie-selections-production.ts) is bound to PRODUCTION player ids
 * (`expectedPlayerId`, e.g. Henderson 8350), so on a rebuild clone it refuses ("resolves to player 8388, the reviewed identity is
 * 8350"), exactly as the GAP-029 label evidence is bound to production match ids. This prototype shows what a rebuild-keyed tier P
 * step would do: the SAME tracked entries (buildEntries over data/players/rookie-relisting-outcomes.csv, the tool's own derivation),
 * each player resolved on the target by its natural key (the AFL Tables profile, the tool's own readLive query, exactly one or refuse),
 * written by the SAME audited writer `createManualPickInTransaction` in ONE afldb_import transaction after the tool's own actor
 * assertion; any refusal throws and rolls everything back. Isolated afldb_v2_*_test targets only.
 *
 *   isolated-pg run <db> -- node --import tsx --conditions=react-server <this file> <actorUserId>     (cwd = the checkout)
 */
import { createRequire } from 'node:module';

import { createManualPickInTransaction } from '../cand/src/db/queries/admin-draft';
import { loadRookieRelistingOutcomes } from '../cand/tests/rookie-relisting-outcomes';
import { OUTCOMES_PATH, buildEntries } from '../cand/tools/v2/gap029-rookie-selections-production';
import { readFileSync } from 'node:fs';

const postgres = createRequire('/mnt/ssd/afldb-i363-20261121/cand/package.json')('postgres') as typeof import('postgres');

const owner = process.env.AFLDB_TEST_DATABASE_URL ?? '';
const importDsn = process.env.AFLDB_IMPORT_DATABASE_URL ?? '';
if (process.env.AFLDB_V2_ISOLATED_PG !== '1' || !/\/afldb_v2_[a-z0-9_]+_test$/.test(owner) || !/\/afldb_v2_[a-z0-9_]+_test$/.test(importDsn)) {
  throw new Error('isolated afldb_v2_*_test target required');
}
const actor = Number(process.argv[2]);
if (!Number.isInteger(actor) || actor < 1) throw new Error('actor user id required');
const entries = buildEntries(loadRookieRelistingOutcomes(readFileSync(OUTCOMES_PATH, 'utf8').replace(/\r\n/g, '\n')));
const writer = postgres(importDsn, { max: 1, onnotice: () => {} });
try {
  const result = await writer.begin(async (tx) => {
    const [who] = await tx<{ u: string }[]>`SELECT current_user AS u`;
    if (who.u !== 'afldb_import') throw new Error('the write connection must be the afldb_import role');
    await tx`SELECT public.assert_viable_super_admin_actor(${actor}::int)`;
    const out: { profile: string; productionPlayerId: number; targetPlayerId: number; pickId: number }[] = [];
    for (const e of entries) {
      const ids = await tx<{ id: number }[]>`SELECT DISTINCT ei.player_id::int AS id FROM external_identities ei JOIN sources so ON so.id = ei.source_id
        WHERE so.key = 'afltables' AND ei.match_method = 'afltables_profile_url' AND ei.status::text IN ('unique','resolved')
          AND ei.player_id IS NOT NULL AND ei.external_id = ${e.afltablesProfile}`;
      if (ids.length !== 1) throw new Error(`${e.afltablesProfile}: resolves to ${ids.length} players on this target, not exactly one`);
      const r = await createManualPickInTransaction(tx, { playerId: ids[0].id, adminUserId: actor, draftYear: e.draftEventYear, draftType: e.draftType,
        draftKind: e.draftKind, pickNumber: e.pick, clubSlug: e.clubSlug, detail: e.detail, note: e.correctionNote });
      if (!r.ok) throw new Error(`the audited editor path refused ${e.afltablesProfile}: ${'error' in r ? r.error : 'confirmation required'}`);
      out.push({ profile: e.afltablesProfile, productionPlayerId: e.expectedPlayerId, targetPlayerId: ids[0].id, pickId: r.pickId });
    }
    return out;
  });
  console.log(`rookie overlay: entries=${entries.length} written=${result.length} player_id_differs_from_production=${result.filter((x) => x.productionPlayerId !== x.targetPlayerId).length}`);
} finally { await writer.end(); }
