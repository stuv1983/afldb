/** GAP-029: policy conformance is separate from strict parity. Never rewrite findings. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type PolicyFinding = { board: number; cell: string; row: string; col: string; category: string };
type DeferralPolicy = {
  corpusSha256: string;
  criteria: string[];
  cells: { board: number; cell: string; row: string; col: string }[];
};

export function loadGridleyDeferrals(): DeferralPolicy {
  const root = join(__dirname, '..');
  const policy = JSON.parse(readFileSync(join(root, 'data/reference/gridley-approved-deferrals.json'), 'utf8')) as DeferralPolicy;
  const digest = createHash('sha256').update(readFileSync(join(root, 'tests/fixtures/gridley/corpus.json'))).digest('hex');
  if (digest !== policy.corpusSha256) throw new Error('Gridley deferral scope is stale: corpus changed; review the bounded acceptance evidence');
  return policy;
}

export function isApprovedGridleyDeferral(finding: PolicyFinding, policy: DeferralPolicy): boolean {
  return finding.category === 'unsupported'
    && [finding.row, finding.col].some((id) => policy.criteria.includes(id))
    && policy.cells.some((cell) => cell.board === finding.board && cell.cell === finding.cell
      && cell.row === finding.row && cell.col === finding.col);
}

export function gridleyPolicyResults<T extends PolicyFinding>(strictFailures: readonly T[], policy: DeferralPolicy) {
  const approvedDeferrals = strictFailures.filter((finding) => isApprovedGridleyDeferral(finding, policy));
  const unapprovedDifferences = strictFailures.filter((finding) => !isApprovedGridleyDeferral(finding, policy));
  return {
    strictCorpusParity: { passed: strictFailures.length === 0, findings: strictFailures.length },
    approvedDeferrals: { findings: approvedDeferrals.length, dataMatches: 0 },
    approvedPolicyConformance: { passed: unapprovedDifferences.length === 0, unapprovedDifferences },
  };
}
