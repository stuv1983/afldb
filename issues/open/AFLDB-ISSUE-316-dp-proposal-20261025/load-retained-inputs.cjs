// Copy only exact J2-inventoried successor inputs into existing isolated trees.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const retained = 'C:/tmp/afldb-c2-SUCCESSOR-PROPOSAL-J2-20261023T2346Z';
// Explicitly named by retained validation/dryrun-2-J2-pinned.log:1,5,9.
const external = 'D:/tmp/afldb-i316-J2-20261023T2317Z/local/dryrun-2-pinned';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const inventoryPath = path.join(retained, 'scripts/stage/FILE_ORIGINS.json');
const inventory = JSON.parse(fs.readFileSync(inventoryPath));
const entries = inventory.filter(e => /^data\/sources\/afltables\/fitzroy_core\/c2-2026-final-(?:core|ladder)-v1\//.test(e.path)
  || /^docs\/rebuild-manifests\/afltables_fitzroy_core\/c2-2026-final-(?:core|ladder)-v1\.json$/.test(e.path));
if (entries.length !== 264) throw Error('Unexpected retained successor inventory');
const report = { verified_at: new Date().toISOString(), authority: 'Owner 2026-10-25: named J2 package and its explicitly referenced local inputs, offline only',
  external_root: external, reference: path.join(retained, 'validation/dryrun-2-J2-pinned.log'), inventory: inventoryPath,
  inventory_sha256: sha(fs.readFileSync(inventoryPath)), files: [], findings: [], copied: [], historical_censuses: [] };
function persist() { fs.writeFileSync(path.join(__dirname, 'validation/external-inputs.json'), JSON.stringify(report, null, 2) + '\n'); }
for (const e of entries) {
  const p = path.resolve(external, e.path);
  if (!p.startsWith(path.resolve(external) + path.sep)) throw Error('Input outside referenced root');
  const actual = fs.existsSync(p) ? sha(fs.readFileSync(p)) : null;
  const r = { path: p, relative_path: e.path, expected_sha256: e.sha256, actual_sha256: actual, bytes: e.bytes, status: actual === e.sha256 ? 'PASS' : actual === null ? 'MISSING' : 'MISMATCH' };
  report.files.push(r);
  if (r.status !== 'PASS') report.findings.push(r);
}
persist();
if (report.findings.length) { console.log(JSON.stringify({ findings: report.findings })); process.exit(1); }
function place(target, rel, bytes) {
  const dst = path.resolve(target, rel);
  if (!dst.startsWith(path.resolve(target) + path.sep)) throw Error('Unsafe destination');
  if (fs.existsSync(dst)) { if (sha(fs.readFileSync(dst)) !== sha(bytes)) throw Error('Conflicting isolated input: ' + dst); }
  else { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, bytes, { flag: 'wx' }); }
  return dst;
}
for (const state of ['source-P', 'state-B', 'state-C']) {
  const target = path.join(root, '.local-release/issue316-dp-20261025', state);
  if (!fs.existsSync(target)) throw Error('Missing existing isolated tree: ' + target);
  for (const e of entries) place(target, e.path, fs.readFileSync(path.join(external, e.path)));
  report.copied.push({ state, files: entries.length, all_copies_hash_verified: entries.every(e => sha(fs.readFileSync(path.join(target, e.path))) === e.sha256) });
}
for (const db of ['afldb_prod', 'afldb_dev', 'afldb_test']) {
  const p = path.join(retained, 'scripts/stage/census-' + db + '.json');
  const b = fs.readFileSync(p);
  place(path.join(root, '.local-release/issue316-dp-20261025/source-P'), 'artifacts/rollover/census/' + db + '.json', b);
  report.historical_censuses.push({ path: p, sha256: sha(b), captured_at_utc: JSON.parse(b).captured_at_utc, production_freshness: 'EXPIRED; offline reproduction only; no connection' });
}
const proposalRel = path.relative(root, __dirname);
const offline = path.join(root, '.local-release/issue316-dp-20261025/source-P');
for (const rel of ['transition-change-set.json', 'inputs/ladder-coverage.json', 'inputs/stat-availability.json', 'inputs/accepted-corrections.json', 'inputs/fitzroy-contract-base.json', 'finals/tools/rebuild/afl_api/afl-api-contract.json', 'finals/tools/rebuild/afltables/afltables-contract.json']) {
  place(offline, path.join(proposalRel, rel), fs.readFileSync(path.join(__dirname, rel)));
}
report.external_material_modified = false;
persist();
console.log(JSON.stringify({ pinned_successor_inputs: entries.length, findings: report.findings.length, copies: report.copied, censuses: report.historical_censuses.length }));
