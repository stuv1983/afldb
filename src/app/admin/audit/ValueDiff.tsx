import { diffValues } from '@/lib/audit-view';

/**
 * A `data_edits` row's two snapshots as one field-per-row table: what the
 * field was, what it became. Unchanged fields in a coupled group are kept,
 * muted, so a score edit still reads as the whole score line; NULL is
 * printed as `null` because in this schema it means "not recorded", which
 * is not zero and not blank (ISSUE-156 §11 P1).
 */
export function ValueDiff({
  oldValues,
  newValues,
}: {
  oldValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
}) {
  const rows = diffValues(oldValues, newValues);
  if (rows.length === 0) {
    return <p className="muted">No field values were recorded for this edit.</p>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Before</th>
            <th scope="col">After</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.field} className={row.changed ? undefined : 'muted'}>
              <td className="nowrap"><code>{row.field}</code></td>
              <td className="audit-wrap">{row.before}</td>
              <td className="audit-wrap">{row.changed ? <strong>{row.after}</strong> : row.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
