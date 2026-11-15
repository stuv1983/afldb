# B0 — read-only production probe, 2026-11-15 (owner-approved; run 5 finalisation)

**Approval:** owner, 2026-11-15, "one narrowly scoped read-only production probe, performed by Claude under the existing identity and
read-only safeguards", Windows OpenSSH. **Executed:** 2026-11-15 20:19:12–20:19:13 AEDT (09:19:12Z), one session
(`C:\Windows\System32\OpenSSH\ssh.exe afldb bash -s`, script on stdin, nothing written on the host), by Claude (main session).
Script: `b0-prod-probe.sh`; raw output: `b0-prod-probe.result.txt` (aggregates only; no credential printed; DSN read on the host).
No sudo. No write: `events.log` 33 lines before and after; `git --no-optional-locks status`; `release.mjs status` without `--expect`; the
database session ran `REPEATABLE READ READ ONLY` with `default_transaction_read_only`, after asserting `afldb_prod`, OID 66668, system
identifier `7674454702926115004`, `transaction_read_only = on` (role `afldb_backup`).

## 1. Pins (all equal to the run-2 values; nothing moved)

| Pin | Read 2026-11-15 20:19 AEDT | Run-2 value | |
|---|---|---|---|
| serving release `current` | `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x` (revision `c1c4b22ee15007111eab66f6d354e0b9ecbb2ade`, built 2026-11-11T05:15:00Z) | same | = |
| `previous` | `0f251c2daa8d-3t0xWKI76Jgna2tB8a9oN` | same | = |
| serving checkout `~/projects/afldb` | `main` at `c1c4b22ee150…`, 0 porcelain lines | same | = |
| `release.mjs status` | STATUS PASS; process 3774230 runs in the `current` release; health 200 `ok`/`ok`; current `_buildManifest.js` 200, previous 404 (expected) | — | |
| `afldb.service` | active, MainPID 3774230, NRestarts 0, ActiveEnter Sat 2026-11-14 06:35:21 AEDT (the libc6 needrestart restart, ISSUE-351) | same | = |
| `postgresql@16-main` | active, MainPID 3774184, ActiveEnter 2026-11-14 06:35:19 AEDT; PostgreSQL 16.15 | — | |
| local health | `127.0.0.1:3100/api/health` 200 `{"status":"ok","database":"ok"}` | — | |
| Caddyfile sha256 | `4f6972ec119f5d33fff4c16cbbce15c50a36b883654dcffcabdb01776d7af036` | same | = |
| kernel | running 6.8.0-137; `reboot-required` present (pending kernels now up to 6.8.0-149 and libc6) | 137 / present | = |
| needrestart hold / apt 52 | both **absent** (B4 not installed) | absent | = |
| database | `afldb_prod`, OID 66668, sysid `7674454702926115004` | same | = |
| migration ledger | head `118_fixtures_unconfirmed_participants.sql`, 118 applied | 118 | = |
| `AFLDB_BETA_EPOCH` | 1 | 1 | = |
| seasons | 2025 `complete`, 2026 `complete`, **no 2027 row** (ISSUE-350 still open) | 2027 NOT_OPEN | = |
| releases retained | 8 release directories; last builds 2026-11-05 (4 min 51 s) and 2026-11-11 (4 min 27 s) | — | |

The candidate changes nothing that `release.mjs` treats as schema: no file under `src/db/migrations/` changed between the serving revision
`c1c4b22e` and the candidate, and `package-lock.json` is unchanged (`package.json` gains one script line), so B1 needs no `npm ci` of the
serving checkout's dependencies. `c1c4b22e` is an ancestor of `origin/main` `de640826`, which is an ancestor of the candidate.

## 2. ISSUE-365 on production: PRESENT (player-season rows only)

| Read | Value |
|---|---|
| `stat_availability` 2026 `brownlow_match_votes` / `brownlow_round_votes` / `brownlow_season_total` | `pending` / `pending` / `pending`, all `is_recorded = false`, populated/total NULL |
| `player_season_stats` 2026 `brownlow_status` | **669 × `not_applicable`** (all rows), `brownlow_votes` non-null 0 |
| `player_season_stats` 2025 | 668 × `complete` |
| 2026 `brownlow_season_votes` (medal results) | 0 |
| 2026 `brownlow_round_votes` | 9,522 rows; `brownlow_vote_entry_state` 1 row; `player_match_stats.brownlow_votes` non-null 0; 207 home-and-away matches |
| Brownlow `not_applicable` coverage rows, seasons ≥ 1924 outside 1942–1945 | 0 |
| Same, 1942–1945 | 12 (3 keys × 4 seasons, as expected) |
| `player_season_stats` `not_applicable`, seasons ≥ 1924 outside 1942–1945 | **2026 only: 669** |
| `player_season_stats` `not_applicable` in the declared seasons (1897–1923, 1942–1945) | 9,553 (expected) |

This is exactly the 4 Nov snapshot's state (`run4/brownlow/raw/repair2026.txt`, `snap` BEFORE line), so the snapshot dry run of the
repair is a faithful rehearsal of production for this season.

**Consequences, today, on production:**
- Every 2026 player-season Brownlow cell renders `formatBrownlow` "No medal", and `brownlowStatusNote` "No Brownlow Medal was awarded for this
  season." (`src/lib/format.ts:43,57`) on `/players/[slug]` and anything else projecting `player_season_stats.brownlow_status` for 2026: a false
  public statement for a completed season whose results are simply not loaded.
- Brownlow **admin is NOT locked** for 2026: the lock reads the `brownlow_season_total` coverage row (`src/db/queries/admin-brownlow.ts:723,1317`),
  which reads `pending`.
- No other season is affected (the outside-declared counts above are 0 except 2026).
- It is stable: the nightly settle is a no-op out of season (no in-progress season in `data/reference/seasons.json`; the 05:13:35 run took 2 s).
  Any recompute of 2026 (a 2026 match edit, a Brownlow admin action) would already rewrite the rows to `pending`, because
  `recomputeSeasonBrownlowStatus` follows the `pending` coverage row; that function is unchanged between `c1c4b22e` and the candidate.
- What deploying B1 does NOT do: repair these rows. D-365-1 only stops `recomputeBrownlowCoverage` from writing new `not_applicable`.

Repair path, if approved (B1a): **step (b) only** — no coverage row reads `not_applicable`, so `recomputeBrownlowCoverage` does not run. See `b1a/README.md`.

## 3. Timers and scheduled activity relevant to an attended release (host time AEDT, Australia/Melbourne)

| Unit | State | Schedule (installed unit) | Last / next | Relevance |
|---|---|---|---|---|
| `afldb-settle-afl-api.timer` | enabled, active | `05:00` + `RandomizedDelaySec=15min`, `Persistent=true` | last 05:13:35 (ran 2 s, success); next Mon 05:08:15 | runs `deploy/afldb-settle-afl-api.sh` **from the serving checkout**: never fast-forward the checkout or promote while it runs |
| `afldb-settle-afltables.timer` | **disabled** | `04:30` + 15 min | never | retired |
| `afldb-settle-afl-api-brownlow.timer` | **disabled** | every 5 min | never | live-count only |
| `afldb-backup*.timer`, `afldb-email-intake.timer` | **not installed** | — | — | no scheduled backup exists (ISSUE-352): B1a's backup is per-operation |
| `apt-daily-upgrade.timer` | enabled | `06:00` + `RandomizedDelaySec=60m`, `Persistent=true` | last 06:45:35; next Mon 06:41:40 | without the B4 hold, needrestart restarts `afldb` and PostgreSQL (2026-11-14 06:35); `host-gate` refuses within 90 min of the next run and while apt runs |
| `apt-daily.timer` | enabled | `06:00,18:00` + `RandomizedDelaySec=12h` | last 18:05:18; next Mon 06:50:20 | downloads only, but can start at any hour; `host-gate` refuses while it runs (wait, re-run the gate) |
| `logrotate.timer`, `dpkg-db-backup.timer` | enabled | 00:00 | | avoid midnight |
| `e2scrub_all.timer` | enabled | Sun 03:10 | | weekly |
| `man-db`, `motd-news`, `update-notifier-*`, `fwupd-refresh`, `droplet-agent-update`, `sysstat-*`, `fstrim`, `systemd-tmpfiles-clean` | enabled | various | | not service-affecting |
| `arm` crontab | none | | | |

## 4. Not read (by design or unavailable)

DigitalOcean console access and snapshots; root crontab and the system journal (not readable by `arm`, no sudo); Caddy `roll_keep_for`;
`site_settings.afl_api_current_season_enabled` (the key is not in `afldb_prod`'s `site_settings`; per `docs/deployment.md` it lives in the
control database, not read). Public HTTPS was not probed from the workstation; local health and `release.mjs status` stand for it.
