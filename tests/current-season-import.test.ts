import { afterEach, describe, expect, it, vi } from 'vitest';

import { readFileSync } from 'node:fs';

import { fetchKaliCurrentMatches, fetchSquiggleCurrentMatches } from '@/lib/external-afl/current-matches';

const tool = readFileSync('tools/current-season/update-current-season.ts', 'utf8');
const importer = readFileSync('src/lib/external-afl/current-season-import.ts', 'utf8');
const adminAction = readFileSync('src/app/admin/current-season/actions.ts', 'utf8');
const adminPage = readFileSync('src/app/admin/current-season/page.tsx', 'utf8');
const adminNav = readFileSync('src/app/admin/nav-model.ts', 'utf8');
const migration = readFileSync('src/db/migrations/063_external_current_match_sources.sql', 'utf8');
const client = readFileSync('src/lib/external-afl/current-matches.ts', 'utf8');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('current-season external source import contracts', () => {
  it('keeps Kali credentials in environment variables only', () => {
    expect(client).toContain('process.env.KALI_AFL_API_KEY');
    expect(client).toContain('Authorization: `Bearer ${apiKey}`');
    expect(client).not.toMatch(/YOUR_API_KEY|sk-[A-Za-z0-9]/);
  });

  it('uses a configured User-Agent for Squiggle rather than browser-side fetches', () => {
    expect(client).toContain('AFLDB_EXTERNAL_API_USER_AGENT');
    expect(client).toContain("'User-Agent': userAgent()");
    expect(tool).not.toContain('window.');
  });

  it('stages external payloads before updating local matches', () => {
    expect(migration).toContain('CREATE TABLE staging.external_current_matches');
    expect(migration).toContain('raw_payload        jsonb        NOT NULL');
    expect(importer).toContain('INSERT INTO staging.external_current_matches');
    expect(importer.indexOf('INSERT INTO staging.external_current_matches'))
      .toBeLessThan(importer.indexOf('UPDATE matches'));
  });

  it('only applies final-score updates when explicitly requested', () => {
    expect(tool).toContain("argv.includes('--update-matches')");
    expect(importer).toContain('if (!updateMatches || localMatchId === null || match.completePercent !== 100) continue;');
  });

  it('accounts for AFLDB counting Opening Round as round 1 from 2024 onward', () => {
    expect(importer).toContain('match.roundNumber + 1');
    expect(importer).toContain('round_code = ANY(${codes})');
  });

  it('normalises external current-season club names before local club resolution', () => {
    expect(importer).toContain('EXTERNAL_CLUB_NAME_ALIASES');
    expect(importer).toContain("['brisbane', 'Brisbane Lions']");
    expect(importer).toContain('localClubNameCandidate(raw)');
  });

  it('can report staged resolution counts without fetching or mutating source rows', () => {
    expect(tool).toContain("argv.includes('--report')");
    expect(tool).toContain('Staged external current-match rows for ${args.year}:');
  });

  it('inserts missing completed matches only behind an explicit flag', () => {
    expect(tool).toContain("argv.includes('--insert-missing-matches')");
    expect(importer).toContain('INSERT INTO matches');
    expect(importer).toContain("match.completePercent !== 100 || match.matchDate === null");
  });

  it('records source and import-batch provenance on local score updates', () => {
    expect(importer).toContain('source_id = ${sourceId}');
    expect(importer).toContain('source_record_id = ${match.externalGameId}');
    expect(importer).toContain('import_batch_id = ${batch.id}');
  });

  it('exposes the refresh only through a super-admin server action', () => {
    expect(adminAction).toContain("'use server'");
    expect(adminAction).toContain('requireSuperAdmin()');
    expect(adminAction).toContain('runCurrentSeasonRefresh');
    expect(adminPage).toContain('requireSuperAdmin()');
    expect(adminNav).toContain("href: '/admin/current-season'");
  });

  it('keeps the admin auto path server-side and non-destructive by default', () => {
    expect(adminAction).toContain("mode === 'auto'");
    expect(adminAction).toContain("? ['kali'] as const");
    expect(adminAction).toContain("const updateMatches = mode !== 'auto'");
    expect(adminPage).toContain('Existing final scores are left alone');
  });

  it('adds provenance columns to matches in a forward-only migration', () => {
    const provenance = readFileSync('src/db/migrations/064_matches_external_provenance.sql', 'utf8');
    expect(provenance).toContain("SELECT add_provenance_columns('matches')");
  });

  it('maps Squiggle numeric team ids through the teams response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      const payload = url.includes('q=teams')
        ? { teams: [{ id: 10, name: 'Richmond' }, { id: 7, name: 'Geelong' }] }
        : { games: [{ id: 1, year: 2026, round: 1, hteam: 10, ateam: 7, hscore: 90, ascore: 72, complete: 100 }] };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const rows = await fetchSquiggleCurrentMatches(2026);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(rows[0]).toMatchObject({
      homeTeamRaw: 'Richmond',
      awayTeamRaw: 'Geelong',
      homeScore: 90,
      awayScore: 72,
    });
  });

  it('infers Kali completion from scored non-future matches when no complete field exists', async () => {
    vi.stubEnv('KALI_AFL_API_KEY', 'test-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{
        matchId: 1,
        year: 2026,
        round: 23,
        date: 'Friday, 14th August 2026',
        homeTeamName: 'Fremantle',
        awayTeamName: 'Adelaide',
        homeScore: 108,
        awayScore: 100,
      }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const rows = await fetchKaliCurrentMatches(2026);

    expect(rows[0]).toMatchObject({
      completePercent: 100,
      homeScore: 108,
      awayScore: 100,
    });
  });
});
