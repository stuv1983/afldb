/**
 * AFLDB-ISSUE-228 S7 canonical round-selection correction (2026-09-20,
 * operator's corrected 2025 Round-24 diagnosis) against real PostgreSQL.
 *
 * ROOT CAUSE UNDER TEST: `planAflApiBrownlowMatchSet()` (`afl-api-brownlow.ts`)
 * used to write `brownlow_round_votes.round_number` from
 * `translateAflApiBrownlowRound()`'s TRANSLATED PROVIDER ROUND. That is wrong
 * for a rescheduled/postponed fixture: AFLDB's own `matches.round_number`
 * preserves the fixture's ORIGINAL assigned round (`admin-fixtures.ts`'s
 * `rescheduleFixture()` only ever moves date/time — a round change is the
 * separate, audited `changeFixtureRound()`), while the AFL.com.au Brownlow
 * feed groups a postponed match's votes under whichever week it was actually
 * played. The operator's real 2025 evidence: Gold Coast v Essendon's
 * rescheduled Opening Round fixture and Brisbane v Geelong's both carry a
 * Brownlow `api_round_number` that translates to a round other than the
 * canonical match's own — and Matt Rowell legitimately held two different
 * round-24-labelled votes in two different matches that the old
 * `(player_id, translated round)` write target collapsed into one.
 *
 * The fix: `resolveAflApiBrownlowMatch()` now reads the resolved canonical
 * match's own `round_number` fresh from `matches`, and `planAflApiBrownlowMatchSet()`
 * writes THAT (`canonicalRoundNumber`), never the translated round
 * (`providerTranslatedRound`, retained for validation/observability only).
 *
 * This suite proves it against two REAL committed matches: an ordinary one
 * (translated round == canonical round) and a "rescheduled" one (staged under
 * a different provider round than its Brownlow vote claims, so translated
 * round != canonical round) — and proves the SAME player voting under the
 * SAME provider round in both matches lands as two DISTINCT canonical rows,
 * never one overwriting the other.
 *
 * ISOLATED from both `tests/integration/settle-afl-api-brownlow.test.ts` and
 * `tests/integration/settle-afl-api-brownlow-backtest.test.ts`: those suites'
 * cleanup()/afterAll() hard-code their own exact match ledgers (2 and 1
 * respectively) that a third or extra match here would break. This file owns
 * its own two matches and its own three synthetic voters end to end, under
 * its own NS, and never touches either sibling suite's rows.
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
import { runSettleAflApiBrownlow, SETTLE_BATCH_TOOL } from '@/lib/acquisition/afl-api-brownlow';
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
const NS = 'CD_M2026I228RS';
const SEASON = 2026;
const HOME_HIST = 'Hawthorn';
const AWAY_HIST = 'Brisbane Lions';

const ORD_ID = `${NS}ORD`;
const ORD_DATE = '2026-09-29';
/** `api_round_number: 5` (afl_api_2026 vocabulary) -> `canonical_round_number: 6`, an
 * ordinary home-and-away round — the sibling suites already prove this row safe. */
const ORD_API_ROUND = { apiRoundNumber: 5, abbreviation: 'Rd 5', name: 'Round 5' };
const ORD_ROUND_CODE = '6';

const RESCHED_ID = `${NS}RESCHED`;
const RESCHED_DATE = '2026-10-06';
/** Opening Round (`api_round_number: 0` -> `canonical_round_number: 1`). Staged as THIS
 * match's own fixture round, deliberately different from the round its Brownlow vote
 * will claim below — the match's OWN round_number must win. */
const RESCHED_API_ROUND = { apiRoundNumber: 0, abbreviation: 'OR', name: 'Opening Round' };
const RESCHED_ROUND_CODE = '1';

const MATCHES = [
  { id: ORD_ID, date: ORD_DATE, roundCode: ORD_ROUND_CODE, stagedRound: ORD_API_ROUND },
  { id: RESCHED_ID, date: RESCHED_DATE, roundCode: RESCHED_ROUND_CODE, stagedRound: RESCHED_API_ROUND },
] as const;

const VOTER_PROVIDER_IDS = ['CD_I228RS01', 'CD_I228RS02', 'CD_I228RS03'] as const;
const VOTER_LEGACY_IDS = [-228330001, -228330002, -228330003] as const;

/** Mirrors `afl-api-bundle.ts`'s own `convertUtcInstantToVenueLocal()`: the
 * naive `venueLocalStartTime` a real AFL.com.au roster observation would
 * publish for a given UTC instant is NEVER a fixed clock-time literal across
 * dates — Melbourne's AEST/AEDT offset changes under it. Deriving it here
 * (rather than hard-coding a literal per match date) keeps the synthetic
 * fixture internally consistent across the DST transition without guessing
 * which of the two independently-observed fields the real provider intended. */
function melbourneLocalStartTimeFor(utcStartTime: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(utcStartTime)).map((p) => [p.type, p.value] as const));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

function unitSourceFor(
  providerMatchId: string, matchDate: string, round: { apiRoundNumber: number; abbreviation: string; name: string },
): AflApiSettleUnitSource {
  const fixture = clone(readFixture('01-fixture-result.json')) as Record<string, any>;
  const roster = clone(readFixture('03-match-roster.raw.json')) as Record<string, any>;
  const stats = clone(readFixture('02-player-stats.raw.json')) as Record<string, any>;

  fixture.providerId = providerMatchId;
  fixture.utcStartTime = `${matchDate}T07:15:00.000+0000`;
  // Must match a declared afl_api_2026 vocabulary row exactly (abbreviation/name), or
  // `translateAflRound()`'s drift check refuses the match-family settle outright.
  fixture.round = { ...fixture.round, roundNumber: round.apiRoundNumber, abbreviation: round.abbreviation, name: round.name };
  roster.match.matchId = providerMatchId;
  roster.match.venueLocalStartTime = melbourneLocalStartTimeFor(fixture.utcStartTime);
  roster.matchRoster.matchId = providerMatchId;
  roster.matchRoster.roundNumber = round.apiRoundNumber;
  roster.matchRoster.homeTeam.matchId = providerMatchId;
  roster.matchRoster.awayTeam.matchId = providerMatchId;
  roster.recentMatchScores[0].matchId = providerMatchId;

  return { fixtureRaw: fixture, rosterRaw: roster, playerStatsRaw: stats };
}

function buildBundle(
  sources: readonly AflApiSettleUnitSource[], registry: SourceFamilyRegistry, identities: AflApiIdentities,
): AflApiSettleBundle {
  const bundle = buildAflApiSettleBundle({
    season: SEASON, snapshotLabel: 'issue228-brownlow-reschedule', sources, registry, identities,
  });
  if (bundle.buildFailures.length > 0) {
    throw new Error(`Bundle build failure(s): ${JSON.stringify(bundle.buildFailures)}`);
  }
  return bundle;
}

/**
 * Both matches' Brownlow votes are reported under the SAME provider round
 * (`ORD_API_ROUND.apiRoundNumber`, 5, translated to canonical 6) — exactly
 * mirroring the operator's real evidence, where the Brownlow feed grouped a
 * postponed match's votes under the week it was actually played rather than
 * its original round. `RESCHED`'s own canonical round is 1 regardless.
 */
function voteRecordFor(providerMatchId: string): AflApiBrownlowMatchVoteRecord {
  return {
    providerMatchId,
    apiRoundNumber: ORD_API_ROUND.apiRoundNumber,
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

function matchKeyFor(id: string): string {
  const m = MATCHES.find((x) => x.id === id);
  if (!m) throw new Error(`No MATCHES entry for provider match id '${id}'.`);
  if (!homeClubName || !awayClubName) {
    throw new Error('matchKeyFor() was called before beforeAll() resolved the canonical club names.');
  }
  return renderMatchKey(SEASON, m.roundCode, m.date, homeClubName, awayClubName);
}

function allMatchKeys(): string[] {
  return MATCHES.map((m) => matchKeyFor(m.id));
}

/** Removes every row this suite can create, and nothing else. Mirrors the
 * sibling suites' cleanup() (`settle-afl-api-brownlow.test.ts` /
 * `settle-afl-api-brownlow-backtest.test.ts`), generalised to this suite's
 * two matches. */
async function cleanup(): Promise<void> {
  const matchKeys = allMatchKeys();
  const matchRows = await sql<{ id: number }[]>`
    SELECT id FROM matches WHERE match_key = ANY(${matchKeys}::text[])
  `;
  const ids = matchRows.map((r) => r.id);

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
  await sql`DELETE FROM brownlow_round_votes WHERE source_record_id LIKE ${`${NS}%`}`;
  // AFLDB-ISSUE-228 S7 typed-projection closure: projectAflApiBrownlowVoteSet()
  // now writes staging.afl_api_brownlow_vote for every planned set. Must run
  // BEFORE the `matches` DELETE below — its `match_id` column REFERENCES
  // matches(id) with no ON DELETE clause.
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
  await sql`DELETE FROM import_batches WHERE notes LIKE ${'%issue228-brownlow-reschedule%'}`;
  // Safe unscoped by match id (the Brownlow settle's own batches carry no
  // NS-scoped text, only `season=...`) only because `vitest.config.mts` pins
  // `fileParallelism: false`, exactly as the backtest sibling suite documents.
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
        ${`Reschedule Voter ${i + 1} (ISSUE-228 S7 round-selection fixture)`},
        ${`RescheduleVoter${i + 1} (ISSUE-228 S7 round-selection fixture)`},
        ${`reschedule voter ${i + 1} issue228 round selection fixture`},
        ${`reschedule-voter-${i + 1}-issue228-round-selection-fixture`},
        'RescheduleVoter', ${`Issue228RoundSelectionTest${i + 1}`}
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

  for (const m of MATCHES) {
    const matchResult = await runSettleAflApi(sql, {
      bundle: buildBundle([unitSourceFor(m.id, m.date, m.stagedRound)], registry, identities),
      registry, apply: true, autoApply: true, inProgressSeasons: [SEASON],
    });
    if (matchResult.halt !== null) throw new Error(`Match-family settle halted for '${m.id}': ${JSON.stringify(matchResult.halt)}`);
    if (!matchResult.applied) throw new Error(`Match-family settle did not apply for '${m.id}'.`);
    if (matchResult.counters.canonicalApplyFailures !== 0) {
      throw new Error(`Match-family settle had ${matchResult.counters.canonicalApplyFailures} apply failure(s) for '${m.id}'.`);
    }
  }
}, 30_000);

afterAll(async () => {
  await cleanup();
  await sql.end({ timeout: 5 });
}, 30_000);

describe('AFLDB-ISSUE-228 S7 canonical round-selection correction against afldb_test', () => {
  it('stages an ordinary match (Round 5 -> canonical 6) and a "rescheduled" one (staged as Opening Round -> '
    + 'canonical 1) as two distinct canonical matches carrying their OWN, different round_number', async () => {
    const [ord] = await sql<{ roundNumber: number }[]>`
      SELECT round_number AS "roundNumber" FROM matches WHERE match_key = ${matchKeyFor(ORD_ID)}
    `;
    const [resched] = await sql<{ roundNumber: number }[]>`
      SELECT round_number AS "roundNumber" FROM matches WHERE match_key = ${matchKeyFor(RESCHED_ID)}
    `;
    if (!ord || !resched) throw new Error('Expected both canonical matches to exist after beforeAll().');
    expect(ord.roundNumber).toBe(6);
    expect(resched.roundNumber).toBe(1); // its OWN canonical round — never moved by a reschedule
  });

  it('writes brownlow_round_votes.round_number from the RESOLVED CANONICAL MATCH\'s own round, never from '
    + 'translateAflApiBrownlowRound()\'s translated provider round, for BOTH matches — even though both '
    + 'Brownlow votes below are reported under the SAME provider round (api_round_number 5, translated 6)',
  async () => {
    const ordResult = await runSettleAflApiBrownlow(sql, {
      registry, season: SEASON,
      matchVotes: [voteRecordFor(ORD_ID)],
      leaderboard: [], leaderboardStatus: null, inProgressSeasons: [SEASON],
      apply: true, autoApply: true, observeOnly: false,
    });
    expect(ordResult.halt).toBeNull();
    expect(ordResult.applied).toBe(true);
    expect(ordResult.counters.voteSetsRefused).toEqual({});
    expect(ordResult.counters.voteSetsRescheduledRound).toBe(0);
    expect(ordResult.counters.canonicalRowsInserted).toBe(3);

    const reschedResult = await runSettleAflApiBrownlow(sql, {
      registry, season: SEASON,
      matchVotes: [voteRecordFor(RESCHED_ID)],
      leaderboard: [], leaderboardStatus: null, inProgressSeasons: [SEASON],
      apply: true, autoApply: true, observeOnly: false,
    });
    expect(reschedResult.halt).toBeNull();
    expect(reschedResult.applied).toBe(true);
    expect(reschedResult.counters.voteSetsRefused).toEqual({});
    // Observable, never hidden (§10 follow-up 2026-09-20): this vote set's translated
    // provider round (6) disagrees with its resolved canonical match's own round (1).
    expect(reschedResult.counters.voteSetsRescheduledRound).toBe(1);
    expect(reschedResult.counters.canonicalRowsInserted).toBe(3);

    const ordRows = await sql<{ roundNumber: number; votes: number }[]>`
      SELECT round_number AS "roundNumber", votes FROM brownlow_round_votes
       WHERE season = ${SEASON} AND source_record_id = ${ORD_ID} ORDER BY votes DESC
    `;
    expect(ordRows.map((r) => r.roundNumber)).toEqual([6, 6, 6]);

    const reschedRows = await sql<{ roundNumber: number; votes: number }[]>`
      SELECT round_number AS "roundNumber", votes FROM brownlow_round_votes
       WHERE season = ${SEASON} AND source_record_id = ${RESCHED_ID} ORDER BY votes DESC
    `;
    // The whole point of the fix: NOT 6 (the translated provider round) — 1 (the
    // resolved canonical match's own round).
    expect(reschedRows.map((r) => r.roundNumber)).toEqual([1, 1, 1]);
  });

  it('the same player voting under the SAME provider round in the two DIFFERENT matches above lands as '
    + 'TWO DISTINCT canonical rows, never one overwriting the other', async () => {
    const [voter] = await sql<{ id: number }[]>`
      SELECT id FROM players WHERE legacy_player_id = ${VOTER_LEGACY_IDS[0]}
    `;
    if (!voter) throw new Error('Expected voter 1 to exist.');

    const rows = await sql<{ roundNumber: number; votes: number; sourceRecordId: string }[]>`
      SELECT round_number AS "roundNumber", votes, source_record_id AS "sourceRecordId"
        FROM brownlow_round_votes
       WHERE season = ${SEASON} AND player_id = ${voter.id} AND source_record_id LIKE ${`${NS}%`}
       ORDER BY round_number
    `;
    // Both ORD_ID and RESCHED_ID gave this player 3 votes (voteRecordFor's first entry).
    expect(rows).toEqual([
      { roundNumber: 1, votes: 3, sourceRecordId: RESCHED_ID },
      { roundNumber: 6, votes: 3, sourceRecordId: ORD_ID },
    ]);
  });
});
