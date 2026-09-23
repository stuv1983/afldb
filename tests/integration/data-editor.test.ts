import './guard';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { sql } from '@/db/client';
import { saveEdit } from '@/db/queries/data-edits';
import { saveMatchSheet } from '@/db/queries/match-sheet';
import { createPlayerInTransaction } from '@/db/queries/players';
import { recomputeClubSeasons } from '@/db/queries/player-derived';
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
  `Restricted Data Editor role parity (AFLDB-ISSUE-083/-109)${roleParitySuffix}`,
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
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toBe(BROWNLOW_MATCH_SHEET_REFUSAL);

    await expectNothingWritten(before);
  });
});
