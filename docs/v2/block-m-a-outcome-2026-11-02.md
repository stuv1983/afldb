# Block M-a outcome (migration 118 and compatible release), 2026-11-02

**Status: APPLIED TO PRODUCTION AND VERIFIED.** Migration 118 is applied (ledger 118) and release `ea98a35f2061--vY0EFS0DdR-TiPkxTZz6` (revision R) is serving. **Block M-b (the first 2027 fixture window) has NOT been run and is not approved.** `afldb_prod` still holds `fixtures_rows=0`. Package: [block-m-execution-package-2026-11-02.md](block-m-execution-package-2026-11-02.md). Evidence: [`evidence/block-m-a-20261102/`](evidence/block-m-a-20261102/).

## 1. Authority and binding

| Item | Value |
|---|---|
| Approval | the owner's M-a approval of 2026-11-02 (written in the session; scope exactly section 11 of the package). T0 = the message; first production read 01:47:21Z (12:47 AEDT) |
| R | `ea98a35f20610e75c18e698bc0d9fe084c3c783d`, pushed by the owner (`531036c9..ea98a35f`, fast-forward, static check A,B,C PASS before the push) |
| Target | `afldb_prod`, `afldb-prod` localhost:5432, system identifier `7674454702926115004`, OID `66668` (checked by `pre`, `migrate` and `readback`) |
| Outgoing release / sole rollback target | `fd48ace0c2cb-pqAQwRIJWLjSYzR8LiTuy` (never rolled back to; not needed) |
| Not approved, not done | fixture apply, acquisition switch, timers, Brownlow, privileges, cleanup, further push |

## 2. What ran (UTC)

| Step | Time | Result |
|---|---|---|
| D1 | 01:47 | static check from R's own bytes on the host PASS; `pre` at `affe9a2c` PASS (ledger 117, no writer, OLD_SERVING); `git merge --ff-only` to R; `pre` at R PASS. Package extracted from R's objects to `/home/arm/blockm-pkg-ea98a35f2061` (mode 700) |
| B1 backup | 01:47:42 | `/home/arm/backups/afldb/blockm-a-20261102T014742Z`: dump sha256 `914f1d9aae2b7f4d09703735ca2fdef7f9783e5c7929efc7120af0a9dadfbd3e`, 29,837,494 bytes, toc 1,648, `pg-dump.stderr` empty, `RESULT PASS` (10 s) |
| Private copies | 01:48 | workstation `D:\tmp\blockm-a-private` (ACL: the operator account only) and streamanator `/mnt/ssd/afldb-v2-gap029l-20261101T204205Z/in/prod-ma/` (700/600); sha256 equal at every hop |
| Restore verification | 01:49 | streamanator guarded cluster 127.0.0.1:55493, disposable `afldb_v2_blockm_ma_rst_test`: `pg_restore` exit 0, 0 stderr lines; ledger 117, digest `647c3fb3…`, 17,056 matches, 0 fixtures, equal to the live `pre` figures; DEV `afldb.service` and `postgresql@16-main` unchanged (PIDs 1162113, 1504). `restore-verify-m.sh` bytes from R (sha256 `c802a61c…3616`) |
| M1 migrate | 01:50 | `pre` PASS; backup binding "age 2.5 min"; pending set exactly `118_…`; `MIGRATE PASS`; `READBACK PASS`: ledger 118, last `118_fixtures_unconfirmed_participants.sql`, digest `573594e9365b642ec518c252b17de11d3a423872c53c3020ab525db5904aaf57`, `confirmation NOT NULL DEFAULT 'confirmed'`, placeholders and club ids nullable, `fixtures_rows=0 matches_rows=17056` |
| M2-build | 01:50 to 01:56 | admission MemAvailable 2,915 MB; npm ci 17 s (min 2,002 MB); build 245 s (min MemAvailable 1,326 MB, peak RSS 1,735 MB, above the 900 MB signal floor, guards unchanged); V1-V5 and smoke pass; `RELEASE READY`; `VERIFY PASS` (12,995 files, BUILD_ID `-vY0EFS0DdR-TiPkxTZz6`); `current`/`previous` unmoved by the build |
| M2-promote | 01:59 | `PROMOTED`; `current` = new, `previous` = `fd48ace0…`; probe `NEW_SELECTED_OLD_RUNNING` |
| M2-restart (owner) | 02:18:50 | `sudo systemctl restart afldb` by the owner, 19 minutes after promote, unit `active` |
| M2-check | 02:19 | `POST-INSTALL CHECK PASS`; probe `NEW_SERVING` MainPID **3268373**; `READBACK PASS` (schema still 118, `fixtures_rows=0`); journal line `serving build -vY0EFS0DdR-TiPkxTZz6 release ea98a35f2061--vY0EFS0DdR-TiPkxTZz6 revision ea98a35f20610e75c18e698bc0d9fe084c3c783d`; 0 error/fatal/unhandled lines; NRestarts 0 |

## 3. Final production state (read at 02:19:14Z)

| Item | Value |
|---|---|
| Serving release | `ea98a35f2061--vY0EFS0DdR-TiPkxTZz6`, revision R, MainPID 3268373, health `ok`/`database ok` |
| `current` / `previous` | `ea98a35f2061--vY0EFS0DdR-TiPkxTZz6` / `fd48ace0c2cb-pqAQwRIJWLjSYzR8LiTuy`; retained on disk: `ad245d602f6f-…`, `61a95f7397da-…`, `9ed9c9dd3e84-…` |
| Schema | ledger 118, digest `573594e9…af57`; `fixtures` 0, `matches` 17,056 |
| Primary checkout | `/home/arm/projects/afldb` at R, clean |
| Writers | all AFL Tables, AFL API, Brownlow and e-mail units inactive or absent during the whole run |

Journal evidence: the post-install check read the journal as `arm`; the `serving build` line above came from `journalctl -u afldb` and was readable by `arm` (no owner action needed). One old Cloudflare cache HIT for the previous build's immutable asset was reported by the check; the origin returns 404, as designed (not a failure).

## 4. Disclosures

* **Visual: UNVERIFIED.** No authenticated visual check of `/admin/fixtures` on production was made (optional owner look, package section 7). Local candidate evidence is 36/36; production visual remains `VISUAL: UNVERIFIED` until the owner looks, signed in.
* One read-only SSH call hung once and was stopped and retried with a connect timeout; no production effect.
* Left on the host, outside Git: the package copy, the step scripts `blockm-*.sh` and their `.out` logs under `/home/arm/`, the migrate log directory `/home/arm/blockm-a-migrate-20261102T014700Z`, `/home/arm/blockm-new-id.txt` (the new release id; M-b reads it) and the vars file `/home/arm/blockm-vars.sh`. Nothing was cleaned up (not approved). On streamanator `/tmp/rvm-R.sh`, `/tmp/rvrun.sh` and `/tmp/blockm-rv-ma.log` remain (the log is copied to the evidence directory).
* The backup `blockm-a-20261102T014742Z` is retained on the host, the workstation and streamanator. Its restore evidence is valid only for the ledger-117 state; **it is the pre-M-a insurance**.

## 5. Rollback position now

Code-only rollback to the outgoing release is full fidelity before any fixture apply: `node deploy/release.mjs rollback --to fd48ace0c2cb-pqAQwRIJWLjSYzR8LiTuy`, then an owner restart (never an unqualified `rollback`). The schema stays 118 (proven compatible). Schema 118 is never undone by an operator command. Not exercised; nothing failed.

## 6. Next

M-b needs its own approval (package section 11, "M-b"; state and exact preconditions in [the M-b request](#7-m-b-request-drafted-not-approved)).

## 7. M-b request (drafted, not approved)

Variables for M-b: `R` = `ea98a35f20610e75c18e698bc0d9fe084c3c783d`; `NEW_ID` = `ea98a35f2061--vY0EFS0DdR-TiPkxTZz6` (also in `/home/arm/blockm-new-id.txt`); `matches_rows` = 17,056 (S2 re-reads it with `pre`); snapshot `afl-api-2027-2026-11-01-012026`, `00-season-matches.json` sha256 `21fd12e7704b7c7146cfbab414352352f3cfaa53e7ef5038f4411fa789e4c84d`, 218 records. Expected result: fixtures 0 to 218 (135 confirmed, 83 unconfirmed), `readback-b` `218|135|83|11|10|83|0|1|0`. Bounded 15-minute window, the acquisition switch restored to `false` and verified. After M-b the code-only rollback is no longer full fidelity (package section 10), and all Brownlow baselines are void.
