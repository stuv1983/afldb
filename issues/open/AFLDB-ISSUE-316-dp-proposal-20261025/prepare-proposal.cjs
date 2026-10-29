// Offline proposal assembly from accepted Git proof blobs. Never applies or activates.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const rel = path.relative(root, __dirname).replaceAll('\\', '/');
const source = path.join(root, '.local-release/issue316-dp-20261025/source-P');
const P = 'def676517da3955aa18db3606785463aac464188';
const J2 = 'a1e16e674a1c3f552e5299883650602f3db36a2b';
const D = '2026-10-27';
const change = require(path.join(source, 'src/lib/rollover/transition-change-set.ts'));
const ladder = require(path.join(source, 'src/lib/rollover/ladder-successor.ts'));
const activation = require(path.join(source, 'src/lib/rollover/successor-activation.ts'));
const state = require(path.join(source, 'tools/db/rollover-proposed-state.ts'));
const sha = change.sha256Hex;
const insist = (ok, why) => { if (!ok) throw new Error(why); };
const git = (...args) => cp.execFileSync('git', args, { cwd: root, maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const blob = (ref, p) => git('cat-file', 'blob', ref + ':' + p);
const put = (p, b) => { fs.mkdirSync(path.dirname(path.join(__dirname, p)), { recursive: true }); fs.writeFileSync(path.join(__dirname, p), b); };
const doc = (p, j) => put(p, JSON.stringify(j, null, 2) + '\n');
const parse = b => JSON.parse(b.toString());
const paths = [
  'data/reference/afltables-network.json',
  'tools/rebuild/afl_api/afl-api-contract.json',
  'tools/rebuild/afltables/afltables-contract.json',
  'data/reference/fitzroy-accepted-baselines.json',
  'data/reference/seasons.json',
  'tools/rebuild/fitzroy/fitzroy-contract.json',
  'data/reference/stat-availability.json',
];
const rebuildPath = 'tools/db/rebuild-test.ts';
const base = new Map(paths.map(p => [p, blob(P, p)]));
const old = new Map(paths.map(p => [p, blob(J2, p)]));
const finals = new Map();
const semantic = [];
const allowedDates = new Set([
  'data/reference/afltables-network.json:/changed_at',
  'data/reference/fitzroy-accepted-baselines.json:/baselines/2/accepted_on',
  'data/reference/fitzroy-accepted-baselines.json:/baselines/2/validation/validated_on',
  'tools/rebuild/fitzroy/fitzroy-contract.json:/full_history/season_range/resolved_on',
]);
for (const p of paths) {
  const text = old.get(p).toString();
  const j = parse(old.get(p));
  const edits = [];
  function update(o, at = '') {
    for (const [k, v] of Object.entries(o)) {
      const pointer = at + '/' + k;
      if (v === '2026-10-24') {
        insist(allowedDates.has(p + ':' + pointer), 'Unexpected date field ' + p + pointer);
        o[k] = D; edits.push({ pointer, before: v, after: D });
      } else if (v && typeof v === 'object') update(v, pointer);
    }
  }
  update(j);
  // Preserve accepted proof formatting exactly; only four stamp values change.
  const next = text.replaceAll('"2026-10-24"', '"' + D + '"');
  insist(JSON.stringify(parse(Buffer.from(next))) === JSON.stringify(j), 'Non-stamp date replacement');
  finals.set(p, Buffer.from(next));
  put('finals/' + p, next);
  semantic.push({ path: p, old_J2_sha256: sha(old.get(p)), proposed_sha256: sha(next), differences: edits, non_date_semantic_changes: 0 });
}
insist(semantic.flatMap(f => f.differences).length === 4, 'Date field count');
const currentContract = parse(base.get(paths[5]));
const contractBase = structuredClone(parse(finals.get(paths[5])));
const bound = [
  '/contract_version','/pinned_version','/full_history/contract_full_history_version','/full_history/required_datasets',
  '/full_history/season_range/first_season','/full_history/season_range/last_season','/full_history/season_range/last_season_rule',
  '/full_history/season_range/resolved_on','/full_history/current_season_excluded/seasons',
  '/datasets/ladder/accepted_witness/snapshot_label','/datasets/ladder/accepted_witness/manifest',
  '/datasets/ladder/accepted_witness/manifest_sha256','/datasets/ladder/accepted_witness/files',
  '/datasets/ladder/accepted_witness/rows','/datasets/ladder/accepted_witness/acquired_on',
  '/datasets/ladder/accepted_witness/validator','/datasets/ladder/coverage',
];
for (const pointer of bound) {
  const keys = pointer.slice(1).split('/'); let oldCursor = currentContract, nextCursor = contractBase;
  for (const k of keys.slice(0, -1)) { oldCursor = oldCursor[k]; nextCursor = nextCursor[k]; }
  const k = keys.at(-1); if (Object.hasOwn(oldCursor, k)) nextCursor[k] = structuredClone(oldCursor[k]); else delete nextCursor[k];
}
doc('inputs/fitzroy-contract-base.json', contractBase);
const register = parse(finals.get(paths[3]));
const accepted = register.baselines.find(b => b.acceptance_status === 'accepted');
const predecessor = parse(base.get(paths[3])).baselines.find(b => b.acceptance_status === 'accepted');
doc('inputs/ladder-coverage.json', parse(finals.get(paths[5])).datasets.ladder.coverage);
put('inputs/stat-availability.json', finals.get(paths[6]));
doc('inputs/accepted-corrections.json', accepted.accepted_corrections);
const manifestPaths = [accepted.acquisition.manifest_path, parse(finals.get(paths[5])).datasets.ladder.accepted_witness.manifest];
for (const p of manifestPaths) put('inputs/' + p, blob(J2, p));
const inactive = blob(P, rebuildPath).toString();
const oldActive = blob(J2, rebuildPath).toString();
const tuples = ladder.parseSuccessorLadderTuples(ladder.readSuccessorLadderTuplesJson(oldActive));
insist(Object.keys(tuples).length === 1, 'Unexpected J2 successor table');
const tuple = Object.values(tuples)[0];
const active = ladder.planSuccessorTuplesEdit(inactive, tuple);
doc('successor-tuple.json', tuple);
put('pins/rebuild-test.inactive.ts.txt', inactive);
put('pins/rebuild-test.projected-active.ts.txt', active);
const comments = [
  ['/acquisition/$comment', predecessor.acquisition.$comment, accepted.acquisition.$comment],
  ['/raw_artefacts/$comment', predecessor.raw_artefacts.$comment, accepted.raw_artefacts.$comment],
  ['/validation/$comment', predecessor.validation.$comment, accepted.validation.$comment],
  ['/measured/$comment', predecessor.measured.$comment, accepted.measured.$comment],
  ['/identity_scan/$comment', predecessor.identity_scan.$comment, accepted.identity_scan.$comment],
];
const registerPatches = comments.filter(([, a, b]) => JSON.stringify(a) !== JSON.stringify(b)).map(([pointer, old, next]) => ({ pointer, old, new: next }));
const inputPaths = {
  core_manifest: manifestPaths[0], ladder_manifest: manifestPaths[1],
  ladder_coverage: rel + '/inputs/ladder-coverage.json',
  stat_availability: rel + '/inputs/stat-availability.json',
  accepted_corrections: rel + '/inputs/accepted-corrections.json',
};
const inputBytes = role => role === 'core_manifest' ? blob(J2, manifestPaths[0]) : role === 'ladder_manifest' ? blob(J2, manifestPaths[1]) : fs.readFileSync(path.join(root, inputPaths[role]));
const ref = (p, proposed) => ({ path: p, old_sha256: sha(base.get(p)), proposed, proposed_sha256: sha(fs.readFileSync(path.join(root, proposed))) });
const changeSetDoc = {
  schema: change.TRANSITION_SCHEMA, season: 2026,
  inputs: Object.entries(inputPaths).map(([role, p]) => ({ role, path: p, sha256: sha(inputBytes(role)) })),
  base: ref(paths[5], rel + '/inputs/fitzroy-contract-base.json'),
  replace: paths.slice(1, 3).map(p => ref(p, rel + '/finals/' + p)),
  register_patches: registerPatches, write_set: paths,
  ladder_successor_tuple: tuple, final_sha256: Object.fromEntries(paths.map(p => [p, sha(finals.get(p))])),
};
doc('transition-change-set.json', changeSetDoc);
const changeSetBytes = fs.readFileSync(path.join(__dirname, 'transition-change-set.json'));
const changeSet = change.parseTransitionChangeSet(changeSetBytes.toString());
const prepared = change.prepareTransition({ changeSet, season: 2026, currentContract,
  readRepo: p => base.get(p) ?? (p === rebuildPath ? Buffer.from(inactive) : null),
  readProposed: p => fs.existsSync(path.join(root, p)) ? fs.readFileSync(path.join(root, p)) : null,
  inputs: Object.fromEntries(changeSetDoc.inputs.map(i => [i.role, { path: i.path, sha256: i.sha256 }])),
});
const judged = change.assertTransitionWriteSet({ prepared, apply: false, planned: change.plannerOwnedWrites(true).map(p => ({ path: p, content: finals.get(p).toString(), reformatted: false })) });
const proofs = state.validateActivationStates({ register: finals.get(paths[3]).toString(), seasons: finals.get(paths[4]).toString(),
  contract: finals.get(paths[5]).toString(), aflApi: finals.get(paths[1]).toString(), afltables: finals.get(paths[2]).toString(),
  witnessManifest: blob(J2, manifestPaths[1]).toString(),
}, inactive, active, tuple.profile, tuple.expected_rows);
const migrations = activation.migrationSetState(fs.readdirSync(path.join(source, activation.MIGRATIONS_DIR)).filter(p => p.endsWith('.sql')).map(name => ({ name, text: fs.readFileSync(path.join(source, activation.MIGRATIONS_DIR, name), 'utf8') })));
doc('migration-binding.json', { count: migrations.count, last: migrations.last, set_sha256: migrations.setSha256 });
doc('SEMANTIC-DIFF.json', { source: J2, proposed_date: D, finals: semantic, structural_changes: ['apply write_set/final_sha256: 8 to 7, omitting rebuild-test.ts', 'successor table edit becomes a separate activation authority/write', 'rebuild-test.ts read-only at inactive pin during apply; projected active pin separate', 'activation and deactivation bind exact source/head commits and migrations'], tuple_semantics_unchanged: true });
doc('STATIC-VALIDATION.json', { source_commit: P, status: 'PASS', limits: 'Static assembly from accepted J2 proof blobs, not a new three-gate Python dry run or raw-input validation', transition_parse_and_prepare: 'PASS', write_set_count: judged.files.length, all_final_pins_match: true, inherited_predecessor_rows: 1622,
  projected_active: proofs.active, inactive_refusal: proofs.inactiveRefusal,
  change_set_sha256: sha(changeSetBytes), tuple_sha256: ladder.successorTupleSha256(tuple),
  rebuild_sha256: { inactive: sha(inactive), active: sha(active) }, migrations,
  raw_successor_inputs_present_in_repository: false,
});
doc('PIN-TABLE.json', { source_commit: P, previous_source_commit: '876dadbfa024de7d66cdb16cefb4f769d9fdd709', date: D,
  old_change_set_sha256: '85b5f05af179c83fa0fcc4898263204a6d92e6ed99069cb8bb8384f2cb1886a1', new_change_set_sha256: sha(changeSetBytes), tuple_sha256: ladder.successorTupleSha256(tuple),
  files: paths.map(p => ({ path: p, base_at_P_sha256: sha(base.get(p)), accepted_J2_final_sha256: sha(old.get(p)), proposed_final_sha256: sha(finals.get(p)) })),
  rebuild: { accepted_J2_active_sha256: sha(oldActive), inactive_at_P_sha256: sha(inactive), projected_active_at_P_sha256: sha(active) },
});
console.log(JSON.stringify({ P, D, change_set_sha256: sha(changeSetBytes), tuple_sha256: ladder.successorTupleSha256(tuple), write_set: judged.files.length, final_checks: proofs.active.finalChecks.length, expected_rows: proofs.active.expectedRows, inactive_refuses: true, migrations }));
