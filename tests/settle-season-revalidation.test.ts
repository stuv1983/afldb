import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AFLDB-ISSUE-134 — post-settle ISR invalidation, without a database, a
 * socket or a Next.js cache.
 *
 * A new file rather than an extension of `tests/current-season-import.test.ts`
 * or `tests/integration/settle-afltables.test.ts`, for the reason
 * `tests/admin-current-season-settle.test.ts` gives for its own existence: the
 * module-level `vi.mock()` calls needed to drive `runSettleCli()` without
 * PostgreSQL apply to a whole file, and pushing them into a 4,000-line suite
 * would rewrite its boundaries. This file is the DB-free contract; the
 * after-commit proof against real PostgreSQL lives in
 * `tests/integration/settle-afltables.test.ts` §S6, which asserts on the same
 * injected boundary after a real commit and a real idempotent rerun.
 *
 * WHAT IS MOCKED AND WHY. The settle transaction (`runSettleAfltables`) and
 * the exception report, because neither is under test here and both need a
 * database. The invalidation boundary itself is INJECTED rather than mocked,
 * which is the point: the contract being proved is "who calls it, when, with
 * what, and what happens when it fails".
 */

const mocks = vi.hoisted(() => ({
  runSettleAfltables: vi.fn(),
  buildSettleExceptionReport: vi.fn(),
  revalidatePath: vi.fn(),
  rateLimitCheck: vi.fn(),
  rateLimitPeek: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/acquisition/settle-afltables', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/acquisition/settle-afltables')>(),
  runSettleAfltables: mocks.runSettleAfltables,
  // The bundle contract is proved elsewhere; here the bundle only has to
  // carry a season, which is the one field this issue reads from it.
  validateSettleBundle: vi.fn(() => ({
    bundleContractVersion: 1,
    snapshotLabel: 'issue134-label',
    acquisitionKind: 'in_season_partial',
    season: 2026,
    fitzroyVersion: '1.8.0',
  })),
}));

vi.mock('@/lib/acquisition/settle-report', () => ({
  buildSettleExceptionReport: mocks.buildSettleExceptionReport,
  renderSettleExceptionReport: () => [],
}));

vi.mock('@/lib/acquisition/manual-authority', () => ({
  loadManualAuthority: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

vi.mock('@/lib/auth/rate-limit', () => ({
  RateLimiter: class {
    check(key: string) { return mocks.rateLimitCheck(key); }

    peek(key: string) { return mocks.rateLimitPeek(key); }
  },
}));

import {
  buildRevalidateRequest,
  classifyForwardedClient,
  isPlausibleSeason,
  isServableForwardedClient,
  readRevalidateConfig,
  renderRevalidateOutcome,
  revalidateSeason,
  REVALIDATE_SECRET_HEADER,
  shouldRevalidateSeason,
  type RevalidateOutcome,
  type RevalidateReply,
} from '@/lib/acquisition/season-revalidation';
import { POST } from '@/app/api/internal/revalidate-season/route';

import { runSettleCli } from '../tools/current-season/settle-afltables';

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const LABEL = 'issue134-label';
const SEASON = 2026;

/** Every counter `runSettleAfltables` reports, all zero. */
function zeroCounters(): Record<string, number> {
  return {
    snapshotMatches: 0,
    snapshotPlayerMatchRows: 0,
    snapshotRejections: 0,
    snapshotUnkeyedRejections: 0,
    observationsSeen: 0,
    payloadsCreated: 0,
    payloadsReused: 0,
    versionsAppended: 0,
    observationsUnchanged: 0,
    observationsCorrected: 0,
    observationsHistoryOnly: 0,
    observationsMarkedAbsent: 0,
    observationsReappeared: 0,
    absenceSweepSkipped: 0,
    projectionRowsWritten: 0,
    venueUnmapped: 0,
    nullInCoveredStat: 0,
    unresolvedIdentityPlayer: 0,
    unresolvedIdentityClub: 0,
    unresolvedIdentityVenue: 0,
    unresolvedIdentityMatch: 0,
    foreignOwnedCollision: 0,
    sourceDisagreement: 0,
    advisoryDisagreement: 0,
    manualAuthorityRefusals: 0,
    candidatesCreated: 0,
    candidatesRefreshed: 0,
    candidatesMootLeftPending: 0,
    dataIssuesOpened: 0,
    dataIssuesRefreshed: 0,
    dataIssuesResolved: 0,
    canonicalRowsInserted: 0,
    canonicalRowsUpdated: 0,
    canonicalApplicationsLogged: 0,
    canonicalRetryApplied: 0,
    canonicalApplyRefusals: 0,
    canonicalApplyFailures: 0,
    canonicalMatchesRekeyed: 0,
    canonicalRekeyRefusals: 0,
    canonicalOverridesCarried: 0,
    derivedRecomputeRuns: 0,
    derivedRecomputePlayers: 0,
  };
}

/** A project root holding exactly the four files the CLI reads. */
function writeProjectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'afldb-issue134-'));
  mkdirSync(join(root, 'data', 'reference'), { recursive: true });
  writeFileSync(
    join(root, 'data', 'reference', 'seasons.json'),
    JSON.stringify({ in_progress_seasons: [SEASON] }),
  );
  // The REAL registry: `parseSourceFamilyRegistry` is not mocked, because
  // `settle-afltables.ts` imports from the same module and a partial stub
  // there would break its bindings.
  copyFileSync(
    'data/reference/source-families.json',
    join(root, 'data', 'reference', 'source-families.json'),
  );
  const manifestRel = `docs/rebuild-manifests/afltables_fitzroy_core/${LABEL}.json`;
  mkdirSync(dirname(join(root, manifestRel)), { recursive: true });
  writeFileSync(join(root, manifestRel), '{"issue134":true}');
  const bundleDir = join(root, 'data', 'sources', 'afltables', 'fitzroy_core', LABEL);
  mkdirSync(bundleDir, { recursive: true });
  writeFileSync(
    join(bundleDir, 'observations.json'), JSON.stringify({ manifest_path: manifestRel }),
  );
  return root;
}

let projectRoot = '';

/** The outcome a healthy invalidation returns. */
function okOutcome(season: number): RevalidateOutcome {
  return {
    ok: true,
    season,
    path: `/seasons/${season}`,
    workersReached: ['1', '2'],
    workerCount: 2,
    attempts: 2,
    failures: [],
  };
}

/**
 * Drive the CLI with an injected invalidation boundary and record every call.
 * `deps.sql` is a bare stub: nothing below reaches the driver.
 */
async function cli(
  argv: string[],
  run: { applied: boolean; batchId: string | null; counters: Record<string, number> },
  revalidate?: (season: number) => Promise<RevalidateOutcome>,
) {
  const seasons: number[] = [];
  const lines: string[] = [];
  mocks.runSettleAfltables.mockResolvedValue({ ...run, absenceSweepSkipped: [] });

  const outcome = await runSettleCli(argv, {
    projectRoot,
    sql: (() => {}) as never,
    log: (line) => lines.push(line),
    env: {},
    revalidate: async (season) => {
      seasons.push(season);
      return revalidate ? revalidate(season) : okOutcome(season);
    },
  });
  return { outcome, seasons, lines };
}

/* ------------------------------------------------------------------ *
 * The decision: when a settle may publish a season
 * ------------------------------------------------------------------ */

describe('AFLDB-ISSUE-134 — the transaction boundary', () => {
  it('publishes when an applied run wrote canonical rows', () => {
    expect(shouldRevalidateSeason({
      applied: true,
      counters: {
        canonicalRowsInserted: 2, canonicalRowsUpdated: 0, canonicalApplicationsLogged: 2,
      },
    })).toBe(true);
  });

  it('publishes when an applied run only UPDATED canonical rows', () => {
    expect(shouldRevalidateSeason({
      applied: true,
      counters: {
        canonicalRowsInserted: 0, canonicalRowsUpdated: 1, canonicalApplicationsLogged: 1,
      },
    })).toBe(true);
  });

  it('does nothing for the idempotent 0 canonical / 0 ledger rerun', () => {
    expect(shouldRevalidateSeason({
      applied: true,
      counters: {
        canonicalRowsInserted: 0, canonicalRowsUpdated: 0, canonicalApplicationsLogged: 0,
      },
    })).toBe(false);
  });

  it('does nothing for a rolled-back run, however much it would have written', () => {
    expect(shouldRevalidateSeason({
      applied: false,
      counters: {
        canonicalRowsInserted: 99, canonicalRowsUpdated: 99, canonicalApplicationsLogged: 99,
      },
    })).toBe(false);
  });

  it('does nothing when there is no run at all', () => {
    expect(shouldRevalidateSeason(null)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * The CLI wiring
 * ------------------------------------------------------------------ */

describe('AFLDB-ISSUE-134 — the settle CLI publishes only what it committed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectRoot = writeProjectRoot();
    mocks.buildSettleExceptionReport.mockResolvedValue({});
  });

  it('invalidates the bundle\'s own season after an applied run that changed data', async () => {
    const { outcome, seasons, lines } = await cli(
      ['--label', LABEL, '--apply', '--auto-apply'],
      {
        applied: true,
        batchId: '741',
        counters: {
          ...zeroCounters(),
          canonicalRowsInserted: 2,
          canonicalApplicationsLogged: 2,
        },
      },
    );

    expect(seasons).toEqual([SEASON]);
    expect(outcome.revalidation?.ok).toBe(true);
    expect(outcome.revalidation?.path).toBe('/seasons/2026');
    expect(lines.join('\n')).toContain('Season 2026 published');
  });

  it('makes no request at all on an identical 0/0 rerun', async () => {
    const { outcome, seasons } = await cli(
      ['--label', LABEL, '--apply', '--auto-apply'],
      { applied: true, batchId: '742', counters: zeroCounters() },
    );

    expect(seasons).toEqual([]);
    expect(outcome.revalidation).toBeNull();
  });

  it('makes no request on a dry run, whatever the run would have written', async () => {
    const { outcome, seasons } = await cli(
      ['--label', LABEL, '--dry-run', '--auto-apply'],
      {
        applied: false,
        batchId: null,
        counters: { ...zeroCounters(), canonicalRowsInserted: 5, canonicalApplicationsLogged: 5 },
      },
    );

    expect(seasons).toEqual([]);
    expect(outcome.revalidation).toBeNull();
  });

  it('makes no request when the settle transaction itself failed', async () => {
    const seasons: number[] = [];
    mocks.runSettleAfltables.mockRejectedValue(new Error('deadlock detected'));

    await expect(runSettleCli(['--label', LABEL, '--apply', '--auto-apply'], {
      projectRoot,
      sql: (() => {}) as never,
      log: () => {},
      env: {},
      revalidate: async (season) => {
        seasons.push(season);
        return okOutcome(season);
      },
    })).rejects.toThrow('deadlock detected');

    expect(seasons).toEqual([]);
  });

  it('reports a failed invalidation without disturbing the committed run', async () => {
    const { outcome, lines } = await cli(
      ['--label', LABEL, '--apply', '--auto-apply'],
      {
        applied: true,
        batchId: '743',
        counters: { ...zeroCounters(), canonicalRowsInserted: 1, canonicalApplicationsLogged: 1 },
      },
      async (season) => ({
        ok: false,
        season,
        path: null,
        workersReached: ['1'],
        workerCount: 2,
        attempts: 16,
        failures: ['HTTP 503'],
      }),
    );

    // The run still reports itself as applied with its real batch id: a
    // cache failure must never be mistaken for an ingestion failure.
    expect(outcome.result?.applied).toBe(true);
    expect(outcome.result?.batchId).toBe('743');
    expect(outcome.revalidation?.ok).toBe(false);
    expect(lines.join('\n')).toContain('ISR INVALIDATION FAILED');
    expect(lines.join('\n')).toContain('The canonical data IS committed');
  });

  it('turns a bad host configuration into a reported invalidation failure, not a lost settle',
    async () => {
      mocks.runSettleAfltables.mockResolvedValue({
        applied: true,
        batchId: '744',
        counters: { ...zeroCounters(), canonicalRowsInserted: 1, canonicalApplicationsLogged: 1 },
        absenceSweepSkipped: [],
      });

      const outcome = await runSettleCli(['--label', LABEL, '--apply', '--auto-apply'], {
        projectRoot,
        sql: (() => {}) as never,
        log: () => {},
        // Half-configured: a URL and no secret.
        env: { AFLDB_REVALIDATE_URL: 'http://127.0.0.1:3100' },
      });

      expect(outcome.result?.applied).toBe(true);
      expect(outcome.revalidation?.ok).toBe(false);
      expect(outcome.revalidation?.failures.join(' ')).toContain('AFLDB_REVALIDATE_SECRET');
    });

  it('stays inert on a host that has configured nothing', async () => {
    mocks.runSettleAfltables.mockResolvedValue({
      applied: true,
      batchId: '745',
      counters: { ...zeroCounters(), canonicalRowsInserted: 1, canonicalApplicationsLogged: 1 },
      absenceSweepSkipped: [],
    });

    const outcome = await runSettleCli(['--label', LABEL, '--apply', '--auto-apply'], {
      projectRoot, sql: (() => {}) as never, log: () => {}, env: {},
    });

    expect(outcome.result?.applied).toBe(true);
    expect(outcome.revalidation).toBeNull();
  });

  it('leaves the existing counters and outcome shape untouched', async () => {
    const { outcome } = await cli(
      ['--label', LABEL, '--apply', '--auto-apply'],
      {
        applied: true,
        batchId: '746',
        counters: {
          ...zeroCounters(),
          canonicalRowsInserted: 3,
          canonicalRowsUpdated: 1,
          canonicalApplicationsLogged: 4,
          snapshotMatches: 9,
          observationsSeen: 12,
        },
      },
    );

    expect(outcome.result?.counters.canonicalRowsInserted).toBe(3);
    expect(outcome.result?.counters.canonicalRowsUpdated).toBe(1);
    expect(outcome.result?.counters.snapshotMatches).toBe(9);
    expect(outcome.result?.counters.observationsSeen).toBe(12);
    expect(outcome.sourceCompleteness).not.toBeNull();
    expect(outcome.report).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * The host configuration
 * ------------------------------------------------------------------ */

describe('AFLDB-ISSUE-134 — host configuration', () => {
  it('is inert when neither name is set', () => {
    expect(readRevalidateConfig({})).toBeNull();
  });

  it('refuses a half configuration rather than silently doing nothing', () => {
    expect(() => readRevalidateConfig({ AFLDB_REVALIDATE_URL: 'http://127.0.0.1:3100' }))
      .toThrow(/AFLDB_REVALIDATE_SECRET/);
    expect(() => readRevalidateConfig({ AFLDB_REVALIDATE_SECRET: 's3cret' }))
      .toThrow(/AFLDB_REVALIDATE_URL/);
  });

  it('refuses to send the shared secret anywhere but this host', () => {
    for (const origin of [
      'http://afldb.com', 'https://beta.afldb.com', 'http://10.0.0.5:3100', 'http://[::2]:3100',
    ]) {
      expect(() => readRevalidateConfig({
        AFLDB_REVALIDATE_URL: origin, AFLDB_REVALIDATE_SECRET: 's3cret',
      })).toThrow(/loopback/);
    }
  });

  it('accepts the three loopback spellings', () => {
    for (const origin of ['http://127.0.0.1:3100', 'http://localhost:3000', 'http://[::1]:3100']) {
      expect(readRevalidateConfig({
        AFLDB_REVALIDATE_URL: origin, AFLDB_REVALIDATE_SECRET: 's3cret',
      })).toEqual({ origin: new URL(origin).origin, secret: 's3cret' });
    }
  });

  it('refuses a non-HTTP scheme and unparseable rubbish', () => {
    expect(() => readRevalidateConfig({
      AFLDB_REVALIDATE_URL: 'file:///etc/passwd', AFLDB_REVALIDATE_SECRET: 's',
    })).toThrow(/http or https/);
    expect(() => readRevalidateConfig({
      AFLDB_REVALIDATE_URL: 'not a url', AFLDB_REVALIDATE_SECRET: 's',
    })).toThrow(/not a valid URL/);
  });
});

/* ------------------------------------------------------------------ *
 * The multi-worker coverage loop
 * ------------------------------------------------------------------ */

describe('AFLDB-ISSUE-134 — every worker, or a reported failure', () => {
  const config = { origin: 'http://127.0.0.1:3100', secret: 's3cret' };

  /** A cluster that answers round-robin, as `node:cluster` does. */
  function cluster(count: number, seen: number[] = []) {
    let next = 0;
    return async (): Promise<RevalidateReply> => {
      next += 1;
      seen.push(next);
      return {
        status: 200,
        workerId: String(((next - 1) % count) + 1),
        workerCount: count,
        path: '/seasons/2026',
      };
    };
  }

  it('keeps posting until every worker of a 4-worker cluster has answered', async () => {
    const outcome = await revalidateSeason(config, 2026, cluster(4));
    expect(outcome.ok).toBe(true);
    expect(outcome.workersReached).toEqual(['1', '2', '3', '4']);
    expect(outcome.attempts).toBe(4);
  });

  it('covers the 2-worker production cluster', async () => {
    const outcome = await revalidateSeason(config, 2026, cluster(2));
    expect(outcome.ok).toBe(true);
    expect(outcome.workersReached).toEqual(['1', '2']);
  });

  it('tolerates a rotation disturbed by ordinary reader traffic', async () => {
    // Worker 1 answers three times before the rotation reaches 2.
    const ids = ['1', '1', '1', '2'];
    let i = 0;
    const outcome = await revalidateSeason(config, 2026, async () => ({
      status: 200, workerId: ids[i++] ?? '2', workerCount: 2, path: '/seasons/2026',
    }));
    expect(outcome.ok).toBe(true);
    expect(outcome.workersReached).toEqual(['1', '2']);
    expect(outcome.attempts).toBe(4);
  });

  it('accepts a single answer from a single-process server', async () => {
    const outcome = await revalidateSeason(config, 2026, async () => ({
      status: 200, workerId: null, workerCount: 1, path: '/seasons/2026',
    }));
    expect(outcome.ok).toBe(true);
    expect(outcome.attempts).toBe(1);
  });

  it('FAILS rather than reporting success when a worker never answers', async () => {
    // Worker 2 is wedged: the rotation only ever yields worker 1.
    const outcome = await revalidateSeason(config, 2026, async () => ({
      status: 200, workerId: '1', workerCount: 2, path: '/seasons/2026',
    }));
    expect(outcome.ok).toBe(false);
    expect(outcome.workersReached).toEqual(['1']);
    // Bounded: a wedged cluster must not spin a nightly job for ever.
    expect(outcome.attempts).toBe(16);
  });

  it('fails observably when the route refuses, and never throws', async () => {
    const outcome = await revalidateSeason(config, 2026, async () => ({
      status: 401, workerId: null, workerCount: 0, path: null,
    }));
    expect(outcome.ok).toBe(false);
    expect(outcome.failures).toContain('HTTP 401');
    expect(renderRevalidateOutcome(outcome).join('\n')).toContain('ISR INVALIDATION FAILED');
  });

  it('fails observably when the socket does, and never throws', async () => {
    const outcome = await revalidateSeason(config, 2026, async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:3100');
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.failures[0]).toContain('ECONNREFUSED');
    expect(outcome.attempts).toBe(4);
  });

  it('bounds an unbounded error message rather than logging a blob', async () => {
    const outcome = await revalidateSeason(config, 2026, async () => {
      throw new Error('x'.repeat(5000));
    });
    expect(outcome.failures[0].length).toBeLessThanOrEqual(200);
  });

  /**
   * The coverage contract, stated as its own assertions rather than left as a
   * consequence of the tests above. These are the properties DEV acceptance
   * is going to be asked to reproduce on the real cluster.
   */
  describe('the coverage contract', () => {
    it('counts DISTINCT ordinals: repeats never accumulate towards coverage', async () => {
      let calls = 0;
      const outcome = await revalidateSeason(config, 2026, async () => {
        calls += 1;
        // Three answers, one worker. A length-of-attempts rule would call
        // this a covered 3-worker cluster.
        return { status: 200, workerId: '2', workerCount: 3, path: '/seasons/2026' };
      });
      expect(outcome.workersReached).toEqual(['2']);
      expect(outcome.ok).toBe(false);
      expect(calls).toBe(24);
    });

    it('is not satisfied by 3 of 4 workers', async () => {
      const ids = ['1', '2', '3'];
      let i = 0;
      const outcome = await revalidateSeason(config, 2026, async () => ({
        status: 200, workerId: ids[i++ % 3], workerCount: 4, path: '/seasons/2026',
      }));
      expect(outcome.workersReached).toEqual(['1', '2', '3']);
      expect(outcome.ok).toBe(false);
    });

    it('takes the LARGEST cluster size reported, so a restart cannot shrink coverage',
      async () => {
        // A rolling restart mid-loop: the first worker answers for a 4-worker
        // cluster, the rest claim 2. Believing the smaller number would let
        // two answers close a four-worker cluster.
        const replies = [
          { workerId: '1', workerCount: 4 },
          { workerId: '2', workerCount: 2 },
        ];
        let i = 0;
        const outcome = await revalidateSeason(config, 2026, async () => ({
          status: 200,
          ...(replies[i++] ?? { workerId: '2', workerCount: 2 }),
          path: '/seasons/2026',
        }));
        expect(outcome.workerCount).toBe(4);
        expect(outcome.ok).toBe(false);
      });

    it('opens a FRESH connection per attempt, which is what makes the rotation work',
      () => {
        const { url, body, options } = buildRevalidateRequest(config, 2026);
        // A pooled keep-alive socket returns to the same worker for ever.
        expect(options.agent).toBe(false);
        expect(options.headers.connection).toBe('close');
        // And the route it posts to is fixed, not composed from anything.
        expect(url.pathname).toBe('/api/internal/revalidate-season');
        expect(url.origin).toBe('http://127.0.0.1:3100');
        expect(options.headers[REVALIDATE_SECRET_HEADER]).toBe('s3cret');
        expect(JSON.parse(body)).toEqual({ season: 2026 });
      });
  });
});

/* ------------------------------------------------------------------ *
 * The route
 * ------------------------------------------------------------------ */

describe('POST /api/internal/revalidate-season', () => {
  const SECRET = 'issue134-shared-secret';

  /**
   * A request shaped the way Next 16 ACTUALLY delivers one, which is the
   * whole reason this suite was rewritten (AFLDB-ISSUE-134 §10.2). The old
   * helper sent no forwarding headers, a state the framework never produces:
   * `base-server.js` fills both in before any handler runs, so every request
   * the deployed route sees carries them. Testing against the bare shape is
   * what let a gate that 404s unconditionally pass every repository gate.
   *
   * The defaults here are exactly what a loopback POST to `127.0.0.1:3100`
   * gets: `x-forwarded-for` from `socket.remoteAddress`, `x-forwarded-host`
   * from the request's own `Host` header.
   */
  function post(body: unknown, headers: Record<string, string> = {}): Request {
    return new Request('http://127.0.0.1:3100/api/internal/revalidate-season', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '127.0.0.1',
        'x-forwarded-host': '127.0.0.1:3100',
        [REVALIDATE_SECRET_HEADER]: SECRET,
        ...headers,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  /** The same, with the forwarding headers stripped rather than overridden. */
  function postWithoutForwarding(body: unknown): Request {
    return new Request('http://127.0.0.1:3100/api/internal/revalidate-season', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [REVALIDATE_SECRET_HEADER]: SECRET,
      },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimitPeek.mockReturnValue(false);
    mocks.rateLimitCheck.mockReturnValue(false);
    process.env.AFLDB_REVALIDATE_SECRET = SECRET;
    delete process.env.AFLDB_WORKER_ID;
    delete process.env.AFLDB_WORKER_COUNT;
  });

  it('invalidates exactly the season page it was given', async () => {
    const response = await POST(post({ season: 2026 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, path: '/seasons/2026' });
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/seasons/2026');
  });

  it('reports the worker identity the caller needs to prove coverage', async () => {
    process.env.AFLDB_WORKER_ID = '3';
    process.env.AFLDB_WORKER_COUNT = '4';
    const body = await (await POST(post({ season: 2026 }))).json();
    expect(body).toMatchObject({ workerId: '3', workerCount: 4 });
  });

  it('reports a single-process server truthfully rather than guessing', async () => {
    const body = await (await POST(post({ season: 2026 }))).json();
    expect(body).toMatchObject({ workerId: null, workerCount: 1 });
  });

  /**
   * The identity the coverage loop counts on must be the SERVER's, or the
   * whole proof is circular: a caller that could name the worker could
   * satisfy coverage without ever reaching one.
   */
  it('takes the worker identity from process state, never from the request', async () => {
    process.env.AFLDB_WORKER_ID = '2';
    process.env.AFLDB_WORKER_COUNT = '4';
    const response = await POST(post(
      { season: 2026, workerId: '99', workerCount: 1 },
      { 'x-afldb-worker': '99', 'x-afldb-worker-count': '1' },
    ));
    expect(await response.json()).toMatchObject({ workerId: '2', workerCount: 4 });
  });

  it('refuses to believe a nonsensical worker count rather than reporting it', async () => {
    for (const declared of ['0', '-3', 'four', '2.5', '']) {
      process.env.AFLDB_WORKER_COUNT = declared;
      const body = await (await POST(post({ season: 2026 }))).json();
      expect(body.workerCount).toBe(1);
    }
  });

  it('is 503 and inert on a host that has configured no secret', async () => {
    delete process.env.AFLDB_REVALIDATE_SECRET;
    const response = await POST(post({ season: 2026 }));
    expect(response.status).toBe(503);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('refuses a wrong, empty or absent secret', async () => {
    for (const headers of [
      { [REVALIDATE_SECRET_HEADER]: 'wrong' },
      { [REVALIDATE_SECRET_HEADER]: '' },
      { [REVALIDATE_SECRET_HEADER]: `${SECRET}x` },
    ]) {
      const response = await POST(post({ season: 2026 }, headers));
      expect(response.status).toBe(401);
    }
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  /**
   * THE REGRESSION. This is the case the deployed route failed and no test
   * covered: a legitimate loopback caller, with the forwarding headers the
   * framework puts on every request, must SUCCEED. If gate 1 ever goes back
   * to testing for absence, this is the test that goes red.
   */
  it('serves a loopback caller carrying the forwarding headers Next synthesises', async () => {
    const response = await POST(post({ season: 2026 }));
    expect(response.status).toBe(200);
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/seasons/2026');
  });

  it('serves every loopback form the deployment can emit', async () => {
    // `::ffff:127.0.0.1` is what Node reports for an IPv4 connection to a
    // dual-stack socket; 127.0.0.0/8 is unroutable off the host in full.
    for (const address of ['127.0.0.1', '::1', '[::1]', '::ffff:127.0.0.1', '127.0.0.53']) {
      mocks.revalidatePath.mockClear();
      const response = await POST(post({ season: 2026 }, { 'x-forwarded-for': address }));
      expect(response.status, address).toBe(200);
      expect(mocks.revalidatePath, address).toHaveBeenCalledTimes(1);
    }
  });

  /**
   * The forwarded HOST is client input on both paths — Next fills it from the
   * request's own `Host` header — so it must not change the verdict either
   * way. A public `Host` on a loopback connection is a request from this host
   * that named the site by its public name, not a request from the internet.
   */
  it('ignores x-forwarded-host, which is client input on every path', async () => {
    const response = await POST(post({ season: 2026 }, { 'x-forwarded-host': 'beta.afldb.com' }));
    expect(response.status).toBe(200);
  });

  it('refuses a non-loopback forwarded client even with the correct secret', async () => {
    for (const address of ['203.0.113.9', '10.0.0.4', '2001:db8::1', '::ffff:203.0.113.9']) {
      const response = await POST(post({ season: 2026 }, { 'x-forwarded-for': address }));
      expect(response.status, address).toBe(404);
    }
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  /**
   * A spoof only reaches this handler if Caddy passed it through, and the
   * tracked `header_up X-Forwarded-For {remote_host}` means it cannot: the
   * client's value is overwritten with the address Caddy observed. What DOES
   * arrive if that ever changes is a chain — and a chain is refused rather
   * than parsed, because under this deployment exactly one hop is produced.
   */
  it('refuses a forwarded chain rather than trusting either end of it', async () => {
    for (const chain of [
      '127.0.0.1, 203.0.113.9',
      '203.0.113.9, 127.0.0.1',
      '127.0.0.1,127.0.0.1',
    ]) {
      const response = await POST(post({ season: 2026 }, { 'x-forwarded-for': chain }));
      expect(response.status, chain).toBe(404);
    }
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('refuses a malformed forwarded client', async () => {
    for (const junk of ['', '   ', 'localhost', '127.0.0.1:9000', 'not-an-address', '0177.0.0.1']) {
      const response = await POST(post({ season: 2026 }, { 'x-forwarded-for': junk }));
      expect(response.status, JSON.stringify(junk)).toBe(404);
    }
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  /**
   * The one case the framework does not produce today. It is served, not
   * refused: every proxy block in `deploy/` sets the header, so a request
   * with no forwarding identity at all did not come through one — and a
   * future framework that stops synthesising must not silently make this
   * feature inert again, which is precisely what §10.2 was.
   */
  it('serves a request with no forwarding identity at all', async () => {
    const response = await POST(postWithoutForwarding({ season: 2026 }));
    expect(response.status).toBe(200);
  });

  it('checks the caller BEFORE the secret, so a public probe learns nothing', async () => {
    const response = await POST(post({ season: 2026 }, {
      'x-forwarded-for': '203.0.113.9', [REVALIDATE_SECRET_HEADER]: 'wrong',
    }));
    expect(response.status).toBe(404);
    expect(mocks.rateLimitCheck).not.toHaveBeenCalled();
  });

  it('charges only failed secret checks against the limiter', async () => {
    await POST(post({ season: 2026 }));
    expect(mocks.rateLimitCheck).not.toHaveBeenCalled();
    await POST(post({ season: 2026 }, { [REVALIDATE_SECRET_HEADER]: 'wrong' }));
    expect(mocks.rateLimitCheck).toHaveBeenCalledTimes(1);
  });

  it('refuses once the failure limiter has tripped', async () => {
    mocks.rateLimitPeek.mockReturnValue(true);
    const response = await POST(post({ season: 2026 }));
    expect(response.status).toBe(429);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  /**
   * The security property the issue asks for by name: there is no input by
   * which a caller can name a path, a route pattern, a layout or a tag. The
   * body carries an integer year; the handler composes the path.
   */
  it('admits no arbitrary path, pattern or tag', async () => {
    const injections: unknown[] = [
      { season: '2026' },
      { season: '/admin' },
      { season: '2026/../../admin' },
      { season: '../../' },
      { season: 2026.5 },
      { season: Number.NaN },
      { season: Infinity },
      { season: null },
      { season: [2026] },
      { season: { toString: () => '2026' } },
      { path: '/admin', season: undefined },
      { tag: '_N_T_/admin' },
      { season: 1896 },
      { season: 2201 },
      {},
    ];
    for (const body of injections) {
      const response = await POST(post(body));
      expect(response.status).toBe(400);
    }
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('refuses a body that is not JSON at all', async () => {
    const response = await POST(post('{not json'));
    expect(response.status).toBe(400);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('bounds the season a caller may name', () => {
    expect(isPlausibleSeason(1897)).toBe(true);
    expect(isPlausibleSeason(2026)).toBe(true);
    expect(isPlausibleSeason(2200)).toBe(true);
    expect(isPlausibleSeason(1896)).toBe(false);
    expect(isPlausibleSeason(2201)).toBe(false);
    expect(isPlausibleSeason('2026')).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * The route being invalidated is still the route that needs it
 * ------------------------------------------------------------------ */

describe('AFLDB-ISSUE-134 — the season route contract this depends on', () => {
  it('still declares the ISR window and prerenders every season', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/app/seasons/[year]/page.tsx', 'utf8');
    // If either of these goes, the invalidation is either unnecessary or
    // aimed at the wrong thing, and this test should be the one that says so.
    expect(source).toContain('export const revalidate = 3600;');
    expect(source).toContain('export async function generateStaticParams()');
  });

  it('is reachable without a session, like the other machine-to-machine route', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/middleware.ts', 'utf8');
    expect(source).toContain("'/api/internal/revalidate-season'");
  });

  it('is told the cluster size by the supervisor, since a worker cannot derive it', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('deploy/server-cluster.mjs', 'utf8');
    // The ordinal and the count are both assigned by the PRIMARY at fork
    // time: the one process that knows how many it forked. A worker reading
    // availableParallelism() would report the machine's cores, and
    // AFLDB_WORKERS is unset on hosts taking the default.
    expect(source).toContain('AFLDB_WORKER_ID: String(ordinal)');
    expect(source).toContain('AFLDB_WORKER_COUNT: String(workers)');
    // A replacement inherits the dead worker's ordinal, so the set of
    // ordinals stays 1..N across a crash rather than drifting upwards.
    expect(source).toContain('fork(ordinal ?? ordinals.size + 1)');
  });

  /**
   * The exit-code gate, asserted the way `tests/current-season-import.test.ts`
   * asserts the AFLDB-ISSUE-128 one: `main()` is not exported and runs only
   * as an entry point, so the contract is read off the source.
   */
  it('decides the exit code AFTER the run returns, so a cache failure costs no data',
    async () => {
      const { readFileSync } = await import('node:fs');
      const cli = readFileSync('tools/current-season/settle-afltables.ts', 'utf8');
      const main = cli.slice(cli.indexOf('async function main('));
      expect(main).toContain('const outcome = await runSettleCli(');
      expect(main).toContain('outcome.revalidation && !outcome.revalidation.ok');
      expect(main).toContain('process.exitCode = 1');
      // The gate may not undo, retry or re-run the settle it is reporting on.
      expect(main).not.toMatch(/rollback|--force|skip/i);
    });

  it('reaches the boundary only after runSettleAfltables has returned', async () => {
    const { readFileSync } = await import('node:fs');
    const cli = readFileSync('tools/current-season/settle-afltables.ts', 'utf8');
    expect(cli.indexOf('const result = await runSettleAfltables('))
      .toBeLessThan(cli.indexOf('await maybeRevalidate(deps'));
    expect(cli).toContain('if (!shouldRevalidateSeason(result)) return null;');
  });
});


/* ------------------------------------------------------------------ *
 * The caller classifier, and the deployment contract it rests on
 * ------------------------------------------------------------------ */

describe('AFLDB-ISSUE-134 — classifying the forwarded client', () => {
  it('accepts only the loopback forms this deployment can emit', () => {
    for (const value of [
      '127.0.0.1',
      '127.0.0.53',
      '127.1.2.3',
      '::1',
      '[::1]',
      '::ffff:127.0.0.1',
      '::FFFF:127.0.0.1',
      ' 127.0.0.1 ',
    ]) {
      expect(classifyForwardedClient(value), value).toBe('loopback');
    }
  });

  it('calls a real non-loopback address remote, whatever family it is in', () => {
    for (const value of [
      '203.0.113.9',
      '10.0.0.4',
      '192.168.1.10',
      '128.0.0.1',
      '27.0.0.1',
      '2001:db8::1',
      '::ffff:203.0.113.9',
      '::',
    ]) {
      expect(classifyForwardedClient(value), value).toBe('remote');
    }
  });

  /**
   * `0177.0.0.1` is the one that matters: a reader that parsed octets with
   * `Number()` would see 127 and call it loopback. Nothing in this deployment
   * emits leading zeros, so they are refused rather than interpreted.
   */
  it('refuses anything that is not an address, including octal-looking octets', () => {
    for (const value of [
      '',
      '   ',
      'localhost',
      '127.0.0.1:9000',
      '0177.0.0.1',
      '127.0.0.1.',
      '127.0.0',
      '127.0.0.256',
      'not-an-address',
      '<script>',
    ]) {
      expect(classifyForwardedClient(value), JSON.stringify(value)).toBe('malformed');
    }
  });

  it('refuses a chain rather than picking a hop out of it', () => {
    for (const value of [
      '127.0.0.1, 203.0.113.9',
      '203.0.113.9, 127.0.0.1',
      '127.0.0.1,127.0.0.1',
      ',',
    ]) {
      expect(classifyForwardedClient(value), value).toBe('chained');
    }
  });

  it('reports an absent header as absent rather than as an address', () => {
    expect(classifyForwardedClient(null)).toBe('absent');
    expect(classifyForwardedClient(undefined)).toBe('absent');
  });

  it('serves loopback and absent, and nothing else', () => {
    expect(isServableForwardedClient('loopback')).toBe(true);
    expect(isServableForwardedClient('absent')).toBe(true);
    expect(isServableForwardedClient('remote')).toBe(false);
    expect(isServableForwardedClient('chained')).toBe(false);
    expect(isServableForwardedClient('malformed')).toBe(false);
  });
});

/**
 * THE SECURITY MODEL IS A DEPLOYMENT CONTRACT, SO ASSERT THE DEPLOYMENT.
 *
 * The route believes `x-forwarded-for` because two tracked files make it
 * believable: every reverse proxy OVERWRITES the header with the address it
 * observed, and the application binds loopback so nothing can reach it
 * without passing through one. Change either — an `{http.request.header...}`
 * append, a `header_up` line dropped from a new site block, a bind on
 * 0.0.0.0 — and the gate silently becomes "trust whatever the client typed".
 *
 * `src/lib/auth/session.ts` already stakes the audit trail on the same
 * property; this suite is where the property itself is enforced, so it cannot
 * be invalidated by an edit to a `.Caddyfile` that no test looks at.
 */
describe('AFLDB-ISSUE-134 — the reverse-proxy contract the loopback gate rests on', () => {
  const CADDYFILES = ['deploy/Caddyfile', 'deploy/Caddyfile.production'];

  const read = (path: string): string => readFileSync(path, 'utf8');

  it.each(CADDYFILES)('%s overwrites X-Forwarded-For on every proxy block', (path) => {
    const source = read(path);
    const proxies = source.match(/reverse_proxy\s+127\.0\.0\.1:3100/g) ?? [];
    const overwrites = source.match(/header_up\s+X-Forwarded-For\s+\{remote_host\}/g) ?? [];
    expect(proxies.length).toBeGreaterThan(0);
    // One per proxy block: a new site that forgets the line inherits Caddy's
    // append-the-client-value default, and this is what says so.
    expect(overwrites.length).toBe(proxies.length);
  });

  it.each(CADDYFILES)('%s never appends or forwards a client-supplied hop', (path) => {
    const source = read(path);
    // The append idioms. Any of these means the client's own value survives
    // into the header the route reads.
    expect(source).not.toMatch(/header_up\s+\+X-Forwarded-For/);
    expect(source).not.toMatch(/X-Forwarded-For\s+.*\{http\.request\.header/);
    expect(source).not.toMatch(/trusted_proxies/);
  });

  it.each(CADDYFILES)('%s drops the other client-supplied address headers', (path) => {
    const source = read(path);
    const proxies = (source.match(/reverse_proxy\s+127\.0\.0\.1:3100/g) ?? []).length;
    expect((source.match(/header_up\s+-X-Real-IP/g) ?? []).length).toBe(proxies);
    expect((source.match(/header_up\s+-Forwarded/g) ?? []).length).toBe(proxies);
  });

  it('binds the application to loopback, so the proxy is the only way in', () => {
    expect(read('deploy/afldb.service')).toContain('Environment=HOSTNAME=127.0.0.1');
  });

  /**
   * The framework behaviour the whole gate turns on, read off the installed
   * package rather than remembered. `??=` is what makes Caddy's value
   * survive; were it a plain assignment, every request would look loopback.
   */
  it('relies on Next filling x-forwarded-for only when the proxy did not', () => {
    const source = read('node_modules/next/dist/server/base-server.js');
    expect(source).toMatch(/req\.headers\['x-forwarded-for'\]\s*\?\?=/);
  });
});
