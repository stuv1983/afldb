import type { MetadataRoute } from 'next';

import { indexingEnabled } from '@/lib/indexing';

const baseUrl = process.env.AFLDB_BASE_URL ?? 'http://localhost:3100';

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
        // Search result pages are infinite and low-value to index.
        disallow: ['/api/', '/search'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
