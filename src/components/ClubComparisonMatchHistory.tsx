import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { Pagination } from '@/components/Pagination';
import type { ComparisonOrganization, MeetingsPage } from '@/db/queries/club-comparison';
import type { ComparisonEffectiveParams } from '@/app/clubs/compare/state';
import {
  MATCH_TYPE_LABELS,
  eraCaptionSuffix,
  matchTypeLabel,
  outcomeLabel,
} from '@/lib/club-comparison-format';
import { CLUB_COMPARE_PATH, MATCH_TYPES, clubCompareBaseParams } from '@/lib/club-comparison-url';
import { clubPath, formatDate, formatNumber, formatRound, formatStat, matchPath } from '@/lib/format';

/**
 * The complete meeting history for /clubs/compare (Club Rivalry Explorer
 * follow-up, FR-3): its own collapsed top-level section, with the
 * match-type control relocated here from the shared club-selector form —
 * match type only ever narrows this section, so it now lives with the
 * section it filters rather than with club selection.
 */
export function ClubComparisonMatchHistory({
  organizationA,
  organizationB,
  params,
  meetings,
}: {
  organizationA: ComparisonOrganization;
  organizationB: ComparisonOrganization;
  params: ComparisonEffectiveParams;
  meetings: MeetingsPage;
}) {
  const aName = organizationA.name;
  const bName = organizationB.name;

  return (
    <CollapsibleTable
      id="match-history"
      title="Match history"
      note={`${formatNumber(meetings.totalMeetings)} meetings`}
      filters={<MatchTypeFilter params={params} />}
      defaultOpen={false}
    >
      <p className="section-note">
        {meetings.era !== null && `${eraCaptionSuffix(meetings.era).trim()} · `}
        {matchTypeLabel(meetings.matchType)}: {formatNumber(meetings.totalMeetings)}{' '}
        {meetings.totalMeetings === 1 ? 'meeting' : 'meetings'}, most recent first.
      </p>
      {meetings.totalMeetings === 0 ? (
        <p className="empty">
          No meeting matches this filter. Try “All matches”.
        </p>
      ) : meetings.meetings.length === 0 ? (
        <p className="empty">
          Page {meetings.page} is past the end of this history — there are{' '}
          {formatNumber(meetings.totalPages)} pages.
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <caption>
              {aName} versus {bName} — {matchTypeLabel(meetings.matchType)}
              {eraCaptionSuffix(meetings.era)}, page{' '}
              {meetings.page} of {formatNumber(meetings.totalPages)}
            </caption>
            <thead>
              <tr>
                <th scope="col" className="nowrap">Date</th>
                <th scope="col" className="num">Season</th>
                <th scope="col">Round</th>
                <th scope="col">Venue</th>
                <th scope="col">Home</th>
                <th scope="col" className="num">Score</th>
                <th scope="col">Away</th>
                <th scope="col">Result</th>
                <th scope="col" className="num">Margin</th>
              </tr>
            </thead>
            <tbody>
              {meetings.meetings.map((meeting) => (
                <tr key={meeting.matchId}>
                  <td className="nowrap">
                    <Link href={matchPath(meeting.matchId)}>
                      {formatDate(meeting.matchDate)}
                    </Link>
                  </td>
                  <td className="num">{meeting.season}</td>
                  <td className="nowrap">
                    {formatRound(meeting.roundType, meeting.roundNumber, meeting.roundCode)}
                    {meeting.isFinalsSeries && <span className="badge">Finals</span>}
                  </td>
                  <td className="wide">{meeting.venueName ?? 'Not recorded'}</td>
                  <td className="wide">
                    <Link href={clubPath(meeting.homeClubSlug)}>{meeting.homeClubName}</Link>
                  </td>
                  <td className="num nowrap">
                    {formatStat(meeting.homeScore)}–{formatStat(meeting.awayScore)}
                  </td>
                  <td className="wide">
                    <Link href={clubPath(meeting.awayClubSlug)}>{meeting.awayClubName}</Link>
                  </td>
                  <td>{outcomeLabel(meeting.outcome, aName, bName)}</td>
                  <td className="num">{formatStat(meeting.margin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination
        basePath={CLUB_COMPARE_PATH}
        params={clubCompareBaseParams(params)}
        page={meetings.page}
        pageSize={meetings.pageSize}
        total={meetings.totalMeetings}
      />
    </CollapsibleTable>
  );
}

/**
 * The match-type control, local to this section (Club Rivalry Explorer
 * follow-up, FR-3). A plain GET form carrying the current pair and era as
 * hidden fields, so changing match type here narrows only the match
 * history and does not disturb the rest of the page's state. Submitting
 * drops `page`, same as every other filter change on this surface — a new
 * match-type population starts its history at page 1.
 */
function MatchTypeFilter({ params }: { params: ComparisonEffectiveParams }) {
  return (
    <form method="get" action={`${CLUB_COMPARE_PATH}#match-history`}>
      <input type="hidden" name="club1" value={params.club1 ?? ''} />
      <input type="hidden" name="club2" value={params.club2 ?? ''} />
      {params.era !== null && <input type="hidden" name="era" value={String(params.era)} />}
      <div className="filter-grid">
        <div>
          <label htmlFor="match-history-match-type">Match type</label>
          <select
            id="match-history-match-type"
            name="matchType"
            defaultValue={params.matchType}
          >
            {MATCH_TYPES.map((type) => (
              <option key={type} value={type}>{MATCH_TYPE_LABELS[type]}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="filter-actions">
        <button className="btn" type="submit">Apply match type</button>
      </div>
    </form>
  );
}
