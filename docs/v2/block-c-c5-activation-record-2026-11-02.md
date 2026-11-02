# ISSUE-316 C5 (D-316-4): activation record (2026-11-02)

**Status: ACTIVATION ACCEPTED by the attended checks. FIRST SCHEDULED RUN NOT YET OBSERVED: no scheduled batch may be called successful until section 6 is run.** Procedure: [block-c-c5-owner-attended-procedure-2026-11-02.md](block-c-c5-owner-attended-procedure-2026-11-02.md). Evidence: `docs/v2/evidence/c5-window-20261102/` (this commit) and `docs/v2/evidence/c5-prep-20261102/`. Times are AEDT (UTC+11) with UTC where the tools print it.

## 1. Authority and acceptance

- **C4b r2 accepted as the C4b PASS record** by Stuart, **recorded at the receipt time of his message: 2026-11-02 20:42:46 AEDT (09:42:46Z)**. Evidence directory `/home/arm/backups/afldb/c4b-924ff273-r2`, run `c4b-2026-11-02T083721874Z-3296445`, `result.json` sha256 `1571892cc538ac3d51fba3cd595436658ee4bd35fd78f9b950dc1e96cdf9d04b`. He acknowledged the season-feed-only limitation (no `playerStats`/`matchRoster`, no canonical apply path) and that the independent read-back found no retained batch, staging or canonical row; the `import_batches` sequence advance is recorded separately and not attributed.
- **D-316-4 granted** in the same message, T0 = receipt, 60-minute window ending **21:42:46 AEDT**. Target `afldb-prod`, `afldb_prod`, system identifier 7674454702926115004, OID 66668, ledger 118; checkout `924ff273261834e4112e3f41b61ceeab55427534`; serving release `ea98a35f2061--vY0EFS0DdR-TiPkxTZz6`. Scope: one `AFLDB_SETTLE_TRIGGER=systemd` line, the owner's restart, the owner's audited enable of AFL API Current-Season Ingestion, the owner's enable of `afldb-settle-afl-api.timer` only. Not authorised and not done: manual settle start, Brownlow activation, new scope or season, push, grants, cleanup, release promotion, schema change, quarantined-store access.
- **Amended switch criterion accepted by Stuart during the window** (section 4): either a JSON boolean `true` or the supported JSON string `"true"`, interpreted as the real ingestion reader and the pinned `c5-accept` do. The window deadline was not extended.

## 2. Timeline

| Time (AEDT / UTC) | Step | Actor | Result | Evidence |
|---|---|---|---|---|
| 20:43:15 / 09:43:15Z | 0 fresh prep | Claude, read-only as `arm` | **C5 PREP CONSISTENT** (0 failed, 0 unexpected; `c5-pre` PASS, `c3-accept` PASS twice, C4b sha, run id and 10-file count match, REPOSITORY READY, MainPID 3268373) | `step0-c5-prep-fresh-094400Z.txt` |
| ~21:13 / 10:13Z | 1 polkit listing | owner (sudo) | `/etc/polkit-1/rules.d` empty; `grep -rIil afldb /etc/polkit-1 /usr/share/polkit-1` no hit; the owner's guard script ran under `set -euo pipefail` and refused otherwise. Owner paste only (not a file) | owner terminal paste |
| 21:13:23 / 10:13:23Z | 2 trigger line | owner | `c5-env` printed `C5-ENV PASS`; the paste was cut after that; Claude then read `.env`: `600:arm:4096`, one exact line, one mention, final byte `0a`, checkout clean | transcript; no file |
| 21:15:37 | 3 restart | owner (sudo) | new MainPID **3303369**, ActiveEnter 21:15:37 | owner paste |
| 21:16:04 / 10:16:04Z | 3 `env-effective` | Claude | **PASS**: new MainPID and ActiveEnter after the `.env` mtime, exactly one `AFLDB_SETTLE_TRIGGER=systemd` in the process environment, cwd = serving release, health 200, switch still `false` | `step3-env-effective.txt` |
| ~21:17 | 4 audited toggle | owner, in the Super Admin panel (existing signed-in session; no credential entered by Claude) | row "AFL API Current-Season Ingestion" Disabled to Enabled; Brownlow row untouched | `step4-before-current-season.png` |
| 21:18:48 / 10:18:48Z | 4 `toggle` (pinned expectation) | Claude | **FAIL, 1 check** (section 4) | `step4-toggle.txt` |
| 21:20:17 / 10:20:17Z | 4 diagnosis | Claude, read-only | real reader returns enabled (section 4) | `step4-reader-probe.txt`, `c5-reader-probe.mts` |
| 21:21:29 / 10:21:29Z | 4 `toggle` (amended) | Claude | **PASS** (all 9 checks) | `step4-toggle-amended-r2.txt` |
| 21:23:44 / 10:23:44Z | 5 match timer | owner (sudo) | `enable --now afldb-settle-afl-api.timer`: enabled, active, service inactive | owner paste |
| 21:24:17 / 10:24:17Z | 5 `timer` | Claude | **FAIL, 1 check** (section 5) | `step5-timer.txt` |
| 21:24:44 / 10:24:44Z | 5 `timer` re-run, clean command line | Claude | **PASS** | `step5-timer-rerun-clean-cmdline.txt` |
| 21:24:57 / 10:24:57Z | 6 acceptance observation 1 | Claude, pinned `c-prod.sh c5-accept` | **C5-ACCEPT PASS** | `step6-accept-obs1.txt` |
| 21:25:02 / 10:25:02Z | 7 panel | Claude, read-only page read | see section 7 | `step7-after-current-season.png` |
| 21:28:16 / 10:28:16Z | 6 acceptance observation 2 (3 m 19 s later) | Claude | **C5-ACCEPT PASS**; MainPID 3303369, NRestarts 0, health 200, `timer` PASS | `step6-accept-obs2.txt` |

## 3. Final observed state (10:28:16Z)

- Switch `acquisition.afl_api_current_season_enabled` = true (stored as a JSON string, section 4); one new audit row `current_season.afl_api_ingestion_set`, `enabled true`, admin actor; Brownlow switch row absent, 0 Brownlow audit rows.
- `afldb-settle-afl-api.timer` enabled and active; **next elapse Tue 2026-11-03 05:01:47 AEDT** (observed, `OnCalendar` 05:00, `RandomizedDelaySec` 15 min, `Persistent=yes`); `LastTriggerUSec` empty; persistent stamp `/var/lib/systemd/timers/stamp-afldb-settle-afl-api.timer` created 21:23 AEDT, 0 bytes; service `inactive`, `Result=success`. No immediate start occurred.
- `afldb-settle-afl-api-brownlow.timer` and `afldb-settle-afltables.timer`: disabled and inactive at every observation.
- `afldb.service` MainPID 3303369, NRestarts 0, health 200, serving release unchanged. Checkout `924ff273` clean.

## 4. The original failed check and the amended PASS (recorded separately)

- **Original failed check (10:18:48Z).** `c5-observe.sh toggle`, check `setting stored value`, compared `site_settings.value::text` with the bare text `true` and read `"true"`. Eight other checks passed. This was a **finding, not silently changed**. The window was stopped at that point pending the owner's decision.
- **Cause.** The admin action (`src/app/admin/current-season/actions.ts` `writeIngestionSwitch`) writes `${JSON.stringify(enabled)}::jsonb` through postgres.js, which double-encodes: `jsonb_typeof(value)` is `string`, text `"true"`. The tool-written earlier values were real booleans. The C4b tool's `normaliseStoredSetting` already documents this ("`false` is stored as `"false"`"), and the pinned `c-prod.sh c5-accept` accepts `true|"true"` (line 171). `parseSiteSettings` reads both through `fromStore`.
- **Proof against the real reader (read-only, 10:20:17Z, `arm`, `DATABASE_URL`, nothing written).** `readAflApiIngestionControls()` returned `{"currentSeasonEnabled":true,"brownlowAdminEnabled":false}`; stored `jsonb_typeof` `string`; the driver hands the reader the decoded string `true`.
- **Amendment.** Stuart accepted the criterion "JSON boolean `true` or the supported JSON string `"true"`, interpreted consistently with the real ingestion reader and the pinned `c5-accept`". The helper copy `docs/v2/evidence/c5-prep-20261102/c5-observe-r2.sh` (sha256 prefix `98f15a83`; the original `c5-observe.sh` `9dd0633f` is unchanged) changes only the three setting comparisons (`toggle`, `timer`, `rollback-verify`) to read a string-typed value as its content. All other checks are unchanged.
- **Amended result (10:21:29Z): `C5-OBSERVE toggle PASS`.** The original criterion was not met literally; the PASS is on the amended criterion.
- **Not done, by instruction:** the stored setting was not rewritten and no application code was changed. The admin toggle's double-encoding is a latent write-path behaviour, tolerated by every reader that goes through `fromStore`; it is a candidate follow-up, not part of this window.

## 5. The second discrepancy: `settle/acquire processes = 1`

`c5-observe.sh timer` at 10:24:17Z reported 1 matching process (expected 0) and failed. The service was `inactive`. The check uses `pgrep -fc '[s]ettle-afl-api|[a]cquire-afl-api'`, which excludes `pgrep` itself but not the remote shell whose command line carried my own `systemctl show afldb-settle-afl-api.timer` text. Re-run 27 seconds later with a command line containing no such text, the same check read **0** and `timer` ended **PASS**. A direct process listing was attempted but the command was mangled by quoting and is void (`step5-process-listing.txt`); **the self-match explanation is therefore inferred from the clean re-run, not from inspecting the matched process.** No settle or acquire process was running at any other observation, and the unit's `LastTriggerUSec` is empty.

## 6. First-night execution: NOT YET OBSERVED (pending read-only observation)

The timer fires between 05:00 and 05:15 AEDT on 2026-11-03 (observed next elapse 05:01:47). That run is `acquire-afl-api.ts` (two provider requests) then `settle-afl-api.ts --apply --auto-apply --require-complete-source`. With no CONCLUDED 2027 match it is **expected** (from the dry-run text; not observed) to retain one `import_batches` row (id 78 or later; the sequence is at 77) and no canonical rows. This is a real apply, not a rehearsal.

After 05:15 AEDT on 3 Nov, as `arm`, read-only:

```bash
bash /home/arm/c5-observe-20261102-r2.sh first-run 924ff273261834e4112e3f41b61ceeab55427534
```

Pass: unit `Result=success` and exit 0; at least one completed `settle-afl-api.ts` batch after id 75 and none not completed; 0 canonical 2027 matches. Any other result: rollback (section 8) and review. The `first-run` phase is identical in `c5-observe.sh` and `c5-observe-r2.sh`.

## 7. Super Admin panel (step 7), as observed

`/admin/current-season` at 10:25:02Z (screenshot `step7-after-current-season.png`): "AFL API Current-Season Ingestion" shows **Enabled** with a Disable button; "Brownlow Live Ingestion" shows admin control Disabled, deployment gate Disabled, effective state Disabled, with the Enable admin control button unused. The settle-units table shows both services **Idle (inactive)**; the "On-demand refresh is not enabled on this host" text is gone; there is no Start control. **One difference from the procedure's prediction** (which was marked "expected from reading the code, not yet observed"): the "Match and player statistics" row shows the latest committed batch as **Batch 32 (snapshot `afl-api-2026-2026-09-25-235854`, season 2026, completed 2026-09-28, 10,417 records read, 0 rejected)** rather than "No batch recorded yet". It is not a stop condition and nothing was changed. "Brownlow votes" shows batch 74 as predicted. Note for the first-night check: `first-run` counts batches after id 75, so batch 32 does not interfere.

## 8. Rollback (not needed; retained verbatim for the first-night failure case)

Level reached: **R5**. Packaged order, the owner executes: (a) `sudo systemctl disable --now afldb-settle-afl-api.timer` (if a run is in flight, `sudo systemctl stop afldb-settle-afl-api.service`; stopping rolls the single settle transaction back but does not reverse a committed one); (b) panel Disable of the AFL API row (audited); (c) `cd /home/arm/projects/afldb && sed -i '/^AFLDB_SETTLE_TRIGGER=systemd$/d' .env` (expect `600 arm 4067`); (d) `sudo systemctl restart afldb`; (e) `bash /home/arm/c5-observe-20261102-r2.sh rollback-verify 924ff273261834e4112e3f41b61ceeab55427534` (the r2 helper accepts the `"false"` the panel writes). Any batch or row a completed run committed is data: report it, do not delete it.

## 9. Closure assessment

- **ISSUE-316: stays OPEN.** C5 activation is accepted. Remaining conditions, from the runbook table (`issues/open/AFLDB-ISSUE-316.md` §7): the first-night observation above; C5's own "update the admin panel wording and button (D-316-12)" (the page text still describes the AFL Tables settle as running until C5; unchanged today); C6 debutant routine (D-316-5); C7 first-2027-round acceptance with owner criteria set in advance; C8 Brownlow 2027 (count week; Brownlow timer still disabled); C9 ownership-replay design before the 2027 rollover (D-316-6).
- **V2-GAP-011: CLOSED on its written Close condition** (`docs/v2/known-gaps.md`, "Close": the owner executes the ISSUE-316 sequence, D-316-1 at C2, the C4b PASS under D-316-13, D-316-4 at C5). C2 is accepted (D-316-1 in the released code, register `retired`), the C4b PASS is accepted above, and D-316-4 was executed and accepted above, with the AFL Tables timer disabled and the polkit directory empty. The first-night run and C6 to C9 are ISSUE-316 conditions, not GAP-011's, and are not claimed. The owner may reopen it if the first-night check fails.

## 10. Follow-up review (appended 2026-11-02 evening; sections 1 to 9 above are unchanged)

- **Process-count discrepancy (section 5):** the self-match is now a **reproduced helper defect**. Read-only on `afldb-prod` at 10:44:11Z and 10:44:38Z, a shell whose own argv carried `afldb-settle-afl-api.timer` was the only match of the old pattern, the old helper printed `processes = [1]` and failed, and the fixed helper printed `[0]` and passed (`followup-selfmatch-repro-prod-readonly*.txt`). The 10:24:17Z failure and its re-run remain as recorded; the process that matched at 10:24:17Z itself was never inspected. Fix: `c5-observe-r3.sh` + `c5-proc-guard.sh` (local `6d41dd3a`), 17/17 table tests, genuine-writer shapes still detected; the real-process spawn test is written but not run. Details: [issue316-closeout-and-seasonal-obligations-2026-11-02.md](issue316-closeout-and-seasonal-obligations-2026-11-02.md) section 2.
- **D-316-12** (stale admin wording, deployment docs): done **locally** in `6d41dd3a`, not deployed; smallest release approval prepared, not granted: [d31612-ui-release-approval-2026-11-02.md](d31612-ui-release-approval-2026-11-02.md). The page remains `VISUAL: UNVERIFIED` (static render only) until deployed.
- **Section 7's panel observation** (batch 32 shown, not "No batch recorded yet") is unchanged and still a recorded difference from the procedure's prediction.
- **Section 6 (first night)** now also has a read-only `first-night` classification phase (`c5-observe-20261102-r3.sh`), dry-tested on the pre-run state; the authorised command is unchanged. `arm` cannot read systemd's own journal lines (not in `adm`/`systemd-journal`): those need the owner's `sudo journalctl`.
- **Closure (section 9) is unchanged:** ISSUE-316 stays open; the owner close-out decision and the C6 to C9 classification are in the document above.
