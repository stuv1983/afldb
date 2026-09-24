import type { Metadata } from 'next';
import Link from 'next/link';

import { listAflApiUnresolvedProviders } from '@/db/queries/afl-api-player-links';
import { requireCapability } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'AFL API providers', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const STATE_LABEL: Record<string, string> = {
  U1: 'unresolved',
  'L-I': 'linked (importer) — awaiting settle',
  'L-H': 'linked (human) — awaiting settle',
  X: 'anomalous',
};

/**
 * AFLDB-ISSUE-235 §7.3 — the afl_api provider queue. Every provider with at
 * least one pending `unresolved_identity` candidate: U1 (actionable) and
 * "awaiting settle" L-I/L-H (a trusted row exists, the next settle will
 * catch up). No bulk, no suggestion and no confirmed-unlinked control here
 * (D9, D12) — that vocabulary belongs to the seven honours tables only.
 */
export default async function AflApiPlayerLinksPage() {
  await requireCapability('data.playerLinks');
  const providers = await listAflApiUnresolvedProviders();

  return (
    <>
      <div className="page-header">
        <h1>AFL API providers</h1>
        <p className="subtitle">
          <Link href="/admin/player-links">← Player links</Link>
        </p>
      </div>

      <section className="section">
        <p className="section-note">
          A provider here is an <code>afl_api</code> player id the bridge could not link
          automatically. Every link is evidence-derived — the candidate list on each
          provider&rsquo;s page is exactly what the bridge&rsquo;s own rule produces, never a
          name-based suggestion. There is no confirmed-unlinked, bulk or suggestion path for
          <code>afl_api</code> providers: the only correct end state is linked, once the
          player is registered or evidenced.
        </p>
      </section>

      {providers.length === 0 ? (
        <section className="section">
          <p>No unresolved <code>afl_api</code> providers.</p>
        </section>
      ) : (
        <section className="section">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>State</th>
                  <th>Pending rows</th>
                  <th>Seasons</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => (
                  <tr key={p.providerId}>
                    <td>
                      <Link href={`/admin/player-links/afl-api/${p.providerId}`}>{p.providerId}</Link>
                    </td>
                    <td>
                      <span className={p.state === 'X' ? 'badge badge-warn' : 'badge'}>
                        {STATE_LABEL[p.state] ?? p.state}
                      </span>
                    </td>
                    <td>{p.pendingCount}</td>
                    <td>{p.seasons.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
