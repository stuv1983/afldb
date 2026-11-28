# R6 r7: sealed backup production (MED-3) and an owner verifier independent of arm (MED-2) (28 November 2026)

**Status: PROPOSED, review round 1 fixed (see "Review round 1 fixes" below). Nothing installed. Production was not contacted. R6 stays
NO-GO. PR 5 stays draft. MED-2 and MED-3 stay OPEN: F1 (the root path, an owner decision) and owner installation.**

**Independent review round 2** (judged `3af37aa7`, tested `7d693020`; [INDEPENDENT-REVIEW.md](INDEPENDENT-REVIEW.md) "Round 2",
logs `logs/review2-*.log`): Q1 (can arm write or replace the accepted bytes before sealing) **NO**; Q2 (can arm change the verdict
Stu receives, machine verdict and terminal display) **NO**; both **conditional on F1**: root on production must not be reached
through arm's login. F1 HIGH open (documented, reproduced again); F2, F3, F4, F5 and the INFO items closed; no regressions. New: N1
INFO (look-alike verdict text, recorded as §4 item 18) and N2 LOW (ATTENDED-PLAN line 10 still said every sudo step runs "in his own
SSH session"; corrected in the round-2 record commit, prose outside every printed block, so no pin changes). Neither guarantee is
met on production until the owner closes F1 and installs both bundles.

Everything ran on the workstation (Git Bash) and on the DEV host streamanator as `arm`:
* in private `mktemp` workspaces and disposable docker containers (`--network none` except image builds, never `--privileged`);
* without host sudo, `lxc`/`lxd`, host packages or host accounts;
* removing everything it created.

MED-2 and MED-3 stay **OPEN** in the trackers: the independent review (round 1) found F1, which only the owner can close, and owner
installation is pending. Contract: [DESIGN.md](DESIGN.md), whose §7
holds the coordinator's deviation record. Implementations: [backup/README.md](backup/README.md), [verify/README.md](verify/README.md).

| Item | Value |
|---|---|
| Reviewed head before r7 | `2d772fe4` (= origin, r6 record) |
| **Tested revision** | `5c2c2280e4688a063a5f943512e4460e250b1135` |
| Review revision (the printed blocks' `CODE=` and the release runbook re-pinned to the tested revision; only the two runbooks differ) | `bfa09946da997da8b186c18408a7885b30df4958` |
| **Delivered head** | this record and the trackers on top of `bfa09946` (see the PR); no script differs from the tested revision |
| Release `scripts/SHA256SUMS` (12 files) | `9c4b6ca6…` → **`52900a0e2102ec09820b037babe4c327ff63ac72236f9c4a80b84f1f54b06b59`** |
| R6 manifest (16 files) | `57c8aa50…` → **`426c07ff8267bb82a1e15fe04923350d6daa267bde4b9a09b5560d00814ee6f8`** |
| Changed pins (comments only: MED-3 is deterministic, not a race) | `r1-g0-dump.sh` `6a0a0e58…` → `81f638dc03fd58039ae48527c6880c4679aaa8698a88dc9d5fe6b7e3bd3cb621`; `r6-pre-verify.sh` `eac16cec…` → `97b85721690ea31e2ddb5b73a6f2f4e88444363ed542c0923d1cfb49c2abe218` |
| `tools/maintenance/scheduled-backup.sh` (repository) | `234fca6a…` → `7e2b470aed441208b990204115f892b3c0c4e9c402800a4c038aadc386105903` (status opt-in only; production's checkout keeps `234fca6a…`, no gate executes either) |
| Sealed-backup bundle, NOT installed (`backup/SHA256SUMS` `aada42cbcf31cd6a5c434ff4e5bb31c7b0028c2b6e84507a87f5482cc7708bab`) | run `2c62ff91…`, sealer `33ab0cc3…`, drop-in `70-afldb-backup-sealed.conf` `f8a18580…`, `sealed-origin.sh` `48827fb1…`, `install-backup.sh` `f5d80c2b…`, `verify-backup-install.sh` `29674856…`, `backup.sh` (repository, byte-identical) `df609046…` |
| Owner-verifier bundle, NOT installed | `verify/bundle/SHA256SUMS` `5333d2155a1fa26de5e86af3e866f17c0ba0c207a00f94e6682d4fc3a85576e4` (= the wrapper's pinned `BUNDLE_SHA`); packet `verify/SHA256SUMS` `ee4963bd…`; wrapper `afldb-verify-call.sh` `7ef95621…`; `bundle/sealed-origin.sh` byte-identical to `backup/sealed-origin.sh` |
| Sitting artefacts | `sha256sum -c SHA256SUMS-SITTING`: 4 OK (unchanged) |

The table above is round 0 (tested `5c2c2280`, delivered `2136f102`). The current values are in the next section.

## Review round 1 fixes (28 November 2026)

The independent review of `2136f102` is [INDEPENDENT-REVIEW.md](INDEPENDENT-REVIEW.md); its reproduction logs are
`logs/review-*.log` (committed with this record). One fix round, under the same rules: scoped git, no push, no trailers, DEV only.

| Item | Value |
|---|---|
| **Tested revision (round 1)** | **`7d69302007568d3141a567c8eba89e4ee473c9a6`** |
| First round-1 commit (superseded) | `c84d88c0c85494bbaa31d6a0c2c6bf1004a9d9ba`: its sealer joined the seal's first two lines (a missing argument separator), so every seal had 25 lines and was refused as malformed. Backup run `tc84d88c0`: `R7 BACKUP HARNESS RESULT FAIL (12 scenario(s) not as expected)`, exit 1. Verify run `tc84d88c0`: STOP in setup, `Connection reset by peer` from streamanator (network), cleaned up by hand (2 containers, the image, the workspace). Logs: `backup-harness/logs/failed-tc84d88c0/`, `verify-harness/logs/failed-tc84d88c0/`. `7d693020` adds the one space and re-pins. |
| Pin revision | `0cbe621f7868a6f72c8881d710f5b0a63a4e37f9`: the ATTENDED-PLAN r7 note and RUNBOOK §4.1a name `7d693020` instead of "the pinned revision" |
| Sealed-backup bundle (`backup/SHA256SUMS`) | `aada42cb…` → **`d0023d1060763ab8fe5db1ae1387ba7767f32f87b66f987bb1d5dd920d704cf6`**: sealer `793e94be…`, `sealed-origin.sh` `1153df78…`, `install-backup.sh` `f433b81a…`, `verify-backup-install.sh` `f286ea7b…`; run, drop-in, `backup.sh` unchanged |
| Owner verifier | `bundle/SHA256SUMS` = wrapper `BUNDLE_SHA` `5333d215…` → **`df3457cca22b51d330fbc3a35b0d6ef302f638270b8728a2380ab2253961f42e`**; packet `verify/SHA256SUMS` `ee4963bd…` → **`221b254a26cb541c6f22aae3b5d076e468fb88f3b7841fe3b94863e1121c9c4d`**; wrapper `fe49c3dd…`; `build-sums.sh --check` PASS |
| R6 manifest / release `scripts/SHA256SUMS` | **unchanged** (`426c07ff…` / `52900a0e…`): `git diff 5c2c2280 7d693020` over the 16 manifest files, `tools/maintenance` and the release `scripts/` is empty |

### Changes per finding

* **F1 (HIGH), not fixable in code; owner decision.** Stated in DESIGN §1, backup README §5 and §9, verify README §10, §5 below, the
  release RUNBOOK §4.1a and the ATTENDED-PLAN install preconditions (new item 0), and in `install-backup.sh`'s header. "Trusted root
  session" is gone everywhere: G1 and G2 hold only if the installs and every later root action use a root path that does not pass
  through arm's login (the console, or a separate administrative account with its own key). Creating it is a host-account change
  needing owner approval; production `sudoers` is unchecked.
* **F2 (MED).** `a2-core.sh` prints the catalogue answer (ledger, `afldb_restore_test` comment, connection count) line by line
  through `san()`; every other external print was checked (dpkg, grub, apt, systemd output are root data; `pgrep` was already
  sanitised). The dispatcher maps every non-printable byte of every core line to `?` and prefixes `[neutralised] ` to any line
  **containing** `AFLDB-VERIFY RESULT` or `OWNER VERDICT`. The wrapper's new `show` maps every byte outside printable ASCII (ESC and
  CR included) to `?` in stdout and ssh stderr and prefixes `[relayed, neutralised] ` to every relayed line containing either
  string except the final authenticated RESULT line; authentication still reads the unmodified answer. verify README §6 is
  corrected (the catalogue's contents are arm's) and §3 documents the three layers. Harness scenario **g** replays the reviewer's
  forged comment (non-superuser role, `SET ROLE`, same bytes).
* **F3 (MED).** Seal format `afldb-backup-seal/4` (26 lines) adds `timer_active_enter_usec` (the timer's realtime
  `ActiveEnterTimestamp`, from PID 1 via `busctl`). `dispatch_kind=catch-up` when that activation is at or after 02:20:00 Melbourne
  of the dispatch's date, or the dispatch came < 5 s after activation; otherwise `scheduled`. The gate recomputes the label from
  the sealed stamps and refuses a differing one. DESIGN §3.2 and §3.4 rewritten. New scenarios with **no** timing drop-in, i.e. the
  real deploy timer's `RandomizedDelaySec=10min`, `AccuracySec=1min`: `genuine-rd` (scheduled) and `rearm-in-rd` (re-arm at
  02:20:15: catch-up). The other scenarios keep the fixture timing because their holds, the restart and the 02:32 re-arm need the
  dispatch at a known second (`r7b-container.sh` header).
* **F4 (LOW).** The sealer's last step writes `seals/<invocation>.done` (root 0644, five exact lines, `mv -n`, never overwritten);
  `sealed_origin` rule 6 requires it after rule 5 (DESIGN §3.6). New scenario `post-pub-fail`: a root directory at
  `state/last-backup.json` makes the sealer fail after publication; `systemctl reset-failed` then clears `Result=`; refused.
* **F5 (LOW).** `afldb-verify-rootfacts@.service`: `RuntimeMaxSec=900` (ignored for `Type=oneshot`) → `TimeoutStartSec=900`, equal
  to the client's own `timeout 900`, so the reader never outlives its caller. `sha256_of` refuses a file over 16 GiB (far above one
  dump of `afldb_prod`, and hashable well inside 900 s at either host's sha256 rate) and a file that grows while hashed: a STOP,
  never an unbounded root job.
* **INFO.** `sealed_origin_install` refuses any `ExecCondition`, `ExecStartPre`, `ExecStop`, `ExecStopPost` or `ExecReload`
  command and a `.env` (file or link) in `/usr/local/lib/afldb-backup`. `afldb-verify-py` http mode refuses redirects (a 3xx is
  its own status). `realpath`: recorded in the reader (no content opened; the string is only compared with an arm-chosen cwd; see
  §4 item 12), not changed. The timer's own settings are not checked by the gate: they only move the dispatch, whose moment the gate
  checks against the window and whose kind it now recomputes; changing them needs root. The "never ran production timing" INFO is
  closed by `genuine-rd` and `rearm-in-rd`; "a whole A-2 PASS has never been observed" stays (§7).
* **Missing dependencies.** All nine items of the review's list are added to §4 (items 9–17), none dropped.

### Runs at `7d693020` (finished 2026-11-28 12:13 AEDT, before the 2026-11-29 23:59 limit)

| Run | Command | RID | Exit | Decisive line | Log |
|---|---|---|---|---|---|
| (a) sealed backup, 13 scenarios | `bash R7/backup-harness/r7b-run.sh --verify-rev 7d693020… t7d693020` | `t7d693020` | 0 | `R7 BACKUP HARNESS RESULT PASS`; `containers left: 0 images left: 0` | `backup-harness/logs/r7b-*.log`, `r7b-transport-t7d693020.log` |
| (b) owner verifier, 7 scenarios | `bash R7/verify-harness/r7v-run.sh --verify-rev 7d693020… t7d693020` | `t7d693020` | 0 | `R7 VERIFY HARNESS RESULT PASS`; `removed 2 container(s); left: containers 0, images 0, workspace removed` | `verify-harness/logs/t7d693020-*.log` |
| (c) driver proof | not re-run | — | — | packet bytes unchanged (R6 manifest `426c07ff…`, release `52900a0e…`), and every fenced block of the ATTENDED-PLAN and RUNBOOK is byte-identical to `bfa09946` (sha256 of the extracted blocks equal) | round 0 |
| (d) release rehearsal | not re-run | — | — | same reason | round 0 |

Both runs' transport verified every sent file against its blob at `7d693020`. New and changed scenario lines (verbatim, cut):
* a `genuine-rd`: `SCENARIO genuine-rd PASS expect=attributed so_rc=0 … dispatch=scheduled delay=153.7s`; `timer effective:
  AccuracyUSec=1min RandomizedDelayUSec=10min`; `production timing, scheduled: activation before 02:20:00, dispatch 69 s after 02:20:00`.
* a `rearm-in-rd`: `SCENARIO rearm-in-rd PASS expect=attributed so_rc=0 … dump=afldb_prod-20261128-022812.dump … dispatch=catch-up
  delay=477.1s`; `ok F3 exercised: the catch-up dispatch came 477 s after activation (>= 5 s, the old rule said scheduled)`.
* a `post-pub-fail`: `SCENARIO post-pub-fail PASS expect=refused so_rc=1 reason=seal … has no valid completion record (the run did not
  finish after its seal)`; `seal, published dump (… re-hash = seal) and sidecar exist, no completion record; Result=success after
  reset-failed; refused anyway`.
* a: the ten round-0 scenarios PASS as before (genuine/perm/review2 attributed scheduled; rearm-in catch-up 0.0 s; the refusals with
  their round-0 reasons); every attributed scenario also found its completion record.
* b `g`: `SCENARIO g PASS forged-comment: the forged text reached the wrapper only as data (1 line(s) '[relayed, neutralised] ...',
  0 ESC, 0 control bytes); genuine verdict and exit unchanged (OWNER VERDICT A2 STOP … exit 1)`. a–f PASS as in round 0.

**Not done / still open.** F1 (owner: root path, `sudoers` check); §4 item 17 (whether arm's PostgreSQL role is a superuser, to
check on the host); a whole A-2 PASS (dated 2026-11-25); owner installation. MED-2 and MED-3 stay OPEN. Nothing was pushed.

## 1. G1: the identified timer invocation produced the exact accepted dump (MED-3)

**Mechanism.** The design is in [backup/README.md](backup/README.md) and DESIGN §2–§4.

1. A root-owned drop-in runs `afldb-backup.service` as the system account `afldb-backup` (no login, no key, no sudo).
2. The account authenticates to PostgreSQL by peer, through the role `afldb_backup`, with no secret.
3. It writes only into `/var/lib/afldb-backup/staging`, which is afldb-backup 0700.
4. The single `ExecStartPost=+` sealer, root, runs while the start job is live, and fails the unit on any failure. It:
   * reads PID 1's facts (job, `ActivationDetails`, timer stamps);
   * copies the dump into a root-only temporary and hashes **that copy**, requiring it to equal the staging sidecar;
   * writes `seals/<invocation>.seal` (`afldb-backup-seal/3`);
   * only then publishes the copy root:afldb-backup-read 0440, with its root sidecar and `state/last-backup.json`.
5. `sealed_origin <date>` is one byte-identical library in the backup bundle and the verifier bundle. It reads only root facts: PID 1,
   root-owned files, the seal and the published copy. It needs exactly one seal whose start job came from `afldb-backup.timer`, with
   the dispatch equal to the timer's `LastTriggerUSec` and inside the gate date's 02:20–02:31 window. It also needs:
   * no stop or failure between the dispatch and the run;
   * no other run sealed in the window;
   * the pinned code, drop-in and effective unit;
   * the full re-hash of the published copy equal to the seal and to the root sidecar.

   A start by hand never counts. A `Persistent=` catch-up, including an attended re-arm, counts only when systemd genuinely dispatched
   it in the window. It is identified as `dispatch=catch-up`, printed as `DISPATCH catch-up <delay> s after timer activation`.

**What it proves (rehearsed, run (a)).** The timer's own run produced the bytes that are published and accepted. arm (uid 1000,
groups `arm`, `afldb-backup-read`) cannot:
* signal any process of the run (every `kill -STOP` EPERM, D-Bus `systemctl kill` denied);
* read staging;
* write, create, rename, link, chmod or replace anything in `seals/`, `published/`, `state/`, the code, the drop-in or the units, at
  creation, at sealing or after publication (273 attempts, 0 allowed);
* authenticate as `afldb_backup`.

The review-2 SIGSTOP substitution attack, re-run on real systemd, is refused (9 SIGSTOP attempts: 7 EPERM, 2 ESRCH). The full digest
equals root's own capture of the staging file at `backup.sh`'s rename, and the dump carries tonight's fixture nonce.

**What it does not prove.**
* That the database content is honest: arm holds the owner DSN.
* Root or sudo integrity.
* Production's facts: the unit install form, `/usr/local/lib` and `/var/lib` modes, the zone file type, the PostgreSQL cluster path,
  the socket, and systemd 255.4's job `ActivationDetails` there. The install and verify scripts check these on the host.
* `pg_dump`/`pg_restore` (the root-owned `pg_wrapper` symlink) are trusted by path, not digest.
* A `Persistent=` catch-up whose PostgreSQL dependency takes more than 5 s is a false STOP.

## 2. G2: Stu receives an authentic G0 and whole-A-2 verdict through a path independent of arm's login (MED-2)

**Mechanism.** The design is in [verify/README.md](verify/README.md) and DESIGN §5.

1. Stu runs `afldb-verify-call.sh` in Git Bash with his own new key `~/.ssh/afldb_verify`. The call uses Windows OpenSSH with
   `-F none`, `IdentitiesOnly`, no agent and `StrictHostKeyChecking=yes`.
2. sshd authenticates the key against the root-owned `/etc/ssh/afldb-verify/authorized_keys` (`restrict`). `Match User afldb-verify`
   forces `/usr/local/lib/afldb-verify/afldb-verify-entry`, with no TTY and no forwarding.
3. The entry `exec`s `env -i … bash --noprofile --norc` on the root-owned dispatcher. The dispatcher:
   * checks a strict grammar;
   * self-checks the pinned bundle and its trusted paths on every run;
   * runs one core: G0, G0B, or A2, the port of the whole `r6-pre-verify.sh`.
4. The answer ends with exactly one `AFLDB-VERIFY RESULT` line carrying the nonce, host, boot, bundle digest, `at=`, `exit=` and the
   argument fields. The wrapper accepts it only if every field holds, and only then prints `OWNER VERDICT <G0|A2> PASS|STOP`.
5. `g0` runs G0a on production, then G0b on streamanator with the dump and sha256 taken **only** from the authenticated G0a line.
6. The verifier never executes anything arm owns. Facts in arm-owned or root-only places come from the **root facts reader**
   (flagged, §6), as data.

**What it proves (rehearsed, run (b)).**
* Owner-path verdicts and exits are byte-identical before and after arm's login files, shims, node, checkout and `.env` were made
  hostile. Over the same hostile environment, the old arm path printed a forged `G0 PROD RESULT PASS` with `OFFHOST-COMPARE` and a
  forged `R6 PRE RESULT PASS`, both with exit 0.
* Replayed, stale, wrong-bundle, exit-lie and two-RESULT answers are refused, and a fresh answer is accepted.
* arm's key and another key cannot reach `afldb-verify`, and the verify key cannot reach arm. The verify key gets no PTY, shell or
  forwarding.
* A damaged published dump STOPs G0 at G0a, and G0b is not called.

**What it does not prove.**
* Production's real sshd configuration, host key, DNS/known_hosts entry and the `-F none` production transport. The rehearsal used a
  ProxyCommand through `docker exec`, printed as `transport=rehearsal`.
* Independent boots: both containers share streamanator's kernel, so G0a and G0b report the same `boot=`.
* The off-host rsync from production: the copy was carried in as a fixture.
* The checks whose evidence arm produces (§4).
* A **whole A-2 PASS**: it was never observed (§7).

## 3. Runs at the tested revision `5c2c2280e4688a063a5f943512e4460e250b1135`

Every run's sent or exported bytes were checked against the tested revision:
* (a) and (b) used `--verify-rev`: every sent file equals its blob, and no untracked file sits in the sent verify directories;
* (c) used a clean `git archive` of the tested revision inside the driver;
* (d) and (e) used a clean `git archive`.

| Run | Command (workstation Git Bash unless stated) | RID | Exit | Decisive result | Log |
|---|---|---|---|---|---|
| (a) sealed backup, real systemd, 10 scenarios | `bash R7/backup-harness/r7b-run.sh --verify-rev 5c2c2280… t5c2c2280` | `t5c2c2280` | 0 | `R7 BACKUP HARNESS RESULT PASS` | `backup-harness/logs/r7b-*.log`, `r7b-transport-t5c2c2280.log` |
| (b) owner verifier end to end, real systemd, 6 scenarios | `bash R7/verify-harness/r7v-run.sh --verify-rev 5c2c2280… t5c2c2280` | `t5c2c2280` | 0 | `R7 VERIFY HARNESS RESULT PASS` | `verify-harness/logs/t5c2c2280-*.log` |
| (c) r4 driver proof, printed blocks at the review revision | `bash <(git show 5c2c2280…:…/review-fixes-r3-20261124/prove-driver-fixes.sh) 5c2c2280… bfa09946… <scratch> r4` | runs `20261127T234526Z-10785-28700`, `20261127T235443Z-11610-6076` | 0 | `R6 r4 DRIVER PROOF PASS` | `logs/proof-driver-5c2c2280-review-bfa09946.log` |
| (d) release rehearsal (streamanator) | `bash rehearsal/rehearse.sh <export> <bundle> /mnt/ssd/afldb-verify-20261108T002136Z/node_modules` | — | 0 | `REHEARSAL RESULT PASS: 92 passed, 0 failed` | `logs/release-rehearsal-5c2c2280.log` |
| (e) new unit case (streamanator) | `node node_modules/vitest/vitest.mjs run tests/deploy-web-unit.test.ts` in a disposable copy | — | 0 | `Tests 46 passed (46)`; the new `status: AFLDB_BACKUP_SEALED_STATE_DIR … (R6 r7)` passed | `logs/vitest-deploy-web-unit-5c2c2280.log` |

### (a) Sealed backup (`backup-harness/`)

**Inputs.**
* REAL-SYSTEMD: systemd 255 (255.4-1ubuntu8.19) as PID 1 (kernel 6.8.0-151, Ubuntu 24.04.4), the real `afldb-backup.timer` at the
  fake-zone 02:20.
* REAL: the repository units, `backup.sh`, `offhost-pull.sh` and `scheduled-backup.sh`; PostgreSQL 16.15 `afldb_prod` with peer auth.
  The bundle was installed by its own `install-backup.sh`.
* FIXTURE: a fixed-offset Melbourne zone, timer `RandomizedDelaySec=0`, a 5000-row database with a per-run nonce, the role's
  `pg_read_all_data` grant, 15 planted older archives, and the two harness holds (a root psql lock; a root `strace` delay of the
  sealer's chown).

**Identities (logged).** `arm: uid=1000(arm) gid=1000(arm) groups=1000(arm),997(afldb-backup-read)`;
`afldb-backup: uid=999(afldb-backup) gid=996(afldb-backup) groups=996(afldb-backup)`. The gate runs as `r7reader` (uid 1500, groups
`r7reader`, `afldb-backup-read`).

| Scenario | Verbatim summary line (`r7b-summary.log`) |
|---|---|
| genuine | `SCENARIO genuine PASS expect=attributed so_rc=0 inv=5796400e06b8436cbc5d207eb1598ba6 dump=afldb_prod-20261128-022000.dump sha256=8c70a12d2ffee3dbd5752976633ad45d9c0d25d0adc620e6f751fa73351fe4b0 dispatch=scheduled delay=84.4s` |
| perm | `SCENARIO perm PASS expect=attributed so_rc=0 inv=909783cb05dd4d9fac9267b8667dc83a … dispatch=scheduled delay=85.5s`; `ARMPROBE-SUMMARY stage=creation attempts=79 allowed=0`, `stage=sealing attempts=94 allowed=0`, `stage=published attempts=100 allowed=0` |
| review2 | `SCENARIO review2 PASS expect=attributed so_rc=0 inv=04e62863d18e48558536a7a0591b3c2f … dispatch=scheduled delay=83.0s`; `[HARNESS] ok every SIGSTOP failed: 7 with EPERM, 2 with ESRCH (the process had already exited)` |
| hand-start | `SCENARIO hand-start PASS expect=refused so_rc=1 reason=0 seals in /var/lib/afldb-backup/seals record a start job created by afldb-backup.timer with its dispatch in the 2026-11-28 02:20-02:31 window (need exactly 1; a start by hand never counts)` |
| timer-then-hand | `SCENARIO timer-then-hand PASS expect=refused so_rc=1 reason=another run of afldb-backup.service was sealed in the window (/var/lib/afldb-backup/seals/8a88029ed2224fa884945d0e5f252cae.seal, trigger none): ambiguous` |
| restart | `SCENARIO restart PASS expect=refused so_rc=1 reason=seal /var/lib/afldb-backup/seals/6b4b3c1f296a467484e67720ac05ece7.seal: the unit entered inactive (monotonic 632441307099) after the dispatch (632440988713): …` |
| rearm-in | `SCENARIO rearm-in PASS expect=attributed so_rc=0 inv=967b5436af694746be661d9c2951bb97 dump=afldb_prod-20261128-022015.dump sha256=584961486f5152052004a4d6a712cf1f834536f757fa1e638906a40fff957e36 dispatch=catch-up delay=0.0s` |
| rearm-out | `SCENARIO rearm-out PASS expect=refused so_rc=1 reason=0 seals … 02:20-02:31 window …` (the catch-up was sealed at 02:32) |
| pgdump-fails | `SCENARIO pgdump-fails PASS expect=refused so_rc=1 …`; unit `Result=exit-code`, no seal, nothing published, OnFailure wrote `FAILED-unit` |
| seal-interrupted | `SCENARIO seal-interrupted PASS expect=refused so_rc=1 reason=published dump: /var/lib/afldb-backup/published/afldb_prod-20261128-022000.dump: missing, or a component cannot be read`; a root 0400 `.tmp` was left, which the next seal removes (sealer step 1) |

Also from `genuine`:
* three install refusals: staging under `/home`, group-writable staging, a tampered file;
* `verify-backup-install.sh` PASS as root and as arm;
* retention 15+1 → 14;
* arm `pg_restore --list` exit 0, and arm's REAL `offhost-pull.sh` from `published/` (`done: 14 newly verified, 0 pending, 0 failed`);
* arm's peer login refused;
* `scheduled-backup.sh status` with the opt-in sees the sealed nightly.

Final lines: `containers left with label r7b.run=t5c2c2280: 0; images with label r7b.run=t5c2c2280: 0` and
`R7 BACKUP HARNESS RESULT PASS`.

### (b) Owner verifier (`verify-harness/`)

**Inputs.**
* REAL-SYSTEMD: two containers, `afldb-prod` and `streamanator`, each with systemd 255.4 as PID 1.
* REAL: on prod, the real 02:20 timer ran R7/backup's installed bundle (real `pg_dump`, real sealer). The verifier was installed by
  `install-verify.sh --role prod|offhost` from a root-owned staging copy. On the off-host container, arm's real cron ran the real
  `afldb-offhost-pull-daily.sh` at 03:10. The workstation used the real Windows OpenSSH client (OpenSSH_for_Windows_9.5p2) with a
  fresh test key and pinned container host keys.
* FIXTURE: the fake zone; the app (`17822b29e6de-R7VfixtureBuild`, attested InvocationID); `.env`; R1 files copied into `/etc`; the
  `offhost-pull.sh` copy carried in instead of rsync from production.
* Not present: caddy, the weekly restore unit, production kernels.
* HARNESS: the ProxyCommand transport and the fake-transport replay cases.

**Identities (logged).**
* Verifier on prod: `uid=997(afldb-verify) gid=994(afldb-verify) groups=994(afldb-verify),996(afldb-backup-read),999(systemd-journal)`.
* Verifier on the off-host container: `uid=999(afldb-verify) gid=996(afldb-verify) groups=996(afldb-verify),999(systemd-journal)`.
* arm: `uid=1000(arm) gid=1000(arm) groups=1000(arm),996(afldb-backup-read)`.

| Scenario | Verbatim summary line (`t5c2c2280-summary.log`, cut where the log cuts it) |
|---|---|
| a g0-success | `SCENARIO a PASS g0-success: exit 0; OWNER VERDICT G0 PASS transport=rehearsal ssh=ssh.exe date=2026-11-28 invocation=431adf5e3fc749b0a4f1ecd40dc6c0bc dump=afldb_prod-20261128-022000.dump sha256=56b75aacf297316311ec8108dca9124b12307c76778c2dd14aadbc75f1359b7b dispatch=scheduled …`; G0a printed `DISPATCH scheduled 111.2 s after timer activation`; G0b printed `RESULT SCHEDULED-COPY-VERIFIED` and `R6 OFFHOST RESULT PASS` (cron dispatch `pid=925 … (a root syslog entry: _UID=0, SYSLOG_PID=_PID)`) |
| c a2-whole | `SCENARIO c PASS a2-whole: the verifier's own STOP (exit 1, 13 FAIL / 25 PASS lines), backup-origin=attributed reported separately …`; the verdict: `OWNER VERDICT A2 STOP transport=rehearsal … day=2026-11-28 backup-origin=attributed … exit=1` |
| d hostile-arm | `SCENARIO d PASS hostile-arm: owner-path verdicts and exits unchanged (… exit 0; a2 STOP exit 1); CONTRAST old path forged 'G0 PROD RESULT PASS' + OFFHOST-COMPARE (exit 0) and 'R6 PRE RESULT PASS' (exit 0)` |
| e stale-replay | `SCENARIO e PASS stale-replay: fresh control accepted, replay/stale/wrong-bundle/exit-lie/two-RESULT refused (fresh:0 replay:1 stale:1 bundle:1 exitlie:1 tworesults:1 )` |
| f keys | `SCENARIO f PASS keys: other-key-as-verify:ok arm-key-as-verify:ok verify-key-as-arm:ok verify-key-forced-tty:ok verify-key-no-command:ok verify-key-shell-command:ok verify-key-extra-words:ok verify-key-stdio-forward:ok arm-key-as-arm-control:ok` |
| b g0-refusal | `SCENARIO b PASS g0-refusal: exit 1, FAIL scheduled origin unproven: /var/lib/afldb-backup/published/afldb_prod-20261128-022000.dump has 3995 bytes, the seal says 3994; G0b not called, no OFFHOST-COMPARE` |

Final lines: `R7 VERIFY HARNESS RESULT PASS` and `removed 2 container(s); left: containers 0, images 0, workspace removed`.

### (c) Driver proof

The tested driver ran the printed blocks exactly as the R6 plan prints them at the review revision `bfa09946` (block 1 `CODE=` = the
tested revision), with a clean export of `5c2c2280` on streamanator. Block 1 archive sha256 `98bdedc4…`. Run 1 (normal):
`CASE-RESULT release-scripts-manifest OK (sha256sum -c exit 0; SHA256SUMS digest 52900a0e2102ec09820b037babe4c327ff63ac72236f9c4a80b84f1f54b06b59)`;
`SUITE f1 RESULT PASS (202 cases)`, `f2 … (308 cases)`, `f3 … (32 cases)`, `f4 … (12 cases)`, `f5 … (21 cases)`, `f6 … (21 cases)`,
`f7 … (29 cases)`, the same counts as r6 (f2 unchanged at 308); `== containers run: 31; … unexpected: 0`; `== done …: 10 steps, 0 unexpected`.
Run 2 (deliberate sabotage `b5-symlink-identical`) exited 1 with the sabotaged case reported UNEXPECTED. Final lines:
`== proof: run1 exit 0, sentinels after run1 intact; run2 exit 1, the sabotaged case reported UNEXPECTED 2 time(s), sentinels after run2 intact`
and `R6 r4 DRIVER PROOF PASS`; no run residue on either host.

### (d) Release rehearsal

**Staging.**
* The workstation made a `git archive` of the tested revision (the two evidence directories): `export.tar` `7b7a8e5b…`.
* A scratch bare repository held only `refs/heads/claude/release-17822b29-prep-20261123` = `17822b29…`, bundled as `rel.bundle`
  `24a72c93…`.
* On streamanator, `scripts/SHA256SUMS` gave 12 OK with manifest `52900a0e…`.
* `node_modules` `/mnt/ssd/afldb-verify-20261108T002136Z/node_modules`: its `package-lock.json` (`984b4422…`) equals 17822b29's.

The run was as arm. It ended `REHEARSAL RESULT PASS: 92 passed, 0 failed (2026-11-27T23:44:14Z)`,
`CLEANUP unit removed, workspace /mnt/ssd/afldb-r1-rehearsal.QdIQdI removed: yes`, `REHEARSE-EXIT 0`. The staging directory was then
removed.

### (e) Unit test

* Workspace: a disposable copy on streamanator, a `git archive` of the tested revision without `docs/v2/evidence`, `issues` and
  `documentation` (removed afterwards).
* `node_modules` was a symlink to `/home/arm/afldb-i316-apply-876dadbfa024-20261024T001117Z/node_modules` (vitest 4.1.10); node
  v22.23.2; as `uid=1000(arm)`.
* Result: the new case `status: AFLDB_BACKUP_SEALED_STATE_DIR (absolute, opt-in) is where the backup check reads last-backup.json
  (R6 r7)` passed; `Test Files 1 passed (1)`, `Tests 46 passed (46)`, `VITEST-EXIT 0`.

Two earlier attempts in the same session failed before any test ran, both for environment reasons, and are not logged:
1. `npx vitest`: the borrowed `node_modules` has no `.bin`, so exit 127.
2. An archive that also excluded `docs/`: the file reads `docs/deployment.md`, so the suite failed to load (ENOENT).

## 4. Remaining dependencies on arm

This merges both READMEs (backup §9, verify §9); nothing is dropped. Where these appear in the output they are labelled
`ARM-PRODUCED` or "arm data".

1. **The weekly restore evidence.** arm's `last-verify.json`, the FAILED markers in arm's `.state` and the restored dump file are
   arm's, because the restore runs as arm. r8 correction: the journal side is **not** trusted as a whole. `afldb-backup-verify.service`
   runs arm's checkout script (`tools/maintenance/scheduled-backup.sh verify`) as arm, so the restore journal line's content and the
   exit status PID 1 records as `Result=success` are arm-authored. Only the journald trusted fields (`_SYSTEMD_UNIT`,
   `_SYSTEMD_INVOCATION_ID`, the receipt time) and PID 1's timer and start facts are trusted: they prove that the scheduled unit ran
   and when, not what it restored (R8 `DEPENDENCIES.md` §3.1).
2. **The application itself.** The release directories, `release.json`, `events.log`, and the HTTP answers of `/api/health` and
   `_buildManifest.js` come from arm's processes. The verifier proves which release directory the running MainPID uses (kernel cwd),
   not that its content is what was built.
3. **`.env` line counts and the checkout HEAD** (INFO).
4. **streamanator.**
   * arm's job writes the pulled copy, its sidecar, the `.verified-` marker and the pull log.
   * The cron dispatch is trusted (journald `_UID=0`), and root re-hashes the copy, but the lineage lines are arm's.
   * The pull and G0b run under streamanator's arm unless the prospective `afldb-verify` install is also made there (DESIGN §5.4).
     The bytes G0b checks must hash to the sha256 from the authenticated G0a line, so streamanator's arm can only claim a copy it
     really holds.
5. **arm's crontab line**: read from the root-only spool, but arm edits it.
6. **The `OnFailure=` marker `FAILED-unit`** in arm's `.state`. It is informational only; failure is PID 1's `Result=`.
7. **The database content.** arm holds the owner DSN and can change data; that is a different property from dump provenance.
8. **The weekly `afldb-backup-verify.service`** still runs as arm with a fresh dump in `/home/arm/backups/afldb-scheduled`. Its dumps
   are never gate-eligible.

Added after the independent review (round 1), all nine items of its list, none dropped:

9. **The path to root (F1, HIGH).** On production root is reached through arm's login: the owner's `sudo` in an arm SSH session,
   for both installs, the `sudo -u postgres` steps and every root step of the plan. A hostile arm login environment can capture or
   reuse that root, and with root it can replace the sealer, the seals, the verifier, `authorized_keys` and the peer maps. **G1 and
   G2 hold only if the installs and every later root action use a root path that does not pass through arm's login** (the console,
   or a separate administrative account with its own key). Not fixable in code; a host-account change needing owner approval.
   Production `sudoers` has not been checked.
10. **Two A-2 PASS lines are decided by arm through the database:** `ledger 118`, and the `afldb_restore_test` comment and its
    connection count (`a2-core.sh`). arm's role writes the ledger and creates and comments that database. Item 7 covered database
    content only as a property of the dump; the verify README §6 is corrected (it called the catalogue trusted).
11. **The raw psql output channel to Stu's terminal (F2).** Fixed in round 1: every such line is printed through `san()`, the
    dispatcher and the wrapper sanitise and neutralise again (verify README §3). It remains arm's **data**, shown as data.
12. **Both sides of "process cwd = the release" are arm's.** The process is arm's and can `chdir`; the directory it is compared
    with is resolved through arm-owned links (`a2-core.sh`, `afldb-verify-rootfacts` `current_realpath`). Item 2's "proves which
    release directory the running MainPID uses" is therefore only "the MainPID's cwd equals the path arm's `current` link resolves to".
13. **The worker count**: arm's processes.
14. **`events.log` decides whether the "restarted since the last attested PASS" note appears**; arm can suppress it. What holds is
    the PID 1 `InvocationID` comparison.
15. **Production arm serves the off-host pull.** streamanator pulls over production arm's login, so production arm chooses the bytes
    sent. G0b's comparison with the sha256 of the authenticated G0a line limits this to denial. Item 4 covered streamanator's arm only.
16. **Denial.** arm can force G0 and A-2 to STOP at will (markers, process names, port 3100, large files, `/tmp`, a full disk, a
    stopped service). Not a forging risk: a STOP never becomes a PASS.
17. **Unknown, to check on the host:** whether arm's PostgreSQL role is a superuser. If it is, it can act as OS user `postgres`
    (for example `COPY … TO PROGRAM`). r8, precisely (R8 `DEPENDENCIES.md` §3.2). As `postgres` it **could**: edit `pg_hba.conf`
    and `pg_ident.conf` and reload, so arm authenticates as `afldb_backup` or `afldb_verify` (data it can already read; nothing over
    the seal or the verdict); change what the server answers, including the bytes the sealed run's `pg_dump` receives (content, not
    provenance: item 7) and the lines of item 10; stop or break the server (a STOP); impersonate the server on the postgres-owned
    socket directory. It **could not**, without a further escalation: write `/var/lib/afldb-backup`, either code directory, `/etc/systemd`
    or `/etc/ssh`; read staging; signal or ptrace `afldb-backup`, the root sealer or `afldb-verify`; alter a dump after `pg_dump`
    wrote it; forge `_UID=0` or `_SYSTEMD_UNIT` journal fields or PID 1 facts; reach the root facts socket. A postgres-to-root
    escalation through root tooling that handles postgres-owned files was not reviewed, so treat a superuser arm role as a step
    toward F1: check before installing (`SELECT rolsuper FROM pg_roles WHERE rolname = <arm's role>`, as postgres, through the F1
    root path) and revoke it if set.
18. **Look-alike verdict text (review round 2, N1, INFO).** The neutraliser prefixes only lines containing the exact phrases
    `OWNER VERDICT` / `AFLDB-VERIFY RESULT`; arm-influenced text such as `OWNER  VERDICT`, `VERDlCT` or a phrase split across lines
    reaches Stu's terminal as an indented data line. It is never the last line and never authenticated: only the wrapper's own
    `OWNER VERDICT` line, and its exit status, are the verdict. Read nothing else as one.

Added in r8 (the dependency review, R8 `DEPENDENCIES.md`, which classifies every item above and every trusted input):

19. **The seven A-2 arguments.** They come from the Tuesday record, printed by arm-run scripts over arm's login; A-2 checks that the
    live host matches them and nothing checks them against an independent source. Example: arm kills the application after the
    owner's Tuesday restart, systemd restarts it with a new `InvocationID`, and a hostile login prints that ID as the owner's; A-2's
    InvocationID line then PASSes. So an **`OWNER VERDICT A2 PASS` establishes that the live production host matched these seven
    arguments at `at=`**, not that the arguments are right. The wrapper prints this as an `A2 SCOPE:` line before the verdict, and
    each A-2 PASS line that rests on arm's data carries `[ARM-PRODUCED ...]`. `backup-origin=attributed` alone rests on root and
    PID 1 evidence. The G0 counterpart (`G0 SCOPE:`): the off-host pull-log lineage is ARM-PRODUCED.
20. **streamanator's root.** streamanator's arm is in the groups `sudo`, `docker` and `lxd` (observed 28 Nov 2026); `docker` and
    `lxd` are root-equivalent, so an off-host `afldb-verify` installed there today would rest on streamanator's arm: it could replace
    that verifier and its answers. G2 for the G0b half needs arm out of those groups there (owner action), or an explicit acceptance
    that the off-host half rests on streamanator's arm.
21. **The installer guard is a tripwire, not a proof (r8).** `install-backup.sh` and `install-verify.sh` now refuse, before any
    change, a root session that descends from arm (an ancestor with arm's real or effective uid, `SUDO_USER`/`SUDO_UID` = arm, or
    loginuid = arm), printing `REFUSED: root session descends from arm: <test>`. That catches the documented mistake (item 9: `sudo`
    in an arm session). It cannot catch root that arm already holds, which can start an installer outside its own process tree
    (`systemd-run`, `at`, cron) with a clean environment and an unset loginuid. Item 9 stays an owner action.
22. **arm's checks of the backup install (r8).** "verify-backup-install.sh as arm in a new login" let arm's login choose the process
    that judged arm's permissions. Acceptance is now root's `verify-backup-install.sh --as-arm` (setpriv to arm without arm's login,
    stdin `/dev/null`, a new session, output sanitised and prefixed `[as arm] `, verdict by the arm process's exit status and the
    dropped `id`); a run in an arm session ends `BACKUP INSTALL RESULT INFO-ONLY ...`. This removes arm's files and startup code from
    the probe, not a concurrently hostile arm process (R8-F-12): another arm process can write text into the child's output pipe
    (shown only as `[as arm]` data), signal it (a forced failure or hang, never a PASS) and, only where `kernel.yama.ptrace_scope=0`,
    ptrace it and forge the arm-side PASS. Root's own checks (ownership, modes, trusted paths, digests, `sealed_origin_install`) and
    every gate do not depend on the arm probe (backup README section 9).

## 5. Installation prerequisites and order (owner; nothing here was installed)

All of these must be met **before the qualifying 02:20 backup**, the 02:20 run of the gate date. They run:
* outside 02:15–02:50;
* as root reached by a path that does **not** pass through arm's login (review round 1, **F1**; §4 item 9): the provider console
  logged in **as root**, or the admin root session of `../review-fixes-r8-20261128/OWNER-PROCEDURE.md` (r8), that is, the separate
  account `afldb-admin` with its own key and password, then `sudo -k; sudo /usr/bin/bash --noprofile --norc`. None of these
  qualifies: `sudo` in an arm SSH session, `ssh afldb … sudo`, or a console login **as arm** (with or without `sudo`/`su` after it).
  No such path exists on production today; OWNER-PROCEDURE Phases 0–1 create and verify it before any change to existing access,
  and production `sudoers` is unchecked. Every later root action uses the same session: the `runuser -u postgres` steps, the
  pg_hba/pg_ident edits and reloads, rollback, and every root step of the plan. arm's SSH session carries only unprivileged, pinned
  scripts and data;
* after OWNER-PROCEDURE Phase 2 (r8) has established, among its other checks, that arm's PostgreSQL roles are not superusers (§4
  item 17; checks D1/D4);
* from root-owned staging directories outside `/home`. The bytes are a `git archive` of the tested revision
  `12e46305bf6b3ab063ffd7a2e8daf481eedfb8f3`, made in the owner's **workstation** clone, hashed there, and carried over the admin path. The admin root
  session re-verifies them against the workstation value. Never copy them from arm's checkout, never run git as root in it, and
  never read an expected digest from a file on production. (r7 named `7d69302007568d3141a567c8eba89e4ee473c9a6` here; r8 changes
  the installers, so the pin moves.)

Nothing writes the production checkout, so P1/P2's clean-tree checks are unchanged. The operator text is in the release runbook §4.1a
and the R6 plan's r7 note.

1. **Production, R7/backup** (backup README §5).
   * Preconditions: the base units are root-owned copies, not links; no r6 attest drop-in; the zone file is a root-owned regular file.
   * Check `SHA256SUMS` `e3a68821c6f97ec7a5775cbf845b4018198556f44d29e89ceb6ff0c4e2672e7d` (r7: `d0023d10…`), then run `install-backup.sh` in the admin root session. It
     refuses (`REFUSED: root session descends from arm`) a root session that descends from arm (r8).
   * In the same session, add the `pg_ident`/`pg_hba` lines before any broader `local` line, then reload.
   * `verify-backup-install.sh` must print `BACKUP INSTALL RESULT PASS` twice, both run from the admin root session: once as root,
     and once with `--as-arm` (r8). With `--as-arm`, root drops to arm through
     `setpriv --reuid=arm --regid=arm --init-groups --reset-env`, `/usr/bin/bash --noprofile --norc` and stdin `/dev/null`, so the
     process carries the new group without arm's login or startup files. This replaces r7's "as arm in a new login".
2. **Production, R7/verify** (verify README §8, §10). It needs group `afldb-backup-read`, so step 1 comes first.
   * Preconditions: `/usr/bin/python3.12`, group `systemd-journal`, `/usr/lib/postgresql/16/bin/psql`, `Include
     /etc/ssh/sshd_config.d/*.conf` at the top of `sshd_config`, and Stu's new key pair.
   * In the admin root session, run `install-verify.sh --role prod --key …`. The key is Stu's verify public key, carried over the
     admin path and fingerprint-checked against the workstation. The installer refuses a session that descends from arm (r8).
   * In the same session, apply `verifier-db.sql` with `runuser -u postgres`, add the `pg-auth-lines.txt` lines, and reload.
   * Run `verify-verify-install.sh --role prod` in the same session.
3. **streamanator** (owner; root there reached by an independent path as in OWNER-PROCEDURE §8). How the owner reaches root there
   is UNKNOWN. streamanator's arm is in `docker`, `lxd` and `sudo`, all root-equivalent, so until the owner decides otherwise
   `G0B PASS` is attested by a host arm controls. It can forge the off-host claim, not the dump bytes.
   * Run `install-verify.sh --role offhost --key …`, then `verify-verify-install.sh --role offhost`.
   * The pull source becomes `<prod>:/var/lib/afldb-backup/published/`. This is an unprivileged edit of arm's own files: the forced
     `rrsync -ro` path in production arm's `authorized_keys`, and streamanator's pull configuration. No root step is involved.
   * Status probes add `AFLDB_BACKUP_SEALED_STATE_DIR=/var/lib/afldb-backup/state`.
4. **Workstation.**
   * Stage `verify/` from `12e46305bf6b3ab063ffd7a2e8daf481eedfb8f3` in the owner's own clone and run `sha256sum -c SHA256SUMS`
     (`49e0fa7c84a549ba5153cec9d94c2fa2ca91d89aff34458dd9dc2fa9a4f13901`; wrapper `BUNDLE_SHA` `58fceba650dcd25ede0e55b25bfcb8a8236c3a4fe6ae6ebd94535832bbd506c8`; r7: `7d693020`, `221b254a…`, `df3457cc…`).
   * Run `afldb-verify-call.sh version`. It must print `OWNER VERDICT VERSION PASS` for both hosts.

Until then, and until a sealed timer run exists for the gate date, G0 and A-2 STOP, by design. Rollback: backup README §6.

## 6. Deviations (full table: DESIGN §7)

All implementation deviations are accepted except two:
* **B10** (`pg_wrapper` trusted by path): a residual.
* **V1, flagged for the independent reviewer.** The verifier's **root facts reader** is a new privileged component:
  * a socket-activated root service, python3.12, with `CapabilityBoundingSet=CAP_DAC_READ_SEARCH CAP_SYS_PTRACE`, serving
    `afldb-verify` on a root:afldb-verify 0660 socket;
  * it opens and parses **arm-owned paths**: `/home/arm` (checkout refs, `.env` key counts, release directories, `release.json`,
    `events.log`), arm's 0700 backup `.state`, the crontab spool, the 0700 off-host copy and `/proc/<MainPID>/cwd`;
  * it executes `/usr/bin/systemctl show`.

  Its safety rests on O_NOFOLLOW walks, regular-file/owner checks, size caps, output sanitising and a fixed grammar. DESIGN §5 did not
  foresee it.

V2 records that system helpers (python, bash, systemctl, journalctl, psql) are trusted by path and ownership, not by digest.

r8 (not in DESIGN §7; each changes the packet, none changes the seal format `/4`, `.done`, the dispatch-kind rule, a refusal or a
date gate):
* **R8-1 installer guard** (§4 item 21): both installers refuse a root session descending from arm before any change. A tripwire.
* **R8-2 `verify-backup-install.sh --as-arm`** (§4 item 22): the arm process receives the script's **bytes** with `bash -c`, not its
  path, because the staging directory may be root-only (arm could not open the path); it prints the file's sha256 and the sha256 of
  the bytes passed, which must be equal. The arm-session run is INFO only.
* **R8-3 `install-verify.sh` trust order**: r7 sourced the staging `bundle/lib.sh` before checking that the staging was trusted. r8
  checks the path (and refuses `/home`), every component and lib.sh's digest first, and executes `verify-verify-install.sh` only when
  it is trusted and equals its line in the packet `SHA256SUMS`, checked before any change.
* **R8-4 wrapper `version` exit**: r7 exited 0 even when a host answered STOP; r8 exits 1 unless both hosts answer an authenticated
  PASS. The wrapper also prints `A2 SCOPE:` / `G0 SCOPE:` lines (§4 item 19) before the verdict; the `OWNER VERDICT` line format is
  unchanged.
* **R8-5 labels**: A-2 and G0b PASS lines that rest on arm's data carry `[ARM-PRODUCED ...]`; no check changed.
* **R8-6 the service unit pinned whole (independent review R8-F-7)**: `sealed_origin_install` now requires `DropInPaths` to be exactly
  the pinned drop-in, an empty environment and no bind/mount settings, no shell- or loader-affecting variable in the service manager's
  environment, and the base unit byte-identical to `deploy/afldb-backup.service` (a production copy that differs is a fail-closed STOP
  at install). The timer stays unpinned by design (it only moves the dispatch, which the window check judges). `sealed-origin.sh`
  changes (`1153df78…` -> `a733e67b…`), so does the verifier bundle; backup README section 4 item 13, R8 `DEPENDENCIES.md` C20, C21.

## 7. What remains unproven

* **Production.** Nothing is installed or run there. Unproven: production's sshd configuration and host key, the `-F none` transport,
  its systemd job `ActivationDetails`, the unit install form, directory modes, the zone file, the PostgreSQL cluster path, and the
  off-host rsync source change.
* **A whole A-2 PASS has never been observed.** The verifier's A-2 exits 1 in the container, as r6's did, with 13 FAIL lines caused
  by the dated fixture and the container. The positive A-2 results that remain **unproved** are:
  1. today is the scheduled Wednesday 2026-11-25 (the dated gate; the container date was 2026-11-28);
  2. running kernel `6.8.0-137-generic`;
  3. installed kernel images exactly {137, 149};
  4. `/boot/vmlinuz` and `/boot/initrd.img` for 149;
  5. the same for 137;
  6. both modules directories;
  7. caddy active;
  8. the Caddyfile digest;
  9. the weekly restore service's timer dispatch, start and successful completion in the Wednesday window;
  10. `last-verify.json` and the restored dump matching that scheduled invocation;
  11. `afldb_restore_test` carrying the scheduled restore digest, with no active connections.

  Also never positive in a container: `reboot-required present` (INFO there) and real GRUB facts (container `grubenv` empty, firmware
  BIOS by absence).
* **Observed positive only on fixture inputs.** The release status and worker checks on a fixture app; env counts 1/1 on a fixture
  `.env`; R1 files copied from the repository; `ledger 118` and `backup status rc 0` on fixture state.
* **A-2's backup attribution** (`backup-origin=attributed`) **was** observed positive, separately from the whole-A-2 STOP, as was
  G0 (G0a and G0b) PASS.

## 8. Unchanged

* Finding 1 (the parser) and findings 3–8 are unchanged; the f1, f3–f7 counts are in the driver proof.
* The Tuesday sitting artefacts give `sha256sum -c SHA256SUMS-SITTING`: 4 OK.
* The owner's "before P4" ruling stays open.
* The dated gates are unchanged: G0 and `g0` accept 2026-11-24..29, A-2 requires 2026-11-25, and P4's cutoff is 24 Nov 11:30.
* A future sitting still needs a new date, re-dated and re-pinned packets, the independent PASS at that commit, a new owner approval,
  both installs before the qualifying 02:20 backup, and that day's owner-path evidence.

## 9. Development history (not evidence for the tested revision)

The implementers' `final1` runs used uncommitted worktree bytes on `2d772fe4`. Their logs are kept in `backup-harness/logs/dev-final1/`
and `verify-harness/logs/dev-final1/`. The backup README §8 table and the verify README §12 describe those runs. The runs at the tested
revision are those in §3.
