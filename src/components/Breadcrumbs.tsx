import Link from 'next/link';

import { JsonLd } from '@/components/JsonLd';
import { breadcrumbSchema } from '@/lib/structured-data';

export type Crumb = {
  label: string;
  /** Absent on the last crumb, which is the page the reader is already on. */
  href?: string;
};

/**
 * The trail back up the site, visible and machine-readable from one source.
 *
 * Both halves come from the same array on purpose. Google requires the
 * `BreadcrumbList` markup to describe the trail a reader can actually see,
 * and the two drifting apart is exactly what happens when the JSON-LD is
 * written separately — the visible trail gets a new level and the markup
 * does not. Here it cannot.
 *
 * The visible markup is the same `nav.breadcrumbs` the pages already used,
 * with one addition: AFLDB itself is now the first crumb rather than being
 * implied by the masthead, so the trail a crawler reads starts at the root
 * the way Google's own examples do.
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const trail: Crumb[] = [{ label: 'AFLDB', href: '/' }, ...items];

  return (
    <>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        {trail.map((crumb, index) => (
          <span key={`${crumb.label}-${index}`}>
            {index > 0 && <span aria-hidden="true">/</span>}
            {crumb.href
              ? <Link href={crumb.href}>{crumb.label}</Link>
              : <span aria-current="page">{crumb.label}</span>}
          </span>
        ))}
      </nav>
      <JsonLd data={breadcrumbSchema(trail)} />
    </>
  );
}
