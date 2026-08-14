import { NextResponse } from 'next/server';

import { authSql } from '@/db/authClient';
import { sha256Hex } from '@/lib/auth/crypto';
import { audit, grantBetaAccess } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/**
 * Magic-link landing. Single use: the token is burned in the same
 * statement that accepts it, so a forwarded or replayed link admits
 * nobody.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') ?? '';

  if (token.length < 20 || token.length > 100) {
    return NextResponse.redirect(new URL('/beta', url));
  }

  const [row] = await authSql<{ email: string }[]>`
    UPDATE beta_login_tokens
       SET used_at = now()
     WHERE token_hash = ${sha256Hex(token)}
       AND used_at IS NULL
       AND expires_at > now()
    RETURNING email
  `;

  if (!row) {
    // Expired, used or never issued: back to the gate, which explains
    // nothing — the distinction is only useful to someone probing.
    return NextResponse.redirect(new URL('/beta', url));
  }

  // The email must STILL be allowlisted: revocation between the link
  // being issued and clicked must win.
  const [allowed] = await authSql<{ id: number }[]>`
    SELECT id FROM beta_allowed_emails
     WHERE email = ${row.email} AND revoked_at IS NULL
  `;
  if (!allowed) {
    await audit('beta.magic_link_revoked_email', { email: row.email }, { label: row.email });
    return NextResponse.redirect(new URL('/beta', url));
  }

  await audit('beta.magic_link_verified', { email: row.email }, { label: row.email });
  await grantBetaAccess(`email:${row.email}`);
  return NextResponse.redirect(new URL('/', url));
}
