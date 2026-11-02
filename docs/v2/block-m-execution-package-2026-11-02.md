# Block M: migration 118, compatible release (M-a) and first 2027 fixture window (M-b): execution package (2026-11-02)

**Status: PREPARED. NOTHING WAS RUN ON PRODUCTION.** Every production-host command below is unrun. What *was* run is a host-phase rehearsal of the real `m-prod.sh` phases on an isolated production-derived clone (section 4), the static delta check with negative controls, and the Linux `npm run typecheck`. No push, migration, build, promotion, restart, fixture apply, timer or privilege change took place. Frozen P/H/EXEC, quarantined stores, retained releases, the compatibility junction, `.codex/` and parked ISSUE-327 are untouched.

This package **supersedes the command-level detail** of [master sequence section 5](master-execution-sequence-2026-11-01.md) (its approvals, proofs and rollback statement stand; where this file is more specific, this file governs). It is a sibling of [Block L](gap-029-block-l-execution-ready-2026-11-02.md), which is independent of it.

Files: [`evidence/block-m-package-20261102/`](evidence/block-m-package-20261102/) - `m-static-check.sh`, `m-prod.sh`, `state-probe.sh`, `capture-m-a.sh`, `capture-m-b.sh`, `restore-verify-m.sh`, `rehearse-m-host.sh`, `rehearse-m-apply-inner.sh`, `linux-rehearsal/`.

## 1. What is pinned

| Item | Value |
|---|---|
| **R** (the revision the owner pushes) | **unknown until the owner pushes**; a commit cannot print its own hash. Every block below refuses anything that is not 40 lowercase hex, and `m-static-check.sh` refuses any R whose tree is not the qualified one |
| Qualified candidate E | `e0f6c7bcb0cac46be743031de049df0c1f27b2fb` (typecheck, units, window 46/46, both builds, both boots on Linux; [8.2](master-execution-sequence-2026-11-01.md)) |
| Type-checked head T | `933eb87effcd63c909a27454738656e7516c2e15` (`tsc --noEmit` clean on Linux) and `bbb52ed489119f6e95662cae94811322bf14e715` (**`npm run typecheck` = `next typegen && tsc --noEmit`, exit 0, 2 min 4 s, Node v22.23.2**, [log](evidence/block-m-package-20261102/linux-rehearsal/npm-run-typecheck-bbb52ed4.log)); every later commit may differ from them only under `docs/` and root `*.md` (rule B of the static check) |
| Migration | `118_fixtures_unconfirmed_participants.sql`, sha256 (LF) `49e59fcd96aa62142fb2da8141f926997582ef86502b37e22c4796f004498401`; the **only** pending migration |
| Ledger before / after | 117 rows, last `117_brownlow_provider_eligibility_unknown.sql`, digest `647c3fb39ca66a572664e1dae9028e4fad4d6b121226d6bdf208e6738af45f72` -> 118 rows, last `118_fixtures_unconfirmed_participants.sql`, digest **`573594e9365b642ec518c252b17de11d3a423872c53c3020ab525db5904aaf57`** (derived offline from the 117 sidecar rows plus the 118 row; the rehearsal's migrated clone reproduced it) |
| Target | `afldb_prod`, `localhost:5432`, system identifier `7674454702926115004`, database OID `66668`, PostgreSQL 16.15 |
| **Outgoing (serving) release, `OLD_ID`** | **`fd48ace0c2cb-pqAQwRIJWLjSYzR8LiTuy`** (build id `pqAQwRIJWLjSYzR8LiTuy`), MainPID 3218527 on 2026-11-01 22:44Z. Re-verified at every `pre` and by `state-probe.sh`; any difference is a STOP |
| `previous` today / deeper retained | `ad245d602f6f-m0M8pf121326vNSo2B759` / `61a95f7397da-JYIBkYn8ynPgYMn1e5nK-`, `9ed9c9dd3e84-QNEHXAtU53TzUjj0Mb7mv`. **The only rollback target of M2 is `OLD_ID`, always named with `rollback --to`; never an unqualified `rollback`** (it would select the deeper `previous`) |
| Primary production checkout | `/home/arm/projects/afldb`, `affe9a2c30842e35557710bc582cb9d6114ee39c`, clean (probe 22:44Z). It is **not** the serving tree (the release route serves `/home/arm/afldb-releases/current`) and its `.next/BUILD_ID` is a leftover, not a serving fact |
| Snapshot (M-b) | `afl-api-2027-2026-11-01-012026`; `00-season-matches.json` sha256 `21fd12e7704b7c7146cfbab414352352f3cfaa53e7ef5038f4411fa789e4c84d` (re-hashed on the workstation 2026-11-02); `manifest.json` sha256 `63fc997403d5fb4edee2698e98e53e61d04c01ef35ebac1a965a8e8420d179e4`; staged under `data/sources/afl_api/fixtures/` (git-ignored, so the checkout stays clean); 218 records |
| Expected M-b result | fixtures 0 -> **218**: 135 confirmed / 83 unconfirmed; 11 label-participant rows; 10 NULL venues; 83 NULL date and time; **0** unconfirmed rows with a date or time; 0 not-`scheduled`; one completed batch (read 218, inserted 218, updated 0, rejected 0); `matches` unchanged |
| Host resources (probe 2026-11-01 20:40Z) | `MemAvailable` 2,952 MB, no swap, 56.7 GB free. The build needs 3,200 MB in-build (**refused**) or 2,100 MB with `--typecheck off-host`; **the guards are never lowered** |

## 2. Who does what

| Step | Who | Authority |
|---|---|---|
| W0 static check, workstation | Claude | local read-only Git, `git ls-remote origin` |
| D0 push (fast-forward only) | **Owner only** | push to `origin/main` |
| P-A, D1, backup capture, M1, readback, build, verify, promote, post-install, M-b stage/check/run/readback | Claude over SSH as `arm` (no sudo), **or the owner**; one SSH session per phase | **only under the owner's written approval of the block** (section 10) |
| Private transfer of the dump and restore verification | Claude (workstation and streamanator, `arm`) | covered by the approval statement (section 10); data stays mode 700/600, outside Git |
| Restart `sudo systemctl restart afldb` (30 s after the last start) | **Owner only** | sudo |
| Optional authenticated look at `/admin/fixtures` | **Owner only** | signs in |

Claude never uses `sudo`, never restarts the unit, never signs in, never pushes, never edits `.env`, never lowers a guard. Rationale for single sessions: SSH bursts have tripped the network's intrusion prevention before.

## 3. Variables

```bash
# workstation (Git Bash), repository root
R=REPLACE_WITH_40_HEX_R                       # from the owner's approval; anything else fails safe
PKG=docs/v2/evidence/block-m-package-20261102
```

```bash
# production, as arm -- paste at the start of EVERY production session or SSH call
R=REPLACE_WITH_40_HEX_R
PKG=docs/v2/evidence/block-m-package-20261102
PKGD=/home/arm/blockm-pkg-${R:0:12}/$PKG       # the package as git archive of R (pinned bytes), created in D1
CHK=/home/arm/projects/afldb
ROOT=/home/arm/afldb-releases
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node
OLD_ID=fd48ace0c2cb-pqAQwRIJWLjSYzR8LiTuy      # serving release, PINNED: the only rollback target
OLD_PREV=ad245d602f6f-m0M8pf121326vNSo2B759    # `previous` today; NOT a rollback target of this package
PROD_HEAD=affe9a2c30842e35557710bc582cb9d6114ee39c
NEWFILE=/home/arm/blockm-new-id.txt            # written by M2-build; read by promote and recovery
STAMP=REPLACE_WITH_UTC_STAMP_YYYYMMDDTHHMMSSZ  # chosen once per session
```

## 4. Validation (actual results; nothing here touched production)

| Check | Result |
|---|---|
| **Static delta check** (`m-static-check.sh`, workstation) at local head | PASS (rules A, B, C). Negative controls, re-run on 2026-11-02 in a **new disposable clone** with its root and Git directory asserted first ([`m-neg-controls.sh`](evidence/block-m-package-20261102/m-neg-controls.sh), [log](evidence/block-m-package-20261102/m-neg-controls-20261102.log), **6 of 6**, real repository unchanged): a `src/` change -> FAIL A and B; a change to another tool -> FAIL A and B; a docs-only change -> PASS; an edit to migration 118 -> FAIL A, B **and** C (sha256 differs); an edit to the label tool -> FAIL B only; an edit to the GAP-029 evidence file -> FAIL C only. (The first version of these controls ran by mistake in the real repository; see the [incident record](incident-2026-11-02-negative-control-wrong-repo.md). Same outputs, wrong procedure, superseded.) |
| **Linux `npm run typecheck`** at `bbb52ed4` (streamanator, Node v22.23.2) | exit 0, 2 min 4 s, peak 2.71 GB (hence off-host: production cannot spare it) |
| **Host-phase rehearsal** of the real `m-prod.sh` (`rehearse-m-host.sh`, streamanator, new workspace, new guarded cluster on 127.0.0.1:55494, a production-derived **ledger-117** clone: 17,056 matches, 0 fixtures, from the verified dump `3f5b5339…4730`) | see the table below; evidence in [`linux-rehearsal/`](evidence/block-m-package-20261102/linux-rehearsal/) |
| Restore verification script (`restore-verify-m.sh`, derived from Block L's) | run end to end on the retained Block L backup (ledger 117 expectation): `pg_restore` exit 0, 0 stderr lines, ledger 117 / digest `647c3fb3…`, 17,056 matches; DEV services untouched |
| Reused (no source drift, rule A) | C4b 36/36, Brownlow 76/76, window 46/46, release-default and off-host builds, standalone boots (all at `2134e2fd`/`e0f6c7bc`, [8.2](master-execution-sequence-2026-11-01.md)); labels 34/34 ([Block L](gap-029-block-l-execution-ready-2026-11-02.md)) |

**Rehearsed bytes:** the host rehearsal ran from a clean shallow clone of `0bf95bee446be372b5b4bfb05f83a261ba534edc` (tar sha256 `bada6e09…136f`), 14 of 14 phases PASS; `m-prod.sh` there has sha256 `29ebbdc2da64e0406af4222ae2d1d281242959a32af0b780b60f75e93fdcdf21`. Any later edit to `m-prod.sh` voids this rehearsal and it is re-run. `capture-m-a.sh`, `capture-m-b.sh`, `restore-verify-m.sh` are constants-only derivations of the Block L scripts; `restore-verify-m.sh` was run end to end, the capture scripts were only syntax-checked (`bash -n`) and diffed against the reviewed original (their pre-conditions are all read-only and refuse before creating anything).

Rehearsal phases (the production script is run through a `sed` copy whose **only** differences are host facts: host name, checkout path, release root, database identity, DSN host/port, the writer-unit list, the crontab check and the state probe; the diff is [`m-prod.rehearsal.diff`](evidence/block-m-package-20261102/linux-rehearsal/m-prod.rehearsal.diff)):

| Phase | Proves |
|---|---|
| `pre … 117` | clean checkout at R, no writer process, identity (name, OID, system identifier, read-only session), ledger exactly 117 / digest, no 118 column |
| backup controls | `migrate` is **refused before any write** for a stale backup (300 min), a backup of the wrong ledger state, a backup of another target, a tampered archive (checksum), and a missing directory; `pre` still shows 117 afterwards (the backup directory used is *synthetic*: it proves the binding logic only; the real capture script is the Block L script with constants changed, [diff](#6-backup-and-restore-verification)) |
| wrong-state controls | `pre … 118` on a 117 database refused; `migrate` with a wrong revision refused; nothing changed |
| `migrate` | pending set exactly `118_…`, applied once as `afldb_owner` (13 ms), `0 pending` afterwards |
| `readback` | ledger 118 / digest `573594e9…af57`; stored checksum `49e59fcd…8401`; columns `confirmation NOT NULL DEFAULT 'confirmed'`, both placeholders nullable, both club ids nullable; the three named constraints; every existing fixture confirmed with both clubs; `afldb_import` can INSERT `confirmation` and UPDATE `home_placeholder`, `afldb_app` can SELECT it (no `privileges.sql` is needed) |
| replay controls | a second `migrate` is refused twice over (same log directory; fresh log directory -> "pending set is not exactly …"); `pre … 118` passes; `pre … 117` refused; a dirty checkout refused |
| `window-stage` | the staged snapshot bytes equal the approved feed hash; a wrong hash refused |
| `window check` | reaches the real tool; on the DEV host the tool **refuses** (`afldb-settle-afl-api.timer` and the Brownlow timer are enabled and active there), which is the correct answer and proves the argument wiring |
| `readback-b` | after the **real settle CLI** applies the snapshot to the clone: `218\|135\|83\|11\|10\|83\|0\|1\|0`, one completed 218/218/0/0 batch, switch a boolean `false`, audit rows `2:2:1` for the decision, `matches` unchanged; controls: a wrong matches count and a different decision text are refused. **Disclosed:** the two audit rows are synthetic (the window cannot run on the DEV host); the window tool itself is covered by its own 46/46 rehearsal |

## 5. Preflight (read-only)

**W0 (workstation, Claude).** After the owner has pushed (D0), or before it for the local head:

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd /d/dev/afldb
  [ "$(git rev-parse HEAD)" = "$R" ]
  bash "$PKG/m-static-check.sh" "$R"                 # PASS (A,B,C) or STOP
  echo "W0 PASS"
)
```

**P-A (production, as `arm`).** Needs the package on the host, so it is the second half of D1 (below). Every `pre` check is enforced by the script (`set -u -o pipefail`; the first failed assertion stops with a `STOP:` line and a non-zero status).

## 6. Backup and restore verification

`capture-m-a.sh` and `capture-m-b.sh` are the reviewed Block L capture procedure ([`backup-prod.sh`](evidence/gap029-block-l-20261102/scripts/backup-prod.sh)) with **constants only** changed: decision label, output directory (`/home/arm/backups/afldb/blockm-a-<stamp>` / `blockm-b-<stamp>`), application names, and for M-b the ledger expectation (118 rows, last `118_…`, digest `573594e9…af57`). Three honest corrections were made on the way: the sidecar `approval_reference` is **the owner's words passed in `M_APPROVAL_REFERENCE`** (the script refuses without 20+ characters) instead of Block L's fixed sentence; the sidecar records `serving_release` from the `current` link (Block L's script read the primary checkout's leftover `.next/BUILD_ID`, the source of the stale build id in that record); and the closing wording names the block. It is read-only on the database (`afldb_backup`, read-only session), refuses unless every writer unit is inactive, refuses within 30 minutes of a settle timer, and creates exactly one new mode-700 directory.

Restore verification (off-host, guarded disposable database, never the DEV database): copy the dump privately to the workstation and to streamanator (mode 700/600, hash re-verified at each hop), then

```bash
EXPECT_ROWS=117 EXPECT_LAST=117_brownlow_provider_eligibility_unknown.sql EXPECT_DIGEST=647c3fb39ca66a572664e1dae9028e4fad4d6b121226d6bdf208e6738af45f72 \
W=<workspace with cand + node_modules> R=<a revision whose tree is clean in W/cand> DUMP=<dump> DUMP_SHA=<sha256 from the sidecar> TAG=ma bash restore-verify-m.sh
# M-b: EXPECT_ROWS=118 EXPECT_LAST=118_fixtures_unconfirmed_participants.sql EXPECT_DIGEST=573594e9365b642ec518c252b17de11d3a423872c53c3020ab525db5904aaf57 TAG=mb
```

The restored ledger digest, `matches` and `fixtures` counts printed in `RV3` must equal the live figures from `m-prod.sh pre`. The restore is a *verification of the insurance*, not a gate the tool re-checks; each stage is bound to its own backup by `m-prod.sh` (checksums, target identity, ledger digest, age <= 120 minutes).

## 7. Block M-a: migration 118, then the compatible release

`T0` is when the owner says go. Times are budgets; an overrun is a STOP for that step. **Before any block that follows a failure or a surprise, run the state probe (section 9) and act only on its STATE.**

**D0 (T0+0) - push (owner, workstation).**

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd /d/dev/afldb
  [ "$(git rev-parse HEAD)" = "$R" ]; bash "$PKG/m-static-check.sh" "$R"
  git push origin "$R:refs/heads/main"                                  # no --force: a non-fast-forward is rejected
  [ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$R" ]
  echo "D0 PASS"
)
```

**D1 (T0+5) - package, preflight, fast-forward (production, `arm`).** The fetch moves no working tree; the package is extracted from `R`'s own objects, so its bytes are pinned. The checkout moves only after `pre` passed at `PROD_HEAD`:

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"
  [ "$(git rev-parse HEAD)" = "$PROD_HEAD" ]; [ -z "$(git status --porcelain)" ]
  git fetch origin; [ "$(git rev-parse refs/remotes/origin/main)" = "$R" ]
  mkdir -m 700 "/home/arm/blockm-pkg-${R:0:12}"; git archive "$R" "$PKG" | tar -x -C "/home/arm/blockm-pkg-${R:0:12}"
  git show "$R:$PKG/m-static-check.sh" | bash -s -- "$R"             # the static check again, from R's own bytes, on the host
  bash "$PKGD/m-prod.sh" pre "$PROD_HEAD" "$OLD_ID" 117            # P-A: ledger 117, no writer, serving OLD_SERVING, identity
  git merge --ff-only "$R"; [ "$(git rev-parse HEAD)" = "$R" ]; [ -z "$(git status --porcelain)" ]
  bash "$PKGD/m-prod.sh" pre "$R" "$OLD_ID" 117
  echo "D1 PASS"
)
```

**B1 (T0+15) - backup and restore verification (budget 25 min).** Capture on the host, in `tmux` (`M_APPROVAL_REFERENCE` is the owner's approval words, no single quotes):

```bash
M_APPROVAL_REFERENCE='<the owner approval words, 20+ characters>' bash "$PKGD/capture-m-a.sh" 2>&1 | tee "/home/arm/blockm-a-capture-$STAMP.log"
# RESULT PASS stamp=<S> archive_sha256=<H> ...   then:  MA_DIR=/home/arm/backups/afldb/blockm-a-<S>
```

Transfer the dump privately and run `restore-verify-m.sh` (section 6, M-a variables). Stop if the restored figures differ from `pre`.

**M1 (T0+40, budget 5 min) - migration 118.** The migration runs in **one transaction**: a failure rolls back by itself. No retry is ever automatic.

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]
  bash "$PKGD/m-prod.sh" pre "$R" "$OLD_ID" 117
  M_BACKUP_DIR="$MA_DIR" M_LOG_DIR="/home/arm/blockm-a-migrate-$STAMP" bash "$PKGD/m-prod.sh" migrate "$R"   # MIGRATE PASS
  bash "$PKGD/m-prod.sh" readback                                                                           # READBACK PASS
  echo "M1 PASS"
)
```

`readback` prints `ledger118_digest=573594e9…af57`; record the printed `fixtures_rows=0 matches_rows=<N>` (N is needed for M-b's `readback-b`). **From here the previous code keeps serving a ledger-118 database; this is proven compatible** ([record](issue229-rollback-compatibility-2026-11-01.md): public and admin routes 200, manual fixture creation works on both `ad245d60` and `fd48ace0`), so there is no hurry and nothing to undo if M2 is delayed.

**M2-build (T0+50, budget 20 min).** Run once, in `tmux`. The build is of `R` (`git archive` in the checkout); `NEWFILE` must not exist; the heap is the release default (3072 MB, one worker); `--typecheck off-host` because production has 2.9 GB available and the in-build type-check was the 2026-10-31 OOM:

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"
  [ ! -e "$NEWFILE" ]; [ "$(git rev-parse HEAD)" = "$R" ]; [ -z "$(git status --porcelain)" ]
  bash "$PKGD/state-probe.sh" "$OLD_ID" - --expect OLD_SERVING
  "$N" deploy/release.mjs build --checkout "$CHK" --revision "$R" \
    --afldb-env production --typecheck off-host --smoke-paths /players,/clubs,/seasons \
    --typecheck-evidence "npm run typecheck (next typegen && tsc --noEmit) exit 0 on Linux (streamanator, node v22.23.2) at bbb52ed489119f6e95662cae94811322bf14e715; the type-checked inputs of R equal that tree (git diff --name-only 933eb87e..R lists only docs/ and root *.md, enforced by m-static-check.sh rule B); log docs/v2/evidence/block-m-package-20261102/linux-rehearsal/npm-run-typecheck-bbb52ed4.log; 2026-11-02" \
    2>&1 | tee "/home/arm/blockm-build-$STAMP.log"
  NEW_ID=$(sed -n 's/^release: RELEASE READY \([^ ]*\) .*$/\1/p' "/home/arm/blockm-build-$STAMP.log" | tail -n 1)
  [[ $NEW_ID =~ ^${R:0:12}-[A-Za-z0-9_-]+$ ]]
  "$N" deploy/release.mjs verify "$NEW_ID"
  [ "$(readlink "$ROOT/current")" = "releases/$OLD_ID" ]; [ "$(readlink "$ROOT/previous")" = "releases/$OLD_PREV" ]    # a build never moves a link
  bash "$PKGD/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect OLD_SERVING
  echo "$NEW_ID" > "$NEWFILE"; echo "M2-build PASS NEW_ID=$NEW_ID"
)
```

Any `REFUSED`, guard abort or failure is a STOP with `current`/`previous` untouched and `NEWFILE` unwritten. A floor under about 900 MB of `MemAvailable` during the build is a signal to stop and look, not to retry blindly. Never `npm run build` in the serving checkout.

**M2-promote (T0+75).**

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"
  NEW_ID=$(cat "$NEWFILE"); [[ $NEW_ID =~ ^${R:0:12}-[A-Za-z0-9_-]+$ ]]
  bash "$PKGD/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect OLD_SERVING
  "$N" deploy/release.mjs promote "$NEW_ID"
  bash "$PKGD/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect NEW_SELECTED_OLD_RUNNING
  [ "$(readlink "$ROOT/previous")" = "releases/$OLD_ID" ]
  echo "promote PASS"
)
```

If this stops anywhere, **do not roll back or restart by reflex**: go to section 9.

**M2-restart (owner only):** `sudo systemctl restart afldb`, at least 30 s after the last start (about 15-30 s of downtime).

**M2-check (T0+85).**

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"
  NEW_ID=$(cat "$NEWFILE")
  bash deploy/post-install-check.sh "$NEW_ID"                                 # POST-INSTALL CHECK PASS or FAIL
  bash "$PKGD/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect NEW_SERVING
  bash "$PKGD/m-prod.sh" readback                                             # schema still 118
  journalctl -u afldb --since '10 minutes ago' --no-pager | grep -F 'serving build' | tail -n 1 | grep -q "release $NEW_ID revision ${R:0:8}"
  echo "M2-check PASS"
)
```

If `arm` cannot read the journal, the owner runs the last line. A `CACHE` line for an old build id is an old Cloudflare copy and is not a failure; every `FAIL` is.

**Optional owner look (T0+95): `/admin/fixtures` signed in.** Before M-b it shows no fixtures and renders; local candidate visual evidence is 36/36 ([L1](issue229-rollback-compatibility-2026-11-01.md)), **production visual is UNVERIFIED until the owner looks**. **Hard end T0+120:** if M2-check has not passed, recover (section 9).

## 8. Block M-b: the first 2027 fixture window (separate approval; M-a complete and verified)

Preconditions the script enforces: ledger **118** and digest; the checkout clean at R; no writer unit enabled or active (the four AFL API units are absent on production, but **absent units are not proof**: the window tool inventories every unit file, cron, `at`, the process table and other `afldb_import`/`afldb_owner` sessions itself); the stage backup; the switch exactly `absent`. **The owner confirms that nobody else is working** (editor, match sheet, fixture admin, settle, Brownlow, build, restart).

**S1 - stage the snapshot (read-only on the database).** From the workstation (`afl-api-2027-2026-11-01-012026` holds exactly `00-season-matches.json` and `manifest.json`):

```bash
scp -r data/sources/afl_api/fixtures/afl-api-2027-2026-11-01-012026 afldb:/home/arm/blockm-snap-$STAMP
# production:
( set -euo pipefail; L=afl-api-2027-2026-11-01-012026
  mkdir -p "$CHK/data/sources/afl_api/fixtures"; [ ! -e "$CHK/data/sources/afl_api/fixtures/$L" ]
  cp -r "/home/arm/blockm-snap-$STAMP" "$CHK/data/sources/afl_api/fixtures/$L"
  bash "$PKGD/m-prod.sh" window-stage "$L" 21fd12e7704b7c7146cfbab414352352f3cfaa53e7ef5038f4411fa789e4c84d
  [ -z "$(git -C "$CHK" status --porcelain)" ]                                  # the snapshot path is git-ignored
)
```

**S2 - pre, backup, restore verification (budget 25 min).** `bash "$PKGD/m-prod.sh" pre "$R" "$(cat "$NEWFILE")" 118` (after M2 the serving release is `NEW_ID`, so it takes the place of `OLD_ID` in the serving check), record `matches_rows=<N>` and `switch_raw=(absent)`. Then `M_APPROVAL_REFERENCE='…' bash "$PKGD/capture-m-b.sh"` (it refuses unless the ledger is exactly the 118 state), private transfer, `restore-verify-m.sh` with the M-b variables (section 6). `MB_DIR=/home/arm/backups/afldb/blockm-b-<S>`.

**S3 - check only (writes nothing; budget 3 min).** Read `preconditions.json` with the owner: every unit state, every inventory row, the "absent units are not proof" flag, the switch `absent`:

```bash
bash "$PKGD/m-prod.sh" window check "$R" afl-api-2027-2026-11-01-012026 21fd12e7704b7c7146cfbab414352352f3cfaa53e7ef5038f4411fa789e4c84d \
  "/home/arm/blockm-b-$STAMP-check" "<the owner approval words for M-b, 20+ characters>"      # CLEAR, exit 0
```

**S4 - the window (budget 15 min, hard deadline in the tool).** A **new** evidence directory (the check's directory is not reusable). Run detached and poll; a dropped SSH session kills the window process, and the separate watchdog then turns the switch off by itself (rehearsed: about 5 s):

```bash
( set -euo pipefail; cd "$CHK"
  M_BACKUP_DIR="$MB_DIR" setsid nohup bash "$PKGD/m-prod.sh" window run "$R" afl-api-2027-2026-11-01-012026 \
    21fd12e7704b7c7146cfbab414352352f3cfaa53e7ef5038f4411fa789e4c84d "/home/arm/blockm-b-$STAMP-run" "<the owner approval words for M-b>" \
    > "/home/arm/blockm-b-$STAMP-run.out" 2>&1 < /dev/null &
  sleep 5; tail -n 5 "/home/arm/blockm-b-$STAMP-run.out" )
# poll until the last line reads: WINDOW EXIT <code> ...
```

**Exit codes:** `0` CLEAR is the only success. `1` HALT: the switch was restored and verified. `2` refused before any write. `3` RESTORATION NOT VERIFIED: **immediately** `bash "$PKGD/m-prod.sh" window restore "/home/arm/blockm-b-$STAMP-run"` and confirm `false` before anything else (the admin toggle is the second route; never leave the switch on).

**S5 - read-back (read-only), after any exit code.**

```bash
bash "$PKGD/m-prod.sh" readback-b <N from S2> "<the same decision words>"            # READBACK-B PASS
```

It requires `218|135|83|11|10|83|0|1|0`, one completed 218/218/0/0 batch, the switch a boolean `false`, exactly one ON and one OFF audit row of one run carrying the decision, and `matches` unchanged. Also read `result.json` and `transition.json` in the run directory. **After M-b the Brownlow baselines, backups and restore evidence taken earlier are void** (master sequence section 3): retake them immediately before their own `plan`.

## 9. Stop conditions and state-aware recovery

**No step is retried by reflex.** First establish the state, then act on that row only.

| Condition | Action |
|---|---|
| `pre`, static check, backup binding, identity or pending-set refusal | nothing was written; fix the cause; a stale backup means a new capture |
| `migrate` exit non-zero or the SSH session dropped | the migration is one transaction. Run `m-prod.sh pre "$R" "$OLD_ID" 117`: ledger 117 = nothing happened; run `m-prod.sh readback`: ledger 118 digest `573594e9…af57` = it committed. Anything else = STOP, owner decision. Never re-run `migrate` in the same log directory (the script refuses) |
| Build `REFUSED`, guard abort, admission shortfall, over budget | STOP; `current`/`previous` untouched; no swap, no service stop, **no lowered threshold** |
| `promote` refused | nothing moved; `OLD_SERVING` |

State probe: `bash "$PKGD/state-probe.sh" "$OLD_ID" "$NEW_ID" [--expect STATE]` (read-only; 14 self-test cases).

| STATE | Meaning | Action |
|---|---|---|
| `OLD_SERVING` | old release selected, running, healthy | preserve it; no rollback, no restart; `previous` may be `ad245d60…` or `NEW_ID` |
| `NEW_SELECTED_OLD_RUNNING` | promoted, not restarted | owner restart, or `release.mjs rollback --to "$OLD_ID"` |
| `NEW_SERVING` | new release serving, healthy | run M2-check; accept |
| `NEW_SELECTED_FAILED` | `current` is new and the unit is down or unhealthy | `release.mjs rollback --to "$OLD_ID"`, owner restart, `release.mjs status --expect "$OLD_ID"`, `post-install-check.sh "$OLD_ID"` |
| `OLD_SELECTED_NEW_RUNNING` | rolled back, restart owed | owner restart |
| `TRANSIENT` | `activating` | change nothing; probe again in 15 s |
| `UNCERTAIN` | anything else | act on nothing; inspect links, process, health, journal |

**Schema 118 is never rolled back by an operator command.** After M1 both retained releases run against it (proven). The schema-undo script is rehearsed on disposable copies only and is **not** an authorised production step.

**M-b state after the window (the apply is one transaction, so the fixture count is 0 or 218, never between):**

| Observation | Meaning | Action |
|---|---|---|
| exit 0 and `READBACK-B PASS` | done | record; Brownlow baselines void |
| exit 2 | refused before any write | read the reasons; fix; the same approval may be re-run only if the owner says so |
| exit 1, fixtures 0, switch `false` | HALT before the apply, restored | read `result.json`; no data written; new run needs the owner's decision |
| exit 1 or a failed `readback-b` with fixtures 218 | the apply committed but the run did not end CLEAR (for example a `result.json` write failure) | do **not** re-run; read `transition.json`; the owner decides whether to accept (a replay is refused by the tool itself) |
| exit 3 | switch possibly on | `window restore` at once, confirm `false` |
| process and watchdog both died, switch on | rare | `window restore <run dir>`; the admin toggle is the second route |

## 10. Rollback fidelity and data recovery (binding wording)

* **Before the first fixture apply** (M-a only): code rollback to `OLD_ID` is full fidelity; the schema stays 118 harmlessly.
* **After the first apply (M-b):** a code-only rollback keeps the public pages and the 135 confirmed fixtures working, **but the 11 label-participant fixtures are invisible to the previous admin and their detail page returns 404, and the 83 unconfirmed fixtures are not shown to it.** No data is lost or changed. A code-only rollback is **not a full-fidelity rollback**.
* The full-fidelity routes are (a) the pre-M-a backup, which discards **every** write since its capture, a last resort; or (b) the rehearsed schema-undo script ([record](issue229-rollback-compatibility-2026-11-01.md)), which first removes the provider-owned 2027 rows the retained feed re-creates and is **not** an authorised production step. Either needs its own owner approval.

## 11. Approval statements (the owner writes them; this session does not)

**M-a.** "I approve **block M-a** at revision `<R>` (40 hex): (1) a fresh read-only backup of `afldb_prod` (host `afldb-prod`, system identifier `7674454702926115004`, database OID `66668`), its **private transfer** to the workstation and to streamanator (mode 700/600, outside Git), and restore verification on a guarded disposable database there; (2) migration `118_fixtures_unconfirmed_participants.sql` (sha256 `49e59fcd96aa62142fb2da8141f926997582ef86502b37e22c4796f004498401`) as the only pending migration, ledger 117 digest `647c3fb3…45f72` to 118 digest `573594e9…af57`, with the owner role; (3) a fast-forward of `/home/arm/projects/afldb` from `affe9a2c…` to `<R>`; (4) a release build of `<R>` by `deploy/release.mjs` with `--typecheck off-host` and the default guards, verify, and `promote`, pinned to outgoing release `fd48ace0c2cb-pqAQwRIJWLjSYzR8LiTuy` with rollback only by `rollback --to fd48ace0c2cb-pqAQwRIJWLjSYzR8LiTuy`; I will restart the service myself. I confirm no other operator is changing data, settling, building, deploying or restarting during the window. A failed step stops the run and is not retried without me. This approves no fixture apply, no timer or switch change, no push beyond `<R>`, no privilege change and no cleanup."

**M-b.** "I approve **block M-b** at revision `<R>`, after M-a is complete and verified: the staged snapshot `afl-api-2027-2026-11-01-012026` (feed sha256 `21fd12e7704b7c7146cfbab414352352f3cfaa53e7ef5038f4411fa789e4c84d`, 218 records) copied to `/home/arm/projects/afldb/data/sources/afl_api/fixtures/`; a fresh backup with private transfer and restore verification at ledger 118 (digest `573594e9…af57`); then the bounded window `afl-api-fixture-window.ts` with `--expect-initial absent --expect-created 218`, deadline 15 minutes, evidence in a new directory outside the checkout, decision reference `<my words, 20+ characters>`. The switch must be restored to false and verified before anything else happens. I accept that rollback fidelity is reduced after the apply (section 10). I confirm nobody else is working during the window. This does not approve leaving acquisition enabled, any timer, a replay, or any other write."

## 12. Exact remaining actions

1. Review this package; push the reviewed local commits (fast-forward only) or say which revision is `R`.
2. Write the M-a approval (section 11) naming `R`; the session then runs D1 to M2-check, asking only for the restart.
3. After M-a is verified, write the M-b approval; the session runs S1 to S5.
4. After M-b, Block B and the C chain are re-baselined ([master sequence](master-execution-sequence-2026-11-01.md) sections 3, 6, 7).
