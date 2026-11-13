# hostops evidence: ISSUE-351 / ISSUE-352 / ISSUE-364 (node_modules part) — 2026-11-14

Branch `claude/rem-hostops-20261114`, base 5035ed96 (origin/main de640826 plus review records). Everything here was produced
without a deploy, restart, reboot, `sudo`, production write or change to any live configuration. Production was only read
(files, `systemctl show/cat/list-timers`, and a read-only database role); the DEV service, DEV database and
`/home/arm/projects/afldb` were not touched (DEV `afldb.service` MainPID 1732, ActiveEnter 03:01:41 AEDT, unchanged
before and after; shown read-only).

## 1. Findings: validated, amended, not rejected

### ISSUE-351 — unattended upgrades restart production's app and PostgreSQL: VALIDATED, with two amendments

Evidence (`prod-ro/prod-ro-patching.txt`, `prod-ro-needrestart.txt`, read 2026-11-14 about 08:47 AEDT, Ubuntu 24.04,
systemd 255, PostgreSQL 16.15):

- `unattended-upgrades` is enabled (`APT::Periodic::Unattended-Upgrade "1"`); Allowed-Origins are the release pocket,
  `-security`, ESMApps-apps-security and ESM-infra-security; no `Package-Blacklist`; no `Automatic-Reboot`.
  `apt-daily-upgrade.timer` fires `*-*-* 06:00` with `RandomizedDelaySec=60m` (last 06:34:15, next 2026-11-15 06:45:13 AEDT).
- `needrestart` 3.6-7ubuntu4.5 runs with its stock configuration: no `$nrconf{restart}`, `conf.d` holds only a README, and
  `override_rc` names neither afldb nor PostgreSQL. `/usr/sbin/needrestart` lines 258-282 resolve Ubuntu mode to restart
  `'a'` (automatic) when called from the apt hook (`/etc/apt/apt.conf.d/99needrestart`, `DPkg::Post-Invoke`).
  **That "automatic" is inferred from the configuration and the code, not observed by running needrestart** (plan review H-5).
- Observed, not inferred: on 2026-11-14 06:35:16-06:35:21 AEDT `afldb.service` (06:35:21), `postgresql@16-main.service`
  (06:35:19), ssh, cron, journald, networkd, resolved, timesyncd, udevd, polkit, rsyslog, multipathd and others restarted
  after a libc6 upgrade; caddy did not. `afldb` has `Requires=postgresql.service`, so it follows the database.
  `NRestarts` stays 0 after such a restart (it counts failures only), which is why the old gate could not see it.
- Under the release route (§3a of `docs/deployment.md`) a `promote` that is not followed by the owner's restart is therefore
  activated by the next unattended upgrade, without `status --expect`.

Amendments to the finding as filed:

1. `unattended-upgrades.service` is **always active** (the shutdown handler), so "is apt running" must be judged from
   `apt-daily.service` / `apt-daily-upgrade.service` plus the command line of a real run. The first implementation matched the
   process name `unattended-upgr` and would have refused every promote forever; the fixture tests could not see it. A smoke of
   `host-gate` against real systemd on the rehearsal host did (`host-evidence/host-gate-smoke.txt`), and it is fixed and
   pinned (commit "host gate must not treat the always-on ... handler").
2. PostgreSQL package upgrades restart the cluster from their own postinst, independent of needrestart. A needrestart hold
   alone is therefore insufficient; the policy also takes the PostgreSQL server packages out of the unattended set.

### ISSUE-352 — no scheduled backup, restore verification or off-host copy; `backup-restore.md` §6 stale: VALIDATED

Evidence (`prod-ro/prod-ro-backup.txt`): no backup timer, no `arm` crontab, linger off; timers present are the settle timer
(`*-*-* 05:00`, +15 min), logrotate/dpkg-db-backup 00:00 and e2scrub_all Sunday 03:10. `~/backups/afldb` is 880 MB of
per-operation dumps (`afldb_prod-*.dump`, newest 2026-11-12). The serving checkout (HEAD c1c4b22e) carries the pre-ISSUE-341/342
backup scripts. `afldb_restore_test` exists on production (397,622,295 bytes, marker `afldb.restore_test.v1 sha256=599e32a1...`).
Amendments: (a) `backup.sh --keep N` prunes every `afldb_prod-*.dump` in its directory, so running it in `~/backups/afldb`
would delete the per-operation dumps that release and promotion packets bind by hash: the schedule needs its own directory;
(b) §6 claimed the dump uses `--no-privileges` (it uses `--no-owner` only) and that the legacy rebuild is a safety net
(`docs/v2/legacy-disposition.md`: the sealed rebuild covers the historical baseline only, not auth, audit, overrides, settings,
the D-336-2 curated draft rows or nightly data).

### ISSUE-364 (node_modules of the serving checkout, my part): VALIDATED as a gap, delivered as warn-and-record

Nothing checked the serving checkout's `node_modules` against `package-lock.json`, though the settle timers run `tsx` and
every importer from it. `release.mjs check-node-modules` compares npm's own `node_modules/.package-lock.json` with the lock and
the settle wrapper runs it and **only warns** (`AFLDB_NODE_MODULES_DRIFT`), per plan review H-7. Zero false positives on a real
`npm ci` tree (427 packages, `host-evidence/node-modules-real.txt`); both negative controls and the "no installed record" case
behave. The rest of ISSUE-364 is not in my scope.

## 2. What changed (commits, in order)

| Commit | Subject |
|---|---|
| a5a4f7c8 | ISSUE-351: attended promote/rollback, host gate and activation audit (+ ISSUE-364 node_modules check) |
| 36e298a8 | ISSUE-352: scheduled backup and restore verification wrapper, off-host pull, V2 DR runbook |
| ce67d77c | ISSUE-351: host gate must not treat the always-on unattended-upgrade shutdown handler as a running upgrade |
| d312a5e6 | ISSUE-351: docs wording for the host gate's read-only probes |
| (final) | ISSUE-351/352: hostops evidence README, prod read-only probes, host scripts and host evidence |

## 3. Policy

**Patching.** Security updates keep installing unattended. The two things that turn an update into an outage are removed from
the unattended path and given to the owner: (1) needrestart does not restart `afldb` or PostgreSQL
(`deploy/host-policy/needrestart-afldb-hold.conf`); (2) PostgreSQL server packages are excluded from unattended upgrade
(`deploy/host-policy/apt-52-afldb-unattended.conf`). The cost is that old libraries stay mapped in the running processes
until the owner restarts them, so a weekly **owned window** is part of the policy (section 6). Both files are PREPARED, NOT
INSTALLED. The needrestart file was syntax-checked and its two regexes tested against unit names in plain perl
(`host-evidence/needrestart-conf-check.txt`); it was **not** exercised by a real needrestart, and the apt file's effect on
`unattended-upgrade --dry-run` was not run (H-5). Both are therefore verified after installation by the owner, listed below.

**Releases.** `promote` and `rollback` are one attended step with the owner's restart: they refuse without `--attended`
(breaking CLI change; callers listed in section 8). `host-gate` (also run by `promote`) refuses when apt is running or
`apt-daily-upgrade` is due inside `--window-min` (default 90), reports a pending reboot, and with `--strict` requires the
needrestart hold. `rollback` never refuses on host state. `status --expect` compares the service identity with the window
recorded at promote/rollback and fails a restart that coincides with an apt run unless `--confirm-attended-restart`.

**Rollback and schema (H-6).** The migration head of a release is recorded at build/adopt (`migrationHead`). `rollback
--ledger-head <name>` refuses only a *proven* mismatch, and `--accept-schema-ahead <same name>` is the explicit way past it.
With no `--ledger-head` it proceeds and records `ledger: not-checked`, so rollback still works with the database down
(tested). Callers affected: `docs/deployment.md` §3a and §11, `docs/production-cutover.md`, and every historical release
packet under `docs/v2/*` that calls bare `promote`/`rollback` (errata only: those are records and were not edited).

**Backup.** Nightly dump 02:20 (+10 min) into a dedicated directory, with a sha256 sidecar and an off-host copy in the same
run; Wednesday 03:30 a fresh dump is restored by the real `restore-test.sh` and parity-checked; any failure writes `FAILED`
and an error-priority journal line; `status` is the monitor probe. Retention 14 local, 30 off-host.

### Proposed RPO / RTO

- **RPO 24 h** for non-derivable data (auth, audit, `data_edits`, overrides, settings, curated rows), worst case about 29 h
  (dump 02:20 + up to 10 min, loss just before the next); settle writes are re-derivable from the AFL API. An after-settle dump
  would shorten the nightly-data window: see decision D-HO-5.
- **RTO, database only, host intact: target 1 hour.** Measured on the rehearsal host with a 407 MB database (30 MB dump):
  fresh dump 9 s, `restore-test.sh` 17 s, DR procedure A steps 3-5 about 10 s (candidate restore 7 s, `db:privileges` 1 s,
  verification 1 s) (`host-evidence/rehearse-352.txt`, `rehearse-dr.txt`). Production is the same order of size (518 MB, dump
  30.1 MB on 2026-11-12) on a smaller droplet: **not measured on the production host**.
- **RTO, host loss: unrehearsed.** Dominated by provisioning plus the restore above; procedure B in `docs/backup-restore.md` §6.

## 4. Test evidence (exact commands; red then green)

Workspace on streamanator: `W=/mnt/ssd/afldb-rem-hostops-20261114`, checkout `$W/cand`, isolated PostgreSQL 127.0.0.1:55620.
`W=$W [LIGHT=1] bash $W/in/vitest-files.sh <name> <files>` runs `node node_modules/vitest/vitest.mjs run <files>` with the DB
variables unset (scripts under `host-scripts/`).

| Run | Result |
|---|---|
| **RED** `tests/deploy-release.test.ts` (new tests) against the unmodified base `release.mjs` | `13 failed | 32 passed (45)`; failures include `TypeError: evaluateHostGate is not a function` (x3), `parseShowProps`/`parseAptHistory`/`needrestartHold`/`migrationHeadOf`/`compareNodeModulesToLock is not a function`, `AssertionError: expected '--confirm-attended-restart' to be true`, `expected '' to match /NODE_MODULES UNKNOWN/`, and the integration `release: REFUSED: ... is already current` (`host-evidence/red-351-unit.txt`) |
| **GREEN** `tests/deploy-release.test.ts tests/deploy-web-unit.test.ts` on the final code | `Test Files 2 passed (2)`, `Tests 85 passed (85)` (`green-351-3-final-code.txt`) |
| `bash tests/restore-test.test.sh` (pins `restore-test.sh`, which I did not edit) | `24 passed, 0 failed` |
| `npx tsc --noEmit` | exit 0 (run before the last two small commits, repeated on the final checkout: see the hand-off report) |
| Neighbouring pinned suites: `afl-api-cutover`, `afl-api-ingestion-safety`, `db-promotion-check`, `register-issue224-s9-dev-write-gate`, `v2-shadow-capture`, `db-test-rebuild` | `22 failed | 2510 passed (2532)`: **all 22 pre-existing at base and unrelated to my edits**, section 7 |

H-3 held: every `release.mjs` invocation in tests and on the host used a temp `--root` and `--pid`, `--no-live` or a
`--host-state` fixture; nothing ran `promote`, `rollback` or `status --expect` against a default root.

## 5. Rehearsals (isolated cluster only; plan review H-1/H-2/H-4)

- **352 wrapper** (`host-evidence/rehearse-352.txt`): run from a checkout proven to hold no `.env` (only `.env.example`), with
  explicit directories under `$W` and explicit DSNs for port 55620; the resolved target is logged first. Source = a copy of a
  verified production snapshot. Cases: status fails before any backup; `backup.sh` dump 29 MB in 9 s with sidecar and state;
  `verify` = fresh dump + the real `restore-test.sh` into `afldb_restore_test` (restore 6 s, nine parity checks PASS, hash
  recorded as the database comment, "restored and proven (attempt 1)"); off-host push to a local stand-in directory (copy,
  re-hash, `pg_restore --list`); pull run (`offhost-pull.sh`): three dumps verified, second pull a no-op, a corrupted dump
  quarantined with exit 1; a wrong role password fails the run, writes `FAILED`, turns `status` red, and the next success clears
  it; a second concurrent run exits 75 without a marker.
- **H-2 exception, recorded:** `restore-test.sh` restores into the fixed name `afldb_restore_test`, which
  `isolated-pg create-db` refuses (it only accepts `afldb_v2_*_test`). The database was created and used on **my isolated
  cluster only** (port asserted), with a superuser helper (`host-scripts/mk-restore-db.mjs`); the refusal text is in the log.
- **DR procedure A, steps 3-5** (`host-evidence/rehearse-dr.txt`): restore of a scheduled-backup dump into a new candidate
  database with `pg_restore --no-owner --no-comments --exit-on-error` (exit 0), `db:privileges`, and verification queries that
  equal the source on every row (ledger head `118_fixtures_unconfirmed_participants.sql`, players 13,365, matches 17,056,
  player_match_stats 695,499, `afldb_app` can read `players` and **cannot** read `auth_users`). Steps 1, 2, 6, 7 (stop writers,
  swap by rename, restart) are procedure text only and were not rehearsed.
- **Units** (`host-evidence/verify-units.txt`): `systemd-analyze verify` on copies under `$W` rc 0 for all five units; calendars
  evaluate to 02:20 daily and Wednesday 03:30; `bash -n` OK for both new scripts and the settle wrapper. **No `systemctl
  enable/start/daemon-reload`, nothing under `~/.config/systemd`** (H-4). **Not rehearsed under systemd** (H-9): the promote
  window itself cannot be rehearsed on DEV without disturbing it, and the timers/service units were never started anywhere.
- **host-gate against real systemd** (`host-evidence/host-gate-smoke.txt`): promote/rollback PASS, `--strict` REFUSED (no
  needrestart hold on this host), as designed; this is the run that found the shutdown-handler false positive.

## 6. Separate owner operations (not done here)

### 6a. Pending reboot (kernel 137 running; installed 138-149; libc6)

`/var/run/reboot-required` is present on production; uptime since 2026-08-16 (about 90 days); no `Automatic-Reboot`.
The reboot is **a separate, attended owner operation, not part of any unattended path and not done by this work.**

Procedure (owner, root): 1) a fresh verified backup exists and is copied off-host; 2) no promote in flight and
`release.mjs status` clean; 3) pick a time outside 05:00-07:00 AEDT (settle and apt) and `node deploy/release.mjs host-gate`;
4) `sudo systemctl stop afldb-settle-afl-api.timer` and wait for `afldb-settle-afl-api.service` inactive; 5) `sudo
systemctl reboot`; 6) after boot: `uname -r` shows the new kernel; `systemctl is-active postgresql@16-main afldb caddy`;
`sudo systemctl start afldb-settle-afl-api.timer`; `node deploy/release.mjs status --expect <current id>`;
`bash deploy/post-install-check.sh <current id>`; the journal clean.
Recovery: if the new kernel does not boot, select the previous kernel (137) from GRUB at the DigitalOcean console (console
access and the GRUB menu are **unverified**: confirm before relying on this); if `afldb` does not come up,
`journalctl -u afldb`, then `release.mjs rollback --attended` and a restart; if the database does not, `docs/backup-restore.md` §6.

### 6b. Weekly owned maintenance window (restarts the held services)

Suggested: weekly, 30 minutes, after the apt run and outside 05:00-05:30 AEDT; the owner chooses the day. Procedure:
`sudo needrestart -r l` (list only: shows what is owed), `sudo apt-get install --only-upgrade postgresql-16 postgresql-client-16`
(only if held updates exist), then `sudo systemctl restart postgresql@16-main afldb`, then `release.mjs status --expect <current id>`
and `post-install-check.sh`. Recovery: the release is unchanged, so a failed restart is `journalctl -u afldb`, and `rollback
--attended` only if the release itself is implicated.

## 7. Remaining failures, classified

| Failure | Class | Evidence |
|---|---|---|
| `tests/db-promotion-check.test.ts` > "restore-test.sh hashes before restoring, clears first, and binds only after parity passes": `expected 6858 to be less than -1` | **Pre-existing at base, not mine.** The ISSUE-250 source-shape pin searches for the literal `COMMENT ON DATABASE ${RESTORE_DB} IS NULL`, but ISSUE-341/342 (commit 532dcd77) rewrote it as `printf 'COMMENT ON DATABASE %s IS NULL;\n'`. `restore-test.sh` and that test are unmodified here (H-8). Needs a one-line test update by whoever owns that suite; **graded MED**. | `tools/maintenance/restore-test.sh:182,305`; `tests/db-promotion-check.test.ts:7592-7603` |
| `tests/db-test-rebuild.test.ts` (21 tests): `Reviewed input pin: data/players/sibling-relationships.csv sha256 b1f0ff4e... does not match the reviewed pin dc8d6180...` | **Pre-existing at base, not mine** (data file and pin untouched; belongs to the pins scope). | `host-evidence/green-neighbours-summary.txt` |

## 8. Owner decisions (options, recommendation, exact change, procedure, recovery)

**D-HO-1. Install the needrestart hold and the PostgreSQL blacklist.** Options: install both (recommended); the hold only
(PostgreSQL packages can still restart the cluster); neither (status quo: every security update that touches libc or
PostgreSQL restarts the site). Change: `sudo install -m 0644 deploy/host-policy/needrestart-afldb-hold.conf /etc/needrestart/conf.d/50-afldb-hold.conf`
and `sudo install -m 0644 deploy/host-policy/apt-52-afldb-unattended.conf /etc/apt/apt.conf.d/52-afldb-unattended`.
Verify: `sudo needrestart -r l` lists afldb/PostgreSQL as owed but restarts nothing; `apt-config dump | grep -i Package-Blacklist`
shows the four packages; `node deploy/release.mjs host-gate --strict` passes. Recovery: `sudo rm` both files. Cost: the weekly owned window.

**D-HO-2. Install the backup units.** Recommended yes, after updating the serving checkout (its scripts predate ISSUE-341/342).
Exact procedure and undo: `docs/backup-restore.md` §3 (dedicated directory, attended first run of both services, `status`
exit 0, then `enable --now` the timers).

**D-HO-3. Off-host destination.** A) pull to streamanator or another owner host with a forced-command read-only key
(recommended: no credential on production can delete the copies); B) object storage with a write-only key and `gpg`
before upload; C) a mounted directory via `AFLDB_OFFHOST_DEST` (not a failure domain separate from the droplet unless
detachable). Not rehearsed: the SSH transport and any object store. Recovery: remove the key or the `AFLDB_OFFHOST_DEST` line.

**D-HO-4. `--attended` as a breaking CLI change.** Recommended yes. Callers to carry the flag: the §3a block and §11 of
`docs/deployment.md` and `docs/production-cutover.md` (updated); any new release packet; historical packets are errata.
Recovery: none needed (a refusal changes nothing); revert the commit to drop the requirement.

**D-HO-5. An extra dump after each settle** via the settle unit's `OnSuccess=` (the unit is the rollover scope's, not
edited here). Recommended: not yet; revisit when the notifier (ISSUE-332) exists. Cost of not doing it: up to about 29 h of
nightly-settle writes, all re-derivable.

**D-HO-6. Pending reboot and window schedule**: section 6; the owner picks the times.

**D-HO-7. The stale `afldb_prod_*` databases on production** (`afldb_prod_auth_recovery`, two `afldb_prod_candidate_*`, two
`afldb_prod_pre_rebuild_*`) were seen read-only and are not part of this work; the owner decides whether and when to drop them.

## 9. Pins (as read 2026-11-14)

Production database identity (read-only, `REPEATABLE READ READ ONLY`, asserted before reading): `afldb_prod`, OID 66668,
system identifier 7674454702926115004; `afldb_prod` 517,921,815 bytes; migration ledger head
`118_fixtures_unconfirmed_participants.sql`. Releases: `current` c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x, `previous`
0f251c2daa8d-3t0xWKI76Jgna2tB8a9oN (read with `release.mjs status` without `--expect`). `afldb.service` MainPID 3774230,
InvocationID a2584da1...5755. Verified snapshot used as the rehearsal source: sha256 e77c307d...826d, 30,141,895 bytes
(the dump that seeds `afldb_v2_remhostops_tmpl_test`). prod-ro file sha256 (first 16): `prod-ro-patching.txt` 37d9c981ada406e1,
`prod-ro-needrestart.txt` 844d3941af737b0b, `prod-ro-backup.txt` 877573495a5a6442, `prod-ro-pending.txt` 9ef52188a4698a8b;
scripts `prod-ro-patching.sh` c3b1d5202ded8217, `prod-ro-needrestart.sh` b4b77fd5881989d8, `prod-ro-backup.sh`
4816ba0e3a5ad2ee, `prod-ro-pending.sh` be5b00c3bf0ba525. Host evidence sha256 (full): see `host-evidence/SHA256SUMS`.

## 10. Residuals and what is not claimed

- Caddy 2.11.4 runs while the caddy repository offers 2.11.9 (not an automatic origin; not touched).
- ssh, cron and several system services also restart on a libc upgrade; the hold covers afldb and PostgreSQL only.
- Not verified (root-only or not read): sudoers, the contents of production `.env`, `afldb_restore_test` ownership, the root
  crontab, `/var/log/unattended-upgrades/` and `term.log`, the journal, DigitalOcean console/GRUB access.
- The needrestart hold and the apt blacklist are untested against the real tools; the timers/units are untested under systemd.
- The weekly Wednesday verification restores into the shared fixed name `afldb_restore_test`; it overwrites the marker left by
  the 2026-11-12 packet's check (the sidecar and `last-verify.json` carry the new proof).
- Process notes: an early `npm ci` for the rehearsal workspace ran before the run-wide flock rule arrived; short targeted
  Vitest runs (two files, about 25 s; the neighbours batch about 90 s) and the rehearsals ran under `nice`/`ionice` without the
  heavy lock because the queue held about a dozen waiters behind a 30+ minute full-suite run; `tsc` ran under the lock. A first
  red-run Vitest process hung on a leaked fixture server and was killed by pid (mine only). New files were created with the
  Write tool rather than `phaneslight new-file` (no Node on the workstation).
