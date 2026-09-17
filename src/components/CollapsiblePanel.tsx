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
 * The title is a heading and not the styled `<span>` it used to be. Every
 * major section of a player, club, season or match page is one of these —
 * "Career", "Season by season", "Match log", "Ladder" — so with a span they
 * were the page's real structure while its heading outline was an `<h1>` and
 * almost nothing else. A heading inside `<summary>` is explicitly allowed by
 * the content model, and it is what puts those sections into the document
 * outline a screen reader and a crawler both navigate by.
 *
 * Defaults to `<h2>`, right for every top-level disclosure. A disclosure
 * nested inside another section (the club comparison's "Every connected
 * player" and "Average leaderboards", both inside "Players") must pass the
 * level that actually continues that section's outline instead — otherwise
 * every nested disclosure on the page would claim to be a second `<h2>`
 * top-level section, which is a real document-outline defect, not a styling
 * one.
 */
export function CollapsiblePanel({
  id,
  title,
  note,
  defaultOpen = true,
  headingLevel = 2,
  children,
}: {
  id?: string;
  title: string;
  note?: string;
  defaultOpen?: boolean;
  headingLevel?: 2 | 3 | 4;
  children: React.ReactNode;
}) {
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  return (
    <details id={id} className="table-details" open={defaultOpen}>
      <summary>
        <Heading className="table-details-title">{title}</Heading>
        {note && <span className="table-details-note">{note}</span>}
      </summary>
      {children}
    </details>
  );
}
