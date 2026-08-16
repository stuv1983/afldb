import { NextResponse } from 'next/server';

import { sql } from '@/db/client';

export const dynamic = 'force-dynamic';

/**
 * Health check for the process manager and reverse proxy.
 *
 * Reports only whether the application is running and the database is
 * reachable. No version numbers, hostnames, connection strings or stack
 * traces: this endpoint may be reachable from the proxy.
 */

/**
 * A health check must answer, not wait.
 *
 * The client's statement_timeout bounds a query the database is
 * actually running, but not the wait for a connection to run it on:
 * when the pool is exhausted -- the exact situation a health check
 * exists to reveal -- `sql` queues indefinitely and the probe hangs
 * instead of failing. A process manager reads a hang as "still
 * checking" and leaves a wedged worker in the rotation, which is the
 * worst of both answers.
 */
const PROBE_TIMEOUT_MS = 2000;

export async function GET() {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      sql`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`health probe exceeded ${PROBE_TIMEOUT_MS}ms`)),
          PROBE_TIMEOUT_MS,
        );
      }),
    ]);
    return NextResponse.json(
      { status: 'ok', database: 'ok', latencyMs: Date.now() - startedAt },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[health] database unreachable', error);
    return NextResponse.json(
      { status: 'error', database: 'unreachable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  } finally {
    clearTimeout(timer);
  }
}
