# R6 r7 owner verifier (MED-2): verifier delivery

PREPARED, NOT INSTALLED. Nothing here has been installed on production or on streamanator's host. The contract is
`../DESIGN.md` §5, constrained by §2, §3.4, §3.5 and §6. Every departure from it is listed under **Deviations** with a reason.
The end-to-end rehearsal is `../verify-harness/` (see the end of this file).

## 1. What Stu invokes

From the workstation (Git Bash), always through the wrapper:

```text
bash verify/afldb-verify-call.sh g0 2026-11-DD
bash verify/afldb-verify-call.sh a2 accepted <CURRENT_ID> r3:yes|no r4:yes|no 10:00|14:00 tue:released|rolledback|deferred inv:<32hex>
bash verify/afldb-verify-call.sh version
```

The wrapper prints the gate output, then exactly one `OWNER VERDICT <G0|A2|VERSION> <PASS|STOP> transport=production ...` line and
exits 0 only for PASS. Release G0 consumes only `OWNER VERDICT G0 PASS`; NG-PRE consumes only `OWNER VERDICT A2 PASS`, plus the
separate `backup-origin=` field on the same line. `--rehearsal <ssh-config> --key <key>` exists only for the harness, and it prints
`transport=rehearsal` in every verdict, so a rehearsal verdict can never be pasted as a production one.
With `AFLDB_VERIFY_SSH` set (a test hook replacing the ssh client), production transport prints a STUB WARNING line first and labels
the header and every verdict `transport=production-stub`; that is never a production verdict (R9-F-3).

`version` prints one production line and one off-host line, and exits 0 only when both are PASS (r8; r7 exited 0 even when a host
answered STOP). r9: the off-host line goes to the qualified endpoint (`../../review-fixes-r9-20261128/offhost/QUALIFY-OFFHOST.md`).
With no pin it is `OWNER VERDICT VERSION STOP … host=none role=offhost reason="no qualified off-host endpoint"`, and the production
line stays independent of it. Every G0 and VERSION verdict ends with `qualification=none|pinned|FIXTURE|refused qual-sha256=<pin
sha256|none>`. `--qualification-fixture <file>` is accepted only with `--rehearsal`, and labels every verdict `qualification=FIXTURE`.

**What a PASS establishes (r8).** Before an A2 or G0 verdict the wrapper prints one `SCOPE` line:
* `A2 SCOPE:` an `OWNER VERDICT A2 PASS` establishes that the live production host matched **these seven arguments** at `at=`. The
  arguments come from the Tuesday record, printed by arm-run scripts over arm's login, and nothing here checks them. PASS lines marked
  `[ARM-PRODUCED ...]` are authentic readings of arm's data, not independent facts. `backup-origin=attributed` rests on root and
  PID 1 evidence only.
* `G0 SCOPE:` the sealed timer run (root seal, PID 1) produced the named dump with that sha256. The **qualified** off-host endpoint's
  root-owned verifier reports a 03:10 root cron dispatch, a transfer by that dispatch that received and verified those bytes and
  completed in time, and a root re-hash at check time. The pull-log lines linking them are written by the endpoint's pull account, and
  the endpoint's independence rests on the owner's qualification record (FIXTURE runs say that independence is simulated).
A verdict is **authentic** (§3) only while root on both hosts is independent of arm (§10, F1; R7 README §4 item 20 for
streamanator); authentic is not the same as "every input is true" (R8 `DEPENDENCIES.md` §1).

## 2. Executing identity and the path to the gate code

1. Stu's Windows OpenSSH client connects to `afldb-verify@<address from ssh -G afldb>` with `-F none` (no alias, no ProxyCommand),
   `IdentitiesOnly`, `IdentityAgent=none`, only the dedicated key `~/.ssh/afldb_verify`, `StrictHostKeyChecking=yes` against Stu's
   known_hosts. No forwarding, no TTY.
2. sshd (root) authenticates the key against the root-owned `/etc/ssh/afldb-verify/authorized_keys` (`restrict,command=...`), and
   `Match User afldb-verify` sets `ForceCommand /usr/local/lib/afldb-verify/afldb-verify-entry`, `PermitTTY no` and no forwarding
   (`60-afldb-verify.conf`). arm's key cannot authenticate as afldb-verify, and the verify key cannot authenticate as arm.
3. The login shell is `/bin/sh` (dash). Its first and only act is `afldb-verify-entry`, which does
   `exec /usr/bin/env -i PATH=/usr/sbin:/usr/bin LC_ALL=C SSH_ORIGINAL_COMMAND=... /usr/bin/bash --noprofile --norc <dispatcher>`.
   The home `/var/lib/afldb-verify` is root:root 0755 and contains no startup file. The account is not in group arm.
4. The dispatcher (bash, root-owned) checks the request grammar (at most 400 bytes, at most 10 words of `[A-Za-z0-9:._-]`, single
   spaces, the exact forms `g0 <date> <nonce>`, `a2 <7 args> <nonce>`, `g0b <date> <dump> <sha256> <nonce>`, `version <nonce>`).
   Anything else is `AFLDB-VERIFY USAGE refused` and exit 2, with no RESULT line.
5. The dispatcher self-checks the bundle **on every run**: every component of every bundle path is a trusted path (root-owned, not
   group/other-writable, no symbolic link; the r6 `trusted_path` function byte-identical), `SHA256SUMS` names exactly the installed
   files and they match it, the installed socket/service units, the sshd drop-in, `authorized_keys`, the role file, PATH directories
   and every helper the cores run are trusted paths. A failure is `RESULT ... STOP ... exit=3`.
6. The role (`/etc/afldb-verify/role`: `prod` permits g0 and a2; `offhost` permits g0b; both permit version) selects one core,
   run as `timeout -k 10 1500 /usr/bin/bash --noprofile --norc <core>` with a per-run token in the environment. The core reports
   values only as `FIELD-<token> key=value` lines; the dispatcher validates every field against a fixed regex, removes field lines
   from the output, and neutralises any output line that starts `AFLDB-VERIFY` or `OWNER VERDICT`.

## 3. How the exit status and result reach Stu

The dispatcher's last line is
`AFLDB-VERIFY RESULT <G0|A2|G0B|VERSION> <PASS|STOP> nonce=<32hex> host=<hostname> boot=<boot id> bundle=<sha256 of SHA256SUMS> at=<UTC> exit=<n> <fields>`
and its exit status is `exit=`, which sshd returns to the client. The wrapper generates a fresh nonce per call and accepts an answer
only when all hold: exactly one RESULT line and it is the last line; mode as requested; nonce equals this call's; `bundle=` equals
the digest pinned in the wrapper (`BUNDLE_SHA`, set by `build-sums.sh`); `host=` is `afldb-prod` (G0a, A2) or the pin's `host=` (G0b and the off-host version line; r9);
`at=` within 300 s of the workstation clock; `exit=` equals the ssh exit status; PASS if and only if exit 0; every argument field
equals the request. Otherwise the verdict is STOP with `reason=`. This refuses stale, replayed, crossed and edited answers
(scenario e of the harness exercises each one).

**Relayed text is data (independent review round 1, F2).** Authentication covers the RESULT line, not the lines above it, and some
of those carry text arm can write (the comment on `afldb_restore_test`, the migrations ledger, arm's files). Three layers keep it
from drawing on Stu's terminal or passing for a verdict: (1) the cores print every arm- or database-sourced value through `san()`
(printable ASCII, length-capped), the A-2 catalogue answer included; (2) the dispatcher replaces every byte outside printable ASCII
in every core line with `?` and prefixes `[neutralised] ` to any line containing `AFLDB-VERIFY RESULT` or `OWNER VERDICT` anywhere;
(3) the wrapper (`show`) again maps every byte outside printable ASCII (ESC and CR included) to `?`, in stdout and ssh stderr, and
prefixes `[relayed, neutralised] ` to every relayed line containing `OWNER VERDICT` or `AFLDB-VERIFY RESULT` except the final
authenticated RESULT line. So a transcript has exactly one line that **begins** `OWNER VERDICT` per call: the wrapper's own.
Harness scenario g replays the reviewer's forged comment.

## 4. G0a to G0b handoff (r9: qualified endpoint and scheduled-transfer evidence)

`g0` calls production first (G0a). Only an authenticated G0a PASS continues, and the wrapper then takes `dump=`, `sha256=`,
`invocation=` and `dispatch=` **only from the G0a RESULT line** (they also appear as `OFFHOST-COMPARE <dump> <sha>` and
`DISPATCH <kind> <delay> s after timer activation` in the output, for the human record, but the wrapper never parses those lines).

Off-host qualification is fail-closed. The endpoint is named only by the owner's pin
`../../review-fixes-r9-20261128/offhost/QUALIFIED-ENDPOINT`, located relative to the wrapper's own directory. It is absent in the
repository; the format and the procedure are in `QUALIFY-OFFHOST.md` there.

* **Pin refused** (malformed; names streamanator or 10.0.40.100; carries streamanator's known host key; names production; record
  digest mismatch): STOP `step=qualification`, before any call.
* **No pin:** the legacy endpoint streamanator is asked `g0b`, and every line of its answer is printed behind
  `[unqualified endpoint, information only]`. The verdict is
  `OWNER VERDICT G0 STOP … offhost=none offhost-info=<PASS|STOP|unauthenticated> reason="no qualified off-host endpoint …"`, a PASS
  included.
* **Pin:** the pinned host key must be among the owner's known_hosts keys for the address, and ssh is then given only that key. The
  wrapper calls `g0b <date> <dump> <sha256>` and requires the date/dump/sha256 fields to echo the request. It also requires the five
  evidence fields: `dispatch-at=` in [D 03:10, +60 s); `received-at=` ≥ dispatch − 5 s; `received-at` ≤ `complete-at=` ≤ D 03:10 +
  2100 s and ≤ `at=`; `received-sha256=` and `rehash-sha256=` equal to G0a's sha256. A missing dispatch or completion is reported as
  "possession only", and G0 STOPs.

The final verdict carries both nonces, `offhost=`, the five fields and the qualification fields. A G0a STOP never calls G0b.

## 5. A-2 to NG-PRE

The a2 verdict line carries `day=` and `backup-origin=attributed|refused` as a separate field: backup-origin is the sealed-origin
result for the night under test, reported apart from the gate verdict (DESIGN 5.2), and a2 PASS requires
`backup-origin=attributed`. NG-PRE consumes `OWNER VERDICT A2 PASS` and records `backup-origin` separately.

## 6. Trusted inputs (and what each core trusts)

Trusted: root, PID 1 (`systemctl show`, `busctl`), sshd, journald's trusted fields (`_UID`, `_SYSTEMD_UNIT`,
`_SYSTEMD_INVOCATION_ID`, `_TRANSPORT`; r8: **not** the `MESSAGE` of an entry whose sender runs arm's code, such as the restore line
of `afldb-backup-verify.service`, which runs arm's checkout script as arm: §9 item 1), root-owned files, the two service accounts (afldb-backup, afldb-verify), and the PostgreSQL server's own answers to
the peer role `afldb_verify` as **facts about the catalogue as it stands**. Untrusted data: everything uid arm owns or writes. Data
from arm is read only through the root facts reader (below), as bytes, sanitised to printable ASCII before printing, and never
executed, sourced or loaded.

**Correction (independent review round 1, F2).** r7 called "PostgreSQL's catalogue" trusted. Its **contents** are not: arm holds the
owner DSN, so arm's role writes the migrations ledger (`ledger 118`) and creates `afldb_restore_test` and sets its comment (the
restore test runs as arm). The authenticated `afldb_verify` login proves only that the server, not arm, answered; what it answered
about those objects is arm-influenced data. A-2's `ledger 118` and the `afldb_restore_test` comment and connection-count lines are
therefore arm-decided (R7 README §4) and are printed through `san()` like every other arm-derived value. If arm's role were a
superuser it could also act as OS user `postgres`, which owns `pg_hba.conf`/`pg_ident.conf` (both peer maps): unchecked on
production (R7 README §4, item 17, which r8 states precisely: what such a role could and could not do).

- **G0 (production)**: origin, dump and its digest exclusively from `sealed_origin <date>` (the R7/backup library, sourced from the
  bundle copy). The sealed run's failure record is PID 1's `Result=` of afldb-backup.service; arm's `.state` markers are reported as arm-produced.
- **G0B (streamanator)**: the dump's size and full sha256, the `.verified-<dump>` marker, the retention hold, the sidecar line and
  arm's crontab line, via the root facts reader; the cron dispatch line from journald **only** if `_UID=0` (kernel-attested),
  `_TRANSPORT=syslog`, `SYSLOG_IDENTIFIER=CRON` and `SYSLOG_PID=_PID` (a line arm logs with `logger` cannot match); the pull log's
  BEGIN/VERIFIED/END lineage (arm-produced, see §9). r9: the core emits `rehash-sha256`, `dispatch-at`, `complete-at`,
  `received-at` and `received-sha256` as result fields, and the dispatcher turns a G0B PASS without all five into an internal STOP.
- **A2**: §7.

## 7. A-2 substitutions (the WHOLE r6-pre-verify.sh is ported: every check, same order, same wording where the fact is the same)

| # | r6 used (as arm) | r7 uses | What the substitute trusts |
|---|---|---|---|
| S1 | `node deploy/release.mjs status` (arm's ~/.nvm node, arm's checkout script) | `serving_release` in a2-core.sh: the same facts recomputed | root facts reader for links, release.json, MainPID cwd (kernel via CAP_SYS_PTRACE), events.log; PID 1 for MainPID/InvocationID; loopback GETs by python3.12 -I -S. The release dirs, release.json and the HTTP answers remain arm data (§9) |
| S2 | `grep` of arm's `.env` | counts of `AFLDB_REVALIDATE_URL=`/`_SECRET=` lines from the root facts reader, never values | root facts reader; `.env` is arm data |
| S3 | `sh deploy/afldb-settle-failure-status.sh` from arm's checkout | the bundle copy, byte-identical to the 17822b29 file (sha256 d80838cb...), run by dash | the bundle (root, pinned) |
| S4 | `cmp /etc/... deploy/host-policy/...` (arm's checkout as the reference) | sha256 of the /etc files against digests pinned in a2-core.sh (the repo files at 2d772fe4) | root-owned /etc files and the pins: stronger than r6 |
| S5 | `git rev-parse HEAD` in arm's repo | `.git/HEAD` and the ref read as files (INFO only) | arm data, no git binary run |
| S6 | journal lines + `pick_overnight_dump` in arm's backup dir | `sealed_origin` (DESIGN 3.5) | sealed backup install (root, afldb-backup) |
| S7 | restore journal parsed by arm's node | `afldb-verify-py journal-restore` (python3.12 -I -S) | journald trusted fields; group systemd-journal |
| S8 | arm's last-verify/last-backup/FAILED-*, restored dump hash | root facts reader | arm-produced evidence (§9) |
| S9 | `bash tools/maintenance/scheduled-backup.sh status` | `backup_status`: the same thresholds (30 h, 216 h), nightly freshness from the SEALED `state/last-backup.json`, restore freshness and markers from arm's `.state` | sealed state (root) + arm-produced restore state |
| S10 | psql with `.env`'s `AFLDB_BACKUP_DATABASE_URL` | `/usr/lib/postgresql/16/bin/psql` as peer-mapped `afldb_verify` (no password exists) | PostgreSQL peer auth (kernel uid) |
| S11 | `cd` into the checkout, `readlink`, `[ -s a1 baseline ]` | the root facts reader | arm data |

`R6_DRYRUN` is dropped (the verifier passes no environment through; the rehearsal uses a disposable container instead).

## 8. Database role (owner step on production, run as postgres)

`verifier-db.sql` creates `afldb_verify` (LOGIN, no password, CONNECTION LIMIT 2, `default_transaction_read_only`, statement
timeout 20 s; CONNECT on afldb_prod, USAGE on afldb_meta, SELECT on `afldb_meta.schema_migrations(name)` only). `pg-auth-lines.txt`
gives the `pg_ident.conf` line `afldbverify afldb-verify afldb_verify` and the `pg_hba.conf` line
`local afldb_prod afldb_verify peer map=afldbverify`, which must sit **above** the first other `local` line. Then reload PostgreSQL.
The staging directory is root-only, so feed the SQL on stdin from the root shell:
`runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d afldb_prod < /root/<staging>/verifier-db.sql`.
That root shell is the admin root session of `../../review-fixes-r8-20261128/OWNER-PROCEDURE.md` (r8): `afldb-admin`'s own SSH
login, then `sudo -k; sudo /usr/bin/bash --noprofile --norc`. The provider console logged in as root also qualifies. The
`runuser`, the `pg_ident`/`pg_hba` edits and the reload (`runuser -u postgres -- psql -X -c 'SELECT pg_reload_conf()'`) all run
there, never in an arm session. The comments in `verifier-db.sql` (`sudo -u postgres psql …`) and `pg-auth-lines.txt`
(`sudo systemctl reload …`) mean the same commands typed in that session.

## 9. Remaining arm dependencies (labelled ARM-PRODUCED in the output where they appear)

1. The weekly restore evidence: arm's `last-verify.json`, FAILED markers in arm's `.state`, the restored dump file (the restore runs
   as arm). r8 correction: the journal side is not trusted as a whole. `afldb-backup-verify.service` runs arm's checkout script as
   arm, so the restore line's content and the exit status behind `Result=success` are arm-authored; only the journald trusted fields
   (`_SYSTEMD_UNIT`, `_SYSTEMD_INVOCATION_ID`, receipt time) and PID 1's timer and start facts are trusted: they prove that the
   scheduled unit ran and when, not what it restored.
2. The application itself: release directories, `release.json`, `events.log`, and the HTTP answers of `/api/health` and
   `_buildManifest.js` are produced by arm's processes. The verifier proves which release directory the running MainPID uses (kernel
   cwd) but not that its content is what was built.
3. `.env` line counts and the checkout HEAD (INFO).
4. On streamanator: the pulled copy, its sidecar and `.verified-` marker and the pull log are written by arm's job; the cron dispatch
   is trusted (journald fields), the copy's sha256 is re-hashed by root, but the lineage lines are arm's.
5. arm's crontab line (read from the root-only spool, but arm edits it).

The complete list after the independent review (round 1), including the path to root (F1), the database-decided A-2 lines, the
worker count, `events.log`'s restart note, the arm-served off-host pull, denial, and the unchecked PostgreSQL superuser question, is
in the R7 README §4; this section is not narrower than that list.

r8: every A-2 PASS line that rests on arm's data now carries `[ARM-PRODUCED ...]` (InvocationID against the attested argument, the
worker count, `current`, the release status port, the env counts, the A1 baseline, the restore service result, the markers, the
backup status, `ledger 118`, `afldb_restore_test`), and so do G0b's copy, crontab, invocation and scheduled-pull lines. The seven A-2
arguments themselves are arm-printed (R7 README §4 item 19), and streamanator's root is reachable by streamanator's arm today (item
20). The full classification is R8 `DEPENDENCIES.md`.

## 10. Install

Prerequisites, production: R7/backup installed first (group `afldb-backup-read` and `/var/lib/afldb-backup`; install-verify.sh
refuses without the group), `/usr/bin/python3.12`, group `systemd-journal`, PostgreSQL 16 client at `/usr/lib/postgresql/16/bin/psql`,
sshd with `Include /etc/ssh/sshd_config.d/*.conf` at the top of `sshd_config`, a new key pair `~/.ssh/afldb_verify` on the
workstation. Streamanator: the same minus PostgreSQL and afldb-backup-read (prospective: streamanator's host install has not been
done).

**Root path (independent review round 1, F1, HIGH, not fixable in code).** On production root is reached through arm's login (the
owner's `sudo` inside an arm SSH session), so a hostile arm login environment can capture or reuse it: it could install a different
verifier, edit `authorized_keys`, the sshd drop-in or the peer maps, and every verdict would then be arm's. G2 holds only if this
install and every later root action (the `postgres` steps of §8, any re-install or rollback) use a root path that does not pass
through arm's login. r8 defines that path in `../../review-fixes-r8-20261128/OWNER-PROCEDURE.md`:
* the provider console logged in **as root** (Phase 0), or
* the admin root session: `afldb-admin`'s own key and password, then `sudo -k; sudo /usr/bin/bash --noprofile --norc` (Phase 1).

None of these qualifies: `sudo` in an arm SSH session, `ssh afldb … sudo`, or a console login as arm. Creating that path is a
host-account change that needs owner approval; production `sudoers` has not been checked.

The block below runs in that session:
* The "root-owned staging copy" is a `git archive` of the r8 tested revision, made in the owner's workstation clone, carried over the
  admin path, and re-verified in the admin root session against the workstation's `sha256sum` of the tar and of `SHA256SUMS`
  (wrapper `BUNDLE_SHA` `58fceba650dcd25ede0e55b25bfcb8a8236c3a4fe6ae6ebd94535832bbd506c8`). This file is itself listed in the packet
  `SHA256SUMS`, so the tested revision and the packet digest cannot be written here: they are in the r8 record's pin table
  (`../../review-fixes-r8-20261128/README.md`), which the owner reads in the workstation clone. No byte and no expected digest comes
  from arm's checkout or from any file on production.
* `afldb_verify.pub` travels the same way, and its `ssh-keygen -lf` fingerprint must equal the workstation's.
* `install-verify.sh` refuses (r8) a root session that descends from arm: an ancestor with real or effective uid arm,
  `SUDO_USER`/`SUDO_UID` = arm, or loginuid = arm. It prints `REFUSED: root session descends from arm` before any change.
* r9: the off-host role is installed on the **qualified** endpoint, through its own admin path (`QUALIFY-OFFHOST.md` §2).
  streamanator's arm is in `docker`, `lxd` and `sudo` (OWNER-PROCEDURE §8), so the wrapper refuses to qualify it; a `G0B PASS` from it
  is information only. No endpoint is qualified today.

```text
# as root, from a root-owned staging copy of verify/ (never from arm's checkout):
bash install-verify.sh --role prod --key /root/staging/afldb_verify.pub       # production
bash install-verify.sh --role offhost --key /root/staging/afldb_verify.pub    # the qualified off-host endpoint
# then on production, as postgres: verifier-db.sql and pg-auth-lines.txt (section 8)
bash verify-verify-install.sh --role prod|offhost                              # read-only check, any user (sshd checks need root)
```

install-verify.sh refuses a staging directory that is not root-owned and protected or whose files differ from `SHA256SUMS`; it
creates the group/account (§2), installs the bundle 0755/0644 root:root, the role file, the units, the sshd drop-in and
`authorized_keys`, runs `sshd -t` and `sshd -T -C user=afldb-verify` / `user=arm` checks, enables the socket, reloads ssh, runs the
read-only check, and **never writes arm's checkout**.

`build-sums.sh` regenerates `bundle/SHA256SUMS`, the wrapper's `BUNDLE_SHA` pin and the packet `SHA256SUMS` after any bundle change
(for example, a new copy of `R7/backup/sealed-origin.sh` into `bundle/`); `build-sums.sh --check` verifies them.

## 11. Deviations from DESIGN §5 (each with its reason)

1. **Root facts reader** (`afldb-verify-rootfacts`, a socket-activated root service). afldb-verify cannot read what A-2 and G0B must
   inspect: `/home/arm` is 0750 (verified on streamanator), the backup `.state` is 0700, the crontab spool is root-only, the off-host
   directory is 0700, and `/proc/<arm pid>/cwd` needs ptrace. Adding afldb-verify to group arm would hand arm-group files to the
   verifier and break §2. The reader answers fixed requests only (`a2`, `g0` on prod; `g0b <date> <dump>` on offhost), walks each
   path from `/` with O_NOFOLLOW, accepts only regular files owned by arm or root with size caps, returns facts (counts, hashes,
   short sanitised strings), never file contents in bulk, and runs with `CapabilityBoundingSet=CAP_DAC_READ_SEARCH CAP_SYS_PTRACE`,
   `ProtectSystem=strict`, `ProtectHome=read-only`, `PrivateNetwork`, `NoNewPrivileges`. Its socket is root:afldb-verify 0660. No sudo.
2. **python3.12 -I -S** (the real file `/usr/bin/python3.12`, not the `python3` symlink) replaces arm's node for journal JSON and
   loopback HTTP. Ubuntu's root-owned interpreter; isolated mode ignores PYTHON* variables and user site-packages.
3. **Group systemd-journal** for the verifier, so journald's trusted fields can be read without root.
4. **G0B strengthened**: a cron dispatch counts only with journald's kernel-attested `_UID=0` (§6), so arm cannot forge it with
   `logger`. `_COMM`/`_EXE` are deliberately NOT required: the rehearsal showed `_EXE=/usr/bin/dash` on the genuine `(arm) CMD`
   line (journald reads /proc after receipt; the cron child has already exec'd `/bin/sh`), so requiring them refuses genuine dispatches.
5. **CRON_LOG_FILE and R6_DRYRUN** dropped: the verifier takes no environment.
6. **Host-policy cmp** replaced by pinned digests (S4).
7. **BACKUP-EVIDENCE line** is now `BACKUP-EVIDENCE r7 <invocation> <dispatch usec> <dump> <sha> <kind> <seal>`. Nothing consumes the
   r6 form (checked: r6-post-verify.sh does not parse it).
8. **The sealed run's FAILED marker** is PID 1's `Result=` of afldb-backup.service (R7/backup README item 6: the sealed install writes
   no root marker file). G0 and A-2 require `Result=success`; arm's `.state` markers are still reported (arm-produced).
9. **`bundle/sealed-origin.sh` is a byte-identical copy of the final `R7/backup/sealed-origin.sh`** (sha256 `a733e67b…`; r7 and the r8 commit 89bd271e: `1153df78…`; r8 after the independent review pins the whole service unit, R8-F-7, backup README section 4 item 13). Any later
   change there must be copied here and followed by `build-sums.sh` (the wrapper's pinned bundle digest changes with it).
10. Harness image adds `python3`, `cron` and `tzdata` to r6's package list (the verifier needs python3.12; G0B needs a real cron).
11. **r8, `install-verify.sh` trust order.** r7 sourced the staging `bundle/lib.sh` before checking that the staging was trusted, so
    a staging copy an arm process could write (the case the check exists to refuse) ran arm's `lib.sh` as root. r8 refuses `/home`,
    checks every component with a verbatim copy of `trusted_path` and lib.sh's digest against `bundle/SHA256SUMS` before sourcing
    it, and checks `verify-verify-install.sh` (trusted, equal to its packet `SHA256SUMS` line) before any change.
12. **r8, installer guard.** `install-verify.sh` refuses, before any change, a root session that descends from arm (an ancestor
    with arm's real or effective uid, `SUDO_USER`/`SUDO_UID` = arm, or loginuid = arm), printing
    `REFUSED: root session descends from arm: <test>`. A tripwire for `sudo` in an arm session, not a proof of the F1 root path.
13. **r8, wrapper.** `version` exits 1 unless both hosts answer an authenticated PASS; `A2 SCOPE:` and `G0 SCOPE:` lines (§1) are
    printed before the verdict. A-2 and G0b PASS lines resting on arm's data carry `[ARM-PRODUCED ...]` (§9). No check changed.
14. Harness image (r8) adds `sudo`, used only inside the prod container by scenario h.
15. **r9, off-host qualification (Astra blocker 1).** The wrapper gains the qualification pin, the streamanator denylist, pinned
    known_hosts, `--qualification-fixture` (rehearsal only) and the scheduled-transfer evidence check. `g0b-core.sh` and the
    dispatcher gain the five G0B fields. In `g0-core.sh` only one message changes. Bundle digest `3ea41209…`.

## 12. Rehearsal (`../verify-harness/`)

```text
bash verify-harness/r7v-run.sh [--verify-rev <rev>] [--log-dir <dir>] <RID>   # from the workstation (Git Bash); DEV host only
```

r8 added `--log-dir` (dev runs write under R8 `dev-logs/`, so the recorded r7 logs are never overwritten) and three scenarios:
**h installer-guard** (arm gets sudo inside the prod container only; the workstation logs in as arm by ssh and runs
`sudo install-verify.sh`, plainly and with `SUDO_*` removed: both REFUSED, the verifier's state digest unchanged), **i staging-libsh**
(a hostile `bundle/lib.sh` in an arm-owned, a group-writable and a tampered staging copy is never sourced; CONTRAST: the r7 blob ran it
as root), **j version-exit** (control exit 0; an off-host VERSION STOP gives exit 1; CONTRAST: the r7 blob exited 0). Scenarios a and
c also require the SCOPE line and the ARM-PRODUCED labels, and c reports A-2's `backup-origin=` and the whole-A-2 exit separately.

r9 renamed the off-host container to `r7v-offhost`. Scenarios a, d, e and j pass a FIXTURE qualification. New scenarios:
**k offhost-qualification** (an unqualified STOP although the container answers PASS; a fixture naming streamanator refused;
production transport refuses the fixture flag; an unknown host key gives STOP) and **l possession-only** (the pull log's END removed,
then the dispatch journal vacuumed: each a STOP "possession only"). The local decision test is
`../../review-fixes-r9-20261128/offhost/tests/r9q-wrapper-test.sh`.

Two disposable containers on streamanator (`--network none`, never `--privileged`, label `r7v.run=<RID>`), whose PID 1 is the real
systemd 255. `afldb-prod` has a fixed-offset Melbourne zone so the **real afldb-backup.timer** fires at 02:20 local about two
minutes after start. It installs **R7/backup's final bundle with its own install-backup.sh** (real run wrapper, real backup.sh,
real root sealer, real PostgreSQL 16 `pg_dump`), and the verifier with `install-verify.sh --role prod` from a root-owned staging
copy. `streamanator` installs `install-verify.sh --role offhost`, and **arm's real cron** runs the real
`afldb-offhost-pull-daily.sh` at 03:10 local. The off-host copy is a FIXTURE: the published dump is carried in instead of rsync from
production. The workstation runs the documented wrapper with the real Windows OpenSSH client, a fresh test key, pinned container
host keys and a ProxyCommand of `ssh arm@streamanator docker exec -i <ctr> nc 127.0.0.1 22`. Every line in the logs is labelled
REAL-SYSTEMD / REAL / FIXTURE / FIXTURE-ATTACK / HARNESS.

Review round 1 added scenario **g (forged-comment)**: a non-superuser role made owner of `afldb_restore_test` sets the reviewer's
comment (newlines, `ESC[2K ESC[G`, a forged `R6 PRE RESULT PASS` and a forged `OWNER VERDICT A2 PASS transport=production … exit=0`,
`ESC[8m`, an unterminated OSC); the A-2 call must show zero ESC/control bytes, the forged text only on `[relayed, neutralised]`
lines, exactly one line beginning `OWNER VERDICT`, and the same verdict and exit as scenario c.

What the rehearsal does **not** prove (container limits, or arm-produced evidence):

- A-2's host-only checks: kernels, /boot, modules, caddy, the Wednesday date, the apt timers.
- The weekly restore: no afldb-backup-verify.service runs in the container, so the restore journal, `last-verify.json` and the
  `afldb_restore_test` digest checks STOP there.
- Production's real sshd configuration, the DNS/known_hosts entry for `afldb`, and the production-transport (`-F none`) path.
- The off-host rsync from production.
