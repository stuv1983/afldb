# AFLDB — Deployment

Deployment on the **development server**. Production cutover is a separate, deliberate exercise: see [production-cutover.md](production-cutover.md).

## 1. Topology

```text
                 http://10.0.40.100:8090
                           │
                  ┌────────▼────────┐
                  │      Caddy      │  :8090 (dev port, not 80/443)
                  └────────┬────────┘
                           │ reverse_proxy 127.0.0.1:3100
                  ┌────────▼────────┐
                  │  afldb.service  │  systemd
                  │  cluster primary│
                  │  ├── worker 1   │  Next.js standalone
                  │  ├── worker 2   │
                  │  ├── worker 3   │
                  │  └── worker 4   │
                  └────────┬────────┘
                           │ localhost only
                  ┌────────▼────────┐
                  │   PostgreSQL    │  127.0.0.1:5432, never exposed
                  └─────────────────┘
```

| | |
|---|---|
| Host | `arm@10.0.40.100` (`streamanator`), 24 cores, 31 GB RAM |
| Project | `/home/arm/projects/afldb` |
| Node | 22.23.2 via nvm (user-local, no root; Next.js 16 requires >=20.9) |
| App port | **3100** (3000 was already in use) |
| Proxy port | **8090** (deliberately not 80/443) |
| Databases | `afldb_dev`, `afldb_test`, `afldb_restore_test` |

## 2. One-time setup

Two scripts require root. Both are idempotent and neither touches `afldb.com`.

```bash
# PostgreSQL, roles, databases, extensions, .env
sudo bash ~/projects/afldb/tools/maintenance/00_install_postgres.sh

# Caddy, systemd unit, afldb_restore_test
sudo bash ~/projects/afldb/tools/maintenance/01_setup_service.sh
```

Everything else runs unprivileged as `arm`.

## 3. Routine deployment

```bash
cd ~/projects/afldb
git pull

npm ci                       # or npm install
npm run db:migrate           # apply any pending migrations
npm run build                # production build + standalone preparation
sudo systemctl restart afldb
```

From a Windows workstation with SSH access to the development host, the same
routine can be run with:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\sync-dev.ps1
```

Use `-WhatIf` to print the target without touching the server, and
`-SkipMigrate`, `-SkipBuild` or `-SkipRestart` for narrower maintenance runs.

For AFLDB-ISSUE-107's controlled Next.js 16 deployment, first set
`AFLDB_TRACE_REQUESTS=on` in the development host's `.env`, retain
`AFLDB_WORKERS=4` and `AFLDB_POOL_MAX=10`, then run:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\sync-dev.ps1 -Issue107Gate
```

That mode refuses skipped install/build/restart/health steps, enforces Node >=20.9, checks the
development 4-worker/10-connection-pool controls after the systemd restart, and fails unless
`.next/standalone/.next/BUILD_ID` equals the live `x-afldb-build` response header.

Three things about the remote side are worth knowing, because each was a silent failure before
it was fixed:

- **Node comes from nvm and is not on an SSH `PATH`.** A non-interactive *or* login SSH shell
  resolves `/usr/bin/node`, which is 18.19.1 on the development host — below Next 16's floor.
  The script sources nvm's default before checking, so the build runs on the same v22.23.2 the
  systemd unit pins. A host without nvm keeps its `PATH` Node and is still held to the floor.
- **The remote script is sent base64-encoded.** PowerShell writes a UTF-8 BOM into a native
  command's stdin pipe, so piping the script straight into `bash -s` made the remote shell fail
  on its first line — `set -Eeuo pipefail` — and then run on past failed stages, able to exit 0.
  Base64 is plain ASCII and survives the pipe, CRLF and PowerShell's argument handling.
- **Restart falls back to the unit's `Restart=` policy.** `sudo` needs a password here, so
  `sudo -n systemctl restart afldb` cannot work over SSH and plain `systemctl restart` returns
  *Interactive authentication required*. The unit runs as `arm` with `Restart=always`, so the
  script terminates `MainPID` and lets **systemd** respawn the service from the unit, proving it
  by a changed `MainPID`. systemd is not bypassed and `.env` is re-read.

Build steps inside the remote script must be written as **single-quoted** PowerShell strings.
A double-quoted one expands `$(…)` on the workstation, so a step meant to report the server's
Node version, revision or working-tree state silently reports Windows instead.

`npm run build` deliberately runs `next build --webpack` for the controlled Next.js 16
upgrade, then `tools/build/prepare-standalone.mjs`, which copies `.next/static` into the
standalone bundle and creates `.next/cache`. **Both are required** — without them the site
starts but every stylesheet 404s and ISR cannot persist. Turbopack is not part of this first
framework upgrade.

Next.js 16's navigation cache deduplicates shared layouts and may issue more, smaller
incremental prefetch requests than Next 15. The resulting RSC/static request and output shape
is therefore not expected to be byte-for-byte identical. AFLDB retains its intentional
`prefetch={false}` primary/mobile navigation links and otherwise uses the framework defaults;
validate route semantics, console/hydration health and build identity rather than treating a
different `.rsc`/segment layout as a regression by itself.

## 4. Service management

```bash
systemctl status afldb
systemctl restart afldb
journalctl -u afldb -f          # live logs
journalctl -u afldb --since "1 hour ago"
```

The unit is `enabled`, so it starts at boot and after a PostgreSQL restart. `Restart=always` with `StartLimitBurst=5` means a crash loop stops and stays visible rather than retrying silently.

### Hardening

The unit runs with `ProtectSystem=strict`, `ProtectHome=read-only`, `PrivateTmp`, `NoNewPrivileges` and a `@system-service` syscall filter. Only `.next` is writable, for the ISR cache.

## 5. Clustering

SSR is CPU-bound and Node is single-threaded, so one process serialises concurrent renders. `deploy/server-cluster.mjs` forks `AFLDB_WORKERS` (default 4) workers sharing one listening socket.

Measured, concurrency 20 for 20 s against the full dataset:

| | 1 worker | 4 workers |
|---|---:|---:|
| Throughput | 46.1 req/s | **213.6 req/s** |
| p50 | 284 ms | **31 ms** |
| p95 | 1,489 ms | **391 ms** |
| p99 | 1,659 ms | **523 ms** |
| Errors | 0 | 0 |

Worker count is **not** one per core: each worker holds its own PostgreSQL pool, and 24 × 10 would exhaust `max_connections` (100).

### Sizing the connection budget

Every worker holds **two** pools, not one, so the service's peak is `AFLDB_WORKERS × (AFLDB_POOL_MAX + 3)` — the `+3` being the separate auth pool in [`src/db/authClient.ts`](../src/db/authClient.ts). Miss the auth pool and the arithmetic understates the real figure by a third.

Both values live in each host's **`.env`**, never in `deploy/afldb.service`. systemd applies `Environment=` after `EnvironmentFile=`, so a value in the unit would override `.env` on every machine the unit is installed on — and the two hosts are not comparable:

| Host | Spec | `AFLDB_WORKERS` | Peak connections |
|---|---|---:|---:|
| Development (streamanator) | 24 cores, 31 GB | 4 | 52 |
| Production droplet | 2 vCPU, 4 GB, PostgreSQL co-located | 2 | 26 |

Both against `max_connections` of 100.

| Consumer | Connections |
|---|---:|
| App pools (2 × 10) | 20 |
| Auth pools (2 × 3) | 6 |
| **Service peak** | **26** |
| Headroom against `max_connections` (100) | 74 |

One worker per vCPU. This box is not the 24-core development host, and CPU is not the first ceiling it hits: with 4 GB shared between Node and PostgreSQL, memory usually is, and each extra worker costs both. Raise `AFLDB_WORKERS` only once `journalctl -u afldb` shows CPU saturation arriving *before* memory pressure.

**If the database ever moves to a managed plan**, the connection limit replaces `max_connections` as the ceiling, and it is a hard one — exceeding it does not degrade, it fails with `too many clients`. Entry tiers are tight: 22 connections at 1 GB, 47 at 2 GB. At 22 the same formula caps you at two workers with a pool of 5.

Builds need their own budget. Prerendering forks a worker per core, each with a 2-connection pool, so a 24-core build box asks for 48 — over a managed limit before the build finishes. `AFLDB_BUILD_WORKERS` caps Next's static-generation workers; leave it **unset** against a local cluster, where Next's default is correct.

```bash
AFLDB_BUILD_WORKERS=4 npm run build     # 4 × 2 = 8 connections
```

## 6. Health

```bash
curl http://127.0.0.1:3100/api/health     # direct
curl http://10.0.40.100:8090/api/health   # through the proxy
```

Returns `{"status":"ok","database":"ok","latencyMs":N}`, or HTTP 503 with `"database":"unreachable"`. It deliberately reveals no version, hostname or connection detail. Caddy polls it every 30 s.

## 6a. Clean test rebuild (`afldb_test`)

The canonical clean rebuild of the **test** database is one command:

```bash
npm run db:test:rebuild -- --fitzroy-label <full-history-label> \
                           --acknowledge-destroy afldb_test
```

Add `--plan` to print the stage graph and exit without touching anything.

**It is destructive.** It drops every table, non-public schema, routine and type in
`afldb_test` — a genuine clean slate, not a truncation — while preserving the `pg_trgm` and
`unaccent` extensions, which are owned by another role. It refuses any target whose name is
not exactly `afldb_test`, rejects `afldb_dev` and production by name, and requires you to
name the database in `--acknowledge-destroy`.

**Preflight runs before any destruction.** Every tracked DraftGuru input is checked and
`import_draftguru.py --validate-only` must report 42 sha256-verified year pages, 5,057
persons and 6,810 picks. A missing input fails while the database is still intact.

Stage order (fixed):

| # | Stage | Credential |
|---|---|---|
| 1 | preflight | none — no database contact |
| 2 | database reset | `AFLDB_TEST_DATABASE_URL` (owner) |
| 3 | migrations (`db:migrate:test`) | `AFLDB_TEST_DATABASE_URL` |
| 4 | privileges (`db:privileges:test`) | `AFLDB_TEST_DATABASE_URL` |
| 5 | reference data | `AFLDB_TEST_IMPORT_DATABASE_URL` |
| 6 | fitzRoy / AFL Tables core | `AFLDB_TEST_IMPORT_DATABASE_URL` |
| 7 | **DraftGuru** | `AFLDB_TEST_IMPORT_DATABASE_URL` |
| 8 | **awards & honours** (tracked manifests) | `AFLDB_TEST_IMPORT_DATABASE_URL` |
| 9 | derived summaries | `AFLDB_TEST_IMPORT_DATABASE_URL` |
| 10 | Coleman (derived) | `AFLDB_TEST_IMPORT_DATABASE_URL` |
| 11 | ladder witness cross-check | `AFLDB_TEST_IMPORT_DATABASE_URL` |
| 12 | fingerprints / row counts | `AFLDB_TEST_DATABASE_URL` |

The awards & honours stage (AFLDB-ISSUE-112) runs the eight manifest-backed
groups and carries **no** `AFLDB_LEGACY_SQLITE` in its environment; the legacy
`awards` group is deliberately not in it. It follows DraftGuru because every
family carries player links and the canonical `players` population must be
complete first. Coleman keeps its own later stage because it is derived and
must run after `season_metadata` (AFLDB-ISSUE-111).

Data stages need `AFLDB_TEST_IMPORT_DATABASE_URL` — a restricted `afldb_import` DSN for the
test database. The runner **fails closed** without it and never inherits the development
`AFLDB_IMPORT_DATABASE_URL`, which points at `afldb_dev`. `--allow-owner-import-dsn` runs the
data stages as owner deliberately, at the cost of the AFLDB-ISSUE-083 blind spot.

`--fitzroy-label` is required and must name a manifest declaring `full_history`.
`trial-2024` is a trial snapshot and can never satisfy full-history mode; use
`--acknowledge-partial-fitzroy` to rebuild from partial core data on purpose.

DraftGuru's canonical source is the accepted Stage A snapshot plus the tracked event/club
contracts and the explicit-decision ledger. **It has no `AFLDB_LEGACY_SQLITE` dependency**,
and the retired `tools/migration/import_draft.py` is never invoked. A Stage B3 person-page
bridge is optional and absent by default; unbridged persons stay `unmatched`.

## 7. Data refresh

Run in this order. Each step is idempotent and safe to repeat.

```bash
cd ~/projects/afldb
source .venv/bin/activate    # or use ./.venv/bin/python directly

./.venv/bin/python tools/migration/import_legacy_afl.py       # ~114s  core reload
./.venv/bin/python tools/migration/enrich_birth_dates.py      # ~6s    DOB recovery
./.venv/bin/python tools/rebuild/draftguru/import_draftguru.py  # draft rows and people
./.venv/bin/python tools/migration/import_awards.py --groups \
    all_australian under_22 rising_star club_bf named_medals \
    hall_of_fame honour_teams captaincies                     # awards and honours, manifest-backed
./.venv/bin/python tools/migration/rebuild_derived.py         # ~30s   summaries
./.venv/bin/python tools/migration/import_awards.py --groups coleman  # after season_metadata
./.venv/bin/python tools/validation/validate_migration.py     # every check must pass

npm run build && sudo systemctl restart afldb                 # refresh cached pages
```

`import_draftguru.py` is the supported DraftGuru importer (AFLDB-ISSUE-093 Stage B2). It reads
the accepted Stage A snapshot and the tracked reference/decision artefacts, and has **no**
`AFLDB_LEGACY_SQLITE` dependency. `tools/migration/import_draft.py` is **retired** and now
fails fast if invoked. Add `--validate-only` to check every input without touching the
database, or `--dry-run` to run the whole transaction and roll it back.

### Awards and honours no longer need the legacy SQLite database

`import_awards.py` used to require `AFLDB_LEGACY_SQLITE` for every group but
`under_22`. Since AFLDB-ISSUE-112 all nine award and honour families load from
tracked manifests under `data/awards/`, or derive from AFLDB's own canonical
facts, and the refresh step above names them explicitly so **no step in this
sequence reads a legacy SQLite database**:

| Group | Source |
|---|---|
| `all_australian` | `data/awards/all-australian.csv` + `award-definitions.csv` |
| `under_22` | `data/awards/22-under-22.csv` |
| `rising_star` | `data/awards/rising-star.csv`, `rising-star-winners.csv` + `award-definitions.csv` |
| `club_bf` | `data/awards/club-best-and-fairest{,-definitions}.csv` |
| `named_medals` | `data/awards/named-medals{,-definitions}.csv` |
| `hall_of_fame` | `data/awards/hall-of-fame.csv` |
| `honour_teams` | `data/awards/honour-teams.csv` |
| `captaincies` | `data/awards/captaincies.csv` |
| `coleman` | derived from `player_match_stats` (AFLDB-ISSUE-111) |

Every manifest family that carries a bootstrap `player_id` re-resolves it
through `data/awards/player-identity.csv` and an adjudicated `unique` or
`resolved` AFL Tables profile identity in `external_identities`. It never trusts
the integer itself: that integer belongs to the database the manifest was
bootstrapped from, and a canonical rebuild re-seeds `players.id`. A row whose
identity is missing or does not resolve to exactly one current player loads
**unlinked** and is named in the run's output; it is never guessed from a name.
The 22 Under 22 manifest and Coleman derivation do not carry those bootstrap
player ids and keep their own existing identity contracts.

The bare `./.venv/bin/python tools/migration/import_awards.py` (no `--groups`)
still selects the legacy `awards` group and therefore still demands
`AFLDB_LEGACY_SQLITE`. **That group is compatibility-only.** It now creates no
award definition and no winner row that another group does not already own, and
it is not part of the canonical rebuild or of this refresh sequence. Run it only
for a deliberate full re-extract from a legacy database you still hold.

The order matters. `rebuild_derived.py` must run last of the summary builders: it reads the tables the earlier steps write, and its first target, `season_metadata`, decides whether a season is still in progress — which in turn decides whether that season's Brownlow reads as a zero or as "not yet awarded".

The `coleman` group is the one awards group that runs **after** `rebuild_derived.py`, and it is repeated there deliberately. Unlike every other awards family it is *derived*, not acquired: it computes the leading home-and-away goalkicker from `player_match_stats` joined to `matches` (AFLDB-ISSUE-111), and it materialises a winner only for a season `season_metadata` has marked complete. Running it before that pass would read a stale season status and could name a winner for a season still being played. The second pass is idempotent — a reload by key, with the row ids preserved — so repeating it costs one query and removes the ordering hazard. Its boundaries (first season, tie rule, club rule, provenance, key format) live in `data/reference/coleman-derivation.json`, not in the loader.

For a Coleman-only correction, run
`./.venv/bin/python tools/migration/import_awards.py --groups coleman` after
`rebuild_derived.py`. Like `under_22`, it needs no legacy SQLite database and
rewrites no other award family.

**One-time only, per database:** `./.venv/bin/python tools/migration/import_awards.py --rekey-coleman`
re-owns the 46 pre-existing DraftGuru-sourced Coleman rows in place before the
first derived load, preserving every `award_winners.id`. It runs a fail-closed
1:1 preflight and writes nothing unless every count reconciles; it is retry-safe
(already transitioned → verify and no-op) and refuses on a mixed state. Skipping
it does not fail loudly — it silently duplicates the family, because the derived
loader's ownership scope cannot see the legacy rows.

For a 22 Under 22-only correction, run
`./.venv/bin/python tools/migration/import_awards.py --groups under_22` after
`npm run db:migrate`. That scoped group needs no legacy SQLite database and
does not rewrite other awards; rebuild-derived is not required because award
selections are sourced facts rather than match-derived summaries. Follow it
with the normal build and service restart so the cached Awards index, award
routes and sitemap are regenerated from the new rows.

Options: `--dry-run` on every script, plus `--groups <name>...` and `--list-groups` on the legacy and awards imports and `--targets` on the rebuild.

**A partial import protects what it will not rebuild.** Reloading a subset
with `--groups` refuses to start if `TRUNCATE … CASCADE` would empty a table
outside those groups — reloading only `reference` would otherwise take the
match and statistics tables with it and still report success. Override with
`--allow-cascade` only when emptying them is the intention.

**A reload is not atomic.** Each group commits separately, so a reader during
one sees it in stages, and a crash part-way leaves it part-applied. Clubs and
their organizations are the one pair that commit together, because a null
organization would otherwise be permanent. Prefer running a refresh when
nothing else is reading, and re-run from the start after any failure.

**Enrichment never overwrites.** `enrich_birth_dates.py` fills only NULL dates and flags disagreements rather than resolving them, so re-running it after a manual correction cannot undo that correction.

**Cache invalidation.** Historical pages are cached for 1–24 hours. After an import, a rebuild and restart refreshes them; a full restart is not otherwise required. Rebuilding is preferred over waiting for revalidation, because prerendered pages are regenerated at build time.

## 7a. AFLW staging refresh

AFLW lives in `staging_aflw` only. It is not yet in the normalised model, is
not read by the website, and therefore needs **no build and no restart**.

The parse runs on the workstation, where the scrape lives; only the CSVs
travel. `data/` is gitignored, so they are never committed.

```bash
# workstation
python tools/aflw/parse_aflw.py            # scrape -> data/aflw/parsed/*.csv
python tools/aflw/load_staging.py --check  # no database needed
scp data/aflw/parsed/*.csv arm@10.0.40.100:~/projects/afldb/data/aflw/parsed/

# server
cd ~/projects/afldb
./.venv/bin/python tools/aflw/load_staging.py --load
```

`--load` re-runs `--check` first and loads inside one transaction, so a bad
parse is a readable report and a failure leaves the previous load intact.
See [tools/aflw/README.md](../tools/aflw/README.md) for what the source is
and where it lies.

Running SQL against the server from the workstation is easiest by piping a
file into `psql` over stdin — `cat q.sql | ssh arm@10.0.40.100 '... psql "$DSN" -f -'`.
An inline heredoc inside a quoted `ssh` argument silently eats `''`, which
turns `WHERE conference = ''` into a syntax error.

## 7b. In-season AFL Tables settle (scheduled)

`AFLDB-ISSUE-122`. Once a night, in season, AFL Tables is acquired through
fitzRoy, adjudicated offline, and applied canonically without a human. The
chain is:

```text
acquire_core.R --acquire --in-season          network; writes files, manifest LAST
  -> import_fitzroy_core.py --require-in-season --on-record-error reject
     --emit-observations                       offline; never opens a database
  -> settle-afltables.ts --apply --auto-apply --require-complete-source
                                                the only step that reaches PostgreSQL
```

`deploy/afldb-settle-afltables.sh` runs those three steps under `set -e`,
`deploy/afldb-settle-afltables.service` runs the script as a `oneshot`, and
`deploy/afldb-settle-afltables.timer` fires it nightly. The season comes from
`data/reference/seasons.json` `in_progress_seasons` and the datasets from the
contract's own `in_season` block, so neither is duplicated in the unit.

**Squiggle and Kali are never invoked automatically**, and since §11.2 of
ISSUE-122 neither can write a canonical row at all. There is no fallback
canonical authority: if this chain fails, the season does not advance until it
succeeds.

### R and the pinned fitzRoy

`acquire_core.R` needs R (>= 4.1), `jsonlite`, `digest`, and fitzRoy at
**exactly** the version pinned in
`tools/rebuild/fitzroy/fitzroy-contract.json` (`pinned_version`, currently
`1.8.0`). It compares the installed version with `identical()` and refuses to
acquire on a mismatch, so an unnoticed upstream upgrade fails the run rather
than silently changing the source schema.

Ubuntu 24.04's own `r-base-core` (4.3.3) satisfies the requirement, and Ubuntu
packages all but two of fitzRoy's dependency tree, so the install compiles
almost nothing — which matters on the 2 vCPU / 4 GB droplet, which has no
swap. Only `janitor` (pure R) and `nanoparquet` (C) come from CRAN.

```bash
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  r-base-core r-base-dev \
  r-cran-jsonlite r-cran-digest \
  r-cran-cli r-cran-dplyr r-cran-glue r-cran-httr r-cran-httr2 \
  r-cran-lifecycle r-cran-lubridate r-cran-magrittr r-cran-purrr \
  r-cran-readr r-cran-rlang r-cran-rvest r-cran-snakecase r-cran-stringi \
  r-cran-stringr r-cran-tibble r-cran-tidyr r-cran-tidyselect r-cran-xml2
```

Install fitzRoy itself from a **dated Posit Package Manager snapshot**, not
from `latest`. The snapshot is the pin: `install.packages("fitzRoy")` against
`latest` installs whatever CRAN carries that day, which is how a contract pin
quietly stops matching. A dated snapshot reinstalls the same 1.8.0 in a year's
time.

```bash
# The snapshot date must be one on which fitzRoy 1.8.0 was current
# (published 2026-08-23). Re-date this only when the contract pin changes.
sudo Rscript -e 'install.packages("fitzRoy",
  repos = "https://packagemanager.posit.co/cran/__linux__/noble/2026-09-01",
  lib   = "/usr/local/lib/R/site-library")'
```

`/usr/local/lib/R/site-library` is the system-wide library `r-base-core`
creates. Installing there rather than into `~/R` keeps the library outside
`$HOME`, which the unit mounts read-only, and means the service never writes
to its own library at run time.

**Verify the pin — this is the gate, not the install log:**

```bash
command -v Rscript
Rscript -e 'cat(as.character(packageVersion("fitzRoy")), "\n")'   # must print 1.8.0
Rscript -e 'cat(R.version.string, "\n")'
```

If those two versions do not match the contract, stop: do not pass
`--allow-version-mismatch` to work around it. Re-pinning the contract is a
deliberate, reviewed edit with fresh probe evidence behind it.

**How a future deployment verifies the pin.** It does not need to remember to:
`acquire_core.R` re-reads `fitzroy-contract.json` and re-checks the installed
version on **every** run, and records the version actually used in every probe
and manifest. An R upgrade that moves fitzRoy therefore fails the next timer
firing loudly, and no snapshot is produced.

### Installing the service and timer

```bash
cd ~/projects/afldb

# The unit mounts $HOME read-only and opens exactly two writable paths.
# Both must exist BEFORE it starts, or systemd refuses to start it —
# deliberately, so a missing directory is not an EROFS halfway through a fetch.
mkdir -p data/sources/afltables/fitzroy_core
ls -d docs/rebuild-manifests/afltables_fitzroy_core   # tracked; present after a deploy

sudo cp deploy/afldb-settle-afltables.service deploy/afldb-settle-afltables.timer \
        /etc/systemd/system/
sudo systemctl daemon-reload
```

Do **not** enable the timer yet — validate first (below).

### Environment

The unit needs one credential: `AFLDB_IMPORT_DATABASE_URL` (the `afldb_import`
role), read from `.env` by `EnvironmentFile=`. Every other DSN and secret
`.env` carries is dropped with `UnsetEnvironment=`, so this is the one unit
besides the importers that holds a writing DSN, and it holds only that one.

No Python virtualenv is required. The offline adjudication and emission path
of `import_fitzroy_core.py` imports only the standard library — `psycopg`
arrives through a lazy `from common import ...` inside the database branch,
which `--emit-observations` returns before ever reaching. System
`/usr/bin/python3` is enough.

### Supervised validation, in escalation order

Run these by hand, in order, and stop at the first failure. Nothing is
scheduled until step 9 passes.

```bash
cd ~/projects/afldb

# 1-2. runtime and the pin
command -v Rscript && Rscript -e 'cat(as.character(packageVersion("fitzRoy")),"\n")'

# 3. acquisition only. Writes files; the manifest is written LAST
L=settle-$(date +%Y-%m-%d-%H%M)
Rscript tools/rebuild/fitzroy/acquire_core.R --acquire --in-season \
  --label "$L" --from 2026 --to 2026
ls -l docs/rebuild-manifests/afltables_fitzroy_core/$L.json   # exists => acquisition finished

# 4. offline adjudication + observation bundle. No database is opened
python3 tools/migration/import_fitzroy_core.py --label "$L" \
  --require-in-season --on-record-error reject \
  --emit-observations "data/sources/afltables/fitzroy_core/$L/observations.json"

# 5. safe preview: the full automatic path against real constraints and
#    privileges, rolled back at the end
node_modules/.bin/tsx tools/current-season/settle-afltables.ts \
  --label "$L" --dry-run --auto-apply

# 6. the real run
node_modules/.bin/tsx tools/current-season/settle-afltables.ts \
  --label "$L" --apply --auto-apply

# 7. the exception report and the counters printed by step 6
node_modules/.bin/tsx tools/current-season/settle-afltables.ts --label "$L" --report

# 8. idempotence: acquire a fresh snapshot over the same upstream data and
#    settle it again. Every canonical and ledger counter must be 0
L2=settle-$(date +%Y-%m-%d-%H%M)
Rscript tools/rebuild/fitzroy/acquire_core.R --acquire --in-season \
  --label "$L2" --from 2026 --to 2026
python3 tools/migration/import_fitzroy_core.py --label "$L2" \
  --require-in-season --on-record-error reject \
  --emit-observations "data/sources/afltables/fitzroy_core/$L2/observations.json"
node_modules/.bin/tsx tools/current-season/settle-afltables.ts \
  --label "$L2" --apply --auto-apply

# 9. only now, schedule it
sudo systemctl enable --now afldb-settle-afltables.timer
```

Step 6 prints `canonicalRowsInserted`, `canonicalRowsUpdated`,
`canonicalApplicationsLogged`, `canonicalApplyRefusals` and
`canonicalApplyFailures`. Step 8 must print zero for the first three: a
canonical or ledger write on a rerun over identical source data is stop
condition **SC3**, not a curiosity.

**Prerequisites.** The migration and `db:privileges` go **before** the code
that depends on them (the `AFLDB-ISSUE-027` lesson): the settle path needs
migration `083_canonical_auto_apply.sql` applied and
`tools/maintenance/privileges.sql` re-run, or the applier fails closed on a
missing grant. Do not start step 3 on a host whose schema is behind.

### Running, inspecting and stopping it

```bash
systemctl list-timers afldb-settle-afltables.timer   # next and last firing
systemctl status afldb-settle-afltables.service      # last run's result
journalctl -u afldb-settle-afltables --since yesterday
journalctl -u afldb-settle-afltables -f              # live, during a manual run

sudo systemctl start afldb-settle-afltables.service  # one supervised run, now

sudo systemctl disable --now afldb-settle-afltables.timer   # stop scheduling
```

Disabling the timer is always safe: the chain holds no state between runs, so
nothing is left half-done. The service unit stays installed and can still be
started by hand.

### A FAILED unit that still wrote data — `--require-complete-source`

`AFLDB-ISSUE-128`. The settle CLI's last step evaluates a **source-completeness
verdict** and, under `--require-complete-source`, exits non-zero when the
verdict is not `complete`. The unit then shows `failed` even though the run
committed.

**That is deliberate, and it is not a half-finished write.** The exit code is
decided *after* `runSettleCli()` returns, so the transaction has already
committed: every record AFLDB could represent has landed and the rerun is
still idempotent. What the exit code reports is that AFL Tables supplied rows
this chain could **not** represent, which before ISSUE-128 was invisible — the
2026-09-03 measurement was 209 matches acquired, 207 emitted, 94 rows dropped,
exit 0, and a nightly job reporting success.

When the unit goes red, read the emission step, not the settle step:

```bash
journalctl -u afldb-settle-afltables --since yesterday | grep -A 12 'SOURCE COMPLETENESS'
```

It names the family, the reason and the offending source lines. The verdict is
computed from the source's own counters, never from a calendar, so a bye, the
gap before finals and the whole off-season all read `complete` — a red unit
always means a real coverage gap. The same verdict is on
`/admin/current-season` above the run counters.

Removing the flag would restore the silent-success behaviour and is not a fix
for a red unit.

### Cadence, failure and retry

| | |
|---|---|
| Cadence | `OnCalendar=*-*-* 04:30` local, `RandomizedDelaySec=15min`. The overnight settle window (`docs/acquisition/AFLDB-2026-API-ACQUISITION.md` §5, T+12–24 h) |
| Missed run | `Persistent=true` — a run missed because the host was down catches up once after boot |
| Out of season | The script finds no in-progress season, logs that, and exits 0. The timer is left enabled all year |
| Failed acquisition | The manifest is written last, so a failed fetch leaves no manifest; the script removes the manifest-less working directory. The adjudicator never runs and PostgreSQL is never opened. The unit fails, `systemctl status` shows it, and the next firing retries from the start |
| Failed settle | The transaction rolls back. The snapshot and its manifest are kept — they are the evidence — and are never rewritten, because snapshots are immutable |
| Fallback | **None.** Squiggle and Kali are not invoked and cannot write canonically. A failure means the season does not advance, never that a weaker source silently does it instead |

Each run writes a new snapshot under `data/sources/` (gitignored) and a new
provenance manifest under `docs/rebuild-manifests/afltables_fitzroy_core/`,
which is a **tracked** directory — so nightly manifests accumulate there as
untracked files. They are small and `git pull` is unaffected, but they are
worth pruning or committing periodically rather than letting a season's worth
build up unnoticed.

### On-demand refresh from the admin surface (`AFLDB-ISSUE-127`)

A Super Admin can start **this same unit** immediately from
`/admin/current-season` — "Fetch current AFL data now" — instead of waiting for
04:30. It is the same script, the same gates, the same transaction and the same
fail-closed behaviour; the control takes no season, label, source or force
input, because the action accepts none.

**Concurrency is systemd's.** A start job for a unit that already has one is
merged into the existing job, so a second Super Admin, or a click landing
during the timer's run, cannot start a second ingestion transaction. The panel
reports "already running" rather than pretending it started something.

**The result comes from `import_batches`, not the journal.** The settle stamps
its whole counter set into `validation_result` on the way out, so the panel
reads the structured row. Note that the row is written *inside* the run's
transaction and is invisible until it commits — during a run the panel shows
the unit as running and the *previous* run's batch, labelled as such.

Two host steps enable it. **Until both are done the control is inert and says
so**; nothing fails and nothing half-works, and the nightly timer is unaffected
either way.

```bash
cd ~/projects/afldb

# 1. The permission. One action, one verb, one unit, one user.
sudo install -m 644 -o root -g root   deploy/afldb-settle-afltables-trigger.rules   /etc/polkit-1/rules.d/50-afldb-settle-afltables.rules
sudo systemctl restart polkit

# 2. The application flag, then a restart to pick it up.
echo 'AFLDB_SETTLE_TRIGGER=systemd' >> .env
sudo systemctl restart afldb

# Verify, as the app user, WITHOUT sudo. This is the exact call the app makes.
sudo -u arm /usr/bin/systemctl show afldb-settle-afltables.service --property=ActiveState
sudo -u arm /usr/bin/systemctl start --no-block afldb-settle-afltables.service
systemctl status afldb-settle-afltables.service
```

**Why polkit and not sudo.** `deploy/afldb.service` sets
`NoNewPrivileges=true`. Under that, the kernel ignores the setuid bit, so
`sudo` cannot elevate no matter what `/etc/sudoers.d` permits — making sudo
work would mean removing that hardening from the public web service. A
`systemctl start` from a non-root user is instead a D-Bus call to PID 1
authorized by polkit, which involves no setuid binary and so works unchanged.
**`deploy/afldb.service` is not modified.** Reading unit state
(`systemctl show`) is unprivileged and needs no rule at all.

**What the rule does not grant.** Not `stop`, `restart`, `enable`, `disable`,
`mask` or `kill`; not any other unit; no shell and no root. The unit name is
spelled out rather than pattern-matched, so a future similarly-named unit
cannot inherit the grant.

**To revoke it,** remove either half — delete the rules file and restart
polkit, or unset `AFLDB_SETTLE_TRIGGER` and restart `afldb`. The scheduled
timer keeps running in both cases.

## 8. Testing

```bash
npm run test                 # unit + integration (integration needs afldb_test)
npx playwright test          # E2E, desktop and mobile
node tools/maintenance/loadtest.mjs --concurrency 20 --duration 20
```

Unit tests (formatting, query-spec parsing) need no database. Integration
tests do, and refuse to run unless `AFLDB_TEST_DATABASE_URL` names a database
whose name ends in `_test` — they issue real mutations, so the guard is an
allowlist rather than a check for `afldb_dev`. Constraint tests run inside a
transaction that always rolls back, so a regressed constraint cannot commit
the row that proves it.

`tests/integration/release-gates.test.ts` holds the conditions that must never regress, and separates **immutable** historical assertions from **snapshot** ones pinned to the loaded 2026 data. A snapshot failure after importing newer data means "re-pin", not "bug"; an immutable failure is a real defect.

Playwright starts its own server and refuses to reuse one already on 3100. That is deliberate: a leftover process previously caused the suite to report failures for code that had already been fixed. Clear it with `fuser -k 3100/tcp`.

Playwright needs `libasound2`, extracted without root into `~/.local/chromedeps`:

```bash
export LD_LIBRARY_PATH="$HOME/.local/chromedeps/extracted/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH"
```

## 8a. Backups

```bash
tools/maintenance/backup.sh              # dump AFLDB_BACKUP_DATABASE_URL
tools/maintenance/restore-test.sh        # prove the newest dump restores
```

`backup.sh` requires `AFLDB_BACKUP_DATABASE_URL` and does **not** fall back to
the owner DSN: a backup must not run with write privileges. The dump is
written under a `.partial` name and renamed only after `pg_restore --list`
reads it back, so an interrupted dump cannot become the newest restore
candidate. Filenames take the database name from the DSN, so each database
keeps its own retention series.

`restore-test.sh` restores into `afldb_restore_test` and nothing else — it
replaces the database name in the DSN rather than substituting a string, and
refuses any other target. It empties the target first, so a failed restore
cannot leave the previous generation in place for the parity checks to pass
against. Only the two known extension-ownership errors are tolerated; any
other `pg_restore` output is fatal.

A restore that succeeds proves this dump. It does not prove behaviour on a
corrupt dump or a wrong target — neither is exercised.

## 9. Configuration

All configuration is in `/home/arm/projects/afldb/.env` (mode 600, owner `arm`), generated by the install script. It is gitignored; `.env.example` is the committed template.

`NODE_ENV` is deliberately **not** set in `.env` — Next.js sets it itself, and overriding it produces inconsistent builds.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | read-only app role (`afldb_app`) |
| `AFLDB_IMPORT_DATABASE_URL` | ETL writes (`afldb_import`) |
| `AFLDB_OWNER_DATABASE_URL` | migrations, target `dev` (`afldb_owner`) |
| `AFLDB_PROD_DATABASE_URL` | migrations, target `prod` — unset here |
| `AFLDB_TEST_DATABASE_URL` | integration tests (must name a `_test` database) |
| `AFLDB_BACKUP_DATABASE_URL` | `pg_dump` (`afldb_backup`, read-only) |
| `AFLDB_ENV` | `development` \| `production` — **transport security**: Secure cookies, HSTS, strict CSP |
| `AFLDB_INDEXING` | `on` enables indexing; anything else = `noindex`. Separate from `AFLDB_ENV` |
| `AFLDB_WORKERS` | cluster worker count |
| `AFLDB_POOL_MAX` | app pool size **per worker** (default 10) |
| `AFLDB_BUILD_WORKERS` | caps `next build` static-generation workers; unset = Next's default |
| `AFLDB_STATEMENT_TIMEOUT_MS` | per-connection statement timeout |
| `AFLDB_SETTLE_TRIGGER` | `systemd` enables the Super Admin on-demand settle trigger (§7b). Anything else, including unset, leaves it inert |

**The web service does not receive them all.** `.env` is the whole project's
configuration, so the unit loads it and then drops the import, owner, test and
backup DSNs with `UnsetEnvironment=`. The service process holds only
`DATABASE_URL`, which cannot write. Migrations, imports and backups read
`.env` directly and are unaffected.

`npm run db:migrate` targets `dev`. `AFLDB_MIGRATE_TARGET` accepts `dev`,
`test` or `prod` and **refuses to run on anything else** rather than falling
back to development.

## 10. Indexing safety

`robots.txt` returns `Disallow: /` and every page emits `noindex` unless `AFLDB_INDEXING=on`. It fails closed, so the development server cannot leak into search results, and the beta gate overrides it regardless — a crawler behind a gate can only index the door. This flag is turned on only at cutover, and is read at build time, so it needs a rebuild rather than a restart.

**It is deliberately not the same flag as `AFLDB_ENV`.** That one is transport security — `Secure` on the session cookie, HSTS, and the CSP that drops `'unsafe-eval'` — and every host reachable over public HTTPS sets it to `production` whether or not it is ready to be indexed. The two were one flag until 2026-08-16, which meant holding a pre-cutover HTTPS host out of search results also stripped `Secure` from its admin cookies. See `src/lib/indexing.ts`.

## 11. Rollback

```bash
cd ~/projects/afldb
git log --oneline -10
git checkout <previous-commit>
npm ci && npm run build
sudo systemctl restart afldb
```

Migrations are forward-only: the runner refuses to run if an applied migration has been edited. To reverse a schema change, add a new migration. For a data rollback, restore from backup — see [backup-restore.md](backup-restore.md).

## 12. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Site loads unstyled | `.next/static` missing from standalone | `npm run build` (runs `prepare-standalone`) |
| `EADDRINUSE :3100` | an old server still running | `fuser -k 3100/tcp` |
| Build fails, "too many clients" | prerender workers × pool size | pool already drops to 2 during build; against a managed database also set `AFLDB_BUILD_WORKERS` (§5) |
| Serving fails, "too many clients" | `AFLDB_WORKERS × (AFLDB_POOL_MAX + 3)` over the plan limit | lower either, or raise the plan (§5) |
| Pages slow under load | worker count | raise `AFLDB_WORKERS` **and** the connection limit together (§5) |
| `permission denied for table` | role lacks a grant | grants belong in a migration, not a manual `GRANT` |
| Chromium won't launch | `libasound2` | set `LD_LIBRARY_PATH` (§8) |
