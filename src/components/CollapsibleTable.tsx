/**
 * A table section that can be collapsed.
 *
 * Wraps the existing `.table-wrap` convention rather than replacing it, so
 * every page keeps its own `<table>` markup and gets a `<summary>` header
 * for free. Native `<details>`, so this works as a plain server component —
 * no client JS, and the content stays in the DOM (and indexable) whether
 * open or collapsed. Defaults open: collapsing is an option a reader picks,
 * not a change to what a page shows on first load.
 *
 * `filters` renders above the table and inside this element, so a table's
 * filters collapse with the table they belong to. It is a second, nested
 * `<details>` (see `TableFilters`), which is why nothing here reaches for
 * client state: `<details>` inside `<details>` is exactly the behaviour.
 */
export function CollapsibleTable({
  title,
  note,
  defaultOpen = true,
  filters,
  children,
}: {
  title: string;
  note?: string;
  defaultOpen?: boolean;
  filters?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <details className="table-details" open={defaultOpen}>
      <summary>
        <span className="table-details-title">{title}</span>
        {note && <span className="table-details-note">{note}</span>}
      </summary>
      {filters}
      {children}
    </details>
  );
}
