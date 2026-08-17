/**
 * Whether cookies this site sets may carry the `Secure` attribute.
 *
 * Keyed on AFLDB_ENV, which is the TRANSPORT SECURITY flag and nothing else:
 * this, HSTS and the CSP that drops 'unsafe-eval' (next.config.ts). The dev
 * server serves plain HTTP on the LAN, where a Secure cookie would silently
 * fail to set; deriving this from AFLDB_BASE_URL instead let a production
 * deploy that set AFLDB_ENV but fumbled AFLDB_BASE_URL ship non-Secure
 * session cookies while looking fine.
 *
 * Indexing used to key off this same flag, which was a live bug rather than
 * an untidiness: holding AFLDB_ENV at `development` to keep a pre-cutover host
 * out of search results also stripped Secure off its session cookies. Indexing
 * moved to AFLDB_INDEXING (src/lib/indexing.ts) so that a host on public HTTPS
 * can have the full security posture while still being invisible to crawlers.
 * Any host reachable over HTTPS sets AFLDB_ENV=production, cutover or not.
 *
 * DB-free, edge-safe and free of `server-only` deliberately: middleware mints
 * the nl_sid cookie, a server action writes the consent cookie and
 * lib/auth/session.ts writes the session cookies. EVERY cookie this site sets
 * has to agree about transport, and it only agrees if there is one predicate.
 * Two of these cookies shipped without `secure` precisely because the rule
 * lived inside the session module where nothing else could reach it.
 */
export function secureCookies(): boolean {
  return process.env.AFLDB_ENV === 'production';
}
