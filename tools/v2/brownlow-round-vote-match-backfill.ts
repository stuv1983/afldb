/**
 * Brownlow round-vote match_id backfill: plan | apply | reverse. ISOLATED DATABASES ONLY.
 *
 *   node --import tsx --conditions=react-server tools/v2/isolated-pg.ts run <db> -- \
 *     node --import tsx --conditions=react-server tools/v2/brownlow-round-vote-match-backfill.ts \
 *       plan --export <export.json> --report <report.json> [--seasons 2024,2025]
 *   ... apply   --export <export.json> --digest <sha256> [--report <report.json>]
 *   ... reverse --export <export.json> --digest <sha256> [--report <report.json>]
 *
 * Like tools/v2/brownlow-history.ts it requires the marked isolated runner (AFLDB_V2_ISOLATED_PG=1, a
 * test DSN naming the isolated cluster) and proves the live server identity before it reads anything.
 * It refuses any other database, so applying the reviewed correction to production is a SEPARATE step
 * that needs its own reviewed target arrangement (docs/v2/brownlow-round-vote-match-backfill-2026-10-20.md).
 *
 * `plan` is read-only (a read-only session). The export it writes is the reviewable artefact and
 * carries every repair id; it holds production-derived row identifiers when pointed at such a clone,
 * so keep it OUTSIDE Git. The report is counts and fingerprints only.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import postgres from 'postgres';

import { postgresExecutor } from '@afldb/db';
import { checkIsolatedTestDsn, checkIsolatedTestServer, ISOLATED_SERVER_FACTS_SQL } from '@afldb/domain';

import {
  applyRoundVoteMatchBackfill,
  exportOf,
  parseBackfillExport,
  planRoundVoteMatchBackfill,
  refreshBackfillStatistics,
  reverseRoundVoteMatchBackfill,
} from '@/db/queries/brownlow-round-vote-match-backfill';

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
      // Plan sessions are read-only, so statistics are refreshed on a separate writable connection of
      // this isolated database first (ANALYZE changes no table data; see refreshBackfillStatistics).
      const writer = postgres(dsn, { max: 1, onnotice: () => {} });
      try { await refreshBackfillStatistics(postgresExecutor(writer)); } finally { await writer.end({ timeout: 5 }); }
      const seasonsText = option('--seasons');
      const plan = await planRoundVoteMatchBackfill(executor, {
        seasons: seasonsText ? seasonsText.split(',').map((part) => Number(part)) : undefined,
      });
      writeFileSync(exportPath, `${JSON.stringify(exportOf(plan))}\n`, { flag: 'wx' });
      const { repairs, ...summary } = plan;
      const report = { database, ...summary, repairCount: repairs.length };
      if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
      console.log(JSON.stringify({ database, nullRows: plan.nullRows, repairable: plan.repairable, excluded: plan.excluded, digest: plan.digest }));
      return;
    }

    const reviewed = parseBackfillExport(JSON.parse(readFileSync(exportPath, 'utf8')));
    const request = { export: reviewed, expectedDigest: required('--digest'), expectedDatabase: database };
    const result = command === 'apply'
      ? await applyRoundVoteMatchBackfill(executor, request)
      : await reverseRoundVoteMatchBackfill(executor, request);
    if (reportPath) writeFileSync(reportPath, `${JSON.stringify({ command, ...result }, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ command, ...result }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Backfill failed');
  process.exitCode = 1;
});
