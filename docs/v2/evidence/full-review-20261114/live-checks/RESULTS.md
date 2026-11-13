# Live read-only checks — full review 2026-11-14

All checks read-only. Production: Windows OpenSSH to `afldb` (host `afldb-prod`), one SSH session per script, no `sudo`,
`release.mjs status` run **without** `--expect` (which would append a `status-pass` event). Database sessions used the
host's backup DSN read on the host and never printed, `default_transaction_read_only`, `REPEATABLE READ READ ONLY`,
`TimeZone=Etc/UTC`, and asserted identity before any read: `afldb_prod`, OID 66668, system identifier
`7674454702926115004`, `transaction_read_only = on`. Only aggregates were returned. Scripts: this directory.
DEV: streamanator, read-only `systemctl show`/`git status`.

## Identity (2026-11-14 06:39–06:55 AEDT)

| Target | Observation |
|---|---|
| Production release | `current` → `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x` (revision `c1c4b22ee15007111eab66f6d354e0b9ecbb2ade`); `previous` → `0f251c2daa8d-3t0xWKI76Jgna2tB8a9oN`; no release lock; unit process cwd = the `current` release; unit log line "serving build bTVyci1eHVcKvSKDVZl_x release c1c4b22ee150-… revision c1c4b22e…" at 06:35:21 |
| Production DB | `afldb_prod`, ledger `118_fixtures_unconfirmed_participants.sql`, read-only verified |
| Production timers | `afldb-settle-afl-api.timer` enabled (last 2026-11-14 05:14:45, next 2026-11-15 05:13:03); Brownlow and AFL Tables timers disabled; email-intake timer not installed |
| DEV | `/home/arm/projects/afldb` HEAD `8b024098a6771fc5e5be2f8bf006c9c3ca8ab55a` on `dev-v2-main`, no tracked modification (10 untracked: 9 settle manifests and `.env.bak-issue272-u1b-20261010-191158`), `.next/BUILD_ID` `AlYJjIargpO5esTkTX_zq` (2026-11-07); `afldb` MainPID 1732 since 03:01:41 AEDT (host booted 03:01:21); unchanged at the end of the review |

## Findings evidence

| Ref | Result |
|---|---|
| LIVE-OPS-1 (ISSUE-351) | `unattended-upgrade` upgraded libc6 06:35:01–06:35:14 AEDT (`/var/log/apt/history.log`); `afldb` primary SIGTERM 06:35:16, new MainPID 3774230 (was 3666648 at Step G), `NRestarts=0`; `postgresql@16-main` ActiveEnterTimestamp 06:35:19 AEDT. `apt-daily-upgrade.timer` `OnCalendar=*-*-* 6:00`, `RandomizedDelaySec=60m`, enabled; `unattended-upgrades` enabled, `APT::Periodic::Unattended-Upgrade "1"`; no `Automatic-Reboot` setting; `needrestart` 3.6-7ubuntu4.5 installed. Kernel 6.8.0-137 running, `/var/run/reboot-required` present, uptime since 2026-08-16. `arm` cannot read the system journal or the unattended-upgrades log, so the restart is attributed by timing, not by a needrestart log line. |
| OPS-2 (ISSUE-352) | No backup/restore timer (only the OS `dpkg-db-backup.timer`); no `arm` crontab backup line; no `/etc/cron.d` or `cron.daily` backup entry (root crontab not readable). Newest entries in `~/backups/afldb`: `gap029-I336-20261112T025001Z`, `gap029-I336-20261112T010605Z`, `issue333-o2-20261104T021037Z` (per-operation only). |
| ING-1 (ISSUE-350) | `seasons` ≥ 2025: 2025 complete, 2026 complete, **no 2027**. `fixtures` season 2027: 218. Current AFL clubs: `last_season = 2026` 18, open 0. |
| ING-2 (ISSUE-348) | `draft_picks` with source `draftguru`: 6,845. DraftGuru `draft_persons` with no `external_identities` row: 31. |
| ADM-1 (ISSUE-353) | Orphans: `brownlow_round_votes` 0, `player_achievements` 0, `after_siren_kicks` 0 (latent). |
| ADM-2 (ISSUE-354) | Inactive coach/draft overrides 0; coaches with a retire then a later edit 0 (latent). |
| SRCH-1 (ISSUE-355) | `site_settings` `grid_solver.audience` = `"super_admin"`. |
| SRCH-2/3/4 (ISSUE-356) | `nl_search_log`: 54 questions since 2026-09-02; bare "least" 0, "a quarter" 0, ranked marquee 0 (latent). |
| SEC-1 (ISSUE-362) | Caddy v2.11.4; `/var/log/caddy/afldb-access.log` and `afldb-apex.log` are `caddy:caddy 600` (not readable by `arm`; token counts not measured); installed `/etc/caddy/Caddyfile` carries the same unfiltered `log` blocks and the "Query strings stay out of the logs" comment. |
| FE-1 (ISSUE-357) | Serving release ISR tree `.next/standalone/.next/server/app`: 767 MB, 11,052 files; root filesystem 77 GB, 45 GB free. Non-canonical season/match cache entries 0; cached 404 metas 2 (latent). |
| FE-3 (ISSUE-359) | AFLW `players.slug` containing `%`: 17 of 960. |

One malformed query (a `LIKE '%\%%'` whose backslash a JS template literal removed, so it matched all 960 rows) was
discarded and re-run with `strpos(slug, chr(37))`; only the re-run is reported.
