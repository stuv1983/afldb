import 'server-only';

import postgres from 'postgres';
import { authSql } from '@/db/authClient';

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

export async function createAwardWinner(input: CreateAwardWinnerInput): Promise<{ id: number }> {
  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL || process.env.DATABASE_URL;
  if (!importUrl) throw new Error('AFLDB_IMPORT_DATABASE_URL is not configured.');

  const importSql = postgres(importUrl, { max: 1, onnotice: () => {} });

  try {
    const created = await importSql.begin(async (tx) => {
      // 1. Resolve player display name if playerId provided
      let playerName = input.playerNameRaw?.trim() || '';
      if (input.playerId) {
        const [p] = await tx<{ displayName: string }[]>`SELECT display_name AS "displayName" FROM players WHERE id = ${input.playerId}`;
        if (p) playerName = p.displayName;
      }
      if (!playerName) throw new Error('Player name is required.');

      // 2. Resolve club name if clubId provided
      let clubNameRaw = input.clubNameRaw?.trim() || null;
      if (input.clubId) {
        const [c] = await tx<{ name: string }[]>`SELECT name FROM clubs WHERE id = ${input.clubId}`;
        if (c) clubNameRaw = c.name;
      }

      const linkStatus = input.playerId ? 'resolved' : 'unmatched';

      const [row] = await tx<{ id: number }[]>`
        INSERT INTO award_winners (
          award_id, season, player_id, player_name_raw, link_status_value,
          club_id, club_name_raw, votes, position, is_captain, is_vice_captain,
          note
        ) VALUES (
          ${input.awardId}, ${input.season}, ${input.playerId ?? null}, ${playerName},
          ${linkStatus}::link_status, ${input.clubId ?? null}, ${clubNameRaw},
          ${input.votes ?? null}, ${input.position?.trim() || null},
          ${input.isCaptain ?? false}, ${input.isViceCaptain ?? false},
          ${input.note?.trim() || null}
        )
        RETURNING id
      `;

      return row;
    });

    // Audit in data_edits
    try {
      await authSql`
        INSERT INTO data_edits (table_name, row_id, field_group, old_values, new_values, admin_user_id, note)
        VALUES ('award_winners', ${created.id}, 'award_winner', '{}'::jsonb,
                ${authSql.json({ awardId: input.awardId, season: input.season, playerId: input.playerId })},
                ${input.adminUserId}, ${input.note?.trim() || null})
      `;
    } catch (auditErr) {
      console.error('Failed to log audit row for award winner creation', auditErr);
    }

    return created;
  } finally {
    await importSql.end({ timeout: 5 });
  }
}

export async function createHallOfFameInductee(input: CreateHallOfFameInducteeInput): Promise<{ id: number }> {
  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL || process.env.DATABASE_URL;
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
          ${input.category?.trim() || 'Player'}, ${input.inductedYear},
          ${input.isLegend ?? false}, ${input.legendYear ?? null},
          ${input.clubNameRaw?.trim() || null}, ${input.state?.trim() || null},
          ${input.playingCareer?.trim() || null}, ${input.notes?.trim() || null}
        )
        RETURNING id
      `;

      return row;
    });

    // Audit in data_edits
    try {
      await authSql`
        INSERT INTO data_edits (table_name, row_id, field_group, old_values, new_values, admin_user_id, note)
        VALUES ('hall_of_fame', ${created.id}, 'hall_of_fame', '{}'::jsonb,
                ${authSql.json({ name: input.name, year: input.inductedYear, playerId: input.playerId })},
                ${input.adminUserId}, ${input.notes?.trim() || null})
      `;
    } catch (auditErr) {
      console.error('Failed to log audit row for hall of fame inductee creation', auditErr);
    }

    return created;
  } finally {
    await importSql.end({ timeout: 5 });
  }
}

export async function createHonourTeamMember(input: CreateHonourTeamMemberInput): Promise<{ id: number }> {
  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL || process.env.DATABASE_URL;
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

      const [row] = await tx<{ id: number }[]>`
        INSERT INTO honour_team_members (
          team_name, player_id, player_name_raw, link_status_value,
          position, role, club_name_raw, sort_order, note
        ) VALUES (
          ${teamName}, ${input.playerId ?? null}, ${playerName}, ${linkStatus}::link_status,
          ${input.position?.trim() || null}, ${input.role?.trim() || null},
          ${input.clubNameRaw?.trim() || null}, ${sortOrder},
          ${input.note?.trim() || null}
        )
        ON CONFLICT (team_name, player_name_raw) DO UPDATE SET
          player_id = EXCLUDED.player_id,
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

    // Audit in data_edits
    try {
      await authSql`
        INSERT INTO data_edits (table_name, row_id, field_group, old_values, new_values, admin_user_id, note)
        VALUES ('honour_team_members', ${created.id}, 'honour_team', '{}'::jsonb,
                ${authSql.json({ teamName: input.teamName, playerName: input.playerNameRaw, playerId: input.playerId })},
                ${input.adminUserId}, ${input.note?.trim() || null})
      `;
    } catch (auditErr) {
      console.error('Failed to log audit row for honour team member creation', auditErr);
    }

    return created;
  } finally {
    await importSql.end({ timeout: 5 });
  }
}
