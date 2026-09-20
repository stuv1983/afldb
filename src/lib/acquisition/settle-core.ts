/**
 * AFLDB-ISSUE-228 S6 — source-parametrised settle infrastructure.
 *
 * `settle-afltables.ts` (AFLDB-ISSUE-099/122/131) is the proven, already
 * operator-validated AFL Tables settle engine. It is deliberately left
 * UNTOUCHED by this stage: its control flow is deeply coupled to the
 * `afltables.match` / `afltables.player_match_stats` projection shapes, and a
 * byte-identical extraction of that ~3,600-line module could not be verified
 * here (CLAUDE.md §9 — no test command may be executed in this pass). Risking
 * a regression in an already-validated production path is a worse outcome
 * than the duplication this module accepts.
 *
 * What genuinely IS source-neutral — and was already proven so by being
 * pulled out of that module's own call graph (`reconciliation.ts`,
 * `observation-store.ts`, `canonical-apply.ts`, `match-rekey.ts`,
 * `source-families.ts`) — stays exactly where it is and is reused unchanged
 * by `settle-afl-api.ts`. This module holds the remaining handful of pure
 * helpers that settle-afltables.ts still defines locally (disagreement
 * drafting, the counters shape, the derived-recompute scope) so a second
 * settle engine does not have to reinvent them, PARAMETRISED by the
 * `sourceKey` and `contractFamilyOf` mapping settle-afltables.ts bakes in as
 * module constants.
 *
 * `SettleSourceSpec` is the documented shape §16's S6 row names: what a
 * source-parametrised settle engine is built from. `settle-afl-api.ts`
 * implements against it; `settle-afltables.ts` is not refactored onto it in
 * this pass (see above) but its own constants already satisfy the same
 * conceptual fields (`SETTLE_SOURCE_KEY`, `BUNDLE_FAMILIES`,
 * `SETTLE_ACQUISITION_KIND`, the `'settle-afltables.ts'` tool literal,
 * `SUPPORTED_BUNDLE_CONTRACT_VERSION`), so the two engines agree in shape
 * even though only one is wired through this type.
 */
import type { ImportBatchId } from '../import-batch-id';

import type { JsonValue } from './observations';
import type { CorroborationReport, ProviderClaim } from './reconciliation';
import type { SourceFamilyContract } from './source-families';

export class SettleCoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettleCoreError';
  }
}

function fail(message: string): never {
  throw new SettleCoreError(message);
}

/* ------------------------------------------------------------------ *
 * SettleSourceSpec — the documented contract (§16 S6)
 * ------------------------------------------------------------------ */

export type SettleSourceSpec = {
  /** `sources.key`, e.g. `'afl_api'`. */
  sourceKey: string;
  /** Contract families (registry keys) this engine settles, e.g. `['match', 'player_match_stats']`. */
  families: readonly string[];
  /** `import_batches.tool`, e.g. `'settle-afl-api.ts'`. */
  toolName: string;
  /** `staging.source_records`' acquisition kind for this run. */
  acquisitionKind: string;
  /** The bundle contract version this engine speaks (2 for afl_api's deferral-carrying shape). */
  supportedBundleContractVersion: number;
};

/* ------------------------------------------------------------------ *
 * Counters (generic shape; a caller adds its own source-specific fields)
 * ------------------------------------------------------------------ */

export type SettleCounters = {
  observationsSeen: number;
  payloadsCreated: number;
  payloadsReused: number;
  versionsAppended: number;
  observationsUnchanged: number;
  observationsCorrected: number;
  observationsHistoryOnly: number;
  observationsMarkedAbsent: number;
  observationsReappeared: number;
  absenceSweepSkipped: number;

  projectionRowsWritten: number;
  venueUnmapped: number;
  unresolvedIdentityPlayer: number;
  unresolvedIdentityClub: number;
  unresolvedIdentityMatch: number;
  foreignOwnedCollision: number;
  /** AFLDB-ISSUE-228 §7.5 (Q1): a foreign-owned row that IS a declared
   * co-source — corroborated, never an exception, never re-owned. */
  corroboratedForeignOwned: number;
  sourceDisagreement: number;
  manualAuthorityRefusals: number;

  candidatesCreated: number;
  candidatesRefreshed: number;
  candidatesMootLeftPending: number;

  dataIssuesOpened: number;
  dataIssuesRefreshed: number;
  dataIssuesResolved: number;

  canonicalRowsInserted: number;
  canonicalRowsUpdated: number;
  canonicalApplicationsLogged: number;
  canonicalApplyFailures: number;
  canonicalApplyRefusals: number;

  /** AFLDB-ISSUE-228 §7.5 (Q2): attendance field-group enrichments applied. */
  attendanceEnrichmentsApplied: number;

  /** AFLDB-ISSUE-228 §7.3 (T3), by reason. Never counted as a rejection. */
  recordsDeferred: Record<string, number>;

  derivedRecomputeRuns: number;
  derivedRecomputePlayers: number;
};

export function emptySettleCounters(): SettleCounters {
  return {
    observationsSeen: 0,
    payloadsCreated: 0,
    payloadsReused: 0,
    versionsAppended: 0,
    observationsUnchanged: 0,
    observationsCorrected: 0,
    observationsHistoryOnly: 0,
    observationsMarkedAbsent: 0,
    observationsReappeared: 0,
    absenceSweepSkipped: 0,
    projectionRowsWritten: 0,
    venueUnmapped: 0,
    unresolvedIdentityPlayer: 0,
    unresolvedIdentityClub: 0,
    unresolvedIdentityMatch: 0,
    foreignOwnedCollision: 0,
    corroboratedForeignOwned: 0,
    sourceDisagreement: 0,
    manualAuthorityRefusals: 0,
    candidatesCreated: 0,
    candidatesRefreshed: 0,
    candidatesMootLeftPending: 0,
    dataIssuesOpened: 0,
    dataIssuesRefreshed: 0,
    dataIssuesResolved: 0,
    canonicalRowsInserted: 0,
    canonicalRowsUpdated: 0,
    canonicalApplicationsLogged: 0,
    canonicalApplyFailures: 0,
    canonicalApplyRefusals: 0,
    attendanceEnrichmentsApplied: 0,
    recordsDeferred: {},
    derivedRecomputeRuns: 0,
    derivedRecomputePlayers: 0,
  };
}

export function recordDeferral(counters: SettleCounters, reason: string): void {
  counters.recordsDeferred[reason] = (counters.recordsDeferred[reason] ?? 0) + 1;
}

/* ------------------------------------------------------------------ *
 * match_key rendering (AFLDB-ISSUE-228 S6, §6.1, §16 S6 row) — the one
 * shared renderer. `import_fitzroy_core.py::match_key_of()` builds
 * `season|round_code|match_date|clubs.name_of(home_hist)|clubs.name_of(away_hist)`,
 * where `name_of(hist)` is the canonical `clubs.name` for that historical
 * identity, never the raw provider string (AFLDB-ISSUE-131 §3.1). AFL Tables'
 * own settle path never needs this in TypeScript because the Python importer
 * already stamps `match_key` onto its staging projection before the spine
 * ever sees it; `afl_api` has no such upstream stamp, so this is the one
 * place the algorithm is reproduced, for every settle engine to share.
 * ------------------------------------------------------------------ */

export function renderMatchKey(
  season: number,
  roundCode: string,
  matchDate: string,
  homeClubName: string,
  awayClubName: string,
): string {
  return [String(season), roundCode, matchDate, homeClubName, awayClubName].join('|');
}

/* ------------------------------------------------------------------ *
 * Derived-recompute scope (AFLDB-ISSUE-122 §13, generalised)
 * ------------------------------------------------------------------ */

export type DerivedScope = {
  playerIds: Set<number>;
  matchIds: Set<number>;
};

export function emptyDerivedScope(): DerivedScope {
  return { playerIds: new Set(), matchIds: new Set() };
}

/**
 * The player ids `recomputePlayerDerivedStats()` receives: the run's own
 * player-unit writes plus the players on every match the run wrote — the
 * same rule `settle-afltables.ts`'s `affectedPlayerIds()` applies.
 */
export async function affectedPlayerIds(
  tx: import('postgres').TransactionSql,
  scope: DerivedScope,
): Promise<number[]> {
  const ids = new Set(scope.playerIds);
  if (scope.matchIds.size > 0) {
    const rows = await tx<{ playerId: number }[]>`
      SELECT DISTINCT player_id::int AS "playerId"
        FROM player_match_stats
       WHERE match_id = ANY(${[...scope.matchIds]}::bigint[])
    `;
    for (const row of rows) ids.add(row.playerId);
  }
  return [...ids].sort((a, b) => a - b);
}

/* ------------------------------------------------------------------ *
 * Disagreement / data_issues drafting — parametrised by source key
 * ------------------------------------------------------------------ */

export type SettleTargetTableLike = string;

export function settleIssueKey(
  sourceKey: string, family: string, externalRecordId: string, targetTable: SettleTargetTableLike,
): string {
  if (!externalRecordId) fail('A data_issues key needs the external record id it describes.');
  return [sourceKey, family, externalRecordId, targetTable].join('|');
}

export function canonicalApplyIssueKey(
  sourceKey: string, family: string, externalRecordId: string, targetTable: SettleTargetTableLike,
): string {
  if (!externalRecordId) fail('A data_issues key needs the external record id it describes.');
  return [sourceKey, 'apply', family, externalRecordId, targetTable].join('|');
}

export const SCORE_DISAGREEMENT_FIELDS = ['home_score', 'away_score'] as const;

export function disagreementSeverity(conflictFields: readonly string[]): 'warning' | 'error' {
  return conflictFields.some((f) => (SCORE_DISAGREEMENT_FIELDS as readonly string[]).includes(f))
    ? 'error'
    : 'warning';
}

export type DisagreementConflict = Readonly<Record<string, JsonValue>>;

/**
 * Reconciliation's own `sameValue()`, imported by the caller. Kept as a
 * parameter here rather than importing `reconciliation.ts` a second way, so
 * this module never re-implements value equality.
 */
export function disagreementConflicts(
  sourceKey: string,
  sameValue: (a: JsonValue, b: JsonValue) => boolean,
  proposedValues: Readonly<Record<string, JsonValue>>,
  claims: readonly ProviderClaim[],
  disagreeingGroups: readonly string[],
): readonly DisagreementConflict[] {
  const disagreeing = new Set(disagreeingGroups);
  const ordered = [...claims]
    .filter((claim) => disagreeing.has(claim.contract.independence.group))
    .sort((a, b) => a.contract.sourceKey.localeCompare(b.contract.sourceKey));

  const conflicts: DisagreementConflict[] = [];
  for (const field of Object.keys(proposedValues).sort()) {
    const byGroup = new Map<string, JsonValue>();
    for (const claim of ordered) {
      const group = claim.contract.independence.group;
      if (byGroup.has(group)) continue;
      if (!(field in claim.values)) continue;
      if (sameValue(proposedValues[field], claim.values[field])) continue;
      byGroup.set(group, claim.values[field]);
    }
    if (byGroup.size === 0) continue;
    const conflict: Record<string, JsonValue> = { field, [sourceKey]: proposedValues[field] };
    for (const group of [...byGroup.keys()].sort()) conflict[group] = byGroup.get(group) as JsonValue;
    conflicts.push(conflict);
  }
  return conflicts;
}

export type SettleDataIssueDraft = {
  entityType: string;
  entityId: number | null;
  issueType: string;
  issueKey: string;
  severity: 'warning' | 'error';
  description: string;
  details: Readonly<Record<string, JsonValue>>;
};

export function draftDisagreementIssue(input: {
  sourceKey: string;
  sameValue: (a: JsonValue, b: JsonValue) => boolean;
  issueType: string;
  issueOwner: string;
  family: string;
  externalRecordId: string;
  targetTable: string;
  targetId: number | null;
  sourceVersionSeq: number | null;
  proposedValues: Readonly<Record<string, JsonValue>>;
  claims: readonly ProviderClaim[];
  corroboration: CorroborationReport;
}): SettleDataIssueDraft {
  const { corroboration } = input;
  if (corroboration.disagreeingGroups.length === 0) {
    fail('A source_disagreement needs at least one disagreeing independence group.');
  }
  const conflicts = disagreementConflicts(
    input.sourceKey, input.sameValue, input.proposedValues, input.claims,
    corroboration.disagreeingGroups,
  );
  if (conflicts.length === 0) {
    fail(
      'A source_disagreement names disagreeing groups but no conflicting field; '
      + 'the evidence does not support the finding.',
    );
  }

  const fields = conflicts.map((conflict) => String(conflict.field));
  return {
    entityType: input.targetTable,
    entityId: input.targetId,
    issueType: input.issueType,
    issueKey: settleIssueKey(input.sourceKey, input.family, input.externalRecordId, input.targetTable),
    severity: disagreementSeverity(fields),
    description:
      `${input.sourceKey} disagrees with ${corroboration.disagreeingGroups.join(', ')} `
      + `on ${fields.join(', ')} for ${input.targetTable} '${input.externalRecordId}'.`,
    details: {
      owner: input.issueOwner,
      source_key: input.sourceKey,
      family: input.family,
      external_record_id: input.externalRecordId,
      target_table: input.targetTable,
      source_version_seq: input.sourceVersionSeq,
      agreeing_groups: [...corroboration.agreeingGroups],
      disagreeing_groups: [...corroboration.disagreeingGroups],
      conflicts,
    },
  };
}

/** Same rule as `settle-afltables.ts`'s `agreementRestored()`. */
export function agreementRestored(corroboration: CorroborationReport): boolean {
  return corroboration.disagreeingGroups.length === 0
    && corroboration.agreeingGroups.length > 0;
}

/* ------------------------------------------------------------------ *
 * data_issues writers — generic, parametrised
 * ------------------------------------------------------------------ */

type Tx = import('postgres').TransactionSql;

export async function writeSettleDataIssue(
  tx: Tx, draft: SettleDataIssueDraft, counters: Pick<SettleCounters, 'dataIssuesOpened' | 'dataIssuesRefreshed'>,
): Promise<void> {
  const [written] = await tx<{ inserted: boolean }[]>`
    INSERT INTO data_issues (
      entity_type, entity_id, issue_type, issue_key, severity, description, details
    ) VALUES (
      ${draft.entityType}, ${draft.entityId}, ${draft.issueType}, ${draft.issueKey},
      ${draft.severity}, ${draft.description}, ${tx.json(draft.details as never)}
    )
    ON CONFLICT (issue_type, issue_key)
      WHERE issue_key IS NOT NULL AND resolved_at IS NULL
      DO UPDATE SET
        entity_id = EXCLUDED.entity_id,
        severity = EXCLUDED.severity,
        description = EXCLUDED.description,
        details = EXCLUDED.details
    RETURNING (xmax = 0) AS inserted
  `;
  if (written?.inserted) counters.dataIssuesOpened += 1;
  else counters.dataIssuesRefreshed += 1;
}

export async function resolveRestoredDisagreements(
  tx: Tx, issueType: string, issueOwner: string, restoredKeys: ReadonlySet<string>,
): Promise<number> {
  if (restoredKeys.size === 0) return 0;
  const resolved = await tx<{ id: string }[]>`
    UPDATE data_issues
       SET resolved_at = now(), resolution = 'source_agreement_restored'
     WHERE issue_type = ${issueType}
       AND issue_key = ANY(${[...restoredKeys]}::text[])
       AND resolved_at IS NULL
       AND details->>'owner' = ${issueOwner}
    RETURNING id
  `;
  return resolved.length;
}

export async function resolveAppliedFailureFinding(
  tx: Tx, issueType: string, issueOwner: string, issueKey: string,
): Promise<number> {
  const resolved = await tx<{ id: string }[]>`
    UPDATE data_issues
       SET resolved_at = now(), resolution = 'canonical_apply_succeeded'
     WHERE issue_type = ${issueType}
       AND issue_key = ${issueKey}
       AND resolved_at IS NULL
       AND details->>'owner' = ${issueOwner}
    RETURNING id
  `;
  return resolved.length;
}

export type { ImportBatchId, SourceFamilyContract };
