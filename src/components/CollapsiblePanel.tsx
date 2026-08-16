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
 *
 * The title is an `<h2>` and not the styled `<span>` it used to be. Every
 * major section of a player, club, season or match page is one of these —
 * "Career", "Season by season", "Match log", "Ladder" — so with a span they
 * were the page's real structure while its heading outline was an `<h1>` and
 * almost nothing else. A heading inside `<summary>` is explicitly allowed by
 * the content model, and it is what puts those sections into the document
 * outline a screen reader and a crawler both navigate by.
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
        <h2 className="table-details-title">{title}</h2>
        {note && <span className="table-details-note">{note}</span>}
      </summary>
      {children}
    </details>
  );
}
