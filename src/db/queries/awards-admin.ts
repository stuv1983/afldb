import 'server-only';

import { randomUUID } from 'node:crypto';

import postgres from 'postgres';
import { recordDataEdit } from '@/db/queries/audit-log';

const MANUAL_ADMIN_SOURCE_KEY = 'manual_admin_edit';
const BROWNLOW_AWARD_SLUG = 'brownlow-medal';

// Transaction-scoped advisory lock serialising every writer that can change
// honour_team_members identity (AFLDB-ISSUE-080 §5.3). Migration 059's partial
// unique indexes leave the two mixed linked/unlinked same-name collisions with
// no database backstop, so the collision check and the INSERT must share one
// protected transaction. The two constants are the frozen cross-language lock
// identity: they must remain byte-identical to HONOUR_TEAM_LOCK_NAMESPACE /
// HONOUR_TEAM_LOCK_KEY in tools/migration/import_awards.py. Never derive them
// by hashing a string — the two implementations must contend on identical
// literals. The admin path uses the try form (a web request must not block
// behind a multi-minute reload); the importer uses the blocking form.
const HONOUR_TEAM_LOCK_NAMESPACE = 717275; // 0xAF1DB — AFLDB advisory-lock namespace
const HONOUR_TEAM_LOCK_KEY = 1; // honour_team_members identity writers
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
};

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

      // Required audit, same transaction: a failed insert rolls the
      // award-winner creation back (AFLDB-ISSUE-027).
      await recordDataEdit(tx, {
        tableName: 'award_winners',
        rowId: row.id,
        fieldGroup: 'award_winner',
        oldValues: {},
        newValues: {
          awardId: input.awardId,
          season: input.season,
          playerId: input.playerId,
          clubId,
        },
        adminUserId: input.adminUserId,
        note: input.note,
      });

      return row;
    });

    return { id: created.id };
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
      // Admin-created rows assert their provenance so a scoped source reload
      // can never claim them (AFLDB-ISSUE-080).
      const [manualSource] = await tx<{ id: number }[]>`
        SELECT id FROM sources WHERE key = ${MANUAL_ADMIN_SOURCE_KEY}
      `;
      if (!manualSource) {
        throw new Error(`Required source '${MANUAL_ADMIN_SOURCE_KEY}' is not configured.`);
      }

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
          notes, source_id
        ) VALUES (
          ${name}, ${input.playerId ?? null}, ${linkStatus}::link_status,
          ${category}, ${input.inductedYear},
          ${input.isLegend ?? false}, ${input.legendYear ?? null},
          ${input.clubNameRaw?.trim() || null}, ${input.state?.trim() || null},
          ${input.playingCareer?.trim() || null}, ${input.notes?.trim() || null},
          ${manualSource.id}
        )
        RETURNING id
      `;

      // Required audit, same transaction: a failed insert rolls the
      // induction back (AFLDB-ISSUE-027).
      await recordDataEdit(tx, {
        tableName: 'hall_of_fame',
        rowId: row.id,
        fieldGroup: 'hall_of_fame',
        oldValues: {},
        newValues: { name: input.name, year: input.inductedYear, playerId: input.playerId },
        adminUserId: input.adminUserId,
        note: input.notes,
      });

      return row;
    });

    return created;
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
      // AFLDB-ISSUE-080 §5.3: the two mixed linked/unlinked same-name
      // collisions have no unique-index backstop after migration 059, so the
      // identity check below and the INSERT must be serialised against every
      // other honour_team_members identity writer. The try form fails fast
      // rather than parking a web request behind a multi-minute reload; the
      // transaction scope releases the lock on commit and rollback alike.
      const [lock] = await tx<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(
          ${HONOUR_TEAM_LOCK_NAMESPACE}, ${HONOUR_TEAM_LOCK_KEY}
        ) AS locked
      `;
      if (!lock?.locked) {
        throw new Error('An honours reload is in progress; try again shortly.');
      }

      // Admin-created rows assert their provenance so a scoped source reload
      // can never claim them (AFLDB-ISSUE-080).
      const [manualSource] = await tx<{ id: number }[]>`
        SELECT id FROM sources WHERE key = ${MANUAL_ADMIN_SOURCE_KEY}
      `;
      if (!manualSource) {
        throw new Error(`Required source '${MANUAL_ADMIN_SOURCE_KEY}' is not configured.`);
      }

      let playerName = input.playerNameRaw?.trim() || '';
      if (input.playerId) {
        const [p] = await tx<{ displayName: string }[]>`SELECT display_name AS "displayName" FROM players WHERE id = ${input.playerId}`;
        if (p) playerName = p.displayName;
      }
      if (!playerName) throw new Error('Player name is required.');

      const teamName = input.teamName.trim();
      if (!teamName) throw new Error('Team name is required.');

      // Create means create: if the fact already exists — under any ownership,
      // manual, source-loaded or unknown — refuse rather than adopt, overwrite
      // or duplicate it (AFLDB-ISSUE-080 §5.2). Two identity axes apply. On
      // (team_name, player_id) an existing row for the same linked player
      // always refuses, whatever its display name. On (team_name,
      // player_name_raw) a raw-name match is only a conflict while identity is
      // ambiguous or asserted twice: migration 059 stopped treating raw name
      // as identity (AFLDB-ISSUE-025), so a second player positively linked to
      // a different id may share a display name and must stay creatable.
      const proposedPlayerId = input.playerId ?? null;
      const existing = await tx<{
        id: number;
        playerNameRaw: string;
        playerId: number | null;
      }[]>`
        SELECT id, player_name_raw AS "playerNameRaw", player_id AS "playerId"
          FROM honour_team_members
         WHERE team_name = ${teamName}
           AND (player_name_raw = ${playerName}
                OR (${proposedPlayerId}::integer IS NOT NULL
                    AND player_id = ${proposedPlayerId}::integer))
         ORDER BY id
      `;
      for (const row of existing) {
        if (proposedPlayerId !== null && row.playerId === proposedPlayerId) {
          throw new Error(
            `'${teamName}' already records this player as '${row.playerNameRaw}' `
            + `(entry #${row.id}, linked to player #${row.playerId}). `
            + 'It cannot be added again.',
          );
        }
        if (row.playerNameRaw !== playerName) continue;
        if (row.playerId !== null && proposedPlayerId !== null) continue;
        const existingIdentity = row.playerId === null
          ? 'not linked to a player'
          : `linked to player #${row.playerId}`;
        const proposedIdentity = proposedPlayerId === null
          ? 'not linked to a player'
          : `linked to player #${proposedPlayerId}`;
        throw new Error(
          `'${teamName}' already has an entry named '${row.playerNameRaw}' `
          + `(entry #${row.id}, ${existingIdentity}); the new entry is ${proposedIdentity}. `
          + 'Review whether they are the same person before creating it.',
        );
      }

      const linkStatus = input.playerId ? 'resolved' : 'unmatched';
      const sortOrder = Number.isInteger(input.sortOrder) ? Number(input.sortOrder) : 0;

      const [row] = await tx<{ id: number }[]>`
        INSERT INTO honour_team_members (
          team_name, player_id, player_name_raw, link_status_value,
          position, role, club_name_raw, sort_order, note, source_id
        ) VALUES (
          ${teamName}, ${proposedPlayerId}, ${playerName}, ${linkStatus}::link_status,
          ${input.position?.trim() || null}, ${input.role?.trim() || null},
          ${input.clubNameRaw?.trim() || null}, ${sortOrder},
          ${input.note?.trim() || null}, ${manualSource.id}
        )
        RETURNING id
      `;

      // Required audit, same transaction: a failed insert rolls the
      // honour-team entry back (AFLDB-ISSUE-027).
      await recordDataEdit(tx, {
        tableName: 'honour_team_members',
        rowId: row.id,
        fieldGroup: 'honour_team',
        oldValues: {},
        newValues: { teamName: input.teamName, playerName: input.playerNameRaw, playerId: input.playerId },
        adminUserId: input.adminUserId,
        note: input.note,
      });

      return row;
    });

    return created;
  } finally {
    await importSql.end({ timeout: 5 });
  }
}
