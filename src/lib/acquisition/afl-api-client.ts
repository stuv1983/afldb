/**
 * AFLDB-ISSUE-228 S2 (§7.1) — the AFL.com.au direct-HTTP acquisition client.
 *
 * Pure request planning and response validation for the upstream services
 * this source reaches directly:
 *   - the PUBLIC match feed (aflapi.afl.com.au v2) — no auth token;
 *   - the CFS API (api.afl.com.au/cfs) — gated by a WMCTok media token,
 *     serves playerStats, matchRoster and (S7) the Brownlow bfawards
 *     endpoints;
 *   - SAPI (sapi.afl.com.au) — reserved by §5.1's source description; no S2
 *     endpoint uses it, but its base is resolved on the same footing as the
 *     other two so a later stage never has to touch this module to add one.
 *
 * Every base is independently configurable (`resolveAflApiEndpointBases`),
 * following the existing `KALI_AFL_API_BASE_URL` convention
 * (`src/lib/external-afl/current-matches.ts`). In particular the CFS base is
 * the one a future Brownlow simulator (`http://127.0.0.1:22880`, serving
 * `POST /cfs/afl/WMCTok` and `GET/HEAD /cfs/afl/bfawards/...`) redirects,
 * without editing this file or any production caller — only the environment
 * changes.
 *
 * No filesystem, no database: `fetch` is always injected by the caller
 * (`FetchLike`), so every function here is testable with a stub and safe to
 * reuse from `tools/current-season/acquire-afl-api.ts` and later acquirers.
 * Nothing here adjudicates a canonical fact (§7.1: "Nothing here
 * adjudicates") — response validation is limited to what the ACQUIRE step
 * needs to select matches and prove the HTTP transaction succeeded; the
 * source-family-registry-driven projection is the bundle emitter (S3).
 *
 * The `{ token: string }` WMCTok response shape was OPERATOR-VERIFIED
 * live against `POST https://api.afl.com.au/cfs/afl/WMCTok` on 2026-09-19
 * (HTTP 200, JSON body `{ "token": "..." }`), and the returned token was
 * used successfully via `x-media-mis-token` against
 * `/cfs/afl/bfawards/season/CD_S2026014` and
 * `/cfs/afl/bfawards/leaderboard/season/CD_S2026014` (both HTTP 200). No
 * real token is stored anywhere. The repository does not currently carry a
 * sanitised live-response evidence FIXTURE for this shape (§1.2, R6) — that
 * remains a gap for a future stage, distinct from the shape itself being
 * unconfirmed. `fetchAflApiToken()` still fails closed on any other shape.
 */

export type AflApiEndpointBases = {
  /** aflapi.afl.com.au — the public season/match feed (§2.1). No auth token. */
  public: string;
  /**
   * api.afl.com.au/cfs — WMCTok, playerStats, matchRoster, and (S7) bfawards.
   * The base a Brownlow simulator redirects.
   */
  cfs: string;
  /** sapi.afl.com.au — reserved (§5.1); no S2 endpoint uses it. */
  sapi: string;
};

export const DEFAULT_AFL_API_BASES: AflApiEndpointBases = {
  public: 'https://aflapi.afl.com.au',
  cfs: 'https://api.afl.com.au/cfs',
  sapi: 'https://sapi.afl.com.au',
};

type EnvLike = Partial<Record<string, string | undefined>>;

/**
 * Reads the three optional base-URL overrides, one per upstream service.
 * Each is independent: pointing `AFLDB_AFL_API_CFS_BASE_URL` at a local
 * Brownlow simulator never touches the public or SAPI bases, and production
 * code never hard-codes a single immutable origin.
 */
export function resolveAflApiEndpointBases(env: EnvLike = process.env): AflApiEndpointBases {
  return {
    public: env.AFLDB_AFL_API_BASE_URL ?? DEFAULT_AFL_API_BASES.public,
    cfs: env.AFLDB_AFL_API_CFS_BASE_URL ?? DEFAULT_AFL_API_BASES.cfs,
    sapi: env.AFLDB_AFL_API_SAPI_BASE_URL ?? DEFAULT_AFL_API_BASES.sapi,
  };
}

export type AflApiRequestPlan = {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
};

const ACCEPT_JSON = { Accept: 'application/json' } as const;

function userAgent(env: EnvLike): string {
  return env.AFLDB_EXTERNAL_API_USER_AGENT
    ?? 'AFLDB current-season acquisition (configure AFLDB_EXTERNAL_API_USER_AGENT with contact email)';
}

/** §7.1 step 1: `POST .../cfs/afl/WMCTok`. The token is never written to disk. */
export function planAflApiTokenRequest(
  bases: AflApiEndpointBases, env: EnvLike = process.env,
): AflApiRequestPlan {
  return {
    url: `${bases.cfs}/afl/WMCTok`,
    method: 'POST',
    headers: { ...ACCEPT_JSON, 'User-Agent': userAgent(env) },
  };
}

/**
 * §2.1: `competitionId=1` is the AFL men's senior competition in every
 * captured sample (2022-2026); no second observed value exists. It is a
 * measured constant, not a guess, and is never taken from a caller.
 */
export const AFL_MENS_COMPETITION_ID = 1;

/**
 * The page size the season matches request asks for. AFLDB-ISSUE-231 reads it
 * back: a response that fills the whole page cannot prove it was not cut off,
 * so the season enumeration (`afl-api-season-enumeration.ts`) never calls one
 * complete.
 */
export const AFL_API_SEASON_PAGE_SIZE = 1000;

/** §7.1 step 2: one season's full match feed, `pageSize=1000` (§2.1: largest observed season is 218 entries). */
export function planAflApiSeasonMatchesRequest(
  bases: AflApiEndpointBases, compSeasonId: number, env: EnvLike = process.env,
): AflApiRequestPlan {
  const url = new URL(`${bases.public}/afl/v2/matches`);
  url.searchParams.set('competitionId', String(AFL_MENS_COMPETITION_ID));
  url.searchParams.set('compSeasonId', String(compSeasonId));
  url.searchParams.set('pageSize', String(AFL_API_SEASON_PAGE_SIZE));
  return { url: url.toString(), method: 'GET', headers: { ...ACCEPT_JSON, 'User-Agent': userAgent(env) } };
}

/**
 * AFLDB-ISSUE-233: the competition's season list, exactly as the retained
 * sample requested it (`/afl/v2/competitions/1/compseasons?pageSize=100`,
 * `tests/fixtures/afl_api/seasons/00-compseasons.raw.json`). Public base, no token.
 */
export function planAflApiCompSeasonsRequest(
  bases: AflApiEndpointBases, env: EnvLike = process.env,
): AflApiRequestPlan {
  const url = new URL(`${bases.public}/afl/v2/competitions/${AFL_MENS_COMPETITION_ID}/compseasons`);
  url.searchParams.set('pageSize', '100');
  return { url: url.toString(), method: 'GET', headers: { ...ACCEPT_JSON, 'User-Agent': userAgent(env) } };
}

/**
 * AFLDB-ISSUE-297: provider ids from the upstream feed are interpolated into CFS
 * URL paths (which carry the media token) and joined into snapshot directory
 * names, so they are untrusted. The measured shapes are `CD_M<digits>` (match)
 * and `CD_S<digits>` (season).
 */
export const AFL_API_MATCH_PROVIDER_ID_PATTERN = /^CD_M\d+$/;
export const AFL_API_SEASON_PROVIDER_ID_PATTERN = /^CD_S\d+$/;

function assertProviderId(value: string, name: string, pattern: RegExp): void {
  if (!value) throw new Error(`${name} is required.`);
  if (!pattern.test(value)) {
    throw new Error(`${name} ${JSON.stringify(value.slice(0, 64))} does not match ${pattern}.`);
  }
}

function cfsMediaRequest(
  bases: AflApiEndpointBases, path: string, token: string, env: EnvLike,
): AflApiRequestPlan {
  return {
    url: `${bases.cfs}${path}`,
    method: 'GET',
    headers: { ...ACCEPT_JSON, 'x-media-mis-token': token, 'User-Agent': userAgent(env) },
  };
}

/** §2.2 / §7.1 step 3: `GET .../cfs/afl/playerStats/match/<CD_M>`. */
export function planAflApiPlayerStatsRequest(
  bases: AflApiEndpointBases, matchProviderId: string, token: string, env: EnvLike = process.env,
): AflApiRequestPlan {
  assertProviderId(matchProviderId, 'matchProviderId', AFL_API_MATCH_PROVIDER_ID_PATTERN);
  return cfsMediaRequest(bases, `/afl/playerStats/match/${matchProviderId}`, token, env);
}

/** §2.3 / §7.1 step 3: `GET .../cfs/afl/matchRoster/full/<CD_M>`. */
export function planAflApiMatchRosterRequest(
  bases: AflApiEndpointBases, matchProviderId: string, token: string, env: EnvLike = process.env,
): AflApiRequestPlan {
  assertProviderId(matchProviderId, 'matchProviderId', AFL_API_MATCH_PROVIDER_ID_PATTERN);
  return cfsMediaRequest(bases, `/afl/matchRoster/full/${matchProviderId}`, token, env);
}

/** §2.5 / §10 (S7): `GET .../cfs/afl/bfawards/season/<CD_S>` — the Brownlow match-vote feed. */
export function planAflApiBrownlowSeasonRequest(
  bases: AflApiEndpointBases, seasonProviderId: string, token: string, env: EnvLike = process.env,
): AflApiRequestPlan {
  assertProviderId(seasonProviderId, 'seasonProviderId', AFL_API_SEASON_PROVIDER_ID_PATTERN);
  return cfsMediaRequest(bases, `/afl/bfawards/season/${seasonProviderId}`, token, env);
}

/** §2.5 / §10 (S7): `GET .../cfs/afl/bfawards/leaderboard/season/<CD_S>` — the reconciliation surface. */
export function planAflApiBrownlowLeaderboardRequest(
  bases: AflApiEndpointBases, seasonProviderId: string, token: string, env: EnvLike = process.env,
): AflApiRequestPlan {
  assertProviderId(seasonProviderId, 'seasonProviderId', AFL_API_SEASON_PROVIDER_ID_PATTERN);
  return cfsMediaRequest(bases, `/afl/bfawards/leaderboard/season/${seasonProviderId}`, token, env);
}

// ---------------------------------------------------------------------------
// Transport: retry, token reissue, response capture
// ---------------------------------------------------------------------------

/** The subset of the global `fetch` signature this module depends on. Always injected — never called as a bare global from here. */
export type FetchLike = typeof fetch;

export class AflApiRequestError extends Error {
  constructor(
    message: string,
    public readonly url: string,
    public readonly status: number | null,
    public readonly attempts: number,
    /**
     * W4 (Launch B): whether repeating the same request could help. `false` for a status the client
     * refuses to retry; `true` for a transient class; omitted where the caller did not classify it.
     */
    public readonly retryable?: boolean,
  ) {
    super(message);
    this.name = 'AflApiRequestError';
  }
}

/** What the acquire tool's manifest needs per §7.1 step 4 ("SHA-256 per file and per-endpoint HTTP status, ETag, Cache-Control, retrieval time"). */
export type AflApiResponse = {
  status: number;
  bodyText: string;
  etag: string | null;
  cacheControl: string | null;
  /** ISO instant the response was received, not the token issue time. */
  retrievedAt: string;
};

export type RetryOptions = {
  /** Total attempts, including the first. §17: "3x backoff per request". */
  attempts?: number;
  baseDelayMs?: number;
  /**
   * The budget for ONE attempt, request and body together (AFLDB-ISSUE-301).
   * An attempt that exceeds it is abandoned and retried like any other transport failure.
   */
  timeoutMs?: number;
  /** Injected so tests never wait on real timers. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * The longest a `Retry-After` header on a 429/503 may make the client wait before the next
   * attempt; a larger value is capped to this (default 30 000 ms). The wait is still bounded by
   * `attempts`.
   */
  maxRetryAfterMs?: number;
  /** Clock for an HTTP-date `Retry-After`. Injected by tests; defaults to `Date.now`. */
  now?: () => number;
  /**
   * Awaited before EVERY attempt, retries included, so request starts are spaced
   * (`createAflApiRateLimiter`). Unset means no spacing.
   */
  rateLimiter?: AflApiRateLimiter;
};

/** W4 (Launch B): spaces request starts. See `createAflApiRateLimiter`. */
export type AflApiRateLimiter = { acquire(): Promise<void> };

export type AflApiRateLimiterOptions = {
  /** The minimum time between the starts of two consecutive requests; `0` disables spacing. */
  minIntervalMs: number;
  /** Clock in milliseconds. Injected by tests; defaults to `Date.now`. */
  now?: () => number;
  /** Injected so tests never wait on real timers. */
  sleep?: (ms: number) => Promise<void>;
};

/**
 * W4 (Launch B): the default spacing between request STARTS used by both acquire tools. An
 * implementation default, not a provider limit: docs/acquisition/AFLDB-2026-API-ACQUISITION.md states no
 * AFL API rate limit or throttle (searched for "rate" and "throttle"; the only hits are unrelated), so
 * this is a courtesy figure of four requests a second, small against a nightly run of a few hundred
 * requests.
 */
export const AFL_API_MIN_REQUEST_INTERVAL_MS = 250;

const DEFAULT_RETRY_ATTEMPTS = 3;
const MAX_RETRY_ATTEMPTS = 10;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const DEFAULT_MAX_RETRY_AFTER_MS = 30_000;
/** Statuses other than 5xx that are transient by definition: request timeout, too early, too many requests. */
const RETRYABLE_CLIENT_STATUSES: ReadonlySet<number> = new Set([408, 425, 429]);
/**
 * An implementation default, not a measured or owner-decided figure (AFLDB-ISSUE-301 left the
 * value open): the feeds are small JSON documents, so a healthy attempt finishes in seconds, and
 * three attempts at this budget plus backoff stay well inside the nightly unit's window.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * W4 (Launch B): a rate limiter that spaces request STARTS by at least `minIntervalMs`. Each call
 * to `acquire()` reserves the next free start slot synchronously, so concurrent callers queue
 * rather than race; it then waits (via the injected `sleep`) until its slot.
 */
export function createAflApiRateLimiter(options: AflApiRateLimiterOptions): AflApiRateLimiter {
  const { minIntervalMs } = options;
  if (!Number.isFinite(minIntervalMs) || minIntervalMs < 0) {
    throw new RangeError(`minIntervalMs must be a finite number of milliseconds >= 0, got ${String(minIntervalMs)}.`);
  }
  const clock = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  let nextFreeSlot = Number.NEGATIVE_INFINITY;
  return {
    async acquire(): Promise<void> {
      const now = clock();
      const slot = Math.max(now, nextFreeSlot);
      nextFreeSlot = slot + minIntervalMs;
      const wait = slot - now;
      if (wait > 0) await sleep(wait);
    },
  };
}

/**
 * Seconds-or-HTTP-date `Retry-After` (RFC 9110 §10.2.3) as a delay in ms, or `null` when absent or
 * unparseable. A date in the past is a zero delay.
 */
function parseRetryAfterMs(value: string | null, nowMs: number): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - nowMs);
}

/** Releases a discarded non-2xx body so the connection is not held open across the retry. Never throws. */
function discardBody(response: Response): void {
  try {
    const cancelled = response.body?.cancel();
    if (cancelled) cancelled.catch(() => {});
  } catch {
    // A body that cannot be cancelled is not worth failing the request over.
  }
}

const REMEDY_UNAVAILABLE = 'the AFL API is unavailable or slow; retry later. Nothing was written by this request.';

function describeHttpFailure(plan: AflApiRequestPlan, status: number, attempt: number, attempts: number): string {
  const base = `${plan.method} ${plan.url} failed with ${status}`;
  if (status === 404) {
    return `${base} (not retried: the resource does not exist. Check the season's compSeasonId in `
      + 'data/reference/afl-api-identities.json or the match providerId.)';
  }
  if (status === 401 || status === 403) return base;
  if (status >= 400 && status < 500 && !RETRYABLE_CLIENT_STATUSES.has(status)) {
    return `${base} (not retried: the request is wrong, so repeating it cannot help. Check the request URL and parameters.)`;
  }
  if (attempt < attempts) return base;
  if (status === 429) {
    return `${base} after ${attempt} attempt(s) (the AFL API is rate limiting this client; retry later or raise `
      + 'the minimum request interval. Nothing was written by this request.)';
  }
  return `${base} after ${attempt} attempt(s) (${REMEDY_UNAVAILABLE})`;
}

/**
 * Runs one attempt under a deadline. The `AbortSignal` is handed to the transport so a real
 * `fetch` stops reading, and the race rejects at the deadline regardless, so a transport that
 * ignores the signal cannot hang the run either.
 */
async function attemptWithDeadline<T>(
  plan: AflApiRequestPlan, timeoutMs: number, attempt: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new AflApiRequestError(
        `${plan.method} ${plan.url} timed out after ${timeoutMs} ms (${REMEDY_UNAVAILABLE})`,
        plan.url, null, attempt, true,
      );
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Issues `plan`, retrying on a network failure, a timeout, a failed body read or a non-2xx
 * response with exponential backoff, up to `attempts` total tries. A 401/403 is NOT
 * retried here — it means the token, not the transport, is the problem, so
 * it is thrown immediately for the caller's reissue-once policy
 * (`fetchAflApiCfsResource`) to decide what happens next; retrying the same
 * rejected token would only burn the attempt budget for nothing.
 *
 * Each attempt, including reading the body, is bounded by `timeoutMs` (AFLDB-ISSUE-301): an
 * upstream that accepts the connection and then stalls costs one attempt, not the run.
 */
export async function requestAflApi(
  fetchImpl: FetchLike, plan: AflApiRequestPlan, opts: RetryOptions = {},
): Promise<AflApiResponse> {
  const attempts = opts.attempts ?? DEFAULT_RETRY_ATTEMPTS;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const sleep = opts.sleep ?? defaultSleep;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(`timeoutMs must be a positive finite number of milliseconds, got ${String(timeoutMs)}.`);
  }
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > MAX_RETRY_ATTEMPTS) {
    throw new RangeError(`attempts must be an integer from 1 to ${MAX_RETRY_ATTEMPTS}, got ${String(attempts)}.`);
  }
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) {
    throw new RangeError(`baseDelayMs must be a finite number of milliseconds >= 0, got ${String(baseDelayMs)}.`);
  }
  const maxRetryAfterMs = opts.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS;
  if (!Number.isFinite(maxRetryAfterMs) || maxRetryAfterMs < 0) {
    throw new RangeError(`maxRetryAfterMs must be a finite number of milliseconds >= 0, got ${String(maxRetryAfterMs)}.`);
  }
  const clock = opts.now ?? Date.now;

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response: Response;
    let bodyText: string | null;
    // Spacing applies to every attempt, a retry included (a retry is a request to the same host).
    if (opts.rateLimiter) await opts.rateLimiter.acquire();
    try {
      // The body of a 2xx response is read inside the same attempt and the same deadline, so a
      // stream that fails or stalls part-way is retried like any other transport failure.
      ({ response, bodyText } = await attemptWithDeadline(plan, timeoutMs, attempt, async (signal) => {
        const received = await fetchImpl(plan.url, { method: plan.method, headers: plan.headers, signal });
        return { response: received, bodyText: received.ok ? await received.text() : null };
      }));
    } catch (transportError) {
      lastError = transportError;
      if (attempt < attempts) {
        await sleep(baseDelayMs * 2 ** (attempt - 1));
        continue;
      }
      break;
    }
    if (bodyText !== null) {
      return {
        status: response.status,
        bodyText,
        etag: response.headers.get('etag'),
        cacheControl: response.headers.get('cache-control'),
        retrievedAt: new Date().toISOString(),
      };
    }
    // The body of a non-2xx response is never read; release it before deciding what happens next.
    discardBody(response);
    const status = response.status;
    const tokenRejected = status === 401 || status === 403;
    const retryable = !tokenRejected
      && (status >= 500 || RETRYABLE_CLIENT_STATUSES.has(status) || status < 400);
    const httpError = new AflApiRequestError(
      describeHttpFailure(plan, status, attempt, attempts), plan.url, status, attempt, retryable,
    );
    // 401/403: the caller's reissue-once policy decides. Other 4xx (404, 400, ...): the request
    // itself is wrong, so repeating it only burns the attempt budget and hammers the API.
    if (!retryable) throw httpError;
    lastError = httpError;
    if (attempt < attempts) {
      let delay = baseDelayMs * 2 ** (attempt - 1);
      if (status === 429 || status === 503) {
        const retryAfter = parseRetryAfterMs(response.headers?.get('retry-after') ?? null, clock());
        if (retryAfter !== null) delay = Math.max(delay, Math.min(retryAfter, maxRetryAfterMs));
      }
      await sleep(delay);
    }
  }
  if (lastError instanceof AflApiRequestError) throw lastError;
  if (lastError instanceof Error) {
    // A transport failure (connection refused, DNS, reset, a failed body read): keep the original
    // message and add the class of remedy, and keep the cause for anyone who needs the stack.
    const wrapped = new AflApiRequestError(
      `${plan.method} ${plan.url} failed after ${attempts} attempt(s): ${lastError.message} `
      + `(transport error; ${REMEDY_UNAVAILABLE})`,
      plan.url, null, attempts, true,
    );
    wrapped.cause = lastError;
    throw wrapped;
  }
  throw new AflApiRequestError(
    `${plan.method} ${plan.url} failed after ${attempts} attempt(s).`, plan.url, null, attempts,
  );
}

/**
 * §7.1 step 1 + §17: fetches a fresh WMCTok token and validates its shape.
 * The token is returned to the caller and never written or logged by this
 * module.
 */
export async function fetchAflApiToken(
  fetchImpl: FetchLike,
  bases: AflApiEndpointBases,
  env: EnvLike = process.env,
  opts: RetryOptions = {},
): Promise<string> {
  const plan = planAflApiTokenRequest(bases, env);
  const response = await requestAflApi(fetchImpl, plan, opts);
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.bodyText);
  } catch {
    throw new AflApiRequestError(
      'WMCTok response body was not valid JSON (expected { token: string }, operator-verified 2026-09-19; see §1.2/R6).',
      plan.url, response.status, 1,
    );
  }
  const token = (parsed as Record<string, unknown> | null)?.token;
  if (typeof token !== 'string' || token.length === 0) {
    throw new AflApiRequestError(
      "WMCTok response did not carry a non-empty string 'token' field.",
      plan.url, response.status, 1,
    );
  }
  return token;
}

export type AflApiCfsFetchResult = {
  response: AflApiResponse;
  /** True when the first attempt with the current token came back 401/403 and a fresh token was fetched to succeed. */
  tokenReissued: boolean;
};

/**
 * Fetches one CFS media resource, reissuing the WMCTok token exactly once if
 * the first attempt with `token` comes back 401/403 (§17: "token re-issued
 * once on 401/403"). A 401/403 on the retry — with the FRESH token — is not
 * retried again: that means the token mechanism itself changed (R6), not
 * that one token expired, and the caller should fail the run rather than
 * loop.
 */
export async function fetchAflApiCfsResource(
  fetchImpl: FetchLike,
  buildPlan: (token: string) => AflApiRequestPlan,
  token: string,
  reissueToken: () => Promise<string>,
  opts: RetryOptions = {},
): Promise<AflApiCfsFetchResult> {
  try {
    const response = await requestAflApi(fetchImpl, buildPlan(token), opts);
    return { response, tokenReissued: false };
  } catch (error) {
    if (!(error instanceof AflApiRequestError) || (error.status !== 401 && error.status !== 403)) throw error;
    const freshToken = await reissueToken();
    const response = await requestAflApi(fetchImpl, buildPlan(freshToken), opts);
    return { response, tokenReissued: true };
  }
}

/**
 * W4 (Launch B): parses a 2xx body as JSON, or throws an `AflApiRequestError` that names the URL and
 * status and says what to do, instead of a bare `SyntaxError` that names neither. `what` is a short
 * label such as "Season matches response".
 */
export function parseAflApiJsonBody(what: string, plan: Pick<AflApiRequestPlan, 'url' | 'method'>, response: Pick<AflApiResponse, 'status' | 'bodyText'>): unknown {
  try {
    return JSON.parse(response.bodyText);
  } catch {
    throw new AflApiRequestError(
      `${what} from ${plan.method} ${plan.url} (HTTP ${response.status}) was not valid JSON `
      + `(${response.bodyText.length} character(s)). Not retried: the AFL API answered with something other than its JSON feed; `
      + 'check the configured AFLDB_AFL_API_* base URLs and retry later. Nothing was written by this request.',
      plan.url, response.status, 1, false,
    );
  }
}

// ---------------------------------------------------------------------------
// Response validation: the season matches envelope (§2.1)
// ---------------------------------------------------------------------------

export type AflApiSeasonMatchSummary = {
  providerId: string;
  status: string;
  utcStartTime: string | null;
};

/**
 * Minimal, non-adjudicating extraction of the season matches feed (§2.1) —
 * enough for the acquire tool to SELECT which matches to fetch player stats
 * and rosters for, and to prove the response is a usable envelope at all.
 * This is deliberately NOT the bundle emitter (S3): it does not validate
 * against the source-family registry and does not check `known_columns`. A
 * malformed envelope throws; an entry missing only fields this function does
 * not use is left alone — that is S3's job.
 */
export function parseAflApiSeasonMatchesEnvelope(bodyText: string): AflApiSeasonMatchSummary[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch (error) {
    throw new Error(`Season matches response was not valid JSON: ${String(error)}`);
  }
  const matches = (parsed as { matches?: unknown } | null)?.matches;
  if (!Array.isArray(matches)) {
    throw new Error("Season matches response carried no 'matches' array.");
  }
  return matches.map((raw, index) => {
    const record = raw as Record<string, unknown> | null;
    const providerId = record?.providerId;
    if (typeof providerId !== 'string' || providerId.length === 0) {
      throw new Error(`Season matches response entry ${index} carried no string providerId.`);
    }
    if (!AFL_API_MATCH_PROVIDER_ID_PATTERN.test(providerId)) {
      throw new Error(
        `Season matches response entry ${index} carried a providerId ${JSON.stringify(providerId.slice(0, 64))} `
        + `that does not match ${AFL_API_MATCH_PROVIDER_ID_PATTERN}.`,
      );
    }
    const status = record?.status;
    if (typeof status !== 'string' || status.length === 0) {
      throw new Error(`Season matches response entry ${index} (${providerId}) carried no string status.`);
    }
    const utcStartTime = typeof record?.utcStartTime === 'string' ? record.utcStartTime : null;
    return { providerId, status, utcStartTime };
  });
}

export type AflApiMatchSelection = {
  /** Defaults to `'CONCLUDED'` (§7.1 step 2). */
  status?: string | null;
  /** `YYYY-MM-DD`; matches whose `utcStartTime` date is earlier are excluded. */
  since?: string | null;
  /** Explicit provider ids. When given, this is the ONLY filter — status/since are ignored. */
  match?: readonly string[];
};

/** Pure filter over an already-validated season matches envelope. No network, no adjudication — see `parseAflApiSeasonMatchesEnvelope`. */
export function selectAflApiMatches(
  summaries: readonly AflApiSeasonMatchSummary[], selection: AflApiMatchSelection,
): AflApiSeasonMatchSummary[] {
  if (selection.match && selection.match.length > 0) {
    const wanted = new Set(selection.match);
    return summaries.filter((m) => wanted.has(m.providerId));
  }
  const status = selection.status ?? 'CONCLUDED';
  return summaries.filter((m) => {
    if (m.status !== status) return false;
    if (selection.since) {
      const date = m.utcStartTime?.slice(0, 10) ?? null;
      if (!date || date < selection.since) return false;
    }
    return true;
  });
}
