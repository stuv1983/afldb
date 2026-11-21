# Fresh-session prompt: run sittings A1 and A2 on Tuesday 24 November 2026 (paste everything below the line)

Prepared 2026-11-22 (backlog run c). For the main session that runs the attended window. Use model Opus, effort high, one session.

---

You are running the owner-approved attended production sittings **A1** (10:00-10:30 AEDT) and **A2** (10:30-12:00 AEDT) on
**Tuesday 24 November 2026** for AFLDB. Obey `D:/dev/afldb/CLAUDE.md` (§9: the owner authorised execution for exactly this
scope; §12: no Git writes beyond the records commit at the end, no push unless the owner says so). No AI trailers on commits.

**Read first, in this order, and nothing else unless a step needs it:**
1. `docs/v2/evidence/backlog-20261121/ATTENDED-PLAN-A1-A2-20261124.md` (the runbook; it is the contract)
2. `docs/v2/evidence/backlog-20261121/DECISIONS-20261122c.md` §2-§3 and `DECISIONS-20261122d.md` (the approvals, round 2 and round 3)
3. `docs/v2/evidence/backlog-20261121/RC-371-372.md` (the release candidate, with its 22 Nov revision note)
4. `docs/v2/evidence/backlog-20261121/A1-TIMING-OPTIONS.md` (T-1 APPROVED: the schedule)
5. The script headers in `docs/v2/evidence/backlog-20261121/a1a2-20261124/` as you reach each step.

**Pins (verify each before acting; any mismatch is a STOP):**
- `origin/main` = **PREP: the tip the owner confirms in the first message of the session** (`da4cc0c459f469d3b1a798302f8fe394962a395f`
  on 2026-11-22; if anything was pushed before A1 the owner names the final tip). Verify with `git ls-remote origin refs/heads/main` (= PREP)
  and `git merge-base --is-ancestor 7d92042fd11010eaa20966e2f49ae7a93e286568 <PREP>` (exit 0) on the workstation; record
  `git diff --name-only 7d92042f <PREP>` for the report. PREP is the argument of `a1-p1-precheck.sh` and `a1-p2-ff.sh`; A1 still
  builds the pinned candidate below, never PREP
- candidate = `7d92042fd11010eaa20966e2f49ae7a93e286568`; release id must start `7d92042fd110-`; `release.json` revision = that full sha
- tested revision `cf158d602242a3e7bbf899b951e8423c0d3521e6` (executable tree equal to the candidate)
- serving now / rollback target = `c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC`; previous BUILD_ID = `aATnIlFOIQjq2z5oDdoHC`
- `previous` link now = `a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5`; ledger head `118_fixtures_unconfirmed_participants.sql`
- the production checkout fast-forwards to the **candidate**, never to `origin/main`

**Scope.** A1: release the candidate (P1-P6 of the runbook), the owner adds the two revalidation variables with the gated blocks
E1-E3 and performs the restart; acceptance (status, post-install-check, environment counts, `revalidate-season.ts --season 2026`
2/2, raw-head checks, public smoke, observation); documented application rollback if a trigger is met. A2 (only after A1
passes, or per the runbook's §3.3 entry table; order and drop order per runbook §4.5): R1; R2 (forced-command key line, the
first manual run, then the **approved hourly cron job** and the cron-environment alarm test, §4.2 steps 3-4); R4 (combined Caddy
install, only after the A1 observation ends, never started after 11:35); the **R5 access restriction** of the pre-fix logs (§4.5a,
one owner block after R4); R3 (units, attended first runs, pull key, first off-host pull, first-copy restore on streamanator, then
the **approved daily cron job**, §4.3 step 13). Both cron jobs are owner-approved (22 Nov, round 3) and install only through
`a2-cron-install.sh` after their preconditions. **Out of scope:** R5 disposal (logs retained), R6, R7, R8, the ISSUE-348 load,
the R2 notifier marker.

**Timing: T-1 is APPROVED (owner, 22 Nov); do not ask again.** Start at **09:20 AEDT**: 09:20-09:30 read-only P1 + raw-head
baseline; 09:30-09:55 P2 (fast-forward the production checkout to `7d92042f` exactly), P3 build, P3b; 10:00 P4 promote, the
owner's env lines and restart; P5/S9; P6 to about 10:45; A2 from 10:30 with R4 after P6. **Latest restart 10:45**; later than that,
stop before promotion and reschedule A1 (runbook §1).

**Owner `sudo` steps: present ONE block at a time,** wait for the owner's output, check it against the runbook's expected value,
then present the next. Never batch them. Never print, echo or record a secret; only counts of `.env`/`/proc/*/environ` lines.

**Transport.** Production: `tr -d '\r' < <script> | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s -- <args>`
from Git Bash (Git Bash's own ssh has no agent; use the Windows OpenSSH binary). ONE connection per step, no automatic
retries, no rapid reconnects: a burst of SSH connections trips the home Firewalla IPS ("ET SCAN Potential SSH Scan OUTBOUND"),
which then resets port 22 to the droplet while HTTPS keeps working. If SSH suddenly times out, suspect the IPS, stop, and ask
the owner to clear the flow; do not retry in a loop. streamanator: `ssh -o BatchMode=yes -i ~/.ssh/afldb_dev arm@10.0.40.100`.
The workstation has no Node; scripts run on the hosts. No `wsl`.

**Stop rules.** Any STOP line, FAIL result or unexpected value: stop at the last safe boundary, record it, and go to the owner.
Never `--skip-host-gate`; never restart to "fix" a revalidation exit 1/2; never start R4 after 11:35; latest A1 restart 10:45.

**Records.** Write the sitting record (excerpts only, no secrets) under `docs/v2/evidence/backlog-20261121/` (for example
`SITTING-A1-A2-20261124.md`), update the trackers per `OPEN-ITEMS-AFTER-SITTINGS.md` (issues.md, IssuesIndex.md, CHANGELOG.md for
the release), and commit locally on the backlog branch. Report: new release id and BUILD_ID, the restart InvocationID, every
acceptance result, the installed Caddy sha, the first off-host dump name and sha, the R5 retained-directory listing (names, sizes,
SHA256SUMS line count), each cron job's install result and next due time (Melbourne), the cron-environment alarm test result, and
what remains open. Afterwards, observe the first scheduled runs with `a2-cron-observe.sh all` and record them in
`OPEN-ITEMS-AFTER-SITTINGS.md` §4.
