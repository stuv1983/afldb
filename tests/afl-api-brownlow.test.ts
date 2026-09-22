/**
 * AFLDB-ISSUE-228 S7 (§10) — DB-free coverage for the Brownlow settle engine's
 * pure pieces: the round-translation entry point, the enable-flag guard, and
 * the leaderboard reconciliation wrapper's advisory/blocking classification.
 * AFLDB-ISSUE-244 I244-F007 added `proposedBrownlowMatchId()` and the exported
 * `unitInputFor()` below — both pure/synchronous, so their match_id proposal
 * decision is covered here too, as are the two pure decisions the F007 repair
 * added to the atomic apply: `brownlowMatchIdentityConflicts()` (the
 * pre-write `match_identity_conflict` preflight) and
 * `planBrownlowPositiveSlotReleases()` (the two-phase vote-permutation plan).
 *
 * Match/player resolution and the atomic vote-set apply itself need a real
 * `matches`/`external_identities`/`brownlow_round_votes` database and are
 * exercised by the operator against the Brownlow simulator and `afldb_test`
 * (see the S7 handoff report); nothing here opens a database connection.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type postgres from 'postgres';
import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';

import {
  AflApiBrownlowFixtureIdentityRequiredError,
  BROWNLOW_ENABLE_ENV,
  BROWNLOW_MATCH_IDENTITY_CONFLICT,
  assessAflApiBrownlowMatchIdentityCoverage,
  brownlowMatchIdentityConflicts,
  describeAflApiBrownlowFixtureIdentityRequirement,
  emptyAflApiBrownlowCounters,
  isAflApiBrownlowEnabled,
  planBrownlowPositiveSlotReleases,
  proposedBrownlowMatchId,
  reconcileAflApiBrownlowSeason,
  requireAflApiBrownlowBacktestDatabase,
  unitInputFor,
  type AflApiBrownlowMatchSetPlan,
  type AflApiFixtureIdentityFallback,
  type BrownlowExistingSetRow,
} from '@/lib/acquisition/afl-api-brownlow';
import { asImportBatchId } from '@/lib/import-batch-id';
import { resolveAflApiMatchViaFixtureObservation } from '@/lib/acquisition/afl-api-fixture-identity';
import { parseAflApiIdentities, type AflApiBrownlowMatchVoteRecord } from '@/lib/acquisition/afl-api-bundle';
import { AflRoundTranslationError, translateAflApiBrownlowRound } from '@/lib/acquisition/afl-api-rounds';
import { parseSourceFamilyRegistry } from '@/lib/acquisition/source-families';

// I244-F006: only the fixture-observation RESOLVER is replaced (its own SQL and
// bundle re-emission are covered by the integration suites); every other export
// of the module stays real. The Brownlow identity-coverage logic under test is
// the real production code.
vi.mock('@/lib/acquisition/afl-api-fixture-identity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/acquisition/afl-api-fixture-identity')>()),
  resolveAflApiMatchViaFixtureObservation: vi.fn(),
}));

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

  it('carries staleRecipientsDemoted — AFLDB-ISSUE-244 I244-F002\'s count of replaced recipients demoted to 0, starting at 0', () => {
    expect(emptyAflApiBrownlowCounters().staleRecipientsDemoted).toBe(0);
  });

  it('carries coverageRecomputeRuns — AFLDB-ISSUE-244 I244-F007\'s count of committed-transaction coverage recomputes, starting at 0', () => {
    expect(emptyAflApiBrownlowCounters().coverageRecomputeRuns).toBe(0);
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

describe('Brownlow match-identity coverage (AFLDB-ISSUE-244 I244-F006)', () => {
  // A stand-in for `postgres.Sql` that answers only the three SELECTs the
  // coverage assessment issues (source id, typed staging row by provider match
  // id, canonical round). Anything else throws, so the assessment is proven
  // SELECT-only and free of any other query.
  const TYPED_ROW = {
    season: 2026, roundCode: '5', matchDate: '2026-04-11', homeClubId: 1, awayClubId: 2, isFinal: false,
  };
  function identitySql(typedProviderIds: readonly string[]): postgres.Sql {
    return (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?');
      if (/FROM sources\s+WHERE key = 'afl_api'/.test(text)) return [{ id: 7 }];
      if (/FROM staging\.afl_api_match/.test(text)) return typedProviderIds.includes(String(values[1])) ? [TYPED_ROW] : [];
      if (/round_number AS "roundNumber" FROM matches/.test(text)) return [{ roundNumber: 5 }];
      throw new Error(`unexpected query in the identity-coverage stub: ${text}`);
    }) as unknown as postgres.Sql;
  }

  const fallback: AflApiFixtureIdentityFallback = {
    registry,
    identities: parseAflApiIdentities(
      JSON.parse(readFileSync(join(root, 'data', 'reference', 'afl-api-identities.json'), 'utf8')),
    ),
  };

  const voteSet = (providerMatchId: string): AflApiBrownlowMatchVoteRecord => ({
    providerMatchId,
    apiRoundNumber: 5,
    votes: [
      { providerPlayerId: 'CD_I1', providerTeamId: 'CD_T10', votes: 3, eligible: true },
      { providerPlayerId: 'CD_I2', providerTeamId: 'CD_T20', votes: 2, eligible: true },
      { providerPlayerId: 'CD_I3', providerTeamId: 'CD_T10', votes: 1, eligible: true },
    ],
  });

  const resolveViaFixture = vi.mocked(resolveAflApiMatchViaFixtureObservation);
  beforeEach(() => {
    resolveViaFixture.mockReset();
    resolveViaFixture.mockImplementation(async (_sql, _sourceId, providerMatchId) => (
      providerMatchId === 'CD_M_CORROBORATED'
        ? { outcome: 'resolved', matchId: 9001, isFinal: false, season: 2026 }
        : { outcome: 'refused', reason: 'no_fixture_observation' }
    ));
  });

  it('separates typed-identity, fixture-identity-only and unresolvable vote sets from the vote sets themselves, not from row counts', async () => {
    const coverage = await assessAflApiBrownlowMatchIdentityCoverage(
      identitySql(['CD_M_TYPED']),
      [voteSet('CD_M_TYPED'), voteSet('CD_M_CORROBORATED'), voteSet('CD_M_NO_OBSERVATION')],
      fallback,
    );

    expect(coverage).toEqual({
      voteSetsChecked: 3,
      withStagedIdentity: 1,
      fixtureIdentityRequired: ['CD_M_CORROBORATED'],
      unresolvableEvenWithFixtureIdentity: 1,
    });
  });

  it('never consults the fixture-identity resolver for a vote set that already has a typed staging identity', async () => {
    const coverage = await assessAflApiBrownlowMatchIdentityCoverage(
      identitySql(['CD_M_A', 'CD_M_B']), [voteSet('CD_M_A'), voteSet('CD_M_B')], fallback,
    );

    expect(coverage.fixtureIdentityRequired).toEqual([]);
    expect(coverage.withStagedIdentity).toBe(2);
    expect(resolveViaFixture).not.toHaveBeenCalled();
  });

  it('a snapshot in which every match corroborates a foreign-owned match (no typed rows at all) is entirely fixture-identity-only', async () => {
    const coverage = await assessAflApiBrownlowMatchIdentityCoverage(
      identitySql([]), [voteSet('CD_M_CORROBORATED')], fallback,
    );

    expect(coverage.withStagedIdentity).toBe(0);
    expect(coverage.fixtureIdentityRequired).toEqual(['CD_M_CORROBORATED']);
  });

  it('counts an ambiguous fixture resolution as unresolvable, never as fixture-resolvable', async () => {
    resolveViaFixture.mockResolvedValue({ outcome: 'refused', reason: 'fixture_identity_ambiguous' });

    const coverage = await assessAflApiBrownlowMatchIdentityCoverage(
      identitySql([]), [voteSet('CD_M_CORROBORATED')], fallback,
    );

    expect(coverage.fixtureIdentityRequired).toEqual([]);
    expect(coverage.unresolvableEvenWithFixtureIdentity).toBe(1);
  });

  describe('the operator-facing refusal', () => {
    const many = Array.from({ length: 15 }, (_, i) => `CD_M_${String(i + 1).padStart(2, '0')}`);
    const coverage = {
      voteSetsChecked: 20, withStagedIdentity: 4, fixtureIdentityRequired: many, unresolvableEvenWithFixtureIdentity: 1,
    };

    it('names the exact flag, the counts and a bounded sample of provider match ids', () => {
      const error = new AflApiBrownlowFixtureIdentityRequiredError('apply', coverage);

      expect(error.message).toContain('--use-fixture-identity');
      expect(error.message).toContain('15 of 20 Brownlow vote set(s)');
      expect(error.message).toContain('CD_M_01');
      expect(error.message).toContain('CD_M_10');
      expect(error.message).not.toContain('CD_M_11');
      expect(error.message).toContain('(+5 more)');
      expect(error.message).toContain('refused before any write');
      expect(error.mode).toBe('apply');
    });

    it('explains the absence as by-design rather than as an incomplete-staging defect, and never enables the flag itself', () => {
      const text = describeAflApiBrownlowFixtureIdentityRequirement(coverage);
      const refusal = new AflApiBrownlowFixtureIdentityRequiredError('dry-run', coverage).message;

      expect(text).toContain('expected by design');
      expect(text).toContain('foreign-owned');
      expect(text).not.toMatch(/incomplete/i);
      expect(refusal).toContain('never enabled automatically');
    });
  });
});

/**
 * AFLDB-ISSUE-244 I244-F007 — DB-free coverage for the pure match_id proposal
 * decision (`proposedBrownlowMatchId()`) and its wiring into the actual
 * canonical proposal (`unitInputFor()`). Both functions open no connection
 * and await nothing, unlike match/player resolution and the atomic apply
 * itself (`applyAflApiBrownlowVoteSet()`, `planAflApiBrownlowMatchSet()`),
 * which still need `afldb_test` and stay in
 * `tests/integration/settle-afl-api-brownlow.test.ts` — this file's own
 * header names that boundary and F007 does not move it.
 */
describe('proposedBrownlowMatchId (AFLDB-ISSUE-244 I244-F007)', () => {
  const RESOLVED = 9001;

  // A + B: `proposedBrownlowMatchId()` takes only the resolved match id and
  // whatever the row currently carries — it has no notion of HOW the resolved
  // id was obtained. A staged-identity resolution and a `--use-fixture-identity`
  // resolution both terminate in `AflApiBrownlowMatchSetPlan.matchId`
  // (`planAflApiBrownlowMatchSet()`, same field, same type, no separate
  // branch — see the `AflApiBrownlowMatchSetPlan` type itself), so one
  // function proves both paths carry their resolved id into the proposal
  // identically; there is no second implementation to diverge.
  it('A/B — a brand-new row (no existing brownlow_round_votes row) proposes the resolved match_id, '
    + 'regardless of whether that id came from staged identity or the --use-fixture-identity fallback', () => {
    expect(proposedBrownlowMatchId(RESOLVED, null)).toBe(RESOLVED);
    expect(proposedBrownlowMatchId(RESOLVED, undefined)).toBe(RESOLVED);
  });

  it('D — an existing row with match_id IS NULL (a pre-F007 row) heals to the resolved match_id', () => {
    expect(proposedBrownlowMatchId(RESOLVED, null)).toBe(RESOLVED);
  });

  it('E — a replay against an already-healed row proposes the SAME id back: idempotent, no churn', () => {
    expect(proposedBrownlowMatchId(RESOLVED, RESOLVED)).toBe(RESOLVED);
  });

  it('F — the demoted stale recipient and the current recipients of ONE provider match propose the '
    + 'IDENTICAL resolved match_id — there is no per-player re-resolution', () => {
    const demoted = proposedBrownlowMatchId(RESOLVED, null); // stale recipient, never healed before
    const current = proposedBrownlowMatchId(RESOLVED, RESOLVED); // already-healed current recipient
    expect(demoted).toBe(current);
    expect(demoted).toBe(RESOLVED);
  });

  it('H — an existing row whose match_id is a DIFFERENT non-null value is NOT an ordinary proposal: it throws '
    + '(neither the resolved id nor a "pinned" current id is returned), because the caller must already have '
    + 'refused the whole vote set (I244-F010 boundary; X -> Y is never proposed by F007)', () => {
    const conflicting = RESOLVED + 500;
    expect(() => proposedBrownlowMatchId(RESOLVED, conflicting)).toThrow(BROWNLOW_MATCH_IDENTITY_CONFLICT);
    expect(() => proposedBrownlowMatchId(RESOLVED, conflicting)).toThrow(String(conflicting));
  });

  it('X + X and NULL + X remain the only safe proposals — both return the resolved id', () => {
    expect(proposedBrownlowMatchId(RESOLVED, RESOLVED)).toBe(RESOLVED); // X + X (idempotent replay)
    expect(proposedBrownlowMatchId(RESOLVED, null)).toBe(RESOLVED); // NULL + X (healing)
  });

  it('C (structural) — the refused branch of AflApiBrownlowMatchSetPlan carries no matchId field at all, '
    + 'so a refused vote set has nothing for any downstream proposal to read, let alone fabricate', () => {
    const refused: AflApiBrownlowMatchSetPlan = {
      status: 'refused', providerMatchId: 'CD_M_UNRESOLVED', reason: 'unresolved_identity',
    };
    expect('matchId' in refused).toBe(false);
  });
});

describe('unitInputFor (AFLDB-ISSUE-244 I244-F007 wiring)', () => {
  const sourceKeysById = new Map([[7, 'afl_api']]);
  const batchId = asImportBatchId('1');
  const RESOLVED = 9001;

  function targetOf(currentValues: { played: boolean; votes: number; match_id: number | null } | null, proposedVotes: number) {
    const unit = unitInputFor(
      7, sourceKeysById, batchId, [2026], 'CD_M_TEST', 1,
      2026, 5, 123, currentValues, proposedVotes, RESOLVED,
    );
    expect(unit.targets).toHaveLength(1);
    return unit.targets[0];
  }

  it('a brand-new row (currentValues null) proposes the resolved match_id, played = true and the given votes', () => {
    const target = targetOf(null, 3);
    expect(target.proposedValues).toEqual({ played: true, votes: 3, match_id: RESOLVED });
    expect(target.renderedFields).toEqual(['played', 'votes', 'match_id']);
    expect(target.renderedBaselineCanonicalHash).toBeNull(); // no row existed to hash
  });

  it('a pre-F007 row (match_id null, votes already correct) still proposes the resolved match_id — the '
    + 'healing case: the proposal changes even though the vote value itself does not', () => {
    const target = targetOf({ played: true, votes: 1, match_id: null }, 1);
    expect(target.proposedValues.match_id).toBe(RESOLVED);
    expect(target.proposedValues.votes).toBe(1);
    expect(target.renderedBaselineCanonicalHash).not.toBeNull(); // a row DID exist to hash
  });

  it('a row already carrying the SAME match_id proposes it back (identical replay: nothing to diff)', () => {
    const target = targetOf({ played: true, votes: 1, match_id: RESOLVED }, 1);
    expect(target.proposedValues).toEqual({ played: true, votes: 1, match_id: RESOLVED });
  });

  it('a row already carrying a DIFFERENT non-null match_id never yields a proposal at all — not the newly '
    + 'resolved id, not a "pinned" current id, not a votes-only update (F010 boundary)', () => {
    const conflicting = RESOLVED + 500;
    expect(() => targetOf({ played: true, votes: 1, match_id: conflicting }, 0)).toThrow(BROWNLOW_MATCH_IDENTITY_CONFLICT);
    expect(() => targetOf({ played: true, votes: 1, match_id: conflicting }, 3)).toThrow(BROWNLOW_MATCH_IDENTITY_CONFLICT);
  });
});

describe('brownlowMatchIdentityConflicts (AFLDB-ISSUE-244 I244-F007 blocker 2 — the pre-write identity preflight)', () => {
  const RESOLVED = 9001;
  const OTHER = 9002;
  // A, B, C are the current recipients; D is a stale recipient F002 would demote.
  const CURRENT = new Set([1, 2, 3]);
  const row = (playerId: number, votes: number, matchId: number | null, aflApiOwned = true): BrownlowExistingSetRow => ({
    playerId, votes, matchId, aflApiOwned,
  });

  it('is empty — the set may proceed — for absent, NULL (healing) and equal (replay) match ids', () => {
    expect(brownlowMatchIdentityConflicts([], CURRENT, RESOLVED)).toEqual([]);
    expect(brownlowMatchIdentityConflicts(
      [row(1, 3, null), row(2, 2, RESOLVED), row(3, 1, RESOLVED), row(4, 1, null)], CURRENT, RESOLVED,
    )).toEqual([]);
  });

  it('names a CURRENT recipient whose existing non-null match_id differs from the resolved one', () => {
    const conflicts = brownlowMatchIdentityConflicts(
      [row(1, 3, RESOLVED), row(2, 2, OTHER), row(3, 1, RESOLVED)], CURRENT, RESOLVED,
    );
    expect(conflicts).toEqual([{
      playerId: 2, votes: 2, existingMatchId: OTHER, resolvedMatchId: RESOLVED, scope: 'current', aflApiOwned: true,
    }]);
  });

  it('names a STALE recipient (one the corrected set would demote) whose match_id differs — provider-Y evidence '
    + 'must not demote a row that claims canonical match X', () => {
    const conflicts = brownlowMatchIdentityConflicts(
      [row(1, 3, RESOLVED), row(2, 2, RESOLVED), row(3, 1, RESOLVED), row(4, 1, OTHER)], CURRENT, RESOLVED,
    );
    expect(conflicts).toEqual([{
      playerId: 4, votes: 1, existingMatchId: OTHER, resolvedMatchId: RESOLVED, scope: 'stale', aflApiOwned: true,
    }]);
  });

  it('reports every conflicting row (current AND stale) in ascending player id, and marks a foreign-owned current row', () => {
    const conflicts = brownlowMatchIdentityConflicts(
      [row(4, 1, OTHER), row(2, 2, OTHER, false), row(1, 3, RESOLVED)], CURRENT, RESOLVED,
    );
    expect(conflicts.map((c) => [c.playerId, c.scope, c.aflApiOwned])).toEqual([
      [2, 'current', false], [4, 'stale', true],
    ]);
  });
});

describe('planBrownlowPositiveSlotReleases (AFLDB-ISSUE-244 I244-F007 blocker 1 — two-phase vote update)', () => {
  const votes = (entries: ReadonlyArray<readonly [number, number]>): ReadonlyMap<number, number> => new Map(entries);
  // A = 1, B = 2, C = 3 (player ids)
  const A = 1; const B = 2; const C = 3;

  it('two-way swap A3 B2 C1 -> A2 B3 C1: releases A and B (the swapped pair), never C', () => {
    expect(planBrownlowPositiveSlotReleases(
      votes([[A, 3], [B, 2], [C, 1]]), votes([[A, 2], [B, 3], [C, 1]]),
    )).toEqual([A, B]);
  });

  it('three-way permutation A3 B2 C1 -> C3 A2 B1: releases all three', () => {
    expect(planBrownlowPositiveSlotReleases(
      votes([[A, 3], [B, 2], [C, 1]]), votes([[C, 3], [A, 2], [B, 1]]),
    )).toEqual([A, B, C]);
  });

  it('an identical replay releases nothing — the no-op stays a no-op', () => {
    expect(planBrownlowPositiveSlotReleases(
      votes([[A, 3], [B, 2], [C, 1]]), votes([[A, 3], [B, 2], [C, 1]]),
    )).toEqual([]);
  });

  it('holds no slot -> no release: an absent row and an existing zero are never released', () => {
    expect(planBrownlowPositiveSlotReleases(
      votes([[A, 0]]), votes([[A, 3], [B, 2], [C, 1]]), // A retained at 0; B and C have no row at all
    )).toEqual([]);
  });

  it('a partial exchange (B and C trade values, A unchanged) releases only B and C, never the unchanged A', () => {
    expect(planBrownlowPositiveSlotReleases(
      votes([[A, 3], [B, 2], [C, 1]]), votes([[A, 3], [B, 1], [C, 2]]),
    )).toEqual([B, C]);
  });

  it('is ordered by ascending player id regardless of target insertion order (deterministic ledger order)', () => {
    expect(planBrownlowPositiveSlotReleases(
      votes([[A, 3], [B, 2], [C, 1]]), votes([[C, 3], [B, 1], [A, 2]]),
    )).toEqual([A, B, C]);
  });

  it('every slot the target claims is empty once the released recipients are zeroed — for both permutations', () => {
    const before = votes([[A, 3], [B, 2], [C, 1]]);
    for (const after of [
      votes([[A, 2], [B, 3], [C, 1]]),
      votes([[C, 3], [A, 2], [B, 1]]),
    ]) {
      const released = new Set(planBrownlowPositiveSlotReleases(before, after));
      const occupiedAfterRelease = [...before].filter(([player]) => !released.has(player)).map(([, v]) => v);
      const claimsByChangedRecipients = [...after].filter(([player]) => released.has(player)).map(([, v]) => v);
      for (const claimed of claimsByChangedRecipients) expect(occupiedAfterRelease).not.toContain(claimed);
    }
  });
});
