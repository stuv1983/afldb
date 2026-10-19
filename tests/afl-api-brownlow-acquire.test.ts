/**
 * AFLDB-ISSUE-228 S7 follow-up — collision-safety coverage for
 * `tools/current-season/acquire-afl-api-brownlow.ts`. DB-free: every fetch
 * is stubbed, nothing here opens a network connection or a database client.
 *
 * Bug this guards against: two Brownlow acquisitions landing inside the
 * same wall-clock minute (live-count monitoring can run acquisitions more
 * than once a minute) previously generated the IDENTICAL snapshot label —
 * `buildAflApiBrownlowLabel()` only had minute granularity, and
 * `mkdirSync(dir, { recursive: true })` silently no-ops on an existing
 * directory rather than refusing — so the second acquisition's raw files
 * and manifest silently overwrote the first's, destroying evidence. See
 * `tests/afl-api-match.test.ts` for the equivalent coverage on
 * `acquire-afl-api.ts` (matches/fixtures), which shares the same
 * `claimSnapshotDir()` primitive from `src/lib/acquisition/snapshot-dir.ts`.
 */
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  afterEach, describe, expect, it,
} from 'vitest';

import {
  AFL_API_MIN_REQUEST_INTERVAL_MS,
  AflApiRequestError,
  type FetchLike,
} from '@/lib/acquisition/afl-api-client';
import { readAflApiIngestionControls } from '@/lib/acquisition/afl-api-ingestion-control';
import {
  buildAflApiBrownlowLabel,
  cleanupPartialBrownlowSnapshot,
  runBrownlowAcquisition,
} from '../tools/current-season/acquire-afl-api-brownlow';

// ---------------------------------------------------------------------------
// Stub fetch helpers (mirrors tests/afl-api-match.test.ts)
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

function stubFetch(
  handlers: readonly { test: (url: string) => boolean; respond: (url: string) => Response | Promise<Response> }[],
): { fetchImpl: FetchLike } {
  const fetchImpl = (async (input: string | URL, _init?: RequestInit) => {
    const url = String(input);
    const handler = handlers.find((h) => h.test(url));
    if (!handler) throw new Error(`no handler for ${url}`);
    return handler.respond(url);
  }) as FetchLike;
  return { fetchImpl };
}

function noSleep(): Promise<void> {
  return Promise.resolve();
}

const BROWNLOW_ENV = { AFLDB_AFL_API_BROWNLOW_ENABLED: 'true' };

/**
 * AFLDB-ISSUE-228 follow-up (§D two-key safety) — `runBrownlowAcquisition()`
 * now ALSO requires the super-admin DB switch
 * (`src/lib/acquisition/afl-api-ingestion-control.ts`) alongside the
 * deployment env var above. This file is DB-free by design (module doc), so
 * every existing happy-path call below supplies this override.
 */
const BROWNLOW_ENABLED_CONTROLS = { currentSeasonEnabled: false, brownlowAdminEnabled: true };

function brownlowHandlers(seasonVotes: unknown, leaderboard: unknown, tokenValue = 'tok-1') {
  return [
    { test: (u: string) => u.endsWith('/afl/WMCTok'), respond: () => jsonResponse({ token: tokenValue }) },
    { test: (u: string) => u.includes('/afl/bfawards/leaderboard/season/'), respond: () => jsonResponse(leaderboard) },
    { test: (u: string) => u.includes('/afl/bfawards/season/'), respond: () => jsonResponse(seasonVotes) },
  ];
}

describe('acquire-afl-api-brownlow.ts — snapshot collision safety (AFLDB-ISSUE-228 S7 follow-up)', () => {
  const scratch: string[] = [];
  afterEach(() => {
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function makeProjectRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'afldb-issue-228-brownlow-acquire-'));
    scratch.push(root);
    mkdirSync(join(root, 'data', 'reference'), { recursive: true });
    writeFileSync(
      join(root, 'data', 'reference', 'afl-api-identities.json'),
      JSON.stringify({ seasons: { 2025: { providerId: 'CD_S2025014' } } }),
    );
    return root;
  }

  describe('buildAflApiBrownlowLabel (D: existing single-acquisition behaviour)', () => {
    it('renders afl-api-brownlow-<season>-<YYYY-MM-DD-HHMMSS> in UTC', () => {
      const now = new Date('2026-09-20T10:08:00Z');
      expect(buildAflApiBrownlowLabel(2025, now)).toBe('afl-api-brownlow-2025-2026-09-20-100800');
    });
  });

  it('A: two acquisitions at the identical mocked wall-clock second obtain distinct labels/paths', async () => {
    const projectRoot = makeProjectRoot();
    const now = new Date('2026-09-20T10:08:00Z');

    const badVoteValues = { matches: [{ providerId: 'CD_M1', votes: [2, 2, 1] }] };
    const incompleteVoteSet = { matches: [{ providerId: 'CD_M1', votes: [2] }] };
    const leaderboard = { players: [] };

    const { fetchImpl: fetchImpl1 } = stubFetch(brownlowHandlers(badVoteValues, leaderboard));
    const result1 = await runBrownlowAcquisition(
      { season: 2025 },
      {
        fetchImpl: fetchImpl1, projectRoot, now, env: BROWNLOW_ENV, ingestionControls: BROWNLOW_ENABLED_CONTROLS, retryOpts: { sleep: noSleep },
      },
    );

    const { fetchImpl: fetchImpl2 } = stubFetch(brownlowHandlers(incompleteVoteSet, leaderboard));
    const result2 = await runBrownlowAcquisition(
      { season: 2025 },
      {
        fetchImpl: fetchImpl2, projectRoot, now, env: BROWNLOW_ENV, ingestionControls: BROWNLOW_ENABLED_CONTROLS, retryOpts: { sleep: noSleep },
      },
    );

    expect(result1.label).not.toBe(result2.label);
    expect(result1.snapshotDir).not.toBe(result2.snapshotDir);
    expect(result2.label).toBe(`${result1.label}-2`);

    // B: the second acquisition never modified any file belonging to the first snapshot.
    const raw1 = JSON.parse(readFileSync(join(result1.snapshotDir, '01-brownlow-season.raw.json'), 'utf8'));
    const raw2 = JSON.parse(readFileSync(join(result2.snapshotDir, '01-brownlow-season.raw.json'), 'utf8'));
    expect(raw1).toEqual(badVoteValues);
    expect(raw2).toEqual(incompleteVoteSet);
    expect(raw1.matches[0].votes).toEqual([2, 2, 1]);
    expect(raw2.matches[0].votes).toEqual([2]);

    // C: both manifests remain readable and correspond to their own payload.
    const manifest1 = JSON.parse(readFileSync(result1.manifestPath, 'utf8'));
    const manifest2 = JSON.parse(readFileSync(result2.manifestPath, 'utf8'));
    expect(manifest1.label).toBe(result1.label);
    expect(manifest2.label).toBe(result2.label);
    for (const entry of manifest1.files as { file: string; sha256: string }[]) {
      const bytes = readFileSync(join(result1.snapshotDir, entry.file), 'utf8');
      expect(createHash('sha256').update(Buffer.from(bytes, 'utf8')).digest('hex')).toBe(entry.sha256);
    }
    for (const entry of manifest2.files as { file: string; sha256: string }[]) {
      const bytes = readFileSync(join(result2.snapshotDir, entry.file), 'utf8');
      expect(createHash('sha256').update(Buffer.from(bytes, 'utf8')).digest('hex')).toBe(entry.sha256);
    }
  });

  describe('AFLDB-ISSUE-228 follow-up — §D two-key admin gate', () => {
    const projectRoot0 = () => makeProjectRoot();

    it('refuses before any network request when the deployment env gate is enabled but the admin DB switch is not', async () => {
      const projectRoot = projectRoot0();
      // No handlers registered: `stubFetch` throws "no handler for <url>" if
      // this ever reaches a network call, which is exactly what proves the
      // refusal happens first.
      const { fetchImpl } = stubFetch([]);

      await expect(runBrownlowAcquisition(
        { season: 2025 },
        {
          fetchImpl, projectRoot, env: BROWNLOW_ENV, retryOpts: { sleep: noSleep },
          ingestionControls: { currentSeasonEnabled: false, brownlowAdminEnabled: false },
        },
      )).rejects.toThrow(/two-key safety/);
    });

    it('AFLDB-ISSUE-300: an unreadable control database is reported as a read failure, not as a disabled admin switch', async () => {
      const projectRoot = projectRoot0();
      const { fetchImpl } = stubFetch([]);
      const controls = await readAflApiIngestionControls({});

      const refusal = runBrownlowAcquisition(
        { season: 2025 },
        { fetchImpl, projectRoot, env: BROWNLOW_ENV, retryOpts: { sleep: noSleep }, ingestionControls: controls },
      );
      await expect(refusal).rejects.toThrow(/refused: deployment gate \(\w+\) is enabled, and super-admin setting .* is unknown because the ingestion switches could not be read: DATABASE_URL is not set/);
      await expect(refusal).rejects.not.toThrow(/is disabled outside the live count window/);
    });

    it('refuses when the admin DB switch is enabled but the deployment env gate is not', async () => {
      const projectRoot = projectRoot0();
      const { fetchImpl } = stubFetch([]);

      await expect(runBrownlowAcquisition(
        { season: 2025 },
        {
          fetchImpl, projectRoot, env: {}, retryOpts: { sleep: noSleep },
          ingestionControls: { currentSeasonEnabled: false, brownlowAdminEnabled: true },
        },
      )).rejects.toThrow(/two-key safety/);
    });
  });

  it('B: a pre-existing directory at the generated label is never written into or overwritten', async () => {
    const projectRoot = makeProjectRoot();
    const now = new Date('2026-09-20T10:08:00Z');
    const baseLabel = buildAflApiBrownlowLabel(2025, now);
    const parentDir = join(projectRoot, 'data', 'sources', 'afl_api', 'brownlow');
    const staleDir = join(parentDir, baseLabel);
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(join(staleDir, 'sentinel.txt'), 'pre-existing evidence — must not be touched');

    const { fetchImpl } = stubFetch(brownlowHandlers({ matches: [] }, { players: [] }));
    const result = await runBrownlowAcquisition(
      { season: 2025 },
      {
        fetchImpl, projectRoot, now, env: BROWNLOW_ENV, ingestionControls: BROWNLOW_ENABLED_CONTROLS, retryOpts: { sleep: noSleep },
      },
    );

    expect(result.label).not.toBe(baseLabel);
    expect(result.snapshotDir).not.toBe(staleDir);
    expect(readFileSync(join(staleDir, 'sentinel.txt'), 'utf8')).toBe('pre-existing evidence — must not be touched');
    expect(existsSync(join(staleDir, 'manifest.json'))).toBe(false);
  });

  it('D: a normal single acquisition still lands at the unsuffixed base label', async () => {
    const projectRoot = makeProjectRoot();
    const now = new Date('2026-09-20T10:08:00Z');
    const { fetchImpl } = stubFetch(brownlowHandlers({ matches: [] }, { players: [] }));

    const result = await runBrownlowAcquisition(
      { season: 2025 },
      {
        fetchImpl, projectRoot, now, env: BROWNLOW_ENV, ingestionControls: BROWNLOW_ENABLED_CONTROLS, retryOpts: { sleep: noSleep },
      },
    );

    expect(result.label).toBe('afl-api-brownlow-2025-2026-09-20-100800');
    expect(existsSync(result.manifestPath)).toBe(true);
  });

  it('cleanupPartialBrownlowSnapshot targets exactly the directory claimed via onSnapshotDirClaimed, leaving a sibling collision label untouched', async () => {
    const projectRoot = makeProjectRoot();
    const now = new Date('2026-09-20T10:08:00Z');

    const { fetchImpl: fetchImplOk } = stubFetch(brownlowHandlers({ matches: [] }, { players: [] }));
    const first = await runBrownlowAcquisition(
      { season: 2025 },
      {
        fetchImpl: fetchImplOk, projectRoot, now, env: BROWNLOW_ENV, ingestionControls: BROWNLOW_ENABLED_CONTROLS, retryOpts: { sleep: noSleep },
      },
    );

    // Second run at the same second fails after the token but before the manifest write.
    const failingHandlers = [
      { test: (u: string) => u.endsWith('/afl/WMCTok'), respond: () => jsonResponse({ token: 'tok-2' }) },
      { test: (u: string) => u.includes('/afl/bfawards/season/'), respond: () => new Response('server error', { status: 500 }) },
    ];
    const { fetchImpl: fetchImplFail } = stubFetch(failingHandlers);
    let claimedSnapshotDir: string | null = null;
    await expect(runBrownlowAcquisition(
      { season: 2025 },
      {
        fetchImpl: fetchImplFail,
        projectRoot,
        now,
        env: BROWNLOW_ENV, ingestionControls: BROWNLOW_ENABLED_CONTROLS,
        retryOpts: { sleep: noSleep },
        onSnapshotDirClaimed: (dir) => { claimedSnapshotDir = dir; },
      },
    )).rejects.toThrow();

    expect(claimedSnapshotDir).not.toBeNull();
    expect(claimedSnapshotDir).not.toBe(first.snapshotDir);
    if (claimedSnapshotDir) cleanupPartialBrownlowSnapshot(claimedSnapshotDir, () => {});

    // The failed run's own (suffixed) directory is gone; the first, complete snapshot is untouched.
    if (claimedSnapshotDir) expect(existsSync(claimedSnapshotDir)).toBe(false);
    expect(existsSync(first.manifestPath)).toBe(true);
  });

  it('W4 (Launch B): the manifest records each raw file\'s request, the tool, the start time and the request parameters, and never the token', async () => {
    const projectRoot = makeProjectRoot();
    const secret = 'tok-SECRET-w4-brownlow-0123';
    const seen: { url: string; method: string; headers: string }[] = [];
    const { fetchImpl: inner } = stubFetch(brownlowHandlers({ matches: [] }, { players: [] }, secret));
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      seen.push({ url: String(url), method: init?.method ?? 'GET', headers: JSON.stringify(init?.headers ?? {}) });
      return inner(url, init);
    }) as FetchLike;

    const result = await runBrownlowAcquisition(
      { season: 2025 },
      {
        fetchImpl, projectRoot, now: new Date('2026-09-20T10:08:00Z'), env: BROWNLOW_ENV,
        ingestionControls: BROWNLOW_ENABLED_CONTROLS, retryOpts: { sleep: noSleep },
      },
    );
    const manifestText = readFileSync(result.manifestPath, 'utf8');
    const manifest = JSON.parse(manifestText);

    const seasonUrl = seen.find((c) => c.url.includes('/afl/bfawards/season/'))?.url;
    const leaderboardUrl = seen.find((c) => c.url.includes('/afl/bfawards/leaderboard/season/'))?.url;
    expect(seasonUrl).toBeDefined();
    expect(leaderboardUrl).toBeDefined();
    expect(manifest.files.map((f: { file: string; request: unknown }) => [f.file, f.request])).toEqual([
      ['01-brownlow-season.raw.json', { method: 'GET', url: seasonUrl }],
      ['02-brownlow-leaderboard.raw.json', { method: 'GET', url: leaderboardUrl }],
    ]);
    expect(manifest.acquisition_tool).toBe('acquire-afl-api-brownlow.ts');
    expect(manifest.request_parameters).toEqual({ season_provider_id: 'CD_S2025014' });
    expect(Date.parse(manifest.acquisition_started_at)).toBeLessThanOrEqual(Date.parse(manifest.acquired_at));
    // acquired_at keeps its meaning (completion time) and the pre-existing keys are all still present.
    for (const key of ['contract_version', 'source_key', 'acquisition_kind', 'label', 'season', 'season_provider_id', 'files']) {
      expect(manifest).toHaveProperty(key);
    }

    // The token travelled in a header on the CFS requests, and is recorded nowhere in the manifest.
    expect(seen.some((c) => c.headers.includes(secret))).toBe(true);
    expect(manifestText).not.toContain(secret);
  });

  it('W4 (Launch B): a 2xx Brownlow body that is not JSON fails with the URL and status, before any file is written', async () => {
    const projectRoot = makeProjectRoot();
    const now = new Date('2026-09-20T10:08:00Z');
    const snapshotDir = join(projectRoot, 'data', 'sources', 'afl_api', 'brownlow', buildAflApiBrownlowLabel(2025, now));
    const { fetchImpl } = stubFetch([
      { test: (u: string) => u.endsWith('/afl/WMCTok'), respond: () => jsonResponse({ token: 'tok-1' }) },
      { test: (u: string) => u.includes('/afl/bfawards/leaderboard/season/'), respond: () => jsonResponse({ players: [] }) },
      { test: (u: string) => u.includes('/afl/bfawards/season/'), respond: () => new Response('<html>maintenance</html>', { status: 200 }) },
    ]);
    const error = await runBrownlowAcquisition(
      { season: 2025 },
      {
        fetchImpl, projectRoot, now, env: BROWNLOW_ENV,
        ingestionControls: BROWNLOW_ENABLED_CONTROLS, retryOpts: { sleep: noSleep },
      },
    ).catch((e) => e);
    expect(error).toBeInstanceOf(AflApiRequestError);
    expect((error as AflApiRequestError).message).toMatch(/Brownlow season response from GET \S+\/afl\/bfawards\/season\/CD_S2025014 \(HTTP 200\) was not valid JSON/);
    expect(readdirSync(snapshotDir)).toEqual([]);
  });

  it('W4 (Launch B): a 404 is requested once, and the tool spaces its requests by the default interval on the injected clock', async () => {
    const projectRoot = makeProjectRoot();
    const clock = { t: 9_000 };
    const starts: number[] = [];
    const seasonCalls: string[] = [];
    const { fetchImpl: inner } = stubFetch([
      { test: (u: string) => u.endsWith('/afl/WMCTok'), respond: () => jsonResponse({ token: 'tok-1' }) },
      { test: (u: string) => u.includes('/afl/bfawards/leaderboard/season/'), respond: () => new Response('missing', { status: 404 }) },
      { test: (u: string) => u.includes('/afl/bfawards/season/'), respond: () => jsonResponse({ matches: [] }) },
    ]);
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      starts.push(clock.t);
      if (String(url).includes('leaderboard')) seasonCalls.push(String(url));
      return inner(url, init);
    }) as FetchLike;

    await expect(runBrownlowAcquisition(
      { season: 2025 },
      {
        fetchImpl, projectRoot, now: new Date('2026-09-20T10:08:00Z'), env: BROWNLOW_ENV,
        ingestionControls: BROWNLOW_ENABLED_CONTROLS,
        retryOpts: { now: () => clock.t, sleep: async (ms) => { clock.t += ms; } },
      },
    )).rejects.toThrow(/failed with 404 \(not retried: the resource does not exist/);

    expect(seasonCalls).toHaveLength(1); // the 404 was not retried
    expect(starts).toHaveLength(3); // token, season votes, leaderboard
    for (let i = 1; i < starts.length; i += 1) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(AFL_API_MIN_REQUEST_INTERVAL_MS);
    }
  });
});
