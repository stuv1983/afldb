import type { Metadata } from 'next';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { SortableTable } from '@/components/SortableTable';
import { collectHealthReport } from '@/db/queries/db-health';
import { formatDate, formatNumber, NOT_RECORDED } from '@/lib/format';
import { requireSuperAdmin } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Database Health',
  robots: { index: false, follow: false },
};

function timestamp(value: Date | null): string {
  return value ? value.toISOString().slice(0, 16).replace('T', ' ') : NOT_RECORDED;
}

export default async function DatabaseHealthPage() {
  await requireSuperAdmin();

  const report = await collectHealthReport();
  const { core, tables, rebuilds, reconciliation, statEras, linkQuality, size, submissionBacklog } = report;

  const problems = reconciliation.filter((c) => c.mismatches > 0);
  const lastRebuild = rebuilds.find((r) => r.status === 'completed') ?? null;
  const pendingSubmissions = submissionBacklog.filter((s) => ['staged', 'validated'].includes(s.status));

  return (
    <>
      <div className="page-header">
        <h1>Database Health</h1>
        <p className="subtitle">
          Read-only diagnostics: what is loaded, whether derived totals still agree with the
          fact tables they came from, and where the data has known gaps.
        </p>
      </div>

      <div className="stat-strip">
        <div className="stat">
          <div className="value">{core.seasonMin}–{core.seasonMax}</div>
          <div className="label">Seasons</div>
          <div className="note">{formatNumber(core.seasons)} seasons</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(core.players)}</div>
          <div className="label">Players</div>
          {core.players !== core.playersWithCareerStats && (
            <div className="note">only {formatNumber(core.playersWithCareerStats)} have career stats</div>
          )}
        </div>
        <div className="stat">
          <div className="value">{formatNumber(core.matches)}</div>
          <div className="label">Matches</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(core.playerGameRows)}</div>
          <div className="label">Player-game rows</div>
        </div>
        <div className="stat">
          <div className="value">{size.pretty}</div>
          <div className="label">Database size</div>
        </div>
        <div className="stat">
          <div className="value">{lastRebuild ? timestamp(lastRebuild.completedAt) : NOT_RECORDED}</div>
          <div className="label">Last derived rebuild</div>
          {lastRebuild && <div className="note">{lastRebuild.target}</div>}
        </div>
      </div>

      {problems.length > 0 ? (
        <p className="notice">
          {problems.length} integrity check{problems.length === 1 ? '' : 's'} found a mismatch —
          see below. Run <code>tools/migration/rebuild_derived.py</code> if a recent upload hasn&rsquo;t
          been rebuilt yet.
        </p>
      ) : (
        <p className="notice">All career-total reconciliation checks are clean.</p>
      )}

      {pendingSubmissions.length > 0 && (
        <p className="notice">
          {pendingSubmissions.reduce((n, s) => n + s.count, 0)} submission
          {pendingSubmissions.reduce((n, s) => n + s.count, 0) === 1 ? '' : 's'} awaiting review —
          see <code>/admin</code>.
        </p>
      )}

      <section className="section">
        <h2>Career-total reconciliation</h2>
        <p className="section-note">
          player_career_stats is rebuilt wholesale from player_match_stats, matches and
          brownlow_season_votes. A non-zero count here means the derived table has drifted from
          the tables it was built from — usually a sign a rebuild is overdue.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Check</th>
                <th scope="col" className="num">Mismatches</th>
              </tr>
            </thead>
            <tbody>
              {reconciliation.map((c) => (
                <tr key={c.check}>
                  <td>{c.check}</td>
                  <td className="num">
                    {c.mismatches > 0 ? (
                      <span className="badge badge-warn">{formatNumber(c.mismatches)}</span>
                    ) : (
                      formatNumber(c.mismatches)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <CollapsibleTable
          title="Submission pipeline"
          note={`${formatNumber(submissionBacklog.reduce((n, s) => n + s.count, 0))} total`}
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">Count</th>
                  <th scope="col">Oldest</th>
                </tr>
              </thead>
              <tbody>
                {submissionBacklog.map((s) => (
                  <tr key={s.status}>
                    <td>{s.status}</td>
                    <td className="num">{formatNumber(s.count)}</td>
                    <td className="muted">{formatDate(s.oldestUploadedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleTable>
      </section>

      <section className="section">
        <CollapsibleTable title="Derived-data rebuild log" note={`${formatNumber(rebuilds.length)} recent`} defaultOpen={false}>
          <div className="table-wrap">
            <SortableTable
              defaultSort="started"
              defaultDir="desc"
              columns={[
                { key: 'started', label: 'Started', sortType: 'text', className: 'nowrap' },
                { key: 'completed', label: 'Completed', sortType: 'text', className: 'nowrap' },
                { key: 'target', label: 'Target', sortType: 'text' },
                { key: 'status', label: 'Status', sortType: 'text' },
                { key: 'rows', label: 'Rows', sortType: 'number', className: 'num' },
              ]}
              items={rebuilds.map((r) => ({
                id: String(r.id),
                values: {
                  started: timestamp(r.startedAt),
                  completed: timestamp(r.completedAt),
                  target: r.target,
                  status: r.status,
                  rows: r.rowCount ?? -1,
                },
                element: (
                  <tr key={r.id}>
                    <td className="nowrap muted">{timestamp(r.startedAt)}</td>
                    <td className="nowrap muted">{timestamp(r.completedAt)}</td>
                    <td>{r.target}</td>
                    <td>
                      <span className={r.status === 'failed' || r.status === 'rolled_back' ? 'badge badge-warn' : 'badge'}>
                        {r.status}
                      </span>
                    </td>
                    <td className="num">{r.rowCount === null ? NOT_RECORDED : formatNumber(r.rowCount)}</td>
                  </tr>
                ),
              }))}
            />
          </div>
        </CollapsibleTable>
      </section>

      <section className="section">
        <CollapsibleTable title="Optional link layers" note={`${linkQuality.length} layers`} defaultOpen={false}>
          <p className="section-note">
            Rows where a source name could not be confidently linked to a player are retained
            (never dropped) but excluded from search and the grid solver. Only &ldquo;unique&rdquo; and
            &ldquo;resolved&rdquo; are trusted.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Layer</th>
                  <th scope="col" className="num">Trusted</th>
                  <th scope="col" className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {linkQuality.map((l) => (
                  <tr key={l.label}>
                    <td>{l.label}</td>
                    <td className="num">
                      {l.total > 0 && l.trusted < l.total ? (
                        <span className="badge badge-warn">{formatNumber(l.trusted)}</span>
                      ) : (
                        formatNumber(l.trusted)
                      )}
                    </td>
                    <td className="num">{formatNumber(l.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleTable>
      </section>

      <section className="section">
        <CollapsibleTable title="Statistic coverage by era" note={`${statEras.length} statistics`} defaultOpen={false}>
          <p className="section-note">
            A statistic is empty before its first recorded season — that is a gap in the record,
            not a zero the player recorded.
          </p>
          <div className="table-wrap">
            <SortableTable
              defaultSort="first"
              defaultDir="asc"
              columns={[
                { key: 'stat', label: 'Statistic', sortType: 'text' },
                { key: 'first', label: 'First recorded season', sortType: 'number' },
                { key: 'seasons', label: 'Seasons recorded', sortType: 'number', className: 'num' },
              ]}
              items={statEras.map((s) => ({
                id: s.key,
                values: {
                  stat: s.label,
                  first: s.firstRecordedSeason ?? 9999,
                  seasons: s.seasonsRecorded,
                },
                element: (
                  <tr key={s.key}>
                    <td>{s.label}</td>
                    <td>{s.firstRecordedSeason ?? 'never'}</td>
                    <td className="num">{formatNumber(s.seasonsRecorded)}</td>
                  </tr>
                ),
              }))}
            />
          </div>
        </CollapsibleTable>
      </section>

      <section className="section">
        <CollapsibleTable title={`What is in the database (${tables.length} tables)`} defaultOpen={false}>
          <p className="section-note">
            Row counts are PostgreSQL&rsquo;s own statistics estimate, not an exact
            <code> COUNT(*)</code> — close enough to spot a table that is unexpectedly empty
            or unexpectedly huge, without scanning the whole database on every page load.
          </p>
          <div className="table-wrap">
            <SortableTable
              defaultSort="table"
              defaultDir="asc"
              columns={[
                { key: 'table', label: 'Table', sortType: 'text' },
                { key: 'rows', label: 'Rows (est.)', sortType: 'number', className: 'num' },
                { key: 'holds', label: 'Holds', sortType: 'text' },
              ]}
              items={tables.map((t) => ({
                id: t.table,
                values: {
                  table: t.table,
                  rows: t.estimatedRows,
                  holds: t.purpose ?? '',
                },
                element: (
                  <tr key={t.table}>
                    <td className="wide">{t.table}</td>
                    <td className="num">{formatNumber(t.estimatedRows)}</td>
                    <td className="muted">{t.purpose ?? '—'}</td>
                  </tr>
                ),
              }))}
            />
          </div>
        </CollapsibleTable>
      </section>
    </>
  );
}
