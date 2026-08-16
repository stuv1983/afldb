/**
 * Render the apex coming-soon page to a string of HTML.
 *
 * A pure function of the stored content, the shared footer and a set of live
 * counts. Nothing here touches the database, the filesystem or the clock
 * beyond the timestamp it is handed, which is what makes the published page
 * testable: `tests/site-content.test.ts` asserts against this output directly
 * rather than against a file somebody has to remember to look at.
 *
 * The markup mirrors `deploy/coming-soon/index.html` element for element and
 * class for class, because `deploy/coming-soon/style.css` is published beside
 * it unchanged and styles exactly those hooks. Changing a class here without
 * changing it there produces an unstyled page.
 *
 * EVERY interpolated value is escaped. The content is written by a super
 * admin, who is trusted, but "trusted" is not the same as "types no
 * apostrophes" — and the apex serves under a CSP with no 'unsafe-inline', so
 * an accidental tag would break the page rather than merely look wrong.
 */

import { formatNumber } from '@/lib/format';
import {
  type ApexContent,
  type ApexImage,
  type ApexSectionId,
  type ApexTotals,
  type SiteFooter,
} from '@/lib/site-content';

/**
 * The canonical origin, deliberately NOT editable.
 *
 * `canonical`, `og:url` and the absolute `og:image` all derive from it, and
 * all three are load-bearing for search: a typo in any of them is the kind of
 * mistake that is invisible on the page and expensive in the index. The
 * hostname is a deployment fact, not a content decision, so it lives in code.
 */
export const APEX_ORIGIN = 'https://afldb.com';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Embed a value inside `<script type="application/ld+json">`.
 *
 * HTML-escaping is WRONG here — the block is not parsed as HTML, so `&amp;`
 * would appear literally in the structured data. The only sequence that can
 * end the element early is a `<`, so that is what gets neutralised, as its
 * JSON unicode escape which parses back to the same character.
 */
function escapeJsonLd(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/</g, '\\u003c');
}

/** Blank-line-separated prose becomes separate paragraphs. */
function paragraphs(body: string, className?: string): string {
  const attribute = className ? ` class="${className}"` : '';
  return body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    // A single newline inside a paragraph is a soft wrap in the editor's
    // textarea, not an intentional break, so it collapses to a space.
    .map((block) => `<p${attribute}>${escapeHtml(block.replace(/\s*\n\s*/g, ' '))}</p>`)
    .join('\n      ');
}

export type RenderOptions = {
  content: ApexContent;
  footer: SiteFooter;
  totals: ApexTotals;
  /**
   * Prefix for same-origin assets. Empty for the published page, which is
   * served from the root of its own host; `/admin/content/asset` for the
   * in-app preview, where those files are proxied out of the template
   * directory and the media table instead.
   */
  assetBase?: string;
  /** Stamped into the generated-file banner. */
  publishedAt?: Date;
};

/** Resolve one stat to the string that appears in the strip. */
export function statFigure(
  stat: ApexContent['hero']['stats'][number],
  totals: ApexTotals,
): string {
  // A typed-in value always wins, which is what makes a metric-backed figure
  // "overridable" — clearing the box hands it back to the database.
  if (stat.value) return stat.value;
  if (stat.metric === 'custom') return '';
  return formatNumber(totals[stat.metric]);
}

function image(img: ApexImage, assetBase: string, extra: string): string {
  // width/height are omitted rather than guessed when unknown: a wrong pair
  // reserves the wrong space and shifts the layout, which is worse than the
  // browser not reserving any.
  const size = img.width > 0 && img.height > 0
    ? `\n      width="${img.width}" height="${img.height}"`
    : '';
  return `<img
      src="${escapeHtml(assetBase + img.src)}"${size}
      alt="${escapeHtml(img.alt)}"
      ${extra}>`;
}

export function renderApexPage({
  content,
  footer,
  totals,
  assetBase = '',
  publishedAt = new Date(),
}: RenderOptions): string {
  const { meta, header, hero, features, notes, pair } = content;

  const stats = hero.stats
    .map((stat) => {
      const figure = statFigure(stat, totals);
      if (!figure) return '';
      return `<li><strong>${escapeHtml(figure)}</strong>`
        + `<span>${escapeHtml(stat.label)}</span></li>`;
    })
    .filter(Boolean)
    .join('\n      ');

  const featureCards = features.items
    .map((feature) => [
      '<article class="feature">',
      feature.heading ? `        <h3>${escapeHtml(feature.heading)}</h3>` : '',
      feature.body ? `        ${paragraphs(feature.body)}` : '',
      feature.image
        ? `        ${image(feature.image, assetBase, 'loading="lazy" decoding="async"')}`
        : '',
      '      </article>',
    ].filter(Boolean).join('\n      '))
    .join('\n\n      ');

  const noteCards = notes.items
    .map((note) => [
      '<div class="note">',
      note.heading ? `        <h3>${escapeHtml(note.heading)}</h3>` : '',
      note.body ? `        ${paragraphs(note.body)}` : '',
      '      </div>',
    ].filter(Boolean).join('\n      '))
    .join('\n      ');

  const footerLines = footer.lines
    .map((line) => `    <p>${escapeHtml(line)}</p>`)
    .join('\n');

  const contact = footer.contactEmail
    ? `\n    <p>Contact: <a href="mailto:${escapeHtml(footer.contactEmail)}">`
      + `${escapeHtml(footer.contactEmail)}</a></p>`
    : '';

  // --- The bands of the page, one function each. ---
  //
  // Which of these are emitted, and in what order, comes from
  // `content.sections` rather than from the order they are written here.
  // That is the whole of the "show, hide and reorder" control at
  // /admin/content: the renderer holds the markup for each band and the
  // stored document holds the running order, so neither has to know the
  // other's business. A band whose own content is empty renders nothing
  // even when visible — hiding it is a decision, having nothing to say is
  // a fact, and both should produce the same silence.
  const bands: Record<ApexSectionId, () => string> = {
    hero: () => `
  <section class="hero container">
${hero.eyebrow ? `    <p class="eyebrow">${escapeHtml(hero.eyebrow)}</p>\n` : ''}    <h1>${escapeHtml(hero.heading)}</h1>
${hero.lede ? `    ${paragraphs(hero.lede, 'lede')}\n` : ''}
    <div class="cta-row">
      <!--
        Replaced by app.js once the form definition loads. Kept as a mailto so
        the page is still useful with JavaScript disabled or the app down.
        data-label is the button's wording, edited at /admin/content: the
        endpoint serves the QUESTIONS, so the copy around them stays here in
        the static file where the rest of the page's words are.
      -->
      <div id="early-access" data-label="${escapeHtml(hero.ctaLabel)}">
        <noscript>
          <a class="btn" href="mailto:${escapeHtml(hero.requestEmail)}?subject=AFLDB%20early%20access">
            ${escapeHtml(hero.ctaLabel)}
          </a>
        </noscript>
      </div>
    </div>
${stats ? `
    <ul class="stats" aria-label="${escapeHtml(hero.statsLabel)}">
      ${stats}
    </ul>
` : ''}  </section>
`,

    wideShot: () => (content.wideShot ? `
  <section class="container shot-wide">
    ${image(content.wideShot, assetBase, 'loading="eager" decoding="async"')}
  </section>
` : ''),

    features: () => (features.items.length > 0 ? `
  <section class="container">
${features.heading ? `    <h2>${escapeHtml(features.heading)}</h2>\n` : ''}
    <div class="features">

      ${featureCards}

    </div>
  </section>
` : ''),

    notes: () => (notes.items.length > 0 ? `
  <section class="container band">
${notes.heading ? `    <h2>${escapeHtml(notes.heading)}</h2>\n` : ''}    <div class="notes">
      ${noteCards}
    </div>
  </section>
` : ''),

    // Either half may be empty; the section appears while one survives, so
    // "just the phone shot" is a layout the editor can actually produce.
    pair: () => (pair.light || pair.mobile ? `
  <section class="container pair">
${pair.light ? `    <figure>
      ${image(pair.light, assetBase, 'loading="lazy" decoding="async"')}
${pair.lightCaption ? `      <figcaption>${escapeHtml(pair.lightCaption)}</figcaption>\n` : ''}    </figure>
` : ''}${pair.mobile ? `    <figure class="phone">
      ${image(pair.mobile, assetBase, 'loading="lazy" decoding="async"')}
${pair.mobileCaption ? `      <figcaption>${escapeHtml(pair.mobileCaption)}</figcaption>\n` : ''}    </figure>
` : ''}  </section>
` : ''),
  };

  const body = content.sections
    .filter((section) => section.visible)
    .map((section) => bands[section.id]())
    .filter(Boolean)
    .join('');

  const schema = escapeJsonLd({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: header.brand,
    alternateName: 'Australian Football Database',
    url: `${APEX_ORIGIN}/`,
    description: meta.schemaDescription,
    inLanguage: 'en-AU',
  });

  return `<!DOCTYPE html>
<!--
  AFLDB — apex coming-soon page.

  GENERATED FILE. Published ${publishedAt.toISOString()} by /admin/content.
  Do not edit in place: the next publish overwrites it, and the copy that
  matters lives in PostgreSQL (site_settings 'apex.content' and 'site.footer',
  plus site_media for the images). To change this page, edit it there and
  press Publish; to rebuild it after a server rebuild, press Publish again or
  run \`npm run publish:apex\`.

  Served as STATIC FILES by Caddy from /var/www/afldb-soon, not by the Next.js
  app. deploy/Caddyfile.production explains why in full; the short version is
  that this page is the SEO asset for afldb.com and must not go down with the
  application or the database behind it.

  The only dynamic part is the early-access form, whose questions a super
  admin configures at /admin/settings. app.js fetches them from
  /api/early-access, which Caddy proxies to the app on the SAME origin.

  See docs/apex-coming-soon.md.
-->
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">

<title>${escapeHtml(meta.title)}</title>
<meta name="description" content="${escapeHtml(meta.description)}">
<link rel="canonical" href="${APEX_ORIGIN}/">

<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(header.brand)}">
<meta property="og:locale" content="en_AU">
<meta property="og:url" content="${APEX_ORIGIN}/">
<meta property="og:title" content="${escapeHtml(meta.ogTitle)}">
<meta property="og:description" content="${escapeHtml(meta.ogDescription)}">${meta.ogImage ? `
<meta property="og:image" content="${escapeHtml(APEX_ORIGIN + meta.ogImage.src)}">
<meta name="twitter:card" content="summary_large_image">` : `
<meta name="twitter:card" content="summary">`}

<link rel="icon" href="${assetBase}/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${assetBase}/style.css">

<script type="application/ld+json">
${schema}
</script>
</head>

<body>
<a class="skip-link" href="#main">Skip to content</a>

<header class="site-header">
  <div class="container masthead">
    <span class="brand">${escapeHtml(header.brand)}</span>
    <span class="span">${escapeHtml(header.tagline)}</span>
  </div>
</header>

<main id="main">
${body}
</main>

<footer class="site-footer">
  <div class="container">
${footerLines}${contact}
  </div>
</footer>

<script src="${assetBase}/app.js" defer></script>
</body>
</html>
`;
}
