import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from 'next/font/google';
import Link from 'next/link';

import { ConsentBanner } from '@/components/ConsentBanner';
import { PrimaryNav, TabBar } from '@/components/SiteNav';
import { ThemeToggle } from '@/components/ThemeToggle';
import { getSiteFooter, getSiteLayout, getSiteTheme } from '@/db/queries/site-settings';
import { HEALTH_INIT_SCRIPT } from '@/lib/health-init-script';
import { indexingEnabled } from '@/lib/indexing';
import { siteUrl } from '@/lib/seo';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import '@/styles/globals.css';
import '@/styles/themes.css';
import '@/styles/layouts.css';

const baseUrl = siteUrl();

/**
 * Fonts are self-hosted by `next/font`, which matters twice over: the
 * Content-Security-Policy allows `font-src 'self'` only, so a Google Fonts
 * CDN link would simply be blocked, and the files are subset and preloaded
 * rather than fetched from a third party at runtime.
 */
const newsreader = Newsreader({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-newsreader',
});

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-plex-sans',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-plex-mono',
});

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: 'AFLDB — Australian Football Statistics Database',
    template: '%s | AFLDB',
  },
  description:
    'Historical Australian Football (AFL/VFL) statistics from 1897 to the present: '
    + 'players, clubs, seasons, matches, venues, records, awards and Brownlow history.',
  // Inherited only by pages that set no `openGraph` of their own, because
  // Next REPLACES this object between segments rather than merging it. Every
  // page that matters for search goes through `pageMetadata` in src/lib/seo.ts,
  // which restates these three and adds the og:url and og:title that a
  // wholesale replacement would otherwise drop.
  openGraph: {
    siteName: 'AFLDB',
    type: 'website',
    locale: 'en_AU',
  },
  // Development pages must never be indexed, and neither must a gated beta.
  // Relaxed only by an explicit AFLDB_INDEXING=on at the deliberate cutover:
  // the same predicate robots.txt uses, so the two can no longer disagree.
  robots: indexingEnabled()
    ? { index: true, follow: true }
    : { index: false, follow: false },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-48.png', sizes: '48x48', type: 'image/png' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
};

/**
 * Async because of the footer, which a super admin edits at /admin/content and
 * which therefore has to be read rather than written here. `getSiteFooter`
 * falls back to the compiled-in colophon on ANY failure — a layout that can
 * throw is a site that has no error page either.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const fonts = `${newsreader.variable} ${plexSans.variable} ${plexMono.variable}`;
  const [footer, siteTheme, siteLayout] = await Promise.all([
    getSiteFooter(),
    getSiteTheme(),
    getSiteLayout(),
  ]);
  // The `sidebar` preset moves `PrimaryNav` out of the header and beside
  // `main` in a two-column shell (`src/styles/layouts.css`); every other
  // preset renders it in the header as before. This is the one difference
  // pure CSS cannot express, because it changes which element is PrimaryNav's
  // parent. Both branches render the exact same `PrimaryNav`/`TabBar`
  // components — see AFLDB-ISSUE-173.md — so the nav model and its
  // interactions (including the mobile TabBar) are never duplicated.
  //
  // `<main id="main">` must wrap ONLY page content in both presets: the
  // "Skip to content" link targets `#main`, and PrimaryNav must be a
  // sibling of `<main>`, not a child of it, or the skip link stops
  // skipping the nav and the nav/main landmarks nest (AFLDB-ISSUE-173
  // web-interface-guidelines remediation).
  const sidebarLayout = siteLayout === 'sidebar';

  return (
    // The pre-paint script below sets data-theme on this element, so the
    // server markup and the first client render legitimately differ.
    <html
      lang="en-AU"
      className={fonts}
      data-site-theme={siteTheme}
      data-site-layout={siteLayout}
      suppressHydrationWarning
    >
      <head>
        {/* Blocking and first in <head>: the stored theme must be applied
            before any styled markup paints, or a reader who chose dark
            gets a frame of cream paper on every navigation. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* Also blocking, also ahead of the app bundle: a hydration
            mismatch is detected during React's commit phase, before any
            component's useEffect (including a reporter mounted from this
            layout) has run -- see health-init-script.ts's own comment. */}
        <script dangerouslySetInnerHTML={{ __html: HEALTH_INIT_SCRIPT }} />
      </head>
      <body>
        <a className="skip-link" href="#main">Skip to content</a>

        <header className="site-header">
          <div className="container">
            <div className="masthead">
              <Link href="/" className="brand">AFLDB</Link>
              <span className="span">1897 — Present</span>
            </div>
            {!sidebarLayout && <PrimaryNav />}
            <ThemeToggle />
          </div>
        </header>

        {sidebarLayout ? (
          // Same shape as the admin shell's own nav-beside-content grid
          // (`.admin-shell` in globals.css): a `.container` that drops its
          // max-width when it directly contains this structural class, so
          // the sidebar and the wider content column can use the space a
          // single reading column would not need. This wrapper is a plain
          // div, not a landmark, so `.layout-nav` (PrimaryNav) and
          // `<main id="main">` are sibling landmarks beneath it — never one
          // nested inside the other.
          <div className="container layout-shell">
            <div className="layout-nav">
              <PrimaryNav />
            </div>
            <main id="main" className="layout-main">{children}</main>
          </div>
        ) : (
          <main id="main">
            <div className="container">{children}</div>
          </main>
        )}

        <footer className="site-footer">
          <div className="container">
            <div className="colophon">
              {footer.lines.map((line, index) => (
                <p key={index}>
                  {line}
                  {/* The About link rides on the first paragraph, where it has
                      always been. The apex publishes the same lines WITHOUT it,
                      having no /about of its own to point at. */}
                  {index === 0 && footer.aboutLinkText && (
                    <>{' '}<Link href="/about">{footer.aboutLinkText}</Link></>
                  )}
                </p>
              ))}
              {footer.contactEmail && (
                <p>
                  Contact:{' '}
                  <a href={`mailto:${footer.contactEmail}`}>{footer.contactEmail}</a>
                </p>
              )}
            </div>
          </div>
        </footer>

        <TabBar />
        <ConsentBanner />
      </body>
    </html>
  );
}
