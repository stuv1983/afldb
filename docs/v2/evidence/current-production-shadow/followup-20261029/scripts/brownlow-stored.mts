/**
 * D-V2-CURRENT-SHADOW-FOLLOWUP-1 item 5: the complete stored-only Brownlow report set for every season in
 * brownlow_season_votes, the alternative used by D-V2-BROWNLOW-ALT-1/-2. It is NOT the staged comparator.
 *
 * Reuses, unchanged, the verified c478c31b read path: shadow-award-reports' read-only session (one REPEATABLE
 * READ READ ONLY transaction on a default_transaction_read_only connection, state read back, SELECT-only guard,
 * always rolled back), loadBrownlowReconciliationInput with storedOnlyFallback, reconcileBrownlowSeason, and the
 * report validator/serialiser. Fixed report time and the unchanged season registry, so a before/after pair can
 * be byte-identical. The report file names no database; identity facts go to the separate meta file.
 * Run from the source root under `isolated-pg run <db>`:
 *   node --import tsx --conditions=react-server brownlow-stored.mts <archiveSha256> <reportOut> <metaOut>
 * A season that fails is a finding in `errors`, never dropped. Output files are created exclusively.
 */
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = process.cwd();
const tool = await import(join(SRC, 'tools/v2/shadow-award-reports.ts'));
const loader = await import(join(SRC, 'src/db/queries/brownlow-reconciliation-inputs.ts'));
const derived = await import(join(SRC, 'packages/derived/src/index.ts'));
const domain = await import(join(SRC, 'packages/domain/src/index.ts'));
const seasonsLib = await import(join(SRC, 'src/lib/seasons/sealed-seasons.ts'));

const GENERATED_AT = '2026-10-29T00:00:00.000Z';
const RULE = 'stored_eligible_rank_one';
const [archiveSha256, reportOut, metaOut] = process.argv.slice(2);
if (!/^[0-9a-f]{64}$/.test(archiveSha256 ?? '') || !reportOut || !metaOut) throw new Error('usage: brownlow-stored.mts <archiveSha256> <reportOut> <metaOut>');
if (existsSync(reportOut) || existsSync(metaOut)) throw new Error('output exists; never overwritten');
const dsn = process.env.AFLDB_OWNER_DATABASE_URL ?? '';
const verdict = domain.evaluateShadowDsn(dsn);
if (!verdict.ok) throw new Error(`not an isolated shadow copy: ${verdict.reason}`);
const registry = seasonsLib.loadSeasonRegistry(SRC);

const session = await tool.createPostgresSessionFactory()(dsn, verdict.database);
let captured: { facts: Record<string, unknown>; seasons: number[]; reports: unknown[]; errors: unknown[] };
try {
  captured = await tool.withReadOnlyExecutor(session, async (ex: { query: <R>(t: string, p?: unknown[]) => Promise<R[]> }) => {
    const [facts] = await ex.query<Record<string, unknown>>(`SELECT current_database() AS database, current_user AS "user",
        current_setting('transaction_read_only') AS read_only, current_setting('transaction_isolation') AS isolation,
        (SELECT count(*)::int FROM afldb_meta.schema_migrations) AS ledger,
        (SELECT max(name) FROM afldb_meta.schema_migrations) AS last_migration,
        (SELECT count(*)::int FROM brownlow_season_votes) AS season_vote_rows,
        (SELECT count(*)::int FROM brownlow_round_votes) AS round_vote_rows,
        (SELECT count(*)::int FROM staging.afl_api_brownlow_vote) AS staged_vote_rows`);
    const seasons = (await ex.query<{ season: number }>('SELECT DISTINCT season::int AS season FROM brownlow_season_votes ORDER BY season'))
      .map((r) => Number(r.season));
    const reports: unknown[] = [];
    const errors: unknown[] = [];
    for (const season of seasons) {
      try {
        const input = await loader.loadBrownlowReconciliationInput(ex, {
          season, registry, generatedAt: GENERATED_AT, eligibilityRule: RULE, storedOnlyFallback: true,
        });
        const report = derived.reconcileBrownlowSeason(input);
        const problems: string[] = derived.validateBrownlowReconciliationReport(report);
        if (problems.length > 0) errors.push({ season, error: 'INVALID_REPORT', problems: problems.slice(0, 5) });
        reports.push(JSON.parse(derived.serialiseBrownlowReconciliationReport(report)));
      } catch (error) {
        errors.push({ season, error: error instanceof Error ? error.name : 'Error', message: String(error instanceof Error ? error.message : error).split('\n')[0] });
      }
    }
    return { facts, seasons, reports, errors };
  });
} finally {
  await session.close();
}

const text = `${JSON.stringify({
  kind: 'stored-only-alternative-NOT-staged-comparator',
  decision: 'D-V2-CURRENT-SHADOW-FOLLOWUP-1',
  archiveSha256, generatedAt: GENERATED_AT, eligibilityRule: RULE, storedOnlyFallback: true,
  seasons: captured.seasons, errors: captured.errors, reports: captured.reports,
}, null, 2)}\n`;
writeFileSync(reportOut, text, { flag: 'wx', mode: 0o600 });

type R = { outcome: string; findings: unknown[]; rawVotes: { basis: string }; source: { evidence: { matchVoteRecords?: number } }; awardResultPresentation: { status: string } };
const reps = captured.reports as R[];
const tally = (f: (r: R) => string) => reps.reduce<Record<string, number>>((o, r) => ({ ...o, [f(r)]: (o[f(r)] ?? 0) + 1 }), {});
const meta = {
  facts: captured.facts,
  reportSha256: createHash('sha256').update(text).digest('hex'),
  seasons: captured.seasons.length, firstSeason: captured.seasons[0] ?? null, lastSeason: captured.seasons.at(-1) ?? null,
  reports: reps.length, errors: captured.errors.length,
  outcomes: tally((r) => r.outcome), presentation: tally((r) => r.awardResultPresentation?.status),
  basis: tally((r) => r.rawVotes?.basis), findings: reps.reduce((n, r) => n + r.findings.length, 0),
  matchVoteRecords: reps.reduce((n, r) => n + Number(r.source?.evidence?.matchVoteRecords ?? 0), 0),
};
writeFileSync(metaOut, `${JSON.stringify(meta, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(meta));
