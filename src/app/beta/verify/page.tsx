import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { VerifyForm } from '@/app/beta/verify/VerifyForm';
import { firstValue } from '@/lib/params';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Confirm sign-in | AFLDB Beta',
  robots: { index: false, follow: false },
  // The URL carries a live credential; send it nowhere.
  referrer: 'no-referrer',
};

/**
 * Magic-link landing (AFLDB-ISSUE-280). A GET reads no table and spends
 * nothing: a mail scanner's pre-fetch must leave the token usable. The token
 * is burned by the form's POST (`confirmMagicLink`).
 */
export default async function BetaVerifyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const token = firstValue((await searchParams).token) ?? '';

  if (token.length < 20 || token.length > 100) {
    redirect('/beta');
  }

  return (
    <div className="gate">
      <div className="page-header">
        <h1>Confirm sign-in</h1>
        <p className="subtitle">
          Press the button to sign in to the AFLDB beta. This link works once and
          expires 30 minutes after it was sent.
        </p>
        <div className="rule" />
      </div>

      <VerifyForm token={token} />
    </div>
  );
}
