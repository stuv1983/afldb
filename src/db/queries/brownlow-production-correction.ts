import 'server-only';

import { createHash } from 'node:crypto';

import { nativeTransactionOf, type SqlExecutor, type TransactionalSqlExecutor } from '@afldb/db';
import { sealedSeasonsFrom, type SeasonRegistry } from '@afldb/domain';

import { adoptionExportOf, applyBrownlowOwnershipAdoption, parseAdoptionExport, planBrownlowOwnershipAdoption, reverseBrownlowOwnershipAdoption } from './brownlow-legacy-ownership-adoption';
import { applyRoundVoteMatchBackfill, exportOf, parseBackfillExport, planRoundVoteMatchBackfill, reverseRoundVoteMatchBackfill } from './brownlow-round-vote-match-backfill';
import { recordBrownlowEligibilityDecision } from './brownlow-eligibility';
import { resolvePlayerIdentity } from './player-identity';

/** New production boundary. The isolated CLIs and their guards are deliberately unchanged.
 * No connection is created here. Callers must pin the transport before connecting.
 * All evidence, exports and approvals belong OUTSIDE Git. See the approval package.
 */
export const correctionHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value,
  (_key, v) => v !== null && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v) ?? 'undefined').digest('hex');
export type CorrectionOperation = 'backfill' | 'adopt' | 'eligibility' | 'observe' | 'resolve' | 'reverse-backfill' | 'reverse-adopt';
export interface CorrectionTarget {
  host: string; port: number; database: string; user: string;
  systemIdentifier: string; databaseOid: string; clusterName: string; databaseComment: string | null;
}
export interface FreshBackup {
  sha256: string; capturedAt: string; restoredAt: string; restoreEvidenceSha256: string;
  baselineDigest: string;
  target: CorrectionTarget;
}
export interface EligibilityRuling {
  playerId: number; identity: string; verdict: 'eligible' | 'ineligible'; citation: string; note: string;
  expectedCurrentDecisionId: number | null;
}
export interface CorrectionRequest {
  operation: CorrectionOperation;
  seasons: number[];
  /** Not inferred from stored false/defaults. Only individually owner-approved rulings go here. */
  rulings?: EligibilityRuling[];
  actorId?: number;
  /** Exact existing issue rows, not a broad update by issue type. */
  issueIds?: number[];
  resolution?: string;
  /** Parsed by the existing checksum-verifying snapshot loader before planning. */
  observation?: unknown;
  reversal?: { originalPlanDigest: string; export: unknown };
}
export interface CorrectionPlan {
  format: 'afldb.brownlow.production-correction.v1';
  request: CorrectionRequest; target: CorrectionTarget; revision: string;
  createdAt: string; expiresAt: string; backup: FreshBackup;
  baseline: string; payload: unknown; digest: string;
}
export interface CorrectionApproval {
  planDigest: string; target: CorrectionTarget; revision: string; operation: CorrectionOperation;
  seasons: number[]; source: 'afl_api' | 'legacy';
  approvedAt: string; expiresAt: string; reference: string;
  /** Eligibility approvals list the exact complete records, including citations and supersedes ids. */
  rulings?: EligibilityRuling[];
}
const fail = (reason: string): never => { throw new Error(`Brownlow correction refused: ${reason}`); };
const equal = (a: unknown, b: unknown): boolean => correctionHash(a) === correctionHash(b);
const HASH = /^[0-9a-f]{64}$/;
const MAX_AGE = 24 * 60 * 60 * 1000;

export function checkCorrectionTransport(dsn: string, target: CorrectionTarget): void {
  let url: URL;
  try { url = new URL(dsn); } catch { return fail('explicit correction DSN required'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash
    || url.hostname !== target.host || Number(url.port || 5432) !== target.port
    || decodeURIComponent(url.pathname.slice(1)) !== target.database || decodeURIComponent(url.username) !== target.user
    || !target.systemIdentifier || !target.databaseOid || !target.clusterName) fail('wrong or incomplete target; no connection authorised');
}

export async function proveCorrectionTarget(tx: SqlExecutor, target: CorrectionTarget): Promise<void> {
  const [row] = await tx.query<{ database: string; user: string; systemIdentifier: string; databaseOid: string; clusterName: string; databaseComment: string | null }>(`
    SELECT current_database() AS database, current_user AS "user", c.system_identifier::text AS "systemIdentifier",
           d.oid::text AS "databaseOid", current_setting('cluster_name') AS "clusterName",
           shobj_description(d.oid, 'pg_database') AS "databaseComment"
      FROM pg_control_system() c CROSS JOIN pg_database d WHERE d.datname = current_database()`);
  const expected = { database: target.database, user: target.user, systemIdentifier: target.systemIdentifier,
    databaseOid: target.databaseOid, clusterName: target.clusterName, databaseComment: target.databaseComment };
  if (!row || !equal(row, expected)) fail('live database identity differs from the reviewed target');
}

// Closed list, never supplied by an input file. Includes planning inputs and publication/audit surfaces.
const TABLES = ['brownlow_round_votes', 'brownlow_season_votes', 'award_winners', 'players', 'player_career_stats',
  'matches', 'player_match_stats', 'external_identities', 'sources', 'import_batches', 'canonical_applications',
  'staging.source_records', 'staging.source_record_versions', 'staging.afl_api_brownlow_vote',
  'staging.afl_api_match', 'brownlow_eligibility_decisions',
  'brownlow_season_authority', 'data_edits', 'data_issues', 'auth_users', 'site_settings', 'afldb_meta.schema_migrations'] as const;

export async function correctionBaseline(tx: SqlExecutor): Promise<string> {
  const hashes: unknown[] = [];
  for (const table of TABLES) {
    const [row] = await tx.query(`SELECT count(*)::text AS n, md5(coalesce(string_agg(v, E'\\n' ORDER BY v), '')) AS hash
      FROM (SELECT md5(to_jsonb(t)::text) AS v FROM ${table} t) x`);
    hashes.push([table, row]);
  }
  return correctionHash(hashes);
}

function fresh(timestamp: string, now: number): boolean {
  const t = Date.parse(timestamp);
  return Number.isFinite(t) && t <= now && now - t <= MAX_AGE;
}
function checkBackup(backup: FreshBackup, target: CorrectionTarget, now: number): void {
  if (!equal(backup.target, target) || !HASH.test(backup.sha256) || !HASH.test(backup.restoreEvidenceSha256) || !HASH.test(backup.baselineDigest)
    || !fresh(backup.capturedAt, now) || !fresh(backup.restoredAt, now)
    || Date.parse(backup.restoredAt) < Date.parse(backup.capturedAt)) fail('fresh target-bound backup and verified restore evidence required');
}
function checkRequest(r: CorrectionRequest): void {
  if (!['backfill', 'adopt', 'eligibility', 'observe', 'resolve', 'reverse-backfill', 'reverse-adopt'].includes(r.operation)
    || !Array.isArray(r.seasons) || !r.seasons.length || new Set(r.seasons).size !== r.seasons.length
    || r.seasons.some((s) => !Number.isInteger(s) || s < 1984 || s > 2025)) fail('scope must name explicit seasons 1984–2025; 2026 excluded');
  if (!['backfill', 'reverse-backfill'].includes(r.operation) && !equal(r.seasons, [2025])) fail('this operation is season-2025 only');
}

async function payloadFor(tx: SqlExecutor, request: CorrectionRequest): Promise<unknown> {
  checkRequest(request);
  if (request.operation.startsWith('reverse-')) {
    const reversal = request.reversal;
    if (!reversal || !HASH.test(reversal.originalPlanDigest)) fail('original correction receipt and export required');
    const [original] = await tx.query<{ operation: string; after_digest: string; result: { digest: string } }>(
      'SELECT operation, after_digest, result FROM brownlow_correction_receipts WHERE plan_digest = $1', [reversal!.originalPlanDigest]);
    const exported = request.operation === 'reverse-backfill' ? parseBackfillExport(reversal!.export) : parseAdoptionExport(reversal!.export);
    if (!original || original.operation !== request.operation.slice(8) || original.after_digest !== await correctionBaseline(tx)
      || exported.digest !== original.result.digest || !equal(exported.seasons, request.seasons)) fail('reversal state changed since original correction; no bypass');
    return { export: exported };
  }
  if (request.operation === 'backfill') {
    const p = await planRoundVoteMatchBackfill(tx, { seasons: request.seasons });
    if (Object.values(p.excluded).some((n) => n !== 0) || p.repairable !== p.nullRows) fail('backfill exclusions require a new review');
    return { export: exportOf(p), fingerprints: p.fingerprints, perSeason: p.perSeason };
  }
  if (request.operation === 'adopt') {
    const p = await planBrownlowOwnershipAdoption(tx, { seasons: [2025] });
    if (p.stagedSets !== 207 || p.adoptable !== 207 || p.refused !== 0 || p.alreadyAdopted !== 0
      || p.legacyPositiveUncovered !== 0 || p.legacyZeroRowsLeftAlone !== 8901 || p.fingerprints.rows !== 9522) fail('expected exactly 207 sets / 621 positives / 8901 legacy zeros');
    await proveStagedPlayerIdentities(tx);
    return { export: adoptionExportOf(p), fingerprints: p.fingerprints };
  }
  if (request.operation === 'eligibility') {
    if (!request.rulings?.length || request.rulings.length > 12 || new Set(request.rulings.map((r) => r.identity)).size !== request.rulings.length) fail('explicit distinct eligibility rulings required');
    const native = nativeTransactionOf(tx);
    if (!native) fail('native identity service required');
    for (const r of request.rulings!) {
      const identity = await resolvePlayerIdentity(native!, r.playerId);
      if (!identity.ok || identity.identity !== r.identity) fail('missing or ambiguous durable eligibility identity');
    }
    return { rulings: request.rulings };
  }
  if (request.operation === 'observe') {
    if (!request.observation) fail('checksum-verified observation required');
    return request.observation;
  }
  if (!request.issueIds?.length || new Set(request.issueIds).size !== request.issueIds.length || !request.resolution || request.resolution.trim().length < 20) fail('exact issue ids and evidence-based resolution required');
  const issues = await tx.query<{ id: string; details: Record<string, unknown> }>(`SELECT * FROM data_issues
    WHERE id = ANY($1::text::bigint[]) AND resolved_at IS NULL AND issue_type = 'afl_api_brownlow_settle'
      AND entity_type = 'brownlow_round_votes' ORDER BY id`, [`{${request.issueIds!.join(',')}}`]);
  if (issues.length !== request.issueIds!.length) fail('issue scope changed or not an unresolved Brownlow settle issue');
  const p = await planBrownlowOwnershipAdoption(tx, { seasons: [2025] });
  if (p.alreadyAdopted !== 207 || p.refused !== 0 || p.adoptable !== 0) fail('ownership issues are not yet genuinely resolved');
  await proveStagedPlayerIdentities(tx);
  const [agreement] = await tx.query<{ n: number; bad: number }>(`SELECT count(*)::int AS n,
    count(*) FILTER (WHERE r.id IS NULL OR r.source_id IS DISTINCT FROM v.source_id
      OR r.votes IS DISTINCT FROM v.votes OR r.match_id IS DISTINCT FROM v.match_id
      OR NOT r.played OR h.absent_since IS NOT NULL OR h.current_version_seq IS DISTINCT FROM v.version_seq)::int AS bad
    FROM staging.afl_api_brownlow_vote v JOIN sources s ON s.id = v.source_id
    LEFT JOIN staging.source_records h ON (h.source_id,h.family,h.external_record_id) = (v.source_id,v.family,v.external_record_id)
    LEFT JOIN brownlow_round_votes r ON (r.season,r.round_number,r.player_id) = (v.season,v.canonical_round_number,v.player_id)
    WHERE s.key = 'afl_api' AND v.family = 'brownlow_match_votes' AND v.season = 2025`);
  if (agreement.n !== 621 || agreement.bad !== 0) fail('current API vote sets do not equal canonical owned rows; issues remain unresolved');
  for (const issue of issues) {
    if (issue.details.source_key !== 'afl_api' || issue.details.owner !== 'settle-afl-api-brownlow.ts'
      || !['ownership_indeterminate'].includes(String(issue.details.error ?? issue.details.reason))) fail('issue has another unresolved cause');
    const matches = await tx.query(`SELECT 1 FROM staging.afl_api_brownlow_vote v JOIN sources s ON s.id = v.source_id
      WHERE s.key = 'afl_api' AND v.season = 2025 AND v.provider_match_id = $1 LIMIT 1`, [issue.details.provider_match_id]);
    if (matches.length !== 1) fail('issue is not bound to a 2025 provider match');
  }
  return { issues };
}

async function proveStagedPlayerIdentities(tx: SqlExecutor): Promise<void> {
  const native = nativeTransactionOf(tx);
  if (!native) fail('native identity service required');
  const players = await tx.query<{ player_id: number }>(`SELECT DISTINCT v.player_id::int AS player_id
    FROM staging.afl_api_brownlow_vote v JOIN sources s ON s.id = v.source_id
    WHERE v.season = 2025 AND v.family = 'brownlow_match_votes' AND s.key = 'afl_api'`);
  if (players.length !== 188) fail('expected 188 resolved staged player identities');
  const identities = new Set<string>();
  for (const player of players) {
    if (!player.player_id) fail('missing staged identity');
    const resolved = await resolvePlayerIdentity(native!, player.player_id);
    if (!resolved.ok) return fail('ambiguous staged player identity');
    if (!resolved.identity || identities.has(resolved.identity)) return fail('missing or ambiguous staged player identity');
    identities.add(resolved.identity);
  }
}

async function preservation(tx: SqlExecutor, operation: CorrectionOperation): Promise<string> {
  const kind = operation.replace('reverse-', '');
  const omit = kind === 'backfill' ? ` - 'match_id'` : kind === 'adopt'
    ? ` - 'source_id' - 'source_record_id' - 'import_batch_id'` : '';
  const [round] = await tx.query(`SELECT md5(coalesce(string_agg(v, E'\\n' ORDER BY v),'')) AS hash
    FROM (SELECT (to_jsonb(r)${omit})::text AS v FROM brownlow_round_votes r) x`);
  const [protectedRows] = await tx.query(`SELECT md5(coalesce(string_agg(v, E'\\n' ORDER BY v),'')) AS hash
    FROM (SELECT to_jsonb(r)::text AS v FROM brownlow_round_votes r
      WHERE season = 2026 OR ($1 = 'adopt' AND (season <> 2025 OR votes = 0))) x`, [kind]);
  const [totals] = await tx.query(`SELECT md5(coalesce(string_agg(v, E'\\n' ORDER BY v),'')) AS hash
    FROM (SELECT (to_jsonb(b)${operation === 'eligibility' ? ` - 'is_winner' - 'is_ineligible' - 'eligible_rank'` : ''})::text AS v
      FROM brownlow_season_votes b) x`);
  return correctionHash([round, protectedRows, totals]);
}

export async function planBrownlowCorrection(executor: TransactionalSqlExecutor, request: CorrectionRequest,
  context: { target: CorrectionTarget; revision: string; backup: FreshBackup; now: string }): Promise<CorrectionPlan> {
  const now = Date.parse(context.now);
  if (!Number.isFinite(now) || !/^[0-9a-f]{40}$/.test(context.revision)) fail('revision and current timestamp required');
  checkBackup(context.backup, context.target, now);
  return executor.transaction(async (tx) => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    await proveCorrectionTarget(tx, context.target);
    const baseline = await correctionBaseline(tx);
    if (context.backup.baselineDigest !== baseline) fail('fresh backup restore baseline does not equal this target baseline');
    const payload = await payloadFor(tx, request);
    const body = { format: 'afldb.brownlow.production-correction.v1' as const, request, target: context.target, revision: context.revision, backup: context.backup,
      createdAt: context.now, expiresAt: new Date(now + MAX_AGE).toISOString(), baseline, payload };
    // Keep only the documented fields in the signed envelope.
    return { ...body, digest: correctionHash(body) };
  });
}

export function checkCorrectionApproval(plan: CorrectionPlan, approval: CorrectionApproval, revision: string, now: string): void {
  const { digest, ...body } = plan;
  const t = Date.parse(now);
  checkRequest(plan.request);
  if (plan.format !== 'afldb.brownlow.production-correction.v1' || !HASH.test(digest) || correctionHash(body) !== digest
    || approval.planDigest !== digest) fail('invalid or unapproved plan digest');
  if (revision !== plan.revision || approval.revision !== revision || !/^[0-9a-f]{40}$/.test(revision)) fail('code revision changed');
  if (!equal(approval.target, plan.target) || !equal(approval.seasons, plan.request.seasons)
    || approval.operation !== plan.request.operation || approval.source !== (plan.request.operation.endsWith('backfill') ? 'legacy' : 'afl_api')) fail('approval target, season, source or operation differs');
  if (!fresh(plan.createdAt, t) || !fresh(approval.approvedAt, t) || Date.parse(approval.approvedAt) < Date.parse(plan.createdAt)
    || !(Date.parse(plan.expiresAt) > t) || !(Date.parse(approval.expiresAt) > t)
    || Date.parse(approval.expiresAt) > Date.parse(plan.expiresAt)
    || typeof approval.reference !== 'string' || approval.reference.trim().length < 20) fail('stale plan or missing execution approval');
  checkBackup(plan.backup, plan.target, t);
  if (plan.backup.baselineDigest !== plan.baseline) fail('backup baseline does not match the approved plan');
  if (plan.request.operation === 'eligibility' && !equal(plan.request.rulings, approval.rulings)) fail('unapproved eligibility records');
}

/** Service calls are joined to the OUTER transaction: their refusal, postcondition, receipt and any
 * publication failure roll the entire operation back, rather than committing a partial package. */
export async function applyBrownlowCorrection(executor: TransactionalSqlExecutor, plan: CorrectionPlan,
  approval: CorrectionApproval, context: { revision: string; now: string; registry: SeasonRegistry;
    observe?: (tx: SqlExecutor, observation: unknown) => Promise<unknown> }): Promise<unknown> {
  checkCorrectionApproval(plan, approval, context.revision, context.now);
  return executor.transaction(async (tx) => {
    await tx.query(`SELECT set_config('lock_timeout', '30000', true)`);
    await tx.query('SELECT pg_advisory_xact_lock(717275, 4)');
    await tx.query('SELECT pg_advisory_xact_lock(717275, 3)');
    await proveCorrectionTarget(tx, plan.target);
    for (const table of TABLES) await tx.query(`LOCK TABLE ${table} IN SHARE ROW EXCLUSIVE MODE`);
    const baseline = await correctionBaseline(tx);
    const receipt = await tx.query<{ after_digest: string; result: unknown }>('SELECT after_digest, result FROM brownlow_correction_receipts WHERE plan_digest = $1', [plan.digest]);
    if (receipt.length) {
      if (receipt[0].after_digest !== baseline) fail('replay state changed after correction; no replay writes');
      return { replay: true, result: receipt[0].result };
    }
    if (baseline !== plan.baseline) fail('baseline drift; re-plan and obtain new execution approval');
    const payload = await payloadFor(tx, plan.request);
    if (!equal(payload, plan.payload)) fail('plan drift');
    const preserved = await preservation(tx, plan.request.operation);
    // Retain the same native handle, required by the existing audited eligibility service.
    const joined: TransactionalSqlExecutor = { query: tx.query.bind(tx), transaction: (work) => work(tx) };
    const r = plan.request;
    let result: unknown;
    if (r.operation === 'backfill' || r.operation === 'reverse-backfill') {
      const reviewed = parseBackfillExport((payload as { export: unknown }).export);
      result = await (r.operation === 'backfill' ? applyRoundVoteMatchBackfill : reverseRoundVoteMatchBackfill)(joined, { export: reviewed, expectedDigest: reviewed.digest, expectedDatabase: plan.target.database });
    } else if (r.operation === 'adopt' || r.operation === 'reverse-adopt') {
      const reviewed = parseAdoptionExport((payload as { export: unknown }).export);
      result = await (r.operation === 'adopt' ? applyBrownlowOwnershipAdoption : reverseBrownlowOwnershipAdoption)(joined, { export: reviewed, expectedDigest: reviewed.digest, expectedDatabase: plan.target.database, decision: approval.reference });
    } else if (r.operation === 'eligibility') {
      const [actor] = await tx.query<{ role: string; disabled_at: string | null }>('SELECT role, disabled_at FROM auth_users WHERE id = $1', [r.actorId]);
      if (actor?.role !== 'super_admin' || actor.disabled_at !== null || !nativeTransactionOf(tx)) fail('active Super Admin and native audited transaction required');
      const decisions: unknown[] = [];
      for (const ruling of r.rulings!) {
        const outcome = await recordBrownlowEligibilityDecision(joined, { ...ruling, season: 2025, decidedBy: r.actorId!,
          viewer: { role: 'super_admin', canManageAdmins: true }, sealed: sealedSeasonsFrom(context.registry), publicationRegistry: context.registry });
        if (!outcome.ok) fail(`eligibility service: ${outcome.refusal.code}`);
        decisions.push(outcome);
      }
      result = decisions;
    } else if (r.operation === 'observe') {
      if (!context.observe) fail('reviewed observation adapter required');
      result = await context.observe!(tx, payload);
    } else {
      const changed = await tx.query(`UPDATE data_issues SET resolved_at = clock_timestamp(), resolution = $2
        WHERE id = ANY($1::text::bigint[]) AND resolved_at IS NULL RETURNING id`, [`{${r.issueIds!.join(',')}}`, r.resolution]);
      if (changed.length !== r.issueIds!.length) fail('partial issue resolution');
      result = { resolved: changed.length };
    }
    if (preserved !== await preservation(tx, r.operation)) fail('vote values, zero rows, provenance or 2026 preservation failed; rollback');
    const after = await correctionBaseline(tx);
    await tx.query(`INSERT INTO brownlow_correction_receipts
      (plan_digest, operation, code_revision, approval_reference, before_digest, after_digest, result)
      VALUES ($1,$2,$3,$4,$5,$6,$7::text::jsonb)`, [plan.digest, r.operation, context.revision, approval.reference, baseline, after, JSON.stringify(result)]);
    return { replay: false, result };
  });
}
