/**
 * Brownlow legacy-ownership adoption: plan | apply | reverse. ISOLATED DATABASES ONLY.
 *
 *   node --import tsx --conditions=react-server tools/v2/isolated-pg.ts run <db> -- \
 *     node --import tsx --conditions=react-server tools/v2/brownlow-ownership-adoption.ts \
 *       plan --export <export.json> --report <report.json> [--seasons 2025]
 *   ... apply   --export <export.json> --digest <sha256> --decision "<owner decision reference>" [--report <report.json>]
 *   ... reverse --export <export.json> --digest <sha256> --decision "<owner decision reference>" [--report <report.json>]
 *
 * Same boundary as tools/v2/brownlow-round-vote-match-backfill.ts: the marked isolated runner, the live
 * server identity proof, no other database. There is no force flag. Applying the reviewed transition to
 * production is a SEPARATE owner decision and a separate, reviewed target arrangement
 * (docs/v2/brownlow-legacy-ownership-transition-2026-10-20.md). The export holds row ids and legacy
 * provenance, so keep it OUTSIDE Git; the report is counts and fingerprints only.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import postgres from 'postgres';

import { postgresExecutor } from '@afldb/db';
import { checkIsolatedTestDsn, checkIsolatedTestServer, ISOLATED_SERVER_FACTS_SQL } from '@afldb/domain';

import {
  adoptionExportOf,
  applyBrownlowOwnershipAdoption,
  parseAdoptionExport,
  planBrownlowOwnershipAdoption,
  reverseBrownlowOwnershipAdoption,
} from '@/db/queries/brownlow-legacy-ownership-adoption';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== 'plan' && command !== 'apply' && command !== 'reverse') throw new Error('usage: plan | apply | reverse');

  const dsn = process.env.AFLDB_TEST_DATABASE_URL ?? '';
  const findings = checkIsolatedTestDsn(dsn, Number(process.env.AFLDB_V2_ISOLATED_PORT));
  if (process.env.AFLDB_V2_ISOLATED_PG !== '1' || findings.length) throw new Error('Marked isolated runner required');
  const database = decodeURIComponent(new URL(dsn).pathname.slice(1));
  const sql = postgres(dsn, {
    max: 1, onnotice: () => {},
    ...(command === 'plan' ? { connection: { default_transaction_read_only: true } } : {}),
  });
  try {
    const [facts] = await sql.unsafe(ISOLATED_SERVER_FACTS_SQL);
    if (checkIsolatedTestServer(database, {
      clusterName: facts.cluster_name, databaseComment: facts.database_comment, currentDatabase: facts.current_database,
    }).length) throw new Error('Live isolated identity proof failed');
    const executor = postgresExecutor(sql);
    const exportPath = required('--export');
    const reportPath = option('--report');

    if (command === 'plan') {
      const seasonsText = option('--seasons');
      const plan = await planBrownlowOwnershipAdoption(executor, {
        seasons: seasonsText ? seasonsText.split(',').map((part) => Number(part)) : undefined,
      });
      writeFileSync(exportPath, `${JSON.stringify(adoptionExportOf(plan))}\n`, { flag: 'wx' });
      const { sets, ...summary } = plan;
      if (reportPath) writeFileSync(reportPath, `${JSON.stringify({ database, ...summary, setCount: sets.length }, null, 2)}\n`, { flag: 'wx' });
      console.log(JSON.stringify({
        database, stagedSets: plan.stagedSets, adoptable: plan.adoptable, alreadyAdopted: plan.alreadyAdopted,
        refused: plan.refused, refusedByCode: plan.refusedByCode, digest: plan.digest,
      }));
      return;
    }

    const reviewed = parseAdoptionExport(JSON.parse(readFileSync(exportPath, 'utf8')));
    const request = { export: reviewed, expectedDigest: required('--digest'), expectedDatabase: database, decision: required('--decision') };
    const result = command === 'apply'
      ? await applyBrownlowOwnershipAdoption(executor, request)
      : await reverseBrownlowOwnershipAdoption(executor, request);
    if (reportPath) writeFileSync(reportPath, `${JSON.stringify({ command, ...result }, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ command, ...result }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Ownership adoption failed');
  process.exitCode = 1;
});
