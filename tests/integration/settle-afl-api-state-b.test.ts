/**
 * AFLDB-ISSUE-275 (State B validation) / AFLDB-ISSUE-257 §17.8 / F-S9-03 — durable Match Sheet authority
 * over an afl_api-OWNED `player_match_stats` row survives a re-settle, on a COLLISION-FREE FIXTURE SEASON.
 *
 * WHY A SEPARATE FILE. The §17.8 case in `settle-afl-api.test.ts` is correct, and is left exactly as it is.
 * But that file's harness (`beforeAll` / `beforeEach` / `afterAll` -> `seedBaseline()` ->
 * `recompute2026SeasonDerivedState()`) recomputes the REAL 2026 `seasons` and `club_seasons` rows on
 * `afldb_test`, and the settle it drives writes season-2026 derived rows. Selecting that one case by name
 * still runs those hooks, so it cannot be run without rewriting pre-existing, non-fixture rows. This file
 * runs the SAME real code (`runSettleAflApi`, the shared canonical applier, `saveMatchSheet`,
 * `playerMatchStatsAuthorityStorable`) with the SAME assertions, but for a fixture season that exists
 * nowhere else, so every write is to a row this file creates and removes.
 *
 * WHAT IS FIXTURE AND WHAT IS NOT. Test-only inputs: the season (2071, referenced by no other file in the
 * repository and absent from `afldb_test`), the match dates, one synthetic player, one synthetic
 * non-final "keep-alive" match, and an in-memory COPY of the registry in which the declared round
 * vocabulary `afl_api_2026` is cloned to `afl_api_2071` (the settle refuses a season that has none; the
 * clone is byte-for-byte the 2026 table with the `season` field changed, and `data/reference/` is not
 * edited). Application behaviour is not changed and no assertion of the original case is weakened.
 *
 * FAIL-CLOSED BEFORE ANY WRITE: the database is `afldb_test`; the session role is `afldb_owner` and the
 * roles `afldb_import`, `afldb_app`, `afldb_auth`, `afldb_backup` exist; the fixture season, namespace,
 * synthetic player and provider identities are all absent (a leftover is an unknown row and is never
 * adopted); `afl_api` and `afltables` sources, the two clubs and the venue exist (read only).
 * State A (migration 110 not applied) cannot store the authority: the case is SKIPPED LOUDLY, never
 * passed vacuously.
 *
 * ISOLATION AND CLEANUP. Committed fixtures (the settle opens its own transaction), removed by exact key,
 * namespace prefix and fixture season only, before and after. `afterAll` asserts zero residue and that
 * every pre-existing row is unchanged (counts of the touched tables, the content of `seasons` and
 * `club_seasons` outside the fixture season, and a 1/61 content sample of `player_match_stats`).
 * The fixture ids are printed as one JSON line (`[ISSUE-275 state-b fixture]`) so a run's output records them.
 *
 * @see tests/integration/settle-afl-api.test.ts (the original §17.8 case)
 * @see issues/open/AFLDB-ISSUE-275.md sections 44.8, 47
 */
import './guard';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadMatchSheetStaleToken, saveMatchSheet } from '@/db/queries/match-sheet';
import { playerMatchStatsAuthorityStorable } from '@/lib/acquisition/manual-authority';
import { requireAflApiBrownlowBacktestDatabase } from '@/lib/acquisition/afl-api-brownlow';
import { parseAflApiIdentities, type AflApiIdentities } from '@/lib/acquisition/afl-api-bundle';
import {
  buildAflApiSettleBundle,
  runSettleAflApi,
  type AflApiSettleUnitSource,
} from '@/lib/acquisition/settle-afl-api';
import { renderMatchKey } from '@/lib/acquisition/settle-core';
import { parseSourceFamilyRegistry, type SourceFamilyRegistry } from '@/lib/acquisition/source-families';

const PROJECT_ROOT = join(__dirname, '..', '..');
const FIXTURE_DIR = join(PROJECT_ROOT, 'tests', 'fixtures', 'afl_api', 'match');

/** The collision-free fixture season. Referenced by no other file; the suite refuses to run if it exists. */
const FIXTURE_SEASON = 2071;
/** This file's own namespace for provider ids, snapshot labels and notes. */
const NS = 'CD_M2071ISSUE275SB';
const SNAPSHOT_LABEL = 'issue275-stateb-integration';
const NOTE = 'issue-275 state-b afl_api ownership test';
const CASE_PROVIDER_ID = `${NS}N`;
/** A June Wednesday (AEST, no daylight saving) in the fixture season. */
const CASE_DATE = `${FIXTURE_SEASON}-06-03`;
const KEEPALIVE_MATCH_KEY = `${NS}-keepalive`;
const HOME_HIST = 'Hawthorn';
const AWAY_HIST = 'Brisbane Lions';
/** The fixture season's AFL provider season id (resolved to the season year through the identities file). */
const FIXTURE_COMP_SEASON_PROVIDER_ID = 'CD_S2071014';
const FIXTURE_COMP_SEASON_ID = 9071;
const BRIDGED_PROVIDER_PLAYER_ID = 'CD_I297354'; // Karl Amon, home side, in the shared fixture
const BRIDGED_AFLTABLES_ID = 'players/Z/Issue275-state-b-bridged-test.html';
const SYNTHETIC_PLAYER_LEGACY_ID = -275000001;
const REQUIRED_ROLES = ['afldb_owner', 'afldb_import', 'afldb_app', 'afldb_auth', 'afldb_backup'];

const sql = postgres(process.env.AFLDB_TEST_DATABASE_URL as string, { max: 1, onnotice: () => {} });

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8'));
}
// The shared fixtures are plain JSON of a shape the emitters validate; this file only renames a few fields.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawJson = Record<string, any>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

let registry: SourceFamilyRegistry;
let identities: AflApiIdentities;
let aflApiSourceId = 0;
let afltablesSourceId = 0;
let homeClubId = 0;
let awayClubId = 0;
let homeClubName = '';
let awayClubName = '';
let bridgedPlayerId = 0;
let adminUserId = 0;
let keepaliveMatchId = 0;
let matchKey = '';
let fixtureIds: Record<string, unknown> = {};

/** The shared valid fixture, renamed onto this file's provider match id and date (same shape as the original). */
function unitSource(mutate?: (raw: {
  fixture: RawJson; roster: RawJson; stats: RawJson;
}) => void): AflApiSettleUnitSource {
  const fixture = clone(readFixture('01-fixture-result.json')) as RawJson;
  const roster = clone(readFixture('03-match-roster.raw.json')) as RawJson;
  const stats = clone(readFixture('02-player-stats.raw.json')) as RawJson;
  fixture.providerId = CASE_PROVIDER_ID;
  // The unit's season is resolved from compSeason.providerId (afl-api-identities.json), never from the bundle parameter.
  fixture.compSeason = {
    ...fixture.compSeason, id: FIXTURE_COMP_SEASON_ID, providerId: FIXTURE_COMP_SEASON_PROVIDER_ID,
    name: `${FIXTURE_SEASON} Fixture AFL Premiership`,
  };
  fixture.round = { ...fixture.round, providerId: `CD_R${FIXTURE_SEASON}01428` };
  roster.matchRoster.competitionId = FIXTURE_COMP_SEASON_PROVIDER_ID;
  fixture.utcStartTime = `${CASE_DATE}T07:15:00.000+0000`;
  roster.match.matchId = CASE_PROVIDER_ID;
  roster.match.venueLocalStartTime = `${CASE_DATE}T17:15:00`;
  roster.matchRoster.matchId = CASE_PROVIDER_ID;
  roster.matchRoster.homeTeam.matchId = CASE_PROVIDER_ID;
  roster.matchRoster.awayTeam.matchId = CASE_PROVIDER_ID;
  roster.recentMatchScores[0].matchId = CASE_PROVIDER_ID;
  if (mutate) mutate({ fixture, roster, stats });
  return { fixtureRaw: fixture, rosterRaw: roster, playerStatsRaw: stats };
}

/** The in-memory identities copy: one extra season entry for the fixture season. data/reference/ is not edited. */
function fixtureIdentities(): AflApiIdentities {
  const json = JSON.parse(readFileSync(join(PROJECT_ROOT, 'data', 'reference', 'afl-api-identities.json'), 'utf8'));
  json.seasons[String(FIXTURE_SEASON)] = { compSeasonId: FIXTURE_COMP_SEASON_ID, providerId: FIXTURE_COMP_SEASON_PROVIDER_ID };
  return parseAflApiIdentities(json);
}

/** The in-memory registry copy: `afl_api_2026` cloned to `afl_api_<fixture season>`. Nothing on disk changes. */
function fixtureRegistry(): SourceFamilyRegistry {
  const json = JSON.parse(readFileSync(join(PROJECT_ROOT, 'data', 'reference', 'source-families.json'), 'utf8'));
  const vocabularies = json.round_vocabularies as Record<string, Record<string, unknown>>;
  const base = vocabularies.afl_api_2026;
  if (!base) throw new Error('round_vocabularies.afl_api_2026 is missing from data/reference/source-families.json');
  vocabularies[`afl_api_${FIXTURE_SEASON}`] = { ...clone(base), season: FIXTURE_SEASON };
  return parseSourceFamilyRegistry(json);
}

/* ------------------------------------------------------------------ *
 * Fingerprints of everything this file must leave untouched
 * ------------------------------------------------------------------ */

type Fingerprint = Record<string, number | string>;
async function fingerprint(): Promise<Fingerprint> {
  return sql.begin('read only', async (tx) => {
    await tx`SELECT set_config('statement_timeout', '300s', true)`;
    const [r] = await tx<Fingerprint[]>`
      SELECT
        (SELECT count(*) FROM matches)::int AS "matches",
        (SELECT count(*) FROM player_match_stats)::int AS "playerMatchStats",
        (SELECT count(*) FROM match_period_scores)::int AS "matchPeriodScores",
        (SELECT count(*) FROM players)::int AS "players",
        (SELECT count(*) FROM external_identities)::int AS "externalIdentities",
        (SELECT count(*) FROM data_overrides)::int AS "dataOverrides",
        (SELECT count(*) FROM seasons)::int AS "seasons",
        (SELECT count(*) FROM club_seasons)::int AS "clubSeasons",
        (SELECT count(*) FROM player_season_stats)::int AS "playerSeasonStats",
        (SELECT count(*) FROM player_career_stats)::int AS "playerCareerStats",
        (SELECT count(*) FROM player_club_season_stats)::int AS "playerClubSeasonStats",
        (SELECT count(*) FROM player_clubs)::int AS "playerClubs",
        (SELECT count(*) FROM canonical_applications)::int AS "canonicalApplications",
        (SELECT count(*) FROM data_issues)::int AS "dataIssues",
        (SELECT count(*) FROM staging.source_records)::int AS "sourceRecords",
        (SELECT count(*) FROM staging.source_record_versions)::int AS "sourceRecordVersions",
        (SELECT count(*) FROM staging.source_payloads)::int AS "sourcePayloads",
        (SELECT coalesce(md5(string_agg(to_jsonb(d)::text, '|' ORDER BY d.id)), '') FROM data_issues d) AS "dataIssuesContent",
        (SELECT coalesce(md5(string_agg(to_jsonb(x)::text, '|' ORDER BY x.year)), '') FROM seasons x
          WHERE x.year <> ${FIXTURE_SEASON}) AS "seasonsContent",
        (SELECT coalesce(md5(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id)), '') FROM club_seasons x
          WHERE x.season <> ${FIXTURE_SEASON}) AS "clubSeasonsContent",
        (SELECT coalesce(sum(hashtextextended(to_jsonb(s)::text, 0)::numeric), 0)::text
           FROM player_match_stats s WHERE (s.player_id + s.match_id) % 61 = 0) AS "playerMatchStatsSample"
    `;
    return r;
  });
}

/** Counts of every fixture-namespace row; all must be zero before and after. */
async function residue(): Promise<Record<string, number>> {
  const [r] = await sql<Record<string, number>[]>`
    SELECT
      (SELECT count(*) FROM seasons WHERE year = ${FIXTURE_SEASON})::int AS "seasons",
      (SELECT count(*) FROM matches WHERE season = ${FIXTURE_SEASON})::int AS "matches",
      (SELECT count(*) FROM club_seasons WHERE season = ${FIXTURE_SEASON})::int AS "clubSeasons",
      (SELECT count(*) FROM player_match_stats s JOIN matches m ON m.id = s.match_id WHERE m.season = ${FIXTURE_SEASON})::int AS "playerMatchStats",
      (SELECT count(*) FROM players WHERE legacy_player_id = ${SYNTHETIC_PLAYER_LEGACY_ID})::int AS "players",
      (SELECT count(*) FROM external_identities
        WHERE (source_id = ${aflApiSourceId} AND external_id = ${BRIDGED_PROVIDER_PLAYER_ID})
           OR (source_id = ${afltablesSourceId} AND external_id = ${BRIDGED_AFLTABLES_ID}))::int AS "externalIdentities",
      (SELECT count(*) FROM data_overrides WHERE entity_type = 'player_match_stats'
         AND starts_with(entity_key, ${`${FIXTURE_SEASON}|`}))::int AS "dataOverrides",
      (SELECT count(*) FROM data_edits WHERE note = ${NOTE})::int AS "dataEdits",
      (SELECT count(*) FROM canonical_applications WHERE external_record_id LIKE ${`${NS}%`})::int AS "canonicalApplications",
      (SELECT count(*) FROM import_batches WHERE notes LIKE ${`%${SNAPSHOT_LABEL}%`})::int AS "importBatches",
      (SELECT count(*) FROM data_issues WHERE issue_key LIKE ${`%${NS}%`} OR issue_key LIKE ${`afl_api|%|${FIXTURE_SEASON}|%`})::int AS "dataIssues",
      (SELECT count(*) FROM promotion_candidates WHERE external_record_id LIKE ${`${NS}%`})::int AS "promotionCandidates",
      (SELECT count(*) FROM import_rejections WHERE source_record_id LIKE ${`${NS}%`})::int AS "importRejections",
      (SELECT count(*) FROM staging.afl_api_match WHERE external_record_id LIKE ${`${NS}%`})::int AS "aflApiMatch",
      (SELECT count(*) FROM staging.afl_api_player_match WHERE provider_match_id LIKE ${`${NS}%`})::int AS "aflApiPlayerMatch",
      (SELECT count(*) FROM staging.source_records WHERE external_record_id LIKE ${`${NS}%`})::int AS "sourceRecords",
      (SELECT count(*) FROM staging.source_record_versions WHERE external_record_id LIKE ${`${NS}%`})::int AS "sourceRecordVersions"
  `;
  return r;
}
const NO_RESIDUE = {
  seasons: 0, matches: 0, clubSeasons: 0, playerMatchStats: 0, players: 0, externalIdentities: 0, dataOverrides: 0,
  dataEdits: 0, canonicalApplications: 0, importBatches: 0, dataIssues: 0, promotionCandidates: 0,
  importRejections: 0, aflApiMatch: 0, aflApiPlayerMatch: 0, sourceRecords: 0, sourceRecordVersions: 0,
};

/**
 * Remove every row this file can have created, children first, by exact key / namespace / fixture season only.
 * The fixture season exists nowhere else, so season-scoped deletes cannot reach a pre-existing row.
 */
async function cleanup(): Promise<void> {
  if (!aflApiSourceId || !afltablesSourceId) return;
  // postgres.js fragments are single-use, so each use builds a fresh one.
  const players = () => sql`(SELECT id FROM players WHERE legacy_player_id = ${SYNTHETIC_PLAYER_LEGACY_ID})`;
  await sql`DELETE FROM data_overrides WHERE entity_type = 'player_match_stats' AND starts_with(entity_key, ${`${FIXTURE_SEASON}|`})`;
  await sql`DELETE FROM data_edits WHERE note = ${NOTE}`;
  // player_clubs references matches with no ON DELETE: it must go before the matches do.
  await sql`DELETE FROM player_clubs WHERE player_id IN ${players()}`;
  const matchIds = (await sql<{ id: number }[]>`SELECT id FROM matches WHERE season = ${FIXTURE_SEASON}`).map((r) => r.id);
  if (matchIds.length > 0) {
    await sql`DELETE FROM player_match_stats WHERE match_id = ANY(${matchIds}::bigint[])`;
    await sql`DELETE FROM match_period_scores WHERE match_id = ANY(${matchIds}::bigint[])`;
  }
  // Ledger rows cite staging.source_record_versions, so they go first.
  await sql`DELETE FROM canonical_applications WHERE external_record_id LIKE ${`${NS}%`}`;
  await sql`
    DELETE FROM canonical_applications
     WHERE target_table = 'matches' AND target_key->>'match_key' LIKE ${`${FIXTURE_SEASON}|%`}
  `;
  await sql`DELETE FROM promotion_candidates WHERE external_record_id LIKE ${`${NS}%`}`;
  await sql`DELETE FROM data_issues WHERE issue_key LIKE ${`%${NS}%`} OR issue_key LIKE ${`afl_api|%|${FIXTURE_SEASON}|%`}`;
  await sql`DELETE FROM import_rejections WHERE source_record_id LIKE ${`${NS}%`}`;
  if (matchIds.length > 0) await sql`DELETE FROM matches WHERE id = ANY(${matchIds}::bigint[])`;
  await sql`DELETE FROM staging.afl_api_player_match WHERE provider_match_id LIKE ${`${NS}%`}`;
  await sql`DELETE FROM staging.afl_api_match WHERE external_record_id LIKE ${`${NS}%`}`;
  const doomed = await sql<{ sourceId: number; family: string; payloadHash: string }[]>`
    SELECT DISTINCT source_id AS "sourceId", family, payload_hash AS "payloadHash"
      FROM staging.source_record_versions
     WHERE source_id = ${aflApiSourceId} AND external_record_id LIKE ${`${NS}%`}
  `;
  await sql`DELETE FROM staging.source_records WHERE source_id = ${aflApiSourceId} AND external_record_id LIKE ${`${NS}%`}`;
  await sql`DELETE FROM staging.source_record_versions WHERE source_id = ${aflApiSourceId} AND external_record_id LIKE ${`${NS}%`}`;
  for (const p of doomed) {
    await sql`
      DELETE FROM staging.source_payloads
       WHERE source_id = ${p.sourceId} AND family = ${p.family} AND payload_hash = ${p.payloadHash}
         AND NOT EXISTS (
           SELECT 1 FROM staging.source_record_versions v
            WHERE v.source_id = ${p.sourceId} AND v.family = ${p.family} AND v.payload_hash = ${p.payloadHash})
    `;
  }
  await sql`DELETE FROM import_batches WHERE notes LIKE ${`%${SNAPSHOT_LABEL}%`}`;
  for (const table of ['player_club_season_stats', 'player_season_stats', 'player_career_stats']) {
    await sql`DELETE FROM ${sql(table)} WHERE player_id IN ${players()}`;
  }
  await sql`DELETE FROM club_seasons WHERE season = ${FIXTURE_SEASON}`;
  await sql`DELETE FROM external_identities WHERE source_id = ${aflApiSourceId} AND external_id = ${BRIDGED_PROVIDER_PLAYER_ID}`;
  await sql`DELETE FROM external_identities WHERE source_id = ${afltablesSourceId} AND external_id = ${BRIDGED_AFLTABLES_ID}`;
  await sql`DELETE FROM players WHERE legacy_player_id = ${SYNTHETIC_PLAYER_LEGACY_ID}`;
  await sql`DELETE FROM seasons WHERE year = ${FIXTURE_SEASON} AND NOT EXISTS (SELECT 1 FROM matches WHERE season = ${FIXTURE_SEASON})`;
}

let before: Fingerprint | undefined;
let setupOk = false;

beforeAll(async () => {
  // ---- assert the target and the roles BEFORE any write ----
  const [id] = await sql<{ db: string; user: string }[]>`SELECT current_database() AS db, current_user AS "user"`;
  await requireAflApiBrownlowBacktestDatabase(sql);
  if (id.user !== 'afldb_owner') throw new Error(`Refusing to run: connected as '${id.user}', not afldb_owner.`);
  const roles = (await sql<{ rolname: string }[]>`SELECT rolname FROM pg_roles WHERE rolname = ANY(${REQUIRED_ROLES}::text[])`)
    .map((r) => r.rolname).sort();
  expect(roles, 'every required role must exist before any write').toEqual([...REQUIRED_ROLES].sort());
  const [owner] = await sql<{ owner: string }[]>`
    SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = 'public.data_overrides'::regclass
  `;
  expect(owner.owner).toBe('afldb_owner');

  const [afl] = await sql<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afl_api'`;
  const [aft] = await sql<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afltables'`;
  if (!afl || !aft) throw new Error("sources 'afl_api' and 'afltables' must both exist on afldb_test.");
  aflApiSourceId = afl.id;
  afltablesSourceId = aft.id;
  const [home] = await sql<{ id: number; name: string }[]>`SELECT id, name FROM clubs WHERE legacy_club_hist = ${HOME_HIST}`;
  const [away] = await sql<{ id: number; name: string }[]>`SELECT id, name FROM clubs WHERE legacy_club_hist = ${AWAY_HIST}`;
  const [venue] = await sql<{ id: number }[]>`SELECT id FROM venues WHERE legacy_name = 'M.C.G.'`;
  if (!home || !away || !venue) throw new Error('Hawthorn, Brisbane Lions and M.C.G. must exist on afldb_test (read only).');
  homeClubId = home.id; awayClubId = away.id; homeClubName = home.name; awayClubName = away.name;
  const [actor] = await sql<{ id: number }[]>`SELECT id FROM auth_users ORDER BY id LIMIT 1`;
  if (!actor) throw new Error('afldb_test has no auth_users row; this file will not create one.');
  adminUserId = actor.id;

  // ---- fail closed: nothing of the fixture namespace may exist (a leftover is an unknown row) ----
  const left = await residue();
  expect(left, 'a leftover fixture row exists; remove it deliberately, this file will not adopt it').toEqual(NO_RESIDUE);
  const clash = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM matches WHERE match_key = ${KEEPALIVE_MATCH_KEY}
  `;
  expect(clash[0].n).toBe(0);

  registry = fixtureRegistry();
  identities = fixtureIdentities();
  matchKey = renderMatchKey(FIXTURE_SEASON, 'PF', CASE_DATE, homeClubName, awayClubName);

  // ---- the historical-row guard, taken before the first write ----
  before = await fingerprint();

  // ---- fixtures ----
  await sql`INSERT INTO seasons (year, league, status) VALUES (${FIXTURE_SEASON}, 'AFL', 'in_progress'::season_status)`;
  const [keepalive] = await sql<{ id: number }[]>`
    INSERT INTO matches (
      match_key, season, round_code, round_type, round_number, is_final, match_date,
      venue_raw, home_club_id, away_club_id, home_score, away_score, result,
      winner_club_id, margin, attendance_status
    ) VALUES (
      ${KEEPALIVE_MATCH_KEY}, ${FIXTURE_SEASON}::smallint, '9001', 'home_and_away', 9001, false,
      ${`${FIXTURE_SEASON}-01-01`}::date, 'ISSUE-275 state-b fixture', ${homeClubId}, ${awayClubId}, 100, 80,
      'home_win', ${homeClubId}, 20, 'not_collected'
    ) RETURNING id::int AS id
  `;
  keepaliveMatchId = keepalive.id;
  const [player] = await sql<{ id: number }[]>`
    INSERT INTO players (legacy_player_id, display_name, sort_name, search_name, slug, given_name, surname)
    VALUES (${SYNTHETIC_PLAYER_LEGACY_ID}, 'Karl Amon (ISSUE-275 state-b fixture)',
            'Amon (ISSUE-275 state-b fixture), Karl', 'karl amon issue275 state b fixture',
            'karl-amon-issue275-state-b-fixture', 'Karl', 'Amon-Issue275StateB')
    RETURNING id::int AS id
  `;
  bridgedPlayerId = player.id;
  await sql`
    INSERT INTO external_identities (source_id, external_id, status, candidate_count, match_method, player_id)
    VALUES (${aflApiSourceId}, ${BRIDGED_PROVIDER_PLAYER_ID}, 'unique', 1, 'afl_api_stat_vector_bootstrap', ${bridgedPlayerId})
  `;
  await sql`
    INSERT INTO external_identities (source_id, external_id, status, candidate_count, match_method, player_id)
    VALUES (${afltablesSourceId}, ${BRIDGED_AFLTABLES_ID}, 'unique', 1, 'afltables_profile_url', ${bridgedPlayerId})
  `;
  fixtureIds = {
    database: id.db, role: id.user, season: FIXTURE_SEASON, namespace: NS, providerMatchId: CASE_PROVIDER_ID,
    matchKey, keepaliveMatchId, keepaliveMatchKey: KEEPALIVE_MATCH_KEY, bridgedPlayerId,
    syntheticLegacyPlayerId: SYNTHETIC_PLAYER_LEGACY_ID, providerPlayerId: BRIDGED_PROVIDER_PLAYER_ID,
    afltablesIdentity: BRIDGED_AFLTABLES_ID, adminUserId, note: NOTE, snapshotLabel: SNAPSHOT_LABEL,
    aflApiSourceId, afltablesSourceId,
  };
  console.log(`[ISSUE-275 state-b fixture] ${JSON.stringify(fixtureIds)}`);
  setupOk = true;
}, 120_000);

afterAll(async () => {
  try {
    await cleanup();
    expect(await residue(), 'no fixture row may remain').toEqual(NO_RESIDUE);
    if (before) {
      // Every pre-existing row is unchanged: counts, content outside the fixture season, and the sample.
      expect(await fingerprint(), 'a pre-existing row changed').toEqual(before);
    }
  } finally {
    await sql.end({ timeout: 10 });
  }
}, 300_000);

describe('AFLDB-ISSUE-257 §17.8 on a fixture season — Match Sheet authority over an afl_api-owned row survives a re-settle', () => {
  it('keeps the corrected field, lets an unrelated field follow the source, and never changes ownership', async (ctx) => {
    expect(setupOk, 'setup must have completed (see the beforeAll failure)').toBe(true);
    if (!(await playerMatchStatsAuthorityStorable(sql))) {
      // State A: no authority is storable. A skip is loud; it is never a pass.
      console.warn('[ISSUE-275 state-b] SKIPPED: migration 110 is not applied on this database (State A); nothing to prove.');
      ctx.skip();
      return;
    }

    const priorImportUrl = process.env.AFLDB_IMPORT_DATABASE_URL;
    process.env.AFLDB_IMPORT_DATABASE_URL = process.env.AFLDB_TEST_DATABASE_URL;

    const mutateSource = (raw: { stats: unknown }) => {
      const stats = (raw.stats as { homeTeamPlayerStats: { playerStats: { stats: Record<string, unknown> } }[] })
        .homeTeamPlayerStats[0].playerStats.stats;
      stats.goals = 5.0; // a protected field the source now disagrees about
      stats.contestedMarks = 4.0; // an unrelated field (not on the Match Sheet)
    };
    const settleOptions = (label: string, mutate?: typeof mutateSource) => {
      const bundle = buildAflApiSettleBundle({
        season: FIXTURE_SEASON, snapshotLabel: SNAPSHOT_LABEL, sources: [unitSource(mutate)], registry, identities,
      });
      expect(bundle.buildFailures).toEqual([]);
      return {
        bundle: { ...bundle, snapshotLabel: `${SNAPSHOT_LABEL}-${CASE_PROVIDER_ID}-i257-${label}` },
        registry, apply: true, autoApply: true, inProgressSeasons: [FIXTURE_SEASON],
      };
    };
    const rowOf = async (matchId: number) => {
      const [row] = await sql<{
        sourceId: number; goals: number; contestedMarks: number; clubId: number; jumper: string | null;
        behinds: number; kicks: number; handballs: number; disposals: number; marks: number;
        tackles: number; hitouts: number; freesFor: number; freesAgainst: number;
      }[]>`
        SELECT source_id AS "sourceId", goals::int AS goals, contested_marks::int AS "contestedMarks",
               club_id::int AS "clubId", jumper_number AS jumper, behinds::int AS behinds,
               kicks::int AS kicks, handballs::int AS handballs, disposals::int AS disposals,
               marks::int AS marks, tackles::int AS tackles, hitouts::int AS hitouts,
               frees_for::int AS "freesFor", frees_against::int AS "freesAgainst"
          FROM player_match_stats WHERE match_id = ${matchId} AND player_id = ${bridgedPlayerId}
      `;
      expect(row).toBeDefined();
      return row;
    };

    try {
      const created = await runSettleAflApi(sql, settleOptions('create'));
      expect(created.applied).toBe(true);
      expect(created.counters.canonicalApplyFailures).toBe(0);
      const [match] = await sql<{ id: number }[]>`SELECT id FROM matches WHERE match_key = ${matchKey}`;
      expect(match).toBeDefined();
      const before17 = await rowOf(match.id);
      expect(before17.sourceId).toBe(aflApiSourceId);
      expect(before17.goals).toBe(0);
      expect(before17.contestedMarks).toBe(0);
      console.log(`[ISSUE-275 state-b fixture] ${JSON.stringify({ createdMatchId: match.id, createdMatchKey: matchKey })}`);

      // The Match Sheet correction: goals 0 -> 2 under the player's stable identity.
      const saved = await saveMatchSheet({
        matchId: match.id, syncMatchScores: false,
        players: [{
          playerId: bridgedPlayerId, clubId: before17.clubId, jumperNumber: before17.jumper,
          goals: 2, behinds: before17.behinds, kicks: before17.kicks, handballs: before17.handballs,
          disposals: before17.disposals, marks: before17.marks, tackles: before17.tackles,
          hitouts: before17.hitouts, freesFor: before17.freesFor, freesAgainst: before17.freesAgainst,
        }],
        adminUserId, note: NOTE, staleToken: await loadMatchSheetStaleToken(sql, match.id),
      });
      expect(saved).toMatchObject({ ok: true });
      const [{ active }] = await sql<{ active: number }[]>`
        SELECT count(*)::int AS active FROM data_overrides
         WHERE entity_type = 'player_match_stats' AND is_active
           AND starts_with(entity_key, ${matchKey}::text || '|')
      `;
      expect(active).toBeGreaterThan(0);
      expect((await rowOf(match.id)).goals).toBe(2);
      expect((await rowOf(match.id)).sourceId).toBe(aflApiSourceId);

      // The source now says goals 5 and contested marks 4.
      const resettled = await runSettleAflApi(sql, settleOptions('resettle', mutateSource));
      expect(resettled.applied).toBe(true);
      expect(resettled.counters.canonicalApplyFailures).toBe(0);
      const after = await rowOf(match.id);
      expect(after.goals).toBe(2); // protected: the correction is kept
      expect(after.contestedMarks).toBe(4); // unrelated: still follows the source
      expect(after.sourceId).toBe(aflApiSourceId); // ownership is never changed by a Match Sheet edit
    } finally {
      await sql`
        DELETE FROM data_overrides
         WHERE entity_type = 'player_match_stats' AND starts_with(entity_key, ${matchKey}::text || '|')
      `;
      await sql`DELETE FROM data_edits WHERE admin_user_id = ${adminUserId} AND note = ${NOTE}`;
      if (priorImportUrl === undefined) delete process.env.AFLDB_IMPORT_DATABASE_URL;
      else process.env.AFLDB_IMPORT_DATABASE_URL = priorImportUrl;
    }
  }, 600_000);
});
