# Procedure 06: Caddy access-log redaction and the pre-fix logs (ISSUE-362: O-3 install, then O-1 old logs)

> **Orchestrator note (run 2 integration, review REVIEW-C MED-2):** the candidate `deploy/Caddyfile.production`
> (sha256 `5078bc975a2128d32a09b07887420ec06bc919e66fc3978ddbfcf53e109eed5e`) carries three changes: the ISSUE-362 log
> filter, the beta-host HSTS/CSP headers the installed file lacks, and the ISSUE-357 path-shape deny. **The single
> install procedure (O-3 + ISSUE-357 O-1) is `run2/caddy357/README.md` §10** (one backup name, prerequisites, validate
> as `caddy`, one owner reload, every probe, one rollback). Do not install with §2 below on its own. §1 facts and §3
> (pre-fix logs, O-1 of ISSUE-362) remain this procedure's content and run after §10 succeeds.

Status: **procedure, not executed; the Caddyfile is PREPARED, NOT INSTALLED.** Author: scope `ops`, remediation run 2.
**Pending combination:** the ISSUE-357 path-shape deny (`run2/caddy357/README.md`, scope `caddy357`, not yet read by this scope) will be
merged into the same `deploy/Caddyfile.production` by the orchestrator. Until that file is final, the commands below name
`deploy/Caddyfile.production` generically and the 357 steps (its own validation and probes) are **not described here**.
Canonical: `docs/v2/evidence/remediation-20261114/auth/README.md` (SEC-1, O-1, O-3). Evidence: `raw/prod-ro-ops-notify-logs.txt`,
`raw/prod-caddyfile-installed.txt`, `raw/prod-ro-ops-logs2.txt` (configuration and file metadata only; **no log was opened by this scope**).

## 1. Facts (read-only, 2026-11-14)

- Caddy **2.11.4**, `caddy.service` runs as `caddy:caddy`, `ExecStart=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile`,
  `ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force`, `ProtectSystem=full`. No unit drop-in directory.
- `/etc/caddy/Caddyfile`: `root:root 0644`, 7,807 bytes, written 2026-08-16 18:46, sha256
  `4f6972ec119f5d33fff4c16cbbce15c50a36b883654dcffcabdb01776d7af036`.
- **The installed file is NOT the repository's `deploy/Caddyfile.production` at `c1c4b22e`.** It lacks two header lines added to the repo on
  2026-08-20 (commit `3ae20fe4`): `Strict-Transport-Security "max-age=31536000; includeSubDomains"` and a `Content-Security-Policy` on the beta
  host block (otherwise equal, modulo one comment). **Installing the candidate file therefore also changes response headers on the beta host,
  not only the log format.** The Caddy CSP equals the application's own production policy (`next.config.ts:43-48`, `script-src 'self'
  'unsafe-inline'`), and HSTS is also set by the application in production, so the expected effect is small; it is nevertheless an
  unreviewed behaviour change travelling under a logging label: the approval text must say so and the post-install smoke must include a
  full page load and a header check.
- Logs: `/var/log/caddy` is `caddy:caddy 0755`; every file `caddy:caddy 0600`. `afldb-access.log` 18.0 MB (live, mtime 2026-11-14 12:56 AEDT)
  and five rolled `.log.gz` (about 1.1 MB each, 2026-09-04 to 2026-11-02); `afldb-apex.log` 15.6 MB and three rolled (2026-09-09 to 2026-10-21).
  Rotation is **Caddy's own** (`roll_size 20MiB`, `roll_keep 5`, no `roll_keep_for` set); **there is no `/etc/logrotate.d/caddy`**.
  Retention is therefore by count and by Caddy's default age limit (`roll_keep_for` documented default 90 days; **not re-verified in this
  run**: the documentation tool was unavailable), not by a policy anyone chose.
- Caddy already writes `Cookie`, `Set-Cookie` and `Authorization` as `REDACTED` (auth README: "Cookie stays REDACTED"); what the old logs
  hold is the full request URI and Referer: magic-link tokens (valid **30 minutes**, single use, stored hashed:
  `src/app/beta/actions.ts:123-124`), admin invite tokens (valid **7 days**, single use, hashed: `INVITE_TTL_DAYS = 7`), search and other query
  text, and client IPs.

## 2. Install the filter (O-3)

Purpose: stop writing tokens and query text, as the filter proven on real Caddy 2.11.4 and 2.11.9 with the admin endpoint off (auth README).
Prerequisites: the published candidate's `deploy/Caddyfile.production` (final, after the 357 merge) at a verified sha256; console or SSH access;
the owner's `sudo`; an attended window (a reload does not restart Caddy; in-flight requests complete).
Roles: owner with `sudo` for everything touching `/etc/caddy` and the log files; `arm` can neither read nor write them.

```
# 1. back up and record what is installed (root-owned dir, 0755; arm can read the Caddyfile)
sha256sum /etc/caddy/Caddyfile    # expect 4f6972ec119f5d33fff4c16cbbce15c50a36b883654dcffcabdb01776d7af036; if not, STOP: it changed since 2026-11-14
sudo cp -p /etc/caddy/Caddyfile /etc/caddy/Caddyfile.pre-i362
# 2. install the repository file (verify its sha256 against git first)
sudo install -m 0644 -o root -g root deploy/Caddyfile.production /etc/caddy/Caddyfile
# 3. validate as the service user, so nothing it creates is root-owned
sudo -u caddy /usr/bin/caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
ls -l /var/log/caddy                                            # afterwards: every file still caddy:caddy 0600; none root-owned
# 4. reload (no restart)
sudo systemctl reload caddy
# 5. probe: a request that carries a fake token, then read ONLY the uri field of the newest line
curl -s -o /dev/null "https://beta.afldb.com/beta/verify?token=PROBE-i362-$(date +%s)"
sudo tail -n 3 /var/log/caddy/afldb-access.log | grep -o '"uri":"[^"]*"'    # expect "/beta/verify" with no query
curl -sI https://beta.afldb.com/ | grep -iE '^(strict-transport|content-security|x-frame)'   # the headers this install also changes
```

Note step 3: the approval packet's `sudo caddy validate` runs as root. If a log file were ever missing, a root-run validate could create it as
`root:root` and Caddy (user `caddy`) could then not write it. The files exist today, so the risk is low; the `caddy`-user form is safer;
if it is refused for storage-permission reasons, root is acceptable only with the `ls -l` check above. **Neither form was run here.**

**Validation.** The probe shows the redacted URI; `/beta/verify` still admits a real magic link (a real link click after the install, owner's
test account); an invite link still works (`/admin/invite/<token>` page loads; the log line shows `/admin/invite/REDACTED`); the apex serves; the
public smoke passes with a full page render (CSP unchanged in effect); `systemctl status caddy` active; the journal has no `Unknown key`,
`unrecognized` or `ERROR` line from the reload (owner reads it).
**Failure handling.** `validate` fails: change nothing, restore step 1's copy (`sudo cp -p /etc/caddy/Caddyfile.pre-i362 /etc/caddy/Caddyfile`), no reload. Reload fails or
the site misbehaves: restore the copy and `sudo systemctl reload caddy`; if reload itself is refused, `sudo systemctl restart caddy` (seconds of public outage).
**Recovery.** The `.pre-i362` copy; no data is involved.

## 3. The pre-fix logs (O-1): proposal for the owner

What exists: eight rolled `.gz` files (all older than 12 days) and two live files (access from about 2026-11-02, apex from about 2026-10-21 by their last
rotations). Because magic links live 30 minutes and invites 7 days, **every token in a file older than 7 days is already dead**; the only live
credential exposure is an *unredeemed, unrevoked, unexpired invite* whose link was logged in the last 7 days, plus the permanent exposure of query
text and IPs (personal data, not credentials).

Access today: `0600 caddy:caddy` files in a `0755` directory (names and sizes visible to every local user, content to root and `caddy` only). Tightening
the mode gains nothing for content; making the directory `0750` hides names only.

| Option | What | Effect and consequence |
|---|---|---|
| a. Leave | nothing | tokens older than 7 days are dead; query text and IPs stay, rotated out by Caddy's count and age limits (up to about 3 more months at current volume); zero effort; the live files keep accruing until the new filter replaces them (after install only new lines are redacted) |
| b. Delete rolled files now; truncate the live ones after the install | `sudo rm -- /var/log/caddy/afldb-access-2026-*.log.gz /var/log/caddy/afldb-apex-2026-*.log.gz`; then `sudo truncate -s 0 /var/log/caddy/afldb-access.log /var/log/caddy/afldb-apex.log` | removes the history; irreversible; loses the only pre-install access history (forensics, traffic review). `truncate` is safe only if Caddy opened the files append-only (believed; **not verified**); if in doubt use option c |
| c. Roll and delete with a Caddy restart | `sudo systemctl restart caddy` after moving the live files aside | guaranteed fresh writers; a seconds-long public outage; same loss as b |
| d. Archive encrypted, then delete | `gpg --symmetric` (installed) of the rolled files, copy to the owner host, delete on the droplet | keeps forensic value; the exposure moves to an encrypted blob whose passphrase the owner must guard |
| e. Shorten future retention | add `roll_keep_for 168h` (7 days) inside both `output file` blocks and `roll_keep 2` | future logs expire after the invite window; **a change to the Caddyfile owned by scope `caddy357`**: for the orchestrator's combined file; less access history for operations |

**Recommendation: b after the install**, in this order: (1) install and verify the filter (§2); (2) check there is no live invite exposure with a
read-only aggregate as `afldb_backup` (note: the ledger and packet say `auth_invites`; **the table is `admin_invites`**):
`SELECT count(*) FROM admin_invites WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > now();`, and if the count is not 0, revoke those invites
in the admin UI or wait for expiry; (3) delete the rolled files and truncate the live files; (4) optionally adopt (e) in the combined Caddyfile.
Choose **d** instead of b if the owner wants the access history for any incident review. `rm`/`truncate` on this ext4 volume do not scrub blocks;
secure erasure is not claimed. The droplet's own backups or snapshots (if the owner has any enabled in the DigitalOcean panel: **unverified**) may retain
copies of these files outside this procedure's reach.

## 4. Other log classes holding query text or tokens (configuration and permissions only; no content read)

| Class | Where and who can read | Retention | Note |
|---|---|---|---|
| Application service log | `afldb` stdout/stderr go to the journal (`StandardOutput=journal`) and, because `ForwardToSyslog=yes` is the default, to `/var/log/syslog` (`syslog:adm 0640`); the journal is persistent (`/var/log/journal`) and root/`systemd-journal` only | syslog: weekly, 4 rotations; journal: no time limit configured, bounded by journald's default size cap | With SMTP configured (`AFLDB_SMTP_*` keys present, names only) a magic link is emailed, **not** logged; without it the link is logged to the journal (`docs/admin-and-beta.md` §3). The application's other log lines were not inspected |
| PostgreSQL log | `/var/log/postgresql/postgresql-16-main.log*` `postgres:adm 0640`; `log_line_prefix '%m [%p] %q%u@%d '`; `log_statement` not set (default `none`) | weekly, 10 rotations, `copytruncate` | statements are logged only when they fail (default `log_min_error_statement`), and the DETAIL may carry bound parameters: query text and values of a failing statement can appear. `arm` cannot read it |
| `auth.log` | `syslog:adm 0640` | weekly, 4 | ssh logins, sudo use; no application data |
| Caddy default/error log (the global log) | stderr to the journal | as the journal | carried the full request URI when the upstream was down (every release restart); the candidate's global log block filters it (auth README) |

Recommendation: no change now; revisit the journal retention (`MaxRetentionSec`, owner `sudo`) and the PostgreSQL parameter logging only if the owner wants a
tighter posture. Nothing in this procedure changes them.

## 5. Unverified

`roll_keep_for` default and the exact append-mode behaviour of Caddy's writer; whether `caddy reload` re-opens the existing files; root-only content
of any log; DigitalOcean backup/snapshot settings; the effect of the added HSTS/CSP on the beta host (analysis only: policies equal); the 357 merge.
