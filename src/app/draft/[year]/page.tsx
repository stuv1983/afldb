import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Breadcrumbs } from '@/components/Breadcrumbs';
import { CollapsibleTable } from '@/components/CollapsibleTable';
import { DraftCategoryNav } from '@/components/DraftCategoryNav';
import { FilterErrors } from '@/components/FilterErrors';
import { Pagination } from '@/components/Pagination';
import { RouteSortHeader } from '@/components/RouteSortHeader';
import { TableFilters } from '@/components/TableFilters';
import { UnmatchedPlayer } from '@/components/UnmatchedPlayer';
import { getClubOptions } from '@/db/queries/advanced-search';
import {
  getDraftCategoryCounts,
  getDraftYears,
  isDraftSort,
  listDraftPicks,
  type DraftPickRow,
} from '@/db/queries/draft';
import {
  DRAFT_CATEGORIES,
  FATHER_SON_LABEL,
  categoryEventLabel,
  draftCategoryForKind,
  draftViewParam,
  isFatherSon,
  parseDraftView,
  selectionLabel,
  type DraftView,
} from '@/lib/draft-categories';
import { clubPath, formatNumber, isLinked, playerPath } from '@/lib/format';
import { firstValue, parsePage } from '@/lib/params';
import { pageMetadata } from '@/lib/seo';
import { DEFAULT_PAGE_SIZE } from '@/search/constants';
import { resolveDraftKind } from '@/search/grid-solver-spec';
import { clubOptions, draftFilterFields } from '@/search/list-filters';
import {
  describeFilters,
  filterQueryParams,
  parseFilterValues,
} from '@/search/table-filters';

export const dynamic = 'force-dynamic';

function parseYear(year: string): number | null {
  return /^\d{4}$/.test(year) ? Number(year) : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ year: string }>;
}): Promise<Metadata> {
  const { year } = await params;
  return pageMetadata({
    title: `${year} AFL Draft & Trade Period — National, Rookie and Trade Selections`,
    description: `Every ${year} AFL National Draft, Rookie Draft, Pre-Season and Mid-Season selection and trade, each numbered within its own draft.`,
    path: `/draft/${year}`,
  });
}

/**
 * The view a request names. `view` wins; a legacy `type=<source label>` link (the old
 * "Draft type" filter) opens the matching category instead of mixing it into All.
 */
function requestedView(sParams: Record<string, string | string[] | undefined>): DraftView {
  const view = parseDraftView(firstValue(sParams.view));
  if (view.type !== 'all' || firstValue(sParams.view)) return view;
  const legacy = firstValue(sParams.type);
  const category = legacy ? draftCategoryForKind(resolveDraftKind(legacy)) : null;
  return category ? { type: 'category', category } : view;
}

/** The Selection cell: the pick within its category, never a bare number in All. */
function selectionCell(pick: DraftPickRow, view: DraftView): string {
  if (view.type === 'category') {
    const parts = [pick.pickNumber !== null ? `Pick ${pick.pickNumber}` : 'Unnumbered'];
    if (isFatherSon(pick.signingKind)) parts.push(FATHER_SON_LABEL);
    return parts.join(' — ');
  }
  return selectionLabel(pick);
}

export default async function DraftYearPage({
  params,
  searchParams,
}: {
  params: Promise<{ year: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { year } = await params;
  const yearNumber = parseYear(year);
  if (yearNumber === null) notFound();
  const sParams = await searchParams;
  const page = parsePage(firstValue(sParams.page));
  const view = requestedView(sParams);
  const sort = firstValue(sParams.sort);
  const dir = firstValue(sParams.dir);

  const [years, clubs] = await Promise.all([getDraftYears(), getClubOptions()]);
  if (!years.includes(yearNumber)) notFound();

  const fields = draftFilterFields({ clubs: clubOptions(clubs) });
  const values = parseFilterValues(fields, sParams);
  const scope = {
    year: yearNumber,
    clubSlug: values.select.club,
    origin: values.text.origin,
    q: values.text.q,
    ranges: values,
  };

  const [{ rows, total }, categoryCounts] = await Promise.all([
    listDraftPicks({
      ...scope,
      kind: view.type === 'category' ? view.category.kind : undefined,
      fatherSon: view.type === 'father-son',
      sort,
      dir,
      page,
      pageSize: DEFAULT_PAGE_SIZE,
    }),
    getDraftCategoryCounts(scope),
  ]);

  const counts = new Map<string, number>();
  let fatherSonCount = 0;
  for (const c of categoryCounts) {
    const key = c.draftKind ?? '';
    counts.set(key, (counts.get(key) ?? 0) + c.total);
    fatherSonCount += c.fatherSon;
  }
  const allCount = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const categoriesPresent = DRAFT_CATEGORIES.filter((c) => (counts.get(c.kind) ?? 0) > 0).length;

  const filterParams = filterQueryParams(fields, values);
  const sortParams: Record<string, string> = isDraftSort(sort) && (dir === 'asc' || dir === 'desc') ? { sort, dir } : {};
  const viewParam = draftViewParam(view);
  const listParams = { ...filterParams, ...sortParams, ...(viewParam ? { view: viewParam } : {}) };
  const described = describeFilters(fields, values);
  const basePath = `/draft/${year}`;

  const sorted = years.slice().sort((a, b) => a - b);
  const index = sorted.indexOf(yearNumber);
  const prev = index > 0 ? sorted[index - 1] : null;
  const next = index < sorted.length - 1 ? sorted[index + 1] : null;

  const viewTitle = view.type === 'category'
    ? view.category.label
    : view.type === 'father-son' ? `${FATHER_SON_LABEL} selections` : 'All selections and acquisitions';
  // Group headings only while rows arrive in category order.
  const grouped = view.type === 'all' && (!isDraftSort(sort) || sort === 'type' || sort === 'pick');

  const filters = (
    <TableFilters
      action={basePath}
      anchor="draft-picks"
      fields={fields}
      values={values}
      hidden={{ ...sortParams, ...(viewParam ? { view: viewParam } : {}) }}
    />
  );

  return (
    <>
      <Breadcrumbs items={[
        { label: 'Draft', href: '/draft' },
        { label: year },
      ]} />

      <div className="page-header">
        <h1>{year} AFL Draft &amp; Trade Period</h1>
        <p className="subtitle">
          {formatNumber(allCount)} selections and acquisitions in {categoriesPresent}{' '}
          {categoriesPresent === 1 ? 'category' : 'categories'}. Pick numbers count within their own draft.
          {described.length > 0 ? ` · ${described.join(' · ')}` : ''}
        </p>
      </div>

      <nav className="draft-year-nav" aria-label="Draft years">
        {prev ? (
          <Link className="btn btn-secondary" href={`/draft/${prev}`} rel="prev">← {prev}</Link>
        ) : (
          <span className="btn btn-secondary" aria-disabled="true">Earliest year</span>
        )}
        <Link className="btn btn-secondary" href="/draft">All years</Link>
        {next ? (
          <Link className="btn btn-secondary" href={`/draft/${next}`} rel="next">{next} →</Link>
        ) : (
          <span className="btn btn-secondary" aria-disabled="true">Latest year</span>
        )}
      </nav>

      <DraftCategoryNav
        basePath={basePath}
        params={{ ...filterParams, ...sortParams }}
        view={view}
        counts={counts}
        fatherSonCount={fatherSonCount}
      />

      {view.type === 'father-son' && (
        <p className="muted draft-view-note">
          Father–Son is how a club acquired the player, not a draft of its own. Each selection
          below keeps its real category and pick, and is counted once, in that category.
        </p>
      )}

      <FilterErrors errors={values.errors} />

      <CollapsibleTable
        id="draft-picks"
        title={viewTitle}
        note={`${formatNumber(total)} matching`}
        filters={filters}
      >
        {rows.length === 0 ? (
          <div className="empty">
            <h2>
              No {view.type === 'all' ? 'selections' : `${view.type === 'category' ? view.category.label : FATHER_SON_LABEL} selections`}{' '}
              {described.length > 0 ? 'match those filters' : `recorded for ${year}`}
            </h2>
            <p>
              {described.length > 0 ? 'Try widening the club, name or range filters, or ' : 'Try '}
              {view.type === 'all' ? 'another year.' : <Link href={basePath}>all {year} selections</Link>}
              {view.type === 'all' ? null : '.'}
            </p>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="draft-table">
                <caption>
                  Each pick number belongs to its own draft: National pick 1 and Rookie pick 1
                  are different selections, and trades, free agency, pre-draft and post-draft
                  acquisitions carry no number. Career games count everything the player went
                  on to play; a selection never linked to a player has none to show.
                </caption>
                <thead>
                  <tr>
                    <RouteSortHeader sortKey="pick" defaultSort="type" defaultDir="asc" className="nowrap">Selection</RouteSortHeader>
                    <RouteSortHeader sortKey="player" defaultSort="type" defaultDir="asc" className="wide">Player</RouteSortHeader>
                    <th scope="col">Club</th>
                    <th scope="col" className="muted">Drafted from</th>
                    <th scope="col" className="muted">Signing</th>
                    <RouteSortHeader sortKey="age" defaultSort="type" defaultDir="asc" className="num">Age</RouteSortHeader>
                    <RouteSortHeader sortKey="games" defaultSort="type" defaultDir="asc" className="num">Games</RouteSortHeader>
                  </tr>
                </thead>
                <tbody>
                  {rows.flatMap((pick, i) => {
                    const out = [];
                    if (grouped && (i === 0 || rows[i - 1].draftKind !== pick.draftKind)) {
                      out.push(
                        <tr key={`group-${pick.draftKind ?? pick.draftType}-${pick.id}`} className="draft-group">
                          <th scope="colgroup" colSpan={7}>
                            {categoryEventLabel(pick)}
                            <span className="count">{formatNumber(counts.get(pick.draftKind ?? '') ?? 0)}</span>
                          </th>
                        </tr>,
                      );
                    }
                    out.push(
                      <tr key={pick.id}>
                        <td className="nowrap draft-selection" data-category={pick.draftKind ?? undefined}>
                          {selectionCell(pick, view)}
                        </td>
                        <td className="wide">
                          {pick.playerId && isLinked(pick.linkStatus) ? (
                            <Link href={playerPath(pick.playerSlug!, pick.playerId)}>
                              {pick.playerDisplayName}
                            </Link>
                          ) : (
                            pick.playerNameRaw
                          )}
                          {!isLinked(pick.linkStatus) && (
                            <UnmatchedPlayer targetTable="draft_picks" targetId={pick.id} />
                          )}
                        </td>
                        <td>
                          {pick.clubSlug ? (
                            <Link href={clubPath(pick.clubSlug)}>{pick.clubName}</Link>
                          ) : (
                            pick.clubNameRaw ?? <span className="muted">—</span>
                          )}
                        </td>
                        <td className="muted">{pick.originClub ?? <span className="not-recorded">—</span>}</td>
                        <td className="muted">{pick.signing ?? <span className="not-recorded">—</span>}</td>
                        <td className="num">{pick.draftAge ?? '—'}</td>
                        <td className="num">
                          {pick.careerGames === null
                            ? <span className="not-recorded">—</span>
                            : formatNumber(pick.careerGames)}
                        </td>
                      </tr>,
                    );
                    return out;
                  })}
                </tbody>
              </table>
            </div>

            <Pagination
              basePath={basePath}
              params={listParams}
              page={page}
              pageSize={DEFAULT_PAGE_SIZE}
              total={total}
            />
          </>
        )}
      </CollapsibleTable>
    </>
  );
}
