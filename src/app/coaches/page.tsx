import type { Metadata } from 'next';
import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { SortableTable } from '@/components/SortableTable';
import { listCoaches } from '@/db/queries/coaches';
import { coachProfilePath, formatNumber, formatSpan } from '@/lib/format';
import { pageMetadata } from '@/lib/seo';
import { coachSlug } from '@/lib/slugs';

export const revalidate = 3600;

export const metadata: Metadata = pageMetadata({
  title: 'AFL & VFL Coaches',
  description:
    'Every coach on record for a VFL/AFL match: seasons coached, clubs and games, '
    + 'including coaches who never played at senior level.',
  path: '/coaches',
});

export default async function CoachesPage() {
  const coaches = await listCoaches();

  return (
    <>
      <div className="page-header">
        <h1>Coaches</h1>
        <p className="subtitle">
          {formatNumber(coaches.length)} people have coached a VFL/AFL match.
        </p>
      </div>

      <CollapsibleTable id="coaches" title="Coaches" note={`${formatNumber(coaches.length)} found`}>
        <div className="table-wrap">
          <SortableTable
            defaultSort="games"
            defaultDir="desc"
            columns={[
              { key: 'name', label: 'Name', sortType: 'text' },
              { key: 'seasons', label: 'Seasons', sortType: 'number', className: 'num nowrap' },
              { key: 'games', label: 'Games', sortType: 'number', className: 'num' },
            ]}
            items={coaches.map((c) => {
              // Every coach links to their COACH page, player-linked or not:
              // a reader who picked a name out of the coaches index asked for
              // the coaching record (AFLDB-ISSUE-170 Stage 1E).
              const href = coachProfilePath({ slug: coachSlug(c.displayName), coachId: c.id });
              return {
                id: c.id,
                values: {
                  name: c.displayName,
                  seasons: c.firstSeason ?? -1,
                  games: c.games,
                },
                element: (
                  <tr key={c.id}>
                    <td className="wide">
                      <Link href={href}>{c.displayName}</Link>
                    </td>
                    <td className="num nowrap">{formatSpan(c.firstSeason, c.lastSeason)}</td>
                    <td className="num">{formatNumber(c.games)}</td>
                  </tr>
                ),
              };
            })}
          />
        </div>
      </CollapsibleTable>
    </>
  );
}
