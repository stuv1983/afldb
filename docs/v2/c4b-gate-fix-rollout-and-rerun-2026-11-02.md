# ISSUE-316 C4b: gate-defect fix, checkout-only rollout and fresh D-316-13 rerun (prepared 2026-11-02)

**Status: PREPARED. NOT GRANTED. NOTHING PUSHED, DEPLOYED OR RUN ON PRODUCTION.** The first C4b run ended `HALT` ([outcome](block-c-c4b-outcome-2026-11-02.md)); that record, `result.json` and the host evidence directory `c4b-ea98a35f-r1` stay exactly as they are. Everything below was done on the workstation and on the DEV host (streamanator, a disposable guarded cluster). No provider request, no production contact, no switch change, no restart, no push, no C5.

## 1. Verdict: the smallest rollout

**A checkout-only, pinned fast-forward of `/home/arm/projects/afldb` from `ea98a35f` to `N` (the pinned package commit), then one fresh C4b run.** No application build, no release promotion, no restart. `N` differs from `ea98a35f` in exactly three executable files and one test file; `src/`, `packages/`, `deploy/`, `data/`, dependencies, lockfile, framework and TypeScript config and every other tool are byte-identical (enforced by `evidence/c4b-fix-r2-20261102/static-delta-check.sh`, section 5). The serving release `ea98a35f2061--vY0EFS0DdR-TiPkxTZz6` runs from `/home/arm/afldb-releases/current`, not from the checkout, so it cannot notice the update; the rollout proves that live (P-A before, D2 after: same MainPID 3268373, NRestarts, ActiveEnterTimestamp, `.env` stat, release pointers, health 200). The same mechanism served the GAP-006 repair-tool rollout on 2026-11-01 ([record](gap006-repair-tool-rollout-package.md) section 9).

No application rebuild is needed because no application input changed. The existing application and build qualification is reused unchanged: the corrected Linux qualification of 2026-11-01 ([master sequence 8.2](master-execution-sequence-2026-11-01.md): both production-mode builds and standalone boots passed) and the release `ea98a35f2061--…` already built, verified and serving.

## 2. The defect and the fix (tracked under ISSUE-316; no separate issue)

**Defect.** `tools/current-season/afl-api-c4b-rehearsal.ts` `dryRunHalts` halted unless the settle dry-run report line `seasonFeedComplete:` read the text `true`. The real producer is numeric: `src/lib/acquisition/settle-afl-api.ts` `counters.seasonFeedComplete = bundle.seasonFeed.complete ? 1 : 0`, printed by `counterLines` in `tools/current-season/settle-afl-api.ts` as `  seasonFeedComplete: 1`. So the passing value `1` was rejected. The unit fixture (`DRY_OK`) and the isolated e2e both printed a hand-written `seasonFeedComplete: true`, so 36/36 and the unit suite could not see it.

**Producer contract (verified, not assumed).** Every counter is a number (`AflApiSettleCounters`, `src/lib/acquisition/settle-afl-api.ts:304`). `seasonFeedComplete` is `1` complete, `0` incomplete. The only consumers of the report text are `dryRunHalts` and the human reader; the reconciliation-report JSON (`packages/acquisition/src/reconciliation-report.ts`) carries the same number and is not parsed by C4b. No supported producer emits `true`/`false`, so none is accepted.

**Fix (`b08c8307`, revision F).**

| Piece | Change |
|---|---|
| `dryRunHalts` | `seasonFeedComplete` must be exactly `1`. `0` halts as incomplete. Absent halts as absent evidence. Anything else (`true`, `false`, `2`, `01`, `1.0`, empty) halts as malformed. No truthiness. The counter lines are matched on one line only (`[ \t]`, not `\s`), so a blank value can never capture the next line. `canonicalRowsInserted`/`canonicalRowsUpdated` are unchanged: exactly `0`, missing halts, malformed halts. |
| `settle-afl-api.ts` | `counterLines` is exported (one keyword and one comment line). Behaviour is identical; the tests and the e2e driver now build the dry-run report with this REAL formatter. |
| `tests/afl-api-cutover.test.ts` | `DRY_OK` and every dry-run output come from `counterLines` over typed counters. New cases: complete feed with zero writes passes; incomplete (0); missing completeness line; malformed (`true`, `2`, `01`, ...); missing and malformed canonical counters; an incomplete feed turns the setting on, restores it, and restores before `result.json`. |
| `tools/v2/c4b-isolated-e2e.mts` | Synthetic settle output now from `counterLines`; S5 uses the real `0`; new S5b (missing), S5c (the old `true`), S5d (missing canonical counter). 36 checks became 39. |

## 3. Qualification

| Check | Result |
|---|---|
| New tests against the OLD gate (`R` tool, `F` tests) | **10 fail** ([old-gate-failures.txt](evidence/c4b-fix-r2-20261102/old-gate-failures.txt)), including the success path with the real report. The regression is real |
| Same tests with the fix, Windows (`afl-api-cutover`, `afl-api-settle-cli-gate`, `afl-api-ingestion-safety`) | 3 files, **726 passed, 2 skipped** |
| Typecheck, Windows (`node node_modules/typescript/bin/tsc --noEmit --incremental false`, edited files confirmed in the program) | exit 0, no output |
| Linux (streamanator, Node v22.23.2, workspace `/mnt/ssd/afldb-c4b-fix-qual-20261102T055414Z`, shallow clone at `b08c8307`, candidate tar sha256 `e776cfd4…5c1b` verified on both ends, `package-lock` prefix `984b4422…` unchanged by `npm ci`) | typecheck **PASS**; the same 3 suites **728 / 728, 0 skipped** (the POSIX-only cases ran); a fresh guarded cluster (loopback 55494, listener owned by the postmaster we started), a fresh disposable database migrated from scratch to ledger **118** (`118_fixtures_unconfirmed_participants.sql`); **C4b end-to-end 39 / 39** (real writer, real control-path reader, real detached watchdog process, parent SIGKILL rescued, restore loop, refusals) |
| Launcher (`run.sh launch`) | `--probe-only` on Linux: node ran inside a non-login tmux shell (`v22.23.2 /home/arm/.nvm/versions/node/v22.23.2/bin/node`, exit 0), the tool was not started; refused on a wrong HEAD (exit 3) and off production (exit 3). Negative control in tmux with a bad PATH: bare `node` fails (`No such file or directory`), the absolute-path form prints `v22.23.2` |
| Static delta check | positive PASS; three negative controls FAIL as they must (N = the production checkout; a non-existent object; an unrelated old commit) |

Isolation facts: DEV `afldb.service` (MainPID 1162113) and `postgresql@16-main` (1504) were active and unchanged before and after; no listener remains on 55494 or 3199; nothing existing was touched or deleted; the workspace is retained (1.5 GB). One finding, not a defect: scenario S10 (permanent restore failure) deliberately leaves its detached watchdog retrying for up to an hour (`WATCHDOG_GRACE_MS` 2 min + `WATCHDOG_GIVE_UP_MS` 60 min) against a database that has since been stopped; the final phase listed it. After confirming its full command line (`--watchdog … s10-restore-permanent`, inside the workspace) I terminated that single process; nothing else of ours remained. Evidence copy: [linux-qualification/](evidence/c4b-fix-r2-20261102/linux-qualification/).

**Not reproducible in isolation (unchanged from the 2026-11-01 record):** real `systemd` unit state, the unit's `UnsetEnvironment=`, polkit, the provider's live response, production role grants. The first production run exercised exactly those and passed everything except this gate.

## 4. Retained feed versus the live capture (no provider request)

| | Retained (the pin) | Captured by the first run |
|---|---|---|
| File | `tests/fixtures/afl_api/seasons/01-season-matches-2027.raw.json` = snapshot `afl-api-2027-2026-11-01-012026` | `…/matches/afl-api-2027-2026-11-02-052722/00-season-matches.json` on the host |
| Bytes / sha256 | 266,389 / `21fd12e7…c84d` | 266,461 / `1a51317b…7ced` (**+72 bytes**) |
| Captured | 2026-11-01 01:20:26Z | 2026-11-02 05:27:23Z (HTTP 200, ETag `W/"0f1647b8…"`, `max-age=120`) |
| Matches | 218 | 218 |
| Status distribution | SCHEDULED 135, PLACEHOLDER 83 | SCHEDULED 135, PLACEHOLDER 83 (the settle's own season-feed assessment) |
| Completeness | complete for `CD_S2027014` | complete for `CD_S2027014` |
| Readiness | REPOSITORY READY | REPOSITORY READY (`readiness.txt`): season identity `CD_S2027014`, 29 round-vocabulary rows, every venue mapped (19 distinct), every team mapped (40 distinct), every entry translates through `afl_api_2027` |

**MEASURED (recorded after `N`, 2026-11-02; supersedes the earlier text of this section, which inferred "no relevant change" from matching aggregates and was an overstatement).** The captured file was copied read-only from the host (one `scp`, no provider request; sha256 verified `1a51317b…7ced`, 266,461 bytes) to `D:\tmp\afldb-c4b-live-feed-20261102\` and compared offline with `compare-season-feeds.mjs` against the retained copy (`21fd12e7…c84d`; three byte-identical copies exist). Report: [live-feed-comparison.json](evidence/c4b-fix-r2-20261102/live-feed-comparison.json).

| Dimension | Result |
|---|---|
| Top-level keys, `meta` (code 200, `numPages` 1, `pageSize` 1000, `numEntries` 218) | identical |
| Match-id set (218 each, no duplicate keys) | identical: **0 added, 0 removed** |
| Status (per match and distribution) | **0 changes** (SCHEDULED 135, PLACEHOLDER 83 on both) |
| Dates / times (`utcStartTime` and every other date-like leaf) | **0 changes** |
| Teams (identity of home and away, 40 distinct) | **0 changes** |
| Rounds | **0 changes** |
| Structural (fields on one side only, array length changes) | **0** |
| Venues | **4 matches changed, one leaf each, `venue.name` only**: `CD_M20270140807` (R8 Hawthorn v GWS GIANTS, SCHEDULED), `CD_M20270141103` (R11 Hawthorn v St Kilda, SCHEDULED), `CD_M20270141805` (R18 Hawthorn v Gold Coast SUNS, PLACEHOLDER), `CD_M20270142107` (R21 Hawthorn v Sydney Swans, PLACEHOLDER): `"UTAS Stadium"` becomes `"University of Tasmania Stadium"` |

The whole 72-byte difference is those four renames (4 x 18 bytes). `venue.id` (4), `venue.providerId` (`CD_V200`), `abbreviation` (`UTAS`), `location`, `state`, `timezone` and `landOwner` are unchanged, so it is one venue relabelled by the provider, not a different venue. Distinct venues 19 and teams 40 on both sides.

**Why the rename cannot reach the C4b result or a canonical row (read from the code, not assumed):** every venue is resolved by `venue.providerId` through `afl-api-identities.json` (`afl-api-cutover-readiness.ts` `ids.venues.get(providerId)`, `afl-api-bundle.ts` `resolveVenue`); the feed `name` is used only as a label in an unmapped-venue message and as `venueRaw` in the bundle projection, which nothing downstream consumes. The fixture writer writes `venue_raw` from the resolved venue's canonical name, not from the feed. The rehearsal does not compare the live feed with the pin; it gates on completeness, coverage and zero canonical writes, and the match settle selects `CONCLUDED` only (`selected: 0`). **Residual:** a later fixture refresh would see no venue change on these four matches for the same reason. Neither feed is rewritten, no fixture is repinned, no production fixture is updated.

## 5. The qualified source delta (`static-delta-check.sh`, run on the workstation and again on production from `N`'s own bytes in D1)

| Fact | Value |
|---|---|
| Production checkout `PROD_HEAD` | `ea98a35f20610e75c18e698bc0d9fe084c3c783d` (R of the first grant; clean; also `origin/main` as last fetched) |
| Fix `F` | `b08c83070d4a08bdb3bd492983abf2acb1b10547` |
| Ancestry | `PROD_HEAD` → `F` → `N`; the push and the production update are fast-forwards. `PROD_HEAD..F` is 7 commits: six documentation commits (Blocks M-a/M-b/B/Brownlow/C3, already recorded) and the fix |
| `PROD_HEAD..N` outside documentation, ledgers, changelog and tests | **exactly** `tools/current-season/afl-api-c4b-rehearsal.ts`, `tools/current-season/settle-afl-api.ts`, `tools/v2/c4b-isolated-e2e.mts` |
| `PROD_HEAD..N` inside `tests/` | exactly `tests/afl-api-cutover.test.ts` |
| `PROD_HEAD..N` on `src`, `packages`, `deploy`, `data`, `package.json`, `package-lock.json`, `next.config.ts`, `tsconfig.json` | **empty**; also empty on every other tool, `src/db/migrations`, `scripts`, `public`, `.gitignore`, `.gitattributes` |
| `F..N` outside documentation, ledgers, changelog | **empty** (the package commit adds records and scripts only) |
| Blobs | C4b tool `e3ac2926…` → `cdf76a67…` (sha256 `e7464d58…6348`); settle tool `c8d53c6f…` → `c97f0cdc…` (sha256 `06d69848…b77d`); e2e driver `4e73363d…` → `61b3791b…`; cutover suite `0513d8ca…` → `765c13c4…` |
| Settle tool change | numstat 2 / 1: `function counterLines` → `export function counterLines` plus one comment line. Nothing else |
| Runtime dependencies | `afl-api-ingestion-control`, `afl-api-ingestion-safety`, `afltables-network`, `site-settings`, `settle-afl-api` (src), `settle-core`, `afl-api-cutover-readiness`, `load-env`, `acquire-afl-api`, `seasons.json`, `afltables-network.json`: all blob-identical at `PROD_HEAD` and `N` |
| Producer, in the unchanged dependency | `counters.seasonFeedComplete = bundle.seasonFeed.complete ? 1 : 0;` present at `N` |

`c-prod.sh` (sha256 `ec839a47…d496`) is unchanged and takes the revision as an argument, so `c4b-pre` and the later `c5-pre` run unmodified with `N`.

Pushing `N` publishes the six already-recorded documentation commits with it (it is `origin/main`'s fast-forward). That is the owner's decision at D0.

## 6. Variables, and who does what

`N` is the pinned package commit (the last commit before the approval record). A commit cannot contain its own hash, so `N` is stated in the approval (section 8, and `c4b-r2-approval-<N8>.md`) and equals `git rev-parse` of the pushed object. Every script refuses anything that is not 40 lowercase hex.

```bash
# workstation (Git Bash)
N=REPLACE_WITH_40_HEX_N
PKG=docs/v2/evidence/c4b-fix-r2-20261102
# production, as arm: paste at the start of EVERY production call
N=REPLACE_WITH_40_HEX_N
PKG=/home/arm/projects/afldb/docs/v2/evidence/c4b-fix-r2-20261102
EVD=/home/arm/backups/afldb/c4b-<first 8 of N>-r2          # the new evidence directory (must not exist); the old c4b-ea98a35f-r1 is preserved
```

| Step | Who | Authority |
|---|---|---|
| W0 workstation static check | Claude | local read-only Git |
| D0 push of exactly `N` | **Owner** (workstation) | fast-forward to `origin/main`, no force |
| P-A, D1, D2 (`rollout.sh pa / d1 / d2`) | Claude over SSH as `arm`, no sudo | read-only, then a checkout fast-forward (tracked files only); P-A writes one file `/home/arm/c4b-fix-rollout-pre.txt` |
| Step A (`run.sh step-a`) | Claude over SSH as `arm` | one new mode-600 feed copy; `c-prod.sh c4b-pre` (read-only database session as `afldb_backup`) |
| **Launch** (`run.sh launch`) | **Claude over SSH as `arm`, only under the fresh D-316-13 grant, owner attending** | starts the tool once in one tmux session |
| Step C (`run.sh step-c`) | Claude over SSH as `arm` | read-only |
| R-1 (`rollout.sh r1`) | Claude, only after a failed D2 | restores the checkout to `ea98a35f` |

Transport: Windows OpenSSH (`C:\Windows\System32\OpenSSH\ssh.exe`), host alias `afldb`, user `arm`. Copy each script to the host (`scp`) and run it by path; never `bash -c "$(…)"`, and not through PowerShell argument quoting.

## 7. Procedure

**W0 (workstation, Claude).**

```bash
( set -euo pipefail; [[ $N =~ ^[0-9a-f]{40}$ ]]; cd /d/dev/afldb
  git cat-file -e "$N^{commit}"
  [ -z "$(git status --porcelain | grep -v '^?? \.codex/$' || true)" ]       # clean apart from untracked .codex/
  bash "$PKG/static-delta-check.sh" "$N"                                     # prints PASS or exits 1
  [ "$(git ls-remote origin refs/heads/main | cut -f1)" = ea98a35f20610e75c18e698bc0d9fe084c3c783d ]   # nobody pushed since
  echo "W0 PASS" )
```

**D0 (owner, workstation).** Pushes exactly `N` (not HEAD): `git push origin "$N:refs/heads/main"`, then `git ls-remote origin refs/heads/main` must print `N`. Commits after `N` (the approval record, the outcome record) stay local.

**P-A** `bash rollout.sh pa $N`: host/user; checkout is exactly `ea98a35f` and clean; both tool blobs are the recorded old blobs; no C4b/settle/acquire process and no c4b tmux session; both services `loaded`/`inactive`, both timers `disabled`/`inactive`, the AFL Tables timer not enabled/active; `current`/`previous` are the recorded releases, no lock; the unit's `WorkingDirectory` is the release `current`, the drop-in is listed, the main process's `/proc/<pid>/cwd` is the serving release, no process of the unit's cgroup has its working directory inside the checkout; `release.mjs status` and `verify` pass; health 200; the first run's `result.json` is unchanged (`25a53e87…c663`, `"verdict": "HALT"`) and its captured live feed is `1a51317b…`; pinned node v22.23.2 present; 1 GiB free; records PID, NRestarts, ActiveEnterTimestamp, `.env` stat, the evidence listing hash and the snapshot manifest hash.

**D1** `bash rollout.sh d1 $N`: `git fetch origin`; `origin/main` must equal `N`; the static delta check runs again from `N`'s own bytes; `git merge --ff-only N`.

**D2** `bash rollout.sh d2 $N`: checkout is `N`, clean, tree equals `N`; both tool blobs and sha256 are the pinned new bytes; no `src`/`packages`/`deploy`/`data`/dependency path moved; release pointers, MainPID, NRestarts, ActiveEnterTimestamp and `.env` stat unchanged; units still inert; health 200; the first run's evidence directory and snapshot are byte-for-byte as recorded.

**Step A** `bash run.sh step-a $N $EVD`: checkout exactly `N` and clean; `c-prod.sh` equals its pin; the pinned feed copy (`git show N:tests/…/01-season-matches-2027.raw.json`, mode 600, sha256 `21fd12e7…c84d`) in `/home/arm/c4b-r2-<N12>/`; the evidence directory absent and its parent writable; tmux present, no c4b session; MainPID 3268373; then `c-prod.sh c4b-pre N <feed>` must end `C4B-PRE PASS` (ledger 118 and digest, switch absent/false, units installed and inert, AFL Tables timer disabled, before the first 2027 match, feed pin, register exactly `[2027]`, switch retired, readiness REPOSITORY READY).

**Launch** `bash run.sh launch $N $EVD`: re-checks the checkout and `C4B-PRE PASS`; **probes node inside tmux** with the same wrapper (absolute node, explicit PATH, non-login shell) and refuses to start the tool if it does not print `v22.23.2 /home/arm/.nvm/versions/node/v22.23.2/bin/node` with exit 0; then starts, in one tmux session `c4b-<N8>-r2`:

```text
/usr/bin/env PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:/usr/local/bin:/usr/bin:/bin \
  /home/arm/.nvm/versions/node/v22.23.2/bin/node node_modules/tsx/dist/cli.mjs tools/current-season/afl-api-c4b-rehearsal.ts \
  --season 2027 --decision D-316-13 --evidence-dir $EVD --max-minutes 30 > /home/arm/c4b-r2-<N12>/c4b-run.log 2>&1; echo $? > /home/arm/c4b-r2-<N12>/c4b-run.exit
```

The previous `exit 127 / node: command not found` cannot recur: the node path is absolute, the PATH is explicit, and the probe runs first. Exit 0 = CLEAR; 1 = HALT (stop, report, no retry without a new decision); 2 = refused before any write; 3 = restoration not verified: immediately `node node_modules/tsx/dist/cli.mjs tools/current-season/afl-api-c4b-rehearsal.ts --restore-only --evidence-dir $EVD` (with the same explicit node and PATH) and confirm the setting reads `false` before anything else. **The tool is never started a second time whatever the result.**

**Step C** `bash run.sh step-c $N $EVD`: read-only: exit code, HEAD and porcelain, MainPID/NRestarts/ActiveEnterTimestamp against step A, units, the evidence listing and hashes, `result.json`, snapshots, tmux, the setting (read-only session), the audit rows for `afl-api-c4b-rehearsal`, canonical counts. The reviewer named in the grant records the C4b verdict from the evidence directory; C5 needs a `CLEAR` `result.json` and its own approval (`c5-pre N <EVD>`).

**R-1** `bash rollout.sh r1 $N`: only if D2 fails after the fast-forward, the checkout is exactly `N` and clean: `git reset --hard ea98a35f`. The service is not involved. Anything else is the owner's decision.

**Feed comparison (DONE 2026-11-02, result in section 4; kept for reproduction).** One file copied from the host to the workstation, then compared offline:

```bash
mkdir -p /d/tmp/afldb-c4b-live-feed-20261102 && /c/Windows/System32/OpenSSH/scp.exe \
  afldb:/home/arm/projects/afldb/data/sources/afl_api/matches/afl-api-2027-2026-11-02-052722/00-season-matches.json \
  /d/tmp/afldb-c4b-live-feed-20261102/00-season-matches.json
sha256sum /d/tmp/afldb-c4b-live-feed-20261102/00-season-matches.json        # must be 1a51317b514b53c2d7261d23f506c92af6e0dbaff29c4a969e1281b19e2b7ced
node docs/v2/evidence/c4b-fix-r2-20261102/compare-season-feeds.mjs \
  tests/fixtures/afl_api/seasons/01-season-matches-2027.raw.json \
  /d/tmp/afldb-c4b-live-feed-20261102/00-season-matches.json --out /d/tmp/afldb-c4b-live-feed-20261102/comparison.json
```

This is independent of the rollout and can be done before or after it.

## 8. Stop conditions

Stop, do not adjust an expected value, report: any W0/P-A/D1/D2/Step A assertion fails; `origin/main` is not exactly `ea98a35f` before D0 or not exactly `N` at D1; the checkout is not `ea98a35f` clean at P-A; the unit's working directory or any process of its cgroup is inside the checkout (the independence claim would be false and this package would not apply); a release pointer, lock, `release.mjs status/verify` or health is not as recorded; the first run's evidence or captured feed changed; `c4b-pre` is not `C4B-PRE PASS`; the tmux node probe fails; the evidence directory exists; anything would require `sudo`, a restart, `--apply`, or a second start of the tool.

## 9. What the rerun will and will not prove

The 2027 season has no `CONCLUDED` match before 2027-03-17, so the rerun, like the first run, will **select zero matches**. It will therefore **not exercise any `playerStats` or `matchRoster` request, any player-level row, any observation, any derived recompute or the apply path**, and it **does not claim they passed production verification**. A `CLEAR` would prove: the gate now agrees with the producer on production; the season feed is fetched and assessed complete; the dry run writes nothing canonical; the switch is turned on for the run, restored, and verified; BEFORE equals AFTER; units and timers stay inert; readiness holds on the acquired feed. Sustained rate behaviour is not observed (two provider requests: token and season feed). The Brownlow baseline `43300297…821d` is already void from the first run; a second run adds two `auth_audit_log` rows and two `site_settings` upserts, and nothing pending depends on it. The Brownlow public-rendering check stays an unverified owner-led follow-up.

Left on the host by the rerun (named, never deleted by the tool): the new evidence directory, a second snapshot directory under `data/sources/afl_api/matches/` (git-ignored, about 0.3 MB; the first is `afl-api-2027-2026-11-02-052722`), and `/home/arm/c4b-r2-<N12>/` (feed copy, logs).

## 10. Not authorised and not done

No push, no production access, no provider request, no rehearsal retry, no switch change, no restart, no `.env` edit, no timer or unit change, no C5, no grant, no cleanup, no deletion of the first evidence directory or snapshot. Backups, frozen P/H/EXEC, the quarantined store, `.codex/`, archived source work and parked ISSUE-327 untouched. ISSUE-316 stays open. D-316-4 (C5) is not granted and is not described beyond what `c5-pre` enforces.

## 11. The approval (one block; the filled copy with `N` is `c4b-r2-approval-<N8>.md` and the final message)

```text
I approve the ISSUE-316 C4b gate-fix rollout and a fresh run, as written in
docs/v2/c4b-gate-fix-rollout-and-rerun-2026-11-02.md, at N=<N>:
 (1) I will push exactly N to origin/main (fast-forward from ea98a35f20610e75c18e698bc0d9fe084c3c783d);
 (2) Claude may run, as arm over SSH on afldb-prod without sudo, rollout.sh pa, d1 and d2 exactly as written, which fast-forward the
     checkout /home/arm/projects/afldb from ea98a35f20610e75c18e698bc0d9fe084c3c783d to N (a checkout-only update: no build, no promotion,
     no restart; serving release ea98a35f2061--vY0EFS0DdR-TiPkxTZz6 untouched), and rollout.sh r1 only after a failed d2;
 (3) I grant D-316-13 afresh: run the C4b D1 rehearsal for season 2027 on afldb-prod at revision N with the evidence directory
     /home/arm/backups/afldb/c4b-<N8>-r2, reviewed by <name>; I am attending. Claude may run run.sh step-a, launch and step-c exactly as
     written; launch starts the tool ONCE. The first D-316-13 grant is consumed (its run ended HALT; evidence c4b-ea98a35f-r1 stays).
Claude must not: start the tool a second time under any result, run it with --apply, change the switch other than through the tool, use
sudo, restart or reload any unit, enable or start any timer, edit .env, touch the release root, a grant, a backup or the first evidence
directory or snapshot, make any provider request outside the tool's own, push anything, or continue past a failed check. This does not grant
D-316-4 (C5) or any other decision.
```

The owner supplies `<name>` (the evidence reviewer) and may change the evidence-directory name; it must not exist and must be outside the checkout.

## 12. Preparation record (workstation and DEV, 2026-11-02, local only)

Fix `b08c8307` committed locally (not pushed). Windows: focused suites 726 passed / 2 skipped, typecheck exit 0. Old-gate control: 10 failures. Linux: typecheck, 728/728 units, C4b e2e 39/39, launcher probe and refusals. Static delta check positive plus three negative controls. Scripts `bash -n` clean. No SSH to `afldb-prod`, no provider request and no database contact from the workstation. Live-checked only on streamanator, on a disposable cluster. **Not verified live (by design; P-A does it):** the production checkout's present state, the installed unit's drop-in, the serving process's working directory, tmux on production (it worked on 2 Nov), and the captured live feed's contents.
