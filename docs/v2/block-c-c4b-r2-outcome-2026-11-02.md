# ISSUE-316 C4b rerun r2: outcome (2026-11-02): CLEAR, awaiting reviewer acceptance

**Verdict recorded by the tool: `C4B CLEAR` (exit 0).** The evidence reviewer (Stuart) has **not yet accepted** it; no acceptance is recorded here. C5 (D-316-4) is not granted and not started.

| Item | Value |
|---|---|
| Grant | D-316-13 afresh, at `N` = `924ff273261834e4112e3f41b61ceeab55427534`; owner attending; reviewer Stuart. The first grant is consumed (its run ended HALT; `c4b-ea98a35f-r1` and its snapshot are unchanged, see below) |
| Push | owner pushed exactly `N` to `origin/main` (`ea98a35f..924ff273`); later local commits not pushed |
| Rollout (as `arm`, no sudo, checkout-only) | `rollout.sh pa` PASS (08:35:53Z), `d1` PASS (fast-forward `ea98a35f` to `N`), `d2` PASS (08:36:21Z; tool blobs `e3ac2926…` to `cdf76a67…`, `c8d53c6f…` to `c97f0cdc…`). The three pinned scripts were taken from `N`'s bytes (hash-checked) to `/home/arm/c4b-r2-stage-924ff273/` for `pa`, as the approval prescribes, because the old checkout did not yet hold them |
| Step A | `STEP-A PASS` / `C4B-PRE PASS` (08:36:38Z): checkout exactly `N` and clean; `afldb_prod`, OID 66668 and system identifier 7674454702926115004 (pinned in `c-prod.sh`), read-only session; ledger 118; switch `false`; units inert; AFL Tables timer disabled; before the first 2027 match; feed pin `21fd12e7…c84d`; readiness REPOSITORY READY |
| Launch | once, 08:37:20Z, tmux `c4b-924ff273-r2`; node probe inside tmux PASS (`v22.23.2 /home/arm/.nvm/versions/node/v22.23.2/bin/node`, 0). No second start. Restore-only was not needed (exit 0) |
| Run | `run_id c4b-2026-11-02T083721874Z-3296445`; watchdog proven ready (pid 3296476) before the switch moved; switch ON 08:37:22.7Z; acquire (token + season feed, **two provider requests**) `season feed: 218 match(es); selected: 0`; dry-run settle `--dry-run --auto-apply --require-complete-source`; switch OFF 08:37:24.4Z, `attempts: 1`, verified on the writer and the control path; `result.json` `CLEAR` |
| Real producer line | `seasonFeedComplete: 1` accepted by the fixed gate on production (the defect that HALTed run 1) |
| Write-path counters (the settle's own report) | `canonicalRowsInserted 0`, `canonicalRowsUpdated 0`, `canonicalApplicationsLogged 0`, refusals and failures 0, observations/payloads/versions 0, derived recompute 0, candidates and data issues 0. **These are the tool's counters of what the dry run's write path did before it rolled back. They are not a check that anything was or was not retained**; the tool's closing line says the dry run retained nothing, "not even the import_batches row", which is the tool's statement, independently read back only later (see the addendum) |
| `before.json` / `after.json` | byte-identical (sha256 `15cc09f9…3849`). They cover **canonical rows and the switch only**: 0 matches in 2027, 0 afl_api-owned matches, switch `false`. They say nothing about `import_batches`, staging observations or files on disk |
| Switch | `setting=[false]` read independently by `step-c` (read-only session, identity ok). Audit rows 303 (on) and 304 (restore, attempt 1), run_id above |
| Units / timers | both settle services loaded, inactive; match and Brownlow timers disabled/inactive; AFL Tables timer disabled/inactive |
| Serving process | MainPID 3268373, NRestarts 0, ActiveEnterTimestampMonotonic 6739446504275: all as before; `.env` stat `600:arm:4067:1786877149` unchanged; releases `current`=`ea98a35f2061--vY0EFS0DdR-TiPkxTZz6`, `previous`=`fd48ace0c2cb-pqAQwRIJWLjSYzR8LiTuy`; `/api/health` 200; no tmux server, no c4b/settle/acquire process |
| Checkout | HEAD `N`, porcelain 0 |
| First-run evidence | `c4b-ea98a35f-r1` listing hash `07d5c4ed…c7699`, `result.json` `25a53e87…c663` (HALT), snapshot `afl-api-2027-2026-11-02-052722` manifest `9525f057…1a27` and feed `1a51317b…7ced`: all identical to the pre-run values |
| New host files (named, nothing deleted) | evidence `c4b-924ff273-r2`; snapshot `data/sources/afl_api/matches/afl-api-2027-2026-11-02-083723` (git-ignored; includes `token.meta.json`, not copied here); `/home/arm/c4b-r2-924ff2732618/`; `/home/arm/c4b-r2-stage-924ff273/`; `/home/arm/c4b-fix-rollout-pre.txt` |

Local copy of the evidence (no token file): [evidence/c4b-r2-20261102/](evidence/c4b-r2-20261102/) (`host-evidence/` is the evidence directory verbatim; `step-c.txt`, `rollout-pre.txt`, `c4b-pre.txt`, `c4b-run.exit`, `snapshot2-manifest.json`).

## Findings

1. **LOW, informational: the second capture equals the pin.** The r2 season feed is sha256 `21fd12e7…c84d` (266,389 bytes), byte-identical to the retained fixture. The first run's capture (`1a51317b…`) differed only by the `UTAS Stadium` / `University of Tasmania Stadium` label on four matches (governing document, section 4). The provider's label is therefore not stable between requests; venues resolve by `providerId`, so there is no effect.
2. **LOW, `run.sh step-c` (two defects; both resolved in the addendum below):** (a) its last read, `SELECT count(*), max(created_at) FROM import_batches …`, is invalid: `import_batches` has `started_at`, not `created_at` (`ERROR: column "created_at" does not exist`); (b) **the script printed `STEP-C DONE` after that SQL error**, because it never checked a query's exit status, so a required read failed without failing the step. The first run's step-c had the same shape. The pinned script on production (in `N`) was not edited. Original failed output is preserved unchanged in `evidence/c4b-r2-20261102/step-c.txt`.
3. No CRIT, HIGH or MED finding. Nothing was waived, retried or worked around.

## What this CLEAR proves, and does not

Proves: the corrected gate agrees with the real producer on production; the season feed is fetched and assessed complete (218, CD_S2027014); the dry run writes nothing canonical; the switch is turned on for the run, restored and verified; BEFORE equals AFTER; units and timers stay inert; the serving process is untouched; readiness holds on the acquired feed.

**Season-feed-only limitation.** A CLEAR with zero selected matches does **not** prove `playerStats` or `matchRoster` requests, player-level processing, canonical apply, or sustained provider-rate behaviour (two requests were made). The 2027 season has no `CONCLUDED` match before 2027-03-17.

## Addendum (2 Nov, 20:04-20:20 AEDT): independent read-back, step-c correction, C5 survey

Authority: the owner's message of 2 Nov allowed targeted read-only production checks as `arm`; nothing else. The historical logs, `result.json` and `step-c.txt` were not altered.

**Read-back of the run's own identifiers** (`run_id c4b-2026-11-02T083721874Z-3296445`, snapshot `afl-api-2027-2026-11-02-083723`, fixed instants T0 `08:37:21.874Z` to T1 `08:37:24.585Z`, no moving window). Script `evidence/c4b-r2-readback-20261102/readback.sh` (sha256 `e14c2ed1…0997`, read-only session as `afldb_backup`, identity `afldb_prod`/66668); full output `readback-output.txt`; ends `READBACK CONSISTENT`, 0 failed queries, 0 unexpected values (read at 09:04Z).

| Question | Evidence (what it proves) |
|---|---|
| Why did the query fail? | `import_batches` columns are `id, source_id, tool, target_table, started_at, completed_at, status, records_*, validation_result, error, notes`: no `created_at` (0 columns of that name, 1 `started_at`) |
| **Batch bookkeeping**: does any `import_batches` row remain? | 0 rows started in `[T0,T1]`; 0 started at or after T0; 0 whose `notes`/`validation_result`/`error`/`tool` name the label or the run id; 0 unfinished. The newest batches are 72-75 (13:25-14:28 AEDT), all before the run. **Proves: no batch row persists now.** It cannot tell "never inserted" from "inserted then rolled back" |
| Identity sequence | `import_batches_id_seq` last_value 77, `max(id)` 75: two ids were consumed with no retained row. **Consistent with** the two C4b dry runs (r1 and r2) each rolling back one batch insert, but not attributable to either run by this read, and it does not prove it |
| **Staging observations / durable acquisition rows** | 0 rows referencing any batch started at/after T0 in `source_record_versions`, `source_records`, `promotion_candidates`, `canonical_applications`, `import_rejections`; and 0 rows by their own timestamps (`source_payloads.first_stored_at`, versions `observed_from`/`observed_to`, records `first_seen`/`last_seen`/`absent_since`, candidates, decisions, `data_issues`, `canonical_applications.applied_at`) at/after T0; 0 `afl_api_match` rows for `CD_S2027014`; 0 `afl_api_player_match` rows for 2027. NULL-able columns (`observed_to`, `absent_since`, `resolved_at`, `closed_by_batch_id`) were only compared with `>=`/`IN`, so a NULL is never counted as inside the window |
| **Canonical rows** (a different check from the two above) | 0 `matches` in season 2027; 0 owned by source `afl_api` |
| Switch and audit | `site_settings` row present, value `false`, `updated_by` NULL (written by the rehearsal tool, not the admin panel); exactly 2 audit rows for the run id (303 `on`, 304 `restore` attempt 1); 0 ingestion-switch rows after 304 |
| Files (not covered by any database rollback) | The snapshot directory `data/sources/afl_api/matches/afl-api-2027-2026-11-02-083723/` **exists by design** (git-ignored): `00-season-matches.json` `21fd12e7…c84d` (= the pin), `manifest.json` `1be355c6…816e`, `token.meta.json` (66 bytes, mode 600, content not read). The evidence directory still hashes to the 10 values step-c recorded |

**Corrected wording of the outcome.** The run's zero canonical-write counters, the byte-identical `before.json`/`after.json` (canonical + switch only) and the tool's "rolled back" message each prove a different, narrower thing than "nothing was left behind". What proves *import-batch, staging and canonical non-retention* is the independent read-back above (taken ~27 minutes after the run). What the dry run is *not* shown to have left is limited to: the retained snapshot directory (intended) and one rolled-back sequence value (inferred).

**`run.sh step-c` correction (local only; production's pinned scripts and revision are unchanged).** `evidence/c4b-fix-r2-20261102/run.sh` (sha256 before `e079945a…80d9`, the bytes pinned in `N` and in the approval; after `63efb292…637a6`) now: runs every required read through a wrapper that counts a non-zero exit or an `ERROR:` line; reads the setting with an exit check (the old `$(setting_raw)` could not stop the parent); replaces the invalid query with `started_at >= <run start parsed from result.json's run_id>` (refuses if no usable run id, so an unanchored query cannot silently count 0); and ends `STEP-C FAILED` with exit 1 instead of `STEP-C DONE` when anything failed. Negative control `evidence/c4b-r2-readback-20261102/stepc-negative-control.sh` (sha256 `1bc58445…`) extracts the real `step-c)` branch of each script and runs it in a sandbox with a stub `q` that behaves like psql under `ON_ERROR_STOP`: **`STEPC NEGATIVE CONTROL PASS`** (fixed script: success case exits 0 with DONE; failing `import_batches` read exits 1 with FAILED and no DONE; failing setting read exits 1; missing run id exits 1; and the **original** script, given the same failure, still prints DONE and exits 0, reproducing the defect). The read-back helper's own wrapper was also negatively controlled on production, read-only: the invalid `created_at` query ran through it and ended `NEGATIVE CONTROL PASS` (failure counted, verdict non-zero). No rollout and no C4b rerun is needed for any of this; the corrected `run.sh` reaches production only if a later `N'` is rolled out.

**C5 survey.** See [block-c-c5-owner-attended-procedure-2026-11-02.md](block-c-c5-owner-attended-procedure-2026-11-02.md) section 2. All read-only checks held (`C5 PREP CONSISTENT`, 0 failures, 0 unexpected values). One defect of the survey script itself was found and fixed on the way (its phase matcher required the whole `C5-PRE PASS` line; run 1 is kept as `c5-prep-output-run1-matcher-defect.txt`; it was not a production finding).

## Next: C5 (D-316-4), proposed approval text for the owner (not granted; reviewer acceptance not recorded)

**Superseded by the procedure document above** (which carries the final wording for both Stuart's evidence acceptance and the C5 approval); the text below is the earlier draft, kept unchanged.

Package: [block-c-execution-package-2026-11-02.md](block-c-execution-package-2026-11-02.md) section 7. Preconditions: Stuart records acceptance of this evidence; before 2027-03-17T00:00Z; Brownlow timer disabled; no `AFLDB_SETTLE_TRIGGER` line in `.env` yet. `R` is the production checkout, now `N`.

```text
I, Stuart, have reviewed the C4b r2 evidence at /home/arm/backups/afldb/c4b-924ff273-r2 (result.json CLEAR, run
c4b-2026-11-02T083721874Z-3296445) and accept it as the C4b PASS record: <date/time, or "with these conditions: ...">.
I approve the AFL API cutover go on afldb-prod at revision 924ff273261834e4112e3f41b61ceeab55427534 as in
docs/v2/block-c-execution-package-2026-11-02.md section 7, on that C4b CLEAR record, including the one-line AFLDB_SETTLE_TRIGGER=systemd
configuration in /home/arm/projects/afldb/.env. Claude may run, as arm without sudo, only the read-only checks c-prod.sh c5-pre, c5-env and
c5-accept. I will run the sudo and restart steps myself (the polkit listing, the afldb restart, enabling afldb-settle-afl-api.timer only) and
will toggle the switch in the admin panel myself. Rollback is as written in section 7. The Brownlow timer and the AFL Tables timer stay
disabled. I am attending and no other operator will change production during the window.
```

C5 ends the validity of any earlier Block B baseline (it writes `site_settings` and `auth_audit_log`), as the package notes.
