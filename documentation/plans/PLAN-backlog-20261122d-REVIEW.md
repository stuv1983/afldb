# REVIEW: PLAN-backlog-20261122d (launch plan review, afldb-reviewer, 22 Nov 2026)
DOC: launch plan review of `PLAN-backlog-20261122d.md`; graded findings F-001..F-014 with amendments; no code touched, nothing executed.
DOC: verdict = NO CRIT, NO HIGH; the run may proceed once the MED amendments are folded into the steps named. Read from disk, not from the brief.

## Verdict
No CRIT/HIGH. Nine MED amendments (binding on the named step), five LOW/INFO (no work). Nothing was run; streamanator/production state is unverified by me.

## Answer to the PREP question (S1): sufficient, with one addition
Checked on disk: `a1-p1-precheck.sh:18,28` and `a1-p2-ff.sh:24,32,34` take PREP as an argument and use it only for (a) `ls-remote`/`origin/main`
equality and (b) `merge-base --is-ancestor CAND PREP`. `731a5025` occurs only in comments (p1:6,10; p2:3,9,13); no other `a1a2-20261124/*` script
contains it. P2 merges `--ff-only "$CAND"` (p2:47), `a1-p3-build.sh` builds the pinned revision, and A2 runs from the production checkout at CAND
(or c8d4202a; 16 files byte-equal per `a2-p0-entry.sh`). Nothing in A1/A2 executes checkout code from `7d92042f..PREP`. "Descendant of 7d92042f" is enough.

## Findings
- **F-001 MED (S3, plan:43-44) stub bypass can hit the real crontab.** A stub "first on PATH" is bypassed if the script resets PATH (every a1a2
  script does, e.g. p1:14) or calls `/usr/bin/crontab`. Amend: the script takes `CRONTAB_BIN` (default `crontab`), never resets PATH before it; the stub
  logs each call; the dry test asserts stub call count > 0 AND `crontab -l | sha256sum` of the REAL crontab is byte-equal before and after the test.
- **F-002 MED (S3, plan:39-41) read-modify-write can wipe or corrupt arm's 24 existing lines** (`KITS-20261122.md:17`). `crontab <tmpfile>` replaces
  everything. Failure cases: `crontab -l` fails/returns empty and is treated as "no crontab"; last existing line has no trailing newline so the append
  joins it. Amend: STOP on `crontab -l` non-zero or fewer lines than the recorded baseline; keep a 0600 pre-image backup and print its path; ensure a
  newline before appending; after install require `diff pre post` = exactly the two added lines (marker + job), else restore the pre-image. Add all three to the dry-test cases.
- **F-003 MED (S3, plan:38-39) preconditions do not encode the owner's ordering, and "refuses" is not idempotent.** r2 checks only sha + sender; it could be
  installed before the manual run. Amend: r2 requires the last line of `state/settle-check.log` to be `rc=0 AFLDB_SETTLE_STATUS OK` dated today (UTC window);
  r3 requires the `.verified-<name>` marker to match the newest dump + sidecar. Re-run with marker AND identical line present = `ALREADY INSTALLED` exit 0
  after the exactly-one verification; marker present with a different line = STOP. Add `remove r2|r3` (same guards, dry-tested): six weeks of leave need a tested removal path.
- **F-004 MED (S3) the dry test must never execute the wrappers.** `kits/afldb-settle-check.sh:11,15` and `afldb-offhost-pull-daily.sh:10,14` default to the
  production address; running either now is a second, unapproved production contact. Amend §0/S3: wrappers are hashed only; any test of the alarm path uses
  `AFLDB_PROD_SSH=arm@afldb-nonexistent.invalid` and a scratch `AFLDB_OPS_STATE` (the pattern at `KITS-20261122.md:47`).
- **F-005 MED (S3) no acceptance check for the alarm path under cron's environment.** The first scheduled run is the rc=0 path and never invokes
  `sh -c "$AFLDB_ALARM_CMD"`. If the sender depends on PATH/HOME that cron lacks, a real failure exits 4 silently during the leave. Amend: add an A2 step (owner
  consent, one email): the exact cron command under `env -i HOME=/home/arm LOGNAME=arm SHELL=/bin/sh PATH=/usr/bin:/bin` with the `.invalid` host and scratch state;
  pass = alarm received. Also confirm cron's timezone on streamanator before quoting `10 3`/`17` as AEDT (the script prints Melbourne time; state which TZ cron uses).
- **F-006 MED (S4, plan:48) the single production session has no rehearsal.** A syntax/quoting error burns the only contact. Amend: `bash -n` plus one full run of
  `check.sh` on streamanator first; `main "$@" </dev/null` wrapper; one overall `timeout`; no `apt changelog`/`apt-get` (network); run outside 02:10-02:40, 04:50-07:15.
  Unconfirmed external behaviour, for the orchestrator (context7/docs): whether unprivileged `pro status` makes a network call; prefer the cached status file and `canonical-livepatch status`.
- **F-007 MED (S6, plan:66-67) prefer not starting the preserved cluster.** Run c's reviewer F-001 (`PLAN-backlog-20261122c.md:13-14`) forbade it: a start writes
  pid/WAL/stats into the workspace that holds the seal, and it binds TCP `127.0.0.1:61540` (`SEALED-PLAN.md:90`). Amend: `cp -a` the stopped PGDATA into
  `/mnt/ssd/afldb-backlog-20261122d-348` (0700) and start the COPY socket-only (`listen_addresses=''`), `default_transaction_read_only=on`. Only if a copy is impossible:
  `pg_controldata` "shut down" before and after, port-free check, `-m fast` stop, and the check script may not modify `sealed/` (the digest SQL sha `ae742dcc…` is pinned).
- **F-008 MED (S6, plan:68) the window proposal omits the decisive constraint.** `digest pre` must equal `expected-pre.txt` = the R0 state, and the digest covers whole
  `players`, `data_edits`, `data_overrides` and every DraftGuru row (`draftguru-surface-digest.sql:36-43`; `SEALED-PLAN.md:70-73`). Any admin edit or settle touching
  those tables stops the sitting and forces a re-rehearsal. LOAD-WINDOW-PROPOSAL must state this per option: a 7 Jan 2027 window should be costed as "re-rehearse and re-seal expected-pre/post".
- **F-009 MED (S4/S5/S6/S9) Wed 25 Nov is triple-booked and A2 has no slack.** A warranted R6 reboot (needs R3's first nightly, Wed 02:20), the 348 load option and
  the leave on Thu 26 all land on Wed 25; A2 is already 75 of 90 min (`ATTENDED-PLAN:142-192`) before two cron installs, the F-005 test and the R5 sudo block, and
  T-2 starts A2 at 10:45. Amend: run S4 before S2/S6 conclude; S9 presents ONE Tue/Wed schedule; S5 states where R5 sits (after R4 step 10, own safe boundary) and §4.5's drop order.
- **F-010 MED (S5, plan:55-58) R5 "retain" vs Caddy rotation, and a restriction that could stop logging.** `deploy/Caddyfile.production:283-285,397-399` set
  `roll_size 20MiB`, `roll_keep 5`: Caddy deletes rolled pre-fix files itself, and the live file keeps pre-fix lines until it rolls. The proposal must reason expiry from
  that (roll_keep_for default: orchestrator to confirm), enumerate every token-bearing route (not only invite and magic link), state current access from the records
  (files are already `caddy:caddy 0600`, `ATTENDED-PLAN:203`; the block may be directory-only or a no-op), never change owner/mode of live files, and accept on "log size grows after one probe".
- **F-011 LOW (S1, plan:27)** run the ancestry check and `git diff --name-only 7d92042f PREP` on the WORKSTATION at W0 (p1 header claims ancestry but its body cannot check it);
  never as an extra production command. Also fix the runbook header (`ATTENDED-PLAN:6-8`, "or either cron line") and `FRESH-SESSION-PROMPT-A1A2.md:18,31,53`, not only §4.2/4.3/4.6.
- **F-012 LOW (S6, plan:61)** recompute sealed sha256 from Git blobs or on streamanator, not from Windows working-tree files (CRLF conversion gives a false "seal broken").
- **F-013 LOW (S3)** the wrapper has no alarm de-duplication: an unreachable production means one email per hour for the leave; record as an open item. The R2 notifier marker stays unapproved.
- **F-014 INFO** dates verified: 19 Feb 2027 is a Friday, 23 Feb 2027 a Tuesday, 7 Jan 2027 a Thursday. Git commits, streamanator SSH, the production session and the
  public `curl` (plan:3,50) rest on owner authorisation relayed by the main session; an agent message is not consent (CLAUDE.md §9/§12), the main session must hold it.

## Not found missing
Decisions 1-9 each map to a step (S1-S9). ISSUE-373 overlap claim matches `issue373-gc-investigation/README.md:19` (five cells carry two findings).
