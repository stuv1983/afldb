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
    backup: { target, sha256: 's', restoreEvidenceSha256: 'r', capturedAt: '2026-11-03T09:30:00.000Z', restoredAt: '2026-11-03T09:45:00.000Z', baselineDigest: 'b'.repeat(64) } };
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
    expect(tool).toContain('RESTORE REQUIRED');
  });
});
