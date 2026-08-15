/**
 * The filter problems a page could not honour.
 *
 * Only inverted ranges reach here, and only from a hand-edited or stale
 * URL, but they must be shown: `parseFilterValues` drops the range rather
 * than guessing at it, so without this the table renders unfiltered under
 * a panel the reader believes is narrowing it.
 *
 * Renders nothing when there is nothing to report, so a page can place it
 * unconditionally.
 */
export function FilterErrors({ errors }: { errors: readonly string[] }) {
  if (errors.length === 0) return null;

  return (
    <div className="notice filter-errors" role="alert">
      {errors.map((error) => <div key={error}>{error}</div>)}
    </div>
  );
}
