# Packet 6R Amendment A1 — execution record, Wednesday 18 November 2026 (replacement window)

Records only. This file documents the approved packet 6R sitting (B1, B1a-0 option A, B1a) as executed under Amendment A1 in the
owner's replacement window. The approved block set (`../sitting-a1/`, `SHA256SUMS` sha256
`15aab2e5c46c5339dafdaf171922769185eeeede9a0907afd409019e416b4e66`, local commit `e3d00a91090008a06487bee3330b8e5cd7d53f94`) was used
unchanged. No hashed block encodes the window: the blocks only print `date -u`.

## 1. Approvals and window

| Item | Value | Source |
|---|---|---|
| Original approval | B1, B1a-0 option A, B1a; Wed 18 Nov 2026 10:00–12:30 AEDT | `../sitting-a1/SITTING.md` §1 |
| A1 block set | `SHA256SUMS` `15aab2e5…4e66` | `../sitting-a1/APPROVAL-A1.md` |
| Morning sitting | Stopped after P1 PASS at 11:32:46 AEDT; P2 not started; no production change; STAMP `20261117T234512Z` retired | owner statement (`APPROVAL-REPLACEMENT-WINDOW.md`) |
| **Replacement window** | **Wed 18 Nov 2026 13:00–15:30 AEDT (02:00–04:30 UTC)**; scope, pins, backup verification, acceptance, rollback limits and owner-only actions unchanged; R-10 and recovery cutoff 15:30 AEDT | owner approval, verbatim in `APPROVAL-REPLACEMENT-WINDOW.md` |
| Sitting STAMP | `20261118T021817Z` (13:18:17 AEDT) | §3 and the workstation file names in §4 |

## 2. Outcome

**B1 released, B1a committed exactly, observation passed.** Production serves `a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5` (revision
`a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5`); previous (sole rollback target) `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x`. ISSUE-365's 669
2026 `player_season_stats` rows read `brownlow_status = pending` with votes NULL. No rollback, database reversal or restore occurred.

| Step | Result | Evidence |
|---|---|---|
| P0 (workstation) | diff clean, remote = `611630e4…`, 16 manifest + 8 artifact hashes OK | T (§3) |
| P1 (S1, read-only) | `P1 RESULT PASS` | T |
| P2 (PREP pin, reviewed delta, S2 ff to `a2e6ea99`) | `P2 RESULT PASS` | T |
| P2b, P3b (transfers) | `P2b TRANSFER COMPLETE`, `P3b TRANSFER COMPLETE` | T |
| P3 (fresh dump, `--keep 1000`) | 29,959,926 bytes; the dump's own 2026 rows `not_applicable` 669, non-null votes 0; `BEFORE-CHECK PASS` | T; dump sha256 `7e85e8a2a0d91a0b0e2d51dc8136b8a9ee72db5c4625e9af4f795ab3f334758a` (W) |
| P4 (restore verification on DEV, option A) | `pg_restore exit=0`; nine parity aggregates equal production's; acceptance probe equals production's BEFORE capture on every line but identity (11 lines); runner dry run on the restored copy PASS; `P4 RESULT VERDICT PASS` | T |
| P5 (dry run) | `OUTCOME DRY-RUN-PASS (rolled back)`; `P5 RESULT DRY-RUN PASS` | T |
| **P6 (one commit)** | **`OUTCOME COMMITTED`**; post-commit read-only acceptance `pss2026\|pending\|669\|0`; **`ACCEPTANCE-DIFF EXACT`**; **`P6 RESULT COMMITTED EXACT`** | T |
| P7 / P7b (S3 build) | `BUILD_EXIT=0`; `P7b RESULT BUILD PASS a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5` | T |
| P8 (S4 host-gate, S5 promote `--attended`) | `P8 RESULT PROMOTED 2026-11-18T03:02:26Z` | T |
| S6 (owner restart) | service active since 2026-11-18T03:02:50Z, InvocationID `a2584da1…` to `fabd985f…`, NRestarts 0 | W (P11 log, `release.mjs status` activation lines) |
| P9 (S7, S8) | `P9 RESULT S7+S8 PASS`; the journal named the new serving build; 0 error/fatal/unhandled lines | T |
| S9 (public smoke) | health 200 with app and database ok; the three expected 307 redirects; `/beta` 200 with `noindex, nofollow`; the new build manifest 200 | T |
| P10 (`after`) | `P10 RESULT after PASS (64 samples)` | T |
| **P11 (observation)** | **`P11 RESULT OBSERVATION PASS (4 ticks)`**, 03:08:19Z–03:38:20Z (final 14:38:20 AEDT); every tick active, NRestarts 0, health ok, page 200; final `release: STATUS PASS a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5` | W (P11 log); also confirmed in T |
| Owner browser spot-check | **unconfirmed; not recorded** | — |

Evidence key: **T** = terminal transcript excerpt (§3); **W** = workstation log or file copied byte-for-byte into this directory (§4).

What `ACCEPTANCE-DIFF EXACT` establishes (source: `../sitting-a1/p6-b1a-commit.sh:26-41`): after the runner, P6 runs the acceptance
probe `b1a-accept-r6r.sql` as a separate read-only connection (backup role, `default_transaction_read_only=on`) and prints EXACT only
if, against P3's BEFORE capture, exactly two lines changed (`pss2026|not_applicable|669|0` to `pss2026|pending|669|0`, and `na_pss|669|n`
to `na_pss|0|n`) and every other line is identical, including the `cov2026` coverage lines, and the probe exited 0. P6 itself refuses
unless P3's `BEFORE-CHECK PASS`, P5's `P5 RESULT DRY-RUN PASS` and `OUTCOME DRY-RUN-PASS (rolled back)` are persisted and no earlier
commit run exists (`:18-19`).

## 3. Terminal transcript excerpts (T)

Exact terminal excerpts that the owner pasted into the owner's Codex conversation during this sitting (STAMP `20261118T021817Z`),
supplied to this records session on 2026-11-18. They are excerpts, not complete console output. The P0 entry is the owner's summary
of its output.

```text
P0: SITTING-A1-DIFF-CLEAN; origin/main matched 611630e41f3f27391173615d961c0ab5e1ea7810; all 16 manifest entries and eight artifact hashes returned OK.
P1: P1 RESULT PASS
P2: P2 RESULT PASS
P2b: P2b TRANSFER COMPLETE

P3:
BYTES 29959926
dump2026 not_applicable 669
dump2026 votes_non_null 0
BEFORE-CHECK PASS

P3b: P3b TRANSFER COMPLETE

P4:
pg_restore exit=0
PASS 3. nine parity aggregates equal production's
PASS 4. acceptance probe equals production's BEFORE capture on every line but identity (11 lines)
PASS 5. runner dry run on the restored copy
P4 RESULT VERDICT PASS

P5:
OUTCOME DRY-RUN-PASS (rolled back)
P5 RESULT DRY-RUN PASS

P6:
OUTCOME COMMITTED
pss2026|pending|669|0
ACCEPTANCE-DIFF EXACT
P6 RESULT COMMITTED EXACT

P7: BUILD_EXIT=0
P7b: P7b RESULT BUILD PASS a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5
P8: P8 RESULT PROMOTED 2026-11-18T03:02:26Z
P9: P9 RESULT S7+S8 PASS (read any UNVERIFIED journal note: owner lines)
P9 also printed the new serving build in the journal and 0 error/fatal/unhandled lines.
S9: observed health 200 with app and database ok, the three expected 307 redirects, /beta 200 with noindex, nofollow, and the new manifest 200.
P10: P10 RESULT after PASS (64 samples)
P11: P11 RESULT OBSERVATION PASS (4 ticks), confirmed from the saved log.
```

## 4. Workstation files (W), copied into this directory

| File | Source | What |
|---|---|---|
| `p11-observe-20261118T021817Z.log` | `D:\tmp\afldb-p11-20261118T021817Z.log` | the P11 observation log (four ticks and the final `release.mjs status`) |
| `afldb_prod-20261118-133119.dump.sha256` | `D:\tmp\afldb-b1a0-20261118T021817Z\afldb_prod-20261118-133119.dump.sha256` | the P3 dump's sha256 line (the dump is production data and is not committed) |

Also here: `APPROVAL-REPLACEMENT-WINDOW.md` (owner's replacement-window approval, verbatim).

**Retained on the hosts, not in this commit** (mode 600 / 700, no credentials), STAMP `20261118T021817Z`:

- production `$A=/home/arm/b1a-r6r-20261118T021817Z`: `p5-result.txt`, `p6-result.txt`, `dryrun.txt`, `commit.txt`, the four runner
  artifacts;
- production `$D=/home/arm/backups/afldb-b1a-20261118T021817Z`: the dump and `.sha256`, `before-check.txt`, `parity-prod.txt`,
  `accept-before-prod.txt`, `accept-after-prod.txt`, `accept-diff.txt`;
- production build log `/home/arm/b1-build-<UTC>.log` (named by P7);
- DEV `$W=/mnt/ssd/afldb-b1a0-20261118T021817Z` (dump copy, artifacts, P4 result) and the stopped verify cluster.

## 5. Left in place (owner decisions, no deadline)

- Workstation staging copy `D:\tmp\afldb-b1a0-20261118T021817Z\` still holds the production dump. The approval permits deleting it
  only after the verified off-host copy exists (P4 `VERDICT PASS` above); deletion is the owner's.
- DEV `$W` and the stopped verify cluster (`SITTING.md` §5 item 6); production `$A` and `$D` (B1a-0: retain).

## 6. Not done

- **D-365-W stays open**, separately gated: the public wording "Brownlow Medal results for this season have not been loaded yet."
  is a later code change and release. Until then the interim wording the owner accepted applies: "Not yet awarded" / "The season is
  still in progress; the Brownlow Medal has not been awarded." (packet 6 §8).
- The owner browser spot-check is unconfirmed and not recorded.
- No database reversal, restore, timer, configuration or host-policy change.
