import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getNlSearchDetail, getNlSessionSearches } from '@/db/queries/nl-search-log';
import { requireSuperAdmin } from '@/lib/auth/session';
import { formatNumber, NOT_RECORDED } from '@/lib/format';
import { decodeJsonbObject } from '@/lib/jsonb';
import { NL_FAILURE_REASON_LABEL, NL_OUTCOME_LABEL } from '@/search/nl/review-spec';

import { ReviewForm } from '../ReviewForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Search detail',
  robots: { index: false, follow: false },
};

/** The confidence components, in the order the parser applies them. */
const COMPONENT_LABEL: [string, string][] = [
  ['tokenRatio', 'Token coverage'],
  ['playerCertainty', 'Player certainty'],
  ['structuralPenalty', 'Structural completeness'],
  ['unresolvedPenalty', 'Unresolved penalty'],
];

function timestamp(value: Date): string {
  return value.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * jsonb arrives as an object or (for rows written before migration 048's
 * repair) as its JSON text. lib/jsonb.ts exists because this exact
 * ambiguity has bitten three other columns; arrays go through JSON.parse
 * directly since decodeJsonbObject deliberately rejects them.
 */
function decodeArray(value: unknown): unknown[] | null {
  let decoded = value;
  if (typeof decoded === 'string') {
    try { decoded = JSON.parse(decoded); } catch { return null; }
  }
  return Array.isArray(decoded) ? decoded : null;
}

function prettyJson(value: unknown): string {
  if (typeof value === 'string') {
    // Pre-048 row: JSON text inside a jsonb string. Show it re-indented if
    // it parses, verbatim if it somehow does not.
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

export default async function NlSearchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSuperAdmin();

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const detail = await getNlSearchDetail(id);
  if (!detail) notFound();

  const session = detail.sessionId ? await getNlSessionSearches(detail.sessionId) : [];
  const components = decodeJsonbObject(detail.confidenceComponents);
  const entities = decodeArray(detail.entityResolution) as
    { mention: string; resolvedTo: string; certainty: number }[] | null;

  return (
    <>
      <div className="page-header">
        <h1>“{detail.question}”</h1>
        <p className="subtitle">
          {timestamp(detail.at)} · {NL_OUTCOME_LABEL[detail.outcome] ?? detail.outcome}
          {detail.failureReason && (
            <> · {NL_FAILURE_REASON_LABEL[detail.failureReason] ?? detail.failureReason}</>
          )}
        </p>
      </div>

      <p className="section-note">
        <Link href="/admin/nl-search">← All natural-language searches</Link>
      </p>

      <div className="stat-strip">
        <div className="stat">
          <div className="value">{detail.confidence === null ? NOT_RECORDED : detail.confidence.toFixed(2)}</div>
          <div className="label">Confidence</div>
          <div className="note">execute at 0.85, clarify at 0.60</div>
        </div>
        <div className="stat">
          <div className="value">{detail.grain ?? NOT_RECORDED}</div>
          <div className="label">Grain</div>
          {detail.metric && <div className="note">{detail.metric}</div>}
        </div>
        <div className="stat">
          <div className="value">
            {detail.resultCount === null ? NOT_RECORDED : formatNumber(detail.resultCount)}
          </div>
          <div className="label">Results</div>
        </div>
        <div className="stat">
          <div className="value">{detail.durationMs === null ? NOT_RECORDED : `${detail.durationMs} ms`}</div>
          <div className="label">Time</div>
        </div>
        <div className="stat">
          <div className="value">{detail.parserVersion ?? NOT_RECORDED}</div>
          <div className="label">Parser version</div>
        </div>
      </div>

      {detail.topic && (
        <p className="notice">
          Declined as an unsupported topic: <strong>{detail.topic}</strong>. The parser recognised
          this before entity matching could produce a misleading plan — a deliberate decline, not a
          gap in the vocabulary.
        </p>
      )}

      <section className="section">
        <h2>How the parser read it</h2>

        {components ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Component</th>
                  <th scope="col" className="num">Value</th>
                </tr>
              </thead>
              <tbody>
                {COMPONENT_LABEL.map(([key, label]) => (
                  <tr key={key}>
                    <td>{label}</td>
                    <td className="num">
                      {typeof components[key] === 'number'
                        ? (components[key] as number).toFixed(2)
                        : NOT_RECORDED}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No confidence breakdown recorded for this search.</p>
        )}
      </section>

      <section className="section">
        <h2>Entities resolved</h2>
        {entities && entities.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Mention</th>
                  <th scope="col">Resolved to</th>
                  <th scope="col" className="num">Certainty</th>
                </tr>
              </thead>
              <tbody>
                {entities.map((e, i) => (
                  <tr key={`${e.mention}-${i}`}>
                    <td><code>{e.mention}</code></td>
                    <td className="wide">{e.resolvedTo}</td>
                    <td className="num">
                      {e.certainty < 1
                        ? <span className="badge badge-warn">{e.certainty.toFixed(2)}</span>
                        : e.certainty.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No club, venue or player was resolved from this question.</p>
        )}
      </section>

      <section className="section">
        <h2>Unsupported terms</h2>
        {detail.unsupportedTerms && detail.unsupportedTerms.length > 0 ? (
          <p>
            {detail.unsupportedTerms.map((t) => (
              <code key={t} style={{ marginRight: '0.5rem' }}>{t}</code>
            ))}
          </p>
        ) : (
          <p className="muted">The parser understood every meaningful word.</p>
        )}
      </section>

      <section className="section">
        <h2>Query plan</h2>
        {detail.plan ? (
          <>
            <p className="section-note">
              What AFLDB decided the reader meant. Every plan passes <code>validatePlan</code>{' '}
              before it can reach SQL, whatever produced it.
              {detail.planHash && (
                <> Plan hash <code>{detail.planHash.slice(0, 12)}…</code> — searches sharing it
                asked the same question in different words.</>
              )}
            </p>
            <pre className="notice notice-pre"><code>{prettyJson(detail.plan)}</code></pre>
          </>
        ) : (
          <p className="muted">
            No plan was built — the question was declined before one could be assembled.
          </p>
        )}
      </section>

      {session.length > 1 && (
        <section className="section">
          <h2>The rest of this session</h2>
          <p className="section-note">
            Everything this anonymous session asked, oldest first. A rapid rephrasing is the
            strongest signal that an answer missed what the reader meant — though exploring
            naturally looks the same, so read the sequence rather than assuming.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Question</th>
                  <th scope="col">Outcome</th>
                  <th scope="col" className="num">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {session.map((s) => (
                  <tr key={s.id}>
                    <td className="nowrap muted">{timestamp(s.at)}</td>
                    <td className="wide">
                      {s.id === detail.id
                        ? <strong>{s.question}</strong>
                        : <Link href={`/admin/nl-search/${s.id}`}>{s.question}</Link>}
                    </td>
                    <td className="nowrap">{NL_OUTCOME_LABEL[s.outcome] ?? s.outcome}</td>
                    <td className="num">{s.confidence === null ? NOT_RECORDED : s.confidence.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="section">
        <h2>Review</h2>
        <p className="section-note">
          Recorded against this search in <code>nl_search_review</code>. The telemetry row itself is
          never altered — it is append-only by grant, so a review cannot rewrite the evidence it is
          about.
          {detail.reviewedAt && detail.reviewedByEmail && (
            <> Last reviewed by {detail.reviewedByEmail} on {timestamp(detail.reviewedAt)}.</>
          )}
        </p>
        <ReviewForm
          searchLogId={detail.id}
          status={detail.reviewStatus}
          category={detail.reviewCategory}
          notes={detail.reviewNotes}
          fixedInVersion={detail.reviewFixedInVersion}
        />
      </section>
    </>
  );
}
