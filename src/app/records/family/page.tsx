import type { Metadata } from 'next';
import Link from 'next/link';

import { Breadcrumbs } from '@/components/Breadcrumbs';
import { CollapsibleTable } from '@/components/CollapsibleTable';
import { SortableTable } from '@/components/SortableTable';
import { getFamilyRecords, getFamilyRecordsSummary } from '@/db/queries/family-records';
import { formatNumber, playerPath } from '@/lib/format';
import { pageMetadata } from '@/lib/seo';

export const revalidate = 86400;

const TITLE = 'Most Games by Family';
const DEFINITION =
  'Combined career VFL/AFL games by a linked family of siblings, from AFLDB’s recorded '
  + 'football families.';

export const metadata: Metadata = pageMetadata({
  title: `${TITLE} — Sibling Family Leaderboard`,
  description: DEFINITION,
  path: '/records/family',
});

export default async function FamilyRecordsPage() {
  const [rows, summary] = await Promise.all([
    getFamilyRecords(50),
    getFamilyRecordsSummary(),
  ]);

  return (
    <>
      <Breadcrumbs items={[{ label: 'Records', href: '/records' }, { label: TITLE }]} />

      <div className="page-header">
        <h1>{TITLE}</h1>
        <p className="subtitle">{DEFINITION}</p>
      </div>

      <div className="stat-strip">
        <div className="stat">
          <div className="value">{formatNumber(summary.families)}</div>
          <div className="label">Linked families</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(summary.linkedPlayers)}</div>
          <div className="label">Linked players</div>
        </div>
      </div>

      <section className="section">
        <CollapsibleTable id="families" title="Family leaderboard" note={`${rows.length} shown`} defaultOpen>
          <div className="table-wrap">
            <SortableTable
              defaultSort="rank"
              defaultDir="asc"
              columns={[
                { key: 'rank', label: '#', sortType: 'number', className: 'num' },
                { key: 'family', label: 'Family', sortType: 'text' },
                { key: 'members', label: 'Linked members', sortType: 'number', className: 'num' },
                { key: 'games', label: 'Combined games', sortType: 'number', className: 'num' },
              ]}
              items={rows.map((r) => ({
                id: r.familyKey,
                values: {
                  rank: r.rank,
                  family: r.familyName,
                  members: r.linkedMembers,
                  games: r.combinedGames,
                },
                element: (
                  <tr key={r.familyKey}>
                    <td className="num">{r.rank}</td>
                    <td className="wide">
                      {r.familyName}
                      <div className="meta">
                        {r.members.map((m, i) => (
                          <span key={m.playerId}>
                            {i > 0 && ', '}
                            <Link href={playerPath(m.slug, m.playerId)}>{m.name}</Link>
                            {' '}
                            ({formatNumber(m.games)})
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="num">{formatNumber(r.linkedMembers)}</td>
                    <td className="num">{formatNumber(r.combinedGames)}</td>
                  </tr>
                ),
              }))}
            />
          </div>
        </CollapsibleTable>
      </section>

      <section className="section">
        <h2>About this record</h2>
        <p>
          A family is a set of players AFLDB has linked as siblings, and only sibling
          relationships are counted &mdash; a father&ndash;son selection never adds a member or
          a game to a family here. Each player&rsquo;s career games are counted once toward the
          family total, even if they appear in more than one recorded sibling relationship.
          Only players AFLDB has matched to a canonical profile appear here &mdash; an
          unmatched relative is not fabricated a link.
        </p>
        <p className="muted">
          Looking for a father&ndash;son selection instead of siblings? See{' '}
          <Link href="/records/father-son">Father&ndash;Son Records</Link>.
        </p>
      </section>
    </>
  );
}
