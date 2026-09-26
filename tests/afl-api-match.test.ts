/**
 * AFLDB-ISSUE-228 S2 (§7.1, §17, §18.1) — the AFL.com.au direct-HTTP
 * acquisition adapter. DB-free: every fetch is stubbed, nothing here opens a
 * network connection or a database client.
 *
 * Covers `src/lib/acquisition/afl-api-client.ts` (request planning, retry
 * and backoff, token reissue-once, response validation of the season
 * matches envelope) and `tools/current-season/acquire-afl-api.ts`
 * (arg parsing, the acquisition label, and the manifest-LAST / partial-
 * snapshot-cleanup contract §5.4 borrows from
 * `deploy/afldb-settle-afltables.sh`'s `cleanup_partial`).
 *
 * Parsing/canonicalisation/round-mapping/gates are S3 (`afl-api-bundle.ts`,
 * `tests/afl-api-rounds.test.ts`) and are deliberately out of scope here.
 */
import {
  afterEach, describe, expect, it,
} from 'vitest';

import type postgres from 'postgres';

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AflApiRequestError,
  type AflApiRequestPlan,
  DEFAULT_AFL_API_BASES,
  fetchAflApiCfsResource,
  fetchAflApiToken,
  type FetchLike,
  parseAflApiSeasonMatchesEnvelope,
  planAflApiCompSeasonsRequest,
  planAflApiMatchRosterRequest,
  planAflApiPlayerStatsRequest,
  planAflApiSeasonMatchesRequest,
  planAflApiTokenRequest,
  requestAflApi,
  resolveAflApiEndpointBases,
  selectAflApiMatches,
} from '@/lib/acquisition/afl-api-client';
import {
  buildAflApiLabel,
  cleanupPartialSnapshot,
  parseAcquireArgs,
  runAcquisition,
} from '../tools/current-season/acquire-afl-api';
import {
  ASSERTION_9_PAIR,
  diffCanonicalPaths,
  runSemanticPairAssertion,
  type SemanticPair,
} from '../tools/current-season/emit-afl-api-bundle';
import {
  parseDiscoverAflApiSeasonsArgs,
  runDiscoverAflApiSeasons,
} from '../tools/current-season/discover-afl-api-seasons';
import {
  parseAcknowledgeAbsenceArgs,
  runAcknowledgeAflApiMatchAbsence,
} from '../tools/current-season/acknowledge-afl-api-match-absence';
import {
  REKEY_CASES,
  rekeyRehearsalBundle,
  rekeyRehearsalEnumeration,
  rekeyRehearsalSeasonFeed,
  rekeyRehearsalSeasonFeedText,
  rekeyRehearsalUnitSource,
  savepointSql,
} from '../tools/db/afl-api-season-rekey-rehearsal';
import {
  AFL_API_MATCH_ABSENCE_ACTOR_NOTE,
  AFL_API_MATCH_ABSENCE_HALT_REASON,
  AflApiMatchAbsenceAckRefused,
  acknowledgeAflApiMatchAbsence,
  aflApiMatchAbsenceAcknowledgementRecord,
  aflApiMatchAbsenceIssueKey,
  proveAflApiMatchAbsenceFeed,
  sweepAflApiMatchAbsence,
  type AflApiMatchAbsenceDetection,
} from '@/lib/acquisition/afl-api-match-absence';
import {
  buildAflApiMatchBundle,
  buildAflApiSettleRecords,
  canonicalStringify,
  emitAflApiBrownlowLeaderboard,
  emitAflApiBrownlowMatchVotes,
  emitAflApiMatch,
  emitAflApiMatchRoster,
  emitAflApiPlayerMatchStats,
  flattenObservedColumns,
  parseAflApiIdentities,
  reconcileBrownlowLeaderboard,
  semanticHash,
} from '@/lib/acquisition/afl-api-bundle';
import { buildAflApiFixtureRecords } from '@/lib/acquisition/afl-api-fixture-identity';
import {
  type AflApiMatchIdentity,
  resolveAflApiMatch,
} from '@/lib/acquisition/afl-api-match-resolver';
import { resolveAflApiPlayer } from '@/lib/acquisition/afl-api-player-resolver';
import {
  AFL_API_ABSENCE_TOLERANCE,
  AFL_API_SEASON_FEED_FILE,
  aflApiMatchRekeyScope,
  assessAflApiSeasonEnumeration,
  describeAflApiSeasonEnumeration,
  missingAflApiSeasonEnumeration,
  planAflApiAbsenceSweep,
} from '@/lib/acquisition/afl-api-season-enumeration';
import {
  parseAflApiCompSeasons,
  proposeAflApiSeasons,
  serialiseAflApiSeasonDiscoveryProposal,
  type RegisteredAflApiSeason,
} from '@/lib/acquisition/afl-api-season-discovery';
import { aflApiSeasonFeedTextFrom } from '@/lib/acquisition/afl-api-snapshot';
import { NO_MATCH_REKEY_SCOPE } from '@/lib/acquisition/match-rekey';
import { AflApiMatchAbsenceHalt, AflApiSettleHalt, buildAflApiSettleBundle } from '@/lib/acquisition/settle-afl-api';
import { getSourceFamily, parseSourceFamilyRegistry } from '@/lib/acquisition/source-families';

// ---------------------------------------------------------------------------
// Stub fetch helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

type RecordedCall = { url: string; init?: RequestInit };

/** Dispatches each call to the first handler whose `test` matches the URL; handlers own their own call-count state via closure. */
function stubFetch(
  handlers: readonly { test: (url: string) => boolean; respond: (url: string, init?: RequestInit) => Response | Promise<Response> }[],
): { fetchImpl: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    const handler = handlers.find((h) => h.test(u));
    if (!handler) throw new Error(`stubFetch: no handler for ${u}`);
    return handler.respond(u, init);
  }) as FetchLike;
  return { fetchImpl, calls };
}

const noSleep = async (): Promise<void> => {};

/**
 * AFLDB-ISSUE-228 follow-up — `runAcquisition()` now refuses before any
 * network call unless the super-admin DB switch is enabled
 * (`src/lib/acquisition/afl-api-ingestion-control.ts`). This file is DB-free
 * by design (module doc), so every existing happy-path call below supplies
 * this override rather than falling back to a real database read.
 */
const ENABLED_INGESTION_CONTROLS = { currentSeasonEnabled: true, brownlowAdminEnabled: false };

describe('afl-api-client (AFLDB-ISSUE-228 §7.1)', () => {
  describe('resolveAflApiEndpointBases — configurable/redirectable bases', () => {
    it('defaults to the three real AFL.com.au origins', () => {
      expect(resolveAflApiEndpointBases({})).toEqual(DEFAULT_AFL_API_BASES);
    });

    it('redirects ONLY the CFS base when AFLDB_AFL_API_CFS_BASE_URL is set — the Brownlow-simulator case', () => {
      const bases = resolveAflApiEndpointBases({ AFLDB_AFL_API_CFS_BASE_URL: 'http://127.0.0.1:22880' });
      expect(bases.cfs).toBe('http://127.0.0.1:22880');
      expect(bases.public).toBe(DEFAULT_AFL_API_BASES.public);
      expect(bases.sapi).toBe(DEFAULT_AFL_API_BASES.sapi);
    });

    it('resolves all three bases independently', () => {
      const bases = resolveAflApiEndpointBases({
        AFLDB_AFL_API_BASE_URL: 'https://public.example',
        AFLDB_AFL_API_CFS_BASE_URL: 'https://cfs.example',
        AFLDB_AFL_API_SAPI_BASE_URL: 'https://sapi.example',
      });
      expect(bases).toEqual({ public: 'https://public.example', cfs: 'https://cfs.example', sapi: 'https://sapi.example' });
    });
  });

  describe('request planning', () => {
    const bases = DEFAULT_AFL_API_BASES;

    it('plans the WMCTok token request against the CFS base', () => {
      const plan = planAflApiTokenRequest(bases, {});
      expect(plan).toEqual({
        url: 'https://api.afl.com.au/cfs/afl/WMCTok',
        method: 'POST',
        headers: expect.objectContaining({ Accept: 'application/json' }),
      });
    });

    it('plans the season matches request against the public base with competitionId=1', () => {
      const plan = planAflApiSeasonMatchesRequest(bases, 85, {});
      const url = new URL(plan.url);
      expect(url.origin + url.pathname).toBe('https://aflapi.afl.com.au/afl/v2/matches');
      expect(url.searchParams.get('competitionId')).toBe('1');
      expect(url.searchParams.get('compSeasonId')).toBe('85');
      expect(url.searchParams.get('pageSize')).toBe('1000');
      expect(plan.method).toBe('GET');
    });

    it('plans playerStats and matchRoster against the CFS base with the token in x-media-mis-token', () => {
      const stats = planAflApiPlayerStatsRequest(bases, 'CD_M20260142801', 'tok-1', {});
      expect(stats.url).toBe('https://api.afl.com.au/cfs/afl/playerStats/match/CD_M20260142801');
      expect(stats.headers['x-media-mis-token']).toBe('tok-1');

      const roster = planAflApiMatchRosterRequest(bases, 'CD_M20260142801', 'tok-1', {});
      expect(roster.url).toBe('https://api.afl.com.au/cfs/afl/matchRoster/full/CD_M20260142801');
      expect(roster.headers['x-media-mis-token']).toBe('tok-1');
    });

    it('refuses to plan a per-match request with no providerId', () => {
      expect(() => planAflApiPlayerStatsRequest(bases, '', 'tok', {})).toThrow(/matchProviderId/);
      expect(() => planAflApiMatchRosterRequest(bases, '', 'tok', {})).toThrow(/matchProviderId/);
    });

    it('a redirected CFS base changes the CFS-family plans but leaves the season-matches plan alone', () => {
      const simulator = resolveAflApiEndpointBases({ AFLDB_AFL_API_CFS_BASE_URL: 'http://127.0.0.1:22880' });
      expect(planAflApiTokenRequest(simulator, {}).url).toBe('http://127.0.0.1:22880/afl/WMCTok');
      expect(planAflApiSeasonMatchesRequest(simulator, 85, {}).url).toContain('https://aflapi.afl.com.au');
    });
  });

  describe('parseAflApiSeasonMatchesEnvelope + selectAflApiMatches (§2.1)', () => {
    const envelope = JSON.stringify({
      matches: [
        { providerId: 'CD_M1', status: 'CONCLUDED', utcStartTime: '2026-03-05T04:40:00Z' },
        { providerId: 'CD_M2', status: 'POSTGAME', utcStartTime: '2026-09-19T05:00:00Z' },
        { providerId: 'CD_M3', status: 'CONCLUDED', utcStartTime: '2026-08-01T04:40:00Z' },
      ],
    });

    it('extracts providerId/status/utcStartTime for every entry', () => {
      expect(parseAflApiSeasonMatchesEnvelope(envelope)).toEqual([
        { providerId: 'CD_M1', status: 'CONCLUDED', utcStartTime: '2026-03-05T04:40:00Z' },
        { providerId: 'CD_M2', status: 'POSTGAME', utcStartTime: '2026-09-19T05:00:00Z' },
        { providerId: 'CD_M3', status: 'CONCLUDED', utcStartTime: '2026-08-01T04:40:00Z' },
      ]);
    });

    it('throws on invalid JSON', () => {
      expect(() => parseAflApiSeasonMatchesEnvelope('not json')).toThrow();
    });

    it("throws when the envelope carries no 'matches' array", () => {
      expect(() => parseAflApiSeasonMatchesEnvelope(JSON.stringify({}))).toThrow(/matches/);
    });

    it('throws when an entry carries no providerId', () => {
      expect(() => parseAflApiSeasonMatchesEnvelope(JSON.stringify({ matches: [{ status: 'CONCLUDED' }] })))
        .toThrow(/providerId/);
    });

    it('defaults selection to status CONCLUDED', () => {
      const summaries = parseAflApiSeasonMatchesEnvelope(envelope);
      expect(selectAflApiMatches(summaries, {}).map((m) => m.providerId)).toEqual(['CD_M1', 'CD_M3']);
    });

    it('applies --since as an inclusive date floor', () => {
      const summaries = parseAflApiSeasonMatchesEnvelope(envelope);
      expect(selectAflApiMatches(summaries, { since: '2026-08-01' }).map((m) => m.providerId)).toEqual(['CD_M3']);
    });

    it('--match overrides status/since entirely', () => {
      const summaries = parseAflApiSeasonMatchesEnvelope(envelope);
      expect(selectAflApiMatches(summaries, { status: 'CONCLUDED', since: '2026-08-01', match: ['CD_M2'] })
        .map((m) => m.providerId)).toEqual(['CD_M2']);
    });
  });

  describe('requestAflApi — retry, backoff, 401/403 (§17)', () => {
    const plan: AflApiRequestPlan = { url: 'https://example.test/x', method: 'GET', headers: {} };

    it('returns on the first successful attempt with status/etag/cache-control captured', async () => {
      const { fetchImpl, calls } = stubFetch([
        { test: () => true, respond: () => jsonResponse({ ok: true }, { headers: { etag: '"abc"', 'cache-control': 'max-age=3' } }) },
      ]);
      const response = await requestAflApi(fetchImpl, plan, { sleep: noSleep });
      expect(response.status).toBe(200);
      expect(response.etag).toBe('"abc"');
      expect(response.cacheControl).toBe('max-age=3');
      expect(JSON.parse(response.bodyText)).toEqual({ ok: true });
      expect(calls).toHaveLength(1);
    });

    it('retries with backoff on 500 and succeeds on the 3rd attempt', async () => {
      let n = 0;
      const sleeps: number[] = [];
      const { fetchImpl, calls } = stubFetch([
        {
          test: () => true,
          respond: () => {
            n += 1;
            return n < 3 ? new Response('server error', { status: 500 }) : jsonResponse({ ok: true });
          },
        },
      ]);
      const response = await requestAflApi(fetchImpl, plan, {
        sleep: async (ms) => { sleeps.push(ms); },
      });
      expect(response.status).toBe(200);
      expect(calls).toHaveLength(3);
      expect(sleeps).toEqual([500, 1000]); // exponential backoff, two waits between three attempts
    });

    it('throws AflApiRequestError after exhausting all attempts', async () => {
      const { fetchImpl, calls } = stubFetch([
        { test: () => true, respond: () => new Response('nope', { status: 503 }) },
      ]);
      await expect(requestAflApi(fetchImpl, plan, { sleep: noSleep })).rejects.toBeInstanceOf(AflApiRequestError);
      expect(calls).toHaveLength(3);
    });

    it('throws immediately on 401 without retrying — a token problem, not a transient fault', async () => {
      const { fetchImpl, calls } = stubFetch([
        { test: () => true, respond: () => new Response('unauthorised', { status: 401 }) },
      ]);
      const error = await requestAflApi(fetchImpl, plan, { sleep: noSleep }).catch((e) => e);
      expect(error).toBeInstanceOf(AflApiRequestError);
      expect((error as AflApiRequestError).status).toBe(401);
      expect(calls).toHaveLength(1);
    });
  });

  describe('fetchAflApiToken — WMCTok shape validation (operator-verified 2026-09-19; no sanitised fixture yet, §1.2/R6)', () => {
    it('returns the token from a { token: string } response', async () => {
      const { fetchImpl } = stubFetch([{ test: () => true, respond: () => jsonResponse({ token: 'tok-123' }) }]);
      await expect(fetchAflApiToken(fetchImpl, DEFAULT_AFL_API_BASES, {}, { sleep: noSleep })).resolves.toBe('tok-123');
    });

    it('fails closed on a non-JSON body', async () => {
      const { fetchImpl } = stubFetch([{ test: () => true, respond: () => new Response('<html>nope</html>', { status: 200 }) }]);
      await expect(fetchAflApiToken(fetchImpl, DEFAULT_AFL_API_BASES, {}, { sleep: noSleep })).rejects.toThrow(/JSON/);
    });

    it('fails closed when the token field is missing or empty', async () => {
      const { fetchImpl } = stubFetch([{ test: () => true, respond: () => jsonResponse({ token: '' }) }]);
      await expect(fetchAflApiToken(fetchImpl, DEFAULT_AFL_API_BASES, {}, { sleep: noSleep })).rejects.toThrow(/token/);
    });
  });

  describe('fetchAflApiCfsResource — reissue-once policy (§17)', () => {
    it('succeeds on the first attempt without reissuing', async () => {
      const { fetchImpl } = stubFetch([{ test: () => true, respond: () => jsonResponse({ ok: true }) }]);
      const reissue = async () => { throw new Error('should not be called'); };
      const result = await fetchAflApiCfsResource(
        fetchImpl, (token) => ({ url: `https://example.test/${token}`, method: 'GET', headers: {} }),
        'tok-old', reissue, { sleep: noSleep },
      );
      expect(result.tokenReissued).toBe(false);
    });

    it('reissues once on 401 and succeeds with the fresh token', async () => {
      const seen: string[] = [];
      const { fetchImpl } = stubFetch([
        {
          test: (url) => url.endsWith('tok-old'),
          respond: () => new Response('unauthorised', { status: 401 }),
        },
        {
          test: (url) => url.endsWith('tok-fresh'),
          respond: () => jsonResponse({ ok: true }),
        },
      ]);
      const reissue = async () => 'tok-fresh';
      const result = await fetchAflApiCfsResource(
        fetchImpl,
        (token) => { seen.push(token); return { url: `https://example.test/${token}`, method: 'GET', headers: {} }; },
        'tok-old', reissue, { sleep: noSleep },
      );
      expect(result.tokenReissued).toBe(true);
      expect(seen).toEqual(['tok-old', 'tok-fresh']);
    });

    it('propagates the reissue callback\'s refusal on a second 401 in the same run', async () => {
      const { fetchImpl } = stubFetch([{ test: () => true, respond: () => new Response('unauthorised', { status: 401 }) }]);
      const reissue = async () => { throw new Error('already reissued this run'); };
      await expect(fetchAflApiCfsResource(
        fetchImpl, (token) => ({ url: `https://example.test/${token}`, method: 'GET', headers: {} }),
        'tok-old', reissue, { sleep: noSleep },
      )).rejects.toThrow('already reissued this run');
    });
  });
});

describe('acquire-afl-api CLI (AFLDB-ISSUE-228 §7.1, §5.4)', () => {
  describe('parseAcquireArgs', () => {
    it('requires --season', () => {
      expect(() => parseAcquireArgs([])).toThrow(/--season/);
    });

    it('parses season/status/since/repeated --match', () => {
      expect(parseAcquireArgs([
        '--season', '2026', '--status', 'CONCLUDED', '--since', '2026-08-01',
        '--match', 'CD_M1', '--match', 'CD_M2',
      ])).toEqual({
        season: 2026, status: 'CONCLUDED', since: '2026-08-01', match: ['CD_M1', 'CD_M2'], fixturesOnly: false,
      });
    });

    it('refuses an unknown flag', () => {
      expect(() => parseAcquireArgs(['--season', '2026', '--bogus', 'x'])).toThrow(/Unknown flag/);
    });

    it('refuses a malformed --since', () => {
      expect(() => parseAcquireArgs(['--season', '2026', '--since', '1-Aug-2026'])).toThrow(/--since/);
    });

    it('parses --fixtures-only as a boolean switch, taking no value', () => {
      expect(parseAcquireArgs(['--season', '2026', '--fixtures-only'])).toEqual({
        season: 2026, status: null, since: null, match: [], fixturesOnly: true,
      });
    });
  });

  describe('buildAflApiLabel', () => {
    it('renders afl-api-<season>-<YYYY-MM-DD-HHMMSS> in UTC', () => {
      const now = new Date('2026-09-19T14:30:00Z');
      expect(buildAflApiLabel(2026, now)).toBe('afl-api-2026-2026-09-19-143000');
    });

    it('two calls one second apart render distinct labels (AFLDB-ISSUE-228 collision fix)', () => {
      expect(buildAflApiLabel(2026, new Date('2026-09-19T14:30:00Z')))
        .not.toBe(buildAflApiLabel(2026, new Date('2026-09-19T14:30:01Z')));
    });
  });

  describe('runAcquisition — manifest-last (§5.4, §7.1 step 4)', () => {
    const scratch: string[] = [];
    afterEach(() => {
      for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    function makeProjectRoot(): string {
      const root = mkdtempSync(join(tmpdir(), 'afldb-issue-228-acquire-'));
      scratch.push(root);
      mkdirSync(join(root, 'data', 'reference'), { recursive: true });
      writeFileSync(
        join(root, 'data', 'reference', 'afl-api-identities.json'),
        JSON.stringify({ seasons: { 2026: { compSeasonId: 85, providerId: 'CD_S2026014' } } }),
      );
      return root;
    }

    const seasonFeed = {
      matches: [
        { providerId: 'CD_M1', status: 'CONCLUDED', utcStartTime: '2026-03-05T04:40:00Z', home: { team: { providerId: 'CD_T10' } } },
        { providerId: 'CD_M2', status: 'POSTGAME', utcStartTime: '2026-09-19T05:00:00Z' },
      ],
    };

    function happyPathHandlers(tokenValue = 'tok-1') {
      return [
        { test: (u: string) => u.endsWith('/afl/WMCTok'), respond: () => jsonResponse({ token: tokenValue }) },
        { test: (u: string) => u.includes('/afl/v2/matches'), respond: () => jsonResponse(seasonFeed, { headers: { etag: '"season"' } }) },
        { test: (u: string) => u.includes('/playerStats/match/CD_M1'), respond: () => jsonResponse({ homeTeamPlayerStats: [] }) },
        { test: (u: string) => u.includes('/matchRoster/full/CD_M1'), respond: () => jsonResponse({ match: {} }) },
      ];
    }

    it('acquires the default CONCLUDED-only selection and writes manifest.json LAST', async () => {
      const projectRoot = makeProjectRoot();
      const { fetchImpl } = stubFetch(happyPathHandlers());
      const now = new Date('2026-09-19T14:30:00Z');

      const result = await runAcquisition(
        { season: 2026, status: null, since: null, match: [] },
        { fetchImpl, projectRoot, now, retryOpts: { sleep: noSleep }, ingestionControls: ENABLED_INGESTION_CONTROLS },
      );

      expect(result.label).toBe('afl-api-2026-2026-09-19-143000');
      expect(result.matchesInFeed).toBe(2);
      expect(result.matchesSelected).toBe(1); // POSTGAME excluded by the default status filter

      expect(existsSync(result.manifestPath)).toBe(true);
      const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8'));
      expect(manifest.source_key).toBe('afl_api');
      expect(manifest.acquisition_kind).toBe('afl_api_match_snapshot');
      expect(manifest.fixtures_only).toBe(false);
      expect(manifest.season).toBe(2026);
      expect(manifest.comp_season_id).toBe(85);
      expect(manifest.counts).toEqual({ matches_in_feed: 2, matches_selected: 1 });

      const filePaths = manifest.files.map((f: { file: string }) => f.file);
      expect(filePaths).toEqual([
        '00-season-matches.json', 'CD_M1/fixture.json', 'CD_M1/player-stats.json', 'CD_M1/match-roster.json',
      ]);

      // Every declared SHA-256 must match the bytes actually on disk.
      for (const entry of manifest.files as { file: string; sha256: string }[]) {
        const bytes = readFileSync(join(result.snapshotDir, entry.file), 'utf8');
        expect(createHash('sha256').update(Buffer.from(bytes, 'utf8')).digest('hex')).toBe(entry.sha256);
      }

      // Raw HTTP metadata is captured for a real fetch, absent for the derived fixture.json.
      const seasonEntry = manifest.files.find((f: { file: string }) => f.file === '00-season-matches.json');
      expect(seasonEntry.http_status).toBe(200);
      expect(seasonEntry.etag).toBe('"season"');
      const fixtureEntry = manifest.files.find((f: { file: string }) => f.file === 'CD_M1/fixture.json');
      expect(fixtureEntry.derived_from).toBe('00-season-matches.json');
      expect(fixtureEntry.http_status).toBeUndefined();

      // The token itself is never written anywhere in the snapshot.
      const tokenMeta = JSON.parse(readFileSync(join(result.snapshotDir, 'token.meta.json'), 'utf8'));
      expect(tokenMeta).toEqual({ issued_at: expect.any(String), reissued: false });
      expect(JSON.stringify(tokenMeta)).not.toContain('tok-1');
      for (const entry of manifest.files) expect(JSON.stringify(entry)).not.toContain('tok-1');
    });

    it('AFLDB-ISSUE-228 follow-up: refuses before any network request when the super-admin switch is disabled', async () => {
      const projectRoot = makeProjectRoot();
      const { fetchImpl, calls } = stubFetch(happyPathHandlers());

      await expect(runAcquisition(
        { season: 2026, status: null, since: null, match: [] },
        {
          fetchImpl, projectRoot, retryOpts: { sleep: noSleep },
          ingestionControls: { currentSeasonEnabled: false, brownlowAdminEnabled: false },
        },
      )).rejects.toThrow(/current-season ingestion is disabled/);

      expect(calls).toHaveLength(0);
    });

    it('an explicit --match selects regardless of status', async () => {
      const projectRoot = makeProjectRoot();
      const handlers = [
        ...happyPathHandlers(),
        { test: (u: string) => u.includes('/playerStats/match/CD_M2'), respond: () => jsonResponse({ homeTeamPlayerStats: [] }) },
        { test: (u: string) => u.includes('/matchRoster/full/CD_M2'), respond: () => jsonResponse({ match: {} }) },
      ];
      const { fetchImpl } = stubFetch(handlers);
      const result = await runAcquisition(
        { season: 2026, status: null, since: null, match: ['CD_M2'] },
        { fetchImpl, projectRoot, now: new Date('2026-09-19T14:30:00Z'), retryOpts: { sleep: noSleep }, ingestionControls: ENABLED_INGESTION_CONTROLS },
      );
      expect(result.matchesSelected).toBe(1);
      const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8'));
      expect(manifest.selection).toEqual({ status: null, since: null, match: ['CD_M2'] });
      expect(manifest.files.map((f: { file: string }) => f.file)).toContain('CD_M2/player-stats.json');
    });

    it('refuses a season with no declared compSeasonId', async () => {
      const projectRoot = makeProjectRoot();
      const { fetchImpl } = stubFetch(happyPathHandlers());
      await expect(runAcquisition(
        { season: 2099, status: null, since: null, match: [] },
        { fetchImpl, projectRoot, retryOpts: { sleep: noSleep }, ingestionControls: ENABLED_INGESTION_CONTROLS },
      )).rejects.toThrow(/compSeasonId/);
    });

    it('a persistent per-match failure leaves NO manifest.json — proving the fail-closed contract', async () => {
      const projectRoot = makeProjectRoot();
      const handlers = [
        { test: (u: string) => u.endsWith('/afl/WMCTok'), respond: () => jsonResponse({ token: 'tok-1' }) },
        { test: (u: string) => u.includes('/afl/v2/matches'), respond: () => jsonResponse(seasonFeed) },
        { test: (u: string) => u.includes('/playerStats/match/CD_M1'), respond: () => jsonResponse({ homeTeamPlayerStats: [] }) },
        { test: (u: string) => u.includes('/matchRoster/full/CD_M1'), respond: () => new Response('server error', { status: 500 }) },
      ];
      const { fetchImpl } = stubFetch(handlers);
      const now = new Date('2026-09-19T14:30:00Z');
      const snapshotDir = join(projectRoot, 'data', 'sources', 'afl_api', 'matches', buildAflApiLabel(2026, now));

      await expect(runAcquisition(
        { season: 2026, status: null, since: null, match: [] },
        { fetchImpl, projectRoot, now, retryOpts: { sleep: noSleep }, ingestionControls: ENABLED_INGESTION_CONTROLS },
      )).rejects.toBeInstanceOf(AflApiRequestError);

      // Earlier files landed; the manifest — the sole "this acquisition finished" signal — did not.
      expect(existsSync(join(snapshotDir, '00-season-matches.json'))).toBe(true);
      expect(existsSync(join(snapshotDir, 'CD_M1', 'player-stats.json'))).toBe(true);
      expect(existsSync(join(snapshotDir, 'manifest.json'))).toBe(false);

      cleanupPartialSnapshot(snapshotDir, () => {});
      expect(existsSync(snapshotDir)).toBe(false);
    });

    it('cleanupPartialSnapshot leaves a COMPLETE snapshot (manifest present) untouched', async () => {
      const projectRoot = makeProjectRoot();
      const { fetchImpl } = stubFetch(happyPathHandlers());
      const now = new Date('2026-09-19T14:30:00Z');
      const result = await runAcquisition(
        { season: 2026, status: null, since: null, match: [] },
        { fetchImpl, projectRoot, now, retryOpts: { sleep: noSleep }, ingestionControls: ENABLED_INGESTION_CONTROLS },
      );
      cleanupPartialSnapshot(result.snapshotDir, () => {});
      expect(existsSync(result.manifestPath)).toBe(true);
    });

    describe('snapshot collision safety (AFLDB-ISSUE-228 S7 follow-up)', () => {
      it('two acquisitions at the identical mocked wall-clock second obtain distinct labels/paths and neither overwrites the other', async () => {
        const projectRoot = makeProjectRoot();
        const now = new Date('2026-09-19T14:30:00Z');

        const { fetchImpl: fetchImpl1 } = stubFetch(happyPathHandlers('tok-1'));
        const result1 = await runAcquisition(
          { season: 2026, status: null, since: null, match: [] },
          { fetchImpl: fetchImpl1, projectRoot, now, retryOpts: { sleep: noSleep }, ingestionControls: ENABLED_INGESTION_CONTROLS },
        );

        const { fetchImpl: fetchImpl2 } = stubFetch(happyPathHandlers('tok-2'));
        const result2 = await runAcquisition(
          { season: 2026, status: null, since: null, match: [] },
          { fetchImpl: fetchImpl2, projectRoot, now, retryOpts: { sleep: noSleep }, ingestionControls: ENABLED_INGESTION_CONTROLS },
        );

        expect(result1.label).not.toBe(result2.label);
        expect(result2.label).toBe(`${result1.label}-2`);
        expect(result1.snapshotDir).not.toBe(result2.snapshotDir);
        expect(existsSync(result1.manifestPath)).toBe(true);
        expect(existsSync(result2.manifestPath)).toBe(true);

        for (const [result, tokenValue] of [[result1, 'tok-1'], [result2, 'tok-2']] as const) {
          const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8'));
          expect(manifest.label).toBe(result.label);
          for (const entry of manifest.files as { file: string; sha256: string }[]) {
            const bytes = readFileSync(join(result.snapshotDir, entry.file), 'utf8');
            expect(createHash('sha256').update(Buffer.from(bytes, 'utf8')).digest('hex')).toBe(entry.sha256);
          }
          const tokenMeta = JSON.parse(readFileSync(join(result.snapshotDir, 'token.meta.json'), 'utf8'));
          expect(JSON.stringify(tokenMeta)).not.toContain(tokenValue);
        }
      });

      it('a pre-existing directory at the generated label is never written into or overwritten', async () => {
        const projectRoot = makeProjectRoot();
        const now = new Date('2026-09-19T14:30:00Z');
        const baseLabel = buildAflApiLabel(2026, now);
        const staleDir = join(projectRoot, 'data', 'sources', 'afl_api', 'matches', baseLabel);
        mkdirSync(staleDir, { recursive: true });
        writeFileSync(join(staleDir, 'sentinel.txt'), 'pre-existing evidence — must not be touched');

        const { fetchImpl } = stubFetch(happyPathHandlers());
        const result = await runAcquisition(
          { season: 2026, status: null, since: null, match: [] },
          { fetchImpl, projectRoot, now, retryOpts: { sleep: noSleep }, ingestionControls: ENABLED_INGESTION_CONTROLS },
        );

        expect(result.label).not.toBe(baseLabel);
        expect(result.snapshotDir).not.toBe(staleDir);
        expect(readFileSync(join(staleDir, 'sentinel.txt'), 'utf8')).toBe('pre-existing evidence — must not be touched');
        expect(existsSync(join(staleDir, 'manifest.json'))).toBe(false);
      });

      it('--fixtures-only acquisitions share the same collision-safe claim (E: shared fixture path)', async () => {
        const projectRoot = makeProjectRoot();
        const now = new Date('2026-09-19T14:30:00Z');
        const handlers = [
          { test: (u: string) => u.includes('/afl/v2/matches'), respond: () => jsonResponse(seasonFeed, { headers: { etag: '"season"' } }) },
        ];

        const { fetchImpl: fetchImpl1 } = stubFetch(handlers);
        const result1 = await runAcquisition(
          { season: 2026, status: null, since: null, match: [], fixturesOnly: true },
          { fetchImpl: fetchImpl1, projectRoot, now, retryOpts: { sleep: noSleep }, ingestionControls: ENABLED_INGESTION_CONTROLS },
        );

        const { fetchImpl: fetchImpl2 } = stubFetch(handlers);
        const result2 = await runAcquisition(
          { season: 2026, status: null, since: null, match: [], fixturesOnly: true },
          { fetchImpl: fetchImpl2, projectRoot, now, retryOpts: { sleep: noSleep }, ingestionControls: ENABLED_INGESTION_CONTROLS },
        );

        expect(result1.label).not.toBe(result2.label);
        expect(result2.label).toBe(`${result1.label}-2`);
        expect(result1.snapshotDir).toContain(join('afl_api', 'fixtures'));
        expect(existsSync(result1.manifestPath)).toBe(true);
        expect(existsSync(result2.manifestPath)).toBe(true);
      });
    });

    describe('--fixtures-only (AFLDB-ISSUE-228 S7 follow-up, fixture-only Brownlow identity prerequisite)', () => {
      // Deliberately NO handler for WMCTok/playerStats/matchRoster — `stubFetch`
      // throws "no handler for <url>" if --fixtures-only ever requests one of
      // them, which is exactly assertions 1 and 2 the operator's brief asks for.
      function fixturesOnlyHandlers() {
        return [
          { test: (u: string) => u.includes('/afl/v2/matches'), respond: () => jsonResponse(seasonFeed, { headers: { etag: '"season"' } }) },
        ];
      }

      it('AFLDB-ISSUE-232 O1: the Brownlow wrapper\'s label parse recovers the exact --fixtures-only label, suffix included', async () => {
        // The wrapper hands this label to settle-afl-api-fixtures.ts, which
        // looks it up under data/sources/afl_api/fixtures/. Prove the handoff
        // with the wrapper's OWN sed expression against this tool's OWN first
        // log line, for a base label and a collision-suffixed one.
        const wrapper = readFileSync(
          join(__dirname, '..', 'deploy', 'afldb-settle-afl-api-brownlow.sh'), 'utf8',
        ).replace(/\r\n/g, '\n');
        const sedLine = wrapper.split('\n').find((line) => line.startsWith('fixtures_label=$('));
        expect(sedLine).toBeDefined();
        const sedExpr = /sed -n 's\/(.*?)\/\\1\/p'/.exec(sedLine ?? '')?.[1];
        expect(sedExpr).toBe('.*, label \\([A-Za-z0-9_-]*\\).*');
        // POSIX BRE -> JS: only the group parentheses are escaped in the BRE.
        const parse = new RegExp(`^${(sedExpr ?? '').replace(/\\\(/g, '(').replace(/\\\)/g, ')')}$`);

        const projectRoot = makeProjectRoot();
        const now = new Date('2026-09-19T14:30:00Z');
        for (const expectedSuffix of ['', '-2']) {
          const lines: string[] = [];
          const { fetchImpl } = stubFetch(fixturesOnlyHandlers());
          const result = await runAcquisition(
            { season: 2026, status: null, since: null, match: [], fixturesOnly: true },
            {
              fetchImpl, projectRoot, now, retryOpts: { sleep: noSleep },
              ingestionControls: ENABLED_INGESTION_CONTROLS, log: (line) => lines.push(line),
            },
          );
          expect(result.label.endsWith(`2026-09-19-143000${expectedSuffix}`)).toBe(true);
          // `| head -n1` of the matching lines.
          const parsed = lines.map((line) => parse.exec(line)?.[1]).find((value) => value !== undefined);
          expect(parsed).toBe(result.label);
          expect(result.snapshotDir).toBe(join(projectRoot, 'data', 'sources', 'afl_api', 'fixtures', parsed ?? ''));
        }
      });

      it('requests ONLY the season matches feed — no WMCTok, no playerStats, no matchRoster', async () => {
        const projectRoot = makeProjectRoot();
        const { fetchImpl, calls } = stubFetch(fixturesOnlyHandlers());
        const now = new Date('2026-09-19T14:30:00Z');

        const result = await runAcquisition(
          { season: 2026, status: null, since: null, match: [], fixturesOnly: true },
          { fetchImpl, projectRoot, now, retryOpts: { sleep: noSleep }, ingestionControls: ENABLED_INGESTION_CONTROLS },
        );

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toContain('/afl/v2/matches');
        expect(result.matchesSelected).toBe(1); // POSTGAME excluded by the default status filter

        // Written under a SEPARATE tree from a full acquisition (never
        // data/sources/afl_api/matches/), so the full settle CLI's own
        // --label lookup can never find a fixtures-only snapshot by accident.
        expect(result.snapshotDir).toContain(join('afl_api', 'fixtures'));
        expect(result.snapshotDir).not.toContain(join('afl_api', 'matches'));

        const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8'));
        expect(manifest.source_key).toBe('afl_api');
        expect(manifest.acquisition_kind).toBe('afl_api_fixture_snapshot');
        expect(manifest.fixtures_only).toBe(true);
        expect(manifest.files.map((f: { file: string }) => f.file)).toEqual([
          '00-season-matches.json', 'CD_M1/fixture.json',
        ]);
        // No CFS token was ever fetched, so nothing is written for it.
        expect(existsSync(join(result.snapshotDir, 'token.meta.json'))).toBe(false);
      });

      it('an explicit --match still fetches ONLY the fixture, even for a non-CONCLUDED match', async () => {
        const projectRoot = makeProjectRoot();
        const { fetchImpl, calls } = stubFetch(fixturesOnlyHandlers());
        const result = await runAcquisition(
          { season: 2026, status: null, since: null, match: ['CD_M2'], fixturesOnly: true },
          { fetchImpl, projectRoot, now: new Date('2026-09-19T14:30:00Z'), retryOpts: { sleep: noSleep }, ingestionControls: ENABLED_INGESTION_CONTROLS },
        );
        expect(calls).toHaveLength(1);
        expect(result.matchesSelected).toBe(1);
        const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8'));
        expect(manifest.files.map((f: { file: string }) => f.file)).toEqual([
          '00-season-matches.json', 'CD_M2/fixture.json',
        ]);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// AFLDB-ISSUE-228 S3 (§9, §11) — afl-api-bundle.ts. DB-free: uses the real
// tracked registry/identities plus small hand-trimmed fixtures under
// tests/fixtures/afl_api/ (one match, one Brownlow round), never the large
// captured samples — those are the CLI backtest's job
// (tools/current-season/emit-afl-api-bundle.ts).
// ---------------------------------------------------------------------------

describe('afl-api-bundle (AFLDB-ISSUE-228 S3)', () => {
  const projectRoot = join(__dirname, '..');
  const registry = parseSourceFamilyRegistry(
    JSON.parse(readFileSync(join(projectRoot, 'data', 'reference', 'source-families.json'), 'utf8')),
  );
  const identities = parseAflApiIdentities(
    JSON.parse(readFileSync(join(projectRoot, 'data', 'reference', 'afl-api-identities.json'), 'utf8')),
  );
  const fixturesDir = join(projectRoot, 'tests', 'fixtures', 'afl_api');
  const readFixture = (relPath: string): any => JSON.parse(readFileSync(join(fixturesDir, relPath), 'utf8'));

  describe('flattenObservedColumns / canonicalStringify / semanticHash', () => {
    it('flattens nested objects and arrays to dot-path leaves, arrays transparent (no index)', () => {
      expect(flattenObservedColumns({ a: { b: 1, c: [{ d: 2 }, { d: 3 }] }, e: null })).toEqual(['a.b', 'a.c.d', 'e']);
    });

    it('an empty array or object contributes no path at all', () => {
      expect(flattenObservedColumns({ a: [], b: {} })).toEqual([]);
    });

    it('canonicalStringify is stable regardless of source key order', () => {
      expect(canonicalStringify({ b: 1, a: { z: 1, y: 2 } })).toBe(canonicalStringify({ a: { y: 2, z: 1 }, b: 1 }));
    });

    it('semanticHash is deterministic and hash_exclusions removes only the named path', () => {
      const a = { keep: 1, noisy: 'x' };
      const b = { keep: 1, noisy: 'y' };
      expect(semanticHash(a, ['noisy'])).toBe(semanticHash(b, ['noisy']));
      expect(semanticHash(a)).not.toBe(semanticHash(b));
      expect(semanticHash(a)).toBe(semanticHash(a));
    });
  });

  describe('emitAflApiMatch (§11.1)', () => {
    it('projects the fixture-result sample into a typed match record', () => {
      const { record } = emitAflApiMatch(readFixture('match/01-fixture-result.json'), registry, identities);
      expect(record.sourceRecordId).toBe('CD_M20260142801');
      expect(record.season).toBe(2026);
      expect(record.roundCode).toBe('PF');
      expect(record.roundType).toBe('preliminary_final');
      expect(record.isFinal).toBe(true);
      expect(record.roundNumber).toBeNull();
      expect(record.homeClubHist).toBe('Hawthorn');
      expect(record.awayClubHist).toBe('Brisbane Lions');
      expect(record.venueLegacyName).toBe('M.C.G.');
      expect(record.homeScore).toBe(122);
      expect(record.awayScore).toBe(131);
      expect(record.result).toBe('away_win');
      expect(record.margin).toBe(9);
    });

    it('exposes the fixture venue.timezone as the provider IANA string (S6-D3a, §11.1)', () => {
      const { record } = emitAflApiMatch(readFixture('match/01-fixture-result.json'), registry, identities);
      expect(record.venueTimezone).toBe('Australia/Melbourne');
    });

    it('venueTimezone is null when the fixture carries no venue.timezone (known-but-not-required)', () => {
      const raw = readFixture('match/01-fixture-result.json');
      delete raw.venue.timezone;
      const { record } = emitAflApiMatch(raw, registry, identities);
      expect(record.venueTimezone).toBeNull();
    });

    it('an unmapped venue is a warning (null legacy name), never a HALT', () => {
      const raw = readFixture('match/01-fixture-result.json');
      raw.venue.providerId = 'CD_V999999';
      const { record } = emitAflApiMatch(raw, registry, identities);
      expect(record.venueProviderId).toBe('CD_V999999');
      expect(record.venueLegacyName).toBeNull();
    });

    it('refuses an unmapped team provider id (§6.2 BINDING)', () => {
      const raw = readFixture('match/01-fixture-result.json');
      raw.home.team.providerId = 'CD_T999999';
      expect(() => emitAflApiMatch(raw, registry, identities)).toThrow(/unmapped_team|Team provider id/);
    });

    it('refuses an undeclared column — registry drift is fail-closed', () => {
      const raw = readFixture('match/01-fixture-result.json');
      raw.somethingNew = 'unexpected';
      expect(() => emitAflApiMatch(raw, registry, identities)).toThrow(/undeclared column/);
    });

    describe('metadata.prematch_label / metadata.sold_out (AFLDB-ISSUE-228 S7 follow-up, 2026-09-20 — measured on the full real 2025 season feed, 11/216 and 2/216 records respectively)', () => {
      it('accepts a payload carrying metadata.prematch_label', () => {
        const raw = readFixture('match/01-fixture-result.json');
        raw.metadata = { ...raw.metadata, prematch_label: 'Rescheduled Match' };
        expect(() => emitAflApiMatch(raw, registry, identities)).not.toThrow();
      });

      it('accepts an empty-string metadata.prematch_label (measured on 2025 R17)', () => {
        const raw = readFixture('match/01-fixture-result.json');
        raw.metadata = { ...raw.metadata, prematch_label: '' };
        expect(() => emitAflApiMatch(raw, registry, identities)).not.toThrow();
      });

      it('accepts a payload carrying metadata.sold_out as the measured STRING "true" (never a JSON boolean)', () => {
        const raw = readFixture('match/01-fixture-result.json');
        raw.metadata = { ...raw.metadata, prematch_label: 'Semi Final 1', sold_out: 'true' };
        expect(() => emitAflApiMatch(raw, registry, identities)).not.toThrow();
      });

      it('absence of both fields remains valid (the tracked sample carries neither)', () => {
        const raw = readFixture('match/01-fixture-result.json');
        expect(raw.metadata.prematch_label).toBeUndefined();
        expect(raw.metadata.sold_out).toBeUndefined();
        expect(() => emitAflApiMatch(raw, registry, identities)).not.toThrow();
      });

      it('an actually undeclared metadata field still fails closed — this is not a global suppression', () => {
        const raw = readFixture('match/01-fixture-result.json');
        raw.metadata = { ...raw.metadata, totally_undeclared_field: 'x' };
        expect(() => emitAflApiMatch(raw, registry, identities)).toThrow(/undeclared column/);
      });

      it('neither field becomes part of the match projection — informational metadata only, never a canonical proposal', () => {
        const raw = readFixture('match/01-fixture-result.json');
        raw.metadata = { ...raw.metadata, prematch_label: 'Semi Final 1', sold_out: 'true' };
        const { record } = emitAflApiMatch(raw, registry, identities);
        expect(JSON.stringify(record)).not.toMatch(/prematch|sold_out|soldOut/i);
      });
    });

    it('refuses a season with no declared afl-api-identities.json entry', () => {
      const raw = readFixture('match/01-fixture-result.json');
      raw.compSeason.providerId = 'CD_S1999014';
      expect(() => emitAflApiMatch(raw, registry, identities)).toThrow(/unknown_season|not declared/);
    });
  });

  describe('buildAflApiFixtureRecords (AFLDB-ISSUE-228 S7 follow-up, fixture-only Brownlow identity prerequisite)', () => {
    it('represents a whole season fixture population DB-free — no match_roster/player_match_stats needed', () => {
      const a = readFixture('match/01-fixture-result.json');
      const b = { ...readFixture('match/01-fixture-result.json'), providerId: 'CD_M20260142802' };
      const { records, buildFailures } = buildAflApiFixtureRecords([a, b], registry, identities);
      expect(buildFailures).toEqual([]);
      expect(records.map((r) => r.providerMatchId)).toEqual(['CD_M20260142801', 'CD_M20260142802']);
      expect(records[0].payload).toBe(a); // the raw fixture object, never a roster/stats payload
      expect(records[0].projection.homeClubHist).toBe('Hawthorn');
    });

    it('isolates one bad record — a build failure never drops every other record', () => {
      const good = readFixture('match/01-fixture-result.json');
      const bad = readFixture('match/01-fixture-result.json') as Record<string, unknown>;
      delete (bad as { status?: unknown }).status;
      const { records, buildFailures } = buildAflApiFixtureRecords([good, bad], registry, identities);
      expect(records).toHaveLength(1);
      expect(records[0].providerMatchId).toBe('CD_M20260142801');
      expect(buildFailures).toHaveLength(1);
      expect(buildFailures[0].providerMatchId).toBe('CD_M20260142801'); // providerId is set, only `status` is missing
      expect(buildFailures[0].error).toMatch(/status/);
    });
  });

  describe('emitAflApiPlayerMatchStats (§11.3) — identity at two paths, never the position-bearing one', () => {
    it('projects both sides, reading playerStats.player.playerJumperNumber (never the position-bearing copy)', () => {
      const raw = readFixture('match/02-player-stats.raw.json');
      const { records } = emitAflApiPlayerMatchStats(raw, registry, 'CD_M20260142801');
      expect(records).toHaveLength(2);
      const home = records.find((r) => r.providerTeamId === 'CD_T80')!;
      expect(home.providerPlayerId).toBe('CD_I297354');
      expect(home.providerMatchId).toBe('CD_M20260142801');
      expect(home.jumperNumber).toBe(10);
      expect(home.kicks).toBe(9);
      expect(home.disposals).toBe(11);
      expect(home.clearances).toBe(0);
      expect((home as unknown as { position?: unknown }).position).toBeUndefined();
    });

    it('refuses a duplicate player within the same match', () => {
      const raw = readFixture('match/02-player-stats.raw.json');
      raw.awayTeamPlayerStats.push(raw.awayTeamPlayerStats[0]);
      expect(() => emitAflApiPlayerMatchStats(raw, registry, 'CD_M20260142801')).toThrow(/duplicate/i);
    });

    it('accepts a JSON float count that is integral (measured `9.0` shape)', () => {
      const raw = readFixture('match/02-player-stats.raw.json');
      raw.homeTeamPlayerStats[0].playerStats.stats.kicks = 9.0;
      const { records } = emitAflApiPlayerMatchStats(raw, registry, 'CD_M20260142801');
      expect(records.find((r) => r.providerTeamId === 'CD_T80')!.kicks).toBe(9);
    });

    it('refuses a non-integral count (§4.4)', () => {
      const raw = readFixture('match/02-player-stats.raw.json');
      raw.homeTeamPlayerStats[0].playerStats.stats.kicks = 9.5;
      expect(() => emitAflApiPlayerMatchStats(raw, registry, 'CD_M20260142801')).toThrow(/non_integral_statistic|integral count/);
    });

    describe('extendedStats: null (S9, §11.3 evidence — the nullable parent is known-but-not-required)', () => {
      it('accepts a null extendedStats parent (measured CD_M20260140305/CD_I993799 shape) and projects the row unaffected', () => {
        const raw = readFixture('match/02-player-stats.raw.json');
        raw.homeTeamPlayerStats[0].playerStats.stats.extendedStats = null;
        const { records, observedColumns } = emitAflApiPlayerMatchStats(raw, registry, 'CD_M20260142801');
        expect(records).toHaveLength(2);
        const home = records.find((r) => r.providerTeamId === 'CD_T80')!;
        // Ordinary projected canonical stats remain correct — the null extendedStats parent affects nothing else.
        expect(home.providerPlayerId).toBe('CD_I297354');
        expect(home.kicks).toBe(9);
        expect(home.disposals).toBe(11);
        expect(home.clearances).toBe(0);
        // extendedStats is never projected into AflApiPlayerMatchStatsProjection, null or object-shaped alike.
        expect((home as unknown as { extendedStats?: unknown }).extendedStats).toBeUndefined();
        expect(observedColumns).toContain('playerStats.stats.extendedStats');
      });

      it('flattenObservedColumns() reports the bare parent path for a null extendedStats object', () => {
        expect(flattenObservedColumns({ stats: { extendedStats: null } })).toEqual(['stats.extendedStats']);
      });

      it('keeps the existing object-shaped extendedStats fixture coverage intact (away side, unmutated)', () => {
        const raw = readFixture('match/02-player-stats.raw.json');
        raw.homeTeamPlayerStats[0].playerStats.stats.extendedStats = null;
        const { records, observedColumns } = emitAflApiPlayerMatchStats(raw, registry, 'CD_M20260142801');
        const away = records.find((r) => r.providerTeamId === 'CD_T20')!;
        expect(away.providerPlayerId).toBe('CD_I500001');
        expect(away.goals).toBe(3);
        expect(observedColumns).toContain('playerStats.stats.extendedStats.effectiveKicks');
      });

      it('still fails closed on a genuinely undeclared sibling path alongside a null extendedStats parent', () => {
        const raw = readFixture('match/02-player-stats.raw.json');
        raw.homeTeamPlayerStats[0].playerStats.stats.extendedStats = null;
        raw.homeTeamPlayerStats[0].playerStats.stats.somethingNew = 1.0;
        expect(() => emitAflApiPlayerMatchStats(raw, registry, 'CD_M20260142801'))
          .toThrow(/undeclared column\(s\).*somethingNew/);
      });
    });
  });

  describe('emitAflApiMatchRoster (§11.2) — narrowed observation + own-match score selection', () => {
    it('selects the recentMatchScores entry matching the requested match, never entry 0 blindly', () => {
      const raw = readFixture('match/03-match-roster.raw.json');
      const { record } = emitAflApiMatchRoster(raw, registry, 'CD_M20260142801');
      expect(record.providerMatchId).toBe('CD_M20260142801');
      expect(record.homeTeamProviderId).toBe('CD_T80');
      expect(record.homePositions).toEqual([
        { providerPlayerId: 'CD_I297354', playerJumperNumber: 10, position: 'HBFL' },
      ]);
      expect(record.periodScores).not.toBeNull();
      expect(record.periodScores!.home.map((p) => p.cumulativeTotalScore)).toEqual([31, 67, 77, 122]);
      expect(record.periodScores!.away.map((p) => p.cumulativeTotalScore)).toEqual([25, 55, 95, 131]);
      // The final cumulative period equals the match family's own final score (assertion 4).
      expect(record.periodScores!.home.at(-1)!.cumulativeTotalScore).toBe(122);
      expect(record.periodScores!.away.at(-1)!.cumulativeTotalScore).toBe(131);
    });

    it('periodScores is null (never fabricated) when the match is absent from recentMatchScores', () => {
      const raw = readFixture('match/03-match-roster.raw.json');
      raw.recentMatchScores = raw.recentMatchScores.filter((e: { matchId: string }) => e.matchId !== 'CD_M20260142801');
      const { record } = emitAflApiMatchRoster(raw, registry, 'CD_M20260142801');
      expect(record.periodScores).toBeNull();
    });

    it('refuses a non-integral playerJumperNumber (§4.4, shared numOrNull)', () => {
      const raw = readFixture('match/03-match-roster.raw.json');
      raw.matchRoster.homeTeam.positions[0].player.playerJumperNumber = 10.5;
      expect(() => emitAflApiMatchRoster(raw, registry, 'CD_M20260142801')).toThrow(/non_integral_statistic|integral count/);
    });

    describe('venueLocalStartTime (S6-D3a, §11.1 evidence — known-but-not-required)', () => {
      it('retains raw.match.venueLocalStartTime exactly as published and participates in the observation', () => {
        const raw = readFixture('match/03-match-roster.raw.json');
        raw.match = { ...raw.match, venueLocalStartTime: '2026-09-19T17:15:00' };
        const { record, observation, observedColumns } = emitAflApiMatchRoster(raw, registry, 'CD_M20260142801');
        expect(record.venueLocalStartTime).toBe('2026-09-19T17:15:00');
        expect(observedColumns).toContain('match.venueLocalStartTime');
        expect((observation as { match?: { venueLocalStartTime?: string } }).match?.venueLocalStartTime)
          .toBe('2026-09-19T17:15:00');
      });

      it('the existing trimmed fixture (no venueLocalStartTime) remains valid and exposes null, never falls back', () => {
        const raw = readFixture('match/03-match-roster.raw.json');
        const { record, observedColumns } = emitAflApiMatchRoster(raw, registry, 'CD_M20260142801');
        expect(record.venueLocalStartTime).toBeNull();
        expect(observedColumns).not.toContain('match.venueLocalStartTime');
      });
    });
  });

  describe('buildAflApiMatchBundle — bundling step + assertion 4 (cumulative conversion reproduces final score)', () => {
    it('combines match + roster + player_match_stats for one match', () => {
      const bundle = buildAflApiMatchBundle(
        readFixture('match/01-fixture-result.json'),
        readFixture('match/03-match-roster.raw.json'),
        readFixture('match/02-player-stats.raw.json'),
        registry, identities,
      );
      expect(bundle.match.sourceRecordId).toBe('CD_M20260142801');
      expect(bundle.roster.providerMatchId).toBe('CD_M20260142801');
      expect(bundle.playerStats).toHaveLength(2);
      expect(bundle.periodScoresReproduceFinalScore).toBe(true);
      expect(bundle.matchDeferral).toBeNull();
      expect(bundle.rosterDeferral).toBeNull();
    });

    it('reports periodScoresReproduceFinalScore as null (skipped, not failed) with no own-match score entry', () => {
      const roster = readFixture('match/03-match-roster.raw.json');
      roster.recentMatchScores = roster.recentMatchScores.filter((e: { matchId: string }) => e.matchId !== 'CD_M20260142801');
      const bundle = buildAflApiMatchBundle(
        readFixture('match/01-fixture-result.json'), roster, readFixture('match/02-player-stats.raw.json'), registry, identities,
      );
      expect(bundle.periodScoresReproduceFinalScore).toBeNull();
    });

    it('§7.3 (T3): a POSTGAME fixture defers the whole unit — status_not_concluded, never a rejection', () => {
      const fixture = readFixture('match/01-fixture-result.json');
      fixture.status = 'POSTGAME';
      const bundle = buildAflApiMatchBundle(
        fixture,
        readFixture('match/03-match-roster.raw.json'),
        readFixture('match/02-player-stats.raw.json'),
        registry, identities,
      );
      expect(bundle.matchDeferral).toEqual({ reason: 'status_not_concluded', detail: 'POSTGAME' });
      expect(bundle.rosterDeferral).toBeNull();
      // Deferral names the fact; it does not blank out the typed projection —
      // that stays computed so a settle-time consumer can still validate it.
      expect(bundle.match.sourceRecordId).toBe('CD_M20260142801');
    });

    it('§7.3 (T3): a CONCLUDED fixture with a non-CONCLUDED roster defers only roster/stat families', () => {
      const roster = readFixture('match/03-match-roster.raw.json');
      roster.matchRoster.status = 'LIVE';
      const bundle = buildAflApiMatchBundle(
        readFixture('match/01-fixture-result.json'), roster, readFixture('match/02-player-stats.raw.json'),
        registry, identities,
      );
      expect(bundle.matchDeferral).toBeNull();
      expect(bundle.rosterDeferral).toEqual({ reason: 'roster_not_concluded', detail: 'LIVE' });
    });

    describe('§11.1 local match date/time derivation (S6-D3a) — roster venueLocalStartTime x fixture utcStartTime/venue.timezone', () => {
      function build(fixtureOverrides: (fixture: any) => void, rosterOverrides: (roster: any) => void) {
        const fixture = readFixture('match/01-fixture-result.json');
        fixtureOverrides(fixture);
        const roster = readFixture('match/03-match-roster.raw.json');
        rosterOverrides(roster);
        return buildAflApiMatchBundle(fixture, roster, readFixture('match/02-player-stats.raw.json'), registry, identities);
      }

      it('derives the expected local date and time when roster/UTC/timezone all agree (measured corpus values)', () => {
        const bundle = build(
          () => {}, // utcStartTime 2026-09-19T07:15:00.000+0000, venue.timezone Australia/Melbourne (fixture as-is)
          (roster) => { roster.match = { ...roster.match, venueLocalStartTime: '2026-09-19T17:15:00' }; },
        );
        expect(bundle.localMatchDateTime).toEqual({ matchDate: '2026-09-19', matchTime: '17:15' });
      });

      it('Q5-B: emits the canonical match_time as HH:MM — leading zero preserved, seconds omitted', () => {
        // 2026-09-19T21:05:00Z + Australia/Melbourne (AEST, UTC+10) = 2026-09-20T07:05:00 local.
        const padded = build(
          (fixture) => { fixture.utcStartTime = '2026-09-19T21:05:00.000+0000'; },
          (roster) => { roster.match = { ...roster.match, venueLocalStartTime: '2026-09-20T07:05:00' }; },
        );
        expect(padded.localMatchDateTime).toEqual({ matchDate: '2026-09-20', matchTime: '07:05' });
        expect(padded.localMatchDateTime?.matchTime).toMatch(/^\d{2}:\d{2}$/);

        // Agreement at NON-zero seconds still passes the second-precision check; the emitted value drops them.
        const withSeconds = build(
          (fixture) => { fixture.utcStartTime = '2026-09-19T07:15:30.000+0000'; },
          (roster) => { roster.match = { ...roster.match, venueLocalStartTime: '2026-09-19T17:15:30' }; },
        );
        expect(withSeconds.localMatchDateTime).toEqual({ matchDate: '2026-09-19', matchTime: '17:15' });
      });

      it('correctly derives across a UTC/local calendar-day boundary', () => {
        // 2026-09-19T14:30:00Z + Australia/Melbourne (AEST, UTC+10 in September, pre-DST) = 2026-09-20T00:30:00 local.
        const bundle = build(
          (fixture) => { fixture.utcStartTime = '2026-09-19T14:30:00.000+0000'; },
          (roster) => { roster.match = { ...roster.match, venueLocalStartTime: '2026-09-20T00:30:00' }; },
        );
        expect(bundle.localMatchDateTime).toEqual({ matchDate: '2026-09-20', matchTime: '00:30' });
      });

      it('fails closed on a contradiction between roster venueLocalStartTime and the UTC/timezone conversion', () => {
        expect(() => build(
          () => {},
          (roster) => { roster.match = { ...roster.match, venueLocalStartTime: '2026-09-19T18:00:00' }; }, // expected 17:15:00
        )).toThrow(/local_time_contradiction|disagrees/);
      });

      it('Q5-B: the contradiction check stays at SECOND precision — a difference that would render to the same HH:MM is still refused', () => {
        // UTC 07:15:00Z -> 17:15:00 local. 17:15:01 and 17:15:59 both render as `17:15`, yet neither agrees.
        for (const roster_time of ['2026-09-19T17:15:01', '2026-09-19T17:15:59']) {
          expect(() => build(
            () => {},
            (roster) => { roster.match = { ...roster.match, venueLocalStartTime: roster_time }; },
          )).toThrow(/local_time_contradiction|disagrees/);
        }
      });

      it('never falls back to the UTC calendar date when venueLocalStartTime is absent', () => {
        // The tracked fixture's `match` sibling carries no venueLocalStartTime.
        const bundle = build(() => {}, () => {});
        expect(bundle.localMatchDateTime).toBeNull();
      });

      it('stays unproved (null, not derived from UTC alone) when venue.timezone is absent', () => {
        const bundle = build(
          (fixture) => { delete fixture.venue.timezone; },
          (roster) => { roster.match = { ...roster.match, venueLocalStartTime: '2026-09-19T17:15:00' }; },
        );
        expect(bundle.localMatchDateTime).toBeNull();
      });

      it('stays unproved (null) when venue.timezone is not a recognised IANA zone', () => {
        const bundle = build(
          (fixture) => { fixture.venue.timezone = 'Not/AZone'; },
          (roster) => { roster.match = { ...roster.match, venueLocalStartTime: '2026-09-19T17:15:00' }; },
        );
        expect(bundle.localMatchDateTime).toBeNull();
      });

      it('is deterministic across repeated derivations of the same inputs', () => {
        const build1 = build(
          () => {},
          (roster) => { roster.match = { ...roster.match, venueLocalStartTime: '2026-09-19T17:15:00' }; },
        );
        const build2 = build(
          () => {},
          (roster) => { roster.match = { ...roster.match, venueLocalStartTime: '2026-09-19T17:15:00' }; },
        );
        expect(build2.localMatchDateTime).toEqual(build1.localMatchDateTime);
      });
    });
  });

  describe('buildAflApiSettleRecords (§16 S6, §19.6) — DB-free settle-record conversion', () => {
    function checkExclusivity(records: readonly { projection: unknown; rejection: unknown; deferral: unknown }[]): void {
      for (const record of records) {
        const populated = [record.projection !== null, record.rejection !== null, record.deferral !== null]
          .filter(Boolean).length;
        expect(populated).toBeLessThanOrEqual(1);
      }
    }

    it('a fully concluded bundle projects every family, no deferral, no rejection', () => {
      const fixture = readFixture('match/01-fixture-result.json');
      const roster = readFixture('match/03-match-roster.raw.json');
      const stats = readFixture('match/02-player-stats.raw.json');
      const bundle = buildAflApiMatchBundle(fixture, roster, stats, registry, identities);
      const records = buildAflApiSettleRecords(bundle, fixture, roster, stats, registry);

      expect(records).toHaveLength(4); // match + match_roster + 2 player_match_stats
      checkExclusivity(records);
      for (const record of records) {
        expect(record.rejection).toBeNull();
        expect(record.deferral).toBeNull();
        expect(record.projection).not.toBeNull();
      }

      const match = records.find((r) => r.family === 'match')!;
      expect(match.scopeKey).toBe('season=2026');
      expect(match.externalRecordId).toBe('CD_M20260142801');
      expect(match.payload).toBe(fixture);
      expect(match.projection).toBe(bundle.match);

      const matchRoster = records.find((r) => r.family === 'match_roster')!;
      expect(matchRoster.scopeKey).toBe('season=2026;match=CD_M20260142801');
      expect(matchRoster.externalRecordId).toBe('CD_M20260142801');
      expect(matchRoster.projection).toBe(bundle.roster);

      const playerStats = records.filter((r) => r.family === 'player_match_stats');
      expect(playerStats).toHaveLength(2);
      expect(playerStats.map((r) => r.scopeKey)).toEqual(['season=2026;match=CD_M20260142801', 'season=2026;match=CD_M20260142801']);
      expect(playerStats.map((r) => r.externalRecordId).sort()).toEqual([
        'CD_M20260142801|CD_T20|CD_I500001',
        'CD_M20260142801|CD_T80|CD_I297354',
      ]);
      for (const r of playerStats) expect(r.projection).not.toBeNull();
    });

    it('§7.3 (T3): status_not_concluded defers every family of the unit, no projection anywhere', () => {
      const fixture = readFixture('match/01-fixture-result.json');
      fixture.status = 'POSTGAME';
      const roster = readFixture('match/03-match-roster.raw.json');
      const stats = readFixture('match/02-player-stats.raw.json');
      const bundle = buildAflApiMatchBundle(fixture, roster, stats, registry, identities);
      const records = buildAflApiSettleRecords(bundle, fixture, roster, stats, registry);

      checkExclusivity(records);
      for (const record of records) {
        expect(record.projection).toBeNull();
        expect(record.rejection).toBeNull();
        expect(record.deferral).toEqual({ reason: 'status_not_concluded', detail: 'POSTGAME' });
      }
    });

    it('§7.3 (T3): roster_not_concluded defers only match_roster/player_match_stats, match still projects', () => {
      const fixture = readFixture('match/01-fixture-result.json');
      const roster = readFixture('match/03-match-roster.raw.json');
      roster.matchRoster.status = 'LIVE';
      const stats = readFixture('match/02-player-stats.raw.json');
      const bundle = buildAflApiMatchBundle(fixture, roster, stats, registry, identities);
      const records = buildAflApiSettleRecords(bundle, fixture, roster, stats, registry);

      checkExclusivity(records);
      const match = records.find((r) => r.family === 'match')!;
      expect(match.deferral).toBeNull();
      expect(match.projection).not.toBeNull();

      for (const record of records.filter((r) => r.family !== 'match')) {
        expect(record.projection).toBeNull();
        expect(record.deferral).toEqual({ reason: 'roster_not_concluded', detail: 'LIVE' });
      }
    });

    it('external_record_id and scope_key are deterministic across repeated builds', () => {
      const fixture = readFixture('match/01-fixture-result.json');
      const roster = readFixture('match/03-match-roster.raw.json');
      const stats = readFixture('match/02-player-stats.raw.json');
      const bundle = buildAflApiMatchBundle(fixture, roster, stats, registry, identities);

      const first = buildAflApiSettleRecords(bundle, fixture, roster, stats, registry);
      const second = buildAflApiSettleRecords(bundle, fixture, roster, stats, registry);
      expect(second.map((r) => ({ family: r.family, scopeKey: r.scopeKey, externalRecordId: r.externalRecordId })))
        .toEqual(first.map((r) => ({ family: r.family, scopeKey: r.scopeKey, externalRecordId: r.externalRecordId })));
    });
  });

  describe('emitAflApiBrownlowMatchVotes (§10)', () => {
    it('projects a valid one-match, exactly-3-row {3,2,1} vote set', () => {
      const { records } = emitAflApiBrownlowMatchVotes(readFixture('brownlow/01-brownlow-season-round.json'), registry);
      expect(records).toHaveLength(1);
      expect(records[0].providerMatchId).toBe('CD_M20260142801');
      expect(records[0].votes.map((v) => v.votes)).toEqual([3, 2, 1]);
      expect(records[0].votes.map((v) => v.providerPlayerId)).toEqual(['CD_I900001', 'CD_I900002', 'CD_I900003']);
    });

    it('refuses a vote set whose values are not exactly {3,2,1}', () => {
      const raw = readFixture('brownlow/01-brownlow-season-round.json');
      raw.matchVotes[0].votes[0].votes = 4;
      expect(() => emitAflApiBrownlowMatchVotes(raw, registry)).toThrow(/exactly \[3, 2, 1\]/);
    });

    it('refuses a match with fewer than 3 vote rows (the {3,2,1}-sums-to-6 exactly-3-rows invariant)', () => {
      const raw = readFixture('brownlow/01-brownlow-season-round.json');
      raw.matchVotes[0].votes = raw.matchVotes[0].votes.slice(0, 2); // only 2 rows
      expect(() => emitAflApiBrownlowMatchVotes(raw, registry)).toThrow(/expected exactly 3/);
    });

    it('refuses a duplicate player within one match vote set (values still exactly {3,2,1})', () => {
      const raw = readFixture('brownlow/01-brownlow-season-round.json');
      // Same player id on two rows; vote VALUES are untouched (still 3/2/1), so it is
      // specifically the duplicate-player check that must fire, not the vote-shape check.
      raw.matchVotes[0].votes[1].player.playerId = raw.matchVotes[0].votes[0].player.playerId;
      expect(() => emitAflApiBrownlowMatchVotes(raw, registry)).toThrow(/duplicate player/i);
    });

    it('refuses a duplicate matchId across matchVotes entries', () => {
      const raw = readFixture('brownlow/01-brownlow-season-round.json');
      raw.matchVotes.push(raw.matchVotes[0]);
      expect(() => emitAflApiBrownlowMatchVotes(raw, registry)).toThrow(/Duplicate matchId/);
    });

    // AFLDB-ISSUE-228 S7 operator finding (2026-09-20): the pre-count response
    // (`matchVotes: []`) is a VALID "no votes published yet" state, never a
    // malformed source, missing schema, absence or an incomplete vote set — but
    // was refused with a spurious "missing required column(s)" error because
    // `matchVotes.matchId` etc. can never be OBSERVED at all when the array is
    // empty (`flattenObservedColumns()` contributes no path for an empty
    // array). Fixed in `projectFamily()`/`assertProjectableColumns()` by
    // skipping the required-column check only when the collection itself is
    // empty; required-field strictness for an ACTUAL record is untouched.
    it('§10 pre-count contract: an empty matchVotes[] is a VALID publication, not a schema error', () => {
      const raw = readFixture('brownlow/01-brownlow-season-round.json');
      raw.matchVotes = [];
      const { records, observedColumns } = emitAflApiBrownlowMatchVotes(raw, registry);
      expect(records).toEqual([]);
      // No `matchVotes.*` leaf can appear at all when the array is empty.
      expect(observedColumns.some((c) => c.startsWith('matchVotes.'))).toBe(false);
    });

    it('a published (non-empty) vote set still enforces every declared required column', () => {
      const raw = readFixture('brownlow/01-brownlow-season-round.json');
      const { records, observedColumns } = emitAflApiBrownlowMatchVotes(raw, registry);
      expect(records).toHaveLength(1);
      for (const column of getSourceFamily(registry, 'afl_api', 'brownlow_match_votes').requiredColumns ?? []) {
        expect(observedColumns).toContain(column);
      }
    });

    it('still refuses a published (non-empty) record missing a required field (fails closed, never fabricated)', () => {
      const raw = readFixture('brownlow/01-brownlow-season-round.json');
      delete raw.matchVotes[0].votes[0].player.playerId;
      expect(() => emitAflApiBrownlowMatchVotes(raw, registry)).toThrow();
    });
  });

  describe('emitAflApiBrownlowLeaderboard + reconcileBrownlowLeaderboard (§10)', () => {
    it('reconciles cleanly when match votes and leaderboard totals agree', () => {
      const { records: matchVotes } = emitAflApiBrownlowMatchVotes(readFixture('brownlow/01-brownlow-season-round.json'), registry);
      const { records: leaderboard } = emitAflApiBrownlowLeaderboard(readFixture('brownlow/02-brownlow-leaderboard-sample.json'), registry);
      expect(leaderboard).toHaveLength(3);
      expect(leaderboard[0].leader).toBe(true);
      expect(reconcileBrownlowLeaderboard(matchVotes, leaderboard)).toEqual([]);
    });

    it('reports a mismatch when a leaderboard total disagrees with the reconstructed total', () => {
      const { records: matchVotes } = emitAflApiBrownlowMatchVotes(readFixture('brownlow/01-brownlow-season-round.json'), registry);
      const raw = readFixture('brownlow/02-brownlow-leaderboard-sample.json');
      raw.leaderboard[0].totalVotes = 99;
      const { records: leaderboard } = emitAflApiBrownlowLeaderboard(raw, registry);
      expect(reconcileBrownlowLeaderboard(matchVotes, leaderboard)).toEqual([
        { providerPlayerId: 'CD_I900001', reconstructedTotal: 3, leaderboardTotal: 99 },
      ]);
    });

    // Same §10 pre-count contract as the matchVotes fix above: an empty
    // leaderboard is equally valid (the count has not published totals yet).
    it('§10 pre-count contract: an empty leaderboard[] is a VALID publication, not a schema error', () => {
      const raw = readFixture('brownlow/02-brownlow-leaderboard-sample.json');
      raw.leaderboard = [];
      const { records, observedColumns } = emitAflApiBrownlowLeaderboard(raw, registry);
      expect(records).toEqual([]);
      expect(observedColumns.some((c) => c.startsWith('leaderboard.'))).toBe(false);
    });

    it('still refuses a published (non-empty) leaderboard entry missing a required field', () => {
      const raw = readFixture('brownlow/02-brownlow-leaderboard-sample.json');
      delete raw.leaderboard[0].totalVotes;
      expect(() => emitAflApiBrownlowLeaderboard(raw, registry)).toThrow();
    });
  });

  describe('source-family registry parity with the emitters (§19.5-adjacent)', () => {
    it('all five S3 families are declared, reviewed-or-not-yet-declared, and column-contracted', () => {
      for (const family of ['match', 'match_roster', 'player_match_stats', 'brownlow_match_votes', 'brownlow_leaderboard']) {
        const contract = getSourceFamily(registry, 'afl_api', family);
        expect(contract.status).toBe('declared');
        expect(contract.knownColumns).not.toBeNull();
        expect(contract.hashExclusions).toEqual([]);
      }
      // match_roster is the one deliberately-incomplete family (§ module doc comment).
      expect(getSourceFamily(registry, 'afl_api', 'match_roster').knownColumnsStatus).toBe('incomplete');
      for (const family of ['match', 'player_match_stats', 'brownlow_match_votes', 'brownlow_leaderboard']) {
        expect(getSourceFamily(registry, 'afl_api', family).knownColumnsStatus).toBe('complete');
      }
    });

    it('the match, player_match_stats and brownlow fixtures project with no undeclared column', () => {
      expect(() => emitAflApiMatch(readFixture('match/01-fixture-result.json'), registry, identities)).not.toThrow();
      expect(() => emitAflApiPlayerMatchStats(readFixture('match/02-player-stats.raw.json'), registry, 'CD_M20260142801')).not.toThrow();
      expect(() => emitAflApiMatchRoster(readFixture('match/03-match-roster.raw.json'), registry, 'CD_M20260142801')).not.toThrow();
      expect(() => emitAflApiBrownlowMatchVotes(readFixture('brownlow/01-brownlow-season-round.json'), registry)).not.toThrow();
      expect(() => emitAflApiBrownlowLeaderboard(readFixture('brownlow/02-brownlow-leaderboard-sample.json'), registry)).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// resolveAflApiMatch (AFLDB-ISSUE-228 S6-D1, §6.1) — read-only, DB-free via a
// fake postgres.js tagged-template handle. Routed by a substring of the
// query's own static text, the same pattern `tests/admin-draft-actions.test.ts`
// uses, since the resolver issues more than one distinguishable query per call.
// ---------------------------------------------------------------------------

describe('resolveAflApiMatch (AFLDB-ISSUE-228 S6-D1, §6.1)', () => {
  type Responder = (text: string) => unknown[];

  function fakeSql(respond: Responder): { sql: postgres.Sql; seen: string[] } {
    const seen: string[] = [];
    const sql = ((strings: TemplateStringsArray) => {
      const text = strings.join('?').replace(/\s+/g, ' ').trim();
      seen.push(text);
      return Promise.resolve(respond(text));
    }) as unknown as postgres.Sql;
    return { sql, seen };
  }

  const BASE: AflApiMatchIdentity = {
    sourceId: 42,
    providerId: 'CD_M20260142801',
    season: 2026,
    roundCode: '5',
    matchDate: '2026-04-18',
    homeClubId: 10,
    awayClubId: 20,
    matchKey: '2026|5|2026-04-18|Richmond|Carlton',
  };

  function respondEmpty(): unknown[] {
    return [];
  }

  it('resolves on an exact provider-id hit regardless of its current match_key', async () => {
    const { sql, seen } = fakeSql((text) => {
      if (text.includes('source_record_id =')) {
        return [{ id: 501, season: 2026, homeClubId: 10, awayClubId: 20, matchKey: 'STALE|KEY' }];
      }
      return respondEmpty();
    });

    const result = await resolveAflApiMatch(sql, BASE, { kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE });

    expect(result).toEqual({ outcome: 'resolved', targetId: 501, via: 'provider_id', currentMatchKey: 'STALE|KEY' });
    // Only the provider-id lookup ran: step 1 short-circuits steps 2/3.
    expect(seen).toHaveLength(1);
  });

  it('fails closed (unresolved) when the provider id, match_key and retired search all miss', async () => {
    const { sql } = fakeSql(respondEmpty);

    const result = await resolveAflApiMatch(sql, BASE, { kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE });

    expect(result).toEqual({ outcome: 'unresolved' });
  });

  it('fails closed (provider_id_ambiguous) when two canonical rows share the same provider id', async () => {
    const { sql } = fakeSql((text) => {
      if (text.includes('source_record_id =')) {
        return [
          { id: 501, season: 2026, homeClubId: 10, awayClubId: 20, matchKey: 'A' },
          { id: 502, season: 2026, homeClubId: 10, awayClubId: 20, matchKey: 'B' },
        ];
      }
      return respondEmpty();
    });

    const result = await resolveAflApiMatch(sql, BASE, { kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE });

    expect(result).toEqual({ outcome: 'refused', reason: 'provider_id_ambiguous', candidateIds: [501, 502] });
  });

  it('HALTs (provider_identity_contradiction) when the provider-id hit disagrees on season/home/away', async () => {
    const { sql } = fakeSql((text) => {
      if (text.includes('source_record_id =')) {
        return [{ id: 501, season: 2026, homeClubId: 999, awayClubId: 20, matchKey: BASE.matchKey }];
      }
      return respondEmpty();
    });

    const result = await resolveAflApiMatch(sql, BASE, { kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE });

    expect(result).toEqual({
      outcome: 'halt',
      reason: 'provider_identity_contradiction',
      targetId: 501,
      observed: { season: 2026, homeClubId: 999, awayClubId: 20 },
      incoming: { season: 2026, homeClubId: 10, awayClubId: 20 },
    });
  });

  it('falls back to match_key on a provider-id miss', async () => {
    const { sql } = fakeSql((text) => {
      if (text.includes('match_key = ?')) return [{ id: 777 }];
      return respondEmpty();
    });

    const result = await resolveAflApiMatch(sql, BASE, { kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE });

    expect(result).toEqual({ outcome: 'resolved', targetId: 777, via: 'match_key', currentMatchKey: BASE.matchKey });
  });

  it('fails closed (rekey_would_merge) when match_key and the retired-identity search disagree on the row', async () => {
    const { sql } = fakeSql((text) => {
      if (text.includes('match_key = ?')) return [{ id: 777 }];
      if (text.includes('JOIN staging.source_records')) {
        return [{ id: 888, matchKey: 'OLD|KEY', sourceRecordId: 'CD_M_OLD' }];
      }
      return respondEmpty();
    });

    const result = await resolveAflApiMatch(
      sql, BASE, { kind: 'run_enumeration', scope: { completeScopeKeys: ['season=2026'], publishedRecordIds: [] } },
    );

    expect(result).toEqual({ outcome: 'refused', reason: 'rekey_would_merge', candidateIds: [777, 888] });
  });

  it('resolves via the retired-identity search alone (§6.1 step 3, ISSUE-131)', async () => {
    const { sql } = fakeSql((text) => {
      if (text.includes('JOIN staging.source_records')) {
        return [{ id: 888, matchKey: 'OLD|KEY', sourceRecordId: 'CD_M_OLD' }];
      }
      return respondEmpty();
    });

    const result = await resolveAflApiMatch(
      sql, BASE, { kind: 'run_enumeration', scope: { completeScopeKeys: ['season=2026'], publishedRecordIds: [] } },
    );

    expect(result).toEqual({ outcome: 'resolved', targetId: 888, via: 'retired_identity', currentMatchKey: 'OLD|KEY' });
  });

  it('fails closed (rekey_ambiguous) when more than one retired identity matches', async () => {
    const { sql } = fakeSql((text) => {
      if (text.includes('JOIN staging.source_records')) {
        return [
          { id: 888, matchKey: 'OLD|KEY|1', sourceRecordId: 'CD_M_OLD_1' },
          { id: 889, matchKey: 'OLD|KEY|2', sourceRecordId: 'CD_M_OLD_2' },
        ];
      }
      return respondEmpty();
    });

    const result = await resolveAflApiMatch(
      sql, BASE, { kind: 'run_enumeration', scope: { completeScopeKeys: ['season=2026'], publishedRecordIds: [] } },
    );

    expect(result).toEqual({ outcome: 'refused', reason: 'rekey_ambiguous', candidateIds: [888, 889] });
  });

  it('is deterministic: the same identity resolves the same way across repeated calls', async () => {
    const { sql } = fakeSql((text) => {
      if (text.includes('source_record_id =')) {
        return [{ id: 501, season: 2026, homeClubId: 10, awayClubId: 20, matchKey: BASE.matchKey }];
      }
      return respondEmpty();
    });

    const first = await resolveAflApiMatch(sql, BASE, { kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE });
    const second = await resolveAflApiMatch(sql, BASE, { kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE });

    expect(second).toEqual(first);
  });

  it('exposes no mutation or write API', async () => {
    const resolverModule = await import('@/lib/acquisition/afl-api-match-resolver');
    const exportNames = Object.keys(resolverModule);
    expect(exportNames).toEqual(['resolveAflApiMatch']);
  });
});

// ---------------------------------------------------------------------------
// resolveAflApiPlayer (AFLDB-ISSUE-228 S6-D2, §6.3) — read-only, DB-free via
// the same fake postgres.js tagged-template handle `resolveAflApiMatch`'s
// suite above uses.
// ---------------------------------------------------------------------------

describe('resolveAflApiPlayer (AFLDB-ISSUE-228 S6-D2, §6.3)', () => {
  type Responder = (text: string) => unknown[];

  function fakeSql(respond: Responder): { sql: postgres.Sql; seen: string[] } {
    const seen: string[] = [];
    const sql = ((strings: TemplateStringsArray) => {
      const text = strings.join('?').replace(/\s+/g, ' ').trim();
      seen.push(text);
      return Promise.resolve(respond(text));
    }) as unknown as postgres.Sql;
    return { sql, seen };
  }

  const SOURCE_ID = 42;
  const TRUSTED = 'CD_I20260001';
  const UNBRIDGED_1 = 'CD_I1002231'; // Patrick Naish — deliberately unresolved (S5 boundary)
  const UNBRIDGED_2 = 'CD_I999724'; // Declan Mountford — deliberately unresolved (S5 boundary)

  function respondEmpty(): unknown[] {
    return [];
  }

  it('resolves a trusted CD_I identity to exactly one canonical player', async () => {
    const { sql, seen } = fakeSql((text) => {
      if (text.includes('FROM external_identities')) {
        return [{ playerId: 900 }];
      }
      return respondEmpty();
    });

    const result = await resolveAflApiPlayer(sql, SOURCE_ID, TRUSTED);

    expect(result).toEqual({ outcome: 'resolved', playerId: 900 });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('source_id = ?');
    expect(seen[0]).toContain('external_id = ?');
    expect(seen[0]).toContain("status IN ('unique', 'resolved')");
    expect(seen[0]).toContain('player_id IS NOT NULL');
  });

  it('is unresolved for a missing identity — no fallback', async () => {
    const { sql } = fakeSql(respondEmpty);

    const result = await resolveAflApiPlayer(sql, SOURCE_ID, UNBRIDGED_1);

    expect(result).toEqual({ outcome: 'unresolved' });
  });

  it('fails closed (player_identity_ambiguous) when the trusted identity has more than one row', async () => {
    const { sql } = fakeSql((text) => {
      if (text.includes('FROM external_identities')) {
        return [{ playerId: 900 }, { playerId: 901 }];
      }
      return respondEmpty();
    });

    const result = await resolveAflApiPlayer(sql, SOURCE_ID, TRUSTED);

    expect(result).toEqual({
      outcome: 'refused',
      reason: 'player_identity_ambiguous',
      candidateIds: [900, 901],
    });
  });

  it('does not resolve a provider id under the wrong source', async () => {
    // The fake routes on the query's static text only (bound values are not
    // visible to it, matching the `resolveAflApiMatch` suite's own fake), so
    // this proves the query is source-scoped (`source_id = ?` is part of the
    // WHERE clause — asserted above) and that a source lookup finding no
    // linked row — exactly what a real DB returns for a source that never
    // linked this provider id — resolves to `unresolved`, never a match
    // found under a different source.
    const { sql } = fakeSql(respondEmpty);

    const result = await resolveAflApiPlayer(sql, 999, TRUSTED);

    expect(result).toEqual({ outcome: 'unresolved' });
  });

  it('repeated identical lookups are deterministic', async () => {
    const { sql } = fakeSql((text) => {
      if (text.includes('FROM external_identities')) {
        return [{ playerId: 900 }];
      }
      return respondEmpty();
    });

    const first = await resolveAflApiPlayer(sql, SOURCE_ID, TRUSTED);
    const second = await resolveAflApiPlayer(sql, SOURCE_ID, TRUSTED);

    expect(second).toEqual(first);
  });

  it('the two S5-deliberately-unresolved provider ids stay unresolved with a single lookup and no second strategy', async () => {
    const { sql, seen } = fakeSql(respondEmpty);

    const naish = await resolveAflApiPlayer(sql, SOURCE_ID, UNBRIDGED_1);
    const mountford = await resolveAflApiPlayer(sql, SOURCE_ID, UNBRIDGED_2);

    expect(naish).toEqual({ outcome: 'unresolved' });
    expect(mountford).toEqual({ outcome: 'unresolved' });
    // One query per call — no name/jumper/club/stat/AFL-Tables-URL fallback
    // query is ever issued.
    expect(seen).toHaveLength(2);
    seen.forEach((text) => {
      expect(text).toContain('FROM external_identities');
      expect(text).not.toMatch(/name|jumper|club|players\.|afltables/i);
    });
  });

  it('exposes no mutation or write API', async () => {
    const resolverModule = await import('@/lib/acquisition/afl-api-player-resolver');
    const exportNames = Object.keys(resolverModule);
    expect(exportNames).toEqual(['resolveAflApiPlayer']);
  });
});

// ---------------------------------------------------------------------------
// AFLDB-ISSUE-228 §9.9 / §19.5 (c) — backtest assertion 9, the NAMED capture
// pair. DB-free: builds a throwaway project root from the trimmed
// tests/fixtures/afl_api/match capture (itself CD_M20260142801), laid out
// exactly like the real 10:29 sample folder and 21:41 monitor snapshot.
// ---------------------------------------------------------------------------

describe('backtest assertion 9 — named semantic-hash pair (AFLDB-ISSUE-228 §9.9)', () => {
  const projectRoot = join(__dirname, '..');
  const registry = parseSourceFamilyRegistry(
    JSON.parse(readFileSync(join(projectRoot, 'data', 'reference', 'source-families.json'), 'utf8')),
  );
  const identities = parseAflApiIdentities(
    JSON.parse(readFileSync(join(projectRoot, 'data', 'reference', 'afl-api-identities.json'), 'utf8')),
  );
  const fixtureDir = join(projectRoot, 'tests', 'fixtures', 'afl_api', 'match');
  const source = {
    fixture: JSON.parse(readFileSync(join(fixtureDir, '01-fixture-result.json'), 'utf8')),
    playerStats: JSON.parse(readFileSync(join(fixtureDir, '02-player-stats.raw.json'), 'utf8')),
    matchRoster: JSON.parse(readFileSync(join(fixtureDir, '03-match-roster.raw.json'), 'utf8')),
  };
  const sha = (text: string) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
  const roots: string[] = [];
  afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

  type Bodies = { fixture: unknown; playerStats: unknown; matchRoster: unknown };
  /** Writes the earlier capture pretty-printed and the later one compact (as
   * the real sample and monitor scripts did), pins each file's sha256 into
   * the pair, and returns root + pair. `write: false` leaves a capture on disk
   * absent while still naming it. */
  function layout(earlier: Bodies, later: Bodies, options: { writeLater?: boolean } = {}): { root: string; pair: SemanticPair } {
    const root = mkdtempSync(join(tmpdir(), 'afldb-a9-'));
    roots.push(root);
    const put = (dir: string, name: string, body: unknown, pretty: boolean, write = true) => {
      const text = JSON.stringify(body, null, pretty ? 4 : undefined);
      const path = `${dir}/${name}`;
      if (write) {
        mkdirSync(join(root, dir), { recursive: true });
        writeFileSync(join(root, path), text, 'utf8');
      }
      return { path, sha256: sha(text) };
    };
    const e = 'data/sources/AFLWebsite/AFLGamesSamples/2026-09-19_HAW_v_BL_CD_M20260142801';
    const l = 'data/sources/AFLWebsite/AFLGamesSamples/monitor-CD_M20260142801/20260919-214114';
    const w = options.writeLater ?? true;
    return {
      root,
      pair: {
        matchId: 'CD_M20260142801',
        earlier: {
          label: '10:29',
          fixture: put(e, '01-fixture-result.json', earlier.fixture, true),
          playerStats: put(e, '02-player-stats.raw.json', earlier.playerStats, true),
          matchRoster: put(e, '03-match-roster.raw.json', earlier.matchRoster, true),
        },
        later: {
          label: '21:41',
          fixture: put(l, '01-fixture.json', later.fixture, false, w),
          playerStats: put(l, '02-player-stats.json', later.playerStats, false, w),
          matchRoster: put(l, '03-match-roster.json', later.matchRoster, false, w),
        },
      },
    };
  }
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

  it('names the historical pair explicitly across the two folders, never by scanning', () => {
    expect(ASSERTION_9_PAIR.matchId).toBe('CD_M20260142801');
    expect(ASSERTION_9_PAIR.earlier.fixture.path).toContain('/2026-09-19_HAW_v_BL_CD_M20260142801/');
    expect(ASSERTION_9_PAIR.later.fixture.path).toContain('/monitor-CD_M20260142801/20260919-214114/');
  });

  it('one capture => explicit skip, never a pass', () => {
    const { root, pair } = layout(source, source, { writeLater: false });
    const { outcome, report } = runSemanticPairAssertion(root, pair, registry, identities);
    expect(outcome.outcome).toBe('skipped');
    expect(outcome.detail).toContain('fixture absent');
    expect(outcome.detail).toContain('21:41');
    expect(report.families).toEqual([]);
  });

  it('identical canonical payloads in different serialisations => PASS, after a real per-record comparison', () => {
    const { root, pair } = layout(source, source);
    expect(pair.earlier.fixture.sha256).not.toBe(pair.later.fixture.sha256); // pretty vs compact bytes
    const { outcome, report } = runSemanticPairAssertion(root, pair, registry, identities);
    expect(outcome.outcome).toBe('pass');
    expect(report.exclusionsApplied).toEqual([]);
    expect(report.differences).toEqual([]);
    expect(report.families.map((f) => f.family)).toEqual(['match', 'match_roster', 'player_match_stats']);
    for (const f of report.families) {
      expect(f.earlierRecords).toBeGreaterThan(0);
      expect(f.earlierRecords).toBe(f.laterRecords);
      expect(f.earlierHash).toMatch(/^[0-9a-f]{64}$/);
      expect(f.earlierHash).toBe(f.laterHash);
      expect(f.unchanged).toBe(true);
    }
  });

  it('a changed canonical field => FAIL as evidence pair 1 of 3, naming the exact path', () => {
    const later = clone(source);
    later.playerStats.homeTeamPlayerStats[0].playerStats.stats.kicks = 10;
    const { root, pair } = layout(source, later);
    const { outcome, report } = runSemanticPairAssertion(root, pair, registry, identities);
    expect(outcome.outcome).toBe('fail');
    expect(outcome.detail).toContain('evidence pair 1 of 3');
    expect(outcome.detail).toContain('playerStats.stats.kicks');
    expect(report.families.find((f) => f.family === 'player_match_stats')?.unchanged).toBe(false);
    expect(report.families.find((f) => f.family === 'match')?.unchanged).toBe(true);
    expect(report.differences).toEqual([{
      family: 'player_match_stats',
      externalRecordId: expect.stringContaining('CD_M20260142801|'),
      kind: 'changed',
      paths: ['playerStats.stats.kicks'],
    }]);
  });

  it('no silent exclusions: a classic volatile field (lastUpdated) still fails, and nothing is excluded', () => {
    const later = clone(source);
    later.playerStats.homeTeamPlayerStats[0].playerStats.stats.lastUpdated = '2026-09-19T11:41:00.000+0000';
    const { root, pair } = layout(source, later);
    const { outcome, report } = runSemanticPairAssertion(root, pair, registry, identities);
    expect(outcome.outcome).toBe('fail');
    expect(report.exclusionsApplied).toEqual([]);
    expect(report.differences[0]?.paths).toEqual(['playerStats.stats.lastUpdated']);
  });

  it('an unrelated third capture is never substituted for a missing named one', () => {
    const { root, pair } = layout(source, source, { writeLater: false });
    const third = join(root, 'data/sources/AFLWebsite/AFLGamesSamples/monitor-CD_M20260142801/20260921-031800');
    mkdirSync(third, { recursive: true });
    writeFileSync(join(third, '01-fixture.json'), JSON.stringify(source.fixture), 'utf8');
    writeFileSync(join(third, '02-player-stats.json'), JSON.stringify(source.playerStats), 'utf8');
    writeFileSync(join(third, '03-match-roster.json'), JSON.stringify(source.matchRoster), 'utf8');
    const { outcome } = runSemanticPairAssertion(root, pair, registry, identities);
    expect(outcome.outcome).toBe('skipped');
  });

  it('different bytes at a named path are refused as not the historical capture', () => {
    const { root, pair } = layout(source, source);
    writeFileSync(join(root, pair.later.playerStats.path), JSON.stringify(source.playerStats, null, 2), 'utf8');
    const { outcome } = runSemanticPairAssertion(root, pair, registry, identities);
    expect(outcome.outcome).toBe('fail');
    expect(outcome.detail).toContain('not the named historical capture');
  });

  it('diffCanonicalPaths reports array-index, missing-key and length differences', () => {
    expect(diffCanonicalPaths({ a: [1, 2] }, { a: [1, 3] })).toEqual(['a[1]']);
    expect(diffCanonicalPaths({ a: 1 }, { a: 1, b: 2 })).toEqual(['b']);
    expect(diffCanonicalPaths({ a: [1] }, { a: [1, 2] })).toEqual(['a.length']);
    expect(diffCanonicalPaths({ a: 9.0 }, { a: 9 })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AFLDB-ISSUE-231 — the season enumeration (completeness carrier). DB-free:
// it reads only the retained 00-season-matches.json text.
// ---------------------------------------------------------------------------

describe('AFL API season enumeration (AFLDB-ISSUE-231)', () => {
  const projectRoot = join(__dirname, '..');
  const registry = parseSourceFamilyRegistry(
    JSON.parse(readFileSync(join(projectRoot, 'data', 'reference', 'source-families.json'), 'utf8')),
  );
  const identities = parseAflApiIdentities(
    JSON.parse(readFileSync(join(projectRoot, 'data', 'reference', 'afl-api-identities.json'), 'utf8')),
  );
  const fixtureDir = join(projectRoot, 'tests', 'fixtures', 'afl_api', 'match');
  const readFixture = (name: string): unknown => JSON.parse(readFileSync(join(fixtureDir, name), 'utf8'));
  const EXPECTED = { season: 2026, compSeasonProviderId: 'CD_S2026014' };

  function entry(providerId: string, status: string, compSeason = 'CD_S2026014'): Record<string, unknown> {
    return { providerId, status, utcStartTime: '2026-04-18T09:30:00.000+0000', compSeason: { id: 85, providerId: compSeason } };
  }

  function feed(matches: readonly unknown[], numEntries: unknown = matches.length): string {
    // The MEASURED envelope (tests/fixtures/afl_api/seasons/00-season-matches-2026.raw.json).
    return JSON.stringify({
      meta: { code: 200, pagination: { page: 0, numPages: 1, pageSize: 1000, numEntries } }, matches,
    });
  }

  const THREE = [entry('CD_M1', 'CONCLUDED'), entry('CD_M2', 'CONCLUDED'), entry('CD_M3', 'SCHEDULED')];

  it('proves a whole, self-consistent feed complete and lists every match in feed order', () => {
    const enumeration = assessAflApiSeasonEnumeration(feed(THREE), EXPECTED);
    expect(enumeration.complete).toBe(true);
    expect(enumeration.gaps).toEqual([]);
    expect(enumeration.scopeKey).toBe('season=2026');
    expect(enumeration.numEntries).toBe(3);
    expect(enumeration.providerMatchIds).toEqual(['CD_M1', 'CD_M2', 'CD_M3']);
  });

  it('records each status string verbatim, including one it has never seen, without mapping it', () => {
    const enumeration = assessAflApiSeasonEnumeration(
      feed([...THREE, entry('CD_M4', 'SOME_UNMEASURED_STATE')]), EXPECTED,
    );
    expect(enumeration.statusCounts).toEqual({ CONCLUDED: 2, SCHEDULED: 1, SOME_UNMEASURED_STATE: 1 });
    // Status never moves completeness: an unfamiliar value stays observable.
    expect(enumeration.complete).toBe(true);
  });

  it('refuses the top-level pagination shape ISSUE-228 §2.1 described: only meta.pagination is measured', () => {
    const legacy = assessAflApiSeasonEnumeration(
      JSON.stringify({ meta: { code: 200 }, pagination: { numEntries: 3 }, matches: THREE }), EXPECTED,
    );
    expect(legacy.complete).toBe(false);
    expect(legacy.gaps.map((gap) => gap.reason)).toEqual(['pagination_missing']);
  });

  it('refuses completeness when meta.pagination reports more than one page, or not page 0', () => {
    const paged = (page: unknown, numPages: unknown) => JSON.stringify({
      meta: { code: 200, pagination: { page, numPages, pageSize: 1000, numEntries: 3 } }, matches: THREE,
    });
    expect(assessAflApiSeasonEnumeration(paged(0, 2), EXPECTED).gaps.map((gap) => gap.reason))
      .toEqual(['page_limit_reached']);
    expect(assessAflApiSeasonEnumeration(paged(1, 2), EXPECTED).complete).toBe(false);
    expect(assessAflApiSeasonEnumeration(paged(0, 1), EXPECTED).complete).toBe(true);
  });

  describe('against AUTHENTIC retained bytes (captured 2026-09-19T10:29:29Z, testAFLGrab AFLGamesSamples)', () => {
    const FEED_PATH = join(__dirname, 'fixtures', 'afl_api', 'seasons', '00-season-matches-2026.raw.json');
    const SLICE_PATH = join(__dirname, 'fixtures', 'afl_api', 'match', '04-season-feed-scheduled.raw-slice.json');
    const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

    it('the fixtures are the recorded bytes (hash-bound)', () => {
      // The committed feed is a sanitised derivative of the captured response (sha256 9c358984…75ee):
      // one third-party ticket-queue token value is redacted (ISSUE-231 runbook §2a).
      expect(sha256(readFileSync(FEED_PATH))).toBe('4f8235e08f438ee533b2d9c504b105b3bfce2449a807362dff10d074f7f1babb');
      expect(sha256(readFileSync(SLICE_PATH))).toBe('4d22766d4755aeb1271829a4285cf040c7302ad3b49d3a2a9a732c3505bb5d7a');
    });

    it('the real 2026 feed is complete: 218 ids, statuses CONCLUDED 217 and SCHEDULED 1, verbatim', () => {
      const enumeration = assessAflApiSeasonEnumeration(readFileSync(FEED_PATH, 'utf8'), EXPECTED);
      expect(enumeration.gaps).toEqual([]);
      expect(enumeration.complete).toBe(true);
      expect(enumeration.numEntries).toBe(218);
      expect(enumeration.providerMatchIds).toHaveLength(218);
      expect(enumeration.statusCounts).toEqual({ CONCLUDED: 217, SCHEDULED: 1 });
      expect(describeAflApiSeasonEnumeration(enumeration)).toBe(
        'Season feed CD_S2026014: 218 match(es), complete; statuses observed: CONCLUDED 217, SCHEDULED 1.',
      );
      // The unselected SCHEDULED Grand Final is still published: never retired, never absent.
      expect(aflApiMatchRekeyScope(enumeration).publishedRecordIds).toContain('CD_M20260142901');
    });

    it('AFLDB-ISSUE-229 evidence: the SCHEDULED record is a byte-exact slice of that feed, with no score block', () => {
      const feedText = readFileSync(FEED_PATH, 'utf8');
      const sliceText = readFileSync(SLICE_PATH, 'utf8');
      // Offset in the committed sanitised feed: 317,211. The original captured response has the slice
      // at 317,497; the 286-byte shift is the redacted ticket-queue token, which precedes the slice.
      expect(feedText.indexOf(sliceText)).toBe(317211);
      const scheduled = JSON.parse(sliceText) as Record<string, Record<string, unknown>>;
      expect(scheduled.providerId).toBe('CD_M20260142901');
      expect(scheduled.status).toBe('SCHEDULED');
      expect(Object.keys(scheduled)).toEqual([
        'id', 'providerId', 'compSeason', 'round', 'home', 'away', 'venue', 'utcStartTime', 'status', 'metadata',
      ]);
      expect(Object.keys(scheduled.home)).toEqual(['team']);
      expect(Object.keys(scheduled.away)).toEqual(['team']);
      // Every CONCLUDED entry in the same response carries a score block; this one alone does not.
      const all = (JSON.parse(feedText) as { matches: Array<{ status: string; home: object; away: object }> }).matches;
      expect(all.filter((m) => !('score' in m.home) || !('score' in m.away)).map((m) => m.status)).toEqual(['SCHEDULED']);
    });

    it('AFLDB-ISSUE-229: today\'s match contract refuses that real SCHEDULED record as a build failure', () => {
      const { records, buildFailures } = buildAflApiFixtureRecords(
        [JSON.parse(readFileSync(SLICE_PATH, 'utf8'))], registry, identities,
      );
      expect(records).toEqual([]);
      expect(buildFailures).toHaveLength(1);
      expect(buildFailures[0].providerMatchId).toBe('CD_M20260142901');
      expect(buildFailures[0].error).toBe(
        'afl_api/match is missing required column(s): home.score.goals, home.score.behinds, '
        + 'home.score.totalScore, away.score.goals, away.score.behinds, away.score.totalScore.',
      );
    });
  });

  it('refuses completeness when meta.pagination.numEntries is absent or not an integer', () => {
    const absent = assessAflApiSeasonEnumeration(JSON.stringify({ matches: THREE }), EXPECTED);
    expect(absent.complete).toBe(false);
    expect(absent.gaps.map((gap) => gap.reason)).toEqual(['pagination_missing']);
    expect(absent.numEntries).toBeNull();
    expect(assessAflApiSeasonEnumeration(feed(THREE, '3'), EXPECTED).gaps[0].reason).toBe('pagination_missing');
    expect(assessAflApiSeasonEnumeration(feed(THREE, 2.5), EXPECTED).gaps[0].reason).toBe('pagination_missing');
  });

  it('refuses completeness when the response returned fewer matches than it declared (a partial feed)', () => {
    const enumeration = assessAflApiSeasonEnumeration(feed(THREE, 216), EXPECTED);
    expect(enumeration.complete).toBe(false);
    expect(enumeration.gaps.map((gap) => gap.reason)).toEqual(['pagination_mismatch']);
    // The ids it did see are still reported; they are simply not proof of the whole season.
    expect(enumeration.providerMatchIds).toHaveLength(3);
  });

  it('refuses completeness when the response filled the requested page', () => {
    const matches = Array.from({ length: 1000 }, (_, i) => entry(`CD_M${i}`, 'CONCLUDED'));
    const enumeration = assessAflApiSeasonEnumeration(feed(matches), EXPECTED);
    expect(enumeration.complete).toBe(false);
    expect(enumeration.gaps.map((gap) => gap.reason)).toEqual(['page_limit_reached']);
  });

  it('never treats an empty feed as proof of an empty season', () => {
    const enumeration = assessAflApiSeasonEnumeration(feed([], 0), EXPECTED);
    expect(enumeration.complete).toBe(false);
    expect(enumeration.gaps.map((gap) => gap.reason)).toEqual(['empty_season_feed']);
  });

  it('refuses completeness when an entry names another season, or none', () => {
    const foreign = assessAflApiSeasonEnumeration(
      feed([...THREE, entry('CD_M9', 'CONCLUDED', 'CD_S2025014')]), EXPECTED,
    );
    expect(foreign.complete).toBe(false);
    expect(foreign.gaps.map((gap) => gap.reason)).toEqual(['foreign_comp_season']);
    expect(foreign.gaps[0].detail).toContain('CD_S2025014');

    const missing = assessAflApiSeasonEnumeration(
      feed([...THREE, { providerId: 'CD_M9', status: 'CONCLUDED' }]), EXPECTED,
    );
    expect(missing.gaps.map((gap) => gap.reason)).toEqual(['foreign_comp_season']);
  });

  it('refuses completeness when one provider id is listed twice', () => {
    const enumeration = assessAflApiSeasonEnumeration(feed([...THREE, entry('CD_M2', 'CONCLUDED')]), EXPECTED);
    expect(enumeration.complete).toBe(false);
    expect(enumeration.gaps.map((gap) => gap.reason)).toEqual(['duplicate_provider_id']);
    expect(enumeration.gaps[0].detail).toContain('CD_M2');
  });

  it('throws on a malformed envelope rather than reading half of it', () => {
    expect(() => assessAflApiSeasonEnumeration(JSON.stringify({ pagination: { numEntries: 0 } }), EXPECTED))
      .toThrow(/no 'matches' array/);
    expect(() => assessAflApiSeasonEnumeration(feed([{ status: 'CONCLUDED' }]), EXPECTED))
      .toThrow(/no string providerId/);
  });

  it('a snapshot with no retained feed lists nothing and proves nothing', () => {
    const enumeration = missingAflApiSeasonEnumeration(2026, 'CD_S2026014');
    expect(enumeration.complete).toBe(false);
    expect(enumeration.providerMatchIds).toEqual([]);
    expect(enumeration.gaps.map((gap) => gap.reason)).toEqual(['season_feed_not_in_snapshot']);
  });

  describe('the retirement proof it supports (ISSUE-131 scope for afl_api)', () => {
    it('a complete feed names its scope and publishes the WHOLE feed, not the run\'s selection', () => {
      // CD_M3 is SCHEDULED: a nightly CONCLUDED-only acquisition never selects
      // it, yet it is still published and must never read as retired.
      const scope = aflApiMatchRekeyScope(assessAflApiSeasonEnumeration(feed(THREE), EXPECTED));
      expect(scope).toEqual({
        completeScopeKeys: ['season=2026'],
        publishedRecordIds: ['CD_M1', 'CD_M2', 'CD_M3'],
      });
    });

    it('an incomplete or missing feed yields exactly the scope that proves nothing', () => {
      expect(aflApiMatchRekeyScope(assessAflApiSeasonEnumeration(feed(THREE, 216), EXPECTED)))
        .toEqual(NO_MATCH_REKEY_SCOPE);
      expect(aflApiMatchRekeyScope(missingAflApiSeasonEnumeration(2026, 'CD_S2026014')))
        .toEqual(NO_MATCH_REKEY_SCOPE);
    });
  });

  describe('the absence sweep decision (residual 2, D-231-1 / D-231-2), DB-free', () => {
    const spine = (id: string, absentSince: string | null = null) => ({ externalRecordId: id, absentSince });
    const complete = () => assessAflApiSeasonEnumeration(feed(THREE), EXPECTED);

    it('D-231-1 is zero, with no positive tolerance', () => {
      expect(AFL_API_ABSENCE_TOLERANCE).toBe(0);
    });

    it('id-list semantics: a published match the run did not SELECT is never absent', () => {
      // CD_M3 is SCHEDULED, so a CONCLUDED-only run never re-observes it; batch
      // semantics (last_batch_id <> this batch) would stamp it. The feed lists it.
      const plan = planAflApiAbsenceSweep(complete(), [spine('CD_M1'), spine('CD_M2'), spine('CD_M3')]);
      expect(plan).toEqual({
        applicable: true, scopeKey: 'season=2026',
        newlyAbsent: [], stillAbsent: [], reappeared: [], exceedsTolerance: false,
      });
    });

    it('one spine record missing from a complete feed is newly absent and exceeds tolerance 0', () => {
      const plan = planAflApiAbsenceSweep(complete(), [spine('CD_M1'), spine('CD_M_OLD')]);
      expect(plan.newlyAbsent).toEqual(['CD_M_OLD']);
      expect(plan.exceedsTolerance).toBe(true);
    });

    it('an already-stamped record still missing is not NEW, so it alone does not exceed', () => {
      const plan = planAflApiAbsenceSweep(complete(), [spine('CD_M_OLD', '2026-09-20T00:00:00Z')]);
      expect(plan.newlyAbsent).toEqual([]);
      expect(plan.stillAbsent).toEqual(['CD_M_OLD']);
      expect(plan.exceedsTolerance).toBe(false);
    });

    it('D-231-2: a stamped record listed again by the complete feed reappears, selected or not', () => {
      const plan = planAflApiAbsenceSweep(complete(), [
        spine('CD_M1', '2026-09-20T00:00:00Z'), // CONCLUDED, would be re-observed anyway
        spine('CD_M3', '2026-09-20T00:00:00Z'), // SCHEDULED, never selected by the nightly run
      ]);
      expect(plan.reappeared).toEqual(['CD_M1', 'CD_M3']);
      expect(plan.newlyAbsent).toEqual([]);
    });

    it('an incomplete feed decides nothing: no absence, no reappearance', () => {
      const partial = assessAflApiSeasonEnumeration(feed(THREE, 216), EXPECTED);
      const plan = planAflApiAbsenceSweep(partial, [spine('CD_M_OLD'), spine('CD_M1', '2026-09-20T00:00:00Z')]);
      expect(plan).toEqual({
        applicable: false, scopeKey: 'season=2026',
        newlyAbsent: [], stillAbsent: [], reappeared: [], exceedsTolerance: false,
      });
      expect(planAflApiAbsenceSweep(missingAflApiSeasonEnumeration(2026, 'CD_S2026014'), [spine('X')]).applicable)
        .toBe(false);
    });

    it('the rekey case IS a disappearance: old id absent, new id present, so tolerance 0 is exceeded', () => {
      // Recorded for D-231-1: a retired-identity rekey (CD_M_OLD -> CD_M1 on
      // the same fixture) always begins with the old id leaving a complete feed.
      const plan = planAflApiAbsenceSweep(complete(), [spine('CD_M_OLD')]);
      expect(plan.exceedsTolerance).toBe(true);
      expect(aflApiMatchRekeyScope(complete()).publishedRecordIds).not.toContain('CD_M_OLD');
    });
  });

  describe('the code_test_db rekey rehearsal fixtures (tools/db/afl-api-season-rekey-rehearsal.ts), DB-free', () => {
    it('every rehearsal unit builds with no failure, on its own id, date and H&A round', () => {
      for (const spec of Object.values(REKEY_CASES)) {
        const bundle = rekeyRehearsalBundle('guard', [rekeyRehearsalUnitSource(spec)]);
        expect(bundle.buildFailures).toEqual([]);
        expect(bundle.units[0].bundle.match.sourceRecordId).toBe(spec.providerId);
        expect(bundle.units[0].bundle.localMatchDateTime?.matchDate).toBe(spec.date);
      }
    });

    it('the rehearsal feed is the authentic envelope made complete, listing the incoming id and never an old one', () => {
      const feed = rekeyRehearsalSeasonFeed([rekeyRehearsalUnitSource(REKEY_CASES.new)]);
      expect(feed.complete).toBe(true);
      expect(feed.providerMatchIds).toHaveLength(219);
      const scope = aflApiMatchRekeyScope(feed);
      expect(scope.publishedRecordIds).toContain(REKEY_CASES.new.providerId);
      expect(scope.publishedRecordIds).not.toContain(REKEY_CASES.old.providerId);
      expect(scope.publishedRecordIds).not.toContain(REKEY_CASES.ambiguousA.providerId);
      expect(scope.publishedRecordIds).not.toContain(REKEY_CASES.ambiguousB.providerId);
      // And the bundle accepts it (every acquired unit is listed).
      expect(() => rekeyRehearsalBundle('guard', [rekeyRehearsalUnitSource(REKEY_CASES.new)], feed)).not.toThrow();
    });

    it('S3 geometry: the incoming record differs from each candidate in exactly one of round/date, the candidates in both', () => {
      const { ambiguousA: a, ambiguousB: b, ambiguousNew: n } = REKEY_CASES;
      const differs = (x: { date: string; apiRound: number }, y: { date: string; apiRound: number }) =>
        Number(x.date !== y.date) + Number(x.apiRound !== y.apiRound);
      expect(differs(n, a)).toBe(1);
      expect(differs(n, b)).toBe(1);
      expect(differs(a, b)).toBe(2);
      expect(differs(REKEY_CASES.new, REKEY_CASES.old)).toBe(1);
    });

    it('savepointSql routes the settle\'s begin() into a savepoint of the outer transaction', async () => {
      const calls: string[] = [];
      const outer = { savepoint: async (fn: (tx: unknown) => unknown) => { calls.push('savepoint'); return fn('tx'); } };
      const result = await savepointSql(outer as never).begin(async (tx) => { calls.push(String(tx)); return 7; });
      expect(result).toBe(7);
      expect(calls).toEqual(['savepoint', 'tx']);
    });
  });

  it('describes the feed in one operator line: size, verdict and the observed statuses', () => {
    expect(describeAflApiSeasonEnumeration(assessAflApiSeasonEnumeration(feed(THREE), EXPECTED)))
      .toBe('Season feed CD_S2026014: 3 match(es), complete; statuses observed: CONCLUDED 2, SCHEDULED 1.');
    expect(describeAflApiSeasonEnumeration(assessAflApiSeasonEnumeration(feed(THREE, 9), EXPECTED)))
      .toContain('INCOMPLETE (pagination_mismatch)');
  });

  describe('snapshot reading', () => {
    let dir: string | null = null;
    afterEach(() => {
      if (dir !== null) rmSync(dir, { recursive: true, force: true });
      dir = null;
    });

    it('reads the feed only when the manifest lists it', () => {
      dir = mkdtempSync(join(tmpdir(), 'afldb-issue231-'));
      writeFileSync(join(dir, AFL_API_SEASON_FEED_FILE), feed(THREE), 'utf8');
      expect(aflApiSeasonFeedTextFrom(dir, [])).toBeNull();
      expect(aflApiSeasonFeedTextFrom(dir, [{ file: AFL_API_SEASON_FEED_FILE, sha256: 'x' }])).toBe(feed(THREE));
    });
  });

  describe('buildAflApiSettleBundle carries it', () => {
    const source = {
      fixtureRaw: readFixture('01-fixture-result.json'),
      rosterRaw: readFixture('03-match-roster.raw.json'),
      playerStatsRaw: readFixture('02-player-stats.raw.json'),
    };
    const base = { season: 2026, snapshotLabel: 'issue231', sources: [source], registry, identities };

    it('defaults to an incomplete enumeration when the caller supplies no feed', () => {
      const bundle = buildAflApiSettleBundle(base);
      expect(bundle.units).toHaveLength(1);
      expect(bundle.seasonFeed.complete).toBe(false);
      expect(bundle.seasonFeed.compSeasonProviderId).toBe('CD_S2026014');
      expect(bundle.seasonFeed.gaps.map((gap) => gap.reason)).toEqual(['season_feed_not_in_snapshot']);
    });

    it('carries a supplied feed that lists every acquired match', () => {
      const seasonFeed = assessAflApiSeasonEnumeration(
        feed([entry('CD_M20260142801', 'CONCLUDED'), entry('CD_M20260142901', 'SCHEDULED')]), EXPECTED,
      );
      const bundle = buildAflApiSettleBundle({ ...base, seasonFeed });
      expect(bundle.seasonFeed).toBe(seasonFeed);
    });

    it('refuses a snapshot whose acquired match is missing from its own feed', () => {
      const seasonFeed = assessAflApiSeasonEnumeration(feed([entry('CD_M_OTHER', 'CONCLUDED')]), EXPECTED);
      expect(() => buildAflApiSettleBundle({ ...base, seasonFeed }))
        .toThrow(/CD_M20260142801' was acquired but is not listed/);
    });

    it('refuses a feed that describes a different season', () => {
      const seasonFeed = assessAflApiSeasonEnumeration(
        feed([entry('CD_M20260142801', 'CONCLUDED', 'CD_S2025014')]),
        { season: 2025, compSeasonProviderId: 'CD_S2025014' },
      );
      expect(() => buildAflApiSettleBundle({ ...base, seasonFeed })).toThrow(/describes season 2025/);
    });
  });
});

// ---------------------------------------------------------------------------
// AFLDB-ISSUE-231 D-231-3 — detect, refuse, durable finding, acknowledgement.
// DB-free here; the database lifecycle (S1–S10) is the rollback-only
// code_test_db rehearsal, tools/db/afl-api-season-rekey-rehearsal.ts.
// ---------------------------------------------------------------------------

describe('AFL API match absence, D-231-3 (AFLDB-ISSUE-231)', () => {
  const FEED_PATH = join(__dirname, 'fixtures', 'afl_api', 'seasons', '00-season-matches-2026.raw.json');
  const EXPECTED = { season: 2026, compSeasonProviderId: 'CD_S2026014' };
  const OLD = REKEY_CASES.old.providerId;
  const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
  const untouchable = () => ({
    begin: () => { throw new Error('the database was touched'); },
    end: async () => {},
  }) as unknown as postgres.Sql;
  const omitting = rekeyRehearsalSeasonFeedText([rekeyRehearsalUnitSource(REKEY_CASES.new)]);
  const listing = rekeyRehearsalSeasonFeedText([
    rekeyRehearsalUnitSource(REKEY_CASES.old), rekeyRehearsalUnitSource(REKEY_CASES.new),
  ]);
  const incomplete = rekeyRehearsalSeasonFeedText([rekeyRehearsalUnitSource(REKEY_CASES.new)], { incomplete: true });

  it('the enumeration binds the exact bytes it assessed: for the committed feed fixture, its recorded sha256', () => {
    expect(assessAflApiSeasonEnumeration(readFileSync(FEED_PATH, 'utf8'), EXPECTED).sourceSha256)
      .toBe('4f8235e08f438ee533b2d9c504b105b3bfce2449a807362dff10d074f7f1babb');
    expect(missingAflApiSeasonEnumeration(2026, 'CD_S2026014').sourceSha256).toBeNull();
  });

  it('one finding key per provider id, naming source, family, scope and id', () => {
    expect(aflApiMatchAbsenceIssueKey('season=2026', 'CD_M1')).toBe('afl_api|match|season=2026|CD_M1|absence');
    expect(aflApiMatchAbsenceIssueKey('season=2026', 'CD_M1')).not.toBe(aflApiMatchAbsenceIssueKey('season=2026', 'CD_M2'));
    expect(aflApiMatchAbsenceIssueKey('season=2026', 'CD_M1')).not.toBe(aflApiMatchAbsenceIssueKey('season=2025', 'CD_M1'));
    // Never the identity-refusal key for the same record (`afl_api|match|<id>|matches`).
    expect(aflApiMatchAbsenceIssueKey('season=2026', 'CD_M1')).not.toBe('afl_api|match|CD_M1|matches');
    expect(() => aflApiMatchAbsenceIssueKey('', 'CD_M1')).toThrow();
    expect(() => aflApiMatchAbsenceIssueKey('season=2026', '')).toThrow();
  });

  it('the absence HALT is an ordinary settle HALT that also carries what the sweep observed', () => {
    const enumeration = rekeyRehearsalEnumeration(omitting);
    const detection: AflApiMatchAbsenceDetection = {
      sourceId: 7, season: 2026, scopeKey: 'season=2026', compSeasonProviderId: 'CD_S2026014',
      snapshotLabel: 'label', seasonFeedSha256: enumeration.sourceSha256, seasonFeedMatches: 219,
      observedAt: '2026-09-26T00:00:00.000Z',
      plan: planAflApiAbsenceSweep(enumeration, [{ externalRecordId: OLD, absentSince: null }]),
    };
    const halt = new AflApiMatchAbsenceHalt(detection);
    expect(halt).toBeInstanceOf(AflApiSettleHalt);
    expect(halt.reason).toBe(AFL_API_MATCH_ABSENCE_HALT_REASON);
    expect(halt.detail).toMatchObject({ scopeKey: 'season=2026', newlyAbsent: [OLD], stillAbsent: [], tolerance: 0 });
    expect(halt.detection).toBe(detection);
  });

  it('actor decision (c): the acknowledgement names the PostgreSQL role as the database actor, never a person', () => {
    const record = aflApiMatchAbsenceAcknowledgementRecord({
      databaseActor: 'afldb_import', database: 'code_test_db', findingId: '41',
      issueKey: aflApiMatchAbsenceIssueKey('season=2026', OLD), season: 2026, externalRecordId: OLD,
      snapshotLabel: 'snap', seasonFeedSha256: 'f'.repeat(64), seasonFeedMatches: 219,
      firstDetectedAt: '2026-09-26T00:00:00.000Z',
    });
    expect(record).toEqual({
      database_actor: 'afldb_import',
      database_actor_kind: 'postgresql_role',
      actor_note: 'database actor is operational attribution, not authenticated human identity',
      database: 'code_test_db',
      tool: 'acknowledge-afl-api-match-absence.ts',
      finding_id: '41',
      issue_key: `afl_api|match|season=2026|${OLD}|absence`,
      season: 2026,
      external_record_id: OLD,
      proved_by_snapshot_label: 'snap',
      proved_by_season_feed_sha256: 'f'.repeat(64),
      proved_by_season_feed_matches: 219,
      first_detected_at: '2026-09-26T00:00:00.000Z',
      absent_since: '2026-09-26T00:00:00.000Z',
      resolution: 'source_absence_acknowledged',
    });
    expect(AFL_API_MATCH_ABSENCE_ACTOR_NOTE).toBe('database actor is operational attribution, not authenticated human identity');
    // No human-name field of any spelling, and the CLI has no flag that could supply one.
    expect(Object.keys(record).filter((key) => /operator|user|human|name/.test(key))).toEqual([]);
    expect(() => parseAcknowledgeAbsenceArgs([
      '--label', 'snap', '--season', '2026', '--external-record-id', OLD, '--finding-id', '41', '--operator', 'x',
    ])).toThrow(/Unknown argument '--operator'/);
  });

  it('an incomplete enumeration sweeps nothing and never reaches the database', async () => {
    const tx = (() => { throw new Error('the database was touched'); }) as unknown as postgres.TransactionSql;
    for (const enumeration of [missingAflApiSeasonEnumeration(2026, 'CD_S2026014'), rekeyRehearsalEnumeration(incomplete)]) {
      expect(enumeration.complete).toBe(false);
      await expect(sweepAflApiMatchAbsence(tx, {
        sourceId: 7, enumeration, snapshotLabel: 'label', observedAt: '2026-09-26T00:00:00.000Z',
      })).resolves.toEqual({ kind: 'not_applicable' });
    }
  });

  it('the rehearsal feed variants: complete-omitting, complete-listing and incomplete (pagination_mismatch)', () => {
    expect(rekeyRehearsalEnumeration(omitting).complete).toBe(true);
    expect(rekeyRehearsalEnumeration(omitting).providerMatchIds).not.toContain(OLD);
    expect(rekeyRehearsalEnumeration(listing).complete).toBe(true);
    expect(rekeyRehearsalEnumeration(listing).providerMatchIds).toContain(OLD);
    expect(rekeyRehearsalEnumeration(incomplete).gaps.map((gap) => gap.reason)).toEqual(['pagination_mismatch']);
    // The pass-2 helper is unchanged: the complete feed listing the incoming records.
    expect(rekeyRehearsalSeasonFeed([rekeyRehearsalUnitSource(REKEY_CASES.new)]).providerMatchIds)
      .toEqual(rekeyRehearsalEnumeration(omitting).providerMatchIds);
  });

  describe('the acknowledgement proof, before any connection', () => {
    const base = { ...EXPECTED, externalRecordId: OLD };

    it('accepts a complete, verified feed that still omits the id', () => {
      const enumeration = proveAflApiMatchAbsenceFeed({ ...base, seasonFeedText: omitting, seasonFeedSha256: sha(omitting) });
      expect(enumeration.complete).toBe(true);
    });

    it('refuses a complete feed that lists the id again: a stale finding is never enough', () => {
      expect(() => proveAflApiMatchAbsenceFeed({ ...base, seasonFeedText: listing, seasonFeedSha256: sha(listing) }))
        .toThrow(AflApiMatchAbsenceAckRefused);
      expect(() => proveAflApiMatchAbsenceFeed({ ...base, seasonFeedText: listing, seasonFeedSha256: sha(listing) }))
        .toThrow(/lists 'CD_M2026231ROLD' again/);
    });

    it('refuses an incomplete feed, which proves nothing about absence', () => {
      expect(() => proveAflApiMatchAbsenceFeed({ ...base, seasonFeedText: incomplete, seasonFeedSha256: sha(incomplete) }))
        .toThrow(/not complete \(pagination_mismatch\)/);
    });

    it('refuses text that is not the manifest-verified bytes', () => {
      expect(() => proveAflApiMatchAbsenceFeed({ ...base, seasonFeedText: omitting, seasonFeedSha256: sha(listing) }))
        .toThrow(/hashes to/);
    });

    it('validate-only proves the feed before touching the database; a valid proof then reaches it', async () => {
      const input = {
        ...base, findingId: '41', snapshotLabel: 'label', apply: false, acknowledgeDatabase: null,
      };
      await expect(acknowledgeAflApiMatchAbsence(untouchable(), {
        ...input, seasonFeedText: listing, seasonFeedSha256: sha(listing),
      })).rejects.toThrow(AflApiMatchAbsenceAckRefused);
      await expect(acknowledgeAflApiMatchAbsence(untouchable(), {
        ...input, findingId: 'all', seasonFeedText: omitting, seasonFeedSha256: sha(omitting),
      })).rejects.toThrow(/is not a data_issues id/);
      await expect(acknowledgeAflApiMatchAbsence(untouchable(), {
        ...input, seasonFeedText: omitting, seasonFeedSha256: sha(omitting),
      })).rejects.toThrow(/the database was touched/);
    });
  });

  describe('the acknowledgement CLI (tools/current-season/acknowledge-afl-api-match-absence.ts)', () => {
    const required = ['--label', 'snap', '--season', '2026', '--external-record-id', OLD, '--finding-id', '41'];

    it('is validate-only by default', () => {
      expect(parseAcknowledgeAbsenceArgs(required)).toEqual({
        label: 'snap', season: 2026, externalRecordId: OLD, findingId: '41', apply: false, acknowledgeDatabase: null,
      });
      expect(parseAcknowledgeAbsenceArgs([...required, '--validate-only']).apply).toBe(false);
    });

    it('applies only with --acknowledge naming a database, and --acknowledge only with --apply', () => {
      expect(() => parseAcknowledgeAbsenceArgs([...required, '--apply'])).toThrow(/--apply requires --acknowledge/);
      expect(() => parseAcknowledgeAbsenceArgs([...required, '--acknowledge', 'afldb_dev'])).toThrow(/only accompanies --apply/);
      expect(() => parseAcknowledgeAbsenceArgs([...required, '--apply', '--validate-only', '--acknowledge', 'x']))
        .toThrow(/mutually exclusive/);
      expect(parseAcknowledgeAbsenceArgs([...required, '--apply', '--acknowledge', 'afldb_dev']))
        .toMatchObject({ apply: true, acknowledgeDatabase: 'afldb_dev' });
    });

    it('names exactly one finding: every identifying flag is required and there is no blanket mode', () => {
      for (let i = 0; i < required.length; i += 2) {
        const without = [...required.slice(0, i), ...required.slice(i + 2)];
        expect(() => parseAcknowledgeAbsenceArgs(without)).toThrow();
      }
      expect(() => parseAcknowledgeAbsenceArgs([...required, '--all'])).toThrow(/Unknown argument '--all'/);
      expect(() => parseAcknowledgeAbsenceArgs([...required, '--finding-id', '42'])).toThrow(/more than once/);
      expect(() => parseAcknowledgeAbsenceArgs(['--label', 'snap', '--season', '2026', '--external-record-id', 'X1', '--finding-id', '41']))
        .toThrow(/not an AFL API match provider id/);
      expect(() => parseAcknowledgeAbsenceArgs(['--label', 'snap', '--season', '2026', '--external-record-id', OLD, '--finding-id', '0']))
        .toThrow(/not a data_issues id/);
    });

    describe('against a retained snapshot', () => {
      let root: string | null = null;
      afterEach(() => {
        if (root !== null) rmSync(root, { recursive: true, force: true });
        root = null;
      });

      function snapshot(feedText: string | null, season = 2026): string {
        root = mkdtempSync(join(tmpdir(), 'afldb-issue231-ack-'));
        mkdirSync(join(root, 'data', 'reference'), { recursive: true });
        writeFileSync(join(root, 'data', 'reference', 'afl-api-identities.json'),
          readFileSync(join(__dirname, '..', 'data', 'reference', 'afl-api-identities.json')));
        const dir = join(root, 'data', 'sources', 'afl_api', 'matches', 'snap');
        mkdirSync(dir, { recursive: true });
        const files: { file: string; sha256: string }[] = [];
        if (feedText !== null) {
          writeFileSync(join(dir, AFL_API_SEASON_FEED_FILE), feedText, 'utf8');
          files.push({ file: AFL_API_SEASON_FEED_FILE, sha256: sha(feedText) });
        }
        writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ source_key: 'afl_api', season, files }), 'utf8');
        return root;
      }
      const run = (projectRoot: string, argv: readonly string[] = required) =>
        runAcknowledgeAflApiMatchAbsence(argv, { projectRoot, sql: untouchable(), log: () => {} });

      it('refuses, before any connection, a snapshot whose complete feed lists the id again', async () => {
        await expect(run(snapshot(listing))).rejects.toThrow(/lists 'CD_M2026231ROLD' again/);
      });

      it('refuses a snapshot of another season, or one that retained no feed', async () => {
        await expect(run(snapshot(omitting, 2025))).rejects.toThrow(/is season 2025, not 2026/);
        await expect(run(snapshot(null))).rejects.toThrow(/retained no 00-season-matches.json/);
      });

      it('refuses a feed edited after acquisition (manifest re-hash)', async () => {
        const projectRoot = snapshot(omitting);
        writeFileSync(join(projectRoot, 'data', 'sources', 'afl_api', 'matches', 'snap', AFL_API_SEASON_FEED_FILE), listing, 'utf8');
        await expect(run(projectRoot)).rejects.toThrow(/sha256 mismatch/);
      });

      it('a complete feed that still omits the id is proven offline and only then reaches the database', async () => {
        await expect(run(snapshot(omitting))).rejects.toThrow(/the database was touched/);
      });
    });
  });
});

describe('AFL API season discovery (AFLDB-ISSUE-233, D-233-1 proposal-only)', () => {
  const projectRoot = join(__dirname, '..');
  const RAW_PATH = join(projectRoot, 'tests', 'fixtures', 'afl_api', 'seasons', '00-compseasons.raw.json');
  const RAW_SHA256 = 'fe3f164160e37e0ce5b70ff3f379dc41ce234f2efad6e7f481c1b7443111d965';
  const rawText = () => readFileSync(RAW_PATH, 'utf8');
  const registered = parseAflApiIdentities(
    JSON.parse(readFileSync(join(projectRoot, 'data', 'reference', 'afl-api-identities.json'), 'utf8')),
  ).seasons;
  const source = { file: 'tests/fixtures/afl_api/seasons/00-compseasons.raw.json', sha256: RAW_SHA256 };
  const REGISTERED = [2022, 2023, 2024, 2025, 2026];
  const HISTORICAL = [2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021];

  /** SYNTHETIC: the real response plus one fabricated future season. Test data only. */
  function withFuture(entry: Record<string, unknown>, numEntries = 16): string {
    const parsed = JSON.parse(rawText()) as { meta: { pagination: Record<string, unknown> }; compSeasons: unknown[] };
    parsed.compSeasons.unshift(entry);
    parsed.meta.pagination.numEntries = numEntries;
    return JSON.stringify(parsed);
  }
  const FUTURE_2027 = {
    id: 9999, providerId: 'CD_S2027014', name: '2027 Toyota AFL Premiership', shortName: 'Premiership', currentRoundNumber: 0,
  };

  it('the fixture is the recorded authentic bytes (hash-bound)', () => {
    expect(createHash('sha256').update(readFileSync(RAW_PATH)).digest('hex')).toBe(RAW_SHA256);
  });

  it('requests exactly what the sample recorded: competitions/1/compseasons?pageSize=100 on the public base', () => {
    const plan = planAflApiCompSeasonsRequest(DEFAULT_AFL_API_BASES, {});
    expect(plan.url).toBe('https://aflapi.afl.com.au/afl/v2/competitions/1/compseasons?pageSize=100');
    expect(plan.method).toBe('GET');
    expect(plan.headers).not.toHaveProperty('x-media-mis-token');
  });

  it('reads the measured envelope: 15 seasons, complete from meta.pagination', () => {
    const listing = parseAflApiCompSeasons(rawText());
    expect(listing.complete).toBe(true);
    expect(listing.gaps).toEqual([]);
    expect(listing.numEntries).toBe(15);
    expect(listing.entries[0]).toEqual({ id: 85, providerId: 'CD_S2026014', name: '2026 Toyota AFL Premiership', currentRoundNumber: 28 });
  });

  it('against today\'s registry the real response proposes nothing and confirms 2022–2026', () => {
    const proposal = proposeAflApiSeasons({ listing: parseAflApiCompSeasons(rawText()), registered, source });
    expect(proposal.verdict).toBe('no_change');
    expect(proposal.proposals).toEqual([]);
    expect(proposal.identitiesSeasonsAdditions).toEqual({});
    expect(proposal.confirmedRegistered).toEqual(REGISTERED);
    expect(proposal.historicalUnregistered).toEqual(HISTORICAL);
    expect(proposal.findings).toEqual([]);
  });

  it('a newer unregistered season is proposed, with the exact identities entry a reviewer would add', () => {
    const proposal = proposeAflApiSeasons({ listing: parseAflApiCompSeasons(withFuture(FUTURE_2027)), registered, source });
    expect(proposal.verdict).toBe('proposals');
    expect(proposal.proposals).toEqual([{
      year: 2027, compSeasonId: 9999, providerId: 'CD_S2027014', name: '2027 Toyota AFL Premiership', currentRoundNumber: 0,
    }]);
    expect(proposal.identitiesSeasonsAdditions).toEqual({ 2027: { compSeasonId: 9999, providerId: 'CD_S2027014' } });
  });

  it('a registered season the provider disagrees with is a finding, never rewritten, and blocks every proposal', () => {
    const drifted = new Map<number, RegisteredAflApiSeason>(registered);
    drifted.set(2026, { compSeasonId: 86, providerId: 'CD_S2026014' });
    const proposal = proposeAflApiSeasons({ listing: parseAflApiCompSeasons(withFuture(FUTURE_2027)), registered: drifted, source });
    expect(proposal.verdict).toBe('refused');
    expect(proposal.proposals).toEqual([]);
    expect(proposal.identitiesSeasonsAdditions).toEqual({});
    expect(proposal.findings.map((f) => [f.kind, f.year])).toEqual([['registered_mismatch', 2026]]);
    expect(proposal.findings[0].detail).toContain('Not rewritten');
  });

  it('refuses an entry whose providerId and name disagree on the year, or that fits neither pattern', () => {
    const disagree = proposeAflApiSeasons({
      listing: parseAflApiCompSeasons(withFuture({ ...FUTURE_2027, name: '2028 Toyota AFL Premiership' })),
      registered, source,
    });
    expect(disagree.verdict).toBe('refused');
    expect(disagree.findings.map((f) => f.kind)).toEqual(['year_disagreement']);

    const foreign = proposeAflApiSeasons({
      listing: parseAflApiCompSeasons(withFuture({ ...FUTURE_2027, providerId: 'CD_S2027264', name: '2027 AFLW Season' })),
      registered, source,
    });
    expect(foreign.findings.map((f) => f.kind)).toEqual(['unrecognised_entry']);
  });

  it('refuses a listing that does not prove itself complete', () => {
    const proposal = proposeAflApiSeasons({
      listing: parseAflApiCompSeasons(withFuture(FUTURE_2027, 40)), registered, source,
    });
    expect(proposal.listing.complete).toBe(false);
    expect(proposal.verdict).toBe('refused');
    expect(proposal.proposals).toEqual([]);
    expect(proposal.findings.map((f) => f.kind)).toEqual(['listing_incomplete']);
  });

  it('reports a registered season missing from the listing, and an unregistered gap inside the registered range', () => {
    const withGap = new Map<number, RegisteredAflApiSeason>(registered);
    withGap.delete(2024);
    withGap.set(2011, { compSeasonId: 1, providerId: 'CD_S2011014' });
    const proposal = proposeAflApiSeasons({ listing: parseAflApiCompSeasons(rawText()), registered: withGap, source });
    expect(proposal.verdict).toBe('refused');
    expect(proposal.findings.map((f) => [f.kind, f.year])).toEqual([
      ['registered_absent_from_listing', 2011],
      ['unregistered_within_registered_range', 2012],
      ['unregistered_within_registered_range', 2013],
      ['unregistered_within_registered_range', 2014],
      ['unregistered_within_registered_range', 2015],
      ['unregistered_within_registered_range', 2016],
      ['unregistered_within_registered_range', 2017],
      ['unregistered_within_registered_range', 2018],
      ['unregistered_within_registered_range', 2019],
      ['unregistered_within_registered_range', 2020],
      ['unregistered_within_registered_range', 2021],
      ['unregistered_within_registered_range', 2024],
    ]);
  });

  it('is deterministic: the same input serialises to the same bytes, with no clock in it', () => {
    const once = serialiseAflApiSeasonDiscoveryProposal(
      proposeAflApiSeasons({ listing: parseAflApiCompSeasons(withFuture(FUTURE_2027)), registered, source }),
    );
    const twice = serialiseAflApiSeasonDiscoveryProposal(
      proposeAflApiSeasons({ listing: parseAflApiCompSeasons(withFuture(FUTURE_2027)), registered, source }),
    );
    expect(twice).toBe(once);
    expect(once.endsWith('}\n')).toBe(true);
    expect(once).not.toMatch(/generated|_at"|timestamp/i);
  });

  it('throws on a malformed envelope rather than reading half of it', () => {
    expect(() => parseAflApiCompSeasons('{"meta":{}}')).toThrow(/no 'compSeasons' array/);
    expect(() => parseAflApiCompSeasons('{"compSeasons":[{"id":"85","providerId":"x","name":"y"}]}')).toThrow(/integer id/);
  });

  describe('the CLI', () => {
    let dir: string | null = null;
    afterEach(() => {
      if (dir !== null) rmSync(dir, { recursive: true, force: true });
      dir = null;
    });
    const noFetch: FetchLike = async () => { throw new Error('network must not be touched'); };

    it('parses exactly one source and requires --output (and --save-raw with --fetch)', () => {
      expect(parseDiscoverAflApiSeasonsArgs(['--input', 'a.json', '--output', 'p.json']))
        .toEqual({ source: 'input', input: 'a.json', output: 'p.json' });
      expect(parseDiscoverAflApiSeasonsArgs(['--fetch', '--save-raw', 'r.json', '--output', 'p.json']))
        .toEqual({ source: 'fetch', saveRaw: 'r.json', output: 'p.json' });
      expect(() => parseDiscoverAflApiSeasonsArgs(['--input', 'a.json'])).toThrow(/--output/);
      expect(() => parseDiscoverAflApiSeasonsArgs(['--output', 'p.json'])).toThrow(/Exactly one/);
      expect(() => parseDiscoverAflApiSeasonsArgs(['--fetch', '--input', 'a', '--output', 'p'])).toThrow(/Exactly one/);
      expect(() => parseDiscoverAflApiSeasonsArgs(['--fetch', '--output', 'p.json'])).toThrow(/--save-raw/);
      expect(() => parseDiscoverAflApiSeasonsArgs(['--input', 'a', '--output', 'p', '--apply'])).toThrow(/Unknown/);
    });

    it('--input writes the proposal and a summary, touches no network and no reference data', async () => {
      dir = mkdtempSync(join(tmpdir(), 'afldb-issue233-'));
      const output = join(dir, 'proposal.json');
      const identitiesBefore = readFileSync(join(projectRoot, 'data', 'reference', 'afl-api-identities.json'));
      const lines: string[] = [];
      const proposal = await runDiscoverAflApiSeasons(
        ['--input', RAW_PATH, '--output', output],
        { log: (line) => lines.push(line), fetchImpl: noFetch },
      );
      expect(proposal.verdict).toBe('no_change');
      expect(proposal.input).toEqual(source);
      expect(readFileSync(output, 'utf8')).toBe(serialiseAflApiSeasonDiscoveryProposal(proposal));
      expect(lines.join('\n')).toContain('verdict: NO_CHANGE. Nothing was written to data/reference/.');
      expect(readFileSync(join(projectRoot, 'data', 'reference', 'afl-api-identities.json'))).toEqual(identitiesBefore);
      // Never overwrites a reviewed proposal.
      await expect(runDiscoverAflApiSeasons(['--input', RAW_PATH, '--output', output], { log: () => {} }))
        .rejects.toThrow(/already exists/);
    });

    it('--fetch refuses before any request when the ingestion switch is off', async () => {
      dir = mkdtempSync(join(tmpdir(), 'afldb-issue233-'));
      await expect(runDiscoverAflApiSeasons(
        ['--fetch', '--save-raw', join(dir, 'raw.json'), '--output', join(dir, 'p.json')],
        {
          log: () => {}, fetchImpl: noFetch,
          ingestionControls: { ...ENABLED_INGESTION_CONTROLS, currentSeasonEnabled: false },
        },
      )).rejects.toThrow(/ingestion is disabled/);
      expect(existsSync(join(dir, 'raw.json'))).toBe(false);
      expect(existsSync(join(dir, 'p.json'))).toBe(false);
    });

    it('--fetch retains the raw bytes verbatim and binds the proposal to their sha256', async () => {
      dir = mkdtempSync(join(tmpdir(), 'afldb-issue233-'));
      const body = rawText();
      const fetchImpl: FetchLike = async (url) => {
        expect(String(url)).toBe('https://aflapi.afl.com.au/afl/v2/competitions/1/compseasons?pageSize=100');
        return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
      };
      const rawPath = join(dir, 'seasons', '00-compseasons.raw.json');
      const proposal = await runDiscoverAflApiSeasons(
        ['--fetch', '--save-raw', rawPath, '--output', join(dir, 'p.json')],
        { log: () => {}, fetchImpl, ingestionControls: ENABLED_INGESTION_CONTROLS },
      );
      expect(readFileSync(rawPath, 'utf8')).toBe(body);
      expect(proposal.input.sha256).toBe(RAW_SHA256);
      expect(proposal.verdict).toBe('no_change');
    });
  });
});
