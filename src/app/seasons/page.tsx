import type { Metadata } from 'next';
import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { listSeasons } from '@/db/queries/seasons';
import { clubPath, formatNumber, seasonPath } from '@/lib/format';
import { firstValue, parseSeason } from '@/lib/params';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Seasons',
  description: 'Every VFL/AFL season from 1897, with premiers, match counts and ladders.',
  alternates: { canonical: '/seasons' },
};

export default async function SeasonsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const fromYear = parseSeason(firstValue(params.from));
  const toYear = parseSeason(firstValue(params.to));

  const seasons = await listSeasons({ fromYear, toYear });

  return (
    <>
      <div className="page-header">
        <h1>Seasons</h1>
        <p className="subtitle">{seasons.length} seasons from 1897.</p>
      </div>

      <form method="get" action="/seasons">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
          <div>
            <label htmlFor="from">From</label>
            <input
              id="from" name="from" type="number" min={1897} max={2100}
              placeholder="1897" defaultValue={fromYear ?? ''}
            />
          </div>
          <div>
            <label htmlFor="to">To</label>
            <input
              id="to" name="to" type="number" min={1897} max={2100}
              placeholder="2026" defaultValue={toYear ?? ''}
            />
          </div>
        </div>
        <div style={{ marginTop: '0.9rem', display: 'flex', gap: '0.5rem' }}>
          <button className="btn" type="submit">Filter</button>
          <Link className="btn btn-secondary" href="/seasons">Reset</Link>
        </div>
      </form>

      {seasons.length === 0 ? (
        <div className="empty">
          <h2>No seasons in that range</h2>
          <p>Try widening the from/to years.</p>
        </div>
      ) : (
        <CollapsibleTable title="Seasons">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Season</th>
                <th scope="col">League</th>
                <th scope="col">Premier</th>
                <th scope="col" className="num">Matches</th>
                <th scope="col" className="num">Clubs</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {seasons.map((s) => (
                <tr key={s.year}>
                  <td><Link href={seasonPath(s.year)}>{s.year}</Link></td>
                  <td>{s.league}</td>
                  <td className="wide">
                    {s.premierSlug ? (
                      <Link href={clubPath(s.premierSlug)}>{s.premierName}</Link>
                    ) : (
                      <span className="not-recorded">—</span>
                    )}
                  </td>
                  <td className="num">{formatNumber(s.matchCount)}</td>
                  <td className="num">{formatNumber(s.clubCount)}</td>
                  <td>
                    {s.isComplete
                      ? <span className="muted">Complete</span>
                      : <span className="badge badge-warn">In progress</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </CollapsibleTable>
      )}
    </>
  );
}
