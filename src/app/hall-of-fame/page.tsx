import type { Metadata } from 'next';
import Link from 'next/link';

import { listHallOfFame } from '@/db/queries/awards';
import { formatNumber, isLinked, playerPath } from '@/lib/format';

export const revalidate = 86400;

export const metadata: Metadata = {
  title: 'Australian Football Hall of Fame',
  description:
    'Every inductee of the Australian Football Hall of Fame, including its Legends — '
    + 'players, coaches, umpires, administrators and media figures.',
  alternates: { canonical: '/hall-of-fame' },
};

const CATEGORY_LABELS: Record<string, string> = {
  player: 'Player',
  coach: 'Coach',
  umpire: 'Umpire',
  administrator: 'Administrator',
  media: 'Media',
  pioneer: 'Pioneer',
  legend: 'Legend',
  removed: 'Removed',
};

export default async function HallOfFamePage() {
  const inductees = await listHallOfFame();

  const legends = inductees.filter((i) => i.isLegend);
  const linked = inductees.filter((i) => i.playerId !== null && isLinked(i.linkStatus));
  const byYear = [...inductees].sort((a, b) => {
    const ay = a.inductedYear ?? 9999;
    const by = b.inductedYear ?? 9999;
    if (ay !== by) return by - ay;
    return a.name.localeCompare(b.name);
  });

  return (
    <>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/awards">Awards</Link>
        <span aria-hidden="true">/</span>
        <span>Hall of Fame</span>
      </nav>

      <div className="page-header">
        <h1>Australian Football Hall of Fame</h1>
        <p className="subtitle">
          {formatNumber(inductees.length)} inductees, of whom {legends.length} are Legends.
        </p>
      </div>

      <p className="notice">
        The Hall of Fame honours the whole game, not only the national competition.{' '}
        {formatNumber(inductees.length - linked.length)} inductees are coaches,
        umpires, administrators, media figures or state-league players with no VFL/AFL
        playing record, so they have no AFLDB player page. They are listed here in full
        rather than filtered out.
      </p>

      <div className="stat-strip">
        <div className="stat">
          <div className="value">{formatNumber(inductees.length)}</div>
          <div className="label">Inductees</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(legends.length)}</div>
          <div className="label">Legends</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(linked.length)}</div>
          <div className="label">With an AFLDB record</div>
        </div>
      </div>

      <section className="section">
        <h2>Legends</h2>
        <p className="section-note">
          Elevated to Legend status, the Hall of Fame’s highest honour.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col" className="num">Elevated</th>
                <th scope="col">Club</th>
                <th scope="col">Career</th>
              </tr>
            </thead>
            <tbody>
              {legends
                .sort((a, b) => (a.legendYear ?? 0) - (b.legendYear ?? 0))
                .map((i) => (
                  <tr key={i.id}>
                    <td className="wide">
                      {i.playerId && isLinked(i.linkStatus) ? (
                        <Link href={playerPath(i.playerSlug!, i.playerId)}>{i.name}</Link>
                      ) : (
                        i.name
                      )}
                    </td>
                    <td className="num">{i.legendYear ?? i.inductedYear ?? '—'}</td>
                    <td>{i.clubNameRaw ?? <span className="muted">—</span>}</td>
                    <td className="nowrap muted">{i.playingCareer ?? '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2>All inductees</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col" className="num">Inducted</th>
                <th scope="col">Name</th>
                <th scope="col">Category</th>
                <th scope="col">Club</th>
                <th scope="col">Career</th>
              </tr>
            </thead>
            <tbody>
              {byYear.map((i) => (
                <tr key={i.id}>
                  <td className="num">{i.inductedYear ?? '—'}</td>
                  <td className="wide">
                    {i.playerId && isLinked(i.linkStatus) ? (
                      <Link href={playerPath(i.playerSlug!, i.playerId)}>{i.name}</Link>
                    ) : (
                      <span title="No VFL/AFL playing record in AFLDB">{i.name}</span>
                    )}
                    {i.isLegend && <strong> · Legend</strong>}
                    {i.removedYear && (
                      <span className="badge badge-warn" title={`Removed in ${i.removedYear}`}>
                        Removed
                      </span>
                    )}
                  </td>
                  <td>{CATEGORY_LABELS[i.category ?? ''] ?? i.category ?? '—'}</td>
                  <td>{i.clubNameRaw ?? <span className="muted">—</span>}</td>
                  <td className="nowrap muted">{i.playingCareer ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
