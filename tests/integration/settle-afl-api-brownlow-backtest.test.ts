/**
 * AFLDB-ISSUE-228 §10 follow-up (2026-09-20) — the completed-season Brownlow
 * backtest authority against real PostgreSQL.
 *
 * `requireAflApiBrownlowBacktestDatabase()` / `completedSeasonBacktestAuthority`
 * (`src/lib/acquisition/afl-api-brownlow.ts`) narrow exactly ONE gate —
 * canonical-apply.ts's E2 (`season_not_in_progress`) — for exactly one
 * target (`brownlow_round_votes`) of exactly one run, and only once the live
 * connection has proved itself `afldb_test` via `current_database()`. This
 * suite proves both halves: the default refusal (no override) and the
 * narrowly-scoped bypass (override present), and proves the bypass reaches
 * no further than E2 — an invalid vote set, an untrusted identity and a
 * finals round are refused identically with or without it.
 *
 * ISOLATED from `tests/integration/settle-afl-api-brownlow.test.ts`: that
 * suite's cleanup()/afterAll() hard-code an exact 2-match (`p`, `q`) ledger
 * it self-heals around, which a third match here would break. This file
 * owns one match and its own three synthetic voters end to end, under its
 * own NS, and never touches the sibling suite's rows.
 *
 * @see src/lib/acquisition/afl-api-brownlow.ts
 * @see issues/open/AFLDB-ISSUE-228.md §10
 */
import './guard';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  parseAflApiIdentities, type AflApiBrownlowMatchVoteRecord, type AflApiIdentities,
} from '@/lib/acquisition/afl-api-bundle';
import {
  requireAflApiBrownlowBacktestDatabase,
  runSettleAflApiBrownlow,
  SETTLE_BATCH_TOOL,
  type AflApiBrownlowCompletedSeasonBacktestAuthority,
} from '@/lib/acquisition/afl-api-brownlow';
import {
  buildAflApiSettleBundle,
  runSettleAflApi,
  type AflApiSettleBundle,
  type AflApiSettleUnitSource,
} from '@/lib/acquisition/settle-afl-api';
import { affectedPlayerIds, renderMatchKey, type DerivedScope } from '@/lib/acquisition/settle-core';
import {
  getSourceFamily, parseSourceFamilyRegistry, type SourceFamilyRegistry,
} from '@/lib/acquisition/source-families';
import { recomputePlayerDerivedStats } from '@/db/queries/player-derived';

const PROJECT_ROOT = join(__dirname, '..', '..');
const FIXTURE_DIR = join(PROJECT_ROOT, 'tests', 'fixtures', 'afl_api', 'match');

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8'));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** This suite's own namespace. Appears nowhere else in the repository. */
const NS = 'CD_M2026I228BT';
const SEASON = 2026;
const HOME_HIST = 'Hawthorn';
const AWAY_HIST = 'Brisbane Lions';
const MATCH_DATE = '2026-09-28';
const PROVIDER_MATCH_ID = `${NS}ORD`;

/**
 * Same non-final round §6.4 row the sibling suite already proved safe:
 * `api_round_number: 5` -> `{ round_type: 'home_and_away',
 * canonical_round_number: 6 }` for the 2026 vocabulary. `ROUND_CODE` for a
 * home-and-away row is `String(canonical_round_number)`.
 */
const API_ROUND_NUMBER = 5;
const ROUND_CODE = '6';
/** A Grand Final round number (2026 vocabulary, `mixed_finals` excluded
 * separately) — used only inside a vote record's own `apiRoundNumber` to
 * prove the backtest authority does not rescue a finals round translation.
 * `translateAflApiBrownlowRound(registry, 2026, 29)` is already proved to
 * refuse `brownlow_round_not_home_and_away` in `tests/afl-api-brownlow.test.ts`. */
const FINALS_API_ROUND_NUMBER = 29;

const VOTER_PROVIDER_IDS = ['CD_I228BT01', 'CD_I228BT02', 'CD_I228BT03'] as const;
const VOTER_LEGACY_IDS = [-228320001, -228320002, -228320003] as const;
/** Deliberately never given an `external_identities` row. */
const UNTRUSTED_VOTER_PROVIDER_ID = 'CD_I228BTUNKNOWN';

function unitSourceFor(providerMatchId: string, matchDate: string): AflApiSettleUnitSource {
  const fixture = clone(readFixture('01-fixture-result.json')) as Record<string, any>;
  const roster = clone(readFixture('03-match-roster.raw.json')) as Record<string, any>;
  const stats = clone(readFixture('02-player-stats.raw.json')) as Record<string, any>;

  fixture.providerId = providerMatchId;
  fixture.utcStartTime = `${matchDate}T07:15:00.000+0000`;
  // The raw fixture is a Preliminary Final by default; render it as an
  // ordinary home-and-away round so the underlying match settles as
  // non-final (finals exclusion is tested at the vote's own round number
  // instead — see FINALS_API_ROUND_NUMBER above).
  fixture.round = { ...fixture.round, roundNumber: API_ROUND_NUMBER, abbreviation: 'Rd 5', name: 'Round 5' };
  roster.match.matchId = providerMatchId;
  roster.match.venueLocalStartTime = `${matchDate}T17:15:00`;
  roster.matchRoster.matchId = providerMatchId;
  roster.matchRoster.roundNumber = API_ROUND_NUMBER;
  roster.matchRoster.homeTeam.matchId = providerMatchId;
  roster.matchRoster.awayTeam.matchId = providerMatchId;
  roster.recentMatchScores[0].matchId = providerMatchId;

  return { fixtureRaw: fixture, rosterRaw: roster, playerStatsRaw: stats };
}

function buildBundle(
  sources: readonly AflApiSettleUnitSource[], registry: SourceFamilyRegistry, identities: AflApiIdentities,
): AflApiSettleBundle {
  const bundle = buildAflApiSettleBundle({
    season: SEASON, snapshotLabel: 'issue228-brownlow-backtest', sources, registry, identities,
  });
  if (bundle.buildFailures.length > 0) {
    throw new Error(`Bundle build failure(s): ${JSON.stringify(bundle.buildFailures)}`);
  }
  return bundle;
}

function voteRecordFor(
  apiRoundNumber: number,
  votes: readonly { providerPlayerId: string; providerTeamId: string; votes: number }[],
): AflApiBrownlowMatchVoteRecord {
  return {
    providerMatchId: PROVIDER_MATCH_ID,
    apiRoundNumber,
    votes: votes.map((v) => ({ ...v, eligible: true })),
  };
}

const VALID_VOTES = [
  { providerPlayerId: VOTER_PROVIDER_IDS[0], providerTeamId: 'CD_T80', votes: 3 },
  { providerPlayerId: VOTER_PROVIDER_IDS[1], providerTeamId: 'CD_T20', votes: 2 },
  { providerPlayerId: VOTER_PROVIDER_IDS[2], providerTeamId: 'CD_T80', votes: 1 },
] as const;

/** #6: an invalid vote set — the same provider id appears twice, so two
 * units resolve to the same canonical player. Must refuse identically with
 * or without the backtest authority: the authority narrows E2 only, and
 * this refusal (`duplicate_player_canonical_identity`) never reaches E2. */
const DUPLICATE_IDENTITY_VOTES = [
  { providerPlayerId: VOTER_PROVIDER_IDS[0], providerTeamId: 'CD_T80', votes: 3 },
  { providerPlayerId: VOTER_PROVIDER_IDS[0], providerTeamId: 'CD_T80', votes: 2 },
  { providerPlayerId: VOTER_PROVIDER_IDS[2], providerTeamId: 'CD_T80', votes: 1 },
] as const;

/** #7: an unknown/untrusted identity — no `external_identities` row exists
 * for this provider id anywhere on afldb_test. */
const UNTRUSTED_IDENTITY_VOTES = [
  { providerPlayerId: UNTRUSTED_VOTER_PROVIDER_ID, providerTeamId: 'CD_T80', votes: 3 },
  { providerPlayerId: VOTER_PROVIDER_IDS[1], providerTeamId: 'CD_T20', votes: 2 },
  { providerPlayerId: VOTER_PROVIDER_IDS[2], providerTeamId: 'CD_T80', votes: 1 },
] as const;

const sql = postgres(process.env.AFLDB_TEST_DATABASE_URL as string, { max: 1, onnotice: () => {} });

let registry: SourceFamilyRegistry;
let identities: AflApiIdentities;
let aflApiSourceId: number;
let homeClubName: string;
let awayClubName: string;
let backtestAuthority: AflApiBrownlowCompletedSeasonBacktestAuthority;

function matchKey(): string {
  if (!homeClubName || !awayClubName) {
    throw new Error('matchKey() was called before beforeAll() resolved the canonical club names.');
  }
  return renderMatchKey(SEASON, ROUND_CODE, MATCH_DATE, homeClubName, awayClubName);
}

/** Removes every row this suite can create, and nothing else. Mirrors the
 * sibling suite's cleanup() (`settle-afl-api-brownlow.test.ts`), narrowed to
 * this suite's single match. */
async function cleanup(): Promise<void> {
  const [existing] = await sql<{ id: number }[]>`SELECT id FROM matches WHERE match_key = ${matchKey()}`;
  const ids = existing ? [existing.id] : [];

  const derivedScope: DerivedScope = { playerIds: new Set(), matchIds: new Set(ids) };
  const liveStatsPlayerIds = ids.length > 0
    ? await sql.begin((tx) => affectedPlayerIds(tx, derivedScope))
    : [];

  const stalePointerPlayerIds = ids.length > 0
    ? (await sql<{ playerId: number }[]>`
        SELECT DISTINCT player_id::int AS "playerId"
          FROM player_clubs
         WHERE first_match_id = ANY(${ids}::bigint[])
            OR last_match_id = ANY(${ids}::bigint[])
      `).map((r) => r.playerId)
    : [];

  const touchedPlayerIds = [...new Set([...liveStatsPlayerIds, ...stalePointerPlayerIds])]
    .sort((a, b) => a - b);

  if (ids.length > 0) {
    await sql`DELETE FROM player_match_stats WHERE match_id = ANY(${ids}::bigint[])`;
    await sql`DELETE FROM match_period_scores WHERE match_id = ANY(${ids}::bigint[])`;
  }
  if (touchedPlayerIds.length > 0) {
    await sql.begin((tx) => recomputePlayerDerivedStats(tx, touchedPlayerIds, SEASON));
  }
  await sql`DELETE FROM canonical_applications WHERE external_record_id LIKE ${`${NS}%`}`;
  await sql`DELETE FROM promotion_candidates WHERE external_record_id LIKE ${`${NS}%`}`;
  await sql`DELETE FROM data_issues WHERE issue_key LIKE ${`%${NS}%`}`;
  await sql`DELETE FROM import_rejections WHERE source_record_id LIKE ${`${NS}%`}`;
  await sql`DELETE FROM brownlow_round_votes WHERE source_record_id = ${PROVIDER_MATCH_ID}`;
  // AFLDB-ISSUE-228 S7 typed-projection closure: projectAflApiBrownlowVoteSet()
  // now writes staging.afl_api_brownlow_vote for every planned set. Must run
  // BEFORE the `matches` DELETE below — its `match_id` column REFERENCES
  // matches(id) with no ON DELETE clause.
  await sql`DELETE FROM staging.afl_api_brownlow_vote WHERE provider_match_id = ${PROVIDER_MATCH_ID}`;
  if (ids.length > 0) await sql`DELETE FROM matches WHERE id = ANY(${ids}::bigint[])`;

  await sql`DELETE FROM staging.afl_api_player_match WHERE provider_match_id = ${PROVIDER_MATCH_ID}`;
  await sql`DELETE FROM staging.afl_api_match WHERE external_record_id = ${PROVIDER_MATCH_ID}`;

  const doomedPayloads = await sql<{ sourceId: number; family: string; payloadHash: string }[]>`
    SELECT DISTINCT source_id AS "sourceId", family, payload_hash AS "payloadHash"
      FROM staging.source_record_versions
     WHERE source_id = ${aflApiSourceId} AND external_record_id LIKE ${`${NS}%`}
  `;
  await sql`
    DELETE FROM staging.source_records
     WHERE source_id = ${aflApiSourceId} AND external_record_id LIKE ${`${NS}%`}
  `;
  await sql`
    DELETE FROM staging.source_record_versions
     WHERE source_id = ${aflApiSourceId} AND external_record_id LIKE ${`${NS}%`}
  `;
  for (const payload of doomedPayloads) {
    await sql`
      DELETE FROM staging.source_payloads
       WHERE source_id = ${payload.sourceId} AND family = ${payload.family}
         AND payload_hash = ${payload.payloadHash}
         AND NOT EXISTS (
           SELECT 1 FROM staging.source_record_versions v
            WHERE v.source_id = ${payload.sourceId} AND v.family = ${payload.family}
              AND v.payload_hash = ${payload.payloadHash}
         )
    `;
  }
  await sql`DELETE FROM import_batches WHERE notes LIKE ${'%issue228-brownlow-backtest%'}`;
  // The Brownlow settle's own batches carry no NS-scoped text in their notes
  // (only `season=...`), exactly as the sibling suite documents — safe here
  // only because `vitest.config.mts` pins `fileParallelism: false`, so this
  // file's own afterAll always finishes before another suite using the same
  // season starts.
  await sql`
    DELETE FROM import_batches
     WHERE tool = ${SETTLE_BATCH_TOOL} AND notes LIKE ${`%season=${SEASON}%`}
  `;

  const voterLegacyIds = [...VOTER_LEGACY_IDS];
  await sql`
    DELETE FROM player_clubs
     WHERE player_id IN (SELECT id FROM players WHERE legacy_player_id = ANY(${voterLegacyIds}::bigint[]))
  `;
  await sql`
    DELETE FROM external_identities
     WHERE source_id = ${aflApiSourceId} AND external_id = ANY(${[...VOTER_PROVIDER_IDS]})
  `;
  await sql`DELETE FROM players WHERE legacy_player_id = ANY(${voterLegacyIds}::bigint[])`;
}

beforeAll(async () => {
  registry = parseSourceFamilyRegistry(
    JSON.parse(readFileSync(join(PROJECT_ROOT, 'data', 'reference', 'source-families.json'), 'utf8')),
  );
  identities = parseAflApiIdentities(
    JSON.parse(readFileSync(join(PROJECT_ROOT, 'data', 'reference', 'afl-api-identities.json'), 'utf8')),
  );
  getSourceFamily(registry, 'afl_api', 'brownlow_match_votes'); // fails loudly if the registry is somehow not this repo's

  const [afl] = await sql<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afl_api'`;
  if (!afl) throw new Error("source 'afl_api' (migration 077) must exist on afldb_test.");
  aflApiSourceId = afl.id;

  const [home] = await sql<{ id: number; name: string }[]>`SELECT id, name FROM clubs WHERE legacy_club_hist = ${HOME_HIST}`;
  const [away] = await sql<{ id: number; name: string }[]>`SELECT id, name FROM clubs WHERE legacy_club_hist = ${AWAY_HIST}`;
  if (!home || !away) throw new Error('Hawthorn and Brisbane Lions must both exist on afldb_test.');
  homeClubName = home.name;
  awayClubName = away.name;

  // #9's DB-connected half: proves this suite really is running against
  // afldb_test before any test below relies on the authority it grants.
  backtestAuthority = await requireAflApiBrownlowBacktestDatabase(sql);
  if (backtestAuthority.verifiedDatabase !== 'afldb_test') {
    throw new Error(`Expected afldb_test, got '${backtestAuthority.verifiedDatabase}'.`);
  }

  await cleanup();

  for (let i = 0; i < VOTER_PROVIDER_IDS.length; i += 1) {
    const legacyId = VOTER_LEGACY_IDS[i];
    const providerId = VOTER_PROVIDER_IDS[i];
    const [player] = await sql<{ id: number }[]>`
      INSERT INTO players (legacy_player_id, display_name, sort_name, search_name, slug, given_name, surname)
      VALUES (
        ${legacyId},
        ${`Backtest Voter ${i + 1} (ISSUE-228 §10 follow-up fixture)`},
        ${`BacktestVoter${i + 1} (ISSUE-228 §10 follow-up fixture)`},
        ${`backtest voter ${i + 1} issue228 followup fixture`},
        ${`backtest-voter-${i + 1}-issue228-followup-fixture`},
        'BacktestVoter', ${`Issue228FollowupTest${i + 1}`}
      )
      ON CONFLICT (legacy_player_id) DO UPDATE SET display_name = EXCLUDED.display_name
      RETURNING id
    `;
    await sql`
      INSERT INTO external_identities (source_id, external_id, status, match_method, player_id)
      VALUES (${aflApiSourceId}, ${providerId}, 'unique', 'afl_api_stat_vector_bootstrap', ${player.id})
      ON CONFLICT DO NOTHING
    `;
  }

  const matchResult = await runSettleAflApi(sql, {
    bundle: buildBundle([unitSourceFor(PROVIDER_MATCH_ID, MATCH_DATE)], registry, identities),
    registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
  });
  if (matchResult.halt !== null) throw new Error(`Match-family settle halted: ${JSON.stringify(matchResult.halt)}`);
  if (!matchResult.applied) throw new Error('Match-family settle did not apply.');
  if (matchResult.counters.canonicalApplyFailures !== 0) {
    throw new Error(`Match-family settle had ${matchResult.counters.canonicalApplyFailures} apply failure(s).`);
  }

  const [{ count }] = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM matches WHERE match_key = ${matchKey()}
  `;
  if (count !== '1') throw new Error(`Expected exactly one canonical match after settling, found ${count}.`);
}, 30_000);

afterAll(async () => {
  await cleanup();
  await sql.end({ timeout: 5 });
}, 30_000);

describe('AFLDB-ISSUE-228 §10 follow-up — the completed-season Brownlow backtest authority against afldb_test', () => {
  it('#1 refuses season_not_in_progress without the backtest authority, exactly as default behaviour requires', async () => {
    const result = await runSettleAflApiBrownlow(sql, {
      registry, season: SEASON,
      matchVotes: [voteRecordFor(API_ROUND_NUMBER, VALID_VOTES)],
      leaderboard: [], leaderboardStatus: null,
      inProgressSeasons: [], // simulates a completed season for this run
      apply: true, autoApply: true, observeOnly: false,
      // completedSeasonBacktestAuthority intentionally omitted
    });

    expect(result.halt).toBeNull();
    expect(result.applied).toBe(true);
    expect(result.counters.voteSetsPlanned).toBe(1);
    expect(result.counters.voteSetsRefused).toEqual({});
    expect(result.counters.voteSetsApplyFailed).toBe(1);
    expect(result.counters.canonicalRowsInserted).toBe(0);

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM brownlow_round_votes WHERE source_record_id = ${PROVIDER_MATCH_ID}
    `;
    expect(count).toBe('0');
  });

  it('#2/#3/#4 authorised afldb_test override writes exactly one atomic 3/2/1 set, with its canonical_applications ledger', async () => {
    const result = await runSettleAflApiBrownlow(sql, {
      registry, season: SEASON,
      matchVotes: [voteRecordFor(API_ROUND_NUMBER, VALID_VOTES)],
      leaderboard: [], leaderboardStatus: null,
      inProgressSeasons: [], // still a completed season for this run
      apply: true, autoApply: true, observeOnly: false,
      completedSeasonBacktestAuthority: backtestAuthority,
    });

    expect(result.halt).toBeNull();
    expect(result.applied).toBe(true);
    expect(result.counters.voteSetsRefused).toEqual({});
    expect(result.counters.voteSetsApplyFailed).toBe(0);
    expect(result.counters.voteSetsNoOp).toBe(0);
    expect(result.counters.canonicalRowsInserted).toBe(3);
    expect(result.counters.canonicalRowsUpdated).toBe(0);
    expect(result.counters.canonicalApplicationsLogged).toBe(3);

    const rows = await sql<{ votes: number; played: boolean; roundNumber: number }[]>`
      SELECT votes, played, round_number AS "roundNumber"
        FROM brownlow_round_votes
       WHERE season = ${SEASON} AND source_record_id = ${PROVIDER_MATCH_ID}
       ORDER BY votes DESC
    `;
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.votes)).toEqual([3, 2, 1]);
    for (const row of rows) {
      expect(row.played).toBe(true);
      expect(row.roundNumber).toBe(Number(ROUND_CODE));
    }

    const [ledger] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM canonical_applications
       WHERE target_table = 'brownlow_round_votes' AND external_record_id = ${PROVIDER_MATCH_ID}
    `;
    expect(ledger.count).toBe('3');
  });

  it('#5 an identical replay (still authorised, still a completed season) is a no-op', async () => {
    const result = await runSettleAflApiBrownlow(sql, {
      registry, season: SEASON,
      matchVotes: [voteRecordFor(API_ROUND_NUMBER, VALID_VOTES)],
      leaderboard: [], leaderboardStatus: null,
      inProgressSeasons: [],
      apply: true, autoApply: true, observeOnly: false,
      completedSeasonBacktestAuthority: backtestAuthority,
    });

    expect(result.halt).toBeNull();
    expect(result.applied).toBe(true);
    expect(result.counters.voteSetsApplyFailed).toBe(0);
    expect(result.counters.voteSetsNoOp).toBe(1);
    expect(result.counters.canonicalRowsInserted).toBe(0);
    expect(result.counters.canonicalRowsUpdated).toBe(0);

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM brownlow_round_votes WHERE source_record_id = ${PROVIDER_MATCH_ID}
    `;
    expect(count).toBe('3');
  });

  it('#6 the override does not permit an invalid vote set (duplicate canonical player identity)', async () => {
    const result = await runSettleAflApiBrownlow(sql, {
      registry, season: SEASON,
      matchVotes: [voteRecordFor(API_ROUND_NUMBER, DUPLICATE_IDENTITY_VOTES)],
      leaderboard: [], leaderboardStatus: null,
      inProgressSeasons: [],
      apply: true, autoApply: true, observeOnly: false,
      completedSeasonBacktestAuthority: backtestAuthority,
    });

    expect(result.halt).toBeNull();
    expect(result.counters.voteSetsRefused).toEqual({ duplicate_player_canonical_identity: 1 });
    expect(result.counters.voteSetsPlanned).toBe(0);
    // Unaffected by the prior applied set: still exactly 3 rows (2/3/4/5's).
    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM brownlow_round_votes WHERE source_record_id = ${PROVIDER_MATCH_ID}
    `;
    expect(count).toBe('3');
  });

  it('#7 the override does not permit an unresolved/untrusted identity', async () => {
    const result = await runSettleAflApiBrownlow(sql, {
      registry, season: SEASON,
      matchVotes: [voteRecordFor(API_ROUND_NUMBER, UNTRUSTED_IDENTITY_VOTES)],
      leaderboard: [], leaderboardStatus: null,
      inProgressSeasons: [],
      apply: true, autoApply: true, observeOnly: false,
      completedSeasonBacktestAuthority: backtestAuthority,
    });

    expect(result.halt).toBeNull();
    expect(result.counters.voteSetsRefused).toEqual({ unresolved_identity: 1 });
    expect(result.counters.voteSetsPlanned).toBe(0);
  });

  it('#8 finals remain excluded even with the override active', async () => {
    const result = await runSettleAflApiBrownlow(sql, {
      registry, season: SEASON,
      matchVotes: [voteRecordFor(FINALS_API_ROUND_NUMBER, VALID_VOTES)],
      leaderboard: [], leaderboardStatus: null,
      inProgressSeasons: [],
      apply: true, autoApply: true, observeOnly: false,
      completedSeasonBacktestAuthority: backtestAuthority,
    });

    expect(result.halt).toBeNull();
    expect(result.counters.voteSetsRefused).toEqual({ brownlow_round_not_home_and_away: 1 });
    expect(result.counters.voteSetsPlanned).toBe(0);
    // Still exactly 3 rows from the earlier valid apply — no fourth round landed.
    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM brownlow_round_votes WHERE source_record_id = ${PROVIDER_MATCH_ID}
    `;
    expect(count).toBe('3');
  });
});
