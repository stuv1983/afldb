/**
 * AFLDB V2 Launch F (stream F-D) - the eligibility-aware Brownlow Medal model against a REAL
 * PostgreSQL (docs/v2/adr/0014-brownlow-eligibility.md; migration 113 `brownlow_eligibility_decisions`).
 *
 * What only a database can prove, and is proved here (the BP-2025-ELIGIBILITY-v1 cases are in their own block):
 *  - a decision writes exactly one audit-complete ledger row (decided_by, decided_at, verdict,
 *    citation, note, basis, and the season seal's correction record for a sealed season);
 *  - the superseding chain and the stale-decision refusal; every refusal writes NO row;
 *  - a leader whose eligibility is missing gives `requires_review`; an ambiguous one (the AFL API
 *    flag disagrees with the stored statement) gives `requires_review`;
 *  - the winner is recomputed deterministically after a decision, changing exactly as expected;
 *  - ties among eligible leaders are joint winners;
 *  - the raw votes (brownlow_season_votes, brownlow_round_votes, the staged votes) are untouched;
 *  - `afldb_import` can INSERT but cannot UPDATE, DELETE or TRUNCATE the ledger.
 *
 * SELF-CONTAINED: the isolated template holds NO reference rows, so this file seeds what it needs
 * (auth users, seasons 2085-2089, sources, clubs, players with AFL Tables identities, matches, stored
 * totals, staged votes) with a unique marker, and removes all of it again. EVERY FIXTURE IS
 * SYNTHETIC: invented ids, names and votes; the seasons are labels only (the sealed range is a
 * synthetic registry passed to the callers, not the real data/reference/seasons.json).
 *
 * Connections: the owner (AFLDB_TEST_DATABASE_URL) seeds and cleans; the callers run as the
 * `afldb_import` role (AFLDB_TEST_IMPORT_DATABASE_URL), exactly as production does.
 */
import './guard';

import { createHash } from 'node:crypto';

import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { postgresExecutor, postgresTransactionExecutor, type TransactionalSqlExecutor } from '@afldb/db';
import type { SeasonRegistry } from '@afldb/domain';

import {
  determineBrownlowSeasonForAdmin,
  recordBrownlowEligibilityForAdmin,
  type BrownlowDeterminationView,
  type OperationsDeps,
} from '@/lib/admin/operations-centre';
import {
  loadBrownlowEligibilityEvidence,
  recordBrownlowEligibilityDecision,
  publishBrownlowEligibilityInTransaction,
  type BrownlowEligibilityDecisionRequest,
} from '@/db/queries/brownlow-eligibility';
import { getBrownlowWinners } from '@/db/queries/brownlow';
import { getAward, getAwardWinners, getAwardSeason, getAwardSeasons, getAwardLeaders, listAwards } from '@/db/queries/awards';
import { compileAxis } from '@/db/queries/grid-solver';
import type { GridAxisState } from '@/search/grid-solver-spec';
import { audit, type AdminUser } from '@/lib/auth/session';

vi.mock('@/lib/auth/session', () => ({
  audit: vi.fn(async () => undefined),
  requireCapability: vi.fn(),
}));
const auditMock = vi.mocked(audit);

const MARKER = 'fd-elig-it';
const SEASONS = { tri: 2084, tie: 2086, ambiguous: 2087, open: 2088, sealed: 2089, published: 2085 } as const;
/** 2088 is open (in progress); 2085-2087 and 2089 are sealed. */
const REGISTRY: SeasonRegistry = { first_season: 2084, last_season: 2089, in_progress_seasons: [2088] };

const NOTE = 'SYNTHETIC ruling: the tribunal outcome was checked against the club statement.';
const CITATION = 'https://example.invalid/fd-elig-it/ruling';

const owner = postgres(process.env.AFLDB_TEST_DATABASE_URL!, { max: 2, onnotice: () => {} });
const importUrl = process.env.AFLDB_TEST_IMPORT_DATABASE_URL;
if (!importUrl) throw new Error('AFLDB_TEST_IMPORT_DATABASE_URL must be set (the isolated runner sets it): the callers run as afldb_import.');
const importSql = postgres(importUrl, { max: 2, onnotice: () => {} });
const executor: TransactionalSqlExecutor = postgresExecutor(importSql);

let superAdmin: AdminUser;
let plainAdmin: AdminUser;
const createdSources: string[] = [];
let createdUsers: number[] = [];
const playerIds: Record<string, number> = {};
let afltablesSourceId = 0;
let aflApiSourceId = 0;
let batchId = 0;
let matchId = 0;
let triMatchId = 0;

const deps = (): Partial<OperationsDeps> => ({
  withExecutor: (work) => work(executor),
  loadRegistry: () => REGISTRY,
  now: () => new Date('2026-10-19T12:00:00Z'),
});

/* ------------------------------------------------------------------ *
 * Seeding
 * ------------------------------------------------------------------ */

async function sourceId(key: string, kind: string): Promise<number> {
  const [existing] = await owner<{ id: number }[]>`SELECT id::int AS id FROM sources WHERE key = ${key}`;
  if (existing) return existing.id;
  const [row] = await owner<{ id: number }[]>`
    INSERT INTO sources (key, name, kind) VALUES (${key}, ${`${MARKER} ${key}`}, ${kind}) RETURNING id::int AS id`;
  createdSources.push(key);
  return row.id;
}

async function seedUser(email: string, role: 'admin' | 'super_admin'): Promise<AdminUser> {
  const [row] = await owner<{ id: number }[]>`
    INSERT INTO auth_users (email, role) VALUES (${email}, ${role}) RETURNING id::int AS id`;
  createdUsers.push(row.id);
  return { id: row.id, email, role, canManageAdmins: role === 'super_admin', mustChangePassword: false };
}

async function seedPlayer(tag: string, identities: number): Promise<number> {
  const [row] = await owner<{ id: number }[]>`
    INSERT INTO players (display_name, sort_name, search_name, slug)
    VALUES (${`${MARKER} ${tag}`}, ${`${MARKER} ${tag}`}, ${`${MARKER} ${tag}`.toLowerCase()}, ${`${MARKER}-${tag}`})
    RETURNING id::int AS id`;
  for (let n = 0; n < identities; n += 1) {
    await owner`
      INSERT INTO external_identities (source_id, external_id, player_id, status, match_method)
      VALUES (${afltablesSourceId}, ${`players/f/${MARKER}-${tag}-${n}.html`}, ${row.id},
              'unique'::link_status, 'afltables_profile_url')`;
  }
  playerIds[tag] = row.id;
  return row.id;
}

type StoredSeed = { tag: string; votes: number; rank: number | null; ineligible?: boolean; winner?: boolean; voteRank: number };

async function seedStored(season: number, rows: StoredSeed[]): Promise<void> {
  for (const row of rows) {
    await owner`
      INSERT INTO brownlow_season_votes (season, player_id, votes, vote_rank, eligible_rank, is_ineligible, is_winner)
      VALUES (${season}, ${playerIds[row.tag]}, ${row.votes}, ${row.voteRank}, ${row.rank},
              ${row.ineligible === true}, ${row.winner === true})`;
  }
}

async function seedStaged(
  season: number, votes: Array<{ tag: string; votes: number; eligible: boolean | null }>, forMatchId: number = matchId, suffix = '', round = 1,
): Promise<void> {
  const providerMatchId = `${MARKER}-m-${season}${suffix}`;
  const payloadHash = createHash('sha256').update(providerMatchId).digest('hex');
  await owner`
    INSERT INTO staging.source_payloads (source_id, family, payload_hash, hash_recipe, raw_payload)
    VALUES (${aflApiSourceId}, 'brownlow_match_votes', ${payloadHash}, ${MARKER}, ${owner.json({ marker: MARKER } as never)})`;
  await owner`
    INSERT INTO staging.source_record_versions
      (source_id, family, external_record_id, version_seq, payload_hash, observed_from, opened_by_batch_id)
    VALUES (${aflApiSourceId}, 'brownlow_match_votes', ${providerMatchId}, 1, ${payloadHash}, now(), ${batchId})`;
  for (const vote of votes) {
    await owner`
      INSERT INTO staging.afl_api_brownlow_vote (
        source_id, family, external_record_id, version_seq, provider_match_id, provider_player_id,
        provider_team_id, season, api_round_number, canonical_round_number, votes, eligible,
        match_id, player_id, club_id, projected_by_batch_id
      ) VALUES (
        ${aflApiSourceId}, 'brownlow_match_votes', ${providerMatchId}, 1, ${providerMatchId},
        ${`${MARKER}-${vote.tag}`}, ${`${MARKER}-team`}, ${season}, ${round}, ${round}, ${vote.votes}, ${vote.eligible},
        ${forMatchId}, ${playerIds[vote.tag]}, ${null}, ${batchId})`;
  }
}

/** Removes one season's staged fixture rows (the BP-2025 cases re-stage the same season repeatedly). */
async function clearStaged(season: number): Promise<void> {
  for (const providerMatchId of [`${MARKER}-m-${season}`, `${MARKER}-m-${season}b`]) {
    await owner`DELETE FROM staging.afl_api_brownlow_vote WHERE provider_match_id = ${providerMatchId}`;
    await owner`DELETE FROM staging.source_record_versions WHERE external_record_id = ${providerMatchId}`;
    await owner`DELETE FROM staging.source_payloads WHERE payload_hash = ${createHash('sha256').update(providerMatchId).digest('hex')}`;
  }
}

beforeAll(async () => {
  superAdmin = await seedUser(`${MARKER}-super@example.test`, 'super_admin');
  plainAdmin = await seedUser(`${MARKER}-admin@example.test`, 'admin');
  afltablesSourceId = await sourceId('afltables', 'scrape');
  aflApiSourceId = await sourceId('afl_api', 'upstream_dataset');
  await sourceId('manual_admin_edit', 'manual');
  for (const season of Object.values(SEASONS)) {
    await owner`INSERT INTO seasons (year, league, status) VALUES (${season}, 'AFL', 'complete'::season_status)`;
  }

  // Two clubs and one 2087 match, so the staged AFL API votes have a canonical match to resolve to.
  const clubIds: number[] = [];
  await owner.begin(async (tx) => {
    // clubs.current_identity_id is a DEFERRABLE self-reference: point it at the new row before commit.
    await tx`SET CONSTRAINTS ALL DEFERRED`;
    for (const letter of ['a', 'b']) {
      const [club] = await tx<{ id: number }[]>`
        INSERT INTO clubs (slug, name, short_name, abbreviation, current_identity_id, legacy_club_hist)
        VALUES (${`${MARKER}-club-${letter}`}, ${`${MARKER} club ${letter}`}, ${`FD ${letter}`}, ${`F${letter.toUpperCase()}`}, -1, ${`${MARKER}-club-${letter}`})
        RETURNING id::int AS id`;
      await tx`UPDATE clubs SET current_identity_id = ${club.id} WHERE id = ${club.id}`;
      clubIds.push(club.id);
    }
  });
  const [match] = await owner<{ id: number }[]>`
    INSERT INTO matches (match_key, season, round_code, round_type, round_number, is_final, match_date, venue_raw,
                         home_club_id, away_club_id, home_score, away_score, result, winner_club_id, margin, attendance_status)
    VALUES (${`${MARKER}-match`}, ${SEASONS.ambiguous}::smallint, '1', 'home_and_away', 1, false, '2087-03-01'::date, ${MARKER},
            ${clubIds[0]}, ${clubIds[1]}, 82, 76, 'home_win', ${clubIds[0]}, 6, 'not_collected')
    RETURNING id::int AS id`;
  matchId = match.id;
  const [triMatch] = await owner<{ id: number }[]>`
    INSERT INTO matches (match_key, season, round_code, round_type, round_number, is_final, match_date, venue_raw,
                         home_club_id, away_club_id, home_score, away_score, result, winner_club_id, margin, attendance_status)
    VALUES (${`${MARKER}-match-tri`}, ${SEASONS.tri}::smallint, '1', 'home_and_away', 1, false, '2084-03-01'::date, ${MARKER},
            ${clubIds[0]}, ${clubIds[1]}, 90, 70, 'home_win', ${clubIds[0]}, 20, 'not_collected')
    RETURNING id::int AS id`;
  triMatchId = triMatch.id;
  const [batch] = await owner<{ id: number }[]>`
    INSERT INTO import_batches (source_id, tool, target_table)
    VALUES (${aflApiSourceId}, ${MARKER}, 'staging.afl_api_brownlow_vote') RETURNING id::int AS id`;
  batchId = batch.id;

  // Players. F1 has no durable identity, F2 two AFL Tables identities, F3 an identity but no votes.
  for (const tag of ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'c1', 'c2', 'c3', 'd1', 'd2', 'e1', 'f3', 'g1', 'g2', 'g3']) await seedPlayer(tag, 1);
  await seedPlayer('f1', 0);
  await seedPlayer('f2', 2);

  // 2089 sealed: A1 leads on 30 but is a bare default (is_ineligible false, NO eligible rank) => MISSING.
  await seedStored(SEASONS.sealed, [
    { tag: 'a1', votes: 30, rank: null, winner: true, voteRank: 1 },
    { tag: 'a2', votes: 25, rank: 2, voteRank: 2 },
    { tag: 'a3', votes: 20, rank: 3, voteRank: 3 },
  ]);
  // 2087 sealed, one API match: B1 leads (3), recorded eligible in the stored table, but the AFL API flags B1 INELIGIBLE.
  await seedStored(SEASONS.ambiguous, [
    { tag: 'b1', votes: 3, rank: 1, winner: true, voteRank: 1 },
    { tag: 'b2', votes: 2, rank: 2, voteRank: 2 },
    { tag: 'b3', votes: 1, rank: 3, voteRank: 3 },
  ]);
  await seedStaged(SEASONS.ambiguous, [
    { tag: 'b1', votes: 3, eligible: false },
    { tag: 'b2', votes: 2, eligible: true },
    { tag: 'b3', votes: 1, eligible: true },
  ]);
  // 2086 sealed: two eligible players tie on 30.
  await seedStored(SEASONS.tie, [
    { tag: 'c1', votes: 30, rank: 1, winner: true, voteRank: 1 },
    { tag: 'c2', votes: 30, rank: 1, winner: true, voteRank: 1 },
    { tag: 'c3', votes: 20, rank: 3, voteRank: 3 },
  ]);
  // 2085 sealed: D1 leads on a bare default row; the season becomes administrator-published in one test.
  await seedStored(SEASONS.published, [
    { tag: 'd1', votes: 30, rank: null, winner: true, voteRank: 1 },
    { tag: 'd2', votes: 20, rank: 2, voteRank: 2 },
  ]);
  // 2088 open: stored votes for E1, F1 (no identity), F2 (two identities); F3 polled nothing.
  await seedStored(SEASONS.open, [
    { tag: 'e1', votes: 10, rank: 1, winner: true, voteRank: 1 },
    { tag: 'f1', votes: 5, rank: 2, voteRank: 2 },
    { tag: 'f2', votes: 4, rank: 3, voteRank: 3 },
  ]);
}, 120_000);

afterAll(async () => {
  const seasons = Object.values(SEASONS);
  const players = Object.values(playerIds);
  let failure: unknown;
  const step = async (work: () => Promise<unknown>) => { try { await work(); } catch (error) { failure ??= error; } };
  await step(() => owner`DELETE FROM brownlow_eligibility_decisions WHERE season = ANY(${seasons})`);
  await step(() => owner`DELETE FROM data_edits WHERE admin_user_id = ANY(${createdUsers})`);
  await step(() => owner`DELETE FROM player_career_stats WHERE player_id = ANY(${players})`);
  await step(() => owner`DELETE FROM brownlow_season_authority WHERE season = ANY(${seasons})`);
  await step(() => owner`DELETE FROM staging.afl_api_brownlow_vote WHERE provider_match_id LIKE ${`${MARKER}%`}`);
  await step(() => owner`DELETE FROM staging.source_record_versions WHERE external_record_id LIKE ${`${MARKER}%`}`);
  await step(() => owner`DELETE FROM staging.source_payloads WHERE hash_recipe = ${MARKER}`);
  await step(() => owner`DELETE FROM import_batches WHERE tool = ${MARKER}`);
  await step(() => owner`DELETE FROM brownlow_season_votes WHERE season = ANY(${seasons})`);
  await step(() => owner`DELETE FROM matches WHERE match_key LIKE ${`${MARKER}%`}`);
  await step(() => owner`DELETE FROM external_identities WHERE player_id = ANY(${players})`);
  await step(() => owner`DELETE FROM players WHERE id = ANY(${players})`);
  await step(() => owner`DELETE FROM clubs WHERE slug LIKE ${`${MARKER}%`}`);
  await step(() => owner`DELETE FROM seasons WHERE year = ANY(${seasons})`);
  if (createdSources.length > 0) await step(() => owner`DELETE FROM sources WHERE key = ANY(${createdSources})`);
  await step(() => owner`DELETE FROM auth_users WHERE id = ANY(${createdUsers})`);
  createdUsers = [];
  await importSql.end({ timeout: 5 });
  await owner.end({ timeout: 5 });
  if (failure !== undefined) throw failure;
});

beforeEach(() => {
  auditMock.mockClear();
});

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

type LedgerRow = {
  id: number; season: number; player_identity: string; player_id_at_decision: number; verdict: string;
  citation: string; note: string; decided_by: number; decided_at: Date; basis: string;
  correction: Record<string, unknown> | null; supersedes_id: number | null;
};

async function ledger(season?: number): Promise<LedgerRow[]> {
  return owner<LedgerRow[]>`
    SELECT id::int AS id, season::int AS season, player_identity, player_id_at_decision::int AS player_id_at_decision,
           verdict, citation, note, decided_by::int AS decided_by, decided_at, basis, correction,
           supersedes_id::int AS supersedes_id
      FROM brownlow_eligibility_decisions
     WHERE (${season ?? null}::int IS NULL OR season = ${season ?? null}::int) AND season = ANY(${Object.values(SEASONS)})
     ORDER BY id`;
}

async function ledgerCount(): Promise<number> {
  return (await ledger()).length;
}

/** md5 over every raw-vote row the fixtures own, so "untouched" is a comparison of bytes, not of counts. */
async function rawVoteFingerprint(): Promise<string> {
  const seasons = Object.values(SEASONS);
  const [row] = await owner<{ fingerprint: string }[]>`
    SELECT md5(
      coalesce((SELECT string_agg((to_jsonb(b) - 'is_winner' - 'is_ineligible' - 'eligible_rank')::text, '|' ORDER BY b.season, b.player_id)
                  FROM brownlow_season_votes b WHERE b.season = ANY(${seasons})), '')
      || '#' ||
      coalesce((SELECT string_agg(r::text, '|' ORDER BY r.id)
                  FROM brownlow_round_votes r WHERE r.player_id = ANY(${Object.values(playerIds)})), '')
      || '#' ||
      coalesce((SELECT string_agg(v::text, '|' ORDER BY v.provider_match_id, v.provider_player_id)
                  FROM staging.afl_api_brownlow_vote v WHERE v.provider_match_id LIKE ${`${MARKER}%`}), '')
    ) AS fingerprint`;
  return row.fingerprint;
}

async function determine(season: number, admin: AdminUser = superAdmin): Promise<BrownlowDeterminationView> {
  const result = await determineBrownlowSeasonForAdmin(admin, { season }, deps());
  if (!result.ok) throw new Error(`determine(${season}) refused: ${result.code}: ${result.error}`);
  return result.view;
}

const request = (over: Partial<BrownlowEligibilityDecisionRequest> & { tag?: string; season?: number } = {}): BrownlowEligibilityDecisionRequest => ({
  season: SEASONS.sealed,
  playerId: playerIds[over.tag ?? 'a1'],
  verdict: 'ineligible',
  citation: CITATION,
  note: NOTE,
  expectedCurrentDecisionId: null,
  decidedBy: superAdmin.id,
  viewer: { role: 'super_admin', canManageAdmins: true },
  sealed: { from: 2085, through: 2089, open: [2088] },
  ...over,
});

/* ------------------------------------------------------------------ *
 * The model, end to end (ORDER IS LOAD-BEARING within this block)
 * ------------------------------------------------------------------ */

describe('sealed season 2089: a missing leader, a decision, a superseding decision', () => {
  let before: string;
  let firstDecisionId = 0;
  let reviewChecksum = '';

  it('a leader whose stored row is a bare default is MISSING => requires_review naming the player; no winner', async () => {
    before = await rawVoteFingerprint();
    const view = await determine(SEASONS.sealed);
    expect(view.report).toMatchObject({ seasonState: 'complete', basis: 'stored_totals', voteGetters: 3 });
    expect(view.sealed).toBe(true);
    expect(view.seasonAdminPublished).toBe(false);
    expect(view.determination.status).toBe('requires_review');
    reviewChecksum = view.determination.inputChecksum;
    expect(view.determination.winners).toEqual([]);
    expect(view.determination.playersRequiringReview).toEqual([
      expect.objectContaining({ playerId: playerIds.a1, votes: 30, status: 'missing' }),
    ]);
    // The raw leaderboard still lists everyone, with the stored facts behind each status.
    expect(view.determination.rawLeaderboard.map((e) => [e.playerId, e.votes, e.eligibility.status])).toEqual([
      [playerIds.a1, 30, 'missing'], [playerIds.a2, 25, 'eligible'], [playerIds.a3, 20, 'eligible'],
    ]);
    expect(view.identities.find((i) => i.playerId === playerIds.a1)).toMatchObject({ state: 'resolved', identity: expect.stringMatching(/^afltables:players\/f\//) });
    expect(view.storedFlagCheck.state).toBe('not_applicable');
    expect(auditMock).not.toHaveBeenCalled(); // a read audits nothing
  });

  it('with unresolved leading eligibility publication clears a stale medal flag and preserves raw votes', async () => {
    const rawBefore = await rawVoteFingerprint();
    const result = await importSql.begin((tx) => publishBrownlowEligibilityInTransaction(postgresTransactionExecutor(tx), {
      season: SEASONS.sealed, registry: REGISTRY, actorId: superAdmin.id, note: NOTE,
    }));
    expect(result.determination.status).toBe('requires_review');
    expect(result.determination.winners).toEqual([]);
    expect((await getBrownlowWinners()).filter((r) => r.season === SEASONS.sealed)).toEqual([]);
    expect(await rawVoteFingerprint()).toBe(rawBefore);
  });

  it('the determination is deterministic: the same evidence gives the identical determination and checksum', async () => {
    const a = await determine(SEASONS.sealed);
    const b = await determine(SEASONS.sealed);
    expect(b.determination).toEqual(a.determination);
    expect(a.determination.inputChecksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a plain Admin may read the determination but is refused the decision, with no row written and the refusal audited once', async () => {
    expect((await determineBrownlowSeasonForAdmin(plainAdmin, { season: SEASONS.sealed }, deps())).ok).toBe(true);
    const rows = await ledgerCount();
    const refused = await recordBrownlowEligibilityForAdmin(plainAdmin, {
      season: SEASONS.sealed, playerId: playerIds.a1, verdict: 'ineligible', citation: CITATION, note: NOTE, expectedCurrentDecisionId: null,
    }, deps());
    expect(refused).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await ledgerCount()).toBe(rows);
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock.mock.calls[0][0]).toBe('admin.brownlow_eligibility_refused');
  });

  it('an ineligible ruling on a SEALED season is an audited correction: one audit-complete row, the winner changes to the runner-up', async () => {
    const result = await recordBrownlowEligibilityForAdmin(superAdmin, {
      season: SEASONS.sealed, playerId: playerIds.a1, verdict: 'ineligible', citation: `  ${CITATION}  `, note: `  ${NOTE}  `, expectedCurrentDecisionId: null,
    }, deps());
    expect(result).toMatchObject({ ok: true, supersededId: null });
    if (!result.ok) return;
    firstDecisionId = result.decision.id;

    const rows = await ledger(SEASONS.sealed);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({
      id: firstDecisionId, season: SEASONS.sealed, player_id_at_decision: playerIds.a1, verdict: 'ineligible',
      citation: CITATION, note: NOTE, decided_by: superAdmin.id, basis: 'audited_correction', supersedes_id: null,
    });
    expect(row.player_identity).toMatch(/^afltables:players\/f\/fd-elig-it-a1-0\.html$/);
    expect(row.decided_at).toBeInstanceOf(Date);
    expect(Math.abs(row.decided_at.getTime() - Date.now())).toBeLessThan(10 * 60_000);
    expect(row.correction).toEqual({
      season: SEASONS.sealed,
      workflow: 'brownlow_eligibility_decision',
      actorUserId: superAdmin.id,
      note: NOTE,
      evidenceRef: `brownlow_eligibility:${SEASONS.sealed}:${row.player_identity}`,
    });

    // The recomputed determination: the leader is excluded, the runner-up wins; the stored flag disagrees.
    const after = result.determination;
    expect(after).not.toBeNull();
    expect(after!.determination.status).toBe('determined');
    expect(after!.determination.winners).toEqual([{ playerId: playerIds.a2, votes: 25 }]);
    expect(after!.determination.excludedIneligible).toEqual([{ playerId: playerIds.a1, votes: 30 }]);
    expect(after!.determination.rawLeaderboard[0]).toMatchObject({
      playerId: playerIds.a1, votes: 30, eligibility: { status: 'ineligible', source: 'admin_decision', detail: { decisionId: firstDecisionId } },
    });
    expect(after!.storedFlagCheck).toEqual({ state: 'agrees', storedWinners: [playerIds.a2], determinedWinners: [playerIds.a2] });
    const publicWinners = await getBrownlowWinners();
    expect(publicWinners.filter((r) => r.season === SEASONS.sealed).map((r) => r.playerId)).toEqual([playerIds.a2]);
    const [award] = await owner`SELECT id FROM awards WHERE slug='brownlow-medal'`;
    expect(award, 'historical Brownlow definition is required').toBeDefined();
    expect(await getAward('brownlow-medal')).toBeNull();
    expect((await listAwards()).some((a) => a.slug === 'brownlow-medal')).toBe(false);
    expect(await getAwardWinners(award.id)).toEqual([]);
    expect(await getAwardSeason(award.id, SEASONS.sealed)).toEqual([]);
    expect(await getAwardSeasons(award.id)).toEqual([]);
    expect(await getAwardLeaders(award.id)).toEqual([]);
    // These deliberately minimal fixtures have NULL playing-career facts. Test
    // the award criterion itself, not an unrelated games>=0 intersection.
    const genericAxes: GridAxisState[] = [
      { builder: 'award_winner', params: { award: String(award.id) } },
      { builder: 'award_winner_min_times', params: { award: String(award.id), times: '1' } },
      { builder: 'award_winner_between_seasons', params: { award: String(award.id), from: String(SEASONS.sealed), to: String(SEASONS.sealed) } },
    ];
    for (const axis of genericAxes) {
      const generic = await owner`SELECT p.id FROM players p
        WHERE p.id IN (${playerIds.a1}, ${playerIds.a2}) AND ${compileAxis(axis)} ORDER BY p.id`;
      expect(generic.map((r) => r.id)).toEqual([playerIds.a2]);
    }
    expect(after!.determination.inputChecksum).not.toBe(reviewChecksum);

    // Audited once, as done, with ids and codes only.
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock.mock.calls[0][0]).toBe('admin.brownlow_eligibility_decided');
    expect(auditMock.mock.calls[0][1]).toMatchObject({
      operation: 'decide_eligibility', season: SEASONS.sealed, playerId: playerIds.a1, outcome: 'decided',
      decisionId: firstDecisionId, verdict: 'ineligible', basis: 'audited_correction', determinationStatus: 'determined',
    });
    expect(JSON.stringify(auditMock.mock.calls[0][1])).not.toContain(NOTE);
  });

  it('the recompute is the SAME as a fresh read: a deterministic function of the evidence', async () => {
    const fresh = await determine(SEASONS.sealed);
    expect(fresh.determination.status).toBe('determined');
    expect(fresh.determination.winners).toEqual([{ playerId: playerIds.a2, votes: 25 }]);
    expect(fresh.decisions.map((d) => [d.id, d.current])).toEqual([[firstDecisionId, true]]);
  });

  it('a decision made against a STALE view is refused and writes nothing', async () => {
    const rows = await ledgerCount();
    const stale = await recordBrownlowEligibilityForAdmin(superAdmin, {
      season: SEASONS.sealed, playerId: playerIds.a1, verdict: 'eligible', citation: CITATION, note: NOTE, expectedCurrentDecisionId: null,
    }, deps());
    expect(stale).toMatchObject({ ok: false, code: 'stale_decision' });
    expect(await ledgerCount()).toBe(rows);
    const wrong = await recordBrownlowEligibilityForAdmin(superAdmin, {
      season: SEASONS.sealed, playerId: playerIds.a1, verdict: 'eligible', citation: CITATION, note: NOTE, expectedCurrentDecisionId: firstDecisionId + 1000,
    }, deps());
    expect(wrong).toMatchObject({ ok: false, code: 'stale_decision' });
    expect(await ledgerCount()).toBe(rows);
  });

  it('a later decision SUPERSEDES the first (a single chain); the winner is recomputed; nothing is edited or deleted', async () => {
    const result = await recordBrownlowEligibilityForAdmin(superAdmin, {
      season: SEASONS.sealed, playerId: playerIds.a1, verdict: 'eligible', citation: CITATION, note: `${NOTE} Reversed on appeal.`, expectedCurrentDecisionId: firstDecisionId,
    }, deps());
    expect(result).toMatchObject({ ok: true, supersededId: firstDecisionId });
    if (!result.ok) return;

    const rows = await ledger(SEASONS.sealed);
    expect(rows.map((r) => [r.id, r.verdict, r.supersedes_id])).toEqual([
      [firstDecisionId, 'ineligible', null],
      [result.decision.id, 'eligible', firstDecisionId],
    ]);
    expect(rows[0].note).toBe(NOTE); // the first row is exactly as it was
    expect(result.decision.current).toBe(true);

    const after = result.determination!;
    expect(after.determination.status).toBe('determined');
    expect(after.determination.winners).toEqual([{ playerId: playerIds.a1, votes: 30 }]);
    expect(after.determination.excludedIneligible).toEqual([]);
    // The stored table still flags A1 as the winner: the two now agree.
    expect(after.storedFlagCheck.state).toBe('agrees');
    expect(after.decisions.filter((d) => d.current).map((d) => d.id)).toEqual([result.decision.id]);
  });

  it('through all of it the RAW VOTES are untouched, byte for byte', async () => {
    expect(await rawVoteFingerprint()).toBe(before);
  });

  it('republication is idempotent and preserves the audited decision history', async () => {
    const [before] = await owner`SELECT count(*)::int AS n FROM data_edits WHERE field_group = 'eligibility_publication'`;
    const result = await importSql.begin((tx) => publishBrownlowEligibilityInTransaction(postgresTransactionExecutor(tx), {
      season: SEASONS.sealed, registry: REGISTRY, actorId: superAdmin.id, note: NOTE,
    }));
    expect(result.changed).toBe(false);
    const [after] = await owner`SELECT count(*)::int AS n FROM data_edits WHERE field_group = 'eligibility_publication'`;
    expect(after.n).toBe(before.n);
    expect((await ledger(SEASONS.sealed)).length).toBe(2);
  });

  it('a required publication audit failure rolls back the decision and every public metadata change', async () => {
    const before = await owner`SELECT to_jsonb(b) AS row FROM brownlow_season_votes b WHERE season=${SEASONS.sealed} ORDER BY player_id`;
    const history = await ledger(SEASONS.sealed);
    await owner`CREATE FUNCTION fd_test_publication_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.field_group='eligibility_publication' THEN RAISE EXCEPTION 'forced publication audit failure'; END IF; RETURN NEW; END $$`;
    await owner`CREATE TRIGGER fd_test_publication_failure BEFORE INSERT ON data_edits FOR EACH ROW EXECUTE FUNCTION fd_test_publication_failure()`;
    try {
      await expect(recordBrownlowEligibilityDecision(executor, request({
        expectedCurrentDecisionId: history.at(-1)!.id, publicationRegistry: REGISTRY,
      }))).rejects.toThrow('forced publication audit failure');
      expect(await ledger(SEASONS.sealed)).toEqual(history);
      expect(await owner`SELECT to_jsonb(b) AS row FROM brownlow_season_votes b WHERE season=${SEASONS.sealed} ORDER BY player_id`).toEqual(before);
    } finally {
      await owner`DROP TRIGGER fd_test_publication_failure ON data_edits`;
      await owner`DROP FUNCTION fd_test_publication_failure()`;
    }
  });
});

describe('ambiguous: the AFL API flag disagrees with the stored statement (season 2087, staged votes)', () => {
  it('requires_review naming the ambiguous leader; the loader reads the staged flag; a provider flag contradicting a recorded statement never decides', async () => {
    const view = await determine(SEASONS.ambiguous);
    expect(view.report).toMatchObject({ seasonState: 'complete', basis: 'api_round_votes' });
    expect(view.determination.status).toBe('requires_review');
    expect(view.determination.playersRequiringReview).toEqual([
      expect.objectContaining({ playerId: playerIds.b1, votes: 3, status: 'ambiguous' }),
    ]);
    expect(view.determination.rawLeaderboard[0].eligibility.detail).toMatchObject({ provider: 'ineligible', stored: 'recorded_eligible' });

    const evidence = await loadBrownlowEligibilityEvidence(executor, { season: SEASONS.ambiguous, playerIds: [playerIds.b1, playerIds.b2] });
    expect(evidence.players).toEqual([
      { playerId: playerIds.b1, decision: null, stored: { isIneligible: false, eligibleRank: 1 }, stagedFlags: [false] },
      { playerId: playerIds.b2, decision: null, stored: { isIneligible: false, eligibleRank: 2 }, stagedFlags: [true] },
    ].map((player) => ({
      ...player, stagedUnknown: 0,
      providerProvenance: { source: 'afl_api', families: ['brownlow_match_votes'], observations: 1, versionSeqs: [1], batchIds: [batchId] },
    })).sort((x, y) => x.playerId - y.playerId));
  });

  it('an OPEN-or-sealed decision resolves it: eligible => the leader is determined (the raw votes untouched)', async () => {
    const before = await rawVoteFingerprint();
    const result = await recordBrownlowEligibilityForAdmin(superAdmin, {
      season: SEASONS.ambiguous, playerId: playerIds.b1, verdict: 'eligible', citation: CITATION, note: NOTE, expectedCurrentDecisionId: null,
    }, deps());
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.determination!.determination.status).toBe('determined');
    expect(result.determination!.determination.winners).toEqual([{ playerId: playerIds.b1, votes: 3 }]);
    expect(result.determination!.determination.rawLeaderboard[0].eligibility).toMatchObject({ status: 'eligible', source: 'admin_decision' });
    expect(await rawVoteFingerprint()).toBe(before);
  });
});

describe('ties among eligible leaders (season 2086)', () => {
  it('are joint winners; the stored flags agree', async () => {
    const view = await determine(SEASONS.tie);
    expect(view.determination.status).toBe('determined');
    expect(view.determination.tie).toBe(true);
    expect(view.determination.winners).toEqual([
      { playerId: playerIds.c1, votes: 30 }, { playerId: playerIds.c2, votes: 30 },
    ].sort((a, b) => a.playerId - b.playerId));
    expect(view.determination.rawLeaderboard.map((e) => e.rank)).toEqual([1, 1, 3]);
    expect(view.storedFlagCheck.state).toBe('agrees');
  });

  it('an unresolved tied leader blocks every winner criterion until a decision publishes both joint winners', async () => {
    const before = await rawVoteFingerprint();
    await owner`UPDATE brownlow_season_votes SET eligible_rank=NULL
      WHERE season=${SEASONS.tie} AND player_id=${playerIds.c1}`;
    const result = await importSql.begin((tx) => publishBrownlowEligibilityInTransaction(postgresTransactionExecutor(tx), {
      season: SEASONS.tie, registry: REGISTRY, actorId: superAdmin.id, note: NOTE,
    }));
    expect(result.determination.status).toBe('requires_review');
    const winnerAxes: GridAxisState[] = [
      { builder: 'brownlow_finish_exact', params: { place: '1' } },
      { builder: 'brownlow_top_finish', params: { place: '1' } },
      { builder: 'brownlow_top_finish_min_times', params: { place: '1', times: '1' } },
    ];
    for (const axis of winnerAxes) {
      const rows = await owner`SELECT p.id FROM players p WHERE p.id IN (${playerIds.c1},${playerIds.c2}) AND ${compileAxis(axis)}`;
      expect(rows).toEqual([]);
    }
    const resolved = await recordBrownlowEligibilityForAdmin(superAdmin, {
      season: SEASONS.tie, playerId: playerIds.c1, verdict: 'eligible', citation: CITATION, note: NOTE, expectedCurrentDecisionId: null,
    }, deps());
    expect(resolved.ok).toBe(true);
    expect((await getBrownlowWinners()).filter((r) => r.season === SEASONS.tie).map((r) => r.playerId).sort((a,b) => a-b))
      .toEqual([playerIds.c1,playerIds.c2].sort((a,b) => a-b));
    expect(await rawVoteFingerprint()).toBe(before);
  });

  it('a ruling that one of the tied players is ineligible leaves the other as the sole winner', async () => {
    const result = await recordBrownlowEligibilityForAdmin(superAdmin, {
      season: SEASONS.tie, playerId: playerIds.c2, verdict: 'ineligible', citation: CITATION, note: NOTE, expectedCurrentDecisionId: null,
    }, deps());
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.determination!.determination.winners).toEqual([{ playerId: playerIds.c1, votes: 30 }]);
    expect(result.determination!.determination.tie).toBe(false);
  });
});

describe('administrator publication makes the stored default a recorded statement (season 2085)', () => {
  it('missing before the season is administrator-published, eligible after', async () => {
    expect((await determine(SEASONS.published)).determination.status).toBe('requires_review');
    await owner`
      INSERT INTO brownlow_season_authority (season, revision, published_revision, published_by, published_at, updated_by)
      VALUES (${SEASONS.published}, 1, 1, ${superAdmin.id}, now(), ${superAdmin.id})`;
    const view = await determine(SEASONS.published);
    expect(view.seasonAdminPublished).toBe(true);
    expect(view.determination.status).toBe('determined');
    expect(view.determination.winners).toEqual([{ playerId: playerIds.d1, votes: 30 }]);
    expect(view.determination.rawLeaderboard[0].eligibility.detail.stored).toBe('recorded_eligible');
  });
});

describe('an OPEN season records an open_season decision with no correction (season 2088)', () => {
  it('basis open_season, correction NULL; the determination of an in-progress season stays season_incomplete', async () => {
    const result = await recordBrownlowEligibilityForAdmin(superAdmin, {
      season: SEASONS.open, playerId: playerIds.e1, verdict: 'eligible', citation: CITATION, note: NOTE, expectedCurrentDecisionId: null,
    }, deps());
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const [row] = (await ledger(SEASONS.open)).filter((r) => r.id === result.decision.id);
    expect(row).toMatchObject({ basis: 'open_season', correction: null, verdict: 'eligible', decided_by: superAdmin.id });
    expect(result.determination!.determination.status).toBe('season_incomplete');
    expect(result.determination!.sealed).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * BP-2025-ELIGIBILITY-v1: eligible / ineligible / unknown, end to end (season 2084, staged votes)
 * ------------------------------------------------------------------ */

describe('BP-2025-ELIGIBILITY-v1 against PostgreSQL (season 2084)', () => {
  const TRI = SEASONS.tri;
  const sealed2084 = { from: 2084, through: 2089, open: [2088] };
  type Flag = boolean | null;

  /** Stored rows are bare defaults (no eligible rank): not a recorded statement. g1 starts as the stale default winner. */
  async function stage(flags: { g1: Flag; g2: Flag; g3: Flag }): Promise<void> {
    await owner`DELETE FROM brownlow_eligibility_decisions WHERE season = ${TRI}`;
    await owner`DELETE FROM brownlow_season_votes WHERE season = ${TRI}`;
    await clearStaged(TRI);
    await seedStored(TRI, [
      { tag: 'g1', votes: 3, rank: null, winner: true, voteRank: 1 },
      { tag: 'g2', votes: 2, rank: null, voteRank: 2 },
      { tag: 'g3', votes: 1, rank: null, voteRank: 3 },
    ]);
    await seedStaged(TRI, [
      { tag: 'g1', votes: 3, eligible: flags.g1 },
      { tag: 'g2', votes: 2, eligible: flags.g2 },
      { tag: 'g3', votes: 1, eligible: flags.g3 },
    ], triMatchId);
  }

  async function storedRows() {
    return owner<{ is_winner: boolean; is_ineligible: boolean; eligible_rank: number | null }[]>`
      SELECT b.is_winner, b.is_ineligible, b.eligible_rank::int AS eligible_rank
        FROM brownlow_season_votes b WHERE b.season = ${TRI} ORDER BY b.vote_rank, b.player_id`;
  }
  const shape = async () => (await storedRows()).map((r) => [r.is_winner, r.is_ineligible, r.eligible_rank]);
  const publicationEdits = async () => (await owner`SELECT count(*)::int AS n FROM data_edits WHERE field_group = 'eligibility_publication'`)[0].n as number;

  const publish = (onUnresolved?: 'withhold' | 'refuse') => importSql.begin((tx) => publishBrownlowEligibilityInTransaction(
    postgresTransactionExecutor(tx), { season: TRI, registry: REGISTRY, actorId: superAdmin.id, note: NOTE, onUnresolved }));

  it('migration 117 relaxed the staged eligible column: NULL is storable', async () => {
    const [col] = await owner`SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'staging' AND table_name = 'afl_api_brownlow_vote' AND column_name = 'eligible'`;
    expect(col.is_nullable).toBe('YES');
    await stage({ g1: null, g2: true, g3: true });
    const [nulls] = await owner`SELECT count(*)::int AS n FROM staging.afl_api_brownlow_vote
      WHERE provider_match_id = ${`${MARKER}-m-${TRI}`} AND eligible IS NULL`;
    expect(nulls.n).toBe(1);
  });

  it('explicit true everywhere: eligible via the provider snapshot, provenance retained, ranks published, the audit records the evidence', async () => {
    await stage({ g1: true, g2: true, g3: true });
    const raw = await rawVoteFingerprint();
    const view = await determine(TRI);
    expect(view.determination.status).toBe('determined');
    expect(view.determination.winners).toEqual([{ playerId: playerIds.g1, votes: 3 }]);
    expect(view.determination.rawLeaderboard.map((e) => [e.eligibility.status, e.eligibility.source, e.eligibleRank]))
      .toEqual([['eligible', 'provider_snapshot', 1], ['eligible', 'provider_snapshot', 2], ['eligible', 'provider_snapshot', 3]]);
    expect(view.determination.rawLeaderboard[0].eligibility.detail.providerProvenance)
      .toEqual({ source: 'afl_api', families: ['brownlow_match_votes'], observations: 1, versionSeqs: [1], batchIds: [batchId] });
    const result = await publish();
    expect(result.publication).toEqual({ state: 'published', unresolvedPlayerIds: [] });
    expect(await shape()).toEqual([[true, false, 1], [false, false, 2], [false, false, 3]]);
    const [edit] = await owner`SELECT new_values FROM data_edits
      WHERE field_group = 'eligibility_publication' AND row_id = ${TRI} ORDER BY id DESC LIMIT 1`;
    expect(edit.new_values.eligibilityEvidence[0]).toMatchObject({
      status: 'eligible', source: 'provider_snapshot', provider: 'eligible', providerProvenance: { batchIds: [batchId] },
    });
    expect(await rawVoteFingerprint()).toBe(raw);
  });

  it('explicit false: ineligible by provider evidence; the runner-up wins and the votes are kept', async () => {
    await stage({ g1: false, g2: true, g3: true });
    const view = await determine(TRI);
    expect(view.determination.winners).toEqual([{ playerId: playerIds.g2, votes: 2 }]);
    expect(view.determination.excludedIneligible).toEqual([{ playerId: playerIds.g1, votes: 3 }]);
    await publish();
    expect(await shape()).toEqual([[false, true, null], [true, false, 1], [false, false, 2]]);
    expect((await storedRows()).length).toBe(3);
  });

  it('a NULL leader flag is unknown: no winner, no ranks; publication clears the stale default winner but never rewrites eligibility', async () => {
    await stage({ g1: null, g2: true, g3: true });
    const raw = await rawVoteFingerprint();
    const view = await determine(TRI);
    expect(view.determination).toMatchObject({ status: 'requires_review', winners: [], rankingDeterminate: false });
    expect(view.determination.rawLeaderboard[0].eligibility).toMatchObject({ status: 'missing', detail: { provider: 'unknown' } });
    const result = await publish();
    expect(result.publication).toEqual({ state: 'partial', unresolvedPlayerIds: [playerIds.g1] });
    expect(await shape()).toEqual([[false, false, null], [false, false, null], [false, false, null]]);
    expect(await rawVoteFingerprint()).toBe(raw);
  });

  it('a NULL flag BELOW the winner leaves the winner determined and the lower ranks unstated', async () => {
    await stage({ g1: true, g2: null, g3: true });
    const view = await determine(TRI);
    expect(view.determination.status).toBe('determined');
    expect(view.determination.winners).toEqual([{ playerId: playerIds.g1, votes: 3 }]);
    expect(view.determination.rankingDeterminate).toBe(false);
    expect(view.determination.rawLeaderboard.map((e) => e.eligibleRank)).toEqual([1, null, null]);
    const result = await publish();
    expect(result.publication).toEqual({ state: 'withheld', unresolvedPlayerIds: [playerIds.g2] }); // the stale winner flag already agrees
    expect(await shape()).toEqual([[true, false, null], [false, false, null], [false, false, null]]);
  });

  it('publication REFUSAL rolls back: with refuse the transaction aborts and nothing changes', async () => {
    await stage({ g1: null, g2: true, g3: true });
    const before = await storedRows();
    const edits = await publicationEdits();
    await expect(publish('refuse')).rejects.toThrow(/unknown eligibility/);
    expect(await storedRows()).toEqual(before);
    expect(await publicationEdits()).toBe(edits);
  });

  it('a decision recorded in require mode rolls back with the refused publication; nothing is written', async () => {
    await stage({ g1: null, g2: true, g3: true });
    const before = await storedRows();
    const rows = await ledgerCount();
    // The ruling is about g2, so g1 stays unknown and the publication must refuse.
    await expect(recordBrownlowEligibilityDecision(executor, request({
      season: TRI, tag: 'g2', verdict: 'eligible', sealed: sealed2084, publicationRegistry: REGISTRY, publicationMode: 'require',
    }))).rejects.toThrow(/unknown eligibility/);
    expect(await ledgerCount()).toBe(rows);
    expect(await storedRows()).toEqual(before);
  });

  it('an audited decision resolves the unknown, then a superseding decision flips it; both are published and nothing is edited', async () => {
    await stage({ g1: null, g2: true, g3: true });
    const raw = await rawVoteFingerprint();
    const first = await recordBrownlowEligibilityDecision(executor, request({
      season: TRI, tag: 'g1', verdict: 'eligible', sealed: sealed2084, publicationRegistry: REGISTRY, publicationMode: 'require',
    }));
    expect(first).toMatchObject({ ok: true, publication: { state: 'published', unresolvedPlayerIds: [] } });
    if (!first.ok) return;
    expect(await shape()).toEqual([[true, false, 1], [false, false, 2], [false, false, 3]]);
    const second = await recordBrownlowEligibilityDecision(executor, request({
      season: TRI, tag: 'g1', verdict: 'ineligible', sealed: sealed2084, expectedCurrentDecisionId: first.decision.id,
      publicationRegistry: REGISTRY, publicationMode: 'require', note: `${NOTE} Superseded on review.`,
    }));
    expect(second).toMatchObject({ ok: true, supersededId: first.decision.id });
    expect(await shape()).toEqual([[false, true, null], [true, false, 1], [false, false, 2]]);
    expect((await ledger(TRI)).map((r) => [r.verdict, r.supersedes_id])).toEqual([['eligible', null], ['ineligible', first.decision.id]]);
    expect(await rawVoteFingerprint()).toBe(raw);
  });

  it('an audited eligible ruling publishes the winner atomically after correcting conflicting stored eligibility and stale ranks', async () => {
    await stage({ g1: true, g2: true, g3: true });
    // Preserved flags/ranks from an earlier partial publication: the stored flag now disagrees
    // with both the provider and the ranks. The ruling must repair metadata and winner together.
    await owner`UPDATE brownlow_season_votes SET is_ineligible = true, eligible_rank = 1, is_winner = false
      WHERE season = ${TRI} AND player_id = ${playerIds.g1}`;
    await owner`UPDATE brownlow_season_votes SET eligible_rank = CASE player_id
      WHEN ${playerIds.g2} THEN 2 ELSE 3 END WHERE season = ${TRI} AND player_id <> ${playerIds.g1}`;
    const raw = await rawVoteFingerprint();
    expect((await determine(TRI)).determination.status).toBe('refused_unreconciled_evidence');
    const result = await recordBrownlowEligibilityDecision(executor, request({
      season: TRI, tag: 'g1', verdict: 'eligible', sealed: sealed2084,
      publicationRegistry: REGISTRY, publicationMode: 'require',
    }));
    expect(result).toMatchObject({ ok: true, publication: { state: 'published', unresolvedPlayerIds: [] } });
    expect(await shape()).toEqual([[true, false, 1], [false, false, 2], [false, false, 3]]);
    const view = await determine(TRI);
    expect(view.determination.status).toBe('determined');
    expect(view.storedFlagCheck.state).toBe('agrees');
    const [edit] = await owner`SELECT new_values FROM data_edits
      WHERE field_group = 'eligibility_publication' AND row_id = ${TRI} ORDER BY id DESC LIMIT 1`;
    expect(edit.new_values).toMatchObject({ status: 'determined', winners: [playerIds.g1] });
    expect(await rawVoteFingerprint()).toBe(raw);
  });

  it('an eligibility correction does not bypass a wrong raw vote rank', async () => {
    await stage({ g1: true, g2: true, g3: true });
    await owner`UPDATE brownlow_season_votes SET is_ineligible = true, eligible_rank = 1,
      vote_rank = 99, is_winner = false WHERE season = ${TRI} AND player_id = ${playerIds.g1}`;
    const raw = await rawVoteFingerprint();
    const result = await recordBrownlowEligibilityDecision(executor, request({
      season: TRI, tag: 'g1', verdict: 'eligible', sealed: sealed2084, publicationRegistry: REGISTRY,
    }));
    expect(result.ok).toBe(true);
    const view = await determine(TRI);
    expect(view.determination.status).toBe('refused_unreconciled_evidence');
    expect(view.determination.winners).toEqual([]);
    expect((await storedRows()).every((row) => !row.is_winner)).toBe(true);
    expect(await rawVoteFingerprint()).toBe(raw);
  });

  it('an audited decision takes precedence over explicit provider evidence in the opposite direction', async () => {
    await stage({ g1: true, g2: true, g3: true });
    const result = await recordBrownlowEligibilityDecision(executor, request({
      season: TRI, tag: 'g1', verdict: 'ineligible', sealed: sealed2084, publicationRegistry: REGISTRY,
    }));
    expect(result.ok).toBe(true);
    const view = await determine(TRI);
    expect(view.determination.rawLeaderboard[0].eligibility).toMatchObject({ status: 'ineligible', source: 'admin_decision' });
    expect(view.determination.winners).toEqual([{ playerId: playerIds.g2, votes: 2 }]);
  });

  it('joint eligible winners are preserved through publication even with an unknown player below them', async () => {
    await stage({ g1: true, g2: true, g3: null });
    // Two matches: g1 3+2 and g2 2+3 both finish on 5; g3 (unknown eligibility) finishes on 2.
    const [homeClub, awayClub] = await owner<{ id: number }[]>`SELECT id::int AS id FROM clubs WHERE slug LIKE ${`${MARKER}-club-%`} ORDER BY slug`;
    const [matchB] = await owner<{ id: number }[]>`
      INSERT INTO matches (match_key, season, round_code, round_type, round_number, is_final, match_date, venue_raw,
                           home_club_id, away_club_id, home_score, away_score, result, winner_club_id, margin, attendance_status)
      VALUES (${`${MARKER}-match-tri-b`}, ${TRI}::smallint, '2', 'home_and_away', 2, false, '2084-03-08'::date, ${MARKER},
              ${awayClub.id}, ${homeClub.id}, 70, 80, 'away_win', ${homeClub.id}, 10, 'not_collected')
      RETURNING id::int AS id`;
    try {
      await owner`DELETE FROM brownlow_season_votes WHERE season = ${TRI}`;
      await clearStaged(TRI);
      await seedStored(TRI, [
        { tag: 'g1', votes: 5, rank: null, winner: true, voteRank: 1 },
        { tag: 'g2', votes: 5, rank: null, voteRank: 1 },
        { tag: 'g3', votes: 2, rank: null, voteRank: 3 },
      ]);
      await seedStaged(TRI, [
        { tag: 'g1', votes: 3, eligible: true }, { tag: 'g2', votes: 2, eligible: true }, { tag: 'g3', votes: 1, eligible: null },
      ], triMatchId);
      await seedStaged(TRI, [
        { tag: 'g2', votes: 3, eligible: true }, { tag: 'g1', votes: 2, eligible: true }, { tag: 'g3', votes: 1, eligible: null },
      ], matchB.id, 'b', 2);
      const view = await determine(TRI);
      expect(view.determination.status).toBe('determined');
      expect(view.determination.tie).toBe(true);
      expect(view.determination.winners.map((w) => w.playerId).sort((a, b) => a - b)).toEqual([playerIds.g1, playerIds.g2].sort((a, b) => a - b));
      expect(view.determination.rankingDeterminate).toBe(false);
      await publish();
      expect((await storedRows()).filter((r) => r.is_winner).length).toBe(2);
    } finally {
      await clearStaged(TRI);
      await owner`DELETE FROM matches WHERE id = ${matchB.id}`;
    }
  });
});

describe('every refusal writes NO row', () => {
  const refusals: Array<[string, Partial<BrownlowEligibilityDecisionRequest> & { tag?: string }, string]> = [
    ['capability_denied (a plain admin)', { viewer: { role: 'admin', canManageAdmins: false } }, 'capability_denied'],
    ['invalid_input (a verdict that does not exist)', { verdict: 'maybe' as never }, 'invalid_input'],
    ['invalid_input (a season out of range)', { season: 1800 }, 'invalid_input'],
    ['citation_required (blank)', { citation: '   ' }, 'citation_required'],
    ['citation_required (too long)', { citation: 'x'.repeat(2001) }, 'citation_required'],
    ['note_invalid (19 characters)', { note: 'n'.repeat(19) }, 'note_invalid'],
    ['note_invalid (2001 characters)', { note: 'n'.repeat(2001) }, 'note_invalid'],
    ['unknown_player', { playerId: 2_000_000_000 }, 'unknown_player'],
    ['identity_missing (the player holds no durable identity)', { tag: 'f1', season: SEASONS.open }, 'identity_missing'],
    ['identity_ambiguous (two AFL Tables identities)', { tag: 'f2', season: SEASONS.open }, 'identity_ambiguous'],
    ['player_not_vote_getter (an identity but no votes in the season)', { tag: 'f3', season: SEASONS.open }, 'player_not_vote_getter'],
    ['player_not_vote_getter (votes in another season only)', { tag: 'a1', season: SEASONS.open }, 'player_not_vote_getter'],
  ];

  it.each(refusals)('%s', async (_name, over, code) => {
    const rows = await ledgerCount();
    const outcome = await recordBrownlowEligibilityDecision(executor, request(over));
    expect(outcome).toMatchObject({ ok: false, refusal: { code } });
    expect(await ledgerCount()).toBe(rows);
  });

  it('the capability is checked FIRST, before any SQL: a viewer without it is refused even for an unknown player', async () => {
    const outcome = await recordBrownlowEligibilityDecision(executor, request({ viewer: { role: 'admin', canManageAdmins: false }, playerId: 2_000_000_000 }));
    expect(outcome).toMatchObject({ ok: false, refusal: { code: 'capability_denied' } });
  });

  it('through the caller each refusal is typed, audited once as refused, and writes nothing', async () => {
    const rows = await ledgerCount();
    const refused = await recordBrownlowEligibilityForAdmin(superAdmin, {
      season: SEASONS.open, playerId: playerIds.f1, verdict: 'ineligible', citation: CITATION, note: NOTE, expectedCurrentDecisionId: null,
    }, deps());
    expect(refused).toMatchObject({ ok: false, code: 'identity_missing' });
    expect(await ledgerCount()).toBe(rows);
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock.mock.calls[0][0]).toBe('admin.brownlow_eligibility_refused');
    expect(auditMock.mock.calls[0][1]).toMatchObject({ outcome: 'refused', code: 'identity_missing', season: SEASONS.open });
  });

  it('a season registry that cannot be read fails closed before any SQL', async () => {
    const rows = await ledgerCount();
    const failing: Partial<OperationsDeps> = {
      ...deps(),
      loadRegistry: () => { throw new (class extends Error { constructor() { super('registry unavailable'); } })(); },
    };
    const refused = await recordBrownlowEligibilityForAdmin(superAdmin, {
      season: SEASONS.sealed, playerId: playerIds.a2, verdict: 'eligible', citation: CITATION, note: NOTE, expectedCurrentDecisionId: null,
    }, failing);
    expect(refused.ok).toBe(false);
    expect(await ledgerCount()).toBe(rows);
  });
});

describe('the ledger is append-only for the import role', () => {
  it('afldb_import can INSERT (the decisions above) but cannot UPDATE, DELETE or TRUNCATE', async () => {
    const [row] = await ledger(SEASONS.sealed);
    expect(row).toBeDefined();
    await expect(importSql`UPDATE brownlow_eligibility_decisions SET note = 'tampered tampered tampered' WHERE id = ${row.id}`)
      .rejects.toMatchObject({ code: '42501' });
    await expect(importSql`DELETE FROM brownlow_eligibility_decisions WHERE id = ${row.id}`)
      .rejects.toMatchObject({ code: '42501' });
    await expect(importSql`TRUNCATE brownlow_eligibility_decisions`).rejects.toMatchObject({ code: '42501' });
    const [again] = (await ledger(SEASONS.sealed)).filter((r) => r.id === row.id);
    expect(again.note).toBe(NOTE);
  });

  it('recording one more decision still leaves the raw votes untouched (an independent re-check at the end)', async () => {
    const before = await rawVoteFingerprint();
    await recordBrownlowEligibilityDecision(executor, request({ tag: 'a2', verdict: 'eligible', expectedCurrentDecisionId: null }));
    expect(await rawVoteFingerprint()).toBe(before);
  });
});
