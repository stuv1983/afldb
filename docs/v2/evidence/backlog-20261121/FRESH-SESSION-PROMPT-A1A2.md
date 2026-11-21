# Fresh-session prompt: run sittings A1 and A2 on Tuesday 24 November 2026 (paste everything below the line)

Prepared 2026-11-22 (backlog run c; refreshed run e). For the main session that runs the attended window. Use model Opus, effort
high, one session. **REVIEWED COMMIT = `fb2629e03d066819b26235dc67516448d26be24b`** (the last content commit of run e, on top
of `604e8da3`: every runbook, script and tracker this prompt relies on). This prompt is the only file of the commit after it (B).

---

You are running the owner-approved attended production sittings **A1** (10:00-10:30 AEDT, pre-window work from 09:20) and **A2**
(10:30-12:00 AEDT) on **Tuesday 24 November 2026** for AFLDB. Obey `D:/dev/afldb/CLAUDE.md` (§9: the owner authorised execution for
exactly this scope; §12: no Git writes beyond the records commit at the end, no push unless the owner says so). No AI trailers on
commits.

**Session-start rules (all four, on the workstation, before anything else; any failure = STOP):**
1. The owner states **PREP** (the published tip) in his first message. `git fetch origin` then `git ls-remote origin refs/heads/main`
   must print exactly PREP.
2. `git rev-parse PREP^` must equal the REVIEWED COMMIT `fb2629e03d066819b26235dc67516448d26be24b`.
3. `git diff --name-only fb2629e03d066819b26235dc67516448d26be24b PREP` must print exactly one line:
   `docs/v2/evidence/backlog-20261121/FRESH-SESSION-PROMPT-A1A2.md`.
4. The application being released is `7d92042fd11010eaa20966e2f49ae7a93e286568`: `git merge-base --is-ancestor 7d92042fd11010eaa20966e2f49ae7a93e286568 PREP`
   exits 0, and its executable tree (`git ls-tree -r` minus `docs/`, `documentation/`, `issues/` and root `*.md`, piped to `sha256sum`)
   equals cf158d60's: `a18ccac459dc5cbf335f3ca8df1e562885701febd24f1c48d4cc1147ea30e789` (`a1-p2-ff.sh` re-checks this on the host).
**If rule 2 or 3 fails** (for example `main` was published by a merge, squash or rebase instead of a fast-forward to this prompt's
commit): STOP. Do not repair, re-derive or "find" the reviewed commit yourself. The owner names PREP and the reviewed commit
explicitly; a non-fast-forward publication needs this prompt regenerated on the rebased content commit first.

**Read first, in this order, and nothing else unless a step needs it:**
1. `docs/v2/evidence/backlog-20261121/ATTENDED-PLAN-A1-A2-20261124.md` (the runbook; it is the contract; revisions of runs d and e at the top)
2. `docs/v2/evidence/backlog-20261121/DECISIONS-20261122c.md` §2-§3, `DECISIONS-20261122d.md` and `DECISIONS-20261122e.md` (approvals, rounds 2-4)
3. `docs/v2/evidence/backlog-20261121/RC-371-372.md` (the release candidate, with its 22 Nov revision note)
4. `docs/v2/evidence/backlog-20261121/A1-TIMING-OPTIONS.md` (T-1 APPROVED: the schedule)
5. The script headers in `docs/v2/evidence/backlog-20261121/a1a2-20261124/` as you reach each step.

**Pins (verify each before acting; any mismatch is a STOP):**
- PREP as above. It is the argument of `a1-p1-precheck.sh` and `a1-p2-ff.sh`; record `git diff --name-only 7d92042f <PREP>` for the
  report. A1 builds the pinned candidate below, **never PREP**.
- candidate = `7d92042fd11010eaa20966e2f49ae7a93e286568`; release id must start `7d92042fd110-`; `release.json` revision = that full sha
- tested revision `cf158d602242a3e7bbf899b951e8423c0d3521e6` (executable tree equal to the candidate, rule 4)
- serving now / rollback target = `c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC`; previous BUILD_ID = `aATnIlFOIQjq2z5oDdoHC`
- `previous` link now = `a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5`; ledger head `118_fixtures_unconfirmed_participants.sql`
- the production checkout fast-forwards to the **candidate**, never to `origin/main`

**Scope.** A1: release the candidate (P1-P6 of the runbook), the owner adds the two revalidation variables with the gated blocks
E1-E3 and performs the restart; acceptance (status, post-install-check, environment counts, `revalidate-season.ts --season 2026`
2/2, raw-head checks, public smoke, observation); documented application rollback if a trigger is met. A2 (only after A1 passes, or
per the runbook's §3.3 entry table; order and drop order per runbook §4.5): R1; R2 (forced-command key line, the first manual run,
then the approved hourly cron job, **its first scheduled `:17` run verified with `a2-cron-observe.sh r2`**, and the cron-environment
alarm test, §4.2 steps 3-4); R4 (combined Caddy install, gated on P6 PASS, never started after 11:35); the **R5 access restriction**
of the pre-fix logs (§4.5a: after R4's probes pass, or on its own at 11:35 if R4 is not started; then the owner's re-verify
`sha256sum -c --quiet SHA256SUMS` and the inventory report; the 4 Sep access file is ALREADY ROTATED OUT, not a STOP); R3 (units,
attended first runs, pull key, first off-host pull, first-copy restore on streamanator, then the approved daily cron job, §4.3 step
13, only after the first-copy restore PASS). The owner accepts one alarm email per hour while production is unreachable (round 4).
**Out of scope:** R5 disposal (earliest REVIEW Thu 7 Jan 2027), **R6 (approved for Wed 25 Nov: its own session and runbook,
`ATTENDED-PLAN-R6-20261125.md`)**, R7, R8, the ISSUE-348 load (PROPOSED Tue 12 Jan 2027), the R2 notifier marker.

**Timing: T-1 is APPROVED (owner, 22 Nov); do not ask again.** Start at **09:20 AEDT**: 09:20-09:30 read-only P1 + raw-head
baseline; 09:30-09:55 P2 (fast-forward the production checkout to `7d92042f` exactly), P3 build, P3b; 10:00 P4 promote, the owner's
env lines and restart; P5/S9; P6 (about 31 min) ends about 10:45-10:48; A2 from 10:30; **R4 is scheduled 11:00-11:20, gated on P6
PASS, never started after 11:35. Latest A1 restart 10:45** (a rule, not an estimate); later than that, stop before promotion and
reschedule A1 (runbook §1).

**Owner `sudo` steps: present ONE block at a time,** wait for the owner's output, check it against the runbook's expected value,
then present the next. Never batch them. Never print, echo or record a secret; only counts of `.env`/`/proc/*/environ` lines.

**Transport.** Production: `tr -d '\r' < <script> | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s -- <args>`
from Git Bash (Git Bash's own ssh has no agent; use the Windows OpenSSH binary). ONE connection per step, no automatic retries, no
rapid reconnects, and once r2 is installed **never at minute :16-:18** (streamanator's hourly check connects at :17): a burst of SSH
connections trips the home Firewalla IPS ("ET SCAN Potential SSH Scan OUTBOUND"), which then resets port 22 to the droplet while
HTTPS keeps working. If SSH suddenly times out, suspect the IPS, stop, and ask the owner to clear the flow; do not retry in a loop.
streamanator: `ssh -o BatchMode=yes -i ~/.ssh/afldb_dev arm@10.0.40.100`. The workstation has no Node; scripts run on the hosts. No `wsl`.

**What is verified off production, and what is still due on production:**

| Verified without touching production (runs c-e) | Still due ON production (owner present) |
|---|---|
| Every A1/A2 script: `bash -n`; cron install/observe dry test 54/54 against a stub crontab; streamanator first-copy restore path and key-line append (scratch copy) | A1 P1-P6 (the release, the owner's env lines and restart, acceptance, observation) |
| R0 dump verified off-host (22 Nov); the R2 alarm email delivery (owner confirmed 22 Nov) | A2 R1 install and checks; R2 key line, first manual run, cron r2 and its first `:17` run, cron-environment alarm test |
| R6 scripts' `bash -n` and dry runs (streamanator, run e); advisories re-verified from public sources | A2 R4 install, probes and the owner's count-only log check; R5 block, re-verify and inventory |
| R5 review helper on a scratch directory; ISSUE-348 privilege-check rehearsal | A2 R3 units, attended first backup and verify, pull key, first off-host pull (then cron r3 on streamanator) |
| Read-only production contacts already done: R0 probe (22 Nov 02:52), run d kernel check (22 Nov 07:15), run e ISSUE-348 privilege check (22 Nov 08:12, PASS) | After A2: the first scheduled backup (Wed 02:20), verification (Wed 03:30) and off-host pull (Wed 03:10), checked before R6 on Wednesday |

**Owner actions, in order.** Tue 24 Nov: (1) first message: state PREP; (2) from 09:20 present with `sudo` and a second terminal;
(3) A1 E1, E2, E3, then RESTART (one block each) and the journal count after P6; (4) A2 R1 steps 1-6; R3 steps 2-5, 7, 9; R4 steps
2-9 and the step 10 count-only greps and browser check; the R5 owner block, then the re-verify and inventory; (5) read his inbox for
the cron-environment test alarm. Wed 25 Nov (separate session, `ATTENDED-PLAN-R6-20261125.md`): Recovery Console login check,
08:30 live snapshot, GRUB read steps, GO/NO-GO, option B, timers, reboot by 10:25 at the latest.

**Stop rules.** Any session-start rule failing; any STOP line, FAIL result or unexpected value: stop at the last safe boundary, record
it, and go to the owner. Never `--skip-host-gate`; never restart to "fix" a revalidation exit 1/2; never start R4 after 11:35; latest
A1 restart 10:45; never install cron r2 if R2's manual run did not pass, nor cron r3 before the first-copy restore PASS; never run
R6 steps in this session.

**Records.** Write the sitting record (excerpts only, no secrets) under `docs/v2/evidence/backlog-20261121/` (for example
`SITTING-A1-A2-20261124.md`), update the trackers per `OPEN-ITEMS-AFTER-SITTINGS.md` (issues.md, IssuesIndex.md, CHANGELOG.md for
the release), and commit locally on the backlog branch. Report: new release id and BUILD_ID, the restart InvocationID, every
acceptance result, the installed Caddy sha, the first off-host dump name and sha, the R5 retained-directory inventory (names, sizes,
file count, SHA256SUMS line count, the re-verify result), each cron job's install result and next due time (Melbourne), r2's first
scheduled run, the cron-environment alarm test result, the fill-in values R6 needs (`ATTENDED-PLAN-R6-20261125.md` §1: A1 outcome,
CURRENT_ID, BUILD_ID, r3 yes/no, r4 yes/no, R1, cron install times, R5 block), and what remains open.
