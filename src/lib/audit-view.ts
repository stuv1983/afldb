/**
 * Pure helpers for the Admin Centre audit viewer (AFLDB-ISSUE-157, ISSUE-156 P1).
 *
 * Three jobs, none of which needs a database: reading the viewer's URL into
 * validated filters, turning a `data_edits` row's `old_values` / `new_values`
 * snapshots into a field-by-field list, and guarding the one thing the read
 * side must never do to `auth_audit_log.detail` -- decode it a second time.
 *
 * Kept free of `server-only` and of any database import so that
 * tests/admin-audit-viewer.test.ts exercises every branch without a
 * connection, and so the route and the reader module
 * (`src/db/queries/audit-reader.ts`) share one definition of a filter.
 *
 * Security model is the one `src/search/table-filters.ts` states: user input
 * never becomes SQL. A table name is accepted only from the `data_edits`
 * allowlist, an action key only from the values the database already holds,
 * dates only as real calendar dates, and everything reaches PostgreSQL as a
 * bound parameter.
 */

import { isDataEditTableName, type DataEditTableName } from '@/db/queries/audit-log';
import { firstValue, parsePage } from '@/lib/params';

export const AUDIT_PATH = '/admin/audit';

export type AuditTab = 'auth' | 'edits';

export type AuthAuditFilters = {
  /** Free text matched against the recorded label and the actor's current email; digits also match the user id. */
  actor?: string;
  /** An exact `action` key, e.g. `admin.login`. */
  action?: string;
  /** Inclusive UTC calendar date, `YYYY-MM-DD`. */
  from?: string;
  /** Inclusive UTC calendar date, `YYYY-MM-DD`. */
  to?: string;
};

export type DataEditFilters = {
  actor?: string;
  table?: DataEditTableName;
  /** Digits only; bound as bigint, never parsed to a JavaScript number. */
  rowId?: string;
  /** An exact `field_group` key, e.g. `dob` or `match_sheet`. */
  fieldGroup?: string;
  from?: string;
  to?: string;
};

export type AuditView = {
  tab: AuditTab;
  page: number;
  auth: AuthAuditFilters;
  edits: DataEditFilters;
  /** Inputs that could not be honoured, reported rather than silently dropped. */
  errors: string[];
  /** How many filters narrow the current tab. */
  active: number;
};

export const DATA_EDIT_TABLE_LABELS: Record<DataEditTableName, string> = {
  players: 'Players',
  matches: 'Matches',
  draft_picks: 'Draft picks',
  award_winners: 'Award winners',
  hall_of_fame: 'Hall of Fame',
  honour_team_members: 'Honour teams',
  brownlow_vote_entry_state: 'Brownlow match entries',
  brownlow_season_authority: 'Brownlow season authority',
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** `auth_audit_log.action` keys as written today: `admin.login`, `nl_search.telemetry_cleared`. */
const ACTION_KEY = /^[A-Za-z0-9_.:-]{1,80}$/;
/** Digits only, short of the point where a bigint would stop fitting the column. */
const ROW_ID = /^\d{1,18}$/;

/** A real calendar date in `YYYY-MM-DD`, or undefined for anything else. */
export function parseAuditDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const match = ISO_DATE.exec(raw.trim());
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return undefined;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function isAuditRowId(value: string | undefined): value is string {
  return value !== undefined && ROW_ID.test(value);
}

function trimmed(raw: string | undefined, maxLength: number): string | undefined {
  const value = raw?.trim() ?? '';
  if (!value) return undefined;
  return value.slice(0, maxLength);
}

function countActive(filters: Record<string, unknown>): number {
  return Object.values(filters).filter((value) => value !== undefined).length;
}

/**
 * Read the viewer's URL into validated filters.
 *
 * Unknown select values are dropped rather than erroring, so a stale link
 * still renders a sensible table. The two cases reported are a date that is
 * not a date and a range whose start is after its end: both would otherwise
 * show an unfiltered table under a filter the reader believes is applied.
 */
export function parseAuditView(
  params: Record<string, string | string[] | undefined>,
): AuditView {
  const tab: AuditTab = firstValue(params.tab) === 'edits' ? 'edits' : 'auth';
  const page = parsePage(firstValue(params.page));
  const errors: string[] = [];

  const readDate = (key: 'from' | 'to'): string | undefined => {
    const raw = trimmed(firstValue(params[key]), 40);
    if (raw === undefined) return undefined;
    const date = parseAuditDate(raw);
    if (date === undefined) errors.push(`“${raw}” is not a YYYY-MM-DD date; the ${key} bound was ignored.`);
    return date;
  };
  let from = readDate('from');
  let to = readDate('to');
  if (from !== undefined && to !== undefined && from > to) {
    errors.push(`Date range: from (${from}) is after to (${to}); the range was not applied.`);
    from = undefined;
    to = undefined;
  }

  const actor = trimmed(firstValue(params.actor), 100);

  const rawAction = trimmed(firstValue(params.action), 80);
  const action = rawAction !== undefined && ACTION_KEY.test(rawAction) ? rawAction : undefined;

  const rawTable = trimmed(firstValue(params.table), 80);
  const table = rawTable !== undefined && isDataEditTableName(rawTable) ? rawTable : undefined;

  const rawRow = trimmed(firstValue(params.row), 40);
  const rowId = isAuditRowId(rawRow) ? rawRow : undefined;

  const fieldGroup = trimmed(firstValue(params.field), 80);

  const auth: AuthAuditFilters = { actor, action, from, to };
  const edits: DataEditFilters = { actor, table, rowId, fieldGroup, from, to };

  return {
    tab,
    page,
    auth,
    edits,
    errors,
    active: countActive(tab === 'auth' ? auth : edits),
  };
}

/**
 * The current tab's applied filters as URL parameters, for the pager and
 * the tab links. Page is deliberately not carried: a filter change that
 * kept the old page number would land the reader past the end of a smaller
 * result set, and the pager sets it itself.
 */
export function auditQueryParams(
  view: AuditView,
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  const shared = view.tab === 'auth' ? view.auth : view.edits;
  const params: Record<string, string | undefined> = {
    tab: view.tab,
    actor: shared.actor,
    from: shared.from,
    to: shared.to,
  };
  if (view.tab === 'auth') {
    params.action = view.auth.action;
  } else {
    params.table = view.edits.table;
    params.row = view.edits.rowId;
    params.field = view.edits.fieldGroup;
  }
  return { ...params, ...overrides };
}

export function auditHref(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    // The default tab needs no parameter; leaving it off keeps the bare
    // /admin/audit link and the first tab's link the same URL.
    if (key === 'tab' && value === 'auth') continue;
    query.set(key, value);
  }
  const queryString = query.toString();
  return queryString ? `${AUDIT_PATH}?${queryString}` : AUDIT_PATH;
}

export function entityHistoryHref(table: DataEditTableName, rowId: string): string {
  return `${AUDIT_PATH}/entity/${table}/${rowId}`;
}

/** One short phrase per applied filter, for the line above a table. */
export function describeAuditFilters(view: AuditView): string[] {
  const described: string[] = [];
  const shared = view.tab === 'auth' ? view.auth : view.edits;
  if (shared.actor) described.push(`actor “${shared.actor}”`);
  if (view.tab === 'auth') {
    if (view.auth.action) described.push(`action ${view.auth.action}`);
  } else {
    if (view.edits.table) described.push(`table ${DATA_EDIT_TABLE_LABELS[view.edits.table]}`);
    if (view.edits.rowId) described.push(`row #${view.edits.rowId}`);
    if (view.edits.fieldGroup) described.push(`field group ${view.edits.fieldGroup}`);
  }
  if (shared.from && shared.to) described.push(`${shared.from} to ${shared.to} (UTC)`);
  else if (shared.from) described.push(`from ${shared.from} (UTC)`);
  else if (shared.to) described.push(`to ${shared.to} (UTC)`);
  return described;
}

// --- jsonb payloads ---------------------------------------------------

export type AuditDetail = Record<string, unknown>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The shape the viewer renders `auth_audit_log.detail` as.
 *
 * postgres.js has ALREADY decoded the jsonb column by the time a row
 * reaches this function (ISSUE-156 §4): an object is passed through as the
 * same reference, and nothing here ever calls JSON.parse. Since migration
 * 082 the column holds only NULL or a JSON object, so the final branch is
 * a belt-and-braces display path for a value the constraint would refuse
 * today -- it is shown as the value it is, never re-interpreted as text
 * that might contain structure.
 */
export function normaliseDetail(value: unknown): AuditDetail | null {
  if (value === null || value === undefined) return null;
  if (isPlainObject(value)) return value;
  return { value };
}

/** How a snapshot value reads in a cell. NULL stays visibly NULL: it is not zero and not blank. */
export function formatAuditValue(value: unknown, present = true): string {
  if (!present) return '(not recorded)';
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value === '' ? '(empty)' : value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return JSON.stringify(value);
}

export function detailEntries(detail: AuditDetail | null): Array<[string, string]> {
  if (detail === null) return [];
  return Object.entries(detail).map(([key, value]) => [key, formatAuditValue(value)]);
}

export type FieldChange = {
  field: string;
  before: string;
  after: string;
  /** False when the snapshots agree on this field; the row is still listed so the whole group reads. */
  changed: boolean;
};

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * `old_values` against `new_values`, field by field.
 *
 * Keys keep the old snapshot's order, with keys only the new snapshot has
 * appended, so a coupled group such as `score` reads in the order the
 * editor wrote it. A key present in one snapshot and absent from the other
 * is a change even when the present side is null.
 */
export function diffValues(oldValues: unknown, newValues: unknown): FieldChange[] {
  const before = isPlainObject(oldValues) ? oldValues : {};
  const after = isPlainObject(newValues) ? newValues : {};
  const fields = Object.keys(before);
  for (const key of Object.keys(after)) {
    if (!fields.includes(key)) fields.push(key);
  }
  return fields.map((field) => {
    const inBefore = Object.hasOwn(before, field);
    const inAfter = Object.hasOwn(after, field);
    return {
      field,
      before: formatAuditValue(before[field], inBefore),
      after: formatAuditValue(after[field], inAfter),
      changed: inBefore !== inAfter || !sameJson(before[field], after[field]),
    };
  });
}

/** `2026-09-11 03:04:05`, always UTC, matching the filter bounds. */
export function formatAuditTimestamp(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().slice(0, 19).replace('T', ' ');
}
