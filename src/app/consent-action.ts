'use server';

import { cookies } from 'next/headers';

import {
  CONSENT_COOKIE, CONSENT_MAX_AGE_SECONDS, isConsentChoice,
} from '@/lib/consent';
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
 * The consent cookie itself is not httpOnly, so the banner can read it
 * without a round trip; there is nothing in it to steal, and it is
 * SameSite=Lax like everything else here.
 */
export async function setConsent(formData: FormData): Promise<void> {
  const choice = String(formData.get('choice') ?? '');
  if (!isConsentChoice(choice)) return;

  const jar = await cookies();
  jar.set(CONSENT_COOKIE, choice, {
    httpOnly: false,
    sameSite: 'lax',
    maxAge: CONSENT_MAX_AGE_SECONDS,
    path: '/',
  });

  if (choice === 'declined') jar.delete(NL_SESSION_COOKIE);
}
