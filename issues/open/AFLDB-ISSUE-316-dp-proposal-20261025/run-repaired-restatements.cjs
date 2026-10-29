// Sequential, offline validation in existing excluded projections. No Git, DB, apply or rebuild.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const state = process.argv[2], mode = process.argv[3], attempt = process.argv[4];
if (!['B', 'C'].includes(state) || !['broader', 'focused'].includes(mode) || !/^\d+$/.test(attempt ?? '')) throw Error('Usage: B|C broader|focused attempt-number');
const dir = path.join(__dirname, 'validation/restatement-repair');
const load = p => JSON.parse(fs.readFileSync(p));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const protectedFiles = load(path.join(dir, 'protected-before.json'));
function protect() {
  const mismatches = Object.entries(protectedFiles).filter(([p, h]) => !fs.existsSync(path.join(root, p)) || sha(fs.readFileSync(path.join(root, p))) !== h).map(([p]) => p);
  if (mismatches.length) throw Error('Protected checkout/structural files changed: ' + JSON.stringify(mismatches));
  return { files: Object.keys(protectedFiles).length, mismatches };
}
protect();
const gate = name => {
  const j = load(path.join(dir, name + '.exit.json'));
  if (j.exit_code !== 0 || j.failed !== 0 || !j.expected_skips_match) throw Error('Prerequisite not green: ' + name);
};
if (state === 'C') gate('state-B-broader-final');
if (mode === 'focused') { gate('state-B-broader-final'); gate('state-C-broader-final'); }
const plan = load(path.join(__dirname, 'RESTATEMENT-PLAN.json'));
const target = path.join(root, '.local-release/issue316-dp-20261025/state-' + state);
if (!fs.existsSync(target) || fs.existsSync(path.join(target, '.env'))) throw Error('Invalid existing isolated projection');
for (const p of plan.files) fs.writeFileSync(path.join(target, p), fs.readFileSync(path.join(__dirname, 'restatements/state-' + state, p + (/\.tsx?$/.test(p) ? '.txt' : ''))));
const env = { ...process.env };
for (const key of Object.keys(env)) if (/(?:DATABASE|DSN|^PG|TOKEN|PASSWORD|SECRET|PRIVATE_KEY|^NODE_OPTIONS$|^PYTHON)/i.test(key)) delete env[key];
const prefix = `state-${state}-${mode}-${attempt}`;
const audit = path.join(dir, prefix + '.network.jsonl');
const out = path.join(dir, prefix + '.results.json');
if (fs.existsSync(out) || fs.existsSync(audit)) throw Error('Never overwrite attempt evidence');
env.NODE_OPTIONS = '--require=' + path.join(__dirname, 'restatement-network-guard.cjs');
env.PYTHONPATH = path.join(__dirname, 'python-guard');
env.PYTHONDONTWRITEBYTECODE = '1';
env.ISSUE316_NETWORK_AUDIT = audit;
const tests = mode === 'broader' ? plan.files.filter(p => p.startsWith('tests/') && p.endsWith('.test.ts')) : ['tests/season-rollover.test.ts'];
const fd = fs.openSync(path.join(dir, prefix + '.log'), 'wx');
const started = new Date().toISOString();
const r = cp.spawnSync(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', ...tests, '--no-cache', '--reporter=json', '--outputFile=' + out], { cwd: target, env, stdio: ['ignore', fd, fd] });
fs.closeSync(fd);
const j = fs.existsSync(out) ? load(out) : null;
const skips = j?.testResults.flatMap(s => s.assertionResults.filter(a => ['pending', 'skipped'].includes(a.status)).map(a => a.fullName)).sort() ?? [];
const expectedSkips = mode === 'focused' ? [] : load(path.join(__dirname, 'validation/state-B-broader.exit.json')).skips.map(s => s.name).sort();
const events = fs.existsSync(audit) ? fs.readFileSync(audit, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(s => JSON.parse(s)) : [];
const result = { state, mode, started_at: started, completed_at: new Date().toISOString(), tests, exit_code: r.status, error: r.error?.message ?? null,
  passed: j?.numPassedTests, skipped: j?.numPendingTests, failed: j?.numFailedTests,
  suite_failures: j?.numFailedTestSuites, expected_skips_match: JSON.stringify(skips) === JSON.stringify(expectedSkips), skips,
  failures: j?.testResults.flatMap(s => s.assertionResults.filter(a => a.status === 'failed').map(a => ({ name: a.fullName, message: a.failureMessages }))) ?? [],
  network_audit: { guarded_processes: new Set(events.filter(e => e.event === 'guard-loaded').map(e => e.pid)).size, blocked_attempts: events.filter(e => e.event === 'connection-refused').length, local_tsx_ipc: events.filter(e => e.event === 'tsx-local-ipc-permitted').length },
  protected_files: protect(), accepted_product_or_assertion_edits: false, proposal_assertion_edits: true,
  result_file: path.relative(__dirname, out).replaceAll('\\', '/') };
fs.writeFileSync(path.join(dir, prefix + '.exit.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, failures: result.failures.map(f => ({ name: f.name, message: f.message.map(m => m.split('\n').slice(0,3).join('\n')) })) }));
const ok = r.status === 0 && result.failed === 0 && result.expected_skips_match;
if (ok) fs.writeFileSync(path.join(dir, `state-${state}-${mode}-final.exit.json`), JSON.stringify(result, null, 2) + '\n');
process.exitCode = ok ? 0 : 1;
