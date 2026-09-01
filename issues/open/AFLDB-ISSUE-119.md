# AFLDB-ISSUE-119 — Super Admin can clear NL search telemetry

- **Status:** In progress — the Stage 2 **database layer is now fully validated end to end** (§25). Migration `081` (§20) is applied to `afldb_test` (§23), the `privileges.sql` reconciliation (§21) has run against it, `tests/integration/privileges.test.ts` passes 34/34 (§24), and `tests/integration/nl-search-telemetry-clear.test.ts` now passes **9/9 with 0 skipped** — the clear function has been executed for the first time. `AFLDB_TEST_AUTH_DATABASE_URL` is established (§25.2), so the restricted describe **ran rather than skipped**: `afldb_auth` successfully invokes the function while its direct `DELETE`/`TRUNCATE` are refused live with SQLSTATE `42501`. Acceptance criterion 5 is fully evidenced at the database layer. The **query layer now exists and is validated** (§26, §27): `src/db/queries/nl-search-telemetry-clear.ts` wraps the function on a required transaction handle and converts all five `bigint` counts through a rejecting `toCount()`. `npx vitest run tests/nl-search-log.test.ts` passes **16/16**, of which the `clearNlSearchTelemetry count boundary` describe is **11/11**, and `npm run typecheck` passes (final output `Types generated successfully`). **Risk R3 is therefore evidenced at the typed query boundary**: the driver's `bigint`/string counts are explicitly converted, or rejected, before they can enter the application result type or the §9 audit contract. The helper nonetheless still has **no production caller** — it is reachable from nothing but its own tests. **Transaction-aware audit helper, Server Action and UI not started** — criteria 3, 4, 6 and 9 remain open
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
- ~~**Open operator action:** branch `codex/issue-118` and worktree `D:\dev\afldb-issue-118` still carry the old number.~~ **CLOSED 2026-09-01** — both renamed to `codex/issue-119` / `D:\dev\afldb-issue-119` (see §24.1).
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

- **R1. The SQL has never been executed.** **PARTLY CLOSED 2026-09-01 by §23**, then **FURTHER CLOSED the same day by §24** — the owner and `EXECUTE` grant that §23.5 left unknown are now reconciled and catalogue-proven. What remains open is narrower than the original finding but is the substantive half: **the function has still never been called**, so every runtime claim (retained closure, arbitrary-depth ancestry, sibling non-retention, the five counts, lock cutoff, app-health detachment, sequence non-reset) is unevidenced until `tests/integration/nl-search-telemetry-clear.test.ts` runs — §24.7 step 2. Original finding: No database, migration, test, build or typecheck command ran this session. Its first execution must be `npm run db:migrate:test` against `afldb_test`; that run is the proof of the `WITH RECURSIVE … DELETE` form, `GET DIAGNOSTICS`, the `RETURNS TABLE` shape and both `DO` blocks. Do not apply to `afldb_dev` or production before the §13 tests pass.
- **R2. `privileges.sql` is not yet reconciled** — **CLOSED 2026-09-01 by §21**, which adds the function section and the targeted DELETE/TRUNCATE revoke described below; **executed and proven against `afldb_test` the same day (§24)**. Original finding, retained because §21's design rests on it: Its subtractive `afldb_auth` loop revokes on **relations** only — `relkind IN ('r','p','v','m','f')`, `tools/maintenance/privileges.sql:470-481` — so it will not strip the function `EXECUTE`. But neither will it re-establish it: on a role-after-migration install the guarded `DO` block skips the grant silently and the feature fails closed. The same gap applies to ownership. The §12 `privileges.sql` change should therefore reconcile **both** `EXECUTE` and owner, not `EXECUTE` alone as §12 currently words it.
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

**Steps 1 and 2 are DONE 2026-09-01 — see §24; §24.7 is the live list.** Operator-run, one command at a time, analysing each result before the next:

1. ~~`npm run db:privileges:test`~~ **Done — §24.3.** Reconciles the function's owner, its `PUBLIC` revoke and its single `afldb_auth` `EXECUTE` against `afldb_test`. This is the first execution of the §21 reconciliation, and given §23.5 it is also the step that establishes the owner/ACL state the migration's suppressed `NOTICE`s left unknown.
2. ~~`npx vitest run tests/integration/privileges.test.ts`~~ **Done — §24.4.** The catalogue assertions that *prove* that state, rather than assuming the reconciliation worked.
3. `npx vitest run tests/integration/nl-search-telemetry-clear.test.ts` — the first execution of the function itself. Set `AFLDB_TEST_AUTH_DATABASE_URL` (same `_test` database and endpoint, role `afldb_auth`, never the owner credential) or the restricted describe skips.
4. Only after that evidence passes: the query layer (casting the five `bigint` counts per R3), the transaction-aware audit helper, the Server Action, the UI, `docs/search.md` and `CHANGELOG.md`, in that order.

Steps 2 and 3 are ordered privileges-first here, unlike §22.7, because the telemetry-clear suite's restricted describe depends on the `EXECUTE` grant that step 1 reconciles.

## 24. Session record — 2026-09-01 (Stage 2, step 5: privilege reconciliation executed and proven)

### 24.1 Starting point

Branch `codex/issue-119` at `2f025e0` ("Record ISSUE-119 migration validation"), clean worktree — confirmed with read-only Git metadata before anything else. Migration `081` was applied to `afldb_test` (§23) with its owner and ACL left unverified by the runner's suppressed `NOTICE`s (§23.5). This step ran §23.8 steps 1 and 2 and nothing else.

Note: the branch and worktree have since been renamed to `codex/issue-119` / `D:\dev\afldb-issue-119`, discharging the operator action carried in §15 and §18.3. §21.1, §22.1 and §23.1 record the former `codex/issue-118` name and are left as written, being accurate at the time.

### 24.2 Evidentiary basis for this section

Both commands were **operator-run and their results operator-reported**; Claude executed no command in this step and observed no raw terminal output. What is recorded below is therefore the operator's report plus the assertions that report necessarily satisfied, established by reading `tests/integration/privileges.test.ts:474-618` in source. The distinction matters because §24.5's claims are derived from what the passing tests assert, not from output Claude inspected.

### 24.3 `npm run db:privileges:test` — succeeded

The first execution of the §21 reconciliation anywhere. It **succeeded**, and raised the `NOTICE` confirming the two facts the migration's suppressed notices had left unknown:

- `EXECUTE` on `public.nl_search_telemetry_clear()` **revoked from `PUBLIC`**;
- `EXECUTE` **granted to `afldb_auth`**.

That the grant landed rather than being skipped also establishes that `afldb_auth` exists on the test cluster — §21.3's "`afldb_auth` absent" branch would have emitted the revoke-only NOTICE instead. The reconciliation is idempotent (§21.4) and may be re-run at any point.

### 24.4 `npx vitest run tests/integration/privileges.test.ts` — 34/34 passed

**34 passed, 0 failed.** That count is the whole file; four of those tests are the ISSUE-119 capability describe added in §22.3 (`:486-618`), and the suite's `beforeAll` (`:490-501`) fails loudly rather than skipping when the function is absent, so a green run also proves `public.nl_search_telemetry_clear()` is present in `afldb_test`.

The remaining 30 are the pre-existing role-confinement suites, so the run additionally evidences that the §21 reconciliation **widened nothing else** — no other role's boundary regressed while the function section was added.

### 24.5 Exact security properties now proven

Each is asserted against the **applied catalogue** (`pg_proc`, `aclexplode`, `has_function_privilege`, `has_table_privilege`), not against the migration text — so these are properties of the live `afldb_test` database, not of the SQL file.

| Property | Proven by | Why it is load-bearing |
|---|---|---|
| Owner is `afldb_owner` | `pg_get_userbyid(proowner)` (`:507`, `:519`) | **The definer identity is the security boundary.** `SECURITY DEFINER` executes as the owner; a function left owned by the migrating superuser would be a far wider capability than §6 designs. This is the single fact §23.5 flagged as unverified and the whole model rests on. |
| `SECURITY DEFINER` | `prosecdef = true` (`:508`, `:520`) | The mechanism by which `afldb_auth` gets a capability it holds no direct grant for. |
| `VOLATILE` | `provolatile = 'v'` (`:509`, `:521`) | A mutating function must not be marked stable/immutable and become subject to inlining or caching. |
| Zero parameters | `pronargs = 0` (`:511`, `:526`) | **There is no input to subvert** — no predicate, mode or flag through which a caller could widen what is deleted. |
| `search_path` pinned to exactly `pg_catalog, pg_temp` | `proconfig` equality (`:510`, `:524`) | `pg_temp` last so a temp object shadows nothing; `public` deliberately absent so an unqualified relation name fails loudly instead of resolving somewhere unintended. |
| ACL is exactly `{afldb_auth EXECUTE, afldb_owner EXECUTE}` | `aclexplode(proacl)` asserted **outright** (`:560-576`) | The decisive assertion. A **NULL** function ACL — the `pg_restore --no-privileges` state §21.2 identified — *is* `EXECUTE` to `PUBLIC`, yet satisfies every boolean privilege check. Asserting the grantee list outright is what excludes it. That state is now definitively **not** present. |
| `afldb_app`, `afldb_import` cannot execute | `has_function_privilege` false (`:533-534`, `:541-542`) | Neither is granted anything here directly, so a `true` could only have come via `PUBLIC`. |
| `afldb_backup` cannot execute | asserted when the role exists (`:547-555`) | Asserted when present rather than invented when absent. |
| No dynamic SQL, no `CASCADE`, no `TRUNCATE` in the function body | `prosrc` with comments stripped (`:585-591`) | §13's requirement, checked against what the database actually stored. |
| Every NL/app-health relation reference is `public.`-qualified | negative lookbehind over `prosrc` (`:595-597`) | With `public` absent from `search_path`, an unqualified name would fail at runtime, not merely resolve elsewhere. |
| `afldb_auth` holds **no** `DELETE` and **no** `TRUNCATE` on `nl_search_log`, `nl_search_review` or `nl_search_feedback` | `has_table_privilege` cross-join returns `[]` (`:606-616`) | The negative half of the boundary: without it the function would not be the *only* deletion capability. This also closes the `nl_search_review` assertion gap §21.2 recorded. |

**Acceptance criterion 5 (§16) is now half-evidenced:** the grant-side half — "only EXECUTEs the fixed function; no owner credential or direct DELETE/TRUNCATE grant" — is proven. The execution-side half is not; see §24.6.

### 24.6 What is still unproven — and must not be counted as passed

- **The function has never been called.** `tests/integration/nl-search-telemetry-clear.test.ts` has still never run. Every runtime claim remains an unexecuted assertion: the `WITH RECURSIVE` retained closure, arbitrary-depth ancestry, mid-chain sibling and child-of-leaf non-retention, preservation of reviews and orphaned feedback, the five returned counts, the `SHARE ROW EXCLUSIVE` lock cutoff, `app_health_events` `ON DELETE SET NULL` detachment, sequence non-reset, and the whole-clear rollback. §20.4 R1's substantive half stays open.
- **§24.5 proves catalogue state, not execution.** The suite connects on the owner DSN (`AFLDB_TEST_DATABASE_URL`). `has_function_privilege('afldb_auth', …)` is a catalogue predicate evaluated *about* that role, not a connection *as* it. That `afldb_auth` can actually authenticate, connect and successfully invoke the function is a separate fact, and it is unevidenced.
- **`AFLDB_TEST_AUTH_DATABASE_URL` remains undefined** — absent from the process environment, both Windows environment scopes and the worktree `.env` (§23.2). The telemetry-clear suite's restricted describe therefore **skips explicitly** rather than running, and never falls back to the owner credential (§22.3). **A skip is not a pass.** Until the DSN is set, the restricted-role halves of acceptance criteria **5** and **10** — `afldb_auth` executing the function successfully, and its direct `DELETE`/`TRUNCATE` being refused live with SQLSTATE `42501` — are **pending, not passed**, and must not be reported otherwise.
- Risks **R3** (`postgres.js` returns the five `bigint` counts as strings), **R4** (migration-number contention for `claude/issue-116`), **R5** (the caller's transaction is load-bearing for the cutoff) and **R6** (Gridley's `080` merging later) are untouched by this step.
- `081` remains checksum-locked in `afldb_meta.schema_migrations` (§23.6): any repair is a new migration or a test-database rebuild, never an in-place edit.

### 24.7 Files changed this step

| File | State |
|---|---|
| `issues/open/AFLDB-ISSUE-119.md` | Modified: header `Status`, §20.4 R1/R2 closure annotations, §23.8 steps 1-2 struck, and this §24. |
| `IssuesIndex.md` | Modified: current-state and next-action wording only. |
| `issues.md` | Modified: Open Issues row next action, ledger `Status`, `Validation` and `Follow-up`. |

No source, SQL, migration, test, `CHANGELOG.md` or configuration file was changed. `CHANGELOG.md` stays untouched deliberately: no retained application behaviour has changed yet — the feature has no caller. **Nothing was committed.**

### 24.8 Exact next action

**BOTH STEPS DISCHARGED 2026-09-01 — see §25. The live instruction is §25.10.**

1. **Establish the restricted `_test` auth DSN.** Set `AFLDB_TEST_AUTH_DATABASE_URL` in the worktree `.env` to the **same endpoint and same `_test` database** as `AFLDB_TEST_DATABASE_URL` (`127.0.0.1:5432/afldb_test`) but with role **`afldb_auth`** and its own password. Never the owner credential, never `afldb_dev`, never production. This requires an `afldb_auth` password on the test cluster. The suite validates endpoint/database/`_test` parity statically at module load and then re-checks `current_user`/`current_database()` at runtime (§22.3), so a mismatched DSN fails rather than silently misreporting.
2. **Then run only** `npx vitest run tests/integration/nl-search-telemetry-clear.test.ts`. This is the first execution of the clear function itself and the proof of everything in §24.6's first bullet. Confirm from the output that the restricted describe **ran** rather than skipped — that is the whole point of step 1.

Analyse failures against §20.4 and §22.6 before touching any SQL, remembering the checksum lock. Only after that evidence passes: the query layer (casting the five `bigint` counts per R3), the transaction-aware audit helper, the Server Action, the UI, `docs/search.md` and `CHANGELOG.md`, in that order.

## 25. Session record — 2026-09-01 (Stage 2, step 6: restricted credential established; clear function executed for the first time)

### 25.1 Starting point

Branch `codex/issue-119` at `19886c4` ("Record ISSUE-119 privilege validation"), **clean worktree** — all three confirmed with read-only Git metadata before anything else ran. Scope for this step was exactly §24.8: establish `AFLDB_TEST_AUTH_DATABASE_URL` safely, then run one test file. No Server Action, no UI, no SQL change, no migration, no privilege command.

**This step was Claude-executed under explicit operator authorisation for this task only** (contrast §24.2, where the operator ran the commands). The outputs quoted below are raw terminal output Claude observed directly.

### 25.2 How the restricted credential was established — and why it is safe

`AFLDB_TEST_AUTH_DATABASE_URL` needed an `afldb_auth` password on the test cluster (§24.8). No new password was set and no role was altered. The credential already existed in the worktree `.env` as `AFLDB_AUTH_DATABASE_URL` — role `afldb_auth`, endpoint `127.0.0.1:5432`, database `afldb_dev`. **PostgreSQL role passwords are cluster-level, not per-database**, and `afldb_dev` and `afldb_test` are the same cluster at the same endpoint, so the same secret authenticates to either. The DSN was therefore derived by changing **only the database name**, `afldb_dev` to `afldb_test`.

The derivation ran as a script that asserted every safety property **before** it opened a connection, and again before it wrote anything, refusing outright rather than falling back:

| Assertion | Result |
|---|---|
| Source DSN's role is `afldb_auth` | pass |
| Owner DSN's role is `afldb_owner` (so the two are distinguishable) | pass |
| Derived password is not equal to the owner DSN's password — **never reuse the owner credential** | pass |
| Endpoint equals `AFLDB_TEST_DATABASE_URL`'s endpoint | pass (`127.0.0.1:5432`) |
| Target database equals `AFLDB_TEST_DATABASE_URL`'s database | pass (`afldb_test`) |
| Target database matches `/_test$/` | pass |
| Target database is **not** `afldb_dev` | pass (explicit refusal branch) |

A connectivity probe was then run **before** `.env` was modified, so a failure could not leave a broken or unsafe DSN behind. It reported:

```text
candidate target : afldb_auth@127.0.0.1:5432/afldb_test
owner target     : afldb_owner@127.0.0.1:5432/afldb_test
CONNECTED AS     : afldb_auth / current_database=afldb_test
```

Only then was the variable written into the worktree `.env`, inserted after `AFLDB_TEST_DATABASE_URL` with the `.env.example:62-73` never-fallback wording, preserving the file's existing LF line endings. No password, DSN literal or secret was printed, echoed, logged or written to any tracked file at any point; every inspection above extracted structure only. `.env` is untracked and gitignored (`.gitignore:24`), so this does not appear in the diff and **does not propagate to any other worktree** — §23.3 B1 recurs for each new one.

No `afldb_dev` and no production endpoint was contacted. `AFLDB_PROD_DATABASE_URL` is not present in this worktree's `.env` at all.

### 25.3 The command and its exact result

```text
> npx vitest run tests/integration/nl-search-telemetry-clear.test.ts

 Test Files  1 passed (1)
      Tests  9 passed (9)
   Duration  16.90s
```

**9 passed, 0 failed, 0 skipped.** Re-run with `--reporter=verbose` to satisfy §24.8's "confirm it ran rather than skipped" requirement by name rather than by inference:

```text
 ✓ retention contract > retains the full ancestor chain above a reviewed leaf, to arbitrary depth, and deletes the mid-chain sibling  2354ms
 ✓ retention contract > keeps every feedback row — matched with its ancestry, and orphaned — and every review                        2371ms
 ✓ retention contract > preserves every app-health row and detaches only the links to deleted logs                                   2153ms
 ✓ retention contract > touches nothing unrelated, and the identity sequence is not reset                                            2012ms
 ✓ retention contract > rolls back completely: an aborted clearing transaction leaves no trace                                       1900ms
 ✓ cutoff and concurrency > blocks a telemetry writer for the life of the clearing transaction, then the writer proceeds untouched   2459ms
 ✓ restricted afldb_auth credential (AFLDB_TEST_AUTH_DATABASE_URL) > executes the clear end to end as the application role           1725ms
 ✓ restricted afldb_auth credential (AFLDB_TEST_AUTH_DATABASE_URL) > still cannot DELETE any NL table directly                        190ms
 ✓ restricted afldb_auth credential (AFLDB_TEST_AUTH_DATABASE_URL) > still cannot TRUNCATE any NL table                              571ms
```

**The restricted describe ran.** All three of its tests are listed as executed, not skipped. `describe.skipIf(!authDsn)` (`:478`) would have omitted them entirely had the DSN been unset, and the describe's `beforeAll` (`:481-501`) throws unless a live `SELECT current_user, current_database()` on that connection returns exactly `afldb_auth` on the same `_test` database the owner DSN names — so a green run is itself independent runtime proof that the credential authenticated **as `afldb_auth`, on `afldb_test`**, and is not the owner credential in disguise.

### 25.4 Retention evidence now proven by execution

Every claim below was an unexecuted assertion until this step (§24.6, first bullet). Each ran against the applied migration `081` in `afldb_test`, inside a transaction that was **always rolled back** — no real `afldb_test` telemetry was destroyed.

- **Arbitrary-depth ancestry (§13/§16.2, the mandatory operator fixture).** A four-level chain — great-grandparent, grandparent, parent, reviewed leaf, with only the leaf protected directly — survives **in full**, while a disposable **sibling hanging off the mid-chain grandparent** and a disposable **child of the leaf** are both deleted. This is the assertion a non-recursive one-hop join could not pass, and it is the one that proves retention follows *ancestry* rather than the whole connected component. The `WITH RECURSIVE` closure in `081` is now executed, not merely parsed.
- **Durable evidence preserved.** Reviews and feedback — matched *and* orphaned — are byte-checked unchanged after the clear; the review's FK held through the `DELETE` without deferral, and the global zero-orphan review assertion passed.
- **App health.** No `app_health_events` row is deleted; only the link to a deleted log becomes `NULL`; the link to a protected log is intact.
- **Nothing unrelated touched, no sequence reset.** `auth_audit_log`, `auth_users`, `players` and `matches` counts unchanged, and a post-clear insert takes an id above the pre-clear maximum.
- **Whole-clear rollback.** An aborted clearing transaction leaves log count and non-NULL health-link count exactly at baseline — the deletes *and* the `SET NULL` detachments both roll back.

### 25.5 Concurrency evidence

The cutoff test passed: transaction A holds the function's `SHARE ROW EXCLUSIVE` lock set while writer B, on a **second dedicated backend**, provably blocks — established via `pg_blocking_pids()`, not by sleeping — and then proceeds once A ends, surviving as post-clear telemetry. Both roll back (deviation **D2**, §22.5: A is rolled back rather than committed; B's row is still definitionally post-`DELETE` because the delete ran before B unblocked).

§8's lock ordering and cutoff semantics are therefore executed and proven at the database layer. **§16.7 is not yet fully accepted**: risk **R5** stands — in production the *caller's* transaction is what holds these locks, so the Server Action must open and hold one, and that code does not exist yet.

### 25.6 Security evidence — the live half of the boundary

§24.5 proved catalogue state on the owner connection. This step proves the same boundary **as the actual credential the application will hold**:

| Property | Evidence |
|---|---|
| `afldb_auth` can authenticate, connect and **successfully invoke** the function | The end-to-end test seeded its own disposable row on the restricted connection, invoked `public.nl_search_telemetry_clear()`, and observed the row gone. `EXECUTE` on the `SECURITY DEFINER` function is the **entire** capability the role holds here. |
| `afldb_auth` still cannot `DELETE` directly | `DELETE ... WHERE false` refused with SQLSTATE **`42501`** on `nl_search_log`, `nl_search_review` **and** `nl_search_feedback`. `WHERE false` keeps the probe harmless even against a regressed grant. |
| `afldb_auth` still cannot `TRUNCATE` | Refused with SQLSTATE **`42501`** on all three tables, **each probe in its own rolled-back transaction**, so a regressed grant would have been contained rather than destructive. |

This closes §24.6's second and third bullets. **Acceptance criterion 5 is now fully evidenced** at the database layer: both the grant-side half (§24.5) and the execution-side half (here). The restricted-role halves of criteria **5** and **10** are **passed**, no longer pending.

### 25.7 What is still unproven — and must not be counted as passed

- **Criterion 5's application half remains open.** That the *application* connects as `afldb_auth` is still an architectural intent, not evidence: the Server Action does not exist. Criteria **3**, **4**, **6**, **9** and the UI/authorisation half of **10** are untouched by this step.
- **Risk R3 is NOT resolved and this run does not bear on it.** `runClear` (`:124-135`) casts all five counts `::int` **inside the test's own query**, so the suite never observes the raw `bigint`. `postgres.js` returns `int8` as a **string**; the production query layer must cast explicitly or it will compare and render strings. The test sidesteps R3 rather than proving anything about it.
- **Deviation D3 stands.** "No success audit on failure" cannot be asserted yet: the function records no audit (§9 places it in the caller's transaction), so there is nothing to assert until the Server Action exists. Criterion **6** is unstarted.
- **Deviation D1 stands.** The restricted DSN's static parity validation still lives in the test file rather than in `tests/setup.ts` / `guard.ts`. It has one consumer; wire it into the shared guard when the Server Action tests share the credential.
- **R4** (`claude/issue-116`'s competing `079` must renumber on merge) and **R6** (Gridley's `080` merging later) are untouched.
- `081` remains **checksum-locked** in `afldb_meta.schema_migrations` (§23.6). Any repair is a new migration or a test-database rebuild, **never an in-place edit**.

### 25.8 Blockers and deviations this step

**Blockers: none.** §24.6's `AFLDB_TEST_AUTH_DATABASE_URL` blocker is **resolved** (§25.2).

**Deviations: none from the runbook.** One process note: unlike §24.2, Claude executed both commands under explicit operator authorisation scoped to this step; the evidence above is directly observed output rather than an operator report.

### 25.9 Files changed this step

| File | State |
|---|---|
| `issues/open/AFLDB-ISSUE-119.md` | Modified: header `Status`, §15 operator action closed, §24.8 struck, and this §25. |
| `IssuesIndex.md` | Modified: current-state and next-action wording only. |
| `issues.md` | Modified: Open Issues row next action, ledger `Status` and `Validation`. |
| `.env` (worktree, untracked/gitignored) | `AFLDB_TEST_AUTH_DATABASE_URL` added (§25.2). Not part of the diff. |

No source, SQL, migration, test or configuration file under version control was changed. `CHANGELOG.md` stays untouched deliberately: no retained application behaviour has changed yet — the feature still has no caller. **Nothing was committed.**

### 25.10 Exact next action

The database layer is now fully evidenced and the next work is application code. Start with the **query layer**:

1. ~~Add the query helper wrapping `public.nl_search_telemetry_clear()` in `src/db/queries/`, **casting all five `bigint` counts explicitly** (`::int`, or `Number()` on the returned strings) — R3 is live for this code, and the test's own cast proves nothing about it.~~ **Written 2026-09-01 — see §26; unvalidated. Steps 2-4 stand; §26.8 is the live list.**
2. Then the transaction-aware audit helper (§9), so the `auth_audit_log` insert can share the caller's transaction.
3. Then the Server Action (§6, §8) — `requireSuperAdmin()` before parsing confirmation input or opening the transaction; it must open and hold the transaction, since R5 makes the caller's transaction load-bearing for the §8 cutoff.
4. Then the UI (§10), `docs/search.md`, and `CHANGELOG.md`, in that order.

Do not re-run the migration or edit `081`; it is checksum-locked. `npm run db:privileges:test` remains idempotent and safe to re-run at any point.

## 26. Session record — 2026-09-01 (Stage 2, step 7: the typed query helper)

### 26.1 Starting point

Branch `codex/issue-119` at `544b3b5` ("Record ISSUE-119 runtime validation"), **clean worktree** — all three confirmed with read-only Git metadata before anything else. Scope for this step was exactly §25.10 step 1 and nothing beyond it: the query helper wrapping `public.nl_search_telemetry_clear()`, with the five `bigint` counts handled explicitly so risk **R3** cannot leak into the application contract. The transaction-aware audit helper, Server Action, UI, `docs/search.md` and `CHANGELOG.md` were deliberately **not** started.

### 26.2 Source review of existing patterns before writing anything

| Question | Finding |
|---|---|
| Is there a house pattern for a query helper that must run in the caller's transaction? | **Yes, and it is the exact shape needed.** `src/db/queries/audit-log.ts:41-43` takes `tx: postgres.TransactionSql` as its first parameter, acquires no connection of its own, and states in a contract comment that it must be passed a `sql.begin` handle and never a pool, with no try/catch so a failure propagates and rolls the mutation back. That is AFLDB-ISSUE-027's required-audit helper; ISSUE-119 has the same atomicity requirement, so it takes the same form. |
| How does the codebase handle `bigint` from this driver? | `src/db/queries/nl-search-log.ts:23-27` states the rule in its own header — *"every `count(*)` comes back from the driver as a string, so each one is cast at the SQL boundary or `Number()`-ed on the way out. Getting this wrong shows up as `"12" + 5 = "125"`… which is exactly the class of bug this codebase has hit three times in the NL work already."* The module then does it 33 times: rows typed as `string`, `Number()` on the way out. R3 is a known, named, repeatedly-hit defect class here, not a hypothetical. |
| Where does the helper belong? | §12 permits either `src/db/queries/nl-search-log.ts` or *"a new narrowly named maintenance module if clearer"*. **New module.** `nl-search-log.ts` documents itself as read-only reporting *"plus the one write path for `nl_search_review`"*, and its `saveNlSearchReview` comment leans on `nl_search_log` being append-only by grant. Putting the deletion capability in that file would contradict the file's own stated contract in two places. |
| What exactly does the function return? | `081:82-88` — `RETURNS TABLE (deleted_log_rows, retained_log_rows, retained_review_rows, retained_feedback_rows, detached_app_health_links)`, all `bigint`, no parameters; the body ends in a single `RETURN QUERY` over a one-row `SELECT` (`081:177-184`). Exactly the five facts §9 permits the audit event to record. |
| Is there a DB-free unit-test home for NL telemetry query code? | **Yes.** `tests/nl-search-log.test.ts` unit-tests `src/db/queries/nl/log.ts` with a fake tagged-template `sql`, no database. Extended rather than duplicated, per CLAUDE.md §10. |

### 26.3 What was implemented

**`src/db/queries/nl-search-telemetry-clear.ts` (new, 133 lines).** One exported function and one exported type; nothing else in the repository was modified other than the test file below.

| Element | Implementation |
|---|---|
| Signature | `clearNlSearchTelemetry(tx: postgres.TransactionSql): Promise<NlTelemetryClearCounts>` — transaction handle **required**, no `authSql` import, no pool fallback, no parameters of its own to pass through. The function takes no arguments, so there is no predicate, mode or flag by which a caller could widen what is deleted (§24.5), and the helper adds none. |
| Result type | `NlTelemetryClearCounts` = `deletedLogRows`, `retainedLogRows`, `retainedReviewRows`, `retainedFeedbackRows`, `detachedAppHealthLinks`, all `number`. Keys match §9's permitted audit payload **one for one**, so the Server Action maps them without renaming and cannot accidentally reach a sixth fact — none is available here. |
| R3 handling | The row type declares all five columns `unknown` — what the driver actually hands back, not what the SQL type suggests — and each goes through `toCount()`. That helper accepts a digit-only string (`/^\d+$/`), a `number`, or a `bigint`, rejects everything else, and then requires `Number.isSafeInteger(n) && n >= 0`. A rejected value **throws**, aborting the caller's transaction and rolling the deletion back. |
| Why reject rather than coerce | `Number(null)`, `Number(undefined)` and `Number('')` are `NaN`, `NaN` and **`0`** respectively. A bare `Number()` would therefore turn an unreadable count into a confident `0` and write it to the audit trail as fact — a clear that deleted 412 rows recorded as having deleted none, indistinguishable from the truth after the fact. The regex is what makes a leaked string impossible rather than merely unlikely. |
| Why not `::int` in the SQL | A count above `int4` range would make PostgreSQL raise inside the deletion transaction. Converting in TypeScript keeps the decision here and keeps one conversion site instead of two. `Number.isSafeInteger` is the equivalent guard, at a far higher ceiling. |
| Row-count guard | `rows.length !== 1` throws. `RETURN QUERY` over a single-row `SELECT` always yields exactly one row, so anything else means the installed function is not the one this file was written against — and by then the `DELETE` has already run, which is precisely when the caller must roll back rather than audit a guess. |
| Contract comment | Records that the transaction is load-bearing twice over: **R5** (the `SHARE ROW EXCLUSIVE` locks defining §8's cutoff are released at statement end on a pool) and §8's atomicity (the audit row must commit with the deletion). Also records deliberately having no try/catch, matching `audit-log.ts`. |

**`tests/nl-search-log.test.ts` (extended).** New describe `clearNlSearchTelemetry count boundary`: six `it` declarations, one of them an `it.each` over six unreadable values, so **11 test cases as vitest counts them** (§27 corrects this step's original "seven"). No database and no module mock — the helper takes its transaction as a parameter, so a fake tagged-template handle is injected directly.

| Test | Proves |
|---|---|
| Converts the driver's `int8` strings | `{'412','38','7','11','3'}` becomes numbers; asserts `412 + 38 === 450` explicitly, the `"41238"` concatenation being the exact defect R3 names; every returned value is `typeof 'number'`. |
| Zero counts and a `bigint`-typed result | A clear that deleted nothing audits as `0` and is not rejected alongside the unreadable values; a driver configured to return real `bigint`s is handled too. |
| Refuses six unreadable values | `null`, `undefined`, `''`, `'many'`, `'-1'`, `'1.5'` each throw naming the offending column. `null` and `''` are the two that a bare `Number()` would silently turn into `0`. |
| Refuses a result set that is not exactly one row | Empty and two-row results both throw rather than reporting no deletion or reading the first row. |
| Issues exactly one statement on the given transaction | No second connection and no pool fallback. |

### 26.4 Source review of the change itself

Reviewed against §6, §8, §9, §24.5 and R3/R5.

- **No widening.** The helper adds no parameter, no interpolation and no identifier from any caller; the SQL is a constant with a schema-qualified call. Nothing a Server Action passes can change which rows are deleted, because there is nothing to pass.
- **Schema qualification** — `public.nl_search_telemetry_clear()`, matching the discipline the function itself is held to (§24.5), rather than relying on the connection's `search_path`.
- **Fail-closed on every unreadable path.** Both guards throw inside the caller's transaction, so the deletion rolls back. Neither returns a partial or defaulted result, and neither logs-and-continues.
- **Audit surface is exactly §9's five counts.** No question, plan, session id, client ref or deleted id is fetched, so none can be logged downstream by mistake.
- **`transform: { undefined: null }`** on the auth pool (`src/db/authClient.ts:48`) affects parameters, not results, and this query has no parameters — noted so the `undefined` rejection branch is not later "simplified" away as unreachable. It is reachable through a missing column alias, which is a real failure mode.
- **`import 'server-only'`** as every `src/db/queries/*` module does; the type-only `postgres` import erases at compile time, exactly as in `audit-log.ts`.

### 26.5 Deviations

- **D5 (new).** §12 lists the query layer under `src/db/queries/nl-search-log.ts`; it is instead a new module, `src/db/queries/nl-search-telemetry-clear.ts`. §12 explicitly permits this ("or a new narrowly named maintenance module if clearer") and states the split is organisational only. Reason in §26.2: `nl-search-log.ts` documents itself as read-only reporting plus one review write, and its `saveNlSearchReview` comment relies on `nl_search_log` being append-only by grant. **No SQL or security contract changed.**
- **D6 (new).** The helper requires a transaction and offers no pool overload. §25.10 did not demand this, but R5 does: on a pool the locks release at statement end and §8's cutoff evaporates silently. Making the transaction a type error to omit is cheaper than a comment asking callers to remember. Follows `audit-log.ts`.
- D1 (restricted-DSN parity lives in the test file), D2, D3, D4 from §22.5 are **unchanged** by this step.

### 26.6 Validation performed

**Static and source review only *in this step*. Nothing was executed here except read-only Git metadata** — the validation that followed is recorded in §27, which this subsection's annotations point to.

- `git diff --check` — **clean, exit 0.** The new query module is untracked; a `--no-index` whitespace check of it reports nothing beyond git's expected LF→CRLF notice.
- `git status --short` reported below (§26.8). Nothing was committed.
- **No test, typecheck, build, lint, SQL, database, migration, deployment or production command ran in this step, and no database was queried.** ~~The helper has **never been executed** and its new tests have **never run** — this is the same class of gap §20.4 R1 carried for the migration, now applying to the query layer, and it is the first item in §26.9.~~ **SUPERSEDED 2026-09-01 by §27:** both were run and both passed — `tests/nl-search-log.test.ts` 16/16 (the clear-helper describe 11/11) and `npm run typecheck` clean. The gap this step recorded is closed for the query layer; the original wording is struck rather than deleted because it was accurate when written.

### 26.7 Risks and blockers

- **R3 — CLOSED 2026-09-01 at the typed query boundary (§27).** `toCount()` and its **11** test cases have now run and passed, so the counts `postgres.js` hands back as `int8` strings are explicitly converted — or rejected outright — before they can enter `NlTelemetryClearCounts` or the §9 audit payload. The closure is bounded to that boundary: it says nothing about a caller that has not been written. Original finding, retained because §26.3's design rests on it: addressed in code but not yet evidenced; `toCount()` and its tests existed but neither had run.
- **R7 (new, low).** The helper's contract that `tx` is a real transaction is enforced by TypeScript, not at runtime — a `postgres.Sql` cast to `TransactionSql` would compile. Accepted: the same is true of `audit-log.ts`, and the Server Action tests (§12) assert the transaction is opened. Not a tracked-issue candidate.
- Risks **R4**, **R5** and **R6** are untouched by this step. **R1** and **R2** remain closed.
- `081` remains **checksum-locked** in `afldb_meta.schema_migrations` (§23.6): any repair is a new migration or a test-database rebuild, never an in-place edit. Nothing in this step touched it.
- **Blockers: none.**

### 26.8 Files changed this step

| File | State |
|---|---|
| `src/db/queries/nl-search-telemetry-clear.ts` | **New, untracked.** The typed helper, its result type and the explicit count conversion. |
| `tests/nl-search-log.test.ts` | Modified: two imports, a local `TransactionSql` alias, and the `clearNlSearchTelemetry count boundary` describe (six `it` declarations, **11 test cases**). Pure addition; the ISSUE-110 `logNlSearch` describe is untouched. |
| `issues/open/AFLDB-ISSUE-119.md` | Modified: header `Status`, §25.10 step 1 struck, and this §26. |
| `IssuesIndex.md` | Modified: current-state and next-action wording only. |
| `issues.md` | Modified: Open Issues row next action, ledger `Files` and `Status`. |

No SQL, migration, `.env`, `CHANGELOG.md` or configuration file was changed. `CHANGELOG.md` stays untouched deliberately: the helper still has no caller, so no retained application behaviour has changed.

### 26.9 Exact next action

**DONE 2026-09-01 — step 1 is discharged; the live list is §27.5.**

1. ~~**Validate this step before building on it**, one command at a time:~~ **Done — see §27.**
   - ~~`npx vitest run tests/nl-search-log.test.ts` — the first execution of the helper and of the R3 conversion. DB-free; needs no DSN.~~ **Passed 16/16; the clear-helper describe 11/11.**
   - ~~`npm run typecheck` — the helper's `postgres.TransactionSql` typing and the test's fake-handle cast are compile-time claims that nothing has checked.~~ **Passed.**
2. Then the **transaction-aware audit helper** (§9, §12): `src/lib/auth/session.ts`'s `audit()` binds the module-level `authSql` (`:330-341`) and so cannot join a caller's transaction as written — the finding recorded in §18. Add a variant that takes the `tx` handle, preserving every existing caller unchanged.
3. Then the **Server Action** (§6, §8): `requireSuperAdmin()` before parsing confirmation input or opening the transaction; it must open and hold `authSql.begin()`, because R5 makes the caller's transaction load-bearing for the §8 cutoff and, per D6, `clearNlSearchTelemetry` will not accept anything else.
4. Then the **UI** (§10), `docs/search.md` and `CHANGELOG.md`, in that order.

Do not re-run or edit migration `081`. `npm run db:privileges:test` remains idempotent and safe to re-run at any point.

## 27. Validation checkpoint — 2026-09-01 (Stage 2, step 7 validated)

### 27.1 Why this section exists

§26 was written and its work left in the worktree, but the session that produced it ended **before the operator-run validation results were persisted**. §26.6, §26.7 and §26.9 therefore recorded the query layer as unexecuted after it had in fact been executed and passed. This section is the persistence of that evidence, and the annotations now carried in §26.3, §26.6, §26.7, §26.8 and §26.9 are the corrections it authorises. No code, SQL, test or configuration file was changed to produce it.

### 27.2 Evidentiary basis

**Operator-run and operator-reported**, as in §24.2 and unlike §25. Claude executed no test, typecheck, build, SQL, database, migration or deployment command in this step and observed no raw terminal output. What is recorded below is the operator's report, plus the assertions that report necessarily satisfied, established by reading `tests/nl-search-log.test.ts:135-224` in source. The distinction matters: §27.4's claims are derived from what the passing tests assert, not from output Claude inspected.

### 27.3 The commands and their reported results

```text
> npx vitest run tests/nl-search-log.test.ts
  1 test file passed
  16/16 tests passed
  ('clearNlSearchTelemetry count boundary' 11/11)

> npm run typecheck
  passed — final output: Types generated successfully
```

**16/16** is the whole file. **11** of those are the ISSUE-119 describe; the other 5 are the pre-existing ISSUE-110 `logNlSearch` suite, which the §26 change did not touch — so a green run also evidences that the extension regressed nothing in its host file.

The 11 reconcile with §26.3's six `it` declarations because one is an `it.each` over six unreadable values (`null`, `undefined`, `''`, `'many'`, `'-1'`, `'1.5'`), which vitest counts individually: 5 + 6 = 11. §26.3's original "seven" was a miscount of the same describe, corrected in place rather than left to be re-derived.

### 27.4 What is now evidenced — and its exact boundary

**Risk R3 is closed at the typed query boundary.** `postgres.js` returns `int8` as a JavaScript string, and all five counts the function returns are `bigint`. The passing describe proves that `clearNlSearchTelemetry` converts or refuses every one of them before it becomes a value the application can hold:

| Property | Proven by |
|---|---|
| `int8` strings become real numbers | `{'412','38','7','11','3'}` becomes numbers, with `412 + 38 === 450` asserted explicitly — `"412" + "38" === "41238"` being the exact defect R3 names — and `typeof === 'number'` checked on every field. |
| A legitimate zero clear audits as `0` | `'0'`, `0` and `0n` all accepted, so a clear that deleted nothing is not rejected alongside the unreadable values. Real `bigint` results are handled too, not only strings. |
| An unreadable count **throws** rather than coercing | `null`, `undefined`, `''`, `'many'`, `'-1'` and `'1.5'` each reject, naming the offending column. `Number(null)` is `NaN` and `Number('')` is **`0`** — a bare coercion would have written "deleted 0 rows" into `auth_audit_log` for a clear that deleted hundreds, indistinguishable from the truth afterwards. This is the assertion that makes §26.3's reject-don't-coerce decision evidence rather than intent. |
| A result set that is not exactly one row throws | Empty and two-row results both reject, instead of reporting no deletion or silently reading the first row after the `DELETE` has already run. |
| Exactly one statement on the caller's handle | The fake transaction records one call: no second connection, no pool fallback (D6, R5). |

**`npm run typecheck` passing** discharges the compile-time half §26.9 flagged: the helper's `postgres.TransactionSql` parameter typing, the `NlTelemetryClearCounts` result type and the test's fake-handle cast are checked, not merely asserted. It also confirms the new untracked module does not break the project's type graph.

**The boundary of this closure, stated so it is not over-read.** R3 is evidenced *for the conversion*, and nothing further:

- **The helper has no production caller.** Nothing in `src/` imports it. It is reachable only from its own DB-free tests, so no application behaviour has changed — which is why `CHANGELOG.md` stays untouched, for the same reason as §25.9 and §26.8.
- **These tests are DB-free.** They inject a fake tagged-template handle; no database was contacted and the real function was not invoked in this step. The function's own runtime proof remains §25's integration run.
- **R7 stands.** That `tx` is a genuine transaction is a TypeScript claim, not a runtime one; the Server Action tests (§12) are what will assert the transaction is actually opened.

### 27.5 State after this checkpoint

- **Database layer:** fully validated end to end on `afldb_test` (§23–§25). Criteria 1, 2, 5, 7 and 8 are evidenced at that layer.
- **Query layer:** written **and validated** (§26, this section). R3 closed at the typed boundary; R1 and R2 remain closed.
- **Open risks:** **R4** (`claude/issue-116`'s competing `079` must renumber on merge), **R5** (the caller's transaction is load-bearing for the §8 cutoff — the Server Action must open and hold it), **R6** (Gridley's `080` merging later), **R7** (low; `tx` enforced at compile time only). Deviations **D1**–**D6** unchanged.
- **Unstarted:** transaction-aware audit helper, Server Action, UI, `docs/search.md`, `CHANGELOG.md`. Acceptance criteria **3**, **4**, **6**, **9** and the UI/authorisation half of **10** remain open.
- `081` remains **checksum-locked** in `afldb_meta.schema_migrations` (§23.6): any repair is a new migration or a test-database rebuild, never an in-place edit.

**Blockers: none.**

### 27.6 Files changed this step

| File | State |
|---|---|
| `issues/open/AFLDB-ISSUE-119.md` | Modified: header `Status`; §26.3 test count corrected; §26.6 unexecuted claim struck and superseded; §26.7 R3 closed; §26.8 test count corrected; §26.9 step 1 discharged; this §27. |
| `IssuesIndex.md` | Modified: current-state and next-action wording only. |
| `issues.md` | Modified: Open Issues row current state and next action, ledger `Status` and `Validation`. |

No source, SQL, migration, test, `.env`, `CHANGELOG.md` or configuration file was changed. The §26 working-tree artefacts — `src/db/queries/nl-search-telemetry-clear.ts` (untracked) and the `tests/nl-search-log.test.ts` extension — are byte-identical to the versions the operator validated. **Nothing was committed.**

### 27.7 Exact next action

**The transaction-aware canonical audit helper in `src/lib/auth/session.ts`** (§9, §12; the finding recorded in §18).

`audit()` at `:330-341` binds the module-level `authSql`, so it cannot join a caller's transaction as written — which is precisely what §8 requires, because the `auth_audit_log` insert must commit with the deletion or roll back with it. Add a variant that accepts the `tx` handle, following `src/db/queries/audit-log.ts:41-43` (the ISSUE-027 required-audit helper: transaction handle first, no connection of its own, no try/catch so a failure propagates and rolls the mutation back). **Every existing `audit()` caller must be preserved unchanged.**

Then, in order: the Server Action (§6, §8) — `requireSuperAdmin()` before parsing confirmation input or opening the transaction, and it must open and hold `authSql.begin()`, since R5 makes the caller's transaction load-bearing for the cutoff and D6 means `clearNlSearchTelemetry` will accept nothing else; then the UI (§10), `docs/search.md` and `CHANGELOG.md`.

Do not re-run or edit migration `081`. `npm run db:privileges:test` remains idempotent and safe to re-run at any point.
