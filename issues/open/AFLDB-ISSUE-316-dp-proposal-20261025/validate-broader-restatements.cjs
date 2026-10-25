// Execute the already-proposed B/C restatements. No assertion/product edits.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const plan = JSON.parse(fs.readFileSync(path.join(__dirname, 'RESTATEMENT-PLAN.json')));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const env = { ...process.env };
for (const key of Object.keys(env)) if (/(?:DATABASE|DSN|^PG|TOKEN|PASSWORD|SECRET|PRIVATE_KEY|^NODE_OPTIONS$|^PYTHON)/i.test(key)) delete env[key];
env.NODE_OPTIONS = '--require=' + path.join(__dirname, 'offline-network-guard.cjs');
env.PYTHONPATH = path.join(__dirname, 'python-guard');
env.PYTHONDONTWRITEBYTECODE = '1';
const results = [];
for (const state of ['B', 'C']) {
  const target = path.join(root, '.local-release/issue316-dp-20261025/state-' + state);
  if (fs.existsSync(path.join(target, '.env'))) throw Error('Unavailable configuration in isolated tree');
  for (const rel of plan.files) {
    const preview = fs.readFileSync(path.join(__dirname, 'restatements/state-' + state, rel + (/\.tsx?$/.test(rel) ? '.txt' : '')));
    if (sha(preview) !== sha(fs.readFileSync(path.join(target, rel)))) throw Error('Preview differs from existing isolated state ' + state + ': ' + rel);
  }
  const prefix = 'state-' + state + '-broader';
  const audit = path.join(__dirname, 'validation', prefix + '.network.jsonl');
  if (fs.existsSync(audit)) throw Error('Refuse to replace prior audit');
  env.ISSUE316_NETWORK_AUDIT = audit;
  const tests = plan.files.filter(p => p.startsWith('tests/') && p.endsWith('.test.ts'));
  const output = path.join(__dirname, 'validation', prefix + '.results.json');
  const args = [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', ...tests, '--reporter=json', '--outputFile=' + output];
  const fd = fs.openSync(path.join(__dirname, 'validation', prefix + '.log'), 'wx');
  const started = new Date().toISOString();
  const r = cp.spawnSync(process.execPath, args, { cwd: target, env, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd);
  const j = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output)) : null;
  const events = fs.existsSync(audit) ? fs.readFileSync(audit, 'utf8').split(/\r?\n/).filter(Boolean).map(s => JSON.parse(s)) : [];
  const result = { state, started_at: started, completed_at: new Date().toISOString(), tests, exit_code: r.status, error: r.error?.message ?? null,
    passed: j?.numPassedTests, skipped: j?.numPendingTests, failed: j?.numFailedTests,
    failures: j?.testResults.flatMap(s => s.assertionResults.filter(a => a.status === 'failed').map(a => ({ name: a.fullName, message: a.failureMessages }))) ?? [],
    skips: j?.testResults.flatMap(s => s.assertionResults.filter(a => ['pending', 'skipped'].includes(a.status)).map(a => ({ name: a.fullName, status: a.status }))) ?? [],
    network_audit: { file: path.relative(__dirname, audit).replaceAll('\\', '/'), guarded_processes: new Set(events.filter(e => e.event === 'guard-loaded').map(e => e.pid)).size, blocked_attempts: events.filter(e => e.event === 'connection-refused').length },
    assertion_or_product_edits: false, production_contact: false, database_connection: false };
  fs.writeFileSync(path.join(__dirname, 'validation', prefix + '.exit.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  results.push(result);
  if (r.status !== 0 || result.failed !== 0) { process.exitCode = 1; break; }
}
