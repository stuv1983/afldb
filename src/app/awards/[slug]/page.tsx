import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Breadcrumbs } from '@/components/Breadcrumbs';
import { CollapsibleTable } from '@/components/CollapsibleTable';
import { FilterErrors } from '@/components/FilterErrors';
import { ReorderableSections } from '@/components/ReorderableSections';
import { TableFilters } from '@/components/TableFilters';
import { UnmatchedPlayer } from '@/components/UnmatchedPlayer';
import {
  getAward,
  getAwardLeaders,
  getAwardWinners,
  getNominationSeasons,
  getNominationsByClub,
  listAwards,
} from '@/db/queries/awards';
import {
  awardPath,
  awardSeasonPath,
  clubPath,
  formatNumber,
  formatSpan,
  isLinked,
  playerPath,
  seasonPath,
  shouldShowUnmatched,
} from '@/lib/format';
import { notFoundMetadata, pageMetadata } from '@/lib/seo';
import { SEASON_MAX, SEASON_MIN } from '@/search/list-filters';
import { type FilterField, parseFilterValues } from '@/search/table-filters';

// Reading searchParams already makes this render per request; the route
// keeps its generateStaticParams so the award list still seeds the cache.
export const revalidate = 86400;

const RISING_STAR = 'rising-star';
const ALL_AUSTRALIAN = 'all-australian';

export async function generateStaticParams() {
  const awards = await listAwards();
  return awards.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const award = await getAward(slug);
  if (!award) return notFoundMetadata('Award');

  return pageMetadata({
    title: `${award.name} — Every Winner and Full History`,
    description:
      award.description
      ?? `Every ${award.name} winner, ${formatSpan(award.firstSeason, award.lastSeason)}.`,
    path: awardPath(award.slug),
  });
}

export default async function AwardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const award = await getAward(slug);
  if (!award) notFound();

  const isRisingStar = award.slug === RISING_STAR;
  const isTeam = award.category === 'honour_team';

  const [winners, leaders, nominationSeasons, nominationClubs] = await Promise.all([
    getAwardWinners(award.id),
    getAwardLeaders(award.id),
    isRisingStar ? getNominationSeasons(award.id) : Promise.resolve([]),
    isRisingStar ? getNominationsByClub(award.id) : Promise.resolve([]),
  ]);

  // A representative team has twenty-odd names a season; listing them all
  // on one page would bury the seasons. Seasons index them instead.
  const seasonsOfTeam = isTeam
    ? [...new Set(winners.map((w) => w.season).filter((s): s is number => s !== null))]
      .sort((a, b) => b - a)
    : [];

  const unlinked = winners.filter((w) => !isLinked(w.linkStatus)).length;

  // An award's winner list is one row a season, so it is filtered here
  // rather than in SQL: the rows are already loaded for the summary
  // counts above and a second query would read the same handful again.
  const winnerFields: FilterField[] = [
    { kind: 'text', key: 'q', label: 'Player', placeholder: 'Search by name' },
    {
      kind: 'select', key: 'club', label: 'Club', anyLabel: 'Any club',
      options: [...new Map(
        winners
          .filter((w) => w.clubSlug && w.clubName)
          .map((w) => [w.clubSlug!, { value: w.clubSlug!, label: w.clubName! }]),
      ).values()].sort((a, b) => a.label.localeCompare(b.label)),
    },
    {
      kind: 'range', key: 'season', label: 'Season',
      min: award.firstSeason ?? SEASON_MIN, max: award.lastSeason ?? SEASON_MAX,
    },
  ];
  const winnerValues = parseFilterValues(winnerFields, query);
  const nameTerm = winnerValues.text.q?.toLowerCase();
  const clubSlug = winnerValues.select.club;
  const seasonRange = winnerValues.range.season;
  const filteredWinners = winners.filter((w) => {
    if (nameTerm && !w.playerName.toLowerCase().includes(nameTerm)) return false;
    if (clubSlug && w.clubSlug !== clubSlug) return false;
    // A winner with no recorded season is outside any season range, the
    // same way a NULL fails both halves of a SQL BETWEEN. Substituting a
    // sentinel would drop those rows from a minimum and keep them under a
    // maximum, which is the one thing a range filter must not do.
    if (seasonRange && w.season === null) return false;
    if (seasonRange?.min !== undefined && w.season! < seasonRange.min) return false;
    if (seasonRange?.max !== undefined && w.season! > seasonRange.max) return false;
    return true;
  });
  const showVotes = winners.some((w) => w.votes !== null);

  const sections: { id: string; label: string; node: React.ReactNode }[] = [];

  if (isRisingStar) {
    sections.push({
      id: 'nominations-by-season',
      label: 'Nominations by season',
      node: (
        <section className="section">
          <p className="section-note">
            One player is nominated each round. Every nomination since 1993 is recorded,
            with the match statistics that earned it.
          </p>
          <CollapsibleTable title="Nominations by season">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Season</th>
                  <th scope="col" className="num">Nominations</th>
                  <th scope="col">Winner</th>
                </tr>
              </thead>
              <tbody>
                {nominationSeasons.map((s) => (
                  <tr key={s.season}>
                    <td>
                      <Link href={awardSeasonPath(award.slug, s.season)}>{s.season}</Link>
                    </td>
                    <td className="num">{s.nominations}</td>
                    <td className="wide">{s.winner ?? <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </CollapsibleTable>
        </section>
      ),
    });
  }

  if (isTeam) {
    sections.push({
      id: 'teams-by-season',
      label: 'Teams by season',
      node: (
        <section className="section">
          <CollapsibleTable title="Teams by season">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Season</th>
                  <th scope="col" className="num">Selected</th>
                  <th scope="col">Captain</th>
                </tr>
              </thead>
              <tbody>
                {seasonsOfTeam.map((season) => {
                  const members = winners.filter((w) => w.season === season);
                  const captain = members.find((m) => m.isCaptain);
                  return (
                    <tr key={season}>
                      <td>
                        <Link href={awardSeasonPath(award.slug, season)}>{season}</Link>
                      </td>
                      <td className="num">{members.length}</td>
                      <td className="wide">
                        {captain
                          ? captain.playerId && isLinked(captain.linkStatus)
                            ? (
                              <Link href={playerPath(captain.playerSlug!, captain.playerId)}>
                                {captain.playerName}
                              </Link>
                            )
                            : captain.playerName
                          : <span className="muted">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </CollapsibleTable>
        </section>
      ),
    });
  }

  if (leaders.length > 0) {
    // The span AFLDB actually holds, from the winner rows themselves —
    // a state-league award loaded from 1980 must not imply its 1920s
    // winners were counted.
    const winnerSeasons = winners
      .map((w) => w.season)
      .filter((s): s is number => s !== null);
    const coverage = winnerSeasons.length > 0
      ? `${Math.min(...winnerSeasons)}–${Math.max(...winnerSeasons)}`
      : null;

    sections.push({
      id: 'multiple-winners',
      label: 'Multiple winners',
      node: (
        <section className="section">
          {coverage && (
            <p className="section-note">
              Counted across the seasons AFLDB holds for this award ({coverage}).
            </p>
          )}
          <CollapsibleTable title="Multiple winners">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col" className="num">Wins</th>
                  <th scope="col">Seasons</th>
                </tr>
              </thead>
              <tbody>
                {leaders.map((l) => (
                  <tr key={l.playerId ?? l.displayName}>
                    <td className="wide">
                      {l.playerId !== null && l.slug !== null ? (
                        <Link href={playerPath(l.slug, l.playerId)}>{l.displayName}</Link>
                      ) : (
                        <span title="Not linked to an AFLDB player">{l.displayName}</span>
                      )}
                    </td>
                    <td className="num">{l.wins}</td>
                    <td className="wide muted">{l.seasons}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </CollapsibleTable>
        </section>
      ),
    });
  }

  if (isRisingStar && nominationClubs.length > 0) {
    sections.push({
      id: 'nominations-by-club',
      label: 'Nominations by club',
      node: (
        <section className="section">
          <p className="section-note">
            Counted by club as a continuing entity, so Footscray and Western Bulldogs
            nominations are one club’s.
          </p>
          <CollapsibleTable title="Nominations by club">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Club</th>
                  <th scope="col" className="num">Nominations</th>
                  <th scope="col" className="num">Winners</th>
                </tr>
              </thead>
              <tbody>
                {nominationClubs.map((c) => (
                  <tr key={c.clubId}>
                    <td className="wide"><Link href={clubPath(c.slug)}>{c.name}</Link></td>
                    <td className="num">{c.nominations}</td>
                    <td className="num">{c.winners}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </CollapsibleTable>
        </section>
      ),
    });
  }

  if (!isTeam) {
    sections.push({
      id: 'every-winner',
      label: 'Every winner',
      node: (
        <section className="section">
          <CollapsibleTable
            id="winners"
            title="Every winner"
            note={
              filteredWinners.length === winners.length
                ? `${winners.length} winners`
                : `${filteredWinners.length} of ${winners.length} winners`
            }
            filters={
              <TableFilters
                action={awardPath(award.slug)}
                anchor="winners"
                fields={winnerFields}
                values={winnerValues}
                title="Filter winners"
                submitLabel="Apply"
              />
            }
          >
          <FilterErrors errors={winnerValues.errors} />
          {filteredWinners.length === 0 ? (
            <div className="empty">
              <h2>No winners match those filters</h2>
              <p>Try clearing the club or widening the season range.</p>
            </div>
          ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Season</th>
                  <th scope="col">Player</th>
                  <th scope="col">Club</th>
                  {showVotes && (
                    <th scope="col" className="num">Votes</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredWinners.map((w) => (
                  <tr key={w.id}>
                    <td>
                      {w.season
                        ? <Link href={seasonPath(w.season)}>{w.season}</Link>
                        : <span className="muted">—</span>}
                    </td>
                    <td className="wide">
                      {w.playerId && isLinked(w.linkStatus) ? (
                        <Link href={playerPath(w.playerSlug!, w.playerId)}>
                          {w.playerName}
                        </Link>
                      ) : (
                        <span title="Not linked to an AFLDB player">{w.playerName}</span>
                      )}
                      {shouldShowUnmatched({
                        linkStatus: w.linkStatus,
                        clubName: w.clubNameRaw ?? w.clubName,
                        clubId: w.clubId,
                      }) && <UnmatchedPlayer targetTable="award_winners" targetId={w.id} />}
                    </td>
                    <td>
                      {w.clubSlug
                        ? <Link href={clubPath(w.clubSlug)}>{w.clubName}</Link>
                        : <span className="muted">{w.clubNameRaw ?? '—'}</span>}
                    </td>
                    {showVotes && (
                      <td className="num">{w.votes ?? <span className="muted">—</span>}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
          </CollapsibleTable>
        </section>
      ),
    });
  }

  return (
    <>
      <Breadcrumbs items={[
        { label: 'Awards', href: '/awards' },
        { label: award.name },
      ]} />

      <div className="page-header">
        <h1>{award.name}</h1>
        <p className="subtitle">
          {award.clubSlug && (
            <>
              <Link href={clubPath(award.clubSlug)}>{award.clubName}</Link>
              {' · '}
            </>
          )}
          {award.competition ? `${award.competition} · ` : ''}
          {formatSpan(award.firstSeason, award.lastSeason)}
        </p>
      </div>

      {award.description && <p className="notice">{award.description}</p>}

      <div className="stat-strip">
        <div className="stat">
          <div className="value">{formatNumber(award.seasonCount)}</div>
          <div className="label">Seasons</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(award.winnerCount)}</div>
          <div className="label">{isTeam ? 'Selections' : 'Winners'}</div>
        </div>
        {isRisingStar && (
          <div className="stat">
            <div className="value">
              {formatNumber(nominationSeasons.reduce((n, s) => n + s.nominations, 0))}
            </div>
            <div className="label">Nominations</div>
          </div>
        )}
        {unlinked > 0 && (
          <div className="stat">
            <div className="value">{formatNumber(unlinked)}</div>
            <div className="label">Unlinked names</div>
          </div>
        )}
      </div>

      {unlinked > 0 && (
        <p className="notice">
          {formatNumber(unlinked)} of these {formatNumber(award.winnerCount)} entries name
          a player AFLDB could not identify with confidence — most often a state-league
          footballer with no VFL/AFL record. They are listed as the source spelled them,
          without a link.
        </p>
      )}

      <ReorderableSections storageKey={`/awards/${award.slug}`} sections={sections} />
    </>
  );
}
