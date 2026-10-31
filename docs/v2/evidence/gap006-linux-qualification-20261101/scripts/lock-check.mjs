// Compare package-lock.json against the installed node_modules (read-only; node built-ins only; nothing installed).
// usage: node lock-check.mjs <srcDir>
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = process.argv[2];
const lock = JSON.parse(readFileSync(join(src, 'package-lock.json'), 'utf8'));
let ok = 0, absentOptional = 0, bad = 0;
for (const [path, meta] of Object.entries(lock.packages)) {
  if (path === '' || meta.link) continue;
  const dir = join(src, path);
  const pj = join(dir, 'package.json');
  if (!existsSync(pj)) {
    if (meta.optional || meta.devOptional) { absentOptional++; continue; }
    bad++; console.log(`ABSENT ${path}@${meta.version}`); continue;
  }
  const v = JSON.parse(readFileSync(pj, 'utf8')).version;
  if (v === meta.version) ok++; else { bad++; console.log(`VERSION ${path}: installed ${v}, lock ${meta.version}`); }
}
console.log(`lock check: ok ${ok}, optional-absent ${absentOptional}, bad ${bad}`);
process.exit(bad ? 1 : 0);
