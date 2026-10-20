# ISSUE-316 DEV application check — approval-ready plan (2026-10-21)

**Status: PREPARED, NOT APPROVED, NOTHING EXECUTED ON DEV.** Decision requested:
**D-DEV-316-C1-APP-1**. C2, production, writer activation, timers and `afldb_dev` stay outside it.
Production NO-GO unchanged. Related: [C0/C1 approval package](issue316-c0-c1-approval-2026-10-21.md)
(the shell subset passed 4/4 and is not repeated).

**Purpose.** Prove, on a DEV-hosted copy of the *real V2 application*, that an authorised Super
Admin's stale "start AFL Tables settle now" request is refused with
`{refused:true, code:'legacy_retired', surface:'admin.afltables_settle_trigger'}`, starts nothing,
and writes exactly one `admin.legacy_retired_refused` audit row — without touching the running V1
app, its database, or its timers.

## 1. Verified DEV baseline (read-only inspection, 2026-10-21 ≈ 08:40–08:50 +11:00)

Only SSH alias `dev` was used (agent key `afldb-dev`, Windows OpenSSH) and the existing read-only
`afldb_backup` role in read-only sessions. No sudo, no remote directory, no file copied, no
migration-status command (it performs bootstrap DDL), no production alias or host.

| Item | Measured |
|---|---|
| Host | `streamanator`, `arm` (uid 1000, groups incl. sudo/docker/adm), 10.0.40.100 |
| OS / CPU | Ubuntu 24.04.5, kernel 6.8.0-147-generic, x86_64 (amd64), glibc 2.39, 24 cores, 32 GB |
| Disk | 77 GB free of 232 GB |
| Runtime | system node v18.19.1 (unsuitable); app runs under nvm **v22.23.2** (only nvm version) at `/home/arm/.nvm/versions/node/v22.23.2/bin/node`; psql/pg_dump/pg_restore 16.15, tar, gzip, curl, caddy present |
| Existing app | `afldb.service` (enabled, active), `/home/arm/projects/afldb` = **V1 `main` `0cb3d20c`**, `deploy/server-cluster.mjs` 4 workers, standalone BUILD_ID `jfwHG_Ru35eHV1Q9_O6oy`, Next 16.3.1, loopback **3100**, Caddy :8090 → 3100, `AFLDB_ENV=development`, beta gate on |
| Free ports | **3201, 3202 free** (3000/3100/8090 etc. in use) |
| Timers | `afldb-settle-afl-api-brownlow.timer` (5 min), `afldb-settle-afl-api.timer` (05:00 ±15), both WorkingDirectory the V1 tree; `afldb-settle-afltables.service` static (no timer); no e-mail-intake timer; backup timers cover configs/home, **not** the DB |
| PostgreSQL | 16.15, localhost:5432, started 2026-10-16, wal_level replica, archive_mode off, max_connections 100; extensions pg_trgm 1.6, unaccent 1.1 (both *trusted*, so `afldb_owner` can create them) |
| `afldb_dev` | owner `afldb_owner`, 497 MB, UTF8 / en_US.UTF-8, no DB-level settings, **`pg_default_acl` empty**; 77 public tables; matches 17,056; players 13,365; player_match_stats 695,499 |
| Ledger | **110 rows, contiguous 001–110**, last `110_match_sheet_player_match_stats_authority.sql` (2026-10-03T10:36:12Z); all 110 checksums equal the local files (0 drift). **Pending = exactly 111–117** (111_curated_award_proposals … 117_brownlow_provider_eligibility_unknown) |
| Roles | afldb_app/auth/backup/import/owner: none superuser/createdb/createrole; only `postgres` is superuser/CREATEDB; `afldb_owner` has CREATE on the DB; `afldb_backup` ∈ `pg_read_all_data`; `afldb_auth` has SELECT/INSERT(/UPDATE on users, sessions) on auth tables, `afldb_app` none |
| Auth data | `auth_users`: 3 super_admin + 1 admin; active sessions 0; `auth_audit_log` 1,073 rows (ids 1–1099, latest 2026-10-15 22:51 +11); **0 rows `admin.legacy_retired_refused`** |
| Other DBs | afldb_dev_candidate_20260926-*, afldb_dev_pre_rebuild_*, afldb_restore_test (109), afldb_test (110), afldb_test_pre_rebuild_*, code_test_db, issue237_r1_restore; **no name collision** with the proposed `afldb_dev_v2_candidate_test` |
| Recovery artifacts | `/home/arm/backups/afldb/afldb_dev-*.dump` newest 2026-09-26 (stale, pre-110); `/home/arm/afldb_test_rebuilt_*.dump`; `/home/arm/afldb-recovery/`. No current DB backup exists, so this plan takes a fresh read-only `pg_dump` and uses it as both restore source and recovery artefact |
| **Unknown** | Whether `arm` has passwordless sudo (not tested). `CREATE DATABASE` needs the `postgres` superuser; see step 8 for both ways to do it |

## 2. Candidate artifact (local, exact)

| | |
|---|---|
| Source | `v2/rebuild` **`fffef96fb079bfa975109fa2fdcf5552b51e5946`** (`git archive` SHA-256 `c7b755b5…ce5cb6`) |
| Executable-source digest | `fc12b4dd415bdf513ea05a910c35044d6a02adb2bdd2f1f33ca9fc2f5d569f0d` — sha256 of `git ls-tree -r <rev> -- src packages public data deploy tools/build tools/rebuild next.config.ts package.json package-lock.json tsconfig.json` (934 entries). **Identical at `fffef96f` and at the reviewed `a6400e7d`**; `package-lock.json` sha `984b4422…23d8e86` |
| Why a new build | The retained final build (`lb3QH7MZc7jhLkBhT6iau`) is not deployable as-is: its `node_modules` is a symlink into the rehearsal tree and it was built for `127.0.0.1:3912`. This build is self-contained (no symlinks, no `.env*`) |
| Build | Next 16.3.1 `next build --webpack` + `tools/build/prepare-standalone.mjs`, exit 0 in 93 s, **BUILD_ID `WkKKyr7KAoFmMb5QyM4MQ`**, Ubuntu 24.04 glibc 2.39 x86_64 (isolated WSL distro, loopback-only network namespace), Node 22.21.0, `npm ci --offline --ignore-scripts`, sharp linux-x64 addon |
| Build-time config | `AFLDB_ENV=development`, `AFLDB_INDEXING=off`, `AFLDB_BETA_GATE=off`, `AFLDB_BASE_URL=http://127.0.0.1:3201`, placeholder session secret (never a runtime secret). Prerendered against an isolated 117-migrated clone, never DEV or production. Build did not touch DEV |
| Archive | `afldb-v2-dev-candidate-fffef96f.tar.gz`, **113,830,430 bytes**, SHA-256 **`c829da087f65a3a8145ad07db8d7d649bb7f93f8b293d66f85547cd375e40b0e`**, 13,209 regular files (801 MiB `app/`, 14 MiB `kit/` extracted), deterministic tar (name-sorted, owner 0/0, mtime pinned), `gzip -n`. Held at `C:\Users\stuar\AppData\Local\Temp\claude\D--dev-afldbV2\77258a0a-3c50-46b6-b25d-0084ebe15f04\scratchpad\candidate\afldb-v2-dev-candidate-fffef96f.tar.gz` (not in git) |
| Contents | `app/` standalone server + `.next` + static + public + runtime reference files; `kit/` = migration runner (`tools/db/{migrate,migration-checksum,migration-safety}.ts`), `privileges.sql`, all 117 migrations, `tsx` + `postgres` closure, `ops/dev-candidate.sh`, `ops/check.mjs`; `FILES.sha256`; `SOURCE.json`. **Excluded:** every `.env*`/credential, DB archives, raw acquisition data, issues, docs, evidence (0 env files inside) |
| Not a source archive | It is a built application; `node server.js` runs it. Nothing is compiled on DEV |

Verified locally: extract + `sha256sum -c FILES.sha256` 13,209/13,209 OK; `kit/ops/*` byte-identical
to the committed copies; `tsx` and `postgres` resolve from the packaged kit; the runner refuses
without a DSN. **Local rehearsal (isolated clone, packaged copy run from a different absolute path
than the build):** `/api/health` 200, then `check.mjs` **PASS** — anonymous and synthetic `admin`
callers get no refusal and no audit row; synthetic `super_admin` gets exactly the expected refusal
and exactly one audit row (`detail {export:'startSettleRunAction', surface:'admin.afltables_settle_trigger'}`,
actor = that user, ip 127.0.0.1) — sanitised result
`docs/v2/evidence/issue316-dev-app-check/local-rehearsal-check.json`. (The first rehearsal run
failed on my own checker, which compared jsonb key order; fixed to a canonical compare, re-run PASS.)
This proves relocation and the code path; it does **not** prove DEV's runtime, roles, or filesystem.

Differences from the intended DEV setup (stated, not hidden): Node 22.21.0 build/rehearsal vs 22.23.2
on DEV; prerendered pages came from the rehearsal clone (ISR regenerates at runtime); candidate runs
as a plain process (not systemd) with one server, not the 4-worker cluster; `AFLDB_POOL_MAX=4`;
canonical/SEO URLs point at `127.0.0.1:3201` (indexing off).

## 3. Proposed design

- **Separate candidate**, nothing existing is replaced: directory
  `ROOT=/home/arm/issue316-v2-candidate-20261021` (absent now), app on **`127.0.0.1:3201`**
  (loopback only; not in Caddy), started by hand as `arm`, no systemd unit, no sudo for the app.
  The V1 app on 3100 stays up untouched.
- **New isolated database `afldb_dev_v2_candidate_test`** (name ends `_test` so the runner's
  `--target test` can never resolve to `afldb_dev`), owner `afldb_owner`, restored from a fresh
  read-only `pg_dump` of `afldb_dev` (not `CREATE … TEMPLATE`, which needs no other sessions and
  `afldb_dev` is live). Migrations 111–117 are applied **to the candidate only**; `afldb_dev`'s
  schema is never changed.
- **Credentials:** the script derives `config/app.env` and `config/ops.env` (mode 600) on DEV from
  the existing `/home/arm/projects/afldb/.env` by swapping only the database name and generating a
  fresh 64-hex `AFLDB_SESSION_SECRET`. Values are never printed or put on a command line. The
  candidate env has *no* owner/backup/test/e-mail-intake/legacy-SQLite variables and no AFL API
  settings, so it cannot reach e-mail, acquisition, timers or production.
- **Application check:** `check.mjs` (run on DEV against `127.0.0.1:3201`) reads the Server Action
  id from the build's own `server-reference-manifest.json` (exactly one `startSettleRunAction` in
  `app/admin/current-season/actions.ts`; here `0058d07345f6bb8d2f9a99cf05d7676825c1eed612`), creates
  two **synthetic** users in the candidate DB only (`issue316-superadmin-check@example.invalid`
  `super_admin`, `issue316-admin-check@example.invalid` `admin`; NULL password/TOTP, so they cannot
  log in) with one session each, mints their cookies from the candidate's own session secret, and
  POSTs the real Server Action (`Next-Action` header, `text/x-component`, body `[]`). It never calls
  the V1 app's "start now" control. Audit rows are counted through a separate **read-only**
  connection, never via the app. Cases: N1 anonymous and N2 synthetic admin must *not* be refused
  or audited (delta 0); P1 synthetic super admin must return the exact refusal and produce exactly
  one audit row with the expected action/detail/actor/ip. **A missing audit row is a FAIL; the
  script never inserts one.** Sessions are revoked and synthetic users disabled in `finally`.
  Also confirms `matches`, `import_batches` and the ledger did not change. No acquisition, no
  `systemctl`, no outbound network.
- **No wiring:** no timer, unit, Caddy route, e-mail, AFL API or production credential.

## 4. Every proposed write

| # | Write | Where |
|---|---|---|
| W1 | `mkdir -m 700 ROOT ROOT/incoming` | `/home/arm` |
| W2 | `scp` of the 113.8 MB archive | `ROOT/incoming/` |
| W3 | `tar -xzf` (≈ 815 MiB) | `ROOT/afldb-v2-dev-candidate-fffef96f/` |
| W4 | `layout`: dirs `config evidence recovery run` (700) | `ROOT/` |
| W5 | `envgen`: `config/app.env`, `config/ops.env` (600) | `ROOT/config/` |
| W6 | `dump`: custom-format dump + `.sha256`, TOC, before/after counts (read-only on `afldb_dev`) | `ROOT/recovery`, `ROOT/evidence` |
| W7 | `CREATE DATABASE afldb_dev_v2_candidate_test …` as `postgres` | PostgreSQL cluster |
| W8 | `restore` (single transaction) into the candidate | candidate DB only |
| W9 | `migrate`: 111–117 + ledger rows | candidate DB only |
| W10 | `privileges`: `privileges.sql` grants, incl. its own `ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA public` | candidate DB only (default ACLs are per-database; `afldb_dev` has none, so the candidate will differ there — recorded) |
| W11 | `start`: one `node server.js` as `arm` on 127.0.0.1:3201, log + pid file | `ROOT/evidence`, `ROOT/run` |
| W12 | `check`: 2 synthetic users + 2 sessions, 1 expected audit row, evidence JSON; then session revoke / user disable | candidate DB, `ROOT/evidence` |
| W13 | `stop`: terminate the verified candidate PID | the one process |

Not written, ever, in this plan: `afldb_dev`, V1 files, units, timers, Caddy, `.env`, other DBs, sudoers.

## 5. Ordered commands

All run from the repository host through `ssh dev` (Windows OpenSSH), one step at a time, outputs
reviewed before the next. `K=/home/arm/issue316-v2-candidate-20261021`,
`P=$K/afldb-v2-dev-candidate-fffef96f`, `D=sh $P/kit/ops/dev-candidate.sh`.

0. **Baseline re-check (read-only).** `hostname` = `streamanator`; `id -un` = `arm`; `ss -ltn` shows
   nothing on 3201; `test ! -e $K`; `df -Pk /home/arm` ≥ 6 GiB; `sudo -n true` (record
   yes/no only). **Stop** on any mismatch.
1. `ssh dev 'mkdir -m 700 /home/arm/issue316-v2-candidate-20261021 && mkdir -m 700 /home/arm/issue316-v2-candidate-20261021/incoming'` (W1).
2. `scp afldb-v2-dev-candidate-fffef96f.tar.gz dev:$K/incoming/` (W2); then
   `sha256sum $K/incoming/*.tar.gz` **must equal**
   `c829da087f65a3a8145ad07db8d7d649bb7f93f8b293d66f85547cd375e40b0e` and the size 113830430.
   **Stop** on mismatch (delete only that file).
3. `tar -tzf` listing check (only `afldb-v2-dev-candidate-fffef96f/…`, no absolute/`..` paths), then
   `tar -xzf $K/incoming/*.tar.gz -C $K` (W3), then `$D verify` → "13209 files match".
4. `$D preflight` (read-only): host, node 22.23.2 present, tools, ≥ 6 GiB, port free, build id
   `WkKKyr7KAoFmMb5QyM4MQ`, candidate DB `(absent)`. Then `$D guard` and keep the output as the
   **source baseline** (ledger `110 / 110_match…`, audit total/max id, 0 refused rows, counts).
5. `$D layout` (W4); `$D envgen` (W5; prints variable *names* only).
6. `$D dump` (W6): `afldb_backup` read-only `pg_dump -Fc`; records sha256, size, TOC, source counts
   before/after. **Stop** if the counts before and after differ unexpectedly or the TOC is empty.
7. **Create the database (W7), exactly one statement, as `postgres`:**
   ```sql
   CREATE DATABASE afldb_dev_v2_candidate_test OWNER afldb_owner TEMPLATE template0
     ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8';
   ```
   - If `sudo -n true` passed in step 0: `ssh dev "sudo -n -u postgres psql -X -v ON_ERROR_STOP=1 -d postgres -c \"<statement above on one line>\""`.
   - Otherwise the owner runs the same statement in their own `ssh dev` terminal (`sudo -u postgres psql`)
     and says "done". No password is requested or handled by me.
   Read back (read-only): database exists, owner `afldb_owner`, UTF8, no sessions.
8. `$D restore` (W8): verifies the dump hash, candidate identity/owner and emptiness, then
   `pg_restore --exit-on-error --single-transaction --no-owner`. Expect source-equal counts
   (ledger 110, matches 17,056 …). **Stop** on any error — the transaction leaves the candidate empty.
9. `$D migrate` (W9): requires ledger exactly `110 / 110_match_sheet…`, runs
   `migrate.ts --target test` (only 111–117 apply; each transactional), requires
   `117 / 117_brownlow_provider_eligibility_unknown.sql`.
10. `$D privileges` (W10), then `$D readback`: re-runs the runner (must say "Nothing to apply" —
    checksum parity for all 117), prints extensions, ACL probe for auth tables, counts.
11. `$D start` (W11): requires free port, pid-verified listener (exe = node 22.23.2, cwd = `app/`),
    waits for `/api/health` 200.
12. `$D check` (W12) → `evidence/stale-action-check-<ts>.json`, `VERDICT: PASS` required.
13. `$D guard` again and diff against step 4: `afldb_dev` ledger still 110, refused rows still 0,
    no synthetic users, no `afldb_dev` audit row from the check.
14. `$D stop` (W13), then `$D status` ("no pid file", no listener on 3201).
15. Copy `ROOT/evidence/` back (`scp -r`, secrets-free by construction), review, record in the
    approval doc and tracking. Report. **Stop.**

## 6. Expected effects and acceptance

- Step 12 PASS requires **all** of: P1 HTTP 200 with `refused:true`, `code:'legacy_retired'`,
  `surface:'admin.afltables_settle_trigger'`, non-empty `error` without path/DSN/secret; total audit
  delta exactly 1 and `admin.legacy_retired_refused` delta exactly 1; row detail
  `{export:'startSettleRunAction', surface:'admin.afltables_settle_trigger'}`, `actor_user_id` = the
  synthetic super admin, `actor_label` = its address, ip 127.0.0.1; N1/N2 not refused and audit delta 0;
  `matches`, `import_batches`, ledger unchanged; cleanup done.
- **A missing or duplicated audit row blocks acceptance.** No manual insert, no re-run to "get" a row;
  a failed run is reported with its evidence and the candidate is stopped.
- Acceptance proves only this: the V2 build refuses the retired action and audits it on DEV
  infrastructure against a V2-migrated copy of DEV data. It does **not** accept C2, the AFL API
  writer, timers, rollover, D-316-13, or production, and does not close ISSUE-316.

## 7. Stop conditions

Wrong hostname/user/arch; any pre-existing `ROOT`, candidate DB or listener on 3201; archive size or
hash mismatch; `FILES.sha256` failure; less than 6 GiB free; `afldb_dev` ledger not
exactly `110/110_match…`; restore or migration error; unexpected counts (any `afldb_dev` change
between guard runs other than ordinary V1 traffic, explained); candidate pid fails exe/cwd
verification; `/api/health` not 200; any request to or change of `afldb_dev`, a unit, a timer or
Caddy; sudo prompting for a password (hand to the owner, do not try to supply one); any production
alias or host appearing; any output that would expose a secret (stop and discard).

## 8. Recovery and cleanup

- **Nothing existing is modified**, so there is nothing to roll back on V1, `afldb_dev`, the units
  or timers. The fresh dump (`ROOT/recovery/afldb_dev-<ts>.dump` + sha256) is retained as a current
  backup of `afldb_dev` as at the step-6 time.
- Failure before step 7: delete `ROOT` (own files only).
  Failure at 8–10: the candidate DB is disposable; stop the candidate, leave evidence.
- **Default end state:** candidate stopped, port 3201 free, `ROOT` and the candidate DB retained
  as evidence. Separate approval would be needed to remove them: `DROP DATABASE
  afldb_dev_v2_candidate_test` can be run by `afldb_owner` (owner; no sudo) and `rm -r` only inside
  `ROOT`. No other path is ever removed.
- Emergency stop at any time: `sh $P/kit/ops/dev-candidate.sh stop` (kills only the pid-verified
  candidate), or the owner kills that pid.

## 9. Owner decision requested — exact wording

> **D-DEV-316-C1-APP-1.** I approve, for DEV host `streamanator` (10.0.40.100) only, user `arm`,
> via SSH alias `dev`, the ordered plan in `docs/v2/issue316-dev-app-check-plan-2026-10-21.md` §5
> (steps 0–15) using the artifact `afldb-v2-dev-candidate-fffef96f.tar.gz`, 113,830,430 bytes,
> SHA-256 `c829da087f65a3a8145ad07db8d7d649bb7f93f8b293d66f85547cd375e40b0e`, built from
> `fffef96fb079bfa975109fa2fdcf5552b51e5946`: creating `/home/arm/issue316-v2-candidate-20261021`,
> a read-only dump of `afldb_dev`, the new database `afldb_dev_v2_candidate_test` (created by the
> `postgres` role in step 7 — by me or by Claude via passwordless sudo if available), migrations
> 111–117 and privileges on that new database only, one candidate process on 127.0.0.1:3201, and
> synthetic test users/sessions and one expected refusal audit row inside the candidate database
> only. I do **not** approve any change to `afldb_dev`, the V1 app, any unit, timer or Caddy
> configuration, any acquisition or AFL API activity, C2, rollover, D-316-13, the production alias
> or host, or removal of the candidate database or directory. A missing audit row blocks acceptance.

## 10. Local preparation notes

- **Disk incident (disclosed):** the D: drive ran out of space while the WSL rehearsal distro
  (`ext4.vhdx` on D:) grew during the build; the distro crashed and refused to start (`execvpe
  /bin/bash: I/O error`). Non-destructive recovery: moved my own 208 MB source tar to C:, `wsl
  --shutdown`, restarted; ext4 journal recovery completed, evidence intact. The restart dropped
  the loopback-only network namespace and isolated PostgreSQL; I recreated the namespace (`ip netns
  add`, `lo` up, no routes) and restarted isolated PG on 127.0.0.1:55434. Nothing under `D:\tmp`
  or other user data was touched. D: still has only ~79 MB free; **please free space on D:** before
  further WSL work (recycle bin ≈ 1.15 GB, `D:\deploy.tar.gz` 0.34 GB, `D:\tmp` ≈ 146 GB are yours to judge).
- Artifact files, the source tar and build trees live in the C: scratchpad and the rehearsal distro,
  not in git. The committed evidence is scripts and sanitised manifests only.
- The two ops scripts (`dev-candidate.sh`, `check.mjs`) are committed under
  `docs/v2/evidence/issue316-dev-app-check/` because the owner is asked to approve the exact
  commands they contain; they are byte-identical to the copies inside the archive.
