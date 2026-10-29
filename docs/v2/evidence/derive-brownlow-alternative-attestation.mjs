/**
 * Offline. Recomputes every figure behind the D-V2-BROWNLOW-ALT-1 attestation from the actual captured
 * artifacts (never from a prose record) and writes (a) a derivation record and (b) an attestation whose
 * evidence references are the real files. A part is INCOMPLETE when an artifact is missing and FAIL when
 * an artifact contradicts the claim. Exclusive creation; nothing is overwritten.
 *
 *   node derive-attestation.mjs <evidenceDir> <archive> <provenance> <outDir>
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [evidenceDir, archive, provenance, outDir] = process.argv.slice(2);
if (!outDir) throw new Error('usage: derive-attestation.mjs <evidenceDir> <archive> <provenance> <outDir>');
const E = (f) => join(evidenceDir, f);
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const APPROVED = 'a583fc7d8d4376aa816253adf299a1325da7e65c994576b6b56bfa136ed11b04';

const checks = [];
const missing = new Set();
const check = (part, id, ok, detail) => checks.push({ part, id, ok: !!ok, detail });
const need = (part, file) => { if (!existsSync(file)) { missing.add(part); check(part, `present:${file}`, false, 'artifact missing'); return false; } return true; };
const inputs = {};
const hashed = (path) => { inputs[path] = sha(path); return inputs[path]; };

// ---- archive and sidecar -------------------------------------------------------------------------
const archiveSha = hashed(archive);
check('archive', 'archive-sha256', archiveSha === APPROVED, archiveSha);
const prov = json(provenance); hashed(provenance);
check('archive', 'sidecar-archive_sha256', prov.archive_sha256 === APPROVED, prov.archive_sha256);
check('archive', 'sidecar-baseline-ledger-110', Array.isArray(prov.source_metadata?.ledger) && prov.source_metadata.ledger.length === 110,
  `ledger entries ${prov.source_metadata?.ledger?.length}`);

// ---- preservation captures ------------------------------------------------------------------------
const part = 'rawVoteAuditPreservation';
const beforeP = E('before.preservation.json'), afterP = E('postmig.preservation.json');
let before, after;
if (need(part, beforeP) && need(part, afterP)) {
  hashed(beforeP); hashed(afterP);
  before = json(beforeP); after = json(afterP);
  check(part, 'same-scope', JSON.stringify(before.scope) === JSON.stringify(after.scope), JSON.stringify(before.scope));
  check(part, 'scope-is-approved-archive', before.scope.backupSha256 === APPROVED, before.scope.backupSha256);
  check(part, 'phase-migration-only', before.scope.phase === 'migration' && after.scope.phase === 'migration', before.scope.phase);
  const ledger = (s) => s.tables['afldb_meta.schema_migrations']?.rows.length;
  check(part, 'ledger-110-to-115', ledger(before) === 110 && ledger(after) === 115, `${ledger(before)} -> ${ledger(after)}`);
  const added = Object.keys(after.tables).filter((t) => !(t in before.tables)).sort();
  const V2 = ['public.award_proposal_decisions', 'public.award_proposals', 'public.brownlow_eligibility_decisions',
    'public.derived_award_projections', 'public.derived_award_results'];
  check(part, 'only-five-v2-tables-added', JSON.stringify(added) === JSON.stringify(V2), added.join(','));
  const lost = Object.keys(before.tables).filter((t) => !(t in after.tables));
  check(part, 'no-table-lost', lost.length === 0, `${Object.keys(before.tables).length} baseline tables`);
  // Every existing table: definition identical and the row multiset a superset of the baseline's (here equal).
  let defChanged = 0, rowsLost = 0, rowsAdded = 0, rowCount = 0;
  for (const [name, b] of Object.entries(before.tables)) {
    const a = after.tables[name]; if (!a) continue;
    if (a.definition !== b.definition) defChanged++;
    const m = new Map(); for (const r of a.rows) m.set(r, (m.get(r) ?? 0) + 1);
    for (const r of b.rows) { const n = m.get(r) ?? 0; if (!n) rowsLost++; else m.set(r, n - 1); }
    rowCount += b.rows.length;
    for (const n of m.values()) rowsAdded += n;
  }
  check(part, 'no-definition-or-relationship-change', defChanged === 0, `${defChanged} changed`);
  check(part, 'no-row-content-or-id-lost', rowsLost === 0, `${rowCount} baseline row hashes compared; ${rowsLost} lost`);
  check(part, 'only-ledger-rows-added', rowsAdded === 5, `${rowsAdded} new row hashes in pre-existing tables (the five migration ledger rows)`);
  const sensitive = Object.keys(before.tables).filter((t) => /brownlow|audit|award/.test(t));
  for (const t of ['public.brownlow_season_votes', 'public.brownlow_round_votes', 'public.auth_audit_log', 'public.awards', 'public.award_winners'])
    check(part, `covered:${t}`, sensitive.includes(t), `${before.tables[t]?.rows.length} rows`);
  for (const q of ['match_detail', 'player_registration', 'player_participation', 'brownlow_raw', 'award_publication', 'audit_history'])
    check(part, `projection:${q}`, before.queries[q] === after.queries[q] && /^[a-f0-9]{64}$/.test(before.queries[q]), before.queries[q]);
  check(part, 'tables-before-after', Object.keys(before.tables).length === 99 && Object.keys(after.tables).length === 104,
    `${Object.keys(before.tables).length} -> ${Object.keys(after.tables).length}`);
}

// ---- stored Brownlow reports ----------------------------------------------------------------------
const reportsPart = 'storedReports';
const bf = E('followup-brownlow-before.json'), af = E('followup-brownlow-after.json');
let reportCount = 0, beforeSha = '', afterSha = '';
if (need(reportsPart, bf) && need(reportsPart, af)) {
  beforeSha = hashed(bf); afterSha = hashed(af);
  check(reportsPart, 'byte-identical', beforeSha === afterSha, beforeSha);
  const r = json(bf).reports;
  reportCount = new Set(r.map((x) => x.source.season)).size;
  check(reportsPart, 'distinct-seasons-98', r.length === 98 && reportCount === 98, `${r.length} reports, ${reportCount} distinct seasons`);
  check(reportsPart, 'all-reconciled', r.every((x) => x.outcome === 'reconciled'), JSON.stringify(r.reduce((o, x) => ({ ...o, [x.outcome]: (o[x.outcome] ?? 0) + 1 }), {})));
  check(reportsPart, 'zero-findings', r.every((x) => x.findings.length === 0), `${r.reduce((n, x) => n + x.findings.length, 0)} findings`);
  check(reportsPart, 'stored-only-basis', r.every((x) => x.rawVotes?.basis === 'stored_totals' && x.source.evidence.matchVoteRecords === 0),
    'rawVotes.basis=stored_totals; matchVoteRecords=0 (no staged API votes)');
  check(reportsPart, 'label-not-staged-comparator', json(bf).kind === 'stored-only-alternative-NOT-staged-comparator', json(bf).kind);
  const seasons = r.map((x) => x.source.season).sort((a, b) => a - b);
  check(reportsPart, 'season-range', true, `${seasons[0]}..${seasons.at(-1)}`);
}

// ---- vitest results -------------------------------------------------------------------------------
const vitest = (partName, file, expected) => {
  let passed = 0, total = 0;
  if (!need(partName, E(file))) return { passed, total };
  hashed(E(file));
  const v = json(E(file));
  passed = v.numPassedTests; total = v.numTotalTests;
  const names = v.testResults.map((t) => t.name.replace(/^.*\/tests\//, '') + ':' + t.assertionResults.length).sort();
  check(partName, 'success', v.success === true && v.numFailedTests === 0 && v.numPendingTests === 0 && v.numTodoTests === 0,
    `passed ${v.numPassedTests}/${v.numTotalTests}; failed ${v.numFailedTests}; pending ${v.numPendingTests}`);
  const sum = v.testResults.reduce((n, t) => n + t.assertionResults.filter((a) => a.status === 'passed').length, 0);
  check(partName, 'assertion-statuses-match-totals', sum === total, `${sum} passed assertion records`);
  check(partName, 'expected-suites', JSON.stringify(names) === JSON.stringify(expected.sort()), names.join(' '));
  return { passed, total };
};
const integ = vitest('integration', 'followup-brownlow-integration.json', ['integration/v2-brownlow-eligibility.test.ts:35']);
const unit = vitest('unitReport', 'followup-brownlow-units.json',
  ['v2-brownlow-eligibility.test.ts:45', 'v2-brownlow-reconciliation.test.ts:55', 'v2-shadow-award-reports.test.ts:59']);

// ---- parity report (the four applicable checks and the staged comparator) ---------------------------
const pp = 'parity';
if (need(pp, E('migration.parity.json'))) {
  hashed(E('migration.parity.json'));
  const p = json(E('migration.parity.json'));
  const st = Object.fromEntries(p.checks.map((c) => [c.id, c]));
  for (const id of ['historical_manifest', 'table_row_counts', 'coleman', 'coverage']) check(pp, `${id}-pass`, st[id]?.status === 'pass', st[id]?.status);
  check(pp, 'staged-brownlow-incomplete', st.brownlow?.status === 'incomplete' && st.brownlow.counts.seasonsBefore === 0 && st.brownlow.counts.seasonsAfter === 0,
    `${st.brownlow?.status}; staged seasons ${st.brownlow?.counts.seasonsBefore}/${st.brownlow?.counts.seasonsAfter}`);
  check(pp, 'coleman-46', st.coleman?.counts.seasonsCompared === 46 && st.coleman.counts.seasonsBefore === 46, `${st.coleman?.counts.seasonsCompared}`);
  check(pp, 'coverage-650', st.coverage?.counts.cellsBefore === 650 && st.coverage.counts.cellsAfter === 650 && st.coverage.counts.cellsChanged === 0, `${st.coverage?.counts.cellsAfter}`);
  check(pp, 'verdict-incomplete-4-0-1', p.verdict === 'INCOMPLETE' && p.summary.pass === 4 && p.summary.fail === 0 && p.summary.incomplete === 1, JSON.stringify(p.summary));
  const man = json(E('before.manifest.json')).tables; const after = json(E('postmig.manifest.json')).tables;
  const buckets = (t) => Object.values(t).reduce((n, x) => n + (x.buckets?.length ?? x.perSeason?.length ?? 0), 0);
  check(pp, 'manifest-tables', Object.keys(man).length === 32 && Object.keys(after).length >= 32, `${Object.keys(man).length} -> ${Object.keys(after).length}; buckets ${buckets(man)} (informational)`);
}
check('staged', 'zero-staged-brownlow-seasons', existsSync(E('brownlow-seasons.txt')) && readFileSync(E('brownlow-seasons.txt'), 'utf8').trim() === '', 'brownlow-seasons.txt empty');
if (existsSync(E('brownlow-seasons.txt'))) hashed(E('brownlow-seasons.txt'));

// ---- assemble ---------------------------------------------------------------------------------------
const verdict = (name) => {
  const cs = checks.filter((c) => c.part === name || (name === 'rawVoteAuditPreservation' && (c.part === 'archive')));
  if (missing.has(name)) return 'INCOMPLETE';
  return cs.every((c) => c.ok) ? 'PASS' : 'FAIL';
};
const ev = (...refs) => refs.map(([f, d]) => `${E(f)}: ${d}`);
const attestation = {
  decision: 'D-V2-BROWNLOW-ALT-1',
  archiveSha256: archiveSha === APPROVED ? APPROVED : archiveSha,
  migrationScope: { from: 110, to: 115 },
  rawVoteAuditPreservation: { result: verdict('rawVoteAuditPreservation'), evidence: ev(
    ['before.preservation.json', 'baseline-110 complete row-hash capture, scope = approved archive, phase migration'],
    ['postmig.preservation.json', 'migrated-115 capture, identical scope; row, ID, NULL, relationship and definition comparison; brownlow_raw and audit_history projections equal']) },
  storedReports: { result: verdict('storedReports'), seasons: reportCount, beforeSha256: beforeSha, afterSha256: afterSha, evidence: ev(
    ['followup-brownlow-before.json', 'stored-only reports on the baseline-110 clone, 98 seasons'],
    ['followup-brownlow-after.json', 'stored-only reports on the migrated-115 clone, byte-identical']) },
  integration: { result: verdict('integration'), passed: integ.passed, total: integ.total, evidence: ev(
    ['followup-brownlow-integration.json', 'vitest JSON, tests/integration/v2-brownlow-eligibility.test.ts, isolated migrated clone']) },
  unitReport: { result: verdict('unitReport'), passed: unit.passed, total: unit.total, evidence: ev(
    ['followup-brownlow-units.json', 'vitest JSON, brownlow reconciliation, eligibility and shadow award report unit suites']) },
};
const record = { generated: new Date().toISOString(), inputs, checks, partVerdicts: Object.fromEntries(
  ['rawVoteAuditPreservation', 'storedReports', 'integration', 'unitReport'].map((n) => [n, attestation[n].result])),
  allChecksOk: checks.every((c) => c.ok), failed: checks.filter((c) => !c.ok) };
writeFileSync(join(outDir, 'brownlow-alternative-attestation.json'), `${JSON.stringify(attestation, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
writeFileSync(join(outDir, 'attestation-derivation.json'), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ partVerdicts: record.partVerdicts, checks: checks.length, failed: record.failed }, null, 2));
process.exitCode = record.allChecksOk ? 0 : 1;
