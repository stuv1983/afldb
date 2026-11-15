// remediation run 4, scope `qual`, P1/P0: mechanical import closure of a list of TypeScript entries (esbuild metafile, no bundle output is written).
//   node closure.mjs <out-prefix> <diff-name-list.txt> <entry> [<entry> ...]      (cwd = the checkout; needs node_modules)
// Writes <out-prefix>-per-entry.tsv (entry<TAB>input), <out-prefix>-union.txt (sorted unique inputs), <out-prefix>-intersection.txt
// (union intersected with the diff list) and prints counts. Bare npm packages are external (not followed: they are not repository files);
// the tsconfig path aliases (@/*, @afldb/*) are resolved by esbuild, so repository modules reached through them ARE in the closure.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [prefix, diffFile, ...entries] = process.argv.slice(2);
if (!prefix || !diffFile || entries.length === 0) throw new Error('usage: closure.mjs <out-prefix> <diff-list> <entry>...');
const root = process.cwd();
const req = createRequire(resolve(root, 'package.json'));
let esbuild = null;
for (const p of ['esbuild', './node_modules/tsx/node_modules/esbuild']) { try { esbuild = req(p); break; } catch { /* next */ } }
if (!esbuild) throw new Error('esbuild not found in node_modules');
console.log(`esbuild ${esbuild.version}`);
const diff = new Set(readFileSync(diffFile, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean));
const rows = [];
const union = new Set();
let failed = 0;
for (const entry of entries) {
  try {
    const r = await esbuild.build({
      entryPoints: [entry], bundle: true, write: false, metafile: true, platform: 'node', format: 'esm', packages: 'external',
      tsconfig: 'tsconfig.json', logLevel: 'silent', outdir: 'closure-out-unused', jsx: 'automatic',
      loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.node': 'empty' },
    });
    const inputs = Object.keys(r.metafile.inputs).map((p) => p.replace(/\\/g, '/'));
    for (const i of inputs) { rows.push(`${entry}\t${i}`); union.add(i); }
    console.log(`${entry}: ${inputs.length} inputs`);
  } catch (e) {
    failed++;
    console.log(`${entry}: BUILD FAILED ${String(e.message).split('\n')[0].slice(0, 200)}`);
  }
}
const u = [...union].sort();
const hit = u.filter((p) => diff.has(p));
writeFileSync(`${prefix}-per-entry.tsv`, rows.join('\n') + '\n');
writeFileSync(`${prefix}-union.txt`, u.join('\n') + '\n');
writeFileSync(`${prefix}-intersection.txt`, hit.join('\n') + (hit.length ? '\n' : ''));
console.log(`entries=${entries.length} failed=${failed} union=${u.length} intersection-with-diff=${hit.length}`);
for (const h of hit) console.log(`  HIT ${h}`);
