// AFLDB V2 current-production shadow: offline expected-delta CLASSIFICATION (D-V2-CURRENT-SHADOW-CAPTURE-1).
// It is not an acceptance and changes no strict result. It answers one question: do the strict reports show
// ONLY the 116/117 deltas the owner accepted for archive 7fefcd9b... (D-V2-FRESH-SCHEMA-1), with every other
// row, definition and public output preserved? D-V2-FRESH-SCHEMA-1 itself stays bound to that archive.
//   node expected-deltas.mjs <evidence-dir> "<staged seasons, space separated, may be empty>"
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, seasonsArg = ''] = process.argv.slice(2);
const read = (name) => JSON.parse(readFileSync(join(dir, name), 'utf8'));
const staged = seasonsArg.trim() ? seasonsArg.trim().split(/\s+/) : [];
const reasons = [];
const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const EXPECTED_PRESERVATION = [
  'staging.afl_api_brownlow_vote: DEFINITION_OR_RELATIONSHIP_CHANGED', // 117: eligible NOT NULL -> nullable + comment
  'public.brownlow_correction_receipts: UNAPPROVED_TABLE_ADDED', // 116: receipt table
];
const EXPECTED_ROWCOUNT_FAIL = {
  code: 'UNEXPECTED_TABLE_ADDED', severity: 'fail', subject: 'public.brownlow_correction_receipts',
  detail: 'absent before, present after (0 rows), and not a V2-added table',
};

const gates = read('release-gates.json');
const parity = read('migration.parity.json');
const before = read('before.preservation.json');
const after = read('postmig.preservation.json');

if (!sameSet(gates.preservation?.findings ?? [], EXPECTED_PRESERVATION)) reasons.push(`preservation findings differ: ${JSON.stringify(gates.preservation?.findings)}`);
if (gates.backendFunctional !== 'PASS') reasons.push(`backendFunctional is ${gates.backendFunctional}`);
if (gates.migrationCompatibility !== 'FAIL') reasons.push(`strict migrationCompatibility is ${gates.migrationCompatibility}, expected FAIL`);
if (gates.brownlowAlternative?.status !== 'NOT_APPLIED') reasons.push('a Brownlow alternative was applied; none may be supplied');
if (gates.productionDecision !== 'NO-GO') reasons.push('productionDecision is not NO-GO');

// Migration-only rows: every existing table identical, the ledger exactly +7, every new table empty.
if (JSON.stringify(before.scope) !== JSON.stringify(after.scope)) reasons.push('snapshot scopes differ');
for (const [name, b] of Object.entries(before.tables)) {
  const a = after.tables[name];
  if (!a) reasons.push(`${name}: lost`);
  else if (name === 'afldb_meta.schema_migrations' ? a.rows.length !== b.rows.length + 7 : !sameSet(b.rows, a.rows)) reasons.push(`${name}: rows differ`);
}
const added = Object.keys(after.tables).filter((n) => !(n in before.tables));
for (const n of added) if (after.tables[n].rows.length !== 0) reasons.push(`${n}: new table is not empty`);
for (const q of Object.keys(before.queries)) if (before.queries[q] !== after.queries[q]) reasons.push(`${q}: public output changed`);

// Every one of the five checks must be present exactly once (packages/derived SHADOW_PARITY_CHECK_IDS).
const ids = (parity.checks ?? []).map((c) => c.id);
if (!sameSet(ids, ['historical_manifest', 'table_row_counts', 'coleman', 'brownlow', 'coverage'])) reasons.push(`parity check set differs: ${JSON.stringify(ids)}`);
for (const check of parity.checks ?? []) {
  if (check.id === 'table_row_counts') {
    const fails = check.findings.filter((f) => f.severity === 'fail');
    if (check.status !== 'fail' || fails.length !== 1 || JSON.stringify(fails[0]) !== JSON.stringify(EXPECTED_ROWCOUNT_FAIL)) reasons.push(`table_row_counts: ${JSON.stringify(fails)}`);
  } else if (check.id === 'brownlow') {
    if (staged.length === 0 && (check.status !== 'incomplete' || check.findings.some((f) => f.code !== 'INPUT_MISSING'))) reasons.push('brownlow: expected INCOMPLETE/INPUT_MISSING with no staged seasons');
    if (staged.length > 0 && check.status !== 'pass') reasons.push(`brownlow: staged seasons [${staged.join(' ')}] present and comparator is ${check.status}`);
  } else if (check.status !== 'pass') reasons.push(`${check.id}: ${check.status}`);
}

const out = {
  classification: reasons.length ? 'UNEXPECTED_DIFFERENCES' : 'ONLY_EXPECTED_116_117_DELTAS',
  reasons, addedTables: added.sort(), stagedBrownlowSeasons: staged,
  strictResultsUnchanged: true,
  acceptance: 'NONE. Classification only. D-V2-FRESH-SCHEMA-1 / D-V2-BROWNLOW-ALT-2 are bound to archive 7fefcd9b... and do not apply; a new archive-bound owner decision is required.',
};
writeFileSync(join(dir, 'expected-deltas.json'), `${JSON.stringify(out, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(out, null, 2));
process.exitCode = reasons.length ? 1 : 0;
