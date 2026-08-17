import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import {
  clubPath, formatDate, formatNumber, formatRoundShort, formatSpan, matchPath, playerPath, seasonPath,
} from '@/lib/format';
import type {
  NlAnswer, NlPlayerCareerRow, NlPlayerGameRow, NlPlayerSeasonRow,
} from '@/search/nl/answer-types';

/**
 * Renders a natural-language answer at the top of /search: a lead-result
 * card, then a table of ties/top-N when there is more than one row, an
 * era-coverage note when the metric is era-limited, and an expandable
 * "How was this calculated?" trace. A recognised-but-unanswerable
 * question (no coaching data, streaks not yet supported, …) gets its own
 * honest panel rather than the ordinary "no results" empty state.
 *
 * Only the player_career payload has a real renderer so far -- the other
 * grains land in later phases and execute.ts does not produce them yet,
 * so this component will not see them in production; the switch still
 * covers every case so a future grain landing here is a type error, not
 * a silent blank panel, until its renderer is written.
 */
export function NlAnswerSection({ answer }: { answer: NlAnswer }) {
  if (answer.payload.kind === 'unanswerable') {
    return (
      <section className="section">
        <div className="empty">
          <h2>{answer.headline}</h2>
          <p>{answer.payload.reason}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="section">
      <h2>{answer.headline}</h2>
      {answer.interpretation && <p className="muted">{answer.interpretation}</p>}

      {renderPayload(answer)}

      {answer.coverageNote && (
        <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>{answer.coverageNote}</p>
      )}
      {answer.caveats.map((caveat) => (
        <p key={caveat} className="muted" style={{ fontSize: '0.85rem' }}>{caveat}</p>
      ))}

      <details style={{ marginTop: '0.6rem' }}>
        <summary className="muted" style={{ cursor: 'pointer', fontSize: '0.85rem' }}>
          How was this calculated?
        </summary>
        <ul style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          {answer.explain.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </details>
    </section>
  );
}

function renderPayload(answer: NlAnswer) {
  const { payload } = answer;
  switch (payload.kind) {
    case 'player_career':
      return <PlayerCareerTable rows={payload.rows} total={payload.total} />;
    case 'player_game':
      return <PlayerGameTable rows={payload.rows} total={payload.total} />;
    case 'player_season':
      return <PlayerSeasonTable rows={payload.rows} total={payload.total} />;
    case 'count':
      return <p>{formatNumber(payload.value)}</p>;
    // team_match / club_season land in a later phase -- execute.ts does
    // not produce these yet.
    case 'team_match': case 'club_season':
      return null;
    case 'unanswerable':
      return null;
  }
}

function PlayerCareerTable({ rows, total }: { rows: NlPlayerCareerRow[]; total: number }) {
  if (rows.length <= 1) return null; // The headline already names the one answer.
  return (
    <>
      <CollapsibleTable title="Every matching player" note={`${formatNumber(total)} total`}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">Career</th>
                <th scope="col" className="num">Games</th>
                {rows[0]?.value !== null && <th scope="col" className="num">Value</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.playerId}>
                  <td className="wide">
                    <Link href={playerPath(r.slug, r.playerId)}>{r.displayName}</Link>
                  </td>
                  <td className="muted">{formatSpan(r.debutSeason, r.finalSeason)}</td>
                  <td className="num">{formatNumber(r.games)}</td>
                  {r.value !== null && <td className="num">{formatNumber(r.value)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleTable>
      {total > rows.length && (
        <p className="muted" style={{ marginTop: '0.6rem' }}>
          Showing {rows.length} of {formatNumber(total)}.
        </p>
      )}
    </>
  );
}

/**
 * Two row shapes share one table, distinguished by `games`: a single-game
 * row (games null) names a real match, a sum-mode row (games not null)
 * names a scoped career total with no single match to point at -- see
 * NlPlayerGameRow's own header comment in answer-types.ts.
 */
function PlayerGameTable({ rows, total }: { rows: NlPlayerGameRow[]; total: number }) {
  if (rows.length <= 1) return null;
  const isSum = rows[0]?.games !== null;
  return (
    <>
      <CollapsibleTable title={isSum ? 'Every matching player' : 'Every matching performance'} note={`${formatNumber(total)} total`}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col" className="num">Value</th>
                {isSum
                  ? <th scope="col" className="num">Games</th>
                  : <>
                      <th scope="col">Club</th>
                      <th scope="col">Opponent</th>
                      <th scope="col">Match</th>
                    </>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.matchId ?? r.playerId}>
                  <td className="wide">
                    <Link href={playerPath(r.playerSlug, r.playerId)}>{r.playerName}</Link>
                  </td>
                  <td className="num">{formatNumber(r.value)}</td>
                  {isSum ? (
                    <td className="num">{formatNumber(r.games)}</td>
                  ) : (
                    <>
                      <td>{r.clubName}</td>
                      <td>{r.opponentName}</td>
                      <td className="nowrap">
                        {r.matchId !== null && r.roundType !== null && (
                          <Link href={matchPath(r.matchId)}>
                            {r.season} {formatRoundShort(r.roundType, r.roundNumber)}
                          </Link>
                        )}
                        {' '}
                        <span className="muted">{formatDate(r.matchDate)}</span>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleTable>
      {total > rows.length && (
        <p className="muted" style={{ marginTop: '0.6rem' }}>
          Showing {rows.length} of {formatNumber(total)}.
        </p>
      )}
    </>
  );
}

function PlayerSeasonTable({ rows, total }: { rows: NlPlayerSeasonRow[]; total: number }) {
  if (rows.length <= 1) return null;
  return (
    <>
      <CollapsibleTable title="Every matching season" note={`${formatNumber(total)} total`}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col" className="num">Value</th>
                <th scope="col">Club</th>
                <th scope="col" className="num">Season</th>
                <th scope="col" className="num">Games</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.playerId}-${r.season}`}>
                  <td className="wide">
                    <Link href={playerPath(r.slug, r.playerId)}>{r.displayName}</Link>
                  </td>
                  <td className="num">{formatNumber(r.value)}</td>
                  <td>
                    {r.clubSlug ? (
                      <Link href={clubPath(r.clubSlug)}>{r.clubName}</Link>
                    ) : (
                      <span className="not-recorded">—</span>
                    )}
                  </td>
                  <td className="num"><Link href={seasonPath(r.season)}>{r.season}</Link></td>
                  <td className="num">{formatNumber(r.games)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleTable>
      {total > rows.length && (
        <p className="muted" style={{ marginTop: '0.6rem' }}>
          Showing {rows.length} of {formatNumber(total)}.
        </p>
      )}
    </>
  );
}
