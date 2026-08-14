import type { NextConfig } from 'next';

const isProduction = process.env.AFLDB_ENV === 'production';

/**
 * Security headers.
 *
 * The CSP is deliberately not maximally strict: Next.js injects inline
 * bootstrap scripts and this project uses inline styles, so 'unsafe-inline'
 * is required for the site to render. 'unsafe-eval' is now dropped in
 * production — only the dev server's React Refresh / HMR needs it — so an
 * injected string-to-code path has no CSP grant in prod. Removing
 * 'unsafe-inline' for scripts is the remaining hardening step: it needs a
 * per-request nonce plumbed through middleware and the one inline <script>
 * (the theme init in src/lib/theme.ts) and must be verified against a running
 * build, so it is tracked separately rather than changed blind.
 *
 * HSTS is only sent in production, since the development server is
 * reached over plain HTTP on the LAN and sending it would poison
 * browsers for that hostname.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      isProduction
        ? "script-src 'self' 'unsafe-inline'"
        : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join('; '),
  },
  ...(isProduction
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,

  // Standalone output keeps the systemd deployment self-contained.
  output: 'standalone',

  // The database driver must never be bundled for the browser.
  serverExternalPackages: ['postgres'],

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
