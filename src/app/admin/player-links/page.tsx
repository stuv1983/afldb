import type { Metadata } from 'next';
import Link from 'next/link';

import { ResolvePanel } from '@/app/admin/player-links/ResolvePanel';
import { SuggestionControls } from '@/app/admin/player-links/SuggestionControls';
import { CollapsibleTable } from '@/components/CollapsibleTable';
import {
  isLinkTargetTable,
  LINK_TARGET_TABLES,
  listConfirmedUnlinked,
  listSuggestions,
  listUnresolvedLinks,
  type LinkTargetTable,
} from '@/db/queries/player-links';
import { requireSuperAdmin } from '@/lib/auth/session';
import { formatDate, formatNumber } from '@/lib/format';
import { firstValue } from '@/lib/params';

export const metadata: Metadata = { title: 'Player links', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const TABLE_LABELS: Record<LinkTargetTable, string> = {
  award_winners: 'Award winners',
  award_nominations: 'Award nominations',
  hall_of_fame: 'Hall of Fame',
  honour_team_members: 'Honour teams',
  captaincies: 'Captaincies',
  player_achievements: 'Achievements',
  draft_picks: 'Draft picks',
};

/**
 * Fixed page size, never user-controlled. 50 rows keeps the served HTML
 * around the size of an ordinary admin table; the full 2,000+-row queue
 * used to ship ~1.1 MB of RSC and take multiple seconds of client render
 * per navigation.
 */
const PAGE_SIZE = 50;

/**
 * The manual half of player linking.
 *
 * Import-time linking classifies every source name as unique, resolved,
 * ambiguous, unmatched or implausible; the last three land here, one
 * queue across every honours table, for a super admin to settle by hand
 * against external sources. Reader suggestions from the public
 * "Unmatched" badges arrive in their own section and inline against the
 * rows they point at.
 *
 * Queue rows are deliberately plain server HTML: the interactive resolve
 * UI lives in the single shared ResolvePanel, mounted once per page and
 * fed by data-* attributes on each row's trigger button — see
 * ResolvePanel.tsx for why (the per-row <details><ResolveControls/>
 * design cost seconds of client render on every navigation).
 *
 * Pagination happens here on the server after the vetted filter — the
 * client never receives more than one page. The queue query itself stays
 * unpaginated: it costs ~11 ms for the full seven-table scan, and the
 * vetted exclusion needs the flat list anyway for correct totals.
 */
export default async function PlayerLinksPage(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  await requireSuperAdmin();
  const params = await searchParams;
  const rawTable = firstValue(params.table) ?? '';
  const table = isLinkTargetTable(rawTable) ? rawTable : undefined;

  const [unresolved, vetted, suggestions] = await Promise.all([
    listUnresolvedLinks(table),
    listConfirmedUnlinked(),
    listSuggestions('open'),
  ]);

  // Rows an admin has already vetted as genuinely unlinked stay honest in
  // the honours tables but leave the queue.
  const queue = unresolved.filter((r) => !vetted.has(`${r.targetTable}:${r.targetId}`));

  const totalPages = Math.max(1, Math.ceil(queue.length / PAGE_SIZE));
  const rawPage = Number(firstValue(params.page) ?? '1');
  const page = Number.isInteger(rawPage) ? Math.min(Math.max(1, rawPage), totalPages) : 1;
  const pageRows = queue.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const pageHref = (p: number) =>
    `/admin/player-links?${table ? `table=${table}&` : ''}page=${p}`;

  const suggestionsByTarget = new Map<string, typeof suggestions>();
  for (const s of suggestions) {
    const key = `${s.targetTable}:${s.targetId}`;
    if (!suggestionsByTarget.has(key)) suggestionsByTarget.set(key, []);
    suggestionsByTarget.get(key)!.push(s);
  }

  const byTable = new Map<LinkTargetTable, typeof pageRows>();
  for (const row of pageRows) {
    if (!byTable.has(row.targetTable)) byTable.set(row.targetTable, []);
    byTable.get(row.targetTable)!.push(row);
  }

  const pager = totalPages > 1 && (
    <nav className="section" aria-label="Queue pages" style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
      {page > 1
        ? <Link href={pageHref(page - 1)}>← Previous</Link>
        : <span className="muted">← Previous</span>}
      <span className="muted">
        Page {formatNumber(page)} of {formatNumber(totalPages)}
        {' · '}{formatNumber(queue.length)} unresolved{table ? ` in ${TABLE_LABELS[table]}` : ''}
      </span>
      {page < totalPages
        ? <Link href={pageHref(page + 1)}>Next →</Link>
        : <span className="muted">Next →</span>}
    </nav>
  );

  return (
    <>
      <div className="page-header">
        <h1>Player links</h1>
        <p className="subtitle">
          Source names AFLDB could not identify with confidence — most often state-league
          footballers with no VFL/AFL record. Link the ones you can verify; confirm the rest
          so they stop appearing here.
        </p>
      </div>

      {/* Filter links carry no page param, so changing table resets to page 1. */}
      <nav className="section" aria-label="Filter">
        {table === undefined
          ? <strong aria-current="true">All tables</strong>
          : <Link href="/admin/player-links">All tables</Link>}
        {LINK_TARGET_TABLES.map((t) => (
          <span key={t}>
            {' · '}
            {table === t
              ? <strong aria-current="true">{TABLE_LABELS[t]}</strong>
              : <Link href={`/admin/player-links?table=${t}`}>{TABLE_LABELS[t]}</Link>}
          </span>
        ))}
      </nav>

      {suggestions.length > 0 && (
        <section className="section">
          <CollapsibleTable
            title="Reader suggestions"
            note={`${formatNumber(suggestions.length)} open`}
          >
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Received</th>
                    <th scope="col">Record</th>
                    <th scope="col">Suggested name</th>
                    <th scope="col">Note</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {suggestions.map((s) => (
                    <tr key={s.id}>
                      <td className="nowrap">{formatDate(s.createdAt)}</td>
                      <td className="nowrap">{TABLE_LABELS[s.targetTable]} #{s.targetId}</td>
                      <td className="wide">{s.suggestedName}</td>
                      <td className="wide muted">{s.note ?? ''}</td>
                      <td><SuggestionControls suggestionId={s.id} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CollapsibleTable>
          <p className="section-note">
            A tip is context, not an instruction: accepting one records that it was useful, and
            the link itself still happens below, against a player you have verified.
          </p>
        </section>
      )}

      {pager}

      {queue.length === 0 ? (
        <section className="section">
          <div className="empty">
            <h3>Nothing to review</h3>
            <p>Every source name in scope is linked, or vetted as genuinely unlinked.</p>
          </div>
        </section>
      ) : (
        [...byTable.entries()].map(([t, rows]) => (
          <section className="section" key={t}>
            <CollapsibleTable
              title={TABLE_LABELS[t]}
              note={`${formatNumber(rows.length)} on this page`}
              defaultOpen
            >
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Source name</th>
                      <th scope="col">Context</th>
                      <th scope="col">Status</th>
                      <th scope="col" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const rowSuggestions =
                        suggestionsByTarget.get(`${row.targetTable}:${row.targetId}`) ?? [];
                      return (
                        <tr key={`${row.targetTable}-${row.targetId}`}>
                          <td className="wide">
                            {row.playerName}
                            {rowSuggestions.length > 0 && (
                              <span className="badge">{rowSuggestions.length} tip{rowSuggestions.length > 1 ? 's' : ''}</span>
                            )}
                          </td>
                          <td className="wide muted">{row.context}</td>
                          <td className="nowrap">{row.linkStatus}</td>
                          <td className="nowrap">
                            <button
                              type="button"
                              className="btn btn-secondary"
                              data-resolve-trigger
                              data-target-table={row.targetTable}
                              data-target-id={row.targetId}
                              data-player-name={row.playerName}
                              data-context={row.context}
                              data-link-status={row.linkStatus}
                              data-suggestions={rowSuggestions.length > 0
                                ? JSON.stringify(rowSuggestions.map((s) => ({
                                  id: s.id, suggestedName: s.suggestedName, note: s.note,
                                })))
                                : undefined}
                            >
                              Resolve…
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CollapsibleTable>
          </section>
        ))
      )}

      {pager}

      <ResolvePanel />
    </>
  );
}
