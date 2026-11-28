// REHEARSAL ONLY (streamanator, disposable). Stands in for .next/standalone/server.js inside a sandbox release so the REAL
// deploy/server-cluster.mjs of 7d92042f or 17822b29 can supervise it under a systemd user unit. It imitates only the surfaces the
// release scripts read: the beta gate (HMAC claim of AFLDB_SESSION_SECRET), page <title>/robots, the Brownlow winner and badges,
// genuine 404s, an ISSUE-367 unaccepted year (served by the 7d92042f build, 404 on the 17822b29 build), sitemap/robots, the
// build manifest, health, and the loopback revalidation route reply {ok,path,workerId,workerCount}. No database, no Next.js.
'use strict';
const http = require('node:http');
const { createHmac, timingSafeEqual } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const BUILD = readFileSync(join(__dirname, '.next', 'BUILD_ID'), 'utf8').trim();
const OLD_BUILD = 'XWruOm_9nLCSMY8nGPqYU';
const env = process.env, PORT = Number(env.PORT);
const b64 = (b) => Buffer.from(b).toString('base64url');
const admitted = (req) => {
  const m = /(?:^|;\s*)afldb_beta=([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '');
  if (!m) return false;
  const payload = Buffer.from(m[1], 'base64url');
  const want = Buffer.from(b64(createHmac('sha256', env.AFLDB_SESSION_SECRET).update(payload).digest()));
  const got = Buffer.from(m[2]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return false;
  try { const c = JSON.parse(payload.toString('utf8')); return c.kind === 'beta' && c.exp > Date.now() / 1000 && c.epoch === Number(env.AFLDB_BETA_EPOCH ?? 1); } catch { return false; }
};
const esc = (s) => s.replace(/&/g, '&amp;');
const page = (title, main) => `<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><title>${esc(title)}</title>`
  + `<meta name="robots" content="noindex, nofollow"/></head><body><svg aria-hidden="true"><title>logo</title></svg><main>${main}</main>`
  + `<script>(self.__next_f=self.__next_f||[]).push([1,"<title>Page not found | AFLDB</title> build ${BUILD}"])</script></body></html>`;
const NOT_FOUND = page('Page not found | AFLDB', '<h1>Page not found</h1>');
const brownlow = (year, winner, votes, badges) => page(`${year} Brownlow Medal — Winner, Votes & Leaderboard | AFLDB`,
  `<h1>${year} Brownlow Medal</h1><p>Won by <!-- -->${winner}<!-- --> with <!-- -->${votes}<!-- --> votes</p>`
  + '<table><tbody>' + Array.from({ length: badges }, (_, i) => `<tr><td>Player ${i}</td><td><span class="badge badge-warn">Recorded ineligible</span></td></tr>`).join('') + '</tbody></table>');
const send = (res, code, body, headers = {}) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', ...headers }); res.end(body); };
http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`), p = u.pathname;
  const worker = env.AFLDB_WORKER_ID ?? null;
  if (p === '/api/health') return send(res, 200, JSON.stringify({ status: 'ok', database: 'ok', build: BUILD }), { 'content-type': 'application/json' });
  if (p.startsWith('/_next/static/')) return p === `/_next/static/${BUILD}/_buildManifest.js` ? send(res, 200, 'self.__BUILD_MANIFEST={}', { 'content-type': 'application/javascript' }) : send(res, 404, 'not found');
  if (p === '/beta') return send(res, 200, page('Beta | AFLDB', '<h1>Beta</h1>'), { 'x-robots-tag': 'noindex, nofollow' });
  if (p === '/robots.txt') return send(res, 200, 'User-agent: *\nDisallow: /\n', { 'content-type': 'text/plain' });
  if (p === '/api/internal/revalidate-season' && req.method === 'POST') {
    let body = ''; req.on('data', (c) => { body += c; });
    return req.on('end', () => {
      if (req.headers['x-afldb-revalidate-secret'] !== env.AFLDB_REVALIDATE_SECRET) return send(res, 403, '{"ok":false}', { 'content-type': 'application/json' });
      let season = null; try { season = JSON.parse(body).season; } catch { /* bad body */ }
      if (season !== 2026) return send(res, 400, '{"ok":false}', { 'content-type': 'application/json' });
      send(res, 200, JSON.stringify({ ok: true, path: '/seasons/2026', paths: ['/seasons/2026', '/brownlow/2026'], playerPaths: [], workerId: worker, workerCount: Number(env.AFLDB_WORKER_COUNT) }), { 'content-type': 'application/json' });
    });
  }
  if (!admitted(req)) {
    if (p === '/admin/operations') return send(res, 307, '', { location: `http://127.0.0.1:${PORT}/admin/login` });
    return send(res, 307, '', { location: `http://127.0.0.1:${PORT}/beta${p === '/' ? '' : `?from=${encodeURIComponent(p)}`}` });
  }
  const h = { 'x-nextjs-cache': 'HIT' };
  if (p === '/brownlow/2026') return send(res, 200, brownlow(2026, 'Nick Daicos', 47, 14), h);
  if (p === '/brownlow/1897' && BUILD === OLD_BUILD) return send(res, 200, brownlow(1897, 'Unaccepted Example', 9, 0), h);
  if (p === '/seasons/2026') return send(res, 200, page('2026 AFL Season — Ladder, Results & Finals | AFLDB', '<h1>2026 AFL Season</h1>'), h);
  return send(res, 404, NOT_FOUND);
}).listen(PORT, '127.0.0.1');
