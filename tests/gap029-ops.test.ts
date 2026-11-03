import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { EXIT_CODE } from '../tools/v2/gap029-common';
import {
  APPLY_MIN_BACKUP_LEFT_MS, GENUINE, STAGES, STAGE_IDS, approvalProblems, approvalStatement, backupEvidenceBasicProblems, buildApproval, captureProblems, classifyOutcome,
  manifestProblems, parseProfile, parseSha256Sums, planProblems, sha256Hex, targetProblems, type Manifest, type Profile, type StageId,
} from '../tools/v2/gap029-ops-lib';

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const prod = parseProfile(read('tools/v2/gap029-ops/profile.production.env'));
const PROFILE = prod.profile;
const h = (s: string) => sha256Hex(Buffer.from(s));

/* ---------- a synthetic, correct capture directory ---------- */
const NOW = Date.parse('2026-11-04T01:00:00.000Z');
function capture(over: { sidecar?: (s: any) => void; files?: (f: Record<string, Buffer>) => void; stage?: StageId; ledgerRows?: number; startedAt?: string } = {}) {
  const stage = over.stage ?? 'S1';
  const rows = Array.from({ length: over.ledgerRows ?? Number(PROFILE.EXPECT_LEDGER_ROWS) }, (_v, i) => (i === (over.ledgerRows ?? Number(PROFILE.EXPECT_LEDGER_ROWS)) - 1 ? `${PROFILE.EXPECT_LEDGER_LAST}\tc${i}` : `${String(i).padStart(3, '0')}_x.sql\tc${i}`));
  const ledger = Buffer.from(`${rows.join('\n')}\n`);
  const dump = Buffer.from('PGDMP-synthetic-dump-bytes');
  const startMs = Date.parse(over.startedAt ?? '2026-11-04T00:45:00.100Z'); const iso = (ms: number) => new Date(ms).toISOString();
  const stamp = iso(startMs).replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'); const dumpName = `afldb_prod-${stamp}.dump`; const sideName = `afldb_prod-${stamp}.provenance.json`;
  const sidecar: any = {
    format: 'afldb.v2.capture-provenance.2', decision: `GAP029-${stage}-BACKUP-20261103`, evidence_class: PROFILE.EVIDENCE_CLASS, capture_profile: PROFILE.PROFILE_NAME,
    source_identity: { host: PROFILE.EXPECT_HOST, database: PROFILE.EXPECT_DB, role: 'afldb_backup', address: '127.0.0.1', port: Number(PROFILE.EXPECT_DB_PORT), cluster: PROFILE.EXPECT_CLUSTER, version: '16.15', database_oid: PROFILE.EXPECT_OID, system_identifier: PROFILE.EXPECT_SYSID, owner: 'afldb_owner' },
    captured_start_utc: iso(startMs), captured_end_utc: iso(startMs + 20000), ledger_measured_before_utc: iso(startMs - 1000), ledger_measured_after_utc: iso(startMs + 21000),
    observed_ledger: rows.map((r) => ({ name: r.split('\t')[0], checksum: r.split('\t')[1] })), observed_ledger_digest: sha256Hex(ledger), ledger_unchanged_across_capture: true, extensions: PROFILE.EXPECT_EXT,
    archive: dumpName, archive_bytes: dump.length, archive_sha256: sha256Hex(dump), archive_toc_entries: 1648, toc_readable: true,
  };
  over.sidecar?.(sidecar);
  const files: Record<string, Buffer> = { [dumpName]: dump, [sideName]: Buffer.from(JSON.stringify(sidecar)), 'archive.toc': Buffer.from(';toc\n'), 'ledger-before.tsv': ledger, 'ledger-after.tsv': ledger, 'pg-dump.stderr': Buffer.alloc(0) };
  const listed = [dumpName, sideName, 'archive.toc', 'ledger-before.tsv', 'ledger-after.tsv', 'pg-dump.stderr'];
  files['SHA256SUMS'] = Buffer.from(`${listed.map((n) => `${sha256Hex(files[n])}  ${n}`).join('\n')}\n`);
  over.files?.(files);
  return { files, stage, dumpName, sideName };
}

describe('production profile', () => {
  it('parses cleanly and carries the reviewed production identity', () => {
    expect(prod.problems).toEqual([]);
    expect(PROFILE).toMatchObject({ PROFILE_NAME: 'production', EVIDENCE_CLASS: GENUINE, EXPECT_HOST: 'afldb-prod', EXPECT_USER: 'arm', EXPECT_SYSID: '7674454702926115004', EXPECT_OID: '66668',
      EXPECT_DB: 'afldb_prod', EXPECT_DB_PORT: '5432', EXPECT_LEDGER_ROWS: '118', EXPECT_LEDGER_LAST: '118_fixtures_unconfirmed_participants.sql', SSH_HOST: 'afldb' });
  });
  it('refuses code, repeats, unknown and missing keys', () => {
    const base = read('tools/v2/gap029-ops/profile.production.env');
    expect(parseProfile(`${base}\nX="$(rm -rf /)"`).problems.join()).toMatch(/not KEY=|not recognised/);
    expect(parseProfile(`${base}\nNODE="/x"`).problems.join()).toMatch(/repeated/);
    expect(parseProfile(`${base}\nEXTRA="1"`).problems.join()).toMatch(/not recognised/);
    expect(parseProfile(base.replace(/^EXPECT_OID=.*$/m, '')).problems.join()).toMatch(/EXPECT_OID is missing/);
    expect(parseProfile(`${base}\nA=\`id\``).problems.length).toBeGreaterThan(0);
  });
  it('every wrapper script validates the profile as plain KEY="value" lines before sourcing it', () => {
    for (const f of ['prod-stage.sh', 'capture-prod-stage.sh', 'restore-assemble-host.sh']) expect(read(`tools/v2/gap029-ops/${f}`)).toContain('grep -qvE \'^(#.*|[A-Z_]+="[^"$`\\\\]*"|)$\'');
  });
});

describe('capture directory check', () => {
  const ok = (c: ReturnType<typeof capture>, profile: Profile = PROFILE, now = NOW) => captureProblems(c.stage, { files: c.files }, profile, now);
  it('accepts a correct, fresh capture', () => { expect(ok(capture())).toEqual([]); });
  it('refuses another stage label, class, profile, host, oid, system id or port', () => {
    expect(ok(capture({ stage: 'S2', sidecar: (s) => { s.decision = 'GAP029-S1-BACKUP-20261103'; } })).join()).toMatch(/not a S2 capture/);
    expect(ok(capture({ sidecar: (s) => { s.evidence_class = 'SIMULATION'; } })).join()).toMatch(/evidence class SIMULATION/);
    expect(ok(capture({ sidecar: (s) => { s.capture_profile = 'sim'; } })).join()).toMatch(/capture profile sim/);
    for (const [k, v] of [['host', 'other'], ['database_oid', '1'], ['system_identifier', '2'], ['port', 5433], ['database', 'afldb_dev'], ['role', 'afldb_import']] as const)
      expect(ok(capture({ sidecar: (s) => { s.source_identity[k] = v; } })).join()).toContain(`source ${k}`);
  });
  it('refuses stale, future and out-of-order captures', () => {
    expect(ok(capture({ startedAt: '2026-11-02T00:45:00.100000Z' })).join()).toMatch(/started \d+ h ago/);
    expect(captureProblems('S1', { files: capture().files }, PROFILE, Date.parse('2026-11-03T00:00:00Z')).join()).toMatch(/timestamps/);
    expect(ok(capture({ sidecar: (s) => { s.captured_end_utc = '2026-11-04T00:40:00Z'; } })).join()).toMatch(/out of order/);
  });
  it('refuses a dump, sidecar or listing that was altered after SHA256SUMS', () => {
    const c = capture(); c.files[c.dumpName] = Buffer.from('tampered'); expect(ok(c).join()).toContain('does not match its SHA256SUMS entry');
    const d = capture(); d.files[d.sideName] = Buffer.from(JSON.stringify({ ...JSON.parse(d.files[d.sideName].toString()), purpose: 'x' })); expect(ok(d).join()).toContain(`${d.sideName} does not match`);
    const e = capture({ sidecar: (s) => { s.archive_sha256 = 'f'.repeat(64); } }); expect(ok(e).join()).toMatch(/archive name, sha256 or byte count/);
  });
  it('refuses a non-empty pg_dump stderr, a partial archive, an extra file and a missing SHA256SUMS', () => {
    expect(ok(capture({ files: (f) => { f['pg-dump.stderr'] = Buffer.from('warning'); } })).join()).toMatch(/pg-dump.stderr/);
    expect(ok(capture({ files: (f) => { f[`${Object.keys(f).find((k) => k.endsWith('.dump'))}.partial`] = Buffer.from('x'); } })).join()).toMatch(/partial/);
    expect(ok(capture({ files: (f) => { f['notes.txt'] = Buffer.from('x'); } })).join()).toMatch(/unexpected or missing files/);
    expect(ok(capture({ files: (f) => { delete f['SHA256SUMS']; } })).join()).toMatch(/SHA256SUMS/);
  });
  it('refuses a ledger of another size, another last migration, or one that changed during the capture', () => {
    expect(ok(capture({ ledgerRows: 117 })).join()).toMatch(/ledger has 117 rows, expected 118/);
    expect(ok(capture({ files: (f) => { f['ledger-after.tsv'] = Buffer.from('x\ty\n'); const n = Object.keys(f).find((k) => k.endsWith('.dump'))!; void n; } })).join()).toMatch(/ledger-before and ledger-after differ|does not match its SHA256SUMS/);
    expect(ok(capture({ sidecar: (s) => { s.ledger_unchanged_across_capture = false; } })).join()).toMatch(/unchanged ledger/);
    expect(ok(capture({ sidecar: (s) => { s.observed_ledger_digest = '0'.repeat(64); } })).join()).toMatch(/ledger digest/);
  });
  it('refuses evidence from a different profile (a simulation is not production evidence, and the reverse)', () => {
    const sim = { ...PROFILE, PROFILE_NAME: 'sim', EVIDENCE_CLASS: 'SIMULATION' };
    expect(captureProblems('S1', { files: capture().files }, sim, NOW).join()).toMatch(/evidence class GENUINE_PRODUCTION is not SIMULATION/);
  });
  it('parses SHA256SUMS strictly', () => { expect(parseSha256Sums(`${'a'.repeat(64)}  f.txt\nbad line\n`)).toMatchObject({ 'f.txt': 'a'.repeat(64) }); });
});

describe('target check', () => {
  const good = { host: 'localhost', port: 5432, database: 'afldb_prod', user: 'afldb_backup', systemIdentifier: PROFILE.EXPECT_SYSID, databaseOid: PROFILE.EXPECT_OID, clusterName: '16/main', databaseComment: null };
  it('accepts the production target and refuses any difference', () => {
    expect(targetProblems(good, PROFILE)).toEqual([]);
    expect(targetProblems({ ...good, user: 'afldb_import' }, PROFILE).join()).toContain('user');
    expect(targetProblems({ ...good, databaseOid: '1' }, PROFILE).join()).toContain('databaseOid');
    expect(targetProblems({ ...good, extra: 1 } as any, PROFILE).join()).toContain('unexpected field');
    expect(targetProblems(good, PROFILE, { source_identity: { system_identifier: '9', database_oid: '66668' } }).join()).toContain('differs from the capture sidecar');
  });
});

/* ---------- plans, approvals ---------- */
const DIGEST = 'a1'.repeat(32);
const REV = 'b2'.repeat(20);
const target = { host: 'localhost', port: 5432, database: 'afldb_prod', user: 'afldb_backup', systemIdentifier: '7674454702926115004', databaseOid: '66668', clusterName: '16/main', databaseComment: null };
function plan(stage: StageId, over: Record<string, unknown> = {}): Record<string, any> {
  const base: Record<string, any> = { operation: STAGES[stage].operation, revision: REV, target, rehearsal: false, digest: DIGEST, expiresAt: '2026-11-05T00:30:00.000Z',
    backup: { sha256: 'd'.repeat(64), restoreEvidenceSha256: 'e'.repeat(64), capturedAt: '2026-11-04T00:45:00.100Z', restoredAt: '2026-11-04T00:50:00.000Z' } };
  if (stage === 'S1') { base.evidenceSha256 = 'f'.repeat(64); base.entries = Array.from({ length: 7 }, (_v, i) => ({ sourceKey: `k${i}`, season: 2008, club: 'Melbourne', player: `P${i}`, role: 'Captain', action: 'to insert' })); }
  if (stage === 'S2') Object.assign(base, { childSha256: 'c'.repeat(64), label: 'annual-html-20260826', parentSha256: '1f7413a2ad96e7d026cc521acfdeba3de9cab7066794de99002c9b5928e6e21b', expect: { after_state_sha256: '1'.repeat(64) } });
  if (stage === 'S3') Object.assign(base, { evidenceSha256: 'f'.repeat(64), actorUserId: 1, entries: Array.from({ length: 8 }, (_v, i) => ({ season: 2025, pickNumber: i + 1, action: 'to insert' })) });
  if (stage === 'S4') Object.assign(base, { artefactSha256: 'b1b7fe41'.padEnd(64, '0'), expectAfterContentDigest: 'd6fceb338d5f37e8fdef18443da696c52225db9caa80cedb9261e401aea212ec' });
  return { ...base, ...over };
}
const STATEMENT = (stage: StageId, p = plan(stage)) => approvalStatement(stage, p, { dumpSha256: 'd'.repeat(64), restoreEvidenceSha256: 'e'.repeat(64), evidenceClass: GENUINE, window: 'from now until later' });
const NOW2 = Date.parse('2026-11-04T01:10:00.000Z');
const EXPIRES = '2026-11-04T05:00:00.000Z';

describe.each(STAGE_IDS)('%s plan and approval', (stage) => {
  const ctx = { revision: REV, target, dumpSha256: 'd'.repeat(64), restoreEvidenceSha256: 'e'.repeat(64), now: NOW2 };
  it('accepts a correct production plan and describes the changes', () => {
    expect(planProblems(stage, plan(stage), ctx)).toEqual([]);
    expect(STAGES[stage].changes(plan(stage)).length).toBeGreaterThan(0);
  });
  it('refuses a rehearsal plan, another revision, another target, another dump, an expired plan, another operation', () => {
    expect(planProblems(stage, plan(stage, { rehearsal: true }), ctx).join()).toMatch(/rehearsal/);
    expect(planProblems(stage, plan(stage, { revision: 'c3'.repeat(20) }), ctx).join()).toMatch(/revision/);
    expect(planProblems(stage, plan(stage, { target: { ...target, databaseOid: '1' } }), ctx).join()).toMatch(/target/);
    expect(planProblems(stage, plan(stage, { backup: { ...plan(stage).backup, sha256: '0'.repeat(64) } }), ctx).join()).toMatch(/dump/);
    expect(planProblems(stage, plan(stage, { expiresAt: '2026-11-04T00:00:00Z' }), ctx).join()).toMatch(/expired/);
    expect(planProblems(stage, plan(stage, { operation: 'other' }), ctx).join()).toMatch(/operation/);
  });
  const make = (digest = DIGEST, statement = STATEMENT(stage), expiresAt = EXPIRES) => buildApproval(stage, plan(stage), { digest, statement, expiresAt, now: NOW2 });
  it('writes an approval only from the typed digest of THIS plan, with a statement that names it', () => {
    const ok = make(); expect(ok.problems).toEqual([]);
    expect(ok.approval).toMatchObject({ stage, planDigest: DIGEST, revision: REV, operation: STAGES[stage].operation });
    expect(approvalProblems(stage, plan(stage), ok.approval, NOW2)).toEqual([]);
  });
  it('refuses another stage\'s digest, a short or silent statement, a past expiry, and an approval that outlives the plan or the backup', () => {
    expect(make('9'.repeat(64)).problems.join()).toMatch(/not this .* plan's digest/);
    expect(make(DIGEST, 'short').problems.join()).toMatch(/too short/);
    expect(make(DIGEST, 'x'.repeat(80)).problems.join()).toMatch(/does not contain the full plan digest/);
    expect(make(DIGEST, STATEMENT(stage).replace(STAGES[stage].decision, 'D9-PROD')).problems.join()).toMatch(/does not name D/);
    expect(make(DIGEST, STATEMENT(stage), '2026-11-04T00:00:00Z').problems.join()).toMatch(/already past/);
    expect(make(DIGEST, STATEMENT(stage), '2026-11-06T00:00:00Z').problems.join()).toMatch(/outlive the plan/);
    expect(make(DIGEST, STATEMENT(stage), '2026-11-05T00:30:00Z').problems.join()).toMatch(/backup freshness/);
  });
  it('the apply-time check refuses a missing, wrong-digest, wrong-stage, edited, future, expired or stale-backup approval', () => {
    const ap = make().approval!;
    expect(approvalProblems(stage, plan(stage), null, NOW2).join()).toMatch(/no owner approval/);
    expect(approvalProblems(stage, plan(stage), { ...ap, planDigest: '9'.repeat(64) }, NOW2).join()).toMatch(/actual plan digest/);
    expect(approvalProblems(stage, plan(stage), { ...ap, stage: stage === 'S1' ? 'S2' : 'S1' }, NOW2).join()).toMatch(/another stage/);
    expect(approvalProblems(stage, plan(stage), { ...ap, revision: 'c3'.repeat(20) }, NOW2).join()).toMatch(/revision, operation or target/);
    expect(approvalProblems(stage, plan(stage), { ...ap, reference: 'a long reference that does not carry the digest at all, sadly' }, NOW2).join()).toMatch(/does not contain the plan digest/);
    expect(approvalProblems(stage, plan(stage), { ...ap, notBefore: '2026-11-04T03:00:00Z' }, NOW2).join()).toMatch(/not opened/);
    expect(approvalProblems(stage, plan(stage), ap, Date.parse(EXPIRES) + 1).join()).toMatch(/expired/);
    expect(approvalProblems(stage, plan(stage), { ...ap, approvedAt: '2026-11-04T09:00:00Z' }, NOW2).join()).toMatch(/future/);
    const late = Date.parse('2026-11-04T00:45:00.100Z') + 24 * 3600000 - APPLY_MIN_BACKUP_LEFT_MS + 60000;
    expect(approvalProblems(stage, plan(stage), { ...ap, expiresAt: '2026-11-05T00:20:00Z' }, late).join()).toMatch(/backup freshness remain/);
    for (const [k, v] of Object.entries(STAGES[stage].approvalExtras(plan(stage)))) expect(ap[k]).toEqual(v);
  });
});

describe('stage-specific plan expectations', () => {
  const ctx = { revision: REV, target, dumpSha256: 'd'.repeat(64), restoreEvidenceSha256: 'e'.repeat(64), now: NOW2 };
  it('S1 needs exactly seven rows to insert; S3 exactly eight under actor 1; S2 the pinned label and parent; S4 the pinned digest', () => {
    expect(planProblems('S1', plan('S1', { entries: plan('S1').entries.slice(0, 6) }), ctx).join()).toMatch(/6 entries, not 7/);
    expect(planProblems('S1', plan('S1', { entries: plan('S1').entries.map((e: any) => ({ ...e, action: 'already present' })) }), ctx).join()).toMatch(/0 rows to insert/);
    expect(planProblems('S3', plan('S3', { actorUserId: 2 }), ctx).join()).toMatch(/actor is 2/);
    expect(planProblems('S3', plan('S3', { entries: [] }), ctx).join()).toMatch(/0 selections, not 8/);
    expect(planProblems('S2', plan('S2', { label: 'other' }), ctx).join()).toMatch(/label is other/);
    expect(planProblems('S2', plan('S2', { parentSha256: '0'.repeat(64) }), ctx).join()).toMatch(/parent/);
    expect(planProblems('S4', plan('S4', { expectAfterContentDigest: '0'.repeat(64) }), ctx).join()).toMatch(/after-content digest/);
  });
  it('statements name the stage decision, the digest, the revision and the recovery limit where it applies', () => {
    expect(STATEMENT('S1')).toMatch(/D1-PROD.*plan a1a1/); expect(STATEMENT('S2')).toMatch(/OUTCOME_UNDETERMINED.*owner-decided restore/); expect(STATEMENT('S3')).toMatch(/actor auth_users\.id 1/);
    expect(STATEMENT('S4')).toMatch(/afldb-sibling-supplement:015/); for (const s of STAGE_IDS) expect(STATEMENT(s)).toMatch(/No retry and no automatic restore/);
  });
});

describe('outcome classification', () => {
  const log = (o: string, code: number) => `noise\nOUTCOME ${o} (exit ${code})\nstatement`;
  const state = (s: string) => `STATE ${s}`;
  const run = (toolExit: number | null, toolLog: string, st: string | null) => classifyOutcome({ stage: 'S1', toolExit, toolLog, stateLog: st });
  it('maps each reviewed outcome with a consistent state probe', () => {
    expect(run(0, log('COMMITTED_VERIFIED', 0), state('PLANNED RESULT PRESENT (every row)')).classification).toBe('COMMITTED_VERIFIED');
    expect(run(0, log('NOTHING_WRITTEN', 0), state('PLANNED RESULT PRESENT')).classification).toBe('NOTHING_WRITTEN');
    expect(run(1, log('REFUSED_BEFORE_MUTATION', 1), state('BASELINE (the plan has not been applied)')).classification).toBe('REFUSED_BEFORE_MUTATION');
    expect(run(2, log('ROLLED_BACK', 2), state('BASELINE')).classification).toBe('ROLLED_BACK');
    expect(run(3, log('COMMITTED_VERIFICATION_FAILED', 3), state('PLANNED RESULT PRESENT')).classification).toBe('COMMITTED_VERIFICATION_FAILED');
    expect(run(4, log('COMMITTED_VERIFICATION_UNAVAILABLE', 4), state('OTHER')).classification).toBe('COMMITTED_VERIFICATION_UNAVAILABLE');
    expect(run(5, log('OUTCOME_UNDETERMINED', 5), state('OTHER')).classification).toBe('OUTCOME_UNDETERMINED');
    for (const [o, c] of Object.entries(EXIT_CODE)) expect(run(c, log(o, c), state(c === 0 ? 'PLANNED RESULT PRESENT' : c <= 2 ? 'BASELINE' : 'OTHER')).exitCode).toBe(c);
  });
  it('treats every contradiction as undetermined and never as "rolled back"', () => {
    const cases: [number | null, string, string | null][] = [
      [2, log('ROLLED_BACK', 2), state('PLANNED RESULT PRESENT')],      // tool says rolled back, the planned result is present
      [1, log('REFUSED_BEFORE_MUTATION', 1), state('OTHER')],
      [0, log('COMMITTED_VERIFIED', 0), state('BASELINE')],              // tool says committed, nothing is there
      [0, log('COMMITTED_VERIFIED', 0), null],                            // probe could not run: the tool alone is not confirmed...
    ];
    for (const [code, l, st] of cases.slice(0, 3)) { const r = run(code, l, st); expect(r.classification).toBe('OUTCOME_UNDETERMINED'); expect(r.lines.join('\n')).not.toMatch(/ROLLED BACK: the transaction did not commit/); }
    expect(run(0, log('COMMITTED_VERIFIED', 0), null).classification).toBe('OUTCOME_UNDETERMINED');
    expect(run(null, '', null).classification).toBe('OUTCOME_UNDETERMINED');            // killed / lost
    expect(run(7, 'no outcome line at all', state('BASELINE')).classification).toBe('OUTCOME_UNDETERMINED');
    expect(run(3, log('ROLLED_BACK', 2), state('OTHER')).classification).toBe('OUTCOME_UNDETERMINED');   // exit code and line disagree
    expect(run(1, log('MADE_UP', 1), state('BASELINE')).classification).toBe('OUTCOME_UNDETERMINED');
  });
  it('committed outcomes say so, never offer a retry or an automatic restore, and an unavailable probe on a failure is only a note', () => {
    for (const [o, c] of [['COMMITTED_VERIFICATION_FAILED', 3], ['COMMITTED_VERIFICATION_UNAVAILABLE', 4]] as const) {
      const r = run(c, log(o, c), state('OTHER')); expect(r.committed).toBe(true);
      const text = r.lines.join('\n'); expect(text).toMatch(/IS COMMITTED/); expect(text).toMatch(/never retries an apply/); expect(text).toMatch(/Owner decision|owner decision/i);
    }
    expect(run(3, log('COMMITTED_VERIFICATION_FAILED', 3), null).classification).toBe('COMMITTED_VERIFICATION_FAILED');
    expect(run(5, log('OUTCOME_UNDETERMINED', 5), state('OTHER')).committed).toBe('unknown');
  });
});

describe('manifest binding', () => {
  const files = { dump: 'd'.repeat(64), provenance: 'p'.repeat(64), 'target.json': 't'.repeat(64), 'backup.json': 'b'.repeat(64), 'restore-evidence.json': 'e'.repeat(64), 'plan.json': 'q'.repeat(64) };
  const m = (over: Partial<Manifest> = {}): Manifest => ({ format: 'afldb.gap029.stage-run.1', stage: 'S1', operation: STAGES.S1.operation, revision: REV, evidenceClass: GENUINE, profileName: 'production', profileSha256: 'x'.repeat(64),
    target, planDigest: DIGEST, planExpiresAt: '', backupCapturedAt: '', createdAt: '', captureDir: '/c', dumpName: 'd.dump', provenanceName: 'p.json', files, opsToolSha256: {}, ...over });
  const ctx = (sha: (p: string) => string | null) => ({ stage: 'S1' as StageId, revision: REV, profileSha256: 'x'.repeat(64), evidenceClass: GENUINE, sha });
  it('passes when every bound file is byte-identical', () => { expect(manifestProblems(m(), ctx((p) => (files as any)[p] ?? null))).toEqual([]); });
  it('refuses a changed, missing or unbound file, another revision, profile or class', () => {
    expect(manifestProblems(m(), ctx((p) => (p === 'backup.json' ? 'z'.repeat(64) : (files as any)[p]))).join()).toMatch(/backup.json differs/);
    expect(manifestProblems(m(), ctx((p) => (p === 'plan.json' ? null : (files as any)[p]))).join()).toMatch(/plan.json is missing/);
    const { dump: _d, ...noDump } = files; expect(manifestProblems(m({ files: noDump as any }), ctx((p) => (files as any)[p])).join()).toMatch(/does not bind dump/);
    expect(manifestProblems(m({ revision: 'c3'.repeat(20) }), ctx((p) => (files as any)[p])).join()).toMatch(/revision/);
    expect(manifestProblems(m({ profileSha256: 'y'.repeat(64) }), ctx((p) => (files as any)[p])).join()).toMatch(/profile differs/);
    expect(manifestProblems(m({ evidenceClass: 'SIMULATION' }), ctx((p) => (files as any)[p])).join()).toMatch(/evidence class/);
    expect(manifestProblems(null, ctx(() => null)).join()).toMatch(/missing or not/);
  });
  it('S2 must also bind its child', () => { expect(manifestProblems(m({ stage: 'S2', operation: STAGES.S2.operation }), { ...ctx((p) => (files as any)[p]), stage: 'S2' }).join()).toMatch(/child.json/); });
});

describe('assembled evidence basic check', () => {
  const body = JSON.stringify({ x: 1 });
  const ev = (over: any = {}) => ({ sha256: 'd'.repeat(64), restoreEvidenceSha256: 'e'.repeat(64), target, assembly: { format: 'afldb.gap029.restore-evidence-assembly.1', stage: 'S2', operation: STAGES.S2.operation, revision: REV, sealedBody: body, sealedBodySha256: h(body),
    inputs: { dumpSha256: 'd'.repeat(64), restoreEvidenceSha256: 'e'.repeat(64), childSha256: 'c'.repeat(64) } }, ...over });
  const ctx = { stage: 'S2' as StageId, revision: REV, dumpSha256: 'd'.repeat(64), restoreEvidenceSha256: 'e'.repeat(64), productionTarget: target, childSha256: 'c'.repeat(64) };
  it('accepts matching evidence and refuses mismatches', () => {
    expect(backupEvidenceBasicProblems(ev(), ctx)).toEqual([]);
    expect(backupEvidenceBasicProblems(ev({ sha256: '0'.repeat(64) }), ctx).join()).toMatch(/different dump/);
    expect(backupEvidenceBasicProblems(ev(), { ...ctx, revision: 'c3'.repeat(20) }).join()).toMatch(/revision/);
    expect(backupEvidenceBasicProblems(ev(), { ...ctx, stage: 'S1' }).join()).toMatch(/another stage/);
    expect(backupEvidenceBasicProblems(ev(), { ...ctx, childSha256: '0'.repeat(64) }).join()).toMatch(/child sha256/);
    expect(backupEvidenceBasicProblems(ev(), { ...ctx, productionTarget: { ...target, databaseOid: '1' } }).join()).toMatch(/target/);
    expect(backupEvidenceBasicProblems(ev({ assembly: { ...ev().assembly, sealedBodySha256: '0'.repeat(64) } }), ctx).join()).toMatch(/seal digest/);
    expect(backupEvidenceBasicProblems({}, ctx).join()).toMatch(/no assembly seal/);
  });
});

describe('wrapper script structure (static guarantees)', () => {
  const prodStage = read('tools/v2/gap029-ops/prod-stage.sh');
  const captureSh = read('tools/v2/gap029-ops/capture-prod-stage.sh');
  const restoreSh = read('tools/v2/gap029-ops/restore-assemble-host.sh');
  it('the production wrapper never restores, drops, retries or runs a mutating statement of its own', () => {
    expect(prodStage).not.toMatch(/pg_restore -|pg_restore --|DROP |DELETE |INSERT |UPDATE |TRUNCATE|ALTER |GRANT |rm -r|--no-verify/);
    expect(prodStage).not.toMatch(/\bretry\b.*while|until .*apply/);
    expect(prodStage).toMatch(/never retries/);
  });
  it('the apply lock is taken exclusively BEFORE the detached run starts, and a second apply is refused', () => {
    const lock = prodStage.indexOf('set -o noclobber; echo "started'); const launch = prodStage.indexOf('setsid nohup bash "$HERE/prod-stage.sh" __apply');
    expect(lock).toBeGreaterThan(0); expect(launch).toBeGreaterThan(lock);
    expect(prodStage).toMatch(/\[ ! -e "\$RUNDIR\/apply.lock" \] \|\| stop "an apply was already started/);
  });
  it('the apply gates run before the lock: approval present, manifest, capture, approval check, conflicts', () => {
    const order = ['no owner approval', 'manifest verification failed', 'capture check failed', 'approval check failed', 'no_conflicts\n  echo "app:', 'set -o noclobber'].map((s) => prodStage.indexOf(s, prodStage.indexOf('\napply)')));
    expect(order.every((i) => i > 0)).toBe(true); expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it('capture and every later stage are ordered behind acceptance of the previous stage', () => {
    expect(prodStage).toMatch(/prev_stage\(\) \{ case "\$1" in S2\) echo S1;; S3\) echo S2;; S4\) echo S3;;/);
    expect(prodStage).toMatch(/has not been accepted/);
  });
  it('credentials are only parsed into the environment: no connection string is echoed, passed in argv or written', () => {
    for (const src of [prodStage, captureSh]) { expect(src).not.toMatch(/echo[^\n]*\$DSN/); expect(src).not.toMatch(/--dbname|postgres(ql)?:\/\/\$/); expect(src).not.toMatch(/set -x/); }
  });
  it('the capture script is read-only: no migration, service, timer, pruning, restore or privilege action', () => {
    expect(captureSh).not.toMatch(/systemctl (start|stop|restart|enable|disable|reload|mask|daemon)|DROP |INSERT |UPDATE |DELETE |GRANT |ALTER |pg_restore --|rm -/);
    expect(captureSh).toContain('default_transaction_read_only=on'); expect(captureSh).toContain('--format=custom');
    expect(captureSh).toContain('evidence_class'); expect(captureSh).toContain('capture_profile');
  });
  it('the restore host script verifies the capture directory before restoring and only restores into the guarded disposable database', () => {
    expect(restoreSh.indexOf('check-capture')).toBeGreaterThan(0); expect(restoreSh.indexOf('check-capture')).toBeLessThan(restoreSh.indexOf('restore.mjs'));
    expect(restoreSh).toContain('create-db "$RDB"'); expect(restoreSh).toContain('_rst_test'); expect(restoreSh).not.toMatch(/pg_restore[^\n]*afldb_prod|--clean/);
  });
  it('the host CLI never prints a connection string and launches tools with file-path arguments only', () => {
    const cli = read('tools/v2/gap029-ops.ts');
    expect(cli).not.toMatch(/console\.log\([^)]*(DSN|PASSWORD)/); expect(cli).toMatch(/arguments are file paths only/);
  });
});
