// caddy357: the same GET sent straight to the app (55663) and through Caddy (55653): status, body hash and the
// response headers that matter must be identical (the Caddyfile must not change a legitimate response).
// usage: node compare.mjs <urls.txt> <out.tsv>
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';

const [urlsFile, out] = process.argv.slice(2);
const urls = readFileSync(urlsFile, 'utf8').split('\n').filter(Boolean);
const agent = new http.Agent({ keepAlive: true, maxSockets: 8 });
const get = (port, path) => new Promise((resolve) => {
  const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', agent, headers: { Host: 'beta.afldb.com', 'Accept-Encoding': 'identity' } }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, hash: createHash('sha256').update(Buffer.concat(chunks)).digest('hex').slice(0, 16), len: Buffer.concat(chunks).length }));
  });
  req.on('error', (e) => resolve({ status: 0, headers: {}, hash: `ERR ${e.code}`, len: 0 }));
  req.setTimeout(60000, () => req.destroy(new Error('timeout')));
  req.end();
});
const KEEP = ['content-type', 'cache-control', 'location', 'content-security-policy', 'strict-transport-security', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'x-robots-tag', 'permissions-policy', 'x-dns-prefetch-control'];
const rows = []; let same = 0; const diffsByHeader = {};
for (const u of urls) {
  const a = await get(55663, u); const b = await get(55653, u);
  const hd = [];
  for (const h of KEEP) if ((a.headers[h] ?? '') !== (b.headers[h] ?? '')) { hd.push(h); diffsByHeader[h] = (diffsByHeader[h] ?? 0) + 1; }
  const ok = a.status === b.status && a.hash === b.hash && hd.length === 0;
  if (ok) same += 1;
  rows.push(`${ok ? 'SAME' : 'DIFF'}\t${a.status}\t${b.status}\t${a.hash === b.hash ? 'body=' : `body:${a.hash}/${b.hash}`}\t${hd.join(',')}\t${u}`);
}
writeFileSync(out, `${rows.join('\n')}\n`);
console.log(`compared=${urls.length} identical(status+body+key headers)=${same} differing=${urls.length - same} header-diff-counts=${JSON.stringify(diffsByHeader)}`);
agent.destroy();
