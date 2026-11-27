# R6 r4 and release-packet corrections: Astra's eight findings on draft PR 5 (27 November 2026)

**Status: PROPOSED. Not approved, not installed, not run on production. R6 stays NO-GO. Astra has not re-reviewed this.**
Production was not contacted. Everything below ran on the workstation (Git Bash) and on the DEV host streamanator as `arm`,
in private `mktemp` directories and disposable `--network none` containers of the pinned image
`sha256:d71c0b286c54a7cc48645aa8d4d9d0c57e4260128cb91a6fb18c29d7589205ba`, without sudo.

| Item | Value |
|---|---|
| Reviewed head (Astra's findings) | `aa33f0fcdafd5b408620aef497cb20991b3c7547` |
| **Tested revision** (scripts, `deploy/release.mjs`, harness) | `a203c927d24bbd0b2bf4f67b3ddb2865a0fee0d3` |
| Review revision (runbooks pinned to the tested revision; the printed blocks were cut from it) | `b563a528f09619881556edee02cc40223826f133` |
| Release-rehearsal harness fix (only `rehearsal/rehearse.sh` differs from the tested revision) | `d0e6557793d3e6047c4281de290efff25dffc0ce` |
| R6 manifest (16 files) | `3c671c4b138c61eceb1029eb4f19dc863d51363d422a1a972d17090953aca52f` |
| Release `scripts/SHA256SUMS` (12 files) | `744e52ca1d23bd4f5bfa45acf2084146f8a55c938898bcb85bcdf2e4512f5c46` (was `b4e9e584…`, kept as `orig-aa33f0fc/release-scripts-SHA256SUMS`) |
| Superseded on this branch | `2e58a0b7` (first tested commit) and `02f7511a` (its pins): replaced after the first driver run and the pre-publication review (§4) |

The 24 Nov sitting record, approval and both parser logs are unchanged (`sha256sum -c SHA256SUMS-SITTING`: 4 OK). The r2 and r3
logs are unchanged. `orig-aa33f0fc/` holds the reviewed bytes of every changed script so the contrast cases can show each
defect on the original.

## 1. Findings, fixes and verification

| # | Finding | Fix (at `a203c927`) | Verification (all at `a203c927` unless stated) |
|---|---|---|---|
| 1 | Handoff parser counted substrings, accepted contradictory outcomes, did not bind the InvocationID | `r6-tuesday-handoff.sh`: ten anchored whole-line result patterns; any other mention of a result is a STOP; contradiction rules; `released` bound to the P5 binding line, `rolledback` to the rollback-verify binding line (and ≠ the initial restart ID), `deferred` needs Sunday's ID and no result, binding or `release: PROMOTED/ROLLED BACK` line. A `deferred` PASS prints an `R6-NOTE` that the owner's "before P4" ruling is not decided by the parser | suite `f1`, 73 cases, PASS. The three named records STOP (both P5 PASS and FAIL; rollback naming the initial restart ID; deferred with P5 acceptance and no P4) and falsely PASS on the original. Valid released, rolledback and deferred records PASS. The real `SITTING-20261124.md` still parses as `tue:deferred` with Sunday's ID |
| 2 | A successful backup start in the window was taken as the scheduled run | `r1-g0-dump.sh` and `r6-pre-verify.sh` §5 (`match_backup`, identical in both): timer `LastTriggerUSec` in 02:20–02:31; service start 0–5 s after it; exit by the limit; `Result=success`, status 0; every journal entry in the window carries that one InvocationID; exactly one anchored `backup ok` line inside the run; the dump and 16-hex digest cross-checked. A failed attribution prints no `OFFHOST-COMPARE` | suite `f2`, 81 cases, PASS, both gates: genuine timer run PASSES; manual start with no timer dispatch, manual start after a failed timer run, manual start within 5 s, a second invocation, missing or malformed properties and journal all STOP; the original PASSES the three manual cases |
| 3 | A-2 printed an InvocationID it had not validated; F-2 accepted failed reads and a failed status | `read_invocation` (one read, exit 0, exactly one lower-case 32-hex value) in all three scripts. A-2 prints `INVOCATION_ID <id>` only for the validated, attested value, else `INVOCATION_ID none (…)`. F-2 requires a valid ID different from the pre-boot ID and `serving_status`: exit 0, no CR, exactly one result line, exactly `release: STATUS PASS <CURRENT_ID>`; the restart note is recorded and permitted | suite `f3`, 32 cases, PASS: failed, empty, malformed, multiple, upper-case and unchanged reads, failed status, wrong release, duplicate or CRLF result lines all STOP; a valid post-reboot state with the restart note PASSES; the original falsely PASSES three contrast cases. The ported r3 suite (`in-container.sh`, 144 + 2 checks) PASSES |
| 4 | F-1 took BUILD_ID "from P3b" (wrong after rollback, absent after early deferral) | Runbook r4 amendment, `### Wednesday F-1 (r4)`: BUILD_ID is the whole suffix of the handoff's validated `CURRENT_ID` after the 12-hex revision (`^[0-9a-f]{12}-([A-Za-z0-9_-]{1,64})$`, the `releaseId` format); §1 and §5 rows changed in place | suite `f4`, 12 cases, PASS: the printed block, cut from the runbook at the review revision, probes the right manifest for release, rollback to the retained build and early deferral with no P3b, including a BUILD_ID with hyphens; mismatches STOP |
| 5 | Rehearsal cleanup could remove another run's archive | r2 `run-printed-blocks.sh` and `rehearse-r6-fixes.sh`: unconditional `REFUSED`, exit 2, as their first commands; r2 README marks the command RETIRED. r3/r4 driver: the archive path is reserved by a noclobber create carrying the run id; cleanup ownership exists only after this run's own exclusive create succeeded | suite `f5`, 21 cases, PASS on the workstation and on streamanator (`prove-archive-ownership.sh`): losing side of an identical-bytes collision leaves the winner's archive and unrelated staging directories intact; partial failures; 50-iteration races. Driver proof: sentinels intact after both runs, no residue |
| 6 | The P4 cutoff was checked only at the start | `deploy/release.mjs`: optional `--not-after <epoch s>` on `promote` and `host-gate`; `cmdPromote` checks it before the lock and again inside the lock after all validation, as the last statement before the two link renames. `r1-p4-gate-promote.sh`: millisecond pre-check, requires `host-gate --not-after` to print `PROMOTION DEADLINE ENFORCED`, then `promote --not-after`. Callers without the option are unchanged | `tests/deploy-release.test.ts` 62/62 (60 existing + 2 new, injected clock). Suite `f6`, 21 cases, PASS: 11:30:00.000 permitted, 11:30:00.001 refused; deadline expiring during validation leaves `current`, `previous` and `events.log` byte-identical; an old `release.mjs` fails closed; the original promotes 4 s late |
| 7 | The P6 journal check was a line count | `r1-p6-observe.sh` and RUNBOOK §4.2: the owner block passes only on `rc=0` and no entries (`JOURNAL PASS rc=0 entries=0`); the tick prints a count only after a control query proves the unit's journal is visible, else `unreadable`; P6 prints how many ticks read the journal and that the owner's line completes it | suite `f7`, 29 cases on streamanator's real journald, PASS: no entries PASS; one real error FAIL; failed query FAIL; the printed block in the runbook equals the script's; the original prints the expected `1` for one real error |
| 8 | r3 README compared the wrong printed block 1 | r3 `README.md`: corrected table from Git blobs, with the original logs untouched | Recomputed here from Git: block 1 is `5152d440…` at `9a9a01c1` and `2d315073…` at `de106597` and `cdeaf31f`; blocks 2–5 and the verification lines are identical at all three |

## 2. Commands, exit codes and results

| Run | Command (from the tested revision) | Exit | Result |
|---|---|---|---|
| Driver proof, run 1 (printed blocks 1, 2, 4, 5 verbatim; 31 containers) | `bash <(git show a203c927:…/review-fixes-r3-20261124/prove-driver-fixes.sh) a203c927… b563a528… <out> r4` | 0 | `R6 r4 REHEARSAL RESULT PASS`: 302 `CASE-RESULT … OK`, 0 UNEXPECTED. Expected STOPs inside it: 21 of 23 printed-block cases, and the STOP cases of every suite |
| Driver proof, run 2 (`R6_REH_SABOTAGE=b5-symlink-identical`) | same wrapper | 1 (expected) | that case reported UNEXPECTED, `R6 r4 REHEARSAL RESULT FAIL (1 unexpected)`; wrapper verdict `R6 r4 DRIVER PROOF PASS` (wrapper exit 0) |
| Archive ownership | `bash <(git show a203c927:…/prove-archive-ownership.sh) a203c927… <out>` | 0 | `R6 r4 ARCHIVE OWNERSHIP PROOF PASS` (f5 21/21 on both hosts) |
| Unit tests | `node node_modules/vitest/vitest.mjs run tests/deploy-release.test.ts` (clean export, node v22.23.2) | 0 | 1 file, 62 tests passed |
| Release rehearsal | `bash rehearsal/rehearse.sh <export> <bundle of 17822b29> <node_modules>` at `d0e65577` | 0 | `REHEARSAL RESULT PASS: 92 passed, 0 failed` |

Suite counts inside run 1: release-scripts-manifest OK; printed blocks 23; `in-container.sh` prod 144 and wronghost 2;
f1 73, f2 81, f3 32, f4 12, f5 21, f6 21, f7 29. Logs are in [`logs/`](logs/).

## 3. What changed in the release rehearsal harness, and why

`rehearsal/rehearse.sh` section K extracted a one-line CURRENT_ID gate that left `r6-pre-verify.sh` at r3, so its two refusal
checks could not refuse (2 FAIL on the first run here, independent of the r4 fixes). Section K now evaluates the script's own
seven-argument gate (`gate_pre7`) and asserts the extraction is the expected 10 lines. At `a203c927` that assertion itself had a
quoting bug (91 passed, 1 failed: [`logs/release-rehearsal-a203c927-harness-fail.log`](logs/release-rehearsal-a203c927-harness-fail.log));
`d0e65577` fixes that one line. No pinned script differs between `a203c927` and `d0e65577`. The rehearsal needs a
`node_modules` with `.bin/tsx`; the first attempt used one without it (3 environment failures, not recorded as evidence).

## 4. History on this branch

1. `2e58a0b7` + `02f7511a`: first tested and pin commits. The first driver run failed three `f5` cases because the clean export
   omitted the two retired r2 scripts (export list, not the scripts).
2. An independent pre-publication review of that range (code reading only; it ran no Git or shell) raised: a `deferred`
   record with a `release: PROMOTED` trace after an interrupted P4 still parsed (fixed, 2 new `f1` cases); P6 could print
   PASS with every tick `unreadable` (now stated explicitly; see limits); the `gate_pre7` refusals could be vacuous (assertion
   added); the real sitting record was in no suite (added to `f1` and the export). Its verdicts: findings 1–6 closed, 7
   partial (addressed as above), 8 not verified by it (verified here from Git, §1).
3. `a203c927` + `b563a528`: the tested and review revisions above. `d0e65577`: §3.

## 5. Residual limits (not closed by this change)

* **Backup attribution.** A timer-started run that dies within 5 s having logged nothing `arm` can read, followed inside those
  5 s by a manual start, is indistinguishable. `scheduled-backup.sh` logs its `target:` line first, so this needs an exec or
  unit-level failure. Journal receipt later than 5 s after exit is a false STOP. Lines from PID 1 are used when readable; that
  path was exercised with fixtures only, not against a real journal.
* **P6.** A tick still accepts `unreadable`; the journal part rests on the owner's `JOURNAL PASS rc=0 entries=0` line, which
  no script can observe. For root, exit 0 with empty output is taken as "no entries". `r1-p6-observe.sh` `main` was not run
  end to end (31 minutes on production shape); its two functions were, through the library seam.
* **P4.** Microseconds remain between the last clock read and the two renames; the deadline uses the host clock. **P4 STOPs
  against any checkout whose `deploy/release.mjs` lacks `--not-after`, which includes `17822b29`**: a future sitting needs a
  new pin whose production checkout contains this change.
* **Handoff parser.** It reads a record a person assembled; it cannot detect a result line that was never pasted.
* **Driver.** A losing run has already created its own output directory; a block 2 that breaks after the remote exclusive
  create leaves a partial archive it does not own (reported, not removed); printed block 1 is not itself exclusive against an
  operator running it by hand at the same moment.
* **F-3 identity suite** uses a stub `release.mjs status` with the real tool's texts; the real tool is exercised by `f6`, the
  unit tests and the release rehearsal.
* **Runbook titles.** The R6 plan's title and the release runbook's table still describe the lapsed 24–25 Nov packet; both
  carry a dated note that the approval is spent. The dated production gates are unchanged on purpose.

## 6. What a future sitting still needs

A new date and re-dated, re-pinned packets; Astra's PASS at that review commit; a new owner approval; and that day's own
evidence. The owner's ruling that Tuesday's deferral is ambiguous ("before P4") is a separate open input.
