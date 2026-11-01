#!/usr/bin/env node
// Block B: assemble the two inputs the Brownlow runner's `plan` needs from REAL evidence, refusing on any inconsistency. Writes nothing else.
//   node assemble-backup-evidence.mjs --stage b1 --revision <40hex> --target <target.json> --live-baseline <baseline report> \
//        --restored-baseline <baseline report of the RESTORED copy> --sidecar <afldb_prod-*.provenance.json> --dump <archive> \
//        --restore-facts <restore-facts.json from restore-verify-b.sh> --expect-ledger-digest <64 hex> --out-dir <new or existing dir>
// Outputs (exclusive create, mode 600): restore-evidence-<stage>.json and backup-<stage>.json (the runner's FreshBackup).
// It refuses unless: the dump bytes hash to the sidecar's archive_sha256; the sidecar's ledger digest equals the expectation AND the restored
// copy's ledger digest; the live and restored baselines are for this revision and are EQUAL; the restore happened after the capture; and the
// target in the baseline reports equals the target file (so a baseline taken against another target can never be bound to this stage).
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); if (i < 0 || !argv[i + 1]) throw new Error(`${n} required`); return argv[i + 1]; };
const HEX64 = /^[0-9a-f]{64}$/;
const sha256File = (p) => new Promise((ok, no) => { const h = createHash('sha256'); createReadStream(p).on('data', (c) => h.update(c)).on('end', () => ok(h.digest('hex'))).on('error', no); });
const sameJson = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));

async function main() {
  const stage = flag('--stage'); if (!/^[a-z0-9_-]{1,24}$/.test(stage)) throw new Error('bad stage name');
  const revision = flag('--revision'); if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error('revision must be 40 hex');
  const expectDigest = flag('--expect-ledger-digest'); if (!HEX64.test(expectDigest)) throw new Error('bad expected ledger digest');
  const target = json(flag('--target')), live = json(flag('--live-baseline')), restored = json(flag('--restored-baseline'));
  const side = json(flag('--sidecar')), facts = json(flag('--restore-facts')), dump = resolve(flag('--dump'));
  const problems = [];
  if (!HEX64.test(live.baselineDigest ?? '') || !HEX64.test(restored.baselineDigest ?? '')) problems.push('a baseline report has no baselineDigest');
  if (live.baselineDigest !== restored.baselineDigest) problems.push(`live baseline ${live.baselineDigest} differs from the restored copy's ${restored.baselineDigest}`);
  if (live.revision !== revision || restored.revision !== revision) problems.push('a baseline was taken at another revision');
  if (!live.target || !sameJson(live.target, target)) problems.push('the live baseline is not for this target');
  const dumpSha = await sha256File(dump);
  if (dumpSha !== side.archive_sha256) problems.push('the dump bytes do not hash to the sidecar archive_sha256');
  if (side.observed_ledger_digest !== expectDigest) problems.push('the sidecar ledger digest is not the expected one');
  if (facts.ledgerDigest !== expectDigest) problems.push('the restored copy ledger digest is not the expected one');
  if (side.ledger_unchanged_across_capture !== true) problems.push('the ledger changed during the capture');
  if (!side.source_identity || side.source_identity.system_identifier !== target.systemIdentifier || side.source_identity.database_oid !== target.databaseOid) problems.push('the backup was taken from another target');
  const capturedAt = side.captured_end_utc, restoredAt = facts.restoredAt;
  if (!(Date.parse(restoredAt) > Date.parse(capturedAt))) problems.push('restoredAt is not after capturedAt');
  if (problems.length) { console.error('REFUSED:\n  - ' + problems.join('\n  - ')); process.exit(1); }
  const dir = resolve(flag('--out-dir')); mkdirSync(dir, { recursive: true, mode: 0o700 });
  const restoreFile = join(dir, `restore-evidence-${stage}.json`), backupFile = join(dir, `backup-${stage}.json`);
  if (existsSync(restoreFile) || existsSync(backupFile)) throw new Error('output exists; evidence is never overwritten');
  const evidence = { format: 'afldb.block-b.restore-evidence.1', stage, revision,
    backup: { archive: side.archive, sha256: dumpSha, capturedAt }, source: { ledgerDigest: side.observed_ledger_digest, target },
    restore: { restoredAt, ledgerRows: facts.ledgerRows, ledgerDigest: facts.ledgerDigest, matches: facts.matches, fixtures: facts.fixtures, baselineDigest: restored.baselineDigest, restoredTarget: restored.target },
    liveBaselineDigest: live.baselineDigest };
  writeFileSync(restoreFile, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  const fresh = { sha256: dumpSha, capturedAt, restoredAt, restoreEvidenceSha256: await sha256File(restoreFile), baselineDigest: live.baselineDigest, target };
  writeFileSync(backupFile, `${JSON.stringify(fresh, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`ASSEMBLED ${stage}: baseline ${live.baselineDigest} == restored; backup ${dumpSha}; restoredAt ${restoredAt}`);
}
main().catch((e) => { console.error(e.message ?? e); process.exit(2); });
