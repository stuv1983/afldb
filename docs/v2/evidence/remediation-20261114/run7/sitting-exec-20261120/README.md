# Release 7 sitting record (Fri 20 Nov 2026, 10:00–12:00 AEDT)

Status: **NOT STARTED.** There has been no production contact. The approval below was received before the window.

## 1. Owner approval (verbatim, received 2026-11-19 ~02:44 UTC = 13:44 AEDT Thu)

> Approval R7. I approve the attended production release of candidate 0a308e2a046b85b376f362ec18098a3eb9a31086 on Friday 20 November 2026, 10:00–12:00 AEDT, under docs/v2/evidence/remediation-20261114/run7/RELEASE-PACKET-7.md.
>
> PREP is b82a6b04a6138207bfb6483b3a4fa4ed143fbe74. The SHA256SUMS manifest SHA-256 is c8c189fc22744aa2b20041aa53f79b9315e9f920e1fd815ce334551f572b9e43. PREP pins the reviewed procedure. The serving checkout and build must target the candidate exactly. I accept the qualification results and limits recorded at PREP.
>
> Own execution of every Claude-operated step in packet order, using Windows OpenSSH with one connection per step. Perform the workstation pin and hash checks. Begin production contact only inside the approved window. Stop on pin drift, a P1 result outside §4, or any packet stop condition. Apply the settle-timer and recovery-time rules.
>
> Fast-forward the serving checkout to the candidate, build using the run7 off-host typecheck evidence, and run the host gate. Confirm I am present and ready before promoting with --attended. Give me the exact restart command at the owner step. I will perform the sudo restart myself and attest its InvocationID only if S7 reports the apt coincidence for my restart.
>
> Complete S7/S8, public smoke, all 64 P10 after-mode samples and all three controls, then the 30-minute observation. Prompt me for my signed-in check of the 2026 BV cell's "Results not loaded" label and exact tooltip. Record my observation separately from the automated results.
>
> On a §8 rollback trigger, use only a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5, with my restart. No database write, reversal, restore or B1a step is authorised. This approval expires at 12:00 AEDT.
>
> After the sitting, record the actual outcome and verification limits, commit the execution records and publish them by fast-forward. Report the final serving release, acceptance results, manual browser result, any recovery action and the published records SHA

Window in UTC: 2026-11-19T23:00Z – 2026-11-20T01:00Z. The approval expires at 2026-11-20T01:00Z.

## 2. Preliminary workstation pin check (2026-11-19T02:44:04Z, before the window; P0 is repeated at the window start)

- Local HEAD `b82a6b04a6138207bfb6483b3a4fa4ed143fbe74` = `git ls-remote origin refs/heads/main` = PREP.
- `sha256sum -c run7/SHA256SUMS`: all 10 entries OK.
- `SHA256SUMS` sha256 `c8c189fc22744aa2b20041aa53f79b9315e9f920e1fd815ce334551f572b9e43`.
- Working tree: only untracked `.codex/` (not touched).

## 3. Sitting log

(not started)

## 4. Outcome (recorded 2026-11-21 during the closeout pass)

**EXPIRED, NOT EXECUTED.** No sitting log, serving ID, P1 result or owner-browser observation exists in any
checkout or retained record. The window and approval ended at 2026-11-20T01:00Z. The closeout pass made no production
contact, so the serving release is not re-observed here. The last committed production acceptance is the 18 November
sitting (`a2e6ea99`). D-365-W and ISSUE-366 therefore remain published but undeployed. `origin/main` is still PREP
`b82a6b04` (checked by `git ls-remote` on 2026-11-21).

A new attended release needs a new owner approval and window. If closeout commits are published first, `origin/main`
moves past PREP, and packet 7's P0/P1/P2 (which require `origin/main` = PREP) must be re-derived as a new packet.
