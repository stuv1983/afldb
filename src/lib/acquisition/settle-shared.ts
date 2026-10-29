/**
 * Source-NEUTRAL settle helpers shared by the AFL API settle (`settle-afl-api.ts`), the settle
 * report (`settle-report.ts`) and the retired AFL Tables settle (`settle-afltables.ts`).
 *
 * AFLDB V2 Launch F (V2-GAP-012): these lived in `settle-afltables.ts`, so the AFL API runtime
 * imported the AFL Tables module. They are moved here VERBATIM (target tables, the player-stat
 * columns, the data_issues types and owners, and the automatic-path proposal scoping); nothing in
 * this module reads or executes AFL Tables. `settle-afltables.ts` re-exports them so its
 * offline tools and tests keep one definition.
 */
import { scopePlayerMatchStatsFields } from './manual-authority';
import type { JsonValue, ManualAuthorityProvider } from './observations';

/**
 * The settle report's historical default `sourceKey` (its first caller's source). A string only:
 * every caller for another source passes its own (`settle-report.ts`). Equal by value to
 * `settle-afltables.ts` SETTLE_SOURCE_KEY.
 */
export const DEFAULT_SETTLE_REPORT_SOURCE_KEY = 'afltables';

export const MATCH_TARGET_TABLES = ['matches', 'match_period_scores'] as const;
export const PLAYER_MATCH_TARGET_TABLES = ['player_match_stats', 'brownlow_round_votes'] as const;

export type SettleTargetTable =
  | (typeof MATCH_TARGET_TABLES)[number]
  | (typeof PLAYER_MATCH_TARGET_TABLES)[number];

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

/** The one `issue_type` ISSUE-099 writes. Decision C names exactly this case. */
export const SETTLE_ISSUE_TYPE = 'source_disagreement';

/**
 * AFLDB-ISSUE-122 §9.2 — the SECOND, and deliberately DISTINCT, `issue_type`.
 *
 * Migration 076's dedup index is `(issue_type, issue_key) WHERE issue_key IS
 * NOT NULL AND resolved_at IS NULL` (`076:434-436`). Because the applier's
 * findings carry a different `issue_type` from ISSUE-099's disagreements, the
 * two writers can never contend for the same index entry, so
 * `AFLDB-ISSUE-104`'s hazard — a foreign writer's open row being refreshed
 * through `ON CONFLICT` — cannot arise between them. That satisfies ISSUE-104's
 * binding precondition without a migration and without editing frozen
 * migration 076. **ISSUE-104 stays open**; its general hazard is unchanged, and
 * this proof must not be allowed to lapse silently, which is why a test pins
 * the literal.
 */
export const CANONICAL_APPLY_ISSUE_TYPE = 'canonical_apply_failed';

export type SettleIssueType =
  | typeof SETTLE_ISSUE_TYPE
  | typeof CANONICAL_APPLY_ISSUE_TYPE;

/**
 * The ownership stamp on every `data_issues` row this pass writes, and the
 * only rows it may ever auto-resolve. ISSUE-090's register pass deleted
 * conflicts it did not own; this is that lesson made mechanical.
 */
export const SETTLE_ISSUE_OWNER = 'AFLDB-ISSUE-099';

/**
 * The ownership stamp on every `canonical_apply_failed` row, and the only
 * rows the applier may ever resolve. Same lesson as `SETTLE_ISSUE_OWNER`, and
 * a different owner so neither writer can close the other's finding.
 */
export const CANONICAL_APPLY_ISSUE_OWNER = 'AFLDB-ISSUE-122';

/**
 * AFLDB-ISSUE-122 S6 — fields the DERIVED layer owns, which the automatic
 * path therefore neither writes nor compares.
 *
 * `player_match_stats.career_game_no` is proposed from AFL Tables'
 * `Career.Games` (`import_fitzroy_core.py`), and it is ALSO what
 * `recomputePlayerDerivedStats()` — the targeted counterpart of
 * `rebuild_derived.py`, run at the end of every writing settle (§13) and by
 * every admin match mutation — rewrites as the row number of the player's
 * matches in AFLDB. Two writers for one column: the first S6 identical-rerun
 * proof found the recompute had renumbered the value the applier had just
 * written, so the next run saw a target that "differed" and retried the
 * write, after which the recompute would renumber it again — one canonical
 * write and one ledger row per night, forever, over identical source data
 * (SC3). AFLDB derives this number from its own canonical rows, exactly as
 * it does after an admin edit, so on the automatic path the source's copy is
 * corroboration at most, never a value to write.
 *
 * Scoped to the AUTOMATIC path only. `reconcile()` and the promotion
 * candidate it drafts still carry the full proposal, so a source-side
 * change to this field still surfaces for a human as a `corrected` candidate
 * (with nothing else to write it is simply never offered to the applier),
 * and ISSUE-099's review semantics are untouched.
 */
export const DERIVED_OWNED_FIELDS: Readonly<Partial<Record<SettleTargetTable, readonly string[]>>> = {
  player_match_stats: ['career_game_no'],
};

/** The proposal as the automatic path sees it: the derived-owned fields removed. */
export function automaticProposal(
  targetTable: SettleTargetTable, proposedValues: Readonly<Record<string, JsonValue>>,
): Readonly<Record<string, JsonValue>> {
  const owned = DERIVED_OWNED_FIELDS[targetTable];
  if (owned === undefined || owned.length === 0) return proposedValues;
  return Object.fromEntries(
    Object.entries(proposedValues).filter(([field]) => !owned.includes(field)),
  );
}

/**
 * AFLDB-ISSUE-257 Slice 4 (§18.6 item 3) — the shared scoping helper, used by BOTH
 * settles: the proposal minus the fields a human decided for this
 * `player_match_stats` target, and whether the target is a durable REMOVAL.
 *
 *   - `removed` keeps the FULL proposal (reconcile() still needs a non-empty
 *     new-target proposal) and the caller derives an EMPTY automatic proposal from
 *     the flag via `automaticProposalUnderAuthority()`: no invitation, no refusal.
 *   - A RESOLVED target loses its protected fields, so gate 8, the candidate, the
 *     invitation and the baseline see one field set. A `new_target` is never
 *     narrowed (a partial insert is not a row); the applier refuses it as a conflict.
 *   - `indeterminate`, an unresolved target, another table, or no provider: the
 *     proposal is returned UNCHANGED (same object), so gate 8 / E4 refuse it.
 */
export function scopeProposalToAuthority(
  targetTable: SettleTargetTable,
  proposedValues: Readonly<Record<string, JsonValue>>,
  target: { status: string; targetKey?: Readonly<Record<string, unknown>> } | null,
  authority: ManualAuthorityProvider | null,
): { proposal: Readonly<Record<string, JsonValue>>; removed: boolean } {
  const unchanged = { proposal: proposedValues, removed: false };
  if (
    targetTable !== 'player_match_stats' || authority === null || target === null
    || (target.status !== 'resolved' && target.status !== 'new_target')
    || target.targetKey === undefined
  ) return unchanged;
  const scope = scopePlayerMatchStatsFields(
    authority, target.targetKey, Object.keys(proposedValues),
  );
  if (scope.kind === 'removed') return { proposal: proposedValues, removed: true };
  if (scope.kind !== 'scoped' || target.status !== 'resolved' || scope.dropped.length === 0) {
    return unchanged;
  }
  return {
    proposal: Object.fromEntries(scope.keep.map((field) => [field, proposedValues[field]])),
    removed: false,
  };
}

/** The automatic path's proposal: nothing for a durable removal, else the derived-owned fields removed. */
export function automaticProposalUnderAuthority(
  targetTable: SettleTargetTable,
  scoped: { proposal: Readonly<Record<string, JsonValue>>; removed: boolean },
): Readonly<Record<string, JsonValue>> {
  return scoped.removed ? {} : automaticProposal(targetTable, scoped.proposal);
}
