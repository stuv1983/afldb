# OWNER-PROCEDURE: an independent root path for production (R6 r8, 28 Nov 2026; amended r9 and r10, 28 Nov 2026)

**r10 amendment (Astra's four acceptance cases on draft PR 5; PREPARED, NOT RUN).** Record: [../review-fixes-r10-20261128/README.md](../review-fixes-r10-20261128/README.md).

1. **Receipt, not possession (§8, G0b).** A G0b PASS now needs the identified 03:10 invocation to have RECEIVED the dump itself
   (rsync created the file in that run with all its bytes, the run verified it) and a per-dump `RECEIPT` written after that run's
   `END rc=0`. A copy that was already there, a different dump moved by the same job, and a failed run are possession only.
2. **Qualification without a loop (§8, `$R9/offhost/QUALIFY-OFFHOST.md` §3).** Candidate evidence is collected before any pin with
   `afldb-verify-call.sh candidate-g0|candidate-version`, which never print an `OWNER VERDICT` and never exit 0. The owner reviews it,
   commits the pin, exports that commit, and runs the gate from that export. The gate checker takes the reviewed commit as `--pin-rev`
   and requires the pin in it to be the one the 4.6 and G0 calls used, so an old export and a fixture pin both stay NO-GO.
3. **An access change voids saved evidence (Phase 4).** A permission change or a Phase 4 back-out voids 4.4, 4.5, 4.6 and every gate
   verdict made before it, **even on the same boot and inside the freshness window**: repeat 4.4, 4.5 and 4.6 and make a new gate
   call. `afldb-phase4.sh apply`, `backout` and `invalidate` record this automatically: they write a new access epoch before any change,
   the verifier prints it on every RESULT line, 4.4 and 4.5 save it, and the gate checker requires one value throughout.
4. **Phase 4 is bound to the exact change and attempt (Phase 4).** `--dispose` is withdrawn. The owner selects each reviewed grant by its
   `--remove-grant FILE:LINES:SPAN-SHA256:FILE-SHA256` token; an unselected grant blocks entry, a second grant in the same file included.
   Entry creates its own state directory, prints it and its seal, and prints the exact apply, verify and back-out commands carrying both.
   There is no fixed state path any more: recovery uses the command printed for that attempt.

**r9 amendment (Astra's three merge blockers on draft PR 5; PREPARED, NOT RUN).** Record: [../review-fixes-r9-20261128/README.md](../review-fixes-r9-20261128/README.md).

1. **Off-host evidence must be independent (§8).** G0b counts only from an off-host endpoint the owner has qualified by
   `$R9/offhost/QUALIFY-OFFHOST.md` and pinned in `$R9/offhost/QUALIFIED-ENDPOINT`. The option to accept an arm-attested G0b is
   **withdrawn**, and the workstation wrapper enforces it: with no pin, or a pin naming streamanator, `g0` ends in a nonzero
   `OWNER VERDICT G0 STOP`, even when streamanator answers an authenticated PASS with the right dump and sha256. A qualified
   endpoint must also link the scheduled 03:10 dispatch to transfer completion and a rehash of the received file; a matching file
   at check time is possession only. **No endpoint is qualified today**, so G0 STOPs, the release stops before P2, and R6
   NG-OFFHOST/NG-DATA stay NO-GO.
2. **Phase 3 authorises nothing (3.13, Phase 4 'Saved evidence').** Phase 3's VERSION PASS is an installation diagnostic and
   Phase 3 ends in STOP. Release G0 and R6 NG-PRE are GO only on `GATE ACCEPT RELEASE-G0 GO` / `GATE ACCEPT NG-PRE GO` from
   `$R9/accept/afldb-gate-accept.sh`, which requires the saved post-change `OWNER CHECKS RESULT PASS` (4.4), the re-verification of
   both installed bundles (4.5), a later workstation version check (4.6), and then the gate's own wrapper verdict with exit 0
   (NG-PRE: `OWNER VERDICT A2 PASS`; A-2 backup attribution alone never satisfies it).
3. **Phase 4 entry and back-out are exact (Phase 4; r10 replaces the script with `$R10/phase4/afldb-phase4.sh`).** Step 4.0 admits a B3 match only when it
   is the `%sudo` membership being removed, or a rule the owner disposes of explicitly; any other grant is REFUSED and needs its own
   disposition first. It records the pre-change state and the exact back-out of each approved change, and `backout` restores and
   validates it (a changed rule is restored byte-identically and checked with `visudo -c`).


**Status: PREPARED, NOT RUN.** Claude never contacted production (209.38.87.252, alias `afldb`) and did not change any account on
streamanator. The procedure was rehearsed only in a disposable container on streamanator (`procedure-harness/`, §9). It closes
independent review round 1 **F1** (HIGH) only when the owner has carried out Phases 0 to 4 and Phase 2 prints
`OWNER CHECKS RESULT PASS` after Phase 4. Until then F1 stays OPEN, and G1 and G2 do not hold against a hostile arm.

The owner's design decision, which this procedure implements:

* Privileged installation, maintenance and recovery use an independently authenticated admin path. An existing independent console
  is preferred. Otherwise there is a separate admin account with its own key.
* The dedicated backup producer (`afldb-backup`) and the owner verifier (`afldb-verify`) stay as designed in r7.
* The guarantees are unchanged:
  * **G1**: the identified timer invocation produced the accepted dump.
  * **G2**: the owner receives an authentic gate verdict.
* An in-window timer catch-up is acceptable when it is labelled.

This procedure **supersedes every instruction that reaches root through arm**. That covers:

* `sudo` in an arm SSH session, and `ssh afldb … sudo`;
* a console login as arm, or `su` / `sudo` typed in it;
* "as arm in a new login";
* staging from, running from, or reading digests from `/home/arm`.

These instructions appear in r7 README §5, backup README §5/§6, verify README §8/§10, the R6 plan's r7 note and plan steps, and
release RUNBOOK §4.1a/§4.2. Each now points here.

## 0. Rules for every step

**Where a command runs.** Every command below carries one of these labels:

| Label | Session | How it is reached | What it may do |
|---|---|---|---|
| **[WS]** | The owner's workstation, Git Bash, in the owner's own clone | local | Compute and read every expected digest and fingerprint; build the bundle bytes with `git archive` |
| **[CON]** | The provider console, logged in **as root at the `login:` prompt** | DigitalOcean Recovery Console (Phase 0) | Phase 0 and Phase 1; the Phase 4 back-out |
| **[ADM]** | The admin account's own SSH session | `ADM` (defined in Phase 1), admin key only | Receive bytes; start the root shell below |
| **[ADM-ROOT]** | The admin root session: `sudo -k; sudo /usr/bin/bash --noprofile --norc` typed in [ADM], with the admin's password | from [ADM] | Every privileged step: staging, installs, `runuser -u postgres`, pg_hba/pg_ident edits and reloads, systemd, grub, journal reads, rollback |
| **[ARM]** | arm's SSH session (`ssh afldb`) | arm's key | **Only** unprivileged, pinned scripts and data transfer. Never `sudo`, `su` or `pkexec`, and never type any password. Never treat its output as evidence about root |

A console login **as arm** does not qualify as [CON], whether or not `sudo` or `su` is typed after it. arm's `.bashrc` or `.profile`
can define `sudo`, `su`, `id` or `uname` as functions, so anything typed into a shell that arm's startup files prepared can be
captured or faked. Debian bash also reads `.bashrc` for `ssh host cmd`. The only safe first input is the `login:` prompt of `getty`,
which arm cannot replace without root.

**Never in any session:**

* run, source, install from or read a digest from `/home/arm` (in particular the checkout `/home/arm/projects/afldb` and its `.env`);
* run `git` as root in arm's repository;
* read an expected digest from a file on production.

Expected values are computed on [WS] and compared **by eye** with what [ADM-ROOT] prints.

**Secrets.** Type the admin's password only at a `passwd` or `sudo` prompt in [CON] or [ADM]. Never put it on a command line, in a
file, in a log or in evidence.

**Connections.** The owner's home firewall IPS blocks bursts of SSH connections, so keep connections few:

* reuse one interactive [ADM] session for a whole phase;
* wait at least a minute between new connections;
* if a connection is refused or times out, wait 10 minutes and do not retry in a loop.

**Pins** (r9: the revision, the verify packet, the bundle digest, and the two new r9 rows changed; the backup bundle and the owner
checks did not). They are filled when the coordinator commits:

| Placeholder | What it pins | Expected `[WS]` command |
|---|---|---|
| `@REV@` | the revision whose bytes are installed | `git rev-parse @REV@^{commit}` |
| `e3a68821c6f97ec7a5775cbf845b4018198556f44d29e89ceb6ff0c4e2672e7d` | `$R7/backup/SHA256SUMS` | `git show @REV@:$R7/backup/SHA256SUMS \| sha256sum` |
| `@P_VERIFY@` | `$R7/verify/SHA256SUMS` | `git show @REV@:$R7/verify/SHA256SUMS \| sha256sum` |
| `70d05b10b4b1898e978550e113c9fefa06dd873c585e7d3445bf73b0fb8b648f` | `$R8/owner-checks/SHA256SUMS` | `git show @REV@:$R8/owner-checks/SHA256SUMS \| sha256sum` |
| `@P_BUNDLE@` | the wrapper's pinned `BUNDLE_SHA` (verify README §1) | `grep '^BUNDLE_SHA=' $R7/verify/afldb-verify-call.sh` at the tested revision |
| `@P_PHASE4@` | `$R10/phase4/SHA256SUMS` (r10, the Phase 4 entry/apply/verify/back-out/invalidate script; replaces r9's `$R9/phase4`) | `git show @REV@:$R10/phase4/SHA256SUMS \| sha256sum` |
| `@P_ACCEPT@` | `$R9/accept/SHA256SUMS` (r9, the workstation gate acceptance checker; r10 content) | `git show @REV@:$R9/accept/SHA256SUMS \| sha256sum` |

Paths used below:

* `R7=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r7-20261128`
* `R8=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r8-20261128`
* `R9=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r9-20261128`

**Historical gates are unchanged.** A-2 is dated 2026-11-25, g0 accepts 2026-11-24..29, and the P4 cutoff was 24 Nov 11:30. The
owner's "before P4" ruling remains unresolved.

**What this cannot prove.** arm's sudo password has historically been typed in arm sessions. If any of those sessions was hostile,
arm may already have had root, and root can leave persistence that no read-only check finds. The checks close every route they know
of; they do not prove the host was never compromised. Only a rebuild from known-good media would. The owner accepts this residual
explicitly at Phase 4.

## Phase 0. An independent console (provider console, as root)

| # | Where | Command | Proves | Stop condition |
|---|---|---|---|---|
| 0.1 | DigitalOcean control panel | Droplet → Access → Launch Recovery Console | a provider path that does not pass through arm's account | none |
| 0.2 | [CON] | at `login:` type `root`, then root's password | a root login no arm file prepared | root is locked or has no password, which is **likely**: the plan records "root is locked on the cloud image". If no root login is possible: **STOP. F1 stays OPEN**, and Phases 1–4 do not start |
| 0.3 | [CON] | `id; cat /proc/self/loginuid; tty` | `uid=0(root)`, loginuid `0`, a console tty (`tty1`/`ttyS0`) | anything else: STOP |
| 0.4 | [CON] | `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` | production's host key fingerprint, read independently of every SSH session; write it down | none |

Whether the Recovery Console can log in as root is **UNKNOWN**. If it cannot, the provider-side options below are owner decisions.
Claude has not verified any of them. Each needs a window and, for the first two, a reboot or outage (the Wednesday reboot is NO-GO
today):

* **(i) "Reset root password"** (Access tab). This power-cycles the droplet and delivers a new root password out of band. Change it
  at once in [CON] with `passwd`.
* **(ii) The Recovery ISO.** Boot it, mount the disk, `chroot`, and set root's password. This is a full outage.
* **(iii) The Droplet Console** (agent-based web console). It qualifies only if it logs in as **root** directly; whether it can
  depends on the droplet agent and sshd's `PermitRootLogin`, both **UNKNOWN**.

The console is slow to type into and has no paste, so the long values below (keys, digests) never have to be typed into it. They
travel as data, and the console only compares fingerprints.

## Phase 1. The separate admin account `afldb-admin` (from the console)

| # | Where | Command | Proves | Stop condition |
|---|---|---|---|---|
| 1.1 | [WS] | `ssh-keygen -t ed25519 -f ~/.ssh/afldb_admin -C afldb-admin` (set a passphrase) | a new key used for nothing else: not arm's key, not `~/.ssh/afldb_verify` | none |
| 1.2 | [WS] | `ssh-keygen -lf ~/.ssh/afldb_admin.pub` | the fingerprint `SHA256:…`; write it on paper | none |
| 1.3 | [WS]→[ARM] | `tr -d '\r' < ~/.ssh/afldb_admin.pub \| ssh afldb 'umask 077; cat > ~/afldb_admin.pub'` | arm carries the **public** key as data only, which is safe because it is checked in 1.5. The workstation strips carriage returns first: Windows OpenSSH `ssh-keygen` writes the `.pub` with a CRLF line end (r8 review R8-F-13) | none |
| 1.4 | [CON] | `K=/root/afldb-r8-keyin/afldb_admin.pub; install -d -m 0700 /root/afldb-r8-keyin; rm -f $K $K.n $K.line` then `setpriv --reuid=arm --regid=arm --init-groups --reset-env /usr/bin/cat /home/arm/afldb_admin.pub < /dev/null > $K` | root takes a copy with arm's rights; it does not follow anything arm could link | none |
| 1.5a | [CON] | `sed 's/\r$//' $K > $K.n && [ "$(grep -c '' $K.n)" = 1 ] && LC_ALL=C grep -Eqx 'ssh-ed25519 [A-Za-z0-9+/]{68}( [ -~]*)?' $K.n && awk '{print $1, $2}' $K.n > $K.line && echo KEY-SHAPE-OK` | a **machine** test (r8 review R8-F-8), not a judgement by eye. One trailing carriage return is stripped first, in case 1.3's strip was skipped (r8 review R8-F-13; rehearsed: `pubkey-crlf`); otherwise the test is unchanged. The file is then exactly one line, and that line is `ssh-ed25519`, the 68-character key and at most a printable comment, with **nothing before it** (no options prefix). Only the type and key fields are kept, in `$K.line` | no `KEY-SHAPE-OK`: **STOP**. The carried key is malformed or not the workstation key (rehearsed: `pubkey-optprefix`). Create nothing; carry it again from the workstation with 1.3 |
| 1.5b | [CON] | `[ "$(ssh-keygen -lf $K.line \| awk '{print $2}')" = "SHA256:<the paper fingerprint, typed>" ] && echo KEY-FP-MATCH` | the kept key is **the workstation's** key | no `KEY-FP-MATCH`: **STOP**. The carried key is not the workstation key (rehearsed: `pubkey-swap`). Create nothing |
| 1.6 | [CON] | `useradd -m -U -s /bin/bash afldb-admin` | an account with its own primary group | `useradd` error: STOP |
| 1.7 | [CON] | `passwd afldb-admin` | the admin's own sudo password, typed twice at the prompt and nowhere else | none |
| 1.8 | [CON] | `usermod -a -G sudo afldb-admin; chmod 0750 /home/afldb-admin` | full sudo **with that password**; arm cannot enter the home | none |
| 1.9 | [CON] | `install -d -o afldb-admin -g afldb-admin -m 0700 /home/afldb-admin/.ssh` then `install -o afldb-admin -g afldb-admin -m 0600 $K.line /home/afldb-admin/.ssh/authorized_keys` | exactly one bare key line, the one 1.5a/1.5b checked, authorises the account (checked again by F5) | none |
| 1.10 | [CON] | `id afldb-admin; stat -c '%U:%G %a %n' /home/afldb-admin /home/afldb-admin/.ssh /home/afldb-admin/.ssh/authorized_keys; ssh-keygen -lf /home/afldb-admin/.ssh/authorized_keys; sshd -T -C user=afldb-admin,host=x,addr=127.0.0.1 \| grep -E '^(allowusers\|allowgroups\|denyusers\|denygroups\|pubkeyauthentication\|forcecommand)'` | the expected values are listed below the table | arm in any of the admin's groups, or `AllowUsers` excluding afldb-admin: fix it in [CON] before 1.11 |
| 1.11 | [WS] | define `ADM` (below), then `ADM` (a **new** connection; **keep the console open**) | the admin path works with the admin key alone, against the pinned host key | host key prompt or mismatch: STOP. Permission denied: fix in [CON] |
| 1.12 | [ADM] | `id; sudo -k; sudo -v; sudo -l` | `id` shows afldb-admin and `sudo`; `sudo -v` takes **the admin's** password; `sudo -l` shows `(ALL : ALL) ALL` | any difference: fix in [CON] |
| 1.13 | [ADM] | `exit`; wait; repeat 1.11–1.12 in a second new connection | Phase 1 has been verified **twice**, which Phase 4 needs | none |

Expected values for 1.10:

* `id afldb-admin` shows uid ≥1000 and groups `afldb-admin` and `sudo` only;
* the home is `afldb-admin:afldb-admin 750`, `.ssh` is `700` and `authorized_keys` is `600`;
* `authorized_keys` is one line carrying the paper fingerprint;
* `sshd -T` prints `pubkeyauthentication yes` and `forcecommand none`, and no `allowusers` / `allowgroups` line excludes afldb-admin.

`ADM`, defined on [WS] in Git Bash. `HostKeyAlias` is the name under which `~/.ssh/known_hosts` already holds production's key: run
`ssh-keygen -F 209.38.87.252` and `ssh-keygen -F afldb`, and use whichever is found. Its `ssh-keygen -lF <name>` fingerprint must
equal the one read in 0.4. If it does not, STOP.

```
ADM() { C:/Windows/System32/OpenSSH/ssh.exe -F none -o IdentitiesOnly=yes -o IdentityAgent=none -o IdentityFile=~/.ssh/afldb_admin \
  -o StrictHostKeyChecking=yes -o HostKeyAlias=<name> -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no \
  afldb-admin@209.38.87.252 "$@"; }
```

**The admin root session [ADM-ROOT].** In [ADM], run `sudo -k; sudo /usr/bin/bash --noprofile --norc` and type the admin's
password. Then run `export PATH=/usr/sbin:/usr/bin LC_ALL=C; umask 022; cd /`. Every [ADM-ROOT] step below runs in such a session.
Each new [ADM-ROOT] session also starts by setting every variable the later steps use (r8 review R8-F-10), typed in full:

* `R7=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r7-20261128`
* `R8=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r8-20261128`
* `R9=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r9-20261128`
* `R10=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r10-20261128`
* `P4=/root/afldb-r10-phase4` (r10: there is no fixed state directory; 4.0 creates one per attempt and prints it)
* `T=/home/afldb-admin/afldb-r8-stage.tar; X=/root/afldb-r8-extract; OC=/root/afldb-r8-owner-checks; BK=/root/afldb-r8-backup; VF=/root/afldb-r8-verify`

Setting a variable whose directory does not exist yet is harmless. A step run in a session that has not set them fails closed: it
fails on an empty path and changes nothing, but it costs time on the day.

What Phase 1 proves: a root session exists whose ancestry contains no arm process and no arm login. Check A2 confirms this in
Phase 2. Its authentication uses a key and a password arm never held.

## Phase 2. Read-only owner checks (before any change; repeated after Phase 3 and Phase 4)

### 2.1 Bytes: from the workstation clone only

| # | Where | Command | Proves | Stop condition |
|---|---|---|---|---|
| 2.1.1 | [WS] | `git fetch; git rev-parse @REV@^{commit}` | the pinned revision is present in the owner's own clone | unknown revision: STOP |
| 2.1.2 | [WS] | `git archive --format=tar -o ~/afldb-r8-stage.tar @REV@ $R7/backup $R7/verify $R8/owner-checks $R10/phase4/afldb-phase4.sh $R10/phase4/SHA256SUMS tools/maintenance/backup.sh` | the only acceptable source of bundle bytes | none |
| 2.1.3 | [WS] | `sha256sum ~/afldb-r8-stage.tar`, plus the four `git show … \| sha256sum` commands of §0 for backup, verify, owner checks and phase4 (r10: `$R10/phase4`) | the TAR value is written down; the four SHA256SUMS values equal the pins | any pin differs: STOP |
| 2.1.4 | [WS]→[ADM] | `ADM 'umask 077; set -C; cat > ~/afldb-r8-stage.tar' < ~/afldb-r8-stage.tar` | the bytes travel over the admin path, never through arm | `set -C` refusal (a file already there): remove it in [ADM-ROOT] and resend |
| 2.1.5 | [ADM-ROOT] | `T=/home/afldb-admin/afldb-r8-stage.tar; stat -c '%U %a %s' $T; sha256sum $T` | owner `afldb-admin 600`, and **the TAR value of 2.1.3** (compared by eye) | different: STOP |
| 2.1.6 | [ADM-ROOT] | `X=/root/afldb-r8-extract; rm -rf $X; install -d -m 0700 $X; tar -x --no-same-owner --no-same-permissions -f $T -C $X; chown -R root:root $X; chmod -R go-w $X` | root-owned extracted bytes, outside `/home` | tar error: STOP |
| 2.1.7 | [ADM-ROOT] | `OC=/root/afldb-r8-owner-checks; install -d -m 0755 $OC; install -m 0644 $X/$R8/owner-checks/afldb-owner-checks.sh $X/$R8/owner-checks/SHA256SUMS $OC/; sha256sum $OC/SHA256SUMS; (cd $OC && sha256sum -c --strict SHA256SUMS)` | `70d05b10b4b1898e978550e113c9fefa06dd873c585e7d3445bf73b0fb8b648f` and `OK` | different: STOP |
| 2.1.8 | [ADM-ROOT] | `P4=/root/afldb-r10-phase4; install -d -m 0755 $P4; install -m 0644 $X/$R10/phase4/afldb-phase4.sh $X/$R10/phase4/SHA256SUMS $P4/; sha256sum $P4/SHA256SUMS; (cd $P4 && sha256sum -c --strict SHA256SUMS)` | `@P_PHASE4@` and `OK` (r10) | different: STOP |

### 2.2 Run

[ADM-ROOT], or [CON] as root:

```
env -i PATH=/usr/sbin:/usr/bin LC_ALL=C /usr/bin/bash --noprofile --norc /root/afldb-r8-owner-checks/afldb-owner-checks.sh \
  --admin afldb-admin --admin-fp SHA256:<the paper fingerprint> [--accept /root/afldb-r8-accept.txt]
```

The script is read-only. It writes nothing but stdout, starts nothing, changes no account, and only SELECTs, as OS user `postgres`
by peer. It prints one line per check, `CHECK <id> PASS|FAIL|UNKNOWN <fact>`, then `OWNER CHECKS RESULT PASS` (exit 0) or
`OWNER CHECKS RESULT BLOCKED fail=… unknown=…` (exit 1). It never prints a secret: no DSN, password, hash or key material, and from
`.env` only variable and role names. Facts it reads "as arm" are read through
`setpriv --reuid=arm --regid=arm --init-groups --reset-env /usr/bin/bash --noprofile --norc`, with stdin `/dev/null`. That gives
arm's rights, without arm's login, startup files or environment.

Every such arm-side probe is **fail-closed** (r8 review R8-F-1, R8-F-2). These are C6 (arm's key listing), D4 (arm's `.env`), E0
(`sudo -n true`) and E1 (the write probe).

* The probe's last action prints a sentinel carrying a random per-call nonce.
* The script accepts the probe only when it exited 0 **and** its last line is that sentinel. Otherwise the check is
  `FAIL probe did not complete`. No check ever reads PASS from absent output.
* The probe runs under a root-owned `timeout --kill-after=5 60`, outside `setpriv`, so arm cannot stop the timer (r8 review
  R8-F-15). A probe that arm stops or that hangs is killed after 60 seconds, and the check is `FAIL probe did not complete`.
* A concurrently hostile arm process can still kill the probe, which gives FAIL, or (same uid) write into its output. So each probe
  has a root-side companion that does not depend on arm:
  * E1 has E2;
  * C6 and F5 have the root-side key-file trust checks of C5, E2 and F5, since adding a key to root's or the admin's
    `authorized_keys` means writing a path E2 protects;
  * D4 has D1 and D2;
  * E0 has B1 and B2.

**Expected results:**

* **Before Phase 4:** `BLOCKED`, with at least B1, B2 and B3 failing: arm can sudo, and `%sudo` names a group of arm. r9: B3 is
  acceptable only on matches that step 4.0 classifies as group-only (`%sudo`) or selected (r10: by a `--remove-grant` token). That is the state rehearsed as `checks-pre` and
  `checks-post-install`.
* **After Phase 4:** `PASS`.
* **Any other FAIL or UNKNOWN** has to be resolved, or accepted by the owner in writing, before Phase 4. An UNKNOWN is never read as
  PASS. E3 entries can be accepted only through `--accept`: a root-owned file listing one absolute path per line, each a path the
  owner reviewed and accepts as never executed, sourced or installed by root.

### 2.3 Every check: command, expected result, what stays blocked

All checks run from the single command in 2.2. "Blocks" says what stays blocked while the check is not PASS:

* **G1/G2**: the guarantee cannot be claimed against a hostile arm;
* **install**: Phase 3 must not start;
* **sudo removal**: Phase 4 must not start.

| Id | What it establishes (and how) | Expected | Blocks if not PASS |
|---|---|---|---|
| A1 | the checks run as root (`id -u`) | PASS | everything |
| A0 | an account `arm` exists (`getent passwd arm`) | PASS | everything (the checks are written for production's arm) |
| A2 | **(a)** no ancestor of this process has real or effective uid arm, loginuid arm, or `SUDO_USER`/`SUDO_UID` = arm (`/proc/<pid>/status`, `loginuid`, `environ` walked to PID 1) | PASS | **everything**. The session descends from arm, so no result is independent and the result line adds "(session not independent …)". Go back to [CON] or [ADM-ROOT]. Rehearsed: `arm-sudo-checks` |
| A3 | `SUDO_USER` of this process is not arm | PASS | everything |
| B1 | **(b)** arm's effective sudo, `sudo -n -l -U arm` as root | before Phase 4 **FAIL** (arm may run commands); after **PASS** ("not allowed") | G1/G2 until Phase 4 |
| B2 | arm is in group `sudo`, `admin` or `wheel` (`id -nG arm`) | before FAIL, after PASS | G1/G2 until Phase 4 |
| B3 | no non-comment line of `/etc/sudoers` or of a file directly in `/etc/sudoers.d/` names `arm` or `%<g>` for any group `g` arm is in (`id -Gn arm`). Include directives are listed, not followed: B5 judges their targets, and a rule in a file outside those two places is not searched | before Phase 4 **FAIL** (`%sudo`); after PASS | G1/G2, and sudo removal, except for matches that step 4.0 classifies as group-only (every `%sudo`, never edited) or selected (r10: an exact `--remove-grant` token; r9 said disposed, `--dispose`). Production sudoers is **UNKNOWN**: a rule naming arm directly survives `gpasswd`. B3 itself does not see a rule by uid (`#1000`, which its comment filter drops), by gid (`%#…`), for an `ALL` or negated user or a netgroup, on a continuation line, or from nsswitch, LDAP or sssd. Step 4.0 is deliberately stricter and refuses each of these, naming file:line (rehearsed: residual-uid, residual-all, refuse-uid-alias, refuse-continued, refuse-negated, refuse-nsswitch). Step 4.2 and B1 catch anything added later through `sudo -l -U arm` and the file inventory (rehearsed: late-grant) |
| B4 | report: sudo's `timestamp_type` and timeout (`sudo -V`) | report | nothing. Production's value is **UNKNOWN** and recorded |
| B5 | every `@include`/`#include`/`#includedir` target named in those files is a trusted path (no component arm-owned, group/other-writable, ACL-bearing or a symlink; an absent target passes if its parents do). It prints one PASS line listing the targets, or FAIL naming each. The sudoers files themselves are judged by E1/E2 | PASS | G1/G2, sudo removal |
| B6 | `passwd -S` of root, arm and the admin; none is `NP` (no password) | PASS (report L/P) | G1/G2 if arm or root is `NP` |
| C1 | **(c)** arm is not in `docker`, `lxd`, `incus`, `libvirt`, `disk` or `shadow` (root-equivalent or secret-reading groups); `adm` and `systemd-journal` are reported (read only) | PASS | G1/G2, and sudo removal is not sufficient on its own |
| C1s | report: the docker/lxd/containerd sockets and their owners and modes | report | nothing |
| C2 | the only polkit rule mentioning arm is the known settle rule: `50-afldb-settle-afltables.rules`, sha256 `3164e0d9…c50b64` = `deploy/afldb-settle-afltables-trigger.rules` (start of `afldb-settle-afltables.service` only). It prints PASS for that rule, FAIL for any other `.rules` file mentioning arm, and one PASS line when no `.rules` file mentions arm | PASS | G1/G2 |
| C2b | no `.pkla` (legacy polkit) entry names arm | PASS | G1/G2 |
| C3 | **every** service unit that root runs is judged. Root-run means `User=` root or unset, or any command with a `+`/`!`/`!!` prefix. The checks run over the unit files and loaded units from `systemctl list-unit-files`/`list-units`, using `systemctl show` `Exec*Ex`/`EnvironmentFiles`/`Environment`; templates are judged from their text. Each executable path, each absolute-path argument that is a file, and each `EnvironmentFile` is walked from `/`, following every symbolic link and walking its target too. A bare command name (`ExecStart=systemctl …`) is resolved as systemd does, through `/usr/local/sbin`, `/usr/local/bin`, `/usr/sbin`, `/usr/bin`, `/sbin`, `/bin`, and every candidate up to and including the first that exists is judged. The path FAILs only when **arm can modify it** (r8 review R8-F-14): a component owned by arm; group-writable with a group arm is in; world-writable (a sticky directory excepted); an ACL entry (`getfacl`) granting write to arm or one of arm's groups; a link owned by arm; or an absent component below a directory arm can write. Other group-writable or ACL-bearing components (for example `/var/log`, root:syslog 0775), sticky world-writable directories and links owned by another non-root user are **reported** as `path(owner:group:mode)` in the PASS line, not failed. A component that cannot be evaluated (stat or getfacl fails) makes C3 **UNKNOWN**, never PASS; without `getfacl` only the mode bits are judged, and the PASS line says so (rehearsed: `fc-c3-gw-other`, `fc-c3-gw-arm`). `Environment=` must not mention `/home/`, and a `+`/`!` command in a User=arm unit is FAIL. User=arm units run as arm, so they are reported, not failed. Not judged: timer, socket and path units, which activate a service that is itself judged; and an interpreter's own runtime lookups (r8 review R8-F-9) | PASS | G1/G2 |
| C4 | no root cron entry (`/etc/crontab`, `/etc/cron.d`, root's spool, `cron.{hourly,daily,weekly,monthly}`) references an arm-writable path | PASS | G1/G2 |
| C5 | `/root`, and each of `/root/.bashrc`, `.profile`, `.bash_profile`, `.bash_login`, `.bash_logout`, `.bash_aliases`, `.inputrc`, `.ssh`, `.ssh/rc`, `.ssh/environment`, `.ssh/authorized_keys`, `.ssh/authorized_keys2` that exists, is a trusted path, and none mentions `/home/`. The system-wide `/etc/profile`, `/etc/profile.d`, `/etc/bash.bashrc` and `/etc/environment` are judged under E1/E2, not C5 | PASS | G1/G2 (they run in every [ADM-ROOT] `sudo -i`; this procedure avoids `-i`, but they also run in [CON]) |
| C6 | report: fingerprints only of root's authorised keys, read from sshd's effective `AuthorizedKeysFile` for root (`sshd -T -C user=root`, `%h`/`%u` expanded; r8 review R8-F-9). FAIL if one equals one of arm's keys. arm's keys come from sshd's `AuthorizedKeysFile` for arm plus `~/.ssh/*.pub`, read **as arm** by a fail-closed probe: FAIL "probe did not complete" if it does not finish. UNKNOWN if sshd takes root's keys from an `AuthorizedKeysCommand`. Suppressing the probe hides only the overlap test: adding arm's key to root's keys means writing a file C5/E2 protect | PASS | G1/G2 |
| C7 | report: `kernel.yama.ptrace_scope` | report (production **UNKNOWN**) | nothing. At 0 arm can ptrace arm's own processes, which is one more reason never to type anything in [ARM] |
| C8 | report: sshd's effective `permitrootlogin`, `passwordauthentication`, `pubkeyauthentication`, `permituserrc`, `permituserenvironment`, and the first directive of `sshd_config` | report | **install** of the verifier needs `Include /etc/ssh/sshd_config.d/*.conf` as the first directive (production **UNKNOWN**) |
| C9 | `/etc/ld.so.preload` absent | PASS | G1/G2 |
| D0 | **(d)** PostgreSQL reachable as OS user `postgres` by peer (`runuser -u postgres -- psql -X`, no DSN) | PASS | D1–D5 cannot be established, so G1/G2 stay blocked |
| D1 | **membership closure** (r8 review R8-F-6): no login role other than `postgres` is a superuser, or a member, direct or inherited, of **any** superuser role, login or `NOLOGIN` (`pg_has_role(r, s, 'MEMBER')`, whatever the INHERIT/SET options). Every superuser role is listed; `rolcreaterole`, `rolreplication` and `rolbypassrls` are reported per role. Rehearsed: `fc-pg-nologin-super` | PASS | **G1/G2 and install**. A superuser can `COPY … TO PROGRAM` as OS user postgres, which owns the pg conf files. Production: **UNKNOWN** (r7 §4 item 17). Rehearsed: `fc-pg-superuser` |
| D2 | no non-superuser login role other than `postgres` is a member, direct or inherited, of `pg_execute_server_program`, `pg_write_server_files` or `pg_read_server_files` (FAIL names role and server role) | PASS | G1/G2, install |
| D3 | report: the owner of `afldb_prod` | report | nothing |
| D4 | the role named by each DSN in arm's `.env`, **read as arm**, with only the user part extracted (variable and role names printed; `TEST` DSNs skipped). Each such role is not a superuser, is not a member (direct or inherited) of any superuser role, and is not a member of any of the three server program/file roles; FAIL names the superuser roles it reaches. The file is read by a fail-closed probe: FAIL "probe did not complete" if it does not finish | PASS | G1/G2, install. UNKNOWN if the file is absent or unreadable by arm (then establish arm's role another way) |
| D5 | `pg_hba` has no `trust` line, and `pg_ident` maps neither arm nor a regex to `postgres`, `all`, `afldb_backup` or `afldb_verify`; include directives are reported as UNKNOWN | PASS | G1 (`afldb_backup`), G2 (`afldb_verify`) |
| E0 | **(e)** a fresh arm process cannot run `sudo -n true`. Fail-closed probe: PASS only on the probe's completed `SUDO-N-REFUSED` answer | PASS | G1/G2 |
| E1 | as arm (`setpriv … -c '[ -w … ]'`), no component of any protected path is writable. The protected paths are the staging copies; `/usr/local/lib/afldb-backup`, `/usr/local/lib/afldb-verify` and their contents; `/var/lib/afldb-backup/*`; `/etc/systemd/system/afldb-backup.service.d`; `/etc/ssh/sshd_config.d`; `/etc/ssh/afldb-verify`; `/etc/postgresql/16/main/pg_{hba,ident}.conf`; `/etc/sudoers{,.d}`; polkit; `/etc/passwd`, `/etc/shadow`, pam, profile; `/root`; the bash, sudo and sshd binaries; the admin's home, `.ssh`, `authorized_keys` and startup files. Fail-closed probe (r8 review R8-F-1): PASS only when the probe completed and listed nothing; a killed, cut-short or timed-out (60 s, R8-F-15) probe is FAIL "probe did not complete" | PASS (absent paths are reported, not failed, so the check works before installation) | G1/G2, install |
| E2 | as root, every component of those paths from `/` is not arm-owned, not group/other-writable, has no named ACL entry (`getfacl`) and is no symlink | PASS | G1/G2, install. Rehearsed: `fc-group-writable` |
| E3 | outside `/home`, `/tmp`, `/var/tmp`, `/proc`, `/sys`, `/dev`, `/run/user`: no arm-owned, arm-group-writable or world-writable file, and no non-sticky world-writable directory, except known entries (arm's cron spool, mail) and `--accept` entries | PASS; otherwise UNKNOWN with the first 25 paths | G1/G2 until each path is reviewed and accepted or fixed |
| E3a | the `--accept` file itself is a trusted root-owned file | no line when trusted or when `--accept` is not given; FAIL otherwise | G1/G2 |
| F1 | the admin account exists | PASS | **install, sudo removal**. Rehearsed: `fc-no-admin` |
| F2 | arm is not in the admin's primary group | PASS | install, sudo removal |
| F3 | the admin has `(ALL) ALL` **without** `NOPASSWD` | PASS | install, sudo removal |
| F4 | the admin has a usable password (`passwd -S` = `P`) | PASS | install, sudo removal |
| F5 | across all of sshd's `AuthorizedKeysFile` paths for the admin (`sshd -T -C user=…`), there is **exactly one** key line, and it is a **bare** key line: type, base64 and at most a comment, with **no options prefix**, which is what 1.9 writes. The files are trusted and owned by the admin or root, the home and startup files are trusted, the key is not one of arm's, and its fingerprint equals `--admin-fp`. FAIL on any options prefix, a second key line, a non-key line or a fingerprint mismatch (r8 review R8-F-8); FAIL "probe did not complete" if C6's arm-side key listing did not finish. Rehearsed: `fc-admin-key-option`, `fc-admin-extra-key`, `fc-no-admin` | PASS | install, sudo removal |
| F6 | sshd allows the admin public-key login with no `ForceCommand` and no `AuthorizedKeysCommand` (which would add keys F5 cannot see) | PASS | install, sudo removal |

Production facts that are **UNKNOWN** today and are only recorded by these checks:

* the sudoers content and `timestamp_type` (B3, B4);
* `ptrace_scope` (C7);
* whether root can log in at the console (Phase 0);
* whether arm's PostgreSQL roles are superusers (D1, D4);
* the position of the sshd `Include` (C8);
* `python3.12`, `systemd-journal` and `/usr/lib/postgresql/16/bin/psql` (checked by `install-verify.sh` itself);
* `AllowUsers` / `AllowGroups` (F6).

## Phase 3. Installs through the admin path (backup first, then verifier); then STOP

All steps are [ADM-ROOT] unless marked. The bytes are the extracted tar of 2.1.6, already verified against the workstation. The
installers refuse a root session that descends from arm: an ancestor with real or effective uid arm, `SUDO_USER`/`SUDO_UID` = arm,
or `/proc/self/loginuid` = arm's uid. They then print a line beginning `REFUSED: root session descends from arm` and change nothing.
The guard is agent B's (r8). It is a tripwire for the mistake of installing from arm's session, not proof of F1. The checks of
Phase 2 are that proof.

| # | Where | Command | Proves | Stop condition |
|---|---|---|---|---|
| 3.1 | [ADM-ROOT] | `BK=/root/afldb-r8-backup; rm -rf $BK; install -d -m 0755 $BK; for f in afldb-backup-run afldb-backup-seal 70-afldb-backup-sealed.conf sealed-origin.sh install-backup.sh verify-backup-install.sh SHA256SUMS; do install -m 0644 $X/$R7/backup/$f $BK/; done; install -m 0644 $X/tools/maintenance/backup.sh $BK/backup.sh` | the flat root-owned staging outside `/home` that `install-backup.sh` requires | none |
| 3.2 | [ADM-ROOT] | `sha256sum $BK/SHA256SUMS; (cd $BK && sha256sum -c --strict SHA256SUMS)` | `e3a68821c6f97ec7a5775cbf845b4018198556f44d29e89ceb6ff0c4e2672e7d` and 7× `OK` | different: STOP |
| 3.3 | [ADM-ROOT] | backup README §5 prerequisites, then `bash $BK/install-backup.sh $BK` | the installer completes without `BACKUP INSTALL RESULT FAIL` (backup README §5 step 2) | `REFUSED: root session descends from arm`: you are not in [ADM-ROOT]. Any other failure: STOP, rollback per backup README §6 |
| 3.4 | [ADM-ROOT] | edit `/etc/postgresql/16/main/pg_ident.conf` (+ `afldbbackup afldb-backup afldb_backup`) and `pg_hba.conf` (+ `local afldb_prod afldb_backup peer map=afldbbackup` **before any broader `local` line**) with root's editor; then `runuser -u postgres -- psql -X -c 'SELECT pg_reload_conf()'` | the dedicated producer can log in by peer | reload not `t`: STOP |
| 3.5 | [ADM-ROOT] | `bash $BK/verify-backup-install.sh` | `BACKUP INSTALL RESULT PASS` (root checks) | FAIL: STOP |
| 3.6 | [ADM-ROOT] | `bash $BK/verify-backup-install.sh --as-arm` | `BACKUP INSTALL RESULT PASS` for arm's checks. Root drops to arm with `setpriv --reuid=arm --regid=arm --init-groups --reset-env`, `/usr/bin/bash --noprofile --norc` and stdin `/dev/null`, so the fresh process carries `afldb-backup-read` without any arm login | FAIL: STOP. (This replaces "as arm in a new login".) |
| 3.7 | [WS]→[ADM] | `ADM 'umask 077; set -C; cat > ~/afldb_verify.pub' < ~/.ssh/afldb_verify.pub`; on [WS] `ssh-keygen -lf ~/.ssh/afldb_verify.pub` (paper) | the verify public key travels over the admin path | none |
| 3.8 | [ADM-ROOT] | `VF=/root/afldb-r8-verify; rm -rf $VF; cp -r $X/$R7/verify $VF; install -m 0644 /home/afldb-admin/afldb_verify.pub $VF/afldb_verify.pub; chown -R root:root $VF; chmod -R go-w $VF; ssh-keygen -lf $VF/afldb_verify.pub; sha256sum $VF/SHA256SUMS; (cd $VF && sha256sum -c --strict --quiet SHA256SUMS)` | the paper fingerprint (one ed25519 line), `c9910a87b977dc3c8857064a1a31aba3974fe1a6b0e2027a481d0cb00eb873da`, no mismatch | different: STOP |
| 3.9 | [ADM-ROOT] | verify README §10 prerequisites, then `bash $VF/install-verify.sh --role prod --key $VF/afldb_verify.pub` | `INSTALL-VERIFY RESULT PASS`: the verifier account, forced command, facts socket and units are installed | `REFUSED …`: not [ADM-ROOT]. Other failure: STOP |
| 3.10 | [ADM-ROOT] | `runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d afldb_prod < $VF/verifier-db.sql`; add the `pg-auth-lines.txt` lines (ident map; the hba line directly after the `afldb_backup` line, both before any broader `local`); `runuser -u postgres -- psql -X -c 'SELECT pg_reload_conf()'` | the verifier's read-only DB role and peer map | error: STOP |
| 3.11 | [ADM-ROOT] | `bash $VF/verify-verify-install.sh --role prod` | `VERIFY-INSTALL RESULT PASS` | FAIL: STOP |
| 3.12 | [ADM-ROOT] | the Phase 2 command again | still `BLOCKED` on B1, B2 and B3 (arm can sudo): the installs alone do not close F1 (rehearsed: `checks-post-install`) | any **new** FAIL: STOP |
| 3.13 | [WS] | in the owner's clone at `@REV@`: `grep '^BUNDLE_SHA=' $R7/verify/afldb-verify-call.sh` (= `3ea412092a3b024bd6520d9106694f874e45335974b6be96a85083ffac2ecb95`), then `bash $R7/verify/afldb-verify-call.sh version` | **an installation diagnostic only** (r9): `OWNER VERDICT VERSION PASS … host=afldb-prod role=prod` shows that the installed verifier answers the verify key with the pinned bundle. The off-host line is `OWNER VERDICT VERSION STOP … reason="no qualified off-host endpoint"` (exit 1) until an endpoint is qualified (§8). While 3.12 is BLOCKED, arm can still reach root, so this is **not** an authentic verdict and authorises nothing: no release G0, no NG-PRE, no reboot. `afldb-gate-accept.sh` rejects any Phase 3 output (rehearsed: `ce1`–`ce4`, `n4`) | a production VERSION STOP: STOP and investigate in [ADM-ROOT] |

**STOP. Phase 3 ends here, and no Phase 3 output is GO evidence (r9).** After 3.5, 3.6, 3.11 and 3.13 pass, the owner checks are
still BLOCKED on B1, B2 and B3 (3.12): both installs and the VERSION call pass while arm can still reach root. Neither release G0,
R6 NG-PRE nor the reboot may rely on any of them (Astra's counterexample; rehearsed `ce1`–`ce4` in `$R9/accept/evidence/` and
`accept-counterexample` in the procedure harness). The owner decides separately on Phase 4. The installs made while arm still had
sudo are re-verified after Phase 4 (4.5). A gate becomes GO only through `$R9/accept/afldb-gate-accept.sh` on the saved Phase 4
outputs and that gate's verdict (Phase 4, 'Saved evidence').

## Phase 4 (proposed; owner approval required; not part of the install). Change existing access

Preconditions:

* Phase 1 verified twice (1.13): two independently authenticated admin logins.
* The [CON] root session open throughout, until 4.7.
* Every Phase 2 FAIL other than B1, B2 and B3 resolved, and every UNKNOWN resolved or accepted. B1 and B2 are the sudo membership
  that Phase 4 removes. B3 is exempt **only** for matches that step 4.0 classifies as `group-only` (every `%sudo` line, in a
  file with a selected grant too: removed by `gpasswd -d arm sudo`, and never edited, because it is also afldb-admin's route to root,
  1.8) or `selected` (r10: a grant the owner selects by its exact `--remove-grant` token, which apply removes; r9's file-wide
  `--dispose` is withdrawn and is now a usage error). Step 4.0 is stricter
  than B3. Any other grant needs its own disposition before Phase 4, and 4.0 refuses it, naming file:line and token: a line naming
  `arm`; a `User_Alias` containing arm or `#<arm uid>`, or a member with a backslash or quote; `%<another group arm is in>` or `%#<gid>`; a `#<arm uid>` rule; an `ALL` or
  `!`-negated user; a netgroup or `%:` group; arm in `admin` or `wheel`; an include of any target other than `/etc/sudoers.d`; a sudo
  rule source other than files (nsswitch `sudoers:`, LDAP, sssd, a `sudo.conf` Plugin line); any grant left unselected, a second grant
  in a file where another is selected included; a selection that holds a `%sudo` line or shares a (continued) line with one; a
  malformed, duplicate, overlapping or out-of-date token (the file or its lines changed after review); a resulting file that
  `visudo -cf` refuses.
* The owner has accepted the residual of §0.
* Every routine that used `sudo` from arm has an [ADM-ROOT] replacement. In the repository, `deploy/release.mjs` and
  `deploy/post-install-check.sh` now print [ADM-ROOT] hints (r9), and `docs/deployment.md` §3a shows the restart in [ADM-ROOT]. The
  RUNBOOK P6 restart and journal reads, the R6 plan's grub/systemd steps and the other `docs/deployment.md` sections still say
  `sudo`; they move to [ADM-ROOT]. The settle trigger uses polkit, not sudo, and is unaffected.
* The owner's **separate approval of the privilege removal**, given after reading the 4.0 output, which shows each change, its exact
  back-out, the attempt's state directory (`PHASE4 STATE /root/afldb-phase4/attempt-<UTC>-<8 hex>`) and its seal (`PHASE4 SEAL
  <sha256>`). **Write down the state directory, the seal and the three printed commands (apply, verify, back-out)**; the approval
  names that state directory and seal, and is not valid for any other attempt.

**An access change voids saved evidence (r10).** A permission change on production (an account, group, key, sudoers or PAM change)
or a Phase 4 back-out voids every saved 4.4, 4.5 and 4.6 output and every gate verdict made before it, **even on the same boot and
inside the 3 h freshness window**. All three (4.4, 4.5, 4.6) and a new gate call are then required. The tooling records this itself:
`afldb-phase4.sh apply`, `backout` and `invalidate` write a new access epoch to `/var/lib/afldb-access/epoch` **before** they change
anything and end with `VOID: STOP: every saved 4.4, 4.5 and 4.6 output and every gate verdict made before this moment is VOID …`;
the verifier appends `access-epoch=` to every RESULT line; 4.4 and 4.5 save it as their second line; and the gate checker accepts
only one epoch across 4.4, 4.5, 4.6 and the verdict (`failed=access` otherwise). **An access change the owner makes or learns of
outside this script** is recorded by hand, in [ADM-ROOT] or [CON], before anything else:
`env -i PATH=/usr/sbin:/usr/bin LC_ALL=C /usr/bin/bash --noprofile --norc $P4/afldb-phase4.sh invalidate --reason '<what changed>'`
(→ `PHASE4 INVALIDATE RESULT PASS` and the VOID line). A change nobody records is not seen by the epoch: 4.4's owner checks
(B1–B3, F1–F5) are then the only defence, which is why they are repeated after any such change.

| # | Where | Command | Proves | Stop condition |
|---|---|---|---|---|
| 4.0 | [ADM-ROOT] | `(cd $P4 && sha256sum -c --strict SHA256SUMS) && env -i PATH=/usr/sbin:/usr/bin LC_ALL=C /usr/bin/bash --noprofile --norc $P4/afldb-phase4.sh entry [--remove-grant FILE:START-END:SPAN-SHA256:FILE-SHA256]...` (r10: no `--state`, no `--dispose`) | a NEW root-only attempt directory `/root/afldb-phase4/attempt-<UTC>-<8 hex>` holding the pre-change record: arm's groups, the sudo group line, a copy, sha256, owner and mode of `/etc/sudoers` and every file in `/etc/sudoers.d`, every match (file:line, token) classified group-only (every `%sudo`), selected or unrelated, and for each selected grant the resulting file (the copy minus exactly the selected lines, checked by `visudo -cf`). It prints each change with its exact back-out, then `PHASE4 STATE <dir>`, `PHASE4 SEAL <sha256>` and the apply, verify and back-out commands carrying both, and ends `PHASE4 ENTRY RESULT PASS change=group-only\|group-and-grants … state=<dir> seal=<sha256>`. It writes nothing outside the new directory (rehearsed: group-only, two-grants-one-selected, etc-sudoers-grant, refuse-*) | `REFUSED`: STOP, nothing changed. A grant 4.0 lists as unrelated names the `--remove-grant` token that would select it: decide on that grant, and on every other grant in its file, then re-run Phase 2 and 4.0 (which makes a new directory; the refused one is never applied). Select only grants the owner decided to remove |
| 4.1 | [ADM-ROOT] | the **apply** command 4.0 printed, exactly as printed: `(cd /root/afldb-r10-phase4 && sha256sum -c --strict SHA256SUMS) && env -i … $P4/afldb-phase4.sh apply --state <dir> --seal <sha256>` | it refuses, before any change, unless `<dir>` is a sealed PASS entry with that seal, no other attempt is applied and the host still equals the record. Then it writes a new access epoch, records the attempt as applied, installs each selected file's planned bytes with its recorded owner and mode, runs `gpasswd -d arm sudo` and `visudo -c`, and ends `PHASE4 APPLY RESULT PASS` with the VOID line and the back-out command again (rehearsed: grant-refused-then-retry, wrong-dir-apply, apply-host-changed) | `REFUSED`: STOP, nothing changed. `FAIL`: it has restored the record itself; STOP |
| 4.2 | [ADM-ROOT] | the **verify** command 4.0 printed, exactly as printed (`… verify --state <dir> --seal <sha256>`) | `PHASE4 VERIFY RESULT PASS`: arm is no longer in sudo and its other groups are unchanged; every unselected sudoers file has its recorded sha256, owner and mode, and nothing was added; each selected file equals its planned bytes, owner and mode; `sudo -l -U afldb-admin` equals its 4.0 record; includes are still only `/etc/sudoers.d`; `visudo -c` passes; the rescan finds nothing; `sudo -l -U arm` reports "not allowed" | STOP: back-out (below) at once, then dispose of the residual grant separately (Phase 2, then a new 4.0). Never "back to 4.1". A STOP means arm still has a grant 4.0 did not plan for, a grant was added after 4.0, or something changed outside the plan (rehearsed: late-grant, unplanned-edit, state-tamper). If back-out then REFUSES naming a file added or changed after entry, review it in [CON], restore or remove it by hand, and run the same back-out command again until `PHASE4 BACKOUT RESULT PASS` |
| 4.3 | [ADM] | `exit` the admin session; from [WS] open a **new** `ADM`, run `sudo -k; sudo -v`, then enter [ADM-ROOT] | the admin path still reaches root after the change (rehearsed: `admin-login-2`) | fails: **back-out** (below) |
| 4.4 | [ADM-ROOT] | `{ echo "BOOT-ID $(/usr/bin/tr -d - < /proc/sys/kernel/random/boot_id)"; echo "ACCESS-EPOCH $(cat /var/lib/afldb-access/epoch 2>/dev/null \|\| echo none)"; env -i PATH=/usr/sbin:/usr/bin LC_ALL=C /usr/bin/bash --noprofile --norc /root/afldb-r8-owner-checks/afldb-owner-checks.sh --admin afldb-admin --admin-fp SHA256:<the paper fingerprint>; } 2>&1 \| tee /root/afldb-r9-4.4.txt` | first line `BOOT-ID <32 hex>`; second line `ACCESS-EPOCH <32 hex>` (the epoch 4.1 wrote; r10); last line `OWNER CHECKS RESULT PASS`, with B1, B2 and B3 PASS (rehearsed: `checks-post-access`). The file is the saved 4.4 evidence. **Void after any later access change or back-out, even on the same boot and within 3 h** | BLOCKED: resolve; F1 stays open until PASS |
| 4.5 | [ADM-ROOT] | a **new** [ADM-ROOT] session: first set `R7`, `R8`, `R9`, `T`, `X`, `OC`, `BK`, `VF` as in Phase 1, then `{ echo "BOOT-ID $(/usr/bin/tr -d - < /proc/sys/kernel/random/boot_id)"; echo "ACCESS-EPOCH $(cat /var/lib/afldb-access/epoch 2>/dev/null \|\| echo none)"; bash $BK/verify-backup-install.sh; bash $BK/verify-backup-install.sh --as-arm; bash $VF/verify-verify-install.sh --role prod; } 2>&1 \| tee /root/afldb-r9-4.5.txt`; then `install -m 0644 -o afldb-admin -g afldb-admin /root/afldb-r9-4.4.txt /root/afldb-r9-4.5.txt /home/afldb-admin/` | first line `BOOT-ID <32 hex>`; second line `ACCESS-EPOCH <32 hex>`, equal to 4.4's; then in this order: `BACKUP INSTALL RESULT PASS`; `BACKUP INSTALL RESULT PASS (as arm via setpriv, no login: …)` with no `sudo` group; `VERIFY-INSTALL RESULT PASS` (rehearsed: `reverify`) | FAIL: STOP; treat the install as untrusted and reinstall from 3.1 |
| 4.5a | [WS] | at least a minute after the last connection: `mkdir -p ~/afldb-r9-accept && ADM 'tar -cf - afldb-r9-4.4.txt afldb-r9-4.5.txt' \| tar -xf - -C ~/afldb-r9-accept` | 4.4 and 4.5 are saved on the workstation, over the admin path | a file is missing: repeat 4.5a |
| 4.6 | [WS] | `bash $R7/verify/afldb-verify-call.sh version 2>&1 \| tee ~/afldb-r9-accept/afldb-r9-4.6.txt` | `OWNER VERDICT VERSION PASS … host=afldb-prod role=prod … access-epoch=<the 4.4 value>`, made after 4.4 and 4.5. The off-host line must be PASS (`qualification=pinned`) for release G0 only; until §8's qualification it is `STOP … no qualified off-host endpoint` | production STOP: investigate in [ADM-ROOT] |
| 4.7 | [CON] | `exit` | the console is closed only after 4.3–4.6 | none |

**Back-out** (r10; if 4.1 errs, 4.2 STOPs or 4.3 fails). In the still-open [CON] root session, or a fresh console session, run the
**back-out command that 4.0 printed for this attempt** (4.1 prints it again), exactly as written down:
`(cd /root/afldb-r10-phase4 && sha256sum -c --strict SHA256SUMS) && env -i PATH=/usr/sbin:/usr/bin LC_ALL=C /usr/bin/bash --noprofile --norc /root/afldb-r10-phase4/afldb-phase4.sh backout --state <the PHASE4 STATE directory> --seal <the PHASE4 SEAL value>`.
There is no fixed state path. Never edit the directory or seal into another attempt's command, and never use the r9 command.

* It refuses, before any change, unless that directory with that seal is the attempt this host records as applied, and every
  sudoers file and arm's groups are in either their recorded or their planned state: an old attempt, a refused attempt, a copied or
  moved directory, a wrong seal and a host changed outside the plan are all REFUSED with nothing changed (rehearsed:
  old-snapshot-rejected, state-tamper, late-grant, unplanned-edit).
* It then writes a new access epoch (a back-out is an access change: see 'An access change voids saved evidence' above).
* It restores each changed file from its saved copy with its original owner, group and mode, runs `gpasswd -a arm sudo` if arm is
  not in sudo, and then `visudo -c`.
* It then proves the pre-change state: every sudoers file's sha256, owner and mode, the `/etc/sudoers.d` directory, arm's group list
  and `sudo -l -U arm` all equal the 4.0 record, and `sudo -l -U afldb-admin` equals its 4.0 record. It ends
  `PHASE4 BACKOUT RESULT PASS` and the VOID line (rehearsed: group-only-backout, grant-refused-then-retry (fresh console),
  two-grants-one-selected, etc-sudoers-grant, old-snapshot-rejected).
* Its manual equivalent is the per-change back-out that 4.0 printed: `gpasswd -a arm sudo` for the group-only change, and for each
  changed file `install -o U -g G -m 0MODE <state>/copy.N <file> && visudo -c && sha256sum <file>` (it must print the recorded value),
  then `afldb-phase4.sh invalidate --reason 'manual back-out'`.
* `gpasswd -a arm sudo` alone restores the previous state only when no sudoers file was changed. After a removed grant it loses the
  rule (rehearsed: old-r8-backout, the r8 text's contrast). The sudo group line's member order may differ afterwards; membership is
  what is compared.
* `REFUSED` names what does not match (a file changed outside the plan, an altered record, another attempt); nothing was changed.
  `FAIL` means the restore itself did not prove the pre-change state; the result names it. Review it in [CON], restore it by hand
  from the named copy, then record that hand change with `afldb-phase4.sh invalidate --reason "<what you restored>"` (r10 round 2,
  F7: the epoch the back-out wrote predates the hand change; the script prints a `HAND:` line saying so), and do not continue Phase 4.
* If 4.3 failed, repair the admin account in [CON] (Phase 1 steps 1.9–1.12) before trying Phase 4 again from 4.0 (which creates
  a new attempt directory). Never repair the admin account through arm's sudo, which would type a password into an arm session. If [CON] has been
  closed and the admin path fails, the recovery is Phase 0 again.

After Phase 4 PASS, G1 and G2 hold against a hostile arm, subject to the §0 residual: arm can no longer reach root by any route the
checks know, and every root action uses [ADM-ROOT].

**Saved evidence (r9; r10).** F1 can be closed on the saved, unedited outputs `~/afldb-r9-accept/afldb-r9-4.4.txt` and
`afldb-r9-4.5.txt`. Closing F1 authorises no gate. A gate is GO only when, on [WS] in the owner's clone,
`(cd $R9/accept && sha256sum -c --strict SHA256SUMS)` passes, `sha256sum $R9/accept/SHA256SUMS` equals `@P_ACCEPT@`, and

```
bash $R9/accept/afldb-gate-accept.sh --gate release-g0|ng-pre --owner-checks ~/afldb-r9-accept/afldb-r9-4.4.txt \
  --reverify ~/afldb-r9-accept/afldb-r9-4.5.txt --version ~/afldb-r9-accept/afldb-r9-4.6.txt \
  --verdict <saved gate output> --verdict-exit <its exit status> --confirm ~/afldb-r9-accept/confirm.txt \
  [--pin-rev <reviewed pin commit>]
```

r10 round 2 (independent review F1): the saved 4.4-4.6 and gate verdict cannot show an access change made AFTER them, so the checker also requires `--confirm`: a wrapper `version` call made after the gate call and **immediately before the check** (`bash $R7/verify/afldb-verify-call.sh version > ~/afldb-r9-accept/confirm.txt 2>&1; cat ~/afldb-r9-accept/confirm.txt`). Its authenticated production RESULT must be after the verdict, on the same boot, with the 4.5 bundle and the same access epoch, and at most 10 min before the check (`failed=confirm` or `failed=access` otherwise). Act on GO at once: an access change after the confirm call is outside what any saved transcript can show, and every `afldb-phase4.sh` action prints VOID for an earlier GO too. A back-out or `invalidate` between the gate call and the confirm is caught (`failed=access`).

r10: for `release-g0`, `--pin-rev` is **required**: the commit, in this clone, that added the reviewed qualification pin
(`$R9/offhost/QUALIFIED-ENDPOINT`, QUALIFY-OFFHOST.md §3), and the 4.6 and G0 calls must have run from a `git archive` export of that
commit. The checker reads the pin from that commit and requires its sha256 to equal the `qual-sha256=` of 4.6 and of the G0 PASS
(`failed=pin` otherwise: an export without the pin, a fixture-format pin, or an edited pin). `ng-pre` does not take it.
r10 round 2 (F2): run the checker with the owner clone's **current reviewed head** checked out; the pin at `--pin-rev` must equal the
pin at that HEAD, so a pin revoked or superseded later (QUALIFY-OFFHOST.md "Revocation") fails `failed=pin` with its old
`--pin-rev`. (F4) The checker binds the pin's bytes, not the wrapper's: that 4.6 and the G0 call ran from an unedited `git archive`
export of that commit is the owner's procedure step (QUALIFY-OFFHOST.md §4 step 7), not something the checker can prove.

prints `GATE ACCEPT RELEASE-G0 GO transport=production` or `GATE ACCEPT NG-PRE GO transport=production` (exit 0). Run 4.4–4.6
immediately before the gate call, on the gate day: the gate verdict must come after 4.6 and at most 3 h after the OLDER of 4.4 and
4.5 (each of them fresh; a 4.4 left over from an earlier day is NO-GO, R9-F-11), and the checker must run at most 1 h after the verdict (workstation clock). The `BOOT-ID` lines of 4.4 and 4.5 must equal the
`boot=` of the authenticated production RESULT lines of 4.6 and of the verdict, so a reboot between 4.4 and the gate, or evidence from
another host, is NO-GO: repeat 4.4–4.6 (no further access change). r10: so is any access change after 4.4 (a new access epoch:
`failed=access`), on the same boot and inside the window too: repeat 4.4, 4.5, 4.6 and the gate call. Only the exact token `transport=production` counts; a stubbed ssh
client prints `transport=production-stub` (R9-F-3), and committed test fixtures (`[FIXTURE r9]`) are refused.
Save a gate call as `bash $R7/verify/afldb-verify-call.sh <g0 …|a2 …> > ~/afldb-r9-accept/<g0|a2>.txt 2>&1; echo $? >
~/afldb-r9-accept/<g0|a2>.exit; cat ~/afldb-r9-accept/<g0|a2>.txt`. Any other final line, `GATE ACCEPT REHEARSAL …` included, is
NO-GO: no release and no reboot.

## 8. streamanator variant (G0b handoff: off-host verifier install, pull-source change)

**Facts recorded during the rehearsal (REAL, 28 Nov 2026 03:0x UTC, `id` of streamanator's arm):** `uid=1000(arm) … groups=…
4(adm) … 27(sudo) … 101(lxd) 111(docker)`. Docker 29.1.3 is not rootless (security options `apparmor seccomp cgroupns`).
Membership of `docker` and `lxd` is root-equivalent, independent of sudo. **How the owner reaches root on streamanator is UNKNOWN**
(physical console, IPMI or another account).

Consequences:

* Whoever controls streamanator's arm controls streamanator's root, and so can forge `G0B PASS`, and with it the owner's G0
  statement that an authentic off-host copy exists. That includes every automated session that uses `~/.ssh/afldb_dev`, Claude's
  rehearsals among them.
* It cannot forge the dump bytes or production's verdict. G0B compares the copy's sha256 with the value production's g0 reports,
  and production's role is installed and judged independently (Phases 0–4 above).
* A compromise of **production's** arm does not reach streamanator: the pull runs from streamanator to production with
  streamanator's key `~/.ssh/afldb_backup_pull`, under a forced `rrsync -ro` on production.

| Phase | streamanator | What stays unproven |
|---|---|---|
| 0 | a root login at streamanator's own console (physical/IPMI) at the `login:` prompt; not `sudo` in an arm session | **UNKNOWN** whether available |
| 1 | the same as production: `afldb-admin` with its own key and password, created from that console | none, if done |
| 2 | the same command; expected **BLOCKED** on B1/B2 (sudo) **and C1 (`docker`, `lxd`)** | r9: streamanator's G0B is never GO evidence, whatever this shows (below) |
| 3 | [ADM-ROOT] on streamanator: stage `$R7/verify` from the same workstation tar; `install-verify.sh --role offhost --key …`; `verify-verify-install.sh --role offhost`. The pull-source change is an **unprivileged** edit of arm's own files with no root step: on production, arm's `authorized_keys` forced command `rrsync -ro /home/arm/backups/afldb-scheduled` becomes `rrsync -ro /var/lib/afldb-backup/published`; on streamanator, the pull source is `<prod>:/var/lib/afldb-backup/published/`. Status probes add `AFLDB_BACKUP_SEALED_STATE_DIR=/var/lib/afldb-backup/state` | G0B gives no assurance about the pull itself; that is by design, because G0B checks the copy |
| 4 | none, for G0b. r9: streamanator is not qualifiable. The wrapper refuses a pin naming it (`$R9/offhost/QUALIFY-OFFHOST.md` §0). Removing its arm from `sudo`, `docker` and `lxd` remains an owner decision about DEV; it is not a route to G0B independence | a G0B answer from streamanator is information only, never GO evidence |

**r9: the arm-attested option is withdrawn.** The workstation wrapper accepts an off-host G0B PASS only from an endpoint the owner
has qualified by `$R9/offhost/QUALIFY-OFFHOST.md`: one whose administration, hypervisor and storage are outside streamanator arm's
control, named in the pin `$R9/offhost/QUALIFIED-ENDPOINT` (absent in the repository; the default is unconfigured and fails closed).
Its host key must be in the owner's known_hosts and equal the pin, and its RESULT must carry the scheduled-transfer evidence
(`dispatch-at`, `received-at`, `complete-at`, `received-sha256`, `rehash-sha256`), linking the 03:10 dispatch to transfer completion
and a rehash of the received file. r10: `received-at` comes only from that invocation's own RECEIVED record and per-dump RECEIPT
(QUALIFY-OFFHOST §3). A matching file at check time without that link is possession only, and G0 STOPs: a copy already present
before 03:10, a different dump moved by the same job, and a failed run included. A pin naming
streamanator or 10.0.40.100, or carrying streamanator's known host key, is refused, because its arm is root-equivalent (recorded
28 Nov 2026). **No machine is qualified today**, and none is nominated: G0 prints `OWNER VERDICT G0 STOP … qualification=none`
(exit 1), the release stops before P2, and R6 NG-OFFHOST and NG-DATA stay NO-GO. Phases 0–3 above apply to the endpoint being
qualified (QUALIFY-OFFHOST §2), not to streamanator. Installing the offhost role on streamanator gives information only. Live
qualification is the owner's (rehearsed only with a fixture endpoint labelled `qualification=FIXTURE`: `$R9/offhost/evidence/`).

## 9. Rehearsal (`procedure-harness/`, development evidence)

`procedure-harness/r8p-run.sh` runs on the workstation and drives one disposable container on streamanator. The container's PID 1 is
the real systemd 255, from the pinned image `sha256:d71c0b28…` (Ubuntu 24.04), with PostgreSQL 16 `afldb_prod` as a fixture,
`--network none`, never `--privileged`, and no bind mount. The run:

* starts from production's shape today, arm with sudo [FIXTURE], and uses `docker exec` as root as the console stand-in [HARNESS];
* reaches the container's real sshd from the workstation's real Windows OpenSSH through a ProxyCommand [HARNESS transport];
* refuses a key arm substituted, and the real key behind an options prefix arm added, but accepts the real key with a CRLF line
  end (Phase 1, machine test 1.5a–1.5b);
* creates the admin account, then checks two admin logins and that arm's key is refused for the admin;
* verifies the stage tar over the admin path against workstation digests;
* runs Phase 2 before the change (BLOCKED), and through arm's sudo (BLOCKED on A2);
* runs the installer through arm's sudo (REFUSED, nothing installed);
* runs both installs and both install checks (root and `--as-arm`), then the wrapper's `version` call;
* runs Phase 4, a second admin login, the reverify, and Phase 2 (PASS);
* runs eight fail-closed cases and a control: arm's PostgreSQL role made superuser; a NOLOGIN superuser role granted to arm's
  role; a group-writable protected directory; a missing admin path; an options prefix on the admin key; a second admin key line;
  a root-run unit's argument in a root:&lt;group arm is not in&gt; 0775 directory (C3 reports it, PASS); and the same directory with
  group arm (C3 FAIL);
* scans every log for the fixture password, the admin and arm passwords, and private key blocks.

Results and residue: `procedure-harness/logs/<RID>-summary.log` (git-ignored by `logs/`; force-add to keep). Development runs at worktree bytes, 28 Nov 2026:

* `dev-a2` is `R8 PROCEDURE HARNESS RESULT PASS`: 25 scenarios PASS, with agent B's r8 guard and `--as-arm` present (backup `SHA256SUMS` `d1c11c25…`, verify `bf0e050e…`, owner checks `d81525b6…`). Residue afterwards: 0 containers, 0 images, 0 workspaces.
* `dev-a1` FAILED. B's bundle was mid-edit (`SHA256SUMS` mismatch, and the stage STOPped as designed), and check F6 misread sshd's `forcecommand none`. F6 is fixed. It is kept as history only.

After the independent review of `89bd271e` (R8-F-1/-2/-3/-6/-8/-9/-10), two more development runs were made. Each used
`--bundles-rev 89bd271e`: the R7 bundles came from that commit, because agent B was editing them, and the owner checks and harness
came from the worktree.

* `dev-a3b` is `R8 PROCEDURE HARNESS RESULT PASS`: 29 scenarios PASS. New in this run: `pubkey-optprefix`,
  `fc-pg-nologin-super`, `fc-admin-key-option` and `fc-admin-extra-key`. Residue afterwards: 0 containers, 0 images,
  0 workspaces.
* `dev-a3` FAILED only `wrapper-version`. The harness ran the worktree wrapper, which carries B's new `BUNDLE_SHA`, against
  `89bd271e` bundles. The harness now runs the wrapper from the same staged tar.

After review round 2 of `f8a63bb3` (R8-F-13/-14/-15), two more development runs were made with `--bundles-rev f8a63bb3`.

* `dev-a4b` is `R8 PROCEDURE HARNESS RESULT PASS`: 32 scenarios PASS. New in this run: `pubkey-crlf` (a CRLF key is accepted
  after one CR is stripped), `fc-c3-gw-other` (C3 PASS reporting `/opt/r8p-gw(root:r8pgrp:775)`) and `fc-c3-gw-arm` (C3 FAIL:
  `/opt/r8p-gw is group-writable by a group arm is in (root:arm:775)`). C3 judged 112–113 root-run units and 182–186 paths, with
  ACLs read through `getfacl`. Residue afterwards: 0 containers, 0 images, 0 workspaces.
* `dev-a4` FAILED `checks-post-access`, `fc-c3-gw-other` and `control-after-revert`. In all three, C3 was UNKNOWN on units whose
  `ExecStart` names a bare command (`systemctl`, `rm`, `udevadm`). The new C3 fails closed on a path it cannot place, and the
  round-1 judge (`trust_res`) had silently resolved such names against its working directory. C3 now resolves a bare name through systemd's search
  path. The new `pubkey-crlf` and `fc-c3-gw-arm` scenarios already passed in this run. Residue afterwards: 0 containers,
  0 images, 0 workspaces.

These runs are not evidence for a committed revision either.

Not exercised: an arm process killing, stopping or injecting into a probe, and the probe's 60-second timeout. The code paths
exist, but no scenario drives them.

r9 additions (see `$R9/README.md` for the runs): the Phase 4 steps run through `afldb-phase4.sh` (4.0 entry, 4.1, 4.2 verify), the
4.4/4.5 outputs are saved, a post-Phase-4 `version` (4.6) is made, and the acceptance checker runs in `--rehearsal` mode on the
harness's own real outputs: `accept-counterexample` (Phase 3 outputs: NO-GO) and `accept-post-phase4` (4.4–4.6 accepted; NO-GO
only on the verdict, which STOPs in a container). Phase 4's own fixtures (group-only, unrelated grants refused, disposed rule,
back-out) are `$R9/phase4/p4-run.sh`. The base image `sha256:d71c0b28…` is tagged `grafana/alloy:latest`: an Ubuntu 24.04.4
userland whose entrypoint the harnesses override (r9 note; earlier text called it plain Ubuntu 24.04).

r10 additions (see `$R10/README.md` for the runs): Phase 4 runs `$R10/phase4/afldb-phase4.sh`; 4.1 and 4.2 are the commands 4.0
printed, run as printed, and the console back-out is the command 4.1 printed, run in a fresh session (`phase4-backout`); 4.4 and 4.5
carry `ACCESS-EPOCH`; and `access-change-saved-void` / `access-change-fresh-blocked` show that after the saved 4.4–4.6 PASS a
same-boot back-out prints VOID, a new 4.6 and verdict judged with the saved 4.4/4.5 are NO-GO `failed=access`, and fresh 4.4 checks
are BLOCKED. Phase 4's own fixtures (refused first entry then a retry in a new directory, two grants one selected, an old or
mismatched snapshot rejected before mutation, invalidate) are `$R10/phase4/p4-run.sh`.

Re-run with `--verify-rev @REV@` after the commit.

The rehearsal does **not** exercise:

* the DigitalOcean console;
* production's sshd configuration, sudoers, host key or firewall;
* interactive `passwd` and `sudo` prompts (the harness feeds the admin password to `chpasswd` and `sudo -S` on stdin);
* the off-host verifier role (the wrapper's off-host line STOPs with "no qualified off-host endpoint", as expected; r9's off-host
  qualification is rehearsed by the verify harness, `$R9/offhost/evidence/dev/`);
* a real nightly timer run.

## 10. Consolidated owner checklist

| Step | Exact command | Where | Proves | Stop condition |
|---|---|---|---|---|
| 0.1–0.3 | Recovery Console; `login: root`; `id; cat /proc/self/loginuid; tty` | [CON] | an independent root session | no root login: **STOP, F1 open** |
| 0.4 | `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` | [CON] | production host key, independently | none |
| 1.1–1.2 | `ssh-keygen -t ed25519 -f ~/.ssh/afldb_admin -C afldb-admin`; `ssh-keygen -lf ~/.ssh/afldb_admin.pub` | [WS] | a new admin key; its fingerprint on paper | none |
| 1.3 | `tr -d '\r' < ~/.ssh/afldb_admin.pub \| ssh afldb 'umask 077; cat > ~/afldb_admin.pub'` | [WS]→[ARM] | data only (CR stripped: Windows `ssh-keygen` writes CRLF) | none |
| 1.4–1.5b | `K=…; setpriv --reuid=arm --regid=arm --init-groups --reset-env /usr/bin/cat /home/arm/afldb_admin.pub < /dev/null > $K`; the 1.5a shape test (one trailing CR stripped, then `KEY-SHAPE-OK`) and the 1.5b fingerprint test (`KEY-FP-MATCH`) | [CON] | the carried key is one bare ed25519 line and is the workstation's | no `KEY-SHAPE-OK` or no `KEY-FP-MATCH`: **STOP**, the carried key is malformed or not the workstation key |
| 1.6–1.10 | `useradd -m -U -s /bin/bash afldb-admin`; `passwd afldb-admin`; `usermod -a -G sudo afldb-admin`; `chmod 0750 /home/afldb-admin`; `install … $K.line …/authorized_keys` (the type and key fields only); checks | [CON] | the admin account with its own key and password | any unexpected value |
| 1.11–1.13 | `ADM`; `id; sudo -k; sudo -v; sudo -l`; twice, in new connections | [WS], [ADM] | the admin path reaches root, twice | host key mismatch or failure |
| 2.1.1–2.1.3 | `git rev-parse @REV@^{commit}`; `git archive … -o ~/afldb-r8-stage.tar`; `sha256sum` | [WS] | workstation bytes and expected digests | a pin differs |
| 2.1.4 | `ADM 'umask 077; set -C; cat > ~/afldb-r8-stage.tar' < ~/afldb-r8-stage.tar` | [WS]→[ADM] | bytes over the admin path | none |
| 2.1.5–2.1.8 | `sha256sum $T`; extract; stage owner checks and the Phase 4 script; `sha256sum -c` | [ADM-ROOT] | the same bytes on production | TAR or pin differs |
| 2.2 | `env -i … afldb-owner-checks.sh --admin afldb-admin --admin-fp SHA256:…` | [ADM-ROOT] | the Phase 2 facts | expected BLOCKED (B1, B2, B3; B3 classified at 4.0) only; any other FAIL/UNKNOWN: resolve |
| 3.1–3.6 | stage `$BK`; `sha256sum -c`; `install-backup.sh $BK`; pg lines; reload; `verify-backup-install.sh`; `verify-backup-install.sh --as-arm` | [ADM-ROOT] | sealed backup installed and checked | FAIL or `REFUSED` |
| 3.7–3.11 | verify key over [ADM]; stage `$VF`; `install-verify.sh --role prod --key …`; `verifier-db.sql`; pg lines; `verify-verify-install.sh --role prod` | [ADM-ROOT] | verifier installed and checked | FAIL or `REFUSED` |
| 3.12 | Phase 2 again | [ADM-ROOT] | installs do not close F1 | any new FAIL |
| 3.13 | `bash $R7/verify/afldb-verify-call.sh version` | [WS] | installation diagnostic only: the verifier answers. **Not** GO evidence while 3.12 is BLOCKED | production VERSION STOP: **STOP** |
| 3.end | — | — | **Phase 3 ends in STOP**: the owner checks are BLOCKED (B1, B2, B3). No release, NG-PRE or reboot on Phase 3 outputs | — |
| 4.0 | `env -i … $P4/afldb-phase4.sh entry [--remove-grant TOKEN]…` (one token per reviewed grant to remove) | [ADM-ROOT], console open | a new attempt directory, classification, exact back-out; `RESULT PASS change=…`; **write down `PHASE4 STATE`, `PHASE4 SEAL` and the printed apply, verify and back-out commands** | `REFUSED`: STOP; decide each named grant (its token is printed) and re-run 4.0 |
| 4.1 | the printed apply command (`… apply --state <dir> --seal <sha256>`) | [ADM-ROOT], console open | only the approved change; a new access epoch | `REFUSED`/`FAIL`: STOP |
| 4.2 | the printed verify command | [ADM-ROOT] | realised change = plan; arm not allowed to sudo | STOP: back-out, then dispose of the residual separately; never back to 4.1 |
| 4.3 | new `ADM`; `sudo -k; sudo -v` | [WS], [ADM] | admin path survives | fails: back-out in [CON] with **the back-out command printed for this attempt** (`… backout --state <dir> --seal <sha256>`) → `PHASE4 BACKOUT RESULT PASS` |
| 4.4–4.6 | `BOOT-ID` and `ACCESS-EPOCH` lines plus the Phase 2 command `\| tee /root/afldb-r9-4.4.txt`; a new [ADM-ROOT] with both install checks and `verify-verify-install.sh --role prod`, after `BOOT-ID` and `ACCESS-EPOCH` lines, `\| tee /root/afldb-r9-4.5.txt`; copy both to [WS] (4.5a); wrapper `version \| tee ~/afldb-r9-accept/afldb-r9-4.6.txt` | [ADM-ROOT], [WS] | `OWNER CHECKS RESULT PASS`; both installs intact with arm out of `sudo`; VERSION PASS after both; all three saved on [WS], one access epoch | BLOCKED or FAIL: F1 stays open. **Any later permission change or back-out voids all three and the gate verdict, same boot and inside 3 h included: repeat 4.4–4.6 and G** (record an outside change first with `afldb-phase4.sh invalidate --reason …`) |
| G | the gate call saved with its exit status, then **immediately** the confirm `version` call saved as `confirm.txt`, then `bash $R9/accept/afldb-gate-accept.sh --gate release-g0\|ng-pre … --confirm ~/afldb-r9-accept/confirm.txt` (release-g0: `--pin-rev <reviewed pin commit>`, current reviewed head checked out); act on GO at once | [WS] | `GATE ACCEPT RELEASE-G0 GO transport=production` or `GATE ACCEPT NG-PRE GO transport=production`, exit 0 | any other final line: **NO-GO** (no release, no reboot) |
| 4.7 | close [CON] | [CON] | — | only after 4.3–4.6 |
| S | Qualify an independent off-host endpoint by `$R9/offhost/QUALIFY-OFFHOST.md` (r10 §3: candidate evidence by `candidate-g0`/`candidate-version`, owner review, pin commit, then the gate from an export of that commit; Q1–Q7, record, second reader). streamanator is refused | the endpoint's console / its [ADM-ROOT] / [WS] | G0B independent of streamanator's arm | no committed pin, or the off-host `version` line is not PASS with `qualification=pinned`: G0 STOPs and the release stops before P2. There is no arm-attested alternative |
