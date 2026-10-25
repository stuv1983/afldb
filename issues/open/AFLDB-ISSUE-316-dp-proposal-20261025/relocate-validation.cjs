// Move only the validation copy created in this continuation into an existing tsconfig exclusion.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const from = path.join(__dirname, 'source-P');
const to = path.join(root, '.local-release/issue316-dp-20261025/source-P');
for (const p of [from, to]) if (!path.resolve(p).startsWith(root + path.sep)) throw Error('Outside repository');
const file = path.join(__dirname, 'SOURCE-P.json');
const provenance = JSON.parse(fs.readFileSync(file));
if (provenance.source_commit !== 'def676517da3955aa18db3606785463aac464188' || fs.existsSync(to)) throw Error('Unexpected source-copy state');
fs.mkdirSync(path.dirname(to), { recursive: true });
fs.renameSync(from, to);
provenance.original_validation_source_root = provenance.source_root;
provenance.source_root = path.relative(root, to).replaceAll('\\', '/');
provenance.relocation_reason = 'Keep generated validation copy under existing tsconfig exclusion .local-release; no product/tsconfig change';
fs.writeFileSync(file, JSON.stringify(provenance, null, 2) + '\n');
for (const name of ['prepare-proposal.cjs', 'prepare-authorities.cjs']) {
  const p = path.join(__dirname, name);
  let s = fs.readFileSync(p, 'utf8');
  s = s.replace("const source = path.join(__dirname, 'source-P');", "const source = path.join(root, '.local-release/issue316-dp-20261025/source-P');");
  if (name === 'prepare-authorities.cjs') s = s.replace("const D = '2026-10-27';", "const D = '2026-10-27';\nconst source = path.join(root, '.local-release/issue316-dp-20261025/source-P');");
  s = s.replace(/require\('\.\/source-P\/([^']+)'\)/g, (_m, p) => "require(path.join(source, '" + p + "'))");
  fs.writeFileSync(p, s);
}
function renameTyped(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) renameTyped(p);
    else if (/\.tsx?$/.test(e.name)) fs.renameSync(p, p + '.txt');
  }
}
renameTyped(path.join(__dirname, 'restatements'));
const proposal = path.join(__dirname, 'PROPOSAL.md');
let text = fs.readFileSync(proposal, 'utf8');
text = text.replace('647c3fb39ca66a572664e1dae9028e4fad4d6bdf208e6738af45f72', '647c3fb39ca66a572664e1dae9028e4fad4d6b121226d6bdf208e6738af45f72');
text = text.replace('Fixture data and generated type/cache files are outside that committed source inventory.',
  'Fixture data and generated type/cache files are outside that committed source inventory. The retained validation tree now lives under `.local-release/issue316-dp-20261025/source-P`, the existing tsconfig exclusion; no tsconfig or product edit was made. Historical run records retain their actual original validation paths.');
fs.writeFileSync(proposal, text);
console.log('VALIDATION_COPY_RELOCATED_WITHIN_REPOSITORY');
