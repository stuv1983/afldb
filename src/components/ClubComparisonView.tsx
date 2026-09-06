import { ClubComparisonBrownlow } from '@/components/ClubComparisonBrownlow';
import { ClubComparisonControls } from '@/components/ClubComparisonControls';
import { ClubComparisonHeadToHead } from '@/components/ClubComparisonHeadToHead';
import { ClubComparisonPlayers } from '@/components/ClubComparisonPlayers';
import { ClubComparisonSeason } from '@/components/ClubComparisonSeason';
import { ClubComparisonTrends } from '@/components/ClubComparisonTrends';
import type { ClubComparisonRouteState, ComparisonNotice } from '@/app/clubs/compare/state';
import { matchTypeLabel } from '@/lib/club-comparison-format';
import { formatDate } from '@/lib/format';

/**
 * The public presentation of /clubs/compare (AFLDB-ISSUE-144 Stage 8).
 *
 * It renders the discriminated route state Stage 7 resolved and does
 * nothing else: no search parameter is re-parsed here, no query is run
 * here, and no population, coverage, Brownlow or identity rule is
 * decided here. Every one of the four states — unselected, invalid club,
 * same organisation and comparison — has a usable page, and only the
 * fourth carries data at all, which is what makes it impossible for this
 * component to render a comparison the route did not resolve.
 *
 * The selectors are a plain GET form and every other control is a link,
 * so the whole surface stays server-rendered and every view a reader can
 * reach is a URL they can share.
 */
export function ClubComparisonView({ state }: { state: ClubComparisonRouteState }) {
  const seasonMeta = state.seasonMeta;

  return (
    <>
      <div className="page-header">
        <p className="eyebrow">Clubs</p>
        <h1>
          {state.kind === 'comparison'
            ? `${state.organizationA.name} v ${state.organizationB.name}`
            : 'Compare clubs'}
        </h1>
        {state.kind === 'comparison' ? (
          <p className="subtitle">
            {state.params.season !== null && <>Season {state.params.season} · </>}
            {matchTypeLabel(state.params.matchType)}
            {seasonMeta?.isProvisional && (
              <>
                {' '}<span className="badge badge-warn">Season in progress</span>
                {seasonMeta.dataThroughDate && (
                  <> Data through {formatDate(seasonMeta.dataThroughDate)}.</>
                )}
              </>
            )}
          </p>
        ) : (
          <p className="lede">
            Compare any two VFL/AFL clubs: their record in a chosen season, their complete
            head-to-head history, the rivalry’s records, and the players who have
            represented both.
          </p>
        )}
      </div>

      <Notices notices={state.notices} />

      <ClubComparisonControls
        params={state.params}
        options={state.options}
        swapPath={state.kind === 'comparison' ? state.swapPath : undefined}
      />

      {state.kind === 'unselected' && (
        <div className="empty">
          <h2>Choose two clubs</h2>
          <p>
            Pick a club in each list above and compare them. Nothing is chosen for you, and
            every comparison you reach has its own shareable address.
          </p>
        </div>
      )}

      {state.kind === 'invalid-club' && (
        <div className="empty">
          <h2>That club could not be found</h2>
          <p>
            {state.invalidSlugs.length === 1
              ? `“${state.invalidSlugs[0]}” is not a club on record.`
              : `“${state.invalidSlugs.join('” and “')}” are not clubs on record.`}{' '}
            Choose from the lists above. A club’s earlier names are part of the same club
            here, so they are not separate choices.
          </p>
        </div>
      )}

      {state.kind === 'same-organization' && (
        <div className="empty">
          <h2>Choose two different clubs</h2>
          <p>
            {state.organization.name} cannot be compared with itself. Choose a second,
            different club above.
          </p>
        </div>
      )}

      {state.kind === 'comparison' && (
        <>
          <ClubComparisonSeason
            organizationA={state.organizationA}
            organizationB={state.organizationB}
            season={state.params.season}
            seasonA={state.data.seasonA}
            seasonB={state.data.seasonB}
          />

          <ClubComparisonHeadToHead
            organizationA={state.organizationA}
            organizationB={state.organizationB}
            params={state.params}
            summary={state.data.summary}
            meetings={state.data.meetings}
            records={state.data.records}
            streaks={state.data.streaks}
            venues={state.data.venues}
          />

          <ClubComparisonPlayers
            organizationA={state.organizationA}
            organizationB={state.organizationB}
            playerLeaders={state.data.playerLeaders}
            crossoverSummary={state.data.crossoverSummary}
            crossoverPlayers={state.data.crossoverPlayers}
            playerAverages={state.data.playerAverages}
          />

          <ClubComparisonBrownlow
            organizationA={state.organizationA}
            organizationB={state.organizationB}
            season={state.params.season}
            seasonA={state.data.seasonA}
            seasonB={state.data.seasonB}
            brownlowA={state.data.brownlowA}
            brownlowB={state.data.brownlowB}
            h2hBrownlow={state.data.h2hBrownlow}
          />

          <ClubComparisonTrends
            organizationA={state.organizationA}
            organizationB={state.organizationB}
            decades={state.data.decades}
            periodRecords={state.data.periodRecords}
          />
        </>
      )}
    </>
  );
}

/**
 * Parameters the route could not honour as supplied. Shown, never
 * swallowed: a reader looking at a normalised view is owed the sentence
 * explaining why it is not the one they asked for.
 */
function Notices({ notices }: { notices: ComparisonNotice[] }) {
  if (notices.length === 0) return null;
  return (
    <div className="notice" role="status">
      <ul className="ruled-list">
        {notices.map((notice) => (
          <li key={`${notice.field}:${notice.message}`}>{notice.message}</li>
        ))}
      </ul>
    </div>
  );
}
