/**
 * The read-only special-records admin surface against a real PostgreSQL
 * (AFLDB-ISSUE-167 Stage 3).
 *
 * These are the claims the source-contract suite cannot make:
 * `tests/special-records-admin.test.ts` proves every join is written LEFT and
 * that no admin query carries `status = 'active'`; only a database proves that
 * an unlinked row actually survives those joins and that a voided row is
 * actually listed. Stage 3 has no mutation, so there is nothing here about
 * atomicity, overrides or CAS — those arrive with Stages 4 and 6.
 *
 * THE TWO THINGS MOST LIKELY TO BE WRONG, and why each is asserted:
 *
 *   1. A VOIDED ROW VANISHING. Every other list in this codebase defaults to
 *      active, because every other list feeds the public site. This one does
 *      the opposite on purpose (§3), and a later "consistency" edit that
 *      restored the usual default would silently hide exactly the rows the
 *      surface exists to show.
 *
 *   2. AN UNLINKED ROW VANISHING. Both tables keep the source spelling when
 *      they cannot resolve a player, a club or a match — that is the whole
 *      point of `link_status_value` — so an inner join anywhere would drop
 *      the rows an administrator most needs, and would do it without error.
 *
 * FIXTURES: four rows under an `AFLDB-ISSUE-167-STAGE3` marker, on a fixture
 * source of this suite's own making, removed in `afterAll`. All four are
 * deliberately UNLINKED: no real achievement, kick, player, club or match row
 * is written to or depended upon.
 */
import './guard';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  listAfterSirenKicks, listFirstKickGoals, readAfterSirenKick, readFirstKickGoal,
  specialRecordLifecycleCounts,
} from '@/db/queries/admin-special-records';
import { specialRecordEntityKey } from '@/lib/special-records/identity';

const testDbUrl = process.env.AFLDB_TEST_DATABASE_URL!;
const admin = postgres(testDbUrl, { max: 1, onnotice: () => {} });

const MARKER = 'AFLDB-ISSUE-167-STAGE3';
const FIXTURE_SOURCE_KEY = 'issue_167_stage3_source';
const VOID_REASON = `${MARKER} voided fixture`;

let fixtureSourceId: number;
let activeAchievementId: number;
let voidAchievementId: number;
let activeKickId: number;
let voidKickId: number;

beforeAll(async () => {
  const [source] = await admin<{ id: number }[]>`
    INSERT INTO sources (key, name, kind, url)
    VALUES (${FIXTURE_SOURCE_KEY}, ${`${MARKER} fixture source`}, 'manual',
            'https://example.invalid/167-stage3')
    ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name
    RETURNING id`;
  fixtureSourceId = source.id;

  const achievement = async (recordId: string, status: string, reason: string | null) => {
    const [row] = await admin<{ id: number }[]>`
      INSERT INTO player_achievements (
        achievement_type, player_name_raw, player_name_clean, link_status_value,
        candidate_count, club_name_raw, season, round_raw,
        source_id, source_record_id, notes, status, status_reason
      ) VALUES (
        'first_kick_goal', ${MARKER}, ${MARKER}, 'unmatched', 0, ${MARKER}, 1897, ${MARKER},
        ${fixtureSourceId}, ${recordId}, ${MARKER}, ${status}, ${reason}
      ) RETURNING id`;
    return row.id;
  };

  // kick_effect 'none' with kicker_result 'loss' satisfies after_siren_kicks_effect_ck's
  // third branch; premiership_season false with a NULL match_id satisfies _match_ck.
  const kick = async (recordId: string, status: string, reason: string | null, cited: boolean) => {
    const [row] = await admin<{ id: number }[]>`
      INSERT INTO after_siren_kicks (
        player_name_raw, player_name_clean, link_status_value, candidate_count,
        club_name_raw, opponent_name_raw, competition, premiership_season,
        season, round_raw, kick_scored, kick_effect, kicker_result,
        kicker_score_raw, opponent_score_raw, kicker_points, opponent_points,
        cited, source_id, source_record_id, notes, status, status_reason
      ) VALUES (
        ${MARKER}, ${MARKER}, 'unmatched', 0,
        ${MARKER}, ${MARKER}, ${MARKER}, false,
        1897, ${MARKER}, 'none', 'none', 'loss',
        '0.0 (0)', '0.0 (0)', 0, 0,
        ${cited}, ${fixtureSourceId}, ${recordId}, ${MARKER}, ${status}, ${reason}
      ) RETURNING id`;
    return row.id;
  };

  activeAchievementId = await achievement('fkg-i167-s3-active', 'active', null);
  voidAchievementId = await achievement('fkg-i167-s3-void', 'void', VOID_REASON);
  // The uncited fixture is the ACTIVE one on purpose: `cited = false` is an
  // evidence gap about a kick that happened, never a lifecycle state (G-3).
  activeKickId = await kick('asr-i167-s3-active', 'active', null, false);
  voidKickId = await kick('asr-i167-s3-void', 'void', VOID_REASON, true);
});

afterAll(async () => {
  await admin`DELETE FROM player_achievements WHERE source_id = ${fixtureSourceId}`;
  await admin`DELETE FROM after_siren_kicks WHERE source_id = ${fixtureSourceId}`;
  await admin`DELETE FROM sources WHERE key = ${FIXTURE_SOURCE_KEY}`;
  await admin.end({ timeout: 5 });
});

describe('the admin lists show the whole lifecycle, not the public view of it', () => {
  it('lists an active AND a voided first-kick record by default', async () => {
    const page = await listFirstKickGoals({ search: MARKER });
    expect(page.rows.map((r) => r.id).sort()).toEqual([activeAchievementId, voidAchievementId].sort());
    expect(page.rows.map((r) => r.status).sort()).toEqual(['active', 'void']);
    expect(page.total).toBe(2);
  });

  it('lists an active AND a voided after-siren record by default', async () => {
    const page = await listAfterSirenKicks({ search: MARKER });
    expect(page.rows.map((r) => r.id).sort()).toEqual([activeKickId, voidKickId].sort());
    expect(page.rows.map((r) => r.status).sort()).toEqual(['active', 'void']);
    expect(page.total).toBe(2);
  });

  it('narrows to one state when asked, and carries the void reason', async () => {
    const voided = await listFirstKickGoals({ search: MARKER, status: 'void' });
    expect(voided.rows.map((r) => r.id)).toEqual([voidAchievementId]);
    expect(voided.rows[0].statusReason).toBe(VOID_REASON);

    const active = await listAfterSirenKicks({ search: MARKER, status: 'active' });
    expect(active.rows.map((r) => r.id)).toEqual([activeKickId]);
    expect(active.rows[0].statusReason).toBeNull();
  });

  it('counts both states for the landing cards, on both families', async () => {
    const counts = await specialRecordLifecycleCounts();
    expect(counts.player_achievements.void).toBeGreaterThanOrEqual(1);
    expect(counts.after_siren_kicks.void).toBeGreaterThanOrEqual(1);
    expect(counts.player_achievements.active).toBeGreaterThanOrEqual(1);
    expect(counts.after_siren_kicks.active).toBeGreaterThanOrEqual(1);

    // The cards claim to describe the whole table, so the two states must add
    // up to it — a third state appearing would be a silent omission.
    const [pa] = await admin<{ n: number }[]>`SELECT count(*)::int AS n FROM player_achievements`;
    const [ask] = await admin<{ n: number }[]>`SELECT count(*)::int AS n FROM after_siren_kicks`;
    expect(counts.player_achievements.active + counts.player_achievements.void).toBe(pa.n);
    expect(counts.after_siren_kicks.active + counts.after_siren_kicks.void).toBe(ask.n);
  });
});

describe('an unresolved row survives every join', () => {
  it('keeps an unlinked first-kick record, with its link state visible', async () => {
    const page = await listFirstKickGoals({ search: MARKER, status: 'active' });
    const row = page.rows[0];
    expect(row.playerId).toBeNull();
    expect(row.playerSlug).toBeNull();
    expect(row.clubId).toBeNull();
    expect(row.matchId).toBeNull();
    // The gap is reported, not hidden: this is the whole of D-2's option (c).
    expect(row.linkStatus).toBe('unmatched');
    expect(row.candidateCount).toBe(0);
    expect(row.playerNameRaw).toBe(MARKER);
  });

  it('keeps an unlinked after-siren record, with its link state visible', async () => {
    const page = await listAfterSirenKicks({ search: MARKER, status: 'active' });
    const row = page.rows[0];
    expect(row.playerId).toBeNull();
    expect(row.clubId).toBeNull();
    expect(row.opponentClubId).toBeNull();
    expect(row.matchId).toBeNull();
    expect(row.linkStatus).toBe('unmatched');
    expect(row.candidateCount).toBe(0);
    expect(row.opponentNameRaw).toBe(MARKER);
  });

  it('finds an unlinked row by the only name it has — the source spelling', async () => {
    // Searching only `players.display_name` would make an unlinked row
    // unreachable from the surface that exists to reach it.
    expect((await listFirstKickGoals({ search: MARKER, link: 'unlinked' })).total).toBe(2);
    expect((await listFirstKickGoals({ search: MARKER, link: 'linked' })).total).toBe(0);
  });
});

describe('provenance and identity come back with every row', () => {
  it('returns the source key, the source record id and a formable durable identity', async () => {
    const page = await listFirstKickGoals({ search: MARKER, status: 'active' });
    const row = page.rows[0];
    expect(row.sourceId).toBe(fixtureSourceId);
    expect(row.sourceKey).toBe(FIXTURE_SOURCE_KEY);
    expect(row.sourceRecordId).toBe('fkg-i167-s3-active');
    // Stage 4 and Stage 6 key the durable record on exactly this string; the
    // detail page shows it, so a row whose identity cannot be formed is
    // visible as such rather than silently unadministrable.
    expect(specialRecordEntityKey(row.sourceKey!, row.sourceRecordId!))
      .toBe(`${FIXTURE_SOURCE_KEY}:fkg-i167-s3-active`);
  });

  it('reads provenance as source-owned for a fixture source, on both families', async () => {
    const fkg = await listFirstKickGoals({ search: MARKER, provenance: 'source' });
    const asr = await listAfterSirenKicks({ search: MARKER, provenance: 'source' });
    expect(fkg.total).toBe(2);
    expect(asr.total).toBe(2);
    expect((await listFirstKickGoals({ search: MARKER, provenance: 'manual' })).total).toBe(0);
  });
});

describe('the detail reads', () => {
  it('returns one first-kick record with its lifecycle, provenance and context', async () => {
    const row = await readFirstKickGoal(voidAchievementId);
    expect(row).not.toBeNull();
    expect(row!.status).toBe('void');
    expect(row!.statusReason).toBe(VOID_REASON);
    expect(row!.sourceKey).toBe(FIXTURE_SOURCE_KEY);
    expect(row!.season).toBe(1897);
    expect(row!.roundRaw).toBe(MARKER);
    expect(row!.updatedAt).toBeTruthy();
  });

  it('returns one after-siren record, keeping `cited` distinct from `status` (G-3)', async () => {
    const uncitedButActive = await readAfterSirenKick(activeKickId);
    const citedButVoid = await readAfterSirenKick(voidKickId);
    // The trap migration 102's header names: an uncited kick is evidence-thin,
    // not retracted, and a voided one may be perfectly well cited. If these
    // two ever move together, something has conflated them.
    expect(uncitedButActive!.cited).toBe(false);
    expect(uncitedButActive!.status).toBe('active');
    expect(citedButVoid!.cited).toBe(true);
    expect(citedButVoid!.status).toBe('void');
  });

  it('returns null for an id that is not a record, rather than throwing', async () => {
    expect(await readFirstKickGoal(2_000_000_000)).toBeNull();
    expect(await readAfterSirenKick(2_000_000_000)).toBeNull();
  });
});

describe('the lists are bounded', () => {
  it('honours a page size and reports the unpaged total', async () => {
    const first = await listFirstKickGoals({ search: MARKER, pageSize: 1, page: 1 });
    const second = await listFirstKickGoals({ search: MARKER, pageSize: 1, page: 2 });
    expect(first.rows).toHaveLength(1);
    expect(second.rows).toHaveLength(1);
    expect(first.rows[0].id).not.toBe(second.rows[0].id);
    expect(first.total).toBe(2);
    expect(second.total).toBe(2);
  });

  it('refuses an unbounded page size', async () => {
    const page = await listAfterSirenKicks({ pageSize: 100_000 });
    expect(page.rows.length).toBeLessThanOrEqual(200);
  });
});
