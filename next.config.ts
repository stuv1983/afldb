import type { NextConfig } from 'next';

/**
 * AFLDB_ENV is the TRANSPORT SECURITY flag: HSTS and the stricter CSP here,
 * and Secure session cookies in src/lib/auth/session.ts. It does NOT decide
 * indexing — that is AFLDB_INDEXING, and src/lib/indexing.ts explains why the
 * two had to come apart. Every host reachable over public HTTPS sets this to
 * `production`, whether or not it is ready to be indexed.
 *
 * Read at BUILD time: `headers()` is evaluated when the routes manifest is
 * generated, so changing this on a server requires a rebuild, not a restart
 * (see changeLog.md).
 */
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

/**
 * Static-generation worker cap.
 *
 * Prerendering forks a worker per core and each one builds its own
 * PostgreSQL pool (src/db/client.ts drops that pool to 2 during a build).
 * Against a local cluster with max_connections=100 that is fine, but a
 * managed database on a small plan allows far fewer — 22 on the entry
 * tier — and a 24-core build box would ask for 48. The build then dies
 * partway through with "too many clients", after doing most of the work.
 *
 * Unset means Next's default, which is what local and dev-server builds
 * want. Production builds against the managed database set it.
 */
const buildWorkers = Number(process.env.AFLDB_BUILD_WORKERS);
const cpus = Number.isSafeInteger(buildWorkers) && buildWorkers > 0
  ? buildWorkers
  : undefined;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,

  ...(cpus === undefined ? {} : { experimental: { cpus } }),

  // Standalone output keeps the systemd deployment self-contained.
  output: 'standalone',

  // The database driver and the SMTP client must never be bundled for the
  // browser. nodemailer additionally resolves transports by dynamic require,
  // which the bundler cannot follow.
  serverExternalPackages: ['postgres', 'nodemailer'],

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
