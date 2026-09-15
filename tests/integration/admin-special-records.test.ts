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
  correctAfterSirenKick, correctFirstKickGoal, createAfterSirenKick, createFirstKickGoal,
  listAfterSirenKicks, listFirstKickGoals, readAfterSirenKick, readFirstKickGoal,
  reinstateFirstKickGoal, replaceFirstKickGoal, specialRecordLifecycleCounts,
  suppressFirstKickGoal,
} from '@/db/queries/admin-special-records';
import { deleteMatch } from '@/db/queries/match-admin';
import { getFirstKickGoalList } from '@/db/queries/player-achievements';
import { isAllowedRevalidatePath } from '@/app/admin/records/revalidate-paths';
import { specialRecordEntityKey } from '@/lib/special-records/identity';
import { replaySpecialRecordOverrides } from '../../tools/records/special-records-replay';

import { createImportRoleParityHarness } from './import-role-parity';

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

// =========================================================================
// Stage 6 — the mutation contract, against a real PostgreSQL
// =========================================================================
//
// These are the claims no source contract can make: that the canonical row,
// the durable `data_overrides` record and the `data_edits` audit row really
// commit together and really roll back together; that a stale
// `expectedUpdatedAt` writes NOTHING anywhere; that a manual record this
// surface creates is the row the Stage 4 replay rebuilds after a destructive
// rebuild; and that a match carrying a curated record cannot be deleted.
//
// ROLE, not just database (the AFLDB-ISSUE-165 Stage 7 lesson). Redirecting to
// AFLDB_TEST_DATABASE_URL alone would run every mutation as the database OWNER,
// which can do anything — and migration 078 gives `afldb_import` COLUMN-level
// INSERT/UPDATE on `data_overrides`, not table-level, so a mutation touching
// one ungranted column fails closed on DEV and nowhere here. When the operator
// has configured the restricted DSN these mutations run as `afldb_import` and
// that gap closes.

const S6 = 'AFLDB-ISSUE-167-STAGE6';
const S6_SOURCE_KEY = 'issue_167_stage6_source';

const importRole = createImportRoleParityHarness(
  process.env.AFLDB_TEST_DATABASE_URL,
  process.env.AFLDB_TEST_IMPORT_DATABASE_URL,
);
process.env.AFLDB_IMPORT_DATABASE_URL = process.env.AFLDB_TEST_IMPORT_DATABASE_URL
  ?? process.env.AFLDB_TEST_DATABASE_URL;

const owner = postgres(testDbUrl, { max: 1, onnotice: () => {} });

let actorId: number;
let createdThrowawayAdmin = false;
let s6SourceId: number;
let s6PlayerId: number;
let s6MatchId: number;
let s6MatchKey: string;
let s6MatchSeason: number;
let s6OtherPlayerId: number;
let seeded = 0;

const nextKey = (prefix: string) => `${prefix}-s6-${Date.now().toString(36)}-${seeded += 1}`;

async function seedFirstKick(recordId: string, overrides: {
  playerId?: number | null; matchId?: number | null; season?: number; status?: string;
} = {}): Promise<number> {
  const [row] = await owner<{ id: number }[]>`
    INSERT INTO player_achievements (
      achievement_type, player_name_raw, player_name_clean, link_status_value,
      candidate_count, club_name_raw, season, round_raw, notes,
      source_id, source_record_id, status, status_reason, player_id, match_id
    ) VALUES (
      'first_kick_goal', ${S6}, ${S6},
      ${overrides.playerId ? 'resolved' : 'unmatched'}::link_status, 0,
      ${S6}, ${overrides.season ?? 1897}::smallint, ${S6}, ${S6},
      ${s6SourceId}, ${recordId}, ${overrides.status ?? 'active'},
      ${overrides.status === 'void' ? `${S6} seeded as suppressed` : null},
      ${overrides.playerId ?? null}, ${overrides.matchId ?? null}
    ) RETURNING id::int AS id`;
  return row.id;
}

async function seedAfterSiren(recordId: string, overrides: {
  playerId?: number | null; matchId?: number | null; premiership?: boolean;
} = {}): Promise<number> {
  const premiership = overrides.premiership ?? (overrides.matchId != null);
  const [row] = await owner<{ id: number }[]>`
    INSERT INTO after_siren_kicks (
      player_name_raw, player_name_clean, link_status_value, candidate_count,
      club_name_raw, opponent_name_raw, competition, premiership_season,
      season, round_raw, kick_scored, kick_effect, kicker_result, siren,
      kicker_score_raw, opponent_score_raw, kicker_points, opponent_points,
      cited, notes, source_id, source_record_id, status, player_id, match_id
    ) VALUES (
      ${S6}, ${S6}, ${overrides.playerId ? 'resolved' : 'unmatched'}::link_status, 0,
      ${S6}, ${S6}, ${S6}, ${premiership},
      1897::smallint, ${S6}, 'goal', 'won', 'win', 'final',
      '12.10 (82)', '12.4 (76)', 82, 76,
      true, ${S6}, ${s6SourceId}, ${recordId}, 'active',
      ${overrides.playerId ?? null}, ${overrides.matchId ?? null}
    ) RETURNING id::int AS id`;
  return row.id;
}

const overridesFor = (table: string, entityKey: string) => owner<{
  fieldGroup: string; values: Record<string, unknown>; isActive: boolean;
}[]>`
  SELECT field_group AS "fieldGroup", override_values AS values, is_active AS "isActive"
    FROM data_overrides WHERE entity_type = ${table} AND entity_key = ${entityKey}
   ORDER BY field_group`;

const auditRows = (table: string, rowId: number) => owner<{
  fieldGroup: string; oldValues: Record<string, unknown>; newValues: Record<string, unknown>;
}[]>`
  SELECT field_group AS "fieldGroup", old_values AS "oldValues", new_values AS "newValues"
    FROM data_edits WHERE table_name = ${table} AND row_id = ${rowId}
   ORDER BY id`;

async function purgeStage6(): Promise<void> {
  await owner`DELETE FROM data_edits WHERE table_name IN ('player_achievements', 'after_siren_kicks')
                AND new_values::text LIKE ${`%${S6_SOURCE_KEY}%`}`;
  await owner`DELETE FROM data_overrides
               WHERE entity_type IN ('player_achievements', 'after_siren_kicks')
                 AND (entity_key LIKE ${`${S6_SOURCE_KEY}:%`}
                      OR override_values::text LIKE ${`%${S6}%`})`;
  await owner`DELETE FROM player_achievements WHERE notes = ${S6} OR player_name_raw = ${S6}`;
  await owner`DELETE FROM after_siren_kicks WHERE notes = ${S6} OR player_name_raw = ${S6}`;
}

beforeAll(async () => {
  if (process.env.AFLDB_TEST_IMPORT_DATABASE_URL) {
    const proof = await importRole.validate();
    expect(proof.restricted.role).toBe('afldb_import');
    expect(proof.restricted.database).toMatch(/_test$/);
  }

  const [source] = await owner<{ id: number }[]>`
    INSERT INTO sources (key, name, kind, url)
    VALUES (${S6_SOURCE_KEY}, ${`${S6} fixture source`}, 'manual',
            'https://example.invalid/167-stage6')
    ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name
    RETURNING id`;
  s6SourceId = source.id;

  const [existingAdmin] = await owner<{ id: number }[]>`
    SELECT id FROM auth_users ORDER BY id LIMIT 1`;
  if (existingAdmin) {
    actorId = existingAdmin.id;
  } else {
    const [created] = await owner<{ id: number }[]>`
      INSERT INTO auth_users (email, role)
      VALUES ('issue-167-stage6@example.test', 'super_admin') RETURNING id`;
    actorId = created.id;
    createdThrowawayAdmin = true;
  }

  // A player carrying a real AFL Tables identity, because `player_identity` is
  // what a manual record's durable payload travels on and what the replay
  // resolves it back through.
  const [player] = await owner<{ id: number }[]>`
    SELECT p.id::int AS id FROM players p
      JOIN external_identities e ON e.player_id = p.id
      JOIN sources s ON s.id = e.source_id
     WHERE s.key = 'afltables' AND e.match_method = 'afltables_profile_url'
       AND e.status IN ('unique', 'resolved')
     GROUP BY p.id HAVING count(*) = 1
     ORDER BY p.id LIMIT 1`;
  expect(player, 'afldb_test carries no unambiguously identified player').toBeDefined();
  s6PlayerId = player.id;

  // AFLDB-ISSUE-176: a match the fixture player actually played in, so the
  // match-consistency invariant (season agreement, a player_match_stats row)
  // holds for the combination the manual-creation tests below submit.
  const [match] = await owner<{ id: number; matchKey: string; season: number }[]>`
    SELECT m.id::int AS id, m.match_key AS "matchKey", m.season::int AS season
      FROM player_match_stats pms
      JOIN matches m ON m.id = pms.match_id
     WHERE pms.player_id = ${s6PlayerId}
     ORDER BY m.id LIMIT 1`;
  expect(match, 'the fixture player carries no player_match_stats row').toBeDefined();
  s6MatchId = match.id;
  s6MatchKey = match.matchKey;
  s6MatchSeason = match.season;

  // A second unambiguously identified player who did NOT play in that match,
  // to prove the invariant refuses a mismatched player/match combination.
  const [otherPlayer] = await owner<{ id: number }[]>`
    SELECT p.id::int AS id FROM players p
      JOIN external_identities e ON e.player_id = p.id
      JOIN sources s ON s.id = e.source_id
     WHERE s.key = 'afltables' AND e.match_method = 'afltables_profile_url'
       AND e.status IN ('unique', 'resolved') AND p.id <> ${s6PlayerId}
       AND NOT EXISTS (
         SELECT 1 FROM player_match_stats pms
          WHERE pms.player_id = p.id AND pms.match_id = ${s6MatchId}
       )
     GROUP BY p.id HAVING count(*) = 1
     ORDER BY p.id LIMIT 1`;
  expect(otherPlayer, 'afldb_test carries no second unambiguously identified player').toBeDefined();
  s6OtherPlayerId = otherPlayer.id;

  // Debris from a crashed earlier run would be REPLAYED by this one.
  await purgeStage6();
});

afterAll(async () => {
  await purgeStage6();
  await owner`DELETE FROM sources WHERE key = ${S6_SOURCE_KEY}`;
  if (createdThrowawayAdmin) await owner`DELETE FROM auth_users WHERE id = ${actorId}`;
  await owner.end({ timeout: 5 });
});

describe('Stage 6 — correction writes canonical, durable record and audit as one', () => {
  it('records a source-owned correction as a DELTA, and audits it', async () => {
    const recordId = nextKey('fkg');
    const id = await seedFirstKick(recordId);
    const before = await readFirstKickGoal(id);

    const result = await correctFirstKickGoal({
      rowId: id,
      expectedUpdatedAt: before!.updatedAt,
      adminUserId: actorId,
      fields: { roundRaw: 'R7', consecutiveGoalKicks: 3 },
    });
    expect(result.ok, result.ok ? '' : result.error).toBe(true);

    const after = await readFirstKickGoal(id);
    expect(after!.roundRaw).toBe('R7');
    expect(after!.consecutiveGoalKicks).toBe(3);
    expect(after!.updatedAt).not.toBe(before!.updatedAt);

    // The durable half: a DELTA naming only what changed, keyed by CANONICAL
    // column name because that is what the replay reads.
    const durable = await overridesFor('player_achievements',
      specialRecordEntityKey(S6_SOURCE_KEY, recordId));
    expect(durable).toHaveLength(1);
    expect(durable[0].fieldGroup).toBe('correction');
    expect(durable[0].isActive).toBe(true);
    expect(Object.keys(durable[0].values).sort()).toEqual(['consecutive_goal_kicks', 'round_raw']);

    // The audit half, in the same transaction.
    const audit = await auditRows('player_achievements', id);
    expect(audit).toHaveLength(1);
    expect(audit[0].fieldGroup).toBe('first_kick_goal_corrected');
    expect(audit[0].oldValues).toMatchObject({ round_raw: S6 });
    expect(audit[0].newValues).toMatchObject({ round_raw: 'R7' });
    // The durable identity travels with the audit row, so it survives a remap.
    expect(audit[0].newValues.entity_key)
      .toBe(specialRecordEntityKey(S6_SOURCE_KEY, recordId));
    expect(audit[0].newValues.lineage_identity).toBe(`${S6_SOURCE_KEY}|${recordId}`);
  });

  it('refuses a derived or identity field, and writes nothing', async () => {
    const recordId = nextKey('fkg');
    const id = await seedFirstKick(recordId);
    const before = await readFirstKickGoal(id);

    const result = await correctFirstKickGoal({
      rowId: id,
      expectedUpdatedAt: before!.updatedAt,
      adminUserId: actorId,
      // A crafted payload, of the shape a hand-rolled POST could send: every
      // one of these is derived, link-owned or identity-bearing.
      fields: {
        matchId: s6MatchId, playerId: s6PlayerId, clubId: 1,
        linkStatus: 'resolved', candidateCount: 9, sourceRecordId: 'stolen',
      } as never,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('forbidden');
      expect(result.subjects).toEqual(expect.arrayContaining(['matchId', 'sourceRecordId']));
    }

    const after = await readFirstKickGoal(id);
    expect(after!.updatedAt).toBe(before!.updatedAt);
    expect(after!.matchId).toBeNull();
    expect(after!.sourceRecordId).toBe(recordId);
    expect(await overridesFor('player_achievements',
      specialRecordEntityKey(S6_SOURCE_KEY, recordId))).toHaveLength(0);
    expect(await auditRows('player_achievements', id)).toHaveLength(0);
  });

  it('refuses an after-siren combination the CHECK would reject, in words', async () => {
    const recordId = nextKey('asr');
    const id = await seedAfterSiren(recordId);
    const before = await readAfterSirenKick(id);

    // A goal that "won the match" with an eleven-point margin: legal on each
    // field, refused as a combination by _effect_ck.
    const result = await correctAfterSirenKick({
      rowId: id,
      expectedUpdatedAt: before!.updatedAt,
      adminUserId: actorId,
      fields: { kickerPoints: 87 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('validation');
      expect(result.error).toMatch(/1 to 6 points/);
      // A sentence about football, never a constraint name.
      expect(result.error).not.toMatch(/_ck\b/);
    }

    const after = await readAfterSirenKick(id);
    expect(after!.kickerPoints).toBe(82);
    expect(after!.updatedAt).toBe(before!.updatedAt);
    expect(await overridesFor('after_siren_kicks',
      specialRecordEntityKey(S6_SOURCE_KEY, recordId))).toHaveLength(0);
    expect(await auditRows('after_siren_kicks', id)).toHaveLength(0);
  });

  it('accepts a coupled after-siren correction that keeps the relationship true', async () => {
    const recordId = nextKey('asr');
    const id = await seedAfterSiren(recordId);
    const before = await readAfterSirenKick(id);

    // The whole group moves together: a behind that drew the match.
    const result = await correctAfterSirenKick({
      rowId: id,
      expectedUpdatedAt: before!.updatedAt,
      adminUserId: actorId,
      fields: {
        kickScored: 'behind', kickEffect: 'drew', kickerResult: 'draw',
        kickerPoints: 76, opponentPoints: 76,
        kickerScoreRaw: '11.10 (76)', opponentScoreRaw: '12.4 (76)',
      },
    });
    expect(result.ok, result.ok ? '' : result.error).toBe(true);

    const after = await readAfterSirenKick(id);
    expect(after!.kickEffect).toBe('drew');
    expect(after!.kickerResult).toBe('draw');
    expect(after!.kickerPoints).toBe(76);
  });
});

describe('Stage 6 — compare-and-swap (§10.3)', () => {
  it('refuses a stale expectedUpdatedAt and writes NOTHING anywhere', async () => {
    const recordId = nextKey('fkg');
    const id = await seedFirstKick(recordId);
    const entityKey = specialRecordEntityKey(S6_SOURCE_KEY, recordId);
    const stale = (await readFirstKickGoal(id))!.updatedAt;

    // Something else moves the row — an importer reload that genuinely changed
    // it, or another administrator.
    await owner`UPDATE player_achievements SET notes = ${S6}, updated_at = now() + interval '1 second' WHERE id = ${id}`;
    const current = await readFirstKickGoal(id);
    expect(current!.updatedAt).not.toBe(stale);

    for (const attempt of [
      () => correctFirstKickGoal({
        rowId: id, expectedUpdatedAt: stale, adminUserId: actorId, fields: { roundRaw: 'R9' },
      }),
      () => suppressFirstKickGoal({
        rowId: id, expectedUpdatedAt: stale, adminUserId: actorId, reason: 'stale attempt',
      }),
      () => reinstateFirstKickGoal({ rowId: id, expectedUpdatedAt: stale, adminUserId: actorId }),
      () => replaceFirstKickGoal({
        rowId: id, expectedUpdatedAt: stale, adminUserId: actorId, reason: 'stale attempt',
        replacement: { clubNameRaw: S6, season: 1897, roundRaw: S6, playerNameRaw: S6 },
      }),
    ]) {
      const result = await attempt();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('stale');
    }

    // Nothing moved: not the canonical row, not the durable record, not the audit.
    const after = await readFirstKickGoal(id);
    expect(after!.updatedAt).toBe(current!.updatedAt);
    expect(after!.roundRaw).toBe(S6);
    expect(after!.status).toBe('active');
    expect(await overridesFor('player_achievements', entityKey)).toHaveLength(0);
    expect(await auditRows('player_achievements', id)).toHaveLength(0);
    // And no orphan replacement was created by the refused replace.
    const [orphans] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM player_achievements a JOIN sources s ON s.id = a.source_id
       WHERE s.key = 'manual_admin_edit' AND a.player_name_raw = ${S6}`;
    expect(orphans.n).toBe(0);
  });
});

describe('Stage 6 — atomicity of canonical + durable + audit (the ISSUE-027 contract)', () => {
  it('rolls the canonical change AND the override back when the audit insert fails', async () => {
    const recordId = nextKey('fkg');
    const id = await seedFirstKick(recordId);
    const entityKey = specialRecordEntityKey(S6_SOURCE_KEY, recordId);
    const before = await readFirstKickGoal(id);

    // The forced failure is an admin_user_id no auth_users row carries: the
    // canonical UPDATE and the data_overrides upsert both succeed, and the
    // data_edits insert then violates its foreign key — the last write in the
    // transaction, so a non-atomic implementation would leave the first two
    // committed and the change unaudited.
    const result = await suppressFirstKickGoal({
      rowId: id, expectedUpdatedAt: before!.updatedAt, adminUserId: -1,
      reason: 'forced audit failure',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('failed');

    const after = await readFirstKickGoal(id);
    expect(after!.status).toBe('active');
    expect(after!.statusReason).toBeNull();
    expect(after!.updatedAt).toBe(before!.updatedAt);
    expect(await overridesFor('player_achievements', entityKey)).toHaveLength(0);
    expect(await auditRows('player_achievements', id)).toHaveLength(0);
  });

  it('rolls a whole replacement back, both halves, when its audit fails', async () => {
    const recordId = nextKey('fkg');
    const id = await seedFirstKick(recordId);
    const before = await readFirstKickGoal(id);

    const result = await replaceFirstKickGoal({
      rowId: id, expectedUpdatedAt: before!.updatedAt, adminUserId: -1,
      reason: 'forced audit failure',
      replacement: { clubNameRaw: S6, season: 1897, roundRaw: S6, playerNameRaw: S6 },
    });
    expect(result.ok).toBe(false);

    const after = await readFirstKickGoal(id);
    expect(after!.status).toBe('active');
    const [created] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM player_achievements a JOIN sources s ON s.id = a.source_id
       WHERE s.key = 'manual_admin_edit' AND a.player_name_raw = ${S6}`;
    expect(created.n, 'the replacement half survived a rolled-back replacement').toBe(0);
  });
});

describe('Stage 6 — suppress, reinstate, and the history neither erases', () => {
  it('refuses a suppression with no reason', async () => {
    const recordId = nextKey('fkg');
    const id = await seedFirstKick(recordId);
    const before = await readFirstKickGoal(id);
    const result = await suppressFirstKickGoal({
      rowId: id, expectedUpdatedAt: before!.updatedAt, adminUserId: actorId, reason: '   ',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('validation');
    expect((await readFirstKickGoal(id))!.status).toBe('active');
  });

  it('suppresses, then reinstates, appending history and never erasing it', async () => {
    const recordId = nextKey('fkg');
    const id = await seedFirstKick(recordId);
    const entityKey = specialRecordEntityKey(S6_SOURCE_KEY, recordId);
    const reason = `${S6} duplicate of another entry`;

    const suppressed = await suppressFirstKickGoal({
      rowId: id, expectedUpdatedAt: (await readFirstKickGoal(id))!.updatedAt,
      adminUserId: actorId, reason,
    });
    expect(suppressed.ok, suppressed.ok ? '' : suppressed.error).toBe(true);
    if (suppressed.ok) {
      // The bounded revalidation contract: server-computed paths, in the set
      // the allowlisted route admits.
      expect(suppressed.revalidatePaths).toContain('/records/first-kick-goal');
      expect(suppressed.revalidatePaths).toContain(`/admin/records/first-kick-goal/${id}`);
      for (const path of suppressed.revalidatePaths) {
        expect(isAllowedRevalidatePath(path), `${path} is not allowlisted`).toBe(true);
      }
    }

    let row = await readFirstKickGoal(id);
    expect(row!.status).toBe('void');
    expect(row!.statusReason).toBe(reason);

    let durable = await overridesFor('player_achievements', entityKey);
    expect(durable).toHaveLength(1);
    expect(durable[0].fieldGroup).toBe('lifecycle');
    expect(durable[0].values).toMatchObject({ status: 'void', status_reason: reason });

    // The row is still on the ADMIN surface — that is what this surface is for.
    const adminPage = await listFirstKickGoals({ search: recordId });
    expect(adminPage.rows.map((r) => r.id)).toContain(id);

    const reinstated = await reinstateFirstKickGoal({
      rowId: id, expectedUpdatedAt: row!.updatedAt, adminUserId: actorId,
    });
    expect(reinstated.ok, reinstated.ok ? '' : reinstated.error).toBe(true);

    row = await readFirstKickGoal(id);
    expect(row!.status).toBe('active');
    expect(row!.statusReason).toBeNull();

    durable = await overridesFor('player_achievements', entityKey);
    expect(durable).toHaveLength(1);
    expect(durable[0].values).toMatchObject({ status: 'active', status_reason: null });

    // TWO audit rows, in order: the suppression is history and stays history.
    const audit = await auditRows('player_achievements', id);
    expect(audit.map((r) => r.fieldGroup))
      .toEqual(['first_kick_goal_suppressed', 'first_kick_goal_reinstated']);
    expect(audit[0].newValues).toMatchObject({ status: 'void', status_reason: reason });
    expect(audit[1].oldValues).toMatchObject({ status: 'void', status_reason: reason });
  });

  it('keeps a suppressed record out of the public read model (Stage 5, still)', async () => {
    const recordId = nextKey('fkg');
    const id = await seedFirstKick(recordId);
    const visible = async () => (await getFirstKickGoalList())
      .some((r) => r.id === id);

    expect(await visible(), 'the fixture is not public to begin with').toBe(true);
    const result = await suppressFirstKickGoal({
      rowId: id, expectedUpdatedAt: (await readFirstKickGoal(id))!.updatedAt,
      adminUserId: actorId, reason: `${S6} suppressed`,
    });
    expect(result.ok).toBe(true);
    expect(await visible()).toBe(false);
  });
});

describe('Stage 6 — manual creation, and the replay that must rebuild it', () => {
  it('creates a first-kick record whose durable payload the TS adapter re-creates', async () => {
    const created = await createFirstKickGoal({
      playerId: s6PlayerId,
      clubNameRaw: S6,
      season: s6MatchSeason,
      roundRaw: `${S6}-R1`,
      notes: S6,
      consecutiveGoalKicks: 2,
      matchId: s6MatchId,
      adminUserId: actorId,
    });
    expect(created.ok, created.ok ? '' : created.error).toBe(true);
    if (!created.ok) return;

    const row = await readFirstKickGoal(created.rowId);
    expect(row!.sourceKey).toBe('manual_admin_edit');
    expect(row!.sourceRecordId).toMatch(/^first_kick_goal:[0-9a-f-]{36}$/);
    expect(row!.playerId).toBe(s6PlayerId);
    expect(row!.matchId).toBe(s6MatchId);
    expect(created.entityKey).toBe(`manual_admin_edit:${row!.sourceRecordId}`);

    // The durable half is a WHOLE-ROW `record`, carrying the two link
    // identities as natural keys rather than ids.
    const durable = await overridesFor('player_achievements', created.entityKey);
    expect(durable).toHaveLength(1);
    expect(durable[0].fieldGroup).toBe('record');
    expect(durable[0].values).toMatchObject({
      club_name_raw: S6, season: s6MatchSeason, round_raw: `${S6}-R1`,
      consecutive_goal_kicks: 2, status: 'active', match_key: s6MatchKey,
    });
    expect(durable[0].values.player_identity).toMatch(/^afltables:/);

    const audit = await auditRows('player_achievements', created.rowId);
    expect(audit).toHaveLength(1);
    expect(audit[0].fieldGroup).toBe('first_kick_goal_created');

    // A DESTRUCTIVE REBUILD, simulated: the row goes, the decision stays.
    await owner`DELETE FROM player_achievements WHERE id = ${created.rowId}`;
    const counts = await owner.begin(async (tx) => replaySpecialRecordOverrides(
      tx as never, 'player_achievements', { warn: () => {} },
    ));
    expect(counts.recreated).toBeGreaterThanOrEqual(1);

    const [rebuilt] = await owner<{
      id: number; season: number; roundRaw: string; consecutive: number;
      playerId: number | null; matchId: number | null; status: string; clubNameRaw: string;
    }[]>`
      SELECT id::int AS id, season::int AS season, round_raw AS "roundRaw",
             consecutive_goal_kicks::int AS consecutive, player_id AS "playerId",
             match_id AS "matchId", status, club_name_raw AS "clubNameRaw"
        FROM player_achievements
       WHERE source_record_id = ${row!.sourceRecordId}`;
    expect(rebuilt, 'the replay did not rebuild the manual record').toBeDefined();
    expect(rebuilt.season).toBe(s6MatchSeason);
    expect(rebuilt.roundRaw).toBe(`${S6}-R1`);
    expect(rebuilt.consecutive).toBe(2);
    expect(rebuilt.clubNameRaw).toBe(S6);
    expect(rebuilt.status).toBe('active');
    // The two links came back, resolved from the natural identities.
    expect(rebuilt.playerId).toBe(s6PlayerId);
    expect(rebuilt.matchId).toBe(s6MatchId);
  });

  // AFLDB-ISSUE-176: a special record must not accept a match link that is
  // inconsistent with the record it is attached to.
  it('refuses to create a first-kick-goal record whose match is from a different season', async () => {
    const roundRaw = `${S6}-badseason`;
    const wrongSeason = s6MatchSeason === 1897 ? 1898 : 1897;
    const result = await createFirstKickGoal({
      playerId: s6PlayerId,
      clubNameRaw: S6,
      season: wrongSeason,
      roundRaw,
      matchId: s6MatchId,
      adminUserId: actorId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('validation');
      expect(result.error).toMatch(/season/);
    }
    const [rows] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM player_achievements WHERE round_raw = ${roundRaw}`;
    expect(rows.n, 'the mismatched-season create wrote a canonical row').toBe(0);
    const [edits] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM data_edits WHERE new_values::text LIKE ${`%${roundRaw}%`}`;
    expect(edits.n, 'the mismatched-season create wrote an audit row').toBe(0);
  });

  it('refuses to create a first-kick-goal record linking a player absent from the match', async () => {
    const roundRaw = `${S6}-noplayerstats`;
    const result = await createFirstKickGoal({
      playerId: s6OtherPlayerId,
      clubNameRaw: S6,
      season: s6MatchSeason,
      roundRaw,
      matchId: s6MatchId,
      adminUserId: actorId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('validation');
      expect(result.error).toMatch(/match statistics/);
    }
    const [rows] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM player_achievements WHERE round_raw = ${roundRaw}`;
    expect(rows.n, 'the unplayed-match create wrote a canonical row').toBe(0);
  });

  it('creates an after-siren record and refuses a combination the CHECKs reject', async () => {
    const bad = await createAfterSirenKick({
      clubNameRaw: S6, opponentNameRaw: S6, competition: S6, premiershipSeason: false,
      season: 1897, roundRaw: S6, kickScored: 'goal', kickEffect: 'won', kickerResult: 'win',
      kickerScoreRaw: '12.10 (82)', opponentScoreRaw: '12.4 (76)',
      kickerPoints: 82, opponentPoints: 60, playerNameRaw: S6, adminUserId: actorId,
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.reason).toBe('validation');
      expect(bad.error).toMatch(/1 to 6 points/);
    }

    const created = await createAfterSirenKick({
      playerId: s6PlayerId,
      clubNameRaw: S6, opponentNameRaw: S6, competition: S6, premiershipSeason: true,
      season: 1897, roundRaw: S6, kickScored: 'goal', kickEffect: 'won', kickerResult: 'win',
      kickerScoreRaw: '12.10 (82)', opponentScoreRaw: '12.4 (76)',
      kickerPoints: 82, opponentPoints: 76, notes: S6, adminUserId: actorId,
    });
    expect(created.ok, created.ok ? '' : created.error).toBe(true);
    if (!created.ok) return;

    const row = await readAfterSirenKick(created.rowId);
    expect(row!.sourceKey).toBe('manual_admin_edit');
    expect(row!.sourceRecordId).toMatch(/^after_siren:[0-9a-f-]{36}$/);

    const durable = await overridesFor('after_siren_kicks', created.entityKey);
    expect(durable).toHaveLength(1);
    expect(durable[0].fieldGroup).toBe('record');
    expect(durable[0].values).toMatchObject({
      kick_scored: 'goal', kick_effect: 'won', kicker_result: 'win',
      kicker_points: 82, opponent_points: 76, status: 'active',
    });
  });

  it('refuses to create an after-siren record whose match is from a different season', async () => {
    const roundRaw = `${S6}-badseason`;
    const wrongSeason = s6MatchSeason === 1897 ? 1898 : 1897;
    const result = await createAfterSirenKick({
      playerId: s6PlayerId,
      clubNameRaw: S6, opponentNameRaw: S6, competition: S6, premiershipSeason: true,
      season: wrongSeason, roundRaw, kickScored: 'goal', kickEffect: 'won', kickerResult: 'win',
      kickerScoreRaw: '12.10 (82)', opponentScoreRaw: '12.4 (76)',
      kickerPoints: 82, opponentPoints: 76, matchId: s6MatchId, adminUserId: actorId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('validation');
      expect(result.error).toMatch(/season/);
    }
    const [rows] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM after_siren_kicks WHERE round_raw = ${roundRaw}`;
    expect(rows.n, 'the mismatched-season create wrote a canonical row').toBe(0);
  });

  it('refuses to link a non-premiership manual after-siren row to a match', async () => {
    const result = await createAfterSirenKick({
      clubNameRaw: S6, opponentNameRaw: S6, competition: S6, premiershipSeason: false,
      season: 1897, roundRaw: S6, kickScored: 'goal', kickEffect: 'none', kickerResult: 'loss',
      kickerScoreRaw: '12.10 (82)', opponentScoreRaw: '12.4 (76)',
      kickerPoints: 76, opponentPoints: 82, playerNameRaw: S6,
      matchId: s6MatchId, adminUserId: actorId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/premiership-season/);
  });
});

describe('Stage 6 — replace is one transaction, and it is not an identity edit', () => {
  it('suppresses the old record and creates the manual replacement together', async () => {
    const recordId = nextKey('fkg');
    const id = await seedFirstKick(recordId);
    const oldKey = specialRecordEntityKey(S6_SOURCE_KEY, recordId);
    const before = await readFirstKickGoal(id);

    const result = await replaceFirstKickGoal({
      rowId: id,
      expectedUpdatedAt: before!.updatedAt,
      adminUserId: actorId,
      reason: `${S6} the source record id belongs to a different kick`,
      replacement: {
        playerId: s6PlayerId, clubNameRaw: S6, season: 1897, roundRaw: `${S6}-replacement`,
        notes: S6,
      },
    });
    expect(result.ok, result.ok ? '' : result.error).toBe(true);
    if (!result.ok) return;

    // The old row is SUPPRESSED, not deleted, and keeps its own identity.
    const old = await readFirstKickGoal(id);
    expect(old!.status).toBe('void');
    expect(old!.sourceRecordId).toBe(recordId);
    expect(result.suppressedRowId).toBe(id);
    expect(result.suppressedEntityKey).toBe(oldKey);

    // The new row is a MANUAL record with its own minted identity.
    const replacement = await readFirstKickGoal(result.rowId);
    expect(replacement!.sourceKey).toBe('manual_admin_edit');
    expect(replacement!.roundRaw).toBe(`${S6}-replacement`);

    // The two durable payloads cross-reference each other by NATURAL key.
    const [oldDurable] = await overridesFor('player_achievements', oldKey);
    expect(oldDurable.fieldGroup).toBe('lifecycle');
    expect(oldDurable.values).toMatchObject({
      status: 'void', replaced_by_key: result.entityKey,
    });
    const [newDurable] = await overridesFor('player_achievements', result.entityKey);
    expect(newDurable.fieldGroup).toBe('record');
    expect(newDurable.values).toMatchObject({ replaces_key: oldKey });

    // Both audit rows share one replacement id.
    const oldAudit = await auditRows('player_achievements', id);
    const newAudit = await auditRows('player_achievements', result.rowId);
    expect(oldAudit).toHaveLength(1);
    expect(newAudit).toHaveLength(1);
    expect(oldAudit[0].newValues.replacement_id).toBe(result.replacementId);
    expect(newAudit[0].newValues.replacement_id).toBe(result.replacementId);
  });
});

describe('Stage 6 — the durable authority combinations Stage 4 must never meet', () => {
  it('replays a correction and a lifecycle decision together, in order', async () => {
    const recordId = nextKey('fkg');
    const id = await seedFirstKick(recordId);
    const entityKey = specialRecordEntityKey(S6_SOURCE_KEY, recordId);

    const corrected = await correctFirstKickGoal({
      rowId: id, expectedUpdatedAt: (await readFirstKickGoal(id))!.updatedAt,
      adminUserId: actorId, fields: { roundRaw: 'GF' },
    });
    expect(corrected.ok, corrected.ok ? '' : corrected.error).toBe(true);
    const suppressed = await suppressFirstKickGoal({
      rowId: id, expectedUpdatedAt: (await readFirstKickGoal(id))!.updatedAt,
      adminUserId: actorId, reason: `${S6} wrong kick`,
    });
    expect(suppressed.ok, suppressed.ok ? '' : suppressed.error).toBe(true);

    // Two active overrides, disjoint groups — NOT a collision (§23.4).
    const durable = await overridesFor('player_achievements', entityKey);
    expect(durable.map((r) => r.fieldGroup)).toEqual(['correction', 'lifecycle']);

    // An ORDINARY RELOAD, simulated: the importer rewrites the source-owned
    // columns and leaves the lifecycle alone (they are not in its column list).
    await owner`
      UPDATE player_achievements SET round_raw = ${S6}, status = 'active', status_reason = NULL
       WHERE id = ${id}`;

    const counts = await owner.begin(async (tx) => replaySpecialRecordOverrides(
      tx as never, 'player_achievements', { warn: () => {} },
    ));
    expect(counts.corrected).toBeGreaterThanOrEqual(1);
    expect(counts.lifecycle).toBeGreaterThanOrEqual(1);

    const after = await readFirstKickGoal(id);
    expect(after!.roundRaw).toBe('GF');
    expect(after!.status).toBe('void');
    expect(after!.statusReason).toBe(`${S6} wrong kick`);
  });

  it('refuses a mutation that would put a second authority beside a record one', async () => {
    const recordId = nextKey('fkg');
    const id = await seedFirstKick(recordId);
    const entityKey = specialRecordEntityKey(S6_SOURCE_KEY, recordId);

    // A `record` override planted directly — the shape an operator repair or an
    // older tool could leave behind. The mutation path itself never creates
    // one beside a source-owned row, which is exactly why this is planted.
    await owner`
      INSERT INTO data_overrides (entity_type, entity_key, field_group, override_values,
                                  admin_user_id, is_active)
      VALUES ('player_achievements', ${entityKey}, 'record',
              ${owner.json({ status: 'active', player_name_raw: S6 } as never)},
              ${actorId}, true)`;

    const result = await correctFirstKickGoal({
      rowId: id, expectedUpdatedAt: (await readFirstKickGoal(id))!.updatedAt,
      adminUserId: actorId, fields: { roundRaw: 'R3' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('conflict');
      expect(result.error).toMatch(/record decision owns the whole row/);
    }

    // Refused AFTER the canonical UPDATE had run, so the rollback is what keeps
    // the row unchanged — the RollbackRefusal contract, proven rather than assumed.
    expect((await readFirstKickGoal(id))!.roundRaw).toBe(S6);
    expect((await overridesFor('player_achievements', entityKey)).map((r) => r.fieldGroup))
      .toEqual(['record']);
    expect(await auditRows('player_achievements', id)).toHaveLength(0);
  });

  it('fails the replay closed when two authorities do reach it', async () => {
    const recordId = nextKey('fkg');
    const id = await seedFirstKick(recordId);
    const entityKey = specialRecordEntityKey(S6_SOURCE_KEY, recordId);
    for (const group of ['record', 'lifecycle']) {
      await owner`
        INSERT INTO data_overrides (entity_type, entity_key, field_group, override_values,
                                    admin_user_id, is_active)
        VALUES ('player_achievements', ${entityKey}, ${group},
                ${owner.json({ status: 'void', status_reason: S6, player_name_raw: S6,
                  player_name_clean: S6, club_name_raw: S6, season: 1897,
                  round_raw: S6 } as never)},
                ${actorId}, true)`;
    }
    await expect(owner.begin(async (tx) => replaySpecialRecordOverrides(
      tx as never, 'player_achievements', { warn: () => {} },
    ))).rejects.toThrow(/more than one active override resolves to this row/);
    expect((await readFirstKickGoal(id))!.status).toBe('active');
  });
});

describe('Stage 6 — a match carrying a curated record cannot be deleted (§8.3)', () => {
  let fixtureMatchId: number | null = null;

  afterAll(async () => {
    if (fixtureMatchId !== null) {
      await owner`DELETE FROM player_achievements WHERE match_id = ${fixtureMatchId}`;
      await owner`DELETE FROM after_siren_kicks WHERE match_id = ${fixtureMatchId}`;
      await owner`DELETE FROM matches WHERE id = ${fixtureMatchId}`;
    }
  });

  it('refuses for a first-kick record AND for an after-siren record, naming both', async () => {
    // A throwaway match of this suite's own making: a regression here would
    // delete the match, so it must never be a real one.
    const [clubs] = await owner<{ home: number; away: number }[]>`
      SELECT min(id)::int AS home, max(id)::int AS away FROM clubs`;
    const [season] = await owner<{ year: number }[]>`SELECT max(year)::int AS year FROM seasons`;
    const [match] = await owner<{ id: number }[]>`
      INSERT INTO matches (
        match_key, season, round_code, round_type, round_number, is_final, match_date,
        venue_raw, home_club_id, away_club_id, home_score, away_score, result,
        winner_club_id, margin, attendance_status
      ) VALUES (
        ${`${S6}-match`}, ${season.year}::smallint, '1', 'home_and_away', 1, false,
        ${`${season.year}-03-01`}::date, ${S6}, ${clubs.home}, ${clubs.away}, 82, 76,
        'home_win', ${clubs.home}, 6, 'not_collected'
      ) RETURNING id::int AS id`;
    fixtureMatchId = match.id;

    const achievementId = await seedFirstKick(nextKey('fkg'), { matchId: match.id });
    const kickId = await seedAfterSiren(nextKey('asr'), { matchId: match.id, premiership: true });

    const result = await deleteMatch({ matchId: match.id, adminUserId: actorId });
    expect(result.ok, 'the match delete destroyed a curated record').toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/cannot be deleted/);
      expect(result.error).toMatch(/first-kick-goal/);
      expect(result.error).toMatch(/after-the-siren/);
      expect(result.error).toMatch(/\/admin\/records\//);
    }

    // Everything survived: the match, and both curated records with it.
    const [still] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM matches WHERE id = ${match.id}`;
    expect(still.n).toBe(1);
    expect(await readFirstKickGoal(achievementId)).not.toBeNull();
    expect(await readAfterSirenKick(kickId)).not.toBeNull();
  });

  it('refuses even when the curated record is already suppressed', async () => {
    // Suppression says the record should never have existed. It does not say
    // the ROW may be destroyed: the row is what keeps its audit history
    // resolvable through the next promotion's lineage remap.
    expect(fixtureMatchId).not.toBeNull();
    const achievementId = await seedFirstKick(nextKey('fkg'), {
      matchId: fixtureMatchId!, status: 'void',
    });
    const result = await deleteMatch({ matchId: fixtureMatchId!, adminUserId: actorId });
    expect(result.ok).toBe(false);
    expect(await readFirstKickGoal(achievementId)).not.toBeNull();
  });
});
