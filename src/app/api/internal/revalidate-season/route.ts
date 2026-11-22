import { timingSafeEqual } from 'node:crypto';

import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

import { RateLimiter } from '@/lib/auth/rate-limit';
import {
  classifyForwardedClient,
  isPlausibleSeason,
  isRevalidatablePlayerPath,
  isServableForwardedClient,
  MAX_REVALIDATE_PLAYER_PATHS,
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
 * WHAT A CALLER MAY ASK FOR. A season year, and (AFLDB-ISSUE-376) optionally
 * up to `MAX_REVALIDATE_PLAYER_PATHS` canonical `/players/<slug>-<id>` paths —
 * the old and new winner of an award correction, whose profiles each worker
 * caches separately — each re-validated here by shape; nothing else. The paths are
 * built here from it — `/seasons/<year>` by `seasonPath()` and, since
 * AFLDB-ISSUE-371 (the Brownlow publication action posts here too),
 * `/brownlow/<year>` — so there is no input — not a path, not a
 * pattern, not a tag, not a layout flag — by which this route can be turned
 * into a general-purpose cache purge. The blast radius of the shared secret
 * leaking is "someone can make a season's two pages re-render", which is the
 * smallest it can be made without giving up the feature. Since
 * AFLDB-ISSUE-372 the awards revalidation follow-up posts here too, for the
 * seasons an award publication changes; the award-season pages themselves
 * need nothing (`/awards/[slug]/[season]` has no `generateStaticParams`, so
 * it renders dynamically and is never cached).
 *
 * WHY IT IS NOT REACHABLE FROM THE INTERNET. Two independent gates, both of
 * which must pass:
 *
 *   1. The forwarded client address must resolve to loopback. NOT "must be
 *      absent" — that was this route's first, wrong premise, and it made the
 *      feature 404 on every request on the real host (AFLDB-ISSUE-134 §10.2):
 *      Next 16 synthesises `x-forwarded-for` and `x-forwarded-host` on every
 *      request before any handler runs, so absence is not a loopback signal.
 *      What makes the VALUE trustworthy is the deployment contract —
 *      `header_up X-Forwarded-For {remote_host}` on every proxy block, which
 *      overwrites rather than appends, and `HOSTNAME=127.0.0.1` in
 *      `deploy/afldb.service`, which binds the application to loopback. A
 *      public client cannot forge the header past Caddy and cannot reach the
 *      socket without Caddy. `classifyForwardedClient()` in
 *      `@/lib/acquisition/season-revalidation` holds the full argument and
 *      the cases; the tracked proxy lines it rests on are asserted in
 *      `tests/settle-season-revalidation.test.ts`.
 *   2. The shared secret must match, compared in constant time.
 *
 * `x-forwarded-host` is DELIBERATELY not a gate. Next fills it from the
 * request's own `Host` header, which is client input on both paths, so it
 * carries no information about where the request came from.
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

/**
 * The public pages a season's year names, and the only paths this route can
 * ever invalidate: the season page, and the season's Brownlow count page
 * (AFLDB-ISSUE-371 — a publication changes it, and every worker holds its
 * own copy). Both are composed from the integer; nothing else is reachable.
 */
function seasonRevalidationPaths(season: number): string[] {
  return [seasonPath(season), `/brownlow/${season}`];
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

  // Gate 1: the caller must be on this host. Checked before the secret so a
  // probe from the internet learns nothing about whether the secret it
  // guessed was the right length, and answers 404 rather than 403 so the
  // route does not confirm its own existence to the internet.
  const forwardedClient = classifyForwardedClient(request.headers.get('x-forwarded-for'));
  if (!isServableForwardedClient(forwardedClient)) {
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

  let body: { season?: unknown; playerPaths?: unknown };
  try {
    body = await request.json() as { season?: unknown; playerPaths?: unknown };
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

  // AFLDB-ISSUE-376: an optional, bounded list of canonical player-profile
  // paths (the old and new winner of an award correction). Absent is the
  // season-only contract; present it must be an array of at most
  // MAX_REVALIDATE_PLAYER_PATHS strings, EVERY one a canonical
  // `/players/<slug>-<id>`. One bad entry refuses the whole request (nothing is
  // invalidated, not even the season): a caller that sends an unvalidated
  // string has a bug worth surfacing, not a partial purge worth tolerating.
  let playerPaths: string[] = [];
  if (body.playerPaths !== undefined) {
    const requested = body.playerPaths;
    if (
      !Array.isArray(requested)
      || requested.length > MAX_REVALIDATE_PLAYER_PATHS
      || !requested.every(isRevalidatablePlayerPath)
    ) {
      return NextResponse.json(
        { error: `playerPaths must be at most ${MAX_REVALIDATE_PLAYER_PATHS} canonical /players/<slug>-<id> paths.` },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    playerPaths = [...new Set(requested)];
  }

  // The paths are composed here, from an integer, by the same helpers every
  // season link on the site uses. `revalidatePath` turns each into its
  // implicit pathname tag (`_N_T_/seasons/<year>` — the tag the deployed
  // prerender was observed to carry in AFLDB-ISSUE-133) for this process only.
  // A concrete path takes NO type argument: with one it would name a
  // `/<path>/page` tag that no page carries (AFLDB-ISSUE-371).
  const path = seasonPath(body.season);
  const paths = seasonRevalidationPaths(body.season);
  for (const one of paths) revalidatePath(one);
  for (const one of playerPaths) revalidatePath(one);

  const { workerId, workerCount } = workerIdentity();
  console.log(
    `[revalidate-season] ${[...paths, ...playerPaths].join(' ')} invalidated on worker `
    + `${workerId ?? 'single'} (pid ${process.pid})`,
  );

  return NextResponse.json(
    { ok: true, path, paths, playerPaths, workerId, workerCount },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
