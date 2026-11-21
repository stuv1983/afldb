// tests | Brownlow season attachment: a completed season's stored votes reach publication and every public view
import './guard';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { getBrownlowSeasonOverview, publishBrownlowSeason } from '@/db/queries/admin-brownlow';
import {
  AttachmentRefusal,
  applySeasonAttachment,
  attachmentExportOf,
  planSeasonAttachment,
  reverseSeasonAttachment,
  type SeasonAttachmentExport,
} from '@/db/queries/brownlow-season-attachment';
import { getMatchPlayers } from '@/db/queries/matches';
import { recomputeBrownlowCoverage } from '@/db/queries/player-derived';
import { getPlayerMatches, getPlayerSeasons } from '@/db/queries/players';
import { getSeasonRoundVotes } from '@/db/queries/rounds';
import { brownlowStatusNote, formatBrownlow } from '@/lib/format';
import { postgresExecutor, postgresTransactionExecutor } from '@afldb/db';

import {
  BROWNLOW_UNATTACHED_SEASON as SEASON,
  cleanupSeededBrownlowSeasons,
  seedBrownlowSeason,
  type BrownlowFixture,
} from './brownlow-fixture';

/**
 * Owner dispute 2026-11-21. 2026's Brownlow was awarded and its complete official votes are stored
 * (`brownlow_round_votes`, AFL Tables, round grain, `match_id` NULL), but the per-match mirror is NULL
 * and the season was never published, so every public view treats it as pending and publication
 * refuses it. This suite stages exactly that shape on a suite-owned completed season and proves:
 *   - before: publication refuses; round, match and game-log views withhold votes; the BV cell says the
 *     results await verification, with no claim about the medal (ISSUE-370 owner decision);
 *   - a synthetic unfinished season reads "Not yet available" and is refused by the attachment;
 *   - the attachment's refusals (incomplete match, digest drift), dry run (nothing persists) and exact
 *     reversal;
 *   - after attachment AND the existing Super Admin publication: season totals, the round block, the
 *     match sheet (3/2/1 and genuine zeros), the game log and the BV cell all agree; provenance unchanged;
 *   - reversal is refused once the season is published.
 * Expected values are literals that follow from the seeded votes, never read back from the code under test.
 */

const NOTE = 'Owner dispute 2026-11-21 attachment regression (fixture season)';
let fixture: BrownlowFixture;
let actorId = 0;
let createdActor = false;
let afltablesSourceId = 0;
let importSql: postgres.Sql;
let database = '';
/** Per match: home p0 = 3, away p0 = 2, home p1 = 1; every other participant 0. */
const expectedTotals = new Map<number, number>();

function importDsn(): string {
  const dsn = process.env.AFLDB_TEST_IMPORT_DATABASE_URL ?? process.env.AFLDB_IMPORT_DATABASE_URL
    ?? process.env.AFLDB_TEST_DATABASE_URL;
  if (!dsn) throw new Error('an import-role test DSN is required');
  return dsn;
}

async function freshExport(): Promise<SeasonAttachmentExport> {
  const ro = postgres(importDsn(), { max: 1, onnotice: () => {} });
  try {
    return attachmentExportOf(await postgresExecutor(ro).transaction(async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      return planSeasonAttachment(tx, SEASON);
    }));
  } finally { await ro.end({ timeout: 5 }); }
}

async function state(): Promise<{ unattached: number; mirror: number; positive: number; total: number; sources: number[] }> {
  const [row] = await sql<{ unattached: number; mirror: number; positive: number; total: number; sources: number[] }[]>`
    SELECT (SELECT count(*) FROM brownlow_round_votes WHERE season = ${SEASON} AND match_id IS NULL)::int AS unattached,
           (SELECT count(*) FROM player_match_stats p JOIN matches m ON m.id = p.match_id
             WHERE m.season = ${SEASON} AND p.brownlow_votes IS NOT NULL)::int AS mirror,
           (SELECT count(*) FROM brownlow_round_votes WHERE season = ${SEASON} AND votes > 0)::int AS positive,
           (SELECT COALESCE(sum(votes), 0) FROM brownlow_round_votes WHERE season = ${SEASON})::int AS total,
           (SELECT array_agg(DISTINCT source_id) FROM brownlow_round_votes WHERE season = ${SEASON}) AS sources`;
  return row;
}

beforeAll(async () => {
  const [existing] = await sql<{ id: number }[]>`
    SELECT id FROM auth_users WHERE role = 'super_admin' AND disabled_at IS NULL ORDER BY id LIMIT 1`;
  if (existing) actorId = existing.id;
  else {
    const [created] = await sql<{ id: number }[]>`
      INSERT INTO auth_users (email, role) VALUES ('brownlow-attach-test@example.test', 'super_admin') RETURNING id`;
    actorId = created.id;
    createdActor = true;
  }
  [{ id: afltablesSourceId }] = await sql<{ id: number }[]>`SELECT id::int AS id FROM sources WHERE key = 'afltables'`;
  [{ db: database }] = await sql<{ db: string }[]>`SELECT current_database() AS db`;
  importSql = postgres(importDsn(), { max: 1, onnotice: () => {} });

  fixture = await seedBrownlowSeason(SEASON);
  // The real pending state: coverage derived by the real rule for a completed, unloaded season (D-365-1).
  await importSql.begin((tx) => recomputeBrownlowCoverage(tx, SEASON));
  // The legacy round grain, exactly as the AFL Tables settle left 2026: one row per participant, match_id NULL.
  for (const m of fixture.matches) {
    const votes = new Map([[m.homePlayerIds[0], 3], [m.awayPlayerIds[0], 2], [m.homePlayerIds[1], 1]]);
    for (const [player, v] of votes) expectedTotals.set(player, (expectedTotals.get(player) ?? 0) + v);
    for (const player of [...m.homePlayerIds, ...m.awayPlayerIds]) {
      await sql`
        INSERT INTO brownlow_round_votes (season, player_id, round_number, played, votes, source_id, match_id)
        VALUES (${SEASON}, ${player}, ${m.roundNumber}, true, ${votes.get(player) ?? 0}, ${afltablesSourceId}, NULL)`;
    }
  }
}, 120_000);

afterAll(async () => {
  await importSql?.end({ timeout: 5 });
  await sql`DELETE FROM data_edits WHERE table_name = 'brownlow_season_authority' AND row_id = ${SEASON}`;
  await sql`DELETE FROM brownlow_eligibility_decisions WHERE season = ${SEASON}`.catch(() => undefined);
  await cleanupSeededBrownlowSeasons();
  if (createdActor) await sql`DELETE FROM auth_users WHERE id = ${actorId}`;
}, 120_000);

describe('Brownlow season attachment (owner dispute 2026-11-21)', () => {
  it('before: the stored votes are complete but withheld, and publication refuses them', async () => {
    expect(await state()).toEqual({ unattached: 4 * 36, mirror: 0, positive: 12, total: 24, sources: [afltablesSourceId] });
    const [coverage] = await sql<{ coverage: string }[]>`
      SELECT coverage::text AS coverage FROM stat_availability WHERE stat_key = 'brownlow_season_total' AND season = ${SEASON}`;
    expect(coverage.coverage).toBe('pending');

    const overview = await getBrownlowSeasonOverview(SEASON);
    const refused = await publishBrownlowSeason({ season: SEASON, ineligiblePlayerIds: [], expectedRevision: overview!.revision, actorId, note: NOTE });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('season_incomplete');

    expect(await getSeasonRoundVotes(SEASON)).toEqual([]);
    const sheet = await getMatchPlayers(fixture.matches[0].matchId);
    expect(sheet.every((r) => r.brownlowVotes === null)).toBe(true);

    const leader = fixture.matches[0].homePlayerIds[0];
    const row = (await getPlayerSeasons(leader)).find((s) => s.season === SEASON)!;
    expect([row.brownlowStatus, row.seasonStatus, row.brownlowVotes]).toEqual(['pending', 'complete', null]);
    expect(formatBrownlow(row.brownlowVotes, row.brownlowStatus, row.seasonStatus)).toBe('Awaiting verification');
    expect(brownlowStatusNote(row.brownlowStatus, row.seasonStatus))
      .toBe('AFLDB has not yet verified and published the Brownlow results for this season.');
  });

  it('a synthetic UNFINISHED season: the cell reads "Not yet available" and the attachment refuses it', async () => {
    // No stored season is both unfinished and pending (the accepted rebuild's 2027 has no player seasons),
    // so the suite-owned season is switched to in_progress for this case and restored afterwards.
    const leader = fixture.matches[0].homePlayerIds[0];
    const [before] = await sql<{ status: string; completedAt: string | null }[]>`
      SELECT status::text AS status, completed_at::text AS "completedAt" FROM seasons WHERE year = ${SEASON}`;
    expect(before.status).toBe('complete');
    await sql`UPDATE seasons SET status = 'in_progress'::season_status, completed_at = NULL WHERE year = ${SEASON}`;
    try {
      const row = (await getPlayerSeasons(leader)).find((s) => s.season === SEASON)!;
      expect([row.brownlowStatus, row.seasonStatus, row.brownlowVotes]).toEqual(['pending', 'in_progress', null]);
      expect(formatBrownlow(row.brownlowVotes, row.brownlowStatus, row.seasonStatus)).toBe('Not yet available');
      expect(brownlowStatusNote(row.brownlowStatus, row.seasonStatus))
        .toBe('Brownlow votes for this season are published once the count has been verified.');
      await expect(freshExport()).rejects.toMatchObject({ name: 'AttachmentRefusal', code: 'season_not_eligible' });
      expect(await state()).toMatchObject({ unattached: 4 * 36, mirror: 0 });
    } finally {
      await sql`UPDATE seasons SET status = ${before.status}::season_status, completed_at = ${before.completedAt}::timestamptz
                 WHERE year = ${SEASON}`;
    }
    const restored = (await getPlayerSeasons(leader)).find((s) => s.season === SEASON)!;
    expect(formatBrownlow(restored.brownlowVotes, restored.brownlowStatus, restored.seasonStatus)).toBe('Awaiting verification');
  });

  it('plans exactly the stored set and refuses a season whose match set is incomplete', async () => {
    const plan = await freshExport();
    expect(plan.backfill.repairs).toHaveLength(144);
    expect(plan.mirror).toHaveLength(144);
    expect(plan.mirror.filter((c) => c.votes > 0).map((c) => c.votes).sort()).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]);

    // One match missing its 1-vote (rolled back): the plan refuses rather than attach a partial season.
    const one = fixture.matches[3].homePlayerIds[1];
    await expect(importSql.begin(async (tx) => {
      await tx`UPDATE brownlow_round_votes SET votes = 0 WHERE season = ${SEASON} AND player_id = ${one} AND round_number = 2`;
      await planSeasonAttachment(postgresTransactionExecutor(tx), SEASON);
    })).rejects.toMatchObject({ code: 'season_incomplete' });
    expect((await state()).positive).toBe(12);
  });

  it('a dry run and a wrong digest write nothing; a committed attachment reverses exactly', async () => {
    const reviewed = await freshExport();
    const base = { export: reviewed, expectedDatabase: database, actorId, note: NOTE };
    const dry = await applySeasonAttachment(importSql, { ...base, expectedDigest: reviewed.digest, commit: false });
    expect([dry.committed, dry.attached, dry.mirrored, dry.auditId]).toEqual([false, 144, 144, null]);
    expect((await state()).unattached).toBe(144);

    await expect(applySeasonAttachment(importSql, { ...base, expectedDigest: '0'.repeat(64), commit: true }))
      .rejects.toBeInstanceOf(AttachmentRefusal);
    expect((await state()).mirror).toBe(0);

    const applied = await applySeasonAttachment(importSql, { ...base, expectedDigest: reviewed.digest, commit: true });
    expect([applied.attached, applied.mirrored, applied.after.unattachedRows, applied.after.mirrorRecorded]).toEqual([144, 144, 0, 144]);
    expect(await state()).toEqual({ unattached: 0, mirror: 144, positive: 12, total: 24, sources: [afltablesSourceId] });
    // A second application is refused: the mirror is no longer empty.
    await expect(applySeasonAttachment(importSql, { ...base, expectedDigest: reviewed.digest, commit: true }))
      .rejects.toMatchObject({ code: 'mirror_conflict' });

    const reversed = await reverseSeasonAttachment(importSql, { ...base, expectedDigest: reviewed.digest, commit: true });
    expect([reversed.attached, reversed.mirrored]).toEqual([-144, -144]);
    expect(await state()).toEqual({ unattached: 144, mirror: 0, positive: 12, total: 24, sources: [afltablesSourceId] });
    expect((await freshExport()).digest).toBe(reviewed.digest);
  });

  it('after attachment and the Super Admin publication, every view agrees; zeros stay zeros', async () => {
    const reviewed = await freshExport();
    await applySeasonAttachment(importSql, {
      export: reviewed, expectedDigest: reviewed.digest, expectedDatabase: database, actorId, note: NOTE, commit: true,
    });
    const audits = await sql<{ fieldGroup: string }[]>`
      SELECT field_group AS "fieldGroup" FROM data_edits WHERE table_name = 'brownlow_season_authority' AND row_id = ${SEASON} ORDER BY id`;
    expect(audits.map((a) => a.fieldGroup)).toEqual(['attach_round_votes', 'attach_round_votes_reverse', 'attach_round_votes']);

    // Attached but NOT yet published: every public reader still withholds the season (the ISSUE-367 gate
    // keys on acceptance, which only publication grants), so the attachment alone publishes nothing.
    expect(await getSeasonRoundVotes(SEASON)).toEqual([]);
    expect((await getMatchPlayers(fixture.matches[0].matchId)).every((r) => r.brownlowVotes === null)).toBe(true);
    const pendingLog = await getPlayerMatches(fixture.matches[0].homePlayerIds[0], { limit: 10, offset: 0, season: SEASON });
    expect(pendingLog.rows.length).toBeGreaterThan(0);
    // PlayerMatchRow types brownlowVotes as number, but the ISSUE-367 gate yields NULL for an unaccepted season.
    expect(pendingLog.rows.every((r) => (r.brownlowVotes as number | null) === null)).toBe(true);
    const pendingRow = (await getPlayerSeasons(fixture.matches[0].homePlayerIds[0])).find((s) => s.season === SEASON)!;
    expect(formatBrownlow(pendingRow.brownlowVotes, pendingRow.brownlowStatus, pendingRow.seasonStatus)).toBe('Awaiting verification');
    const [{ n: bsvRows }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM brownlow_season_votes WHERE season = ${SEASON}`;
    expect(bsvRows).toBe(0);

    const overview = await getBrownlowSeasonOverview(SEASON);
    expect([overview!.expected, overview!.accounted, overview!.unresolved]).toEqual([4, 4, 0]);
    const published = await publishBrownlowSeason({ season: SEASON, ineligiblePlayerIds: [], expectedRevision: overview!.revision, actorId, note: NOTE });
    expect(published.ok, JSON.stringify(published)).toBe(true);

    const totals = await sql<{ playerId: number; votes: number; isWinner: boolean }[]>`
      SELECT player_id AS "playerId", votes, is_winner AS "isWinner" FROM brownlow_season_votes WHERE season = ${SEASON}`;
    expect(new Map(totals.map((t) => [t.playerId, t.votes]))).toEqual(expectedTotals);
    // Club 0's p0 polled 3 in two matches: the outright winner on 6.
    const winner = fixture.matches[0].homePlayerIds[0];
    expect(totals.filter((t) => t.isWinner).map((t) => t.playerId)).toEqual([winner]);

    expect((await getSeasonRoundVotes(SEASON)).filter((r) => r.roundNumber === 1).map((r) => r.votes).sort()).toEqual([1, 1, 2, 2, 3, 3]);
    const m0 = fixture.matches[0];
    const sheet = new Map((await getMatchPlayers(m0.matchId)).map((r) => [r.playerId, r.brownlowVotes]));
    expect([sheet.get(m0.homePlayerIds[0]), sheet.get(m0.awayPlayerIds[0]), sheet.get(m0.homePlayerIds[1]), sheet.get(m0.homePlayerIds[5])])
      .toEqual([3, 2, 1, 0]);
    const log = await getPlayerMatches(winner, { limit: 10, offset: 0, season: SEASON, sort: 'bv', dir: 'desc' });
    expect(log.rows.map((r) => r.brownlowVotes)).toEqual([3, 3]);

    const row = (await getPlayerSeasons(winner)).find((s) => s.season === SEASON)!;
    expect([row.brownlowStatus, row.brownlowVotes]).toEqual(['complete', 6]);
    expect(formatBrownlow(row.brownlowVotes, row.brownlowStatus, row.seasonStatus)).toBe('6');
    const zero = (await getPlayerSeasons(m0.homePlayerIds[5])).find((s) => s.season === SEASON)!;
    expect(formatBrownlow(zero.brownlowVotes, zero.brownlowStatus, zero.seasonStatus)).toBe('0');
    expect((await state()).sources).toEqual([afltablesSourceId]);

    await expect(reverseSeasonAttachment(importSql, {
      export: reviewed, expectedDigest: reviewed.digest, expectedDatabase: database, actorId, note: NOTE, commit: true,
    })).rejects.toMatchObject({ code: 'already_published' });
  });
});
