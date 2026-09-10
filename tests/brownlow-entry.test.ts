/**
 * AFLDB-ISSUE-155 Phase C1 — the pure Brownlow entry rules (§27.27).
 *
 * These are the rules four separate transactions all depend on, so they
 * are tested here once, without a database, rather than four times
 * through one. The cases that matter most are the ones that encode
 * measured facts about the data — the 18-row line-up threshold (P8/P8b),
 * imported completeness counting as accounted (P6), and season rows
 * being sparse-positive (P4) — because those are the ones a future
 * reader would otherwise be tempted to "simplify".
 */
import { describe, expect, it } from 'vitest';

import { MANUAL_ATTENDANCE_SOURCE_KEY } from '@/lib/acquisition/manual-authority';
import {
  BROWNLOW_MANUAL_SOURCE_KEY,
  MIN_CLUB_LINEUP_ROWS,
  REASON_MAX_LENGTH,
  type BrownlowSelection,
  type CanonicalRoundRow,
  type MatchParticipant,
  asCompleteSelection,
  assessParticipants,
  brownlowRefusal,
  brownlowRefusalMessage,
  canonicalFingerprint,
  checkTransition,
  classifyMatchAssignment,
  deriveSeasonRows,
  entrySourceRecordId,
  isMatchAccounted,
  publishSourceRecordId,
  reasonRequired,
  seasonRoundCoverage,
  seasonStatusLabel,
  validateReason,
  validateSelection,
  votesForPlayer,
} from '@/lib/brownlow/entry';

const HOME = 1;
const AWAY = 2;

/** A line-up of `perClub` players a side, ids 100+ home and 200+ away. */
function lineup(perClub: number, awayPerClub = perClub): MatchParticipant[] {
  const rows: MatchParticipant[] = [];
  for (let i = 0; i < perClub; i += 1) rows.push({ playerId: 100 + i, clubId: HOME });
  for (let i = 0; i < awayPerClub; i += 1) rows.push({ playerId: 200 + i, clubId: AWAY });
  return rows;
}

function participantIds(rows: readonly MatchParticipant[]): Set<number> {
  return new Set(rows.map((row) => row.playerId));
}

/* ------------------------------------------------------------------ *
 * Selection
 * ------------------------------------------------------------------ */

describe('validateSelection', () => {
  const ids = participantIds(lineup(22));

  it('accepts a complete 3/2/1 of three distinct participants', () => {
    const result = validateSelection(
      { three: 100, two: 201, one: 105 },
      ids,
      { requireComplete: true },
    );
    expect(result).toEqual({ ok: true, value: { three: 100, two: 201, one: 105 } });
  });

  it('accepts a partial selection for a draft and refuses it for a finalisation', () => {
    const partial = { three: 100, two: null, one: null };
    expect(validateSelection(partial, ids, { requireComplete: false }).ok).toBe(true);

    const final = validateSelection(partial, ids, { requireComplete: true });
    expect(final).toMatchObject({ ok: false, code: 'incomplete' });
  });

  const incomplete: [string, BrownlowSelection][] = [
    ['three', { three: null, two: 201, one: 105 }],
    ['two', { three: 100, two: null, one: 105 }],
    ['one', { three: 100, two: 201, one: null }],
  ];
  it.each(incomplete)('refuses a finalisation missing the %s vote', (_slot, selection) => {
    expect(validateSelection(selection, ids, { requireComplete: true }))
      .toMatchObject({ ok: false, code: 'incomplete' });
  });

  it('accepts an entirely empty draft (clearing a selection)', () => {
    expect(validateSelection(
      { three: null, two: null, one: null },
      ids,
      { requireComplete: false },
    ).ok).toBe(true);
  });

  it('refuses the same player in two slots, even in a draft', () => {
    expect(validateSelection(
      { three: 100, two: 100, one: 105 },
      ids,
      { requireComplete: false },
    )).toMatchObject({ ok: false, code: 'duplicate_player' });
  });

  it('refuses a player with no line-up row in this match', () => {
    expect(validateSelection(
      { three: 999, two: 201, one: 105 },
      ids,
      { requireComplete: true },
    )).toMatchObject({ ok: false, code: 'not_participant' });
  });

  it('names the non-participant before the duplicate when a submission is both', () => {
    // Order is pinned deliberately (§27.17 step 2): the operator can see
    // the unknown player on screen, so that is the error worth reporting.
    const result = validateSelection(
      { three: 999, two: 201, one: 201 },
      ids,
      { requireComplete: true },
    );
    expect(result).toMatchObject({ ok: false, code: 'not_participant' });
  });

  it.each([0, -3, 1.5, Number.NaN])('refuses %s as a player id', (value) => {
    expect(validateSelection(
      { three: value, two: 201, one: 105 },
      ids,
      { requireComplete: false },
    )).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('accepts a plain iterable of participant ids, not only a Set', () => {
    expect(validateSelection(
      { three: 100, two: 201, one: 105 },
      [100, 201, 105],
      { requireComplete: true },
    ).ok).toBe(true);
  });
});

describe('votesForPlayer', () => {
  const selection = asCompleteSelection({ three: 10, two: 20, one: 30 });

  it('awards 3, 2 and 1 to the selected players', () => {
    expect(votesForPlayer(selection, 10)).toBe(3);
    expect(votesForPlayer(selection, 20)).toBe(2);
    expect(votesForPlayer(selection, 30)).toBe(1);
  });

  it('awards a published zero to every other participant', () => {
    // The dense-row contract (P1): a non-selected participant is demoted
    // to zero, never deleted, so this must answer 0 and not null.
    expect(votesForPlayer(selection, 40)).toBe(0);
  });

  it('refuses to narrow an incomplete selection', () => {
    expect(() => asCompleteSelection({ three: 10, two: null, one: 30 })).toThrow();
  });
});

/* ------------------------------------------------------------------ *
 * Participants
 * ------------------------------------------------------------------ */

describe('assessParticipants', () => {
  it('accepts the smallest complete line-up', () => {
    const result = assessParticipants(lineup(MIN_CLUB_LINEUP_ROWS), HOME, AWAY);
    expect(result).toMatchObject({
      complete: true, homeCount: 18, awayCount: 18, foreignCount: 0, shortfall: null,
    });
  });

  it('refuses a 17-a-side match and says which side is short', () => {
    // P8b: all seven sub-18 matches in the data are unfinished 2026
    // imports whose opponent has 19-22 rows. Lowering the threshold to
    // the observed minimum would let an unfinished import be finalised.
    const result = assessParticipants(lineup(17, 22), HOME, AWAY);
    expect(result.complete).toBe(false);
    expect(result.homeCount).toBe(17);
    expect(result.awayCount).toBe(22);
    expect(result.shortfall).toContain('home line-up has 17 of 18');
  });

  it('reports both sides when both are short', () => {
    const result = assessParticipants(lineup(5, 6), HOME, AWAY);
    expect(result.shortfall).toContain('home line-up has 5 of 18');
    expect(result.shortfall).toContain('away line-up has 6 of 18');
  });

  it('refuses a line-up carrying a row for a third club', () => {
    const rows = [...lineup(20), { playerId: 900, clubId: 77 }];
    const result = assessParticipants(rows, HOME, AWAY);
    expect(result.foreignCount).toBe(1);
    expect(result.complete).toBe(false);
    expect(result.shortfall).toContain('neither club');
  });

  it('handles an empty line-up without dividing by anything', () => {
    expect(assessParticipants([], HOME, AWAY))
      .toMatchObject({ complete: false, homeCount: 0, awayCount: 0 });
  });
});

/* ------------------------------------------------------------------ *
 * State machine
 * ------------------------------------------------------------------ */

describe('checkTransition', () => {
  it('lets a draft be created and updated', () => {
    expect(checkTransition(null, 'saveDraft')).toEqual({ ok: true, value: { to: 'draft' } });
    expect(checkTransition('draft', 'saveDraft')).toEqual({ ok: true, value: { to: 'draft' } });
  });

  it('finalises from nothing, from a draft and from a void', () => {
    expect(checkTransition(null, 'finalise')).toEqual({ ok: true, value: { to: 'final' } });
    expect(checkTransition('draft', 'finalise')).toEqual({ ok: true, value: { to: 'final' } });
    expect(checkTransition('void', 'finalise')).toEqual({ ok: true, value: { to: 'final' } });
  });

  it('refuses a second finalisation and points at Correct', () => {
    const result = checkTransition('final', 'finalise');
    expect(result).toMatchObject({ ok: false, code: 'already_final' });
    expect((result as { message: string }).message).toContain('Correct');
  });

  it('never reopens a finalised match into a draft', () => {
    // final -> draft does not exist: it would withdraw a published fact
    // with no audit of the withdrawal (§27.7).
    expect(checkTransition('final', 'saveDraft')).toMatchObject({
      ok: false, code: 'already_final',
    });
    expect(checkTransition('void', 'saveDraft')).toMatchObject({
      ok: false, code: 'already_final',
    });
  });

  it('corrects only a finalised match', () => {
    expect(checkTransition('final', 'correct')).toEqual({ ok: true, value: { to: 'final' } });
    expect(checkTransition(null, 'correct')).toMatchObject({ ok: false, code: 'not_final' });
    expect(checkTransition('draft', 'correct')).toMatchObject({ ok: false, code: 'not_final' });
    expect(checkTransition('void', 'correct')).toMatchObject({ ok: false, code: 'not_final' });
  });

  it('voids anything that is not already void', () => {
    expect(checkTransition(null, 'void')).toEqual({ ok: true, value: { to: 'void' } });
    expect(checkTransition('draft', 'void')).toEqual({ ok: true, value: { to: 'void' } });
    expect(checkTransition('final', 'void')).toEqual({ ok: true, value: { to: 'void' } });
    expect(checkTransition('void', 'void')).toMatchObject({ ok: false, code: 'already_final' });
  });
});

describe('reasonRequired', () => {
  it('requires a reason for every correction and every void', () => {
    expect(reasonRequired('final', 'correct')).toBe(true);
    expect(reasonRequired('final', 'void')).toBe(true);
    expect(reasonRequired(null, 'void')).toBe(true);
  });

  it('requires a reason to bring a voided match back to a decision', () => {
    expect(reasonRequired('void', 'finalise')).toBe(true);
  });

  it('does not require one for an ordinary draft or first finalisation', () => {
    expect(reasonRequired(null, 'saveDraft')).toBe(false);
    expect(reasonRequired('draft', 'saveDraft')).toBe(false);
    expect(reasonRequired('draft', 'finalise')).toBe(false);
  });
});

describe('validateReason', () => {
  it('trims and accepts a reason', () => {
    expect(validateReason('  transcription error  ', { required: true }))
      .toEqual({ ok: true, value: 'transcription error' });
  });

  it('refuses an absent reason where one is required', () => {
    expect(validateReason('   ', { required: true }))
      .toMatchObject({ ok: false, code: 'invalid' });
    expect(validateReason(null, { required: true }))
      .toMatchObject({ ok: false, code: 'invalid' });
  });

  it('allows no reason where none is required', () => {
    expect(validateReason(undefined, { required: false })).toEqual({ ok: true, value: null });
  });

  it('refuses a one-word-too-short reason', () => {
    expect(validateReason('ok', { required: true })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('accepts exactly the database limit and refuses one character more', () => {
    // The bound matches the last_reason CHECK, so a reason that passes
    // here cannot turn into a db_error at the database.
    expect(validateReason('x'.repeat(REASON_MAX_LENGTH), { required: true }).ok).toBe(true);
    expect(validateReason('x'.repeat(REASON_MAX_LENGTH + 1), { required: true }))
      .toMatchObject({ ok: false, code: 'invalid' });
  });
});

/* ------------------------------------------------------------------ *
 * Fingerprint
 * ------------------------------------------------------------------ */

describe('canonicalFingerprint', () => {
  const rows: CanonicalRoundRow[] = [
    { playerId: 10, votes: 3, sourceId: 4, matchId: 7 },
    { playerId: 20, votes: 2, sourceId: 4, matchId: 7 },
    { playerId: 30, votes: 1, sourceId: 4, matchId: 7 },
  ];

  it('is stable across row order', () => {
    expect(canonicalFingerprint(rows))
      .toBe(canonicalFingerprint([rows[2], rows[0], rows[1]]));
  });

  it('changes when a vote value moves to another player', () => {
    const moved: CanonicalRoundRow[] = [
      { playerId: 10, votes: 3, sourceId: 4, matchId: 7 },
      { playerId: 21, votes: 2, sourceId: 4, matchId: 7 },
      { playerId: 30, votes: 1, sourceId: 4, matchId: 7 },
    ];
    expect(canonicalFingerprint(moved)).not.toBe(canonicalFingerprint(rows));
  });

  it('changes when a settle rewrites the provenance of a row', () => {
    const reprovenanced = rows.map((row, i) => (i === 0 ? { ...row, sourceId: 9 } : row));
    expect(canonicalFingerprint(reprovenanced)).not.toBe(canonicalFingerprint(rows));
  });

  it('changes when an unresolved positive row appears for a participant', () => {
    const withUnresolved: CanonicalRoundRow[] = [
      ...rows,
      { playerId: 40, votes: 1, sourceId: 9, matchId: null },
    ];
    expect(canonicalFingerprint(withUnresolved)).not.toBe(canonicalFingerprint(rows));
  });

  it('ignores the dense zero background', () => {
    // ~40 zero rows per match (P1). Including them would churn the
    // digest on every line-up edit that has nothing to do with votes.
    const withZeros: CanonicalRoundRow[] = [
      ...rows,
      { playerId: 41, votes: 0, sourceId: 4, matchId: 7 },
      { playerId: 42, votes: 0, sourceId: 4, matchId: 7 },
    ];
    expect(canonicalFingerprint(withZeros)).toBe(canonicalFingerprint(rows));
  });

  it('ignores rows a void has emptied', () => {
    const withVoided: CanonicalRoundRow[] = [
      ...rows,
      { playerId: 43, votes: null, sourceId: 4, matchId: 7 },
    ];
    expect(canonicalFingerprint(withVoided)).toBe(canonicalFingerprint(rows));
  });

  it('gives an empty match a stable digest of its own', () => {
    expect(canonicalFingerprint([])).toBe(canonicalFingerprint([]));
    expect(canonicalFingerprint([])).not.toBe(canonicalFingerprint(rows));
    expect(canonicalFingerprint([])).toMatch(/^[0-9a-f]{64}$/);
  });
});

/* ------------------------------------------------------------------ *
 * Match and season coverage (operator decision D1)
 * ------------------------------------------------------------------ */

describe('classifyMatchAssignment', () => {
  const textbook: CanonicalRoundRow[] = [
    { playerId: 10, votes: 3, sourceId: null, matchId: 7 },
    { playerId: 20, votes: 2, sourceId: null, matchId: 7 },
    { playerId: 30, votes: 1, sourceId: null, matchId: 7 },
  ];

  it('calls a textbook 3/2/1 complete', () => {
    expect(classifyMatchAssignment(textbook)).toBe('complete');
  });

  it('is not fooled by the dense zero rows around it', () => {
    const dense = [
      ...textbook,
      ...Array.from({ length: 40 }, (_, i): CanonicalRoundRow => (
        { playerId: 100 + i, votes: 0, sourceId: null, matchId: 7 }
      )),
    ];
    expect(classifyMatchAssignment(dense)).toBe('complete');
  });

  it('calls a match with no votes none', () => {
    expect(classifyMatchAssignment([])).toBe('none');
    expect(classifyMatchAssignment([{ playerId: 10, votes: 0, sourceId: null, matchId: 7 }]))
      .toBe('none');
    expect(classifyMatchAssignment([{ playerId: 10, votes: null, sourceId: null, matchId: 7 }]))
      .toBe('none');
  });

  const partials: [string, { p: number; v: number }[]][] = [
    ['only two votes', [{ p: 10, v: 3 }, { p: 20, v: 2 }]],
    ['a duplicated value', [{ p: 10, v: 3 }, { p: 20, v: 3 }, { p: 30, v: 1 }]],
    ['a missing value', [{ p: 10, v: 3 }, { p: 20, v: 3 }, { p: 30, v: 2 }]],
    ['four positive rows', [{ p: 10, v: 3 }, { p: 20, v: 2 }, { p: 30, v: 1 }, { p: 40, v: 1 }]],
  ];
  it.each(partials)('calls %s partial', (_label, spec) => {
    const rows = spec.map((s): CanonicalRoundRow => (
      { playerId: s.p, votes: s.v, sourceId: null, matchId: 7 }
    ));
    expect(classifyMatchAssignment(rows)).toBe('partial');
  });
});

describe('isMatchAccounted', () => {
  it('counts imported source facts with no workflow row', () => {
    // The compatibility requirement of D1: 7,413 matches of 1984-2025
    // are complete on the facts alone and have no entry-state row (P6).
    expect(isMatchAccounted('complete', null)).toBe(true);
  });

  it('counts an explicit void as a decision, not a gap', () => {
    expect(isMatchAccounted('none', 'void')).toBe(true);
    expect(isMatchAccounted('partial', 'void')).toBe(true);
  });

  it('does not count a draft, a partial set, or nothing at all', () => {
    expect(isMatchAccounted('none', null)).toBe(false);
    expect(isMatchAccounted('none', 'draft')).toBe(false);
    expect(isMatchAccounted('partial', null)).toBe(false);
    expect(isMatchAccounted('partial', 'draft')).toBe(false);
  });
});

describe('seasonRoundCoverage', () => {
  it('is complete only when every home-and-away match is accounted for', () => {
    expect(seasonRoundCoverage({ expectedMatches: 176, accountedMatches: 176 }))
      .toBe('complete');
  });

  it('is partial when one hand-entered match sits in an otherwise empty season', () => {
    // The defect D1 fixes: migration 016 called any row at all
    // "complete", so entering one 1950 match flipped the whole season.
    expect(seasonRoundCoverage({ expectedMatches: 102, accountedMatches: 1 }))
      .toBe('partial');
  });

  it('is none when nothing is accounted for', () => {
    expect(seasonRoundCoverage({ expectedMatches: 102, accountedMatches: 0 })).toBe('none');
  });

  it('reports none rather than complete for a season with no matches', () => {
    expect(seasonRoundCoverage({ expectedMatches: 0, accountedMatches: 0 })).toBe('none');
  });
});

/* ------------------------------------------------------------------ *
 * Season derivation
 * ------------------------------------------------------------------ */

describe('deriveSeasonRows', () => {
  /** Three rounds of a tiny season: 10 leads, 20 and 30 behind. */
  const facts = [
    { playerId: 10, votes: 3 }, { playerId: 20, votes: 2 }, { playerId: 30, votes: 1 },
    { playerId: 10, votes: 3 }, { playerId: 30, votes: 2 }, { playerId: 20, votes: 1 },
    { playerId: 20, votes: 3 }, { playerId: 10, votes: 2 }, { playerId: 40, votes: 1 },
  ];
  const games = new Map([[10, 22], [20, 21], [30, 20], [40, 18]]);

  function derive(overrides: Partial<Parameters<typeof deriveSeasonRows>[0]> = {}) {
    const result = deriveSeasonRows({
      facts, ineligiblePlayerIds: [], homeAndAwayGames: games, ...overrides,
    });
    if (!result.ok) throw new Error(`unexpected refusal: ${result.message}`);
    return result.value;
  }

  it('totals votes and counts 3/2/1 games and polling games per player', () => {
    const rows = derive();
    expect(rows.find((r) => r.playerId === 10)).toMatchObject({
      votes: 8, threeVoteGames: 2, twoVoteGames: 1, oneVoteGames: null, pollingGames: 3,
    });
    expect(rows.find((r) => r.playerId === 20)).toMatchObject({
      votes: 6, threeVoteGames: 1, twoVoteGames: 1, oneVoteGames: 1, pollingGames: 3,
    });
    expect(rows.find((r) => r.playerId === 40)).toMatchObject({
      votes: 1, threeVoteGames: null, twoVoteGames: null, oneVoteGames: 1, pollingGames: 1,
    });
  });

  it('stores a zero 3/2/1 count as NULL, the way the artefact does', () => {
    // P13j: across 1984-2025 the stored counts equal the exact count of
    // canonical 3/2/1 rows wherever they are populated (aggregates
    // identical, zero populated-and-wrong rows, no transposition), and
    // every row whose derived count is zero carries NULL rather than 0.
    // A manual row storing 0 would be distinguishable from a
    // source-published one, which is the whole thing this avoids.
    const rows = derive({
      facts: [{ playerId: 10, votes: 2 }, { playerId: 10, votes: 2 }],
      homeAndAwayGames: new Map([[10, 22]]),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      votes: 4,
      threeVoteGames: null,
      twoVoteGames: 2,
      oneVoteGames: null,
      pollingGames: 2,
    });
  });

  it('always populates pollingGames, which a positive-poller row can never have as zero', () => {
    // Only `three/two/one` take the NULL-for-zero convention. A season
    // row exists only where votes are positive, so polling_games is
    // positive on every row and NULL would be a different claim.
    const rows = derive();
    expect(rows.every((r) => typeof r.pollingGames === 'number' && r.pollingGames > 0)).toBe(true);
  });

  it('keeps both count identities under COALESCE, which is how they must be read', () => {
    for (const row of derive()) {
      const three = row.threeVoteGames ?? 0;
      const two = row.twoVoteGames ?? 0;
      const one = row.oneVoteGames ?? 0;
      expect(three + two + one).toBe(row.pollingGames);
      expect(3 * three + 2 * two + one).toBe(row.votes);
    }
  });

  it('emits a row only where votes are positive', () => {
    // brownlow_season_votes is sparse-positive output (P4: zero
    // zero-vote rows in 16,120). The dense zero rows of the round grain
    // have no season-grain equivalent.
    const rows = derive({
      facts: [...facts, { playerId: 55, votes: 0 }, { playerId: 56, votes: null }],
      homeAndAwayGames: new Map([...games, [55, 20], [56, 20]]),
    });
    expect(rows.map((r) => r.playerId)).not.toContain(55);
    expect(rows.map((r) => r.playerId)).not.toContain(56);
    expect(rows.every((r) => r.votes > 0)).toBe(true);
  });

  it('ranks by competition ranking, so a tie leaves a gap after it', () => {
    const rows = deriveSeasonRows({
      facts: [
        { playerId: 10, votes: 3 }, { playerId: 20, votes: 3 }, { playerId: 30, votes: 1 },
      ],
      ineligiblePlayerIds: [],
      homeAndAwayGames: new Map([[10, 22], [20, 22], [30, 22]]),
    });
    if (!rows.ok) throw new Error(rows.message);
    expect(rows.value.map((r) => [r.playerId, r.votes, r.voteRank])).toEqual([
      [10, 3, 1], [20, 3, 1], [30, 1, 3],
    ]);
  });

  it('makes both players winners when the lead is tied', () => {
    const result = deriveSeasonRows({
      facts: [
        { playerId: 10, votes: 3 }, { playerId: 20, votes: 3 }, { playerId: 30, votes: 1 },
      ],
      ineligiblePlayerIds: [],
      homeAndAwayGames: new Map([[10, 22], [20, 22], [30, 22]]),
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.value.filter((r) => r.isWinner).map((r) => r.playerId)).toEqual([10, 20]);
  });

  it('gives an ineligible leader no eligible rank and no medal', () => {
    const rows = derive({ ineligiblePlayerIds: [10] });
    const leader = rows.find((r) => r.playerId === 10);
    expect(leader).toMatchObject({ votes: 8, isIneligible: true, isWinner: false });
    expect(leader?.eligibleRank).toBeNull();

    // The next eligible player wins, ranked first among the eligible.
    const runnerUp = rows.find((r) => r.playerId === 20);
    expect(runnerUp).toMatchObject({ eligibleRank: 1, isWinner: true, isIneligible: false });
  });

  it('keeps the ineligible player in the overall vote ranking', () => {
    const rows = derive({ ineligiblePlayerIds: [10] });
    expect(rows.find((r) => r.playerId === 10)?.voteRank).toBe(1);
    expect(rows.find((r) => r.playerId === 20)?.voteRank).toBe(2);
  });

  it('carries the home-and-away games count through, not the full season count', () => {
    // P13(i): bsv.games equals player_season_stats.games - finals on all
    // 16,120 rows across all 98 seasons (the all-games reading disagrees
    // on 6,507), so the caller passes H&A games and this only copies it.
    expect(derive().find((r) => r.playerId === 10)?.games).toBe(22);
  });

  it('stamps every manual row as a unique link', () => {
    // P10: a Super Admin picks the player by primary key, which is the
    // strongest link there is; `resolved` describes a disambiguated name.
    expect(derive().every((r) => r.linkStatusValue === 'unique')).toBe(true);
  });

  it('orders rows by votes descending then player id, so a re-publish is identical', () => {
    expect(derive().map((r) => r.playerId)).toEqual([10, 20, 30, 40]);
  });

  it('refuses rather than defaulting when a polled player has no games record', () => {
    const result = deriveSeasonRows({
      facts, ineligiblePlayerIds: [], homeAndAwayGames: new Map([[10, 22], [20, 21]]),
    });
    expect(result).toMatchObject({ ok: false, code: 'invalid' });
    expect((result as { message: string }).message).toContain('30, 40');
  });

  it('refuses an ineligible player who never polled', () => {
    expect(deriveSeasonRows({ facts, ineligiblePlayerIds: [77], homeAndAwayGames: games }))
      .toMatchObject({ ok: false, code: 'invalid' });
  });

  it('refuses an impossible vote value', () => {
    expect(deriveSeasonRows({
      facts: [{ playerId: 10, votes: 4 }],
      ineligiblePlayerIds: [],
      homeAndAwayGames: new Map([[10, 22]]),
    })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('produces no rows for a season nobody polled in', () => {
    const result = deriveSeasonRows({
      facts: [], ineligiblePlayerIds: [], homeAndAwayGames: new Map(),
    });
    expect(result).toEqual({ ok: true, value: [] });
  });
});

/* ------------------------------------------------------------------ *
 * Refusals and provenance
 * ------------------------------------------------------------------ */

describe('refusal messages', () => {
  it('gives every code a sentence with no placeholder left in it', () => {
    const codes = [
      'not_found', 'not_home_and_away', 'season_not_polled', 'not_participant',
      'duplicate_player', 'incomplete', 'participants_incomplete', 'already_final',
      'not_final', 'stale', 'invalid', 'season_incomplete', 'forbidden', 'db_error',
    ] as const;
    for (const code of codes) {
      const message = brownlowRefusalMessage(code);
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toMatch(/\$\{|TODO|undefined/);
    }
  });

  it('appends a detail sentence without losing the rule', () => {
    const refusal = brownlowRefusal('participants_incomplete', 'Currently the home line-up has 14 of 18.');
    expect(refusal.code).toBe('participants_incomplete');
    expect(refusal.message).toContain('complete line-up');
    expect(refusal.message).toContain('14 of 18');
  });

  it('tells a stale editor to reload rather than blaming them', () => {
    expect(brownlowRefusalMessage('stale')).toContain('Reload');
  });

  it('promises nothing was written when the database refuses', () => {
    expect(brownlowRefusalMessage('db_error')).toContain('nothing was written');
  });
});

describe('seasonStatusLabel', () => {
  const base = {
    polled: true,
    expectedMatches: 198,
    accountedMatches: 0,
    startedMatches: 0,
    authority: 'none' as const,
    revision: 0,
    publishedRevision: null as number | null,
  };

  it('calls a season with no medal not_polled whatever else is true', () => {
    // The war years and everything before 1924. Nothing about entry state
    // can make a season that awarded no medal into one that did.
    expect(seasonStatusLabel({
      ...base, polled: false, accountedMatches: 198, authority: 'source',
    })).toBe('not_polled');
  });

  it('separates a season nobody has touched from one part-way through', () => {
    expect(seasonStatusLabel(base)).toBe('not_started');
    expect(seasonStatusLabel({ ...base, startedMatches: 3 })).toBe('in_progress');
  });

  it('calls a complete but unpublished season entered', () => {
    expect(seasonStatusLabel({
      ...base, accountedMatches: 198, startedMatches: 198,
    })).toBe('entered');
  });

  it('keeps a source-published season legible while entry is unfinished', () => {
    // 42 seasons of imported round facts are complete on arrival; the ones
    // that are not must not read as though nobody had ever recorded them.
    expect(seasonStatusLabel({
      ...base, authority: 'source', startedMatches: 100, accountedMatches: 100,
    })).toBe('source_published');
  });

  it('reports a published season, and marks it stale when the match set moved', () => {
    const published = {
      ...base, authority: 'manual' as const, accountedMatches: 198,
      startedMatches: 198, revision: 7, publishedRevision: 7,
    };
    expect(seasonStatusLabel(published)).toBe('published');
    expect(seasonStatusLabel({ ...published, revision: 8 })).toBe('published_stale');
  });

  it('prefers published_stale over entered, because they need different fixes', () => {
    // A published season whose matches have since changed is complete on
    // the counts; calling it `entered` would hide that the public totals
    // no longer match the facts they were derived from.
    expect(seasonStatusLabel({
      ...base, authority: 'manual', accountedMatches: 198, startedMatches: 198,
      revision: 9, publishedRevision: 8,
    })).toBe('published_stale');
  });
});

describe('provenance', () => {
  it('uses the one manual source key the settle already refuses to overwrite', () => {
    expect(BROWNLOW_MANUAL_SOURCE_KEY).toBe(MANUAL_ATTENDANCE_SOURCE_KEY);
    expect(BROWNLOW_MANUAL_SOURCE_KEY).toBe('manual_admin_edit');
  });

  it('builds record ids that name the decision and its revision', () => {
    expect(entrySourceRecordId(17730, 4)).toBe('entry:17730:r4');
    expect(publishSourceRecordId(1950, 2)).toBe('publish:1950:r2');
  });
});
