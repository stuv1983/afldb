/**
 * A ruled block with a heading a reader can collapse.
 *
 * Native `<details>`, so it works as a plain Server Component: no client JS,
 * and the content stays in the DOM (and indexable) whether open or shut.
 * Defaults open — collapsing is an option a reader picks, not a change to
 * what a page shows on first load.
 *
 * `CollapsibleTable` is this with a filter slot, and is what a table should
 * use. Reach for this one directly when the thing being collapsed is not a
 * table: the grid solver's board controls, for instance.
 */
export function CollapsiblePanel({
  id,
  title,
  note,
  defaultOpen = true,
  children,
}: {
  id?: string;
  title: string;
  note?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details id={id} className="table-details" open={defaultOpen}>
      <summary>
        <span className="table-details-title">{title}</span>
        {note && <span className="table-details-note">{note}</span>}
      </summary>
      {children}
    </details>
  );
}
