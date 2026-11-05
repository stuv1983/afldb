/** V2-GAP-029: pure-function contracts for the guarded production entry points (rookie selections, draft link-only, sibling pair).
 * The database-backed controls (actor viability, atomic rollback, drift, replay) run in tools/v2/gap029-rookie-selections-rehearsal.mts
 * against a production-derived isolated clone; their recorded results are in docs/v2/evidence/gap029-final-20261103/. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRookieRelistingOutcomes } from './rookie-relisting-outcomes';
import {
  approvalProblem, buildEntries, entryProblem, eventKey, pickKey, planDigest, REVIEWED, rowDigest,
  type Entry, type Live, type Plan,
} from '../tools/v2/gap029-rookie-selections-production';
import * as I336 from '../tools/v2/issue336-predraft-insert-production';
import * as OPS from '../tools/v2/gap029-ops-lib';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const entries = buildEntries(loadRookieRelistingOutcomes());
const evidence = JSON.parse(read('docs/v2/evidence/gap-029-rookie-selections-2026-11-03.json'));

const liveFor = (e: Entry, over: Partial<Live> = {}): Live => ({
  playerIds: new Map([[e.afltablesProfile, [e.expectedPlayerId]]]), clubIds: new Map([[e.clubSlug, [7]]]),
  sameEvent: new Map(), byPick: new Map(), ...over,
});

describe('GAP-029 rookie selections: reviewed content', () => {
  it('the committed evidence equals the entries derived from the tracked outcomes file', () => {
    expect(evidence.entries).toEqual(entries);
    expect(evidence.outcomes.sha256).toBe(sha(read('data/players/rookie-relisting-outcomes.csv').replace(/\r\n/g, '\n')));
    expect(entries).toHaveLength(8);
    expect(entries.reduce((n, e) => n + e.cells, 0)).toBe(23);
    expect(Object.keys(REVIEWED).sort()).toEqual(entries.map((e) => e.afltablesProfile).sort());
  });
  it('keeps pick-number provenance exact: six primary, Rischitelli and Gibbs secondary and never relabelled', () => {
    expect(entries.filter((e) => e.pickNumberEvidence === 'primary')).toHaveLength(6);
    const secondary = entries.filter((e) => e.pickNumberEvidence === 'secondary');
    expect(secondary.map((e) => e.player).sort()).toEqual(['Bryce Gibbs', 'Michael Rischitelli']);
    for (const e of secondary) {
      expect(e.pickNumberBasis).toMatch(/^SECONDARY, not primary/);
      expect(e.detail).toContain('pick-number evidence=secondary');
    }
    const byName = (n: string) => entries.find((e) => e.player === n)!;
    expect([byName('Michael Rischitelli').clubName, byName('Michael Rischitelli').draftEventYear, byName('Michael Rischitelli').pick]).toEqual(['Gold Coast', 2018, 2]);
    expect([byName('Bryce Gibbs').clubName, byName('Bryce Gibbs').draftEventYear, byName('Bryce Gibbs').pick]).toEqual(['Adelaide', 2020, 1]);
    expect(byName('Bryce Gibbs').redraftCorroboration).toMatch(/not the pick-number source/);
  });
  it('records the draft event year separately from the following playing season', () => {
    for (const e of entries) {
      expect(e.firstPlayingSeason).toBe(e.draftEventYear + 1);
      expect(e.detail).toContain(`draft event year=${e.draftEventYear}; first playing season=${e.draftEventYear + 1}`);
      expect(e.correctionNote.length).toBeGreaterThanOrEqual(20); // the V2-GAP-006 sealed-season note minimum
      expect(e.draftType).toBe('Rookie');
      expect(e.draftKind).toBe('rookie');
    }
  });
});

describe('GAP-029 rookie selections: resolution and conflict refusal', () => {
  const e = entries[0];
  it('inserts a clean selection and recognises an identical one as already present', () => {
    expect(entryProblem(e, liveFor(e))).toEqual({ playerId: e.expectedPlayerId, clubId: 7, action: 'to insert' });
    const held = { id: 1, pick_number: e.pick, club_id: 7, source_key: 'manual_admin_edit', draft_type: 'Rookie', detail: e.detail, player_id: e.expectedPlayerId };
    expect(entryProblem(e, liveFor(e, { sameEvent: new Map([[eventKey(e.expectedPlayerId, e.draftEventYear), [held]]]) })))
      .toEqual({ playerId: e.expectedPlayerId, clubId: 7, action: 'already present' });
  });
  it('refuses a different identity, an ambiguous player or club, a tampered row, and any conflicting existing selection', () => {
    expect(entryProblem(e, liveFor(e, { playerIds: new Map([[e.afltablesProfile, [e.expectedPlayerId + 1]]]) }))).toMatch(/reviewed identity/);
    expect(entryProblem(e, liveFor(e, { playerIds: new Map([[e.afltablesProfile, [e.expectedPlayerId, 1]]]) }))).toMatch(/not exactly one/);
    expect(entryProblem(e, liveFor(e, { playerIds: new Map() }))).toMatch(/not exactly one/);
    expect(entryProblem(e, liveFor(e, { clubIds: new Map([[e.clubSlug, [7, 8]]]) }))).toMatch(/not exactly one/);
    expect(entryProblem({ ...e, pick: e.pick + 1 }, liveFor(e))).toMatch(/digest differs/);
    const other = { id: 2, pick_number: e.pick, club_id: 7, source_key: 'manual_admin_edit', draft_type: 'Rookie', detail: 'other', player_id: e.expectedPlayerId };
    expect(entryProblem(e, liveFor(e, { sameEvent: new Map([[eventKey(e.expectedPlayerId, e.draftEventYear), [other]]]) }))).toMatch(/different content/);
    expect(entryProblem(e, liveFor(e, { sameEvent: new Map([[eventKey(e.expectedPlayerId, e.draftEventYear), [other, other]]]) }))).toMatch(/already holds 2/);
    const source = { ...other, source_key: 'draftguru', detail: e.detail };
    expect(entryProblem(e, liveFor(e, { sameEvent: new Map([[eventKey(e.expectedPlayerId, e.draftEventYear), [source]]]) }))).toMatch(/different content/);
    const clash = { id: 3, pick_number: e.pick, club_id: 9, source_key: 'draftguru', draft_type: 'Rookie', detail: null, player_id: 999999 };
    expect(entryProblem(e, liveFor(e, { byPick: new Map([[pickKey(e.draftEventYear, e.pick), [clash]]]) }))).toMatch(/held by selection #3/);
  });
  it('the row digest binds every field of the entry', () => {
    const { rowSha256, ...rest } = e;
    expect(rowDigest(rest)).toBe(rowSha256);
    for (const key of ['pick', 'clubSlug', 'draftEventYear', 'detail', 'correctionNote', 'expectedPlayerId'] as const) {
      expect(rowDigest({ ...rest, [key]: key === 'clubSlug' || key === 'detail' || key === 'correctionNote' ? 'x' : 1 } as never)).not.toBe(rowSha256);
    }
  });
});

describe('GAP-029 rookie selections: execution approval binding', () => {
  const target = { host: 'h', port: 5432, database: 'afldb_prod', user: 'afldb_import', systemIdentifier: '1', databaseOid: '2', clusterName: '16/main', databaseComment: null };
  const t0 = Date.parse('2026-11-03T10:00:00Z');
  const body: Omit<Plan, 'digest'> = { operation: 'gap029-rookie-selections', revision: 'a'.repeat(40), target, rehearsal: false, actorUserId: 1, evidenceSha256: 'e'.repeat(64),
    outcomesSha256: 'o'.repeat(64), baselineDigest: 'b'.repeat(64), createdAt: '2026-11-03T10:00:00.000Z', expiresAt: '2026-11-04T10:00:00.000Z', entries: [],
    backup: { target, sha256: 's', restoreEvidenceSha256: 'r', capturedAt: '2026-11-03T09:30:00.000Z', restoredAt: '2026-11-03T09:45:00.000Z', baselineDigest: 'b'.repeat(64), importBatchesBefore: 69 } };
  const plan: Plan = { ...body, digest: planDigest(body) };
  const approval = { planDigest: plan.digest, target, revision: plan.revision, operation: plan.operation, evidenceSha256: plan.evidenceSha256, actorUserId: 1,
    approvedAt: '2026-11-03T10:05:00.000Z', expiresAt: '2026-11-04T09:00:00.000Z', reference: 'owner approval 2026-11-03' };
  const ctx = { now: t0 + 10 * 60 * 1000, revision: plan.revision, evidenceSha256: plan.evidenceSha256 };
  it('accepts only an approval bound to the plan, target, revision, evidence and actor', () => {
    expect(approvalProblem(plan, approval, ctx)).toBeNull();
    for (const bad of [{ planDigest: 'x' }, { actorUserId: 2 }, { revision: 'b'.repeat(40) }, { evidenceSha256: 'z' }, { operation: 'y' }, { target: { ...target, databaseOid: '3' } },
      { expiresAt: '2026-11-04T11:00:00.000Z' }, { expiresAt: '2026-11-03T10:06:00.000Z' }, { reference: ' ' }]) {
      expect(approvalProblem(plan, { ...approval, ...bad }, ctx)).not.toBeNull();
    }
    expect(approvalProblem(plan, null, ctx)).not.toBeNull();
    expect(approvalProblem({ ...plan, actorUserId: 2 }, approval, ctx)).not.toBeNull(); // plan edited without re-sealing
    expect(approvalProblem(plan, approval, { ...ctx, now: Date.parse('2026-11-04T10:00:01Z') })).not.toBeNull();
    expect(approvalProblem(plan, approval, { ...ctx, now: Date.parse('2026-11-04T09:50:00Z') })).not.toBeNull(); // approval expired, backup no longer fresh
  });
});

describe('GAP-029 draft-link production procedure: the gate stays closed and every safeguard is carried', () => {
  const gate = read('tools/rebuild/draftguru/bridge_import_gate.py');
  const tool = read('tools/v2/gap029-draft-link-production.py');
  it('bridge_import_gate.py is unmodified and still has no production target', () => {
    expect(sha(readFileSync(join(root, 'tools/rebuild/draftguru/bridge_import_gate.py')))).toBe('fbce43f7f1e374b3dfac05968e627b8ad9f337279f233a49bc19ff57d02d558d');
    expect(gate).toMatch(/TARGETS: dict\[str, dict\[str, Any\]\] = \{\s+"test": \{[\s\S]*?\},\s+"dev": \{[\s\S]*?\},\s+\}/);
    expect(gate).not.toMatch(/"prod(uction)?"\s*:/);
    expect(gate).toMatch(/no PROD target exists and none\s+can be added by a\s+command-line value/);
    expect(gate).toContain('There is no PROD target.');
  });
  it('the replacement never touches the gate\'s target resolution, and states G1 to G12', () => {
    expect(tool).not.toMatch(/gate\.TARGETS\s*(\[|\.update|=)/);
    expect(tool).not.toMatch(/monkeypatch|setattr\(gate/);
    expect(tool).toContain('def gate_still_refuses_production');
    for (let i = 1; i <= 12; i += 1) expect(tool).toContain(`"G${i}"`);
    expect(tool).toContain('no production dry run is authorised');
    expect(tool).toContain('gate.run_gate(');
    expect(tool).toContain('link_only=True');
    // A committed-but-unverified stage is reported by the shared runner, which never restores automatically (a restore is a separate owner decision).
    expect(tool).toContain('run_apply(');
    expect(tool).not.toContain('RESTORE REQUIRED');
  });
});

/* AFLDB-ISSUE-336 (D-336-1, D-336-2): the guarded production insert of the 35 DraftGuru Pre-Draft rows follows the same contract. Its database-backed
 * controls (actor, seal audit, drift, replay, rollback) are rehearsed on a production-derived isolated clone; see
 * docs/v2/evidence/issue336-draft-categories-20261105/. */
describe('ISSUE-336 Pre-Draft insert: reviewed content, resolution and approval binding', () => {
  const kinds = JSON.parse(read('data/reference/draftguru-event-kinds.json'));
  const clubs = JSON.parse(read('tools/rebuild/draftguru/draftguru-contract.json'));
  const vocab = new Set<string>(kinds.signing.signing_kind.vocabulary);
  const nulls = new Set<string>(clubs.club_resolution.deliberate_null.map((d: { club_slug: string }) => d.club_slug));
  const text = read(I336.EVIDENCE_PATH);
  const built = I336.buildEntries(text, vocab, nulls);

  it('derives exactly 35 unnumbered Pre-Draft entries from the pinned evidence, with distinct reload keys and notes the seal accepts', () => {
    expect(built).toHaveLength(35);
    expect(new Set(built.map((e) => e.key)).size).toBe(35);
    expect(built.filter((e) => e.signingKind === 'Intl Schol')).toHaveLength(32);
    for (const e of built) {
      expect(e.correctionNote.length).toBeGreaterThanOrEqual(20);
      expect(e.correctionNote.length).toBeLessThanOrEqual(2000);
      expect(e.correctionNote).toContain(e.sourceRecordId);
      expect(e.correctionNote).not.toContain(e.playerNameRaw); // the note names the source record, never the player
    }
    expect(built.some((e) => e.clubSlug === null)).toBe(true); // 'brisbane' stays a reviewed deliberate NULL, as in the importer
  });

  it('refuses changed evidence, and a head the closed vocabulary does not carry (D-336-1 is a contract edit, not a flag)', () => {
    expect(() => I336.buildEntries(text.replace('"Pre-Draft"', '"Pre-draft"'), vocab, nulls)).toThrow(/reviewed bytes/);
    const without = new Set([...vocab].filter((h) => h !== 'Intl Schol'));
    expect(() => I336.buildEntries(text, without, nulls)).toThrow(/closed vocabulary/);
  });

  const e = built.find((x) => x.clubSlug !== null)!;
  const live = (over: Partial<import('../tools/v2/issue336-predraft-insert-production').Live> = {}) => ({
    sourceIds: [3], clubIds: new Map([[e.clubSlug!, [7]]]), picks: new Map(), persons: new Map(), ...over,
  });
  const person = { id: 40, dg_person_id: 900, player_id: null, link_status: 'unmatched', match_method: null };

  it('inserts a clean row, reuses a stored person URL with its link, and recognises an identical stored row as already present', () => {
    expect(I336.entryProblem(e, live())).toEqual({ clubId: 7, personId: null, playerId: null, linkStatus: 'unmatched', action: 'to insert' });
    const linked = { ...person, player_id: 8331, link_status: 'unique' };
    expect(I336.entryProblem(e, live({ persons: new Map([[e.playerUrl, [linked]]]) }))).toMatchObject({ personId: 40, playerId: 8331, linkStatus: 'unique', action: 'to insert' });
    const stored = { id: 9, source_record_id: e.sourceRecordId, draft_type: 'Pre-Draft', signing: e.signing, club_name_raw: null };
    expect(I336.entryProblem(e, live({ persons: new Map([[e.playerUrl, [person]]]), picks: new Map([[e.key, [stored]]]) }))).toMatchObject({ action: 'already present' });
  });

  it('refuses an ambiguous source, club or person, and any different row already holding the reload key', () => {
    expect(I336.entryProblem(e, live({ sourceIds: [3, 4] }))).toMatch(/exactly one/);
    expect(I336.entryProblem(e, live({ clubIds: new Map([[e.clubSlug!, [7, 8]]]) }))).toMatch(/2 clubs/);
    expect(I336.entryProblem(e, live({ clubIds: new Map() }))).toMatch(/0 clubs/);
    expect(I336.entryProblem(e, live({ persons: new Map([[e.playerUrl, [person, { ...person, id: 41 }]]]) }))).toMatch(/stored 2 times/);
    const other = { id: 9, source_record_id: 'elsewhere#1', draft_type: 'Pre-Draft', signing: e.signing, club_name_raw: null };
    expect(I336.entryProblem(e, live({ persons: new Map([[e.playerUrl, [person]]]), picks: new Map([[e.key, [other]]]) }))).toMatch(/different content/);
  });

  it('accepts only an approval bound to the plan, target, revision, evidence and actor', () => {
    const target = { host: 'h', port: 5432, database: 'afldb_prod', user: 'afldb_ro', systemIdentifier: '1', databaseOid: '2', clusterName: '16/main', databaseComment: null };
    const body = { operation: I336.OPERATION, revision: 'a'.repeat(40), target, rehearsal: false, actorUserId: 1, evidenceSha256: I336.EVIDENCE_SHA256, baselineDigest: 'b'.repeat(64),
      importBatchesBefore: 70, createdAt: '2026-11-06T10:00:00.000Z', expiresAt: '2026-11-07T10:00:00.000Z', entries: [],
      backup: { target, sha256: 's', restoreEvidenceSha256: 'r', capturedAt: '2026-11-06T09:30:00.000Z', restoredAt: '2026-11-06T09:45:00.000Z', baselineDigest: 'b'.repeat(64), importBatchesBefore: 70 } };
    const plan = { ...body, digest: I336.planDigest(body) };
    const approval = { planDigest: plan.digest, target, revision: plan.revision, operation: plan.operation, evidenceSha256: plan.evidenceSha256, actorUserId: 1,
      approvedAt: '2026-11-06T10:05:00.000Z', expiresAt: '2026-11-07T09:00:00.000Z', reference: 'owner approval D-336-2' };
    const ctx = { now: Date.parse('2026-11-06T10:10:00Z'), revision: plan.revision };
    expect(I336.approvalProblem(plan, approval, ctx)).toBeNull();
    for (const bad of [{ planDigest: 'x' }, { actorUserId: 2 }, { revision: 'b'.repeat(40) }, { evidenceSha256: 'z' }, { operation: 'y' }, { target: { ...target, databaseOid: '3' } },
      { expiresAt: '2026-11-07T11:00:00.000Z' }, { reference: ' ' }]) expect(I336.approvalProblem(plan, { ...approval, ...bad }, ctx)).not.toBeNull();
    expect(I336.approvalProblem(plan, null, ctx)).not.toBeNull();
    expect(I336.approvalProblem({ ...plan, actorUserId: 2 }, approval, ctx)).not.toBeNull();
    expect(I336.approvalProblem({ ...plan, rehearsal: true, digest: I336.planDigest({ ...body, rehearsal: true }) }, null, ctx)).toBeNull(); // rehearsal: no approval
  });

  it('the ops framework pins the same evidence and operation as the tool (stage I336)', () => {
    expect(OPS.I336_EVIDENCE_SHA256).toBe(I336.EVIDENCE_SHA256);
    expect(OPS.STAGES.I336.operation).toBe(I336.OPERATION);
    expect(OPS.STAGES.I336.tool).toBe(I336.TOOL_PATH);
  });

  it('writes through the audited seal path, never an override, and refuses an isolated target outside --rehearsal', () => {
    const tool = read('tools/v2/issue336-predraft-insert-production.ts');
    expect(tool).toContain("recordDataEdit(tx, { tableName: 'draft_picks'");
    expect(tool).toContain("seal: { kind: 'row' }");
    expect(tool).toContain('assert_viable_super_admin_actor');
    expect(tool).not.toMatch(/INSERT INTO data_overrides/);
    expect(tool).toContain("an isolated clone is rehearsed with --rehearsal");
  });
});
