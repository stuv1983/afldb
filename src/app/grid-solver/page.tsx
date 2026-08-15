import type { Metadata } from 'next';
import Link from 'next/link';

import { GridSolverForm } from '@/app/grid-solver/GridSolverForm';
import { CollapsiblePanel } from '@/components/CollapsiblePanel';
import { CollapsibleTable } from '@/components/CollapsibleTable';
import { Pagination } from '@/components/Pagination';
import { ReorderableSections } from '@/components/ReorderableSections';
import { getClubOrganizationOptions, getVenueOptions } from '@/db/queries/advanced-search';
import { getAwardOptions } from '@/db/queries/awards';
import { solveCellRows, solveCellSummary, type GridCellSummary } from '@/db/queries/grid-solver';
import { getPlayerNames } from '@/db/queries/players';
import { getSiteSettings } from '@/db/queries/site-settings';
import { requireAudience } from '@/lib/auth/audience';
import { formatNumber, formatSpan, playerPath } from '@/lib/format';
import { firstValue, parsePage } from '@/lib/params';
import {
  DEFAULT_BOARD_STATE,
  GRID_AA_POSITIONS,
  GRID_BUILDERS,
  GRID_LIMITS,
  GRID_STATS,
  isAxisComplete,
  parseBoardState,
  serializeBoardState,
  type GridAxisState,
  type GridBoardState,
} from '@/search/grid-solver-spec';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Grid solver',
  robots: { index: false, follow: false },
};

/**
 * A 3x3 board of named questions — the sibling of /admin/query-builder, with
 * a catalogue of questions in place of raw column/operator/value conditions.
 *
 * It lives on a public route rather than under /admin because who may reach
 * it is a runtime setting (see /admin/settings), and /admin is gated by
 * middleware that always demands an admin cookie. The gate is
 * `requireAudience`, which is no weaker than `requireAdmin()` at the default
 * setting — it re-checks the database session the same way — but can be
 * widened as far as "everyone" without moving the page again. It stays
 * `noindex` at every setting: shareable, not crawlable.
 */
export default async function GridSolverPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { gridAudience } = await getSiteSettings();
  await requireAudience(gridAudience);

  const params = await searchParams;
  const token = firstValue(params.g);
  const state: GridBoardState = (token && parseBoardState(token)) || DEFAULT_BOARD_STATE;

  const axisPlayerIds = [...state.rows, ...state.cols]
    .filter((a) => GRID_BUILDERS[a.builder]?.params.some((p) => p.kind === 'player'))
    .map((a) => Number(a.params.player))
    .filter((id) => Number.isSafeInteger(id) && id > 0);

  const [clubOptions, venueOptions, awardOptions, playerNames] = await Promise.all([
    getClubOrganizationOptions(),
    getVenueOptions(),
    getAwardOptions(),
    getPlayerNames(axisPlayerIds),
  ]);
  const clubNames = new Map(clubOptions.map((c) => [c.id, c.name]));
  const venueNames = new Map(venueOptions.map((v) => [v.id, v.name]));
  const awardNames = new Map(awardOptions.map((a) => [a.id, a.name]));

  // Solve every cell whose row and column are both fully specified --
  // an incomplete axis just says "define both axes", the same first-load
  // state the reference starts from.
  const cellResults = await Promise.all(
    state.rows.map((rowAxis) => Promise.all(
      state.cols.map((colAxis) => (
        isAxisComplete(rowAxis) && isAxisComplete(colAxis)
          ? solveCellSummary(rowAxis, colAxis, state.order)
          : Promise.resolve(null)
      )),
    )),
  );
  const cells: (GridCellSummary | null)[][] = cellResults;

  // The first cell with both axes defined opens automatically, so the
  // page never lands on an empty drill-down panel.
  const cellParam = firstValue(params.cell);
  const requested = cellParam ? /^([0-2])-([0-2])$/.exec(cellParam) : null;
  let openCell: [number, number] | null = null;
  if (requested) {
    const r = Number(requested[1]);
    const c = Number(requested[2]);
    if (cells[r][c]) openCell = [r, c];
  }
  if (!openCell) {
    for (let r = 0; r < 3 && !openCell; r++) {
      for (let c = 0; c < 3 && !openCell; c++) {
        if (cells[r][c]) openCell = [r, c];
      }
    }
  }

  const page = parsePage(firstValue(params.page));
  const drillDown = openCell
    ? await solveCellRows(
      state.rows[openCell[0]], state.cols[openCell[1]], state.order,
      { limit: GRID_LIMITS.defaultRowsPerCell, offset: (page - 1) * GRID_LIMITS.defaultRowsPerCell },
    )
    : null;

  const lookups = { clubs: clubNames, venues: venueNames, players: playerNames, awards: awardNames };
  const defined = cells.flat().filter(Boolean).length;

  // The board and its controls reorder and collapse like any other stack of
  // sections on the site: with nine questions set up, the filters are what a
  // reader wants out of the way, and the drill-down is what they want first.
  const sections = [
    {
      id: 'grid-filters',
      label: 'Search filters',
      node: (
        <section className="section">
          <CollapsiblePanel title="Search filters" note="Six axes and a ranking">
            <div style={{ padding: '0.75rem 0.9rem 0.9rem' }}>
              <GridSolverForm
                initialState={state}
                clubs={clubOptions}
                venues={venueOptions}
                awards={awardOptions}
                playerNames={Object.fromEntries(playerNames)}
              />
            </div>
          </CollapsiblePanel>
        </section>
      ),
    },
    {
      id: 'grid-board',
      label: 'The board',
      node: (
        <section className="section">
          <CollapsibleTable title="The board" note={`${defined} of 9 squares solved`}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col" />
                    {state.cols.map((axis, c) => (
                      <th scope="col" key={c}>{describeAxis(axis, lookups)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {state.rows.map((rowAxis, r) => (
                    <tr key={r}>
                      <th scope="row">{describeAxis(rowAxis, lookups)}</th>
                      {state.cols.map((_colAxis, c) => {
                        const cell = cells[r][c];
                        const isOpen = openCell?.[0] === r && openCell?.[1] === c;
                        if (!cell) {
                          return <td key={c} className="muted">define both axes</td>;
                        }
                        return (
                          <td key={c} style={isOpen ? { background: 'var(--bg-hover)', fontWeight: 650 } : undefined}>
                            <Link href={`/grid-solver?g=${serializeBoardState(state)}&cell=${r}-${c}`}>
                              {cell.eligible === 0 ? 'No answer' : cell.top?.displayName}
                            </Link>
                            <div className="muted" style={{ fontSize: '0.78rem' }}>
                              {formatNumber(cell.eligible)} eligible
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CollapsibleTable>
        </section>
      ),
    },
  ];

  if (openCell && drillDown) {
    sections.push({
      id: 'grid-drill-down',
      label: 'Eligible players',
      node: (
        <section className="section">
          <h2>
            {describeAxis(state.rows[openCell[0]], lookups)} × {describeAxis(state.cols[openCell[1]], lookups)}
          </h2>

          {drillDown.total === 0 ? (
            <div className="empty">
              <h2>No answer</h2>
              <p>No player satisfies both axes.</p>
            </div>
          ) : (
            <>
              <CollapsibleTable title="Eligible players" note={`${formatNumber(drillDown.total)} eligible`}>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Player</th>
                        <th scope="col">Span</th>
                        <th scope="col" className="num">Games</th>
                        <th scope="col" className="num">Goals</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drillDown.rows.map((p) => (
                        <tr key={p.id}>
                          <td><Link href={playerPath(p.slug, p.id)}>{p.displayName}</Link></td>
                          <td>{formatSpan(p.debutSeason, p.finalSeason)}</td>
                          <td className="num">{formatNumber(p.games)}</td>
                          <td className="num">{formatNumber(p.goals)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CollapsibleTable>

              <Pagination
                basePath="/grid-solver"
                params={{ g: serializeBoardState(state), cell: `${openCell[0]}-${openCell[1]}` }}
                page={page}
                pageSize={GRID_LIMITS.defaultRowsPerCell}
                total={drillDown.total}
              />
            </>
          )}
        </section>
      ),
    });
  }

  return (
    <>
      <div className="page-header">
        <h1>Grid solver</h1>
        <p className="subtitle">
          Pick three row questions and three column questions from the catalogue —
          every square is solved as soon as its row and column are both set.
        </p>
      </div>

      <ReorderableSections storageKey="/grid-solver" sections={sections} />
    </>
  );
}

function describeAxis(
  axis: GridAxisState,
  lookups: {
    clubs: Map<number, string>; venues: Map<number, string>;
    players: Map<number, string>; awards: Map<number, string>;
  },
): string {
  const def = GRID_BUILDERS[axis.builder];
  if (!def) return axis.builder;
  if (def.params.length === 0) return def.label;

  const parts = def.params.map((p) => {
    const raw = (axis.params[p.key] ?? '').trim();
    if (!raw) return '…';
    switch (p.kind) {
      case 'club': return lookups.clubs.get(Number(raw)) ?? `Club #${raw}`;
      case 'venue': return lookups.venues.get(Number(raw)) ?? `Venue #${raw}`;
      case 'player': return lookups.players.get(Number(raw)) ?? `Player #${raw}`;
      case 'award': return lookups.awards.get(Number(raw)) ?? `Award #${raw}`;
      case 'stat': return Object.hasOwn(GRID_STATS, raw) ? GRID_STATS[raw as keyof typeof GRID_STATS].label : raw;
      case 'aaPosition': return GRID_AA_POSITIONS.find((o) => o.value === raw)?.label ?? raw;
      default: return raw;
    }
  });
  return `${def.label} (${parts.join(', ')})`;
}
