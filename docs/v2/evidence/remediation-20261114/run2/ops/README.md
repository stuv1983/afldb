# Remediation run 2, scope `ops`: report (2026-11-14)

Worker: `afldb-worker` (Sonnet 5.5). Branch `claude/rem2-ops-20261114` on base `e8666c17`. Nothing here is pushed, merged, deployed or
installed. Production was touched by **read-only** probes only (section 6). Everything below that says "prepared" means files in the
repository; nothing is installed on any host.

Contents: 1 `--attended`; 2 residual review items (A-04, A-08, A-07); 3 procedures; 4 sensitive logs (O-1); 5 ISSUE-332 gates against
decisions; 6 probe and host record; 7 edits; 8 proposed ledger text; 9 pending and unverified.

## 1. `--attended` on `release.mjs promote|rollback`

**What it is.** `requireAttended` (`deploy/release.mjs:1268-1273`) is a boolean check made first in `cmdPromote` (:1319) and `cmdRollback`
(:1360), before the lock, verification or link move. Without the flag the command prints the refusal ("...say so with --attended. Nothing was
changed.") and exits 1. It is pinned by `tests/deploy-release.test.ts:812-854`; the status audit by :856-890 and the pure audit by :317-333.
It is a **declaration, not an authentication**: any caller can type it.

**Rehearsal** (isolated host workspace, no cluster, no real systemd: `raw/attended-proof.txt`, sha256 `dd3f5688...`): a bare promote and a bare
rollback from a non-TTY script were refused, exit 1, and the release tree hash did not change; the same commands with `--attended` passed the gate
and stopped at the next ordinary check ("not a release id" / "no previous release"); the flag is boolean (a value is ignored). The whole of
`tests/deploy-release.test.ts` passed on the host: 47 tests (`raw/deploy-release-test.txt`).

**The window it does not close.** `current` is a symlink the unit resolves **once at start** (`deploy/afldb.service.d/release-route.conf:8-12`).
After `promote` and before the owner's `systemctl restart afldb`, the running process is the old release while `current` names the new one. Anything that
restarts the unit in between (a crash under `Restart=always`, a reboot, `Requires=postgresql.service` pulling it with PostgreSQL, a library-triggered
restart) activates the new release **unattended**. The 2026-11-14 06:35 libc6 upgrade restarted `afldb` and PostgreSQL within five seconds: that is the
production precedent.

**What detects it, and what does not.** `promote`/`rollback` record a window event and `status --expect` prints the InvocationID change; it is a
**failure only when the restart coincides with an apt run** (`restartCoincidesWithApt`, :253, against `/var/log/apt/history.log`); a crash or reboot restart
is a note; `NRestarts` counts failures only; `--skip-host-gate` and `--no-live` record no window and so get no audit; plain `status` flags "restart
pending?" (:1458); rollback's host gate only warns (:273). Host policy B4 (procedure 02) removes the needrestart and PostgreSQL-postinst triggers, not
a crash or a reboot. **The only closure is operational: run `promote --attended` and the restart in one sitting.**

**Callers.** No script, tool, `package.json` entry, workflow, playbook or deploy file calls `promote` or `rollback`; only `release.mjs`, its tests
and documentation. Living documentation carries the flag now: `docs/deployment.md` (:225, :230, :1676 already; §3a gains a paragraph on its limits),
`docs/production-cutover.md:88` (already had it: the brief's "bare" claim was out of date), `docs/v2/rollback-runbook.md` (§4.1 and the drill commands
were bare: **fixed**), `docs/v2/known-gaps.md` (~:1118, **fixed**). Historical packets that name a bare `promote` and must not be reused without the flag
(not edited: closed records): `block-m-execution-package-2026-11-02.md`, `block-m-a-outcome-...`, `gap-029-block-l-execution-ready-...`,
`master-execution-sequence-2026-11-01.md`, `issue316-gap011-c2-c5-packages-...`, `issue229-rollback-compatibility-...`,
`issue334-335-release-approval-2026-11-05.md`, `issue336-337-340-345-release-approval-2026-11-09.md` and `-r2-`, `gap006-editor-protections-release-package.md`,
`d31612-ui-release-approval/handoff-2026-11-02.md`, the evidence scripts `d31612-release-package-20261102/d31612-phase*.sh`,
`issue334-335-release-execution-20261105/phase.sh`, `issue336-337-340-345-release-execution-20261111/scripts/d3a.sh`,
`issues/closed/AFLDB-ISSUE-330-evidence/live/scripts/d3promote.sh`, `issues/closed/AFLDB-ISSUE-329-installation-20261031/INSTALLATION.md` (:409, :420) and
`issues/closed/AFLDB-ISSUE-330.md`. Run-1 hostops README and APPROVAL-PACKET already carry the flag.

**No change to `release.mjs` is required** (not my file). Optional hardening for the owner: treat **any** InvocationID change inside a recorded window as a
failure unless the owner passes an explicit `--confirm-attended-restart`, so a crash or reboot restart is not downgraded to a note. Not rehearsed under real
systemd.

## 2. Residual review items

### 2.1 A-04 `SuccessExitStatus=75` (verified fixed)
`deploy/afldb-backup.service:28-29` and `deploy/afldb-backup-verify.service:26-27` carry `SuccessExitStatus=75`; `scheduled-backup.sh:85` exits 75 when the
lock is held. No test pins the directive (searched). Residual: a verify that loses the lock race exits 75 silently (no marker); `status` goes red only when
the last verification is older than 9 days. Both units were checked with `systemd-analyze verify` only, never run under systemd.

### 2.2 A-08 `season-opening-check` role (verified, no change)
The tool's default `--dsn-env` is already `AFLDB_BACKUP_DATABASE_URL`. `afldb_backup` holds `pg_read_all_data` (`tools/maintenance/privileges.sql:894`,
conditional on superuser) and so reads `afldb_meta.schema_migrations`; the rollover README §7 recorded a live read as `afldb_backup` (ledger 118). The application
role's access to that table is unverified and is not the default. I added one pin test (`tests/season-rollover.test.ts`: "the gate check defaults to the
read-only backup role, which holds pg_read_all_data"); it pins an already-correct state and is not a red/green fix. Production `.env` holds the key names
`AFLDB_BACKUP_DATABASE_URL`, `AFLDB_IMPORT_DATABASE_URL`, `AFLDB_OWNER_DATABASE_URL` (names only read).

### 2.3 A-07 failure delivery (the notifier delivers nothing; options and an implemented alternative)
**Established record (production, read-only, `raw/prod-ro-ops-notify-logs.txt`): no notification is delivered. Marker and journal only; and at present neither
exists, because the notifier is not installed.** No MTA, `sendmail`, `mail`, aliases, mail spool or `MAILTO`; no monitoring agent beyond DigitalOcean's
`do-agent` and `droplet-agent`; rsyslog and journald forward nowhere off the host; `arm` is not in `adm` or `systemd-journal` and so cannot read the journal;
`OnFailure=` is empty on the settle units; `systemctl --failed` is empty. Full table: `procedures/04-failure-notifier.md` §1.

**Why the sealed notifier cannot deliver:** `PrivateNetwork=true` and `RestrictAddressFamilies=AF_UNIX`; a mail relay or webhook configured as
`AFLDB_FAILURE_TRANSPORT` would log a failure and send nothing (review A-07, confirmed). I did not weaken that sandbox. I added comment-only statements to
`deploy/afldb-settle-failure-notify.sh` (header step 4) and `deploy/afldb-settle-failure@.service` saying exactly this.

**Prepared (not installed; tests added):**
- `deploy/afldb-settle-failure-status.sh`: a read-only pull check. Exit 0 `AFLDB_SETTLE_STATUS OK`, 1 `FAILED`, 2 `UNKNOWN`. Reads `systemctl show` only (both settle
  services' `Result`/`ActiveState`, the nightly timer active and its last trigger within 36 h; the marker is information only). **Run against production over stdin
  as `arm`: `AFLDB_SETTLE_STATUS OK`, last fired 10 h before** (`raw/prod-status-check.txt`). The first version answered `UNKNOWN` on real systemd 255 because
  `systemctl show` ignores `--timestamp=utc` and prints "AEDT"; fixed with `TZ=UTC` and pinned by a test whose stub prints "AEDT" unless `TZ=UTC`.
- `deploy/afldb-settle-failure-transport@.service`, `deploy/afldb-settle-failure-transport.sh` and
  `deploy/afldb-settle-failure@.service.d/transport.conf.example`: an optional push unit that may use the network and nothing else (`ProtectHome=tmpfs`,
  read-only `deploy/`, read-only marker directory, no credential in the repository, `LoadCredential=` for a secret). `systemd-analyze verify` rc 0 on all
  (a negative control did warn: `raw/verify-units.txt`). Not run under systemd.

**Options** (full table `procedures/04-failure-notifier.md` §2): A pull check from an owner host over an `authorized_keys` forced-command key (**recommended**:
needs no production unit change, catches a missed timer and a dead host); B the optional push unit; C a dead-man ping (needs the settle wrapper, another
scope's file); D DigitalOcean panel alerts (host metrics only; unverified); E the status quo (manual, per round); F the application's SMTP relay (not
recommended). Exact change for A: one `authorized_keys` line on production and an hourly job on the owner host (procedure 04 §4). Residual: the pull is only as
good as the owner host and its alarm channel. The same pull pattern covers `scheduled-backup.sh status`.

## 3. Procedures (`procedures/`)

Each states purpose, prerequisites, roles (`arm` without sudo versus owner with sudo), exact commands, validation, failure handling, recovery and unverified items.

| File | Subject | Decision / issue |
|---|---|---|
| `01-season-opening.md` | open 2027 (I350 ceremony; gate G0 by 2027-03-10; gate command from the pinned checkout) | D-350-1, ISSUE-350 |
| `02-host-patching-policy.md` | needrestart hold and PostgreSQL package blacklist; the weekly owned window; the owner owns held PostgreSQL updates | D-HO-1, ISSUE-351 |
| `03-pending-reboot.md` | the 90-day pending reboot (kernel 137 to 149); **GRUB is hidden with timeout 0, so "pick 137 at GRUB" is not a plan** | D-HO-6, ISSUE-351 |
| `04-failure-notifier.md` | how a failed nightly reaches a human today (it does not) and the options | D-332-1, ISSUE-332 |
| `05-backups-and-offhost.md` | scheduled backup, weekly restore verification, off-host pull via `rrsync -ro` | D-HO-2/3/5/7, ISSUE-352 |
| `06-caddy-logging.md` | install the redacting Caddyfile, then the pre-fix logs | ISSUE-362 (O-1, O-3) |

Findings from the procedures worth the owner's attention before approving anything:
1. **Installing the candidate Caddyfile changes more than the logs.** The installed `/etc/caddy/Caddyfile` (sha256 `4f6972ec...7af036`) is not the repository file at
   `c1c4b22e`: it lacks the beta-host `Strict-Transport-Security` and `Content-Security-Policy` headers added to the repository on 2026-08-20 (`3ae20fe4`)
   (`raw/caddyfile-installed-vs-c1c4b22e.txt`). The CSP equals the application's own production policy (`next.config.ts:43-48`), so the effect should be small, but the
   approval must say it and the post-install check must load a full page. It is unreviewed behaviour change travelling under a logging label.
2. The auth README and ledger name the table `auth_invites`; **it is `admin_invites`** (`src/db/migrations/030_admin_invites.sql`). The O-1 pre-check query in
   procedure 06 uses the right name.
3. The serving checkout `c1c4b22e` still holds the August `backup.sh`: run **bare** it prunes the per-operation dumps in `~/backups/afldb` to 7. Always `--dir`.
4. Installed kernels are 137 and 149 only (138-147 are `rc`), amending the hostops README's "installed 138-149".

## 4. Sensitive logs (O-1): proposal, nothing deleted or read

No log or journal content was read. Facts (modes, sizes, rotation configuration, token lifetimes) and the option table are in `procedures/06-caddy-logging.md` §1,
§3 and §4. In short: Caddy files are `0600 caddy:caddy` (already tight); eight rolled `.gz` files are all older than 12 days and therefore hold **no live
token** (magic links 30 minutes, invites 7 days); the live access log (18 MB) and apex log (15.6 MB) may hold an unexpired invite token from the last 7 days and
all hold query text and client IPs. Rotation is Caddy's own (`roll_size 20MiB`, `roll_keep 5`; no logrotate file; age limit default believed 90 days, **not
re-verified**). Options a to e with consequences are in the procedure. **Recommendation: install the filter first; check `admin_invites` for unredeemed live invites;
then delete the eight rolled files and truncate the two live ones (owner, sudo)**; choose encrypted archive instead if forensic history matters; `rm`/`truncate` are
not secure erase and DigitalOcean snapshots (if any) are out of reach. Other log classes (journal, syslog, PostgreSQL, auth.log) are listed with readers and
retention; no change recommended now.

## 5. ISSUE-332 gates against decisions

**Adopted by the owner (2026-11-04) and recorded:** D-316-5, D-316-8, D-316-9, D-316-10 decided; C7 criteria 1-7 approved, criterion 8 replaced; D-316-7 future action
approved; C9 undecided; D-316-11 not pursued. Gates G1-G7 are recorded (2026-11-08, operating record §10) as dated documentation.

**Proposed, not adopted:** G0 (2027 open by 2027-03-10, `season-opening-check.ts ... exit 0 OPEN`); D-332-1 (notifier); D-350-1, D-350-2; D-HO-1..7.
**A naming conflict to resolve:** `G0b` is defined twice. The rollover README §9 and the successor record's proposed addition define it as "the notifier is installed with a
transport, or a written record that the manual check stands in" (D-332-1); the ISSUE-332 ledger's remediation update defines it as "the first nightly after opening applies with no
`season_row_missing` HALT". **Recommend distinct IDs: G0b = failure visibility (D-332-1, amended per procedure 04), G0c = first nightly after opening applies cleanly.**
ISSUE-332 stays open. Procedure 01 §6 step 5 uses G0c.

## 6. Probe and host record

**Isolated host workspace** `/mnt/ssd/afldb-rem2-ops-20261114` on `arm@10.0.40.100`: checkout `$W/cand` from a bundle (sha256 `02940af6...453d44a`) at `e8666c17`, `npm ci`
done; no cluster started, no port used, DEV paths untouched. Tests run there (the whole of each file): `tests/deploy-release.test.ts` 47 passed; `tests/season-rollover.test.ts` and
`tests/afl-api-ingestion-safety.test.ts` 615 passed (417 + 198); `-t AFLDB-ISSUE-332` 12 passed. Red proof: mutating the status script's `Result` test failed 2 tests
(`expected +0 to be 1`, `expected 2 to be 1`); the original was restored (`raw/mutation-332.sh`, `raw/ingestion-332-red.txt`, `raw/ingestion-332-green2.txt`).

**Production, read-only** (`ssh afldb`; `systemctl show/status/list-timers/cat`, `dpkg -l`, `stat`, `command -v`, world-readable `/etc`, configuration and file metadata; no
secret, DSN, log or journal content, no `--expect`): five probes, scripts and outputs in `raw/prod-ro-*`. Facts established: serving checkout `c1c4b22ee150`, clean; no needrestart hold and
no `52-afldb-unattended`; no scheduled-backup or notifier units; reboot pending (kernel 137 running; `libc6` and kernels); Caddy 2.11.4 and its installed Caddyfile; log classes and
modes; `rsync`, `rrsync`, `gpg`, `pg_dump`, `pg_restore`, `curl` present; `arm` groups `arm sudo users`; SMTP key names in `.env`; disk 45 GB free.
Checksums of the originals and committed copies: `raw/SHA256SUMS-originals.txt`, `raw/SHA256SUMS-committed.txt`, `raw/host-hashes.txt`. Raw output files are LF and BOM-stripped copies.

**Deviations disclosed.** (1) Probe scripts were `scp`'d to `/tmp/afldb-rem2-ops-probe*.sh` on production, run, and deleted (a small departure from stdin-only); a final `ls` found none left.
(2) A mis-quoted `grep` made the remote shell attempt to execute `backup.sh` as a command: it failed `Permission denied` (the file is not executable), so nothing ran and no state changed; the
hanging local ssh was killed. (3) The documentation tool for Caddy defaults was unavailable, so `roll_keep_for` is unverified.

## 7. Edits (all disclosed)

| File | Change |
|---|---|
| `docs/v2/rollback-runbook.md` | §4.1 and drill commands now `--attended`; paragraph on what it is and is not; "Current targets" refreshed (current `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x`, previous `0f251c2daa8d-3t0xWKI76Jgna2tB8a9oN`) |
| `docs/v2/known-gaps.md` | drill commands (~:1118) with `--attended` |
| `docs/deployment.md` | §3a: "What `--attended` protects, and what it cannot" |
| `docs/production-cutover.md` | §6: Status 2026-11-14 note (backup items still open; prepared not installed; no uptime monitor found) |
| `deploy/afldb-settle-failure-notify.sh`, `deploy/afldb-settle-failure@.service` | comment-only: the sealed unit delivers nothing by itself |
| new `deploy/afldb-settle-failure-status.sh`, `-transport.sh`, `-transport@.service`, `afldb-settle-failure@.service.d/transport.conf.example` | section 2.3 |
| `tests/afl-api-ingestion-safety.test.ts` | appended describe "AFLDB-ISSUE-332 ... optional transport unit and read-only pull check" (7 tests). Outside my listed ownership; needed for "with tests" |
| `tests/season-rollover.test.ts` | one pin test (section 2.2). Outside my listed ownership; same reason |
| `docs/v2/evidence/remediation-20261114/run2/ops/` | this README, `procedures/01-06`, `raw/` |

Not edited: `release.mjs`, `deploy/Caddyfile*`, `deploy/afldb-settle-afl-api.sh`, `package.json`, `tools/dev/**`, `issues.md`, `IssuesIndex.md`, `blockers.md`, `CHANGELOG.md`,
`CLAUDE.md`, `AGENTS.md`, and any existing evidence file. `tools/v2/season-opening-check.ts` needed no change. I did not touch `docs/backup-restore.md` (the pointer in procedure 05 suffices).

## 8. Proposed ledger text (for the orchestrator; I did not edit `issues.md`)

**ISSUE-332 addendum.** Run 2 (ops, 2026-11-14): production has no failure delivery channel: no MTA, no monitor, journal unreadable by `arm`, `OnFailure=` empty, notifier not installed; the sealed notifier
cannot deliver by design. Prepared: read-only pull check `deploy/afldb-settle-failure-status.sh` (run against production: OK) and an optional transport unit. Proposed amendment to D-332-1: adopt the pull
check (option A). `G0b` is defined twice; propose G0b = failure visibility, G0c = first nightly after opening clean. Still open; nothing installed.

**ISSUE-350 addendum.** Procedure `run2/ops/procedures/01-season-opening.md` written (prerequisites, roles, gate command from the pinned checkout, failure handling, recovery). Nothing run on production.
D-350-1 still the owner's; recommended (b): by 2027-03-10.

**ISSUE-351 addendum.** `--attended` verified and documented including its limits (declaration only; the switch-to-restart window stays open; the audit flags only apt-coincident restarts). Host-policy
procedure (02) and reboot procedure (03) written. New facts: installed kernels 137 and 149 only; GRUB hidden with timeout 0, so the hostops fallback is unreliable; fallback options in 03 §3. Nothing installed.

**ISSUE-352 addendum.** A-04 verified fixed (`SuccessExitStatus=75`). Procedure 05 written (install order, `rrsync -ro` pull key, validation, failure handling). The serving checkout predates the contract and its bare
`backup.sh` prunes per-operation dumps: always use `--dir`. `status` has no pusher: see ISSUE-332. Nothing installed.

**ISSUE-362 addendum.** Procedure 06 written. The installed Caddyfile differs from the repository at `c1c4b22e` (no beta-host HSTS/CSP): installing the candidate also changes headers. Table is `admin_invites`,
not `auth_invites`. O-1: eight rolled files hold no live token; recommendation and options in 06 §3. Nothing deleted, no log read.

## 9. Pending and unverified

- `run2/caddy357/README.md` (scope `caddy357`): not read; procedure 06 will need its steps merged by the orchestrator.
- Never exercised: any unit under systemd; `needrestart` and `unattended-upgrade` against the policy files; the ssh/`rrsync`/forced-command paths; the production runs of every procedure.
- Unverified facts: Caddy `roll_keep_for` default and append-mode behaviour; DigitalOcean console, snapshot and alert availability; production egress; sudoers and root crontab; the contents of any log.
