import 'server-only';

import type postgres from 'postgres';

import { authSql } from '@/db/authClient';
import type { DataEditTableName } from '@/db/queries/audit-log';
import {
  normaliseDetail,
  type AuditDetail,
  type AuthAuditFilters,
  type DataEditFilters,
} from '@/lib/audit-view';
import { containsPattern } from '@/lib/like';

/**
 * SELECT-only readers over the two audit ledgers (AFLDB-ISSUE-157, ISSUE-156 P1).
 *
 * The writers stay where they are: `recordDataEdit` in audit-log.ts on the
 * import role's transaction, `insertAuditRow` in session.ts on the auth
 * pool. This module adds no INSERT, UPDATE or DELETE and holds no
 * transaction; every statement is a SELECT on the auth pool, which already
 * has SELECT on both tables (tools/maintenance/privileges.sql:441 and :463).
 * No migration and no privilege change accompany it.
 *
 * Two driver facts bind every function here (ISSUE-156 §4):
 *
 *   - `auth_audit_log.id`, `data_edits.id` and `data_edits.row_id` are
 *     bigint, which postgres.js returns as a STRING. They are selected as
 *     `::text` and typed as strings end to end, so no caller can key a
 *     lookup on a number that silently misses.
 *   - `auth_audit_log.detail` and the `data_edits` snapshots are jsonb, which
 *     the driver decodes. Nothing here parses them again.
 *
 * Every reader takes its handle last, defaulting to the auth pool, so the
 * integration suite can hand it a rolled-back transaction on the test
 * database (the `admin-users.ts` precedent) and commit nothing.
 */

export const AUDIT_PAGE_SIZE = 50;
const MAX_AUDIT_PAGE_SIZE = 200;

/** The auth pool, or a transaction handle on the test database (a TransactionSql is a Sql). */
type Db = postgres.Sql;

export type AuthAuditEvent = {
  id: string;
  at: Date;
  actorUserId: number | null;
  /** The email as recorded at the time, or null for an anonymous event such as a failed login. */
  actorLabel: string | null;
  /** The account's current email, when `actor_user_id` still names one. */
  actorEmail: string | null;
  action: string;
  detail: AuditDetail | null;
  ip: string | null;
};

export type DataEditRecord = {
  id: string;
  tableName: DataEditTableName;
  rowId: string;
  fieldGroup: string;
  oldValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
  adminUserId: number;
  adminEmail: string | null;
  note: string | null;
  createdAt: Date;
};

export type AuditPage<T> = {
  rows: T[];
  total: number;
  /** The page actually served: a request past the end is clamped to the last page. */
  page: number;
  pageSize: number;
  totalPages: number;
};

function clampPageSize(pageSize: number): number {
  if (!Number.isInteger(pageSize) || pageSize < 1) return AUDIT_PAGE_SIZE;
  return Math.min(pageSize, MAX_AUDIT_PAGE_SIZE);
}

function pageWindow(page: number, pageSize: number, total: number) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Number.isInteger(page) ? Math.min(Math.max(1, page), totalPages) : 1;
  return { current, totalPages, offset: (current - 1) * pageSize };
}

/** Digits that fit a PostgreSQL integer, for the "actor is a user id" reading of the actor box. */
function actorUserId(actor: string): number | null {
  return /^\d{1,9}$/.test(actor) ? Number(actor) : null;
}

/**
 * The `[from, to]` calendar-date bounds as half-open UTC instants, so the
 * filter and the rendered `YYYY-MM-DD HH:MM:SS` timestamps agree on what
 * day an event belongs to regardless of the server's session time zone.
 */
function dateBounds(db: Db, column: postgres.PendingQuery<postgres.Row[]>, from?: string, to?: string) {
  const lower = from
    ? db`AND ${column} >= ((${from}::date)::timestamp AT TIME ZONE 'UTC')`
    : db``;
  const upper = to
    ? db`AND ${column} < (((${to}::date) + 1)::timestamp AT TIME ZONE 'UTC')`
    : db``;
  return db`${lower} ${upper}`;
}

function authWhere(db: Db, filters: AuthAuditFilters) {
  const actor = filters.actor?.trim();
  let actorClause = db``;
  if (actor) {
    const pattern = containsPattern(actor);
    const id = actorUserId(actor);
    const byId = id === null ? db`` : db`OR a.actor_user_id = ${id}`;
    actorClause = db`AND (a.actor_label ILIKE ${pattern} ESCAPE '\\'
                         OR u.email ILIKE ${pattern} ESCAPE '\\' ${byId})`;
  }
  const actionClause = filters.action ? db`AND a.action = ${filters.action}` : db``;
  return db`${actorClause} ${actionClause} ${dateBounds(db, db`a.at`, filters.from, filters.to)}`;
}

type RawAuthEvent = Omit<AuthAuditEvent, 'detail'> & { detail: unknown };

function toAuthAuditEvent(raw: RawAuthEvent): AuthAuditEvent {
  return {
    ...raw,
    // `::text` in the SELECT already made this a string; String() is only
    // there so a future column change cannot quietly hand back a number.
    id: String(raw.id),
    detail: normaliseDetail(raw.detail),
  };
}

/**
 * One page of `auth_audit_log`, newest first, with the total for the pager.
 * The auth_users join is a LEFT JOIN: anonymous events (failed logins,
 * invites accepted before an account exists) have no actor id.
 */
export async function listAuthAuditEvents(
  filters: AuthAuditFilters,
  page = 1,
  pageSize = AUDIT_PAGE_SIZE,
  db: Db = authSql,
): Promise<AuditPage<AuthAuditEvent>> {
  const size = clampPageSize(pageSize);
  const [{ total }] = await db<{ total: number }[]>`
    SELECT count(*)::int AS total
      FROM auth_audit_log a
      LEFT JOIN auth_users u ON u.id = a.actor_user_id
     WHERE true ${authWhere(db, filters)}
  `;
  const { current, totalPages, offset } = pageWindow(page, size, total);
  const rows = await db<RawAuthEvent[]>`
    SELECT a.id::text        AS id,
           a.at,
           a.actor_user_id   AS "actorUserId",
           a.actor_label     AS "actorLabel",
           u.email           AS "actorEmail",
           a.action,
           a.detail,
           a.ip::text        AS ip
      FROM auth_audit_log a
      LEFT JOIN auth_users u ON u.id = a.actor_user_id
     WHERE true ${authWhere(db, filters)}
     ORDER BY a.at DESC, a.id DESC
     LIMIT ${size} OFFSET ${offset}
  `;
  return { rows: rows.map(toAuthAuditEvent), total, page: current, pageSize: size, totalPages };
}

/** Every distinct `action` key the trail holds, for the filter's select. */
export async function listAuthAuditActions(db: Db = authSql): Promise<string[]> {
  const rows = await db<{ action: string }[]>`
    SELECT DISTINCT action FROM auth_audit_log ORDER BY action
  `;
  return rows.map((row) => row.action);
}

function editsWhere(db: Db, filters: DataEditFilters) {
  const actor = filters.actor?.trim();
  let actorClause = db``;
  if (actor) {
    const pattern = containsPattern(actor);
    const id = actorUserId(actor);
    const byId = id === null ? db`` : db`OR e.admin_user_id = ${id}`;
    actorClause = db`AND (u.email ILIKE ${pattern} ESCAPE '\\' ${byId})`;
  }
  const tableClause = filters.table ? db`AND e.table_name = ${filters.table}` : db``;
  // Bound as text and cast on the server, so a row id beyond 2^53 is
  // compared exactly rather than through a JavaScript number.
  const rowClause = filters.rowId ? db`AND e.row_id = ${filters.rowId}::bigint` : db``;
  const fieldClause = filters.fieldGroup ? db`AND e.field_group = ${filters.fieldGroup}` : db``;
  return db`${actorClause} ${tableClause} ${rowClause} ${fieldClause}
            ${dateBounds(db, db`e.created_at`, filters.from, filters.to)}`;
}

/** The one SELECT list for a data_edits row, as a parameter-free fragment both readers below open with. */
function dataEditColumns(db: Db) {
  return db`
    SELECT e.id::text        AS id,
           e.table_name      AS "tableName",
           e.row_id::text    AS "rowId",
           e.field_group     AS "fieldGroup",
           e.old_values      AS "oldValues",
           e.new_values      AS "newValues",
           e.admin_user_id   AS "adminUserId",
           u.email           AS "adminEmail",
           e.note,
           e.created_at      AS "createdAt"
      FROM data_edits e
      LEFT JOIN auth_users u ON u.id = e.admin_user_id`;
}

function toDataEditRecord(raw: DataEditRecord): DataEditRecord {
  return { ...raw, id: String(raw.id), rowId: String(raw.rowId) };
}

/** One page of `data_edits`, newest first, with the total for the pager. */
export async function listDataEdits(
  filters: DataEditFilters,
  page = 1,
  pageSize = AUDIT_PAGE_SIZE,
  db: Db = authSql,
): Promise<AuditPage<DataEditRecord>> {
  const size = clampPageSize(pageSize);
  const [{ total }] = await db<{ total: number }[]>`
    SELECT count(*)::int AS total
      FROM data_edits e
      LEFT JOIN auth_users u ON u.id = e.admin_user_id
     WHERE true ${editsWhere(db, filters)}
  `;
  const { current, totalPages, offset } = pageWindow(page, size, total);
  const rows = await db<DataEditRecord[]>`
    ${dataEditColumns(db)}
     WHERE true ${editsWhere(db, filters)}
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT ${size} OFFSET ${offset}
  `;
  return { rows: rows.map(toDataEditRecord), total, page: current, pageSize: size, totalPages };
}

/** How many edits the per-entity view will show at most; ix_data_edits_target makes the read cheap. */
export const ENTITY_HISTORY_LIMIT = 500;

/**
 * Every recorded edit of one entity, newest first: who changed it, when,
 * and the two snapshots the page renders field by field.
 */
export async function listDataEditHistory(
  tableName: DataEditTableName,
  rowId: string,
  db: Db = authSql,
): Promise<DataEditRecord[]> {
  const rows = await db<DataEditRecord[]>`
    ${dataEditColumns(db)}
     WHERE e.table_name = ${tableName}
       AND e.row_id = ${rowId}::bigint
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT ${ENTITY_HISTORY_LIMIT}
  `;
  return rows.map(toDataEditRecord);
}
