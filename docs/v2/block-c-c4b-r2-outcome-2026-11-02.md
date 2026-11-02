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
| Canonical writes | `canonicalRowsInserted 0`, `canonicalRowsUpdated 0`, `canonicalApplicationsLogged 0`, refusals and failures 0, observations/payloads/versions 0, derived recompute 0, candidates and data issues 0; the dry run rolled back, "not even the import_batches row" retained. `before.json` and `after.json` are byte-identical (sha256 `15cc09f9…3849`: 0 matches in 2027, 0 afl_api-owned matches, switch `false`) |
| Switch | `setting=[false]` read independently by `step-c` (read-only session, identity ok). Audit rows 303 (on) and 304 (restore, attempt 1), run_id above |
| Units / timers | both settle services loaded, inactive; match and Brownlow timers disabled/inactive; AFL Tables timer disabled/inactive |
| Serving process | MainPID 3268373, NRestarts 0, ActiveEnterTimestampMonotonic 6739446504275: all as before; `.env` stat `600:arm:4067:1786877149` unchanged; releases `current`=`ea98a35f2061--vY0EFS0DdR-TiPkxTZz6`, `previous`=`fd48ace0c2cb-pqAQwRIJWLjSYzR8LiTuy`; `/api/health` 200; no tmux server, no c4b/settle/acquire process |
| Checkout | HEAD `N`, porcelain 0 |
| First-run evidence | `c4b-ea98a35f-r1` listing hash `07d5c4ed…c7699`, `result.json` `25a53e87…c663` (HALT), snapshot `afl-api-2027-2026-11-02-052722` manifest `9525f057…1a27` and feed `1a51317b…7ced`: all identical to the pre-run values |
| New host files (named, nothing deleted) | evidence `c4b-924ff273-r2`; snapshot `data/sources/afl_api/matches/afl-api-2027-2026-11-02-083723` (git-ignored; includes `token.meta.json`, not copied here); `/home/arm/c4b-r2-924ff2732618/`; `/home/arm/c4b-r2-stage-924ff273/`; `/home/arm/c4b-fix-rollout-pre.txt` |

Local copy of the evidence (no token file): [evidence/c4b-r2-20261102/](evidence/c4b-r2-20261102/) (`host-evidence/` is the evidence directory verbatim; `step-c.txt`, `rollout-pre.txt`, `c4b-pre.txt`, `c4b-run.exit`, `snapshot2-manifest.json`).

## Findings

1. **LOW, informational: the second capture equals the pin.** The r2 season feed is sha256 `21fd12e7…c84d` (266,389 bytes), byte-identical to the retained fixture. The first run's capture (`1a51317b…`) differed only by the `UTAS Stadium` / `University of Tasmania Stadium` label on four matches (governing document, section 4). The provider's label is therefore not stable between requests; venues resolve by `providerId`, so there is no effect.
2. **LOW, `run.sh step-c`:** its last read, `SELECT count(*), max(created_at) FROM import_batches …`, fails (`column "created_at" does not exist`). The script is pinned in `N` and was not edited. Covered instead by the tool's own counters (zero writes, dry run rolled back) and the 0 / 0 canonical counts. Not needed for C5.
3. No CRIT, HIGH or MED finding. Nothing was waived, retried or worked around.

## What this CLEAR proves, and does not

Proves: the corrected gate agrees with the real producer on production; the season feed is fetched and assessed complete (218, CD_S2027014); the dry run writes nothing canonical; the switch is turned on for the run, restored and verified; BEFORE equals AFTER; units and timers stay inert; the serving process is untouched; readiness holds on the acquired feed.

**Season-feed-only limitation.** A CLEAR with zero selected matches does **not** prove `playerStats` or `matchRoster` requests, player-level processing, canonical apply, or sustained provider-rate behaviour (two requests were made). The 2027 season has no `CONCLUDED` match before 2027-03-17.

## Next: C5 (D-316-4), proposed approval text for the owner (not granted; reviewer acceptance not recorded)

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
