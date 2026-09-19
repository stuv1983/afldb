// phaneslight-generated v3.7.2 api-diff
// Diffs the current API surface against a git ref. Outputs added, removed and changed
// signatures with file references, for <projectSlug>-closure to cross-check against the
// active plan's API-changes section.
//
// The OLD surface is extracted from that ref's SOURCE, never from a historical baseline
// file. This is deliberate and load-bearing: .phaneslight/registry/ is gitignored in this
// project, so no historical copy exists to read -- and even where one did, a baseline
// committed at some past moment proves only what someone regenerated then, while the
// source at a ref is the truth about that ref.
//
// Usage: node .phaneslight/scripts/api-diff.js <since-ref> [module]
// Exit 0 always (advisory): drift is REPORTED, never enforced. Closure grades it.

'use strict';

const path = require('path');
const lib = require(path.join(__dirname, 'registry-lib.js'));

const root = lib.findRoot();
if (!root) {
  console.error('api-diff: .phaneslight/config.json not found from this directory');
  process.exit(1);
}

const ref = process.argv[2];
if (!ref) {
  console.error('api-diff: usage: phaneslight api-diff <since-ref> [module]');
  console.error('api-diff: <since-ref> is any git ref -- a sha, tag, branch, or HEAD~N.');
  process.exit(1);
}
const onlyModule = process.argv[3] || null;

let config;
try {
  config = lib.loadConfig(root);
} catch (e) {
  console.error('api-diff: .phaneslight/config.json unreadable or malformed: ' + e.message);
  process.exit(1);
}

const ts = lib.loadTypeScript(root);

let oldBuild;
try {
  oldBuild = lib.buildSlices(lib.gitRefSource(root, ref), config, ts);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
const newBuild = lib.buildSlices(lib.workingTreeSource(root, config.modulePaths), config, ts);

// Key on file + name: the same exported name in two files is two contracts, and a move
// between files is a removal plus an addition, which is exactly what a reader needs to see.
const keyOf = e => e.f + '::' + e.n;

function diffSlice(oldEntries, newEntries) {
  const o = new Map(oldEntries.map(e => [keyOf(e), e]));
  const n = new Map(newEntries.map(e => [keyOf(e), e]));
  const added = [];
  const removed = [];
  const changed = [];
  for (const [k, e] of n) if (!o.has(k)) added.push(e);
  for (const [k, e] of o) if (!n.has(k)) removed.push(e);
  for (const [k, e] of n) {
    const prev = o.get(k);
    // The hash is of the whole declaration; the signature is body-stripped. Comparing the
    // hash alone would flag every body-only refactor as an API change, so a difference is
    // only reported when the SIGNATURE moved.
    if (prev && prev.h !== e.h && prev.s !== e.s) changed.push({ before: prev, after: e });
  }
  return { added, removed, changed };
}

const names = [...newBuild.slices.keys()];
let totalAdded = 0, totalRemoved = 0, totalChanged = 0;
const report = [];

for (const name of names) {
  if (onlyModule && onlyModule !== name) continue;
  const d = diffSlice(oldBuild.slices.get(name) || [], newBuild.slices.get(name) || []);
  if (!d.added.length && !d.removed.length && !d.changed.length) continue;
  totalAdded += d.added.length;
  totalRemoved += d.removed.length;
  totalChanged += d.changed.length;
  report.push({ name, ...d });
}

console.log('api-diff: ' + ref + ' -> working tree');
console.log('api-diff: extractor ' + (ts ? 'tsc-api' : 'regex-fallback') +
  ((oldBuild.degraded || newBuild.degraded) ? ' [DEGRADED -- typescript not resolvable; treat this diff as indicative only]' : ''));
console.log('');

if (!report.length) {
  console.log('No API surface changes detected across ' + names.length + ' slice(s).');
  console.log('');
  console.log('api-diff: added 0, removed 0, changed 0');
  process.exit(0);
}

for (const slice of report) {
  console.log('=== ' + slice.name + ' ===');
  // Removals first: a removed export is the change most likely to break a caller, so it
  // is the one a reader must not have to scroll past an addition list to find.
  for (const e of slice.removed) console.log('  REMOVED  ' + e.k + ' ' + e.n + '  (' + e.f + ':' + e.l + ')');
  for (const c of slice.changed) {
    console.log('  CHANGED  ' + c.after.k + ' ' + c.after.n + '  (' + c.after.f + ':' + c.after.l + ')');
    console.log('           before: ' + c.before.s);
    console.log('           after:  ' + c.after.s);
  }
  for (const e of slice.added) console.log('  ADDED    ' + e.k + ' ' + e.n + '  (' + e.f + ':' + e.l + ')');
  console.log('');
}

console.log('api-diff: added ' + totalAdded + ', removed ' + totalRemoved + ', changed ' + totalChanged +
  ' across ' + report.length + ' slice(s)');
console.log('');
console.log('Cross-check every line above against the active plan\'s API-changes section and report:');
console.log('  planned-and-found / planned-and-missing / UNPLANNED ADDITIONS.');
console.log('An unplanned change is drift even when it compiles.');
process.exit(0);
