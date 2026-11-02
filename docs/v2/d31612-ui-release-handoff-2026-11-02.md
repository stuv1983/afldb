# D-316-12 UI release: consolidated handoff and approval (rev 3, 2026-11-02)

**Status: PREPARED. NOT GRANTED. NOT EXECUTED.** Nothing was pushed, built on production, deployed, restarted, scheduled or changed; production was not contacted while preparing this. Rev 3 **supersedes** [rev 2](d31612-ui-release-approval-2026-11-02.md) (kept unchanged) and is the only document to execute from. It differs from rev 2 in five ways: the push revision is **pinned and pushed explicitly** (never `HEAD`), so later documentation commits cannot change what is pushed; the production steps are **one pinned script** with literal constants instead of pasted blocks; the preserved state (match timer, acquisition setting, **effective** `AFLDB_SETTLE_TRIGGER`) is **baselined before the first change and compared after the restart**; the first-night observation is an **execution gate**, not a preparation gate; and the visual check has a **runner** (rev 2 had none). The production script was corrected after the first draft (build-failure propagation, rollback preservation, probe status; section 9) and re-tested in full against a mocked host: 79 cases, 257 assertions, 0 failed. Evidence for the preparation: [rev3-preparation-tests-20261102.txt](evidence/d31612-release-package-20261102/rev3-preparation-tests-20261102.txt). Qualification: [d31612-linux-qualification-2026-11-02.md](d31612-linux-qualification-2026-11-02.md). Close-out context: [issue316-closeout-and-seasonal-obligations-2026-11-02.md](issue316-closeout-and-seasonal-obligations-2026-11-02.md), successor [afl-api-2027-season-operations-successor-2026-11-02.md](afl-api-2027-season-operations-successor-2026-11-02.md) (AFLDB-ISSUE-332).

## 1. Pinned facts (full hashes; every one verified read-only on 2026-11-02)

| Item | Value |
|---|---|
| **R** qualified code revision | `a0b1080f5b98aee7191894c138be27bb524c7b1b` (Linux-qualified; **built**) |
| **H** the revision pushed | `d00e07e37566e92b35a34e62a1ff03e173715e87` (descendant of R; `static-delta-check.sh` PASS: R to H touches only `docs/`, `CHANGELOG.md`, `IssuesIndex.md`, `issues.md`; ten code trees and files **byte-identical** in R and H, so the qualification of R is the qualification of H's code: no re-test) |
| `origin/main` today / production checkout today | `924ff273261834e4112e3f41b61ceeab55427534` (both; the push is a fast-forward of **11 commits**, `924ff273..H`) |
| Outgoing serving release `OLD_ID` (**the only rollback target**) | `ea98a35f2061--vY0EFS0DdR-TiPkxTZz6` (revision `ea98a35f20610e75c18e698bc0d9fe084c3c783d`, BUILD_ID `-vY0EFS0DdR-TiPkxTZz6`) |
| `previous` today `OLD_PREV` (**not** a rollback target) | `fd48ace0c2cb-pqAQwRIJWLjSYzR8LiTuy`; deeper retained and untouched: `ad245d602f6f-m0M8pf121326vNSo2B759`, `61a95f7397da-JYIBkYn8ynPgYMn1e5nK-`, `9ed9c9dd3e84-QNEHXAtU53TzUjj0Mb7mv` |
| Expected `NEW_ID` | `a0b1080f5b98-<BUILD_ID>` (the build prints it). The build is of **R** from the checkout at H (`release.mjs` does `git archive R`) |
| Qualification evidence reused | focused 420/420, C7 reader on PostgreSQL 3/3, `deploy-release` 33/33, typegen and `tsc --noEmit` exit 0, production-mode build exit 0 (1 min 34.6 s, peak RSS 1.50 GB), boot smoke 200, process guard 17/17 and real-process PASS; source integrity 4146/4146 blobs; lock sha256 prefix `984b44221f8f7256` (re-confirmed equal at R, at H and in the working tree) |

**Pinned file bytes (SHA-256, LF).** Anything that does not match is a STOP.

| File | SHA-256 |
|---|---|
| `docs/v2/evidence/d31612-release-package-20261102/d0-push-block.sh` (the section 5 block) | `91fc9deb565ba2f815855e4382840e47ad0a56602c6a0948f6e75430799ab3c9` |
| `.../d31612-phase.sh` (every production phase; **wrapper corrections of 2 Nov, late**, see section 9) | `ab0f929b7228afd3b4ee17597e4c46222ffea098fdd7665548dc1958ddeac47e` |
| `.../d31612-phase-mock-test.sh` (workstation-only mock-host test of the phase script; never transported) | `85c86f9a3aa5df3a617b65695daad4afc29976dadac5a53b17a9539c1d0bcdd3` |
| `.../live-accept-d31612.mjs` (the D4 runner) | `f2e7db193a757b816ee774226c7b77a00aada29c434f74ae2929724dd53840fc` |
| `.../static-delta-check.sh` (at H and at the working tree) | `cbc68b4e89ceac9acd9f2bbb9eef2c8a1bbd9151b23166e0d67236a0166d3b8f` |
| `c5-prep-20261102/c5-observe-r3.sh` at H (helper; read-only) | `f3362f881f0f1c8aae71c4f88ae33a0c65e9b7f4c0ef79dbf2fc152371b8d169` |
| `c5-prep-20261102/c5-proc-guard.sh` at H (helper; read-only) | `be473b78e4a24d87aa6e8f0cb2400f3d34934ba296712c59e99fd526421b1046` |

**Not in H, and why that is safe.** The rev 3 files (this document, `d0-push-block.sh`, `d31612-phase.sh`, `d31612-phase-mock-test.sh`, `live-accept-d31612.mjs`, the test record) are **committed locally in a documentation commit made after H**; that commit is a descendant of H, is **not pushed**, and is not part of what production runs. They are pinned by the hashes above, not by a commit. The push names **H explicitly** (`H:refs/heads/main`), and the production phases take H from the script's own literals, so this commit and any later documentation commit **cannot change what is pushed**: a local `HEAD` beyond H is expected, and `d0-push-block.sh` prints it and pushes H regardless. The ledger notes in `issues.md` and `IssuesIndex.md` are in the same local commit. The untracked `.codex/` is preserved and was never added. If the owner prefers to publish these documents too, that is a separate later push of a different revision under its own approval, never part of this one.

## 2. What changes, and what must not

Changes: display text on `/admin/current-season` (subtitle; settle-units intro), the unconfigured-host status strings in `settle-status.ts` and `settle-trigger.ts`, one comment in `actions.ts`, one test, and the inert read-only C7 observer (four files no application route imports and no unit runs). Does **not** change any control, server action behaviour, permission, ingestion behaviour or source policy, schema, migration, dependency, `deploy/`, `data/`, `.env`, systemd unit, timer or `site_settings` row, nor the Brownlow switch or gate. `static-delta-check.sh` enforces this mechanically (production to R changes **exactly** ten named non-documentation files; protected paths are empty). No migration and no database step.

**The nightly's code path is untouched.** The settle units run from the production **checkout** (`WorkingDirectory=/home/arm/projects/afldb`, `deploy/afldb-settle-afl-api.sh`), and D1 fast-forwards that checkout. That is safe because nothing the nightly executes changes: `deploy/`, `data/`, `package*.json` and the build configuration are byte-identical, and the changed `src/` files are admin pages and two libraries that no `tools/` entry point imports (checked by search: the only `tools/` references are file-path strings in a label table in `afl-api-fixture-window.ts`, and the new inert C7 observer, which no unit runs). The next nightly is Wed 4 Nov about 05:01 AEDT, hours after any daytime window.

**Preserved through the release, baselined at D1 and compared at D3c** (`/home/arm/d31612/baseline.txt` is written before the checkout moves):

| Preserved item | Baseline taken | Compared after the owner's restart |
|---|---|---|
| Match timer enabled, its **next elapse** and **last trigger** (`afldb-settle-afl-api.timer`) | `systemctl show -p NextElapseUSecRealtime / LastTriggerUSec` | both strings unchanged; plus the read-only helper's `timer` phase: enabled + active, future elapse, nothing running |
| Brownlow and AFL Tables timers | `is-enabled` of all three | identical triple (`enabled/disabled/disabled`) |
| **AFL API Current-Season Ingestion** setting | helper `timer` phase reads the stored value (must be `true`) before (P-A) and after (D3c) | `true`; and D4 gate G3 shows Enabled |
| **Effective** `AFLDB_SETTLE_TRIGGER=systemd` | `.env` exact-line count **and** the exact count in the **serving process environment** (`/proc/<MainPID>/environ`, count only, values never printed) | `.env` count equal; the **new** process has exactly one; a different MainPID (the restart happened); D4 gate G5 shows service states |
| Brownlow gate and switch | `.env` has no Brownlow gate line; helper asserts the Brownlow timer is off | unchanged (helper) and D4 gate G4 |

## 3. The gates

| Gate | What | Enforced by |
|---|---|---|
| **G0** the first-night result is **recorded and reviewed** and the decision is to proceed | `first-night-gate.txt` exists in the package folder with the two lines below | `d0-push-block.sh` refuses to push without it. Nothing on production has changed before D0, so G0 holds the whole sequence |
| **G1** the first scheduled run has **fired and finished** | `LastTriggerUSec` and `ExecMainExitTimestamp` of the match unit are set; service `inactive` | `d31612-phase.sh pa` |
| **G2** a daytime window | outside 05:00 to 05:20 AEDT; no `afldb` timer inside 100 minutes; no cron entry | `pa` (timers, cron) and the approval |

The gate file is written by the reviewer **after reading** the first-night evidence. Only the first and last lines are read by machine:

```text
FIRST-NIGHT-RECORD: reviewed
CLASSIFICATION: <the systemd-view line and data-view line printed by the first-night phase, verbatim>
RECORDED-AEDT: <date time>
REVIEWER: <name>
RELEASE-DECISION: proceed
```

Recommendation for `proceed`: the classification is `RAN, exit 0` and the data view is understood. Write `RELEASE-DECISION: hold` for `RAN AND FAILED`, `NO-RUN`, `STILL RUNNING` or `HELPER-FAIL` until the cause is understood; a web restart must not confound a night that is still unexplained. **No result is recorded here and none is invented: the first night was not observed when this was written.**

### 3.1 The first-night observation (best effort at 05:23; durable fallback)

The single existing cron job `8f9f4d02` (one-shot, session-only, **05:23 on 3 Nov**) stays as is; this document adds no schedule and performs nothing early. If it does not run, any later session or the owner runs, **before D1** (the helper requires the checkout to still be at `924ff273`):

```bash
# as arm on afldb-prod, no sudo, read-only; after 05:20 AEDT
bash /home/arm/c5-observe-20261102-r2.sh first-run   924ff273261834e4112e3f41b61ceeab55427534
bash /home/arm/c5-observe-20261102-r3.sh first-night 924ff273261834e4112e3f41b61ceeab55427534
# only if the systemd Started/Finished lines are needed (arm cannot read them): the owner runs
sudo journalctl -u afldb-settle-afl-api.service --since '2026-11-03 04:30' --until '2026-11-03 08:00' --no-pager
```

Classification table and what each class means: close-out document section 5. A helper expectation mismatch (for example `first-run` failing its batch check on a run that exited 0 with no retained batch) is **not** a failed nightly; the `first-night` phase reports the systemd view and the data view separately. Never start a manual settle or retry an apply.

## 4. Window and budgets

Choose a daytime window that starts at least 30 minutes after the gate file is written and ends well before 03:00 AEDT. **Recommended: Tuesday 3 November 2026, 10:00 to 12:30 AEDT** (owner attended). Budgets, not a schedule (an overrun is a STOP): transport 5, P-A 5, D0 5, D1 5, **D2 20**, D3a 3, D3b 2, D3c 5, **D4 20**; the acceptance decision is due **within 90 minutes of D3b** or recovery starts. One SSH session per phase (bursts have tripped the network's intrusion prevention); Claude saves each phase's output verbatim under `docs/v2/evidence/d31612-release-execution-<date>/` (`*.log` needs `git add -f`).

| Step | Who | Authority |
|---|---|---|
| Gate file; D0 push; D3b restart (and any recovery restart); D4 sign-in | **Owner only** | the owner's repository and `sudo`; the owner types every credential |
| T transport, P-A, D1, D2, D3a, D3c, probe, r2, r3-links, r3-verify | Claude over SSH as `arm` (or the owner) | no `sudo` |
| D4 capture | the owner starts the runner and signs in; Claude reads the captured images and `results.json` | navigate-only |

## 5. Execution

### T. Transport (Claude; writes only a NEW directory `/home/arm/d31612/`, overwrites nothing)

Retained `/home/arm/c5-observe-20261102-r3.sh` and friends are **never overwritten**; pinned copies go to the new directory. Git Bash, workstation:

```bash
( set -euo pipefail; cd /d/dev/afldb
  H=d00e07e37566e92b35a34e62a1ff03e173715e87; PKGD=docs/v2/evidence/d31612-release-package-20261102
  S=/d/tmp/d31612-stage; [ ! -e "$S" ]; mkdir -p "$S"
  tr -d '\r' < "$PKGD/d31612-phase.sh" > "$S/d31612-phase.sh"
  git show "$H:docs/v2/evidence/c5-prep-20261102/c5-observe-r3.sh" | tr -d '\r' > "$S/c5-observe-20261102-r3.sh"
  git show "$H:docs/v2/evidence/c5-prep-20261102/c5-proc-guard.sh" | tr -d '\r' > "$S/c5-proc-guard-20261102.sh"
  chk() { [ "$(sha256sum < "$S/$1" | cut -c1-64)" = "$2" ] || { echo "BAD $1"; exit 1; }; }
  chk d31612-phase.sh ab0f929b7228afd3b4ee17597e4c46222ffea098fdd7665548dc1958ddeac47e
  chk c5-observe-20261102-r3.sh f3362f881f0f1c8aae71c4f88ae33a0c65e9b7f4c0ef79dbf2fc152371b8d169
  chk c5-proc-guard-20261102.sh be473b78e4a24d87aa6e8f0cb2400f3d34934ba296712c59e99fd526421b1046
  echo "STAGE PASS"
)
```

Then PowerShell (Windows OpenSSH, alias `afldb`); `mkdir` without `-p` fails if the directory exists, which is intended:

```powershell
ssh afldb "mkdir -m 700 /home/arm/d31612"
scp D:\tmp\d31612-stage\d31612-phase.sh D:\tmp\d31612-stage\c5-observe-20261102-r3.sh D:\tmp\d31612-stage\c5-proc-guard-20261102.sh afldb:/home/arm/d31612/
ssh afldb "cd /home/arm/d31612 && printf '%s  %s\n' ab0f929b7228afd3b4ee17597e4c46222ffea098fdd7665548dc1958ddeac47e d31612-phase.sh f3362f881f0f1c8aae71c4f88ae33a0c65e9b7f4c0ef79dbf2fc152371b8d169 c5-observe-20261102-r3.sh be473b78e4a24d87aa6e8f0cb2400f3d34934ba296712c59e99fd526421b1046 c5-proc-guard-20261102.sh | sha256sum -c -"
```

All three lines must print `OK`. Each phase below is `ssh afldb "bash /home/arm/d31612/d31612-phase.sh <phase>"`; it ends `D31612 <phase> PASS` or prints `STOP: <reason>` and `D31612 <phase> FAIL`. A failed assertion is a STOP; an expected value is never adjusted.

### P-A. Production preflight (read-only; Claude)

`ssh afldb "bash /home/arm/d31612/d31612-phase.sh pa"`. Asserts: checkout at `924ff273`, clean; no release lock; `current`=`OLD_ID`, `previous`=`OLD_PREV`; `release.mjs status` and `verify OLD_ID`; MemAvailable at least 2100 MB; free disk at least 6 GB; no dump, rsync or restore; no `afldb` timer inside 100 minutes; no `afldb` cron entry; **G1**; `.env` trigger line count 1 **and** the serving process's effective count 1 (cwd = `OLD_ID`); match timer enabled, Brownlow and AFL Tables timers disabled; helper bytes pinned; the helper's `timer` phase PASS (setting `true`, nothing running); state `OLD_SERVING`.

### D0. Push the explicit revision (OWNER, Windows Git Bash, repository root)

Not before G0, and not before P-A PASS. This block is byte-for-byte `d0-push-block.sh` (SHA above). It pushes `H`, **never `HEAD`**; a local `HEAD` beyond `H` is fine and is not pushed. It refuses without the gate file, re-runs the static check from H's own pinned bytes, requires `origin/main` to still be `924ff273`, uses no `--force`, and prints the 11 commits before it pushes.

```bash
# D0 -- OWNER ONLY -- Windows Git Bash. Pushes the EXPLICIT revision H, never HEAD or a branch tip.
# Paste as one block. Any failed assertion stops it before the push; there is no PASS line unless every step held.
export MSYS_NO_PATHCONV=1
REMOTE=origin
R=a0b1080f5b98aee7191894c138be27bb524c7b1b
H=d00e07e37566e92b35a34e62a1ff03e173715e87
PROD_HEAD=924ff273261834e4112e3f41b61ceeab55427534
PKGD=docs/v2/evidence/d31612-release-package-20261102
GATE=$PKGD/first-night-gate.txt
( set -euo pipefail
  cd /d/dev/afldb
  [[ $R =~ ^[0-9a-f]{40}$ ]]; [[ $H =~ ^[0-9a-f]{40}$ ]]; [[ $PROD_HEAD =~ ^[0-9a-f]{40}$ ]]
  git cat-file -e "$R^{commit}"; git cat-file -e "$H^{commit}"; git cat-file -e "$PROD_HEAD^{commit}"
  # G0: the first-night result is recorded AND reviewed, and the decision is to proceed (a file only the reviewer writes)
  tr -d '\r' < "$GATE" | grep -qx 'FIRST-NIGHT-RECORD: reviewed'
  tr -d '\r' < "$GATE" | grep -qx 'RELEASE-DECISION: proceed'
  # H is exactly the qualified revision's descendant (docs only) -- the same pinned bytes production will run
  git show "$H:$PKGD/static-delta-check.sh" | bash -s -- "$H"
  git merge-base --is-ancestor "$PROD_HEAD" "$H"
  # nobody pushed since the preflight
  [ "$(git ls-remote "$REMOTE" refs/heads/main | cut -f1)" = "$PROD_HEAD" ]
  echo "local HEAD: $(git rev-parse HEAD)  (a different HEAD is fine: only H is pushed)"
  echo "pushing $(git rev-list --count "$PROD_HEAD..$H") commits, tip $H:"
  git log --oneline "$PROD_HEAD..$H"
  git push "$REMOTE" "$H:refs/heads/main"               # no --force: a non-fast-forward is rejected
  [ "$(git ls-remote "$REMOTE" refs/heads/main | cut -f1)" = "$H" ]
  echo "D0 PASS: $REMOTE/main = $H"
)
```

### D1. Baseline, then fast-forward the checkout to H (Claude)

`ssh afldb "bash /home/arm/d31612/d31612-phase.sh d1"`. Writes `baseline.txt` first (a previous one is set aside under a new name, never overwritten), fetches, requires `origin/main` = `H` and `R` present, runs H's `static-delta-check.sh` **on production**, `git merge --ff-only H`, requires HEAD = `H` and a clean tree, `release.mjs status` PASS, state `OLD_SERVING`. The running site and `OLD_ID`'s bundle are not touched.

### D2. Build R (Claude; detached `tmux`; once; budget 20 minutes)

```powershell
ssh afldb "tmux new-session -d -s d31612 'bash /home/arm/d31612/d31612-phase.sh d2 > /home/arm/d31612/d2-phase.out 2>&1'"
ssh afldb "tail -n 6 /home/arm/d31612/d2-phase.out"    # poll sparsely, at most about eight times; done at the PASS or FAIL line
```

Refuses outside `tmux`, if `new-id.txt` exists, if HEAD is not H or the tree is dirty, or if the state is not `OLD_SERVING`. Runs `release.mjs build --checkout /home/arm/projects/afldb --revision R --afldb-env production --typecheck off-host --smoke-paths /players,/clubs,/seasons` with the Linux typecheck evidence for R (`docs/v2/d31612-linux-qualification-2026-11-02.md`, 4146/4146 blobs). The route's own guards apply unchanged (admission MemAvailable at least 2,100 MB with the off-host switch and 6 GB disk; floor 384 MB kills the build's process group; production has 3,915 MB and no swap). Immediately after the build/`tee` pipeline it requires **both** to have exited 0 (`PIPESTATUS`; `pipefail` alone does not stop the script) and otherwise STOPs with the build's exit code, **before** any parsing, `verify` or `new-id.txt`, even if a syntactically valid `RELEASE READY` line was printed first. Only then it parses `RELEASE READY a0b1080f5b98-<BUILD_ID>`, runs `release.mjs verify`, proves **`current` and `previous` did not move**, and only then writes `new-id.txt`. Any `REFUSED`, abort or failure leaves both links untouched and `new-id.txt` unwritten: nothing was promoted, nothing to recover. A MemAvailable floor under about 900 MB means stop and look, not retry blindly.

### D3a. Promote (Claude)

`ssh afldb "bash /home/arm/d31612/d31612-phase.sh d3a"`. `release.mjs promote NEW_ID` (every refusal happens before a link moves; `previous` becomes `OLD_ID`); state must become `NEW_SELECTED_OLD_RUNNING`. The running service is unchanged until it restarts. If this stops anywhere, run `probe`; never roll back or restart by reflex.

### D3b. Restart (**OWNER ONLY**)

At least 30 seconds after the last start; about 15 to 30 s of downtime. The restart does not touch the AFL API timer or its units; a running settle is a separate process.

```bash
sudo systemctl restart afldb
```

### D3c. Identity, health and preservation (Claude)

`ssh afldb "bash /home/arm/d31612/d31612-phase.sh d3c"`. `deploy/post-install-check.sh NEW_ID` (waits up to 60 s for health; every `FAIL` stops, a `CACHE` line for the old build id is an old edge copy and does not); state `NEW_SERVING`; the latest `serving build` journal line names `NEW_ID` and revision `a0b1080f5b98` (if `arm` cannot see it the script says so and the process cwd and probe carry the identity); then the **preservation comparison against `baseline.txt`** (section 2): MainPID changed, cwd = `NEW_ID`, `previous` = `OLD_ID`, timer next elapse and last trigger unchanged, timer enablement triple unchanged, `.env` count unchanged, **the new process's effective trigger count exactly 1**, and the helper's `timer` phase PASS at H.

### D4. Authenticated visual acceptance (owner signs in; Claude reads the captures; budget 20 minutes)

Rendering only; the runner navigates and **never fills, clicks, submits, or reads cookies or storage**. Repository root, workstation (the repo's own Playwright; headed Chromium; the evidence directory must not exist):

```bash
node docs/v2/evidence/d31612-release-package-20261102/live-accept-d31612.mjs docs/v2/evidence/d31612-release-execution-<date>/d4
```

1. A browser window opens at `https://beta.afldb.com/admin/operations`. **The owner signs in** (credentials and MFA typed by the owner; Claude never sees or enters them). The runner waits up to 15 minutes for a visible "Signed in as … (Super Admin)".
2. It then inspects `/admin/current-season` at **1280x800 (desktop)** and **390x844 (mobile)**, saving a full-page PNG at each and `results.json`.
3. Gates, each recorded as a captured image or `VISUAL: UNVERIFIED`, never prose:

| Gate | Passes when |
|---|---|
| G1 | the subtitle reads: AFL Tables network acquisition retired, nightly timer disabled, match ingestion from the AFL API match timer while its switch is Enabled, Brownlow governed separately and off until a count window, and "there is no Start control" (plus the settle panel's "no Start control (AFLDB-ISSUE-316, D-316-12)") |
| G2 | neither "still runs on the host" nor "neither starts nor stops it", the retired on-demand and polkit wording, appears |
| G3 | "AFL API Current-Season Ingestion" shows **Enabled** |
| G4 | "Brownlow Live Ingestion" shows Admin control **Disabled** and Deployment gate **Disabled** |
| G5 | both settle rows show a service state (Running, Idle, Last run failed, Unknown or Not installed), **not** "Unit status is not read on this host" (this proves the restart kept `AFLDB_SETTLE_TRIGGER=systemd`) |
| G6 | no control labelled "Start" |
| G7 | HTTP 200, no horizontal overflow, no bad `/_next/static` asset, no console error |

4. Claude **opens both PNGs and reads `results.json`** and states each gate from the images. A runner FAIL is not a verdict on the release by itself: classify it from the screenshot (a runner defect, such as a label the runner expects, is recorded as such and judged by the owner; the expected strings are not edited mid-window). The runner has been syntax-checked only and has never run; a missing or failed capture means `VISUAL: UNVERIFIED` and the condition stays unmet.

**Decision.** Accept only when D3c PASS and every D4 gate is evidenced. If D4 is not complete and passing within 90 minutes of D3b, recover.

## 6. Stop and recovery (state-aware; no database action is ever part of a rollback)

**The rule.** The pinned outgoing release is `OLD_ID`. Recovery always names it (`rollback --to OLD_ID`, built into `r2` and `r3-links`). **An unqualified `rollback` is forbidden**: it would select `previous`, which before a promotion is `fd48ace0c2cb-…`, not the release that is serving. Never roll back or restart a release the probe shows as healthy and unchanged.

First, always (read-only): `ssh afldb "bash /home/arm/d31612/d31612-phase.sh probe"`. The phase prints the state probe's own diagnostics and **exits with the probe's exit status** (nonzero, with `D31612 probe FAIL (the state probe exited N...)`, if the probe itself failed, for example an unreadable `new-id.txt` or a missing probe script); an `UNCERTAIN` state is information, not a probe failure, and exits 0.

| STATE | Meaning | Action |
|---|---|---|
| `OLD_SERVING` | `OLD_ID` selected, running, healthy (promotion refused or never happened, or recovery finished) | Preserve and stop; report the refusal text. No rollback, no restart |
| `NEW_SELECTED_OLD_RUNNING` | promoted, not restarted | Abandon: `r2` (links only, then `post-install-check` on `OLD_ID`). Continue: D3b |
| `NEW_SERVING` | restarted and healthy on `NEW_ID` | D3c, D4. If any gate fails or 90 minutes pass: `r3-links` |
| `NEW_SELECTED_FAILED` | `NEW_ID` selected, unit down or unhealthy (probe again after 60 s first) | `r3-links` |
| `OLD_SELECTED_NEW_RUNNING` | links back at `OLD_ID`, process still `NEW_ID` | the owner restarts (below), then `r3-verify` |
| `TRANSIENT` | unit `activating` | change nothing; probe again in 15 s |
| `UNCERTAIN` | anything else | **act on nothing** (R5) |

**R3 (after the restart, including acceptance failure).** First keep the evidence: `systemctl status afldb --no-pager`; `journalctl -u afldb --since '15 minutes ago' --no-pager`. Then `r3-links` (requires `current` = `NEW_ID`; `rollback --to OLD_ID` leaves `current`=`OLD_ID`, `previous`=`NEW_ID`, retained and not deleted). The owner runs `sudo systemctl restart afldb` (at least 30 s after the last start; on `start-limit-hit`: `sudo systemctl reset-failed afldb && sudo systemctl start afldb`). Then `r3-verify`: post-install check on `OLD_ID`; state `OLD_SERVING`; `previous` = `NEW_ID`; then the same read-only **preservation comparison against `baseline.txt`** that `d3c` makes, applied to the restored process: a different MainPID from the baseline (the recovery restart happened), cwd = `OLD_ID`, **exactly one** `AFLDB_SETTLE_TRIGGER=systemd` in its readable environment (and the any-mention count equal to the baseline), the `.env` trigger line count equal to the baseline, and the match timer's next elapse, last trigger and the enablement triple equal to the baseline; finally the helper's `timer` phase (setting, timers, nothing running). Counts only; no value is printed. With no baseline, preservation cannot be proven and the phase STOPs (the restoration itself is then judged by the owner from the probe and post-install output).

**R5 (`UNCERTAIN`, or `rollback --to OLD_ID` refuses because `OLD_ID` fails its manifest check).** Run nothing that changes state; collect read-only: the probe output, `ls -l /home/arm/afldb-releases`, `release.mjs status`, `systemctl status afldb --no-pager`, `journalctl -u afldb --since '30 minutes ago' --no-pager`, `ls /home/arm/afldb-releases/*.lock`; keep every log and report. Choosing a deeper release is an owner decision, not a step here.

A UI text release has no data to reverse. The checkout stays at H after a rollback (a fast-forward is not undone); the rollback restores the serving release only. Nothing is deleted: `OLD_ID`, `OLD_PREV`, the deeper releases and `NEW_ID` all stay. A push is not undone either; `origin/main` at H is harmless (documentation plus the inert, unserved code).

## 7. Closing ISSUE-316 (stays OPEN until both conditions are met and the owner records it)

The owner's Option A has three conditions: **(a)** first scheduled run observed and assessed, **(b)** D-316-12 deployed and visually verified, **(c)** a named successor (**met**: AFLDB-ISSUE-332). Closing needs this evidence, all of it, in the repository:

| # | Evidence | Source |
|---|---|---|
| E1 (a) | the verbatim output of `first-run` and `first-night` for the 3 Nov run (taken before D1), the owner's journal output if used, and `first-night-gate.txt` with its classification | first-night evidence folder |
| E2 (b) | `pa`, `d1`, `d2` (the `RELEASE READY` line and `new-id.txt`), `d3a`, the owner's restart time (`ActiveEnterTimestamp`), `d3c` PASS, `baseline.txt`, `probe` = `NEW_SERVING`; `git rev-parse` of `origin/main` and the checkout both = `H` | `d31612-release-execution-<date>/` |
| E3 (b) | `d4/results.json` with `verdict` PASS and every check, the two PNGs (1280x800, 390x844) **opened and read**, and Claude's per-gate statement from the images | `.../d4/` |
| E4 | the preserved-state comparison printed by `d3c` (timer next elapse and last trigger, enablement, setting `true`, effective trigger count 1, Brownlow off) | `d3c` output |
| E5 (c, retained) | AFLDB-ISSUE-332 open in `issues.md` and `IssuesIndex.md`, holding C6 to C9 and D-316-5 to D-316-11 with their gates | successor record |
| E6 | the owner's recorded acceptance wording (close-out document section 4, Option A text) naming the first-night class and the successor | the owner |

Non-gating, recommended: observe the **second** night (Wed 4 Nov after 05:15) read-only, as confirmation that the release left the nightly undisturbed. It is not one of the owner's conditions.

**When E1 to E6 exist, and only then** (the owner records the decision; Claude then edits, under `CLAUDE.md` section 5): resolve ISSUE-316 in `issues.md` as "cutover delivered" with the real root cause, fix and validation and a pointer to ISSUE-332; remove it from `IssuesIndex.md` and the Open Issues table; add the `CHANGELOG.md` Unreleased entry for the retained behaviour change (admin wording and the cutover); move `issues/open/AFLDB-ISSUE-316*.md` and its handoff companions and evidence to `issues/closed/`. **Retain ISSUE-332's future obligations unchanged**: closing 316 satisfies none of them. They remain open with their own gates: nightly retained-batch behaviour (decide after the first night; about 130 empty-effect rows expected); C7 criteria approved **before Opening Round 2027-03-17T00:00Z** and C7 acceptance after the first concluded round; D-316-8 attendance and D-316-9 coaches before Opening Round; D-316-10 revalidation vs ISR lag before the first concluded round; C6 debutant routine each round from Opening Round (D-316-5 reviewed after round 2); C9 / D-316-6 option chosen by June 2027 and delivered before the 2027 rollover; D-316-7 Brownlow season totals and the C8 count window before September 2027 (no Brownlow activation is authorised by anything here); D-316-11 on-demand Start recorded as not pursued. If either (a) or (b) fails, ISSUE-316 stays open and its `IssuesIndex.md` entry records the new state and next action.

## 8. Owner approval (one complete statement; **nothing is granted until the owner writes it**)

```text
I, Stuart, approve the D-316-12 UI release to afldb-prod, exactly as docs/v2/d31612-ui-release-handoff-2026-11-02.md (rev 3), in the window <start> to <end> AEDT on <date> (daytime, outside 05:00 to 05:20 AEDT, owner attended).

CONDITION: execution starts only after the first scheduled run's result is recorded and reviewed, and I have written first-night-gate.txt with FIRST-NIGHT-RECORD: reviewed and RELEASE-DECISION: proceed. Until then nothing in this approval may be executed, and if the gate says hold, none of it may be.

Pinned: push revision H = d00e07e37566e92b35a34e62a1ff03e173715e87 (qualified code revision R = a0b1080f5b98aee7191894c138be27bb524c7b1b; code byte-identical); origin/main and the production checkout are 924ff273261834e4112e3f41b61ceeab55427534 before the push; the outgoing release ea98a35f2061--vY0EFS0DdR-TiPkxTZz6 is the only rollback target; file hashes as listed in that document, in particular d31612-phase.sh sha256 ab0f929b7228afd3b4ee17597e4c46222ffea098fdd7665548dc1958ddeac47e (the corrected script; the earlier 5bb929aa... is superseded and must not be used).

I will push H with the section 5 D0 block (explicit revision, no force), run every sudo command and the restart, and sign in for the visual check myself.
Claude may, as arm without sudo: create the new directory /home/arm/d31612 and copy the three pinned files into it; run phases pa, d1, d2, d3a, d3c, probe and (only as the document's state table directs) r2, r3-links and r3-verify; fast-forward the production checkout to H; build R; promote the new release; and read the captured visual evidence. Claude may write only: /home/arm/d31612/*, the checkout fast-forward, the new release directory, the two release links, and evidence files in this repository.
Not approved and not to be done: schema or migration, any timer or setting change, any .env change, any Brownlow step, a manual settle or provider request, a push of anything but H, a cleanup of retained material, closing ISSUE-316 (that is a separate recorded decision under section 7), or any action on AFLDB-ISSUE-332.
The match timer, the AFL API Current-Season Ingestion setting and the effective AFLDB_SETTLE_TRIGGER=systemd must be unchanged throughout and are verified against the baseline; a difference is a STOP.
If the acceptance decision is not complete and passing within 90 minutes of the restart, recover per section 6.
Recorded: <date and time>.
```

## 9. Limits of this preparation (stated plainly), and the wrapper corrections of 2 Nov (late)

**Corrected after the first rev 3 draft** (script sha `5bb929aa...` is superseded by `ab0f929b...`; transport check and approval reference updated): (1) `d2` now requires the build and `tee` to exit 0 immediately after the pipeline, before parsing, `verify` or writing `new-id.txt`; (2) `r3-verify` now proves the preserved state on the restored process (exactly one effective `AFLDB_SETTLE_TRIGGER=systemd`, `.env` count, match-timer elapse and last trigger, enablement triple, all equal to the `d1` baseline, MainPID changed, `previous` = `NEW_ID`), where it previously only ran the post-install check, the probe and the helper; (3) `probe` now exits with the underlying probe's status and keeps its output. Nothing else in the script changed (the `d3c` checks were moved into the shared function, not altered). The application build revision R and the push revision H are **unchanged**: no code or `deploy/` path was touched, so the Linux qualification and the static-delta result stand.

**Measured on the workstation, mocked host only** (record: [rev3-preparation-tests-20261102.txt](evidence/d31612-release-package-20261102/rev3-preparation-tests-20261102.txt) section 5; transcript: [mock-test-run-20261102.txt](evidence/d31612-release-package-20261102/mock-test-run-20261102.txt)): `bash d31612-phase-mock-test.sh <new dir>` ran the real `d31612-phase.sh` and the real `state-probe.sh` against stubbed `systemctl`/`release.mjs`/`/proc`/links and a throwaway Git checkout: **79 cases, 257 assertions, 0 failed** (1 min 55 s). It covers every phase, both build-failure negative controls, successful and refused promotion, `OLD_SERVING` under `r2` and `r3-links` (no rollback, no restart instruction), `r2` link-only recovery, `r3-links` then `r3-verify` on a real `d1` baseline, missing and invalid `new-id.txt` for every phase that reads it, uncertain state, a refused rollback, a failing post-install check on `OLD_ID`, a missing or doubled effective trigger after recovery, and a failing underlying probe. Every mutator was a logging stub that was asserted per test; over the run the mutators were 10 build, 5 promote and 8 qualified `rollback --to OLD_ID`, and **no** `systemctl restart/start/stop/reset-failed/enable/disable`, `sudo` or unqualified rollback (each proven refused by a harness self-test). Three mutation controls show the tests catch the old defects.

- **Never run on production:** `d31612-phase.sh` (a defective assertion STOPs, it cannot proceed past itself; P-A is read-only, so it is the first live test). The mock proves the script's logic and its refusals; it does **not** exercise real systemd, the journal, the real `release.mjs`/`post-install-check.sh`, the real helper bodies, or the host's `/proc`.
- **Never run:** `live-accept-d31612.mjs` (`node --check` only). **The live page is `VISUAL: UNVERIFIED`** until D4. The static render of the panel is not the live page.
- Tested for real on the workstation: the D0 block against a throwaway bare repository (rev3 test record section 2), the static delta check on H, the tree, blob and lock-hash comparisons. The D0 block and `live-accept-d31612.mjs` are **unchanged** in these corrections (hashes above).
- Not re-run, deliberately: the Linux qualification, any broad suite and the production-mode build (the code bytes are the same). Production state was last read at 22:41 AEDT on 2 Nov (rev 2's observation); P-A re-reads it.
- **The first-night gate is still pending and nothing was done about it:** no early observation, no gate file, no overnight wait; the single session-only cron job `8f9f4d02` (05:23 on 3 Nov) and the durable fallback in section 3.1 are as they were.
- The first-night result, the gate file, the owner's window and approval, and every production fact after 22:41 AEDT are **not known** here.
