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
