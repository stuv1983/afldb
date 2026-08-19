import 'server-only';

import postgres from 'postgres';

import { authSql } from '@/db/authClient';
import { sql } from '@/db/client';

/**
 * Manual review of unresolved player links (migration 056).
 *
 * Three roles, three jobs, mirroring the submission pipeline's split:
 *
 *   afldb_app     reads the honours rows for the queue -- the same
 *                 SELECT the public pages already run on.
 *   afldb_auth    writes suggestions and resolutions, the operational
 *                 record of what readers said and admins decided.
 *   afldb_import  performs the one statistical write (player_id +
 *                 link_status_value on the honours row), on a
 *                 short-lived connection exactly like promoteSubmission.
 *                 There is one way into the statistical tables, not two.
 */

/** The tables a link may be reviewed on. The migration CHECK mirrors this. */
export const LINK_TARGET_TABLES = [
  'award_winners',
  'award_nominations',
  'hall_of_fame',
  'honour_team_members',
  'captaincies',
  'player_achievements',
  'draft_picks',
] as const;

export type LinkTargetTable = (typeof LINK_TARGET_TABLES)[number];

export function isLinkTargetTable(value: string): value is LinkTargetTable {
  return (LINK_TARGET_TABLES as readonly string[]).includes(value);
}

/** Statuses that mean "no confirmed link" and so belong in the queue. */
const UNRESOLVED = ['ambiguous', 'unmatched', 'implausible'] as const;

export type UnresolvedLinkRow = {
  targetTable: LinkTargetTable;
  targetId: number;
  playerName: string;
  linkStatus: string;
  /** Human context: which award/team/club/season the row belongs to. */
  context: string;
};

/**
 * Every unresolved honours row, one UNION branch per table.
 *
 * Each branch's identifier is a literal from LINK_TARGET_TABLES, never
 * request input. Reads run on the public client: all seven tables are
 * app-readable, and the queue needs nothing the public pages cannot see.
 */
export async function listUnresolvedLinks(
  table?: LinkTargetTable,
): Promise<UnresolvedLinkRow[]> {
  // Parameterised array membership — avoids sql.unsafe (see changeLog.md).
  const statusValues = [...UNRESOLVED];
  const rows = await sql<UnresolvedLinkRow[]>`
    SELECT * FROM (
      SELECT 'award_winners' AS "targetTable", w.id AS "targetId",
             w.player_name_raw AS "playerName",
             w.link_status_value::text AS "linkStatus",
             concat_ws(' · ', a.name, w.season::text,
                       COALESCE(c.name, w.club_name_raw)) AS context
        FROM award_winners w
        JOIN awards a ON a.id = w.award_id
        LEFT JOIN clubs c ON c.id = w.club_id
       WHERE w.link_status_value::text = ANY(${statusValues})
      UNION ALL
      SELECT 'award_nominations', n.id, n.player_name_raw,
             n.link_status_value::text,
             concat_ws(' · ', a.name, n.season::text,
                       CASE WHEN n.round_number IS NOT NULL
                            THEN 'Round ' || n.round_number END)
        FROM award_nominations n
        JOIN awards a ON a.id = n.award_id
       WHERE n.link_status_value::text = ANY(${statusValues})
      UNION ALL
      SELECT 'hall_of_fame', h.id, h.name,
             h.link_status_value::text,
             concat_ws(' · ', 'Hall of Fame', h.category,
                       CASE WHEN h.inducted_year IS NOT NULL
                            THEN 'inducted ' || h.inducted_year END,
                       h.club_name_raw)
        FROM hall_of_fame h
       WHERE h.link_status_value::text = ANY(${statusValues})
         AND lower(COALESCE(h.category, '')) NOT IN ('media', 'umpire', 'administrator', 'pioneer')
      UNION ALL
      SELECT 'honour_team_members', m.id, m.player_name_raw,
             m.link_status_value::text,
             concat_ws(' · ', m.team_name, m.position, m.club_name_raw)
        FROM honour_team_members m
       WHERE m.link_status_value::text = ANY(${statusValues})
      UNION ALL
      SELECT 'captaincies', cp.id, cp.player_name_raw,
             cp.link_status_value::text,
             concat_ws(' · ', c.name, cp.season::text, cp.role)
        FROM captaincies cp
        JOIN clubs c ON c.id = cp.club_id
       WHERE cp.link_status_value::text = ANY(${statusValues})
      UNION ALL
      SELECT 'player_achievements', pa.id, pa.player_name_raw,
             pa.link_status_value::text,
             concat_ws(' · ', replace(pa.achievement_type::text, '_', ' '),
                       pa.season::text)
        FROM player_achievements pa
       WHERE pa.link_status_value::text = ANY(${statusValues})
      UNION ALL
      SELECT 'draft_picks', dp.id, dp.player_name_raw,
             dp.link_status_value::text,
             concat_ws(' · ', dp.draft_type, dp.draft_year::text)
        FROM draft_picks dp
       WHERE dp.link_status_value::text = ANY(${statusValues})
    ) q
    WHERE ${table ? sql`q."targetTable" = ${table}` : sql`TRUE`}
    ORDER BY q."targetTable", q."playerName"
  `;
  return rows;
}

/**
 * Targets an admin has already vetted as genuinely unlinked, so the
 * queue can drop them without touching the honours rows themselves.
 */
export async function listConfirmedUnlinked(): Promise<Set<string>> {
  const rows = await authSql<{ targetTable: string; targetId: number }[]>`
    SELECT DISTINCT target_table AS "targetTable", target_id AS "targetId"
      FROM player_link_resolutions
     WHERE action = 'confirmed_unlinked'
  `;
  return new Set(rows.map((r) => `${r.targetTable}:${r.targetId}`));
}

export type LinkSuggestionRow = {
  id: number;
  targetTable: LinkTargetTable;
  targetId: number;
  suggestedName: string;
  note: string | null;
  status: string;
  createdAt: Date;
};

export async function listSuggestions(status = 'open'): Promise<LinkSuggestionRow[]> {
  return authSql<LinkSuggestionRow[]>`
    SELECT id, target_table AS "targetTable", target_id AS "targetId",
           suggested_name AS "suggestedName", note, status,
           created_at AS "createdAt"
      FROM player_link_suggestions
     WHERE status = ${status}
     ORDER BY created_at DESC
  `;
}

export type SuggestionResult = { ok: true } | { ok: false; reason: 'invalid' | 'error' };

/**
 * Records one reader's tip. Non-throwing, like recordNlFeedback: a
 * failed write must never break the page the reader was looking at.
 * An id that matches no row is accepted -- the queue simply never
 * surfaces it -- rather than paying a seven-table existence check on
 * every anonymous submission.
 */
export async function recordSuggestion(input: {
  targetTable: string;
  targetId: number;
  suggestedName: string;
  note?: string | null;
}): Promise<SuggestionResult> {
  if (!isLinkTargetTable(input.targetTable)) return { ok: false, reason: 'invalid' };
  if (!Number.isInteger(input.targetId) || input.targetId <= 0) {
    return { ok: false, reason: 'invalid' };
  }
  const name = input.suggestedName.trim().slice(0, 120);
  if (!name) return { ok: false, reason: 'invalid' };
  const note = (input.note ?? '').trim().slice(0, 1000);

  try {
    await authSql`
      INSERT INTO player_link_suggestions (target_table, target_id, suggested_name, note)
      VALUES (${input.targetTable}, ${input.targetId}, ${name}, ${note || null})
    `;
    return { ok: true };
  } catch (error) {
    console.error('player-link suggestion could not be recorded', error);
    return { ok: false, reason: 'error' };
  }
}

export type ResolveResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Links one honours row to a player: the single statistical write in
 * this feature, run as afldb_import on a short-lived connection (the
 * promoteSubmission pattern). Guarded to the unresolved statuses so an
 * import-confirmed 'unique' link can never be overwritten from here.
 *
 * The audit row is written afterwards on the auth pool. The two writes
 * cannot share a transaction across two roles; if the audit insert
 * fails the link stands and the failure is surfaced to the admin
 * rather than hidden.
 */
export async function resolveLink(input: {
  targetTable: LinkTargetTable;
  targetId: number;
  playerId: number;
  adminUserId: number;
  note?: string | null;
}): Promise<ResolveResult> {
  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!importUrl) return { ok: false, error: 'AFLDB_IMPORT_DATABASE_URL is not configured.' };

  const importSql = postgres(importUrl, { max: 1, onnotice: () => {} });
  let previousStatus: string | null;
  try {
    // Select-then-update in one transaction: RETURNING sees the new row,
    // so the status being replaced has to be read before the write.
    previousStatus = await importSql.begin(async (tx) => {
      const [row] = await tx<{ status: string }[]>`
        SELECT link_status_value::text AS status
          FROM ${tx(input.targetTable)}
         WHERE id = ${input.targetId}
           FOR UPDATE
      `;
      if (!row || !(UNRESOLVED as readonly string[]).includes(row.status)) return null;
      await tx`
        UPDATE ${tx(input.targetTable)}
           SET player_id = ${input.playerId},
               link_status_value = 'resolved'
         WHERE id = ${input.targetId}
      `;
      return row.status;
    }) as string | null;
    if (previousStatus === null) {
      return {
        ok: false,
        error: 'No unresolved row with that id — it may already be linked.',
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `The link could not be applied: ${message}` };
  } finally {
    await importSql.end({ timeout: 5 });
  }

  try {
    await authSql`
      INSERT INTO player_link_resolutions
            (target_table, target_id, action, player_id, previous_status,
             admin_user_id, note)
      VALUES (${input.targetTable}, ${input.targetId}, 'linked', ${input.playerId},
              ${previousStatus}::link_status, ${input.adminUserId},
              ${(input.note ?? '').trim().slice(0, 2000) || null})
    `;
  } catch (error) {
    console.error('player-link resolution audit row could not be written', error);
    return {
      ok: false,
      error: 'The link was applied, but the audit record failed — check the server log.',
    };
  }
  return { ok: true };
}

/**
 * Records that a row was vetted and is genuinely not an AFLDB player.
 * Touches nothing statistical: the honours row honestly stays
 * 'unmatched', and the queue drops it because this record exists.
 */
export async function confirmUnlinked(input: {
  targetTable: LinkTargetTable;
  targetId: number;
  previousStatus: string;
  adminUserId: number;
  note?: string | null;
}): Promise<ResolveResult> {
  try {
    await authSql`
      INSERT INTO player_link_resolutions
            (target_table, target_id, action, player_id, previous_status,
             admin_user_id, note)
      VALUES (${input.targetTable}, ${input.targetId}, 'confirmed_unlinked', NULL,
              ${input.previousStatus}::link_status, ${input.adminUserId},
              ${(input.note ?? '').trim().slice(0, 2000) || null})
    `;
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `The confirmation could not be recorded: ${message}` };
  }
}

export async function setSuggestionStatus(
  id: number,
  status: 'accepted' | 'dismissed',
  adminUserId: number,
): Promise<void> {
  await authSql`
    UPDATE player_link_suggestions
       SET status = ${status}, resolved_by = ${adminUserId}, resolved_at = now()
     WHERE id = ${id} AND status = 'open'
  `;
}
