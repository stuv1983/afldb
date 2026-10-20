/** Dedicated disposable archive clone ONLY. Never uses a shared test database.
 * Install migration 116 separately on this clone before running. No test installs schema implicitly.
 * The baseline template and all older evidence databases stay untouched.
 */
import './guard';

import { readFileSync } from 'node:fs';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { nativeTransactionOf, postgresExecutor, type SqlExecutor } from '@afldb/db';

import { applyBrownlowCorrection, correctionBaseline, planBrownlowCorrection,
  type CorrectionApproval, type CorrectionPlan, type CorrectionRequest, type CorrectionTarget, type FreshBackup } from '@/db/queries/brownlow-production-correction';
import { runSettleAflApiBrownlow } from '@/lib/acquisition/afl-api-brownlow';
import { parseAflApiIdentities } from '@/lib/acquisition/afl-api-bundle';
import { parseSourceFamilyRegistry } from '@/lib/acquisition/source-families';
import { loadSeasonRegistry } from '@/lib/seasons/sealed-seasons';

import { loadSnapshot } from '../../tools/current-season/settle-afl-api-brownlow';

const DB = 'afldb_v2_brownlow_package2_test';
const sql = postgres(process.env.AFLDB_TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
const executor = postgresExecutor(sql);
const revision = 'a'.repeat(40); // synthetic approval; NEVER a production execution authority
const registry = loadSeasonRegistry();
let target: CorrectionTarget;
let backup: FreshBackup;
let backfill: CorrectionPlan;
let adoption: CorrectionPlan;
const context = () => ({ revision, now: new Date().toISOString(), registry });
const approval = (p: CorrectionPlan): CorrectionApproval => ({ planDigest: p.digest, target, revision, operation: p.request.operation,
  seasons: p.request.seasons, source: p.request.operation.endsWith('backfill') ? 'legacy' : 'afl_api',
  approvedAt: new Date().toISOString(), expiresAt: p.expiresAt,
  reference: 'SYNTHETIC isolated runner rehearsal approval; never live authority', rulings: p.request.rulings });
const plan = async (request: CorrectionRequest) => planBrownlowCorrection(executor, request,
  { target, backup: { ...backup, baselineDigest: await correctionBaseline(executor) }, ...context() });
const apply = (p: CorrectionPlan) => applyBrownlowCorrection(executor, p, approval(p), context());
const raw = async () => (await sql`SELECT md5(string_agg((to_jsonb(r) - 'match_id')::text, '|' ORDER BY id)) AS hash FROM brownlow_round_votes r`)[0].hash;

beforeAll(async () => {
  if (process.env.AFLDB_V2_ISOLATED_PG !== '1') throw new Error('Marked isolated launcher required');
  const [row] = await sql`SELECT current_database() AS database, current_user AS "user", c.system_identifier::text AS "systemIdentifier",
    d.oid::text AS "databaseOid", current_setting('cluster_name') AS "clusterName", shobj_description(d.oid,'pg_database') AS "databaseComment"
    FROM pg_control_system() c CROSS JOIN pg_database d WHERE d.datname = current_database()`;
  if (row.database !== DB) throw new Error('Dedicated Brownlow package clone required');
  const url = new URL(process.env.AFLDB_TEST_DATABASE_URL!);
  target = { host: url.hostname, port: Number(url.port), ...row } as CorrectionTarget;
  // Synthetic attestations exercise freshness/target gates; actual backup/restore approval is future work.
  backup = { target, baselineDigest: '0'.repeat(64), sha256: 'b'.repeat(64), restoreEvidenceSha256: 'c'.repeat(64),
    capturedAt: new Date().toISOString(), restoredAt: new Date().toISOString() };
  await sql`SELECT 1 FROM brownlow_correction_receipts LIMIT 1`;
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

describe.sequential('guarded Brownlow production entry logic on a dedicated isolated copy', () => {
  it('plans read-only, refuses a wrong live target and pre-apply row drift', async () => {
    const before = await correctionBaseline(executor);
    backfill = await plan({ operation: 'backfill', seasons: [2025] });
    expect(await correctionBaseline(executor)).toBe(before);
    await expect(planBrownlowCorrection(executor, backfill.request,
      { target: { ...target, systemIdentifier: 'wrong' }, backup, ...context() })).rejects.toThrow();
    const [r] = await sql`SELECT id FROM brownlow_round_votes WHERE season = 2025 ORDER BY id LIMIT 1`;
    await sql`UPDATE brownlow_round_votes SET imported_at = imported_at + interval '1 second' WHERE id = ${r.id}`;
    try { await expect(apply(backfill)).rejects.toThrow(/baseline drift/); }
    finally { await sql`UPDATE brownlow_round_votes SET imported_at = imported_at - interval '1 second' WHERE id = ${r.id}`; }
    expect(await correctionBaseline(executor)).toBe(before);
  }, 180_000);

  it('rolls a failed backfill back, then applies/replays/reverses preserving all vote values and provenance', async () => {
    const before = await raw();
    const exported = (backfill.payload as { export: { repairs: Array<{ id: number }> } }).export;
    expect(exported.repairs).toHaveLength(9522);
    const id = exported.repairs[1].id;
    await sql.unsafe(`CREATE FUNCTION pg_temp.fail_correction() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.id = ${id} THEN RAISE EXCEPTION 'synthetic partial failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_correction_failure AFTER UPDATE ON brownlow_round_votes FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_correction()`);
    try { await expect(apply(backfill)).rejects.toThrow(/synthetic partial failure/); }
    finally { await sql`DROP TRIGGER test_correction_failure ON brownlow_round_votes`; }
    expect(await raw()).toBe(before);
    expect((await sql`SELECT count(*)::int AS n FROM brownlow_correction_receipts`)[0].n).toBe(0);
    expect((await apply(backfill) as { replay: boolean }).replay).toBe(false);
    expect((await apply(backfill) as { replay: boolean }).replay).toBe(true);
    expect(await raw()).toBe(before);
    const reverse = await plan({ operation: 'reverse-backfill', seasons: [2025], reversal: { originalPlanDigest: backfill.digest, export: exported } });
    await apply(reverse);
    expect((await apply(reverse) as { replay: boolean }).replay).toBe(true);
    expect((await sql`SELECT count(*)::int AS n FROM brownlow_round_votes WHERE season = 2025 AND match_id IS NOT NULL`)[0].n).toBe(0);
  }, 180_000);

  it('adopts exactly 621 positives, preserves 8901 zero rows, replays and reverses; refuses subsequent-write reversal', async () => {
    adoption = await plan({ operation: 'adopt', seasons: [2025] });
    const before = await raw();
    const exported = (adoption.payload as { export: { sets: Array<{ rows: Array<{ rowId: number }> }> } }).export;
    const failId = exported.sets[0].rows[1].rowId;
    await sql.unsafe(`CREATE FUNCTION pg_temp.fail_adoption() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.id = ${failId} THEN RAISE EXCEPTION 'synthetic adoption failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_correction_failure AFTER UPDATE ON brownlow_round_votes FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_adoption()`);
    try { await expect(apply(adoption)).rejects.toThrow(/synthetic adoption failure/); }
    finally { await sql`DROP TRIGGER test_correction_failure ON brownlow_round_votes`; }
    expect(await raw()).toBe(before);
    const result = await apply(adoption) as { result: { rowsChanged: number; ledgerRows: number } };
    expect(result.result.rowsChanged).toBe(621); expect(result.result.ledgerRows).toBe(621);
    expect((await apply(adoption) as { replay: boolean }).replay).toBe(true);
    expect((await sql`SELECT count(*)::int AS n FROM brownlow_round_votes WHERE season = 2025 AND votes = 0 AND source_id IS NULL`)[0].n).toBe(8901);
    // Even an otherwise valid later API provenance change makes the new outer reversal refuse.
    const rowId = exported.sets[0].rows[0].rowId;
    const [original] = await sql`SELECT source_record_id FROM brownlow_round_votes WHERE id = ${rowId}`;
    await sql`UPDATE brownlow_round_votes SET source_record_id = 'synthetic-later-api-write' WHERE id = ${rowId}`;
    try { await expect(plan({ operation: 'reverse-adopt', seasons: [2025], reversal: { originalPlanDigest: adoption.digest, export: exported } })).rejects.toThrow(/reversal state changed/); }
    finally { await sql`UPDATE brownlow_round_votes SET source_record_id = ${original.source_record_id} WHERE id = ${rowId}`; }
    const reverse = await plan({ operation: 'reverse-adopt', seasons: [2025], reversal: { originalPlanDigest: adoption.digest, export: exported } });
    await apply(reverse);
    expect(await raw()).toBe(before);
  }, 180_000);

  it('refuses premature issue resolution and unapproved or ambiguous eligibility', async () => {
    await expect(plan({ operation: 'resolve', seasons: [2025], issueIds: [999999999], resolution: 'Synthetic issue resolution must never be accepted' })).rejects.toThrow();
    await expect(plan({ operation: 'eligibility', seasons: [2025], actorId: 1, rulings: [{ playerId: 12446,
      identity: 'afltables:players/T/Somebody_Else.html', verdict: 'ineligible', citation: 'https://www.afl.com.au/news/1427225',
      note: 'Synthetic wrong identity refusal, not an approved ruling', expectedCurrentDecisionId: null }] })).rejects.toThrow(/identity/);
  }, 120_000);

  it('records and replays an authentic observe-only snapshot in the outer transaction', async () => {
    const root = process.env.AFLDB_BROWNLOW_REHEARSAL_SOURCE_ROOT;
    if (!root) throw new Error('Explicit retained snapshot root required');
    const sourceRegistry = parseSourceFamilyRegistry(JSON.parse(readFileSync(`${root}/data/reference/source-families.json`, 'utf8')));
    const snapshot = loadSnapshot(root, 'afl-api-brownlow-2025-2026-10-20-014218', sourceRegistry);
    const p = await plan({ operation: 'observe', seasons: [2025], observation: snapshot });
    const before = await raw();
    const observe = async (tx: SqlExecutor) => {
      const native = nativeTransactionOf(tx)!;
      const result = await runSettleAflApiBrownlow({ begin: (work: (t: postgres.TransactionSql) => Promise<unknown>) => work(native) } as unknown as postgres.Sql,
        { ...snapshot, registry: sourceRegistry, inProgressSeasons: [], apply: true, autoApply: false, observeOnly: true,
          fixtureIdentityFallback: { registry: sourceRegistry,
            identities: parseAflApiIdentities(JSON.parse(readFileSync(`${root}/data/reference/afl-api-identities.json`, 'utf8'))) } });
      if (!result.applied || result.halt || result.counters.voteSetsPlanned !== 207
        || Object.values(result.counters.voteSetsRefused).some((n) => n !== 0)) throw new Error('Observation identity gate failed');
      return result;
    };
    await expect(applyBrownlowCorrection(executor, p, approval(p), { ...context(), observe: async (tx) => {
      await observe(tx); throw new Error('synthetic after-staging failure');
    } })).rejects.toThrow(/after-staging/);
    expect(await correctionBaseline(executor)).toBe(p.baseline);
    await applyBrownlowCorrection(executor, p, approval(p), { ...context(), observe });
    expect((await applyBrownlowCorrection(executor, p, approval(p), { ...context(), observe }) as { replay: boolean }).replay).toBe(true);
    expect(await raw()).toBe(before);
  }, 180_000);

  it('rolls all eligibility decisions/publication back on partial failure, then records an approved subset through the audited service', async () => {
    const [actor] = await sql`INSERT INTO auth_users (email, role) VALUES ('brownlow-package-synthetic@example.invalid', 'super_admin') RETURNING id`;
    const rulings = [
      { playerId: 12446, identity: 'afltables:players/T/Toby_Greene.html', verdict: 'ineligible' as const,
        citation: 'https://www.afl.com.au/news/1427225', note: 'SYNTHETIC isolated approval of proposed Greene correction; no live authority.', expectedCurrentDecisionId: null },
      { playerId: 12869, identity: 'afltables:players/T/Tristan_Xerri.html', verdict: 'ineligible' as const,
        citation: 'https://www.afl.com.au/news/1365899', note: 'SYNTHETIC isolated approval of proposed Xerri correction; no live authority.', expectedCurrentDecisionId: null },
    ];
    const p = await plan({ operation: 'eligibility', seasons: [2025], actorId: actor.id, rulings });
    await expect(applyBrownlowCorrection(executor, p, { ...approval(p), rulings: [] }, context())).rejects.toThrow(/unapproved eligibility/);
    await sql.unsafe(`CREATE FUNCTION pg_temp.fail_eligibility() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.player_id_at_decision = 12869 THEN RAISE EXCEPTION 'synthetic second decision failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_eligibility_failure BEFORE INSERT ON brownlow_eligibility_decisions FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_eligibility()`);
    try { await expect(apply(p)).rejects.toThrow(/second decision failure/); }
    finally { await sql`DROP TRIGGER test_eligibility_failure ON brownlow_eligibility_decisions`; }
    expect(await correctionBaseline(executor)).toBe(p.baseline);
    await apply(p);
    expect((await apply(p) as { replay: boolean }).replay).toBe(true);
    const decisions = await sql`SELECT verdict,basis FROM brownlow_eligibility_decisions WHERE decided_by = ${actor.id}`;
    expect(decisions).toHaveLength(2);
    expect(decisions.every((d) => d.verdict === 'ineligible' && d.basis === 'audited_correction')).toBe(true);
  }, 180_000);

  it('resolves only a genuinely healed ownership issue, atomically with its receipt and with replay', async () => {
    await apply(await plan({ operation: 'backfill', seasons: [2025] }));
    const a = await plan({ operation: 'adopt', seasons: [2025] });
    await apply(a);
    const provider = (a.payload as { export: { sets: Array<{ providerMatchId: string }> } }).export.sets[0].providerMatchId;
    const [issue] = await sql`INSERT INTO data_issues (entity_type,issue_type,description,details)
      VALUES ('brownlow_round_votes','afl_api_brownlow_settle','SYNTHETIC old ownership refusal; isolated test only',
      ${sql.json({ owner: 'settle-afl-api-brownlow.ts', source_key: 'afl_api', provider_match_id: provider, error: 'ownership_indeterminate' })}) RETURNING id`;
    const p = await plan({ operation: 'resolve', seasons: [2025], issueIds: [Number(issue.id)],
      resolution: 'SYNTHETIC: all 207 current vote sets adopted and match IDs healed; reviewed values agree.' });
    await sql.unsafe(`CREATE FUNCTION pg_temp.fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic receipt failure'; END $$;
      CREATE TRIGGER test_receipt_failure BEFORE INSERT ON brownlow_correction_receipts FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_receipt()`);
    try { await expect(apply(p)).rejects.toThrow(/receipt failure/); }
    finally { await sql`DROP TRIGGER test_receipt_failure ON brownlow_correction_receipts`; }
    expect(await correctionBaseline(executor)).toBe(p.baseline);
    expect((await sql`SELECT resolved_at FROM data_issues WHERE id = ${issue.id}`)[0].resolved_at).toBeNull();
    await apply(p);
    expect((await apply(p) as { replay: boolean }).replay).toBe(true);
    expect((await sql`SELECT resolved_at FROM data_issues WHERE id = ${issue.id}`)[0].resolved_at).not.toBeNull();
  }, 240_000);

  it('requires a fresh restored baseline and re-proves live identity before a historical-only correction', async () => {
    const baselineDigest = await correctionBaseline(executor);
    const request: CorrectionRequest = { operation: 'backfill', seasons: [2024] };
    await expect(planBrownlowCorrection(executor, request, { target, backup, ...context() })).rejects.toThrow(/restore baseline/);
    const wrong = { ...target, systemIdentifier: 'wrong-system' };
    await expect(planBrownlowCorrection(executor, request,
      { target: wrong, backup: { ...backup, target: wrong, baselineDigest }, ...context() })).rejects.toThrow(/live database identity/);
    const p = await plan(request);
    const before = await raw();
    await apply(p);
    expect((await apply(p) as { replay: boolean }).replay).toBe(true);
    const exported = (p.payload as { export: unknown }).export;
    await apply(await plan({ operation: 'reverse-backfill', seasons: [2024], reversal: { originalPlanDigest: p.digest, export: exported } }));
    expect(await raw()).toBe(before);
    for (const role of ['afldb_import', 'afldb_app', 'afldb_auth']) {
      const [privilege] = await sql`SELECT has_table_privilege(${role}, 'brownlow_correction_receipts', 'INSERT,UPDATE,DELETE,TRUNCATE') AS allowed`;
      expect(privilege.allowed).toBe(false);
    }
    await expect(sql`UPDATE brownlow_correction_receipts SET operation = operation`).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM brownlow_correction_receipts WHERE false`).rejects.toThrow(/append-only/);
    await expect(sql`TRUNCATE brownlow_correction_receipts`).rejects.toThrow(/append-only/);
  }, 240_000);
});
