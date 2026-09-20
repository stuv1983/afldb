/**
 * AFLDB-ISSUE-228 §9.10 — regression coverage for the audit-accounting
 * defect in `tools/current-season/audit-afl-api-brownlow-canonical-equality.ts`.
 *
 * DB-free: `resolvePlayerCached()` is a pure caching primitive with an
 * injected resolver callback, so no postgres client is opened here.
 *
 * Bug this guards against: the audit's per-vote loop cached a provider
 * player id's resolution outcome keyed by `providerPlayerId`, but only
 * pushed an `identityFailures` entry on the FIRST occurrence of a failing
 * id — every later physical vote row for that same still-failing id was
 * silently skipped from the report, so `identityFailures.length` undercounted
 * the true number of failed PHYSICAL rows (42 distinct ids vs. 84 physical
 * rows, for the 2022 season). `resolvePlayerCached()` now caches the
 * RESOLVER CALL only: every caller — including a cached-hit caller — gets
 * the full outcome back, so a caller iterating one row per physical vote can
 * report a failure for every physical row while still never re-querying the
 * resolver for an id it has already resolved.
 */
import { describe, expect, it } from 'vitest';

import { resolvePlayerCached, type PlayerVoteResolution } from '../tools/current-season/audit-afl-api-brownlow-canonical-equality';

describe('resolvePlayerCached (AFLDB-ISSUE-228 audit accounting)', () => {
  it('calls the resolver once for a repeatedly-failing provider id, but returns the failure to every caller', async () => {
    const cache = new Map<string, PlayerVoteResolution>();
    let resolverCalls = 0;
    const resolve = async (): Promise<PlayerVoteResolution> => {
      resolverCalls += 1;
      return { playerId: null, reason: 'unresolved' };
    };

    // Simulate the SAME provider id appearing in three physical vote rows
    // across different matches — exactly the 2022 shape (42 distinct
    // unresolved ids across 84 physical rows: some ids repeat).
    const identityFailures: { providerPlayerId: string; reason: string }[] = [];
    const resolvedRows: { providerPlayerId: string; playerId: number }[] = [];
    const physicalRows = ['CD_M1', 'CD_M2', 'CD_M3'].map((matchId) => ({ matchId, providerPlayerId: 'CD_I_UNRESOLVED' }));

    for (const row of physicalRows) {
      const outcome = await resolvePlayerCached(row.providerPlayerId, cache, resolve);
      if (outcome.playerId === null) {
        identityFailures.push({ providerPlayerId: row.providerPlayerId, reason: outcome.reason });
      } else {
        resolvedRows.push({ providerPlayerId: row.providerPlayerId, playerId: outcome.playerId });
      }
    }

    expect(resolverCalls).toBe(1);
    expect(identityFailures).toHaveLength(3);
    expect(identityFailures.every((f) => f.reason === 'unresolved')).toBe(true);
    expect(resolvedRows).toHaveLength(0);
    // Population arithmetic reconciles at physical-row grain, not distinct-id grain.
    expect(identityFailures.length + resolvedRows.length).toBe(physicalRows.length);
  });

  it('caches a successful resolution too, and keeps distinct provider ids independent', async () => {
    const cache = new Map<string, PlayerVoteResolution>();
    const calls: string[] = [];
    const resolve = async (providerPlayerId: string): Promise<PlayerVoteResolution> => {
      calls.push(providerPlayerId);
      return providerPlayerId === 'CD_I_OK'
        ? { playerId: 501, reason: null }
        : { playerId: null, reason: 'refused: candidateIds=1,2' };
    };

    const first = await resolvePlayerCached('CD_I_OK', cache, resolve);
    const second = await resolvePlayerCached('CD_I_OK', cache, resolve);
    const third = await resolvePlayerCached('CD_I_BAD', cache, resolve);
    const fourth = await resolvePlayerCached('CD_I_BAD', cache, resolve);

    expect(calls).toEqual(['CD_I_OK', 'CD_I_BAD']);
    expect(first).toEqual({ playerId: 501, reason: null });
    expect(second).toEqual({ playerId: 501, reason: null });
    expect(third).toEqual({ playerId: null, reason: 'refused: candidateIds=1,2' });
    expect(fourth).toEqual({ playerId: null, reason: 'refused: candidateIds=1,2' });
  });
});
