# Packet 6R Amendment A1 — replacement window approval (received 2026-11-18)

Recorded by Claude on receipt (working copy first kept at `D:\tmp\afldb-6r-sitting2-20261118\00-REPLACEMENT-WINDOW-APPROVAL.md`,
outside the worktree, so that P0's porcelain check held).

## Owner approval (verbatim)

> I approve a replacement window for AFLDB ISSUE-365, Packet 6R Amendment A1, on Wednesday 18 November 2026, 13:00–15:30 AEDT (02:00–04:30 UTC). The approved scope remains B1, B1a-0 option A, and B1a. Keep the existing pins, backup verification, acceptance checks, rollback limits and owner-only actions. I'll run the commands and be available for the restart and signed-in browser check.
>
> The morning sitting stopped after P1 PASS at 11:32:46 AEDT. P2 did not start and the sitting made no production changes. The previous STAMP was 20261117T234512Z.
>
> Use the A1 runbook in D:\dev\afldb-rem-20261114\docs\v2\evidence\remediation-20261114\run6r\sitting-a1. Give me one copy-paste block for the local P0 checks and a fresh STAMP for this sitting. Then give me the read-only P1 command once the new window opens.
>
> If P0 and P1 pass, proceed directly to P2 and guide me through the remaining steps. Use 15:30 AEDT as the new cutoff when evaluating timer conflicts and recovery time. Keep the backup verification, dry run, commit, restart, page checks and observation in the approved order. Verify the production result, preserve the evidence and update ISSUE-365 based on what actually completed.

## What it changed

| Item | Original (A1) | Replacement |
|---|---|---|
| Window | 10:00–12:30 AEDT (17 Nov 23:00Z – 18 Nov 01:30Z) | 13:00–15:30 AEDT (18 Nov 02:00Z – 04:30Z) |
| R-10 settle-timer and recovery cutoff | 12:30 AEDT | 15:30 AEDT |
| STAMP | `20261117T234512Z` (retired; P2 never ran, so no `$A`/`$D`/`$W` under it) | fixed once at the replacement sitting's P0 |

Everything else unchanged: scope, every pin, the A1 block set, backup verification, acceptance, the sole rollback target
`c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x`, no database reversal or restore, owner-only sudo and restart, P6 never re-run.
