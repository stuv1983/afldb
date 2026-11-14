// run 4 baseline: attach brief section 4 classes to a failing-id TSV ONLY where run-3 records give the cause; otherwise
// `unclassified-baseline`. usage: node classify.js <failures.tsv> <rebuild|snapshot>
// Output TSV: file \t full test name \t class \t basis \t first line of failure
// Sources (all committed): run3/integb/README.md section 7 (the 53 ids, rows cited) and section 8 (rebuild-only failures, reported,
// never classified there); run3/qualification-3/README.md "Common (46)" table; run2/tests363/README.md:137-138 (T363-2, T363-3).
// A rule fires only on the base(s) where run 3 observed that failure; the same id failing on the other base is `unclassified-baseline`.
const fs = require('fs');
const base = process.argv[3];
const R = (file, re, bases, cls, basis) => ({ file, re, bases, cls, basis });
const BOTH = ['rebuild', 'snapshot'];
const rules = [
  // FIRST (the first matching rule wins): rebuild-only failures run 3 reported but did not classify (integb s8), kept unclassified-baseline
  R('club-comparison', /Jarryd Lyons|Footscray and Western Bulldogs as one continuing/, ['rebuild'], 'unclassified-baseline', 'run3 integb s8: new on the rebuild (surrogate player id differs); reported, not classified'),
  R('release-gates', /birth dates (populates 13,255|keeps the evidence behind|matches players on the profile URL)/, ['rebuild'], 'unclassified-baseline', 'run3 integb s8: new on the rebuild; reported, not classified'),
  R('gridley-corpus', /(criteria has no probed dataset gap|bounded approved-deferral policy)/, ['rebuild'], 'unclassified-baseline', 'run3 integb s8: rebuilt dataset has criterion gaps; reported, not classified'),
  R('club-comparison', /^club comparison: (crossover players|head-to-head|period-score)/, BOTH, '3', 'run3 integb s7 rows 3-26: stale witness, fails identically on both bases'),
  R('awards-reload-links', /^<file-level>$/, BOTH, '5', 'run3 integb s7 row 2: Coleman contract 46 vs 47 rows, owner decision 363-C'),
  R('gridley-corpus', /every cell through solveCellSummary/, BOTH, '5', 'run3 integb s7 row 38: limitation awaiting owner'),
  R('release-gates', /2026 is provisional \(snapshot-pinned\)/, BOTH, '5', 'run3 integb s7 rows 39-41: limitation, owner decision 363-G'),
  R('release-gates', /50-199 goals and zero Brownlow votes/, BOTH, '3', 'run3 integb s7 row 42: stale witness 261 vs 268'),
  R('release-gates', /absence is never zero records why each attendance is missing/, BOTH, '3', 'run3 integb s7 row 44'),
  R('release-gates', /club organizations and identities attaches every ladder row/, BOTH, '3', 'run3 integb s7 row 46'),
  R('release-gates', /Brownlow authority agrees with the canonical round votes/, ['snapshot'], '1', 'run3 integb s7 row 43: passes on the rebuild, fails on the snapshot'),
  R('release-gates', /birth dates leaves the remaining players honestly without a date/, ['snapshot'], '1', 'run3 integb s7 row 45: passes on the rebuild, fails on the snapshot'),
  R('admin-brownlow', /migration 094 objects and backfill/, ['snapshot'], '1', 'run3 integb s7 row 1: passes on the rebuild, fails on the snapshot'),
  R('data-editor', /Durable Match Sheet authority/, ['snapshot'], '1', 'run3 integb s7 rows 27-31: snapshot holds an active player_match_stats authority row; 0 on the rebuild'),
  R('draft-linkage', /DraftGuru bridge on afldb_test/, ['snapshot'], '1', 'run3 integb s7 rows 36-37: passes on the bridged rebuild (AFLDB_DRAFTGURU_BRIDGE), fails on the snapshot'),
  R('v2-brownlow-eligibility-2025-rehearsal', /^<file-level>$/, BOTH, '1', 'run3 integb s7 row 50: refuses by design on a non-clone base; passes on its dedicated clone (3/3)'),
  R('v2-brownlow-production-correction', /^<file-level>$/, BOTH, '1', 'run3 integb s7 row 51: refuses by design on a non-clone base; passes on its dedicated clone (8/8)'),
  R('v2-coleman-publication', /^<file-level>$/, BOTH, '1', 'run3 integb s7 row 52: refuses when a Coleman 2001 row exists; passes on the schema-only base'),
  R('settle-afl-api', /OD-5 reinstate/, BOTH, '1', 'run3 integb s7 row 49: the rebuild guard accepts only afldb_test/rebuild-named databases; passes in single-file shared mode on an afldb_v2_rb_*_test copy'),
  // shared-mode contamination documented in run 2 (cause not re-derived here)
  R('after-siren', /./, BOTH, 'unclassified-baseline', 'documented as T363-3 (run2/tests363/README.md:138): cross-file contamination in shared mode; owner of the fix: scope shared'),
  R('nl-answers-after-siren', /./, BOTH, 'unclassified-baseline', 'documented as T363-3 (run2/tests363/README.md:138): cross-file contamination in shared mode; owner of the fix: scope shared'),
];
const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean);
for (const l of lines) {
  const [f, name, msg = ''] = l.split('\t');
  const short = f.replace(/^tests\/integration\//, '').replace(/\.test\.ts$/, '');
  const hit = rules.find((r) => r.file === short && r.re.test(name) && r.bases.includes(base));
  const cls = hit ? hit.cls : 'unclassified-baseline';
  const basis = hit ? hit.basis : 'no run-3 record gives the cause on this base';
  console.log([f, name, cls, basis, msg].join('\t'));
}
