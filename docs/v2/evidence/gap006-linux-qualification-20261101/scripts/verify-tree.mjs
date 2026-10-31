// Verify an extracted git-archive tree against `git ls-tree -r`: every blob id, no missing, no extra files.
// usage: node verify-tree.mjs <srcDir> <ls-tree.txt>   (read-only; node built-ins only)
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';

const [src, listFile] = process.argv.slice(2);
const want = new Map();
for (const line of readFileSync(listFile, 'utf8').split('\n').filter(Boolean)) {
  const m = /^(\d+) (\w+) ([0-9a-f]{40})\t(.*)$/.exec(line);
  if (!m) throw new Error(`bad ls-tree line: ${line}`);
  want.set(m[4], { mode: m[1], type: m[2], sha: m[3] });
}
const SKIP = new Set(['node_modules', '.next', '.git', '.local-release']);
const have = [];
(function walk(dir, rel) {
  for (const name of readdirSync(dir)) {
    if (rel === '' && SKIP.has(name)) continue;
    const p = join(dir, name), r = rel ? `${rel}/${name}` : name;
    const st = lstatSync(p);
    if (st.isDirectory()) walk(p, r); else have.push([r, p, st]);
  }
})(src, '');
let ok = 0, bad = 0, extra = 0, modeBad = 0;
const seen = new Set();
for (const [r, p, st] of have) {
  const w = want.get(r);
  if (!w) { extra++; console.log(`EXTRA ${r}`); continue; }
  seen.add(r);
  if (st.isSymbolicLink()) { bad++; console.log(`SYMLINK ${r}`); continue; }
  const buf = readFileSync(p);
  const sha = createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
  if (sha !== w.sha) { bad++; console.log(`BAD ${r}`); } else ok++;
  if (((st.mode & 0o111) !== 0) !== (w.mode === '100755')) { modeBad++; console.log(`MODE ${r}`); }
}
const missing = [...want.keys()].filter((k) => !seen.has(k));
for (const m of missing) console.log(`MISSING ${m}`);
console.log(`blobs ok ${ok} / ${want.size}; bad ${bad}; missing ${missing.length}; extra ${extra}; mode mismatches ${modeBad}`);
process.exit(bad || missing.length || extra || modeBad ? 1 : 0);
