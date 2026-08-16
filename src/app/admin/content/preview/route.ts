import { NextResponse } from 'next/server';

import { getApexContent } from '@/db/queries/site-content';
import { getSiteTotals } from '@/db/queries/overview';
import { getSiteSettingsForAdmin } from '@/db/queries/site-settings';
import { renderApexPage } from '@/lib/apex-html';
import { requireSuperAdmin } from '@/lib/auth/session';
import { APEX_METRICS, type ApexTotals } from '@/lib/site-content';

export const dynamic = 'force-dynamic';

/**
 * The apex page as it would be published, rendered from what is saved.
 *
 * The same `renderApexPage` the publisher calls, over the same stored
 * document and the same live counts — only the asset paths differ, which is
 * what `assetBase` exists for. So this is the published page, not a mock-up
 * of it, and "what does afldb.com look like now" is answerable without
 * touching the live host.
 *
 * It shows SAVED content, not the unsaved state of the editor's form. That
 * distinction is worth keeping: a preview of something that only exists in a
 * browser tab would answer a different and much less useful question.
 */
export async function GET() {
  await requireSuperAdmin();

  const [content, settings, totals] = await Promise.all([
    getApexContent(),
    getSiteSettingsForAdmin(),
    getSiteTotals(),
  ]);

  const shaped = {} as ApexTotals;
  for (const metric of APEX_METRICS) shaped[metric.value] = totals[metric.value];

  const html = renderApexPage({
    content,
    footer: settings.footer,
    totals: shaped,
    assetBase: '/admin/content/asset',
  });

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      // A copy of the apex page inside the application is duplicate content
      // and must never be indexed, gate or no gate.
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
