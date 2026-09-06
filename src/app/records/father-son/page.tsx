import type { Metadata } from 'next';
import Link from 'next/link';

import { Breadcrumbs } from '@/components/Breadcrumbs';
import { CollapsibleTable } from '@/components/CollapsibleTable';
import { SortableTable } from '@/components/SortableTable';
import { getFatherSonRecords, getFatherSonSummary } from '@/db/queries/family-records';
import { formatNumber, playerPath } from '@/lib/format';
import { pageMetadata } from '@/lib/seo';

export const revalidate = 86400;

const TITLE = 'Father–Son Records';
const DEFINITION =
  'Father and son pairs recorded under the AFL/VFL father-son rule, ranked by combined '
  + 'career VFL/AFL games.';

export const metadata: Metadata = pageMetadata({
  title: `${TITLE} — Every Recorded Father and Son`,
  description: DEFINITION,
  path: '/records/father-son',
});

function nameCell(playerId: number | null, slug: string | null, name: string) {
  return playerId !== null && slug
    ? <Link href={playerPath(slug, playerId)}>{name}</Link>
    : name;
}

export default async function FatherSonRecordsPage() {
  const [rows, summary] = await Promise.all([
    getFatherSonRecords(200),
    getFatherSonSummary(),
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
          <div className="value">{formatNumber(summary.total)}</div>
          <div className="label">Recorded pairs</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(summary.bothLinked)}</div>
          <div className="label">Both linked</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(summary.oneUnlinked)}</div>
          <div className="label">At least one unlinked</div>
        </div>
      </div>

      <section className="section">
        <CollapsibleTable id="father-son" title="Father–son pairs" note={`${rows.length} shown`} defaultOpen>
          <div className="table-wrap">
            <SortableTable
              defaultSort="combined"
              defaultDir="desc"
              columns={[
                { key: 'father', label: 'Father', sortType: 'text' },
                { key: 'fatherGames', label: 'Father games', sortType: 'number', className: 'num' },
                { key: 'son', label: 'Son', sortType: 'text' },
                { key: 'sonGames', label: 'Son games', sortType: 'number', className: 'num' },
                { key: 'combined', label: 'Combined games', sortType: 'number', className: 'num' },
              ]}
              items={rows.map((r) => ({
                id: String(r.id),
                values: {
                  father: r.fatherName,
                  fatherGames: r.fatherGames ?? -1,
                  son: r.sonName,
                  sonGames: r.sonGames ?? -1,
                  combined: r.combinedGames ?? -1,
                },
                element: (
                  <tr key={r.id}>
                    <td className="wide">{nameCell(r.fatherPlayerId, r.fatherSlug, r.fatherName)}</td>
                    <td className="num">{r.fatherGames !== null ? formatNumber(r.fatherGames) : '—'}</td>
                    <td className="wide">{nameCell(r.sonPlayerId, r.sonSlug, r.sonName)}</td>
                    <td className="num">{r.sonGames !== null ? formatNumber(r.sonGames) : '—'}</td>
                    <td className="num">{r.combinedGames !== null ? formatNumber(r.combinedGames) : '—'}</td>
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
          These are AFL/VFL father-son rule relationships (relationship type{' '}
          <code>parent_child</code>), a separate record from AFLDB&rsquo;s sibling family boards
          and never merged into them. A name without a link is displayed as recorded, not
          fabricated a player.
        </p>
        <p className="muted">
          Looking for siblings instead of a father and son? See{' '}
          <Link href="/records/family">Family Records</Link>.
        </p>
      </section>
    </>
  );
}
