import type { Metadata } from 'next';
import Link from 'next/link';

import { getNlFeedbackSummary, listNlFeedback } from '@/db/queries/nl-search-log';
import { requireSuperAdmin } from '@/lib/auth/session';
import { formatNumber, NOT_RECORDED } from '@/lib/format';
import { firstValue } from '@/lib/params';

export const metadata: Metadata = { title: 'Reader feedback', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const DAYS = 30;
const LIMIT = 200;

/**
 * What readers said about their own search results.
 *
 * Kept apart from the review queue on purpose. /admin/nl-search ranks
 * what the ENGINE thought went wrong; this page is the far smaller,
 * far higher-signal list of searches a human actually stopped to
 * complain about. A row here is not automatically a bug -- a reader can
 * be wrong about the football, or be answering a question they did not
 * mean to ask -- which is exactly why the verdict lives in
 * nl_search_feedback and the judgement lives in nl_search_review.
 */
export default async function NlFeedbackPage(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  await requireSuperAdmin();
  const params = await searchParams;
  const filter = firstValue(params.verdict);
  const verdict = filter === 'correct' || filter === 'incorrect' ? filter : undefined;

  const [summary, rows] = await Promise.all([
    getNlFeedbackSummary(DAYS),
    listNlFeedback({ verdict, limit: LIMIT }),
  ]);

  const total = summary.correct + summary.incorrect;

  return (
    <>
      <div className="page-header">
        <h1>Reader feedback</h1>
        <p className="subtitle">
          Anonymous replies to “Did AFLDB understand this question?”
        </p>
      </div>

      <section className="section">
        {/* The counts are windowed; the table below is not. Said out loud
            in both places, because a low-volume month otherwise shows
            "Understood: 0" directly above a table full of replies. */}
        <h2>Last {DAYS} days</h2>
        <div className="stat-strip">
          <div className="stat">
            <div className="value">{formatNumber(summary.correct)}</div>
            <div className="label">Understood</div>
          </div>
          <div className="stat">
            <div className="value">{formatNumber(summary.incorrect)}</div>
            <div className="label">Misread</div>
          </div>
          <div className="stat">
            <div className="value">
              {total === 0 ? NOT_RECORDED : `${((summary.correct / total) * 100).toFixed(1)}%`}
            </div>
            <div className="label">Agreement</div>
          </div>
          <div className="stat">
            <div className="value">{formatNumber(summary.withText)}</div>
            <div className="label">With a written answer</div>
          </div>
        </div>
        <p className="section-note">
          Self-selected, not a sample: readers who are annoyed reply more often than readers who
          are satisfied, so the agreement figure is a floor rather than an estimate. The written
          replies are the part worth reading.
        </p>
      </section>

      <nav className="section" aria-label="Filter">
        <Link href="/admin/nl-search/feedback">All</Link>
        {' · '}
        <Link href="/admin/nl-search/feedback?verdict=incorrect">Misread only</Link>
        {' · '}
        <Link href="/admin/nl-search/feedback?verdict=correct">Understood only</Link>
        {' · '}
        <Link href="/admin/nl-search">Back to search telemetry</Link>
      </nav>

      <section className="section">
        <h2>
          Every reply
          {verdict === 'correct' ? ' marked understood' : ''}
          {verdict === 'incorrect' ? ' marked misread' : ''}
        </h2>
        <p className="section-note">
          Newest first, all time, up to {LIMIT}. Deliberately not the 30-day window above: there
          are few enough of these that the older ones are still worth reading.
        </p>
        {rows.length === 0 ? (
          <p className="muted">No feedback yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Verdict</th>
                <th scope="col">Question</th>
                <th scope="col">Should have been</th>
                <th scope="col">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.createdAt.toISOString().slice(0, 16).replace('T', ' ')}</td>
                  <td>{row.verdict === 'correct' ? 'Understood' : 'Misread'}</td>
                  <td>
                    {row.searchId === null
                      ? <span className="muted">{row.question ?? 'search not recorded'}</span>
                      : <Link href={`/admin/nl-search/${row.searchId}`}>{row.question}</Link>}
                  </td>
                  <td>{row.expectedAnswer ?? <span className="muted">{NOT_RECORDED}</span>}</td>
                  <td className="muted">
                    {row.outcome ?? NOT_RECORDED}
                    {row.failureReason ? ` / ${row.failureReason}` : ''}
                    {row.parserVersion ? ` · parser v${row.parserVersion}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
