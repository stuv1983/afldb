import { generateSitemaps } from '@/app/sitemap';
import { indexingEnabled } from '@/lib/indexing';
import { siteUrl } from '@/lib/seo';

/**
 * Sitemap index.
 *
 * generateSitemaps() publishes the segments at /sitemap/<id>.xml but does
 * not publish anything at /sitemap.xml. robots.txt advertises that URL and
 * search engines fetch it, so without this route the segments exist but
 * nothing points at them. This emits the index that ties them together,
 * built from the same segment list the segments themselves come from.
 */
export const revalidate = 86400;

const baseUrl = siteUrl();

export async function GET() {
  // A deployment that must not be indexed publishes no map of itself. 404
  // rather than an empty index: an empty `<sitemapindex>` is a valid
  // document that says "this site has no pages", which is a claim, whereas
  // a 404 says the file is not here, which is the truth.
  if (!indexingEnabled()) {
    return new Response('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  const segments = await generateSitemaps();

  // NO <lastmod>. It used to carry `new Date()` — the moment the index was
  // rendered, which is a fact about this server and not about the content.
  // A timestamp that advances every time the cache expires teaches a crawler
  // that the site changed when it did not, and the protocol is explicit that
  // an inaccurate lastmod is worse than an absent one. AFLDB has no per-URL
  // modification time to publish (imports do not stamp rows), so it publishes
  // none.
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${segments
  .map((segment) => `  <sitemap><loc>${baseUrl}/sitemap/${segment.id}.xml</loc></sitemap>`)
  .join('\n')}
</sitemapindex>
`;

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=0, s-maxage=86400',
    },
  });
}
