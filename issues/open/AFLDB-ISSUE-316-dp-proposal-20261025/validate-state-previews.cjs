// Validate proposed state-specific test text in new excluded copies; never edit the checkout.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const source = path.join(root, '.local-release/issue316-dp-20261025/source-P');
const plan = JSON.parse(fs.readFileSync(path.join(__dirname, 'RESTATEMENT-PLAN.json')));
const sim = JSON.parse(fs.readFileSync(path.join(__dirname, 'SIMULATED-TREES-AND-AUTHORITIES.json')));
const env = { ...process.env };
for (const k of Object.keys(env)) if (/(?:DATABASE_URL|DSN|^PG(?:HOST|HOSTADDR|PORT|DATABASE|USER|PASSWORD|PASSFILE|SERVICE|SERVICEFILE|SSLMODE|SSLKEY|SSLCERT|SSLROOTCERT)$)/i.test(k)) delete env[k];
const gitEnv = { ...env, GIT_OBJECT_DIRECTORY: path.join(__dirname, 'simulation-objects'), GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(root, '.git/objects') };
const results = [];
for (const state of ['B', 'C']) {
  const target = path.join(root, '.local-release/issue316-dp-20261025/state-' + state);
  if (!target.startsWith(root + path.sep) || fs.existsSync(target)) throw Error('Unexpected validation target ' + target);
  fs.mkdirSync(target, { recursive: true });
  const archive = cp.execFileSync('git', ['archive', '--format=tar', sim['state_' + state].commit], { cwd: root, env: gitEnv, maxBuffer: 512 * 1024 * 1024 });
  cp.execFileSync('tar', ['-xf', '-', '-C', target], { input: archive, stdio: ['pipe', 'pipe', 'pipe'] });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(target, 'node_modules'), 'junction');
  fs.cpSync(path.join(source, 'data/sources'), path.join(target, 'data/sources'), { recursive: true, force: false });
  for (const p of plan.files) fs.writeFileSync(path.join(target, p), fs.readFileSync(path.join(__dirname, 'restatements/state-' + state, p + (/\.tsx?$/.test(p) ? '.txt' : ''))));
  const prefix = 'state-' + state;
  const log = fs.openSync(path.join(__dirname, 'validation', prefix + '.log'), 'w');
  const args = [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', 'tests/season-rollover.test.ts', '--reporter=json', '--outputFile=' + path.join(__dirname, 'validation', prefix + '.results.json')];
  const r = cp.spawnSync(process.execPath, args, { cwd: target, env, stdio: ['ignore', log, log] });
  fs.closeSync(log);
  const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'validation', prefix + '.results.json')));
  const result = { state, tests: ['tests/season-rollover.test.ts'], exit_code: r.status, passed: j.numPassedTests, skipped: j.numPendingTests, failed: j.numFailedTests,
    failures: j.testResults.flatMap(s => s.assertionResults.filter(a => a.status === 'failed').map(a => ({ name: a.fullName, message: a.failureMessages.map(m => m.slice(0, 1800)) }))) };
  fs.writeFileSync(path.join(__dirname, 'validation', prefix + '.exit.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  results.push(result);
}
process.exitCode = results.some(r => r.exit_code !== 0) ? 1 : 0;
