import 'server-only';

import postgres from 'postgres';

import { authSql } from '@/db/authClient';
import { sql } from '@/db/client';
import {
  assessOneSource,
  fetchSourceEvidence,
} from '@/db/queries/player-match-candidates';
import {
  createPlayerInTransaction,
  type CreatedPlayer,
  type CreatePlayerInput,
} from '@/db/queries/players';

/**
 * Manual review of unresolved player links (migration 056).
 *
 * Three roles, three jobs, mirroring the submission pipeline's split:
 *
 *   afldb_app     reads the honours rows for the queue -- the same
 *                 SELECT the public pages already run on.
 *   afldb_auth    writes suggestions and the audit-only resolutions
 *                 (confirmed-unlinked), the operational record of what
 *                 readers said and admins decided.
 *   afldb_import  performs the statistical write (player_id +
 *                 link_status_value on the honours row), on a
 *                 short-lived connection exactly like promoteSubmission,
 *                 and appends the required linked-resolution audit row
 *                 inside that same transaction (migration 066,
 *                 AFLDB-ISSUE-027). There is one way into the
 *                 statistical tables, not two.
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
  /**
   * What resolving this row actually settles. Every table but draft
   * picks settles itself; a draft pick settles its draft_person, and so
   * every pick of that person shares one suggestion and one decision
   * rather than accumulating near-duplicates of both.
   */
  resolutionEntityType: string;
  resolutionEntityId: number;
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
                       COALESCE(c.name, w.club_name_raw)) AS context,
             'award_winners' AS "resolutionEntityType",
             w.id AS "resolutionEntityId"
        FROM award_winners w
        JOIN awards a ON a.id = w.award_id
        LEFT JOIN clubs c ON c.id = w.club_id
       WHERE w.link_status_value::text = ANY(${statusValues})
      UNION ALL
      SELECT 'award_nominations', n.id, n.player_name_raw,
             n.link_status_value::text,
             concat_ws(' · ', a.name, n.season::text,
                       CASE WHEN n.round_number IS NOT NULL
                            THEN 'Round ' || n.round_number END),
             'award_nominations', n.id
        FROM award_nominations n
        JOIN awards a ON a.id = n.award_id
       WHERE n.link_status_value::text = ANY(${statusValues})
      UNION ALL
      SELECT 'hall_of_fame', h.id, h.name,
             h.link_status_value::text,
             concat_ws(' · ', 'Hall of Fame', h.category,
                       CASE WHEN h.inducted_year IS NOT NULL
                            THEN 'inducted ' || h.inducted_year END,
                       h.club_name_raw),
             'hall_of_fame', h.id
        FROM hall_of_fame h
        LEFT JOIN aflw.players ap ON lower(trim(ap.display_name)) = lower(trim(h.name))
       WHERE h.link_status_value::text = ANY(${statusValues})
         AND ap.slug IS NULL
         AND lower(COALESCE(h.category, '')) NOT IN ('media', 'umpire', 'administrator', 'pioneer')
      UNION ALL
      SELECT 'honour_team_members', m.id, m.player_name_raw,
             m.link_status_value::text,
             concat_ws(' · ', m.team_name, m.position, m.club_name_raw),
             'honour_team_members', m.id
        FROM honour_team_members m
       WHERE m.link_status_value::text = ANY(${statusValues})
      UNION ALL
      SELECT 'captaincies', cp.id, cp.player_name_raw,
             cp.link_status_value::text,
             concat_ws(' · ', c.name, cp.season::text, cp.role),
             'captaincies', cp.id
        FROM captaincies cp
        JOIN clubs c ON c.id = cp.club_id
       WHERE cp.link_status_value::text = ANY(${statusValues})
      UNION ALL
      SELECT 'player_achievements', pa.id, pa.player_name_raw,
             pa.link_status_value::text,
             concat_ws(' · ', replace(pa.achievement_type::text, '_', ' '),
                       pa.season::text),
             'player_achievements', pa.id
        FROM player_achievements pa
       WHERE pa.link_status_value::text = ANY(${statusValues})
      UNION ALL
      SELECT 'draft_picks', dp.id, dp.player_name_raw,
             dp.link_status_value::text,
             concat_ws(' · ', dp.draft_type, dp.draft_year::text),
             'draft_person', dp.draft_person_id
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

type Tx = postgres.TransactionSql;

type LockedLinkTarget = {
  previousStatus: string;
  draftPersonId: number | null;
};

/**
 * Lock and re-check the row whose stale form is being submitted.
 *
 * Draft picks are serialized through their durable draft_person identity
 * before the individual row lock. The unlocked first read is used only to
 * find the numeric identity to lock; the locked target must still point to
 * that same identity before any caller may create or update anything.
 */
async function lockUnresolvedTarget(
  tx: Tx,
  targetTable: LinkTargetTable,
  targetId: number,
): Promise<LockedLinkTarget | null> {
  if (targetTable === 'draft_picks') {
    const [identity] = await tx<{ draftPersonId: number | null }[]>`
      SELECT draft_person_id AS "draftPersonId"
        FROM draft_picks
       WHERE id = ${targetId}
    `;
    if (!identity) return null;
    if (identity.draftPersonId === null) {
      throw new Error('The draft pick has no draft person identity and cannot be resolved safely.');
    }

    const [person] = await tx<{ status: string; playerId: number | null }[]>`
      SELECT link_status::text AS status, player_id AS "playerId"
        FROM draft_persons
       WHERE id = ${identity.draftPersonId}
       FOR UPDATE
    `;
    if (!person) {
      throw new Error('The draft pick references a draft person that no longer exists.');
    }

    const [row] = await tx<{ status: string; draftPersonId: number | null }[]>`
      SELECT link_status_value::text AS status,
             draft_person_id AS "draftPersonId"
        FROM draft_picks
       WHERE id = ${targetId}
       FOR UPDATE
    `;
    if (!row || !(UNRESOLVED as readonly string[]).includes(row.status)) return null;
    if (row.draftPersonId !== identity.draftPersonId) {
      throw new Error('The draft pick identity changed while it was being resolved.');
    }
    if (!(UNRESOLVED as readonly string[]).includes(person.status) || person.playerId !== null) {
      return null;
    }

    return { previousStatus: row.status, draftPersonId: identity.draftPersonId };
  }

  const [row] = await tx<{ status: string }[]>`
    SELECT link_status_value::text AS status
      FROM ${tx(targetTable)}
     WHERE id = ${targetId}
       FOR UPDATE
  `;
  if (!row || !(UNRESOLVED as readonly string[]).includes(row.status)) return null;
  return { previousStatus: row.status, draftPersonId: null };
}

type LogicalDecision =
  | { type: 'none' }
  | { type: 'linked'; playerId: number }
  | { type: 'confirmed_unlinked' }
  | { type: 'contradictory' };

async function classifyLogicalDecision(
  tx: Tx,
  targetTable: LinkTargetTable,
  targetId: number,
  draftPersonId: number | null,
): Promise<LogicalDecision> {
  if (targetTable === 'draft_picks' && draftPersonId) {
    const rows = await tx<{ action: string; playerId: number | null }[]>`
      SELECT DISTINCT ON (r.target_id)
             r.action, r.player_id AS "playerId"
        FROM player_link_resolutions r
        JOIN draft_picks p ON p.id = r.target_id
       WHERE p.draft_person_id = ${draftPersonId}
         AND r.target_table = 'draft_picks'
       ORDER BY r.target_id, r.created_at DESC, r.id DESC
    `;
    if (rows.length === 0) return { type: 'none' };

    const actions = new Set(rows.map((r) => r.action));
    const linkedPlayers = new Set(
      rows.filter((r) => r.action === 'linked').map((r) => r.playerId)
    );

    if (actions.size > 1 || linkedPlayers.size > 1) {
      return { type: 'contradictory' };
    }

    if (actions.has('linked')) {
      return { type: 'linked', playerId: [...linkedPlayers][0]! };
    }

    return { type: 'confirmed_unlinked' };
  }

  const [row] = await tx<{ action: string; playerId: number | null }[]>`
    SELECT action, player_id AS "playerId"
      FROM player_link_resolutions
     WHERE target_table = ${targetTable}
       AND target_id = ${targetId}
     ORDER BY created_at DESC, id DESC
     LIMIT 1
  `;
  if (!row) return { type: 'none' };
  if (row.action === 'linked') return { type: 'linked', playerId: row.playerId! };
  return { type: 'confirmed_unlinked' };
}

/** Apply the trusted link to the target already locked above. */
async function applyLockedLink(
  tx: Tx,
  targetTable: LinkTargetTable,
  targetId: number,
  playerId: number,
  draftPersonId: number | null,
): Promise<void> {
  if (targetTable === 'draft_picks') {
    if (draftPersonId === null) {
      throw new Error('A draft person identity is required to resolve a draft pick.');
    }
    await tx`
      UPDATE draft_persons
         SET player_id = ${playerId},
             link_status = 'resolved',
             is_matching_backlog = false
       WHERE id = ${draftPersonId}
    `;
    // Identity is person-grained. Every pick for this exact durable person
    // receives the same trusted link; displayed names never participate.
    await tx`
      UPDATE draft_picks
         SET player_id = ${playerId},
             link_status_value = 'resolved'
       WHERE draft_person_id = ${draftPersonId}
    `;
    return;
  }

  await tx`
    UPDATE ${tx(targetTable)}
       SET player_id = ${playerId},
           link_status_value = 'resolved'
     WHERE id = ${targetId}
  `;
}

/**
 * Required audit for an applied link. Must run on the same import-role
 * transaction as the statistical link write (migration 066,
 * AFLDB-ISSUE-027): a failed insert propagates, aborting the
 * transaction and rolling the link back with it.
 */
async function recordLinkedResolution(tx: Tx, input: {
  targetTable: LinkTargetTable;
  targetId: number;
  playerId: number;
  previousStatus: string;
  adminUserId: number;
  note?: string | null;
  /**
   * How the link was decided (migration 067). The score is always the
   * one the server recomputed a moment earlier in this transaction,
   * never a number the browser sent.
   */
  matchMethod?: 'manual' | 'suggested' | 'bulk_suggested';
  matchScore?: number | null;
  algorithmVersion?: string | null;
}): Promise<void> {
  await tx`
    INSERT INTO player_link_resolutions
          (target_table, target_id, action, player_id, previous_status,
           admin_user_id, note, match_method, match_score, algorithm_version)
    VALUES (${input.targetTable}, ${input.targetId}, 'linked', ${input.playerId},
            ${input.previousStatus}::link_status, ${input.adminUserId},
            ${(input.note ?? '').trim().slice(0, 2000) || null},
            ${input.matchMethod ?? 'manual'},
            ${input.matchScore ?? null}, ${input.algorithmVersion ?? null})
  `;
}

/**
 * Links one honours row to a player: the single statistical write in
 * this feature, run as afldb_import on a short-lived connection (the
 * promoteSubmission pattern). Guarded to the unresolved statuses so an
 * import-confirmed 'unique' link can never be overwritten from here.
 *
 * The required resolution audit is written inside the same transaction
 * (migration 066, AFLDB-ISSUE-027): if the audit insert fails, the
 * link rolls back with it, so a link can never exist without its
 * resolution row.
 */
export async function resolveLockedLink(
  tx: Tx,
  input: {
    targetTable: LinkTargetTable;
    targetId: number;
    playerId: number;
    adminUserId: number;
    note?: string | null;
    matchMethod?: 'manual' | 'suggested' | 'bulk_suggested';
    matchScore?: number | null;
    algorithmVersion?: string | null;
  }
): Promise<ResolveResult> {
  const target = await lockUnresolvedTarget(tx, input.targetTable, input.targetId);
  if (!target) {
    return { ok: false, error: 'No unresolved row with that id — it may already be linked.' };
  }

  const decision = await classifyLogicalDecision(
    tx, input.targetTable, input.targetId, target.draftPersonId
  );
  if (decision.type === 'contradictory') {
    return { ok: false, error: 'This draft identity has conflicting existing link decisions and cannot be changed until reviewed.' };
  }
  if (decision.type === 'confirmed_unlinked') {
    return { ok: false, error: 'This target was already confirmed unlinked and cannot be linked from a stale form.' };
  }
  if (decision.type === 'linked') {
    return { ok: false, error: 'This target was already linked by another admin.' };
  }

  await applyLockedLink(
    tx, input.targetTable, input.targetId, input.playerId, target.draftPersonId
  );
  await recordLinkedResolution(tx, { ...input, previousStatus: target.previousStatus });
  return { ok: true };
}

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
  try {
    return await importSql.begin((tx) => resolveLockedLink(tx, input));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `The link could not be applied: ${message}` };
  } finally {
    await importSql.end({ timeout: 5 });
  }
}

export type CreateAndResolveResult =
  | { ok: true; player: CreatedPlayer }
  | { ok: false; error: string };

/**
 * Lock an unresolved review target, create the player, and apply the link in
 * one import-role transaction. A stale form returns before the shared player
 * insert helper is called, so it cannot leave an orphan profile behind.
 */
export async function createPlayerAndResolveLink(input: {
  targetTable: LinkTargetTable;
  targetId: number;
  player: CreatePlayerInput;
  adminUserId: number;
  note?: string | null;
}): Promise<CreateAndResolveResult> {
  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!importUrl) return { ok: false, error: 'AFLDB_IMPORT_DATABASE_URL is not configured.' };

  const importSql = postgres(importUrl, { max: 1, onnotice: () => {} });
  try {
    const result = await importSql.begin(async (tx) => {
      const target = await lockUnresolvedTarget(tx, input.targetTable, input.targetId);
      if (!target) return 'already_resolved';

      const decision = await classifyLogicalDecision(
        tx, input.targetTable, input.targetId, target.draftPersonId
      );
      if (decision.type === 'contradictory') return 'contradictory';
      if (decision.type === 'confirmed_unlinked') return 'stale_unlinked';
      if (decision.type === 'linked') return 'already_resolved';

      const player = await createPlayerInTransaction(tx, input.player);
      await applyLockedLink(
        tx,
        input.targetTable,
        input.targetId,
        player.id,
        target.draftPersonId,
      );
      // Required audit, same transaction (AFLDB-ISSUE-027): a failed
      // insert rolls back the player creation and the link together.
      await recordLinkedResolution(tx, {
        targetTable: input.targetTable,
        targetId: input.targetId,
        playerId: player.id,
        previousStatus: target.previousStatus,
        adminUserId: input.adminUserId,
        note: input.note?.trim()
          || `Created player ${player.displayName} and linked to ${input.targetTable} #${input.targetId}`,
      });
      return { ok: true as const, player };
    });

    if (result === 'already_resolved') {
      return { ok: false, error: 'No unresolved row with that id — it may already be linked.' };
    }
    if (result === 'contradictory') {
      return { ok: false, error: 'This draft identity has conflicting existing link decisions and cannot be changed until reviewed.' };
    }
    if (result === 'stale_unlinked') {
      return { ok: false, error: 'This target was already confirmed unlinked and cannot be linked from a stale form.' };
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `The player and link could not be created: ${message}` };
  } finally {
    await importSql.end({ timeout: 5 });
  }
}

export async function confirmLockedUnlinked(
  tx: Tx,
  targetTable: LinkTargetTable,
  targetId: number,
  adminUserId: number,
  note?: string | null,
): Promise<ResolveResult> {
  const target = await lockUnresolvedTarget(tx, targetTable, targetId);
  if (!target) return { ok: false, error: 'No unresolved row with that id — it may already be linked.' };

  const decision = await classifyLogicalDecision(
    tx, targetTable, targetId, target.draftPersonId
  );
  if (decision.type === 'contradictory') {
    return { ok: false, error: 'This draft identity has conflicting existing link decisions and cannot be changed until reviewed.' };
  }
  if (decision.type === 'confirmed_unlinked') {
    return { ok: false, error: 'This target was already confirmed unlinked by another admin.' };
  }
  if (decision.type === 'linked') {
    return { ok: false, error: 'This target was already linked by another admin.' };
  }

  await tx`
    INSERT INTO player_link_resolutions
          (target_table, target_id, action, player_id, previous_status,
           admin_user_id, note)
    VALUES (${targetTable}, ${targetId}, 'confirmed_unlinked', NULL,
            ${target.previousStatus}::link_status, ${adminUserId},
            ${(note ?? '').trim().slice(0, 2000) || null})
  `;
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
  adminUserId: number;
  note?: string | null;
}): Promise<ResolveResult> {
  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!importUrl) return { ok: false, error: 'AFLDB_IMPORT_DATABASE_URL is not configured.' };

  const importSql = postgres(importUrl, { max: 1, onnotice: () => {} });
  try {
    return await importSql.begin((tx) =>
      confirmLockedUnlinked(tx, input.targetTable, input.targetId, input.adminUserId, input.note)
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `The confirmation could not be recorded: ${message}` };
  } finally {
    await importSql.end({ timeout: 5 });
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

export type SuggestedLinkMethod = 'suggested' | 'bulk_suggested';

/**
 * Approve a suggested match.
 *
 * The cache is advice, not authority, so none of it is trusted here.
 * Inside the same import transaction that will do the writing, this:
 *
 *   1. locks the target and confirms it is still unresolved;
 *   2. re-reads the source row's evidence;
 *   3. re-reads the candidates and runs the scorer again;
 *   4. requires the recomputed best candidate to be the very player the
 *      admin is approving, with no contradiction, and -- for a bulk
 *      approval -- to still satisfy bulk eligibility;
 *   5. writes the link and its audit row, recording the score the
 *      SERVER just calculated.
 *
 * A score posted by the browser is therefore incapable of influencing
 * anything: it is not read, and a stale page fails step 4 rather than
 * quietly linking a player the evidence no longer supports.
 */
export async function resolveLinkFromSuggestion(input: {
  targetTable: LinkTargetTable;
  targetId: number;
  playerId: number;
  adminUserId: number;
  method: SuggestedLinkMethod;
  note?: string | null;
}): Promise<ResolveResult> {
  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!importUrl) return { ok: false, error: 'AFLDB_IMPORT_DATABASE_URL is not configured.' };

  const importSql = postgres(importUrl, { max: 1, onnotice: () => {} });
  try {
    const outcome = await importSql.begin(async (tx) => {
      const target = await lockUnresolvedTarget(tx, input.targetTable, input.targetId);
      if (!target) return { ok: false as const, error: 'stale' };

      const entityType = input.targetTable === 'draft_picks' ? 'draft_person' : input.targetTable;
      const entityId = input.targetTable === 'draft_picks'
        ? target.draftPersonId!
        : input.targetId;

      const [row] = await fetchSourceEvidence(tx, {
        status: 'unresolved',
        table: input.targetTable,
        entity: { type: entityType, id: entityId },
      });
      if (!row) return { ok: false as const, error: 'evidence' };

      const assessment = await assessOneSource(tx, row.source);
      const best = assessment.best;
      if (!best || best.playerId !== input.playerId) {
        return { ok: false as const, error: 'changed' };
      }
      if (best.hardConflict) return { ok: false as const, error: 'conflict' };
      if (assessment.band === 'none') return { ok: false as const, error: 'weak' };
      if (input.method === 'bulk_suggested' && !assessment.bulkEligible) {
        return { ok: false as const, error: 'not_bulk' };
      }

      await applyLockedLink(
        tx,
        input.targetTable,
        input.targetId,
        input.playerId,
        target.draftPersonId,
      );
      await recordLinkedResolution(tx, {
        targetTable: input.targetTable,
        targetId: input.targetId,
        playerId: input.playerId,
        previousStatus: target.previousStatus,
        adminUserId: input.adminUserId,
        note: input.note,
        matchMethod: input.method,
        matchScore: best.score,
        algorithmVersion: assessment.algorithmVersion,
      });
      return { ok: true as const };
    }) as { ok: true } | { ok: false; error: string };

    if (outcome.ok) return { ok: true };
    const messages: Record<string, string> = {
      stale: 'No unresolved row with that id — it may already be linked.',
      evidence: 'The source row could not be re-read for scoring.',
      changed:
        'The evidence no longer supports that player as the best match. '
        + 'Refresh the queue and review the suggestion again.',
      conflict: 'That candidate is contradicted by the source evidence and cannot be approved.',
      weak: 'The recomputed confidence is too low to approve as a suggestion.',
      not_bulk: 'That row no longer meets the bulk-approval rules; approve it individually.',
    };
    return { ok: false, error: messages[outcome.error] ?? 'The suggestion could not be approved.' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `The link could not be applied: ${message}` };
  } finally {
    await importSql.end({ timeout: 5 });
  }
}
