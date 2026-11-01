# ISSUE-316 / V2-GAP-011: C2 acceptance record, and the C3, C4, C4b and C5 packages (2026-11-01)

**Status: PREPARED, NOTHING EXECUTED. Section 2 (C2) is now RECORDED ACCEPTED on the corrected criterion (2026-11-01 addendum); C3 to C5 are not accepted and the withdrawn counted-night work is not revived.** No sudo, no unit installed, enabled or started, no setting changed, no production rehearsal, no writer activation, no cutover, no production migration. Frozen P/H/EXEC, authorities and recovery bindings are untouched and no expired window is revived. This document completes [the earlier reconciliation](issue316-gap011-remaining-reconciliation-2026-11-01.md) with the evidence that record lacked (the snapshot-label check and the `AFLDB_SETTLE_TRIGGER` supply), the C2 acceptance record drafted from actual evidence, and exact reviewable packages for the remaining steps. Procedure stays that of the [runbook](../../issues/open/AFLDB-ISSUE-316.md) §7 (rows C2 to C5, "C4b. D1 rehearsal"); where this document and the runbook differ, the difference is stated in section 1 or 6 and the owner decides.

## 1. New evidence taken today (read-only)

Three read-only SSH sessions to the production host as `arm` (Windows OpenSSH, spaced; outputs withheld from this repository except as quoted): the checkout, the AFL Tables snapshot-label directories, the web unit's environment sources, and the presence (never the value) of the trigger variable. A first attempt printed nothing useful because the piped script began with a byte-order mark and its first command failed silently; it was repeated cleanly and nothing was written to the host by either.

| Fact | Evidence |
|---|---|
| Host | `Australia/Melbourne`, AEDT +11:00; checkout `/home/arm/projects/afldb` at `affe9a2c30842e35557710bc582cb9d6114ee39c`; serving release `fd48ace0c2cb-pqAQwRIJWLjSYzR8LiTuy` (the `current` symlink) |
| AFL Tables labels on the host | Under `data/sources/afltables/`: `coaches/coaches-20260905`; `fitzroy_core/` holds only `settle-*` labels, from `settle-2026-09-02-1958` to **`settle-2026-2026-10-31-0442`** (mtime **2026-10-31 04:42:58 AEDT**), one per night. The label `c2-2026-final-core-v1` is **not** on the host (its manifests are committed under `docs/rebuild-manifests/afltables_fitzroy_core/`) |
| After the retirement window | `find data/sources ... -newermt '2026-10-31 08:00:00 +1100'` returns **nothing**: no label of any source was created after the release window opened (T0 08:00 AEDT; `afldb-settle-afltables.timer` disabled in that window under A-AFLT) |
| Workstation trees | `D:\dev\afldb`, `D:\dev\afldbV2` and `D:\dev\afldb-legacy-20261031-202057\source`: newest AFL Tables label `club-lists-20260905` / `coaches-20260905` / `full-history-20260902` / `issue129-t7-20260903` (directory mtimes: legacy copy up to 2026-09-26, V2 tree up to 2026-10-23; label names all end 20260905 or earlier); no `c2-2026-final-*` bytes in any of them |
| `AFLDB_SETTLE_TRIGGER` | **Not set anywhere readable.** `.env` has no line for it, commented or not (the exact-value count `AFLDB_SETTLE_TRIGGER=systemd` is 0), and `systemctl cat afldb.service` (with drop-ins) names it **0** times. The web unit takes its environment from `EnvironmentFile=/home/arm/projects/afldb/.env`, and `settle-trigger.ts` is inert unless the variable is exactly `systemd`. The unit's actual process environment was not read |
| Why it is absent | **Not established.** ISSUE-127 appended `AFLDB_SETTLE_TRIGGER=systemd` to that `.env` (line 46) and ISSUE-134 recorded it set; the V2 release record says `.env` was not edited during the release. No record explains its absence and none is claimed |
| Offline: match-settle season enumeration vs the 2027 feed | `assessAflApiSeasonEnumeration` on the retained feed (sha256 `21fd12e7…c84d`): **complete**, 0 gaps, 218 ids, statuses `{SCHEDULED: 135, PLACEHOLDER: 83}`. The C4b dry-run's `seasonFeedComplete` check therefore does not fail on the 2027 statuses; the match settle selects `CONCLUDED` only, so a pre-season dry run inserts and updates 0 rows |

## 2. C2 acceptance record (DRAFT from actual evidence; the owner records acceptance)

Runbook C2 acceptance column, item by item:

| Criterion | Result | Evidence |
|---|---|---|
| The commit diff shows `status` `retired`, `decision` `D-316-1`, `in_progress_seasons` `[2027]` | **MET** | `c7e17da2` (2026-10-28 09:14 +1100): `data/reference/afltables-network.json` `status` `retired`, `decision` `D-316-1`, `changed_at` `2026-10-27`; `seasons.json` `in_progress_seasons` includes 2027; the same file reads `retired` at `9ed9c9dd`, at `affe9a2c` (the host's checkout revision) and at this repository's `HEAD`; `c7e17da2` is an ancestor of the released `9ed9c9dd` |
| The deploy carries a rebuild | **MET** | V2 released at `9ed9c9dd`, build `QNEHXAtU53TzUjj0Mb7mv` (2026-10-31, D-V2-PROD-EXEC-1), and later routes ISSUE-329/330 rebuilt from descendants |
| Next nightly logs `AFLDB_AFLTABLES_RETIRED` and exits 0, **or the timer is disabled** | **MET by the second branch** | `afldb-settle-afltables.timer` disabled and inactive (A-AFLT, release window 2026-10-31; re-read 2026-11-01); no nightly has run since |
| Readiness INFO `afltables_network: retired` | **MET** (offline) | the readiness report prints `INFO afltables_network: retired` (re-run today against the retained 2027 feed: REPOSITORY READY, 7/7 PASS) |
| **No AFL Tables snapshot label newer than the rollover's** (as originally worded) | **Superseded by the corrected criterion below** | The wording measured the undeployed plan's rollover label (`c2-2026-final-core-v1`, extracted 2026-10-21 04:34:37Z). The retirement that matters reached production with the 2026-10-31 release, so the criterion is restated on the **actual production writer-retirement boundary** (next row). The ten intervening nightly labels are preserved and accounted for there |
| **Corrected: no AFL Tables acquisition after the actual production retirement boundary, and the ten intervening nightlies accounted for** | **MET (2026-11-01 addendum, section 2.1)** | Boundary: owner-run `sudo systemctl disable --now afldb-settle-afltables.timer`, pasted 2026-10-31 08:17 AEDT, stage `retired` PASS 2026-10-30T21:17:19Z (08:17:19 AEDT) ([execution record](production-execution-record-2026-10-31.md), session `hs-retired.log`, `stage1-owner.txt`). Ten `settle-afltables.ts` batches (ids 61 to 70) all `completed`, the last at 2026-10-31 04:43:25 AEDT, i.e. **before** the boundary; none after (section 2.1) |
| Items not re-proved today | | the final fitzRoy acquisition and ladder witness, the D-233-3 census evidence and the rollover dry-run are historical (State B/C records, `c7e17da2` manifests); not repeated |

### 2.1 Addendum 2026-11-01: C2 accepted on the corrected criterion

Owner direction (2026-11-01): use the actual production writer-retirement boundary on 31 October, not the earlier undeployed plan's rollover label; preserve and account for the ten intervening nightly labels; verify their recorded completion precedes the actual retirement and that no later acquisition exists; any post-retirement acquisition is a STOP.

| Check | Result | Source |
|---|---|---|
| Boundary | 2026-10-31 **08:17 AEDT** (21:17Z 10-30): timer disabled and inactive, stage `retired` PASS | session evidence `stage1-owner.txt`, `hs-retired.log` |
| The ten nightlies (import batches 61 to 70, snapshots `settle-2026-2026-10-22-0438` through `settle-2026-2026-10-31-0442`) | all `completed`; completion times from 2026-10-22 04:39:24 to **2026-10-31 04:43:25 AEDT**; every one precedes the boundary (the last by about 3 h 34 min) | read-only census of the production-derived restore of the verified backup `afldb_prod-20261031-084435` (taken after the boundary, 08:44 AEDT), re-run for this addendum; batch 60 (2026-10-21 04:30) is the nightly before the final acquisition |
| Acquisition after the boundary | **none**: 0 AFL Tables import batches and 0 import batches of any source started at or after 2026-10-31 08:00 AEDT (stricter than 08:17); newest batch of all started 04:42:59 AEDT | same census |
| On the host | newest label directory `settle-2026-2026-10-31-0442` (mtime 04:42:58 AEDT); `find data/sources -newermt '2026-10-31 08:00:00 +1100'` returned nothing; the 2026-11-01 04:30 nightly did not run (timer disabled) | read-only SSH of 2026-11-01 (section 1) |

**Recorded:** "C2 is accepted as applied (rollover `c7e17da2`, retirement D-316-1) and effective in production from the 2026-10-31 release. On the corrected criterion, no AFL Tables acquisition occurred after the actual production retirement boundary (2026-10-31 08:17 AEDT): the ten intervening nightly runs (batches 61 to 70, 2026-10-22 to 2026-10-31) completed before it, the last at 04:43:25 AEDT, and no later import batch or snapshot label exists. Their data effect remains a separate, unexamined question and is not part of this acceptance." This is recorded on the owner's approval-with-clarification of 2026-11-01. **It does not revive the withdrawn counted-night work and does not accept C3, C4, C4b or C5.** A post-retirement acquisition found at any later re-read is a STOP for adjudication, not a finding to absorb.

## 3. C3 package: install the four AFL API units INERT (owner sudo; D-316-2)

Independent of C2 and C4. Installs files only. **No service started, no timer enabled, no setting changed** (`acquisition.afl_api_current_season_enabled` stays absent/off, `AFLDB_AFL_API_BROWNLOW_ENABLED` stays absent; the Brownlow timer is not enabled until C8).

Pinned files, git blobs at the production checkout revision `affe9a2c` (the files the host already holds in `deploy/`; hash the host's copies against these before installing):

| File | sha256 |
|---|---|
| `deploy/afldb-settle-afl-api.service` | `8698b6860ddf530b4954f0cbd585acddf38d12ec2a0436d1553d85ae7471b7f4` |
| `deploy/afldb-settle-afl-api.timer` | `a37114b44eab72d4bc85e15f059a6d7f837f0d503b07f4e0c9934e39bac2a2c2` |
| `deploy/afldb-settle-afl-api-brownlow.service` | `55b0a70b8aba516e48231f4fb8ad1576b7c1c1579218b03e9f9bcd6915e7b402` |
| `deploy/afldb-settle-afl-api-brownlow.timer` | `7fa27377516ce9ea86400542166788727179effbd1b2692397506b3a42903bb1` |
| `deploy/afldb-settle-afl-api.sh` | `b35e3a321a2c276ee4ff0b3f1cfed4dce4afcdfef78d1d7f41e6eb3ef142aeeb` |
| `deploy/afldb-settle-afl-api-brownlow.sh` | `05a559be858633ddbbf099ec4fcd809a5b8fbf0116c2ce83ae6477f73efff9b1` |

Steps, in `/home/arm/projects/afldb` (ISSUE-232 §7 C):

1. **Before (read-only):** `git rev-parse HEAD` equals the revision the owner names; `git status --porcelain` empty; `sha256sum` of the six files equals the table; `systemctl show afldb-settle-afl-api.service afldb-settle-afl-api-brownlow.service -p LoadState,ActiveState` is `not-found`/`inactive`.
2. `sh -n deploy/afldb-settle-afl-api.sh && sh -n deploy/afldb-settle-afl-api-brownlow.sh && echo sh-ok`
3. `sudo install -m 0644 -o root -g root deploy/afldb-settle-afl-api.service deploy/afldb-settle-afl-api.timer deploy/afldb-settle-afl-api-brownlow.service deploy/afldb-settle-afl-api-brownlow.timer /etc/systemd/system/`
4. `sudo systemctl daemon-reload`
5. `sudo systemd-analyze verify /etc/systemd/system/afldb-settle-afl-api.service /etc/systemd/system/afldb-settle-afl-api-brownlow.service` (no output is a pass)
6. `sha256sum deploy/afldb-settle-afl-api*.service deploy/afldb-settle-afl-api*.timer /etc/systemd/system/afldb-settle-afl-api*` (each repository file pairs with its installed copy).

**Acceptance (D-316-2), run twice, a minute apart:** `systemctl show afldb-settle-afl-api.service afldb-settle-afl-api-brownlow.service -p LoadState,ActiveState` = `loaded`, `inactive` for each; `systemctl is-enabled afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.timer` = `disabled`, `disabled`; `systemctl is-active` for the same two timers = `inactive`, `inactive`; the read-only `acquisition.%` query shows the setting off or absent. Anything else, in particular an enabled or active Brownlow timer, is a failure of C3: stop and use the reversal.

**Reversal (inert files only):** `sudo rm /etc/systemd/system/afldb-settle-afl-api{,-brownlow}.{service,timer}` then `sudo systemctl daemon-reload`; the host returns to `not-found`.

**Why this is safe to do before C4:** the units are inert, the tool's own preflight (C4b) requires them installed, and nothing starts them. Note the interaction in section 6 (the trigger variable) before C5, not before C3.

## 4. C4 package: register 2027 and deploy (D-316-3)

The repository work is **done locally and not pushed**: commit `fb54a3ed` ([ISSUE-229 record, section 5](issue229-b2-2027-feed-check-2026-11-01.md)) registers season 2027 (compSeason 102), declares `afl_api_2027`, maps `CD_V313` to Eureka Stadium, declares the placeholder teams and venue, and carries migration 118. Offline readiness against the retained feed is **REPOSITORY READY**, all 7 checks. What remains is installation, and it is ordered because the new code reads `fixtures.confirmation`.

**Order is mandatory: schema first, then code.** Deploying this code without migration 118 would break the admin fixtures queries (`f.confirmation`). Migration 118 is backward compatible with the code now serving (the old code never references the new columns; production `fixtures` held 0 rows in the 2026-10-31 restore), so the schema step can be done on its own and the code step later or never without harm.

| Step | Actor | Action | Check | Rollback |
|---|---|---|---|---|
| M0 | owner | approve migration 118 as a schema step; take and verify a fresh backup (the standing route; the 2026-10-31 sets stay retained) | backup verified | n/a |
| M1 | owner (workstation) | push the reviewed commit(s): `origin/main` must be the expected prior head; fast-forward only, no force | `git ls-remote` shows the pushed head | n/a |
| M2 | operator on host | `cd /home/arm/projects/afldb && git fetch origin && git merge --ff-only origin/main`; `git status --porcelain` empty | HEAD equals the named revision | none needed: the ff of a clean checkout |
| M3 | operator on host (owner DSN) | `AFLDB_PROD_DATABASE_URL=<owner role DSN, not printed> node node_modules/tsx/dist/cli.mjs tools/db/migrate.ts --target prod --status` first (read-only), then without `--status` | exactly one pending migration, `118_fixtures_unconfirmed_participants.sql`, blob sha256 `49e59fcd96aa62142fb2da8141f926997582ef86502b37e22c4796f004498401`; ledger becomes 118 | `ROLLBACK` notes are in the migration file (drop the per-side CHECKs, restore NOT NULL only while no NULL club exists, drop the three columns) |
| C4-1 | operator | `node deploy/release.mjs status` (current `fd48ace0c2cb-pqAQwRIJWLjSYzR8LiTuy`, PASS); at least 2,100 MB `MemAvailable` and 6 GB free (the tool re-checks) | as stated | stop; nothing changed |
| C4-2 | operator, in `tmux` | `node deploy/release.mjs build --checkout /home/arm/projects/afldb --revision <R> --afldb-env production --typecheck off-host --smoke-paths /players,/clubs,/seasons --typecheck-evidence "<Linux typecheck evidence for R>"` | `RELEASE READY <rev12>-<BUILD_ID>` | any `REFUSED`: stop, `current`/`previous` untouched |
| C4-3 | operator then owner | `node deploy/release.mjs promote <NEW_ID>`; owner `sudo systemctl restart afldb` (30 s after the last start); `node deploy/release.mjs status --expect <NEW_ID>`; `bash deploy/post-install-check.sh <NEW_ID>` | journal logs `serving build <BUILD_ID> release <NEW_ID>`; no `FAIL` | `node deploy/release.mjs rollback`; restart; `status --expect fd48ace0c2cb-pqAQwRIJWLjSYzR8LiTuy`; `post-install-check.sh` on it |
| C4-4 | operator | on the host checkout: `node --import tsx tools/current-season/afl-api-cutover-readiness.ts --season 2027 --season-feed <retained feed on the host>` | **REPOSITORY READY**, all seven checks; the printed `venues` SQL, run read-only, returns the expected count (18 legacy-name hosts per the local run) | n/a (read-only) |

The retained 2027 feed (sha256 `21fd12e7704b7c7146cfbab414352352f3cfaa53e7ef5038f4411fa789e4c84d`) is committed as a hash-bound test fixture (`tests/fixtures/afl_api/seasons/01-season-matches-2027.raw.json`, binary-attributed so Git never rewrites it); copy that file to the host, or re-run the capture under its own authority. `<R>` is the commit the owner pushes, not `fb54a3ed` itself, because later commits (this one included) follow it. **The release migration 118 is not the ISSUE-229 first apply**: nothing in C4 writes a fixture row. That apply (`--validate-only`, `--dry-run`, `--apply` of the pinned snapshot) needs its own approval and window, and is independent of C4b and C5.

## 5. C4b package: the D1 rehearsal on production (owner-attended; D-316-13)

**Unavailable until C3 and C4 are deployed** (the runbook states D-316-13 must not be granted or used before C4 is deployed; the tool does not read the identities file before it turns the setting on, so a missing registration fails late, after a temporary enable, as a HALT with the setting restored).

Owner/operator preconditions the tool does **not** prove: C4 deployed and the host's readiness REPOSITORY READY on the newest retained 2027 feed (C4-4); no 2027 match started (Round 1 starts 2027-03-17 UTC per the feed); the AFL Tables timer disabled (the tool proves the switch `retired`, not the timer). Machine-enforced before the first write: `in_progress_seasons` exactly `[2027]`, switch `retired`, both AFL API timers `disabled`/`inactive` and both services `inactive`, setting absent or exactly `false` on the writer and the CLI control path (same live database), the unit's `UnsetEnvironment=` readable, BEFORE saved, watchdog proven ready.

Command, one tmux session, on the host checkout (the evidence directory is new and outside the checkout):

```
cd /home/arm/projects/afldb
node node_modules/tsx/dist/cli.mjs tools/current-season/afl-api-c4b-rehearsal.ts \
  --season 2027 --decision D-316-13 --evidence-dir ~/backups/afldb/c4b-<stamp> --max-minutes 30
```

It enables `acquisition.afl_api_current_season_enabled` for the run only, acquires the 2027 snapshot (a provider contact, inside the owner's D-316-13), runs `settle-afl-api.ts --label L --dry-run --auto-apply --require-complete-source`, writes the setting back to `false` however the run ends, verifies it, and evaluates the HALT criteria: dry-run `canonicalRowsInserted` and `canonicalRowsUpdated` both `0`, `seasonFeedComplete true`, BEFORE and AFTER records identical (matches in season, `afl_api`-owned matches, every `acquisition.%` row except the toggled key), both timers still `disabled`/`inactive`, readiness against the acquired feed exit 0. **Expected for a pre-season 2027 acquisition:** 0 inserts and 0 updates (the match settle selects `CONCLUDED` only; none exist), `seasonFeedComplete true` (shown offline today for the retained 218-record feed). Exit codes: 0 clear; 1 HALT (setting restored and verified); 2 refused before any write; 3 restoration not verified (then `--restore-only --evidence-dir <dir>` and stop). The tool never enables or starts a unit or timer, never runs settle with `--apply`, never deletes the snapshot, and never claims the PASS: **the reviewer records the C4b PASS from the evidence directory** (`before.json`, `acquire.log`, `settle-dry-run.log`, `after.json`, `readiness.txt`, `restore-verified.json`, `result.json`). Any run that ends HALT or REFUSED is a new evidence directory and a new decision, never a pass. The tool has never run against PostgreSQL or production.

## 6. C5 package: cutover go (owner host actions; D-316-4)

Only with the C4b PASS record, and before the first 2027 match (2027-03-17 UTC). Runbook order: re-run readiness on the newest retained feed; confirm `afldb-settle-afltables.timer` is disabled; remove the polkit rule if present; enable `acquisition.afl_api_current_season_enabled`; enable `afldb-settle-afl-api.timer` (the match timer only); update the admin panel wording and button (D-316-12). Acceptance: readiness REPOSITORY READY and switch `retired`; `systemctl is-enabled afldb-settle-afltables.timer` = `disabled`; the **Brownlow timer still disabled**.

| Step | Detail | Check |
|---|---|---|
| 1 | readiness on the newest retained feed (as C4-4) | REPOSITORY READY |
| 2 | `systemctl is-enabled afldb-settle-afltables.timer` | `disabled` (already so) |
| 3 | polkit: `/etc/polkit-1/rules.d` was **empty** at the 2026-10-31 window (owner sudo; recorded absent, no kept copy); re-read with sudo, remove only if a rule has appeared | listing empty |
| 4 | enable `acquisition.afl_api_current_season_enabled` (the admin toggle writes it as `afldb_auth` with an `auth_audit_log` row, as the C4b tool does; the runbook names the setting, not the route) | setting `true`; audit row |
| 5 | `sudo systemctl enable --now afldb-settle-afl-api.timer` (match timer only) | `is-enabled` = `enabled`, `is-active` = `active`; `afldb-settle-afl-api-brownlow.timer` `disabled`/`inactive` |
| 6 | admin panel wording and button (D-316-12) | per that decision |

**Trigger variable `AFLDB_SETTLE_TRIGGER=systemd` (owner-approved for the C5 plan, 2026-11-01).** It is **not set today** (section 1), so the runbook's "keep" becomes "set". It is set explicitly **at C5**, through the reviewed configuration mechanism (a single `.env` line read by `EnvironmentFile=/home/arm/projects/afldb/.env`); **nothing was edited or restarted here.** What it governs, from the code: `settleTriggerConfigured()` is strict equality to `systemd`, and it gates **only read-only `systemctl show` status reads** for the three settle units (the Settle panel's service column). `startSettleRunAction` is retired and never imports `startSettleRun`; there is no direct-execution path anywhere, and the Super Admin "start now" for AFL Tables refuses on the retired switch before any `systemctl` call.

Plan (owner-attended, relative to the C5 start):

| Offset | Step | Check |
|---|---|---|
| +0 | append exactly one line `AFLDB_SETTLE_TRIGGER=systemd` to the host `.env` (no other edit) | **configuration read-back:** `grep -c '^AFLDB_SETTLE_TRIGGER=systemd$' .env` = `1`, and `grep -c '^AFLDB_SETTLE_TRIGGER' .env` = `1` (no duplicate or commented variant) |
| +2 min | owner `sudo systemctl restart afldb` (at least 30 s after the last start) | journal shows the new MainPID serving |
| +3 min | **effective-environment read-back** for the new MainPID: `tr '\0' '\n' < /proc/<MainPID>/environ \| grep -c '^AFLDB_SETTLE_TRIGGER=systemd$'` = `1` (needs the owner or `sudo`; the process environment, not the file, is what the code reads) | `1` |
| +4 min | open the admin Settle panel as a Super Admin | service column shows unit state instead of "On-demand refresh is not enabled on this host." |

**Absent or invalid configuration cannot introduce a direct-execution fallback, proven by unit test** (`tests/afl-api-cutover.test.ts`, commit `4518f321`): the values undefined, empty, `off`, `Systemd`, `SYSTEMD`, ` systemd`, `systemd ` , `true`, `1`, `direct` and `systemd` followed by a newline are all "not configured": the status read is unavailable, `startSettleRun` returns `unavailable`, and **no child process is spawned** (`execFile` not called). Only the exact value `systemd` allows the read-only `show` call, and no `start` is ever issued. Rollback: delete that line and `sudo systemctl restart afldb`; the panel returns to inert. Neither state carries data risk.

C5 must not be done while C4b is HALT/REFUSED/unrecorded, while any 2027 match has started, or with the Brownlow timer enabled. **Rollback of C5:** disable `afldb-settle-afl-api.timer`, set `acquisition.afl_api_current_season_enabled` to `false`, verify both; the runbook's recovery section governs anything written by a run in between.

## 7. Status after this document

| Step | Status |
|---|---|
| C0, C1 | Done (historical) |
| C2 | Applied and in production since 2026-10-31; **acceptance RECORDED 2026-11-01 on the corrected criterion (section 2.1)** |
| C3 | Package ready (section 3); not done |
| C4 | Repository work done locally and proven (fb54a3ed, not pushed); install package ready (section 4); not done |
| C4b | Package ready (section 5); blocked on C3 and C4; **tool exercised end to end on guarded disposable PostgreSQL, 36/36** ([master sequence](master-execution-sequence-2026-11-01.md) section 7); defect F-C4B-1 (setting form) fixed in `4518f321`; not run on production |
| C5 | Package ready (section 6); blocked on the C4b PASS record; before 2027-03-17 UTC |
| C6 to C9 | Not started; follow C5 |

## 8. Owner decisions and actions, consolidated

1. ~~Adopt or amend the C2 record.~~ **Recorded 2026-11-01 (section 2.1).** Whether the ten nightlies need a data-effect examination remains an open, separate question.
2. Approve migration 118 (schema step M0 to M3) and the 2027 registration release (C4-1 to C4-4); choose the window; push the reviewed commit. **Ordering and the new switch finding (F-229-SWITCH) are in the [master sequence](master-execution-sequence-2026-11-01.md).**
3. C3: window and sudo for the four unit files.
4. C4b: grant D-316-13 only after C3 and C4 are deployed; designate who reviews the evidence directory.
5. C5: D-316-4 go. The `AFLDB_SETTLE_TRIGGER=systemd` plan is approved (section 6); the set, restart and read-backs are part of the C5 session.
6. Independently: the ISSUE-229 first apply of the 2027 schedule (own approval), and the admin-list display and L1 decisions recorded in the ISSUE-229 record.

## 9. What was not done

No production write of any kind. The three SSH sessions were read-only (directory listings, `grep -c`/names-only for the trigger, `systemctl cat` filtered to line counts). The retained feed was not re-captured and no provider was contacted. The unit files' contents were pinned from the repository at `affe9a2c`; the host's installed copies do not exist yet, so the pairing hashes are a step in the package, not a result.
