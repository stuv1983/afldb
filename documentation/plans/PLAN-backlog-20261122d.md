# PLAN: backlog run 22 Nov 2026 (d), owner decisions 1-9 of 2026-11-22 (round 3)
DOC: plan for the orchestrator run on branch claude/backlog-20261122 (worktree D:\dev\afldb-backlog-20261122), base origin/main da4cc0c4.
DOC: authority = owner decisions 1-9 of 2026-11-22 round 3 relayed by the main session; CLAUDE.md sections 1-14 govern; streamanator/Git (local) and ONE read-only production SSH session authorised for this task.

## 0. Boundaries (binding on every step and every spawn)
- Local commits only on `claude/backlog-20261122`; NO push (owner push approval covered only up to da4cc0c4); no AI trailers.
- Production: exactly ONE read-only SSH session for the R6 kernel/livepatch/advisory check (decision 4), via
  `C:\WINDOWS\System32\OpenSSH\ssh.exe -o BatchMode=yes afldb` with an LF script piped through a cmd redirect; no sudo, no apt update,
  no install, no retry loops (refused/blocked: STOP; at most one retry after 5 min). No other production contact (no HTTP probing either).
- streamanator `ssh -o BatchMode=yes -i ~/.ssh/afldb_dev arm@10.0.40.100`: new work only in `/mnt/ssd/afldb-backlog-20261122d-*`, no sudo.
  READ-ONLY on arm's real crontab (`crontab -l` baseline only; NEVER install/modify it), `/home/arm/afldb-ops` (read sha256/state only),
  R0 backup, five named DBs, preserved workspaces. Exception (decision 6): `/mnt/ssd/afldb-backlog-20261122b-348` may be READ, and its
  own isolated cluster may be started only if the 348 post-load check dry run needs it, then stopped; no writes to its databases.
- Delete nothing outside this run's own new workspaces. No `wsl`. Secrets never in chat/evidence/commits. No production 348 load.
- Workstation has no Node: any Node/Linux verification on streamanator in a fresh workspace.

## 1. Steps

### S0. Plan review (afldb-reviewer) — first act; CRIT/HIGH stops the run.

### S1. Pin fix (decision 1) — orchestrator
- `ATTENDED-PLAN-A1-A2-20261124.md` §0 PREP row, W0/W1/P2 rows; `FRESH-SESSION-PROMPT-A1A2.md` pins; `a1-p1-precheck.sh`,
  `a1-p2-ff.sh` header COMMENTS only: PREP = the origin/main tip the owner confirms at the start of the Tuesday session (today
  da4cc0c4; if later pushes happen before A1 the owner names the final tip in the first message). Rule: PREP must be a descendant of
  7d92042f (P2 checks `merge-base --is-ancestor CAND PREP`); 7d92042f..PREP executable-path changes are irrelevant because A1 builds
  pinned CAND 7d92042f by `git archive` and P2 fast-forwards the checkout to CAND exactly; the session records
  `git diff --name-only 7d92042f PREP` for the report. `bash -n` on streamanator; record old/new sha256 of the two scripts.
- Search every other tracked mention of 731a5025 as a PREP pin (a2-*, OPEN-ITEMS, RC note) and fix only pin uses, not history.

### S2. A1 timing options (decision 2) — orchestrator
- `A1-TIMING-OPTIONS.md`: T-1 vs T-2 quoted from the runbook §1 with start/end, who, what is served, restart time, A2 start, 10:45
  latest-restart rule, risks; flag that T-1's 09:20-10:00 pre-window work (P2 ff + P3 build) lies outside the approved 10:00-10:30
  window and needs the owner's explicit agreement; recommendation; the owner decides.

### S3. Cron install/observe (decision 3) — orchestrator authors; worker dry-tests on streamanator
- Read-only now: streamanator `crontab -l | sha256sum` + line count + any afldb lines; `sha256sum /home/arm/afldb-ops/*.sh`
  (expect settle-check c6467ff4…); record baseline (no secrets: crontab lines are printed only if they hold no secrets, else counts).
- `a1a2-20261124/a2-cron-install.sh r2|r3` (streamanator, arm): precondition checks (wrapper sha pinned; alarm sender executable;
  for r3 a `.verified-*` marker and sidecar present), reads `crontab -l`, refuses if the marker or the same command already exists,
  appends exactly one line with a `# AFLDB-A2-<r2|r3> installed <UTC>` marker, installs via `crontab <tmpfile>`, re-reads and
  verifies exactly one marker + line, prints next due time in Australia/Melbourne; `--dry-run`. `a2-cron-observe.sh` reads logs/state
  (settle-check.log, offhost dir) for the first scheduled runs after A2 and prints a record block.
- Dry test on streamanator in `/mnt/ssd/afldb-backlog-20261122d-cron` with a stub `crontab` first on PATH operating on a temp file
  (never the real crontab), covering: fresh install, duplicate refusal, existing-lines preserved, wrong wrapper sha refusal.
- Update ATTENDED-PLAN §4.2/§4.3/§4.6 and A2 time budget, FRESH-SESSION-PROMPT, OPEN-ITEMS; email delivery evidence stays separate.

### S4. R6 kernel check (decision 4) — orchestrator (production contact is the orchestrator's only, one session)
- `r6-kernel-check-20261122/check.sh` (LF, read-only, no sudo, each probe `|| true`, `timeout` guarded); run once; raw output
  redacted (no IPs/hostnames beyond afldb-prod, no tokens) to `raw-output.txt`; `README.md` confirmed vs unknown, CVE evidence from the
  package changelog and/or public Ubuntu notices (workstation curl, public data only), reboot-before-leave verdict with evidence;
  if warranted a window after A2 and before 26 Nov with prerequisites; else triggers + alternate-operator prerequisites. R7 date-relative
  on/after Thu 7 Jan 2027.

### S5. R5 scope + retention proposal (decision 5) — orchestrator
- `R5-RETENTION-PROPOSAL.md`: exact scope from records (R0, packet R5, procedure 06) — no production log reads; invite and magic-link
  token lifetime from code (semble -> `src/lib/auth/*`, admin invites); two retention options; A2 owner steps: metadata listing
  (expected values) and one sudo block restricting access (mode/owner, dir perms) with rollback, consistent with R4 step 8's
  `caddy:caddy 0600` expectation. Verify R4 material + a2-r4-probes.sh redaction coverage + rollback statement.

### S6. ISSUE-348 digests, drift and load window (decision 6) — orchestrator analyses; worker writes/dry-runs the post-load check
- Quote all SEALED-PLAN §1 digests in full from the file; recompute sha256 of tracked artefacts (runner, digest SQL, SHA256SUMS,
  reconciliation, guard report, manifest) on the workstation; tar lives on streamanator (recompute read-only there).
- From `i348-load.sh`, the digest SQL and `tools/rebuild/draftguru/reload_guard.py`/importer: what the effect digest covers vs what only
  digest pre/post covers; which write groups have no pre-commit refusal; smallest addition proposal (no re-seal unless strictly needed;
  any re-seal = record + re-rehearsal on streamanator).
- `issue348-acquisition/LOAD-WINDOW-PROPOSAL.md` + `i348-postload-check.sh` (read-only: eight groups, three club rulings 5961/6784/6626,
  link digests unchanged); dry run against a rehearsal post-load database in the 22b-348 workspace (start its cluster only if needed,
  stop after). Window recommendation (Wed 25 Nov vs from Thu 7 Jan 2027, with season deadlines).

### S7. ISSUE-373 resolution (decision 7) — orchestrator (+ mechanic only if the appendix generation is bulky)
- Appendix from `failing-cells-118.csv` + `data/reference/gridley-approved-deferrals.json`: 78 deferrals + 40 brother disagreements, by id;
  explain 118 findings over 113 distinct cells (the 5 overlaps exactly). Resolve in `issues.md` (status/date/root cause/validation, raw
  G-c result 118 preserved, refs D-GAP029-21, D3, D4W, ISSUE-118, ISSUE-363; G-a/G-b PASS; future-difference rule); remove from
  IssuesIndex.md + Open Issues table; ISSUE-363 follow-up refs; CHANGELOG decision stated. No test/gate change.

### S8. R8 (decision 8) — orchestrator
- Verify 19 Feb 2027 weekday and no other claim; R8 executable revision rule; pre-capture expectations; final digest only after capture;
  record the draft approval text field as the owner's 22 Nov decision.

### S9. DECISIONS-20261122d.md + OPEN-ITEMS + trackers (decision 9) — orchestrator.

### S10. Commits (small, local, no trailers) then closure (afldb-closure): re-derive diff, `bash -n` (streamanator), pins, tracker
sync, edit disclosure, secret scan. Persist every return to `.phaneslight/returns/backlog-20261122d/` before the next dispatch.

## 2a. Reviewer amendments (launch review `PLAN-backlog-20261122d-REVIEW.md`; no CRIT/HIGH; binding)
- F-001/F-002/F-003/F-004 (S3): `CRONTAB_BIN` override, stub logs its calls, assert real `crontab -l | sha256sum` unchanged around the
  dry test; STOP on failed/short `crontab -l`, 0600 pre-image backup, newline guard, post-diff exactly marker + job else restore;
  r2 requires today's last settle-check.log line `rc=0 AFLDB_SETTLE_STATUS OK`; r3 requires the `.verified-<name>` marker for the newest
  dump + sidecar; re-run with identical line = `ALREADY INSTALLED` exit 0; marker with a different line = STOP; tested `remove r2|r3`.
  The dry test never executes the wrappers (they default to the production address).
- F-005 (S3): A2 step running the exact cron command under `env -i HOME=/home/arm LOGNAME=arm SHELL=/bin/sh PATH=/usr/bin:/bin`
  with `AFLDB_PROD_SSH=arm@afldb-nonexistent.invalid` (owner confirms the email arrives); confirm cron's timezone on streamanator.
- F-006 (S4): `bash -n` + full run of check.sh on streamanator first; `main "$@" </dev/null`; overall timeout; no apt/apt-get network
  commands; outside 02:10-02:40 and 04:50-07:15 AEDT; prefer the cached pro status file.
- F-007 (S6): do not start the preserved 22b-348 cluster; `cp -a` its stopped PGDATA into `/mnt/ssd/afldb-backlog-20261122d-348` and
  start the copy socket-only read-only; never modify `sealed/`.
- F-008 (S6): window proposal states that `digest pre` is pinned to R0 across players/data_edits/data_overrides/DraftGuru rows; a
  January window is costed as a probable re-rehearsal and re-seal of expected-pre/post.
- F-009: S4 runs before S2/S6 conclude; one reconciled Tue/Wed schedule; R5 block after R4 step 10 with its own safe boundary; §4.5
  drop order.
- F-010 (S5): reason from rotation (`roll_keep 5`), list every token-bearing route, state current access, never change owner/mode of
  live files; accept on "log grows after one probe".
- F-011..F-013 (LOW): W0 workstation-side ancestry/diff; runbook header + prompt cron wording; recompute sealed sha from Git blobs;
  record alarm de-duplication as an open item.
