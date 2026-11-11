# AFLDB-ISSUE-346 — gated migration-only DEV route (runbook)

- **Status:** OPEN. Implemented and qualified in isolation on local branch `claude/issue-346-gated-migrate`
  (from `origin/main` `12aa6e29`). **Not pushed:** `origin/main` is frozen until the ISSUE-336 production
  release D1 passes. Resolve only after publication.
- **Interim owner rule (still in force):** never run `npm run db:migrate` by hand on DEV. It stays in force until
  the owner publishes this route.
- Ledger entry: [`issues.md` → AFLDB-ISSUE-346](../../issues.md#afldb-issue-346). Gate background:
  [`issues/closed/AFLDB-ISSUE-339.md`](../closed/AFLDB-ISSUE-339.md).

## 1. Design (route a)

The route is the existing gated `deploy/sync-dev.ps1 -Phase execute -SkipBuild -SkipRestart` with a pin and an
approved transition. There is no new entry point, and route (b), a wrapper, was rejected. It would duplicate the
gate wiring that `sync-dev.ps1` already generates.

What the route reuses unchanged (`deploy/sync-dev-remote.sh`, `afldb_deploy_gate` and the revalidations):
- host, repository and origin; the operational-file allowlist; branch, upstream and a published pin;
- `afldb_pf_migration_binding` (R339-A): no exported DSN or target, and one plain `.env` DSN line;
- database identity, ledger compare and the approved transition `-ExpectedLedgerBefore/-After`;
- backup, artifact, approval window, running jobs and timers;
- checkout revalidation (42), pre-migration revalidation (43), the pinned child line
  `env -u AFLDB_MIGRATE_TARGET -u AFLDB_OWNER_DATABASE_URL npm run db:migrate -- --target dev`,
  post-migration parity (44), a readiness probe of the untouched service, and preserved state (46).

With `-SkipBuild -SkipRestart` the build, the pre-restart revalidation and the restart are not generated.

Additive changes:
1. `sync-dev.ps1` passes the planned mutation steps to the gate as `AFLDB_PF_STEPS` and prints them in the header.
   On this route the value is `checkout install migrate health (migration-only route, AFLDB-ISSUE-346; build and
   restart skipped)`. With `-SkipBuild`, the identity step reports `serving BUILD_ID (not rebuilt)` instead of
   `built BUILD_ID`. This label change also applies to a `-SkipBuild` run that restarts, which is not this route.
   The commands, and the variable `AFLDB_BUILT_BUILD_ID`, are unchanged.
2. The gate records `INFO planned mutation steps` and `INFO checkout change outside src/db/migrations`. The second
   line counts the non-migration files the checkout changes, and flags `deploy/server-cluster.mjs` and
   `package-lock.json`.
3. A new gate check, `afldb_pf_migration_set`, refuses before checkout what `tools/db/migrate.ts`
   (`checkMigrationSafety`) would refuse before connecting, where the target revision decides it:
   - a name that is not `NNN_description.sql` (mirrors `tools/db/migration-safety.ts:37`; a static test pins
     both literals);
   - one number claimed by two names (prefixes compared as strings, as `findMigrationConflicts` does);
   - set parity with `migrate.ts`'s base (`refs/remotes/origin/main`, else `refs/heads/main`): a branch-local
     migration, a missing base migration, or one name with two contents.

   It is skipped (INFO) under `-SkipMigrate`, as the binding is. For a migrating deploy it only refuses earlier
   (40, before checkout) what the child refused later (exit 1, after the checkout moved).

Baseline equivalence (T3): for every building or restarting argument set, the generated step section differs from
`12aa6e29` by exactly one added line, `AFLDB_PF_STEPS=...`. The sets were default, pinned, pinned-approved,
ISSUE-107, ISSUE-107 + respawn, assess, `-SkipMigrate` and custom-dirty. The helper diff is additions only, in
three hunks. Payload sizes are within the 24,000-character limit; the largest is 22,956.

## 2. Operator command (once published)

Assess first, then execute with the same arguments. Run from the workstation, in the DEV approval window.

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\sync-dev.ps1 -Phase assess -SkipBuild -SkipRestart `
  -RemoteRef dev-v2-main -ExpectedBranch dev-v2-main -ExpectedRevision <40-hex published pin> `
  -ExpectedLedgerBefore <n> -ExpectedLedgerAfter <m> -RestartMethod respawn `
  -BackupDir <verified backup dir> -ArtifactArchive <archive of the serving build> `
  -ApprovalWindowStart <ISO+offset> -ApprovalWindowEnd <ISO+offset>
# exit 0 READY -> rerun the identical command with -Phase execute
```

- Exit codes are unchanged: 40 BLOCKED, 41 PREPARATION REQUIRED, 42–46 revalidations, 47 transport. A failing
  child keeps its own status (for example 1).
- The branch name above is DEV's current deploy branch (ISSUE-336). Confirm it in the assessment output.
- **Follow-up rule:** the checkout and `npm ci` advance to the pin while the old build keeps serving. Follow with a
  full deploy at the same pin in the same window. No ledger arguments are needed then, because nothing is pending.
- Read `INFO checkout change outside src/db/migrations` in the assessment. If it is not `0 file(s)`, the
  supervisor, timers and tools will run new code against the old build until that full deploy.

## 3. Qualification (2026-11-11)

Code commit: `87653d5e1b090cef2175e4154a46489eb22b1adf`. Evidence:
[`docs/v2/evidence/issue346-gated-migrate-20261111/`](../../docs/v2/evidence/issue346-gated-migrate-20261111/).

| Harness | Where | Result |
|---|---|---|
| `tests/sync-dev-static.test.ps1` (Windows PowerShell 5.1, Git for Windows bash) | workstation, `D:\dev\afldb-i346` | PASS |
| `tests/sync-dev-remote.test.sh` (with the exported payloads) | streamanator `/mnt/ssd/afldb-i346-w346-20261111/clone` (GitHub clone + bundle, HEAD verified) | **86 passed, 0 failed** (63 existing + 23 new) |
| Red check: the same harness, with the migration-only payload generated from the `12aa6e29` helper | streamanator `/mnt/ssd/afldb-i346-dev` | 81/5; the 5 failures are exactly the positive evidence case and the 4 migration-set refusals |
| T3 baseline equivalence | workstation | as in §1 |
| W-346 write-mode rehearsal | streamanator `/mnt/ssd/afldb-i346-w346-20261111` | **17/17 PASS** |

The bundle sha256 is `2f587f83b54514dee5ef8afe2d1fceb6a0c020e6ad3c804cec866598040573b0`. The clone HEAD after the
bundle fetch was verified as `87653d5e`.

**W-346 design.** It follows the W-339 pattern, but drives the **real generated migration-only payload**:
- `sync-dev.ps1 -WhatIf -SkipBuild -SkipRestart`, with its paths, `-EvidenceDir`, `-ServiceName afldb-i346-rehearsal` and
  the health URL all inside the workspace or non-live;
- a guard grep before every run: no `/home/arm/projects/afldb`, no `/mnt/ssd/afldb/records`, no `sudo`, no `kill`,
  no build.

Each case used:
- a fresh published origin and checkout;
- real `git`, `psql` and `npm`/`tsx tools/db/migrate.ts`;
- fresh A and B databases from a marked `_test` template at ledger 117, with a sentinel row in B;
- one isolated cluster at `127.0.0.1:55546`, `cluster_name afldb_v2_isolated`. Before every database write, it was
  proven by `isolated-pg verify` and by the server facts: port, `listen_addresses`, the `_test` name, a write
  guard.

The run used these substitutes:
- stubs for `systemctl` and `curl` only, so no live unit and no health URL was touched;
- an `npm` wrapper that logs every call, so "no child" is observable, and skips only `npm ci`;
- `NVM_DIR` neutralised, so the wrapper stays first on PATH;
- a backup, artifact and `BUILD_ID` in fixture form;
- hostile variables exported only in the run's `env -i` environment.

The cluster was stopped afterwards. The workspace is kept.

| Case | What | Exit | Migration child | A / B / checkout after |
|---|---|---|---|---|
| w1 | approved 117 -> 118 | 0 | yes, once: `run db:migrate -- --target dev`, target and owner DSN unset | A 117 -> 118, first 117 rows unchanged, the 118 checksum = the blob sha256; B unchanged; checkout = pin; no build or restart; evidence: steps, binding, migration set, identity, `117 -> 118`, parity `118/118`, `RESULT exit=0` |
| x1 | only `AFLDB_TEST_DATABASE_URL`=B exported (non-refusal by construction) | 0 | yes, `--target dev` | A -> 118, **B unchanged** |
| r01 | no approval | 40 | no | unchanged |
| r02 | wrong before (116) | 40 | no | unchanged |
| r03 | wrong after (119) | 40 | no | unchanged |
| r04 | exported `AFLDB_OWNER_DATABASE_URL`=B | 40 | no | unchanged |
| r05 | exported `AFLDB_MIGRATE_TARGET=test` + `AFLDB_TEST_DATABASE_URL`=B | 40 | no | unchanged |
| r06 | all three (set H) | 40 | no | unchanged |
| r07 | wrong identity: `.env` names B, approval expects A | 40 | no | unchanged |
| r08 | wrong identity: expected `afldb_dev` | 40 | no | unchanged |
| r09 | wrong host | 40 | no | unchanged |
| r10 | ledger compare failure (checksum drift in A) | 40 | no | unchanged |
| r11 | dirty tree (tracked edit) | 40 | no | unchanged |
| r12 | unpublished or absent pin | 40 | no | unchanged |
| r13 | branch-local migration (pin on `origin/release-i346`, not `origin/main`) | 40 | no | unchanged |
| r14 | colliding number (`118_…` twice, counts approved 117 -> 119) | 40 | no | unchanged |
| r15 | missing base migration (pin behind an `origin/main` that added 119) | 40 | no | unchanged |

The Linux harness covers the same matrix with stubs (18 no-child refusals). It adds the following:
- a malformed name;
- duplicate `.env` DSN lines;
- an `.env` target, a running job (40) and missing preparation (41);
- parity failure, which keeps exit 44 with no build and no restart;
- a full deploy, whose steps and build/restart are unchanged.

Every refusal's gate evidence ends `RESULT exit=<same code>`. The leak scan checked all 34 generated DSN passwords,
plus credentialed URLs, against the evidence and found 0.

## 4. Residual gaps (for owner acceptance)

1. A manual `npm run db:migrate` on the host is still technically possible. The interim rule stays until
   publication; a technical block inside `migrate.ts` was out of scope.
2. The route advances the checkout (and `npm ci`) without a rebuild or restart. The service supervisor
   (`deploy/server-cluster.mjs`, through a worker respawn, a systemd respawn or a reboot), the timers and the tools
   run the pin's code against the old `.next/standalone` until the follow-up full deploy. It is recorded
   (INFO line) and handled by an operator rule, not refused.
3. Migration collisions with **other** refs or worktrees on the host are still refused only by `migrate.ts`. That
   happens inside the child, before any database connection, after the checkout moved (exit 1, ledger unchanged).
   Under `-AllowDirtyServer`, the child reads the working tree, not the target revision.
4. The owner listed `AFLDB_TEST_DATABASE_URL` pointing at another database under "refusal". It is **not** a
   refusal by construction: `--target dev` never reads it, and the gate does not refuse it. The proof instead is
   that the child still writes only the bound database (T2 and W-346 case X1). `AFLDB_MIGRATE_TARGET=test`, alone
   or with it, is refused.
5. The identity check compares the **database name** only. `current_user` is recorded but not compared.
6. Payload headroom is about 1,000 base64 characters below the 24,000 SSH-argument limit. The existing size
   assertions catch an overflow.

## 5. Not done here

No push, no DEV, no production, and no edits to `issues.md`, `IssuesIndex.md`, `CHANGELOG.md` or `blockers.md`.
The main session applies the tracking text. `preflight --mode deploy` (ISSUE-339 D3) and `deploy/release.mjs` are
unchanged.
