/**
 * AFLDB-ISSUE-167 Stage 5 — a voided special record disappears from every
 * public read model, and from nothing else.
 *
 * WHY THIS IS ONE SUITE RATHER THAN FOUR. The runbook's §16 table names four
 * existing homes for this stage, but the claim it is testing is a single
 * atomic one -- "void it once, and it is gone EVERYWHERE public, while Admin
 * still sees it" -- spanning eight query modules, three of which (the records
 * board queries, the player-page honours query and the player-link queue) are
 * in none of those four files. Splitting it would mean voiding and restoring
 * the same row four separate times, four copies of the same void/restore
 * helper, and no single place that fails when a ninth consumer appears. This
 * is the same reason Stage 4 created `special-records-replay-parity.test.ts`:
 * no existing suite is a sensible semantic home for a claim that spans them
 * all. The per-fragment source proof lives beside it in
 * `tests/special-records-public-filter-contract.test.ts`.
 *
 * METHOD. Nothing is hardcoded. Every fixture is DISCOVERED by the property
 * that makes it decisive for the fragment under test -- a season holding
 * exactly one linked first-kick row, a player holding exactly one
 * winner-qualifying after-siren kick, the organization holding exactly one
 * linked row, the sole holder of the maximum `imported_at`. A row chosen that
 * way turns "the count went down by one" into "the answer changed", which is
 * what actually distinguishes a filtered query from an unfiltered one.
 *
 * SAFETY. Each test voids ONE real row inside `withVoid`, which restores
 * `status = 'active'` and `status_reason = NULL` in a `finally` whether the
 * assertions pass, fail or throw. `fileParallelism: false` (vitest.config.mts,
 * AFLDB-ISSUE-108) means no other suite observes the transient void. The
 * database carries zero void rows before and after this file runs, and that
 * is asserted at both ends rather than assumed.
 */
import './guard';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import {
  listAfterSirenKicks, listFirstKickGoals, readAfterSirenKick, readFirstKickGoal,
  specialRecordLifecycleCounts,
} from '@/db/queries/admin-special-records';
import { getAfterSirenRecords, getPlayerAfterSirenEvents } from '@/db/queries/after-siren';
import { getPlayerHonours } from '@/db/queries/awards';
import { solveCellRows } from '@/db/queries/grid-solver';
import { answerAchievementSummary } from '@/db/queries/nl/achievement-summary';
import { answerAfterSiren } from '@/db/queries/nl/after-siren';
import {
  getClubsWithoutFirstKickGoal, getFirstKickGoalByClub, getFirstKickGoalByDecade,
  getFirstKickGoalHighlights, getFirstKickGoalList, getFirstKickGoalProvenance,
  getFirstKickGoalSummary,
} from '@/db/queries/player-achievements';
import { LINK_TARGET_TABLES, listUnresolvedLinks } from '@/db/queries/player-links';
import { fetchSourceEvidence } from '@/db/queries/player-match-candidates';
import { SPECIAL_RECORD_TABLES } from '@/lib/special-records/identity';
import { validatePlan, type NlAfterSiren, type NlQueryPlan } from '@/search/nl/plan';
import type { GridAxisState } from '@/search/grid-solver-spec';

const VOID_REASON = 'AFLDB-ISSUE-167 Stage 5 suppression test';

afterAll(async () => {
  await sql.end();
});

/**
 * Void one row for the duration of `fn`, then restore it unconditionally.
 *
 * The restore is `status = 'active', status_reason = NULL` rather than a
 * saved-and-replayed previous value because the precondition asserted in
 * `beforeAll` is that NO row is void when this file starts: there is no other
 * state to restore to, and writing it that way means a crashed test cannot
 * leave a half-remembered status behind.
 */
async function withVoid<T>(
  table: (typeof SPECIAL_RECORD_TABLES)[number], id: number, fn: () => Promise<T>,
): Promise<T> {
  const target = table === 'player_achievements'
    ? sql`player_achievements`
    : sql`after_siren_kicks`;
  await sql`UPDATE ${target} SET status = 'void', status_reason = ${VOID_REASON} WHERE id = ${id}`;
  try {
    return await fn();
  } finally {
    await sql`UPDATE ${target} SET status = 'active', status_reason = NULL WHERE id = ${id}`;
  }
}

async function voidCounts(): Promise<{ achievements: number; kicks: number }> {
  const [row] = await sql<{ achievements: number; kicks: number }[]>`
    SELECT (SELECT count(*)::int FROM player_achievements WHERE status <> 'active') AS achievements,
           (SELECT count(*)::int FROM after_siren_kicks   WHERE status <> 'active') AS kicks`;
  return row;
}

/** The fixtures, each discovered by the property that makes it decisive. */
type Fixtures = {
  /** A linked first-kick row that is the ONLY one in its season. */
  soleInSeason: { id: number; season: number; playerId: number };
  /** The linked first-kick row that is the only one for its organization. */
  soleForOrg: { id: number; orgId: number; orgName: string };
  /** The earliest first-kick row, so voiding it must move the `earliest` highlight. */
  earliest: { id: number; season: number };
  /** The sole holder of max(imported_at), so voiding it must move the provenance instant. */
  newestImport: { id: number; importedAt: Date } | null;
  /** An unlinked first-kick row, which is therefore in the player-link queue. */
  unlinked: { id: number; playerName: string };
  /** A player holding exactly one winner-qualifying after-siren kick. */
  soleWinner: { id: number; playerId: number; season: number };
  /** A player holding exactly one after-siren attempt of any kind. */
  soleAttempt: { id: number; playerId: number };
};

let fx: Fixtures;

beforeAll(async () => {
  // Precondition. Every assertion below is a difference against a baseline
  // measured with the whole table active; a pre-existing void row would make
  // those baselines mean something else.
  expect(await voidCounts(), 'afldb_test must hold no void special record before this suite')
    .toEqual({ achievements: 0, kicks: 0 });

  const [soleInSeason] = await sql<{ id: number; season: number; playerId: number }[]>`
    SELECT min(a.id)::int AS id, a.season::int AS season, min(a.player_id)::int AS "playerId"
      FROM player_achievements a
     WHERE a.achievement_type = 'first_kick_goal' AND a.player_id IS NOT NULL
       AND a.link_status_value IN ('unique', 'resolved')
       AND a.club_id IS NOT NULL AND a.match_id IS NOT NULL
     GROUP BY a.season HAVING count(*) = 1
     ORDER BY a.season LIMIT 1`;

  const [soleForOrg] = await sql<{ id: number; orgId: number; orgName: string }[]>`
    SELECT min(a.id)::int AS id, cl.organization_id::int AS "orgId", o.name AS "orgName"
      FROM player_achievements a
      JOIN clubs cl ON cl.id = a.club_id
      JOIN club_organizations o ON o.id = cl.organization_id
     WHERE a.achievement_type = 'first_kick_goal' AND a.player_id IS NOT NULL
       AND a.link_status_value IN ('unique', 'resolved')
     GROUP BY cl.organization_id, o.name HAVING count(*) = 1
     ORDER BY cl.organization_id LIMIT 1`;

  const [earliest] = await sql<{ id: number; season: number }[]>`
    SELECT a.id::int, a.season::int FROM player_achievements a
     WHERE a.achievement_type = 'first_kick_goal'
     ORDER BY a.season ASC, a.id ASC LIMIT 1`;

  const newestImport = await sql<{ id: number; importedAt: Date }[]>`
    SELECT a.id::int, a.imported_at AS "importedAt" FROM player_achievements a
     WHERE a.achievement_type = 'first_kick_goal'
       AND a.imported_at = (SELECT max(imported_at) FROM player_achievements
                             WHERE achievement_type = 'first_kick_goal')`;

  const [unlinked] = await sql<{ id: number; playerName: string }[]>`
    SELECT a.id::int, a.player_name_raw AS "playerName" FROM player_achievements a
     WHERE a.achievement_type = 'first_kick_goal' AND a.link_status_value = 'unmatched'
     ORDER BY a.id LIMIT 1`;

  const [soleWinner] = await sql<{ id: number; playerId: number; season: number }[]>`
    SELECT min(k.id)::int AS id, k.player_id::int AS "playerId", min(k.season)::int AS season
      FROM after_siren_kicks k
     WHERE k.premiership_season AND k.kick_scored IN ('goal', 'behind') AND k.kick_effect = 'won'
       AND k.siren IN ('final', 'end_of_extra_time') AND k.player_id IS NOT NULL
       AND k.link_status_value IN ('unique', 'resolved')
     GROUP BY k.player_id HAVING count(*) = 1
     ORDER BY k.player_id LIMIT 1`;

  const [soleAttempt] = await sql<{ id: number; playerId: number }[]>`
    SELECT min(k.id)::int AS id, k.player_id::int AS "playerId"
      FROM after_siren_kicks k
     WHERE k.player_id IS NOT NULL
     GROUP BY k.player_id HAVING count(*) = 1
     ORDER BY k.player_id LIMIT 1`;

  for (const [name, value] of Object.entries({
    soleInSeason, soleForOrg, earliest, unlinked, soleWinner, soleAttempt,
  })) {
    expect(value, `no fixture found for "${name}" — this database has not been loaded`).toBeDefined();
  }

  fx = {
    soleInSeason, soleForOrg, earliest, unlinked, soleWinner, soleAttempt,
    newestImport: newestImport.length === 1 ? newestImport[0] : null,
  };
});

afterAll(async () => {
  expect(await voidCounts(), 'this suite must leave no void row behind')
    .toEqual({ achievements: 0, kicks: 0 });
});

function achievementPlan(kind: 'by_club' | 'by_season' | 'clubs_without' | 'earliest'): NlQueryPlan {
  const validated = validatePlan({
    v: 1,
    grain: 'achievement_summary',
    metric: null,
    agg: { kind: 'list' },
    scope: {},
    careerConditions: [],
    careerPredicates: [],
    clubSeasonConditions: [],
    tiePolicy: 'all',
    limit: 500,
    achievementSummary: { achievementKey: 'first_kick_goal', kind },
  } as NlQueryPlan);
  if ('error' in validated) throw new Error(`test plan failed validation: ${validated.error}`);
  return validated;
}

function afterSirenPlan(afterSiren: NlAfterSiren, overrides: Partial<NlQueryPlan> = {}): NlQueryPlan {
  const validated = validatePlan({
    v: 1,
    grain: 'after_siren',
    metric: 'siren_kicks',
    agg: { kind: 'list' },
    scope: {},
    careerConditions: [],
    careerPredicates: [],
    clubSeasonConditions: [],
    tiePolicy: 'all',
    limit: 500,
    afterSiren,
    ...overrides,
  } as NlQueryPlan);
  if ('error' in validated) throw new Error(`test plan failed validation: ${validated.error}`);
  return validated;
}

const ANY_PLAYER: GridAxisState = { builder: 'career_games_min', params: { games: '1' } };

async function cellPlayerIds(axis: GridAxisState): Promise<number[]> {
  const { rows } = await solveCellRows(axis, ANY_PLAYER, 'games_desc', { limit: 500, offset: 0 });
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Family A — first-kick goal (`player_achievements`)
// ---------------------------------------------------------------------------

describe('/records/first-kick-goal — the public records board', () => {
  it('drops a voided row from the list, and changes nothing else in it', async () => {
    const before = await getFirstKickGoalList();
    expect(before.some((r) => r.id === fx.soleInSeason.id)).toBe(true);

    const after = await withVoid('player_achievements', fx.soleInSeason.id,
      () => getFirstKickGoalList());

    expect(after.some((r) => r.id === fx.soleInSeason.id)).toBe(false);
    expect(after.map((r) => r.id))
      .toEqual(before.map((r) => r.id).filter((id) => id !== fx.soleInSeason.id));
  });

  it('drops a voided row from every count in the summary', async () => {
    const before = await getFirstKickGoalSummary();
    const after = await withVoid('player_achievements', fx.soleInSeason.id,
      () => getFirstKickGoalSummary());

    expect(after.total).toBe(before.total - 1);
    expect(after.linked).toBe(before.linked - 1);
    expect(after.unlinked).toBe(before.unlinked);
    expect(after.matchesResolved).toBe(before.matchesResolved - 1);
  });

  it('moves the earliest highlight off a voided row', async () => {
    const before = await getFirstKickGoalHighlights();
    expect(before.earliest?.season).toBe(fx.earliest.season);

    const after = await withVoid('player_achievements', fx.earliest.id,
      () => getFirstKickGoalHighlights());

    expect(after.earliest).not.toEqual(before.earliest);
    expect(after.earliest!.season).toBeGreaterThanOrEqual(before.earliest!.season);
  });

  it('drops a voided row from the club and decade breakdowns', async () => {
    const clubBefore = await getFirstKickGoalByClub();
    const decadeBefore = await getFirstKickGoalByDecade();

    const [clubAfter, decadeAfter] = await withVoid('player_achievements', fx.soleInSeason.id,
      async () => [await getFirstKickGoalByClub(), await getFirstKickGoalByDecade()] as const);

    expect(clubAfter.reduce((n, r) => n + r.players, 0))
      .toBe(clubBefore.reduce((n, r) => n + r.players, 0) - 1);
    // The bucket may disappear entirely rather than merely shrink, when the
    // voided row was the decade's only one -- which is itself the strongest
    // form of the claim, so both outcomes are accepted and counted the same.
    const decade = Math.floor(fx.soleInSeason.season / 10) * 10;
    const playersIn = (rows: { decade: number; players: number }[]) =>
      rows.find((r) => r.decade === decade)?.players ?? 0;
    expect(playersIn(decadeAfter)).toBe(playersIn(decadeBefore) - 1);
  });

  it('lists a club as having none once its only row is voided', async () => {
    const before = await getClubsWithoutFirstKickGoal();
    expect(before.some((c) => c.name === fx.soleForOrg.orgName)).toBe(false);

    const after = await withVoid('player_achievements', fx.soleForOrg.id,
      () => getClubsWithoutFirstKickGoal());

    expect(after.some((c) => c.name === fx.soleForOrg.orgName)).toBe(true);
  });

  it('reads the provenance instant from active rows only', async () => {
    if (fx.newestImport === null) {
      throw new Error('no unique max(imported_at) holder — the provenance fragment cannot be proved on this data');
    }
    const before = await getFirstKickGoalProvenance();
    const after = await withVoid('player_achievements', fx.newestImport.id,
      () => getFirstKickGoalProvenance());

    expect(after!.importedAt!.getTime()).toBeLessThan(before!.importedAt!.getTime());
  });
});

describe('the player page — first-kick honours', () => {
  it('drops a voided achievement from getPlayerHonours', async () => {
    const before = await getPlayerHonours(fx.soleInSeason.playerId);
    expect(before.firstKickGoal, 'fixture player has no first-kick honour').toBeTruthy();

    const after = await withVoid('player_achievements', fx.soleInSeason.id,
      () => getPlayerHonours(fx.soleInSeason.playerId));

    expect(after.firstKickGoal).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Family B — after the siren (`after_siren_kicks`)
// ---------------------------------------------------------------------------

describe('/records/after-the-siren — the public records board', () => {
  it('drops a player whose only attempt was voided', async () => {
    const before = await getAfterSirenRecords();
    expect(before.some((r) => r.playerId === fx.soleAttempt.playerId)).toBe(true);

    const after = await withVoid('after_siren_kicks', fx.soleAttempt.id,
      () => getAfterSirenRecords());

    expect(after.some((r) => r.playerId === fx.soleAttempt.playerId)).toBe(false);
    expect(after.map((r) => r.playerId))
      .toEqual(before.map((r) => r.playerId).filter((id) => id !== fx.soleAttempt.playerId));
  });
});

describe('the player page — after-siren events', () => {
  it('drops a voided event from getPlayerAfterSirenEvents', async () => {
    const before = await getPlayerAfterSirenEvents(fx.soleAttempt.playerId);
    expect(before.some((e) => e.id === fx.soleAttempt.id)).toBe(true);

    const after = await withVoid('after_siren_kicks', fx.soleAttempt.id,
      () => getPlayerAfterSirenEvents(fx.soleAttempt.playerId));

    expect(after.some((e) => e.id === fx.soleAttempt.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Grid Solver
// ---------------------------------------------------------------------------

describe('Grid Solver', () => {
  it('stops satisfying a first-kick clue once the row is voided', async () => {
    const axis: GridAxisState = {
      builder: 'first_kick_goal_between',
      params: { from: String(fx.soleInSeason.season), to: String(fx.soleInSeason.season) },
    };
    expect(await cellPlayerIds(axis)).toEqual([fx.soleInSeason.playerId]);

    const after = await withVoid('player_achievements', fx.soleInSeason.id,
      () => cellPlayerIds(axis));
    expect(after).toEqual([]);
  });

  it('stops satisfying the after-siren winner clue once the kick is voided', async () => {
    const axis: GridAxisState = { builder: 'after_siren_winner', params: {} };
    const before = await cellPlayerIds(axis);
    expect(before).toContain(fx.soleWinner.playerId);

    const after = await withVoid('after_siren_kicks', fx.soleWinner.id, () => cellPlayerIds(axis));
    expect(after).not.toContain(fx.soleWinner.playerId);
    expect(after).toEqual(before.filter((id) => id !== fx.soleWinner.playerId));
  });

  /**
   * The club-scoped builder is the decisive one for the remaining first-kick
   * clues: the fixture organization holds exactly ONE linked row, so its cell
   * empties rather than merely shrinking. `first_kick_goal_player`,
   * `_only_career_goal` and `_consecutive_min` compile the same
   * `SELECT player_id FROM player_achievements WHERE ...` shape and are each
   * proved filtered, by name, in the per-fragment source contract — a cell
   * assertion over them would be capped by GRID_LIMITS and so would measure
   * paging, not filtering.
   */
  it('empties a club-scoped first-kick cell when that club’s only row is voided', async () => {
    const axis: GridAxisState = {
      builder: 'first_kick_goal_for_club',
      params: { club: String(fx.soleForOrg.orgId) },
    };
    expect(await cellPlayerIds(axis)).toHaveLength(1);
    expect(await withVoid('player_achievements', fx.soleForOrg.id, () => cellPlayerIds(axis)))
      .toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Natural-language search
// ---------------------------------------------------------------------------

describe('NL — achievement summary', () => {
  it('drops a voided row from the total and from every grouping', async () => {
    const before = await answerAchievementSummary(achievementPlan('by_season'));
    const after = await withVoid('player_achievements', fx.soleInSeason.id,
      () => answerAchievementSummary(achievementPlan('by_season')));

    if (before.kind !== 'achievement_summary' || after.kind !== 'achievement_summary') {
      throw new Error('expected an achievement_summary payload');
    }
    expect(after.total).toBe(before.total - 1);
    // The season held exactly one linked row, so its whole group must vanish.
    expect(after.rows.some((r) => r.label === String(fx.soleInSeason.season))).toBe(false);
    expect(before.rows.some((r) => r.label === String(fx.soleInSeason.season))).toBe(true);
  });

  it('reports a club as never having had one once its only row is voided', async () => {
    const before = await answerAchievementSummary(achievementPlan('clubs_without'));
    const after = await withVoid('player_achievements', fx.soleForOrg.id,
      () => answerAchievementSummary(achievementPlan('clubs_without')));

    if (before.kind !== 'achievement_summary' || after.kind !== 'achievement_summary') {
      throw new Error('expected an achievement_summary payload');
    }
    expect(before.rows.some((r) => r.label === fx.soleForOrg.orgName)).toBe(false);
    expect(after.rows.some((r) => r.label === fx.soleForOrg.orgName)).toBe(true);
  });
});

describe('NL — the after_siren grain', () => {
  it('drops a voided kick from the event list and the count', async () => {
    const plan = afterSirenPlan({ subject: 'event' } as NlAfterSiren);
    const before = await answerAfterSiren(plan, 500);
    const after = await withVoid('after_siren_kicks', fx.soleWinner.id,
      () => answerAfterSiren(plan, 500));

    if (before.kind !== 'after_siren_event' || after.kind !== 'after_siren_event') {
      throw new Error('expected an after_siren_event payload');
    }
    expect(before.rows.some((r) => r.eventId === fx.soleWinner.id)).toBe(true);
    expect(after.rows.some((r) => r.eventId === fx.soleWinner.id)).toBe(false);
    expect(after.rows.length).toBe(before.rows.length - 1);
  });

  it('never counts a voided kick among the ownership exclusions', async () => {
    // The caveat line ("N rows have no player link") is computed over the
    // question's own filters, NOT over the ownership rules -- so an unfiltered
    // exclusions query would keep quoting a retracted row at the reader even
    // when the answer itself had dropped it.
    const plan = afterSirenPlan({ subject: 'event' } as NlAfterSiren);
    const [unlinkedKick] = await sql<{ id: number }[]>`
      SELECT id::int FROM after_siren_kicks WHERE player_id IS NULL ORDER BY id LIMIT 1`;
    expect(unlinkedKick, 'no player-unlinked after-siren row to void').toBeDefined();

    const before = await answerAfterSiren(plan, 1);
    const after = await withVoid('after_siren_kicks', unlinkedKick.id,
      () => answerAfterSiren(plan, 1));

    if (before.kind !== 'after_siren_event' || after.kind !== 'after_siren_event') {
      throw new Error('expected an after_siren_event payload');
    }
    expect(after.excluded.noPlayerLink).toBe(before.excluded.noPlayerLink - 1);
  });
});

// ---------------------------------------------------------------------------
// The player-link queue (D-2: family A only, and no mutations)
// ---------------------------------------------------------------------------

describe('/admin/player-links — the review queue', () => {
  it('drops a voided achievement from the unresolved queue', async () => {
    const before = await listUnresolvedLinks('player_achievements');
    expect(before.some((r) => r.targetId === fx.unlinked.id)).toBe(true);

    const after = await withVoid('player_achievements', fx.unlinked.id,
      () => listUnresolvedLinks('player_achievements'));

    expect(after.some((r) => r.targetId === fx.unlinked.id)).toBe(false);
  });

  it('drops a voided achievement from the candidate evidence set', async () => {
    const read = async () => {
      const rows = await fetchSourceEvidence(sql, { status: 'unresolved', table: 'player_achievements' });
      return rows.map((r) => r.source.target.targetId);
    };
    const before = await read();
    expect(before).toContain(fx.unlinked.id);

    const after = await withVoid('player_achievements', fx.unlinked.id, read);
    expect(after).not.toContain(fx.unlinked.id);
  });

  it('leaves every other target table untouched by the achievement filter', async () => {
    const others = LINK_TARGET_TABLES.filter((t) => t !== 'player_achievements');
    const before = await Promise.all(others.map((t) => listUnresolvedLinks(t)));
    const after = await withVoid('player_achievements', fx.unlinked.id,
      () => Promise.all(others.map((t) => listUnresolvedLinks(t))));

    for (const [i, rows] of after.entries()) {
      expect(rows.map((r) => r.targetId), others[i]).toEqual(before[i].map((r) => r.targetId));
    }
  });

  it('does not add after_siren_kicks to the link targets (D-2)', () => {
    expect(LINK_TARGET_TABLES).not.toContain('after_siren_kicks');
    expect([...LINK_TARGET_TABLES]).toEqual([
      'award_winners', 'award_nominations', 'hall_of_fame', 'honour_team_members',
      'captaincies', 'player_achievements', 'draft_picks',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Admin (Stage 3) must still see everything
// ---------------------------------------------------------------------------

describe('/admin/records — Stage 3 still sees a voided record', () => {
  it('keeps a voided first-kick row in the list and the detail read', async () => {
    const [list, detail, counts] = await withVoid('player_achievements', fx.soleInSeason.id,
      async () => [
        await listFirstKickGoals({ season: fx.soleInSeason.season, pageSize: 200 }),
        await readFirstKickGoal(fx.soleInSeason.id),
        await specialRecordLifecycleCounts(),
      ] as const);

    expect(list.rows.some((r) => r.id === fx.soleInSeason.id)).toBe(true);
    expect(detail).not.toBeNull();
    expect(detail!.status).toBe('void');
    expect(detail!.statusReason).toBe(VOID_REASON);
    expect(counts.player_achievements.void).toBe(1);
  });

  it('keeps a voided after-siren row in the list and the detail read', async () => {
    const [list, detail] = await withVoid('after_siren_kicks', fx.soleWinner.id,
      async () => [
        await listAfterSirenKicks({ season: fx.soleWinner.season, pageSize: 200 }),
        await readAfterSirenKick(fx.soleWinner.id),
      ] as const);

    expect(list.rows.some((r) => r.id === fx.soleWinner.id)).toBe(true);
    expect(detail).not.toBeNull();
    expect(detail!.status).toBe('void');
  });

  it('still filters to void on request, which is the point of the admin surface', async () => {
    const rows = await withVoid('player_achievements', fx.soleInSeason.id,
      () => listFirstKickGoals({ status: 'void', pageSize: 200 }));
    expect(rows.rows.map((r) => r.id)).toEqual([fx.soleInSeason.id]);
  });
});
