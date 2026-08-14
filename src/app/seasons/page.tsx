import type { Metadata } from 'next';
import Link from 'next/link';

import { listSeasons } from '@/db/queries/seasons';
import { clubPath, formatNumber, seasonPath } from '@/lib/format';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Seasons',
  description: 'Every VFL/AFL season from 1897, with premiers, match counts and ladders.',
  alternates: { canonical: '/seasons' },
};

export default async function SeasonsPage() {
  const seasons = await listSeasons();

  return (
    <>
      <div className="page-header">
        <h1>Seasons</h1>
        <p className="subtitle">{seasons.length} seasons from 1897.</p>
      </div>

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
    </>
  );
}
