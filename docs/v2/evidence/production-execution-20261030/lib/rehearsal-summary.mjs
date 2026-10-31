// AFLDB V2 release: the isolated rehearsal's verdict (P-3). File-only. Every required evidence item must be
// present and parse, or the result is INCOMPLETE; a gate that did not hold is FAIL. Neither can become PASS.
//   node rehearsal-summary.mjs rehearse|after <evidence-dir> <out.json>
// Exit: 0 PASS; 3 PASS-PENDING-OWNER-GO (gate D/V3 found only attributed writer activity); 1 FAIL; 2 INCOMPLETE.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [mode, dir, out] = process.argv.slice(2);
if (!['rehearse', 'after'].includes(mode) || !dir || !out) { process.stderr.write('usage: rehearsal-summary.mjs rehearse|after <dir> <out>\n'); process.exit(2); }
const missing = [];
const failures = [];
const json = (name) => {
  const p = join(dir, name);
  if (!existsSync(p)) { missing.push(name); return null; }
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { missing.push(`${name} (unparseable)`); return null; }
};
const text = (name) => {
  const p = join(dir, name);
  if (!existsSync(p)) { missing.push(name); return null; }
  return readFileSync(p, 'utf8');
};
// Exit codes the runner recorded: each listed step must appear, with an allowed code.
const codes = new Map();
for (const line of (text(`${mode}.exit-codes.txt`) ?? '').split('\n')) {
  const m = /^EXIT (\S+) = (\S+)$/.exec(line);
  if (m) codes.set(m[1], m[2]);
}
const expectCode = (step, allowed) => {
  if (!codes.has(step)) missing.push(`exit code of ${step}`);
  else if (!allowed.includes(codes.get(step))) failures.push(`${step} exited ${codes.get(step)}`);
};
const gates = {};
let ownerGo = false;
// The bytes this verdict is about: A-REL and PullIso refuse a summary that does not name the frozen archive.
const input = text(`${mode}.input-sha256.txt`);
if (input !== null) {
  gates.archiveSha256 = input.trim();
  if (!/^[0-9a-f]{64}$/.test(gates.archiveSha256)) failures.push('input archive hash malformed');
}

if (mode === 'rehearse') {
  for (const [s, a] of [['gateD-compare', ['0', '1']], ['gateD-manifest', ['0', '1']], ['gateD', ['0', '1', '3']],
    ['parity', ['0', '1', '2']], ['release-gates', ['0', '1', '2']], ['expected-deltas', ['0']], ['gateR', ['0']],
    ['B-acl-fidelity', ['0']], ['B-every-named-role-exists', ['0']], ['T-suite', ['0']], ['T-43-of-43', ['0']],
    ['B-readback-deterministic', ['0']], ['B.arel-readback-all-ok', ['0']], ['AM.arel-readback-all-ok', ['0']],
    ['AM-ledger-117-extends-110', ['0']]]) expectCode(s, a);
  const d = json('gateD.json');
  if (d) {
    gates.D = { verdict: d.verdict, classes: d.classes, stops: d.stops };
    if (d.verdict === 'STOP') failures.push(`gate D STOP: ${d.stops.map((s) => `${s.subject}: ${s.reason}`).join('; ')}`);
    else if (d.verdict === 'ATTRIBUTED_ONLY') ownerGo = true;
    else if (d.verdict !== 'NO_DIFFERENCE') failures.push(`gate D verdict ${d.verdict}`);
  }
  const r = json('gateR.json');
  if (r) { gates.R = r.verdict; if (r.verdict !== 'REPRODUCED') failures.push(`gate R ${r.verdict}`); }
  const t = json('T.privileges.json');
  if (t) {
    gates.T = { total: t.numTotalTests, passed: t.numPassedTests, failed: t.numFailedTests, skipped: (t.numPendingTests ?? 0) + (t.numTodoTests ?? 0) };
    if (!(gates.T.total === 43 && gates.T.passed === 43 && gates.T.failed === 0 && gates.T.skipped === 0)) failures.push(`T ${gates.T.passed}/${gates.T.total}`);
  }
  const perm = text('B.permissions.txt');
  if (perm !== null) {
    const lines = perm.split('\n').filter(Boolean);
    const bad = lines.filter((l) => l.startsWith('A|') && !l.endsWith('|ok'));
    gates.permissionsLines = lines.length;
    if (!lines.some((l) => l.startsWith('S|')) || !lines.some((l) => l.startsWith('E|'))) failures.push('B.permissions.txt has no S|/E| facts');
    if (bad.length) failures.push(`B read-back assertion(s) not ok: ${bad.join(' ; ')}`);
  }
  const fid = text('B.fidelity.diff');
  if (fid !== null && fid.trim() !== '') failures.push('clone B does not reproduce the archive owners/ACLs');
  const dig = text('AM.ledger.digest');
  if (dig !== null) { gates.ledger117Digest = dig.trim(); if (!/^[0-9a-f]{64}$/.test(gates.ledger117Digest)) failures.push('AM ledger digest malformed'); }
} else {
  for (const [s, a] of [['gateV3-compare', ['0', '1']], ['gateV3-manifest', ['0', '1']], ['gateV3', ['0', '1', '3']],
    ['C-ledger-equals-rehearsal', ['0']]]) expectCode(s, a);
  const v = json('gateV3.json');
  if (v) {
    gates.V3 = { verdict: v.verdict, classes: v.classes, stops: v.stops };
    if (v.verdict === 'STOP') failures.push(`gate V3 STOP: ${v.stops.map((s) => `${s.subject}: ${s.reason}`).join('; ')}`);
    else if (v.verdict === 'ATTRIBUTED_ONLY') ownerGo = true;
    else if (!['NO_DIFFERENCE', 'LEDGER_TIMING_ONLY'].includes(v.verdict)) failures.push(`gate V3 verdict ${v.verdict}`);
  }
}

const result = missing.length ? `INCOMPLETE missing: ${missing.join(', ')}`
  : failures.length ? `FAIL ${failures.join(' | ')}`
    : ownerGo ? 'PASS-PENDING-OWNER-GO' : 'PASS';
writeFileSync(out, `${JSON.stringify({ format: 'afldb.v2.rehearsal-summary.1', mode, result, gates, missing, failures }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(`${mode}: ${result}`);
process.exit(missing.length ? 2 : failures.length ? 1 : ownerGo ? 3 : 0);
