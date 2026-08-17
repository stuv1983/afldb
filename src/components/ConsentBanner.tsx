'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { setConsent } from '@/app/consent-action';
import { isConsentChoice, readConsentCookie } from '@/lib/consent';

/**
 * The analytics-storage banner.
 *
 * WHY THIS IS A CLIENT COMPONENT, having started as a server one: it
 * lives in the root layout, so the cookie read that decides whether to
 * show it was a cookie read in the root layout -- which makes every route
 * in the site dynamic, prerendered home page and 60-odd ISR club, match
 * and season pages included. A consent banner is not worth turning the
 * whole site into per-request rendering, and it does not have to be: the
 * consent cookie is deliberately not httpOnly (see consent-action.ts), so
 * the browser can answer the same question itself.
 *
 * The submission is still a <form> posting to a server action rather than
 * an onClick fetch: the cookie is written by the server, once, in response
 * to a real form post.
 *
 * The banner is absent from the server-rendered HTML and appears on
 * mount, which is the fail-closed direction: a visitor with no scripting
 * sees no banner, records no choice, and gets no analytics cookie, since
 * middleware mints nl_sid only on an explicit "accepted".
 *
 * It renders only while the visitor has not answered. Both buttons are
 * equally weighted and equally easy to press -- a banner where declining
 * is harder than accepting is not collecting consent, it is collecting a
 * click.
 *
 * "Accept" and "Decline" both dismiss it permanently, because both are
 * answers; there is deliberately no close-without-choosing control that
 * would leave the question to be asked again on the next page. Dismissal
 * is local state rather than a re-read of the cookie, because a server
 * action's re-render reconciles against this same markup and would leave
 * a banner the reader has already answered sitting on screen.
 */
export function ConsentBanner() {
  const [answered, setAnswered] = useState(true);

  useEffect(() => {
    setAnswered(isConsentChoice(readConsentCookie()));
  }, []);

  // Awaited, not raced: the banner goes away because the choice was
  // recorded, so a write that fails leaves the question on screen instead
  // of pretending to have answered it. Hiding first and posting after
  // would also unmount the form mid-submission.
  async function record(formData: FormData) {
    await setConsent(formData);
    setAnswered(true);
  }

  if (answered) return null;

  return (
    <aside className="consent-banner" role="region" aria-label="Cookies">
      <div className="container consent-banner-inner">
        <p>
          AFLDB would like to set one anonymous cookie that links the searches you make in a
          single visit, so we can see where the search engine misreads a question. It expires
          after 30 minutes, is never shared, and identifies nobody. The site works exactly the
          same if you decline.{' '}
          <Link href="/privacy">What we store</Link>
        </p>
        <div className="consent-banner-actions">
          <form action={record}>
            <input type="hidden" name="choice" value="accepted" />
            <button type="submit">Accept</button>
          </form>
          <form action={record}>
            <input type="hidden" name="choice" value="declined" />
            <button type="submit">Decline</button>
          </form>
        </div>
      </div>
    </aside>
  );
}
