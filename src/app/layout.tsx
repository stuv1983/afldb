import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from 'next/font/google';
import Link from 'next/link';

import { PrimaryNav, TabBar } from '@/components/SiteNav';
import { ThemeToggle } from '@/components/ThemeToggle';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import '@/styles/globals.css';

const baseUrl = process.env.AFLDB_BASE_URL ?? 'http://localhost:3100';

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
  openGraph: {
    siteName: 'AFLDB',
    type: 'website',
    locale: 'en_AU',
  },
  // Development pages must never be indexed. This is relaxed only at the
  // deliberate production cutover.
  robots: process.env.AFLDB_ENV === 'production'
    ? { index: true, follow: true }
    : { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const fonts = `${newsreader.variable} ${plexSans.variable} ${plexMono.variable}`;

  return (
    // The pre-paint script below sets data-theme on this element, so the
    // server markup and the first client render legitimately differ.
    <html lang="en-AU" className={fonts} suppressHydrationWarning>
      <head>
        {/* Blocking and first in <head>: the stored theme must be applied
            before any styled markup paints, or a reader who chose dark
            gets a frame of cream paper on every navigation. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <a className="skip-link" href="#main">Skip to content</a>

        <header className="site-header">
          <div className="container">
            <div className="masthead">
              <Link href="/" className="brand">AFLDB</Link>
              <span className="span">1897 — Present</span>
            </div>
            <PrimaryNav />
            <ThemeToggle />
          </div>
        </header>

        <main id="main">
          <div className="container">{children}</div>
        </main>

        <footer className="site-footer">
          <div className="container">
            <div className="colophon">
              <p>
                AFLDB — Australian Football statistics, 1897 to present.
                Data derived from publicly available sources including AFL Tables and Wikipedia.
              </p>
              <p>AFLDB is an independent hobby project.</p>
              <p>
                Statistics not collected in a given era are shown as “—”, never as zero.
              </p>
              <p>
                Contact: <a href="mailto:admin@afldb.com">admin@afldb.com</a>
              </p>
            </div>
          </div>
        </footer>

        <TabBar />
      </body>
    </html>
  );
}
