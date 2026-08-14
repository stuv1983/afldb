import type { MetadataRoute } from 'next';

const baseUrl = process.env.AFLDB_BASE_URL ?? 'http://localhost:3100';
const isProduction = process.env.AFLDB_ENV === 'production';

export default function robots(): MetadataRoute.Robots {
  // Development and staging deployments must never be indexed. Indexing
  // is enabled only by setting AFLDB_ENV=production at the deliberate
  // cutover, so an exposed dev server cannot leak into search results.
  if (!isProduction) {
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
