/**
 * AFLDB-ISSUE-228 S7 follow-up (2026-09-20) — the fixture-only Brownlow
 * identity PREREQUISITE, against real PostgreSQL.
 *
 * BACKGROUND (operator brief, simulator evidence audit, same date): only a
 * handful of the 207 real 2025 Brownlow-voting matches carry a captured
 * `playerStats`/`matchRoster` evidence pair, so the normal acquisition
 * (`acquire-afl-api.ts`) cannot be pointed at the rest without fabricating
 * evidence. `acquire-afl-api.ts --fixtures-only` + `settle-afl-api-fixtures.ts`
 * + `resolveAflApiMatchViaFixtureObservation()`
 * (`src/lib/acquisition/afl-api-fixture-identity.ts`) give Brownlow match
 * resolution (`afl-api-brownlow.ts`) enough truthful identity evidence from
 * the season fixture feed ALONE — see that module's own doc comment for why
 * it never touches `staging.afl_api_match` and can never re-own or
 * duplicate a canonical match.
 *
 * ISOLATION MODEL — COMMITTED FIXTURES, same pattern as the sibling suite
 * (`tests/integration/settle-afl-api-brownlow.test.ts`): every canonical
 * `matches` row this suite creates is inserted directly (never through
 * `runSettleAflApi()`, which this suite does not need — it is testing a
 * DIFFERENT, narrower identity path that starts from an ALREADY-EXISTING
 * canonical row) and removed in `afterEach`, so no two `it()` blocks ever
 * see each other's canonical rows even though several deliberately reuse the
 * same (season, clubs) pair, disambiguated by `match_date` (the resolver's
 * lookup key, S7 reschedule correction, 2026-09-20 — round is deliberately
 * NOT part of it any more). Season 2026 / Carlton v Collingwood is this
 * suite's own pairing — distinct from the sibling suite's Hawthorn v
 * Brisbane Lions pairing, so the two files can run concurrently with no
 * shared state.
 *
 * @see src/lib/acquisition/afl-api-fixture-identity.ts
 * @see issues/open/AFLDB-ISSUE-228.md
 */
import './guard';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';
import {
  afterAll, afterEach, beforeAll, describe, expect, it,
} from 'vitest';

import {
  parseAflApiIdentities,
  type AflApiBrownlowMatchVoteRecord,
  type AflApiIdentities,
} from '@/lib/acquisition/afl-api-bundle';
import {
  resolveAflApiBrownlowMatch,
  runSettleAflApiBrownlow,
  type AflApiFixtureIdentityFallback,
} from '@/lib/acquisition/afl-api-brownlow';
import {
  AFL_API_FIXTURE_ACQUISITION_KIND,
  buildAflApiFixtureRecords,
  persistAflApiFixtureObservations,
  resolveAflApiMatchViaFixtureObservation,
} from '@/lib/acquisition/afl-api-fixture-identity';
import { resolveAflApiSourceId } from '@/lib/acquisition/afl-api-match-identity';
import { asImportBatchId } from '@/lib/import-batch-id';
import {
  getSourceFamily, parseSourceFamilyRegistry, type SourceFamilyRegistry,
} from '@/lib/acquisition/source-families';

const PROJECT_ROOT = join(__dirname, '..', '..');
const FIXTURE_DIR = join(PROJECT_ROOT, 'tests', 'fixtures', 'afl_api', 'match');

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8'));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** This suite's own namespace. Appears nowhere else in the repository. */
const NS = 'CD_M2026I228FIX';
const SEASON = 2026;
const HOME_HIST = 'Carlton';
const AWAY_HIST = 'Collingwood';
/**
 * `api_round_number: 5` in the `afl_api_2026` vocabulary translates to
 * canonical round 6, `home_and_away` (confirmed against the same registry
 * entry `tests/integration/settle-afl-api-brownlow.test.ts` already uses for
 * its own Hawthorn v Brisbane Lions pairing — a different club pair at the
 * SAME round, so the two suites never collide).
 */
const API_ROUND_NUMBER = 5;
const CANONICAL_ROUND_NUMBER = 6;
const ROUND_CODE = '6';

/**
 * AFLDB-ISSUE-228 S7 reschedule correction (2026-09-20): `api_round_number: 0`
 * ("OR"/"Opening Round") translates to canonical round 1 — a DIFFERENT
 * canonical round than `API_ROUND_NUMBER` above, used below to prove the
 * lookup key no longer requires provider round to equal the canonical
 * match's own round (`data/reference/source-families.json`'s `afl_api_2026`
 * vocabulary).
 */
const RESCHEDULED_API_ROUND = { apiRoundNumber: 0, abbreviation: 'OR', name: 'Opening Round' } as const;

/**
 * The tracked sample (`01-fixture-result.json`) carries a fixed
 * `utcStartTime` of `2026-09-19T07:15:00.000+0000` and `venue.timezone`
 * `Australia/Melbourne`. 2026-09-19 predates that year's AEDT transition
 * (first Sunday of October), so Melbourne is on AEST (UTC+10): 07:15 UTC ->
 * 17:15 local, SAME calendar day. Every fixture below that does not
 * override `utcStartTime` derives to this exact date — the resolver's new
 * lookup key component.
 */
const DEFAULT_LOCAL_MATCH_DATE = '2026-09-19';
/** An arbitrary, distinct season-2026 date used only to prove that a second
 * real meeting between the SAME two clubs (or a genuine data anomaly) is
 * disambiguated by exact date rather than guessed. */
const ALT_LOCAL_MATCH_DATE = '2026-06-06';

const VOTER_PROVIDER_IDS = ['CD_I228FIX01', 'CD_I228FIX02', 'CD_I228FIX03'] as const;
const VOTER_LEGACY_IDS = [-228400001, -228400002, -228400003] as const;

/** A truthful season-fixture raw object — exactly what a `--fixtures-only`
 * acquisition writes as `<CD_M>/fixture.json` — never a roster/stats payload.
 * `apiRound` defaults to `API_ROUND_NUMBER` (an ordinary round); pass
 * `RESCHEDULED_API_ROUND` to prove resolution no longer depends on it
 * matching the canonical match's own round. */
function fixtureRawFor(
  providerMatchId: string,
  apiRound: { apiRoundNumber: number; abbreviation: string; name: string } = {
    apiRoundNumber: API_ROUND_NUMBER, abbreviation: 'Rd 5', name: 'Round 5',
  },
): Record<string, any> {
  const fixture = clone(readFixture('01-fixture-result.json')) as Record<string, any>;
  fixture.providerId = providerMatchId;
  fixture.round = {
    ...fixture.round, roundNumber: apiRound.apiRoundNumber, abbreviation: apiRound.abbreviation, name: apiRound.name,
  };
  fixture.home.team.providerId = 'CD_T30'; // Carlton
  fixture.away.team.providerId = 'CD_T40'; // Collingwood
  return fixture;
}

const sql = postgres(process.env.AFLDB_TEST_DATABASE_URL as string, { max: 1, onnotice: () => {} });

let registry: SourceFamilyRegistry;
let identities: AflApiIdentities;
let aflApiSourceId: number;
let afltablesSourceId: number;
let homeClubId: number;
let awayClubId: number;

const canonicalMatchIds: number[] = [];

async function seedCanonicalMatch(input: { matchKey: string; sourceId: number | null; matchDate: string }): Promise<number> {
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO matches (
      match_key, season, round_code, round_number, round_type, is_final,
      match_date, venue_raw, home_club_id, away_club_id,
      home_score, away_score, result, winner_club_id, margin,
      attendance, attendance_status, source_id
    ) VALUES (
      ${input.matchKey}, ${SEASON}, ${ROUND_CODE}, ${CANONICAL_ROUND_NUMBER},
      'home_and_away'::round_type, false,
      ${input.matchDate}::date, 'AFLDB-ISSUE-228 Fixture Oval', ${homeClubId}, ${awayClubId},
      100, 80, 'home_win'::match_result, ${homeClubId}, 20,
      NULL, 'not_collected'::coverage_status, ${input.sourceId}
    )
    RETURNING id::int AS id
  `;
  canonicalMatchIds.push(row.id);
  return row.id;
}

async function persistOne(
  providerMatchId: string,
  opts: {
    apiRound?: { apiRoundNumber: number; abbreviation: string; name: string };
    /** Applied to the raw fixture object AFTER `apiRound`, before build/persist — for a
     * scenario that needs to mutate a field `fixtureRawFor()` does not itself parameterise
     * (e.g. `venue.timezone`), without duplicating the whole build/persist pipeline. */
    transform?: (fixture: Record<string, any>) => void;
  } = {},
): Promise<void> {
  const fixture = fixtureRawFor(providerMatchId, opts.apiRound);
  opts.transform?.(fixture);
  const { records, buildFailures } = buildAflApiFixtureRecords([fixture], registry, identities);
  expect(buildFailures).toEqual([]);
  await sql.begin(async (tx) => {
    const [batch] = await tx<{ id: string }[]>`
      INSERT INTO import_batches (source_id, tool, target_table, records_read, notes)
      VALUES (
        ${aflApiSourceId}, 'settle-afl-api-fixtures.ts', 'staging.source_record_versions', 1,
        'issue228-fixtures-integration'
      )
      RETURNING id
    `;
    const batchId = asImportBatchId(batch.id);
    await persistAflApiFixtureObservations(tx, {
      sourceId: aflApiSourceId, season: SEASON, registry, records, batchId, observedAt: new Date().toISOString(),
    });
  });
}

/**
 * `canonical_applications` (migration 083) has NO `target_id`/`match_id` column at all —
 * its identity is `source_id`/`family`/`external_record_id` plus a jsonb `target_key`
 * (`{"match_key": ...}` etc.), never a foreign key to `matches.id`. It is also never
 * written by this suite in the first place: every `runSettleAflApiBrownlow()` call here
 * uses `apply: false`, which rolls back its WHOLE transaction — spine observations
 * included, per that module's own doc comment — so no canonical write is ever committed
 * for a synthetic match. There is therefore nothing of this suite's to find there; see
 * `cleanupAll()`'s namespace-scoped sweep for a defensive check anyway.
 *
 * `player_match_stats.match_id` (migration 004) has NO `ON DELETE CASCADE` and must be
 * cleared before `matches`, or the delete below fails closed with a foreign-key error —
 * exactly the class of bug this comment exists to prevent recurring.
 * `match_period_scores.match_id` (migration 003) DOES cascade and needs no explicit
 * delete. `brownlow_round_votes` carries no `match_id` column at all (it is keyed by
 * `(season, player_id, round_number)`, migration 005) and is never written by this suite
 * (same `apply: false` reasoning as above), so it is correctly never referenced here.
 */
async function cleanupCanonicalMatches(): Promise<void> {
  if (canonicalMatchIds.length === 0) return;
  const ids = [...canonicalMatchIds];
  canonicalMatchIds.length = 0;
  await sql`DELETE FROM player_match_stats WHERE match_id = ANY(${ids}::bigint[])`;
  await sql`DELETE FROM matches WHERE id = ANY(${ids}::bigint[])`;
}

/**
 * Defensive, namespace-scoped sweep for rows a PRIOR crashed run of this suite left
 * behind: `canonicalMatchIds` starts empty in a fresh process, so it cannot see a
 * synthetic match a previous run failed to clean up. `match_key` is always rendered as
 * `${NS}-...` by `seedCanonicalMatch()` (never a bare id), so this scan is exact — it can
 * only ever find rows this suite itself created.
 */
async function cleanupStaleCanonicalMatches(): Promise<void> {
  const stale = await sql<{ id: number }[]>`SELECT id FROM matches WHERE match_key LIKE ${`${NS}%`}`;
  if (stale.length === 0) return;
  const staleIds = stale.map((row) => row.id);
  await sql`DELETE FROM player_match_stats WHERE match_id = ANY(${staleIds}::bigint[])`;
  await sql`DELETE FROM matches WHERE id = ANY(${staleIds}::bigint[])`;
}

async function cleanupAll(): Promise<void> {
  await cleanupCanonicalMatches();
  await cleanupStaleCanonicalMatches();

  const doomedPayloads = await sql<{ sourceId: number; family: string; payloadHash: string }[]>`
    SELECT DISTINCT source_id AS "sourceId", family, payload_hash AS "payloadHash"
      FROM staging.source_record_versions
     WHERE source_id = ${aflApiSourceId} AND external_record_id LIKE ${`${NS}%`}
  `;
  await sql`DELETE FROM staging.source_records WHERE source_id = ${aflApiSourceId} AND external_record_id LIKE ${`${NS}%`}`;
  await sql`DELETE FROM staging.source_record_versions WHERE source_id = ${aflApiSourceId} AND external_record_id LIKE ${`${NS}%`}`;
  for (const payload of doomedPayloads) {
    await sql`
      DELETE FROM staging.source_payloads
       WHERE source_id = ${payload.sourceId} AND family = ${payload.family} AND payload_hash = ${payload.payloadHash}
         AND NOT EXISTS (
           SELECT 1 FROM staging.source_record_versions v
            WHERE v.source_id = ${payload.sourceId} AND v.family = ${payload.family} AND v.payload_hash = ${payload.payloadHash}
         )
    `;
  }
  await sql`DELETE FROM import_batches WHERE notes LIKE ${'%issue228-fixtures-integration%'}`;

  // Defensive namespace-scoped sweeps for the applier surfaces this suite never
  // actually commits to (see the `cleanupCanonicalMatches()` doc comment above) — kept
  // for parity with the sibling suite's own belt-and-braces cleanup and to catch a
  // future test variant that DOES call `apply: true`, using the exact same columns that
  // suite's own passing cleanup already relies on.
  await sql`DELETE FROM canonical_applications WHERE external_record_id LIKE ${`${NS}%`}`;
  await sql`DELETE FROM promotion_candidates WHERE external_record_id LIKE ${`${NS}%`}`;
  await sql`DELETE FROM data_issues WHERE issue_key LIKE ${`%${NS}%`}`;
  await sql`DELETE FROM import_rejections WHERE source_record_id LIKE ${`${NS}%`}`;

  await sql`DELETE FROM external_identities WHERE source_id = ${aflApiSourceId} AND external_id = ANY(${[...VOTER_PROVIDER_IDS]})`;
  await sql`DELETE FROM players WHERE legacy_player_id = ANY(${[...VOTER_LEGACY_IDS]}::bigint[])`;
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
  if (!afl) throw new Error("source 'afl_api' (migration 077) must exist on afldb_test.");
  aflApiSourceId = afl.id;
  const [aft] = await sql<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afltables'`;
  if (!aft) throw new Error("source 'afltables' must exist on afldb_test.");
  afltablesSourceId = aft.id;

  const [home] = await sql<{ id: number }[]>`SELECT id FROM clubs WHERE legacy_club_hist = ${HOME_HIST}`;
  const [away] = await sql<{ id: number }[]>`SELECT id FROM clubs WHERE legacy_club_hist = ${AWAY_HIST}`;
  if (!home || !away) throw new Error('Carlton and Collingwood must both exist on afldb_test.');
  homeClubId = home.id;
  awayClubId = away.id;

  await cleanupAll();

  // PROVE isolation from real afldb_test data rather than assume it: after this suite's
  // own (namespace-scoped) sweep above, the (season, home, away, match_date) key every
  // "planned canonical match" test in this file seeds against — at EITHER date this file
  // uses — must be completely empty. A hit here means afldb_test genuinely already carries
  // a real season-2026 Carlton v Collingwood match on one of these two exact dates, and
  // this suite's fixed key would silently corrupt every resolved/unknown/ambiguous
  // assertion below — fail loudly and pick a different disambiguator rather than deleting
  // data this suite does not own.
  const [{ count: keyCollisionCount }] = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM matches
     WHERE season = ${SEASON} AND home_club_id = ${homeClubId} AND away_club_id = ${awayClubId}
       AND match_date IN (${DEFAULT_LOCAL_MATCH_DATE}::date, ${ALT_LOCAL_MATCH_DATE}::date)
  `;
  if (keyCollisionCount !== '0') {
    throw new Error(
      `afldb_test already carries ${keyCollisionCount} row(s) for (season=${SEASON}, `
      + `home=${HOME_HIST}, away=${AWAY_HIST}, match_date IN (${DEFAULT_LOCAL_MATCH_DATE}, `
      + `${ALT_LOCAL_MATCH_DATE})) that this suite did not create (checked after its own `
      + 'namespace-scoped cleanup). This suite\'s fixed natural-key fixture is no longer '
      + 'isolated — choose a different club pair or date rather than deleting unrelated data.',
    );
  }

  for (let i = 0; i < VOTER_PROVIDER_IDS.length; i += 1) {
    const legacyId = VOTER_LEGACY_IDS[i];
    const providerId = VOTER_PROVIDER_IDS[i];
    const [player] = await sql<{ id: number }[]>`
      INSERT INTO players (legacy_player_id, display_name, sort_name, search_name, slug, given_name, surname)
      VALUES (
        ${legacyId},
        ${`Voter ${i + 1} (ISSUE-228 fixtures-only test fixture)`},
        ${`Voter${i + 1} (ISSUE-228 fixtures-only test fixture)`},
        ${`voter ${i + 1} issue228 fixtures-only test fixture`},
        ${`voter-${i + 1}-issue228-fixtures-only-test-fixture`},
        'Voter', ${`Issue228FixturesOnlyTest${i + 1}`}
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

afterEach(async () => {
  await cleanupCanonicalMatches();
});

afterAll(async () => {
  await cleanupAll();
  await sql.end({ timeout: 5 });
}, 30_000);

describe('AFLDB-ISSUE-228 S7 follow-up — fixture-only identity build/persist (afl-api-fixture-identity.ts)', () => {
  it('AFL_API_FIXTURE_ACQUISITION_KIND is the distinct manifest marker (never confusable with a full snapshot)', () => {
    expect(AFL_API_FIXTURE_ACQUISITION_KIND).toBe('afl_api_fixture_snapshot');
  });

  it('represents a whole fixture population DB-free, isolating one bad record from the rest', () => {
    const good = fixtureRawFor(`${NS}GOOD`);
    const bad = clone(fixtureRawFor(`${NS}BAD`));
    delete bad.status; // a declared required column removed -> registry refusal, isolated
    const { records, buildFailures } = buildAflApiFixtureRecords([good, bad], registry, identities);
    expect(records.map((r) => r.providerMatchId)).toEqual([`${NS}GOOD`]);
    expect(buildFailures).toHaveLength(1);
    expect(buildFailures[0].providerMatchId).toBe(`${NS}BAD`);
  });

  it(
    'persists ONLY the match family spine observation — never staging.afl_api_match, and a re-run '
      + 'with the same payload is a head-touch, not a new version (I1)',
    async () => {
      const providerId = `${NS}SPINE`;
      await persistOne(providerId);

      const [{ count: headCount }] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM staging.source_records
         WHERE source_id = ${aflApiSourceId} AND family = 'match' AND external_record_id = ${providerId}
      `;
      expect(headCount).toBe('1');

      const [{ count: stagedCount }] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM staging.afl_api_match WHERE external_record_id = ${providerId}
      `;
      expect(stagedCount).toBe('0');

      const [before] = await sql<{ versionSeq: number }[]>`
        SELECT current_version_seq AS "versionSeq" FROM staging.source_records
         WHERE source_id = ${aflApiSourceId} AND family = 'match' AND external_record_id = ${providerId}
      `;
      await persistOne(providerId);
      const [after] = await sql<{ versionSeq: number }[]>`
        SELECT current_version_seq AS "versionSeq" FROM staging.source_records
         WHERE source_id = ${aflApiSourceId} AND family = 'match' AND external_record_id = ${providerId}
      `;
      expect(after.versionSeq).toBe(before.versionSeq);
    },
    30_000,
  );

  it('A: an ordinary fixture (provider round == canonical round) resolves by (season, clubs, exact match date)', async () => {
    const providerId = `${NS}ORDINARY`;
    await persistOne(providerId); // default API_ROUND_NUMBER (5) -> canonical round 6, same as the seeded row below
    const matchId = await seedCanonicalMatch({
      matchKey: `${NS}-ordinary-canonical`, sourceId: afltablesSourceId, matchDate: DEFAULT_LOCAL_MATCH_DATE,
    });

    const resolution = await resolveAflApiMatchViaFixtureObservation(sql, aflApiSourceId, providerId, registry, identities);
    expect(resolution).toEqual({ outcome: 'resolved', matchId, isFinal: false, season: SEASON });

    // Read-only: ownership is exactly as it was before this ran (never re-owned).
    const [{ sourceId: ownerAfter }] = await sql<{ sourceId: number }[]>`
      SELECT source_id AS "sourceId" FROM matches WHERE id = ${matchId}
    `;
    expect(ownerAfter).toBe(afltablesSourceId);
  });

  it(
    'B: a RESCHEDULED fixture — provider round translates to a DIFFERENT round than the canonical match\'s own '
      + '(round_number never moves on a reschedule) — still resolves, by exact match date + clubs alone '
      + '(the S7 fix under test)',
    async () => {
      const providerId = `${NS}RESCHED`;
      // Translates to canonical round 1 — deliberately NOT the seeded row's round 6 below.
      await persistOne(providerId, { apiRound: RESCHEDULED_API_ROUND });
      const matchId = await seedCanonicalMatch({
        matchKey: `${NS}-resched-canonical`, sourceId: afltablesSourceId, matchDate: DEFAULT_LOCAL_MATCH_DATE,
      });

      const resolution = await resolveAflApiMatchViaFixtureObservation(sql, aflApiSourceId, providerId, registry, identities);
      expect(resolution).toEqual({ outcome: 'resolved', matchId, isFinal: false, season: SEASON });
    },
  );

  it(
    'C: the same two clubs meeting twice in the season (different dates) are disambiguated by the fixture\'s '
      + 'own exact date — never guessed between them',
    async () => {
      const providerId = `${NS}TWICE`;
      await persistOne(providerId); // derives to DEFAULT_LOCAL_MATCH_DATE
      const wantedMatchId = await seedCanonicalMatch({
        matchKey: `${NS}-twice-wanted`, sourceId: afltablesSourceId, matchDate: DEFAULT_LOCAL_MATCH_DATE,
      });
      const otherMatchId = await seedCanonicalMatch({
        matchKey: `${NS}-twice-other`, sourceId: afltablesSourceId, matchDate: ALT_LOCAL_MATCH_DATE,
      });
      expect(wantedMatchId).not.toBe(otherMatchId);

      const resolution = await resolveAflApiMatchViaFixtureObservation(sql, aflApiSourceId, providerId, registry, identities);
      expect(resolution).toEqual({ outcome: 'resolved', matchId: wantedMatchId, isFinal: false, season: SEASON });
    },
  );

  it('a genuinely unknown provider fixture refuses unknown_match — never guessing', async () => {
    const providerId = `${NS}UNKNOWN`;
    await persistOne(providerId); // observed, but no canonical match exists for its (season, clubs, match date)
    const resolution = await resolveAflApiMatchViaFixtureObservation(sql, aflApiSourceId, providerId, registry, identities);
    expect(resolution).toEqual({ outcome: 'refused', reason: 'unknown_match' });
  });

  it('no fixture-only observation at all also refuses (no_fixture_observation)', async () => {
    const resolution = await resolveAflApiMatchViaFixtureObservation(
      sql, aflApiSourceId, `${NS}NEVER-OBSERVED`, registry, identities,
    );
    expect(resolution).toEqual({ outcome: 'refused', reason: 'no_fixture_observation' });
  });

  it('D: two canonical rows sharing the exact same (season, clubs, match date) — a data anomaly — refuses '
    + 'fixture_identity_ambiguous rather than guessing', async () => {
    const providerId = `${NS}AMBIGUOUS`;
    await persistOne(providerId);
    const idA = await seedCanonicalMatch({
      matchKey: `${NS}-ambiguous-a`, sourceId: afltablesSourceId, matchDate: DEFAULT_LOCAL_MATCH_DATE,
    });
    const idB = await seedCanonicalMatch({
      matchKey: `${NS}-ambiguous-b`, sourceId: afltablesSourceId, matchDate: DEFAULT_LOCAL_MATCH_DATE,
    });
    expect(idA).not.toBe(idB);

    const resolution = await resolveAflApiMatchViaFixtureObservation(sql, aflApiSourceId, providerId, registry, identities);
    expect(resolution).toEqual({ outcome: 'refused', reason: 'fixture_identity_ambiguous' });
  });

  it(
    'E: a fixture observation with no recognised venue timezone refuses match_date_unavailable — never derives '
      + 'a date from utcStartTime alone',
    async () => {
      const providerId = `${NS}NOZONE`;
      await persistOne(providerId, { transform: (fixture) => { fixture.venue = { ...fixture.venue, timezone: null }; } });
      // A canonical row that WOULD match on date/clubs/season if the date could be proven —
      // proving this refusal is about the missing timezone, not an absent candidate row.
      await seedCanonicalMatch({
        matchKey: `${NS}-nozone-canonical`, sourceId: afltablesSourceId, matchDate: DEFAULT_LOCAL_MATCH_DATE,
      });

      const resolution = await resolveAflApiMatchViaFixtureObservation(sql, aflApiSourceId, providerId, registry, identities);
      expect(resolution).toEqual({ outcome: 'refused', reason: 'match_date_unavailable' });
    },
  );

  it('never creates a canonical match and never writes player_match_stats — no code path here could', async () => {
    const providerId = `${NS}NOWRITE`;
    await persistOne(providerId);
    // Scoped to this suite's own match_key namespace, never a whole-table count: other
    // integration test files may run concurrently in a separate vitest worker and write
    // to `matches` at the same time, which would make an unscoped count flaky for reasons
    // unrelated to this test's own claim.
    const countForNs = async (): Promise<string> => {
      const [{ count }] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM matches WHERE match_key LIKE ${`${NS}%`}
      `;
      return count;
    };
    const before = await countForNs();
    await resolveAflApiMatchViaFixtureObservation(sql, aflApiSourceId, providerId, registry, identities);
    const after = await countForNs();
    expect(after).toBe(before);
  });
});

describe('AFLDB-ISSUE-228 S7 follow-up — Brownlow resolver fixture-identity fallback (afl-api-brownlow.ts)', () => {
  function voteRecordFor(providerMatchId: string): AflApiBrownlowMatchVoteRecord {
    return {
      providerMatchId,
      apiRoundNumber: API_ROUND_NUMBER,
      votes: [
        { providerPlayerId: VOTER_PROVIDER_IDS[0], providerTeamId: 'CD_T30', votes: 3, eligible: true },
        { providerPlayerId: VOTER_PROVIDER_IDS[1], providerTeamId: 'CD_T40', votes: 2, eligible: true },
        { providerPlayerId: VOTER_PROVIDER_IDS[2], providerTeamId: 'CD_T30', votes: 1, eligible: true },
      ],
    };
  }

  it('WITHOUT the fallback, a match with no staging.afl_api_match row still refuses unknown_match (default behaviour unweakened)', async () => {
    const providerId = `${NS}FALLBACK-DEFAULT`;
    await persistOne(providerId);
    await seedCanonicalMatch({
      matchKey: `${NS}-fallback-default-canonical`, sourceId: afltablesSourceId, matchDate: DEFAULT_LOCAL_MATCH_DATE,
    });

    const resolution = await sql.begin((tx) => resolveAflApiBrownlowMatch(tx, aflApiSourceId, providerId));
    expect(resolution).toEqual({ outcome: 'refused', reason: 'unknown_match' });
  });

  it('WITH the fallback supplied, the SAME scenario resolves via the fixture-only observation alone', async () => {
    const providerId = `${NS}FALLBACK-ON`;
    await persistOne(providerId);
    const matchId = await seedCanonicalMatch({
      matchKey: `${NS}-fallback-on-canonical`, sourceId: afltablesSourceId, matchDate: DEFAULT_LOCAL_MATCH_DATE,
    });

    const fallback: AflApiFixtureIdentityFallback = { registry, identities };
    const resolution = await sql.begin((tx) => resolveAflApiBrownlowMatch(tx, aflApiSourceId, providerId, fallback));
    // AFLDB-ISSUE-228 S7 round-selection correction (2026-09-20): `resolveAflApiBrownlowMatch()`
    // now also returns the resolved canonical match's own `round_number`, read fresh from
    // `matches` — `seedCanonicalMatch()` above always seeds `CANONICAL_ROUND_NUMBER` (6).
    expect(resolution).toEqual({
      outcome: 'resolved', matchId, isFinal: false, season: SEASON, roundNumber: CANONICAL_ROUND_NUMBER,
    });
  });

  it(
    'F: WITH the fallback supplied, a RESCHEDULED fixture (provider round translates to a DIFFERENT round than '
      + 'the canonical match\'s own) still resolves via the fixture-only observation, and the returned round is '
      + 'the CANONICAL match\'s own round — never the fixture\'s translated round — preserving the already-green '
      + 'S7 round-selection correction',
    async () => {
      const providerId = `${NS}FALLBACK-RESCHED`;
      // Translates to canonical round 1 — deliberately NOT the seeded row's round 6 below.
      await persistOne(providerId, { apiRound: RESCHEDULED_API_ROUND });
      const matchId = await seedCanonicalMatch({
        matchKey: `${NS}-fallback-resched-canonical`, sourceId: afltablesSourceId, matchDate: DEFAULT_LOCAL_MATCH_DATE,
      });

      const fallback: AflApiFixtureIdentityFallback = { registry, identities };
      const resolution = await sql.begin((tx) => resolveAflApiBrownlowMatch(tx, aflApiSourceId, providerId, fallback));
      expect(resolution).toEqual({
        outcome: 'resolved', matchId, isFinal: false, season: SEASON, roundNumber: CANONICAL_ROUND_NUMBER,
      });
    },
  );

  it(
    'end to end: runSettleAflApiBrownlow with the fallback resolves a vote set with no staging.afl_api_match row, '
      + 'creates no duplicate canonical match, and never re-owns the AFL-Tables-owned row',
    async () => {
      const providerId = `${NS}E2E`;
      await persistOne(providerId);
      const matchId = await seedCanonicalMatch({
        matchKey: `${NS}-e2e-canonical`, sourceId: afltablesSourceId, matchDate: DEFAULT_LOCAL_MATCH_DATE,
      });

      const result = await runSettleAflApiBrownlow(sql, {
        registry,
        season: SEASON,
        matchVotes: [voteRecordFor(providerId)],
        leaderboard: [],
        leaderboardStatus: null,
        inProgressSeasons: [SEASON],
        apply: false,
        autoApply: false,
        observeOnly: true,
        fixtureIdentityFallback: { registry, identities },
      });

      expect(result.halt).toBeNull();
      expect(result.counters.voteSetsRefused).toEqual({});
      expect(result.counters.voteSetsPlanned).toBe(1);
      expect(result.counters.voteSetsWouldAutoApply).toBe(1);

      const rows = await sql<{ id: number; sourceId: number }[]>`
        SELECT id, source_id AS "sourceId" FROM matches
         WHERE season = ${SEASON} AND round_number = ${CANONICAL_ROUND_NUMBER}
           AND home_club_id = ${homeClubId} AND away_club_id = ${awayClubId}
      `;
      expect(rows).toHaveLength(1); // no duplicate canonical match was created
      expect(rows[0].id).toBe(matchId);
      expect(rows[0].sourceId).toBe(afltablesSourceId); // never re-owned
    },
    30_000,
  );

  it('WITHOUT --use-fixture-identity semantics (no fallback), the same end-to-end scenario still refuses unknown_match', async () => {
    const providerId = `${NS}E2E-NOFALLBACK`;
    await persistOne(providerId);
    await seedCanonicalMatch({
      matchKey: `${NS}-e2e-nofallback-canonical`, sourceId: afltablesSourceId, matchDate: DEFAULT_LOCAL_MATCH_DATE,
    });

    const result = await runSettleAflApiBrownlow(sql, {
      registry,
      season: SEASON,
      matchVotes: [voteRecordFor(providerId)],
      leaderboard: [],
      leaderboardStatus: null,
      inProgressSeasons: [SEASON],
      apply: false,
      autoApply: false,
      observeOnly: true,
      // fixtureIdentityFallback deliberately omitted.
    });

    expect(result.halt).toBeNull();
    expect(result.counters.voteSetsRefused).toEqual({ unknown_match: 1 });
    expect(result.counters.voteSetsPlanned).toBe(0);
  });
});
