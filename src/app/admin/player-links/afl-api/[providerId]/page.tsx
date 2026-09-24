import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AflApiAdjudicationForm } from '@/app/admin/player-links/afl-api/AflApiAdjudicationForm';
import {
  readAflApiAdjudicationHistory,
  readAflApiProviderEvidence,
} from '@/db/queries/afl-api-player-links';
import {
  AFL_API_PROVIDER_ID_RE,
  adjudicationFingerprint,
} from '@/lib/acquisition/afl-api-adjudication';
import { requireCapability } from '@/lib/auth/session';
import { formatDate } from '@/lib/format';

export const metadata: Metadata = { title: 'AFL API provider', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * AFLDB-ISSUE-235 §6 — the evidence detail page. Every block is server-side
 * and read-only; the form below it is the only write surface, and it is a
 * dedicated component (R7), not the honours `ResolveControls`.
 */
export default async function AflApiProviderDetailPage(
  props: { params: Promise<{ providerId: string }> },
) {
  await requireCapability('data.playerLinks');
  const { providerId } = await props.params;
  if (!AFL_API_PROVIDER_ID_RE.test(providerId)) notFound();

  const evidence = await readAflApiProviderEvidence(providerId);
  if (evidence === null) notFound(); // D5: no pending evidence, not actionable, not listed

  const history = await readAflApiAdjudicationHistory(providerId);

  const isU1 = evidence.state === 'U1';
  const isLH = evidence.state === 'L-H';
  const isLI = evidence.state === 'L-I';
  const isX = evidence.state === 'X';

  // Two DIFFERENT fingerprints, matching linkAflApiProvider()/revokeAflApiLink() exactly:
  //
  // - link: provider-side facts ONLY. No admin has picked a player yet at render time, so
  //   chosenPlayerId/chosenPlayerExistingRows are fixed to the same sentinel (0/[]) the
  //   server uses -- the chosen player's collision/stable-identity facts are re-verified
  //   FRESH and UNCONDITIONALLY server-side regardless (D6-2/D6-3), never trusted from a
  //   stale fingerprint.
  // - revoke: the "chosen player" IS known here -- the already-linked player -- so this
  //   fingerprint includes their real facts. OD-1 guarantees they hold at most this ONE
  //   afl_api row, so `evidence.existing` itself IS `chosenPlayerExistingRows`.
  const linkFingerprint = adjudicationFingerprint({
    providerId,
    existing: evidence.existing,
    pendingCandidates: evidence.pendingCandidates,
    latestAdjudicationId: evidence.latestAdjudicationId,
    chosenPlayerId: 0,
    chosenPlayerExistingRows: [],
  });
  const revokeFingerprint = evidence.existing === null ? null : adjudicationFingerprint({
    providerId,
    existing: evidence.existing,
    pendingCandidates: evidence.pendingCandidates,
    latestAdjudicationId: evidence.latestAdjudicationId,
    chosenPlayerId: evidence.existing.playerId ?? 0,
    chosenPlayerExistingRows: [{
      id: evidence.existing.id, status: evidence.existing.status, matchMethod: evidence.existing.matchMethod,
    }],
  });

  return (
    <>
      <div className="page-header">
        <h1>{providerId}</h1>
        <p className="subtitle">
          <Link href="/admin/player-links/afl-api">← AFL API providers</Link>
        </p>
      </div>

      {isX && (
        <section className="section">
          <p className="badge badge-warn">
            This provider is in an anomalous state and cannot be actioned from this surface.
          </p>
        </section>
      )}

      <section className="section">
        <h2>Provider facts</h2>
        <dl>
          <dt>Observed name</dt>
          <dd>
            {evidence.observedGivenName ?? '—'} {evidence.observedSurname ?? ''}
            <span className="badge" style={{ marginLeft: '0.5rem' }}>display-only</span>
          </dd>
          <dt>Seasons</dt>
          <dd>{evidence.seasons.join(', ') || '—'}</dd>
          <dt>Jumper number(s)</dt>
          <dd>{evidence.jumperNumbers.join(', ') || '—'}</dd>
          <dt>Pending candidate rows</dt>
          <dd>{evidence.pendingCandidates.length}</dd>
        </dl>
      </section>

      <section className="section">
        <h2>Per observed match</h2>
        <table className="table-wrap">
          <thead>
            <tr><th>Match</th><th>Season</th><th>Canonical match</th></tr>
          </thead>
          <tbody>
            {evidence.matches.map((m) => (
              <tr key={m.matchKey}>
                <td>{m.matchKey}</td>
                <td>{m.season}</td>
                <td>{m.canonicalMatchId === null ? 'unresolved' : `#${m.canonicalMatchId}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="section">
        <h2>Bridge-rule recomputation</h2>
        <p className="section-note">
          This is the bridge&rsquo;s own rule applied to this database&rsquo;s current data. It
          is evidence, not a decision; rule (b) is evaluated only within these matches.
        </p>
        {evidence.classification ? (
          <>
            <p>
              Disposition: <strong>{evidence.classification.disposition}</strong>
              {evidence.classification.reason && <> — {evidence.classification.reason}</>}
            </p>
            <table className="table-wrap">
              <thead><tr><th>Match</th><th>Candidate player</th><th>Agreeing stats</th></tr></thead>
              <tbody>
                {evidence.classification.matches.map((hit) => (
                  <tr key={`${hit.providerMatchId}-${hit.canonicalPlayerId}`}>
                    <td>{hit.providerMatchId}</td>
                    <td>{hit.canonicalPlayerId}</td>
                    <td>{hit.agreeingStatCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p>No classification could be computed for this provider yet.</p>
        )}
      </section>

      <section className="section">
        <h2>Candidate players</h2>
        {evidence.candidatePlayerIds.length === 0 && <p>No evidence-derived candidates.</p>}
        <ul>
          {evidence.candidatePlayerIds.map((id) => {
            const summary = evidence.playerSummaries.get(id);
            const stable = evidence.playerStableIdentity.get(id);
            return (
              <li key={id}>
                {summary?.displayName ?? `Player #${id}`}
                {summary && ` (${summary.clubs.join(', ')}, ${summary.games ?? '?'} games)`}
                {stable === null && (
                  <span className="badge badge-warn" style={{ marginLeft: '0.5rem' }}>
                    no stable identity — cannot be linked
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {evidence.openContradictions.length > 0 && (
        <section className="section">
          <h2>Open contradictions</h2>
          <ul>
            {evidence.openContradictions.map((c) => (
              <li key={c.id}>{c.description}</li>
            ))}
          </ul>
        </section>
      )}

      {isLI && (
        <section className="section">
          <p>
            This provider was already linked by the importer.
            <span className="badge" style={{ marginLeft: '0.5rem' }}>linked by importer</span>
          </p>
          <p className="section-note">
            Correcting an existing importer link is out of scope for this surface.
          </p>
        </section>
      )}

      {isLH && (
        <section className="section">
          <p>
            Linked to player #{evidence.existing?.playerId}.
            <span className="badge" style={{ marginLeft: '0.5rem' }}>
              linked{evidence.pendingCandidates.length > 0 ? ' — awaiting settle' : ''}
            </span>
          </p>
        </section>
      )}

      {history.length > 0 && (
        <section className="section">
          <h2>Adjudication history</h2>
          <table className="table-wrap">
            <thead><tr><th>When</th><th>Action</th><th>Player</th><th>Admin</th><th>Note</th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>{formatDate(h.createdAt)}</td>
                  <td>{h.action}</td>
                  <td>{h.playerId}</td>
                  <td>{h.adminUserId}</td>
                  <td>{h.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="section">
        <h2>Decision</h2>
        {isX
          ? <p>No action is available.</p>
          : (
            <AflApiAdjudicationForm
              providerId={providerId}
              linkFingerprint={linkFingerprint}
              revokeFingerprint={revokeFingerprint}
              canLink={isU1}
              canRevoke={isLH}
              observedSurnameForDisplay={evidence.observedSurname}
            />
          )}
      </section>
    </>
  );
}
