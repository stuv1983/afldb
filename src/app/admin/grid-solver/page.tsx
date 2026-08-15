import type { Metadata } from 'next';
import Link from 'next/link';

import { GridSolverForm } from '@/app/admin/grid-solver/GridSolverForm';
import { CollapsibleTable } from '@/components/CollapsibleTable';
import { Pagination } from '@/components/Pagination';
import { getClubOrganizationOptions, getVenueOptions } from '@/db/queries/advanced-search';
import { solveCellRows, solveCellSummary, type GridCellSummary } from '@/db/queries/grid-solver';
import { getPlayerNames } from '@/db/queries/players';
import { requireSuperAdmin } from '@/lib/auth/session';
import { formatNumber, formatSpan, playerPath } from '@/lib/format';
import { firstValue, parsePage } from '@/lib/params';
import {
  DEFAULT_BOARD_STATE,
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
 * Hidden, super-admin-only sibling to /admin/query-builder: a 3x3 board
 * of named questions instead of raw column/operator/value conditions.
 * Unlinked from the shared admin nav for the same reason query-builder
 * is -- see that page's own comment -- and enforces requireSuperAdmin()
 * itself regardless of how it was reached.
 */
export default async function GridSolverPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSuperAdmin();

  const params = await searchParams;
  const token = firstValue(params.g);
  const state: GridBoardState = (token && parseBoardState(token)) || DEFAULT_BOARD_STATE;

  const axisPlayerIds = [...state.rows, ...state.cols]
    .filter((a) => GRID_BUILDERS[a.builder]?.params.some((p) => p.kind === 'player'))
    .map((a) => Number(a.params.player))
    .filter((id) => Number.isSafeInteger(id) && id > 0);

  const [clubOptions, venueOptions, playerNames] = await Promise.all([
    getClubOrganizationOptions(),
    getVenueOptions(),
    getPlayerNames(axisPlayerIds),
  ]);
  const clubNames = new Map(clubOptions.map((c) => [c.id, c.name]));
  const venueNames = new Map(venueOptions.map((v) => [v.id, v.name]));

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

  const lookups = { clubs: clubNames, venues: venueNames, players: playerNames };

  return (
    <>
      <div className="page-header">
        <h1>Grid solver</h1>
        <p className="subtitle">
          Super-admin only. Pick three row questions and three column questions from the
          catalogue below — every square is solved as soon as its row and column are both set.
        </p>
      </div>

      <section className="section">
        <GridSolverForm
          initialState={state}
          clubs={clubOptions}
          venues={venueOptions}
          playerNames={Object.fromEntries(playerNames)}
        />
      </section>

      <section className="section">
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
                        <Link href={`/admin/grid-solver?g=${serializeBoardState(state)}&cell=${r}-${c}`}>
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
      </section>

      {openCell && drillDown && (
        <section className="section">
          <h2>{describeAxis(state.rows[openCell[0]], lookups)} × {describeAxis(state.cols[openCell[1]], lookups)}</h2>

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
                basePath="/admin/grid-solver"
                params={{ g: serializeBoardState(state), cell: `${openCell[0]}-${openCell[1]}` }}
                page={page}
                pageSize={GRID_LIMITS.defaultRowsPerCell}
                total={drillDown.total}
              />
            </>
          )}
        </section>
      )}
    </>
  );
}

function describeAxis(
  axis: GridAxisState,
  lookups: { clubs: Map<number, string>; venues: Map<number, string>; players: Map<number, string> },
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
      case 'stat': return Object.hasOwn(GRID_STATS, raw) ? GRID_STATS[raw as keyof typeof GRID_STATS].label : raw;
      default: return raw;
    }
  });
  return `${def.label} (${parts.join(', ')})`;
}
