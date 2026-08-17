'use server';

import { cookies } from 'next/headers';

import {
  CONSENT_COOKIE, CONSENT_MAX_AGE_SECONDS, isConsentChoice,
} from '@/lib/consent';
import { secureCookies } from '@/lib/cookie-security';
import { NL_SESSION_COOKIE } from '@/lib/nl-session';

/**
 * Records the visitor's answer to the analytics-storage banner.
 *
 * Declining does not merely stop future cookies: it DELETES the nl_sid
 * cookie if one is already there. A visitor could have accepted earlier
 * and changed their mind, and leaving the old cookie in place until it
 * expired would make "decline" mean "decline eventually", which is not
 * what the button says.
 *
 * The consent cookie itself is not httpOnly, because the banner reads it
 * in the browser to decide whether to show itself (see ConsentBanner);
 * there is nothing in it to steal, and it is SameSite=Lax like everything
 * else here. It IS Secure wherever the session cookies are, though: this
 * cookie decides whether nl_sid gets minted, so a value an attacker on a
 * plain-HTTP hop could inject is a way to turn analytics storage on for a
 * visitor who never agreed to it.
 */
export async function setConsent(formData: FormData): Promise<void> {
  const choice = String(formData.get('choice') ?? '');
  if (!isConsentChoice(choice)) return;

  const jar = await cookies();
  jar.set(CONSENT_COOKIE, choice, {
    httpOnly: false,
    secure: secureCookies(),
    sameSite: 'lax',
    maxAge: CONSENT_MAX_AGE_SECONDS,
    path: '/',
  });

  // Path-qualified: the cookie was set with path '/', and a delete whose
  // path does not match removes nothing.
  if (choice === 'declined') jar.delete({ name: NL_SESSION_COOKIE, path: '/' });
}
