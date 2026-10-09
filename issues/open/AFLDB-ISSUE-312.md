# AFLDB-ISSUE-312 — Migration safety scan fails on a detached HEAD with a misleading error

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
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

Implementation.
