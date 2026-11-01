# V2-GAP-006 follow-up: repair-tool checkout update (7b4c609b), owner-attended package

**Status: PREPARED, NOT EXECUTED.** Nothing in this file has run on production. No push, no production access, no repair
tool execution of any kind (not even a dry run, which would connect to the database) was made in preparing it.
V2-GAP-006 stays **closed** under its accepted scope (D-V2-GAP006-SCOPE-1); this package is its recorded operational
follow-up (known-gaps.md, V2-GAP-006, "Operational follow-ups" item 1).

## 1. Verdict

**Supported as an operator-tool-only checkout update.** The outgoing delta from the last recorded production checkout to
the package commit changes exactly one executable file, `tools/current-season/repair-match-rekeys.ts` (+6 / -0), plus
documentation, `CHANGELOG.md`, `issues.md`, `IssuesIndex.md` and two test files. Application source, packages,
dependencies, lockfile, framework and TypeScript config, `deploy/`, `data/`, migrations and every other tool are
byte-identical. **No application build, no release promotion and no service restart is needed or proposed.**

What this does and does not do:

| | |
|---|---|
| Does | Fast-forwards the operator checkout `/home/arm/projects/afldb` so `repair-match-rekeys.ts --apply` refuses a sealed season offline, before any database connection |
| Does not | Execute the tool in any mode; build; promote; restart; change `.env`, the release root, a grant, a schema or data; authorise `--apply` |

## 2. Evidence for the verdict

All of section 2.1 is enforced by `docs/v2/evidence/gap006-repair-rollout-20261101/static-delta-check.sh` (Git objects only,
no network, fails closed on a missing object). It ran on the workstation during preparation (positive case plus three
negative controls that fail as they must, section 8).

### 2.1 The exact outgoing delta (workstation, enforced)

| Fact | Value |
|---|---|
| Last recorded production checkout `PROD_HEAD` | `9b9c6b2acda28e4d222c04a951275bdf654da74f` (tree `02971dd1ed0c3545482e700187f6519093654909`) |
| Fix `FIX` | `7b4c609bb07e0d5154d36bcae492263bb8b12d1b` (tree `c7a1cd652772dc2bf4c87e45a3bac55ddb319476`) |
| Candidate base `B` | `0596f0e054eb3ae714291efe535db4755b2de763` (tree `46898d915c48103c7ccc63b91e624384d7b85d25`) |
| `origin/main` before the push | `2d1d0a834f62a0bb5dda4c08e109e5d1bfe72b51` |
| Ancestry | `PROD_HEAD` → `FIX` → `B` → `R` (so the production update and the push are both fast-forwards); `PROD_HEAD..B` is 5 commits |
| `PROD_HEAD..R` outside `docs/`, `CHANGELOG.md`, `IssuesIndex.md`, `issues.md`, `tests/` | **exactly** `tools/current-season/repair-match-rekeys.ts` |
| `PROD_HEAD..R` inside `tests/` | exactly `tests/afl-api-settle-cli-gate.test.ts` and `tests/v2-season-seal.test.ts` (not served, not run on production) |
| `PROD_HEAD..R` on `src`, `packages`, `deploy`, `data`, `package.json`, `package-lock.json`, `next.config.ts`, `tsconfig.json` | **empty** |
| `PROD_HEAD..R` on other `tools/`, `src/db/migrations`, `scripts`, `public`, `.gitignore`, `.gitattributes` | **empty** |
| `B..R` outside docs, `CHANGELOG.md`, `IssuesIndex.md`, `issues.md` | **empty** (the package commit adds documentation and one script only) |
| Repair tool blob | before `a2de99e0fb6c73cce00e409915871a66503f3c2b`, after `dca00bd85d2eed909d0a042ebdba35e9602f6605` (identical at `FIX`, `B` and `R`) |
| Repair tool sha256 after (LF bytes) | `3eaf23c58fe38fab9375da86f669c564ca7544be3b50d079c9862046e93417db` (before: `a6bd0e00b08838c70641018ba9f2c042e9b74c72301c29f7f1c6322eb28218e7`) |
| Executable change | `--numstat` 6 added / 0 removed: one import (`refuseSealedSeasonForSettle` from `./settle-season-seal`), one call `if (args.apply) refuseSealedSeasonForSettle(projectRoot, args.season);`, four comment lines |
| Where the guard sits | before the `AFLDB_IMPORT_DATABASE_URL` read and before `postgres(...)` (static line order enforced: 681 < 684 < 686). The dry run is untouched |
| Guard dependencies unchanged | `tools/current-season/settle-season-seal.ts` `fc16aecf…`, `packages/domain/src/season-seal.ts` `7e7dfbeb…`, `packages/domain/src/index.ts` `be2f8bd6…`, `data/reference/seasons.json` `4c17ff9c…` (identical blobs at `PROD_HEAD` and `R`) |
| Callers of the tool | none in `deploy/`, `package.json`, `src/` or `packages/`; no timer or unit invokes it. `tools/db/promotion-inventory.ts` only mentions it in a comment |

### 2.2 Why the serving release does not depend on the operator checkout

What the repository proves (read, not executed):

* `deploy/afldb.service.d/release-route.conf` (ISSUE-329) sets `WorkingDirectory=/home/arm/afldb-releases/current`, so
  `ExecStart=… deploy/server-cluster.mjs` resolves **inside the release**. systemd resolves the `current` symlink once,
  at service start; the running service stays on the release it started in.
* `deploy/release.mjs` refuses a release root inside the checkout (`checkRootOutsideCheckout`), builds from a
  `git archive` extract (`extract`), and refuses a release containing any symlink that resolves outside itself
  (`linksOutside`: "a link into the checkout would make the release depend on a directory that changes later").
* Production serves release `fd48ace0c2cb-pqAQwRIJWLjSYzR8LiTuy`, built from `fd48ace0` and promoted 2026-11-01
  (`gap006-editor-protections-release-package.md` 11.3). The checkout moved off that build revision afterwards
  (`9b9c6b2a` is its documentation descendant) without any effect on the service.
* The service's one read from the checkout is `EnvironmentFile=/home/arm/projects/afldb/.env`, read **at service start**.
  `.env` is git-ignored (`.gitignore:58`) and untracked, so a fast-forward cannot change it; its mode, owner, size and
  mtime are compared before and after anyway.
* This update changes no input of any other unit that runs from the checkout (`deploy/`, `src/`, `packages/`, `data/`
  and every other tool are identical), and no unit calls the repair tool.

**What the repository cannot prove, and the package therefore proves live (P-A, read-only, no sudo):** that the
*installed* unit actually carries that drop-in today. P-A requires the unit's `WorkingDirectory` to be
`/home/arm/afldb-releases/current`, the drop-in to be listed, the main process's `/proc/<pid>/cwd` to be the serving
release directory, and **no process of the unit's cgroup to have its working directory inside the checkout**. If any of
those fails, the independence claim is false and this package does not apply (STOP, section 6).

### 2.3 Tests and negative controls: reused, not repeated

`7b4c609b` carries the evidence (its commit message and the 2026-11-01 `CHANGELOG.md` entry): five gate cases in
`tests/afl-api-settle-cli-gate.test.ts` (sealed 2026 and predecessor-sealed 2025 refused with the sql stub untouched;
dry run, in-progress 2027 and synthetic 2093 still reach the database path), the source-level writer inventory in
`tests/v2-season-seal.test.ts`, a negative control (the two refusal cases fail with the guard removed) and a clean
typecheck. The static check enforces that **the tool and both test files at `R` are blob-identical to `7b4c609b`**, so that
evidence applies to the bytes that will be installed. Nothing was re-run for this package: no changed code justifies it.
These results are isolated-test evidence from the earlier session as recorded; **the guard is not exercised on
production** by this package (that would mean running the tool there, which is not authorised).

## 3. Variables

`R` is the approved package commit. A commit cannot contain its own hash, so it is stated in the owner's approval
(section 7) and equals `git rev-parse HEAD` on the workstation. Every block refuses anything that is not 40 lowercase
hex, so the unresolved placeholder fails safe. Do not adjust any expected value: a mismatch is a STOP.

```bash
# workstation (Git Bash)
R=REPLACE_WITH_40_HEX_R
PKG=docs/v2/evidence/gap006-repair-rollout-20261101
ORIGIN_MAIN=2d1d0a834f62a0bb5dda4c08e109e5d1bfe72b51
```

```bash
# production, as arm -- paste at the start of EVERY production session or SSH call
R=REPLACE_WITH_40_HEX_R
PKG=docs/v2/evidence/gap006-repair-rollout-20261101
PROD_HEAD=9b9c6b2acda28e4d222c04a951275bdf654da74f
SERVING_ID=fd48ace0c2cb-pqAQwRIJWLjSYzR8LiTuy       # serving release; must stay the selected one
ROLLBACK_ID=ad245d602f6f-m0M8pf121326vNSo2B759      # `previous`; must stay as it is
ROOT=/home/arm/afldb-releases
CHK=/home/arm/projects/afldb
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node
TOOL=tools/current-season/repair-match-rekeys.ts
BLOB_OLD=a2de99e0fb6c73cce00e409915871a66503f3c2b
BLOB_NEW=dca00bd85d2eed909d0a042ebdba35e9602f6605
SHA_NEW=3eaf23c58fe38fab9375da86f669c564ca7544be3b50d079c9862046e93417db
PRE=/home/arm/gap006-repair-rollout-pre.txt         # written by P-A, read by D2; refuses to be overwritten
```

Transport (as in the revision 3 package): one SSH session per phase, using Windows OpenSSH; save each production block
as an LF script and run it by path (PowerShell mangles `$(...)` in ssh arguments). Claude never uses `sudo`.

## 4. Who does what

| Step | Who | Authority |
|---|---|---|
| W0 workstation static checks | Claude | local read-only Git, plus `git ls-remote origin` (read-only) |
| D0 push of exactly `R` | **Owner** (workstation) | push to `origin/main`, fast-forward, no force |
| P-A production read-only checks | Claude over SSH as `arm` | no sudo; reads only; writes `$PRE` in `/home/arm` |
| D1 fetch + fast-forward | Claude over SSH as `arm` | changes tracked files in the checkout only |
| D2 post-install verification | Claude over SSH as `arm` | reads only |
| R-1 checkout restore (only on a failed D2) | Claude over SSH as `arm` | section 6.2 preconditions |

## 5. Procedure (relative; owner-attended start)

Every block runs in a subshell with `set -euo pipefail`: the first failed assertion stops it with a non-zero status and
prints no PASS line; a pasted block never closes your shell.

**W0. Workstation static checks (Claude).**

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd /d/dev/afldb
  [ "$(git rev-parse HEAD)" = "$R" ]
  [ -z "$(git status --porcelain | grep -v '^?? \.codex/$' || true)" ]        # clean, apart from untracked .codex/
  bash "$PKG/static-delta-check.sh" "$R"                                      # section 2.1; prints PASS or exits 1
  [ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$ORIGIN_MAIN" ]    # nobody pushed since
  echo "W0 PASS"
)
```

**D0. Push (Owner, workstation).** No force: a non-fast-forward is rejected.

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd /d/dev/afldb
  [ "$(git rev-parse HEAD)" = "$R" ]
  [ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$ORIGIN_MAIN" ]
  git push origin "$R:refs/heads/main"
  [ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$R" ]
  echo "D0 PASS"
)
```

**P-A. Production read-only checks, and the "before" snapshot (Claude).** Nothing has changed before D1. The
`pgrep` pattern is bracketed so the check cannot match its own command line.

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"
  [ ! -e "$PRE" ]
  # checkout identity: still where it was recorded, clean, the old tool bytes
  [ "$(git rev-parse HEAD)" = "$PROD_HEAD" ]
  [ -z "$(git status --porcelain)" ]
  [ "$(git rev-parse "HEAD:$TOOL")" = "$BLOB_OLD" ]
  [ "$(git hash-object "$TOOL")" = "$BLOB_OLD" ]
  [ -z "$(pgrep -f '[r]epair-match-rekeys' || true)" ]                        # the tool is not running
  # the release route: what is selected and retained
  [ "$(readlink "$ROOT/current")"  = "releases/$SERVING_ID" ]
  [ "$(readlink "$ROOT/previous")" = "releases/$ROLLBACK_ID" ]
  [ -z "$(ls "$ROOT"/*.lock 2>/dev/null || true)" ]
  # the service serves the release, not the checkout (section 2.2)
  [ "$(systemctl show -p ActiveState --value afldb)" = active ]
  [ "$(systemctl show -p WorkingDirectory --value afldb)" = "$ROOT/current" ]
  [[ "$(systemctl show -p DropInPaths --value afldb)" == *release-route.conf* ]]
  PID=$(systemctl show -p MainPID --value afldb); [ "$PID" -gt 1 ]
  [ "$(readlink "/proc/$PID/cwd")" = "$ROOT/releases/$SERVING_ID" ]
  CG=$(systemctl show -p ControlGroup --value afldb)
  for p in $(cat "/sys/fs/cgroup$CG/cgroup.procs"); do
    c=$(readlink "/proc/$p/cwd" || true)
    case "$c" in "$CHK"|"$CHK"/*) echo "process $p of the unit runs inside the checkout: $c"; exit 1;; esac
  done
  "$N" deploy/release.mjs status                                              # exit 0 only on STATUS PASS (writes nothing)
  "$N" deploy/release.mjs verify "$SERVING_ID"                                # the serving release still matches its manifest
  [ "$(curl -s -o /dev/null -m 10 -w '%{http_code}' http://127.0.0.1:3100/api/health)" = 200 ]
  avail=$(df --output=avail -k /home/arm | tail -n 1 | tr -d ' '); echo "free ${avail} KB"; [ "$avail" -ge 1048576 ]
  {
    printf 'PRE_HEAD=%s\n' "$(git rev-parse HEAD)"
    printf 'PRE_PID=%s\n' "$PID"
    printf 'PRE_NRESTARTS=%s\n' "$(systemctl show -p NRestarts --value afldb)"
    printf 'PRE_ACTIVE_ENTER=%s\n' "$(systemctl show -p ActiveEnterTimestampMonotonic --value afldb)"
    printf 'PRE_ENV=%s\n' "$(stat -c '%a:%U:%s:%Y' "$CHK/.env")"              # mode:owner:size:mtime; the value is never read
  } > "$PRE"
  cat "$PRE"
  echo "P-A PASS"
)
```

**D1. Fetch and pinned fast-forward (Claude).** The fetched remote must equal `R` before anything moves, the static
check runs again on production from `R`'s own pinned bytes, and the fast-forward is to the pinned `R`, never to whatever
`origin/main` happens to be.

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"
  [ -f "$PRE" ]
  [ "$(git rev-parse HEAD)" = "$PROD_HEAD" ]; [ -z "$(git status --porcelain)" ]
  git fetch origin
  [ "$(git rev-parse refs/remotes/origin/main)" = "$R" ]                      # fetched remote == the approved R
  git cat-file -e "$R^{commit}"
  git show "$R:$PKG/static-delta-check.sh" | bash -s -- "$R"                  # enforced on production, pinned bytes
  git merge --ff-only "$R"                                                    # PROD_HEAD -> R, pinned
  echo "D1 PASS (identity checks follow in D2)"
)
```

**D2. Post-install verification (Claude).** Proves the new identity, that only the expected bytes moved, and that the
service did not notice.

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"; . "$PRE"
  # checkout identity after
  [ "$(git rev-parse HEAD)" = "$R" ]
  [ -z "$(git status --porcelain)" ]; git diff --quiet "$R" --                 # tracked tree == R
  [ "$(git rev-parse "HEAD:$TOOL")" = "$BLOB_NEW" ]
  [ "$(git hash-object "$TOOL")" = "$BLOB_NEW" ]
  [ "$(sha256sum "$TOOL" | cut -d' ' -f1)" = "$SHA_NEW" ]
  [ -z "$(git diff --name-only "$PROD_HEAD" HEAD -- src packages deploy data package.json package-lock.json next.config.ts tsconfig.json)" ]
  git diff --stat "$PROD_HEAD" HEAD -- tools
  # the service did not move
  [ "$(readlink "$ROOT/current")"  = "releases/$SERVING_ID" ]
  [ "$(readlink "$ROOT/previous")" = "releases/$ROLLBACK_ID" ]
  [ "$(systemctl show -p MainPID --value afldb)" = "$PRE_PID" ]
  [ "$(systemctl show -p NRestarts --value afldb)" = "$PRE_NRESTARTS" ]
  [ "$(systemctl show -p ActiveEnterTimestampMonotonic --value afldb)" = "$PRE_ACTIVE_ENTER" ]
  [ "$(stat -c '%a:%U:%s:%Y' "$CHK/.env")" = "$PRE_ENV" ]
  [ -z "$(ls "$ROOT"/*.lock 2>/dev/null || true)" ]
  "$N" deploy/release.mjs status
  "$N" deploy/release.mjs verify "$SERVING_ID"
  [ "$(curl -s -o /dev/null -m 10 -w '%{http_code}' http://127.0.0.1:3100/api/health)" = 200 ]
  [ -z "$(pgrep -f '[r]epair-match-rekeys' || true)" ]                        # still never run
  echo "D2 PASS: checkout $PRE_HEAD -> $R; repair tool $BLOB_OLD -> $BLOB_NEW; service PID $PRE_PID unchanged"
)
```

After D2, Claude records the outcome in this file (section 9), `CHANGELOG.md` and `known-gaps.md` as a scoped local
commit. It does not push that record unless separately approved.

## 6. Stop conditions and recovery

### 6.1 Stop conditions (stop, do not adjust an expected value, report)

* any W0, P-A, D1 or D2 assertion fails, including a missing Git object;
* `origin/main` is not exactly `2d1d0a83` before D0, or the fetched remote is not exactly `R` at D1;
* the checkout is not at `9b9c6b2a`, is not clean, or the tool blob is not `a2de99e0…` at P-A;
* the unit's `WorkingDirectory` is not the release `current`, the drop-in is absent, or **any** process of the unit has
  its working directory inside the checkout: the independence claim is false and this package does not apply (a release
  would then be needed; do not improvise one);
* `current` or `previous` is not as recorded, a release lock exists, `status` or `verify` fails, or health is not 200;
* the repair tool is running, or any step would require executing it.

Before D1 nothing has changed, so a stop there needs no recovery. A stop at D1 before `git merge` leaves the checkout
untouched (a fetch only moves a remote-tracking ref).

### 6.2 R-1: checkout restore (only if D2 fails after the fast-forward)

The service is not involved, so recovery is a checkout restore only. It is for the case where the checkout is exactly `R`
and clean, so nothing local is lost; any other state is a STOP for the owner.

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"
  [ "$(git rev-parse HEAD)" = "$R" ]; [ -z "$(git status --porcelain)" ]
  git reset --hard "$PROD_HEAD"
  [ "$(git rev-parse HEAD)" = "$PROD_HEAD" ]; [ -z "$(git status --porcelain)" ]
  [ "$(git hash-object "$TOOL")" = "$BLOB_OLD" ]
  echo "R-1 PASS: checkout restored to $PROD_HEAD"
)
```

Restoring returns the sealed-season gap on `--apply`, so the production `--apply` prohibition (section 7) is back in force.

## 7. Authority, and what is not authorised

Execution begins only on this approval, with `<R>` filled in (the workstation prints it: `git rev-parse HEAD`):

```text
I approve execution of the GAP-006 repair-tool rollout package
(docs/v2/gap006-repair-tool-rollout-package.md) at R=<R>: a fast-forward push of exactly R to origin/main
(from 2d1d0a834f62a0bb5dda4c08e109e5d1bfe72b51) and a pinned fast-forward of the production checkout
/home/arm/projects/afldb from 9b9c6b2acda28e4d222c04a951275bdf654da74f to R. This is a checkout-only update: no
build, no promotion, no restart, serving release fd48ace0c2cb-pqAQwRIJWLjSYzR8LiTuy untouched.

Claude may: run W0 on the workstation; run, as arm over SSH without sudo, P-A, D1 and D2 exactly as written (P-A
writes only /home/arm/gap006-repair-rollout-pre.txt, D1 changes only tracked files in the checkout); run R-1 only
after a failed D2 and only under its stated preconditions; commit the scoped outcome record locally.
I will do: the D0 push of exactly R from the workstation.

Claude must not: execute tools/current-season/repair-match-rekeys.ts in any mode, including a dry run; use sudo;
restart or reload the unit; build or promote anything; touch the release root, .env, the database, any grant, a
frozen store or any backup; push anything other than R; or continue past a failed check. Installing the tool does
not authorise --apply: any production use of the tool, dry run or --apply, needs its own explicit approval of target,
scope and safeguards. V2-GAP-006 stays closed under D-V2-GAP006-SCOPE-1; GAP-011, ISSUE-316 and ISSUE-331 are
unaffected.
```

Not authorised and not done by this package: running the repair tool, a release build or promotion, a service restart, any
database or grant change, writer activation, provider access, a Brownlow operation, deleting retained material.

## 8. Preparation record (workstation, 2026-11-01, local only)

* `static-delta-check.sh`, positive case (`R` = the base `0596f0e0`, the only commit that exists before the package commit
  is made): **PASS**, 33 checks. Negative controls, each **FAIL** as required: `R` = production checkout `9b9c6b2a` (16
  failures: the fix is absent); `R` = the fix `7b4c609b` (1 failure: the base is not an ancestor of it); a non-existent
  object (fails on the missing object rather than passing an empty diff). The check is re-run on the real `R` at W0.
* No SSH, no `git fetch` or `git ls-remote`, no database or provider contact, no test or tool execution, no build.
* Not verified live (by design; P-A does it): the installed unit's drop-in, the serving process's working directory, the
  production checkout's present state. Those facts come from `ISSUE-329` and the revision 3 execution record.

## 9. Execution record

_Not executed. To be appended after the owner's approval and the run._
