/**
 * Whether this deployment may be indexed by search engines.
 *
 * Deliberately separate from `AFLDB_ENV`, which carries transport security
 * (Secure cookies, HSTS, the strict CSP). During a cutover the two pull in
 * opposite directions: a host on public HTTPS needs the security posture from
 * its first request, while indexing must stay off until the site is publicly
 * correct. One flag could not express that.
 *
 * Fails closed — anything but an explicit `AFLDB_INDEXING=on` means no.
 * Forgetting this flag costs a day of search visibility; conflating it with
 * the security flag cost `Secure` on live admin cookies.
 */
export function indexingEnabled(): boolean {
  if (process.env.AFLDB_INDEXING !== 'on') return false;

  // Behind the beta gate a crawler reaches only the door, so indexing spends
  // crawl budget to publish nothing. Decided here rather than in robots.ts so
  // that robots.txt and the page metadata cannot disagree.
  return process.env.AFLDB_BETA_GATE !== 'on';
}
