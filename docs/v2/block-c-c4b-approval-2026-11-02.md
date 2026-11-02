# ISSUE-316 C4b: the exact D-316-13 approval, prepared on the post-C3, post-Brownlow state (2026-11-02)

**Status: PREPARED. NOT GRANTED. NOTHING WAS RUN.** `c4b-pre` was not run, the feed was not copied to the host, no provider was contacted, the setting was not touched, and nothing was started or enabled. This file only fixes the exact words and the ordered, state-checked steps for the owner to grant. C4b (D-316-13) and C5 (D-316-4) stay distinct and unapproved; C5 is not described here beyond what C4b leaves behind.

Governing documents: [Block C package](block-c-execution-package-2026-11-02.md) section 6 (and `evidence/block-c-package-20261102/c-prod.sh`, which governs on any difference); [C3 outcome](block-c-c3-outcome-2026-11-02.md).

## 1. State this approval is built on (re-derived 2026-11-02)

| Item | Value | Source |
|---|---|---|
| Revision `R` | `ea98a35f20610e75c18e698bc0d9fe084c3c783d` (production checkout HEAD, clean; the release serving) | C3 read-backs 05:19Z |
| C3 | **accepted**: four units installed, `loaded`/inactive services, `disabled`/inactive timers, no elapse, no symlink | [outcome](block-c-c3-outcome-2026-11-02.md) |
| Block M-a | complete (migration 118, release `ea98a35f` serving); Block M-b applied (218 fixtures) and the switch restored to `false` | commits `4f7ef1c9`, `a63681dc`; `c4b-pre` re-proves ledger 118 and its digest |
| Switch | `acquisition.afl_api_current_season_enabled` = `false` (read twice by `c3-accept`) | C3 evidence |
| AFL Tables | timer `disabled`/`inactive` (read in `c3-accept`); `afltables-network.json` `status` `retired` at R | C3 evidence; `git show R:data/reference/afltables-network.json` |
| Register | `in_progress_seasons` is `[2027]` at R (`c4b-pre` proves it on the host) | `git show R:data/reference/seasons.json` |
| Retained 2027 feed | `tests/fixtures/afl_api/seasons/01-season-matches-2027.raw.json`, sha256 `21fd12e7704b7c7146cfbab414352352f3cfaa53e7ef5038f4411fa789e4c84d` (re-hashed at R today; equals the `c-prod.sh` pin) | local `git show` |
| Tools at R | `tools/current-season/afl-api-c4b-rehearsal.ts` and `afl-api-cutover-readiness.ts` present; `git diff R HEAD -- deploy tools/current-season data/reference` is empty | local |
| Deadline | `c4b-pre`, and C5, refuse at or after 2027-03-17T00:00Z; today is 2026-11-02 | `c-prod.sh` |
| Brownlow baseline | production's post-E runner baseline is `43300297…821d`. **C4b writes `site_settings` and `auth_audit_log` (the setting on, then off, each with an audit row), so it ends the validity of that baseline for any later baseline-bound Brownlow work, which must re-baseline.** The Brownlow stages themselves are complete and accepted; nothing pending depends on the old baseline | Block B outcome section "Baselines moved"; package section 9 item 4 |
| Application | `afldb.service` MainPID 3268373, NRestarts 0 (C4b does not restart it; `c4b-pre` does not record PID, so it is re-read before the run for the after-comparison) | C3 evidence |

## 2. What the run does and writes (so the grant is informed)

* **Provider contact (the thing D-316-13 authorises):** the tool fetches a token, the 2027 season match feed and, per selected match, `playerStats` and `matchRoster` from the AFL.com.au API, at the tool's own rate limit, and writes the raw bytes under `data/sources/afl_api/matches/<label>/` **in the production checkout**. That path is git-ignored (`.gitignore` `/data/sources/*`; `git check-ignore` confirms it locally), so "checkout clean" stays true, but the directory remains on the host and is not deleted by the tool.
* **Database writes:** the setting `acquisition.afl_api_current_season_enabled` is written `true` for the run and back to `false` (verified on the writer path and on the CLIs' control path), each by role `afldb_auth` with an `auth_audit_log` row in the same transaction. The settle step is `--dry-run --auto-apply --require-complete-source`: it is a dry run and must report canonical inserts and updates both `0`; it never runs `--apply`.
* **Never:** enabling, starting or stopping a unit or timer; `.env`; a restart; `sudo`. It reads `systemctl is-enabled` and `is-active` only.
* **Restoration:** a `finally`, signal handlers, and a detached watchdog that is proven ready before the setting is written (about 5 s to rescue a parent SIGKILL in rehearsal).
* **Exit codes:** `0` CLEAR; `1` HALT (setting restored and verified; reasons in `result.json`); `2` refused before any write; `3` **restoration not verified**: run `--restore-only` at once and confirm the setting reads `false` before anything else (the admin toggle is the second route).

## 3. The grant (the owner writes it; this session does not)

> *"I grant D-316-13: run the C4b D1 rehearsal for season 2027 on `afldb-prod` at revision `ea98a35f20610e75c18e698bc0d9fe084c3c783d` with the evidence directory `/home/arm/backups/afldb/c4b-ea98a35f-r1`, reviewed by `<name>`; C3 and Block M-a are complete and I am attending."*

* The owner supplies `<name>` (the designated evidence reviewer; this session does not choose one) and may change the evidence-directory name. The directory **must not exist** (the tool refuses an existing one) and must be outside the checkout; `$STAMP` below is `ea98a35f-r1`.
* The grant does **not** cover C5, any `.env` edit, any restart, any timer enablement, any run of `--apply`, or any push.
* "I am attending" matters: the run is one tmux session on `afldb-prod` and the owner is present for it.

## 4. Ordered steps once granted

```text
Step A  (Claude, SSH as arm; read-only except one new mode-600 file)
  1. copy the retained feed from R's checkout to /home/arm/blockc-pkg-ea98a35f2061/c4b-feed-2027.json (mode 600);
     verify its sha256 equals 21fd12e7...e4c84d
  2. read-only: the parent /home/arm/backups/afldb exists and is writable by arm; the evidence directory does NOT exist;
     /tmp and the target filesystem have room (df); record afldb.service MainPID and NRestarts
  3. bash "$PKGD/c-prod.sh" c4b-pre "$R" /home/arm/blockc-pkg-ea98a35f2061/c4b-feed-2027.json
        must end: C4B-PRE PASS
     (checkout R and clean; ledger 118 and digest; switch absent/false; units installed and inert; AFL Tables timer
      disabled; before 2027-03-17T00:00Z; feed bytes equal the pin; register exactly [2027]; switch retired;
      readiness REPOSITORY READY)
  Stop on any discrepancy. If the parent directory is absent, report it; do not create it unasked.

Step B  (the run: operator as arm, ONLY under the grant, owner-attended, one tmux session)
  cd /home/arm/projects/afldb
  node node_modules/tsx/dist/cli.mjs tools/current-season/afl-api-c4b-rehearsal.ts \
    --season 2027 --decision D-316-13 --evidence-dir /home/arm/backups/afldb/c4b-ea98a35f-r1 --max-minutes 30
  Exit 0 = CLEAR. Exit 1 = HALT (stop; report; no retry without a new decision). Exit 2 = refused, nothing written.
  Exit 3 = restoration NOT verified: immediately
     node node_modules/tsx/dist/cli.mjs tools/current-season/afl-api-c4b-rehearsal.ts --restore-only --evidence-dir /home/arm/backups/afldb/c4b-ea98a35f-r1
  and confirm the setting reads false before anything else.
  Claude does not start Step B unless the owner says to run it in this session as arm; otherwise the owner or operator runs it.

Step C  (Claude, SSH as arm, read-only; after Step B)
  setting false; both timers disabled/inactive; both services inactive; afldb.service MainPID and NRestarts unchanged;
  checkout still R and clean; result.json verdict; evidence directory listing and hashes; the snapshot directory left under
  data/sources/afl_api/matches/ (named, not deleted); the two audit rows (on, off) counted read-only.
  Then the reviewer named in the grant reads the evidence directory; the C4b PASS record is theirs and the owner's, not this session's.
```

C5 needs a C4b `result.json` with `verdict: CLEAR` and the reviewer's acceptance, plus its own approval; `c5-pre` enforces the record.

## 5. Gaps this session could not close (unverified, stated so they are not assumed)

* **`c4b-pre` has not been run**, so ledger 118, the register, the readiness tool and `/home/arm/backups/afldb` have not been re-read on the host today; they are proven by the package self-test and by M-a/M-b records, not by a fresh read.
* **The reviewer** is not named, and the **evidence-directory name** is a proposal.
* **Provider reachability and rate behaviour from `afldb-prod`** have not been probed (a probe would itself be provider contact, which D-316-13 does not yet permit).
* **The Brownlow public-rendering check** remains an explicitly unverified follow-up and is not a precondition of C4b.
