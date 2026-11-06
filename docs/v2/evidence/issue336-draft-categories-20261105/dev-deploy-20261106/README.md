# ISSUE-336 / ISSUE-337: DEV deployment record (executed 2026-11-07)

Procedure: `issues/open/AFLDB-ISSUE-336-DEV-DEPLOYMENT.md` r2 at `7fabc6e5`.
Application pin: `8b024098a6771fc5e5be2f8bf006c9c3ca8ab55a`. Workstation tooling: exactly `7fabc6e51c5c53c4b6f6fe345f21191d9184660b`.

The folder name carries the first approval's date (2026-11-06). That approval's window passed unused: no one signed in, and then the
workstation VPN blocked DEV. The owner re-approved A2–A4 for **2026-11-07, 08:00–18:00 AEDT**. A1 had been published on 2026-11-06
(`origin/main` `ea9bddf8` → `7fabc6e5`, fast-forward, remote checked before and after) and was not repeated.

**Result: immediate acceptance (§7.1) PASS.** The overnight observation (§7.2) is **PENDING**.

## 1. Timeline (AEDT, 2026-11-07)

| Time | Step | Result |
|---|---|---|
| 06:29 | Read-only prerequisite revalidation (`runners/prereq.sh`) | DEV unchanged. Today's 05:13 nightly (old code) re-settled 2026 as batch 146: 0 inserted, 0 updated, 64 refused, `AFLDB_SETTLE_SUCCESS` |
| 06:35 | Headed sign-in (`runners/dev-accept-headed.cjs`, `browser-3/`) | The owner signed in through DEV's normal flow. `validate-1` PASS 6/6 against the **current** DEV (`8sFp…`): anonymous `/draft` gets a 307 to `/beta` (gate on). Cookie name `afldb_beta` only; its value was never read out |
| 08:00:02 | 0–1 quiescence and before-state (`host/step01.log`) | `STEP01-OK`: `242fa276`, `main`, 2 stashes, 10 untracked, BUILD_ID `8sFp…` twice, MainPID 1677 with 4 children, timers enabled and active; `.env` and the five unit definitions hashed |
| 08:00:08–08:00:35 | 2 fresh backup and restore verification (`host/step2*.log`, `backup-record/`) | `BACKUP-DUMPED` (39 MB, ledger 110), then `BACKUP-VERIFIED` on the isolated cluster 55499: pg_restore exit 0 with no stderr, 19 tables plus the ledger identical, the rehearsed migrate 111–118, privileges rc 0, re-run "Nothing to apply". Off-host copy at `C:\Users\stuar\backups\afldb\dev-deploy-20261107\`, `sha256sum -c` OK |
| 08:00:49 | 2b artifact archive (`host/step2b3.log`) | `OK`, BUILD_ID `8sFp…` twice, 0 `.env` entries, 21,058 entries, 877 MB, sha256 `d3a36193…0639` |
| 08:00:5x | 3 branch | **STOP**: `fatal: cannot lock ref 'refs/heads/dev/v2-main': 'refs/heads/dev' exists`. DEV has a local branch `dev` (`26775e8d`, already in `main`). Nothing live had changed; only `git fetch --prune` had updated the remote-tracking refs |
| 08:03:13 | 3, amended **by the owner** (`host/step3-amended.log`) | Branch **`dev-v2-main`** at `8b024098`, upstream `origin/main`. `dev` is untouched. Every other parameter is unchanged; both sync-dev runs used `-RemoteRef dev-v2-main` |
| 08:03:25–08:04:59 | 4 `sync-dev -SkipBuild -SkipRestart -SkipHealth` (`workstation/step4-sync-dev.log`) | Exit 0. Classifier: 0 tracked changes, 10 known operational untracked, 0 unknown. Fast-forwarded to exactly `8b024098`; `npm ci`; migrations 111–118 applied (8). The old build kept serving |
| 08:05:09 | 5 `db:privileges` (`host/step5.log`) | rc 0. The old build was still serving (`8sFp…`, 200) |
| 08:05:22–08:10:06 | 6 `sync-dev -Issue107Gate -RestartMethod respawn` (`workstation/step6-sync-dev.log`) | Exit 0. Built `AlYJjIargpO5esTkTX_zq`; respawned with no sudo (MainPID 1677 → 1246449); gate read `AFLDB_WORKERS=4`, `AFLDB_POOL_MAX=10`; health ready after 2 s; live BUILD_ID equals the built one |
| 08:10:22–08:10:44 | 7a DEV side (`host/accept-7a-1.log`) and browser (`browser-3/accept-1.json`, `smoke-1.txt`, `screens-1/`) | See §2 |
| 08:15:02 | 7a Brownlow firing after step 6 (`host/brownlow-0815-journal.txt`) | "AFLDB_AFL_API_BROWNLOW_ENABLED is not 'true' … Nothing to do.", `Result=success`, `ExecMainStatus=0` |
| 08:15:49 | Browser closed | The in-memory session was discarded |

Steps 2–7a took 08:00:08–08:15:22, inside both the 2-hour limit and 20:00.

## 2. Immediate acceptance (§7.1)

1. **Identity:**
   * HEAD `8b024098…`;
   * branch `dev-v2-main` (amended name). The script's hard-coded check for `dev/v2-main` reported the one expected FAIL; nothing else differed;
   * `main` = `242fa276…`;
   * stashes 2, untracked 10;
   * `.env` sha256 unchanged (`81dc3f69…62a2e2`);
   * `.next/BUILD_ID` = standalone = live `x-afldb-build` = `AlYJjIargpO5esTkTX_zq` ≠ `8sFp…`.
2. **Schema:** ledger 118, last `118_fixtures_unconfirmed_participants.sql`. `db:migrate` reports "Nothing to apply". `db:privileges` rc 0 (step 5).
3. **Health:** `afldb` active, MainPID 1246449 ≠ 1677. `/api/health` returns 200 with `"database":"ok"`.
4. **Four workers:**
   * 4 children of MainPID;
   * the gate read `AFLDB_WORKERS=4` and `AFLDB_POOL_MAX=10`;
   * 40 requests to `/api/health` were served 10 each by workers 1, 2, 3 and 4.
5. **Authenticated browser:** `accept-1` **PASS 76/76** (desktop 1280×900, mobile 390×844), through DEV's normal address `http://10.0.40.100:8090`. The beta gate stayed on.
   * The owner's headed session replaced the procedure's `BETA_COOKIE` tunnel, as the owner instructed: no plaintext cookie file and no minted credential.
   * Jake Long (2014 Rookie Pick 47, Father–Son) is found with an ordinary space, NBSP, and lower case.
6. **HTTP smoke** (`smoke-1.txt`, the same 36 routes as `smoke.sh`, through the authenticated context): every status equals `dev-preview2-20261106/host/smoke-33362.txt`, with 0 error markers. The three Jake Long queries give `jake_rows=2` and `empty_state=0`. Byte counts differ only slightly; `/admin`'s 307 body is 35 bytes against 12.
7. **Timers:**
   * both still enabled and active;
   * the next nightly is **Sun 2026-11-08 05:08:36 AEDT**;
   * the five unit definitions (`systemctl cat`) hash identically before and after;
   * the first Brownlow firing after step 6 (08:15:02) logged "Nothing to do", rc 0. The 08:10:00 firing ran during step 6, also "Nothing to do".

## 3. Overnight observation (§7.2): PENDING

The next scheduled nightly is Sun 2026-11-08 05:08:36 AEDT (systemd's randomised delay applies). It was **not triggered**, and its outcome is not
claimed. The owner has authorised a read-only observation after it runs, using §7.2's journal query and table. Recheck the scheduled time first.

## 4. Left in place (no cleanup authorised)

On DEV:
* the branch `dev-v2-main`;
* the backup directory `/mnt/ssd/afldb/backups/dev-pre-v2-20261106T210008Z/` (dump, records, `dev-app-8sFpWkolwF1yKuKbFkOir.tar`, `SHA256SUMS-app`);
* the verify database `afldb_v2_devbk20261106210008_test` on the isolated cluster 55499;
* the workspace `/mnt/ssd/afldb/workspaces/i336-deploy-20261107/` (scripts and logs);
* the earlier previews on :33361 and :33362.

On the workstation: the off-host backup copy `C:\Users\stuar\backups\afldb\dev-deploy-20261107\`.

R1 was not needed and was not run. No sudo, timer change, unit change, `.env` change, manual job trigger, provider request or production operation took place.

## 5. Files

* `runners/`:
  * `dev-accept-headed.cjs`, the headed sign-in and acceptance runner;
  * `prereq.sh`, `step01.sh`, `step2.sh`, `step2b3.sh` (its step 3 part failed as recorded), `step3a.sh` (the amended step 3), `step5.sh` and `accept.sh`.
* `host/`: DEV-side logs and the 08:15 Brownlow journal.
* `workstation/`: the two `sync-dev` transcripts.
* `backup-record/`: the backup's small records, excluding the dump.
* `browser/`: the 2026-11-06 attempt (timed out, `authenticated:false`). The second attempt that day failed on the VPN before it wrote anything.
* `browser-3/`: `auth.json`, `validate-1.json`, `accept-1.json`, `smoke-1.txt`, `screens-1/` (22 images) and `runner-console.txt`.
