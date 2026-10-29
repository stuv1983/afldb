/**
 * Populated-ledger rollback rehearsal: anonymous public-route probe of one running application.
 * Records the status and a digest of the visible text of each route, plus whether the expected synthetic
 * names appear, so the same public results can be compared across previous -> V2 -> previous -> V2.
 * Loopback only (the base URL must be 127.0.0.1); read-only GETs; no credentials.
 *
 *   node --import tsx tools/v2/rollback-public-probe.ts <port> <out.json>
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const [port, out] = process.argv.slice(2);
if (!/^\d{4,5}$/.test(port ?? '') || !out) throw new Error('usage: rollback-public-probe.ts <port> <out.json>');
const base = `http://127.0.0.1:${port}`;

/** Route -> synthetic names that must appear on it. */
const ROUTES: [string, string[]][] = [
  ['/awards/rb-pop-award-1/2092', ['Synthetic RB C2']],
  ['/awards/rb-pop-award-2/2092', ['Synthetic RB C2']],
  ['/awards/rb-pop-award-3/2091', ['Synthetic RB C1']],
  ['/awards/rb-pop-award-4/2092', ['Synthetic RB C1']],
  ['/awards/coleman/2095', ['Synthetic RB CM-C', 'Synthetic RB CM-E', 'Synthetic RB CM-G']],
  ['/brownlow/2086', ['Synthetic RB BL-c1']],
  ['/brownlow/2089', ['Synthetic RB BL-a1']],
  ['/seasons/2092', []],
  ['/brownlow', []],
  ['/awards/coleman', []],
];

const visibleText = (html: string): string => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

async function main(): Promise<void> {
  const results: Record<string, unknown> = {};
  for (const [path, names] of ROUTES) {
    const response = await fetch(`${base}${path}`, { redirect: 'manual' });
    const text = visibleText(await response.text());
    results[path] = {
      status: response.status,
      location: response.headers.get('location'),
      textSha256: createHash('sha256').update(text).digest('hex'),
      textLength: text.length,
      contains: Object.fromEntries(names.map((name) => [name, text.includes(name)])),
    };
  }
  writeFileSync(out, `${JSON.stringify({ port: Number(port), routes: results }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`probe ${port}: ${ROUTES.length} routes recorded`);
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
