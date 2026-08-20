import type { Metadata } from 'next';
import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { FilterErrors } from '@/components/FilterErrors';
import { TableFilters } from '@/components/TableFilters';
import { getClubStates, listClubs } from '@/db/queries/clubs';
import { getSiteSettings } from '@/db/queries/site-settings';
import { clubPath, formatSpan } from '@/lib/format';
import { pageMetadata } from '@/lib/seo';
import { clubFilterFields } from '@/search/list-filters';
import { describeFilters, optionsFrom, parseFilterValues } from '@/search/table-filters';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = pageMetadata({
  title: 'AFL & VFL Clubs — Every Club, Current and Historical',
  description:
    'Every VFL/AFL club, current and historical, including Fitzroy, South Melbourne, '
    + 'Footscray, University and the Brisbane Bears.',
  path: '/clubs',
});

export default async function ClubsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const states = await getClubStates();
  const settings = await getSiteSettings();
  const fields = clubFilterFields(optionsFrom(states));
  const values = parseFilterValues(fields, params);

  const clubs = await listClubs({
    q: values.text.q,
    state: values.select.state,
    succession: values.select.succession,
    ranges: values,
  });
  const described = describeFilters(fields, values);

  return (
    <>
      <div className="page-header">
        <h1>Clubs</h1>
        {settings.pageIntros.clubs && (
          <p className="subtitle" style={{ whiteSpace: 'pre-wrap' }}>
            {settings.pageIntros.clubs}
          </p>
        )}
        {described.length > 0 && (
          <p className="subtitle">{described.join(' · ')}</p>
        )}
      </div>

      <FilterErrors errors={values.errors} />

      {/* One panel, not one per section: these filters narrow the current
          clubs and the historical identities together, and splitting them
          would let the two lists disagree about what is being asked. */}
      <TableFilters action="/clubs" fields={fields} values={values} />

      <section className="section">
        <h2>Clubs</h2>
        {clubs.length === 0 ? (
          <div className="empty">
            <h3>No clubs match those filters</h3>
            <p>Try clearing the state or widening the season range.</p>
          </div>
        ) : (
          <div className="grid">
            {clubs.map((club) => (
              <Link key={club.id} href={clubPath(club.slug)} className="card">
                <h3>{club.name}</h3>
                <div className="meta">
                  {club.homeState} · {club.lastSeason ? formatSpan(club.firstSeason, club.lastSeason) : `from ${club.firstSeason}`}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
