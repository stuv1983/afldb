// D-V2-CURRENT-SHADOW-FOLLOWUP-1 item 4c, ATTEMPT 2: normalised schema-section comparison. Files only; no database.
//   node schema-sections.mjs <archive.schema.sql> <before.schema.sql> <postmig.schema.sql> <migrationsDir> <out>
// archive = `pg_restore --schema-only --no-owner -f` of the archive itself (production's stored DDL and ACLs);
// before/postmig = the run's `pg_dump --schema-only --no-owner` of the migration copy before and after 111-117.
// Sections are keyed by pg_dump's "-- Name: N; Type: T; Schema: S" header (owner ignored). Normalisation only:
// drop the per-dump random \restrict/\unrestrict token lines, blank lines, "--" lines and trailing whitespace;
// sort the lines inside an ACL section. Nothing else is ignored.
// Three comparisons, kept apart:
//   A archive vs before (non-ACL): restore fidelity.
//   B before vs postmig (non-ACL): MIGRATION_SUPPORTED only where a pinned 111-117 statement accounts for the
//     difference; everything else is UNCLASSIFIED and reported.
//   C ACLs: before has none (the restore used --no-privileges). Each postmig ACL section of a pre-existing object
//     is compared with the archive's stored ACL for the same object; a new object's GRANT/REVOKE lines are
//     matched against 111-117. Stored ACLs are not effective permissions: role attributes, memberships and
//     superuser are not compared.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [archivePath, beforePath, postPath, migDir, out] = process.argv.slice(2);
if (!out) throw new Error('usage: schema-sections.mjs <archive> <before> <postmig> <migrationsDir> <out>');
const sha = (t) => createHash('sha256').update(t).digest('hex');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HEADER = /^-- (?:Data for )?Name: (.*); Type: (.*); Schema: (.*); Owner: (.*)$/;
const ACL_TYPES = new Set(['ACL', 'DEFAULT ACL']);
const SCHEMAS = '(public|staging|aflw|staging_aflw|afldb_meta)';

function parse(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const sections = new Map();
  let cur = { key: 'PREAMBLE', type: 'PREAMBLE', schema: '-', name: '-', body: [] };
  const push = () => {
    let body = cur.body.filter((l) => l !== '' && l !== '--' && !/^\\(un)?restrict /.test(l)).map((l) => l.replace(/\s+$/, ''));
    if (ACL_TYPES.has(cur.type)) body = [...body].sort();
    let key = cur.key, n = 1;
    while (sections.has(key)) key = `${cur.key}#${++n}`;
    sections.set(key, { type: cur.type, schema: cur.schema, name: cur.name, body, hash: sha(body.join('\n')) });
  };
  for (let i = 0; i < lines.length; i++) {
    const m = HEADER.exec(lines[i]);
    if (m && lines[i - 1] === '--') {
      cur.body.pop(); // the "--" opener belongs to the new header
      push();
      cur = { key: `${m[2]}|${m[3]}|${m[1]}`, type: m[2], schema: m[3], name: m[1], body: [] };
      continue;
    }
    cur.body.push(lines[i]);
  }
  push();
  return sections;
}

const archive = parse(readFileSync(archivePath, 'utf8'));
const before = parse(readFileSync(beforePath, 'utf8'));
const post = parse(readFileSync(postPath, 'utf8'));
const migFiles = readdirSync(migDir).filter((f) => /^11[1-7]_.*\.sql$/.test(f)).sort();
if (migFiles.length !== 7) throw new Error(`expected exactly the seven 111-117 files, got ${migFiles.join(',')}`);
const migs = migFiles.map((f) => ({ file: f, text: readFileSync(join(migDir, f), 'utf8') }));
const lineDiff = (a, b) => ({ removed: a.body.filter((l) => !b.body.includes(l)), added: b.body.filter((l) => !a.body.includes(l)) });
const SUPPORTED = (basis) => ({ class: 'MIGRATION_SUPPORTED', basis });
const UNCLASSIFIED = (basis) => ({ class: 'UNCLASSIFIED', basis });

// Tables CREATEd by the pinned migrations: objects pg_dump emits on them (pkey/checks/identity/defaults/indexes/FKs/
// comments/triggers) were created with them.
const newTables = new Map();
for (const m of migs) for (const x of m.text.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(?:([a-z_]+)\.)?([a-z_0-9]+)/g)) newTables.set(`${x[1] ?? 'public'}.${x[2]}`, m.file);
// The table a section's DDL is about: ALTER TABLE x / CREATE TABLE x / ... ON x / COMMENT ON TABLE|COLUMN x[.col].
const subject = (s) => {
  const m = new RegExp(`(?:ALTER TABLE (?:ONLY )?|CREATE TABLE |\\bON (?:ONLY )?|COMMENT ON (?:TABLE|COLUMN) )${SCHEMAS}\\.([a-z_0-9]+)`).exec(s.body.join('\n'));
  return m ? `${m[1]}.${m[2]}` : null;
};
const filesNaming = (ident) => migs.filter((m) => new RegExp(`(^|[^a-z0-9_])${esc(ident)}([^a-z0-9_]|$)`, 'i').test(m.text)).map((m) => m.file);

function classifyAdded(s) {
  if (s.type === 'TABLE') {
    const k = `${s.schema}.${s.name}`;
    return newTables.has(k) ? SUPPORTED(`CREATE TABLE ${k} in ${newTables.get(k)}`) : UNCLASSIFIED(`table ${k} is not created by 111-117`);
  }
  const sub = subject(s);
  if (sub && newTables.has(sub)) return SUPPORTED(`${s.type} on ${sub}, created in ${newTables.get(sub)}`);
  if (s.type === 'COMMENT') { // a comment on a pre-existing object: the exact statement and text must be pinned
    const [kind, ...rest] = s.name.split(' ');
    const bodyText = /IS '((?:[^']|'')*)';$/.exec(s.body.join('\n'))?.[1];
    for (const m of migs) {
      const x = new RegExp(`COMMENT ON ${kind} (?:${esc(s.schema)}\\.)?${esc(rest.join(' '))} IS\\s*'((?:[^']|'')*)'`, 'i').exec(m.text);
      if (x) return x[1] === bodyText ? SUPPORTED(`COMMENT ON ${kind} ${s.schema}.${rest.join(' ')} in ${m.file}; text identical`)
        : UNCLASSIFIED(`comment text differs from ${m.file}`);
    }
    return UNCLASSIFIED(`no pinned COMMENT ON ${s.name}`);
  }
  const ident = ['CONSTRAINT', 'FK CONSTRAINT', 'TRIGGER', 'DEFAULT'].includes(s.type) ? s.name.split(' ').at(-1) : s.name.replace(/\(.*$/, '');
  const files = filesNaming(ident);
  if (['INDEX', 'FUNCTION', 'TRIGGER', 'CONSTRAINT', 'FK CONSTRAINT', 'SEQUENCE', 'VIEW'].includes(s.type) && files.length) {
    return SUPPORTED(`${s.type} ${ident} named in ${files.join(', ')}${sub ? ` (on pre-existing ${sub})` : ''}`);
  }
  return UNCLASSIFIED(`no pinned 111-117 statement for ${s.type} ${s.name}`);
}
function classifyChanged(a, b) {
  const d = lineDiff(a, b);
  if (a.type === 'TABLE' && d.removed.length === 1 && d.added.length === 1) {
    const r = /^\s+([a-z_0-9]+) (.+) NOT NULL(,?)$/.exec(d.removed[0]);
    if (r && d.added[0] === d.removed[0].replace(/ NOT NULL(,?)$/, '$1')) {
      const files = migs.filter((m) => new RegExp(`ALTER TABLE (?:ONLY )?${esc(a.schema)}\\.${esc(a.name)} ALTER COLUMN ${r[1]} DROP NOT NULL`, 'i').test(m.text)).map((m) => m.file);
      if (files.length) return { ...SUPPORTED(`${a.schema}.${a.name}.${r[1]}: exactly "NOT NULL" removed; DROP NOT NULL in ${files.join(', ')}`), ...d };
    }
  }
  return { ...UNCLASSIFIED('no pinned 111-117 statement accounts for this change'), ...d };
}

// ---- A: archive vs before (non-ACL) ----------------------------------------------------------------
const nonAcl = (m) => new Map([...m].filter(([, s]) => !ACL_TYPES.has(s.type) && s.type !== 'PREAMBLE'));
const aNA = nonAcl(archive), bNA = nonAcl(before), pNA = nonAcl(post);
const A = { equal: 0, onlyInArchive: [], onlyInRestored: [], changed: [] };
for (const [k, s] of aNA) { const b = bNA.get(k); if (!b) A.onlyInArchive.push({ key: k, lines: s.body }); else if (b.hash !== s.hash) A.changed.push({ key: k, ...lineDiff(s, b) }); else A.equal++; }
for (const [k, s] of bNA) if (!aNA.has(k)) A.onlyInRestored.push({ key: k, lines: s.body });

// ---- B: before vs postmig (non-ACL) -----------------------------------------------------------------
const B = { unchanged: 0, removed: [], changed: [], added: [] };
for (const [k, s] of bNA) { const p = pNA.get(k); if (!p) B.removed.push({ key: k, ...UNCLASSIFIED('section removed'), lines: s.body }); else if (p.hash !== s.hash) B.changed.push({ key: k, ...classifyChanged(s, p) }); else B.unchanged++; }
for (const [k, s] of pNA) if (!bNA.has(k)) B.added.push({ key: k, type: s.type, ...classifyAdded(s) });

// ---- C: ACL accounting --------------------------------------------------------------------------------
const aclOf = (m) => new Map([...m].filter(([, s]) => ACL_TYPES.has(s.type)));
const aA = aclOf(archive), bA = aclOf(before), pA = aclOf(post);
// Attempt 2 (correction): an ACL belongs to a NEW object only when that object was added by B (matched by schema and
// base name, since pg_dump names a FUNCTION's DDL section by argument types but its ACL section by argument names).
// Every other ACL section is treated as pre-existing and must equal the archive's stored ACL.
const baseName = (n) => n.replace(/\(.*$/, '');
const addedObjects = new Set(B.added.filter((x) => !['COMMENT', 'CONSTRAINT', 'FK CONSTRAINT', 'INDEX', 'TRIGGER', 'DEFAULT'].includes(x.type))
  .map((x) => { const s = pNA.get(x.key); return `${s.schema}|${baseName(s.name)}`; }));
const preexisting = (s) => {
  if (s.type === 'DEFAULT ACL') return true;
  const [kind, ...rest] = s.name.split(' ');
  const n = rest.join(' ');
  const target = kind === 'COLUMN' ? n.split('.')[0] : baseName(n);
  return !addedObjects.has(`${s.schema}|${target}`);
};
const grantLines = (s) => s.body.filter((l) => /^(GRANT|REVOKE) /.test(l));
const C = { preexisting: { equalToArchive: [], differsFromArchive: [], absentFromArchive: [] }, archiveOnly: [], newObjects: [] };
for (const [k, s] of pA) {
  if (preexisting(s)) {
    const a = aA.get(k);
    if (!a) C.preexisting.absentFromArchive.push({ key: k, afterReconciliation: grantLines(s) });
    else if (a.hash === s.hash) C.preexisting.equalToArchive.push(k);
    else C.preexisting.differsFromArchive.push({ key: k, onlyInArchive: a.body.filter((l) => !s.body.includes(l)), onlyAfterReconciliation: s.body.filter((l) => !a.body.includes(l)) });
  } else {
    C.newObjects.push({ key: k, lines: grantLines(s).map((l) => {
      const g = /^(GRANT|REVOKE) (.+) ON (?:TABLE |SEQUENCE |FUNCTION |SCHEMA )?(?:[a-z_]+\.)?([a-z_0-9]+)(?:\(.*\))? (?:TO|FROM) ([a-z_0-9]+|PUBLIC)(?: .*)?;$/.exec(l);
      const files = g ? migs.filter((m) => new RegExp(`${g[1]}\\s[^;]*\\bON\\s+(?:TABLE\\s+|SEQUENCE\\s+|FUNCTION\\s+)?(?:[a-z_]+\\.)?${esc(g[3])}\\b[^;]*\\b${esc(g[4])}\\b`, 'i').test(m.text)).map((m) => m.file) : [];
      return { line: l, class: files.length ? 'MIGRATION_SUPPORTED' : 'NOT_IN_PINNED_MIGRATIONS', files };
    }) });
  }
}
for (const [k, s] of aA) if (!pA.has(k)) C.archiveOnly.push({ key: k, lines: grantLines(s) });

const unclassified = [...B.removed, ...B.changed.filter((x) => x.class !== 'MIGRATION_SUPPORTED'), ...B.added.filter((x) => x.class !== 'MIGRATION_SUPPORTED')];
const tally = (xs, f) => xs.reduce((o, x) => ({ ...o, [f(x)]: (o[f(x)] ?? 0) + 1 }), {});
const summary = {
  sections: { archive: archive.size, before: before.size, post: post.size },
  A_restoreFidelity: { equal: A.equal, onlyInArchive: A.onlyInArchive.length, onlyInRestored: A.onlyInRestored.length, changed: A.changed.length },
  B_migration: { unchanged: B.unchanged, removed: B.removed.length, changed: B.changed.length, added: B.added.length,
    addedByType: tally(B.added, (x) => x.type),
    migrationSupported: [...B.changed, ...B.added].filter((x) => x.class === 'MIGRATION_SUPPORTED').length, unclassified: unclassified.length },
  C_acl: { beforeAclSections: bA.size, archiveAclSections: aA.size, postAclSections: pA.size,
    preexistingEqualToArchive: C.preexisting.equalToArchive.length, preexistingDiffersFromArchive: C.preexisting.differsFromArchive.length,
    preexistingAbsentFromArchive: C.preexisting.absentFromArchive.length, archiveOnly: C.archiveOnly.length,
    newObjectAclSections: C.newObjects.length, newObjectGrantLines: C.newObjects.reduce((n, x) => n + x.lines.length, 0),
    newObjectGrantLinesNotInPinnedMigrations: C.newObjects.reduce((n, x) => n + x.lines.filter((l) => l.class !== 'MIGRATION_SUPPORTED').length, 0) },
  newTablesFromPinnedMigrations: Object.fromEntries(newTables),
};
const record = { decision: 'D-V2-CURRENT-SHADOW-FOLLOWUP-1', item: '4c normalised schema sections (attempt 2: ACL object matching corrected)',
  inputs: { archive: [archivePath, sha(readFileSync(archivePath))], before: [beforePath, sha(readFileSync(beforePath))], post: [postPath, sha(readFileSync(postPath))],
    migrations: migs.map((m) => [m.file, sha(m.text)]) },
  normalisation: 'drop \\restrict/\\unrestrict token lines, blank and "--" lines, trailing whitespace; sort lines inside ACL sections; owner ignored (all dumps --no-owner)',
  summary, A, B, C, unclassified,
  limits: 'Stored ACLs only. Effective permissions (role attributes, memberships, superuser) are not compared here. The archive is production stored state at capture, not live production.' };
writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(summary, null, 1));
process.exitCode = unclassified.length === 0 ? 0 : 1;
