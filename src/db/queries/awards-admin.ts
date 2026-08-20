import 'server-only';

import { randomUUID } from 'node:crypto';

import postgres from 'postgres';
import { authSql } from '@/db/authClient';

const MANUAL_ADMIN_SOURCE_KEY = 'manual_admin_edit';
const BROWNLOW_AWARD_SLUG = 'brownlow-medal';
const HALL_OF_FAME_CATEGORIES = new Set([
  'Player',
  'Coach',
  'Umpire',
  'Media',
  'Administrator',
  'Pioneer',
]);

type AwardDefinition = {
  slug: string;
  name: string;
  category: string;
  awardClubId: number | null;
  seasonClubId: number | null;
  seasonClubName: string | null;
};

type SelectedClubIdentity = {
  selectedClubId: number;
  seasonClubId: number | null;
  seasonClubName: string | null;
};

export type CreateHonourRecordResult = {
  id: number;
  /** The statistical row committed, but its separate-role audit write failed. */
  auditWarning?: string;
};

const AUDIT_WARNING =
  'The record was created, but its data-edits audit snapshot could not be written. '
  + 'Do not submit it again; ask an administrator to reconcile the audit log.';

export type CreateAwardWinnerInput = {
  awardId: number;
  season: number;
  playerId?: number | null;
  playerNameRaw?: string | null;
  clubId?: number | null;
  clubNameRaw?: string | null;
  votes?: number | null;
  position?: string | null;
  isCaptain?: boolean;
  isViceCaptain?: boolean;
  note?: string | null;
  adminUserId: number;
};

export type CreateHallOfFameInducteeInput = {
  name: string;
  playerId?: number | null;
  category?: string | null;
  inductedYear: number;
  isLegend?: boolean;
  legendYear?: number | null;
  clubNameRaw?: string | null;
  state?: string | null;
  playingCareer?: string | null;
  notes?: string | null;
  adminUserId: number;
};

export type CreateHonourTeamMemberInput = {
  teamName: string;
  playerId?: number | null;
  playerNameRaw?: string | null;
  position?: string | null;
  role?: string | null;
  clubNameRaw?: string | null;
  sortOrder?: number;
  note?: string | null;
  adminUserId: number;
};

/**
 * Super Admin operations for Awards, Hall of Fame, and Honour/Representative Teams (see changeLog.md).
 */

export async function createAwardWinner(input: CreateAwardWinnerInput): Promise<CreateHonourRecordResult> {
  if (!Number.isInteger(input.awardId) || input.awardId <= 0) {
    throw new Error('Award ID must be a positive integer.');
  }
  if (!Number.isInteger(input.season) || input.season < 1897 || input.season > 2100) {
    throw new Error('Award season must be from 1897 to 2100.');
  }
  if (
    input.votes != null
    && (!Number.isFinite(input.votes) || input.votes < 0 || input.votes > 999_999.99)
  ) {
    throw new Error('Award votes or statistic must be from 0 to 999999.99.');
  }
  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!importUrl) throw new Error('AFLDB_IMPORT_DATABASE_URL is not configured.');

  const importSql = postgres(importUrl, { max: 1, onnotice: () => {} });

  try {
    const created = await importSql.begin(async (tx) => {
      const [award] = await tx<AwardDefinition[]>`
        SELECT a.slug, a.name, a.category,
               a.club_id AS "awardClubId",
               season_club.id AS "seasonClubId",
               season_club.name AS "seasonClubName"
          FROM awards a
          LEFT JOIN clubs award_club ON award_club.id = a.club_id
          LEFT JOIN clubs season_club
            ON season_club.id = afldb_identity_for_season(
                 award_club.organization_id,
                 ${input.season}::smallint
               )
         WHERE a.id = ${input.awardId}
      `;
      if (!award) throw new Error('The selected award does not exist.');
      if (award.slug === BROWNLOW_AWARD_SLUG) {
        throw new Error(
          'Brownlow Medal winners must be recorded in authoritative brownlow_season_votes, not award_winners.',
        );
      }

      const [manualSource] = await tx<{ id: number }[]>`
        SELECT id FROM sources WHERE key = ${MANUAL_ADMIN_SOURCE_KEY}
      `;
      if (!manualSource) {
        throw new Error(`Required source '${MANUAL_ADMIN_SOURCE_KEY}' is not configured.`);
      }
      const sourceRecordId = `award_winner:${randomUUID()}`;

      // 1. Resolve player display name if playerId provided
      let playerName = input.playerNameRaw?.trim() || '';
      if (input.playerId) {
        const [p] = await tx<{ displayName: string }[]>`SELECT display_name AS "displayName" FROM players WHERE id = ${input.playerId}`;
        if (p) playerName = p.displayName;
      }
      if (!playerName) throw new Error('Player name is required.');

      // 2. Resolve the club. A club best-and-fairest belongs to the award
      // definition's organization and must carry the identity active in the
      // winner's season (for example Footscray rather than Western Bulldogs
      // in 1980).
      let clubId = input.clubId ?? null;
      let clubNameRaw = input.clubNameRaw?.trim() || null;
      if (award.category === 'club_best_and_fairest') {
        if (award.awardClubId === null) {
          throw new Error(`Club best-and-fairest award '${award.name}' has no club definition.`);
        }
        if (award.seasonClubId === null || award.seasonClubName === null) {
          throw new Error(`Award '${award.name}' has no club identity active in season ${input.season}.`);
        }
        if (clubId !== null && clubId !== award.seasonClubId) {
          throw new Error(
            `Award '${award.name}' must use ${award.seasonClubName} (club #${award.seasonClubId}) in ${input.season}.`,
          );
        }
        clubId = award.seasonClubId;
        clubNameRaw = award.seasonClubName;
      } else if (clubId !== null) {
        const [selectedClub] = await tx<SelectedClubIdentity[]>`
          SELECT selected_club.id AS "selectedClubId",
                 season_club.id AS "seasonClubId",
                 season_club.name AS "seasonClubName"
            FROM clubs selected_club
            LEFT JOIN clubs season_club
              ON season_club.id = afldb_identity_for_season(
                   selected_club.organization_id,
                   ${input.season}::smallint
                 )
           WHERE selected_club.id = ${clubId}
        `;
        if (!selectedClub) throw new Error('The selected club does not exist.');
        if (selectedClub.seasonClubId === null || selectedClub.seasonClubName === null) {
          throw new Error(`The selected club has no identity active in season ${input.season}.`);
        }
        if (clubId !== selectedClub.seasonClubId) {
          throw new Error(
            `${selectedClub.seasonClubName} (club #${selectedClub.seasonClubId}) is the identity active in ${input.season}.`,
          );
        }
        clubNameRaw = selectedClub.seasonClubName;
      }

      const linkStatus = input.playerId ? 'resolved' : 'unmatched';

      const [row] = await tx<{ id: number }[]>`
        INSERT INTO award_winners (
          award_id, season, player_id, player_name_raw, link_status_value,
          club_id, club_name_raw, votes, position, is_captain, is_vice_captain,
          note, source_id, source_record_id
        ) VALUES (
          ${input.awardId}, ${input.season}, ${input.playerId ?? null}, ${playerName},
          ${linkStatus}::link_status, ${clubId}, ${clubNameRaw},
          ${input.votes ?? null}, ${input.position?.trim() || null},
          ${input.isCaptain ?? false}, ${input.isViceCaptain ?? false},
          ${input.note?.trim() || null}, ${manualSource.id}, ${sourceRecordId}
        )
        RETURNING id
      `;

      return { ...row, clubId };
    });

    try {
      await authSql`
        INSERT INTO data_edits (table_name, row_id, field_group, old_values, new_values, admin_user_id, note)
        VALUES ('award_winners', ${created.id}, 'award_winner', '{}'::jsonb,
                ${authSql.json({
                  awardId: input.awardId,
                  season: input.season,
                  playerId: input.playerId,
                  clubId: created.clubId,
                })},
                ${input.adminUserId}, ${input.note?.trim() || null})
      `;
      return { id: created.id };
    } catch (error) {
      console.error('Failed to log data-edits audit row for award winner creation', error);
      return { id: created.id, auditWarning: AUDIT_WARNING };
    }
  } finally {
    await importSql.end({ timeout: 5 });
  }
}

export async function createHallOfFameInductee(
  input: CreateHallOfFameInducteeInput,
): Promise<CreateHonourRecordResult> {
  const category = input.category?.trim() || 'Player';
  if (!HALL_OF_FAME_CATEGORIES.has(category)) {
    throw new Error('Invalid Hall of Fame category.');
  }
  if (!Number.isInteger(input.inductedYear) || input.inductedYear < 1996 || input.inductedYear > 2100) {
    throw new Error('Inducted year must be from 1996 to 2100.');
  }
  if (input.isLegend) {
    if (
      !Number.isInteger(input.legendYear)
      || (input.legendYear as number) < input.inductedYear
      || (input.legendYear as number) > 2100
    ) {
      throw new Error('Legend year must be from the induction year to 2100.');
    }
  }
  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!importUrl) throw new Error('AFLDB_IMPORT_DATABASE_URL is not configured.');

  const importSql = postgres(importUrl, { max: 1, onnotice: () => {} });

  try {
    const created = await importSql.begin(async (tx) => {
      let name = input.name.trim();
      if (input.playerId) {
        const [p] = await tx<{ displayName: string }[]>`SELECT display_name AS "displayName" FROM players WHERE id = ${input.playerId}`;
        if (p) name = p.displayName;
      }
      if (!name) throw new Error('Inductee name is required.');

      const linkStatus = input.playerId ? 'resolved' : 'unmatched';

      const [row] = await tx<{ id: number }[]>`
        INSERT INTO hall_of_fame (
          name, player_id, link_status_value, category, inducted_year,
          is_legend, legend_year, club_name_raw, state, playing_career,
          notes
        ) VALUES (
          ${name}, ${input.playerId ?? null}, ${linkStatus}::link_status,
          ${category}, ${input.inductedYear},
          ${input.isLegend ?? false}, ${input.legendYear ?? null},
          ${input.clubNameRaw?.trim() || null}, ${input.state?.trim() || null},
          ${input.playingCareer?.trim() || null}, ${input.notes?.trim() || null}
        )
        RETURNING id
      `;

      return row;
    });

    try {
      await authSql`
        INSERT INTO data_edits (table_name, row_id, field_group, old_values, new_values, admin_user_id, note)
        VALUES ('hall_of_fame', ${created.id}, 'hall_of_fame', '{}'::jsonb,
                ${authSql.json({ name: input.name, year: input.inductedYear, playerId: input.playerId })},
                ${input.adminUserId}, ${input.notes?.trim() || null})
      `;
      return created;
    } catch (error) {
      console.error('Failed to log data-edits audit row for Hall of Fame creation', error);
      return { ...created, auditWarning: AUDIT_WARNING };
    }
  } finally {
    await importSql.end({ timeout: 5 });
  }
}

export async function createHonourTeamMember(
  input: CreateHonourTeamMemberInput,
): Promise<CreateHonourRecordResult> {
  if (input.sortOrder != null && (
    !Number.isInteger(input.sortOrder)
    || input.sortOrder < 0
    || input.sortOrder > 50
  )) {
    throw new Error('Lineup order must be a whole number from 0 to 50.');
  }
  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!importUrl) throw new Error('AFLDB_IMPORT_DATABASE_URL is not configured.');

  const importSql = postgres(importUrl, { max: 1, onnotice: () => {} });

  try {
    const created = await importSql.begin(async (tx) => {
      let playerName = input.playerNameRaw?.trim() || '';
      if (input.playerId) {
        const [p] = await tx<{ displayName: string }[]>`SELECT display_name AS "displayName" FROM players WHERE id = ${input.playerId}`;
        if (p) playerName = p.displayName;
      }
      if (!playerName) throw new Error('Player name is required.');

      const teamName = input.teamName.trim();
      if (!teamName) throw new Error('Team name is required.');

      const linkStatus = input.playerId ? 'resolved' : 'unmatched';
      const sortOrder = Number.isInteger(input.sortOrder) ? Number(input.sortOrder) : 0;

      const [row] = input.playerId
        ? await tx<{ id: number }[]>`
            INSERT INTO honour_team_members (
              team_name, player_id, player_name_raw, link_status_value,
              position, role, club_name_raw, sort_order, note
            ) VALUES (
              ${teamName}, ${input.playerId}, ${playerName}, ${linkStatus}::link_status,
              ${input.position?.trim() || null}, ${input.role?.trim() || null},
              ${input.clubNameRaw?.trim() || null}, ${sortOrder},
              ${input.note?.trim() || null}
            )
            ON CONFLICT (team_name, player_id) WHERE player_id IS NOT NULL DO UPDATE SET
              player_name_raw = EXCLUDED.player_name_raw,
              link_status_value = EXCLUDED.link_status_value,
              position = EXCLUDED.position,
              role = EXCLUDED.role,
              club_name_raw = EXCLUDED.club_name_raw,
              sort_order = EXCLUDED.sort_order,
              note = EXCLUDED.note
            RETURNING id
          `
        : await tx<{ id: number }[]>`
            INSERT INTO honour_team_members (
              team_name, player_id, player_name_raw, link_status_value,
              position, role, club_name_raw, sort_order, note
            ) VALUES (
              ${teamName}, NULL, ${playerName}, ${linkStatus}::link_status,
              ${input.position?.trim() || null}, ${input.role?.trim() || null},
              ${input.clubNameRaw?.trim() || null}, ${sortOrder},
              ${input.note?.trim() || null}
            )
            ON CONFLICT (team_name, player_name_raw) WHERE player_id IS NULL DO UPDATE SET
              link_status_value = EXCLUDED.link_status_value,
              position = EXCLUDED.position,
              role = EXCLUDED.role,
              club_name_raw = EXCLUDED.club_name_raw,
              sort_order = EXCLUDED.sort_order,
              note = EXCLUDED.note
            RETURNING id
          `;

      return row;
    });

    try {
      await authSql`
        INSERT INTO data_edits (table_name, row_id, field_group, old_values, new_values, admin_user_id, note)
        VALUES ('honour_team_members', ${created.id}, 'honour_team', '{}'::jsonb,
                ${authSql.json({ teamName: input.teamName, playerName: input.playerNameRaw, playerId: input.playerId })},
                ${input.adminUserId}, ${input.note?.trim() || null})
      `;
      return created;
    } catch (error) {
      console.error('Failed to log data-edits audit row for honour-team creation', error);
      return { ...created, auditWarning: AUDIT_WARNING };
    }
  } finally {
    await importSql.end({ timeout: 5 });
  }
}
