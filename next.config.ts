import type { NextConfig } from 'next';

const isProduction = process.env.AFLDB_ENV === 'production';

/**
 * Security headers.
 *
 * The CSP is deliberately not maximally strict: Next.js injects inline
 * bootstrap scripts and this project uses inline styles, so
 * 'unsafe-inline' is required for the site to render. It is tightened at
 * the same time as any move to nonce-based styling, not before.
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
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
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
