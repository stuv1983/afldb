/**
 * AFLDB-ISSUE-228 S6 — the afl_api settle writer against real PostgreSQL.
 *
 * ISOLATION MODEL — COMMITTED FIXTURES, exactly as
 * `tests/integration/settle-afltables.test.ts` established and for the same
 * reason: `runSettleAflApi()` opens its OWN transaction, so the
 * outer-rollback-transaction pattern cannot wrap it. This suite commits
 * fixtures, commits its own settle output, and removes both afterwards.
 *
 * FIXTURE DATA is the REAL, already-validated sample at
 * `tests/fixtures/afl_api/match/*.json` (Hawthorn v Brisbane Lions, 2026
 * Preliminary Final, `CD_M20260142801`) — the same bytes `tests/afl-api-match.test.ts`
 * proves against the emitters DB-free. Reusing proven-valid bytes rather than
 * hand-built JSON is deliberate: every field the emitters require strictly
 * (round vocabulary, score arithmetic, cumulative period-score reproduction,
 * provider-id shapes) is already correct, so this suite only ever mutates the
 * one field each case is actually about. Every case gets its OWN provider
 * match id (`CD_M2026ISSUE228<n>`), so cases never share canonical rows.
 *
 * `clubs` (Hawthorn, Brisbane Lions) and `venues` (M.C.G.) are READ, never
 * written — real historical identities, exactly as `settle-afltables.test.ts`
 * reads two existing clubs rather than inventing any. `sources` rows for
 * `afl_api` (077) and `afltables` are READ, never written: both should
 * already exist on any correctly migrated `afldb_test`.
 *
 * COMMITTED BY THIS SUITE: one dedicated `players` row and one
 * `external_identities` bootstrap-bridge row (T1, §6.3) for the ONE player
 * this suite resolves; every settle-produced row (import_batches, the
 * migration-074 spine, the migration-103 typed projections,
 * `promotion_candidates`, `canonical_applications`, `matches`,
 * `match_period_scores`, `player_match_stats`, `data_issues`); and, for the
 * corroboration/enrichment cases, one `afltables`-owned `matches` fixture row
 * plus a `staging.afltables_match` row. Cleanup runs BEFORE setup as well as
 * in `afterAll`, exactly as the established pattern requires.
 *
 * @see src/lib/acquisition/settle-afl-api.ts
 * @see issues/open/AFLDB-ISSUE-228.md §16 S6, §19
 */
import './guard';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  parseAflApiIdentities, type AflApiIdentities,
} from '@/lib/acquisition/afl-api-bundle';
import {
  buildAflApiSettleBundle,
  runSettleAflApi,
  type AflApiSettleBundle,
  type AflApiSettleUnitSource,
} from '@/lib/acquisition/settle-afl-api';
import { renderMatchKey } from '@/lib/acquisition/settle-core';
import {
  getSourceFamily,
  parseSourceFamilyRegistry,
  type SourceFamilyRegistry,
} from '@/lib/acquisition/source-families';

const PROJECT_ROOT = join(__dirname, '..', '..');
const FIXTURE_DIR = join(PROJECT_ROOT, 'tests', 'fixtures', 'afl_api', 'match');

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8'));
}

/** Deep clone via JSON round-trip — every fixture here is plain JSON. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const REAL_MATCH_ID = 'CD_M20260142801';
/** This suite's own namespace. Appears nowhere else in the repository. */
const NS = 'CD_M2026ISSUE228';
const SEASON = 2026;
const HOME_HIST = 'Hawthorn';
const AWAY_HIST = 'Brisbane Lions';
const BRIDGED_PROVIDER_PLAYER_ID = 'CD_I297354'; // Karl Amon, home side, in the fixture
const UNBRIDGED_PROVIDER_PLAYER_ID = 'CD_I500001'; // "Test Forward", away side — deliberately never bridged

/**
 * One match unit's three raw payloads, cloned from the proven-valid fixture
 * and renamed onto a dedicated provider match id AND a dedicated match DATE.
 *
 * WHY THE DATE MOVES PER CASE. `matches.match_key` is `NOT NULL UNIQUE`
 * (003:23) and is rendered as `season|round_code|match_date|home name|away
 * name` (`renderMatchKey()`) — the provider match id is NOT a component of
 * it. So renaming the provider id alone leaves every case of this suite
 * denoting ONE canonical match. That is what an earlier draft did, and the
 * consequences were not subtle: each case resolved onto the previous case's
 * row at §6.1 step 2 instead of creating its own, so the "new match" and
 * "idempotent rerun" cases proposed no change at all; the provider id was
 * never linked to a row, so the §14 contradiction case could not HALT; and
 * `afl_api_player_match_grain_uq (source_id, provider_player_id, match_key)`
 * (103:368) was violated the moment a second case projected the same player
 * against the same shared key. Giving each case its own real-world identity
 * fixes all of them at the source rather than per symptom.
 *
 * Both halves of the local date/time are moved together. §11.1's cross-check
 * (`deriveAflApiLocalMatchDateTime()`) proves the canonical local date ONLY
 * when the roster's `venueLocalStartTime` equals the match family's own
 * `utcStartTime` converted to `venue.timezone`, and an outright disagreement
 * is a hard `local_time_contradiction` failure — so moving one without the
 * other would not merely be sloppy, it would refuse the unit. `07:15:00Z` ->
 * `17:15:00` is `Australia/Melbourne` at AEST (UTC+10); every date below is
 * in September 2026, before daylight saving begins on 4 October, so the one
 * offset is correct for all of them.
 *
 * `venueLocalStartTime` must be ADDED at all: the real fixture omits it
 * (§11.1 "known-but-not-required"), which would otherwise leave
 * `bundle.localMatchDateTime` null and refuse every case with
 * `unproved_match_date`.
 */
function unitSourceFor(providerMatchId: string, mutate?: (raw: {
  fixture: Record<string, any>; roster: Record<string, any>; stats: Record<string, any>;
}) => void): AflApiSettleUnitSource {
  const fixture = clone(readFixture('01-fixture-result.json')) as Record<string, any>;
  const roster = clone(readFixture('03-match-roster.raw.json')) as Record<string, any>;
  const stats = clone(readFixture('02-player-stats.raw.json')) as Record<string, any>;
  const matchDate = matchDateFor(providerMatchId);

  fixture.providerId = providerMatchId;
  fixture.utcStartTime = `${matchDate}T07:15:00.000+0000`;
  roster.match.matchId = providerMatchId;
  roster.match.venueLocalStartTime = `${matchDate}T17:15:00`;
  roster.matchRoster.matchId = providerMatchId;
  roster.matchRoster.homeTeam.matchId = providerMatchId;
  roster.matchRoster.awayTeam.matchId = providerMatchId;
  roster.recentMatchScores[0].matchId = providerMatchId;

  if (mutate) mutate({ fixture, roster, stats });

  return { fixtureRaw: fixture, rosterRaw: roster, playerStatsRaw: stats };
}

function buildBundle(
  sources: readonly AflApiSettleUnitSource[], registry: SourceFamilyRegistry, identities: AflApiIdentities,
): AflApiSettleBundle {
  const bundle = buildAflApiSettleBundle({
    season: SEASON, snapshotLabel: 'issue228-integration', sources, registry, identities,
  });
  expect(bundle.buildFailures).toEqual([]);
  return bundle;
}

/* ------------------------------------------------------------------ *
 * Fixture setup / teardown
 * ------------------------------------------------------------------ */

const sql = postgres(process.env.AFLDB_TEST_DATABASE_URL as string, { max: 1, onnotice: () => {} });

let registry: SourceFamilyRegistry;
let identities: AflApiIdentities;
let aflApiSourceId: number;
let afltablesSourceId: number;
let homeClubId: number;
let awayClubId: number;
/** The canonical `clubs.name` for each side — what `renderMatchKey()` uses. */
let homeClubName: string;
let awayClubName: string;
let venueId: number;
let bridgedPlayerId: number;

/**
 * The synthetic player's canonical key. `players` (migration 002) has NO
 * `first_name`/`last_name` columns — its identity/name shape is `id`
 * (identity PK), `legacy_player_id` (nullable, UNIQUE — the legacy-database
 * parity key), `display_name`/`sort_name`/`search_name`/`slug` (all NOT
 * NULL) and `given_name`/`surname` (nullable, display-only). A real
 * `legacy_player_id` is always a positive legacy-database id, so a negative,
 * namespaced value can never collide with one and gives cleanup a
 * deterministic lookup key that survives across process restarts — unlike
 * the in-memory `bridgedPlayerId`, which is unset on a fresh run picking up
 * an interrupted earlier run's leftover row.
 */
const SYNTHETIC_PLAYER_LEGACY_ID = -228000001;

const CASE_IDS = {
  golden: `${NS}A`,
  rerun: `${NS}B`,
  contradiction: `${NS}C`,
  corroborateAgree: `${NS}D`,
  corroborateDisagree: `${NS}E`,
  enrichment: `${NS}F`,
} as const;
const ALL_PROVIDER_IDS = Object.values(CASE_IDS);

/**
 * One dedicated match DATE per case — the component that actually makes each
 * case its own canonical match (see `unitSourceFor()`'s comment; the provider
 * id is not part of `match_key` at all).
 *
 * Every date is a September 2026 Monday, Tuesday or Wednesday. No AFL match
 * is ever played mid-week in the finals series, so none of these keys can
 * collide with a real fixture that an AFL Tables settle may already have
 * written to `afldb_test` — which matters because `matches.match_key` is
 * UNIQUE and a collision would silently turn a "new match" case into a
 * corroboration against somebody else's row.
 */
const CASE_DATES: Readonly<Record<string, string>> = {
  [CASE_IDS.golden]: '2026-09-21',
  [CASE_IDS.rerun]: '2026-09-22',
  [CASE_IDS.contradiction]: '2026-09-23',
  [CASE_IDS.corroborateAgree]: '2026-09-28',
  [CASE_IDS.corroborateDisagree]: '2026-09-29',
  [CASE_IDS.enrichment]: '2026-09-30',
};

function matchDateFor(providerMatchId: string): string {
  const date = CASE_DATES[providerMatchId];
  if (!date) throw new Error(`No CASE_DATES entry for provider match id '${providerMatchId}'.`);
  return date;
}

/**
 * The exact `match_key` a case's unit resolves to, rendered by the SAME
 * function the writer itself uses (`renderMatchKey()`, settle-core.ts) over
 * the SAME inputs: the canonical `clubs.name`, never `legacy_club_hist`.
 *
 * The two happen to coincide for Hawthorn and Brisbane Lions, so an earlier
 * draft's hand-joined string worked by luck; rendering it properly means this
 * suite cannot drift from `match_key_of()`'s algorithm for any other club.
 * Depends on `beforeAll` having read the club names, so every caller — and
 * `allMatchKeys()` — is evaluated inside a hook or a test, never at module
 * load.
 */
function matchKeyFor(providerMatchId: string): string {
  if (!homeClubName || !awayClubName) {
    throw new Error('matchKeyFor() was called before beforeAll() resolved the canonical club names.');
  }
  return renderMatchKey(SEASON, 'PF', matchDateFor(providerMatchId), homeClubName, awayClubName);
}

/** Every match_key this suite's cases may create, for cleanup by exact key. */
function allMatchKeys(): string[] {
  return ALL_PROVIDER_IDS.map((id) => matchKeyFor(id));
}

/**
 * Remove every row this suite can create, and nothing else.
 *
 * The deletion order below is the REVERSE of the real foreign-key graph, and
 * the graph is taken from the migrations rather than discovered one failure at
 * a time. Nine tables reference
 * `staging.source_record_versions (source_id, family, external_record_id,
 * version_seq)`: `staging.source_records` (074:125), `promotion_candidates`
 * (074:178), `canonical_applications` (083:103), `staging.afltables_match`
 * (076:117), `staging.afltables_player_match` (076:316),
 * `staging.afl_api_lineup` (077:197), and `staging.afl_api_match` /
 * `staging.afl_api_player_match` / `staging.afl_api_brownlow_vote` (103:172,
 * 103:360, 103:488). This suite writes five of the nine —
 * afltables_player_match, afl_api_lineup and afl_api_brownlow_vote are never
 * touched by it — and every one of the five is cleared below BEFORE the
 * version rows they cite.
 */
async function cleanup(): Promise<void> {
  const matchKeys = allMatchKeys();
  const matchIds = await sql<{ id: number }[]>`
    SELECT id FROM matches WHERE match_key = ANY(${matchKeys}::text[])
  `;
  const ids = matchIds.map((r) => r.id);

  // `player_clubs` (migration 007, DERIVED) carries `first_match_id`/
  // `last_match_id REFERENCES matches(id)` with NO `ON DELETE` clause
  // (default RESTRICT) — `recomputePlayerDerivedStats()` (called by the
  // writer on every autoApply run that touches this player) writes a row
  // here keyed on the synthetic player, and it MUST be gone before any of
  // this suite's `matches` rows are deleted below, or that DELETE fails
  // closed with a foreign-key violation. Looked up by `legacy_player_id`,
  // never by the in-memory `bridgedPlayerId`, for the same leftover-run
  // reason the constant's own comment gives. `player_clubs.player_id`
  // itself IS `ON DELETE CASCADE` (007:129), so this is the only explicit
  // statement this table needs.
  await sql`
    DELETE FROM player_clubs
     WHERE player_id IN (SELECT id FROM players WHERE legacy_player_id = ${SYNTHETIC_PLAYER_LEGACY_ID})
  `;

  if (ids.length > 0) {
    await sql`DELETE FROM player_match_stats WHERE match_id = ANY(${ids}::bigint[])`;
    await sql`DELETE FROM match_period_scores WHERE match_id = ANY(${ids}::bigint[])`;
  }
  // canonical_applications carries a FOREIGN KEY to
  // staging.source_record_versions (source_id, family, external_record_id,
  // source_version_seq) — migration 083:103-104 — so EVERY ledger row this
  // suite produces must be gone before the version rows below, or that DELETE
  // fails closed and the whole teardown aborts part-way, leaving the next run
  // to trip over the remains.
  //
  // This suite writes ledger rows under THREE different external_record_id
  // shapes, and an earlier draft deleted only the first:
  //   1. the match family's own provider id, `<NS><case>`;
  //   2. the player family's COMPOSITE id, `<NS><case>|<CD_T…>|<CD_I…>` —
  //      matched by no equality against ALL_PROVIDER_IDS, and by no
  //      target_table = 'matches' filter either, since these rows target
  //      player_match_stats. These were what actually survived and broke
  //      teardown;
  //   3. the attendance-enrichment row, whose external_record_id is the
  //      afltables MATCH KEY (applyAttendanceEnrichment() writes the enriching
  //      source's own identity, and afltables' match family is keyed by
  //      match_key — import_fitzroy_core.py:1260-1263).
  // The LIKE covers 1 and 2 together; 3 is deleted by key, scoped to the
  // afltables source so no other suite's ledger row can be in range.
  await sql`DELETE FROM canonical_applications WHERE external_record_id LIKE ${`${NS}%`}`;
  await sql`
    DELETE FROM canonical_applications
     WHERE source_id = ${afltablesSourceId} AND external_record_id = ANY(${matchKeys}::text[])
  `;
  await sql`
    DELETE FROM canonical_applications
     WHERE target_table = 'matches' AND target_key->>'match_key' = ANY(${matchKeys}::text[])
  `;
  await sql`DELETE FROM promotion_candidates WHERE external_record_id LIKE ${`${NS}%`}`;
  await sql`DELETE FROM data_issues WHERE issue_key LIKE ${`%${NS}%`}`;
  await sql`DELETE FROM import_rejections WHERE source_record_id LIKE ${`${NS}%`}`;
  if (ids.length > 0) await sql`DELETE FROM matches WHERE id = ANY(${ids}::bigint[])`;

  await sql`DELETE FROM staging.afl_api_player_match WHERE provider_match_id LIKE ${`${NS}%`}`;
  await sql`DELETE FROM staging.afl_api_match WHERE external_record_id LIKE ${`${NS}%`}`;
  // staging.afltables_match (migration 076) carries NO match_key column — its
  // grain is (source_id, family, external_record_id), and for the afltables
  // `match` family that external_record_id IS the match_key
  // (import_fitzroy_core.py:1260-1263 joins
  // season|round_code|match_date|clubs.name_of(home)|clubs.name_of(away),
  // which is renderMatchKey() exactly). So this suite's own AFL Tables fixture
  // row for the §19.2 enrichment case is identified by key, scoped to the
  // afltables source, and no other afltables staging row is in range.
  await sql`
    DELETE FROM staging.afltables_match
     WHERE source_id = ${afltablesSourceId} AND external_record_id = ANY(${matchKeys}::text[])
  `;
  // Deletion order is child-to-parent along the two FKs 074 declares:
  // staging.source_records.(source_id, family, external_record_id,
  // current_version_seq) REFERENCES staging.source_record_versions(...)
  // (source_records is the CHILD), and
  // staging.source_record_versions.(source_id, family, payload_hash)
  // REFERENCES staging.source_payloads(...) (source_record_versions is the
  // CHILD of source_payloads). So: source_records first, then
  // source_record_versions, then source_payloads below — never the reverse,
  // which would delete a still-referenced parent row.
  //
  // Two identity shapes, each scoped to the one source that can own it: the
  // afl_api rows (match and the composite player ids, both NS-prefixed) and
  // the afltables enrichment-fixture rows (keyed by match_key, see above).
  //
  // The payload hashes are captured BEFORE the version rows citing them are
  // deleted, because that is the only way to name this suite's afl_api
  // payloads precisely: `persistSourceObservation()` derives the hash from the
  // payload bytes, so no caller can predict it. The earlier form — delete
  // every payload of this source that no surviving version references — was a
  // broad delete that would also remove any OTHER suite's orphaned payload
  // that happened to be present.
  const doomedPayloads = await sql<{ sourceId: number; family: string; payloadHash: string }[]>`
    SELECT DISTINCT source_id AS "sourceId", family, payload_hash AS "payloadHash"
      FROM staging.source_record_versions
     WHERE (source_id = ${aflApiSourceId} AND external_record_id LIKE ${`${NS}%`})
        OR (source_id = ${afltablesSourceId} AND external_record_id = ANY(${matchKeys}::text[]))
  `;
  await sql`
    DELETE FROM staging.source_records
     WHERE (source_id = ${aflApiSourceId} AND external_record_id LIKE ${`${NS}%`})
        OR (source_id = ${afltablesSourceId} AND external_record_id = ANY(${matchKeys}::text[]))
  `;
  await sql`
    DELETE FROM staging.source_record_versions
     WHERE (source_id = ${aflApiSourceId} AND external_record_id LIKE ${`${NS}%`})
        OR (source_id = ${afltablesSourceId} AND external_record_id = ANY(${matchKeys}::text[]))
  `;
  // A payload is shared by every version carrying identical bytes, so each one
  // is removed only once nothing cites it any more.
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
  // This suite's own two import_batches notes: its own runs
  // ('issue228-integration', from buildBundle's snapshotLabel) and the
  // hand-inserted AFL Tables fixture batch for the §19.2 enrichment case.
  await sql`
    DELETE FROM import_batches
     WHERE notes LIKE ${'%issue228-integration%'} OR notes LIKE ${'%issue228-enrichment-fixture%'}
  `;
  // external_identities.player_id -> players(id) has no ON DELETE clause
  // (default RESTRICT, migration 002:184), so this must run before the
  // players delete below.
  await sql`DELETE FROM external_identities WHERE source_id = ${aflApiSourceId} AND external_id = ${BRIDGED_PROVIDER_PLAYER_ID}`;
  await sql`DELETE FROM players WHERE legacy_player_id = ${SYNTHETIC_PLAYER_LEGACY_ID}`;
}

beforeAll(async () => {
  registry = parseSourceFamilyRegistry(
    JSON.parse(readFileSync(join(PROJECT_ROOT, 'data', 'reference', 'source-families.json'), 'utf8')),
  );
  identities = parseAflApiIdentities(
    JSON.parse(readFileSync(join(PROJECT_ROOT, 'data', 'reference', 'afl-api-identities.json'), 'utf8')),
  );
  getSourceFamily(registry, 'afl_api', 'match'); // fails loudly if the registry is somehow not this repo's

  const [afl] = await sql<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afl_api'`;
  const [aft] = await sql<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afltables'`;
  if (!afl || !aft) {
    throw new Error("sources 'afl_api' (migration 077) and 'afltables' must both exist on afldb_test.");
  }
  aflApiSourceId = afl.id;
  afltablesSourceId = aft.id;

  const [home] = await sql<{ id: number; name: string }[]>`SELECT id, name FROM clubs WHERE legacy_club_hist = ${HOME_HIST}`;
  const [away] = await sql<{ id: number; name: string }[]>`SELECT id, name FROM clubs WHERE legacy_club_hist = ${AWAY_HIST}`;
  const [venue] = await sql<{ id: number }[]>`SELECT id FROM venues WHERE legacy_name = 'M.C.G.'`;
  if (!home || !away || !venue) {
    throw new Error('Hawthorn, Brisbane Lions and M.C.G. must all exist on afldb_test (real historical identities).');
  }
  homeClubId = home.id;
  awayClubId = away.id;
  // Read, never assumed: renderMatchKey() keys on clubs.name, and this suite
  // must render the identical string the writer does.
  homeClubName = home.name;
  awayClubName = away.name;
  venueId = venue.id;

  await cleanup();

  // players (migration 002): display_name/sort_name/search_name/slug are all
  // NOT NULL with no default; there is no first_name/last_name. Upserted on
  // the synthetic legacy_player_id so a rerun after an interrupted process
  // (which left the row behind, `cleanup()` above already having removed it
  // by the same key) is idempotent rather than failing on a stray unique
  // constraint.
  const [player] = await sql<{ id: number }[]>`
    INSERT INTO players (legacy_player_id, display_name, sort_name, search_name, slug, given_name, surname)
    VALUES (
      ${SYNTHETIC_PLAYER_LEGACY_ID},
      'Karl Amon (ISSUE-228 test fixture)',
      'Amon (ISSUE-228 test fixture), Karl',
      'karl amon issue228 test fixture',
      'karl-amon-issue228-test-fixture',
      'Karl', 'Amon-Issue228Test'
    )
    ON CONFLICT (legacy_player_id) DO UPDATE SET display_name = EXCLUDED.display_name
    RETURNING id
  `;
  bridgedPlayerId = player.id;
  await sql`
    INSERT INTO external_identities (source_id, external_id, status, match_method, player_id)
    VALUES (${aflApiSourceId}, ${BRIDGED_PROVIDER_PLAYER_ID}, 'unique', 'afl_api_stat_vector_bootstrap', ${bridgedPlayerId})
    ON CONFLICT DO NOTHING
  `;
}, 30_000);

afterAll(async () => {
  await cleanup();
  await sql.end({ timeout: 5 });
}, 30_000);

/* ------------------------------------------------------------------ *
 * Canonical state snapshot (§19 idempotency)
 * ------------------------------------------------------------------ */

type CanonicalSnapshot = {
  match: Record<string, unknown> | null;
  periods: Record<string, unknown>[];
  playerStats: Record<string, unknown>[];
  applications: string;
  candidates: string;
};

/**
 * Everything canonical one match owns, captured whole.
 *
 * `to_jsonb(row)` rather than a hand-picked column list is the point: it
 * captures EVERY column, including the provenance quartet and `matches`'
 * `imported_at`, which `writeMatch()` bumps on any UPDATE. So comparing two
 * snapshots proves the rows were not touched at all, rather than proving that
 * the few fields someone thought to list still agree.
 *
 * An aggregate counter cannot make that statement. The rerun defect this
 * guards against — `career_game_no` written back to NULL by the settle and
 * renumbered again by `recomputePlayerDerivedStats()` — showed up as
 * `canonicalRowsUpdated = 1` and was invisible in every other assertion the
 * suite made; had the counter itself ever been miscounted, nothing here would
 * have noticed. The ledger and candidate counts are included for the rest of
 * the §19 contract: no duplicate `canonical_applications` row, and no
 * duplicate `promotion_candidates` row, on an identical observation.
 */
async function canonicalSnapshot(
  matchKey: string, providerMatchId: string,
): Promise<CanonicalSnapshot> {
  const [match] = await sql<{ row: Record<string, unknown> }[]>`
    SELECT to_jsonb(m) AS row FROM matches m WHERE m.match_key = ${matchKey}
  `;
  const periods = await sql<{ row: Record<string, unknown> }[]>`
    SELECT to_jsonb(p) AS row
      FROM match_period_scores p
      JOIN matches m ON m.id = p.match_id
     WHERE m.match_key = ${matchKey}
     ORDER BY p.club_id, p.period
  `;
  const playerStats = await sql<{ row: Record<string, unknown> }[]>`
    SELECT to_jsonb(s) AS row
      FROM player_match_stats s
      JOIN matches m ON m.id = s.match_id
     WHERE m.match_key = ${matchKey}
     ORDER BY s.player_id
  `;
  // Both families this case writes are covered by one prefix: the match
  // family's external_record_id IS the provider match id, and the player
  // family's is that id followed by '|<CD_T…>|<CD_I…>'.
  const [applications] = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM canonical_applications
     WHERE external_record_id LIKE ${`${providerMatchId}%`}
  `;
  const [candidates] = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM promotion_candidates
     WHERE external_record_id LIKE ${`${providerMatchId}%`}
  `;
  return {
    match: match?.row ?? null,
    periods: periods.map((r) => r.row),
    playerStats: playerStats.map((r) => r.row),
    applications: applications.count,
    candidates: candidates.count,
  };
}

/* ------------------------------------------------------------------ *
 * Cases
 * ------------------------------------------------------------------ */

describe('AFLDB-ISSUE-228 S6 — settle-afl-api.ts against afldb_test', () => {
  it('§19: a new CONCLUDED match auto-applies match, period scores and the bridged player; the unbridged player is refused without blocking it', async () => {
    const bundle = buildBundle(
      [unitSourceFor(CASE_IDS.golden)], registry, identities,
    );
    const result = await runSettleAflApi(sql, {
      bundle, registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    });

    expect(result.halt).toBeNull();
    expect(result.applied).toBe(true);
    // `applied` alone proves almost nothing about the canonical write. A
    // per-unit constraint failure is ABSORBED by applyCanonicalUnit() (§9.1:
    // one bad match never stops the run) and an authority refusal routes the
    // proposal to promotion_candidates instead — BOTH leave `applied === true`
    // with a committed batch and nothing canonical written, and the only trace
    // of either is a counter. Asserting them here is what turns "the writer
    // silently wrote nothing" from a puzzle into a named failure.
    expect(result.counters.canonicalApplyFailures).toBe(0);
    expect(result.counters.manualAuthorityRefusals).toBe(0);
    expect(result.counters.canonicalRowsInserted).toBeGreaterThan(0);
    expect(result.counters.unresolvedIdentityPlayer).toBe(1);

    const [match] = await sql<{
      id: number; sourceId: number; homeScore: number; awayScore: number;
      attendance: number | null; attendanceStatus: string;
    }[]>`
      SELECT id, source_id AS "sourceId", home_score AS "homeScore", away_score AS "awayScore",
             attendance, attendance_status AS "attendanceStatus"
        FROM matches WHERE match_key = ${matchKeyFor(CASE_IDS.golden)}
    `;
    expect(match).toBeDefined();
    expect(match.sourceId).toBe(aflApiSourceId);
    expect(match.homeScore).toBe(122);
    expect(match.awayScore).toBe(131);
    expect(match.attendance).toBeNull();
    expect(match.attendanceStatus).toBe('not_collected');

    const periods = await sql<{ period: number; points: number }[]>`
      SELECT period, points FROM match_period_scores WHERE match_id = ${match.id} AND club_id = ${homeClubId} ORDER BY period
    `;
    expect(periods.map((p) => p.points)).toEqual([31, 67, 77, 122]);

    const [playerRow] = await sql<{ kicks: number; contestedMarks: number }[]>`
      SELECT kicks, contested_marks AS "contestedMarks" FROM player_match_stats
       WHERE match_id = ${match.id} AND player_id = ${bridgedPlayerId}
    `;
    expect(playerRow).toBeDefined();
    expect(playerRow.kicks).toBe(9);

    const [rejection] = await sql<{ reason: string }[]>`
      SELECT reason FROM import_rejections
       WHERE source_record_id = ${`${CASE_IDS.golden}|CD_T20|${UNBRIDGED_PROVIDER_PLAYER_ID}`}
    `;
    expect(rejection?.reason).toContain('unresolved_identity');
  });

  it('§19: an identical rerun is idempotent — no new canonical writes', async () => {
    const source = unitSourceFor(CASE_IDS.rerun);
    const first = await runSettleAflApi(sql, {
      bundle: buildBundle([source], registry, identities),
      registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    });
    expect(first.applied).toBe(true);
    expect(first.counters.canonicalApplyFailures).toBe(0);
    expect(first.counters.manualAuthorityRefusals).toBe(0);
    expect(first.counters.canonicalRowsInserted).toBeGreaterThan(0);

    const matchKey = matchKeyFor(CASE_IDS.rerun);
    const before = await canonicalSnapshot(matchKey, CASE_IDS.rerun);
    expect(before.match).not.toBeNull();
    expect(before.playerStats).toHaveLength(1);
    // The derived layer owns this column and has already filled it in, inside
    // the first run's own transaction (recomputePlayerDerivedStats()). The
    // settle proposes NULL for it and must never write that back — which is
    // exactly what the equality below now proves. Asserted as "not null"
    // rather than as a literal, because the recompute numbers a player's
    // matches by date across every case in this suite.
    expect(before.playerStats[0].career_game_no).not.toBeNull();

    const second = await runSettleAflApi(sql, {
      bundle: buildBundle([unitSourceFor(CASE_IDS.rerun)], registry, identities),
      registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    });
    expect(second.applied).toBe(true);
    expect(second.counters.canonicalRowsInserted).toBe(0);
    expect(second.counters.canonicalRowsUpdated).toBe(0);
    expect(second.counters.canonicalApplyFailures).toBe(0);
    expect(second.counters.canonicalApplicationsLogged).toBe(0);

    // The real contract: the canonical rows themselves are untouched —
    // matches, its period-score set and its player_match_stats row, every
    // column of each, plus no new ledger row and no duplicate candidate.
    const after = await canonicalSnapshot(matchKey, CASE_IDS.rerun);
    expect(after).toEqual(before);

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM matches WHERE match_key = ${matchKey}
    `;
    expect(count).toBe('1');
  });

  it('§14: a provider-id hit whose season/clubs contradict the incoming record HALTs the whole run', async () => {
    const providerId = CASE_IDS.contradiction;
    const first = await runSettleAflApi(sql, {
      bundle: buildBundle([unitSourceFor(providerId)], registry, identities),
      registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    });
    expect(first.applied).toBe(true);
    // The HALT under test is only reachable if this first run actually created
    // the canonical row AND stamped it with this provider id: step 1 of §6.1
    // looks the contradiction up by (source_id, source_record_id), which
    // `provenance()` writes in canonical-apply.ts. A first run that wrote
    // nothing leaves nothing to contradict, and the second run below would
    // then resolve as an ordinary new match with `halt === null` — passing
    // through the very gate this case exists to prove.
    expect(first.counters.canonicalRowsInserted).toBeGreaterThan(0);
    const batchesBefore = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM import_batches`;

    // Same provider id, now claiming a different away club — a genuine
    // provider-identity contradiction against the row this run just created.
    const contradicting = unitSourceFor(providerId, ({ fixture, stats }) => {
      fixture.away.team.providerId = 'CD_T10'; // Adelaide, not Brisbane Lions
      fixture.away.team.name = 'Adelaide Crows';
      for (const row of stats.awayTeamPlayerStats) row.teamId = 'CD_T10';
    });
    const second = await runSettleAflApi(sql, {
      bundle: buildBundle([contradicting], registry, identities),
      registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    });

    expect(second.halt).not.toBeNull();
    expect(second.halt?.reason).toBe('provider_identity_contradiction');
    expect(second.applied).toBe(false);
    expect(second.batchId).toBeNull();

    const batchesAfter = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM import_batches`;
    expect(batchesAfter[0].count).toBe(batchesBefore[0].count); // the HALTed run's own batch row did not survive
  });

  it('§19.1: an afltables-owned match observed by afl_api with agreeing scores is corroborated, not written, ownership unchanged', async () => {
    const providerId = CASE_IDS.corroborateAgree;
    const matchKey = matchKeyFor(providerId);
    const [ownedMatch] = await sql<{ id: number }[]>`
      INSERT INTO matches (
        match_key, season, round_code, round_number, round_type, is_final,
        match_date, venue_id, venue_raw, home_club_id, away_club_id,
        home_goals, home_behinds, home_score, away_goals, away_behinds, away_score,
        result, winner_club_id, margin,
        attendance, attendance_status, attendance_source_id,
        source_id, source_record_id
      ) VALUES (
        -- matches_round_number_ck (003) requires round_number NULL for every
        -- round_type other than 'home_and_away' — a finals round_number is
        -- carried in round_code alone. staging.afltables_match has no such
        -- constraint (076), which is why the equivalent fixture row for the
        -- §19.2 enrichment case below is free to set round_number = 28.
        ${matchKey}, ${SEASON}, 'PF', ${null}, 'preliminary_final', true,
        ${matchDateFor(providerId)}, ${venueId}, 'MCG', ${homeClubId}, ${awayClubId},
        19, 8, 122, 20, 11, 131,
        'away_win', ${awayClubId}, 9,
        NULL, 'not_collected', NULL,
        ${afltablesSourceId}, ${providerId}
      ) RETURNING id
    `;

    const result = await runSettleAflApi(sql, {
      bundle: buildBundle([unitSourceFor(providerId)], registry, identities),
      registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    });

    expect(result.halt).toBeNull();
    expect(result.counters.corroboratedForeignOwned).toBe(1);
    expect(result.counters.canonicalApplyRefusals).toBe(0);

    const [after] = await sql<{ sourceId: number; homeScore: number }[]>`
      SELECT source_id AS "sourceId", home_score AS "homeScore" FROM matches WHERE id = ${ownedMatch.id}
    `;
    expect(after.sourceId).toBe(afltablesSourceId); // never re-owned
    expect(after.homeScore).toBe(122); // never touched
  });

  it('§19.2: AFL Tables attendance enriches an afl_api-owned match without changing its ownership', async () => {
    const providerId = CASE_IDS.enrichment;
    const matchKey = matchKeyFor(providerId);

    const first = await runSettleAflApi(sql, {
      bundle: buildBundle([unitSourceFor(providerId)], registry, identities),
      registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    });
    expect(first.applied).toBe(true);
    const [owned] = await sql<{ id: number; sourceId: number }[]>`
      SELECT id, source_id AS "sourceId" FROM matches WHERE match_key = ${matchKey}
    `;
    expect(owned.sourceId).toBe(aflApiSourceId);

    const [batch] = await sql<{ id: string }[]>`
      INSERT INTO import_batches (source_id, tool, target_table, records_read, notes)
      VALUES (${afltablesSourceId}, 'settle-afltables.ts', 'staging.source_record_versions', 1, 'issue228-enrichment-fixture')
      RETURNING id
    `;
    // Insert order matches the real FK chain (074): source_payloads has no
    // dependency and must exist first; source_record_versions references it
    // (source_id, family, payload_hash) and import_batches (opened_by_batch_id);
    // source_records references source_record_versions
    // (source_id, family, external_record_id, current_version_seq) last. The
    // original draft inserted source_records first, which would have failed
    // closed with a foreign-key violation against a version row that did not
    // exist yet — caught here before it could ship.
    //
    // THE SPINE ROWS ARE KEYED BY match_key, NOT BY THE PROVIDER MATCH ID.
    // These stand in for AFL TABLES' own observation, and that source's
    // `match` family is keyed by `season|round_code|match_date|home name|away
    // name` (import_fitzroy_core.py:1260-1263) — the same string
    // renderMatchKey() produces. It matters because
    // applyAttendanceEnrichment() writes its canonical_applications row with
    // `external_record_id = matchKey` and `source_id = <afltables>`, and that
    // ledger row's FK resolves against exactly these version rows. Keying the
    // fixture by the afl_api provider id (as an earlier draft did) leaves the
    // FK unsatisfiable, so the enrichment throws instead of applying — a
    // failure the grain-uniqueness violation upstream was masking.
    await sql`
      INSERT INTO staging.source_payloads (source_id, family, payload_hash, hash_recipe, raw_payload, first_stored_at)
      VALUES (${afltablesSourceId}, 'match', repeat('a', 64), 'sha256/v1(fixture)', '{}'::jsonb, now())
    `;
    await sql`
      INSERT INTO staging.source_record_versions (source_id, family, external_record_id, version_seq, payload_hash, source_updated_at, observed_from, opened_by_batch_id)
      VALUES (${afltablesSourceId}, 'match', ${matchKey}, 1, repeat('a', 64), now(), now(), ${batch.id})
    `;
    await sql`
      INSERT INTO staging.source_records (source_id, family, external_record_id, scope_key, current_version_seq, current_payload_hash, first_seen_at, last_seen_at, last_batch_id)
      VALUES (${afltablesSourceId}, 'match', ${matchKey}, ${`season=${SEASON}`}, 1, repeat('a', 64), now(), now(), ${batch.id})
    `;
    // staging.afltables_match (migration 076) carries NO match_key column —
    // its grain is (source_id, family, external_record_id). The sweep in
    // settle-afl-api.ts correlates this row to a canonical match_key by
    // RENDERING one from season/round_code/match_date/home_club_id/away_club_id
    // (renderMatchKey(), the same computation §6.1 step 2 uses) — so this
    // fixture's values must render the SAME match_key as the canonical row
    // under test: season/round_code/match_date/home+away club ids below match
    // `matchKeyFor(providerId)` exactly.
    await sql`
      INSERT INTO staging.afltables_match (
        source_id, family, external_record_id, version_seq, season,
        round_code, round_number, round_type, is_final, match_date,
        venue_raw, home_club_id, away_club_id,
        home_goals, home_behinds, home_score, away_goals, away_behinds, away_score,
        result, winner_club_id, margin, attendance, attendance_status, attendance_source_id,
        projected_by_batch_id
      ) VALUES (
        ${afltablesSourceId}, 'match', ${matchKey}, 1, ${SEASON},
        'PF', 28, 'preliminary_final', true, ${matchDateFor(providerId)},
        'MCG', ${homeClubId}, ${awayClubId},
        19, 8, 122, 20, 11, 131,
        'away_win', ${awayClubId}, 9, 45123, 'complete', ${afltablesSourceId},
        ${batch.id}
      )
    `;

    const second = await runSettleAflApi(sql, {
      bundle: buildBundle([unitSourceFor(providerId)], registry, identities),
      registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    });
    expect(second.halt).toBeNull();
    expect(second.counters.attendanceEnrichmentsApplied).toBe(1);

    const [enriched] = await sql<{
      sourceId: number; attendance: number | null; attendanceSourceId: number | null;
    }[]>`
      SELECT source_id AS "sourceId", attendance, attendance_source_id AS "attendanceSourceId"
        FROM matches WHERE id = ${owned.id}
    `;
    expect(enriched.sourceId).toBe(aflApiSourceId); // still afl_api-owned
    expect(enriched.attendance).toBe(45123);
    expect(enriched.attendanceSourceId).toBe(afltablesSourceId);
  });
});
