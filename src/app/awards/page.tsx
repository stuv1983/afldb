import type { Metadata } from 'next';
import Link from 'next/link';

import {
  listAwards,
  listHonourTeams,
  getAwardLeaders,
  getAwardWinners,
  type AwardWinnerRow,
} from '@/db/queries/awards';
import { SortableTable } from '@/components/SortableTable';
import { awardPath, formatNumber, formatSpan, honourTeamPath, playerPath } from '@/lib/format';
import { pageMetadata } from '@/lib/seo';
import { honourTeamSlug } from '@/lib/slugs';

export const revalidate = 86400;

export const metadata: Metadata = pageMetadata({
  title: 'AFL & VFL Awards and Honours — Every Winner',
  description:
    'AFL/VFL awards and honours: the All-Australian team, the Rising Star, the Coleman '
    + 'and Norm Smith Medals, every club best-and-fairest, the Hall of Fame and the '
    + 'teams of the century.',
  path: '/awards',
});

const CATEGORY_HEADINGS: Record<string, { title: string; note: string }> = {
  honour_team: {
    title: 'Representative teams',
    note: 'Selected sides rather than a single winner.',
  },
  award: {
    title: 'Competition awards',
    note:
      'League and interstate awards. Coverage begins in 1976–1980 for most of these, '
      + 'which is where the source record starts, not where the award began.',
  },
  club_best_and_fairest: {
    title: 'Club best-and-fairest',
    note:
      'Each club’s own award. A winner is listed against the club as it was named that '
      + 'season, so the 1980 Charles Sutton Medal reads Footscray.',
  },
  draft_pick: {
    title: 'Draft',
    note: 'National draft selections held as an award series.',
  },
};

const CATEGORY_ORDER = ['honour_team', 'award', 'club_best_and_fairest', 'draft_pick'];

type AwardLeaderRow = {
  playerId: number | null;
  slug: string | null;
  displayName: string;
  wins: number;
  seasons: string;
};

export default async function AwardsPage() {
  const [awards, honourTeams] = await Promise.all([listAwards(), listHonourTeams()]);

  const under22Award = awards.find(a => a.slug === '22-under-22-team');
  let under22Leaders: AwardLeaderRow[] = [];
  let under22Winners: AwardWinnerRow[] = [];
  if (under22Award) {
    const [leaders, winners] = await Promise.all([
      getAwardLeaders(under22Award.id),
      getAwardWinners(under22Award.id)
    ]);
    under22Leaders = leaders;
    under22Winners = winners;
  }

  const byCategory = new Map<string, typeof awards>();
  for (const award of awards) {
    const list = byCategory.get(award.category) ?? [];
    list.push(award);
    byCategory.set(award.category, list);
  }

  const totalWinners = awards.reduce((sum, a) => sum + a.winnerCount, 0);

  return (
    <>
      <div className="page-header">
        <h1>Awards and Honours</h1>
        <p className="subtitle">
          {awards.length} awards and {formatNumber(totalWinners)} recorded honours.
        </p>
      </div>

      <p className="notice">
        Where a source named a player AFLDB cannot identify with confidence, the name is
        shown as the source spelled it and is not linked. That is common in the earlier
        representative teams and the Hall of Fame, which include players from the state
        leagues who never played VFL/AFL.
      </p>

      {CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((category) => {
        const heading = CATEGORY_HEADINGS[category];
        const list = byCategory.get(category)!;
        if (category === 'honour_team') {
          list.sort((a, b) => {
            if (a.name === 'All-Australian Team' && b.name === '22 Under 22 Team') return -1;
            if (a.name === '22 Under 22 Team' && b.name === 'All-Australian Team') return 1;
            return 0;
          });
        }
        return (
          <section className="section" key={category}>
            <h2>{heading?.title ?? category}</h2>
            {heading?.note && <p className="section-note">{heading.note}</p>}
            <div className="grid grid-wide">
              {list.map((award) => (
                <Link key={award.id} href={awardPath(award.slug)} className="card">
                  <h3>{award.name}</h3>
                  <div className="meta">
                    {award.clubSlug ? `${award.clubName} · ` : ''}
                    {award.competition ? `${award.competition} · ` : ''}
                    {formatSpan(award.firstSeason, award.lastSeason)}
                    {' · '}
                    {formatNumber(award.winnerCount)}{' '}
                    {category === 'honour_team' ? 'selections' : 'winners'}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}

      <section className="section">
        <h2>Hall of Fame</h2>
        <p className="section-note">
          The Australian Football Hall of Fame, including its Legends.
        </p>
        <div className="grid">
          <Link href="/hall-of-fame" className="card">
            <h3>Australian Football Hall of Fame</h3>
            <div className="meta">Inductees and Legends, 1996 onwards</div>
          </Link>
        </div>
      </section>

      {honourTeams.length > 0 && (
        <section className="section">
          <h2>Teams of the century</h2>
          <p className="section-note">
            Retrospective sides. Several were selected across leagues, so not every member
            has a VFL/AFL record.
          </p>
          <div className="grid grid-wide">
            {honourTeams.map((team) => (
              <Link
                key={team.teamName}
                href={honourTeamPath(honourTeamSlug(team.teamName))}
                className="card"
              >
                <h3>{team.teamName}</h3>
                <div className="meta">
                  {team.members} selected · {team.linked} with an AFLDB record
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {under22Award && under22Winners.length > 0 && (
        <section className="section">
          <h2>22 Under 22 Selections</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2rem' }}>
            <div>
              <h3>Most Selections</h3>
              <div className="table-wrap">
                <SortableTable
                  defaultSort="selections"
                  defaultDir="desc"
                  columns={[
                    { key: 'player', label: 'Player', sortType: 'text' },
                    { key: 'selections', label: 'Selections', sortType: 'number' },
                    { key: 'seasons', label: 'Seasons', sortType: 'text' },
                  ]}
                  items={under22Leaders.slice(0, 20).map((l, i) => ({
                    id: String(i),
                    values: {
                      player: l.displayName,
                      selections: l.wins,
                      seasons: l.seasons,
                    },
                    element: (
                      <tr key={i}>
                        <td className="wide">{l.slug && l.playerId ? <Link href={playerPath(l.slug, l.playerId)}>{l.displayName}</Link> : l.displayName}</td>
                        <td className="nowrap">{l.wins}</td>
                        <td className="wide muted">{l.seasons}</td>
                      </tr>
                    ),
                  }))}
                />
              </div>
            </div>
            <div>
              <h3>All Selections (Latest First)</h3>
              <div className="table-wrap" style={{ maxHeight: '500px', overflowY: 'auto' }}>
                <SortableTable
                  defaultSort="season"
                  defaultDir="desc"
                  columns={[
                    { key: 'season', label: 'Season', sortType: 'number' },
                    { key: 'player', label: 'Player', sortType: 'text' },
                    { key: 'position', label: 'Position', sortType: 'text' },
                  ]}
                  items={under22Winners.map((w, i) => ({
                    id: String(i),
                    values: {
                      season: w.season,
                      player: w.playerName,
                      position: w.position,
                    },
                    element: (
                      <tr key={i}>
                        <td className="nowrap">{w.season}</td>
                        <td className="wide">
                          {w.playerSlug && w.playerId ? <Link href={playerPath(w.playerSlug, w.playerId)}>{w.playerName}</Link> : w.playerName}
                          {w.isCaptain && ' (c)'}
                          {w.isViceCaptain && ' (vc)'}
                        </td>
                        <td className="nowrap">{w.position}</td>
                      </tr>
                    ),
                  }))}
                />
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="section">
        <h2>Elsewhere in AFLDB</h2>
        <div className="grid">
          <Link href="/brownlow" className="card">
            <h3>Brownlow Medal</h3>
            <div className="meta">Full vote history from 1924, held separately</div>
          </Link>
          <Link href="/clubs" className="card">
            <h3>Clubs</h3>
            <div className="meta">Best-and-fairest and captains sit on each club page</div>
          </Link>
        </div>
      </section>
    </>
  );
}
