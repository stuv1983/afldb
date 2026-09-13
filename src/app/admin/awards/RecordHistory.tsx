import Link from 'next/link';

import { ValueDiff } from '@/app/admin/audit/ValueDiff';
import type { DataEditTableName } from '@/db/queries/audit-log';
import { listDataEditHistory } from '@/db/queries/audit-reader';
import { entityHistoryHref, formatAuditTimestamp } from '@/lib/audit-view';

/** How many entries read inline before the reader is sent to the full viewer. */
const INLINE_LIMIT = 10;

/**
 * This record's own edit history, on the record's own page
 * (AFLDB-ISSUE-165 §6.9).
 *
 * The ISSUE-157 audit viewer's OWN reader and OWN renderer — `listDataEditHistory`
 * and `ValueDiff` — rather than a second audit subsystem: an entry here reads
 * exactly as the same entry reads at `/admin/audit`, because it is the same
 * code rendering the same `data_edits` row. Only the most recent few are shown,
 * with a link to the full viewer for the rest.
 *
 * `data_edits` is read on the AUTH pool, which is where `listDataEditHistory`
 * reads it from by default and the only role that may: the audit trail is not
 * application data and is not readable by the page's own role.
 */
export async function RecordHistory({
  table, rowId,
}: {
  table: DataEditTableName;
  rowId: number;
}) {
  const history = await listDataEditHistory(table, String(rowId));
  const shown = history.slice(0, INLINE_LIMIT);

  return (
    <section className="section">
      <div className="split-head">
        <h2>History</h2>
        <Link href={entityHistoryHref(table, String(rowId))}>Full audit trail</Link>
      </div>

      {history.length === 0 ? (
        <p className="muted">
          No manual edit has been recorded against this record. Either it has only ever been loaded
          from its source, or nothing has been changed since it was created — every mutation writes
          an entry here in the same transaction as the change, so an absence is itself informative.
        </p>
      ) : (
        <>
          {shown.map((edit) => (
            <div key={edit.id} style={{ marginBottom: '1.25rem' }}>
              <div className="split-head">
                <h3 style={{ fontSize: '1rem', margin: 0 }}>
                  <code>{edit.fieldGroup}</code>{' '}
                  <span className="muted" style={{ fontSize: '0.85rem', fontWeight: 400 }}>
                    {formatAuditTimestamp(edit.createdAt)}
                  </span>
                </h3>
                <span className="muted">by {edit.adminEmail ?? `admin #${edit.adminUserId}`}</span>
              </div>
              {edit.note && <p className="section-note">{edit.note}</p>}
              <ValueDiff oldValues={edit.oldValues} newValues={edit.newValues} />
            </div>
          ))}
          {history.length > shown.length && (
            <p className="muted">
              {history.length - shown.length} older entr
              {history.length - shown.length === 1 ? 'y is' : 'ies are'} in the full audit trail.
            </p>
          )}
        </>
      )}
    </section>
  );
}
