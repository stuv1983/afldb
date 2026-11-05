# AFLDB-ISSUE-336: DEV procedure corrections, isolated verification (2026-11-06)

This folder supports the corrected `issues/open/AFLDB-ISSUE-336-DEV-DEPLOYMENT.md`. It **adds to**
`../dev-preview2-20261106/` and does not replace it. That folder's evidence stands. Its README's statements about the nightly, the
Brownlow comparison and the restart are superseded as listed in §5.

**Nothing in this folder ran against DEV's service, database, timers or provider access.** DEV contact was limited to:
* read-only health probes;
* one read-only `tar` of DEV's current application artifact;
* a read-only copy of DEV's latest 2026 settle label;
* reads of DEV's settle-timer journal and `systemctl list-timers`.

DEV health was identical before and after (`host/dev-health-*.txt`): `afldb` active, MainPID 1677, health 200, HEAD `242fa276`,
10 untracked, BUILD_ID `8sFpWkolwF1yKuKbFkOir`, both timers active.

All probe services were transient **user** units (`systemd-run --user`) on loopback ports 33364 and 33365. Both were stopped at the
end of their part. Databases were marked `afldb_v2_*_test` databases on the isolated cluster (port 55499), dropped after use. No
sudo. No provider request.

Workspace on streamanator: `/mnt/ssd/afldb/workspaces/i336-prep4-20261106` (mode 700; retained, holds the 907 MB artifact copy).

## 1. R: the sudo-free restart, executed for real

* **The change:** `deploy/sync-dev.ps1` has a new `-RestartMethod respawn` option.
  * The generated restart block sends SIGTERM to the unit's MainPID and requires systemd (`Restart=always`) to start a new MainPID
    within 60 s. No `sudo` is attempted.
  * The default `auto` is unchanged apart from one error-message line (`runners/sync-dev-generated-default.diff`).
  * `runners/sync-dev-generated-step6-auto-vs-respawn.diff` shows the step-6 difference.
* **Static coverage:** `tests/sync-dev-static.test.ps1` has 27 assertions; it passes. The respawn variant:
  * contains no `sudo`;
  * has exactly one `kill "$AFLDB_OLD_PID"`, placed after the build and before readiness;
  * keeps the built-BUILD_ID readiness check;
  * has a payload of 20,548 against the 24,000 limit.

  `-RestartMethod sudo` is refused.
* **Executed:** `runners/probe-restart.sh` is the *generated* step-6 script's blocks, extracted verbatim:
  * enter project directory;
  * capture standalone build identity;
  * restart;
  * status;
  * ISSUE-107 worker/pool gate;
  * readiness.

  It contains no sudo, git or npm. It ran against a user unit with DEV's settings: `Restart=always`, `RestartSec=5`, `KillMode=mixed`.
  The unit ran the pin's `deploy/server-cluster.mjs` with 4 workers over the pin's standalone build, against a 118-schema copy of DEV
  data. A `systemctl` shim mapped to `systemctl --user`.

| Measure | Result (`host/R-*.txt`) |
|---|---|
| Script | rc 0. "systemd respawned the service: 4040039 -> 4040918". Gate saw `AFLDB_WORKERS=4`, `AFLDB_POOL_MAX=10`. "health ready after 3s". Live BUILD_ID equals the built one. |
| Workers | Before: 4 children, `x-afldb-worker` 1–4. After: 4 children of the new MainPID, workers 1–4. `NRestarts=1`. |
| Outage, 0.2 s poller (`R-poll.txt`) | SIGTERM at about +2.2 s. Then: 1.3 s of refused connections (workers stop); service again for about 3.5 s; then 5.6 s refused (master exits about 5 s after SIGTERM, then `RestartSec=5`); steady from +12.6 s. **About 10.3 s from SIGTERM to steady service, about 7 s of it refusing.** |

This matches DEV's two recorded respawns: about 10 s each, on 2026-10-15 and 2026-10-26.

## 2. P: DEV's current artifact preserved, and served without npm ci or build

| Step | Result (`host/P-*.txt`) |
|---|---|
| `tar -cf … .next/BUILD_ID .next/standalone` from `~/projects/afldb` (read-only) | 9 s; 907,243,520 bytes; 20,638 entries; **0 `.env` entries**; sha256 `86f8a6e9…4118`; `BUILD_ID` = `standalone/.next/BUILD_ID` = `8sFpWkolwF1yKuKbFkOir` |
| Restore into an empty directory with only `242fa276`'s `deploy/server-cluster.mjs` (`git archive`); **no root `node_modules`, no `npm ci`, no build** | sha256 re-checked, then extracted |
| Served as a user unit on `:33365`, 4 workers, over the 118-schema DEV copy | 4 children, workers 1–4, `x-afldb-build` = `8sFpWkolwF1yKuKbFkOir` |
| 36-route HTTP smoke against the isolated `242fa276` build (`../dev-preview2-20261106/`) | **0 status or marker differences** |

DEV's running code can therefore be put back in seconds from the preserved archive, without rebuilding. Root `node_modules` is needed
only by the timers' `tsx`; see §4.

## 3. N: the pin's nightly on the authentic 2027 feed over today's DEV backup

* **Inputs:**
  * A fresh clone of `8b024098`, with `npm ci`.
  * The retained, already accepted authentic 2027 season feed `CD_S2027014`:
    * captured 2026-11-01, label `afl-api-2027-2026-11-01-012026`;
    * sha256 `21fd12e7…c84d`;
    * 218 matches: SCHEDULED 135, PLACEHOLDER 83.
  * The feed was laid out as the nightly's acquisition step writes it (`runners/build-match-snapshot.mjs`): `00-season-matches.json`,
    `token.meta.json`, `manifest.json`, status CONCLUDED → **0 of 218 selected**.
  * A second label repeats the same bytes, to simulate an unchanged feed on the following night.
* **Database:** a restore of today's verified DEV dump (`afldb_dev-20261105T191426Z.dump`), migrated 111–118, with privileges applied.
* **Command:** the wrapper's step 2 verbatim: `settle-afl-api.ts --label L --apply --auto-apply --require-complete-source`.

| | Before | Night 1 | Night 2 |
|---|---|---|---|
| settle rc | | 0 | 0 |
| `import_batches` | 78 (max 145) | 79: batch 146 `completed`, 0 read / 0 inserted / 0 updated / 0 rejected | 80: batch 147, the same |
| Batch `seasonFeedMatches` / status counts / `snapshotMatches` | | 218 / SCHEDULED 135, PLACEHOLDER 83 / 0 | the same |
| Log | | "Source completeness: COMPLETE … supplied no rows"; "0 refused at the write" | the same |
| `matches` 2025 / 2026 | 216 / 218 | unchanged | unchanged |
| `player_match_stats` | 695,499 | unchanged | unchanged |
| `fixtures` (all / 2027) | 3 / 3 | unchanged | unchanged |
| `data_issues` open | 68 | unchanged | unchanged |
| `staging.afl_api_match` | 0 | unchanged | unchanged |

The exceptions report at the end of each run lists DEV's existing open `data_issues`. It adds none.

## 4. O: the old (`242fa276`) nightly on the 118 schema, for recovery

* **Setup:** the same restore, migrated to 118. A read-only copy of DEV's own latest label `afl-api-2026-2026-11-05-180838`, settled by
  `242fa276`'s own checkout and `node_modules`.
* **Result:** rc 0. "Applied as import batch 146: 0 inserted, 0 updated … **64 refused at the write**". 10,464 records read, 0
  rejection rows. Every canonical count is unchanged (`host/O-settle.txt`).
* **Comparison:** this is **identical** to DEV's real run at 2026-11-06 05:08 AEDT (`host/dev-nightly-20261106-journal.txt`): batch
  145, 10,464 read, 64 refused (`foreign_source_owner`), `AFLDB_SETTLE_SUCCESS`.
* **Conclusion:** the old nightly works on the 118 schema, so a code-only recovery needs no schema reversal.

## 5. What this supersedes in `../dev-preview2-20261106/README.md` and the 2026-11-06 deployment document

| Earlier statement | Correction |
|---|---|
| The nightly writes empty batches "until the 2027 fixture appears (production expects 2027-03-16)" | **Withdrawn.** The authentic 2027 feed (218 matches) was captured on 2026-11-01 and accepted. Production's first 2027 night (2026-11-03) read it. Fixture *acquisition* is done. The nightly never writes `fixtures`; production's 218 fixture rows came from the separate ISSUE-229 fixture writer. What does not start until 2027 is *concluded-match ingestion*: the first scheduled match is 2027-03-17 08:30 UTC (19:30 AEDT), so the first nightly that could ingest one is about 05:00 AEDT 2027-03-18. |
| Brownlow no-op is the "same as production, where the gate is also absent" | **Corrected.** Production's Brownlow **timer is disabled**. DEV's is enabled and fires every 5 minutes, but its wrapper exits before Node. Same effect, different state. |
| Step 6 restarts with "`sudo -n` if passwordless, otherwise kill MainPID" | **Replaced** by `-RestartMethod respawn`: no sudo attempt; about 10 s outage, measured in §1. |
| Recovery: "`git switch main && npm ci && npm run build`" | **Replaced** by restore-from-archive without rebuild (§2), with `npm ci` at `242fa276` only for the timers. Schema stays at 118 (§4). |
| "Not verified: the DEV runtime shape" (four workers over `.next/standalone`) | Now verified in isolation for both the pin (§1) and DEV's current artifact (§2). |

The earlier claim that DEV has no 2027 fixtures (session working note only, never committed) was also wrong. DEV's data has 3 fixture
rows, all 2027.

## 6. Files

* `host/`: raw outputs. `*.log` files are force-added. No DSN, password or secret appears: env files were written mode 600 on the
  host, and only variable names are recorded (`R-env-names.txt`).
* `runners/`:
  * `prev4.sh` (R, P and the first N attempt). Its read-only facts query deadlocked: the helper queried the pool outside its
    one-connection transaction. The helper was fixed and N was rerun from the facts step by `prev4n.sh`; the stuck processes were this
    session's own and were stopped.
  * `prev4n.sh`, `prev4o.sh`, `probe-restart.sh`, `nightly-facts.mjs`, `build-match-snapshot.mjs`, `dev-nightly-journal.sh`.
  * `devinspect2.sh` and `devinspect2.out`: the earlier read-only DEV inspection, covering unit settings, timer schedule and artifact
    sizes.
  * The two generated-script diffs.
