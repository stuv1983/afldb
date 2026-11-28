# R6 r7: independent review of sealed backup production (G1, MED-3) and the owner verifier (G2, MED-2) (28 November 2026)

Reviewer: independent; wrote none of r7. Judged from git objects (`git show <rev>:<path>`) and from logs reproduced by this review.

**Revision judged:** delivered head `2136f102a4d490142f888eb5a45ad220ee91ac71`, tested revision `5c2c2280e4688a063a5f943512e4460e250b1135`,
review/pin revision `bfa09946`. `backup/sealed-origin.sh` and `verify/bundle/sealed-origin.sh` are byte-identical at `2136f102`
(`48827fb1…`). Line numbers below are of the blobs at `2136f102`; `R7` = this directory.

**Verdict in one paragraph.** The mechanisms hold against a uid-arm process that has no root: I found no arm path to the accepted
bytes (Q1) and no arm path to the `AFLDB-VERIFY RESULT` line, the wrapper's `OWNER VERDICT` line or its exit status (Q2). Both
guarantees nevertheless rest on one dependency that r7 puts out of scope and does not list: on production, root is reached through
arm's own login (`sudo` in an arm SSH session), and a hostile arm startup file takes root from the owner's own authentication
(F1, reproduced). Three smaller defects: A-2 prints arm-controlled bytes raw to Stu's terminal (F2, reproduced), a catch-up or
re-arm is labelled `scheduled` under production's `RandomizedDelaySec=10min` (F3, reproduced), and a run that fails after
publication stays eligible to `sealed_origin` itself (F4, by reading).

## Method

* Read every r7 script at `2136f102`: sealer, run wrapper, drop-in, `sealed-origin.sh`, `install-backup.sh`, the verifier entry,
  dispatcher, `lib.sh`, three cores, root facts reader and its units, `afldb-verify-py`, sshd drop-in, wrapper, `install-verify.sh`,
  `verifier-db.sql`; plus `tools/maintenance/backup.sh`, the `deploy/afldb-backup*` units and the polkit rule at `5c2c2280`.
* Re-ran both harnesses at the tested revision on streamanator as arm (real systemd 255 as PID 1, disposable containers, never
  `--privileged`). Only the log directory was redirected to my scratch directory.
  * `backup-harness/r7b-run.sh --verify-rev 5c2c2280 rvw1b`: `R7 BACKUP HARNESS RESULT PASS`, 10 scenarios as recorded, arm probes
    79 + 94 + 100 attempts, 0 allowed (`logs/review-backup-harness-rerun.log`).
  * `verify-harness/r7v-run.sh --verify-rev 5c2c2280 rvw1v`: `R7 VERIFY HARNESS RESULT PASS`, 6 scenarios as recorded
    (`logs/review-verify-harness-rerun.log`).
* Three reproductions of my own (F1, F2, F3), each logged with its inputs labelled.
* Not done: production was never contacted. Nothing about production's real sshd, sudoers, PostgreSQL roles or host key is verified
  here; where a finding depends on a production fact I cite the repository text that states it.
* Residue check after the last run: no container, image or workspace with an `r7b`, `r7v` or `r7rev` name on streamanator.

## Question 1: who can write or replace the accepted bytes before sealing?

**Can arm, or anything arm controls, make either gate accept bytes the timer's run did not produce, make a hand start, restart or
out-of-window re-arm count, or leave a partial artefact eligible? NO**, for an arm process without root. **Conditional on F1.**

| Principal or path | Can write or replace | Evidence |
|---|---|---|
| `afldb-backup` process tree (ExecStart) | staging only | drop-in `backup/70-afldb-backup-sealed.conf:10-28` (`User=afldb-backup`, `ProtectSystem=strict`, `ReadWritePaths=` staging only, `NoNewPrivileges`, `Environment=`/`EnvironmentFile=` reset) |
| Code it executes | root only | `afldb-backup-run:17-18,38-39` (`cd /`, fixed PATH, `env -i`, absolute `bash --noprofile --norc`); `backup.sh:20-21` lands in root-owned `/usr/local/lib/afldb-backup`; trusted-path and digest rules `sealed-origin.sh:139-157` |
| `pg_dump`, `pg_restore`, `pg_wrapper`, perl, libpq | root only, by path not digest | stated residual B10; PATH is `/usr/sbin:/usr/bin` (`afldb-backup-run:38`) |
| PostgreSQL socket and peer map | `postgres` and root | DSN constant `afldb-backup-run:25`; arm is not OS user `afldb-backup`. arm controls the database **content** (owner DSN), a stated different property |
| Signals, ptrace, `/proc`, cgroup | none for arm (different uid) | re-run perm scenario: every `kill -STOP` EPERM, D-Bus kill denied |
| systemd (`systemctl`, D-Bus, transient and `--user` units) | none for arm | polkit grant is one unit and one verb only (`deploy/afldb-settle-afltables-trigger.rules:34-40`); a hand start by root is sealed `trigger_unit=none` (`afldb-backup-seal:80-88`) and never counts (`sealed-origin.sh:174-179`) |
| Staging and parents | `afldb-backup` 0700 under root 0755 | `sealed-origin.sh:150-151` |
| Sealer and its inputs | root; reads PID 1 over the system bus and staging | `afldb-backup-seal:50-99`; copies first, hashes the root 0400 copy, compares with the staging sidecar (`:127-136`); re-checks invocation and job (`:144-146`) |
| `seals/` | root 0755; seal root 0644, `set -C` temporary then `mv -n` | `afldb-backup-seal:152-164` |
| `published/` | root; arm reads through `afldb-backup-read` (0750, files 0440) | `afldb-backup-seal:168-176`; no rename, link or unlink right for arm in any parent |
| Timing between hash, seal and rename | no arm-reachable window | the hashed object is the root-only copy that is later renamed; the seal is written before publication |

Restart inside the timer's job, a second run in the window, a hand start and an out-of-window re-arm are refused
(`sealed-origin.sh:179-187, 201-203`; re-run scenarios restart, timer-then-hand, hand-start, rearm-out). An interrupted seal
leaves a root 0400 `.tmp`, not eligible (re-run scenario seal-interrupted).

Two qualifications, neither reachable by arm: F3 (labelling) and F4 (a post-publication failure).

## Question 2: who can change the verdict Stu receives?

**Can arm make Stu receive a PASS, a different OFFHOST-COMPARE, or a stale or replayed verdict?**

* **G0 (G0a, the handoff, G0b): NO.** Conditional on F1.
* **A-2 machine verdict (`RESULT` line, `OWNER VERDICT` line, wrapper exit): NO.** Conditional on F1.
* **A-2 as read on a terminal: YES, display only** (F2).
* **A-2 content:** arm can make the arm-produced checks pass falsely. `R7/README.md` §4 states most of them; the gaps are listed
  at the end.

| Step | Finding | Evidence |
|---|---|---|
| Wrapper inputs | `-F none`, verify key only, no agent, strict host key; fresh 16-byte nonce; exactly one RESULT line, last; mode, nonce, pinned bundle digest, host, `at=` within 300 s, `exit=` = ssh status, PASS iff 0, argument fields | `verify/afldb-verify-call.sh:30-39, 47-69, 73` |
| sshd | root-owned key file, `ForceCommand`, no TTY or forwarding, `restrict` on the key; arm cannot bind 22 or present the host key | `bundle/60-afldb-verify.conf:4-21`, `authorized_keys.template`; re-run scenario f |
| Entry and dispatcher | `env -i`, `bash --noprofile --norc`, strict grammar before any read, bundle self-check every run | `bundle/afldb-verify-entry:6-7`, `afldb-verify-dispatch:24-42, 63-96` |
| Result fields | token-prefixed FIELD lines; token only in the environment; each field re-validated; lines beginning `AFLDB-VERIFY` or `OWNER VERDICT` neutralised | `afldb-verify-dispatch:110-137`, `lib.sh:76-79` |
| python | `/usr/bin/python3.12 -I -S`, standard library only | `afldb-verify-rootfacts:1,14`, `afldb-verify-py:1,11` |
| Root facts reader | only root and group `afldb-verify` can connect, so arm never sends a request; fixed grammar, fixed paths, `O_NOFOLLOW` walk from `/`, leaf `O_NONBLOCK`, regular file owned by arm or root, size caps, output reduced to printable ASCII, fixed keys | `afldb-verify-rootfacts.socket:8-14`, `afldb-verify-rootfacts:32-63, 28-29, 304-333` |
| What an arm-controlled answer can say | any **value** of the arm paths, never a new key or line. G0 uses one arm value, `failed_marker`, and only to FAIL (`g0-core.sh:40-43`). A-2 uses many (below) | `lib.sh:62-72` |
| Journal | restore lines need `_SYSTEMD_UNIT=afldb-backup-verify.service`, a unit that runs arm's script, so they are arm-authored (stated); cron lines need `_UID=0` and are used on streamanator only | `afldb-verify-py:67-88` |
| DB role | peer role `afldb_verify`, `psql -X`, read-only; the **answers** are arm's (owner DSN) and are printed raw (F2) | `a2-core.sh:290-306`, `verifier-db.sql` |
| G0a to G0b | dump and sha256 only from the authenticated G0a RESULT line; G0b echoes them | `afldb-verify-call.sh:89-96` |
| A-2 to NG-PRE | plan consumes `OWNER VERDICT A2 PASS transport=production` with wrapper exit 0 | `ATTENDED-PLAN-R6-20261125.md:328` |

**Denial versus false pass.** arm can force a STOP at will: a `FAILED-*` file in its `.state`, a process named `dpkg`, port 3100,
an oversized file for the root reader (F5), a filled `/tmp`. None of these produces a PASS; every failure path I traced fails
closed (`afldb-verify-dispatch:130-139`). arm can falsely **pass** only the checks whose evidence it produces.

## Findings

### F1 (HIGH): root on production is reached through arm's login, so arm's startup files can take root; not stated as a dependency

* **Where.** `DESIGN.md:20-24` sets the adversary as "any process running as uid arm … without root" and puts "root/sudo" out of
  scope. `R7/README.md:63` says only "Root or sudo integrity" is not proved. `R7/README.md:251` and `RUNBOOK.md:280` require the
  installs "from a trusted root session" without saying how one is obtained. The plan obtains root as arm:
  `ATTENDED-PLAN-R6-20261125.md:10` ("Every `sudo` step is the owner's, one block at a time, in his own SSH session") and
  `RUNBOOK.md:62` ("The owner runs only the `sudo` lines"), over the arm connection. `backup/README.md:92` and
  `verify/verifier-db.sql` print `sudo -u postgres …` owner steps.
* **Why it matters.** Every trust anchor of G1 and G2 is "root-owned": seals, `published/`, the bundle and its `SHA256SUMS`, the
  sshd drop-in, `authorized_keys`, the host key. The adversary owns `~/.bashrc`. The first owner `sudo` in an arm login hands that
  adversary root, before or after the install. G2 is defined as a path "independent of arm's login"; the root that installs and
  maintains that path is not independent of it.
* **Reproduced** (`logs/review-sudo-via-arm-login.log`; Ubuntu 24.04.4, sudo 1.9.15p5, default `timestamp_type=tty`, default
  sudoers, password required). A uid-arm process appended four lines to `~arm/.bashrc`. The owner logged in as arm on a terminal and
  ran one `sudo` command of his own, typing his password. The background job from `.bashrc` then ran `sudo -n` in the same
  session and, as `uid=0(root)`, created `/var/lib/afldb-backup/seals/FORGED-BY-ARM-BASHRC.seal` and wrote into
  `/usr/local/lib/afldb-verify/`. Before the login, arm's `touch` in `seals/` was `Permission denied`.
* **Not verified:** production's actual sudoers and `timestamp_type`. A `sudo` shell function in `.bashrc` that captures the
  password works regardless of the timestamp setting.
* **Fix direction.** Reach root without arm's login: a separate admin account with its own key and no arm-writable startup file,
  or the provider's Recovery Console, for the installs and every later `sudo` step; remove arm from `sudo` (or at least never
  authenticate `sudo` in an arm session). State it in `R7/README.md` §4 and define "trusted root session" in both runbooks. Until
  then G1 and G2 hold only for an arm process that never sees an owner `sudo`.

### F2 (MED): A-2 prints arm-controlled bytes raw, so a PASS can be drawn on Stu's terminal

* **Where.** `bundle/a2-core.sh:291-300`: `RO=$(… psql … 2>&1 …)` then `printf '%s\n' "$RO" | sed 's/^/     /'`. Every other
  arm-derived value passes `san()`; this one does not. `verify/README.md` §6 lists "PostgreSQL's catalogue as seen by the peer role"
  as trusted and says arm data is "sanitised to printable ASCII before printing". Both are wrong for this line: the comment on
  `afldb_restore_test` is written by arm's role (`tools/maintenance/restore-test.sh:305`), and `afldb_meta.schema_migrations` is
  arm's table.
* **Reproduced** (`logs/review-a2-terminal-escape.log`) on my re-run's containers, through the documented wrapper and real sshd.
  A non-superuser owner of `afldb_restore_test` set a comment holding a newline, `ESC[2K ESC[G`, the text
  `OWNER VERDICT A2 PASS transport=production … exit=0`, `ESC[8m` and an unterminated OSC. The wrapper's stdout carried 6 ESC bytes
  (control: 0) and the forged text. The dispatcher's neutraliser (`afldb-verify-dispatch:115`) did not fire because the line begins
  with five spaces.
* **Limits.** The genuine `AFLDB-VERIFY RESULT A2 STOP`, the genuine `OWNER VERDICT A2 STOP` and wrapper exit 1 were unchanged;
  a saved transcript still has exactly one line matching `^OWNER VERDICT`. The on-screen effect (forged line at column 1, later
  lines concealed) follows from the bytes and was not rendered in a terminal by this review. G0 has no such channel.
* **Fix direction.** Pass `$RO` through `san()` line by line before printing; have the wrapper strip or escape every byte outside
  printable ASCII in the gate output; correct `verify/README.md` §6.

### F3 (MED): a catch-up or attended re-arm is labelled `scheduled` under production's timer settings

* **Where.** `afldb-backup-seal:98-99` and `sealed-origin.sh:204-205` label `catch-up` only when the dispatch came less than 5 s
  after the timer unit's activation (`DESIGN.md` §3.4). Production's timer has `RandomizedDelaySec=10min`
  (`deploy/afldb-backup.timer`). systemd adds the random delay to a missed elapse as well, so a re-arm or boot after 02:20 is
  normally dispatched minutes later. The harness hides this with a fixture drop-in, `RandomizedDelaySec=0`
  (`backup-harness/r7b-container.sh:90`).
* **Reproduced** (`logs/review-rearm-randomized-delay.log`): the harness's own `rearm-in` scenario at the tested revision with two
  lines changed (production timer timing; a longer wait). Root re-armed the timer at 02:20:15.097 with the previous night's stamp.
  systemd dispatched at 02:29:06. The seal says `dispatch_kind=scheduled`; `sealed_origin` returned 0 with
  `dispatch=scheduled 531.4 s after timer activation`; the harness's own check failed: `dispatch kind scheduled, expected catch-up`.
* **Effect.** The owner's rule "catch-up must be identified explicitly" is not met in the common case. The in-window rule and the
  bytes are unaffected, and the printed delay shows the activation time to a careful reader. arm cannot cause it.
* **Fix direction.** Seal the timer's `ActiveEnterTimestamp` in realtime and label `catch-up` whenever the timer became active
  at or after the gate date's 02:20:00 (the calendar instant was missed), whatever the delay. Run the re-arm scenarios with
  production timing.

### F4 (LOW): a run that fails after publication remains eligible to `sealed_origin`

* **Where.** The seal is written before publication (`afldb-backup-seal:163`). After the sidecar rename (`:176`) the sealer can
  still fail at the state record (`:177-181`), retention (`:187`) or the staging removal (`:190`); the unit then fails, but the
  seal, dump and sidecar satisfy `sealed-origin.sh:206-216`. Only the separate `Result=success` test (`g0-core.sh:36-38`,
  `a2-core.sh:282-285`) stops the gate, and it reads the unit's **current** result without comparing `InvocationID` with the seal.
  A later hand start by root outside the window, `reset-failed`, or a reboot restores `Result=success`.
* **By reading; not reproduced.** Not reachable by arm. The published bytes are the timer run's complete dump in this case.
* **Fix direction.** Make completion a sealed fact: write a root completion record as the last step and require it in
  `sealed_origin`, or require `InvocationID` = the seal's invocation alongside `Result=success`.

### F5 (LOW): the root facts reader has no effective time limit

* **Where.** `bundle/afldb-verify-rootfacts@.service:9,30`: `Type=oneshot` with `RuntimeMaxSec=900`, which does not apply to a
  oneshot service. Observed on the installed unit: `Type=oneshot TimeoutStartUSec=infinity` (`logs/review-a2-terminal-escape.log`).
  `sha256_of` has no size cap (`afldb-verify-rootfacts:91-102`) and hashes an arm-named file (`:251-254`).
* **Effect.** Denial only: a very large sparse file keeps a root process hashing after the client's 900 s timeout; four such
  instances exhaust `MaxConnections=4`.
* **Fix direction.** `TimeoutStartSec=900`; cap the size in `sha256_of`.

### INFO

* `sealed_origin_install` does not require `ExecCondition=`, `ExecStartPre=`, `ExecStop*=` to be empty or check the timer's
  settings (`sealed-origin.sh:105-131`). Root-only to change.
* `backup.sh:21` sources `.env` in `/usr/local/lib/afldb-backup` if root ever creates one; the gate checks ownership, not absence.
* `afldb-verify-rootfacts:180` calls `os.path.realpath` through arm-owned symbolic links as a `CAP_DAC_READ_SEARCH` process. The
  result goes only to the verifier and is compared with another arm-chosen value.
* `afldb-verify-py:94-96` follows HTTP redirects from arm's server on port 3100. The answer is arm's either way.
* The reviewed harness never ran production timer timing (see F3), and a whole A-2 PASS has never been observed (stated in
  `R7/README.md` §7; A-2 is still dated 2026-11-25, `a2-core.sh:174`).

## Remaining dependencies on arm that `R7/README.md` §4 does not state

1. **The path to root** (F1): owner `sudo` in arm's login, for the installs, the `sudo -u postgres` steps and every plan step.
2. **Two A-2 PASS lines are decided by arm through the database**: `ledger 118` and the `afldb_restore_test` comment and
   connection count (`a2-core.sh:301-306`). §4 item 7 mentions database content only as a property of the dump.
   `verify/README.md` §6 calls the catalogue trusted.
3. **The raw psql output channel** to Stu's terminal (F2).
4. **Both sides of "process cwd = the release" are arm's.** §4 item 2 says the verifier "proves which release directory the running
   MainPID uses (kernel cwd)". The process is arm's and can `chdir`; the directory it is compared with is resolved through
   arm-owned links (`a2-core.sh:89`, `afldb-verify-rootfacts:170, 180`).
5. **The worker count** (`a2-core.sh:227-228`): arm's processes.
6. **`events.log` decides whether the "restarted since the last attested PASS" note appears** (`a2-core.sh:106-107`). arm can
   suppress it; the PID 1 `InvocationID` comparison (`:224`) is what actually holds.
7. **Production arm serves the off-host pull.** streamanator pulls over production arm's login, so arm chooses the bytes sent.
   G0b's hash comparison limits this to denial. §4 item 4 covers streamanator's arm only.
8. **Denial.** arm can force G0 and A-2 to STOP at will (markers, process names, port 3100, large files, `/tmp`). Not a forging
   risk, but nowhere stated.
9. **Unknown, to check on the host:** whether arm's PostgreSQL role is a superuser. If so it acts as OS user `postgres`, which
   owns `pg_hba.conf` and `pg_ident.conf`, the files that hold both peer maps.

## Reproduction logs written by this review (`R7/logs/`)

| Log | Content |
|---|---|
| `review-backup-harness-rerun.log` | re-run of the backup harness at `5c2c2280`: PASS |
| `review-verify-harness-rerun.log` | re-run of the verifier harness at `5c2c2280`: PASS |
| `review-sudo-via-arm-login.log` | F1 |
| `review-a2-terminal-escape.log` | F2, and the root facts unit's `TimeoutStartUSec=infinity` (F5) |
| `review-rearm-randomized-delay.log` | F3, with the two-line change to the harness printed at the top |

## Round 2 (3af37aa7, tested 7d693020)

Reviewed 28 November 2026 (runs finished about 12:45 AEDT, inside the 24..29 November gate dates). Same method as round 1: code
read from git objects at `3af37aa7`; the code under `backup/`, `verify/` and both harnesses is identical at `7d693020` (the
revisions differ by logs and documents only). Every run was on DEV in disposable containers; no production contact, no `lxc`, no
host sudo. Residue after the runs: 0 containers, 0 images, 0 workspaces. Installed hashes in my containers: `sealed-origin.sh`
`1153df78…`, sealer `793e94be…`, bundle `SHA256SUMS` `df3457cc…` (equal to the wrapper's pin).

### Verdicts

| Question | Round 2 | Basis |
|---|---|---|
| Q1: can arm write or replace the accepted bytes before sealing? | **NO** | Unchanged from round 1; my re-run of the backup harness passed all 13 scenarios (`logs/review2-backup-harness-rerun.log`). |
| Q2: can arm change the verdict Stu receives? | **NO**, for the machine verdict and now also for what the terminal shows | The round-1 display attack and nine variants were neutralised; verdict and exit unchanged (`logs/review2-a2-neutralisation.log`). |

Both answers still depend on F1: they hold only if root is not reached through arm's login. With F1 as it stands on production
today, arm can obtain root and both answers become YES.

### Status of the round-1 findings

| ID | Grade | Status | Evidence at this revision |
|---|---|---|---|
| F1 | HIGH | **OPEN** (documented, not fixed in code; an owner decision) | Reproduced again: a uid-arm startup file obtained root from the owner's own `sudo` and wrote root-only trust anchors (`logs/review2-sudo-via-arm-login.log`). `README.md` §4 item 9 and §5, and `ATTENDED-PLAN-R6-20261125.md` lines 940 and 946, now require a root path that does not pass through arm's login. |
| F2 | MED | **CLOSED** | Three layers, each read in code: `a2-core.sh` prints psql lines through `san`; `afldb-verify-dispatch:114-119` replaces non-printable bytes and prefixes `[neutralised] `; `afldb-verify-call.sh:48-54` does the same with `[relayed, neutralised] `, while `call()` (lines 70-74) still authenticates the raw output. Reproduction below. |
| F3 | MED | **CLOSED** | `afldb-backup-seal:116` and `sealed-origin.sh:219` compute the label from the timer's realtime activation. With the timer file as shipped (`RandomizedDelaySec=10min`, no drop-in): re-arm inside the window gave `dispatch=catch-up` at delay 286.7 s; the genuine run gave `scheduled` at 679.0 s (`logs/review2-rearm-randomized-delay.log`). A seal whose label was flipped by hand is refused ("its own stamps say scheduled"). |
| F4 | LOW | **CLOSED** | `.done` is the sealer's last step (`afldb-backup-seal:211`); gate rule 6 (`sealed-origin.sh:232-240`). Harness `post-pub-fail` refused (`logs/review2-post-publication-failure.log`). My own tests T3..T3e: missing, altered hash, extra line and second hard link are each refused; a stray `.done` without a seal does not disturb a valid run. |
| F5 | LOW | **CLOSED** | Installed unit shows `TimeoutStartUSec=15min`. A 17 GiB file planted by arm as the restore dump is refused in 0 s ("larger than 17179869184 bytes"); a 15 GiB file was hashed in 75 s. |
| INFO (unit commands, `.env`) | INFO | **CLOSED** | Drop-ins adding `ExecStartPre`, `ExecCondition`, `ExecStop`, `ExecStopPost` and `ExecReload` each gave G0 STOP; all five `…Ex` properties exist on the container's systemd. An empty `.env` in the code directory gave G0 STOP. All in `logs/review2-gate-refusals.log`. |
| INFO (redirects in `afldb-verify-py`) | INFO | closed by reading only | The NoRedirect handler is present; I did not run a redirecting server against it. |

### Reproduction of the forged comment and variants

Run through the real wrapper from `7d693020`, real sshd and Windows OpenSSH, with a non-superuser role owning `afldb_restore_test`.
The comment carried eleven lines: the round-1 escape sequence, a complete forged `AFLDB-VERIFY RESULT A2 PASS` line with the right
bundle hash, a two-space variant, a lower-case-L variant, a Greek omicron, a line split across a newline, a carriage return, a tab,
and the phrase after 500 filler bytes.

- Wrapper exit 1 before and after; the verdict line equals the control apart from nonce and time.
- Wrapper output: 0 ESC bytes, 0 other control bytes, 0 bytes at or above 0x80. Exactly one line begins `OWNER VERDICT` and exactly
  one begins `AFLDB-VERIFY RESULT`: the genuine ones, and they are the last two lines.
- The escape line, the forged RESULT line and the carriage-return line are shown as `[relayed, neutralised] [neutralised] …`.

### Regressions looked for

- **Seal format `/4`.** A `/3` seal (25 lines) is refused as malformed. Nothing is installed, so no `/3` seal exists to strand. None found.
- **`.done`.** Written through `.<inv>.done.tmp` and renamed, after retention; an interruption leaves a seal without a record,
  which the gate refuses. None found. INFO: a backward clock step between seal and record would give a false STOP (fail-closed).
- **Neutralisation hiding the genuine line.** Not possible by this route: the dispatcher prints its RESULT line itself, outside the
  relay loop, and the wrapper exempts only the last non-empty line when it begins `AFLDB-VERIFY RESULT `. Harness scenario e
  (two RESULT lines, replay, stale, wrong bundle, exit lie) still refuses.
- **Neutralisation letting a forged line through.** Not for the machine verdict. See N1 for the display.
- **Unit refusals and reader limits.** Behave as stated; removing each test drop-in returned G0 to PASS.

### New in round 2

| ID | Grade | Finding |
|---|---|---|
| N1 | INFO | Look-alikes are not prefixed: `OWNER  VERDICT` (two spaces), `OWNER VERDlCT`, `OWNER?VERDICT` (tab replaced), `??WNER VERDICT` (omicron replaced) and a phrase split across two lines appear as ordinary data lines. Each is indented five spaces inside the A-2 listing, contains no control byte, and cannot be the last line. A reader who takes only the final column-0 `OWNER VERDICT` line is not misled. Worth one sentence in the runbook; no code change needed. |
| N2 | LOW | `ATTENDED-PLAN-R6-20261125.md` line 10 still says every `sudo` step is the owner's "in his own SSH session", which contradicts lines 940 and 946 and is exactly the F1 path. Correct line 10. |

### `README.md` §4

Items 9 to 17 now list all nine dependencies I named in round 1 (root path, the two database-decided PASS lines, the psql output
channel, process cwd, worker count, `events.log`, the off-host pull served by production arm, denial, and the unknown PostgreSQL
superuser status). Still missing: N1's residual (arm can place look-alike text in the A-2 listing). Nothing else found.

### Logs written this round

`logs/review2-backup-harness-rerun.log`, `logs/review2-verify-harness-rerun.log`, `logs/review2-verify-harness-scenario-g.log`,
`logs/review2-sudo-via-arm-login.log`, `logs/review2-a2-neutralisation.log`, `logs/review2-gate-refusals.log`,
`logs/review2-rearm-randomized-delay.log`, `logs/review2-post-publication-failure.log`.
