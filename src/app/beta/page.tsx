import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { BetaGateForm } from '@/app/beta/BetaGateForm';
import { betaGateEnabled, hasBetaAccess } from '@/lib/auth/session';
import { firstValue } from '@/lib/params';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AFLDB Beta',
  description: 'AFLDB is in closed beta.',
  robots: { index: false, follow: false },
};

export default async function BetaGatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Nothing to gate: send the visitor to the site rather than showing a
  // door standing in an open field.
  if (!betaGateEnabled() || await hasBetaAccess()) redirect('/');

  const params = await searchParams;
  const from = firstValue(params.from) ?? '/';

  return (
    <div style={{ maxWidth: '30rem', margin: '4rem auto', textAlign: 'center' }}>
      <div className="page-header">
        <h1>AFLDB</h1>
        <p className="subtitle">
          Every player, every game, since 1897 — currently in closed beta.
        </p>
      </div>

      <BetaGateForm from={from} />

      <p className="section-note" style={{ marginTop: '2rem' }}>
        No invitation? AFLDB opens publicly once the record is verified.
      </p>
    </div>
  );
}
