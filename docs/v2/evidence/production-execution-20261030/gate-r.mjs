// AFLDB V2 release: gate R, the re-rehearsal comparison (D-V2-PROD-EXEC-1 package §2.3). File-only, Node
// built-ins only. It compares the strict outputs of the accepted shadow procedure, re-run on the frozen
// bytes, with the committed outputs of the accepted a4641ca0 run, by finding code:
//   release-gates.json     whole document (every gate, every finding)
//   migration.parity.json  per check id: status and the sorted [code, severity, subject] findings
//   expected-deltas.json   classification, reasons, added tables, staged seasons
// The accepted outputs are not re-bound or edited; a difference is reported, never absorbed.
//   node gate-r.mjs <new-evidence-dir> <accepted-run-dir> <out.json>
// Exit: 0 REPRODUCED; 1 DIFFERENT; 2 invalid input (nothing written).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [fresh, accepted, out] = process.argv.slice(2);
const fail = (m) => { process.stderr.write(`gate-r: ${m}\n`); process.exit(2); };
if (!fresh || !accepted || !out) fail('usage: gate-r.mjs <new-evidence-dir> <accepted-run-dir> <out.json>');
const read = (dir, name) => {
  try { return JSON.parse(readFileSync(join(dir, name), 'utf8')); } catch (e) { return fail(`${join(dir, name)}: ${e.message}`); }
};

function diffPaths(a, b, path = '$', acc = []) {
  if (JSON.stringify(a) === JSON.stringify(b)) return acc;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffPaths(a[k], b[k], `${path}.${k}`, acc);
  } else acc.push({ path, accepted: b, fresh: a });
  return acc;
}

const parityShape = (p) => {
  if (!Array.isArray(p?.checks)) fail('migration.parity.json has no checks');
  return Object.fromEntries(p.checks.map((c) => [c.id, {
    status: c.status,
    findings: (c.findings ?? []).map((f) => [f.code, f.severity, f.subject].join(' | ')).sort(),
  }]));
};
const deltaShape = (d) => ({ classification: d.classification, reasons: d.reasons, addedTables: d.addedTables, stagedBrownlowSeasons: d.stagedBrownlowSeasons });

const differences = [
  ...diffPaths(read(fresh, 'release-gates.json'), read(accepted, 'release-gates.json'), 'release-gates'),
  ...diffPaths(parityShape(read(fresh, 'migration.parity.json')), parityShape(read(accepted, 'migration.parity.json')), 'parity'),
  ...diffPaths(deltaShape(read(fresh, 'expected-deltas.json')), deltaShape(read(accepted, 'expected-deltas.json')), 'expected-deltas'),
];
const fd = read(fresh, 'expected-deltas.json');
if (fd.classification !== 'ONLY_EXPECTED_116_117_DELTAS') differences.push({ path: 'expected-deltas.classification', fresh: fd.classification, accepted: 'ONLY_EXPECTED_116_117_DELTAS' });
const verdict = differences.length ? 'DIFFERENT' : 'REPRODUCED';
try {
  writeFileSync(out, `${JSON.stringify({ format: 'afldb.v2.gate-r.1', fresh, accepted, verdict, differences }, null, 2)}\n`, { flag: 'wx' });
} catch (e) { fail(`cannot create ${out}: ${e.message}`); }
console.log(`gate R: ${verdict}${differences.length ? ` (${differences.length} difference(s))` : ''}`);
process.exit(differences.length ? 1 : 0);
