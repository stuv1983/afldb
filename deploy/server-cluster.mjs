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

  for (let i = 0; i < workers; i += 1) cluster.fork();

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
      `[afldb] worker ${worker.process.pid} exited (${signal ?? code}); restarting in ${delay}ms`,
    );
    // Deliberately not unref()'d: this timer must keep the primary alive long
    // enough to fork the replacement.
    setTimeout(() => cluster.fork(), delay);
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
  // Each worker runs the standard Next.js standalone server.
  await import('../.next/standalone/server.js');
}
