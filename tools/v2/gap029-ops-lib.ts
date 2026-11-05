/** V2-GAP-029 production-wrapper LIBRARY: every rule the owner-facing wrapper enforces that is not a shell one-liner, in one pure, unit-tested place.
 *
 *   - STAGES: the table that binds S1..S4 to their tool, runner, plan/apply/state argument shapes, approval fields and expected change text.
 *   - PROFILE: the environment-specific constants (host, identity, ledger, paths). The production profile is a tracked file; a test profile names a
 *     simulated production in an isolated cluster. A profile can only make the wrapper expect something DIFFERENT from production; it can never relax a
 *     check, because every identity is still compared with the live database. The evidence class travels with every artefact so a simulation can never be
 *     mistaken for genuine production evidence (and the production profile refuses anything that is not GENUINE_PRODUCTION).
 *   - CAPTURE CHECK: validates a capture directory (SHA256SUMS, sidecar, dump, ledger listings) against the profile, independently of the capture script.
 *   - APPROVAL: composes the approval file ONLY from the owner's typed plan digest, the owner's statement and an expiry, and refuses unless the typed digest
 *     equals the stage's actual plan digest and the statement names it.
 *   - OUTCOME: maps a tool exit code and a read-only state probe to the six reviewed outcome classes. Never "rolled back" after a commit; never an automatic
 *     retry or restore; any contradiction becomes OUTCOME_UNDETERMINED.
 *   - MANIFEST: binds a prepared run (revision, stage, target, dump, restore evidence, child, plan, profile) by sha256; apply re-verifies every file.
 */
import { createHash } from 'node:crypto';

import { EXIT_CODE, MAX_AGE_MS, OUTCOMES, STATEMENT, canonJson, sameJson, type Outcome } from './gap029-common';

export const sha256Hex = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;

/* ------------------------------------------------------------------------------------------------------------------------------------- */
/* Stage table                                                                                                                           */
/* ------------------------------------------------------------------------------------------------------------------------------------- */

/** S1-S4 are V2-GAP-029; I336 is AFLDB-ISSUE-336 (D-336-2), which reuses this capture, plan, approval and outcome machinery unchanged. */
export const STAGE_IDS = ['S1', 'S2', 'S3', 'S4', 'I336'] as const;
export type StageId = (typeof STAGE_IDS)[number];
export const isStage = (s: unknown): s is StageId => typeof s === 'string' && (STAGE_IDS as readonly string[]).includes(s);

export interface StageSpec {
  id: StageId; title: string; decision: string; operation: string; tool: string; runner: 'tsx' | 'python'; conditions: boolean;
  /** Reviewed pinned inputs the plan command needs beyond the backup evidence. */
  needsChild: boolean; needsActor: boolean; expectAfterContentDigest?: string; label?: string;
  /** S3 has a read-only verify mode that needs the apply record. */
  hasVerify: boolean;
  /** Fields of the approval that must come from the plan, beyond the common ones. */
  approvalExtras: (plan: Record<string, any>) => Record<string, unknown>;
  /** What the owner should expect the plan to change (checked against the plan body, not typed). */
  planProblems: (plan: Record<string, any>) => string[];
  changes: (plan: Record<string, any>) => string[];
}

export const S2_LABEL = 'annual-html-20260826';
export const S4_AFTER_CONTENT_DIGEST = 'd6fceb338d5f37e8fdef18443da696c52225db9caa80cedb9261e401aea212ec';
export const S3_ACTOR_USER_ID = 1;
/** The reviewed ISSUE-336 evidence (docs/v2/evidence/issue336-draft-categories-20261105/predraft-insert-plan.json), as pinned in the tool; I336 uses S3's pinned actor. */
export const I336_EVIDENCE_SHA256 = '6a207cfe3b1408d6ff747040cecfac1cde9ebd9a43f584711c573eb20ff511cb';

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

export const STAGES: Readonly<Record<StageId, StageSpec>> = {
  S1: {
    id: 'S1', title: 'seven co-captain rows (captaincies)', decision: 'D1-PROD', operation: 'gap029-captaincy-additions', tool: 'tools/v2/gap029-captaincy-additions-production.ts',
    runner: 'tsx', conditions: true, needsChild: false, needsActor: false, hasVerify: false,
    approvalExtras: (p) => ({ evidenceSha256: p.evidenceSha256 }),
    planProblems: (p) => {
      const e = arr(p.entries); const ins = e.filter((x) => x.action === 'to insert').length;
      const out: string[] = [];
      if (e.length !== 7) out.push(`S1 plan names ${e.length} entries, not 7`);
      if (ins !== 7) out.push(`S1 plan has ${ins} rows to insert, not 7 (an already-applied or drifted state needs review)`);
      return out;
    },
    changes: (p) => [`INSERT 1 import_batches row and ${arr(p.entries).filter((x) => x.action === 'to insert').length} captaincies rows (source wikipedia), nothing updated or deleted`,
      ...arr(p.entries).map((x) => `  ${x.season} ${x.club}: ${x.player} (${x.role}) [${x.sourceKey}] -> ${x.action}`)],
  },
  S2: {
    id: 'S2', title: 'DraftGuru link-only promotion (draft_picks links)', decision: 'D2-PROD', operation: 'gap029-draft-link-production', tool: 'tools/v2/gap029-draft-link-production.py',
    runner: 'python', conditions: false, needsChild: true, needsActor: false, hasVerify: false, label: S2_LABEL,
    approvalExtras: (p) => ({ childSha256: p.childSha256, label: p.label }),
    planProblems: (p) => {
      const out: string[] = [];
      if (p.label !== S2_LABEL) out.push(`S2 plan label is ${String(p.label)}, not ${S2_LABEL}`);
      if (p.parentSha256 !== '1f7413a2ad96e7d026cc521acfdeba3de9cab7066794de99002c9b5928e6e21b') out.push('S2 plan parent sha256 differs from the pinned v3 parent');
      if (!HEX64.test(String(p.childSha256 ?? ''))) out.push('S2 plan child sha256 is missing');
      return out;
    },
    changes: (p) => [`link-only promotion: the draft_picks link columns only, through the unmodified importer in its own transaction; child ${String(p.childSha256).slice(0, 16)}...; label ${String(p.label)}`,
      `expected after-state ${String(p.expect?.after_state_sha256 ?? '?').slice(0, 16)}...; counts ${JSON.stringify(p.counts ?? {})}; write set ${JSON.stringify(p.writeSet ?? [])}`],
  },
  S3: {
    id: 'S3', title: 'eight manual rookie selections (draft_picks via the audited editor)', decision: 'D3-PROD', operation: 'gap029-rookie-selections', tool: 'tools/v2/gap029-rookie-selections-production.ts',
    runner: 'tsx', conditions: true, needsChild: false, needsActor: true, hasVerify: true,
    approvalExtras: (p) => ({ evidenceSha256: p.evidenceSha256, actorUserId: p.actorUserId }),
    planProblems: (p) => {
      const e = arr(p.entries); const out: string[] = [];
      if (p.actorUserId !== S3_ACTOR_USER_ID) out.push(`S3 plan actor is ${String(p.actorUserId)}, not the pinned ${S3_ACTOR_USER_ID}`);
      if (e.length !== 8) out.push(`S3 plan names ${e.length} selections, not 8`);
      return out;
    },
    changes: (p) => [`${arr(p.entries).length} manual rookie selections as actor auth_users.id ${String(p.actorUserId)}, each with its data_overrides and data_edits audit row`,
      ...arr(p.entries).map((x) => `  ${JSON.stringify({ season: x.season, pick: x.pickNumber ?? x.pick, club: x.club, player: x.player ?? x.playerName, action: x.action })}`)],
  },
  S4: {
    id: 'S4', title: 'one sibling pair (McGovern)', decision: 'D4-PROD', operation: 'gap029-sibling-pair', tool: 'tools/v2/gap029-sibling-pair-production.py',
    runner: 'python', conditions: false, needsChild: false, needsActor: false, hasVerify: false, expectAfterContentDigest: S4_AFTER_CONTENT_DIGEST,
    approvalExtras: (p) => ({ artefactSha256: p.artefactSha256 }),
    planProblems: (p) => {
      const out: string[] = [];
      if (p.expectAfterContentDigest !== S4_AFTER_CONTENT_DIGEST) out.push('S4 plan after-content digest differs from the pinned value');
      if (!HEX64.test(String(p.artefactSha256 ?? ''))) out.push('S4 plan artefact sha256 is missing');
      return out;
    },
    changes: (p) => [`add exactly the sibling key afldb-sibling-supplement:015 (Jeremy McGovern 6937 / Mitch McGovern 9714) through family_siblings.py load; artefact ${String(p.artefactSha256).slice(0, 16)}...`,
      `expected content digest ${String(p.expectAfterContentDigest ?? '?').slice(0, 16)}...`],
  },
  I336: {
    id: 'I336', title: '35 DraftGuru Pre-Draft rows (draft_picks, audited under the season seal)', decision: 'D-336-2', operation: 'issue336-predraft-insert',
    tool: 'tools/v2/issue336-predraft-insert-production.ts', runner: 'tsx', conditions: true, needsChild: false, needsActor: true, hasVerify: true,
    approvalExtras: (p) => ({ evidenceSha256: p.evidenceSha256, actorUserId: p.actorUserId }),
    planProblems: (p) => {
      const e = arr(p.entries); const ins = e.filter((x) => x.action === 'to insert').length; const out: string[] = [];
      if (p.actorUserId !== S3_ACTOR_USER_ID) out.push(`I336 plan actor is ${String(p.actorUserId)}, not the pinned ${S3_ACTOR_USER_ID}`);
      if (p.evidenceSha256 !== I336_EVIDENCE_SHA256) out.push('I336 plan evidence differs from the pinned reviewed evidence');
      if (e.length !== 35) out.push(`I336 plan names ${e.length} rows, not 35`);
      if (ins !== 35) out.push(`I336 plan has ${ins} rows to insert, not 35 (an already-applied or drifted state needs review)`);
      return out;
    },
    changes: (p) => {
      const e = arr(p.entries);
      return [`INSERT ${e.filter((x) => x.action === 'to insert').length} draft_picks rows (source draftguru, Pre-Draft, unnumbered), ${e.filter((x) => x.action === 'to insert' && x.personId === null).length} new unmatched draft_persons rows, `
        + `and one data_edits audit row per pick as actor auth_users.id ${String(p.actorUserId)}; nothing updated or deleted; no override written`,
      ...e.map((x) => `  ${String(x.sourceRecordId)} -> ${x.action}${x.personId === null ? ' (new person)' : ` (person ${String(x.personId)}, ${String(x.linkStatus)})`}`)];
    },
  },
};

/* ------------------------------------------------------------------------------------------------------------------------------------- */
/* Profile                                                                                                                               */
/* ------------------------------------------------------------------------------------------------------------------------------------- */

export const PROFILE_KEYS = ['PROFILE_NAME', 'EVIDENCE_CLASS', 'EXPECT_HOST', 'EXPECT_USER', 'PROD_CHECKOUT', 'OPS_ROOT', 'BACKUP_ROOT', 'PGBIN', 'NODE', 'PYTHON',
  'EXPECT_SYSID', 'EXPECT_OID', 'EXPECT_CLUSTER', 'EXPECT_DB', 'EXPECT_DB_HOST', 'EXPECT_DB_PORT', 'EXPECT_LEDGER_ROWS', 'EXPECT_LEDGER_LAST', 'EXPECT_EXT', 'EXPECT_DB_OWNER',
  'WRITER_UNITS', 'ALL_UNITS', 'TIMER_UNIT', 'SSH_HOST'] as const;
export type Profile = Record<(typeof PROFILE_KEYS)[number], string>;
export const GENUINE = 'GENUINE_PRODUCTION';
/** The pinned production identity (read-only probes of 2026-11-03; the Block L record). Only the GENUINE_PRODUCTION profile may carry it. */
export const PRODUCTION_IDENTITY = { host: 'afldb-prod', sysid: '7674454702926115004', oid: '66668', db: 'afldb_prod' } as const;

/** `KEY="value"` lines (the same file is sourced by bash). Anything else that is not blank or a comment is refused, so a profile cannot carry code. */
export function parseProfile(text: string): { profile: Profile; problems: string[] } {
  const problems: string[] = []; const raw: Record<string, string> = {};
  for (const [i, line] of text.replace(/\r\n/g, '\n').split('\n').entries()) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = /^([A-Z_]+)="([^"$`\\]*)"$/.exec(line);
    if (!m) { problems.push(`profile line ${i + 1} is not KEY="plain value"`); continue; }
    if (m[1] in raw) problems.push(`profile key ${m[1]} is repeated`);
    raw[m[1]] = m[2];
  }
  for (const k of PROFILE_KEYS) if (!(k in raw)) problems.push(`profile key ${k} is missing`);
  for (const k of Object.keys(raw)) if (!(PROFILE_KEYS as readonly string[]).includes(k)) problems.push(`profile key ${k} is not recognised`);
  // The evidence class is not a free label: it is bound to the pinned production identity in BOTH directions, so a hand-made profile cannot mint
  // GENUINE_PRODUCTION evidence for another database, nor label the real production database as a simulation.
  const claimsProd = raw.EVIDENCE_CLASS === GENUINE;
  const isProd = raw.EXPECT_SYSID === PRODUCTION_IDENTITY.sysid || raw.EXPECT_HOST === PRODUCTION_IDENTITY.host || raw.EXPECT_OID === PRODUCTION_IDENTITY.oid && raw.EXPECT_DB === PRODUCTION_IDENTITY.db;
  if (claimsProd && !(raw.PROFILE_NAME === 'production' && raw.EXPECT_HOST === PRODUCTION_IDENTITY.host && raw.EXPECT_SYSID === PRODUCTION_IDENTITY.sysid
    && raw.EXPECT_OID === PRODUCTION_IDENTITY.oid && raw.EXPECT_DB === PRODUCTION_IDENTITY.db)) problems.push('a GENUINE_PRODUCTION profile must carry exactly the pinned production host, system identifier, database and OID');
  if (!claimsProd && isProd) problems.push('a profile naming the production host or system identifier must be the GENUINE_PRODUCTION profile');
  return { profile: raw as Profile, problems };
}

/* ------------------------------------------------------------------------------------------------------------------------------------- */
/* Capture directory check                                                                                                               */
/* ------------------------------------------------------------------------------------------------------------------------------------- */

export const CAPTURE_FILES = ['archive.toc', 'ledger-before.tsv', 'ledger-after.tsv', 'pg-dump.stderr'] as const;

export function parseSha256Sums(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (!line.trim()) continue;
    const m = /^([0-9a-f]{64}) [ *]([^/\\]+)$/.exec(line);
    out[m ? m[2] : `?${line}`] = m ? m[1] : '';
  }
  return out;
}

export interface CaptureFiles { /** name -> bytes, for every regular file found in the capture directory */ files: Record<string, Buffer>; }

/** Every reason a capture directory cannot back a stage preparation, or []. Pure. */
export function captureProblems(stage: StageId, cap: CaptureFiles, profile: Profile, now: number, maxAgeMs: number = MAX_AGE_MS): string[] {
  const p: string[] = [];
  const names = Object.keys(cap.files).sort();
  const dumps = names.filter((n) => /^afldb_prod-\d{8}T\d{6}Z\.dump$/.test(n));
  const sidecars = names.filter((n) => /^afldb_prod-\d{8}T\d{6}Z\.provenance\.json$/.test(n));
  if (names.some((n) => n.endsWith('.partial'))) p.push('a .partial archive is present: the capture did not complete');
  if (dumps.length !== 1 || sidecars.length !== 1) { p.push(`expected exactly one dump and one provenance sidecar, found ${dumps.length} and ${sidecars.length}`); return p; }
  const dump = dumps[0]; const sidecarName = sidecars[0];
  const expectedNames = [dump, sidecarName, ...CAPTURE_FILES, 'SHA256SUMS'].sort();
  if (!sameJson(names, expectedNames)) p.push(`the capture directory holds unexpected or missing files: ${JSON.stringify(names)}`);
  if (!cap.files['SHA256SUMS']) return [...p, 'SHA256SUMS is missing'];
  const sums = parseSha256Sums(cap.files['SHA256SUMS'].toString('utf8'));
  const listed = [dump, sidecarName, ...CAPTURE_FILES].sort();
  if (!sameJson(Object.keys(sums).sort(), listed)) p.push(`SHA256SUMS lists ${JSON.stringify(Object.keys(sums).sort())}, expected ${JSON.stringify(listed)}`);
  for (const n of listed) if (cap.files[n] && sums[n] !== sha256Hex(cap.files[n])) p.push(`${n} does not match its SHA256SUMS entry`);
  if (cap.files['pg-dump.stderr']?.length) p.push('pg-dump.stderr is not empty');
  if (!cap.files[sidecarName]) return [...p, 'sidecar missing'];
  let s: any;
  try { s = JSON.parse(cap.files[sidecarName].toString('utf8')); } catch { return [...p, 'the provenance sidecar is not JSON']; }
  const stamp = /^afldb_prod-(\d{8}T\d{6}Z)\./.exec(dump)![1];
  if (s.format !== 'afldb.v2.capture-provenance.2') p.push('sidecar format is not afldb.v2.capture-provenance.2');
  if (!new RegExp(`^GAP029-${stage}-BACKUP-\\d{8}$`).test(String(s.decision))) p.push(`sidecar decision ${String(s.decision)} is not a ${stage} capture`);
  if (s.evidence_class !== profile.EVIDENCE_CLASS) p.push(`sidecar evidence class ${String(s.evidence_class)} is not ${profile.EVIDENCE_CLASS}`);
  if (s.capture_profile !== profile.PROFILE_NAME) p.push(`sidecar capture profile ${String(s.capture_profile)} is not ${profile.PROFILE_NAME}`);
  const si = s.source_identity ?? {};
  const idWant: Record<string, string> = { host: profile.EXPECT_HOST, database: profile.EXPECT_DB, role: 'afldb_backup', database_oid: profile.EXPECT_OID, system_identifier: profile.EXPECT_SYSID, port: profile.EXPECT_DB_PORT };
  for (const k of Object.keys(idWant)) if (String(si[k]) !== idWant[k]) p.push(`sidecar source ${k} ${String(si[k])} differs from the expected ${idWant[k]}`);
  if (s.extensions !== profile.EXPECT_EXT) p.push('sidecar extension set differs from the expected one');
  if (s.archive !== dump || s.archive_sha256 !== sha256Hex(cap.files[dump]) || s.archive_bytes !== cap.files[dump].length) p.push('sidecar archive name, sha256 or byte count differs from the dump file');
  if (s.toc_readable !== true || !(Number(s.archive_toc_entries) > 0)) p.push('sidecar does not record a readable archive table of contents');
  const before = cap.files['ledger-before.tsv']; const after = cap.files['ledger-after.tsv'];
  if (before && after && !before.equals(after)) p.push('ledger-before and ledger-after differ');
  if (before) {
    const rows = before.toString('utf8').trimEnd().split('\n');
    if (rows.length !== Number(profile.EXPECT_LEDGER_ROWS)) p.push(`ledger has ${rows.length} rows, expected ${profile.EXPECT_LEDGER_ROWS}`);
    if (rows.at(-1)?.split('\t')[0] !== profile.EXPECT_LEDGER_LAST) p.push(`ledger ends ${String(rows.at(-1)?.split('\t')[0])}, expected ${profile.EXPECT_LEDGER_LAST}`);
    if (s.observed_ledger_digest !== sha256Hex(before)) p.push('sidecar ledger digest differs from ledger-before.tsv');
    if (!Array.isArray(s.observed_ledger) || s.observed_ledger.length !== rows.length) p.push('sidecar ledger list differs from ledger-before.tsv');
  }
  if (s.ledger_unchanged_across_capture !== true) p.push('sidecar does not record an unchanged ledger across the capture');
  const t = { start: Date.parse(s.captured_start_utc), end: Date.parse(s.captured_end_utc), lb: Date.parse(s.ledger_measured_before_utc), la: Date.parse(s.ledger_measured_after_utc) };
  if (![t.start, t.end, t.lb, t.la].every(Number.isFinite) || !(t.lb <= t.start && t.start <= t.end && t.end <= t.la && t.la <= now)) p.push('sidecar capture timestamps are missing or out of order');
  else if (now - t.start > maxAgeMs) p.push(`the capture started ${Math.round((now - t.start) / 3600000)} h ago, more than the allowed ${Math.round(maxAgeMs / 3600000)} h`);
  const stampMs = Date.parse(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`);
  if (!Number.isFinite(stampMs) || Math.abs(stampMs - t.lb) > 120000) p.push('the file-name stamp is not within two minutes of the first ledger measurement');
  return p;
}

/** The target file must equal what the profile expects AND what the sidecar recorded. */
export function targetProblems(target: Record<string, any>, profile: Profile, sidecar?: Record<string, any>): string[] {
  const p: string[] = [];
  const want: Record<string, unknown> = { host: profile.EXPECT_DB_HOST, port: Number(profile.EXPECT_DB_PORT), database: profile.EXPECT_DB, user: 'afldb_backup', systemIdentifier: profile.EXPECT_SYSID,
    databaseOid: profile.EXPECT_OID, clusterName: profile.EXPECT_CLUSTER, databaseComment: null };
  for (const k of Object.keys(want)) if (JSON.stringify(target[k]) !== JSON.stringify(want[k])) p.push(`target ${k} is ${JSON.stringify(target[k])}, expected ${JSON.stringify(want[k])}`);
  for (const k of Object.keys(target)) if (!(k in want)) p.push(`target carries an unexpected field ${k}`);
  if (sidecar) {
    const si = sidecar.source_identity ?? {};
    if (String(si.system_identifier) !== String(target.systemIdentifier) || String(si.database_oid) !== String(target.databaseOid)) p.push('target identity differs from the capture sidecar');
  }
  return p;
}

/* ------------------------------------------------------------------------------------------------------------------------------------- */
/* Manifest (binds a prepared run)                                                                                                       */
/* ------------------------------------------------------------------------------------------------------------------------------------- */

export const MANIFEST_FORMAT = 'afldb.gap029.stage-run.1';
export interface Manifest {
  format: string; stage: StageId; operation: string; revision: string; evidenceClass: string; profileName: string; profileSha256: string;
  target: Record<string, unknown>; planDigest: string; planExpiresAt: string; backupCapturedAt: string; createdAt: string;
  /** where the capture lives (the dump and sidecar are bound in place) */
  captureDir: string; dumpName: string; provenanceName: string;
  /** run-relative or absolute path -> sha256 */
  files: Record<string, string>;
  opsToolSha256: Record<string, string>;
}

export function manifestProblems(m: Manifest | null, ctx: { stage: StageId; revision: string; profileSha256: string; evidenceClass: string; sha: (path: string) => string | null }): string[] {
  const p: string[] = [];
  if (!m || m.format !== MANIFEST_FORMAT) return ['the run manifest is missing or not ' + MANIFEST_FORMAT];
  if (m.stage !== ctx.stage) p.push(`manifest is for ${m.stage}, not ${ctx.stage}`);
  if (m.operation !== STAGES[ctx.stage].operation) p.push('manifest operation differs from the stage');
  if (m.revision !== ctx.revision) p.push(`manifest revision ${String(m.revision).slice(0, 12)} differs from ${ctx.revision.slice(0, 12)}`);
  if (m.profileSha256 !== ctx.profileSha256) p.push('the wrapper profile differs from the one the run was prepared with');
  if (m.evidenceClass !== ctx.evidenceClass) p.push(`manifest evidence class ${m.evidenceClass} differs from ${ctx.evidenceClass}`);
  for (const k of ['dump', 'provenance', 'target.json', 'backup.json', 'restore-evidence.json', 'plan.json']) if (!(k in m.files)) p.push(`manifest does not bind ${k}`);
  if (STAGES[ctx.stage].needsChild && !('child.json' in m.files)) p.push('manifest does not bind child.json');
  for (const [path, want] of Object.entries(m.files)) { const got = ctx.sha(path); if (got === null) p.push(`${path} is missing`); else if (got !== want) p.push(`${path} differs from the bytes the plan was generated from`); }
  return p;
}

/* ------------------------------------------------------------------------------------------------------------------------------------- */
/* Plan checks and approval                                                                                                              */
/* ------------------------------------------------------------------------------------------------------------------------------------- */

export const APPLY_MIN_BACKUP_LEFT_MS = 20 * 60 * 1000;

export function planProblems(stage: StageId, plan: Record<string, any>, ctx: { revision: string; target: Record<string, unknown>; dumpSha256: string; restoreEvidenceSha256: string; now: number }): string[] {
  const spec = STAGES[stage]; const p: string[] = [];
  if (plan.operation !== spec.operation) p.push(`plan operation ${String(plan.operation)} is not ${spec.operation}`);
  if (plan.revision !== ctx.revision) p.push('plan revision differs from the pinned execution revision');
  if (plan.rehearsal !== false) p.push('the plan is a rehearsal plan');
  if (!HEX64.test(String(plan.digest ?? ''))) p.push('plan digest is not a sha256');
  if (!sameJson(plan.target, ctx.target)) p.push('plan target differs from the proven production target');
  const b = plan.backup;
  if (!b) p.push('plan carries no backup evidence');
  else {
    if (b.sha256 !== ctx.dumpSha256) p.push('plan backup sha256 differs from the captured dump');
    if (b.restoreEvidenceSha256 !== ctx.restoreEvidenceSha256) p.push('plan restore-evidence sha256 differs from the assembled restore evidence');
  }
  if (!(Date.parse(plan.expiresAt) > ctx.now)) p.push('plan has expired');
  return [...p, ...spec.planProblems(plan)];
}

export interface OwnerApprovalInput { digest: string; statement: string; expiresAt: string; notBefore?: string; now: number }
export interface Approval extends Record<string, unknown> {
  planDigest: string; target: Record<string, unknown>; revision: string; operation: string; approvedAt: string; expiresAt: string; reference: string; notBefore: string; stage: StageId;
}

/** Composes the approval from the plan and the owner's three inputs; refuses unless the typed digest IS the plan's digest and the statement names it. */
export function buildApproval(stage: StageId, plan: Record<string, any>, input: OwnerApprovalInput): { approval: Approval | null; problems: string[] } {
  const p: string[] = [];
  if (!HEX64.test(input.digest)) p.push('the typed plan digest is not 64 hex characters');
  else if (input.digest !== plan.digest) p.push(`the typed digest ${input.digest.slice(0, 12)}... is not this ${stage} plan's digest ${String(plan.digest).slice(0, 12)}...: the approval must name the actual plan`);
  const statement = input.statement.trim();
  if (statement.length < 40) p.push('the approval statement is too short to be a written approval');
  if (!statement.includes(String(plan.digest))) p.push('the approval statement does not contain the full plan digest');
  if (!statement.includes(STAGES[stage].decision)) p.push(`the approval statement does not name ${STAGES[stage].decision}`);
  if (!statement.includes(String(plan.revision))) p.push('the approval statement does not name the full execution revision');
  const zoned = (s: string | undefined) => s === undefined || /(Z|[+-]\d{2}:\d{2})$/.test(s);
  if (!zoned(input.expiresAt) || !zoned(input.notBefore)) return { approval: null, problems: ['approval times must carry an explicit UTC "Z" or numeric offset (a bare time would be read in the host clock zone)'] };
  const exp = Date.parse(input.expiresAt); const nb = Date.parse(input.notBefore ?? new Date(input.now).toISOString());
  if (!Number.isFinite(exp) || !(exp > input.now)) p.push('the approval expiry is missing or already past');
  if (!Number.isFinite(nb) || nb > exp) p.push('the approval window start is missing or after its expiry');
  if (Number.isFinite(exp) && exp > Date.parse(plan.expiresAt)) p.push('the approval would outlive the plan');
  const backupEnd = Date.parse(plan.backup?.capturedAt) + MAX_AGE_MS - APPLY_MIN_BACKUP_LEFT_MS;
  if (Number.isFinite(exp) && Number.isFinite(backupEnd) && exp > backupEnd) p.push('the approval would outlive the backup freshness limit (24 h minus 20 min): ask for an earlier expiry');
  if (plan.rehearsal !== false || !plan.backup) p.push('only a production plan with backup evidence can be approved');
  if (p.length) return { approval: null, problems: p };
  const approval: Approval = {
    stage, planDigest: plan.digest, target: plan.target, revision: plan.revision, operation: plan.operation, ...STAGES[stage].approvalExtras(plan),
    approvedAt: new Date(input.now).toISOString(), notBefore: new Date(nb).toISOString(), expiresAt: new Date(exp).toISOString(), reference: statement,
  };
  return { approval, problems: [] };
}

/** The wrapper's own check, run immediately before launching the tool (the tool then repeats the binding checks itself). */
export function approvalProblems(stage: StageId, plan: Record<string, any>, approval: Record<string, any> | null, now: number): string[] {
  if (!approval) return ['no owner approval file'];
  const p: string[] = [];
  if (approval.stage !== stage) p.push('approval is for another stage');
  if (approval.planDigest !== plan.digest) p.push("approval does not name this stage's actual plan digest");
  if (approval.revision !== plan.revision || approval.operation !== plan.operation || !sameJson(approval.target, plan.target)) p.push('approval revision, operation or target differs from the plan');
  for (const [k, v] of Object.entries(STAGES[stage].approvalExtras(plan))) if (!sameJson(approval[k], v)) p.push(`approval ${k} differs from the plan`);
  if (!(Date.parse(approval.approvedAt) <= now)) p.push('approval is dated in the future');
  if (!(Date.parse(approval.notBefore) <= now)) p.push('the approval window has not opened');
  if (!(Date.parse(approval.expiresAt) > now)) p.push('the approval has expired');
  if (Date.parse(approval.expiresAt) > Date.parse(plan.expiresAt)) p.push('the approval outlives the plan');
  if (!String(approval.reference ?? '').includes(String(plan.digest))) p.push('the approval statement does not contain the plan digest');
  const left = Date.parse(plan.backup?.capturedAt) + MAX_AGE_MS - now;
  if (!(left > APPLY_MIN_BACKUP_LEFT_MS)) p.push(`only ${Math.round(left / 60000)} min of backup freshness remain (need more than 20): prepare a fresh backup`);
  return p;
}

/* ------------------------------------------------------------------------------------------------------------------------------------- */
/* Outcome                                                                                                                               */
/* ------------------------------------------------------------------------------------------------------------------------------------- */

export type StateClass = 'BASELINE' | 'PLANNED RESULT PRESENT' | 'OTHER' | 'UNAVAILABLE';
export const parseState = (log: string): StateClass => {
  const m = /^STATE (BASELINE|PLANNED RESULT PRESENT|OTHER)/m.exec(log);
  return (m ? m[1] : 'UNAVAILABLE') as StateClass;
};
export const parseOutcomeLine = (log: string): { outcome: Outcome; exit: number } | null => {
  const m = /^OUTCOME ([A-Z_]+) \(exit (\d+)\)/m.exec(log);
  return m && (OUTCOMES as readonly string[]).includes(m[1]) ? { outcome: m[1] as Outcome, exit: Number(m[2]) } : null;
};

export interface OutcomeReport { classification: Outcome; exitCode: number; committed: boolean | 'unknown'; lines: string[]; notes: string[] }

const NEXT: Record<Outcome, string> = {
  COMMITTED_VERIFIED: 'Next: run `accept` (read-only state + verification); only then prepare the next stage with its OWN fresh backup.',
  NOTHING_WRITTEN: 'Next: the planned state was already present; run `accept` to record it. Nothing was written by this run.',
  REFUSED_BEFORE_MUTATION: 'Next: nothing changed. Read the refusal, fix its cause. The wrapper will not run this apply again; an unchanged plan can be applied with a NEW wrapper run only if the owner re-approves.',
  ROLLED_BACK: 'Next: the database holds its pre-run state. Do NOT retry blindly: understand the cause, then decide whether to re-plan.',
  COMMITTED_VERIFICATION_FAILED: 'Next: STOP. The change IS committed and was NOT rolled back. Nothing will be retried or restored automatically. Owner decision required (a restore of this stage\'s backup would discard every later write).',
  COMMITTED_VERIFICATION_UNAVAILABLE: 'Next: STOP. The change IS committed. Run the read-only `state` mode and decide with the owner; nothing will be retried or restored automatically.',
  OUTCOME_UNDETERMINED: 'Next: STOP. Do not assume rolled back and do not retry. Run the read-only `state` mode; the only repair is owner-decided (restore of this stage\'s backup, or a reviewed corrective plan).',
};

/** Maps the tool's exit code, its printed outcome line and a post-run read-only state probe to ONE reviewed outcome. Contradictions become OUTCOME_UNDETERMINED. */
export function classifyOutcome(a: { stage: StageId; toolExit: number | null; toolLog: string; stateLog: string | null }): OutcomeReport {
  const notes: string[] = [];
  const line = parseOutcomeLine(a.toolLog);
  const state: StateClass = a.stateLog === null ? 'UNAVAILABLE' : parseState(a.stateLog);
  let c: Outcome;
  if (a.toolExit === null) { c = 'OUTCOME_UNDETERMINED'; notes.push('the tool did not report an exit code (killed, timed out or lost)'); }
  else if (!line) { c = 'OUTCOME_UNDETERMINED'; notes.push(`the tool exited ${a.toolExit} without an OUTCOME line`); }
  else if (EXIT_CODE[line.outcome] !== a.toolExit || line.exit !== a.toolExit) { c = 'OUTCOME_UNDETERMINED'; notes.push(`the tool printed ${line.outcome} (exit ${line.exit}) but exited ${a.toolExit}`); }
  else c = line.outcome;
  // Corroborate with the read-only probe. A contradiction never resolves in favour of "nothing happened".
  if (c === 'COMMITTED_VERIFIED' && state !== 'PLANNED RESULT PRESENT') { notes.push(`the tool reported COMMITTED_VERIFIED but the state probe says ${state}`); c = 'OUTCOME_UNDETERMINED'; }
  else if (c === 'NOTHING_WRITTEN' && state !== 'PLANNED RESULT PRESENT') { notes.push(`the tool reported NOTHING_WRITTEN but the state probe says ${state}`); c = 'OUTCOME_UNDETERMINED'; }
  else if ((c === 'REFUSED_BEFORE_MUTATION' || c === 'ROLLED_BACK') && state !== 'BASELINE') {
    notes.push(`the tool reported ${c} but the state probe says ${state}${state === 'PLANNED RESULT PRESENT' ? ' (the planned result IS present: treat as committed)' : ''}`);
    c = 'OUTCOME_UNDETERMINED';
  } else if (state === 'UNAVAILABLE' && a.toolExit !== null) notes.push('the post-run state probe could not run; the outcome rests on the tool alone');
  const committed: boolean | 'unknown' = c === 'COMMITTED_VERIFIED' || c === 'NOTHING_WRITTEN' || c === 'COMMITTED_VERIFICATION_FAILED' || c === 'COMMITTED_VERIFICATION_UNAVAILABLE' ? true
    : c === 'REFUSED_BEFORE_MUTATION' || c === 'ROLLED_BACK' ? false : 'unknown';
  const lines = [`WRAPPER OUTCOME ${c} (exit ${EXIT_CODE[c]}) stage ${a.stage}`, STATEMENT[c], `post-run state probe: ${state}`, ...notes.map((n) => `note: ${n}`), NEXT[c],
    'The wrapper never retries an apply, never claims rollback after a commit and never restores a backup.'];
  return { classification: c, exitCode: EXIT_CODE[c], committed, lines, notes };
}

/** The written statement the owner approves, fully populated from the plan (the owner may edit nothing but the window; the wrapper refuses a statement that does not name the digest). */
export function approvalStatement(stage: StageId, plan: Record<string, any>, ev: { dumpSha256: string; restoreEvidenceSha256: string; evidenceClass: string; window: string }): string {
  const spec = STAGES[stage]; const t = plan.target as Record<string, string>;
  const common = `I approve ${spec.decision}: apply, once, to ${t.database} (database OID ${t.databaseOid}, system identifier ${t.systemIdentifier}) the digest-pinned ${stage} plan ${plan.digest} (${spec.title}), `
    + `at execution revision ${plan.revision}, after this stage's own fresh restore-verified backup ${ev.dumpSha256} (restore evidence ${ev.restoreEvidenceSha256}; evidence class ${ev.evidenceClass}). `;
  const own: Record<StageId, string> = {
    S1: 'Exactly the seven co-captain rows named in the plan, additive only.',
    S2: `Through gap029-draft-link-production.py with child sha256 ${plan.childSha256} and label ${plan.label}. I accept that the importer commits in its own transaction, that a failure mid-write may be reported as OUTCOME_UNDETERMINED, and that recovery is an owner-decided restore.`,
    S3: `Exactly the eight manual rookie selections named in the plan, through the audited editor path as actor auth_users.id ${String(plan.actorUserId)}, my active, fully enrolled Super Admin.`,
    S4: `Exactly the sibling key afldb-sibling-supplement:015 through family_siblings.py load, artefact ${plan.artefactSha256}, expecting content digest ${plan.expectAfterContentDigest}. I accept the same recovery limit as S2.`,
    I336: `Exactly the 35 DraftGuru Pre-Draft rows of reviewed evidence ${plan.evidenceSha256} named in the plan, each audited through recordDataEdit under the season seal as actor auth_users.id ${String(plan.actorUserId)}, my active, fully enrolled Super Admin; signing head 'Intl Schol' accepted under D-336-1.`,
  };
  return `${common}${own[stage]} Nothing else. No retry and no automatic restore. Window: ${ev.window}.`;
}

/** A cheap, tool-independent sanity check the workstation runs on the assembled `backup.json` it fetched (the stage tool re-checks the full seal at plan time). */
export function backupEvidenceBasicProblems(backup: Record<string, any>, ctx: { stage: StageId; revision: string; dumpSha256: string; restoreEvidenceSha256: string; productionTarget: Record<string, unknown>; childSha256?: string }): string[] {
  const p: string[] = []; const a = backup?.assembly;
  if (!a || typeof a.sealedBody !== 'string' || typeof a.sealedBodySha256 !== 'string') return ['backup evidence has no assembly seal'];
  if (sha256Hex(a.sealedBody) !== a.sealedBodySha256) p.push('the seal digest differs from its sealed body');
  if (a.format !== 'afldb.gap029.restore-evidence-assembly.1') p.push('assembly format not recognised');
  if (a.stage !== ctx.stage || a.operation !== STAGES[ctx.stage].operation) p.push('assembled for another stage or operation');
  if (a.revision !== ctx.revision) p.push(`assembled at revision ${String(a.revision).slice(0, 12)}, not ${ctx.revision.slice(0, 12)}`);
  if (backup.sha256 !== ctx.dumpSha256 || a.inputs?.dumpSha256 !== ctx.dumpSha256) p.push('evidence is about a different dump');
  if (backup.restoreEvidenceSha256 !== ctx.restoreEvidenceSha256 || a.inputs?.restoreEvidenceSha256 !== ctx.restoreEvidenceSha256) p.push('evidence names a different restore-evidence file');
  if (!sameJson(backup.target, ctx.productionTarget)) p.push('evidence target differs from the proven production target');
  if (STAGES[ctx.stage].needsChild && a.inputs?.childSha256 !== ctx.childSha256) p.push('the child sha256 in the sealed evidence differs from the exported child');
  return p;
}

export const canon = canonJson;
