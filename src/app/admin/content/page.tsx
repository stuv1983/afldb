import type { Metadata } from 'next';

import { ContentEditor } from '@/app/admin/content/ContentEditor';
import type { ImageOption } from '@/app/admin/content/ImageField';
import { MediaLibrary } from '@/app/admin/content/MediaLibrary';
import { PublishPanel } from '@/app/admin/content/PublishPanel';
import { getApexContent, listMedia } from '@/db/queries/site-content';
import { getSiteSettingsForAdmin } from '@/db/queries/site-settings';
import { apexPublishStatus, describeWritability, listTemplateImages } from '@/lib/apex-publish';
import { requireSuperAdmin } from '@/lib/auth/session';
import { uploadedSrc } from '@/lib/site-content';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Page content',
  robots: { index: false, follow: false },
};

/**
 * The words and pictures on the two pages a super admin writes rather than
 * codes: the coming-soon page at the apex, and the footer every page carries.
 *
 * Super admin only, matching /admin/settings. What the public reads on the
 * front door of the site is a publication decision, which is the same line
 * `requireSuperAdmin` already draws around the settings and the query builder.
 */
export default async function ContentPage() {
  await requireSuperAdmin();

  const [content, settings, media, status, shipped] = await Promise.all([
    getApexContent(),
    getSiteSettingsForAdmin(),
    listMedia(),
    apexPublishStatus(),
    listTemplateImages(),
  ]);

  // Uploads first: replacing a shipped screenshot is the common case, and the
  // replacement should be the easier of the two to find.
  const imageOptions: ImageOption[] = [
    ...media.map((image) => ({
      src: uploadedSrc(image.name),
      width: image.width,
      height: image.height,
      kind: 'uploaded' as const,
      alt: image.alt,
    })),
    ...shipped.map((image) => ({
      src: `/img/${image.name}`,
      width: image.width,
      height: image.height,
      kind: 'shipped' as const,
    })),
  ];

  return (
    <>
      <div className="page-header">
        <h1>Page content</h1>
        <p className="subtitle">
          The text and images on the coming-soon page at afldb.com, and the footer
          shown on every page of the site. Saving writes the page straight to disk,
          where Caddy serves it as static files.
        </p>
      </div>

      <PublishPanel
        configured={status.configured}
        target={status.target}
        templateFound={status.templateFound}
        templateDir={status.templateDir}
        lastPublishedAt={status.lastPublishedAt
          ? status.lastPublishedAt.toLocaleString('en-AU', { timeZone: 'Australia/Melbourne' })
          : null}
        writable={describeWritability(status.writable)}
        remedy={status.remedy}
      />

      <ContentEditor
        content={content}
        footer={settings.footer}
        pageIntros={settings.pageIntros}
        imageOptions={imageOptions}
      />

      <MediaLibrary media={media} />
    </>
  );
}
