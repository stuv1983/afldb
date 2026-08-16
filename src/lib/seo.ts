import type { Metadata } from 'next';

/**
 * One place that decides what a page tells a search engine.
 *
 * Before this module every route hand-assembled its own `Metadata` object,
 * which is why the site had three quiet inconsistencies that no single page
 * looked wrong on its own for:
 *
 *  1. `og:url` was missing everywhere. Next only emits it when `openGraph.url`
 *     is set explicitly (see `resolveOpenGraph` — `resolved.url` is `null`
 *     otherwise), and no page set it, so a shared link carried no canonical
 *     identity of its own.
 *  2. Next REPLACES `openGraph` wholesale down the segment chain rather than
 *     merging it, so the one page that set `openGraph` (the player profile)
 *     silently dropped the `siteName` and `locale` the root layout declares.
 *  3. A filtered or sorted list state was indexable and canonicalised to the
 *     bare path, which is the one canonical mistake Google actually punishes:
 *     pointing materially different content at a single URL.
 *
 * `pageMetadata` fixes all three by construction, so a new route gets them
 * right by using it rather than by remembering them.
 */

const DEFAULT_BASE_URL = 'http://localhost:3100';

/**
 * The public origin, with any trailing slash removed.
 *
 * Deliberately NOT throwing when unset: this is read at module scope by the
 * root layout, and a layout that can throw is a site with no error page
 * either. The consequence of it being wrong — canonicals pointing at
 * localhost — is caught by `siteUrlProblem` below, which the release gate
 * asserts on rather than the request path.
 */
export function siteUrl(): string {
  const raw = process.env.AFLDB_BASE_URL?.trim();
  if (!raw) return DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, '');
}

/**
 * Why this base URL is unfit to publish canonical links against, or null.
 *
 * A canonical tag is the one piece of metadata that is worse wrong than
 * absent: it tells Google to fold this page into a URL that, if this check
 * fails, nobody can reach. The failure mode is silent and total — the whole
 * site canonicalises to `http://localhost:3100` and none of it is indexed —
 * so it is asserted at release time rather than discovered in Search Console
 * weeks later.
 *
 * Only applied when indexing is actually on: a development host legitimately
 * runs on plain HTTP against a LAN address.
 */
export function siteUrlProblem(value = process.env.AFLDB_BASE_URL): string | null {
  const raw = value?.trim();
  if (!raw) return 'AFLDB_BASE_URL is not set, so canonical links would point at localhost.';

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return `AFLDB_BASE_URL is not a valid absolute URL: ${JSON.stringify(raw)}.`;
  }

  if (url.protocol !== 'https:') {
    return `AFLDB_BASE_URL must use https for an indexed deployment, not ${url.protocol}.`;
  }
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    return 'AFLDB_BASE_URL points at localhost, which no crawler can resolve.';
  }
  if (url.search || url.hash) {
    return 'AFLDB_BASE_URL must be a bare origin, with no query string or fragment.';
  }
  return null;
}

/** An absolute URL for `path`, which must already be root-relative. */
export function absoluteUrl(path: string): string {
  return path === '/' ? `${siteUrl()}/` : `${siteUrl()}${path}`;
}

export type PageMetadataInput = {
  /** Without the " | AFLDB" suffix; the root layout's template adds it. */
  title: string;
  description: string;
  /** Root-relative canonical path. Never a filtered or paged variant. */
  path: string;
  ogType?: 'website' | 'article' | 'profile';
  /**
   * True for a page whose content is a transient view of another page — a
   * filtered list, a sorted list, page 2 — or an interactive tool with no
   * standalone value in search. Always `follow`: the links out of these
   * pages are how a crawler reaches the entities behind them.
   */
  noindex?: boolean;
};

/**
 * Title, description, canonical, Open Graph and robots for one page.
 *
 * `robots` is only ever set to a NEGATIVE. Setting `index: true` here would
 * override the root layout's gate (src/lib/indexing.ts) and publish a beta
 * or development deployment one page at a time, which is precisely the class
 * of accident that gate exists to prevent.
 */
export function pageMetadata(input: PageMetadataInput): Metadata {
  const { title, description, path, ogType = 'website', noindex = false } = input;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      // `absolute` bypasses the root layout's "%s | AFLDB" template, which
      // would otherwise apply to og:title as well and produce it twice on
      // any page that spells the suffix out.
      title: { absolute: `${title} | AFLDB` },
      description,
      url: path,
      type: ogType,
      // Repeated rather than inherited: Next replaces `openGraph` wholesale
      // between segments, so anything not named here is lost.
      siteName: 'AFLDB',
      locale: 'en_AU',
    },
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
  };
}

/**
 * Metadata for a URL that resolves to nothing.
 *
 * The route still answers 404 through `notFound()`; this stops the title bar
 * reading "AFLDB" on the way there, and stops a soft-404 — a 200 with an
 * apologetic body, which nothing here serves — from ever being indexable if
 * one is introduced.
 */
export function notFoundMetadata(what: string): Metadata {
  return {
    title: `${what} not found`,
    robots: { index: false, follow: false },
  };
}

/**
 * Query parameters that turn a list page into a view of itself.
 *
 * Presence of any one of these is what makes a list state `noindex, follow`.
 * The set is deliberately open-ended at the tail — every range filter on
 * every surface is `<field>_min` / `<field>_max` — because the alternative
 * is a list that has to be extended in two places each time a filter is
 * added, and would silently stop matching the day someone forgot.
 */
const VIEW_STATE_KEYS = new Set(['page', 'sort', 'q', 'name', 'club', 'season', 'scope']);

export function isFilteredView(
  params: Record<string, string | string[] | undefined>,
): boolean {
  return Object.entries(params).some(([key, value]) => {
    const present = Array.isArray(value)
      ? value.some((v) => v.trim() !== '')
      : (value ?? '').trim() !== '';
    if (!present) return false;
    return VIEW_STATE_KEYS.has(key) || key.endsWith('_min') || key.endsWith('_max');
  });
}
