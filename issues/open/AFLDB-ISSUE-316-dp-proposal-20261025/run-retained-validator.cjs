// Genuine unchanged P CLI, dry-run only, with hash-verified retained inputs.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const target = path.join(root, '.local-release/issue316-dp-20261025/source-P');
const rel = path.relative(root, __dirname).replaceAll('\\', '/');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const env = { ...process.env };
for (const key of Object.keys(env)) if (/(?:DATABASE|DSN|^PG|TOKEN|PASSWORD|SECRET|PRIVATE_KEY|^NODE_OPTIONS$|^PYTHON)/i.test(key)) delete env[key];
const run = process.argv[2] || 'attempt-1';
if (!/^attempt-\d+$/.test(run)) throw Error('Invalid attempt label');
const audit = path.join(__dirname, 'validation/offline-network-audit.' + run + '.jsonl');
if (fs.existsSync(audit)) throw Error('Audit already exists');
env.ISSUE316_NETWORK_AUDIT = audit;
env.NODE_OPTIONS = '--require=' + path.join(__dirname, 'offline-network-guard.cjs');
env.PYTHONPATH = path.join(__dirname, 'python-guard');
env.PYTHONDONTWRITEBYTECODE = '1';
// Exact interpreter named by the retained dry-run log, also resolved by Get-Command.
env.AFLDB_PYTHON = 'C:/Users/stuar/AppData/Local/Programs/Python/Python312/python.exe';
function inventory(dir, base = dir, out = {}) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.isSymbolicLink()) continue;
    const p = path.join(dir, e.name);
    if (e.name === '.env.example') continue; // Unused tracked template; do not consume configuration.
    if (e.name === '.env' || e.name.startsWith('.env.')) throw Error('Unavailable configuration in isolated tree: ' + p);
    if (e.isDirectory()) inventory(p, base, out);
    else if (e.isFile()) out[path.relative(base, p).replaceAll('\\', '/')] = sha(fs.readFileSync(p));
  }
  return out;
}
const before = inventory(target);
const args = ['--require', 'tsx/cjs', 'tools/db/rollover-season.ts', '--season', '2026', '--acknowledge-season-complete', '--rollover-date', '2026-10-27', '--retire-status', 'retired',
  '--core-manifest', 'docs/rebuild-manifests/afltables_fitzroy_core/c2-2026-final-core-v1.json',
  '--ladder-manifest', 'docs/rebuild-manifests/afltables_fitzroy_core/c2-2026-final-ladder-v1.json',
  '--ladder-coverage', rel + '/inputs/ladder-coverage.json', '--stat-availability', rel + '/inputs/stat-availability.json', '--accepted-corrections', rel + '/inputs/accepted-corrections.json',
  ...['afldb_prod', 'afldb_dev', 'afldb_test'].flatMap(db => ['--afl-api-ownership-census', 'artifacts/rollover/census/' + db + '.json']),
  '--afltables-retirement-decision', 'D-316-1', '--expected-club-season-rows', '1640', '--transition-change-set', rel + '/transition-change-set.json'];
const started = new Date().toISOString();
const logPath = path.join(__dirname, 'validation/retained-input-validator.' + run + '.log');
const fd = fs.openSync(logPath, 'wx');
const result = cp.spawnSync(process.execPath, args, { cwd: target, env, stdio: ['ignore', fd, fd] });
fs.closeSync(fd);
const after = inventory(target);
const log = fs.readFileSync(logPath, 'utf8');
const events = fs.existsSync(audit) ? fs.readFileSync(audit, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(s => JSON.parse(s)) : [];
const checks = {
  exit_zero: result.status === 0,
  three_real_gates: (log.match(/PRE-APPLY GATE [123]\/3/g) || []).length === 3 && log.includes('All three pre-apply gates PASSED'),
  all_final_pins_match: log.includes('final_sha256 pins match this plan for every file.'),
  dry_run: log.includes('DRY RUN') && log.includes('nothing was written'),
  root_unchanged: JSON.stringify(before) === JSON.stringify(after),
  python_three_guarded_processes: events.filter(e => e.runtime === 'python' && e.event === 'guard-loaded').length === 3,
  network_guard_loaded: events.some(e => e.runtime === 'node' && e.event === 'guard-loaded'),
};
const report = { started_at: started, completed_at: new Date().toISOString(), source_P: 'def676517da3955aa18db3606785463aac464188', proposed_D: '2026-10-27', classification: 'Offline Windows dry run; historical census inputs confer no production freshness',
  cwd: target, command: [process.execPath, ...args], python: env.AFLDB_PYTHON, exit_code: result.status, error: result.error?.message ?? null, checks,
  status: Object.values(checks).every(Boolean) ? 'PASS' : 'STOP', inventory_files: Object.keys(before).length, log_sha256: sha(Buffer.from(log)),
  tracked_or_input_changes: [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(p => before[p] !== after[p]),
  network_audit: { file: path.relative(__dirname, audit).replaceAll('\\', '/'), events, blocked_attempts: events.filter(e => e.event === 'connection-refused').length,
    interpretation: 'Socket connect/send are replaced by throwing guards before any connection; blocked attempts do not establish a connection. The initial report used the unnecessarily stronger no-attempt criterion.' }, production_contact: false, database_connection: false, apply_or_activation: false };
fs.writeFileSync(path.join(__dirname, 'validation/retained-input-validator.' + run + '.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
process.exitCode = report.status === 'PASS' ? 0 : 1;
