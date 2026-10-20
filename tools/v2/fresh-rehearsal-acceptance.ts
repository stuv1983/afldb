/** Offline, archive-specific owner acceptance. The original comparators remain unchanged. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { comparePreservation, digest, releaseGates, validSnapshot, type GateResult } from './migration-preservation';
import { validateShadowParityReport } from '@afldb/derived';

export const FRESH_ACCEPTANCE = {
  decision: 'D-V2-FRESH-REHEARSAL-1',
  schemaDecision: 'D-V2-FRESH-SCHEMA-1',
  brownlowDecision: 'D-V2-BROWNLOW-ALT-2',
  archiveSha256: '7fefcd9b791520ccc939f7f9d0ca1ddacd5fe99d2cca33d53ea1aa9c6dea6599',
  sourceRevision: 'a6400e7dd805fce4d2090110831b2eec45f23500',
  sourceArtifactSha256: 'a3702c04ae69f5fe12f75949ead992324b75c8a390eefbde992e78a592be13b3',
  manifestSha256: '22dc0e2a74dea414ccc49feb55808d97621255be918245d19731e1550e925dce',
  migrations: {
    '111_curated_award_proposals.sql': '2ed29d9598742c74d0f9db6f7bac0bec8409733c1dace1d25356ad27edb91290',
    '112_derived_award_results.sql': 'e0aa0c7e6fd14b6885aaf43725309e82e2d9b362cf167fd57cca9b95cef401ac',
    '113_brownlow_eligibility_decisions.sql': '79e7b9d1b839414962571ffff832b230e458273c24bd26d8474d259137ca9971',
    '114_award_projections_and_curated_revisions.sql': '1c33324f9c7c616e998aa152fdd5fbdf20b2585694b3e6d62c2addb5f307f180',
    '115_adjudication_supersession_fk_index.sql': '2f16efb9694f76f946543bbaca01785127b632417ad21ba1fc7b8745bb7c1852',
    '116_brownlow_correction_receipts.sql': 'c61953b71e1210b5389579342e155d367dfada5737bf3cd37f1a536b9ac61075',
    '117_brownlow_provider_eligibility_unknown.sql': 'a7dff2bddb1dd9c01ea0e69478193c5e5c50d8a531b2db448e7052b9f25e286f',
  },
} as const;

const approvedFindings = [
  'staging.afl_api_brownlow_vote: DEFINITION_OR_RELATIONSHIP_CHANGED',
  'public.brownlow_correction_receipts: UNAPPROVED_TABLE_ADDED',
];
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** integrity must come from verifyFreshEvidence, never an attestation or CLI flag. Exported for contract tests. */
export function assessFreshAcceptance(input: {
  integrity: GateResult; before?: unknown; after?: unknown; parity?: unknown;
  archiveSha256: string; sourceRevision: string; baseline: number; migrations: string[];
}) {
  const strict = releaseGates(input);
  const reasons: string[] = [];
  if (input.integrity !== 'PASS') reasons.push('Required pinned evidence missing, changed or unreadable');
  if (input.archiveSha256 !== FRESH_ACCEPTANCE.archiveSha256 || input.sourceRevision !== FRESH_ACCEPTANCE.sourceRevision
    || input.baseline !== 110 || !equal(input.migrations, Object.keys(FRESH_ACCEPTANCE.migrations))) reasons.push('Unapproved archive, source or migration scope');
  const preservation = comparePreservation(input.before, input.after);
  if (!equal(preservation.findings, approvedFindings)) reasons.push('Strict preservation findings differ from exact approved deltas');
  if (!validSnapshot(input.before) || !validSnapshot(input.after)) reasons.push('Complete snapshots required');
  else {
    if (input.before.scope.backupSha256 !== FRESH_ACCEPTANCE.archiveSha256) reasons.push('Snapshot archive differs');
    // Migration-only acceptance permits no new/changed existing data, and exactly seven ledger additions.
    for (const [name, before] of Object.entries(input.before.tables)) {
      const after = input.after.tables[name];
      if (!after || (name === 'afldb_meta.schema_migrations'
        ? after.rows.length !== before.rows.length + 7
        : !equal([...before.rows].sort(), [...after.rows].sort()))) reasons.push(`${name}: migration-only rows differ`);
    }
    for (const [name, table] of Object.entries(input.after.tables)) {
      if (!(name in input.before.tables) && table.rows.length !== 0) reasons.push(`${name}: new table is not empty`);
    }
  }
  if (validateShadowParityReport(input.parity).length) reasons.push('Valid strict parity evidence required');
  else {
    const parity = input.parity as { checks: { id: string; status: string; findings: { code: string; severity: string; subject: string; detail: string }[] }[] };
    for (const check of parity.checks) {
      if (check.id === 'brownlow') {
        if (check.status !== 'incomplete' || check.findings.some(f => f.code !== 'INPUT_MISSING')) reasons.push('Brownlow must be unavailable, never failed');
      } else if (check.id === 'table_row_counts') {
        const failures = check.findings.filter(f => f.severity === 'fail');
        if (check.status !== 'fail' || failures.length !== 1 || !equal(failures[0], {
          code: 'UNEXPECTED_TABLE_ADDED', severity: 'fail', subject: 'public.brownlow_correction_receipts',
          detail: 'absent before, present after (0 rows), and not a V2-added table',
        })) reasons.push('Unapproved row-count findings');
      } else if (check.status !== 'pass') reasons.push(`${check.id}: must pass`);
    }
  }
  return {
    decision: FRESH_ACCEPTANCE.decision, binding: FRESH_ACCEPTANCE,
    evidenceIntegrity: input.integrity,
    originalStrict: strict,
    ownerApprovedSchemaDifferences: { decision: FRESH_ACCEPTANCE.schemaDecision, findings: approvedFindings,
      boundary: 'Exact pinned full schema/catalog bytes only: 116 receipt table/function/trigger/permissions; 117 nullable eligibility/comment. No other definition excluded.' },
    stagedBrownlowComparator: strict.stagedBrownlowComparator,
    alternativeBrownlowEvidence: { decision: FRESH_ACCEPTANCE.brownlowDecision,
      basis: 'Pinned raw-vote/audit preservation, identical 98-season stored reports, Linux 306 units + 43 privileges + 47 eligibility checks',
      authenticStagedReconciliationEstablished: false },
    migrationCompatibility: reasons.length ? 'FAIL' : 'PASS', reasons,
    productionOperational: 'INCOMPLETE', productionDecision: 'NO-GO',
    productionPrivileges: { policyDecisions: ['D-V2-STAGING-IMPORT-DEFAULT-1', 'D-V2-STAGING-APP-DEFAULT-1'],
      productionExecutionAuthorized: false, execution: 'PENDING; absent in captured production' },
  };
}

/** All 50 files, including archive, source tar, complete schema/catalogs, snapshots and Linux logs,
 * must match the immutable reviewed inventory. No caller-supplied hash can expand acceptance. */
export function verifyFreshEvidence(directory: string, repository: string): GateResult {
  try {
    const manifest = readFileSync(join(directory, 'evidence-manifest.sha256'), 'utf8');
    if (digest(manifest) !== FRESH_ACCEPTANCE.manifestSha256) return 'FAIL';
    const lines = manifest.trimEnd().split('\n');
    if (lines.length !== 50) return 'FAIL';
    for (const line of lines) {
      const match = /^([a-f0-9]{64})  ([a-zA-Z0-9_./-]+)$/.exec(line);
      if (!match || match[2].split('/').includes('..') || match[2].startsWith('/')) return 'FAIL';
      // Buffer preserves exact bytes, including archives and logs.
      const bytes = readFileSync(join(directory, match[2]));
      if (createHash('sha256').update(bytes).digest('hex') !== match[1]) return 'FAIL';
    }
    for (const [name, sha] of Object.entries(FRESH_ACCEPTANCE.migrations)) {
      if (digest(readFileSync(join(repository, 'src/db/migrations', name), 'utf8').replace(/\r\n/g, '\n')) !== sha) return 'FAIL';
    }
    return 'PASS';
  } catch { return 'INCOMPLETE'; }
}

export function runFreshAcceptance(directory: string, output: string, repository = process.cwd()) {
  const integrity = verifyFreshEvidence(directory, repository);
  const read = (name: string): unknown => {
    try { return JSON.parse(readFileSync(join(directory, name), 'utf8')); } catch { return undefined; }
  };
  const assessment = assessFreshAcceptance({ integrity, before: read('before.preservation.json'), after: read('after.preservation.json'),
    parity: read('parity.json'), archiveSha256: FRESH_ACCEPTANCE.archiveSha256, sourceRevision: FRESH_ACCEPTANCE.sourceRevision,
    baseline: 110, migrations: Object.keys(FRESH_ACCEPTANCE.migrations) });
  const report = { ...assessment, originalStrict: read('strict-gates.json'), recomputedStrict: assessment.originalStrict,
    retainedOriginalParityReport: read('parity.json'),
    backendFunctional: integrity === 'PASS' ? 'PASS' : 'INCOMPLETE',
    backendAcceptance: assessment.migrationCompatibility === 'PASS' ? 'PASS' : 'FAIL' };
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return report;
}

if (process.argv[1] && /fresh-rehearsal-acceptance\.ts$/.test(process.argv[1])) {
  try {
    if (process.argv.length !== 4) throw new Error('Expected evidence directory and new output path');
    const report = runFreshAcceptance(process.argv[2], process.argv[3]);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.migrationCompatibility === 'PASS' ? 0 : 1;
  } catch { console.error('Fresh acceptance refused: invalid input or output unavailable'); process.exitCode = 3; }
}
