# AFLDB-ISSUE-346 — gated migration-only DEV route (runbook)

- **Status:** OPEN. Implemented and qualified in isolation on local branch `claude/issue-346-gated-migrate`
  (from `origin/main` `12aa6e29`). **Not pushed:** `origin/main` is frozen until the ISSUE-336 production
  release D1 passes. Resolve only after publication.
- **Owner decisions 2026-11-11:** residuals R1–R5 **accepted** with the exact §4a statement, as recorded at `50da084c`.
  Publication is approved under OD-6, after the ISSUE-336 D1 PASS. Resolve after publication.
- **Permanent owner rule (R1):** never run `npm run db:migrate` by hand on DEV. Migrations reach DEV only through
  `sync-dev.ps1` (a full deploy, or this route) with an approved transition.
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

**Binding operator restrictions (owner acceptance of R1–R5, 2026-11-11; §4a):**
1. **R1.** Never run `npm run db:migrate` by hand on DEV. Use only `sync-dev.ps1` with an approved transition.
2. **R2.** Use this route only when a full deploy at the same pin follows in the same approval window. Read the
   assessment's `checkout change outside src/db/migrations` line first. If it names `deploy/server-cluster.mjs` or
   `package-lock.json`, or a DEV timer would fire before the follow-up full deploy, run the full deploy instead.
3. **R3.** If the migration child fails (for example exit 1 on a ref or worktree collision), do not retry. Read its
   message, remove the cause, then start again from assess. Never combine this route with `-AllowDirtyServer`.
4. **R4.** An exported `AFLDB_TEST_DATABASE_URL` is not a refusal and needs no action (`--target dev` never reads it).
5. **R5.** Before execute, confirm that the role in the assessment's `database identity` line is DEV's migration owner
   role. Stop if it is not.

`docs/deployment.md` (a qualified file read by unit suites) is unchanged, so it states only R1 and the follow-up rule.
Fold R2's exceptions, R3 and R5 into it in a later documentation change, run with the suites that read it.

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

### 4a. Reconciled decision table (2026-11-11, second run 8 session; supersedes the `issues.md` summary list)

The `issues.md` summary listed seven items with grades; this section's original list (4b) has six. Reconciliation:
the summary's seventh item (the `-SkipBuild` label wording) is a documented design choice (§1 item 1) with no state or
decision consequence, so it is INFO and not a residual; the summary omitted R3's `-AllowDirtyServer` clause; and R4
and R6 are demonstrated safe, so they are regraded INFO. Line references are at the publication tip `3218abf9`.

| # | Residual | Concrete consequence | Existing protection | Operator action | Kind | Recommended disposition |
|---|---|---|---|---|---|---|
| R1 | A manual `npm run db:migrate` on the DEV host is still possible | Every pending migration is applied with no approved transition, no backup or artifact evidence and no evidence record | `migrate.ts` itself, before it connects: explicit known target only (`tools/db/migrate.ts:109-136`); filename collisions in the checkout and across refs and worktrees, branch-local migrations (refused on DEV without `--allow-branch-local`) and changed base migrations (`:185-234`). The gated route now exists, so there is no operational reason to run it by hand | Keep the rule permanently: migrations reach DEV only through `sync-dev.ps1` (full deploy, or this route) with an approved transition; never `db:migrate` by hand | **Accepted operational limitation** (procedural control) | Accept, LOW. No technical block now |
| R2 | The checkout and `npm ci` advance to the pin without a rebuild or restart | Until the follow-up full deploy, the old `.next/standalone` serves while a supervisor respawn (worker, systemd or reboot) runs the pin's `deploy/server-cluster.mjs`, and timers and tools run the pin's code, all against the migrated schema | `INFO checkout change outside src/db/migrations` in the **assessment** (`deploy/sync-dev-remote.sh:621-631`), naming `server-cluster.mjs` and `package-lock.json`; the gate's running-jobs, timer and window checks before execute; post-migration parity (44) and a readiness probe of the untouched service | Read the INFO line at assess. Use the route only when a full deploy at the same pin follows in the same approval window; if the line names `server-cluster.mjs` or `package-lock.json`, or a timer fires before that follow-up, run the full deploy instead | **Accepted operational limitation** | Accept, MED, with the operator rule |
| R3 | Collisions with **other** refs or worktrees on the host are refused only inside the `migrate.ts` child; under `-AllowDirtyServer` the child reads the working tree | The child exits 1 after the checkout and `npm ci` moved: R2's state without the migration, and a rerun or full deploy at the pin refuses the same way until the stray ref or worktree is gone. **The database is unchanged**: `checkMigrationSafety()` runs at `migrate.ts:236`, before the first connection at `:239`. With `-AllowDirtyServer`, an extra working-tree migration is branch-local and a modified one is "changed": both refused the same way | `migrate.ts`'s cross-ref inventory, before connecting; the gate's `afldb_pf_migration_set` already refuses at 40, before checkout, everything the target revision decides (W-346 r13–r15) | If the child exits 1, do not retry: read its message, remove the stray ref or worktree, then rerun assess. Never combine this route with `-AllowDirtyServer` | Data safety **by construction** (code order; the other-worktree case was not exercised in W-346); late refusal is an **accepted operational limitation** | Accept, LOW (regraded from MED: no data effect, recoverable) |
| R4 | An exported `AFLDB_TEST_DATABASE_URL` is not refused | None. `--target dev` reads only `AFLDB_OWNER_DATABASE_URL` (`migrate.ts:78-80, 139-140`), and the pinned child line unsets that and `AFLDB_MIGRATE_TARGET`, so the single bound `.env` DSN is used | **Demonstrated:** T2 and W-346 x1 (A 117 → 118, B unchanged). `AFLDB_MIGRATE_TARGET=test`, alone or with it, is refused (r05, r06) | None | **Demonstrated safety**; it departs from the owner's original "refusal" criterion, so the owner acknowledges the replacement | Accept as a non-refusal, INFO. No code change |
| R5 | The identity check compares the database name only; `current_user` is recorded, not compared (`sync-dev-remote.sh:945-952`) | A `.env` DSN naming `afldb_dev` but logging in as another role, or reaching another cluster with that database name, passes identity. A wrong role either lacks the DDL privileges or creates objects with the wrong owner, which can break the fail-closed application read grants | The identity PASS line prints `<database> <role> via <DSN name>` in the assessment; the one-plain-DSN `.env` binding; the ledger compare against the target revision and the approved before-count (a different cluster must also match them) | Before execute, confirm that the role in the assessment's `database identity` line is DEV's migration owner role | **Accepted operational limitation** | Accept, LOW. Optional later: an `-ExpectedRole` check |
| R6 | Payload headroom about 1,000 base64 characters (largest 22,956 of 24,000) | A future gate addition could push a payload over the SSH-argument limit | `sync-dev.ps1:438` throws while generating, before any SSH connection; the static harness asserts the sizes | None now; a future gate change re-runs the size assertions | **Demonstrated safety** (fails closed) | No decision needed, INFO |

**Acceptance statement (covers R1–R5; R6 and the label wording need no decision; independent of OD-1):**

```text
I, Stuart, accept the AFLDB-ISSUE-346 residuals R1 to R5 as reconciled in issues/open/AFLDB-ISSUE-346.md §4a for the migration-only DEV route, sync-dev.ps1 -Phase execute -SkipBuild -SkipRestart, at code commit 87653d5e1b090cef2175e4154a46489eb22b1adf (carried byte-identically as feca4f11 on claude/records-catchup-20261111). R1: a manual db:migrate stays technically possible, and the rule "migrations reach DEV only through sync-dev.ps1 with an approved transition; never run db:migrate by hand on DEV" becomes permanent. R2: the checkout and node_modules advance while the old build serves, so the route is used only when a full deploy at the same pin follows in the same approval window, after reading the assessment's "checkout change outside src/db/migrations" line, and the full deploy is used instead when that line names deploy/server-cluster.mjs or package-lock.json or a timer would fire first. R3: collisions with other refs or worktrees are refused only by the migrate.ts child after the checkout has moved, with the database unchanged; a failed child is not retried, and the route is never combined with -AllowDirtyServer. R4: an exported AFLDB_TEST_DATABASE_URL is not a refusal, because --target dev never reads it (case x1), and this replaces my earlier "refusal" criterion. R5: the identity check compares the database name only, so the role shown in the assessment's database-identity line is confirmed before execute. This accepts residuals only. Publication stays under its own approval, and ISSUE-346 is resolved after publication.
```

### 4b. Original list (as qualified)

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
