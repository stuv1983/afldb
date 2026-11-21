/**
 * Brownlow season attachment: plan | apply | reverse (src/db/queries/brownlow-season-attachment.ts).
 *
 *   AFLDB_BROWNLOW_ATTACH_DSN=<import-role DSN> \
 *   node --import tsx --conditions=react-server tools/v2/brownlow-season-attach.ts plan \
 *     --target <target.json> --season <year> --out <plan.json>
 *   ... apply   --target <target.json> --export <plan.json> --digest <sha256> --actor <auth_users.id> \
 *               --note "<approval reference, >= 20 chars>" --out <result.json> [--commit]
 *   ... reverse (same flags as apply)
 *
 * The connection comes ONLY from AFLDB_BROWNLOW_ATTACH_DSN (never DATABASE_URL, never .env). The target
 * file pins host, port, database, user, cluster name, system identifier, database OID and comment, and
 * every run proves them on the live connection first (the Brownlow production-correction convention).
 * `plan` is a read-only REPEATABLE READ snapshot. `apply`/`reverse` without `--commit` are dry runs: the
 * whole transaction runs, every check included, and is rolled back. Evidence files must be outside the
 * checkout and must not already exist. There is no force flag.
 *
 * It only attaches and mirrors; publication (season totals, coverage, eligibility, winner) stays the
 * Super Admin's audited act at /admin/brownlow/<year>.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import postgres from 'postgres';

import { postgresExecutor } from '@afldb/db';

import {
  applySeasonAttachment,
  attachmentExportOf,
  parseAttachmentExport,
  planSeasonAttachment,
  reverseSeasonAttachment,
} from '@/db/queries/brownlow-season-attachment';
import {
  checkCorrectionTransport,
  proveCorrectionTarget,
  type CorrectionTarget,
} from '@/db/queries/brownlow-production-correction';

function outside(path: string): string {
  const absolute = resolve(path);
  const rel = relative(process.cwd(), absolute);
  if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) throw new Error('Evidence files must stay outside the checkout');
  return absolute;
}

async function main(): Promise<void> {
  const [mode, ...args] = process.argv.slice(2);
  if (!['plan', 'apply', 'reverse'].includes(mode)) throw new Error('usage: plan | apply | reverse (see the header)');
  const valued = new Set(['--target', '--season', '--out', '--export', '--digest', '--actor', '--note']);
  const flags = new Set(['--commit']);
  const values = new Map<string, string>();
  let commit = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (flags.has(a)) { commit = true; continue; }
    if (!valued.has(a) || args[i + 1] === undefined || values.has(a)) throw new Error(`Unknown, duplicate or empty option ${a}`);
    values.set(a, args[i + 1]);
    i += 1;
  }
  const opt = (flag: string): string => {
    const v = values.get(flag);
    if (!v) throw new Error(`${flag} required`);
    return v;
  };
  const outPath = outside(opt('--out'));
  if (existsSync(outPath)) throw new Error('Output already exists; preserve evidence and choose another path');
  const target = JSON.parse(readFileSync(outside(opt('--target')), 'utf8')) as CorrectionTarget;
  const dsn = process.env.AFLDB_BROWNLOW_ATTACH_DSN ?? '';
  checkCorrectionTransport(dsn, target);
  const write = (value: unknown) => writeFileSync(outPath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });

  if (mode === 'plan') {
    if (commit) throw new Error('--commit is not a plan option');
    const season = Number(opt('--season'));
    if (!Number.isInteger(season)) throw new Error('--season must be a year');
    const sql = postgres(dsn, { max: 1, connect_timeout: 5, onnotice: () => {}, connection: { default_transaction_read_only: true } });
    try {
      const plan = await postgresExecutor(sql).transaction(async (tx) => {
        await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
        await proveCorrectionTarget(tx, target);
        return planSeasonAttachment(tx, season);
      });
      write({ ...attachmentExportOf(plan), facts: plan.facts, completeMatches: plan.completeMatches, target, plannedAt: new Date().toISOString() });
      console.log(`PLAN season=${season} rows=${plan.facts.roundRows} positive=${plan.facts.positiveRows} votes=${plan.facts.votesTotal} `
        + `matches=${plan.completeMatches}/${plan.facts.homeAndAwayMatches} attach=${plan.backfill.repairs.length} mirror=${plan.mirror.length} digest=${plan.digest}`);
    } finally { await sql.end({ timeout: 5 }); }
    return;
  }

  const reviewed = parseAttachmentExport(JSON.parse(readFileSync(outside(opt('--export')), 'utf8')));
  const actorId = Number(opt('--actor'));
  if (!Number.isInteger(actorId)) throw new Error('--actor must be an auth_users id');
  const note = opt('--note');
  const sql = postgres(dsn, { max: 1, connect_timeout: 5, onnotice: () => {} });
  try {
    const run = mode === 'apply' ? applySeasonAttachment : reverseSeasonAttachment;
    const result = await run(sql, {
      export: reviewed, expectedDigest: opt('--digest'), expectedDatabase: target.database, actorId, note, commit,
      prove: (ex) => proveCorrectionTarget(ex, target),
    });
    write({ mode, ...result, target, ranAt: new Date().toISOString() });
    console.log(`${mode.toUpperCase()} ${commit ? 'COMMITTED' : 'DRY-RUN (rolled back)'} season=${result.season} attached=${result.attached} `
      + `mirrored=${result.mirrored} unattached_after=${result.after.unattachedRows} mirror_after=${result.after.mirrorRecorded} `
      + `audit=${result.auditId ?? '-'} digest=${result.digest}`);
  } finally { await sql.end({ timeout: 5 }); }
}

main().catch((error: unknown) => {
  const e = error as { name?: string; code?: string; message?: string };
  console.error(`REFUSED ${e.name ?? 'Error'}${e.code ? ` ${e.code}` : ''}: ${e.message ?? String(error)}`);
  process.exitCode = 1;
});
