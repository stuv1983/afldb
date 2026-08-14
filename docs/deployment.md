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
| Node | 22.23.2 via nvm (user-local, no root) |
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

`npm run build` runs `next build` then `tools/build/prepare-standalone.mjs`, which copies `.next/static` into the standalone bundle and creates `.next/cache`. **Both are required** — without them the site starts but every stylesheet 404s and ISR cannot persist.

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

## 6. Health

```bash
curl http://127.0.0.1:3100/api/health     # direct
curl http://10.0.40.100:8090/api/health   # through the proxy
```

Returns `{"status":"ok","database":"ok","latencyMs":N}`, or HTTP 503 with `"database":"unreachable"`. It deliberately reveals no version, hostname or connection detail. Caddy polls it every 30 s.

## 7. Data refresh

Run in this order. Each step is idempotent and safe to repeat.

```bash
cd ~/projects/afldb
source .venv/bin/activate    # or use ./.venv/bin/python directly

./.venv/bin/python tools/migration/import_legacy_afl.py       # ~114s  core reload
./.venv/bin/python tools/migration/enrich_birth_dates.py      # ~6s    DOB recovery
./.venv/bin/python tools/migration/import_draft.py            # ~2s    draft links
./.venv/bin/python tools/migration/rebuild_derived.py         # ~30s   summaries
./.venv/bin/python tools/validation/validate_migration.py     # every check must pass

npm run build && sudo systemctl restart afldb                 # refresh cached pages
```

The order matters. `rebuild_derived.py` must run last: it reads the tables the earlier steps write, and its first target, `season_metadata`, decides whether a season is still in progress — which in turn decides whether that season's Brownlow reads as a zero or as "not yet awarded".

Options: `--dry-run` on every script, plus `--groups <name>...` and `--list-groups` on the legacy import and `--targets` on the rebuild.

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
| `AFLDB_ENV` | `development` \| `production` — **gates indexing** |
| `AFLDB_WORKERS` | cluster worker count |
| `AFLDB_STATEMENT_TIMEOUT_MS` | per-connection statement timeout |

**The web service does not receive them all.** `.env` is the whole project's
configuration, so the unit loads it and then drops the import, owner, test and
backup DSNs with `UnsetEnvironment=`. The service process holds only
`DATABASE_URL`, which cannot write. Migrations, imports and backups read
`.env` directly and are unaffected.

`npm run db:migrate` targets `dev`. `AFLDB_MIGRATE_TARGET` accepts `dev`,
`test` or `prod` and **refuses to run on anything else** rather than falling
back to development.

## 10. Indexing safety

`robots.txt` returns `Disallow: /` and every page emits `noindex` unless `AFLDB_ENV=production`. The development server therefore cannot leak into search results. This flag is flipped only at cutover.

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
| Build fails, "too many clients" | prerender workers × pool size | already handled: pool drops to 2 during build |
| Pages slow under load | worker count | raise `AFLDB_WORKERS`, watch `max_connections` |
| `permission denied for table` | role lacks a grant | grants belong in a migration, not a manual `GRANT` |
| Chromium won't launch | `libasound2` | set `LD_LIBRARY_PATH` (§8) |
