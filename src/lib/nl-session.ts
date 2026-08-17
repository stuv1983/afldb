/**
 * The anonymous cookie that correlates natural-language searches within
 * one browsing session, so nl_search_log can link an immediate
 * reformulation ("dusty most goals carlton" -> "dusty total goals
 * against carlton") back to the search it followed. Minted by
 * middleware.ts (the only place allowed to set cookies on a Server
 * Component render), read by search/page.tsx, written into
 * nl_search_log by db/queries/nl/log.ts.
 *
 * Deliberately NOT part of the auth/beta cookie family in
 * lib/auth/tokens.ts: it is unsigned, carries no claim, and grants no
 * access -- a bare random id, unrelated to account identity, IP address
 * or anything else that could identify a reader.
 */
export const NL_SESSION_COOKIE = 'nl_sid';

/** 30 minutes: long enough to catch a reformulation, short enough that this never becomes a durable visitor identifier. */
export const NL_SESSION_MAX_AGE_SECONDS = 30 * 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A cookie value is client-supplied input; validate before it reaches a `::uuid` cast. */
export function isValidNlSessionId(value: string | undefined | null): value is string {
  return !!value && UUID_RE.test(value);
}
