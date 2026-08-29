/**
 * AFLDB-ISSUE-099 T6b — the AFL Tables in-season settle contract.
 *
 * The TypeScript half of the language split. Python owns AFL Tables
 * interpretation and emits a deterministic, versioned observation bundle;
 * this module is the fail-closed boundary that bundle has to cross, plus the
 * per-target projection and proposal contracts the settle transaction drives.
 *
 * Everything here is pure: no database, no filesystem, no network, no clock.
 * The manifest re-hash is I/O, so the CLI computes it and passes the digest in
 * — the comparison itself stays here, where it is testable without a snapshot
 * on disk. The same split applies to the manifest PATH: deciding what it
 * resolves to is string math and lives here; opening it does not. Persistence,
 * reconciliation driving and candidate writing belong to the settle
 * transaction; this module decides what may enter it.
 *
 * Four rules, inherited from ISSUE-096 and unchanged:
 *
 *   1. **Fail closed.** Every validation refuses the WHOLE run. There is no
 *      permissive fallback, no partial acceptance and no force flag.
 *   2. **Presence and projection are separate facts.** A record that was
 *      observed but did not project is still present (§19). Only the typed
 *      projection is gated on resolved identity.
 *   3. **NULL is not zero.** An absent value stays NULL through the bundle,
 *      the projection and the proposal, in every direction.
 *   4. **Nothing here writes anything canonical.** v1 produces observations,
 *      typed staging projections, promotion candidates and `data_issues`
 *      rows. It writes no canonical fact row and no acceptance decision.
 */
import { isAbsolute, resolve } from 'node:path';

import postgres from 'postgres';

import {
  markMissingObservationsAbsent,
  persistSourceObservation,
  type EnumeratedScope,
} from './observation-store';
import {
  hashPayload,
  resolveSourceId,
  type JsonValue,
  type ManualAuthorityProvider,
  type ObservationHead,
} from './observations';
import { draftCandidate } from './promotion-review';
import {
  classifyCorroboration,
  reconcile,
  sameValue,
  type CorroborationReport,
  type IdentityResolution,
  type ProviderClaim,
  type ReconciliationOutcome,
  type TargetOwnership,
} from './reconciliation';
import {
  assertProjectableColumns,
  getSourceFamily,
  type SourceFamilyContract,
  type SourceFamilyRegistry,
} from './source-families';

export class SettleContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettleContractError';
  }
}

function fail(message: string): never {
  throw new SettleContractError(message);
}

/* ------------------------------------------------------------------ *
 * Identity of this pass
 * ------------------------------------------------------------------ */

export const SETTLE_SOURCE_KEY = 'afltables';

/** The exact bundle contract this build speaks. A mismatch refuses (§8.1). */
export const SUPPORTED_BUNDLE_CONTRACT_VERSION = 1;

export const SETTLE_ACQUISITION_KIND = 'in_season_partial';

/**
 * The bundle names families in dotted WIRE form; the registry keys them as a
 * `(source_key, family)` pair, exactly as `squiggle_api`/`match` is keyed. The
 * mapping is declared here once, so no other module has to know both spellings
 * and no string is assembled by concatenation at a call site.
 */
export const BUNDLE_FAMILIES: Readonly<Record<string, string>> = {
  'afltables.match': 'match',
  'afltables.player_match_stats': 'player_match_stats',
};

export function contractFamilyOf(wireFamily: string): string {
  const family = BUNDLE_FAMILIES[wireFamily];
  if (family === undefined) {
    fail(
      `'${wireFamily}' is not an AFLDB-ISSUE-099 source family. `
      + `The settle pass reads exactly ${Object.keys(BUNDLE_FAMILIES).join(' and ')}.`,
    );
  }
  return family;
}

/* ------------------------------------------------------------------ *
 * Targets
 * ------------------------------------------------------------------ */

export const MATCH_TARGET_TABLES = ['matches', 'match_period_scores'] as const;
export const PLAYER_MATCH_TARGET_TABLES = ['player_match_stats', 'brownlow_round_votes'] as const;

export type SettleTargetTable =
  | (typeof MATCH_TARGET_TABLES)[number]
  | (typeof PLAYER_MATCH_TARGET_TABLES)[number];

export function targetTablesFor(wireFamily: string): readonly SettleTargetTable[] {
  switch (contractFamilyOf(wireFamily)) {
    case 'match': return MATCH_TARGET_TABLES;
    case 'player_match_stats': return PLAYER_MATCH_TARGET_TABLES;
    /* c8 ignore next */
    default: return fail(`No target mapping for family '${wireFamily}'.`);
  }
}

/**
 * Does the SOURCE establish this target's fact for this record at all?
 *
 * `targetTablesFor()` answers what a family *can* propose; this answers what
 * this one record *does*. A target the source never established is not a
 * refusal, not an empty proposal and not an unresolved identity — **it does
 * not exist**, and nothing may be written about it.
 *
 * **Note what this function is not given: identity.** That is the whole
 * correction. T8's first real apply produced 803 pending
 * `brownlow_round_votes / unresolved_identity` candidates from a snapshot whose
 * 9522 `Brownlow.Votes` observations were *all* NA, because the existence
 * question was asked of the identity-resolved projection: a record whose player
 * URL was unlinked never reached the check, so every one of them proposed a
 * vote the source had never published. Whether AFL Tables published a vote is a
 * fact about the source; it cannot depend on whether this database happens to
 * know the player. The signature now makes asking it the other way impossible.
 *
 *   - **`brownlow_round_votes`** exists only where the source published a vote
 *     (§17.4, R3). NA means no target — never `votes = 0`, never a
 *     `played = true, votes = NULL` filler, and never an empty candidate. A
 *     published **0 is a real vote** and the target exists.
 *   - A record with no projection at all (Python could not interpret it) does
 *     not establish the vote either. Fail closed: absence of evidence that a
 *     vote exists is not evidence that one does. Presence is untouched — the
 *     observation is still persisted in full (§19).
 *   - Every other target is established by the record itself.
 *
 * Shape knowledge stays with `readPlayerMatchProjection()` — the one reader of
 * that JSON — so this can never drift from what the projection actually says.
 */
export function targetEstablishedBySource(
  targetTable: SettleTargetTable, projection: JsonValue | null,
): boolean {
  if (targetTable !== 'brownlow_round_votes') return true;
  if (projection === null) return false;
  return readPlayerMatchProjection(projection, 'the record projection')
    .brownlowRoundVote !== null;
}

/**
 * The targets that carry no `source_id` column (F5), and therefore cannot
 * express ownership at all.
 *
 * **Binding supply rule (§12).** For these the settle resolver must supply
 * `{ state: 'indeterminate' }`. It must never supply `'unowned'`: a table
 * with no provenance column has not DECLARED an absence of ownership, it
 * simply cannot answer, and claiming otherwise would be a false statement
 * that lets this source adopt a row whose provenance is unknown.
 * `indeterminate` fails closed to `foreign_owned_collision`, which is a
 * truthful refusal recording exactly why the target is not yet promotable.
 */
export const TARGETS_WITHOUT_SOURCE_ID: readonly SettleTargetTable[] = [
  'match_period_scores',
  'brownlow_round_votes',
];

export function ownershipForTarget(
  targetTable: SettleTargetTable, ownerSourceKey: string | null,
): TargetOwnership {
  if (TARGETS_WITHOUT_SOURCE_ID.includes(targetTable)) return { state: 'indeterminate' };
  if (ownerSourceKey === null) return { state: 'unowned' };
  return { state: 'owned', sourceKey: ownerSourceKey };
}

/* ------------------------------------------------------------------ *
 * Proposed field sets (§17)
 * ------------------------------------------------------------------ */

/** §17.1. `venue_id` may be NULL; `venue_raw` always carries the real string. */
export const MATCHES_PROPOSED_FIELDS = [
  'round_code', 'round_number', 'round_type', 'is_final',
  'match_date', 'match_time', 'venue_id', 'venue_raw',
  'home_club_id', 'away_club_id',
  'home_goals', 'home_behinds', 'home_score',
  'away_goals', 'away_behinds', 'away_score',
  'result', 'winner_club_id', 'margin',
  'attendance', 'attendance_status', 'attendance_source_id',
] as const;

/**
 * §17.2. The whole period set rides one field.
 *
 * `match_period_scores` is a multi-row target at `(match_id, club_id, period)`
 * grain, so the promotable unit is the SET, not a column. `diffFields()`
 * compares it structurally, so a single quarter moving is a diff on this field
 * and a reviewer sees the whole set that would be written.
 */
export const MATCH_PERIOD_SCORES_PROPOSED_FIELDS = ['period_scores'] as const;

/**
 * §17.3. `club_id`, `career_game_no`, `jumper_number` and the 21 statistic
 * columns, by explicit name and never by CSV column position.
 *
 * `brownlow_votes` is deliberately NOT here. It is genuine player-per-match
 * data at the `brownlow_round_votes` grain and is proposed there, once, rather
 * than to two targets from one observation. `Time.on.Ground` has no target
 * column at all and is not projected.
 */
export const PLAYER_MATCH_STATS_PROPOSED_FIELDS = [
  'club_id', 'career_game_no', 'jumper_number',
  'kicks', 'marks', 'handballs', 'disposals', 'goals', 'behinds', 'hitouts',
  'tackles', 'rebounds', 'inside_50s', 'clearances', 'clangers', 'frees_for',
  'frees_against', 'contested', 'uncontested', 'contested_marks',
  'marks_inside_50', 'one_percenters', 'bounces', 'goal_assists',
] as const;

/** The 21 statistic columns alone, in STAT_MAP order. */
export const PLAYER_MATCH_STAT_COLUMNS = PLAYER_MATCH_STATS_PROPOSED_FIELDS
  .filter((field) => !['club_id', 'career_game_no', 'jumper_number'].includes(field));

/**
 * §17.4. `(season, player_id, round_number)` is the target key; these two are
 * what a promotion would write.
 *
 * `played` is only ever `true` here, because a row exists only where the source
 * actually published a vote. A `played = true, votes = NULL` filler row is
 * never manufactured, and a zero is never inferred from absence.
 */
export const BROWNLOW_ROUND_VOTES_PROPOSED_FIELDS = ['played', 'votes'] as const;

export function proposedFieldsFor(targetTable: SettleTargetTable): readonly string[] {
  switch (targetTable) {
    case 'matches': return MATCHES_PROPOSED_FIELDS;
    case 'match_period_scores': return MATCH_PERIOD_SCORES_PROPOSED_FIELDS;
    case 'player_match_stats': return PLAYER_MATCH_STATS_PROPOSED_FIELDS;
    case 'brownlow_round_votes': return BROWNLOW_ROUND_VOTES_PROPOSED_FIELDS;
    /* c8 ignore next */
    default: return fail(`'${targetTable}' is not an AFLDB-ISSUE-099 target table.`);
  }
}

/* ------------------------------------------------------------------ *
 * data_issues identity (§13.1)
 * ------------------------------------------------------------------ */

/**
 * The natural identity of one recurring disagreement, and the dedup key behind
 * migration 076's `uq_data_issues_open_by_key`.
 *
 * The family component is the CONTRACT family (`match`), not the dotted wire
 * name, so the key does not read `afltables|afltables.match|...`. The source
 * key leads, exactly as `observationKey()` does, so this pass can never
 * collide with another source's finding for the same target.
 */
export function settleIssueKey(
  wireFamily: string, externalRecordId: string, targetTable: SettleTargetTable,
): string {
  if (!externalRecordId) fail('A data_issues key needs the external record id it describes.');
  return [
    SETTLE_SOURCE_KEY, contractFamilyOf(wireFamily), externalRecordId, targetTable,
  ].join('|');
}

/** The one `issue_type` ISSUE-099 writes. Decision C names exactly this case. */
export const SETTLE_ISSUE_TYPE = 'source_disagreement';

/**
 * The ownership stamp on every `data_issues` row this pass writes, and the
 * only rows it may ever auto-resolve. ISSUE-090's register pass deleted
 * conflicts it did not own; this is that lesson made mechanical.
 */
export const SETTLE_ISSUE_OWNER = 'AFLDB-ISSUE-099';

/**
 * §13.2. Disagreement is compared over the shared canonical fields of the
 * `matches` target only. A field another provider does not carry is simply not
 * shared, which `classifyCorroboration()` already handles.
 */
export const CORROBORATED_MATCH_FIELDS = ['home_score', 'away_score', 'attendance'] as const;

/** §13.1: a score disagreement on a completed match is an error, not a warning. */
export const SCORE_DISAGREEMENT_FIELDS = ['home_score', 'away_score'] as const;

/**
 * §13.1: a score disagreement on a completed match is an error, not a warning.
 *
 * The `warning` branch is structurally supported and correct, but is not
 * currently reachable from the v1 corroboration surface: the only evidence
 * table, `staging.external_current_matches` (migration 063), carries no
 * attendance column, so `attendance` is never a shared field and every
 * reachable conflict is a score conflict. That is a v1 limitation of the
 * evidence surface, recorded rather than papered over — neither the staging
 * schema nor another source is widened to make `warning` reachable.
 */
export function disagreementSeverity(conflictFields: readonly string[]): 'warning' | 'error' {
  return conflictFields.some((f) => (SCORE_DISAGREEMENT_FIELDS as readonly string[]).includes(f))
    ? 'error'
    : 'warning';
}

/**
 * One field's disagreement: `field`, this source's value under its own source
 * key, and one key per independence group that disagrees on that field.
 *
 * The shape is §13.1's, generalised to more than one disagreeing group
 * exactly as the T7 decision requires: one object per field, never one per
 * (field, group) pair, and the single-group case degenerates to §13.1's
 * example unchanged.
 */
export type DisagreementConflict = Readonly<Record<string, JsonValue>>;

/**
 * The per-field evidence behind a `source_disagreement`, for the reviewer.
 *
 * Only groups named in `disagreeingGroups` are read, so this source's OWN
 * group can never appear: a proxy drifting from its upstream is a
 * data-quality signal, not a second witness, and `classifyCorroboration()`
 * keeps it in `sameGroupConflicts`. Field comparison uses the reconciler's
 * own `sameValue()`, so a field listed here is exactly a field that
 * classified the group as disagreeing.
 *
 * A group is one witness however many provider rows carry it, so at most one
 * value per group is reported. Where two sources in one disagreeing group
 * differ on a field, the value is taken from the lowest source key, which
 * makes the row deterministic regardless of the order the evidence rows came
 * back from PostgreSQL.
 */
export function disagreementConflicts(
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
    const conflict: Record<string, JsonValue> = {
      field,
      [SETTLE_SOURCE_KEY]: proposedValues[field],
    };
    for (const group of [...byGroup.keys()].sort()) conflict[group] = byGroup.get(group) as JsonValue;
    conflicts.push(conflict);
  }
  return conflicts;
}

/** One `data_issues` row, drafted but not yet written. §13.1 exactly. */
export type SettleDataIssueDraft = {
  entityType: SettleTargetTable;
  /** The canonical row id, or NULL for a target that does not exist yet. */
  entityId: number | null;
  issueType: typeof SETTLE_ISSUE_TYPE;
  issueKey: string;
  severity: 'warning' | 'error';
  description: string;
  details: Readonly<Record<string, JsonValue>>;
};

/**
 * Draft the one `data_issues` row ISSUE-099 writes (§13).
 *
 * Pure: it decides the whole row from the run's own evidence and writes
 * nothing. The `owner` stamp is what later authorises this pass — and only
 * this pass — to resolve the row (§13.3); ISSUE-090's register pass deleted
 * conflicts it did not own, and this is that lesson made mechanical.
 *
 * Fail-closed twice over: a draft with no disagreeing group, or with a
 * disagreeing group but no conflicting field to show for it, is a claim the
 * evidence does not support and refuses rather than being written.
 */
export function draftDisagreementIssue(input: {
  wireFamily: string;
  externalRecordId: string;
  targetTable: SettleTargetTable;
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
    input.proposedValues, input.claims, corroboration.disagreeingGroups,
  );
  if (conflicts.length === 0) {
    fail(
      'A source_disagreement names disagreeing groups but no conflicting field; '
      + 'the evidence does not support the finding.',
    );
  }

  const fields = conflicts.map((conflict) => String(conflict.field));
  const family = contractFamilyOf(input.wireFamily);
  return {
    entityType: input.targetTable,
    entityId: input.targetId,
    issueType: SETTLE_ISSUE_TYPE,
    issueKey: settleIssueKey(input.wireFamily, input.externalRecordId, input.targetTable),
    severity: disagreementSeverity(fields),
    description:
      `${SETTLE_SOURCE_KEY} disagrees with ${corroboration.disagreeingGroups.join(', ')} `
      + `on ${fields.join(', ')} for ${input.targetTable} '${input.externalRecordId}'.`,
    details: {
      owner: SETTLE_ISSUE_OWNER,
      source_key: SETTLE_SOURCE_KEY,
      family,
      external_record_id: input.externalRecordId,
      target_table: input.targetTable,
      source_version_seq: input.sourceVersionSeq,
      agreeing_groups: [...corroboration.agreeingGroups],
      disagreeing_groups: [...corroboration.disagreeingGroups],
      conflicts,
    },
  };
}

/**
 * §13.3 as amended for T7: an open disagreement may be auto-resolved only on
 * POSITIVE evidence from the current run, never on the absence of evidence.
 *
 * This is the corroboration half of that rule, and it is deliberately narrow:
 *
 *   - `disagreeingGroups` empty — nothing currently contradicts this source;
 *   - `agreeingGroups` non-empty — at least one independent group is
 *     currently comparable AND positively agrees on the shared fields.
 *
 * The second condition carries two of the seven approved gates at once,
 * because `classifyCorroboration()` admits a group to `agreeingGroups` only
 * when it shared at least one field and matched on every shared field. So a
 * run in which every other provider has gone quiet, or carries none of the
 * compared fields, reports neither agreement nor disagreement and resolves
 * nothing.
 *
 * The remaining gates — the record is present in this bundle, its scope is
 * valid, and it is projectable enough to repeat the comparison — are
 * run-context facts the settle transaction supplies; they cannot be decided
 * here. "Not observed disagreeing" is never "agreement restored", exactly as
 * "not enumerated" is never "absent" (§19).
 */
export function agreementRestored(corroboration: CorroborationReport): boolean {
  return corroboration.disagreeingGroups.length === 0
    && corroboration.agreeingGroups.length > 0;
}

/* ------------------------------------------------------------------ *
 * The bundle (§8)
 * ------------------------------------------------------------------ */

export type BundleEnumeration = {
  family: string;
  scopeKey: string;
  complete: boolean;
  incompleteReason: string | null;
  externalRecordIds: readonly string[];
};

export type BundleRejection = { reason: string; detail: string | null };

export type BundleRecord = {
  family: string;
  scopeKey: string;
  externalRecordId: string;
  payload: JsonValue;
  observedColumns: readonly string[];
  /** The typed projection, or null when the record was observed but rejected. */
  projection: JsonValue | null;
  rejection: BundleRejection | null;
};

export type BundleUnkeyedRejection = {
  family: string;
  scopeKey: string;
  reason: string;
  detail: string | null;
};

export type SettleBundle = {
  bundleContractVersion: number;
  generatedBy: string;
  snapshotLabel: string;
  manifestPath: string;
  manifestSha256: string;
  acquisitionKind: string;
  season: number;
  fitzroyVersion: string | null;
  enumerations: readonly BundleEnumeration[];
  records: readonly BundleRecord[];
  unkeyedRejections: readonly BundleUnkeyedRejection[];
  counts: {
    matches: number;
    playerMatchRows: number;
    rejections: number;
    unkeyedRejections: number;
  };
};

/* -- fail-closed readers -------------------------------------------- */

type JsonObject = { readonly [key: string]: JsonValue };

function asObject(value: unknown, what: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${what} must be a JSON object.`);
  }
  return value as JsonObject;
}

function asArray(value: JsonValue | undefined, what: string): readonly JsonValue[] {
  if (!Array.isArray(value)) fail(`${what} must be an array.`);
  return value;
}

function asString(value: JsonValue | undefined, what: string): string {
  if (typeof value !== 'string' || value === '') fail(`${what} must be a non-empty string.`);
  return value;
}

function asNullableString(value: JsonValue | undefined, what: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') fail(`${what} must be a string or null.`);
  return value;
}

function asInteger(value: JsonValue | undefined, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    fail(`${what} must be an integer.`);
  }
  return value;
}

function asBoolean(value: JsonValue | undefined, what: string): boolean {
  if (typeof value !== 'boolean') fail(`${what} must be a boolean.`);
  return value;
}

function asStringArray(value: JsonValue | undefined, what: string): string[] {
  return asArray(value, what).map((item, i) => asString(item, `${what}[${i}]`));
}

function readRejection(value: JsonValue | undefined, what: string): BundleRejection | null {
  if (value === undefined || value === null) return null;
  const row = asObject(value, what);
  return {
    reason: asString(row.reason, `${what}.reason`),
    detail: asNullableString(row.detail, `${what}.detail`),
  };
}

/* -- the manifest the bundle names ----------------------------------- */

/**
 * Where the `manifest_path` a bundle names actually lives.
 *
 * String math only. Nothing here opens a file, and `projectRoot` must already
 * be absolute, so the answer can never depend on the directory the operator
 * happened to run from.
 *
 * T8 found the defect this exists to prevent. `import_fitzroy_core.py` builds
 * `MANIFEST_ROOT` from `Path(__file__).resolve()`, so the path it emits is
 * **always absolute** — `D:/dev/afldb-issue-099/docs/…` on Windows,
 * `/home/…/docs/…` on Linux — and it is normalised to forward slashes on the
 * way into the bundle. Joining that onto the repository root a second time
 * produced `D:\dev\afldb-issue-099\D:\dev\afldb-issue-099\docs\…`, and the
 * run died at the manifest re-hash. The bug is not Windows-specific: the same
 * join on Linux yields `/repo/home/…/docs/…`, which is equally wrong and
 * merely less obvious. `join()` is simply the wrong operator for a value that
 * may already be absolute.
 *
 *   - an already-absolute path is kept as it stands, never re-prefixed;
 *   - a repository-relative path still resolves against THIS worktree's root.
 *
 * Failing to find the manifest is not a fallback opportunity: the caller
 * re-hashes whatever this names and the digest comparison refuses the run.
 */
export function resolveManifestPath(projectRoot: string, manifestPath: string): string {
  if (manifestPath === '') {
    fail('The bundle names no manifest_path, so it cannot be verified.');
  }
  if (!isAbsolute(projectRoot)) {
    fail(
      `The repository root must be absolute to resolve a manifest path against it, but got `
      + `'${projectRoot}'. Resolving from a relative base would make the manifest a run `
      + 'depends on vary with the working directory it was started from.',
    );
  }
  return resolve(projectRoot, manifestPath);
}

/* -- validation ------------------------------------------------------ */

export type SettleBundleValidationInput = {
  /** The parsed bundle JSON, entirely untrusted. */
  raw: unknown;
  /** The label the operator asked to settle. */
  expectedSnapshotLabel: string;
  /** The manifest on disk, re-hashed by the caller. Compared, never trusted. */
  actualManifestSha256: string;
  /** `data/reference/seasons.json.in_progress_seasons`. */
  inProgressSeasons: readonly number[];
  registry: SourceFamilyRegistry;
};

/**
 * The §8 gate, in the order the runbook states it. Every failure refuses the
 * whole run before any database connection is opened (stage S-C, §21), so a
 * malformed or unverified snapshot cannot mutate PostgreSQL at all.
 *
 * The checks are deliberately not independent of one another: 5 and 6 exist
 * because presence and projection are separate facts, and an enumeration that
 * disagrees with the records it claims to enumerate would silently corrupt the
 * absence sweep — the one operation in this pipeline that can change state
 * from evidence of ABSENCE rather than evidence of presence.
 */
export function validateSettleBundle(input: SettleBundleValidationInput): SettleBundle {
  const root = asObject(input.raw, 'The observation bundle');

  // 1. Contract version, exactly. A newer emitter is refused, not tolerated.
  const version = asInteger(root.bundle_contract_version, 'bundle_contract_version');
  if (version !== SUPPORTED_BUNDLE_CONTRACT_VERSION) {
    fail(
      `Bundle contract version ${version} is not supported; this build reads exactly `
      + `version ${SUPPORTED_BUNDLE_CONTRACT_VERSION}.`,
    );
  }

  // 2. The bundle must describe the snapshot the operator named, and the
  //    manifest it claims must be the manifest actually on disk.
  const snapshotLabel = asString(root.snapshot_label, 'snapshot_label');
  if (snapshotLabel !== input.expectedSnapshotLabel) {
    fail(
      `Bundle snapshot_label '${snapshotLabel}' is not the requested snapshot `
      + `'${input.expectedSnapshotLabel}'.`,
    );
  }
  const manifestSha256 = asString(root.manifest_sha256, 'manifest_sha256');
  if (manifestSha256 !== input.actualManifestSha256) {
    fail(
      'The bundle names a manifest digest that does not match the manifest on disk. The '
      + 'snapshot changed after the bundle was emitted, so the bundle is not evidence of it.',
    );
  }

  // 3. In-season only, and only a season this pipeline owns. A completed
  //    season is not settled by this pass and never will be by v1.
  const acquisitionKind = asString(root.acquisition_kind, 'acquisition_kind');
  if (acquisitionKind !== SETTLE_ACQUISITION_KIND) {
    fail(
      `The settle pass reads only '${SETTLE_ACQUISITION_KIND}' snapshots; this bundle is `
      + `'${acquisitionKind}'.`,
    );
  }
  const season = asInteger(root.season, 'season');
  if (!input.inProgressSeasons.includes(season)) {
    fail(
      `Season ${season} is not in in_progress_seasons, so the settle pass does not own it.`,
    );
  }

  // 4. Families and columns. Every record must belong to a declared family,
  //    and its observed shape must pass the S1 projection gate: a missing
  //    required column or an undeclared one refuses rather than NULLing.
  const rawRecords = asArray(root.records, 'records');
  const records: BundleRecord[] = rawRecords.map((entry, i) => {
    const row = asObject(entry, `records[${i}]`);
    const wireFamily = asString(row.family, `records[${i}].family`);
    const contract = contractFor(input.registry, wireFamily);
    const observedColumns = asStringArray(
      row.observed_columns, `records[${i}].observed_columns`,
    );
    assertProjectableColumns(contract, observedColumns);
    return {
      family: wireFamily,
      scopeKey: asString(row.scope_key, `records[${i}].scope_key`),
      externalRecordId: asString(row.external_record_id, `records[${i}].external_record_id`),
      payload: asObject(row.payload, `records[${i}].payload`),
      observedColumns,
      projection: row.projection === undefined || row.projection === null
        ? null
        : asObject(row.projection, `records[${i}].projection`),
      rejection: readRejection(row.rejection, `records[${i}].rejection`),
    };
  });

  const rawEnumerations = asArray(root.enumerations, 'enumerations');
  const enumerations: BundleEnumeration[] = rawEnumerations.map((entry, i) => {
    const row = asObject(entry, `enumerations[${i}]`);
    const wireFamily = asString(row.family, `enumerations[${i}].family`);
    contractFor(input.registry, wireFamily);
    return {
      family: wireFamily,
      scopeKey: asString(row.scope_key, `enumerations[${i}].scope_key`),
      complete: asBoolean(row.complete, `enumerations[${i}].complete`),
      incompleteReason: asNullableString(
        row.incomplete_reason, `enumerations[${i}].incomplete_reason`,
      ),
      externalRecordIds: asStringArray(
        row.external_record_ids, `enumerations[${i}].external_record_ids`,
      ),
    };
  });

  const rawUnkeyed = asArray(root.unkeyed_rejections, 'unkeyed_rejections');
  const unkeyedRejections: BundleUnkeyedRejection[] = rawUnkeyed.map((entry, i) => {
    const row = asObject(entry, `unkeyed_rejections[${i}]`);
    const wireFamily = asString(row.family, `unkeyed_rejections[${i}].family`);
    contractFor(input.registry, wireFamily);
    return {
      family: wireFamily,
      scopeKey: asString(row.scope_key, `unkeyed_rejections[${i}].scope_key`),
      reason: asString(row.reason, `unkeyed_rejections[${i}].reason`),
      detail: asNullableString(row.detail, `unkeyed_rejections[${i}].detail`),
    };
  });

  assertEnumerationConsistency(enumerations, records, unkeyedRejections);

  const counts = asObject(root.counts, 'counts');
  return {
    bundleContractVersion: version,
    generatedBy: asString(root.generated_by, 'generated_by'),
    snapshotLabel,
    manifestPath: asString(root.manifest_path, 'manifest_path'),
    manifestSha256,
    acquisitionKind,
    season,
    fitzroyVersion: asNullableString(root.fitzroy_version, 'fitzroy_version'),
    enumerations,
    records,
    unkeyedRejections,
    counts: {
      matches: asInteger(counts.matches, 'counts.matches'),
      playerMatchRows: asInteger(counts.player_match_rows, 'counts.player_match_rows'),
      rejections: asInteger(counts.rejections, 'counts.rejections'),
      unkeyedRejections: asInteger(counts.unkeyed_rejections, 'counts.unkeyed_rejections'),
    },
  };
}

function contractFor(
  registry: SourceFamilyRegistry, wireFamily: string,
): SourceFamilyContract {
  const contract = getSourceFamily(registry, SETTLE_SOURCE_KEY, contractFamilyOf(wireFamily));
  if (contract.status !== 'declared') {
    fail(
      `${SETTLE_SOURCE_KEY}/${contract.family} is '${contract.status}'; the settle pass reads `
      + 'only a declared family.',
    );
  }
  return contract;
}

/**
 * The map key of one `(family, scope_key)` pair.
 *
 * The separator is U+0000: no family or scope key can contain one, so the key
 * cannot be ambiguous — the same reasoning as `observationKey()`. It is
 * written as an escape rather than a literal byte, because a raw NUL makes
 * the source file binary to `file`, `grep` and diff tools.
 */
function scopeOf(familyOrScope: { family: string; scopeKey: string }): string {
  return `${familyOrScope.family}\u0000${familyOrScope.scopeKey}`;
}

/**
 * §8.5 and §8.6 — the two checks that protect the absence sweep.
 *
 * A record outside its enumeration means the presence list is not the presence
 * list. A missing record for a `complete: true` enumeration means the bundle
 * claims to have enumerated something it did not carry. And an unkeyed
 * rejection whose scope still claims completeness is the exact SC5 violation:
 * a row was observed whose presence cannot be represented at all, so that
 * scope is not sweepable and must say so.
 */
function assertEnumerationConsistency(
  enumerations: readonly BundleEnumeration[],
  records: readonly BundleRecord[],
  unkeyedRejections: readonly BundleUnkeyedRejection[],
): void {
  const byScope = new Map<string, BundleEnumeration>();
  for (const enumeration of enumerations) {
    const key = scopeOf(enumeration);
    if (byScope.has(key)) {
      fail(
        `Two enumerations describe ${enumeration.family} scope '${enumeration.scopeKey}'; `
        + 'a scope has exactly one presence list.',
      );
    }
    byScope.set(key, enumeration);
  }

  const seen = new Map<string, Set<string>>();
  for (const record of records) {
    const key = scopeOf(record);
    const enumeration = byScope.get(key);
    if (!enumeration) {
      fail(
        `Record '${record.externalRecordId}' is in ${record.family} scope `
        + `'${record.scopeKey}', which the bundle does not enumerate.`,
      );
    }
    if (!enumeration.externalRecordIds.includes(record.externalRecordId)) {
      fail(
        `Record '${record.externalRecordId}' is not listed in the ${record.family} `
        + `enumeration for '${record.scopeKey}'. Presence is enumerated independently of `
        + 'projection, so every record must appear in it.',
      );
    }
    let scopeSeen = seen.get(key);
    if (!scopeSeen) { scopeSeen = new Set(); seen.set(key, scopeSeen); }
    if (scopeSeen.has(record.externalRecordId)) {
      fail(
        `Record '${record.externalRecordId}' appears twice in ${record.family} scope `
        + `'${record.scopeKey}'.`,
      );
    }
    scopeSeen.add(record.externalRecordId);
  }

  for (const enumeration of enumerations) {
    if (!enumeration.complete) continue;
    const scopeSeen = seen.get(scopeOf(enumeration)) ?? new Set<string>();
    for (const recordId of enumeration.externalRecordIds) {
      if (!scopeSeen.has(recordId)) {
        fail(
          `The ${enumeration.family} enumeration for '${enumeration.scopeKey}' is complete `
          + `and lists '${recordId}', but the bundle carries no record for it.`,
        );
      }
    }
  }

  for (const unkeyed of unkeyedRejections) {
    const enumeration = byScope.get(scopeOf(unkeyed));
    if (!enumeration) {
      fail(
        `An unkeyed rejection names ${unkeyed.family} scope '${unkeyed.scopeKey}', which the `
        + 'bundle does not enumerate.',
      );
    }
    if (enumeration.complete) {
      fail(
        `${unkeyed.family} scope '${unkeyed.scopeKey}' carries an unkeyed rejection but claims `
        + 'complete: true. A row whose presence cannot be represented makes the scope '
        + 'incomplete, and sweeping it would mark records absent that were actually seen.',
      );
    }
  }
}

/* ------------------------------------------------------------------ *
 * The absence-sweep gate (§19)
 * ------------------------------------------------------------------ */

export type SweepPlan = {
  /** Scopes proven complete, and therefore safe to sweep. */
  sweepable: readonly { family: string; contractFamily: string; scopeKey: string }[];
  /** Scopes deliberately NOT swept, with the reason, for the operator report. */
  skipped: readonly { family: string; scopeKey: string; reason: string }[];
};

/**
 * Which `(family, scope)` pairs this run may assert absence in.
 *
 * A scope is sweepable only when its enumeration is `complete`. Anything else
 * is skipped and counted as `absenceSweepSkipped` — never swept "best effort".
 * `sweepAbsences()` is already fail-closed against an empty scope list, so a
 * skipped scope is simply never passed to it.
 */
export function planAbsenceSweep(bundle: SettleBundle): SweepPlan {
  const sweepable: { family: string; contractFamily: string; scopeKey: string }[] = [];
  const skipped: { family: string; scopeKey: string; reason: string }[] = [];
  for (const enumeration of bundle.enumerations) {
    if (enumeration.complete) {
      sweepable.push({
        family: enumeration.family,
        contractFamily: contractFamilyOf(enumeration.family),
        scopeKey: enumeration.scopeKey,
      });
    } else {
      skipped.push({
        family: enumeration.family,
        scopeKey: enumeration.scopeKey,
        reason: enumeration.incompleteReason ?? 'enumeration incomplete',
      });
    }
  }
  return { sweepable, skipped };
}

/* ------------------------------------------------------------------ *
 * Typed projections (§17)
 * ------------------------------------------------------------------ */

export type PeriodScore = {
  side: 'home' | 'away';
  period: number;
  goals: number | null;
  behinds: number | null;
  points: number | null;
};

/** The emitter's `afltables.match` projection, read fail-closed. */
export type MatchProjection = {
  matchKey: string;
  season: number;
  roundCode: string;
  roundNumber: number | null;
  roundType: string;
  isFinal: boolean;
  matchDate: string;
  matchTime: string | null;
  venueRaw: string;
  homeClubHist: string;
  awayClubHist: string;
  homeGoals: number | null;
  homeBehinds: number | null;
  homeScore: number;
  awayGoals: number | null;
  awayBehinds: number | null;
  awayScore: number;
  result: string;
  winnerClubHist: string | null;
  margin: number;
  /** NULL is NOT RECORDED. A recorded 0 is a real crowd and cites its source. */
  attendance: number | null;
  attendanceStatus: string;
  attendanceSourceKey: string | null;
  /** Periods 1-4 only, cumulative-to-date, all-NULL sides already dropped. */
  periodScores: readonly PeriodScore[];
};

export type PlayerMatchProjection = {
  url: string;
  /** Enrichment only. Never an identity key, and legitimately absent in-season. */
  afltablesId: string | null;
  matchKey: string;
  season: number;
  roundCode: string;
  roundNumber: number | null;
  isFinal: boolean;
  clubHist: string;
  careerGameNo: number | null;
  jumperNumber: string | null;
  /** The 21 statistic columns plus `brownlow_votes`, by name. NULL stays NULL. */
  stats: Readonly<Record<string, number | null>>;
  /** Null unless the source actually published a vote for a polled round. */
  brownlowRoundVote: { season: number; roundNumber: number; votes: number } | null;
};

function asNullableInteger(value: JsonValue | undefined, what: string): number | null {
  if (value === undefined || value === null) return null;
  return asInteger(value, what);
}

export function readMatchProjection(projection: JsonValue, what: string): MatchProjection {
  const row = asObject(projection, what);
  return {
    matchKey: asString(row.match_key, `${what}.match_key`),
    season: asInteger(row.season, `${what}.season`),
    roundCode: asString(row.round_code, `${what}.round_code`),
    roundNumber: asNullableInteger(row.round_number, `${what}.round_number`),
    roundType: asString(row.round_type, `${what}.round_type`),
    isFinal: asBoolean(row.is_final, `${what}.is_final`),
    matchDate: asString(row.match_date, `${what}.match_date`),
    matchTime: asNullableString(row.match_time, `${what}.match_time`),
    venueRaw: asString(row.venue_raw, `${what}.venue_raw`),
    homeClubHist: asString(row.home_club_hist, `${what}.home_club_hist`),
    awayClubHist: asString(row.away_club_hist, `${what}.away_club_hist`),
    homeGoals: asNullableInteger(row.home_goals, `${what}.home_goals`),
    homeBehinds: asNullableInteger(row.home_behinds, `${what}.home_behinds`),
    homeScore: asInteger(row.home_score, `${what}.home_score`),
    awayGoals: asNullableInteger(row.away_goals, `${what}.away_goals`),
    awayBehinds: asNullableInteger(row.away_behinds, `${what}.away_behinds`),
    awayScore: asInteger(row.away_score, `${what}.away_score`),
    result: asString(row.result, `${what}.result`),
    winnerClubHist: asNullableString(row.winner_club_hist, `${what}.winner_club_hist`),
    margin: asInteger(row.margin, `${what}.margin`),
    attendance: asNullableInteger(row.attendance, `${what}.attendance`),
    attendanceStatus: asString(row.attendance_status, `${what}.attendance_status`),
    attendanceSourceKey: asNullableString(
      row.attendance_source_key, `${what}.attendance_source_key`,
    ),
    periodScores: asArray(row.period_scores, `${what}.period_scores`)
      .map((entry, i) => readPeriodScore(entry, `${what}.period_scores[${i}]`)),
  };
}

function readPeriodScore(value: JsonValue, what: string): PeriodScore {
  const row = asObject(value, what);
  const side = asString(row.side, `${what}.side`);
  if (side !== 'home' && side !== 'away') fail(`${what}.side must be 'home' or 'away'.`);
  const period = asInteger(row.period, `${what}.period`);
  // fitzRoy carries extra-time columns and the historical importer deliberately
  // does not import them. This pass preserves that exactly and invents none.
  if (period < 1 || period > 4) {
    fail(`${what}.period is ${period}; this source writes periods 1-4 only.`);
  }
  return {
    side,
    period,
    goals: asNullableInteger(row.goals, `${what}.goals`),
    behinds: asNullableInteger(row.behinds, `${what}.behinds`),
    points: asNullableInteger(row.points, `${what}.points`),
  };
}

export function readPlayerMatchProjection(
  projection: JsonValue, what: string,
): PlayerMatchProjection {
  const row = asObject(projection, what);
  const stats: Record<string, number | null> = {};
  const rawStats = asObject(row.stats, `${what}.stats`);
  for (const column of PLAYER_MATCH_STAT_COLUMNS) {
    stats[column] = asNullableInteger(rawStats[column], `${what}.stats.${column}`);
  }
  // Carried so the projection row can store it, but NOT proposed to
  // player_match_stats: the vote's own target is brownlow_round_votes.
  stats.brownlow_votes = asNullableInteger(
    rawStats.brownlow_votes, `${what}.stats.brownlow_votes`,
  );

  const rawVote = row.brownlow_round_vote;
  let brownlowRoundVote: PlayerMatchProjection['brownlowRoundVote'] = null;
  if (rawVote !== undefined && rawVote !== null) {
    const vote = asObject(rawVote, `${what}.brownlow_round_vote`);
    brownlowRoundVote = {
      season: asInteger(vote.season, `${what}.brownlow_round_vote.season`),
      roundNumber: asInteger(vote.round_number, `${what}.brownlow_round_vote.round_number`),
      votes: asInteger(vote.votes, `${what}.brownlow_round_vote.votes`),
    };
  }

  const isFinal = asBoolean(row.is_final, `${what}.is_final`);
  // NA is never a row, and finals are never polled. Both are refused here as
  // well as being unrepresentable in migration 076, because a bundle that
  // claimed either would be proposing a vote fact the source never published.
  if (brownlowRoundVote !== null && isFinal) {
    fail(`${what} proposes a round vote for a final; finals are never polled.`);
  }

  return {
    url: asString(row.url, `${what}.url`),
    afltablesId: asNullableString(row.afltables_id, `${what}.afltables_id`),
    matchKey: asString(row.match_key, `${what}.match_key`),
    season: asInteger(row.season, `${what}.season`),
    roundCode: asString(row.round_code, `${what}.round_code`),
    roundNumber: asNullableInteger(row.round_number, `${what}.round_number`),
    isFinal,
    clubHist: asString(row.club_hist, `${what}.club_hist`),
    careerGameNo: asNullableInteger(row.career_game_no, `${what}.career_game_no`),
    jumperNumber: asNullableString(row.jumper_number, `${what}.jumper_number`),
    stats,
    brownlowRoundVote,
  };
}

/* ------------------------------------------------------------------ *
 * Proposed values (§17)
 * ------------------------------------------------------------------ */

/** The canonical ids the settle resolver looked up inside the transaction. */
export type ResolvedMatchIdentity = {
  homeClubId: number;
  awayClubId: number;
  /** NULL where the source venue string maps to no known venue. Never 'Unknown'. */
  venueId: number | null;
  winnerClubId: number | null;
  /** The `sources` row id for `afltables`, or null when attendance is absent. */
  attendanceSourceId: number | null;
};

/**
 * The `matches` proposal (§17.1).
 *
 * `venue_raw` always carries the real source string, and `venue_id` is NULL
 * where nothing maps — the literal `'Unknown'` that ISSUE-098 wrote is never
 * produced here. Attendance is `complete` + a cited source when a figure
 * exists (a legitimate 0 included) and `not_collected` + NULL otherwise, which
 * is exactly what `matches_attendance_status_ck` and
 * `matches_zero_attendance_ck` require. NULL is never 0.
 */
export function proposedMatchValues(
  projection: MatchProjection, identity: ResolvedMatchIdentity,
): Record<string, JsonValue> {
  return {
    round_code: projection.roundCode,
    round_number: projection.roundNumber,
    round_type: projection.roundType,
    is_final: projection.isFinal,
    match_date: projection.matchDate,
    match_time: projection.matchTime,
    venue_id: identity.venueId,
    venue_raw: projection.venueRaw,
    home_club_id: identity.homeClubId,
    away_club_id: identity.awayClubId,
    home_goals: projection.homeGoals,
    home_behinds: projection.homeBehinds,
    home_score: projection.homeScore,
    away_goals: projection.awayGoals,
    away_behinds: projection.awayBehinds,
    away_score: projection.awayScore,
    result: projection.result,
    winner_club_id: identity.winnerClubId,
    margin: projection.margin,
    attendance: projection.attendance,
    attendance_status: projection.attendanceStatus,
    attendance_source_id: identity.attendanceSourceId,
  };
}

/**
 * The `match_period_scores` proposal (§17.2): cumulative-to-date, as published,
 * periods 1-4, with `side` resolved to the club identity the canonical grain
 * uses. A side/period whose goals, behinds AND points are all NULL is already
 * absent from the projection and writes no row — *not recorded* is not 0.
 */
export function proposedPeriodScoreValues(
  projection: MatchProjection, identity: ResolvedMatchIdentity,
): Record<string, JsonValue> {
  const rows = projection.periodScores
    .map((score) => ({
      club_id: score.side === 'home' ? identity.homeClubId : identity.awayClubId,
      period: score.period,
      goals: score.goals,
      behinds: score.behinds,
      points: score.points,
    }))
    .sort((a, b) => (a.club_id - b.club_id) || (a.period - b.period));
  return { period_scores: rows };
}

/**
 * The `player_match_stats` proposal (§17.3): the resolved historical club, the
 * two participation fields, and the 21 statistics by explicit name.
 *
 * A NULL in a covered statistic is REPORTED as `nullInCoveredStat` and is not
 * a refusal — a player can genuinely have an absent value — so it stays NULL
 * here rather than being coerced or dropped.
 */
export function proposedPlayerMatchValues(
  projection: PlayerMatchProjection, clubId: number,
): Record<string, JsonValue> {
  const values: Record<string, JsonValue> = {
    club_id: clubId,
    career_game_no: projection.careerGameNo,
    jumper_number: projection.jumperNumber,
  };
  for (const column of PLAYER_MATCH_STAT_COLUMNS) {
    values[column] = projection.stats[column] ?? null;
  }
  return values;
}

/**
 * The `brownlow_round_votes` proposal (§17.4), or **null when the source
 * published no vote**.
 *
 * Null is the expected in-season outcome and is correct, not a defect: AFL
 * Tables publishes no votes until the count. The round stays pending. This
 * never writes `votes = 0` for an unpolled round, never manufactures a
 * `played = true, votes = NULL` filler row, and never infers a zero from
 * absence. A published 0 is a real vote and is proposed as one.
 */
export function proposedBrownlowValues(
  projection: PlayerMatchProjection,
): Record<string, JsonValue> | null {
  if (projection.brownlowRoundVote === null) return null;
  return { played: true, votes: projection.brownlowRoundVote.votes };
}

/* ================================================================== *
 * The settle transaction (§21 stage S-D)
 *
 * ONE `sql.begin`, mirroring the existing `writeMatches` envelope. Any
 * error rolls back EVERYTHING, including the `import_batches` row, so no
 * batch can claim success and no report can claim a write that did not
 * happen.
 *
 * WHAT THIS PASS WRITES: `import_batches`, the migration-074 spine
 * (`source_payloads`, `source_record_versions`, `source_records`), the two
 * migration-076 typed projections, `promotion_candidates` and
 * `import_rejections`.
 *
 * WHAT IT NEVER WRITES: `matches`, `match_period_scores`,
 * `player_match_stats`, `brownlow_round_votes`, `players`, `clubs`,
 * `venues`, `venue_aliases`, `external_identities`, `club_seasons`,
 * `brownlow_season_votes` or `promotion_decisions`. `canonicalRowsInserted`
 * and `canonicalRowsUpdated` are literally 0 (§15).
 *
 * OBLIGATION O1: no statement in this module deletes or truncates either
 * ISSUE-099 projection. Both are maintained by upsert alone; a projection
 * row is REPLACED in place when its observation moves, never removed and
 * re-inserted, so the table can never be momentarily empty inside the
 * transaction either.
 * ================================================================== */

type Tx = postgres.TransactionSql;

/** Thrown to force the deliberate `--dry-run` rollback (§22). */
export class SettleDryRunRollback extends Error {
  constructor() {
    super('settle dry-run: rolling back deliberately');
    this.name = 'SettleDryRunRollback';
  }
}

export type SettleCounters = {
  snapshotMatches: number;
  snapshotPlayerMatchRows: number;
  snapshotRejections: number;
  snapshotUnkeyedRejections: number;

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
  nullInCoveredStat: number;
  unresolvedIdentityPlayer: number;
  unresolvedIdentityClub: number;
  unresolvedIdentityVenue: number;
  unresolvedIdentityMatch: number;
  foreignOwnedCollision: number;
  sourceDisagreement: number;
  manualAuthorityRefusals: number;

  candidatesCreated: number;
  candidatesRefreshed: number;
  candidatesMootLeftPending: number;

  dataIssuesOpened: number;
  dataIssuesRefreshed: number;
  dataIssuesResolved: number;

  /** Literally zero in v1, and asserted as a runtime fact (§15). */
  canonicalRowsInserted: 0;
  canonicalRowsUpdated: 0;
};

function emptyCounters(): SettleCounters {
  return {
    snapshotMatches: 0,
    snapshotPlayerMatchRows: 0,
    snapshotRejections: 0,
    snapshotUnkeyedRejections: 0,
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
    nullInCoveredStat: 0,
    unresolvedIdentityPlayer: 0,
    unresolvedIdentityClub: 0,
    unresolvedIdentityVenue: 0,
    unresolvedIdentityMatch: 0,
    foreignOwnedCollision: 0,
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
  };
}

export type SettleRunOptions = {
  bundle: SettleBundle;
  registry: SourceFamilyRegistry;
  /** `false` runs the identical write path and rolls it back (§22). */
  apply: boolean;
  /** `UNAVAILABLE_MANUAL_AUTHORITY` in v1. There is no bypass. */
  manualAuthority: ManualAuthorityProvider;
  /** Passed in, never taken from a clock inside the decision layer. */
  observedAt?: string;
};

export type SettleRunResult = {
  applied: boolean;
  batchId: number | null;
  counters: SettleCounters;
  absenceSweepSkipped: SweepPlan['skipped'];
};

/* -- reference data loaded once per run ------------------------------ */

type SettleRefs = {
  sourceId: number;
  sourceKeysById: ReadonlyMap<number, string>;
  clubIdsByHist: ReadonlyMap<string, number>;
  venueIdsByLegacyName: ReadonlyMap<string, number>;
  playerIdsByUrl: ReadonlyMap<string, number>;
  matchIdsByKey: ReadonlyMap<string, number>;
};

async function loadRefs(tx: Tx, season: number): Promise<SettleRefs> {
  const sources = await tx<{ id: number; key: string }[]>`SELECT id, key FROM sources`;
  const sourceIdsByKey = new Map(sources.map((row) => [row.key, row.id]));
  const sourceId = resolveSourceId(sourceIdsByKey, SETTLE_SOURCE_KEY);

  const clubs = await tx<{ legacyClubHist: string | null; id: number }[]>`
    SELECT legacy_club_hist AS "legacyClubHist", id FROM clubs
  `;
  const venues = await tx<{ legacyName: string | null; id: number }[]>`
    SELECT legacy_name AS "legacyName", id FROM venues
  `;
  // §17.3: identity is the profile url, resolved through the registered
  // link. An unlinked or ambiguous url is unresolved — never a new player.
  const links = await tx<{ externalId: string; playerId: number }[]>`
    SELECT external_id AS "externalId", player_id AS "playerId"
      FROM external_identities
     WHERE source_id = ${sourceId}
       AND match_method = 'afltables_profile_url'
       AND status IN ('unique', 'resolved')
       AND player_id IS NOT NULL
  `;
  const matches = await tx<{ matchKey: string; id: number }[]>`
    SELECT match_key AS "matchKey", id FROM matches WHERE season = ${season}
  `;

  return {
    sourceId,
    sourceKeysById: new Map(sources.map((row) => [row.id, row.key])),
    clubIdsByHist: new Map(
      clubs.filter((row) => row.legacyClubHist !== null)
        .map((row) => [row.legacyClubHist as string, row.id]),
    ),
    venueIdsByLegacyName: new Map(
      venues.filter((row) => row.legacyName !== null)
        .map((row) => [row.legacyName as string, row.id]),
    ),
    playerIdsByUrl: new Map(links.map((row) => [row.externalId, row.playerId])),
    matchIdsByKey: new Map(matches.map((row) => [row.matchKey, row.id])),
  };
}

/**
 * Every open observation head for one family, in one query.
 *
 * `reconcile()` needs the head as it stood BEFORE this run persisted
 * anything, so it is read up front. The store still takes its own
 * `FOR UPDATE` read per record — that lock is part of the extracted
 * behaviour and is not bypassed here.
 */
async function loadHeads(
  tx: Tx, sourceId: number, family: string,
): Promise<Map<string, ObservationHead>> {
  const rows = await tx<{
    externalRecordId: string;
    versionSeq: number;
    payloadHash: string;
    hashRecipe: string;
    rawPayload: JsonValue;
    absentSince: Date | string | null;
  }[]>`
    SELECT r.external_record_id AS "externalRecordId",
           v.version_seq AS "versionSeq",
           v.payload_hash AS "payloadHash",
           p.hash_recipe AS "hashRecipe",
           p.raw_payload AS "rawPayload",
           r.absent_since AS "absentSince"
      FROM staging.source_records r
      JOIN staging.source_record_versions v
        ON v.source_id = r.source_id
       AND v.family = r.family
       AND v.external_record_id = r.external_record_id
       AND v.version_seq = r.current_version_seq
      JOIN staging.source_payloads p
        ON p.source_id = v.source_id
       AND p.family = v.family
       AND p.payload_hash = v.payload_hash
     WHERE r.source_id = ${sourceId} AND r.family = ${family}
  `;
  return new Map(rows.map((row) => [row.externalRecordId, {
    versionSeq: row.versionSeq,
    payloadHash: row.payloadHash,
    hashRecipe: row.hashRecipe,
    rawPayload: row.rawPayload,
    absentSince: row.absentSince === null ? null : String(row.absentSince),
  }]));
}

async function loadKnownPayloadHashes(
  tx: Tx, sourceId: number, family: string,
): Promise<Set<string>> {
  const rows = await tx<{ payloadHash: string }[]>`
    SELECT payload_hash AS "payloadHash"
      FROM staging.source_payloads
     WHERE source_id = ${sourceId} AND family = ${family}
  `;
  return new Set(rows.map((row) => row.payloadHash));
}

/* -- identity resolution --------------------------------------------- */

/**
 * How one target's identity resolved, plus the counter the failure belongs
 * to. Resolution is this pass's job; `reconcile()` consumes the answer and
 * never guesses one.
 */
type ResolvedTarget = {
  identity: IdentityResolution;
  targetId: number | null;
  targetValues: Readonly<Record<string, JsonValue>> | null;
};

function unresolved(reason: string): ResolvedTarget {
  return { identity: { status: 'unresolved', reason }, targetId: null, targetValues: null };
}

function ownershipOf(
  targetTable: SettleTargetTable, refs: SettleRefs, ownerSourceId: number | null,
): TargetOwnership {
  if (TARGETS_WITHOUT_SOURCE_ID.includes(targetTable)) return { state: 'indeterminate' };
  if (ownerSourceId === null) return { state: 'unowned' };
  const key = refs.sourceKeysById.get(ownerSourceId);
  // A source id with no readable key is not an absence of ownership; it is an
  // unreadable owner, which fails closed rather than being adopted.
  return key === undefined ? { state: 'indeterminate' } : { state: 'owned', sourceKey: key };
}

/* -- the run --------------------------------------------------------- */

/**
 * One settle pass over one validated bundle.
 *
 * `apply: false` executes exactly this code path — the same statements, the
 * same constraints, the same unique indexes, the same role privileges — and
 * then rolls the whole transaction back. A dry-run that passes therefore
 * proves the apply would too, and leaves no ISSUE-099-owned state behind.
 */
export async function runSettleAfltables(
  sql: postgres.Sql, options: SettleRunOptions,
): Promise<SettleRunResult> {
  // The registry is not destructured here: it is threaded down through
  // `options` to `settleFamily()`, which is the only reader.
  const { bundle } = options;
  const observedAt = options.observedAt ?? new Date().toISOString();
  const counters = emptyCounters();
  counters.snapshotMatches = bundle.counts.matches;
  counters.snapshotPlayerMatchRows = bundle.counts.playerMatchRows;
  counters.snapshotRejections = bundle.counts.rejections;
  counters.snapshotUnkeyedRejections = bundle.counts.unkeyedRejections;

  const sweep = planAbsenceSweep(bundle);
  counters.absenceSweepSkipped = sweep.skipped.length;

  let batchId: number | null = null;
  let applied = false;

  try {
    await sql.begin(async (tx) => {
      const refs = await loadRefs(tx, bundle.season);

      const [batch] = await tx<{ id: number }[]>`
        INSERT INTO import_batches (source_id, tool, target_table, records_read, notes)
        VALUES (${refs.sourceId}, 'settle-afltables.ts',
                'staging.source_record_versions',
                ${bundle.records.length},
                ${`AFLDB-ISSUE-099 settle; snapshot=${bundle.snapshotLabel}; `
                  + `season=${bundle.season}; mode=${options.apply ? 'apply' : 'dry-run'}`})
        RETURNING id
      `;
      batchId = batch.id;

      // §19's completeness proof, reused by §13.3: a scope this run could not
      // prove complete is not a scope in which anything can be positively
      // re-proved either.
      const completeScopes = new Set(
        sweep.sweepable.map((scope) => `${scope.family}|${scope.scopeKey}`),
      );
      // The issue keys this run positively re-proved as agreeing (A14). A key
      // reaches this set only on evidence; nothing is added because a
      // disagreement merely failed to reappear.
      const restoredKeys = new Set<string>();

      for (const wireFamily of Object.keys(BUNDLE_FAMILIES)) {
        await settleFamily(
          tx, wireFamily, refs, batch.id, observedAt, options, counters,
          completeScopes, restoredKeys,
        );
      }

      // §19: absence is asserted ONLY inside a proven-complete enumeration.
      // A skipped scope is simply never passed, so nothing in it is stamped.
      const scopes: EnumeratedScope[] = sweep.sweepable.map((scope) => ({
        sourceId: refs.sourceId,
        family: scope.contractFamily,
        scopeKey: scope.scopeKey,
      }));
      counters.observationsMarkedAbsent = await markMissingObservationsAbsent(
        tx, scopes, batch.id, observedAt,
      );

      // §13.3: close only the disagreements this run positively re-proved,
      // and count the rows PostgreSQL actually updated rather than the keys
      // planned — an ownership or already-resolved mismatch must show as a
      // resolution that did not happen.
      counters.dataIssuesResolved = await resolveRestoredDisagreements(tx, restoredKeys);

      // `import_batches.records_rejected` is defined by migration 001 as the
      // number of `import_rejections` rows for the batch, and every writer in
      // this repository sets it that way — `tools/migration/common.py:253`
      // passes `len(self._rejections)`. It is therefore counted from the rows
      // this transaction actually wrote rather than taken from
      // `snapshotRejections`: a bundle rejection and a rejection row are
      // different facts. One record refused against two targets writes two
      // rows, and a record the emitter rejected writes rejection rows only
      // where a target refused for unresolved identity.
      const [rejected] = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n
          FROM import_rejections WHERE import_batch_id = ${batch.id}
      `;

      // 'completed' is the success value of the `import_status` enum
      // (migration 001: running | completed | failed | rolled_back), and the
      // partial index `ix_import_batches_status` keys on it. There is no
      // 'succeeded' member and never was.
      await tx`
        UPDATE import_batches
           SET completed_at = now(), status = 'completed',
               records_rejected = ${rejected.n},
               validation_result = ${tx.json(counters as never)}
         WHERE id = ${batch.id}
      `;

      // §22: the dry-run runs the real write path and then throws, so the
      // rollback discards the batch row along with everything else.
      if (!options.apply) throw new SettleDryRunRollback();
      applied = true;
    });
  } catch (error) {
    if (!(error instanceof SettleDryRunRollback)) throw error;
    batchId = null;
  }

  return { applied, batchId, counters, absenceSweepSkipped: sweep.skipped };
}

async function settleFamily(
  tx: Tx,
  wireFamily: string,
  refs: SettleRefs,
  batchId: number,
  observedAt: string,
  options: SettleRunOptions,
  counters: SettleCounters,
  /** `family|scopeKey` for every enumeration this run proved complete (§19). */
  completeScopes: ReadonlySet<string>,
  /** Collects the issue keys this run positively re-proved as agreeing (§13.3). */
  restoredKeys: Set<string>,
): Promise<void> {
  const family = contractFamilyOf(wireFamily);
  const contract = getSourceFamily(options.registry, SETTLE_SOURCE_KEY, family);
  const records = options.bundle.records.filter((record) => record.family === wireFamily);
  if (records.length === 0) return;

  const heads = await loadHeads(tx, refs.sourceId, family);
  const knownHashes = await loadKnownPayloadHashes(tx, refs.sourceId, family);

  for (const record of records) {
    const head = heads.get(record.externalRecordId) ?? null;

    // 1. THE HARD INVARIANT (§19). Every keyed record reaches the spine,
    //    whether or not it projects, so the next sweep sees it as seen.
    const incoming = hashPayload(contract, record.payload);
    const action = await persistSourceObservation(tx, {
      contract,
      sourceId: refs.sourceId,
      externalRecordId: record.externalRecordId,
      scopeKey: record.scopeKey,
      payload: record.payload,
    }, batchId, observedAt);
    counters.observationsSeen += 1;
    if (action === 'version_inserted') {
      counters.versionsAppended += 1;
      if (knownHashes.has(incoming.hash)) counters.payloadsReused += 1;
      else counters.payloadsCreated += 1;
      knownHashes.add(incoming.hash);
    }
    if (head?.absentSince != null) counters.observationsReappeared += 1;

    // 2. The typed projection, gated on resolved identity. A rejected record
    //    writes NO projection row — and is still fully present above.
    const projected = record.rejection === null && record.projection !== null
      ? await projectRecord(tx, wireFamily, record, refs, batchId, counters)
      : null;

    // 3. Reconcile each of the family's two canonical targets.
    for (const targetTable of targetTablesFor(wireFamily)) {
      // FIRST, and before identity is consulted at all: did the source
      // establish this target? A target that does not exist gets no
      // resolution, no proposal, no candidate and no rejection — asking
      // anything else about it would be asking about a fact nobody published.
      if (!targetEstablishedBySource(targetTable, record.projection)) continue;

      const resolvedTarget = projected
        ? await resolveTarget(tx, targetTable, projected, refs, counters)
        : unresolved(
          record.rejection
            ? `${record.rejection.reason}: ${record.rejection.detail ?? 'no detail'}`
            : 'the record produced no typed projection',
        );
      const proposedValues = projected
        ? proposedValuesForTarget(targetTable, projected)
        : {};

      // Read ONCE and reused below. A `data_issues` row must explain itself
      // with exactly the evidence that classified it, so the reconciler and
      // the disagreement writer are never handed two different reads of the
      // same providers (§13.2).
      const claims = targetTable === 'matches' && projected
        ? await corroborationClaims(tx, projected, refs, options.registry)
        : [];

      // §13.3 / A14 — the disagreement lifecycle re-evaluates corroboration
      // for ITSELF, on every run, whichever precedence branch `reconcile()`
      // takes. The reconciler answers "did THIS source move?"; that is a
      // different question from "do the sources still disagree?", and an
      // unchanged AFL Tables payload is no reason to leave a finding standing
      // after the other provider moved to agreement.
      //
      // Gates 1-3 are structural and are checked right here: the record came
      // from this run's bundle, its enumeration was proven complete, and it
      // projected well enough for the SAME comparison to be repeated over the
      // SAME proposed values. Gate 4 is this call itself. Gates 5-7 are the
      // pure `agreementRestored()` predicate, which needs a comparable group
      // that positively agrees — a provider that has gone quiet or carries
      // none of the compared fields proves nothing, and silence is never
      // agreement, exactly as an un-enumerated scope is never absence (§19).
      if (
        projected !== null
        && completeScopes.has(`${wireFamily}|${record.scopeKey}`)
        && agreementRestored(classifyCorroboration(contract, proposedValues ?? {}, claims))
      ) {
        restoredKeys.add(settleIssueKey(wireFamily, record.externalRecordId, targetTable));
      }

      const outcome = reconcile({
        contract,
        externalRecordId: record.externalRecordId,
        head,
        observed: {
          present: true,
          payload: record.payload,
          observedAt,
          knownPayloadHashes: knownHashes,
          observedColumns: record.observedColumns,
        },
        identity: resolvedTarget.identity,
        proposedValues: proposedValues ?? {},
        targetValues: resolvedTarget.targetValues,
        // Every AFL Tables results row is a completed match, so `rescheduled`
        // can never apply and no field is a schedule field.
        recordState: 'played',
        scheduleFields: [],
        corroboration: claims,
        manualAuthority: options.manualAuthority,
      });

      await recordOutcome(tx, {
        contract,
        wireFamily,
        record,
        targetTable,
        outcome,
        resolvedTarget,
        proposedValues: proposedValues ?? {},
        claims,
        season: options.bundle.season,
        refs,
        batchId,
        counters,
      });
    }
  }
}

/* -- projection writers (upsert only — O1) ---------------------------- */

type ProjectedRecord =
  | { family: 'match'; projection: MatchProjection; identity: ResolvedMatchIdentity }
  | { family: 'player_match_stats'; projection: PlayerMatchProjection; clubId: number;
    playerId: number; matchKey: string };

/**
 * Write the typed projection row for a record whose identity fully resolved,
 * or return null and count the reason when it did not.
 *
 * Maintained by upsert alone. The row is replaced in place when its
 * observation moves; it is never deleted, and the table is never truncated
 * (obligation O1).
 */
async function projectRecord(
  tx: Tx,
  wireFamily: string,
  record: BundleRecord,
  refs: SettleRefs,
  batchId: number,
  counters: SettleCounters,
): Promise<ProjectedRecord | null> {
  const family = contractFamilyOf(wireFamily);
  if (family === 'match') {
    const projection = readMatchProjection(
      record.projection as JsonValue, `records[${record.externalRecordId}].projection`,
    );
    const homeClubId = refs.clubIdsByHist.get(projection.homeClubHist);
    const awayClubId = refs.clubIdsByHist.get(projection.awayClubHist);
    if (homeClubId === undefined || awayClubId === undefined) {
      counters.unresolvedIdentityClub += 1;
      return null;
    }
    const venueId = refs.venueIdsByLegacyName.get(projection.venueRaw) ?? null;
    // Normal, and never a refusal: venue_raw carries the real string and
    // venue_id stays NULL. No venues or venue_aliases row is ever created,
    // and the literal 'Unknown' is never written. Counted as venueUnmapped,
    // NOT as an unresolved identity — this pass never refuses on a venue.
    if (venueId === null) counters.venueUnmapped += 1;
    const identity: ResolvedMatchIdentity = {
      homeClubId,
      awayClubId,
      venueId,
      winnerClubId: projection.winnerClubHist === null
        ? null
        : refs.clubIdsByHist.get(projection.winnerClubHist) ?? null,
      attendanceSourceId: projection.attendance === null ? null : refs.sourceId,
    };
    await writeMatchProjection(tx, record, projection, identity, refs, batchId);
    counters.projectionRowsWritten += 1;
    return { family: 'match', projection, identity };
  }

  const projection = readPlayerMatchProjection(
    record.projection as JsonValue, `records[${record.externalRecordId}].projection`,
  );
  const playerId = refs.playerIdsByUrl.get(projection.url);
  if (playerId === undefined) {
    // §17.3: participation is never created from unresolved identity, and a
    // player name never stands in for the url.
    counters.unresolvedIdentityPlayer += 1;
    return null;
  }
  const clubId = refs.clubIdsByHist.get(projection.clubHist);
  if (clubId === undefined) {
    counters.unresolvedIdentityClub += 1;
    return null;
  }
  for (const column of PLAYER_MATCH_STAT_COLUMNS) {
    // Reported, never a refusal: a player can genuinely have an absent value.
    if (projection.stats[column] === null) counters.nullInCoveredStat += 1;
  }
  await writePlayerMatchProjection(tx, record, projection, playerId, clubId, refs, batchId);
  counters.projectionRowsWritten += 1;
  return {
    family: 'player_match_stats', projection, clubId, playerId, matchKey: projection.matchKey,
  };
}

async function writeMatchProjection(
  tx: Tx,
  record: BundleRecord,
  projection: MatchProjection,
  identity: ResolvedMatchIdentity,
  refs: SettleRefs,
  batchId: number,
): Promise<void> {
  const family = contractFamilyOf(record.family);
  const versionSeq = await currentVersionSeq(tx, refs.sourceId, family, record.externalRecordId);
  const quarter = (side: 'home' | 'away', period: number, key: 'goals' | 'behinds' | 'points') =>
    projection.periodScores.find((row) => row.side === side && row.period === period)?.[key]
      ?? null;
  await tx`
    INSERT INTO staging.afltables_match (
      source_id, family, external_record_id, version_seq,
      season, round_code, round_number, round_type, is_final, match_date, match_time,
      venue_id, venue_raw, home_club_id, away_club_id,
      home_goals, home_behinds, home_score, away_goals, away_behinds, away_score,
      result, winner_club_id, margin,
      attendance, attendance_status, attendance_source_id,
      home_q1_goals, home_q1_behinds, home_q1_points,
      home_q2_goals, home_q2_behinds, home_q2_points,
      home_q3_goals, home_q3_behinds, home_q3_points,
      home_q4_goals, home_q4_behinds, home_q4_points,
      away_q1_goals, away_q1_behinds, away_q1_points,
      away_q2_goals, away_q2_behinds, away_q2_points,
      away_q3_goals, away_q3_behinds, away_q3_points,
      away_q4_goals, away_q4_behinds, away_q4_points,
      projected_by_batch_id
    ) VALUES (
      ${refs.sourceId}, ${family}, ${record.externalRecordId}, ${versionSeq},
      ${projection.season}, ${projection.roundCode}, ${projection.roundNumber},
      ${projection.roundType}::round_type, ${projection.isFinal},
      ${projection.matchDate}, ${projection.matchTime},
      ${identity.venueId}, ${projection.venueRaw},
      ${identity.homeClubId}, ${identity.awayClubId},
      ${projection.homeGoals}, ${projection.homeBehinds}, ${projection.homeScore},
      ${projection.awayGoals}, ${projection.awayBehinds}, ${projection.awayScore},
      ${projection.result}::match_result, ${identity.winnerClubId}, ${projection.margin},
      ${projection.attendance}, ${projection.attendanceStatus}::coverage_status,
      ${identity.attendanceSourceId},
      ${quarter('home', 1, 'goals')}, ${quarter('home', 1, 'behinds')}, ${quarter('home', 1, 'points')},
      ${quarter('home', 2, 'goals')}, ${quarter('home', 2, 'behinds')}, ${quarter('home', 2, 'points')},
      ${quarter('home', 3, 'goals')}, ${quarter('home', 3, 'behinds')}, ${quarter('home', 3, 'points')},
      ${quarter('home', 4, 'goals')}, ${quarter('home', 4, 'behinds')}, ${quarter('home', 4, 'points')},
      ${quarter('away', 1, 'goals')}, ${quarter('away', 1, 'behinds')}, ${quarter('away', 1, 'points')},
      ${quarter('away', 2, 'goals')}, ${quarter('away', 2, 'behinds')}, ${quarter('away', 2, 'points')},
      ${quarter('away', 3, 'goals')}, ${quarter('away', 3, 'behinds')}, ${quarter('away', 3, 'points')},
      ${quarter('away', 4, 'goals')}, ${quarter('away', 4, 'behinds')}, ${quarter('away', 4, 'points')},
      ${batchId}
    )
    ON CONFLICT (source_id, family, external_record_id) DO UPDATE SET
      version_seq = EXCLUDED.version_seq,
      season = EXCLUDED.season, round_code = EXCLUDED.round_code,
      round_number = EXCLUDED.round_number, round_type = EXCLUDED.round_type,
      is_final = EXCLUDED.is_final, match_date = EXCLUDED.match_date,
      match_time = EXCLUDED.match_time,
      venue_id = EXCLUDED.venue_id, venue_raw = EXCLUDED.venue_raw,
      home_club_id = EXCLUDED.home_club_id, away_club_id = EXCLUDED.away_club_id,
      home_goals = EXCLUDED.home_goals, home_behinds = EXCLUDED.home_behinds,
      home_score = EXCLUDED.home_score, away_goals = EXCLUDED.away_goals,
      away_behinds = EXCLUDED.away_behinds, away_score = EXCLUDED.away_score,
      result = EXCLUDED.result, winner_club_id = EXCLUDED.winner_club_id,
      margin = EXCLUDED.margin, attendance = EXCLUDED.attendance,
      attendance_status = EXCLUDED.attendance_status,
      attendance_source_id = EXCLUDED.attendance_source_id,
      home_q1_goals = EXCLUDED.home_q1_goals, home_q1_behinds = EXCLUDED.home_q1_behinds,
      home_q1_points = EXCLUDED.home_q1_points,
      home_q2_goals = EXCLUDED.home_q2_goals, home_q2_behinds = EXCLUDED.home_q2_behinds,
      home_q2_points = EXCLUDED.home_q2_points,
      home_q3_goals = EXCLUDED.home_q3_goals, home_q3_behinds = EXCLUDED.home_q3_behinds,
      home_q3_points = EXCLUDED.home_q3_points,
      home_q4_goals = EXCLUDED.home_q4_goals, home_q4_behinds = EXCLUDED.home_q4_behinds,
      home_q4_points = EXCLUDED.home_q4_points,
      away_q1_goals = EXCLUDED.away_q1_goals, away_q1_behinds = EXCLUDED.away_q1_behinds,
      away_q1_points = EXCLUDED.away_q1_points,
      away_q2_goals = EXCLUDED.away_q2_goals, away_q2_behinds = EXCLUDED.away_q2_behinds,
      away_q2_points = EXCLUDED.away_q2_points,
      away_q3_goals = EXCLUDED.away_q3_goals, away_q3_behinds = EXCLUDED.away_q3_behinds,
      away_q3_points = EXCLUDED.away_q3_points,
      away_q4_goals = EXCLUDED.away_q4_goals, away_q4_behinds = EXCLUDED.away_q4_behinds,
      away_q4_points = EXCLUDED.away_q4_points,
      projected_by_batch_id = EXCLUDED.projected_by_batch_id,
      projected_at = now()
  `;
}

async function writePlayerMatchProjection(
  tx: Tx,
  record: BundleRecord,
  projection: PlayerMatchProjection,
  playerId: number,
  clubId: number,
  refs: SettleRefs,
  batchId: number,
): Promise<void> {
  const family = contractFamilyOf(record.family);
  const versionSeq = await currentVersionSeq(tx, refs.sourceId, family, record.externalRecordId);
  const stat = (column: string) => projection.stats[column] ?? null;
  await tx`
    INSERT INTO staging.afltables_player_match (
      source_id, family, external_record_id, version_seq,
      season, match_key, round_code, is_final,
      player_id, club_id, afltables_id, career_game_no, jumper_number,
      kicks, marks, handballs, disposals, goals, behinds, hitouts, tackles,
      rebounds, inside_50s, clearances, clangers, frees_for, frees_against,
      contested, uncontested, contested_marks, marks_inside_50, one_percenters,
      bounces, goal_assists, brownlow_votes, brownlow_round_number,
      projected_by_batch_id
    ) VALUES (
      ${refs.sourceId}, ${family}, ${record.externalRecordId}, ${versionSeq},
      ${projection.season}, ${projection.matchKey}, ${projection.roundCode},
      ${projection.isFinal},
      ${playerId}, ${clubId}, ${projection.afltablesId},
      ${projection.careerGameNo}, ${projection.jumperNumber},
      ${stat('kicks')}, ${stat('marks')}, ${stat('handballs')}, ${stat('disposals')},
      ${stat('goals')}, ${stat('behinds')}, ${stat('hitouts')}, ${stat('tackles')},
      ${stat('rebounds')}, ${stat('inside_50s')}, ${stat('clearances')}, ${stat('clangers')},
      ${stat('frees_for')}, ${stat('frees_against')}, ${stat('contested')},
      ${stat('uncontested')}, ${stat('contested_marks')}, ${stat('marks_inside_50')},
      ${stat('one_percenters')}, ${stat('bounces')}, ${stat('goal_assists')},
      ${stat('brownlow_votes')},
      ${projection.brownlowRoundVote === null ? null : projection.brownlowRoundVote.roundNumber},
      ${batchId}
    )
    ON CONFLICT (source_id, family, external_record_id) DO UPDATE SET
      version_seq = EXCLUDED.version_seq,
      season = EXCLUDED.season, match_key = EXCLUDED.match_key,
      round_code = EXCLUDED.round_code, is_final = EXCLUDED.is_final,
      player_id = EXCLUDED.player_id, club_id = EXCLUDED.club_id,
      afltables_id = EXCLUDED.afltables_id, career_game_no = EXCLUDED.career_game_no,
      jumper_number = EXCLUDED.jumper_number,
      kicks = EXCLUDED.kicks, marks = EXCLUDED.marks, handballs = EXCLUDED.handballs,
      disposals = EXCLUDED.disposals, goals = EXCLUDED.goals, behinds = EXCLUDED.behinds,
      hitouts = EXCLUDED.hitouts, tackles = EXCLUDED.tackles, rebounds = EXCLUDED.rebounds,
      inside_50s = EXCLUDED.inside_50s, clearances = EXCLUDED.clearances,
      clangers = EXCLUDED.clangers, frees_for = EXCLUDED.frees_for,
      frees_against = EXCLUDED.frees_against, contested = EXCLUDED.contested,
      uncontested = EXCLUDED.uncontested, contested_marks = EXCLUDED.contested_marks,
      marks_inside_50 = EXCLUDED.marks_inside_50, one_percenters = EXCLUDED.one_percenters,
      bounces = EXCLUDED.bounces, goal_assists = EXCLUDED.goal_assists,
      brownlow_votes = EXCLUDED.brownlow_votes,
      brownlow_round_number = EXCLUDED.brownlow_round_number,
      projected_by_batch_id = EXCLUDED.projected_by_batch_id,
      projected_at = now()
  `;
}

/** The open version this run just wrote; the projection must name it exactly. */
async function currentVersionSeq(
  tx: Tx, sourceId: number, family: string, externalRecordId: string,
): Promise<number> {
  const [row] = await tx<{ versionSeq: number }[]>`
    SELECT current_version_seq AS "versionSeq"
      FROM staging.source_records
     WHERE source_id = ${sourceId} AND family = ${family}
       AND external_record_id = ${externalRecordId}
  `;
  if (!row) {
    fail(
      `No spine record for '${externalRecordId}'; the observation must be persisted before `
      + 'its projection names a version.',
    );
  }
  return row.versionSeq;
}

/* -- per-target resolution and proposals ------------------------------ */

function proposedValuesForTarget(
  targetTable: SettleTargetTable, projected: ProjectedRecord,
): Record<string, JsonValue> | null {
  if (projected.family === 'match') {
    return targetTable === 'matches'
      ? proposedMatchValues(projected.projection, projected.identity)
      : proposedPeriodScoreValues(projected.projection, projected.identity);
  }
  return targetTable === 'player_match_stats'
    ? proposedPlayerMatchValues(projected.projection, projected.clubId)
    : proposedBrownlowValues(projected.projection);
}

/**
 * The canonical target this proposal would write, and its current values.
 *
 * `new_target` is used only where the natural key genuinely resolved and no
 * row exists. Where a component of the key cannot resolve — most often a
 * canonical match that does not exist yet, which is the NORMAL in-season
 * state on a rebuilt database — the answer is `unresolved`, never a new
 * target, because no source may create an identity.
 */
async function resolveTarget(
  tx: Tx,
  targetTable: SettleTargetTable,
  projected: ProjectedRecord,
  refs: SettleRefs,
  counters: SettleCounters,
): Promise<ResolvedTarget> {
  if (projected.family === 'match') {
    const matchId = refs.matchIdsByKey.get(projected.projection.matchKey) ?? null;
    if (targetTable === 'matches') {
      if (matchId === null) {
        return {
          identity: {
            status: 'new_target',
            entity: 'matches',
            targetKey: { match_key: projected.projection.matchKey },
          },
          targetId: null,
          targetValues: null,
        };
      }
      const [row] = await tx<{ ownerSourceId: number | null }[]>`
        SELECT source_id AS "ownerSourceId" FROM matches WHERE id = ${matchId}
      `;
      const current = await currentMatchValues(tx, matchId);
      return {
        identity: {
          status: 'resolved',
          entity: 'matches',
          targetKey: { match_key: projected.projection.matchKey },
          ownership: ownershipOf(targetTable, refs, row?.ownerSourceId ?? null),
        },
        targetId: matchId,
        targetValues: current,
      };
    }
    // match_period_scores keys on match_id, so without a canonical match the
    // target identity does not resolve at all.
    if (matchId === null) {
      counters.unresolvedIdentityMatch += 1;
      return unresolved('no canonical match exists for this match_key yet');
    }
    // Selected with the SAME key names the proposal uses, so `diffFields()`
    // compares like with like. An aliased column would never match and every
    // run would look like a correction.
    const rows = await tx<{
      club_id: number; period: number;
      goals: number | null; behinds: number | null; points: number | null;
    }[]>`
      SELECT club_id, period, goals, behinds, points
        FROM match_period_scores WHERE match_id = ${matchId}
       ORDER BY club_id, period
    `;
    return {
      identity: {
        status: 'resolved',
        entity: 'match_period_scores',
        targetKey: { match_id: matchId },
        // F5: no source_id column, so ownership is INDETERMINATE, never
        // 'unowned'. This fails closed to foreign_owned_collision.
        ownership: ownershipOf(targetTable, refs, null),
      },
      targetId: matchId,
      targetValues: { period_scores: [...rows] as unknown as JsonValue },
    };
  }

  const matchId = refs.matchIdsByKey.get(projected.matchKey) ?? null;
  if (targetTable === 'player_match_stats') {
    if (matchId === null) {
      counters.unresolvedIdentityMatch += 1;
      return unresolved('no canonical match exists for this match_key yet');
    }
    const [row] = await tx<Record<string, JsonValue>[]>`
      SELECT * FROM player_match_stats
       WHERE player_id = ${projected.playerId} AND match_id = ${matchId}
    `;
    if (!row) {
      return {
        identity: {
          status: 'new_target',
          entity: 'player_match_stats',
          targetKey: { player_id: projected.playerId, match_id: matchId },
        },
        targetId: null,
        targetValues: null,
      };
    }
    const values: Record<string, JsonValue> = {};
    for (const field of PLAYER_MATCH_STATS_PROPOSED_FIELDS) {
      values[field] = (row as unknown as Record<string, JsonValue>)[field] ?? null;
    }
    return {
      identity: {
        status: 'resolved',
        entity: 'player_match_stats',
        targetKey: { player_id: projected.playerId, match_id: matchId },
        ownership: ownershipOf(
          targetTable, refs,
          (row as unknown as { source_id: number | null }).source_id ?? null,
        ),
      },
      targetId: (row as unknown as { id: number }).id,
      targetValues: values,
    };
  }

  const vote = projected.projection.brownlowRoundVote;
  /* c8 ignore next */
  if (vote === null) return unresolved('the source published no round vote');
  const [row] = await tx<{ id: number; played: boolean; votes: number | null }[]>`
    SELECT id, played, votes FROM brownlow_round_votes
     WHERE season = ${vote.season} AND player_id = ${projected.playerId}
       AND round_number = ${vote.roundNumber}
  `;
  if (!row) {
    return {
      identity: {
        status: 'new_target',
        entity: 'brownlow_round_votes',
        targetKey: {
          season: vote.season, player_id: projected.playerId, round_number: vote.roundNumber,
        },
      },
      targetId: null,
      targetValues: null,
    };
  }
  return {
    identity: {
      status: 'resolved',
      entity: 'brownlow_round_votes',
      targetKey: {
        season: vote.season, player_id: projected.playerId, round_number: vote.roundNumber,
      },
      // F5 again: no source_id column on this target either.
      ownership: ownershipOf(targetTable, refs, null),
    },
    targetId: row.id,
    targetValues: { played: row.played, votes: row.votes },
  };
}

async function currentMatchValues(
  tx: Tx, matchId: number,
): Promise<Record<string, JsonValue>> {
  const [row] = await tx<Record<string, JsonValue>[]>`
    SELECT * FROM matches WHERE id = ${matchId}
  `;
  const values: Record<string, JsonValue> = {};
  for (const field of MATCHES_PROPOSED_FIELDS) {
    const value = row?.[field];
    values[field] = value === undefined || value === null
      ? null
      : (value instanceof Date ? value.toISOString().slice(0, 10) : value);
  }
  return values;
}

/**
 * §13.2 — other providers' claims for this match, read from the TYPED
 * projection `staging.external_current_matches`, never from the jsonb spine
 * (Decision B). Only the shared canonical fields of the `matches` target are
 * carried, so `classifyCorroboration()` compares scores and nothing else.
 *
 * Agreement is recorded for the reviewer and authorises nothing: provider
 * independence is not proven-distinct ultimate authority.
 */
async function corroborationClaims(
  tx: Tx,
  projected: ProjectedRecord,
  refs: SettleRefs,
  registry: SourceFamilyRegistry,
): Promise<ProviderClaim[]> {
  if (projected.family !== 'match') return [];
  const matchId = refs.matchIdsByKey.get(projected.projection.matchKey);
  if (matchId === undefined) return [];
  const rows = await tx<{
    sourceId: number; homeClubId: number | null;
    homeScore: number | null; awayScore: number | null;
  }[]>`
    SELECT source_id AS "sourceId", home_club_id AS "homeClubId",
           home_score AS "homeScore", away_score AS "awayScore"
      FROM staging.external_current_matches
     WHERE local_match_id = ${matchId}
  `;
  const claims: ProviderClaim[] = [];
  for (const row of rows) {
    if (row.sourceId === refs.sourceId) continue;
    if (row.homeScore === null || row.awayScore === null) continue;
    const sourceKey = refs.sourceKeysById.get(row.sourceId);
    if (sourceKey === undefined) continue;
    const contract = getSourceFamily(registry, sourceKey, 'match');
    // Orient the other provider's scores onto this proposal's home side.
    const sameOrientation = row.homeClubId === projected.identity.homeClubId;
    claims.push({
      contract,
      values: {
        home_score: sameOrientation ? row.homeScore : row.awayScore,
        away_score: sameOrientation ? row.awayScore : row.homeScore,
      },
    });
  }
  return claims;
}

/* -- the data_issues disagreement writer (§13) ------------------------ */

/**
 * Open or refresh the ONE `data_issues` row this pass writes.
 *
 * Migration 076's `uq_data_issues_open_by_key` is unique on
 * `(issue_type, issue_key) WHERE issue_key IS NOT NULL AND resolved_at IS
 * NULL`, so a duplicate open finding is unrepresentable rather than merely
 * discouraged: a recurring disagreement REFRESHES the one open row.
 *
 * What the refresh deliberately does NOT touch:
 *
 *   - `detected_at` — it is not in the `DO UPDATE SET` list, and its default
 *     applies only on INSERT, so it stays at FIRST detection (§13.3);
 *   - the row `id` — this is an UPDATE, so the finding keeps its identity and
 *     anything referring to it still refers to it;
 *   - `resolved_at` / `resolution` — resolution is a separate decision with
 *     its own evidence, and is not made here.
 *
 * There is no DELETE and no TRUNCATE on any path (obligation O1). A
 * disagreement that stops reproducing is resolved in place, never removed.
 */
async function writeDisagreementIssue(
  tx: Tx, draft: SettleDataIssueDraft, counters: SettleCounters,
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

/**
 * §13.3 — close the disagreements this run POSITIVELY re-proved, and return
 * how many rows were actually closed.
 *
 * Four things this statement is careful about:
 *
 *   - **UPDATE only.** A resolved disagreement stays in the table as history.
 *     It is never deleted, and there is no DELETE or TRUNCATE anywhere on
 *     this path (obligation O1).
 *   - **Ownership.** `details->>'owner'` is matched exactly, so this pass can
 *     only ever close a finding it wrote. ISSUE-090's register pass deleted
 *     conflicts it did not own; that is the whole reason this predicate is
 *     here rather than implied.
 *   - **`resolved_at IS NULL`.** A row closed by an earlier run, or by a
 *     super admin, is not closed a second time — so a rerun after resolution
 *     reports zero, which is what makes the counter idempotent.
 *   - **The count is what PostgreSQL updated**, never how many keys were
 *     planned. A key whose row is foreign-owned or already resolved must show
 *     up as a resolution that did not happen.
 *
 * `now()` is the current transaction's time, so a dry-run's resolutions roll
 * back with everything else.
 */
async function resolveRestoredDisagreements(
  tx: Tx, restoredKeys: ReadonlySet<string>,
): Promise<number> {
  if (restoredKeys.size === 0) return 0;
  const resolved = await tx<{ id: string }[]>`
    UPDATE data_issues
       SET resolved_at = now(), resolution = 'source_agreement_restored'
     WHERE issue_type = ${SETTLE_ISSUE_TYPE}
       AND issue_key = ANY(${[...restoredKeys]}::text[])
       AND resolved_at IS NULL
       AND details->>'owner' = ${SETTLE_ISSUE_OWNER}
    RETURNING id
  `;
  return resolved.length;
}

/* -- outcome recording ------------------------------------------------ */

async function recordOutcome(
  tx: Tx,
  input: {
    contract: SourceFamilyContract;
    /** The dotted wire family, which `settleIssueKey()` narrows to the contract family. */
    wireFamily: string;
    record: BundleRecord;
    targetTable: SettleTargetTable;
    outcome: ReconciliationOutcome;
    resolvedTarget: ResolvedTarget;
    /** Exactly the values corroboration was classified over. */
    proposedValues: Readonly<Record<string, JsonValue>>;
    claims: readonly ProviderClaim[];
    season: number;
    refs: SettleRefs;
    batchId: number;
    counters: SettleCounters;
  },
): Promise<void> {
  const {
    contract, record, targetTable, outcome, resolvedTarget, season, refs, batchId, counters,
  } = input;
  if (outcome.kind === 'unchanged') {
    counters.observationsUnchanged += 1;
    return;
  }
  if (outcome.kind === 'history_only') {
    // The payload moved but no projected fact did. History advances, and an
    // existing pending candidate is LEFT IN PLACE (F7) — no machine
    // retirement, no fabricated admin decision, no empty replacement.
    counters.observationsHistoryOnly += 1;
    counters.candidatesMootLeftPending += 1;
    return;
  }
  if (outcome.kind === 'absent') {
    // §18.2: absence is observation state only. No candidate, ever.
    return;
  }

  if (outcome.kind === 'refusal') {
    switch (outcome.verb) {
      case 'unresolved_identity':
        await tx`
          INSERT INTO import_rejections (
            import_batch_id, source_record_id, reason, payload
          ) VALUES (
            ${batchId}, ${record.externalRecordId},
            ${`${targetTable}: ${outcome.note ?? outcome.detail}`},
            ${tx.json(record.payload as never)}
          )
        `;
        break;
      case 'foreign_owned_collision':
        counters.foreignOwnedCollision += 1;
        break;
      case 'source_disagreement':
        counters.sourceDisagreement += 1;
        // §13: the ONE case Decision C names for data_issues. The refusal
        // candidate below is still created, so the reviewer sees both the
        // blocked proposal and the deduplicated finding behind it.
        //
        // `entity_id` is the RESOLVED target id, not the candidate's: a
        // candidate carrying a refusal verb reports no target id at all, but
        // a disagreement about an existing canonical row must name that row.
        // It is NULL only when the target genuinely does not exist yet.
        await writeDisagreementIssue(tx, draftDisagreementIssue({
          wireFamily: input.wireFamily,
          externalRecordId: record.externalRecordId,
          targetTable,
          targetId: resolvedTarget.targetId,
          // The same version the candidate names, from the same decision, so
          // the finding and the proposal can never cite different evidence.
          sourceVersionSeq: outcome.observation?.versionSeq ?? null,
          proposedValues: input.proposedValues,
          claims: input.claims,
          // Non-null for this verb: `reconcile()` reaches it only by
          // classifying corroboration.
          corroboration: outcome.corroboration ?? fail(
            'A source_disagreement must carry the corroboration report that raised it.',
          ),
        }), counters);
        break;
      case 'manual_authority_conflict':
        counters.manualAuthorityRefusals += 1;
        break;
      default:
        break;
    }
  } else {
    counters.observationsCorrected += 1;
  }

  const candidate = draftCandidate({
    contract,
    externalRecordId: record.externalRecordId,
    outcome,
    season,
    targetTable,
    targetId: resolvedTarget.targetId,
    currentValues: resolvedTarget.targetValues,
  });

  // §14: ux_promotion_candidates_pending is unique on
  // (source_id, family, external_record_id, target_table) WHERE pending, so a
  // rerun REFRESHES the one pending row and never stacks duplicates.
  const [written] = await tx<{ inserted: boolean }[]>`
    INSERT INTO promotion_candidates (
      source_id, family, external_record_id, source_version_seq, verb, season,
      target_table, target_id, proposed_fields, baseline_canonical_hash,
      agreeing_groups, disagreeing_groups, created_by_batch_id
    ) VALUES (
      ${refs.sourceId}, ${contract.family}, ${record.externalRecordId},
      ${candidate.sourceVersionSeq}, ${candidate.verb}, ${candidate.season},
      ${targetTable}, ${candidate.targetId},
      ${tx.json(candidate.proposedValues as never)}, ${candidate.baselineCanonicalHash},
      ${[...candidate.agreeingGroups]}::text[],
      ${[...candidate.disagreeingGroups]}::text[],
      ${batchId}
    )
    ON CONFLICT (source_id, family, external_record_id, target_table)
      WHERE status = 'pending'
      DO UPDATE SET
        source_version_seq = EXCLUDED.source_version_seq,
        verb = EXCLUDED.verb,
        target_id = EXCLUDED.target_id,
        proposed_fields = EXCLUDED.proposed_fields,
        baseline_canonical_hash = EXCLUDED.baseline_canonical_hash,
        agreeing_groups = EXCLUDED.agreeing_groups,
        disagreeing_groups = EXCLUDED.disagreeing_groups,
        created_by_batch_id = EXCLUDED.created_by_batch_id
    RETURNING (xmax = 0) AS inserted
  `;
  if (written?.inserted) counters.candidatesCreated += 1;
  else counters.candidatesRefreshed += 1;
}
