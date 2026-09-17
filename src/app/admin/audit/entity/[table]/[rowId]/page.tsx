import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ValueDiff } from '@/app/admin/audit/ValueDiff';
import { isDataEditTableName } from '@/db/queries/audit-log';
import { ENTITY_HISTORY_LIMIT, listDataEditHistory } from '@/db/queries/audit-reader';
import {
  DATA_EDIT_TABLE_LABELS,
  auditHref,
  formatAuditTimestamp,
  isAuditRowId,
} from '@/lib/audit-view';
import { requireCapability } from '@/lib/auth/session';
import { formatNumber } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Entity history',
  robots: { index: false, follow: false },
};

/**
 * One entity's recorded edits, newest first (AFLDB-ISSUE-157): who changed
 * player X, when, from what, to what -- each `data_edits` row rendered as a
 * field-by-field before/after table rather than two blobs of JSON.
 *
 * The route segment is validated against the `data_edits` allowlist and a
 * digits-only row id before anything is read; anything else is a 404, not
 * a query. Read-only, like the list it links from.
 */
export default async function EntityHistoryPage(
  { params }: { params: Promise<{ table: string; rowId: string }> },
) {
  await requireCapability('operations.audit.read');
  const { table, rowId } = await params;
  if (!isDataEditTableName(table) || !isAuditRowId(rowId)) notFound();

  const history = await listDataEditHistory(table, rowId);
  const label = `${DATA_EDIT_TABLE_LABELS[table]} #${rowId}`;
  const listHref = auditHref({ tab: 'edits', table, row: rowId });

  return (
    <>
      <div className="page-header">
        <p className="eyebrow"><Link href={listHref}>← Data edits</Link></p>
        <h1>{label}</h1>
        <p className="subtitle">
          {history.length === 0
            ? 'No manual edit has been recorded against this row.'
            : `${formatNumber(history.length)} recorded edit${history.length === 1 ? '' : 's'}, newest first. Times are UTC.`}
          {history.length >= ENTITY_HISTORY_LIMIT
            ? ` Only the most recent ${formatNumber(ENTITY_HISTORY_LIMIT)} are shown; narrow by date on the list page for older ones.`
            : ''}
        </p>
      </div>

      {history.length === 0 ? (
        <section className="section">
          <div className="empty">
            <h3>Nothing recorded</h3>
            <p>
              Either this row has only ever been loaded from a source, or the id is not one that
              has been edited. Every manual edit since migration 057 writes a row here in the same
              transaction as the change, so an absence is itself informative.
            </p>
          </div>
        </section>
      ) : history.map((edit) => (
        <section key={edit.id} className="section">
          <div className="split-head">
            <h2>
              <code>{edit.fieldGroup}</code>
              {' '}<span className="muted" style={{ fontSize: '0.9rem', fontWeight: 400 }}>
                {formatAuditTimestamp(edit.createdAt)}
              </span>
            </h2>
            <span className="muted">
              by {edit.adminEmail ?? `admin #${edit.adminUserId}`}
            </span>
          </div>
          {edit.note && <p className="section-note">{edit.note}</p>}
          <ValueDiff oldValues={edit.oldValues} newValues={edit.newValues} />
        </section>
      ))}
    </>
  );
}
