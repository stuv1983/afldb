// D-V2-CURRENT-SHADOW-FOLLOWUP-1 item 3, ATTEMPT 2. Attempt 1 read the additions from the run's
// src-vs-c478c31b-manifest.diff, whose S2 `awk '{print $1, $3}'` cut every path at its first space (so
// "data/sources/Hall of Fame/Legends.csv" was recorded as "data/sources/Hall"). This attempt derives the additions
// from the two complete manifests (paths parsed whole, spaces kept) and then proves the recorded diff is exactly
// those additions after that same truncation. Files only; one new JSON (exclusive).
//   node inventory-compare2.mjs <diff> <s2Manifest> <inventory> <verifiedManifest> <currentRehash> <tarList> <out>
import { readFileSync, writeFileSync } from 'node:fs';

const [diffPath, s2Path, invPath, verifiedPath, rehashPath, tarListPath, out] = process.argv.slice(2);
if (!out) throw new Error('usage: inventory-compare2.mjs <diff> <s2Manifest> <inventory> <verifiedManifest> <currentRehash> <tarList> <out>');
const lines = (p) => readFileSync(p, 'utf8').split('\n').filter((l) => l !== '');
const parse = (p) => new Map(lines(p).map((l) => {
  const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(l);
  if (!m) throw new Error(`unparseable line in ${p}: ${l.slice(0, 80)}`);
  return [m[2].replace(/^\.\//, ''), m[1]];
}));
const SHADOW = /^(tools\/v2\/|tools\/db\/|src\/|packages\/|docs\/v2\/preservation-queries\.json|docs\/v2\/migration-functional-evidence\.json|package\.json|package-lock\.json|tsconfig\.json)/;
const s2 = parse(s2Path), inv = parse(invPath), verified = parse(verifiedPath), rehash = parse(rehashPath);
const tar = lines(tarListPath).filter((p) => !p.endsWith('/'));

const additions = [...s2.keys()].filter((p) => !verified.has(p)).sort();
const missingFromS2 = [...verified.keys()].filter((p) => !s2.has(p));
const changedVsVerified = [...verified.keys()].filter((p) => s2.has(p) && s2.get(p) !== verified.get(p));
// The recorded diff, reproduced: "> ./<path cut at first space>" for each addition (and "<" lines for the others).
const recorded = lines(diffPath).sort();
const expected = [...additions.map((p) => `> ./${p.split(' ')[0]}`), ...missingFromS2.map((p) => `< ./${p.split(' ')[0]}`)].sort();
const recordedDiffReproduced = JSON.stringify(recorded) === JSON.stringify(expected);

const matched = [], hashMismatch = [], notInInventory = [], rehashChanged = [];
for (const p of additions) {
  if (!inv.has(p)) notInInventory.push(p);
  else if (inv.get(p) !== s2.get(p)) hashMismatch.push({ path: p, s2: s2.get(p), inventory: inv.get(p) });
  else matched.push(p);
  if (rehash.get(p) !== s2.get(p)) rehashChanged.push({ path: p, s2: s2.get(p), now: rehash.get(p) ?? null });
}
const inventoryNotAdded = [...inv.keys()].filter((p) => !additions.includes(p)).map((p) => ({
  path: p, inVerifiedManifest: verified.has(p), verifiedHashEqualsInventory: verified.get(p) === inv.get(p), s2HashEqualsInventory: s2.get(p) === inv.get(p),
}));
const tarEqualsInventory = JSON.stringify([...tar].sort()) === JSON.stringify([...inv.keys()].sort());
const withSpaces = additions.filter((p) => p.includes(' '));
const byDir = {};
for (const p of additions) { const k = p.split('/').slice(0, 3).join('/'); byDir[k] = (byDir[k] ?? 0) + 1; }

const explained = recordedDiffReproduced && missingFromS2.length === 0 && changedVsVerified.length === 0 && hashMismatch.length === 0
  && notInInventory.length === 0 && rehashChanged.length === 0 && tarEqualsInventory
  && inventoryNotAdded.every((x) => x.inVerifiedManifest && x.verifiedHashEqualsInventory);
const result = {
  decision: 'D-V2-CURRENT-SHADOW-FOLLOWUP-1', item: '3 (attempt 2: additions derived from complete manifests; space-truncation of the recorded diff reproduced)',
  inputs: { diff: diffPath, s2Manifest: s2Path, inventory: invPath, verifiedManifest: verifiedPath, currentRehash: rehashPath, tarList: tarListPath },
  counts: {
    s2ManifestFiles: s2.size, verifiedManifestFiles: verified.size, additions: additions.length, additionsWithSpaces: withSpaces.length,
    missingFromS2: missingFromS2.length, changedVsVerified: changedVsVerified.length, recordedDiffLines: recorded.length,
    inventoryEntries: inv.size, tarMembers: tar.length, additionsMatchedToInventoryPathAndHash: matched.length,
    additionsHashMismatch: hashMismatch.length, additionsNotInInventory: notInInventory.length,
    additionsChangedSinceS2: rehashChanged.length, additionsOnShadowPaths: additions.filter((p) => SHADOW.test(p)).length,
    inventoryEntriesNotAmongAdditions: inventoryNotAdded.length,
  },
  recordedDiffReproduced, tarEqualsInventory, additionsWithSpaces: withSpaces,
  additionsByDirectory: Object.fromEntries(Object.entries(byDir).sort()),
  hashMismatch, notInInventory, rehashChanged, missingFromS2, changedVsVerified, inventoryNotAdded, explained,
};
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ counts: result.counts, recordedDiffReproduced, tarEqualsInventory, explained, inventoryNotAdded }, null, 1));
process.exitCode = explained && result.counts.additionsOnShadowPaths === 0 ? 0 : 1;
