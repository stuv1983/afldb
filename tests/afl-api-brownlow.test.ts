/**
 * AFLDB-ISSUE-228 S7 (§10) — DB-free coverage for the Brownlow settle engine's
 * pure pieces: the round-translation entry point, the enable-flag guard, and
 * the leaderboard reconciliation wrapper's advisory/blocking classification.
 *
 * Match/player resolution and the atomic vote-set apply itself need a real
 * `matches`/`external_identities`/`brownlow_round_votes` database and are
 * exercised by the operator against the Brownlow simulator and `afldb_test`
 * (see the S7 handoff report); nothing here opens a database connection.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  BROWNLOW_ENABLE_ENV,
  emptyAflApiBrownlowCounters,
  isAflApiBrownlowEnabled,
  reconcileAflApiBrownlowSeason,
  requireAflApiBrownlowBacktestDatabase,
} from '@/lib/acquisition/afl-api-brownlow';
import { AflRoundTranslationError, translateAflApiBrownlowRound } from '@/lib/acquisition/afl-api-rounds';
import { parseSourceFamilyRegistry } from '@/lib/acquisition/source-families';

const root = join(__dirname, '..');
const registry = parseSourceFamilyRegistry(
  JSON.parse(readFileSync(join(root, 'data', 'reference', 'source-families.json'), 'utf8')),
);

function refusalCode(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof AflRoundTranslationError) return e.code;
    throw e;
  }
  throw new Error('expected translateAflApiBrownlowRound to refuse, but it returned a value');
}

describe('translateAflApiBrownlowRound (AFLDB-ISSUE-228 §6.4, §10)', () => {
  it('translates an Opening Round vote to canonical round 1 (2026)', () => {
    expect(translateAflApiBrownlowRound(registry, 2026, 0)).toEqual({
      roundCode: '1', roundNumber: 1, roundType: 'home_and_away', isFinal: false,
    });
  });

  it('translates the last home-and-away round (2026 Round 24 -> canonical 25)', () => {
    expect(translateAflApiBrownlowRound(registry, 2026, 24)).toEqual({
      roundCode: '25', roundNumber: 25, roundType: 'home_and_away', isFinal: false,
    });
  });

  it('translates a season with no Opening Round unchanged (2022 Round 1 -> canonical 1)', () => {
    expect(translateAflApiBrownlowRound(registry, 2022, 1)).toEqual({
      roundCode: '1', roundNumber: 1, roundType: 'home_and_away', isFinal: false,
    });
  });

  it('refuses a finals round defensively even though the feed never publishes one (§10)', () => {
    expect(refusalCode(() => translateAflApiBrownlowRound(registry, 2026, 25))) // Wildcard Finals
      .toBe('brownlow_round_not_home_and_away');
    expect(refusalCode(() => translateAflApiBrownlowRound(registry, 2026, 29))) // Grand Final
      .toBe('brownlow_round_not_home_and_away');
  });

  it('refuses an api_round_number the declared vocabulary does not carry', () => {
    expect(refusalCode(() => translateAflApiBrownlowRound(registry, 2026, 999))).toBe('round_unmapped');
  });

  it('refuses a season with no declared vocabulary at all', () => {
    expect(refusalCode(() => translateAflApiBrownlowRound(registry, 1897, 1))).toBe('round_vocabulary_missing');
  });
});

describe('emptyAflApiBrownlowCounters (AFLDB-ISSUE-228 S7 round-selection correction, 2026-09-20)', () => {
  it('carries voteSetsRescheduledRound — the observability counter for a legitimate reschedule '
    + '(providerTranslatedRound != canonicalRoundNumber), never silently folded into voteSetsPlanned', () => {
    expect(emptyAflApiBrownlowCounters().voteSetsRescheduledRound).toBe(0);
  });
});

describe('isAflApiBrownlowEnabled (AFLDB-ISSUE-228 §10 "Operational enablement")', () => {
  it('defaults to disabled', () => {
    expect(isAflApiBrownlowEnabled({})).toBe(false);
  });

  it('is disabled for anything other than the literal string "true"', () => {
    expect(isAflApiBrownlowEnabled({ [BROWNLOW_ENABLE_ENV]: '1' })).toBe(false);
    expect(isAflApiBrownlowEnabled({ [BROWNLOW_ENABLE_ENV]: 'TRUE' })).toBe(false);
    expect(isAflApiBrownlowEnabled({ [BROWNLOW_ENABLE_ENV]: 'yes' })).toBe(false);
  });

  it('is enabled only when explicitly set to "true"', () => {
    expect(isAflApiBrownlowEnabled({ [BROWNLOW_ENABLE_ENV]: 'true' })).toBe(true);
  });
});

describe('requireAflApiBrownlowBacktestDatabase (AFLDB-ISSUE-228 §10 follow-up: completed-season backtest)', () => {
  /** A minimal stand-in for `postgres.Sql`: called as a tagged template,
   * returning whatever `SELECT current_database() AS name` would. No real
   * connection is opened — this is exactly item #9 of the backtest test
   * plan ("test the guard/parser/helper directly", not a real non-afldb_test
   * database). */
  function fakeSql(name: string): postgres.Sql {
    return (async () => [{ name }]) as unknown as postgres.Sql;
  }

  it('grants the authority when the live connection reports afldb_test', async () => {
    const authority = await requireAflApiBrownlowBacktestDatabase(fakeSql('afldb_test'));
    expect(authority).toEqual({ kind: 'allow-completed-season-backtest', verifiedDatabase: 'afldb_test' });
  });

  it('hard refuses for afldb_dev — never trusting anything but the live current_database() read', async () => {
    await expect(requireAflApiBrownlowBacktestDatabase(fakeSql('afldb_dev'))).rejects.toThrow(/afldb_dev/);
  });

  it('hard refuses for production', async () => {
    await expect(requireAflApiBrownlowBacktestDatabase(fakeSql('afldb_prod'))).rejects.toThrow(/afldb_prod/);
  });

  it('hard refuses for any other database name, never partial-matching "afldb_test"', async () => {
    await expect(requireAflApiBrownlowBacktestDatabase(fakeSql('afldb_test_old'))).rejects.toThrow(/afldb_test_old/);
  });
});

describe('reconcileAflApiBrownlowSeason (AFLDB-ISSUE-228 §10 reconciliation)', () => {
  const matchVotes = [
    {
      providerMatchId: 'CD_M1', apiRoundNumber: 0,
      votes: [
        { providerPlayerId: 'CD_I1', providerTeamId: 'CD_T10', votes: 3, eligible: true },
        { providerPlayerId: 'CD_I2', providerTeamId: 'CD_T20', votes: 2, eligible: true },
        { providerPlayerId: 'CD_I3', providerTeamId: 'CD_T10', votes: 1, eligible: true },
      ],
    },
  ];

  it('is advisory (never blocking) while the count is still in progress', () => {
    const leaderboard = [
      {
        providerPlayerId: 'CD_I1', providerTeamId: 'CD_T10', votes: 99, eligible: true, winner: false,
        leader: false, roundVotes: [],
      },
    ];
    const result = reconcileAflApiBrownlowSeason(matchVotes, leaderboard, null);
    expect(result.mismatches).toHaveLength(1);
    expect(result.blocking).toBe(false);
  });

  it('blocks once the leaderboard itself reports the count concluded', () => {
    const leaderboard = [
      {
        providerPlayerId: 'CD_I1', providerTeamId: 'CD_T10', votes: 99, eligible: true, winner: false,
        leader: false, roundVotes: [],
      },
    ];
    const result = reconcileAflApiBrownlowSeason(matchVotes, leaderboard, 'CONCLUDED');
    expect(result.mismatches).toHaveLength(1);
    expect(result.blocking).toBe(true);
  });

  it('reports zero mismatches, never blocking, when totals reconcile exactly', () => {
    const leaderboard = [
      {
        providerPlayerId: 'CD_I1', providerTeamId: 'CD_T10', votes: 3, eligible: true, winner: false,
        leader: false, roundVotes: [],
      },
    ];
    const result = reconcileAflApiBrownlowSeason(matchVotes, leaderboard, 'CONCLUDED');
    expect(result.mismatches).toHaveLength(0);
    expect(result.blocking).toBe(false);
    expect(result.compared).toBe(1);
  });
});
