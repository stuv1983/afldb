import { describe, expect, it } from 'vitest';

import { checkCorrectionApproval, checkCorrectionTransport, correctionHash,
  type CorrectionApproval, type CorrectionPlan, type CorrectionTarget } from '@/db/queries/brownlow-production-correction';

const target: CorrectionTarget = { host: '127.0.0.1', port: 55434, database: 'afldb_v2_correction_test', user: 'afldb_owner',
  systemIdentifier: '123', databaseOid: '456', clusterName: 'isolated', databaseComment: 'isolated' };
const now = '2026-10-20T05:00:00.000Z';
function fixture(operation: CorrectionPlan['request']['operation'] = 'adopt') {
  const body: Omit<CorrectionPlan, 'digest'> = { format: 'afldb.brownlow.production-correction.v1', request: { operation, seasons: [2025] }, target,
    revision: 'a'.repeat(40), createdAt: now, expiresAt: '2026-10-20T06:00:00.000Z', baseline: 'b'.repeat(64), payload: {},
    backup: { target, baselineDigest: 'b'.repeat(64), sha256: 'c'.repeat(64), restoreEvidenceSha256: 'd'.repeat(64), capturedAt: now, restoredAt: now } };
  const plan: CorrectionPlan = { ...body, digest: correctionHash(body) };
  const approval: CorrectionApproval = { planDigest: plan.digest, target, revision: plan.revision, operation, seasons: [2025], source: 'afl_api',
    approvedAt: now, expiresAt: body.expiresAt, reference: 'Explicit owner execution approval for this isolated test' };
  return { plan, approval };
}
const check = (p: CorrectionPlan, a: CorrectionApproval) => checkCorrectionApproval(p, a, p.revision, now);

describe('Brownlow production correction approval boundary', () => {
  it('hashes object keys consistently, while preserving array order', () => {
    expect(correctionHash({ b: 2, a: 1 })).toBe(correctionHash({ a: 1, b: 2 }));
    expect(correctionHash([1, 2])).not.toBe(correctionHash([2, 1]));
  });
  it('accepts only the pinned transport before connection', () => {
    expect(() => checkCorrectionTransport('postgresql://afldb_owner@127.0.0.1:55434/afldb_v2_correction_test', target)).not.toThrow();
    for (const dsn of ['', 'postgresql://afldb_owner@shared:55434/afldb_v2_correction_test',
      'postgresql://afldb_owner@127.0.0.1:5432/afldb_v2_correction_test', 'postgresql://afldb_owner@127.0.0.1:55434/other',
      'postgresql://other@127.0.0.1:55434/afldb_v2_correction_test', 'postgresql://afldb_owner@127.0.0.1:55434/afldb_v2_correction_test?host=shared']) {
      expect(() => checkCorrectionTransport(dsn, target)).toThrow();
    }
  });
  it('accepts a fresh exact execution approval', () => { const { plan, approval } = fixture(); expect(() => check(plan, approval)).not.toThrow(); });
  it('refuses policy-only decisions as execution authority', () => {
    const { plan } = fixture();
    for (const decision of ['D-V2-BROWNLOW-ELIGIBILITY-1', 'OD-BROWNLOW-OWNERSHIP-1', 'D-V2-BROWNLOW-MATCH-BACKFILL-1']) {
      expect(() => check(plan, { reference: decision } as CorrectionApproval)).toThrow();
    }
  });
  it('refuses a missing reference and a mismatched restored baseline even in a self-consistent plan', () => {
    const { plan, approval } = fixture();
    expect(() => check(plan, { ...approval, reference: undefined } as unknown as CorrectionApproval)).toThrow(/approval/);
    plan.backup.baselineDigest = '0'.repeat(64);
    const body = { ...plan } as Partial<CorrectionPlan>; delete body.digest; plan.digest = correctionHash(body);
    expect(() => check(plan, { ...approval, planDigest: plan.digest })).toThrow(/backup baseline/);
  });
  it.each(['planDigest', 'revision', 'target', 'operation', 'seasons', 'source', 'reference', 'expiresAt', 'approvedAt'] as const)('refuses changed approval %s', (key) => {
    const { plan, approval } = fixture();
    const bad: Record<string, unknown> = { planDigest: '0'.repeat(64), revision: 'f'.repeat(40), target: { ...target, databaseOid: '999' },
      operation: 'observe', seasons: [2024], source: 'afltables', reference: '', expiresAt: '2026-10-19T05:00:00Z', approvedAt: '2026-10-19T05:00:00Z' };
    expect(() => check(plan, { ...approval, [key]: bad[key] })).toThrow();
  });
  it('refuses tampered export, stale baseline approval, other source, and 2026', () => {
    const { plan, approval } = fixture();
    expect(() => check({ ...plan, payload: { tampered: true } }, approval)).toThrow(/digest/);
    const old = structuredClone(plan); old.backup.capturedAt = '2026-10-18T05:00:00Z';
    const body = { ...old } as Partial<CorrectionPlan>; delete body.digest; old.digest = correctionHash(body);
    expect(() => check(old, { ...approval, planDigest: old.digest })).toThrow(/backup/);
    const future = structuredClone(plan); future.request.seasons = [2026];
    expect(() => check(future, approval)).toThrow(/2026/);
  });
  it('requires approval of the exact eligibility records', () => {
    const { plan, approval } = fixture('eligibility');
    plan.request.rulings = [{ playerId: 1, identity: 'afltables:players/T/Test.html', verdict: 'ineligible',
      citation: 'https://www.afl.com.au/news/test', note: 'Synthetic test, no real player ruling.', expectedCurrentDecisionId: null }];
    const body = { ...plan } as Partial<CorrectionPlan>; delete body.digest; plan.digest = correctionHash(body); approval.planDigest = plan.digest;
    expect(() => check(plan, approval)).toThrow(/unapproved eligibility/);
    approval.rulings = structuredClone(plan.request.rulings);
    expect(() => check(plan, approval)).not.toThrow();
    approval.rulings[0].citation += '-changed';
    expect(() => check(plan, approval)).toThrow();
  });
});

// F-BRO-1 / stage B0: the governed 2025 fixture-identity prerequisite (observe + stage).
describe('Brownlow fixture-identity prerequisite (stage B0)', () => {
  const STAGE = 'fixture-identities-2025' as const;
  const stageFixture = () => {
    const f = fixture('observe');
    const body = { ...f.plan } as Partial<CorrectionPlan>; delete body.digest;
    body.request = { operation: 'observe', seasons: [2025], stage: STAGE, observation: { stage: STAGE } };
    f.plan.request = body.request!; f.plan.digest = correctionHash(body); f.approval.planDigest = f.plan.digest; f.approval.stage = STAGE;
    return f;
  };
  it('accepts an approval that names the stage', () => { const { plan, approval } = stageFixture(); expect(() => check(plan, approval)).not.toThrow(); });
  it('refuses an approval without the stage, and a stage approval for an ordinary observe plan', () => {
    const s = stageFixture();
    expect(() => check(s.plan, { ...s.approval, stage: undefined })).toThrow(/stage/);
    const o = fixture('observe');
    expect(() => check(o.plan, { ...o.approval, stage: STAGE })).toThrow(/stage/);
  });
  it('refuses a stage on any other operation and an unknown stage', () => {
    for (const bad of [{ operation: 'adopt', stage: STAGE }, { operation: 'observe', stage: 'anything-else' }] as const) {
      const f = fixture('observe'); const body = { ...f.plan } as Partial<CorrectionPlan>; delete body.digest;
      body.request = { operation: bad.operation, seasons: [2025], stage: bad.stage as typeof STAGE };
      f.plan.request = body.request!; f.plan.digest = correctionHash(body); f.approval.planDigest = f.plan.digest; f.approval.operation = bad.operation;
      expect(() => check(f.plan, { ...f.approval, stage: bad.stage as typeof STAGE })).toThrow(/stage/);
    }
  });
  it('refuses every snapshot other than the pinned one before reading anything', async () => {
    const { loadFixturePrerequisite } = await import('../tools/v2/brownlow-fixture-prerequisite');
    expect(() => loadFixturePrerequisite('/nonexistent-root', 'afl-api-2025-2026-10-21-000000')).toThrow(/only the pinned snapshot/);
    expect(() => loadFixturePrerequisite('/nonexistent-root', '../fixtures/afl-api-2025-2026-10-20-014218')).toThrow(/only the pinned snapshot/);
  });
  it('refuses a manifest whose bytes differ from the pin', async () => {
    const { loadFixturePrerequisite, FIXTURE_PREREQUISITE_PIN } = await import('../tools/v2/brownlow-fixture-prerequisite');
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
    const root = mkdtempSync(join(tmpdir(), 'b0-pin-'));
    const dir = join(root, 'data', 'sources', 'afl_api', 'fixtures', FIXTURE_PREREQUISITE_PIN.label);
    mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'manifest.json'), '{"season":2025}');
    expect(() => loadFixturePrerequisite(root, FIXTURE_PREREQUISITE_PIN.label)).toThrow(/differs from the pinned bytes/);
  });
  const retainedRoot = process.env.AFLDB_B0_RETAINED_ROOT;
  it.skipIf(!retainedRoot)('loads the retained authentic snapshot: 212 records, four finals refusals, stable digest', async () => {
    const { loadFixturePrerequisite, FIXTURE_PREREQUISITE_PIN } = await import('../tools/v2/brownlow-fixture-prerequisite');
    const a = loadFixturePrerequisite(retainedRoot!, FIXTURE_PREREQUISITE_PIN.label);
    const b = loadFixturePrerequisite(retainedRoot!, FIXTURE_PREREQUISITE_PIN.label);
    expect(a.records).toHaveLength(212);
    expect(a.observation.refusedProviderMatchIds).toEqual([...FIXTURE_PREREQUISITE_PIN.refusedProviderMatchIds]);
    expect(a.observation.recordsDigest).toBe(b.observation.recordsDigest);
    expect(a.observation.manifestSha256).toBe(FIXTURE_PREREQUISITE_PIN.manifestSha256);
  });
  it.skipIf(!retainedRoot)('refuses a single changed byte in a retained fixture file', async () => {
    const { loadFixturePrerequisite, FIXTURE_PREREQUISITE_PIN } = await import('../tools/v2/brownlow-fixture-prerequisite');
    const { cpSync, mkdtempSync, readFileSync, writeFileSync, chmodSync } = await import('node:fs');
    const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
    const root = mkdtempSync(join(tmpdir(), 'b0-drift-')); cpSync(join(retainedRoot!, 'data'), join(root, 'data'), { recursive: true });
    const file = join(root, 'data', 'sources', 'afl_api', 'fixtures', FIXTURE_PREREQUISITE_PIN.label, '00-season-matches.json');
    chmodSync(file, 0o644); writeFileSync(file, `${readFileSync(file, 'utf8')} `);
    expect(() => loadFixturePrerequisite(root, FIXTURE_PREREQUISITE_PIN.label)).toThrow(/sha256 mismatch/);
  });
});
