<!-- DOC | Launch F stream F-D plan: Brownlow eligibility, Coleman publication, curated award follow-ups -->
<!-- DOC DISCIPLINE | Soft ceiling: 500 lines. One topic per file; structure under ## headings.
     The DOC line above feeds `phaneslight doc-index`, keep it accurate; it is this file's line in _index.md.
     If this file exceeds the ceiling: split it into a same-named folder of focused topic files;
     carry both header lines into every part; update every inbound reference in the same change set;
     finish by running `phaneslight doc-index`.
     Consumers: NEVER bulk-read documentation folders, read _index.md first, load only what you need.
     Audit: `phaneslight doc-check`. -->

# Launch F, stream F-D — Brownlow eligibility, Coleman publication into `award_winners`, curated-award follow-ups

Branch `v2/launchF-awards` (worktree `D:\dev\afldbV2-wt\awards`, from `ef3d7641`). Tier T3 (migrations
113/114, packages `@afldb/derived` + `@afldb/admin`, `src/db/queries`, `src/lib/admin`, admin UI).
Owner decisions are binding and quoted in the launch brief; this plan only sequences them.

## 0. Ground truth (read from disk)

- `award_winners` is canonical; `award_winners_source_uq UNIQUE (source_id, source_record_id)` (mig 042).
  Brownlow winners are NOT in `award_winners` (`insertAwardWinner` refuses `brownlow-medal`): the
  authoritative season totals are `brownlow_season_votes` (mig 005), with `is_ineligible`
  (NOT NULL DEFAULT false) and `is_winner`; `brownlow_season_authority` (mig 094) records whether a
  season's rows are source-published (no row) or admin-published (`published_revision`).
- The offline loader `tools/migration/import_awards.py` coleman group writes Coleman rows as:
  source `afltables`, `source_record_id = coleman:<season>:<profile path>`, `player_name_raw =
  players.display_name`, `link_status 'resolved'`, `candidate_count 0`, club per club rule,
  `club_name_raw NULL`, `votes NULL`, note `Derived from AFLDB home-and-away match statistics: N goals
  (coleman-derivation.json method_version M)`, `reload_keyed` scoped to (award, source afltables),
  then `replay_admin_overrides`.
- `publishColemanResult` (`packages/derived/src/coleman-publication.ts`) writes only the
  append-only `derived_award_results` ledger (mig 112), gate before SQL, advisory lock per season.
- Curated approval (`packages/admin/src/curated-awards.ts` `approveProposal`) promotes through
  `awardWinnerPromotionPort` -> `insertAwardWinner` on the same postgres.js transaction.
  `award_proposal_decisions_transition_ck` mirrors `CURATED_AWARD_TRANSITIONS`; `approved`,
  `rejected`, `superseded` terminal; `award_proposals_approval_ck` ties `approved` <=> key present.
- Capabilities: `data.awards.edit` and `data.brownlow.finalise` are SUPER_ADMIN_ONLY;
  `data.awards.read`, `data.brownlow.read` Admin and up.
- Isolated PostgreSQL 16.14 at 127.0.0.1:55432 is up; the template is migrated through 112 but holds
  NO reference rows (e.g. no `sources`), so the existing `admin-awards`/`admin-brownlow` integration
  suites fail on it at their own seed precondition. New integration tests seed what they need.

## 1. Brownlow eligibility (owner model) — stream A

1.1 **Authoritative eligibility evidence (definition, ADR 0014).** Per (season, player), in precedence:
  (1) the CURRENT administrator decision in the new `brownlow_eligibility_decisions` table (newest
  authoritative evidence, superseding chain); else (2) the season's `brownlow_season_votes` row
  (`is_ineligible = true` => ineligible, `false` => eligible) — the authoritative published totals
  (source-published, or admin-published per `brownlow_season_authority`). The AFL API staged flag
  (`staging.afl_api_brownlow_vote.eligible`) is a provider PROPOSAL, never authoritative: it can
  make a player's status `ambiguous` (it disagrees with (2), or its own flags disagree) but never
  decides one. No (1) and no (2) => `missing`.
1.2 **Pure determination** `packages/derived/src/brownlow-eligibility.ts`:
  `determineBrownlowMedal({ report, evidence })` over the existing reconciliation report (raw totals
  + gating) and per-player evidence. Raw leaderboard preserved for every vote-getter with its
  eligibility status and source. Gating passes through `refused_whole_set`, `season_incomplete`,
  `no_vote_evidence`, and `refused_unreconciled_evidence` (any `discrepancy` finding other than
  `eligibility_flag_inconsistent`, which becomes per-player ambiguity). Then walk distinct totals
  descending: if any player in the current group is `missing`/`ambiguous` => `requires_review`
  (names them, no winner); drop known-ineligible; >=1 eligible => `determined` (all of them: joint
  winners, `tie`); all ineligible => next group; exhausted => `no_eligible_winner`. Deterministic,
  pure, no clock; a checksum over the canonical input. Raw votes are input only, never mutated.
1.3 **Migration 113** `brownlow_eligibility_decisions` (append-only; ADR 0004): id identity,
  season, `player_identity` (durable `afltables:`/`manual_admin_edit:` string, never an id),
  `player_id_at_decision` (snapshot, no FK), verdict `eligible|ineligible`, `citation` (required,
  1..2000, URL or source reference), `note` (required, 20..2000 trimmed), `decided_by` FK
  auth_users, `decided_at` default now(), `basis` `open_season|audited_correction`, `correction`
  jsonb (required iff audited; workflow `brownlow_eligibility_decision` (per section 5 F-006), actor = decided_by, season matches),
  `supersedes_id` chain exactly as mig 112 (root partial unique per (season, identity), one successor,
  composite FK, `supersedes_id < id`). No FK into players/seasons. Grants: `afldb_import` SELECT,
  INSERT + sequence; `afldb_auth` SELECT; `afldb_app` none; mirrored in
  `tools/maintenance/privileges.sql`; `tests/integration/privileges.test.ts` extended; classified in
  `tools/db/promotion-inventory.ts` like 111/112 (`reinstate`).
1.4 **Server service + callers** (server-only, new `src/db/queries/brownlow-eligibility.ts` +
  callers in `src/lib/admin/operations-centre.ts`): load evidence (decisions, stored rows, staged
  flags, durable identities of every vote-getter); `recordBrownlowEligibilityDecision` — capability
  `data.brownlow.finalise` checked first; refuses unknown player, identity-less player, a player who
  polled no votes in the season, missing citation/note, stale `expectedCurrentDecisionId`; sealed
  season => `evaluateSeasonWrite` with workflow `brownlow_eligibility_decision` (section 5 F-006), note 20..2000, evidence
  `brownlow_eligibility:<season>:<identity>`; one transaction with a per-season advisory lock; returns
  the recomputed determination; one `auth_audit_log` activity row (existing pattern).
  Never writes `brownlow_season_votes` (raw votes and published flags untouched); the page shows when
  the stored `is_winner` flags disagree with the determination (projection into the published table
  stays the existing `/admin/brownlow` publish workflow; recorded as remaining work).
1.5 **UI** `/admin/operations/brownlow`: determination section (status, winners/joint, requires-review
  list, raw leaderboard with eligibility + source) and a decision form (super admin) with an action
  card stating effects; permission-denied, empty, success and error states.

## 2. Coleman publication into `award_winners` — stream B1

2.1 **Projection port**, injected into `publishColemanResult(executor, request, { projection })`
  and run INSIDE the publisher's transaction after the ledger step (also when the ledger outcome is
  `unchanged`). Production port `src/db/queries/coleman-award-winners.ts` (server-only, uses the
  native postgres.js transaction like `awardWinnerPromotionPort`). The operations centre always
  passes it (unit test pins this). Without a port the Stage 4 ledger-only behaviour is kept for the
  existing PGlite tests.
2.2 **Algorithm (idempotency key = `(source afltables, source_record_id coleman:<season>:<path>)`,
  the loader's own key, backed by `award_winners_source_uq`).** Refuse when the `coleman` award or the
  contract's source row is missing. For each derived winner key: active row equal on
  (player_id, player_name_raw = canonical `players.display_name`, club_id) => `retained`; active row
  different => `updated` (refused `admin_override_present` when a `data_overrides` row exists for its
  entity key); void row => refuse `derived_row_voided`; none => `inserted` in the loader's exact
  column format. For each active Coleman row of the season NOT derived: an `afltables`
  `coleman:<season>:` row => `voided` (same override refusal); any other owner (manual_admin_edit,
  legacy draftguru) => refuse `foreign_winner_rows`. Every inserted/updated/voided row gets a
  `data_edits` row (table `award_winners`) carrying the provenance; `recomputeAwardSpan` on change.
  Joint winners = several keys. Finals never enter (derivation input is home-and-away only; finals
  rows counted and excluded). Incomplete/unsettled seasons are refused by the existing gate before SQL.
2.3 **Provenance, migration 114** `derived_award_projections` (append-only): id, `derived_award_result_id`
  FK -> `derived_award_results`, award_slug, season, `projected_by`, `projected_at`, `actions` jsonb
  (`[{entityKey, action, awardWinnerId}]`), `changed_count`, `correction` jsonb. A row is written
  for the first projection of a result and for any projection that changes a row; a rerun that
  changes nothing and finds a projection for the same result writes nothing. Grants as 1.3.
2.4 **Sealed seasons**: every Coleman write is already an audited correction through the seal
  (workflow `derived_award_publication`, 20..2000 note, settled attestation). Derived winners equal to
  stored rows => provenance only, no `award_winners` change.
2.5 **Revalidation**: the projection returns the public paths (`awardWinnerPaths`, exported unchanged
  from `admin-awards.ts`) for changed rows; the operations-centre Coleman form posts them to
  `/admin/awards/revalidate` after success, exactly as `src/app/admin/awards/submit-helper.ts` does.
2.6 **UI** `/admin/operations/coleman`: the publish card states the `award_winners` effect (insert /
  update / void / unchanged counts from a read-only preview), plus states.

## 3. Curated-award follow-ups — stream B2

3.1 **V2-GAP-019 four-eyes** in `approveProposal`: creator != approver, except `super_admin` with
  `selfApprovalAttestation` (trimmed >= 20 chars); recorded in the approve ledger row
  (`new_values.selfApproval = true`, attestation text). Typed refusals `self_approval_forbidden` /
  `self_approval_attestation_required`. Tests both paths (unit + PGlite + PG).
3.2 **V2-GAP-018 approved revision**: `reviseApprovedProposal` — one transaction: lock, validate new
  values, seal (`curated_award_approval`, note 20..2000), then call tx-level variants extracted from
  `replaceAwardWinner` (identity fields change) or `correctAwardWinner` (non-identity only), behaviour
  of the existing exported functions unchanged; old revision `approved -> superseded`
  (`supersede_approved`), new revision `(none) -> approved` (`revise_approved`) with the new entity key;
  both ledger rows in the same transaction. Migration 114 widens (DROP/ADD, superset only, the mig 094
  precedent) `award_proposal_decisions_action_ck`/`_transition_ck` and `award_proposals_approval_ck`
  (a superseded former approval keeps its key); TS state machine and the triple test updated in step.
3.3 **V2-GAP-024**: the promotion port returns the paths for the created row (`awardWinnerPaths`);
  `approveProposal`/`approveCurated` return them; the approval form posts them to
  `/admin/awards/revalidate` after success (same for 3.2).
3.4 **V2-GAP-020**: keep the refusal; add a PG test proving an identity-less winner cannot be approved;
  document "link identity first" in ADR 0008 and `admin-operations.md`.
3.5 **V2-GAP-023**: not feasible from committed evidence (committed AFL API fixtures carry synthetic
  ids; no committed provider-team mapping) — documented with the exact remaining work; no code.

## 4. Sequencing, ownership, verification

- Streams A, B1, B2 run as parallel workers in the one worktree; file ownership: A owns migration 113,
  `brownlow-eligibility.*`, Brownlow views; B1 owns migration 114 section 1 (projections), Coleman
  files and views; B2 owns migration 114 section 2 (curated widening), `packages/admin/**`,
  `award-proposals.ts`, awards views. Shared files (`operations-centre.ts`, `privileges.sql`,
  `privileges.test.ts`, `packages/derived/src/index.ts`, `admin-awards.ts` exports) are edited in
  disjoint regions only. Each stream has its own isolated DB `afldb_v2_aw_<a|b1|b2>_test`.
- Deploy order recorded: apply 113/114, then `npm run db:privileges`, then code (AFLDB-ISSUE-027).
- Per stream: focused unit tests, PGlite tests kept green, isolated-PG integration tests (seeded,
  self-contained) proving every owner property; `tsc --noEmit --incremental false`; eslint on touched
  files; `tests/v2-module-boundaries.test.ts`. The orchestrator reviews the diff and commits per stream.
- Docs: ADR 0014 (eligibility), ADR 0015 (Coleman publication), updates to 0006-0009,
  `admin-operations.md`, `db-ownership-matrix.md`. Shared ledgers untouched.
- Close: `afldb-closure` on the branch.

## 5. Plan-review resolutions (review: `launchF-FD-awards-plan-review.md`, PROCEED_WITH_AMENDMENTS)

The launch brief instructs the orchestrator to resolve CRIT/HIGH within the owner decisions and continue.

- **F-001 HIGH, accepted (supersedes §1.1 rule 2).** `brownlow_season_votes` is authoritative only where
  it carries a RECORDED statement: `is_ineligible = true` => ineligible; `is_ineligible = false` =>
  eligible only when the season is admin-published (`brownlow_season_authority.published_revision IS NOT
  NULL`) or the row carries `eligible_rank IS NOT NULL`; otherwise `missing`. The determination reads raw
  evidence (decisions, stored rows, staged flags), never `report.rawVotes.totals[].eligible`. The SQL
  blast-radius count needs a historical database (the isolated template holds none); recorded for the
  main session's rebuilt-database run.
- **F-002 accepted.** `retained` = equality on the full loader column tuple; else `updated`.
- **F-003 accepted.** Unit test pins the projection note to the `import_awards.py` literal; the loader
  parity run is attempted on the isolated DB if the Python environment allows, else recorded open.
- **F-004 accepted.** Single writer per file: the orchestrator writes migrations 113 and 114 in full, the
  `privileges.sql` blocks, `privileges.test.ts`, `promotion-inventory.ts` and its pins,
  `reference-data.test.ts`, `v2-season-seal.test.ts`, `historical-baseline.md` §2, the PGlite harness
  migration lists, and the `admin-awards.ts` exports, BEFORE dispatch. Streams own disjoint files;
  `operations-centre.ts` is edited only inside each stream's own functions/sections.
- **F-005 accepted** (items 1-6, 8). Item 7 (`CHANGELOG.md`) is a shared ledger the brief forbids; the
  return proposes the entries for the main session.
- **F-006 accepted.** New audited workflow `brownlow_eligibility_decision` (appended to
  `AUDITED_CORRECTION_WORKFLOWS`, its own §2 row), pinned by migration 113's CHECK.
- **F-007/F-008/F-010/F-011 accepted** into the worker briefs (explicit `role === 'super_admin'`; creator
  = `created_by` of the revision approved; `approved` insert variant; widened approval CHECK allows the key
  only for `approved|superseded`; revise locks the canonical row by `approved_entity_key` in-transaction;
  V2-GAP-020 test drives approval and asserts `stale_validation`; named test lists).

## 6. Closure ratifications (orchestrator)

- Closure F-003 ratified: a `stored_rank_inconsistent` finding on `eligible_rank` whose stored value is NULL is the
  "not recorded" gap of F-001 (per-player `missing`, so `requires_review` when decisive), not a whole-season
  refusal; a present-but-wrong rank still refuses. It cannot invent a winner. Pinned in ADR 0014 and tests.
- Closure F-002 (approved revisions are self-applied by one super admin with a 20+ character note, recorded as
  `selfApproval: true`) is reported to the owner for confirmation; not changed.
- Stream B1 measured that the loader reports `updated` = rows matched; the parity criterion is "0 inserted,
  0 deleted, values unchanged" (ADR 0015), correcting section 5 F-003 wording.
