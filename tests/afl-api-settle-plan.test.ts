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
