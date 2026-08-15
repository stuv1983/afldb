import type { Metadata } from 'next';
import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { Pagination } from '@/components/Pagination';
import { getClubOptions } from '@/db/queries/advanced-search';
import { getDraftTypes, getDraftYears, listDraftPicks } from '@/db/queries/draft';
import { clubPath, formatNumber, isLinked, playerPath } from '@/lib/format';
import { firstValue, parseIntInRange, parsePage, parseSearchTerm, parseSlug } from '@/lib/params';
import { DEFAULT_PAGE_SIZE } from '@/search/constants';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Draft',
  description: 'AFL national and rookie draft history from 1981, with every pick, club and player.',
  alternates: { canonical: '/draft' },
};

export default async function DraftPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const page = parsePage(firstValue(params.page));
  const year = parseIntInRange(firstValue(params.year), 1981, 2100);
  const club = parseSlug(firstValue(params.club));
  const draftType = firstValue(params.type) || undefined;
  const q = parseSearchTerm(firstValue(params.q));

  const [{ rows, total }, years, types, clubs] = await Promise.all([
    listDraftPicks({
      year, clubSlug: club, draftType, q, page, pageSize: DEFAULT_PAGE_SIZE,
    }),
    getDraftYears(),
    getDraftTypes(),
    getClubOptions(),
  ]);

  const linkParams = {
    year: year ? String(year) : undefined,
    club,
    type: draftType,
    q,
  };

  return (
    <>
      <div className="page-header">
        <h1>Draft</h1>
        <p className="subtitle">
          {formatNumber(total)} draft and recruitment selections since 1981.
        </p>
      </div>

      <form method="get" action="/draft">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
          <div>
            <label htmlFor="q">Player</label>
            <input id="q" name="q" type="search" placeholder="Search by name" defaultValue={q ?? ''} />
          </div>
          <div>
            <label htmlFor="year">Year</label>
            <select id="year" name="year" defaultValue={year ?? ''}>
              <option value="">Any year</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="club">Club</label>
            <select id="club" name="club" defaultValue={club ?? ''}>
              <option value="">Any club</option>
              {clubs.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}{c.isCurrent ? '' : ' (historical)'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="type">Draft type</label>
            <select id="type" name="type" defaultValue={draftType ?? ''}>
              <option value="">Any type</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginTop: '0.9rem', display: 'flex', gap: '0.5rem' }}>
          <button className="btn" type="submit">Filter</button>
          <Link className="btn btn-secondary" href="/draft">Reset</Link>
        </div>
      </form>

      {rows.length === 0 ? (
        <div className="empty">
          <h2>No draft picks match those filters</h2>
          <p>Try widening the year, club or search term.</p>
        </div>
      ) : (
        <>
          <CollapsibleTable title="Draft picks">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col" className="num">Year</th>
                    <th scope="col" className="num">Pick</th>
                    <th scope="col">Player</th>
                    <th scope="col">Club</th>
                    <th scope="col">Type</th>
                    <th scope="col" className="num">Age</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((pick) => (
                    <tr key={pick.id}>
                      <td className="num">{pick.draftYear}</td>
                      <td className="num">{pick.pickNumber ?? '—'}</td>
                      <td className="wide">
                        {pick.playerId && isLinked(pick.linkStatus) ? (
                          <Link href={playerPath(pick.playerSlug!, pick.playerId)}>
                            {pick.playerDisplayName}
                          </Link>
                        ) : (
                          pick.playerNameRaw
                        )}
                      </td>
                      <td>
                        {pick.clubSlug ? (
                          <Link href={clubPath(pick.clubSlug)}>{pick.clubName}</Link>
                        ) : (
                          pick.clubNameRaw ?? <span className="muted">—</span>
                        )}
                      </td>
                      <td className="nowrap muted">{pick.draftType}</td>
                      <td className="num">{pick.draftAge ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CollapsibleTable>

          <Pagination
            basePath="/draft"
            params={linkParams}
            page={page}
            pageSize={DEFAULT_PAGE_SIZE}
            total={total}
          />
        </>
      )}
    </>
  );
}
