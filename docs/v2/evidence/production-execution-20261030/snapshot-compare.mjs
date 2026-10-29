// AFLDB V2 release: file-only snapshot comparator (D-V2-PROD-EXEC-1 package, 2026-10-30).
//
// Reads two files, writes one new report, connects to nothing. Node built-ins only.
//
//   node snapshot-compare.mjs preservation --a A.preservation.json --b B.preservation.json --out R.json
//   node snapshot-compare.mjs permissions  --a A.permissions.txt   --b B.permissions.txt   --out R.json
//
// preservation: two `afldb.v2.preservation.1` snapshots written by tools/v2/shadow-capture.ts.
//   Unlike tools/v2/migration-preservation.ts (which by design refuses two different archives),
//   this compares across archives: it is the drift question ("did the data change between two
//   captures?"), not the migration question. Query contract, seal and phase must be equal;
//   scope.backupSha256 may differ and is reported. Every table's definition digest and its rows
//   as a multiset of row digests are compared, and every contract query digest. A row digest
//   covers the whole row, so equal multisets mean equal content for that table.
//   Used for gate D (frozen window dump vs the accepted a4641ca0 "before" snapshot) and gate V3
//   (post-A-REL production dump vs the rehearsed after-state of the frozen dump).
//
// permissions: two outputs of permission-readback.sql. `S|` and `E|` lines must be identical,
//   every `A|` line on both sides must end in `|ok`, `C|` (cluster role facts) differences are
//   listed for review, `I|` lines are ignored.
//
// Exit: 0 IDENTICAL; 1 DIFFERENT (or an A| FAIL); 2 invalid input or usage (nothing written);
//       3 REVIEW (permissions only: S/E identical and A ok, but C differs).

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

function usage(message) {
  process.stderr.write(`snapshot-compare: ${message}\n`
    + 'usage: snapshot-compare.mjs preservation|permissions --a FILE --b FILE --out REPORT.json\n');
  process.exit(2);
}

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  if (mode !== 'preservation' && mode !== 'permissions') usage('mode must be preservation or permissions');
  const out = { mode };
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    const value = rest[i + 1];
    if (!['--a', '--b', '--out'].includes(key) || value === undefined) usage(`unexpected argument ${key}`);
    out[key.slice(2)] = value;
  }
  if (!out.a || !out.b || !out.out) usage('--a, --b and --out are all required');
  return out;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function readInput(path) {
  try {
    const bytes = readFileSync(path);
    return { bytes, sha256: sha256(bytes) };
  } catch (err) {
    usage(`cannot read ${path}: ${err.message}`);
  }
}

function multisetDiff(a, b) {
  const counts = new Map();
  for (const d of a) counts.set(d, (counts.get(d) ?? 0) + 1);
  for (const d of b) counts.set(d, (counts.get(d) ?? 0) - 1);
  let onlyA = 0;
  let onlyB = 0;
  for (const n of counts.values()) {
    if (n > 0) onlyA += n;
    else if (n < 0) onlyB -= n;
  }
  return { onlyA, onlyB };
}

function validPreservation(s) {
  return s && s.format === 'afldb.v2.preservation.1' && s.scope && typeof s.tables === 'object'
    && s.tables !== null && typeof s.queries === 'object' && s.queries !== null
    && Object.values(s.tables).every((t) => t && typeof t.definition === 'string' && Array.isArray(t.rows));
}

function comparePreservation(aIn, bIn) {
  let a;
  let b;
  try {
    a = JSON.parse(aIn.bytes.toString('utf8'));
    b = JSON.parse(bIn.bytes.toString('utf8'));
  } catch (err) {
    usage(`invalid JSON: ${err.message}`);
  }
  if (!validPreservation(a) || !validPreservation(b)) usage('both inputs must be afldb.v2.preservation.1 snapshots');
  for (const field of ['queryContractSha256', 'seal', 'phase']) {
    if (a.scope[field] !== b.scope[field]) usage(`not like-for-like: scope.${field} differs`);
  }
  const findings = [];
  const names = [...new Set([...Object.keys(a.tables), ...Object.keys(b.tables)])].sort();
  for (const name of names) {
    const ta = a.tables[name];
    const tb = b.tables[name];
    if (!ta) { findings.push({ kind: 'TABLE_ONLY_IN_B', table: name, rowsB: tb.rows.length }); continue; }
    if (!tb) { findings.push({ kind: 'TABLE_ONLY_IN_A', table: name, rowsA: ta.rows.length }); continue; }
    if (ta.definition !== tb.definition) findings.push({ kind: 'DEFINITION_CHANGED', table: name });
    const { onlyA, onlyB } = multisetDiff(ta.rows, tb.rows);
    if (onlyA || onlyB) {
      findings.push({ kind: 'ROWS_CHANGED', table: name, rowsA: ta.rows.length, rowsB: tb.rows.length,
        rowDigestsOnlyInA: onlyA, rowDigestsOnlyInB: onlyB });
    }
  }
  const queries = [...new Set([...Object.keys(a.queries), ...Object.keys(b.queries)])].sort();
  for (const q of queries) {
    if (a.queries[q] !== b.queries[q]) findings.push({ kind: 'QUERY_CHANGED', query: q });
  }
  return {
    scopeA: a.scope, scopeB: b.scope, tablesCompared: names.length, queriesCompared: queries.length,
    findings, verdict: findings.length ? 'DIFFERENT' : 'IDENTICAL',
  };
}

function lines(input) {
  return input.bytes.toString('utf8').split(/\r?\n/).filter((l) => l.length > 0);
}

function setDiff(a, b) {
  const sb = new Set(b);
  return a.filter((x) => !sb.has(x));
}

function comparePermissions(aIn, bIn) {
  const a = lines(aIn);
  const b = lines(bIn);
  const pick = (ls, p) => ls.filter((l) => l.startsWith(p));
  const sa = [...pick(a, 'S|'), ...pick(a, 'E|')];
  const sb = [...pick(b, 'S|'), ...pick(b, 'E|')];
  if (!sa.length || !sb.length) usage('an input has no S| or E| lines; not a permission read-back');
  const aa = pick(a, 'A|');
  const ab = pick(b, 'A|');
  const ca = pick(a, 'C|');
  const cb = pick(b, 'C|');
  const unknown = [...a, ...b].filter((l) => !/^[ISECA]\|/.test(l));
  if (unknown.length) usage(`unexpected line: ${unknown[0]}`);
  const assertionFailures = [
    ...aa.filter((l) => !l.endsWith('|ok')).map((l) => ({ side: 'A', line: l })),
    ...ab.filter((l) => !l.endsWith('|ok')).map((l) => ({ side: 'B', line: l })),
  ];
  for (const [side, as] of [['A', aa], ['B', ab]]) {
    if (!as.some((l) => l.startsWith('A|afldb_app-unprivileged|'))) {
      assertionFailures.push({ side, line: 'A|afldb_app-unprivileged missing' });
    }
  }
  const stored = { onlyInA: setDiff(sa, sb), onlyInB: setDiff(sb, sa) };
  const cluster = { onlyInA: setDiff(ca, cb), onlyInB: setDiff(cb, ca) };
  const storedEqual = !stored.onlyInA.length && !stored.onlyInB.length;
  const clusterEqual = !cluster.onlyInA.length && !cluster.onlyInB.length;
  let verdict = 'IDENTICAL';
  if (!storedEqual || assertionFailures.length) verdict = 'DIFFERENT';
  else if (!clusterEqual) verdict = 'REVIEW';
  return {
    storedAndEffectiveLines: { a: sa.length, b: sb.length }, stored, assertionFailures, cluster,
    identity: { a: pick(a, 'I|'), b: pick(b, 'I|') }, verdict,
  };
}

const args = parseArgs(process.argv.slice(2));
const aIn = readInput(args.a);
const bIn = readInput(args.b);
const result = args.mode === 'preservation' ? comparePreservation(aIn, bIn) : comparePermissions(aIn, bIn);
const report = {
  format: 'afldb.v2.snapshot-compare.1', mode: args.mode,
  inputs: { a: { path: args.a, sha256: aIn.sha256 }, b: { path: args.b, sha256: bIn.sha256 } },
  ...result,
};
try {
  writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
} catch (err) {
  usage(`cannot create ${args.out} (reports are never overwritten): ${err.message}`);
}
process.stdout.write(`${args.mode}: ${report.verdict}\n`);
process.exit({ IDENTICAL: 0, DIFFERENT: 1, REVIEW: 3 }[report.verdict]);
