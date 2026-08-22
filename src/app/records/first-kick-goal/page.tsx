import type { Metadata } from 'next';
import Link from 'next/link';

import { Breadcrumbs } from '@/components/Breadcrumbs';
import { CollapsibleTable } from '@/components/CollapsibleTable';
import { FilterErrors } from '@/components/FilterErrors';
import { ReorderableSections } from '@/components/ReorderableSections';
import { SortableTable } from '@/components/SortableTable';
import { TableFilters } from '@/components/TableFilters';
import { UnmatchedPlayer } from '@/components/UnmatchedPlayer';
import { listClubs } from '@/db/queries/clubs';
import {
  getClubsWithoutFirstKickGoal,
  getFirstKickGoalByClub,
  getFirstKickGoalByDecade,
  getFirstKickGoalHighlights,
  getFirstKickGoalList,
  getFirstKickGoalProvenance,
  getFirstKickGoalSummary,
  type FirstKickGoalHighlight,
} from '@/db/queries/player-achievements';
import { clubPath, formatNumber, isLinked, matchPath, playerPath, seasonPath } from '@/lib/format';
import { pageMetadata } from '@/lib/seo';
import { clubOptions } from '@/search/list-filters';
import { type FilterField, parseFilterValues } from '@/search/table-filters';

export const revalidate = 86400;

const TITLE = 'Goal with first VFL/AFL kick';
const DEFINITION =
  'Players recognised as having kicked a goal with their first kick in a senior VFL/AFL match.';

export const metadata: Metadata = pageMetadata({
  title: `${TITLE} — Every Recognised Player`,
  description: DEFINITION,
  path: '/records/first-kick-goal',
});

function decadeOptions(rows: { decade: number }[]) {
  return rows.map((r) => ({ value: String(r.decade), label: `${r.decade}s` }));
}

/** Player name (linked when matched) plus round (linked when the match resolved), for a highlight stat tile. */
function HighlightNote({ highlight }: { highlight: FirstKickGoalHighlight }) {
  return (
    <div className="note">
      {highlight.playerId !== null && highlight.playerSlug
        ? <Link href={playerPath(highlight.playerSlug, highlight.playerId)}>{highlight.playerName}</Link>
        : highlight.playerName}
      {' · '}
      {highlight.matchId !== null
        ? <Link href={matchPath(highlight.matchId)}>{highlight.roundRaw}</Link>
        : highlight.roundRaw}
    </div>
  );
}

export default async function FirstKickGoalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;

  const [summary, highlights, byClub, byDecade, without, provenance, clubs] = await Promise.all([
    getFirstKickGoalSummary(),
    getFirstKickGoalHighlights(),
    getFirstKickGoalByClub(),
    getFirstKickGoalByDecade(),
    getClubsWithoutFirstKickGoal(),
    getFirstKickGoalProvenance(),
    listClubs(),
  ]);

  const FEATURE_OPTIONS = [
    { value: 'multi-kick', label: 'Multiple kicks (goal with each of first 2+ kicks)' },
    { value: 'only-career-goal', label: 'Only career goal' },
  ];

  const fields: FilterField[] = [
    { kind: 'text', key: 'q', label: 'Player', placeholder: 'Name contains…' },
    { kind: 'select', key: 'club', label: 'Club', options: clubOptions(clubs), anyLabel: 'Any club' },
    { kind: 'select', key: 'decade', label: 'Decade', options: decadeOptions(byDecade), anyLabel: 'Any decade' },
    { kind: 'select', key: 'feature', label: 'Feature', options: FEATURE_OPTIONS, anyLabel: 'Any' },
  ];
  const values = parseFilterValues(fields, query);
  const decadeValue = values.select.decade ? Number(values.select.decade) : undefined;
  const feature = values.select.feature as 'multi-kick' | 'only-career-goal' | undefined;

  const rows = await getFirstKickGoalList({
    q: values.text.q || undefined,
    club: values.select.club || undefined,
    decade: Number.isFinite(decadeValue) ? decadeValue : undefined,
    feature,
  });

  const sections: { id: string; label: string; node: React.ReactNode }[] = [];

  sections.push({
    id: 'players',
    label: 'Every player',
    node: (
      <section className="section">
        <CollapsibleTable
          id="players"
          title="Every recognised player"
          note={`${formatNumber(rows.length)} shown`}
          defaultOpen
          filters={
            <>
              <TableFilters
                action="/records/first-kick-goal"
                anchor="players"
                fields={fields}
                values={values}
              />
              <FilterErrors errors={values.errors} />
            </>
          }
        >
          <div className="table-wrap">
            <SortableTable
              defaultSort="season"
              defaultDir="desc"
              columns={[
                { key: 'player', label: 'Player', sortType: 'text' },
                { key: 'club', label: 'Club', sortType: 'text' },
                { key: 'season', label: 'Season', sortType: 'number', className: 'num' },
                { key: 'round', label: 'Round', sortType: 'text' },
                { key: 'opponent', label: 'Opponent', sortType: 'text' },
                { key: 'note', label: 'Note', sortType: 'text' },
              ]}
              items={rows.map((r) => ({
                id: String(r.id),
                values: {
                  player: r.playerName,
                  club: r.clubName ?? '',
                  season: r.season,
                  round: r.roundRaw,
                  opponent: r.opponentName ?? '',
                  note: [
                    r.consecutiveGoalKicks > 1 ? 'z' : '',
                    r.noFurtherCareerKicks ? 'z' : '',
                  ].join(''), // Sort note by existence
                },
                element: (
                  <tr key={r.id}>
                    <td className="wide">
                      {r.playerId !== null && r.playerSlug
                        ? <Link href={playerPath(r.playerSlug, r.playerId)}>{r.playerName}</Link>
                        : r.playerName}
                      {!isLinked(r.linkStatus) && (
                        <UnmatchedPlayer targetTable="player_achievements" targetId={r.id} />
                      )}
                    </td>
                    <td>
                      {r.clubSlug && r.clubName
                        ? <Link href={clubPath(r.clubSlug)}>{r.clubName}</Link>
                        : <span className="muted">—</span>}
                    </td>
                    <td className="num"><Link href={seasonPath(r.season)}>{r.season}</Link></td>
                    <td>
                      {r.matchId !== null
                        ? <Link href={matchPath(r.matchId)}>{r.roundRaw}</Link>
                        : r.roundRaw}
                    </td>
                    <td>
                      {r.opponentSlug && r.opponentName
                        ? <Link href={clubPath(r.opponentSlug)}>{r.opponentName}</Link>
                        : <span className="muted">—</span>}
                    </td>
                    <td className="muted">
                      {[
                        r.consecutiveGoalKicks > 1 ? `Goal with each of first ${r.consecutiveGoalKicks} kicks` : null,
                        r.noFurtherCareerKicks ? 'Only career kick' : null,
                        r.noFurtherCareerGoals && !r.noFurtherCareerKicks ? 'Only career goal' : null,
                        r.kicklessMatchesBeforeFirstKick > 0
                          ? `No kick in first ${r.kicklessMatchesBeforeFirstKick === 1 ? 'match' : `${r.kicklessMatchesBeforeFirstKick} matches`}`
                          : null,
                      ].filter(Boolean).join(' · ') || '—'}
                    </td>
                  </tr>
                ),
              }))}
            />
          </div>
        </CollapsibleTable>
      </section>
    ),
  });

  sections.push({
    id: 'by-club',
    label: 'By club',
    node: (
      <section className="section">
        <CollapsibleTable
          id="by-club"
          title="By club"
          note="Counted by lineage, so Footscray rows count toward the Western Bulldogs"
        >
          <div className="table-wrap">
            <SortableTable
              defaultSort="club"
              defaultDir="asc"
              columns={[
                { key: 'club', label: 'Club', sortType: 'text' },
                { key: 'players', label: 'Players', sortType: 'number', className: 'num' },
                { key: 'first', label: 'First', sortType: 'number', className: 'num' },
                { key: 'last', label: 'Most recent', sortType: 'number', className: 'num' },
              ]}
              items={byClub.map((c) => ({
                id: c.slug,
                values: {
                  club: c.name,
                  players: c.players,
                  first: c.earliest ?? 9999,
                  last: c.latest ?? 0,
                },
                element: (
                  <tr key={c.slug}>
                    <td className="wide"><Link href={clubPath(c.slug)}>{c.name}</Link></td>
                    <td className="num">{formatNumber(c.players)}</td>
                    <td className="num">{c.earliest}</td>
                    <td className="num">{c.latest}</td>
                  </tr>
                ),
              }))}
            />
          </div>
          {without.length > 0 && (
            <p className="muted">
              No recorded instance for{' '}
              {without.map((c, i) => (
                <span key={c.slug}>
                  <Link href={clubPath(c.slug)}>{c.name}</Link>
                  {i < without.length - 1 ? ', ' : ''}
                </span>
              ))}
              .
            </p>
          )}
        </CollapsibleTable>
      </section>
    ),
  });

  sections.push({
    id: 'by-decade',
    label: 'By decade',
    node: (
      <section className="section">
        <CollapsibleTable id="by-decade" title="By decade">
          <div className="table-wrap">
            <SortableTable
              defaultSort="decade"
              defaultDir="desc"
              columns={[
                { key: 'decade', label: 'Decade', sortType: 'number' },
                { key: 'players', label: 'Players', sortType: 'number', className: 'num' },
              ]}
              items={byDecade.map((d) => ({
                id: String(d.decade),
                values: {
                  decade: d.decade,
                  players: d.players,
                },
                element: (
                  <tr key={d.decade}>
                    <td className="wide">{d.decade}s</td>
                    <td className="num">{formatNumber(d.players)}</td>
                  </tr>
                ),
              }))}
            />
          </div>
        </CollapsibleTable>
      </section>
    ),
  });

  return (
    <>
      <Breadcrumbs items={[{ label: 'Records', href: '/records' }, { label: TITLE }]} />

      <div className="page-header">
        <h1>{TITLE}</h1>
        <p className="subtitle">{DEFINITION}</p>
      </div>

      <div className="stat-strip">
        <div className="stat">
          <div className="value">{formatNumber(summary.total)}</div>
          <div className="label">Recognised players</div>
          {summary.unlinked > 0 && (
            <div className="note">{formatNumber(summary.linked)} matched to a player</div>
          )}
        </div>
        <div className="stat">
          <div className="value">
            {highlights.earliest
              ? <Link href={seasonPath(highlights.earliest.season)}>{highlights.earliest.season}</Link>
              : summary.earliestSeason ?? '—'}
          </div>
          <div className="label">Earliest</div>
          {highlights.earliest && <HighlightNote highlight={highlights.earliest} />}
        </div>
        <div className="stat">
          <div className="value">
            {highlights.latest
              ? <Link href={seasonPath(highlights.latest.season)}>{highlights.latest.season}</Link>
              : summary.latestSeason ?? '—'}
          </div>
          <div className="label">Most recent</div>
          {highlights.latest && <HighlightNote highlight={highlights.latest} />}
        </div>
        <div className="stat">
          <div className="value">
            <Link href="/records/first-kick-goal?feature=multi-kick#players">{formatNumber(summary.multiKick)}</Link>
          </div>
          <div className="label">Multiple kicks</div>
          <div className="note">a goal with each of their first 2+ kicks</div>
        </div>
        <div className="stat">
          <div className="value">
            <Link href="/records/first-kick-goal?feature=only-career-goal#players">{formatNumber(summary.onlyCareerGoal)}</Link>
          </div>
          <div className="label">Only career goal</div>
        </div>
      </div>

      <ReorderableSections storageKey="/records/first-kick-goal" sections={sections} />

      {/* What the source asserts and what AFLDB verified are different
          things, and the page says which is which rather than presenting
          the whole list as equally confirmed. */}
      <section className="section">
        <h2>About this record</h2>
        <p>
          AFLDB stores no play-by-play data, so the claim itself — that a player&rsquo;s
          first kick was a goal — cannot be recomputed from match statistics. It is
          recorded here as a cited fact.
          {' '}
          {formatNumber(summary.linked)} of {formatNumber(summary.total)} rows are matched
          to an AFLDB player, and {formatNumber(summary.matchesResolved)} are linked to the
          match itself; the rest are kept with the source&rsquo;s own spelling rather than
          guessed at.
        </p>
        {provenance && (
          <p className="muted">
            Source:{' '}
            {provenance.url
              ? <a href={provenance.url} rel="nofollow noopener noreferrer" target="_blank">{provenance.name}</a>
              : provenance.name}
            .
          </p>
        )}
      </section>
    </>
  );
}
