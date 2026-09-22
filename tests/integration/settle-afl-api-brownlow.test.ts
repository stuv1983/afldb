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
  SETTLE_ISSUE_TYPE,
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
import { recomputeBrownlowCoverage, recomputePlayerDerivedStats } from '@/db/queries/player-derived';
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
 * AFLDB-ISSUE-244 I244-F030 fixture compatibility. Match q is created through the SAME normal AFL API
 * settle as p, and the F030 ambiguity guard (`possible_existing_match`) refuses to INSERT a fixture
 * whose season and oriented clubs match an existing one and that differs from it by the date alone.
 * p and q share season and clubs, so q must ALSO differ by round to remain a legitimate new target
 * (round + date = ambiguity budget 2). `afl_api_2026`: API round 5 -> canonical '6' (p),
 * API round 6 -> canonical '7' (q). q is not seeded directly — it must keep the normal
 * `staging.afl_api_match` projection the Brownlow vote-set resolution depends on.
 *
 * The one per-case source of truth for the round a provider match id carries. `API_ROUND_NUMBER`,
 * `ROUND_CODE` and `BROWNLOW_ROUND` keep describing p (the case every F002/F007 assertion drives).
 * An id with no entry (the deliberately unknown provider match) falls back to p's round.
 */
const CASE_ROUNDS: Readonly<Record<string, { apiRoundNumber: number; roundCode: string }>> = {
  [CASE_IDS.p]: { apiRoundNumber: API_ROUND_NUMBER, roundCode: ROUND_CODE },
  [CASE_IDS.q]: { apiRoundNumber: 6, roundCode: '7' },
};

function roundFor(providerMatchId: string): { apiRoundNumber: number; roundCode: string } {
  return CASE_ROUNDS[providerMatchId] ?? CASE_ROUNDS[CASE_IDS.p];
}

/**
 * Three synthetic Brownlow "voters", shared across both staged matches —
 * realistic (the same player votes in more than one match across a season)
 * and sufficient, since this suite never applies a canonical write (`apply:
 * false` throughout the Brownlow half), so no `brownlow_round_votes` UNIQUE
 * (season, player_id, round_number) constraint is ever reached.
 */
const VOTER_PROVIDER_IDS = [
  'CD_I228BRN01', 'CD_I228BRN02', 'CD_I228BRN03',
  // AFLDB-ISSUE-244 I244-F002: voters D, E and F. The first three (A, B, C)
  // are the original 3/2/1 recipients; D replaces C in the recipient-swap
  // cases, E carries another match's row and F a foreign-owned one.
  'CD_I228BRN04', 'CD_I228BRN05', 'CD_I228BRN06',
] as const;
const VOTER_LEGACY_IDS = [-228300001, -228300002, -228300003, -228300004, -228300005, -228300006] as const;
/**
 * AFLDB-ISSUE-244 I244-F002 harness repair: the dedicated, suite-owned synthetic
 * player the `cleanup()` self-heal regression (last `it()` below) builds its own
 * stale `player_clubs` pointer on. It is deliberately NOT a Brownlow voter, has
 * no `external_identities` bridge row, and is never reachable from the AFL API
 * fixtures, so that regression depends on no player or bridge row that already
 * exists on afldb_test. `cleanup()` deletes it with the voters.
 */
const CLEANUP_REGRESSION_LEGACY_ID = -228300007;
/** Every `players.legacy_player_id` this suite creates and `cleanup()` must remove. */
const SUITE_PLAYER_LEGACY_IDS = [...VOTER_LEGACY_IDS, CLEANUP_REGRESSION_LEGACY_ID] as const;
/** Index into VOTER_PROVIDER_IDS / `voterPlayerIds` for the I244-F002 cases. */
const VA = 0; const VB = 1; const VC = 2; const VD = 3; const VE = 4; const VF = 5;
const VOTER_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

function unitSourceFor(providerMatchId: string, matchDate: string): AflApiSettleUnitSource {
  const fixture = clone(readFixture('01-fixture-result.json')) as Record<string, any>;
  const roster = clone(readFixture('03-match-roster.raw.json')) as Record<string, any>;
  const stats = clone(readFixture('02-player-stats.raw.json')) as Record<string, any>;

  fixture.providerId = providerMatchId;
  fixture.utcStartTime = `${matchDate}T07:15:00.000+0000`;
  // Preliminary Final -> an ordinary home-and-away round (see API_ROUND_NUMBER / CASE_ROUNDS above).
  const { apiRoundNumber } = roundFor(providerMatchId);
  fixture.round = {
    ...fixture.round, roundNumber: apiRoundNumber, abbreviation: `Rd ${apiRoundNumber}`, name: `Round ${apiRoundNumber}`,
  };
  roster.match.matchId = providerMatchId;
  roster.match.venueLocalStartTime = `${matchDate}T17:15:00`;
  roster.matchRoster.matchId = providerMatchId;
  roster.matchRoster.roundNumber = apiRoundNumber;
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
    apiRoundNumber: roundFor(providerMatchId).apiRoundNumber,
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
let aflTablesSourceId: number;
/** `players.id` of each voter, index-aligned with VOTER_PROVIDER_IDS. */
const voterPlayerIds: number[] = [];
let homeClubId: number;
let homeClubName: string;
let awayClubName: string;

function matchKeyFor(providerMatchId: string): string {
  const date = CASE_DATES[providerMatchId];
  if (!date) throw new Error(`No CASE_DATES entry for provider match id '${providerMatchId}'.`);
  if (!homeClubName || !awayClubName) {
    throw new Error('matchKeyFor() was called before beforeAll() resolved the canonical club names.');
  }
  return renderMatchKey(SEASON, roundFor(providerMatchId).roundCode, date, homeClubName, awayClubName);
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

  // Voters AND the cleanup-regression player (`SUITE_PLAYER_LEGACY_IDS`). By this
  // point every `player_match_stats` row for a suite match is gone (above), so
  // nothing without an ON DELETE clause still references these players.
  const suitePlayerLegacyIds = [...SUITE_PLAYER_LEGACY_IDS];
  await sql`
    DELETE FROM player_clubs
     WHERE player_id IN (SELECT id FROM players WHERE legacy_player_id = ANY(${suitePlayerLegacyIds}::bigint[]))
  `;
  await sql`
    DELETE FROM external_identities
     WHERE source_id = ${aflApiSourceId} AND external_id = ANY(${[...VOTER_PROVIDER_IDS]})
  `;
  await sql`DELETE FROM players WHERE legacy_player_id = ANY(${suitePlayerLegacyIds}::bigint[])`;

  // AFLDB-ISSUE-244 I244-F007 TEST HYGIENE. Since F007 the automatic Brownlow settle recomputes
  // `stat_availability` (`recomputeBrownlowCoverage()`) inside its own committed transaction, so
  // every `apply: true` case above leaves SEASON's Brownlow coverage rows describing this suite's
  // synthetic votes and matches — rows the deletes above just removed. Recompute them from what
  // genuinely remains, with the SAME canonical helper (no hard-coded values), so afldb_test is not
  // left reporting coverage for deleted fixtures. Runs last: it reads `matches`,
  // `brownlow_round_votes` and `player_match_stats`, all cleaned above. Also runs from beforeAll's
  // cleanup(), which repairs coverage a crashed earlier run left behind. Test-only: no production
  // behaviour depends on it.
  await sql.begin((tx) => recomputeBrownlowCoverage(tx, SEASON));
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
  const [afltables] = await sql<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afltables'`;
  if (!afltables) throw new Error("source 'afltables' must exist on afldb_test.");
  aflTablesSourceId = afltables.id;

  const [home] = await sql<{ id: number; name: string }[]>`SELECT id, name FROM clubs WHERE legacy_club_hist = ${HOME_HIST}`;
  const [away] = await sql<{ id: number; name: string }[]>`SELECT id, name FROM clubs WHERE legacy_club_hist = ${AWAY_HIST}`;
  if (!home || !away) throw new Error('Hawthorn and Brisbane Lions must both exist on afldb_test.');
  homeClubId = home.id;
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
    voterPlayerIds[i] = player.id;
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

/* ------------------------------------------------------------------ *
 * AFLDB-ISSUE-244 I244-F002 helpers — recipient replacement.
 *
 * Every F002 case starts from `resetBrownlowVotes()` and drives match p, so it
 * is independent of the state the cases above leave behind. The rows a case
 * seeds by hand all carry an NS-prefixed `source_record_id`, so `cleanup()`
 * already removes them.
 * ------------------------------------------------------------------ */

const BROWNLOW_ROUND = Number(ROUND_CODE);

function recipientsRecord(
  providerMatchId: string, recipients: ReadonlyArray<readonly [voter: number, votes: number]>,
): AflApiBrownlowMatchVoteRecord {
  return {
    providerMatchId,
    apiRoundNumber: roundFor(providerMatchId).apiRoundNumber,
    votes: recipients.map(([voter, votes]) => ({
      providerPlayerId: VOTER_PROVIDER_IDS[voter], providerTeamId: 'CD_T80', votes, eligible: true,
    })),
  };
}

/** First provider version: A = 3, B = 2, C = 1. */
function versionABC(): AflApiBrownlowMatchVoteRecord {
  return recipientsRecord(CASE_IDS.p, [[VA, 3], [VB, 2], [VC, 1]]);
}

/** Corrected provider version: C's single vote is re-awarded to D. */
function versionABD(): AflApiBrownlowMatchVoteRecord {
  return recipientsRecord(CASE_IDS.p, [[VA, 3], [VB, 2], [VD, 1]]);
}

/** AFLDB-ISSUE-244 I244-F007 two-way permutation of the SAME recipients: A and B trade 3 and 2. */
function versionSwapAB(): AflApiBrownlowMatchVoteRecord {
  return recipientsRecord(CASE_IDS.p, [[VA, 2], [VB, 3], [VC, 1]]);
}

/** AFLDB-ISSUE-244 I244-F007 three-way permutation of the SAME recipients: A3 B2 C1 -> C3 A2 B1. */
function versionCAB(): AflApiBrownlowMatchVoteRecord {
  return recipientsRecord(CASE_IDS.p, [[VC, 3], [VA, 2], [VB, 1]]);
}

function settleVoteSet(record: AflApiBrownlowMatchVoteRecord, options: { autoApply: boolean } = { autoApply: true }) {
  return runSettleAflApiBrownlow(sql, {
    registry, season: SEASON, matchVotes: [record], leaderboard: [], leaderboardStatus: null,
    inProgressSeasons: [SEASON], apply: true, autoApply: options.autoApply, observeOnly: false,
  });
}

async function resetBrownlowVotes(): Promise<void> {
  await sql`
    DELETE FROM canonical_applications
     WHERE target_table = 'brownlow_round_votes' AND external_record_id LIKE ${`${NS}%`}
  `;
  await sql`DELETE FROM brownlow_round_votes WHERE source_record_id LIKE ${`${NS}%`}`;
  await sql`DELETE FROM data_issues WHERE issue_key LIKE ${`%${NS}%`}`;
}

/** Hand-seeds one round-votes row (an "earlier settle" or a foreign owner's row). */
async function seedBrownlowRow(input: {
  voter: number; votes: number; sourceId: number; sourceRecordId: string;
}): Promise<void> {
  await sql`
    INSERT INTO brownlow_round_votes (season, player_id, round_number, played, votes, source_id, source_record_id)
    VALUES (${SEASON}, ${voterPlayerIds[input.voter]}, ${BROWNLOW_ROUND}, true, ${input.votes},
            ${input.sourceId}, ${input.sourceRecordId})
  `;
}

/** Every column a settle could touch, for a byte-for-byte before/after comparison. */
async function snapshotRows(voters: readonly number[]): Promise<Record<string, unknown>[]> {
  return sql<Record<string, unknown>[]>`
    SELECT id::text AS id, player_id::int AS "playerId", round_number, played, votes,
           source_id, source_record_id, import_batch_id::text AS "importBatchId", imported_at::text AS "importedAt"
      FROM brownlow_round_votes
     WHERE season = ${SEASON} AND player_id = ANY(${voters.map((v) => voterPlayerIds[v])}::int[])
     ORDER BY player_id
  `;
}

type VoterRow = { votes: number; played: boolean };

/** AFL-API-owned rows for one provider match, keyed by voter letter. */
async function ownedRowsByVoter(providerMatchId: string): Promise<Record<string, VoterRow>> {
  const rows = await sql<{ playerId: number; votes: number; played: boolean }[]>`
    SELECT player_id::int AS "playerId", votes::int AS votes, played
      FROM brownlow_round_votes
     WHERE season = ${SEASON} AND round_number = ${BROWNLOW_ROUND}
       AND source_id = ${aflApiSourceId} AND source_record_id = ${providerMatchId}
     ORDER BY player_id
  `;
  const out: Record<string, VoterRow> = {};
  for (const row of rows) {
    out[VOTER_LETTERS[voterPlayerIds.indexOf(row.playerId)]] = { votes: row.votes, played: row.played };
  }
  return out;
}

/**
 * AFLDB-ISSUE-244 I244-F007. Deliberately separate from `ownedRowsByVoter()`:
 * several F002 tests already assert `ownedRowsByVoter()`'s exact `toEqual({...})`
 * shape, and adding `match_id` to that shape would break every one of them for
 * no reason connected to what they test. This is the F007-specific read.
 */
async function matchIdsByVoter(providerMatchId: string): Promise<Record<string, number | null>> {
  const rows = await sql<{ playerId: number; matchId: number | null }[]>`
    SELECT player_id::int AS "playerId", match_id::int AS "matchId"
      FROM brownlow_round_votes
     WHERE season = ${SEASON} AND round_number = ${BROWNLOW_ROUND}
       AND source_id = ${aflApiSourceId} AND source_record_id = ${providerMatchId}
     ORDER BY player_id
  `;
  const out: Record<string, number | null> = {};
  for (const row of rows) {
    out[VOTER_LETTERS[voterPlayerIds.indexOf(row.playerId)]] = row.matchId;
  }
  return out;
}

/** The canonical `matches.id` CASE_IDS.p/q resolves to — the same id every F007 assertion below expects every voter row to carry. */
async function canonicalMatchId(providerMatchId: string): Promise<number> {
  const [row] = await sql<{ id: number }[]>`
    SELECT id FROM matches WHERE match_key = ${matchKeyFor(providerMatchId)}
  `;
  if (!row) throw new Error(`No canonical match for ${providerMatchId} — test precondition not met.`);
  return row.id;
}

/** The I244-F002 canonical post-condition: three positive rows, {3, 2, 1}, sum 6, exactly these voters. */
async function expectPositiveSetIs(providerMatchId: string, letters: readonly string[]): Promise<void> {
  const rows = await sql<{ playerId: number; votes: number }[]>`
    SELECT player_id::int AS "playerId", votes::int AS votes
      FROM brownlow_round_votes
     WHERE season = ${SEASON} AND round_number = ${BROWNLOW_ROUND}
       AND source_id = ${aflApiSourceId} AND source_record_id = ${providerMatchId} AND votes > 0
     ORDER BY votes DESC
  `;
  expect(rows).toHaveLength(3);
  expect(rows.map((r) => r.votes)).toEqual([3, 2, 1]);
  expect(rows.reduce((sum, r) => sum + r.votes, 0)).toBe(6);
  expect(rows.map((r) => VOTER_LETTERS[voterPlayerIds.indexOf(r.playerId)]).sort()).toEqual([...letters].sort());
}

async function brownlowLedgerCount(providerMatchId: string): Promise<number> {
  const [{ count }] = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM canonical_applications
     WHERE target_table = 'brownlow_round_votes' AND external_record_id = ${providerMatchId}
  `;
  return Number(count);
}

type LedgerRow = {
  verb: string; previousValues: unknown; newValues: unknown; sourceVersionSeq: number;
  importBatchId: string; family: string; sourceId: number;
};

async function ledgerForVoter(providerMatchId: string, voter: number): Promise<LedgerRow[]> {
  return sql<LedgerRow[]>`
    SELECT verb, previous_values AS "previousValues", new_values AS "newValues",
           source_version_seq AS "sourceVersionSeq", import_batch_id::text AS "importBatchId",
           family, source_id AS "sourceId"
      FROM canonical_applications
     WHERE target_table = 'brownlow_round_votes' AND external_record_id = ${providerMatchId}
       AND (target_key->>'player_id')::int = ${voterPlayerIds[voter]}
     ORDER BY id
  `;
}

/**
 * AFLDB-ISSUE-244 I244-F007 — the ledger rows of one provider match's `brownlow_round_votes`
 * writes AFTER the first `alreadySeen` (oldest first, `canonical_applications.id` order), each
 * tagged with its voter letter. Used to prove the two-phase order: every temporary release
 * (`votes -> 0`) must land BEFORE any final-value claim, or `ux_brownlow_round_votes_match_value`
 * would have refused the set.
 */
type SetLedgerRow = {
  voter: string; verb: string;
  previousValues: Record<string, unknown> | null; newValues: Record<string, unknown>;
};

async function ledgerRowsAfter(providerMatchId: string, alreadySeen: number): Promise<SetLedgerRow[]> {
  const rows = await sql<{
    playerId: number; verb: string;
    previousValues: Record<string, unknown> | null; newValues: Record<string, unknown>;
  }[]>`
    SELECT (target_key->>'player_id')::int AS "playerId", verb,
           previous_values AS "previousValues", new_values AS "newValues"
      FROM canonical_applications
     WHERE target_table = 'brownlow_round_votes' AND external_record_id = ${providerMatchId}
     ORDER BY id
    OFFSET ${alreadySeen}
  `;
  return rows.map((row) => ({
    voter: VOTER_LETTERS[voterPlayerIds.indexOf(row.playerId)], verb: row.verb,
    previousValues: row.previousValues, newValues: row.newValues,
  }));
}

/** `match_id` of every AFL-API-owned POSITIVE row of one provider match, keyed by voter letter. */
async function positiveMatchIdsByVoter(providerMatchId: string): Promise<Record<string, number | null>> {
  const rows = await sql<{ playerId: number; matchId: number | null }[]>`
    SELECT player_id::int AS "playerId", match_id::int AS "matchId"
      FROM brownlow_round_votes
     WHERE season = ${SEASON} AND round_number = ${BROWNLOW_ROUND}
       AND source_id = ${aflApiSourceId} AND source_record_id = ${providerMatchId} AND votes > 0
     ORDER BY player_id
  `;
  return Object.fromEntries(rows.map((row) => [VOTER_LETTERS[voterPlayerIds.indexOf(row.playerId)], row.matchId]));
}

async function openSettleIssues(providerMatchId: string): Promise<{ severity: string; details: Record<string, unknown> }[]> {
  return sql<{ severity: string; details: Record<string, unknown> }[]>`
    SELECT severity, details FROM data_issues
     WHERE issue_type = ${SETTLE_ISSUE_TYPE} AND issue_key LIKE ${`%${providerMatchId}%`} AND resolved_at IS NULL
  `;
}

/* ------------------------------------------------------------------ *
 * AFLDB-ISSUE-244 I244-F007 — persisted coverage assertions.
 *
 * `runSettleAflApiBrownlow()` reports `coverageRecomputeRuns`, but a counter proves only that a
 * call was made. The persisted `stat_availability` rows are what F007 actually owes. Before a run
 * under test, `plantCoverageSentinel()` writes a state no real recompute can produce
 * (`is_recorded = true` with `coverage = 'not_applicable'` and NULL row counts): a run that did NOT
 * invoke `recomputeBrownlowCoverage()` — which is exactly what the pre-F007 automatic path did —
 * leaves the sentinel intact and fails `expectCoverageRecomputed()`; a run that was refused or was
 * a no-op must leave it intact and passes `expectCoverageSentinelIntact()`.
 * ------------------------------------------------------------------ */

const COVERAGE_KEYS = ['brownlow_round_votes', 'brownlow_match_votes'] as const;
type CoverageRow = { isRecorded: boolean; coverage: string; populatedRows: number | null; totalRows: number | null };
const COVERAGE_SENTINEL: CoverageRow = { isRecorded: true, coverage: 'not_applicable', populatedRows: null, totalRows: null };

async function plantCoverageSentinel(): Promise<void> {
  for (const key of COVERAGE_KEYS) {
    await sql`
      INSERT INTO stat_availability (stat_key, season, is_recorded, coverage, populated_rows, total_rows)
      VALUES (${key}, ${SEASON}, true, 'not_applicable', NULL, NULL)
      ON CONFLICT (stat_key, season) DO UPDATE
         SET is_recorded = true, coverage = 'not_applicable', populated_rows = NULL, total_rows = NULL
    `;
  }
}

async function coverageRows(): Promise<Record<string, CoverageRow>> {
  const rows = await sql<(CoverageRow & { statKey: string })[]>`
    SELECT stat_key AS "statKey", is_recorded AS "isRecorded", coverage::text AS coverage,
           populated_rows AS "populatedRows", total_rows AS "totalRows"
      FROM stat_availability
     WHERE season = ${SEASON} AND stat_key = ANY(${[...COVERAGE_KEYS]}::text[])
  `;
  return Object.fromEntries(rows.map(({ statKey, ...rest }) => [statKey, rest]));
}

async function expectCoverageSentinelIntact(): Promise<void> {
  expect(await coverageRows()).toEqual({
    brownlow_round_votes: COVERAGE_SENTINEL, brownlow_match_votes: COVERAGE_SENTINEL,
  });
}

/**
 * The persisted result of `recomputeBrownlowCoverage(tx, SEASON)` after this suite's match p holds
 * an accounted 3/2/1 (`match_id` populated) and match q holds no votes. `brownlow_round_votes` is
 * `partial` (rows exist, not every home-and-away match is accounted: q is not) and therefore
 * `is_recorded = false`; `brownlow_match_votes` carries a non-NULL `total_rows` equal to the
 * season's home-and-away match count, read independently of the recompute.
 */
async function expectCoverageRecomputed(): Promise<void> {
  const [{ haMatches }] = await sql<{ haMatches: number }[]>`
    SELECT count(*)::int AS "haMatches" FROM matches
     WHERE season = ${SEASON} AND round_type = 'home_and_away'
  `;
  expect(haMatches).toBeGreaterThanOrEqual(2); // suite matches p and q
  const rows = await coverageRows();
  expect(rows.brownlow_round_votes).not.toEqual(COVERAGE_SENTINEL);
  expect(rows.brownlow_round_votes).toEqual({
    isRecorded: false, coverage: 'partial', populatedRows: null, totalRows: null,
  });
  expect(rows.brownlow_match_votes).not.toEqual(COVERAGE_SENTINEL);
  expect(rows.brownlow_match_votes.totalRows).toBe(haMatches);
  expect(rows.brownlow_match_votes.populatedRows).not.toBeNull();
}

/**
 * AFLDB-ISSUE-244 I244-F008. One batch row as an operator would read it, with the
 * number of `import_rejections` rows actually persisted for it, so a case can
 * prove the two agree rather than trusting either alone. `bigint` columns are
 * cast to `int` (postgres.js would otherwise hand back decimal text).
 */
async function importBatchRow(batchId: string): Promise<{
  status: string; completed: boolean; completedAfterStart: boolean;
  recordsRead: number; recordsInserted: number; recordsUpdated: number; recordsRejected: number;
  rejectionRows: number; validationResult: unknown;
}> {
  const [row] = await sql<{
    status: string; completed: boolean; completedAfterStart: boolean;
    recordsRead: number; recordsInserted: number; recordsUpdated: number; recordsRejected: number;
    rejectionRows: number; validationResult: unknown;
  }[]>`
    SELECT b.status::text AS status,
           (b.completed_at IS NOT NULL) AS completed,
           (b.completed_at >= b.started_at) AS "completedAfterStart",
           b.records_read::int AS "recordsRead",
           b.records_inserted::int AS "recordsInserted",
           b.records_updated::int AS "recordsUpdated",
           b.records_rejected::int AS "recordsRejected",
           (SELECT count(*)::int FROM import_rejections r WHERE r.import_batch_id = b.id) AS "rejectionRows",
           b.validation_result AS "validationResult"
      FROM import_batches b
     WHERE b.id = ${batchId}::bigint
  `;
  if (!row) throw new Error(`import_batches row ${batchId} does not exist.`);
  return row;
}

/** I244-F008. Every Brownlow-settle batch on this database (only this suite commits any on afldb_test). */
async function brownlowBatchCount(): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM import_batches
     WHERE source_id = ${aflApiSourceId} AND tool = ${SETTLE_BATCH_TOOL}
  `;
  return row.count;
}

/**
 * I244-F008. Wraps a real connection so the ONE statement that finalises the
 * batch (`UPDATE import_batches`) fails inside the settle's own transaction,
 * while every other statement — the whole real write path, vote writes and
 * coverage recompute included — runs against the real database. A test-side
 * wrapper only: production carries no failure hook.
 */
function sqlFailingOnBatchFinalisation(real: postgres.Sql): postgres.Sql {
  const wrapTransaction = (tx: postgres.TransactionSql): postgres.TransactionSql => new Proxy(tx, {
    apply(target, thisArg, args: unknown[]) {
      const strings = args[0];
      if (Array.isArray(strings) && strings.join('?').includes('UPDATE import_batches')) {
        throw new Error('injected batch finalisation failure');
      }
      return Reflect.apply(target, thisArg, args);
    },
  });
  return new Proxy(real, {
    get(target, property) {
      if (property === 'begin') {
        return (callback: (tx: postgres.TransactionSql) => unknown) =>
          target.begin((tx) => callback(wrapTransaction(tx)) as never);
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as postgres.Sql;
}

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
      expect(projectionRows.map((r) => r.providerPlayerId)).toEqual([...VOTER_PROVIDER_IDS].slice(0, 3));
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
      expect(correctionResult.counters.voteSetsRefused).toEqual({});
      // AFLDB-ISSUE-244 I244-F007: this correction is A3 B2 C1 -> A2 B3 C1, a two-recipient permutation of
      // CURRENT recipients. F007's partial UNIQUE (match_id, votes) safety requires current recipients
      // changing positive vote slots to be released to 0 before the final claims, so the correction performs
      // four canonical row updates rather than the old two: A -> 0, B -> 0 (releases), then A -> 2, B -> 3
      // (claims). C (1 -> 1) is neither released nor rewritten. No recipient left the set, so none of the
      // four is a stale demotion.
      expect(correctionResult.counters.staleRecipientsDemoted).toBe(0);
      expect(correctionResult.counters.canonicalRowsInserted).toBe(0);
      expect(correctionResult.counters.canonicalRowsUpdated).toBe(4);
      expect(correctionResult.counters.canonicalApplicationsLogged).toBe(4);

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

      // Ledger: 3 inserts (first apply) + 0 (replay) + 4 (two releases + two claims) = 7.
      const [ledgerAfterCorrection] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM canonical_applications
         WHERE target_table = 'brownlow_round_votes' AND external_record_id = ${CASE_IDS.p}
      `;
      expect(ledgerAfterCorrection.count).toBe('7');
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
        season: plan.season, canonicalRoundNumber: plan.canonicalRoundNumber, matchId: plan.matchId, units: plan.units,
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

  describe('AFLDB-ISSUE-244 I244-F002 — Brownlow recipient replacement', () => {
    it(
      'a corrected recipient swap (A3 B2 C1 -> A3 B2 D1) demotes C to 0 through the ledger, writes D, '
        + 'and leaves exactly three positive recipients summing to 6 — the pre-F002 code left C = 1 beside D = 1',
      async () => {
        await resetBrownlowVotes();
        const first = await settleVoteSet(versionABC());
        expect(first.halt).toBeNull();
        expect(first.applied).toBe(true);
        expect(first.counters.canonicalRowsInserted).toBe(3);
        expect(first.counters.staleRecipientsDemoted).toBe(0);
        await expectPositiveSetIs(CASE_IDS.p, ['A', 'B', 'C']);

        const swapped = await settleVoteSet(versionABD());
        expect(swapped.halt).toBeNull();
        expect(swapped.applied).toBe(true);
        expect(swapped.counters.voteSetsApplyFailed).toBe(0);
        expect(swapped.counters.voteSetsNoOp).toBe(0);
        expect(swapped.counters.versionsAppended).toBe(1);
        expect(swapped.counters.staleRecipientsDemoted).toBe(1);
        expect(swapped.counters.canonicalRowsInserted).toBe(1); // D
        expect(swapped.counters.canonicalRowsUpdated).toBe(1); // C's demotion
        expect(swapped.counters.canonicalApplicationsLogged).toBe(2);

        // C is retained (never deleted) at played = true, votes = 0.
        expect(await ownedRowsByVoter(CASE_IDS.p)).toEqual({
          A: { votes: 3, played: true },
          B: { votes: 2, played: true },
          C: { votes: 0, played: true },
          D: { votes: 1, played: true },
        });
        await expectPositiveSetIs(CASE_IDS.p, ['A', 'B', 'D']);

        // The demotion is an ordinary ledgered UPDATE under the CORRECTED version.
        const [head] = await sql<{ versionSeq: number }[]>`
          SELECT current_version_seq AS "versionSeq" FROM staging.source_records
           WHERE source_id = ${aflApiSourceId} AND family = 'brownlow_match_votes'
             AND external_record_id = ${CASE_IDS.p}
        `;
        const cLedger = await ledgerForVoter(CASE_IDS.p, VC);
        expect(cLedger.map((r) => r.verb)).toEqual(['insert', 'update']);
        const demotion = cLedger[1];
        expect(demotion.previousValues).toEqual({ votes: 1 });
        expect(demotion.newValues).toEqual({ votes: 0 });
        expect(demotion.family).toBe('brownlow_match_votes');
        expect(demotion.sourceId).toBe(aflApiSourceId);
        expect(demotion.sourceVersionSeq).toBe(head.versionSeq);
        expect(demotion.sourceVersionSeq).toBeGreaterThan(cLedger[0].sourceVersionSeq);
        expect(demotion.importBatchId).toBe(swapped.batchId);

        // ...and C's row now carries the correcting run's provenance, still AFL-API-owned.
        const [cRow] = await snapshotRows([VC]);
        expect(cRow.importBatchId).toBe(swapped.batchId);
        expect(cRow.source_id).toBe(aflApiSourceId);
        expect(cRow.source_record_id).toBe(CASE_IDS.p);
      },
      60_000,
    );

    it(
      'an identical replay of the corrected version is a no-op: no write, no counter, no repeated demotion, no provenance churn',
      async () => {
        await resetBrownlowVotes();
        await settleVoteSet(versionABC());
        await settleVoteSet(versionABD());
        const ledgerBefore = await brownlowLedgerCount(CASE_IDS.p);
        expect(ledgerBefore).toBe(5); // A, B, C inserts; D insert; C demotion
        const rowsBefore = await snapshotRows([VA, VB, VC, VD]);

        const replay = await settleVoteSet(versionABD());
        expect(replay.halt).toBeNull();
        expect(replay.applied).toBe(true);
        expect(replay.counters.versionsAppended).toBe(0);
        expect(replay.counters.voteSetsNoOp).toBe(1);
        expect(replay.counters.voteSetsApplyFailed).toBe(0);
        expect(replay.counters.canonicalRowsInserted).toBe(0);
        expect(replay.counters.canonicalRowsUpdated).toBe(0);
        expect(replay.counters.canonicalApplicationsLogged).toBe(0);
        expect(replay.counters.staleRecipientsDemoted).toBe(0);

        expect(await brownlowLedgerCount(CASE_IDS.p)).toBe(ledgerBefore);
        expect(await snapshotRows([VA, VB, VC, VD])).toEqual(rowsBefore); // imported_at included
      },
      60_000,
    );

    it(
      'a later correction can reverse the swap (D -> 0, C -> 1): the retained zero row is reused, never recreated',
      async () => {
        await resetBrownlowVotes();
        await settleVoteSet(versionABC());
        await settleVoteSet(versionABD());

        const reversed = await settleVoteSet(versionABC());
        expect(reversed.halt).toBeNull();
        expect(reversed.applied).toBe(true);
        expect(reversed.counters.voteSetsApplyFailed).toBe(0);
        expect(reversed.counters.versionsAppended).toBe(1);
        expect(reversed.counters.staleRecipientsDemoted).toBe(1); // D
        expect(reversed.counters.canonicalRowsInserted).toBe(0);
        expect(reversed.counters.canonicalRowsUpdated).toBe(2); // D -> 0, C -> 1
        expect(reversed.counters.canonicalApplicationsLogged).toBe(2);

        expect(await ownedRowsByVoter(CASE_IDS.p)).toEqual({
          A: { votes: 3, played: true },
          B: { votes: 2, played: true },
          C: { votes: 1, played: true },
          D: { votes: 0, played: true },
        });
        await expectPositiveSetIs(CASE_IDS.p, ['A', 'B', 'C']);

        const dLedger = await ledgerForVoter(CASE_IDS.p, VD);
        expect(dLedger.map((r) => r.verb)).toEqual(['insert', 'update']);
        expect(dLedger[1].previousValues).toEqual({ votes: 1 });
        expect(dLedger[1].newValues).toEqual({ votes: 0 });
        const cLedger = await ledgerForVoter(CASE_IDS.p, VC);
        expect(cLedger.map((r) => r.verb)).toEqual(['insert', 'update', 'update']);
        expect(cLedger[2].previousValues).toEqual({ votes: 0 });
        expect(cLedger[2].newValues).toEqual({ votes: 1 });
      },
      60_000,
    );

    it(
      'never touches another match\'s row in the SAME season and round, nor a foreign-owned row that merely reuses '
        + 'this match\'s source_record_id — the correction is bounded by (source_id, source_record_id), not by round',
      async () => {
        await resetBrownlowVotes();
        // A hand-seeded AFL API row that carries match q's source_record_id but sits in p's canonical round
        // ('6' — BROWNLOW_ROUND; q's own canonical round is '7' since I244-F030) already holds a positive
        // vote for E. E is not in match p's vote sets, so a season+round sweep would zero it. p + E keep the
        // same-season, same-round isolation coverage; the bound under test is (source_id, source_record_id).
        await seedBrownlowRow({ voter: VE, votes: 2, sourceId: aflApiSourceId, sourceRecordId: CASE_IDS.q });
        // A foreign-owned positive row that borrows p's source_record_id string: only source_id differs.
        await seedBrownlowRow({ voter: VF, votes: 1, sourceId: aflTablesSourceId, sourceRecordId: CASE_IDS.p });
        const foreignBefore = await snapshotRows([VE, VF]);
        expect(foreignBefore).toHaveLength(2);

        await settleVoteSet(versionABC());
        const swapped = await settleVoteSet(versionABD());
        expect(swapped.counters.voteSetsApplyFailed).toBe(0);
        expect(swapped.counters.staleRecipientsDemoted).toBe(1); // C only

        expect(await snapshotRows([VE, VF])).toEqual(foreignBefore);
        const [{ count: touchedByLedger }] = await sql<{ count: string }[]>`
          SELECT count(*)::text AS count FROM canonical_applications
           WHERE target_table = 'brownlow_round_votes'
             AND (target_key->>'player_id')::int = ANY(${[voterPlayerIds[VE], voterPlayerIds[VF]]}::int[])
        `;
        expect(touchedByLedger).toBe('0');

        // p's own AFL-API-owned positive set is exactly the corrected 3/2/1.
        await expectPositiveSetIs(CASE_IDS.p, ['A', 'B', 'D']);
        expect(await ownedRowsByVoter(CASE_IDS.q)).toEqual({ E: { votes: 2, played: true } });
      },
      60_000,
    );

    it(
      'rolls the WHOLE vote set back when one part of a swap cannot apply — C is never zeroed while D is missing '
        + '— and the identical call succeeds once the failure is removed',
      async () => {
        await resetBrownlowVotes();
        await settleVoteSet(versionABC());

        // Persist the corrected spine version + typed projection, WITHOUT a canonical write.
        const projectResult = await settleVoteSet(versionABD(), { autoApply: false });
        expect(projectResult.applied).toBe(true);
        if (!projectResult.batchId) throw new Error('Expected a committed batch id from the apply:true projection run.');
        const batchId = asImportBatchId(projectResult.batchId);
        const [head] = await sql<{ versionSeq: number }[]>`
          SELECT current_version_seq AS "versionSeq" FROM staging.source_records
           WHERE source_id = ${aflApiSourceId} AND family = 'brownlow_match_votes'
             AND external_record_id = ${CASE_IDS.p}
        `;
        const plan = await sql.begin((tx) => planAflApiBrownlowMatchSet(tx, aflApiSourceId, registry, versionABD()));
        if (plan.status !== 'planned') throw new Error(`Expected the swapped vote set to plan; got: ${plan.status}`);
        const sources = await sql<{ id: number; key: string }[]>`SELECT id, key FROM sources`;
        const sourceKeysById = new Map(sources.map((row) => [row.id, row.key]));
        const applyInput = {
          sourceId: aflApiSourceId, sourceKeysById, batchId, inProgressSeasons: [SEASON],
          providerMatchId: CASE_IDS.p, sourceVersionSeq: head.versionSeq,
          season: plan.season, canonicalRoundNumber: plan.canonicalRoundNumber, matchId: plan.matchId,
          units: plan.units,
        };

        const rowsBefore = await snapshotRows([VA, VB, VC, VD]);
        const ledgerBefore = await brownlowLedgerCount(CASE_IDS.p);
        expect(rowsBefore).toHaveLength(3); // A, B, C — D has no row yet

        // D's projected vote is missing. Since AFLDB-ISSUE-244 I244-F007 the apply resolves EVERY current
        // recipient's projected vote up front (the two-phase release plan needs them all), so this now fails
        // BEFORE the first write rather than after C's demotion: still no partial state, and still checked
        // below. The rollback of writes ALREADY made inside the savepoint (C demoted, then D refused) is
        // proven by the foreign-owned-D test that follows, which fails mid-set on a real gate.
        const shortMap = new Map(
          plan.units.filter((u) => u.providerPlayerId !== VOTER_PROVIDER_IDS[VD]).map((u) => [u.providerPlayerId, u.votes]),
        );
        const failed = await sql.begin((tx) => applyAflApiBrownlowVoteSet(tx, { ...applyInput, projectedVotes: shortMap }));
        expect(failed.status).toBe('failed');
        if (failed.status !== 'failed') throw new Error('unreachable — asserted above');
        expect(failed.reason).toContain('carries no projected row');
        expect(failed.reason).toContain(VOTER_PROVIDER_IDS[VD]);

        // Pre-correction state is intact: C still 1, no D, no new ledger row.
        expect(await snapshotRows([VA, VB, VC, VD])).toEqual(rowsBefore);
        expect(await ownedRowsByVoter(CASE_IDS.p)).toEqual({
          A: { votes: 3, played: true }, B: { votes: 2, played: true }, C: { votes: 1, played: true },
        });
        expect(await brownlowLedgerCount(CASE_IDS.p)).toBe(ledgerBefore);

        // Positive control: the same call with the complete projection applies the swap.
        const fullMap = new Map(plan.units.map((u) => [u.providerPlayerId, u.votes]));
        const applied = await sql.begin((tx) => applyAflApiBrownlowVoteSet(tx, { ...applyInput, projectedVotes: fullMap }));
        expect(applied).toEqual({ status: 'applied', rowsInserted: 1, rowsUpdated: 1, recipientsDemoted: 1 });
        await expectPositiveSetIs(CASE_IDS.p, ['A', 'B', 'D']);
      },
      60_000,
    );

    it(
      'refuses the WHOLE set when the replacement recipient\'s row belongs to another source — the stale recipient is '
        + 'not left demoted, the foreign row is neither adopted nor changed, and the failure is a visible data issue',
      async () => {
        await resetBrownlowVotes();
        await settleVoteSet(versionABC());
        // D already has a (zero) row owned by AFL Tables: applyCanonicalUnit refuses foreign_source_owner.
        await seedBrownlowRow({ voter: VD, votes: 0, sourceId: aflTablesSourceId, sourceRecordId: CASE_IDS.p });
        const rowsBefore = await snapshotRows([VA, VB, VC, VD]);
        const ledgerBefore = await brownlowLedgerCount(CASE_IDS.p);

        const swapped = await settleVoteSet(versionABD());
        expect(swapped.halt).toBeNull();
        expect(swapped.counters.voteSetsApplyFailed).toBe(1);
        expect(swapped.counters.staleRecipientsDemoted).toBe(0);
        expect(swapped.counters.canonicalRowsInserted).toBe(0);
        expect(swapped.counters.canonicalRowsUpdated).toBe(0);
        expect(swapped.counters.canonicalApplicationsLogged).toBe(0);

        expect(await snapshotRows([VA, VB, VC, VD])).toEqual(rowsBefore); // C still 1; foreign D unchanged
        expect(await brownlowLedgerCount(CASE_IDS.p)).toBe(ledgerBefore);

        const issues = await sql<{ error: string }[]>`
          SELECT details->>'error' AS error FROM data_issues
           WHERE issue_type = ${SETTLE_ISSUE_TYPE} AND issue_key LIKE ${`%${CASE_IDS.p}%`} AND resolved_at IS NULL
        `;
        expect(issues).toHaveLength(1);
        expect(issues[0].error).toContain('foreign_source_owner');
      },
      60_000,
    );

    it(
      'heals a vote set a pre-F002 run left stale (A3 B2 C1 + D1 all positive) on its next replay, and '
        + '(AFLDB-ISSUE-244 I244-F007) heals D\'s NULL match_id in the SAME replay with no extra vote change, '
        + 'recomputing coverage once as part of the same committed transaction',
      async () => {
        await resetBrownlowVotes();
        await settleVoteSet(versionABC());
        // Reproduce the exact pre-F002 corruption: D inserted as an AFL-API-owned positive row beside C —
        // and, pre-F007, with no match_id (every row this suite hand-seeds carries none; `seedBrownlowRow()`
        // never sets one).
        await seedBrownlowRow({ voter: VD, votes: 1, sourceId: aflApiSourceId, sourceRecordId: CASE_IDS.p });
        const [{ count: positives }] = await sql<{ count: string }[]>`
          SELECT count(*)::text AS count FROM brownlow_round_votes
           WHERE season = ${SEASON} AND source_record_id = ${CASE_IDS.p} AND votes > 0
        `;
        expect(positives).toBe('4'); // A, B, C, D — the F002 over-count
        expect((await matchIdsByVoter(CASE_IDS.p)).D).toBeNull();

        const resolvedMatchId = await canonicalMatchId(CASE_IDS.p);
        // A, B and C were already healed on the ABC settle above, so this replay's only match_id work is D's.
        expect(await matchIdsByVoter(CASE_IDS.p)).toMatchObject({ A: resolvedMatchId, B: resolvedMatchId, C: resolvedMatchId });

        await plantCoverageSentinel();
        const healed = await settleVoteSet(versionABD());
        expect(healed.counters.voteSetsApplyFailed).toBe(0);
        expect(healed.counters.staleRecipientsDemoted).toBe(1); // C
        expect(healed.counters.canonicalRowsInserted).toBe(0);
        // C's demotion (votes 1 -> 0) + D's match_id heal (NULL -> resolvedMatchId, votes unchanged at 1):
        // two field-level UPDATEs, neither of which inserts a row. No current recipient's positive value
        // changed (A3 B2 D1 against A3 B2 D1), so the two-phase release adds NO further write here.
        expect(healed.counters.canonicalRowsUpdated).toBe(2);
        expect(healed.counters.canonicalApplicationsLogged).toBe(2);
        expect(healed.counters.coverageRecomputeRuns).toBe(1);
        // The persisted result, not just the counter: the impossible sentinel planted above is gone.
        await expectCoverageRecomputed();
        await expectPositiveSetIs(CASE_IDS.p, ['A', 'B', 'D']);

        // Every AFL-API-owned row this provider match now carries — including the demoted C — carries the
        // SAME resolved match_id; D's heal did not touch its (unchanged) votes value.
        expect(await matchIdsByVoter(CASE_IDS.p)).toEqual({
          A: resolvedMatchId, B: resolvedMatchId, C: resolvedMatchId, D: resolvedMatchId,
        });
        expect((await ownedRowsByVoter(CASE_IDS.p)).D).toEqual({ votes: 1, played: true });

        // The ledger row for D's heal is a `match_id`-only UPDATE — `votes` never appears in it, because it
        // never changed.
        const dLedger = await ledgerForVoter(CASE_IDS.p, VD);
        const healEntry = dLedger[dLedger.length - 1];
        expect(healEntry.verb).toBe('update');
        expect(healEntry.previousValues).toEqual({ match_id: null });
        expect(healEntry.newValues).toEqual({ match_id: resolvedMatchId });

        // `recomputeBrownlowCoverage()`'s own `match_ctx` lateral (player-derived.ts) joins
        // `brownlow_round_votes.match_id = matches.id` and classifies an "accounted" home-and-away
        // round as total = 6, positives = 3, distinct_values = 3. Proving that predicate now holds for
        // THIS match — which it could not before F007 populated match_id — is what "coverage recompute
        // used the healed match_id" means; `stat_availability`'s season-wide roll-up depends on every
        // other home-and-away match of SEASON too, which this suite does not control, so it is not
        // asserted here.
        const [accounted] = await sql<{ total: number; positives: number; distinctValues: number }[]>`
          SELECT COALESCE(sum(votes), 0)::int AS total,
                 count(*) FILTER (WHERE votes > 0)::int AS positives,
                 count(DISTINCT votes) FILTER (WHERE votes > 0)::int AS "distinctValues"
            FROM brownlow_round_votes WHERE match_id = ${resolvedMatchId}
        `;
        expect(accounted).toEqual({ total: 6, positives: 3, distinctValues: 3 });
      },
      60_000,
    );

    /* ---------------------------------------------------------------- *
     * AFLDB-ISSUE-244 I244-F007 blocker 1 — vote PERMUTATIONS against
     * `ux_brownlow_round_votes_match_value` (UNIQUE (match_id, votes)
     * WHERE match_id IS NOT NULL AND votes > 0, migration 094). Every
     * case starts from A3 B2 C1 already carrying match M (the first
     * settle populates match_id), so a one-row-at-a-time write of a
     * permutation would collide with a row not yet rewritten.
     * ---------------------------------------------------------------- */

    it(
      'AFLDB-ISSUE-244 I244-F007: a two-way permutation (A3 B2 C1 -> A2 B3 C1) succeeds without violating '
        + 'UNIQUE (match_id, votes): A and B are released to 0 first, then claim their final values — and '
        + 'neither temporary release is counted as a stale demotion',
      async () => {
        await resetBrownlowVotes();
        const first = await settleVoteSet(versionABC());
        expect(first.counters.canonicalRowsInserted).toBe(3);
        const matchId = await canonicalMatchId(CASE_IDS.p);
        const ledgerBefore = await brownlowLedgerCount(CASE_IDS.p);
        expect(ledgerBefore).toBe(3);
        expect(await positiveMatchIdsByVoter(CASE_IDS.p)).toEqual({ A: matchId, B: matchId, C: matchId });

        await plantCoverageSentinel();
        const swapped = await settleVoteSet(versionSwapAB());
        expect(swapped.halt).toBeNull();
        expect(swapped.applied).toBe(true);
        expect(swapped.counters.voteSetsApplyFailed).toBe(0);
        expect(swapped.counters.voteSetsRefused).toEqual({});
        expect(swapped.counters.voteSetsNoOp).toBe(0);
        expect(swapped.counters.versionsAppended).toBe(1);
        expect(swapped.counters.staleRecipientsDemoted).toBe(0); // A and B are still CURRENT recipients
        expect(swapped.counters.canonicalRowsInserted).toBe(0);
        // Truthful two-phase count: A -> 0, B -> 0 (releases), then A -> 2, B -> 3 (claims). C is unchanged.
        expect(swapped.counters.canonicalRowsUpdated).toBe(4);
        expect(swapped.counters.canonicalApplicationsLogged).toBe(4);
        expect(swapped.counters.coverageRecomputeRuns).toBe(1);
        expect(await openSettleIssues(CASE_IDS.p)).toEqual([]);

        // Final positives are exactly B3, A2, C1 — sum 6 — and every positive row carries match M.
        expect(await ownedRowsByVoter(CASE_IDS.p)).toEqual({
          A: { votes: 2, played: true }, B: { votes: 3, played: true }, C: { votes: 1, played: true },
        });
        await expectPositiveSetIs(CASE_IDS.p, ['A', 'B', 'C']);
        expect(await positiveMatchIdsByVoter(CASE_IDS.p)).toEqual({ A: matchId, B: matchId, C: matchId });

        // The ledger proves the order: both releases (votes -> 0) precede both claims (0 -> final).
        const written = await ledgerRowsAfter(CASE_IDS.p, ledgerBefore);
        expect(written).toHaveLength(4);
        const [release1, release2, claim1, claim2] = written;
        expect([release1.voter, release2.voter].sort()).toEqual(['A', 'B']);
        for (const release of [release1, release2]) {
          expect(release.verb).toBe('update');
          expect(release.newValues).toEqual({ votes: 0 });
        }
        expect(release1.previousValues).toEqual({ votes: release1.voter === 'A' ? 3 : 2 });
        expect(release2.previousValues).toEqual({ votes: release2.voter === 'A' ? 3 : 2 });
        expect([claim1.voter, claim2.voter].sort()).toEqual(['A', 'B']);
        for (const claim of [claim1, claim2]) {
          expect(claim.verb).toBe('update');
          expect(claim.previousValues).toEqual({ votes: 0 });
          expect(claim.newValues).toEqual({ votes: claim.voter === 'A' ? 2 : 3 });
        }
        expect(written.some((row) => row.voter === 'C')).toBe(false); // C never touched

        // The recompute this successful, changed set owes is PERSISTED, not merely counted.
        await expectCoverageRecomputed();

        // An identical replay afterwards is a no-op: nothing released, nothing written, no recompute.
        const ledgerAfter = await brownlowLedgerCount(CASE_IDS.p);
        await plantCoverageSentinel();
        const replay = await settleVoteSet(versionSwapAB());
        expect(replay.counters.versionsAppended).toBe(0);
        expect(replay.counters.voteSetsNoOp).toBe(1);
        expect(replay.counters.voteSetsApplyFailed).toBe(0);
        expect(replay.counters.canonicalRowsUpdated).toBe(0);
        expect(replay.counters.canonicalApplicationsLogged).toBe(0);
        expect(replay.counters.coverageRecomputeRuns).toBe(0);
        expect(await brownlowLedgerCount(CASE_IDS.p)).toBe(ledgerAfter);
        await expectCoverageSentinelIntact();
      },
      60_000,
    );

    it(
      'AFLDB-ISSUE-244 I244-F007: a three-way permutation (A3 B2 C1 -> C3 A2 B1) succeeds — no single-row write '
        + 'order can — by releasing all three recipients before claiming any final value; none is a stale demotion',
      async () => {
        await resetBrownlowVotes();
        await settleVoteSet(versionABC());
        const matchId = await canonicalMatchId(CASE_IDS.p);
        const ledgerBefore = await brownlowLedgerCount(CASE_IDS.p);
        expect(ledgerBefore).toBe(3);

        const cycled = await settleVoteSet(versionCAB());
        expect(cycled.halt).toBeNull();
        expect(cycled.applied).toBe(true);
        expect(cycled.counters.voteSetsApplyFailed).toBe(0);
        expect(cycled.counters.voteSetsRefused).toEqual({});
        expect(cycled.counters.staleRecipientsDemoted).toBe(0);
        expect(cycled.counters.canonicalRowsInserted).toBe(0);
        expect(cycled.counters.canonicalRowsUpdated).toBe(6); // 3 releases + 3 claims
        expect(cycled.counters.canonicalApplicationsLogged).toBe(6);
        expect(await openSettleIssues(CASE_IDS.p)).toEqual([]);

        expect(await ownedRowsByVoter(CASE_IDS.p)).toEqual({
          A: { votes: 2, played: true }, B: { votes: 1, played: true }, C: { votes: 3, played: true },
        });
        await expectPositiveSetIs(CASE_IDS.p, ['A', 'B', 'C']); // {3,2,1}, sum 6
        expect(await positiveMatchIdsByVoter(CASE_IDS.p)).toEqual({ A: matchId, B: matchId, C: matchId });

        // Every temporary release precedes every claim.
        const written = await ledgerRowsAfter(CASE_IDS.p, ledgerBefore);
        expect(written).toHaveLength(6);
        const releases = written.slice(0, 3);
        const claims = written.slice(3);
        expect(releases.map((row) => row.voter).sort()).toEqual(['A', 'B', 'C']);
        const before: Record<string, number> = { A: 3, B: 2, C: 1 };
        for (const release of releases) {
          expect(release.verb).toBe('update');
          expect(release.previousValues).toEqual({ votes: before[release.voter] });
          expect(release.newValues).toEqual({ votes: 0 });
        }
        const after: Record<string, number> = { C: 3, A: 2, B: 1 };
        expect(claims.map((row) => row.voter).sort()).toEqual(['A', 'B', 'C']);
        for (const claim of claims) {
          expect(claim.verb).toBe('update');
          expect(claim.previousValues).toEqual({ votes: 0 });
          expect(claim.newValues).toEqual({ votes: after[claim.voter] });
        }

        // Identical replay: no-op, no further ledger rows.
        const ledgerAfter = await brownlowLedgerCount(CASE_IDS.p);
        const replay = await settleVoteSet(versionCAB());
        expect(replay.counters.voteSetsNoOp).toBe(1);
        expect(replay.counters.canonicalRowsUpdated).toBe(0);
        expect(await brownlowLedgerCount(CASE_IDS.p)).toBe(ledgerAfter);
      },
      60_000,
    );

    /* ---------------------------------------------------------------- *
     * AFLDB-ISSUE-244 I244-F007 blocker 2 — an existing row whose non-null
     * match_id contradicts the match this provider set resolved to refuses
     * the ENTIRE set before any write. The provider set here resolves to
     * match p (canonical id M); the conflicting row is made to carry match
     * q's real `matches.id` (X) — the column is `REFERENCES matches(id)`,
     * and the ordinary path can never produce this state for p, which is
     * exactly why the guard has to hold when something else does.
     * ---------------------------------------------------------------- */

    it.each([
      { label: 'CURRENT recipient (A stays in A3 B2 D1)', conflictVoter: VA, conflictVotes: 3, scope: 'current' },
      { label: 'STALE recipient (C is the one A3 B2 D1 would demote)', conflictVoter: VC, conflictVotes: 1, scope: 'stale' },
    ])(
      'AFLDB-ISSUE-244 I244-F007: refuses the WHOLE vote set (match_identity_conflict) before any write when a $label '
        + 'row already carries a different non-null match_id — nothing demoted, claimed, healed or logged',
      async ({ conflictVoter, conflictVotes, scope }) => {
        await resetBrownlowVotes();
        await settleVoteSet(versionABC());
        const resolvedMatchId = await canonicalMatchId(CASE_IDS.p);
        const conflictingMatchId = await canonicalMatchId(CASE_IDS.q);
        expect(conflictingMatchId).not.toBe(resolvedMatchId);
        await sql`
          UPDATE brownlow_round_votes SET match_id = ${conflictingMatchId}
           WHERE season = ${SEASON} AND player_id = ${voterPlayerIds[conflictVoter]} AND round_number = ${BROWNLOW_ROUND}
        `;
        const letter = VOTER_LETTERS[conflictVoter];
        expect((await matchIdsByVoter(CASE_IDS.p))[letter]).toBe(conflictingMatchId);

        const rowsBefore = await snapshotRows([VA, VB, VC, VD]);
        const matchIdsBefore = await matchIdsByVoter(CASE_IDS.p);
        const ledgerBefore = await brownlowLedgerCount(CASE_IDS.p);
        await plantCoverageSentinel();

        // A3 B2 D1: C leaves the positive set (stale), D joins, A and B are unchanged current recipients.
        const refused = await settleVoteSet(versionABD());
        expect(refused.halt).toBeNull();
        expect(refused.counters.voteSetsRefused).toEqual({ match_identity_conflict: 1 });
        expect(refused.counters.voteSetsApplyFailed).toBe(0); // refused before any write, not a write failure
        expect(refused.counters.voteSetsNoOp).toBe(0);
        expect(refused.counters.staleRecipientsDemoted).toBe(0);
        expect(refused.counters.canonicalRowsInserted).toBe(0);
        expect(refused.counters.canonicalRowsUpdated).toBe(0);
        expect(refused.counters.canonicalApplicationsLogged).toBe(0);
        expect(refused.counters.coverageRecomputeRuns).toBe(0); // a refused set alone never triggers the recompute
        await expectCoverageSentinelIntact();

        // Every row byte-for-byte as before — including the conflicting one — and no row for D.
        expect(await snapshotRows([VA, VB, VC, VD])).toEqual(rowsBefore);
        expect(await matchIdsByVoter(CASE_IDS.p)).toEqual(matchIdsBefore);
        expect((await matchIdsByVoter(CASE_IDS.p))[letter]).toBe(conflictingMatchId);
        expect(await ownedRowsByVoter(CASE_IDS.p)).toEqual({
          A: { votes: 3, played: true }, B: { votes: 2, played: true }, C: { votes: 1, played: true },
        });
        expect(await brownlowLedgerCount(CASE_IDS.p)).toBe(ledgerBefore);

        // One durable, distinctly-reasoned data issue naming provider match, existing and resolved ids.
        const issues = await openSettleIssues(CASE_IDS.p);
        expect(issues).toHaveLength(1);
        expect(issues[0].severity).toBe('error');
        expect(issues[0].details).toMatchObject({
          provider_match_id: CASE_IDS.p, source_record_id: CASE_IDS.p,
          reason: 'match_identity_conflict', resolved_match_id: resolvedMatchId,
          conflicts: [{
            player_id: voterPlayerIds[conflictVoter], votes: conflictVotes,
            existing_match_id: conflictingMatchId, resolved_match_id: resolvedMatchId,
            scope, afl_api_owned: true,
          }],
        });
        expect(issues[0].details).not.toHaveProperty('error');

        // A replay refreshes that one issue in place — never a second open issue.
        const replay = await settleVoteSet(versionABD());
        expect(replay.counters.voteSetsRefused).toEqual({ match_identity_conflict: 1 });
        expect(replay.counters.dataIssuesOpened).toBe(0);
        expect(replay.counters.dataIssuesRefreshed).toBe(1);
        expect(await openSettleIssues(CASE_IDS.p)).toHaveLength(1);
        expect(await snapshotRows([VA, VB, VC, VD])).toEqual(rowsBefore);
        expect(await brownlowLedgerCount(CASE_IDS.p)).toBe(ledgerBefore);
      },
      60_000,
    );

    it(
      'AFLDB-ISSUE-244 I244-F007: a foreign-owned row that borrows this provider match\'s source_record_id and a '
        + 'contradicting match_id is not "this set\'s" stale row — it neither blocks the set nor is touched by it',
      async () => {
        await resetBrownlowVotes();
        await settleVoteSet(versionABC());
        // F is owned by AFL Tables (foreign), positive, source_record_id = p, and claims match q. The stale
        // predicate (source_id = AFL API) never selects it; F is not a current recipient either, so the
        // conflict scan never reads it. The corrected A3 B2 D1 set therefore proceeds normally.
        const conflictingMatchId = await canonicalMatchId(CASE_IDS.q);
        await seedBrownlowRow({ voter: VF, votes: 2, sourceId: aflTablesSourceId, sourceRecordId: CASE_IDS.p });
        await sql`
          UPDATE brownlow_round_votes SET match_id = ${conflictingMatchId}
           WHERE season = ${SEASON} AND player_id = ${voterPlayerIds[VF]} AND round_number = ${BROWNLOW_ROUND}
        `;
        const foreignBefore = await snapshotRows([VF]);

        const swapped = await settleVoteSet(versionABD());
        expect(swapped.counters.voteSetsRefused).toEqual({});
        expect(swapped.counters.voteSetsApplyFailed).toBe(0);
        expect(swapped.counters.staleRecipientsDemoted).toBe(1); // C only
        await expectPositiveSetIs(CASE_IDS.p, ['A', 'B', 'D']);
        expect(await snapshotRows([VF])).toEqual(foreignBefore);
      },
      60_000,
    );
  });

  describe('AFLDB-ISSUE-244 I244-F008 — import_batches terminal lifecycle', () => {
    /** One applied vote set plus one genuinely unknown provider match, in a single run. */
    function appliedPlusRefusedRun(overrides: { apply: boolean; observeOnly: boolean }) {
      return runSettleAflApiBrownlow(sql, {
        registry, season: SEASON, matchVotes: [versionABC(), voteRecordFor(CASE_IDS.unknown)],
        leaderboard: [], leaderboardStatus: null, inProgressSeasons: [SEASON],
        autoApply: true, ...overrides,
      });
    }

    it(
      'a committed apply with one refused set leaves a terminal batch: records_rejected = the persisted '
        + 'import_rejections rows, validation_result = the run counters; an identical replay is a terminal zero-change batch',
      async () => {
        await resetBrownlowVotes();
        const run = await appliedPlusRefusedRun({ apply: true, observeOnly: false });
        expect(run.halt).toBeNull();
        expect(run.applied).toBe(true);
        expect(run.batchId).not.toBeNull();
        expect(run.counters.voteSetsApplyFailed).toBe(0);
        expect(run.counters.canonicalRowsInserted).toBe(3);
        expect(run.counters.voteSetsRefused).toEqual({ unknown_match: 1 });
        await expectPositiveSetIs(CASE_IDS.p, ['A', 'B', 'C']);

        const batch = await importBatchRow(run.batchId as string);
        expect(batch.status).toBe('completed');
        expect(batch.completed).toBe(true);
        expect(batch.completedAfterStart).toBe(true);
        expect(batch.recordsRead).toBe(2);
        // versions appended to the batch's own append-only target table; nothing there is "updated".
        expect(batch.recordsInserted).toBe(run.counters.versionsAppended);
        expect(batch.recordsUpdated).toBe(0);
        // The refused unknown_match set is the one committed import_rejections row.
        expect(batch.rejectionRows).toBe(1);
        expect(batch.recordsRejected).toBe(batch.rejectionRows);
        const rejections = await sql<{ sourceRecordId: string; reason: string }[]>`
          SELECT source_record_id AS "sourceRecordId", reason FROM import_rejections
           WHERE import_batch_id = ${run.batchId as string}::bigint
        `;
        expect(rejections).toEqual([{
          sourceRecordId: CASE_IDS.unknown, reason: 'brownlow_round_votes: unknown_match',
        }]);
        expect(batch.validationResult).toEqual(JSON.parse(JSON.stringify(run.counters)));

        // Identical replay: a distinct, terminal batch that reports no canonical change.
        const replay = await appliedPlusRefusedRun({ apply: true, observeOnly: false });
        expect(replay.applied).toBe(true);
        expect(replay.batchId).not.toBe(run.batchId);
        expect(replay.counters.canonicalRowsInserted).toBe(0);
        expect(replay.counters.canonicalRowsUpdated).toBe(0);
        expect(replay.counters.voteSetsNoOp).toBe(1);
        expect(replay.counters.versionsAppended).toBe(0);
        const replayBatch = await importBatchRow(replay.batchId as string);
        expect(replayBatch.status).toBe('completed');
        expect(replayBatch.completed).toBe(true);
        expect(replayBatch.completedAfterStart).toBe(true);
        expect(replayBatch.recordsInserted).toBe(0);
        expect(replayBatch.recordsUpdated).toBe(0);
        // The unknown set is refused (and rejected) again under the replay's own batch.
        expect(replayBatch.recordsRejected).toBe(replayBatch.rejectionRows);
        expect(replayBatch.validationResult).toMatchObject({
          canonicalRowsInserted: 0, canonicalRowsUpdated: 0, canonicalApplicationsLogged: 0, voteSetsNoOp: 1,
        });
      },
      60_000,
    );

    it(
      'a committed observe-only run is a committed batch and is terminal; it writes no import_rejections, so '
        + 'records_rejected is 0 even though the run counted a refused set',
      async () => {
        await resetBrownlowVotes();
        const run = await appliedPlusRefusedRun({ apply: true, observeOnly: true });
        expect(run.applied).toBe(true);
        expect(run.batchId).not.toBeNull();
        expect(run.counters.voteSetsRefused).toEqual({ unknown_match: 1 });
        expect(run.counters.canonicalRowsInserted).toBe(0);
        expect(await brownlowLedgerCount(CASE_IDS.p)).toBe(0);

        const batch = await importBatchRow(run.batchId as string);
        expect(batch.status).toBe('completed');
        expect(batch.completed).toBe(true);
        expect(batch.completedAfterStart).toBe(true);
        expect(batch.recordsRead).toBe(2);
        expect(batch.recordsInserted).toBe(run.counters.versionsAppended);
        expect(batch.recordsUpdated).toBe(0);
        // Observe-only writes the spine observation and nothing diagnostic (§10), so the
        // persisted-row metric is 0 while `voteSetsRefused` (a counter) is 1.
        expect(batch.rejectionRows).toBe(0);
        expect(batch.recordsRejected).toBe(0);
        expect(batch.validationResult).toEqual(JSON.parse(JSON.stringify(run.counters)));
      },
      60_000,
    );

    it(
      'a dry-run leaves no batch row, even though it ran the real finalising UPDATE',
      async () => {
        await resetBrownlowVotes();
        const before = await brownlowBatchCount();
        const dryRun = await appliedPlusRefusedRun({ apply: false, observeOnly: false });
        expect(dryRun.applied).toBe(false);
        expect(dryRun.batchId).toBeNull();
        expect(await brownlowBatchCount()).toBe(before);
        expect(await brownlowLedgerCount(CASE_IDS.p)).toBe(0);
      },
      60_000,
    );

    it(
      'a failure while finalising the batch rolls the whole run back — no batch, no vote rows, no ledger rows',
      async () => {
        await resetBrownlowVotes();
        const before = await brownlowBatchCount();
        await expect(runSettleAflApiBrownlow(sqlFailingOnBatchFinalisation(sql), {
          registry, season: SEASON, matchVotes: [versionABC()], leaderboard: [], leaderboardStatus: null,
          inProgressSeasons: [SEASON], apply: true, autoApply: true, observeOnly: false,
        })).rejects.toThrow(/injected batch finalisation failure/);

        // The vote writes, ledger rows and coverage recompute all preceded the failed
        // finalisation inside the same transaction, so none of them may have survived.
        expect(await brownlowBatchCount()).toBe(before);
        expect(await ownedRowsByVoter(CASE_IDS.p)).toEqual({});
        expect(await brownlowLedgerCount(CASE_IDS.p)).toBe(0);
      },
      60_000,
    );
  });

  it(
    'cleanup() self-heals a stale player_clubs pointer left by a crashed prior teardown '
      + '(one that deleted player_match_stats but never reached the recompute/DELETE FROM matches that follows '
      + 'it — the exact partial state a reported failed run left behind). Runs last: it deletes matches p and q '
      + 'outright, which every test above this one depends on existing.',
    async () => {
      const [matchP] = await sql<{ id: number }[]>`
        SELECT id FROM matches WHERE match_key = ${matchKeyFor(CASE_IDS.p)}
      `;
      const [matchQ] = await sql<{ id: number }[]>`
        SELECT id FROM matches WHERE match_key = ${matchKeyFor(CASE_IDS.q)}
      `;
      // both matches p and q must still exist at this point in the suite
      expect(matchP).toBeDefined();
      expect(matchQ).toBeDefined();
      const ids = [matchP.id, matchQ.id];

      // --- 1. Build the precondition ourselves (AFLDB-ISSUE-244 I244-F002 harness repair). ---
      // An earlier version of this test assumed `runSettleAflApi()` in the first
      // `it()` had already left SOME real player's `player_clubs` row pointing at
      // one of these matches, via whatever `afl_api` bridge row `CD_I297354` happens
      // to have on afldb_test. On a database with no such bridge row nothing was
      // left pointing at these matches and the precondition was simply false.
      // Instead, create a player this suite owns outright (no bridge row, no real
      // history), give them one stats row in each suite match, and let the SAME
      // production recompute the settle path uses derive their `player_clubs` row.
      const [owned] = await sql<{ id: number }[]>`
        INSERT INTO players (legacy_player_id, display_name, sort_name, search_name, slug, given_name, surname)
        VALUES (
          ${CLEANUP_REGRESSION_LEGACY_ID},
          'Cleanup Regression (ISSUE-244 F002 test fixture)',
          'CleanupRegression (ISSUE-244 F002 test fixture)',
          'cleanup regression issue244 f002 test fixture',
          'cleanup-regression-issue244-f002-test-fixture',
          'Cleanup', 'Issue244F002Test'
        )
        ON CONFLICT (legacy_player_id) DO UPDATE SET display_name = EXCLUDED.display_name
        RETURNING id
      `;
      await sql`
        INSERT INTO player_match_stats (player_id, match_id, club_id, goals)
        VALUES (${owned.id}, ${matchP.id}, ${homeClubId}, 1),
               (${owned.id}, ${matchQ.id}, ${homeClubId}, 1)
      `;
      await sql.begin((tx) => recomputePlayerDerivedStats(tx, [owned.id], SEASON));

      // Hard proof the setup worked: the owned player's derived row now carries
      // pointers into the suite's matches — first and last cover p and q between them.
      const beforeStale = await sql<{ playerId: number; firstMatchId: number; lastMatchId: number }[]>`
        SELECT player_id::int AS "playerId", first_match_id::int AS "firstMatchId", last_match_id::int AS "lastMatchId"
          FROM player_clubs
         WHERE first_match_id = ANY(${ids}::bigint[]) OR last_match_id = ANY(${ids}::bigint[])
      `;
      expect(beforeStale.length).toBeGreaterThan(0);
      const ownedBefore = beforeStale.filter((r) => r.playerId === owned.id);
      expect(ownedBefore).toHaveLength(1);
      expect([ownedBefore[0].firstMatchId, ownedBefore[0].lastMatchId].sort((a, b) => a - b))
        .toEqual([...ids].sort((a, b) => a - b));

      // --- 2. Simulate exactly the reported crash. ---
      // Delete the match-owned `player_match_stats`/`match_period_scores` rows
      // WITHOUT recomputing `player_clubs` afterwards, leaving its pointer(s)
      // dangling with no backing stats row left to rediscover the player from.
      await sql`DELETE FROM player_match_stats WHERE match_id = ANY(${ids}::bigint[])`;
      await sql`DELETE FROM match_period_scores WHERE match_id = ANY(${ids}::bigint[])`;

      // --- 3. Prove the stale state exists BEFORE cleanup(). ---
      // No stats row remains for either match (so `affectedPlayerIds()` cannot
      // rediscover anyone), yet the pointers survive unchanged.
      const [{ count: statsLeft }] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM player_match_stats WHERE match_id = ANY(${ids}::bigint[])
      `;
      expect(statsLeft).toBe('0');
      const stillStale = await sql<{ playerId: number; firstMatchId: number; lastMatchId: number }[]>`
        SELECT player_id::int AS "playerId", first_match_id::int AS "firstMatchId", last_match_id::int AS "lastMatchId"
          FROM player_clubs
         WHERE first_match_id = ANY(${ids}::bigint[]) OR last_match_id = ANY(${ids}::bigint[])
      `;
      const byPlayer = (a: { playerId: number }, b: { playerId: number }) => a.playerId - b.playerId;
      expect([...stillStale].sort(byPlayer)).toEqual([...beforeStale].sort(byPlayer));
      expect(stillStale.some((r) => r.playerId === owned.id)).toBe(true);

      // --- 4. Recovery. ---
      // The real cleanup() under test — this suite's own teardown, not a
      // hand-rolled repair — must rediscover the owned player from the stale
      // pointer alone, rebuild/drop their `player_clubs` row, and only then delete
      // both matches. `player_clubs.first_match_id`/`last_match_id` are RESTRICT
      // foreign keys, so `matchesLeft = 0` is only reachable if that happened.
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

      // Nothing suite-owned survives: not the synthetic player, nor any derived row of theirs.
      const [{ count: ownedPlayerLeft }] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM players WHERE legacy_player_id = ${CLEANUP_REGRESSION_LEGACY_ID}
      `;
      expect(ownedPlayerLeft).toBe('0');
      const [{ count: ownedRowsLeft }] = await sql<{ count: string }[]>`
        SELECT (
          (SELECT count(*) FROM player_match_stats WHERE player_id = ${owned.id})
          + (SELECT count(*) FROM player_clubs WHERE player_id = ${owned.id})
          + (SELECT count(*) FROM player_career_stats WHERE player_id = ${owned.id})
        )::text AS count
      `;
      expect(ownedRowsLeft).toBe('0');

      // Idempotent: a second teardown over the now-empty state is a safe no-op.
      await expect(cleanup()).resolves.toBeUndefined();
    },
    60_000,
  );
});
