import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment } from 'react';

import { RefreshSuggestionsControls } from '@/app/admin/player-links/RefreshSuggestionsControls';
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
import {
  formatPlayerSummary,
  readBestSuggestions,
  readPlayerSummaries,
  readSourceDetails,
  readSuggestionsForEntities,
} from '@/db/queries/player-match-candidates';
import { sql } from '@/db/client';
import { requireSuperAdmin } from '@/lib/auth/session';
import { BAND_ORDER, isConfidenceBand } from '@/lib/player-matching/confidence';
import {
  conflictLabel,
  describeAlternative,
  describeBulkCriteria,
  describeSourceRecord,
  evidenceDescription,
  evidenceLabel,
} from '@/lib/player-matching/describe';
import type { ConfidenceBand } from '@/lib/player-matching/types';
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

const BAND_LABELS: Record<ConfidenceBand, string> = {
  very_high: 'Very high',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'No suggestion',
};

/**
 * Queue order: the rows a reviewer can clear fastest first, then the
 * ones needing a decision, then everything the model could not help
 * with. Ambiguous rows are pulled up behind the confident ones rather
 * than buried, because a near-tie is exactly the case that needs a
 * human and would otherwise never be looked at.
 */
function queueRank(band: ConfidenceBand | undefined, bulkEligible: boolean, ambiguous: boolean): number {
  if (bulkEligible) return 0;
  if (ambiguous) return 2;
  switch (band) {
    case 'very_high': return 1;
    case 'high': return 3;
    case 'medium': return 4;
    case 'low': return 5;
    default: return 6;
  }
}

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
 * unpaginated because the vetted exclusion and the band counts both need
 * the flat list for correct totals; at ~2,000 rows the seven-table scan
 * measures ~180 ms on dev.
 *
 * Everything a reviewer reads BEYOND that list is fetched only for the
 * fifty rows actually rendered — ranked alternatives, career summaries
 * and per-source record detail, ~10 ms each. Building the record detail
 * for the whole queue instead cost ~200 ms of jsonb per load for
 * information forty-nine fiftieths of which was never displayed.
 */
export default async function PlayerLinksPage(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  await requireSuperAdmin();
  const params = await searchParams;
  const rawTable = firstValue(params.table) ?? '';
  const table = isLinkTargetTable(rawTable) ? rawTable : undefined;
  const query = (firstValue(params.q) ?? '').trim();
  const queryLower = query.toLowerCase();
  const under22Preset = table === 'award_winners' && queryLower === '22 under 22';

  const rawBand = firstValue(params.band) ?? '';
  const band = isConfidenceBand(rawBand) ? rawBand : undefined;
  const bulkOnly = firstValue(params.bulk) === '1';

  const [unresolved, vetted, suggestions, bestByEntity] = await Promise.all([
    listUnresolvedLinks(table),
    listConfirmedUnlinked(),
    listSuggestions('open'),
    readBestSuggestions(sql),
  ]);

  // Rows an admin has already vetted as genuinely unlinked stay honest in
  // the honours tables but leave the queue.
  const queue = unresolved.filter((r) => !vetted.has(`${r.targetTable}:${r.targetId}`));

  // Search by player name or record context (see changeLog.md).
  const searched = queryLower
    ? queue.filter(
        (r) =>
          r.playerName.toLowerCase().includes(queryLower) ||
          (r.context && r.context.toLowerCase().includes(queryLower)),
      )
    : queue;

  // Suggestions are keyed on the resolution entity, so every draft pick
  // belonging to one draft_person reads the same cached decision.
  const suggestionFor = (row: (typeof searched)[number]) =>
    bestByEntity.get(`${row.resolutionEntityType}:${row.resolutionEntityId}`);

  const bandFiltered = band
    ? searched.filter((r) => (suggestionFor(r)?.band ?? 'none') === band)
    : searched;
  const filteredQueue = bulkOnly
    ? bandFiltered.filter((r) => suggestionFor(r)?.bulkEligible === true)
    : bandFiltered;

  // Confidence first, then the original table/name order so the page is
  // stable between loads.
  const orderedQueue = [...filteredQueue].sort((a, b) => {
    const sa = suggestionFor(a);
    const sb = suggestionFor(b);
    return (
      queueRank(sa?.band as ConfidenceBand | undefined, sa?.bulkEligible ?? false, sa?.ambiguous ?? false)
      - queueRank(sb?.band as ConfidenceBand | undefined, sb?.bulkEligible ?? false, sb?.ambiguous ?? false)
      || (sb?.score ?? -1) - (sa?.score ?? -1)
      || a.targetTable.localeCompare(b.targetTable)
      || a.playerName.localeCompare(b.playerName)
    );
  });

  const totalPages = Math.max(1, Math.ceil(orderedQueue.length / PAGE_SIZE));
  const rawPage = Number(firstValue(params.page) ?? '1');
  const page = Number.isInteger(rawPage) ? Math.min(Math.max(1, rawPage), totalPages) : 1;
  const pageRows = orderedQueue.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Alternatives and evidence are fetched only for the rows actually
  // rendered; the whole-queue read above is rank 1 alone.
  const pageEntities = [...new Set(pageRows.map((r) => r.resolutionEntityId))];
  const pageEntityTypes = [...new Set(pageRows.map((r) => r.resolutionEntityType))];
  const candidatesByEntity = await readSuggestionsForEntities(sql, pageEntities, pageEntityTypes);
  const sourceDetails = await readSourceDetails(sql, pageRows);

  const bandCounts = new Map<string, number>();
  for (const row of searched) {
    const key = suggestionFor(row)?.band ?? 'none';
    bandCounts.set(key, (bandCounts.get(key) ?? 0) + 1);
  }
  const bulkCount = searched.filter((r) => suggestionFor(r)?.bulkEligible === true).length;
  const lastComputed = [...bestByEntity.values()]
    .reduce<Date | null>((latest, s2) => {
      const at = s2.computedAt instanceof Date ? s2.computedAt : new Date(s2.computedAt);
      return latest === null || at > latest ? at : latest;
    }, null);

  const hrefWith = (overrides: Record<string, string | undefined>) => {
    const qParams = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      table, q: query || undefined, band, bulk: bulkOnly ? '1' : undefined, ...overrides,
    };
    for (const [key, value] of Object.entries(merged)) {
      if (value) qParams.set(key, value);
    }
    const queryString = qParams.toString();
    return queryString ? `/admin/player-links?${queryString}` : '/admin/player-links';
  };

  const pageHref = (p: number) => hrefWith({ page: String(p) });

  const suggestionsByTarget = new Map<string, typeof suggestions>();
  for (const s of suggestions) {
    const key = `${s.targetTable}:${s.targetId}`;
    if (!suggestionsByTarget.has(key)) suggestionsByTarget.set(key, []);
    suggestionsByTarget.get(key)!.push(s);
  }

  // Presentation grouping only.
  //
  // One source name routinely produces several unrelated records -- an
  // award, a nomination, an honour team -- and the old queue rendered
  // them as near-identical lines a reviewer could not tell apart.
  // Grouping them puts the differences side by side. It changes nothing
  // about resolution: each record keeps its own id, status, approval
  // rules and audit trail, and is resolved on its own.
  const groups = new Map<string, typeof pageRows>();
  for (const row of pageRows) {
    const key = row.playerName.trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const suggestionOf = (row: (typeof pageRows)[number]) =>
    bestByEntity.get(`${row.resolutionEntityType}:${row.resolutionEntityId}`);

  /**
   * When several records for one name suggest DIFFERENT players, that
   * disagreement is the most useful thing on the page: at least one of
   * them is wrong. Such a group is never offered for bulk approval.
   */
  const groupViews = [...groups.entries()].map(([key, rows]) => {
    const suggested = rows
      .map((r) => suggestionOf(r))
      .filter((s2): s2 is NonNullable<typeof s2> => s2 !== undefined);
    const distinct = new Set(suggested.map((s2) => s2.playerId));
    const agrees = distinct.size === 1 && suggested.length === rows.length && rows.length > 1;
    return {
      key,
      rows,
      name: rows[0].playerName,
      sharedPlayer: agrees ? suggested[0] : null,
      disagrees: distinct.size > 1,
      suggestedCount: suggested.length,
    };
  });

  const rankOf = (row: (typeof pageRows)[number]) => {
    const s2 = suggestionOf(row);
    return queueRank(
      s2?.band as ConfidenceBand | undefined,
      s2?.bulkEligible ?? false,
      s2?.ambiguous ?? false,
    );
  };
  groupViews.sort((a, b) =>
    Math.min(...a.rows.map(rankOf)) - Math.min(...b.rows.map(rankOf))
    || a.name.localeCompare(b.name));

  // Career context for every player suggested on this page, in one query.
  const summaries = await readPlayerSummaries(
    sql,
    [...new Set(pageRows.map((r) => suggestionOf(r)?.playerId).filter((id): id is number => !!id))],
  );

  const pager = totalPages > 1 && (
    <nav className="section" aria-label="Queue pages" style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
      {page > 1
        ? <Link href={pageHref(page - 1)}>← Previous</Link>
        : <span className="muted">← Previous</span>}
      <span className="muted">
        Page {formatNumber(page)} of {formatNumber(totalPages)}
        {' · '}{formatNumber(filteredQueue.length)} unresolved
        {query ? ` matching "${query}"` : ''}
        {table ? ` in ${TABLE_LABELS[table]}` : ''}
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

      {/* Search box for player name / context */}
      <form
        method="GET"
        action="/admin/player-links"
        style={{
          display: 'flex',
          gap: '0.5rem',
          alignItems: 'center',
          marginBottom: '1rem',
          flexWrap: 'wrap',
        }}
      >
        {table && <input type="hidden" name="table" value={table} />}
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search by player name or context…"
          style={{
            padding: '0.4rem 0.75rem',
            borderRadius: '4px',
            border: '1px solid var(--border, #ccc)',
            minWidth: '280px',
          }}
        />
        <button type="submit" className="button" style={{ padding: '0.4rem 0.85rem' }}>
          Search
        </button>
        {query && (
          <Link
            href={table ? `/admin/player-links?table=${table}` : '/admin/player-links'}
            style={{ fontSize: '0.9rem', color: 'var(--muted, #666)', marginLeft: '0.25rem' }}
          >
            Clear
          </Link>
        )}
      </form>

      {/* Filter links carry no page param, so changing table resets to page 1. */}
      <nav className="section" aria-label="Filter">
        {table === undefined
          ? <strong aria-current="true">All tables</strong>
          : <Link href={query ? `/admin/player-links?q=${encodeURIComponent(query)}` : '/admin/player-links'}>All tables</Link>}
        {LINK_TARGET_TABLES.map((t) => (
          <span key={t}>
            {' · '}
            {table === t
              ? <strong aria-current="true">{TABLE_LABELS[t]}</strong>
              : <Link href={`/admin/player-links?table=${t}${query ? `&q=${encodeURIComponent(query)}` : ''}`}>{TABLE_LABELS[t]}</Link>}
          </span>
        ))}
        <span>
          {' · '}
          {under22Preset
            ? <strong aria-current="true">22Under22</strong>
            : <Link href="/admin/player-links?table=award_winners&q=22%20Under%2022">22Under22</Link>}
        </span>
      </nav>

      {/* Confidence filters. Counts describe the current table/search. */}
      <nav className="section" aria-label="Filter by confidence">
        {band === undefined && !bulkOnly
          ? <strong aria-current="true">All confidence</strong>
          : <Link href={hrefWith({ band: undefined, bulk: undefined })}>All confidence</Link>}
        {BAND_ORDER.map((b) => (
          <span key={b}>
            {' · '}
            {band === b && !bulkOnly
              ? <strong aria-current="true">{BAND_LABELS[b]} ({formatNumber(bandCounts.get(b) ?? 0)})</strong>
              : (
                <Link href={hrefWith({ band: b, bulk: undefined })}>
                  {BAND_LABELS[b]} ({formatNumber(bandCounts.get(b) ?? 0)})
                </Link>
              )}
          </span>
        ))}
        <span>
          {' · '}
          {bulkOnly
            ? <strong aria-current="true">Bulk-ready ({formatNumber(bulkCount)})</strong>
            : <Link href={hrefWith({ band: undefined, bulk: '1' })}>Bulk-ready ({formatNumber(bulkCount)})</Link>}
        </span>
      </nav>

      <section className="section">
        <RefreshSuggestionsControls computedAt={lastComputed} />
        <p className="section-note">
          A suggestion is evidence for a decision, never the decision itself. Approving one
          rescores it against the live data first, and anything contradicted or too close to
          call stays here for you to settle by hand.
        </p>
      </section>

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

      {orderedQueue.length === 0 ? (
        <section className="section">
          <div className="empty">
            <h3>Nothing to review</h3>
            <p>
              {query
                ? `No unresolved records found matching "${query}"${table ? ` in ${TABLE_LABELS[table]}` : ''}.`
                : 'Every source name in scope is linked, or vetted as genuinely unlinked.'}
            </p>
          </div>
        </section>
      ) : (
        <section className="section">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col" style={{ width: '1%' }}>
                    <input
                      type="checkbox"
                      className="bulk-select-all-cb"
                      data-target-table="all"
                      aria-label="Select all on this page"
                    />
                  </th>
                  <th scope="col">Source record</th>
                  <th scope="col">Suggested AFLDB player</th>
                  <th scope="col">Confidence</th>
                  <th scope="col">Status</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {groupViews.map((group) => (
                  <Fragment key={group.key}>
                    {group.rows.length > 1 && (
                      <tr>
                        <td />
                        <td colSpan={5} style={{ paddingTop: '0.9rem' }}>
                          <strong>{group.name}</strong>
                          <span className="muted" style={{ marginLeft: '0.5rem', fontSize: '0.85rem' }}>
                            {formatNumber(group.rows.length)} unresolved records
                          </span>
                          {group.disagrees ? (
                            <span className="badge badge-warn" style={{ marginLeft: '0.5rem' }}>
                              ⚠ Suggestions disagree — review each record individually
                            </span>
                          ) : group.sharedPlayer ? (
                            <span className="muted" style={{ marginLeft: '0.5rem', fontSize: '0.85rem' }}>
                              {formatNumber(group.suggestedCount)}/{formatNumber(group.rows.length)}
                              {' '}independently suggest {group.sharedPlayer.playerName}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    )}

                    {group.rows.map((row) => {
                      const rowSuggestions =
                        suggestionsByTarget.get(`${row.targetTable}:${row.targetId}`) ?? [];
                      const entityKey = `${row.resolutionEntityType}:${row.resolutionEntityId}`;
                      const match = bestByEntity.get(entityKey);
                      const ranked = candidatesByEntity.get(entityKey) ?? [];
                      const alternatives = ranked.filter((c) => c.rank > 1);
                      const record = describeSourceRecord(
                        sourceDetails.get(`${row.targetTable}:${row.targetId}`) ?? null,
                      );
                      const summary = match ? summaries.get(match.playerId) : undefined;
                      // A group whose records disagree about the player is
                      // never offered for unattended approval, whatever the
                      // individual rows scored.
                      const bulkReady = (match?.bulkEligible ?? false) && !group.disagrees;
                      const nextBest = alternatives[0]
                        ? { playerName: alternatives[0].playerName, score: alternatives[0].score }
                        : null;

                      return (
                        <tr key={`${row.targetTable}-${row.targetId}`}>
                          <td className="nowrap" style={{ width: '1%' }}>
                            <input
                              type="checkbox"
                              className="bulk-resolve-cb"
                              data-target-table={row.targetTable}
                              data-target-id={row.targetId}
                              data-player-name={row.playerName}
                              data-link-status={row.linkStatus}
                              data-bulk-eligible={bulkReady ? '1' : '0'}
                              data-suggest-player-id={match?.playerId ?? ''}
                              aria-label={`Select ${row.playerName}, ${record.typeLabel}`}
                            />
                          </td>

                          <td className="wide">
                            <div>{row.playerName}</div>
                            <div>
                              <span className="badge">{record.typeLabel}</span>
                              {rowSuggestions.length > 0 && (
                                <span className="badge">
                                  {rowSuggestions.length} tip{rowSuggestions.length > 1 ? 's' : ''}
                                </span>
                              )}
                            </div>
                            {record.lines.map((line: string) => (
                              <div key={line} className="muted" style={{ fontSize: '0.85rem' }}>{line}</div>
                            ))}
                          </td>

                          <td className="wide">
                            {match ? (
                              <>
                                <Link href={`/players/${match.playerSlug}`}>{match.playerName}</Link>
                                <div className="muted" style={{ fontSize: '0.85rem' }}>
                                  {formatPlayerSummary(summary)}
                                </div>
                                <div style={{ marginTop: '0.2rem' }}>
                                  {match.evidence.map((item) => (
                                    <span key={item.signal} className="badge" title={evidenceDescription(item)}>
                                      ✓ {evidenceLabel(item.signal)}
                                    </span>
                                  ))}
                                  {match.conflicts.map((conflict) => (
                                    <span key={conflict.reason} className="badge badge-warn" title={conflict.detail}>
                                      ✗ {conflictLabel(conflict)}
                                    </span>
                                  ))}
                                </div>
                              </>
                            ) : (
                              <span className="muted">No candidate found</span>
                            )}
                          </td>

                          <td className="nowrap">
                            {match ? (
                              <>
                                <div>
                                  <strong>{match.score}</strong>
                                  {' '}
                                  <span className={match.hardConflict ? 'badge badge-warn' : 'badge'}>
                                    {BAND_LABELS[match.band as ConfidenceBand] ?? match.band}
                                  </span>
                                </div>
                                {bulkReady && <span className="badge">Bulk-ready</span>}
                                {match.ambiguous && <span className="badge badge-warn">Needs review</span>}
                                <div className="muted" style={{ fontSize: '0.8rem' }}>
                                  {describeAlternative(match.gap, nextBest)}
                                </div>
                              </>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>

                          <td className="nowrap">{row.linkStatus}</td>

                          <td className="nowrap">
                            <button
                              type="button"
                              className="btn btn-secondary"
                              data-resolve-trigger
                              data-target-table={row.targetTable}
                              data-target-id={row.targetId}
                              data-player-name={row.playerName}
                              data-context={[record.typeLabel, ...record.lines].join(' · ')}
                              data-link-status={row.linkStatus}
                              data-suggestions={rowSuggestions.length > 0
                                ? JSON.stringify(rowSuggestions.map((sug) => ({
                                  id: sug.id, suggestedName: sug.suggestedName, note: sug.note,
                                })))
                                : undefined}
                              data-source-record={JSON.stringify(record)}
                              data-match={match
                                ? JSON.stringify({
                                  playerId: match.playerId,
                                  playerName: match.playerName,
                                  playerSlug: match.playerSlug,
                                  playerSummary: formatPlayerSummary(summary),
                                  score: match.score,
                                  band: match.band,
                                  gap: match.gap,
                                  ambiguous: match.ambiguous,
                                  hardConflict: match.hardConflict,
                                  bulkEligible: bulkReady,
                                  bulkCriteria: describeBulkCriteria(
                                    match.evidence, match.conflicts, match.gap,
                                  ),
                                  evidence: match.evidence.map((item) => ({
                                    ...item, label: evidenceDescription(item),
                                  })),
                                  conflicts: match.conflicts.map((conflict) => ({
                                    ...conflict, label: conflictLabel(conflict),
                                  })),
                                  algorithmVersion: match.algorithmVersion,
                                  alternatives: alternatives.map((c) => ({
                                    playerId: c.playerId,
                                    playerName: c.playerName,
                                    playerSummary: formatPlayerSummary(summaries.get(c.playerId)),
                                    score: c.score,
                                    evidence: c.evidence.map((item) => ({
                                      ...item, label: evidenceDescription(item),
                                    })),
                                    conflicts: c.conflicts,
                                  })),
                                })
                                : undefined}
                            >
                              Resolve…
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {pager}

      <ResolvePanel />
    </>
  );
}
