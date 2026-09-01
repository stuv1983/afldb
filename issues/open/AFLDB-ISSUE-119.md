# AFLDB-ISSUE-119 — Super Admin can clear NL search telemetry

- **Status:** In progress — Stage 2 started 2026-09-01. Migration `081` (§20) is **applied to `afldb_test`** as of 2026-09-01 (§23) — its first execution anywhere. The `privileges.sql` reconciliation (§21) and the guarded database/integration tests (§22) are written and source-reviewed but **still never executed**; Server Action and UI not started
- **Created:** 2026-08-31
- **Severity:** Medium
- **Area:** Admin / Security / Natural-language search / Telemetry / Database
- **Stage 2 gate:** **CLEARED 2026-09-01** — operator approved the §5 classification and §6 authorisation model exactly as documented (see §5.1)
- **Renumbered:** 2026-09-01, from `AFLDB-ISSUE-118` (see §0)

## 0. Issue-number reconciliation (2026-09-01)

**OLD ID:** `AFLDB-ISSUE-118`

**NEW ID:** `AFLDB-ISSUE-119`

Two unrelated projects independently allocated 118. This NL-telemetry issue was renumbered; the Gridley compatibility-corpus project keeps 118.

### Evidence

| Question | Repository evidence |
|---|---|
| Is 118 allocated on `main`? | No. The highest ID referenced anywhere in `issues.md`, `IssuesIndex.md`, `CHANGELOG.md` or `issues/` at `main` (`7a0f592`) is **117**. |
| Who first claimed 118 in committed history? | **Gridley.** Branch `opus/gridley-corpus` carries three commits ahead of `main` (`9ecc6fc` Stage 0, `28fdb2f` Stage 1, `6e3b38a` Stage 2) that add `issues/open/AFLDB-ISSUE-118.md` (2,048 lines) and 118 rows in `IssuesIndex.md`, `issues.md` and `CHANGELOG.md`. |
| Was this NL-telemetry claim committed? | **No.** `codex/issue-118` points at `7a0f592`, identical to `main`; its entire 118 claim was uncommitted working-tree state (`M IssuesIndex.md`, `M issues.md`, `?? issues/open/AFLDB-ISSUE-118.md`). Renumbering rewrites no history. |
| Is any ID above 118 already allocated? | No. A scan of every local and remote branch tip for `AFLDB-ISSUE-1(1[5-9]|[2-9][0-9])` in `issues.md`, `IssuesIndex.md`, `CHANGELOG.md` and `issues/` returned 115, 116 and 117 broadly, 118 on `opus/gridley-corpus` only, and **nothing at 119 or above on any ref**. |
| Next genuinely free ID | **119.** |

### Decision

Repository convention treats a branch-local allocation as allocated before merge — see the retired `IssuesIndex.md` note that `AFLDB-ISSUE-110` "is allocated and is NOT free" while its branch was still unmerged. Gridley therefore holds 118 by committed allocation, and the uncommitted NL-telemetry claim is the one that moves. Renumbering Gridley instead would rewrite three committed milestones and a 2,048-line runbook; renumbering this issue changes three uncommitted documentation files and costs nothing.

No repository rule was found that reserves 119, forbids reuse of a never-committed number, or requires issue IDs to match branch names.

### Deliberately NOT changed

- `D:\dev\afldb-gridley`, branch `opus/gridley-corpus`, and every Gridley `ISSUE-118` reference: untouched. Only read-only Git metadata commands were run against that ref.
- Branch `codex/issue-118` and worktree directory `D:\dev\afldb-issue-118`: **not renamed.** Recorded as a later operator action; the branch/worktree name no longer matches the issue ID.
- Unrelated `118` strings in `issues.md` (the ISSUE-068 "118-row discriminator" history) were left intact. No global replace was performed.

### Consequential collision: migration number

The same branch-local allocation rule breaks this runbook's planned migration number. Gridley has already committed `src/db/migrations/080_external_grids.sql`, and `claude/issue-116` separately carries its own `079_access_code_delete.sql` that must be renumbered when it merges. See §7.

## 1. Problem statement

AFLDB has a Super Admin-only Natural-language search dashboard and audited CSV exports, but no safe way to retire accumulated operational NL telemetry. The requested operation is destructive and must not become a broad `TRUNCATE`, an owner-credential escape hatch, or a reason to erase human decisions and audit history.

Repository evidence establishes three NL relations, not a family inferred from names:

- `nl_search_log` records what the deterministic engine did;
- `nl_search_review` records what an administrator concluded about a log row;
- `nl_search_feedback` records what a reader said about an answer.

The first is the reset target only where it remains disposable operational telemetry. The latter two are repository-declared durable evidence. Their context must remain meaningful after a reset.

## 2. Scope

Stage 2 may add one deliberate, Super Admin-only action on `/admin/nl-search` that:

1. deletes disposable `nl_search_log` rows;
2. retains every admin review and reader-feedback fact, plus the minimum log context they require;
3. preserves all unrelated, reference, configuration, parser, schema, corpus and audit data;
4. uses the restricted `afldb_auth` connection through one narrowly executable database capability;
5. commits deletion and its audit event atomically;
6. gives concurrent NL writers a defined before/after boundary; and
7. refreshes every affected admin surface.

## 3. Explicit non-goals

- No Stage 1 feature code, deletion SQL, migration, grant or database mutation.
- No `TRUNCATE`, `CASCADE`, sequence reset, owner DSN, `DATABASE_URL` fallback, `afldb_app` widening or `afldb_import` widening.
- No deletion of `nl_search_review`, `nl_search_feedback`, `auth_audit_log`, `app_health_events`, parser/search configuration, migrations, corpora, stress outputs, application/reference data or unrelated operational data.
- No parser, planner, compiler, answer or telemetry-write semantic change.
- No retention scheduler, age-based purge, automatic clear, production operation or large-scale NL run.
- No attempt to make the shared PostgreSQL role represent the signed-in human role. Human authorisation remains at the canonical server boundary; the database boundary confines the available SQL capability.
- No change to `AFLDB-ISSUE-117` rate limiting or unresolved `AFLDB-ISSUE-110` semantic work.

## 4. Persistent relation inventory

### 4.1 `public.nl_search_log` — operational engine telemetry

| Property | Evidence / contract |
|---|---|
| Purpose | One row per `/search` render reaching the NL engine: question, outcome, plan, confidence, parser version, entity resolution, result count, duration and optional synthetic `run_tag` (migrations 046, 047, 049 and 051). |
| Primary key | `id bigint GENERATED ALWAYS AS IDENTITY`. |
| Writer | `logNlSearch()` in `src/db/queries/nl/log.ts`, deferred through Next `after()` and isolated from answer failure. |
| Readers | Reporting functions in `src/db/queries/nl-search-log.ts`; `/admin/nl-search`; detail/session views; seven CSV exports; app-health search-load denominator; app-health writer's `client_ref` lookup. |
| Outgoing FKs | `parent_search_id -> nl_search_log(id)`, default `NO ACTION`. |
| Incoming FKs | `nl_search_review.search_log_id -> nl_search_log(id)`, default `NO ACTION`; `app_health_events.related_search_id -> nl_search_log(id) ON DELETE SET NULL`. |
| Non-FK correlation | `nl_search_feedback.client_ref = nl_search_log.client_ref`; the missing FK is deliberate because feedback can arrive before the deferred log. |
| Current role/grants | `afldb_auth`: `SELECT, INSERT`, sequence `USAGE, SELECT`; no `UPDATE`, `DELETE` or `TRUNCATE`. Not app-readable. |
| Deletion safety | A row is disposable only if it has no durable review, no matching durable feedback, and is not an ancestor needed by either protected row. All other log rows remain. |
| Order/derived effects | Delete after establishing the retained recursive closure. A single `DELETE` removes the remaining self-referencing set. Related app-health links become `NULL` by their declared FK action; app-health rows remain. |

### 4.2 `public.nl_search_review` — durable administrator conclusions

| Property | Evidence / contract |
|---|---|
| Purpose | Mutable workflow judgement about one search: status, category, notes, reviewer, reviewed time and fixed version. Migration 047 compares it to an issue tracker separate from the underlying evidence. |
| Primary key | `id bigint GENERATED ALWAYS AS IDENTITY`. |
| Writer | `saveNlSearchReview()` via Super Admin `saveReview()`; upsert by `search_log_id`. |
| Readers | Overview/failure/problem/detail/export queries and `/admin/nl-search`. |
| FKs | `search_log_id` is `NOT NULL UNIQUE` to `nl_search_log`, default `NO ACTION`; `reviewed_by -> auth_users(id)`, default `NO ACTION`. |
| Current role/grants | `afldb_auth`: `SELECT, INSERT, UPDATE`; no `DELETE` or `TRUNCATE`. |
| Classification | **MUST PRESERVE.** It is a durable human decision, not disposable engine telemetry. Its referenced log row and recursive parent chain also remain. |

### 4.3 `public.nl_search_feedback` — durable reader feedback facts

| Property | Evidence / contract |
|---|---|
| Purpose | Anonymous `correct`/`incorrect` verdict and optional expected answer. Migration 049 says the feedback is a fact that happened and is append-only. |
| Primary key | `id bigint GENERATED ALWAYS AS IDENTITY`; `client_ref` is unique. |
| Writer | Public, rate-limited `recordNlFeedback()` through `afldb_auth`. |
| Readers | Feedback list/summary and `/admin/nl-search/feedback`. |
| FKs | None by design. Correlates to `nl_search_log.client_ref`; feedback may precede the deferred log insert. |
| Current role/grants | `afldb_auth`: `SELECT, INSERT`; no `UPDATE`, `DELETE` or `TRUNCATE`. |
| Classification | **MUST PRESERVE.** Matching log rows and their recursive parent chain remain when present. Unmatched feedback also remains. |

### 4.4 `public.app_health_events` — related but not NL telemetry

| Property | Evidence / contract |
|---|---|
| Purpose | Append-only client/runtime health failures across routes, not an NL-search dataset. |
| Relevant relation | Nullable `related_search_id -> nl_search_log(id) ON DELETE SET NULL`; admin overview separately counts recent log rows as a denominator. |
| Classification | **MUST PRESERVE.** No health row is deleted. The schema-authorised `SET NULL` detaches links to deleted disposable logs. |

### 4.5 Views, exports and other persistence

No view or materialized view references the three NL relations. The seven export datasets (`searches`, `problems`, `terms`, `topics`, `reasons`, `reformulations`, `plans`) are live queries, not stored relations. All are derived from `nl_search_log`; `searches` also left-joins review fields. Clearing an eligible log row removes its contribution from every relevant export without deleting a separate export store.

`tools/nl` corpora and run outputs (`report.md`, `results.jsonl`, failures, summaries and related files) are filesystem regression/qualification artefacts. The DB-free stress runner explicitly writes no table. They are **MUST PRESERVE** and outside the operation.

## 5. Classification

### A. MUST CLEAR

- Every `nl_search_log` row committed before the clear cutoff that is not protected by a review, matching feedback, or the recursive parent chain of either.
- This includes ordinary reader/beta telemetry and synthetic `run_tag` telemetry when otherwise unprotected.
- Its contributions to searches, problems, terms, topics, reasons, reformulations and plans reports/exports disappear naturally because those are live derivations.

### B. MUST PRESERVE

- Every `nl_search_review` row.
- Every `nl_search_feedback` row, including feedback whose deferred log has not landed.
- Every log row directly referenced by a review.
- Every log row whose `client_ref` matches feedback.
- Every recursive `parent_search_id` ancestor of those protected log rows.
- Every `app_health_events` row; only its schema-declared nullable link may be cleared.
- `auth_audit_log`, including the new clear event.
- `auth_users`, sessions, role/configuration data, site/application/reference/statistical data, migrations/schema objects, parser/search source and configuration, curated regression corpora, stress outputs and all unrelated data.
- Identity sequences and their values; IDs remain monotonic and are not restarted.

### C. NEEDS DECISION / not authorised by this runbook

- A future request to produce an absolutely empty NL dashboard by deleting reviews, feedback or their evidence context is a different retention-policy decision. It conflicts with current durable/append-only contracts and is not silently included in ISSUE-119.
- If the operator rejects the retained-evidence boundary, Stage 2 must stop and this runbook must be revised before code is written. There is no unresolved decision within the recommended Stage 2 scope.

### 5.1 Operator approval — 2026-09-01

The retained-evidence boundary in §5 and the authorisation model in §6 are **APPROVED exactly as documented**. The approval binds Stage 2 to the following, none of which may be renegotiated during implementation:

| Approved obligation | Binding form |
|---|---|
| Preserve `nl_search_review` | Every row. The operation never deletes a review. |
| Preserve `nl_search_feedback` | **All** feedback rows, including feedback whose deferred log never landed. |
| Preserve directly protected `nl_search_log` rows | Any log carrying a review, or whose `client_ref` matches feedback. |
| Preserve full recursive ancestry | The **complete** `parent_search_id` chain above every protected log, to arbitrary depth — not merely the immediate parent. |
| Preserve `app_health_events` | Every row survives; the only permitted mutation is the schema-declared `ON DELETE SET NULL` detachment of `related_search_id`. |
| Do not reset sequences | Identity sequences keep their values; IDs stay monotonic. |
| Do not broaden the operation | No deletion of reviews or feedback under any flag, parameter, mode or follow-up request within this issue. |

The operator additionally **strengthened the validation contract**: the recursive retained-ancestor integration test must exercise a chain **deeper than one parent**. See §13 and §16 criterion 2.

Any future request for an absolutely empty NL dashboard remains out of scope per §5C and requires a new retention decision, not a Stage 2 amendment.

## 6. Security and authorisation model

### Application boundary

- The page already calls `requireSuperAdmin()`.
- The new Server Action independently calls `requireSuperAdmin()` before parsing confirmation input or opening a transaction. This covers direct/forged action invocation; rendering the control conditionally is not an authorisation boundary.
- `requireSuperAdmin()` is canonical: `requireAdmin()` revalidates the signed session against the database, enforces temporary-password and contributor restrictions, then checks `role === 'super_admin'`.
- Plain admins, contributors, disabled/revoked sessions and unauthenticated callers never reach the mutation helper.

### Database boundary

- The connection role is `afldb_auth`, using only `AFLDB_AUTH_DATABASE_URL` and the test equivalent in guarded tests.
- Do not grant direct table `DELETE` or `TRUNCATE` to `afldb_auth`. Add a narrowly scoped `SECURITY DEFINER` function owned by `afldb_owner`, with schema-qualified objects and a fixed safe `search_path`, then `REVOKE EXECUTE FROM PUBLIC` and grant only `EXECUTE` to `afldb_auth`.
- The application does not use an owner credential. Function-owner execution supplies only the predeclared delete algorithm; the shared auth role cannot issue arbitrary deletes.
- Existing architecture uses one shared DB role for public feedback, authentication and human admins, so PostgreSQL cannot independently prove which signed-in human invoked a call. A fake actor-id check inside the function would be bypassable by the same shared role. Contextual Super Admin enforcement remains in the canonical Server Action; the database boundary limits capability and affected rows.
- `tools/maintenance/privileges.sql` reconciles the function grant for role-after-migration installs while preserving the absence of direct DELETE/TRUNCATE grants.

## 7. Deletion strategy: bounded `DELETE`, never `TRUNCATE`

Add a forward migration named `<NNN>_nl_search_telemetry_clear.sql`. **Do not hardcode 080.** `079_nl_search_log_head_to_head_grain.sql` is the highest migration on `main`, but `080_external_grids.sql` is already committed on `opus/gridley-corpus`, and `claude/issue-116` carries a competing `079_access_code_delete.sql` that must itself be renumbered on merge. Stage 2 must re-scan every live branch tip and take the next number above all of them — **currently `081`** — then re-verify immediately before writing the file. Never edit 046–055 or 079. **ASSIGNED 2026-09-01: `081`.** Re-derived after `git fetch --all --prune` across 46 refs and 34 worktrees; nothing at 081 or above exists on any ref. Evidence in §20.1.

The function should:

1. lock `nl_search_review`, `nl_search_feedback`, `app_health_events`, then `nl_search_log` in child-before-parent order using `SHARE ROW EXCLUSIVE` (or an equally proven mode that blocks their writers while allowing reads);
2. count app-health links that will be detached;
3. build a recursive retained-id set seeded by reviewed logs and feedback-matched logs, then follow `parent_search_id` to every ancestor;
4. issue one `DELETE FROM nl_search_log WHERE id NOT IN retained-set RETURNING id`;
5. return deleted and retained counts.

`DELETE` is required because eligibility is selective. `TRUNCATE` cannot preserve reviewed/feedback evidence, needs a broader privilege, cannot express this row policy, and invites sequence/CASCADE hazards. `DELETE` honours the review `NO ACTION` FK and app-health `ON DELETE SET NULL`; no dynamic SQL, sequence restart or `CASCADE` is required.

## 8. Atomicity and concurrency

The Server Action opens one `authSql.begin()` transaction. Inside it:

1. invoke the restricted clear function;
2. insert the mandatory audit row through a transaction-aware form of the canonical audit helper;
3. commit only when both succeed.

An audit failure rolls back deletion. A deletion failure creates no success audit. No best-effort audit warning is acceptable.

The table locks define the cutoff as: **all eligible rows committed when the complete lock set has been acquired are deleted; writers blocked by the clear commit afterwards and survive as post-clear telemetry.** This includes deferred `after()` writes. Reads continue. Child-before-parent lock order follows current review/app-health writer dependencies and avoids a parent/child lock-order cycle.

A stale review form submitted after its disposable log was cleared must fail safely at the FK/not-found boundary; it must not recreate or fabricate telemetry.

## 9. Audit strategy

Use `auth_audit_log`, the canonical durable administrative trail, with action `nl_search.telemetry_cleared`.

The same-transaction audit records only:

- `deletedLogRows`;
- `retainedLogRows`;
- `retainedReviewRows`;
- `retainedFeedbackRows`;
- `detachedAppHealthLinks`.

Actor id, email label and request IP follow the existing helper. Do not log questions, expected answers, plans, session IDs, client refs or deleted IDs. `auth_audit_log` is not a deletion target.

## 10. Admin UI and confirmation

Natural location: the existing Super Admin-only `/admin/nl-search` page beside period/export controls.

- Add a client component such as `ClearTelemetryForm.tsx`, following `DeleteMatchButton`'s reveal-warning-confirm-cancel pattern.
- Initial action: **Clear search telemetry**.
- Expanded warning explains permanence, retained review/feedback evidence, and continued logging after the cutoff.
- Require exact typed phrase `CLEAR SEARCH TELEMETRY` before enabling submit; validate it again in the Server Action.
- Cancel collapses/resets and submits nothing; pending disables resubmission.
- Success reports deleted/retained counts rather than claiming the dashboard must be empty.
- Do not expose it on a shared/plain-admin surface.

## 11. Cache and revalidation

On committed success:

- `revalidatePath('/admin/nl-search', 'layout')` for overview, feedback and detail descendants;
- `revalidatePath('/admin/app-health')` because its denominator and related links change.

Exports are live route queries. No public page reads these relations. If current Next.js behaviour shows a child route is not covered by layout invalidation, add narrow explicit paths rather than site-wide `/` revalidation.

## 12. Proposed Stage 2 files

| File | Planned change |
|---|---|
| `src/db/migrations/081_nl_search_telemetry_clear.sql` (number assigned per §7 and §20.1) | **Written 2026-09-01; untracked and unapplied.** Restricted function, locks, retained closure, selective delete and exact grants. |
| `tools/maintenance/privileges.sql` | **Written 2026-09-01 (§21); unexecuted.** Reconciles function owner, `REVOKE ALL` from `PUBLIC` and `EXECUTE` to `afldb_auth`, and revokes any direct DELETE/TRUNCATE on the three NL tables. |
| `src/db/queries/nl-search-log.ts` | Typed function invocation/result, or a new narrowly named maintenance module if clearer. |
| `src/lib/auth/session.ts` | Transaction-aware audit helper preserving existing callers. |
| `src/app/admin/nl-search/actions.ts` | Guard, server phrase check, atomic clear+audit, revalidation and result state. |
| `src/app/admin/nl-search/ClearTelemetryForm.tsx` | Typed confirmation, cancel/pending/result UI. |
| `src/app/admin/nl-search/page.tsx` | Render control and qualify current absolute read-only/append-only copy. |
| `.env.example` | **Written 2026-09-01 (§22).** Guarded `AFLDB_TEST_AUTH_DATABASE_URL`; same `_test` DB, never fallback. |
| `tests/admin-nl-search-actions.test.ts` | Server Action auth/confirmation/audit/revalidation tests. |
| `tests/integration/nl-search-telemetry-clear.test.ts` | **Written 2026-09-01 (§22); never executed.** Rolled-back safety, atomicity, FK, concurrency and restricted-role tests. |
| `tests/integration/privileges.test.ts` | **Extended 2026-09-01 (§22); never executed.** Exact function and no-widening catalogue assertions. |
| `tests/admin-nav/` or dedicated guarded Playwright files | Real confirmation/cancel/success only against a disposable `_test` deployment. |
| `docs/search.md` | Validated retention, audit and Super Admin workflow. |
| issue/index/changelog files | Stage 2 closeout state and Unreleased feature entry after validation. |

The query-module split is organisational only and must not change the approved SQL/security contract.

## 13. Validation plan

Database tests use `AFLDB_TEST_DATABASE_URL` and a restricted `AFLDB_TEST_AUTH_DATABASE_URL` validated to end in `_test`, target the same endpoint/database, authenticate as `afldb_auth`, and never substitute owner/dev credentials. No test may target `afldb_dev` or production. Success-path destructive assertions run inside an always-rolled-back transaction.

### Authorisation

- Super Admin direct action succeeds.
- Plain admin, contributor/invalid session and unauthenticated direct action stop at `requireSuperAdmin()` before the query helper.
- Missing/wrong confirmation performs no transaction, delete or audit.
- Page/control remains reachable only through the guarded Super Admin route.

### Data safety

Seed disposable real/synthetic logs; a reviewed log with an unreviewed parent; a feedback-matched log with a parent; unmatched early feedback; an app-health row pointing to a disposable log; unrelated sentinels; and pre-existing audits.

**Mandatory multi-level ancestry case (operator requirement, 2026-09-01).** At least one seeded fixture must be a `parent_search_id` chain **deeper than one parent** — a protected leaf whose grandparent and great-grandparent are themselves otherwise disposable (no review, no matching feedback). Assert that **every** ancestor in the chain survives, not only the immediate parent. A test proving only single-level parent retention does not satisfy this criterion: it would also pass against a non-recursive one-hop join, so it cannot detect the exact defect the recursive closure exists to prevent. Include a sibling disposable log hanging off a mid-chain ancestor and assert that sibling **is** deleted, proving retention follows ancestry rather than the whole connected component.

Assert only disposable logs are removed; reviews, feedback and protected direct/ancestor logs are byte/semantically unchanged; unmatched feedback remains; app-health rows remain with only affected links set `NULL`; unrelated/config/reference/parser/schema data and old audits remain; exactly one count-only clear audit exists inside the success transaction; FKs validate immediately; sequences are not reset.

### Atomicity and concurrency

- Force failure after function return and before commit; every delete and FK `SET NULL` rolls back, with no success audit.
- Force audit failure; same rollback.
- Hold clear transaction A after the function, attempt restricted-role log insert B, prove B waits, commit A, then prove B survives as post-clear telemetry.
- Start a review/feedback writer before the clear lock where practical; prove its committed durable fact enters the retained closure.

### Privileges

- Restricted `afldb_auth` credential invokes the function.
- It retains no direct `DELETE`/`TRUNCATE` on the NL tables.
- PUBLIC, `afldb_app`, `afldb_import` and `afldb_backup` cannot execute it.
- Assert owner, `SECURITY DEFINER`, fixed `search_path`, schema qualification, and no dynamic SQL/CASCADE.
- Reconcile privileges on `afldb_test`, then re-run catalogue assertions to prove only the intended EXECUTE survives.

### UI

- Initial action is non-destructive; warning and exact phrase are required.
- Wrong/partial text is disabled client-side and refused server-side.
- Cancel performs no request/mutation; pending prevents double submit.
- Success reports counts and refreshes NL admin/feedback/detail and app-health data.
- Plain-admin/unauthenticated journeys cannot reach page/action.

### Progressive operator validation

After implementation, supply one command at a time: focused DB-free action/component tests; focused rolled-back PostgreSQL suite with both test DSNs; privilege suite after test reconciliation; typecheck; guarded Playwright against a disposable `_test` deployment; broader suite/build only if focused evidence or the Next.js boundary requires it.

## 14. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Durable evidence erased | Recursive protected closure; no DELETE capability on review/feedback. |
| FK failure/broken context | Keep protected logs and ancestors; one selective DELETE; FK assertions. |
| Concurrent deferred insert half-cleared | Explicit locks and cutoff; post-cutoff writers survive. |
| Audit/delete disagreement | Mandatory audit in the deletion transaction. |
| Auth role gains arbitrary delete | EXECUTE one fixed function only; no direct DELETE/TRUNCATE; fixed search path. |
| Client guard bypass | Server `requireSuperAdmin()` and phrase validation. |
| Sequence reuse | DELETE only; no identity restart. |
| App-health loss | Preserve rows; declared `SET NULL`; audit detached count. |
| Dev/prod test mutation | Guarded `_test` DSNs, no fallback, rollback-only success checks. |
| ISSUE-110 evidence erased | Implementation/tests touch `_test` only; do not invoke a real reset while its telemetry evidence is under review. |

## 15. Blockers / deviations

- **SUPERSEDED 2026-09-01.** Stage 1 recorded "no ISSUE-118 collision exists". That was true of `main` and of this worktree, but Stage 1 did not scan other branches. A collision did exist on `opus/gridley-corpus`, which had committed its own `AFLDB-ISSUE-118`. This issue is now `AFLDB-ISSUE-119`; see §0.
- **Open operator action:** branch `codex/issue-118` and worktree `D:\dev\afldb-issue-118` still carry the old number. Renaming them was deliberately not attempted in this session.
- ~~**Migration number is no longer fixed.**~~ **CLOSED 2026-09-01.** `080` belongs to Gridley; `081` was re-derived and taken (§20.1). `claude/issue-116`'s duplicate `079` still has to renumber on merge. `082` was the next free migration number as of the 2026-09-01 scan and is **not reserved**: ISSUE-116 must re-scan the relevant live refs and worktrees and derive the next free number itself, immediately before it renumbers its competing migration.
- No source, migration, grant, test or runtime behaviour changed in Stage 1.
- No database, test, build, package, deployment or production command ran.
- `CHANGELOG.md` is intentionally unchanged: workflow excludes investigation-only/runbook updates until retained behaviour changes.
- The graph excluded migrations, tools, integration tests and docs and partially parsed SQL-template lines. Material excluded/partial evidence was checked directly in source; coverage remains best-effort.
- Stage 2 is blocked only on operator approval. A demand to delete durable reviews/feedback requires a revised retention plan.

## 16. Acceptance criteria

Stage 2 is accepted only when all are true:

1. **Deleted:** every pre-cutoff disposable `nl_search_log` row, including unprotected synthetic rows; no other row.
2. **Retained:** reviews, feedback, protected log/ancestor context, app-health rows, audit history, sequences, parser/config/reference/schema/corpus/output and unrelated data. Ancestor retention is proven to **arbitrary depth** by a fixture chain deeper than one parent, with a mid-chain disposable sibling deleted (§13).
3. **Caller:** only a signed-in, DB-revalidated `super_admin`; forged action calls cannot bypass it.
4. **Confirmation:** exact typed `CLEAR SEARCH TELEMETRY`, checked client and server; cancellation has zero mutation.
5. **DB role:** application connects as `afldb_auth` and only EXECUTEs the fixed function; no owner credential or direct DELETE/TRUNCATE grant.
6. **Audit:** exactly one `nl_search.telemetry_cleared` count-only row in the same transaction; audit failure rolls back all.
7. **Concurrency:** child-before-parent locked cutoff; pre-cutoff eligible rows clear, blocked later writers survive, no partial result.
8. **FK/derived state:** review/self FKs remain valid; affected app-health links alone become `NULL`; no view refresh is needed.
9. **Revalidation:** NL admin layout/children and app-health refresh; exports read fresh data; no site-wide public invalidation.
10. **Tests:** authorisation, forged invocation, preservation, rollback, concurrency, restricted-role success, privilege reconciliation/non-widening, UI confirmation/cancel/success and refresh pass against guarded test-only infrastructure.
11. **Tracking:** issue/index/Unreleased changelog reflect validated implementation; issue stays open until all evidence passes.

## 17. Exact next action for Stage 2

**PARTLY DISCHARGED 2026-09-01 — the migration now exists; the live instruction is §20.7.** Start a fresh implementation session and create the migration first, taking its number per §7 rather than assuming 080. Implement and source-review the fixed retained-closure/delete function and exact grants before adding any Server Action or UI. Do not run or expose the action until migration, restricted-role and rollback tests are written.

## 18. Session record — 2026-09-01 (reconciliation session)

### Purpose

Resolve the ISSUE-118 collision, re-verify Stage 1's load-bearing claims against current source, and stop before implementation.

### Implementation state

**Unchanged: still zero implementation.** No migration, SQL, grant, Server Action, component, test or `CHANGELOG.md` entry exists for this issue. The worktree's only content is documentation:

| File | State |
|---|---|
| `issues/open/AFLDB-ISSUE-119.md` | Untracked; renamed from `AFLDB-ISSUE-118.md`; §0, §7, §12, §15, §17, §18 updated |
| `IssuesIndex.md` | Modified; count line, allocation warning, renumbered row |
| `issues.md` | Modified; count line, Open Issues row, ledger heading/`Renumbered`/`Files`/`Runbook`/`Follow-up` |

Branch `codex/issue-118` is at `7a0f592`, identical to `main` — no commits.

### Stage 1 claims re-verified against source

Spot-checks confirmed the runbook's security- and schema-critical assertions; none required correction.

| Claim | Verified at |
|---|---|
| `nl_search_review.search_log_id` is `bigint NOT NULL UNIQUE REFERENCES nl_search_log(id)`, default `NO ACTION` | `src/db/migrations/047_nl_search_log_observability.sql:105` |
| `nl_search_log.parent_search_id` self-reference, default `NO ACTION` | `047_nl_search_log_observability.sql:66` |
| `app_health_events.related_search_id` is `ON DELETE SET NULL` | `src/db/migrations/052_app_health_events.sql:49` |
| `nl_search_feedback` has no FK to the log | `src/db/migrations/049_nl_search_feedback.sql:45` |
| `afldb_auth` grants are append-only on log/feedback and `UPDATE`-but-not-`DELETE` on review | `tools/maintenance/privileges.sql:385-388`; `047:134`, `049:92` |
| `requireSuperAdmin()` is the canonical gate and already guards this route's actions | `src/lib/auth/session.ts:293`; `src/app/admin/nl-search/actions.ts:6,27` |
| `/admin/nl-search` surface exists with `page.tsx`, `actions.ts`, `ReviewForm.tsx`, `[id]`, `feedback`, `export` | `src/app/admin/nl-search/` |
| `audit()` binds the module-level `authSql`, so it **cannot** join a caller's transaction as written — §8's atomicity requirement genuinely needs the transaction-aware variant in §12 | `src/lib/auth/session.ts:330-341` |

### Validation performed this session

Documentation and renumber validation only:

- every `ISSUE-118` reference in the worktree enumerated before editing and re-enumerated after; all six survivors are deliberate provenance/warning text;
- `git diff -U0 issues.md` hunk headers confirm only lines 10, 18 and the appended ledger block changed — the unrelated ISSUE-068 "118-row discriminator" history is untouched;
- `IssuesIndex.md` and `issues.md` open-issue counts agree at 8 and list the same IDs;
- `issues/open/` contains no `AFLDB-ISSUE-118.md`;
- §0 and §12 Markdown tables re-read for column integrity.

No test, build, typecheck, SQL, database, deployment or production command ran. No database was queried; every finding above is static source evidence.

### Unresolved decisions carried forward

1. ~~Operator approval of the retained-evidence boundary~~ — **CLOSED 2026-09-01. Approved exactly as documented; see §5.1.**
2. **Migration number** — must be re-derived at Stage 2 per §7; do not assume `080`.
3. **Branch/worktree rename** — `codex/issue-118` and `D:\dev\afldb-issue-118` still carry the old number. Operator action, deliberately not attempted here.

### Exact next action

~~Operator reviews §5 and §6 and either approves the Stage 2 boundary or directs a revised retention plan.~~ **Superseded the same day by §19 — approval granted.**

## 19. Operator approval record — 2026-09-01

### Decision

The operator approved the §5 retained-evidence boundary and the §6 authorisation model **exactly as documented**, with one strengthening amendment. The Stage 2 gate declared in the header is **CLEARED**. The binding obligation table is §5.1; it is the contract Stage 2 implements against.

Approved without modification:

- preserve `nl_search_review` in full;
- preserve **all** `nl_search_feedback`, including feedback whose deferred log never landed;
- preserve directly protected `nl_search_log` rows;
- preserve the **full recursive `parent_search_id` ancestry** of protected logs;
- preserve `app_health_events`, permitting only the schema-declared `ON DELETE SET NULL` detachment;
- do not reset sequences;
- do not broaden the operation to reviews or feedback.

### Amendment carried into the validation contract

The recursive retained-ancestor integration test must cover a chain **deeper than one parent**. Recorded as a mandatory fixture in §13 and folded into acceptance criterion 2 (§16). The rationale is recorded with it: a single-level parent test also passes against a non-recursive one-hop join, so it cannot detect the defect the recursive closure exists to prevent. The fixture additionally requires a mid-chain disposable sibling that **is** deleted, proving retention follows ancestry rather than the whole connected component.

### Scope explicitly NOT granted

Approval authorises the design. It does **not** authorise implementation in this session. No Stage 2 code, migration, grant, test or database operation was created, and nothing was committed.

### Files changed by this approval

| File | Change |
|---|---|
| `issues/open/AFLDB-ISSUE-119.md` | `Status` and `Stage 2 gate` header lines; new §5.1 binding obligation table; mandatory multi-level ancestry fixture in §13; acceptance criterion 2 in §16; §17 reworded to a live instruction; §18 unresolved-decision 1 closed; this §19 |
| `IssuesIndex.md` | Row current-state and next-action wording |
| `issues.md` | Open Issues row next action, ledger `Status`, `Validation` and `Follow-up` wording |

### Validation performed

Documentation only, consistent with §18: `git diff --check` clean; renumber and approval edits re-read in place; Markdown table column counts verified in §5.1 and §19. No test, build, typecheck, SQL, database, migration, deployment or production command ran. No database was queried.

### Exact next action

**Superseded 2026-09-01 by §20.7 — done.** Start a **fresh** Stage 2 implementation session and follow §17: derive the migration number per §7 (do **not** assume `080`), then write the `SECURITY DEFINER` retained-closure/delete function and its exact grants, and source-review them before any Server Action or UI exists. The multi-level ancestry test from §13 must be written alongside the migration, not deferred to the UI stage.

Recommended reasoning effort for that session: **XHigh** through the migration and function, dropping to **High** for the Server Action and UI.

## 20. Session record — 2026-09-01 (Stage 2, step 1: migration `081`)

### 20.1 Migration-number re-derivation (§7 obligation discharged)

Method: `git fetch --all --prune`, then every ref enumerated with `git for-each-ref refs/heads refs/remotes` and each ref's `src/db/migrations/` listed with `git ls-tree`. Remote-tracking refs were then checked against a live `git ls-remote --heads origin` so the scan could not silently be a stale mirror.

| Question | Evidence |
|---|---|
| Refs scanned | **46** — 39 local, 7 remote-tracking. |
| Remote freshness | `git ls-remote --heads origin` returns six heads — `main 7a0f592`, `dev 98354a3`, `claude/issue-102 fd6295f`, `claude/issue-108 cdf56e0`, `claude/issue-116 2344ab5`, `fwab/next-16 81840c1` — and each equals its local `refs/remotes/origin/*`. Fetch was a no-op; the refs were already current. |
| Highest number on any ref | **080**, and only on `refs/heads/opus/gridley-corpus` (`6e3b38a`): `080_external_grids.sql`. It is the only file numbered ≥080 on any ref. |
| `main` / `dev` (`7a0f592` / `98354a3`) | 079 = `079_nl_search_log_head_to_head_grain.sql`, as §7 recorded. |
| Competing 079 | `claude/issue-116` and `origin/claude/issue-116` (`2344ab5`) still carry `079_access_code_delete.sql` — a different file at the same number. Unchanged, and not this issue's to fix. |
| Anything at 081 or above | **None**, on any of the 46 refs. |
| Uncommitted allocations | All **34** worktrees checked with `git status --porcelain -- src/db/migrations`, and their `src/db/migrations/` directories listed for on-disk `08x_` files. Exactly one untracked migration exists anywhere: `D:/dev/afldb-issue-086` holds `073_data_overrides.sql` — below the contested band, no bearing on this choice. The only on-disk `080` is Gridley's own committed file. |
| **Assigned** | **`081`** → `src/db/migrations/081_nl_search_telemetry_clear.sql`. |

Contention that survives this step: `claude/issue-116`'s duplicate `079` must still renumber when it merges, and the next free number above all tips is the one taken here. Once `081` is committed on this branch it is allocated under the same branch-local rule §0 applied to Gridley's 118. `082` was the next free migration number as of this 2026-09-01 scan and is **not reserved for anyone**: `claude/issue-116` must re-scan the relevant live refs and worktrees and derive the next free number itself, immediately before renumbering its competing migration — the same §7 obligation discharged above, and for the same reason. `tools/db/migrate.ts` will not catch that collision for them — see 20.4 R4.

### 20.2 What was implemented

One file, `src/db/migrations/081_nl_search_telemetry_clear.sql` (250 lines, untracked, uncommitted, **never executed**). It creates `public.nl_search_telemetry_clear()` and nothing else.

| Element | Implementation |
|---|---|
| Signature | `RETURNS TABLE (deleted_log_rows, retained_log_rows, retained_review_rows, retained_feedback_rows, detached_app_health_links)`, all `bigint` — the exact five counts §9 permits the audit event to record, and no more. Takes no parameters. |
| Security boundary | `LANGUAGE plpgsql`, `VOLATILE`, `SECURITY DEFINER`, `SET search_path = pg_catalog, pg_temp` (:91-92). Every relation reference is `public.`-qualified. No actor check inside the function, per §6. |
| Ownership | `ALTER FUNCTION … OWNER TO afldb_owner` in a guarded `DO` block (:218), placed **before** the grants so the recorded grantor is the intended owner too. Falls back to a `NOTICE` when the role is absent or the running role has no membership in it, following `privileges.sql`'s treatment of the role grant it may not be entitled to make. |
| Grants | `REVOKE ALL ON FUNCTION … FROM PUBLIC` (:238), then `GRANT EXECUTE … TO afldb_auth` inside the role-existence `DO` guard that 046/047/049/052 use (:247). No table `DELETE`, no `TRUNCATE`, no grant to any other role. |
| Locking | `LOCK TABLE` in `SHARE ROW EXCLUSIVE MODE` on `nl_search_review`, `nl_search_feedback`, `app_health_events`, then `nl_search_log` (:115-118) — §7's child-before-parent order exactly. |
| Retained closure | `WITH RECURSIVE` (:130-159). Seeds: every `nl_search_review.search_log_id`, plus every log row whose `client_ref` matches a feedback row. Recursive term: `SELECT l.parent_search_id FROM public.nl_search_log l JOIN retained rt ON rt.id = l.id WHERE l.parent_search_id IS NOT NULL` (:151-154) — one generation per iteration, unbounded depth, `UNION` rather than `UNION ALL` so a revisited id terminates it. |
| Deletion | One statement: `DELETE FROM public.nl_search_log l WHERE NOT EXISTS (SELECT 1 FROM retained rt WHERE rt.id = l.id)` (:161-162). |
| Counts | `GET DIAGNOSTICS v_deleted = ROW_COUNT` (:164); retained figures read from the three tables after the delete; detached links measured as a before/after count of non-NULL `related_search_id` (:126, :168). |

Not touched, as instructed: `tools/maintenance/privileges.sql`, any TypeScript, any test, any Server Action, any UI.

### 20.3 Source review against the runbook

Reviewed against §5.1's binding obligations, §6's authorisation model, §7's deletion strategy and §8's concurrency contract.

| Requirement | Finding |
|---|---|
| Arbitrary-depth ancestry (§5.1, §13, §16.2) | **Met.** The recursive term walks from a retained row to its parent, so depth is unbounded rather than the single hop a plain join gives. Termination is by `UNION` dedup against the accumulated set, not by a depth cap. |
| Sibling / descendant non-retention (§13) | **Met.** Nothing in the closure walks child-ward — no term produces `l.id` from `l.parent_search_id = rt.id`. A disposable child of a retained row, and a disposable sibling hanging off a retained mid-chain ancestor, are therefore both deleted. Retention follows ancestry, not the connected component. |
| Preserve reviews and feedback (§5.1) | **Met by construction.** The migration contains exactly one `DELETE`, and its target is `public.nl_search_log`. Neither durable table is written, and neither gains a `DELETE` grant. Feedback whose deferred log never landed contributes no seed and is untouched. |
| Review FK integrity (`NO ACTION`, 047:105) | **Met.** Every reviewed log id is a closure seed, so no review can be orphaned. |
| Self-FK integrity (`parent_search_id NO ACTION`, 047:66) | **Met.** The closure is upward-closed, so no deleted row is the parent of a retained row; a wholly disposable parent/child set is removed by one statement whose `NO ACTION` check fires at end of statement. |
| `app_health_events` (§5.1, 052:49) | **Met.** No health row is deleted or updated by this function; the only mutation is the FK's own `ON DELETE SET NULL`. |
| Sequences (§5.1) | **Met.** No `ALTER SEQUENCE`, no `RESTART`, no `TRUNCATE` anywhere in the file. |
| Lock mode and order (§7.1, §8) | **Met.** `SHARE ROW EXCLUSIVE` conflicts with `ROW EXCLUSIVE`, so writers block and readers do not; it conflicts with itself, so two clears serialise. Child-before-parent matches the order every application writer already takes — a review, feedback or health writer touches its own table and then reads `nl_search_log` for its FK check — so there is no lock-order cycle to deadlock on. |
| Fixed `search_path` (§6, §13) | **Met, and fail-loud.** `pg_temp` is listed last, so a temp object cannot shadow anything; `public` is deliberately absent, so an unqualified relation name would raise rather than resolve somewhere unintended. |
| Object qualification (§13) | **Met.** Every one of the seven relation references inside the function is `public.`-qualified. |
| No dynamic SQL / no CASCADE (§13) | **Met for the callable function** — its body contains no `EXECUTE` and no `CASCADE`. The file's single `EXECUTE` is a constant `ALTER FUNCTION … OWNER TO afldb_owner` string inside a migration-time `DO` block (:218), with no interpolation and no caller input. |
| Privilege containment (§6, §16.5) | **Met.** A grep of the file returns exactly one `GRANT` (function `EXECUTE` to `afldb_auth`) and one `REVOKE` (`ALL` from `PUBLIC`). `afldb_app`, `afldb_import` and `afldb_backup` hold nothing here except through `PUBLIC`, which is revoked; the default `PUBLIC` execute grant that would otherwise let every role in the cluster run a `SECURITY DEFINER` function is removed at creation time, not later by reconciliation. |
| Definer identity | **Pinned.** Without the ownership block the definer would be whichever role ran the migration — a superuser on an install that migrates as `postgres`, which would be a far wider capability than the one designed. |
| `CREATE` vs `CREATE OR REPLACE` | Deliberate: plain `CREATE FUNCTION`, so a pre-existing function of that name is a loud failure rather than a silent takeover of a security-sensitive name. |

### 20.4 Deviations, risks and blockers

**Deviations from §7's literal wording — behaviour identical, deliberate, and none touching §5.1's obligations:**

- **D1.** §7 step 4 specifies `WHERE id NOT IN retained-set RETURNING id`. Implemented as `NOT EXISTS` and without `RETURNING`. `NOT EXISTS` selects the same rows but is immune to `NOT IN`'s NULL semantics, which would match nothing at all should the set ever acquire one. `RETURNING` was dropped because nothing consumes the ids and §9 forbids recording deleted IDs; `GET DIAGNOSTICS … ROW_COUNT` yields the identical count without materialising a list the audit must not contain.
- **D2.** §7 step 2 lists "count app-health links that will be detached" before the closure is built, which is not literally executable — a predicted detach count depends on the closure it is listed before. Implemented instead as a before/after count of non-NULL `related_search_id` around the `DELETE`. Under the locks nothing else can move that number, so the difference **is** the detachment; it measures what happened rather than predicting it, and avoids a second copy of the closure that could drift from the one governing the `DELETE`.
- **D3.** The retained counts are read from the tables after the `DELETE` rather than derived from the closure, so a wrong closure surfaces as a wrong count instead of being confirmed by its own arithmetic.

**Risks carried forward:**

- **R1. The SQL has never been executed.** **PARTLY CLOSED 2026-09-01 by §23** — migration `081` applied cleanly to `afldb_test`, which proves the file parses and every statement in it runs. It does **not** prove the ownership or `EXECUTE` grant landed (§23.5) and it proves nothing about the function's runtime behaviour, which remains for §22.7 steps 2-4. Original finding: No database, migration, test, build or typecheck command ran this session. Its first execution must be `npm run db:migrate:test` against `afldb_test`; that run is the proof of the `WITH RECURSIVE … DELETE` form, `GET DIAGNOSTICS`, the `RETURNS TABLE` shape and both `DO` blocks. Do not apply to `afldb_dev` or production before the §13 tests pass.
- **R2. `privileges.sql` is not yet reconciled** — **CLOSED 2026-09-01 by §21**, which adds the function section and the targeted DELETE/TRUNCATE revoke described below; it is written but unexecuted. Original finding, retained because §21's design rests on it: Its subtractive `afldb_auth` loop revokes on **relations** only — `relkind IN ('r','p','v','m','f')`, `tools/maintenance/privileges.sql:470-481` — so it will not strip the function `EXECUTE`. But neither will it re-establish it: on a role-after-migration install the guarded `DO` block skips the grant silently and the feature fails closed. The same gap applies to ownership. The §12 `privileges.sql` change should therefore reconcile **both** `EXECUTE` and owner, not `EXECUTE` alone as §12 currently words it.
- **R3. `postgres.js` returns `int8` as a JavaScript string.** All five returned counts are `bigint`, so the query layer must cast `::int` (or coerce in TypeScript) or the audit will record string counts and any arithmetic on them will concatenate silently.
- **R4. Migration-number contention persists.** `tools/db/migrate.ts` keys `afldb_meta.schema_migrations` by **filename** and applies pending files in name order, so it enforces no contiguity — the 080 gap on this branch is harmless — but it also cannot detect a duplicate **number**: two files numbered 079 would both apply. `082` was only the next free migration number as of the 2026-09-01 scan and is **not reserved**: `claude/issue-116` must re-scan the relevant live refs and worktrees and derive the next free number itself, immediately before renumbering its competing migration.
- **R5. The cutoff depends on the caller.** The locks are released at statement end unless the caller holds an explicit transaction open, so §8's `authSql.begin()` wrapper is load-bearing for both the cutoff and the atomic clear+audit, not a stylistic choice.
- **R6. Gridley's `080`** may merge after `081` has been applied somewhere. It applies then, by name, and `081` depends on nothing in it.

**Blockers: none.** Nothing in the schema, privileges model or runner contradicted the runbook.

### 20.5 Validation performed

Static and repository evidence only. `git diff --check` clean (exit 0; the new file is untracked, and a `--no-index` whitespace check of it reports nothing beyond git's expected LF→CRLF notice). No trailing whitespace, no tabs, final newline present, ASCII apart from the em dash in the header line, matching 046/047/049/052. Schema claims re-verified in source before writing: 047:66, 047:105, 049:45-47, 052:49, 050 (both FK indexes, `parent_search_id` partial), `tools/db/migrate.ts:150-192`, `tools/maintenance/privileges.sql:373-390` and `:470-481`.

No test, build, typecheck, SQL, database, migration, deployment or production command ran. No database was queried. Nothing was committed.

### 20.6 Files changed this step

| File | State |
|---|---|
| `src/db/migrations/081_nl_search_telemetry_clear.sql` | **New, untracked.** The function, its ownership, and its two grants. |
| `issues/open/AFLDB-ISSUE-119.md` | Modified: header `Status`, §7 number assignment, §12 filename/state, §15 blocker closure, §17 next action, and this §20. |

`IssuesIndex.md` is **not** updated in this step — the operator scoped persistence to this file — so its next-action line still reads "derive the migration number". It needs syncing before this work is committed.

### 20.7 Exact next action

Still Stage 2, still before any Server Action or UI (§17). In order:

1. ~~Update `tools/maintenance/privileges.sql` to reconcile the function **`EXECUTE` grant and its owner** (R2), keeping the absence of any direct `DELETE`/`TRUNCATE` grant on the NL tables.~~ **Done 2026-09-01 — see §21. Steps 2-4 below stand; §21.8 is the live list.**
2. Write the guarded PostgreSQL integration test from §13, including the **mandatory ancestry fixture deeper than one parent** with a mid-chain disposable sibling that must be deleted (§16.2), plus the unmatched-feedback, app-health-detachment and no-sequence-reset assertions. Rolled-back transactions only, `_test` DSNs only.
3. Only then run the first execution: `npm run db:migrate:test`, followed by the focused integration suite. That is the syntax and semantics proof for everything in 20.4 R1.
4. Sync `IssuesIndex.md`.

Server Action, `session.ts` transaction-aware audit helper, `ClearTelemetryForm.tsx`, `page.tsx`, `docs/search.md` and `CHANGELOG.md` all remain untouched and unstarted, in that order after the above.

## 21. Session record — 2026-09-01 (Stage 2, step 2: privilege reconciliation)

### 21.1 Starting point

Branch `codex/issue-118` at `f7d035b` ("Add ISSUE-119 telemetry clear migration"), clean worktree. Migration `081_nl_search_telemetry_clear.sql` is now tracked and committed, and is still **unexecuted**.

### 21.2 Source review of `privileges.sql` before changing it

| Question | Finding |
|---|---|
| Does the reconciler handle functions at all? | **No.** A case-insensitive search of the whole file for `ON FUNCTION`, `proacl`, `pg_proc`, `ROUTINE` and `EXECUTE ON` returned nothing before this change. The `afldb_auth` subtractive sweep reads `pg_class` filtered to `relkind IN ('r','p','v','m','f')` (`:482`), so it can neither strip nor restore a function ACL in either direction. §20.4 R2's reading is confirmed exactly. |
| Does the file's own stated purpose cover this? | Yes, and more sharply than for any table. Its header names three losses it exists to repair — `pg_restore --no-privileges`, a re-run install script, and `02_add_auth_role.sh` running after the migrations. All three reach migration 081's function, and the first is worse there than anywhere else: a restored function with **no** ACL falls back to PostgreSQL's default of `EXECUTE` to `PUBLIC`. Every other reconciliation in this file repairs a *missing* privilege; skipping this one leaves an *excess* one, on a `SECURITY DEFINER` function. |
| Are the NL table grants already correct? | Yes. The `spec` array states `nl_search_log 'SELECT, INSERT'` (`:391`), `nl_search_review 'SELECT, INSERT, UPDATE'`, `nl_search_feedback 'SELECT, INSERT'`. No widening was needed there and none was made. |
| Is that statement enforceable? | **Only for the absence of a grant, not against drift.** The spec loop is additive — it only ever `GRANT`s — and the subtractive sweep skips every table named in the spec. A `DELETE` on `nl_search_log` granted by hand during an incident therefore survives every run of this file, while a sibling assertion in `tests/integration/privileges.test.ts` (`:330`) tells the operator to "run tools/maintenance/privileges.sql against this database" to fix exactly that class of drift. |
| Is the existing negative contract already tested? | Partly. `tests/integration/privileges.test.ts:334-357` asserts `afldb_auth` holds no `UPDATE`, `DELETE` or `TRUNCATE` on `nl_search_log` or `nl_search_feedback`. `nl_search_review`'s `DELETE`/`TRUNCATE` absence is not asserted there. |
| Migration 081's ownership/grant block | Re-read at `081:196-249`: guarded `ALTER FUNCTION … OWNER TO afldb_owner` with an `insufficient_privilege` NOTICE, unconditional `REVOKE ALL … FROM PUBLIC`, then a role-guarded `GRANT EXECUTE … TO afldb_auth`. The reconciler now restates the same three facts in the same order, so the two files cannot be read as intending different states. |

### 21.3 What changed

`tools/maintenance/privileges.sql` only — **105 inserted lines, zero deletions**, in two hunks.

1. **Header note** (6 lines) beside the existing `afldb_auth` paragraph, recording that one function is reconciled too and why its loss is a widening rather than a gap.
2. **New section** between the `afldb_auth` and `afldb_backup` sections (`:516` onward), in two `DO` blocks:

**Block one — the function.** Guarded on `to_regprocedure('public.nl_search_telemetry_clear()')`, then ownership and ACL as separate protected units:

| Condition | Behaviour |
|---|---|
| Function absent (database below 081) | NOTICE naming `npm run db:migrate`; section skipped |
| `afldb_owner` absent | NOTICE; ownership left as found; **ACL still reconciled** |
| `ALTER … OWNER` refused | NOTICE naming the current owner; **ACL still reconciled** |
| `afldb_auth` absent | `REVOKE ALL … FROM PUBLIC` still applied; NOTICE |
| `REVOKE`/`GRANT` refused | NOTICE naming the owner; the script continues |
| Roles present, run as owner or superuser | owner `afldb_owner`, `PUBLIC` revoked, `afldb_auth` granted `EXECUTE` |

**Block two — the negative half.** `REVOKE DELETE, TRUNCATE … FROM afldb_auth` on `nl_search_log`, `nl_search_review` and `nl_search_feedback`, each guarded by `to_regclass`, so the reconciler can now actually remove the one privilege this design must never grant directly — which is what the test message at `:330` already promises an operator.

### 21.4 Source review of the change itself

**One defect was found and fixed during review, before anything was recorded.**

- **Rolled-back fail-closed revoke.** The first draft wrapped ownership, `REVOKE` and `GRANT` in a single `BEGIN … EXCEPTION` block. A PL/pgSQL exception rolls back its subtransaction, so a refused `ALTER … OWNER` would have discarded an already-successful `REVOKE … FROM PUBLIC`, leaving `PUBLIC` holding `EXECUTE` on a `SECURITY DEFINER` function — precisely the state the section exists to prevent, and reached by the failure path most likely to occur. It is reachable whenever the function's owner is a role that is not a member of `afldb_owner`: such a role may not rename the owner but may certainly revoke. Ownership and ACL are now attempted as separate protected units, and the reason is recorded in the code so it is not "simplified" back.

Verified after the fix:

- **Fail-closed ordering** — `REVOKE` precedes `GRANT`, and runs even when `afldb_auth` does not exist.
- **Owner precedes grants**, so `afldb_owner` is the recorded grantor, matching migration 081.
- **Idempotent** — every statement is a no-op against a database already in the intended state; the section may be run repeatedly, at any point in a build.
- **No widening** — the section contains exactly one `GRANT` (function `EXECUTE` to `afldb_auth`) and two `REVOKE`s (function `ALL` from `PUBLIC`; table `DELETE, TRUNCATE` from `afldb_auth`). `nl_search_review` and `nl_search_feedback` gain nothing, and no role other than `afldb_auth` is named.
- **House idioms matched** — `to_regprocedure` existence guard as at `:498`; `FOREACH … IN ARRAY ARRAY[…]` as at `:64`; early `RETURN` with a NOTICE for an absent role as at `:636`; `EXCEPTION WHEN insufficient_privilege → RAISE NOTICE` as at `:647`; `EXECUTE format(… %I …)` for identifiers.
- **`REVOKE ALL` on a function is exactly `REVOKE EXECUTE`** — `EXECUTE` is a function's only privilege — and the wording deliberately mirrors migration 081's.

### 21.5 Deviations and scope

- **Deliberately narrow.** The `DELETE`/`TRUNCATE` revoke covers the three NL tables only. Making the whole `spec` array exact — revoking everything unlisted from every named table — would close a real general weakness in the reconciler, but it changes the contract for roughly thirty tables and belongs to its own issue. Recorded here, not fixed.
- **`UPDATE` deliberately not revoked** on `nl_search_log` / `nl_search_feedback`. Their append-only contract belongs to migrations 046/049, not to ISSUE-119, and `tests/integration/privileges.test.ts:334-357` already asserts it.
- Nothing else in the file was touched: no change to the `spec` array, the sequence handling, the registries, the schema-level grants, or any other role.

### 21.6 Blockers

**None.**

### 21.7 Validation performed

Static review only. `git diff --check` clean; the `privileges.sql` diff is a pure insertion (105 added, 0 removed) confined to two hunks; line endings unchanged. No test, build, typecheck, SQL, database, migration, deployment or production command ran, and no database was queried. **Neither migration 081 nor this reconciliation has ever been executed anywhere.**

### 21.8 Exact next action

1. ~~Write the guarded PostgreSQL integration test from §13 — the mandatory ancestry fixture **deeper than one parent** with a mid-chain disposable sibling that must be deleted, plus unmatched feedback, app-health detachment, sequence non-reset, restricted-role success and the rollback/atomicity cases. `_test` DSNs only; success-path destructive assertions inside an always-rolled-back transaction.~~ **Done 2026-09-01 — see §22.**
2. ~~Extend `tests/integration/privileges.test.ts` with the function assertions §13 requires: owner `afldb_owner`, `SECURITY DEFINER`, fixed `search_path`, schema qualification, exact ACL (`afldb_auth` only, `PUBLIC` absent, `afldb_app`/`afldb_import`/`afldb_backup` unable to execute), and no direct `DELETE`/`TRUNCATE` for `afldb_auth` on the three NL tables after reconciliation.~~ **Done 2026-09-01 — see §22. §22.7 is the live list.**
3. Then, and only then, the first execution of any of this SQL: `npm run db:migrate:test`, then the privilege reconciliation against `afldb_test`, then the focused suites. Nothing before that point proves either file even parses.
4. The query layer, transaction-aware audit helper, Server Action, UI, `docs/search.md` and `CHANGELOG.md` remain unstarted, in that order after the above.

## 22. Session record — 2026-09-01 (Stage 2, step 3: guarded integration tests)

### 22.1 Starting point

Branch `codex/issue-118` at `2b6c2b2` ("Reconcile ISSUE-119 telemetry clear privileges"), clean worktree. Migration `081` and the `privileges.sql` reconciliation are committed and still **unexecuted**.

### 22.2 Source review before writing tests

| Question | Finding |
|---|---|
| `_test` DSN safety pattern | `tests/setup.ts` allowlists `_test`-suffixed databases and redirects `DATABASE_URL`; `tests/integration/guard.ts` makes the variable mandatory for integration files; `tests/integration/import-role-parity.ts` is the house pattern for a second restricted DSN — static endpoint/database/`_test` parity, then a runtime `current_user`/`current_database()` identity check, an explicit skip message when unset, and **no owner fallback ever**. |
| Rolled-back destructive assertions | `tests/integration/database.test.ts` establishes the `class Rollback extends Error` idiom: run inside `sql.begin`, throw `Rollback` after the assertions, `expect(...).rejects.toThrow(...)`. Reused verbatim. |
| Blocking proof | `tests/integration/player-link-concurrency.test.ts` proves lock waits with dedicated `postgres(url, { max: 1 })` connections and an observer polling `pg_blocking_pids()` — no sleep-based inference. Reused. |
| Migration 081 re-review from the test perspective | One candidate defect examined and cleared: `RETURNS TABLE` creates OUT variables named `deleted_log_rows` … `detached_app_health_links`, which would make any body query referencing a same-named column ambiguous — no body query does. Recursive term confirmed upward-only; `GET DIAGNOSTICS` reads the top-level `DELETE`. **No defect; the migration is untouched.** |
| Fixture schema facts | `nl_search_log` requires only `question`/`outcome` (046); `parent_search_id`, `client_ref`, `run_tag` nullable (047/049/051); `nl_search_review.search_log_id NOT NULL UNIQUE` (047); `nl_search_feedback.client_ref NOT NULL UNIQUE` + `verdict` (049); `app_health_events.event_type` from a fixed list, `related_search_id` nullable `ON DELETE SET NULL` (052); `auth_audit_log.action NOT NULL` (023). |

### 22.3 What was implemented

Three files; no SQL, migration or runtime code changed.

**`tests/integration/nl-search-telemetry-clear.test.ts` (new).** Guarded by `./guard`; fails loudly (not skips) when `nl_search_telemetry_clear()` is absent, naming `npm run db:migrate:test`. Every destructive path is inside an always-rolled-back transaction.

| Suite | Coverage |
|---|---|
| Retention: ancestry | The mandatory §13/§16.2 fixture: reviewed leaf → parent → grandparent → great-grandparent, only the leaf protected directly; all four survive. A disposable **sibling off the mid-chain grandparent** and a disposable **child of the leaf** are both deleted, proving retention follows ancestry, not the connected component. Review row byte-checked afterwards; global zero-orphan review assertion. |
| Retention: feedback | Feedback-matched log plus its otherwise-disposable parent survive; matched and **orphaned** feedback rows byte-checked; global feedback/review counts unchanged and equal to the function's returned retained counts; plain and synthetic (`run_tag`) disposables deleted. |
| App health | Three seeded rows (linked-to-disposable, linked-to-protected, unlinked): none deleted; only the disposable link becomes `NULL`; the protected link intact; `detached_app_health_links ≥ 1`. |
| Unrelated + sequences | Pre-seeded `auth_audit_log` sentinel and `auth_audit_log`/`auth_users`/`players`/`matches` counts unchanged; a post-clear insert takes an id above the pre-clear maximum, proving no identity restart. |
| Atomicity | A clear plus its `SET NULL` detachments inside an aborted transaction leave log count and non-NULL health-link count exactly at baseline. |
| Cutoff/concurrency | Transaction A holds the function's locks; writer B on a second backend provably blocks (`pg_blocking_pids`), then proceeds after A ends. Both roll back. |
| Restricted role | Skipped explicitly without `AFLDB_TEST_AUTH_DATABASE_URL` (static endpoint/database/`_test` parity at module load; runtime identity must be `afldb_auth` on the same `_test` database). As `afldb_auth`: seeds its own disposable row, EXECUTEs the function, sees the row gone (rolled back); direct `DELETE` refused with SQLSTATE `42501` on all three NL tables; `TRUNCATE` refused likewise, each probe in its own rolled-back transaction so even a regressed grant could not destroy state. |

**`tests/integration/privileges.test.ts` (extended).** New describe `nl_search_telemetry_clear() is the only NL deletion capability`: owner `afldb_owner`, `SECURITY DEFINER`, `VOLATILE`, zero parameters, `proconfig` exactly `search_path=pg_catalog, pg_temp`; `has_function_privilege` true for `afldb_auth`, false for `afldb_app`/`afldb_import` (and `afldb_backup` when the role exists); the `aclexplode` grantee list asserted **outright** as `{afldb_auth, afldb_owner}` because a NULL function ACL — the `pg_restore --no-privileges` state §21.2 identified — is EXECUTE-to-PUBLIC yet satisfies every boolean check; `prosrc` (comment lines stripped) contains no `EXECUTE`, `CASCADE`, `TRUNCATE` or unqualified NL/app-health relation reference; `afldb_auth` holds no `DELETE`/`TRUNCATE` on any of the three NL tables — closing the `nl_search_review` gap §21.2 noted.

**`.env.example`.** Guarded `AFLDB_TEST_AUTH_DATABASE_URL` documented beside `AFLDB_TEST_IMPORT_DATABASE_URL` with the same never-fallback wording.

### 22.4 Source review of the tests themselves

**One defect was found and fixed during review, before anything was recorded.** The concurrency test's fail-fast guards (`Promise.race` against the transaction promise) created rejection chains that also reject after the race is already won — an unhandled rejection that can fail the suite spuriously. Both guards are now explicitly marked handled.

### 22.5 Deviations

None touches the §5.1 obligations.

- **D1.** The `AFLDB_TEST_AUTH_DATABASE_URL` static parity validation lives in the test file, not in `tests/setup.ts`/`guard.ts` where the import-parity DSN's does. It has exactly one consumer today and nothing can touch the DSN before the check runs; wiring into the shared guard is the right move if/when the Server Action tests share the credential.
- **D2.** §13's cutoff case says "commit A, then prove B survives". Implemented with A **rolled back**: B's block, release and successful insert are all proven, and B's row is definitionally post-`DELETE` because the delete ran before B unblocked — while the success-path-rolled-back rule stays unbroken and no real `afldb_test` telemetry is destroyed.
- **D3.** The "no success audit on failure" half of §13 atomicity is deferred to the Server Action stage: the function records no audit (§9 puts that in the caller's transaction), so there is nothing to assert yet. The database half — deletes and `SET NULL` all roll back — is covered.
- **D4.** §13's "start a review/feedback writer before the clear lock where practical" is not implemented separately: the retained-closure fixtures already prove a committed durable fact protects its log, and the cutoff test proves the lock semantics. Recorded as the "where practical" judgement, revisitable if operator evidence demands it.

### 22.6 Validation performed, risks, blockers

`git diff --check` clean. Static review only: **no test, typecheck, build, SQL, database, migration, deployment or production command ran; none of the three SQL/test artefacts has ever been executed** (20.4 R1 still open). Risks: the suite's first run is also the first parse/execution proof of migration 081 and the reconciliation; the privilege ACL assertions require the migration (with roles present) or `npm run db:privileges:test` to have run against `afldb_test`; the restricted describe needs an `afldb_auth` password on the test cluster or it skips. Blockers: **none.**

### 22.7 Exact next action

The first execution of any ISSUE-119 SQL, one command at a time, operator-run:

1. ~~`npm run db:migrate:test`~~ **Done 2026-09-01 — see §23. Steps 2-4 stand; §23.8 is the live list.**
2. `npm run db:privileges:test`
3. `npx vitest run tests/integration/nl-search-telemetry-clear.test.ts` (with `AFLDB_TEST_DATABASE_URL`, and `AFLDB_TEST_AUTH_DATABASE_URL` set so the restricted describe runs rather than skips)
4. `npx vitest run tests/integration/privileges.test.ts`

Analyse failures against §20.4/§22.6 before touching any SQL. Then the query layer, transaction-aware audit helper, Server Action, UI, `docs/search.md` and `CHANGELOG.md`, in that order.

## 23. Session record — 2026-09-01 (Stage 2, step 4: first execution of migration `081`)

### 23.1 Starting point

Branch `codex/issue-118` at `2e5ae70` ("Add ISSUE-119 telemetry clear integration tests"), **clean worktree** — all three confirmed with read-only Git metadata commands before anything else ran. Scope for this step was one command only: the first execution of `081_nl_search_telemetry_clear.sql` against `afldb_test`. No privilege script, no test suite, no Server Action, no UI.

### 23.2 Test-database safety evidence

Established **before** any command touched a database. No password, DSN literal or credential was printed, echoed or written anywhere; every inspection below extracted only structure (role, host, port, database name) with the password field replaced.

| Question | Evidence |
|---|---|
| What does the runner use for `--target test`? | `tools/db/migrate.ts:71` — `test: 'AFLDB_TEST_DATABASE_URL'`. `package.json:14` runs `tsx tools/db/migrate.ts --target test`. An unset variable is a hard refusal at `:125-128`, and a `--target`/`AFLDB_MIGRATE_TARGET` disagreement is refused at `:103-109`. |
| Where does that variable come from here? | `loadEnv()` (`:40-56`) reads **`<PROJECT_ROOT>/.env` only**, and `PROJECT_ROOT` is the worktree (`:29`). The main checkout's `.env` is not consulted. An already-exported variable wins over the file. |
| Does the runner itself refuse a non-`_test` database? | **No.** `tests/setup.ts:48` enforces the `/_test$/` rule for **vitest**, not for the migration runner. `migrate.ts` migrates whatever the named target's DSN points at. The DSN proof below is therefore the only safeguard at this layer, which is why it was established first rather than assumed. |
| Repository-approved shape | `.env.example:60` — `AFLDB_TEST_DATABASE_URL=postgresql://afldb_owner:CHANGE_ME@localhost:5432/afldb_test`. `afldb_owner` is the **intended** role for this DSN: migrations create objects and `081` must `ALTER FUNCTION … OWNER TO afldb_owner`. |
| Actual `AFLDB_TEST_DATABASE_URL` (worktree `.env`, re-verified immediately before the run) | `user=afldb_owner  host=127.0.0.1  port=5432  db=afldb_test` — database name ends in `_test`; **not** `afldb_dev`, not a production endpoint. Matches `.env.example:60` exactly. |
| Actual `AFLDB_TEST_AUTH_DATABASE_URL` | **NOT DEFINED** — absent from the process environment, from the User and Machine environment scopes, and from the worktree `.env`. |
| Is that absence safe? | **Yes, and it is the safe state.** `.env.example:68-73` documents it as optional; `tests/integration/nl-search-telemetry-clear.test.ts` skips its restricted describe explicitly when it is unset and never falls back to the owner credential (§22.3). Nothing was substituted for it: no `afldb_dev`, production or owner credential was placed in that variable, and the migration runner does not read it. |
| Was any other DSN in scope? | No. `AFLDB_OWNER_DATABASE_URL`, `AFLDB_PROD_DATABASE_URL` and `DATABASE_URL` were confirmed unset in the process environment; `--target test` could not have resolved to any of them regardless. |
| Was the endpoint live? | A TCP connect to `127.0.0.1:5432` succeeded before the run, so a refusal would have been a genuine result rather than an unreachable host. |

### 23.3 Environment blockers found and resolved

Both were worktree-provisioning gaps, not repository defects. Neither is a tracked-issue candidate; both are recorded because they will recur in every fresh AFLDB worktree.

- **B1 — no `.env` in this worktree.** `D:\dev\afldb-issue-118\.env` did not exist, so `loadEnv()` returned silently and the run would have aborted at `migrate.ts:125-128` with `ERROR: AFLDB_TEST_DATABASE_URL is not set (target 'test')`. The main checkout `D:\dev\afldb` has one; a Git worktree does not inherit it because `.env` is untracked and gitignored (`.gitignore:24`). **Resolved by the operator**, who provisioned the worktree `.env`; the DSNs were then re-verified from that file, and the §23.2 values are the re-verified ones.
- **B2 — no `node_modules` in this worktree.** The first invocation failed with `'tsx' is not recognized`. Dependencies had never been installed here. **Resolved by the operator** with `npm ci`, which installs the committed `package-lock.json` exactly and does not rewrite it.

Neither blocker was worked around, and no substitute DSN or alternative runner was used.

### 23.4 The command and its exact result

Exactly one state-changing command ran this session, the one authorised:

```text
> npm run db:migrate:test
> tsx tools/db/migrate.ts --target test

AFLDB migrations -> test (afldb_owner@127.0.0.1:5432/afldb_test)
  80 migration file(s), 80 already applied

  applying 081_nl_search_telemetry_clear.sql ... ok (240 ms)

Applied 1 migration(s).
```

Applied migration state after the run: **81 of 81**, with `081_nl_search_telemetry_clear.sql` the only migration applied in this run and the only one that was pending. The runner's own redacted target line independently confirms the database that was altered: `afldb_owner@127.0.0.1:5432/afldb_test`. No failure, no rollback, no drift refusal — the checksum guard at `:182-190` passed for all 80 previously applied files, so nothing already applied had been edited.

### 23.5 What this proves — and what it does not

**Proved.** The file parses and every statement in it executes. `CREATE FUNCTION public.nl_search_telemetry_clear()` was accepted with its `RETURNS TABLE` shape, `WITH RECURSIVE` closure, `GET DIAGNOSTICS`, `SHARE ROW EXCLUSIVE` lock list and `SET search_path` — the syntax proof §20.4 R1 demanded. Both migration-time `DO` blocks ran without raising. The unconditional `REVOKE ALL ON FUNCTION … FROM PUBLIC` executed without error, since a failure there would have aborted the whole migration (`migrate.ts:212-218` wraps each file in a transaction). No pre-existing function of that name blocked the plain `CREATE` (§20.3).

**Not proved, and specifically not to be assumed.** `migrate.ts:159` constructs the client with `onnotice: () => {}`, so **every `NOTICE` this migration can raise was silently discarded**. Both of the file's guarded blocks degrade to a `NOTICE`:

- `ALTER FUNCTION … OWNER TO afldb_owner` falls back to a `NOTICE` when `afldb_owner` is absent or the running role lacks membership in it — so the function's **actual owner is unverified**, and with it the definer identity the whole security model rests on;
- `GRANT EXECUTE … TO afldb_auth` sits inside a role-existence guard that emits a `NOTICE` and skips when the role is absent — so **whether `afldb_auth` can execute the function is unverified**, and the feature would fail closed rather than loudly if it did not land.

A clean apply therefore says nothing about the ACL or the owner. Those are exactly what `npm run db:privileges:test` and the new capability describe in `tests/integration/privileges.test.ts` assert (§21, §22.3), which is why they are the next two steps and not optional.

Also unproved: every runtime behaviour of the function. It has never been **called**. The retained closure, arbitrary-depth ancestry, sibling non-retention, the five counts, the lock cutoff, app-health detachment and sequence non-reset all remain unexecuted claims until `tests/integration/nl-search-telemetry-clear.test.ts` runs.

### 23.6 Consequences, deviations and risks

- **`081` is now immutable on `afldb_test`.** Its checksum is recorded in `afldb_meta.schema_migrations`, and `migrate.ts:182-190` refuses to run once an applied file has been edited. Any repair to the function must be a **new** migration, or the test database must be rebuilt — the SQL file must not be edited in place. This is the practical cost of the first execution and applies from now on.
- **`afldb_test` is deliberately mid-sequence.** It holds the function while the `privileges.sql` reconciliation has not run. Harmless: no query layer, Server Action or UI can call it, and no other consumer exists.
- **Deviation from the literal instruction, operator-authorised.** Two commands beyond the single authorised one were needed to reach it; both were put to the operator and both were performed by the operator (`.env` provisioning, `npm ci`). Claude executed only `npm run db:migrate:test` plus read-only inspections (env-variable structure, file presence, a TCP reachability check, Git metadata). No privilege script, test, build, typecheck, `afldb_dev`, production or deployment command ran, and no SQL was issued outside the runner.
- **`AFLDB_TEST_AUTH_DATABASE_URL` remains undefined**, so §22.7 step 3 will *skip* its restricted describe rather than run it. Setting it requires an `afldb_auth` password on the test cluster. Until it is set, the restricted-role half of acceptance criterion 5 and 10 is unevidenced — a skip is not a pass.
- Risks **R3** (`postgres.js` returns the five `bigint` counts as strings), **R4** (migration-number contention for `claude/issue-116`), **R5** (the caller's transaction is load-bearing for the cutoff) and **R6** (Gridley's `080` merging later) are unchanged by this step.

**Blockers: none outstanding.** B1 and B2 are resolved.

### 23.7 Files changed this step

| File | State |
|---|---|
| `issues/open/AFLDB-ISSUE-119.md` | Modified: header `Status`, §20.4 R1 partial closure, §22.7 step 1 struck, and this §23. |
| `IssuesIndex.md` | Modified: current-state and next-action wording only. |
| `issues.md` | Modified: Open Issues next action, ledger `Status`, `Validation` and `Follow-up`. |

No source, SQL, migration, test, `CHANGELOG.md` or configuration file was changed — `081_nl_search_telemetry_clear.sql` is byte-identical to the committed version, as the runner's checksum acceptance independently confirms. The worktree `.env` is untracked and gitignored and is not a repository change. **Nothing was committed.**

### 23.8 Exact next action

Operator-run, one command at a time, analysing each result before the next:

1. `npm run db:privileges:test` — reconciles the function's owner, its `PUBLIC` revoke and its single `afldb_auth` `EXECUTE` against `afldb_test`. This is the first execution of the §21 reconciliation, and given §23.5 it is also the step that establishes the owner/ACL state the migration's suppressed `NOTICE`s left unknown.
2. `npx vitest run tests/integration/privileges.test.ts` — the catalogue assertions that *prove* that state, rather than assuming the reconciliation worked.
3. `npx vitest run tests/integration/nl-search-telemetry-clear.test.ts` — the first execution of the function itself. Set `AFLDB_TEST_AUTH_DATABASE_URL` (same `_test` database and endpoint, role `afldb_auth`, never the owner credential) or the restricted describe skips.
4. Only after that evidence passes: the query layer (casting the five `bigint` counts per R3), the transaction-aware audit helper, the Server Action, the UI, `docs/search.md` and `CHANGELOG.md`, in that order.

Steps 2 and 3 are ordered privileges-first here, unlike §22.7, because the telemetry-clear suite's restricted describe depends on the `EXECUTE` grant that step 1 reconciles.
