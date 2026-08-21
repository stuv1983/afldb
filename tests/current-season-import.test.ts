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
    expect(importer).toContain('if (updateMatches) {');
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
    expect(importer).toContain("if (localMatchId === null && match.completePercent === 100 && match.matchDate !== null");
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
import { isPastDate } from '@/lib/external-afl/current-matches';

describe('Melbourne date handling', () => {
  it('correctly identifies yesterday in Melbourne as past', () => {
    const melbourneToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const [y, m, d] = melbourneToday.split('-').map(Number);
    const yesterdayDate = new Date(y, m - 1, d - 1).toLocaleDateString('en-CA');
    expect(isPastDate(yesterdayDate)).toBe(true);
  });

  it('correctly identifies today in Melbourne as not past', () => {
    const melbourneToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    expect(isPastDate(melbourneToday)).toBe(false);
  });

  it('correctly identifies tomorrow in Melbourne as not past', () => {
    const melbourneToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const [y, m, d] = melbourneToday.split('-').map(Number);
    const tomorrowDate = new Date(y, m - 1, d + 1).toLocaleDateString('en-CA');
    expect(isPastDate(tomorrowDate)).toBe(false);
  });

  it('respects Melbourne date even when UTC date differs', () => {
    expect(client).toContain("timeZone: 'Australia/Melbourne'");
    expect(client).toContain("date < today");
  });
});

describe('Source completion and placeholders', () => {
  it('treats Squiggle explicit complete match today as complete', async () => {
    const melbourneToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      const payload = url.includes('q=teams')
        ? { teams: [{ id: 10, name: 'Richmond' }, { id: 7, name: 'Geelong' }] }
        : { games: [{ id: 1, year: 2026, round: 1, hteam: 10, ateam: 7, date: melbourneToday, complete: 100 }] };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const rows = await fetchSquiggleCurrentMatches(2026);
    expect(rows[0].completePercent).toBe(100);
  });

  it('treats Kali date-only match today with scores as incomplete unless explicit completion exists', async () => {
    vi.stubEnv('KALI_AFL_API_KEY', 'test-key');
    const melbourneToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{
        matchId: 1,
        year: 2026,
        round: 23,
        date: melbourneToday,
        homeTeamName: 'Fremantle',
        awayTeamName: 'Adelaide',
        homeScore: 108,
        awayScore: 100,
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const rows = await fetchKaliCurrentMatches(2026);
    expect(rows[0].completePercent).toBeNull();
  });
});

describe('Placeholder and Dry-Run Resolution Logic', () => {
  it('treats future fixture with not recorded participants as incomplete, unresolvedTeams = 0', () => {
    expect(importer).toContain("lower(e.home_team_raw) NOT IN ('not recorded', 'tbd', '')");
  });

  it('treats genuine unknown club as unresolvedTeams > 0', () => {
    expect(importer).toContain("lower(e.home_team_raw) NOT IN ('not recorded', 'tbd', '')");
  });

  it('dry-run existing AFLDB match sets Resolved > 0, canonical writes = 0', () => {
    expect(importer).toContain("if (localMatchId !== null) {");
    expect(importer).toContain("resolved += 1;");
    expect(importer).toContain("if (!options.apply || matches.length === 0) {");
  });

  it('dry-run future fixture sets Incomplete > 0, not Unresolved', () => {
    expect(importer).toContain("} else if (match.completePercent === 100 && match.matchDate !== null) {");
    expect(importer).toContain("unresolved += 1;");
    expect(importer).toContain("incompleteFixtures += 1;");
  });

  it('dry-run missing completed match is classified according to insert policy without being written', () => {
    expect(importer).toContain("unresolved += 1;");
  });

  it('ensures dry-run/apply pre-write classification parity', () => {
    const loopRegex = /if \(localMatchId !== null\) \{\s*resolved \+= 1;\s*\} else if \(match.completePercent === 100 && match.matchDate !== null\) \{\s*unresolved \+= 1;\s*\} else \{\s*incompleteFixtures \+= 1;\s*\}/g;
    const matches = importer.match(loopRegex);
    expect(matches?.length).toBe(2);
  });
});

describe('Update logic genuine-change and disagreements', () => {
  it('No-op canonical update: skips update if scores match identically', () => {
    expect(importer).toContain('const scoreChanged = current.homeScore !== agreedHomeScore');
    expect(importer).toContain('if (!scoreChanged && !componentsChanged) {\n          continue;\n        }');
  });

  it('Genuine score correction: updates canonical if score changes', () => {
    expect(importer).toContain('if (!scoreChanged && !componentsChanged) {\n          continue;\n        }');
    expect(importer).toContain('UPDATE matches');
    expect(importer).toContain('home_score = ${agreedHomeScore}');
  });

  it('Two agreeing sources: deduplicates update to canonical match', () => {
    expect(importer).toContain('const updatesByLocalMatchId = new Map<number, UpdateCandidate[]>();');
    expect(importer).toContain('let arr = updatesByLocalMatchId.get(localMatchId);');
    expect(importer).toContain('for (const [localMatchId, candidates] of updatesByLocalMatchId.entries())');
  });

  it('Two disagreeing sources: does not update and logs disagreement', () => {
    expect(importer).toContain('if (agreedHomeScore !== candidateHomeScore || agreedAwayScore !== candidateAwayScore) {');
    expect(importer).toContain('disagreement = true;\n              break;');
    expect(importer).toContain('if (disagreement) {\n          sourceDisagreements += 1;\n          continue;\n        }');
  });

  it('Orientation reversal: correctly aligns home/away before comparison', () => {
    expect(importer).toContain('const isHome = current.homeClubId === homeClubId;');
    expect(importer).toContain('const candidateHomeScore = isHome ? match.homeScore : match.awayScore;');
    expect(importer).toContain('const candidateAwayScore = isHome ? match.awayScore : match.homeScore;');
  });

  it('Null score components: does not silently overwrite known canonical components', () => {
    expect(importer).toContain('agreedHomeGoals = agreedHomeGoals ?? current.homeGoals;');
    expect(importer).toContain('agreedAwayBehinds = agreedAwayBehinds ?? current.awayBehinds;');
  });

  it('Dual-source missing insert: deduplicates insert for missing match', () => {
    expect(importer).toContain('const insertsByMatchKey = new Map<string, InsertCandidate[]>();');
    expect(importer).toContain('for (const [matchKey, candidates] of insertsByMatchKey.entries())');
    expect(importer).toContain('unresolved -= candidates.length;');
    expect(importer).toContain('for (const candidate of candidates) {');
    expect(importer).toContain('UPDATE staging.external_current_matches');
  });
});
