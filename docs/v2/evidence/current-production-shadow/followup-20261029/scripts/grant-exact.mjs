// D-V2-CURRENT-SHADOW-FOLLOWUP-1 review disposition MED-3: the 4c new-object matcher compares verb, object and
// grantee only. This local, files-only check closes that gap for the measured lines: every GRANT/REVOKE line on a
// new object (from schema-sections.attempt2.json) must equal a pinned 111–117 statement in verb, object, grantee
// AND exact privilege (column privileges per column), after splitting multi-object / multi-role statements.
//   node grant-exact.mjs <schema-sections.attempt2.json> <migrationsDir> <out>
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const [sectionsPath, migDir, out] = process.argv.slice(2);
if (!out) throw new Error('usage: grant-exact.mjs <schema-sections.attempt2.json> <migrationsDir> <out>');
const norm = (x) => x.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim().replace(/;$/, '').replace(/\bpublic\./g, '');
// "GRANT a, b ON [TABLE|SEQUENCE|FUNCTION] o1, o2 TO r1, r2" -> one entry per (privilege, object, role).
const expand = (stmt) => {
  const m = /^(GRANT|REVOKE) (.+?) ON (?:(?:TABLE|SEQUENCE|FUNCTION) )?(.+?) (TO|FROM) (.+)$/i.exec(stmt);
  if (!m) return [];
  // Top-level commas only; a column list expands: "UPDATE (a, b)" -> UPDATE(A), UPDATE(B).
  const privs = m[2].toUpperCase().replace(/\s*\(\s*/g, '(').replace(/\s*\)/g, ')').split(/,(?![^()]*\))/)
    .map((p) => p.trim())
    .flatMap((p) => { const c = /^(\w+)\((.+)\)$/.exec(p); return c ? c[2].split(',').map((x) => `${c[1]}(${x.trim()})`) : [p]; });
  const objs = m[3].split(/,(?![^()]*\))/).map((o) => o.trim().replace(/\(.*\)$/, ''));
  const roles = m[5].split(',').map((r) => r.trim());
  return objs.flatMap((o) => roles.flatMap((r) => privs.map((p) => ({ verb: m[1].toUpperCase(), priv: p, obj: o, role: r }))));
};
const key = (e) => `${e.verb}|${e.priv}|${e.obj}|${e.role}`;
const files = readdirSync(migDir).filter((f) => /^11[1-7]_.*\.sql$/.test(f)).sort();
const pinned = new Map();
for (const f of files) {
  for (const raw of readFileSync(`${migDir}/${f}`, 'utf8').replace(/--.*$/gm, '').split(';')) {
    // A grant may sit inside a DO block ("IF ... THEN GRANT ..."): take it from its keyword to the statement end.
    const g = /\b(GRANT|REVOKE)\b[\s\S]*$/i.exec(raw);
    if (g) for (const e of expand(norm(g[0]))) pinned.set(key(e), f);
  }
}
const sections = JSON.parse(readFileSync(sectionsPath, 'utf8'));
const rows = [];
for (const o of sections.C.newObjects) for (const l of o.lines) {
  const entries = expand(norm(l.line));
  rows.push({ line: l.line, entries: entries.length, exactMatch: entries.length > 0 && entries.every((e) => pinned.has(key(e))),
    files: [...new Set(entries.map((e) => pinned.get(key(e))).filter(Boolean))] });
}
const result = {
  decision: 'D-V2-CURRENT-SHADOW-FOLLOWUP-1', item: '4c review disposition MED-3 (local, files only; not in the host manifest)',
  input: { sections: sectionsPath, migrations: files, pinnedEntries: pinned.size },
  counts: { newObjectLines: rows.length, exactMatches: rows.filter((r) => r.exactMatch).length },
  unmatched: rows.filter((r) => !r.exactMatch).map((r) => r.line), rows,
};
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ pinnedEntries: pinned.size, counts: result.counts, unmatched: result.unmatched }));
process.exitCode = result.unmatched.length === 0 && rows.length > 0 ? 0 : 1;
