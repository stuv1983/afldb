/**
 * Clustered entry point for the AFLDB production server.
 *
 * Server-side rendering is CPU-bound and Node is single-threaded, so one
 * process serialises every concurrent render regardless of how many
 * cores the host has. Measured on the dev server, a single process holds
 * ~46 req/s with p95 near 1.5s; the box has 24 cores sitting idle.
 *
 * Node's cluster module round-robins accepted connections across
 * workers, all sharing one listening socket, so the reverse proxy still
 * sees a single upstream port.
 *
 * Worker count comes from AFLDB_WORKERS, defaulting to 4. It is
 * deliberately not "one per core": each worker holds its own PostgreSQL
 * pool, and 24 workers x 10 connections would exhaust max_connections.
 *
 * That default suits a local cluster (max_connections=100). Against a
 * managed database the connection limit is much lower and the ceiling is
 * workers x (AFLDB_POOL_MAX + 3) — the +3 being each worker's auth pool.
 * deploy/afldb.service sets both explicitly; see docs/deployment.md §5.
 */
import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';

const configured = Number(process.env.AFLDB_WORKERS);
const workers = Number.isSafeInteger(configured) && configured > 0
  ? configured
  : Math.min(4, availableParallelism());

if (cluster.isPrimary) {
  console.log(`[afldb] primary ${process.pid} starting ${workers} worker(s)`);

  // AFLDB_WORKER_ID is a small stable ordinal (1..N), NOT cluster's own
  // worker.id, which counts up forever: a worker that dies and is replaced
  // gets a fresh cluster id, so an investigation correlating failures with
  // "worker 3" would silently be looking at two different processes across
  // a restart. The ordinal is reused by the replacement, which is what
  // makes it a meaningful axis to group by. PID is exported alongside it
  // (by the worker itself) to tell those apart when it matters.
  // cluster.id -> ordinal, so a replacement fork below can inherit the
  // ordinal of the worker it replaces rather than being handed a new one.
  //
  // AFLDB_WORKER_COUNT travels with it (AFLDB-ISSUE-134). Post-settle ISR
  // invalidation has to reach EVERY worker — Next 16 keeps page invalidation
  // in per-process memory — so the caller posts until every ordinal has
  // answered, and needs to know how many that is. A worker cannot re-derive
  // it: AFLDB_WORKERS is unset on hosts taking the min(4, availableParallelism())
  // default, and availableParallelism() in a worker would report the machine's
  // cores, not the fork count. The primary is the only process that knows.
  const ordinals = new Map();
  const fork = (ordinal) => {
    const worker = cluster.fork({
      AFLDB_WORKER_ID: String(ordinal),
      AFLDB_WORKER_COUNT: String(workers),
    });
    ordinals.set(worker.id, ordinal);
    return worker;
  };

  for (let i = 0; i < workers; i += 1) fork(i + 1);

  // Restart crashed workers, but never in a tight loop. A worker that dies
  // immediately on startup (database down at boot, EADDRINUSE, a throw during
  // server.js import) would otherwise be re-forked with zero delay forever,
  // pegging a core and flooding the journal while `systemctl is-active afldb`
  // still reports healthy. Back off between restarts, and if too many happen
  // inside one window, exit so systemd's StartLimitBurst crash-loop protection
  // finally engages instead of being bypassed by an ever-living primary.
  const RESTART_WINDOW_MS = 60_000;
  const MAX_RESTARTS = 10;
  const restarts = [];

  cluster.on('exit', (worker, code, signal) => {
    const ordinal = ordinals.get(worker.id);
    ordinals.delete(worker.id);

    // A worker that exits on SIGTERM/SIGINT is a deliberate shutdown.
    if (signal === 'SIGTERM' || signal === 'SIGINT') return;

    const now = Date.now();
    while (restarts.length > 0 && now - restarts[0] > RESTART_WINDOW_MS) restarts.shift();
    restarts.push(now);

    if (restarts.length > MAX_RESTARTS) {
      console.error(
        `[afldb] ${restarts.length} worker restarts within ${RESTART_WINDOW_MS / 1000}s; `
        + 'giving up so systemd can back off',
      );
      process.exit(1);
    }

    const delay = Math.min(1000 * 2 ** (restarts.length - 1), 30_000);
    console.error(
      `[afldb] worker ${worker.process.pid} (id ${ordinal ?? '?'}) exited (${signal ?? code}); `
      + `restarting in ${delay}ms`,
    );
    // Deliberately not unref()'d: this timer must keep the primary alive long
    // enough to fork the replacement.
    setTimeout(() => fork(ordinal ?? ordinals.size + 1), delay);
  });

  const shutdown = (signal) => {
    console.log(`[afldb] ${signal} received, stopping workers`);
    for (const worker of Object.values(cluster.workers ?? {})) worker?.kill(signal);
    // Give workers a moment to close connections before exiting.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
} else {
  // ------------------------------------------------------ request tracing
  //
  // OPT-IN, via AFLDB_TRACE_REQUESTS=on. Off, this branch is a no-op and
  // the worker behaves exactly as it did before.
  //
  // Why here and not in middleware.ts: middleware runs in Next's edge
  // sandbox, where process.env is resolved at BUILD time. AFLDB_WORKER_ID
  // is set at FORK time, so middleware cannot see it -- the one fact this
  // instrumentation exists to report. This wrapper is plain Node in the
  // worker process itself, which can.
  //
  // Added to diagnose a production-only React hydration mismatch (error
  // #418, ~2.2% of loads in the 12k UI sweep, absent from 480 attempts
  // against single-process `next dev`). The leading hypothesis is that
  // this very cluster is the cause: four processes round-robin behind one
  // socket, each with its own in-memory Next.js cache, so a page's SSR and
  // its follow-up RSC request can be served by processes holding different
  // state. Confirming or killing that needs the worker identity attached
  // to individual responses, which is what these headers are for.
  if (process.env.AFLDB_TRACE_REQUESTS === 'on') {
    // createRequire, NOT `await import('node:http')`: an ESM module
    // namespace object is frozen, so assigning to its createServer throws
    // "Cannot assign to read only property 'createServer' of object
    // '[object Module]'" and takes the worker down with it. The CJS view of
    // the same builtin is an ordinary mutable object, and it is the same
    // underlying module instance the standalone server will require.
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const http = require('node:http');
    const { randomUUID } = await import('node:crypto');
    const { readFileSync } = await import('node:fs');

    const workerId = process.env.AFLDB_WORKER_ID ?? '?';
    // The build the response was rendered by. A sweep spanning a redeploy
    // would otherwise mix two builds' behaviour under one set of numbers.
    let buildId = 'unknown';
    try {
      buildId = readFileSync(new URL('../.next/standalone/.next/BUILD_ID', import.meta.url), 'utf8').trim();
    } catch {
      try {
        buildId = readFileSync(new URL('../.next/BUILD_ID', import.meta.url), 'utf8').trim();
      } catch { /* headers still carry worker and pid, which is the point */ }
    }

    const createServer = http.createServer.bind(http);
    http.createServer = (...args) => {
      const handler = args.find((arg) => typeof arg === 'function');
      if (!handler) return createServer(...args);
      const options = args.find((arg) => arg && typeof arg === 'object');

      const traced = (req, res) => {
        const requestId = randomUUID();
        const startedAt = Date.now();

        // Set before the handler runs: Next streams, so headers are flushed
        // as soon as the first chunk is written and anything set afterwards
        // would be too late for exactly the responses being measured.
        res.setHeader('x-afldb-worker', workerId);
        res.setHeader('x-afldb-pid', String(process.pid));
        res.setHeader('x-afldb-request-id', requestId);
        res.setHeader('x-afldb-build', buildId);

        res.on('finish', () => {
          // One line per request, journald-visible. Fields are ordered so
          // `journalctl -u afldb | grep '\[trace\]'` is directly parseable.
          console.log(
            `[trace] ts=${new Date(startedAt).toISOString()} worker=${workerId} pid=${process.pid} `
            + `rid=${requestId} build=${buildId} status=${res.statusCode} `
            + `ms=${Date.now() - startedAt} method=${req.method} url=${req.url}`,
          );
        });

        return handler(req, res);
      };

      return options ? createServer(options, traced) : createServer(traced);
    };
  }

  // Each worker runs the standard Next.js standalone server.
  await import('../.next/standalone/server.js');
}
