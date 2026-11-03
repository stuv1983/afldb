/** V2-GAP-029: what the four production entry points (and the evidence assembler) share, kept in ONE reviewed place so a stage cannot
 * quietly use a weaker rule than another.
 *
 *   1. OUTCOME TAXONOMY and the apply runner. A mutation attempt ends in exactly one of seven named outcomes with a distinct exit code and
 *      a fixed statement. The runner tracks WHERE a failure surfaced (before the first write, inside the open transaction, or at the commit
 *      boundary) and never reports "rolled back" for a state that may have committed. It never retries, never reverses and never restores.
 *   2. The restore-evidence ASSEMBLY SEAL. `backup.json` for a production plan is machine-assembled by `gap029-assemble-restore-evidence.ts`
 *      and carries a language-neutral seal; a production plan refuses a hand-written, edited, mismatched or stale one. The same rules are
 *      mirrored for the Python stages in `gap029_common.py`; the two are held to the same fixtures by `tests/gap029-assembly.test.ts` and
 *      `tests/python/gap029_common_contract.py`.
 *
 * The seal is TAMPER-EVIDENT, not tamper-proof: there is no secret key, so someone who rewrites a field AND recomputes the digest produces a
 * file this code accepts. What it removes is the accidental and the casual: a hand-picked value, a value pasted from another run, a file edited
 * after assembly, evidence from a different revision, a different stage, a different restore or changed tools. The plan/approval ceremony
 * (owner-pinned digests, fresh backup, verified restore) remains the control against a deliberate forger.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
export const canonJson = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
export const sameJson = (a: unknown, b: unknown): boolean => canonJson(a) === canonJson(b);
/** sha256 of a file's text with CRLF folded to LF, so a Windows checkout and a Linux checkout of the same blob hash alike. */
export const lfSha256 = (path: string): string => sha256(Buffer.from(readFileSync(path).toString('utf8').replace(/\r\n/g, '\n'), 'utf8'));
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const freshAt = (iso: unknown, now: number): boolean => { const t = Date.parse(String(iso)); return Number.isFinite(t) && t <= now && now - t <= MAX_AGE_MS; };

/* ------------------------------------------------------------------------------------------------------------------------------------- */
/* 1. Outcomes                                                                                                                           */
/* ------------------------------------------------------------------------------------------------------------------------------------- */

export const OUTCOMES = ['COMMITTED_VERIFIED', 'NOTHING_WRITTEN', 'REFUSED_BEFORE_MUTATION', 'ROLLED_BACK', 'COMMITTED_VERIFICATION_FAILED', 'COMMITTED_VERIFICATION_UNAVAILABLE', 'OUTCOME_UNDETERMINED'] as const;
export type Outcome = (typeof OUTCOMES)[number];
/** 0 means "the run did what the plan said (or the plan was already satisfied)"; every other code names a different state of the database. */
export const EXIT_CODE: Readonly<Record<Outcome, number>> = {
  COMMITTED_VERIFIED: 0, NOTHING_WRITTEN: 0, REFUSED_BEFORE_MUTATION: 1, ROLLED_BACK: 2, COMMITTED_VERIFICATION_FAILED: 3, COMMITTED_VERIFICATION_UNAVAILABLE: 4, OUTCOME_UNDETERMINED: 5,
};
export const isCommitted = (o: Outcome): boolean => o === 'COMMITTED_VERIFIED' || o === 'COMMITTED_VERIFICATION_FAILED' || o === 'COMMITTED_VERIFICATION_UNAVAILABLE';

const COMMITTED_RECOVERY = 'The change IS COMMITTED and is NOT rolled back. This tool will not retry, reverse or restore. Restoring the verified backup is a separate OWNER decision '
  + 'and would discard every write made to the database after the backup was taken; nothing is restored automatically.';
export const STATEMENT: Readonly<Record<Outcome, string>> = {
  COMMITTED_VERIFIED: 'COMMITTED AND VERIFIED: the transaction committed and an independent read-only check of the committed state passed.',
  NOTHING_WRITTEN: 'NOTHING WRITTEN: every reviewed row was already present; the transaction made no change.',
  REFUSED_BEFORE_MUTATION: 'REFUSED BEFORE MUTATION: a check failed before the first write statement; nothing was written.',
  ROLLED_BACK: 'ROLLED BACK: the transaction did not commit; the database holds its pre-transaction state (sequence values consumed by the attempt are not returned).',
  COMMITTED_VERIFICATION_FAILED: `COMMITTED, VERIFICATION FAILED: the independent check of the committed state found differences. ${COMMITTED_RECOVERY}`,
  COMMITTED_VERIFICATION_UNAVAILABLE: `COMMITTED, VERIFICATION UNAVAILABLE: the transaction committed but the independent check could not be completed. ${COMMITTED_RECOVERY}`,
  OUTCOME_UNDETERMINED: 'OUTCOME UNDETERMINED: the tool could not establish whether the transaction committed. Do NOT assume it rolled back and do NOT retry; read the state with the read-only `state` mode against the same plan.',
};

export interface Marks<I> {
  /** Call immediately BEFORE the first write statement of the transaction. */
  writing: () => void;
  /** Call as the LAST statement before the transaction callback returns: the facts the independent check and the probe need. */
  commitNext: (info: I) => void;
}
export interface ApplySteps<I> {
  /** Everything that must hold before any connection can write. Any throw => REFUSED_BEFORE_MUTATION. */
  preflight: () => Promise<void>;
  /** Opens the writer transaction and returns when it has COMMITTED. A throw before `writing()` is a refusal, after it a rollback, after `commitNext()` an unknown commit. */
  transact: (marks: Marks<I>) => Promise<{ replay: boolean; info?: I; result?: Record<string, unknown> }>;
  /** A fresh, independent, read-only session checks the committed state. Returns problems (empty = pass); a throw means unavailable. */
  verify: (info: I) => Promise<string[]>;
  /** Used only when the commit boundary failed: classify what a fresh read-only session now sees. */
  probe: (info: I) => Promise<'unchanged' | 'applied' | 'other'>;
  /** Writes the exclusive output record; a failure here never changes the outcome. */
  persist: (record: Record<string, unknown>) => void;
}
export interface Report { outcome: Outcome; exitCode: number; statement: string; problems: string[]; detail: string | null; record: Record<string, unknown>; recordPersisted: boolean }

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 400);

/** Runs one apply and classifies it. Never throws; never retries; never calls anything that restores or reverses. */
export async function runApply<I>(steps: ApplySteps<I>, at: () => string = () => new Date().toISOString()): Promise<Report> {
  let phase: 'pre' | 'writing' | 'commit' = 'pre';
  let info: I | undefined;
  const finish = (outcome: Outcome, problems: string[], detail: string | null, extra: Record<string, unknown> = {}): Report => {
    const record: Record<string, unknown> = { outcome, exitCode: EXIT_CODE[outcome], statement: STATEMENT[outcome], problems, detail, at: at(), ...extra };
    let recordPersisted = false;
    // An outcome that touched nothing leaves no record file: the output path stays free for the corrected run.
    if (outcome !== 'REFUSED_BEFORE_MUTATION') { try { steps.persist(record); recordPersisted = true; } catch { recordPersisted = false; } }
    return { outcome, exitCode: EXIT_CODE[outcome], statement: STATEMENT[outcome], problems, detail, record, recordPersisted };
  };
  try { await steps.preflight(); } catch (e) { return finish('REFUSED_BEFORE_MUTATION', [], message(e)); }
  let tx: { replay: boolean; info?: I; result?: Record<string, unknown> } | null = null;
  try {
    tx = await steps.transact({ writing: () => { phase = 'writing'; }, commitNext: (i) => { info = i; phase = 'commit'; } });
  } catch (e) {
    if (phase === 'pre') return finish('REFUSED_BEFORE_MUTATION', [], message(e));
    // Thrown inside the open transaction body: COMMIT was never issued, so the server cannot have committed it.
    if (phase === 'writing') return finish('ROLLED_BACK', [], message(e));
    // Thrown at the commit boundary: the driver does not know. Ask a fresh read-only session; assume nothing.
    let seen: 'unchanged' | 'applied' | 'other' | 'unreadable' = 'unreadable';
    try { seen = await steps.probe(info as I); } catch { seen = 'unreadable'; }
    if (seen === 'unchanged') return finish('ROLLED_BACK', [], `the commit did not complete (${message(e)}); a fresh read-only session sees the pre-transaction state`);
    if (seen !== 'applied') return finish('OUTCOME_UNDETERMINED', [], `the commit boundary failed (${message(e)}) and the live state was ${seen === 'other' ? 'neither the baseline nor the planned result' : 'unreadable'}`);
    tx = { replay: false, info: info as I };
  }
  if (tx.replay) return finish('NOTHING_WRITTEN', [], null, tx.result ?? {});
  let problems: string[];
  try { problems = await steps.verify((tx.info ?? info) as I); } catch (e) { return finish('COMMITTED_VERIFICATION_UNAVAILABLE', [], message(e), tx.result ?? {}); }
  return problems.length ? finish('COMMITTED_VERIFICATION_FAILED', problems, null, tx.result ?? {}) : finish('COMMITTED_VERIFIED', [], null, tx.result ?? {});
}

/** The lines a tool prints for a report. The statement is fixed text, so a committed outcome can never print "rolled back" as its state. */
export function reportLines(r: Report): string[] {
  const lines = [`OUTCOME ${r.outcome} (exit ${r.exitCode})`, r.statement];
  if (r.detail) lines.push(`detail: ${r.detail}`);
  for (const p of r.problems) lines.push(`problem: ${p}`);
  if (!r.recordPersisted && r.outcome !== 'REFUSED_BEFORE_MUTATION') lines.push(`the output record could not be written; its content follows (no secrets): ${JSON.stringify(r.record)}`);
  return lines;
}

/* ------------------------------------------------------------------------------------------------------------------------------------- */
/* 2. Restore-evidence assembly seal                                                                                                     */
/* ------------------------------------------------------------------------------------------------------------------------------------- */

export const ASSEMBLY_FORMAT = 'afldb.gap029.restore-evidence-assembly.1';
export const ISOLATED_DB = /^afldb_v2_[a-z0-9_]+_test$/;
export const ISOLATED_CLUSTER = 'afldb_v2_isolated';
export const ISOLATED_COMMENT = 'afldb-v2-isolated-test';
export interface TargetId { host: string; port: number; database: string; user: string; systemIdentifier: string; databaseOid: string; clusterName: string; databaseComment: string | null }

/** Adds the seal to a backup object whose `assembly` block has everything but `sealedBody` / `sealedBodySha256`. */
export function sealAssembly(backup: Record<string, unknown>): Record<string, unknown> {
  const a = (backup.assembly ?? {}) as Record<string, unknown>;
  if ('sealedBody' in a || 'sealedBodySha256' in a) throw new Error('assembly is already sealed');
  const sealedBody = canonJson(backup);
  return { ...backup, assembly: { ...a, sealedBody, sealedBodySha256: sha256(sealedBody) } };
}

export interface AssemblyContext {
  operation: string; stage: string; revision: string; now: number; target: TargetId;
  /** sha256 of the CURRENT bytes of every file the stage's behaviour depends on, keyed by repository path. */
  toolSha256: Record<string, string>;
  /** The stage-specific top-level fields the tool is about to rely on; they must equal what the restore derived. */
  stageFields: Record<string, unknown>;
  /** Stage inputs that must equal what the restore derivation used (for S2: the child sha256 and label). */
  inputs?: Record<string, unknown>;
}

/** Every reason a production plan must not trust this backup evidence, or null. Pure. */
export function assemblyProblem(backup: Record<string, unknown> | null | undefined, ctx: AssemblyContext): string | null {
  const a = backup?.assembly as Record<string, any> | undefined;
  if (!backup || !a || typeof a !== 'object') return 'backup evidence is not machine-assembled (no assembly block); hand-written backup evidence is refused';
  if (typeof a.sealedBody !== 'string' || typeof a.sealedBodySha256 !== 'string') return 'backup evidence assembly seal is missing';
  if (sha256(a.sealedBody) !== a.sealedBodySha256) return 'backup evidence seal digest differs from its sealed body (the seal was edited)';
  let parsed: unknown;
  try { parsed = JSON.parse(a.sealedBody); } catch { return 'backup evidence sealed body is not JSON'; }
  const { sealedBody: _b, sealedBodySha256: _h, ...rest } = a;
  if (!sameJson(parsed, { ...backup, assembly: rest })) return 'backup evidence differs from its sealed body (a field was edited after assembly)';
  if (a.format !== ASSEMBLY_FORMAT) return 'backup evidence assembly format is not recognised';
  if (a.operation !== ctx.operation || a.stage !== ctx.stage) return `backup evidence was assembled for ${String(a.stage)}/${String(a.operation)}, not ${ctx.stage}/${ctx.operation}`;
  if (a.revision !== ctx.revision) return `backup evidence was assembled at revision ${String(a.revision).slice(0, 12)}, the current revision is ${ctx.revision.slice(0, 12)}; re-assemble`;
  const have = (a.inputs?.toolSha256 ?? {}) as Record<string, string>;
  for (const [path, digest] of Object.entries(ctx.toolSha256)) if (have[path] !== digest) return `${path} differs from the bytes the restore evidence was derived with; re-assemble`;
  for (const path of Object.keys(have)) if (!(path in ctx.toolSha256)) return `backup evidence names an unexpected tool file ${path}`;
  for (const [k, v] of Object.entries(ctx.inputs ?? {})) if (!sameJson(a.inputs?.[k], v)) return `backup evidence was derived with a different ${k} than this plan uses`;
  const rt = a.restoreTarget as TargetId | undefined;
  if (!rt || !ISOLATED_DB.test(rt.database) || rt.clusterName !== ISOLATED_CLUSTER || rt.databaseComment !== ISOLATED_COMMENT) return 'the restore target is not a marked isolated test database';
  if (rt.systemIdentifier === ctx.target.systemIdentifier) return 'the restore target is the production cluster; a restore must be verified off production';
  const t = { captured: Date.parse(String(backup.capturedAt)), restored: Date.parse(String(backup.restoredAt)), assembled: Date.parse(String(a.assembledAt)) };
  if (!(t.captured <= t.restored && t.restored <= t.assembled && t.assembled <= ctx.now)) return 'backup evidence timestamps are out of order (captured, restored, assembled)';
  if (!freshAt(backup.capturedAt, ctx.now) || !freshAt(backup.restoredAt, ctx.now) || !freshAt(a.assembledAt, ctx.now)) return 'backup evidence is older than 24 hours';
  if (a.inputs?.dumpSha256 !== backup.sha256 || a.inputs?.restoreEvidenceSha256 !== backup.restoreEvidenceSha256) return 'backup evidence inputs do not match the backup and restore-evidence hashes';
  if (!sameJson(a.derived?.values, ctx.stageFields)) return 'backup evidence stage values differ from what the restore derivation recorded';
  for (const [k, v] of Object.entries(ctx.stageFields)) if (!sameJson((backup as Record<string, unknown>)[k], v)) return `backup evidence field ${k} differs from the value the plan relies on`;
  return null;
}
