// AFLDB-ISSUE-265: static, DATABASE-FREE import-graph scan of test entry files.
// Nothing is executed or bundled. TypeScript's preProcessFile lists each file's
// import/export/dynamic-import specifiers; `@/` and relative specifiers are
// resolved inside the worktree (`server-only` -> tests/stubs/server-only.ts, as
// vitest.config.mts aliases it); bare package specifiers are reported, not followed.
// `import type` specifiers are followed too (conservative: more files scanned).
//
// For every repository module reached it reports module-scope statements that
// could open a connection on import:
//   - a top-level `await`;
//   - a module-scope `postgres(` / `createClient(` call or a tagged query
//     (`sql\``, `owner\``, `tx\``, `authSql\``, `importSql\``).
// Usage: node import-graph.mjs <worktreeRoot> <entry.ts> [more entries]
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const [root, ...entries] = process.argv.slice(2);
if (!root || entries.length === 0) {
  console.error('usage: node import-graph.mjs <worktreeRoot> <entry.ts> [more entries]');
  process.exit(2);
}
const ts = createRequire(join(root, 'package.json'))('typescript');

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.json'];
function resolveFile(base) {
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of EXTENSIONS) if (existsSync(base + ext)) return base + ext;
  for (const ext of EXTENSIONS) {
    const index = join(base, `index${ext}`);
    if (existsSync(index)) return index;
  }
  return null;
}

const rel = (p) => relative(root, p).replace(/\\/g, '/');
const seen = new Map(); // abs path -> importer
const packages = new Map(); // bare specifier -> first importer
const unresolved = [];
const queue = entries.map((e) => resolve(root, e));
for (const e of queue) seen.set(e, '(entry)');

while (queue.length) {
  const file = queue.shift();
  if (file.endsWith('.json')) continue;
  const info = ts.preProcessFile(readFileSync(file, 'utf8'), true, true);
  for (const { fileName: spec } of info.importedFiles) {
    let target = null;
    if (spec === 'server-only') target = join(root, 'tests', 'stubs', 'server-only.ts');
    else if (spec.startsWith('@/')) target = resolveFile(join(root, 'src', spec.slice(2)));
    else if (spec.startsWith('.')) target = resolveFile(resolve(dirname(file), spec));
    else {
      if (!packages.has(spec)) packages.set(spec, rel(file));
      continue;
    }
    if (!target) { unresolved.push(`${rel(file)} -> ${spec}`); continue; }
    if (!seen.has(target)) { seen.set(target, rel(file)); queue.push(target); }
  }
}

function scan(file) {
  const text = readFileSync(file, 'utf8');
  const findings = [];
  let depth = 0;
  let inBlockComment = false;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i];
    if (inBlockComment) {
      const end = line.indexOf('*/');
      if (end < 0) continue;
      line = line.slice(end + 2);
      inBlockComment = false;
    }
    line = line.replace(/\/\*.*?\*\//g, '');
    const open = line.indexOf('/*');
    if (open >= 0) { inBlockComment = true; line = line.slice(0, open); }
    line = line.replace(/(^|[^:])\/\/.*$/, '$1');
    const code = line.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, '""');
    if (depth === 0) {
      if (/(^|[=(,;]\s*|\breturn\s+)await\s/.test(code) || /^\s*for\s+await\b/.test(code)) {
        findings.push(`${rel(file)}:${i + 1}: top-level await: ${lines[i].trim()}`);
      }
      if (/\bpostgres\s*\(|\bcreateClient\s*\(|\b(sql|owner|tx|importSql|authSql)\s*`/.test(code)) {
        findings.push(`${rel(file)}:${i + 1}: module-scope call: ${lines[i].trim()}`);
      }
    }
    for (const ch of code) {
      if (ch === '{') depth += 1;
      else if (ch === '}') depth = Math.max(0, depth - 1);
    }
  }
  return findings;
}

const files = [...seen.keys()].sort();
console.log(`entries: ${entries.join(', ')}`);
console.log(`repository modules reached: ${files.length}`);
for (const f of files) console.log(`  ${rel(f)}   (from ${seen.get(f)})`);
console.log(`bare packages imported: ${[...packages.keys()].sort().join(', ')}`);
console.log(`unresolved specifiers: ${unresolved.length}`);
for (const u of unresolved) console.log(`  ${u}`);
const flagged = files.flatMap(scan);
console.log(`module-scope findings: ${flagged.length}`);
for (const f of flagged) console.log(`  ${f}`);
