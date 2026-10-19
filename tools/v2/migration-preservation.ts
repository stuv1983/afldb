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

export function releaseGates(input: {
  functional?: unknown; operational?: unknown; parity?: unknown; before?: unknown; after?: unknown;
}) {
  const preservation = comparePreservation(input.before, input.after);
  const p = validateShadowParityReport(input.parity).length === 0
    ? input.parity as { verdict?: unknown } : undefined;
  const parity: GateResult = p?.verdict === 'PASS' ? 'PASS' : p?.verdict === 'FAIL' ? 'FAIL' : 'INCOMPLETE';
  const compatibility: GateResult = preservation.result === 'FAIL' || parity === 'FAIL' ? 'FAIL'
    : preservation.result === 'INCOMPLETE' || parity === 'INCOMPLETE' ? 'INCOMPLETE' : 'PASS';
  const functional = evidenceGroup(input.functional, ['ingestion', 'publication', 'permissions', 'auditing', 'rollback']);
  const operational = evidenceGroup(input.operational, ['productionCompatibility', 'linux', 'hostBackupRestoreRollback',
    'legacyWritersRetired', 'issue316Sequence', 'explicitReleaseApproval']);
  return {
    policy: 'v2.migration-separation.1',
    backendFunctional: functional,
    migrationCompatibility: compatibility,
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
