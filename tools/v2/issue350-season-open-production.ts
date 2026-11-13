/** AFLDB-ISSUE-350: the REVIEWED, GUARDED entry point that OPENS the in-progress season in a live database: the `seasons` row and the
 * current clubs' `last_season`, exactly as `tools/migration/load_reference_data.py` (`load_seasons`, `load_clubs`) derives them from
 * the tracked `data/reference/seasons.json` and `clubs.json`. The AFL API settle never creates a season row; without this the nightly
 * fails on `afl_api_match_season_fkey` from the first concluded match of the season (see issues.md AFLDB-ISSUE-350).
 *
 *   describe  read-only; writes the connected database's identity (the --target file every other mode is bound to)
 *   baseline  read-only digest of the surface the operation can affect
 *   plan      read-only; target-bound; classifies the live state against the contract; digest-sealed
 *   apply     needs the plan, an approval pinned to the plan digest, a clean HEAD, fresh backup + verified restore evidence (stage I350)
 *   verify    read-only after the fact: the committed state equals the planned transition
 *   state     read-only: classifies the live surface as the plan's BASELINE, the planned RESULT, or OTHER
 *
 *   node --import tsx tools/v2/issue350-season-open-production.ts describe --out T
 *   ... baseline --target T --out O
 *   ... plan   --target T --backup B --backup-file F --restore-evidence R --out O          (production)
 *   ... plan   --target T --rehearsal --out O                                              (isolated clone only)
 *   ... apply  --plan P --approval A --backup-file F --restore-evidence R --out O           (production)
 *   ... apply  --plan P --rehearsal --out O                                                 (isolated clone only)
 *   ... verify --plan P --apply-record A --out O
 *   ... state  --plan P --out O
 *
 * WHAT IT WRITES, in ONE transaction: one INSERT into `seasons` (year, league, status, notes; every measured column stays NULL and no date
 * is written) when the row is absent; `UPDATE clubs SET last_season` for exactly the identities that are OPEN in clubs.json and hold
 * year - 1; `UPDATE club_organizations SET last_season` for their organisations; and one `import_batches` audit row (source
 * manual_admin_edit) naming the plan digest and the approval reference. Nothing else, no DELETE, no first_season, no closed identity, no
 * club_seasons. There is no ON CONFLICT: absent -> insert, present and equal to the contract -> nothing, present and different -> refuse.
 *
 * CONTROLS (as the I336 tool): the live identity equals the reviewed target; the plan digest binds target, revision, contract file
 * hashes, baseline and every id; the approval pins the digest; the writer is the afldb_import role; the three tables are locked
 * SHARE ROW EXCLUSIVE; the baseline is re-read inside the write transaction (drift refuses); after the writes, inside the transaction,
 * `transitionProblems` must be empty (nothing but the planned columns moved, afldb_identity_for_season is identical for every
 * organisation and season up to year - 1, non-NULL for year for exactly the open identities, afldb_season_list_clubs(year - 1) and
 * (year) unchanged) or the transaction rolls back. A committed outcome is never reported as rolled back, never retried, never reversed.
 * Every session pins TimeZone=Etc/UTC (ISSUE-349). Outcomes and exit codes are gap029-common.ts's.
 *
 * Transport: AFLDB_GAP029_DSN (read-only sessions) and AFLDB_GAP029_WRITE_DSN (the afldb_import role), both naming exactly the reviewed
 * target. Output files lie outside the checkout and are created exclusively. Prints no DSN.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import postgres from 'postgres';

import {
  type OpeningChanges, type OpeningExpectation, type OpeningFacts, changesOf, classifyOpening, expectedOpening, readOpeningFacts,
  stable, surfaceDigest, transitionProblems, writeOpening,
} from '../../src/lib/rollover/season-opening';
import { assemblyProblem, canonJson, lfSha256, MAX_AGE_MS, reportLines, runApply, sameJson, sha256, type TargetId } from './gap029-common';

export const OPERATION = 'issue350-season-open';
export const STAGE = 'I350';
export const TOOL_PATH = 'tools/v2/issue350-season-open-production.ts';
export const SEASONS_PATH = 'data/reference/seasons.json';
export const CLUBS_PATH = 'data/reference/clubs.json';
export const LIB_PATH = 'src/lib/rollover/season-opening.ts';
export const AUDIT_SOURCE_KEY = 'manual_admin_edit';
export const AUDIT_TOOL = 'issue350-season-open-production.ts';
/** Every file whose bytes decide what this tool writes or how it judges the result. */
export const toolHashes = (): Record<string, string> => Object.fromEntries(
  [TOOL_PATH, 'tools/v2/gap029-common.ts', LIB_PATH, SEASONS_PATH, CLUBS_PATH].map((p) => [p, lfSha256(p)]),
);

export type Target = TargetId;
export interface Backup { target: Target; sha256: string; restoreEvidenceSha256: string; capturedAt: string; restoredAt: string; baselineDigest: string }
export interface Plan {
  operation: string; revision: string; target: Target; rehearsal: boolean; year: number;
  seasonsSha256: string; clubsSha256: string; baselineDigest: string; changes: OpeningChanges; state: string;
  backup: Backup | null; createdAt: string; expiresAt: string; digest: string;
}
export interface Approval {
  planDigest: string; target: Target; revision: string; operation: string; seasonsSha256: string; clubsSha256: string;
  approvedAt: string; expiresAt: string; reference: string;
}

function fail(why: string): never { throw new Error(`ISSUE-350 season opening refused: ${why}`); }
export const planDigest = (p: Omit<Plan, 'digest'>): string => sha256(canonJson(p));
const fresh = (iso: string, now: number): boolean => { const t = Date.parse(iso); return Number.isFinite(t) && t <= now && now - t <= MAX_AGE_MS; };

/** Pure: every reason an execution approval does not bind to this plan, the live revision and the contract bytes. Null when it binds. */
export function approvalProblem(plan: Plan, approval: Approval | null, ctx: { now: number; revision: string; seasonsSha256: string; clubsSha256: string }): string | null {
  const { digest, ...body } = plan;
  if (digest !== planDigest(body)) return 'plan digest differs from its content';
  if (plan.operation !== OPERATION || plan.revision !== ctx.revision || plan.seasonsSha256 !== ctx.seasonsSha256 || plan.clubsSha256 !== ctx.clubsSha256) return 'plan operation, revision or contract differs';
  if (!(Date.parse(plan.expiresAt) > ctx.now)) return 'stale plan';
  if (plan.rehearsal) return null;
  if (!approval || !plan.backup) return 'missing execution approval or backup evidence';
  if (approval.planDigest !== plan.digest || approval.operation !== OPERATION || !sameJson(approval.target, plan.target) || approval.revision !== ctx.revision
    || approval.seasonsSha256 !== plan.seasonsSha256 || approval.clubsSha256 !== plan.clubsSha256) return 'approval does not bind to this plan, target, revision and contract';
  if (!(Date.parse(approval.expiresAt) > ctx.now) || Date.parse(approval.expiresAt) > Date.parse(plan.expiresAt) || !(Date.parse(approval.approvedAt) <= ctx.now)) return 'approval window invalid or expired';
  if (!String(approval.reference ?? '').trim()) return 'approval carries no written reference';
  if (!fresh(plan.backup.capturedAt, ctx.now) || !fresh(plan.backup.restoredAt, ctx.now)) return 'backup no longer fresh';
  return null;
}

/** Pure: every reason a production plan must not trust this backup evidence (target-bound, fresh, ordered, machine-assembled and sealed), or null. */
export function backupProblem(backup: Backup, target: Target, ctx: { now: number; revision: string }, tools: Record<string, string> = toolHashes()): string | null {
  if (!sameJson(backup.target, target) || !fresh(backup.capturedAt, ctx.now) || !fresh(backup.restoredAt, ctx.now) || Date.parse(backup.restoredAt) < Date.parse(backup.capturedAt)) return 'fresh target-bound backup and verified restore evidence required';
  return assemblyProblem(backup as unknown as Record<string, unknown>, { operation: OPERATION, stage: STAGE, revision: ctx.revision, now: ctx.now, target, toolSha256: tools,
    stageFields: { baselineDigest: backup.baselineDigest } });
}

type Db = postgres.Sql | postgres.TransactionSql;
const contract = (): { exp: OpeningExpectation; seasonsSha256: string; clubsSha256: string } => ({
  exp: expectedOpening(JSON.parse(readFileSync(SEASONS_PATH, 'utf8')), JSON.parse(readFileSync(CLUBS_PATH, 'utf8'))),
  seasonsSha256: lfSha256(SEASONS_PATH), clubsSha256: lfSha256(CLUBS_PATH),
});

interface Info { before: OpeningFacts; changes: OpeningChanges; batchId: string; recordsUpdated: number }

async function run(): Promise<void> {
  const mode = process.argv[2];
  const args = process.argv.slice(3);
  const flag = (f: string) => args.includes(f);
  const opt = (f: string): string => { const i = args.indexOf(f); if (i < 0 || !args[i + 1]) throw new Error(`${f} required`); return args[i + 1]; };
  if (!['describe', 'baseline', 'plan', 'apply', 'verify', 'state'].includes(mode ?? '')) fail('mode must be describe, baseline, plan, apply, verify or state');
  const root = process.cwd();
  const outside = (p: string): string => { const abs = resolve(p); const rel = relative(root, abs); if (!rel.startsWith('..') || isAbsolute(rel)) fail('evidence files must be outside the checkout'); return abs; };
  const json = <T,>(p: string): T => JSON.parse(readFileSync(outside(p), 'utf8')) as T;
  const out = outside(opt('--out'));
  if (existsSync(out)) fail('output already exists; preserve evidence and choose another path');
  const write = (v: unknown) => writeFileSync(out, `${JSON.stringify(v, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  const dsn = process.env.AFLDB_GAP029_DSN ?? '';
  const readOnly = () => postgres(dsn, { max: 1, connect_timeout: 5, onnotice: () => {}, connection: { default_transaction_read_only: true, TimeZone: 'Etc/UTC' } });
  const identity = async (s: Db): Promise<Omit<Target, 'host' | 'port'>> => {
    const [row] = await s<Record<string, string | null>[]>`SELECT current_database() AS database, current_user AS "user", c.system_identifier::text AS "systemIdentifier",
      d.oid::text AS "databaseOid", current_setting('cluster_name') AS "clusterName", shobj_description(d.oid,'pg_database') AS "databaseComment"
      FROM pg_control_system() c CROSS JOIN pg_database d WHERE d.datname = current_database()`;
    return row as unknown as Omit<Target, 'host' | 'port'>;
  };
  if (mode === 'describe') {
    let u: URL; try { u = new URL(dsn); } catch { return fail('explicit AFLDB_GAP029_DSN required'); }
    const sql = readOnly();
    try { write({ host: u.hostname, port: Number(u.port || 5432), ...(await sql.begin('read only', (tx) => identity(tx))) }); } finally { await sql.end({ timeout: 5 }); }
    console.log('Target identity written (read-only)');
    return;
  }
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (mode === 'apply' || mode === 'plan') { execFileSync('git', ['diff', '--quiet']); execFileSync('git', ['diff', '--cached', '--quiet']); }
  const plan0 = mode === 'apply' || mode === 'verify' || mode === 'state' ? json<Plan>(opt('--plan')) : null;
  const rehearsal = plan0 ? plan0.rehearsal : flag('--rehearsal');
  if (flag('--rehearsal') && plan0 && !plan0.rehearsal) fail('the plan is not a rehearsal plan');
  const target = plan0?.target ?? json<Target>(opt('--target'));
  const sameDb = (value: string, exactUser: boolean): void => {
    let u: URL; try { u = new URL(value); } catch { return fail('explicit DSN required'); }
    if (!['postgres:', 'postgresql:'].includes(u.protocol) || u.search || u.hash || u.hostname !== target.host || Number(u.port || 5432) !== target.port
      || decodeURIComponent(u.pathname.slice(1)) !== target.database || (exactUser && decodeURIComponent(u.username) !== target.user)) fail('wrong target; no connection authorised');
  };
  sameDb(dsn, true);
  if (rehearsal && !/^afldb_v2_[a-z0-9_]+_test$/.test(target.database)) fail('a rehearsal is only for an isolated afldb_v2_*_test database');
  if (!rehearsal && /^afldb_v2_.*_test$/.test(target.database)) fail('an isolated clone is rehearsed with --rehearsal');
  if (mode === 'apply') sameDb(process.env.AFLDB_GAP029_WRITE_DSN ?? '', false);
  const { exp, seasonsSha256, clubsSha256 } = contract();
  const sql = readOnly();
  const prove = async (s: postgres.TransactionSql, writerRole = false): Promise<void> => {
    const row = await identity(s);
    if (writerRole && row.user !== 'afldb_import') fail('the write connection must be the afldb_import role');
    if (!sameJson({ ...row, ...(writerRole ? { user: target.user } : {}) }, { database: target.database, user: target.user, systemIdentifier: target.systemIdentifier,
      databaseOid: target.databaseOid, clusterName: target.clusterName, databaseComment: target.databaseComment })) fail('live database identity differs from the reviewed target');
    const [tz] = await s<{ tz: string }[]>`SELECT current_setting('TimeZone') AS tz`;
    if (tz.tz !== 'Etc/UTC' && tz.tz !== 'UTC') fail(`session TimeZone is ${tz.tz}, not Etc/UTC`);
  };
  const independent = async <T,>(work: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> => {
    const ro = readOnly();
    try { return (await ro.begin('read only isolation level repeatable read', async (tx) => { await prove(tx); return work(tx); })) as T; } finally { await ro.end({ timeout: 5 }); }
  };
  const now = Date.now();
  try {
    if (mode === 'baseline') {
      const b = await sql.begin('read only isolation level repeatable read', async (tx) => { await prove(tx); return readOpeningFacts(tx, exp.year); });
      const c = classifyOpening(exp, b);
      write({ target, revision, year: exp.year, state: c.state, baselineDigest: surfaceDigest(b), importBatches: b.batches.n, capturedAt: new Date().toISOString() });
      console.log(`Read-only season-opening baseline ${surfaceDigest(b)} (${c.state})`);
      return;
    }
    const fileHash = (p: string) => sha256(readFileSync(outside(p)));
    if (mode === 'plan') {
      const backup = rehearsal ? null : json<Backup>(opt('--backup'));
      if (backup) {
        const refused = backupProblem(backup, target, { now, revision });
        if (refused) fail(refused);
        if (fileHash(opt('--backup-file')) !== backup.sha256 || fileHash(opt('--restore-evidence')) !== backup.restoreEvidenceSha256) fail('backup or restore evidence content differs');
      }
      const result = await sql.begin('read only isolation level repeatable read', async (tx) => {
        await prove(tx);
        const facts = await readOpeningFacts(tx, exp.year);
        const digest = surfaceDigest(facts);
        if (backup && digest !== backup.baselineDigest) fail('baseline drift: the restored backup no longer matches the live target');
        const verdict = classifyOpening(exp, facts);
        if (verdict.state === 'REFUSED') fail(`the live state is not one the contract allows: ${verdict.problems.join('; ')}`);
        const body: Omit<Plan, 'digest'> = { operation: OPERATION, revision, target, rehearsal, year: exp.year, seasonsSha256, clubsSha256, baselineDigest: digest,
          changes: changesOf(verdict), state: verdict.state, backup, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + MAX_AGE_MS).toISOString() };
        return { ...body, digest: planDigest(body) } as Plan;
      });
      write(result);
      console.log(`Review plan ${result.digest}; no writes (${result.state}: season row ${result.changes.insertSeason ? 'to insert' : 'present'}, ${result.changes.clubIds.length} clubs and ${result.changes.orgIds.length} organisations to update)`);
      return;
    }
    const plan = plan0!;
    { const { digest, ...body } = plan; if (digest !== planDigest(body) || plan.operation !== OPERATION) fail('plan digest or operation differs'); }
    if (plan.seasonsSha256 !== seasonsSha256 || plan.clubsSha256 !== clubsSha256 || plan.year !== exp.year) fail('the tracked contract differs from the one the plan was made against');
    if (mode === 'verify') {
      const record = json<{ planDigest: string; info?: Info }>(opt('--apply-record'));
      if (record.planDigest !== plan.digest || !record.info) fail('the apply record belongs to a different plan or carries no boundary');
      const info = record.info;
      const report = await independent(async (tx) => {
        const after = await readOpeningFacts(tx, exp.year);
        const [batch] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM import_batches WHERE id = ${info.batchId}::bigint AND tool = ${AUDIT_TOOL} AND status::text = 'completed'`;
        return { problems: transitionProblems(exp, info.changes, info.before, after), state: classifyOpening(exp, after).state, auditBatchPresent: batch.n === 1 };
      });
      write({ planDigest: plan.digest, checkedAt: new Date().toISOString(), ...report });
      console.log(`Read-only verification: state ${report.state}; ${report.problems.length} problems; audit batch present: ${report.auditBatchPresent}`);
      return;
    }
    if (mode === 'state') {
      const seen = await independent(async (tx) => {
        const facts = await readOpeningFacts(tx, exp.year);
        return { baseline: surfaceDigest(facts) === plan.baselineDigest, classification: classifyOpening(exp, facts).state };
      });
      const state = seen.baseline ? 'BASELINE (the plan has not been applied)' : seen.classification === 'OPEN' ? 'PLANNED RESULT PRESENT (the season is open as contracted)' : 'OTHER (neither the plan baseline nor the planned result)';
      write({ planDigest: plan.digest, state, ...seen, checkedAt: new Date().toISOString() });
      console.log(`STATE ${state}`);
      return;
    }
    const problem = approvalProblem(plan, rehearsal ? null : json<Approval>(opt('--approval')), { now, revision, seasonsSha256, clubsSha256 });
    if (problem) fail(problem);
    const approvalRef = rehearsal ? 'rehearsal' : String(json<Approval>(opt('--approval')).reference).replace(/\s+/g, ' ').trim().slice(0, 160);
    const writer = postgres(process.env.AFLDB_GAP029_WRITE_DSN ?? '', { max: 1, connect_timeout: 5, onnotice: () => {}, connection: { TimeZone: 'Etc/UTC' } });
    try {
      const report = await runApply<Info>({
        preflight: async () => {
          if (rehearsal) return;
          const pb = plan.backup!;
          if (fileHash(opt('--backup-file')) !== pb.sha256 || fileHash(opt('--restore-evidence')) !== pb.restoreEvidenceSha256) fail('backup or restore evidence content differs');
          const refused = backupProblem(pb, plan.target, { now, revision });
          if (refused) fail(refused);
        },
        transact: (marks) => writer.begin('isolation level repeatable read', async (tx) => {
          await prove(tx, true);
          // Writers of these tables (createMatch, the settle's FK checks) wait here; nothing changes between the re-read and the commit.
          await tx`LOCK TABLE seasons, clubs, club_organizations IN SHARE ROW EXCLUSIVE MODE`;
          const before = await readOpeningFacts(tx, exp.year);
          if (surfaceDigest(before) !== plan.baselineDigest) fail('baseline drift; re-plan and obtain new execution approval');
          const verdict = classifyOpening(exp, before);
          if (verdict.state === 'REFUSED') fail(`the live state is not one the contract allows: ${verdict.problems.join('; ')}`);
          const changes = changesOf(verdict);
          if (!sameJson(changes, plan.changes)) fail('the live classification differs from the reviewed plan');
          if (!changes.insertSeason && changes.clubIds.length === 0 && changes.orgIds.length === 0) return { replay: true };
          const sources = await tx<{ id: number }[]>`SELECT id::int AS id FROM sources WHERE key = ${AUDIT_SOURCE_KEY}`;
          if (sources.length !== 1) fail(`the audit source ${AUDIT_SOURCE_KEY} resolves to ${sources.length} rows, not exactly one`);
          marks.writing();
          await writeOpening(tx, exp, changes);
          const updated = changes.clubIds.length + changes.orgIds.length;
          const [batch] = await tx<{ id: string }[]>`INSERT INTO import_batches (source_id, tool, target_table, status, records_read, records_inserted, records_updated, records_rejected, notes, completed_at)
            VALUES (${sources[0].id}, ${AUDIT_TOOL}, 'seasons,clubs,club_organizations', 'completed', ${1 + exp.open.length}, ${changes.insertSeason ? 1 : 0}, ${updated}, 0,
                    ${`AFLDB-ISSUE-350 open season ${exp.year}; plan ${plan.digest.slice(0, 16)}; contract seasons ${seasonsSha256.slice(0, 12)} clubs ${clubsSha256.slice(0, 12)}; approval: ${approvalRef}`}, now())
            RETURNING id::text AS id`;
          const after = await readOpeningFacts(tx, exp.year);
          const problems = transitionProblems(exp, changes, before, after);
          if (problems.length > 0) fail(`post-write verification failed; rolled back: ${problems.join('; ')}`);
          if (classifyOpening(exp, after).state !== 'OPEN') fail('post-write verification failed: the season is not open as contracted afterwards; rolled back');
          const info: Info = { before, changes, batchId: batch.id, recordsUpdated: updated };
          marks.commitNext(info);
          return { replay: false, info, result: { seasonInserted: changes.insertSeason, clubsUpdated: changes.clubIds.length, orgsUpdated: changes.orgIds.length, batchId: batch.id,
            baselineDigest: plan.baselineDigest, afterDigest: surfaceDigest(after), planDigest: plan.digest, info } };
        }),
        verify: (info) => independent(async (tx) => {
          const after = await readOpeningFacts(tx, exp.year);
          const problems = transitionProblems(exp, info.changes, info.before, after);
          if (classifyOpening(exp, after).state !== 'OPEN') problems.push('the season is not open as contracted');
          const [b] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM import_batches WHERE id = ${info.batchId}::bigint AND tool = ${AUDIT_TOOL} AND status::text = 'completed' AND records_updated = ${info.recordsUpdated}`;
          if (b.n !== 1) problems.push('the completed audit batch row is missing or differs');
          return problems;
        }),
        probe: (info) => independent(async (tx) => {
          const facts = await readOpeningFacts(tx, exp.year);
          if (surfaceDigest(facts) === plan.baselineDigest) return 'unchanged' as const;
          return classifyOpening(exp, facts).state === 'OPEN' && stable(info.changes) === stable(plan.changes) ? ('applied' as const) : ('other' as const);
        }),
        persist: (record) => write({ ...record, planDigest: plan.digest }),
      });
      for (const line of reportLines(report)) console.log(line);
      process.exitCode = report.exitCode;
    } finally { await writer.end({ timeout: 5 }); }
  } finally { await sql.end({ timeout: 5 }); }
}

function main() {
  return run().catch((error: unknown) => {
    console.error(error instanceof Error && error.message.startsWith('ISSUE-350 season opening refused:') ? error.message : 'ISSUE-350 season opening refused or failed; inspect restricted evidence. No automatic retry.');
    process.exitCode = 1;
  });
}

if (process.argv[1] && /issue350-season-open-production\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) void main();
