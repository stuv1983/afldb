// Re-derive candidate, state and authority bindings using the exact-P modules.
// No Git commands, network, SQL, apply or activation.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const source = path.join(root, '.local-release/issue316-dp-20261025/source-P');
const change = require(path.join(source, 'src/lib/rollover/transition-change-set.ts'));
const ladder = require(path.join(source, 'src/lib/rollover/ladder-successor.ts'));
const activation = require(path.join(source, 'src/lib/rollover/successor-activation.ts'));
const states = require(path.join(source, 'tools/db/rollover-proposed-state.ts'));
const sha = change.sha256Hex;
const load = p => JSON.parse(fs.readFileSync(path.join(__dirname, p)));
const insist = (ok, why) => { if (!ok) throw Error(why); };
const table = load('PIN-TABLE.json');
const sim = load('SIMULATED-TREES-AND-AUTHORITIES.json');
const csBytes = fs.readFileSync(path.join(__dirname, 'transition-change-set.json'));
const cs = change.parseTransitionChangeSet(csBytes.toString());
const inactive = fs.readFileSync(path.join(__dirname, 'pins/rebuild-test.inactive.ts.txt'));
const active = fs.readFileSync(path.join(__dirname, 'pins/rebuild-test.projected-active.ts.txt'));
const tuple = load('successor-tuple.json');
insist(table.source_commit === 'def676517da3955aa18db3606785463aac464188', 'Proposal source changed');
insist(sha(csBytes) === table.new_change_set_sha256, 'Change-set pin changed');
insist(csBytes.toString().includes('"write_set"') && table.files.length === 7, 'Seven-file proposal shape');
const finals = new Map(table.files.map(f => {
  const b = fs.readFileSync(path.join(__dirname, 'finals', f.path));
  insist(sha(b) === f.proposed_final_sha256, 'Final pin changed: ' + f.path);
  insist(sha(fs.readFileSync(path.join(source, f.path))) === f.base_at_P_sha256, 'Base changed: ' + f.path);
  for (const state of ['B', 'C']) insist(sha(fs.readFileSync(path.join(root, '.local-release/issue316-dp-20261025/state-' + state, f.path))) === sha(b), 'State final differs: ' + state + ' ' + f.path);
  return [f.path, b];
}));
const prepared = change.prepareTransition({ changeSet: cs, season: 2026, currentContract: JSON.parse(fs.readFileSync(path.join(source, 'tools/rebuild/fitzroy/fitzroy-contract.json'))),
  readRepo: p => fs.existsSync(path.join(source, p)) ? fs.readFileSync(path.join(source, p)) : null,
  readProposed: p => fs.existsSync(path.join(root, p)) ? fs.readFileSync(path.join(root, p)) : null,
  inputs: Object.fromEntries(load('transition-change-set.json').inputs.map(i => [i.role, { path: i.path, sha256: sha(fs.readFileSync(path.join(source, i.path))) }])),
});
const judged = change.assertTransitionWriteSet({ prepared, apply: false, planned: change.plannerOwnedWrites(true).map(p => ({ path: p, content: finals.get(p).toString(), reformatted: false })) });
insist(judged.files.length === 7 && !judged.files.some(f => f.path === 'tools/db/rebuild-test.ts'), 'Activation entered apply write set');
insist(sha(inactive) === table.rebuild.inactive_at_P_sha256 && sha(active) === table.rebuild.accepted_J2_active_sha256 && sha(active) === table.rebuild.projected_active_at_P_sha256, 'Rebuild pins differ');
insist(sha(fs.readFileSync(path.join(source, 'tools/db/rebuild-test.ts'))) === sha(inactive), 'Source P active');
for (const [state, b] of [['B', inactive], ['C', active]]) insist(sha(fs.readFileSync(path.join(root, '.local-release/issue316-dp-20261025/state-' + state, 'tools/db/rebuild-test.ts'))) === sha(b), 'State activation bytes differ');
insist(ladder.successorTupleSha256(tuple) === table.tuple_sha256, 'Tuple differs');
const proof = states.validateActivationStates({ register: finals.get('data/reference/fitzroy-accepted-baselines.json').toString(), seasons: finals.get('data/reference/seasons.json').toString(),
  contract: finals.get('tools/rebuild/fitzroy/fitzroy-contract.json').toString(), aflApi: finals.get('tools/rebuild/afl_api/afl-api-contract.json').toString(), afltables: finals.get('tools/rebuild/afltables/afltables-contract.json').toString(),
  witnessManifest: fs.readFileSync(path.join(source, 'docs/rebuild-manifests/afltables_fitzroy_core/c2-2026-final-ladder-v1.json'), 'utf8') }, inactive.toString(), active.toString(), tuple.profile, tuple.expected_rows);
insist(proof.active.expectedRows === 1640 && proof.active.finalChecks.length === 91 && !!proof.inactiveRefusal, 'State resolution contradiction');
const migrations = activation.migrationSetState(fs.readdirSync(path.join(source, activation.MIGRATIONS_DIR)).filter(p => p.endsWith('.sql')).map(name => ({ name, text: fs.readFileSync(path.join(source, activation.MIGRATIONS_DIR, name), 'utf8') })));
const authorityChecks = [];
for (const action of ['activate', 'deactivate']) {
  const bytes = fs.readFileSync(path.join(__dirname, action + '-authority.PROPOSED.json'));
  const a = activation.parseActivationAuthority(bytes.toString());
  const original = sim.authority_validation.find(v => v.action === action);
  insist(sha(bytes) === original.authority_sha256 && a.sourceCommit === table.source_commit, 'Authority bytes/source changed');
  const bound = activation.bindActivationChangeSet(a, csBytes);
  activation.assertMigrationBinding(a, migrations);
  // Ancestry was checked when these simulation objects were created. Do not
  // fabricate a fresh Git ancestry check; verify the authority's recorded head.
  insist(load(action + '-authority.PROPOSED.json').head_commit === original.simulated_head, 'Simulated head differs');
  const classified = activation.classifyActivationState({ authority: a, changeSet: bound.changeSet, tuple: bound.tuple,
    readRepo: p => p === 'tools/db/rebuild-test.ts' ? action === 'activate' ? inactive : active : finals.get(p) ?? null });
  const write = activation.planActivationWrite(action, classified);
  insist(sha(write.before) === original.before_sha256 && sha(write.after) === original.after_sha256 && write.path === 'tools/db/rebuild-test.ts', 'Authority inverse differs');
  authorityChecks.push({ action, sha256: sha(bytes), simulated_head: original.simulated_head, source_commit: table.source_commit, from: write.from, to: write.to, path: write.path, before_sha256: sha(write.before), after_sha256: sha(write.after), status: 'PASS', owner_approved: false });
}
const real = load('validation/retained-input-validator.attempt-3.json');
const logBytes = fs.readFileSync(path.join(__dirname, 'validation/retained-input-validator.attempt-3.log'));
const log = logBytes.toString();
insist(sha(logBytes) === real.log_sha256 && real.exit_code === 0 && real.checks.three_real_gates && real.checks.all_final_pins_match && real.checks.root_unchanged && real.checks.python_three_guarded_processes, 'Real offline validator did not pass');
insist(/club_seasons expected\s+1622 -> 1640/.test(log) && /players_with_renumbered_profile\s+4/.test(log) && /final-validation checks\s+91/.test(log), 'Real validator measurements contradict proposal');
const result = { verified_at: new Date().toISOString(), status: 'PASS', proposal_only: true, source_P: table.source_commit, proposed_D: table.date, production_window_UTC: '02:00–04:00',
  retained_package_integrity: { members: load('validation/retained-J2-integrity.json').members, passed: load('validation/retained-J2-integrity.json').passed },
  retained_external_inputs: { files: load('validation/external-inputs.json').files.length, findings: load('validation/external-inputs.json').findings.length },
  real_validator: { exit_code: 0, gates_passed: 3, final_pins_match: true, predecessor_rows: 1622, successor_rows: 1640, renumbered_profiles: 4, projected_checks: 91, tree_unchanged: true,
    report: 'validation/retained-input-validator.attempt-3.json', log_sha256: sha(logBytes), audit_reconciliation: 'Initial report STOP solely because a pre-connect refusal made no_connection_attempts false. All actual validator checks passed. The throwing guard prevented any connection; the owner requires no production/database connection, not zero blocked transport attempts. No product assertion or validator was modified.' },
  apply_write_count: judged.files.length, rebuild_is_apply_write: false, change_set_sha256: sha(csBytes), tuple_sha256: table.tuple_sha256,
  state_B: { status: 'installed / inactive / rebuild-ineligible', refusal: proof.inactiveRefusal, database_rebuild_proven: false },
  state_C: { profile: proof.active.ladderProfile, expected_rows: proof.active.expectedRows, final_check_definitions: proof.active.finalChecks.length, checks: proof.active.finalChecks, database_checks_executed: false },
  authorities: authorityChecks, migrations, ancestry_evidence: 'Existing simulation generation record; no fresh Git command in this session',
  production_contact: false, database_connection: false, production_credentials_read: false, external_material_modified: false, product_or_accepted_assertion_edits: false,
  fresh_production_census: false, native_policy_window: false, enforced_production_dry_run: false, apply: false, activation: false, deploy: false, disposable_rebuild: false, push: false,
  structural_gate: 'CLOSED / ACCEPTED', U3: 'CONFIRMED', U4: 'Route B', Brownlow: 'untouched', production: 'NO-GO' };
fs.writeFileSync(path.join(__dirname, 'validation/OFFLINE-RECONCILIATION.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, state_C: { ...result.state_C, checks: undefined } }));
