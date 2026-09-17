/**
 * The after_siren grain against the real `afldb_test` database
 * (AFLDB-ISSUE-152 Phase C).
 *
 * Every assertion is compared against an INDEPENDENTLY HAND-WRITTEN SQL
 * query rather than against a number copied out of the issue's evidence
 * pack: two code paths agreeing is evidence, one code path agreeing with
 * itself is not. Where the issue records a measured witness (Billy
 * Schmidt 1913, the Hall/Rohan tie, the four goals against the Richmond
 * lineage) the witness is asserted as well, because a query that returns
 * the right COUNT of the wrong rows would otherwise pass.
 *
 * The two rules this suite exists to protect above all:
 *
 *  - "a goal after the siren" and "a goal after the siren TO WIN" are
 *    different populations and must never compile to the same predicate;
 *  - a match-unlinked row answers everything EXCEPT ordering and finals
 *    scope (D10, §7.1), and no unlinked row may ever win "most recent".
 */
import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { answerAfterSiren } from '@/db/queries/nl/after-siren';
import { getAfterSirenRecords } from '@/db/queries/after-siren';
import { afterSirenRequiresMatchLink, validatePlan, type NlAfterSiren, type NlQueryPlan } from '@/search/nl/plan';
import type {
  NlAfterSirenEventRow, NlAfterSirenExclusions, NlAfterSirenPlayerRow, NlAnswerPayload,
} from '@/search/nl/answer-types';

afterAll(async () => {
  await sql.end();
});

function plan(overrides: Partial<NlQueryPlan> & { afterSiren: NlAfterSiren }): NlQueryPlan {
  const raw: NlQueryPlan = {
    v: 1,
    grain: 'after_siren',
    metric: 'siren_kicks',
    agg: { kind: 'list' },
    scope: {},
    careerConditions: [],
    careerPredicates: [],
    clubSeasonConditions: [],
    tiePolicy: 'all',
    limit: 100,
    ...overrides,
  };
  const validated = validatePlan(raw);
  if ('error' in validated) throw new Error(`plan did not validate: ${validated.error}`);
  return validated;
}

async function events(p: NlQueryPlan, limit = 100): Promise<{
  lead: NlAfterSirenEventRow | null; rows: NlAfterSirenEventRow[]; total: number; excluded: NlAfterSirenExclusions;
}> {
  const payload: NlAnswerPayload = await answerAfterSiren(p, limit);
  if (payload.kind !== 'after_siren_event') throw new Error(`expected after_siren_event, got ${payload.kind}`);
  return payload;
}

async function players(p: NlQueryPlan, limit = 100): Promise<{
  lead: NlAfterSirenPlayerRow | null; rows: NlAfterSirenPlayerRow[]; total: number; excluded: NlAfterSirenExclusions;
}> {
  const payload: NlAnswerPayload = await answerAfterSiren(p, limit);
  if (payload.kind !== 'after_siren_player') throw new Error(`expected after_siren_player, got ${payload.kind}`);
  return payload;
}

async function count(p: NlQueryPlan): Promise<number> {
  const payload: NlAnswerPayload = await answerAfterSiren(p, 100);
  if (payload.kind !== 'count') throw new Error(`expected count, got ${payload.kind}`);
  return payload.value;
}

/** One hand-written scalar, written against the table directly. */
async function scalar(query: Promise<{ n: string }[]>): Promise<number> {
  const [row] = await query;
  return Number(row?.n ?? 0);
}

describe('after_siren — the three dimensions are independent', () => {
  it('a goal after the siren and a goal after the siren TO WIN are different counts', async () => {
    const goal = await count(plan({ agg: { kind: 'count' }, afterSiren: { subject: 'event', kickScored: 'goal' } }));
    const toWin = await count(plan({
      agg: { kind: 'count' }, afterSiren: { subject: 'event', kickScored: 'goal', kickEffect: 'won' },
    }));

    const goalSql = await scalar(sql<{ n: string }[]>`
      SELECT count(*) AS n FROM after_siren_kicks WHERE kick_scored = 'goal'
    `);
    const toWinSql = await scalar(sql<{ n: string }[]>`
      SELECT count(*) AS n FROM after_siren_kicks WHERE kick_scored = 'goal' AND kick_effect = 'won'
    `);

    expect(goal).toBe(goalSql);
    expect(toWin).toBe(toWinSql);
    // The binding inequality: two spellings of one question is exactly the
    // collision this grain must not reintroduce.
    expect(toWin).toBeLessThan(goal);
  });

  it('a miss and a miss-and-lost are different counts', async () => {
    const missed = await count(plan({ agg: { kind: 'count' }, afterSiren: { subject: 'event', kickScored: 'none' } }));
    const andLost = await count(plan({
      agg: { kind: 'count' }, afterSiren: { subject: 'event', kickScored: 'none', kickerResult: 'loss' },
    }));

    expect(missed).toBe(await scalar(sql<{ n: string }[]>`
      SELECT count(*) AS n FROM after_siren_kicks WHERE kick_scored = 'none'
    `));
    expect(andLost).toBe(await scalar(sql<{ n: string }[]>`
      SELECT count(*) AS n FROM after_siren_kicks WHERE kick_scored = 'none' AND kicker_result = 'loss'
    `));
    expect(andLost).toBeLessThan(missed);
  });

  it('kicker_result is independent of kick_effect: a scoreless kick whose side still won exists', async () => {
    const stillWon = await count(plan({
      agg: { kind: 'count' },
      afterSiren: { subject: 'event', kickScored: 'none', kickEffect: 'none', kickerResult: 'win' },
    }));
    expect(stillWon).toBe(await scalar(sql<{ n: string }[]>`
      SELECT count(*) AS n FROM after_siren_kicks
       WHERE kick_scored = 'none' AND kick_effect = 'none' AND kicker_result = 'win'
    `));
    expect(stillWon).toBeGreaterThan(0);
  });

  it('an absent kickScored means EVERY kick, including the misses', async () => {
    const all = await count(plan({ agg: { kind: 'count' }, afterSiren: { subject: 'event' } }));
    const scored = await count(plan({ agg: { kind: 'count' }, afterSiren: { subject: 'event', kickScored: 'goal' } }))
      + await count(plan({ agg: { kind: 'count' }, afterSiren: { subject: 'event', kickScored: 'behind' } }));

    expect(all).toBe(await scalar(sql<{ n: string }[]>`SELECT count(*) AS n FROM after_siren_kicks`));
    expect(all).toBeGreaterThan(scored);
  });
});

describe('after_siren — ranking is always a tie', () => {
  it('most goals after the siren returns every joint holder, checked against hand-written SQL', async () => {
    const { lead, rows } = await players(plan({
      agg: { kind: 'max' }, afterSiren: { subject: 'player', kickScored: 'goal' },
    }));

    const expected = await sql<{ player_id: number; n: string }[]>`
      SELECT player_id, count(*) AS n
        FROM after_siren_kicks
       WHERE player_id IS NOT NULL AND kick_scored = 'goal'
       GROUP BY player_id
      HAVING count(*) = (
        SELECT max(c) FROM (
          SELECT count(*) AS c FROM after_siren_kicks
           WHERE player_id IS NOT NULL AND kick_scored = 'goal'
           GROUP BY player_id
        ) t
      )
       ORDER BY player_id
    `;

    expect(lead).not.toBeNull();
    expect(rows.map((r) => r.playerId).sort((a, b) => a - b))
      .toEqual(expected.map((r) => r.player_id).sort((a, b) => a - b));
    expect(rows.every((r) => r.value === lead!.value)).toBe(true);
    // The measured holders, NAMED: a query returning the right COUNT of
    // the wrong players would otherwise pass. Two of them, so a headline
    // that names one is wrong by construction.
    expect(rows.map((r) => r.displayName).sort()).toEqual(['Barry Hall', 'Gary Rohan']);
    expect(lead!.value).toBe(2);
  });

  it('most kicks after the siren is a wider tie than most goals', async () => {
    const kicks = await players(plan({ agg: { kind: 'max' }, afterSiren: { subject: 'player' } }));
    const goals = await players(plan({ agg: { kind: 'max' }, afterSiren: { subject: 'player', kickScored: 'goal' } }));
    expect(kicks.rows.length).toBeGreaterThan(goals.rows.length);
    expect(kicks.rows.every((r) => r.value === kicks.lead!.value)).toBe(true);
    // Nine measured holders on 2. The wider tie is the point: an absent
    // kickScored counts every kick, including the misses, so more players
    // reach the ceiling than reach it on goals alone.
    expect(kicks.rows.map((r) => r.displayName).sort()).toEqual([
      'Barry Hall', 'Brad Johnson', 'David Mundy', 'Gary Rohan', 'Jack Riewoldt',
      'Malcolm Blight', 'Mitch McGovern', 'Stephen Kernahan', 'Tom Hawkins',
    ]);
  });

  it('a threshold above the measured ceiling is an honest EMPTY result, not a decline', async () => {
    const { rows, total } = await players(plan({
      agg: { kind: 'list' }, afterSiren: { subject: 'player', kickScored: 'goal' },
      metricCondition: { op: 'gte', value: 3 },
    }));
    const ceiling = await scalar(sql<{ n: string }[]>`
      SELECT COALESCE(max(c), 0) AS n FROM (
        SELECT count(*) AS c FROM after_siren_kicks
         WHERE player_id IS NOT NULL AND kick_scored = 'goal' GROUP BY player_id
      ) t
    `);
    expect(ceiling).toBeLessThan(3);
    expect(rows).toEqual([]);
    expect(total).toBe(0);
  });
});

describe('after_siren — club lineage', () => {
  /**
   * The measured lineage witness: the goals after the siren against the
   * RICHMOND organization include Bill Wood for FOOTSCRAY in 1946, whose
   * opponent row is a historical Richmond club identity. A raw club_id
   * comparison drops it.
   */
  it('opponent scope folds the whole organization lineage', async () => {
    const [richmond] = await sql<{ organization_id: number; id: number }[]>`
      SELECT organization_id, id FROM clubs WHERE slug = 'richmond'
    `;
    const { rows, total } = await events(plan({
      afterSiren: { subject: 'event', kickScored: 'goal' },
      scope: { clubAgainst: { organizationId: richmond.organization_id, slug: 'richmond', name: 'Richmond' } },
    }));

    const expected = await sql<{ id: number }[]>`
      SELECT a.id
        FROM after_siren_kicks a
       WHERE a.kick_scored = 'goal'
         AND a.opponent_club_id IN (SELECT id FROM clubs WHERE organization_id = ${richmond.organization_id})
       ORDER BY a.id
    `;
    expect(rows.map((r) => r.eventId).sort((a, b) => a - b)).toEqual(expected.map((r) => r.id));
    expect(total).toBe(expected.length);

    // The four measured events, NAMED. Bill Wood kicked his for FOOTSCRAY
    // in 1946 -- the lineage witness, and the row a raw club_id comparison
    // drops.
    expect(rows.map((r) => r.playerName).sort()).toEqual([
      'Bill Wood', 'David Mundy', 'Karmichael Hunt', 'Noah Anderson',
    ]);
    const wood = rows.find((r) => r.playerName === 'Bill Wood');
    expect(wood?.season).toBe(1946);
    expect(wood?.matchId).toBe(4486);
  });

  it('club scope is the KICKER\'s club and opponent scope is the other side', async () => {
    const [club] = await sql<{ organization_id: number }[]>`
      SELECT c.organization_id
        FROM after_siren_kicks a JOIN clubs c ON c.id = a.club_id
       GROUP BY c.organization_id ORDER BY count(*) DESC LIMIT 1
    `;
    const ref = { organizationId: club.organization_id, slug: 'x', name: 'X' };
    const forClub = await count(plan({ agg: { kind: 'count' }, afterSiren: { subject: 'event' }, scope: { clubFor: ref } }));
    const againstClub = await count(plan({ agg: { kind: 'count' }, afterSiren: { subject: 'event' }, scope: { clubAgainst: ref } }));

    expect(forClub).toBe(await scalar(sql<{ n: string }[]>`
      SELECT count(*) AS n FROM after_siren_kicks
       WHERE club_id IN (SELECT id FROM clubs WHERE organization_id = ${club.organization_id})
    `));
    expect(againstClub).toBe(await scalar(sql<{ n: string }[]>`
      SELECT count(*) AS n FROM after_siren_kicks
       WHERE opponent_club_id IN (SELECT id FROM clubs WHERE organization_id = ${club.organization_id})
    `));
  });
});

describe('after_siren — the match-link boundary (D10 §7.1)', () => {
  it('a match-unlinked row is COUNTED, listed and attributed', async () => {
    const unlinked = await scalar(sql<{ n: string }[]>`
      SELECT count(*) AS n FROM after_siren_kicks WHERE match_id IS NULL
    `);
    const all = await count(plan({ agg: { kind: 'count' }, afterSiren: { subject: 'event' } }));
    const total = await scalar(sql<{ n: string }[]>`SELECT count(*) AS n FROM after_siren_kicks`);
    // premiership_season is never the gate: every row is counted, link or
    // no link.
    expect(all).toBe(total);
    if (unlinked > 0) {
      const { rows } = await events(plan({ afterSiren: { subject: 'event' } }), 100);
      expect(rows.length).toBeGreaterThan(0);
    }
  });

  it('finals scope reads matches.round_type, never the free-text round_raw', async () => {
    const { rows, total } = await events(plan({
      afterSiren: { subject: 'event' }, scope: { matchType: 'finals' },
    }));
    const expected = await sql<{ id: number }[]>`
      SELECT a.id
        FROM after_siren_kicks a JOIN matches m ON m.id = a.match_id
       WHERE m.is_finals_series AND a.premiership_season
       ORDER BY a.id
    `;
    expect(rows.map((r) => r.eventId).sort((a, b) => a - b)).toEqual(expected.map((r) => r.id));
    expect(total).toBe(expected.length);
    expect(rows.every((r) => r.matchId !== null)).toBe(true);
  });

  /**
   * The single most likely wrong answer in this family. A round_raw of
   * 'GF' exists on a NON-premiership row (Kerry Good, 1980, North
   * Melbourne v Collingwood, Escort Championships), and no VFL/AFL Grand
   * Final after-siren event exists at all. An empty result is the correct
   * answer; returning the 1980 row is not.
   */
  it('"after the siren in a Grand Final" is EMPTY, and never the round_raw = GF row', async () => {
    const { rows, total } = await events(plan({
      afterSiren: { subject: 'event' }, scope: { matchType: 'grand_final' },
    }));
    const expected = await sql<{ id: number }[]>`
      SELECT a.id
        FROM after_siren_kicks a JOIN matches m ON m.id = a.match_id
       WHERE m.round_type = 'grand_final' AND a.premiership_season
    `;
    expect(rows.map((r) => r.eventId)).toEqual(expected.map((r) => r.id));
    expect(total).toBe(expected.length);

    const rawGf = await sql<{ id: number; premiership_season: boolean }[]>`
      SELECT id, premiership_season FROM after_siren_kicks WHERE round_raw ILIKE 'gf'
    `;
    for (const row of rawGf) {
      if (!row.premiership_season) expect(rows.map((r) => r.eventId)).not.toContain(row.id);
    }
  });

  it('the first kick after the siren is the earliest MATCH-LINKED event', async () => {
    const { lead } = await events(plan({ afterSiren: { subject: 'event', occurrence: 'first' } }), 1);
    const [expected] = await sql<{ id: number; season: number }[]>`
      SELECT a.id, a.season
        FROM after_siren_kicks a JOIN matches m ON m.id = a.match_id
       ORDER BY m.match_date ASC, a.id ASC
       LIMIT 1
    `;
    expect(lead).not.toBeNull();
    expect(lead!.eventId).toBe(expected.id);
    // The measured first event, and the season NL_COVERAGE.siren_kicks
    // takes its 1913 floor from.
    expect(lead!.playerName).toBe('Billy Schmidt');
    expect(lead!.season).toBe(1913);
    expect(lead!.matchId).toBe(1313);
  });

  it('the most recent kick is match-linked and is NEVER an unlinked later row', async () => {
    const { lead } = await events(plan({ afterSiren: { subject: 'event', occurrence: 'most_recent' } }), 1);
    const [expected] = await sql<{ id: number; season: number }[]>`
      SELECT a.id, a.season
        FROM after_siren_kicks a JOIN matches m ON m.id = a.match_id
       ORDER BY m.match_date DESC, a.id DESC
       LIMIT 1
    `;
    expect(lead).not.toBeNull();
    expect(lead!.eventId).toBe(expected.id);
    expect(lead!.matchId).not.toBeNull();
    expect(lead!.playerName).toBe('Nasiah Wanganeen-Milera');

    // An unlinked row in a LATER season must not have won: it cannot be
    // placed in a chronology at all, and the caveat says so.
    const laterUnlinked = await sql<{ id: number }[]>`
      SELECT id FROM after_siren_kicks WHERE match_id IS NULL AND season > ${lead!.season}
    `;
    expect(laterUnlinked.map((r) => r.id)).not.toContain(lead!.eventId);
  });

  it('afterSirenRequiresMatchLink agrees with what the compiler actually excluded', async () => {
    const ordered = plan({ afterSiren: { subject: 'event', occurrence: 'first' } });
    expect(afterSirenRequiresMatchLink(ordered)).toBe(true);
    const { excluded } = await events(ordered, 1);
    expect(excluded.noMatchLink).toBe(await scalar(sql<{ n: string }[]>`
      SELECT count(*) AS n FROM after_siren_kicks WHERE match_id IS NULL
    `));

    const plain = plan({ afterSiren: { subject: 'event' } });
    expect(afterSirenRequiresMatchLink(plain)).toBe(false);
  });
});

describe('after_siren — the trusted player link', () => {
  it('a player-subject answer counts only trusted-linked kickers, and says how many it left out', async () => {
    const { total, excluded } = await players(plan({ agg: { kind: 'max' }, afterSiren: { subject: 'player' } }));
    expect(excluded.noPlayerLink).toBe(await scalar(sql<{ n: string }[]>`
      SELECT count(*) AS n FROM after_siren_kicks WHERE player_id IS NULL
    `));
    // Measured: 6 of the 126 recorded kicks have no trusted player link,
    // and the caveat names that number rather than hiding the exclusion.
    expect(excluded.noPlayerLink).toBe(6);
    expect(total).toBeGreaterThan(0);
  });

  it('an unlinked kicker still appears as EVENT evidence, under the source spelling', async () => {
    const unlinked = await sql<{ id: number; player_name_raw: string; season: number }[]>`
      SELECT id, player_name_raw, season FROM after_siren_kicks WHERE player_id IS NULL ORDER BY id
    `;
    if (unlinked.length === 0) return;
    const { rows } = await events(plan({ afterSiren: { subject: 'event' } }), 100);
    const shown = rows.find((r) => r.eventId === unlinked[0].id);
    if (shown) {
      expect(shown.playerId).toBeNull();
      expect(shown.playerSlug).toBeNull();
      expect(shown.playerName).toBe(unlinked[0].player_name_raw);
    }
  });
});

/**
 * R7. Two independent code paths must agree on the question they overlap
 * on: the Records board's per-player attempts and goals, and this
 * compiler's unfiltered per-player counts.
 */
describe('after_siren — parity with the Records board', () => {
  it('per-player kick and goal counts match getAfterSirenRecords for every player', async () => {
    const board = await getAfterSirenRecords();
    // Deliberately above NL_LIMITS.maxListRows: parity must be exhaustive
    // over every kicker, not over the first display page. The rendered
    // answer is still capped at 100 by executePlan -- the assertion below
    // on `total` is what proves the compiler knows the full count even
    // when it returns a page of it.
    const EVERY_KICKER = 1_000;
    const kicks = await players(plan({ agg: { kind: 'list' }, afterSiren: { subject: 'player' } }), EVERY_KICKER);
    const goals = await players(plan({ agg: { kind: 'list' }, afterSiren: { subject: 'player', kickScored: 'goal' } }), EVERY_KICKER);

    expect(kicks.total).toBe(board.length);

    const kicksBy = new Map(kicks.rows.map((r) => [r.playerId, r.value]));
    const goalsBy = new Map(goals.rows.map((r) => [r.playerId, r.value]));

    expect(board.length).toBeGreaterThan(0);
    for (const row of board) {
      expect(kicksBy.get(row.playerId), `attempts for player ${row.playerId}`).toBe(row.attempts);
      if (row.goals > 0) {
        expect(goalsBy.get(row.playerId), `goals for player ${row.playerId}`).toBe(row.goals);
      } else {
        expect(goalsBy.get(row.playerId) ?? 0).toBe(0);
      }
    }
  });
});

describe('after_siren — a named player', () => {
  it('returns that player\'s own events and nobody else\'s', async () => {
    const [busiest] = await sql<{ player_id: number; n: string }[]>`
      SELECT player_id, count(*) AS n FROM after_siren_kicks
       WHERE player_id IS NOT NULL GROUP BY player_id ORDER BY count(*) DESC, player_id LIMIT 1
    `;
    const [named] = await sql<{ display_name: string; slug: string }[]>`
      SELECT display_name, slug FROM players WHERE id = ${busiest.player_id}
    `;
    const { rows, total } = await events(plan({
      afterSiren: { subject: 'event' },
      player: { id: busiest.player_id, slug: named.slug, name: named.display_name },
    }));
    expect(total).toBe(Number(busiest.n));
    expect(rows.every((r) => r.playerId === busiest.player_id)).toBe(true);
  });

  it('a player with no after-siren kick is an honest empty result', async () => {
    const [absent] = await sql<{ id: number; slug: string; display_name: string }[]>`
      SELECT id, slug, display_name FROM players
       WHERE id NOT IN (SELECT player_id FROM after_siren_kicks WHERE player_id IS NOT NULL)
       ORDER BY id LIMIT 1
    `;
    const { rows, total } = await events(plan({
      afterSiren: { subject: 'event' },
      player: { id: absent.id, slug: absent.slug, name: absent.display_name },
    }));
    expect(rows).toEqual([]);
    expect(total).toBe(0);
  });
});
