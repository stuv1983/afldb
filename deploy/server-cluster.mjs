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

  cluster.on('exit', (worker, code, signal) => {
    // A worker that exits on SIGTERM/SIGINT is a deliberate shutdown.
    if (signal === 'SIGTERM' || signal === 'SIGINT') return;
    console.error(`[afldb] worker ${worker.process.pid} exited (${signal ?? code}); restarting`);
    cluster.fork();
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
