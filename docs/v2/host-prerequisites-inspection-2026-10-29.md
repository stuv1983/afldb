# Host prerequisites (gate 9): read-only production-host inspection procedure

**Prepared 2026-10-29; revised and run 2026-10-29 under D-V2-HOST-INSPECT-1 with amendments (§6). Findings:
[host-prerequisites-findings-2026-10-29.md](host-prerequisites-findings-2026-10-29.md).** This is the first of two approvals for release
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
| H1 systemd | `afldb.service` properties (MainPID, start time, restarts, user, working directory, drop-ins) and the unit file hash against `deploy/afldb.service`. All `afldb*` unit files and timers. The active/enabled state of the settle, email, backup, Caddy and PostgreSQL units. Hashes of the AFL Tables timer and service against the repository. The polkit directory listing, or the fact that it cannot be read. Presence of any settle, AFL API, migrate, dump or restore process, as identity only (pid, user, elapsed seconds, executable name, systemd unit; never the command line). The deployed checkout, build id, tracked changes and Node runtime | A-GO restarts this unit; A-AFLT retires the timer and polkit rule; any unit drift must be known before the artifact lock |
| H2 Caddy | Caddy package version and unit (executable and `--config` path only from ExecStart); `/etc/caddy` listing; `/etc/caddy/Caddyfile` hash against `deploy/Caddyfile.production`, plus the **count** of differing lines; site addresses, handle matchers, proxy upstreams, root, file-server and log-output paths as allowlisted tokens for both files (no configuration line is printed); owner and mode of `/var/www/afldb-soon`; Caddy log file names (not their contents) | Traffic routing at A-GO, and the apex static path the app publishes to |
| H3 TLS | For `afldb.com`, `www.afldb.com` and `beta.afldb.com`: DNS, then certificate subject, issuer, validity dates, SHA-256 fingerprint and SANs through `127.0.0.1:443`, with days remaining. One HTTPS GET per site (`/`, or `/api/health` for beta) and the direct `127.0.0.1:3100/api/health`. Listening TCP ports | Certificate expiry and routing must not fail inside the window |
| H4 backup routing | `~/backups/afldb`: mode, entries, sizes and dates (no dump is opened); disk space on `/home/arm` and `/var/lib/postgresql`; backup timers; crontab as allowlisted schedule fields plus yes/no classes per entry (afldb, backup, dump, off-host tool), and the count of variable assignments (no command text or value); `/etc/cron.d` names; which off-host tools are installed; ssh `Host` aliases only; hashes of the deployed `backup.sh` and `restore-test.sh`; `.env` mode and key **names** only | A-BACKUP needs a non-pruning dump, an off-host copy and a proven restore. `backup-restore.md` §4 says no off-host copy exists yet |
| H5 database identity | As `afldb_backup` in four short read-only connections, one per query (identity first; any mismatch stops before the rest): database, OID, system identifier, owner, extensions, the list of non-template databases (whether `afldb_restore_test` exists), and the ledger row count, last name and digest. No application table is read | `restore-test.sh` requires `afldb_restore_test`. A ledger other than the reviewed 110 is release drift |

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
- four short read-only database connections, each named `afldb-v2-host-prereq-inspect`, in the PostgreSQL log
  and `pg_stat_activity`.

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

The hash above is the **original** prepared script. It was superseded before execution by §6.

## 6. Amendments and execution record (2026-10-29)

The owner approved D-V2-HOST-INSPECT-1 **with three bounded amendments** to the script, and authorised the
revised hash for those amendments only:

1. raw process command lines removed: presence and identity only (`proc_presence`);
2. full crontab output and the redacted Caddyfile `diff` replaced by allowlisted, non-secret observations
   (`caddy_structure`, the crontab schedule/class reduction, diff line counts, ExecStart reduced to its paths).
   No output relies on regex redaction;
3. the connection description corrected to **four** short read-only `afldb_backup` connections (identity,
   extensions, database list, ledger), identity first.

Every target, revision, ledger and stop-condition guard is unchanged; no query or inspection area was added.

| Item | Value |
|---|---|
| Base commit | `59d1727f726c500aa3f976c50605328ea805690c` |
| Revised script SHA-256 (LF, no BOM) | `8bbbc56fd24dd2472c9846bcaf944485f9933f9f414308f12d0799cf40b655f9` |
| Focused review | Diff removes exactly the four targeted outputs and the unused `REDACT`; H0, credential, identity, ledger and exit-code lines are byte-unchanged; no added command writes host state. Both extractors were run locally against hostile samples (Caddy basic_auth hash, bearer header, credentialed upstream, query-string root; crontab password assignments, DSN, rclone password, malformed line): zero secret tokens reached the output. `bash -n` clean. No unresolved safety issue |
| Execution | See the [findings record](host-prerequisites-findings-2026-10-29.md) |
