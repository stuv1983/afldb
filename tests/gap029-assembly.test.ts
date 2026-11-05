/** V2-GAP-029: machine-generated restore evidence. The assembler's pure parts, the tamper-evident seal, and the cross-language contract (the
 * TypeScript assembler seals; the TypeScript stages and the Python stages must accept exactly the same files and refuse exactly the same edits). */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASSEMBLY_FORMAT, assemblyProblem, canonJson, sealAssembly, sha256, type AssemblyContext, type TargetId } from '../tools/v2/gap029-common';
import { buildBackup, restoreEvidenceProblem, stageFieldsFrom, RESTORE_EVIDENCE_FORMAT, type RestoreEvidence } from '../tools/v2/gap029-assemble-restore-evidence';

const root = join(__dirname, '..');
const NOW = Date.parse('2026-11-03T06:00:00.000Z');
const h = (c: string) => c.repeat(64);
const PROD: TargetId = { host: 'localhost', port: 5432, database: 'afldb_prod', user: 'afldb_import', systemIdentifier: '7674454702926115004', databaseOid: '66668', clusterName: '16/main', databaseComment: null };
const RESTORE: TargetId = { host: '127.0.0.1', port: 55493, database: 'afldb_v2_gap029s2_rst_test', user: 'afldb_owner', systemIdentifier: '7703306842500590472', databaseOid: '32242', clusterName: 'afldb_v2_isolated', databaseComment: 'afldb-v2-isolated-test' };
const EV: RestoreEvidence = {
  format: RESTORE_EVIDENCE_FORMAT, revision: 'f'.repeat(40),
  backup: { archive: 'afldb_prod-20261103.dump', sha256: h('a'), bytes: 123, provenanceSha256: h('b') },
  source: { host: 'afldb-prod', database: 'afldb_prod', systemIdentifier: PROD.systemIdentifier, databaseOid: PROD.databaseOid, ledgerRows: 118, ledgerLast: '118_fixtures_unconfirmed_participants.sql' },
  restore: { target: RESTORE, restoredAt: '2026-11-03T05:10:00.000Z', tocEntries: 1648 }, capturedAt: '2026-11-03T05:00:00.000Z', restoredAt: '2026-11-03T05:10:00.000Z',
};
const REV = 'c'.repeat(40);
const TOOLS = { 'tools/v2/x.py': h('1'), 'tools/v2/gap029_common.py': h('2') };

function backupFor(stage: 'S1' | 'S2' | 'S3' | 'S4', fields: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return buildBackup({ stage, revision: REV, assembledAt: '2026-11-03T05:30:00.000Z', productionTarget: PROD, restoreTarget: RESTORE, dumpSha256: h('a'), restoreEvidenceSha256: h('d'),
    capturedAt: EV.capturedAt, restoredAt: EV.restoredAt, toolSha256: TOOLS, stageFields: fields, derivedMode: 'plan --rehearsal', derivedOutputSha256: h('e'), extraInputs: extra });
}
const ctx = (stage: string, operation: string, fields: Record<string, unknown>, over: Partial<AssemblyContext> = {}): AssemblyContext =>
  ({ operation, stage, revision: REV, now: NOW, target: PROD, toolSha256: TOOLS, stageFields: fields, ...over });
const S2_FIELDS = { baselineDigest: h('4'), draftLinkRestorePlanExpect: { after_state_sha256: h('1'), baseline_sha256: h('4'), newly_linked_sha256: h('3'), picks_after_sha256: h('2') }, batchesBefore: 66 };
const S2_INPUTS = { childSha256: h('9'), label: 'annual-html-20260826', parentSha256: h('7') };
const good = () => backupFor('S2', S2_FIELDS, S2_INPUTS);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('restore evidence: what it must prove before it can back a plan', () => {
  const c = { dumpSha256: h('a'), restoreTarget: RESTORE, productionTarget: PROD, now: NOW };
  it('accepts a coherent, fresh record', () => expect(restoreEvidenceProblem(EV, c)).toBeNull());
  it.each([
    ['missing', null, /missing or not/],
    ['another format', { ...EV, format: 'something.else' }, /missing or not/],
    ['another dump', { ...EV, backup: { ...EV.backup, sha256: h('f') } }, /different dump/],
    ['another source database', { ...EV, source: { ...EV.source, systemIdentifier: '1' } }, /different source database/],
    ['another restored database', { ...EV, restore: { ...EV.restore, target: { ...RESTORE, databaseOid: '1' } } }, /different restored database/],
    ['no archive entries', { ...EV, restore: { ...EV.restore, tocEntries: 0 } }, /table-of-contents/],
    ['no ledger', { ...EV, source: { ...EV.source, ledgerRows: 0 } }, /migration ledger/],
    ['restored before captured', { ...EV, capturedAt: '2026-11-03T05:20:00.000Z' }, /out of order/],
    ['restore time disagrees', { ...EV, restore: { ...EV.restore, restoredAt: '2026-11-03T05:11:00.000Z' } }, /out of order/],
    ['stale', { ...EV, capturedAt: '2026-11-01T05:00:00.000Z', restoredAt: '2026-11-01T05:10:00.000Z', restore: { ...EV.restore, restoredAt: '2026-11-01T05:10:00.000Z' } }, /older than 24 hours/],
  ])('refuses %s', (_n, ev, why) => expect(restoreEvidenceProblem(ev, c)).toMatch(why as RegExp));
});

describe('stage values are read from the tool output, validated, and nothing else is accepted', () => {
  it('S1 needs a sha256 baseline digest (its digest already carries the batch count)', () => {
    expect(stageFieldsFrom('S1', { baselineDigest: h('5') })).toEqual({ baselineDigest: h('5') });
    expect(() => stageFieldsFrom('S1', {})).toThrow(/not a sha256/);
  });
  it('S3 binds the production import_batches count too, so a backup taken before another stage committed is refused at plan time', () => {
    expect(stageFieldsFrom('S3', { baselineDigest: h('5'), importBatchesBefore: 69 })).toEqual({ baselineDigest: h('5'), importBatchesBefore: 69 });
    expect(() => stageFieldsFrom('S3', { baselineDigest: 'abc', importBatchesBefore: 69 })).toThrow(/not a sha256/);
    expect(() => stageFieldsFrom('S3', { baselineDigest: h('5') })).toThrow(/not a count/);
  });
  it('I336 (AFLDB-ISSUE-336) binds the baseline digest and the import_batches count, as S3 does', () => {
    expect(stageFieldsFrom('I336', { baselineDigest: h('8'), importBatchesBefore: 70 })).toEqual({ baselineDigest: h('8'), importBatchesBefore: 70 });
    expect(() => stageFieldsFrom('I336', { baselineDigest: h('8') })).toThrow(/not a count/);
    expect(() => stageFieldsFrom('I336', { importBatchesBefore: 70 })).toThrow(/not a sha256/);
  });
  it('S2 needs exactly the four expectation hashes and records the baseline from them', () => {
    const out = { expect: S2_FIELDS.draftLinkRestorePlanExpect, batchesBefore: 66 };
    expect(stageFieldsFrom('S2', out)).toEqual(S2_FIELDS);
    expect(() => stageFieldsFrom('S2', { expect: out.expect })).toThrow(/batchesBefore is not a count/);
    expect(() => stageFieldsFrom('S2', { expect: { ...out.expect, extra: h('0') } })).toThrow(/exactly four/);
    expect(() => stageFieldsFrom('S2', { expect: { ...out.expect, after_state_sha256: 'x' } })).toThrow(/not a sha256/);
  });
  it('S4 needs the content digest, the full-row digest and a batch count', () => {
    const out = { before: { contentDigest: h('6'), fullRowDigest: h('7') }, importBatchesBefore: 41 };
    expect(stageFieldsFrom('S4', out)).toEqual({ baselineDigest: h('7'), siblingContentDigest: h('6'), siblingFullRowDigest: h('7'), siblingImportBatchesBefore: 41 });
    expect(() => stageFieldsFrom('S4', { ...out, importBatchesBefore: -1 })).toThrow(/not a count/);
    expect(() => stageFieldsFrom('S4', { before: {}, importBatchesBefore: 1 })).toThrow(/not a sha256/);
  });
  it('I333 (ISSUE-333 / O1) needs the baseline, operation and new-row digests and the import_batches prefix', () => {
    const out = { baseline: { baselineDigest: h('1'), operationDigest: h('2'), importBatches: { rows: 75, maxId: 82, fullRowDigest: h('4') } }, newRows: { count: 436, digest: h('3') } };
    expect(stageFieldsFrom('I333', out)).toEqual({ baselineDigest: h('1'), i333OperationDigest: h('2'), i333NewRowsDigest: h('3'), i333ImportBatches: { rows: 75, maxId: 82, fullRowDigest: h('4') } });
    expect(() => stageFieldsFrom('I333', { ...out, newRows: { digest: h('3') } })).toThrow(/newRows.count is not a count/);
    expect(() => stageFieldsFrom('I333', { ...out, baseline: { ...out.baseline, importBatches: { rows: 75, maxId: 82 } } })).toThrow(/not a sha256/);
  });
  it('O2 needs the baseline, operation and comparison digests and the other-findings prefix', () => {
    const out = { baseline: { baselineDigest: h('1'), operationDigest: h('2'), operation: { comparison: { digest: h('3') } }, others: { rows: 4, maxId: 4, fullRowDigest: h('4') } } };
    expect(stageFieldsFrom('O2', out)).toEqual({ baselineDigest: h('1'), o2OperationDigest: h('2'), o2ComparisonDigest: h('3'), o2Others: { rows: 4, maxId: 4, fullRowDigest: h('4') } });
    expect(() => stageFieldsFrom('O2', { baseline: { ...out.baseline, operation: {} } })).toThrow(/comparison.digest is not a sha256/);
    expect(() => stageFieldsFrom('O2', { baseline: { ...out.baseline, others: { rows: -1, maxId: 4, fullRowDigest: h('4') } } })).toThrow(/not a count/);
  });
});

describe('the seal: a production plan refuses hand-written, edited, mismatched and stale evidence', () => {
  const c = ctx('S2', 'gap029-draft-link-production', S2_FIELDS, { inputs: S2_INPUTS });
  it('accepts what the assembler produced', () => expect(assemblyProblem(good(), c)).toBeNull());
  it('has the documented shape: format, sealed body, digest of that body, and the stage values both at the top and in the derivation', () => {
    const b = good() as any;
    expect(b.assembly.format).toBe(ASSEMBLY_FORMAT);
    expect(sha256(b.assembly.sealedBody)).toBe(b.assembly.sealedBodySha256);
    expect(b.draftLinkRestorePlanExpect).toEqual(b.assembly.derived.values.draftLinkRestorePlanExpect);
    expect(b.target).toEqual(PROD);
  });
  it('refuses evidence with no assembly block (the old hand-written backup.json)', () => {
    const { assembly: _a, ...hand } = good() as any;
    expect(assemblyProblem(hand, c)).toMatch(/not machine-assembled/);
    expect(assemblyProblem(null, c)).toMatch(/not machine-assembled/);
  });
  it('refuses a hand-picked restore-derived value, even when the digest of the seal is recomputed for the sealed body only', () => {
    const b = clone(good()) as any;
    b.draftLinkRestorePlanExpect.after_state_sha256 = h('0');
    expect(assemblyProblem(b, c)).toMatch(/differs from its sealed body \(a field was edited/);
  });
  it('refuses an edited top-level field of any kind', () => {
    for (const edit of [(b: any) => { b.capturedAt = '2026-11-03T05:59:00.000Z'; }, (b: any) => { b.sha256 = h('b'); }, (b: any) => { b.target.databaseOid = '1'; },
      (b: any) => { b.assembly.revision = 'd'.repeat(40); }, (b: any) => { b.assembly.restoreTarget.database = 'afldb_v2_other_test'; }, (b: any) => { b.assembly.inputs.toolSha256['tools/v2/x.py'] = h('0'); }]) {
      const b = clone(good()) as any; edit(b);
      expect(assemblyProblem(b, c), JSON.stringify(edit.toString())).toMatch(/differs from its sealed body/);
    }
  });
  it('refuses a seal whose digest does not match its body', () => {
    const b = clone(good()) as any; b.assembly.sealedBodySha256 = h('0');
    expect(assemblyProblem(b, c)).toMatch(/seal digest differs/);
    const m = clone(good()) as any; delete m.assembly.sealedBody;
    expect(assemblyProblem(m, c)).toMatch(/seal is missing/);
  });
  it('refuses evidence assembled for another stage or operation', () => {
    expect(assemblyProblem(good(), ctx('S4', 'gap029-sibling-pair', S2_FIELDS, { inputs: S2_INPUTS }))).toMatch(/assembled for S2\/gap029-draft-link-production, not S4/);
  });
  it('refuses evidence from another revision', () => expect(assemblyProblem(good(), { ...c, revision: 'd'.repeat(40) })).toMatch(/assembled at revision cccccccccccc/));
  it('refuses when a tool changed since assembly, or the stage depends on a file the evidence never saw', () => {
    expect(assemblyProblem(good(), { ...c, toolSha256: { ...TOOLS, 'tools/v2/x.py': h('9') } })).toMatch(/tools\/v2\/x.py differs/);
    expect(assemblyProblem(good(), { ...c, toolSha256: { 'tools/v2/x.py': TOOLS['tools/v2/x.py'] } })).toMatch(/unexpected tool file/);
    expect(assemblyProblem(good(), { ...c, toolSha256: { ...TOOLS, 'tools/v2/new.py': h('3') } })).toMatch(/new\.py differs/);
  });
  it('refuses a different child or label than the restore derivation used', () => {
    expect(assemblyProblem(good(), { ...c, inputs: { ...S2_INPUTS, childSha256: h('8') } })).toMatch(/different childSha256/);
    expect(assemblyProblem(good(), { ...c, inputs: { ...S2_INPUTS, label: 'other' } })).toMatch(/different label/);
  });
  it('refuses a restore target that is not a marked isolated test database, or that is the production cluster', () => {
    const mk = (rt: TargetId) => buildBackup({ stage: 'S2', revision: REV, assembledAt: '2026-11-03T05:30:00.000Z', productionTarget: PROD, restoreTarget: rt, dumpSha256: h('a'), restoreEvidenceSha256: h('d'),
      capturedAt: EV.capturedAt, restoredAt: EV.restoredAt, toolSha256: TOOLS, stageFields: S2_FIELDS, derivedMode: 'plan --rehearsal', derivedOutputSha256: h('e'), extraInputs: S2_INPUTS });
    expect(assemblyProblem(mk({ ...RESTORE, database: 'afldb_prod' }), c)).toMatch(/not a marked isolated/);
    expect(assemblyProblem(mk({ ...RESTORE, databaseComment: null }), c)).toMatch(/not a marked isolated/);
    expect(assemblyProblem(mk({ ...RESTORE, systemIdentifier: PROD.systemIdentifier }), c)).toMatch(/production cluster/);
  });
  it('refuses stale or out-of-order timestamps', () => {
    expect(assemblyProblem(good(), { ...c, now: NOW + 25 * 3600_000 })).toMatch(/older than 24 hours/);
    const early = buildBackup({ stage: 'S2', revision: REV, assembledAt: '2026-11-03T05:05:00.000Z', productionTarget: PROD, restoreTarget: RESTORE, dumpSha256: h('a'), restoreEvidenceSha256: h('d'),
      capturedAt: EV.capturedAt, restoredAt: EV.restoredAt, toolSha256: TOOLS, stageFields: S2_FIELDS, derivedMode: 'plan --rehearsal', derivedOutputSha256: h('e'), extraInputs: S2_INPUTS });
    expect(assemblyProblem(early, c)).toMatch(/out of order/);
  });
  it('refuses when the plan relies on a value that differs from what the restore derived', () => {
    expect(assemblyProblem(good(), { ...c, stageFields: { ...S2_FIELDS, baselineDigest: h('0') } })).toMatch(/stage values differ/);
  });
  it('refuses a seal that cannot be sealed twice', () => expect(() => sealAssembly(good())).toThrow(/already sealed/));
});

describe('cross-language: the Python stages accept and refuse exactly what the TypeScript stages do', () => {
  const py = process.env.AFLDB_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
  const hasPy = spawnSync(py, ['--version']).status === 0;
  (hasPy ? it : it.skip)('a sealed fixture is accepted by Python; every single-field edit is refused by Python as it is by TypeScript', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gap029-seal-'));
    try {
      const f = join(dir, 'fixture.json');
      const cases: Record<string, unknown> = { good: good() };
      const edits: Record<string, (b: any) => void> = {
        value: (b) => { b.draftLinkRestorePlanExpect.after_state_sha256 = h('0'); }, captured: (b) => { b.capturedAt = '2026-11-03T05:59:00.000Z'; },
        revision: (b) => { b.assembly.revision = 'd'.repeat(40); }, restore: (b) => { b.assembly.restoreTarget.database = 'afldb_v2_other_test'; },
      };
      for (const [k, e] of Object.entries(edits)) { const b = clone(good()) as any; e(b); cases[k] = b; }
      writeFileSync(f, JSON.stringify({ now: NOW, revision: REV, target: PROD, toolSha256: TOOLS, stageFields: S2_FIELDS, inputs: S2_INPUTS, cases }));
      expect(existsSync(join(root, 'tests/python/gap029_common_contract.py'))).toBe(true);
      const r = spawnSync(py, ['-I', 'tests/python/gap029_common_contract.py', '--verify-fixture', f], { cwd: root, encoding: 'utf8' });
      expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
      const verdicts = JSON.parse(r.stdout.trim().split('\n').at(-1)!) as Record<string, string | null>;
      const c = ctx('S2', 'gap029-draft-link-production', S2_FIELDS, { inputs: S2_INPUTS });
      for (const [k, b] of Object.entries(cases)) {
        const ts = assemblyProblem(b as any, c);
        expect(verdicts[k] === null, `${k}: python=${verdicts[k]} ts=${ts}`).toBe(ts === null);
      }
      expect(verdicts.good).toBeNull();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('TypeScript and Python agree on the canonical form used for the seal', () => {
    expect(canonJson({ b: 1, a: { d: 1, c: [2, { z: 1, y: 2 }] } })).toBe('{"a":{"c":[2,{"y":2,"z":1}],"d":1},"b":1}');
  });
});
