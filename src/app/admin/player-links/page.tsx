import type { Metadata } from 'next';
import Link from 'next/link';

import { ResolveControls } from '@/app/admin/player-links/ResolveControls';
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
 * The manual half of player linking.
 *
 * Import-time linking classifies every source name as unique, resolved,
 * ambiguous, unmatched or implausible; the last three land here, one
 * queue across every honours table, for a super admin to settle by hand
 * against external sources. Reader suggestions from the public
 * "Unmatched" badges arrive in their own section and inline against the
 * rows they point at.
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

  const suggestionsByTarget = new Map<string, typeof suggestions>();
  for (const s of suggestions) {
    const key = `${s.targetTable}:${s.targetId}`;
    if (!suggestionsByTarget.has(key)) suggestionsByTarget.set(key, []);
    suggestionsByTarget.get(key)!.push(s);
  }

  const byTable = new Map<LinkTargetTable, typeof queue>();
  for (const row of queue) {
    if (!byTable.has(row.targetTable)) byTable.set(row.targetTable, []);
    byTable.get(row.targetTable)!.push(row);
  }

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

      <nav className="section" aria-label="Filter">
        <Link href="/admin/player-links">All tables</Link>
        {LINK_TARGET_TABLES.map((t) => (
          <span key={t}>
            {' · '}
            <Link href={`/admin/player-links?table=${t}`}>{TABLE_LABELS[t]}</Link>
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
              note={`${formatNumber(rows.length)} unresolved`}
              defaultOpen={table !== undefined || byTable.size === 1}
            >
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Source name</th>
                      <th scope="col">Context</th>
                      <th scope="col">Status</th>
                      <th scope="col">Resolve</th>
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
                          <td style={{ minWidth: '22rem' }}>
                            <details>
                              <summary>Resolve…</summary>
                              <ResolveControls
                                targetTable={row.targetTable}
                                targetId={row.targetId}
                                linkStatus={row.linkStatus}
                                suggestions={rowSuggestions.map((s) => ({
                                  id: s.id, suggestedName: s.suggestedName, note: s.note,
                                }))}
                              />
                            </details>
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
    </>
  );
}
