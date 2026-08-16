import 'server-only';

import { constants } from 'node:fs';
import {
  access, copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile,
} from 'node:fs/promises';
import { basename, join } from 'node:path';

import { getSiteTotals } from '@/db/queries/overview';
import { getAllMediaBytes, getApexContent } from '@/db/queries/site-content';
import { getSiteSettingsForAdmin } from '@/db/queries/site-settings';
import { renderApexPage } from '@/lib/apex-html';
import { probeImage } from '@/lib/image-probe';
import { APEX_METRICS, type ApexTotals } from '@/lib/site-content';

/**
 * Write the apex coming-soon page to disk, where Caddy serves it from.
 *
 * This is the hinge the whole feature turns on. docs/apex-coming-soon.md §1
 * argues that afldb.com must be STATIC FILES: it is the hostname carrying the
 * search history, so it cannot 502 while the app restarts, time out on a slow
 * query, or care whether PostgreSQL is up. Making the page editable from
 * /admin/content could easily have thrown that away by serving it from the
 * application instead.
 *
 * It does not. The application is the page's PUBLISHER, never its server. A
 * super admin's save renders the whole page here and writes it out; from then
 * on Caddy serves plain files with the app entirely out of the path. Every
 * property that argument depends on survives — including the strict CSP,
 * since nothing published here is inline.
 *
 * The published directory is therefore DERIVED, and disposable. Everything in
 * it comes either from `deploy/coming-soon/` in git or from PostgreSQL, so
 * deleting it and pressing Publish again is a complete recovery.
 */

/** Files copied verbatim from the template directory into the published root. */
const TEMPLATE_FILES = ['style.css', 'app.js', 'favicon.svg', 'robots.txt', 'sitemap.xml'];

/** Where uploaded images land, relative to the published root. */
const UPLOAD_DIR = join('img', 'u');

export type PublishFailure =
  | { ok: false; reason: 'not-configured' }
  | { ok: false; reason: 'template-missing'; detail: string }
  | { ok: false; reason: 'write-failed'; detail: string };

export type PublishSuccess = {
  ok: true;
  target: string;
  publishedAt: Date;
  /** Files written or refreshed, including the page itself. */
  written: number;
  /** Stale uploads removed from img/u. */
  pruned: number;
  bytes: number;
};

export type PublishResult = PublishSuccess | PublishFailure;

/**
 * The directory Caddy serves the apex from, or null when this host does not
 * publish.
 *
 * Unset is a legitimate, expected state rather than a misconfiguration: a
 * development machine has no /var/www/afldb-soon and no Caddy in front of it.
 * The editor still saves to the database there; only the write to disk is
 * skipped, and the admin screen says so plainly instead of failing.
 */
export function apexTargetDir(): string | null {
  const configured = process.env.AFLDB_APEX_DIR?.trim();
  return configured ? configured : null;
}

/**
 * The shipped page assets: stylesheet, form script, icon, robots, sitemap and
 * the screenshots that came with the repository.
 *
 * `process.cwd()` is not the repository root in production — the Next.js
 * standalone server chdir()s into `.next/standalone` on startup — which is why
 * tools/build/prepare-standalone.mjs copies `deploy/coming-soon` in beside the
 * server. Both layouts therefore resolve from cwd, and AFLDB_APEX_TEMPLATE_DIR
 * overrides for anything unusual.
 */
export function apexTemplateDir(): string {
  const configured = process.env.AFLDB_APEX_TEMPLATE_DIR?.trim();
  return configured || join(process.cwd(), 'deploy', 'coming-soon');
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The screenshots that ship with the repository, with their real dimensions.
 *
 * The editor needs the size of an image the moment it is chosen, so the page
 * slot can carry width/height without asking anyone to measure anything. For
 * uploads that is stored in `site_media`; for these it is read out of the file
 * headers here. Seven small files on a super-admin-only page, so the cost is
 * not worth caching around.
 */
export async function listTemplateImages(): Promise<
  { name: string; width: number; height: number }[]
> {
  const directory = join(apexTemplateDir(), 'img');
  if (!(await exists(directory))) return [];

  const images: { name: string; width: number; height: number }[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const name = basename(entry.name);
    try {
      const probed = probeImage(await readFile(join(directory, name)));
      if (probed) images.push({ name, width: probed.width, height: probed.height });
    } catch {
      // An unreadable or unrecognised file simply is not offered as a choice.
    }
  }
  return images.sort((a, b) => a.name.localeCompare(b.name));
}

export type PublishStatus = {
  configured: boolean;
  target: string | null;
  templateDir: string;
  templateFound: boolean;
  /** mtime of the published page, which is the honest "last published". */
  lastPublishedAt: Date | null;
};

/**
 * What the admin screen shows above the Publish button.
 *
 * `lastPublishedAt` is read from the file's mtime rather than from a row
 * written at publish time on purpose: the question being asked is "what is on
 * disk right now", and a database row can be right about a file that was
 * subsequently deleted.
 */
export async function apexPublishStatus(): Promise<PublishStatus> {
  const target = apexTargetDir();
  const templateDir = apexTemplateDir();

  let lastPublishedAt: Date | null = null;
  if (target) {
    try {
      lastPublishedAt = (await stat(join(target, 'index.html'))).mtime;
    } catch {
      lastPublishedAt = null;
    }
  }

  return {
    configured: target !== null,
    target,
    templateDir,
    templateFound: await exists(join(templateDir, 'style.css')),
    lastPublishedAt,
  };
}

/** Shape the live counts into what the hero's metric list expects. */
function toApexTotals(totals: Awaited<ReturnType<typeof getSiteTotals>>): ApexTotals {
  const shaped = {} as ApexTotals;
  for (const metric of APEX_METRICS) shaped[metric.value] = totals[metric.value];
  return shaped;
}

/**
 * Render and publish. Idempotent: running it twice writes the same tree.
 */
export async function publishApex(): Promise<PublishResult> {
  const target = apexTargetDir();
  if (!target) return { ok: false, reason: 'not-configured' };

  const templateDir = apexTemplateDir();
  if (!(await exists(join(templateDir, 'style.css')))) {
    return {
      ok: false,
      reason: 'template-missing',
      detail: `No style.css under ${templateDir}. Set AFLDB_APEX_TEMPLATE_DIR, or run `
        + 'npm run build so prepare-standalone copies deploy/coming-soon into place.',
    };
  }

  const [content, settings, totals, media] = await Promise.all([
    getApexContent(),
    getSiteSettingsForAdmin(),
    getSiteTotals(),
    getAllMediaBytes(),
  ]);

  const publishedAt = new Date();
  const html = renderApexPage({
    content,
    footer: settings.footer,
    totals: toApexTotals(totals),
    publishedAt,
  });

  let written = 0;
  let bytes = 0;
  let pruned = 0;

  try {
    await mkdir(join(target, UPLOAD_DIR), { recursive: true });

    // The page itself, written to a temporary name and renamed over the live
    // one. rename(2) within a filesystem is atomic, so a reader gets either
    // the old page or the new one — never a half-written file, which is
    // exactly the failure a marketing page cannot afford to serve.
    const payload = Buffer.from(html, 'utf8');
    const temporary = join(target, `.index.html.${process.pid}.${Date.now()}.tmp`);
    await writeFile(temporary, payload, { mode: 0o644 });
    await rename(temporary, join(target, 'index.html'));
    written += 1;
    bytes += payload.byteLength;

    // Stylesheet, script, icon, robots and sitemap, straight from git. These
    // change with a deploy rather than with an edit, which is why a code
    // change to the page's CSS still needs a Publish to reach the apex.
    for (const file of TEMPLATE_FILES) {
      const source = join(templateDir, file);
      if (!(await exists(source))) continue;
      await copyFile(source, join(target, file));
      written += 1;
      bytes += (await stat(source)).size;
    }

    // The screenshots that shipped with the repository.
    const templateImages = join(templateDir, 'img');
    if (await exists(templateImages)) {
      await mkdir(join(target, 'img'), { recursive: true });
      for (const entry of await readdir(templateImages, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        // basename() defends the join below against a name from the
        // filesystem that contains separators.
        const name = basename(entry.name);
        await copyFile(join(templateImages, name), join(target, 'img', name));
        written += 1;
        bytes += (await stat(join(templateImages, name))).size;
      }
    }

    // Uploaded images. Their names are constrained by migration 037 to a safe
    // filename, and basename() is belt to that braces.
    const uploadedNames = new Set<string>();
    for (const image of media) {
      const name = basename(image.name);
      uploadedNames.add(name);
      await writeFile(join(target, UPLOAD_DIR, name), image.bytes, { mode: 0o644 });
      written += 1;
      bytes += image.bytes.length;
    }

    // Prune uploads that are no longer in the database. Confined to img/u,
    // which is the only directory this process owns: files under img/ came
    // from git and files at the root are template assets, and deleting either
    // because a database row went missing would be the wrong repair.
    for (const entry of await readdir(join(target, UPLOAD_DIR), { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (uploadedNames.has(entry.name)) continue;
      await rm(join(target, UPLOAD_DIR, entry.name), { force: true });
      pruned += 1;
    }
  } catch (error) {
    // The settings are already saved at this point, so a failed write costs
    // the publish and nothing else. The message is shown to a super admin,
    // who is the only person who can act on an EACCES.
    return {
      ok: false,
      reason: 'write-failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  return { ok: true, target, publishedAt, written, pruned, bytes };
}

/** A sentence for the admin screen, given whatever came back. */
export function describePublishResult(result: PublishResult): string {
  if (result.ok) {
    return `Published ${result.written} file${result.written === 1 ? '' : 's'} to `
      + `${result.target}${result.pruned > 0 ? `, removed ${result.pruned} stale upload${result.pruned === 1 ? '' : 's'}` : ''}.`;
  }
  switch (result.reason) {
    case 'not-configured':
      return 'Saved. Not published: AFLDB_APEX_DIR is not set on this host, so there '
        + 'is no directory to write the page to. That is normal in development.';
    case 'template-missing':
      return `Saved, but not published. ${result.detail}`;
    case 'write-failed':
      return `Saved, but the page could not be written: ${result.detail}`;
  }
}
