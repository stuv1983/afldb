// remediation run 4, scope `qual`, P5: gone / new / continuing comparison of a cell's failing ids against its baseline, keyed on <file> TAB <full test name>.
//   node compare.mjs <current-failures.tsv> <baseline-failures.tsv> <baseline-classified.tsv|-> <out.tsv>
// Output TSV columns: status, file, id, class, text-changed, current first line, baseline first line
//   status: gone (in the baseline, not now) | new (now, not in the baseline) | continuing (both)
//   class : copied ONLY from the baseline's classified file (where the owning scope record, via that file, states a class); otherwise `to-classify`
//           (`unclassified-baseline` in the source is carried as `to-classify (baseline: unclassified)`). Nothing is classified here.
import { readFileSync, writeFileSync } from 'node:fs';

const [curF, baseF, clsF, out] = process.argv.slice(2);
const load = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t'));
const key = (r) => `${r[0]}\t${r[1]}`;
const cur = new Map(load(curF).map((r) => [key(r), r]));
const base = new Map(load(baseF).map((r) => [key(r), r]));
const cls = new Map();
if (clsF && clsF !== '-') for (const r of load(clsF)) cls.set(key(r), r[2] === 'unclassified-baseline' ? r[2] : `class ${r[2]} (${r[3]})`);
const rows = [];
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const clsOf = (k) => { const c = cls.get(k); return c === undefined ? 'to-classify' : c === 'unclassified-baseline' ? 'to-classify (baseline: unclassified)' : c; };
for (const [k, b] of base) {
  if (!cur.has(k)) rows.push(['gone', b[0], b[1], clsOf(k), '', '', norm(b[2])]);
}
for (const [k, c] of cur) {
  if (base.has(k)) rows.push(['continuing', c[0], c[1], clsOf(k), norm(c[2]) === norm(base.get(k)[2]) ? 'same' : 'CHANGED', norm(c[2]), norm(base.get(k)[2])]);
  else rows.push(['new', c[0], c[1], 'to-classify', '', norm(c[2]), '']);
}
const order = { gone: 0, new: 1, continuing: 2 };
rows.sort((a, b) => order[a[0]] - order[b[0]] || (a[1] + a[2] < b[1] + b[2] ? -1 : 1));
writeFileSync(out, rows.map((r) => r.join('\t')).join('\n') + (rows.length ? '\n' : ''));
const n = (s) => rows.filter((r) => r[0] === s).length;
console.log(`${out}: baseline ids=${base.size} current ids=${cur.size} gone=${n('gone')} new=${n('new')} continuing=${n('continuing')} (text CHANGED on ${rows.filter((r) => r[4] === 'CHANGED').length})`);
