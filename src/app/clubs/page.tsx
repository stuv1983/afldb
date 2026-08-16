import type { Metadata } from 'next';
import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { FilterErrors } from '@/components/FilterErrors';
import { TableFilters } from '@/components/TableFilters';
import { getClubStates, listClubs } from '@/db/queries/clubs';
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
  const fields = clubFilterFields(optionsFrom(states));
  const values = parseFilterValues(fields, params);

  const clubs = await listClubs({
    q: values.text.q,
    state: values.select.state,
    succession: values.select.succession,
    ranges: values,
  });
  const current = clubs.filter((c) => c.isCurrent);
  const historical = clubs.filter((c) => !c.isCurrent);
  const described = describeFilters(fields, values);

  return (
    <>
      <div className="page-header">
        <h1>Clubs</h1>
        <p className="subtitle">
          {current.length} current clubs and {historical.length} historical identities.
          {described.length > 0 ? ` · ${described.join(' · ')}` : ''}
        </p>
      </div>

      <FilterErrors errors={values.errors} />

      {/* One panel, not one per section: these filters narrow the current
          clubs and the historical identities together, and splitting them
          would let the two lists disagree about what is being asked. */}
      <TableFilters action="/clubs" fields={fields} values={values} />

      <section className="section">
        <h2>Current clubs</h2>
        {current.length === 0 ? (
          <p className="muted">No current clubs match those filters.</p>
        ) : (
          <div className="grid">
            {current.map((club) => (
              <Link key={club.id} href={clubPath(club.slug)} className="card">
                <h3>{club.name}</h3>
                <div className="meta">
                  {club.homeState} · from {club.firstSeason}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <p className="section-note">
          Historical identities are preserved rather than folded away, so a player’s
          record shows the club as it was at the time. A rename or relocation carries
          the club’s record forward; a merger does not, so the two sit in different
          columns.
        </p>
        {historical.length === 0 ? (
          <p className="muted">No historical identities match those filters.</p>
        ) : (
          <CollapsibleTable title="Historical identities">
          <div className="table-wrap">
            <table>
              <caption>
                “Record continues as” is the same club under a later name: the seasons,
                matches and premierships either side of the change are counted as one
                club record, reported identically on both pages. “Merged into” is a link
                only: neither club’s statistics are counted towards the combined club.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Identity</th>
                  <th scope="col" className="num">Seasons</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Record continues as</th>
                  <th scope="col">Merged into</th>
                </tr>
              </thead>
              <tbody>
                {historical.map((club) => {
                  const continuesAs = club.currentIdentityId !== club.id
                    ? club.currentIdentitySlug
                    : null;
                  const mergedInto = club.successorRelation === 'merged_into'
                    ? club.successorSlug
                    : null;
                  return (
                    <tr key={club.id}>
                      <td><Link href={clubPath(club.slug)}>{club.name}</Link></td>
                      <td className="num nowrap">
                        {formatSpan(club.firstSeason, club.lastSeason)}
                      </td>
                      <td style={{ textTransform: 'capitalize' }}>{club.succession}</td>
                      <td>
                        {continuesAs ? (
                          <Link href={clubPath(continuesAs)}>
                            {club.currentIdentityName}
                          </Link>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {mergedInto ? (
                          <>
                            <Link href={clubPath(mergedInto)}>{club.successorName}</Link>
                            {club.successorSeason ? ` (${club.successorSeason})` : ''}
                          </>
                        ) : club.succession === 'defunct' ? (
                          <span className="muted">no successor</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </CollapsibleTable>
        )}
      </section>
    </>
  );
}
