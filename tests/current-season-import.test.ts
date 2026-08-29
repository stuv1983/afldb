import { afterEach, describe, expect, it, vi } from 'vitest';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fetchKaliCurrentMatches, fetchSquiggleCurrentMatches } from '@/lib/external-afl/current-matches';
import {
  analyseCurrentSeasonCorroboration,
  parseCurrentSeasonSources,
  planCurrentSeasonCanonicalWork,
  type CurrentSeasonEvidenceObservation,
  type ResolvedCurrentSeasonObservation,
} from '@/lib/external-afl/current-season-import';

/**
 * A source file read as text for a source-contract assertion, with CRLF
 * normalised to LF.
 *
 * Every assertion in this file that spans a line break embeds `\n`, because
 * that is what the committed blob holds. On a Windows checkout with
 * `core.autocrlf=true` the working tree materialises those blobs as CRLF, so
 * a raw read makes a multiline `toContain` fail on a file whose content is
 * byte-for-byte correct -- a platform false positive, not a behaviour
 * failure, and the same class of defect `AFLDB-ISSUE-091` fixed for
 * migration checksums. Line endings are not semantic source content, so they
 * are normalised here, at the read boundary, rather than by loosening the
 * assertions that carry the contract.
 *
 * JSON fixtures are read directly below: they go through `JSON.parse`, which
 * is line-ending insensitive already.
 */
function readSource(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

const tool = readSource('tools/current-season/update-current-season.ts');
const importer = readSource('src/lib/external-afl/current-season-import.ts');
const adminAction = readSource('src/app/admin/current-season/actions.ts');
const adminPage = readSource('src/app/admin/current-season/page.tsx');
const adminNav = readSource('src/app/admin/nav-model.ts');
const migration = readSource('src/db/migrations/063_external_current_match_sources.sql');
const client = readSource('src/lib/external-afl/current-matches.ts');
/**
 * The migration-074 spine writer, extracted from the importer by
 * `AFLDB-ISSUE-099` T6a (amendment A12) so a second family importer reaches
 * one persistence contract rather than a second implementation of it. The
 * source-contract assertions below follow the implementation to the file that
 * now holds it; none is relaxed, and the importer is separately asserted to be
 * a thin adapter that does not duplicate any of it.
 */
const store = readSource('src/lib/acquisition/observation-store.ts');

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

  it('writes immutable observation history before refreshing the legacy projection', () => {
    expect(store).toContain('decideObservation({ contract, head, payload, observedAt })');
    expect(store).toContain('INSERT INTO staging.source_payloads');
    expect(store).toContain('INSERT INTO staging.source_record_versions');
    expect(store).toContain('UPDATE staging.source_record_versions');
    // The payload is stored, then the previous version is closed, then the new
    // version is appended, then the record head moves. Reordering any of these
    // would leave two open versions or a head citing an unstored payload.
    expect(store.indexOf('INSERT INTO staging.source_payloads'))
      .toBeLessThan(store.indexOf('UPDATE staging.source_record_versions'));
    expect(store.indexOf('UPDATE staging.source_record_versions'))
      .toBeLessThan(store.indexOf('INSERT INTO staging.source_record_versions'));
    expect(store.indexOf('INSERT INTO staging.source_record_versions'))
      .toBeLessThan(store.indexOf('INSERT INTO staging.source_records'));
    // Unchanged content refreshes the head under a row lock and appends nothing.
    expect(store).toContain('FOR UPDATE OF r');
    expect(store).toContain("return 'head_refreshed';");
    // The importer is a thin adapter, not a second copy of the writer.
    expect(importer).toContain("} from '../acquisition/observation-store';");
    expect(importer).not.toContain('decideObservation(');
    expect(importer).not.toContain('INSERT INTO staging.source_payloads');
    expect(importer).not.toContain('INSERT INTO staging.source_record_versions');
    expect(importer).not.toContain('UPDATE staging.source_record_versions');
    expect(importer).not.toContain('INSERT INTO staging.source_records');
    expect(importer).not.toContain('UPDATE staging.source_records');
    expect(importer.indexOf('persistSourceObservation('))
      .toBeLessThan(importer.indexOf('INSERT INTO staging.external_current_matches'));
  });

  it('represents later source absence as state and never as deletion', () => {
    expect(store).toContain('SET absent_since = ${observedAt}');
    expect(store).toContain('AND absent_since IS NULL');
    expect(store).toContain('AND last_batch_id <> ${batchId}');
    expect(store).not.toMatch(/DELETE FROM staging\.(source_records|source_record_versions|source_payloads)/);
    expect(store).not.toMatch(/\bTRUNCATE\b/i);
    expect(importer).not.toMatch(/DELETE FROM staging\.(source_records|source_record_versions|source_payloads)/);
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

  it('never promotes a partial current-API match family into a canonical match', () => {
    expect(tool).toContain('--insert-missing-matches is disabled');
    expect(importer).not.toContain('INSERT INTO matches');
    expect(importer).toContain("status: 'incomplete_source_family'");
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
    const provenance = readSource('src/db/migrations/064_matches_external_provenance.sql');
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
  it('preserves an absent source venue as null instead of fabricating evidence', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const payload = String(input).includes('q=teams')
        ? { teams: [{ id: 10, name: 'Richmond' }, { id: 7, name: 'Geelong' }] }
        : { games: [{ id: 1, year: 2026, round: 1, hteam: 10, ateam: 7, hscore: 90, ascore: 72, complete: 100 }] };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const [row] = await fetchSquiggleCurrentMatches(2026);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(row.venueRaw).toBeNull();
    expect(JSON.stringify(row)).not.toContain('Unknown');
  });

  it('keeps a concrete source venue distinguishable from absence', async () => {
    vi.stubEnv('KALI_AFL_API_KEY', 'test-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{
        matchId: 1, year: 2026, round: 1, date: '2026-03-20',
        homeTeamName: 'Richmond', awayTeamName: 'Geelong', venue: 'MCG',
        homeScore: 90, awayScore: 72, complete: 100,
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const [row] = await fetchKaliCurrentMatches(2026);

    expect(row.venueRaw).toBe('MCG');
  });

  it('treats Squiggle explicit complete match today as complete', async () => {
    const melbourneToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
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

function resolvedObservation(
  overrides: Partial<ResolvedCurrentSeasonObservation> = {},
): ResolvedCurrentSeasonObservation {
  return {
    match: {
      source: 'squiggle', externalGameId: '38494', season: 2026,
      roundLabel: 'Opening Round', roundNumber: 0, completePercent: 100,
      matchDate: '2026-03-05', venueRaw: null,
      homeTeamRaw: 'Sydney', awayTeamRaw: 'Carlton',
      homeScore: 132, awayScore: 69,
      homeGoals: 20, homeBehinds: 12, awayGoals: 10, awayBehinds: 9,
      rawPayload: { id: 38494, hscore: 132, ascore: 69 },
    },
    homeClubId: 1,
    awayClubId: 2,
    localMatchId: null,
    ...overrides,
  };
}

describe('Placeholder and Dry-Run Resolution Logic', () => {
  it('treats future fixture with not recorded participants as incomplete, unresolvedTeams = 0', () => {
    expect(importer).toContain("lower(e.home_team_raw) NOT IN ('not recorded', 'tbd', '')");
  });

  it('treats genuine unknown club as unresolvedTeams > 0', () => {
    expect(importer).toContain("lower(e.home_team_raw) NOT IN ('not recorded', 'tbd', '')");
  });

  it('counts unique canonical matches separately from source observations', () => {
    const plan = planCurrentSeasonCanonicalWork([
      resolvedObservation({ localMatchId: 42 }),
      resolvedObservation({
        match: { ...resolvedObservation().match, source: 'kali', externalGameId: '11405' },
        localMatchId: 42,
      }),
    ], false);

    expect(plan).toMatchObject({
      canonicalMatchesResolved: 1,
      canonicalRowsInserted: 0,
      unresolvedObservations: 0,
      incompleteSourceRecords: 0,
      rejectedOrConflicted: 0,
    });
  });

  it('classifies a future or structurally incomplete source record as incomplete', () => {
    const plan = planCurrentSeasonCanonicalWork([
      resolvedObservation({
        match: { ...resolvedObservation().match, completePercent: null, homeScore: null },
      }),
    ], false);

    expect(plan).toMatchObject({ unresolvedObservations: 0, incompleteSourceRecords: 1 });
  });

  it('keeps a missing completed match unresolved and rejects partial-family promotion', () => {
    const plan = planCurrentSeasonCanonicalWork([resolvedObservation()], true);

    expect(plan).toMatchObject({
      canonicalRowsInserted: 0,
      unresolvedObservations: 1,
      rejectedOrConflicted: 1,
      sourceDisagreements: 0,
    });
    expect(plan.insertAssessments[0]).toMatchObject({
      status: 'incomplete_source_family',
      venueRaw: null,
    });
  });

  it('does not treat coherent independent corroboration as authority to promote', () => {
    const squiggle = resolvedObservation();
    const kali = resolvedObservation({
      match: {
        ...resolvedObservation().match,
        source: 'kali', externalGameId: '11405',
        rawPayload: { id: 11405, homeScore: 132, awayScore: 69 },
      },
    });

    const plan = planCurrentSeasonCanonicalWork([squiggle, kali], true);

    expect(plan).toMatchObject({
      canonicalRowsInserted: 0,
      unresolvedObservations: 2,
      rejectedOrConflicted: 1,
      sourceDisagreements: 0,
      sameGroupConflicts: 0,
    });
    expect(plan.insertAssessments[0]).toMatchObject({
      status: 'incomplete_source_family',
      independentlyCorroborated: true,
      independenceGroups: ['kali', 'squiggle'],
    });
  });

  it('uses the same canonical planner for dry-run and apply reporting', () => {
    expect(importer).toContain('planCurrentSeasonCanonicalWork(resolvedObservations, options.insertMissingMatches)');
    expect(importer).toContain('planCurrentSeasonCanonicalWork(resolvedObservations, insertMissingMatches)');
    expect(importer).toContain('observationsStaged: 0');
  });

  it('reports source-all row counts at both concrete-source and independence-group grain', () => {
    expect(parseCurrentSeasonSources('all')).toEqual(['squiggle', 'kali']);
    expect(tool).toContain('result.sourceCounts[source]');
    expect(tool).toContain('Object.entries(result.independenceGroupCounts).sort()');
    expect(tool).toContain('independence group ${group}: ${count}');
    expect(tool).toContain('Within-group source conflicts: ${result.sameGroupConflicts}');
  });

  it('keeps observation and canonical batch counters distinct without subtraction', () => {
    expect(importer).toContain('records_inserted = ${observationVersionsInserted}');
    expect(importer).toContain('records_updated = ${observationHeadsRefreshed}');
    expect(importer).toContain('canonicalRowsInserted: canonicalPlan.canonicalRowsInserted');
    expect(importer).not.toContain('staged + inserted');
    expect(importer).not.toMatch(/\b(unresolved|canonicalRowsInserted)\s*-=/);
    expect(tool).toContain('Staged observations ${result.observationsStaged}');
    expect(tool).toContain('inserted canonical rows ${result.canonicalRowsInserted}');
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

  it('deduplicates candidate processing to one canonical match operation', () => {
    expect(importer).toContain('const updatesByLocalMatchId = new Map<number, MatchCandidate[]>();');
    expect(importer).toContain('appendCandidate(updatesByLocalMatchId, localMatchId');
    expect(importer).toContain('for (const [localMatchId, candidates] of updatesByLocalMatchId.entries())');
  });

  it('does not update when independent groups disagree', () => {
    expect(importer).toContain('if (corroboration.disagreeingGroups.length > 0) {\n          continue;\n        }');
    expect(importer).toContain('sourceDisagreements: canonicalPlan.sourceDisagreements');
  });

  it('Orientation reversal: correctly aligns home/away before comparison', () => {
    expect(importer).toContain('const sameOrientation = candidate.homeClubId === canonicalHomeClubId;');
    expect(importer).toContain('homeScore: sameOrientation ? match.homeScore : match.awayScore');
    expect(importer).toContain('awayScore: sameOrientation ? match.awayScore : match.homeScore');
  });

  it('Null score components: does not silently overwrite known canonical components', () => {
    expect(importer).toContain('agreedHomeGoals = agreedHomeGoals ?? current.homeGoals;');
    expect(importer).toContain('agreedAwayBehinds = agreedAwayBehinds ?? current.awayBehinds;');
  });

  it('independent-source disagreement blocks unsafe missing-match work', () => {
    const squiggle = resolvedObservation();
    const kali = resolvedObservation({
      match: {
        ...resolvedObservation().match,
        source: 'kali', externalGameId: '11405', awayScore: 70,
        rawPayload: { id: 11405, homeScore: 132, awayScore: 70 },
      },
    });

    const plan = planCurrentSeasonCanonicalWork([squiggle, kali], true);

    expect(plan).toMatchObject({
      canonicalRowsInserted: 0,
      unresolvedObservations: 2,
      rejectedOrConflicted: 1,
      sourceDisagreements: 1,
    });
    expect(plan.insertAssessments[0]).toMatchObject({
      status: 'source_disagreement',
      disagreeingGroups: ['kali', 'squiggle'],
    });
    expect(Object.values(plan).filter((value) => typeof value === 'number').every((value) => value >= 0)).toBe(true);
  });

  it('same-group conflict remains distinct and blocks unsafe missing-match work', () => {
    const first = resolvedObservation();
    const conflictingProxy = resolvedObservation({
      match: {
        ...resolvedObservation().match,
        externalGameId: '38494-proxy', awayScore: 70,
        rawPayload: { id: '38494-proxy', hscore: 132, ascore: 70 },
      },
    });

    const plan = planCurrentSeasonCanonicalWork([first, conflictingProxy], true);

    expect(plan).toMatchObject({
      canonicalRowsInserted: 0,
      unresolvedObservations: 2,
      rejectedOrConflicted: 1,
      sourceDisagreements: 0,
      sameGroupConflicts: 1,
    });
    expect(plan.insertAssessments[0]).toMatchObject({
      status: 'same_group_conflict',
      disagreeingGroups: [],
      sameGroupConflictGroups: ['squiggle'],
      independentlyCorroborated: false,
    });
  });
});

function currentSeasonObservation(
  sourceKey: string,
  family: string,
  externalGameId: string,
  awayScore = 104,
): CurrentSeasonEvidenceObservation {
  return {
    sourceKey,
    family,
    externalGameId,
    values: {
      homeScore: 95,
      awayScore,
      homeGoals: 14,
      homeBehinds: 11,
      awayGoals: null,
      awayBehinds: null,
    },
  };
}

describe('AFLDB-ISSUE-097 current-season independence-group corroboration', () => {
  it('counts Squiggle plus the Kali fixture proxy as one fixture witness', () => {
    const result = analyseCurrentSeasonCorroboration([
      currentSeasonObservation('squiggle_api', 'match', '38694'),
      currentSeasonObservation('kali_afl_stats', 'fixture', '38694'),
    ]);

    expect(result.independenceGroups).toEqual(['squiggle']);
    expect(result.independentWitnessCount).toBe(1);
    expect(result.independentlyCorroborated).toBe(false);
  });

  it('counts Squiggle and authenticated Kali matches as separate match witnesses', () => {
    const result = analyseCurrentSeasonCorroboration([
      currentSeasonObservation('squiggle_api', 'match', '38694'),
      currentSeasonObservation('kali_afl_stats', 'match', '11611'),
    ]);

    expect(result.independenceGroups).toEqual(['kali', 'squiggle']);
    expect(result.independentWitnessCount).toBe(2);
    expect(result.independentlyCorroborated).toBe(true);
  });

  it('does not let two observations in one group manufacture corroboration', () => {
    const result = analyseCurrentSeasonCorroboration([
      currentSeasonObservation('squiggle_api', 'match', '38694'),
      currentSeasonObservation('kali_afl_stats', 'fixture', '38694'),
    ]);

    expect(result.independenceGroupCounts).toEqual({ squiggle: 2 });
    expect(result.independentWitnessCount).toBe(1);
    expect(result.independentlyCorroborated).toBe(false);
  });

  it('keeps disagreement between genuinely independent match groups visible', () => {
    const result = analyseCurrentSeasonCorroboration([
      currentSeasonObservation('squiggle_api', 'match', '38694', 104),
      currentSeasonObservation('kali_afl_stats', 'match', '11611', 105),
    ]);

    expect(result.disagreeingGroups).toEqual(['kali', 'squiggle']);
    expect(result.independentlyCorroborated).toBe(false);
    expect(result.values).toBeNull();
  });

  it('does not let duplicate same-group observations outvote another group', () => {
    const result = analyseCurrentSeasonCorroboration([
      currentSeasonObservation('squiggle_api', 'match', '38694', 104),
      currentSeasonObservation('kali_afl_stats', 'fixture', '38694-proxy', 104),
      currentSeasonObservation('kali_afl_stats', 'match', '11611', 105),
    ]);

    expect(result.independenceGroupCounts).toEqual({ squiggle: 2, kali: 1 });
    expect(result.disagreeingGroups).toEqual(['kali', 'squiggle']);
  });

  it('keeps aggregate, group and concrete-source counters coherent for source-all input', () => {
    const observations = [
      currentSeasonObservation('squiggle_api', 'match', '38694'),
      currentSeasonObservation('kali_afl_stats', 'fixture', '38694-proxy'),
      currentSeasonObservation('kali_afl_stats', 'match', '11611'),
    ];
    const result = analyseCurrentSeasonCorroboration(observations);

    expect(result.observations).toHaveLength(3);
    expect(result.sourceCounts).toEqual({ squiggle_api: 1, kali_afl_stats: 2 });
    expect(result.independenceGroupCounts).toEqual({ squiggle: 2, kali: 1 });
    expect(Object.values(result.sourceCounts).reduce((sum, count) => sum + count, 0)).toBe(3);
    expect(Object.values(result.independenceGroupCounts).reduce((sum, count) => sum + count, 0)).toBe(3);
  });

  it('leaves single-source behaviour unchanged and preserves exact provenance', () => {
    const observation = currentSeasonObservation('squiggle_api', 'match', '38694');
    const result = analyseCurrentSeasonCorroboration([observation]);

    expect(result.independentWitnessCount).toBe(1);
    expect(result.disagreeingGroups).toEqual([]);
    expect(result.sameGroupConflictGroups).toEqual([]);
    expect(result.values).toEqual(observation.values);
    expect(result.observations).toEqual([observation]);
  });

  it('reports proxy drift separately without calling it independent disagreement', () => {
    const result = analyseCurrentSeasonCorroboration([
      currentSeasonObservation('squiggle_api', 'match', '38694', 104),
      currentSeasonObservation('kali_afl_stats', 'fixture', '38694-proxy', 105),
    ]);

    expect(result.disagreeingGroups).toEqual([]);
    expect(result.sameGroupConflictGroups).toEqual(['squiggle']);
    expect(result.values).toBeNull();
  });

  it('does not fabricate independent disagreement from a conflicted proxy group', () => {
    const result = analyseCurrentSeasonCorroboration([
      currentSeasonObservation('squiggle_api', 'match', '38694', 104),
      currentSeasonObservation('kali_afl_stats', 'fixture', '38694-proxy', 105),
      currentSeasonObservation('kali_afl_stats', 'match', '11611', 104),
    ]);

    expect(result.sameGroupConflictGroups).toEqual(['squiggle']);
    expect(result.disagreeingGroups).toEqual([]);
    expect(result.independentlyCorroborated).toBe(false);
    expect(result.values).toBeNull();
    expect(importer).toContain(
      'if (corroboration.sameGroupConflictGroups.length > 0) {\n          continue;\n        }',
    );
    expect(importer).not.toContain('INSERT INTO matches');
  });
});


/*
 * AFLDB-ISSUE-096 S2 — the source observation spine and the reviewed
 * promotion ledger (migration 074 + src/lib/acquisition/observations.ts).
 *
 * The semantic home named by the ISSUE-096 runbook. Everything here is
 * deterministic and DB-free: fixtures are literals, every timestamp is
 * passed in, and no test touches a live API or a database. The migration
 * itself is asserted from its SQL text, which is how the two constraints
 * that carry the invariants — no hash-uniqueness on history, no accepted
 * refusal verb — stay visible to a reader changing the schema later.
 */
import {
  getSourceFamily,
  parseSourceFamilyRegistry,
} from '@/lib/acquisition/source-families';
import {
  canonicalisePayload,
  decideObservation,
  evaluateAcceptance,
  evaluateOwnership,
  hashPayload,
  hashRecipe,
  observationKey,
  resolveSourceId,
  resolveSourceUpdatedAt,
  sweepAbsences,
  UNAVAILABLE_MANUAL_AUTHORITY,
  witnessGroups,
  type AcceptanceInput,
  type JsonValue,
  type ManualAuthorityProvider,
  type ObservationHead,
} from '@/lib/acquisition/observations';

const spine = readSource('src/db/migrations/074_source_observation_spine.sql');
const privilegesSql = readSource('tools/maintenance/privileges.sql');

/**
 * The executable statements of a migration: `--` comments removed, whitespace
 * collapsed, split on `;`. Source-contract assertions run over this rather
 * than the raw text. 074 explains each invariant in prose immediately above
 * the SQL that upholds it, so a text regex spanning a comment matches the
 * explanation of the forbidden rule instead of the rule itself.
 */
function sqlStatements(sql: string): string[] {
  return sql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}
const registry = parseSourceFamilyRegistry(
  JSON.parse(readFileSync('data/reference/source-families.json', 'utf8')),
);
const squiggleMatch = getSourceFamily(registry, 'squiggle_api', 'match');
const kaliMatch = getSourceFamily(registry, 'kali_afl_stats', 'match');
const aflRoster = getSourceFamily(registry, 'afl_api', 'roster');

/** A Squiggle game, in three states: A, then a score correction B, then back to A. */
const A: JsonValue = {
  id: 38494, year: 2026, round: 0, date: '2026-03-05 19:30:00',
  hteam: 'Sydney', ateam: 'Carlton', hscore: 132, ascore: 69,
  complete: 100, updated: '2026-03-05 22:16:49',
};
const B: JsonValue = { ...(A as Record<string, JsonValue>), ascore: 70, updated: '2026-03-05 22:40:00' };

type Version = { seq: number; hash: string; sourceUpdatedAt: string | null };

/**
 * Replays a sequence of observations through the real decision function,
 * keeping the same three grains migration 074 stores: deduplicated
 * payloads, ordered versions, and one open head.
 */
function replay(contract: typeof squiggleMatch, payloads: readonly JsonValue[]) {
  const versions: Version[] = [];
  const payloadRows = new Set<string>();
  let head: ObservationHead | null = null;
  let lastSeenAt = '';
  let unchangedPolls = 0;

  payloads.forEach((payload, i) => {
    const observedAt = `2026-08-28T0${i}:00:00Z`;
    const decision = decideObservation({
      contract, head, payload, observedAt, knownPayloadHashes: payloadRows,
    });
    lastSeenAt = observedAt;
    if (decision.action === 'unchanged') {
      unchangedPolls += 1;
      return;
    }
    payloadRows.add(decision.payloadHash);
    versions.push({
      seq: decision.versionSeq,
      hash: decision.payloadHash,
      sourceUpdatedAt: decision.sourceUpdatedAt,
    });
    head = {
      versionSeq: decision.versionSeq,
      payloadHash: decision.payloadHash,
      hashRecipe: decision.recipe,
      rawPayload: payload,
      absentSince: null,
    };
  });

  return { versions, payloadRows, lastSeenAt, unchangedPolls, head };
}

/** A pending candidate that would pass every gate, so each test breaks exactly one. */
type CandidateFixture = AcceptanceInput['candidate'];
type CurrentFixture = AcceptanceInput['current'];

function candidate(overrides: Partial<CandidateFixture> = {}): CandidateFixture {
  return {
    status: 'pending' as const,
    verb: 'corrected',
    season: 2026,
    sourceKey: 'afltables',
    family: 'player_match_stats',
    externalRecordId: 'url:/players/S/Sydney_Player.html',
    sourceVersionSeq: 3,
    baselineCanonicalHash: 'a'.repeat(64),
    fields: ['home_score', 'away_score'],
    entity: 'matches',
    targetKey: { season: 2026, round: 0, home: 'Sydney', away: 'Carlton' },
    ...overrides,
  };
}

function current(overrides: Partial<CurrentFixture> = {}): CurrentFixture {
  return {
    sourceVersionSeq: 3,
    canonicalHash: 'a'.repeat(64),
    targetOwnerSourceKey: 'afltables',
    ...overrides,
  };
}

const AUTHORITY_CLEAR: ManualAuthorityProvider = () => 'clear';

function accept(
  candidateOverrides: Partial<CandidateFixture> = {},
  currentOverrides: Partial<CurrentFixture> = {},
  authority: ManualAuthorityProvider = AUTHORITY_CLEAR,
) {
  return evaluateAcceptance({
    candidate: candidate(candidateOverrides),
    current: current(currentOverrides),
    inProgressSeasons: [2026],
    manualAuthority: authority,
  });
}

describe('S2 observation spine — idempotence and correction history', () => {
  it('records nothing at all when an unchanged poll repeats', () => {
    const { versions, payloadRows, unchangedPolls, lastSeenAt } = replay(squiggleMatch, [A, A, A]);
    // One version, one payload, from three polls.
    expect(versions).toHaveLength(1);
    expect(payloadRows.size).toBe(1);
    expect(unchangedPolls).toBe(2);
    // The only thing that moved is the head's observation metadata.
    expect(lastSeenAt).toBe('2026-08-28T02:00:00Z');
  });

  it('keeps A -> B -> A as three ordered versions over two payloads', () => {
    const { versions, payloadRows } = replay(squiggleMatch, [A, B, A]);
    expect(versions.map((v) => v.seq)).toEqual([1, 2, 3]);
    expect(payloadRows.size).toBe(2);
    // The defect this model exists to prevent: the returning A must be a
    // NEW historical event, not a dedupe against version 1.
    expect(versions[2].hash).toBe(versions[0].hash);
    expect(versions[2].seq).not.toBe(versions[0].seq);
    // ...and the transition through B is still reconstructable.
    expect(versions[1].hash).not.toBe(versions[0].hash);
  });

  it('closes the previous interval only when content actually changed', () => {
    const first = decideObservation({
      contract: squiggleMatch, head: null, payload: A, observedAt: '2026-08-28T00:00:00Z',
    });
    expect(first).toMatchObject({ action: 'append_version', versionSeq: 1, closesPreviousVersion: false });

    const head: ObservationHead = {
      versionSeq: 1, payloadHash: first.payloadHash, hashRecipe: first.recipe,
      rawPayload: A, absentSince: null,
    };
    expect(decideObservation({
      contract: squiggleMatch, head, payload: A, observedAt: '2026-08-28T01:00:00Z',
    })).toMatchObject({ action: 'unchanged', versionSeq: 1 });
    expect(decideObservation({
      contract: squiggleMatch, head, payload: B, observedAt: '2026-08-28T01:00:00Z',
    })).toMatchObject({ action: 'append_version', versionSeq: 2, closesPreviousVersion: true });
  });

  it('never records an observation against an unproven shape', () => {
    const statsGrain = getSourceFamily(registry, 'kali_afl_stats', 'player_stats');
    expect(() => decideObservation({
      contract: statsGrain, head: null, payload: { matchId: 11418 }, observedAt: '2026-08-28T00:00:00Z',
    })).toThrow(/identity_only/);
  });
});

describe('S2 observation spine — the hash contract', () => {
  it('hashes by the family declaration and excludes only declared fields', () => {
    // AFL API: data_accessed is AFLDB's own fetch date and is excluded, so
    // two fetches of an unchanged roster row are ONE payload.
    const monday = { providerId: 'CD_I1000953', firstName: 'X', data_accessed: '2026-08-27' };
    const tuesday = { providerId: 'CD_I1000953', firstName: 'X', data_accessed: '2026-08-28' };
    expect(hashPayload(aflRoster, monday).hash).toBe(hashPayload(aflRoster, tuesday).hash);
    expect(hashRecipe(aflRoster)).toContain('data_accessed');

    // Squiggle: `updated` is genuine upstream mutation data and stays IN
    // the hash, so a bumped `updated` is a real new state.
    expect(hashPayload(squiggleMatch, A).hash)
      .not.toBe(hashPayload(squiggleMatch, { ...(A as Record<string, JsonValue>), updated: 'x' }).hash);
    expect(hashRecipe(squiggleMatch)).toBe('sha256/v1()');

    // Kali: sourcedAt is treated as genuine mutation data on P1 evidence.
    expect(hashRecipe(kaliMatch)).toBe('sha256/v1()');
  });

  it('canonicalises key order without reordering arrays', () => {
    expect(canonicalisePayload(squiggleMatch, { b: 1, a: { d: 2, c: 3 } }))
      .toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(canonicalisePayload(squiggleMatch, { a: [3, 1, 2] }))
      .toBe('{"a":[3,1,2]}');
  });

  /*
   * The reversibility requirement for Kali's sourcedAt. P1 proved it
   * survives an identical repeat fetch, but not that it can never advance
   * without a substantive change. If it ever does, it moves to the family's
   * hash-exclusion list — and that must stay a reference-data edit, not a
   * migration with a backfill.
   */
  it('absorbs a hash-recipe change without inventing a version', () => {
    const volatile = { ...kaliMatch, hashExclusions: ['sourcedAt'] as readonly string[] };
    const row: JsonValue = {
      id: 11405, round: 0, year: 2026, homeTeam: 'Sydney', awayTeam: 'Carlton',
      homeScore: 132, awayScore: 69, date: 'Thursday, 5th March 2026',
      sourcedAt: '2026-03-05T22:16:49.000Z',
    };
    const bumped: JsonValue = { ...(row as Record<string, JsonValue>), sourcedAt: '2026-08-28T00:00:00.000Z' };

    // Head was written under the OLD recipe, which included sourcedAt.
    const underOldRecipe = hashPayload(kaliMatch, row);
    const head: ObservationHead = {
      versionSeq: 7, payloadHash: underOldRecipe.hash, hashRecipe: underOldRecipe.recipe,
      rawPayload: row, absentSince: null,
    };
    expect(underOldRecipe.recipe).not.toBe(hashRecipe(volatile));

    // Under the new recipe the bumped timestamp is no longer content, so
    // the first poll after the change appends NOTHING. No backfill, no
    // spurious version, and the stored history stays valid.
    expect(decideObservation({
      contract: volatile, head, payload: bumped, observedAt: '2026-08-28T01:00:00Z',
    })).toMatchObject({ action: 'unchanged', versionSeq: 7 });

    // Under the recipe as it stands today, that same bump IS content.
    expect(decideObservation({
      contract: kaliMatch, head, payload: bumped, observedAt: '2026-08-28T01:00:00Z',
    })).toMatchObject({ action: 'append_version', versionSeq: 8 });
  });
});

describe('S2 observation spine — source_updated_at', () => {
  it('retains a genuine upstream mutation timestamp', () => {
    expect(resolveSourceUpdatedAt(squiggleMatch, A)).toBe('2026-03-05 22:16:49');
    expect(resolveSourceUpdatedAt(kaliMatch, { id: 1, sourcedAt: '2026-08-23T12:00:08.254Z' }))
      .toBe('2026-08-23T12:00:08.254Z');
  });

  it('stays NULL when the source publishes none, and cannot borrow one', () => {
    // AFL API rosters: data_accessed is a fetch date and utcStartTime is a
    // scheduled kick-off, so the family declares no field and gets NULL.
    expect(aflRoster.sourceUpdatedAtField).toBeNull();
    expect(resolveSourceUpdatedAt(aflRoster, { providerId: 'CD_I1', data_accessed: '2026-08-28' })).toBeNull();
    const lineup = getSourceFamily(registry, 'afl_api', 'lineup');
    expect(resolveSourceUpdatedAt(lineup, { providerId: 'CD_M1', utcStartTime: '2026-08-23T09:20:00Z' }))
      .toBeNull();
    // A declared field that is absent or empty is still NULL, never a fallback.
    expect(resolveSourceUpdatedAt(squiggleMatch, { id: 1 })).toBeNull();
    expect(resolveSourceUpdatedAt(squiggleMatch, { id: 1, updated: '' })).toBeNull();
    // And the appended version carries the same NULL rather than observedAt.
    const decision = decideObservation({
      contract: squiggleMatch, head: null, payload: { id: 1 }, observedAt: '2026-08-28T00:00:00Z',
    });
    expect(decision).toMatchObject({ action: 'append_version', sourceUpdatedAt: null });
  });
});

describe('S2 observation spine — absence is not deletion', () => {
  const records = [
    { externalRecordId: '38494', scopeKey: 'season=2026', lastSeenAt: '2026-08-27T00:00:00Z', absentSince: null },
    { externalRecordId: '38495', scopeKey: 'season=2026', lastSeenAt: '2026-08-28T06:00:00Z', absentSince: null },
    { externalRecordId: '99999', scopeKey: 'season=2025', lastSeenAt: '2025-09-01T00:00:00Z', absentSince: null },
  ];

  it('stamps absence only inside the scope the fetch enumerated', () => {
    const absent = sweepAbsences({
      enumeratedScopeKeys: ['season=2026'],
      batchStartedAt: '2026-08-28T05:00:00Z',
      records,
    });
    // 38494 was not returned by this batch; 38495 was; 2025 was never
    // enumerated, so nothing may be said about it.
    expect(absent).toEqual(['38494']);
  });

  it('refuses a sweep that enumerated nothing', () => {
    expect(() => sweepAbsences({
      enumeratedScopeKeys: [], batchStartedAt: '2026-08-28T05:00:00Z', records,
    })).toThrow(/never checked/);
  });

  it('never re-stamps a record already marked absent', () => {
    expect(sweepAbsences({
      enumeratedScopeKeys: ['season=2026'],
      batchStartedAt: '2026-08-28T05:00:00Z',
      records: [{ ...records[0], absentSince: '2026-08-27T05:00:00Z' }],
    })).toEqual([]);
  });

  it('supports reappearance without losing or rewriting history', () => {
    const stored = hashPayload(squiggleMatch, A);
    const head: ObservationHead = {
      versionSeq: 4, payloadHash: stored.hash, hashRecipe: stored.recipe,
      rawPayload: A, absentSince: '2026-08-27T05:00:00Z',
    };
    // Unchanged content returns: absence clears, history does not move.
    const back = decideObservation({
      contract: squiggleMatch, head, payload: A, observedAt: '2026-08-28T00:00:00Z',
    });
    expect(back).toMatchObject({ action: 'unchanged', versionSeq: 4, reappeared: true });
    // Changed content returns: a new version, still no history lost.
    expect(decideObservation({
      contract: squiggleMatch, head, payload: B, observedAt: '2026-08-28T00:00:00Z',
    })).toMatchObject({ action: 'append_version', versionSeq: 5, reappeared: true });
  });

  it('keeps absence away from canonical data, in the schema and in the code', () => {
    // absent_since lives on the record grain only — never on a version,
    // which would assert that a past payload disappeared.
    expect(spine).toMatch(/CREATE TABLE staging\.source_records[\s\S]*?absent_since\s+timestamptz/);
    // Slice to the A3 section header, not to the next CREATE TABLE: the
    // header comment explains where absent_since lives and would otherwise
    // make this assertion pass or fail on prose.
    expect(spine.slice(
      spine.indexOf('CREATE TABLE staging.source_record_versions'),
      spine.indexOf('-- A3'),
    )).not.toContain('absent_since');
    // Nothing in the spine deletes canonical rows or fires on its own.
    expect(spine).not.toMatch(/CREATE (OR REPLACE )?(TRIGGER|RULE)/i);
    expect(spine).not.toMatch(/\bDELETE FROM\b/i);
  });
});

describe('S2 promotion ledger — reviewed only, append only', () => {
  it('creates no automatic promotion path', () => {
    // A candidate is a proposal: no trigger, no rule, no canonical write.
    expect(spine).not.toMatch(/CREATE (OR REPLACE )?(TRIGGER|RULE)/i);
    expect(spine).not.toMatch(/\bUPDATE (public\.)?matches\b/i);
    expect(spine).toMatch(/status\s+text\s+NOT NULL DEFAULT 'pending'/);
    // Only the three verbs that propose a write may ever be accepted; the
    // schema makes an accepted refusal verb unrepresentable.
    expect(spine).toContain('promotion_candidates_acceptable_ck');
    expect(spine).toMatch(
      /promotion_candidates_acceptable_ck CHECK \(\s*status <> 'accepted' OR verb IN \('new', 'corrected', 'rescheduled'\)/,
    );
    for (const verb of ['absent', 'unresolved_identity', 'source_disagreement',
      'foreign_owned_collision', 'manual_authority_conflict', 'stale_review']) {
      expect(accept({ verb })).toEqual({ ok: false, refusal: 'verb_not_promotable', requeue: false });
    }
    // 'unchanged' produces no diff, so it is not a candidate verb at all.
    expect(spine).not.toMatch(/verb IN \([^)]*'unchanged'/);
  });

  it('keeps the decision ledger append-only through the reconciler, not just the migration', () => {
    // grant_import_write() hands out UPDATE/DELETE/TRUNCATE and
    // privileges.sql regenerates from that registry, so registering the
    // ledger there would quietly undo append-only at the next reconcile.
    expect(spine).toContain("grant_import_write('promotion_candidates')");
    expect(spine).not.toContain("grant_import_write('promotion_decisions')");
    expect(spine).toContain('GRANT SELECT, INSERT ON promotion_decisions TO afldb_auth');
    // Every executable GRANT on the ledger table, as a complete set: SELECT
    // and INSERT, and nothing else. A later UPDATE, DELETE, TRUNCATE or ALL
    // grant fails here wherever in the migration it is added.
    const ledgerGrants = sqlStatements(spine)
      .filter((statement) => /\bON\s+promotion_decisions\b/i.test(statement))
      .map((statement) => statement.match(/\bGRANT\b.*$/i)?.[0])
      .filter((grant): grant is string => grant !== undefined);
    expect(ledgerGrants).toEqual(['GRANT SELECT, INSERT ON promotion_decisions TO afldb_auth']);
    // The subtractive afldb_auth list must name both tables or the
    // reconciler revokes them.
    expect(privilegesSql).toContain("['promotion_decisions',    'SELECT, INSERT'],");
    expect(privilegesSql).toContain("['promotion_candidates',   'SELECT'],");
    expect(privilegesSql).toContain("'player_link_match_candidates', 'promotion_decisions'");
    // A reviewer moves workflow columns and cannot edit the proposal.
    expect(privilegesSql).toContain('GRANT UPDATE (status, resolved_at, resolved_decision_id)');
    // A resolved candidate must name the decision that resolved it.
    expect(spine).toContain('promotion_candidates_decision_ck');
  });

  it('holds history immutable in the spine as well', () => {
    // The one index that would destroy A -> B -> A must never exist: no
    // uniqueness rule on the history table may mention payload_hash, because
    // that is what rejects the returning A. Asserted over statements, not raw
    // text — the migration's own comment above the table says the words
    // UNIQUE and payload_hash while forbidding exactly this index.
    const versionUniques = sqlStatements(spine).filter(
      (statement) => /\bUNIQUE\b/i.test(statement) && /\bsource_record_versions\b/i.test(statement),
    );
    expect(versionUniques).toHaveLength(1);
    expect(versionUniques[0]).not.toMatch(/payload_hash/i);
    // Payload lookup is served by a plain, non-unique index.
    expect(sqlStatements(spine)).toContain(
      'CREATE INDEX ix_source_record_versions_payload '
        + 'ON staging.source_record_versions (source_id, family, payload_hash)',
    );
    expect(spine).toContain('ux_source_record_versions_open');
    expect(spine).toMatch(/CREATE UNIQUE INDEX ux_source_record_versions_open[\s\S]*?WHERE observed_to IS NULL/);
  });

  it('covers its own foreign keys before it is ever applied', () => {
    // tests/integration/fk-indexes.test.ts fails any foreign key in `public`
    // whose referencing columns are not the LEADING key columns of some
    // index, and counts a partial index only when its predicate is exactly
    // `(col IS NOT NULL)`. Three of 074's foreign keys need an index of
    // their own -- the rest are covered or point at a DELETE_FREE_PARENTS
    // parent -- and that suite needs a database, so this is the DB-free
    // gate that catches a regression here first. Asserted over executable
    // statements, not raw text, for the same reason the uniqueness test
    // above is: the migration's prose names these columns too.
    const statements = sqlStatements(spine);
    const indexNamed = (name: string) => statements
      .filter((statement) => new RegExp(`\\bINDEX ${name}\\b`).test(statement));

    // The composite evidence key, in exactly the foreign key's column order.
    expect(indexNamed('ix_promotion_candidates_evidence')).toEqual([
      'CREATE INDEX ix_promotion_candidates_evidence ON promotion_candidates '
        + '(source_id, family, external_record_id, source_version_seq)',
    ]);
    // The nullable decision reference, partial on the only predicate a
    // referential probe implies.
    expect(indexNamed('ix_promotion_candidates_decision')).toEqual([
      'CREATE INDEX ix_promotion_candidates_decision ON promotion_candidates '
        + '(resolved_decision_id) WHERE resolved_decision_id IS NOT NULL',
    ]);
    // The auth_users reference: NOT NULL, so plain and never partial -- a
    // predicate here would narrow the index the probe needs whole.
    expect(indexNamed('ix_promotion_decisions_admin')).toEqual([
      'CREATE INDEX ix_promotion_decisions_admin ON promotion_decisions (admin_user_id)',
    ]);
    expect(indexNamed('ix_promotion_decisions_admin')[0]).not.toMatch(/\bWHERE\b/i);

    // None of the three may be UNIQUE -- that would constrain the data
    // rather than cover a key -- and none CONCURRENTLY, which cannot run
    // inside the migration runner's transaction.
    for (const name of ['ix_promotion_candidates_evidence',
      'ix_promotion_candidates_decision', 'ix_promotion_decisions_admin']) {
      expect(indexNamed(name)[0]).not.toMatch(/\bUNIQUE\b|\bCONCURRENTLY\b/i);
    }
  });
});

/*
 * AFLDB-ISSUE-099 T5 — migration 076, before it is ever applied.
 *
 * Once 076 is applied it is checksum-frozen and any correction needs a NEW
 * forward migration, so everything that can be proven from the source is
 * proven here first. Two things dominate:
 *
 *   * the v1 boundary — v1 writes NOTHING canonical, so 076 must contain no
 *     schema that exists only for the future acceptance transaction, and must
 *     modify no canonical table beyond the one approved data_issues column;
 *   * NULL is not zero — every projected statistic stays nullable, with no
 *     default and no coercion anywhere in the schema.
 */
describe('migration 076 — AFL Tables settle projections (AFLDB-ISSUE-099)', () => {
  const settle = readSource('src/db/migrations/076_afltables_settle_projections.sql');
  const statements = sqlStatements(settle);
  // Every negative assertion runs over the EXECUTABLE statements, never the raw
  // file: 076 explains each exclusion in prose immediately above the schema, so
  // a raw-text regex would match the explanation of the forbidden thing instead
  // of the forbidden thing. Same lesson as 074's source contract.
  const executable = statements.join(' ; ');
  const indexNamed = (name: string) => statements
    .filter((statement) => new RegExp(`\\bINDEX ${name}\\b`).test(statement));

  it('adds no schema for the future canonical acceptance stage', () => {
    // AFLDB-ISSUE-099 §10.3. Each of these is a prerequisite of the
    // acceptance transaction (§16 A1-A4). v1 writes nothing canonical, so
    // nothing in v1 needs them, and adding them now would be schema built
    // for a stage that has not been approved.
    expect(executable).not.toMatch(/add_provenance_columns/i);
    expect(executable).not.toMatch(/source_record_id\b/i);
    expect(executable).not.toMatch(/\bdata_overrides\b/i);
    for (const target of ['match_period_scores', 'brownlow_round_votes',
      'player_match_stats', 'matches', 'players', 'clubs', 'venues',
      'data_overrides']) {
      expect(statements.filter((s) => new RegExp(`^ALTER TABLE ${target}\\b`, 'i').test(s)))
        .toEqual([]);
    }
    // And it edits none of the applied, checksum-frozen migrations.
    for (const frozen of ['073_data_overrides', '074_source_observation_spine',
      '075_data_overrides_fk_index']) {
      expect(settle).not.toContain(frozen);
    }
  });

  it('modifies exactly one existing table, and only additively', () => {
    const alters = statements.filter((s) => /^ALTER TABLE\b/i.test(s));
    expect(alters).toEqual(['ALTER TABLE data_issues ADD COLUMN issue_key text']);
    // No DML at all: a migration that writes rows into a canonical table is
    // exactly what the v1 zero-canonical-write boundary forbids.
    expect(statements.filter((s) => /^(INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(s)))
      .toEqual([]);
    // No trigger, rule or default may reach a canonical table either.
    expect(executable).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?(TRIGGER|RULE|FUNCTION)/i);
  });

  it('creates both typed projections in staging, keyed to the observation version', () => {
    const creates = statements
      .filter((s) => /^CREATE TABLE\b/i.test(s))
      .map((s) => /^CREATE TABLE (\S+)/i.exec(s)![1]);
    expect(creates).toEqual(['staging.afltables_match', 'staging.afltables_player_match']);

    // AFLDB-ISSUE-096 Decision B: resolution and diffing read the TYPED
    // projection, and a projection is bound to the exact source version it
    // came from — so evidence can never be conflated.
    for (const table of creates) {
      const body = statements.find((s) => s.startsWith(`CREATE TABLE ${table}`))!;
      expect(body).toContain('PRIMARY KEY (source_id, family, external_record_id)');
      expect(body).toContain(
        'FOREIGN KEY (source_id, family, external_record_id, version_seq) '
        + 'REFERENCES staging.source_record_versions '
        + '(source_id, family, external_record_id, version_seq)');
    }
    // The player projection deliberately has NO canonical match FK: on a
    // canonically rebuilt database the in-progress season has zero matches,
    // so requiring one would make every in-season projection unwritable.
    const player = statements.find((s) =>
      s.startsWith('CREATE TABLE staging.afltables_player_match'))!;
    expect(player).not.toMatch(/REFERENCES matches\b/i);
    expect(player).toContain('match_key text NOT NULL');
  });

  it('covers its own foreign keys before it is ever applied', () => {
    // The parents that are never deleted from row-by-row -- seasons, clubs,
    // sources, import_batches -- are exempt on exactly the grounds
    // tests/integration/fk-indexes.test.ts already accepts. These four are
    // not, so each needs a leading-column index of its own.
    expect(indexNamed('ix_afltables_match_version')).toEqual([
      'CREATE INDEX ix_afltables_match_version ON staging.afltables_match '
        + '(source_id, family, external_record_id, version_seq)',
    ]);
    expect(indexNamed('ix_afltables_player_match_version')).toEqual([
      'CREATE INDEX ix_afltables_player_match_version ON staging.afltables_player_match '
        + '(source_id, family, external_record_id, version_seq)',
    ]);
    expect(indexNamed('ix_afltables_player_match_player')).toEqual([
      'CREATE INDEX ix_afltables_player_match_player '
        + 'ON staging.afltables_player_match (player_id)',
    ]);
    // Nullable, so partial on the only predicate a referential probe implies.
    expect(indexNamed('ix_afltables_match_venue')).toEqual([
      'CREATE INDEX ix_afltables_match_venue ON staging.afltables_match (venue_id) '
        + 'WHERE venue_id IS NOT NULL',
    ]);
    // No covering index may be UNIQUE -- that would constrain the data rather
    // than cover a key -- and none CONCURRENTLY, which cannot run inside the
    // migration runner's transaction.
    for (const statement of statements.filter((s) => /^CREATE( UNIQUE)? INDEX/i.test(s))) {
      expect(statement).not.toMatch(/\bCONCURRENTLY\b/i);
      if (/^CREATE UNIQUE INDEX/i.test(statement)) {
        expect(statement).toContain('uq_data_issues_open_by_key');
      }
    }
  });

  it('keeps NULL distinct from zero across every projected value', () => {
    const bodies = statements.filter((s) => /^CREATE TABLE staging\./i.test(s));
    for (const body of bodies) {
      // Nothing may default a projected value, and a coerced zero is exactly
      // what "not recorded" must never become.
      expect(body).not.toMatch(/DEFAULT 0\b/i);
      expect(body).not.toMatch(/COALESCE/i);
    }
    // Asserted as the whole column DEFINITION including its trailing comma: a
    // NOT NULL column would read `kicks smallint NOT NULL,` and fail here, and
    // matching the definition rather than a bare name keeps the CHECK
    // constraints (which mention every column twice) out of it.
    const player = bodies.find((b) => b.includes('afltables_player_match'))!;
    for (const column of ['kicks smallint,', 'marks smallint,', 'handballs smallint,',
      'disposals smallint,', 'goals smallint,', 'behinds smallint,', 'hitouts smallint,',
      'tackles smallint,', 'rebounds smallint,', 'inside_50s smallint,',
      'clearances smallint,', 'clangers smallint,', 'frees_for smallint,',
      'frees_against smallint,', 'contested smallint,', 'uncontested smallint,',
      'contested_marks smallint,', 'marks_inside_50 smallint,',
      'one_percenters smallint,', 'bounces smallint,', 'goal_assists smallint,',
      'brownlow_votes smallint,', 'career_game_no smallint,', 'jumper_number text,',
      'afltables_id text,', 'brownlow_round_number smallint,']) {
      expect(player).toContain(column);
    }
    const match = bodies.find((b) => b.includes('afltables_match '))!;
    // A recorded 0 crowd is real and must cite a source; an unrecorded one is
    // NULL and cites nothing. Migration 020's rule, held at this store too.
    expect(match).toContain('afltables_match_attendance_status_ck');
    expect(match).toContain('afltables_match_zero_attendance_ck');
    expect(match).not.toMatch(/\battendance\s+integer\s+NOT NULL/i);
    // Periods 1-4 only: fitzRoy carries extra time and the historical path
    // deliberately does not import it, so neither does this.
    for (const absent of ['q5', 'q6', 'q7', 'q8', '_et_', 'extra_time']) {
      expect(match).not.toContain(absent);
    }
    expect(new Set(match.match(/\b(?:home|away)_q[1-4]_(?:goals|behinds|points)\b/g)).size)
      .toBe(24);
    for (const side of ['home', 'away']) {
      for (const q of [1, 2, 3, 4]) {
        for (const kind of ['goals', 'behinds', 'points']) {
          expect(match).toContain(`${side}_q${q}_${kind} smallint`);
        }
      }
    }
  });

  it('makes an NA Brownlow vote structurally unable to become a row', () => {
    const player = statements.find((s) =>
      s.startsWith('CREATE TABLE staging.afltables_player_match'))!;
    expect(player).toContain('brownlow_votes IS NULL OR brownlow_votes BETWEEN 0 AND 3');
    // NULL votes and finals can never carry a proposed round-vote row.
    expect(player).toContain(
      'brownlow_round_number IS NULL OR (brownlow_votes IS NOT NULL '
      + 'AND is_final = false AND brownlow_round_number >= 1)');
  });

  it('deduplicates one open disagreement per key without touching other writers', () => {
    expect(statements).toContain('ALTER TABLE data_issues ADD COLUMN issue_key text');
    // Migration 072's convention: a partial unique index over unresolved rows
    // only, on plain columns. issue_key NULL rows are excluded entirely, so
    // every existing data_issues writer is unaffected, and resolved history is
    // unconstrained -- a recurrence UPDATEs the open row, a disappearance
    // RESOLVES it, and neither ever deletes.
    expect(statements).toContain(
      'CREATE UNIQUE INDEX uq_data_issues_open_by_key ON data_issues (issue_type, issue_key) '
      + 'WHERE issue_key IS NOT NULL AND resolved_at IS NULL');
    // Migration 072's own index must survive untouched.
    expect(executable).not.toContain('uq_data_issues_open_dob_per_player');
    expect(executable).not.toMatch(/\bDROP\b/i);
  });

  it('grants the minimum the v1 persistence path needs, and widens nothing', () => {
    const grants = statements.filter((s) => /^GRANT\b/i.test(s));
    expect(grants).toEqual([
      'GRANT SELECT, INSERT, UPDATE, DELETE ON staging.afltables_match TO afldb_import',
      'GRANT SELECT, INSERT, UPDATE, DELETE ON staging.afltables_player_match TO afldb_import',
      'GRANT SELECT ON staging.afltables_match TO afldb_app',
      'GRANT SELECT ON staging.afltables_player_match TO afldb_app',
    ]);
    // The pass upserts and reads back; it never truncates.
    for (const grant of grants) expect(grant).not.toMatch(/\bTRUNCATE\b|\bALL\b/i);
    // Migration 074's append-only ledger boundary is untouched, and no grant
    // reaches afldb_auth or any public table.
    expect(executable).not.toMatch(/promotion_decisions|promotion_candidates|afldb_auth/i);
    expect(executable).not.toMatch(/grant_import_write|grant_app_read/i);
  });

  it('needs no privileges.sql change, and does not make one', () => {
    // privileges.sql already grants the whole staging schema, so a reconcile
    // keeps these two tables without naming them. Registering them would be a
    // redundant second declaration of the same grant.
    expect(privilegesSql).toContain(
      "EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES "
      + "IN SCHEMA staging TO afldb_import'");
    expect(privilegesSql).toContain(
      "EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA staging TO afldb_app'");
    expect(privilegesSql).not.toContain('afltables_match');
    expect(privilegesSql).not.toContain('afltables_player_match');
  });
});

describe('S2 promotion ledger — acceptance fails closed', () => {
  it('accepts only when every gate passes', () => {
    expect(accept()).toEqual({ ok: true });
  });

  it('refuses when the source moved between render and accept', () => {
    expect(accept({}, { sourceVersionSeq: 4 }))
      .toEqual({ ok: false, refusal: 'stale_review', requeue: true });
  });

  it('refuses when the canonical target moved between render and accept', () => {
    expect(accept({}, { canonicalHash: 'b'.repeat(64) }))
      .toEqual({ ok: false, refusal: 'stale_canonical_target', requeue: true });
    // A target that disappeared is equally stale, not equally acceptable.
    expect(accept({}, { canonicalHash: null }))
      .toEqual({ ok: false, refusal: 'stale_canonical_target', requeue: true });
  });

  it('refuses a foreign-owned natural-key collision', () => {
    expect(evaluateOwnership(null, 'afltables')).toBe('ok');
    expect(evaluateOwnership('afltables', 'afltables')).toBe('ok');
    expect(evaluateOwnership('sports_data_lab', 'afltables')).toBe('foreign_owned_collision');
    expect(accept({}, { targetOwnerSourceKey: 'sports_data_lab' }))
      .toEqual({ ok: false, refusal: 'foreign_owned_collision', requeue: false });
  });

  it('refuses a season this pipeline does not own', () => {
    expect(evaluateAcceptance({
      candidate: candidate({ season: 2025 }),
      current: current(),
      inProgressSeasons: [2026],
      manualAuthority: AUTHORITY_CLEAR,
    })).toEqual({ ok: false, refusal: 'season_not_in_progress', requeue: false });
  });

  it('refuses on human authority, including when authority is unknown', () => {
    expect(accept({}, {}, () => 'conflict'))
      .toEqual({ ok: false, refusal: 'manual_authority_conflict', requeue: true });
    // The ISSUE-086 boundary: until that contract lands the provider is
    // unavailable, and unavailable refuses exactly as conflict does.
    expect(accept({}, {}, UNAVAILABLE_MANUAL_AUTHORITY))
      .toEqual({ ok: false, refusal: 'manual_authority_indeterminate', requeue: true });
  });

  it('asks the authority question without coupling to surrogate ids', () => {
    const asked: unknown[] = [];
    accept({}, {}, (query) => { asked.push(query); return 'clear'; });
    expect(asked).toHaveLength(1);
    const query = asked[0] as { entity: string; targetKey: Record<string, unknown>; fields: string[] };
    expect(query.entity).toBe('matches');
    expect(query.fields).toEqual(['home_score', 'away_score']);
    // An opaque key the caller fills in — ISSUE-086 owns what identifies a
    // row, and ISSUE-096 stores no override of its own.
    expect(Object.keys(query.targetKey)).toEqual(['season', 'round', 'home', 'away']);
    expect(spine).not.toMatch(/data_overrides|override_store/i);
  });

  it('refuses a candidate that is no longer pending', () => {
    expect(accept({ status: 'accepted' }))
      .toEqual({ ok: false, refusal: 'not_pending', requeue: false });
  });
});

describe('S2 provider provenance', () => {
  it('keeps two providers distinct even when their payloads agree', () => {
    // Squiggle 38494 and Kali 11405 are the same real-world match. Their
    // projected values can coincide; the observations must not.
    expect(observationKey('squiggle_api', 'match', '38494'))
      .not.toBe(observationKey('kali_afl_stats', 'match', '11405'));
    // Even an identical external id under two providers stays two records.
    expect(observationKey('squiggle_api', 'match', '1'))
      .not.toBe(observationKey('kali_afl_stats', 'match', '1'));
    // The same identical payload hashes the same, which is exactly why the
    // source must be part of the key rather than the content.
    const shared: JsonValue = { id: 1, hteam: 'Sydney' };
    expect(hashPayload(squiggleMatch, shared).hash).toBe(hashPayload(kaliMatch, shared).hash);
    // The schema carries source_id in every observation key and in the
    // candidate's evidence reference.
    expect(spine).toMatch(/PRIMARY KEY \(source_id, family, external_record_id\)/);
    expect(spine).toMatch(/FOREIGN KEY \(source_id, family, external_record_id, source_version_seq\)/);
  });

  it('reports witness GROUPS without turning them into a promotion rule', () => {
    // P1 made these two separate groups...
    expect(witnessGroups([{ contract: squiggleMatch }, { contract: kaliMatch }]))
      .toEqual(['kali', 'squiggle']);
    // ...while the proxied endpoint stays one.
    expect(witnessGroups([
      { contract: squiggleMatch },
      { contract: getSourceFamily(registry, 'kali_afl_stats', 'fixture') },
    ])).toEqual(['squiggle']);
    // Provider independence is NOT proven-distinct ultimate authority, so
    // agreement between two groups grants nothing on its own: acceptance
    // still runs the full gate, and no S2 code consults a witness count.
    const observations = readSource('src/lib/acquisition/observations.ts');
    const acceptance = observations.slice(
      observations.indexOf('export function evaluateAcceptance'),
      observations.indexOf('* Provider provenance'),
    );
    expect(acceptance).not.toContain('witnessGroups');
    expect(acceptance).not.toMatch(/agreeingGroups|consensus/);
  });

  it('resolves the numeric source id only at the persistence boundary', () => {
    const ids = new Map([['squiggle_api', 7]]);
    expect(resolveSourceId(ids, 'squiggle_api')).toBe(7);
    expect(() => resolveSourceId(ids, 'afl_api')).toThrow(/no sources row/);
    // No tracked contract stores a numeric id.
    expect(readFileSync('data/reference/source-families.json', 'utf8')).not.toContain('source_id');
  });
});


/*
 * AFLDB-ISSUE-096 S3 — reconciliation verbs, source ownership and the
 * ISSUE-086 authority interface (src/lib/acquisition/reconciliation.ts).
 *
 * DB-free, like S2: every fixture is a literal, the authority provider is
 * a stub, and no test touches a database or a live API. The subject is the
 * verb computed from a live payload against the stored open version —
 * the one thing S2 recorded as deliberately not built.
 */
import { PROMOTABLE_VERBS } from '@/lib/acquisition/observations';
import type {
  ManualAuthorityQuery,
  ManualAuthorityVerdict,
} from '@/lib/acquisition/observations';
import * as reconciliation from '@/lib/acquisition/reconciliation';
import {
  assertReconciliationVerb,
  classifyCorroboration,
  diffFields,
  evaluateReviewFreshness,
  evaluateTargetOwnership,
  reconcile,
  RECONCILIATION_VERBS,
  VERB_PRECEDENCE,
  type IdentityResolution,
  type ReconcileInput,
  type ReconciliationOutcome,
} from '@/lib/acquisition/reconciliation';

const reconciliationSource = readSource('src/lib/acquisition/reconciliation.ts');
const kaliFixture = getSourceFamily(registry, 'kali_afl_stats', 'fixture');

/** The canonical match row, and the three things a source might propose for it. */
const CANONICAL: Record<string, JsonValue> = {
  home_score: 132, away_score: 69, match_date: '2026-03-05 19:30:00', venue: 'SCG',
};
const PROPOSED_SCORE: Record<string, JsonValue> = { ...CANONICAL, away_score: 70 };
const PROPOSED_SCHEDULE: Record<string, JsonValue> = {
  ...CANONICAL, match_date: '2026-03-07 19:30:00', venue: 'MCG',
};

const RESOLVED_TARGET: IdentityResolution = {
  status: 'resolved',
  entity: 'matches',
  targetKey: { season: 2026, round: 0, home: 'Sydney', away: 'Carlton' },
  ownership: { state: 'owned', sourceKey: 'squiggle_api' },
};
const NEW_TARGET: IdentityResolution = {
  status: 'new_target',
  entity: 'matches',
  targetKey: { season: 2026, round: 0, home: 'Sydney', away: 'Carlton' },
};

function headFor(payload: JsonValue, overrides: Partial<ObservationHead> = {}): ObservationHead {
  const stored = hashPayload(squiggleMatch, payload);
  return {
    versionSeq: 1,
    payloadHash: stored.hash,
    hashRecipe: stored.recipe,
    rawPayload: payload,
    absentSince: null,
    ...overrides,
  };
}

/** A live poll of B against a stored A, resolving onto an owned canonical row. */
function reconcileInput(overrides: Partial<ReconcileInput> = {}): ReconcileInput {
  return {
    contract: squiggleMatch,
    externalRecordId: '38494',
    head: headFor(A),
    observed: { present: true, payload: B, observedAt: '2026-08-28T00:00:00Z' },
    identity: RESOLVED_TARGET,
    proposedValues: PROPOSED_SCORE,
    targetValues: CANONICAL,
    scheduleFields: ['match_date', 'venue'],
    recordState: 'played',
    manualAuthority: AUTHORITY_CLEAR,
    ...overrides,
  };
}

function authoritySpy(verdict: ManualAuthorityVerdict = 'clear') {
  const asked: ManualAuthorityQuery[] = [];
  const provider: ManualAuthorityProvider = (query) => {
    asked.push(query);
    return verdict;
  };
  return { asked, provider };
}

function candidateOf(outcome: ReconciliationOutcome) {
  if (outcome.kind !== 'candidate') throw new Error(`expected a candidate, got '${outcome.kind}'`);
  return outcome;
}

function refusalOf(outcome: ReconciliationOutcome) {
  if (outcome.kind !== 'refusal') throw new Error(`expected a refusal, got '${outcome.kind}'`);
  return outcome;
}

describe('S3 reconciliation — the verb vocabulary is frozen', () => {
  it('is exactly Decision C, with no synonyms', () => {
    expect([...RECONCILIATION_VERBS]).toEqual([
      'unchanged', 'new', 'corrected', 'rescheduled', 'absent', 'unresolved_identity',
      'source_disagreement', 'foreign_owned_collision', 'manual_authority_conflict', 'stale_review',
    ]);
    // The precedence order is a permutation of the vocabulary: every verb
    // is placed, and placement invents none.
    expect([...VERB_PRECEDENCE].sort()).toEqual([...RECONCILIATION_VERBS].sort());
    // The three that propose a canonical write are S2's, reused unchanged.
    expect([...PROMOTABLE_VERBS]).toEqual(['new', 'corrected', 'rescheduled']);
  });

  it('cannot emit an unrecognised verb', () => {
    for (const verb of RECONCILIATION_VERBS) {
      expect(assertReconciliationVerb(verb)).toBe(verb);
    }
    for (const notAVerb of ['update', 'insert', 'delete', 'promoted', 'conflict', 'UNCHANGED']) {
      expect(() => assertReconciliationVerb(notAVerb)).toThrow(/not a reconciliation verb/);
    }
  });
});

describe('S3 reconciliation — unchanged, new, corrected, rescheduled', () => {
  it('returns unchanged only on the family hash contract, and proposes nothing', () => {
    const authority = authoritySpy();
    const outcome = reconcile(reconcileInput({
      observed: { present: true, payload: A, observedAt: '2026-08-28T00:00:00Z' },
      manualAuthority: authority.provider,
    }));
    expect(outcome.kind).toBe('unchanged');
    expect(outcome).toMatchObject({ verb: 'unchanged', observation: { action: 'unchanged' } });
    expect(outcome).not.toHaveProperty('proposal');
    // No canonical or candidate semantics participate in `unchanged`, so
    // the authority question is never even asked.
    expect(authority.asked).toEqual([]);
  });

  it('leaves the S2 history semantics untouched when driven through reconcile', () => {
    const hashes = new Set<string>();
    const seqs: number[] = [];
    let head: ObservationHead | null = null;
    [A, B, A].forEach((payload, i) => {
      const outcome = reconcile(reconcileInput({
        head,
        observed: {
          present: true, payload, observedAt: `2026-08-28T0${i}:00:00Z`, knownPayloadHashes: hashes,
        },
      }));
      const observation = candidateOf(outcome).observation;
      if (observation.action !== 'append_version') throw new Error('expected a version append');
      seqs.push(observation.versionSeq);
      hashes.add(observation.payloadHash);
      head = {
        versionSeq: observation.versionSeq,
        payloadHash: observation.payloadHash,
        hashRecipe: observation.recipe,
        rawPayload: payload,
        absentSince: null,
      };
    });
    // A -> B -> A is still three ordered versions over two payloads.
    expect(seqs).toEqual([1, 2, 3]);
    expect(hashes.size).toBe(2);
  });

  it('proposes new only for a genuinely absent canonical target', () => {
    const authority = authoritySpy();
    const outcome = candidateOf(reconcile(reconcileInput({
      head: null,
      observed: { present: true, payload: A, observedAt: '2026-08-28T00:00:00Z' },
      identity: NEW_TARGET,
      proposedValues: CANONICAL,
      targetValues: null,
      manualAuthority: authority.provider,
    })));
    expect(outcome.verb).toBe('new');
    expect(outcome.proposal.fields).toEqual(['away_score', 'home_score', 'match_date', 'venue']);
    expect(outcome.observation).toMatchObject({ action: 'append_version', versionSeq: 1 });
    // ISSUE-096 §7 scopes the authority invariant to overwriting an active
    // human decision, and its implementation gate to candidates onto
    // EXISTING canonical rows. A row that does not exist carries no human
    // decision, so no question is asked here...
    expect(authority.asked).toEqual([]);
    // ...and the accept transaction still asks unconditionally, so a `new`
    // candidate cannot be written while authority is unavailable either.
    expect(evaluateAcceptance({
      candidate: candidate({ verb: 'new', baselineCanonicalHash: null }),
      current: current({ canonicalHash: null, targetOwnerSourceKey: null }),
      inProgressSeasons: [2026],
      manualAuthority: UNAVAILABLE_MANUAL_AUTHORITY,
    })).toEqual({ ok: false, refusal: 'manual_authority_indeterminate', requeue: true });
  });

  it('proposes corrected for a changed owned fact, naming only what moved', () => {
    const outcome = candidateOf(reconcile(reconcileInput()));
    expect(outcome.verb).toBe('corrected');
    expect(outcome.proposal.fields).toEqual(['away_score']);
    expect(outcome.proposal.entity).toBe('matches');
    expect(outcome.observation).toMatchObject({ action: 'append_version', versionSeq: 2 });
  });

  it('keeps rescheduled distinct from corrected, and never collapses the two', () => {
    // Schedule-only movement on an unplayed record.
    const moved = candidateOf(reconcile(reconcileInput({
      proposedValues: PROPOSED_SCHEDULE, recordState: 'unplayed',
    })));
    expect(moved.verb).toBe('rescheduled');
    expect(moved.proposal.fields).toEqual(['match_date', 'venue']);

    // A score moving alongside the date is a correction, never a reschedule.
    expect(candidateOf(reconcile(reconcileInput({
      proposedValues: { ...PROPOSED_SCHEDULE, away_score: 70 }, recordState: 'unplayed',
    }))).verb).toBe('corrected');

    // The same date movement on a PLAYED record is a correction: a played
    // match does not reschedule.
    expect(candidateOf(reconcile(reconcileInput({
      proposedValues: PROPOSED_SCHEDULE, recordState: 'played',
    }))).verb).toBe('corrected');

    // An unknown record state can never reschedule.
    expect(candidateOf(reconcile(reconcileInput({
      proposedValues: PROPOSED_SCHEDULE, recordState: 'unknown',
    }))).verb).toBe('corrected');

    // And a family that declares no schedule fields cannot produce one.
    expect(candidateOf(reconcile(reconcileInput({
      proposedValues: PROPOSED_SCHEDULE, recordState: 'unplayed', scheduleFields: [],
    }))).verb).toBe('corrected');
  });

  it('appends history without a candidate when no projected fact moved', () => {
    // Squiggle's `complete` advancing is a real source change and a real
    // new version, but it proposes nothing: Decision C's `corrected` needs
    // a differing FACT field, and an empty candidate would propose nothing
    // to a reviewer.
    const authority = authoritySpy();
    const outcome = reconcile(reconcileInput({
      observed: {
        present: true,
        payload: { ...(A as Record<string, JsonValue>), complete: 90 },
        observedAt: '2026-08-28T00:00:00Z',
      },
      proposedValues: CANONICAL,
      manualAuthority: authority.provider,
    }));
    expect(outcome.kind).toBe('history_only');
    expect(outcome).not.toHaveProperty('verb');
    expect(outcome).not.toHaveProperty('proposal');
    expect(outcome).toMatchObject({ observation: { action: 'append_version', versionSeq: 2 } });
    expect(authority.asked).toEqual([]);
  });

  it('diffs fields against the canonical row, or names all of them for a new row', () => {
    expect(diffFields(PROPOSED_SCORE, CANONICAL)).toEqual(['away_score']);
    expect(diffFields(CANONICAL, CANONICAL)).toEqual([]);
    expect(diffFields(CANONICAL, null)).toEqual(['away_score', 'home_score', 'match_date', 'venue']);
    // A field the canonical row does not carry at all is a change, not a match.
    expect(diffFields({ attendance: 41520 }, {})).toEqual(['attendance']);
  });
});

describe('S3 reconciliation — absence is an observation state only', () => {
  const missing = {
    present: false as const,
    scopeKey: 'season=2026,round=20',
    enumeratedScopeKeys: ['season=2026,round=20'],
  };

  it('reports absent without touching canonical data', () => {
    const authority = authoritySpy();
    const outcome = reconcile(reconcileInput({
      observed: missing, manualAuthority: authority.provider,
    }));
    expect(outcome).toEqual({
      kind: 'absent',
      verb: 'absent',
      externalRecordId: '38494',
      scopeKey: 'season=2026,round=20',
      canonicalChange: 'none',
    });
    expect(outcome).not.toHaveProperty('proposal');
    expect(authority.asked).toEqual([]);
  });

  it('refuses to assert absence outside the scope the fetch enumerated', () => {
    expect(() => reconcile(reconcileInput({
      observed: { ...missing, enumeratedScopeKeys: ['season=2026,round=19'] },
    }))).toThrow(/never checked/);
    expect(() => reconcile(reconcileInput({
      observed: { ...missing, enumeratedScopeKeys: [] },
    }))).toThrow(/never checked/);
  });
});

describe('S3 reconciliation — refusals fail closed', () => {
  it('refuses an identity it cannot resolve, and guesses nothing', () => {
    const authority = authoritySpy();
    const outcome = refusalOf(reconcile(reconcileInput({
      identity: { status: 'unresolved', reason: "venue 'Unknown' is not a canonical venue" },
      targetValues: null,
      manualAuthority: authority.provider,
    })));
    expect(outcome.verb).toBe('unresolved_identity');
    expect(outcome.detail).toBe('identity_unresolved');
    expect(outcome.note).toMatch(/Unknown/);
    // History still moved; only the promotion is refused.
    expect(outcome.observation).toMatchObject({ action: 'append_version' });
    expect(authority.asked).toEqual([]);
  });

  it('refuses a foreign-owned target and an owner it cannot read', () => {
    // The S2 predicate, read through the S3 states.
    expect(evaluateTargetOwnership({ state: 'unowned' }, 'squiggle_api'))
      .toEqual({ verdict: 'ok', basis: 'unowned' });
    expect(evaluateTargetOwnership({ state: 'owned', sourceKey: 'squiggle_api' }, 'squiggle_api'))
      .toEqual({ verdict: 'ok', basis: 'same_source' });
    expect(evaluateTargetOwnership({ state: 'owned', sourceKey: 'sports_data_lab' }, 'squiggle_api'))
      .toEqual({ verdict: 'foreign_owned_collision', detail: 'foreign_source_owner' });
    // Unknown provenance is NOT the same as a declared NULL owner: a
    // matching natural key never justifies adopting a row nobody can
    // attribute.
    expect(evaluateTargetOwnership({ state: 'indeterminate' }, 'squiggle_api'))
      .toEqual({ verdict: 'foreign_owned_collision', detail: 'ownership_indeterminate' });
    expect(evaluateOwnership(null, 'squiggle_api')).toBe('ok');

    const foreign = refusalOf(reconcile(reconcileInput({
      identity: { ...RESOLVED_TARGET, ownership: { state: 'owned', sourceKey: 'sports_data_lab' } },
    })));
    expect(foreign).toMatchObject({
      verb: 'foreign_owned_collision', detail: 'foreign_source_owner', requeue: false,
    });
    expect(refusalOf(reconcile(reconcileInput({
      identity: { ...RESOLVED_TARGET, ownership: { state: 'indeterminate' } },
    })))).toMatchObject({ verb: 'foreign_owned_collision', detail: 'ownership_indeterminate' });
    // A declared-unowned row is adoptable, exactly as Decision E says.
    expect(candidateOf(reconcile(reconcileInput({
      identity: { ...RESOLVED_TARGET, ownership: { state: 'unowned' } },
    }))).verb).toBe('corrected');
  });

  it('refuses foreign ownership before it ever asks about human authority', () => {
    const authority = authoritySpy('clear');
    refusalOf(reconcile(reconcileInput({
      identity: { ...RESOLVED_TARGET, ownership: { state: 'owned', sourceKey: 'sports_data_lab' } },
      manualAuthority: authority.provider,
      corroboration: [{ contract: kaliMatch, values: PROPOSED_SCORE }],
    })));
    expect(authority.asked).toEqual([]);
  });

  it('blocks on a disagreement between independence groups, not between sources', () => {
    // Kali is its own group since P1, so a conflicting Kali value is a
    // genuine second witness disagreeing.
    const authority = authoritySpy();
    const conflict = refusalOf(reconcile(reconcileInput({
      corroboration: [{ contract: kaliMatch, values: { away_score: 71 } }],
      manualAuthority: authority.provider,
    })));
    expect(conflict.verb).toBe('source_disagreement');
    expect(conflict.detail).toBe('independent_sources_disagree');
    expect(conflict.corroboration).toMatchObject({ ownGroup: 'squiggle', disagreeingGroups: ['kali'] });
    expect(authority.asked).toEqual([]);

    // Kali's /fixture endpoint is a proven Squiggle proxy in the SAME
    // group, so it is not a second witness and cannot raise the verb. Its
    // drift is still reported.
    const drift = candidateOf(reconcile(reconcileInput({
      corroboration: [{ contract: kaliFixture, values: { away_score: 71 } }],
    })));
    expect(drift.verb).toBe('corrected');
    expect(drift.proposal.corroboration).toMatchObject({
      disagreeingGroups: [], sameGroupConflicts: ['kali_afl_stats'],
    });
  });

  it('never lets provider agreement substitute for human authority', () => {
    // Two independence groups agreeing on the fact is recorded...
    const agreed = refusalOf(reconcile(reconcileInput({
      corroboration: [{ contract: kaliMatch, values: { away_score: 70 } }],
      manualAuthority: UNAVAILABLE_MANUAL_AUTHORITY,
    })));
    expect(agreed.corroboration).toMatchObject({ agreeingGroups: ['kali'], disagreeingGroups: [] });
    // ...and changes nothing: the authority gate still refuses, because
    // provider independence is not proven-distinct ultimate authority.
    expect(agreed.verb).toBe('manual_authority_conflict');
    expect(agreed.detail).toBe('authority_indeterminate');
    // The report itself is reporting-only, with no verdict in it.
    expect(classifyCorroboration(squiggleMatch, PROPOSED_SCORE, [
      { contract: kaliMatch, values: { away_score: 70 } },
    ])).toEqual({
      ownGroup: 'squiggle', agreeingGroups: ['kali'], disagreeingGroups: [], sameGroupConflicts: [],
    });
  });

  it('refuses on manual authority, and identically when authority is unknown', () => {
    const conflict = refusalOf(reconcile(reconcileInput({ manualAuthority: () => 'conflict' })));
    expect(conflict).toMatchObject({
      verb: 'manual_authority_conflict', detail: 'authority_conflict', requeue: true,
    });
    // The ISSUE-086 boundary: the shipped provider answers `indeterminate`
    // until that contract lands, and indeterminate refuses exactly as
    // conflict does.
    const unknown = refusalOf(reconcile(reconcileInput({
      manualAuthority: UNAVAILABLE_MANUAL_AUTHORITY,
    })));
    expect(unknown).toMatchObject({
      verb: 'manual_authority_conflict', detail: 'authority_indeterminate', requeue: true,
    });
    // Every non-clear verdict refuses; there is no third reading.
    for (const verdict of ['conflict', 'indeterminate'] as const) {
      expect(refusalOf(reconcile(reconcileInput({ manualAuthority: () => verdict }))).verb)
        .toBe('manual_authority_conflict');
    }
  });

  it('asks the authority question over an opaque target key and the touched fields', () => {
    const authority = authoritySpy();
    candidateOf(reconcile(reconcileInput({ manualAuthority: authority.provider })));
    expect(authority.asked).toHaveLength(1);
    expect(authority.asked[0].entity).toBe('matches');
    // Only the fields the promotion would actually write.
    expect(authority.asked[0].fields).toEqual(['away_score']);
    // An opaque key the caller fills in: no ISSUE-086 surrogate id, no
    // data_overrides table, no storage assumption of any kind.
    expect(Object.keys(authority.asked[0].targetKey)).toEqual(['season', 'round', 'home', 'away']);
    expect(reconciliationSource).not.toMatch(/data_overrides|override_store/);
  });

  it('refuses a review whose evidence has moved, distinctly from a source correction', () => {
    const head = headFor(A, { versionSeq: 3 });
    const fresh = {
      renderedSourceVersionSeq: 3,
      renderedBaselineCanonicalHash: 'a'.repeat(64),
      currentBaselineCanonicalHash: 'a'.repeat(64),
    };
    // A fresh review context changes nothing: an ordinary correction stays
    // an ordinary correction.
    expect(candidateOf(reconcile(reconcileInput({ head, review: fresh }))).verb).toBe('corrected');
    expect(evaluateReviewFreshness(fresh, head)).toBeNull();

    // The source moved under the reviewer.
    expect(refusalOf(reconcile(reconcileInput({
      head, review: { ...fresh, renderedSourceVersionSeq: 2 },
    })))).toMatchObject({ verb: 'stale_review', detail: 'source_version_moved', requeue: true });

    // The canonical baseline moved under the reviewer.
    expect(refusalOf(reconcile(reconcileInput({
      head, review: { ...fresh, currentBaselineCanonicalHash: 'b'.repeat(64) },
    })))).toMatchObject({ verb: 'stale_review', detail: 'canonical_baseline_moved', requeue: true });

    // Nothing downstream is computed from moved evidence.
    expect(refusalOf(reconcile(reconcileInput({
      head, review: { ...fresh, renderedSourceVersionSeq: 2 },
    }))).observation).toBeNull();

    // A first computation has no rendered evidence and cannot be stale.
    expect(evaluateReviewFreshness({
      renderedSourceVersionSeq: null,
      renderedBaselineCanonicalHash: null,
      currentBaselineCanonicalHash: null,
    }, null)).toBeNull();
  });
});

describe('S3 reconciliation — no write path, no force flag', () => {
  it('exports no override, force, consensus or write path', () => {
    expect(Object.keys(reconciliation)
      .filter((name) => /force|override|bypass|consensus|promote|write|commit|apply/i.test(name)))
      .toEqual([]);
    // Witness counting is S1's reporting helper and is deliberately not
    // re-exported here as a decision input.
    expect(Object.keys(reconciliation)).not.toContain('countIndependentWitnesses');
  });

  it('reaches no database, filesystem, network or clock', () => {
    const imported = [...reconciliationSource.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
    expect([...new Set(imported)].sort()).toEqual(['./observations', './source-families']);
  });

  it('cannot be called without an authority provider', () => {
    expect(() => reconcile(
      { ...reconcileInput(), manualAuthority: undefined } as unknown as ReconcileInput,
    )).toThrow(/no default and no bypass/);
  });

  it('produces only classified outcomes, and only a candidate carries a proposal', () => {
    const scenarios: ReconciliationOutcome[] = [
      reconcile(reconcileInput({
        observed: { present: true, payload: A, observedAt: '2026-08-28T00:00:00Z' },
      })),
      reconcile(reconcileInput()),
      reconcile(reconcileInput({
        observed: {
          present: false, scopeKey: 'season=2026', enumeratedScopeKeys: ['season=2026'],
        },
      })),
      reconcile(reconcileInput({ manualAuthority: UNAVAILABLE_MANUAL_AUTHORITY })),
      reconcile(reconcileInput({ proposedValues: CANONICAL })),
    ];
    expect(scenarios.map((outcome) => outcome.kind))
      .toEqual(['unchanged', 'candidate', 'absent', 'refusal', 'history_only']);
    for (const outcome of scenarios) {
      if ('verb' in outcome) {
        expect(RECONCILIATION_VERBS).toContain(outcome.verb);
      }
      if (outcome.kind !== 'candidate') expect(outcome).not.toHaveProperty('proposal');
    }
    // The strongest thing reconciliation can produce is a proposal a human
    // must still accept, at which point every gate is re-run in the
    // transaction.
    const proposal = candidateOf(scenarios[1]).proposal;
    expect(PROMOTABLE_VERBS).toContain(proposal.verb);
    expect(proposal.fields.length).toBeGreaterThan(0);
  });
});


/*
 * AFLDB-ISSUE-096 S4 — the promotion-review contract
 * (src/lib/acquisition/promotion-review.ts).
 *
 * DB-free, like S2 and S3: the candidate, the freshly re-read evidence and
 * the authority provider are all literals, and migration 074 is still
 * unapplied. The subject is what the review screen must render and what the
 * accept path must re-prove — including that it re-proves it and then still
 * writes nothing, because ISSUE-096 §7 gates the canonical write on
 * ISSUE-086's authority contract landing.
 */
import * as promotionReview from '@/lib/acquisition/promotion-review';
import {
  assertCandidateShape,
  baselineCanonicalHash,
  baselineCanonicalPreimage,
  BASELINE_HASH_RECIPE,
  buildRejectDecision,
  buildRequeueDecision,
  CANDIDATE_VERBS,
  draftCandidate,
  evaluateAcceptRequest,
  RECORDABLE_REFUSALS,
  renderReviewItem,
  requeueActionFor,
  type PromotionCandidateRecord,
  type ReviewEvidence,
} from '@/lib/acquisition/promotion-review';

const promotionReviewSource = readSource('src/lib/acquisition/promotion-review.ts');

/** The canonical match row as the review would re-read it — wider than the proposal. */
const TARGET_ROW: Record<string, JsonValue> = {
  home_score: 132, away_score: 69, match_date: '2026-03-05 19:30:00',
  venue: 'SCG', attendance: 41123,
};

/** One `corrected` candidate that passes every gate, so each test breaks exactly one. */
function reviewCandidate(
  overrides: Partial<PromotionCandidateRecord> = {},
): PromotionCandidateRecord {
  const fields = ['away_score'];
  return {
    id: 41,
    status: 'pending' as const,
    sourceKey: 'squiggle_api',
    family: 'match',
    independenceGroup: 'squiggle',
    externalRecordId: '38494',
    sourceVersionSeq: 2,
    verb: 'corrected' as const,
    season: 2026,
    entity: 'matches',
    targetTable: 'matches',
    targetId: 9001,
    targetKey: { season: 2026, round: 0, home: 'Sydney', away: 'Carlton' },
    fields,
    proposedValues: { away_score: 70 },
    baselineCanonicalHash: baselineCanonicalHash(fields, TARGET_ROW),
    agreeingGroups: [],
    disagreeingGroups: [],
    ...overrides,
  };
}

function reviewEvidence(overrides: Partial<ReviewEvidence> = {}): ReviewEvidence {
  return {
    sourceVersionSeq: 2,
    canonicalValues: TARGET_ROW,
    ownership: { state: 'owned', sourceKey: 'squiggle_api' },
    firstSeenAt: '2026-03-05T11:20:00Z',
    sourceUpdatedAt: '2026-03-05 22:16:49',
    ...overrides,
  };
}

function review(
  candidateOverrides: Partial<PromotionCandidateRecord> = {},
  evidenceOverrides: Partial<ReviewEvidence> = {},
  authority: ManualAuthorityProvider = AUTHORITY_CLEAR,
  inProgressSeasons: readonly number[] = [2026],
) {
  return renderReviewItem({
    candidate: reviewCandidate(candidateOverrides),
    evidence: reviewEvidence(evidenceOverrides),
    inProgressSeasons,
    manualAuthority: authority,
  });
}

function acceptRequest(
  candidateOverrides: Partial<PromotionCandidateRecord> = {},
  evidenceOverrides: Partial<ReviewEvidence> = {},
  authority: ManualAuthorityProvider = AUTHORITY_CLEAR,
  inProgressSeasons: readonly number[] = [2026],
) {
  return evaluateAcceptRequest({
    candidate: reviewCandidate(candidateOverrides),
    evidence: reviewEvidence(evidenceOverrides),
    inProgressSeasons,
    manualAuthority: authority,
    adminUserId: 7,
  });
}

function refusedAccept(evaluation: ReturnType<typeof acceptRequest>) {
  if (evaluation.verdict !== 'refused') {
    throw new Error(`expected a refusal, got '${evaluation.verdict}'`);
  }
  return evaluation;
}

/** The single executable statement carrying a named constraint. */
function statementWith(sql: string, needle: string): string {
  const statement = sqlStatements(sql).find((candidateStatement) => candidateStatement.includes(needle));
  if (!statement) throw new Error(`no statement mentions '${needle}'`);
  return statement;
}

function quotedValues(fragment: string): string[] {
  return [...fragment.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]).sort();
}

describe('S4 promotion review — the baseline canonical hash', () => {
  it('covers exactly the fields the promotion would write, and nothing else', () => {
    const fields = ['away_score'];
    const baseline = baselineCanonicalHash(fields, TARGET_ROW);

    // A canonical column the promotion does not touch cannot invalidate a
    // review: it is never projected into the preimage in the first place.
    expect(baselineCanonicalHash(fields, { ...TARGET_ROW, attendance: 55000, venue: 'MCG' }))
      .toBe(baseline);
    const preimage = baselineCanonicalPreimage(fields, TARGET_ROW);
    for (const untouched of ['attendance', 'venue', 'match_date', 'home_score']) {
      expect(preimage).not.toContain(untouched);
    }

    // A field the promotion WOULD write moving is exactly what must stale it.
    expect(baselineCanonicalHash(fields, { ...TARGET_ROW, away_score: 71 })).not.toBe(baseline);
    // And widening the proposal changes what the baseline covers.
    expect(baselineCanonicalHash(['away_score', 'home_score'], TARGET_ROW)).not.toBe(baseline);

    // char(64) in migration 074.
    expect(baseline).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic, and no ordering can change it', () => {
    const baseline = baselineCanonicalHash(['away_score', 'home_score'], TARGET_ROW);
    // Field order.
    expect(baselineCanonicalHash(['home_score', 'away_score'], TARGET_ROW)).toBe(baseline);
    // Property insertion order, at the top level and nested.
    const reordered: Record<string, JsonValue> = {};
    for (const key of Object.keys(TARGET_ROW).reverse()) reordered[key] = TARGET_ROW[key];
    expect(baselineCanonicalHash(['away_score', 'home_score'], reordered)).toBe(baseline);
    expect(baselineCanonicalHash(['detail'], { detail: { a: 1, b: 2 } }))
      .toBe(baselineCanonicalHash(['detail'], { detail: { b: 2, a: 1 } }));
    // Array order is content, not presentation, so it must NOT be normalised.
    expect(baselineCanonicalHash(['xs'], { xs: [1, 2] }))
      .not.toBe(baselineCanonicalHash(['xs'], { xs: [2, 1] }));
    // Repeated computation is stable.
    expect(baselineCanonicalHash(['away_score'], TARGET_ROW))
      .toBe(baselineCanonicalHash(['away_score'], TARGET_ROW));

    // It reuses S2's algorithm and version and carries NO exclusion list:
    // a family's payload exclusions are declared against source columns and
    // must never be applied to canonical values.
    expect(BASELINE_HASH_RECIPE).toBe('sha256/v1(canonical-fields)');
    expect(baselineCanonicalPreimage(['away_score'], TARGET_ROW)).toContain(BASELINE_HASH_RECIPE);
  });

  it('is null only where there is no target row, and refuses an unprovable field set', () => {
    // The `new` case migration 074's target_ck describes.
    expect(baselineCanonicalHash(['away_score'], null)).toBeNull();
    expect(() => baselineCanonicalHash([], TARGET_ROW)).toThrow(/empty set proves nothing/);
    expect(() => baselineCanonicalHash(['away_score', 'away_score'], TARGET_ROW))
      .toThrow(/cannot repeat a field/);
    // A field the read did not return is not a NULL value, and guessing
    // between them is the ambiguity the baseline exists to prevent.
    expect(() => baselineCanonicalHash(['brownlow_votes'], TARGET_ROW))
      .toThrow(/not read from the target row/);
  });
});

describe('S4 promotion review — what the reviewer is shown', () => {
  it('carries the approved candidate evidence, built from an S3 outcome', () => {
    const outcome = reconcile(reconcileInput());
    const candidate = draftCandidate({
      contract: squiggleMatch,
      externalRecordId: '38494',
      outcome,
      season: 2026,
      targetTable: 'matches',
      targetId: 9001,
      currentValues: CANONICAL,
    });

    // Everything §6 requires a candidate to carry.
    expect(candidate).toMatchObject({
      status: 'pending',
      sourceKey: 'squiggle_api',
      family: 'match',
      independenceGroup: 'squiggle',
      externalRecordId: '38494',
      sourceVersionSeq: 2,
      verb: 'corrected',
      season: 2026,
      targetTable: 'matches',
      targetId: 9001,
      fields: ['away_score'],
      proposedValues: { away_score: 70 },
      agreeingGroups: [],
      disagreeingGroups: [],
    });
    // proposed_fields is exactly what would be written — not the whole
    // projection — and the baseline covers exactly those fields.
    expect(Object.keys(candidate.proposedValues)).toEqual([...candidate.fields]);
    expect(candidate.baselineCanonicalHash)
      .toBe(baselineCanonicalHash(['away_score'], CANONICAL));

    const item = renderReviewItem({
      candidate: { ...candidate, id: 41 },
      evidence: reviewEvidence({ canonicalValues: CANONICAL }),
      inProgressSeasons: [2026],
      manualAuthority: AUTHORITY_CLEAR,
    });
    expect(item.source).toEqual({
      key: 'squiggle_api', family: 'match', independenceGroup: 'squiggle',
      externalRecordId: '38494', versionSeq: 2,
    });
    expect(item.target).toEqual({
      entity: 'matches', table: 'matches', id: 9001,
      key: { season: 2026, round: 0, home: 'Sydney', away: 'Carlton' },
    });
    // The per-field diff §6 says the super admin sees.
    expect(item.diff).toEqual([
      { field: 'away_score', proposed: 70, current: 69, absentFromTarget: false, changed: true },
    ]);
    expect(item.lineage).toEqual({
      firstSeenAt: '2026-03-05T11:20:00Z', sourceVersionSeq: 2,
      sourceUpdatedAt: '2026-03-05 22:16:49',
    });
    expect(item.baseline.matches).toBe(true);
    expect(item.reviewState).toBe('reviewable');

    // A new target carries no id and no baseline, per target_ck — even when
    // the caller offers one.
    const fresh = draftCandidate({
      contract: squiggleMatch,
      externalRecordId: '38494',
      outcome: reconcile(reconcileInput({ identity: NEW_TARGET, targetValues: null })),
      season: 2026,
      targetTable: 'matches',
      targetId: 9001,
      currentValues: null,
    });
    expect(fresh).toMatchObject({ verb: 'new', targetId: null, baselineCanonicalHash: null });

    // Outcomes that propose nothing never reach the queue at all.
    for (const quiet of ['unchanged', 'history_only']) {
      expect(() => draftCandidate({
        contract: squiggleMatch,
        externalRecordId: '38494',
        outcome: quiet === 'unchanged'
          ? reconcile(reconcileInput({
            observed: { present: true, payload: A, observedAt: '2026-08-28T00:00:00Z' },
          }))
          : reconcile(reconcileInput({ proposedValues: CANONICAL })),
        season: 2026,
        targetTable: 'matches',
        targetId: 9001,
        currentValues: CANONICAL,
      })).toThrow(/proposes nothing and creates no candidate/);
    }
  });

  it('stays current when an unrelated canonical field moves', () => {
    const item = review({}, { canonicalValues: { ...TARGET_ROW, attendance: 55000, venue: 'MCG' } });
    expect(item.baseline.matches).toBe(true);
    expect(item.refusalReason).toBeNull();
    expect(item.reviewState).toBe('reviewable');
    expect(item.reviewable).toBe(true);
  });

  it('goes stale when a proposed canonical field moves, and re-renders in place', () => {
    const authority = authoritySpy('clear');
    const item = renderReviewItem({
      candidate: reviewCandidate(),
      evidence: reviewEvidence({ canonicalValues: { ...TARGET_ROW, away_score: 71 } }),
      inProgressSeasons: [2026],
      manualAuthority: authority.provider,
    });
    expect(item.reviewState).toBe('stale');
    expect(item.refusalReason).toBe('stale_canonical_target');
    expect(item.baseline.matches).toBe(false);
    // The evidence is still the open version, so only the baseline is recomputed.
    expect(item.requeue).toEqual({
      action: 'rerender_in_place', candidateStatus: 'pending', recomputeBaseline: true,
    });
    expect(item.reviewable).toBe(false);
    // A gate that refuses earlier never lets authority be assumed clear.
    expect(authority.asked).toEqual([]);
    expect(item.authority).toBe('not_asked');
  });

  it('goes stale when the source version moves, and supersedes rather than re-rendering', () => {
    const item = review({}, { sourceVersionSeq: 3 });
    expect(item.reviewState).toBe('stale');
    expect(item.refusalReason).toBe('stale_review');
    // The reviewed version is no longer open, so the proposal must be
    // replaced by reconciliation, not patched — and the pending unique
    // index requires this one to leave 'pending' first.
    expect(item.requeue).toEqual({
      action: 'supersede_and_reconcile', candidateStatus: 'superseded', recomputeBaseline: true,
    });
    expect(item.authority).toBe('not_asked');
    // stale_review and stale_canonical_target stay distinct, exactly as S2
    // evaluates them.
    expect(review({}, { canonicalValues: { ...TARGET_ROW, away_score: 71 } }).refusalReason)
      .toBe('stale_canonical_target');
  });
});

describe('S4 promotion acceptance — every gate re-runs and fails closed', () => {
  it('refuses a candidate that is no longer pending, and records no decision', () => {
    const refusal = refusedAccept(acceptRequest({ status: 'rejected' }));
    expect(refusal).toMatchObject({ refusal: 'not_pending', requeue: null, decision: null });
    // 'not_pending' is not in the ledger's reason vocabulary, so no row is
    // invented for it.
    expect(RECORDABLE_REFUSALS).not.toContain('not_pending');
    expect(refusedAccept(acceptRequest({ status: 'accepted' })).refusal).toBe('not_pending');
  });

  it('refuses a verb that can never be promoted', () => {
    for (const verb of ['absent', 'source_disagreement', 'manual_authority_conflict'] as const) {
      const refusal = refusedAccept(acceptRequest(
        { verb, targetId: null, baselineCanonicalHash: null, fields: [], proposedValues: {} },
        { canonicalValues: null, ownership: null },
      ));
      expect(refusal.refusal).toBe('verb_not_promotable');
      expect(refusal.decision).toBeNull();
    }
  });

  it('refuses foreign and unreadable ownership before human authority is asked', () => {
    const foreign = authoritySpy('clear');
    const refusal = refusedAccept(evaluateAcceptRequest({
      candidate: reviewCandidate(),
      evidence: reviewEvidence({ ownership: { state: 'owned', sourceKey: 'afltables' } }),
      inProgressSeasons: [2026],
      manualAuthority: foreign.provider,
      adminUserId: 7,
    }));
    expect(refusal).toMatchObject({
      refusal: 'foreign_owned_collision', ownershipDetail: 'foreign_source_owner',
      authority: 'not_asked', canonicalChange: 'none',
    });
    expect(foreign.asked).toEqual([]);

    // Unknown provenance is not a declared NULL owner. A matching natural
    // key is never a reason to adopt a row nobody can attribute.
    expect(refusedAccept(acceptRequest({}, { ownership: { state: 'indeterminate' } })))
      .toMatchObject({
        refusal: 'foreign_owned_collision', ownershipDetail: 'ownership_indeterminate',
      });

    // A declared-unowned row is adoptable, exactly as Decision E says.
    expect(acceptRequest({}, { ownership: { state: 'unowned' } }).verdict).toBe('gates_cleared');
  });

  it('refuses an authority conflict and an indeterminate answer identically', () => {
    const conflict = refusedAccept(acceptRequest({}, {}, () => 'conflict'));
    expect(conflict).toMatchObject({
      refusal: 'manual_authority_conflict', authority: 'conflict', canonicalChange: 'none',
    });
    const unknown = refusedAccept(acceptRequest({}, {}, UNAVAILABLE_MANUAL_AUTHORITY));
    expect(unknown).toMatchObject({
      refusal: 'manual_authority_indeterminate', authority: 'indeterminate',
      canonicalChange: 'none',
    });
    // Both are queued for review, per ISSUE-096 §7 — the candidate stays
    // pending and unacceptable rather than being resolved away.
    for (const refusal of [conflict, unknown]) {
      expect(refusal.requeue).toEqual({
        action: 'rerender_in_place', candidateStatus: 'pending', recomputeBaseline: true,
      });
      expect(refusal.decision).toMatchObject({
        decision: 'requeue', newValues: null, previousValues: null, canonicalChange: 'none',
        candidateTransition: { status: 'pending', setsResolution: false },
      });
    }
  });

  it('does not let agreeing providers stand in for human authority', () => {
    // Two independence groups agreeing is a reporting fact, never authority
    // (ISSUE-096 §15.3): the same candidate still refuses.
    const corroborated = { agreeingGroups: ['afl_api', 'kali'], disagreeingGroups: [] };
    const refusal = refusedAccept(acceptRequest(corroborated, {}, UNAVAILABLE_MANUAL_AUTHORITY));
    expect(refusal.refusal).toBe('manual_authority_indeterminate');
    // And the reviewer still sees the corroboration.
    expect(review(corroborated).corroboration.agreeingGroups).toEqual(['afl_api', 'kali']);
  });

  it('refuses a season this pipeline does not own', () => {
    const refusal = refusedAccept(acceptRequest({}, {}, AUTHORITY_CLEAR, [2025]));
    expect(refusal.refusal).toBe('season_not_in_progress');
    // Recordable in the ledger, but it does not requeue: the candidate is
    // not returned to a queue it may never leave.
    expect(refusal.requeue).toBeNull();
    expect(refusal.decision).toBeNull();
    expect(refusedAccept(acceptRequest({}, {}, AUTHORITY_CLEAR, [])).refusal)
      .toBe('season_not_in_progress');
  });

  it('asks the authority question over an opaque key, never a surrogate id', () => {
    const authority = authoritySpy('clear');
    evaluateAcceptRequest({
      candidate: reviewCandidate(),
      evidence: reviewEvidence(),
      inProgressSeasons: [2026],
      manualAuthority: authority.provider,
      adminUserId: 7,
    });
    expect(authority.asked).toHaveLength(1);
    const [query] = authority.asked;
    expect(query).toEqual({
      entity: 'matches',
      targetKey: { season: 2026, round: 0, home: 'Sydney', away: 'Carlton' },
      fields: ['away_score'],
    });
    // ISSUE-086 owns the storage; this pipeline hands it no surrogate id and
    // no assumption about one.
    expect(JSON.stringify(query)).not.toContain('9001');
    expect(promotionReviewSource).not.toMatch(/data_overrides/);
  });

  it('produces no acceptance result while the shipped authority provider is fail-closed', () => {
    // Every verb that could ever propose a write, under the provider that
    // ships until ISSUE-086's contract lands.
    const promotable: Partial<PromotionCandidateRecord>[] = [
      { verb: 'corrected' },
      { verb: 'rescheduled' },
      { verb: 'new', targetId: null, baselineCanonicalHash: null },
    ];
    for (const overrides of promotable) {
      const evaluation = acceptRequest(
        overrides,
        overrides.verb === 'new' ? { canonicalValues: null, ownership: null } : {},
        UNAVAILABLE_MANUAL_AUTHORITY,
      );
      expect(evaluation.verdict).toBe('refused');
      expect(evaluation.canonicalChange).toBe('none');
    }
  });

  it('never claims a canonical write, even when every gate clears', () => {
    const cleared = acceptRequest();
    expect(cleared).toEqual({
      verdict: 'gates_cleared',
      authority: 'clear',
      canonicalChange: 'none',
      write: { implemented: false, blockedBy: 'canonical_write_unimplemented' },
      decision: null,
    });
    // There is no accept decision to record, because nothing was written.
    expect(promotionReview).not.toHaveProperty('buildAcceptDecision');
  });

  it('exposes no force, override, bypass or consensus path, and reaches nothing external', () => {
    expect(Object.keys(promotionReview)
      .filter((name) => /force|override|bypass|consensus|auto_?promote/i.test(name)))
      .toEqual([]);
    const imported = [...promotionReviewSource.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect([...new Set(imported)].sort())
      .toEqual(['./observations', './reconciliation', './source-families', 'node:crypto']);
  });
});

describe('S4 promotion decisions — append-only, and never an accept', () => {
  it('rejects without changing a canonical fact or a source observation', () => {
    const draft = buildRejectDecision({
      candidate: reviewCandidate(),
      adminUserId: 7,
      note: 'the match sheet disagrees with the feed',
    });
    expect(draft).toEqual({
      candidateId: 41,
      decision: 'reject',
      refusalReason: null,
      adminUserId: 7,
      previousValues: null,
      newValues: null,
      note: 'the match sheet disagrees with the feed',
      canonicalChange: 'none',
      candidateTransition: { status: 'rejected', setsResolution: true },
    });
    // A reject carries no field that could become a source or canonical
    // mutation later: no payload, no version, no absence, no values.
    for (const forbidden of ['payload', 'versionSeq', 'absentSince', 'targetId', 'proposedValues']) {
      expect(Object.keys(draft)).not.toContain(forbidden);
    }
    // Only a live candidate can be decided, and only a stored one.
    expect(() => buildRejectDecision({ candidate: reviewCandidate({ status: 'rejected' }), adminUserId: 7 }))
      .toThrow(/already been decided/);
    expect(() => buildRejectDecision({ candidate: reviewCandidate({ id: null }), adminUserId: 7 }))
      .toThrow(/stored candidate/);
    expect(() => buildRejectDecision({ candidate: reviewCandidate(), adminUserId: 0 }))
      .toThrow(/must name the super admin/);
  });

  it('keeps requeue and supersede consistent with the candidate resolution rule', () => {
    expect(buildRequeueDecision({
      candidate: reviewCandidate(), refusal: 'stale_canonical_target', adminUserId: 7,
    })).toMatchObject({
      decision: 'requeue', refusalReason: 'stale_canonical_target',
      candidateTransition: { status: 'pending', setsResolution: false },
    });
    expect(buildRequeueDecision({
      candidate: reviewCandidate(), refusal: 'stale_review', adminUserId: 7,
    })).toMatchObject({
      candidateTransition: { status: 'superseded', setsResolution: true },
    });
    // Refusals that are not decisions about a promotion cannot be recorded.
    expect(() => buildRequeueDecision({
      candidate: reviewCandidate(), refusal: 'not_pending', adminUserId: 7,
    })).toThrow(/not a refusal the decision ledger can record/);
    expect(() => buildRequeueDecision({
      candidate: reviewCandidate(), refusal: 'season_not_in_progress', adminUserId: 7,
    })).toThrow(/does not requeue/);
    // Exactly the refusals S2 marks requeueable are the ones that requeue.
    expect(RECORDABLE_REFUSALS.filter((refusal) => requeueActionFor(refusal) !== null))
      .toEqual([
        'stale_review', 'stale_canonical_target',
        'manual_authority_conflict', 'manual_authority_indeterminate',
      ]);
  });

  it('records only refusals migration 074 can store', () => {
    const reasons = quotedValues(
      /refusal_reason IN \(([^)]*)\)/
        .exec(statementWith(spine, 'promotion_decisions_reason_ck'))?.[1] ?? '',
    );
    for (const refusal of RECORDABLE_REFUSALS) expect(reasons).toContain(refusal);
    // The two acceptance refusals that are not decisions about a promotion.
    expect(reasons).not.toContain('not_pending');
    expect(reasons).not.toContain('verb_not_promotable');
    // S4 adds no grant, no table and no migration of its own: the ledger
    // stays append-only exactly as S2 left it.
    expect(promotionReviewSource).not.toMatch(/GRANT|CREATE TABLE|ALTER TABLE/);
  });

  it('holds the candidate to migration 074 CHECK constraints before a row exists', () => {
    const verbs = quotedValues(
      /promotion_candidates_verb_ck CHECK \(verb IN \(([^)]*)\)\)/
        .exec(statementWith(spine, 'promotion_candidates_verb_ck'))?.[1] ?? '',
    );
    expect(verbs).toEqual([...CANDIDATE_VERBS].sort());
    // 'unchanged' produces no diff, so it can never become a candidate.
    expect(verbs).not.toContain('unchanged');

    expect(() => assertCandidateShape(reviewCandidate())).not.toThrow();
    expect(() => assertCandidateShape(reviewCandidate({ verb: 'new' })))
      .toThrow(/no target id and no baseline/);
    expect(() => assertCandidateShape(reviewCandidate({ baselineCanonicalHash: null })))
      .toThrow(/both a target id and a baseline hash, or neither/);
    expect(() => assertCandidateShape(reviewCandidate({
      verb: 'absent', targetId: null, baselineCanonicalHash: null,
    }))).toThrow(/proposes nothing/);
    expect(() => assertCandidateShape(reviewCandidate({
      status: 'accepted', verb: 'source_disagreement', targetId: null, baselineCanonicalHash: null,
      fields: [], proposedValues: {},
    }))).toThrow(/can never reach 'accepted'/);
    // The proposed field set and the proposed values are the same fields.
    expect(() => assertCandidateShape(reviewCandidate({ proposedValues: { away_score: 70, venue: 'MCG' } })))
      .toThrow(/exactly the same fields/);
  });
});


/*
 * AFLDB-ISSUE-099 T6b — the AFL Tables settle contract, DB-free.
 *
 * The semantic home §24 names for "registry + reconciliation, DB-free":
 * bundle validation refusals, the ownership-`indeterminate` supply rule, the
 * corroboration field set, `issue_key` derivation and the per-target
 * projection rules. Every fixture is a literal and every call is pure — no
 * snapshot on disk, no database, no clock.
 */
import {
  agreementRestored,
  contractFamilyOf,
  disagreementConflicts,
  disagreementSeverity,
  draftDisagreementIssue,
  ownershipForTarget,
  planAbsenceSweep,
  proposedBrownlowValues,
  proposedFieldsFor,
  proposedMatchValues,
  proposedPeriodScoreValues,
  proposedPlayerMatchValues,
  readMatchProjection,
  readPlayerMatchProjection,
  resolveManifestPath,
  settleIssueKey,
  targetEstablishedBySource,
  validateSettleBundle,
  BROWNLOW_ROUND_VOTES_PROPOSED_FIELDS,
  CORROBORATED_MATCH_FIELDS,
  MATCHES_PROPOSED_FIELDS,
  PLAYER_MATCH_STATS_PROPOSED_FIELDS,
  PLAYER_MATCH_STAT_COLUMNS,
  SETTLE_ISSUE_OWNER,
  SETTLE_ISSUE_TYPE,
  TARGETS_WITHOUT_SOURCE_ID,
  type SettleTargetTable,
} from '@/lib/acquisition/settle-afltables';

const afltablesMatch = getSourceFamily(registry, 'afltables', 'match');
const afltablesPlayerMatch = getSourceFamily(registry, 'afltables', 'player_match_stats');

const SETTLE_LABEL = 'settle-2026-08-29';
const MANIFEST_SHA = 'a'.repeat(64);
const MATCH_RECORD = '2026|1|2026-03-05|Sydney|Carlton';
const PLAYER_RECORD = 'players/M/Marc_Murphy.html@2026|1|2026-03-05|Sydney|Carlton';
const SETTLE_SCOPE = 'season=2026';

/** The canonical ids the settle resolver looks up inside the transaction. */
const RESOLVED_MATCH = {
  homeClubId: 11, awayClubId: 3, venueId: 42, winnerClubId: 11, attendanceSourceId: 9,
};

function matchProjectionJson(over: Record<string, JsonValue> = {}): JsonValue {
  return {
    match_key: MATCH_RECORD,
    season: 2026,
    round_code: '1',
    round_number: 1,
    round_type: 'home_and_away',
    is_final: false,
    match_date: '2026-03-05',
    match_time: '7:30 PM',
    venue_raw: 'S.C.G.',
    home_club_hist: 'sydney',
    away_club_hist: 'carlton',
    home_club_name: 'Sydney',
    away_club_name: 'Carlton',
    home_goals: 20, home_behinds: 12, home_score: 132,
    away_goals: 10, away_behinds: 9, away_score: 69,
    result: 'home_win', winner_club_hist: 'sydney', margin: 63,
    attendance: 42123, attendance_status: 'complete', attendance_source_key: 'afltables',
    period_scores: [
      { side: 'home', period: 1, goals: 5, behinds: 3, points: 33 },
      { side: 'away', period: 1, goals: 2, behinds: 2, points: 14 },
    ],
    ...over,
  };
}

function playerProjectionJson(over: Record<string, JsonValue> = {}): JsonValue {
  const stats: Record<string, JsonValue> = {};
  for (const column of PLAYER_MATCH_STAT_COLUMNS) stats[column] = 4;
  stats.brownlow_votes = null;
  return {
    url: 'players/M/Marc_Murphy.html',
    afltables_id: null,
    match_key: MATCH_RECORD,
    season: 2026,
    round_code: '1',
    round_number: 1,
    is_final: false,
    club_hist: 'carlton',
    career_game_no: 301,
    jumper_number: '3',
    stats,
    brownlow_round_vote: null,
    ...over,
  };
}

type SettleBundleOverrides = {
  root?: Record<string, JsonValue>;
  matchRecord?: Record<string, JsonValue>;
  playerRecord?: Record<string, JsonValue>;
  matchEnumeration?: Record<string, JsonValue>;
  playerEnumeration?: Record<string, JsonValue>;
};

function settleBundleJson(over: SettleBundleOverrides = {}): JsonValue {
  return {
    bundle_contract_version: 1,
    generated_by: 'tools/migration/import_fitzroy_core.py',
    snapshot_label: SETTLE_LABEL,
    manifest_path: 'docs/rebuild-manifests/afltables_fitzroy_core/settle-2026-08-29.json',
    manifest_sha256: MANIFEST_SHA,
    acquisition_kind: 'in_season_partial',
    season: 2026,
    fitzroy_version: '1.8.0',
    enumerations: [
      {
        family: 'afltables.match', scope_key: SETTLE_SCOPE, complete: true,
        incomplete_reason: null, external_record_ids: [MATCH_RECORD],
        ...over.matchEnumeration,
      },
      {
        family: 'afltables.player_match_stats', scope_key: SETTLE_SCOPE, complete: true,
        incomplete_reason: null, external_record_ids: [PLAYER_RECORD],
        ...over.playerEnumeration,
      },
    ],
    records: [
      {
        family: 'afltables.match', scope_key: SETTLE_SCOPE, external_record_id: MATCH_RECORD,
        payload: { season: 2026 },
        observed_columns: [...(afltablesMatch.knownColumns ?? [])],
        projection: matchProjectionJson(),
        rejection: null,
        ...over.matchRecord,
      },
      {
        family: 'afltables.player_match_stats', scope_key: SETTLE_SCOPE,
        external_record_id: PLAYER_RECORD,
        payload: { url: 'players/M/Marc_Murphy.html' },
        observed_columns: [...(afltablesPlayerMatch.knownColumns ?? [])],
        projection: playerProjectionJson(),
        rejection: null,
        ...over.playerRecord,
      },
    ],
    unkeyed_rejections: [],
    counts: { matches: 1, player_match_rows: 1, rejections: 0, unkeyed_rejections: 0 },
    ...over.root,
  } as JsonValue;
}

function settleValidate(over: SettleBundleOverrides = {}, expectedLabel = SETTLE_LABEL) {
  return validateSettleBundle({
    raw: settleBundleJson(over),
    expectedSnapshotLabel: expectedLabel,
    actualManifestSha256: MANIFEST_SHA,
    inProgressSeasons: [2026],
    registry,
  });
}

describe('AFLDB-ISSUE-099 settle — the observation bundle is validated fail-closed', () => {
  it('accepts a well-formed in-season bundle and reads both AFL Tables families', () => {
    const bundle = settleValidate();
    expect(bundle.season).toBe(2026);
    expect(bundle.acquisitionKind).toBe('in_season_partial');
    expect(bundle.records.map((record) => record.family).sort())
      .toEqual(['afltables.match', 'afltables.player_match_stats']);
    // The dotted name is the wire form; the registry key is the pair.
    expect(contractFamilyOf('afltables.match')).toBe('match');
    expect(contractFamilyOf('afltables.player_match_stats')).toBe('player_match_stats');
    expect(() => contractFamilyOf('afltables.ladder'))
      .toThrow(/not an AFLDB-ISSUE-099 source family/);
  });

  it('refuses a bundle contract version it does not speak, rather than tolerating it', () => {
    expect(() => settleValidate({ root: { bundle_contract_version: 2 } }))
      .toThrow(/version 2 is not supported/);
    expect(() => settleValidate({ root: { bundle_contract_version: '1' } }))
      .toThrow(/must be an integer/);
  });

  /**
   * AFLDB-ISSUE-099 T8 regression. The real 2026 dry-run died before any
   * connection was opened, on
   *
   *   ENOENT ... 'D:\dev\afldb-issue-099\D:\dev\afldb-issue-099\docs\
   *               rebuild-manifests\afltables_fitzroy_core\<label>.json'
   *
   * because the emitter's `manifest_path` is always absolute and the CLI
   * joined it onto the repository root a second time. These cases are written
   * against the resolution boundary itself, so they need no snapshot, no
   * bundle and no database -- and they are platform-native rather than
   * Windows-only, because the same defect doubles a POSIX path too.
   */
  describe('the manifest path a bundle names', () => {
    // Absolute on both platforms: a drive-qualified path on Windows, a rooted
    // one on Linux. `resolve` is only being used to spell "absolute" portably.
    const root = resolve('/dev/afldb-issue-099');
    const relative = 'docs/rebuild-manifests/afltables_fitzroy_core/issue099-t8-20260829.json';
    // Exactly what the emitter writes: absolute, forward-slashed.
    const emitted = `${root.replace(/\\/g, '/')}/${relative}`;

    it('never re-prefixes an absolute path the emitter already resolved', () => {
      const resolved = resolveManifestPath(root, emitted);

      expect(resolved).toBe(resolve(root, relative));
      // The doubled-path symptom, stated directly: the root must appear once.
      expect(resolved.indexOf(root)).toBe(resolved.lastIndexOf(root));
    });

    it('keeps an absolute path outside the worktree, rather than rewriting it', () => {
      const elsewhere = resolve('/srv/snapshots/afltables/issue099-t8-20260829.json');
      expect(resolveManifestPath(root, elsewhere)).toBe(elsewhere);
    });

    it('still resolves a repository-relative path against this worktree root', () => {
      expect(resolveManifestPath(root, relative)).toBe(resolve(root, relative));
    });

    it('refuses rather than guessing when it has nothing absolute to work from', () => {
      expect(() => resolveManifestPath(root, ''))
        .toThrow(/names no manifest_path/);
      // A relative base would silently make the manifest depend on the
      // directory the operator started in. That is not a resolution.
      expect(() => resolveManifestPath('afldb-issue-099', relative))
        .toThrow(/repository root must be absolute/);
    });
  });

  it('refuses a bundle that does not describe the requested snapshot or its manifest', () => {
    expect(() => settleValidate({}, 'settle-2026-08-30'))
      .toThrow(/is not the requested snapshot/);
    expect(() => validateSettleBundle({
      raw: settleBundleJson(),
      expectedSnapshotLabel: SETTLE_LABEL,
      actualManifestSha256: 'b'.repeat(64),
      inProgressSeasons: [2026],
      registry,
    })).toThrow(/does not match the manifest on disk/);
  });

  it('reads only an in-season snapshot, and only a season this pipeline owns', () => {
    expect(() => settleValidate({ root: { acquisition_kind: 'full_history' } }))
      .toThrow(/reads only 'in_season_partial' snapshots/);
    expect(() => validateSettleBundle({
      raw: settleBundleJson(),
      expectedSnapshotLabel: SETTLE_LABEL,
      actualManifestSha256: MANIFEST_SHA,
      inProgressSeasons: [2025],
      registry,
    })).toThrow(/not in in_progress_seasons/);
  });

  it('runs the projection gate on every record: drift refuses, it never NULLs', () => {
    expect(() => settleValidate({
      matchRecord: { observed_columns: [...(afltablesMatch.knownColumns ?? []), 'weather'] },
    })).toThrow(/undeclared column\(s\): weather/);
    expect(() => settleValidate({
      matchRecord: { observed_columns: ['season', 'round_code'] },
    })).toThrow(/missing required column/);
  });

  it('refuses any disagreement between the presence enumeration and the records', () => {
    // A record the enumeration does not list: presence would be understated.
    expect(() => settleValidate({ matchEnumeration: { external_record_ids: ['2026|1|other'] } }))
      .toThrow(/is not listed in the afltables\.match enumeration/);
    // A complete enumeration listing a record the bundle does not carry.
    expect(() => settleValidate({
      matchEnumeration: { external_record_ids: [MATCH_RECORD, '2026|1|missing'] },
    })).toThrow(/carries no record for it/);
    // A record in a scope nobody enumerated.
    expect(() => settleValidate({ matchRecord: { scope_key: 'season=2025' } }))
      .toThrow(/which the bundle does not enumerate/);
  });

  it('refuses an unkeyed rejection whose scope still claims to be complete (SC5)', () => {
    expect(() => settleValidate({
      root: {
        unkeyed_rejections: [{
          family: 'afltables.player_match_stats', scope_key: SETTLE_SCOPE,
          reason: 'no_profile_url', detail: 'player_stats_2026.csv line 4821',
        }],
      },
    })).toThrow(/claims complete: true/);
  });
});

describe('AFLDB-ISSUE-099 settle — presence and projection are separate facts (§19)', () => {
  it('keeps an observed-but-rejected record present and enumerated (I1)', () => {
    const bundle = settleValidate({
      matchRecord: {
        projection: null,
        rejection: { reason: 'incomplete_match_evidence', detail: 'no player_stats row joined' },
      },
    });
    const record = bundle.records.find((row) => row.family === 'afltables.match');
    expect(record?.projection).toBeNull();
    expect(record?.rejection?.reason).toBe('incomplete_match_evidence');
    // Still enumerated, so the sweep sees it as seen rather than absent.
    const enumeration = bundle.enumerations.find((row) => row.family === 'afltables.match');
    expect(enumeration?.complete).toBe(true);
    expect(enumeration?.externalRecordIds).toContain(MATCH_RECORD);
  });

  it('sweeps only proven-complete scopes and reports the ones it deliberately skipped (I2)', () => {
    const plan = planAbsenceSweep(settleValidate({
      root: {
        unkeyed_rejections: [{
          family: 'afltables.player_match_stats', scope_key: SETTLE_SCOPE,
          reason: 'no_profile_url', detail: 'player_stats_2026.csv line 4821',
        }],
      },
      playerEnumeration: {
        complete: false,
        incomplete_reason: '1 observed row(s) had no provable identity',
      },
    }));
    expect(plan.sweepable)
      .toEqual([{ family: 'afltables.match', contractFamily: 'match', scopeKey: SETTLE_SCOPE }]);
    expect(plan.skipped).toEqual([{
      family: 'afltables.player_match_stats',
      scopeKey: SETTLE_SCOPE,
      reason: '1 observed row(s) had no provable identity',
    }]);
  });

  it('sweeps every scope when the whole bundle is proven complete (I3)', () => {
    const plan = planAbsenceSweep(settleValidate());
    expect(plan.skipped).toEqual([]);
    expect(plan.sweepable.map((scope) => scope.contractFamily).sort())
      .toEqual(['match', 'player_match_stats']);
  });
});

describe('AFLDB-ISSUE-099 settle — ownership, data_issues identity and corroboration', () => {
  it('supplies indeterminate ownership for a target that carries no source_id column', () => {
    expect(TARGETS_WITHOUT_SOURCE_ID).toEqual(['match_period_scores', 'brownlow_round_votes']);
    for (const target of TARGETS_WITHOUT_SOURCE_ID) {
      // Never 'unowned': a table with no provenance column has not DECLARED an
      // absence of ownership, it cannot answer. Indeterminate fails closed.
      expect(ownershipForTarget(target, null)).toEqual({ state: 'indeterminate' });
      expect(ownershipForTarget(target, 'afltables')).toEqual({ state: 'indeterminate' });
    }
    expect(ownershipForTarget('matches', null)).toEqual({ state: 'unowned' });
    expect(ownershipForTarget('matches', 'squiggle_api'))
      .toEqual({ state: 'owned', sourceKey: 'squiggle_api' });
  });

  it('derives one stable data_issues key per source, family, record and target', () => {
    expect(settleIssueKey('afltables.match', MATCH_RECORD, 'matches'))
      .toBe(`afltables|match|${MATCH_RECORD}|matches`);
    // The contract family, not the wire name: never 'afltables|afltables.match'.
    expect(settleIssueKey('afltables.match', MATCH_RECORD, 'matches'))
      .not.toContain('afltables.match');
    // The target is part of the key, so two targets of one record never collide.
    expect(settleIssueKey('afltables.match', MATCH_RECORD, 'match_period_scores'))
      .not.toBe(settleIssueKey('afltables.match', MATCH_RECORD, 'matches'));
    expect(() => settleIssueKey('afltables.match', '', 'matches'))
      .toThrow(/needs the external record id/);
    expect(SETTLE_ISSUE_TYPE).toBe('source_disagreement');
    expect(SETTLE_ISSUE_OWNER).toBe('AFLDB-ISSUE-099');
  });

  it('compares other providers on the shared match fields only, and escalates a score conflict', () => {
    expect(CORROBORATED_MATCH_FIELDS).toEqual(['home_score', 'away_score', 'attendance']);
    expect(disagreementSeverity(['attendance'])).toBe('warning');
    expect(disagreementSeverity(['home_score'])).toBe('error');
    expect(disagreementSeverity(['attendance', 'away_score'])).toBe('error');
  });
});

/**
 * §13 — the one `data_issues` row ISSUE-099 writes, drafted purely.
 *
 * Every draft here is built from a REAL `classifyCorroboration()` report over
 * real registry contracts, so the conflicts a row shows can never drift from
 * the groups that classified it.
 */
type MatchClaim = { contract: typeof squiggleMatch; values: Record<string, JsonValue> };

/** A second source inside another provider's OWN independence group. */
function mirrorOf(contract: typeof squiggleMatch, sourceKey: string) {
  return { ...contract, sourceKey };
}

describe('AFLDB-ISSUE-099 settle — the data_issues disagreement draft (§13)', () => {
  const PROPOSED = { home_score: 132, away_score: 69, attendance: 42123 };

  function claim(contract: typeof squiggleMatch, values: Record<string, JsonValue>): MatchClaim {
    return { contract, values };
  }

  function draft(
    claims: readonly MatchClaim[],
    over: { targetId?: number | null } = {},
  ) {
    return draftDisagreementIssue({
      wireFamily: 'afltables.match',
      externalRecordId: MATCH_RECORD,
      targetTable: 'matches',
      targetId: over.targetId === undefined ? 5150 : over.targetId,
      sourceVersionSeq: 3,
      proposedValues: PROPOSED,
      claims,
      corroboration: classifyCorroboration(afltablesMatch, PROPOSED, claims),
    });
  }

  it('drafts §13.1 exactly for a single disagreeing group', () => {
    const row = draft([claim(squiggleMatch, { home_score: 130, away_score: 69 })]);

    expect(row.entityType).toBe('matches');
    expect(row.entityId).toBe(5150);
    expect(row.issueType).toBe('source_disagreement');
    expect(row.issueKey).toBe(`afltables|match|${MATCH_RECORD}|matches`);
    // A score conflict on a completed match escalates.
    expect(row.severity).toBe('error');
    expect(row.description).toContain('home_score');
    expect(row.description.split('\n')).toHaveLength(1);
    expect(row.details).toEqual({
      owner: 'AFLDB-ISSUE-099',
      source_key: 'afltables',
      family: 'match',
      external_record_id: MATCH_RECORD,
      target_table: 'matches',
      source_version_seq: 3,
      agreeing_groups: [],
      disagreeing_groups: ['squiggle'],
      // Only the field that actually differs: away_score agrees, and
      // attendance is not shared, so neither is reported as a conflict.
      conflicts: [{ field: 'home_score', afltables: 132, squiggle: 130 }],
    });
  });

  it('stamps the owner that alone authorises this pass to resolve the row later', () => {
    const row = draft([claim(squiggleMatch, { home_score: 130, away_score: 69 })]);
    expect(row.details.owner).toBe(SETTLE_ISSUE_OWNER);
    expect(row.issueType).toBe(SETTLE_ISSUE_TYPE);
  });

  it('reports a target that does not exist yet with a NULL entity id', () => {
    const row = draft([claim(squiggleMatch, { home_score: 130, away_score: 69 })], {
      targetId: null,
    });
    expect(row.entityId).toBeNull();
    expect(row.issueKey).toBe(`afltables|match|${MATCH_RECORD}|matches`);
  });

  it('merges two disagreeing groups into ONE object per field, in a deterministic key order', () => {
    const row = draft([
      claim(kaliMatch, { home_score: 128, away_score: 69 }),
      claim(squiggleMatch, { home_score: 130, away_score: 69 }),
    ]);

    expect(row.details.disagreeing_groups).toEqual(['kali', 'squiggle']);
    const conflicts = row.details.conflicts as Record<string, JsonValue>[];
    // One object per FIELD, never one per (field, group) pair.
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({
      field: 'home_score', afltables: 132, kali: 128, squiggle: 130,
    });
    // The key order is fixed: field, this source, then groups sorted.
    expect(Object.keys(conflicts[0])).toEqual(['field', 'afltables', 'kali', 'squiggle']);
  });

  it('orders fields deterministically and never lists an agreeing group as a conflict', () => {
    const row = draft([
      claim(squiggleMatch, { home_score: 130, away_score: 70 }),
      claim(kaliMatch, { home_score: 132, away_score: 69 }),
    ]);

    expect(row.details.agreeing_groups).toEqual(['kali']);
    expect(row.details.disagreeing_groups).toEqual(['squiggle']);
    const conflicts = row.details.conflicts as Record<string, JsonValue>[];
    expect(conflicts).toEqual([
      { field: 'away_score', afltables: 69, squiggle: 70 },
      { field: 'home_score', afltables: 132, squiggle: 130 },
    ]);
    // Agreement is recorded for the reviewer and authorises nothing; it is
    // never evidence OF the disagreement.
    for (const conflict of conflicts) expect(conflict).not.toHaveProperty('kali');
  });

  it('never reports this source\'s own group drifting from itself as a witness', () => {
    const row = draft([
      claim(mirrorOf(afltablesMatch, 'afltables_mirror'), { home_score: 999, away_score: 69 }),
      claim(squiggleMatch, { home_score: 130, away_score: 69 }),
    ]);

    expect(row.details.disagreeing_groups).toEqual(['squiggle']);
    const conflicts = row.details.conflicts as Record<string, JsonValue>[];
    expect(conflicts).toEqual([{ field: 'home_score', afltables: 132, squiggle: 130 }]);
    // The proxy's value appears nowhere: a source drifting from its own
    // upstream is a data-quality signal, not a second witness.
    expect(JSON.stringify(row.details)).not.toContain('999');
  });

  it('counts a group once however many provider rows carry it, whatever order they arrive in', () => {
    const rows = [
      claim(kaliMatch, { home_score: 128, away_score: 69 }),
      claim(mirrorOf(kaliMatch, 'kali_mirror'), { home_score: 120, away_score: 69 }),
    ];
    const forward = draft(rows);
    const reversed = draft([...rows].reverse());

    // One key per GROUP, and the same row whichever order PostgreSQL returned
    // the evidence in: the value comes from the lowest source key.
    expect(forward.details.conflicts)
      .toEqual([{ field: 'home_score', afltables: 132, kali: 128 }]);
    expect(reversed.details).toEqual(forward.details);
    expect(reversed.description).toBe(forward.description);
  });

  it('refuses to draft a finding the evidence does not support', () => {
    // No disagreeing group at all.
    expect(() => draft([claim(squiggleMatch, { home_score: 132, away_score: 69 })]))
      .toThrow(/at least one disagreeing independence group/);
    // A named disagreeing group with no conflicting field to show for it.
    expect(() => draftDisagreementIssue({
      wireFamily: 'afltables.match',
      externalRecordId: MATCH_RECORD,
      targetTable: 'matches',
      targetId: 5150,
      sourceVersionSeq: 3,
      proposedValues: PROPOSED,
      claims: [],
      corroboration: {
        ownGroup: 'afltables',
        agreeingGroups: [],
        disagreeingGroups: ['squiggle'],
        sameGroupConflicts: [],
      },
    })).toThrow(/no conflicting field/);
  });

  it('reports conflicts only for groups named as disagreeing', () => {
    // The builder is given the agreeing group as well, and still ignores it.
    const claims = [
      claim(squiggleMatch, { home_score: 130, away_score: 69 }),
      claim(kaliMatch, { home_score: 132, away_score: 69 }),
    ];
    expect(disagreementConflicts(PROPOSED, claims, ['squiggle']))
      .toEqual([{ field: 'home_score', afltables: 132, squiggle: 130 }]);
    expect(disagreementConflicts(PROPOSED, claims, [])).toEqual([]);
  });
});

/**
 * §13.3 as amended for T7. Resolution needs POSITIVE current-run evidence;
 * silence is never agreement, exactly as an un-enumerated scope is never
 * absence (§19).
 */
describe('AFLDB-ISSUE-099 settle — a disagreement resolves only on positive evidence', () => {
  const PROPOSED = { home_score: 132, away_score: 69, attendance: 42123 };
  const report = (claims: readonly MatchClaim[]) =>
    classifyCorroboration(afltablesMatch, PROPOSED, claims);

  it('resolves when an independent group is comparable and positively agrees', () => {
    expect(agreementRestored(report([
      { contract: squiggleMatch, values: { home_score: 132, away_score: 69 } },
    ]))).toBe(true);
  });

  it('does not resolve while any independent group still disagrees', () => {
    expect(agreementRestored(report([
      { contract: squiggleMatch, values: { home_score: 132, away_score: 69 } },
      { contract: kaliMatch, values: { home_score: 130, away_score: 69 } },
    ]))).toBe(false);
  });

  it('does not resolve when no other provider is present at all', () => {
    expect(agreementRestored(report([]))).toBe(false);
  });

  it('does not resolve when the only other provider shares none of the compared fields', () => {
    // Comparable is not the same as present: a claim sharing no field is
    // neither agreement nor disagreement.
    expect(agreementRestored(report([
      { contract: squiggleMatch, values: { round_number: 1 } },
    ]))).toBe(false);
  });

  it('does not accept this source\'s own group as the agreeing witness', () => {
    expect(agreementRestored(report([
      {
        contract: mirrorOf(afltablesMatch, 'afltables_mirror'),
        values: { home_score: 132, away_score: 69 },
      },
    ]))).toBe(false);
  });
});

describe('AFLDB-ISSUE-099 settle — per-family projection rules (§17)', () => {
  it('proposes the matches field set, keeping venue_id NULL rather than inventing a venue', () => {
    const projection = readMatchProjection(matchProjectionJson(), 'projection');
    const values = proposedMatchValues(projection, { ...RESOLVED_MATCH, venueId: null });
    expect(Object.keys(values).sort()).toEqual([...MATCHES_PROPOSED_FIELDS].sort());
    expect(proposedFieldsFor('matches')).toEqual(MATCHES_PROPOSED_FIELDS);
    // The ISSUE-098 defect: venue_raw carries the real string, venue_id is NULL,
    // and the literal 'Unknown' is never produced.
    expect(values.venue_id).toBeNull();
    expect(values.venue_raw).toBe('S.C.G.');
    expect(JSON.stringify(values)).not.toContain('Unknown');
  });

  it('keeps a blank attendance as no observation and a recorded zero as a real crowd', () => {
    const absent = readMatchProjection(matchProjectionJson({
      attendance: null, attendance_status: 'not_collected', attendance_source_key: null,
    }), 'projection');
    const absentValues = proposedMatchValues(absent, {
      ...RESOLVED_MATCH, attendanceSourceId: null,
    });
    expect(absentValues.attendance).toBeNull();
    expect(absentValues.attendance_status).toBe('not_collected');
    expect(absentValues.attendance_source_id).toBeNull();

    const zero = readMatchProjection(matchProjectionJson({
      attendance: 0, attendance_status: 'complete', attendance_source_key: 'afltables',
    }), 'projection');
    const zeroValues = proposedMatchValues(zero, RESOLVED_MATCH);
    // A genuine 0 is storable precisely because it cites a source. NULL is never 0.
    expect(zeroValues.attendance).toBe(0);
    expect(zeroValues.attendance_status).toBe('complete');
    expect(zeroValues.attendance_source_id).toBe(9);
  });

  it('carries period scores as published, periods 1-4 only, and invents no extra time', () => {
    const projection = readMatchProjection(matchProjectionJson(), 'projection');
    const values = proposedPeriodScoreValues(projection, RESOLVED_MATCH);
    expect(Object.keys(values)).toEqual(['period_scores']);
    // `side` resolves to the club identity the canonical grain uses.
    expect(values.period_scores).toEqual([
      { club_id: 3, period: 1, goals: 2, behinds: 2, points: 14 },
      { club_id: 11, period: 1, goals: 5, behinds: 3, points: 33 },
    ]);
    expect(() => readMatchProjection(matchProjectionJson({
      period_scores: [{ side: 'home', period: 5, goals: 1, behinds: 1, points: 7 }],
    }), 'projection')).toThrow(/periods 1-4 only/);
  });

  it('proposes the 21 statistics by name, and never the vote to player_match_stats', () => {
    const projection = readPlayerMatchProjection(playerProjectionJson(), 'projection');
    const values = proposedPlayerMatchValues(projection, 7);
    expect(Object.keys(values).sort()).toEqual([...PLAYER_MATCH_STATS_PROPOSED_FIELDS].sort());
    expect(PLAYER_MATCH_STAT_COLUMNS).toHaveLength(21);
    expect(PLAYER_MATCH_STAT_COLUMNS).not.toContain('brownlow_votes');
    expect(values).not.toHaveProperty('brownlow_votes');
    // Time.on.Ground has no target column and is never projected.
    expect(values).not.toHaveProperty('time_on_ground');
    expect(values.club_id).toBe(7);
  });

  it('keeps an unrecorded statistic NULL rather than coercing it to zero', () => {
    const stats: Record<string, JsonValue> = {};
    for (const column of PLAYER_MATCH_STAT_COLUMNS) stats[column] = null;
    stats.brownlow_votes = null;
    const projection = readPlayerMatchProjection(
      playerProjectionJson({ stats, career_game_no: null, jumper_number: null }), 'projection',
    );
    const values = proposedPlayerMatchValues(projection, 7);
    for (const column of PLAYER_MATCH_STAT_COLUMNS) expect(values[column]).toBeNull();
    expect(values.career_game_no).toBeNull();
    expect(values.jumper_number).toBeNull();
  });

  it('treats the profile url as identity and the fitzRoy ID as enrichment only', () => {
    const projection = readPlayerMatchProjection(playerProjectionJson(), 'projection');
    // P5 measured in-season rows carrying no ID at all; that is not a refusal.
    expect(projection.afltablesId).toBeNull();
    expect(projection.url).toBe('players/M/Marc_Murphy.html');
    // Identity itself is never optional, and a name never stands in for it.
    expect(() => readPlayerMatchProjection(
      playerProjectionJson({ url: null }), 'projection',
    )).toThrow(/url must be a non-empty string/);
  });

  it('never manufactures a Brownlow row from an absent vote, and keeps a published zero', () => {
    // NA is the expected in-season outcome: no row, ever. Not votes = 0, and
    // not a played=true/votes=NULL filler row.
    const na = readPlayerMatchProjection(playerProjectionJson(), 'projection');
    expect(na.brownlowRoundVote).toBeNull();
    expect(proposedBrownlowValues(na)).toBeNull();

    const zero = readPlayerMatchProjection(playerProjectionJson({
      brownlow_round_vote: { season: 2026, round_number: 1, votes: 0 },
    }), 'projection');
    // A published 0 is a real vote and stays distinct from NA.
    expect(proposedBrownlowValues(zero)).toEqual({ played: true, votes: 0 });
    expect(proposedFieldsFor('brownlow_round_votes'))
      .toEqual(BROWNLOW_ROUND_VOTES_PROPOSED_FIELDS);

    // Finals are never polled, so a vote on one is refused outright.
    expect(() => readPlayerMatchProjection(playerProjectionJson({
      is_final: true, round_code: 'GF',
      brownlow_round_vote: { season: 2026, round_number: 1, votes: 3 },
    }), 'projection')).toThrow(/finals are never polled/);
  });

  /**
   * AFLDB-ISSUE-099 T8 regression, defect D2. The first real apply persisted
   * **803** pending `brownlow_round_votes / unresolved_identity` candidates
   * from a snapshot whose 9522 `Brownlow.Votes` observations were *all* NA --
   * exactly one for every record whose player URL was not linked in that
   * database. The existence question had been asked of the identity-resolved
   * projection, so a record that failed identity never reached it and proposed
   * a vote nobody had published.
   *
   * Every case here is stated against the source record alone. The function is
   * given no identity argument at all, and that is the fix: whether AFL Tables
   * published a vote is a fact about the source, and cannot depend on whether
   * this database happens to know the player.
   */
  it('gives an NA Brownlow record no target at all, whatever identity did', () => {
    // The exact 2026 shape, on all 9522 rows.
    expect(targetEstablishedBySource('brownlow_round_votes', playerProjectionJson()))
      .toBe(false);
    // A published 0 is a real vote, so the target genuinely exists (R3).
    expect(targetEstablishedBySource('brownlow_round_votes', playerProjectionJson({
      brownlow_round_vote: { season: 2026, round_number: 1, votes: 0 },
    }))).toBe(true);
    // A record nobody could interpret establishes no vote either: absence of
    // evidence that one exists is not evidence that it does.
    expect(targetEstablishedBySource('brownlow_round_votes', null)).toBe(false);

    // The other targets are established by the record itself. A rejected
    // record still refuses on them, exactly as before -- unchanged here.
    for (const target of ['matches', 'match_period_scores', 'player_match_stats'] as const) {
      expect(targetEstablishedBySource(target, null)).toBe(true);
      expect(targetEstablishedBySource(target, playerProjectionJson())).toBe(true);
    }

    // And it agrees with the one reader of that JSON, in both directions, so
    // it cannot drift from what the projection actually says.
    for (const raw of [
      playerProjectionJson(),
      playerProjectionJson({ brownlow_round_vote: { season: 2026, round_number: 3, votes: 3 } }),
    ]) {
      expect(targetEstablishedBySource('brownlow_round_votes', raw))
        .toBe(readPlayerMatchProjection(raw, 'projection').brownlowRoundVote !== null);
    }
  });

  it('maps each family to exactly its two canonical targets', () => {
    const targets: SettleTargetTable[] = [
      'matches', 'match_period_scores', 'player_match_stats', 'brownlow_round_votes',
    ];
    for (const target of targets) expect(proposedFieldsFor(target).length).toBeGreaterThan(0);
  });
});
