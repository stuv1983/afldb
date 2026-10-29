// Isolated Git objects and in-memory state judgement only. No checkout/apply/activation.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const P = 'def676517da3955aa18db3606785463aac464188';
const D = '2026-10-27';
const source = path.join(root, '.local-release/issue316-dp-20261025/source-P');
const sha = require(path.join(source, 'src/lib/rollover/transition-change-set.ts')).sha256Hex;
const a = require(path.join(source, 'src/lib/rollover/successor-activation.ts'));
const table = JSON.parse(fs.readFileSync(path.join(__dirname, 'PIN-TABLE.json')));
const staticProof = JSON.parse(fs.readFileSync(path.join(__dirname, 'STATIC-VALIDATION.json')));
const changeBytes = fs.readFileSync(path.join(__dirname, 'transition-change-set.json'));
const tuple = JSON.parse(fs.readFileSync(path.join(__dirname, 'successor-tuple.json')));
const obj = path.join(__dirname, 'simulation-objects');
fs.mkdirSync(obj, { recursive: true });
const env = { ...process.env, GIT_INDEX_FILE: path.join(__dirname, 'simulation.index'), GIT_OBJECT_DIRECTORY: obj,
  GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(root, '.git/objects'),
  GIT_AUTHOR_NAME: 'AFLDB Proposal', GIT_AUTHOR_EMAIL: 'proposal@afldb.invalid',
  GIT_COMMITTER_NAME: 'AFLDB Proposal', GIT_COMMITTER_EMAIL: 'proposal@afldb.invalid',
  GIT_AUTHOR_DATE: D + 'T02:00:00Z', GIT_COMMITTER_DATE: D + 'T02:00:00Z',
};
const git = (args, input) => cp.execFileSync('git', args, { cwd: root, env, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const store = (p, bytes) => {
  const oid = git(['hash-object', '-w', '--stdin'], bytes);
  git(['update-index', '--add', '--cacheinfo', '100644,' + oid + ',' + p]);
};
const docs = new Map(table.files.map(f => [f.path, fs.readFileSync(path.join(__dirname, 'finals', f.path))]));
const manifestPaths = [tuple.core_snapshot_label, tuple.witness_snapshot_label].map(l => 'docs/rebuild-manifests/afltables_fitzroy_core/' + l + '.json');
git(['read-tree', P]);
for (const [p, bytes] of docs) store(p, bytes);
for (const p of manifestPaths) store(p, fs.readFileSync(path.join(__dirname, 'inputs', p)));
const treeB = git(['write-tree']);
const commitB = git(['commit-tree', treeB, '-p', P], 'ISSUE-316 proposed State B — SIMULATION ONLY\n');
const inactive = fs.readFileSync(path.join(__dirname, 'pins/rebuild-test.inactive.ts.txt'));
const active = fs.readFileSync(path.join(__dirname, 'pins/rebuild-test.projected-active.ts.txt'));
store('tools/db/rebuild-test.ts', active);
const treeC = git(['write-tree']);
const commitC = git(['commit-tree', treeC, '-p', commitB], 'ISSUE-316 proposed State C — SIMULATION ONLY\n');
const common = { schema: a.ACTIVATION_SCHEMA, decision: '', season: 2026, profile: tuple.profile,
  rollover_date: D, source_commit: P, head_commit: '', transition_change_set_sha256: sha(changeBytes),
  tuple_sha256: table.tuple_sha256, migrations: { count: staticProof.migrations.count, last: staticProof.migrations.last, set_sha256: staticProof.migrations.setSha256 },
  rebuild_sha256: { inactive: sha(inactive), active: sha(active) },
};
const records = [];
for (const action of ['activate', 'deactivate']) {
  const doc = { ...common, action, decision: action === 'activate' ? 'D-316-ACT-20261027-PROPOSED' : 'D-316-DEACT-20261027-PROPOSED', head_commit: action === 'activate' ? commitB : commitC };
  const bytes = Buffer.from(JSON.stringify(doc, null, 2) + '\n');
  fs.writeFileSync(path.join(__dirname, action + '-authority.PROPOSED.json'), bytes);
  const authority = a.parseActivationAuthority(bytes.toString());
  const bound = a.bindActivationChangeSet(authority, changeBytes);
  const currentRebuild = action === 'activate' ? inactive : active;
  const classified = a.classifyActivationState({ authority, changeSet: bound.changeSet, tuple: bound.tuple,
    readRepo: p => p === 'tools/db/rebuild-test.ts' ? currentRebuild : docs.get(p) ?? null });
  const write = a.planActivationWrite(action, classified);
  git(['merge-base', '--is-ancestor', P, doc.head_commit]);
  a.assertCommitBinding(authority, { head: doc.head_commit, sourceIsAncestor: true });
  a.assertMigrationBinding(authority, staticProof.migrations);
  records.push({ action, authority_sha256: sha(bytes), simulated_head: doc.head_commit,
    from: write.from, to: write.to, path: write.path, before_sha256: sha(write.before), after_sha256: sha(write.after) });
}
const result = { classification: 'Offline simulations only; no branch, HEAD, real index or worktree mutation; no production authority granted',
  source_commit: P, proposed_date: D, state_B: { tree: treeB, commit: commitB, paths: [...docs.keys(), ...manifestPaths] },
  state_C: { tree: treeC, commit: commitC, paths_relative_to_B: ['tools/db/rebuild-test.ts'] },
  authority_validation: records,
  execution_limit: 'Draft authorities bind simulated commits. Actual approved apply/activation commits must be matched or authorities regenerated and reviewed; a PROPOSED decision is not owner permission.',
};
fs.writeFileSync(path.join(__dirname, 'SIMULATED-TREES-AND-AUTHORITIES.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
