# Packet 6R sitting, Amendment A1: owner approval of the corrected block set (2026-11-16)

This file records the owner's approval of the A1 block set. It is not one of the hashed blocks: `SHA256SUMS` beside it covers the
15 blocks and `SITTING.md` only, and this file does not change any of them.

## 1. Owner approval (verbatim, received 2026-11-16)

> I approve using the corrected sitting-a1 script set whose SHA256SUMS file has SHA256:
>
> 15aab2e5c46c5339dafdaf171922769185eeeede9a0907afd409019e416b4e66
>
> This approval covers the reviewed changes to P1, P2, P3, P5, P6 and R1, the nine unchanged scripts, and the three additional mode-600 result files in the already approved directories.
>
> The existing execution window remains Wednesday 18 November 2026, 10:00–12:30 AEDT. All packet 6R production scope, owner-only actions, acceptance requirements and recovery limits remain binding.
>
> Before the sitting:
> - Commit the corrected scripts, amendment, review and qualification evidence locally now. A local commit does not change the remote pin. Preserve their exact qualified bytes.
> - Record the complete local commit SHA and verify its artifact hashes against the approved manifest.
> - Do not publish that commit before the sitting.
> - Confirm origin/main is exactly 611630e41f3f27391173615d961c0ab5e1ea7810 at the specified gates. Stop on any other state.
> - Preserve the raw harness results and distinguish the 98 passing checks from the two explained non-passing lines. Do not call the harness wholly green without that qualification.
>
> Execution:
> - Use only the approved corrected script set.
> - Supply VERDICT-PASS and the exact dump hash to P5 only after P4 reports successful verification for that same dump.
> - Continue past P6 only on P6 RESULT COMMITTED EXACT.
> - For every other P6 outcome, including a lost connection, run the read-only R1 state probe and follow the approved state-specific procedure. Never retry P6 automatically.
> - SSH keepalives are approved for P7 and P11 as transport-only settings. A disconnect never establishes command failure or authorises a retry.
> - If the settle timer conflicts with the sitting, stop before backup or repair.
> - The P9 operator note does not waive S8 acceptance. Distinguish any repeated status-command limitation from a genuine serving-state failure, preserve the evidence and apply the existing acceptance/recovery rules.
>
> I perform sudo, the restart and required privileged checks. No database reversal, whole-database restore or additional production change is approved.
>
> After the sitting, I approve fast-forward publication of the exact approved operational-script commit and records documenting this execution, after reviewing the complete delta. Describe the script commit as operational executable artifacts, not merely records because its files live under docs/.
>
> Finish preparation, leave a durable fresh-session prompt with all pins, and stop with no task-owned agents or wait loops running. Do not start another broad review or repeat unchanged qualification.

## 2. What the approval settles

| Item | Settled value |
|---|---|
| Approved block set | `SHA256SUMS` sha256 `15aab2e5c46c5339dafdaf171922769185eeeede9a0907afd409019e416b4e66` (15 blocks and `SITTING.md`; per-file values in `AMENDMENT-A1.md` §6) |
| Changed blocks covered | p1, p2, p3, p5, p6, r1 (R-1..R-8) |
| Unchanged blocks covered | p4, p7, p7b, p8, p9, p10, p11, r2, r3 |
| New production files covered | `$D/before-check.txt` (P3), `$A/p5-result.txt` (P5), `$A/p6-result.txt` (P6), all mode 600 |
| Remote pin | `origin/main` = `611630e41f3f27391173615d961c0ab5e1ea7810` exactly at P0, P1 and P2; any other state STOPs |
| R-13 SSH keepalives | **Approved** for P7 and P11 only: `-o ServerAliveInterval=30 -o ServerAliveCountMax=4`. Transport only. A disconnect is not a command failure and does not authorise a retry |
| R-10 settle timer | If the next `afldb-settle` elapse printed by P1 falls inside the window (before 12:30 AEDT), STOP before P3 (no backup, no repair) and tell the owner |
| R-9 (P9 note) | Does **not** waive S8 acceptance. An S8 whose only FAIL is its own `status --expect` line after a `confirm` run with S7 PASS is reported as that known status-command limitation, with its raw output preserved, and is not by itself a rollback trigger. It is not reported as S8 PASS. Any other S7/S8 failure, and any serving-state failure (unit, health, S9 smoke, P10, P11), follows the existing acceptance and recovery rules |
| Not approved | Database reversal, whole-database restore, any additional production change, any sudo by Claude |

## 3. Qualification evidence, stated with its qualification

The A1 harness (`review/raw/raw-a1/SUMMARY.txt`; full raw output in `review/harness-raw-20261116.tgz`, sha256
`65f5aad7c89eb033730a9b09e0c5c41a5a0429db64c6714f4959773e041edbb4`) printed, verbatim:

```
== totals: 89 PASS, 1 FAIL, 0 DEFECT-lines
== p10/p11 totals: 9 PASS, 1 FAIL
```

So: **98 checks PASS and 2 lines did not pass.** The harness is not wholly green. The two non-passing lines are explained, not fixed:

1. `FAIL  p6-p5-notpass: porcelain not empty` is the expected state. A P6 refused for want of a P5 PASS stops before its own cleanup;
   the next harness check confirms that R3 removes the artifacts, which is the sitting path (R3, then R1 `probe`).
2. `FAIL  p10-after-pass: cookie never printed` is a harness artefact, present in the original-block run as well. The match came from
   the stub call log appended to the raw file; the block's own output contains 0 occurrences.

The original blocks (`review/raw/raw-orig/SUMMARY.txt`) are the comparison baseline and are not approved for use.
