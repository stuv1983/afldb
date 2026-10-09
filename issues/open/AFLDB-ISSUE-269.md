# AFLDB-ISSUE-269 — `replay_admin_overrides('matches')` applies only one of a match's active override rows

## 0. Status

- **Status:** Open (2026-10-08). **Implemented 2026-10-09 together with AFLDB-ISSUE-267 (worktree
  `D:\dev\afldb-issue-267-269`, branch `sonnet/issue-267-269`, base `259ee7c6`). Implementation validated on
  `afldb_test` 2026-10-09 (shared second-pass run, 6/6 passed, operator-run, §17.6).** **DEV exposure census complete
  2026-10-09** (operator-run, before deployment: 0 active `matches` overrides, section 2 empty, no replay blockers;
  §17.7). **Committed as `86e2d19fa6936f73872da45c7b5cb3200e274543`, merged to `main` and pushed; deployed to DEV
  2026-10-09** (operator-confirmed; §17.8). The deployment did not exercise the Python matches replay. **PROD exposure
  census complete 2026-10-09** (operator-run; `afldb_prod` as `postgres`, read-only: 0 active `matches` overrides,
  section 2 empty, no replay blockers; §17.9). `merge:ready -- --issue 267` reported READY twice (§17.9). The census
  does not show that the fix is installed on PROD; the applicable PROD deployment acceptance is outstanding, and the
  issue stays open until it passes.
  Historical corruption is not established; historical impact remains unassessed, and nothing was repaired. See §17.
- **Severity:** Medium. **Area:** data integrity / admin override replay (rebuild, reload, promotion).
- **Key file:** `tools/migration/common.py` (`replay_admin_overrides`, matches branch).
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-004; partition note R3-F01). The orchestrator re-read the cited lines and confirmed them.
- **Classification:** code-proven.
- **Provenance of this file.** §0–§16 were written by the 2026-10-08 review and were uncommitted in the review worktree
  (`D:\dev\afldb-review-20261008`). They were brought into this branch unchanged except for this §0 status, as
  AFLDB-ISSUE-266 was. Line numbers in §2–§9 refer to `20a7a4bb`.

## 1. Summary

The Data Editor keeps one `data_overrides` row per `(entity_type, entity_key, field_group)`. A match corrected in two groups (for example `attendance` and `score`) therefore has two active rows. The `matches` replay applies them with a single `UPDATE matches m … FROM data_overrides o WHERE … o.entity_key = m.match_key`. PostgreSQL uses only one joined row per target row, and which one is unspecified, so the other human decisions are silently not re-applied.

## 2. Evidence

- `tools/migration/common.py:1866-1888`: a single `UPDATE … FROM data_overrides` with no per-key aggregation.
- `common.py:1720-1757`: the `players` branch already merges a player's rows with `jsonb_each` + `DISTINCT ON`. Its own comment explains that UPDATE…FROM "chose ONE arbitrarily … silently lost all but one".
- `src/db/queries/data-edits.ts:240-257`: one upsert per field group. The UNIQUE key is `(entity_type, entity_key, field_group)`.

## 3. Trigger

1. A match carries two or more active `matches` overrides in different field groups.
2. Then a `matches` reload (`import_fitzroy_core.py:3618`), a rebuild, or the post-swap promotion replay (`docs/production-promotion.md:70`, `:1366-1372`) runs.

## 4. Expected invariant

Every active override row for a match is re-applied, as the `players` branch does.

## 5. Actual behaviour

Only one group's values are applied, and which group is unspecified. If the chosen row is `attendance`, the score fields stay at source while the period-score CTE (which joins the `score` row explicitly) writes the overridden totals into `match_period_scores`. The match total and its final-period row then disagree; see also AFLDB-ISSUE-267.

## 6. First wrong layer

`tools/migration/common.py:1866-1888`.

## 7. Impact

- Human corrections to `matches` are silently lost on rebuild, reload and promotion.
- Derived club-season ladders are then rebuilt from the wrong score.
- The pre-swap predictor `planPromotionMatchReplay` (`tools/db/promotion-inventory.ts:4435-4462`) checks key resolution only, so nothing stops this before the PROD swap.

## 8. Reproduction / witness

Not executed. The behaviour is PostgreSQL `UPDATE … FROM` semantics. Decided by the integration case in §14.

## 9. Disproof attempts

- The matches branch has no per-group loop or merge CTE.
- The second UPDATE (`:1890-1909`) only recomputes derived fields from `m.*`.
- `promotion-check.ts` (`planPromotionMatchReplay`) counts key resolution, not multi-row application.

## 10. Existing-issue search

- `issues.md` was searched for `replay_admin_overrides(matches)`, `arbitrar`, `UPDATE ... FROM` and `multiple active override`. The only hits are ISSUE-224's players fix and ISSUE-162's fixtures call-site note.
- Classification: **new**. The players-branch fix (ISSUE-224) was not applied to `matches`.

## 11. Scope

The matches branch of `replay_admin_overrides`.

## 12. Out of scope

Period-score payload handling (AFLDB-ISSUE-267), and the `match_coaches` branch.

## 13. Proposed fix boundary

- Aggregate the match's active rows into one jsonb per `match_key` (`jsonb_object_agg` over `jsonb_each`) before the single UPDATE.
- Apply the same equal-authority disagreement refusal the players branch raises.
- The period-score CTE then reads the merged object.
- Python only.

## 14. Proposed validation

1. Integration (afldb_test, operator-run), in `tests/integration/data-editor.test.ts`: save `attendance` and `score` on one match, run the real replay, and assert both survive.
2. Optionally extend the A4.3 predictor to STOP on more than one active row per key until the fix lands.

## 15. Decisions / unresolved questions

- Whether any current DEV or PROD match carries more than one active `matches` override. Read-only census: `SELECT entity_key, count(*) FROM data_overrides WHERE entity_type='matches' AND is_active GROUP BY 1 HAVING count(*) > 1`.

## 16. Next action

Fix together with AFLDB-ISSUE-267 in one Python change, then the integration case. Run the census before the next promotion.

## 17. Implementation (2026-10-09, with AFLDB-ISSUE-267; uncommitted, not database-validated)

The shared change, tests, checks and operator commands are recorded in full in `issues/open/AFLDB-ISSUE-267.md` §17.
This section records what is specific to ISSUE-269.

### 17.1 Merge and refusal

- Before the UPDATE, a `merged_overrides` CTE folds every **active** `matches` row whose key resolves to a match into
  ONE object per `match_key`: `jsonb_each` per row, `DISTINCT ON (entity_key, key) … ORDER BY entity_key, key,
  field_group`, then `jsonb_object_agg`. The UPDATE joins that CTE, so each match has exactly one FROM row and every
  group is applied.
- **Authority.** Every matches row is keyed by `match_key` alone, so all rows have equal authority (the players
  branch's `authority_rank` has no matches counterpart). Following that branch's contract, a field given different
  values by two active rows of one match is **refused** before any write:
  `replay_admin_overrides(matches): refusing to commit, N field(s) are claimed by equal-authority overrides that
  disagree: match <key> field '<f>' -- <group>=<value>, …`. Identical values merge. The `field_group` ordering only
  chooses between identical values, so it never settles a disagreement.
- Derived fields (`home_score`, `away_score`, `margin`, `result`, `winner_club_id`) are recomputed afterwards from the
  merged row, and the final-period rows are written from the updated row (ISSUE-267), so the match total and its
  final-period row can no longer disagree.
- §13's "the period-score CTE then reads the merged object" was not taken literally: it reads the updated `matches`
  row instead, because a merged object can still be partial (ISSUE-267).
- §14.2's optional predictor STOP was not implemented (promotion prediction is out of scope for this change).

### 17.2 Validation specific to 269

Three of the six integration cases (ISSUE-267 §17.3):

- **attendance + partial score**: both groups survive the replay, including attendance status/source, the derived
  totals and result flip (`away_win`), and both final-period rows. The original `UPDATE … FROM` applies only one of the
  two rows, so the case fails whichever it picks.
- **equal-authority conflict**: refused; the same-transaction snapshot after the refusal equals the one before.
- **component from another group** (added in the 2026-10-09 review-fix pass): the source lacks `home_behinds`, the
  `score` row supplies `home_goals`, another active group supplies `home_behinds`; the merged replay succeeds, and
  census section 4 (now the same merged `COALESCE` evaluation as the Python preflight) does not list the match.
- Plus **identical overlap / inactive excluded**, and idempotence on every successful case.

Checks actually run: Python syntax, `tsc --noEmit` (exit 0) and the source-contract suite (69/69) (ISSUE-267 §17.4).
Nothing database-backed has run.

### 17.3 Operator validation and census

The commands are ISSUE-267 §17.5 (one integration run covers both issues). Census section 2 answers §15 (keys with
more than one active row; exposure, not proof that a past replay dropped a group). Section 3 lists any disagreement
the fixed replay would refuse; such a row stops a reload, rebuild or post-swap promotion replay until the operator
deactivates or corrects one of the rows.

### 17.4 Remaining before resolution

As ISSUE-267 §17.6: ~~residue recovery (ISSUE-267 §17.9.4), a green integration run on `afldb_test` (6/6)~~ (done
2026-10-09, §17.6 below), ~~operator commit and merge~~ (done 2026-10-09, `86e2d19f`, with the DEV deployment;
§17.8), ~~the census on DEV~~ (done 2026-10-09, §17.7: no rows), ~~the census on PROD before the next promotion, with
any section-3 or section-4 row resolved first~~ (done 2026-10-09, §17.9: no rows), and the applicable PROD deployment
acceptance (ISSUE-267 §17.15). Which group a past replay dropped, if any, is
not recoverable from the census alone.

### 17.5 Operator integration run FAILED (2026-10-09); second fix pass

The shared six-case run on `afldb_test` failed: **6 failed, 37 filtered/skipped** (ISSUE-267 §17.9.1). Reported
causes: replay `matches_score_components_ck` violations (SQLSTATE 23514) because the merged components and the derived
totals were written by two UPDATEs, and fixture-cleanup `club_seasons_season_fkey` failures. Nothing passed, so the
merge is neither shown wrong nor validated. The second fix pass (ISSUE-267 §17.9.2) writes the merged components and
everything derived from them in ONE UPDATE; the merge CTE, both preflights and the final-period sync are unchanged.
The 269-specific cases (attendance + partial score, conflict, overlap, component from another group) stay pending.
Uncommitted; not database-validated. (Superseded by §17.6.)

### 17.6 Second integration run PASSED on `afldb_test` (2026-10-09, operator-run)

Full record: ISSUE-267 §17.10. Operator-reported; nothing here was run by Claude.

- **Residue.** The recovery dry run passed and rolled back; the commit attempt refused before any DELETE because the
  two expected `club_seasons` rows were already absent. The fixture namespace was confirmed empty by a fresh read-only
  census (every foreign count 0, `club_seasons_total = 1624`). What removed the earlier residue is unknown. The
  reported dry run rolled back and the reported commit attempt refused before DELETE; neither establishes what
  happened between them.
- **Run.** Target verified as `afldb_test`, role `afldb_owner`; 9 October 2026, 10:47:03;
  `-t "AFLDB-ISSUE-267/269"`: **6 passed, 37 filtered skips, no suite or hook failures, 33.80 s.** The residue and
  historical-baseline assertions passed. Prior checks stand: Python syntax, `tsc` (exit 0), source-contract 69/69.
- **For ISSUE-269 specifically**, the passing cases include the attendance + partial score merge, the equal-authority
  conflict refused before any write, components merged across groups (with census section 4 agreeing with the
  replay preflight), and idempotence on the successful cases.
- **Not established:** DEV/PROD exposure (census section 2 not run; superseded for DEV by §17.7), and whether any past
  replay dropped a group.
  Historical corruption is not established; historical impact remains unassessed. No historical data was read or
  repaired.
- **Remaining:** as ISSUE-267 §17.10.4 (commit, `merge:ready`, merge/push, DEV deploy, DEV census, PROD census before
  the next promotion, resolve any section-3/4 row first; then resolution). The DEV census has since run (§17.7).

### 17.7 DEV exposure census (2026-10-09, operator-run, before the fix was deployed)

Full record: ISSUE-267 §17.11. Operator-reported; nothing here was run by Claude. No implementation, test or SQL file
changed.

- **Target:** exact database `afldb_dev`, role `afldb_import`, `transaction_read_only = on`; ran through `== Done.`
  with no command failure. Run before `deploy/sync-dev.ps1`; the census reads data only.
- **Result:** active `matches` overrides **0**; section 1 partial `score` overrides 0 (resolving 0); **section 2
  (ISSUE-269 exposure) no rows**; sections 3–5 no rows. **No current replay blockers** (sections 3 and 4).
- **What it shows:** on 9 October 2026 no DEV match carried more than one active `matches` override, and nothing on
  DEV would make the fixed replay refuse.
- **What it does not show:** with no active `matches` overrides, the empty symptom section (5) does not assess
  historical corruption, and which group, if any, a past DEV replay dropped is not recoverable from it. Historical
  impact remains unassessed; nothing was repaired.
- **DEV exposure census: complete.** Remaining: operator review and commit, `merge:ready`, merge/push, the DEV
  deployment, the PROD census before the next promotion; then resolution. (Commit, merge/push and the DEV deployment
  have since completed; §17.8.)

### 17.8 Commit, merge and DEV deployment (2026-10-09, operator-confirmed)

Full record: ISSUE-267 §17.12. Operator-confirmed; nothing here was run by Claude. No implementation, test or SQL file
changed.

- **Commit, `main` merge and push: complete.** Revision `86e2d19fa6936f73872da45c7b5cb3200e274543`.
- **DEV deployment: complete.** Deployed revision `86e2d19fa6936f73872da45c7b5cb3200e274543`;
  `tools/migration/common.py` has no working-tree difference from HEAD; migrations 110/110 applied, nothing to apply;
  build succeeded (`BUILD_ID` `Jlf_U7HZnqispmedF-TaS`); systemd respawn 844885 → 849656, active since 11:40:00 AEDT;
  readiness passed after 2 seconds; follow-up health `status` ok, `database` ok, `latencyMs` 28.
- **What it does not show:** the deployment did not exercise the Python matches replay, so the merge has not run on
  `afldb_dev`; its database validation remains the `afldb_test` run (§17.6). PROD has not been censused (section 2
  unmeasured on PROD). Historical corruption is not established; historical impact remains unassessed; nothing was
  repaired.
- **Remaining (issue stays open):** ~~the shared PROD census before the next promotion, resolving any section-3/4 row
  first~~ (done 2026-10-09, §17.9); the applicable PROD deployment acceptance; then resolution.

### 17.9 PROD exposure census and `merge:ready` (2026-10-09, operator-run)

Full record: ISSUE-267 §17.13 (census), §17.14 (`merge:ready`) and §17.15 (PROD deployment route and blockers).
Operator-reported; nothing here was run by Claude, and Claude contacted no host or database. No implementation, test
or SQL file changed.

- **Census target:** host `afldb-prod` through the SSH alias `afldb`; exact database `afldb_prod`, role `postgres`,
  `transaction_read_only = on`; ran through `== Done.`, `psql exit status: 0`.
- **Census result:** active `matches` overrides **0**; section 1 partial `score` overrides 0 (resolving 0); **section 2
  (ISSUE-269 exposure) no rows**; sections 3–5 no rows. **No current replay blockers** (sections 3 and 4).
- **What it shows:** on 9 October 2026 no PROD match carried more than one active `matches` override, and nothing on
  PROD would make the fixed replay refuse.
- **What it does not show:** section 5 checked no score-overridden match (PROD has none), so historical corruption is
  not assessed, and which group, if any, a past PROD replay dropped is not recoverable from it. Historical impact
  remains unassessed; no repair was performed. Census completion does **not** establish that the fix is installed on
  PROD.
- **`merge:ready -- --issue 267`:** READY twice, the second run after a fresh fetch; 0 blockers, 2 metadata warnings:
  (1) no `afldb-merge-readiness` JSON block in the ISSUE-267 runbook; (2) no automated unexpected-file classification
  metadata. The ten-file list was checked separately by the operator; both gates returned READY.
- **PROD installation: deferred** (ISSUE-267 §17.15). PROD stays at `cd3cf782` until ISSUE-265's observation ends. The
  measured release `cd3cf782..86e2d19f` (assistant read-only review of GitHub's comparison, transcribed from the
  supplied review; not operator-run Git evidence) is 9 commits and 40 files, with no migration, package manifest/lockfile,
  `deploy/` or `next.config.ts` change; it includes ISSUE-261, which changes the settle/retry code, so deploying the
  full range would change the code under observation. No executable PROD procedure is recorded: one is to be prepared
  and reviewed after the hold lifts, and the ISSUE-265 r6 pack must not be reused.
- **Remaining (issue stays open):** the applicable PROD deployment acceptance (ISSUE-267 §17.15), after the hold; then
  resolution.
