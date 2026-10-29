/**
 * AFLDB V2 Stage 4 (plan D6, ADR 0006) — the audited Coleman publisher, UNIT level: every refusal,
 * the pure publication plan, and the exact statements the publisher issues against a FAKE executor.
 * No database, no network, no clock. The same publisher SQL runs for real on in-memory PGlite in
 * tests/v2-coleman-publication-pglite.test.ts.
 *
 * FIXTURES ARE SYNTHETIC (see tests/v2-coleman-publication-fixtures.ts). Nothing here is a real
 * season's result.
 *
 * Owner's required Coleman cases, and where each is covered:
 *   outright winner ........ tests/v2-coleman.test.ts (winners) + here ('publishes an outright winner')
 *   ties ................... tests/v2-coleman.test.ts + here ('a tie publishes every joint winner')
 *   incomplete rounds ...... tests/v2-coleman.test.ts + here (refusal passes through, no SQL)
 *   finals exclusion ....... tests/v2-coleman.test.ts + here ('a finals-only haul never reaches the published winners')
 *   corrected statistics ... tests/v2-coleman.test.ts + here (plan: superseded) + PGlite (supersession row)
 *   idempotent recompute ... tests/v2-coleman.test.ts + here (plan: unchanged) + PGlite (no new row)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { SqlExecutor, TransactionalSqlExecutor } from '@afldb/db';
import { AUDITED_CORRECTION_WORKFLOWS } from '@afldb/domain';
import {
  COLEMAN_DERIVATION_VERSION,
  COLEMAN_PUBLICATION_REFUSAL_CODES,
  checkColemanPublication,
  planColemanPublication,
  publishColemanResult,
  serialiseColemanDerivation,
  type ColemanCurrentPublication,
  type ColemanPublicationRefusalCode,
  type ColemanPublicationRequest,
} from '@afldb/derived';

import {
  ADMIN,
  CONTRIBUTOR,
  CORRECTION_NOTE,
  REGISTRY,
  SEASON,
  SUPER_ADMIN,
  correction,
  derive,
  makeInput,
  synthFacts,
  synthIdentities,
  synthMatches,
  synthPath,
} from './v2-coleman-publication-fixtures';

/* ------------------------------------------------------------------ *
 * A FAKE executor: records every statement, answers the publisher's three statement shapes.
 * ------------------------------------------------------------------ */

interface Call { text: string; params: readonly unknown[]; inTransaction: boolean }

class FakeExecutor implements TransactionalSqlExecutor {
  readonly calls: Call[] = [];

  transactions = 0;

  private inTransaction = false;

  constructor(
    private readonly current: { id: number; input_checksum: string; derivation_version: string; winners: unknown } | null = null,
    private readonly insertError: Error | null = null,
  ) {}

  async query<R extends object>(text: string, params: readonly unknown[] = []): Promise<R[]> {
    this.calls.push({ text, params, inTransaction: this.inTransaction });
    if (/FROM derived_award_results r/.test(text)) return (this.current ? [this.current] : []) as unknown as R[];
    if (/INSERT INTO derived_award_results/.test(text)) {
      if (this.insertError) throw this.insertError;
      return [{ id: 100 }] as unknown as R[];
    }
    return [] as R[];
  }

  async transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    this.transactions += 1;
    this.inTransaction = true;
    try {
      return await work({ query: (text, params) => this.query(text, params) });
    } finally {
      this.inTransaction = false;
    }
  }

  inserts(): Call[] {
    return this.calls.filter((call) => /INSERT INTO derived_award_results/.test(call.text));
  }
}

function request(over: Partial<ColemanPublicationRequest> = {}): ColemanPublicationRequest {
  return { derivation: makeInput(), correction: correction(), publishedBy: 1, viewer: SUPER_ADMIN, ...over };
}

async function expectRefusal(over: Partial<ColemanPublicationRequest>, code: ColemanPublicationRefusalCode) {
  const executor = new FakeExecutor();
  const outcome = await publishColemanResult(executor, request(over));
  if (outcome.ok) throw new Error(`expected refusal ${code}, got ${outcome.outcome}`);
  expect(outcome.refusal.code).toBe(code);
  // A refusal happens before ANY statement: no transaction, no lock, no read, no write.
  expect(executor.transactions).toBe(0);
  expect(executor.calls).toEqual([]);
  return outcome.refusal;
}

/* ------------------------------------------------------------------ *
 * Refusals (typed, before any write)
 * ------------------------------------------------------------------ */

describe('publishColemanResult refusals: typed, and before any SQL (SYNTHETIC)', () => {
  it('lists the refusal codes', () => {
    expect([...COLEMAN_PUBLICATION_REFUSAL_CODES]).toEqual([
      'capability_denied', 'invalid_actor', 'derivation_refused', 'correction_invalid',
      'season_sealed', 'actor_mismatch', 'season_not_sealed',
    ]);
  });

  it('adds exactly one workflow id to the closed list, and the publisher requires it', () => {
    expect((AUDITED_CORRECTION_WORKFLOWS as readonly string[]).filter((w) => w === 'derived_award_publication')).toHaveLength(1);
  });

  it('refuses an incomplete (in-progress) season: the derivation refusal passes through', async () => {
    const inProgress = REGISTRY.in_progress_seasons[0];
    const refusal = await expectRefusal({
      derivation: makeInput({ season: inProgress, matches: synthMatches().map((m) => ({ ...m, season: inProgress })) }),
    }, 'derivation_refused');
    expect(refusal.derivation?.code).toBe('season_not_complete');
    expect(refusal.season).toBe(inProgress);
  });

  it('refuses a season that is not attested as settled', async () => {
    const refusal = await expectRefusal(
      { derivation: makeInput({ seasonState: { registry: REGISTRY, settled: false } }) },
      'derivation_refused',
    );
    expect(refusal.derivation?.code).toBe('season_not_settled');
  });

  it('refuses incomplete rounds (a club with no goal rows in a home-and-away match)', async () => {
    const facts = synthFacts().filter((f) => !(f.matchId === 2 && f.clubId === 4));
    const refusal = await expectRefusal({ derivation: makeInput({ playerMatchGoals: facts }) }, 'derivation_refused');
    expect(refusal.derivation?.code).toBe('incomplete_rounds');
  });

  it('refuses NULL goals: not recorded is never published as zero', async () => {
    const refusal = await expectRefusal({ derivation: makeInput({ playerMatchGoals: synthFacts({ '11:1': null }) }) }, 'derivation_refused');
    expect(refusal.derivation?.code).toBe('goals_not_recorded');
  });

  it('refuses a missing correction: a publication is a write to sealed history', async () => {
    const refusal = await expectRefusal({ correction: null }, 'season_sealed');
    expect(refusal.message).toMatch(/sealed historical data/);
  });

  it('refuses an invalid correction (short note, empty evidence, bad actor id inside the correction)', async () => {
    await expectRefusal({ correction: correction({ note: 'too short' }) }, 'correction_invalid');
    await expectRefusal({ correction: correction({ evidenceRef: '   ' }) }, 'correction_invalid');
    await expectRefusal({ correction: correction({ actorUserId: 0 }) }, 'correction_invalid');
  });

  it('refuses a correction that names another workflow, even a valid one', async () => {
    const refusal = await expectRefusal({ correction: correction({ workflow: 'data_editor' }) }, 'correction_invalid');
    expect(refusal.message).toContain("'derived_award_publication'");
  });

  it('refuses a publishedBy that is not a positive integer', async () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expectRefusal({ publishedBy: bad }, 'invalid_actor');
    }
  });

  it('refuses a publishedBy that differs from the correction actor', async () => {
    await expectRefusal({ publishedBy: 2, correction: correction({ actorUserId: 1 }) }, 'actor_mismatch');
  });

  it('refuses without data.awards.edit: only a super admin may publish', async () => {
    await expectRefusal({ viewer: ADMIN }, 'capability_denied');
    await expectRefusal({ viewer: CONTRIBUTOR }, 'capability_denied');
    await expectRefusal({ viewer: { role: 'admin', canManageAdmins: true } }, 'capability_denied');
  });

  it('checks the capability first: a forbidden viewer learns nothing about the derivation', async () => {
    const refusal = await expectRefusal({
      viewer: CONTRIBUTOR,
      derivation: makeInput({ seasonState: { registry: REGISTRY, settled: false } }),
      correction: null,
      publishedBy: 0,
    }, 'capability_denied');
    expect(refusal.derivation).toBeUndefined();
  });

  it('checkColemanPublication is pure: a valid request passes with the seal audit record', () => {
    const gate = checkColemanPublication(request());
    if (!gate.ok) throw new Error(gate.refusal.message);
    expect(gate.audit).toEqual({
      season: SEASON, workflow: 'derived_award_publication', actorUserId: 1, note: CORRECTION_NOTE, evidenceRef: 'SYNTHETIC-EVIDENCE-1',
    });
    expect(gate.derivation.season).toBe(SEASON);
  });
});

/* ------------------------------------------------------------------ *
 * The pure plan
 * ------------------------------------------------------------------ */

function currentOf(derivation = derive(), id = 7): ColemanCurrentPublication {
  return {
    id,
    inputChecksum: derivation.inputChecksum,
    derivationVersion: derivation.derivationVersion,
    winners: JSON.parse(JSON.stringify(derivation.winners)),
  };
}

describe('planColemanPublication (SYNTHETIC)', () => {
  it('no current row -> published', () => {
    expect(planColemanPublication(null, derive())).toEqual({ outcome: 'published', supersedesId: null });
  });

  it('the same inputs, version and winners -> unchanged (an idempotent recompute), whatever derivedAt says', () => {
    const first = derive();
    const later = derive({ derivedAt: '2027-02-03T04:05:06Z' });
    expect(later.derivedAt).not.toBe(first.derivedAt);
    expect(planColemanPublication(currentOf(first), later)).toEqual({ outcome: 'unchanged', currentId: 7 });
  });

  it('input row order does not matter: a shuffled recompute is unchanged', () => {
    const first = derive();
    const reversed = derive({
      matches: [...synthMatches()].reverse(),
      playerMatchGoals: [...synthFacts()].reverse(),
      identities: [...synthIdentities()].reverse(),
    });
    expect(planColemanPublication(currentOf(first), reversed).outcome).toBe('unchanged');
  });

  it('a corrected statistic -> superseded, naming the current row (even when the winners are unchanged)', () => {
    const before = derive();
    const minor = derive({ playerMatchGoals: synthFacts({ '16:3': 2 }) });
    expect(minor.winners).toEqual(before.winners);
    expect(planColemanPublication(currentOf(before, 12), minor)).toEqual({ outcome: 'superseded', supersedesId: 12 });
    const major = derive({ playerMatchGoals: synthFacts({ '11:3': 0 }) });
    expect(major.winners).not.toEqual(before.winners);
    expect(planColemanPublication(currentOf(before, 12), major)).toEqual({ outcome: 'superseded', supersedesId: 12 });
  });

  it('a new derivation version -> superseded, even with identical inputs and winners', () => {
    const older = derive({ derivationVersion: 'v2.coleman.0' });
    const now = derive();
    expect(now.inputChecksum).toBe(older.inputChecksum);
    expect(planColemanPublication(currentOf(older), now).outcome).toBe('superseded');
  });

  it('the same checksum and version but different stored winners -> superseded (never trusted as unchanged)', () => {
    const now = derive();
    const tampered = { ...currentOf(now), winners: [] };
    expect(planColemanPublication(tampered, now).outcome).toBe('superseded');
  });
});

/* ------------------------------------------------------------------ *
 * The statements the publisher issues (FAKE executor)
 * ------------------------------------------------------------------ */

describe('publishColemanResult statements (FAKE executor, SYNTHETIC)', () => {
  it('publishes an outright winner in ONE transaction: lock, read current, insert', async () => {
    const executor = new FakeExecutor();
    const outcome = await publishColemanResult(executor, request());
    if (!outcome.ok) throw new Error(outcome.refusal.message);
    expect(outcome).toMatchObject({ outcome: 'published', id: 100, supersededId: null, season: SEASON });
    expect(outcome.winnerKeys).toEqual([`coleman:${SEASON}:${synthPath('A')}`]);
    expect(executor.transactions).toBe(1);
    expect(executor.calls.every((c) => c.inTransaction)).toBe(true);
    expect(executor.calls).toHaveLength(3);
    expect(executor.calls[0].text).toMatch(/^SELECT pg_advisory_xact_lock\(hashtext\(\$1\), \$2::int\)/);
    expect(executor.calls[1].text).toMatch(/^\s*SELECT r\.id::int AS id[\s\S]*NOT EXISTS/);
    expect(executor.calls[2].text).toMatch(/^\s*INSERT INTO derived_award_results/);
  });

  it('records the versions, checksum, derivedAt, actor, basis, audit record and the full result', async () => {
    const executor = new FakeExecutor();
    await publishColemanResult(executor, request());
    const [insert] = executor.inserts();
    const derivation = derive();
    const p = insert.params;
    expect(p[0]).toBe('coleman');
    expect(p[1]).toBe(SEASON);
    expect(p[2]).toBe(derivation.methodVersion);
    expect(p[3]).toBe(COLEMAN_DERIVATION_VERSION);
    expect(p[4]).toBe(derivation.inputChecksum);
    expect(p[4]).toMatch(/^[0-9a-f]{64}$/);
    expect(p[5]).toBe(serialiseColemanDerivation(derivation));
    expect(JSON.parse(p[6] as string)).toEqual(JSON.parse(JSON.stringify(derivation.winners)));
    expect(p[7]).toBe(derivation.derivedAt);
    expect(p[8]).toBe(1);
    expect(JSON.parse(p[9] as string)).toEqual({
      season: SEASON, workflow: 'derived_award_publication', actorUserId: 1, note: CORRECTION_NOTE, evidenceRef: 'SYNTHETIC-EVIDENCE-1',
    });
    expect(p[10]).toBeNull();
    expect(insert.text).toContain("'audited_correction'");
  });

  it('a tie publishes every joint winner, ordered by profile path', async () => {
    const executor = new FakeExecutor();
    const outcome = await publishColemanResult(executor, request({ derivation: makeInput({ playerMatchGoals: synthFacts({ '12:1': 4 }) }) }));
    if (!outcome.ok) throw new Error(outcome.refusal.message);
    expect(outcome.winnerKeys).toEqual([`coleman:${SEASON}:${synthPath('A')}`, `coleman:${SEASON}:${synthPath('B')}`]);
    const winners = JSON.parse(executor.inserts()[0].params[6] as string) as { goals: number }[];
    expect(winners).toHaveLength(2);
    expect(winners.map((w) => w.goals)).toEqual([5, 5]);
  });

  it('a finals-only haul never reaches the published winners or the stored totals', async () => {
    const executor = new FakeExecutor();
    await publishColemanResult(executor, request({ derivation: makeInput({ playerMatchGoals: synthFacts({ '14:5': 9 }) }) }));
    const [insert] = executor.inserts();
    const winners = JSON.parse(insert.params[6] as string) as { playerId: string }[];
    expect(winners.map((w) => w.playerId)).toEqual(['11']);
    const result = JSON.parse(insert.params[5] as string) as { leaderboard: { playerId: string; goals: number }[] };
    expect(result.leaderboard.find((e) => e.playerId === '14')?.goals).toBe(2);
  });

  it('an identical recompute writes NOTHING (unchanged) and returns the existing row id', async () => {
    const stored = derive();
    const executor = new FakeExecutor({
      id: 7, input_checksum: stored.inputChecksum, derivation_version: stored.derivationVersion,
      winners: JSON.parse(JSON.stringify(stored.winners)),
    });
    const outcome = await publishColemanResult(executor, request({ derivation: makeInput({ derivedAt: '2027-01-01T00:00:00Z' }) }));
    if (!outcome.ok) throw new Error(outcome.refusal.message);
    expect(outcome).toMatchObject({ outcome: 'unchanged', id: 7, supersededId: null });
    expect(executor.inserts()).toEqual([]);
  });

  it('a corrected statistic inserts a NEW row that names the current one', async () => {
    const stored = derive();
    const executor = new FakeExecutor({
      id: 7, input_checksum: stored.inputChecksum, derivation_version: stored.derivationVersion,
      winners: JSON.stringify(stored.winners),
    });
    const outcome = await publishColemanResult(executor, request({ derivation: makeInput({ playerMatchGoals: synthFacts({ '11:3': 0 }) }) }));
    if (!outcome.ok) throw new Error(outcome.refusal.message);
    expect(outcome).toMatchObject({ outcome: 'superseded', id: 100, supersededId: 7 });
    expect(executor.inserts()).toHaveLength(1);
    expect(executor.inserts()[0].params[10]).toBe(7);
  });

  it('accepts the stored winners as JSON text as well as a parsed value (driver difference)', async () => {
    const stored = derive();
    const executor = new FakeExecutor({
      id: 7, input_checksum: stored.inputChecksum, derivation_version: stored.derivationVersion,
      winners: JSON.stringify(stored.winners),
    });
    const outcome = await publishColemanResult(executor, request());
    expect(outcome).toMatchObject({ ok: true, outcome: 'unchanged' });
  });

  it('a SQL error propagates (the transaction callback rejects, so nothing commits)', async () => {
    const executor = new FakeExecutor(null, new Error('boom: forced insert failure'));
    await expect(publishColemanResult(executor, request())).rejects.toThrow(/forced insert failure/);
    expect(executor.transactions).toBe(1);
  });

  it('more than one current row is a broken chain and is refused loudly', async () => {
    const stored = derive();
    const executor = new FakeExecutor();
    const rows = [
      { id: 1, input_checksum: stored.inputChecksum, derivation_version: stored.derivationVersion, winners: [] },
      { id: 2, input_checksum: stored.inputChecksum, derivation_version: stored.derivationVersion, winners: [] },
    ];
    const original = executor.query.bind(executor);
    executor.query = (async (text: string, params: readonly unknown[] = []) => (
      /FROM derived_award_results r/.test(text) ? rows : original(text, params)
    )) as typeof executor.query;
    await expect(publishColemanResult(executor, request())).rejects.toThrow(/supersession chain is broken/);
  });
});

/* ------------------------------------------------------------------ *
 * Static proofs about the module
 * ------------------------------------------------------------------ */

function codeOf(path: string): string {
  const source = readFileSync(join(__dirname, '..', path), 'utf8');
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('coleman-publication.ts static proofs', () => {
  const code = codeOf('packages/derived/src/coleman-publication.ts');

  it('does no network, file, process, clock or connection I/O', () => {
    const specifiers = [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(specifiers.sort()).toEqual(['./coleman', '@/lib/auth/capabilities', '@afldb/db', '@afldb/domain']);
    for (const banned of [/\bfetch\s*\(/, /\bDate\.now\b/, /\bnew Date\b/, /\bprocess\./, /\brequire\s*\(/, /\bimport\s*\(/,
      /node:(fs|http|https|net|child_process|dns)/, /\bpostgres\b/, /server-only/, /XMLHttpRequest/, /WebSocket/]) {
      expect(banned.test(code), String(banned)).toBe(false);
    }
  });

  it('writes only derived_award_results: never award_winners, never an UPDATE or DELETE', () => {
    expect(/\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b/i.test(code)).toBe(false);
    expect(code).not.toMatch(/award_winners/);
    const written = [...code.matchAll(/INSERT\s+INTO\s+([a-z_]+)/gi)].map((m) => m[1]);
    expect(written).toEqual(['derived_award_results']);
  });

  it('runs its statements inside executor.transaction and is the only caller of the seal and capability', () => {
    expect(code).toMatch(/executor\.transaction\(/);
    expect(code).toMatch(/evaluateSeasonWrite\(/);
    expect(code).toMatch(/hasCapability\(viewer, COLEMAN_PUBLICATION_CAPABILITY\)/);
    // No statement is issued on the outer executor, only on the transaction handle.
    expect(code).not.toMatch(/\bexecutor\.query\(/);
  });
});
