import type { Metadata } from 'next';
import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import {
  getNlFailureBreakdown,
  getNlLogOverview,
  getReformulations,
  getTopPlans,
  getTopUnsupportedTerms,
  getUnsupportedTopics,
  listNlProblems,
  NL_LOG_PERIODS,
  parseNlLogPeriod,
} from '@/db/queries/nl-search-log';
import { requireSuperAdmin } from '@/lib/auth/session';
import { formatNumber, NOT_RECORDED } from '@/lib/format';
import { firstValue } from '@/lib/params';
import {
  NL_FAILURE_REASON_LABEL,
  NL_OUTCOME_LABEL,
  NL_REVIEW_STATUS_LABEL,
  type NlReviewStatus,
} from '@/search/nl/review-spec';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Natural-language search',
  robots: { index: false, follow: false },
};

/**
 * The datasets /admin/nl-search/export offers, with the label each gets
 * here. Kept as a literal rather than imported from the route module: a
 * route file's job is to answer a request, and importing a const out of
 * one into a page reads as though the page depends on the handler.
 */
const CSV_DATASETS = [
  ['searches', 'every search'],
  ['problems', 'problems only'],
  ['terms', 'unsupported terms'],
  ['topics', 'unsupported topics'],
  ['reasons', 'failure summary'],
  ['reformulations', 'reformulations'],
  ['plans', 'plans'],
] as const;

function pct(part: number, whole: number): string {
  if (whole === 0) return NOT_RECORDED;
  return `${((part / whole) * 100).toFixed(1)}%`;
}

function ms(value: number | null): string {
  return value === null ? NOT_RECORDED : `${Math.round(value)} ms`;
}

function confidence(value: number | null): string {
  return value === null ? NOT_RECORDED : value.toFixed(2);
}

function timestamp(value: Date): string {
  return value.toISOString().slice(0, 16).replace('T', ' ');
}

/** Unreviewed is the absence of a review row, so it renders as plain muted text rather than a badge. */
function reviewBadge(status: NlReviewStatus | null) {
  if (status === null || status === 'unreviewed') {
    return <span className="muted">Unreviewed</span>;
  }
  const settled = ['fixed', 'wont_fix', 'duplicate', 'not_a_problem'].includes(status);
  return <span className={settled ? 'badge' : 'badge badge-warn'}>{NL_REVIEW_STATUS_LABEL[status]}</span>;
}

export default async function NlSearchAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSuperAdmin();

  const params = await searchParams;
  const days = parseNlLogPeriod(firstValue(params.days));
  // Closed-set check before the value is used as a filter -- the query
  // binds it either way, but an unknown reason should mean "no filter"
  // rather than an empty table with no explanation.
  const requestedReason = firstValue(params.reason);
  const reason = requestedReason && requestedReason in NL_FAILURE_REASON_LABEL
    ? requestedReason
    : undefined;

  const [overview, failures, terms, topics, problems, reformulations, plans] = await Promise.all([
    getNlLogOverview(days),
    getNlFailureBreakdown(days),
    getTopUnsupportedTerms(days),
    getUnsupportedTopics(days),
    listNlProblems(days, { failureReason: reason }),
    getReformulations(days),
    getTopPlans(days),
  ]);

  const answeredAll = overview.answered + overview.answeredCaveat;
  const periodHref = (d: number) => `/admin/nl-search?days=${d}${reason ? `&reason=${reason}` : ''}`;
  const reasonHref = (r: string | null) => `/admin/nl-search?days=${days}${r ? `&reason=${r}` : ''}`;

  return (
    <>
      <div className="page-header">
        <h1>Natural-language search</h1>
        <p className="subtitle">
          What readers actually asked the deterministic question engine, and what it did with it.
          Read-only telemetry: <code>nl_search_log</code> is append-only, and a review recorded
          here never alters the evidence it is about.
        </p>
      </div>

      <p className="section-note">
        Period:{' '}
        {NL_LOG_PERIODS.map((d) => (
          <span key={d}>
            {d === days ? <strong>last {d} days</strong> : <Link href={periodHref(d)}>last {d} days</Link>}
            {d === NL_LOG_PERIODS[NL_LOG_PERIODS.length - 1] ? '' : ' · '}
          </span>
        ))}
      </p>

      <p className="section-note">
        Download (CSV, this period):{' '}
        {CSV_DATASETS.map(([dataset, label], i) => (
          <span key={dataset}>
            <a href={`/admin/nl-search/export?dataset=${dataset}&days=${days}`}>{label}</a>
            {i === CSV_DATASETS.length - 1 ? '' : ' · '}
          </span>
        ))}
        <br />
        <span className="muted">
          Exports contain raw reader-typed questions and are audited. Anonymous throughout —
          no IP, no account, no device; the session id is a short-lived random value whose only
          job is to group one visit&rsquo;s searches together.
        </span>
      </p>

      {overview.total === 0 ? (
        <p className="notice">
          No natural-language searches logged in this period. Logging went live with migration 046 —
          if this is unexpected, check that the site has had traffic since it was deployed.
        </p>
      ) : (
        <>
          <div className="stat-strip">
            <div className="stat">
              <div className="value">{formatNumber(overview.total)}</div>
              <div className="label">Searches</div>
            </div>
            <div className="stat">
              <div className="value">{pct(answeredAll, overview.total)}</div>
              <div className="label">Answered</div>
              <div className="note">
                {formatNumber(overview.answered)} clean, {formatNumber(overview.answeredCaveat)} with a caveat
              </div>
            </div>
            <div className="stat">
              <div className="value">{pct(overview.declined, overview.total)}</div>
              <div className="label">Declined</div>
              <div className="note">{formatNumber(overview.declined)} fell through to ordinary search</div>
            </div>
            <div className="stat">
              <div className="value">{confidence(overview.medianConfidence)}</div>
              <div className="label">Median confidence</div>
              <div className="note">mean {confidence(overview.avgConfidence)}</div>
            </div>
            <div className="stat">
              <div className="value">{ms(overview.medianDurationMs)}</div>
              <div className="label">Median time</div>
              <div className="note">p95 {ms(overview.p95DurationMs)}</div>
            </div>
            <div className="stat">
              <div className="value">{pct(overview.reformulated, overview.total)}</div>
              <div className="label">Reformulated</div>
              <div className="note">{formatNumber(overview.reformulated)} followed another within 60s</div>
            </div>
          </div>

          {overview.outstanding > 0 ? (
            <p className="notice">
              {formatNumber(overview.outstanding)} problem
              {overview.outstanding === 1 ? '' : 's'} still outstanding — nobody has marked
              {overview.outstanding === 1 ? ' it' : ' them'} fixed, won&rsquo;t-fix or not-a-problem.
            </p>
          ) : (
            <p className="notice">Every logged problem in this period has been reviewed and settled.</p>
          )}

          {overview.errors > 0 && (
            <p className="notice">
              {formatNumber(overview.errors)} search
              {overview.errors === 1 ? '' : 'es'} ended in an unhandled error. These are bugs, not
              vocabulary gaps — the reader still got ordinary search results, so nothing surfaced
              at the time.
            </p>
          )}

          <section className="section">
            <h2>Problems by reason</h2>
            <p className="section-note">
              The whole point of the taxonomy: an unsupported <em>term</em> is a vocabulary fix, an
              unsupported <em>topic</em> is a data-roadmap decision, and a coverage failure is
              neither — the parser did its job and the era simply has no record.
            </p>
            {failures.length === 0 ? (
              <p className="muted">No failures in this period.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Reason</th>
                      <th scope="col" className="num">Searches</th>
                      <th scope="col" className="num">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failures.map((f) => (
                      <tr key={f.failureReason}>
                        <td className="wide">
                          <Link href={reasonHref(f.failureReason)}>
                            {NL_FAILURE_REASON_LABEL[f.failureReason] ?? f.failureReason}
                          </Link>
                        </td>
                        <td className="num">{formatNumber(f.count)}</td>
                        <td className="num">
                          {f.outstanding > 0
                            ? <span className="badge badge-warn">{formatNumber(f.outstanding)}</span>
                            : formatNumber(f.outstanding)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="section">
            <CollapsibleTable
              title="Unsupported terms"
              note={`${formatNumber(terms.length)} distinct`}
            >
              <p className="section-note">
                AFL words readers used that the parser does not know. Frequency is evidence, not
                authority — a common nickname may still be ambiguous (&ldquo;gazza&rdquo; is two
                different players), so nothing here is promoted into the vocabulary automatically.
                Decide per term, then add a parser test alongside the change.
              </p>
              {terms.length === 0 ? (
                <p className="muted">No unrecognised terms in this period.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Term</th>
                        <th scope="col" className="num">Searches</th>
                        <th scope="col">Most recent example</th>
                      </tr>
                    </thead>
                    <tbody>
                      {terms.map((t) => (
                        <tr key={t.term}>
                          <td className="wide"><code>{t.term}</code></td>
                          <td className="num">{formatNumber(t.count)}</td>
                          <td className="muted">
                            <Link href={`/admin/nl-search/${t.exampleId}`}>{t.example}</Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CollapsibleTable>
          </section>

          <section className="section">
            <CollapsibleTable title="Unsupported topics" note={`${formatNumber(topics.length)} topics`}>
              <p className="section-note">
                These parsed correctly and were declined on purpose. This is the data roadmap:
                what readers keep asking for that AFLDB has chosen not to answer yet.
              </p>
              {topics.length === 0 ? (
                <p className="muted">Nobody asked for an unsupported topic in this period.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Topic</th>
                        <th scope="col" className="num">Requests</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topics.map((t) => (
                        <tr key={t.topic}>
                          <td className="wide">{t.topic}</td>
                          <td className="num">{formatNumber(t.count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CollapsibleTable>
          </section>

          <section className="section">
            <div className="split-head">
              <h2>
                Problem searches
                {reason && <> — {NL_FAILURE_REASON_LABEL[reason] ?? reason}</>}
              </h2>
              {reason && <Link className="more" href={reasonHref(null)}>Show all reasons →</Link>}
            </div>
            {problems.length === 0 ? (
              <p className="muted">Nothing matching in this period.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Question</th>
                      <th scope="col">Reason</th>
                      <th scope="col" className="num">Confidence</th>
                      <th scope="col">Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {problems.map((p) => (
                      <tr key={p.id}>
                        <td className="nowrap muted">{timestamp(p.at)}</td>
                        <td className="wide">
                          <Link href={`/admin/nl-search/${p.id}`}>{p.question}</Link>
                        </td>
                        <td className="nowrap">
                          {p.failureReason
                            ? NL_FAILURE_REASON_LABEL[p.failureReason] ?? p.failureReason
                            : NL_OUTCOME_LABEL[p.outcome] ?? p.outcome}
                        </td>
                        <td className="num">{confidence(p.confidence)}</td>
                        <td className="nowrap">{reviewBadge(p.reviewStatus)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="section">
            <CollapsibleTable
              title="Likely reformulations"
              note={`${formatNumber(reformulations.length)} recent`}
              defaultOpen={false}
            >
              <p className="section-note">
                A reader rephrasing within a minute is the strongest available signal that an
                answer did not match what they meant — and the pairs worth reading hardest are the
                ones where the <em>first</em> search was answered, since nothing failed and no
                error log would ever show them. Exploring is normal too, so treat these as
                candidates, not verdicts.
              </p>
              {reformulations.length === 0 ? (
                <p className="muted">No reformulation chains in this period.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">First asked</th>
                        <th scope="col">Then asked</th>
                        <th scope="col" className="num">Apart</th>
                        <th scope="col">First outcome</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reformulations.map((r) => (
                        <tr key={r.id}>
                          <td className="wide">
                            <Link href={`/admin/nl-search/${r.parentId}`}>{r.parentQuestion}</Link>
                          </td>
                          <td className="wide">
                            <Link href={`/admin/nl-search/${r.id}`}>{r.question}</Link>
                          </td>
                          <td className="num nowrap">{Math.round(r.secondsApart)}s</td>
                          <td className="nowrap">
                            {r.parentOutcome.startsWith('answered')
                              ? <span className="badge badge-warn">{NL_OUTCOME_LABEL[r.parentOutcome] ?? r.parentOutcome}</span>
                              : <span className="muted">{NL_OUTCOME_LABEL[r.parentOutcome] ?? r.parentOutcome}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CollapsibleTable>
          </section>

          <section className="section">
            <CollapsibleTable
              title="Most-asked questions, by meaning"
              note={`${formatNumber(plans.length)} plans`}
              defaultOpen={false}
            >
              <p className="section-note">
                Grouped by the hash of the canonical query plan, so every phrasing of one question
                counts once. &ldquo;Distinct phrasings&rdquo; being much larger than one is a hint
                that readers are groping for the wording — worth checking the vocabulary covers the
                natural way to say it.
              </p>
              {plans.length === 0 ? (
                <p className="muted">No plans executed in this period.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Example question</th>
                        <th scope="col">Grain</th>
                        <th scope="col">Metric</th>
                        <th scope="col" className="num">Searches</th>
                        <th scope="col" className="num">Distinct phrasings</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plans.map((p) => (
                        <tr key={p.planHash}>
                          <td className="wide">
                            <Link href={`/admin/nl-search/${p.exampleId}`}>{p.example}</Link>
                          </td>
                          <td className="muted nowrap">{p.grain ?? NOT_RECORDED}</td>
                          <td className="muted nowrap">{p.metric ?? NOT_RECORDED}</td>
                          <td className="num">{formatNumber(p.searches)}</td>
                          <td className="num">{formatNumber(p.distinctQuestions)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CollapsibleTable>
          </section>
        </>
      )}
    </>
  );
}
