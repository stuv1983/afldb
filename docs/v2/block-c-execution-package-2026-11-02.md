# Block C: ISSUE-316 C3, C4b and C5: execution package (2026-11-02)

**Status: PREPARED. NOTHING WAS RUN ON PRODUCTION.** What *was* run is a synthetic-state self-test of the real read-only `c-prod.sh` phases (a stubbed `systemctl`, stubbed database readers, synthetic C4b records, the real checkout and the real offline readiness tool): 6 accepting cases and 20 refusals (section 4). No unit was installed, enabled or started, no setting written, no `.env` edited, nothing restarted, no provider contacted. C2 is **accepted** (recorded 2026-11-01 on the corrected criterion; not asked again).

This package turns the command text of [the C2-C5 packages](issue316-gap011-c2-c5-packages-2026-11-01.md) (sections 3, 5, 6) into pinned, state-checked steps. Where the two differ this file governs; the older file's facts, the C4b tool contract and the D-316 decisions stand. Files: [`evidence/block-c-package-20261102/`](evidence/block-c-package-20261102/) - `c-prod.sh`, `c-selftest.sh`.

**DEV is separate.** The DEV host (streamanator) has `afldb-settle-afl-api.timer` and the Brownlow timer enabled. That is a DEV-only fact and a DEV-only decision; nothing in this package reads, changes or depends on it, and `c-prod.sh` refuses to run anywhere but `afldb-prod`. Production's units are **absent** until C3 and stay **inert** until C5.

## 1. What is pinned

| Item | Value |
|---|---|
| Order | C3 (independent; may be done any time) -> **Block M-a complete** (migration 118 and the 2027 registration release serving) -> C4-4 readiness -> **C4b** (D-316-13) -> **C5** (D-316-4, before 2027-03-17T00:00Z). Block B and Block L are independent of C |
| R | the revision the owner names and the host checkout runs; every phase refuses a checkout that is not exactly R and clean. The six C3 files equal their blobs at `affe9a2c` and at the current head (re-hashed today; `git diff affe9a2c HEAD -- deploy` is empty) |
| Six pinned files (sha256) | `deploy/afldb-settle-afl-api.service` `8698b686…b7f4`; `.timer` `a37114b4…a2c2`; `deploy/afldb-settle-afl-api-brownlow.service` `55b0a70b…b402`; `.timer` `7fa27377…3bb1`; `deploy/afldb-settle-afl-api.sh` `b35e3a32…aeeb`; `deploy/afldb-settle-afl-api-brownlow.sh` `05a559be…f9b1` (full values in `c-prod.sh` and in the older package, section 3) |
| Retained 2027 feed | sha256 `21fd12e7704b7c7146cfbab414352352f3cfaa53e7ef5038f4411fa789e4c84d` (`tests/fixtures/afl_api/seasons/01-season-matches-2027.raw.json` in the repository) |
| Switch (setting) | `acquisition.afl_api_current_season_enabled`: absent or `false` until C5 |
| Register / AFL Tables | `data/reference/seasons.json` `in_progress_seasons` exactly `[2027]` (from the M-a release) and `data/reference/afltables-network.json` `status` `retired` |
| First 2027 match | 2027-03-17T00:00Z (C4b and C5 refuse after it) |
| Trigger variable (approved for the C5 plan) | exactly one line `AFLDB_SETTLE_TRIGGER=systemd` in `/home/arm/projects/afldb/.env`; absent today; set **at C5**, never earlier |
| Roles | reads use `afldb_backup` (read-only session, identity proved: `afldb_prod`, OID 66668, system identifier 7674454702926115004); the C4b tool uses the roles it already uses (the owner's D-316-13) |

## 2. Who does what

| Step | Who |
|---|---|
| `c3-pre`, `c3-accept`, `c4b-pre`, `c5-pre`, `c5-env`, `c5-accept` (read-only) | Claude over SSH as `arm`, or the owner |
| C3 install, `daemon-reload`, `systemd-analyze verify` | **Owner (sudo)** |
| C4b run (provider contact; temporary switch on, restored and verified) | operator as `arm`, **only under the owner's D-316-13 grant**, owner-attended; the owner designates who reviews the evidence |
| polkit listing, enabling the match timer, restart, effective-environment read-back | **Owner (sudo)** |
| Enabling the switch (admin toggle, audited) and the one-line `.env` edit | the owner, or an operator under the D-316-4 approval |

Claude never uses `sudo`, never restarts anything, never edits `.env` or the setting except through the C4b tool under D-316-13, never enables a timer.

## 3. Variables

```bash
# production, as arm
R=REPLACE_WITH_40_HEX_R                            # the revision named in the approval; the checkout must already be at it
PKG=docs/v2/evidence/block-c-package-20261102
PKGD=/home/arm/blockc-pkg-${R:0:12}/$PKG
CHK=/home/arm/projects/afldb
( set -euo pipefail; mkdir -m 700 "/home/arm/blockc-pkg-${R:0:12}"; git -C "$CHK" archive "$R" "$PKG" | tar -x -C "/home/arm/blockc-pkg-${R:0:12}" )   # the package as R's own bytes
```

## 4. Validation (actual results; nothing here touched production)

`c-selftest.sh` runs the real `c-prod.sh` logic (a copy whose only differences are the host check, the `/etc/systemd/system` path, the node path and three stubbed database readers; the diff is 9 lines) on streamanator against a clean checkout at `ae8b625b8e09c353add74b1296d422d090a80321` with its `node_modules`, with a synthetic `systemctl`. **`C SELFTEST PASS`**: c3-pre, c3-accept, c4b-pre (including the real offline readiness tool, **REPOSITORY READY**), c5-pre, c5-env and c5-accept accept the correct state, and refuse: a bad revision; a unit already loaded; the switch true; the AFL Tables timer enabled; an already-installed unit file; a wrong pin; the Brownlow timer enabled; a service active; a drifted installed copy; a missing or different feed; the first-match time passed; a HALT record; a missing record; the trigger variable already present; a second mention of it; none of it; the Brownlow timer enabled at accept; the switch false at accept. **Not provable off-host:** the real `systemctl` output on the production host, the polkit directory, the sudo steps, the provider call, the real C4b run (its tool was exercised 36/36 in isolation, [master sequence](master-execution-sequence-2026-11-01.md) section 7).

## 5. C3: install the four AFL API units inert (D-316-2)

**Pre (read-only).** `bash "$PKGD/c-prod.sh" c3-pre "$R"` must end `C3-PRE PASS`: checkout exactly R and clean; the six files equal their pins; the units are `not-found`/`inactive`; no unit file under `/etc/systemd/system/afldb-settle-afl-api*`; switch absent/false; the AFL Tables timer disabled; `sh -n` on both scripts.

**Owner (sudo), copy-ready:**

```bash
cd /home/arm/projects/afldb
sudo install -m 0644 -o root -g root deploy/afldb-settle-afl-api.service deploy/afldb-settle-afl-api.timer deploy/afldb-settle-afl-api-brownlow.service deploy/afldb-settle-afl-api-brownlow.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemd-analyze verify /etc/systemd/system/afldb-settle-afl-api.service /etc/systemd/system/afldb-settle-afl-api-brownlow.service     # no output = pass
```

**Accept (read-only; runs twice, a minute apart).** `bash "$PKGD/c-prod.sh" c3-accept "$R"` must end `C3-ACCEPT PASS`: both services `loaded`/`inactive`; both timers `disabled`/`inactive`; each installed copy equals its repository file; switch absent/false. Anything else, in particular an enabled or active Brownlow timer, is a C3 failure: stop and use the reversal.

**Reversal (inert files only; owner sudo).** `sudo rm /etc/systemd/system/afldb-settle-afl-api{,-brownlow}.{service,timer}` then `sudo systemctl daemon-reload`.

## 6. C4b: the D1 rehearsal on production (D-316-13)

**Preconditions (the owner confirms what the tool cannot prove):** C3 accepted; Block M-a complete and the serving release is the compatible one; the AFL Tables timer is disabled (the tool proves the switch `retired`, not the timer); no 2027 match has started.

**Pre (read-only).** Copy the retained feed to the host (it is in the repository at the path in section 1; a copy from the checkout is fine), then `bash "$PKGD/c-prod.sh" c4b-pre "$R" <feed file>` must end `C4B-PRE PASS`: checkout exactly R and clean; ledger 118 and its digest; switch absent/false; units installed and inert; AFL Tables timer disabled; before 2027-03-17T00:00Z; feed bytes equal the pin; register exactly `[2027]` and switch `retired`; the offline readiness tool prints **REPOSITORY READY**.

**Run (one tmux session, owner-attended, only under D-316-13; the evidence directory must be new and outside the checkout):**

```bash
cd /home/arm/projects/afldb
node node_modules/tsx/dist/cli.mjs tools/current-season/afl-api-c4b-rehearsal.ts --season 2027 --decision D-316-13 --evidence-dir /home/arm/backups/afldb/c4b-$STAMP --max-minutes 30
```

The tool enables the setting for the run only, acquires the 2027 snapshot (a provider contact inside D-316-13), runs `settle-afl-api.ts --dry-run --auto-apply --require-complete-source`, writes the setting back to `false` however the run ends, verifies it, and evaluates the HALT criteria (dry-run canonical inserts and updates both 0, complete season feed, BEFORE and AFTER identical, both timers still disabled/inactive, readiness exit 0). **Exit codes:** `0` CLEAR; `1` HALT (setting restored and verified; the reasons are in `result.json`); `2` refused before any write; `3` **RESTORATION NOT VERIFIED**: immediately `node node_modules/tsx/dist/cli.mjs tools/current-season/afl-api-c4b-rehearsal.ts --restore-only --evidence-dir /home/arm/backups/afldb/c4b-$STAMP` and confirm the setting reads `false` before anything else (the admin toggle is the second route). A parent SIGKILL is rescued by the detached watchdog (rehearsed in isolation: about 5 s).

**Record.** `/home/arm/backups/afldb/c4b-$STAMP/result.json` with `verdict: CLEAR` is the PASS record `c5-pre` requires. The owner-designated reviewer reads the evidence directory before C5.

## 7. C5: cutover go (D-316-4)

Only with the C4b CLEAR record, before 2027-03-17T00:00Z, with the Brownlow timer disabled. **Pre:** `bash "$PKGD/c-prod.sh" c5-pre "$R" /home/arm/backups/afldb/c4b-$STAMP` must end `C5-PRE PASS` (checkout R; ledger 118; switch absent/false; units inert; AFL Tables timer disabled; before the first match; `result.json` is a CLEAR; no `AFLDB_SETTLE_TRIGGER` line yet).

| # | Step | Who | Check |
|---|---|---|---|
| 1 | readiness on the newest retained feed (as in `c4b-pre`) | operator | REPOSITORY READY |
| 2 | `sudo ls -la /etc/polkit-1/rules.d` (empty at the 2026-10-31 window); remove only a rule that has appeared | owner | listing empty |
| 3 | append exactly one line `AFLDB_SETTLE_TRIGGER=systemd` to `/home/arm/projects/afldb/.env` (no other edit) | owner or operator under D-316-4 | `bash "$PKGD/c-prod.sh" c5-env "$R"` -> `C5-ENV PASS` (exactly one exact line, no other variant) |
| 4 | `sudo systemctl restart afldb` (at least 30 s after the last start) | **owner** | journal shows the new MainPID serving; `tr '\0' '\n' < /proc/<MainPID>/environ \| grep -c '^AFLDB_SETTLE_TRIGGER=systemd$'` = `1` (needs the owner or sudo) |
| 5 | enable `acquisition.afl_api_current_season_enabled` (the admin toggle writes it audited) | owner | setting `true`; one `auth_audit_log` row |
| 6 | `sudo systemctl enable --now afldb-settle-afl-api.timer` (the match timer only) | **owner** | `is-enabled` enabled, `is-active` active |
| 7 | `bash "$PKGD/c-prod.sh" c5-accept "$R"` twice, a few minutes apart | operator | `C5-ACCEPT PASS`: switch `true`; match timer enabled and active; **Brownlow timer disabled/inactive**; AFL Tables timer disabled/inactive |
| 8 | the Settle panel as a Super Admin: the service column shows unit state; the cutover wording and button (D-316-12) | owner | per that decision |

An absent or invalid `AFLDB_SETTLE_TRIGGER` cannot introduce a direct-execution path (unit-tested: the variable only permits read-only `systemctl show` reads; `startSettleRun` is retired). **Rollback of C5:** `sudo systemctl disable --now afldb-settle-afl-api.timer`; set `acquisition.afl_api_current_season_enabled` to `false` (admin toggle); delete the `.env` line and `sudo systemctl restart afldb`; verify each. The runbook's recovery section governs anything a run wrote in between. C5 must not be done while C4b is HALT/REFUSED/unrecorded, after the first 2027 match, or with the Brownlow timer enabled.

## 8. Approval statements (the owner writes them; this session does not)

- **C3 (D-316-2):** *"I approve installing the four AFL API unit files inert on `afldb-prod` at revision `<R>`: the six files in docs/v2/block-c-execution-package-2026-11-02.md section 1 with their pinned hashes; no unit started or enabled, no setting changed."* (The sudo commands are the owner's.)
- **C4b (D-316-13):** *"I grant D-316-13: run the C4b D1 rehearsal for season 2027 on `afldb-prod` at revision `<R>` with the evidence directory `<path>`, reviewed by `<name>`; C3 and Block M-a are complete and I am attending."*
- **C5 (D-316-4):** *"I approve the AFL API cutover go on `afldb-prod` at revision `<R>` as in section 7, on the C4b CLEAR record `<path>`, including the one-line `AFLDB_SETTLE_TRIGGER=systemd` configuration."*

## 9. Remaining owner actions

1. C3: choose the window and run the section 5 sudo commands (after `c3-pre`); the DEV timers are a separate decision (item 9 of the master list).
2. After Block M-a: grant D-316-13, name the reviewer, attend the C4b run.
3. C5: grant D-316-4 and run the owner steps 2, 4, 6 (and 5 if you prefer the admin toggle to an operator).
4. Every step above also ends the validity of any baseline taken earlier for Block B (C4b/C5 write `site_settings` and `auth_audit_log`), so the Brownlow stages retake theirs.
