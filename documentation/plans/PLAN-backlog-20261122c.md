# PLAN: backlog run 22 Nov 2026 (c), owner decisions 1-8 of 2026-11-22 (round 2)
DOC: plan for the orchestrator run on branch claude/backlog-20261122 (worktree D:\dev\afldb-backlog-20261122), base origin/main 731a5025.
DOC: authority = owner decisions 1-8 of 2026-11-22 relayed by the main session; CLAUDE.md sections 1-14 govern; streamanator/Git (local) authorised for this task.

## 0. Boundaries (binding on every step and every spawn)
- Local commits only on `claude/backlog-20261122`; NO push; no AI/Co-Authored-By trailers (owner rule for this run).
- NO production contact (no SSH/HTTP to `afldb` / 209.38.87.252, no prod write). A1/A2 run Tue 24 Nov in the main session, not here.
  Production facts come only from `R0-SITTING-20261122.md`, `OWNER-PACKET.md`, `kits/KITS-20261122.md`, `RC-371-372.md`.
- streamanator via `ssh -o BatchMode=yes -i ~/.ssh/afldb_dev arm@10.0.40.100`; READ-ONLY on every existing workspace, the R0 backup
  (`/mnt/ssd/afldb-post7r3-20261121T155248Z/`), `/home/arm/afldb-ops`, the five named databases and preserved paths. New work only in
  fresh workspaces `/mnt/ssd/afldb-backlog-20261122c-*`, no sudo, never `fuser -k 3100`, never the DEV service/.env. Delete nothing
  (outside a new workspace's own scratch). No `wsl`; never `D:\tmp\afldb-v2-pg16`, `D:\afldb-retained\*`.
- `/mnt/ssd/afldb-backlog-20261122b-348`: READ-ONLY like every other existing workspace; its stopped cluster is NOT started by this
  run (reviewer amendment F-001: a start writes pid/WAL/stats into an existing workspace holding production-derived data, outside the
  owner boundary). If the F-2 review cannot be completed from tracked evidence + `ev-private/` files, W-348 STOPS and reports the
  exact missing fact; the orchestrator takes it to the owner. `ev-private` row data stays out of tracked files (ids/aggregates; the
  8 heights with player id/name are allowed, public AFL data).
- No secrets/DSNs in chat, evidence or commits.

## 1. Verified facts this plan builds on (orchestrator, read-only, 22 Nov)
- `deploy/release.mjs` `checkRevision` (`:960-964`) checks only `git cat-file -e <rev>^{commit}`; `cmdBuild` (`:1005-1074`) extracts
  with `git archive <revision>` (`extract`, `:984-1003`). Neither requires checkout HEAD == revision nor a clean tree. RC-371-372.md §1's
  claim is WRONG; correct it by a dated revision note (no rewrite of evidence history).
- `git diff --name-only`: `cf158d60..7d92042f` has zero paths outside docs/, documentation/, issues/, root *.md;
  `7d92042f..731a5025` non-records paths = tools/rebuild/draftguru/{draftguru-contract.json,import_draftguru.py,parse_draft_snapshot.py},
  legacy/offline/.../acquire_draft.py, tools/v2/rebuild-tier-p.ts, 3 tests; `c8d4202a..7d92042f` non-records paths = .env.example,
  src/app/admin/awards/revalidate/route.ts, src/app/admin/brownlow/actions.ts, src/app/api/internal/revalidate-season/route.ts,
  src/lib/admin/award-season-fanout.ts, tools/maintenance/revalidate-season.ts and 7 test files; no migration.
- Every file A2 installs/executes from the checkout has an equal blob at c8d4202a and 7d92042f (settle-failure-status d80838cb, host
  policy 183691d9/4a277b8b, Caddyfile.production f00859d5, offhost-pull ea48205a, scheduled-backup c318c4a5, restore-test 8a0ac676,
  five backup units, notifier template/drop-in 4463e1e0/63d62718, backup.sh 776d066e, post-install-check 3d0bb2a9). So A1's
  fast-forward of the serving checkout to 7d92042f does not change what A2 installs or what the R2 forced command runs.

## 2. Steps

### S1. Decisions record + RC correction (orchestrator)
- New `docs/v2/evidence/backlog-20261121/DECISIONS-20261122c.md`: decisions 1-8 verbatim-in-substance, main-session findings (a)-(d)
  with this run's re-derivation, R5 retain, R6/R7 proposals, workspace table after the decisions (RUN-20261122b §6 pattern; which become
  unnecessary after A1).
- `RC-371-372.md`: dated "Revision 2026-11-22c" note at top + corrected §1 row "Revision to build" and §3 step 2 (`git fetch`, then
  `git merge --ff-only 7d92042fd11010eaa20966e2f49ae7a93e286568`; P2 STOP re-derived for exactly `c8d4202a..7d92042f`: the 13 paths
  above are the reviewed delta, any other non-records path is a STOP). Original text kept, struck through or quoted as superseded.

### S2. Attended runbook A1+A2 + fresh-session prompt (orchestrator)
- `ATTENDED-PLAN-A1-A2-20261124.md`: pre-window read-only checks (packet common probe adapted to the c8d4202a→7d92042f transition),
  A1 steps P0-P6 + owner env/restart (secret-safe: value generated into `.env` by the owner, never echoed; counts only) + acceptance +
  rollback; A2 R1, R2 (key line + FIRST MANUAL RUN ONLY; the hourly cron is a SEPARATE, still-unapproved step — packet R2 lists the hourly
  job as part of R2's commands, so this is stated explicitly), R3 (disposable restore target verified BEFORE the restore test; first off-host
  copy verified; the daily pull cron line treated like R2's cron: state packet position), R4; owner sudo one per block; per-step acceptance;
  STOP/rollback triggers; safe boundaries; time budget 10:00-10:30 / 10:30-12:00; times to avoid. Email delivery (verified 22 Nov,
  731a5025) recorded separately from the R2 install.
- Mark `ATTENDED-DRAFT-20261122b.md` superseded for A1/A2 (header note only).
- `FRESH-SESSION-PROMPT-A1A2.md`: pins origin/main 731a5025, candidate 7d92042f, rollback c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC, previous
  BUILD_ID aATnIlFOIQjq2z5oDdoHC; SSH convention (`C:\WINDOWS\System32\OpenSSH\ssh.exe -o BatchMode=yes afldb`, LF script, one session per
  step, no rapid retries: IPS).

### S3. ISSUE-348 F-2 decision review (worker W-348, parallel with S6)
- `issue348-acquisition/F2-DECISION-REVIEW.md`: per group (31 name_key, 1,472 source_record_id, 101 draft_age, 8 heights; plus the other
  undeclared columns found: reported_games/goals, dg_person_id rank, confidence_notes, notes relabel, import_batch_id): generating code
  `file:line` (tools/rebuild/draftguru/*, importer), identity-linkage impact (dg_person_id <-> player links, link state both directions,
  from `sealed/logs/characterise.json`, `compare.json`, state-*.json), counts; all 8 heights with player id, name, before, after, source
  page/field. FINAL WRITE SET (tables x columns x counts) and PLAN DIGEST (re-sealed only if the plan changes; else state the existing
  digests from SEALED-PLAN §1). F-1 recorded as owner-accepted. Load stays outside A2.

### S4. R5/R6/R7 records + reboot-deferral consequence (orchestrator, in DECISIONS §R5-R7)
- R5 retain (no disposal). R6/R7 date-relative proposals (owner return date unknown; ask), alternate-operator requirements (console,
  sudo, exact R6 steps), consequence of deferring kernel 6.8.0-149 from the records only (procedures 02/03, hostops, R0): named CVEs (or
  "none named in the records"), live-patch status (record or "unknown; read-only probe proposed"), forced-reboot risk, unattended-upgrades
  interplay, how R1 changes the risk. R7 unscheduled; five databases retained.

### S5. R8 fresh production plan draft (orchestrator)
- `R8-OPENING-PLAN-2027-DRAFT.md`: Tue 23 Feb 2027 11:00 AEDT, procedure 01 §5 with R = the serving revision after A1 (7d92042f;
  re-derive profile pins), prod-stage.sh as afldb_import, `revalidate-season.ts --season 2027`, G0/G0b/G0c, dependencies on A1 env and
  R2/R3. Not executed; approval text left blank.

### S6. ISSUE-373 investigation (worker W-373, parallel with S3)
- `issue373-gc-investigation/README.md`: classify 118 (78 unsupported + 40 criterion disagreement; the 40 are all `brother x *` per
  `gp1_gridley-summary.json`), per class mechanism (solver code src/search grid solver, criterion definitions, sibling data), smallest
  fixes with test homes; implement only clearly-correct small test-covered fixes that do not change modelling rules or Gridley corpus
  semantics; else proposal only. Verify on streamanator in `/mnt/ssd/afldb-backlog-20261122c-373` (read the 363 workspace's report bodies
  read-only; fresh template copy into a NEW cluster if a re-run is needed).

### S7. OPEN-ITEMS-AFTER-SITTINGS.md (orchestrator)
- Per sitting (A1, A2, later reboot/housekeeping, 348 load, opening): what stays open and exact closure evidence for 371, 372, 351, 352,
  332, 357, 362, 350, 348, 373, 363 follow-ups.

### S8. Trackers + commits (orchestrator)
- issues.md / IssuesIndex.md (state + next action for 332, 348, 350, 351, 352, 357, 362, 371/372, 373); CHANGELOG only if S6 changes
  behaviour. Small local commits, no trailers, no push. Persist every return to `.phaneslight/returns/backlog-20261122c/` first.

### S9. Closure (afldb-closure)
- Re-derive: diffs above, file existence, tracker sync, edit disclosure vs `git diff`; if S6 changed code, focused tests/typecheck on
  streamanator in a fresh workspace. Output is a flag.

## 2a. Reviewer amendments (afldb-reviewer launch review, 2026-11-22; binding on the steps above)
- **F-001 (S3, §0).** The 22b-348 cluster is not started (see §0). A plan-changing F-2 outcome is a proposal: no re-seal, no new
  rehearsal in this run.
- **F-002 (S2, env block).** The runbook must not reuse RC §3 step 5 as one paste block. Required: (a) pre-check that `.env` ends with
  a newline (`tail -c1 .env | wc -l` = 1) and both name counts are 0; (b) append; (c) counts 1 and 1 and total line count = before + 2;
  (d) the `sudo systemctl restart afldb` is its own block, run only after (c) passes; (e) on a failed (c), restore the backup with
  `cp -p`, no restart. No `set -x`, no `cat`/`grep` without `-c` on `.env` or `/proc/*/environ`. The `~/env-before-revalidate-*.bak`
  file holds every production secret: list it in OPEN-ITEMS with a disposal step.
- **F-003 (S2, A1 acceptance).** Add the owner's two named checks as explicit steps BEFORE promote: (i) on the production checkout
  after fetch, `git diff --name-only cf158d60 7d92042f` shows records paths only; (ii) the built release's `release.json` revision is
  the full `7d92042fd11010eaa20966e2f49ae7a93e286568` and the release id starts `7d92042fd110-`. Either failing = STOP before
  promotion (nothing to roll back). Also record why the fast-forward is still needed although `build` does not require it:
  acceptance runs `tools/maintenance/revalidate-season.ts` and `deploy/post-install-check.sh` from the checkout, and the former
  changed in `c8d4202a..7d92042f`. P2 gets `git merge-base --is-ancestor HEAD 7d92042f…` before and `git rev-parse HEAD` after.
- **F-004 (S2, timing).** P3 is 15-25 min (RC §6); P0-P6 + env + restart + acceptance does not fit 10:00-10:30. The runbook states
  both options for the owner to choose in writing before the day: P0-P3 from about 09:25 (P2 changes the checkout, P3 loads the host,
  neither changes what is served), or A1 overruns and A2 shrinks. Not assumed either way.
- **F-005 (S2, A1/A2 interlock).** State the A2 entry condition for each A1 outcome (accepted; stopped before promotion; rolled back)
  with the expected probe values for each (HEAD, `current`, `previous`), and re-derive every `c8d4202a` pin in packet R1/R4/common
  rules (R1's `status --expect`, R4's approval text: the sha256 `f00859d5…` is the binding check, not the commit). RC acceptance 6
  (about 30 min observation) overlaps A2: R4's Caddy reload goes LAST and only after the A1 observation has closed, so a 5xx is
  attributable; R1-R3 touch neither the service nor Caddy.
- **F-006 (S2, crons).** Packet R2 Target and command 3 DO include the hourly job, and packet R3 Target includes "a daily job", but
  neither approval text names a cron, the owner said "first manual run only", and both kit cron lines carry a blank
  `AFLDB_ALARM_CMD`. Runbook: neither cron is installed in A2; each is a separately marked, unapproved owner step with its exact
  line, and both facts are put to the owner as one question. State the consequence: until the daily pull exists, R3's "within 25 h"
  acceptance and ISSUE-352 closure stay open, and R6/R7 rely on a manual second pull.
- **F-007 (S2, restore targets).** Two targets, two checks: production `afldb_restore_test` before `afldb-backup-verify.service`
  (exists, `numbackends` 0, the unit and `restore-test.sh:41` name exactly that database, nothing else uses it); streamanator
  first-copy restore only into a NEW `/mnt/ssd/afldb-backlog-20261122c-*`-style 0700 scratch cluster on a new port, loopback only,
  stopped and deleted after the record.
- **F-008 (S6, fix boundary).** W-373 returns a classification and proposal first; no code edit before the orchestrator has read it.
  Proposal-only, never implemented here: any change to the `brother` criterion definition or sibling data, to which cells count as
  supported, to the G-c gate or its expected values, or to the Gridley corpus (CLAUDE.md §10: no weakening of coverage). A fix is
  eligible only if a per-cell diff of a full re-run shows zero change among the 10,209 solved cells and only the targeted cells
  moving, with a new assertion in `tests/grid-solver*.test.ts`. Any re-run uses a new cluster in `…20261122c-373`, database name
  ending `_test`, built from a file-level copy of a stopped source or a dump; the 363 workspace is never started or written.

## 3. Risks
- Writing a production runbook without production contact: every production fact is cited to R0/packet; the pre-window probe re-reads it
  and any difference is a STOP.
- Concurrent workers editing the tree: workers write only their own new files (+ S6 code/tests); only the orchestrator runs Git and edits
  trackers.
