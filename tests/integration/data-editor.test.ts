import './guard';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { sql } from '@/db/client';
import { saveMatchSheet } from '@/db/queries/match-sheet';
import { recomputeClubSeasons } from '@/db/queries/player-derived';
import { createImportRoleParityHarness } from './import-role-parity';

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
];
let adminUserId = 0;
let createdThrowawayAdmin = false;

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
});

afterAll(async () => {
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
  await sql.end();
});

describe('Data Editor - Match Sheet Delta Tests', () => {
  it('propagates kicks correctly', async () => {
    // 1. Find a match to test
    const [match] = await sql<{ id: number; season: number; home_club_id: number; away_club_id: number }[]>`
      SELECT id, season, home_club_id, away_club_id FROM matches LIMIT 1
    `;
    expect(match).toBeDefined();

    // 2. Find a player in this match
    const [playerStat] = await sql<{ player_id: number; club_id: number; kicks: number; disposals: number; jumper_number: string }[]>`
      SELECT player_id, club_id, kicks, disposals, jumper_number
        FROM player_match_stats
       WHERE match_id = ${match.id}
       LIMIT 1
    `;
    expect(playerStat).toBeDefined();

    // 3. Get baseline season/career stats
    const [seasonBaseline] = await sql<{ kicks: number; disposals: number }[]>`
      SELECT kicks, disposals FROM player_season_stats
       WHERE player_id = ${playerStat.player_id} AND season = ${match.season}
    `;
    const [careerBaseline] = await sql<{ kicks: number; disposals: number }[]>`
      SELECT kicks, disposals FROM player_career_stats
       WHERE player_id = ${playerStat.player_id}
    `;

    // 4. Mutate
    const newKicks = (playerStat.kicks || 0) + 1;
    const result = await saveMatchSheet({
      matchId: match.id,
      syncMatchScores: false,
      players: [
        {
          playerId: playerStat.player_id,
          clubId: playerStat.club_id,
          jumperNumber: playerStat.jumper_number,
          kicks: newKicks,
        }
      ],
      adminUserId,
      note: 'test mutation',
    });

    expect(result.ok).toBe(true);
    
    // Check derivation
    const [updatedStat] = await sql<{ kicks: number; disposals: number }[]>`
      SELECT kicks, disposals FROM player_match_stats
       WHERE match_id = ${match.id} AND player_id = ${playerStat.player_id}
    `;
    expect(updatedStat.kicks).toBe(newKicks);

    // 5. Restore original state so I don't leave db mutated for other tests.
    await saveMatchSheet({
      matchId: match.id,
      syncMatchScores: false,
      players: [
        {
          playerId: playerStat.player_id,
          clubId: playerStat.club_id,
          jumperNumber: playerStat.jumper_number,
          kicks: playerStat.kicks,
        }
      ],
      adminUserId,
      note: 'restore',
    });
  });
});

describe('Atomic required audit (AFLDB-ISSUE-027)', () => {
  async function pickMatchAndPlayer() {
    const [playerStat] = await sql<{
      matchId: number;
      playerId: number;
      clubId: number;
      kicks: number | null;
      jumperNumber: string | null;
    }[]>`
      SELECT match_id AS "matchId", player_id AS "playerId", club_id AS "clubId",
             kicks, jumper_number AS "jumperNumber"
        FROM player_match_stats
       ORDER BY match_id, player_id
       LIMIT 1
    `;
    expect(playerStat).toBeDefined();
    return playerStat;
  }

  it('persists the match-sheet mutation and its data_edits audit together', async () => {
    const stat = await pickMatchAndPlayer();

    const result = await saveMatchSheet({
      matchId: stat.matchId,
      syncMatchScores: false,
      players: [{
        playerId: stat.playerId,
        clubId: stat.clubId,
        jumperNumber: stat.jumperNumber ?? undefined,
        kicks: (stat.kicks ?? 0) + 1,
      }],
      adminUserId,
      note: 'issue-027 atomic audit test',
    });
    expect(result.ok).toBe(true);

    const [auditRow] = await sql<{ tableName: string; adminUserId: number }[]>`
      SELECT table_name AS "tableName", admin_user_id AS "adminUserId"
        FROM data_edits
       WHERE table_name = 'matches' AND row_id = ${stat.matchId}
         AND field_group = 'match_sheet' AND note = 'issue-027 atomic audit test'
    `;
    expect(auditRow).toBeDefined();
    expect(auditRow.adminUserId).toBe(adminUserId);

    // Restore the original statistic; this write audits under the same note.
    const restore = await saveMatchSheet({
      matchId: stat.matchId,
      syncMatchScores: false,
      players: [{
        playerId: stat.playerId,
        clubId: stat.clubId,
        jumperNumber: stat.jumperNumber ?? undefined,
        kicks: stat.kicks,
      }],
      adminUserId,
      note: 'issue-027 atomic audit test',
    });
    expect(restore.ok).toBe(true);
  });

  it('rolls the statistical mutation back when the required audit cannot be written', async () => {
    const stat = await pickMatchAndPlayer();
    const impossibleAdminId = 2_147_483_647;
    const [collision] = await sql<{ id: number }[]>`
      SELECT id FROM auth_users WHERE id = ${impossibleAdminId}
    `;
    expect(collision).toBeUndefined();

    // The audit INSERT violates data_edits_admin_user_id_fkey inside the
    // mutation transaction, so the whole save must fail...
    const result = await saveMatchSheet({
      matchId: stat.matchId,
      syncMatchScores: false,
      players: [{
        playerId: stat.playerId,
        clubId: stat.clubId,
        jumperNumber: stat.jumperNumber ?? undefined,
        kicks: (stat.kicks ?? 0) + 5,
      }],
      adminUserId: impossibleAdminId,
      note: 'issue-027 must not persist',
    });
    expect(result.ok).toBe(false);

    // ...leaving the statistical row untouched...
    const [after] = await sql<{ kicks: number | null }[]>`
      SELECT kicks FROM player_match_stats
       WHERE match_id = ${stat.matchId} AND player_id = ${stat.playerId}
    `;
    expect(after.kicks).toBe(stat.kicks);

    // ...and no audit row behind.
    const orphans = await sql<{ id: number }[]>`
      SELECT id FROM data_edits WHERE note = 'issue-027 must not persist'
    `;
    expect(orphans).toHaveLength(0);
  });
});

describe.skipIf(!importRole.isConfigured)(
  `Atomic required audit role parity (AFLDB-ISSUE-083)${roleParitySuffix}`,
  () => {
    beforeAll(() => importRole.validate());

    it('commits the production match-sheet and migration-066 audit path as afldb_import', async () => {
      const [stat] = await sql<{
        matchId: number;
        playerId: number;
        clubId: number;
        kicks: number | null;
        jumperNumber: string | null;
      }[]>`
        SELECT match_id AS "matchId", player_id AS "playerId", club_id AS "clubId",
               kicks, jumper_number AS "jumperNumber"
          FROM player_match_stats
         ORDER BY match_id, player_id
         LIMIT 1
      `;
      expect(stat).toBeDefined();

      const note = 'issue-083 restricted import-role audit proof';
      const result = await importRole.withImportDsn(() => saveMatchSheet({
        matchId: stat.matchId,
        syncMatchScores: false,
        players: [{
          playerId: stat.playerId,
          clubId: stat.clubId,
          jumperNumber: stat.jumperNumber ?? undefined,
          kicks: stat.kicks,
        }],
        adminUserId,
        note,
      }));
      expect(result).toMatchObject({ ok: true });

      const [audit] = await sql<{ id: number }[]>`
        SELECT id FROM data_edits
         WHERE admin_user_id = ${adminUserId}
           AND table_name = 'matches'
           AND row_id = ${stat.matchId}
           AND field_group = 'match_sheet'
           AND note = ${note}
         ORDER BY id DESC
         LIMIT 1
      `;
      expect(audit).toBeDefined();
      await sql`DELETE FROM data_edits WHERE id = ${audit.id}`;
    });
  },
);

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
    const [row] = await importSql<{ season: number }[]>`
      SELECT cs.season
        FROM club_seasons cs
        JOIN seasons se ON se.year = cs.season
       WHERE se.status = 'complete'
         AND EXISTS (SELECT 1 FROM staging.team_seasons st WHERE st.season = cs.season)
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

  it('fails closed when the canonical staging ladder is missing', async () => {
    const season = await pickCompleteSeason();
    await inRolledBackTransaction(async (tx) => {
      const [{ count: storedBefore }] = await tx<{ count: string }[]>`
        SELECT count(*) AS count FROM club_seasons WHERE season = ${season}
      `;
      expect(Number(storedBefore)).toBeGreaterThan(0);

      await tx`DELETE FROM staging.team_seasons WHERE season = ${season}`;

      await expect(recomputeClubSeasons(tx, season)).rejects.toThrow(
        /no canonical staging\.team_seasons rows/,
      );

      const [{ count: storedAfter }] = await tx<{ count: string }[]>`
        SELECT count(*) AS count FROM club_seasons WHERE season = ${season}
      `;
      expect(storedAfter).toBe(storedBefore);
    });
  });
});
