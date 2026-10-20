/** Offline preservation policy. Hashes are evidence, never replacements for a production backup. */
import { createHash } from 'node:crypto';

import { V2_ADDED_TABLES } from '@afldb/domain';
import { validateShadowParityReport } from '@afldb/derived';

export const REQUIRED_PUBLIC_QUERIES = ['match_detail', 'player_registration', 'player_participation', 'brownlow_raw', 'award_publication', 'audit_history'] as const;
export const REQUIRED_PRESERVED_TABLES = ['public.players', 'public.clubs', 'public.matches', 'public.player_clubs',
  'public.player_match_stats', 'public.brownlow_season_votes', 'public.brownlow_round_votes',
  'public.awards', 'public.award_winners', 'public.auth_audit_log', 'afldb_meta.schema_migrations'] as const;
export type GateResult = 'PASS' | 'FAIL' | 'INCOMPLETE';
export interface PreservationSnapshot {
  format: 'afldb.v2.preservation.1';
  /** Same immutable archive, query contract, seal and controlled phase on both sides. */
  scope: { backupSha256: string; queryContractSha256: string; seal: number; phase: 'migration' };
  tables: Record<string, { definition: string; rows: string[] }>;
  queries: Record<string, string>;
}
export const digest = (text: string): string => createHash('sha256').update(text).digest('hex');
const hash = (x: unknown): x is string => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);

export function validSnapshot(x: unknown): x is PreservationSnapshot {
  if (!x || typeof x !== 'object') return false;
  const s = x as PreservationSnapshot;
  return s.format === 'afldb.v2.preservation.1' && !!s.scope && hash(s.scope.backupSha256)
    && hash(s.scope.queryContractSha256) && Number.isInteger(s.scope.seal) && s.scope.phase === 'migration'
    && !!s.tables && Object.keys(s.tables).length > 0
    && Object.entries(s.tables).every(([name, t]) => /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(name)
      && !!t && hash(t.definition) && Array.isArray(t.rows) && t.rows.every(hash))
    && !!s.queries && REQUIRED_PUBLIC_QUERIES.every(q => hash(s.queries[q]));
}

export function comparePreservation(before: unknown, after: unknown): { result: GateResult; findings: string[] } {
  if (!validSnapshot(before) || !validSnapshot(after)) return { result: 'INCOMPLETE', findings: ['Required complete preservation snapshots missing or invalid'] };
  if (!REQUIRED_PRESERVED_TABLES.every(t => Object.hasOwn(before.tables, t))) return { result: 'INCOMPLETE', findings: ['Baseline omits required preservation tables'] };
  if (JSON.stringify(before.scope) !== JSON.stringify(after.scope)) return { result: 'INCOMPLETE', findings: ['Snapshots are not like-for-like: archive, contract, seal or phase differs'] };
  const findings: string[] = [];
  for (const [name, b] of Object.entries(before.tables)) {
    const a = after.tables[name];
    if (!a) { findings.push(`${name}: TABLE_LOST`); continue; }
    if (a.definition !== b.definition) findings.push(`${name}: DEFINITION_OR_RELATIONSHIP_CHANGED`);
    // A multiset preserves duplicate rows and every value, including IDs, NULLs and FK values.
    const available = new Map<string, number>();
    for (const row of a.rows) available.set(row, (available.get(row) ?? 0) + 1);
    for (const row of b.rows) {
      const n = available.get(row) ?? 0;
      if (n === 0) { findings.push(`${name}: ROW_CONTENT_OR_ID_LOST`); break; }
      available.set(row, n - 1);
    }
  }
  for (const name of Object.keys(after.tables)) {
    if (!(name in before.tables) && !V2_ADDED_TABLES.some(t => `${t.schema}.${t.table}` === name)) findings.push(`${name}: UNAPPROVED_TABLE_ADDED`);
  }
  for (const q of REQUIRED_PUBLIC_QUERIES) if (before.queries[q] !== after.queries[q]) findings.push(`${q}: PUBLIC_OUTPUT_CHANGED`);
  // No correction is approved by the migration-separation decision. Existing Gridley decisions
  // are comparison adjudications, not permission to mutate production rows. Exact corrections
  // require a separate owner-bound policy revision; no blanket ignore/allow flag exists.
  return { result: findings.length ? 'FAIL' : 'PASS', findings };
}

export interface EvidenceResult { result: GateResult; evidence: string[] }
export function evidenceResult(value: unknown): GateResult {
  if (!value || typeof value !== 'object') return 'INCOMPLETE';
  const v = value as EvidenceResult;
  if (!['PASS', 'FAIL', 'INCOMPLETE'].includes(v.result) || !Array.isArray(v.evidence) || !v.evidence.length
    || !v.evidence.every(e => typeof e === 'string' && e.trim().length > 0)) return 'INCOMPLETE';
  return v.result;
}

const evidenceGroup = (value: unknown, required: string[]): GateResult => {
  if (!value || typeof value !== 'object') return 'INCOMPLETE';
  const v = value as Record<string, unknown>;
  const results = required.map(k => evidenceResult(v[k]));
  return results.includes('FAIL') ? 'FAIL' : results.includes('INCOMPLETE') ? 'INCOMPLETE' : 'PASS';
};

/**
 * Owner decision D-V2-BROWNLOW-ALT-1 (docs/v2/migration-acceptance-2026-10-20.md). Solely for this
 * archive and the migration-only transition 110 -> 111..115, alternative stored-data evidence stands in
 * for the unavailable staged Brownlow before/after comparator. It is NOT authentic API vote, identity
 * or leaderboard reconciliation, and approves no ingestion, publication, deployment or production GO.
 */
export const APPROVED_BROWNLOW_ALTERNATIVE = {
  decision: 'D-V2-BROWNLOW-ALT-1',
  archiveSha256: 'a583fc7d8d4376aa816253adf299a1325da7e65c994576b6b56bfa136ed11b04',
  migrationScope: { from: 110, to: 115 },
  seasons: 98,
} as const;

export const BROWNLOW_OPERATIONAL_REQUIREMENT = 'OUTSTANDING: authentic provenance/checksum-verified completed-season '
  + 'API vote, identity and leaderboard reconciliation is still required before Brownlow operational/publication readiness';

export type BrownlowAlternativeStatus = 'APPLIED' | 'NOT_REQUIRED' | 'NOT_APPLIED' | 'FAILED';
const record = (x: unknown): Record<string, unknown> | undefined =>
  x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : undefined;
const passedAll = (x: unknown): 'PASS' | 'FAIL' | 'INCOMPLETE' => {
  const r = record(x), result = evidenceResult(x);
  if (!r || result === 'INCOMPLETE') return 'INCOMPLETE';
  const { passed, total } = r;
  if (!Number.isInteger(passed) || !Number.isInteger(total) || (total as number) <= 0) return 'INCOMPLETE';
  return result === 'FAIL' || passed !== total ? 'FAIL' : 'PASS';
};

/** Identical complete before/after stored-data reports across exactly the approved number of seasons. */
const storedReportsResult = (x: unknown, seasons: number): GateResult => {
  const r = record(x), result = evidenceResult(x);
  if (!r || result !== 'PASS') return result;
  if (!hash(r.beforeSha256) || !hash(r.afterSha256) || !Number.isInteger(r.seasons)) return 'INCOMPLETE';
  return r.seasons === seasons && r.beforeSha256 === r.afterSha256 ? 'PASS' : 'FAIL';
};

/** Applies only when every condition holds; it can never turn a FAIL or any other missing evidence into PASS. */
export function assessBrownlowAlternative(input: { alternative?: unknown; before?: unknown; preservation: GateResult; parity?: unknown }) {
  const A = APPROVED_BROWNLOW_ALTERNATIVE;
  const reasons: string[] = [];
  const out = (status: BrownlowAlternativeStatus) => ({ decision: A.decision, status, reasons,
    scope: { archiveSha256: A.archiveSha256, migrationScope: A.migrationScope, seasons: A.seasons },
    notEstablished: 'authentic AFL API vote, identity or leaderboard reconciliation' });
  const report = validateShadowParityReport(input.parity).length === 0
    ? input.parity as { checks: { id: string; status: string }[] } : undefined;
  const status = (id: string) => report?.checks.find(c => c.id === id)?.status;
  if (status('brownlow') === 'pass' && report && report.checks.every(c => c.status === 'pass')) return out('NOT_REQUIRED');
  const alt = record(input.alternative);
  if (!alt) { reasons.push('No Brownlow alternative attestation supplied'); return out('NOT_APPLIED'); }
  const scope = record(alt.migrationScope);
  if (alt.decision !== A.decision || alt.archiveSha256 !== A.archiveSha256
    || scope?.from !== A.migrationScope.from || scope?.to !== A.migrationScope.to) {
    reasons.push('Attestation does not name the approved decision, archive SHA-256 and 110 -> 115 migration scope');
    return out('NOT_APPLIED');
  }
  const parts = {
    rawVoteAuditPreservation: evidenceResult(alt.rawVoteAuditPreservation),
    storedReports: storedReportsResult(alt.storedReports, A.seasons),
    integration: passedAll(alt.integration), unitReport: passedAll(alt.unitReport),
  } as const;
  for (const [name, result] of Object.entries(parts)) if (result !== 'PASS') reasons.push(`${name}: ${result}`);
  if (Object.values(parts).includes('FAIL')) return out('FAILED');
  if (Object.values(parts).includes('INCOMPLETE')) return out('NOT_APPLIED');
  const snapshot = validSnapshot(input.before) ? input.before : undefined;
  if (input.preservation !== 'PASS' || snapshot?.scope.backupSha256 !== A.archiveSha256) {
    reasons.push('Preservation is not PASS on snapshots of the approved archive');
  }
  if (!report || report.checks.length === 0) reasons.push('A valid shadow parity report is required');
  else {
    for (const id of ['historical_manifest', 'table_row_counts', 'coleman', 'coverage']) {
      if (status(id) !== 'pass') reasons.push(`${id} must PASS; the alternative covers only the Brownlow comparator`);
    }
    if (status('brownlow') !== 'incomplete') reasons.push('The alternative applies only to an INCOMPLETE (unavailable) staged Brownlow comparator');
  }
  return reasons.length ? out('NOT_APPLIED') : out('APPLIED');
}

export function releaseGates(input: {
  functional?: unknown; operational?: unknown; parity?: unknown; before?: unknown; after?: unknown; brownlowAlternative?: unknown;
}) {
  const preservation = comparePreservation(input.before, input.after);
  const p = validateShadowParityReport(input.parity).length === 0
    ? input.parity as { verdict?: unknown; checks: { id: string; status: string }[] } : undefined;
  const parity: GateResult = p?.verdict === 'PASS' ? 'PASS' : p?.verdict === 'FAIL' ? 'FAIL' : 'INCOMPLETE';
  const stagedBrownlow = p?.checks.find(c => c.id === 'brownlow')?.status;
  const stagedBrownlowComparator: GateResult = stagedBrownlow === 'pass' ? 'PASS' : stagedBrownlow === 'fail' ? 'FAIL' : 'INCOMPLETE';
  const alternative = assessBrownlowAlternative({ alternative: input.brownlowAlternative, before: input.before,
    preservation: preservation.result, parity: input.parity });
  const strict: GateResult = preservation.result === 'FAIL' || parity === 'FAIL' ? 'FAIL'
    : preservation.result === 'INCOMPLETE' || parity === 'INCOMPLETE' ? 'INCOMPLETE' : 'PASS';
  const compatibility: GateResult = strict === 'FAIL' || alternative.status === 'FAILED' ? 'FAIL'
    : alternative.status === 'APPLIED' ? 'PASS' : strict;
  const functional = evidenceGroup(input.functional, ['ingestion', 'publication', 'permissions', 'auditing', 'rollback']);
  const operational = evidenceGroup(input.operational, ['productionCompatibility', 'linux', 'hostBackupRestoreRollback',
    'legacyWritersRetired', 'issue316Sequence', 'explicitReleaseApproval', 'authenticBrownlowReconciliation']);
  return {
    policy: 'v2.migration-separation.1',
    backendFunctional: functional,
    migrationCompatibility: compatibility,
    migrationCompatibilityBasis: compatibility !== 'PASS' ? 'NOT_ESTABLISHED'
      : alternative.status === 'APPLIED' ? 'APPROVED_BROWNLOW_ALTERNATIVE' : 'ALL_CHECKS_PASS',
    // Never overwritten by the alternative: this is the original comparator's own result.
    stagedBrownlowComparator,
    brownlowAlternative: alternative,
    brownlowOperationalReconciliation: BROWNLOW_OPERATIONAL_REQUIREMENT,
    gridleyEvidence: 'Retained 2026-10-20 at 12abe77f; not rerun by this offline report',
    strictGridley: { result: 'FAIL', findings: 149 },
    adjudicationConformance: { result: 'FAIL', approved: 99, unapproved: 50 },
    productionOperational: operational,
    backendAcceptance: functional === 'FAIL' || compatibility === 'FAIL' ? 'FAIL'
      : functional === 'PASS' && compatibility === 'PASS' ? 'PASS' : 'INCOMPLETE',
    // A gate report grants no release authority. Explicit approval remains a separate operation.
    productionDecision: 'NO-GO', preservation,
  };
}
