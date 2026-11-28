# R6 r6: independent review of the backup-origin attestation (28 November 2026)

Reviewer: independent; did not write any of r6. Judged from git objects and logs only.
Delivered head judged: `4a88f68d` (review revision), tested revision `bda102aa`. Coordinator's claim checked: `git diff --stat 297175f9 bda102aa`
touches exactly four files (ATTENDED-PLAN, RUNBOOK, release `scripts/SHA256SUMS`, `review-fixes-r3-20261124/run-printed-blocks.sh`, which only
adds `review-fixes-r6-20261128` to the r4 FIXPATHS); every gate, attest, parser and suite byte is identical, so the real-systemd logs taken at
`297175f9` apply to `bda102aa`/`4a88f68d`. `bda102aa..4a88f68d` changes only CODE=/revision text in ATTENDED-PLAN and RUNBOOK.

Reproduction logs written by this review: `logs/review-real-systemd-arm.log` (real systemd 255.4-1ubuntu8.19 on streamanator, pinned base
image, flags as the harness, no `--privileged`; workspace, container and image removed afterwards) and `logs/review-harness-inputs.log` (the
exact harness changes: the gates under test were the unmodified `67119fd6…` and `92425f2a…`).

## Question 1: can an arm-controlled process produce evidence that either gate accepts as protected?

**YES.** The root record chain itself held against everything I tried, but the gates' verdict does not rest on the record alone, and two
arm-only paths make both gates accept what the timer's run did not produce. One of them needs no root record at all.

**What holds (record level, NO arm path found).**
- Writer (`attest/afldb-backup-attest`) runs as root through `env -i` + `bash --noprofile --norc`, `cd /` first, absolute helpers, and reads
  only PID 1 (job ActivationDetails, unit/timer properties) and `/proc`. The only arm-reachable inputs to the `+` command are the unit's
  `WorkingDirectory=` (a root `chdir` into arm's tree, after which bash reads nothing from cwd) and the unit environment (root-written
  `Environment=` only; `env -i` drops it before bash; `EnvironmentFile=` is refused by the gates). No privileged component executes or
  sources arm-writable code: `ExecStart` keeps `User=arm` with `NoNewPrivileges` (attest-probe-p2.log:303), `afldb-backup-failed.service`
  runs as arm (uid 1000 in real-systemd-callers-restart-hidden-first.log journal).
- Record directory, writer, drop-in, both unit files and helpers: root-owned, no group/other write, no symlink (`trusted_path`, G0
  r1-g0-dump.sh:199-217; ACL masks show in the group bits, so an ACL grant is caught). The arm suite (genuine-attested log, RESULT-ARM-SUITE
  0) and my reading found no write, rename, hardlink, symlink, runtime or control drop-in, `systemctl edit/set-property/start`, or bus call
  that arm can make. Job-level ActivationDetails are fresh per job: a hand start carries `trigger_unit=none` (astra and forged logs).
- Journald trusted fields cannot be forged from outside the unit's cgroup.

**What fails (verdict level, YES).**
1. **arm replaces the gates' own journal parser (`~/.nvm` node). Reproduced.** Both gates execute `/home/arm/.nvm/versions/node/v22.23.2/bin/node`
   (G0 r1-g0-dump.sh:325, used at :129 via :308; A-2 r6-pre-verify.sh:421, :212 via :391). DESIGN.md:15 itself lists `~/.nvm` as
   adversary-editable. With a genuine 02:20 timer dispatch and its genuine root record left untouched (record sha256 identical before and
   after), arm (uid 1000, no groups, no root): deleted the timer's dump, planted `afldb_prod-20261128-022130.dump` with its own sidecar,
   and replaced `node` with a wrapper that rewrites the `backup ok` line. Result (logs/review-real-systemd-arm.log, `G0-NODESUB` block):
   `G0 PROD RESULT PASS`, exit 0, `PASS scheduled dump unique, is the dump the timer's invocation … reported`,
   `OFFHOST-COMPARE afldb_prod-20261128-022130.dump 14dc0954…`; A-2 section 5 also attributes and prints the same OFFHOST-COMPARE.
   No checkout file is touched, so P1/P2 clean-tree checks see nothing; the 03:10 off-host pull would copy the planted file, so the
   streamanator half agrees. This is not among the stated residuals (those cover what the attested run's own code writes, and a
   compromised login environment), and it is not exercised by the harness, which mounts node read-only and runs callers with `env -i`.
2. **arm's own shell startup decides what the gates print. Reproduced.** The gates are run as arm over ssh (`… | ssh afldb bash -s -- <day>`,
   r1-g0-dump.sh:31) or pasted into an arm shell (A-2, ATTENDED-PLAN). Ubuntu 24.04 bash reads `~/.bashrc` for an ssh-launched command.
   With the root record REMOVED (the honest gate prints `scheduled origin unproven`, exit 1, control run in the log), arm wrote only
   `~/.bashrc` defining a `bash` function; `ssh arm@… bash -s -- 2026-11-28 < r1-g0-dump.sh` then exited 0 with
   `G0 PROD RESULT PASS` and an `OFFHOST-COMPARE` line, and A-2 printed `R6 PRE RESULT PASS`, exit 0. The same holds for PATH-visible
   helpers: both gates call `systemctl`, `busctl`, `stat`, `sha256sum`, `awk`, `journalctl` by bare name and never reset `PATH` or clear
   inherited functions (G0 :316, A-2 :399). A-2 also runs arm-checkout code inside its own process tree (`release.mjs` via node :484,
   `deploy/afldb-settle-failure-status.sh` :488, `scheduled-backup.sh status` :537) and sources the checkout's `.env` (:539). The staged
   copy of A-2 under `/tmp` is arm-owned after its pin check.

**The gates running as arm, precisely.** This is verdict forgery, not evidence production in the record sense: nothing arm does changes
a root record. But the gate is the only reader of the record, and under DESIGN.md section 2's own adversary ("any process running as uid
arm") the reader is inside the adversary's domain. DESIGN.md:18-19 states a compromised login environment as a residual; it is the same
cost as the r5 attack (edit one arm-owned file) and needs no timer dispatch at all, so the r5 MED is relocated, not closed, at the verdict
level. Item 1 above is not covered by that residual.

## Question 2: did the unchanged A-2 caller itself emit the result in each real-systemd case?

**YES**, for all nine scenarios, with the scope noted.
- Hash: every log prints `callers (unmodified, run from the read-only export): G0 67119fd6… A-2 92425f2a…`; both equal the blobs at
  `297175f9`, `bda102aa` and `4a88f68d` (checked with `git show <rev>:<path> | sha256sum`). The harness runs them from the `:ro` mount.
- Arguments: `accepted 7d92042fd110-XWruOm_9nLCSMY8nGPqYU r3:yes r4:no 10:00 tue:deferred inv:342040625f6d4012a35d598dfbf9afe6`, a valid
  set for `tue:deferred` (r6-pre-verify.sh:400-410); no usage STOP; every A-2 run reaches its own `R6 PRE RESULT` line.
- OFFHOST-COMPARE: the harness never prints one (container script: only greps and comments mention it). In all nine logs every
  `OFFHOST-COMPARE` line sits inside a caller's `BEGIN … stdout (verbatim)` block; 0 outside.
- Separation: each log has `RESULT-A2 … whole caller` (exit 1, `R6 PRE RESULT STOP`, 23-24 FAIL lines, all container-unrelated and listed)
  separately from `RESULT-A2-S5`. A section-5 attribution is never called an A-2 PASS (VERDICT: "NOT a full A-2 PASS").
- Per scenario: genuine-attested and timer-rearm: G0 exit 0 PASS, A-2 S5 attributed, whole A-2 STOP. The other seven: G0 exit 1
  `scheduled origin unproven`, A-2 S5 refused, no OFFHOST-COMPARE, whole A-2 STOP. forged-trigger-manual contrast: 624bf721 G0 exit 0 with
  OFFHOST-COMPARE (r5 defect reproduced), r6 refuses.
- Scope: the callers ran with a clean `env -i` and a read-only node, so these logs say nothing about the gates' execution environment
  (Question 1, items 1-2).

## Findings

**MED-1: the dump-to-invocation link runs through an arm-replaceable binary.** r1-g0-dump.sh:325/:129/:308, r6-pre-verify.sh:421/:212/:391.
Scenario: genuine timer run and genuine record; arm replaces `~/.nvm/…/node`, plants a dump; G0 PASS + OFFHOST-COMPARE of the planted file
(reproduced). Contradicts DESIGN.md:15, which names `~/.nvm` as adversary-writable, and is not a stated residual.

**MED-2: the r5 finding is not closed at the verdict level under DESIGN.md section 2's adversary.** r1-g0-dump.sh:316 and r6-pre-verify.sh:399
(no PATH or function reset; bare helper names), :31 (ssh `bash -s`), A-2 :484/:488/:537/:539 (arm checkout code and `.env` inside the gate).
Scenario: no record; arm edits `~/.bashrc`; both gates print PASS, exit 0 (reproduced). DESIGN.md:18-19 lists this as a residual. It costs
the same as the r5 attack (one arm-owned file) and needs no timer dispatch. "Out of arm's reach" (r1-g0-dump.sh:92-94) holds for the record
only. A gate that must be trusted against arm has to run as a principal other than arm, for example a root-run or root-owned reader whose
output arm cannot shape.

**LOW-1: the cited implementation record does not exist.** `review-fixes-r6-20261128/README.md` is absent at `4a88f68d`, but ATTENDED-PLAN:915
and RUNBOOK:34 link to it as "Record", and DESIGN.md:5 says deviations are stated there. The item-4 deviation is recorded only inline in
DESIGN.md:96-98.

**LOW-2: the manual re-arm statement is imprecise.** DESIGN.md:113 and r1-g0-dump.sh:114-115 say a `systemctl restart`/`start` of the timer
"IS a timer dispatch". It dispatches only when `Persistent=` finds a missed elapse (stamp older than the last calendar time), as in the
timer-rearm fixture (timer stopped across 02:20, stamp from the night before). A re-arm after the night's dispatch fires nothing. The
consequence is stated accurately in the timer-rearm VERDICT: G0 PASSes on a root re-arm inside the window, and only the INFO line ("0.0 s
after … last (re)activation" against 93.0 s in genuine-attested) shows it.

**INFO-1: the restart case is distinguished, by exactly one check.** Real systemd keeps the timer's job across `systemctl restart`: same job 151,
`JobType=start`, same ActivationDetails `trigger_unit=afldb-backup.timer` and usec, new invocation (restart-hidden-first live capture). Only
`(( ie < tm ))` (r1-g0-dump.sh:285, r6-pre-verify.sh:368) refuses it. Loosening that check re-opens the case.

**INFO-2: the item-4 relaxation (no order between inactive_exit and exec_main_start) is safe.** With `ie < tm` (no inactive or failed state
since the dispatch) plus `tm <= ix`, `tm <= xs` and both within 5 s, the only exit from inactive since the dispatch is this invocation's, so the
order of the two stamps adds nothing. The measured order (xs about 0.2 ms before ix with no ExecStartPre; attest-probe-p1 P3,
genuine-attested `[HARNESS]` line) matches.

**INFO-3: semantics of item 4.**
- First run after boot: `inactive_enter_mono=0` passes (attest-probe-p1, review log).
- Exit 75: `SuccessExitStatus=75` runs the writer and records status 75, which the gates refuse. That is correct, because such a run has no dump.
- Persistent catch-up at boot: refused by the 02:20-02:31 window anyway. If it does fall in the window, `Requires=/After=postgresql.service` can
  push ix and xs past 5 s, giving a false STOP. That is fail-closed and was not tested.
- journald delay: affects only the pre-existing `backup ok` window (be + 5 s), not the record.
- A non-genuine run could be accepted only through root actions: a root re-arm, a root-added `Restart=`, or other drop-ins. The gates do not
  pin unit content beyond ownership and the single ExecStartPost.

**INFO-4: `boot_id` and `written_realtime_usec` are recorded but checked by no gate.**

**INFO-5: parser.**
- The new TOKL/TOKR rule is applied to released and deferred, and to the wrapper header (r6-tuesday-handoff.sh:138-146, :186).
- f1 suite rerun by me on the workstation from `git archive 4a88f68d`: `SUITE f1 RESULT PASS (202 cases)`. It covers backtick, punctuation,
  ellipsis and end-of-line variants for both outcomes, and valid released/rolledback/deferred PASS.
- My extra probes against the 24 Nov record: CRLF, backtick and ellipsis forms STOP. `release:<TAB>PROMOTED` and `release:  PROMOTED` (inner
  whitespace) are not traces; they are outside the boundary rule and unrealistic for a copied tool line.
- The 24 Nov `SITTING-20261124.md` gives `tue:deferred` / `7d92042fd110-XWruOm_9nLCSMY8nGPqYU` / `inv:342040625f6d4012a35d598dfbf9afe6`.
  Output under the 624bf721 and 4a88f68d parsers is identical except for the run timestamp.
- All four `SHA256SUMS-SITTING` files are byte-identical at 624bf721, 4a88f68d and the worktree, and match the manifest.

**INFO-6: pins match.**
- R6 heredoc at ATTENDED-PLAN:999-1016: 16 lines, sha256 `c06f5b61…bdab`. Every pin equals the blob at bda102aa, 4a88f68d and 297175f9, and the
  archive list equals the pinned set.
- Release `scripts/SHA256SUMS`: 12 entries all match the blobs, sha256 `cd4a7ad8…4a68`. At 297175f9 it still pinned the old G0 `32d7315a`, which is
  why the tested revision moved.
- Gates' `WS`/`DS` equal `attest/SHA256SUMS` lines 1-2 and the blobs; install and verify scripts match lines 3-4.
- `scheduled-backup.sh` equals the 17822b29 blob `234fca6a`.

**INFO-7: no regression from 624bf721..297175f9 in the earlier fixed areas.**
- In both gates, `pick_overnight_dump`, `ts`, `timer_usec`, `read_invocation` and `backup_journal` are byte-identical to 624bf721.
- In A-2, `match_restore`, `restore_journal`, `serving_release` and `attested_invocation` are also byte-identical.
- `match_backup` lost only the trigger-line code. `main` changed only the PASS line.
- The nine shared functions are byte-identical between G0 and A-2 (checked).

## Not verified
- Production itself:
  - how the units are installed (copy or `systemctl link`; a linked fragment fails closed);
  - arm's group membership (journal readability);
  - prod bash's `.bashrc` behaviour (tested on the pinned Ubuntu 24.04 image);
  - prod's systemd build.
- A real reboot with Persistent catch-up and a slow `postgresql` start; a root-added `Restart=` (auto-restart without passing through inactive);
  job merging when a hand start precedes the timer by milliseconds.
- f2, f3 and the in-container suites, and attest-probe: read from the logs (all PASS; attest-probe-p2 at the final gate hashes), not rerun.
- The coordinator's driver-proof rerun at bda102aa/4a88f68d: not seen.
- Housekeeping: Docker build-cache layers from the review image build may remain on streamanator. Labelled images, containers and the
  workspace were removed (0/0 left).
- In my reproduction log, the closing `VERDICT … RECORDED` line is the harness's canned text for `EXPECT=record` (it mentions a re-arm). For
  phases A and B, read the `RESULT-REVIEW-*` and `FINDING-REVIEW-*` lines.

---

## Addendum: re-review of delivered head 69d2a728 (tested 937c7d43), 28 November 2026

Scope: `git diff 4a88f68d 69d2a728`. I made no repository edits except this addendum and `logs/review2-*.log`, and ran no git writes.
My DEV reproductions used `r6rev`-labelled containers on streamanator. The workspace, containers and images are removed (0/0/0).

### Pins and identity (verified)

- The callers are the same blobs at 937c7d43 and 69d2a728: G0 `6a0a0e58…`, A-2 `eac16cec…`, writer `799e6691…`.
  937c7d43..69d2a728 changes only ATTENDED-PLAN and RUNBOOK.
- The R6 manifest heredoc in ATTENDED-PLAN (16 lines) hashes to `57c8aa50…`. Each of its 16 entries equals the blob at both revisions.
- Release `SHA256SUMS` is `9c4b6ca6…` at both revisions, and every entry matches its blob. Every entry in `attest/SHA256SUMS` matches
  too.
- `WS=799e6691…` and `DS=2a3a067e…` appear in both gates and in `install-attest.sh`, and `verify-attest-install.sh` carries the same
  WS. `HELPERS` and both gates' trusted-path lists include `/usr/bin/setpriv` and `/usr/bin/stat`.
- The nine shared functions are byte-identical between G0 and A-2: `pick_overnight_dump`, `ts`, `timer_usec`, `read_invocation`,
  `backup_journal`, `match_backup`, `trusted_path`, `attested_origin` and `scheduled_backup_run`.
- The `main` change is the same in both gates: G0 `r1-g0-dump.sh:357`, A-2 `r6-pre-verify.sh:549`.

Coordinator evidence I read:
- `logs/proof-driver-937c7d43-review-69d2a728.log`: run 1 has `case results: 658 OK, 0 UNEXPECTED` (line 1737) and the
  release-scripts-manifest is OK at `9c4b6ca6…` (line 100). Run 2's sabotage is reported as UNEXPECTED, as intended, and the log ends
  `R6 r4 DRIVER PROOF PASS`.
- `logs/release-rehearsal-937c7d43.log`: `REHEARSAL RESULT PASS: 92 passed, 0 failed`.
- `attest-suite-f2-streamanator.log`: `SUITE f2 RESULT PASS (308 cases)`.
- `attest-probe-p4.log`: `ATTEST PROBE RESULT PASS`, including P8, P9 and P10.

### Question 1 (69d2a728): can an arm-controlled process produce evidence that either gate accepts as protected?

**YES, at the evidence level, by one remaining path: in-run substitution. The post-run paths (my MED-1) are closed.** The
gate-execution-environment path (MED-2) is unchanged and is stated as an owner decision.

**(a) Post-run evidence (MED-1): CLOSED.**

I re-ran my node-swap attack on real systemd against the new gates and writer (`logs/review2-real-systemd-arm-node-swap.log`):
- Arm deleted the timer's dump.
- Arm planted `afldb_prod-20261128-022130.dump` with its own sidecar.
- Arm replaced `~/.nvm/.../node` with a rewriting wrapper.

Both callers refused, and the cause was the record binding itself: "record … binds the dump afldb_prod-20261128-022003.dump, but the
run's 'backup ok' line (read through node) names afldb_prod-20261128-022130.dump". Neither caller printed OFFHOST-COMPARE.

Why the binding holds:
- The record is root-owned and binds both the name and the full sha256.
- `main` compares the gate-time re-hash against the record's full sha, and that re-hash must also equal the sidecar.
- The invocation comes from `systemctl show` (PID 1), not from node.
- The record's trigger usec must equal the gate-time `LastTriggerUSec`.

After the run, the evidence level therefore cannot be made to pass by a node swap, a planted, deleted or re-sidecarred file, or a replay
of an earlier night's genuine record. The coordinator's P10 (`attest-probe-p4.log:545-572`) and the final2 `arm-node-swap` scenario
show the same.

**(b) In-run substitution by an arm process OUTSIDE the unit: OPEN, and deterministic (not a race).**

Reproduced on real systemd: `logs/review2-real-systemd-review-race.log`, with its inputs in `logs/review2-harness-inputs.log`.
1. A watcher started as arm before the dispatch, in cgroup `0::/`, outside `afldb-backup.service`. It touches nothing else: not the
   checkout, the unit, the record, the sidecar or node.
2. When `backup.sh` started, the watcher SIGSTOPped its parent `scheduled-backup.sh` (same uid, cgroup
   `/system.slice/afldb-backup.service`). The child ran on.
3. When `backup.sh` became a zombie, the watcher renamed hand-made bytes over the dump and sent SIGCONT.
4. `scheduled-backup.sh` then wrote the sidecar and the `backup ok` line over the substituted bytes.
5. The root writer, hashing as arm while the job was live, recorded `dump_sha256=5884ee1d…`, which is the hand-made bytes. The real
   bytes were `1c51838d…`.

Result: G0 exited 0 with `G0 PROD RESULT PASS` and `OFFHOST-COMPARE afldb_prod-20261128-022003.dump 5884ee1d…`. A-2 section 5
attributed it: "PASS scheduled 02:2x dump is unique, … its root record bound (full sha256)", with the same OFFHOST-COMPARE.

Timing is not a factor, because the parent is held until the child has exited. On production, pg_dump runs for minutes.

The two failed attempts are kept as evidence:
- `-attempt1`: the stop landed after the sidecar was written. The binding caught it (the record had `502410a6…`, the `backup ok` line
  `5349fb43…`), and the gate refused. This shows that substitution after the sidecar is caught.
- `-attempt2`: my watcher bug (a `kill -0` loop on a zombie) left the run stopped, and the gate refused with "no completion".

**(c) Gate execution environment (MED-2): OPEN, an owner decision.**

The gates still run as arm, with bare command names and arm's shell startup. Only header and DESIGN text changed: G0
`r1-g0-dump.sh:33,130`, A-2 `r6-pre-verify.sh:45,212`, DESIGN §5 line 138. I did not re-run the `~/.bashrc` forgery, because nothing
in the delta could affect it.

### Question 2 (final2 at 937c7d43): did the unchanged A-2 caller itself emit the expected result in each real-systemd case?

**YES for section 5 in all ten scenarios, read the same way as in round 1.**
- Every final2 log prints caller hashes G0 `6a0a0e58…` and A-2 `eac16cec…`, which equal the blobs.
- The whole A-2 caller printed `R6 PRE RESULT STOP` with exit 1 in every scenario. That is expected: there is no database, and there
  were 18 or 19 unrelated FAIL lines outside section 5 plus 5 inside it.
- A-2 therefore never emits PASS itself. The section-5 verdict is the harness's extraction from A-2's own output:
  - `genuine-attested` and `timer-rearm`: attributed, with exactly 1 OFFHOST-COMPARE inside each caller's stdout.
  - The other eight: refused, with 0 OFFHOST-COMPARE.
- Across all ten logs, OFFHOST-COMPARE appears 0 times outside the caller stdout blocks.
- In final2, `arm-node-swap` was refused for the dump-binding reason (line 675).

Caveat: the final2 bda102aa CONTRAST is inert. It is refused because the installed writer no longer matches bda102aa's pin, so it shows
nothing about MED-1. The MED-1 bypass on real systemd is shown by `smoke-real-systemd-callers-arm-node-swap.log` (bda102aa G0 exit 0
with OFFHOST-COMPARE of the planted dump) and by my round-1 log.

### Writer regression check (`attest/afldb-backup-attest` @ 799e6691)

- **setpriv (`:103-104`): OK.**
  - The child runs under `--reuid=arm --regid=arm --clear-groups --no-new-privs --reset-env`, then `bash --noprofile --norc -c` with a
    constant script and `cd /`. No startup file, `BASH_ENV` or inherited env reaches it.
  - Root's `/usr/bin/timeout -k 5 600` sits outside setpriv, so arm cannot stop the bound.
  - P8 (`attest-probe-p4.log:475-509`) shows that a mode-000 dump gives `dump=none`, which proves the hash is taken as arm.
- **Root never reads an arm path: OK.**
  - Root reads only PID 1 state, `$SELF` and its own record directory. Every `DUMPDIR` access (stat, sha256sum) is in the arm child.
  - The one byte stream root consumes from arm's domain is the child's stdout pipe (`out=$(…)`). It is regex-filtered (`:105-107`),
    and the journal line is sanitised to 200 characters.
  - Arm can kill the child, or write into that pipe through `/proc/<child>/fd/1`, because the child is dumpable after exec and Yama is
    1. The worst outcomes are `dump=none`, or unbounded memory growth in root's bash for up to 600 s. Arm can exhaust memory directly
    anyway, so this is INFO.
- **Candidate rule (`:91-98`): fails closed.**
  - Only names matching the strict regex are candidates.
  - The lstat `%Y` (whole seconds) must be at or after the main-start second. Both sides are floored, so a genuine dump always
    qualifies.
  - `.partial` files and sidecars are excluded.
  - Any extra matching entry with mtime at or after the start gives n≠1, so `none`. Arm can cause a DoS this way, never a pass.
  - A clock step backwards during the run gives n=0, so `none`.
- **Symlinks: OK.** A symlink with a new mtime gives `none` (P9). One with an old mtime is skipped. A TOCTOU swap to a symlink after the
  stat makes the child read only what arm can read anyway, so it is harmless.
- **FIFO: fails closed.** A FIFO swapped in after the stat blocks sha256sum until the 600 s timeout, then gives `none`. That is within
  the unit's `TimeoutStartSec=30min`.
- **Empty files: fail closed.** `stat` reports "regular empty file", which gives `none`.
- **Large or sparse files: fail closed.** They are bounded by the 600 s timeout, then give `none`.

No regression found.

### Findings (round 2)

- **MED-1 (round 1): RESOLVED** at the evidence level for post-run tampering, verified on real systemd (see (a)).
- **MED-3 (new): an evidence-level path remains, reproduced.**
  - What it is: an arm process outside `afldb-backup.service` can choose the bytes that the ROOT record binds, so both gates PASS with
    OFFHOST-COMPARE on arm-chosen bytes.
  - What it needs: no write to the checkout, unit, sidecar or node, and no timing luck. That defeats any checkout-integrity check.
  - What arm could do with it: substitute an older genuine dump, which would defeat the "tonight's backup" freshness claim while
    passing `pg_restore --list`-style checks.
  - Evidence: `logs/review2-real-systemd-review-race.log`, `FINDING-REVIEW2-RACE`.
  - Wording defect: the docs state it only as "an arm process racing the run inside its own minutes could substitute the file before
    the writer hashes it" (G0 `r1-g0-dump.sh:131`, A-2 `r6-pre-verify.sh:213`, DESIGN §5 line 132). That understates it:
    - it is not a race;
    - it needs only `kill -STOP` on a same-uid process;
    - the substitution must precede the sidecar (after the sidecar it is caught, per attempt 1).
  - What PASS means: G0's PASS currently reads as "the scheduled run's dump". With this path open, it means "a file arm's uid allowed
    to stand at the run's sidecar step".
  - Closing it needs the dump written and sealed by something other than uid arm, for example a separate backup user whose directory
    arm cannot write. Otherwise it needs an owner acceptance recorded with accurate wording.
  - Graded MED, not HIGH: the same class (arm controls the workload's inputs and outputs) was already a stated residual. The defect is
    the wording and what PASS is taken to prove.
- **MED-2 (round 1): NOT FIXED**, recorded as an owner decision. The wording is accurate.
- **LOW-2: RESOLVED.** The re-arm wording (DESIGN §5) matches the systemd behaviour I measured.
- **LOW-1: ignored**, as instructed (README.md is still being written).
- **INFO-8:** the writer captures the arm child's stdout with no memory bound (`:103-104`). It is not exploitable beyond DoS.

### Not verified

- I did not re-run the `~/.bashrc` forgery (MED-2) against 69d2a728; the delta does not change it.
- The `/proc/<child>/fd/1` pipe write and memory flood are reasoned only, not demonstrated.
- I did not reproduce the in-run substitution against a real pg_dump. The fixture stub runs for 3 s, and production's minutes-long
  pg_dump only widens the window.
- I did not inspect production's Yama setting or process limits. DEV's ptrace_scope is 1.
- I read the driver proof and the rehearsal only as summary lines (above). I did not re-review their case content beyond those lines.
