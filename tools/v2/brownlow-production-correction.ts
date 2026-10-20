/** Future owner-operated production entry point; NEVER discovers or reads environment DSNs.
 * No arguments => refusal without a connection. `plan` is a read-only snapshot.
 * `apply` requires an exact, fresh approval file. Isolated CLIs remain isolated-only.
 * Usage and input contracts: docs/v2/brownlow-production-approval-package-2026-10-20.md.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import postgres from 'postgres';

import { nativeTransactionOf, postgresExecutor } from '@afldb/db';

import { applyBrownlowCorrection, checkCorrectionApproval, checkCorrectionTransport, correctionBaseline, correctionHash, planBrownlowCorrection, proveCorrectionTarget,
  type CorrectionApproval, type CorrectionPlan, type CorrectionRequest, type CorrectionTarget, type FreshBackup } from '@/db/queries/brownlow-production-correction';
import { runSettleAflApiBrownlow } from '@/lib/acquisition/afl-api-brownlow';
import { parseAflApiIdentities } from '@/lib/acquisition/afl-api-bundle';
import { parseSourceFamilyRegistry } from '@/lib/acquisition/source-families';
import { loadSeasonRegistry } from '@/lib/seasons/sealed-seasons';

import { loadSnapshot } from '../current-season/settle-afl-api-brownlow';

function outside(path: string): string {
  const absolute = resolve(path);
  const rel = relative(process.cwd(), absolute);
  if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) throw new Error('Correction evidence must stay outside the checkout');
  return absolute;
}
const json = <T>(path: string): T => JSON.parse(readFileSync(outside(path), 'utf8')) as T;

async function main(): Promise<void> {
  const [mode, ...args] = process.argv.slice(2);
  if (!['baseline', 'plan', 'apply'].includes(mode)) throw new Error('usage: baseline | plan | apply; explicit evidence files required');
  const allowed = new Set(['--target', '--request', '--backup', '--backup-file', '--restore-evidence', '--out', '--plan', '--approval', '--snapshot-label']);
  if (args.length % 2 || args.some((v, i) => i % 2 === 0 && !allowed.has(v))) throw new Error('Unknown flag; no force or automatic target option exists');
  if (new Set(args.filter((_, i) => i % 2 === 0)).size !== args.length / 2) throw new Error('Duplicate option');
  const opt = (flag: string): string => {
    const i = args.indexOf(flag);
    if (i < 0 || !args[i + 1]) throw new Error(`${flag} required`);
    return args[i + 1];
  };
  const outPath = outside(opt('--out'));
  if (existsSync(outPath)) throw new Error('Output already exists; preserve evidence and choose another path');
  // Read only this checkout's revision. No fetch, remote, checkout or automatic Git writes.
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  execFileSync('git', ['diff', '--quiet']);
  execFileSync('git', ['diff', '--cached', '--quiet']);
  if (mode === 'baseline') {
    const target = json<CorrectionTarget>(opt('--target'));
    const dsn = process.env.AFLDB_BROWNLOW_CORRECTION_DSN ?? '';
    checkCorrectionTransport(dsn, target);
    const sql = postgres(dsn, { max: 1, connect_timeout: 5, onnotice: () => {}, connection: { default_transaction_read_only: true } });
    try {
      const baselineDigest = await postgresExecutor(sql).transaction(async (tx) => {
        await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
        await proveCorrectionTarget(tx, target);
        return correctionBaseline(tx);
      });
      writeFileSync(outPath, `${JSON.stringify({ target, revision, baselineDigest, capturedAt: new Date().toISOString() }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      console.log(`Read-only Brownlow baseline ${baselineDigest}`);
    } finally { await sql.end({ timeout: 5 }); }
    return;
  }
  const plan = mode === 'apply' ? json<CorrectionPlan>(opt('--plan')) : null;
  const target = plan?.target ?? json<CorrectionTarget>(opt('--target'));
  const request = plan?.request ?? json<CorrectionRequest>(opt('--request'));
  const approval = mode === 'apply' ? json<CorrectionApproval>(opt('--approval')) : null;
  if (plan && approval) checkCorrectionApproval(plan, approval, revision, new Date().toISOString());
  const backup = plan?.backup ?? json<FreshBackup>(opt('--backup'));
  const fileHash = (path: string) => createHash('sha256').update(readFileSync(outside(path))).digest('hex');
  if (fileHash(opt('--backup-file')) !== backup.sha256 || fileHash(opt('--restore-evidence')) !== backup.restoreEvidenceSha256) {
    throw new Error('Backup or restore evidence content differs');
  }
  const registry = loadSeasonRegistry();
  const sourceRegistry = parseSourceFamilyRegistry(JSON.parse(readFileSync('data/reference/source-families.json', 'utf8')));
  if (request.operation === 'observe') {
    const label = opt('--snapshot-label');
    if (!/^[a-zA-Z0-9_-]+$/.test(label)) throw new Error('Invalid snapshot label');
    const root = `data/sources/afl_api/brownlow/${label}`;
    const seasonRaw = JSON.parse(readFileSync(`${root}/01-brownlow-season.raw.json`, 'utf8'));
    const boardRaw = JSON.parse(readFileSync(`${root}/02-brownlow-leaderboard.raw.json`, 'utf8'));
    // BP-2025-ELIGIBILITY-v1: the emitters now keep a null/non-boolean provider value as UNKNOWN (NULL in staging,
    // migration 117) rather than mapping it to false. This guarded production boundary is stricter on purpose: it
    // still refuses missing/null/nonboolean evidence BEFORE loading, so an observation containing an unknown needs
    // separate review and is never recorded as a correction; unknown is never manufactured as ineligible.
    const checkFlags = (v: unknown): void => {
      if (Array.isArray(v)) { v.forEach(checkFlags); return; }
      if (v === null || typeof v !== 'object') return;
      const row = v as Record<string, unknown>;
      if (('player' in row || 'playerId' in row) && ('votes' in row || 'totalVotes' in row)
        && typeof row.eligible !== 'boolean') throw new Error('Unknown provider eligibility; observation requires separate review');
      Object.values(row).forEach(checkFlags);
    };
    checkFlags(seasonRaw); checkFlags(boardRaw);
    const snapshot = loadSnapshot(process.cwd(), label, sourceRegistry);
    if (snapshot.season !== 2025 || snapshot.matchVotes.length !== 207 || snapshot.leaderboard.length !== 188) throw new Error('Wrong snapshot season/counts');
    const observation = { snapshot, filesDigest: correctionHash([seasonRaw, boardRaw,
      JSON.parse(readFileSync(`${root}/manifest.json`, 'utf8'))]) };
    if (mode === 'apply' && correctionHash(observation) !== correctionHash(request.observation)) throw new Error('Snapshot drift');
    request.observation = observation;
  }
  // A dedicated secret variable, never a shared DATABASE_URL, never loaded from .env.
  const dsn = process.env.AFLDB_BROWNLOW_CORRECTION_DSN ?? '';
  checkCorrectionTransport(dsn, target);
  const sql = postgres(dsn, { max: 1, connect_timeout: 5, onnotice: () => {},
    ...(mode === 'plan' ? { connection: { default_transaction_read_only: true } } : {}) });
  try {
    const executor = postgresExecutor(sql);
    const outcome = mode === 'plan'
      ? await planBrownlowCorrection(executor, request, { target, revision,
        backup, now: new Date().toISOString() })
      : await applyBrownlowCorrection(executor, plan!, approval!, { revision, now: new Date().toISOString(), registry,
        observe: async (tx, payload) => {
          const { snapshot } = payload as { snapshot: ReturnType<typeof loadSnapshot> };
          const native = nativeTransactionOf(tx);
          if (!native) throw new Error('Native observation transaction required');
          const result = await runSettleAflApiBrownlow({ begin: (work: (t: postgres.TransactionSql) => Promise<unknown>) => work(native) } as unknown as postgres.Sql, {
            ...snapshot, registry: sourceRegistry, inProgressSeasons: registry.in_progress_seasons,
            apply: true, autoApply: false, observeOnly: true,
            fixtureIdentityFallback: { registry: sourceRegistry,
              identities: parseAflApiIdentities(JSON.parse(readFileSync('data/reference/afl-api-identities.json', 'utf8'))) },
          });
          if (!result.applied || result.halt || result.counters.voteSetsPlanned !== 207
            || Object.values(result.counters.voteSetsRefused).some((n) => n !== 0)) throw new Error('Observation identity/refusal gate failed; rollback');
          return result;
        },
      });
    writeFileSync(outPath, `${JSON.stringify(outcome, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    console.log(mode === 'plan' ? `Review plan ${(outcome as CorrectionPlan).digest}; no writes` : 'Correction receipt committed; review restricted output');
  } finally { await sql.end({ timeout: 5 }); }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error && error.message.startsWith('Brownlow correction refused:')
    ? error.message : 'Brownlow correction refused or failed; inspect restricted evidence. No automatic retry.');
  process.exitCode = 1;
});
