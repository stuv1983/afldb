/**
 * Whether this deployment may be indexed by search engines.
 *
 * DELIBERATELY SEPARATE FROM `AFLDB_ENV`, and that separation is a security
 * fix rather than a tidy-up.
 *
 * `AFLDB_ENV=production` turns on three transport-security behaviours —
 * Secure session cookies (src/lib/auth/session.ts), HSTS and the CSP that
 * drops 'unsafe-eval' (next.config.ts) — and it used to decide indexing as
 * well. One flag, two unrelated decisions, and during a cutover they pull in
 * opposite directions: a host answering on public HTTPS needs the security
 * posture from its very first request, while indexing must stay off until the
 * site is publicly correct.
 *
 * The consequence was live rather than theoretical.
 * tools/maintenance/00_install_postgres_prod.sh wrote `AFLDB_ENV=development`
 * precisely so the droplet would not be indexed before cutover, which also
 * meant beta.afldb.com served real admin sessions over HTTPS with no `Secure`
 * attribute on the cookie — recoverable by anyone able to provoke one plain
 * http:// request to that host. deploy/Caddyfile.production had already
 * written down the resolution (production posture at the app, noindex imposed
 * at the proxy); the flag simply could not express it.
 *
 * So indexing has its own flag now, and it FAILS CLOSED: anything other than
 * an explicit `AFLDB_INDEXING=on` means "do not index". The asymmetry is the
 * point — forgetting this flag costs search visibility, which is recoverable
 * in a day, while forgetting the old one cost cookie security, which is not
 * recoverable at all once a session has been taken.
 */
export function indexingEnabled(): boolean {
  if (process.env.AFLDB_INDEXING !== 'on') return false;

  // A second, independent no. Behind the beta gate a crawler can only reach
  // the door, so indexing a gated site publishes nothing but the gate — and
  // spends the crawl budget doing it. This used to live in robots.ts alone,
  // which left the page metadata in src/app/layout.tsx saying `index: true`
  // on a site whose own robots.txt said `Disallow: /`. One definition, so
  // the two cannot disagree again.
  return process.env.AFLDB_BETA_GATE !== 'on';
}
