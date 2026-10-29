// Usage: node artifact-manifest.mjs <dir> <out-manifest>
// Writes "<sha256>  <relative/posix/path>\n" per regular file, sorted by path (byte order),
// and prints file count, total bytes, symlink count and the manifest's SHA-256.
import { readdirSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';

const [root, out] = process.argv.slice(2);
const files = []; let links = 0;
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) { links++; files.push({ rel: relative(root, p).split(sep).join('/'), link: true }); }
    else if (st.isDirectory()) walk(p);
    else if (st.isFile()) files.push({ rel: relative(root, p).split(sep).join('/'), size: st.size, p });
  }
})(root);
files.sort((a, b) => (Buffer.compare(Buffer.from(a.rel), Buffer.from(b.rel))));
let bytes = 0;
const lines = files.map((f) => {
  if (f.link) return `SYMLINK  ${f.rel}`;
  bytes += f.size;
  return `${createHash('sha256').update(readFileSync(f.p)).digest('hex')}  ${f.rel}`;
});
const text = lines.join('\n') + '\n';
writeFileSync(out, text);
console.log(JSON.stringify({ files: files.length - links, symlinks: links, bytes,
  manifest_sha256: createHash('sha256').update(text).digest('hex') }));
