/**
 * AFLDB V2 Stage 4 (plan D7, ADR 0007) — the pure Brownlow reconciliation and its report.
 * DB-free and network-free.
 *
 * What runs on COMMITTED data and what is SYNTHETIC:
 *   - REAL committed files: tests/fixtures/afl_api/brownlow/01-brownlow-season-round.json and
 *     02-brownlow-leaderboard-sample.json, parsed through the production emitters
 *     (emitAflApiBrownlowMatchVotes / emitAflApiBrownlowLeaderboard); and data/brownlow/season-votes.csv
 *     (the stored authoritative season totals, 98 seasons, 16,120 rows), read from disk. The two API
 *     fixtures are the repository's own one-match test fixtures (provider ids CD_I9000xx); the canonical
 *     player, club and match ids used with them below are SYNTHETIC test ids.
 *   - SYNTHETIC (named `synthetic*`, season 2090, players 1001-1006, provider ids SYN_*): every multi-match
 *     API season. No real player's votes are invented anywhere in this file.
 *   - NOT executable here: an API season compared with the stored totals of the SAME real season. The
 *     committed API fixtures are season 2026 and the stored totals end at 2025; the missing API snapshots
 *     are V2-GAP-010. That comparison is exercised on SYNTHETIC inputs only.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BROWNLOW_AWARD_STATUSES,
  BROWNLOW_FINDING_CODES,
  BROWNLOW_FINDING_SEVERITIES,
  BROWNLOW_RECONCILIATION_REPORT_FORMAT,
  BROWNLOW_RECONCILIATION_REPORT_JSON_SCHEMA,
  BROWNLOW_REPORT_REQUIRED,
  reconcileBrownlowSeason,
  serialiseBrownlowReconciliationReport,
  validateBrownlowReconciliationInput,
  validateBrownlowReconciliationReport,
  type BrownlowFindingCode,
  type BrownlowLeaderboardEntryInput,
  type BrownlowMatchContextInput,
  type BrownlowReconciliationReport,
  type BrownlowSeasonState,
  type BrownlowStoredTotalInput,
} from '@afldb/derived';
import { describe, expect, it } from 'vitest';

import { emitAflApiBrownlowLeaderboard, emitAflApiBrownlowMatchVotes } from '@/lib/acquisition/afl-api-bundle';
import { parseSourceFamilyRegistry } from '@/lib/acquisition/source-families';

const ROOT = join(__dirname, '..');
const GENERATED_AT = '2026-10-19T00:00:00Z';

/* ------------------------------------------------------------------ *
 * Mutable input shape + helpers
 * ------------------------------------------------------------------ */

interface MVote {
  providerPlayerId: string;
  providerTeamId: string;
  playerId: number | null;
  clubId: number | null;
  votes: number;
  eligible: boolean | null;
}
interface MMatch {
  providerMatchId: string;
  matchId: number | null;
  apiRoundNumber: number;
  canonicalRoundNumber: number | null;
  votes: MVote[];
}
interface MInput {
  season: number;
  seasonState: BrownlowSeasonState;
  generatedAt: string;
  eligibilityRule?: 'unrecorded' | 'stored_eligible_rank_one';
  matchVotes: MMatch[];
  leaderboard: { status: string | null; entries: BrownlowLeaderboardEntryInput[] } | null;
  storedTotals: BrownlowStoredTotalInput[] | null;
  matchContext: BrownlowMatchContextInput[];
}

// A deliberately untyped view of a serialised report, so the validator can be fed malformed ones.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

function codesOf(report: BrownlowReconciliationReport): BrownlowFindingCode[] {
  return [...new Set(report.findings.map((f) => f.code))].sort();
}

function findingsOf(report: BrownlowReconciliationReport, code: BrownlowFindingCode) {
  return report.findings.filter((f) => f.code === code);
}

function expectValid(report: BrownlowReconciliationReport): void {
  expect(validateBrownlowReconciliationReport(JSON.parse(serialiseBrownlowReconciliationReport(report)))).toEqual([]);
}

/* ------------------------------------------------------------------ *
 * SYNTHETIC season 2090: clubs 1-4, players 1001-1006, matches 101-103
 * ------------------------------------------------------------------ */

const SYN_CLUB: Record<number, number> = { 1001: 1, 1002: 2, 1003: 1, 1004: 3, 1005: 4, 1006: 3 };
const SYN_MATCHES: { providerMatchId: string; matchId: number; round: number; home: number; away: number }[] = [
  { providerMatchId: 'SYN_M101', matchId: 101, round: 1, home: 1, away: 2 },
  { providerMatchId: 'SYN_M102', matchId: 102, round: 1, home: 3, away: 4 },
  { providerMatchId: 'SYN_M103', matchId: 103, round: 2, home: 1, away: 3 },
];

/** A vote table: for each match, [player for 3 votes, player for 2 votes, player for 1 vote]. */
type SynVotes = [[number, number, number], [number, number, number], [number, number, number]];
const SYN_BASE_VOTES: SynVotes = [[1001, 1002, 1003], [1004, 1005, 1006], [1001, 1004, 1003]];

function synVote(playerId: number, votes: number, eligible = true): MVote {
  return {
    providerPlayerId: `SYN_I${playerId}`,
    providerTeamId: `SYN_T${SYN_CLUB[playerId]}`,
    playerId,
    clubId: SYN_CLUB[playerId],
    votes,
    eligible,
  };
}

function competitionRank(totalsDescending: number[]): number[] {
  return totalsDescending.map((v) => totalsDescending.indexOf(v) + 1);
}

/** A reconciled SYNTHETIC complete season whose leaderboard and stored totals agree with its round votes. */
function syntheticSeason(table: SynVotes = SYN_BASE_VOTES, ineligible: number[] = []): MInput {
  const matchVotes: MMatch[] = SYN_MATCHES.map((m, i) => ({
    providerMatchId: m.providerMatchId,
    matchId: m.matchId,
    apiRoundNumber: m.round,
    canonicalRoundNumber: m.round,
    votes: ([3, 2, 1] as const).map((value, k) => synVote(table[i][k], value, !ineligible.includes(table[i][k]))),
  }));
  const totals = new Map<number, number>();
  for (const m of matchVotes) for (const v of m.votes) totals.set(v.playerId as number, (totals.get(v.playerId as number) ?? 0) + v.votes);
  const ordered = [...totals].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const overall = competitionRank(ordered.map(([, v]) => v));
  const eligibleOrdered = ordered.filter(([id]) => !ineligible.includes(id));
  const eligibleRank = competitionRank(eligibleOrdered.map(([, v]) => v));
  return {
    season: 2090,
    seasonState: 'complete',
    generatedAt: GENERATED_AT,
    matchVotes,
    leaderboard: {
      status: 'CONCLUDED',
      entries: ordered.map(([id, v], i) => ({
        providerPlayerId: `SYN_I${id}`,
        providerTeamId: `SYN_T${SYN_CLUB[id]}`,
        playerId: id,
        totalVotes: v,
        eligible: !ineligible.includes(id),
        winner: false,
        leader: overall[i] === 1,
      })),
    },
    storedTotals: ordered.map(([id, v], i) => ({
      playerId: id,
      clubId: SYN_CLUB[id],
      votes: v,
      voteRank: overall[i],
      eligibleRank: ineligible.includes(id) ? null : eligibleRank[eligibleOrdered.findIndex(([e]) => e === id)],
      isIneligible: ineligible.includes(id),
      isWinner: !ineligible.includes(id) && eligibleRank[eligibleOrdered.findIndex(([e]) => e === id)] === 1,
    })),
    matchContext: SYN_MATCHES.map((m) => ({
      matchId: m.matchId,
      season: 2090,
      roundNumber: m.round,
      isFinal: false,
      homeClubId: m.home,
      awayClubId: m.away,
      homeProviderTeamId: `SYN_T${m.home}`,
      awayProviderTeamId: `SYN_T${m.away}`,
    })),
  };
}

/** Deterministic permutation (seeded LCG Fisher-Yates), so the shuffle test is reproducible. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The base case
 * ------------------------------------------------------------------ */

describe('SYNTHETIC complete season: reconciled and determined', () => {
  const report = reconcileBrownlowSeason(syntheticSeason());

  it('reconciles with no finding and states joint-leader semantics, never a winner', () => {
    expect(report.format).toBe(BROWNLOW_RECONCILIATION_REPORT_FORMAT);
    expect(report.generatedAt).toBe(GENERATED_AT);
    expect(report.outcome).toBe('reconciled');
    expect(report.findings).toEqual([]);
    expect(report.rawVotes.basis).toBe('api_round_votes');
    expect(report.rawVotes.comparisons.leaderboard).toEqual({ state: 'compared', compared: 6, mismatches: 0 });
    expect(report.rawVotes.comparisons.stored).toEqual({ state: 'compared', compared: 6, mismatches: 0 });
    expect(report.rawVotes.comparisons.storedInternal).toEqual({ state: 'compared', compared: 6, mismatches: 0 });
    // 1001: 3 + 3 = 6, 1004: 3 + 2 = 5, then 1002/1003/1005 on 2 and 1006 on 1.
    expect(report.rawVotes.playerTotals.map((t) => [t.playerId, t.votes, t.matchesPolled]))
      .toEqual([[1001, 6, 2], [1004, 5, 2], [1002, 2, 1], [1003, 2, 2], [1005, 2, 1], [1006, 1, 1]].map(([a, b, c]) => [a, b, c]));
    expect(report.awardResultPresentation).toMatchObject({
      status: 'determined', refusalCode: null, basis: 'api_round_votes', leaders: [{ playerId: 1001, votes: 6 }], tie: false,
    });
    expect(Object.keys(report.awardResultPresentation)).not.toContain('winner');
    expectValid(report);
  });

  it('keeps raw votes and the award-result presentation in separate sections', () => {
    expect(Object.keys(report.rawVotes).sort()).toEqual(['basis', 'comparisons', 'matches', 'playerTotals', 'topVoteGetters']);
    expect(Object.keys(report.awardResultPresentation).sort()).toEqual(
      [...BROWNLOW_REPORT_REQUIRED.award].sort(),
    );
    const raw = JSON.stringify(report.rawVotes);
    expect(raw).not.toContain('"leaders"');
    expect(raw).not.toContain('"status"');
  });

  it('reports provider and stored claims without using them', () => {
    const input = syntheticSeason();
    // The provider claims 1004 as winner although 1001 has more votes: reported, never used.
    input.leaderboard!.entries.find((e) => e.playerId === 1004)!.winner = true;
    const r = reconcileBrownlowSeason(input);
    expect(r.awardResultPresentation.providerClaims).toEqual({
      leaderboardWinners: [1004], leaderboardLeaders: [1001], storedWinners: [1001],
    });
    expect(r.awardResultPresentation.leaders).toEqual([{ playerId: 1001, votes: 6 }]);
  });
});

/* ------------------------------------------------------------------ *
 * COMMITTED API fixtures through the production emitters
 * ------------------------------------------------------------------ */

describe('committed AFL API fixtures (01-brownlow-season-round.json, 02-brownlow-leaderboard-sample.json)', () => {
  const registry = parseSourceFamilyRegistry(
    JSON.parse(readFileSync(join(ROOT, 'data', 'reference', 'source-families.json'), 'utf8')),
  );
  const fixtureDir = join(ROOT, 'tests', 'fixtures', 'afl_api', 'brownlow');
  const rawVotes: unknown = JSON.parse(readFileSync(join(fixtureDir, '01-brownlow-season-round.json'), 'utf8'));
  const rawBoard: unknown = JSON.parse(readFileSync(join(fixtureDir, '02-brownlow-leaderboard-sample.json'), 'utf8'));
  const votesEmit = emitAflApiBrownlowMatchVotes(rawVotes, registry);
  const boardEmit = emitAflApiBrownlowLeaderboard(rawBoard, registry);
  // SYNTHETIC canonical identities for the fixture's provider ids (the fixture has no canonical ids).
  const PLAYER: Record<string, number> = { CD_I900001: 9001, CD_I900002: 9002, CD_I900003: 9003 };
  const CLUB: Record<string, number> = { CD_T80: 9080, CD_T20: 9020 };

  function fromFixtures(seasonState: BrownlowSeasonState): MInput {
    return {
      season: 2026,
      seasonState,
      generatedAt: GENERATED_AT,
      matchVotes: votesEmit.records.map((r) => ({
        providerMatchId: r.providerMatchId,
        matchId: 9001,
        apiRoundNumber: r.apiRoundNumber,
        canonicalRoundNumber: r.apiRoundNumber,
        votes: r.votes.map((v) => ({
          providerPlayerId: v.providerPlayerId,
          providerTeamId: v.providerTeamId,
          playerId: PLAYER[v.providerPlayerId],
          clubId: CLUB[v.providerTeamId],
          votes: v.votes,
          eligible: v.eligible,
        })),
      })),
      leaderboard: {
        status: 'IN_PROGRESS',
        entries: boardEmit.records.map((e) => ({
          providerPlayerId: e.providerPlayerId,
          providerTeamId: e.providerTeamId,
          playerId: PLAYER[e.providerPlayerId],
          totalVotes: e.votes,
          eligible: e.eligible,
          winner: e.winner,
          leader: e.leader,
        })),
      },
      storedTotals: null,
      matchContext: [{
        matchId: 9001, season: 2026, roundNumber: 28, isFinal: false,
        homeClubId: 9080, awayClubId: 9020, homeProviderTeamId: 'CD_T80', awayProviderTeamId: 'CD_T20',
      }],
    };
  }

  it('reconciles the in-progress fixture season and states no leader of record', () => {
    const report = reconcileBrownlowSeason(fromFixtures('in_progress'));
    expect(report.outcome).toBe('reconciled');
    expect(report.findings).toEqual([]);
    expect(report.source.leaderboardStatus).toBe('IN_PROGRESS');
    expect(report.rawVotes.playerTotals.map((t) => [t.playerId, t.votes])).toEqual([[9001, 3], [9002, 2], [9003, 1]]);
    expect(report.rawVotes.comparisons.leaderboard).toEqual({ state: 'compared', compared: 3, mismatches: 0 });
    // The provider flags the first player as "leader" (a claim); the season is still incomplete.
    expect(report.awardResultPresentation.providerClaims.leaderboardLeaders).toEqual([9001]);
    expect(report.awardResultPresentation).toMatchObject({ status: 'season_incomplete', leaders: [], tie: null, refusalCode: null });
    expectValid(report);
  });

  it('the same fixture evidence declared complete (SYNTHETIC state) determines one leader', () => {
    const report = reconcileBrownlowSeason(fromFixtures('complete'));
    expect(report.outcome).toBe('reconciled');
    expect(report.awardResultPresentation).toMatchObject({ status: 'determined', leaders: [{ playerId: 9001, votes: 3 }], tie: false });
  });

  it('the stored totals end at 2025, so no committed API season overlaps them (V2-GAP-010)', () => {
    const seasons = readStoredCsv().map((r) => r.season);
    expect(Math.max(...seasons)).toBe(2025);
    expect(fromFixtures('complete').season).toBeGreaterThan(Math.max(...seasons));
  });
});

/* ------------------------------------------------------------------ *
 * COMMITTED stored totals (data/brownlow/season-votes.csv)
 * ------------------------------------------------------------------ */

interface CsvRow {
  season: number;
  votes: number;
  voteRank: number | null;
  eligibleRank: number | null;
  isIneligible: boolean;
  isWinner: boolean;
  playerId: number;
}

function readStoredCsv(): CsvRow[] {
  const lines = readFileSync(join(ROOT, 'data', 'brownlow', 'season-votes.csv'), 'utf8').split(/\r?\n/).filter((l) => l !== '');
  const header = lines[0].split(',');
  expect(header).toHaveLength(16);
  const col = (name: string) => header.indexOf(name);
  const toInt = (text: string): number | null => (text === '' ? null : Number(text));
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    expect(cells).toHaveLength(16);
    return {
      season: Number(cells[col('season')]),
      votes: Number(cells[col('votes')]),
      voteRank: toInt(cells[col('vote_rank')]),
      eligibleRank: toInt(cells[col('eligible_rank')]),
      isIneligible: cells[col('is_ineligible')] === 't',
      isWinner: cells[col('is_winner')] === 't',
      // bootstrap_player_id: the stable player id the artefact is keyed by (manifest: AFLDB-ISSUE-113 §8.6).
      playerId: Number(cells[col('bootstrap_player_id')]),
    };
  });
}

describe('COMMITTED stored authoritative totals (data/brownlow/season-votes.csv)', () => {
  const rows = readStoredCsv();
  const seasons = [...new Set(rows.map((r) => r.season))].sort((a, b) => a - b);

  function storedOnly(season: number, rule?: 'unrecorded' | 'stored_eligible_rank_one'): BrownlowReconciliationReport {
    return reconcileBrownlowSeason({
      season,
      seasonState: 'complete',
      generatedAt: GENERATED_AT,
      eligibilityRule: rule,
      matchVotes: [],
      leaderboard: null,
      storedTotals: rows.filter((r) => r.season === season).map((r) => ({
        playerId: r.playerId, clubId: null, votes: r.votes, voteRank: r.voteRank, eligibleRank: r.eligibleRank,
        isIneligible: r.isIneligible, isWinner: r.isWinner,
      })),
      matchContext: [],
    });
  }

  it('covers 98 seasons (1924-2025) and 16,120 rows', () => {
    expect(seasons).toHaveLength(98);
    expect(seasons[0]).toBe(1924);
    expect(seasons[97]).toBe(2025);
    expect(rows).toHaveLength(16120);
  });

  it('every stored season is internally consistent: ranks and winner flags follow the recorded convention', () => {
    for (const season of seasons) {
      const report = storedOnly(season, 'stored_eligible_rank_one');
      expect(report.outcome, `season ${season}`).toBe('reconciled');
      expect(report.rawVotes.comparisons.storedInternal.state).toBe('compared');
      expect(report.rawVotes.comparisons.storedInternal.mismatches, `season ${season}`).toBe(0);
      expect(report.rawVotes.comparisons.stored.state).toBe('not_run'); // no API round votes to compare with
    }
  });

  it('with the stored-table convention selected, the leaders equal the stored winners in all 98 seasons (112 winners)', () => {
    let winners = 0;
    for (const season of seasons) {
      const report = storedOnly(season, 'stored_eligible_rank_one');
      const stored = rows.filter((r) => r.season === season && r.isWinner).map((r) => r.playerId).sort((a, b) => a - b);
      expect(report.awardResultPresentation.status, `season ${season}`).toBe('determined');
      expect(report.awardResultPresentation.basis).toBe('stored_totals');
      expect(report.awardResultPresentation.leaders.map((l) => l.playerId), `season ${season}`).toEqual(stored);
      winners += stored.length;
    }
    expect(winners).toBe(112);
  });

  it('with no rule selected, exactly the three seasons with an ineligible vote-getter refuse the determination', () => {
    const refused: number[] = [];
    for (const season of seasons) {
      const report = storedOnly(season);
      if (report.awardResultPresentation.status === 'refused_eligibility_rule_unrecorded') {
        refused.push(season);
        expect(report.awardResultPresentation.refusalCode).toBe('eligibility_rule_unrecorded');
        expect(report.awardResultPresentation.leaders).toEqual([]);
        expect(report.outcome).toBe('reconciled'); // the evidence reconciles; only the determination is refused
      } else {
        expect(report.awardResultPresentation.status, `season ${season}`).toBe('determined');
      }
    }
    // The three ineligible rows in the artefact: players 775 (1996), 422 (1997) and 1461 (2012).
    expect(refused).toEqual([1996, 1997, 2012]);
    expect(rows.filter((r) => r.isIneligible).map((r) => [r.season, r.playerId])).toEqual([[1996, 775], [1997, 422], [2012, 1461]]);
  });

  it('the raw section still reports the ineligible top vote-getter when the determination is refused', () => {
    const report = storedOnly(2012);
    expect(report.rawVotes.topVoteGetters).toEqual([{ playerId: 1461, votes: 30, eligible: false }]);
    expect(findingsOf(report, 'eligibility_rule_unrecorded').map((f) => f.playerId)).toEqual([1461]);
    expectValid(report);
  });
});

/* ------------------------------------------------------------------ *
 * Incomplete season
 * ------------------------------------------------------------------ */

describe('incomplete season (SYNTHETIC)', () => {
  it('states the season is incomplete and no winner or leader of record, even with a clear top total', () => {
    const input = syntheticSeason();
    input.seasonState = 'in_progress';
    const report = reconcileBrownlowSeason(input);
    expect(report.awardResultPresentation).toMatchObject({
      status: 'season_incomplete', leaders: [], tie: null, refusalCode: null, basis: null,
    });
    expect(report.awardResultPresentation.note).toContain('incomplete');
    expect(report.rawVotes.topVoteGetters).toEqual([{ playerId: 1001, votes: 6, eligible: true }]);
    // Stored totals are not compared with a part-played season.
    expect(report.rawVotes.comparisons.stored).toEqual({ state: 'skipped_season_incomplete', compared: 0, mismatches: 0 });
    expect(codesOf(report)).not.toContain('match_without_votes');
    expectValid(report);
  });

  it('flags a match without a vote set only once the season is complete', () => {
    const complete = syntheticSeason();
    complete.matchVotes = complete.matchVotes.slice(0, 2);
    const r = reconcileBrownlowSeason(complete);
    expect(findingsOf(r, 'match_without_votes').map((f) => f.detail.matchId)).toEqual([103]);
    expect(r.outcome).toBe('discrepancies');
    expect(r.awardResultPresentation.status).toBe('refused_unreconciled_evidence');
  });

  it('reports no vote evidence rather than a leader when nothing was supplied', () => {
    const r = reconcileBrownlowSeason({
      season: 2090, seasonState: 'complete', generatedAt: GENERATED_AT,
      matchVotes: [], leaderboard: null, storedTotals: null, matchContext: [],
    });
    expect(r.awardResultPresentation.status).toBe('no_vote_evidence');
    expect(r.rawVotes.basis).toBeNull();
    expect(r.rawVotes.comparisons.leaderboard.state).toBe('not_supplied');
  });
});

/* ------------------------------------------------------------------ *
 * Duplicate votes
 * ------------------------------------------------------------------ */

describe('duplicate and malformed votes (SYNTHETIC)', () => {
  it('the same player twice in a match', () => {
    const input = syntheticSeason();
    input.matchVotes[0].votes[2] = synVote(1001, 1);
    const r = reconcileBrownlowSeason(input);
    expect(findingsOf(r, 'duplicate_player_in_match')).toMatchObject([
      { providerMatchId: 'SYN_M101', providerPlayerId: 'SYN_I1001', detail: { count: 2, identity: 'provider_player_id' } },
    ]);
    expect(r.outcome).toBe('discrepancies');
    expect(r.awardResultPresentation.status).toBe('refused_unreconciled_evidence');
  });

  it('two provider ids that resolve to the same canonical player in one match', () => {
    const input = syntheticSeason();
    input.matchVotes[0].votes[2] = { ...synVote(1001, 1), providerPlayerId: 'SYN_I1001_ALIAS' };
    const r = reconcileBrownlowSeason(input);
    expect(findingsOf(r, 'duplicate_player_in_match')).toMatchObject([
      { providerMatchId: 'SYN_M101', playerId: 1001, detail: { count: 2, identity: 'canonical_player_id' } },
    ]);
  });

  it('two players with the same vote value in a match', () => {
    const input = syntheticSeason();
    input.matchVotes[1].votes[1].votes = 3;
    const r = reconcileBrownlowSeason(input);
    expect(findingsOf(r, 'duplicate_vote_value_in_match')).toMatchObject([
      { providerMatchId: 'SYN_M102', detail: { votes: 3, count: 2 } },
    ]);
  });

  it('vote values other than 3, 2 and 1', () => {
    for (const bad of [4, 0, -1]) {
      const input = syntheticSeason();
      input.matchVotes[2].votes[1].votes = bad;
      const r = reconcileBrownlowSeason(input);
      expect(findingsOf(r, 'invalid_vote_value'), `value ${bad}`).toMatchObject([
        { providerMatchId: 'SYN_M103', playerId: 1004, detail: { votes: bad } },
      ]);
    }
  });

  it('more than three vote-getters in a match, and fewer than three', () => {
    const many = syntheticSeason();
    many.matchVotes[0].votes.push(synVote(1004, 1));
    const rMany = reconcileBrownlowSeason(many);
    expect(findingsOf(rMany, 'too_many_vote_getters_in_match')).toMatchObject([{ providerMatchId: 'SYN_M101', detail: { voteGetters: 4 } }]);

    const few = syntheticSeason();
    few.matchVotes[0].votes.pop();
    const rFew = reconcileBrownlowSeason(few);
    expect(findingsOf(rFew, 'too_few_vote_getters_in_match')).toMatchObject([{ providerMatchId: 'SYN_M101', detail: { voteGetters: 2 } }]);
  });

  it('the same match recorded twice', () => {
    const input = syntheticSeason();
    input.matchVotes.push(structuredClone(input.matchVotes[0]));
    const r = reconcileBrownlowSeason(input);
    expect(findingsOf(r, 'duplicate_match_vote_record')).toMatchObject([{ providerMatchId: 'SYN_M101', detail: { records: 2 } }]);
  });
});

/* ------------------------------------------------------------------ *
 * Whole-set refusal
 * ------------------------------------------------------------------ */

describe('whole-set refusal (SYNTHETIC)', () => {
  it('one unresolved player refuses the whole season: no totals, no comparison, no determination', () => {
    const input = syntheticSeason();
    input.matchVotes[1].votes[0].playerId = null;
    const r = reconcileBrownlowSeason(input);
    expect(r.outcome).toBe('refused');
    expect(findingsOf(r, 'unresolved_player_identity')).toMatchObject([
      { providerMatchId: 'SYN_M102', providerPlayerId: 'SYN_I1004', detail: { source: 'round_votes' } },
    ]);
    expect(r.rawVotes.playerTotals).toEqual([]);
    expect(r.rawVotes.topVoteGetters).toEqual([]);
    expect(r.rawVotes.basis).toBeNull();
    expect(r.rawVotes.matches).toHaveLength(3); // the evidence as supplied is still listed
    expect(r.rawVotes.comparisons.leaderboard.state).toBe('not_run');
    expect(r.rawVotes.comparisons.stored.state).toBe('not_run');
    expect(r.awardResultPresentation).toMatchObject({
      status: 'refused_whole_set', refusalCode: 'whole_set_refused', leaders: [], tie: null,
    });
    expectValid(r);
  });

  it('an unresolved player on the leaderboard alone refuses the whole season', () => {
    const input = syntheticSeason();
    input.leaderboard!.entries[0].playerId = null;
    const r = reconcileBrownlowSeason(input);
    expect(r.outcome).toBe('refused');
    expect(findingsOf(r, 'unresolved_player_identity')[0].detail).toEqual({ source: 'leaderboard' });
  });

  it('an unresolved match refuses the whole season', () => {
    const input = syntheticSeason();
    input.matchVotes[0].matchId = null;
    const r = reconcileBrownlowSeason(input);
    expect(r.outcome).toBe('refused');
    expect(codesOf(r)).toEqual(['unresolved_match_identity']);
  });

  it('structural findings that need no identity are still reported alongside the refusal', () => {
    const input = syntheticSeason();
    input.matchVotes[0].votes[0].playerId = null;
    input.matchVotes[1].votes[1].votes = 3;
    const r = reconcileBrownlowSeason(input);
    expect(codesOf(r)).toEqual(['duplicate_vote_value_in_match', 'unresolved_player_identity']);
    expect(r.outcome).toBe('refused');
  });

  it('a malformed input is refused with input_schema_invalid and never partially read', () => {
    const bad = syntheticSeason();
    (bad.matchVotes[0].votes[0] as unknown as Record<string, unknown>).votes = '3';
    (bad.matchContext as unknown[]).push({ matchId: 'x' });
    const r = reconcileBrownlowSeason(bad);
    expect(r.outcome).toBe('refused');
    expect(codesOf(r)).toEqual(['input_schema_invalid']);
    expect(String(r.findings[0].detail.problems)).toContain('matchVotes[0].votes[0].votes must be an integer.');
    expect(r.rawVotes.matches).toEqual([]);
    expect(r.awardResultPresentation.status).toBe('refused_whole_set');
    expectValid(r);

    expect(validateBrownlowReconciliationInput(null)).toEqual(['input must be an object.']);
    const dupStored = syntheticSeason();
    dupStored.storedTotals!.push({ ...dupStored.storedTotals![0] });
    expect(validateBrownlowReconciliationInput(dupStored).join('\n')).toContain('appears twice');
  });

  it('refuses to build a report without a usable season or caller-supplied generatedAt', () => {
    const noClock = { ...syntheticSeason(), generatedAt: 'now' };
    expect(() => reconcileBrownlowSeason(noClock)).toThrow(RangeError);
    const noSeason = { ...syntheticSeason(), season: 'x' as unknown as number };
    expect(() => reconcileBrownlowSeason(noSeason)).toThrow(RangeError);
  });
});

/* ------------------------------------------------------------------ *
 * Ineligible players and the eligibility rule
 * ------------------------------------------------------------------ */

describe('ineligible vote-getters (SYNTHETIC)', () => {
  // 1001 leads on 6 votes but is ineligible; 1004 (5) is the top eligible total.
  const ineligibleLeader = () => syntheticSeason(SYN_BASE_VOTES, [1001]);

  it('refuses the determination with the "no recorded rule" code while still reporting the votes', () => {
    const r = reconcileBrownlowSeason(ineligibleLeader());
    expect(r.outcome).toBe('reconciled');
    expect(r.awardResultPresentation).toMatchObject({
      status: 'refused_eligibility_rule_unrecorded', refusalCode: 'eligibility_rule_unrecorded',
      leaders: [], tie: null, eligibilityRule: 'unrecorded', basis: null,
    });
    expect(findingsOf(r, 'eligibility_rule_unrecorded')).toMatchObject([{ playerId: 1001, severity: 'determination_refusal', detail: { votes: 6 } }]);
    expect(r.awardResultPresentation.note).toContain('src/lib/brownlow/entry.ts:664-679');
    // Raw evidence is untouched: the ineligible top total is visible and flagged.
    expect(r.rawVotes.topVoteGetters).toEqual([{ playerId: 1001, votes: 6, eligible: false }]);
    expect(r.rawVotes.playerTotals[0]).toEqual({ playerId: 1001, votes: 6, matchesPolled: 2, eligible: false });
    expectValid(r);
  });

  it('an ineligible flag seen only on the leaderboard or only in the stored table also refuses', () => {
    const onBoard = syntheticSeason();
    onBoard.leaderboard!.entries.find((e) => e.playerId === 1001)!.eligible = false;
    const rBoard = reconcileBrownlowSeason(onBoard);
    expect(rBoard.awardResultPresentation.status).toBe('refused_eligibility_rule_unrecorded');
    expect(codesOf(rBoard)).toContain('eligibility_flag_inconsistent');

    const onStored = syntheticSeason();
    onStored.storedTotals!.find((s) => s.playerId === 1001)!.isIneligible = true;
    const rStored = reconcileBrownlowSeason(onStored);
    expect(rStored.awardResultPresentation.status).toBe('refused_eligibility_rule_unrecorded');
    expect(findingsOf(rStored, 'eligibility_flag_inconsistent').map((f) => f.detail.source)).toEqual(['stored']);
  });

  it('the same player flagged eligible in one match and ineligible in another is a discrepancy', () => {
    const input = syntheticSeason();
    input.matchVotes[2].votes[0].eligible = false;
    const r = reconcileBrownlowSeason(input);
    expect(findingsOf(r, 'eligibility_flag_inconsistent')[0]).toMatchObject({ playerId: 1001, detail: { source: 'round_votes' } });
  });

  it('with the stored-table convention explicitly selected, the ineligible player is excluded', () => {
    const input = ineligibleLeader();
    input.eligibilityRule = 'stored_eligible_rank_one';
    const r = reconcileBrownlowSeason(input);
    expect(r.awardResultPresentation).toMatchObject({
      status: 'determined', eligibilityRule: 'stored_eligible_rank_one', leaders: [{ playerId: 1004, votes: 5 }], tie: false,
    });
    expect(r.rawVotes.topVoteGetters).toEqual([{ playerId: 1001, votes: 6, eligible: false }]);
    expect(findingsOf(r, 'eligibility_rule_unrecorded')).toEqual([]);
    expectValid(r);
  });

  it('any ineligible vote-getter refuses the determination, even one far from the top total', () => {
    const r = reconcileBrownlowSeason(syntheticSeason(SYN_BASE_VOTES, [1006]));
    expect(r.awardResultPresentation.status).toBe('refused_eligibility_rule_unrecorded');
  });
});

/* ------------------------------------------------------------------ *
 * Unknown provider eligibility (BP-2025-ELIGIBILITY-v1)
 * ------------------------------------------------------------------ */

describe('unknown provider eligibility (SYNTHETIC)', () => {
  it('a null round-vote flag is reported as unknown, never as ineligible or eligible, and refuses any leader', () => {
    for (const rule of [undefined, 'stored_eligible_rank_one'] as const) {
      const input = syntheticSeason();
      input.matchVotes[0].votes[0].eligible = null;
      if (rule) input.eligibilityRule = rule;
      const r = reconcileBrownlowSeason(input);
      const player = input.matchVotes[0].votes[0].playerId as number;
      expect(findingsOf(r, 'eligibility_provider_unknown')).toMatchObject([
        { playerId: player, severity: 'discrepancy', detail: { source: 'round_votes', unknownRecords: 1 } },
      ]);
      expect(r.rawVotes.playerTotals.find((t) => t.playerId === player)?.eligible).toBeNull();
      expect(findingsOf(r, 'eligibility_rule_unrecorded')).toEqual([]); // not counted as ineligible
      expect(r.awardResultPresentation.status).toBe('refused_unreconciled_evidence');
      expect(r.awardResultPresentation.leaders).toEqual([]);
      expectValid(r);
    }
  });

  it('a null leaderboard flag is unknown too, and an explicit flag elsewhere does not rescue it', () => {
    const input = syntheticSeason();
    input.leaderboard!.entries.find((e) => e.playerId === 1001)!.eligible = null;
    const r = reconcileBrownlowSeason(input);
    expect(findingsOf(r, 'eligibility_provider_unknown')).toMatchObject([
      { playerId: 1001, detail: { source: 'leaderboard' } },
    ]);
    expect(codesOf(r)).not.toContain('eligibility_flag_inconsistent');
    expect(r.rawVotes.playerTotals.find((t) => t.playerId === 1001)?.eligible).toBeNull();
    expect(r.awardResultPresentation.status).toBe('refused_unreconciled_evidence');
    expectValid(r);
  });

  it('unknown wins over a mixed explicit false: the player is not folded into the ineligible', () => {
    const input = syntheticSeason();
    input.matchVotes[0].votes[0].eligible = null;
    input.matchVotes[2].votes[0].eligible = false;
    const r = reconcileBrownlowSeason(input);
    const player = input.matchVotes[0].votes[0].playerId as number;
    expect(r.rawVotes.playerTotals.find((t) => t.playerId === player)?.eligible).toBeNull();
  });

  it('input validation accepts null as unknown and still rejects any other non-boolean', () => {
    const ok = syntheticSeason();
    ok.matchVotes[0].votes[0].eligible = null;
    ok.leaderboard!.entries[0].eligible = null;
    expect(validateBrownlowReconciliationInput(ok)).toEqual([]);
    const bad = syntheticSeason();
    (bad.matchVotes[0].votes[0] as { eligible: unknown }).eligible = 'yes';
    (bad.leaderboard!.entries[0] as { eligible: unknown }).eligible = 1;
    const problems = validateBrownlowReconciliationInput(bad).join(' | ');
    expect(problems).toContain('votes[0].eligible must be a boolean or null');
    expect(problems).toContain('entries[0].eligible must be a boolean or null');
  });
});

/* ------------------------------------------------------------------ *
 * Ties
 * ------------------------------------------------------------------ */

describe('ties (SYNTHETIC)', () => {
  // 1001 and 1004 both finish on 5.
  const tieTable: SynVotes = [[1002, 1001, 1003], [1004, 1005, 1006], [1001, 1004, 1003]];

  it('reports joint leaders and no winner', () => {
    const r = reconcileBrownlowSeason(syntheticSeason(tieTable));
    expect(r.outcome).toBe('reconciled');
    expect(r.awardResultPresentation).toMatchObject({
      status: 'determined', tie: true, leaders: [{ playerId: 1001, votes: 5 }, { playerId: 1004, votes: 5 }],
    });
    expect(r.rawVotes.topVoteGetters.map((t) => t.playerId)).toEqual([1001, 1004]);
    expect(Object.keys(r.awardResultPresentation)).not.toContain('winner');
    expect(JSON.stringify(r.awardResultPresentation.leaders)).not.toContain('winner');
    expectValid(r);
  });

  it('a tie among the eligible with the ineligible leader excluded is still joint', () => {
    const input = syntheticSeason([[1002, 1001, 1003], [1004, 1005, 1006], [1001, 1004, 1003]], [1002]);
    input.eligibilityRule = 'stored_eligible_rank_one';
    const r = reconcileBrownlowSeason(input);
    expect(r.awardResultPresentation.leaders.map((l) => l.playerId)).toEqual([1001, 1004]);
    expect(r.awardResultPresentation.tie).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Leaderboard
 * ------------------------------------------------------------------ */

describe('API round votes against the API leaderboard (SYNTHETIC)', () => {
  it('a per-player total mismatch, with the advisory/blocking distinction carried', () => {
    const input = syntheticSeason();
    input.leaderboard!.entries.find((e) => e.playerId === 1004)!.totalVotes = 4;
    const concluded = reconcileBrownlowSeason(input);
    expect(findingsOf(concluded, 'leaderboard_total_mismatch')).toMatchObject([
      { playerId: 1004, detail: { roundVotesTotal: 5, leaderboardTotal: 4, leaderboardConcluded: true } },
    ]);
    expect(concluded.outcome).toBe('discrepancies');
    expect(concluded.rawVotes.comparisons.leaderboard).toEqual({ state: 'compared', compared: 6, mismatches: 1 });
    expect(concluded.awardResultPresentation.status).toBe('refused_unreconciled_evidence');
    expect(concluded.awardResultPresentation.refusalCode).toBe('evidence_unreconciled');

    input.leaderboard!.status = 'IN_PROGRESS';
    expect(findingsOf(reconcileBrownlowSeason(input), 'leaderboard_total_mismatch')[0].detail.leaderboardConcluded).toBe(false);
  });

  it('a player on one side only; a published total of 0 agrees with "no round votes"', () => {
    const input = syntheticSeason();
    input.leaderboard!.entries = input.leaderboard!.entries.filter((e) => e.playerId !== 1006);
    input.leaderboard!.entries.push({
      providerPlayerId: 'SYN_I1007', providerTeamId: 'SYN_T4', playerId: 1007, totalVotes: 2, eligible: true, winner: false, leader: false,
    }, {
      providerPlayerId: 'SYN_I1008', providerTeamId: 'SYN_T4', playerId: 1008, totalVotes: 0, eligible: true, winner: false, leader: false,
    });
    const r = reconcileBrownlowSeason(input);
    expect(findingsOf(r, 'round_votes_only_player').map((f) => f.playerId)).toEqual([1006]);
    expect(findingsOf(r, 'leaderboard_only_player').map((f) => f.playerId)).toEqual([1007]);
  });

  it('a duplicated leaderboard entry', () => {
    const input = syntheticSeason();
    input.leaderboard!.entries.push({ ...input.leaderboard!.entries[0] });
    expect(findingsOf(reconcileBrownlowSeason(input), 'duplicate_leaderboard_entry')).toMatchObject([
      { playerId: input.leaderboard!.entries[0].playerId, detail: { entries: 2 } },
    ]);
  });

  it('with no round votes the leaderboard is the evidence basis and every voted entry is a leaderboard-only discrepancy', () => {
    const input = syntheticSeason();
    input.matchVotes = [];
    input.matchContext = [];
    input.storedTotals = null;
    const r = reconcileBrownlowSeason(input);
    expect(r.rawVotes.basis).toBe('api_leaderboard');
    expect(findingsOf(r, 'leaderboard_only_player')).toHaveLength(6);
  });
});

/* ------------------------------------------------------------------ *
 * Stored authoritative totals
 * ------------------------------------------------------------------ */

describe('API against the stored authoritative totals (SYNTHETIC)', () => {
  it('agree/disagree per player and players present on one side only; API stays the basis', () => {
    const input = syntheticSeason();
    input.storedTotals!.find((s) => s.playerId === 1002)!.votes = 3;
    input.storedTotals = input.storedTotals!.filter((s) => s.playerId !== 1006);
    input.storedTotals.push({ playerId: 1099, clubId: null, votes: 1, voteRank: 6, eligibleRank: 6, isIneligible: false, isWinner: false });
    const r = reconcileBrownlowSeason(input);
    expect(findingsOf(r, 'stored_total_mismatch')).toMatchObject([{ playerId: 1002, detail: { apiTotal: 2, storedTotal: 3 } }]);
    expect(findingsOf(r, 'api_only_player').map((f) => f.playerId)).toEqual([1006]);
    expect(findingsOf(r, 'stored_only_player').map((f) => f.playerId)).toEqual([1099]);
    expect(r.rawVotes.comparisons.stored.state).toBe('compared');
    expect(r.rawVotes.basis).toBe('api_round_votes');
    expect(r.rawVotes.playerTotals.find((t) => t.playerId === 1002)!.votes).toBe(2); // API total, not the stored one
    expect(r.awardResultPresentation.status).toBe('refused_unreconciled_evidence');
  });

  it('an absent stored total is never read as zero', () => {
    const input = syntheticSeason();
    input.storedTotals = input.storedTotals!.filter((s) => s.playerId !== 1006);
    const r = reconcileBrownlowSeason(input);
    expect(codesOf(r).filter((c) => c.startsWith('stored_total'))).toEqual([]);
    expect(findingsOf(r, 'api_only_player')).toHaveLength(1);
  });

  it('stored ranks and winner flags that contradict the recorded convention', () => {
    const wrongWinner = syntheticSeason();
    wrongWinner.storedTotals!.find((s) => s.playerId === 1004)!.isWinner = true;
    const r1 = reconcileBrownlowSeason(wrongWinner);
    expect(findingsOf(r1, 'stored_winner_flag_inconsistent')).toMatchObject([{ playerId: 1004, detail: { stored: true, expected: false } }]);

    const wrongRank = syntheticSeason();
    wrongRank.storedTotals!.find((s) => s.playerId === 1002)!.voteRank = 2;
    wrongRank.storedTotals!.find((s) => s.playerId === 1006)!.eligibleRank = null;
    const r2 = reconcileBrownlowSeason(wrongRank);
    expect(findingsOf(r2, 'stored_rank_inconsistent').map((f) => [f.playerId, f.detail.field])).toEqual([[1002, 'vote_rank'], [1006, 'eligible_rank']]);

    // A NULL vote_rank is "not recorded", not a rank: it is not flagged.
    const unrecorded = syntheticSeason();
    unrecorded.storedTotals!.find((s) => s.playerId === 1002)!.voteRank = null;
    expect(reconcileBrownlowSeason(unrecorded).findings).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Round / match / club consistency
 * ------------------------------------------------------------------ */

describe('round, match and club consistency (SYNTHETIC)', () => {
  it('a vote for a club that did not play, by resolved club id and by provider team id', () => {
    const byClub = syntheticSeason();
    byClub.matchVotes[0].votes[0].clubId = 4; // match 101 is club 1 v club 2
    const r1 = reconcileBrownlowSeason(byClub);
    expect(findingsOf(r1, 'vote_club_not_in_match')).toMatchObject([{ providerMatchId: 'SYN_M101', playerId: 1001, detail: { matchId: 101, clubId: 4 } }]);

    const byProvider = syntheticSeason();
    byProvider.matchVotes[0].votes[0].clubId = null;
    byProvider.matchVotes[0].votes[0].providerTeamId = 'SYN_T4';
    const r2 = reconcileBrownlowSeason(byProvider);
    expect(findingsOf(r2, 'vote_club_not_in_match')).toHaveLength(1);
    expect(r2.outcome).toBe('discrepancies');
  });

  it('a club that cannot be verified is information, not a discrepancy', () => {
    const input = syntheticSeason();
    for (const m of input.matchContext) {
      m.homeClubId = null; m.awayClubId = null; m.homeProviderTeamId = null; m.awayProviderTeamId = null;
    }
    const r = reconcileBrownlowSeason(input);
    expect(findingsOf(r, 'club_unverifiable')).toHaveLength(3);
    expect(findingsOf(r, 'club_unverifiable')[0].severity).toBe('info');
    expect(r.outcome).toBe('reconciled');
    expect(r.awardResultPresentation.status).toBe('determined');
  });

  it('a match outside the context, in another season, a final, or in a different round', () => {
    const input = syntheticSeason();
    input.matchContext = input.matchContext.filter((m) => m.matchId !== 101);
    input.matchContext.find((m) => m.matchId === 102)!.season = 2089;
    input.matchContext.find((m) => m.matchId === 103)!.isFinal = true;
    input.matchContext.find((m) => m.matchId === 103)!.roundNumber = 9;
    const r = reconcileBrownlowSeason(input);
    expect(findingsOf(r, 'match_not_in_context').map((f) => f.providerMatchId)).toEqual(['SYN_M101']);
    expect(findingsOf(r, 'match_wrong_season')).toMatchObject([{ providerMatchId: 'SYN_M102', detail: { contextSeason: 2089, season: 2090 } }]);
    expect(findingsOf(r, 'match_is_final').map((f) => f.providerMatchId)).toEqual(['SYN_M103']);
    expect(findingsOf(r, 'round_mismatch')).toMatchObject([{ providerMatchId: 'SYN_M103', detail: { voteRound: 2, contextRound: 9 } }]);
  });
});

/* ------------------------------------------------------------------ *
 * Replay / idempotency
 * ------------------------------------------------------------------ */

describe('replay: the same evidence in any order gives a byte-identical report', () => {
  const base = syntheticSeason(SYN_BASE_VOTES, [1006]);
  // Several defects at once, so findings, totals and comparisons all have something to order.
  base.matchVotes[0].votes[2] = synVote(1001, 1);
  base.leaderboard!.entries.find((e) => e.playerId === 1004)!.totalVotes = 9;
  base.storedTotals!.find((s) => s.playerId === 1003)!.votes = 7;
  const reference = serialiseBrownlowReconciliationReport(reconcileBrownlowSeason(base));

  it('is stable under shuffled matches, votes, leaderboard, stored rows and context', () => {
    expect(JSON.parse(reference).findings.length).toBeGreaterThan(3);
    for (const seed of [1, 7, 42, 2026, 99991]) {
      const copy = structuredClone(base);
      copy.matchVotes = shuffled(copy.matchVotes, seed).map((m) => ({ ...m, votes: shuffled(m.votes, seed + 1) }));
      copy.leaderboard = { ...copy.leaderboard!, entries: shuffled(copy.leaderboard!.entries, seed + 2) };
      copy.storedTotals = shuffled(copy.storedTotals!, seed + 3);
      copy.matchContext = shuffled(copy.matchContext, seed + 4);
      expect(serialiseBrownlowReconciliationReport(reconcileBrownlowSeason(copy)), `seed ${seed}`).toBe(reference);
    }
  });

  it('is idempotent and never mutates its input', () => {
    const frozen = structuredClone(base);
    const first = serialiseBrownlowReconciliationReport(reconcileBrownlowSeason(base));
    const second = serialiseBrownlowReconciliationReport(reconcileBrownlowSeason(base));
    expect(first).toBe(second);
    expect(base).toEqual(frozen);
  });

  it('serialises with sorted keys at every depth and one trailing newline', () => {
    expect(reference.endsWith('}\n')).toBe(true);
    const sorted = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.every(sorted);
      if (value !== null && typeof value === 'object') {
        const keys = Object.keys(value as object);
        return keys.every((k, i) => i === 0 || keys[i - 1] < k) && Object.values(value as object).every(sorted);
      }
      return true;
    };
    expect(sorted(JSON.parse(reference))).toBe(true);
  });

  it('a different generatedAt changes only that field', () => {
    const later = reconcileBrownlowSeason({ ...base, generatedAt: '2026-10-20T00:00:00Z' });
    expect(serialiseBrownlowReconciliationReport(later).replace('2026-10-20T00:00:00Z', GENERATED_AT)).toBe(reference);
  });
});

/* ------------------------------------------------------------------ *
 * Report validator and JSON Schema
 * ------------------------------------------------------------------ */

describe('the report validator', () => {
  const good = (): BrownlowReconciliationReport => {
    const input = syntheticSeason();
    input.leaderboard!.entries.find((e) => e.playerId === 1004)!.totalVotes = 4;
    return reconcileBrownlowSeason(input);
  };
  const edit = (fn: (r: Loose) => void): string[] => {
    const copy = JSON.parse(JSON.stringify(good())) as Loose;
    fn(copy);
    return validateBrownlowReconciliationReport(copy);
  };

  it('accepts genuine reports of every outcome and award status', () => {
    expect(validateBrownlowReconciliationReport(good())).toEqual([]);
    const refused = syntheticSeason();
    refused.matchVotes[0].votes[0].playerId = null;
    expect(validateBrownlowReconciliationReport(reconcileBrownlowSeason(refused))).toEqual([]);
    const statuses = new Set<string>();
    const collect = (r: BrownlowReconciliationReport) => statuses.add(r.awardResultPresentation.status);
    collect(reconcileBrownlowSeason(syntheticSeason()));
    collect(reconcileBrownlowSeason({ ...syntheticSeason(), seasonState: 'in_progress' }));
    collect(reconcileBrownlowSeason({ ...syntheticSeason(), matchVotes: [], leaderboard: null, storedTotals: null, matchContext: [] }));
    collect(reconcileBrownlowSeason(refused));
    collect(good());
    collect(reconcileBrownlowSeason(syntheticSeason(SYN_BASE_VOTES, [1001])));
    expect([...statuses].sort()).toEqual([...BROWNLOW_AWARD_STATUSES].sort());
  });

  it('rejects a non-object, a wrong format or version, a missing key and a bad instant', () => {
    expect(validateBrownlowReconciliationReport(null)).toEqual(['report must be an object.']);
    expect(edit((r) => { r.format = 'other'; }).join('\n')).toContain('report.format must be');
    expect(edit((r) => { r.formatVersion = 2; }).join('\n')).toContain('report.formatVersion must be 1');
    expect(edit((r) => { delete r.rawVotes; }).join('\n')).toContain('report.rawVotes is required.');
    expect(edit((r) => { r.generatedAt = '2026-10-19'; }).join('\n')).toContain('report.generatedAt');
  });

  it('rejects an outcome that does not follow from the findings', () => {
    expect(edit((r) => { r.outcome = 'reconciled'; }).join('\n')).toContain("report.outcome must be 'discrepancies'");
    expect(edit((r) => { r.outcome = 'refused'; }).join('\n')).toContain("report.outcome must be 'discrepancies'");
  });

  it('rejects unknown codes, mismatched severities, unsorted findings and wrong counts', () => {
    expect(edit((r) => { r.findings[0].code = 'made_up'; }).join('\n')).toContain('known finding code');
    expect(edit((r) => { r.findings[0].severity = 'info'; }).join('\n')).toContain('severity must be');
    expect(edit((r) => { r.findings.push(structuredClone(r.findings[0])); r.findings[1].code = 'api_only_player'; r.findingCounts = { api_only_player: 1, leaderboard_total_mismatch: 1 }; })
      .join('\n')).toContain('not sorted');
    expect(edit((r) => { r.findingCounts = { leaderboard_total_mismatch: 2 }; }).join('\n')).toContain('findingCounts does not match');
    expect(edit((r) => { r.findings[0].detail = { nested: { a: 1 } }; }).join('\n')).toContain('detail.nested');
  });

  it('rejects a winner field, leaders on a refused result, a wrong tie flag and an incomplete season with leaders', () => {
    expect(edit((r) => { r.awardResultPresentation.winner = 1001; }).join('\n')).toContain('must not carry a winner field');
    expect(edit((r) => { r.awardResultPresentation.leaders = [{ playerId: 1001, votes: 6 }]; }).join('\n'))
      .toContain('only a determined result carries leaders');
    const determined = reconcileBrownlowSeason(syntheticSeason());
    const mutate = (fn: (r: Loose) => void): string[] => {
      const copy = JSON.parse(JSON.stringify(determined)) as Loose;
      fn(copy);
      return validateBrownlowReconciliationReport(copy);
    };
    expect(mutate((r) => { r.awardResultPresentation.tie = true; }).join('\n')).toContain('tie must be true exactly when');
    expect(mutate((r) => { r.source.seasonState = 'in_progress'; }).join('\n')).toContain('seasonState must equal');
    expect(mutate((r) => { r.source.seasonState = 'in_progress'; r.awardResultPresentation.seasonState = 'in_progress'; }).join('\n'))
      .toContain('an in-progress season cannot have a determined result');
    expect(mutate((r) => { r.awardResultPresentation.leaders.push({ playerId: 1002, votes: 2 }); }).join('\n')).toContain('share one vote total');
  });

  it('rejects unsorted matches and totals, and comparisons that did not run yet report counts', () => {
    expect(edit((r) => { r.rawVotes.matches.reverse(); }).join('\n')).toContain('matches is not sorted');
    expect(edit((r) => { r.rawVotes.playerTotals.reverse(); }).join('\n')).toContain('playerTotals is not sorted');
    expect(edit((r) => { r.rawVotes.comparisons.stored = { state: 'not_run', compared: 2, mismatches: 0 }; }).join('\n'))
      .toContain('did not run');
    expect(edit((r) => { r.rawVotes.basis = 'guess'; }).join('\n')).toContain('rawVotes.basis');
  });
});

describe('the JSON Schema and the code table agree with the validator', () => {
  it('lists the same required keys and every finding code and severity', () => {
    const schema = BROWNLOW_RECONCILIATION_REPORT_JSON_SCHEMA;
    expect([...schema.required]).toEqual([...BROWNLOW_REPORT_REQUIRED.report]);
    expect(schema.properties.format.const).toBe(BROWNLOW_RECONCILIATION_REPORT_FORMAT);
    expect([...schema.properties.findings.items.properties.code.enum].sort()).toEqual(Object.keys(BROWNLOW_FINDING_CODES).sort());
    expect([...schema.properties.findings.items.properties.severity.enum]).toEqual([...BROWNLOW_FINDING_SEVERITIES]);
    expect([...schema.properties.awardResultPresentation.properties.status.enum]).toEqual([...BROWNLOW_AWARD_STATUSES]);
    expect(schema.properties.awardResultPresentation.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties.awardResultPresentation.properties).sort()).not.toContain('winner');
  });

  it('every finding code carries a known severity', () => {
    for (const code of Object.keys(BROWNLOW_FINDING_CODES)) {
      expect(BROWNLOW_FINDING_SEVERITIES).toContain(BROWNLOW_FINDING_CODES[code as BrownlowFindingCode]);
    }
  });
});
