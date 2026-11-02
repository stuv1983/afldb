# ISSUE-316 C4b outcome: the D1 rehearsal on afldb-prod ended HALT (2026-11-02)

**Status: C4b RAN ONCE UNDER D-316-13 AND ENDED `HALT` (exit 1). IT IS NOT A CLEAR AND NOT A PASS.** The switch was restored to `false` and verified; nothing else changed. The HALT reason is a defect in the rehearsal tool's own gate, not a data or ingestion fault (section 4), but a HALT is recorded as a HALT. **C5 is not approved and cannot proceed**: `c5-pre` requires a `result.json` with `verdict: CLEAR`. The reviewer's acceptance is **pending** and is the owner's, not this record's.

Grant: owner's D-316-13 for revision `ea98a35f20610e75c18e698bc0d9fe084c3c783d` (R), host `afldb-prod`, database `afldb_prod` (OID 66668, system identifier 7674454702926115004), season 2027, evidence directory `/home/arm/backups/afldb/c4b-ea98a35f-r1`, reviewer Stuart (owner), attended. Package: [approval](block-c-c4b-approval-2026-11-02.md), [execution package](block-c-execution-package-2026-11-02.md) section 6. Local copy of the evidence: [`evidence/block-c-c4b-20261102/`](evidence/block-c-c4b-20261102/) (host copy is authoritative; `token.meta.json` and the raw snapshot were deliberately not copied).

## 1. Sequence (UTC, 2026-11-02, SSH as `arm`, no sudo)

| Time | Step | Result |
|---|---|---|
| 05:26:28 | Step A pre-checks (`stepA.sh`): checkout HEAD = R, 0 porcelain lines; `c-prod.sh` on host sha256 `ec839a47…d496` = R's blob = local; feed copied from `git show R:` to `/home/arm/blockc-pkg-ea98a35f2061/c4b-feed-2027.json` (new, mode 600) sha256 `21fd12e7…4c84d` = pin; `/home/arm/backups/afldb` exists, writable by arm; evidence directory absent; 51 GB free on `/`; `afldb.service` MainPID **3268373**, NRestarts **0** | all as required |
| 05:26:36 | `c-prod.sh c4b-pre` | **`C4B-PRE PASS`**: ledger 118 rows, last `118_fixtures_unconfirmed_participants.sql`, digest `573594e9…aaf57`; identity ok (read-only); switch `false`; both services `loaded`/`inactive`; both timers `disabled`/`inactive`; AFL Tables timer `disabled`/`inactive`; register `[2027]`, AFL Tables `retired`; readiness **REPOSITORY READY** (218 matches, 19 venues, 40 teams mapped) |
| 05:26:48 | Launch 1 (tmux `c4b-ea98a35f-r1`) | **Never started the tool**: exit 127, `node: command not found` (non-login tmux shell had no node on PATH). My launch error, not a tool refusal or HALT. Verified before relaunch: evidence directory absent, snapshot directory absent, checkout clean, no tmux session. Log kept as `launch1-node-not-found.txt` |
| 05:27:21 | Launch 2: same command with `PATH` prefixed by `/home/arm/.nvm/versions/node/v22.23.2/bin` (the path `c-prod.sh` uses), one tmux session, `--max-minutes 30` | **The one run of the tool.** Exit **1**, finished 05:27:24 |
| 05:27:39 | Step C read-back (`stepC.sh`, `stepC2.sh`) | section 3 |

The owner asked for one run; launch 1 executed none of the tool (nothing could have been written), so the tool itself ran exactly once. It was **not** retried after the HALT.

## 2. What the run did (from `run.log`, `result.json`)

* Watchdog started, proved ready (pid 3289876, parent 3289853), armed until 05:59:21Z.
* Setting `true` at 05:27:22.301 (audit row 301); `acquire-afl-api.ts --season 2027` fetched the season feed: HTTP 200, **218 matches, `selected: 0`**; no per-match `playerStats`/`matchRoster` request was made. Snapshot label `afl-api-2027-2026-11-02-052722`.
* `settle-afl-api.ts --label … --dry-run --auto-apply --require-complete-source`: 0 match units built, 0 build failures, **season feed CD_S2027014 complete** (218; SCHEDULED 135, PLACEHOLDER 83), `canonicalRowsInserted` 0, `canonicalRowsUpdated` 0, apply refusals/failures 0, unresolved/unmapped venue and identity counters all 0, `Source completeness: COMPLETE`, the whole transaction rolled back (no `import_batches` row retained).
* Setting restored to `false` at 05:27:23.992 (attempt 1), verified on the writer and the control path (`restore-verified.json`). Exit code was never 3.
* Verdict `HALT`, one reason: `the dry-run Season feed (AFLDB-ISSUE-231) evidence is seasonFeedComplete 1`.

## 3. Independent post-run verification (read-only, my own reads)

| Check | Result |
|---|---|
| Switch `acquisition.afl_api_current_season_enabled` | `false` (read via the packaged `afldb_backup` read-only session; identity afldb_prod / OID 66668 / sysid 7674454702926115004) |
| Audit rows | run `c4b-2026-11-02T052721596Z-3289853`: **#301 `step: on`, enabled true** (16:27:22+11) and **#302 `step: restore`, attempt 1, enabled false** (16:27:23+11), actor `afl-api-c4b-rehearsal`, decision `D-316-13`. (#297/#298 are the earlier M-b fixture-window pair, unrelated) |
| Services / timers | both services `inactive`, `static`; both timers `inactive`, `disabled`; `afldb-settle-afltables.timer` `inactive`, `disabled` |
| Application | MainPID **3268373**, NRestarts **0**, active/running: unchanged |
| Checkout | HEAD = R, `git status --porcelain` 0 lines (snapshot lives under the git-ignored `data/sources/`) |
| Canonical writes | log: inserted 0, updated 0. Independent: `matches` season 2027 = 0, afl_api-owned matches = 0; `before.json` and `after.json` byte-identical (sha256 `15cc09f9…3849`: `matchesInSeason` 0, `aflApiOwnedMatches` 0, setting `"false"`) |
| Tmux | no session remains |

I did not run a query against `import_batches` (my one attempt used a wrong column name and errored read-only); the dry run's own statement is that no batch row was retained.

## 4. Why it HALTed: a gate defect, evidence in the repository

`tools/current-season/afl-api-c4b-rehearsal.ts:250-251` reads the settle's `seasonFeedComplete` counter and halts unless it equals the string `'true'`. The settle emits it as a number (`src/lib/acquisition/settle-afl-api.ts:1981`, `counters.seasonFeedComplete = bundle.seasonFeed.complete ? 1 : 0`, initial `0`). The run's own output shows `seasonFeedComplete: 1` and "Season feed CD_S2027014: 218 match(es), complete". So **1 means complete and the gate rejected the passing value.** The hand-written gate was exercised 36/36 in isolation against a synthetic settle output that prints `seasonFeedComplete: true` (`tests/afl-api-cutover.test.ts:1144`, `DRY_OK`); the real settle prints `1`, so the test fixture and the real output disagree. `tests/afl-api-ingestion-safety.test.ts` already models the real numeric `1`. This is the only HALT reason; every other criterion in the tool's list that is visible in the evidence (canonical inserts/updates 0, BEFORE equals AFTER, timers disabled/inactive, readiness, restoration) was satisfied.

I have **not** edited the tool, re-run it, or relabelled the verdict. A fix would change the revision (R is pinned in the package and in `c-prod.sh`'s checks), so it needs the owner's decision, a new revision and probably a new C4b approval. I have not opened a tracked issue; recommend one under ISSUE-316 (AFLDB-ISSUE-316 C4b gate compares `seasonFeedComplete` to `'true'`).

## 5. Limitations (what this run did and did not prove even if the gate were fixed)

1. **No per-match path exercised.** `selected: 0`: the 2027 season has no CONCLUDED matches, so no `playerStats`/`matchRoster` fetch, no player-level rows, no observations, no derived recompute. This is inherent to a pre-season rehearsal on 2 Nov, not a fault.
2. **Live feed differs from the retained pin.** The acquired `00-season-matches.json` is 266,461 bytes, sha256 `1a51317b…7ced`; the retained fixture the readiness check used is 266,389 bytes, `21fd12e7…4c84d`. The live feed was still read as complete (218), but the difference is unexamined (likely status/timestamps; not diffed).
3. **Rate and reachability from the host** were exercised only by two requests (token and season feed); no sustained rate behaviour was observed.
4. **Brownlow baseline `43300297…821d` is no longer valid** for baseline-bound Brownlow work (the run wrote `site_settings` and `auth_audit_log`); nothing pending depends on it.
5. The Brownlow public-rendering check remains an unverified owner-led follow-up (unchanged).

## 6. Left on the host (named, not deleted)

* Evidence directory `/home/arm/backups/afldb/c4b-ea98a35f-r1` (mode 700; files mode 600): `acquire.log`, `after.json`, `before.json`, `readiness.txt`, `restore-verified.json`, `result.json`, `run.log`, `settle-dry-run.log`, `watchdog-ready.json`, `watchdog.pid`. Hashes: `result.json` `25a53e87…c663`, `run.log` `857d1678…bbe`, `restore-verified.json` `33c504cc…d421`, `before.json`/`after.json` `15cc09f9…3849`, `settle-dry-run.log` `c8dc09ed…eaf4`, `readiness.txt` `59a70409…8bd1`, `acquire.log` `5ac38c85…f901`, `watchdog-ready.json` `37d018a1…bfc29d`.
* Snapshot `/home/arm/projects/afldb/data/sources/afl_api/matches/afl-api-2027-2026-11-02-052722/` (`00-season-matches.json`, `manifest.json`, `token.meta.json`; 3.1 MB under `data/sources/afl_api`), git-ignored. `token.meta.json` was not copied or printed.
* `/home/arm/blockc-pkg-ea98a35f2061/`: the staged package, the mode-600 feed copy, `c4b-run.log` / `c4b-run.exit` (exit 1) and `c4b-launch1-node-not-found.{log,exit}`.

## 7. Not done, not authorised

No `--apply`, no timer enable/start, no service restart, no `.env` change, no sudo, no push, no commit, no C5 step, no Brownlow operation, no cleanup, no quarantined-store access. Backups, releases, frozen P/H/EXEC, `.codex/`, archived source work and parked ISSUE-327 untouched. ISSUE-316 stays OPEN; D-316-13 is **consumed with a HALT result**; D-316-4 (C5) is not granted.

## 8. Reviewer acceptance: PENDING (owner's)

Measured outcome recorded here: **HALT, exit 1, restored and verified, zero canonical writes.** The reviewer's acceptance of that evidence, and any decision on the gate fix and a new C4b grant, are not recorded and are not this session's to record.

## 9. Follow-up (same day, 2026-11-02): defect fixed locally, rerun prepared (this record is not edited above)

The sections above are the record of the first run and stand unchanged: **HALT, exit 1, restored and verified, zero canonical writes**. `result.json` (`25a53e87…c663`) is preserved as written and is not reinterpreted as CLEAR; the failed gate is not waived. D-316-13 (first grant) is consumed.

* **Defect fixed locally, not deployed:** `b08c8307` makes `dryRunHalts` consume the settle's numeric contract (`seasonFeedComplete` exactly `1` complete, `0` incomplete, anything else malformed), with the tests and the isolated e2e now driven by the real report formatter. Ten of the new cases fail against the old gate; Linux: units 728/728, C4b e2e 39/39. Details and the rollout: [c4b-gate-fix-rollout-and-rerun-2026-11-02.md](c4b-gate-fix-rollout-and-rerun-2026-11-02.md). Tracked under ISSUE-316 (no separate issue).
* **Launch error, precisely:** launch 1 exited 127 (`node: command not found`) because the non-login tmux shell had no node on PATH; the tool never started and nothing was written. The new launcher uses the absolute node path, an explicit PATH, and a tmux node probe that must pass before the tool is started.
* **Retained versus live feed (limitation 2 above):** the established facts (same count, status distribution, completeness, venue/team/round coverage, readiness REPOSITORY READY on the live feed) are in section 4 of the package; the field-level diff needs one read-only copy of the host snapshot and is open.
* **Still true:** the first run selected zero matches and exercised no `playerStats` or `matchRoster` path; those paths are not claimed verified, and the rerun will not exercise them either (no `CONCLUDED` 2027 match exists before 2027-03-17).

## Addendum (2026-11-02, after the HALT; the HALT record above is unchanged)

Limitation 2 is now measured, not guessed: the live feed differs from the retained pin only in `venue.name` on four matches (`UTAS Stadium` becomes `University of Tasmania Stadium`, same `providerId` `CD_V200`); no match added or removed and no status, date, team or round change, so the "likely status/timestamps" guess above was wrong. Detail: section 4 of [c4b-gate-fix-rollout-and-rerun-2026-11-02.md](c4b-gate-fix-rollout-and-rerun-2026-11-02.md) and `evidence/c4b-fix-r2-20261102/live-feed-comparison.json`.
