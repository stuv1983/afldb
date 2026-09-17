import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Admin Centre audit viewer without a database (AFLDB-ISSUE-157,
 * ISSUE-156 P1). Three layers, one file, because they are one feature:
 *
 *   1. The pure helpers in src/lib/audit-view.ts -- URL parsing, the
 *      field-by-field diff, and the rule that a jsonb payload the driver has
 *      already decoded is never decoded again.
 *   2. The readers in src/db/queries/audit-reader.ts, driven through a fake
 *      pool that records the SQL each call would send: every statement is a
 *      SELECT, the bigint columns are selected as text and survive as exact
 *      strings, filters bind their values rather than splicing them, and the
 *      LIKE metacharacters in an actor search are neutralised.
 *   3. The two routes, which must call requireCapability('operations.audit
 *      .read') BEFORE any read: a contributor is bounced with zero queries
 *      issued, an admin and a super admin get their rows.
 *
 * What only PostgreSQL can prove -- that the filters select the right rows --
 * is tests/integration/admin-audit.test.ts.
 */

type Fragment = { __fragment: true; text: string; params: unknown[] };
type CapturedQuery = { text: string; params: unknown[] };

const isFragment = (value: unknown): value is Fragment =>
  typeof value === 'object' && value !== null && (value as Fragment).__fragment === true;

/**
 * Stands in for the auth pool. postgres.js inlines a nested fragment into
 * the statement that interpolates it and renumbers the parameters; this does
 * the same by hand, so `text` is the SQL as the server would receive it (with
 * `?` for each bound value) and `params` are the values in order.
 */
const pool = vi.hoisted(() => {
  const state = {
    queries: [] as CapturedQuery[],
    authRows: [] as unknown[],
    editRows: [] as unknown[],
    actions: [] as string[],
    total: 0,
  };
  const render = (strings: TemplateStringsArray, values: unknown[]) => {
    let text = strings[0];
    const params: unknown[] = [];
    values.forEach((value, i) => {
      if (isFragment(value)) {
        text += value.text;
        params.push(...value.params);
      } else {
        text += '?';
        params.push(value);
      }
      text += strings[i + 1];
    });
    return { text, params };
  };
  const handle = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const { text, params } = render(strings, values);
    // A complete statement is the one thing a fragment never is: paged,
    // counted, or the DISTINCT action list.
    const isStatement = /\bLIMIT\b|count\(\*\)|DISTINCT action/.test(text);
    if (!isStatement) return { __fragment: true, text, params } satisfies Fragment;
    state.queries.push({ text, params });
    if (/count\(\*\)/.test(text)) return Promise.resolve([{ total: state.total }]);
    if (/DISTINCT action/.test(text)) return Promise.resolve(state.actions.map((action) => ({ action })));
    if (/FROM auth_audit_log/.test(text)) return Promise.resolve(state.authRows);
    if (/FROM data_edits/.test(text)) return Promise.resolve(state.editRows);
    return Promise.resolve([]);
  };
  return { state, handle };
});

vi.mock('@/db/authClient', () => ({ authSql: pool.handle }));

/** The signed-in role the mocked guard evaluates, through the real capability table. */
const guard = vi.hoisted(() => ({
  role: 'super_admin' as 'contributor' | 'admin' | 'super_admin',
  calls: [] as string[],
}));

vi.mock('@/lib/auth/session', async () => {
  const { hasCapability } = await import('@/lib/auth/capabilities');
  return {
    requireCapability: vi.fn(async (capability: Parameters<typeof hasCapability>[1]) => {
      guard.calls.push(capability);
      const viewer = { role: guard.role, canManageAdmins: false };
      if (!hasCapability(viewer, capability)) throw new Error('NEXT_REDIRECT');
      return { id: 7, email: `${guard.role}@afldb.test`, ...viewer, mustChangePassword: false };
    }),
  };
});

vi.mock('next/link', () => ({ default: () => null }));
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));

// After the mocks, which vitest hoists above every import in this file.
import type postgres from 'postgres';

import AuditPage from '@/app/admin/audit/page';
import EntityHistoryPage from '@/app/admin/audit/entity/[table]/[rowId]/page';
import {
  AUDIT_PAGE_SIZE,
  listAuthAuditActions,
  listAuthAuditEvents,
  listDataEditHistory,
  listDataEdits,
} from '@/db/queries/audit-reader';
import {
  auditHref,
  auditQueryParams,
  describeAuditFilters,
  diffValues,
  entityHistoryHref,
  formatAuditTimestamp,
  formatAuditValue,
  isAuditRowId,
  normaliseDetail,
  parseAuditDate,
  parseAuditView,
} from '@/lib/audit-view';

const db = pool.handle as unknown as postgres.Sql;

beforeEach(() => {
  pool.state.queries.length = 0;
  pool.state.authRows = [];
  pool.state.editRows = [];
  pool.state.actions = [];
  pool.state.total = 0;
  guard.role = 'super_admin';
  guard.calls.length = 0;
});

describe('parseAuditDate', () => {
  it('accepts a real calendar date and returns it normalised', () => {
    expect(parseAuditDate('2026-09-11')).toBe('2026-09-11');
    expect(parseAuditDate(' 2024-02-29 ')).toBe('2024-02-29');
  });

  it('rejects anything that is not YYYY-MM-DD, including an impossible date', () => {
    // A hand-edited URL is the only way these arrive: <input type=date>
    // submits ISO or nothing. 30 February would otherwise roll into March
    // and silently filter a day the reader did not ask for.
    for (const raw of ['2026-02-30', '2023-02-29', '11/09/2026', '2026-9-1', 'yesterday', '', undefined]) {
      expect(parseAuditDate(raw)).toBeUndefined();
    }
  });
});

describe('parseAuditView', () => {
  it('defaults to the auth ledger, page one, no filters', () => {
    const view = parseAuditView({});
    expect(view).toMatchObject({ tab: 'auth', page: 1, errors: [], active: 0 });
    expect(view.auth).toEqual({ actor: undefined, action: undefined, from: undefined, to: undefined });
  });

  it('reads the edits tab and its own filters, counting only what narrows that tab', () => {
    const view = parseAuditView({
      tab: 'edits', actor: ' super@afldb.test ', table: 'players', row: '123',
      field: 'dob', from: '2026-01-01', to: '2026-01-31', action: 'admin.login', page: '3',
    });
    expect(view.tab).toBe('edits');
    expect(view.page).toBe(3);
    expect(view.edits).toEqual({
      actor: 'super@afldb.test', table: 'players', rowId: '123', fieldGroup: 'dob',
      from: '2026-01-01', to: '2026-01-31',
    });
    expect(view.active).toBe(6);
    // The action key is parsed for the other tab but is not one of this tab's filters.
    expect(view.auth.action).toBe('admin.login');
  });

  it('drops a table outside the data_edits allowlist and a non-numeric row id, silently', () => {
    const view = parseAuditView({ tab: 'edits', table: 'auth_users', row: '12abc' });
    expect(view.edits.table).toBeUndefined();
    expect(view.edits.rowId).toBeUndefined();
    expect(view.errors).toEqual([]);
    expect(view.active).toBe(0);
  });

  it('keeps a row id as the digit string it was, never a Number', () => {
    // data_edits.row_id is bigint; 2^53 + 1 is exactly the value a Number
    // would corrupt.
    const view = parseAuditView({ tab: 'edits', row: '9007199254740993' });
    expect(view.edits.rowId).toBe('9007199254740993');
    expect(isAuditRowId('9007199254740993')).toBe(true);
    expect(isAuditRowId('-1')).toBe(false);
    expect(isAuditRowId('1'.repeat(19))).toBe(false);
  });

  it('rejects an action key with characters no writer has ever used', () => {
    expect(parseAuditView({ action: 'admin.login' }).auth.action).toBe('admin.login');
    expect(parseAuditView({ action: "admin' OR 1=1" }).auth.action).toBeUndefined();
  });

  it('reports, rather than drops, a malformed date and an inverted range', () => {
    const malformed = parseAuditView({ from: '2026-13-01' });
    expect(malformed.auth.from).toBeUndefined();
    expect(malformed.errors).toHaveLength(1);
    expect(malformed.errors[0]).toMatch(/2026-13-01/);

    const inverted = parseAuditView({ from: '2026-02-01', to: '2026-01-01' });
    expect(inverted.auth.from).toBeUndefined();
    expect(inverted.auth.to).toBeUndefined();
    expect(inverted.errors[0]).toMatch(/after/);
    expect(inverted.active).toBe(0);
  });

  it('clamps the page the way every other list does', () => {
    expect(parseAuditView({ page: '0' }).page).toBe(1);
    expect(parseAuditView({ page: 'x' }).page).toBe(1);
    expect(parseAuditView({ page: '999999' }).page).toBe(10_000);
  });
});

describe('audit URLs', () => {
  it('rebuilds the current tab\'s filters without the page, and leaves the default tab implicit', () => {
    const view = parseAuditView({ actor: 'stu', action: 'admin.login', page: '4', from: '2026-01-01' });
    expect(auditQueryParams(view)).toEqual({
      tab: 'auth', actor: 'stu', from: '2026-01-01', to: undefined, action: 'admin.login',
    });
    expect(auditHref(auditQueryParams(view))).toBe('/admin/audit?actor=stu&from=2026-01-01&action=admin.login');
    expect(auditHref(auditQueryParams(view, { page: '2' }))).toContain('page=2');
  });

  it('carries the edits tab explicitly and its filters only', () => {
    const view = parseAuditView({ tab: 'edits', table: 'matches', row: '5', action: 'admin.login' });
    const params = auditQueryParams(view);
    expect(params).toMatchObject({ tab: 'edits', table: 'matches', row: '5' });
    expect(params).not.toHaveProperty('action');
    expect(auditHref(params)).toBe('/admin/audit?tab=edits&table=matches&row=5');
    expect(auditHref({})).toBe('/admin/audit');
  });

  it('addresses one entity\'s history by table and row id', () => {
    expect(entityHistoryHref('players', '123')).toBe('/admin/audit/entity/players/123');
  });

  it('describes the applied filters in words', () => {
    const view = parseAuditView({ tab: 'edits', table: 'players', row: '9', from: '2026-01-01', to: '2026-01-31' });
    expect(describeAuditFilters(view)).toEqual([
      'table Players', 'row #9', '2026-01-01 to 2026-01-31 (UTC)',
    ]);
    expect(describeAuditFilters(parseAuditView({}))).toEqual([]);
  });
});

describe('normaliseDetail (jsonb already decoded by the driver)', () => {
  it('passes a decoded object through as the same reference, and NULL as null', () => {
    const detail = { deletedLogRows: 4953, nested: { ok: true } };
    expect(normaliseDetail(detail)).toBe(detail);
    expect(normaliseDetail(null)).toBeNull();
    expect(normaliseDetail(undefined)).toBeNull();
  });

  it('never JSON.parses a string, even one that looks like JSON', () => {
    // The double-decode trap (ISSUE-156 §4): a string here is a string the
    // trail recorded, and since migration 082 cannot occur at all. It is
    // shown, not reinterpreted.
    expect(normaliseDetail('{"a":1}')).toEqual({ value: '{"a":1}' });
    expect(normaliseDetail(7)).toEqual({ value: 7 });
    expect(normaliseDetail([1, 2])).toEqual({ value: [1, 2] });
  });
});

describe('diffValues', () => {
  it('lists every field of a coupled group, marking only the ones that changed', () => {
    const rows = diffValues(
      { home_goals: 12, home_behinds: 9, away_goals: 8 },
      { home_goals: 13, home_behinds: 9, away_goals: 8 },
    );
    expect(rows).toEqual([
      { field: 'home_goals', before: '12', after: '13', changed: true },
      { field: 'home_behinds', before: '9', after: '9', changed: false },
      { field: 'away_goals', before: '8', after: '8', changed: false },
    ]);
  });

  it('keeps NULL visibly distinct from zero and from an empty string', () => {
    // "Not recorded" is a value in this schema (CLAUDE.md §11).
    const rows = diffValues({ attendance: null, note: '' }, { attendance: 0, note: null });
    expect(rows).toEqual([
      { field: 'attendance', before: 'null', after: '0', changed: true },
      { field: 'note', before: '(empty)', after: 'null', changed: true },
    ]);
  });

  it('treats a key present on one side only as a change, and appends new-only keys after the old order', () => {
    const rows = diffValues({ b: 1, a: 2 }, { a: 2, c: 3 });
    expect(rows.map((r) => r.field)).toEqual(['b', 'a', 'c']);
    expect(rows[0]).toEqual({ field: 'b', before: '1', after: '(not recorded)', changed: true });
    expect(rows[1].changed).toBe(false);
    expect(rows[2]).toEqual({ field: 'c', before: '(not recorded)', after: '3', changed: true });
  });

  it('renders nested structure as compact JSON and copes with a non-object snapshot', () => {
    const rows = diffValues({ players: [{ id: 1 }] }, { players: [{ id: 1 }, { id: 2 }] });
    expect(rows[0].before).toBe('[{"id":1}]');
    expect(rows[0].after).toBe('[{"id":1},{"id":2}]');
    expect(rows[0].changed).toBe(true);
    expect(diffValues(null, 'nonsense')).toEqual([]);
    expect(formatAuditValue(true)).toBe('true');
  });
});

describe('formatAuditTimestamp', () => {
  it('prints UTC to the second, matching the filter bounds', () => {
    expect(formatAuditTimestamp(new Date('2026-09-11T03:04:05.678Z'))).toBe('2026-09-11 03:04:05');
    expect(formatAuditTimestamp('2026-09-11T23:59:59Z')).toBe('2026-09-11 23:59:59');
  });
});

describe('audit readers (fake pool)', () => {
  const statements = () => pool.state.queries.map((q) => q.text);

  it('issues SELECT statements only, and never a write, on both ledgers', async () => {
    await listAuthAuditEvents({ actor: 'x', action: 'admin.login', from: '2026-01-01', to: '2026-01-31' }, 1, 50, db);
    await listAuthAuditActions(db);
    await listDataEdits({ actor: 'x', table: 'players', rowId: '1', fieldGroup: 'dob', from: '2026-01-01', to: '2026-01-31' }, 1, 50, db);
    await listDataEditHistory('players', '1', db);

    expect(statements().length).toBeGreaterThanOrEqual(6);
    for (const text of statements()) {
      expect(text.trimStart()).toMatch(/^SELECT\b/);
      expect(text).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/);
    }
  });

  it('selects the bigint columns as text and returns the id exactly, not as a rounded Number', async () => {
    const detail = { deletedLogRows: 4953 };
    pool.state.total = 1;
    pool.state.authRows = [{
      id: '9007199254740993', at: new Date('2026-09-11T00:00:00Z'), actorUserId: 9,
      actorLabel: 'super@afldb.test', actorEmail: 'super@afldb.test', action: 'x', detail, ip: '203.0.113.9',
    }];

    const page = await listAuthAuditEvents({}, 1, 50, db);

    expect(statements()[1]).toMatch(/a\.id::text\s+AS id/);
    expect(page.rows[0].id).toBe('9007199254740993');
    expect(typeof page.rows[0].id).toBe('string');
    // Not re-decoded: the very object the driver handed back.
    expect(page.rows[0].detail).toBe(detail);
  });

  it('keeps data_edits.id and row_id as text end to end', async () => {
    pool.state.total = 1;
    pool.state.editRows = [{
      id: '9007199254740993', tableName: 'players', rowId: '9007199254740995', fieldGroup: 'dob',
      oldValues: { dob: '1990-01-01' }, newValues: { dob: '1990-01-02' }, adminUserId: 9,
      adminEmail: 'super@afldb.test', note: null, createdAt: new Date(),
    }];

    const page = await listDataEdits({}, 1, 50, db);
    const history = await listDataEditHistory('players', '9007199254740995', db);

    expect(statements()[1]).toMatch(/e\.id::text\s+AS id/);
    expect(statements()[1]).toMatch(/e\.row_id::text\s+AS "rowId"/);
    expect(page.rows[0].id).toBe('9007199254740993');
    expect(page.rows[0].rowId).toBe('9007199254740995');
    expect(history[0].rowId).toBe('9007199254740995');
    // The history lookup binds the digits as text and casts on the server.
    expect(statements()[2]).toMatch(/e\.row_id = \?::bigint/);
    expect(pool.state.queries[2].params).toEqual(['players', '9007199254740995', 500]);
  });

  it('binds every filter as a parameter and neutralises LIKE metacharacters in the actor search', async () => {
    await listAuthAuditEvents(
      { actor: 'a%b_c\\d', action: 'admin.login', from: '2026-01-01', to: '2026-01-31' }, 1, 50, db,
    );
    const [count] = pool.state.queries;

    expect(count.text).toMatch(/a\.actor_label ILIKE \? ESCAPE '\\'/);
    expect(count.text).toMatch(/u\.email ILIKE \? ESCAPE '\\'/);
    expect(count.text).not.toMatch(/actor_user_id = \?/);
    expect(count.text).toMatch(/a\.action = \?/);
    expect(count.text).toMatch(/a\.at >= \(\(\?::date\)::timestamp AT TIME ZONE 'UTC'\)/);
    expect(count.text).toMatch(/a\.at < \(\(\(\?::date\) \+ 1\)::timestamp AT TIME ZONE 'UTC'\)/);
    expect(count.params).toEqual([
      '%a\\%b\\_c\\\\d%', '%a\\%b\\_c\\\\d%', 'admin.login', '2026-01-01', '2026-01-31',
    ]);
    // The raw text never reaches the statement.
    expect(count.text).not.toContain('a%b_c');
  });

  it('also matches an all-digit actor search against the user id, on both ledgers', async () => {
    await listAuthAuditEvents({ actor: '42' }, 1, 50, db);
    expect(pool.state.queries[0].text).toMatch(/OR a\.actor_user_id = \?\)/);
    expect(pool.state.queries[0].params).toEqual(['%42%', '%42%', 42]);

    pool.state.queries.length = 0;
    await listDataEdits({ actor: '42', table: 'matches', rowId: '77', fieldGroup: 'score' }, 1, 50, db);
    const [count] = pool.state.queries;
    expect(count.text).toMatch(/u\.email ILIKE \? ESCAPE '\\' OR e\.admin_user_id = \?\)/);
    expect(count.text).toMatch(/e\.table_name = \?/);
    expect(count.text).toMatch(/e\.row_id = \?::bigint/);
    expect(count.text).toMatch(/e\.field_group = \?/);
    expect(count.params).toEqual(['%42%', 42, 'matches', '77', 'score']);
  });

  it('emits no filter clause for an empty filter set', async () => {
    await listAuthAuditEvents({}, 1, 50, db);
    const [count, rows] = pool.state.queries;
    expect(count.text).not.toMatch(/ILIKE|a\.action =|AT TIME ZONE/);
    expect(count.params).toEqual([]);
    expect(rows.text).toMatch(/ORDER BY a\.at DESC, a\.id DESC/);
    expect(rows.params).toEqual([AUDIT_PAGE_SIZE, 0]);
  });

  it('pages server-side, clamps a request past the end to the last page, and bounds the page size', async () => {
    pool.state.total = 120;
    const page = await listAuthAuditEvents({}, 99, 50, db);
    expect(page).toMatchObject({ total: 120, page: 3, pageSize: 50, totalPages: 3 });
    expect(pool.state.queries[1].params).toEqual([50, 100]);

    pool.state.queries.length = 0;
    const capped = await listDataEdits({}, 1, 5_000, db);
    expect(capped.pageSize).toBe(200);
    expect(pool.state.queries[1].params).toEqual([200, 0]);

    pool.state.queries.length = 0;
    const defaulted = await listDataEdits({}, 1, 0, db);
    expect(defaulted.pageSize).toBe(AUDIT_PAGE_SIZE);
  });
});

describe('/admin/audit route boundary', () => {
  const searchParams = (params: Record<string, string> = {}) => Promise.resolve(params);

  it('bounces a contributor before any query is issued', async () => {
    guard.role = 'contributor';
    await expect(AuditPage({ searchParams: searchParams() })).rejects.toThrow('NEXT_REDIRECT');
    await expect(AuditPage({ searchParams: searchParams({ tab: 'edits' }) })).rejects.toThrow('NEXT_REDIRECT');
    expect(guard.calls).toEqual(['operations.audit.read', 'operations.audit.read']);
    expect(pool.state.queries).toHaveLength(0);
  });

  it('serves an admin and a super admin, guarding with operations.audit.read before reading', async () => {
    for (const role of ['admin', 'super_admin'] as const) {
      guard.role = role;
      guard.calls.length = 0;
      pool.state.queries.length = 0;

      await expect(AuditPage({ searchParams: searchParams() })).resolves.toBeTruthy();

      expect(guard.calls).toEqual(['operations.audit.read']);
      // The auth ledger: the action list, the count and the page.
      expect(pool.state.queries.map((q) => q.text)).toEqual([
        expect.stringContaining('DISTINCT action'),
        expect.stringContaining('count(*)'),
        expect.stringMatching(/FROM auth_audit_log[\s\S]*LIMIT/),
      ]);
    }
  });

  it('reads the edits ledger with the URL\'s validated filters', async () => {
    await AuditPage({ searchParams: searchParams({ tab: 'edits', table: 'players', row: '12', actor: 'stu' }) });
    const [count] = pool.state.queries;
    expect(count.text).toContain('FROM data_edits');
    expect(count.params).toEqual(['%stu%', 'players', '12']);
  });

  it('bounces a contributor from an entity history before any query is issued', async () => {
    guard.role = 'contributor';
    await expect(
      EntityHistoryPage({ params: Promise.resolve({ table: 'players', rowId: '12' }) }),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(pool.state.queries).toHaveLength(0);
  });

  it('404s an entity outside the data_edits allowlist or with a non-numeric id, without querying', async () => {
    guard.role = 'admin';
    for (const params of [{ table: 'auth_users', rowId: '1' }, { table: 'players', rowId: '1;drop' }]) {
      await expect(EntityHistoryPage({ params: Promise.resolve(params) })).rejects.toThrow('NEXT_NOT_FOUND');
    }
    expect(guard.calls).toEqual(['operations.audit.read', 'operations.audit.read']);
    expect(pool.state.queries).toHaveLength(0);
  });

  it('reads one entity\'s history for an admin', async () => {
    guard.role = 'admin';
    await expect(
      EntityHistoryPage({ params: Promise.resolve({ table: 'players', rowId: '12' }) }),
    ).resolves.toBeTruthy();
    expect(pool.state.queries).toHaveLength(1);
    expect(pool.state.queries[0].params).toEqual(['players', '12', 500]);
  });
});
