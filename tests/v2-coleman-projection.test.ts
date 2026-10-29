// lib | Coleman projection planner and publisher port unit tests
// Soft size threshold: 500 LOC. Run `phaneslight loc-check` if uncertain.
/**
 * AFLDB V2 Launch F (stream F-D, ADR 0015) - the Coleman projection into `award_winners`, UNIT level:
 * the pure planner (retained / updated / inserted / voided / every refusal), the loader-parity
 * proofs (the note literal and the column format are pinned to `tools/migration/import_awards.py`),
 * the publisher's projection port (called inside the transaction, after the ledger step, on every
 * outcome; a refusal rolls everything back), the public revalidation allowlist, and static proofs
 * about the production port's SQL. No database, no network, no clock.
 *
 * The SQL itself runs for real on PostgreSQL in tests/integration/v2-coleman-publication.test.ts.
 * FIXTURES ARE SYNTHETIC (tests/v2-coleman-publication-fixtures.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { SqlExecutor, TransactionalSqlExecutor } from '@afldb/db';
import {
  COLEMAN_PROJECTION_REFUSAL_CODES,
  COLEMAN_PUBLICATION_REFUSAL_CODES,
  ColemanProjectionRefusal,
  colemanProjectionNote,
  desiredColemanRow,
  planColemanProjection,
  previewOfColemanProjection,
  publishColemanResult,
  type ColemanProjectionPlanInput,
  type ColemanProjectionPort,
  type ColemanProjectionRequest,
  type ColemanProjectionResult,
  type ColemanStoredRow,
} from '@afldb/derived';

import { isAllowedRevalidatePath } from '@/app/admin/awards/revalidate-paths';
import { awardPath, awardSeasonPath, clubPath, playerPath, seasonPath } from '@/lib/format';

import {
  SEASON,
  SUPER_ADMIN,
  correction,
  derive,
  makeInput,
  synthFacts,
  synthPath,
} from './v2-coleman-publication-fixtures';

const AWARD_ID = 3;
const SOURCE = 'afltables';
const KEY_A = `coleman:${SEASON}:${synthPath('A')}`;
const KEY_C = `coleman:${SEASON}:${synthPath('C')}`;
const KEY_E = `coleman:${SEASON}:${synthPath('E')}`;
const KEY_G = `coleman:${SEASON}:${synthPath('G')}`;
const NAMES: Record<string, string> = {
  11: 'Synthetic Player A', 12: 'Synthetic Player B', 13: 'Synthetic Player C', 14: 'Synthetic Player D',
  15: 'Synthetic Player E', 16: 'Synthetic Player F', 17: 'Synthetic Player G', 18: 'Synthetic Player H',
};

/** The stored row the LOADER would have written for a derived winner (same tuple, same key). */
function loaderRow(over: Omit<Partial<ColemanStoredRow>, 'playerId' | 'clubId'> & { key: string; goals: number; playerId: number | null; clubId: number | null }): ColemanStoredRow {
  const { key, goals, playerId, clubId, ...rest } = over;
  return {
    id: 100 + (playerId ?? 0),
    awardId: AWARD_ID,
    season: SEASON,
    status: 'active',
    sourceKey: SOURCE,
    sourceRecordId: key,
    playerId,
    playerNameRaw: NAMES[String(playerId)],
    linkStatus: 'resolved',
    candidateCount: 0,
    clubId,
    clubNameRaw: null,
    votes: null,
    position: null,
    isCaptain: false,
    isViceCaptain: false,
    note: colemanProjectionNote(goals, 1),
    ...rest,
  };
}

const ROW_A = (over: Partial<ColemanStoredRow> = {}) => loaderRow({ key: KEY_A, goals: 5, playerId: 11, clubId: 1, ...over });

function planInput(over: Partial<ColemanProjectionPlanInput> = {}): ColemanProjectionPlanInput {
  return {
    derivation: derive(),
    awardId: AWARD_ID,
    sourceKey: SOURCE,
    displayNames: NAMES,
    stored: [],
    overriddenEntityKeys: new Set<string>(),
    entityKeyOf: (id) => `${SOURCE}:${id}`,
    ...over,
  };
}

function planOk(over: Partial<ColemanProjectionPlanInput> = {}) {
  const plan = planColemanProjection(planInput(over));
  if (!plan.ok) throw new Error(`unexpected refusal ${plan.refusal.code}: ${plan.refusal.message}`);
  return plan;
}

function planRefused(over: Partial<ColemanProjectionPlanInput> = {}) {
  const plan = planColemanProjection(planInput(over));
  if (plan.ok) throw new Error('expected a refusal');
  return plan.refusal;
}

/* ------------------------------------------------------------------ *
 * Loader parity (review F-003, test 1)
 * ------------------------------------------------------------------ */

describe('loader parity: the projection builds the loader\'s exact row (SYNTHETIC)', () => {
  const python = readFileSync(join(__dirname, '..', 'tools', 'migration', 'import_awards.py'), 'utf8').replace(/\r\n/g, '\n');
  const importColeman = python.slice(python.indexOf('def import_coleman('), python.indexOf('# One-time legacy -> derived transition'));

  it('pins the note literal to the f-string template in tools/migration/import_awards.py', () => {
    const block = /note = \(\n((?:\s+f"[^\n]*"\n)+)\s+\)/.exec(importColeman);
    expect(block, 'the loader\'s note f-string block was not found').not.toBeNull();
    const template = [...block![1].matchAll(/f"([^"\n]*)"/g)].map((m) => m[1]).join('');
    expect(template).toBe(
      'Derived from AFLDB home-and-away match statistics: {winner[\'goals\']} goals (coleman-derivation.json method_version {method_version})',
    );
    const rendered = template.replace('{winner[\'goals\']}', '37').replace('{method_version}', '4');
    expect(colemanProjectionNote(37, 4)).toBe(rendered);
    expect(colemanProjectionNote(37, 4)).toBe(
      'Derived from AFLDB home-and-away match statistics: 37 goals (coleman-derivation.json method_version 4)',
    );
  });

  it('pins the rest of the loader tuple: born linked, no candidates, no club spelling, no votes, no position, no flags', () => {
    // winner["display_name"], "resolved", 0, club_id, None (club_name_raw), None (votes), None (position), False, False, note
    expect(importColeman).toMatch(/winner\["display_name"\],[\s\S]*?"resolved", 0,\s*winner\["club_id"\],[\s\S]*?None,[\s\S]*?None,\s*None, False, False, note,/);
    const winner = derive().winners[0];
    expect(desiredColemanRow(winner, 'Synthetic Player A', 1)).toEqual({
      playerId: 11,
      playerNameRaw: 'Synthetic Player A',
      linkStatus: 'resolved',
      candidateCount: 0,
      clubId: 1,
      clubNameRaw: null,
      votes: null,
      position: null,
      isCaptain: false,
      isViceCaptain: false,
      note: colemanProjectionNote(5, 1),
    });
  });

  it('the loader reloads on the same key columns and the same ownership scope the projection uses', () => {
    expect(importColeman).toContain('pg, "award_winners", ["source_id", "source_record_id"]');
    expect(importColeman).toContain('scope_column="award_id", scope_values=[award_id]');
    expect(importColeman).toContain('scopes=[("source_id", [source_id], False)]');
    // The key format: coleman<sep><season><sep><profile path> (data/reference/coleman-derivation.json key_separator).
    expect(python).toContain('"key": f"{COLEMAN_SLUG}{separator}{season}{separator}{path}"');
  });

  it('the multi-club rule is the loader\'s: no single club -> NULL club', () => {
    const winner = { ...derive().winners[0], clubId: null, clubCount: 2 };
    expect(desiredColemanRow(winner, 'Synthetic Player A', 1).clubId).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * The planner
 * ------------------------------------------------------------------ */

describe('planColemanProjection: one decision per key (SYNTHETIC)', () => {
  it('no stored row -> inserted, in the loader format, with no id yet', () => {
    const plan = planOk();
    expect(plan.counts).toEqual({ inserted: 1, updated: 0, voided: 0, retained: 0 });
    expect(plan.changedCount).toBe(1);
    const [row] = plan.planned;
    expect(row).toMatchObject({ action: 'inserted', key: KEY_A, entityKey: `afltables:${KEY_A}`, awardWinnerId: null, before: null });
    expect(row.after).toEqual(desiredColemanRow(derive().winners[0], 'Synthetic Player A', 1));
  });

  it('a stored row equal on the FULL tuple -> retained, whatever its id', () => {
    const plan = planOk({ stored: [ROW_A()] });
    expect(plan.counts).toEqual({ inserted: 0, updated: 0, voided: 0, retained: 1 });
    expect(plan.changedCount).toBe(0);
    expect(plan.planned[0]).toMatchObject({ action: 'retained', awardWinnerId: 111, changedFields: [] });
  });

  it('a goals-only change moves the note, so the row is UPDATED, not retained (review F-002)', () => {
    const plan = planOk({ stored: [ROW_A({ note: colemanProjectionNote(4, 1) })] });
    expect(plan.planned[0]).toMatchObject({ action: 'updated', awardWinnerId: 111, changedFields: ['note'] });
    expect(plan.planned[0].after?.note).toBe(colemanProjectionNote(5, 1));
    expect(plan.counts.updated).toBe(1);
  });

  it('every other column of the tuple also forces an update', () => {
    const variants: Array<[Partial<ColemanStoredRow>, string]> = [
      [{ playerNameRaw: 'Some Source Spelling' }, 'playerNameRaw'],
      [{ clubId: 2 }, 'clubId'],
      [{ clubId: null }, 'clubId'],
      [{ linkStatus: 'unique' }, 'linkStatus'],
      [{ candidateCount: 1 }, 'candidateCount'],
      [{ clubNameRaw: 'Synthetic Club' }, 'clubNameRaw'],
      [{ votes: '5.00' }, 'votes'],
      [{ position: 'FF' }, 'position'],
      [{ isCaptain: true }, 'isCaptain'],
      [{ isViceCaptain: true }, 'isViceCaptain'],
      [{ note: null }, 'note'],
      [{ playerId: 12, playerNameRaw: 'Synthetic Player A' }, 'playerId'],
    ];
    for (const [over, field] of variants) {
      const plan = planOk({ stored: [ROW_A(over)] });
      expect(plan.planned[0].action, field).toBe('updated');
      expect(plan.planned[0].changedFields, field).toEqual([field]);
    }
  });

  it('an ACTIVE derived-owner row the derivation no longer supports is voided (with its previous values kept for the audit)', () => {
    const stale = loaderRow({ key: `coleman:${SEASON}:${synthPath('B')}`, goals: 6, playerId: 12, clubId: 1 });
    const plan = planOk({ stored: [ROW_A(), stale] });
    expect(plan.counts).toEqual({ inserted: 0, updated: 0, voided: 1, retained: 1 });
    const voided = plan.planned.find((row) => row.action === 'voided');
    expect(voided).toMatchObject({ key: stale.sourceRecordId, awardWinnerId: stale.id, after: null });
    expect(voided?.before?.playerNameRaw).toBe('Synthetic Player B');
  });

  it('a void row that is not derived is history: ignored, never judged', () => {
    const history = loaderRow({ key: `coleman:${SEASON}:${synthPath('B')}`, goals: 6, playerId: 12, clubId: 1, status: 'void' });
    const plan = planOk({ stored: [ROW_A(), history] });
    expect(plan.counts).toEqual({ inserted: 0, updated: 0, voided: 0, retained: 1 });
  });

  it('is deterministic: the order of the stored rows does not change the plan', () => {
    const rows = [
      ROW_A({ note: colemanProjectionNote(4, 1) }),
      loaderRow({ key: `coleman:${SEASON}:${synthPath('B')}`, goals: 6, playerId: 12, clubId: 1 }),
      loaderRow({ key: `coleman:${SEASON}:${synthPath('D')}`, goals: 6, playerId: 14, clubId: 2 }),
    ];
    const forward = planColemanProjection(planInput({ stored: rows }));
    const backward = planColemanProjection(planInput({ stored: [...rows].reverse() }));
    expect(backward).toEqual(forward);
  });

  it('the preview is the same plan as plain data (what the compare step shows)', () => {
    const plan = planColemanProjection(planInput({ stored: [ROW_A({ note: colemanProjectionNote(4, 1) })] }));
    expect(previewOfColemanProjection(plan)).toEqual({
      ok: true,
      counts: { inserted: 0, updated: 1, voided: 0, retained: 0 },
      changedCount: 1,
      actions: [{ entityKey: `afltables:${KEY_A}`, action: 'updated', awardWinnerId: 111 }],
    });
    const refused = planColemanProjection(planInput({ stored: [ROW_A({ status: 'void' })] }));
    expect(previewOfColemanProjection(refused)).toEqual(refused);
  });
});

describe('planColemanProjection: refusals, nothing planned (SYNTHETIC)', () => {
  it('a manual (or any other-owner) active Coleman row of the season -> foreign_winner_rows, listing it', () => {
    const manual = ROW_A({ id: 7, sourceKey: 'manual_admin_edit', sourceRecordId: 'award_winner:SYNTHETIC-UUID' });
    const refusal = planRefused({ stored: [manual] });
    expect(refusal.code).toBe('foreign_winner_rows');
    expect(refusal.subjects).toEqual(['#7 manual_admin_edit:award_winner:SYNTHETIC-UUID']);
    expect(refusal.message).toMatch(/nothing was written/);
  });

  it('a legacy (draftguru) row and a row with no source are foreign too', () => {
    expect(planRefused({ stored: [ROW_A({ id: 8, sourceKey: 'draftguru', sourceRecordId: 'legacy-1' })] }).code).toBe('foreign_winner_rows');
    const noSource = planRefused({ stored: [ROW_A({ id: 9, sourceKey: null, sourceRecordId: null })] });
    expect(noSource.code).toBe('foreign_winner_rows');
    expect(noSource.subjects).toEqual(['#9 no source:no key']);
  });

  it('an afltables row under a key that is NOT coleman:<season>: is foreign (another season\'s or family\'s key)', () => {
    const other = ROW_A({ id: 10, sourceRecordId: `coleman:${SEASON + 1}:${synthPath('A')}` });
    expect(planRefused({ stored: [other] }).code).toBe('foreign_winner_rows');
  });

  it('a row of ANOTHER award (or season) that holds a derived key is foreign, never silently adopted', () => {
    expect(planRefused({ stored: [ROW_A({ awardId: 99 })] }).code).toBe('foreign_winner_rows');
    expect(planRefused({ stored: [ROW_A({ season: SEASON + 1 })] }).code).toBe('foreign_winner_rows');
  });

  it('a derived key stored as a VOID row -> derived_row_voided (an administrator\'s decision is not overridden)', () => {
    const refusal = planRefused({ stored: [ROW_A({ id: 12, status: 'void' })] });
    expect(refusal.code).toBe('derived_row_voided');
    expect(refusal.subjects).toEqual([`#12 afltables:${KEY_A}`]);
  });

  it('a row publication would CHANGE that carries a data_overrides row -> admin_override_present', () => {
    const entityKey = `afltables:${KEY_A}`;
    const changing = ROW_A({ id: 13, note: colemanProjectionNote(4, 1) });
    const refusal = planRefused({ stored: [changing], overriddenEntityKeys: new Set([entityKey]) });
    expect(refusal.code).toBe('admin_override_present');
    expect(refusal.subjects).toEqual([`#13 afltables:${KEY_A}`]);

    // ... and one it would VOID.
    const staleKey = `coleman:${SEASON}:${synthPath('B')}`;
    const stale = loaderRow({ key: staleKey, goals: 6, playerId: 12, clubId: 1, id: 14 });
    expect(planRefused({ stored: [ROW_A(), stale], overriddenEntityKeys: new Set([`afltables:${staleKey}`]) }).code)
      .toBe('admin_override_present');
  });

  it('an override on a row publication would leave ALONE is not a conflict (retained)', () => {
    const plan = planOk({ stored: [ROW_A()], overriddenEntityKeys: new Set([`afltables:${KEY_A}`]) });
    expect(plan.planned[0].action).toBe('retained');
  });

  it('a derived winner with no canonical player name -> player_missing (never a source spelling, never blank)', () => {
    const refusal = planRefused({ displayNames: {} });
    expect(refusal.code).toBe('player_missing');
    expect(refusal.subjects[0]).toContain(KEY_A);
    expect(planRefused({ displayNames: { 11: '   ' } }).code).toBe('player_missing');
  });

  it('several kinds at once: player_missing, then foreign, then voided, then override (fix one, run again)', () => {
    const foreign = ROW_A({ id: 20, sourceKey: 'manual_admin_edit', sourceRecordId: 'award_winner:x' });
    const voided = ROW_A({ id: 21, status: 'void' });
    expect(planRefused({ stored: [foreign, voided] }).code).toBe('foreign_winner_rows');
    expect(planRefused({ stored: [voided] }).code).toBe('derived_row_voided');
    expect(planRefused({ displayNames: {}, stored: [foreign] }).code).toBe('player_missing');
  });

  it('caps the listed subjects', () => {
    const many = Array.from({ length: 30 }, (_, index) => ROW_A({ id: 200 + index, sourceKey: 'draftguru', sourceRecordId: `legacy-${index}` }));
    const refusal = planRefused({ stored: many });
    expect(refusal.subjects).toHaveLength(21);
    expect(refusal.subjects[20]).toBe('... and 10 more');
  });

  it('lists the refusal codes (publication codes are unchanged; projection codes are separate)', () => {
    expect([...COLEMAN_PROJECTION_REFUSAL_CODES]).toEqual([
      'projection_unavailable', 'award_definition_missing', 'source_missing', 'player_missing',
      'derived_row_voided', 'admin_override_present', 'foreign_winner_rows',
    ]);
    expect([...COLEMAN_PUBLICATION_REFUSAL_CODES]).toEqual([
      'capability_denied', 'invalid_actor', 'derivation_refused', 'correction_invalid',
      'season_sealed', 'actor_mismatch', 'season_not_sealed',
    ]);
  });
});

/* ------------------------------------------------------------------ *
 * Joint winners (a tie): several keys, each its own row
 * ------------------------------------------------------------------ */

describe('joint winners (SYNTHETIC)', () => {
  it('a four-way tie yields four keys, all inserted; retained ones stay, a missing one is inserted', () => {
    const tied = derive({ playerMatchGoals: tiedFacts() });
    expect(tied.tie).toBe(true);
    expect(tied.winners.map((w) => w.key)).toEqual([KEY_A, KEY_C, KEY_E, KEY_G]);
    const all = planColemanProjection({ ...planInput(), derivation: tied });
    if (!all.ok) throw new Error(all.refusal.message);
    expect(all.counts).toEqual({ inserted: 4, updated: 0, voided: 0, retained: 0 });

    const partial = planColemanProjection({
      ...planInput(),
      derivation: tied,
      stored: [
        loaderRow({ key: KEY_A, goals: 3, playerId: 11, clubId: 1 }),
        loaderRow({ key: KEY_C, goals: 3, playerId: 13, clubId: 2 }),
      ],
    });
    if (!partial.ok) throw new Error(partial.refusal.message);
    expect(partial.counts).toEqual({ inserted: 2, updated: 0, voided: 0, retained: 2 });
  });
});

/** A, C, E and G all total 3 home-and-away goals (A's finals goal never counts). */
function tiedFacts() {
  return synthFacts({ '11:1': 1 });
}

/* ------------------------------------------------------------------ *
 * The publisher's projection port (FAKE executor)
 * ------------------------------------------------------------------ */

interface Call { text: string; inTransaction: boolean }

class FakeTransactional implements TransactionalSqlExecutor {
  readonly calls: Call[] = [];

  committed = 0;

  rolledBack = 0;

  private inTransaction = false;

  constructor(private readonly current: { id: number; input_checksum: string; derivation_version: string; winners: unknown } | null = null) {}

  async query<R extends object>(text: string): Promise<R[]> {
    this.calls.push({ text, inTransaction: this.inTransaction });
    if (/FROM derived_award_results r/.test(text)) return (this.current ? [this.current] : []) as unknown as R[];
    if (/INSERT INTO derived_award_results/.test(text)) return [{ id: 100 }] as unknown as R[];
    return [] as R[];
  }

  async transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    this.inTransaction = true;
    try {
      const result = await work({ query: (text) => this.query(text) });
      this.committed += 1;
      return result;
    } catch (error) {
      this.rolledBack += 1;
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }
}

function emptyProjection(over: Partial<ColemanProjectionResult> = {}): ColemanProjectionResult {
  return {
    projectionId: 9,
    actions: [{ entityKey: `afltables:${KEY_A}`, action: 'inserted', awardWinnerId: 41 }],
    counts: { inserted: 1, updated: 0, voided: 0, retained: 0 },
    changedCount: 1,
    revalidatePaths: ['/awards', '/awards/coleman'],
    ...over,
  };
}

function publishRequest() {
  return { derivation: makeInput(), correction: correction(), publishedBy: 1, viewer: SUPER_ADMIN };
}

describe('publishColemanResult with a projection port (FAKE executor, SYNTHETIC)', () => {
  it('without a port the outcome carries no projection (the Stage 4 ledger-only behaviour)', async () => {
    const executor = new FakeTransactional();
    const outcome = await publishColemanResult(executor, publishRequest());
    expect(outcome).toMatchObject({ ok: true, outcome: 'published', projection: null });
  });

  it('calls the port INSIDE the transaction, AFTER the ledger insert, with the new row id and the audit record', async () => {
    const executor = new FakeTransactional();
    const seen: Array<{ request: ColemanProjectionRequest; ledgerWritten: boolean; inTransaction: boolean }> = [];
    const projection: ColemanProjectionPort = {
      async project(tx, request) {
        await tx.query('SELECT 1 /* port statement */');
        seen.push({
          request,
          ledgerWritten: executor.calls.some((call) => /INSERT INTO derived_award_results/.test(call.text)),
          inTransaction: executor.calls[executor.calls.length - 1].inTransaction,
        });
        return emptyProjection();
      },
    };
    const outcome = await publishColemanResult(executor, publishRequest(), { projection });
    expect(outcome).toMatchObject({ ok: true, outcome: 'published', id: 100, projection: { projectionId: 9, changedCount: 1 } });
    expect(seen).toHaveLength(1);
    expect(seen[0].ledgerWritten).toBe(true);
    expect(seen[0].inTransaction).toBe(true);
    expect(seen[0].request).toMatchObject({
      derivedAwardResultId: 100, ledgerOutcome: 'published', publishedBy: 1,
      audit: { workflow: 'derived_award_publication', actorUserId: 1 },
    });
    expect(seen[0].request.derivation.winners.map((w) => w.key)).toEqual([KEY_A]);
    expect(executor.committed).toBe(1);
    expect(executor.rolledBack).toBe(0);
  });

  it('calls the port for an UNCHANGED ledger outcome too, with the EXISTING row id and no ledger insert', async () => {
    const derivation = derive();
    const executor = new FakeTransactional({
      id: 55, input_checksum: derivation.inputChecksum, derivation_version: derivation.derivationVersion, winners: JSON.parse(JSON.stringify(derivation.winners)),
    });
    const requests: ColemanProjectionRequest[] = [];
    const outcome = await publishColemanResult(executor, publishRequest(), {
      projection: { async project(_tx, request) { requests.push(request); return emptyProjection({ projectionId: null, changedCount: 0 }); } },
    });
    expect(outcome).toMatchObject({ ok: true, outcome: 'unchanged', id: 55, supersededId: null });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ derivedAwardResultId: 55, ledgerOutcome: 'unchanged' });
    expect(executor.calls.some((call) => /INSERT INTO derived_award_results/.test(call.text))).toBe(false);
  });

  it('a port refusal rolls the transaction back and is returned as a typed refusal with its rows', async () => {
    const executor = new FakeTransactional();
    const outcome = await publishColemanResult(executor, publishRequest(), {
      projection: {
        async project() {
          throw new ColemanProjectionRefusal('foreign_winner_rows', 'Refused: SYNTHETIC.', ['#7 manual_admin_edit:x']);
        },
      },
    });
    if (outcome.ok) throw new Error('expected a refusal');
    expect(outcome.refusal).toMatchObject({ code: 'foreign_winner_rows', season: SEASON, subjects: ['#7 manual_admin_edit:x'] });
    expect(executor.rolledBack).toBe(1);
    expect(executor.committed).toBe(0);
    // The ledger insert ran INSIDE the transaction that rolled back.
    expect(executor.calls.some((call) => /INSERT INTO derived_award_results/.test(call.text) && call.inTransaction)).toBe(true);
  });

  it('any other port error propagates (the transaction rolled back), it is never swallowed as a refusal', async () => {
    const executor = new FakeTransactional();
    await expect(publishColemanResult(executor, publishRequest(), {
      projection: { async project() { throw new Error('SYNTHETIC connection reset'); } },
    })).rejects.toThrow('SYNTHETIC connection reset');
    expect(executor.rolledBack).toBe(1);
  });

  it('a request refused before SQL never reaches the port', async () => {
    const executor = new FakeTransactional();
    let called = false;
    const outcome = await publishColemanResult(executor, { ...publishRequest(), correction: null }, {
      projection: { async project() { called = true; return emptyProjection(); } },
    });
    expect(outcome.ok).toBe(false);
    expect(called).toBe(false);
    expect(executor.calls).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Public revalidation
 * ------------------------------------------------------------------ */

describe('/admin/awards/revalidate admits every path a Coleman row can return (SYNTHETIC)', () => {
  it('the award, award-season, season, player, club, awards index and sitemap paths', () => {
    // The same set admin-awards `awardWinnerPaths` builds for a Coleman winner row.
    const paths = ['/awards', awardPath('coleman'), '/sitemap.xml', awardSeasonPath('coleman', 2001), seasonPath(2001),
      playerPath('synthetic-player-a', 1234), clubPath('synthetic-club')];
    for (const path of paths) expect(isAllowedRevalidatePath(path), path).toBe(true);
  });

  it('still refuses anything outside the allowlist (the route is not widened)', () => {
    for (const path of ['/admin/awards', '//evil.example/awards', '/awards/coleman/2001?x=1', '/awards/Coleman', 'https://example.com/awards']) {
      expect(isAllowedRevalidatePath(path), path).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Static proofs about the production port
 * ------------------------------------------------------------------ */

function codeOf(path: string): string {
  const source = readFileSync(join(__dirname, '..', path), 'utf8');
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('src/db/queries/coleman-award-winners.ts static proofs', () => {
  const code = codeOf('src/db/queries/coleman-award-winners.ts');

  it('is server-only and writes through the publisher\'s native transaction only', () => {
    expect(readFileSync(join(__dirname, '..', 'src/db/queries/coleman-award-winners.ts'), 'utf8')).toMatch(/import 'server-only';/);
    expect(code).toMatch(/nativeTransactionOf\(tx\)/);
    expect(code).toMatch(/projection_unavailable/);
    expect(code).not.toMatch(/\bpostgres\(/);
    expect(code).not.toMatch(/process\.env/);
  });

  it('writes exactly award_winners and derived_award_projections (plus data_edits and the span via the existing helpers)', () => {
    const inserted = [...code.matchAll(/INSERT\s+INTO\s+([a-z_]+)/gi)].map((m) => m[1]);
    expect(inserted.sort()).toEqual(['award_winners', 'derived_award_projections']);
    const updated = [...code.matchAll(/UPDATE\s+([a-z_]+)/g)].map((m) => m[1]);
    expect(new Set(updated)).toEqual(new Set(['award_winners']));
    expect(code).toMatch(/recordDataEdit\(native/);
    expect(code).toMatch(/recomputeAwardSpan\(native/);
  });

  it('never deletes, never writes a data_overrides row, never builds SQL from interpolated values', () => {
    expect(/\bDELETE\b|\bTRUNCATE\b|\bDROP\b/i.test(code)).toBe(false);
    expect(code).not.toMatch(/INSERT\s+INTO\s+data_overrides|UPDATE\s+data_overrides/i);
    // Every SQL text is a plain template literal with positional parameters only.
    for (const sql of code.matchAll(/`((?:SELECT|INSERT|UPDATE)[^`]*)`/g)) expect(sql[1], sql[1].slice(0, 40)).not.toContain('${');
    expect(code).not.toMatch(/\.unsafe\(/);
  });

  it('casts ids and counts in SQL (postgres.js returns int8 as a string) and leaves votes as text', () => {
    expect(code).toMatch(/w\.id::int AS id/);
    expect(code).toMatch(/RETURNING id::int AS id/);
    expect(code).toMatch(/w\.votes::text AS votes/);
  });
});
