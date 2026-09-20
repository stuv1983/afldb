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

/** §7.1 step 2: one season's full match feed, `pageSize=1000` (§2.1: largest observed season is 218 entries). */
export function planAflApiSeasonMatchesRequest(
  bases: AflApiEndpointBases, compSeasonId: number, env: EnvLike = process.env,
): AflApiRequestPlan {
  const url = new URL(`${bases.public}/afl/v2/matches`);
  url.searchParams.set('competitionId', String(AFL_MENS_COMPETITION_ID));
  url.searchParams.set('compSeasonId', String(compSeasonId));
  url.searchParams.set('pageSize', '1000');
  return { url: url.toString(), method: 'GET', headers: { ...ACCEPT_JSON, 'User-Agent': userAgent(env) } };
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
  if (!matchProviderId) throw new Error('matchProviderId is required.');
  return cfsMediaRequest(bases, `/afl/playerStats/match/${matchProviderId}`, token, env);
}

/** §2.3 / §7.1 step 3: `GET .../cfs/afl/matchRoster/full/<CD_M>`. */
export function planAflApiMatchRosterRequest(
  bases: AflApiEndpointBases, matchProviderId: string, token: string, env: EnvLike = process.env,
): AflApiRequestPlan {
  if (!matchProviderId) throw new Error('matchProviderId is required.');
  return cfsMediaRequest(bases, `/afl/matchRoster/full/${matchProviderId}`, token, env);
}

/** §2.5 / §10 (S7): `GET .../cfs/afl/bfawards/season/<CD_S>` — the Brownlow match-vote feed. */
export function planAflApiBrownlowSeasonRequest(
  bases: AflApiEndpointBases, seasonProviderId: string, token: string, env: EnvLike = process.env,
): AflApiRequestPlan {
  if (!seasonProviderId) throw new Error('seasonProviderId is required.');
  return cfsMediaRequest(bases, `/afl/bfawards/season/${seasonProviderId}`, token, env);
}

/** §2.5 / §10 (S7): `GET .../cfs/afl/bfawards/leaderboard/season/<CD_S>` — the reconciliation surface. */
export function planAflApiBrownlowLeaderboardRequest(
  bases: AflApiEndpointBases, seasonProviderId: string, token: string, env: EnvLike = process.env,
): AflApiRequestPlan {
  if (!seasonProviderId) throw new Error('seasonProviderId is required.');
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
  /** Injected so tests never wait on real timers. */
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Issues `plan`, retrying on a network failure or non-2xx response with
 * exponential backoff, up to `attempts` total tries. A 401/403 is NOT
 * retried here — it means the token, not the transport, is the problem, so
 * it is thrown immediately for the caller's reissue-once policy
 * (`fetchAflApiCfsResource`) to decide what happens next; retrying the same
 * rejected token would only burn the attempt budget for nothing.
 */
export async function requestAflApi(
  fetchImpl: FetchLike, plan: AflApiRequestPlan, opts: RetryOptions = {},
): Promise<AflApiResponse> {
  const attempts = opts.attempts ?? DEFAULT_RETRY_ATTEMPTS;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const sleep = opts.sleep ?? defaultSleep;

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(plan.url, { method: plan.method, headers: plan.headers });
    } catch (networkError) {
      lastError = networkError;
      if (attempt < attempts) {
        await sleep(baseDelayMs * 2 ** (attempt - 1));
        continue;
      }
      break;
    }
    if (response.ok) {
      return {
        status: response.status,
        bodyText: await response.text(),
        etag: response.headers.get('etag'),
        cacheControl: response.headers.get('cache-control'),
        retrievedAt: new Date().toISOString(),
      };
    }
    const httpError = new AflApiRequestError(
      `${plan.method} ${plan.url} failed with ${response.status}`, plan.url, response.status, attempt,
    );
    if (response.status === 401 || response.status === 403) throw httpError;
    lastError = httpError;
    if (attempt < attempts) {
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new AflApiRequestError(
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
