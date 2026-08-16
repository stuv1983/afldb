import type { MetadataRoute } from 'next';

import { indexingEnabled } from '@/lib/indexing';
import { siteUrl } from '@/lib/seo';

const baseUrl = siteUrl();

export default function robots(): MetadataRoute.Robots {
  // Development and staging deployments must never be indexed, and neither
  // must a gated beta. Both questions are answered by `indexingEnabled()`,
  // which fails closed and is keyed on AFLDB_INDEXING rather than on the
  // AFLDB_ENV flag that also decides cookie and transport security — see the
  // header of src/lib/indexing.ts for why those had to come apart.
  if (!indexingEnabled()) {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          // Not content. `/api/` is machine endpoints (health, autocomplete,
          // the early-access form); `/admin` and `/beta` are behind
          // authentication and a gate and would only ever crawl to a login
          // form. These carry `noindex` in their own metadata as well — the
          // disallow saves the crawl rather than being the control.
          '/api/',
          '/admin',
          '/beta',
          // Every query is a page, so this is an unbounded space with no
          // stable content behind any single URL. The page itself is
          // `noindex, follow`; this stops the crawl reaching it at all.
          '/search',
          // A solver whose answers depend entirely on a board posted to it.
          '/grid-solver',
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
