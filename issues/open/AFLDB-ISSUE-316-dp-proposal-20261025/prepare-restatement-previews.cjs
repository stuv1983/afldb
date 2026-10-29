// Text previews only; no product/test file is replaced and no PASS is claimed.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const d = __dirname;
const planPath = path.join(d, 'RESTATEMENT-PLAN.json');
const plan = JSON.parse(fs.readFileSync(planPath));
if (plan.preview_files) throw new Error('Previews already prepared; refuse to overwrite state-specific resolutions.');
const resolutions = [];
for (const p of plan.files) {
  const suffix = /\.tsx?$/.test(p) ? '.txt' : '';
  const file = path.join(d, 'restatements/state-C', p + suffix);
  const text = fs.readFileSync(file, 'utf8');
  const pattern = /<<<<<<< CURRENT-P\r?\n([\s\S]*?)\|\|\|\|\|\|\| ACCEPTED-J2-BASE\r?\n[\s\S]*?=======\r?\n([\s\S]*?)>>>>>>> ACCEPTED-J2-RESTATED\r?\n/g;
  let count = 0;
  const b = text.replace(pattern, (_m, current) => { count++; return current; });
  let c = text.replace(pattern, (_m, _current, accepted) => accepted);
  c = c.replace("it('lets the adopted successor reach every stage", "it('state C: lets the adopted successor reach every stage")
    .replace("it('accepts the real repository state, the adopted c2-2026-successor", "it('state C: accepts the real repository state, the adopted c2-2026-successor")
    .replace("it('ships exactly the one owner-adopted tuple", "it('state C: ships exactly the one separately activated tuple");
  const out = path.join(d, 'restatements/state-B', p + suffix);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, b);
  fs.writeFileSync(file, c);
  if (count) resolutions.push({ path: p, conflicts: count,
    state_B: 'Retain current P empty-table / pre-activation assertion blocks',
    state_C: 'Retain accepted J2 active-state blocks; explicitly label state C' });
}
plan.preview_files = plan.files.flatMap(p => ['B', 'C'].map(state => ({ state,
  path: path.relative(path.resolve(d, '../../..'), path.join(d, 'restatements/state-' + state, p + (/\.tsx?$/.test(p) ? '.txt' : ''))).replaceAll('\\', '/') })));
plan.conflict_resolutions = resolutions;
plan.status = 'Separate B/C text previews prepared, preserving state-specific conflict sides; NOT executed or accepted. Further B/C semantic reconciliation/validation remains required.';
fs.writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n');
fs.writeFileSync(path.join(d, 'restatements/README.md'), '# Proposed B/C restatement previews\n\nThese text previews are review material, not product or test changes. They merge accepted J2 restatements onto P. The three overlaps retain current pre-activation assertions in B and accepted active-state counterparts in C. They have not been executed, and clean textual merge does not prove correct state semantics. No claim of B/C suite PASS is made. See ../RESTATEMENT-PLAN.json for remaining validation and the literal-date scan. TypeScript previews use .ts.txt so they are outside the application typecheck.\n');
console.log(JSON.stringify({ preview_files: plan.preview_files.length, explicit_overlap_resolutions: resolutions }));
