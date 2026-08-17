/**
 * Analytics-storage consent.
 *
 * AFLDB sets exactly two kinds of client-side storage, and they are not
 * in the same category:
 *
 *   STRICTLY NECESSARY — the admin session cookie (lib/auth/tokens.ts)
 *   and the beta-access cookie. Without them the thing the visitor asked
 *   for (being logged in, being let past the gate) cannot happen at all.
 *   These are not gated here, and asking permission for them would be
 *   asking permission to work.
 *
 *   ANALYTICS — `nl_sid` (lib/nl-session.ts), which correlates several
 *   searches in one visit so the telemetry can spot a reformulation. It
 *   is anonymous, expires in 30 minutes and never leaves this site, but
 *   the site works perfectly without it and nobody visits AFLDB in order
 *   to be measured. So it is gated, and its absence degrades telemetry
 *   rather than the reader's experience.
 *
 * The consent choice itself is stored in a cookie, which sounds circular
 * and is not: a record of a preference the visitor explicitly expressed
 * is strictly necessary to honour that preference, and the alternative
 * is asking again on every page.
 *
 * DB-free and free of `server-only` deliberately -- middleware, the
 * server layout and the client banner all need these three constants,
 * and three copies of a cookie name is how they drift.
 */

export const CONSENT_COOKIE = 'afldb_consent';

/** A year: long enough not to nag, short enough that consent is periodically re-confirmed. */
export const CONSENT_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export type ConsentChoice = 'accepted' | 'declined';

export function isConsentChoice(value: string | undefined | null): value is ConsentChoice {
  return value === 'accepted' || value === 'declined';
}

/**
 * Whether analytics storage may be written. Deliberately fail-closed:
 * anything other than an explicit "accepted" -- no cookie, a malformed
 * value, a visitor who has not answered yet -- means no. Silence is not
 * consent, and a bug in this file must not become a tracking cookie.
 */
export function analyticsAllowed(value: string | undefined | null): boolean {
  return value === 'accepted';
}
