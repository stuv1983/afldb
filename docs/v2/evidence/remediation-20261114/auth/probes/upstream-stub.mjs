// Stand-in for the Next.js upstream (127.0.0.1:3100 in production) used by
// caddy-redaction-probe.sh. It records every request it receives (so the probe
// can prove what Caddy forwarded) and answers just enough for routing checks.
// Usage: node upstream-stub.mjs <port> <record.jsonl>
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';

const [port, record] = [Number(process.argv[2]), process.argv[3]];

createServer((req, res) => {
  const { url, method, headers } = req;
  if (url !== '/api/health') {
    appendFileSync(record, `${JSON.stringify({ method, url, xff: headers['x-forwarded-for'] ?? null,
      realIp: headers['x-real-ip'] ?? null, forwarded: headers['forwarded'] ?? null })}\n`);
  }
  if (url === '/redir') {
    res.writeHead(307, { Location: '/beta?from=%2Fplayers' });
    res.end();
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`upstream saw ${method} ${url}\n`);
}).listen(port, '127.0.0.1');
