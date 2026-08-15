import { CollapsiblePanel } from '@/components/CollapsiblePanel';

/**
 * A table section that can be collapsed.
 *
 * Wraps the existing `.table-wrap` convention rather than replacing it, so
 * every page keeps its own `<table>` markup and gets a `<summary>` header
 * for free. The disclosure itself is `CollapsiblePanel`; this adds the one
 * thing a table needs that other collapsed blocks do not.
 *
 * `filters` renders above the table and inside this element, so a table's
 * filters collapse with the table they belong to. It is a second, nested
 * `<details>` (see `TableFilters`), which is why nothing here reaches for
 * client state: `<details>` inside `<details>` is exactly the behaviour.
 *
 * `id`, when a table is filterable, gives `TableFilters` an anchor to send
 * its submit back to (pass the same string as that panel's `anchor` prop).
 * A plain GET form reloads the whole page, and a URL with no fragment
 * lands the reader at the top of it regardless of which table on the page
 * they filtered -- annoying on a page with several tables stacked above
 * one another. A fragment identifier is preserved through a GET
 * navigation, so the browser scrolls back to this table instead.
 */
export function CollapsibleTable({
  id,
  title,
  note,
  defaultOpen = true,
  filters,
  children,
}: {
  id?: string;
  title: string;
  note?: string;
  defaultOpen?: boolean;
  filters?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <CollapsiblePanel id={id} title={title} note={note} defaultOpen={defaultOpen}>
      {filters}
      {children}
    </CollapsiblePanel>
  );
}
