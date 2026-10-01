/**
 * AFLDB-ISSUE-228 S6 — the read-only settle planner.
 *
 * Covers the complete bundle -> settle records -> match identity ->
 * match/player resolution -> plan path (`afl-api-settle-plan.ts`), plus the
 * match identity context builder it depends on (`afl-api-match-identity.ts`).
 * DB-free: uses the real tracked registry/identities and the same
 * hand-trimmed `tests/fixtures/afl_api/match/*` fixtures
 * `tests/afl-api-match.test.ts` already proves (Hawthorn 122 d Brisbane
 * Lions 131, CD_M20260142801, 2026 Preliminary Final, local match date/time
 * `2026-09-19T17:15:00`), routed through a fake postgres.js tagged-template
 * handle exactly as `tests/afl-api-match.test.ts`'s resolver suites do.
 *
 * No database, Git, network or deployment command is executed by this file
 * or by anything it imports (CLAUDE.md §9).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type postgres from 'postgres';

import {
  buildAflApiMatchBundle,
  buildAflApiSettleRecords,
  parseAflApiIdentities,
  type AflApiMatchBundle,
  type AflApiSettleRecord,
} from '@/lib/acquisition/afl-api-bundle';
import {
  buildAflApiMatchIdentity,
  resolveAflApiMatchClubs,
  resolveAflApiSourceId,
  AflApiMatchIdentityError,
} from '@/lib/acquisition/afl-api-match-identity';
import {
  planAflApiMatchUnit,
  AflApiSettlePlanError,
} from '@/lib/acquisition/afl-api-settle-plan';
import { NO_MATCH_REKEY_SCOPE } from '@/lib/acquisition/match-rekey';
import { parseSourceFamilyRegistry } from '@/lib/acquisition/source-families';

const projectRoot = join(__dirname, '..');
const registry = parseSourceFamilyRegistry(
  JSON.parse(readFileSync(join(projectRoot, 'data', 'reference', 'source-families.json'), 'utf8')),
);
const identities = parseAflApiIdentities(
  JSON.parse(readFileSync(join(projectRoot, 'data', 'reference', 'afl-api-identities.json'), 'utf8')),
);
const fixturesDir = join(projectRoot, 'tests', 'fixtures', 'afl_api');
const readFixture = (relPath: string): any => JSON.parse(readFileSync(join(fixturesDir, relPath), 'utf8'));

const SOURCE_ID = 42;
const HOME_CLUB_ID = 10; // Hawthorn
const AWAY_CLUB_ID = 20; // Brisbane Lions
const EXPECTED_MATCH_KEY = '2026|PF|2026-09-19|Hawthorn|Brisbane Lions';

function loadBundleAndRecords(mutate?: {
  fixture?: (raw: any) => void;
  roster?: (raw: any) => void;
  stats?: (raw: RawStatsFeed) => void;
}): { bundle: AflApiMatchBundle; records: readonly AflApiSettleRecord[] } {
  const fixture = readFixture('match/01-fixture-result.json');
  const roster = readFixture('match/03-match-roster.raw.json');
  const stats = readFixture('match/02-player-stats.raw.json');
  // §11.1 default bundle: the shared trimmed roster fixture deliberately
  // omits `match.venueLocalStartTime` (proven absent by
  // tests/afl-api-match.test.ts's D3a coverage), which otherwise leaves
  // every scenario here pre-empted by unproved_match_date before it reaches
  // the match/player/ownership code path it exists to exercise. Inject the
  // already-measured value (agrees with this fixture's own
  // `utcStartTime`/`venue.timezone`, per the module doc comment) so only the
  // scenarios that explicitly remove match-date evidence (below) see it
  // unproved.
  roster.match.venueLocalStartTime = '2026-09-19T17:15:00';
  mutate?.fixture?.(fixture);
  mutate?.roster?.(roster);
  mutate?.stats?.(stats);
  const bundle = buildAflApiMatchBundle(fixture, roster, stats, registry, identities);
  const records = buildAflApiSettleRecords(bundle, fixture, roster, stats, registry);
  return { bundle, records };
}

type Responder = (text: string) => unknown[];

/**
 * The same routing-by-substring fake postgres.js handle
 * `tests/afl-api-match.test.ts` uses, extended to interleave the
 * interpolated VALUES (JSON-stringified) into the routed text, so a
 * responder can branch on which provider id a given call named — this
 * suite plans two players per unit and needs to answer them differently,
 * unlike the single-identity resolver suites upstream.
 */
function fakeSql(respond: Responder): { sql: postgres.Sql; seen: string[] } {
  const seen: string[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings
      .reduce((acc, part, i) => acc + part + (i < values.length ? JSON.stringify(values[i]) : ''), '')
      .replace(/\s+/g, ' ')
      .trim();
    seen.push(text);
    return Promise.resolve(respond(text));
  }) as unknown as postgres.Sql;
  return { sql, seen };
}

/** Routes the queries a fully-resolved-club, no-existing-match-row planning
 * pass issues: clubs (always), then whatever `matchRespond` answers for the
 * match resolver's own queries, then whatever `playerRespond` answers for
 * each player lookup. */
function planningSql(options: {
  matchRespond?: Responder;
  ownerRespond?: Responder;
  playerRespond?: Responder;
}): { sql: postgres.Sql; seen: string[] } {
  return fakeSql((text) => {
    if (text.includes('FROM clubs')) {
      return [
        { legacyClubHist: 'Hawthorn', id: HOME_CLUB_ID, name: 'Hawthorn' },
        { legacyClubHist: 'Brisbane Lions', id: AWAY_CLUB_ID, name: 'Brisbane Lions' },
      ];
    }
    if (text.includes('FROM matches m')) return options.ownerRespond?.(text) ?? [];
    if (text.includes('FROM external_identities')) return options.playerRespond?.(text) ?? [];
    return options.matchRespond?.(text) ?? [];
  });
}

// ---------------------------------------------------------------------------
// afl-api-match-identity.ts
// ---------------------------------------------------------------------------

describe('resolveAflApiSourceId (AFLDB-ISSUE-228 S6, §5.1)', () => {
  it('resolves sources.id for sources.key = afl_api', async () => {
    const { sql } = fakeSql(() => [{ id: 77 }]);
    await expect(resolveAflApiSourceId(sql)).resolves.toBe(77);
  });

  it('fails closed when no afl_api source row exists', async () => {
    const { sql } = fakeSql(() => []);
    await expect(resolveAflApiSourceId(sql)).rejects.toThrow(/afl_api_source_missing|no row/);
  });
});

describe('resolveAflApiMatchClubs (AFLDB-ISSUE-228 S6, §6.2)', () => {
  it('resolves both sides via clubs.legacy_club_hist in one query', async () => {
    const { sql, seen } = fakeSql(() => [
      { legacyClubHist: 'Hawthorn', id: HOME_CLUB_ID, name: 'Hawthorn' },
      { legacyClubHist: 'Brisbane Lions', id: AWAY_CLUB_ID, name: 'Brisbane Lions' },
    ]);
    const result = await resolveAflApiMatchClubs(sql, 'Hawthorn', 'Brisbane Lions');
    expect(result).toEqual({
      home: { clubId: HOME_CLUB_ID, clubName: 'Hawthorn' },
      away: { clubId: AWAY_CLUB_ID, clubName: 'Brisbane Lions' },
    });
    expect(seen).toHaveLength(1);
  });

  it('fails closed when a hist string has no clubs.legacy_club_hist row (never resolves by name)', async () => {
    const { sql } = fakeSql(() => [{ legacyClubHist: 'Hawthorn', id: HOME_CLUB_ID, name: 'Hawthorn' }]);
    await expect(resolveAflApiMatchClubs(sql, 'Hawthorn', 'Brisbane Lions'))
      .rejects.toThrow(/unmapped_club_hist|Brisbane Lions/);
  });
});

describe('buildAflApiMatchIdentity (AFLDB-ISSUE-228 S6, §6.1, §11.1)', () => {
  it('builds the full identity from a validated bundle, matching the AFLDB-ISSUE-131 match_key format', async () => {
    const { bundle } = loadBundleAndRecords();
    const { sql } = fakeSql(() => [
      { legacyClubHist: 'Hawthorn', id: HOME_CLUB_ID, name: 'Hawthorn' },
      { legacyClubHist: 'Brisbane Lions', id: AWAY_CLUB_ID, name: 'Brisbane Lions' },
    ]);

    const identity = await buildAflApiMatchIdentity(sql, SOURCE_ID, bundle);

    expect(identity).toEqual({
      sourceId: SOURCE_ID,
      providerId: 'CD_M20260142801',
      season: 2026,
      roundCode: 'PF',
      matchDate: '2026-09-19',
      homeClubId: HOME_CLUB_ID,
      awayClubId: AWAY_CLUB_ID,
      matchKey: EXPECTED_MATCH_KEY,
    });
  });

  it('fails closed (unproved_match_date) when the S6-D3a local-time cross-check could not prove a date — never derives from UTC alone', async () => {
    const { bundle } = loadBundleAndRecords({ fixture: (raw) => { delete raw.venue.timezone; } });
    expect(bundle.localMatchDateTime).toBeNull();
    const { sql } = fakeSql(() => []);

    await expect(buildAflApiMatchIdentity(sql, SOURCE_ID, bundle)).rejects.toThrow(AflApiMatchIdentityError);
    await expect(buildAflApiMatchIdentity(sql, SOURCE_ID, bundle)).rejects.toMatchObject({ code: 'unproved_match_date' });
  });
});

// ---------------------------------------------------------------------------
// planAflApiMatchUnit — the full read-only plan
// ---------------------------------------------------------------------------

describe('planAflApiMatchUnit (AFLDB-ISSUE-228 S6)', () => {
  it('a concluded valid match with no existing canonical row plans new_target, and every trusted player resolves', async () => {
    const { bundle, records } = loadBundleAndRecords();
    const { sql } = planningSql({
      matchRespond: () => [], // provider id / match_key / retired-identity: all miss -> unresolved
      playerRespond: () => [{ playerId: 900 }],
    });

    const plan = await planAflApiMatchUnit(sql, registry, SOURCE_ID, bundle, records, {
      kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE,
    });

    expect(plan.providerMatchId).toBe('CD_M20260142801');
    expect(plan.match).toEqual({
      status: 'planned', mode: 'new_target', targetId: null, matchKey: EXPECTED_MATCH_KEY,
      identity: {
        sourceId: SOURCE_ID, providerId: 'CD_M20260142801', season: 2026, roundCode: 'PF',
        matchDate: '2026-09-19', homeClubId: HOME_CLUB_ID, awayClubId: AWAY_CLUB_ID, matchKey: EXPECTED_MATCH_KEY,
      },
    });
    expect(plan.roster).toEqual({ status: 'planned', targetMatchId: null });
    expect(plan.players).toHaveLength(2);
    for (const player of plan.players) {
      expect(player.status).toBe('planned');
      if (player.status === 'planned') {
        expect(player.playerId).toBe(900);
        expect(player.targetMatchId).toBeNull();
        expect([HOME_CLUB_ID, AWAY_CLUB_ID]).toContain(player.clubId);
      }
    }
  });

  it('a missing trusted player identity fails closed for that player only — the match unit still plans', async () => {
    const { bundle, records } = loadBundleAndRecords();
    const { sql } = planningSql({
      matchRespond: () => [],
      playerRespond: (text) => (text.includes('CD_I500001') ? [] : [{ playerId: 900 }]),
    });

    const plan = await planAflApiMatchUnit(sql, registry, SOURCE_ID, bundle, records, {
      kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE,
    });

    expect(plan.match.status).toBe('planned');
    const unresolved = plan.players.find((p) => p.providerPlayerId === 'CD_I500001')!;
    expect(unresolved).toEqual({ status: 'refused', providerPlayerId: 'CD_I500001', reason: 'unresolved_identity' });
    const resolved = plan.players.find((p) => p.providerPlayerId === 'CD_I297354')!;
    expect(resolved.status).toBe('planned');
  });

  it('an ambiguous bridged identity fails closed (player_identity_ambiguous)', async () => {
    const { bundle, records } = loadBundleAndRecords();
    const { sql } = planningSql({
      matchRespond: () => [],
      playerRespond: (text) => (text.includes('CD_I500001')
        ? [{ playerId: 1 }, { playerId: 2 }]
        : [{ playerId: 900 }]),
    });

    const plan = await planAflApiMatchUnit(sql, registry, SOURCE_ID, bundle, records, {
      kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE,
    });

    const ambiguous = plan.players.find((p) => p.providerPlayerId === 'CD_I500001')!;
    expect(ambiguous).toEqual({
      status: 'refused', providerPlayerId: 'CD_I500001', reason: 'player_identity_ambiguous', candidateIds: [1, 2],
    });
  });

  it('an unproved local match date fails closed for the whole unit (match refused, roster/players blocked)', async () => {
    const { bundle, records } = loadBundleAndRecords({ fixture: (raw) => { delete raw.venue.timezone; } });
    const { sql } = planningSql({});

    const plan = await planAflApiMatchUnit(sql, registry, SOURCE_ID, bundle, records, {
      kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE,
    });

    expect(plan.match.status).toBe('refused');
    expect(plan.match).toMatchObject({ status: 'refused', reason: 'unproved_match_date' });
    expect(plan.roster).toEqual({ status: 'blocked' });
    for (const player of plan.players) expect(player.status).toBe('blocked');
  });

  it('a provider-identity contradiction HALTs the unit (match halt, roster/players blocked)', async () => {
    const { bundle, records } = loadBundleAndRecords();
    const { sql } = planningSql({
      matchRespond: (text) => (text.includes('source_record_id =')
        ? [{ id: 501, season: 2026, homeClubId: 999, awayClubId: AWAY_CLUB_ID, matchKey: EXPECTED_MATCH_KEY }]
        : []),
    });

    const plan = await planAflApiMatchUnit(sql, registry, SOURCE_ID, bundle, records, {
      kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE,
    });

    expect(plan.match).toMatchObject({ status: 'halt', reason: 'provider_identity_contradiction', targetId: 501 });
    expect(plan.roster).toEqual({ status: 'blocked' });
    for (const player of plan.players) expect(player.status).toBe('blocked');
  });

  it('an ambiguous provider id refuses the match unit (§6.1 defensive addition) — roster/players blocked', async () => {
    const { bundle, records } = loadBundleAndRecords();
    const { sql } = planningSql({
      matchRespond: (text) => (text.includes('source_record_id =')
        ? [
          { id: 501, season: 2026, homeClubId: HOME_CLUB_ID, awayClubId: AWAY_CLUB_ID, matchKey: EXPECTED_MATCH_KEY },
          { id: 502, season: 2026, homeClubId: HOME_CLUB_ID, awayClubId: AWAY_CLUB_ID, matchKey: EXPECTED_MATCH_KEY },
        ]
        : []),
    });

    const plan = await planAflApiMatchUnit(sql, registry, SOURCE_ID, bundle, records, {
      kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE,
    });

    expect(plan.match).toEqual({ status: 'refused', reason: 'provider_id_ambiguous', candidateIds: [501, 502] });
    expect(plan.roster).toEqual({ status: 'blocked' });
  });

  it('§7.3 (T3): status_not_concluded leaves every family deferred, never a refusal or exception', async () => {
    const { bundle, records } = loadBundleAndRecords({ fixture: (raw) => { raw.status = 'POSTGAME'; } });
    const { sql } = planningSql({}); // no query should run at all

    const plan = await planAflApiMatchUnit(sql, registry, SOURCE_ID, bundle, records, {
      kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE,
    });

    expect(plan.match).toEqual({ status: 'deferred', reason: 'status_not_concluded', detail: 'POSTGAME' });
    expect(plan.roster).toEqual({ status: 'deferred', reason: 'status_not_concluded', detail: 'POSTGAME' });
    for (const player of plan.players) {
      expect(player).toMatchObject({ status: 'deferred', reason: 'status_not_concluded', detail: 'POSTGAME' });
    }
  });

  it('§7.3 (T3): roster_not_concluded defers only match_roster/player_match_stats — the match still plans', async () => {
    const { bundle, records } = loadBundleAndRecords({ roster: (raw) => { raw.matchRoster.status = 'LIVE'; } });
    const { sql } = planningSql({ matchRespond: () => [] });

    const plan = await planAflApiMatchUnit(sql, registry, SOURCE_ID, bundle, records, {
      kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE,
    });

    expect(plan.match.status).toBe('planned');
    expect(plan.roster).toEqual({ status: 'deferred', reason: 'roster_not_concluded', detail: 'LIVE' });
    for (const player of plan.players) {
      expect(player).toMatchObject({ status: 'deferred', reason: 'roster_not_concluded', detail: 'LIVE' });
    }
  });

  it('is deterministic: the same inputs plan the same way across repeated calls', async () => {
    const { bundle, records } = loadBundleAndRecords();
    const { sql } = planningSql({
      matchRespond: () => [],
      playerRespond: () => [{ playerId: 900 }],
    });

    const first = await planAflApiMatchUnit(sql, registry, SOURCE_ID, bundle, records, {
      kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE,
    });
    const second = await planAflApiMatchUnit(sql, registry, SOURCE_ID, bundle, records, {
      kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE,
    });

    expect(second).toEqual(first);
  });

  // -------------------------------------------------------------------
  // §7.5 (Q1): co-source ownership — corroborate, never refuse, never re-own.
  // -------------------------------------------------------------------

  describe('co-source ownership and corroboration (§7.5, Q1)', () => {
    function resolvedToExistingRow() {
      return (text: string): unknown[] => (text.includes('source_record_id =')
        ? [{ id: 501, season: 2026, homeClubId: HOME_CLUB_ID, awayClubId: AWAY_CLUB_ID, matchKey: EXPECTED_MATCH_KEY }]
        : []);
    }

    it('an afltables-owned row with agreeing scores corroborates: no refusal, owner unchanged', async () => {
      const { bundle, records } = loadBundleAndRecords();
      const { sql } = planningSql({
        matchRespond: resolvedToExistingRow(),
        ownerRespond: () => [{ sourceKey: 'afltables', homeScore: 122, awayScore: 131 }],
        playerRespond: () => [{ playerId: 900 }],
      });

      const plan = await planAflApiMatchUnit(sql, registry, SOURCE_ID, bundle, records, {
        kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE,
      });

      expect(plan.match).toMatchObject({ status: 'corroborated', targetId: 501, ownerSourceKey: 'afltables' });
      if (plan.match.status === 'corroborated') {
        expect(plan.match.corroboration.disagreeingGroups).toEqual([]);
        expect(plan.match.corroboration.agreeingGroups).toContain('afltables');
      }
      // A corroborated match still lets its dependent families plan against the existing id.
      expect(plan.roster).toEqual({ status: 'planned', targetMatchId: 501 });
    });

    it('an afltables-owned row with a differing score corroborates as a disagreement, still no refusal', async () => {
      const { bundle, records } = loadBundleAndRecords();
      const { sql } = planningSql({
        matchRespond: resolvedToExistingRow(),
        ownerRespond: () => [{ sourceKey: 'afltables', homeScore: 999, awayScore: 131 }],
        playerRespond: () => [{ playerId: 900 }],
      });

      const plan = await planAflApiMatchUnit(sql, registry, SOURCE_ID, bundle, records, {
        kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE,
      });

      expect(plan.match.status).toBe('corroborated');
      if (plan.match.status === 'corroborated') {
        expect(plan.match.corroboration.disagreeingGroups).toContain('afltables');
      }
    });

    it('a row owned by a non-co-source is the ordinary exception, foreign_owned_collision', async () => {
      const { bundle, records } = loadBundleAndRecords();
      const { sql } = planningSql({
        matchRespond: resolvedToExistingRow(),
        ownerRespond: () => [{ sourceKey: 'squiggle_api', homeScore: 122, awayScore: 131 }],
      });

      const plan = await planAflApiMatchUnit(sql, registry, SOURCE_ID, bundle, records, {
        kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE,
      });

      expect(plan.match).toEqual({ status: 'refused', reason: 'foreign_owned_collision', detail: 'squiggle_api' });
      expect(plan.roster).toEqual({ status: 'blocked' });
    });

    it('an unowned row (source_id NULL) is ok to write — no re-ownership question, no corroboration needed', async () => {
      const { bundle, records } = loadBundleAndRecords();
      const { sql } = planningSql({
        matchRespond: resolvedToExistingRow(),
        ownerRespond: () => [{ sourceKey: null, homeScore: 122, awayScore: 131 }],
        playerRespond: () => [{ playerId: 900 }],
      });

      const plan = await planAflApiMatchUnit(sql, registry, SOURCE_ID, bundle, records, {
        kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE,
      });

      expect(plan.match).toMatchObject({ status: 'planned', mode: 'update_owned', targetId: 501, ownerSourceKey: null });
    });

    it('a row already owned by afl_api itself is an ordinary same-source update, never corroboration', async () => {
      const { bundle, records } = loadBundleAndRecords();
      const { sql } = planningSql({
        matchRespond: resolvedToExistingRow(),
        ownerRespond: () => [{ sourceKey: 'afl_api', homeScore: 122, awayScore: 131 }],
        playerRespond: () => [{ playerId: 900 }],
      });

      const plan = await planAflApiMatchUnit(sql, registry, SOURCE_ID, bundle, records, {
        kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE,
      });

      expect(plan.match).toMatchObject({ status: 'planned', mode: 'update_owned', targetId: 501, ownerSourceKey: 'afl_api' });
    });
  });

  // -------------------------------------------------------------------
  // AFLDB-ISSUE-244 I244-F030: an unresolved record is not proof that no canonical
  // fixture exists. The plausibility predicate itself is SQL (integration-tested);
  // these prove the planner's use of its ANSWER, through the same routed fake.
  // -------------------------------------------------------------------

  describe('unresolved record vs a plausible existing canonical fixture (AFLDB-ISSUE-244 I244-F030)', () => {
    /** Answers ONLY the F030 helper's query (it alone has no spine join); the retired-identity search stays empty. */
    const plausible = (rows: unknown[]) => (text: string): unknown[] => (text.includes('source_records') ? [] : rows);
    const isPlausibilityQuery = (text: string): boolean => /FROM matches m WHERE .* ORDER BY m\.id LIMIT/.test(text)
      && !text.includes('source_records');

    it('one plausible fixture REFUSES possible_existing_match — never new_target — and roster and players are blocked', async () => {
      const { bundle, records } = loadBundleAndRecords();
      const foreign = { id: 501, matchKey: '2026|PF|2026-09-20|Hawthorn|Brisbane Lions', sourceId: 3 };
      const { sql, seen } = planningSql({
        matchRespond: () => [], // provider id / match_key: both miss -> unresolved
        ownerRespond: plausible([foreign]),
        playerRespond: () => [{ playerId: 900 }],
      });

      const plan = await planAflApiMatchUnit(sql, registry, SOURCE_ID, bundle, records, {
        kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE,
      });

      expect(plan.match).toEqual({
        status: 'refused', reason: 'possible_existing_match', detail: 'matches.id 501',
        candidateIds: [501], candidates: [foreign], providerMatchKey: EXPECTED_MATCH_KEY,
      });
      expect(plan.match.status).not.toBe('planned');
      expect(plan.roster).toEqual({ status: 'blocked' });
      for (const player of plan.players) expect(player.status).toBe('blocked');
      // Asked once, and only after the provider-id and exact-key lookups had missed.
      const asked = seen.filter(isPlausibilityQuery);
      expect(asked).toHaveLength(1);
      expect(seen.indexOf(asked[0])).toBeGreaterThan(seen.findIndex((text) => text.includes('match_key =')));
    });

    it('several plausible fixtures refuse too, listing every one — the planner never picks a first, closest or newest', async () => {
      const { bundle, records } = loadBundleAndRecords();
      const rows = [
        { id: 501, matchKey: '2026|PF|2026-09-20|Hawthorn|Brisbane Lions', sourceId: 3 },
        { id: 502, matchKey: '2026|SF|2026-09-19|Hawthorn|Brisbane Lions', sourceId: null },
      ];
      const { sql } = planningSql({ matchRespond: () => [], ownerRespond: plausible(rows) });

      const plan = await planAflApiMatchUnit(sql, registry, SOURCE_ID, bundle, records, {
        kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE,
      });

      expect(plan.match).toMatchObject({ status: 'refused', reason: 'possible_existing_match', candidateIds: [501, 502] });
      // A refusal has no target: nothing was chosen from the candidates.
      expect(plan.match).not.toHaveProperty('targetId');
      expect(plan.roster).toEqual({ status: 'blocked' });
    });

    it('no plausible fixture leaves new_target exactly as it was', async () => {
      const { bundle, records } = loadBundleAndRecords();
      const { sql, seen } = planningSql({ matchRespond: () => [], ownerRespond: plausible([]), playerRespond: () => [{ playerId: 900 }] });

      const plan = await planAflApiMatchUnit(sql, registry, SOURCE_ID, bundle, records, {
        kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE,
      });

      expect(plan.match).toMatchObject({ status: 'planned', mode: 'new_target', targetId: null, matchKey: EXPECTED_MATCH_KEY });
      expect(seen.filter(isPlausibilityQuery)).toHaveLength(1);
    });

    it('a RESOLVED record never asks: the provider-id hit stands, and a deferred record issues no query at all', async () => {
      const resolved = loadBundleAndRecords();
      const { sql, seen } = planningSql({
        matchRespond: (text) => (text.includes('source_record_id =')
          ? [{ id: 501, season: 2026, homeClubId: HOME_CLUB_ID, awayClubId: AWAY_CLUB_ID, matchKey: EXPECTED_MATCH_KEY }]
          : []),
        ownerRespond: (text) => (isPlausibilityQuery(text)
          ? [{ id: 999, matchKey: 'must-never-be-read', sourceId: 3 }]
          : [{ sourceKey: 'afl_api', homeScore: 122, awayScore: 131 }]),
        playerRespond: () => [{ playerId: 900 }],
      });
      const plan = await planAflApiMatchUnit(sql, registry, SOURCE_ID, resolved.bundle, resolved.records, {
        kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE,
      });
      expect(plan.match).toMatchObject({ status: 'planned', mode: 'update_owned', targetId: 501 });
      expect(seen.filter(isPlausibilityQuery)).toHaveLength(0);

      const deferred = loadBundleAndRecords({ fixture: (raw) => { raw.status = 'POSTGAME'; } });
      const quiet = planningSql({});
      await planAflApiMatchUnit(quiet.sql, registry, SOURCE_ID, deferred.bundle, deferred.records, {
        kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE,
      });
      expect(quiet.seen).toHaveLength(0);
    });
  });

  it('throws (never silently plans) when the resolver returns an id readMatchOwnerAndScores cannot find', async () => {
    const { bundle, records } = loadBundleAndRecords();
    const { sql } = planningSql({
      matchRespond: (text) => (text.includes('source_record_id =')
        ? [{ id: 501, season: 2026, homeClubId: HOME_CLUB_ID, awayClubId: AWAY_CLUB_ID, matchKey: EXPECTED_MATCH_KEY }]
        : []),
      ownerRespond: () => [],
    });

    await expect(planAflApiMatchUnit(sql, registry, SOURCE_ID, bundle, records, {
      kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE,
    })).rejects.toThrow(AflApiSettlePlanError);
  });
});

// ---------------------------------------------------------------------------
// AFLDB-ISSUE-255 — unused-emergency non-participants (D-255-1/2/4)
// ---------------------------------------------------------------------------

const PLAYED_HOME_PLAYER = 'CD_I297354'; // Karl Amon, HBFL, 81% TOG in the fixture
const FIORINI = 'CD_I993799';

type BundleMutation = Parameters<typeof loadBundleAndRecords>[0];

/** Every numeric leaf of a raw `playerStats.stats` block set to 0, recursively (clearances included). */
function zeroNumericLeaves(node: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'number') node[key] = 0;
    else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      zeroNumericLeaves(value as Record<string, unknown>);
    }
  }
}

/** Only the raw-feed members these helpers touch; everything else stays opaque. */
interface RawRosterEntry { position: string; player: { playerId: string } & Record<string, unknown> }
interface RawRoster {
  matchRoster: { homeTeam: { positions: RawRosterEntry[] }; awayTeam: { positions: RawRosterEntry[] } };
}
interface RawStatsEntry {
  player: { jumperNumber: number; player: { position: string; player: Record<string, unknown> } };
  playerStats: {
    player: { playerId: string } & Record<string, unknown>;
    timeOnGroundPercentage?: unknown;
    gamesPlayed?: unknown;
    stats: Record<string, unknown>;
  };
}
interface RawStatsFeed { homeTeamPlayerStats: RawStatsEntry[]; awayTeamPlayerStats: RawStatsEntry[] }

function rosterEntryOf(roster: RawRoster, playerId: string): RawRosterEntry {
  const all = [...roster.matchRoster.homeTeam.positions, ...roster.matchRoster.awayTeam.positions];
  const found = all.find((entry) => entry.player.playerId === playerId);
  if (!found) throw new Error(`fixture roster has no ${playerId}`);
  return found;
}

function statsEntryOf(stats: RawStatsFeed, playerId: string): RawStatsEntry {
  const all = [...stats.homeTeamPlayerStats, ...stats.awayTeamPlayerStats];
  const found = all.find((entry) => entry.playerStats.player.playerId === playerId);
  if (!found) throw new Error(`fixture stats feed has no ${playerId}`);
  return found;
}

/**
 * The authentic DEV shape (`afl-api-2026-2026-10-01-094537`, `CD_M20260140305`, ISSUE-232 §7
 * D1b): an EXTRA home row beside the played ones, named `EMERG` on the roster (and in the
 * stats feed's own position copy), `timeOnGroundPercentage` 0.0, every counting statistic 0,
 * `extendedStats` null, `gamesPlayed` null, jumper 8. Built from this fixture's own entries,
 * so every other field keeps the proven-valid shape.
 */
function withFioriniShapedEmergency(): BundleMutation {
  const name = { givenName: 'Brayden', surname: 'Fiorini' };
  return {
    roster: (raw) => {
      const entry = structuredClone(raw.matchRoster.homeTeam.positions[0]);
      entry.position = 'EMERG';
      entry.player = { ...entry.player, playerId: FIORINI, playerName: name, captain: false, playerJumperNumber: 8 };
      raw.matchRoster.homeTeam.positions.push(entry);
    },
    stats: (raw) => {
      const entry = structuredClone(raw.homeTeamPlayerStats[0]);
      entry.player.player.position = 'EMERG';
      entry.player.player.player = {
        ...entry.player.player.player, playerId: FIORINI, playerName: name, captain: false, playerJumperNumber: 8,
      };
      entry.player.jumperNumber = 8;
      entry.playerStats.player = {
        ...entry.playerStats.player, playerId: FIORINI, playerName: name, captain: false, playerJumperNumber: 8,
      };
      entry.playerStats.timeOnGroundPercentage = 0.0;
      entry.playerStats.gamesPlayed = null;
      zeroNumericLeaves(entry.playerStats.stats);
      entry.playerStats.stats.extendedStats = null;
      raw.homeTeamPlayerStats.push(entry);
    },
  };
}

/** Mutates the played home player in place: roster position, TOG and the stats block. */
function homePlayerAs(options: {
  position?: string;
  tog?: unknown;
  deleteTog?: boolean;
  zeroStats?: boolean;
  stats?: Record<string, unknown>;
}): BundleMutation {
  return {
    roster: (raw) => {
      if (options.position !== undefined) rosterEntryOf(raw, PLAYED_HOME_PLAYER).position = options.position;
    },
    stats: (raw) => {
      const entry = statsEntryOf(raw, PLAYED_HOME_PLAYER);
      if (options.deleteTog) delete entry.playerStats.timeOnGroundPercentage;
      else if ('tog' in options) entry.playerStats.timeOnGroundPercentage = options.tog;
      if (options.zeroStats) zeroNumericLeaves(entry.playerStats.stats);
      Object.assign(entry.playerStats.stats, options.stats ?? {});
    },
  };
}

async function planOf(mutate: BundleMutation) {
  const { bundle, records } = loadBundleAndRecords(mutate);
  const { sql, seen } = planningSql({ matchRespond: () => [], playerRespond: () => [{ playerId: 900 }] });
  const plan = await planAflApiMatchUnit(sql, registry, SOURCE_ID, bundle, records, {
    kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE,
  });
  const statusOf = (providerPlayerId: string) => plan.players.find((p) => p.providerPlayerId === providerPlayerId)?.status;
  return { plan, records, seen, statusOf };
}

describe('AFLDB-ISSUE-255 — unused-emergency player_match_stats rows are observation-only', () => {
  it('REGRESSION (CD_M20260140305 / CD_I993799 shape): the extra EMERG, 0% TOG, all-zero row plans as a non-participant; the played rows are untouched', async () => {
    const { plan, records, seen, statusOf } = await planOf(withFioriniShapedEmergency());

    expect(plan.players).toHaveLength(3);
    expect(plan.players.find((p) => p.providerPlayerId === FIORINI)).toEqual({
      status: 'non_participant', providerPlayerId: FIORINI,
    });
    expect(statusOf(PLAYED_HOME_PLAYER)).toBe('planned');
    expect(statusOf('CD_I500001')).toBe('planned');
    // D-255-2: decided before identity resolution: no lookup is even issued for it...
    expect(seen.some((text) => text.includes('FROM external_identities') && text.includes(FIORINI))).toBe(false);
    // ...while the played players still resolve exactly as before.
    expect(seen.some((text) => text.includes('FROM external_identities') && text.includes(PLAYED_HOME_PLAYER))).toBe(true);

    // D-255-2: the row is still a real source record; the spine persists every settle record.
    const fiorini = records.find((r) => r.externalRecordId === `CD_M20260142801|CD_T80|${FIORINI}`);
    expect(fiorini).toBeDefined();
    expect(fiorini?.family).toBe('player_match_stats');
    expect(fiorini?.deferral).toBeNull();
    expect(fiorini?.rejection).toBeNull();
    expect(fiorini?.payload).not.toBeNull();
    expect(records.filter((r) => r.family === 'player_match_stats')).toHaveLength(3);
  });

  it('A. EMERG + TOG 0 + every projected statistic 0 => non-participant', async () => {
    const { statusOf } = await planOf(homePlayerAs({ position: 'EMERG', tog: 0, zeroStats: true }));
    expect(statusOf(PLAYED_HOME_PLAYER)).toBe('non_participant');
  });

  it.each([34, 85, 0.5])('B. POSITIVE CONTROL: EMERG + TOG %s with real statistics stays a planned participant', async (tog) => {
    const { statusOf } = await planOf(homePlayerAs({ position: 'EMERG', tog }));
    expect(statusOf(PLAYED_HOME_PLAYER)).toBe('planned');
  });

  it('B. EMERG + TOG > 0 stays planned even when every projected statistic is 0', async () => {
    const { statusOf } = await planOf(homePlayerAs({ position: 'EMERG', tog: 12, zeroStats: true }));
    expect(statusOf(PLAYED_HOME_PLAYER)).toBe('planned');
  });

  it.each([
    ['tackles', { tackles: 1 }],
    ['onePercenters', { onePercenters: 1 }],
    ['clearances.totalClearances', { clearances: { centreClearances: 0, stoppageClearances: 1, totalClearances: 1 } }],
  ])('C. EMERG + TOG 0 + a non-zero %s stays on the existing path', async (_label, nonZero) => {
    const { statusOf } = await planOf(homePlayerAs({ position: 'EMERG', tog: 0, zeroStats: true, stats: nonZero }));
    expect(statusOf(PLAYED_HOME_PLAYER)).toBe('planned');
  });

  it.each(['HBFL', 'INT', 'emerg', 'EMERG '])('D. roster position %j + TOG 0 + all-zero statistics stays on the existing path', async (position) => {
    const { statusOf } = await planOf(homePlayerAs({ position, tog: 0, zeroStats: true }));
    expect(statusOf(PLAYED_HOME_PLAYER)).toBe('planned');
  });

  it.each([
    ['null', { tog: null }],
    ['missing', { deleteTog: true }],
    ['a string "0"', { tog: '0' }],
  ] as const)('E. EMERG + TOG %s + all-zero statistics stays on the existing path', async (_label, tog) => {
    const { statusOf } = await planOf(homePlayerAs({ position: 'EMERG', zeroStats: true, ...tog }));
    expect(statusOf(PLAYED_HOME_PLAYER)).toBe('planned');
  });

  it('a NULL projected statistic is not 0: EMERG + TOG 0 + one null statistic stays on the existing path', async () => {
    const { statusOf } = await planOf(homePlayerAs({ position: 'EMERG', tog: 0, zeroStats: true, stats: { kicks: null } }));
    expect(statusOf(PLAYED_HOME_PLAYER)).toBe('planned');
  });

  it("the stats feed's own position copy is never the evidence: EMERG there but not on the roster stays on the existing path", async () => {
    const { statusOf } = await planOf({
      stats: (raw) => {
        const entry = statsEntryOf(raw, PLAYED_HOME_PLAYER);
        entry.player.player.position = 'EMERG';
        entry.playerStats.timeOnGroundPercentage = 0;
        zeroNumericLeaves(entry.playerStats.stats);
      },
    });
    expect(statusOf(PLAYED_HOME_PLAYER)).toBe('planned');
  });

  it('ambiguous roster evidence stays on the existing path: absent, named twice, or EMERG on the other team', async () => {
    const zeroed = (raw: RawStatsFeed) => {
      const entry = statsEntryOf(raw, PLAYED_HOME_PLAYER);
      entry.playerStats.timeOnGroundPercentage = 0;
      zeroNumericLeaves(entry.playerStats.stats);
    };
    const absent = await planOf({
      roster: (raw) => {
        // The roster names somebody else as the emergency; this player is not on it at all.
        const entry = rosterEntryOf(raw, PLAYED_HOME_PLAYER);
        entry.position = 'EMERG';
        entry.player.playerId = 'CD_I000001';
      },
      stats: zeroed,
    });
    expect(absent.statusOf(PLAYED_HOME_PLAYER)).toBe('planned');

    const twice = await planOf({
      roster: (raw) => {
        rosterEntryOf(raw, PLAYED_HOME_PLAYER).position = 'EMERG';
        raw.matchRoster.homeTeam.positions.push(structuredClone(rosterEntryOf(raw, PLAYED_HOME_PLAYER)));
      },
      stats: zeroed,
    });
    expect(twice.statusOf(PLAYED_HOME_PLAYER)).toBe('planned');

    const otherTeam = await planOf({
      roster: (raw) => {
        // Named EMERG, but on the AWAY roster while the stat row is the home side's.
        const entry = rosterEntryOf(raw, PLAYED_HOME_PLAYER);
        raw.matchRoster.awayTeam.positions.push({ ...structuredClone(entry), position: 'EMERG' });
        entry.player.playerId = 'CD_I000001';
      },
      stats: zeroed,
    });
    expect(otherTeam.statusOf(PLAYED_HOME_PLAYER)).toBe('planned');
  });

  it('deferral keeps precedence: a not-yet-concluded roster defers the row rather than classifying it', async () => {
    const deferred = await planOf({
      roster: (raw) => {
        rosterEntryOf(raw, PLAYED_HOME_PLAYER).position = 'EMERG';
        raw.matchRoster.status = 'POSTGAME';
      },
      stats: (raw) => {
        const entry = statsEntryOf(raw, PLAYED_HOME_PLAYER);
        entry.playerStats.timeOnGroundPercentage = 0;
        zeroNumericLeaves(entry.playerStats.stats);
      },
    });
    expect(deferred.statusOf(PLAYED_HOME_PLAYER)).toBe('deferred');
  });
});
