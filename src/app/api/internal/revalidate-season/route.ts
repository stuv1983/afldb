import { timingSafeEqual } from 'node:crypto';

import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

import { RateLimiter } from '@/lib/auth/rate-limit';
import {
  isPlausibleSeason,
  REVALIDATE_SECRET_ENV,
  REVALIDATE_SECRET_HEADER,
} from '@/lib/acquisition/season-revalidation';
import { seasonPath } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * AFLDB-ISSUE-134 — the in-process half of post-settle ISR invalidation.
 *
 * `revalidatePath()` can only be called inside a Next server context, and the
 * in-season settle (`deploy/afldb-settle-afltables.service`) is a separate
 * systemd job with no framework runtime. This route is the one place that
 * gap is bridged: the settle, having COMMITTED its transaction, posts the
 * season it changed and each worker invalidates its own copy of that one
 * page.
 *
 * ONE ROUTE, ONE WORKER. `deploy/server-cluster.mjs` runs `AFLDB_WORKERS`
 * independent processes and Next 16 keeps page invalidation in per-process
 * memory (`tagsManifest`, plus an in-memory LRU in front of the file cache),
 * so this handler can only ever speak for the process it happens to run in.
 * That is why the reply names the worker: the caller keeps posting on fresh
 * connections until every ordinal has answered. See
 * `src/lib/acquisition/season-revalidation.ts` for the framework evidence.
 *
 * WHAT A CALLER MAY ASK FOR. A season year, and nothing else. The path is
 * built here by `seasonPath()`, so there is no input — not a path, not a
 * pattern, not a tag, not a layout flag — by which this route can be turned
 * into a general-purpose cache purge. The blast radius of the shared secret
 * leaking is "someone can make season pages re-render", which is the smallest
 * it can be made without giving up the feature.
 *
 * WHY IT IS NOT REACHABLE FROM THE INTERNET. Two independent gates, both of
 * which must pass:
 *
 *   1. The request must not have come through the reverse proxy. Caddy
 *      (`deploy/Caddyfile.production`) proxies the public site to
 *      127.0.0.1:3100 and adds `X-Forwarded-For` to everything it forwards,
 *      so a request carrying those headers did not originate on this host.
 *   2. The shared secret must match, compared in constant time.
 *
 * Unconfigured, it answers 503 and does nothing at all — the same fail-closed
 * shape as `/api/admin/email-intake` and `AFLDB_SETTLE_TRIGGER`.
 */

/**
 * Counts only FAILED secret checks. The legitimate caller is one nightly job
 * making a handful of requests; a limiter that charged those would eventually
 * lock the settle out of publishing its own work.
 */
const AUTH_FAILURES = new RateLimiter(10, 15 * 60 * 1000);

/**
 * The worker's own ordinal, assigned by `deploy/server-cluster.mjs` at fork
 * time. Absent under a plain single-process `next start`, which is a truthful
 * "there is one process here" rather than an error.
 */
function workerIdentity(): { workerId: string | null; workerCount: number } {
  const workerId = process.env.AFLDB_WORKER_ID ?? null;
  const declared = Number(process.env.AFLDB_WORKER_COUNT);
  const workerCount = Number.isSafeInteger(declared) && declared > 0 ? declared : 1;
  return { workerId, workerCount };
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Compare a buffer with itself when the lengths differ, so a length
  // mismatch costs the same as a same-length mismatch. Same shape as
  // /api/admin/email-intake.
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export async function POST(request: Request) {
  const configuredSecret = process.env[REVALIDATE_SECRET_ENV];
  if (!configuredSecret) {
    return NextResponse.json(
      { error: 'Post-settle revalidation is not configured on this server.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Gate 1: proxied requests are not local requests. Checked before the
  // secret so a probe from the internet learns nothing about whether the
  // secret it guessed was the right length.
  if (request.headers.get('x-forwarded-for') !== null
    || request.headers.get('x-forwarded-host') !== null) {
    return NextResponse.json(
      { error: 'Not found.' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // One bucket: every legitimate caller is on this host, so there is no
  // per-client identity worth keying on and nothing to be gained by letting
  // an attacker pick their own bucket.
  const key = 'loopback';
  if (AUTH_FAILURES.peek(key)) {
    return NextResponse.json(
      { error: 'Too many failed attempts.' },
      { status: 429, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Gate 2.
  const provided = request.headers.get(REVALIDATE_SECRET_HEADER) ?? '';
  if (!timingSafeStringEqual(provided, configuredSecret)) {
    AUTH_FAILURES.check(key);
    return NextResponse.json(
      { error: 'Unauthorized.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  let body: { season?: unknown };
  try {
    body = await request.json() as { season?: unknown };
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // A number, an integer, and a year a season could actually be. Not a
  // string that happens to parse: `"2026/../../admin"` must fail here, not
  // be coerced into something that looks like a year.
  if (!isPlausibleSeason(body.season)) {
    return NextResponse.json(
      { error: 'season must be an integer year.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // The path is composed here, from an integer, by the same helper every
  // season link on the site uses. `revalidatePath` turns it into the implicit
  // page tag `_N_T_/seasons/<year>` — the tag the deployed prerender was
  // observed to carry in AFLDB-ISSUE-133 — for this process only.
  const path = seasonPath(body.season);
  revalidatePath(path);

  const { workerId, workerCount } = workerIdentity();
  console.log(
    `[revalidate-season] ${path} invalidated on worker ${workerId ?? 'single'} `
    + `(pid ${process.pid})`,
  );

  return NextResponse.json(
    { ok: true, path, workerId, workerCount },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
