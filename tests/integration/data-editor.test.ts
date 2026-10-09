import './guard';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { sql } from '@/db/client';
import { saveEdit } from '@/db/queries/data-edits';
import { deleteMatch } from '@/db/queries/match-admin';
import { loadMatchSheetStaleToken, returnMatchSheetToSource, saveMatchSheet } from '@/db/queries/match-sheet';
import { playerMatchStatsAuthorityStorable } from '@/lib/acquisition/manual-authority';
import { AUTHORITY_UNAVAILABLE_REFUSAL } from '@/lib/acquisition/match-sheet-authority';
import { createPlayerInTransaction } from '@/db/queries/players';
import {
  MATCH_BUSY_REFUSAL,
  recomputeClubSeasons,
  recomputePlayerDerivedStats,
  recomputeSeasonBrownlowStatus,
  recomputeSeasonMetadata,
} from '@/db/queries/player-derived';
import { DERIVED_RECOMPUTE_DEADLOCK_BACKOFF_MS, runDerivedRecomputeWithDeadlockRetry } from '@/lib/acquisition/settle-core';
import { BROWNLOW_MATCH_SHEET_REFUSAL } from '@/lib/match-sheet';
import { createImportRoleParityHarness } from './import-role-parity';
import { seedWildcardFinalSeason, type WildcardFixture } from './wildcard-final-fixture';

// Ensure saveMatchSheet uses the test database.
process.env.AFLDB_IMPORT_DATABASE_URL = process.env.AFLDB_TEST_DATABASE_URL;
const importRole = createImportRoleParityHarness(
  process.env.AFLDB_TEST_DATABASE_URL,
  process.env.AFLDB_TEST_IMPORT_DATABASE_URL,
);
const roleParitySuffix = importRole.isConfigured ? '' : ` — ${importRole.skipMessage}`;

// The required data_edits audit commits inside the mutation transaction
// (AFLDB-ISSUE-027), so committing tests need a real auth_users row in
// THIS database for the admin_user_id foreign key.
const TEST_NOTES = [
  'test mutation',
  'restore',
  'issue-027 atomic audit test',
  'issue-083 restricted import-role audit proof',
  'issue-109 restricted override proof',
  'issue-109 restricted override restore',
  'issue-132 wildcard brownlow refusal',
];
let adminUserId = 0;
let createdThrowawayAdmin = false;

/** The stale-sheet token the editor would have been rendered with, right now. */
const tokenOf = (matchId: number) => loadMatchSheetStaleToken(sql, matchId);

/* ---------------------------------------------------------------------------------------
 * AFLDB-ISSUE-257 synthetic fixtures (F-S10-02 / F-S10-01).
 *
 * Every Match Sheet case that saves, replays, returns or deletes a player_match_stats row
 * owns a SYNTHETIC season/match/player/identity/row and never mutates a real historical row
 * (the earlier real-row picks lost 14 rows when a delete-and-reinsert restore failed on
 * GENERATED ALWAYS player_match_stats.id). Convention: COMMITTED fixtures in a reserved
 * namespace, the one tests/integration/wildcard-final-fixture.ts and the ISSUE-122 settle
 * suite established; the writer and the real Python replay open their own connections, so an
 * uncommitted fixture would be invisible to them. `clubs` and `sources` are READ, never
 * written.
 *
 *   season 2079 (claimed here; 2080 is the AFLDB-ISSUE-261 contention fixture at the end of this
 *   file; 2083/2088 are this file's older fixtures, 2086-2099 other suites)
 *   match_key          2079|issue257-<token>   (a durable-authority key is season-prefixed)
 *   absent-key control 9999|issue257-...       (never a real match)
 *   player slug        issue257-<token>
 *   AFL Tables path    issue257_players/<X>/<token>0.html
 *
 * Cleanup is idempotent, runs in beforeAll (leftovers of a crashed run), afterEach (so an
 * assertion failure cannot leave rows behind) and afterAll, then a residue assertion proves
 * nothing of the namespace remains. A suite-level guard proves the historical rows are
 * unchanged. No case deletes and re-inserts a real row.
 * ------------------------------------------------------------------------------------ */
const SEASON_257 = 2079;
const KEY_ROOT_257 = `${SEASON_257}|issue257-`;
const ABSENT_ROOT_257 = '9999|issue257-';
const SLUG_257 = 'issue257-';
const PATH_ROOT_257 = 'issue257_players/';
const FX_TIMEOUT = 120_000;

type Row257 = Record<string, number | string | null>;
type Fx257 = {
  matchId: number; matchKey: string; season: number; playerId: number;
  clubId: number; clubSlug: string; path: string | null; sourceId: number;
  jumperNumber: string; goals: number; behinds: number; kicks: number; handballs: number;
  disposals: number; marks: number; tackles: number; hitouts: number;
  freesFor: number; freesAgainst: number;
  row: Row257;
  /** D-257-9 fixtures only: the two tracked profile_url_continuity paths the player holds. */
  continuing?: string; renumbered?: string;
};

const STAT_257 = {
  jumperNumber: '7', goals: 3, behinds: 1, kicks: 12, handballs: 8, disposals: 20,
  marks: 4, tackles: 3, hitouts: 2, freesFor: 1, freesAgainst: 1,
};
const seededPlayerIds257: number[] = [];
const seededMatchIds257: number[] = [];
const idList257 = (ids: number[]) => (ids.length > 0 ? ids : [0]);

/**
 * One match (home/away from two existing clubs), one player holding one source-owned row,
 * the player's durable identity (an accepted AFL Tables profile URL, none when
 * `identity: false`, or both tracked continuity paths when `folded`), and the derived rows
 * the production builder produces for that player. Committed.
 */
async function seedFixture257(
  name: string,
  opts: { identity?: boolean; folded?: { continuing: string; renumbered: string } } = {},
): Promise<Fx257> {
  const token = name.replace(/[^A-Za-z0-9]/g, '');
  const fx = await sql.begin(async (tx) => {
    const clubs = await tx<{ id: number; slug: string }[]>`
      SELECT DISTINCT ON (organization_id) id::int AS id, slug
        FROM clubs
       WHERE organization_id IS NOT NULL
       ORDER BY organization_id, id
       LIMIT 2
    `;
    if (clubs.length < 2) throw new Error('ISSUE-257 fixture needs two club identities');
    const [home, away] = clubs;
    const [source] = await tx<{ id: number }[]>`SELECT id::int AS id FROM sources WHERE key = 'afltables'`;
    await tx`
      INSERT INTO seasons (year, league, status)
      VALUES (${SEASON_257}, 'AFL', 'complete'::season_status)
      ON CONFLICT DO NOTHING
    `;
    const matchKey = `${KEY_ROOT_257}${token}`;
    const [match] = await tx<{ id: number }[]>`
      INSERT INTO matches (
        match_key, season, round_code, round_number, round_type, is_final,
        match_date, venue_raw, home_club_id, away_club_id,
        home_score, away_score, result, winner_club_id, margin,
        attendance, attendance_status, source_id
      ) VALUES (
        ${matchKey}, ${SEASON_257}, '1', 1, 'home_and_away'::round_type, false,
        ${`${SEASON_257}-03-05`}, 'ISSUE-257 Fixture Oval', ${home.id}, ${away.id},
        100, 80, 'home_win'::match_result, ${home.id}, 20,
        NULL, 'not_collected'::coverage_status, ${source.id}
      )
      RETURNING id::int AS id
    `;
    const [player] = await tx<{ id: number }[]>`
      INSERT INTO players (display_name, sort_name, search_name, slug)
      VALUES (${`Issue257 ${token}`}, ${`${token}, Issue257`}, ${`issue257 ${token.toLowerCase()}`},
              ${`${SLUG_257}${token.toLowerCase()}`})
      RETURNING id::int AS id
    `;
    const paths = opts.folded
      ? [opts.folded.continuing, opts.folded.renumbered]
      : opts.identity === false ? [] : [`${PATH_ROOT_257}${token.charAt(0).toUpperCase()}/${token}0.html`];
    for (const path of paths) {
      await tx`
        INSERT INTO external_identities (source_id, external_id, player_id, status, match_method)
        VALUES (${source.id}, ${path}, ${player.id}, 'unique', 'afltables_profile_url')
      `;
    }
    await tx`
      INSERT INTO player_match_stats (
        player_id, match_id, club_id, jumper_number, kicks, marks, handballs, disposals,
        goals, behinds, hitouts, tackles, frees_for, frees_against, source_id
      ) VALUES (
        ${player.id}, ${match.id}, ${home.id}, ${STAT_257.jumperNumber}, ${STAT_257.kicks},
        ${STAT_257.marks}, ${STAT_257.handballs}, ${STAT_257.disposals}, ${STAT_257.goals},
        ${STAT_257.behinds}, ${STAT_257.hitouts}, ${STAT_257.tackles}, ${STAT_257.freesFor},
        ${STAT_257.freesAgainst}, ${source.id}
      )
    `;
    await recomputePlayerDerivedStats(tx, [player.id], SEASON_257);
    const [stat] = await tx<{ row: Row257 }[]>`
      SELECT to_jsonb(s) AS row FROM player_match_stats s
       WHERE s.match_id = ${match.id} AND s.player_id = ${player.id}
    `;
    return {
      matchId: match.id, matchKey, season: SEASON_257, playerId: player.id,
      clubId: home.id, clubSlug: home.slug, path: paths[0] ?? null, sourceId: source.id,
      ...STAT_257, row: stat.row,
      ...(opts.folded ? { continuing: opts.folded.continuing, renumbered: opts.folded.renumbered } : {}),
    } satisfies Fx257;
  });
  seededPlayerIds257.push(fx.playerId);
  seededMatchIds257.push(fx.matchId);
  return fx;
}

/**
 * Remove every row of the ISSUE-257 namespace, children first. Idempotent; every statement
 * is a no-op when nothing was seeded. Never touches a row outside the namespace (the season
 * row only when no match, real or not, still references it).
 */
async function cleanup257(): Promise<void> {
  // Fresh fragments per use (postgres.js fragments are single-use query objects).
  const players = () => sql`(SELECT id FROM players WHERE starts_with(slug, ${SLUG_257}::text))`;
  const matches = () => sql`(SELECT id FROM matches WHERE starts_with(match_key, ${KEY_ROOT_257}::text))`;
  await sql`
    DELETE FROM data_overrides
     WHERE entity_type = 'player_match_stats'
       AND (starts_with(entity_key, ${KEY_ROOT_257}::text) OR starts_with(entity_key, ${ABSENT_ROOT_257}::text))
  `;
  await sql`
    DELETE FROM data_edits
     WHERE table_name = 'matches'
       AND (row_id = ANY(${idList257(seededMatchIds257)}) OR row_id IN ${matches()})
  `;
  if (adminUserId > 0) {
    await sql`
      DELETE FROM data_edits
       WHERE admin_user_id = ${adminUserId} AND starts_with(note, 'issue-257 ')
    `;
  }
  await sql`
    DELETE FROM player_match_stats
     WHERE player_id IN ${players()} OR match_id IN ${matches()}
  `;
  for (const table of ['player_clubs', 'player_club_season_stats', 'player_season_stats', 'player_career_stats']) {
    await sql`DELETE FROM ${sql(table)} WHERE player_id IN ${players()}`;
  }
  await sql`DELETE FROM club_seasons WHERE season = ${SEASON_257}`;
  await sql`
    DELETE FROM external_identities
     WHERE player_id IN ${players()} OR starts_with(external_id, ${PATH_ROOT_257}::text)
  `;
  await sql`DELETE FROM players WHERE starts_with(slug, ${SLUG_257}::text)`;
  await sql`DELETE FROM matches WHERE starts_with(match_key, ${KEY_ROOT_257}::text)`;
  await sql`
    DELETE FROM seasons
     WHERE year = ${SEASON_257}
       AND NOT EXISTS (SELECT 1 FROM matches WHERE season = ${SEASON_257})
  `;
}

const NO_RESIDUE_257 = {
  dataOverrides: 0, dataEdits: 0, playerMatchStats: 0, playerClubs: 0, playerClubSeasonStats: 0,
  playerSeasonStats: 0, playerCareerStats: 0, clubSeasons: 0, externalIdentities: 0,
  players: 0, matches: 0, seasons: 0,
};

/** Counts of every namespace row, by namespace prefix AND by the ids this run seeded. */
async function residue257(): Promise<typeof NO_RESIDUE_257> {
  const pids = idList257(seededPlayerIds257);
  const mids = idList257(seededMatchIds257);
  const [r] = await sql<(typeof NO_RESIDUE_257)[]>`
    SELECT
      (SELECT count(*) FROM data_overrides
        WHERE entity_type = 'player_match_stats'
          AND (starts_with(entity_key, ${KEY_ROOT_257}::text)
               OR starts_with(entity_key, ${ABSENT_ROOT_257}::text)))::int AS "dataOverrides",
      (SELECT count(*) FROM data_edits
        WHERE table_name = 'matches' AND row_id = ANY(${mids}))::int AS "dataEdits",
      (SELECT count(*) FROM player_match_stats
        WHERE player_id = ANY(${pids}) OR match_id = ANY(${mids}))::int AS "playerMatchStats",
      (SELECT count(*) FROM player_clubs WHERE player_id = ANY(${pids}))::int AS "playerClubs",
      (SELECT count(*) FROM player_club_season_stats WHERE player_id = ANY(${pids}))::int AS "playerClubSeasonStats",
      (SELECT count(*) FROM player_season_stats WHERE player_id = ANY(${pids}))::int AS "playerSeasonStats",
      (SELECT count(*) FROM player_career_stats WHERE player_id = ANY(${pids}))::int AS "playerCareerStats",
      (SELECT count(*) FROM club_seasons WHERE season = ${SEASON_257})::int AS "clubSeasons",
      (SELECT count(*) FROM external_identities
        WHERE player_id = ANY(${pids}) OR starts_with(external_id, ${PATH_ROOT_257}::text))::int AS "externalIdentities",
      (SELECT count(*) FROM players
        WHERE id = ANY(${pids}) OR starts_with(slug, ${SLUG_257}::text))::int AS "players",
      (SELECT count(*) FROM matches
        WHERE id = ANY(${mids}) OR starts_with(match_key, ${KEY_ROOT_257}::text))::int AS "matches",
      (SELECT count(*) FROM seasons WHERE year = ${SEASON_257})::int AS "seasons"
  `;
  return r;
}

/**
 * Historical-row guard. Taken after the pre-clean and compared after the final cleanup:
 * exact counts of player_match_stats and every derived table the writer rebuilds, plus a
 * content checksum over a deterministic 1/61 sample of player_match_stats (rows whose
 * player_id + match_id is divisible by 61). Counts catch lost or duplicated rows (the F-S10-02
 * failure); the sample catches in-place edits. Deliberately NOT pg_stat_user_tables deltas
 * (asynchronous and approximate) and NOT a full-table checksum (the full scans cost
 * ~28-41 s on afldb_test). Cost: one sequential pass per table inside a read-only
 * transaction with a local statement timeout; expected a few seconds in total.
 */
type Historical257 = Record<string, number | string>;
async function historicalSnapshot257(): Promise<Historical257> {
  return sql.begin('read only', async (tx) => {
    await tx`SELECT set_config('statement_timeout', '300s', true)`;
    const [r] = await tx<Historical257[]>`
      SELECT
        (SELECT count(*) FROM player_match_stats)::int AS "playerMatchStats",
        (SELECT count(*) FROM player_season_stats)::int AS "playerSeasonStats",
        (SELECT count(*) FROM player_career_stats)::int AS "playerCareerStats",
        (SELECT count(*) FROM player_club_season_stats)::int AS "playerClubSeasonStats",
        (SELECT count(*) FROM player_clubs)::int AS "playerClubs",
        (SELECT count(*) FROM club_seasons)::int AS "clubSeasons",
        (SELECT coalesce(sum(hashtextextended(to_jsonb(s)::text, 0)::numeric), 0)::text
           FROM player_match_stats s WHERE (s.player_id + s.match_id) % 61 = 0) AS "playerMatchStatsSample"
    `;
    return r;
  });
}
let historicalBefore: Historical257 | undefined;

/** A complete sheet row for the fixture player (a save replaces the whole row). */
const sheetInput257 = (
  f: Fx257,
  over: { goals?: number | null; kicks?: number; disposals?: number } = {},
) => ({
  playerId: f.playerId, clubId: f.clubId, jumperNumber: f.jumperNumber,
  goals: f.goals, behinds: f.behinds, kicks: f.kicks, handballs: f.handballs,
  disposals: f.disposals, marks: f.marks, tackles: f.tackles, hitouts: f.hitouts,
  freesFor: f.freesFor, freesAgainst: f.freesAgainst, ...over,
});

const rowSnapshot257 = async (f: Fx257) => {
  const [r] = await sql<{ row: unknown }[]>`
    SELECT to_jsonb(s) AS row FROM player_match_stats s
     WHERE s.match_id = ${f.matchId} AND s.player_id = ${f.playerId}
  `;
  return r?.row ?? null;
};

const authorityOf257 = (f: Fx257) => sql<{
  entityKey: string; fieldGroup: string; isActive: boolean; overrideValues: Record<string, unknown>;
}[]>`
  SELECT entity_key AS "entityKey", field_group AS "fieldGroup", is_active AS "isActive",
         override_values AS "overrideValues"
    FROM data_overrides
   WHERE entity_type = 'player_match_stats' AND starts_with(entity_key, ${f.matchKey}::text || '|')
   ORDER BY entity_key, field_group
`;

const auditCountOf257 = async (f: Fx257, note?: string) => {
  const [r] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM data_edits
     WHERE table_name = 'matches' AND row_id = ${f.matchId}
       AND (${note ?? null}::text IS NULL OR note = ${note ?? null})
  `;
  return r.n;
};

// Runs after EVERY case, passing or failing: the namespace never outlives a case.
afterEach(async () => {
  await cleanup257();
});

beforeAll(async () => {
  const [existing] = await sql<{ id: number }[]>`
    SELECT id FROM auth_users ORDER BY id LIMIT 1
  `;
  if (existing) {
    adminUserId = existing.id;
  } else {
    const [created] = await sql<{ id: number }[]>`
      INSERT INTO auth_users (email, role)
      VALUES ('issue-027-audit-test@example.test', 'admin')
      RETURNING id
    `;
    adminUserId = created.id;
    createdThrowawayAdmin = true;
  }
  // Pre-clean (leftovers of a crashed run), THEN the historical-row baseline.
  await cleanup257();
  historicalBefore = await historicalSnapshot257();
}, 120_000);

afterAll(async () => {
  try {
    await cleanup257();
    // Remove the audit rows the committing tests above legitimately wrote
    // (the runner connects as the table owner, so append-only grants do
    // not apply here).
    await sql`
      DELETE FROM data_edits
       WHERE admin_user_id = ${adminUserId} AND note = ANY(${TEST_NOTES})
    `;
    if (createdThrowawayAdmin) {
      await sql`DELETE FROM auth_users WHERE id = ${adminUserId}`;
    }
    // No fixture row remains, and no historical row was lost, duplicated or edited.
    expect(await residue257()).toEqual(NO_RESIDUE_257);
    expect(historicalBefore, 'the historical baseline was not taken').toBeDefined();
    expect(await historicalSnapshot257()).toEqual(historicalBefore);
  } finally {
    await sql.end();
  }
}, 120_000);

describe('Data Editor - Match Sheet Delta Tests', () => {
  // F-S10-01 / F-S10-02: a synthetic fixture, and the schema state is DETERMINED before the
  // save (playerMatchStatsAuthorityStorable), never inferred from a failed save.
  //   State A (migration 110 not applied): the save is refused with the authority-unavailable
  //     refusal and nothing is written.
  //   State B (migration 110 applied): the save commits, the values persist, and the durable
  //     authority is recorded.
  it('propagates kicks correctly', async () => {
    const storable = await playerMatchStatsAuthorityStorable(sql);
    const fx = await seedFixture257('pre257-kicks');

    // Baseline season/career stats (the fixture's derived rows, built by the production builder).
    const [seasonBaseline] = await sql<{ kicks: number; disposals: number }[]>`
      SELECT kicks::int AS kicks, disposals::int AS disposals FROM player_season_stats
       WHERE player_id = ${fx.playerId} AND season = ${fx.season}
    `;
    const [careerBaseline] = await sql<{ kicks: number; disposals: number }[]>`
      SELECT kicks::int AS kicks, disposals::int AS disposals FROM player_career_stats
       WHERE player_id = ${fx.playerId}
    `;
    expect(seasonBaseline).toMatchObject({ kicks: fx.kicks, disposals: fx.disposals });
    expect(careerBaseline).toMatchObject({ kicks: fx.kicks, disposals: fx.disposals });

    const before = await rowSnapshot257(fx);
    const newKicks = fx.kicks + 1;
    const result = await saveMatchSheet({
      matchId: fx.matchId,
      syncMatchScores: false,
      players: [sheetInput257(fx, { kicks: newKicks, disposals: newKicks + fx.handballs })],
      adminUserId,
      note: 'test mutation',
      staleToken: await tokenOf(fx.matchId),
    });

    if (!storable) {
      // State A: refused, and no write of any kind.
      expect(result).toEqual({ ok: false, error: AUTHORITY_UNAVAILABLE_REFUSAL });
      expect(await rowSnapshot257(fx)).toEqual(before);
      expect(await authorityOf257(fx)).toHaveLength(0);
      expect(await auditCountOf257(fx)).toBe(0);
      return;
    }

    // State B: saved; the kicks persist and propagate to the derived stats.
    expect(result.ok).toBe(true);
    const [updatedStat] = await sql<{ kicks: number; disposals: number }[]>`
      SELECT kicks::int AS kicks, disposals::int AS disposals FROM player_match_stats
       WHERE match_id = ${fx.matchId} AND player_id = ${fx.playerId}
    `;
    expect(updatedStat).toEqual({ kicks: newKicks, disposals: newKicks + fx.handballs });
    const [seasonAfter] = await sql<{ kicks: number }[]>`
      SELECT kicks::int AS kicks FROM player_season_stats
       WHERE player_id = ${fx.playerId} AND season = ${fx.season}
    `;
    const [careerAfter] = await sql<{ kicks: number }[]>`
      SELECT kicks::int AS kicks FROM player_career_stats WHERE player_id = ${fx.playerId}
    `;
    expect(seasonAfter.kicks).toBe(seasonBaseline.kicks + 1);
    expect(careerAfter.kicks).toBe(careerBaseline.kicks + 1);
    // ...and the durable authority is recorded under the fixture's identity key.
    const authority = await authorityOf257(fx);
    expect(authority.map((r) => [r.entityKey, r.fieldGroup, r.isActive])).toEqual([
      [`${fx.matchKey}|afltables:${fx.path}`, 'match_sheet', true],
    ]);
    expect(authority[0].overrideValues).toMatchObject({ kicks: newKicks, disposals: newKicks + fx.handballs });
  }, FX_TIMEOUT);
});

describe('Atomic required audit (AFLDB-ISSUE-027)', () => {
  // F-S10-01 / F-S10-02: synthetic fixtures; the schema state is determined before the save.
  it('persists the match-sheet mutation and its data_edits audit together', async () => {
    const storable = await playerMatchStatsAuthorityStorable(sql);
    const fx = await seedFixture257('pre257-audit');
    const before = await rowSnapshot257(fx);
    const note = 'issue-027 atomic audit test';

    const result = await saveMatchSheet({
      matchId: fx.matchId,
      syncMatchScores: false,
      players: [sheetInput257(fx, { kicks: fx.kicks + 1, disposals: fx.disposals + 1 })],
      adminUserId,
      note,
      staleToken: await tokenOf(fx.matchId),
    });

    if (!storable) {
      // State A: refused before any write, so neither the row nor an audit row exists.
      expect(result).toEqual({ ok: false, error: AUTHORITY_UNAVAILABLE_REFUSAL });
      expect(await rowSnapshot257(fx)).toEqual(before);
      expect(await authorityOf257(fx)).toHaveLength(0);
      expect(await auditCountOf257(fx)).toBe(0);
      return;
    }

    // State B: the mutation, its authority and its audit commit together.
    expect(result.ok).toBe(true);
    const [persisted] = await sql<{ kicks: number }[]>`
      SELECT kicks::int AS kicks FROM player_match_stats
       WHERE match_id = ${fx.matchId} AND player_id = ${fx.playerId}
    `;
    expect(persisted.kicks).toBe(fx.kicks + 1);
    expect((await authorityOf257(fx)).map((r) => [r.fieldGroup, r.isActive])).toEqual([['match_sheet', true]]);

    const [auditRow] = await sql<{ tableName: string; adminUserId: number }[]>`
      SELECT table_name AS "tableName", admin_user_id AS "adminUserId"
        FROM data_edits
       WHERE table_name = 'matches' AND row_id = ${fx.matchId}
         AND field_group = 'match_sheet' AND note = ${note}
    `;
    expect(auditRow).toBeDefined();
    expect(auditRow.adminUserId).toBe(adminUserId);

    // A second save back to the original statistic audits under the same note.
    const second = await saveMatchSheet({
      matchId: fx.matchId,
      syncMatchScores: false,
      players: [sheetInput257(fx)],
      adminUserId,
      note,
      staleToken: await tokenOf(fx.matchId),
    });
    expect(second.ok).toBe(true);
  }, FX_TIMEOUT);

  it('rolls the statistical mutation back when the required audit cannot be written', async () => {
    const fx = await seedFixture257('pre257-rollback');
    const impossibleAdminId = 2_147_483_647;
    const [collision] = await sql<{ id: number }[]>`
      SELECT id FROM auth_users WHERE id = ${impossibleAdminId}
    `;
    expect(collision).toBeUndefined();

    // The audit INSERT violates data_edits_admin_user_id_fkey inside the
    // mutation transaction, so the whole save must fail...
    const before = await rowSnapshot257(fx);
    const result = await saveMatchSheet({
      matchId: fx.matchId,
      syncMatchScores: false,
      players: [sheetInput257(fx, { kicks: fx.kicks + 5, disposals: fx.disposals + 5 })],
      adminUserId: impossibleAdminId,
      note: 'issue-027 must not persist',
      staleToken: await tokenOf(fx.matchId),
    });
    expect(result.ok).toBe(false);

    // ...leaving the statistical row untouched...
    const [after] = await sql<{ kicks: number | null }[]>`
      SELECT kicks::int AS kicks FROM player_match_stats
       WHERE match_id = ${fx.matchId} AND player_id = ${fx.playerId}
    `;
    expect(after.kicks).toBe(fx.kicks);
    expect(await rowSnapshot257(fx)).toEqual(before);

    // ...and no audit row behind.
    const orphans = await sql<{ id: number }[]>`
      SELECT id FROM data_edits WHERE note = 'issue-027 must not persist'
    `;
    expect(orphans).toHaveLength(0);
  }, FX_TIMEOUT);
});

describe.skipIf(!importRole.isConfigured)(
  `Restricted Data Editor role parity (AFLDB-ISSUE-083/-109)${roleParitySuffix}`,
  () => {
    beforeAll(() => importRole.validate());

    it('commits the production match-sheet and migration-066 audit path as afldb_import', async () => {
      // F-S10-01 / F-S10-02: a synthetic fixture and an explicit schema state. The save
      // CHANGES kicks (an unchanged save plans no item, writes no authority and so never
      // exercises the State A refusal or the authority upsert as afldb_import).
      const storable = await playerMatchStatsAuthorityStorable(sql);
      const fx = await seedFixture257('pre257-importrole');
      const before = await rowSnapshot257(fx);

      const note = 'issue-083 restricted import-role audit proof';
      const result = await importRole.withImportDsn(async () => saveMatchSheet({
        matchId: fx.matchId,
        syncMatchScores: false,
        players: [sheetInput257(fx, { kicks: fx.kicks + 1, disposals: fx.disposals + 1 })],
        adminUserId,
        note,
        staleToken: await tokenOf(fx.matchId),
      }));

      if (!storable) {
        // State A: refused, nothing written (no row change, no authority, no audit).
        expect(result).toEqual({ ok: false, error: AUTHORITY_UNAVAILABLE_REFUSAL });
        expect(await rowSnapshot257(fx)).toEqual(before);
        expect(await authorityOf257(fx)).toHaveLength(0);
        expect(await auditCountOf257(fx)).toBe(0);
        return;
      }

      // State B: the production save and the migration-066 audit commit as afldb_import.
      expect(result).toMatchObject({ ok: true });
      const [persisted] = await sql<{ kicks: number }[]>`
        SELECT kicks::int AS kicks FROM player_match_stats
         WHERE match_id = ${fx.matchId} AND player_id = ${fx.playerId}
      `;
      expect(persisted.kicks).toBe(fx.kicks + 1);
      expect((await authorityOf257(fx)).map((r) => [r.fieldGroup, r.isActive])).toEqual([['match_sheet', true]]);

      const [audit] = await sql<{ id: number }[]>`
        SELECT id FROM data_edits
         WHERE admin_user_id = ${adminUserId}
           AND table_name = 'matches'
           AND row_id = ${fx.matchId}
           AND field_group = 'match_sheet'
           AND note = ${note}
         ORDER BY id DESC
         LIMIT 1
      `;
      expect(audit).toBeDefined();
    }, FX_TIMEOUT);

    it('inserts and updates a durable override atomically as afldb_import', async () => {
      const [match] = await sql<{
        id: number;
        matchKey: string;
        notes: string | null;
      }[]>`
        SELECT m.id, m.match_key AS "matchKey", m.notes
          FROM matches m
         WHERE NOT EXISTS (
           SELECT 1 FROM data_overrides o
            WHERE o.entity_type = 'matches'
              AND o.entity_key = m.match_key
              AND o.field_group = 'notes'
         )
         ORDER BY m.id
         LIMIT 1
      `;
      expect(match, 'test database needs a match without a notes override').toBeDefined();

      let editedNotes = `ISSUE-109 restricted override proof for match ${match.id}`;
      if (editedNotes === match.notes) editedNotes += ' (changed)';

      try {
        const saved = await importRole.withImportDsn(() => saveEdit({
          entityKey: 'matches',
          rowId: match.id,
          groupKey: 'notes',
          raw: { notes: editedNotes },
          adminUserId,
          note: 'issue-109 restricted override proof',
        }));
        expect(saved).toMatchObject({ ok: true });

        const [afterInsert] = await sql<{ notes: string | null }[]>`
          SELECT notes FROM matches WHERE id = ${match.id}
        `;
        expect(afterInsert.notes).toBe(editedNotes);

        const [insertedOverride] = await sql<{
          overrideValues: Record<string, unknown>;
          adminUserId: number;
          isActive: boolean;
        }[]>`
          SELECT override_values AS "overrideValues",
                 admin_user_id AS "adminUserId",
                 is_active AS "isActive"
            FROM data_overrides
           WHERE entity_type = 'matches'
             AND entity_key = ${match.matchKey}
             AND field_group = 'notes'
        `;
        expect(insertedOverride).toEqual({
          overrideValues: { notes: editedNotes },
          adminUserId,
          isActive: true,
        });

        const [insertAudit] = await sql<{ id: number }[]>`
          SELECT id FROM data_edits
           WHERE table_name = 'matches'
             AND row_id = ${match.id}
             AND field_group = 'notes'
             AND admin_user_id = ${adminUserId}
             AND note = 'issue-109 restricted override proof'
        `;
        expect(insertAudit).toBeDefined();

        // Exercise ON CONFLICT DO UPDATE as the restricted role too, and
        // prove the canonical value can be restored through the real path.
        const restored = await importRole.withImportDsn(() => saveEdit({
          entityKey: 'matches',
          rowId: match.id,
          groupKey: 'notes',
          raw: { notes: match.notes ?? '' },
          adminUserId,
          note: 'issue-109 restricted override restore',
        }));
        expect(restored).toMatchObject({ ok: true });

        const [afterRestore] = await sql<{ notes: string | null }[]>`
          SELECT notes FROM matches WHERE id = ${match.id}
        `;
        expect(afterRestore.notes).toBe(match.notes);

        const [updatedOverride] = await sql<{
          overrideValues: Record<string, unknown>;
        }[]>`
          SELECT override_values AS "overrideValues"
            FROM data_overrides
           WHERE entity_type = 'matches'
             AND entity_key = ${match.matchKey}
             AND field_group = 'notes'
        `;
        expect(updatedOverride.overrideValues).toEqual({ notes: match.notes });
      } finally {
        // Restore the exact pre-test state even if an assertion fails. The
        // selected match had no pre-existing notes override.
        await sql.begin(async (tx) => {
          await tx`UPDATE matches SET notes = ${match.notes} WHERE id = ${match.id}`;
          await tx`
            DELETE FROM data_overrides
             WHERE entity_type = 'matches'
               AND entity_key = ${match.matchKey}
               AND field_group = 'notes'
          `;
          await tx`
            DELETE FROM data_edits
             WHERE admin_user_id = ${adminUserId}
               AND note IN (
                 'issue-109 restricted override proof',
                 'issue-109 restricted override restore'
               )
          `;
        });
      }
    });
  },
);

describe('AFLDB-ISSUE-224 §21.3.2: a name edit repairs the durable creation record', () => {
  const NOTE = 'issue-224 manual identity record sync';

  it('rewrites the manual_admin_edit identity payload and audits it separately', async () => {
    // A manually created player with a multipart surname split the WRONG way --
    // exactly the state the ISSUE-224 registration produced -- and with NO AFL
    // Tables identity, so getEntityNaturalKey() returns null and the editor writes
    // no override under the source key. The creation record is then the ONLY
    // durable record of this name, which is what makes the sync load-bearing.
    let playerId = 0;
    let token = '';
    try {
      await sql.begin(async (tx) => {
        const created = await createPlayerInTransaction(tx, {
          displayName: 'Testcase Van Fixture',
          givenName: 'Testcase Van',
          surname: 'Fixture',
        }, { adminUserId });
        playerId = created.id;
        const [identity] = await tx<{ externalId: string }[]>`
          SELECT e.external_id AS "externalId"
            FROM external_identities e JOIN sources s ON s.id = e.source_id
           WHERE e.player_id = ${playerId} AND s.key = 'manual_admin_edit'
        `;
        token = identity.externalId;
      });
      expect(token).not.toBe('');

      const saved = await saveEdit({
        entityKey: 'players',
        rowId: playerId,
        groupKey: 'name',
        raw: {
          display_name: 'Testcase Van Fixture',
          given_name: 'Testcase',
          surname: 'Van Fixture',
        },
        adminUserId,
        note: NOTE,
      });
      expect(saved).toMatchObject({ ok: true });

      const [row] = await sql<{
        givenName: string | null; surname: string | null; sortName: string | null;
      }[]>`
        SELECT given_name AS "givenName", surname, sort_name AS "sortName"
          FROM players WHERE id = ${playerId}
      `;
      expect(row).toEqual({
        givenName: 'Testcase', surname: 'Van Fixture', sortName: 'Van Fixture, Testcase',
      });

      // The whole point: the durable record no longer contradicts the row, so a
      // rebuild re-creates the corrected name rather than the split one.
      const [record] = await sql<{ overrideValues: Record<string, unknown> }[]>`
        SELECT override_values AS "overrideValues" FROM data_overrides
         WHERE entity_type = 'players'
           AND entity_key = ${`manual_admin_edit:${token}`}
           AND field_group = 'identity'
           AND is_active = true
      `;
      expect(record.overrideValues).toMatchObject({
        display_name: 'Testcase Van Fixture',
        given_name: 'Testcase',
        surname: 'Van Fixture',
      });

      const audit = await sql<{ fieldGroup: string }[]>`
        SELECT field_group AS "fieldGroup" FROM data_edits
         WHERE table_name = 'players' AND row_id = ${playerId} AND note = ${NOTE}
         ORDER BY field_group
      `;
      expect(audit.map((a) => a.fieldGroup)).toEqual(['manual_identity_record', 'name']);
    } finally {
      if (playerId > 0) {
        await sql.begin(async (tx) => {
          await tx`DELETE FROM data_edits WHERE table_name = 'players' AND row_id = ${playerId}`;
          await tx`
            DELETE FROM data_overrides
             WHERE entity_type = 'players' AND entity_key = ${`manual_admin_edit:${token}`}
          `;
          await tx`DELETE FROM external_identities WHERE player_id = ${playerId}`;
          await tx`DELETE FROM player_career_stats WHERE player_id = ${playerId}`;
          await tx`DELETE FROM players WHERE id = ${playerId}`;
        });
      }
    }
  });
});

describe('Targeted club_seasons rebuild (AFLDB-ISSUE-015)', () => {
  const importSql = postgres(process.env.AFLDB_TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });

  afterAll(async () => {
    await importSql.end({ timeout: 5 });
  });

  /** Marker so a deliberate rollback is distinguishable from a real failure. */
  class Rollback extends Error {}

  async function inRolledBackTransaction(
    body: (tx: postgres.TransactionSql) => Promise<void>,
  ): Promise<void> {
    try {
      await importSql.begin(async (tx) => {
        await body(tx);
        throw new Rollback('intentional rollback');
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  }

  const CANONICAL_FIELDS = `season, club_id, played, wins, draws, losses,
       points_for, points_against, premiership_points, percentage, ladder_rank,
       wooden_spoon, is_premier, finals_played, source_id`;

  async function pickCompleteSeason(): Promise<number> {
    // AFLDB-ISSUE-095: the ladder is derived from canonical matches, so the
    // precondition is home-and-away matches rather than staging ladder rows.
    const [row] = await importSql<{ season: number }[]>`
      SELECT cs.season
        FROM club_seasons cs
        JOIN seasons se ON se.year = cs.season
       WHERE se.status = 'complete'
         AND EXISTS (SELECT 1 FROM matches m
                      WHERE m.season = cs.season AND NOT m.is_final)
       GROUP BY cs.season
       ORDER BY cs.season DESC
       LIMIT 1
    `;
    expect(row).toBeDefined();
    return row.season;
  }

  it('reproduces the canonical full-rebuild rows for a completed season', async () => {
    const season = await pickCompleteSeason();
    await inRolledBackTransaction(async (tx) => {
      const before = await tx.unsafe(
        `SELECT ${CANONICAL_FIELDS} FROM club_seasons WHERE season = $1 ORDER BY club_id`,
        [season],
      );
      expect(before.length).toBeGreaterThan(0);

      await recomputeClubSeasons(tx, season);

      const after = await tx.unsafe(
        `SELECT ${CANONICAL_FIELDS} FROM club_seasons WHERE season = $1 ORDER BY club_id`,
        [season],
      );
      expect(after).toEqual(before);
    });
  });

  it('follows match facts for the premiership flag', async () => {
    const season = await pickCompleteSeason();
    await inRolledBackTransaction(async (tx) => {
      const [premier] = await tx<{ club_id: number }[]>`
        SELECT club_id FROM club_seasons WHERE season = ${season} AND is_premier
      `;
      expect(premier).toBeDefined();

      // Simulate a drawn Grand Final: the decisive winner drops out, so the
      // rebuild must clear the premiership flag for that season.
      await tx`
        UPDATE matches SET winner_club_id = NULL
         WHERE season = ${season} AND round_type = 'grand_final'
      `;
      await recomputeClubSeasons(tx, season);

      const premiersAfter = await tx<{ club_id: number }[]>`
        SELECT club_id FROM club_seasons WHERE season = ${season} AND is_premier
      `;
      expect(premiersAfter).toHaveLength(0);
    });
  });

  // AFLDB-ISSUE-095 re-pointed the fail-closed guard at the new source. The property
  // under test is unchanged and is the one that matters: the guard throws BEFORE the
  // DELETE, so a season it cannot derive keeps whatever it already had rather than
  // being silently emptied by the surrounding mutation.
  //
  // The trigger is a season with no canonical home-and-away matches. That used to be
  // found in afldb_test (the in-progress season after a canonical rebuild), but once
  // the current season carried H&A rows no such season existed and the test failed
  // on its own precondition (AFLDB-ISSUE-236). So the test builds the season itself,
  // inside the rolled-back transaction: a reserved year nothing else uses (2083 is
  // outside every committed fixture range, and is never committed here), holding
  // one Grand Final and no home-and-away match — so it also proves finals do not
  // satisfy the guard.
  it('refuses to build a ladder for a season it has no matches for', async () => {
    const season = 2083;
    await inRolledBackTransaction(async (tx) => {
      const [{ seasons: existingSeasons, matches: existingMatches }] = await tx<
        { seasons: number; matches: number }[]
      >`
        SELECT (SELECT count(*) FROM seasons WHERE year = ${season})::int   AS seasons,
               (SELECT count(*) FROM matches WHERE season = ${season})::int AS matches
      `;
      expect(existingSeasons, `seasons(${season}) is reserved for this fixture`).toBe(0);
      expect(existingMatches, `matches for ${season} are reserved for this fixture`).toBe(0);

      const [home, away] = await tx<{ id: number }[]>`
        SELECT id::int AS id FROM clubs ORDER BY id LIMIT 2
      `;
      await tx`
        INSERT INTO seasons (year, league, status)
        VALUES (${season}, 'AFL', 'complete'::season_status)
      `;
      await tx`
        INSERT INTO matches (
          match_key, season, round_code, round_number, round_type, is_final,
          match_date, venue_raw, home_club_id, away_club_id,
          home_score, away_score, result, winner_club_id, margin,
          attendance, attendance_status, source_id
        ) VALUES (
          ${`issue236-${season}-gf`}, ${season}, 'GF', NULL, 'grand_final'::round_type, true,
          ${`${season}-09-25`}, 'ISSUE-236 Fixture Oval', ${home.id}, ${away.id},
          90, 70, 'home_win'::match_result, ${home.id}, 20,
          NULL, 'not_collected'::coverage_status,
          (SELECT id FROM sources WHERE key = 'afltables')
        )
      `;
      // Stand a row up so "throws before anything is deleted" is a real assertion
      // rather than a vacuous one over an already-empty season.
      await tx`
        INSERT INTO club_seasons
              (season, club_id, played, wins, draws, losses,
               points_for, points_against)
        VALUES (${season}, ${home.id}, 0, 0, 0, 0, 0, 0)
      `;

      // The fixture is the shape the guard is about: canonical match rows exist,
      // none of them home-and-away.
      const [{ total, homeAndAway }] = await tx<{ total: number; homeAndAway: number }[]>`
        SELECT count(*)::int                             AS total,
               (count(*) FILTER (WHERE NOT is_final))::int AS "homeAndAway"
          FROM matches WHERE season = ${season}
      `;
      expect(total).toBe(1);
      expect(homeAndAway).toBe(0);

      await expect(recomputeClubSeasons(tx, season)).rejects.toThrow(
        `recomputeClubSeasons: no canonical home-and-away matches for season ${season}; `
          + 'refusing to rebuild club_seasons from nothing',
      );

      const storedAfter = await tx<{ clubId: number; played: number }[]>`
        SELECT club_id::int AS "clubId", played FROM club_seasons WHERE season = ${season}
      `;
      expect(storedAfter).toEqual([{ clubId: home.id, played: 0 }]);
    });

    // Nothing the fixture built outlives the transaction.
    const [leftover] = await importSql<{ seasons: number; matches: number; clubSeasons: number }[]>`
      SELECT (SELECT count(*) FROM seasons WHERE year = ${season})::int        AS seasons,
             (SELECT count(*) FROM matches WHERE season = ${season})::int      AS matches,
             (SELECT count(*) FROM club_seasons WHERE season = ${season})::int AS "clubSeasons"
    `;
    expect(leftover).toEqual({ seasons: 0, matches: 0, clubSeasons: 0 });
  });

  it('derives the ladder from match facts, following a score correction', async () => {
    // The ISSUE-015 shape is gone with its source: a published tally could not move
    // when a score was corrected, but a derived one must. Flipping a decided
    // home-and-away result has to move both sides' win/loss and points columns.
    const season = await pickCompleteSeason();
    await inRolledBackTransaction(async (tx) => {
      const [match] = await tx<{ id: number; home: number; away: number }[]>`
        SELECT id, home_club_id AS home, away_club_id AS away
          FROM matches
         WHERE season = ${season} AND NOT is_final AND result = 'home_win'
         ORDER BY id LIMIT 1
      `;
      expect(match).toBeDefined();

      const winsOf = async (club: number) => {
        const [r] = await tx<{ wins: number; pts: number }[]>`
          SELECT wins, premiership_points AS pts FROM club_seasons
           WHERE season = ${season} AND club_id = ${club}
        `;
        return r;
      };
      const homeBefore = await winsOf(match.home);
      const awayBefore = await winsOf(match.away);

      // Reverse the result. Swap the whole scoreline — goals and behinds as well
      // as the totals — so both the margin CHECK and matches_score_components_ck
      // (each total must equal 6*goals + behinds) stay satisfied. Swapping only
      // the totals leaves them disagreeing with their components (AFLDB-ISSUE-108).
      await tx`
        UPDATE matches
           SET home_score = away_score,     away_score = home_score,
               home_goals = away_goals,     away_goals = home_goals,
               home_behinds = away_behinds, away_behinds = home_behinds,
               result = 'away_win', winner_club_id = ${match.away}
         WHERE id = ${match.id}
      `;
      await recomputeClubSeasons(tx, season);

      const homeAfter = await winsOf(match.home);
      const awayAfter = await winsOf(match.away);
      expect(homeAfter.wins).toBe(homeBefore.wins - 1);
      expect(awayAfter.wins).toBe(awayBefore.wins + 1);
      // The declared 4/2/0 rule moves with it.
      expect(homeAfter.pts).toBe(homeBefore.pts - 4);
      expect(awayAfter.pts).toBe(awayBefore.pts + 4);
    });
  });
});

/**
 * AFLDB-ISSUE-132 T6, restated by AFLDB-ISSUE-155 §27.15.
 *
 * The match sheet used to be the only writer of a per-match Brownlow vote, and
 * T6/T6b pinned the two conditions under which it refused one: `is_final`, and
 * an allocation that was not exactly 3-2-1. Phase C1 makes the match-level vote
 * a canonical fact owned by Brownlow administration, so the match sheet refuses
 * a Brownlow value **unconditionally** -- for a final, for a home-and-away
 * match, complete or partial, and for an explicit zero -- with the one redirect
 * message. The refusal is the payload validator's and therefore still precedes
 * every write, which is what these two cases continue to prove.
 *
 * The Wildcard Final case is retained deliberately: the season it fixtures
 * (2088; 2087 belongs to database.test.ts) is the ISSUE-129 regression, and it
 * would be a silent loss of coverage to drop it just because the reason for the
 * refusal changed. T6b now uses the fixture's home-and-away match instead of a
 * partial allocation, because "any match" is the new contract.
 */
describe('AFLDB-ISSUE-155 §27.15: the match sheet is not a Brownlow writer', () => {
  let fixture: WildcardFixture;
  let thirdPlayerId = 0;
  let homeAndAwayMatchId = 0;
  let homeAndAwayPlayerId = 0;
  let homeAndAwayClubId = 0;

  beforeAll(async () => {
    fixture = await seedWildcardFinalSeason(2088);
    const [third] = await sql<{ id: number }[]>`
      SELECT id FROM players
       WHERE id NOT IN (${fixture.wildcardOnlyPlayerId}, ${fixture.finalsSeriesPlayerId})
       ORDER BY id
       LIMIT 1
    `;
    if (!third) throw new Error('T6 needs a third existing player row in the test database.');
    thirdPlayerId = third.id;

    // A home-and-away match of the same fixture season. It deliberately has no
    // line-up: the refusal is the payload validator's, so it fires before any
    // read, and "no row was created at all" is a stronger proof of that than a
    // row left unchanged. The player is a seeded one so a regression that did
    // write would be removed by the fixture's own cleanup.
    const [ha] = await sql<{ matchId: number; clubId: number }[]>`
      SELECT id AS "matchId", home_club_id AS "clubId"
        FROM matches
       WHERE season = ${fixture.season}
         AND round_type = 'home_and_away'
       ORDER BY id
       LIMIT 1
    `;
    if (!ha) throw new Error('T6b needs a home-and-away match in the 2088 fixture.');
    homeAndAwayMatchId = ha.matchId;
    homeAndAwayClubId = ha.clubId;
    homeAndAwayPlayerId = fixture.wildcardOnlyPlayerId;
  });

  afterAll(async () => {
    await fixture?.cleanup();
  });

  const readRow = async () => {
    const [row] = await sql<{ brownlowVotes: number | null; kicks: number | null }[]>`
      SELECT brownlow_votes AS "brownlowVotes", kicks
        FROM player_match_stats
       WHERE match_id = ${fixture.wildcardMatchId}
         AND player_id = ${fixture.wildcardOnlyPlayerId}
    `;
    return row;
  };

  const expectNothingWritten = async (before: { brownlowVotes: number | null; kicks: number | null }) => {
    // The refusal precedes every write: the votes stay NULL, the kick edit in
    // the same sheet is rolled back with it, and no audit row was committed.
    const after = await readRow();
    expect(after.brownlowVotes).toBeNull();
    expect(after.kicks).toBe(before.kicks);

    const [audit] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
        FROM data_edits
       WHERE table_name = 'matches' AND row_id = ${fixture.wildcardMatchId}
    `;
    expect(audit.count).toBe(0);
  };

  const readAnyRow = async (matchId: number, playerId: number) => {
    const [row] = await sql<{ brownlowVotes: number | null; kicks: number | null }[]>`
      SELECT brownlow_votes AS "brownlowVotes", kicks
        FROM player_match_stats
       WHERE match_id = ${matchId} AND player_id = ${playerId}
    `;
    return row;
  };

  it('T6: a complete Brownlow allocation is refused on a Wildcard Final and nothing is written', async () => {
    const before = await readRow();
    expect(before).toBeDefined();
    expect(before.brownlowVotes).toBeNull();

    const result = await saveMatchSheet({
      matchId: fixture.wildcardMatchId,
      syncMatchScores: false,
      players: [
        {
          playerId: fixture.wildcardOnlyPlayerId,
          clubId: fixture.wildcardWinnerClubId,
          kicks: (before.kicks ?? 0) + 1,
          brownlowVotes: 3,
        },
        {
          playerId: fixture.finalsSeriesPlayerId,
          clubId: fixture.wildcardWinnerClubId,
          brownlowVotes: 2,
        },
        {
          playerId: thirdPlayerId,
          clubId: fixture.wildcardLoserClubId,
          brownlowVotes: 1,
        },
      ],
      adminUserId,
      note: 'issue-132 wildcard brownlow refusal',
      staleToken: await tokenOf(fixture.wildcardMatchId),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toBe(BROWNLOW_MATCH_SHEET_REFUSAL);
    expect(result.error).toContain('/admin/brownlow');

    await expectNothingWritten(before);
  });

  it('T6b: a single Brownlow value is refused on a home-and-away match too, before any write', async () => {
    expect(await readAnyRow(homeAndAwayMatchId, homeAndAwayPlayerId)).toBeUndefined();

    const result = await saveMatchSheet({
      matchId: homeAndAwayMatchId,
      syncMatchScores: false,
      players: [{
        playerId: homeAndAwayPlayerId,
        clubId: homeAndAwayClubId,
        kicks: 11,
        brownlowVotes: 3,
      }],
      adminUserId,
      note: 'issue-132 wildcard brownlow refusal',
      staleToken: await tokenOf(homeAndAwayMatchId),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toBe(BROWNLOW_MATCH_SHEET_REFUSAL);

    // The whole sheet was rejected: the line-up row it would have created does
    // not exist, and no audit row was committed.
    expect(await readAnyRow(homeAndAwayMatchId, homeAndAwayPlayerId)).toBeUndefined();
    const [audit] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
        FROM data_edits
       WHERE table_name = 'matches' AND row_id = ${homeAndAwayMatchId}
    `;
    expect(audit.count).toBe(0);
  });

  it('T6c: an explicit zero is refused as firmly as a vote', async () => {
    // A published zero ("played, polled nothing") is a canonical Brownlow fact
    // in its own right (§27.5 P1), not an absence, so the match sheet must not
    // be able to assert one either. `null` and absent remain the only ways to
    // say "this sheet has nothing to say about the Brownlow".
    const before = await readRow();

    const result = await saveMatchSheet({
      matchId: fixture.wildcardMatchId,
      syncMatchScores: false,
      players: [{
        playerId: fixture.wildcardOnlyPlayerId,
        clubId: fixture.wildcardWinnerClubId,
        brownlowVotes: 0,
      }],
      adminUserId,
      note: 'issue-132 wildcard brownlow refusal',
      staleToken: await tokenOf(fixture.wildcardMatchId),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toBe(BROWNLOW_MATCH_SHEET_REFUSAL);

    await expectNothingWritten(before);
  });
});

describe('Durable Match Sheet authority (AFLDB-ISSUE-257 Slice 3)', () => {
  type Candidate = Fx257;
  const NOTE = 'issue-257 slice 3 test';

  // F-S10-02: synthetic fixtures (cleanup is afterEach/afterAll, which runs on failure too).
  // A player with one accepted AFL Tables path (`identity` true) or with no durable identity.
  const pick = (name: string, identity: boolean): Promise<Candidate> => seedFixture257(name, { identity });

  const asInput = (c: Candidate, over: { goals?: number | null } = {}) => sheetInput257(c, {
    goals: over.goals !== undefined ? over.goals : c.goals,
  });

  const readGoals = async (c: Candidate) => {
    const [row] = await sql<{ goals: number | null }[]>`
      SELECT goals::int AS goals FROM player_match_stats
       WHERE match_id = ${c.matchId} AND player_id = ${c.playerId}
    `;
    return row.goals;
  };

  const authorityRows = (c: Candidate) => sql<{ entityKey: string; fieldGroup: string; isActive: boolean }[]>`
    SELECT entity_key AS "entityKey", field_group AS "fieldGroup", is_active AS "isActive"
      FROM data_overrides
     WHERE entity_type = 'player_match_stats'
       AND starts_with(entity_key, ${c.matchKey}::text || '|')
     ORDER BY entity_key, field_group
  `;

  it('refuses a stale sheet whole, before any write (a settle must never become authority)', async () => {
    const c = await pick('s3-stale', true);
    const staleToken = await tokenOf(c.matchId);
    // A settle-like change after the editor loaded.
    await sql`
      UPDATE player_match_stats SET goals = COALESCE(goals, 0) + 1
       WHERE match_id = ${c.matchId} AND player_id = ${c.playerId}
    `;
    const changed = await readGoals(c);
    const result = await saveMatchSheet({
      matchId: c.matchId, syncMatchScores: false,
      players: [asInput(c, { goals: c.goals + 7 })],
      adminUserId, note: NOTE, staleToken,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toContain('Reload the sheet');
    expect(await readGoals(c)).toBe(changed);
    expect(await authorityRows(c)).toHaveLength(0);
  }, FX_TIMEOUT);

  it('refuses a save whose token is missing', async () => {
    const c = await pick('s3-token', true);
    const result = await saveMatchSheet({
      matchId: c.matchId, syncMatchScores: false, players: [asInput(c)],
      adminUserId, note: NOTE, staleToken: '',
    });
    expect(result.ok).toBe(false);
  }, FX_TIMEOUT);

  it('rolls the row change back when the player has no durable identity', async () => {
    const c = await pick('s3-noident', false);
    const result = await saveMatchSheet({
      matchId: c.matchId, syncMatchScores: false,
      players: [asInput(c, { goals: c.goals + 3 })],
      adminUserId, note: NOTE, staleToken: await tokenOf(c.matchId),
    });
    expect(result.ok).toBe(false);
    expect(await readGoals(c)).toBe(c.goals);
    expect(await authorityRows(c)).toHaveLength(0);
  }, FX_TIMEOUT);

  it('commits the row change and its authority together, reusing an existing identity key', async () => {
    // State A (migration 110 not applied): the CHECK admits no record to reuse, and the
    // writer's refusal is proved by the F-S10-01 cases above.
    if (!(await playerMatchStatsAuthorityStorable(sql))) return;
    const c = await pick('s3-reuse', true);
    const key = `${c.matchKey}|afltables:${c.path}`;
    await sql`
      INSERT INTO data_overrides (entity_type, entity_key, field_group, override_values, admin_user_id, is_active)
      VALUES ('player_match_stats', ${key}, 'lineup', '{"present": true}'::jsonb, ${adminUserId}, true)
    `;
    expect(await authorityRows(c)).toHaveLength(1);
    const result = await saveMatchSheet({
      matchId: c.matchId, syncMatchScores: false,
      players: [asInput(c, { goals: c.goals + 2 })],
      adminUserId, note: NOTE, staleToken: await tokenOf(c.matchId),
    });
    expect(result).toMatchObject({ ok: true });
    expect(await readGoals(c)).toBe(c.goals + 2);
    const rows = await authorityRows(c);
    expect(new Set(rows.map((r) => r.entityKey))).toEqual(new Set([key]));
    expect(rows.map((r) => r.fieldGroup).sort()).toEqual(['lineup', 'match_sheet']);
  }, FX_TIMEOUT);
});

describe('Durable Match Sheet authority: delete guard and Return to source (AFLDB-ISSUE-257 Slice 7)', () => {
  type Pick = Fx257;
  const NOTE = 'issue-257 slice 7 test';

  // F-S10-02: a synthetic source-owned row of a player holding exactly one accepted AFL Tables
  // path. Cleanup is afterEach/afterAll (runs on failure too); no real row is ever touched.
  const seedPlayer = (name: string): Promise<Pick> => seedFixture257(name);

  const seed = async (p: Pick, group: string, payload: unknown) => {
    await sql`
      INSERT INTO data_overrides (entity_type, entity_key, field_group, override_values, admin_user_id, is_active)
      VALUES ('player_match_stats', ${`${p.matchKey}|afltables:${p.path}`}, ${group},
              ${sql.json(payload as never)}, ${adminUserId}, true)
    `;
  };

  const records = (p: Pick) => sql<{ fieldGroup: string; isActive: boolean }[]>`
    SELECT field_group AS "fieldGroup", is_active AS "isActive" FROM data_overrides
     WHERE entity_type = 'player_match_stats' AND starts_with(entity_key, ${p.matchKey}::text || '|')
     ORDER BY field_group
  `;

  const rowOf = async (p: Pick) => {
    const [row] = await sql<{ id: number; sourceKey: string | null }[]>`
      SELECT s.id::int AS id, src.key AS "sourceKey"
        FROM player_match_stats s LEFT JOIN sources src ON src.id = s.source_id
       WHERE s.match_id = ${p.matchId} AND s.player_id = ${p.playerId}
    `;
    return row;
  };

  const storable = () => playerMatchStatsAuthorityStorable(sql);

  const returnIt = (p: Pick) => returnMatchSheetToSource({
    matchId: p.matchId, playerId: p.playerId, adminUserId, note: NOTE,
  });

  it('deleteMatch refuses while active Match Sheet authority exists, and deletes nothing', async () => {
    if (!(await storable())) return; // State A: no authority can exist; nothing to prove
    const p = await seedPlayer('s7-delete');
    await seed(p, 'match_sheet', { goals: 1 });
    const result = await deleteMatch({ matchId: p.matchId, adminUserId });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toContain('durable Match Sheet authority for 1 player row');
    expect(result.error).toContain('Return to source');
    expect(await rowOf(p)).toBeDefined();
    expect((await records(p)).every((r) => r.isActive)).toBe(true);
  }, FX_TIMEOUT);

  it('returns ordinary field authority to source: record withdrawn, row untouched', async () => {
    const p = await seedPlayer('s7-ordinary');
    if (!(await storable())) {
      const refused = await returnIt(p);
      expect(refused.ok).toBe(false);
      return;
    }
    await seed(p, 'match_sheet', { goals: 1 });
    const before = await rowOf(p);
    const result = await returnIt(p);
    expect(result).toMatchObject({ ok: true, rowDeleted: false, rowKept: false });
    expect(await records(p)).toEqual([{ fieldGroup: 'match_sheet', isActive: false }]);
    expect(await rowOf(p)).toEqual(before);
  }, FX_TIMEOUT);

  it('a manual addition still unowned is withdrawn and its row deleted', async () => {
    if (!(await storable())) return;
    const p = await seedPlayer('s7-unowned');
    await seed(p, 'lineup', { present: true });
    await seed(p, 'match_sheet', { goals: 1 });
    await sql`UPDATE player_match_stats SET source_id = NULL WHERE match_id = ${p.matchId} AND player_id = ${p.playerId}`;
    const result = await returnIt(p);
    expect(result).toMatchObject({ ok: true, rowDeleted: true, rowKept: false });
    expect(await rowOf(p)).toBeUndefined();
    expect((await records(p)).every((r) => !r.isActive)).toBe(true);
  }, FX_TIMEOUT);

  it('a manual addition a settling source has since owned is withdrawn and the row kept', async () => {
    if (!(await storable())) return;
    const p = await seedPlayer('s7-owned');
    await seed(p, 'lineup', { present: true });
    await sql`
      UPDATE player_match_stats SET source_id = (SELECT id FROM sources WHERE key = 'afltables')
       WHERE match_id = ${p.matchId} AND player_id = ${p.playerId}
    `;
    const result = await returnIt(p);
    expect(result).toMatchObject({ ok: true, rowDeleted: false, rowKept: true });
    expect((await rowOf(p))?.sourceKey).toBe('afltables');
    expect((await records(p)).every((r) => !r.isActive)).toBe(true);
  }, FX_TIMEOUT);

  // F-S7-01 (accepted 2026-10-03): the fitzRoy core reload's owner key is an
  // accepted owning source; any other provenance still refuses.
  const sourceIdOf = async (key: string) => {
    const [row] = await sql<{ id: number }[]>`SELECT id::int AS id FROM sources WHERE key = ${key}`;
    return row?.id ?? null;
  };

  it('F-S7-01: a manual addition now owned by fitzroy_afldata is withdrawn and the row kept', async () => {
    const fitzroy = await sourceIdOf('fitzroy_afldata');
    if (fitzroy === null || !(await storable())) return;
    const p = await seedPlayer('s7-fitzroy');
    await seed(p, 'lineup', { present: true });
    await sql`UPDATE player_match_stats SET source_id = ${fitzroy} WHERE match_id = ${p.matchId} AND player_id = ${p.playerId}`;
    const result = await returnIt(p);
    expect(result).toMatchObject({ ok: true, rowDeleted: false, rowKept: true });
    expect((await rowOf(p))?.sourceKey).toBe('fitzroy_afldata');
    expect((await records(p)).every((r) => !r.isActive)).toBe(true);
  }, FX_TIMEOUT);

  it('F-S7-01: a manual addition owned by an unsupported source refuses, writing nothing', async () => {
    const foreign = await sourceIdOf('manual_admin_edit');
    if (foreign === null || !(await storable())) return;
    const p = await seedPlayer('s7-foreign');
    await seed(p, 'lineup', { present: true });
    await sql`UPDATE player_match_stats SET source_id = ${foreign} WHERE match_id = ${p.matchId} AND player_id = ${p.playerId}`;
    const result = await returnIt(p);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toContain('unexpected source (manual_admin_edit)');
    expect((await rowOf(p))?.sourceKey).toBe('manual_admin_edit');
    expect((await records(p)).every((r) => r.isActive)).toBe(true);
  }, FX_TIMEOUT);

  it('a manual removal is withdrawn with no canonical write; the next settle restores the row', async () => {
    if (!(await storable())) return;
    const p = await seedPlayer('s7-removal');
    await seed(p, 'lineup', { present: false });
    await sql`DELETE FROM player_match_stats WHERE match_id = ${p.matchId} AND player_id = ${p.playerId}`;
    const result = await returnIt(p);
    expect(result).toMatchObject({ ok: true, rowDeleted: false, rowKept: false });
    expect(await rowOf(p)).toBeUndefined();
    expect(await records(p)).toEqual([{ fieldGroup: 'lineup', isActive: false }]);
  }, FX_TIMEOUT);
});

// ISSUE-257 F-S9-03. State A (migration 110 not applied) cannot hold player_match_stats
// authority, so every case below returns early there, exactly as the Slice 3/7 suites do.
// The replay cases spawn the REAL tools/migration/common.py (a TypeScript re-implementation
// would only prove two pieces of test code agree) and need psycopg; without it they are
// not registered, the convention admin-awards.test.ts follows.
describe('Durable Match Sheet authority: rollback, replay and continuity (AFLDB-ISSUE-257 F-S9-03)', () => {
  type Pick = Fx257;
  const NOTE = 'issue-257 f-s9-03 test';
  const ENTITY = 'player_match_stats';
  const ABSENT_MATCH_KEY = '9999|issue257-f-s9-03-absent';
  const UNKNOWN_PATH = 'players/Z/Issue257FS903Nobody0.html';
  const TIMEOUT = 120_000;

  const root = process.cwd();
  const venvPython = process.platform === 'win32'
    ? join(root, '.venv', 'Scripts', 'python.exe')
    : join(root, '.venv', 'bin', 'python');
  const python = process.env.AFLDB_PYTHON
    ?? (existsSync(venvPython) ? venvPython : (process.platform === 'win32' ? 'python' : 'python3'));
  const probe = spawnSync(python, ['-c', 'import psycopg'], { encoding: 'utf8' });
  const canReplay = !probe.error && probe.status === 0;

  const runPython = (body: string[]) => spawnSync(python, ['-c', [
    'import sys, os',
    `sys.path.insert(0, ${JSON.stringify(join(root, 'tools', 'migration'))})`,
    'import psycopg',
    'conn = psycopg.connect(os.environ["AFLDB_REPLAY_DSN"])',
    ...body,
  ].join('\n')], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, AFLDB_REPLAY_DSN: process.env.AFLDB_TEST_DATABASE_URL },
  });

  /** The REAL replay_admin_overrides(conn, 'player_match_stats'), committed on success. */
  const runReplay = () => runPython([
    'from common import replay_admin_overrides',
    'try:',
    '    replay_admin_overrides(conn, "player_match_stats")',
    '    conn.commit()',
    'finally:',
    '    conn.close()',
    'print("REPLAY OK")',
  ]);

  /** The REAL read-only preflight the fitzRoy reload runs before it writes anything. */
  const runPreflight = () => runPython([
    'from common import preflight_player_match_stats_authority',
    'try:',
    '    preflight_player_match_stats_authority(conn)',
    '    print("PREFLIGHT OK")',
    'except RuntimeError as exc:',
    '    print("PREFLIGHT REFUSED " + str(exc))',
    'finally:',
    '    conn.rollback()',
    '    conn.close()',
  ]);

  const expectOk = (r: ReturnType<typeof runReplay>) => {
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stdout).toContain('REPLAY OK');
  };

  const storable = () => playerMatchStatsAuthorityStorable(sql);

  let baseline = 0;
  const countAuthority = async () => {
    const [r] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM data_overrides WHERE entity_type = ${ENTITY}
    `;
    return r.n;
  };
  // The replay applies the WHOLE active set, so foreign records would be applied too.
  const requireCleanAuthority = () => expect(
    baseline,
    'afldb_test must hold no player_match_stats authority before this suite (the replay would apply it)',
  ).toBe(0);

  beforeAll(async () => {
    baseline = await countAuthority();
  });

  afterAll(async () => {
    // The absent-match control key lives in the `9999|issue257-` namespace, which the
    // file-level cleanup257 (afterEach) removes with every other fixture record.
    // Zero residue: the count between suites is what it was before this one.
    expect(await countAuthority()).toBe(baseline);
  });

  const continuityRules = () => {
    const contract = JSON.parse(readFileSync(
      join(root, 'tools', 'rebuild', 'fitzroy', 'fitzroy-contract.json'), 'utf8',
    )) as { profile_url_continuity?: { rules?: { continuing_url: string; renumbered_url: string }[] } };
    const rules = contract.profile_url_continuity?.rules ?? [];
    return { continuing: rules.map((r) => r.continuing_url), renumbered: rules.map((r) => r.renumbered_url) };
  };

  // F-S10-02: a SYNTHETIC source-owned row of a player holding exactly one accepted path (one
  // no tracked continuity rule names and no other player holds, so the replay resolves it
  // alone). Committed before the Python call; removed by the file-level cleanup257.
  const seedSingle = (name: string): Promise<Pick> => seedFixture257(name);

  // D-257-9: a synthetic player holding BOTH accepted paths of exactly one tracked rule and
  // nothing else. The rule's real paths are the only identities the replay's tracked contract
  // recognises, so a fixture can use them only while NO external_identities row (any source,
  // any status) holds either path; otherwise the case has no collision-free synthetic form and
  // is skipped. Read-only probe of the real table; no real row is ever written.
  const seedFolded = async (): Promise<Pick | undefined> => {
    const { continuing, renumbered } = continuityRules();
    if (continuing.length === 0) return undefined;
    const held = new Set((await sql<{ externalId: string }[]>`
      SELECT external_id AS "externalId" FROM external_identities
       WHERE external_id = ANY(${[...continuing, ...renumbered]}::text[])
    `).map((r) => r.externalId));
    for (let i = 0; i < continuing.length; i += 1) {
      const [c, n] = [continuing[i], renumbered[i]];
      // Exactly one tracked rule names either path.
      const onlyThisRule = continuing.every((cj, j) => j === i
        || (cj !== c && cj !== n && renumbered[j] !== c && renumbered[j] !== n));
      if (held.has(c) || held.has(n) || !onlyThisRule) continue;
      return seedFixture257('s9-folded', { folded: { continuing: c, renumbered: n } });
    }
    return undefined;
  };

  const keyOf = (p: Pick, path: string | null = p.path) => `${p.matchKey}|afltables:${path}`;

  const seed = (entityKey: string, group: string, payload: unknown) => sql`
    INSERT INTO data_overrides (entity_type, entity_key, field_group, override_values, admin_user_id, is_active)
    VALUES (${ENTITY}, ${entityKey}, ${group}, ${sql.json(payload as never)}, ${adminUserId}, true)
  `;

  const records = (p: Pick) => sql<{ entityKey: string; fieldGroup: string; isActive: boolean }[]>`
    SELECT entity_key AS "entityKey", field_group AS "fieldGroup", is_active AS "isActive"
      FROM data_overrides
     WHERE entity_type = ${ENTITY} AND starts_with(entity_key, ${p.matchKey}::text || '|')
     ORDER BY entity_key, field_group
  `;

  const statsOf = async (p: Pick) => {
    const [row] = await sql<{
      goals: number | null; marks: number | null; kicks: number | null; handballs: number | null;
      disposals: number | null; sourceId: number | null; clubId: number; jumperNumber: string | null;
    }[]>`
      SELECT goals::int AS goals, marks::int AS marks, kicks::int AS kicks, handballs::int AS handballs,
             disposals::int AS disposals, source_id::int AS "sourceId", club_id::int AS "clubId",
             jumper_number AS "jumperNumber"
        FROM player_match_stats WHERE match_id = ${p.matchId} AND player_id = ${p.playerId}
    `;
    return row;
  };

  const snapshot = async (p: Pick) => {
    const [row] = await sql<{ row: unknown }[]>`
      SELECT to_jsonb(s) AS row FROM player_match_stats s
       WHERE s.match_id = ${p.matchId} AND s.player_id = ${p.playerId}
    `;
    return row?.row ?? null;
  };

  // Every row of the match: proves a refusal wrote nothing anywhere in it.
  const matchDigest = async (matchId: number) => {
    const [r] = await sql<{ d: string }[]>`
      SELECT md5(coalesce(string_agg(to_jsonb(s)::text, '|' ORDER BY s.player_id), '')) AS d
        FROM player_match_stats s WHERE s.match_id = ${matchId}
    `;
    return r.d;
  };

  const auditCount = async () => {
    const [r] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM data_edits WHERE admin_user_id = ${adminUserId} AND note = ${NOTE}
    `;
    return r.n;
  };

  // No restore: every row below is a synthetic fixture the file-level cleanup257 removes
  // (derived rows and audit rows included) after the case, whether it passed or failed.

  const inputOf = (p: Pick, goals: number | null) => ({
    playerId: p.playerId, clubId: p.clubId,
    jumperNumber: p.row.jumper_number as string | null, goals,
    behinds: p.row.behinds as number | null, kicks: p.row.kicks as number | null,
    handballs: p.row.handballs as number | null, disposals: p.row.disposals as number | null,
    marks: p.row.marks as number | null, tackles: p.row.tackles as number | null,
    hitouts: p.row.hitouts as number | null, freesFor: p.row.frees_for as number | null,
    freesAgainst: p.row.frees_against as number | null,
  });

  it('(1) rolls the row change AND the authority back when the authority write fails (post-110)', async () => {
    // State A: no authority is written, so there is no authority-write failure to roll back; the
    // audit-failure rollback is proved by the Slice 027 case above.
    if (!(await storable())) return;
    const p = await seedSingle('s9-rollback');
    // Realistic induction, no trigger and no production hook: a real save by an admin id that is
    // not in auth_users. The canonical row write (step 5) succeeds inside the transaction, then
    // the data_overrides upsert (step 6) violates data_overrides_admin_user_id_fkey.
    const impossibleAdminId = 2_147_483_647;
    expect(await sql`SELECT 1 FROM auth_users WHERE id = ${impossibleAdminId}`).toHaveLength(0);
    const before = await snapshot(p);
    const beforeCount = await countAuthority();
    const goals = (p.goals ?? 0) + 3;
    const failed = await saveMatchSheet({
      matchId: p.matchId, syncMatchScores: false, players: [inputOf(p, goals)],
      adminUserId: impossibleAdminId, note: NOTE, staleToken: await tokenOf(p.matchId),
    });
    expect(failed.ok).toBe(false);
    if (failed.ok) throw new Error('unreachable');
    expect(failed.error).toContain('Failed to save match sheet');
    expect(failed.error).toContain('data_overrides_admin_user_id_fkey');
    expect(await snapshot(p)).toEqual(before);
    expect(await records(p)).toHaveLength(0);
    expect(await countAuthority()).toBe(beforeCount);
    expect(await auditCount()).toBe(0);

    // Control: the same save by a real admin commits, so the rollback above was not vacuous.
    const saved = await saveMatchSheet({
      matchId: p.matchId, syncMatchScores: false, players: [inputOf(p, goals)],
      adminUserId, note: NOTE, staleToken: await tokenOf(p.matchId),
    });
    expect(saved).toMatchObject({ ok: true });
    expect((await statsOf(p)).goals).toBe(goals);
    const written = await records(p);
    expect(written.map((r) => r.fieldGroup)).toContain('match_sheet');
    expect(written.every((r) => r.isActive)).toBe(true);
  }, TIMEOUT);

  it.runIf(canReplay)('(2a) replay re-applies a field correction over a reset source value', async () => {
    if (!(await storable())) return; // State A: the CHECK refuses the record
    requireCleanAuthority();
    const p = await seedSingle('s9-2a');
    const corrected = (p.goals ?? 0) + 4;
    const sourceValue = (p.goals ?? 0) + 1;
    // Key presence is authority: goals is corrected, marks is explicitly cleared, kicks is absent.
    await seed(keyOf(p), 'match_sheet', { goals: corrected, marks: null });
    // What a destructive reload leaves: source values, no correction.
    await sql`UPDATE player_match_stats SET goals = ${sourceValue}, marks = 5
               WHERE match_id = ${p.matchId} AND player_id = ${p.playerId}`;
    const reloaded = await statsOf(p);
    expect(reloaded.goals).toBe(sourceValue);
    expectOk(runReplay());
    expect(await statsOf(p)).toMatchObject({
      goals: corrected, marks: null, kicks: reloaded.kicks,
      sourceId: reloaded.sourceId, clubId: reloaded.clubId,
    });
    expect((await records(p)).map((r) => [r.fieldGroup, r.isActive])).toEqual([['match_sheet', true]]);
  }, TIMEOUT);

  it.runIf(canReplay)('(2b) replay recreates a durable addition the reload did not supply', async () => {
    if (!(await storable())) return;
    requireCleanAuthority();
    const p = await seedSingle('s9-2b');
    await seed(keyOf(p), 'lineup', { present: true });
    await seed(keyOf(p), 'match_sheet', {
      club_slug: p.clubSlug, jumper_number: '99', goals: 7, kicks: 10, handballs: 5, disposals: 15,
    });
    await sql`DELETE FROM player_match_stats WHERE match_id = ${p.matchId} AND player_id = ${p.playerId}`;
    expect(await statsOf(p)).toBeUndefined();
    expectOk(runReplay());
    // Created unowned (source_id NULL), with only the recorded columns.
    expect(await statsOf(p)).toMatchObject({
      clubId: p.clubId, jumperNumber: '99', goals: 7, kicks: 10, handballs: 5, disposals: 15,
      marks: null, sourceId: null,
    });
    expect((await records(p)).every((r) => r.isActive)).toBe(true);
  }, TIMEOUT);

  it.runIf(canReplay)('(2c) replay deletes a reinserted row under a durable removal', async () => {
    if (!(await storable())) return;
    requireCleanAuthority();
    const p = await seedSingle('s9-2c');
    await seed(keyOf(p), 'lineup', { present: false });
    // The row exists: the source reload put it back.
    expect(await statsOf(p)).toBeDefined();
    expectOk(runReplay());
    expect(await statsOf(p)).toBeUndefined();
    expect((await records(p)).map((r) => [r.fieldGroup, r.isActive])).toEqual([['lineup', true]]);
  }, TIMEOUT);

  // (3) An unresolved active key refuses the preflight AND the replay before ANY write, even
  // though a resolvable record for a real row sits beside it and would change that row.
  const expectRefusedBeforeAnyWrite = async (p: Pick, badKey: string, why: string) => {
    const digest = await matchDigest(p.matchId);
    const pre = runPreflight();
    expect(pre.status, `${pre.stdout}\n${pre.stderr}`).toBe(0);
    expect(pre.stdout).toContain('PREFLIGHT REFUSED');
    expect(pre.stdout).toContain('refusing to commit');
    expect(pre.stdout).toContain(badKey);
    expect(pre.stdout).toContain(why);
    const replay = runReplay();
    expect(replay.status).not.toBe(0);
    expect(replay.stderr).toContain('refusing to commit');
    expect(replay.stderr).toContain(badKey);
    expect(replay.stdout).not.toContain('REPLAY OK');
    expect(await matchDigest(p.matchId)).toBe(digest);
    expect((await statsOf(p)).goals).toBe(p.goals);
  };

  it.runIf(canReplay)('(3a) an active key whose match_key is absent from matches refuses before any write', async () => {
    if (!(await storable())) return;
    requireCleanAuthority();
    const p = await seedSingle('s9-3a');
    // The absent-match key is in the `9999|issue257-` namespace cleanup257 removes.
    const badKey = `${ABSENT_MATCH_KEY}|afltables:${p.path}`;
    await seed(keyOf(p), 'match_sheet', { goals: (p.goals ?? 0) + 4 });
    await seed(badKey, 'match_sheet', { goals: 1 });
    await expectRefusedBeforeAnyWrite(p, badKey, 'match_key does not resolve to exactly one match');
  }, TIMEOUT);

  it.runIf(canReplay)('(3b) an active key whose identity names no accepted external identity refuses before any write', async () => {
    if (!(await storable())) return;
    requireCleanAuthority();
    const p = await seedSingle('s9-3b');
    const badKey = keyOf(p, UNKNOWN_PATH);
    await seed(keyOf(p), 'match_sheet', { goals: (p.goals ?? 0) + 4 });
    await seed(badKey, 'match_sheet', { goals: 1 });
    await expectRefusedBeforeAnyWrite(p, badKey, 'identity does not resolve to exactly one player (unresolved)');
  }, TIMEOUT);

  it.runIf(canReplay)('(5) D-257-9: a save records the folded continuing_url identity and the replay resolves it back', async (ctx) => {
    if (!(await storable())) return; // State A: the writer refuses; nothing to fold
    const p = await seedFolded();
    if (!p || !p.continuing || !p.renumbered) {
      console.warn('[ISSUE-257 F-S9-03 / D-257-9] SKIPPED: no tracked profile_url_continuity rule is '
        + 'collision-free in afldb_test (every rule has a path already held by an external_identities '
        + 'row), so a synthetic player cannot hold a rule\'s two paths without ambiguity. No real row '
        + 'is used or mutated.');
      ctx.skip();
      return;
    }
    requireCleanAuthority();
    const continuingKey = keyOf(p, p.continuing);
    const renumberedKey = keyOf(p, p.renumbered);
    const corrected = (p.goals ?? 0) + 2;
    const sourceValue = (p.goals ?? 0) + 1;
    const resetSource = () => sql`UPDATE player_match_stats SET goals = ${sourceValue}
                                   WHERE match_id = ${p.matchId} AND player_id = ${p.playerId}`;
    const saved = await saveMatchSheet({
      matchId: p.matchId, syncMatchScores: false, players: [inputOf(p, corrected)],
      adminUserId, note: NOTE, staleToken: await tokenOf(p.matchId),
    });
    expect(saved).toMatchObject({ ok: true });
    const written = await records(p);
    expect(new Set(written.map((r) => r.entityKey))).toEqual(new Set([continuingKey]));
    expect(written.map((r) => r.fieldGroup)).toContain('match_sheet');

    // The replay resolves the folded identity back to the same player.
    await resetSource();
    expectOk(runReplay());
    expect((await statsOf(p)).goals).toBe(corrected);

    // Either side of the tracked pair resolves to that one player (both sides hold it).
    await sql`UPDATE data_overrides SET entity_key = ${renumberedKey}
               WHERE entity_type = ${ENTITY} AND entity_key = ${continuingKey}`;
    await resetSource();
    expectOk(runReplay());
    expect((await statsOf(p)).goals).toBe(corrected);
  }, TIMEOUT);
});

/* ---------------------------------------------------------------------------------------
 * AFLDB-ISSUE-261 Slice 1 (D-261-2 / D-261-3): the Data Editor score edit and `deleteMatch` bound
 * their lock waits (`SET LOCAL lock_timeout = '5s'`) and refuse with a retryable message.
 *
 * WHAT EACH CASE PROVES (evidence is labelled, never blurred):
 *   BASIC LOCK TIMEOUT. One holder transaction keeps a player_match_stats row lock; the REAL admin
 *     writer waits on it and must be refused at its 5 s bound, roll back whole, and release every
 *     lock it took. No cycle forms. This is NOT a deadlock reproduction.
 *   SETTLE/ADMIN DEADLOCK (sequence A of the ISSUE-261 investigation). The holder is a TEST
 *     TRANSACTION standing in for a settle: it holds the row, then runs the REAL four-call
 *     end-of-run recompute through the REAL `runDerivedRecomputeWithDeadlockRetry` with the REAL
 *     backoff. It is not the full settle (no canonical writes, no gate, no import batch). The
 *     choreography makes the HOLDER the deadlock victim: it starts its conflicting wait only after
 *     the writer's one deadlock check (waitstart + deadlock_timeout) has already run, so the
 *     writer's own detection cannot fire first. The case then proves the holder recovers on a retry
 *     because the writer's 5 s bound ends the wait. The case where the WRITER is the victim needs no
 *     bound to recover and is not choreographed (victim selection is timing-dependent and is not
 *     assumed anywhere). Needs `deadlock_timeout` <= 3 s; skipped, loudly, otherwise.
 *   DRIVER RECOVERY (Slice 1b, last `describe`). No contention: a server-side `RAISE ... '40P01'`
 *     proves the postgres.js transaction survives a recovered retry. It is not lock evidence.
 *
 * Synthetic, committed fixtures in a reserved namespace: season 2080 (checked against every test,
 * src, tools and deploy reference; 2083 is the rolled-back fixture of "Targeted club_seasons rebuild"
 * above and 2079 is the ISSUE-257 namespace), match keys `2080|issue261-*`, player slug `issue261-`.
 * Cleanup is exact by that namespace, runs in beforeAll, afterEach and afterAll, and a residue
 * assertion proves nothing remains. No historical row is read for write or touched.
 * ------------------------------------------------------------------------------------ */
const SEASON_261 = 2080;
const KEY_ROOT_261 = `${SEASON_261}|issue261-`;
const SLUG_261 = 'issue261-';
const NOTE_261 = 'issue-261 contention';
const seededPlayerIds261: number[] = [];
const seededMatchIds261: number[] = [];
const pending261: Promise<unknown>[] = [];
const ids261 = (ids: number[]) => (ids.length > 0 ? ids : [0]);
const pause261 = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Fx261 = { playerId: number; matchA: number; matchB: number };

async function seedFixture261(): Promise<Fx261> {
  const fx = await sql.begin(async (tx) => {
    const clubs = await tx<{ id: number }[]>`
      SELECT DISTINCT ON (organization_id) id::int AS id
        FROM clubs
       WHERE organization_id IS NOT NULL
       ORDER BY organization_id, id
       LIMIT 2
    `;
    if (clubs.length < 2) throw new Error('ISSUE-261 fixture needs two club identities');
    const [home, away] = clubs;
    const [source] = await tx<{ id: number }[]>`SELECT id::int AS id FROM sources WHERE key = 'afltables'`;
    await tx`
      INSERT INTO seasons (year, league, status)
      VALUES (${SEASON_261}, 'AFL', 'complete'::season_status)
      ON CONFLICT DO NOTHING
    `;
    const insertMatch = async (token: string, round: number, date: string) => {
      const [m] = await tx<{ id: number }[]>`
        INSERT INTO matches (
          match_key, season, round_code, round_number, round_type, is_final,
          match_date, venue_raw, home_club_id, away_club_id,
          home_goals, home_behinds, home_score, away_goals, away_behinds, away_score,
          result, winner_club_id, margin,
          attendance, attendance_status, source_id
        ) VALUES (
          ${`${KEY_ROOT_261}${token}`}, ${SEASON_261}, ${String(round)}, ${round},
          'home_and_away'::round_type, false,
          ${date}, 'ISSUE-261 Fixture Oval', ${home.id}, ${away.id},
          15, 10, 100, 12, 8, 80,
          'home_win'::match_result, ${home.id}, 20,
          NULL, 'not_collected'::coverage_status, ${source.id}
        )
        RETURNING id::int AS id
      `;
      return m.id;
    };
    const matchA = await insertMatch('a', 1, `${SEASON_261}-03-05`);
    const matchB = await insertMatch('b', 2, `${SEASON_261}-03-12`);
    const [player] = await tx<{ id: number }[]>`
      INSERT INTO players (display_name, sort_name, search_name, slug)
      VALUES ('Issue261 Holder', 'Holder, Issue261', 'issue261 holder', ${`${SLUG_261}holder`})
      RETURNING id::int AS id
    `;
    for (const matchId of [matchA, matchB]) {
      await tx`
        INSERT INTO player_match_stats (
          player_id, match_id, club_id, jumper_number, kicks, marks, handballs, disposals,
          goals, behinds, hitouts, tackles, frees_for, frees_against, source_id
        ) VALUES (
          ${player.id}, ${matchId}, ${home.id}, ${STAT_257.jumperNumber}, ${STAT_257.kicks},
          ${STAT_257.marks}, ${STAT_257.handballs}, ${STAT_257.disposals}, ${STAT_257.goals},
          ${STAT_257.behinds}, ${STAT_257.hitouts}, ${STAT_257.tackles}, ${STAT_257.freesFor},
          ${STAT_257.freesAgainst}, ${source.id}
        )
      `;
    }
    await recomputeSeasonMetadata(tx, SEASON_261);
    await recomputeClubSeasons(tx, SEASON_261);
    await recomputePlayerDerivedStats(tx, [player.id], SEASON_261);
    return { playerId: player.id, matchA, matchB };
  });
  seededPlayerIds261.push(fx.playerId);
  seededMatchIds261.push(fx.matchA, fx.matchB);
  return fx;
}

/** Removes exactly the ISSUE-261 namespace, children first. Idempotent. */
async function cleanup261(): Promise<void> {
  const players = () => sql`(SELECT id FROM players WHERE starts_with(slug, ${SLUG_261}::text))`;
  const matches = () => sql`(SELECT id FROM matches WHERE starts_with(match_key, ${KEY_ROOT_261}::text))`;
  await sql`
    DELETE FROM data_overrides
     WHERE entity_type = 'matches' AND starts_with(entity_key, ${KEY_ROOT_261}::text)
  `;
  await sql`
    DELETE FROM data_edits
     WHERE table_name = 'matches'
       AND (row_id = ANY(${ids261(seededMatchIds261)}) OR row_id IN ${matches()})
  `;
  if (adminUserId > 0) {
    await sql`DELETE FROM data_edits WHERE admin_user_id = ${adminUserId} AND note = ${NOTE_261}`;
  }
  await sql`DELETE FROM player_match_stats WHERE player_id IN ${players()} OR match_id IN ${matches()}`;
  for (const table of ['player_clubs', 'player_club_season_stats', 'player_season_stats', 'player_career_stats']) {
    await sql`DELETE FROM ${sql(table)} WHERE player_id IN ${players()}`;
  }
  await sql`DELETE FROM match_period_scores WHERE match_id IN ${matches()}`;
  await sql`DELETE FROM players WHERE starts_with(slug, ${SLUG_261}::text)`;
  await sql`DELETE FROM matches WHERE starts_with(match_key, ${KEY_ROOT_261}::text)`;
  // Season-scoped rows go only when no match of the season survives (a foreign match keeps them).
  await sql`
    DELETE FROM club_seasons
     WHERE season = ${SEASON_261} AND NOT EXISTS (SELECT 1 FROM matches WHERE season = ${SEASON_261})
  `;
  await sql`
    DELETE FROM seasons
     WHERE year = ${SEASON_261} AND NOT EXISTS (SELECT 1 FROM matches WHERE season = ${SEASON_261})
  `;
}

const NO_RESIDUE_261 = {
  dataOverrides: 0, dataEdits: 0, playerMatchStats: 0, playerDerived: 0, periodScores: 0,
  clubSeasons: 0, players: 0, matches: 0, seasons: 0,
};

async function residue261(): Promise<typeof NO_RESIDUE_261> {
  const pids = ids261(seededPlayerIds261);
  const mids = ids261(seededMatchIds261);
  const [r] = await sql<(typeof NO_RESIDUE_261)[]>`
    SELECT
      (SELECT count(*) FROM data_overrides
        WHERE entity_type = 'matches' AND starts_with(entity_key, ${KEY_ROOT_261}::text))::int AS "dataOverrides",
      (SELECT count(*) FROM data_edits
        WHERE table_name = 'matches' AND row_id = ANY(${mids}))::int AS "dataEdits",
      (SELECT count(*) FROM player_match_stats
        WHERE player_id = ANY(${pids}) OR match_id = ANY(${mids}))::int AS "playerMatchStats",
      ((SELECT count(*) FROM player_clubs WHERE player_id = ANY(${pids}))
       + (SELECT count(*) FROM player_club_season_stats WHERE player_id = ANY(${pids}))
       + (SELECT count(*) FROM player_season_stats WHERE player_id = ANY(${pids}))
       + (SELECT count(*) FROM player_career_stats WHERE player_id = ANY(${pids})))::int AS "playerDerived",
      (SELECT count(*) FROM match_period_scores WHERE match_id = ANY(${mids}))::int AS "periodScores",
      (SELECT count(*) FROM club_seasons WHERE season = ${SEASON_261})::int AS "clubSeasons",
      (SELECT count(*) FROM players
        WHERE id = ANY(${pids}) OR starts_with(slug, ${SLUG_261}::text))::int AS "players",
      (SELECT count(*) FROM matches
        WHERE id = ANY(${mids}) OR starts_with(match_key, ${KEY_ROOT_261}::text))::int AS "matches",
      (SELECT count(*) FROM seasons WHERE year = ${SEASON_261})::int AS "seasons"
  `;
  return r;
}

/**
 * Everything a writer could have changed in the fixture match B and its season, in a
 * comparable shape: a refusal that rolled back whole leaves this identical.
 */
async function stateOf261(fx: Fx261): Promise<unknown> {
  const [r] = await sql<{ state: unknown }[]>`
    SELECT jsonb_build_object(
      'match', (SELECT to_jsonb(m) FROM matches m WHERE m.id = ${fx.matchB}),
      'periods', (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.period, p.club_id), '[]'::jsonb)
                    FROM match_period_scores p WHERE p.match_id = ${fx.matchB}),
      'statRows', (SELECT count(*) FROM player_match_stats WHERE match_id = ${fx.matchB}),
      'audits', (SELECT count(*) FROM data_edits WHERE table_name = 'matches' AND row_id = ${fx.matchB}),
      'overrides', (SELECT count(*) FROM data_overrides
                     WHERE entity_type = 'matches' AND starts_with(entity_key, ${KEY_ROOT_261}::text)),
      'ladder', (SELECT coalesce(jsonb_agg(jsonb_build_array(c.club_id, c.played, c.wins, c.points_for,
                                                            c.points_against) ORDER BY c.club_id), '[]'::jsonb)
                   FROM club_seasons c WHERE c.season = ${SEASON_261})
    ) AS state
  `;
  return r.state;
}

async function deadlockTimeoutMs261(): Promise<number> {
  const [r] = await sql<{ ms: number }[]>`SELECT setting::int AS ms FROM pg_settings WHERE name = 'deadlock_timeout'`;
  return r.ms;
}

/** The backend waiting on `holderPid`, once its wait has lasted at least `minWaitedMs` (server clock). */
async function waitUntilBlocked261(holderPid: number, minWaitedMs: number): Promise<{ pid: number; waitedMs: number }> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const [row] = await sql<{ pid: number; waitedMs: number }[]>`
      SELECT l.pid::int AS pid,
             (extract(epoch FROM (clock_timestamp() - l.waitstart)) * 1000)::int AS "waitedMs"
        FROM pg_locks l
       WHERE NOT l.granted AND l.waitstart IS NOT NULL
         AND ${holderPid}::int = ANY(pg_blocking_pids(l.pid))
       LIMIT 1
    `;
    if (row && row.waitedMs >= minWaitedMs) return row;
    if (Date.now() > deadline) {
      throw new Error(`no backend waited >= ${minWaitedMs} ms on holder ${holderPid} within 20 s (saw ${JSON.stringify(row ?? null)})`);
    }
    await pause261(25);
  }
}

/** Rejects (so the holder's transaction rolls back and frees the writer) instead of hanging. */
function within261<R>(label: string, promise: Promise<R>, ms: number): Promise<R> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: not finished within ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * A transaction holding the row lock a settle unit holds after UPDATEing player P's statistic in
 * match A. It never waits unless `body` makes it. Rolled back (locks freed) when `body` throws.
 */
async function withHeldPlayerRow261<R>(
  fx: Fx261,
  body: (tx: postgres.TransactionSql, holderPid: number) => Promise<R>,
): Promise<R> {
  const holder = postgres(process.env.AFLDB_TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    return await holder.begin(async (tx) => {
      const [{ pid }] = await tx<{ pid: number }[]>`SELECT pg_backend_pid()::int AS pid`;
      await tx`
        SELECT id FROM player_match_stats
         WHERE match_id = ${fx.matchA} AND player_id = ${fx.playerId}
           FOR UPDATE
      `;
      return body(tx, pid);
    }) as unknown as R;
  } finally {
    await holder.end({ timeout: 5 });
  }
}

/**
 * The settle's real end-of-run block (settle-afltables.ts / settle-afl-api.ts), verbatim in order.
 * `handle` is the savepoint-scoped handle the retry helper passes in production; the BASIC case,
 * which runs the block once with no retry, passes its transaction.
 */
const settleBlock261 = (fx: Fx261) => async (handle: postgres.TransactionSql) => {
  await recomputeSeasonMetadata(handle, SEASON_261);
  await recomputeClubSeasons(handle, SEASON_261);
  await recomputePlayerDerivedStats(handle, [fx.playerId], SEASON_261);
  await recomputeSeasonBrownlowStatus(handle, SEASON_261);
};

type Writer261 = { label: string; run: (fx: Fx261) => Promise<{ ok: boolean; error?: string }> };
const writers261: Writer261[] = [
  {
    label: 'Data Editor score edit (saveEdit, matches/score)',
    run: (fx) => saveEdit({
      entityKey: 'matches', rowId: fx.matchB, groupKey: 'score',
      raw: { home_goals: '16', home_behinds: '0', away_goals: '12', away_behinds: '8' },
      adminUserId, note: NOTE_261,
    }),
  },
  {
    label: 'deleteMatch',
    run: (fx) => deleteMatch({ matchId: fx.matchB, adminUserId, reason: NOTE_261 }),
  },
];

/** Starts a writer without awaiting it; the afterEach waits for every started writer. */
function start261(writer: Writer261, fx: Fx261) {
  const t0 = Date.now();
  const run = writer.run(fx).then((result) => ({ result, ms: Date.now() - t0 }));
  pending261.push(run.catch(() => undefined));
  return run;
}

describe('AFLDB-ISSUE-261 Slice 1: bounded lock waits on the Data Editor score edit and deleteMatch', () => {
  beforeAll(async () => {
    await cleanup261();
    const [reserved] = await sql<{ seasons: number; matches: number }[]>`
      SELECT (SELECT count(*) FROM seasons WHERE year = ${SEASON_261})::int AS seasons,
             (SELECT count(*) FROM matches WHERE season = ${SEASON_261})::int AS matches
    `;
    expect(reserved, `season ${SEASON_261} is reserved for the ISSUE-261 fixture`).toEqual({ seasons: 0, matches: 0 });
  }, 120_000);

  afterEach(async () => {
    // A writer started by a failed case must finish (its bound ends it) before its rows go.
    await Promise.allSettled(pending261.splice(0));
    await cleanup261();
  }, 120_000);

  afterAll(async () => {
    await cleanup261();
    expect(await residue261()).toEqual(NO_RESIDUE_261);
  }, 120_000);

  describe.each(writers261)('$label', (writer) => {
    it('BASIC LOCK TIMEOUT (no deadlock): refused at its 5 s bound, rolled back whole, every lock released', async () => {
      const fx = await seedFixture261();
      const before = await stateOf261(fx);

      await withHeldPlayerRow261(fx, async (tx, holderPid) => {
        const run = start261(writer, fx);
        const blocked = await waitUntilBlocked261(holderPid, 0);
        expect(blocked.pid).not.toBe(holderPid);

        const { result, ms } = await within261('the writer to be refused', run, 20_000);
        expect(result).toEqual({ ok: false, error: MATCH_BUSY_REFUSAL });
        // The bound, not a deadlock check, ended the wait (a deadlock victim is refused after ~deadlock_timeout).
        expect(ms).toBeGreaterThanOrEqual(4500);

        // Atomic: nothing of the writer survived.
        expect(await stateOf261(fx)).toEqual(before);

        // Released: the holder can now take, without waiting, every lock the writer held,
        // and the settle's real end-of-run block completes at once.
        await tx`SET LOCAL lock_timeout = '2s'`;
        await tx`SELECT id FROM matches WHERE season = ${SEASON_261} FOR UPDATE NOWAIT`;
        await tx`SELECT year FROM seasons WHERE year = ${SEASON_261} FOR UPDATE NOWAIT`;
        await tx`SELECT season FROM club_seasons WHERE season = ${SEASON_261} FOR UPDATE NOWAIT`;
        await settleBlock261(fx)(tx);
      });

      expect(await stateOf261(fx)).toEqual(before);
    }, FX_TIMEOUT);

    it('SETTLE/ADMIN DEADLOCK (settle stood in for by a test transaction, settle is the victim): the writer is refused at its bound and the settle recovers on a retry', async (ctx) => {
      const deadlockTimeout = await deadlockTimeoutMs261();
      if (deadlockTimeout > 3000) {
        console.warn(`[ISSUE-261] SKIPPED: deadlock_timeout is ${deadlockTimeout} ms; the choreography needs <= 3000 ms `
          + 'so the settle starts waiting after the writer\'s one deadlock check and before its 5 s bound.');
        ctx.skip();
        return;
      }
      const fx = await seedFixture261();
      const before = await stateOf261(fx);

      const outcome = await withHeldPlayerRow261(fx, async (tx, holderPid) => {
        const run = start261(writer, fx);
        // The writer holds the season row and waits on the holder's row. Let its ONE deadlock
        // check (waitstart + deadlock_timeout) pass with no cycle, so it cannot be the victim.
        await waitUntilBlocked261(holderPid, deadlockTimeout + 500);
        // Now the holder, like a settle's end of run, wants the season row: a cycle. The real
        // retry helper and the real backoff; the holder's own check detects it.
        const retried = await within261(
          'the settle block to finish',
          runDerivedRecomputeWithDeadlockRetry(tx, settleBlock261(fx)),
          60_000,
        );
        const { result, ms } = await within261('the writer to be refused', run, 20_000);
        return { retried, result, ms };
      });

      // The settle lost at least one deadlock (it was the victim) and still committed.
      expect(outcome.retried.attempts).toBeGreaterThanOrEqual(2);
      expect(outcome.retried.attempts).toBeLessThanOrEqual(DERIVED_RECOMPUTE_DEADLOCK_BACKOFF_MS.length + 1);
      // The writer was ended by its own bound, refused, and left nothing behind.
      expect(outcome.result).toEqual({ ok: false, error: MATCH_BUSY_REFUSAL });
      expect(outcome.ms).toBeGreaterThanOrEqual(4500);
      expect(await stateOf261(fx)).toEqual(before);
    }, FX_TIMEOUT);
  });

  /* -------------------------------------------------------------------------------------
   * DRIVER RECOVERY (Slice 1b). Deterministic, no lock, no timing, no `deadlock_timeout`.
   * Validation run 1 showed the SETTLE/ADMIN DEADLOCK cases failing with a `40P01` the retry
   * helper had already recovered from: postgres.js records the first rejection of every query on a
   * transaction handle and re-throws it when `sql.begin`'s callback resolves. The helper now issues
   * each attempt through `tx.savepoint(...)` and gives `work` that scoped handle.
   *
   * This proves the DRIVER recovers: a server-side `RAISE ... ERRCODE '40P01'` stands in for the
   * deadlock victim, so the outer transaction's fate is the only thing under test. It does NOT
   * prove the lock mitigation; the contention cases above do that. Synthetic rows only: players in
   * the `issue261-drv-` slug namespace, removed by `cleanup261` (afterEach) and checked by the
   * afterAll residue assertion. The check runs on a separate connection after the commit.
   * ----------------------------------------------------------------------------------- */
  describe('driver recovery (Slice 1b): a 40P01 recovered inside the retry does not roll the outer transaction back', () => {
    const DRV = `${SLUG_261}drv-`;
    const marker = (handle: postgres.TransactionSql, token: string) => handle`
      INSERT INTO players (display_name, sort_name, search_name, slug)
      VALUES (${`Issue261 ${token}`}, ${`${token}, Issue261`}, ${`issue261 ${token}`}, ${`${DRV}${token}`})
    `;
    const raiseDeadlock = (handle: postgres.TransactionSql) => handle.unsafe(
      `DO $$ BEGIN RAISE EXCEPTION 'issue-261 synthetic deadlock' USING ERRCODE = '40P01'; END $$`,
    );
    /** What a SEPARATE session (the shared client, never the writer's connection) sees committed. */
    const committedMarkers = () => sql.begin(async (view) => {
      const rows = await view<{ slug: string }[]>`SELECT slug FROM players WHERE starts_with(slug, ${DRV}::text)`;
      return rows.map((row) => row.slug.slice(DRV.length)).sort();
    });

    it('first attempt raises 40P01, a later attempt succeeds: the outer transaction commits and the failed attempt\'s writes are gone', async () => {
      const writer = postgres(process.env.AFLDB_TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
      const sleeps: number[] = [];
      const scopes: unknown[] = [];
      let outer: unknown;
      try {
        const retried = await writer.begin(async (tx) => {
          outer = tx;
          await marker(tx, 'outer-before');
          const result = await runDerivedRecomputeWithDeadlockRetry(tx, async (scope) => {
            scopes.push(scope);
            const attempt = scopes.length;
            await marker(scope, `attempt-${attempt}`);
            if (attempt === 1) await raiseDeadlock(scope);
            return attempt;
          }, { sleep: async (ms) => { sleeps.push(ms); } });
          // Uncommitted writes are invisible to the separate session: it is a real second view.
          expect(await committedMarkers()).toEqual([]);
          await marker(tx, 'outer-after');
          return result;
        });

        expect(retried).toEqual({ value: 2, attempts: 2 });
        expect(sleeps).toEqual([DERIVED_RECOMPUTE_DEADLOCK_BACKOFF_MS[0]]);
        expect(scopes).toHaveLength(2);
        expect(scopes[0]).not.toBe(scopes[1]);
        for (const scope of scopes) expect(scope).not.toBe(outer);

        // Committed: both outer writes and the SUCCESSFUL attempt. Rolled back: attempt 1's write.
        expect(await committedMarkers()).toEqual(['attempt-2', 'outer-after', 'outer-before']);
      } finally {
        await writer.end({ timeout: 5 });
      }
    }, FX_TIMEOUT);

    it('40P01 on every attempt: four attempts, the error propagates, and the whole outer transaction rolls back', async () => {
      const writer = postgres(process.env.AFLDB_TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
      const sleeps: number[] = [];
      let attempts = 0;
      try {
        await expect(writer.begin(async (tx) => {
          await marker(tx, 'outer-before');
          await runDerivedRecomputeWithDeadlockRetry(tx, async (scope) => {
            attempts += 1;
            await marker(scope, `attempt-${attempts}`);
            await raiseDeadlock(scope);
          }, { sleep: async (ms) => { sleeps.push(ms); } });
        })).rejects.toMatchObject({ code: '40P01' });

        expect(attempts).toBe(DERIVED_RECOMPUTE_DEADLOCK_BACKOFF_MS.length + 1);
        expect(sleeps).toEqual([...DERIVED_RECOMPUTE_DEADLOCK_BACKOFF_MS]);
        expect(await committedMarkers()).toEqual([]);
      } finally {
        await writer.end({ timeout: 5 });
      }
    }, FX_TIMEOUT);
  });
});

/* ---------------------------------------------------------------------------------------
 * AFLDB-ISSUE-267 / AFLDB-ISSUE-269: replay_admin_overrides('matches').
 *
 * The REAL tools/migration/common.py replay, spawned in Python, over committed synthetic
 * fixtures (the Python connection cannot see an uncommitted TypeScript transaction).
 *
 * TRANSACTION BOUNDARY. The replay is database-wide: it re-applies EVERY active `matches`
 * override and re-syncs every score-overridden match's final period, not only the fixture's.
 * So the Python side never commits. It snapshots the fixture, replays (twice, for
 * idempotence), snapshots again, and ROLLS BACK, all on one connection that sees its own
 * writes. No real match is changed by this suite. The cost: a foreign active override in
 * afldb_test that the replay itself refuses (a disagreement, an underivable score) refuses
 * these cases too, and the refusal text names the foreign key.
 *
 * A reload is simulated by restoring the fixture's SOURCE values (committed) after the
 * editor wrote its override, which is the state a `matches` reload leaves before it replays.
 *
 * Namespace: season 2081 (no test, src, tools or deploy source names it; 2080 is the ISSUE-261
 * fixture above, 2082-2099 other suites), match keys `2081|issue267-*`.
 *
 * OWNERSHIP. A preflight runs FIRST, before anything is deleted or written: any season 2081
 * row, season-2081 or `2081|issue267-*` match, season-2081 club_seasons row, `2081|issue267-*`
 * override or ISSUE-267-noted matches edit is foreign state (another suite, real data, or the
 * residue of a crashed run), and the suite refuses to start. Until the preflight passes,
 * seeding refuses and cleanup is a no-op. Cleanup then deletes only what this run recorded
 * creating: its match ids and keys (and their overrides, edits and period rows), the season's
 * club_seasons rows its own score saves derived (saveEdit267), and the season row only if THIS
 * run's INSERT created it. "No match of the season remains" is never read as ownership on its
 * own. One transaction: a failure part-way deletes nothing, so the residue stays whole and
 * reportable rather than a season row stranded under its ladder (operator run 2026-10-09:
 * club_seasons_season_fkey, two rows left, historical club_seasons 1,624 -> 1,626).
 * ------------------------------------------------------------------------------------ */
const SEASON_267 = 2081;
const KEY_ROOT_267 = `${SEASON_267}|issue267-`;
const NOTE_267 = 'issue-267 replay';
/** Exactly what this run created; cleanup deletes nothing outside it. Ids are never reused. */
const owned267 = {
  preflightPassed: false,
  createdSeason: false,
  matchIds: [] as number[],
  matchKeys: [] as string[],
  /** club_seasons.club_id of the owned season's ladder rows this run's score saves derived. */
  clubSeasonClubIds: [] as number[],
};
const ids267 = (ids: number[]) => (ids.length > 0 ? ids : [0]);
const keys267 = (keys: string[]) => (keys.length > 0 ? keys : ['']);

type Fx267 = { matchId: number; matchKey: string; homeClubId: number; awayClubId: number };
type Period267 = [clubId: number, period: number, goals: number | null, behinds: number | null, points: number | null];
type Snapshot267 = Record<string, { match: Record<string, unknown>; periods: Period267[] }>;
type Replay267 = {
  before: Snapshot267;
  first?: Snapshot267;
  second?: Snapshot267;
  refused?: string;
  afterRefusal?: Snapshot267;
};

/**
 * The fixture's source score, 15.10 (100) v 12.8 (80), and its cumulative quarter rows
 * (Q4 = the totals). `homeBehinds: null` seeds a match whose home breakdown is not recorded.
 */
const SOURCE_267 = { homeGoals: 15, homeBehinds: 10, awayGoals: 12, awayBehinds: 8 };
const SOURCE_PERIODS_267 = {
  home: [[1, 4, 2], [2, 8, 5], [3, 11, 7], [4, 15, 10]],
  away: [[1, 3, 1], [2, 6, 4], [3, 9, 6], [4, 12, 8]],
} as const;

async function seedFixture267(token: string, opts: { homeBehinds?: number | null } = {}): Promise<Fx267> {
  if (!owned267.preflightPassed) throw new Error('ISSUE-267 fixture: refusing to seed before the ownership preflight passes');
  const homeBehinds = opts.homeBehinds === undefined ? SOURCE_267.homeBehinds : opts.homeBehinds;
  const seeded = await sql.begin(async (tx) => {
    const clubs = await tx<{ id: number }[]>`
      SELECT DISTINCT ON (organization_id) id::int AS id
        FROM clubs
       WHERE organization_id IS NOT NULL
       ORDER BY organization_id, id
       LIMIT 2
    `;
    if (clubs.length < 2) throw new Error('ISSUE-267 fixture needs two club identities');
    const [home, away] = clubs;
    const [source] = await tx<{ id: number }[]>`SELECT id::int AS id FROM sources WHERE key = 'afltables'`;
    // RETURNING tells this run whether ITS insert created the season; a row that appeared
    // since the preflight is left alone, and so is never deleted.
    const createdSeason = (await tx`
      INSERT INTO seasons (year, league, status)
      VALUES (${SEASON_267}, 'AFL', 'complete'::season_status)
      ON CONFLICT DO NOTHING
      RETURNING year
    `).length === 1;
    const matchKey = `${KEY_ROOT_267}${token}`;
    const [m] = await tx<{ id: number }[]>`
      INSERT INTO matches (
        match_key, season, round_code, round_number, round_type, is_final,
        match_date, venue_raw, home_club_id, away_club_id,
        home_goals, home_behinds, home_score, away_goals, away_behinds, away_score,
        result, winner_club_id, margin,
        attendance, attendance_status, source_id
      ) VALUES (
        ${matchKey}, ${SEASON_267}, '1', 1, 'home_and_away'::round_type, false,
        ${`${SEASON_267}-03-05`}, 'ISSUE-267 Fixture Oval', ${home.id}, ${away.id},
        ${SOURCE_267.homeGoals}, ${homeBehinds}, 100, ${SOURCE_267.awayGoals}, ${SOURCE_267.awayBehinds}, 80,
        'home_win'::match_result, ${home.id}, 20,
        NULL, 'not_collected'::coverage_status, ${source.id}
      )
      RETURNING id::int AS id
    `;
    return { createdSeason, fx: { matchId: m.id, matchKey, homeClubId: home.id, awayClubId: away.id } };
  });
  // Recorded only once the transaction committed: a rolled-back seed created nothing.
  if (seeded.createdSeason) owned267.createdSeason = true;
  owned267.matchIds.push(seeded.fx.matchId);
  owned267.matchKeys.push(seeded.fx.matchKey);
  const fx = seeded.fx;
  await reloadSource267(fx, opts);
  return fx;
}

/**
 * What a `matches` reload leaves before it replays: every column an override can touch back at
 * its source value, and the source's period rows. Committed, so the Python connection sees it.
 */
async function reloadSource267(fx: Fx267, opts: { homeBehinds?: number | null } = {}): Promise<void> {
  const homeBehinds = opts.homeBehinds === undefined ? SOURCE_267.homeBehinds : opts.homeBehinds;
  await sql.begin(async (tx) => {
    await tx`
      UPDATE matches
         SET home_goals = ${SOURCE_267.homeGoals}, home_behinds = ${homeBehinds}, home_score = 100,
             away_goals = ${SOURCE_267.awayGoals}, away_behinds = ${SOURCE_267.awayBehinds}, away_score = 80,
             result = 'home_win'::match_result, winner_club_id = home_club_id, margin = 20,
             attendance = NULL, attendance_status = 'not_collected'::coverage_status,
             attendance_source_id = NULL, match_time = NULL, match_event = NULL, notes = NULL
       WHERE id = ${fx.matchId}
    `;
    await tx`DELETE FROM match_period_scores WHERE match_id = ${fx.matchId}`;
    for (const [clubId, rows] of [[fx.homeClubId, SOURCE_PERIODS_267.home], [fx.awayClubId, SOURCE_PERIODS_267.away]] as const) {
      for (const [period, goals, behinds] of rows) {
        // The home side's breakdown is "not recorded" when the fixture says so, not zero.
        const b = clubId === fx.homeClubId && homeBehinds === null ? null : behinds;
        const points = clubId === fx.homeClubId && period === 4 ? 100 : b === null ? null : goals * 6 + b;
        await tx`
          INSERT INTO match_period_scores (match_id, club_id, period, goals, behinds, points)
          VALUES (${fx.matchId}, ${clubId}, ${period}, ${goals}, ${b}, ${points})
        `;
      }
    }
  });
}

const NO_FOREIGN_STATE_267 = { seasons: 0, matches: 0, clubSeasons: 0, dataOverrides: 0, dataEdits: 0 };

/**
 * The ownership preflight. Reads only; deletes nothing. Passes only when the namespace holds
 * no state at all, so everything found in it afterwards was created by this run.
 */
async function preflight267(): Promise<void> {
  const [found] = await sql<(typeof NO_FOREIGN_STATE_267)[]>`
    SELECT
      (SELECT count(*) FROM seasons WHERE year = ${SEASON_267})::int AS seasons,
      (SELECT count(*) FROM matches
        WHERE season = ${SEASON_267} OR starts_with(match_key, ${KEY_ROOT_267}::text))::int AS matches,
      (SELECT count(*) FROM club_seasons WHERE season = ${SEASON_267})::int AS "clubSeasons",
      (SELECT count(*) FROM data_overrides
        WHERE entity_type = 'matches' AND starts_with(entity_key, ${KEY_ROOT_267}::text))::int AS "dataOverrides",
      (SELECT count(*) FROM data_edits WHERE table_name = 'matches' AND note = ${NOTE_267})::int AS "dataEdits"
  `;
  expect(found, `season ${SEASON_267} and keys ${KEY_ROOT_267}* are reserved for the ISSUE-267 fixture, `
    + 'but foreign state exists; nothing was deleted. Inspect and remove it by hand before re-running.')
    .toEqual(NO_FOREIGN_STATE_267);
  owned267.preflightPassed = true;
}

/**
 * The live editor save on a fixture match, recording the derived rows it creates.
 *
 * A committed `score` save runs applyMatchEdit's coupled recomputes (src/db/queries/data-edits.ts)
 * over the fixture's season (src/db/queries/player-derived.ts):
 *   - recomputeSeasonMetadata: UPDATEs the season row (owned; deleted last);
 *   - recomputeClubSeasons: DELETEs and re-INSERTs the season's ladder, one club_seasons row per
 *     club with a home-and-away match: these are the rows recorded here;
 *   - recomputePlayerDerivedStats: a no-op, the fixture has no player_match_stats;
 *   - recomputeSeasonBrownlowStatus: UPDATEs player_season_stats of the season, of which it has none.
 * Plus the period rows, the override and the data_edits audit row, all keyed to the fixture match.
 * Other groups write only the match row, the override and the audit row.
 *
 * Recorded only while the season is this run's and every match of it is this run's: the
 * preflight proved the season held no ladder row, so each one present then was written by this
 * run's recompute. A ladder that also counts a foreign match is never claimed.
 */
async function saveEdit267(input: Parameters<typeof saveEdit>[0]): ReturnType<typeof saveEdit> {
  const saved = await saveEdit(input);
  if (saved.ok && input.groupKey === 'score' && owned267.createdSeason) {
    const rows = await sql<{ clubId: number }[]>`
      SELECT cs.club_id::int AS "clubId"
        FROM club_seasons cs
       WHERE cs.season = ${SEASON_267}
         AND NOT EXISTS (
           SELECT 1 FROM matches m
            WHERE m.season = ${SEASON_267} AND NOT (m.id = ANY(${ids267(owned267.matchIds)}))
         )
    `;
    for (const { clubId } of rows) {
      if (!owned267.clubSeasonClubIds.includes(clubId)) owned267.clubSeasonClubIds.push(clubId);
    }
  }
  return saved;
}

/**
 * Removes exactly what this run created, children first, in ONE transaction. Idempotent. A
 * no-op until the preflight passes, so a refused run never deletes anything.
 */
async function cleanup267(): Promise<void> {
  if (!owned267.preflightPassed) return;
  const mids = ids267(owned267.matchIds);
  await sql.begin(async (tx) => {
    await tx`
      DELETE FROM data_overrides
       WHERE entity_type = 'matches' AND entity_key = ANY(${keys267(owned267.matchKeys)})
    `;
    await tx`DELETE FROM data_edits WHERE table_name = 'matches' AND row_id = ANY(${mids})`;
    await tx`DELETE FROM match_period_scores WHERE match_id = ANY(${mids})`;
    await tx`DELETE FROM matches WHERE id = ANY(${mids})`;
    if (!owned267.createdSeason) return;
    // The ladder rows this run's score saves derived, before their parent season. Only once no
    // match of the season survives: a surviving (foreign) match is counted in them.
    await tx`
      DELETE FROM club_seasons
       WHERE season = ${SEASON_267} AND club_id = ANY(${ids267(owned267.clubSeasonClubIds)})
         AND NOT EXISTS (SELECT 1 FROM matches WHERE season = ${SEASON_267})
    `;
    // This run's INSERT created the season. A match or ladder row that is not ours keeps it
    // regardless: the season then stays as residue for the assertion to report, never deleted
    // from under it.
    await tx`
      DELETE FROM seasons
       WHERE year = ${SEASON_267}
         AND NOT EXISTS (SELECT 1 FROM matches WHERE season = ${SEASON_267})
         AND NOT EXISTS (SELECT 1 FROM club_seasons WHERE season = ${SEASON_267})
    `;
  });
  // Recorded only once the transaction committed: a rolled-back cleanup released nothing.
  owned267.createdSeason = false;
  owned267.clubSeasonClubIds = [];
}

const NO_RESIDUE_267 = { dataOverrides: 0, dataEdits: 0, periodScores: 0, clubSeasons: 0, matches: 0, seasons: 0 };

async function residue267(): Promise<typeof NO_RESIDUE_267> {
  const mids = ids267(owned267.matchIds);
  const [r] = await sql<(typeof NO_RESIDUE_267)[]>`
    SELECT
      (SELECT count(*) FROM data_overrides
        WHERE entity_type = 'matches' AND starts_with(entity_key, ${KEY_ROOT_267}::text))::int AS "dataOverrides",
      (SELECT count(*) FROM data_edits
        WHERE table_name = 'matches' AND (row_id = ANY(${mids}) OR note = ${NOTE_267}))::int AS "dataEdits",
      (SELECT count(*) FROM match_period_scores WHERE match_id = ANY(${mids}))::int AS "periodScores",
      (SELECT count(*) FROM club_seasons WHERE season = ${SEASON_267})::int AS "clubSeasons",
      (SELECT count(*) FROM matches
        WHERE id = ANY(${mids}) OR starts_with(match_key, ${KEY_ROOT_267}::text))::int AS "matches",
      (SELECT count(*) FROM seasons WHERE year = ${SEASON_267})::int AS "seasons"
  `;
  return r;
}

describe('AFLDB-ISSUE-267/269: the matches override replay merges every active row and syncs the final period', () => {
  const TIMEOUT = 120_000;
  const root = process.cwd();
  const venvPython = process.platform === 'win32'
    ? join(root, '.venv', 'Scripts', 'python.exe')
    : join(root, '.venv', 'bin', 'python');
  const python = process.env.AFLDB_PYTHON
    ?? (existsSync(venvPython) ? venvPython : (process.platform === 'win32' ? 'python' : 'python3'));
  // Every subprocess and database wait is bounded. The process limit sits inside the test
  // TIMEOUT so a hang is reported as a hang, not as a vitest timeout.
  const PROBE_TIMEOUT_MS = 30_000;
  const REPLAY_PROCESS_TIMEOUT_MS = 90_000;
  const REPLAY_CONNECT_TIMEOUT_S = 10;
  const REPLAY_LOCK_TIMEOUT = '5s';
  const REPLAY_STATEMENT_TIMEOUT = '30s';

  const probe = spawnSync(python, ['-c', 'import psycopg'], { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS });
  const probeFailure = probe.error
    ? ((probe.error as NodeJS.ErrnoException).code === 'ETIMEDOUT'
      ? `timed out after ${PROBE_TIMEOUT_MS} ms and was killed`
      : `could not run: ${probe.error.message}`)
    : probe.signal ? `was terminated by ${probe.signal}`
    : probe.status !== 0 ? `exited ${probe.status}: ${(probe.stderr ?? '').trim().split(/\r?\n/).pop()}`
    : null;
  const canReplay = probeFailure === null;
  if (!canReplay) {
    // A skip must never pass for a run: say why, so "6 passed" is checked, not assumed.
    console.warn(`AFLDB-ISSUE-267/269 replay cases SKIPPED: \`${python} -c "import psycopg"\` ${probeFailure}`);
  }

  /**
   * The REAL replay_admin_overrides(conn, 'matches'), run twice on one connection between
   * snapshots of the fixture matches, then ROLLED BACK (see the section comment). A
   * RuntimeError refusal is caught and the fixture is snapshotted again in the same
   * transaction, so "refused before any write" is observed, not inferred from a rollback.
   *
   * Bounded: a connect timeout, transaction-local lock and statement timeouts (nothing here
   * commits, so SET LOCAL holds for both passes), and a process timeout. A database error,
   * timeouts included, is printed as REPLAY267_ERROR after the rollback. A killed process
   * cannot roll back itself; the server aborts its open transaction when the connection drops.
   */
  const replay = (fixtures: Fx267[]): Replay267 => {
    const r = spawnSync(python, ['-c', [
      'import sys, os, json',
      `sys.path.insert(0, ${JSON.stringify(join(root, 'tools', 'migration'))})`,
      'import psycopg',
      'from common import replay_admin_overrides',
      'keys = json.loads(os.environ["AFLDB_ISSUE267_KEYS"])',
      'conn = None',
      'def snapshot():',
      '    with conn.cursor() as cur:',
      '        cur.execute("""',
      '            SELECT coalesce(jsonb_object_agg(m.match_key, jsonb_build_object(',
      "                       'match', to_jsonb(m),",
      "                       'periods', (SELECT coalesce(jsonb_agg(jsonb_build_array(",
      '                                              p.club_id, p.period, p.goals, p.behinds, p.points)',
      '                                            ORDER BY p.period, p.club_id), \'[]\'::jsonb)',
      '                                     FROM match_period_scores p WHERE p.match_id = m.id))),',
      "                   '{}'::jsonb)",
      '              FROM matches m WHERE m.match_key = ANY(%s)',
      '        """, (keys,))',
      '        return cur.fetchone()[0]',
      'out = {}',
      'try:',
      `    conn = psycopg.connect(os.environ["AFLDB_REPLAY_DSN"], connect_timeout=${REPLAY_CONNECT_TIMEOUT_S})`,
      '    with conn.cursor() as cur:',
      `        cur.execute("SET LOCAL lock_timeout = '${REPLAY_LOCK_TIMEOUT}'")`,
      `        cur.execute("SET LOCAL statement_timeout = '${REPLAY_STATEMENT_TIMEOUT}'")`,
      '    out["before"] = snapshot()',
      '    try:',
      '        replay_admin_overrides(conn, "matches")',
      '        out["first"] = snapshot()',
      '        replay_admin_overrides(conn, "matches")',
      '        out["second"] = snapshot()',
      '    except RuntimeError as exc:',
      '        out["refused"] = str(exc)',
      '        out["afterRefusal"] = snapshot()',
      'except psycopg.Error as exc:',
      '    print("REPLAY267_ERROR " + json.dumps({"type": type(exc).__name__,',
      '                                          "sqlstate": getattr(exc, "sqlstate", None),',
      '                                          "message": str(exc).strip()}), flush=True)',
      '    sys.exit(3)',
      'finally:',
      '    if conn is not None and not conn.closed:',
      '        try:',
      '            conn.rollback()',
      '        finally:',
      '            conn.close()',
      'print("REPLAY267 " + json.dumps(out))',
    ].join('\n')], {
      cwd: root,
      encoding: 'utf8',
      timeout: REPLAY_PROCESS_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      env: {
        ...process.env,
        AFLDB_REPLAY_DSN: process.env.AFLDB_TEST_DATABASE_URL,
        AFLDB_ISSUE267_KEYS: JSON.stringify(fixtures.map((f) => f.matchKey)),
      },
    });
    const output = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
    if (r.error) {
      throw new Error((r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT'
        ? `ISSUE-267 replay process exceeded ${REPLAY_PROCESS_TIMEOUT_MS} ms and was killed; `
          + `the server aborts its uncommitted transaction on disconnect.\n${output}`
        : `ISSUE-267 replay process could not run (${python}): ${r.error.message}\n${output}`);
    }
    if (r.signal) throw new Error(`ISSUE-267 replay process was terminated by ${r.signal}.\n${output}`);
    const failure = r.stdout.split(/\r?\n/).find((l) => l.startsWith('REPLAY267_ERROR '));
    if (failure) {
      throw new Error(`ISSUE-267 replay failed in the database and was rolled back (connect ${REPLAY_CONNECT_TIMEOUT_S} s, `
        + `lock ${REPLAY_LOCK_TIMEOUT}, statement ${REPLAY_STATEMENT_TIMEOUT}): ${failure.slice('REPLAY267_ERROR '.length)}`);
    }
    expect(r.status, output).toBe(0);
    const line = r.stdout.split(/\r?\n/).find((l) => l.startsWith('REPLAY267 '));
    expect(line, output).toBeDefined();
    return JSON.parse(line!.slice('REPLAY267 '.length)) as Replay267;
  };

  /** Replays that must succeed: not refused, and the second pass changes nothing. */
  const replayOk = (fixtures: Fx267[]) => {
    const out = replay(fixtures);
    expect(out.refused, 'the replay refused; a foreign afldb_test override may be the cause').toBeUndefined();
    expect(out.second, 'repeating the replay changes the result').toEqual(out.first);
    return out.first!;
  };

  const override = (fx: Fx267, fieldGroup: string, values: Record<string, unknown>, isActive = true) => sql`
    INSERT INTO data_overrides (entity_type, entity_key, field_group, override_values, admin_user_id, is_active)
    VALUES ('matches', ${fx.matchKey}, ${fieldGroup}, ${sql.json(values as never)}, ${adminUserId}, ${isActive})
  `;

  const overridesOf = async (fx: Fx267) => Object.fromEntries((await sql<{
    fieldGroup: string; overrideValues: Record<string, unknown>;
  }[]>`
    SELECT field_group AS "fieldGroup", override_values AS "overrideValues"
      FROM data_overrides
     WHERE entity_type = 'matches' AND entity_key = ${fx.matchKey} AND is_active
  `).map((row) => [row.fieldGroup, row.overrideValues]));

  /** Q1-Q3 as the source published them, and the final (Q4) row as given. */
  const periodsWith = (
    fx: Fx267,
    home: [number, number, number],
    away: [number, number, number],
  ): Period267[] => {
    const rows: Period267[] = [];
    for (const [period, hg, hb] of SOURCE_PERIODS_267.home.slice(0, 3)) {
      rows.push([fx.homeClubId, period, hg, hb, hg * 6 + hb]);
    }
    for (const [period, ag, ab] of SOURCE_PERIODS_267.away.slice(0, 3)) {
      rows.push([fx.awayClubId, period, ag, ab, ag * 6 + ab]);
    }
    rows.push([fx.homeClubId, 4, ...home], [fx.awayClubId, 4, ...away]);
    return rows.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  };

  /** Every final-period row equals its club's corrected match totals, with nothing NULL. */
  const expectFinalPeriodMatchesTotals = (state: Snapshot267[string], fx: Fx267) => {
    const m = state.match as Record<string, number>;
    const q4 = state.periods.filter((p) => p[1] === 4);
    expect(q4).toEqual(expect.arrayContaining([
      [fx.homeClubId, 4, m.home_goals, m.home_behinds, m.home_score],
      [fx.awayClubId, 4, m.away_goals, m.away_behinds, m.away_score],
    ]));
    expect(q4).toHaveLength(2);
  };

  /**
   * Census section 4, read from the operator census file itself and run as written, so the
   * test fails if the census and the Python preflight stop evaluating the same thing.
   */
  const censusUnderivable = async (): Promise<{ match_key: string; missing: string }[]> => {
    const census = readFileSync(join(root, 'issues', 'open', 'AFLDB-ISSUE-267-269-override-census.sql'), 'utf8');
    const section = /^\\echo '== 4\..*$([\s\S]*?)^\\echo '== 5\./m.exec(census);
    expect(section, 'census section 4 not found between its == 4. and == 5. markers').not.toBeNull();
    const statement = section![1].trim().replace(/;$/, '');
    return (await sql.unsafe(statement)) as unknown as { match_key: string; missing: string }[];
  };

  // The preflight reads only and deletes nothing; a refusal leaves cleanup a no-op.
  beforeAll(async () => {
    await preflight267();
  }, TIMEOUT);

  afterEach(async () => {
    await cleanup267();
  }, TIMEOUT);

  afterAll(async () => {
    if (!owned267.preflightPassed) return;
    await cleanup267();
    expect(await residue267()).toEqual(NO_RESIDUE_267);
  }, TIMEOUT);

  it.runIf(canReplay)('ISSUE-267: a one-field score edit keeps every unchanged component, and both final-period rows equal the corrected totals', async () => {
    const fx = await seedFixture267('one-field');
    const saved = await saveEdit267({
      entityKey: 'matches', rowId: fx.matchId, groupKey: 'score',
      raw: { home_goals: '16', home_behinds: '10', away_goals: '12', away_behinds: '8' },
      adminUserId, note: NOTE_267,
    });
    expect(saved).toMatchObject({ ok: true });
    // The score save derived the season's ladder, one row per fixture club, and cleanup owns it.
    expect([...owned267.clubSeasonClubIds].sort((a, b) => a - b))
      .toEqual([fx.homeClubId, fx.awayClubId].sort((a, b) => a - b));
    // The editor stores only what changed: this partial payload is the ISSUE-267 trigger.
    expect(await overridesOf(fx)).toEqual({ score: { home_goals: 16 } });

    await reloadSource267(fx);
    const after = replayOk([fx])[fx.matchKey];

    expect(after.match).toMatchObject({
      home_goals: 16, home_behinds: 10, home_score: 106,
      away_goals: 12, away_behinds: 8, away_score: 80,
      result: 'home_win', winner_club_id: fx.homeClubId, margin: 26,
    });
    // Q1-Q3 untouched; Q4 is complete for BOTH clubs (the defect wrote [16, NULL, NULL] and
    // an all-NULL away row).
    expect(after.periods).toEqual(periodsWith(fx, [16, 10, 106], [12, 8, 80]));
    expectFinalPeriodMatchesTotals(after, fx);
  }, TIMEOUT);

  it.runIf(canReplay)('ISSUE-269: an attendance edit and a partial score edit on one match both survive, with derived totals and final periods', async () => {
    const fx = await seedFixture267('two-groups');
    for (const [groupKey, raw] of [
      ['attendance', { attendance: '45000' }],
      ['score', { home_goals: '15', home_behinds: '10', away_goals: '16', away_behinds: '8' }],
    ] as const) {
      const saved = await saveEdit267({ entityKey: 'matches', rowId: fx.matchId, groupKey, raw, adminUserId, note: NOTE_267 });
      expect(saved).toMatchObject({ ok: true });
    }
    expect(await overridesOf(fx)).toEqual({ attendance: { attendance: 45000 }, score: { away_goals: 16 } });

    await reloadSource267(fx);
    const after = replayOk([fx])[fx.matchKey];

    const [manual] = await sql<{ id: number }[]>`SELECT id::int AS id FROM sources WHERE key = 'manual_admin_edit'`;
    // Both groups applied (UPDATE ... FROM applied only one of the two rows). The away side
    // now wins: result, winner and margin are re-derived from the merged components.
    expect(after.match).toMatchObject({
      attendance: 45000, attendance_status: 'complete', attendance_source_id: manual.id,
      home_goals: 15, home_behinds: 10, home_score: 100,
      away_goals: 16, away_behinds: 8, away_score: 104,
      result: 'away_win', winner_club_id: fx.awayClubId, margin: 4,
    });
    expect(after.periods).toEqual(periodsWith(fx, [15, 10, 100], [16, 8, 104]));
    expectFinalPeriodMatchesTotals(after, fx);
  }, TIMEOUT);

  it.runIf(canReplay)('equal-authority overrides that disagree are refused before any write', async () => {
    const fx = await seedFixture267('conflict');
    // Not reachable through the editor (its field groups are disjoint), but a legacy or
    // hand-written row can carry a field outside its group; there is no honest winner.
    await override(fx, 'score', { home_goals: 16 });
    await override(fx, 'attendance', { attendance: 45000, home_goals: 17 });

    const out = replay([fx]);
    expect(out.refused).toContain('replay_admin_overrides(matches): refusing to commit');
    expect(out.refused).toContain(`match ${fx.matchKey} field 'home_goals'`);
    expect(out.first).toBeUndefined();
    // Observed in the SAME transaction after the refusal: nothing of the fixture was written,
    // neither the agreeing attendance nor the period rows.
    expect(out.afterRefusal).toEqual(out.before);
    expect(out.before[fx.matchKey].match).toMatchObject({ home_goals: 15, attendance: null });
  }, TIMEOUT);

  it.runIf(canReplay)('identical overlapping values merge; an inactive override contributes nothing', async () => {
    const fx = await seedFixture267('overlap');
    await override(fx, 'score', { home_goals: 16 });
    await override(fx, 'attendance', { attendance: 45000, home_goals: 16 });
    // Inactive, and it disagrees on home_goals: excluded from the merge AND from the refusal.
    await override(fx, 'notes', { notes: 'ISSUE-267 inactive override', home_goals: 3 }, false);

    const after = replayOk([fx])[fx.matchKey];

    expect(after.match).toMatchObject({
      attendance: 45000, notes: null,
      home_goals: 16, home_behinds: 10, home_score: 106,
      away_goals: 12, away_behinds: 8, away_score: 80, margin: 26,
    });
    expect(after.periods).toEqual(periodsWith(fx, [16, 10, 106], [12, 8, 80]));
    expectFinalPeriodMatchesTotals(after, fx);
  }, TIMEOUT);

  it.runIf(canReplay)('a score component neither the source nor the override records is refused, never written as zero', async () => {
    const fx = await seedFixture267('unrecorded', { homeBehinds: null });
    await override(fx, 'score', { home_goals: 16 });

    // The census classifies it exactly as the replay preflight does.
    expect(await censusUnderivable()).toContainEqual(expect.objectContaining({ match_key: fx.matchKey, missing: 'home_behinds' }));

    const out = replay([fx]);
    expect(out.refused).toContain('lack a score component the override does not supply');
    expect(out.refused).toContain(`match ${fx.matchKey} -- home_behinds`);
    expect(out.afterRefusal).toEqual(out.before);
    expect(out.before[fx.matchKey].match).toMatchObject({ home_goals: 15, home_behinds: null, home_score: 100 });
  }, TIMEOUT);

  it.runIf(canReplay)('a component the source lacks but another active group supplies is derived from the merge: the replay succeeds and census section 4 agrees', async () => {
    const fx = await seedFixture267('merged-component', { homeBehinds: null });
    await override(fx, 'score', { home_goals: 16 });
    // A legacy or hand-written row outside its group (the editor's groups are disjoint) carries
    // the component the source does not record. Different keys: no disagreement.
    await override(fx, 'attendance', { attendance: 45000, home_behinds: 11 });

    // Reading the score row alone would call this underivable; the merged evaluation does not.
    expect((await censusUnderivable()).map((row) => row.match_key)).not.toContain(fx.matchKey);

    const out = replay([fx]);
    expect(out.refused, 'the replay refused; a foreign afldb_test override may be the cause').toBeUndefined();
    expect(out.second, 'repeating the replay changes the result').toEqual(out.first);
    const after = out.first![fx.matchKey];
    expect(after.match).toMatchObject({
      attendance: 45000,
      home_goals: 16, home_behinds: 11, home_score: 107,
      away_goals: 12, away_behinds: 8, away_score: 80,
      result: 'home_win', winner_club_id: fx.homeClubId, margin: 27,
    });
    // Q1-Q3 keep their "not recorded" home behinds; only the final period is re-derived.
    const early = (state: Snapshot267[string]) => state.periods.filter((p) => p[1] < 4);
    expect(early(after)).toEqual(early(out.before[fx.matchKey]));
    expectFinalPeriodMatchesTotals(after, fx);
  }, TIMEOUT);
});
