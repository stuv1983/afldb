// Read-only input verifier for the run-3 rebuild. Usage:
//   node verify-inputs.mjs <checkoutRoot> <candidateDataRoot> [--only a,b] [--detail]
// Verifies candidate bytes against the TRACKED manifests/contract pins in <checkoutRoot>.
// Never writes. Prints one TSV line per input: id <TAB> verdict <TAB> detail.
import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const [, , repo, dataRoot, ...rest] = process.argv;
const only = rest.includes('--only') ? rest[rest.indexOf('--only') + 1].split(',') : null;
const detail = rest.includes("--detail");
const listFile = rest.includes("--list") ? rest[rest.indexOf("--list") + 1] : null;
const listLines = [];
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const shaFile = (p) => sha(readFileSync(p));
const lf = (p) => sha(Buffer.from(readFileSync(p).toString('utf8').replace(/\r\n/g, '\n'), 'utf8'));
const J = (p) => JSON.parse(readFileSync(join(repo, p), 'utf8'));

const reg = J('data/reference/fitzroy-accepted-baselines.json').baselines.find((b) => b.acceptance_status === 'accepted');
const fc = J('tools/rebuild/fitzroy/fitzroy-contract.json');
const ac = J('tools/rebuild/afl_api/afl-api-contract.json');
const tc = J('tools/rebuild/afltables/afltables-contract.json');
const fkg = J('data/records/first-kick-goal.source.json');

const results = [];
function emit(id, ok, info, extra) {
  results.push({ id, ok });
  console.log([id, ok ? 'VERIFIED' : 'FAILED', info].join('\t'));
  if (detail && extra) for (const e of extra) console.log('   ' + e);
}

function checkFiles(id, dir, entries, manifestPath, manifestPin, pinKind) {
  const bad = [];
  let n = 0;
  const m = join(repo, manifestPath);
  const mLf = existsSync(m) ? lf(m) : null;
  if (mLf !== manifestPin) bad.push(`manifest ${manifestPath} LF sha ${mLf} != pin ${manifestPin}`);
  if (!existsSync(dir)) { emit(id, false, `missing dir ${dir}`); return; }
  for (const [rel, want] of entries) {
    const p = join(dir, rel);
    if (!existsSync(p)) { bad.push(`MISSING ${rel}`); continue; }
    const got = shaFile(p);
    if (got !== want) bad.push(`MISMATCH ${rel} got ${got} want ${want}`);
    listLines.push(`${got}  ${p.slice(dataRoot.length + 1)}`);
    n++;
  }
  emit(id, bad.length === 0, `${dir}\tfiles=${entries.length} present=${n} bad=${bad.length}\tmanifest_lf=${mLf?.slice(0, 12)}(${pinKind})`, bad.slice(0, 20));
}

const want = (id) => !only || only.includes(id);
const S = (p) => join(dataRoot, 'sources', p);

if (want('fitzroy-core')) {
  const label = reg.snapshot_label;
  const man = J(reg.acquisition.manifest_path);
  const lines = man.files.map((f) => `${f.filename} ${f.sha256} ${f.row_count}\n`).sort().join('');
  const setHash = sha(Buffer.from(lines, 'utf8'));
  console.log(`# fitzroy-core ${label}: manifest-derived artefact_set_sha256=${setHash} register=${reg.raw_artefacts.artefact_set_sha256} files=${man.files.length} register_files=${reg.raw_artefacts.file_count}`);
  checkFiles('fitzroy-core', S(`afltables/fitzroy_core/${label}`), man.files.map((f) => [f.filename, f.sha256]), reg.acquisition.manifest_path, reg.acquisition.manifest_sha256, 'register.manifest_sha256');
}
if (want('ladder-witness')) {
  const w = fc.datasets.ladder.accepted_witness;
  const man = J(w.manifest);
  checkFiles('ladder-witness', S(`afltables/fitzroy_core/${w.snapshot_label}`), man.files.map((f) => [f.filename, f.sha256]), w.manifest, w.manifest_sha256, 'fitzroy-contract.accepted_witness');
}
if (want('afl-api-rosters')) {
  const a = ac.roster.accepted_snapshot;
  const man = J(a.manifest);
  checkFiles('afl-api-rosters', S(`afl_api/rosters/${a.snapshot_label}`), man.files.map((f) => [f.filename, f.sha256]), a.manifest, a.manifest_sha256, 'afl-api-contract.roster');
}
if (want('club-lists')) {
  const a = tc.club_player_lists.accepted_snapshot;
  const man = J(a.manifest);
  const e = [];
  for (const f of man.files) { e.push([f.raw_filename, f.raw_sha256]); e.push([f.filename, f.sha256]); }
  checkFiles('club-lists', S(`afltables/club_lists/${a.label}`), e, a.manifest, a.manifest_sha256_lf, 'afltables-contract.club_player_lists');
}
if (want('coaches')) {
  const a = tc.coaches.accepted_snapshot;
  const man = J(a.manifest);
  const e = [[man.index.raw_filename, man.index.raw_sha256]];
  for (const p of man.parsed) e.push([p.filename, p.sha256]);
  for (const f of man.files) e.push([f.raw_filename, f.raw_sha256]);
  checkFiles('coaches', S(`afltables/coaches/${a.label}`), e, a.manifest, a.manifest_sha256_lf, 'afltables-contract.coaches');
}
if (want('coaches-raw-bundle')) {
  const a = tc.coaches.accepted_snapshot;
  const b = a.raw_bundle;
  const p = S(`afltables/coaches/${a.label}/${b.filename}`);
  if (!existsSync(p)) emit('coaches-raw-bundle', false, `missing ${p}`);
  else {
    const sz = statSync(p).size; const h = shaFile(p);
    listLines.push(`${h}  ${p.slice(dataRoot.length + 1)}`);
    emit('coaches-raw-bundle', h === b.sha256 && sz === b.bytes, `${p}\tbytes=${sz}/${b.bytes}\tsha=${h}/${b.sha256}`);
  }
}
if (want('draftguru-stage-a')) {
  const man = J('docs/rebuild-manifests/draftguru/annual-html-20260826.json');
  // Manifest hashes RAW bytes (source_urls[].raw_filename / sha256); no manifest pin in a contract, so the manifest itself is the pin.
  const e = man.source_urls.map((s) => [s.raw_filename, s.sha256]);
  const dir = S('draftguru/annual-html-20260826');
  const bad = [];
  let n = 0;
  if (!existsSync(dir)) emit('draftguru-stage-a', false, `missing ${dir}`);
  else {
    for (const [rel, w] of e) { const p = join(dir, rel); if (!existsSync(p)) { bad.push('MISSING ' + rel); continue; } const g = shaFile(p); if (g !== w) bad.push('MISMATCH ' + rel); listLines.push(`${g}  ${p.slice(dataRoot.length + 1)}`); n++; }
    emit('draftguru-stage-a', bad.length === 0, `${dir}\tfiles=${e.length} present=${n} bad=${bad.length}\tmanifest_lf=${lf(join(repo, 'docs/rebuild-manifests/draftguru/annual-html-20260826.json')).slice(0, 12)}`, bad.slice(0, 20));
  }
}
if (want('first-kick-goal')) {
  const p = join(dataRoot, 'records/first-kick-goal.csv');
  if (!existsSync(p)) emit('first-kick-goal', false, `missing ${p}`);
  else {
    const h = lf(p);
    listLines.push(`${h}  ${p.slice(dataRoot.length + 1)}  (CRLF-normalised sha256, as the pin defines)`);
    const rows = readFileSync(p, 'utf8').replace(/\r\n/g, '\n').split('\n').filter(Boolean).length - 1;
    emit('first-kick-goal', h === fkg.extract_sha256, `${p}\tlf_sha=${h}\tpin=${fkg.extract_sha256}\tdata_rows=${rows}/${fkg.extract_rows}`);
  }
}
if (listFile) writeFileSync(listFile, listLines.sort((a, b) => a.split('  ')[1].localeCompare(b.split('  ')[1])).join('\n') + '\n');
const failed = results.filter((r) => !r.ok).length;
console.log(`# summary: ${results.length} inputs checked, ${failed} failed`);
process.exit(failed ? 2 : 0);
