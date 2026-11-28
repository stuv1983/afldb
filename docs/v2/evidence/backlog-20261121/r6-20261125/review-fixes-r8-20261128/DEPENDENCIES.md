# R6 r8 dependency review: what the sealed backup (G1) and the owner verifier (G2) rest on

28 November 2026. Scope: the R7 packet (`../review-fixes-r7-20261128/`, called R7 below) at worktree bytes on HEAD `7e2ef51a`, plus
the r8 fixes recorded here. Read-only review except for the r8 fixes, each of which has a rehearsal scenario (section 5). Nothing here
was run on production. Paths below are relative to R7 unless they start with `deploy/` or `tools/` (repository root).

## 1. Classes

| Class | Meaning |
|---|---|
| **P** | Affects backup **provenance** (G1): which timer invocation produced the accepted dump, and that the accepted bytes are its bytes. |
| **V** | Affects the **authenticity of the delivered verdict** (G2): the `AFLDB-VERIFY RESULT` line, the wrapper's `OWNER VERDICT` line and the wrapper's exit status. |
| **I** | Makes an **A-2 (or G0) input wrong while the check still PASSes**: the verdict is authentic, but what it reports is arm's data or an arm-supplied argument. |
| **S** | Can only force a **STOP** (denial). A STOP never becomes a PASS. |
| **D** | **Display** only: text on Stu's terminal that is never authenticated or acted on. |

"arm" means any process running as uid arm on production **without root** (DESIGN §1). A class says what the dependency would affect
if arm controlled it; the "arm reach" column says whether arm, without root, does.

### Authentic verdict versus true content

G2 promises an **authentic** verdict: the line Stu reads was produced, for this call (nonce), within 300 s (`at=`), by the pinned
root-owned bundle (`bundle=`), on the host whose key Stu pinned, with an exit status equal to the ssh exit status
(`verify/afldb-verify-call.sh:71-96`). It does **not** promise that every fact the verifier read is **true**. Where a check reads
data arm's processes wrote (class I), the verdict is an authentic statement that arm's data said X. r8 labels each such PASS line
`ARM-PRODUCED` and prints a `SCOPE` line before each A2/G0 verdict saying exactly what a PASS does and does not establish
(`verify/afldb-verify-call.sh:122`, `:129`). G1 is likewise provenance, not content: a sealed dump is exactly what the identified
timer invocation's `pg_dump` wrote, whatever the database held (item 7).

## 2. The dependency table

Status: **fixed r8** (code change here, with a scenario), **holds** (verified, no change), **owner action** (cannot be closed in code),
**residual** (stated and accepted), **labelled r8** (class I made visible in the output; the fix the brief asks for is labelling).

### 2a. R7 README §4, items 1-18 (verify README §9 is the same list, items 1-5)

| # | Dependency | Classes | arm reach | Mechanism (file:line) | Status |
|---|---|---|---|---|---|
| 1 | Weekly restore evidence: `last-verify.json`, FAILED markers in arm's `.state`, the restored dump, the restore journal line, `afldb-backup-verify.service` Result | I, S | yes | `verify/bundle/a2-core.sh:267` (Result, PID 1 stamps), `:271-280` (state, journal, rehash), `:284` (markers); `verify/bundle/afldb-verify-py:67-76` (journal-restore) | labelled r8; wording corrected (§3.1) |
| 2 | The application: release dirs, `release.json`, `events.log`, HTTP `/api/health` and `_buildManifest.js` | I, S | yes | `verify/bundle/a2-core.sh:72-127` (`serving_release`), `:232` | labelled r8 |
| 3 | `.env` line counts (PASS line) and checkout HEAD (INFO) | I (counts), D (HEAD) | yes | `verify/bundle/a2-core.sh:231`, `:235` | labelled r8 |
| 4 | streamanator: copy, sidecar, `.verified-` marker, pull log | I (lineage, marker), S | streamanator arm: yes | `verify/bundle/g0b-core.sh:45-50` (bytes re-hashed by root), `:75-105` (pull log) | labelled r8 |
| 5 | arm's crontab line (root-only spool, arm-edited) | I | streamanator arm: yes | `verify/bundle/g0b-core.sh:56-60` | labelled r8 |
| 6 | `OnFailure=` marker `FAILED-unit` in arm's `.state` | S (presence fails); its absence is arm's choice | yes | `verify/bundle/a2-core.sh:282-285` (PID 1 `Result=` decides), `verify/bundle/g0-core.sh:39` (FAIL only) | labelled r8 (A-2); holds (G0) |
| 7 | Database content (arm holds the owner DSN) | none of P/V; content only | yes | DESIGN §1 out of scope; G1 is provenance | residual |
| 8 | `afldb-backup-verify.service` runs **arm's checkout script as arm** (User=arm, `/home/arm/projects/afldb/tools/maintenance/scheduled-backup.sh`) | I (item 1), S | yes | `deploy/afldb-backup-verify.service` ExecStart; its dumps are never sealed, so never gate-eligible (`backup/sealed-origin.sh:212-285` accepts only seals) | residual |
| 9 | **F1**: root reached through arm's login (owner `sudo` in an arm SSH session) | **P, V** | through the owner's session | DESIGN §1 F1; r8 installer guard is a tripwire (row C16) | **owner action** |
| 10 | `ledger 118`; `afldb_restore_test` comment and `numbackends` (written by arm's DB role) | I | yes | `verify/bundle/a2-core.sh:303`, `:304-308` | labelled r8 |
| 11 | Raw psql output to Stu's terminal (F2) | D | yes | `verify/bundle/a2-core.sh:302` (`san`), `verify/bundle/afldb-verify-dispatch:118-120`, `verify/afldb-verify-call.sh` `show()` | holds (fixed r7) |
| 12 | Both sides of "process cwd = the release" are arm's (arm's process can `chdir`; the comparison path resolves through arm's links) | I | yes | `verify/bundle/a2-core.sh:89`; `verify/bundle/afldb-verify-rootfacts:197` | labelled r8 (release-status line) |
| 13 | Worker count (arm's processes) | I | yes | `verify/bundle/a2-core.sh:227-228` | labelled r8 |
| 14 | `events.log` decides the "restarted since the last attested PASS" note | I | yes | `verify/bundle/a2-core.sh:106`; `verify/bundle/afldb-verify-rootfacts:207-214`; the PID 1 `InvocationID` comparison (`a2-core.sh:61-68`, `:224`) is what holds | labelled r8 |
| 15 | Production arm serves the off-host pull (chooses the bytes sent) | S | yes | `verify/bundle/g0b-core.sh:49`: the copy must hash to the authenticated G0a sha256 | residual (denial only) |
| 16 | Denial: markers, process names, port 3100, large files, `/tmp`, a full disk, a stopped service | S | yes | every FAIL path | residual |
| 17 | arm's PostgreSQL role is a **superuser** (unchecked) | I, S; P/V only through a postgres-to-root escalation (= F1 class) | if superuser | §3.2 | **owner action** (check `rolsuper` before installing) |
| 18 | Look-alike verdict text (N1) | D | yes | `verify/afldb-verify-call.sh` `show()`; only the wrapper's own last line is the verdict | residual |

### 2b. DESIGN §4 permission obligations (G1 acceptance), as arm with its real groups including `afldb-backup-read`

| # | Obligation | Classes | arm reach | Mechanism (file:line) | Status |
|---|---|---|---|---|---|
| B1 | No write, create, rename, link, unlink, chmod or replace on staging, the seal directory, any seal, `published/`, any published file, `state/`, the code directory, the drop-in or unit files, at creation, sealing and after publication | P | no | `backup/install-backup.sh:120-122` (owners/modes), `backup/70-afldb-backup-sealed.conf:10-14` (User/Group/UMask), `backup/afldb-backup-seal:144-217` (root copy, `mv -n -T`) | holds (r7 `perm` scenario on real systemd; r8 `--as-arm` re-checks the write bits in every scenario) |
| B2 | No signal to any `afldb-backup` process (`kill -STOP` EPERM) | P | no | uid separation (`User=afldb-backup`) | holds (`perm`) |
| B3 | No read of staging | P | no | staging `afldb-backup:afldb-backup 0700` (`install-backup.sh:122`) | holds (`perm`; `--as-arm`: "arm cannot list staging") |
| B4 | No peer login as `afldb_backup` | P | no (unless row 17) | `pg_ident` map `afldbbackup afldb-backup afldb_backup` only; `backup/verify-backup-install.sh:118-119` | holds (`--as-arm`), see row 17 |
| B5 | The review-2 SIGSTOP substitution attack re-run on real systemd is refused | P | no | the sealer copies as root before hashing (`afldb-backup-seal:144-152`) | holds (`review2` scenario) |
| B6 | Parent directories checked for every path | P | no | `backup/sealed-origin.sh:184-189` (rule 1, trusted paths) | holds |

### 2c. Inputs the verifier (and the sealed backup) trust

| # | Input | Classes | arm reach | Mechanism (file:line) | Status |
|---|---|---|---|---|---|
| C1 | System binaries by path (bash, dash, env, timeout, stat, sha256sum, systemctl, busctl, journalctl, python3.12, psql, cp, mv, chown, ...) | P, V if replaced | no (root-only) | `verify/bundle/lib.sh:43-51` (`trusted_helper`, `HELPERS`), `backup/sealed-origin.sh:184-189` | residual V2: by path and ownership, not by digest |
| C2 | Root facts reader (V1): a root python3.12 service parsing arm-owned files | V (a parser flaw runs in root); I (every value it returns from an arm path is arm data) | arm writes the inputs | `verify/bundle/afldb-verify-rootfacts:32-65` (O_NOFOLLOW walk, regular-file and size checks), `afldb-verify-rootfacts.socket:9-11` (root:afldb-verify 0660), `afldb-verify-rootfacts@.service:17` (CAP_DAC_READ_SEARCH, CAP_SYS_PTRACE) | residual, flagged for the independent reviewer (R7 README §6) |
| C3 | journald **trusted fields** `_SYSTEMD_UNIT`, `_SYSTEMD_INVOCATION_ID`, `_UID`, `_TRANSPORT`, `SYSLOG_PID=_PID` | P/V if forgeable | no: kernel/journald-attested | `verify/bundle/afldb-verify-py:72` (restore: `_SYSTEMD_UNIT`), `:84` (cron: `_UID=0`, `_TRANSPORT=syslog`) | holds. **`MESSAGE` is not trusted** when the sender is arm's code (row 1, §3.1) |
| C4 | PID 1: the timer's `LastTriggerUSec`, the start job, `InvocationID`, `Result`, `ExecMain*`, `MainPID`, `NRestarts` | P (seal), V/I | no; arm can start only `afldb-settle-afltables.service` (`deploy/afldb-settle-afltables-trigger.rules:34-39`), not a gate unit | `backup/sealed-origin.sh:241-258`; `verify/bundle/a2-core.sh:61-68`, `:260-266` | holds. PID 1's `Result=` of a unit that runs arm's code is arm's exit status (row 1) |
| C5 | Zone file `/usr/share/zoneinfo/Australia/Melbourne` (the 02:20-02:31 window, the date gates) | P, V | no (root-only) | `backup/sealed-origin.sh:187` (trusted path) | holds |
| C6 | `pg_wrapper` (B10): `/usr/bin/pg_dump` is postgresql-common's perl wrapper | P if replaced | no: root-owned; `HOME=/nonexistent` (no `~/.postgresqlrc`), `env -i` | `backup/70-afldb-backup-sealed.conf`; R7 README §6 | residual B10 |
| C7 | **The seven A-2 arguments** (`accepted <CURRENT_ID> r3: r4: <window> tue: inv:`), from the Tuesday record, printed by arm-run scripts over arm's login | **I** | yes (they were printed by arm-run scripts) | `verify/afldb-verify-call.sh:124-126` (regex only), `verify/bundle/a2-core.sh:160` (consistency), `:224` (`inv:` vs PID 1), `:230` (`CURRENT_ID` vs arm's link) | labelled r8 + `A2 SCOPE` line; residual. Example: arm kills the app after the owner's Tuesday restart; systemd restarts it with a new `InvocationID`; the hostile login prints the new ID as "the owner's restart"; A-2's InvocationID line PASSes on that argument |
| C8 | The workstation: wrapper bytes, `~/.ssh/afldb_verify`, `known_hosts`, `ssh.exe`, Git Bash, the clock (`at=` window) | V | no | DESIGN §1 (trusted) | residual (owner's machine) |
| C9 | **streamanator's root path** (who installs and can replace the G0b verifier there) | V (the G0b half of an `OWNER VERDICT G0 PASS`), I | **streamanator's arm: yes today** | `id` on streamanator 2026-11-28 14:00 AEDT: `uid=1000(arm) ... 27(sudo) ... 101(lxd),111(docker)`; membership of `docker` (and `lxd`) is root-equivalent, so streamanator's arm can replace the off-host verifier, its sshd configuration and its host key's answers | **owner action**: an install there gives G2 only after arm leaves `docker`, `lxd` and `sudo` there (or the off-host half is accepted as resting on streamanator's arm); the install is still prospective (verify README §10) |
| C10 | Off-host copy lineage ("scheduled pull": invocation, completion, VERIFIED lines) | I | streamanator arm: yes | `verify/bundle/g0b-core.sh:75-105`; arm on production is in `afldb-backup-read`, so a manual copy of the true bytes is possible and only the pull log says "scheduled" | labelled r8 |
| C11 | PostgreSQL superuser status | row 17 | | §3.2 | owner action |
| C12 | sshd, the `Match User afldb-verify` ForceCommand, `authorized_keys`, the host keys | V if altered | no (root-only) | `verify/bundle/60-afldb-verify.conf:4-21`, `verify/bundle/afldb-verify-entry:6` (`env -i`) | holds (rehearsal f: no shell, PTY, forwarding; arm's key refused) |
| C13 | The core-to-dispatcher field channel (`FIELD-<token>` lines) | V if arm could emit a field | no: the token is in the core's environment; arm cannot read another uid's `/proc/<pid>/environ` | `verify/bundle/afldb-verify-dispatch:112-120` | holds |
| C14 | The wrapper's `version` mode exit status | V | n/a (workstation logic) | r7 fell out of the `case` with exit 0 even when a host answered STOP; r8 `verify/afldb-verify-call.sh:131-139` | **fixed r8** (scenario j) |
| C15 | `install-verify.sh` sourced the staging `bundle/lib.sh` **before** checking the staging was trusted, so an arm-writable staging (the mistake the check exists to refuse) ran arm's lib.sh as root | P, V | if the owner stages under an arm-writable path | r7 `verify/install-verify.sh:23-24`; r8 `:57-81` (inline trusted-path copy, `/home` refusal, lib.sh digest before `.`), `:91-96` (verify-verify-install.sh trusted and hashed before any change) | **fixed r8** (scenario i) |
| C16 | Installer run in a root session that descends from arm (the F1 mistake) | P, V | through the owner's session | r8 `backup/install-backup.sh:31-59`, `verify/install-verify.sh:23-51`: ancestor walk (real/effective uid), `SUDO_USER`/`SUDO_UID`, `/proc/$$/loginuid` | **fixed r8 as a tripwire** (backup `arm-sudo`, verify h); F1 itself stays an owner action: root that arm already holds can start the installer outside its own process tree (`systemd-run`, `at`, cron) with a clean environment and an unset loginuid |
| C17 | `verify-backup-install.sh` arm checks run "as arm in a new login" (arm's login chooses the process and its output) | D/I | yes | r8 `backup/verify-backup-install.sh:38-58` (`--as-arm`: setsid + setpriv, no login, stdin `/dev/null`, sanitised output, verdict by exit status and dropped identity); arm-session runs end `INFO-ONLY` (`:123-127`) | **fixed r8** (every backup scenario) |
| C18 | Port 3100: any arm process can bind it and answer `/api/health` and `_buildManifest.js` | I, S | yes | `verify/bundle/a2-core.sh` `serving_release` | labelled r8 (row 2) |
| C19 | The `--as-arm` probe (and agent A's `as_arm` probes) run as uid arm while other arm processes run (independent review R8-F-12): another arm process may (a) open `/proc/<child>/fd/1` (PTRACE_MODE_READ, same uid) and write into it, (b) signal it, (c) only where `kernel.yama.ptrace_scope=0` (Ubuntu's default is 1; the probe is not arm's descendant), ptrace it and change its checks or exit status | D, I | yes | `backup/verify-backup-install.sh:53-58`: printed only as `[as arm] ...` sanitised lines; the verdict is the child's exit status and root's `setpriv ... id`. (a) is display only; (b) forces a failure or hang, never a PASS; (c) can forge the arm-side PASS. Independent of the probe: root's own run (ownership, modes, links, trusted paths, digests, `sealed_origin_install`, root's `id arm`) and every gate (`sealed_origin` never reads the probe) | residual; the arm-side PASS is an addition (effective access: ACLs, capabilities, groups) only while no hostile arm process can ptrace it (backup README §9) |
| C20 | **The service unit's content** (R8-F-7): r7 trusted the base `afldb-backup.service` fragment and any further drop-in by root ownership only; `Environment=` (e.g. `BASH_ENV`, which the ExecStart bash honours before `afldb-backup-run`'s first line), bind/mount settings and the exact `DropInPaths` set were unchecked, and so was the service manager's environment block | P | no (needs root, a past root act: the base unit was historically installed through arm's sudo) | r8 `backup/sealed-origin.sh:145-165`: `DropInPaths` exactly the pinned drop-in (an extra drop-in is refused by name); `Environment`, `PassEnvironment`, `UnsetEnvironment`, `BindPaths`, `BindReadOnlyPaths`, `TemporaryFileSystem`, `ReadOnlyPaths`, `InaccessiblePaths`, `ExecPaths`, `NoExecPaths`, `RootDirectory`, `RootImage`, `MountImages`, `ExtensionImages`, `ExtensionDirectories` empty; `ProtectSystem=strict`, `PrivateTmp=yes`, `WorkingDirectory=/`; `systemctl show-environment` sets no shell- or loader-affecting variable; `:205-208`: FragmentPath content = the repository's `deploy/afldb-backup.service` (`edf00291…`). A production copy that differs is a fail-closed STOP, shown by `verify-backup-install.sh` at install | **fixed r8** (backup harness `extra-dropin`: an `Environment=` drop-in, a `BindReadOnlyPaths=` drop-in, a `BindPaths=` drop-in sorting before `70-`, and a manager `BASH_ENV`, each refused by name; removed: attributed again; CONTRAST: the r7 library attributes with the `Environment=` drop-in) |
| C21 | **The timer unit's content**: the `afldb-backup.timer` fragment and its drop-ins are trusted paths (rule 1: root-owned, not group/other-writable, no symbolic link) but not pinned, and its `DropInPaths` set is not required to be exact (the harness relies on a `RandomizedDelaySec=0` fixture drop-in; production uses the deploy file's 10 min / 1 min) | P (timing only) | no (needs root) | the timer's settings only move the dispatch: rule 4 (`backup/sealed-origin.sh:241-258`) requires the dispatch inside the gate date's 02:20-02:31 window from PID 1's `LastTriggerUSec` and the seal, and recomputes the dispatch kind from the sealed timer activation stamps; a timer edited by root can at most produce a run at another moment in the window, or a STOP | holds by design (r7 reasoning kept); residual: a root-edited timer is a root act (F1 class) |

### 2d. Counts

Rows: 18 (§2a) + 6 (§2b) + 21 (§2c) = 45. A row counts once in every class it carries (C11 is counted under row 17).

| Class | Rows | Of which reachable by arm without root |
|---|---|---|
| P | 9, 17 (via escalation), B1-B6, C1, C5, C6, C15, C16, C20, C21 = 16 | none, except through the owner's root session (9, C16) or an arm-writable staging (C15, fixed) |
| V | 9, 17 (via escalation), C1, C2, C4, C5, C8, C9, C12, C13, C14, C15, C16 = 13 | 9 and C16 (owner's session), C9 (streamanator's arm, today), C14 and C15 (fixed r8) |
| I | 1, 2, 3, 4, 5, 8, 10, 12, 13, 14, 17, C2, C4, C7, C9, C10, C18, C19 = 18 | all (they are arm's data or arm-printed arguments; C19 only under ptrace_scope 0) |
| S | 1, 2, 4, 6, 8, 15, 16, 17, C18 = 9 | all |
| D | 3, 11, 18, C17, C19 = 5 | all |

**No P or V path reachable by uid arm without root remains in repository scope**: the two that existed (C14, C15) are fixed in r8; the
rest are owner actions (9, 17, C9), the F1 tripwire (C16), residuals that need root (C1, C2 parser, C5, C6, C8, C12, C21) or need a
past root act and are now checked (C20, fixed after the independent review).

## 3. Corrections to R7 wording

### 3.1 Item 1 (R7 README §4 item 1, verify README §9 item 1): "Its journal side is trusted"

Imprecise. `afldb-backup-verify.service` runs **arm's checkout script as arm** (`deploy/afldb-backup-verify.service`: `User=arm`,
`ExecStart=/bin/bash /home/arm/projects/afldb/tools/maintenance/scheduled-backup.sh verify`), so the restore journal **line content**
("verify ok: <dump> restored and proven (attempt n)") is arm-authored, and so is the unit's exit status that PID 1 records as
`Result=success`. What is trusted is narrower: the journald trusted fields (`_SYSTEMD_UNIT=afldb-backup-verify.service`,
`_SYSTEMD_INVOCATION_ID`, the receipt timestamp) and PID 1's timer and start facts (the timer dispatch, the start and exit timestamps
inside the Wednesday window). Together they prove **that the scheduled unit ran and when**; they do not prove **what it restored**.
Corrected text is in R7 README §4 item 1 and verify README §9 item 1.

### 3.2 Item 17: what a superuser arm role could and could not do

If arm's PostgreSQL role is a superuser it can run commands as OS user `postgres` (`COPY ... TO PROGRAM`, untrusted languages,
`pg_read_server_files`/`pg_write_server_files`). As `postgres` it **could**:
* edit `pg_hba.conf` and `pg_ident.conf` (owned by postgres on Ubuntu) and reload, mapping OS user arm to `afldb_backup` or
  `afldb_verify`; arm then reads data as those roles (it already can as the owner) but gains nothing over the seal or the verdict;
* change what the server answers to any client: the bytes the sealed run's `pg_dump` receives (content, not provenance: row 7), and
  the ledger and restore-test comment `afldb_verify` reads (already arm-decided: row 10);
* stop, crash or slow the server, or make `pg_dump` fail (S: no seal, G0 STOP);
* bind the server socket directory `/var/run/postgresql` (postgres-owned) and impersonate the server (content only, as above);
* write journal lines as `_UID=<postgres>` (no verifier check accepts them).

It **could not** (without a further escalation): write `/var/lib/afldb-backup`, `/usr/local/lib/afldb-backup`, `/usr/local/lib/afldb-verify`,
`/etc/systemd` or `/etc/ssh`; read staging (`afldb-backup` 0700); signal, ptrace or read the memory of `afldb-backup`, the root
sealer or `afldb-verify` processes (other uids); alter a dump after `pg_dump` wrote it; produce `_UID=0` or `_SYSTEMD_UNIT=afldb-backup.service`
journal records; change PID 1's timer, invocation or result facts; reach the root facts socket (root:afldb-verify 0660).

Not reviewed here, and the reason it stays an owner action: a postgres-to-root escalation through root tooling that handles
postgres-owned files (postgresql-common's `pg_ctlcluster`, log rotation; such bugs have existed). Treat a superuser arm role as a step
toward F1: check `SELECT rolsuper FROM pg_roles WHERE rolname = <arm's role>` (as postgres, through the F1 root path) before installing,
and revoke superuser if it is set.

## 4. What an `OWNER VERDICT A2 PASS` does and does not establish (wording now in the wrapper and the READMEs)

**Does:** the pinned root-owned verifier, on the authenticated production host, at `at=`, found every A-2 check passing **for these
seven arguments**: the live host matched them. `backup-origin=attributed` rests on root and PID 1 evidence only (the sealed timer run).

**Does not:** establish that the seven arguments are right. They come from the Tuesday record, printed by arm-run scripts over arm's
login, and nothing in A-2 checks them against an independent source. Lines marked `ARM-PRODUCED` are authentic readings of arm's data,
not independent facts. Authenticity itself holds only while root on production (and, for G0b, on streamanator) is independent of
arm (F1, C9).

The same for G0: an `OWNER VERDICT G0 PASS` establishes that the sealed timer run produced the named dump with that sha256 on
production, and that streamanator holds a root-re-hashed copy with those bytes after a root cron dispatch at 03:10. That the copy came
from **that** dispatch (the pull log) is ARM-PRODUCED.

## 5. r8 false-PASS fixes and their rehearsal scenarios

| Fix | Mechanism | File:line | Scenario |
|---|---|---|---|
| Wrapper `version` exit | exit 1 when any host's verdict is not an authenticated PASS (r7: 0) | `verify/afldb-verify-call.sh:131-139` | verify harness j (contrast: the r7 blob exits 0) |
| Staging lib.sh ordering | the staging path, `/home`, every component and lib.sh's digest are checked **before** lib.sh is sourced; verify-verify-install.sh is trusted and hashed against the packet SHA256SUMS before any change | `verify/install-verify.sh:57-81`, `:91-96` | verify harness i (contrast: the r7 blob runs the hostile lib.sh as root) |
| Installer guard (F1 tripwire) | refuse before any change when an ancestor has arm's real/effective uid, `SUDO_USER`/`SUDO_UID` is arm's, or loginuid is arm's; message `REFUSED: root session descends from arm: <test>` | `backup/install-backup.sh:31-59`, `verify/install-verify.sh:23-51` | backup harness `arm-sudo` (three sessions), verify harness h (real ssh login as arm, two sessions) |
| `verify-backup-install.sh --as-arm` | root re-executes the script's bytes as arm via `setsid -w setpriv --reuid=arm --regid=arm --init-groups --reset-env /usr/bin/bash --noprofile --norc -c`, stdin `/dev/null`, output sanitised and prefixed; the arm-session run is INFO only | `backup/verify-backup-install.sh:38-58`, `:123-127` | every backup harness scenario |
| A-2 / G0b labels and SCOPE lines | `[ARM-PRODUCED ...]` on each arm-produced PASS line; `A2 SCOPE:` / `G0 SCOPE:` lines | `verify/bundle/a2-core.sh:224-305`, `verify/bundle/g0b-core.sh:50-105`, `verify/afldb-verify-call.sh:122`, `:129` | verify harness a and c |
| Service unit pinned whole (independent review R8-F-7) | `DropInPaths` exactly the pinned drop-in (others refused by name); `Environment`, `PassEnvironment`, `UnsetEnvironment` and the bind/mount/path settings empty; `ProtectSystem=strict`, `PrivateTmp=yes`, `WorkingDirectory=/`; no shell- or loader-affecting variable in `systemctl show-environment`; FragmentPath = `deploy/afldb-backup.service` (`edf00291…`). Timer unpinned by design (row C21) | `backup/sealed-origin.sh:145-165`, `:205-208` | backup harness `extra-dropin` (contrast: the r7 library at 7e2ef51a attributes with an `Environment=` drop-in) |

The run results are in the agent B report and `dev-logs/`.
