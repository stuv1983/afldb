import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import 'server-only';

import postgres from 'postgres';

import { recordDataEdit } from '@/db/queries/audit-log';
import { sql } from '@/db/client';

/**
 * Coach administration reads and mutations (AFLDB-ISSUE-159 Stage 2).
 *
 * Reads of `coaches` / `match_coaches` run on the public client (both are
 * `grant_app_read`-registered, migration 087:112-113). Every mutation is one
 * `AFLDB_IMPORT_DATABASE_URL` short-lived transaction writing the canonical
 * row, the `data_overrides` upsert and the `recordDataEdit()` audit row
 * together (§4.2) -- the `saveEdit()` shape in `src/lib/edit/data-edits.ts`,
 * reused rather than reinvented.
 *
 * `data_overrides` itself carries no `grant_app_read` (migration 073 grants
 * SELECT to `afldb_import` only) -- Stage 1 decision D-2. So every READ of
 * override state, here, also goes through a short-lived import-role
 * connection, doing nothing but SELECT. `withImportConnection()` is that one
 * narrow helper; nothing in this file gives the browser or `afldb_auth` any
 * wider authority than that.
 */

// --- entity_key shape (§1.1, §5.2, §6.1) -----------------------------

/**
 * The `data_overrides.entity_key` a coach's canonical `afltables_coach_path`
 * maps to -- `'afltables:<path>'` for a source-owned coach,
 * `'manual_admin_edit:<token>'` for an admin-created one. Mirrors
 * `tools/migration/common.py`'s `replay_admin_overrides(coaches)` decode
 * exactly; the two must never be able to disagree about what a key means.
 */
export function coachOverrideEntityKey(afltablesCoachPath: string): string {
  return afltablesCoachPath.startsWith('manual:')
    ? `manual_admin_edit:${afltablesCoachPath.slice('manual:'.length)}`
    : `afltables:${afltablesCoachPath}`;
}

/** The `data_overrides.entity_key` a coaching assignment maps to (§5.2, §6.1). */
export function assignmentOverrideEntityKey(matchKey: string, clubSlug: string): string {
  return `${matchKey}|${clubSlug}`;
}

// --- the D-2 narrow SELECT-only import-role helper --------------------

async function withImportConnection<T>(fn: (importSql: postgres.Sql) => Promise<T>): Promise<T> {
  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!importUrl) throw new Error('AFLDB_IMPORT_DATABASE_URL is not configured.');
  const importSql = postgres(importUrl, { max: 1, onnotice: () => {} });
  try {
    return await fn(importSql);
  } finally {
    await importSql.end({ timeout: 5 });
  }
}

export type CoachOverrideRow = {
  fieldGroup: string;
  overrideValues: Record<string, unknown>;
  isActive: boolean;
  updatedAt: Date;
};

/** Every override row (active or retired) for one coach's identity. D-2. */
export async function readCoachOverrides(afltablesCoachPath: string): Promise<CoachOverrideRow[]> {
  const entityKey = coachOverrideEntityKey(afltablesCoachPath);
  return withImportConnection((importSql) => importSql<CoachOverrideRow[]>`
    SELECT field_group AS "fieldGroup", override_values AS "overrideValues",
           is_active AS "isActive", updated_at AS "updatedAt"
      FROM data_overrides
     WHERE entity_type = 'coaches' AND entity_key = ${entityKey}
     ORDER BY field_group
  `);
}

/** Every coach's `entity_key` carrying an ACTIVE override, for the list's badge. D-2. */
async function readActiveCoachOverrideKeys(): Promise<Set<string>> {
  const rows = await withImportConnection((importSql) => importSql<{ entityKey: string }[]>`
    SELECT DISTINCT entity_key AS "entityKey" FROM data_overrides
     WHERE entity_type = 'coaches' AND is_active
  `);
  return new Set(rows.map((r) => r.entityKey));
}

export type AssignmentOverride = {
  matchKey: string;
  clubSlug: string;
  coachIdentity: string | null;
  updatedAt: Date;
};

/**
 * Every ACTIVE coaching-assignment override, decoded. Fetched unfiltered
 * (the table is small) rather than joined against arbitrary match keys in
 * SQL, mirroring the decode `common.py`'s replay uses -- the club slug is
 * the segment after the LAST `|`, because `match_key` is itself pipe-
 * delimited (`season|round|date|home|away`, migration 003; §6.1 decode
 * note). D-2.
 */
export async function readAllActiveAssignmentOverrides(): Promise<AssignmentOverride[]> {
  const rows = await withImportConnection((importSql) => importSql<{
    entityKey: string; overrideValues: Record<string, unknown>; updatedAt: Date;
  }[]>`
    SELECT entity_key AS "entityKey", override_values AS "overrideValues", updated_at AS "updatedAt"
      FROM data_overrides
     WHERE entity_type = 'match_coaches' AND is_active
  `);
  return rows
    .map((r) => {
      const idx = r.entityKey.lastIndexOf('|');
      const coachIdentity = typeof r.overrideValues.coach_identity === 'string'
        ? r.overrideValues.coach_identity
        : null;
      return {
        matchKey: idx >= 0 ? r.entityKey.slice(0, idx) : r.entityKey,
        clubSlug: idx >= 0 ? r.entityKey.slice(idx + 1) : '',
        coachIdentity,
        updatedAt: r.updatedAt,
      };
    })
    .filter((r) => r.clubSlug !== '');
}

// --- profile_link_corrections (S-9) ------------------------------------

type ProfileLinkCorrectionRule = { id: string; coach_path: string };

let cachedCorrections: ProfileLinkCorrectionRule[] | null = null;

/**
 * The tracked, evidence-bound coach-profile corrections a repository review
 * already made (`tools/rebuild/afltables/afltables-contract.json`
 * `coaches.profile_link_corrections.rules`). A browser link must never
 * silently override one (§4.3, S-9). Read once and cached: this is a
 * repository artefact, not user input, and does not change within a
 * running process.
 */
function loadProfileLinkCorrections(): ProfileLinkCorrectionRule[] {
  if (cachedCorrections) return cachedCorrections;
  try {
    const raw = readFileSync(
      join(process.cwd(), 'tools', 'rebuild', 'afltables', 'afltables-contract.json'),
      'utf8',
    );
    const parsed = JSON.parse(raw) as {
      coaches?: { profile_link_corrections?: { rules?: unknown } };
    };
    const rules = parsed.coaches?.profile_link_corrections?.rules;
    cachedCorrections = Array.isArray(rules) ? (rules as ProfileLinkCorrectionRule[]) : [];
  } catch {
    // Unreadable or absent: treat as no tracked correction rather than
    // refuse every link. The contract file is a repository artefact whose
    // own gates (tools/rebuild) catch a genuine absence; this is not that
    // check.
    cachedCorrections = [];
  }
  return cachedCorrections;
}

// --- list / search ------------------------------------------------------

export type CoachAdminListFilters = {
  q?: string;
  provenance?: 'afltables' | 'manual';
  linkStatus?: string;
  hasOverride?: boolean;
  page: number;
  pageSize: number;
};

export type CoachAdminListRow = {
  id: number;
  displayName: string;
  dob: string | null;
  provenance: 'afltables' | 'manual';
  linkStatusValue: string;
  matchesCoached: number;
  afltablesCoachPath: string;
  hasActiveOverride: boolean;
};

/**
 * The `/admin/coaches` list. Coaches number in the low hundreds (386
 * sourced plus a handful manual), so -- exactly as `/admin/player-links`'s
 * queue does -- the filtered set is read unpaginated and paginated in
 * memory; the `hasOverride` filter needs that anyway, since the override
 * badge is read through a second, differently-privileged connection (D-2)
 * that cannot be joined into the same SQL statement.
 */
export async function listCoachesForAdmin(
  filters: CoachAdminListFilters,
): Promise<{ rows: CoachAdminListRow[]; total: number }> {
  const conditions: ReturnType<typeof sql>[] = [];
  const qTerm = filters.q?.trim();
  if (qTerm) conditions.push(sql`c.display_name ILIKE ${`%${qTerm}%`}`);
  if (filters.provenance === 'manual') conditions.push(sql`c.afltables_coach_path LIKE 'manual:%'`);
  if (filters.provenance === 'afltables') conditions.push(sql`c.afltables_coach_path NOT LIKE 'manual:%'`);
  if (filters.linkStatus) conditions.push(sql`c.link_status_value::text = ${filters.linkStatus}`);

  const where = conditions.length
    ? conditions.reduce((combined, condition) => sql`${combined} AND ${condition}`)
    : sql`TRUE`;

  const allRows = await sql<Omit<CoachAdminListRow, 'hasActiveOverride'>[]>`
    WITH counts AS (
      SELECT coach_id, count(*)::int AS games FROM match_coaches GROUP BY coach_id
    )
    SELECT c.id, c.display_name AS "displayName", to_char(c.dob, 'YYYY-MM-DD') AS dob,
           CASE WHEN c.afltables_coach_path LIKE 'manual:%' THEN 'manual' ELSE 'afltables' END AS provenance,
           c.link_status_value::text AS "linkStatusValue",
           COALESCE(cnt.games, 0) AS "matchesCoached",
           c.afltables_coach_path AS "afltablesCoachPath"
      FROM coaches c
      LEFT JOIN counts cnt ON cnt.coach_id = c.id
     WHERE ${where}
     ORDER BY c.surname NULLS LAST, c.given_name NULLS LAST, c.display_name
  `;

  const overrideKeys = await readActiveCoachOverrideKeys();
  const withOverride: CoachAdminListRow[] = allRows.map((r) => ({
    ...r,
    hasActiveOverride: overrideKeys.has(coachOverrideEntityKey(r.afltablesCoachPath)),
  }));

  const finalRows = filters.hasOverride === undefined
    ? withOverride
    : withOverride.filter((r) => r.hasActiveOverride === filters.hasOverride);

  const total = finalRows.length;
  const start = (filters.page - 1) * filters.pageSize;
  return { rows: finalRows.slice(start, start + filters.pageSize), total };
}

// --- detail ---------------------------------------------------------------

export type CoachAdminDetail = {
  id: number;
  displayName: string;
  givenName: string | null;
  surname: string | null;
  dob: string | null;
  notes: string | null;
  afltablesCoachPath: string;
  nameKey: string;
  provenance: 'afltables' | 'manual';
  sourceKey: string;
  sourceRecordId: string;
  importBatchId: number | null;
  sourceGamesCoached: number | null;
  linkStatusValue: string;
  playerId: number | null;
  playerSlug: string | null;
  playerDisplayName: string | null;
  afltablesProfilePath: string | null;
};

export async function getCoachAdminDetail(id: number): Promise<CoachAdminDetail | null> {
  const [row] = await sql<Omit<CoachAdminDetail, 'provenance'>[]>`
    SELECT c.id, c.display_name AS "displayName", c.given_name AS "givenName", c.surname,
           to_char(c.dob, 'YYYY-MM-DD') AS dob, c.notes,
           c.afltables_coach_path AS "afltablesCoachPath", c.name_key AS "nameKey",
           s.key AS "sourceKey", c.source_record_id AS "sourceRecordId",
           c.import_batch_id AS "importBatchId", c.source_games_coached AS "sourceGamesCoached",
           c.link_status_value::text AS "linkStatusValue",
           c.player_id AS "playerId", p.slug AS "playerSlug", p.display_name AS "playerDisplayName",
           c.afltables_profile_path AS "afltablesProfilePath"
      FROM coaches c
      JOIN sources s ON s.id = c.source_id
      LEFT JOIN players p ON p.id = c.player_id
     WHERE c.id = ${id}
  `;
  if (!row) return null;
  return { ...row, provenance: row.afltablesCoachPath.startsWith('manual:') ? 'manual' : 'afltables' };
}

// --- assignment panel reads -------------------------------------------

export type ClubSeasonMatchRow = {
  matchId: number;
  matchKey: string;
  roundCode: string;
  matchDate: string;
  homeClubName: string;
  awayClubName: string;
  currentCoachId: number | null;
  currentCoachName: string | null;
  currentCoachPath: string | null;
  currentSourceKey: string | null;
};

/**
 * A club's matches in one season with the CURRENT (post-reload) coaching
 * assignment, bounded by construction -- one club, one season, never a free
 * grid over 33,676 team-matches (§9.4).
 */
export async function listClubSeasonMatches(clubId: number, season: number): Promise<ClubSeasonMatchRow[]> {
  return sql<ClubSeasonMatchRow[]>`
    SELECT m.id AS "matchId", m.match_key AS "matchKey", m.round_code AS "roundCode",
           to_char(m.match_date, 'YYYY-MM-DD') AS "matchDate",
           hc.name AS "homeClubName", ac.name AS "awayClubName",
           co.id AS "currentCoachId", co.display_name AS "currentCoachName",
           co.afltables_coach_path AS "currentCoachPath", src.key AS "currentSourceKey"
      FROM matches m
      JOIN clubs hc ON hc.id = m.home_club_id
      JOIN clubs ac ON ac.id = m.away_club_id
      LEFT JOIN match_coaches mc ON mc.match_id = m.id AND mc.club_id = ${clubId}
      LEFT JOIN coaches co ON co.id = mc.coach_id
      LEFT JOIN sources src ON src.id = mc.source_id
     WHERE m.season = ${season}
       AND ${clubId} IN (m.home_club_id, m.away_club_id)
     ORDER BY m.match_date, m.id
  `;
}

/** Clubs for the assignment panel's club picker -- id is what the mutation needs, unlike the public site's slug-only options. */
export async function listClubOptionsForAdmin(): Promise<{ id: number; slug: string; name: string }[]> {
  return sql<{ id: number; slug: string; name: string }[]>`
    SELECT id, slug, name FROM clubs ORDER BY is_current_afl_club DESC, name
  `;
}

/** Every club slug a coach has an assignment for, for revalidation fan-out. Bounded per-coach. */
export async function listCoachedClubSlugs(coachId: number): Promise<string[]> {
  const rows = await sql<{ slug: string }[]>`
    SELECT DISTINCT cl.slug
      FROM match_coaches mc
      JOIN clubs cl ON cl.id = mc.club_id
     WHERE mc.coach_id = ${coachId}
  `;
  return rows.map((r) => r.slug);
}

// --- duplicate prevention (§4.4) ---------------------------------------

export type DuplicateCandidate = { coachId: number; label: string; reason: string };

// --- mutations (§4.2: one import-role transaction each) ---------------

export type CreateCoachInput = {
  displayName: string;
  givenName: string | null;
  surname: string | null;
  dob: string | null;
  notes: string | null;
  adminUserId: number;
  note?: string | null;
  /** The operator has seen the soft-duplicate candidates and wants to proceed anyway (§4.4). */
  confirmed?: boolean;
};

export type CreateCoachResult =
  | { ok: true; coachId: number }
  | { ok: false; error: string }
  | { ok: false; needsConfirmation: true; candidates: DuplicateCandidate[] };

export async function createCoach(input: CreateCoachInput): Promise<CreateCoachResult> {
  const displayName = input.displayName.trim();
  if (!displayName) return { ok: false, error: 'Display name is required.' };
  if (displayName.length > 200) return { ok: false, error: 'Display name is limited to 200 characters.' };
  if ((input.notes ?? '').length > 2000) return { ok: false, error: 'Notes are limited to 2000 characters.' };

  // Hard refusal: a coach already exists with the same normalised name whose
  // dob is unrecorded or agrees (§4.4 rule 1, first half).
  const hardNameMatches = await sql<{ id: number; displayName: string; dob: string | null }[]>`
    SELECT id, display_name AS "displayName", to_char(dob, 'YYYY-MM-DD') AS dob
      FROM coaches
     WHERE afldb_normalise_name(display_name) = afldb_normalise_name(${displayName})
       AND (dob IS NULL OR ${input.dob}::date IS NULL OR dob = ${input.dob}::date)
  `;
  if (hardNameMatches.length > 0) {
    const m = hardNameMatches[0];
    return {
      ok: false,
      error: `A coach named "${m.displayName}" (#${m.id}) already exists with the same or unrecorded date of `
        + 'birth. Edit that coach instead of creating a duplicate.',
    };
  }

  // Hard refusal: the named person already exists as a player who already
  // carries a coach row (§4.4 rule 2).
  const playerCoaches = await sql<{ coachId: number; playerId: number; playerName: string }[]>`
    SELECT c.id AS "coachId", p.id AS "playerId", p.display_name AS "playerName"
      FROM players p
      JOIN coaches c ON c.player_id = p.id
     WHERE afldb_normalise_name(p.display_name) = afldb_normalise_name(${displayName})
  `;
  if (playerCoaches.length > 0) {
    const m = playerCoaches[0];
    return {
      ok: false,
      error: `${m.playerName} already has a coach row (#${m.coachId}) linked through their player record. `
        + 'Link to that coach rather than creating a manual one.',
    };
  }

  // Soft refusal, confirmable: same normalised name, both dobs present and
  // different (§4.4 rule 1, second half).
  if (!input.confirmed) {
    const softMatches = await sql<{ id: number; displayName: string; dob: string | null }[]>`
      SELECT id, display_name AS "displayName", to_char(dob, 'YYYY-MM-DD') AS dob
        FROM coaches
       WHERE afldb_normalise_name(display_name) = afldb_normalise_name(${displayName})
         AND dob IS NOT NULL AND ${input.dob}::date IS NOT NULL AND dob <> ${input.dob}::date
    `;
    if (softMatches.length > 0) {
      return {
        ok: false,
        needsConfirmation: true,
        candidates: softMatches.map((m) => ({
          coachId: m.id,
          label: `${m.displayName} (#${m.id})`,
          reason: `same name, different date of birth (${m.dob ?? 'unrecorded'})`,
        })),
      };
    }
  }

  const token = randomUUID();
  const path = `manual:${token}`;

  return withImportConnection(async (importSql) => {
    try {
      const coachId = await importSql.begin(async (tx) => {
        const [row] = await tx<{ id: number }[]>`
          INSERT INTO coaches (afltables_coach_path, name_key, display_name, given_name, surname, dob,
                                source_id, source_record_id, notes)
          VALUES (${path}, ${path}, ${displayName}, ${input.givenName}, ${input.surname}, ${input.dob}::date,
                  (SELECT id FROM sources WHERE key = 'manual_admin_edit'), ${token}, ${input.notes})
          RETURNING id
        `;

        const overrideValues: Record<string, unknown> = {
          display_name: displayName, given_name: input.givenName, surname: input.surname,
          dob: input.dob, notes: input.notes,
        };
        await tx`
          INSERT INTO data_overrides (entity_type, entity_key, field_group, override_values, admin_user_id, is_active, updated_at)
          VALUES ('coaches', ${`manual_admin_edit:${token}`}, 'identity', ${tx.json(overrideValues as postgres.JSONValue)}, ${input.adminUserId}, true, now())
        `;

        await recordDataEdit(tx, {
          tableName: 'coaches',
          rowId: row.id,
          fieldGroup: 'identity',
          oldValues: {},
          newValues: overrideValues,
          adminUserId: input.adminUserId,
          note: input.note,
        });
        return row.id;
      });
      return { ok: true, coachId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `The coach could not be created: ${message}` };
    }
  });
}

export type SaveCoachMetadataInput = {
  coachId: number;
  displayName: string;
  givenName: string | null;
  surname: string | null;
  dob: string | null;
  notes: string | null;
  adminUserId: number;
  note?: string | null;
};

export type MutationResult = { ok: true } | { ok: false; error: string };

/** display_name / given_name / surname / dob / notes -- everything else on `coaches` is never editable (§4.1). */
export async function saveCoachMetadata(input: SaveCoachMetadataInput): Promise<MutationResult> {
  const displayName = input.displayName.trim();
  if (!displayName) return { ok: false, error: 'Display name is required.' };
  if (displayName.length > 200) return { ok: false, error: 'Display name is limited to 200 characters.' };
  if ((input.notes ?? '').length > 2000) return { ok: false, error: 'Notes are limited to 2000 characters.' };

  return withImportConnection(async (importSql) => {
    try {
      await importSql.begin(async (tx) => {
        const [before] = await tx<{
          displayName: string; givenName: string | null; surname: string | null;
          dob: string | null; notes: string | null; afltablesCoachPath: string;
        }[]>`
          SELECT display_name AS "displayName", given_name AS "givenName", surname,
                 to_char(dob, 'YYYY-MM-DD') AS dob, notes,
                 afltables_coach_path AS "afltablesCoachPath"
            FROM coaches WHERE id = ${input.coachId} FOR UPDATE
        `;
        if (!before) throw new Error('No coach with that id.');

        await tx`
          UPDATE coaches
             SET display_name = ${displayName}, given_name = ${input.givenName}, surname = ${input.surname},
                 dob = ${input.dob}::date, notes = ${input.notes}
           WHERE id = ${input.coachId}
        `;

        const values: Record<string, unknown> = {
          display_name: displayName, given_name: input.givenName, surname: input.surname,
          dob: input.dob, notes: input.notes,
        };
        const oldValues: Record<string, unknown> = {
          display_name: before.displayName, given_name: before.givenName, surname: before.surname,
          dob: before.dob, notes: before.notes,
        };

        const entityKey = coachOverrideEntityKey(before.afltablesCoachPath);
        const [existing] = await tx<{ overrideValues: Record<string, unknown> }[]>`
          SELECT override_values AS "overrideValues" FROM data_overrides
           WHERE entity_type = 'coaches' AND entity_key = ${entityKey} AND field_group = 'identity'
        `;
        const merged: Record<string, unknown> = { ...(existing?.overrideValues ?? {}) };
        for (const key of Object.keys(values)) {
          if (values[key] !== oldValues[key]) merged[key] = values[key];
        }
        if (Object.keys(merged).length > 0) {
          await tx`
            INSERT INTO data_overrides (entity_type, entity_key, field_group, override_values, admin_user_id, is_active, updated_at)
            VALUES ('coaches', ${entityKey}, 'identity', ${tx.json(merged as postgres.JSONValue)}, ${input.adminUserId}, true, now())
            ON CONFLICT (entity_type, entity_key, field_group) DO UPDATE SET
              override_values = EXCLUDED.override_values, admin_user_id = EXCLUDED.admin_user_id,
              is_active = true, updated_at = now()
          `;
        }

        await recordDataEdit(tx, {
          tableName: 'coaches', rowId: input.coachId, fieldGroup: 'identity',
          oldValues, newValues: values, adminUserId: input.adminUserId, note: input.note,
        });
      });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `The edit could not be applied: ${message}` };
    }
  });
}

/** Resolve a player's stable AFL Tables identity, exactly as data-edits.ts's getEntityNaturalKey does for players. */
async function resolvePlayerProfilePath(tx: postgres.TransactionSql, playerId: number): Promise<string | null> {
  const [row] = await tx<{ externalId: string }[]>`
    SELECT e.external_id AS "externalId"
      FROM external_identities e
      JOIN sources s ON s.id = e.source_id
     WHERE e.player_id = ${playerId}
       AND s.key = 'afltables'
       AND e.status IN ('unique', 'resolved')
     LIMIT 1
  `;
  return row?.externalId ?? null;
}

export async function linkCoachToPlayer(input: {
  coachId: number; playerId: number; adminUserId: number; note?: string | null;
}): Promise<MutationResult> {
  return withImportConnection(async (importSql) => {
    try {
      await importSql.begin(async (tx) => {
        const [coach] = await tx<{
          playerId: number | null; afltablesCoachPath: string;
        }[]>`
          SELECT player_id AS "playerId", afltables_coach_path AS "afltablesCoachPath"
            FROM coaches WHERE id = ${input.coachId} FOR UPDATE
        `;
        if (!coach) throw new Error('No coach with that id.');
        if (coach.playerId !== null) throw new Error('This coach is already linked to a player. Unlink first.');

        const [alreadyCoach] = await tx<{ id: number }[]>`
          SELECT id FROM coaches WHERE player_id = ${input.playerId}
        `;
        if (alreadyCoach) throw new Error('That player is already linked to a different coach row (coaches_player_uq).');

        const profilePath = await resolvePlayerProfilePath(tx, input.playerId);
        if (!profilePath) throw new Error('That player has no unique AFL Tables profile to link against.');

        if (loadProfileLinkCorrections().some((rule) => rule.coach_path === coach.afltablesCoachPath)) {
          throw new Error(
            'A repository-tracked profile correction already governs this coach\'s link '
            + '(tools/rebuild/afltables/afltables-contract.json). Change the tracked rule instead of linking here.',
          );
        }

        await tx`
          UPDATE coaches
             SET player_id = ${input.playerId}, link_status_value = 'unique', afltables_profile_path = ${profilePath}
           WHERE id = ${input.coachId}
        `;

        const entityKey = coachOverrideEntityKey(coach.afltablesCoachPath);
        await tx`
          INSERT INTO data_overrides (entity_type, entity_key, field_group, override_values, admin_user_id, is_active, updated_at)
          VALUES ('coaches', ${entityKey}, 'linkage', ${tx.json({ player_id_identity: profilePath })}, ${input.adminUserId}, true, now())
          ON CONFLICT (entity_type, entity_key, field_group) DO UPDATE SET
            override_values = EXCLUDED.override_values, admin_user_id = EXCLUDED.admin_user_id,
            is_active = true, updated_at = now()
        `;

        await recordDataEdit(tx, {
          tableName: 'coaches', rowId: input.coachId, fieldGroup: 'linkage',
          oldValues: { player_id_identity: null }, newValues: { player_id_identity: profilePath },
          adminUserId: input.adminUserId, note: input.note,
        });
      });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  });
}

export async function unlinkCoach(input: {
  coachId: number; adminUserId: number; note?: string | null;
}): Promise<MutationResult> {
  return withImportConnection(async (importSql) => {
    try {
      await importSql.begin(async (tx) => {
        const [coach] = await tx<{
          playerId: number | null; afltablesCoachPath: string; afltablesProfilePath: string | null;
        }[]>`
          SELECT player_id AS "playerId", afltables_coach_path AS "afltablesCoachPath",
                 afltables_profile_path AS "afltablesProfilePath"
            FROM coaches WHERE id = ${input.coachId} FOR UPDATE
        `;
        if (!coach) throw new Error('No coach with that id.');
        if (coach.playerId === null) throw new Error('This coach is not linked to a player.');

        await tx`
          UPDATE coaches
             SET player_id = NULL, link_status_value = 'unmatched', afltables_profile_path = NULL
           WHERE id = ${input.coachId}
        `;

        const entityKey = coachOverrideEntityKey(coach.afltablesCoachPath);
        await tx`
          INSERT INTO data_overrides (entity_type, entity_key, field_group, override_values, admin_user_id, is_active, updated_at)
          VALUES ('coaches', ${entityKey}, 'linkage', ${tx.json({ player_id_identity: null })}, ${input.adminUserId}, true, now())
          ON CONFLICT (entity_type, entity_key, field_group) DO UPDATE SET
            override_values = EXCLUDED.override_values, admin_user_id = EXCLUDED.admin_user_id,
            is_active = true, updated_at = now()
        `;

        await recordDataEdit(tx, {
          tableName: 'coaches', rowId: input.coachId, fieldGroup: 'linkage',
          oldValues: { player_id_identity: coach.afltablesProfilePath }, newValues: { player_id_identity: null },
          adminUserId: input.adminUserId, note: input.note,
        });
      });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  });
}

/**
 * Set one coach's assignment for one or more (match, club) pairs, all in ONE
 * transaction. The plural form IS the "apply to every listed match" control
 * (§9.4): the bounded club+season list the panel already computed is the
 * only source of pairs, so this never accepts an unbounded range -- there is
 * still no free grid over 33,676 team-matches, only whatever finite list of
 * rows the caller already had on screen.
 */
export async function setCoachAssignment(input: {
  assignments: { matchId: number; clubId: number }[];
  coachId: number;
  adminUserId: number;
  note?: string | null;
}): Promise<MutationResult> {
  if (input.assignments.length === 0) return { ok: false, error: 'No matches selected.' };

  return withImportConnection(async (importSql) => {
    try {
      await importSql.begin(async (tx) => {
        const [coach] = await tx<{ afltablesCoachPath: string }[]>`
          SELECT afltables_coach_path AS "afltablesCoachPath" FROM coaches WHERE id = ${input.coachId}
        `;
        if (!coach) throw new Error('No coach with that id.');

        for (const { matchId, clubId } of input.assignments) {
          const [match] = await tx<{ matchKey: string; homeClubId: number; awayClubId: number }[]>`
            SELECT match_key AS "matchKey", home_club_id AS "homeClubId", away_club_id AS "awayClubId"
              FROM matches WHERE id = ${matchId} FOR UPDATE
          `;
          if (!match) throw new Error(`No match #${matchId}.`);
          if (clubId !== match.homeClubId && clubId !== match.awayClubId) {
            throw new Error(`Club #${clubId} did not play in match #${matchId}.`);
          }
          const [club] = await tx<{ slug: string }[]>`SELECT slug FROM clubs WHERE id = ${clubId}`;
          if (!club) throw new Error(`No club #${clubId}.`);

          const [existing] = await tx<{ coachPath: string | null; sourceKey: string | null }[]>`
            SELECT c.afltables_coach_path AS "coachPath", s.key AS "sourceKey"
              FROM match_coaches mc
              JOIN sources s ON s.id = mc.source_id
              LEFT JOIN coaches c ON c.id = mc.coach_id
             WHERE mc.match_id = ${matchId} AND mc.club_id = ${clubId}
          `;

          const entityKey = assignmentOverrideEntityKey(match.matchKey, club.slug);

          await tx`
            INSERT INTO match_coaches (match_id, club_id, coach_id, source_id, source_record_id)
            VALUES (${matchId}, ${clubId}, ${input.coachId},
                    (SELECT id FROM sources WHERE key = 'manual_admin_edit'), ${entityKey})
            ON CONFLICT (match_id, club_id) DO UPDATE SET
              coach_id = EXCLUDED.coach_id, source_id = EXCLUDED.source_id,
              source_record_id = EXCLUDED.source_record_id, import_batch_id = NULL
          `;

          await tx`
            INSERT INTO data_overrides (entity_type, entity_key, field_group, override_values, admin_user_id, is_active, updated_at)
            VALUES ('match_coaches', ${entityKey}, 'assignment', ${tx.json({ coach_identity: coach.afltablesCoachPath })}, ${input.adminUserId}, true, now())
            ON CONFLICT (entity_type, entity_key, field_group) DO UPDATE SET
              override_values = EXCLUDED.override_values, admin_user_id = EXCLUDED.admin_user_id,
              is_active = true, updated_at = now()
          `;

          await recordDataEdit(tx, {
            tableName: 'matches', rowId: matchId, fieldGroup: 'coach_assignment',
            oldValues: { club: club.slug, coach: existing?.coachPath ?? null, source: existing?.sourceKey ?? null },
            newValues: { club: club.slug, coach: coach.afltablesCoachPath, source: 'manual_admin_edit' },
            adminUserId: input.adminUserId, note: input.note,
          });
        }
      });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  });
}

/**
 * Retires the manual assignment override for one match/club (D-4: "the
 * operator can retire it"). Deliberately does NOT touch the canonical
 * `match_coaches` row -- there is no correct value to revert to without
 * re-running the importer, so this stops the manual decision winning
 * future replays and leaves the current row exactly as it is.
 */
export async function clearCoachAssignment(input: {
  matchId: number; clubId: number; adminUserId: number; note?: string | null;
}): Promise<MutationResult> {
  return withImportConnection(async (importSql) => {
    try {
      await importSql.begin(async (tx) => {
        const [match] = await tx<{ matchKey: string }[]>`
          SELECT match_key AS "matchKey" FROM matches WHERE id = ${input.matchId} FOR UPDATE
        `;
        if (!match) throw new Error('No match with that id.');
        const [club] = await tx<{ slug: string }[]>`SELECT slug FROM clubs WHERE id = ${input.clubId}`;
        if (!club) throw new Error('No club with that id.');

        const entityKey = assignmentOverrideEntityKey(match.matchKey, club.slug);
        const [existing] = await tx<{ overrideValues: Record<string, unknown> }[]>`
          SELECT override_values AS "overrideValues" FROM data_overrides
           WHERE entity_type = 'match_coaches' AND entity_key = ${entityKey}
             AND field_group = 'assignment' AND is_active
        `;
        if (!existing) throw new Error('There is no active manual assignment override to clear for this match and club.');

        await tx`
          UPDATE data_overrides SET is_active = false, admin_user_id = ${input.adminUserId}, updated_at = now()
           WHERE entity_type = 'match_coaches' AND entity_key = ${entityKey} AND field_group = 'assignment'
        `;

        await recordDataEdit(tx, {
          tableName: 'matches', rowId: input.matchId, fieldGroup: 'coach_assignment',
          oldValues: { club: club.slug, coach: existing.overrideValues.coach_identity ?? null, source: 'manual_admin_edit' },
          newValues: { club: club.slug, coach: existing.overrideValues.coach_identity ?? null, source: 'manual_admin_edit', retired: true },
          adminUserId: input.adminUserId, note: input.note,
        });
      });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  });
}

/**
 * Retires a coach's `identity` or `linkage` override (the "retire this
 * override" control, §9.2). For a MANUAL coach's `identity` override this is
 * the documented reversibility mechanism (§1.4): the row and its audit trail
 * are never deleted, but the next destructive reload or promotion stops
 * reconstructing it (§6.1, §7).
 */
export async function retireCoachOverride(input: {
  coachId: number; fieldGroup: 'identity' | 'linkage'; adminUserId: number; note?: string | null;
}): Promise<MutationResult> {
  return withImportConnection(async (importSql) => {
    try {
      await importSql.begin(async (tx) => {
        const [coach] = await tx<{ afltablesCoachPath: string }[]>`
          SELECT afltables_coach_path AS "afltablesCoachPath" FROM coaches WHERE id = ${input.coachId} FOR UPDATE
        `;
        if (!coach) throw new Error('No coach with that id.');

        const entityKey = coachOverrideEntityKey(coach.afltablesCoachPath);
        const [existing] = await tx<{ overrideValues: Record<string, unknown> }[]>`
          SELECT override_values AS "overrideValues" FROM data_overrides
           WHERE entity_type = 'coaches' AND entity_key = ${entityKey}
             AND field_group = ${input.fieldGroup} AND is_active
        `;
        if (!existing) throw new Error('There is no active override to retire.');

        await tx`
          UPDATE data_overrides SET is_active = false, admin_user_id = ${input.adminUserId}, updated_at = now()
           WHERE entity_type = 'coaches' AND entity_key = ${entityKey} AND field_group = ${input.fieldGroup}
        `;

        await recordDataEdit(tx, {
          tableName: 'coaches', rowId: input.coachId, fieldGroup: input.fieldGroup,
          oldValues: existing.overrideValues, newValues: { ...existing.overrideValues, retired: true },
          adminUserId: input.adminUserId, note: input.note,
        });
      });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  });
}
