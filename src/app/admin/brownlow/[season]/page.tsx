import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  SEASON_AUTHORITY_LABEL,
  SEASON_STATUS_LABEL,
  SEASON_STATUS_TONE,
  badgeClass,
} from '@/app/admin/brownlow/labels';
import { getBrownlowSeasonOverview } from '@/db/queries/admin-brownlow';
import { listSeasonPolledPlayers } from '@/db/queries/admin-brownlow-ui';
import { requireCapability } from '@/lib/auth/session';
import { formatNumber } from '@/lib/format';
import { parseSeason } from '@/lib/params';

import { PublishPanel } from './PublishPanel';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Brownlow season',
  robots: { index: false, follow: false },
};

export default async function BrownlowSeasonPage({
  params,
}: {
  params: Promise<{ season: string }>;
}) {
  const viewer = await requireCapability('data.brownlow.read');
  const { season: seasonRaw } = await params;
  const season = parseSeason(seasonRaw);
  if (season === undefined) notFound();

  const overview = await getBrownlowSeasonOverview(season);
  if (!overview) notFound();

  const polledPlayers = overview.polled ? await listSeasonPolledPlayers(season) : [];
  const accounted = overview.final + overview.voided + overview.imported;

  return (
    <>
      <div className="page-header">
        <p className="section-note" style={{ marginBottom: '0.35rem' }}>
          <Link href="/admin/brownlow">← All Brownlow seasons</Link>
        </p>
        <h1>Brownlow {season}</h1>
        <p className="subtitle" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span className={badgeClass(SEASON_STATUS_TONE[overview.status])}>
            {SEASON_STATUS_LABEL[overview.status]}
          </span>
          <span className="muted">{SEASON_AUTHORITY_LABEL[overview.authority]}</span>
          {overview.stale && <span className="badge badge-warn">Match set changed since publication</span>}
        </p>
      </div>

      {!overview.polled && (
        <p className="notice">No Brownlow Medal was awarded in {season}, so there is nothing to administer.</p>
      )}

      <section className="section">
        <h2>Coverage</h2>
        <div className="stat-strip" style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem' }}>
          <Stat label="H&amp;A matches" value={overview.expected} />
          <Stat label="Accounted (final / void / source)" value={accounted} />
          <Stat label="Finalised" value={overview.final} />
          <Stat label="Voided" value={overview.voided} />
          <Stat label="Source complete" value={overview.imported} />
          <Stat label="Draft" value={overview.draft} />
          <Stat label="Source incomplete" value={overview.importedPartial} />
          <Stat label="No decision" value={overview.notEntered} />
          <Stat label="Unattached vote rows" value={overview.unresolved} tone={overview.unresolved > 0 ? 'warn' : undefined} />
          <Stat label="Line-ups short" value={overview.participantsIncomplete} tone={overview.participantsIncomplete > 0 ? 'warn' : undefined} />
        </div>
      </section>

      <section className="section">
        <h2>Rounds</h2>
        {overview.rounds.length === 0 ? (
          <p className="muted">No home-and-away rounds recorded for {season}.</p>
        ) : (
          <div className="table-wrap">
            <table className="sticky-last-col">
              <thead>
                <tr>
                  <th scope="col">Round</th>
                  <th scope="col" className="num">Matches</th>
                  <th scope="col" className="num">Accounted</th>
                  <th scope="col" className="num">Draft</th>
                  <th scope="col" className="num">Line-ups short</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {overview.rounds.map((round) => {
                  const done = round.accounted >= round.expected;
                  return (
                    <tr key={round.roundNumber}>
                      <td>Round {round.roundNumber}</td>
                      <td className="num">{round.expected}</td>
                      <td className="num">
                        <span className={done ? 'badge' : 'badge badge-warn'}>
                          {round.accounted}/{round.expected}
                        </span>
                      </td>
                      <td className="num">{round.draft || '—'}</td>
                      <td className="num">
                        {round.participantsIncomplete > 0
                          ? <span className="badge badge-warn">{round.participantsIncomplete}</span>
                          : '—'}
                      </td>
                      <td>
                        <Link href={`/admin/brownlow/${season}/${round.roundNumber}`}>Open round →</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {overview.authority === 'source' && overview.disagreements.length > 0 && (
        <section className="section">
          <h2>Round facts vs the source-published total</h2>
          <p className="muted" style={{ fontSize: '0.9rem' }}>
            Shown, never applied. These are players whose finalised round votes so far do not match
            the source-published season total. They reconcile when the season is published from the
            match grain.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col" className="num">Round facts</th>
                  <th scope="col" className="num">Source total</th>
                </tr>
              </thead>
              <tbody>
                {overview.disagreements.map((row) => (
                  <tr key={row.playerId}>
                    <td>{row.playerName}</td>
                    <td className="num">{row.roundVotes}</td>
                    <td className="num">{row.seasonVotes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {overview.polled && (
        <PublishPanel
          season={season}
          expectedRevision={overview.revision}
          polledPlayers={polledPlayers}
          prefilledIneligibleIds={overview.ineligiblePlayerIds}
          canPublish={viewer.role === 'super_admin'}
          complete={overview.complete}
          unresolved={overview.unresolved}
          accounted={accounted}
          expected={overview.expected}
          authority={overview.authority}
          stale={overview.stale}
        />
      )}
    </>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'warn';
}) {
  return (
    <div className="stat">
      <span
        className="stat-value"
        style={{ fontSize: '1.4rem', fontWeight: 700, color: tone === 'warn' ? 'var(--color-warn)' : undefined }}
      >
        {formatNumber(value)}
      </span>
      <span className="stat-label muted" style={{ fontSize: '0.8rem', display: 'block' }}>{label}</span>
    </div>
  );
}
