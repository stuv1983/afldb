# AFLDB closeout review, 21 November 2026

**Decision: hold project closeout.** Every committed change from the remediation worktree is on the live primary branch. The local primary ref still needs a fast-forward, the primary directory has unrelated work, and the remediation directory has six pre-existing untracked files. Four source findings require action. This review covers the first-party subsystems named below. Runtime qualification and production acceptance are separate evidence.

## Integration evidence

| Ref or object checked | Full commit | Result |
|---|---|---|
| Live `origin` server, `refs/heads/main` | `b82a6b04a6138207bfb6483b3a4fa4ed143fbe74` | Read directly with `git ls-remote --exit-code origin refs/heads/main` during this review |
| `refs/remotes/origin/main` and `origin/HEAD` | `b82a6b04a6138207bfb6483b3a4fa4ed143fbe74` | Tracking ref last updated by push on 19 November at 13:39:37 AEDT. No fetch this session. Its value matched the live ref. |
| `refs/heads/claude/remediation-20261114` | `b82a6b04a6138207bfb6483b3a4fa4ed143fbe74` | Identical commit and root tree `c040c629741402d28bafed4ffcece9352edb3d55` |
| Previously reviewed commit | `9fc1a5260a8e5b2627155271bb51b5af1d13bcc9` | Ancestor of the remediation and published tips |
| `refs/heads/main`, upstream `refs/remotes/origin/main` | `ea9bddf81284f68a8913fc258629fba3238b742a` | Ancestor of the published tip, zero local-only commits and 223 behind. Neither remediation commit is its ancestor. |
| `D:/dev/afldb` HEAD | `549c5892d7e31a962380c9bd0128ae99969f3b75` | `claude/issue-339-deploy-preflight`, 3 commits outside published ancestry, 35 unstaged tracked paths and 371 untracked files |

The ancestry checks used `git merge-base --is-ancestor` for both requested commits against both primary refs. Local main is missing actual content, including `src/lib/rollover/season-opening.ts`, `tools/v2/b1a-successor/repair.mts` and the 14 November review. Its issue ledger blob is `a1b83cbb835c8af293c5bcb9fd787dc5a06a9b39`; the published ledger is `5170dc5f478f89d0b8365742c8d1befb298b3469`. All 223 non-merge commits listed by `git cherry main b82a6b04` were marked plus. The published branch shares exact ancestry and all code and issue-record blobs. A replay or squash would duplicate published work.

The five agent TOMLs, the Release 7 sitting README and eight ignored entries in the remediation directory were outside the published tree at inventory. The README records an approval expiring 20 November at noon AEDT, a preliminary pin check and **NOT STARTED**. It supplies no serving ID, production acceptance or signed-in browser result. Preserve the record separately. The last committed acceptance cited in the release packet is the 18 November release at `a2e6ea99`. An actual later outcome requires its sitting evidence.

## Findings and focused verification

| Issue | Severity | Source at `b82a6b04` | Impact, correction and evidence required |
|---|---|---|---|
| 368 | High | `tools/aflw/load_staging.py:80`, `:210`, `:238`, `:240`, `:282`; `src/db/migrations/026_aflw_read_model.sql:80` | A header-only replacement passes all row checks. The transaction truncates the staging tables and commits the empty result exposed by the public views. Validate a complete extract and load the exact validated generation. Prove refusal preserves populated staging and view results, then prove a valid retry is idempotent. [Runbook](../closed/AFLDB-ISSUE-368.md). |
| 352, existing | Medium | `tools/maintenance/offhost-pull.sh:49`, `:66`, `:78`, `:82`; `tests/deploy-web-unit.test.ts:463` | The first oversized batch persists its verified markers before retention is refused. A second unchanged pull counts zero new items and can prune the older copies. Persist the hold or isolate unaccepted markers. Extend the existing fixture through a second pull and require the original dumps, sidecars and markers to survive. |
| 369 | Medium | `package.json:14`; `tools/db/migrate.ts:8`, `:242`, `:274` | Migration status executes bootstrap DDL before its report branch. It can alter an empty target or fail on a read-only target. Detect an absent ledger through the catalog and reserve DDL for apply mode. Require a successful report with identical before/after catalogs on empty and populated read-only targets. The historical operations note at `issues.md:49120` already warns about this behaviour. |
| 367 | Low | `src/db/queries/rounds.ts:149`; `src/app/seasons/[year]/page.tsx:107`; `src/db/queries/matches.ts:135`; `src/db/queries/players.ts:731` | The season page and existing match mirrors bypass the acceptance rule. The parked enhancement recorded 621 positive pending-season round votes on an isolated 4 November snapshot. Gate all three readers, preserving NULL. Verify pending and accepted controls on season, match and player views. The enhancement gates the season reader only among these three. |

All four findings block final sign-off for their affected paths. The backup finding belongs to the open operational issue. The new findings have separate tracker entries. No test run, production loss, current live vote disclosure or operational installation is inferred from these source paths.

**Focused commands, pending on streamanator.** In a fresh disposable checkout, the following database-free command reproduces the AFLW false pass. A nonzero exit for a completeness refusal is the desired result after a fix.

```sh
python3 -B -c 'from tools.aflw.load_staging import TABLES,check; from tempfile import TemporaryDirectory; from pathlib import Path; t=TemporaryDirectory(); p=Path(t.name); [ (p/(n+".csv")).write_text(",".join(c)+"\n") for n,c in TABLES ]; raise SystemExit(check(p))'
```

After extending the backup fixture through a second pull, run `npm test -- tests/deploy-web-unit.test.ts -t offhost-pull`. The present test covers only the first refusal. On an explicitly configured, empty, server-enforced read-only disposable `_test` database, use `npm run db:status -- --target test`, with catalog checks before/after. For the parked season fix on a seeded disposable test DB, use `npm test -- tests/integration/database.test.ts -t 'withholds every round vote'`. That test exists on the enhancement branch. Match/log regressions still need implementation. Do not substitute a production connection for these checks.

## First-party review coverage

| Area | Current source and evidence examined | Assessment |
|---|---|---|
| Public and admin routes | Season and match render paths, player query, AFLW views; draft actions and capability checks at `src/app/admin/draft/actions.ts:142`; match-sheet transaction, dependent checks and audit at `src/db/queries/match-sheet.ts:142`, `:215`, `:340`; override merge and audit | 367 concerns public output. The inspected draft and sheet mutations preserve separate role and data-integrity gates. |
| Authentication and authorisation | Middleware admin and beta claim checks, database session hash/expiry/revocation at `src/lib/auth/session.ts:311`, restricted audience at `src/lib/auth/audience.ts:35`, auth and beta suites | Database-backed role checks and the beta epoch serve separate requests. ISSUE-362 retains its Caddy and operational follow-up. |
| Search and Grid Solver | NL plan validation at `src/search/nl/plan.ts:1863`, SQL metric/HAVING resolution at `src/db/queries/nl/team-match.ts:289`, NL plan regressions, club-lead aggregation at `src/db/queries/grid-solver.ts:273`, accepted medal rows, Gridley limitations | Reviewed filter and grouping boundaries, ties and NULL guards. Gridley fixture decisions and shared test residue are still tracked by 363. |
| Database queries, schema and upgrades | Brownlow acceptance expression and query callers, migration inventory through 118, fixture participant constraints in 118, runner status, checksums and transactional apply at `tools/db/migrate.ts:292` | 367 and 369. The status problem is independent of transactional migration application. |
| AFL and AFLW acquisition | AFL settle HALT/rollback and completion, season opening row counts, DraftGuru guard before writes at `tools/rebuild/draftguru/import_draftguru.py:1448`, Python Brownlow readiness, AFLW parse/check/COPY and live view model | 368. Issues 332, 348 and 350 still require their stated operational inputs and decisions. |
| Validation and tests | `tools/validation/validate_migration.py:346` dispatches count, aggregate, integrity, NULL, player and search checks; line 369 propagates failures. Reviewed affected unit/integration suites and branch qualification limits | Existing first-run backup test misses the retry. A schema-only DB was insufficient for part of the R7 coverage suite. No new runtime result this pass. |
| Deployment, recovery and maintenance | Release activation/InvocationID checks, post-install and rollback wrappers, successor repair/recover/reverse and locked fingerprints, scheduled backup and off-host pull, per-file test DB sweep | 352. R7 DEV evidence and production execution are different records. Existing 351, 357, 362 and 364 operational decisions remain open. |
| Parked changes intended for integration | Compared branch SQL, public season grouping, opponent-history API and client state, hash navigation, integration and E2E changes and post-sitting handoff | Season query uses the acceptance gate at branch `src/db/queries/rounds.ts:186`. Opponent history uses it at `src/db/queries/players.ts:832`. Its trackers collide with the distinct published ISSUE-366. |

The review used tracked source at the exact published SHA, the full review of `de640826`, remediation qualification, the 19 November DEV record and focused inspection beyond that diff. Source discovery used Git tree, grep and blob reads. No code graph or coverage generation was available. This is a risk-based code review across all requested areas. It provides neither a line-by-line proof over every first-party file nor a new runtime or security certification. The historical baseline, scope and qualification details are in [the 14 November review](AFLDB-FULL-REVIEW-2026-11-14.md) and [R7 DEV qualification](../../docs/v2/evidence/remediation-20261114/run7/DEV-QUALIFICATION.md).

## Outstanding integration and cleanup

The enhancement at `2d83738d83b53883b5543762755b8d3f3616050f` has 11 unmatched commits from `611630e41f3f27391173615d961c0ab5e1ea7810`. The base is 6 commits behind published main. The branch is separately parked. Its 11 commits, in order, are `956bf5a6`, `97d8730a`, `dd9819e1`, `c2f5a28a`, `739d126b`, `9395bc2b`, `ea8f84ea`, `888513c7`, `0331cd70`, `b911a28d` and `2d83738d`. A later approved integration must preserve the parked tip, replay this range onto the then-confirmed base, keep primary 365/366 history, reconcile active Brownlow tracker references to 367 and compare executable blobs. Primary test and release inputs changed. Rerun affected integration and head/base browser qualification on streamanator. The branch records 165 passed, 30 failed and 3 skipped Playwright tests, eight uninvestigated failures, and seven missing-fixture unit failures. Its separate mirror-reader follow-up remains necessary. The branch handoff is `docs/v2/evidence/enh-20261116/POST-SITTING-HANDOFF.md` at that tip.

The linked inventory gives all 49 worktrees, full commits, status and the six proposed removals. Patch-ID matches on worker branches do not establish final byte equality or remove the unique commits. The primary checkout also has unmatched patch IDs at `48ff91c7` and `5cba6846`, and `rem2-evidence` at `6d41d2d3`. These checkouts remain intact. No replay of those development intermediates is required to establish the remediation branch verdict. The detached execution-P checkout is retained because it is a release-readiness artifact whose current local value is unclear. [Inventory and preservation list](AFLDB-CLOSEOUT-WORKTREES-2026-11-21.md). Direct blob comparisons found both files from the manifest-verifier intermediate at the final worker tip identical to published main. The 6 November deployment evidence directory differs from its original only by a later errata file. The ISSUE-339 deployment scripts and their scoped tests match the published replay at `37bc6a6c` and its follow-up at `8d122f62` respectively. These checks do not classify the uncommitted primary-directory files.

**Single local Git transaction proposed for approval.** Recheck pins, live main, index and status. In `D:/dev/afldb-rem-20261114`, commit only the five issue files listed below on `claude/remediation-20261114`, whose parent must be `b82a6b04`. Create a clean local `main` checkout at `D:/dev/afldb-main-closeout-20261121` from local `ea9bddf8`; fast-forward it through the published tip to the verified issue-only child. Use normal `git worktree remove` on each of the six named candidates only after checking its exact path, branch, HEAD, ancestry and staged, unstaged, untracked and ignored status again. Leave branch refs intact. Recheck live ancestry, all registrations and both the clean main checkout and the original dirty primary directory. If any precondition changes, retain the affected checkout. Publication, enhancement integration, deployment and host operations have separate scopes. A fetch is unnecessary while the tracking and live refs agree.

Five issue files for that commit:

- `IssuesIndex.md`
- `issues.md`
- `issues/open/AFLDB-ISSUE-368.md`
- `issues/reviews/AFLDB-FULL-REVIEW-2026-11-21.md`
- `issues/reviews/AFLDB-CLOSEOUT-WORKTREES-2026-11-21.md`

**Open issues after this review:** 332, 348, 350, 351, 352, 357, 362, 363, 364, 367, 368 and 369. Production scheduling, browser evidence and data decisions remain with the corresponding issue owners. No application, migration, deployment or changelog edit was made.
