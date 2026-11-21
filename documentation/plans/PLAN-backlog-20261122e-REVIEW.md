# REVIEW: PLAN-backlog-20261122e (launch plan review, afldb-reviewer, 22 Nov 2026)
DOC: launch plan review of `PLAN-backlog-20261122e.md`; graded findings F-001..F-017 with amendments; no code touched, nothing executed.
DOC: verdict = NO CRIT, NO HIGH; the run may proceed once the MED amendments are folded into the steps named. Read from disk, not from the brief.

## Verdict
No CRIT/HIGH: run e changes nothing on production, and every hazardous action is an owner step for Wed 25 Nov that the MED amendments
below constrain. Thirteen MED (binding on the named step), four LOW/INFO (no work). Nothing was run by me; production, streamanator,
DigitalOcean behaviour and the two CVEs are unverified by me (no web access in this role).

**Plain statement for the owner rule ("if boot recovery is still uncertain, pause").** On the evidence on disk today, recovery from
"149 does not boot" is NOT established: `grub.cfg` is unread (`r6-kernel-check-20261122/raw-output.txt:68`), `grubenv` state is
unknown (`:70-71` printed nothing), firmware type is unknown, the console type is unverified (`README.md:63`), and no GRUB option has
been tried on this host (`procedures/03-pending-reboot.md:37`). The R6 runbook must therefore be written NO-GO by default, turning GO
only when the owner read steps of F-001..F-003 return the stated values.

Paths below are relative to `docs/v2/evidence/backlog-20261121/` unless they start with `deploy/`, `tools/` or `documentation/`.

## Findings

### F-001 MED (S2) GRUB options: three of the four can fail silently as the plan words them
Evidence: `PLAN…e.md:27` ("no change + grub-reboot; temporary visible menu drop-in; saved-default=137 with one-shot 149; Shift/Esc");
`raw-output.txt:61-65` (`GRUB_DEFAULT=0`, hidden, 0, `50-cloudimg-settings.cfg` sets `GRUB_TIMEOUT=0` and `GRUB_RECORDFAIL_TIMEOUT=0`);
`r6-kernel-check-20261122/README.md:109` (`grub-reboot "<the exact 137 title>"`).
Failure scenarios:
1. **Bare title.** Ubuntu puts older kernels inside the `Advanced options for Ubuntu` submenu. `grub-reboot "Ubuntu, with Linux
   6.8.0-137-generic"` (a bare title, as run d's README words it) matches no top-level entry; GRUB falls back to entry 0 and boots 149
   again. The "rollback" reboots production a second time into the kernel being rolled back from.
2. **`grub-reboot` with `GRUB_DEFAULT=0`.** It works only because Ubuntu's generated `grub.cfg` honours `next_entry` unconditionally;
   that is a property of the file nobody has read on this host.
3. **Drop-in order and values.** A drop-in sorting before `50-cloudimg-settings.cfg` is overridden by it (menu stays hidden; the owner
   believes it is visible). A drop-in that omits `GRUB_RECORDFAIL_TIMEOUT` leaves 0, so after one failed boot the menu is hidden again.
   `GRUB_TIMEOUT=-1` or `GRUB_RECORDFAIL_TIMEOUT=-1`, if left behind, parks an unplanned reboot at the menu for the six-week leave.
4. **saved-default=137 + one-shot 149** is the only option that recovers from a non-booting 149 without a keystroke (power-cycle in
   the panel returns to 137), but it changes the persistent default: if the restore is skipped or half-done, the default silently
   stays 137 and the next unplanned reboot regresses to the kernel without the two fixes, with `reboot-required` absent.
5. **Shift/Esc** at a browser VNC console with a 0-second hidden menu is not a recovery path (procedure 03 `:16-17` already says so).
Amendment (runbook text, each a named item):
- Owner sudo read steps add: `sudo grep -n -B2 -A8 'next_entry' /boot/grub/grub.cfg` (expect the `if [ "${next_entry}" ]` block;
  absent = option "grub-reboot" unavailable), `sudo grub-editenv /boot/grub/grubenv list` and `sudo ls -l /boot/grub/grubenv` (expect
  no `next_entry`/`saved_entry`), `sudo grep -E "menuentry_id_option|^submenu|^\s*menuentry" /boot/grub/grub.cfg | cut -c1-200`.
- Every entry is named by **submenu path with `>`**, preferring ids: `gnulinux-advanced-<UUID>>gnulinux-6.8.0-137-generic-advanced-<UUID>`
  (copied from the owner's output, never typed from memory). State that a bare title boots entry 0.
- State per option, in one table: what it recovers from (149 boots but misbehaves / 149 does not boot), which files it changes,
  what the default is afterwards, the restore commands, and the verification that the restore happened (F-002).
- Drop-in constraints: file name `99-…cfg`; `GRUB_TIMEOUT_STYLE=menu`; `GRUB_TIMEOUT` 10-30; `GRUB_RECORDFAIL_TIMEOUT` 10-30; never
  `-1`; read `GRUB_TERMINAL` first (expected `console` on the cloud image; `serial` only = menu invisible on the VNC console = NO-GO
  for that option). Before any `update-grub`: `sudo cp -p /boot/grub/grub.cfg /root/grub.cfg.pre-r6-<stamp>` and its sha256; after:
  exit status 0 and both `Found linux image` lines (149 and 137), else restore the copy and NO-GO.
- Shift/Esc is recorded as "not relied on". Recommendation text must say which single option the runbook uses and why; the others
  are record only. "No change made now" stays true: all of this is owner steps for Wed.

### F-002 MED (S2) No check that GRUB is back to its pre-R6 state; the post-reboot script does not look at GRUB at all
Evidence: `PLAN…e.md:27` lists `r6-post-verify.sh` contents (kernel, uptime, postgres, afldb, release, caddy, timers, journal, disk,
`afldb_restore_test`, reboot-required): no GRUB item.
Failure: F-001 scenario 4, or a `99-` drop-in left in place: acceptance reads PASS on `uname -r` = 149 while the default kernel or
menu behaviour has been changed for the leave.
Amendment: `r6-pre-verify.sh` prints a GRUB baseline (sha256 of `/etc/default/grub`, `ls -l` and sha256 of every
`/etc/default/grub.d/*.cfg`, the `GRUB_*` lines including `GRUB_TERMINAL`, `GRUB_SAVEDEFAULT`, `GRUB_DISABLE_SUBMENU`);
`r6-post-verify.sh` prints the same and the runbook requires **byte-equal to the baseline**, plus owner sudo: `sha256sum
/boot/grub/grub.cfg` equal to the pre-R6 value (if any `update-grub` ran, equal after the restoring `update-grub`; if it differs,
`diff` against the saved copy and explain every line), `grub-editenv list` empty of `next_entry`/`saved_entry`,
`grep -c 'set default="0"' /boot/grub/grub.cfg` = 1. Acceptance of R6 is not complete without these. Same checks after a rollback boot.

### F-003 MED (S1, S2) "Console verified" is undefined, and a login prompt does not prove recovery access
Evidence: `r6-kernel-check-20261122/README.md:86` ("DigitalOcean Droplet Console opened and a login prompt seen");
`procedures/03-pending-reboot.md:21` (`droplet-agent` active); `raw-output.txt:18` (`console=tty1 console=ttyS0`); README `:122`
(sshd key-only).
Failure: DigitalOcean offers two different things. The **Droplet Console** is delivered through the in-guest `droplet-agent` over
SSH; it needs a booted OS and shows no boot or GRUB screen. The **Recovery Console** is the out-of-band VNC screen. An owner who
verifies the first has verified nothing for a kernel that does not boot. Further: (a) with `console=ttyS0` last, `/dev/console` is the
serial line, so systemd emergency-mode output and its prompt are not on the VNC screen (tty1); (b) root is locked on the cloud image,
so emergency mode offers no shell anyway; (c) key-only sshd says nothing about whether `arm`'s password works at tty1, and browser
VNC keyboards mangle some characters.
This rests on my knowledge of DigitalOcean, not on the repository: **S1's DigitalOcean docs fetch must confirm or correct it** and the
runbook must quote the source. Amendment, NO-GO items by name: `NG-CONSOLE` = the owner has, on the day, opened the **Recovery
Console**, logged in as `arm` with the password and run `uname -r` there (not merely seen a prompt); `NG-FALLBACK` = either a
completed snapshot (F-013) or a GRUB option verified per F-001; `NG-GRUBREAD` = the F-001 read steps returned the expected shapes.
State honestly that a 149 that reaches emergency mode is recoverable only by snapshot restore or the provider's recovery ISO.

### F-004 MED (S2) "Exact expected values" for Tuesday's outcomes cannot exist on 22 Nov
Evidence: `PLAN…e.md:27` (pre-verify of A1/A2 outcomes "with exact expected values"); `a1a2-20261124/a2-p0-entry.sh:17,23-28`
(three A1 outcomes, `NEW_ID` unknown until the build); `ATTENDED-PLAN-A1-A2-20261124.md:245-251` (drop order: R3 steps 1-11 or R4 may
not have happened).
Failure: a script with hard-coded "accepted + everything installed" values STOPs on a legitimate Tuesday outcome (rollback, R3
moved), or, worse, is edited by hand on Wednesday morning outside review.
Amendment: `r6-pre-verify.sh`/`r6-post-verify.sh` take arguments as `a2-p0-entry.sh` does (`<accepted|stopped|rolledback> <CURRENT_ID>
<r3:yes|no> <r4:yes|no>`), validated by regex; the runbook carries a fill-in table completed from the Tuesday sitting record and a
matrix outcome -> GO/NO-GO (for example `r3:no` = no 02:20 backup = `NG-FALLBACK` needs the snapshot). Fixed pins that are knowable
now stay literal (Caddy `f00859d5…` after R4, ledger 118, kernels). Kernel set must be **exactly** {137, 149} installed and 149 the
newest: the 06:30 unattended run on Mon-Wed can add a kernel (`raw-output.txt:122,128-141` shows one every 1-4 weeks); any other set
is STOP and an owner decision, not "boot the newest". Off-host check: the dump name and sha256 printed by `r6-pre-verify.sh` on
production must equal what `r6-offhost-verify.sh` prints on streamanator (the two scripts must print them in one comparable line).

### F-005 MED (S2) Post-reboot liveness: wrong unit name inherited from run d, and SSH polling trips the known IPS
Evidence: `r6-kernel-check-20261122/README.md:96,102` uses `systemctl is-active postgresql`; `OWNER-PACKET.md:452` and
`a2-p0-entry.sh:56` use `postgresql@16-main`; `FRESH-SESSION-PROMPT-A1A2.md:50-53` (a burst of SSH connections makes the home IPS
reset port 22).
Failure: (a) `postgresql.service` is the umbrella unit and reads `active` with the 16-main cluster down: false PASS. (b) Repeated SSH
attempts while the host boots look like a scan; the IPS then blocks port 22, the host appears dead, and the owner starts a rollback
of a healthy boot.
Amendment: `postgresql@16-main` everywhere, plus the application health through Caddy as the database proof. Liveness order after
`systemctl reboot`: public HTTPS smoke first (`r6-public-smoke.sh`), SSH only after HTTP answers, and a fixed SSH schedule (one
attempt at T+3 min, one at T+6, one at T+10, then the Recovery Console), never a loop. State what an SSH timeout with HTTPS working
means (IPS, not the host).

### F-006 MED (S2) Timers: "none due inside the window" must be read live, and the stop interacts with the hourly R2 check
Evidence: `deploy/afldb-email-intake.timer:5-6` (`OnBootSec=2min`, every 5 min), `deploy/afldb-settle-afl-api-brownlow.timer:15`
(`*:0/5`), `raw-output.txt:120` (`apt-daily.timer` fires at a random time of day; 09:35 on 22 Nov), `OWNER-PACKET.md:446-448`,
`deploy/afldb-settle-failure-status.sh:61-62` (timer not active = FAILED), runbook `:302` (r2 at `:17` every hour).
Failure: (a) a writer timer that is enabled but was not in run d's three-line listing fires two minutes after boot, during
verification; (b) `apt-daily` or `unattended-upgrade` holds the dpkg lock at the reboot (a half-configured package set is the one
realistic way a routine reboot produces an unbootable or degraded host); (c) the settle timer is stopped, or the host is down, across
10:17: the R2 check reports FAILED/unreachable and mails an alarm that is an artefact of the procedure.
Amendment: pre-verify runs `systemctl list-timers --all 'afldb*' 'apt-daily*' --no-pager` and `systemctl list-unit-files 'afldb*'`;
the runbook lists every **enabled** afldb timer with its next elapse and the rule (stop it, settle first, as packet R6; restart all
after; verify each `active` with a next elapse). `afldb-backup*.timer` are named explicitly (not due; not stopped; `Persistent=true`
does not fire at boot unless a run was missed, so pre-verify must show Wed 02:20 and Wed 03:30 ran). `apt-daily*` next elapse inside
the window = owner stops that timer too or waits. The apt/dpkg-idle gate (`README.md:91-92`) is re-run by the owner immediately
before `systemctl reboot`, not only in pre-verify. Timing: stop timers after the `:17` check (>= 10:18), all timers `active` again
before 11:17; if that cannot be met, the runbook says "expect exactly one R2 alarm email" in advance. Name a latest-reboot time
(a rollback needs a second boot plus verification inside the window) and apply the same offsets to the 14:00 fallback.

### F-007 MED (S4, plan §0) The production-contact boundary: tighten five points
Evidence: `PLAN…e.md:8-11,29`; owner decision 4 ("ONE read-only production session"); `issue348-acquisition/i348-postload-check.sh:58-67,
115-121,140-143`; `sealed/i348-load.sh:75`; `LOAD-WINDOW-PROPOSAL.md:102-104`.
1. **Retry = second session.** "One attempt; at most one retry after 5 minutes" contradicts "exactly ONE". Amend: a retry is allowed
   only if the first attempt produced no remote output at all (ssh rc 255 before authentication); if any line came back, there is no
   retry: STOP and report. An rc 255 is also the IPS signature, so one retry at most, never sooner than 5 minutes.
2. **Use the path being verified.** `i348-privcheck.sh` should reuse `creds()` and the `envval`/`RE` lines of `i348-postload-check.sh`
   verbatim (PG* in the child environment), not the `a2-p0-entry.sh` variant which puts user and host in argv. That also closes the
   proposal's own "production path exercised only through its refusals" gap for the DSN parse and host check.
3. **Table list derived, not typed.** The nine relations read by `snap` are `draft_picks`, `draft_persons`, `external_identities`,
   `sources`, `import_batches`, `player_link_resolutions`, `players`, `data_edits`, `data_overrides` (`:116-121`). The sealed
   `draftguru-surface-digest.sql` also runs as `afldb_backup`; S4 must grep its `FROM`/`JOIN` list and check the union.
4. **Catalog only, provably.** The SQL text may reference `pg_catalog` objects and `has_*`/`pg_has_role`/`current_setting` only; no
   `FROM` on any user relation, no `\copy`, no `count(*)`. Same session assertions as `snap` (`:115`: role, database, read-only),
   `statement_timeout`/`lock_timeout`, `ROLLBACK`. Output is relation and column **names** with booleans, role names, and
   `relrowsecurity`/`relforcerowsecurity`; the raw output goes into the repo only after a check that it has no DSN, host or password.
   Closure verifies the "no user relation" property by grep of the SQL heredoc.
5. **State what it proves.** In PostgreSQL 16 `has_table_privilege`/`has_column_privilege`/`has_schema_privilege` do honour
   `pg_read_all_data` membership, so "all true" is the expected result (static evidence: `tools/maintenance/privileges.sql:894`; no
   `ROW LEVEL SECURITY` in `src/db/migrations/`, grep count 0). It proves ACLs on 22 Nov, not on 12 Jan, and not that the 120 s
   statement timeout suffices on production; `snap pre` before the load remains the real gate. Write that sentence in the doc.
Also: the session is not run during the Tuesday sitting hours and not before the script's refusal paths were dry-run (plan `:39` has
the second; add the first).

### F-008 MED (S2, S3, S10) "Read-only by construction" is asserted by a grep that cannot show it
Evidence: `PLAN…e.md:27` ("grep for `>`/`tee`/`rm`/`mv`/`cp`").
Failure: none of `sudo`, `systemctl start|stop|restart|reload|reset-failed|daemon-reload`, `journalctl --rotate|--vacuum-*|--flush`,
`apt`/`apt-get` without `-s`, `dpkg --configure`, `update-grub`, `grub-*`, `sed -i`, `touch`, `mktemp`, `install`, `chmod`, `chown`,
`ln`, `truncate`, `dd`, `kill`, `crontab` (other than `-l`), `psql` without the read-only options, `curl -X`/`-d`, or
`release.mjs` subcommands other than `status`/`host-gate` contains a `>`; and `2>&1`, `>/dev/null` make the grep noisy enough to be
waved through.
Amendment: each new script's header carries the **complete command inventory** (as `check.sh` in run d effectively does), and
closure checks an allowlist, not a denylist: every external command word in the script is in a fixed read-only list (`uname`,
`uptime`, `cat`, `ls`, `stat`, `grep`, `sed -n`, `awk`, `sha256sum`, `readlink`, `df`, `dpkg -l|-s`, `dpkg-query`, `apt-get -s`,
`apt-config dump`, `systemctl is-active|is-enabled|show|list-timers|list-unit-files|--failed`, `journalctl` read forms,
`git rev-parse|status --porcelain`, `node deploy/release.mjs status|host-gate`, `sh deploy/afldb-settle-failure-status.sh`, `psql`
only in the `a2-p0-entry.sh:65-77` shape, `curl` GET/HEAD only, `crontab -l`, `date`, `hostname`, `test`, `echo`, `printf`, `timeout`).
Redirections limited to `2>&1`, `2>/dev/null`, here-strings and here-docs. stdin closed, every probe under `timeout`, no temp file.
`deploy/post-install-check.sh` (packet R6 `:456`) is used only if its header states it writes nothing; otherwise it stays an
explicit, separately named step. `R6_DRYRUN=1` must be refused on host `afldb-prod` (it is a rehearsal switch; on production the
host check must always run).

### F-009 MED (S3) `r5-retained-paths.sh` runs as root on production but has no route there; and §4.5a contradicts itself
Evidence: `PLAN…e.md:28` ("owner runs as root"); `a2-p0-entry.sh:14,21` (production checkout is at CAND `7d92042f` and P0 requires
`git status --porcelain` empty); the a1a2 scripts reach production only on stdin as `arm`; runbook `:249` ("run §4.5a anyway" if R4
is not started) against `:268` ("only after §4.4 step 10 PASSES").
Failure: (a) the helper is not in the production checkout; copying it into `/home/arm/projects/afldb` makes porcelain non-empty and
STOPs every later P0-style probe including R6's; pasting an unpinned script into a root shell is not a reviewed step. (b) On Tuesday
with R4 dropped, the runbook gives two answers on whether the R5 block runs; owner decision 3 says it runs in A2.
Amendment: either make the re-verify an inline owner block in the runbook (fixed literal directory, `sudo sh -c 'cd <R> && ls -la &&
wc -l SHA256SUMS && sha256sum -c --quiet SHA256SUMS'`, names/sizes/counts only) and keep `r5-retained-paths.sh` as the same commands
for the record, or define the transport: piped as `arm` into a named file under `/home/arm/ops/` (outside the checkout; listed as a
production write in the runbook), the owner runs `sha256sum` on it and compares with the pinned value before `sudo bash <file>`.
The script takes no argument, hard-codes the directory, uses no glob outside it, and writes nothing. Resolve `:249`/`:268` in one
sentence (R5 block runs after R4's probes pass, or, if R4 is not started by 11:35, on its own at that point).

### F-010 MED (S6, S8-S11) Commit A/B: four ways the structure breaks, none handled
Evidence: `PLAN…e.md:31,33-36,42`; session-start rule (PREP = `ls-remote` main; `PREP^` = A; `diff A..PREP` = one file).
1. **Publishing.** The rule survives only a fast-forward of `main` to B. A merge commit, squash, rebase or cherry-pick changes or
   buries A; `PREP^ = A` then fails at 09:20 on Tuesday. State "fast-forward only; if `origin/main` has moved from `da4cc0c4`, the
   prompt is regenerated as B' on the rebased A'" in the hand-back and in the prompt.
2. **Closure after B.** S10 verifies after S9, so every finding costs a dead B in history (A, B, A', B'). Run closure on A first
   (content, `bash -n`, pins, secrets, trailers), then write B, then a mechanical check of B only (`B^ = A`, one file, prompt names
   A's full hex, no trailer) whose result goes in the hand-back, not in a tracked file.
3. **Tracked writes after B.** `.phaneslight/returns/` is ignored (`.gitignore:41`), so S11 is safe; a session summary, a regenerated
   `_index.md` or a tracker touch after B is not. Rule: every tracked write is in A; after B the tree is clean and nothing is written.
4. **S6 edits the prompt.** S6 lists the FRESH prompt among its targets but S8 says A excludes it. All prompt edits (including the
   C-F-001 wording at `FRESH-SESSION-PROMPT-A1A2.md:43`) belong to S9/B only.
Also in the prompt: what the Tuesday session does if rule 2 or 3 fails (STOP; the owner names PREP and the reviewed commit
explicitly; no self-repair), and that `git merge-base --is-ancestor 7d92042f… PREP` still applies (`:21`).
Acceptance to add for A: `git diff --stat 8a42bb77 A -- docs/v2/evidence/backlog-20261121/a1a2-20261124/` shows no `*.sh` change (or
each changed script's sha256 pin is re-recorded and `bash -n` re-run), and the `sealed/` and `i348-postload-check.sh` checks of F-012.

### F-011 MED (S1) If the advisory check contradicts run d, that is an owner escalation, not a README note
Evidence: `PLAN…e.md:26`; `r6-kernel-check-20261122/README.md:39-48,68` (reason 1 of the verdict the owner approved R6 on).
Failure: S1 finds one CVE absent from KEV, fixed at or before 137, or not fixed in 149; the plan corrects a table and continues to
write a reboot runbook whose approval rested on that table.
Amendment: decide per CVE against three sources that must agree: the Ubuntu tracker's noble `linux` fixed version, production's own
changelog (`raw-output.txt:146-150` has entries for 146 and 147, and the list at `:153` contains both ids), and the KEV entry
(`dateAdded`, catalogue version against README `:16`). Any disagreement that weakens reason 1: keep run d's text, add a dated
correction beneath it, and put it at the top of the hand-back as an owner decision (the R6 approval stands or not: the owner says).
A disagreement that does not weaken it (a date, a priority) is a dated note only. A source that cannot be fetched is recorded as
"not verified", never filled from memory.

### F-012 MED (S4) The owner's eight are groups (a)-(e) only; (f)-(k) must not read as accepted, and the checked script must not move
Evidence: `F2-DECISION-REVIEW.md:40-126,229` ((a) `name_key`; (b) `source_record_id`; (c) `draft_age`; (d) `height_cm`; (e) the four
reported games/goals columns = eight columns; (f)-(k) are the "declared" groups); `DECISIONS-20261122d.md:79-80` (open confirmation);
`LOAD-WINDOW-PROPOSAL.md:92-102` (script sha `d75def8c…`, 146/146 dry run), `PLAN…e.md:29` ("NOT done (no cluster start)").
Failure: (a) a mapping table that spreads eight names over eleven letters lets the approval text claim (f) `dg_person_id` (6,676 +
4,967 rows), (i) the 191 origin changes and (j) 31 new identities as owner-accepted when the owner named none of them; (b) "smallest
addition outside the seal" edits `i348-postload-check.sh`, after which the pinned sha and the 146/146 evidence describe a different
file and cannot be re-run in this run.
Amendment: the table has a column "named by the owner (round 4): yes/no" with (f)-(k) = no and one sentence each on why they are
inseparable from the load (or not); the approval text keeps (a)-(k) spelled out and the open confirmation stays in
`DECISIONS-20261122e.md` and OPEN-ITEMS until the owner answers. `git diff --quiet 8a42bb77 A --
…/issue348-acquisition/sealed/ …/issue348-acquisition/i348-postload-check.sh` must be clean; any proposed addition is described, not
applied. "Before/after COMMIT per group" must name line numbers in `sealed/i348-load.sh` and `reload_guard.py` re-read from disk.
The 12 Jan window is written as PROPOSED in every place it appears (LOAD-WINDOW, OPEN-ITEMS, trackers).

### F-013 MED (S2 b, S7) The DigitalOcean snapshot is a new full copy of every secret and of the R5 logs; the plan gives it no owner
Evidence: `PLAN…e.md:27` (snapshot steps); `R5-RETENTION-PROPOSAL.md:79,89` and runbook `:285-286` (provider copies are outside R5
and unverified); `R5-RETENTION-PROPOSAL.md:65-68` (tokens in the retained files can be live until about 1 Dec).
Failure: the snapshot taken on 25 Nov holds `.env`, the database, the SSH keys and the retained pre-fix logs, and outlives the R5
review date with nobody assigned to delete it; R5's "restricted access" is then true on the droplet only.
Amendment: section (b) states: live snapshots are crash-consistent only; duration depends on disk size and must finish before GO (so
it starts well before 10:00; give the owner the "completed" state to look for); cost; a restore returns the disk to snapshot time
(writes after it are lost; the 02:20 dump off-host is the complement); what it contains. Add a disposal REVIEW date for the snapshot
to OPEN-ITEMS next to R5's (7 Jan 2027), and a line in the R5 record that a provider copy now exists.

### F-014 LOW (S6) C-F-001: three different times share "10:45"
`ATTENDED-PLAN-A1-A2-20261124.md:54-55` (P6 "to about 10:45"), `:239` ("P6 ends about 10:48", R4 11:00-11:20), `:59` (latest restart
10:45), `DECISIONS-20261122d.md:30` (the owner's recorded approval). A grep for "10:45" cannot tell the rule from the estimate; fix
by wording ("P6 ends about 10:45-10:48; R4 is scheduled 11:00, gated on P6 PASS, never after 11:35; latest A1 restart 10:45"), and
leave `DECISIONS-20261122d.md:30` verbatim with the note beneath it.

### F-015 LOW (S0, S7) `documentation/plans/_index.md` has no entry for any 20261122 plan
Grep of the index for `20261122` returns nothing. The index is generated and needs Node; disclose it as the same known deviation as
`new-file` (this review file was created with Write for the same reason). Do not hand-edit the index.

### F-016 INFO Deferred acceptance falls inside the leave
Packet R6's "next 05:00 settle succeeds; R2 reads OK next morning" (`OWNER-PACKET.md:478`) lands on Thu 26 Nov. The runbook should
say the observer is the R2 hourly mail (silence = OK) and that the record is completed on return.

### F-017 INFO Nothing here is rehearsed on a like host
No GRUB option, console login or snapshot restore has been exercised on a DigitalOcean droplet; streamanator dry runs prove syntax
and the host guard only. The report (section i) should say so in those words.

## Disclosure
Written by this review: this file only. Not edited: the plan. No sub-agent spawned. No command executed.
