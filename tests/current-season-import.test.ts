import { afterEach, describe, expect, it, vi } from 'vitest';

import { readFileSync } from 'node:fs';

import { fetchSquiggleCurrentMatches } from '@/lib/external-afl/current-matches';

const tool = readFileSync('tools/current-season/update-current-season.ts', 'utf8');
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
    expect(tool).toContain('INSERT INTO staging.external_current_matches');
    expect(tool.indexOf('INSERT INTO staging.external_current_matches'))
      .toBeLessThan(tool.indexOf('UPDATE matches'));
  });

  it('only applies final-score updates when explicitly requested', () => {
    expect(tool).toContain("argv.includes('--update-matches')");
    expect(tool).toContain('if (!updateMatches || localMatchId === null || match.completePercent !== 100) continue;');
  });

  it('records source and import-batch provenance on local score updates', () => {
    expect(tool).toContain('source_id = ${sourceId}');
    expect(tool).toContain('source_record_id = ${match.externalGameId}');
    expect(tool).toContain('import_batch_id = ${batch.id}');
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
});
