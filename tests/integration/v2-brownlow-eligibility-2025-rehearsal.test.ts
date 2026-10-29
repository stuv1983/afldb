/** BP-2025-ELIGIBILITY-v1 against the authentic 2025 snapshot and the twelve approved rulings.
 *
 * Dedicated disposable archive clone ONLY (the same discipline as v2-brownlow-production-correction.test.ts): it refuses to
 * run anywhere but the named marked isolated database, which must be a fresh clone of the 2025 template with migrations
 * 116 and 117 installed separately. The rulings are applied here, in the labelled isolated copy, through the guarded
 * correction runner with a SYNTHETIC approval; nothing here is, or can be mistaken for, production authority.
 */
import './guard';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { postgresExecutor } from '@afldb/db';

import { applyBrownlowCorrection, correctionBaseline, planBrownlowCorrection,
  type CorrectionApproval, type CorrectionPlan, type CorrectionRequest, type CorrectionTarget, type FreshBackup } from '@/db/queries/brownlow-production-correction';
import { determineBrownlowSeasonForAdmin, type BrownlowDeterminationView, type OperationsDeps } from '@/lib/admin/operations-centre';
import type { AdminUser } from '@/lib/auth/session';
import { loadSeasonRegistry } from '@/lib/seasons/sealed-seasons';

vi.mock('@/lib/auth/session', () => ({ audit: vi.fn(async () => undefined), requireCapability: vi.fn() }));

const DB = 'afldb_v2_brownlow_tristate_twelve_test';
const sql = postgres(process.env.AFLDB_TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
const executor = postgresExecutor(sql);
const revision = 'a'.repeat(40); // synthetic approval; NEVER a production execution authority
const registry = loadSeasonRegistry();
let target: CorrectionTarget;
let backup: FreshBackup;
const context = () => ({ revision, now: new Date().toISOString(), registry });
const approval = (p: CorrectionPlan): CorrectionApproval => ({ planDigest: p.digest, target, revision, operation: p.request.operation,
  seasons: p.request.seasons, source: 'afl_api', approvedAt: new Date().toISOString(), expiresAt: p.expiresAt,
  reference: 'SYNTHETIC isolated runner rehearsal approval; never live authority', rulings: p.request.rulings });
const plan = async (request: CorrectionRequest) => planBrownlowCorrection(executor, request,
  { target, backup: { ...backup, baselineDigest: await correctionBaseline(executor) }, ...context() });

/** The twelve approved 2025 rulings (docs/v2/brownlow-eligibility-ruling-2026-10-20.md): archive id, durable identity, citation. */
const TWELVE: Array<[number, string, string]> = [
  [12446, 'T/Toby_Greene', 'https://www.afl.com.au/news/1427225'],
  [12869, 'T/Tristan_Xerri', 'https://www.afl.com.au/news/1365899'],
  [13246, 'Z/Zac_Bailey', 'https://www.afl.com.au/news/1365899'],
  [11386, 'R/Rory_Laird', 'https://www.afl.com.au/news/1388249'],
  [11625, 'S/Sam_Durham', 'https://www.afl.com.au/news/1354977'],
  [3191, 'D/Dan_Houston', 'https://www.afl.com.au/news/1305410'],
  [4006, 'D/Dylan_Shiel', 'https://www.afl.com.au/news/1388249'],
  [10252, 'P/Patrick_Voss', 'https://www.afl.com.au/news/1300516'],
  [8798, 'L/Liam_Baker', 'https://www.afl.com.au/news/1403587'],
  [10130, 'O/Ollie_Wines', 'https://www.afl.com.au/news/1396382'],
  [11831, 'S/Shannon_Neale', 'https://www.afl.com.au/news/1398164'],
  [6737, 'J/James_Peatling', 'https://www.afl.com.au/news/1305410'],
];

const admin: AdminUser = { id: 1, email: 'rehearsal@example.invalid', role: 'super_admin', canManageAdmins: true, mustChangePassword: false };
const deps = (): Partial<OperationsDeps> => ({
  withExecutor: (work) => work(executor), loadRegistry: () => registry, now: () => new Date('2026-10-20T12:00:00Z'),
});
async function determine2025(): Promise<BrownlowDeterminationView> {
  const result = await determineBrownlowSeasonForAdmin(admin, { season: 2025 }, deps());
  if (!result.ok) throw new Error(`determine refused: ${result.code}`);
  return result.view;
}
const rawVotes = async () => (await sql`SELECT md5(
  (SELECT string_agg(r::text, '|' ORDER BY r.id) FROM brownlow_round_votes r) || '#'
  || (SELECT string_agg((to_jsonb(b) - 'is_winner' - 'is_ineligible' - 'eligible_rank')::text, '|' ORDER BY b.season, b.player_id)
        FROM brownlow_season_votes b WHERE b.season = 2025) || '#'
  || (SELECT string_agg(v::text, '|' ORDER BY v.provider_match_id, v.provider_player_id) FROM staging.afl_api_brownlow_vote v)) AS hash`)[0].hash as string;

beforeAll(async () => {
  if (process.env.AFLDB_V2_ISOLATED_PG !== '1') throw new Error('Marked isolated launcher required');
  const [row] = await sql`SELECT current_database() AS database, current_user AS "user", c.system_identifier::text AS "systemIdentifier",
    d.oid::text AS "databaseOid", current_setting('cluster_name') AS "clusterName", shobj_description(d.oid,'pg_database') AS "databaseComment"
    FROM pg_control_system() c CROSS JOIN pg_database d WHERE d.datname = current_database()`;
  if (row.database !== DB) throw new Error('Dedicated 2025 twelve-ruling clone required');
  const url = new URL(process.env.AFLDB_TEST_DATABASE_URL!);
  target = { host: url.hostname, port: Number(url.port), ...row } as CorrectionTarget;
  backup = { target, baselineDigest: '0'.repeat(64), sha256: 'b'.repeat(64), restoreEvidenceSha256: 'c'.repeat(64),
    capturedAt: new Date().toISOString(), restoredAt: new Date().toISOString() };
  await sql`SELECT 1 FROM brownlow_correction_receipts LIMIT 1`;
  await sql`SELECT 1 FROM information_schema.columns WHERE table_schema = 'staging' AND table_name = 'afl_api_brownlow_vote'
    AND column_name = 'eligible' AND is_nullable = 'YES'`.then((rows) => { if (rows.length !== 1) throw new Error('migration 117 not installed'); });
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

describe.sequential('authentic 2025 snapshot and the twelve approved rulings (labelled isolated copy)', () => {
  let winnersBefore: number[] = [];
  let rawBefore = '';

  it('before any ruling: explicit provider flags are read with provenance; the twelve provider-ineligible players disagree with their unevaluated stored rows and stay unresolved', async () => {
    rawBefore = await rawVotes();
    const view = await determine2025();
    const leaderboard = view.determination.rawLeaderboard;
    expect(leaderboard).toHaveLength(188);
    // The raw vote totals are kept for everyone, in vote order.
    expect(leaderboard.map((e) => e.votes)).toEqual([...leaderboard.map((e) => e.votes)].sort((a, b) => b - a));
    const states = new Map<string, number>();
    for (const entry of leaderboard) states.set(entry.eligibility.status, (states.get(entry.eligibility.status) ?? 0) + 1);
    // No unknown is invented: every player has an explicit provider value; the twelve provider-false players are unresolved.
    expect(states.get('missing') ?? 0).toBe(0);
    expect(view.determination.unresolvedPlayers.map((p) => p.playerId).sort((a, b) => a - b)).toEqual(TWELVE.map(([id]) => id).sort((a, b) => a - b));
    expect(leaderboard.find((e) => e.playerId === 12446)?.eligibility.detail.providerProvenance).toMatchObject({ source: 'afl_api' });
    // None of the twelve is the leader, so the winner is determined even while the twelve are unresolved.
    expect(view.determination.status).toBe('determined');
    expect(view.determination.rankingDeterminate).toBe(false);
    winnersBefore = view.determination.winners.map((w) => w.playerId);
    expect(winnersBefore.length).toBeGreaterThan(0);
    expect(winnersBefore.some((id) => TWELVE.some(([t]) => t === id))).toBe(false);
  }, 120_000);

  it('applies the twelve approved rulings through the guarded runner (all or nothing, replayable) without touching a raw vote', async () => {
    const [actor] = await sql`INSERT INTO auth_users (email, role) VALUES ('brownlow-twelve-synthetic@example.invalid', 'super_admin') RETURNING id`;
    const rulings = TWELVE.map(([playerId, path, citation]) => ({
      playerId, identity: `afltables:players/${path}.html`, verdict: 'ineligible' as const, citation,
      note: `SYNTHETIC isolated rehearsal of the approved 2025 ruling for player ${playerId}; no production authority.`, expectedCurrentDecisionId: null,
    }));
    const p = await plan({ operation: 'eligibility', seasons: [2025], actorId: actor.id, rulings });
    await applyBrownlowCorrection(executor, p, approval(p), context());
    expect((await applyBrownlowCorrection(executor, p, approval(p), context()) as { replay: boolean }).replay).toBe(true);
    const decisions = await sql`SELECT verdict, basis, player_id_at_decision::int AS id FROM brownlow_eligibility_decisions WHERE decided_by = ${actor.id}`;
    expect(decisions).toHaveLength(12);
    expect(decisions.every((d) => d.verdict === 'ineligible' && d.basis === 'audited_correction')).toBe(true);
    expect(await rawVotes()).toBe(rawBefore);
  }, 300_000);

  it('after the rulings: audited decisions take precedence, every rank is determinate, the winner is unchanged and the published flags agree', async () => {
    const view = await determine2025();
    expect(view.determination.status).toBe('determined');
    expect(view.determination.rankingDeterminate).toBe(true);
    expect(view.determination.unresolvedPlayers).toEqual([]);
    expect(view.determination.winners.map((w) => w.playerId)).toEqual(winnersBefore);
    const byId = new Map(view.determination.rawLeaderboard.map((e) => [e.playerId, e]));
    for (const [id] of TWELVE) {
      expect(byId.get(id)?.eligibility).toMatchObject({ status: 'ineligible', source: 'admin_decision' });
      expect(byId.get(id)?.eligibleRank).toBeNull();
    }
    // `excludedIneligible` lists only the ineligible players the winner walk passed over; none of the twelve outpolled the winner.
    expect(view.determination.excludedIneligible).toEqual([]);
    // The stored table now carries exactly those twelve ineligible flags, and competition ranks over the other 176.
    const stored = await sql`SELECT count(*) FILTER (WHERE is_ineligible)::int AS ineligible,
      count(*) FILTER (WHERE NOT is_ineligible AND eligible_rank IS NULL)::int AS unranked,
      count(*) FILTER (WHERE is_winner)::int AS winners
      FROM brownlow_season_votes WHERE season = 2025`;
    expect(stored[0]).toMatchObject({ ineligible: 12, unranked: 0, winners: winnersBefore.length });
    expect(view.storedFlagCheck.state).toBe('agrees');
    expect(await rawVotes()).toBe(rawBefore);
  }, 120_000);
});
