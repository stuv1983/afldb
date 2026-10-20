# Brownlow eligibility runtime implementation (BP-2025-ELIGIBILITY-v1)

Date: 2026-10-20. Policy: [D-V2-BROWNLOW-ELIGIBILITY-1](brownlow-policy-decisions-2026-10-20.md), §4a of the
[ruling record](brownlow-eligibility-ruling-2026-10-20.md). Tracking: V2-GAP-016.

This record separates three things that must not be confused:

1. **Implemented policy** — what the code now does (committed locally, unpushed).
2. **Isolated verification** — what was proved on disposable copies in the existing marked Linux cluster.
3. **Pending production rollout** — everything that still needs a separate authority. Nothing here touched
   production or any shared database, and no correction, backup, deployment, timer change or push occurred.

## 1. Implemented policy

Eligibility is **eligible / ineligible / unknown**, represented distinctly end to end. (The ADR 0014 statuses
`missing` and `ambiguous` are the policy's *unknown*; `brownlowEligibilityState()` maps them.)

Precedence, in `evaluateBrownlowEligibility` (`packages/derived/src/brownlow-eligibility.ts`):

1. A **current audited decision** decides, in either direction, over any provider value.
2. Provider evidence that is **conflicting** (true and false), **incomplete** (some records unusable), or that
   **disagrees with a recorded stored statement**, or that the reconciliation reports as internally inconsistent,
   is **unknown (ambiguous)** and stays unresolved until a decision resolves it.
3. A **recorded stored statement** (an ineligible flag, or an eligible rank that is the administrator's/legacy
   recorded statement) stands where the provider is silent or agrees.
4. Otherwise a **consistent explicit provider boolean** from the identified AFL API snapshot decides, with source
   `provider_snapshot` and its provenance retained (families, observation count, `version_seq`s, import batch ids).
   It is shown as provider evidence, not a tribunal finding.
5. Otherwise **unknown (missing)**. An unevaluated stored default (`is_ineligible = false`, no eligible rank) never
   establishes eligibility, and in a season that has provider evidence a stored eligible rank alone does not either
   for a player the provider has no usable value for.

Winner and ranking: raw vote totals are always kept; joint eligible winners are preserved; **no winner is stated
when an unknown player could change it**; an unknown player only below the winner leaves the winner determined
but the lower eligible ranks are **not stated** (`rankingDeterminate = false`, `eligibleRank = null`,
`eligibleRankDeterminate = false`) because an unknown could occupy a place above them. `stored_eligible_rank_one`
is not selected anywhere and cannot bypass unknown eligibility; 2026 stays excluded.

Legacy `eligible === true` conversion, every consumer:

| Stage | Before | Now |
|---|---|---|
| Emitters (`afl-api-bundle.ts`: round votes, leaderboard) | `eligible === true` → `false` for null/absent/non-boolean | explicit boolean, else `null` (unknown). An absent key is already refused by the source-family required-column gate |
| Staging `staging.afl_api_brownlow_vote.eligible` | `boolean NOT NULL` | nullable (**migration 117**); NULL = unknown, never false |
| Python season-artefact builder | `eligible is True` | explicit boolean or `None`; a tallied player with unknown eligibility **refuses** the build |
| Reconciliation (`packages/derived`) | booleans folded to false | `boolean \| null`; new finding `eligibility_provider_unknown`; unknown is never folded into ineligible and is never a `stored_eligible_rank_one` leader; any unknown vote-getter refuses a leader as unreconciled evidence |
| Eligibility loader/determination | provider flag "proposal only" | per-player flags + unknown counts + provenance; leaderboard flags folded in as the second record of the same snapshot |
| Publication (`publishBrownlowEligibilityInTransaction`) | wrote `(is_ineligible=false, eligible_rank NULL)` for unknowns and counted them as eligible in others' ranks | writes ranks/ineligible flags only when every vote-getter is known; otherwise **`partial`** (only `is_winner` follows the determination, so a stale default winner is cleared) or **`withheld`** (nothing to change). `onUnresolved: 'refuse'` / `publicationMode: 'require'` throw `BrownlowPublicationRefusedError` so the caller's transaction (including the decision insert) rolls back. The audit records the evidence and provenance behind each published value |
| Operations view | unknown looked like a bare default | unknown is worded "unknown (not recorded)" / "unknown (ambiguous)"; a visible notice lists unresolved players and states that stored flags/ranks are left unchanged; an "Eligible rank" column shows "not stated" where it cannot be stated; "no review needed" appears only when nothing is unresolved |

Sealed/historical facts are preserved: the policy never rewrites raw votes, staged rows or sealed publications, and
a historical season without modern provider evidence keeps its stored statement (administrator-published seasons
keep it even where the provider value is unusable). The guarded production CLI `observe` path **still refuses**
missing/null/non-boolean provider values (stricter than the emitters, deliberately).

## 2. New migration: `117_brownlow_provider_eligibility_unknown.sql`

Exact delta: `ALTER TABLE staging.afl_api_brownlow_vote ALTER COLUMN eligible DROP NOT NULL;` plus a column
`COMMENT`. No rows, defaults, indexes, constraints, grants or other objects change. Migration 116 is untouched.

- **Idempotent**: dropping an absent NOT NULL is a no-op; the normal runner re-run reports "Nothing to apply".
- **Rollback**: re-adding NOT NULL is valid only while no row is NULL; never convert NULL to false (the file says so).
- **Review requirement**: it is a schema change and needs its own schema approval and pre-install backup/restore;
  it is **not** covered by D-V2-BROWNLOW-ELIGIBILITY-1 or the 110–115 archive-scoped acceptance.

## 3. Isolated verification (disposable copies only)

Environment: WSL `AFLDB-V2-Rehearsal-20261020`, PostgreSQL 16 cluster `afldb_v2_isolated` (127.0.0.1:55434, own
network namespace), launcher `tools/v2/isolated-pg.ts`, source copy of the working tree. Databases were fresh clones
of the marked 2025 template (`afldb_v2_rb_brownlow2025_test`, schema 115); no older evidence database was reused.

| Check | Result |
|---|---|
| Migrations 116 then 117 from 115 through the normal runner (`afldb_v2_tristate_it_test`) | applied (12 ms, 2 ms); privileges reconcile OK; re-run: "Nothing to apply" |
| Migration 117 effect | `is_nullable` NO → YES; 621 staged vote rows, fingerprint `48fc8ff0…` identical before/after; 597 true / 24 false / 0 null before and after; 16,120 season-vote rows and fingerprint identical; receipts table present and untouched |
| `tests/integration/v2-brownlow-eligibility.test.ts` (existing 35 cases + 10 new BP-2025 cases) | **45/45** |
| New cases cover | explicit true (provenance + audit evidence); explicit false (runner-up wins, votes kept); NULL leader (no winner, no ranks, stale default winner cleared, eligibility never rewritten); NULL below the winner (winner determined, ranks unstated); publication refusal rolls back; a decision in `require` mode rolls back with the refused publication (ledger and stored rows unchanged); audited decision resolves an unknown, then a superseding decision flips it; decision precedence over explicit provider evidence; joint winners with an unknown player below; raw-vote fingerprint unchanged throughout |
| `tests/integration/v2-brownlow-production-correction.test.ts` on a fresh clone with 116+117 (`afldb_v2_tristate_corr_test`; labelled copy of the test with the clone name) | **8/8** — including the authentic 2025 observe-only snapshot (207 sets) and the audited eligibility subset |
| Twelve approved rulings on the authentic 2025 snapshot (`tests/integration/v2-brownlow-eligibility-2025-rehearsal.test.ts`, clone `afldb_v2_brownlow_tristate_twelve_test`, **labelled isolated copy, synthetic approval**) | **3/3** — before: 188 players, 0 unknown, exactly the twelve provider-ineligible players unresolved (provider says ineligible, unevaluated stored rows say eligible), winner determined (none of the twelve is the leader), ranking not determinate; apply all twelve atomically through the guarded runner and replay; after: ranking determinate, no unresolved players, same winner, twelve `admin_decision` ineligible verdicts, twelve stored `is_ineligible`, stored/determined winners agree, raw votes byte-identical |
| Unit suites (12 files, 902 tests: eligibility 65, reconciliation 59, afl-api-match, admin-operations, admin-operations-ui, shadow award reports/parity, reference-data, production-correction, backfill, adoption, module boundaries) | all pass after the final fix; 9 migration-reading suites (965 tests) pass; Python artefact contract passes |
| Operations view | static-markup tests prove: unknown wording, never "ineligible"; indeterminate-ranking notice; "not stated" ranks; "no review needed" only when nothing is unresolved |
| Typecheck `tsc --noEmit --incremental false` | clean |
| Changed-file ESLint (`--max-warnings 0`) | no finding in any new or edited code; three pre-existing files still report the same 34 problems (32 errors, 2 warnings: `afl-api-bundle.ts` unused vars, `afl-api-match.test.ts` / `reference-data.test.ts` `any`) — the identical count on a pristine export of the previous HEAD |

Not caused by this change and not run against the previous HEAD, so not claimed as pre-existing: in the same
disposable environment `admin-brownlow.test.ts` "preflight P2" (the 2025 template holds 330,383 round rows without
a resolved match, which the migration-094 backfill test expects to be 0) and `settle-afl-api.test.ts` OD-5 (the
clone name is not an approved rebuild target) fail on environment preconditions. `reference-data.test.ts` was
failing on the unregistered pre-existing table `brownlow_correction_receipts` (migration 116); its expected list
now names it. `v2-shadow-award-reports.test.ts` was failing on its stub schema (missing `staging.source_records`
tables) and is repaired.

## 4. Pending production rollout (unchanged authorities)

Implemented policy and isolated verification are **not** production execution. Still required, each separately:

- Schema approval for migrations 116 **and** 117 (own backup/restore); 117 is new and not inherited from any prior
  approval.
- Deployment of this runtime code (no deployment was made).
- Per operation: fresh exact target, clean reviewed execution revision, verified backup bytes and restored matching
  baseline, fresh counts, a self-digested unexpired plan and a separate owner execution approval enumerating the
  exact records (for `eligibility`: the twelve rulings by durable identity, current numeric id, citation and note).
- 2025 `observe` → `backfill` → `adopt` → `eligibility` sequencing in the [approval package](brownlow-production-approval-package-2026-10-20.md).
- Acceptance of the reconciliation for V2-GAP-016 once the above has run (checklist item 1). 2026 stays excluded.
