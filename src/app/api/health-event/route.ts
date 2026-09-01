import { readFileSync } from 'node:fs';
import path from 'node:path';

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { isAppHealthEventType, logAppHealthEvent } from '@/db/queries/app-health';
import { requestIp } from '@/lib/auth/session';
import { RateLimiter } from '@/lib/auth/rate-limit';
import { isValidNlSessionId, NL_SESSION_COOKIE } from '@/lib/nl-session';

export const dynamic = 'force-dynamic';

/**
 * A visitor's browser reporting a genuine client-side failure should be
 * rare -- this bounds a broken reporter (a retry loop, a bug that fires
 * on every render) or a deliberate flood from growing the table or the
 * write volume unboundedly. Generous relative to REDEEM_LIMIT and
 * friends (src/app/beta/actions.ts): this is a passive reporter, not an
 * expensive credential check, and a real client error burst (one bad
 * deploy, hit by many readers) must not get throttled away right when
 * it matters most.
 */
const REPORT_LIMIT = new RateLimiter(120, 60_000);

const MAX_BODY_BYTES = 32 * 1024;

async function readBounded(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;

  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }

      chunks.push(value);
    }
  } catch {
    return null;
  }

  return Buffer.concat(chunks).toString('utf8');
}

let cachedBuildVersion: string | null | undefined;

/**
 * Same BUILD_ID file server-cluster.mjs already reads for its trace
 * headers, read once per worker process and cached -- not from a
 * client-supplied field, so a report can't claim a build it didn't run.
 * Falls back to null on any failure (a bare `next dev`, an unexpected
 * standalone layout): a missing build_version must never be why a
 * report is dropped.
 */
function buildVersion(): string | null {
  if (cachedBuildVersion !== undefined) return cachedBuildVersion;
  for (const rel of ['.next/BUILD_ID', '../.next/BUILD_ID']) {
    try {
      cachedBuildVersion = readFileSync(path.join(process.cwd(), rel), 'utf8').trim();
      return cachedBuildVersion;
    } catch {
      // try the next candidate
    }
  }
  cachedBuildVersion = null;
  return cachedBuildVersion;
}

/**
 * Public by design (middleware.ts's PUBLIC_PREFIXES) -- a visitor's
 * browser must be able to report a failure whether or not it is past
 * the beta gate. Never returns anything about the write's success or
 * the server's own state; see /api/health's comment for the same
 * discipline on a public endpoint.
 */
export async function POST(request: Request) {
  if (REPORT_LIMIT.check(`ip:${(await requestIp()) ?? 'unknown'}`)) {
    return new NextResponse(null, { status: 429 });
  }

  const raw = await readBounded(request);
  if (raw === null) {
    return new NextResponse(null, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) return new NextResponse(null, { status: 400 });
  const b = body as Record<string, unknown>;

  if (!isAppHealthEventType(b.eventType)) return new NextResponse(null, { status: 400 });

  // Server-resolved, never client-supplied: nl_sid is httpOnly (middleware.ts),
  // so the reporter cannot read it itself, and a claimed session id from the
  // request body would be exactly the kind of client-controlled identifier
  // this cookie is deliberately unsigned and low-stakes enough to allow, but
  // there is no reason to accept one when the real cookie is right here.
  const sessionId = (await cookies()).get(NL_SESSION_COOKIE)?.value;

  logAppHealthEvent({
    eventType: b.eventType,
    route: typeof b.route === 'string' ? b.route : null,
    buildVersion: buildVersion(),
    sessionId: isValidNlSessionId(sessionId) ? sessionId : null,
    navigationId: typeof b.navigationId === 'string' ? b.navigationId : null,
    reactErrorCode: typeof b.reactErrorCode === 'string' ? b.reactErrorCode : null,
    recovered: typeof b.recovered === 'boolean' ? b.recovered : null,
    relatedSearchClientRef: typeof b.relatedSearchClientRef === 'string' ? b.relatedSearchClientRef : null,
    // The worker handling THIS report, not necessarily the one that
    // rendered the page the failure happened on -- a client script has
    // no reliable way to read the response headers of the navigation
    // that loaded itself. Still meaningful: all workers share one build,
    // and an even spread here is itself evidence against a single bad
    // worker, matching what the 2026-08-18 investigation already found.
    workerId: process.env.AFLDB_WORKER_ID ?? null,
    requestId: null,
    timeSinceNavigationMs: typeof b.timeSinceNavigationMs === 'number' && b.timeSinceNavigationMs >= 0
      ? Math.round(b.timeSinceNavigationMs)
      : null,
    detail: typeof b.detail === 'string' ? b.detail : null,
  });

  // 204: nothing for the caller to parse, nothing to distinguish a
  // validated report from a silently-dropped one.
  return new NextResponse(null, { status: 204 });
}
