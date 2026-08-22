import type { Metadata } from 'next';
import Link from 'next/link';

import { Breadcrumbs } from '@/components/Breadcrumbs';
import { CollapsibleTable } from '@/components/CollapsibleTable';
import { FilterErrors } from '@/components/FilterErrors';
import { ReorderableSections } from '@/components/ReorderableSections';
import { SortableTable } from '@/components/SortableTable';
import { TableFilters } from '@/components/TableFilters';
import { UnmatchedPlayer } from '@/components/UnmatchedPlayer';
import { getHallOfFameCategories, listHallOfFame } from '@/db/queries/awards';
import {
  aflwPlayerPath,
  formatHallOfFameClub,
  formatNumber,
  isLinked,
  isNonPlayerHallOfFameCategory,
  playerPath,
  shouldShowUnmatched,
} from '@/lib/format';
import { pageMetadata } from '@/lib/seo';
import { hallOfFameFilterFields } from '@/search/list-filters';
import { describeFilters, parseFilterValues } from '@/search/table-filters';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = pageMetadata({
  title: 'Australian Football Hall of Fame — Every Inductee and Legend',
  description:
    'Every inductee of the Australian Football Hall of Fame, including its Legends — '
    + 'players, coaches, umpires, administrators and media figures.',
  path: '/hall-of-fame',
});

const CATEGORY_LABELS: Record<string, string> = {
  player: 'Player',
  coach: 'Coach',
  umpire: 'Umpire',
  administrator: 'Administrator',
  media: 'Media',
  pioneer: 'Pioneer',
  legend: 'Legend',
  removed: 'Removed',
};

export default async function HallOfFamePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const categories = await getHallOfFameCategories();
  const fields = hallOfFameFilterFields(
    categories.map((value) => ({ value, label: CATEGORY_LABELS[value] ?? value })),
  );
  const values = parseFilterValues(fields, params);

  const inductees = await listHallOfFame({
    q: values.text.q,
    category: values.select.category,
    ranges: values,
  });
  const described = describeFilters(fields, values);

  const legends = inductees.filter((i) => i.isLegend);
  const linked = inductees.filter(
    (i) => (i.playerId !== null && isLinked(i.linkStatus)) || i.aflwPlayerSlug !== null,
  );
  const byYear = [...inductees].sort((a, b) => {
    const ay = a.inductedYear ?? 9999;
    const by = b.inductedYear ?? 9999;
    if (ay !== by) return by - ay;
    return a.name.localeCompare(b.name);
  });

  const sections: { id: string; label: string; node: React.ReactNode }[] = [];

  sections.push({
    id: 'legends',
    label: 'Legends',
    node: (
      <section className="section">
        <p className="section-note">
          Elevated to Legend status, the Hall of Fame’s highest honour.
        </p>
        <CollapsibleTable title="Legends">
        <div className="table-wrap">
          <SortableTable
            defaultSort="elevated"
            defaultDir="asc"
            columns={[
              { key: 'name', label: 'Name', sortType: 'text' },
              { key: 'elevated', label: 'Elevated', sortType: 'number', className: 'num' },
              { key: 'club', label: 'Club', sortType: 'text' },
              { key: 'career', label: 'Career', sortType: 'text' },
            ]}
            items={legends
              .sort((a, b) => (a.legendYear ?? 0) - (b.legendYear ?? 0))
              .map((i) => ({
                id: String(i.id),
                values: {
                  name: i.name,
                  elevated: i.legendYear ?? i.inductedYear ?? 9999,
                  club: i.clubNameRaw ?? '',
                  career: i.playingCareer ?? '',
                },
                element: (
                  <tr key={i.id}>
                    <td className="wide">
                      {i.playerId && isLinked(i.linkStatus) ? (
                        <Link href={playerPath(i.playerSlug!, i.playerId)}>{i.name}</Link>
                      ) : i.aflwPlayerSlug ? (
                        <Link href={aflwPlayerPath(i.aflwPlayerSlug)}>{i.name}</Link>
                      ) : (
                        i.name
                      )}
                    </td>
                    <td className="num">{i.legendYear ?? i.inductedYear ?? '—'}</td>
                    <td>
                      {formatHallOfFameClub(i.clubNameRaw, i.category, i.aflwPlayerSlug) ?? (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="nowrap muted">{i.playingCareer ?? '—'}</td>
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
    id: 'all-inductees',
    label: 'All inductees',
    node: (
      <section className="section">
        <CollapsibleTable title="All inductees">
        <div className="table-wrap">
          <SortableTable
            defaultSort="inducted"
            defaultDir="asc"
            columns={[
              { key: 'inducted', label: 'Inducted', sortType: 'number', className: 'num' },
              { key: 'name', label: 'Name', sortType: 'text' },
              { key: 'category', label: 'Category', sortType: 'text' },
              { key: 'club', label: 'Club', sortType: 'text' },
              { key: 'career', label: 'Career', sortType: 'text' },
            ]}
            items={byYear.map((i) => {
              const nonPlayer = isNonPlayerHallOfFameCategory(i.category);
              return {
                id: String(i.id),
                values: {
                  inducted: i.inductedYear ?? 9999,
                  name: i.name,
                  category: CATEGORY_LABELS[i.category ?? ''] ?? i.category ?? '',
                  club: i.clubNameRaw ?? '',
                  career: i.playingCareer ?? '',
                },
                element: (
                  <tr key={i.id}>
                    <td className="num">{i.inductedYear ?? '—'}</td>
                    <td className="wide">
                      {i.playerId && isLinked(i.linkStatus) ? (
                        <Link href={playerPath(i.playerSlug!, i.playerId)}>{i.name}</Link>
                      ) : i.aflwPlayerSlug ? (
                        <Link href={aflwPlayerPath(i.aflwPlayerSlug)}>{i.name}</Link>
                      ) : (
                        <span title={nonPlayer ? undefined : 'No VFL/AFL playing record in AFLDB'}>
                          {i.name}
                        </span>
                      )}
                      {shouldShowUnmatched({
                        linkStatus: i.linkStatus,
                        clubName: i.clubNameRaw,
                        category: i.category,
                        aflwPlayerSlug: i.aflwPlayerSlug,
                      }) && <UnmatchedPlayer targetTable="hall_of_fame" targetId={i.id} />}
                      {i.isLegend && <strong> · Legend</strong>}
                      {i.removedYear && (
                        <span className="badge badge-warn" title={`Removed in ${i.removedYear}`}>
                          Removed
                        </span>
                      )}
                    </td>
                    <td>{CATEGORY_LABELS[i.category ?? ''] ?? i.category ?? '—'}</td>
                    <td>
                      {formatHallOfFameClub(i.clubNameRaw, i.category, i.aflwPlayerSlug) ?? (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="nowrap muted">{i.playingCareer ?? '—'}</td>
                  </tr>
                ),
              };
            })}
          />
        </div>
        </CollapsibleTable>
      </section>
    ),
  });

  return (
    <>
      <Breadcrumbs items={[
        { label: 'Awards', href: '/awards' },
        { label: 'Hall of Fame' },
      ]} />

      <div className="page-header">
        <h1>Australian Football Hall of Fame</h1>
        <p className="subtitle">
          {formatNumber(inductees.length)} inductees, of whom {legends.length} are Legends.
          {described.length > 0 ? ` · ${described.join(' · ')}` : ''}
        </p>
      </div>

      <p className="notice">
        The Hall of Fame honours the whole game, not only the national competition.{' '}
        {formatNumber(inductees.length - linked.length)} inductees are coaches,
        umpires, administrators, media figures or state-league players with no VFL/AFL
        playing record, so they have no AFLDB player page. They are listed here in full
        rather than filtered out.
      </p>

      <FilterErrors errors={values.errors} />

      {/* Both tables below are views of the same filtered list, so the
          panel governs the page rather than sitting inside one of them. */}
      <TableFilters action="/hall-of-fame" fields={fields} values={values} />

      <div className="stat-strip">
        <div className="stat">
          <div className="value">{formatNumber(inductees.length)}</div>
          <div className="label">Inductees</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(legends.length)}</div>
          <div className="label">Legends</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(linked.length)}</div>
          <div className="label">With an AFLDB record</div>
        </div>
      </div>

      <ReorderableSections storageKey="/hall-of-fame" sections={sections} />
    </>
  );
}
