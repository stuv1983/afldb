# Host prerequisites (gate 9): read-only inspection findings and proposed host change list

**Production: NO-GO.** Executed once on 2026-10-29 under **D-V2-HOST-INSPECT-1 with amendments**
([procedure](host-prerequisites-inspection-2026-10-29.md), amendments §6). Nothing on the host was changed.
The change list in §4 is a **proposal for the second, separate approval (choice 6b)**. It grants nothing.

## 1. Execution record

| Item | Value |
|---|---|
| Base commit / script SHA-256 | `59d1727f726c500aa3f976c50605328ea805690c` / `8bbbc56fd24dd2472c9846bcaf944485f9933f9f414308f12d0799cf40b655f9` (revised, owner-authorised) |
| Local identity checks | `ssh -G afldb`: `hostname 209.38.87.252`, `user arm`, `port 22`; script hash and HEAD as above. BatchMode, no prompt, no host-key change |
| Run | 2026-10-29T00:14:55Z–00:14:57Z, once. **Exit 10** (complete, 2 FINDING lines); no `STOP:` line |
| Database access | Four short read-only `afldb_backup` connections (`afldb-v2-host-prereq-inspect`); identity first, all checks matched before the other three |
| Log | `C:\Users\stuar\backups\afldb\host-prereq-20261029T001446Z\inspect.log`, SHA-256 `f2948351a718b87bd9b2f44d96b84511fb2eed6c16c5d74464e2cbb8595ae0f7`, 19,511 bytes. Repository copy (byte-identical): [`inspect-20261029T001446Z.log`](evidence/host-prerequisites/inspect-20261029T001446Z.log) |
| Sensitive-content check | No `postgres://`, `postgresql://`, `BEGIN`, `PRIVATE` or `<redacted>`. The one `PASSWORD` match is the key **name** `AFLDB_SMTP_PASSWORD` on the names-only `env_keys` line; no value follows any name. Clean |
| Unavailable without sudo | `/etc/polkit-1/rules.d` (mode 750 `root:polkitd`): listing and rule hash not readable, recorded as unavailable. Nothing else was attempted |

## 2. Findings against the repository and the plan

| Area | Observation | Repository / plan expectation | Verdict |
|---|---|---|---|
| H0 identity | `afldb-prod`, `arm`, Ubuntu 24.04.4, kernel 6.8.0-137, boot `b77c04f1…`, up ~74 days; `209.38.87.252` bound locally | plan step 2 identity | **Match** |
| H1 app | checkout `ff100dc2…`, 0 tracked changes, build id `vcxM_SyDxFCP0sj9n9W1t`, Node v22.23.2 | deployed `ff100dc2…` | **Match** |
| H1 `afldb.service` | active/running since 2026-10-18 13:06 AEDT, enabled, `User=arm`, no drop-ins, unit hash = `deploy/afldb.service`; `NRestarts=4` | repository unit | **Match**; 4 automatic restarts before the current start (INFO; journal not read) |
| H1 AFL Tables settle | timer active/enabled; last run 2026-10-29 04:37 AEDT, next 2026-10-30 04:44. Timer hash = repository. **Service hash `f777395a…` = `deploy/afldb-settle-afltables.service` at `887263a5` (2026-09-02), not HEAD `ac8d6085…`** | repository unit | **F-2 drift**, functionally nil on this host (§3) |
| H1 other units | AFL API settle/brownlow, email-intake and backup units **not found**; caddy and `postgresql@16-main` active/enabled | C3 not installed; email intake absent (plan step 5 "currently absent") | **Match** |
| H1 processes | settle, AFL API, migrate, pg_dump, pg_restore: count 0 each | no active settle or migration | **Match** |
| H1 polkit | not readable without sudo | known limitation (plan: "inaccessible polkit content remains a later retirement limitation") | **Unavailable** |
| H2 Caddy | 2.11.4 (dpkg), `/usr/bin/caddy --config /etc/caddy/Caddyfile`, running since 2026-08-16, never restarted. **Live Caddyfile `4f6972ec…` = `deploy/Caddyfile.production` at `b2a21c56` (2026-08-16)**; 1 line only in live, 3 only in the repository. Allowlisted structure identical for both files: beta → `127.0.0.1:3100`; www (redirect); apex `handle /api/early-access*` → `127.0.0.1:3100`, `handle` → `root * /var/www/afldb-soon` + `file_server`; logs `afldb-access.log`, `afldb-apex.log` | repository `65478a23…` | **F-1 drift** (§3) |
| H2 apex static | `/var/www/afldb-soon` `arm:caddy 750`, 8 entries (index, app.js, style.css, robots, sitemap, favicon, img/) | apex publisher target (`AFLDB_APEX_DIR` is set) | **Match** |
| H3 TLS | Let's Encrypt, single-SAN each: afldb.com to 2027-01-13 (76 days), www to 2027-01-12 (75), beta to 2027-01-12 (75) | > 30 days | **Match**. Caddy renews automatically about 30 days before expiry |
| H3 routing | apex `/` 200; www 301 → `https://afldb.com/`; beta `/api/health` 200; direct `127.0.0.1:3100/api/health` 200 `{"status":"ok","database":"ok"}` | Caddyfile | **Match** |
| H3 listeners | public `:80`, `:443`, `:22`; loopback only for 3100, 5432, 2019 (Caddy admin), 53 | app and PostgreSQL loopback only | **Match** |
| H3 DNS | all three names → `104.21.25.194`, `172.67.134.128` | not recorded in any deploy record | **F-3** (§3) |
| H4 backups | `~/backups/afldb` `700 arm:arm`, 329 MB; 11 top-level `afldb_prod-*.dump` (2026-09-03 → 09-28, including `pre-admin-centre`), retained evidence directories including `current-shadow-20261028T192336Z` | `backup-restore.md` §3 | Present. **F-4** pruning hazard (§3) |
| H4 scheduling | no backup timer (only `dpkg-db-backup.timer`); no user crontab (rc=1); `/etc/cron.d`: e2scrub_all, sysstat | — | No scheduled database backup |
| H4 off-host | only `rsync` installed (no rclone, restic, borg, aws, s3cmd, gsutil); no rclone config; one ssh `Host` alias (`github.com-afldb-deploy`) | `backup-restore.md` §4: no off-host copy yet | **Confirmed: no off-host route on the host** (P3) |
| H4 scripts | deployed `backup.sh` `776d066e…`, `restore-test.sh` `270adda8…` | equal to the repository at both `ff100dc2` and HEAD | **Match** |
| H4 disk / `.env` | `/` 82.1 GB, 61.2 GB free (PostgreSQL on the same filesystem); `.env` `600 arm:arm`, 26 key names | — | Sufficient; names only |
| H5 database | `afldb_prod`, OID 66668, sysid `7674454702926115004`, owner `afldb_owner`, PostgreSQL 16.15, read-only session, not superuser; extensions `pg_trgm=1.6 plpgsql=1.0 unaccent=1.1` | reviewed identity | **Match** |
| H5 catalog | `afldb_restore_test` **exists**; also retained `afldb_prod_auth_recovery`, two `afldb_prod_candidate_*`, two `afldb_prod_pre_rebuild_*` | `restore-test.sh` prerequisite | **Met** |
| H5 ledger | 110 rows, last `110_match_sheet_player_match_stats_authority.sql`, digest `789946fe…` | reviewed 110 baseline | **Match: no release drift** |

## 3. Findings that need a decision

- **F-1 Caddyfile drift (Medium, hardening).** Exact content is known without reading the host, because the live
  file is byte-equal to the repository version at `b2a21c56`. The only difference from HEAD is `3ae20fe4`
  (2026-08-20, "address application and infrastructure audit findings"): on `beta.afldb.com` the proxy itself does
  not send `Strict-Transport-Security "max-age=31536000; includeSubDomains"` or the application CSP, and a comment
  differs. Application responses already carry both from Next.js. Proxy-generated responses (errors, health-check
  failures) do not. This is not a V2 change: the repository file is identical at `ff100dc2` and the candidate.
- **F-2 settle service unit drift (Low, nil effect here).** Live = `887263a5`. HEAD adds only comments and one
  `UnsetEnvironment` name (`AFLDB_DEV_DATABASE_URL`), which is not in production `.env`. A-AFLT disables this unit
  in any case, so no host change is proposed.
- **F-3 hostnames resolve through Cloudflare (Medium, pre-existing; consequence inferred, not verified).** The
  answers are in Cloudflare's anycast ranges, and ISSUE-169 already records "Cloudflare → Caddy → Node". The
  Caddyfile sets `header_up X-Forwarded-For {remote_host}` with no `trusted_proxies`, so `{remote_host}` is a
  Cloudflare edge address. The application therefore records edge addresses, not client addresses, in
  `auth_sessions` / `auth_audit_log`, and the early-access rate limit keys on them. This inspection read no table
  or log to confirm it. Confirmation would need a separately approved read of recent recorded addresses. A fix
  (`trusted_proxies` with Cloudflare's published ranges and `{client_ip}`) changes `deploy/Caddyfile.production`
  and the static deployment-contract suite, which asserts "no `trusted_proxies`". It is therefore an artifact
  change. **Proposed:** confirm it, then track it as its own issue. It is not part of this release, because V2
  neither causes nor changes it.
- **F-4 `backup.sh` would prune release-relevant dumps (High for A-BACKUP procedure).** `backup.sh` prunes
  `afldb_prod-*.dump` to the newest `--keep` (default 7, minimum 1). There are 11 matches now. A default run in the
  window would delete the five oldest (2026-09-03, 09-04 ×2, 09-07 and 09-08, the last two being the
  promotion/pre-rebuild baselines). A-BACKUP must therefore not run it with defaults. See HC-3.
- **F-5 the AFL Tables timer still acquires nightly** (last 04:37 today) under `ff100dc2`, where the switch is
  still active. Every run between now and the window can move production away from the accepted `a4641ca0…`
  shadow, and the window stops on any drift (choice 8). This is an argument for executing A-AFLT early; see §6.

## 4. Proposed host change list (for choice 6b; nothing here is approved)

Each change is separately approvable. "Verify" is read-only. Every `sudo` step is the owner's own execution.

| # | Change | When | Steps | Verify | Recovery route |
|---|---|---|---|---|---|
| HC-1 | Install the repository `deploy/Caddyfile.production` (`65478a23…`) to correct F-1 | Any time before A-GO, independent of the artifact lock | `sudo cp -p /etc/caddy/Caddyfile /etc/caddy/Caddyfile.pre-hc1-<STAMP>`; copy the repository file (LF) to `/etc/caddy/Caddyfile`; `sudo caddy validate --config /etc/caddy/Caddyfile`; `sudo systemctl reload caddy` | live hash `65478a23…`; caddy active; the three HTTPS GETs and the direct health GET as in this inspection; `Strict-Transport-Security` present on a beta response | `sudo cp -p /etc/caddy/Caddyfile.pre-hc1-<STAMP> /etc/caddy/Caddyfile`, validate, reload, verify hash `4f6972ec…`. **Limit:** HSTS already received by a browser for `beta.afldb.com` cannot be withdrawn by a revert (max-age one year). Beta is HTTPS-only already, so this is accepted rather than avoided. If it is not acceptable, decline HC-1 and record F-1 as a known residual |
| HC-2 | Read the AFL Tables polkit rule (name and SHA-256) before retiring it | Inside A-AFLT (choice 7), immediately before retirement | `sudo ls -la /etc/polkit-1/rules.d`; `sudo sha256sum` of the `*afldb*` rule; compare with `deploy/afldb-settle-afltables-trigger.rules` (`3164e0d9…`); keep a root-owned copy before removal | rule absent after retirement; `legacy-writers` PASS | Restore the kept copy to `rules.d` with its original owner and mode. polkit re-reads rule files on change. Then re-verify the hash |
| HC-3 | A-BACKUP without pruning (F-4) | In the window (choice 8) | Run `backup.sh --dir ~/backups/afldb/release-v2-<STAMP> --keep 999`. `--dir` overrides `AFLDB_BACKUP_DIR` (`backup.sh` line 47), and the script creates the directory with mode 700. The existing series is then outside the prune glob, and `--keep 999` is a second guard | file count of the existing series unchanged (11) before and after; the new dump's `pg_restore --list` check passes; SHA-256 recorded | Nothing is deleted, so there is nothing to recover. A failed dump leaves only its own directory, which is removed by the owner |
| HC-4 | Off-host copy (P3): **no host change**. Pull to the workstation over the existing `afldb` ssh identity, with the proven `current-production-shadow/transfer.ps1` pattern (SHA-256 verified on both ends) | In the window, after HC-3 | — | SHA-256 equal on both ends | Read-only pull; nothing to recover. Retention and any second destination remain the P3 decision |
| HC-5 | Proven restore uses the existing `afldb_restore_test` (present) through `restore-test.sh` (deployed = repository) | In the window | as `backup-restore.md` §3 | restore-test PASS on the frozen dump | `afldb_restore_test` is disposable by design |

Not proposed: any change to `afldb.service` (matches), the settle unit (F-2, retired by A-AFLT), certificates
(75+ days, renewed automatically), the retained database copies or old dumps (a retention decision, not a release
prerequisite), or the Cloudflare configuration (F-3, separate issue).

## 5. Hostname recommendation (P1)

**Recommendation: V2 serves at `beta.afldb.com` at A-GO, with Caddy routing unchanged. The apex launch is a
separate, later decision.**

Evidence from this inspection:
- the beta route already proxies to `127.0.0.1:3100` with a valid certificate to 2027-01-12, and `/api/health`
  answers 200 through Caddy and directly. A-GO is then an artifact install and service restart, with no proxy
  change in the window;
- the apex currently serves the static coming-soon page from `/var/www/afldb-soon`, which the running app
  publishes (`AFLDB_APEX_DIR` set). It is indexable and carries the hostname's search history, and `www`
  redirects to it;
- `AFLDB_INDEXING` is not set on the host, so the app is noindex. An apex launch would also change `.env`
  (`AFLDB_INDEXING`, `AFLDB_BASE_URL`, the beta gate), remove the beta `X-Robots-Tag`, start the apex HSTS ramp,
  and edit the tracked `deploy/Caddyfile.production` (the "AT LAUNCH" step). That puts a tracked-file change into
  the locked artifact and a second failure and rollback domain into the window. A Caddy revert does not undo
  search-engine or HSTS effects;
- F-3 (client addresses behind Cloudflare) should be settled before the apex takes public authenticated traffic.

Consequence: no tracked file changes for P1, so P1 does not delay or re-open the lock. HC-1 is optional and does
not touch the artifact.

## 6. Release ordering clarification (P2)

**No stage A or B step waits for 2027 data.** The existing record is the
[release decision package](release-decision-package-2026-10-28.md) §1: *"2027 evidence blocks rows 11 and 12 only.
It does not block A, B, the A-AFLT retirement or the C3 inert install."* 2027 evidence gates only C4/C4b/C5 and
ISSUE-229 B2 (choices 12–13), which are writer activations after installation.

The one remaining ISSUE-316 ordering constraint on A/B is **A-AFLT before schema and code**. It is governed by
[plan](production-release-plan-2026-10-21.md) **step 5** ("After C2's verified final acquisition and the separate
A-AFLT decision, disable the AFL Tables timer and retire its exact discovered polkit rule"), with plan step 4's
"do not deploy V2 and then attempt C2 through its stub". The route between the two alternatives is the
**RISK-27** owner choice ([risk register](risk-register.md)). Current state resolves both halves of P2 on the
record:
- **The D-316-1 final acquisition is done.** The 2026 final core and ladder snapshots were extracted 2026-10-21
  (`c2-2026-final-core-v1`, `c2-2026-final-ladder-v1`). The rollover (switch `retired`, decision D-316-1,
  2026 sealed, 2027 in progress) was activated (D-316-ACT-C-20261028) and integrated into `v2/rebuild` on
  2026-10-28 (`c7e17da2`, `1a6de4b6`, `955d0e85`). RISK-27's second route, "A-AFLT with the 2026 final acquisition
  done first", is therefore available now. Its first route, "release after C5", is the only one that would import
  a 2027 wait, and **should be withdrawn**;
- **C2 no longer changes a tracked file of the candidate.** Its six-file (in practice eight-path) change is
  already in the candidate, so the lock (choice 3) need not wait for C2 or be re-opened by it.

Clarified order: run a ✓ (done), then c ✓ (done), then P1 (beta; §5), then b (visual), then **e (lock)**. **f**
(HC-1, if wanted) can come any time before A-GO. **g A-AFLT** follows the RISK-27 choice stated in its approval;
executing it early also stops F-5 drift. Then **h** (window: HC-3 to HC-5), then i.

## 7. Not done, unchanged

No host, Caddy, systemd, timer, polkit, certificate, crontab, `.env`, backup or database change; no sudo; no
start, stop, reload, enable or disable; no backup; no table or log content read; no push, merge, build or
deployment; no Brownlow operation. Production stays NO-GO; privileges stay 42/43 (not waived); EXEC, frozen P/H and
the original evidence are unchanged; source ISSUE-327 stays parked.
