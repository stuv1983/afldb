/** Read-only historical medal reconciliation. Run with --conditions=react-server via isolated-pg. */
import { readFileSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';
import { postgresExecutor } from '@afldb/db';
import { determineBrownlowMedal, reconcileBrownlowSeason } from '@afldb/derived';
import { checkIsolatedTestDsn, checkIsolatedTestServer, ISOLATED_SERVER_FACTS_SQL } from '@afldb/domain';
import { loadBrownlowReconciliationInput } from '@/db/queries/brownlow-reconciliation-inputs';
import { loadBrownlowEligibilityEvidence } from '@/db/queries/brownlow-eligibility';

async function main() {
const dsn = process.env.AFLDB_TEST_DATABASE_URL ?? '';
const findings = checkIsolatedTestDsn(dsn, Number(process.env.AFLDB_V2_ISOLATED_PORT));
if (process.env.AFLDB_V2_ISOLATED_PG !== '1' || findings.length) throw new Error('Marked isolated runner required');
const database = decodeURIComponent(new URL(dsn).pathname.slice(1));
const sql = postgres(dsn, { max: 1, onnotice: () => {}, connection: { default_transaction_read_only: true } });
try {
  const [facts] = await sql.unsafe(ISOLATED_SERVER_FACTS_SQL);
  if (checkIsolatedTestServer(database, { clusterName: facts.cluster_name, databaseComment: facts.database_comment,
    currentDatabase: facts.current_database }).length) throw new Error('Live isolated identity proof failed');
  const registry = JSON.parse(readFileSync('data/reference/seasons.json', 'utf8'));
  const executor = postgresExecutor(sql);
  const seasons = await sql`SELECT DISTINCT season FROM brownlow_season_votes WHERE season <= ${registry.last_season} ORDER BY season`;
  const results = [];
  for (const { season } of seasons) {
    const input = await loadBrownlowReconciliationInput(executor, { season, registry,
      generatedAt: new Date().toISOString(), storedOnlyFallback: true });
    const report = reconcileBrownlowSeason(input);
    const evidence = await loadBrownlowEligibilityEvidence(executor, {
      season, playerIds: report.rawVotes.playerTotals.map((r) => r.playerId),
    });
    const determination = determineBrownlowMedal({ report, ...evidence });
    const storedWinners = (input.storedTotals ?? []).filter((r) => r.isWinner).map((r) => r.playerId).sort((a, b) => a - b);
    const winners = determination.winners.map((r) => r.playerId).sort((a, b) => a - b);
    results.push({ season, basis: determination.basis, status: determination.status, storedWinners, winners,
      agrees: determination.status === 'determined' ? JSON.stringify(winners) === JSON.stringify(storedWinners) : null,
      voteGetters: determination.rawLeaderboard.length, rawVotesTotal: determination.rawLeaderboard.reduce((n, r) => n + r.votes, 0),
      missingEligibility: determination.rawLeaderboard.filter((r) => r.eligibility.status === 'missing').length,
      review: determination.playersRequiringReview, blocking: determination.blockingFindings,
      inputChecksum: determination.inputChecksum });
  }
  const summary = { database, seasons: results.length, determined: results.filter((r) => r.status === 'determined').length,
    agree: results.filter((r) => r.agrees === true).length, disagree: results.filter((r) => r.agrees === false).length,
    unresolved: results.filter((r) => r.agrees === null).length,
    note: 'Authoritative local historical totals; stored_totals is NOT API parity. No votes, flags or decisions changed.' };
  const out = process.argv[2];
  if (!out) throw new Error('Output JSON path required');
  writeFileSync(out, `${JSON.stringify({ summary, results }, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify(summary));
} finally { await sql.end({ timeout: 5 }); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'Historical reconciliation failed'); process.exitCode = 1; });
