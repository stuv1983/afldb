# Host prerequisites (gate 9): read-only production-host inspection procedure

**Prepared 2026-10-29. NOT RUN: the host was not accessed.** This is the first of two approvals for release
choice 6 in [the release choices](owner-decision-release-choices-2026-10-29.md). It covers a read-only
inspection only. Any host change goes into the change list that this inspection produces, and that list
needs a **second, separate** approval.

Sources:
- [plan](production-release-plan-2026-10-21.md) step 2, which records the production identity;
- [cutover runbook](cutover-runbook.md) §3–§4 (steps 1–2 and 7);
- [rollback runbook](rollback-runbook.md) §2;
- `docs/backup-restore.md` §3–§4 and `docs/deployment.md` §3–§6;
- the repository `deploy/` files;
- the access and credential pattern of the read-only capture script
  [`capture-prod.sh`](evidence/current-production-shadow/capture-prod.sh).

## 1. What it establishes

| Area | Observations | Why the release needs them |
|---|---|---|
| H0 identity | Hostname `afldb-prod`, user `arm`, kernel, boot id, OS, and whether public IP `209.38.87.252` is bound to the host | Every later step names this host |
| H1 systemd | `afldb.service` properties (MainPID, start time, restarts, user, working directory, drop-ins) and the unit file hash against `deploy/afldb.service`. All `afldb*` unit files and timers. The active/enabled state of the settle, email, backup, Caddy and PostgreSQL units. Hashes of the AFL Tables timer and service against the repository. The polkit directory listing, or the fact that it cannot be read. Any settle, migrate or dump process. The deployed checkout, build id, tracked changes and Node runtime | A-GO restarts this unit; A-AFLT retires the timer and polkit rule; any unit drift must be known before the artifact lock |
| H2 Caddy | Caddy package version and unit; `/etc/caddy` listing; `/etc/caddy/Caddyfile` hash against `deploy/Caddyfile.production`, plus a redacted `diff`; site and proxy lines; owner and mode of `/var/www/afldb-soon`; Caddy log file names (not their contents) | Traffic routing at A-GO, and the apex static path the app publishes to |
| H3 TLS | For `afldb.com`, `www.afldb.com` and `beta.afldb.com`: DNS, then certificate subject, issuer, validity dates, SHA-256 fingerprint and SANs through `127.0.0.1:443`, with days remaining. One HTTPS GET per site (`/`, or `/api/health` for beta) and the direct `127.0.0.1:3100/api/health`. Listening TCP ports | Certificate expiry and routing must not fail inside the window |
| H4 backup routing | `~/backups/afldb`: mode, entries, sizes and dates (no dump is opened); disk space on `/home/arm` and `/var/lib/postgresql`; backup timers; crontab (redacted); `/etc/cron.d`; which off-host tools are installed; ssh `Host` aliases only; hashes of the deployed `backup.sh` and `restore-test.sh`; `.env` mode and key **names** only | A-BACKUP needs a non-pruning dump, an off-host copy and a proven restore. `backup-restore.md` §4 says no off-host copy exists yet |
| H5 database identity | As `afldb_backup` in a read-only session: database, OID, system identifier, owner, extensions, the list of non-template databases (whether `afldb_restore_test` exists), and the ledger row count, last name and digest. No application table is read | `restore-test.sh` requires `afldb_restore_test`. A ledger other than the reviewed 110 is release drift |

## 2. Procedure (Windows workstation, PowerShell; production via the ssh alias `afldb`)

1. **Local identity checks. Stop on any mismatch.**
   ```powershell
   ssh -G afldb | Select-String -Pattern '^(hostname|user|port) '
   ```
   This must show `hostname 209.38.87.252`, `user arm` and `port 22`.
   ```powershell
   (Get-FileHash -Algorithm SHA256 docs\v2\evidence\host-prerequisites\inspect-host-readonly.sh).Hash.ToLower()
   ```
   This must equal the hash named in the approval. Then confirm `git rev-parse HEAD` is the commit named in
   the approval.
2. **Create the restricted evidence folder (local only).**
   ```powershell
   New-Item -ItemType Directory C:\Users\stuar\backups\afldb\host-prereq-<STAMP>
   ```
3. **Run it once.** The script is streamed and nothing is copied to the host:
   ```powershell
   cmd /c "ssh -o BatchMode=yes afldb bash -s < docs\v2\evidence\host-prerequisites\inspect-host-readonly.sh > C:\Users\stuar\backups\afldb\host-prereq-<STAMP>\inspect.log 2>&1"; $LASTEXITCODE
   ```
4. **Hash and check the log.** Record the SHA-256 of `inspect.log`. Search it for `postgres://`, `PASSWORD`,
   `BEGIN` and `PRIVATE`, and for any value printed after an `env_keys` name. Copy it to
   `docs/v2/evidence/host-prerequisites/inspect-<STAMP>.log` only if that check is clean.
5. **Write the record.** A findings table compares each observation with the repository and the plan's
   recorded facts. From it, prepare the **proposed host change list**, each change with its recovery route,
   for the second approval. Nothing is changed in this step.

**Exit codes:**
- 0: complete, with no finding;
- 10: complete, with findings to review (not a failure);
- 2: the credential channel did not match;
- 3: the host or user did not match;
- 5: the database identity differed;
- 6: release drift (the ledger is not the reviewed 110).

## 3. Stop conditions

Stop, record and report to the owner. Do not retry with altered parameters, and do not improvise a
workaround.

- `ssh -G` does not resolve to `arm@209.38.87.252:22`, ssh reports a changed host key, or anything prompts
  for a password. `BatchMode` refuses the prompt; never accept a new key.
- The script hash or the repository commit differs from the approval.
- Any `STOP:` line. Exit 3 or 5 means the target is not the reviewed host or database, so nothing further
  is run.
- Exit 6. The production ledger has moved, so the accepted `a4641ca0…` shadow evidence no longer describes
  production. Report it; do not continue to any change list.
- Any command in the log appears to have changed host state. The script contains none; any sign of one is
  a stop.

A FINDING line is an observation, not a stop. Examples are Caddyfile or unit drift, a certificate inside
30 days, a missing backup timer or no off-host tool. Findings feed the change list.

## 4. What it does not do

It makes no write and runs no `sudo`. It does not start, stop, reload, enable or disable any unit. It runs
no `caddy` binary and makes no certificate, crontab, polkit, `.env` or backup change. It opens no dump and
reads no application table or log content. It takes no backup, runs no migration and makes no privilege
change. It does not touch streamanator or DEV.

Its only side effects are ordinary log lines:
- Caddy and app access-log entries from three HTTPS GETs and one direct health GET;
- TLS handshakes;
- one database connection named `afldb-v2-host-prereq-inspect` in the PostgreSQL log and `pg_stat_activity`.

## 5. Approval, ready to copy

Script `docs/v2/evidence/host-prerequisites/inspect-host-readonly.sh`, SHA-256
`345472b324638961b0249ade3aab025af895c3a962a9f127e460946656089046`.

```text
D-V2-HOST-INSPECT-1 — APPROVED: one read-only inspection of the production host afldb-prod
(arm@209.38.87.252, ssh alias afldb) for release gate 9, exactly as prepared in
docs/v2/host-prerequisites-inspection-2026-10-29.md §2, using
docs/v2/evidence/host-prerequisites/inspect-host-readonly.sh with SHA-256
345472b324638961b0249ade3aab025af895c3a962a9f127e460946656089046 from v2/rebuild commit <commit>.
Includes one read-only afldb_backup session (identity, extensions, database list, ledger digest).
Retain the log locally, and in the repository only after a sensitive-content check; record the findings
and a proposed host change list with recovery routes; commit locally.
Not approved: any host, Caddy, systemd, timer, polkit, certificate, crontab, .env, backup or database
change; sudo; starting, stopping, reloading, enabling or disabling anything; a backup; a push.
Stop at any §3 stop condition.
```
