/** V2-GAP-029: the failure semantics of the production entry points. The apply runner classifies where a failure surfaced and never claims a rollback
 * for a state that may have committed; a committed outcome is never retried or restored. Pure tests with injected steps: the database-backed
 * negative controls run on the isolated clusters (docs/v2/evidence/gap029-hardening-20261103/). */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXIT_CODE, OUTCOMES, STATEMENT, isCommitted, reportLines, runApply, type ApplySteps, type Marks, type Outcome } from '../tools/v2/gap029-common';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
interface Info { n: number }
const INFO: Info = { n: 8 };
const at = () => '2026-11-03T00:00:00.000Z';

/** Steps whose behaviour at each point is scripted; `calls` records every step that ran, in order. */
function script(over: Partial<{
  preflight: () => Promise<void>; transact: (m: Marks<Info>) => Promise<{ replay: boolean; info?: Info; result?: Record<string, unknown> }>;
  verify: (i: Info) => Promise<string[]>; probe: (i: Info) => Promise<'unchanged' | 'applied' | 'other'>; persist: (r: Record<string, unknown>) => void;
}> = {}) {
  const calls: string[] = []; const records: Record<string, unknown>[] = [];
  const steps: ApplySteps<Info> = {
    preflight: async () => { calls.push('preflight'); await over.preflight?.(); },
    transact: async (m) => { calls.push('transact'); return over.transact ? over.transact(m) : (m.writing(), m.commitNext(INFO), { replay: false, info: INFO, result: { written: 8 } }); },
    verify: async (i) => { calls.push('verify'); return over.verify ? over.verify(i) : []; },
    probe: async (i) => { calls.push('probe'); if (!over.probe) throw new Error('probe must not run'); return over.probe(i); },
    persist: (r) => { calls.push('persist'); if (over.persist) over.persist(r); else records.push(r); },
  };
  return { steps, calls, records };
}

describe('GAP-029 outcome taxonomy', () => {
  it('has seven outcomes, each with a fixed statement and a stable exit code; only the two success outcomes exit 0', () => {
    expect([...OUTCOMES].sort()).toEqual(['COMMITTED_VERIFICATION_FAILED', 'COMMITTED_VERIFICATION_UNAVAILABLE', 'COMMITTED_VERIFIED', 'NOTHING_WRITTEN', 'OUTCOME_UNDETERMINED', 'REFUSED_BEFORE_MUTATION', 'ROLLED_BACK']);
    expect(Object.keys(STATEMENT).sort()).toEqual([...OUTCOMES].sort());
    expect(OUTCOMES.filter((o) => EXIT_CODE[o] === 0).sort()).toEqual(['COMMITTED_VERIFIED', 'NOTHING_WRITTEN']);
    expect(new Set(OUTCOMES.map((o) => EXIT_CODE[o])).size).toBe(6); // 0 shared by the two successes only
    expect(EXIT_CODE).toEqual({ COMMITTED_VERIFIED: 0, NOTHING_WRITTEN: 0, REFUSED_BEFORE_MUTATION: 1, ROLLED_BACK: 2, COMMITTED_VERIFICATION_FAILED: 3, COMMITTED_VERIFICATION_UNAVAILABLE: 4, OUTCOME_UNDETERMINED: 5 });
  });

  it('never says a committed or undetermined state was rolled back, and says restore is the owner\'s separate decision', () => {
    for (const o of OUTCOMES) {
      const s = STATEMENT[o];
      if (isCommitted(o) && o !== 'COMMITTED_VERIFIED') {
        expect(s).toContain('COMMITTED');
        expect(s).toContain('NOT rolled back');
        expect(s).toMatch(/will not retry, reverse or restore/);
        expect(s).toMatch(/separate OWNER decision/);
        expect(s).toMatch(/discard every write made to the database after the backup was taken/);
        expect(s).toMatch(/nothing is restored automatically/);
      }
      if (o !== 'ROLLED_BACK') expect(s).not.toContain('ROLLED BACK:');
    }
    expect(STATEMENT.OUTCOME_UNDETERMINED).toMatch(/Do NOT assume it rolled back and do NOT retry/);
    expect(STATEMENT.COMMITTED_VERIFIED).not.toMatch(/rolled back/i);
  });
});

describe('runApply: where a failure surfaced decides what may be claimed', () => {
  it('REFUSED_BEFORE_MUTATION when the preflight throws; the transaction is never opened; no record file is left', async () => {
    const s = script({ preflight: async () => { throw new Error('stale plan'); } });
    const r = await runApply(s.steps, at);
    expect(r.outcome).toBe('REFUSED_BEFORE_MUTATION'); expect(r.exitCode).toBe(1);
    expect(s.calls).toEqual(['preflight']); expect(r.recordPersisted).toBe(false);
  });

  it('REFUSED_BEFORE_MUTATION when the transaction body throws BEFORE its first write (baseline drift, actor not viable)', async () => {
    const s = script({ transact: async () => { throw new Error('baseline drift'); } });
    const r = await runApply(s.steps, at);
    expect(r.outcome).toBe('REFUSED_BEFORE_MUTATION'); expect(s.calls).toEqual(['preflight', 'transact']);
  });

  it('ROLLED_BACK when the body throws AFTER its first write: COMMIT was never issued, so no probe is needed or run', async () => {
    const s = script({ transact: async (m) => { m.writing(); throw new Error('post-write verification failed; rolled back'); } });
    const r = await runApply(s.steps, at);
    expect(r.outcome).toBe('ROLLED_BACK'); expect(r.exitCode).toBe(2);
    expect(s.calls).toEqual(['preflight', 'transact', 'persist']); // never verify, never probe
  });

  it('NOTHING_WRITTEN on a replay (every reviewed row already present)', async () => {
    const s = script({ transact: async () => ({ replay: true }) });
    const r = await runApply(s.steps, at);
    expect(r.outcome).toBe('NOTHING_WRITTEN'); expect(r.exitCode).toBe(0); expect(s.calls).not.toContain('verify');
  });

  it('COMMITTED_VERIFIED only after the independent check passes', async () => {
    const s = script();
    const r = await runApply(s.steps, at);
    expect(r.outcome).toBe('COMMITTED_VERIFIED'); expect(r.exitCode).toBe(0);
    expect(s.calls).toEqual(['preflight', 'transact', 'verify', 'persist']);
    expect(r.record).toMatchObject({ outcome: 'COMMITTED_VERIFIED', written: 8 });
  });

  it('COMMITTED_VERIFICATION_FAILED when the independent check finds differences; the change is NOT claimed rolled back; nothing is retried', async () => {
    const s = script({ verify: async () => ['a pre-existing row differs'] });
    const r = await runApply(s.steps, at);
    expect(r.outcome).toBe('COMMITTED_VERIFICATION_FAILED'); expect(r.exitCode).toBe(3);
    expect(r.problems).toEqual(['a pre-existing row differs']);
    expect(reportLines(r).join('\n')).toContain('NOT rolled back');
    expect(s.calls.filter((c) => c === 'transact')).toHaveLength(1); // a single attempt: no retry
  });

  it('COMMITTED_VERIFICATION_UNAVAILABLE when the independent check cannot run (connection lost after COMMIT)', async () => {
    const s = script({ verify: async () => { throw new Error('connect ECONNREFUSED'); } });
    const r = await runApply(s.steps, at);
    expect(r.outcome).toBe('COMMITTED_VERIFICATION_UNAVAILABLE'); expect(r.exitCode).toBe(4);
    expect(r.detail).toContain('ECONNREFUSED');
    expect(reportLines(r).join('\n')).toMatch(/NOT rolled back/);
    expect(s.calls.filter((c) => c === 'transact')).toHaveLength(1);
  });

  describe('a failure at the COMMIT boundary is never assumed', () => {
    const atCommit = (probe: (i: Info) => Promise<'unchanged' | 'applied' | 'other'>, verify?: (i: Info) => Promise<string[]>) => script({
      transact: async (m) => { m.writing(); m.commitNext(INFO); throw new Error('Connection terminated during COMMIT'); }, probe, ...(verify ? { verify } : {}),
    });
    it('ROLLED_BACK only when a fresh read-only session sees the pre-transaction state', async () => {
      const s = atCommit(async () => 'unchanged');
      const r = await runApply(s.steps, at);
      expect(r.outcome).toBe('ROLLED_BACK'); expect(r.detail).toMatch(/fresh read-only session sees the pre-transaction state/);
      expect(s.calls).toEqual(['preflight', 'transact', 'probe', 'persist']);
    });
    it('the change is treated as COMMITTED when the probe sees the planned result, then verified like any commit', async () => {
      const ok = await runApply(atCommit(async () => 'applied').steps, at);
      expect(ok.outcome).toBe('COMMITTED_VERIFIED');
      const bad = await runApply(atCommit(async () => 'applied', async () => ['count differs']).steps, at);
      expect(bad.outcome).toBe('COMMITTED_VERIFICATION_FAILED');
      const gone = await runApply(atCommit(async () => 'applied', async () => { throw new Error('down'); }).steps, at);
      expect(gone.outcome).toBe('COMMITTED_VERIFICATION_UNAVAILABLE');
    });
    it('OUTCOME_UNDETERMINED when the state is neither, or the probe itself fails: no rollback claim, no retry', async () => {
      for (const probe of [async () => 'other' as const, async () => { throw new Error('probe down'); }]) {
        const s = atCommit(probe);
        const r = await runApply(s.steps, at);
        expect(r.outcome).toBe('OUTCOME_UNDETERMINED'); expect(r.exitCode).toBe(5);
        expect(r.statement).toMatch(/Do NOT assume it rolled back and do NOT retry/);
        expect(s.calls.filter((c) => c === 'transact')).toHaveLength(1);
      }
    });
  });

  it('a record that cannot be written never changes the outcome; its content is printed instead', async () => {
    const s = script({ persist: () => { throw new Error('EEXIST'); } });
    const r = await runApply(s.steps, at);
    expect(r.outcome).toBe('COMMITTED_VERIFIED'); expect(r.recordPersisted).toBe(false);
    expect(reportLines(r).join('\n')).toContain('the output record could not be written');
  });

  it('does not touch the database on its own: the runner has no restore, retry or reverse step', () => {
    const src = read('tools/v2/gap029-common.ts');
    expect(src).not.toMatch(/pg_restore|createdb|dropdb|psql\b|spawn|exec\(/);
    expect(src).not.toMatch(/while\s*\(|for\s*\(\s*let attempt|retry\(/);
    expect(read('tools/v2/gap029_common.py')).not.toMatch(/pg_restore|createdb|dropdb|import subprocess|retry\(|while True/);
  });
});

describe('every production tool routes its apply through the runner and never restores', () => {
  const tools = ['tools/v2/gap029-captaincy-additions-production.ts', 'tools/v2/gap029-rookie-selections-production.ts', 'tools/v2/gap029-draft-link-production.py', 'tools/v2/gap029-sibling-pair-production.py'];
  it.each(tools)('%s', (t) => {
    const src = read(t);
    expect(src).toMatch(t.endsWith('.ts') ? /runApply</ : /run_apply\(/);
    expect(src).not.toMatch(/pg_restore|createdb|dropdb|--clean\b/);
    expect(src).not.toMatch(/RESTORE REQUIRED/); // the old wording read as an instruction; a restore is an owner decision, stated by the runner
    expect(src).toMatch(/assembly/i); // a production plan requires machine-assembled evidence
    expect(src).toMatch(/\bstate\b/); // the read-only classification mode
  });
  it('the two TypeScript tools keep their enforceable checks INSIDE the transaction (marks.writing precedes the first write; commitNext is last)', () => {
    for (const t of tools.filter((x) => x.endsWith('.ts'))) {
      const src = read(t);
      const body = src.slice(src.indexOf('transact: (marks)'));
      expect(body.indexOf('marks.writing()')).toBeGreaterThan(-1);
      expect(body.indexOf('marks.writing()')).toBeLessThan(body.indexOf('marks.commitNext('));
      expect(body.slice(0, body.indexOf('marks.commitNext(')).match(/fail\(/g)?.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('Python stages (S2 draft link-only, S4 sibling pair): the same semantics, held by the DB-free contract', () => {
  const py = process.env.AFLDB_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
  const hasPy = spawnSync(py, ['--version']).status === 0;
  (hasPy ? it : it.skip)('tests/python/gap029_common_contract.py passes (writer exit codes are never trusted; the probe decides; committed states are never called rolled back)', () => {
    const r = spawnSync(py, ['tests/python/gap029_common_contract.py'], { cwd: root, encoding: 'utf8' });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stdout).toContain('All GAP-029 common checks hold.');
    expect(r.stdout).not.toContain('FAIL ');
  });
});
