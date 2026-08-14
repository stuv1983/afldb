import type { Metadata } from 'next';
import Link from 'next/link';

import { listAwards, listHonourTeams } from '@/db/queries/awards';
import { awardPath, formatNumber, formatSpan, honourTeamPath } from '@/lib/format';
import { honourTeamSlug } from '@/lib/slugs';

export const revalidate = 86400;

export const metadata: Metadata = {
  title: 'Awards and Honours',
  description:
    'AFL/VFL awards and honours: the All-Australian team, the Rising Star, the Coleman '
    + 'and Norm Smith Medals, every club best-and-fairest, the Hall of Fame and the '
    + 'teams of the century.',
  alternates: { canonical: '/awards' },
};

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

export default async function AwardsPage() {
  const [awards, honourTeams] = await Promise.all([listAwards(), listHonourTeams()]);

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
        return (
          <section className="section" key={category}>
            <h2>{heading?.title ?? category}</h2>
            {heading?.note && <p className="section-note">{heading.note}</p>}
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
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
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
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
