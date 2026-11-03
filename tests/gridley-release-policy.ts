/** GAP-029: policy conformance is separate from strict parity. Never rewrite findings. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { siblingCriterionDisagreement } from './gridley-corpus-support';
import siblingApproval from '../data/reference/gridley-approved-sibling-disagreements.json';

export type PolicyFinding = { board: number; cell: string; row: string; col: string; category: string;
  siblingEvidence?: Parameters<typeof siblingCriterionDisagreement>[0] };
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
  const evidenceDigest = createHash('sha256').update(readFileSync(join(root, siblingApproval.evidence))).digest('hex');
  if (evidenceDigest !== siblingApproval.evidenceSha256 || !siblingApproval.ownerApproved) {
    throw new Error('Gridley sibling approval is stale or absent; review the exact owner-authorized scope');
  }
  // D-GAP029-D3: each extension is an enumerated, hash-pinned cell list; a changed list is stale until re-approved.
  const extensions = (siblingApproval as { extensions?: { evidence: string; evidenceSha256: string }[] }).extensions ?? [];
  for (const extension of extensions) {
    const digest = createHash('sha256').update(readFileSync(join(root, extension.evidence))).digest('hex');
    if (digest !== extension.evidenceSha256) {
      throw new Error('Gridley sibling extension approval is stale; review the exact owner-authorized cells');
    }
  }
  return policy;
}

export function isApprovedGridleyDeferral(finding: PolicyFinding, policy: DeferralPolicy): boolean {
  return finding.category === 'unsupported'
    && [finding.row, finding.col].some((id) => policy.criteria.includes(id))
    && policy.cells.some((cell) => cell.board === finding.board && cell.cell === finding.cell
      && cell.row === finding.row && cell.col === finding.col);
}

export function gridleyPolicyResults<T extends PolicyFinding>(strictFailures: readonly T[], policy: DeferralPolicy) {
  const seen = new Set<string>();
  const approvedDeferrals: T[] = [];
  const approvedDisagreements: T[] = [];
  const unapprovedDifferences: T[] = [];
  for (const finding of strictFailures) {
    const evidence = finding.siblingEvidence;
    // A cell can legitimately carry findings for different players (Lyons and Webster share five cells), so a sibling
    // finding's duplicate key includes the player identity; an exact duplicate (same cell and player) stays unapproved.
    const key = JSON.stringify([finding.board, finding.cell, finding.row, finding.col,
      finding.category === 'criterion disagreement' && evidence ? [evidence.profile, evidence.gridleyPlayerId] : null]);
    const sibling = finding.category === 'criterion disagreement' && evidence
      && evidence.board === finding.board && evidence.cell === finding.cell
      && evidence.row === finding.row && evidence.col === finding.col
      && siblingCriterionDisagreement(evidence) !== null;
    if (!seen.has(key) && isApprovedGridleyDeferral(finding, policy)) approvedDeferrals.push(finding);
    else if (!seen.has(key) && sibling) approvedDisagreements.push(finding);
    else unapprovedDifferences.push(finding);
    seen.add(key);
  }
  return {
    strictCorpusParity: { passed: strictFailures.length === 0, findings: strictFailures.length },
    approvedDeferrals: { findings: approvedDeferrals.length, dataMatches: 0 },
    approvedDisagreements: { findings: approvedDisagreements.length, dataMatches: 0 },
    approvedTotal: { findings: approvedDeferrals.length + approvedDisagreements.length, dataMatches: 0 },
    approvedPolicyConformance: { passed: unapprovedDifferences.length === 0, unapprovedDifferences },
  };
}
