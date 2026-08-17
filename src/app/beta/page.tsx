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
    <div className="gate">
      <div className="page-header">
        {/* The masthead directly above already says AFLDB, so this heading
            is free to say what the door is for instead of repeating it. */}
        <h1>Closed beta</h1>
        <p className="subtitle">
          Every player, every game, since 1897. Enter the email your invitation
          was sent to and we’ll send you a sign-in link.
        </p>
        <div className="rule" />
      </div>

      <BetaGateForm from={from} />

      <p className="footnote">
        No invitation? AFLDB opens publicly once the record is verified.
      </p>
    </div>
  );
}
