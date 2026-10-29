/** Offline, archive-specific owner acceptance. The original comparators remain unchanged. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { comparePreservation, digest, releaseGates, validSnapshot, type GateResult } from './migration-preservation';
import { validateShadowParityReport } from '@afldb/derived';

const MIGRATIONS_111_117 = {
  '111_curated_award_proposals.sql': '2ed29d9598742c74d0f9db6f7bac0bec8409733c1dace1d25356ad27edb91290',
  '112_derived_award_results.sql': 'e0aa0c7e6fd14b6885aaf43725309e82e2d9b362cf167fd57cca9b95cef401ac',
  '113_brownlow_eligibility_decisions.sql': '79e7b9d1b839414962571ffff832b230e458273c24bd26d8474d259137ca9971',
  '114_award_projections_and_curated_revisions.sql': '1c33324f9c7c616e998aa152fdd5fbdf20b2585694b3e6d62c2addb5f307f180',
  '115_adjudication_supersession_fk_index.sql': '2f16efb9694f76f946543bbaca01785127b632417ad21ba1fc7b8745bb7c1852',
  '116_brownlow_correction_receipts.sql': 'c61953b71e1210b5389579342e155d367dfada5737bf3cd37f1a536b9ac61075',
  '117_brownlow_provider_eligibility_unknown.sql': 'a7dff2bddb1dd9c01ea0e69478193c5e5c50d8a531b2db448e7052b9f25e286f',
} as const;

export const FRESH_ACCEPTANCE = {
  decision: 'D-V2-FRESH-REHEARSAL-1',
  schemaDecision: 'D-V2-FRESH-SCHEMA-1',
  brownlowDecision: 'D-V2-BROWNLOW-ALT-2',
  archiveSha256: '7fefcd9b791520ccc939f7f9d0ca1ddacd5fe99d2cca33d53ea1aa9c6dea6599',
  sourceRevision: 'a6400e7dd805fce4d2090110831b2eec45f23500',
  sourceArtifactSha256: 'a3702c04ae69f5fe12f75949ead992324b75c8a390eefbde992e78a592be13b3',
  manifestSha256: '22dc0e2a74dea414ccc49feb55808d97621255be918245d19731e1550e925dce',
  migrations: MIGRATIONS_111_117,
} as const;

/** Second binding, approved 2026-10-29 exactly as scoped in current-production-shadow-followup-2026-10-29.md §9.
 * Paths are relative to the retained isolated root's layout: xfer/, evidence/ and followup/evidence/. */
export const CURRENT_ACCEPTANCE = {
  decision: 'D-V2-CURRENT-REHEARSAL-1',
  schemaDecision: 'D-V2-CURRENT-SCHEMA-1',
  brownlowDecision: 'D-V2-BROWNLOW-ALT-3',
  archiveSha256: 'a4641ca0d1533c30d6670dfa9b555552548a91b736054e941adba75cee0c46fc',
  sidecarSha256: '72f000462a2e7560afee97edf5598723a2ccfa45c9664e7d57ce7b62dddb57d4',
  ledgerDigest: '789946fe734b23c32ec87e59e3b860877d31a4b32b561624bf1d88fb8f055153',
  sourceRevision: 'c478c31b2ad84719907e0372d1b94230d3a4c508',
  archive: 'xfer/afldb_prod-20261028T192336Z.dump',
  sidecar: 'xfer/afldb_prod-20261028T192336Z.provenance.json',
  manifestSha256: 'ea197fcf40c1b27108bebb1cc9b0a6523e8d79804952f77610f5f4606ac8ac75',
  manifestFiles: 38,
  /** The one disclosed live-log entry: hashed while tee still appended; only its final copy is accepted. */
  disclosedManifestEntry: { path: 'shadow.log',
    recorded: '12e4cf941a5b5accb314a54f8a1174285c4a95a645c3fdcc5f811bb444be7d0f',
    final: '99b6e575e2c735caf41a0bb920b43cdb92a9518f29928490e3e7c1ffa4d745e8' },
  followupManifestSha256: '30b1a2be9757dfca491aa6b72ade183e2237f90759babbbd6a705a950143d010',
  followupManifestFiles: 61,
  measured: {
    'followup/evidence/schema-sections.attempt2.json': 'edb83b2aa53004f26c363d040eebe5186a86e733e472f14bdcd14b7768ac431b',
    'followup/evidence/receipt-catalog.migration.json': 'f1f951a9cca05be88045e8164951ccb043ab976ed9d2f36120a4d4d52d79ce05',
    'followup/evidence/receipt-mutation.json': '93bca1f44bbaf1f19cdc17dabc787c63eb8a865b6981e03f475fa28557ec976a',
    'evidence/schema.diff': 'b201707ba920f331349128b14e4bf79366918a38ce5fc689f2cef69e3129d230',
    'followup/evidence/brownlow-stored.baseline.json': 'e2df67aee27df89d6723681fbd0cdda1938a4311c11fd96b7df69f1a1d5c98aa',
    'followup/evidence/brownlow-stored.migration.json': 'e2df67aee27df89d6723681fbd0cdda1938a4311c11fd96b7df69f1a1d5c98aa',
    'followup/evidence/it-v2-brownlow-eligibility.json': '7935c56a2e4072fa97f0f6081266c0799c436d001e8d249ac7176e1663af6842',
    'followup/evidence/it-privileges.json': '63c183beec5efc024e385998c9d0923a5608f9e41d4b76331ad726fdb2e7d06e',
    'followup/evidence/unit-focused.json': '92bcc392cc6d982b9c31edec605cbe6b63e09d3fc970b71a94d9b46fd1ef6dba',
    'followup/evidence/inventory-comparison.attempt2.json': 'd00744c697fd8ce5dc83a0e94145573824996939227378ef11f5ee6e5ad5c32d',
  },
  /** Local, files-only result produced after review; not in the host manifest, so pinned in the repository. */
  repositoryMeasured: {
    'docs/v2/evidence/current-production-shadow/followup-20261029/grant-exact.json': '4d41c280d0f4eaaa7787ec513d3656df73c491b6b72d356e7081a6a34508d67d',
  },
  /** The focused Linux checks exactly as measured. The privileges FAIL is recorded, never waived. */
  focusedChecks: { units: { total: 508, passed: 508 }, eligibility: { total: 47, passed: 47 },
    privileges: { total: 43, passed: 42, failing: ['AFL Tables settle projections are privileged like the rest of staging inherits that from migration 014, whose default privilege is pinned here'] } },
  migrations: MIGRATIONS_111_117,
} as const;

export type AcceptanceBinding = typeof FRESH_ACCEPTANCE | typeof CURRENT_ACCEPTANCE;
const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};
export const ACCEPTANCE_BINDINGS: Readonly<Record<string, AcceptanceBinding>> = deepFreeze({
  [FRESH_ACCEPTANCE.decision]: FRESH_ACCEPTANCE, [CURRENT_ACCEPTANCE.decision]: CURRENT_ACCEPTANCE,
});
/** Own-property lookup only, so names such as `constructor` or `__proto__` are simply unapproved. */
export const approvedBinding = (decision: string): AcceptanceBinding | undefined =>
  Object.hasOwn(ACCEPTANCE_BINDINGS, decision) ? ACCEPTANCE_BINDINGS[decision] : undefined;

/** Per-binding report wording and retained file names; kept out of the binding so its recorded shape is unchanged. */
const PROFILES = deepFreeze({
  [FRESH_ACCEPTANCE.decision]: {
    schemaBoundary: 'Exact pinned full schema/catalog bytes only: 116 receipt table/function/trigger/permissions; 117 nullable eligibility/comment. No other definition excluded.',
    brownlowBasis: 'Pinned raw-vote/audit preservation, identical 98-season stored reports, Linux 306 units + 43 privileges + 47 eligibility checks',
    files: { before: 'before.preservation.json', after: 'after.preservation.json', parity: 'parity.json', strict: 'strict-gates.json' },
  },
  [CURRENT_ACCEPTANCE.decision]: {
    schemaBoundary: 'Exactly two deltas for this archive: 116 receipt table, refuse_brownlow_receipt_mutation() and brownlow_receipt_immutable with owner-only table ACL, no app/import/auth table privilege and the function\'s default PUBLIC EXECUTE (proacl NULL); 117 nullable eligible and its comment. 111-115 additions stay with V2_ADDED_TABLES. Stored ACLs only; production effective permissions and object ownership (except the receipt table owner) not compared. No other definition excluded.',
    brownlowBasis: 'Pinned raw-vote/audit preservation, byte-identical 98-season stored reports, Linux units 508/508 + eligibility integration 47/47 + privileges integration 42/43 (one recorded FAIL: absent staging default ACLs, not waived)',
    files: { before: 'evidence/before.preservation.json', after: 'evidence/postmig.preservation.json',
      parity: 'evidence/migration.parity.json', strict: 'evidence/release-gates.json',
      units: 'followup/evidence/unit-focused.json', eligibility: 'followup/evidence/it-v2-brownlow-eligibility.json',
      privileges: 'followup/evidence/it-privileges.json' },
  },
} as const);

const approvedFindings = [
  'staging.afl_api_brownlow_vote: DEFINITION_OR_RELATIONSHIP_CHANGED',
  'public.brownlow_correction_receipts: UNAPPROVED_TABLE_ADDED',
];
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

type FocusedRun = { numTotalTests: number; numPassedTests: number; numFailedTests: number; numPendingTests: number; numTodoTests?: number;
  testResults: { assertionResults: { status: string; fullName: string }[] }[] };
/** Totals and failing test names from a retained vitest JSON result; undefined when it is not one. */
function focusedResult(run: unknown) {
  const r = run as FocusedRun;
  if (!r || typeof r !== 'object' || !Number.isInteger(r.numTotalTests) || !Number.isInteger(r.numPassedTests)
    || !Array.isArray(r.testResults) || !r.testResults.every(s => s && Array.isArray(s.assertionResults))) return undefined;
  const assertions = r.testResults.flatMap(s => s.assertionResults);
  return { total: r.numTotalTests, passed: r.numPassedTests, skipped: (r.numPendingTests ?? 0) + (r.numTodoTests ?? 0),
    counted: assertions.length, failing: assertions.filter(a => a.status !== 'passed').map(a => a.fullName) };
}

/** integrity must come from the binding's evidence verifier, never an attestation or CLI flag. Exported for contract tests.
 * The binding defaults to the original 7fefcd9b… approval; a second binding is selected only explicitly. */
export function assessFreshAcceptance(input: {
  integrity: GateResult; before?: unknown; after?: unknown; parity?: unknown;
  archiveSha256: string; sourceRevision: string; baseline: number; migrations: string[];
  focused?: { units?: unknown; eligibility?: unknown; privileges?: unknown };
}, binding: AcceptanceBinding = FRESH_ACCEPTANCE) {
  const strict = releaseGates(input);
  const reasons: string[] = [];
  if (approvedBinding(binding.decision) !== binding) reasons.push('Unapproved acceptance binding');
  if (input.integrity !== 'PASS') reasons.push('Required pinned evidence missing, changed or unreadable');
  if (input.archiveSha256 !== binding.archiveSha256 || input.sourceRevision !== binding.sourceRevision
    || input.baseline !== 110 || !equal(input.migrations, Object.keys(binding.migrations))) reasons.push('Unapproved archive, source or migration scope');
  const preservation = comparePreservation(input.before, input.after);
  if (!equal(preservation.findings, approvedFindings)) reasons.push('Strict preservation findings differ from exact approved deltas');
  if (!validSnapshot(input.before) || !validSnapshot(input.after)) reasons.push('Complete snapshots required');
  else {
    if (input.before.scope.backupSha256 !== binding.archiveSha256) reasons.push('Snapshot archive differs');
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
  // An unapproved binding has already failed above; its wording never borrows another binding's text.
  const profile = Object.hasOwn(PROFILES, binding.decision) ? PROFILES[binding.decision as keyof typeof PROFILES]
    : { schemaBoundary: 'Unapproved binding', brownlowBasis: 'Unapproved binding' };
  const assessment = {
    decision: binding.decision, binding,
    evidenceIntegrity: input.integrity,
    originalStrict: strict,
    ownerApprovedSchemaDifferences: { decision: binding.schemaDecision, findings: approvedFindings, boundary: profile.schemaBoundary },
    stagedBrownlowComparator: strict.stagedBrownlowComparator,
    alternativeBrownlowEvidence: { decision: binding.brownlowDecision, basis: profile.brownlowBasis,
      authenticStagedReconciliationEstablished: false },
    migrationCompatibility: 'FAIL' as 'PASS' | 'FAIL', reasons,
    productionOperational: 'INCOMPLETE', productionDecision: 'NO-GO',
    productionPrivileges: { policyDecisions: ['D-V2-STAGING-IMPORT-DEFAULT-1', 'D-V2-STAGING-APP-DEFAULT-1'],
      productionExecutionAuthorized: false, execution: 'PENDING; absent in captured production' },
  };
  // Dispatch on the binding's own content: any binding that pins focused checks has them enforced.
  if (!('focusedChecks' in binding)) {
    assessment.migrationCompatibility = reasons.length ? 'FAIL' : 'PASS';
    return assessment;
  }
  // ALT-3 rests on the focused checks exactly as measured; any other result is an unapproved difference.
  const approved = binding.focusedChecks;
  const measured = { units: focusedResult(input.focused?.units), eligibility: focusedResult(input.focused?.eligibility),
    privileges: focusedResult(input.focused?.privileges) };
  for (const key of ['units', 'eligibility', 'privileges'] as const) {
    const m = measured[key], a = approved[key];
    if (!m || m.total !== a.total || m.passed !== a.passed || m.skipped !== 0 || m.counted !== a.total
      || !equal(m.failing, 'failing' in a ? a.failing : [])) reasons.push(`${key}: focused checks differ from the approved result`);
  }
  assessment.migrationCompatibility = reasons.length ? 'FAIL' : 'PASS';
  const privileges = measured.privileges;
  return { ...assessment,
    privilegesIntegration: { result: privileges && privileges.failing.length === 0 ? 'PASS' : 'FAIL',
      passed: privileges?.passed ?? null, total: privileges?.total ?? null, failing: privileges?.failing ?? null, waived: false,
      requirement: 'Unresolved: staging default privileges absent; D-V2-STAGING-IMPORT-DEFAULT-1/APP-DEFAULT-1 execution pending at A-REL' } };
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

const fileSha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
/** A changed file is FAIL even when another required file is missing; missing alone is INCOMPLETE. */
const worst = (results: GateResult[]): GateResult =>
  results.includes('FAIL') ? 'FAIL' : results.includes('INCOMPLETE') ? 'INCOMPLETE' : 'PASS';
const fileGate = (path: string, sha: string): GateResult => existsSync(path) ? (fileSha(path) === sha ? 'PASS' : 'FAIL') : 'INCOMPLETE';

/** Checks every `<sha>  ./<path>` line of an already pinned manifest against the files beside it. Only the named
 * disclosed entry may differ, and only when its line and its current bytes are exactly the disclosed pair.
 * Every present file is checked; a missing one makes the result INCOMPLETE unless another FAILs. Exported for
 * contract tests. */
export function verifyManifestLines(directory: string, manifest: string, files: number,
  disclosed?: { path: string; recorded: string; final: string }): GateResult {
  const lines = manifest.trimEnd().split('\n');
  if (lines.length !== files || new Set(lines.map(l => l.slice(66))).size !== files) return 'FAIL';
  const results: GateResult[] = [];
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  \.\/([a-zA-Z0-9_.-][a-zA-Z0-9_./-]*)$/.exec(line);
    if (!match || match[2].split('/').includes('..')) return 'FAIL';
    if (disclosed && match[2] === disclosed.path) {
      results.push(match[1] === disclosed.recorded ? fileGate(join(directory, match[2]), disclosed.final) : 'FAIL');
    } else results.push(fileGate(join(directory, match[2]), match[1]));
  }
  return worst(results);
}

/** The sidecar bytes and its archive identity, ledger digest and size against the archive's actual bytes.
 * Exported for contract tests. */
export function verifyCurrentCapture(directory: string): GateResult {
  const binding = CURRENT_ACCEPTANCE;
  const sidecarPath = join(directory, binding.sidecar), archivePath = join(directory, binding.archive);
  const sidecarGate = fileGate(sidecarPath, binding.sidecarSha256);
  if (sidecarGate !== 'PASS') return sidecarGate;
  const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8')) as Record<string, unknown>;
  if (sidecar.archive_sha256 !== binding.archiveSha256 || sidecar.observed_ledger_digest !== binding.ledgerDigest) return 'FAIL';
  if (!existsSync(archivePath)) return 'INCOMPLETE';
  const archive = readFileSync(archivePath);
  return sidecar.archive_bytes === archive.length && createHash('sha256').update(archive).digest('hex') === binding.archiveSha256 ? 'PASS' : 'FAIL';
}

/** The approved migrations and repository-pinned results first (any difference FAILs at once), then both pinned
 * manifests by digest, every file they list, every measured result the decisions name, and the archive and its
 * sidecar. Nothing here is caller-supplied. */
export function verifyCurrentEvidence(directory: string, repository: string): GateResult {
  const binding = CURRENT_ACCEPTANCE;
  try {
    for (const [name, sha] of Object.entries(binding.migrations)) {
      if (digest(readFileSync(join(repository, 'src/db/migrations', name), 'utf8').replace(/\r\n/g, '\n')) !== sha) return 'FAIL';
    }
    for (const [path, sha] of Object.entries(binding.repositoryMeasured)) if (fileSha(join(repository, path)) !== sha) return 'FAIL';
    const manifests = [
      { dir: 'evidence', sha: binding.manifestSha256, files: binding.manifestFiles, disclosed: binding.disclosedManifestEntry },
      { dir: 'followup/evidence', sha: binding.followupManifestSha256, files: binding.followupManifestFiles, disclosed: undefined },
    ];
    const texts = manifests.map(m => readFileSync(join(directory, m.dir, 'evidence-sha256.txt'), 'utf8'));
    if (manifests.some((m, i) => digest(texts[i]) !== m.sha)) return 'FAIL';
    return worst([
      ...manifests.map((m, i) => verifyManifestLines(join(directory, m.dir), texts[i], m.files, m.disclosed)),
      ...Object.entries(binding.measured).map(([path, sha]) => fileGate(join(directory, path), sha)),
      verifyCurrentCapture(directory),
    ]);
  } catch { return 'INCOMPLETE'; }
}

const VERIFIERS: Readonly<Record<string, (directory: string, repository: string) => GateResult>> = Object.freeze({
  [FRESH_ACCEPTANCE.decision]: verifyFreshEvidence, [CURRENT_ACCEPTANCE.decision]: verifyCurrentEvidence,
});

export function runFreshAcceptance(directory: string, output: string, repository = process.cwd(), decision: string = FRESH_ACCEPTANCE.decision) {
  const binding = approvedBinding(decision);
  if (!binding || !Object.hasOwn(PROFILES, decision) || !Object.hasOwn(VERIFIERS, decision)) throw new Error('Unapproved acceptance binding');
  const files: Record<string, string> = PROFILES[binding.decision as keyof typeof PROFILES].files;
  const integrity = VERIFIERS[decision](directory, repository);
  const read = (name?: string): unknown => {
    if (!name) return undefined;
    try { return JSON.parse(readFileSync(join(directory, name), 'utf8')); } catch { return undefined; }
  };
  const assessment = assessFreshAcceptance({ integrity, before: read(files.before), after: read(files.after),
    parity: read(files.parity), archiveSha256: binding.archiveSha256, sourceRevision: binding.sourceRevision,
    baseline: 110, migrations: Object.keys(binding.migrations),
    ...('focusedChecks' in binding ? { focused: { units: read(files.units), eligibility: read(files.eligibility), privileges: read(files.privileges) } } : {}) },
  binding);
  const report = { ...assessment, originalStrict: read(files.strict), recomputedStrict: assessment.originalStrict,
    retainedOriginalParityReport: read(files.parity),
    backendFunctional: integrity === 'PASS' ? 'PASS' : 'INCOMPLETE',
    backendAcceptance: assessment.migrationCompatibility === 'PASS' ? 'PASS' : 'FAIL' };
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return report;
}

if (process.argv[1] && /fresh-rehearsal-acceptance\.ts$/.test(process.argv[1])) {
  try {
    // Default: the original binding. `--binding <decision>` selects another approved binding explicitly.
    const args = process.argv.slice(2);
    const decision = args[0] === '--binding' ? (args.shift(), args.shift()) : FRESH_ACCEPTANCE.decision;
    if (args.length !== 2 || !decision) throw new Error('Expected [--binding <decision>] evidence directory and new output path');
    const report = runFreshAcceptance(args[0], args[1], process.cwd(), decision);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.migrationCompatibility === 'PASS' ? 0 : 1;
  } catch { console.error('Fresh acceptance refused: invalid input or output unavailable'); process.exitCode = 3; }
}
