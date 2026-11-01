/**
 * AFLDB V2 Stage 3 — the AFL API fixture identity contract (AFLDB-ISSUE-229 safe surrounding
 * contracts; packages/acquisition/src/fixture-contract.ts). No database, no network.
 *
 * ISSUE-229 stays OPEN (issues.md:42056-42057: B2, the first authentic 2027 pre-match season feed,
 * is required before the writer is wired or applied). These tests prove ONLY the status routing,
 * projection preconditions and collision refusals; they do not and cannot prove a fixture write.
 *
 * DATA. Real inputs are committed files: the byte-exact SCHEDULED (04-) and UNCONFIRMED_TEAMS (05-)
 * season-feed slices, the whole retained 2026 season feed, and data/reference/afl-api-identities.json.
 * Every case labelled SYNTHETIC mutates a deep copy of one of those records (or invents an
 * unobserved status string) to exercise a refusal; none of it is provider evidence, and no
 * POSTPONED / CANCELLED / ABANDONED / TBC payload has ever been observed.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  classifyAflApiFixtureStatus,
  detectAflApiFixtureCollisions,
  evaluateAflApiFixtureLifecycle,
  evaluateAflApiFixtureProjection,
  parseAcknowledgedUnobservedStatuses,
  parseSourceFamilyRegistry,
  stageAflApiFixtureFeed,
  type AflApiFixtureContractContext,
  type AflApiFixtureRefusalCode,
} from '@afldb/acquisition';
import { parseAflApiIdentities } from '@/lib/acquisition/afl-api-bundle';

import { parseFixtureScheduleArgs, runFixtureScheduleCli } from '../tools/current-season/settle-afl-api-fixture-schedule';

const root = join(__dirname, '..');
const readJson = (...parts: string[]): unknown => JSON.parse(readFileSync(join(root, ...parts), 'utf8'));

const ctx: AflApiFixtureContractContext = {
  registry: parseSourceFamilyRegistry(readJson('data', 'reference', 'source-families.json')),
  identities: parseAflApiIdentities(readJson('data', 'reference', 'afl-api-identities.json')),
};

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- raw provider JSON under mutation
const scheduled = readJson('tests', 'fixtures', 'afl_api', 'match', '04-season-feed-scheduled.raw-slice.json') as Json;
const unconfirmed = readJson('tests', 'fixtures', 'afl_api', 'match', '05-season-feed-unconfirmed-teams.raw-slice.json') as Json;
const seasonFeed = (readJson('tests', 'fixtures', 'afl_api', 'seasons', '00-season-matches-2026.raw.json') as { matches: Json[] }).matches;
// AFLDB-ISSUE-229 B2: byte-exact records of the first authentic 2027 season feed (retained snapshot
// afl-api-2027-2026-11-01-012026, feed sha256 21fd12e7...c84d). Every 2027 PLACEHOLDER test below
// uses these real records; each case labelled SYNTHETIC mutates a deep copy.
const placeholderRealClubs = readJson('tests', 'fixtures', 'afl_api', 'match', '06-season-feed-placeholder-real-clubs.raw-slice.json') as Json;
const placeholderLabels = readJson('tests', 'fixtures', 'afl_api', 'match', '07-season-feed-placeholder-labels.raw-slice.json') as Json;
const placeholderGrandFinal = readJson('tests', 'fixtures', 'afl_api', 'match', '08-season-feed-placeholder-grand-final.raw-slice.json') as Json;
const seasonFeed2027 = (readJson('tests', 'fixtures', 'afl_api', 'seasons', '01-season-matches-2027.raw.json') as { matches: Json[] }).matches;

/** SYNTHETIC mutation helper: a deep copy of a real record with `mutate` applied. */
function mutated(base: Json, mutate: (copy: Json) => void): Json {
  const copy = JSON.parse(JSON.stringify(base)) as Json;
  mutate(copy);
  return copy;
}

function refusalCodes(record: unknown): AflApiFixtureRefusalCode[] {
  const result = evaluateAflApiFixtureProjection(record, ctx);
  if (result.ok) throw new Error('expected a refusal, got a projection');
  return result.refusals.map((r) => r.code);
}

describe('classifyAflApiFixtureStatus (D-229-1 revised, D-229-3)', () => {
  it('routes the observed statuses: CONCLUDED, and SCHEDULED / UNCONFIRMED_TEAMS both to fixture status scheduled', () => {
    expect(classifyAflApiFixtureStatus('CONCLUDED')).toEqual({ kind: 'concluded' });
    expect(classifyAflApiFixtureStatus('SCHEDULED')).toEqual({ kind: 'scheduled', fixtureStatus: 'scheduled', confirmation: 'confirmed', observedStatus: 'SCHEDULED' });
    expect(classifyAflApiFixtureStatus('UNCONFIRMED_TEAMS')).toEqual({ kind: 'scheduled', fixtureStatus: 'scheduled', confirmation: 'confirmed', observedStatus: 'UNCONFIRMED_TEAMS' });
  });

  it('routes PLACEHOLDER (observed in the 2027 feed) to an UNCONFIRMED scheduled fixture: never a result, cancellation or void (ISSUE-229 B2)', () => {
    expect(classifyAflApiFixtureStatus('PLACEHOLDER')).toEqual({ kind: 'scheduled', fixtureStatus: 'scheduled', confirmation: 'unconfirmed', observedStatus: 'PLACEHOLDER' });
  });

  it('defers the in-play statuses the existing code already recognises (never projected)', () => {
    expect(classifyAflApiFixtureStatus('LIVE')).toEqual({ kind: 'defer', observedStatus: 'LIVE' });
    expect(classifyAflApiFixtureStatus('POSTGAME')).toEqual({ kind: 'defer', observedStatus: 'POSTGAME' });
  });

  it.each([
    'POSTPONED', 'CANCELLED', 'ABANDONED', 'TBC', 'VOID', 'CANCELED', 'PRE_MATCH', '',
    'scheduled', 'Concluded', ' SCHEDULED', 'SCHEDULED ', 'UNCONFIRMED_TEAM',
  ])('SYNTHETIC unobserved status %j refuses status_unsupported, verbatim, never cancelled or void', (status) => {
    expect(classifyAflApiFixtureStatus(status)).toEqual({ kind: 'refuse', code: 'status_unsupported', observedStatus: status });
  });
});

describe('evaluateAflApiFixtureProjection (D-229-5, D-229-7, D-229-8a)', () => {
  it('projects the real SCHEDULED Grand Final slice to a fixtures-only scheduled projection', () => {
    const result = evaluateAflApiFixtureProjection(scheduled, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.projection).toEqual({
      identity: { sourceKey: 'afl_api', sourceRecordId: 'CD_M20260142901' },
      target: 'fixtures',
      observationSpine: false,
      fixtureStatus: 'scheduled',
      confirmation: 'confirmed',
      providerStatus: 'SCHEDULED',
      season: 2026,
      round: { roundCode: 'GF', roundNumber: null, roundType: 'grand_final', isFinal: true },
      // 2026-09-26T04:30:00Z in Australia/Melbourne (AEST, +10:00; DST begins 4 October).
      matchDate: '2026-09-26',
      matchTime: '14:30',
      venueProviderId: 'CD_V40',
      venueLegacyName: 'M.C.G.',
      venueIsPlaceholder: false,
      venueTimezone: 'Australia/Melbourne',
      homeTeamProviderId: 'CD_T60',
      homeClubHist: 'Fremantle',
      homePlaceholderLabel: null,
      awayTeamProviderId: 'CD_T20',
      awayClubHist: 'Brisbane Lions',
      awayPlaceholderLabel: null,
    });
  });

  it('projects the real UNCONFIRMED_TEAMS slice to the same fixture status, keeping the provider status', () => {
    const result = evaluateAflApiFixtureProjection(unconfirmed, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.projection.fixtureStatus).toBe('scheduled');
    expect(result.projection.providerStatus).toBe('UNCONFIRMED_TEAMS');
    expect(result.projection.identity).toEqual({ sourceKey: 'afl_api', sourceRecordId: 'CD_M20260142901' });
    expect(result.projection.observationSpine).toBe(false);
  });

  it('keeps the durable identity on the provider id, not on any mint of this module (D-229-7)', () => {
    const result = evaluateAflApiFixtureProjection(mutated(scheduled, (r) => { r.providerId = 'CD_M20269999999'; }), ctx);
    expect(result.ok && result.projection.identity.sourceRecordId).toBe('CD_M20269999999');
    expect(JSON.stringify(result)).not.toContain('fixture_key');
  });

  it('leaves a CONCLUDED record to the match path and refuses it (D-229-1)', () => {
    const concluded = seasonFeed.find((m) => m.status === 'CONCLUDED');
    expect(refusalCodes(concluded)).toEqual(['status_not_pre_match']);
  });

  it('SYNTHETIC: LIVE and POSTGAME are deferred, with no other check applied', () => {
    expect(refusalCodes(mutated(scheduled, (r) => { r.status = 'LIVE'; }))).toEqual(['status_deferred']);
    expect(refusalCodes(mutated(scheduled, (r) => { r.status = 'POSTGAME'; }))).toEqual(['status_deferred']);
  });

  it('SYNTHETIC: POSTPONED / CANCELLED / ABANDONED / TBC are unsupported and nothing is projected (D-229-3)', () => {
    for (const status of ['POSTPONED', 'CANCELLED', 'ABANDONED', 'TBC']) {
      const result = evaluateAflApiFixtureProjection(mutated(scheduled, (r) => { r.status = status; }), ctx);
      expect(result).toMatchObject({ ok: false, refusals: [{ code: 'status_unsupported' }] });
      expect(JSON.stringify(result)).toContain(status);
      expect(JSON.stringify(result)).not.toMatch(/"fixtureStatus":"(cancelled|void)"/);
    }
  });

  // One case per refusal code. SYNTHETIC mutations of the real SCHEDULED slice.
  const cases: ReadonlyArray<{ code: AflApiFixtureRefusalCode; build: () => unknown; label: string }> = [
    { code: 'record_invalid', label: 'null entry', build: () => null },
    { code: 'record_invalid', label: 'array entry', build: () => [] },
    { code: 'provider_id_missing', label: 'no providerId', build: () => mutated(scheduled, (r) => { delete r.providerId; }) },
    { code: 'status_unsupported', label: 'status missing', build: () => mutated(scheduled, (r) => { delete r.status; }) },
    { code: 'status_unsupported', label: 'status POSTPONED', build: () => mutated(scheduled, (r) => { r.status = 'POSTPONED'; }) },
    { code: 'status_deferred', label: 'status LIVE', build: () => mutated(scheduled, (r) => { r.status = 'LIVE'; }) },
    { code: 'status_not_pre_match', label: 'status CONCLUDED', build: () => mutated(scheduled, (r) => { r.status = 'CONCLUDED'; }) },
    {
      code: 'prematch_score_present', label: 'home.score present on SCHEDULED (D-229-2)',
      build: () => mutated(scheduled, (r) => { r.home.score = { goals: 0, behinds: 0, totalScore: 0 }; }),
    },
    {
      code: 'prematch_score_present', label: 'away.score present on UNCONFIRMED_TEAMS (D-229-2)',
      build: () => mutated(unconfirmed, (r) => { r.away.score = { goals: 1, behinds: 1, totalScore: 7 }; }),
    },
    { code: 'season_unresolved', label: 'undeclared compSeason', build: () => mutated(scheduled, (r) => { r.compSeason.providerId = 'CD_S1999001'; }) },
    { code: 'round_untranslatable', label: 'round number outside the declared table', build: () => mutated(scheduled, (r) => { r.round.roundNumber = 99; }) },
    { code: 'round_untranslatable', label: 'renamed round (vocabulary drift)', build: () => mutated(scheduled, (r) => { r.round.name = 'Great Final'; }) },
    { code: 'round_untranslatable', label: 'round block missing', build: () => mutated(scheduled, (r) => { delete r.round; }) },
    { code: 'team_unmapped', label: 'unknown home team', build: () => mutated(scheduled, (r) => { r.home.team.providerId = 'CD_T9999'; }) },
    { code: 'team_unmapped', label: 'away team missing', build: () => mutated(scheduled, (r) => { delete r.away.team; }) },
    { code: 'clubs_identical', label: 'both sides the same club', build: () => mutated(scheduled, (r) => { r.away.team.providerId = r.home.team.providerId; }) },
    {
      code: 'placeholder_in_confirmed_fixture', label: 'a declared placeholder TEAM on a SCHEDULED (confirmed) record',
      build: () => mutated(scheduled, (r) => { r.home.team.providerId = 'CD_T3000'; }),
    },
    {
      code: 'placeholder_in_confirmed_fixture', label: 'a declared placeholder VENUE on a SCHEDULED (confirmed) record',
      build: () => mutated(scheduled, (r) => { r.venue.providerId = 'CD_V2385'; }),
    },
    { code: 'venue_unresolved', label: 'venue not in the identities map', build: () => mutated(scheduled, (r) => { r.venue.providerId = 'CD_V9999'; }) },
    { code: 'venue_unresolved', label: 'venue block missing', build: () => mutated(scheduled, (r) => { delete r.venue; }) },
    { code: 'timezone_invalid', label: 'not an IANA zone', build: () => mutated(scheduled, (r) => { r.venue.timezone = 'Not/AZone'; }) },
    { code: 'timezone_invalid', label: 'timezone absent', build: () => mutated(scheduled, (r) => { delete r.venue.timezone; }) },
    { code: 'start_time_unproven', label: 'start time absent (no TBC guess)', build: () => mutated(scheduled, (r) => { delete r.utcStartTime; }) },
    { code: 'start_time_unproven', label: 'start time null', build: () => mutated(scheduled, (r) => { r.utcStartTime = null; }) },
    { code: 'start_time_unproven', label: 'lenient ISO form, not the observed format', build: () => mutated(scheduled, (r) => { r.utcStartTime = '2026-09-26T04:30:00Z'; }) },
    { code: 'start_time_unproven', label: 'calendar-invalid instant', build: () => mutated(scheduled, (r) => { r.utcStartTime = '2026-02-30T04:30:00.000+0000'; }) },
    { code: 'start_time_unproven', label: 'non-zero seconds are never truncated (D-229-5 condition 4)', build: () => mutated(scheduled, (r) => { r.utcStartTime = '2026-09-26T04:30:15.000+0000'; }) },
  ];

  it.each(cases)('refuses $code: $label', ({ code, build }) => {
    expect(refusalCodes(build())).toContain(code);
    expect(evaluateAflApiFixtureProjection(build(), ctx).ok).toBe(false);
  });

  it('exercises every refusal code', () => {
    const everyCode: Record<AflApiFixtureRefusalCode, true> = {
      record_invalid: true, provider_id_missing: true, status_unsupported: true, status_deferred: true,
      status_not_pre_match: true, prematch_score_present: true, season_unresolved: true,
      round_untranslatable: true, team_unmapped: true, clubs_identical: true, venue_unresolved: true,
      timezone_invalid: true, start_time_unproven: true, placeholder_in_confirmed_fixture: true,
    };
    expect(new Set(cases.map((c) => c.code))).toEqual(new Set(Object.keys(everyCode)));
  });

  it('SYNTHETIC: collects every independent refusal on one record instead of stopping at the first', () => {
    const codes = refusalCodes(mutated(scheduled, (r) => {
      r.venue.providerId = 'CD_V9999';
      r.venue.timezone = 'Not/AZone';
      r.utcStartTime = 'TBC';
    }));
    expect(codes).toEqual(['venue_unresolved', 'timezone_invalid', 'start_time_unproven']);
  });

  it('real whole-season feed: the single SCHEDULED entry projects and every CONCLUDED entry is left to the match path', () => {
    const results = seasonFeed.map((m) => evaluateAflApiFixtureProjection(m, ctx));
    const projected = results.filter((r) => r.ok);
    expect(seasonFeed).toHaveLength(218);
    expect(projected).toHaveLength(1);
    const refused = results.filter((r) => !r.ok);
    expect(refused).toHaveLength(217);
    for (const r of refused) {
      expect(r).toEqual({ ok: false, refusals: [{ code: 'status_not_pre_match', detail: expect.any(String) }] });
    }
  });
});

describe('PLACEHOLDER fixtures: unconfirmed scheduled, never a result (AFLDB-ISSUE-229 B2, owner policy 2026-11-01)', () => {
  it('projects a real PLACEHOLDER record with real clubs and venue as an unconfirmed scheduled fixture whose provisional instant is NOT stored as a kick-off', () => {
    const result = evaluateAflApiFixtureProjection(placeholderRealClubs, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.projection).toMatchObject({
      identity: { sourceKey: 'afl_api', sourceRecordId: 'CD_M20270141702' },
      fixtureStatus: 'scheduled', confirmation: 'unconfirmed', providerStatus: 'PLACEHOLDER', season: 2027,
      round: { roundCode: '17', roundNumber: 17, roundType: 'home_and_away', isFinal: false },
      // The record's utcStartTime (2027-07-05T02:00Z) is the round's shared provisional instant, not a proven kick-off
      // (round 17 has 3 distinct starts across its 9 matches; the confirmed round 16 has 9): unresolved, never a sentinel.
      matchDate: null, matchTime: null,
      venueProviderId: 'CD_V40', venueIsPlaceholder: false, venueLegacyName: 'M.C.G.',
      homeClubHist: 'Collingwood', homePlaceholderLabel: null, awayClubHist: 'Brisbane Lions', awayPlaceholderLabel: null,
    });
    expect(JSON.stringify(result)).not.toMatch(/"fixtureStatus":"(cancelled|void)"/);
  });

  it('projects a real Wildcard Final: labels stay labels (no club), the venue stays unresolved, date and time stay unproven', () => {
    const result = evaluateAflApiFixtureProjection(placeholderLabels, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Wildcard Finals are their own stage: never merged with an elimination or qualifying final.
    expect(result.projection.round).toEqual({ roundCode: 'WF', roundNumber: null, roundType: 'wildcard_final', isFinal: true });
    expect(result.projection).toMatchObject({
      confirmation: 'unconfirmed', season: 2027,
      matchDate: null, matchTime: null, venueProviderId: 'CD_V2385', venueIsPlaceholder: true, venueLegacyName: null, venueTimezone: null,
      homeTeamProviderId: 'CD_T3006', homeClubHist: null, homePlaceholderLabel: '7th',
      awayTeamProviderId: 'CD_T3009', awayClubHist: null, awayPlaceholderLabel: '10th',
    });
  });

  it('projects the real placeholder Grand Final: bracket labels and a REAL venue (the MCG), but still no date or time while unconfirmed', () => {
    const result = evaluateAflApiFixtureProjection(placeholderGrandFinal, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.projection).toMatchObject({
      confirmation: 'unconfirmed', round: { roundCode: 'GF', roundType: 'grand_final' },
      matchDate: null, matchTime: null, venueIsPlaceholder: false,
      homeClubHist: null, homePlaceholderLabel: 'Winner of PF1', awayClubHist: null, awayPlaceholderLabel: 'Winner of PF2',
    });
  });

  it('SYNTHETIC: a placeholder TEAM or VENUE is admitted only because the record is unconfirmed; on a confirmed record it refuses', () => {
    expect(refusalCodes(mutated(scheduled, (r) => { r.away.team.providerId = 'CD_T3009'; }))).toEqual(['placeholder_in_confirmed_fixture']);
    expect(refusalCodes(mutated(unconfirmed, (r) => { r.venue.providerId = 'CD_V2385'; }))).toEqual(['placeholder_in_confirmed_fixture']);
  });

  it('SYNTHETIC: an UNDECLARED team or venue on a PLACEHOLDER record is still unmapped; a label is never matched by name', () => {
    expect(refusalCodes(mutated(placeholderLabels, (r) => { r.home.team.providerId = 'CD_T9999'; }))).toEqual(['team_unmapped']);
    expect(refusalCodes(mutated(placeholderLabels, (r) => { r.home.team.providerId = 'CD_T9999'; r.home.team.name = 'Collingwood'; }))).toEqual(['team_unmapped']);
    expect(refusalCodes(mutated(placeholderLabels, (r) => { r.venue.providerId = 'CD_V9999'; r.venue.name = 'To Be Confirmed'; }))).toEqual(['venue_unresolved']);
  });

  it('SYNTHETIC: PLACEHOLDER does not relax the pre-match score rule or the start-time proof', () => {
    expect(refusalCodes(mutated(placeholderRealClubs, (r) => { r.home.score = { goals: 1, behinds: 0, totalScore: 6 }; }))).toContain('prematch_score_present');
    expect(refusalCodes(mutated(placeholderRealClubs, (r) => { r.utcStartTime = null; }))).toContain('start_time_unproven');
    expect(refusalCodes(mutated(placeholderLabels, (r) => { r.utcStartTime = 'TBC'; }))).toContain('start_time_unproven');
  });

  it('SYNTHETIC: the same club on both sides is refused on a PLACEHOLDER record, and so is the same label on both sides', () => {
    expect(refusalCodes(mutated(placeholderRealClubs, (r) => { r.away.team = r.home.team; }))).toEqual(['clubs_identical']);
    expect(refusalCodes(mutated(placeholderLabels, (r) => { r.away.team = r.home.team; }))).toEqual(['clubs_identical']);
  });

  it('SYNTHETIC: a label renamed under the same provider id is refused, never stored under its old name', () => {
    expect(refusalCodes(mutated(placeholderLabels, (r) => { r.home.team.name = 'Winner of QF9'; }))).toEqual(['team_unmapped']);
    expect(refusalCodes(mutated(placeholderLabels, (r) => { delete r.home.team.name; }))).toEqual(['team_unmapped']);
  });

  it('real 2027 feed: all 218 records project; 135 confirmed (SCHEDULED), 83 unconfirmed (PLACEHOLDER); nothing refused or collided', () => {
    expect(seasonFeed2027).toHaveLength(218);
    const stage = stageAflApiFixtureFeed(seasonFeed2027, ctx, { season: 2027 });
    expect(stage.statusCounts).toEqual({ PLACEHOLDER: 83, SCHEDULED: 135 });
    expect(stage.refused).toEqual([]);
    expect(stage.collisions).toEqual([]);
    expect(stage.completed).toHaveLength(0);
    expect(stage.scheduled).toHaveLength(218);
    expect(stage.scheduled.filter((p) => p.confirmation === 'unconfirmed')).toHaveLength(83);
    expect(stage.scheduled.filter((p) => p.confirmation === 'confirmed')).toHaveLength(135);
    // Ten finals matches have the 'To Be Confirmed' venue; eleven have a label participant on at least one side.
    expect(stage.scheduled.filter((p) => p.venueIsPlaceholder)).toHaveLength(10);
    expect(stage.scheduled.filter((p) => p.homeClubHist === null || p.awayClubHist === null)).toHaveLength(11);
    // A label never becomes a club; a placeholder venue never gets a date or time.
    for (const p of stage.scheduled) {
      if (p.homeClubHist === null) expect(p.homePlaceholderLabel).toMatch(/\S/);
      if (p.awayClubHist === null) expect(p.awayPlaceholderLabel).toMatch(/\S/);
      // A provisional instant is never stored as a kick-off: unconfirmed means no date and no time; confirmed means both.
      if (p.venueIsPlaceholder || p.confirmation === 'unconfirmed') expect([p.matchDate, p.matchTime]).toEqual([null, null]);
      if (p.confirmation === 'confirmed') {
        expect(p.homeClubHist !== null && p.awayClubHist !== null && !p.venueIsPlaceholder).toBe(true);
        expect(p.matchDate).toMatch(/^2027-/);
        expect(p.matchTime).toMatch(/^\d{2}:\d{2}$/);
      }
    }
    // Rounds: 1-24 home-and-away with no offset, then WF / QF+EF / SF / PF / GF as distinct stages.
    const roundCodes = new Map<string, number>();
    for (const p of stage.scheduled) roundCodes.set(p.round.roundCode, (roundCodes.get(p.round.roundCode) ?? 0) + 1);
    expect(roundCodes.get('WF')).toBe(2);
    expect(roundCodes.get('QF')).toBe(2);
    expect(roundCodes.get('EF')).toBe(2);
    expect(roundCodes.get('SF')).toBe(2);
    expect(roundCodes.get('PF')).toBe(2);
    expect(roundCodes.get('GF')).toBe(1);
    expect([...roundCodes.keys()].filter((c) => /^\d+$/.test(c))).toHaveLength(24);
  });

  it('the 2026 feed is unaffected: it has no unconfirmed fixture and no label participant', () => {
    const stage = stageAflApiFixtureFeed(seasonFeed, ctx, { season: 2026 });
    expect(stage.scheduled.every((p) => p.confirmation === 'confirmed' && p.homeClubHist !== null && p.awayClubHist !== null)).toBe(true);
  });
});

describe('detectAflApiFixtureCollisions', () => {
  it('finds no collision of any kind in the real retained 2026 season feed', () => {
    expect(detectAflApiFixtureCollisions(seasonFeed, ctx)).toEqual([]);
  });

  it('SYNTHETIC: one provider id listed twice is duplicate_provider_id', () => {
    const collisions = detectAflApiFixtureCollisions([scheduled, scheduled], ctx);
    expect(collisions).toEqual([{
      code: 'duplicate_provider_id',
      detail: "Provider id 'CD_M20260142901' is listed 2 times.",
      providerIds: ['CD_M20260142901'],
    }]);
  });

  it('SYNTHETIC: two different provider ids for the same season, clubs and date are fixture_identity_collision', () => {
    const twin = mutated(scheduled, (r) => { r.providerId = 'CD_M20260149999'; });
    const collisions = detectAflApiFixtureCollisions([scheduled, twin], ctx);
    expect(collisions.map((c) => c.code)).toEqual(['fixture_identity_collision']);
    expect(collisions[0].providerIds).toEqual(['CD_M20260142901', 'CD_M20260149999']);
  });

  it('SYNTHETIC: the same clubs with home and away swapped on the same date are orientation_conflict, never swapped', () => {
    const swapped = mutated(scheduled, (r) => {
      r.providerId = 'CD_M20260149998';
      [r.home.team, r.away.team] = [r.away.team, r.home.team];
    });
    const collisions = detectAflApiFixtureCollisions([scheduled, swapped], ctx);
    expect(collisions.map((c) => c.code)).toEqual(['orientation_conflict']);
    expect(collisions[0].providerIds).toEqual(['CD_M20260142901', 'CD_M20260149998']);
    // The contract only reports; the swapped record is still its own, un-reoriented projection.
    const result = evaluateAflApiFixtureProjection(swapped, ctx);
    expect(result.ok && result.projection.homeClubHist).toBe('Brisbane Lions');
  });

  it('SYNTHETIC: a different date, season or club pair is not a collision', () => {
    const nextDay = mutated(scheduled, (r) => { r.providerId = 'CD_M20260149997'; r.utcStartTime = '2026-09-27T04:30:00.000+0000'; });
    const otherClub = mutated(scheduled, (r) => { r.providerId = 'CD_M20260149996'; r.away.team.providerId = 'CD_T10'; });
    expect(detectAflApiFixtureCollisions([scheduled, nextDay, otherClub], ctx)).toEqual([]);
  });

  it('SYNTHETIC: an unprovable date takes part in the duplicate check only', () => {
    const noZone = mutated(scheduled, (r) => { r.providerId = 'CD_M20260149995'; delete r.venue.timezone; });
    expect(detectAflApiFixtureCollisions([scheduled, noZone], ctx)).toEqual([]);
    expect(detectAflApiFixtureCollisions([noZone, noZone], ctx).map((c) => c.code)).toEqual(['duplicate_provider_id']);
  });

  it('SYNTHETIC: a listed-twice id is reported once as a duplicate, not also as a collision with itself', () => {
    const codes = detectAflApiFixtureCollisions([scheduled, scheduled, scheduled], ctx).map((c) => c.code);
    expect(codes).toEqual(['duplicate_provider_id']);
  });
});

describe('fixture-contract module hygiene', () => {
  it('imports only pure modules: no postgres, server-only, node IO, db or app code', () => {
    const source = readFileSync(join(root, 'packages', 'acquisition', 'src', 'fixture-contract.ts'), 'utf8');
    const specifiers = [...source.matchAll(/^\s*(?:import|export)[^'"]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
    expect(specifiers.sort()).toEqual([
      '@/lib/acquisition/afl-api-bundle',
      '@/lib/acquisition/afl-api-rounds',
      '@/lib/acquisition/source-families',
      '@/lib/fixtures/spec',
    ]);
  });

  it('is re-exported from the package index without a database URL', async () => {
    const index = await import('@afldb/acquisition');
    expect(typeof index.classifyAflApiFixtureStatus).toBe('function');
    expect(typeof index.evaluateAflApiFixtureProjection).toBe('function');
    expect(typeof index.detectAflApiFixtureCollisions).toBe('function');
  });
});

describe('evaluateAflApiFixtureLifecycle and stageAflApiFixtureFeed (AFLDB-ISSUE-229 writer staging)', () => {
  const none = new Set<string>();

  it('with no acknowledgement, every status routes exactly as the contract does', () => {
    for (const status of ['POSTPONED', 'CANCELLED', 'ABANDONED', 'TBC', 'cancelled']) {
      const record = mutated(scheduled, (c) => { c.status = status; });
      const result = evaluateAflApiFixtureLifecycle(record, ctx, none);
      expect(result.ok, status).toBe(false);
      if (!result.ok) expect(result.refusals.map((r) => r.code)).toEqual(['status_unsupported']);
    }
    expect(evaluateAflApiFixtureLifecycle(scheduled, ctx, none)).toMatchObject({ ok: true, kind: 'scheduled' });
    expect(evaluateAflApiFixtureLifecycle(seasonFeed.find((m) => m.status === 'CONCLUDED'), ctx, none)).toMatchObject({ ok: true, kind: 'completed' });
    expect(evaluateAflApiFixtureLifecycle(mutated(scheduled, (c) => { c.status = 'LIVE'; }), ctx, none)).toMatchObject({ ok: true, kind: 'deferred' });
  });

  it('SYNTHETIC: an acknowledged unobserved status becomes a transition carrying identity only', () => {
    const ack = parseAcknowledgedUnobservedStatuses(['POSTPONED', 'CANCELLED', 'ABANDONED']);
    for (const [status, kind] of [['POSTPONED', 'postponed'], ['CANCELLED', 'cancelled'], ['ABANDONED', 'abandoned']] as const) {
      const record = mutated(scheduled, (c) => { c.status = status; delete c.utcStartTime; });
      expect(evaluateAflApiFixtureLifecycle(record, ctx, ack)).toEqual({
        ok: true, kind: 'transition',
        transition: { kind, providerStatus: status, providerId: 'CD_M20260142901', season: 2026, homeClubHist: 'Fremantle', awayClubHist: 'Brisbane Lions' },
      });
    }
    const unmapped = mutated(scheduled, (c) => { c.status = 'CANCELLED'; c.home.team.providerId = 'CD_T_NONE'; });
    expect(evaluateAflApiFixtureLifecycle(unmapped, ctx, ack)).toMatchObject({ ok: false, refusals: [{ code: 'team_unmapped' }] });
  });

  it('accepts only exact acknowledgeable spellings', () => {
    expect(() => parseAcknowledgedUnobservedStatuses(['postponed'])).toThrow(/not an acknowledgeable status/);
    expect(() => parseAcknowledgedUnobservedStatuses(['VOID'])).toThrow(/not an acknowledgeable status/);
    expect(() => parseAcknowledgedUnobservedStatuses(['CANCELLED', 'CANCELLED'])).toThrow(/twice/);
  });

  it('stages the whole retained 2026 feed: 217 completed, the Grand Final scheduled, nothing refused', () => {
    const stage = stageAflApiFixtureFeed(seasonFeed, ctx, { season: 2026 });
    expect(stage.statusCounts).toEqual({ CONCLUDED: 217, SCHEDULED: 1 });
    expect(stage.completed).toHaveLength(217);
    expect(stage.scheduled.map((p) => [p.identity.sourceRecordId, p.round.roundCode, p.matchDate, p.matchTime]))
      .toEqual([['CD_M20260142901', 'GF', '2026-09-26', '14:30']]);
    expect(stage.refused).toEqual([]);
    expect(stage.collisions).toEqual([]);
  });

  it('refuses a record of another competition or season, and every record of a feed collision', () => {
    const otherSeason = mutated(scheduled, (c) => { c.compSeason.providerId = 'CD_S2025014'; });
    expect(stageAflApiFixtureFeed([otherSeason], ctx, { season: 2026 }).refused[0].refusals[0].code).toBe('competition_season_mismatch');
    const twin = mutated(scheduled, (c) => { c.providerId = 'CD_M20260142999'; });
    const stage = stageAflApiFixtureFeed([scheduled, twin], ctx, { season: 2026 });
    expect(stage.scheduled).toEqual([]);
    expect(stage.refused.map((r) => [r.providerId, r.refusals[0].code])).toEqual([
      ['CD_M20260142901', 'feed_collision'], ['CD_M20260142999', 'feed_collision'],
    ]);
    expect(() => stageAflApiFixtureFeed([], ctx, { season: 1999 })).toThrow(/not declared/);
  });
});

describe('settle-afl-api-fixture-schedule CLI: immutable snapshot and validation (offline)', () => {
  function snapshotRoot(mutate?: (dir: string) => void): string {
    const projectRoot = mkdtempSync(join(tmpdir(), 'v2-fx-cli-'));
    mkdirSync(join(projectRoot, 'data', 'reference'), { recursive: true });
    for (const file of ['source-families.json', 'afl-api-identities.json']) {
      copyFileSync(join(root, 'data', 'reference', file), join(projectRoot, 'data', 'reference', file));
    }
    const dir = join(projectRoot, 'data', 'sources', 'afl_api', 'fixtures', 'snap-1');
    mkdirSync(dir, { recursive: true });
    const feedBytes = readFileSync(join(root, 'tests', 'fixtures', 'afl_api', 'seasons', '00-season-matches-2026.raw.json'));
    writeFileSync(join(dir, '00-season-matches.json'), feedBytes);
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
      source_key: 'afl_api', acquisition_kind: 'afl_api_fixture_snapshot', season: 2026,
      files: [{ file: '00-season-matches.json', sha256: createHash('sha256').update(feedBytes).digest('hex') }],
    }));
    mutate?.(dir);
    return projectRoot;
  }

  it('--validate-only stages the hash-verified feed and opens no connection', async () => {
    const lines: string[] = [];
    const { stage, outcome } = await runFixtureScheduleCli(['--label', 'snap-1', '--validate-only'], { projectRoot: snapshotRoot(), log: (l) => lines.push(l) });
    expect(outcome).toBeNull();
    expect(stage.scheduled).toHaveLength(1);
    expect(lines.join('\n')).toContain('Observed statuses: CONCLUDED=217, SCHEDULED=1');
  });

  it('refuses a snapshot whose bytes changed after acquisition', async () => {
    const projectRoot = snapshotRoot((dir) => writeFileSync(join(dir, '00-season-matches.json'), '{"matches":[]}'));
    await expect(runFixtureScheduleCli(['--label', 'snap-1', '--validate-only'], { projectRoot, log: () => {} })).rejects.toThrow(/sha256 mismatch/);
  });

  it('parses only the documented flags, one mode, exact acknowledgements', () => {
    expect(parseFixtureScheduleArgs(['--label', 's', '--apply', '--acknowledge-unobserved-status', 'POSTPONED,CANCELLED']))
      .toEqual({ label: 's', mode: 'apply', acknowledged: new Set(['POSTPONED', 'CANCELLED']) });
    expect(() => parseFixtureScheduleArgs(['--label', 's', '--apply', '--dry-run'])).toThrow(/Exactly one/);
    expect(() => parseFixtureScheduleArgs(['--label', '../x', '--apply'])).toThrow(/directory name/);
    expect(() => parseFixtureScheduleArgs(['--label', 's', '--apply', '--force'])).toThrow(/Unknown argument/);
    expect(() => parseFixtureScheduleArgs(['--label', 's', '--apply', '--acknowledge-unobserved-status', 'VOID'])).toThrow(/acknowledgeable/);
  });

  it('refuses a sealed season, then the ingestion gate, before any database client exists', async () => {
    const seasons = JSON.parse(readFileSync(join(root, 'data', 'reference', 'seasons.json'), 'utf8')) as Record<string, unknown>;
    const run = (registry: Record<string, unknown>) => {
      const projectRoot = snapshotRoot();
      writeFileSync(join(projectRoot, 'data', 'reference', 'seasons.json'), JSON.stringify(registry));
      return runFixtureScheduleCli(['--label', 'snap-1', '--dry-run'], {
        projectRoot, log: () => {}, ingestionControls: { currentSeasonEnabled: false } as never,
      });
    };
    // SYNTHETIC registry: 2026 no longer in progress, so it is sealed.
    await expect(run({ ...seasons, last_season: 2026, in_progress_seasons: [] })).rejects.toThrow(/seal/i);
    await expect(run({ ...seasons, last_season: 2026, in_progress_seasons: [2026] })).rejects.toThrow(/ingestion is disabled/);
  });
});
