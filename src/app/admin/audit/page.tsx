import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment } from 'react';

import { AdminPager } from '@/components/admin/AdminPager';
import { DATA_EDIT_TABLE_NAMES } from '@/db/queries/audit-log';
import {
  listAuthAuditActions,
  listAuthAuditEvents,
  listDataEdits,
  type AuditPage as AuditPageResult,
  type AuthAuditEvent,
  type DataEditRecord,
} from '@/db/queries/audit-reader';
import {
  AUDIT_PATH,
  DATA_EDIT_TABLE_LABELS,
  auditHref,
  auditQueryParams,
  describeAuditFilters,
  detailEntries,
  diffValues,
  entityHistoryHref,
  formatAuditTimestamp,
  parseAuditView,
  type AuditTab,
  type AuditView,
} from '@/lib/audit-view';
import { requireCapability } from '@/lib/auth/session';
import { formatNumber } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Audit trail',
  robots: { index: false, follow: false },
};

const TAB_LABELS: Record<AuditTab, string> = {
  auth: 'Sign-ins & administration',
  edits: 'Data edits',
};

/** Changed fields shown inline per data_edits row before the history page takes over. */
const INLINE_CHANGE_LIMIT = 4;

/**
 * The read-only viewer over the two audit ledgers (AFLDB-ISSUE-157,
 * ISSUE-156 P1): `auth_audit_log` (sign-ins, refusals, administrative
 * actions, written by the auth pool) and `data_edits` (every manual
 * statistical mutation with its old and new values, written in the same
 * transaction as the mutation). Until this page the only way to read either
 * was SQL.
 *
 * One tab per ledger, a plain GET filter form so every view is a shareable
 * URL, and server-side paging so the client never receives more than one
 * page. Nothing here writes: the module it reads through is SELECT-only.
 *
 * The guard is the first await. A contributor is redirected before a query
 * is issued, and the sidebar link is furniture -- see nav-model.ts.
 */
export default async function AuditPage(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  await requireCapability('operations.audit.read');
  const params = await searchParams;
  const view = parseAuditView(params);

  // Both reads happen here, after the guard, not inside a child component:
  // the order "guard, then query" is the contract tests/admin-audit-viewer
  // .test.ts asserts, and a page-level await keeps it visible.
  const ledger = view.tab === 'auth'
    ? await (async () => {
      const [actions, result] = await Promise.all([
        listAuthAuditActions(),
        listAuthAuditEvents(view.auth, view.page),
      ]);
      return { tab: 'auth' as const, actions, result };
    })()
    : { tab: 'edits' as const, result: await listDataEdits(view.edits, view.page) };

  const pageHref = (page: number) =>
    auditHref(auditQueryParams(view, { page: page > 1 ? String(page) : undefined }));

  // Switching ledger keeps the actor and dates -- they mean the same thing
  // on both -- and drops the filters that belong to one ledger only.
  const tabHref = (tab: AuditTab) => {
    const shared = view.tab === 'auth' ? view.auth : view.edits;
    return auditHref({ tab, actor: shared.actor, from: shared.from, to: shared.to });
  };

  const described = describeAuditFilters(view);
  const summaryFor = (result: AuditPageResult<unknown>, noun: string) => (
    <>
      {' · '}{formatNumber(result.total)} {noun}
      {described.length > 0 ? ` matching ${described.join(', ')}` : ''}
    </>
  );

  return (
    <>
      <div className="page-header">
        <h1>Audit trail</h1>
        <p className="subtitle">
          Who did what, and when. Sign-ins, refusals and administrative actions are one ledger;
          manual edits to the statistical record, with the values before and after, are the
          other. Both are append-only and this page only reads them. Times are UTC.
        </p>
      </div>

      <nav className="section" aria-label="Ledger">
        {(['auth', 'edits'] as const).map((tab, index) => (
          <span key={tab}>
            {index > 0 ? ' · ' : ''}
            {view.tab === tab
              ? <strong aria-current="page">{TAB_LABELS[tab]}</strong>
              : <Link href={tabHref(tab)}>{TAB_LABELS[tab]}</Link>}
          </span>
        ))}
      </nav>

      {view.errors.map((error) => (
        <p key={error} className="notice">{error}</p>
      ))}

      {ledger.tab === 'auth'
        ? (
          <AuthLedger
            view={view}
            actions={ledger.actions}
            result={ledger.result}
            pageHref={pageHref}
            summaryFor={summaryFor}
          />
        )
        : <EditsLedger view={view} result={ledger.result} pageHref={pageHref} summaryFor={summaryFor} />}
    </>
  );
}

type LedgerProps<T> = {
  view: AuditView;
  result: AuditPageResult<T>;
  pageHref: (page: number) => string;
  summaryFor: (result: AuditPageResult<unknown>, noun: string) => React.ReactNode;
};

function AuthLedger(
  { view, actions, result, pageHref, summaryFor }: LedgerProps<AuthAuditEvent> & { actions: string[] },
) {
  const summary = summaryFor(result, result.total === 1 ? 'event' : 'events');

  return (
    <>
      <FilterPanel view={view} actions={actions} />

      <AdminPager page={result.page} totalPages={result.totalPages} pageHref={pageHref} summary={summary} label="Event pages" />

      {result.total === 0 ? (
        <EmptyLedger described={describeAuditFilters(view)} noun="events" />
      ) : (
        <section className="section">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">When (UTC)</th>
                  <th scope="col">Action</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((event) => <AuthEventRow key={event.id} event={event} />)}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <AdminPager page={result.page} totalPages={result.totalPages} pageHref={pageHref} summary={summary} label="Event pages" />
    </>
  );
}

function AuthEventRow({ event }: { event: AuthAuditEvent }) {
  const entries = detailEntries(event.detail);
  const showCurrentEmail = event.actorEmail !== null && event.actorEmail !== event.actorLabel;
  // Four columns, not five: the user id and the IP sit under the actor,
  // so the detail payload keeps the width a desktop has to give it.
  return (
    <tr>
      <td className="nowrap muted">{formatAuditTimestamp(event.at)}</td>
      <td className="nowrap"><code>{event.action}</code></td>
      <td className="audit-wrap">
        {event.actorLabel ?? <span className="muted">—</span>}
        {event.actorUserId !== null && (
          <span className="audit-meta">
            #{event.actorUserId}{showCurrentEmail ? ` · now ${event.actorEmail}` : ''}
          </span>
        )}
        {event.ip && <span className="audit-meta">{event.ip}</span>}
      </td>
      <td className="audit-payload">
        {entries.length === 0
          ? <span className="muted">—</span>
          : (
            <div className="audit-kv">
              {entries.map(([key, value]) => (
                <Fragment key={key}>
                  <code>{key}</code>
                  <span>{value}</span>
                </Fragment>
              ))}
            </div>
          )}
      </td>
    </tr>
  );
}

function EditsLedger({ view, result, pageHref, summaryFor }: LedgerProps<DataEditRecord>) {
  const summary = summaryFor(result, result.total === 1 ? 'edit' : 'edits');

  return (
    <>
      <FilterPanel view={view} actions={[]} />

      <AdminPager page={result.page} totalPages={result.totalPages} pageHref={pageHref} summary={summary} label="Edit pages" />

      {result.total === 0 ? (
        <EmptyLedger described={describeAuditFilters(view)} noun="edits" />
      ) : (
        <section className="section">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">When (UTC)</th>
                  <th scope="col">Entity</th>
                  <th scope="col">Change</th>
                  <th scope="col">By</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((edit) => <DataEditRow key={edit.id} edit={edit} />)}
              </tbody>
            </table>
          </div>
          <p className="section-note">
            Each entity links to its full history: every recorded edit with the whole
            before-and-after snapshot, field by field.
          </p>
        </section>
      )}

      <AdminPager page={result.page} totalPages={result.totalPages} pageHref={pageHref} summary={summary} label="Edit pages" />
    </>
  );
}

function DataEditRow({ edit }: { edit: DataEditRecord }) {
  const changes = diffValues(edit.oldValues, edit.newValues).filter((change) => change.changed);
  const shown = changes.slice(0, INLINE_CHANGE_LIMIT);
  const historyHref = entityHistoryHref(edit.tableName, edit.rowId);
  // Four columns: the field group rides under the entity and the note under
  // the changes, so the Change column has the room each before → after pair
  // needs to read as two lines rather than one compressed run.
  return (
    <tr>
      <td className="nowrap muted">{formatAuditTimestamp(edit.createdAt)}</td>
      <td className="audit-wrap">
        <Link href={historyHref}>
          {DATA_EDIT_TABLE_LABELS[edit.tableName]} #{edit.rowId}
        </Link>
        <span className="audit-meta"><code>{edit.fieldGroup}</code></span>
      </td>
      <td className="audit-payload">
        {shown.length === 0 ? (
          <span className="muted">Recorded without a field-level change</span>
        ) : shown.map((change) => (
          <div key={change.field} className="audit-change">
            <code className="audit-field">{change.field}</code>
            <span className="audit-before">{change.before}</span>
            <span className="audit-arrow" aria-hidden="true">→</span>
            <span className="audit-after">{change.after}</span>
          </div>
        ))}
        {changes.length > shown.length && (
          <span className="audit-meta">
            <Link href={historyHref}>+{changes.length - shown.length} more…</Link>
          </span>
        )}
        {edit.note && <span className="audit-meta">Note: {edit.note}</span>}
      </td>
      <td className="audit-wrap muted">{edit.adminEmail ?? `#${edit.adminUserId}`}</td>
    </tr>
  );
}

function EmptyLedger({ described, noun }: { described: string[]; noun: string }) {
  return (
    <section className="section">
      <div className="empty">
        <h3>No {noun} match</h3>
        <p>
          {described.length > 0
            ? `Nothing recorded for ${described.join(', ')}. Widen the filters or reset them.`
            : `Nothing has been recorded in this ledger yet.`}
        </p>
      </div>
    </section>
  );
}

/**
 * The GET filter form, in the site's `filter-details` clothing (the same
 * classes `TableFilters` uses on the public list pages) so it folds away
 * until wanted and opens by itself when a filter is applied. Local to this
 * route: no second admin route has a date-ranged filter yet, so there is
 * nothing to extract.
 */
function FilterPanel({ view, actions }: { view: AuditView; actions: string[] }) {
  const isAuth = view.tab === 'auth';
  const shared = isAuth ? view.auth : view.edits;
  const note = view.active === 0
    ? 'All rows'
    : `${view.active} filter${view.active === 1 ? '' : 's'} applied`;

  return (
    <details className="filter-details" open={view.active > 0 || view.errors.length > 0}>
      <summary>
        <span className="filter-details-title">Filter</span>
        <span className="filter-details-note">{note}</span>
      </summary>
      <form method="get" action={AUDIT_PATH} className="audit-filters">
        {!isAuth && <input type="hidden" name="tab" value="edits" />}
        <div className="filter-grid">
          <div>
            <label htmlFor="audit-actor">Actor</label>
            <input
              id="audit-actor"
              name="actor"
              type="search"
              maxLength={100}
              defaultValue={shared.actor ?? ''}
              placeholder="Email, label or user id"
            />
          </div>

          {isAuth ? (
            <div>
              <label htmlFor="audit-action">Action</label>
              <select id="audit-action" name="action" defaultValue={view.auth.action ?? ''}>
                <option value="">Any</option>
                {actions.map((action) => (
                  <option key={action} value={action}>{action}</option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div>
                <label htmlFor="audit-table">Table</label>
                <select id="audit-table" name="table" defaultValue={view.edits.table ?? ''}>
                  <option value="">Any</option>
                  {DATA_EDIT_TABLE_NAMES.map((table) => (
                    <option key={table} value={table}>{DATA_EDIT_TABLE_LABELS[table]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="audit-row">Row id</label>
                <input
                  id="audit-row"
                  name="row"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={18}
                  defaultValue={view.edits.rowId ?? ''}
                />
              </div>
              <div>
                <label htmlFor="audit-field">Field group</label>
                <input
                  id="audit-field"
                  name="field"
                  type="search"
                  maxLength={80}
                  defaultValue={view.edits.fieldGroup ?? ''}
                  placeholder="dob, score, match_sheet…"
                />
              </div>
            </>
          )}

          <div>
            <label htmlFor="audit-from">From (UTC)</label>
            <input id="audit-from" name="from" type="date" defaultValue={shared.from ?? ''} />
          </div>
          <div>
            <label htmlFor="audit-to">To (UTC)</label>
            <input id="audit-to" name="to" type="date" defaultValue={shared.to ?? ''} />
          </div>
        </div>

        <div className="filter-actions">
          <button className="btn" type="submit">Apply filters</button>
          <Link className="btn btn-secondary" href={auditHref({ tab: view.tab })}>Reset</Link>
        </div>
      </form>
    </details>
  );
}
