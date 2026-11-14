// caddy357: stand-in for the Next.js upstream (127.0.0.1:55663). Records every request it receives (method, raw
// request target, forwarded headers) and echoes the raw request target, so the matrix can prove that a passed request
// arrives byte-identical and that a denied request never arrived. Usage: node stub.mjs <port> <record.jsonl>
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';

const [port, record] = [Number(process.argv[2]), process.argv[3]];

createServer((req, res) => {
  const { url, method, headers } = req;
  if (url !== '/api/health') {
    appendFileSync(record, `${JSON.stringify({ method, url, host: headers.host ?? null, xff: headers['x-forwarded-for'] ?? null })}\n`);
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(method === 'HEAD' ? undefined : `upstream saw ${method} ${url}\n`);
}).listen(port, '127.0.0.1');
