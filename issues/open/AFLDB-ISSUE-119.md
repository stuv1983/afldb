# AFLDB-ISSUE-119 — Super Admin can clear NL search telemetry

- **Status:** Approved — Stage 1 complete; §5/§6 boundary approved by the operator 2026-09-01; Stage 2 authorised but not started
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

Add a forward migration named `<NNN>_nl_search_telemetry_clear.sql`. **Do not hardcode 080.** `079_nl_search_log_head_to_head_grain.sql` is the highest migration on `main`, but `080_external_grids.sql` is already committed on `opus/gridley-corpus`, and `claude/issue-116` carries a competing `079_access_code_delete.sql` that must itself be renumbered on merge. Stage 2 must re-scan every live branch tip and take the next number above all of them — **currently `081`** — then re-verify immediately before writing the file. Never edit 046–055 or 079.

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
| `src/db/migrations/<NNN>_nl_search_telemetry_clear.sql` (number assigned per §7; not 080) | Restricted function, locks, retained closure, selective delete and exact grants. |
| `tools/maintenance/privileges.sql` | Reconcile only function EXECUTE; retain no direct DELETE/TRUNCATE. |
| `src/db/queries/nl-search-log.ts` | Typed function invocation/result, or a new narrowly named maintenance module if clearer. |
| `src/lib/auth/session.ts` | Transaction-aware audit helper preserving existing callers. |
| `src/app/admin/nl-search/actions.ts` | Guard, server phrase check, atomic clear+audit, revalidation and result state. |
| `src/app/admin/nl-search/ClearTelemetryForm.tsx` | Typed confirmation, cancel/pending/result UI. |
| `src/app/admin/nl-search/page.tsx` | Render control and qualify current absolute read-only/append-only copy. |
| `.env.example` | Guarded `AFLDB_TEST_AUTH_DATABASE_URL`; same `_test` DB, never fallback. |
| `tests/admin-nl-search-actions.test.ts` | Server Action auth/confirmation/audit/revalidation tests. |
| `tests/integration/nl-search-telemetry-clear.test.ts` | Rolled-back safety, atomicity, FK, concurrency and restricted-role tests. |
| `tests/integration/privileges.test.ts` | Exact function and no-widening catalogue assertions. |
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
- **Migration number is no longer fixed.** `080` belongs to Gridley; Stage 2 must re-derive the next free migration number per §7.
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

**Approval is granted (§5.1, 2026-09-01); this is now the live instruction.** Start a fresh implementation session and create the migration first, taking its number per §7 rather than assuming 080. Implement and source-review the fixed retained-closure/delete function and exact grants before adding any Server Action or UI. Do not run or expose the action until migration, restricted-role and rollback tests are written.

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

Start a **fresh** Stage 2 implementation session and follow §17: derive the migration number per §7 (do **not** assume `080`), then write the `SECURITY DEFINER` retained-closure/delete function and its exact grants, and source-review them before any Server Action or UI exists. The multi-level ancestry test from §13 must be written alongside the migration, not deferred to the UI stage.

Recommended reasoning effort for that session: **XHigh** through the migration and function, dropping to **High** for the Server Action and UI.
