# ISSUE-316 C5 (D-316-4): one owner-attended procedure and approval (2026-11-02)

**Status: PREPARED. NOTHING IS GRANTED AND NOTHING WAS CHANGED ON PRODUCTION.** Stuart's acceptance of the C4b r2 evidence is **not recorded**. D-316-4 (C5), provider requests, timer activation, switch changes, `.env` edits, restarts, pushes and cleanup remain unauthorised until the owner writes the two statements in sections 3 and 4. Everything Claude did for this document was read-only on production, as `arm`, no sudo (section 2).

Supersedes the C5 draft in [block-c-c4b-r2-outcome-2026-11-02.md](block-c-c4b-r2-outcome-2026-11-02.md) and section 7 of [block-c-execution-package-2026-11-02.md](block-c-execution-package-2026-11-02.md) for the sequence and wording (the package's facts and `c-prod.sh` phases stand). The C4b record keeps its **season-feed-only limitation**: a CLEAR with 0 selected matches proves no `playerStats`/`matchRoster` request, no player-level processing, no canonical apply, no sustained provider-rate behaviour (two provider requests were made).

## 1. Pinned facts (verified read-only on afldb-prod, 2026-11-02 09:08-09:16Z / 20:08-20:16 AEDT)

| Item | Value |
|---|---|
| Revision **N** (= R of every phase) | `924ff273261834e4112e3f41b61ceeab55427534`; production checkout `/home/arm/projects/afldb` HEAD = N, porcelain 0, local `origin/main` ref = N (no fetch was made) |
| **Serving release** | `/home/arm/afldb-releases/current -> releases/ea98a35f2061--vY0EFS0DdR-TiPkxTZz6` (built from `ea98a35f`; N differs from it only by the C4b tool files, checkout-only, so the **web app code is `ea98a35f`'s**); `previous -> releases/fd48ace0c2cb-pqAQwRIJWLjSYzR8LiTuy` (the rollback release, untouched) |
| Serving process | `afldb` MainPID **3268373** (user `arm`), NRestarts 0, ActiveEnter Mon 2026-11-02 13:18:50 AEDT (monotonic 6739446504275), cwd = the serving release, `/api/health` 200. Unit `EnvironmentFile=/home/arm/projects/afldb/.env`; `UnsetEnvironment` does not mention `AFLDB_SETTLE_TRIGGER` |
| Ledger | 118 rows, last `118_fixtures_unconfirmed_participants.sql`, digest `573594e9…aaf57` |
| Switch | `acquisition.afl_api_current_season_enabled` stored `false` (`updated_by` NULL; tool-written), audit 303/304 are the last ingestion-switch rows; `acquisition.afl_api_brownlow_enabled`: **no row** (stays so) |
| Units | `afldb-settle-afl-api.service` and `-brownlow.service` loaded/inactive; `afldb-settle-afl-api.timer`, `-brownlow.timer` and `afldb-settle-afltables.timer` **disabled/inactive**; no AFL timer scheduled; installed unit files equal the repository files (six pinned hashes) on two passes a minute apart |
| AFL Tables | `data/reference/afltables-network.json` `status` `retired`; `seasons.json` `in_progress_seasons` `[2027]` |
| Trigger variable | 0 `AFLDB_SETTLE_TRIGGER` mentions in `.env` (comments included); 0 in the serving process environment. `.env`: mode 600, owner `arm`, 4067 bytes, final byte `\n`, 83 lines, untracked |
| Readiness | REPOSITORY READY on the newest retained feed (`afl-api-2027-2026-11-02-083723/00-season-matches.json`, sha256 `21fd12e7…c84d`, 218 matches, complete for `CD_S2027014`) |
| C4b record | `/home/arm/backups/afldb/c4b-924ff273-r2/result.json` `CLEAR`, run `c4b-2026-11-02T083721874Z-3296445`, sha256 `1571892c…c663`; the directory still has exactly the 10 recorded files |
| Clock | host timezone `Australia/Melbourne` (AEDT); C4b/C5 refuse at or after 2027-03-17T00:00Z |

Survey output: [evidence/c5-prep-20261102/c5-prep-output.txt](evidence/c5-prep-20261102/c5-prep-output.txt) (`C5 PREP CONSISTENT`: 0 failed phases or queries, 0 unexpected values). Scripts (all read-only; sha256 prefixes): `c5-prep.sh` `3dd72f20`, `c5-observe.sh` `9dd0633f` (identical on the host), `c-prod.sh` `ec839a47` (pinned, in N).

## 2. Findings from the survey (review items, none auto-corrected)

1. **Polkit baseline cannot be established as `arm`.** `/etc/polkit-1/rules.d` is `Permission denied` for `arm`; `/usr/share/polkit-1/rules.d` is readable and holds only distribution rules (no `afldb`). The package's "empty at the 2026-10-31 window" is therefore not re-confirmed: **the owner's sudo listing (step 1) is the only evidence and is authoritative.** Any file there is a finding; it is **not** removed automatically.
2. The serving process runs as `arm`, so its environment is readable by `arm` without sudo: the effective-environment read-back can be done by Claude read-only (`c5-observe.sh env-effective`) or by the owner's own command (step 3). The package said "needs the owner or sudo"; that is not true on this host.
3. `c5-pre` only checks `verdict == CLEAR` in `result.json` (its message prints `decision=? season=?` because the file has neither key). The survey additionally pins `result.json` by sha256 and run id and the directory's file count, so the C5 precondition is bound to the reviewed record, not to any `CLEAR` file.
4. **The first scheduled firing is a real apply, not a rehearsal.** With the match timer enabled and the switch `true`, the timer (`OnCalendar=*-*-* 05:00`, `RandomizedDelaySec=15min`, host time) fires **between 05:00 and 05:15 AEDT on 3 Nov**; `Persistent=true` does not fire a never-run timer at enable time. That run is `acquire-afl-api.ts` (two provider requests) then `settle-afl-api.ts --apply --auto-apply --require-complete-source`. With 0 CONCLUDED 2027 matches it is expected (from the dry-run text, **not yet observed**) to retain one `import_batches` row (id 78 or later: the sequence is at 77) with no canonical rows. C5 is therefore the point at which retained batch rows start to appear; the C4b dry run retained none (independent read-back, outcome doc addendum).
5. The Super Admin panel (`/admin/current-season`, the "AFL API ingestion" section and the settle-units table) currently shows the "On-demand refresh is not enabled on this host ..." message for the units, because `AFLDB_SETTLE_TRIGGER` is unset; that message is the "before" state for step 7. (The panel only ever reads unit state with `systemctl show`; it needs no polkit rule, and `startSettleRun` is retired.)
6. The Brownlow admin switch has no row. The panel's second row ("Brownlow Live Ingestion") must not be touched in this window.

## 3. Stuart's evidence-review acceptance (the owner writes this; this session does not)

Review first: `result.json`, `run.log`, `settle-dry-run.log` in `/home/arm/backups/afldb/c4b-924ff273-r2` (local copy: `docs/v2/evidence/c4b-r2-20261102/host-evidence/`), `readback-output.txt` in `docs/v2/evidence/c4b-r2-readback-20261102/`, and the outcome document's addendum.

```text
I, Stuart, have reviewed the C4b r2 evidence at /home/arm/backups/afldb/c4b-924ff273-r2 (result.json CLEAR, sha256
1571892cc538ac3d51fba3cd595436658ee4bd35fd78f9b950dc1e96cdf9d04b, run c4b-2026-11-02T083721874Z-3296445) together with the
independent read-back of 2026-11-02 09:04Z (READBACK CONSISTENT). I accept it as the C4b PASS record, understanding that: it is a
season-feed-only rehearsal (218 matches, 0 selected, two provider requests; no playerStats/matchRoster, no player-level
processing, no canonical apply, no sustained-rate evidence); the run's zero canonical-write counters and its byte-identical
before/after files do not by themselves prove non-retention, which the read-back shows (no import_batches row, no staging or
canonical row, snapshot files retained on disk by design); and the import_batches identity sequence is two ahead of max(id).
Accepted: <date and time>, <"without conditions" or "with these conditions: ...">.
```

## 4. C5 approval (D-316-4) (the owner writes this; this session does not)

```text
I, Stuart, approve the AFL API cutover go (D-316-4) on afldb-prod at revision 924ff273261834e4112e3f41b61ceeab55427534
(serving release ea98a35f2061--vY0EFS0DdR-TiPkxTZz6, MainPID 3268373 before the window), on the C4b CLEAR record accepted above, as the
single ordered procedure in docs/v2/block-c-c5-owner-attended-procedure-2026-11-02.md section 5, between <start> and <end> on <date>
and before 2027-03-17T00:00Z. I am attending and no other operator will change production during the window.
I will run every sudo and restart step, the .env edit, the audited admin toggle and the entry of all credentials myself. Claude may,
as arm without sudo, only: copy the read-only helper scripts named in section 5 into /home/arm; run c5-prep.sh, c-prod.sh c5-pre,
c5-env and c5-accept, and c5-observe.sh env-effective, toggle, timer, first-run and rollback-verify; and, after I say I am ready,
launch a headed browser for me to sign in and read the panel. Claude does not toggle the switch, enable or stop any unit, edit .env,
restart anything, remove a polkit rule, or contact the provider. The Brownlow timer, the Brownlow switch and the AFL Tables timer stay
disabled. Stop and rollback are exactly section 6; an unexpected rule, state or check result stops the window and is reviewed first.
```

## 5. The ordered procedure

Variables (owner shell on afldb-prod as `arm`; Claude's read-only shell is the same):

```bash
N=924ff273261834e4112e3f41b61ceeab55427534
CHK=/home/arm/projects/afldb
P=$CHK/docs/v2/evidence/block-c-package-20261102/c-prod.sh        # pinned bytes, sha256 ec839a47…d496, in N
EVD=/home/arm/backups/afldb/c4b-924ff273-r2
```

Stop at the first step whose check fails. Time column is a guide.

| # | Step | Who | Command / action | Pass criterion | Stop if |
|---|---|---|---|---|---|
| 0 | Fresh state | Claude (read-only) | copy `c5-prep.sh` and `c5-observe.sh` to `/home/arm/` (`scp`); `bash /home/arm/c5-prep-20261102.sh $N $EVD` | `C5 PREP CONSISTENT` (includes `c5-pre` and `c3-accept` twice) | any failure or unexpected value; MainPID is not 3268373 |
| 1 | **Polkit listing** | **Owner (sudo)** | `sudo ls -la /etc/polkit-1/rules.d` and `sudo grep -rIil afldb /etc/polkit-1 /usr/share/polkit-1` | directory has no entries other than `.` and `..`; grep prints nothing | **any file, or any grep hit**: STOP. Report the listing to Claude. Do not remove it; the removal is a separate reviewed act (the retired ISSUE-127 rule is `deploy/afldb-settle-afltables-trigger.rules`) |
| 2 | **Exactly one trigger line** | **Owner (as arm)** | `cd $CHK && [ "$(grep -c AFLDB_SETTLE_TRIGGER .env)" = 0 ] && printf 'AFLDB_SETTLE_TRIGGER=systemd\n' >> .env` (`.env` already ends with a newline, so nothing else is added) | `bash $P c5-env $N` ends `C5-ENV PASS` (exactly one exact line, no other mention); `stat -c '%a %U %s' .env` = `600 arm 4096` | the guard fails (variable already present), `c5-env` fails, or size is not 4096 |
| 3 | **Owner restart + effective environment** | **Owner (sudo)**, then Claude read-only | `sudo systemctl restart afldb` (the last start was 13:18 AEDT, over 30 s ago). Then `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3100/api/health` | `bash /home/arm/c5-observe-20261102.sh env-effective $N` ends `PASS` (new MainPID and ActiveEnter after the `.env` edit; exactly one `AFLDB_SETTLE_TRIGGER=systemd` in `/proc/<MainPID>/environ`; cwd still the serving release; health 200; switch still `false`). The owner's equivalent: `tr '\0' '\n' < /proc/$(systemctl show -p MainPID --value afldb)/environ \| grep -c '^AFLDB_SETTLE_TRIGGER=systemd$'` prints `1` | health is not 200 within ~60 s, the count is not 1, or the release changed: rollback, section 6, level R3 |
| 4 | **Audited admin toggle** | **Owner** in a headed browser (launched by Claude only when the owner says **ready**; the owner enters every credential and the TOTP code) | `https://<production host>/admin/login`, then `/admin/current-season`, section "AFL API ingestion", row **"AFL API Current-Season Ingestion"**: State `Disabled` to **Enable**; expect the state pill `Enabled`. **Do not touch the "Brownlow Live Ingestion" row.** | `bash /home/arm/c5-observe-20261102.sh toggle $N` ends `PASS`: stored `true`; exactly one new `current_season.afl_api_ingestion_set` row (id > 304) with `enabled true` and an admin `actor_user_id`; `updated_by` set; Brownlow switch still has no row | the panel errors, 0 or 2 audit rows appear, or the Brownlow row changes: rollback, section 6, level R4 |
| 5 | **Enable the match timer only** | **Owner (sudo)** | `sudo systemctl enable --now afldb-settle-afl-api.timer` | `bash /home/arm/c5-observe-20261102.sh timer $N` ends `PASS` (enabled, active, a future next elapse between 05:00 and 05:15 AEDT; Brownlow and AFL Tables timers disabled/inactive; nothing running; switch `true`) | any other unit changes state; a run starts now: rollback, section 6, level R5 |
| 6 | **Acceptance observations 1 and 2** | Claude (read-only) | `bash $P c5-accept $N`, then again at least 3 minutes later | both end `C5-ACCEPT PASS` (switch `true`; match timer enabled+active; **Brownlow timer disabled/inactive**; AFL Tables timer disabled/inactive) | either fails: rollback, section 6, level R5 |
| 7 | **Super Admin panel check** | Owner, Claude may read the page via the headed browser | `/admin/current-season` reloaded | "AFL API Current-Season Ingestion" shows `Enabled`. In the settle-units table the two rows show a service state (expected "Idle (inactive)") instead of the "On-demand refresh is not enabled on this host ..." text; "Match and player statistics" is expected to show "No batch recorded yet." and "Brownlow votes" the existing completed batch 74 (**expected from reading the code, not yet observed**) | the "not enabled on this host" text remains (the variable is not effective), a unit shows failed/running, or any Start control appears |
| 8 | Close the window | Claude | save the outputs of steps 0, 3-6 under `docs/v2/evidence/c5-window-<stamp>/`; no commit until the owner agrees | all PASS recorded | |
| 9 | *Next-day observation (not part of the window)* | Claude (read-only), after 05:15 AEDT on 3 Nov | `bash /home/arm/c5-observe-20261102.sh first-run $N` | unit `Result=success`, exit 0; at least one completed `settle-afl-api.ts` batch after id 75, none not completed; 0 canonical 2027 matches | rollback, section 6, level R5, and review |

The owner may stop after step 7. Steps 5 to 7 are the point of no return only in the sense that the timer will make provider requests and write a batch row at 05:00-05:15; step 5 can be postponed to the evening without affecting steps 1 to 4.

## 6. Stop and rollback (exactly these actions, in this order, as far as the window got)

*Levels:* **R2** = step 2 done; **R3** = step 3 done; **R4** = step 4 done; **R5** = step 5 done. Perform every row whose "Applies from" level is at or below the level reached (R2 < R3 < R4 < R5), in the listed order a to e; nothing else. Example: stopped after step 3 (R3) = rows c, d, e; stopped after step 5 (R5) = rows a to e.

| Order | Action | Who | Applies from | Verify |
|---|---|---|---|---|
| a | `sudo systemctl disable --now afldb-settle-afl-api.timer` (if a run is in flight: `sudo systemctl stop afldb-settle-afl-api.service`; the settle holds one transaction, so a stop rolls it back) | owner (sudo) | R5 | `systemctl is-enabled` = `disabled`, `is-active` = `inactive` |
| b | In the admin panel: the "AFL API Current-Season Ingestion" row, **Disable** (audited). There is no unaudited path; the C4b tool's `--restore-only` is not authorised here | owner (browser) | R4 | stored value `false`; a second audit row with `enabled false` |
| c | `cd $CHK && sed -i '/^AFLDB_SETTLE_TRIGGER=systemd$/d' .env` | owner (as arm) | R2 | `grep -c AFLDB_SETTLE_TRIGGER .env` = 0; `stat -c '%a %U %s' .env` = `600 arm 4067` |
| d | `sudo systemctl restart afldb` | owner (sudo) | R3 (the variable reached the process) | health 200; new MainPID |
| e | `bash /home/arm/c5-observe-20261102.sh rollback-verify $N` | Claude (read-only) | all | `PASS`: three timers disabled/inactive, no settle process, setting `false`, no `.env` mention and size 4067, process environment without the variable, health 200 |

Rollback never touches the Brownlow timer or switch (they were never changed), the AFL Tables timer, the serving release pointers (`current`/`previous` do not move in this procedure) or the checkout. If a scheduled run **completed** before the rollback, its retained batch and anything it wrote are data, not part of the rollback: `docs/v2/rollback-runbook.md` and the issue's recovery section govern them, and Claude reports them with `first-run` evidence instead of deleting anything. A rollback that does not reach `rollback-verify PASS` is a finding; stop and report.

## 7. Notes on the scripts

- `c5-observe.sh` phases were exercised read-only on production before use: `rollback-verify` **PASSED** on the current (pre-C5) state; `env-effective`, `toggle`, `timer` and `first-run` **FAILED** as they must on that state (negative controls): [c5-observe-baseline-output.txt](evidence/c5-prep-20261102/c5-observe-baseline-output.txt). Afterwards the `.env` size checks (4096 after step 2, 4067 after rollback) were added to the repository copy; a final baseline of that copy is recorded in the same directory (`c5-observe-baseline2-output.txt`).
- Every helper counts a failed query or a mismatching value as a failure of the phase; none changes anything. `c5-prep.sh` run 1 had its own matcher defect (kept as `c5-prep-output-run1-matcher-defect.txt`).
- Helpers copied to the host so far: `/home/arm/c4b-r2-readback-20261102.sh`, `/home/arm/c5-prep-20261102.sh`, `/home/arm/c5-observe-20261102.sh`, `/home/arm/c5-envshape-20261102.sh` (all in `arm`'s home; delete after the window if wanted, nothing depends on them).
