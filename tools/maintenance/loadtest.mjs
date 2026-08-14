/**
 * Load test for AFLDB.
 *
 *   node tools/maintenance/loadtest.mjs [--concurrency 20] [--duration 20]
 *
 * Dependency-free: uses Node's fetch and a fixed pool of workers. Runs
 * against the full migrated dataset, because a benchmark on a small
 * fixture proves nothing about the real workload.
 *
 * Reports requests/sec, P50/P95/P99 and errors per route so a slow route
 * is attributable rather than hidden in an aggregate.
 */

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};

const BASE = process.env.AFLDB_LOADTEST_URL ?? 'http://127.0.0.1:3100';
const CONCURRENCY = argValue('concurrency', 20);
const DURATION_MS = argValue('duration', 20) * 1000;

// Representative public workload.
const ROUTES = [
  { name: 'homepage', path: '/' },
  { name: 'player profile', path: '/players/scott-pendlebury-4182' },
  { name: 'player profile (old)', path: '/players/bob-skilton-3702' },
  { name: 'player index', path: '/players' },
  { name: 'player index p20', path: '/players?page=20&sort=goals' },
  { name: 'club page', path: '/clubs/geelong' },
  { name: 'season page', path: '/seasons/1989' },
  { name: 'season page (recent)', path: '/seasons/2024' },
  { name: 'match page', path: '/matches/15000' },
  { name: 'records', path: '/records/most-games' },
  { name: 'brownlow season', path: '/brownlow/1989' },
  { name: 'global search', path: '/search?q=ablett' },
  { name: 'autocomplete', path: '/api/search/autocomplete?q=abl' },
  { name: 'advanced search', path: '/advanced-search?games_min=200&goals_min=100&finals_min=15' },
  { name: 'advanced search (wide)', path: '/advanced-search?games_min=1' },
];

const stats = new Map(ROUTES.map((r) => [r.name, { times: [], errors: 0, bytes: 0 }]));

const percentile = (sorted, p) =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

async function worker(deadline) {
  while (Date.now() < deadline) {
    const route = ROUTES[Math.floor(Math.random() * ROUTES.length)];
    const entry = stats.get(route.name);
    const started = performance.now();
    try {
      const response = await fetch(BASE + route.path);
      const body = await response.arrayBuffer();
      const elapsed = performance.now() - started;
      if (response.ok) {
        entry.times.push(elapsed);
        entry.bytes += body.byteLength;
      } else {
        entry.errors += 1;
      }
    } catch {
      entry.errors += 1;
    }
  }
}

console.log(`AFLDB load test`);
console.log(`  target      : ${BASE}`);
console.log(`  concurrency : ${CONCURRENCY}`);
console.log(`  duration    : ${DURATION_MS / 1000}s`);
console.log(`  routes      : ${ROUTES.length}\n`);

const startedAt = Date.now();
await Promise.all(
  Array.from({ length: CONCURRENCY }, () => worker(startedAt + DURATION_MS)),
);
const elapsedSec = (Date.now() - startedAt) / 1000;

let totalRequests = 0;
let totalErrors = 0;
const allTimes = [];

console.log(
  'route'.padEnd(24)
  + 'n'.padStart(7)
  + 'p50'.padStart(9)
  + 'p95'.padStart(9)
  + 'p99'.padStart(9)
  + 'max'.padStart(9)
  + 'err'.padStart(6),
);
console.log('-'.repeat(73));

for (const route of ROUTES) {
  const entry = stats.get(route.name);
  const sorted = entry.times.slice().sort((a, b) => a - b);
  totalRequests += sorted.length;
  totalErrors += entry.errors;
  allTimes.push(...sorted);

  console.log(
    route.name.padEnd(24)
    + String(sorted.length).padStart(7)
    + `${percentile(sorted, 0.5).toFixed(0)}ms`.padStart(9)
    + `${percentile(sorted, 0.95).toFixed(0)}ms`.padStart(9)
    + `${percentile(sorted, 0.99).toFixed(0)}ms`.padStart(9)
    + `${(sorted.at(-1) ?? 0).toFixed(0)}ms`.padStart(9)
    + String(entry.errors).padStart(6),
  );
}

allTimes.sort((a, b) => a - b);
console.log('-'.repeat(73));
console.log(`\nTotal      : ${totalRequests.toLocaleString()} requests in ${elapsedSec.toFixed(1)}s`);
console.log(`Throughput : ${(totalRequests / elapsedSec).toFixed(1)} req/s`);
console.log(`Latency    : p50 ${percentile(allTimes, 0.5).toFixed(0)}ms · `
  + `p95 ${percentile(allTimes, 0.95).toFixed(0)}ms · `
  + `p99 ${percentile(allTimes, 0.99).toFixed(0)}ms`);
console.log(`Errors     : ${totalErrors}`);

if (totalErrors > 0) process.exitCode = 1;
