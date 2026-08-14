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
export async function GET() {
  const startedAt = Date.now();

  try {
    await sql`SELECT 1`;
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
  }
}
