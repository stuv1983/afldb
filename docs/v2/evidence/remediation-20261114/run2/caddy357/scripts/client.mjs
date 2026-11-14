// caddy357 matrix client. Reads a corpus of `METHOD<TAB>raw-request-target<TAB>expect` lines (expect = pass | deny),
// sends each to Caddy with the raw target untouched (Host: beta.afldb.com), and checks:
//   pass: status 200 and (GET) the upstream echoed exactly the target that was sent (byte-identical, incl. query)
//   deny: status 404 and the body is Caddy's "Not Found" (never an upstream echo)
// Usage: node client.mjs <corpus> <port> <out.tsv> [--quiet]
import { readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';

const [corpus, portArg, out] = process.argv.slice(2, 5);
const port = Number(portArg);
const agent = new http.Agent({ keepAlive: true, maxSockets: 16 });
const lines = readFileSync(corpus, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));

function send(method, target) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: target, agent, headers: { Host: 'beta.afldb.com', 'Accept-Encoding': 'identity' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', (e) => resolve({ status: 0, body: `ERR ${e.code ?? e.message}` }));
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

const results = new Array(lines.length);
let next = 0;
async function worker() {
  for (;;) {
    const i = next++;
    if (i >= lines.length) return;
    const [method, target, expect] = lines[i].split('\t');
    const r = await send(method, target);
    let ok;
    let note = '';
    if (expect === 'pass') {
      ok = r.status === 200 && (method === 'HEAD' || r.body === `upstream saw ${method} ${target}\n`);
      if (!ok) note = r.body.slice(0, 120).replace(/\n/g, '\\n');
    } else {
      // 404 from the deny rules, or 400 from Go's own URL parser for a malformed escape (%zz, a lone %): neither reaches Next
      ok = (r.status === 404 && (method === 'HEAD' || r.body.startsWith('Not Found'))) || (r.status === 400 && !r.body.startsWith('upstream saw'));
      if (!ok) note = r.body.slice(0, 120).replace(/\n/g, '\\n');
    }
    results[i] = `${ok ? 'OK' : 'MISMATCH'}\t${method}\t${expect}\t${r.status}\t${target}\t${note}`;
  }
}
await Promise.all(Array.from({ length: 12 }, worker));
writeFileSync(out, `${results.join('\n')}\n`);
const bad = results.filter((r) => r.startsWith('MISMATCH')).length;
const pass = lines.filter((l) => l.split('\t')[2] === 'pass').length;
console.log(`corpus=${corpus} total=${lines.length} expect_pass=${pass} expect_deny=${lines.length - pass} mismatches=${bad}`);
agent.destroy();
