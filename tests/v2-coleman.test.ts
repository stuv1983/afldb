/**
 * AFLDB V2 Stage 4 (plan D6, ADR 0006) — the pure Coleman Medal derivation and its comparison
 * report. No database, no network, no clock.
 *
 * FIXTURES ARE SYNTHETIC. There is no committed per-match goal data in this repository, so every
 * match, club, player, goal and profile path below is invented (`Synthetic_Player_*`); none of it
 * is a real season's result and the season number (2024) is only a label that is complete in the
 * real season registry. The derivation has therefore been exercised on synthetic inputs only.
 * The CONTRACT, by contrast, is the real committed data/reference/coleman-derivation.json.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { SeasonRegistry } from '@afldb/domain';
import {
  COLEMAN_COMPARISON_REPORT_FORMAT,
  COLEMAN_COMPARISON_REPORT_VERSION,
  COLEMAN_DERIVATION_VERSION,
  COLEMAN_REFUSAL_CODES,
  COLEMAN_REQUIRED_CONTRACT_KEYS,
  ColemanContractError,
  buildColemanComparisonReport,
  deriveColeman,
  parseColemanContract,
  serialiseColemanComparisonReport,
  serialiseColemanDerivation,
  validateColemanComparisonReport,
  type ColemanContract,
  type ColemanDerivation,
  type ColemanDerivationInput,
  type ColemanDerivationOutcome,
  type ColemanGoalFact,
  type ColemanIdentityRow,
  type ColemanMatchRow,
  type ColemanRefusalCode,
  type ColemanStoredWinner,
} from '@afldb/derived';

const CONTRACT_JSON: Record<string, unknown> = JSON.parse(
  readFileSync(join(__dirname, '..', 'data', 'reference', 'coleman-derivation.json'), 'utf8'),
);
const REGISTRY: SeasonRegistry = JSON.parse(
  readFileSync(join(__dirname, '..', 'data', 'reference', 'seasons.json'), 'utf8'),
);
const CONTRACT: ColemanContract = parseColemanContract(CONTRACT_JSON);

const SEASON = 2024; // a label only: complete in the real registry, with SYNTHETIC data below.
const DERIVED_AT = '2026-10-19T00:00:00Z';

/* ------------------------------------------------------------------ *
 * SYNTHETIC fixture: 4 clubs, 8 players, 4 home-and-away matches, 1 finals match.
 * ------------------------------------------------------------------ */

const SYNTH_PLAYERS = [
  { id: 11, letter: 'A', club: 1 },
  { id: 12, letter: 'B', club: 1 },
  { id: 13, letter: 'C', club: 2 },
  { id: 14, letter: 'D', club: 2 },
  { id: 15, letter: 'E', club: 3 },
  { id: 16, letter: 'F', club: 3 },
  { id: 17, letter: 'G', club: 4 },
  { id: 18, letter: 'H', club: 4 },
] as const;

const SYNTH_FINALS_MATCH_ID = 5;
const synthPath = (letter: string): string => `players/S/Synthetic_Player_${letter}.html`;

function synthMatches(): ColemanMatchRow[] {
  return [
    { matchId: 1, season: SEASON, roundType: 'home_and_away', homeClubId: 1, awayClubId: 2 },
    { matchId: 2, season: SEASON, roundType: 'home_and_away', homeClubId: 3, awayClubId: 4 },
    { matchId: 3, season: SEASON, roundType: 'home_and_away', homeClubId: 1, awayClubId: 3 },
    { matchId: 4, season: SEASON, roundType: 'home_and_away', homeClubId: 2, awayClubId: 4 },
    { matchId: SYNTH_FINALS_MATCH_ID, season: SEASON, roundType: 'elimination_final', homeClubId: 1, awayClubId: 2 },
  ];
}

/** Baseline goals by `<playerId>:<matchId>`: A=5, B=2, C=3, D=2, E=3, F=1, G=3, H=0 over home-and-away. */
const BASE_GOALS: Record<string, number | null> = {
  '11:1': 3, '11:3': 2, '11:5': 1,
  '12:1': 1, '12:3': 1,
  '13:1': 2, '13:4': 1, '13:5': 2,
  '14:4': 2,
  '15:2': 3,
  '16:3': 1,
  '17:2': 1, '17:4': 2,
};

function synthFacts(overrides: Record<string, number | null> = {}): ColemanGoalFact[] {
  const goals = { ...BASE_GOALS, ...overrides };
  const facts: ColemanGoalFact[] = [];
  for (const match of synthMatches()) {
    for (const player of SYNTH_PLAYERS) {
      if (player.club !== match.homeClubId && player.club !== match.awayClubId) continue;
      const key = `${player.id}:${match.matchId}`;
      facts.push({ matchId: match.matchId, playerId: player.id, clubId: player.club, goals: key in goals ? goals[key] : 0 });
    }
  }
  return facts;
}

function synthIdentities(): ColemanIdentityRow[] {
  return SYNTH_PLAYERS.map((p) => ({
    playerId: p.id,
    matchMethod: 'afltables_profile_url',
    externalId: synthPath(p.letter),
    status: 'unique',
  }));
}

function makeInput(over: Partial<ColemanDerivationInput> = {}): ColemanDerivationInput {
  return {
    contract: CONTRACT,
    season: SEASON,
    seasonState: { registry: REGISTRY, settled: true },
    matches: synthMatches(),
    playerMatchGoals: synthFacts(),
    identities: synthIdentities(),
    derivedAt: DERIVED_AT,
    derivationVersion: COLEMAN_DERIVATION_VERSION,
    ...over,
  };
}

function expectOk(outcome: ColemanDerivationOutcome): ColemanDerivation {
  if (!outcome.ok) throw new Error(`expected a derivation, got refusal ${outcome.refusal.code}: ${outcome.refusal.message}`);
  return outcome.result;
}

function expectRefusal(outcome: ColemanDerivationOutcome, code: ColemanRefusalCode) {
  if (outcome.ok) throw new Error(`expected refusal ${code}, got a derivation`);
  expect(outcome.refusal.code).toBe(code);
  return outcome.refusal;
}

/** Deterministic Fisher-Yates shuffle (seeded LCG) so a "shuffled" run is reproducible. */
function shuffled<T>(list: readonly T[], seed: number): T[] {
  const out = [...list];
  let state = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 1664525 + 1013904223) % 4294967296;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The contract
 * ------------------------------------------------------------------ */

describe('parseColemanContract (the real data/reference/coleman-derivation.json)', () => {
  it('accepts the committed contract and reads every value from it', () => {
    expect(CONTRACT.awardSlug).toBe('coleman');
    expect(CONTRACT.methodVersion).toBe(CONTRACT_JSON.method_version);
    expect(CONTRACT.firstSeason).toBe(CONTRACT_JSON.first_season);
    expect(CONTRACT.minimumGoals).toBe(CONTRACT_JSON.minimum_goals);
    expect(CONTRACT.sourceKey).toBe(CONTRACT_JSON.source_key);
    expect(CONTRACT.identityMatchMethod).toBe(CONTRACT_JSON.identity_match_method);
    expect([...CONTRACT.identityStatuses]).toEqual(CONTRACT_JSON.identity_statuses);
    expect(CONTRACT.keySeparator).toBe(CONTRACT_JSON.key_separator);
    expect(CONTRACT.firstSeason).toBe(1980);
  });

  it('requires the same keys as the Python loader and refuses each one missing', () => {
    expect([...COLEMAN_REQUIRED_CONTRACT_KEYS]).toEqual([
      'award_slug', 'method_version', 'first_season', 'source_key', 'minimum_goals',
      'identity_match_method', 'identity_statuses', 'key_separator', 'completed_seasons_only', 'legacy_transition',
    ]);
    for (const key of COLEMAN_REQUIRED_CONTRACT_KEYS) {
      const drifted = { ...CONTRACT_JSON };
      delete drifted[key];
      expect(() => parseColemanContract(drifted), key).toThrow(ColemanContractError);
      expect(() => parseColemanContract(drifted), key).toThrow(key);
    }
  });

  it('refuses a contract that has drifted in shape or value', () => {
    expect(() => parseColemanContract(null)).toThrow(ColemanContractError);
    expect(() => parseColemanContract([])).toThrow(ColemanContractError);
    expect(() => parseColemanContract({ ...CONTRACT_JSON, award_slug: 'brownlow' })).toThrow(/award_slug/);
    expect(() => parseColemanContract({ ...CONTRACT_JSON, completed_seasons_only: false })).toThrow(/completed_seasons_only/);
    expect(() => parseColemanContract({ ...CONTRACT_JSON, first_season: '1980' })).toThrow(/first_season/);
    expect(() => parseColemanContract({ ...CONTRACT_JSON, method_version: 0 })).toThrow(/method_version/);
    expect(() => parseColemanContract({ ...CONTRACT_JSON, minimum_goals: 0 })).toThrow(/minimum_goals/);
    expect(() => parseColemanContract({ ...CONTRACT_JSON, identity_statuses: [] })).toThrow(/identity_statuses/);
    expect(() => parseColemanContract({ ...CONTRACT_JSON, key_separator: '' })).toThrow(/key_separator/);
    expect(() => parseColemanContract({ ...CONTRACT_JSON, source_key: 7 })).toThrow(/source_key/);
  });
});

/* ------------------------------------------------------------------ *
 * The derivation (SYNTHETIC inputs)
 * ------------------------------------------------------------------ */

describe('deriveColeman on SYNTHETIC inputs: winners', () => {
  it('an outright winner, with the full leaderboard, the club and the durable key', () => {
    const result = expectOk(deriveColeman(makeInput()));
    expect(result.tie).toBe(false);
    expect(result.maxGoals).toBe(5);
    expect(result.winners).toEqual([{
      playerId: '11',
      profilePath: synthPath('A'),
      goals: 5,
      clubId: '1',
      clubCount: 1,
      key: `coleman:${SEASON}:${synthPath('A')}`,
    }]);
    // The full leaderboard: every player, goals desc then profile path; the zero-goal player is listed.
    expect(result.leaderboard.map((e) => [e.profilePath, e.goals])).toEqual([
      [synthPath('A'), 5],
      [synthPath('C'), 3],
      [synthPath('E'), 3],
      [synthPath('G'), 3],
      [synthPath('B'), 2],
      [synthPath('D'), 2],
      [synthPath('F'), 1],
      [synthPath('H'), 0],
    ]);
    expect(result.counts).toEqual({
      homeAndAwayMatches: 4,
      finalsMatches: 1,
      homeAndAwayGoalRows: 16,
      finalsRowsExcluded: 4,
      players: 8,
    });
  });

  it('joint winners on a tie: every tied player wins, no tiebreak, ordered by profile path', () => {
    // B 4+1 = 5 ties A on 5. Order of the tied winners is by profile path, never by games or id.
    const result = expectOk(deriveColeman(makeInput({ playerMatchGoals: synthFacts({ '12:1': 4 }) })));
    expect(result.tie).toBe(true);
    expect(result.winners.map((w) => [w.profilePath, w.goals])).toEqual([[synthPath('A'), 5], [synthPath('B'), 5]]);
    expect(result.winners.map((w) => w.key)).toEqual([
      `coleman:${SEASON}:${synthPath('A')}`,
      `coleman:${SEASON}:${synthPath('B')}`,
    ]);
  });

  it('a multi-club winner carries clubId null and the club count', () => {
    // Player E (club 3) kicks 9, and also appears for club 1 in match 1 (a SYNTHETIC mid-season
    // transfer) -> two distinct clubs over the season.
    const withSecondClub: ColemanGoalFact[] = [
      ...synthFacts({ '15:2': 9 }),
      { matchId: 1, playerId: 15, clubId: 1, goals: 0 },
    ];
    const result = expectOk(deriveColeman(makeInput({ playerMatchGoals: withSecondClub })));
    expect(result.winners).toHaveLength(1);
    expect(result.winners[0]).toMatchObject({ playerId: '15', goals: 9, clubId: null, clubCount: 2 });
    expect(result.leaderboard[0].clubIds).toEqual(['1', '3']);
  });

  it('a season whose maximum is below minimum_goals has no winner: reported, not an error', () => {
    const allZero = Object.fromEntries(Object.keys(BASE_GOALS).map((k) => [k, 0]));
    const result = expectOk(deriveColeman(makeInput({ playerMatchGoals: synthFacts(allZero) })));
    expect(result.maxGoals).toBe(0);
    expect(CONTRACT.minimumGoals).toBeGreaterThanOrEqual(1);
    expect(result.winners).toEqual([]);
    expect(result.tie).toBe(false);
    expect(result.leaderboard).toHaveLength(8);
  });

  it('players without any identity may sit on the leaderboard; only winners need one', () => {
    const noIdentityForLoser = synthIdentities().filter((i) => i.playerId !== 18);
    const result = expectOk(deriveColeman(makeInput({ identities: noIdentityForLoser })));
    expect(result.leaderboard.find((e) => e.playerId === '18')?.profilePath).toBeNull();
    expect(result.winners).toHaveLength(1);
  });

  it('accepts numeric and string ids interchangeably (postgres.js returns int8 as a string)', () => {
    const asStrings = makeInput({
      matches: synthMatches().map((m) => ({ ...m, matchId: String(m.matchId), homeClubId: String(m.homeClubId), awayClubId: String(m.awayClubId) })),
      playerMatchGoals: synthFacts().map((f) => ({ ...f, matchId: String(f.matchId), playerId: String(f.playerId), clubId: String(f.clubId) })),
      identities: synthIdentities().map((i) => ({ ...i, playerId: String(i.playerId) })),
    });
    const a = expectOk(deriveColeman(asStrings));
    const b = expectOk(deriveColeman(makeInput()));
    expect(a).toEqual(b);
  });
});

describe('deriveColeman on SYNTHETIC inputs: finals are excluded', () => {
  it('a finals-only goal haul does not win and does not change any total', () => {
    // Player D (HA total 2) kicks 9 in the SYNTHETIC elimination final.
    const result = expectOk(deriveColeman(makeInput({ playerMatchGoals: synthFacts({ '14:5': 9 }) })));
    expect(result.winners.map((w) => w.playerId)).toEqual(['11']);
    expect(result.leaderboard.find((e) => e.playerId === '14')?.goals).toBe(2);
    expect(result.counts.finalsMatches).toBe(1);
    expect(result.counts.finalsRowsExcluded).toBe(4);
    expect(result.counts.homeAndAwayGoalRows + result.counts.finalsRowsExcluded).toBe(result.inputs.goals.length);
  });

  it('a NULL goals value in a finals row does not refuse the season (finals are out of scope)', () => {
    const result = expectOk(deriveColeman(makeInput({ playerMatchGoals: synthFacts({ '11:5': null }) })));
    expect(result.winners.map((w) => w.playerId)).toEqual(['11']);
  });

  it('an unknown round type is invalid input, not silently home-and-away', () => {
    const matches = synthMatches().map((m) => (m.matchId === 5 ? { ...m, roundType: 'mystery_round' } : m));
    const refusal = expectRefusal(deriveColeman(makeInput({ matches })), 'invalid_input');
    expect(JSON.stringify(refusal.details)).toContain('mystery_round');
  });
});

describe('deriveColeman on SYNTHETIC inputs: refusals are whole-season', () => {
  it('lists the refusal codes the brief requires', () => {
    for (const code of [
      'season_not_complete', 'season_not_settled', 'season_before_contract', 'goals_not_recorded',
      'incomplete_rounds', 'identity_missing', 'identity_ambiguous', 'unsafe_key',
    ]) {
      expect(COLEMAN_REFUSAL_CODES).toContain(code);
    }
  });

  it('refuses a season before the contract first season', () => {
    const refusal = expectRefusal(deriveColeman(makeInput({ season: CONTRACT.firstSeason - 1 })), 'season_before_contract');
    expect(refusal.details).toEqual({ firstSeason: CONTRACT.firstSeason });
    // The first covered season is not refused on this ground.
    expect(deriveColeman(makeInput({ season: CONTRACT.firstSeason, matches: synthMatches().map((m) => ({ ...m, season: CONTRACT.firstSeason })) })).ok).toBe(true);
  });

  it('refuses an incomplete (in-progress) season and one outside the registry', () => {
    const inProgress = REGISTRY.in_progress_seasons[0];
    expect(inProgress).toBeGreaterThan(CONTRACT.firstSeason);
    expectRefusal(deriveColeman(makeInput({
      season: inProgress,
      matches: synthMatches().map((m) => ({ ...m, season: inProgress })),
    })), 'season_not_complete');
    expectRefusal(deriveColeman(makeInput({
      season: REGISTRY.last_season + 1,
      matches: synthMatches().map((m) => ({ ...m, season: REGISTRY.last_season + 1 })),
    })), 'season_not_complete');
  });

  it('refuses a complete season that is not attested as settled', () => {
    expectRefusal(deriveColeman(makeInput({ seasonState: { registry: REGISTRY, settled: false } })), 'season_not_settled');
  });

  it('refuses incomplete rounds: a home-and-away match with no goal rows for a club', () => {
    // Drop every club-4 row of match 2.
    const facts = synthFacts().filter((f) => !(f.matchId === 2 && f.clubId === 4));
    const refusal = expectRefusal(deriveColeman(makeInput({ playerMatchGoals: facts })), 'incomplete_rounds');
    expect(refusal.details.matchesMissingClubRows).toEqual({ count: 1, sample: [{ matchId: '2', missingClubIds: ['4'] }] });
  });

  it('refuses incomplete rounds: a match with no goal rows at all', () => {
    const facts = synthFacts().filter((f) => f.matchId !== 4);
    expectRefusal(deriveColeman(makeInput({ playerMatchGoals: facts })), 'incomplete_rounds');
  });

  it('refuses incomplete rounds: a fact row whose match is not in the match list', () => {
    const facts = [...synthFacts(), { matchId: 99, playerId: 11, clubId: 1, goals: 40 }];
    const refusal = expectRefusal(deriveColeman(makeInput({ playerMatchGoals: facts })), 'incomplete_rounds');
    expect(refusal.details.factsForUnknownMatches).toEqual({ count: 1, sample: [{ matchId: '99', playerId: '11' }] });
  });

  it('refuses incomplete rounds: a match from another season in the input', () => {
    const matches = [...synthMatches(), { matchId: 77, season: SEASON - 1, roundType: 'home_and_away', homeClubId: 1, awayClubId: 2 }];
    const refusal = expectRefusal(deriveColeman(makeInput({ matches })), 'incomplete_rounds');
    expect(refusal.details.matchesFromOtherSeasons).toEqual({ count: 1, sample: ['77'] });
  });

  it('refuses incomplete rounds: no home-and-away matches at all (finals only)', () => {
    const matches = synthMatches().filter((m) => m.roundType !== 'home_and_away');
    const facts = synthFacts().filter((f) => f.matchId === SYNTH_FINALS_MATCH_ID);
    const refusal = expectRefusal(deriveColeman(makeInput({ matches, playerMatchGoals: facts })), 'incomplete_rounds');
    expect(refusal.details.noHomeAndAwayMatches).toBe(true);
  });

  it('refuses NULL goals in a home-and-away row: not recorded is never zero', () => {
    const refusal = expectRefusal(
      deriveColeman(makeInput({ playerMatchGoals: synthFacts({ '12:3': null }) })),
      'goals_not_recorded',
    );
    expect(refusal.details).toEqual({ count: 1, sample: [{ matchId: '3', playerId: '12' }] });
    expect(refusal.message).toMatch(/not recorded/);
  });

  it('keeps 0 and NULL apart: the same row as 0 derives, as NULL refuses', () => {
    // '12:3' is 1 in the baseline. As 0 it is a recorded zero and the season derives with B on 1.
    const asZero = expectOk(deriveColeman(makeInput({ playerMatchGoals: synthFacts({ '12:3': 0 }) })));
    expect(asZero.leaderboard.find((e) => e.playerId === '12')?.goals).toBe(1);
    expect(deriveColeman(makeInput({ playerMatchGoals: synthFacts({ '12:3': null }) })).ok).toBe(false);
    // A recorded zero for the would-be winner changes the answer rather than being skipped as missing.
    const winnerZero = expectOk(deriveColeman(makeInput({ playerMatchGoals: synthFacts({ '11:1': 0 }) })));
    expect(winnerZero.leaderboard.find((e) => e.playerId === '11')?.goals).toBe(2);
  });

  it('refuses a winner with no accepted identity (status or method outside the contract does not count)', () => {
    const none = synthIdentities().filter((i) => i.playerId !== 11);
    expect(expectRefusal(deriveColeman(makeInput({ identities: none })), 'identity_missing').details).toMatchObject({
      missingIdentity: { count: 1, sample: ['11'] },
    });
    const wrongStatus = synthIdentities().map((i) => (i.playerId === 11 ? { ...i, status: 'candidate' } : i));
    expectRefusal(deriveColeman(makeInput({ identities: wrongStatus })), 'identity_missing');
    const wrongMethod = synthIdentities().map((i) => (i.playerId === 11 ? { ...i, matchMethod: 'name' } : i));
    expectRefusal(deriveColeman(makeInput({ identities: wrongMethod })), 'identity_missing');
    // 'resolved' is an accepted status.
    const resolved = synthIdentities().map((i) => (i.playerId === 11 ? { ...i, status: 'resolved' } : i));
    expect(deriveColeman(makeInput({ identities: resolved })).ok).toBe(true);
  });

  it('refuses a winner holding two distinct profile identities', () => {
    const two = [...synthIdentities(), {
      playerId: 11, matchMethod: 'afltables_profile_url', externalId: synthPath('A2'), status: 'resolved',
    }];
    expectRefusal(deriveColeman(makeInput({ identities: two })), 'identity_ambiguous');
    // The same path recorded twice is one identity, not two.
    const dup = [...synthIdentities(), synthIdentities()[0]];
    expect(deriveColeman(makeInput({ identities: dup })).ok).toBe(true);
  });

  it('refuses two winners that share one profile path (key collision)', () => {
    const tied = synthFacts({ '12:1': 4 });
    const shared = synthIdentities().map((i) => (i.playerId === 12 ? { ...i, externalId: synthPath('A') } : i));
    expectRefusal(deriveColeman(makeInput({ playerMatchGoals: tied, identities: shared })), 'identity_ambiguous');
  });

  it('refuses a winner whose profile path contains the key separator (refused, never sanitised)', () => {
    expect(CONTRACT.keySeparator).toBe(':');
    const unsafe = synthIdentities().map((i) => (i.playerId === 11 ? { ...i, externalId: 'players/S/Synthetic:Player_A.html' } : i));
    const refusal = expectRefusal(deriveColeman(makeInput({ identities: unsafe })), 'unsafe_key');
    expect(refusal.details).toMatchObject({ unsafePaths: { count: 1 } });
  });

  it('an unsafe path on a NON-winner does not refuse (only winners need a durable key)', () => {
    const unsafeLoser = synthIdentities().map((i) => (i.playerId === 18 ? { ...i, externalId: 'players/S/Synthetic:Player_H.html' } : i));
    expect(deriveColeman(makeInput({ identities: unsafeLoser })).ok).toBe(true);
  });

  it('refuses malformed rows and headers as invalid_input', () => {
    expectRefusal(deriveColeman(makeInput({ derivedAt: 'yesterday' })), 'invalid_input');
    expectRefusal(deriveColeman(makeInput({ derivationVersion: '' })), 'invalid_input');
    expectRefusal(deriveColeman(makeInput({ playerMatchGoals: synthFacts({ '11:1': -1 }) })), 'invalid_input');
    expectRefusal(deriveColeman(makeInput({ playerMatchGoals: synthFacts({ '11:1': 1.5 }) })), 'invalid_input');
    expectRefusal(deriveColeman(makeInput({ playerMatchGoals: [...synthFacts(), synthFacts()[0]] })), 'invalid_input');
    expectRefusal(deriveColeman(makeInput({ matches: [...synthMatches(), synthMatches()[0]] })), 'invalid_input');
    // A fact for a club that did not play in the match.
    expectRefusal(deriveColeman(makeInput({
      playerMatchGoals: [...synthFacts(), { matchId: 1, playerId: 99, clubId: 4, goals: 1 }],
    })), 'invalid_input');
  });

  it('a refusal never carries a partial answer', () => {
    const outcome = deriveColeman(makeInput({ seasonState: { registry: REGISTRY, settled: false } }));
    expect(outcome.ok).toBe(false);
    expect(outcome).not.toHaveProperty('result');
    if (!outcome.ok) {
      expect(outcome.refusal).toMatchObject({
        season: SEASON,
        methodVersion: CONTRACT.methodVersion,
        derivationVersion: COLEMAN_DERIVATION_VERSION,
      });
    }
  });
});

describe('deriveColeman on SYNTHETIC inputs: versions, checksum, idempotence, corrections', () => {
  it('records the contract method version, the derivation version, the timestamp and a sha256 checksum', () => {
    const result = expectOk(deriveColeman(makeInput()));
    expect(result.methodVersion).toBe(CONTRACT.methodVersion);
    expect(result.derivationVersion).toBe(COLEMAN_DERIVATION_VERSION);
    expect(COLEMAN_DERIVATION_VERSION).not.toBe(String(CONTRACT.methodVersion));
    expect(result.derivedAt).toBe(DERIVED_AT);
    expect(result.inputChecksum).toMatch(/^[0-9a-f]{64}$/);
    expect(result.inputs.contract.methodVersion).toBe(CONTRACT.methodVersion);
  });

  it('is idempotent: the same inputs in any row order give a deep-equal result and an identical checksum', () => {
    const baseline = expectOk(deriveColeman(makeInput()));
    for (const seed of [1, 7, 42, 2026]) {
      const reordered = makeInput({
        matches: shuffled(synthMatches(), seed),
        playerMatchGoals: shuffled(synthFacts(), seed + 1),
        identities: shuffled(synthIdentities(), seed + 2),
      });
      const again = expectOk(deriveColeman(reordered));
      expect(again).toEqual(baseline);
      expect(again.inputChecksum).toBe(baseline.inputChecksum);
      expect(serialiseColemanDerivation(again)).toBe(serialiseColemanDerivation(baseline));
    }
    // A plain rerun is identical too.
    expect(expectOk(deriveColeman(makeInput()))).toEqual(baseline);
  });

  it('the checksum covers the data inputs, not the timestamp or the code version', () => {
    const a = expectOk(deriveColeman(makeInput()));
    const later = expectOk(deriveColeman(makeInput({ derivedAt: '2027-01-01T00:00:00Z' })));
    const newer = expectOk(deriveColeman(makeInput({ derivationVersion: 'v2.coleman.2' })));
    expect(later.inputChecksum).toBe(a.inputChecksum);
    expect(newer.inputChecksum).toBe(a.inputChecksum);
    expect(later.derivedAt).not.toBe(a.derivedAt);
    expect(newer.derivationVersion).toBe('v2.coleman.2');
  });

  it('a corrected statistic changes the checksum, and the winners when it should', () => {
    const before = expectOk(deriveColeman(makeInput()));
    // Correction 1: a non-winner's goal total changes -> checksum changes, winner unchanged.
    const minor = expectOk(deriveColeman(makeInput({ playerMatchGoals: synthFacts({ '16:3': 2 }) })));
    expect(minor.inputChecksum).not.toBe(before.inputChecksum);
    expect(minor.winners.map((w) => w.playerId)).toEqual(['11']);
    // Correction 2: the leader loses two goals -> A, C, E and G are now all tied on 3 and all win.
    const major = expectOk(deriveColeman(makeInput({ playerMatchGoals: synthFacts({ '11:3': 0 }) })));
    expect(major.inputChecksum).not.toBe(before.inputChecksum);
    expect(major.winners.map((w) => w.profilePath)).toEqual([synthPath('A'), synthPath('C'), synthPath('E'), synthPath('G')]);
    expect(major.tie).toBe(true);
    // Correcting it back restores the original result exactly.
    const restored = expectOk(deriveColeman(makeInput({ playerMatchGoals: synthFacts({ '11:3': 2 }) })));
    expect(restored).toEqual(before);
  });

  it('a changed identity changes the checksum', () => {
    const a = expectOk(deriveColeman(makeInput()));
    const moved = synthIdentities().map((i) => (i.playerId === 11 ? { ...i, externalId: synthPath('A_renamed') } : i));
    const b = expectOk(deriveColeman(makeInput({ identities: moved })));
    expect(b.inputChecksum).not.toBe(a.inputChecksum);
    expect(b.winners[0].key).toBe(`coleman:${SEASON}:${synthPath('A_renamed')}`);
  });

  it('the result is plain JSON: it survives a round trip unchanged', () => {
    const result = expectOk(deriveColeman(makeInput()));
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

/* ------------------------------------------------------------------ *
 * The comparison report
 * ------------------------------------------------------------------ */

const REPORT_AT = '2026-10-19T01:00:00Z';

function storedRow(over: Partial<ColemanStoredWinner> = {}): ColemanStoredWinner {
  return {
    season: SEASON,
    playerId: 11,
    sourceKey: 'afltables',
    sourceRecordId: `coleman:${SEASON}:${synthPath('A')}`,
    status: 'active',
    ...over,
  };
}

describe('buildColemanComparisonReport on SYNTHETIC derivations', () => {
  const okOutcome = deriveColeman(makeInput());
  const tieOutcome = deriveColeman(makeInput({ playerMatchGoals: synthFacts({ '12:1': 4 }) }));
  const refusedOutcome = deriveColeman(makeInput({ seasonState: { registry: REGISTRY, settled: false } }));

  it('agree: the stored active winners are exactly the derived winners', () => {
    const report = buildColemanComparisonReport({ generatedAt: REPORT_AT, outcomes: [okOutcome], stored: [storedRow()] });
    expect(report.format).toBe(COLEMAN_COMPARISON_REPORT_FORMAT);
    expect(report.formatVersion).toBe(COLEMAN_COMPARISON_REPORT_VERSION);
    expect(report.summary).toEqual({ seasons: 1, agree: 1, disagree: 0, notDerivable: 0 });
    expect(report.seasons[0]).toMatchObject({ season: SEASON, category: 'agree', missing: [], extra: [], duplicates: [], refusal: null });
    expect(report.seasons[0].inputChecksum).toBe(expectOk(okOutcome).inputChecksum);
    expect(validateColemanComparisonReport(report)).toEqual([]);
  });

  it('agree by player id when a legacy-keyed row names the same player', () => {
    const legacy = storedRow({ sourceKey: 'draftguru', sourceRecordId: `coleman:${SEASON}:1234` });
    const report = buildColemanComparisonReport({ generatedAt: REPORT_AT, outcomes: [okOutcome], stored: [legacy] });
    expect(report.seasons[0].category).toBe('agree');
    expect(report.seasons[0].stored[0].sourceKey).toBe('draftguru');
  });

  it('disagree: reports missing, extra and duplicate winners', () => {
    // Tie derived (A, B); stored has only A (B missing) plus a wrong player (extra).
    const missingAndExtra = buildColemanComparisonReport({
      generatedAt: REPORT_AT,
      outcomes: [tieOutcome],
      stored: [storedRow(), storedRow({ playerId: 15, sourceRecordId: `coleman:${SEASON}:${synthPath('E')}` })],
    });
    const season = missingAndExtra.seasons[0];
    expect(season.category).toBe('disagree');
    expect(season.missing.map((w) => w.playerId)).toEqual(['12']);
    expect(season.extra.map((r) => r.playerId)).toEqual(['15']);
    expect(missingAndExtra.summary).toEqual({ seasons: 1, agree: 0, disagree: 1, notDerivable: 0 });
    expect(validateColemanComparisonReport(missingAndExtra)).toEqual([]);

    const duplicated = buildColemanComparisonReport({
      generatedAt: REPORT_AT,
      outcomes: [okOutcome],
      stored: [storedRow(), storedRow({ sourceKey: 'draftguru', sourceRecordId: `coleman:${SEASON}:99` })],
    });
    expect(duplicated.seasons[0].category).toBe('disagree');
    expect(duplicated.seasons[0].duplicates).toHaveLength(1);
    expect(duplicated.seasons[0].duplicates[0].rows).toHaveLength(2);
    expect(validateColemanComparisonReport(duplicated)).toEqual([]);

    const nothingStored = buildColemanComparisonReport({ generatedAt: REPORT_AT, outcomes: [okOutcome], stored: [] });
    expect(nothingStored.seasons[0].category).toBe('disagree');
    expect(nothingStored.seasons[0].missing).toHaveLength(1);
  });

  it('non-active stored rows take no part in the comparison but are listed, never dropped', () => {
    const report = buildColemanComparisonReport({
      generatedAt: REPORT_AT,
      outcomes: [okOutcome],
      stored: [
        storedRow(),
        storedRow({ playerId: 15, sourceRecordId: `coleman:${SEASON}:${synthPath('E')}`, status: 'void' }),
      ],
    });
    const season = report.seasons[0];
    expect(season.category).toBe('agree');
    expect(season.extra).toEqual([]);
    expect(season.ignored).toEqual([{
      playerId: '15', sourceKey: 'afltables', sourceRecordId: `coleman:${SEASON}:${synthPath('E')}`, status: 'void',
    }]);
    // A void row for the right player does not satisfy the derived winner.
    const onlyVoid = buildColemanComparisonReport({ generatedAt: REPORT_AT, outcomes: [okOutcome], stored: [storedRow({ status: 'void' })] });
    expect(onlyVoid.seasons[0].category).toBe('disagree');
    expect(onlyVoid.seasons[0].missing).toHaveLength(1);
  });

  it('not_derivable: carries the refusal code and lists the stored rows without judging them', () => {
    const report = buildColemanComparisonReport({ generatedAt: REPORT_AT, outcomes: [refusedOutcome], stored: [storedRow()] });
    expect(report.seasons[0]).toMatchObject({
      category: 'not_derivable',
      inputChecksum: null,
      derivedWinners: [],
      missing: [],
      extra: [],
      refusal: { code: 'season_not_settled' },
    });
    expect(report.seasons[0].stored).toHaveLength(1);
    expect(validateColemanComparisonReport(report)).toEqual([]);
  });

  it('orders seasons ascending, lists stored seasons that have no outcome, and rejects duplicate outcomes', () => {
    const earlier = deriveColeman(makeInput({
      season: 2023,
      matches: synthMatches().map((m) => ({ ...m, season: 2023 })),
    }));
    const report = buildColemanComparisonReport({
      generatedAt: REPORT_AT,
      outcomes: [okOutcome, earlier],
      stored: [storedRow(), storedRow({ season: 2023, sourceRecordId: `coleman:2023:${synthPath('A')}` }), storedRow({ season: 2001 })],
    });
    expect(report.seasons.map((s) => s.season)).toEqual([2023, SEASON]);
    expect(report.storedSeasonsWithoutOutcome).toEqual([2001]);
    expect(report.summary.seasons).toBe(2);
    expect(() => buildColemanComparisonReport({ generatedAt: REPORT_AT, outcomes: [okOutcome, okOutcome], stored: [] })).toThrow(RangeError);
  });

  it('is deterministic: input order does not change the serialised report', () => {
    const stored = [storedRow(), storedRow({ playerId: 15, sourceRecordId: 'z' }), storedRow({ playerId: 16, sourceRecordId: 'a' })];
    const refused2020 = deriveColeman(makeInput({
      season: 2020,
      matches: synthMatches().map((m) => ({ ...m, season: 2020 })),
      seasonState: { registry: REGISTRY, settled: false },
    }));
    expect(refusedOutcome.ok).toBe(false);
    const a = serialiseColemanComparisonReport(buildColemanComparisonReport({
      generatedAt: REPORT_AT, outcomes: [okOutcome, refused2020], stored,
    }));
    const b = serialiseColemanComparisonReport(buildColemanComparisonReport({
      generatedAt: REPORT_AT, outcomes: [refused2020, okOutcome], stored: shuffled(stored, 5),
    }));
    expect(a).toBe(b);
    expect(a.endsWith('\n')).toBe(true);
    expect(validateColemanComparisonReport(JSON.parse(a))).toEqual([]);
  });
});

describe('validateColemanComparisonReport', () => {
  const valid = () => JSON.parse(JSON.stringify(buildColemanComparisonReport({
    generatedAt: REPORT_AT,
    outcomes: [deriveColeman(makeInput()), deriveColeman(makeInput({ seasonState: { registry: REGISTRY, settled: false }, season: 2023, matches: synthMatches().map((m) => ({ ...m, season: 2023 })) }))],
    stored: [storedRow()],
  })));

  it('accepts a well-formed report', () => {
    expect(validateColemanComparisonReport(valid())).toEqual([]);
  });

  it('rejects malformed reports with specific problems', () => {
    expect(validateColemanComparisonReport(null)).toEqual(['report must be an object.']);
    expect(validateColemanComparisonReport({})).toContain('report.format is required.');

    const wrongFormat = valid();
    wrongFormat.format = 'something.else';
    expect(validateColemanComparisonReport(wrongFormat).join('\n')).toMatch(/report\.format/);

    const badInstant = valid();
    badInstant.generatedAt = 'now';
    expect(validateColemanComparisonReport(badInstant).join('\n')).toMatch(/generatedAt/);

    const badCategory = valid();
    badCategory.seasons[0].category = 'maybe';
    expect(validateColemanComparisonReport(badCategory).join('\n')).toMatch(/category must be one of/);

    const agreeWithDifference = valid();
    agreeWithDifference.seasons[1].extra = [{ playerId: '1', sourceKey: null, sourceRecordId: null, status: 'active' }];
    expect(validateColemanComparisonReport(agreeWithDifference).join('\n')).toMatch(/agree carries no differences|not_derivable carries no/);

    const disagreeWithout = valid();
    disagreeWithout.seasons[1].category = 'disagree';
    disagreeWithout.seasons[1].refusal = null;
    disagreeWithout.seasons[1].inputChecksum = 'a'.repeat(64);
    expect(validateColemanComparisonReport(disagreeWithout).join('\n')).toMatch(/disagree must carry at least one difference/);

    const notDerivableNoRefusal = valid();
    notDerivableNoRefusal.seasons[0].refusal = null;
    notDerivableNoRefusal.seasons[0].category = 'not_derivable';
    expect(validateColemanComparisonReport(notDerivableNoRefusal).join('\n')).toMatch(/refusal must be \{ code, message \}/);

    const summaryMismatch = valid();
    summaryMismatch.summary.agree = 5;
    expect(validateColemanComparisonReport(summaryMismatch).join('\n')).toMatch(/summary category counts/);

    const unsorted = valid();
    unsorted.seasons.reverse();
    expect(validateColemanComparisonReport(unsorted).join('\n')).toMatch(/strictly ascending/);

    const missingField = valid();
    delete missingField.seasons[0].derivedWinners;
    expect(validateColemanComparisonReport(missingField)).toContain('report.seasons[0].derivedWinners is required.');
  });
});
