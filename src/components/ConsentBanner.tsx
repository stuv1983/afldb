import Link from 'next/link';
import { cookies } from 'next/headers';

import { setConsent } from '@/app/consent-action';
import { CONSENT_COOKIE, isConsentChoice } from '@/lib/consent';

/**
 * The analytics-storage banner.
 *
 * A server component with two plain form buttons rather than a client
 * component with an onClick: the whole point of this banner is that the
 * cookie is not written until a choice is made, and a form post is the
 * one mechanism that cannot be defeated by scripting being blocked,
 * broken, or slow to hydrate. It also means nothing here ships to the
 * browser.
 *
 * It renders only while the visitor has not answered. Both buttons are
 * equally weighted and equally easy to press -- a banner where declining
 * is harder than accepting is not collecting consent, it is collecting a
 * click.
 *
 * "Accept" and "Decline" both dismiss it permanently, because both are
 * answers; there is deliberately no close-without-choosing control that
 * would leave the question to be asked again on the next page.
 */
export async function ConsentBanner() {
  const choice = (await cookies()).get(CONSENT_COOKIE)?.value;
  if (isConsentChoice(choice)) return null;

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
          <form action={setConsent}>
            <input type="hidden" name="choice" value="accepted" />
            <button type="submit">Accept</button>
          </form>
          <form action={setConsent}>
            <input type="hidden" name="choice" value="declined" />
            <button type="submit">Decline</button>
          </form>
        </div>
      </div>
    </aside>
  );
}
