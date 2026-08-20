import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { NlAnswerFeedback } from '@/components/NlAnswerFeedback';
import {
  clubPath, formatDate, formatNumber, formatPercentage, formatRoundShort, formatSpan,
  matchPath, playerPath, seasonPath,
} from '@/lib/format';
import type {
  NlAnswer, NlClubSeasonRow, NlPlayerCareerRow, NlPlayerGameRow, NlPlayerSeasonRow, NlTeamMatchRow, NlTeamStreakRow
} from '@/search/nl/answer-types';

/**
 * Renders a natural-language answer at the top of /search: a lead-result
 * card, then a table of ties/top-N when there is more than one row, an
 * era-coverage note when the metric is era-limited, and an expandable
 * "How was this calculated?" trace. A recognised-but-unanswerable
 * question (no coaching data, streaks not yet supported, …) gets its own
 * honest panel rather than the ordinary "no results" empty state.
 *
 * Every grain now has a real renderer; the switch below still covers
 * every case explicitly so a future sixth grain lands here as a type
 * error, not a silent blank panel.
 */
export function NlAnswerSection({ answer }: { answer: NlAnswer }) {
  if (answer.payload.kind === 'unanswerable') {
    return (
      <section className="section">
        <div className="empty">
          <h2>{answer.headline}</h2>
          <p>{answer.payload.reason}</p>
          <NlAnswerFeedback clientRef={answer.clientRef} />
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

      {/* Below the explanation, deliberately: a reader is best placed to
          say whether the question was understood once they have seen how
          it was read. */}
      <NlAnswerFeedback clientRef={answer.clientRef} />
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
    case 'team_match':
      return <TeamMatchTable rows={payload.rows} total={payload.total} />;
    case 'team_streak':
      return <TeamStreakTable rows={payload.rows} total={payload.total} />;
    case 'club_season':
      return <ClubSeasonTable rows={payload.rows} total={payload.total} />;
    case 'count':
      return <p>{formatNumber(payload.value)}</p>;
    case 'achievement_summary':
      return <AchievementSummaryTable payload={payload} />;
    case 'unanswerable':
      return null;
  }
}

function AchievementSummaryTable({
  payload,
}: {
  payload: Extract<NlAnswer['payload'], { kind: 'achievement_summary' }>;
}) {
  const { rows, groupBy } = payload;
  if (rows.length === 0) return null;

  // "Which clubs have never had one" and "who was first" are lists of
  // names; a count column on either would be noise (every value is 0, or
  // is the season already shown in the label).
  const isNameList = groupBy === 'occurrence' || rows.every((r) => r.value === 0);
  const heading = groupBy === 'club' ? 'Club'
    : groupBy === 'decade' ? 'Decade'
    : groupBy === 'season' ? 'Season'
    : 'Player';

  return (
    <CollapsibleTable
      title={isNameList ? `Every matching ${heading.toLowerCase()}` : `By ${heading.toLowerCase()}`}
      note={`${formatNumber(payload.total)} recorded ${payload.total === 1 ? 'player' : 'players'}`}
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{heading}</th>
              {!isNameList && <th scope="col" className="num">Players</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="wide">
                  {r.href ? <Link href={r.href}>{r.label}</Link> : r.label}
                </td>
                {!isNameList && <td className="num">{formatNumber(r.value)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleTable>
  );
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

function TeamMatchTable({ rows, total }: { rows: NlTeamMatchRow[]; total: number }) {
  if (rows.length <= 1) return null;
  return (
    <>
      <CollapsibleTable title="Every matching game" note={`${formatNumber(total)} total`}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Club</th>
                <th scope="col">Opponent</th>
                <th scope="col" className="num">Value</th>
                <th scope="col" className="num">Score</th>
                <th scope="col">Match</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.matchId}-${r.clubSlug}`}>
                  <td className="wide"><Link href={clubPath(r.clubSlug)}>{r.clubName}</Link></td>
                  <td><Link href={clubPath(r.opponentSlug)}>{r.opponentName}</Link></td>
                  <td className="num">{formatNumber(r.value)}</td>
                  <td className="num nowrap">{r.clubScore}–{r.opponentScore}</td>
                  <td className="nowrap">
                    <Link href={matchPath(r.matchId)}>
                      {r.season} {formatRoundShort(r.roundType, r.roundNumber)}
                    </Link>
                    {' '}
                    <span className="muted">{formatDate(r.matchDate)}</span>
                  </td>
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

function ClubSeasonTable({ rows, total }: { rows: NlClubSeasonRow[]; total: number }) {
  if (rows.length <= 1) return null;
  return (
    <>
      <CollapsibleTable title="Every matching club season" note={`${formatNumber(total)} total`}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Club</th>
                <th scope="col" className="num">Season</th>
                {rows[0]?.value !== null && <th scope="col" className="num">Value</th>}
                <th scope="col" className="num">Played</th>
                <th scope="col" className="num">W–D–L</th>
                <th scope="col" className="num">Ladder</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.clubId}-${r.season}`}>
                  <td className="wide"><Link href={clubPath(r.clubSlug)}>{r.clubName}</Link></td>
                  <td className="num"><Link href={seasonPath(r.season)}>{r.season}</Link></td>
                  {r.value !== null && (
                    <td className="num">
                      {/* percentage carries decimals; every other club_season metric is a whole game count */}
                      {Number.isInteger(r.value) ? formatNumber(r.value) : formatPercentage(r.value)}
                    </td>
                  )}
                  <td className="num">{formatNumber(r.played)}</td>
                  <td className="num nowrap">{r.wins}–{r.draws}–{r.losses}</td>
                  <td className="num">{r.ladderRank ?? '—'}</td>
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

function TeamStreakTable({ rows, total }: { rows: NlTeamStreakRow[]; total: number }) {
  if (rows.length <= 1) return null;
  return (
    <>
      <CollapsibleTable title="Every matching streak" note={`${formatNumber(total)} total`}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Club</th>
                {rows[0]?.opponentName && <th scope="col">Opponent</th>}
                <th scope="col" className="num">Streak Length</th>
                <th scope="col">Started</th>
                <th scope="col">Ended</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.clubId}-${i}`}>
                  <td className="wide"><Link href={clubPath(r.clubSlug)}>{r.clubName}</Link></td>
                  {r.opponentName && r.opponentSlug && (
                    <td><Link href={clubPath(r.opponentSlug)}>{r.opponentName}</Link></td>
                  )}
                  <td className="num">{formatNumber(r.streakLength)}</td>
                  <td className="nowrap">{formatDate(r.startDate)}</td>
                  <td className="nowrap">{formatDate(r.endDate)}</td>
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
