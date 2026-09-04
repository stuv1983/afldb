/**
 * AFLDB-ISSUE-134 — publishing a settled season to the public ISR cache.
 *
 * THE PROBLEM. `/seasons/[year]` is ISR (`export const revalidate = 3600`,
 * every season prerendered by `generateStaticParams()`), and the in-season
 * settle is an out-of-process systemd job. Nothing connected the two, so a
 * settle that inserted real matches at 22:37 was invisible to readers until
 * the window expired — measured on production in `AFLDB-ISSUE-133`
 * (prerender 22:14:46 → rows 22:37:47 → regenerated 23:50:48 AEST).
 *
 * WHY THIS IS NOT ONE HTTP CALL. `revalidatePath()` records the invalidation
 * in `tagsManifest`, a module-level `Map` in the worker's own heap
 * (`next/dist/server/lib/incremental-cache/tags-manifest.external.js`), and
 * the ISR read consults that Map plus a per-process in-memory LRU that sits
 * IN FRONT of the file cache (`file-system-cache.js`). Next 16 has no
 * cross-process channel for a page invalidation: the
 * `x-next-revalidated-tags` header is only consulted for `FETCH` entries,
 * never for `APP_PAGE` ones. `deploy/server-cluster.mjs` runs
 * `AFLDB_WORKERS` independent processes behind one socket (production 2,
 * development 4), so ONE request invalidates ONE worker and leaves the rest
 * serving the stale page for the rest of their own hour.
 *
 * SO: post until every worker has answered. Each worker already carries a
 * stable ordinal (`AFLDB_WORKER_ID`) and, since this issue, the fork count
 * (`AFLDB_WORKER_COUNT`); the route echoes both, and this module keeps
 * posting on FRESH TCP connections — `node:cluster` round-robins
 * *connections*, so a kept-alive socket would return to the same worker for
 * ever — until it has seen every ordinal or run out of attempts. Anything
 * short of full coverage is a failure the caller reports; it is never
 * silently accepted, because a partly-invalidated cluster is exactly the
 * bug this exists to remove.
 *
 * WHAT THIS MODULE MUST NOT DO. It must not import Next: it is loaded by the
 * settle CLI, a plain `tsx` process with no framework runtime. It must not
 * decide whether the settle succeeded — it is handed that verdict. And it
 * must never be reached before the settle transaction has committed.
 */
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

/** The path segment of the route. Fixed; never taken from a caller. */
export const REVALIDATE_ROUTE = '/api/internal/revalidate-season';

/** The header the shared secret travels in. */
export const REVALIDATE_SECRET_HEADER = 'x-afldb-revalidate-secret';

/** The two names a host must set for any of this to happen at all. */
export const REVALIDATE_URL_ENV = 'AFLDB_REVALIDATE_URL';
export const REVALIDATE_SECRET_ENV = 'AFLDB_REVALIDATE_SECRET';

/**
 * Hosts the site may be addressed by. The settle and the web service run on
 * the same machine, so there is no legitimate reason for this request to
 * leave it — and a `.env` typo that sent the shared secret to a public host
 * would be a credential disclosure rather than a misconfiguration.
 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * AFL's first season, and a year the wall clock cannot plausibly reach while
 * this code runs. The route builds `/seasons/<year>` itself, so this is not
 * the security boundary — it is the sanity boundary that keeps a corrupted
 * bundle from asking for a path nobody prerendered.
 */
export const FIRST_SEASON = 1897;
export const LAST_PLAUSIBLE_SEASON = 2200;

export function isPlausibleSeason(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= FIRST_SEASON
    && value <= LAST_PLAUSIBLE_SEASON;
}

export type RevalidateConfig = {
  /** Origin of the running site, e.g. `http://127.0.0.1:3100`. Loopback only. */
  origin: string;
  secret: string;
};

/**
 * The host's configuration, or `null` when this host has not been provisioned
 * for post-settle invalidation.
 *
 * FAIL CLOSED, LOUDLY, ON A HALF-CONFIGURATION. Unset is a legitimate state
 * (a workstation, a host still on the documented rebuild-and-restart
 * routine). One of the two set is a mistake, and silently doing nothing
 * would leave an operator believing invalidation was live.
 */
export function readRevalidateConfig(
  env: Record<string, string | undefined>,
): RevalidateConfig | null {
  const rawUrl = (env[REVALIDATE_URL_ENV] ?? '').trim();
  const secret = (env[REVALIDATE_SECRET_ENV] ?? '').trim();
  if (!rawUrl && !secret) return null;
  if (!rawUrl || !secret) {
    throw new Error(
      `${REVALIDATE_URL_ENV} and ${REVALIDATE_SECRET_ENV} must be set together; `
      + `${rawUrl ? REVALIDATE_SECRET_ENV : REVALIDATE_URL_ENV} is missing.`,
    );
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${REVALIDATE_URL_ENV} is not a valid URL: '${rawUrl}'.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${REVALIDATE_URL_ENV} must be http or https, not '${url.protocol}'.`);
  }
  if (!LOOPBACK_HOSTS.has(url.hostname) && !LOOPBACK_HOSTS.has(`[${url.hostname}]`)) {
    throw new Error(
      `${REVALIDATE_URL_ENV} must address the local site over loopback `
      + `(127.0.0.1, ::1 or localhost); '${url.hostname}' is not. The shared secret must `
      + 'never leave this host.',
    );
  }
  return { origin: url.origin, secret };
}

/**
 * The counters that mean "this run changed canonical season data".
 *
 * Deliberately the CANONICAL and LEDGER counters only, never the observation
 * ones: an idempotent rerun over identical source data still sees every
 * observation and still writes an `import_batches` row, and re-rendering
 * ~130 season pages' worth of queries nightly for that would be work for
 * nothing. `AFLDB-ISSUE-122`'s own idempotence claim is stated in exactly
 * these terms — "a rerun over identical source data writes no canonical row
 * and no ledger row".
 */
export type SettleChangeCounters = {
  canonicalRowsInserted: number;
  canonicalRowsUpdated: number;
  canonicalApplicationsLogged: number;
};

/**
 * Whether an applied settle run should publish its season.
 *
 * `applied` is the transaction boundary: `runSettleAfltables()` has returned,
 * so the transaction is committed. A dry run is `false` and never reaches
 * here with a truthy verdict, and a run that threw never reaches here at all.
 */
export function shouldRevalidateSeason(
  run: { applied: boolean; counters: SettleChangeCounters } | null,
): boolean {
  if (!run || !run.applied) return false;
  const { canonicalRowsInserted, canonicalRowsUpdated, canonicalApplicationsLogged } = run.counters;
  return canonicalRowsInserted + canonicalRowsUpdated + canonicalApplicationsLogged > 0;
}

/** One worker's answer. */
export type RevalidateReply = {
  status: number;
  workerId: string | null;
  workerCount: number;
  path: string | null;
};

/**
 * The transport, injectable so tests never open a socket. Resolves with the
 * reply; rejects only on a transport failure (the caller treats a non-2xx
 * status as a failure too).
 */
export type RevalidatePoster = (
  config: RevalidateConfig, season: number,
) => Promise<RevalidateReply>;

export type RevalidateOutcome = {
  ok: boolean;
  season: number;
  /** The path the workers reported invalidating. Null if none answered. */
  path: string | null;
  /** Distinct worker ordinals reached, in the order first seen. */
  workersReached: string[];
  /** The cluster size the workers reported, or 0 if none answered. */
  workerCount: number;
  attempts: number;
  /** One bounded line per failed attempt. Empty when everything answered. */
  failures: string[];
};

/**
 * Attempts before giving up, as a multiple of the reported worker count.
 *
 * `node:cluster` round-robins connections, so N fresh connections normally
 * cover N workers exactly. The multiple is headroom for the one thing that
 * perturbs the rotation: ordinary reader traffic arriving between our
 * connections. Eight passes over a 2- or 4-worker cluster is a handful of
 * requests, and the bound is what stops a wedged worker turning a nightly
 * job into an infinite loop.
 */
const ATTEMPT_MULTIPLIER = 8;

/**
 * The budget before any worker has answered, i.e. while the cluster size is
 * still unknown. One successful reply is enough to learn it; four failures in
 * a row mean the site is not answering at all, and a fifth will not change
 * that.
 */
const UNKNOWN_CLUSTER_ATTEMPTS = 4;

/**
 * Invalidate `/seasons/<season>` on EVERY worker of the running site.
 *
 * Never throws: the settle transaction is already committed when this runs,
 * so a failure here is something to report, not something to propagate into
 * a chain that has nothing left to undo.
 */
export async function revalidateSeason(
  config: RevalidateConfig,
  season: number,
  post: RevalidatePoster = postRevalidate,
): Promise<RevalidateOutcome> {
  const workersReached: string[] = [];
  const failures: string[] = [];
  let workerCount = 0;
  let path: string | null = null;
  let attempts = 0;

  // Recomputed each pass: the first successful reply tells us how many
  // workers there actually are, which is what the budget is scaled to.
  const budget = () => (workerCount > 0
    ? workerCount * ATTEMPT_MULTIPLIER
    : UNKNOWN_CLUSTER_ATTEMPTS);

  while (attempts < budget()) {
    attempts += 1;
    let reply: RevalidateReply;
    try {
      reply = await post(config, season);
    } catch (error) {
      failures.push(boundedMessage(error));
      continue;
    }
    if (reply.status < 200 || reply.status >= 300) {
      failures.push(`HTTP ${reply.status}`);
      continue;
    }
    // The HIGHEST count any worker has reported, not the latest. Every worker
    // is told the same number by one primary, so they can only disagree if
    // the service was restarted with a different AFLDB_WORKERS part-way
    // through this loop — and in that case believing the smaller number would
    // let a partly-covered cluster report success.
    if (reply.workerCount > workerCount) workerCount = reply.workerCount;
    if (reply.path) path = reply.path;
    // A single-process `next start` reports no ordinal; one reply is then
    // total coverage and the loop is done.
    const id = reply.workerId ?? '1';
    if (!workersReached.includes(id)) workersReached.push(id);
    if (workersReached.length >= Math.max(1, workerCount)) break;
  }

  const ok = workerCount > 0
    ? workersReached.length >= workerCount
    : workersReached.length > 0;
  return { ok, season, path, workersReached, workerCount, attempts, failures };
}

/**
 * Exactly what goes on the wire, as a value, so the one property the
 * coverage loop depends on can be asserted rather than merely commented.
 *
 * `agent: false` is not a detail — it is the mechanism. `node:cluster`
 * round-robins CONNECTIONS, not requests, so a pooled keep-alive socket is
 * handed back to the SAME worker every time; the loop above would then post
 * to worker 1 for ever and cheerfully report a fully invalidated cluster.
 * `agent: false` makes Node open a new socket per request, and
 * `Connection: close` stops the server holding it open afterwards. Together
 * they put every attempt back through the primary's rotation.
 */
export function buildRevalidateRequest(config: RevalidateConfig, season: number): {
  url: URL;
  body: string;
  options: {
    method: string;
    agent: false;
    timeout: number;
    headers: Record<string, string | number>;
  };
} {
  const url = new URL(REVALIDATE_ROUTE, config.origin);
  const body = JSON.stringify({ season });
  return {
    url,
    body,
    options: {
      method: 'POST',
      agent: false,
      timeout: 15_000,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        [REVALIDATE_SECRET_HEADER]: config.secret,
        connection: 'close',
      },
    },
  };
}

/** The real transport. */
export const postRevalidate: RevalidatePoster = (config, season) => {
  const { url, body, options } = buildRevalidateRequest(config, season);
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;

  return new Promise<RevalidateReply>((resolve, reject) => {
    const req = send(url, options, (res) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      res.on('data', (chunk: Buffer) => {
        // The reply is four small fields. Anything larger is not our route
        // answering, and must not be buffered without limit.
        bytes += chunk.length;
        if (bytes <= 8192) chunks.push(chunk);
      });
      res.on('end', () => {
        let parsed: { workerId?: unknown; workerCount?: unknown; path?: unknown } = {};
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof parsed;
        } catch {
          // A non-JSON body from a proxy or an error page still has a status,
          // which is what the caller judges the attempt by.
        }
        resolve({
          status: res.statusCode ?? 0,
          workerId: typeof parsed.workerId === 'string' ? parsed.workerId : null,
          workerCount: typeof parsed.workerCount === 'number' ? parsed.workerCount : 0,
          path: typeof parsed.path === 'string' ? parsed.path : null,
        });
      });
    });
    req.on('timeout', () => req.destroy(new Error('revalidation request timed out')));
    req.on('error', reject);
    req.end(body);
  });
};

function boundedMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}

/** The operator-facing account of one invalidation attempt. */
export function renderRevalidateOutcome(outcome: RevalidateOutcome): string[] {
  const workers = outcome.workersReached.length;
  const of = outcome.workerCount > 0 ? `/${outcome.workerCount}` : '';
  if (outcome.ok) {
    return [
      '',
      `Season ${outcome.season} published: ${outcome.path ?? `/seasons/${outcome.season}`} `
      + `invalidated on ${workers}${of} worker(s) in ${outcome.attempts} request(s). `
      + 'Readers see the settled data on their next visit rather than after the ISR window.',
    ];
  }
  return [
    '',
    `ISR INVALIDATION FAILED for season ${outcome.season}: reached ${workers}${of} worker(s) `
    + `in ${outcome.attempts} request(s)`
    + (outcome.failures.length > 0 ? ` (${outcome.failures.slice(0, 5).join('; ')})` : '')
    + '. The canonical data IS committed and is correct; what did not happen is the cache '
    + `invalidation, so /seasons/${outcome.season} can serve stale output until its ISR `
    + 'window expires.',
  ];
}
