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

/* ------------------------------------------------------------------ *
 * Automatic-apply refusal findings (AFLDB-ISSUE-244 I244-F009)
 * ------------------------------------------------------------------ */

/**
 * Why `data_issues` and not `promotion_candidates` or `import_rejections`.
 *
 * `promotion_candidates` is the human review queue for a PROPOSAL. Its verb
 * vocabulary is the reconciliation vocabulary (no `stale_canonical_target`, no
 * `ownership_indeterminate` distinct from a foreign owner, nothing for
 * `no_canonical_match` or `season_not_in_progress`), it has no reason column,
 * and a candidate can only leave `pending` together with an append-only
 * `promotion_decisions` row that names a human `admin_user_id`. The automatic
 * path therefore cannot resolve or supersede one without fabricating a decision
 * (`settle-afltables.ts` SC8), which is why an existing pending candidate is
 * left pending and counted `candidatesMootLeftPending` — it could never
 * self-heal. `import_rejections` is a SOURCE-ingestion rejection counted into
 * `import_batches.records_rejected` (I244-F008); a refused canonical write is a
 * record the source delivered and the spine observed.
 *
 * `data_issues` under `canonical_apply_failed` is what an in-savepoint refusal
 * already uses (`writeRekeyRefusalIssue()` in `settle-afltables.ts`): resolvable
 * by the writer that owns it, one open row per key
 * (`uq_data_issues_open_by_key`), and listed by the settle exception report's
 * "Open canonical apply failures" section. A refusal shares the FAILURE
 * finding's key for the same target, so a single open row describes the
 * target's latest unresolved automatic-apply outcome and one resolver closes it.
 */
export const APPLY_FINDING_RESOLUTION = {
  /** The target's automatic application succeeded (existing vocabulary). */
  applied: 'canonical_apply_succeeded',
  /** The target no longer differs from canonical state, so there is nothing to apply. */
  notNeeded: 'canonical_apply_not_needed',
  /** A run-wide refusal condition (the season gate) no longer holds. */
  conditionCleared: 'canonical_apply_refusal_cleared',
  /**
   * I244-F030: the source record now resolves normally, so an earlier
   * match-identity refusal for it (`afl_api_match_identity_refusal`) no longer
   * describes the record's current state.
   */
  identityResolved: 'match_identity_resolved',
} as const;

export type ApplyFindingResolution =
  (typeof APPLY_FINDING_RESOLUTION)[keyof typeof APPLY_FINDING_RESOLUTION];

/** Who owns the findings a settle engine writes and may therefore close. */
export type ApplyFindingScope = {
  issueType: string;
  issueOwner: string;
  sourceKey: string;
};

/**
 * Per-run state for apply findings. `openKeys` is loaded ONCE, lazily, so a run
 * that never reaches the automatic path (review-first, or no units) issues no
 * extra statement, and a healing check is an in-memory lookup rather than one
 * UPDATE per unchanged target.
 */
export type ApplyFindingLedger = {
  openKeys: Set<string> | null;
  seasonGateWritten: Set<number>;
};

export function newApplyFindingLedger(): ApplyFindingLedger {
  return { openKeys: null, seasonGateWritten: new Set() };
}

/**
 * `resolveAppliedFailureFinding()` with a caller-chosen resolution. Same
 * ownership scoping: only an UNRESOLVED row carrying this writer's own `owner`
 * stamp is touched, so a finding a super admin already closed is never
 * rewritten and a foreign writer's finding is never closed.
 */
export async function resolveApplyFinding(
  tx: Tx, issueType: string, issueOwner: string, issueKey: string, resolution: ApplyFindingResolution,
): Promise<number> {
  const resolved = await tx<{ id: string }[]>`
    UPDATE data_issues
       SET resolved_at = now(), resolution = ${resolution}
     WHERE issue_type = ${issueType}
       AND issue_key = ${issueKey}
       AND resolved_at IS NULL
       AND details->>'owner' = ${issueOwner}
    RETURNING id
  `;
  return resolved.length;
}

async function openApplyFindingKeys(
  tx: Tx, scope: ApplyFindingScope, ledger: ApplyFindingLedger,
): Promise<Set<string>> {
  if (ledger.openKeys === null) {
    const rows = await tx<{ issueKey: string | null }[]>`
      SELECT issue_key AS "issueKey" FROM data_issues
       WHERE issue_type = ${scope.issueType}
         AND resolved_at IS NULL
         AND details->>'owner' = ${scope.issueOwner}
         AND details->>'source_key' = ${scope.sourceKey}
    `;
    ledger.openKeys = new Set(rows.flatMap((row) => (row.issueKey === null ? [] : [row.issueKey])));
  }
  return ledger.openKeys;
}

/**
 * Close this writer's open finding for one target, if there is one. Bounded:
 * the open set is read once per run and only a key that is actually open costs
 * a statement.
 */
export async function closeApplyFindingIfOpen(
  tx: Tx, scope: ApplyFindingScope, ledger: ApplyFindingLedger, issueKey: string,
  resolution: ApplyFindingResolution, counters: Pick<SettleCounters, 'dataIssuesResolved'>,
): Promise<void> {
  const open = await openApplyFindingKeys(tx, scope, ledger);
  if (!open.has(issueKey)) return;
  counters.dataIssuesResolved += await resolveApplyFinding(
    tx, scope.issueType, scope.issueOwner, issueKey, resolution,
  );
  open.delete(issueKey);
}

const APPLY_REFUSAL_EXPLANATIONS: Readonly<Record<string, string>> = {
  foreign_source_owner: 'the canonical row is owned by another source',
  ownership_indeterminate: 'the canonical row has no readable owning source',
  manual_authority_conflict: 'a live human override covers a field this write would change',
  manual_authority_indeterminate: 'manual authority could not be read, so the write fails closed',
  stale_canonical_target: 'the canonical row changed after the proposal was rendered',
  no_canonical_match: 'the canonical match this target belongs to does not exist',
  match_incomplete: 'the match is not proven complete',
  rekey_ambiguous: 'more than one canonical row could be the same fixture under a retired identity',
  rekey_would_merge: 'this fixture already holds two canonical rows, which are never merged automatically',
  rekey_override_conflict: 'a live human override exists under both renderings of this match',
  // I244-F030: produced by the applier's re-check AND by the AFL API planner.
  possible_existing_match:
    'a canonical match with the same season and clubs differs from this one in at most one of round or date, '
    + 'so it may already be this fixture; an automatic INSERT could create a duplicate and is never performed',
  // I244-F010: never produced by the applier; see `MATCH_IDENTITY_REFUSAL`.
  identity_change_requires_review:
    'the source proposes a different canonical match identity (round, date or clubs), which is never applied automatically',
};

const ERROR_SEVERITY_REFUSALS: ReadonlySet<string> = new Set([
  'ownership_indeterminate', 'manual_authority_indeterminate',
  'rekey_ambiguous', 'rekey_would_merge', 'rekey_override_conflict',
  // I244-F030: allowing the write would create a duplicate canonical fixture.
  'possible_existing_match',
]);

/** Severity and human explanation for an applier refusal code; the code itself stays the machine field. */
export function describeApplyRefusal(refusal: string): { severity: 'warning' | 'error'; explanation: string } {
  return {
    severity: ERROR_SEVERITY_REFUSALS.has(refusal) ? 'error' : 'warning',
    explanation: APPLY_REFUSAL_EXPLANATIONS[refusal] ?? 'the applier refused the write',
  };
}

export type ApplyRefusalIssueInput = {
  scope: ApplyFindingScope;
  family: string;
  externalRecordId: string;
  targetTable: string;
  targetId: number | null;
  refusal: string;
  sourceVersionSeq: number | null;
  fields: readonly string[];
  matchKey: string;
};

/**
 * The finding for ONE refused target. Bounded and secret-free by construction:
 * source record identity, canonical target identity, the machine refusal code
 * and the NAMES of the fields that would have changed — never the proposed
 * values, the payload, an error message or a stack.
 */
export function draftApplyRefusalIssue(input: ApplyRefusalIssueInput): SettleDataIssueDraft {
  const { severity, explanation } = describeApplyRefusal(input.refusal);
  return {
    entityType: input.targetTable,
    entityId: input.targetId,
    issueType: input.scope.issueType,
    issueKey: canonicalApplyIssueKey(
      input.scope.sourceKey, input.family, input.externalRecordId, input.targetTable,
    ),
    severity,
    description:
      `The automatic canonical application of ${input.targetTable} '${input.externalRecordId}' `
      + `was refused (${input.refusal}): ${explanation}. Nothing canonical was written.`,
    details: {
      owner: input.scope.issueOwner,
      source_key: input.scope.sourceKey,
      family: input.family,
      external_record_id: input.externalRecordId,
      target_table: input.targetTable,
      refusal: input.refusal,
      source_version_seq: input.sourceVersionSeq,
      fields: [...input.fields],
      match_key: input.matchKey,
      issue: 'AFLDB-ISSUE-244 I244-F009',
    },
  };
}

export function applySeasonGateIssueKey(scope: ApplyFindingScope, season: number): string {
  return canonicalApplyIssueKey(scope.sourceKey, 'season', String(season), 'seasons');
}

/** The slice of an applier unit the finding writer reads. */
export type ApplyOutcomeUnit = {
  family: string;
  externalRecordId: string;
  season: number;
  matchKey: string;
  inProgressSeasons: readonly number[];
  targets: readonly {
    targetTable: string;
    renderedFields: readonly string[];
    sourceVersionSeq: number;
  }[];
};

/**
 * `season_not_in_progress` refuses EVERY target of the season identically, so it
 * is one run-level finding per season, not one per target (which would be a
 * storm of thousands of rows carrying no per-target information).
 */
async function writeSeasonGateFinding(
  tx: Tx, scope: ApplyFindingScope, ledger: ApplyFindingLedger, unit: ApplyOutcomeUnit,
  counters: Pick<SettleCounters, 'dataIssuesOpened' | 'dataIssuesRefreshed'>,
): Promise<void> {
  if (ledger.seasonGateWritten.has(unit.season)) return;
  ledger.seasonGateWritten.add(unit.season);
  const issueKey = applySeasonGateIssueKey(scope, unit.season);
  await writeSettleDataIssue(tx, {
    entityType: 'seasons',
    entityId: null,
    issueType: scope.issueType,
    issueKey,
    severity: 'warning',
    description:
      `Automatic canonical application is refused for every ${scope.sourceKey} record of season `
      + `${unit.season}: the season is not in in_progress_seasons (data/reference/seasons.json). `
      + 'Nothing canonical was written.',
    details: {
      owner: scope.issueOwner,
      source_key: scope.sourceKey,
      family: 'season',
      external_record_id: String(unit.season),
      target_table: 'seasons',
      refusal: 'season_not_in_progress',
      season: unit.season,
      in_progress_seasons: [...unit.inProgressSeasons],
      issue: 'AFLDB-ISSUE-244 I244-F009',
    },
  }, counters);
  ledger.openKeys?.add(issueKey);
}

/** Close the run-level season-gate finding once the season is in progress again. */
export async function clearSeasonGateFinding(
  tx: Tx, scope: ApplyFindingScope, ledger: ApplyFindingLedger, season: number,
  inProgressSeasons: readonly number[], counters: Pick<SettleCounters, 'dataIssuesResolved'>,
): Promise<void> {
  if (!inProgressSeasons.includes(season)) return;
  await closeApplyFindingIfOpen(
    tx, scope, ledger, applySeasonGateIssueKey(scope, season),
    APPLY_FINDING_RESOLUTION.conditionCleared, counters,
  );
}

/**
 * The durable record of a unit's automatic-apply outcome, written in the run's
 * own transaction (and so rolled back with it on a dry-run, an F004 refusal or
 * a HALT). Only for a unit that did NOT roll back (`failure === null`; a failed
 * unit keeps its own `canonical_apply_failed` finding).
 *
 *   applied          -> close this target's open finding (`applied`)
 *   nothing_to_write -> close it (`notNeeded`): canonical state already holds it
 *   season gate      -> one run-level finding
 *   any other refusal-> open or refresh THIS target's finding with the machine
 *                       reason; an identical replay refreshes the one open row
 *
 * Counters: `dataIssuesOpened` / `dataIssuesRefreshed` / `dataIssuesResolved`
 * only. `canonicalApplyRefusals` is the caller's and is not touched here, and
 * nothing here writes `import_rejections`, so `records_rejected` (I244-F008) is
 * unchanged.
 */
export async function recordApplyOutcomeFindings(
  tx: Tx, scope: ApplyFindingScope, ledger: ApplyFindingLedger, unit: ApplyOutcomeUnit,
  results: readonly { targetTable: string; applied: boolean; refusal: string | null }[],
  targetIds: Readonly<Record<string, number | null | undefined>>,
  counters: Pick<SettleCounters, 'dataIssuesOpened' | 'dataIssuesRefreshed' | 'dataIssuesResolved'>,
): Promise<void> {
  for (const result of results) {
    const issueKey = canonicalApplyIssueKey(
      scope.sourceKey, unit.family, unit.externalRecordId, result.targetTable,
    );
    if (result.applied) {
      await closeApplyFindingIfOpen(tx, scope, ledger, issueKey, APPLY_FINDING_RESOLUTION.applied, counters);
      continue;
    }
    if (result.refusal === 'nothing_to_write') {
      await closeApplyFindingIfOpen(tx, scope, ledger, issueKey, APPLY_FINDING_RESOLUTION.notNeeded, counters);
      continue;
    }
    if (result.refusal === 'season_not_in_progress') {
      await writeSeasonGateFinding(tx, scope, ledger, unit, counters);
      continue;
    }
    const target = unit.targets.find((entry) => entry.targetTable === result.targetTable);
    await writeSettleDataIssue(tx, draftApplyRefusalIssue({
      scope,
      family: unit.family,
      externalRecordId: unit.externalRecordId,
      targetTable: result.targetTable,
      targetId: targetIds[result.targetTable] ?? null,
      refusal: result.refusal ?? 'unspecified_refusal',
      sourceVersionSeq: target?.sourceVersionSeq ?? null,
      fields: target?.renderedFields ?? [],
      matchKey: unit.matchKey,
    }), counters);
    ledger.openKeys?.add(issueKey);
  }
}

/* ------------------------------------------------------------------ *
 * Identity-bearing canonical corrections (AFLDB-ISSUE-244 I244-F010)
 * ------------------------------------------------------------------ */

/**
 * The `matches` columns that render `matches.match_key`
 * (`season|round_code|match_date|home name|away name`,
 * `import_fitzroy_core.py::match_key_of()`) or are constrained to agree with a
 * column that does (`round_number` / `round_type` / `is_final` are bound to
 * `round_code` by `matches_round_number_ck` and `matches_is_final_ck`).
 *
 * `match_key` is a CONTENT ADDRESS over these columns, and three things key on
 * it as text: `data_overrides.entity_key` (human authority), the applier's own
 * lookup (`canonical-apply.ts` `readFreshTarget()`), and every other source's
 * resolver. An UPDATE that moves one of these columns and leaves `match_key`
 * behind therefore leaves a row whose key renders an identity the row no
 * longer has: the next source to render the corrected identity misses the row
 * and INSERTs a duplicate fixture (I244-F010).
 *
 * The AFL API settle cannot maintain `match_key` atomically — the only rekey
 * the applier supports proves its old identity RETIRED from a spine
 * enumeration (`match-rekey.ts`), evidence a provider-id resolution does not
 * have, and `ISSUE-228` §13.5 makes these fields review-only on a started
 * match — so it never writes them on an existing row. `venue_id`, `venue_raw`
 * and `match_time` are in NO key and NO constraint and are deliberately absent.
 */
export const MATCH_IDENTITY_FIELDS = [
  'season', 'round_code', 'round_number', 'round_type', 'is_final',
  'match_date', 'home_club_id', 'away_club_id',
] as const;

const MATCH_IDENTITY_FIELD_SET: ReadonlySet<string> = new Set<string>(MATCH_IDENTITY_FIELDS);

/** The machine reason on the finding. Not an applier code: the applier is never offered these fields. */
export const MATCH_IDENTITY_REFUSAL = 'identity_change_requires_review';

export type MatchIdentitySplit = {
  /** Identity-bearing fields whose proposed value differs from canonical (sorted, as `diffFields()` returns them). */
  changedIdentityFields: readonly string[];
  /** What the applier may be offered: never an identity-bearing field. */
  proposedValues: Record<string, JsonValue>;
  /** The changed fields the applier may be offered: never an identity-bearing field. */
  renderedFields: readonly string[];
};

/**
 * Remove EVERY identity-bearing field from an UPDATE proposal, changed or not.
 *
 * Not only the changed ones: the applier re-diffs `proposedValues` against the
 * row it re-reads inside its savepoint, so an identity field that agreed at
 * proposal time but was moved by a concurrent writer before that re-read would
 * be written straight back with `match_key` untouched. With the fields absent
 * from the proposal the applier cannot write them under any interleaving, and
 * the E5 baseline hash covers only fields that are still offered.
 *
 * An INSERT is never passed through here: it defines the identity, and its
 * `match_key` is rendered from the same bundle as its columns.
 */
export function splitMatchIdentityChange(
  proposedValues: Readonly<Record<string, JsonValue>>, renderedFields: readonly string[],
): MatchIdentitySplit {
  const offered: Record<string, JsonValue> = {};
  for (const [field, value] of Object.entries(proposedValues)) {
    if (!MATCH_IDENTITY_FIELD_SET.has(field)) offered[field] = value;
  }
  return {
    changedIdentityFields: renderedFields.filter((field) => MATCH_IDENTITY_FIELD_SET.has(field)),
    proposedValues: offered,
    renderedFields: renderedFields.filter((field) => !MATCH_IDENTITY_FIELD_SET.has(field)),
  };
}

/**
 * Its own key segment, so this finding's lifecycle is independent of the
 * `matches` refusal finding I244-F009 keeps under `...|matches`: that one is
 * healed when the non-identity fields agree, this one only when the IDENTITY
 * agrees, and neither may close the other.
 */
export function matchIdentityIssueKey(
  scope: ApplyFindingScope, family: string, externalRecordId: string,
): string {
  return canonicalApplyIssueKey(scope.sourceKey, family, externalRecordId, 'matches:identity');
}

export type MatchIdentityIssueInput = {
  scope: ApplyFindingScope;
  family: string;
  externalRecordId: string;
  /** The canonical `matches.id` the source record resolved to. */
  matchId: number | null;
  sourceVersionSeq: number | null;
  /** The differing identity-bearing fields, as `splitMatchIdentityChange()` returns them. */
  changedFields: readonly string[];
  proposedValues: Readonly<Record<string, JsonValue>>;
  currentValues: Readonly<Record<string, JsonValue>>;
  /** The `match_key` the canonical row carries now. */
  canonicalMatchKey: string;
  /** The `match_key` the source's own identity would render. */
  providerMatchKey: string;
};

/**
 * The finding for ONE withheld identity correction. Bounded and secret-free:
 * the record and canonical row identity, both `match_key` renderings, and the
 * differing identity fields with their canonical and proposed scalar values
 * (round code, date, club ids, flags — at most eight scalars). No payload, no
 * error text, no stack.
 */
export function draftMatchIdentityIssue(input: MatchIdentityIssueInput): SettleDataIssueDraft {
  if (input.changedFields.length === 0) {
    fail('A match identity finding needs at least one differing identity-bearing field.');
  }
  const changes = input.changedFields.map((field) => ({
    field,
    canonical: input.currentValues[field] ?? null,
    provider: input.proposedValues[field] ?? null,
  }));
  const { severity, explanation } = describeApplyRefusal(MATCH_IDENTITY_REFUSAL);
  return {
    entityType: 'matches',
    entityId: input.matchId,
    issueType: input.scope.issueType,
    issueKey: matchIdentityIssueKey(input.scope, input.family, input.externalRecordId),
    severity,
    description:
      `${input.scope.sourceKey} proposes a different identity for match '${input.externalRecordId}' `
      + `(${input.changedFields.join(', ')}): ${explanation}. `
      + 'No identity-bearing field was written; the canonical match_key still renders the canonical row.',
    details: {
      owner: input.scope.issueOwner,
      source_key: input.scope.sourceKey,
      family: input.family,
      external_record_id: input.externalRecordId,
      target_table: 'matches',
      refusal: MATCH_IDENTITY_REFUSAL,
      match_id: input.matchId,
      source_version_seq: input.sourceVersionSeq,
      fields: [...input.changedFields],
      changes,
      canonical_match_key: input.canonicalMatchKey,
      provider_match_key: input.providerMatchKey,
      issue: 'AFLDB-ISSUE-244 I244-F010',
    },
  };
}

/**
 * Open or refresh the record's identity finding. An identical replay refreshes
 * the one open row (`uq_data_issues_open_by_key`); a finding a human already
 * resolved is never rewritten, and a persisting difference opens one fresh row
 * beside it — the F009 lifecycle, unchanged. Same transaction as the run.
 */
export async function recordMatchIdentityFinding(
  tx: Tx, ledger: ApplyFindingLedger, input: MatchIdentityIssueInput,
  counters: Pick<SettleCounters, 'dataIssuesOpened' | 'dataIssuesRefreshed'>,
): Promise<void> {
  const draft = draftMatchIdentityIssue(input);
  await writeSettleDataIssue(tx, draft, counters);
  ledger.openKeys?.add(draft.issueKey);
}

/**
 * Close the record's identity finding once the source and the canonical row
 * agree on identity again (the source reverted, or the canonical row was
 * corrected under human authority). Bounded like every F009 healing check.
 */
export async function clearMatchIdentityFinding(
  tx: Tx, scope: ApplyFindingScope, ledger: ApplyFindingLedger, family: string, externalRecordId: string,
  counters: Pick<SettleCounters, 'dataIssuesResolved'>,
): Promise<void> {
  await closeApplyFindingIfOpen(
    tx, scope, ledger, matchIdentityIssueKey(scope, family, externalRecordId),
    APPLY_FINDING_RESOLUTION.notNeeded, counters,
  );
}

/* ------------------------------------------------------------------ *
 * import_batches terminal lifecycle (AFLDB-ISSUE-244 I244-F008)
 * ------------------------------------------------------------------ */

/**
 * What a COMMITTED settle run stamps on its own `import_batches` row.
 *
 * The lifecycle is one transaction: `INSERT` (status `running`, `started_at`
 * and `records_read` from the schema defaults/insert) -> the run's writes ->
 * `finalizeSettleImportBatch()` -> commit. A run that rolls back (dry-run,
 * `--require-complete-source` refusal, HALT, any thrown error) takes the row
 * with it, so a `running` row can only mean a crashed process, never a
 * finished run whose writer forgot to close it.
 *
 * Column semantics (migration 001; the same contract `settle-afltables.ts` and
 * `tools/migration/common.py` follow):
 *
 * - `records_rejected` — the number of `import_rejections` rows persisted for
 *   the batch (001's own table comment: "must always equal the number of
 *   import_rejections rows for the batch"). Counted from the rows the
 *   transaction actually wrote, never from an in-memory counter: one record
 *   refused against two targets writes two rows, and a per-set refusal that
 *   writes a `data_issues` row but no `import_rejections` row is not counted.
 * - `records_inserted` — rows INSERTed into the batch's `target_table`
 *   (`staging.source_record_versions`), i.e. `versionsAppended`. That table is
 *   append-only, so
 * - `records_updated` — is 0 by construction. An unchanged replay (a
 *   `head_refreshed` observation) writes no new version and is neither an
 *   insert nor an update of this table, so an idempotent replay stamps zero
 *   here. Canonical outcomes (`canonicalRowsInserted` / `canonicalRowsUpdated`
 *   and every other counter) live in `validation_result`, where the admin
 *   read model (`settle-runs.ts`) already looks for them by name.
 * - `validation_result` — the run's counters, exactly as the AFL Tables settle
 *   stamps its own.
 * - `completed_at` / `status` — stamped by the UPDATE. `'completed'` is the
 *   success member of the `import_status` enum (running | completed | failed |
 *   rolled_back); a committed run with record-level refusals is still
 *   `completed`, with a non-zero `records_rejected`.
 */
export type SettleImportBatchTerminalFields = {
  status: 'completed';
  recordsInserted: number;
  recordsUpdated: 0;
  recordsRejected: number;
  validationResult: object;
};

/** Pure mapping from a run's counters and its persisted rejection count to the terminal columns. */
export function settleImportBatchTerminalFields(
  counters: { readonly versionsAppended: number },
  recordsRejected: number,
): SettleImportBatchTerminalFields {
  for (const [name, value] of [
    ['versionsAppended', counters.versionsAppended],
    ['recordsRejected', recordsRejected],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      fail(`Cannot finalise an import batch: ${name} must be a non-negative integer, got ${String(value)}.`);
    }
  }
  return {
    status: 'completed',
    recordsInserted: counters.versionsAppended,
    recordsUpdated: 0,
    recordsRejected,
    validationResult: counters,
  };
}

/**
 * Close the run's batch row INSIDE the run's own transaction. Must be called
 * only on a path that will commit (after every write and every gate that can
 * still refuse the run); a dry-run calls it too and then rolls back, so the
 * real UPDATE is exercised against the real constraints and privileges.
 *
 * Fails the transaction (and therefore the whole run) if the row is not the
 * one `running` batch this transaction opened — a batch that cannot be closed
 * must not be committed beside the data it describes.
 *
 * `completed_at` uses `clock_timestamp()`, not `now()`: `now()` is the
 * transaction start, which is exactly `started_at`, so every batch would look
 * instantaneous. Both are database time; `completed_at >= started_at` holds.
 */
export async function finalizeSettleImportBatch(
  tx: Tx,
  batchId: ImportBatchId,
  counters: { readonly versionsAppended: number },
): Promise<SettleImportBatchTerminalFields> {
  const [rejected] = await tx<{ n: number }[]>`
    SELECT count(*)::int AS n FROM import_rejections WHERE import_batch_id = ${batchId}
  `;
  const fields = settleImportBatchTerminalFields(counters, rejected?.n ?? 0);
  const closed = await tx<{ id: string }[]>`
    UPDATE import_batches
       SET completed_at = clock_timestamp(), status = 'completed',
           records_inserted = ${fields.recordsInserted},
           records_updated = ${fields.recordsUpdated},
           records_rejected = ${fields.recordsRejected},
           validation_result = ${tx.json(fields.validationResult as never)}
     WHERE id = ${batchId} AND status = 'running'
    RETURNING id
  `;
  if (closed.length !== 1) {
    fail(
      `Cannot finalise import batch ${String(batchId)}: expected to close exactly one running batch row, `
      + `closed ${closed.length}.`,
    );
  }
  return fields;
}

export type { ImportBatchId, SourceFamilyContract };
