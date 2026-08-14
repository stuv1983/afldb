import { generateSitemaps } from '@/app/sitemap';

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

const baseUrl = process.env.AFLDB_BASE_URL ?? 'http://localhost:3100';

export async function GET() {
  const segments = await generateSitemaps();
  const lastModified = new Date().toISOString();

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${segments
  .map(
    (segment) =>
      `  <sitemap><loc>${baseUrl}/sitemap/${segment.id}.xml</loc>`
      + `<lastmod>${lastModified}</lastmod></sitemap>`,
  )
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
