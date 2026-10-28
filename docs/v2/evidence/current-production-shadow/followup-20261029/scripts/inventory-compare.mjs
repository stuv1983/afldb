// D-V2-CURRENT-SHADOW-FOLLOWUP-1 item 3: explain the S2 source-manifest additions against the approved input
// inventory. Reads files only; writes one new JSON (exclusive). Nothing is deleted or overwritten.
//   node inventory-compare.mjs <diff> <s2Manifest> <inventory> <verifiedManifest> <currentRehash> <out>
import { readFileSync, writeFileSync } from 'node:fs';

const [diffPath, s2Path, invPath, verifiedPath, rehashPath, out] = process.argv.slice(2);
if (!out) throw new Error('usage: inventory-compare.mjs <diff> <s2Manifest> <inventory> <verifiedManifest> <currentRehash> <out>');
const lines = (p) => readFileSync(p, 'utf8').split('\n').filter((l) => l !== '');
// sha256sum lines: "<hash>  ./path" (manifests) or "<hash> *path" (inventory). Paths are normalised to "path".
const parse = (p) => new Map(lines(p).map((l) => {
  const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(l);
  if (!m) throw new Error(`unparseable line in ${p}: ${l.slice(0, 80)}`);
  return [m[2].replace(/^\.\//, ''), m[1]];
}));
const SHADOW = /^(tools\/v2\/|tools\/db\/|src\/|packages\/|docs\/v2\/preservation-queries\.json|docs\/v2\/migration-functional-evidence\.json|package\.json|package-lock\.json|tsconfig\.json)/;

const diff = lines(diffPath).map((l) => { const m = /^([<>]) (.+)$/.exec(l); if (!m) throw new Error(`bad diff line ${l}`); return { side: m[1], path: m[2].replace(/^\.\//, '') }; });
const s2 = parse(s2Path), inv = parse(invPath), verified = parse(verifiedPath), rehash = parse(rehashPath);
const additions = diff.filter((d) => d.side === '>').map((d) => d.path);
const removals = diff.filter((d) => d.side === '<').map((d) => d.path);

const matched = [], hashMismatch = [], notInInventory = [], rehashChanged = [], shadowPathHits = [];
for (const p of additions) {
  if (SHADOW.test(p)) shadowPathHits.push(p);
  const h = s2.get(p);
  if (!inv.has(p)) notInInventory.push(p);
  else if (inv.get(p) !== h) hashMismatch.push({ path: p, s2: h, inventory: inv.get(p) });
  else matched.push(p);
  if (rehash.get(p) !== h) rehashChanged.push({ path: p, s2: h, now: rehash.get(p) ?? null });
}
const inventoryNotAdded = [...inv.keys()].filter((p) => !additions.includes(p)).map((p) => ({
  path: p,
  inVerifiedManifest: verified.has(p),
  verifiedHashEqualsInventory: verified.get(p) === inv.get(p),
  s2HashEqualsInventory: s2.get(p) === inv.get(p),
}));
const byDir = {};
for (const p of additions) { const k = p.split('/').slice(0, 3).join('/'); byDir[k] = (byDir[k] ?? 0) + 1; }

const result = {
  decision: 'D-V2-CURRENT-SHADOW-FOLLOWUP-1', item: 3,
  inputs: { diff: diffPath, s2Manifest: s2Path, inventory: invPath, verifiedManifest: verifiedPath, currentRehash: rehashPath },
  counts: {
    diffLines: diff.length, additions: additions.length, removalsOrChanges: removals.length,
    s2ManifestFiles: s2.size, verifiedManifestFiles: verified.size, inventoryEntries: inv.size,
    additionsMatchedToInventoryPathAndHash: matched.length, additionsHashMismatch: hashMismatch.length,
    additionsNotInInventory: notInInventory.length, additionsChangedSinceS2: rehashChanged.length,
    additionsOnShadowPaths: shadowPathHits.length, inventoryEntriesNotAmongAdditions: inventoryNotAdded.length,
  },
  additionsByDirectory: Object.fromEntries(Object.entries(byDir).sort()),
  hashMismatch, notInInventory, rehashChanged, shadowPathHits, inventoryNotAdded,
  explained: removals.length === 0 && hashMismatch.length === 0 && notInInventory.length === 0 && rehashChanged.length === 0,
};
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ counts: result.counts, explained: result.explained, inventoryNotAdded }, null, 1));
process.exitCode = result.explained && shadowPathHits.length === 0 ? 0 : 1;
