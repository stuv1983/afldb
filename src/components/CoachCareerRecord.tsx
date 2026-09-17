import Link from 'next/link';

import { ExpandableTableFrame } from '@/components/ExpandableTableFrame';
import { SortableTable } from '@/components/SortableTable';
import type {
  CoachCareer,
  CoachCareerMatch,
  CoachingClubStint,
  CoachOpponentOrganization,
  CoachOrganizationTotals,
  CoachVenueRecord,
} from '@/db/queries/coaches';
import {
  NOT_RECORDED, clubPath, formatDate, formatNumber, formatPercentage, formatSpan, matchPath, venuePath,
} from '@/lib/format';

/**
 * THE shared detailed coaching-record presentation (AFLDB-ISSUE-170 Stage
 * 1D): totals, club-by-club record, biggest win/loss and venue history.
 * Every surface that shows a coach's record -- the standalone coach-only
 * page, the player-linked `PlayerCoachingCareer` panel, and (for the
 * opponent-scoped slice) both of those pages' history-against-club
 * section -- renders through these functions and nothing else, so the
 * table markup for "a coach's record" exists exactly once.
 *
 * Every function here is a pure prop-to-JSX renderer: no data fetching,
 * no hooks, no client/server directive of its own. That is what lets the
 * same functions run inside a plain Server Component (the standalone
 * page, resolved entirely server-side) and inside a 'use client' subtree
 * (the player page's opponent selector, resolved from a client fetch —
 * see CoachOpponentHistoryClient) without two implementations.
 *
 * `matchDate`/`firstMatchDate`/`lastMatchDate` accept `Date | string`
 * rather than the query layer's `Date` alone: the client-fetched variant
 * has already been through `JSON.stringify`, which turns a `Date` into an
 * ISO string, and `formatDate` already handles either. A query-layer
 * value (a real `Date`) is assignable wherever `Date | string` is
 * expected, so no transformation is needed on the server-rendered path.
 */

type MatchLike = Omit<CoachCareerMatch, 'matchDate'> & { matchDate: Date | string };
type VenueLike = Omit<CoachVenueRecord, 'firstMatchDate' | 'lastMatchDate'> & {
  firstMatchDate: Date | string;
  lastMatchDate: Date | string;
};

type TotalsLike = {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  winPct: number | null;
  finals: number;
  grandFinals: number;
  /** Absent for an opponent-scoped record (AFLDB-ISSUE-170 Stage 1C never asks for it). */
  premierships?: number;
};

export type CoachOpponentRecordLike = {
  organization: CoachOpponentOrganization;
  totals: CoachOrganizationTotals;
  biggestWin: MatchLike | null;
  biggestLoss: MatchLike | null;
  venues: VenueLike[];
};

/** Games/Win%/Record/Finals(/Premierships) — the same six-or-eight-cell summary table on every surface. */
export function CoachTotalsTable({ totals }: { totals: TotalsLike }) {
  return (
    <div className="table-wrap">
      <table>
        <tbody>
          <tr>
            <th scope="row">Games</th>
            <td className="num">{formatNumber(totals.games)}</td>
            <th scope="row">Win %</th>
            <td className="num">{formatPercentage(totals.winPct)}</td>
          </tr>
          <tr>
            <th scope="row">Record</th>
            <td className="num nowrap">{totals.wins}W – {totals.losses}L – {totals.draws}D</td>
            <th scope="row">Finals</th>
            <td className="num">{formatNumber(totals.finals)}</td>
          </tr>
          <tr>
            <th scope="row">Grand Finals</th>
            <td className="num" colSpan={totals.premierships === undefined ? 3 : 1}>
              {formatNumber(totals.grandFinals)}
            </td>
            {totals.premierships !== undefined && (
              <>
                <th scope="row">Premierships</th>
                <td className="num">{formatNumber(totals.premierships)}</td>
              </>
            )}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** The club-by-club coaching record (Stage 1A, pre-existing). `linkClubs` is false on the player page, whose own Clubs section already links every club. */
export function CoachClubTable({ clubs, linkClubs }: { clubs: CoachingClubStint[]; linkClubs: boolean }) {
  if (clubs.length === 0) return null;
  return (
    <div className="table-wrap">
      <SortableTable
        defaultSort="firstSeason"
        defaultDir="asc"
        columns={[
          { key: 'club', label: 'Club', sortType: 'text' },
          { key: 'firstSeason', label: 'Seasons', sortType: 'number', className: 'num nowrap' },
          { key: 'games', label: 'Games', sortType: 'number', className: 'num' },
          { key: 'wld', label: 'W–L–D', sortType: 'number', className: 'num nowrap' },
          { key: 'winPct', label: 'Win %', sortType: 'number', className: 'num' },
          { key: 'finals', label: 'Finals', sortType: 'number', className: 'num' },
          { key: 'grandFinals', label: 'GF', sortType: 'number', className: 'num' },
          { key: 'premierships', label: 'Prem', sortType: 'number', className: 'num' },
        ]}
        items={clubs.map((c) => ({
          id: String(c.clubId),
          values: {
            club: c.clubName,
            firstSeason: c.firstSeason,
            games: c.games,
            wld: c.wins,
            winPct: c.winPct ?? -1,
            finals: c.finals,
            grandFinals: c.grandFinals,
            premierships: c.premierships,
          },
          element: (
            <tr key={c.clubId}>
              <td>{linkClubs ? <Link href={clubPath(c.clubSlug)}>{c.clubName}</Link> : c.clubName}</td>
              <td className="num nowrap">{formatSpan(c.firstSeason, c.lastSeason)}</td>
              <td className="num">{formatNumber(c.games)}</td>
              <td className="num nowrap">{c.wins}–{c.losses}–{c.draws}</td>
              <td className="num">{formatPercentage(c.winPct)}</td>
              <td className="num">{formatNumber(c.finals)}</td>
              <td className="num">{formatNumber(c.grandFinals)}</td>
              <td className="num">{formatNumber(c.premierships)}</td>
            </tr>
          ),
        }))}
      />
    </div>
  );
}

/**
 * Biggest win and biggest loss (Stage 1A), one row each, following the
 * club page's own headline-match-record table
 * ({@link ClubMatchRecords}) rather than inventing a new "record card"
 * pattern. `showCoachedClub` adds a Coaching column: useful context for a
 * multi-club coach, clutter for a one-club one.
 */
export function CoachBiggestWinLossTable({
  biggestWin,
  biggestLoss,
  showCoachedClub,
}: {
  biggestWin: MatchLike | null;
  biggestLoss: MatchLike | null;
  showCoachedClub: boolean;
}) {
  if (biggestWin === null && biggestLoss === null) {
    return <p className="muted">No qualifying (decided) match on record.</p>;
  }

  const rows: { label: string; match: MatchLike | null }[] = [
    { label: 'Biggest win', match: biggestWin },
    { label: 'Biggest loss', match: biggestLoss },
  ];
  const emptyColSpan = showCoachedClub ? 5 : 4;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Record</th>
            <th scope="col" className="num nowrap">Margin</th>
            <th scope="col">Opponent</th>
            {showCoachedClub && <th scope="col">Coaching</th>}
            <th scope="col" className="num">Season</th>
            <th scope="col" className="nowrap">Date</th>
            <th scope="col">Venue</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, match }) => (
            <tr key={label}>
              <th scope="row">
                {label}
                {match?.roundType === 'grand_final' && <span className="muted"> — Grand Final</span>}
                {match?.roundType !== 'grand_final' && match?.isFinalsSeries && <span className="muted"> — Finals</span>}
              </th>
              {match ? (
                <>
                  <td className="num nowrap">
                    {match.margin > 0 ? `+${formatNumber(match.margin)}` : formatNumber(match.margin)}
                  </td>
                  <td className="wide"><Link href={clubPath(match.opponentClubSlug)}>{match.opponentClubName}</Link></td>
                  {showCoachedClub && (
                    <td><Link href={clubPath(match.coachedClubSlug)}>{match.coachedClubName}</Link></td>
                  )}
                  <td className="num"><Link href={matchPath(match.matchId)}>{match.season}</Link></td>
                  <td className="nowrap">{formatDate(match.matchDate)}</td>
                  <td>
                    {match.venueSlug
                      ? <Link href={venuePath(match.venueSlug)}>{match.venueName}</Link>
                      : (match.venueName ?? NOT_RECORDED)}
                  </td>
                </>
              ) : (
                <td className="muted" colSpan={emptyColSpan}>No qualifying match on record.</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Per-venue history (Stage 1B), also reused for the opponent-scoped venue breakdown (Stage 1C). */
export function CoachVenueHistoryTable({ venues }: { venues: VenueLike[] }) {
  if (venues.length === 0) {
    return <p className="muted">No canonical venue history on record.</p>;
  }
  return (
    <div className="table-wrap">
      <SortableTable
        defaultSort="games"
        defaultDir="desc"
        columns={[
          { key: 'venue', label: 'Venue', sortType: 'text' },
          { key: 'games', label: 'Games', sortType: 'number', className: 'num' },
          { key: 'wld', label: 'W–L–D', sortType: 'number', className: 'num nowrap' },
          { key: 'winPct', label: 'Win %', sortType: 'number', className: 'num' },
          { key: 'finals', label: 'Finals', sortType: 'number', className: 'num' },
          { key: 'grandFinals', label: 'GF', sortType: 'number', className: 'num' },
          { key: 'firstMatch', label: 'First', sortType: 'number', className: 'num nowrap' },
          { key: 'lastMatch', label: 'Most recent', sortType: 'number', className: 'num nowrap' },
        ]}
        items={venues.map((v) => ({
          id: String(v.venueId),
          values: {
            venue: v.venueName,
            games: v.games,
            wld: v.wins,
            winPct: v.winPct ?? -1,
            finals: v.finals,
            grandFinals: v.grandFinals,
            firstMatch: new Date(v.firstMatchDate).getTime(),
            lastMatch: new Date(v.lastMatchDate).getTime(),
          },
          element: (
            <tr key={v.venueId}>
              <td><Link href={venuePath(v.venueSlug)}>{v.venueName}</Link></td>
              <td className="num">{formatNumber(v.games)}</td>
              <td className="num nowrap">{v.wins}–{v.losses}–{v.draws}</td>
              <td className="num">{formatPercentage(v.winPct)}</td>
              <td className="num">{formatNumber(v.finals)}</td>
              <td className="num">{formatNumber(v.grandFinals)}</td>
              <td className="num nowrap">{formatDate(v.firstMatchDate)}</td>
              <td className="num nowrap">{formatDate(v.lastMatchDate)}</td>
            </tr>
          ),
        }))}
      />
    </div>
  );
}

/**
 * The full Stage 1D career body: totals, club-by-club record, biggest
 * win/loss and venue history. An explicit zero-game state replaces all of
 * it (AFLDB-ISSUE-170 Stage 1A) rather than rendering a table of invented
 * zeros — the Jim Adamson case (coach id 315, Stage 0 §0.2).
 */
export function CoachCareerBody({
  career,
  linkClubs,
  showTotalsTable = true,
  expandWideTables = false,
}: {
  career: CoachCareer;
  linkClubs: boolean;
  /** `false` on the standalone coach page, whose `.stat-strip` already shows these totals (AFLDB-ISSUE-174). */
  showTotalsTable?: boolean;
  /** Wraps the club and venue tables in `ExpandableTableFrame` (AFLDB-ISSUE-174), matching the Coaches index's own wiring. Off by default so `PlayerCoachingCareer`'s existing panel is unaffected. */
  expandWideTables?: boolean;
}) {
  if (career.totals.games === 0) {
    return <p className="muted">No canonical coaching match is currently recorded for this coach.</p>;
  }
  const showCoachedClub = career.clubs.length > 1;
  const clubTable = <CoachClubTable clubs={career.clubs} linkClubs={linkClubs} />;
  const venueTable = <CoachVenueHistoryTable venues={career.venues} />;
  return (
    <>
      {showTotalsTable && <CoachTotalsTable totals={career.totals} />}
      {expandWideTables && career.clubs.length > 0 ? (
        <ExpandableTableFrame title="Club-by-club coaching record">{clubTable}</ExpandableTableFrame>
      ) : clubTable}
      <h3>Biggest win and loss</h3>
      <CoachBiggestWinLossTable
        biggestWin={career.biggestWin}
        biggestLoss={career.biggestLoss}
        showCoachedClub={showCoachedClub}
      />
      <h3>Venue history</h3>
      {expandWideTables && career.venues.length > 0 ? (
        <ExpandableTableFrame title="Venue history">{venueTable}</ExpandableTableFrame>
      ) : venueTable}
    </>
  );
}

/**
 * The opponent-scoped record (Stage 1C): totals (no Premierships — see
 * {@link CoachOrganizationTotals}), biggest win/loss and venue breakdown
 * against the selected organisation. An explicit zero-meeting state
 * replaces it, never a table of zeros — the same convention
 * {@link CoachCareerBody} uses for a zero-game coach.
 */
export function CoachOpponentRecordBody({
  record,
  showCoachedClub,
}: {
  record: CoachOpponentRecordLike;
  showCoachedClub: boolean;
}) {
  if (record.totals.games === 0) {
    return (
      <p className="muted">
        No canonical coaching meetings are recorded against {record.organization.name}.
      </p>
    );
  }
  return (
    <>
      <CoachTotalsTable totals={record.totals} />
      <h4>Biggest win and loss vs {record.organization.name}</h4>
      <CoachBiggestWinLossTable
        biggestWin={record.biggestWin}
        biggestLoss={record.biggestLoss}
        showCoachedClub={showCoachedClub}
      />
      <h4>Venue breakdown vs {record.organization.name}</h4>
      <CoachVenueHistoryTable venues={record.venues} />
    </>
  );
}
