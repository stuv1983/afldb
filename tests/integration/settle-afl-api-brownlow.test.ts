/**
 * AFLDB-ISSUE-228 S7 (§10) — the Brownlow match resolver against real
 * PostgreSQL, closing the DB-shaped gap `tests/afl-api-brownlow.test.ts`
 * names in its own header ("Match/player resolution ... need a real
 * database ... exercised by the operator against the Brownlow simulator and
 * `afldb_test`; nothing here opens a database connection").
 *
 * ROOT CAUSE UNDER TEST (the operator's first real one-match acceptance run,
 * 2026-09-20): `resolveAflApiBrownlowMatch()` (`afl-api-brownlow.ts`) resolves
 * a `bfawards` vote set's `CD_M…` through `staging.afl_api_match` (migration
 * 103) — the match FAMILY's own typed projection — because the Brownlow feed
 * itself carries no home/away/date to render a `match_key` from (module doc
 * comment, `afl-api-brownlow.ts`). That projection is written only when the
 * match-family settle (`settle-afl-api.ts`, driven by
 * `tools/current-season/settle-afl-api.ts --apply`) has already run for the
 * match's season, INSIDE a committed transaction (`--dry-run` rolls the
 * projection back with everything else). The acquired Brownlow bundle alone
 * can never satisfy this — acquiring and settling the match family first is
 * the correct, scalable, already-documented prerequisite (§10: "resolves ...
 * through the ALREADY-PROJECTED staging.afl_api_match row ... written by the
 * match family's own S6 settle"), not a bug in the resolver. This suite makes
 * that dependency executable instead of only prose:
 *
 *   1. `runSettleAflApi()` — the real match-family writer — stages TWO
 *      distinct AFL.com.au matches (proving the mechanism is generic, not
 *      hardcoded to the operator's one acceptance-test provider id).
 *   2. `runSettleAflApiBrownlow()` — the real Brownlow writer, `apply: false`
 *      (a full dry run; nothing it does needs cleanup) — resolves a vote set
 *      for each staged match to `voteSetsPlanned`/`voteSetsWouldAutoApply`,
 *      exactly the operator's target state, and still refuses
 *      (`unknown_match`) a vote set naming a THIRD, never-staged match.
 *   3. `runSettleAflApiBrownlow()` again, this time `apply: true, autoApply:
 *      true` against the match staged in (1) — the canonical write path
 *      itself (`applyAflApiBrownlowVoteSet()` / `writeBrownlowRoundVotes()`),
 *      which (1) and (2) never reach. Added 2026-09-20 after the operator's
 *      real one-match auto-apply run deterministically rolled its whole vote
 *      set back: root cause was `canonical-apply.ts`'s E2 season-in-progress
 *      gate correctly refusing a completed season (2025, not in
 *      `data/reference/seasons.json`'s `in_progress_seasons`) that a backtest
 *      ran through the same live-count path — not a defect in this writer,
 *      but a genuine gap in what this suite exercised: nothing here had ever
 *      driven a real 3/2/1 canonical insert or its idempotent replay.
 *
 * ISOLATION MODEL — COMMITTED FIXTURES for the match-family half, exactly as
 * `tests/integration/settle-afl-api.test.ts` established (that writer opens
 * its own transaction, so the outer-rollback pattern cannot wrap it), AND for
 * the one Brownlow case above that runs `apply: true` — `cleanup()` removes
 * its `brownlow_round_votes` rows and its own `import_batches` row
 * (identified by tool name, since its notes carry no NS-scoped text) in
 * addition to the match-family cleanup. Every other Brownlow case stays
 * `apply: false`, rolls its whole transaction back including spine
 * observations (`runSettleAflApiBrownlow`'s own module doc), and needs no
 * cleanup of its own.
 *
 * `clubs` (Hawthorn, Brisbane Lions) are READ, never written, same as the
 * sibling suite. `players`/`external_identities` rows for the three
 * synthetic Brownlow "voters" are committed and cleaned up here; they are
 * independent of (and never collide with) the sibling suite's own bridged
 * player, which is a match-roster identity, not a vote-set one.
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
  applyAflApiBrownlowVoteSet, planAflApiBrownlowMatchSet, runSettleAflApiBrownlow, SETTLE_BATCH_TOOL,
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
import { asImportBatchId } from '@/lib/import-batch-id';

const PROJECT_ROOT = join(__dirname, '..', '..');
const FIXTURE_DIR = join(PROJECT_ROOT, 'tests', 'fixtures', 'afl_api', 'match');

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8'));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** This suite's own namespace. Appears nowhere else in the repository. */
const NS = 'CD_M2026I228BRN';
const SEASON = 2026;
const HOME_HIST = 'Hawthorn';
const AWAY_HIST = 'Brisbane Lions';

/**
 * `api_round_number: 5` in `data/reference/source-families.json`'s
 * `afl_api_2026` vocabulary is `{ api_abbreviation: 'Rd 5', round_type:
 * 'home_and_away', canonical_round_number: 6 }` — an ordinary, non-final
 * round (unlike the sibling suite's Preliminary Final fixture, which Brownlow
 * would correctly and separately refuse as `brownlow_final_match_excluded`).
 * `roundCode` for a home-and-away row is `String(canonical_round_number)`
 * (`translateAflRound`, `afl-api-rounds.ts`), i.e. `'6'`.
 */
const API_ROUND_NUMBER = 5;
const ROUND_CODE = '6';

const CASE_IDS = { p: `${NS}P`, q: `${NS}Q`, unknown: `${NS}UNKNOWN` } as const;
const CASE_DATES: Readonly<Record<string, string>> = {
  [CASE_IDS.p]: '2026-09-24',
  [CASE_IDS.q]: '2026-09-25',
};

/**
 * Three synthetic Brownlow "voters", shared across both staged matches —
 * realistic (the same player votes in more than one match across a season)
 * and sufficient, since this suite never applies a canonical write (`apply:
 * false` throughout the Brownlow half), so no `brownlow_round_votes` UNIQUE
 * (season, player_id, round_number) constraint is ever reached.
 */
const VOTER_PROVIDER_IDS = ['CD_I228BRN01', 'CD_I228BRN02', 'CD_I228BRN03'] as const;
const VOTER_LEGACY_IDS = [-228300001, -228300002, -228300003] as const;

function unitSourceFor(providerMatchId: string, matchDate: string): AflApiSettleUnitSource {
  const fixture = clone(readFixture('01-fixture-result.json')) as Record<string, any>;
  const roster = clone(readFixture('03-match-roster.raw.json')) as Record<string, any>;
  const stats = clone(readFixture('02-player-stats.raw.json')) as Record<string, any>;

  fixture.providerId = providerMatchId;
  fixture.utcStartTime = `${matchDate}T07:15:00.000+0000`;
  // Preliminary Final -> an ordinary home-and-away round (see API_ROUND_NUMBER above).
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
    season: SEASON, snapshotLabel: 'issue228-brownlow-integration', sources, registry, identities,
  });
  expect(bundle.buildFailures).toEqual([]);
  return bundle;
}

function voteRecordFor(providerMatchId: string): AflApiBrownlowMatchVoteRecord {
  return {
    providerMatchId,
    apiRoundNumber: API_ROUND_NUMBER,
    votes: [
      { providerPlayerId: VOTER_PROVIDER_IDS[0], providerTeamId: 'CD_T80', votes: 3, eligible: true },
      { providerPlayerId: VOTER_PROVIDER_IDS[1], providerTeamId: 'CD_T20', votes: 2, eligible: true },
      { providerPlayerId: VOTER_PROVIDER_IDS[2], providerTeamId: 'CD_T80', votes: 1, eligible: true },
    ],
  };
}

const sql = postgres(process.env.AFLDB_TEST_DATABASE_URL as string, { max: 1, onnotice: () => {} });

let registry: SourceFamilyRegistry;
let identities: AflApiIdentities;
let aflApiSourceId: number;
let homeClubName: string;
let awayClubName: string;

function matchKeyFor(providerMatchId: string): string {
  const date = CASE_DATES[providerMatchId];
  if (!date) throw new Error(`No CASE_DATES entry for provider match id '${providerMatchId}'.`);
  if (!homeClubName || !awayClubName) {
    throw new Error('matchKeyFor() was called before beforeAll() resolved the canonical club names.');
  }
  return renderMatchKey(SEASON, ROUND_CODE, date, homeClubName, awayClubName);
}

function allMatchKeys(): string[] {
  return [CASE_IDS.p, CASE_IDS.q].map((id) => matchKeyFor(id));
}

/** Removes every row this suite's match-family half can create, and nothing else. */
async function cleanup(): Promise<void> {
  const matchKeys = allMatchKeys();
  const matchIds = await sql<{ id: number }[]>`
    SELECT id FROM matches WHERE match_key = ANY(${matchKeys}::text[])
  `;
  const ids = matchIds.map((r) => r.id);

  // `player_clubs.first_match_id`/`last_match_id REFERENCES matches(id)` carry
  // NO `ON DELETE` clause (migration 007:135-136, default RESTRICT).
  // `runSettleAflApi({ autoApply: true })` in the first `it()` below calls
  // `recomputePlayerDerivedStats()` for every player whose roster stats it
  // wrote to these two synthetic matches — this suite's fixture
  // (`03-match-roster.raw.json`, shared with
  // `tests/integration/settle-afl-api.test.ts`) resolves `CD_I297354` through
  // whatever `afl_api` bridge row for it already exists on afldb_test, which
  // this suite neither creates nor owns. That recompute can leave that
  // player's `player_clubs` row pointing at one of THIS suite's match ids, and
  // `DELETE FROM matches` below then fails closed with exactly the
  // foreign-key violation `settle-afl-api.test.ts:266-276` already documents
  // for its own (self-owned, self-deleted) synthetic player.
  //
  // Unlike that sibling, this suite does not own or delete whoever resolves
  // here, so blindly deleting their `player_clubs` row is not safe — it may be
  // a real player's real career summary. Instead, re-run the same targeted
  // recompute `runSettleAflApi`/`settle-afltables.ts` use in production
  // (`recomputePlayerDerivedStats`, `src/db/queries/player-derived.ts`) for
  // whoever this suite's matches actually touched, once their
  // `player_match_stats` rows are gone (below) and before `matches` is
  // deleted. It rebuilds `player_clubs`/`player_club_season_stats`/
  // `player_season_stats`/`player_career_stats` for those players from
  // whatever `player_match_stats` rows genuinely remain — restoring exact
  // pre-test state for a real player, and correctly leaving no row at all for
  // one whose only stats were this suite's own. `affectedPlayerIds()`
  // (`settle-core.ts`) is the same helper `runSettleAflApi` itself calls to
  // find them, read here before the DELETE below removes the rows it queries.
  const derivedScope: DerivedScope = { playerIds: new Set(), matchIds: new Set(ids) };
  const liveStatsPlayerIds = ids.length > 0
    ? await sql.begin((tx) => affectedPlayerIds(tx, derivedScope))
    : [];

  // A previous run of this same cleanup() can die between the
  // `player_match_stats` DELETE below and the recompute that follows it,
  // leaving `player_clubs.first_match_id`/`last_match_id` still pointing at
  // one of this suite's match ids with no surviving `player_match_stats` row
  // left for `affectedPlayerIds()` to rediscover the player from (it derives
  // its set purely from CURRENT `player_match_stats` rows for these match
  // ids). Without this, the next run's `touchedPlayerIds` above would come
  // back empty for that player, the recompute below would skip them, and
  // `DELETE FROM matches` would fail closed on the exact FK violation this
  // scenario produces. SELECT-only discovery of the stale pointer itself —
  // never a write — folded into the same recompute scope below, so whether
  // genuine remaining stats exist for the player (real history restored) or
  // none at all (the row correctly dropped) is `recomputePlayerDerivedStats()`'s
  // call, not this cleanup's.
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
  // The canonical write path's own target — never reached before this suite
  // exercised `apply: true, autoApply: true` (see the new `it()` below), so
  // no prior version of this cleanup ever needed this line.
  await sql`DELETE FROM brownlow_round_votes WHERE source_record_id LIKE ${`${NS}%`}`;
  // AFLDB-ISSUE-228 S7 typed-projection closure: projectAflApiBrownlowVoteSet()
  // now writes staging.afl_api_brownlow_vote for every planned set (previously
  // never written, so no prior version of this cleanup needed this line).
  // Must run BEFORE the `matches` DELETE below — its `match_id` column
  // REFERENCES matches(id) with no ON DELETE clause.
  await sql`DELETE FROM staging.afl_api_brownlow_vote WHERE provider_match_id LIKE ${`${NS}%`}`;
  if (ids.length > 0) await sql`DELETE FROM matches WHERE id = ANY(${ids}::bigint[])`;

  await sql`DELETE FROM staging.afl_api_player_match WHERE provider_match_id LIKE ${`${NS}%`}`;
  await sql`DELETE FROM staging.afl_api_match WHERE external_record_id LIKE ${`${NS}%`}`;

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
  await sql`DELETE FROM import_batches WHERE notes LIKE ${'%issue228-brownlow-integration%'}`;
  // The Brownlow settle's own batches (`apply: true` in the canonical-write
  // test below) carry no NS-scoped text in their notes — only `runSettleAflApi`'s
  // bundle snapshotLabel does — so they need their own filter. This tool name
  // commits a batch only from that one test in this suite (every other
  // `runSettleAflApiBrownlow()` call here and in the sibling fixtures suite is
  // `apply: false`, which rolls its own batch insert back), so scoping by tool
  // and season is unambiguous on afldb_test.
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

  await cleanup();

  for (let i = 0; i < VOTER_PROVIDER_IDS.length; i += 1) {
    const legacyId = VOTER_LEGACY_IDS[i];
    const providerId = VOTER_PROVIDER_IDS[i];
    const [player] = await sql<{ id: number }[]>`
      INSERT INTO players (legacy_player_id, display_name, sort_name, search_name, slug, given_name, surname)
      VALUES (
        ${legacyId},
        ${`Voter ${i + 1} (ISSUE-228 Brownlow test fixture)`},
        ${`Voter${i + 1} (ISSUE-228 Brownlow test fixture)`},
        ${`voter ${i + 1} issue228 brownlow test fixture`},
        ${`voter-${i + 1}-issue228-brownlow-test-fixture`},
        'Voter', ${`Issue228BrownlowTest${i + 1}`}
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
}, 30_000);

afterAll(async () => {
  await cleanup();
  await sql.end({ timeout: 5 });
}, 30_000);

describe('AFLDB-ISSUE-228 S7 — Brownlow match resolution against afldb_test', () => {
  it(
    'resolves and plans vote sets for TWO distinct matches once the match family has staged them '
      + '(the operator\'s unknown_match -> voteSetsPlanned/voteSetsWouldAutoApply target), and creates no duplicate canonical match',
    async () => {
      for (const id of [CASE_IDS.p, CASE_IDS.q]) {
        const matchResult = await runSettleAflApi(sql, {
          bundle: buildBundle([unitSourceFor(id, CASE_DATES[id])], registry, identities),
          registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
        });
        expect(matchResult.halt).toBeNull();
        expect(matchResult.applied).toBe(true);
        expect(matchResult.counters.canonicalApplyFailures).toBe(0);
        expect(matchResult.counters.canonicalRowsInserted).toBeGreaterThan(0);

        const [{ count }] = await sql<{ count: string }[]>`
          SELECT count(*)::text AS count FROM matches WHERE match_key = ${matchKeyFor(id)}
        `;
        expect(count).toBe('1'); // exactly one canonical row exists once the match family has settled it
      }

      // Brownlow settle, exactly as the operator's acceptance run drove it:
      // observe-only, apply: false — a full dry run that persists nothing
      // (runSettleAflApiBrownlow rolls its whole transaction back without
      // `--apply`), so this half needs no cleanup of its own.
      const brownlowResult = await runSettleAflApiBrownlow(sql, {
        registry, season: SEASON,
        matchVotes: [voteRecordFor(CASE_IDS.p), voteRecordFor(CASE_IDS.q)],
        leaderboard: [], leaderboardStatus: null, inProgressSeasons: [SEASON],
        apply: false, autoApply: false, observeOnly: true,
      });

      expect(brownlowResult.halt).toBeNull();
      expect(brownlowResult.counters.voteSetsRefused).toEqual({});
      expect(brownlowResult.counters.voteSetsPlanned).toBe(2);
      expect(brownlowResult.counters.voteSetsWouldAutoApply).toBe(2);

      // No duplicate canonical match was created by the Brownlow settle
      // itself (§10: "it never touches matches/player_match_stats") —
      // still exactly one row per match after it ran.
      for (const id of [CASE_IDS.p, CASE_IDS.q]) {
        const [{ count }] = await sql<{ count: string }[]>`
          SELECT count(*)::text AS count FROM matches WHERE match_key = ${matchKeyFor(id)}
        `;
        expect(count).toBe('1');
      }
    },
    30_000,
  );

  it(
    'auto-applies a complete 3/2/1 vote set to brownlow_round_votes atomically, and a replay is a no-op '
      + '(the canonical write path itself — every prior case in this suite ran `observe-only`/`apply: false` '
      + 'and never reached applyAflApiBrownlowVoteSet at all)',
    async () => {
      const applyResult = await runSettleAflApiBrownlow(sql, {
        registry, season: SEASON,
        matchVotes: [voteRecordFor(CASE_IDS.p)],
        leaderboard: [], leaderboardStatus: null, inProgressSeasons: [SEASON],
        apply: true, autoApply: true, observeOnly: false,
      });

      expect(applyResult.halt).toBeNull();
      expect(applyResult.applied).toBe(true);
      expect(applyResult.counters.voteSetsRefused).toEqual({});
      expect(applyResult.counters.voteSetsApplyFailed).toBe(0);
      expect(applyResult.counters.voteSetsNoOp).toBe(0);
      expect(applyResult.counters.canonicalRowsInserted).toBe(3);
      expect(applyResult.counters.canonicalRowsUpdated).toBe(0);
      expect(applyResult.counters.canonicalApplicationsLogged).toBe(3);

      const rows = await sql<
        { playerId: number; votes: number; played: boolean; roundNumber: number; matchId: number | null }[]
      >`
        SELECT player_id AS "playerId", votes, played, round_number AS "roundNumber", match_id AS "matchId"
          FROM brownlow_round_votes
         WHERE season = ${SEASON} AND source_record_id = ${CASE_IDS.p}
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
         WHERE target_table = 'brownlow_round_votes' AND external_record_id = ${CASE_IDS.p}
      `;
      expect(ledger.count).toBe('3');

      // AFLDB-ISSUE-228 S7 typed-projection closure (test A/D): the typed
      // projection is populated for this set, with real resolved identity,
      // and its `votes` values are exactly what landed in the canonical rows
      // above — the canonical write reads its proposed value back from this
      // very table (`unitInputFor()`'s `projectedVotes` parameter), so a
      // divergence here would mean the canonical rows above are wrong too.
      const projectionRows = await sql<
        { providerPlayerId: string; votes: number; matchId: number | null; playerId: number | null; clubId: number | null; canonicalRoundNumber: number }[]
      >`
        SELECT provider_player_id AS "providerPlayerId", votes,
               match_id AS "matchId", player_id AS "playerId", club_id AS "clubId",
               canonical_round_number AS "canonicalRoundNumber"
          FROM staging.afl_api_brownlow_vote
         WHERE provider_match_id = ${CASE_IDS.p}
         ORDER BY votes DESC
      `;
      expect(projectionRows).toHaveLength(3);
      expect(projectionRows.map((r) => r.votes)).toEqual([3, 2, 1]);
      expect(projectionRows.map((r) => r.providerPlayerId)).toEqual([...VOTER_PROVIDER_IDS]);
      for (const row of projectionRows) {
        expect(row.matchId).not.toBeNull();
        expect(row.playerId).not.toBeNull();
        // club_id is a disclosed scope cut (§10 Option B explicitly allows
        // it NULL): no provider-team-to-club resolution exists in this
        // settle engine.
        expect(row.clubId).toBeNull();
        expect(row.canonicalRoundNumber).toBe(Number(ROUND_CODE));
      }

      // Replay the identical vote set. Every target's freshly-read row now
      // already carries the proposed values, so E5's baseline still matches
      // and the diff is empty on all three — `nothing_to_write`, not a
      // constraint conflict, and never a second row.
      const replayResult = await runSettleAflApiBrownlow(sql, {
        registry, season: SEASON,
        matchVotes: [voteRecordFor(CASE_IDS.p)],
        leaderboard: [], leaderboardStatus: null, inProgressSeasons: [SEASON],
        apply: true, autoApply: true, observeOnly: false,
      });

      expect(replayResult.halt).toBeNull();
      expect(replayResult.applied).toBe(true);
      expect(replayResult.counters.voteSetsApplyFailed).toBe(0);
      expect(replayResult.counters.voteSetsNoOp).toBe(1);
      expect(replayResult.counters.canonicalRowsInserted).toBe(0);
      expect(replayResult.counters.canonicalRowsUpdated).toBe(0);

      const [afterReplay] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM brownlow_round_votes
         WHERE season = ${SEASON} AND source_record_id = ${CASE_IDS.p}
      `;
      expect(afterReplay.count).toBe('3');

      // (test B) the replay's identical payload never duplicates the
      // projection row either — same PK, ON CONFLICT DO UPDATE, still
      // exactly one row per voter.
      const [{ count: projectionCountAfterReplay }] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM staging.afl_api_brownlow_vote
         WHERE provider_match_id = ${CASE_IDS.p}
      `;
      expect(projectionCountAfterReplay).toBe('3');

      // (test C) a genuine correction — the top vote-getter's tally changes
      // upstream — creates a new spine version, updates the projection row
      // in place (same PK, still 3 rows) AND the canonical row atomically,
      // through the identical write path (never a special-cased branch).
      const correctedRecord = voteRecordFor(CASE_IDS.p);
      correctedRecord.votes = correctedRecord.votes.map((v) => (
        v.providerPlayerId === VOTER_PROVIDER_IDS[0] ? { ...v, votes: 2 } : v
      ));
      correctedRecord.votes = correctedRecord.votes.map((v) => (
        v.providerPlayerId === VOTER_PROVIDER_IDS[1] ? { ...v, votes: 3 } : v
      ));

      const correctionResult = await runSettleAflApiBrownlow(sql, {
        registry, season: SEASON,
        matchVotes: [correctedRecord],
        leaderboard: [], leaderboardStatus: null, inProgressSeasons: [SEASON],
        apply: true, autoApply: true, observeOnly: false,
      });

      expect(correctionResult.halt).toBeNull();
      expect(correctionResult.applied).toBe(true);
      expect(correctionResult.counters.voteSetsApplyFailed).toBe(0);
      expect(correctionResult.counters.canonicalRowsUpdated).toBe(2);

      const projectionAfterCorrection = await sql<{ providerPlayerId: string; votes: number }[]>`
        SELECT provider_player_id AS "providerPlayerId", votes
          FROM staging.afl_api_brownlow_vote
         WHERE provider_match_id = ${CASE_IDS.p}
         ORDER BY provider_player_id
      `;
      expect(projectionAfterCorrection).toHaveLength(3);
      expect(projectionAfterCorrection.find((r) => r.providerPlayerId === VOTER_PROVIDER_IDS[0])?.votes).toBe(2);
      expect(projectionAfterCorrection.find((r) => r.providerPlayerId === VOTER_PROVIDER_IDS[1])?.votes).toBe(3);

      const canonicalAfterCorrection = await sql<{ playerId: number; votes: number }[]>`
        SELECT player_id AS "playerId", votes FROM brownlow_round_votes
         WHERE season = ${SEASON} AND source_record_id = ${CASE_IDS.p}
      `;
      expect(canonicalAfterCorrection).toHaveLength(3);
      expect(canonicalAfterCorrection.map((r) => r.votes).sort((a, b) => b - a)).toEqual([3, 2, 1]);
    },
    30_000,
  );

  it(
    'refuses whole-set canonical promotion when a required staging.afl_api_brownlow_vote row is unavailable — '
      + 'never falling back to the in-memory vote payload for the missing row, and never partially promoting the '
      + 'other two (AFLDB-ISSUE-228 S7 typed-projection closure, match q, untouched by the p-only cases above)',
    async () => {
      const record = voteRecordFor(CASE_IDS.q);

      // Reach the point where the set's three typed projection rows exist,
      // WITHOUT yet attempting a canonical write: apply: true (commits the
      // batch/spine/projection), autoApply: false (never calls
      // applyAflApiBrownlowVoteSet).
      const projectResult = await runSettleAflApiBrownlow(sql, {
        registry, season: SEASON,
        matchVotes: [record],
        leaderboard: [], leaderboardStatus: null, inProgressSeasons: [SEASON],
        apply: true, autoApply: false, observeOnly: false,
      });
      expect(projectResult.halt).toBeNull();
      expect(projectResult.applied).toBe(true);
      expect(projectResult.counters.voteSetsRefused).toEqual({});
      expect(projectResult.counters.voteSetsPlanned).toBe(1);
      expect(projectResult.counters.voteSetsWouldAutoApply).toBe(1);
      if (!projectResult.batchId) throw new Error('Expected a committed batch id from the apply:true projection run.');
      const batchId = asImportBatchId(projectResult.batchId);

      const beforeProjection = await sql<{ providerPlayerId: string; votes: number }[]>`
        SELECT provider_player_id AS "providerPlayerId", votes
          FROM staging.afl_api_brownlow_vote
         WHERE provider_match_id = ${CASE_IDS.q}
         ORDER BY provider_player_id
      `;
      expect(beforeProjection).toHaveLength(3); // the three typed projection rows now exist

      const [sourceRecordBefore] = await sql<{ versionSeq: number }[]>`
        SELECT current_version_seq AS "versionSeq" FROM staging.source_records
         WHERE source_id = ${aflApiSourceId} AND family = 'brownlow_match_votes'
           AND external_record_id = ${CASE_IDS.q}
      `;
      if (!sourceRecordBefore) throw new Error('Expected a staging.source_records head for the projected vote set.');
      const [{ count: versionsBefore }] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM staging.source_record_versions
         WHERE source_id = ${aflApiSourceId} AND external_record_id = ${CASE_IDS.q}
      `;

      // Make exactly ONE required row unavailable — the middle voter's typed
      // projection row — before canonical apply ever consumes it.
      const missingProviderPlayerId = VOTER_PROVIDER_IDS[1];
      await sql`
        DELETE FROM staging.afl_api_brownlow_vote
         WHERE provider_match_id = ${CASE_IDS.q} AND provider_player_id = ${missingProviderPlayerId}
      `;
      const afterDelete = await sql<{ providerPlayerId: string; votes: number }[]>`
        SELECT provider_player_id AS "providerPlayerId", votes
          FROM staging.afl_api_brownlow_vote
         WHERE provider_match_id = ${CASE_IDS.q}
         ORDER BY provider_player_id
      `;
      expect(afterDelete).toHaveLength(2);
      const projectedVotes = new Map(afterDelete.map((row) => [row.providerPlayerId, row.votes]));

      // The set's full 3-unit plan, independently re-resolved through the
      // SAME seam `runSettleAflApiBrownlow` itself uses — proving the failure
      // below is caused by the missing projection row reaching
      // applyAflApiBrownlowVoteSet, never by an incomplete unit list.
      const plan = await sql.begin((tx) => planAflApiBrownlowMatchSet(tx, aflApiSourceId, registry, record));
      if (plan.status !== 'planned') throw new Error(`Expected the vote set to still resolve as planned; got: ${plan.status}`);
      expect(plan.units).toHaveLength(3);

      const sources = await sql<{ id: number; key: string }[]>`SELECT id, key FROM sources`;
      const sourceKeysById = new Map(sources.map((row) => [row.id, row.key]));

      // Exercise the canonical apply path directly with a projection map one
      // entry short of the plan's three units.
      const outcome = await sql.begin((tx) => applyAflApiBrownlowVoteSet(tx, {
        sourceId: aflApiSourceId, sourceKeysById, batchId,
        inProgressSeasons: [SEASON], providerMatchId: CASE_IDS.q, sourceVersionSeq: sourceRecordBefore.versionSeq,
        season: plan.season, canonicalRoundNumber: plan.canonicalRoundNumber, units: plan.units,
        projectedVotes,
      }));

      // 1. the operation refuses rather than continuing
      expect(outcome.status).toBe('failed');
      if (outcome.status !== 'failed') throw new Error('unreachable — asserted above');
      // 6. the failure clearly identifies the missing typed projection state
      expect(outcome.reason).toContain('staging.afl_api_brownlow_vote carries no projected row');
      expect(outcome.reason).toContain(missingProviderPlayerId);
      expect(outcome.reason).toContain(CASE_IDS.q);

      // 2. ZERO canonical brownlow_round_votes rows from this vote set exist —
      // including the first unit (3 votes), whose own projection row was
      // still present and would otherwise have written cleanly: the
      // savepoint rollback undoes it too once the second unit's missing
      // projection throws (§10/§14 whole-set atomicity).
      const [{ count: canonicalCount }] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM brownlow_round_votes
         WHERE season = ${SEASON} AND source_record_id = ${CASE_IDS.q}
      `;
      expect(canonicalCount).toBe('0');

      // 3. no canonical_applications ledger row exists either — the other two
      // surviving projection rows did not promote partially.
      const [{ count: ledgerCount }] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM canonical_applications
         WHERE target_table = 'brownlow_round_votes' AND external_record_id = ${CASE_IDS.q}
      `;
      expect(ledgerCount).toBe('0');

      // 4. the source observation/version evidence is unchanged —
      // applyAflApiBrownlowVoteSet never touches the spine.
      const [sourceRecordAfter] = await sql<{ versionSeq: number }[]>`
        SELECT current_version_seq AS "versionSeq" FROM staging.source_records
         WHERE source_id = ${aflApiSourceId} AND family = 'brownlow_match_votes'
           AND external_record_id = ${CASE_IDS.q}
      `;
      expect(sourceRecordAfter?.versionSeq).toBe(sourceRecordBefore.versionSeq);
      const [{ count: versionsAfter }] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM staging.source_record_versions
         WHERE source_id = ${aflApiSourceId} AND external_record_id = ${CASE_IDS.q}
      `;
      expect(versionsAfter).toBe(versionsBefore);

      // 5. no raw-payload fallback reconstructed the missing vote: the
      // deleted row is still absent, and the two surviving rows are
      // byte-identical to their state immediately after the delete.
      const afterApply = await sql<{ providerPlayerId: string; votes: number }[]>`
        SELECT provider_player_id AS "providerPlayerId", votes
          FROM staging.afl_api_brownlow_vote
         WHERE provider_match_id = ${CASE_IDS.q}
         ORDER BY provider_player_id
      `;
      expect(afterApply).toEqual(afterDelete);
      expect(afterApply.find((r) => r.providerPlayerId === missingProviderPlayerId)).toBeUndefined();
    },
    30_000,
  );

  it('refuses a genuinely unknown provider match id (unknown_match) — never inferring one, never a run-level HALT', async () => {
    const result = await runSettleAflApiBrownlow(sql, {
      registry, season: SEASON,
      matchVotes: [voteRecordFor(CASE_IDS.unknown)],
      leaderboard: [], leaderboardStatus: null, inProgressSeasons: [SEASON],
      apply: false, autoApply: false, observeOnly: true,
    });

    expect(result.halt).toBeNull();
    expect(result.counters.voteSetsRefused).toEqual({ unknown_match: 1 });
    expect(result.counters.voteSetsPlanned).toBe(0);
    expect(result.counters.voteSetsWouldAutoApply).toBe(0);
  });

  it(
    'cleanup() self-heals a stale player_clubs pointer left by a crashed prior teardown '
      + '(one that deleted player_match_stats but never reached the recompute/DELETE FROM matches that follows '
      + 'it — the exact partial state a reported failed run left behind). Runs last: it deletes matches p and q '
      + 'outright, which every test above this one depends on existing.',
    async () => {
      const matchKeys = allMatchKeys();
      const matchRows = await sql<{ id: number }[]>`
        SELECT id FROM matches WHERE match_key = ANY(${matchKeys}::text[])
      `;
      const ids = matchRows.map((r) => r.id);
      expect(ids.length).toBe(2); // both matches p and q must still exist at this point in the suite

      // `runSettleAflApi({ autoApply: true })` in the first `it()` above
      // already recomputed `player_clubs` for whoever `CD_I297354` resolves
      // to on afldb_test right now (cleanup()'s own doc comment above),
      // pointing at least one real player's `first_match_id`/`last_match_id`
      // at one of these two matches. Confirm that precondition holds before
      // simulating the crash.
      const beforeStale = await sql<{ playerId: number }[]>`
        SELECT DISTINCT player_id::int AS "playerId" FROM player_clubs
         WHERE first_match_id = ANY(${ids}::bigint[]) OR last_match_id = ANY(${ids}::bigint[])
      `;
      expect(beforeStale.length).toBeGreaterThan(0);

      // Simulate exactly the reported crash: delete the match-owned
      // `player_match_stats`/`match_period_scores` rows WITHOUT recomputing
      // `player_clubs` afterwards, leaving its pointer(s) dangling with no
      // backing stats row left to rediscover the player from.
      await sql`DELETE FROM player_match_stats WHERE match_id = ANY(${ids}::bigint[])`;
      await sql`DELETE FROM match_period_scores WHERE match_id = ANY(${ids}::bigint[])`;

      const stillStale = await sql<{ playerId: number }[]>`
        SELECT DISTINCT player_id::int AS "playerId" FROM player_clubs
         WHERE first_match_id = ANY(${ids}::bigint[]) OR last_match_id = ANY(${ids}::bigint[])
      `;
      expect(stillStale.map((r) => r.playerId).sort((a, b) => a - b))
        .toEqual(beforeStale.map((r) => r.playerId).sort((a, b) => a - b));

      // The real cleanup() under test — this suite's own teardown, not a
      // hand-rolled repair — must recover from this state and remove both
      // matches without a foreign-key violation.
      await expect(cleanup()).resolves.toBeUndefined();

      const [{ count: matchesLeft }] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM matches WHERE id = ANY(${ids}::bigint[])
      `;
      expect(matchesLeft).toBe('0');

      const [{ count: staleLeft }] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM player_clubs
         WHERE first_match_id = ANY(${ids}::bigint[]) OR last_match_id = ANY(${ids}::bigint[])
      `;
      expect(staleLeft).toBe('0');
    },
    30_000,
  );
});
