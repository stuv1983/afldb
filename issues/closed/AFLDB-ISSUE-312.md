# AFLDB-ISSUE-312 — Migration safety scan fails on a detached HEAD with a misleading error

## 0. Status

- **Status:** **RESOLVED 2026-10-13 (merge-scoped).** Implemented 2026-10-12 in batch worktree `afldb-batch-315-281-312-288` (branch
  `opus/batch-315-281-312-288`, base `80f86c39`) as commit `5d277ddd`; DB-free validated with disposable local repositories; merged to local `main` by `01976be7`
  (not pushed or deployed) (§17, §18).
- **Severity:** Low. **Area:** database tooling / migrations / preflight.
- **Key files:** `tools/db/migration-safety.ts` (`relevantRefs`, `requireGit`), `tools/db/migrate.ts`, `tools/dev/preflight.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-047; partition note R6a-F01).
- **Classification:** code-proven.

## 1. Summary

`relevantRefs` calls `git symbolic-ref -q HEAD` through `requireGit`, which throws on any non-zero exit. On a detached HEAD, that command exits non-zero silently (that is what `-q` means), so `collectMigrationSources()` throws "git symbolic-ref failed: unknown error". The migrate run for `dev` / `prod`, and preflight, then exit telling the operator to "resolve the Git inventory failure".

## 2. Evidence

- `tools/db/migration-safety.ts:185-191` (`requireGit`), `:243-244` (the call and the always-set) and `:265-271`.
- `tools/db/migrate.ts:199` (only `--status` and the test targets skip) and `:201-209` (exit path and message).

## 3. Trigger

`npm run db:migrate` or `npm run preflight` from a checkout pinned to a SHA or tag (for example the `docs/production-cutover.md:156` shape), or a `git worktree add --detach` worktree.

## 4. Expected invariant

A detached HEAD is a normal, fully determined state. It adds no symbolic ref, and the scan continues with the base ref, `main`, `origin/main` and the unmerged refs.

## 5. Actual behaviour

The migration is refused with a misleading message.

## 6. First wrong layer

`tools/db/migration-safety.ts:243`.

## 7. Impact

Operational and fail-closed: a legitimate pinned-ref migration is refused. Not a data hazard.

## 8. Reproduction / witness

Not executed. A DB-free check is possible with a stubbed `spawnSync` or a scratch detached repository.

## 9. Disproof attempts

`deploy/sync-dev.ps1:139-140` fails earlier on a detached HEAD (`git pull --ff-only`). The reachable path is an operator-run migrate or preflight.

## 10. Existing-issue search

`symbolic-ref` and `detached` in `issues.md` and `tests/`: no relevant hit. Classification: **new**.

## 11. Scope

`relevantRefs`.

## 12. Out of scope

Other Git inventory failures (they should still throw).

## 13. Proposed fix boundary

Tolerate a non-zero `symbolic-ref -q HEAD` by adding nothing to the always-set (optionally label the run with `git rev-parse HEAD`). Keep the thrown path for genuine Git failures.

## 14. Proposed validation

DB-free unit test with a stubbed `spawnSync`.

## 15. Decisions / unresolved questions

None.

## 16. Next action

~~Implementation.~~ Superseded by §17.5 and closed in §18.

## 17. Implementation and DB-free validation (2026-10-12, batch with ISSUE-315/281/288; solo, no agents)

Worktree `D:\dev\afldb-batch-315-281-312-288`, branch `opus/batch-315-281-312-288`, base
`80f86c39baf65e04921148c166d9b2c6791b06bf`. No database, host, commit, merge, push or deployment.

### 17.1 Change (`tools/db/migration-safety.ts`)

- New `currentBranchRef(repoRoot)`: `git symbolic-ref -q HEAD` exit 0 returns the branch ref; **exit 1 with BOTH stdout
  and stderr empty (the documented silent detached-HEAD result) returns `null`**; anything else throws
  `git symbolic-ref failed: <stderr | unexpected output on exit N: <stdout> | unknown error>`. (Correction pass r2: r1
  accepted exit 1 with empty stderr alone, so exit 1 with output on stdout was wrongly read as detached.)
- `relevantRefs` adds the current ref to the always-scanned set only when there is one. A detached HEAD therefore adds no
  symbolic ref, and the scan continues with the base ref, `refs/heads/main`, `refs/remotes/origin/main`, every unmerged
  ref and every worktree.
- `git()` now reports a missing exit status (git did not start, or was killed by a signal) as `-1` instead of `1`, so it
  cannot be mistaken for the detached-HEAD exit 1. Every other caller only compares the status with 0, so their behaviour
  is unchanged.
- Not done (optional in §13): labelling the run with `git rev-parse HEAD`; the worktree source already identifies it.

### 17.2 Tests (extended the existing `tests/workflow-preflight.test.ts`, which already builds disposable repositories)

- **Disposable local repositories** (`makeRepository()`: a temporary directory with a local bare `origin`, removed in
  `afterEach`; no network): an attached feature worktree scans its merged branch; after `git checkout --detach` the
  inventory succeeds, the base ref is `refs/remotes/origin/main`, the merged branch is no longer scanned, and the current
  and base migrations are read. From a detached HEAD an **unmerged** branch with its own migration is still scanned.
- **Genuine failures still throw** (a pass-through `node:child_process` mock answers only the `symbolic-ref` call; every
  other git call, and every call in the rest of the file, reaches the real binary): exit 128 with `fatal: ...`, exit 1
  with a message on stderr, **exit 1 with output on stdout and an empty stderr (r2)**, and git not running at all each
  throw `git symbolic-ref failed: ...`; the stdout case's message is pinned as
  `git symbolic-ref failed: unexpected output on exit 1: refs/heads/unexpected`.

### 17.3 Results

- r1: `tests/workflow-preflight.test.ts` **37 passed** (34 existing + 3 new), about 21 s. Mutation check: with the
  original `requireGit(... 'symbolic-ref', '-q', 'HEAD')` restored, both detached cases **failed with exactly
  `git symbolic-ref failed: unknown error`** (the defect's message); the genuine-failure case passed; restored.
- r2 (correction pass, 2026-10-12): **37 passed** (the stdout case is inside the existing genuine-failure test). Mutation
  check: with r1's stderr-only condition restored, the genuine-failure test **failed** (`expected [Function] to throw`)
  and the two detached cases passed; restored byte-identical.
- Typecheck exit 0; lint: no error in a changed file (r1 and r2).

### 17.4 Not done

No `npm run db:migrate` or `npm run preflight` on a real detached checkout (`db:migrate` connects to its target;
`preflight` makes a read-only database probe, `tools/dev/preflight.ts:187-204`). `merge:ready`
(`tools/dev/merge-readiness.ts:223`) also calls `collectMigrationSources` and benefits from the same change. No DEV check is
applicable beyond the deploy itself (DEV deploys from a branch, `deploy/sync-dev.ps1`, §9).

### 17.5 Remaining criteria and next action

1. **Done 2026-10-12:** operator review of the batch diff, then a separate local commit for this issue. Committed
   locally; merge pending.
2. Merge to main (the merge requirement for closure) and push, with the batch, **after ISSUE-274's first-nightly evidence
   is captured** (captured: ISSUE-274 runbook §33). **Merged to local main 2026-10-13 (§18); the push is the operator's and has not happened.**
3. Close once merged with the DB-free validation above recorded. **Done 2026-10-13, §18.** Optional operator evidence: from a scratch
   `git worktree add --detach <path> main`, `npm run preflight -- --mode read-only` no longer reports the Git inventory
   failure (only if the operator accepts that command's read-only database probe).

## 18. Closure record (2026-10-13; merged locally, resolved)

Owner-authorised local integration and closure of ISSUE-312 and ISSUE-315 (solo, no agents). No push, deployment, test rerun, capture, service or timer change, or host/database contact.

### 18.1 Integration

- Pinned batch `44ea8ce2fb9d6684e68b0c59a304b985a169d9ba` and pinned main `762b46b83d3ee0327c0abbd45c9f3fe3fbf4790b` (fresh `origin/main` equal). Merge base `80f86c39`.
- `git merge --no-ff --no-commit 762b46b8`: `CHANGELOG.md` was the only conflicted path. Resolution: the batch's 281/288/312 entries first, then main's complete ISSUE-276 entry and main's updated ISSUE-274 heading and body; the batch's stale ISSUE-274 heading and all markers removed. `IssuesIndex.md` and `issues.md` merged automatically.
- Merge commit `01976be7` (parents `44ea8ce2`, `762b46b8`; the four implementation commits `5d277ddd`, `9c279f5c`, `23809fce`, `44ea8ce2` preserved). Against pinned main exactly the 17 reviewed batch files differ; all 14 non-tracking blobs equal the batch's; main's ISSUE-274/276 changes are preserved byte-for-byte. The main checkout was then fast-forwarded to the merge commit.

### 18.2 Gates

- `npm run typecheck` on the combined tree: exit 0.
- `npm run merge:ready -- --issue 312` with the exact 17-file whitelist: branch, clean worktree, main = origin/main, ahead 5 / behind 0, migration parity and declared scope (17 changed, 0 unexpected) PASS; one FAIL, the primary checkout's nine untracked `.agents/skills` files (owner exception for those nine paths only; preserved, sizes and hashes re-checked before and after); one WARN, this runbook has no `afldb-merge-readiness` block (standing). Result: BLOCKED (1 blocker, 1 warning) = the excepted blocker plus the warning, nothing else.
- `npm run preflight -- --mode merge` from the primary checkout (no `--dsn-env`, so no database contact): the same nine-path cleanliness FAIL only.
- Evidence: `D:\tmp\batch-315-281-312-288\integration-20261013\` (authorisation, manifest, step logs).

### 18.3 Closure

Closed under §17.5 item 3 (merged, DB-free validation recorded). The retained validation is unchanged: 37/37 and the two mutation checks; the merge changed none of this issue's code or test blobs. Limits: the push is not done; no real detached-checkout `preflight` or `db:migrate` run (optional, §17.5). If the merge is abandoned before it is pushed, reopen this issue.
