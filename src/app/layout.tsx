import type { Metadata } from 'next';
import Link from 'next/link';

import '@/styles/globals.css';

const baseUrl = process.env.AFLDB_BASE_URL ?? 'http://localhost:3100';

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

const NAV = [
  { href: '/players', label: 'Players' },
  { href: '/clubs', label: 'Clubs' },
  { href: '/seasons', label: 'Seasons' },
  { href: '/records', label: 'Records' },
  { href: '/brownlow', label: 'Brownlow' },
  { href: '/advanced-search', label: 'Advanced Search' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <body>
        <a className="skip-link" href="#main">Skip to content</a>

        <header className="site-header">
          <div className="container">
            <Link href="/" className="brand">AFLDB</Link>
            <nav className="site-nav" aria-label="Primary">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href}>{item.label}</Link>
              ))}
            </nav>
          </div>
        </header>

        <main id="main">
          <div className="container">{children}</div>
        </main>

        <footer className="site-footer">
          <div className="container">
            <p>
              AFLDB — Australian Football statistics, 1897 to present.
              Data derived from publicly available sources including AFL Tables and Wikipedia.
            </p>
            <p className="muted">
              Statistics not collected in a given era are shown as “—”, never as zero.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
