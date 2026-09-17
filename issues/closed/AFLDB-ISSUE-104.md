# AFLDB-ISSUE-104 — `data_issues` open-row dedup is not ownership-scoped

**Status:** Resolved 2026-09-04 — **closed as NOT REACHABLE under the current single-owner-per-
`issue_type` contract. Not "fixed".** The schema invariant is unchanged; migration 076 was not
edited and no forward migration was added.
**Severity at close:** Low (unchanged)
**Area:** Data acquisition / Import architecture / Data integrity
**Branch:** `claude/issue-104` (worktree `D:\dev\afldb-issue-104`)
**Migration numbers claimed:** none. `086` remains the next free number.

> This issue never had an open runbook. This file is the closure record: source-level proof, taken
> against the present codebase, that the hazard ISSUE-104 describes has no reachable call path —
> plus the reopen trigger that must be honoured before that stops being true.

---

## 1. What ISSUE-104 alleged

Migration 076's partial unique index is keyed on `(issue_type, issue_key)` with **no owner**:

```sql
-- src/db/migrations/076_afltables_settle_projections.sql:434-436
CREATE UNIQUE INDEX uq_data_issues_open_by_key
  ON data_issues (issue_type, issue_key)
  WHERE issue_key IS NOT NULL AND resolved_at IS NULL;
```

The settle writer infers exactly that index in `ON CONFLICT ... DO UPDATE`. So if a **second,
differently-owned** writer ever held an *open* row on an identically shaped `(issue_type,
issue_key)` pair, a recurrence would refresh **that** row — overwriting its `entity_id`,
`severity`, `description` and `details`, and restamping `details.owner`.

Resolution was already ownership-scoped; **refresh was not, because the index is not.**

The 2026-08-29 assessment was "unreachable — ISSUE-099 is the only `issue_key` writer". That
premise was **not** assumed here. It was re-derived from the current tree, and it has in fact
changed: **a second writer now exists.** It still does not collide.

---

## 2. Stage 1 — writer matrix (current tree)

Every DML statement touching `data_issues` outside `tests/`, enumerated by
`grep -rn "INSERT INTO data_issues|UPDATE data_issues|DELETE FROM data_issues"`.

| Writer | `issue_type` | `details.owner` | `issue_key` | Can collide with the ISSUE-099 key space? |
|---|---|---|---|---|
| `draftDisagreementIssue()` → `writeSettleDataIssue()`<br>`settle-afltables.ts:504`, written at `:3410` | `source_disagreement` (`:349`) | `AFLDB-ISSUE-099` (`:386`, stamped at `:540`) | `settleIssueKey()` `:339` → `afltables\|<family>\|<record>\|<target>` | — (it *is* that key space; sole writer) |
| canonical-apply failure → `writeSettleDataIssue()`<br>`settle-afltables.ts:2530` | `canonical_apply_failed` (`:365`) | `AFLDB-ISSUE-122` (`:393`, stamped at `:2542`) | `canonicalApplyIssueKey()` `:372` → `afltables\|apply\|<family>\|<record>\|<target>` | **No** — different `issue_type`, and different key prefix |
| `writeRekeyRefusalIssue()` → `writeSettleDataIssue()`<br>`settle-afltables.ts:2569`, written at `:2586` | `canonical_apply_failed` | `AFLDB-ISSUE-122` (stamped at `:2598`) | `canonicalApplyIssueKey()` — same key as the row above | **No.** Shares a key with the apply-failure writer, but under the **same owner** (see §4) |
| `import-first-kick-goal.ts:1322`, `:1332` | `first_kick_match_unresolved`, `career_goals_contradicts_source`, `career_kicks_contradicts_source`, `source_count_discrepancy` | none | **NULL** — column not in the INSERT list | **No** — excluded by `WHERE issue_key IS NOT NULL` |
| `enrich_birth_dates.py:265`, `:283`, `:601` | `dob_conflict`, `dob_internal_conflict`, `external_identity_conflict` | none | **NULL** | **No** — same reason |
| `enrich_birth_dates_from_club_lists.py:320` | `dob_conflict` | none | **NULL** | **No** — same reason |
| `020_attendance_provenance.sql:61` | `attendance_not_recorded` | none | **NULL** (column did not exist yet) | **No** — same reason |

**Resolvers / deleters:**

| Path | Scope | Ownership assertion |
|---|---|---|
| `resolveRestoredDisagreements()` `settle-afltables.ts:3337` | `UPDATE`, sets `resolved_at`/`resolution` | `issue_type = 'source_disagreement' AND details->>'owner' = 'AFLDB-ISSUE-099'` (`:3344`, `:3347`) — **owner-scoped** |
| `resolveAppliedFailureFinding()` `settle-afltables.ts:3433` | `UPDATE`, sets `resolved_at`/`resolution` | `issue_type = 'canonical_apply_failed' AND details->>'owner' = 'AFLDB-ISSUE-122'` (`:3439`, `:3444`) — **owner-scoped** |
| `import-first-kick-goal.ts:1175`, `:1310` | `DELETE` of unresolved rows | scoped `entity_type = 'player_achievements'` (+ an explicit `issue_type IN (...)` list at `:1310`) — disjoint from settle's entity types (§3.3) |
| `enrich_birth_dates*.py:252/276/307` | `DELETE`/`UPDATE` | scoped `entity_type = 'player'` — disjoint from settle's entity types |
| `072_dob_conflict_ownership.sql:285/302/353/365` | one-time migration DML | pre-dates `issue_key`; `dob_*` types only |

**Readers only:** `settle-report.ts:340` (`openFindingsOf()`, `SELECT` only, itself owner-filtered
at `:387-388`), `db-health.ts:109` (a label map). `lineup-store.ts` names `data_issues` only in a
comment stating it has no path that opens one — confirmed, it issues no `data_issues` DML.

**No later migration alters the table or the index.** `grep -l data_issues src/db/migrations/0[7-9]*.sql`
returns `072` and `076` only; nothing from `077` to `085` touches `data_issues`.
Migration 076 was **not modified** by this issue.

---

## 3. Stage 2 — reachability, question by question

### 3.1 Is there currently more than one writer capable of creating `source_disagreement` rows?

**No.** `SETTLE_ISSUE_TYPE` is produced at exactly one place — `draftDisagreementIssue()`
(`settle-afltables.ts:533`) — reached by exactly one call path:
`recordOutcome()` → `recordDisagreementFinding()` (`:3395`) → `writeSettleDataIssue(tx,
draftDisagreementIssue({...}))` (`:3410`). No other file in the repository inserts the literal
`source_disagreement`.

### 3.2 Can any current writer generate the same `details.issue_key` as another owner?

**No, on two independent grounds.**

1. **The index key differs.** The second writer carries `issue_type = 'canonical_apply_failed'`
   (`:365`), so it cannot contend for a `source_disagreement` index entry at all. This is
   deliberate and documented at `settle-afltables.ts:351-364`.
2. **The key spaces are disjoint anyway.** `settleIssueKey()` emits
   `afltables|<contract-family>|<record>|<target>`; `canonicalApplyIssueKey()` emits
   `afltables|apply|<contract-family>|<record>|<target>`. `contractFamilyOf()` (`:126`) is total
   over `BUNDLE_FAMILIES` (`:121-124`) and can return only `'match'` or `'player_match_stats'` —
   it `fail()`s on anything else — so the literal segment `apply` can never appear in position 2
   of a `settleIssueKey()`. The two strings can never be equal.

Every other writer leaves `issue_key` NULL and is excluded from the partial index entirely.

### 3.3 Does the application update an existing row without asserting ownership?

**Yes — and this is unchanged.** `writeSettleDataIssue()` (`:3291-3312`) upserts with

```sql
ON CONFLICT (issue_type, issue_key) WHERE issue_key IS NOT NULL AND resolved_at IS NULL
  DO UPDATE SET entity_id = ..., severity = ..., description = ..., details = ...
```

with **no `details->>'owner'` predicate**. That is the mechanism ISSUE-104 named, and it is still
there. What is absent is any *input* that can reach it holding a foreign owner: per §3.1–§3.2 each
`issue_type` in the keyed namespace has exactly one owner stamp, so the conflicting row the
`DO UPDATE` can ever find is always one this writer itself wrote.

Cross-writer contamination through the other tables' writers is also impossible by entity type:
settle rows carry `entity_type ∈ {matches, match_period_scores, player_match_stats,
brownlow_round_votes}` (`SettleTargetTable`, `:140-146`), while the first-kick-goal deletes are
scoped to `player_achievements` and the DOB passes to `player`.

### 3.4 Is the unique index itself insufficient for a future second owner?

**Yes.** Nothing about the index changed. `(issue_type, issue_key)` remains owner-blind, and
`writeSettleDataIssue()`'s upsert remains owner-blind. A future writer that adopts an **existing**
`issue_type` while stamping a different `owner` would make the hazard live immediately.

### 3.5 Is that insufficiency a current defect, or a documented precondition?

**A precondition.** ISSUE-122 §9.2 discharged ISSUE-104's binding precondition the cheap way — by
choosing a **distinct `issue_type`** rather than by changing the frozen dedup contract — and said
so in code (`settle-afltables.ts:351-364`) rather than in prose alone. That is the correct
resolution of the precondition: ownership entered the *namespace partition* instead of the index.
There is no reachable defect to fix, and adding a migration to harden an unreachable path would be
schema churn against a checksum-frozen contract for no behavioural gain.

### 3.6 Do existing tests prove ownership isolation?

Partly, and precisely where it matters.

| Test | Proves |
|---|---|
| `tests/integration/settle-afltables.test.ts:1513-1553` — *"never resolves an open row another writer owns"* | Inserts a genuinely foreign-owned row on the **same** `issue_key` ISSUE-099 is about to re-prove, runs the settle, and asserts `dataIssuesResolved/Opened/Refreshed` are all 0 and the foreign row is byte-for-byte untouched. This is the **resolution**-side ownership proof, against a live PostgreSQL. |
| `tests/current-season-import.test.ts:3833-3846` — *"keeps the apply-failure issue_type DISTINCT from the disagreement one (§9.2, AFLDB-ISSUE-104)"* | Pins `CANONICAL_APPLY_ISSUE_TYPE === 'canonical_apply_failed'`, pins it `not.toBe(SETTLE_ISSUE_TYPE)`, and pins the literal key shape `afltables\|apply\|match\|rec-1\|matches`. **This is the regression guard for this closure** — if the two `issue_type`s ever converge, it fails. |
| `tests/current-season-import.test.ts:3064-3065`, `:3141-3142` | Pin `SETTLE_ISSUE_TYPE`/`SETTLE_ISSUE_OWNER` literals and that a written row carries the owner stamp. |
| `tests/integration/settle-afltables.test.ts:3218-3227` | End-to-end: a failed apply unit opens findings under `CANONICAL_APPLY_ISSUE_TYPE`, and re-asserts `not.toBe(SETTLE_ISSUE_TYPE)` against real rows. |

There is deliberately **no** test that the *refresh* path refuses a foreign-owned open row —
because it does not refuse. It cannot be reached with one. That absence is the honest shape of this
closure and is why the issue is closed as unreachable rather than as fixed.

---

## 4. One thing found that is NOT ISSUE-104

Within `canonical_apply_failed`, **two** call sites share the same `issue_key` construction:
the apply-failure writer (`:2530`) and `writeRekeyRefusalIssue()` (`:2569`, written at `:2586`).
A rekey refusal and an apply failure for the same `(family, record, target)` therefore refresh
**one** row rather than stacking two.

This is intra-owner, not cross-owner: both stamp `owner = 'AFLDB-ISSUE-122'`, both are closed by
`resolveAppliedFailureFinding()`, and ISSUE-131 §5.10 (`settle-afltables.ts:2557-2567`) states this
placement explicitly — one visible, resolvable finding per target, latest refusal winning. It is
the intended dedup semantic of migration 076, not the defect ISSUE-104 describes. **No issue
opened.**

---

## 5. Verdict

**ISSUE-104 is not a reachable defect in the current codebase.**

The `data_issues` open-row dedup contract is safe **only because every `issue_type` in the keyed
namespace has exactly one owner** — `source_disagreement` → `AFLDB-ISSUE-099`,
`canonical_apply_failed` → `AFLDB-ISSUE-122`. It is **not** globally safe. The index remains
owner-blind and the upsert remains owner-blind; what protects the invariant is a namespace
convention held by one module and pinned by one unit test.

No code, schema, migration or test change was made by this closure.

---

## 6. Reopen trigger — binding

**Reopen ISSUE-104 (or allocate its successor) the moment any of these becomes true:**

1. A **second owner** begins writing `data_issues` rows under an `issue_type` that another owner
   already writes with a non-NULL `issue_key` — including a new subsystem adopting
   `source_disagreement` or `canonical_apply_failed`.
2. `CANONICAL_APPLY_ISSUE_TYPE` and `SETTLE_ISSUE_TYPE` converge, or either loses its distinct
   `details.owner` stamp. (`tests/current-season-import.test.ts:3833-3846` fails first.)
3. Any writer outside `settle-afltables.ts` starts populating `data_issues.issue_key`.

**Then, before that writer ships,** ownership must become part of either the uniqueness contract or
the write predicate:

- a **forward** migration adding owner to the partial unique key (migration 076 is applied and
  checksum-frozen — **never edit it**), **or**
- an ownership-scoped persistence path with defined, tested behaviour when a foreign-owned open row
  exists (fail closed / counter / skip — the contract must say which),

with regression coverage that a foreign-owned open row survives a refresh, mirroring the existing
resolution-side proof at `tests/integration/settle-afltables.test.ts:1513-1553`.

---

## 7. Files changed by this closure

| File | Change |
|---|---|
| `issues/closed/AFLDB-ISSUE-104.md` | **New** — this record |
| `issues.md` | ISSUE-104 entry marked Resolved; row removed from the Open Issues table; open count 7 → 6 |
| `IssuesIndex.md` | ISSUE-104 row retired; open count 7 → 6 |

No `CHANGELOG.md` entry: this is a tracking-only closure with no retained change to application,
schema, search, admin or deployment behaviour.

No shell, Git, database or deployment command was executed during the investigation; it is
source-level throughout. Neither DEV nor PROD was read or written. ISSUE-137 was not touched.
