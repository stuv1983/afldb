import Link from 'next/link';

import type { HomeRecordResult, HomeRecordRow } from '@/db/queries/home-records';
import {
  coachProfilePath,
  formatNumber,
  formatRoundShort,
  matchPath,
  playerPath,
  venuePath,
} from '@/lib/format';
import { coachSlug } from '@/lib/slugs';

function rowKey(row: HomeRecordRow): string {
  switch (row.kind) {
    case 'player-total': return `player-${row.playerId}`;
    case 'player-match': return `match-${row.playerId}-${row.matchId}`;
    case 'player-season': return `season-${row.playerId}-${row.season}`;
    case 'coach-total': return `coach-${row.coachId}`;
    case 'venue-total': return `venue-${row.venueSlug}`;
    case 'special-player-total': return `special-${row.playerId}-${row.season ?? 'career'}`;
  }
}

function rowName(row: HomeRecordRow) {
  switch (row.kind) {
    case 'player-total':
    case 'player-match':
    case 'player-season':
    case 'special-player-total':
      return <Link href={playerPath(row.playerSlug, row.playerId)}>{row.displayName}</Link>;
    case 'coach-total':
      return (
        <Link href={coachProfilePath({ slug: coachSlug(row.displayName), coachId: row.coachId })}>
          {row.displayName}
        </Link>
      );
    case 'venue-total':
      return <Link href={venuePath(row.venueSlug)}>{row.venueName}</Link>;
  }
}

function rowContext(row: HomeRecordRow) {
  switch (row.kind) {
    case 'player-match':
      return (
        <span className="ledger-note">
          <Link href={matchPath(row.matchId)}>
            {row.season} {formatRoundShort(row.roundType, row.roundNumber)} v {row.opponentName}
          </Link>
        </span>
      );
    case 'player-season':
      return (
        <span className="ledger-note">
          {row.season}{row.clubName ? ` · ${row.clubName}` : ''}
        </span>
      );
    case 'special-player-total':
      return row.season ? <span className="ledger-note">First kick: {row.season}</span> : null;
    default:
      return null;
  }
}

function formattedValue(value: number, unit: string): string {
  return unit === '%' ? `${value.toFixed(2)}%` : `${formatNumber(value)} ${unit}`;
}

export function HomeRecordPanel({ result }: { result: HomeRecordResult }) {
  const { definition, rows } = result;
  const top = rows[0]?.value ?? 0;

  return (
    <section aria-label="Record of the week">
      <div className="split-head">
        <h2>Record of the week</h2>
        {definition.destination && (
          <Link className="more" href={definition.destination}>All →</Link>
        )}
      </div>
      <p className="lede"><strong>{definition.publicTitle}.</strong> {definition.definition}</p>

      {rows.length === 0 ? (
        <p className="muted">No record entries are available.</p>
      ) : rows.map((row) => (
        <div className="meter" key={rowKey(row)}>
          <div className="meter-head">
            <span>{rowName(row)}{rowContext(row)}</span>
            <span className="meter-value">{formattedValue(row.value, definition.unit)}</span>
          </div>
          <div className="meter-track" aria-hidden="true">
            <div
              className="meter-fill"
              style={{ width: top > 0 ? `${(row.value / top) * 100}%` : '0%' }}
            />
          </div>
        </div>
      ))}

      {definition.coverage && <p className="footnote">{definition.coverage}</p>}
    </section>
  );
}
