# AFLDB V2 — isolated shadow rehearsal and shadow comparison plan

**Current execution package (2026-10-20):** use
[production-shadow-commands.md](production-shadow-commands.md) for the reviewed production-data
rehearsal, migrations 111–115, complete preservation captures and separate release-gate results.
Its [owner policy](migration-acceptance-2026-10-20.md) supersedes the older migration-blocker
classification and baseline-112 examples below. No approved local production backup is available.
Prior local mechanics are retained evidence; no production-data rehearsal has occurred.
The old full-suite/rebuild/visual examples are outside this task's execution authority.

Status: written in Stage 6 (Launch E, 2026-10-19). **Every command in this document is NOT
EXECUTED.** V2 has no database, host or network access (plan §1). The tools it names exist, are
committed, and are unit-tested on committed synthetic inputs, fakes and in-memory PGlite only
(`docs/v2/progress.md`, Stage 6); none has run against PostgreSQL. Running this rehearsal is the
only way to close the "rehearsal" gaps in `docs/v2/known-gaps.md` (001, 002, 003, 007, 009, 017,
022, 026).

The rehearsal never touches production, DEV (`afldb_dev`) or `afldb_test` without the approval
named at the step. It runs V2 against a **restored copy** in a database created for it.

## 1. Who runs it and what must be approved first

Runs it: an **operator** with shell and PostgreSQL access to the rehearsal host. Approves it: the
**owner**, per item, before the step that needs it (`docs/v2/go-no-go.md` §4):

| Approval | Covers | Step |
|---|---|---|
| S-A1 | taking or reusing a production dump and restoring it on the rehearsal host. The copy holds the auth tables (accounts, roles, audit) as well as football data (risk RISK-14); it is dropped at §11 | §3 |
| S-A2 | creating the databases `afldb_v2_shadow_test` (and, if used, `afldb_v2_shadow_<tag>_test` copies) on the rehearsal host | §3 |
| S-A3 | state-changing steps on the shadow copy: migrations, privileges, the site setting, the AFL API settle replay, curated proposals, both rollback paths | §5-§9 |
| S-A4 | building and running the V2 application against the shadow copy on a local port (no public exposure), and installing the Playwright browser if it is absent (a network download) | §6 |
| S-A5 | rebuilding and using `afldb_test` for the integration suites (`afldb_test` is shared; mutating it needs the owner) | §7 |

## 2. Isolation rules (every step)

1. **Target name.** Only a database named `afldb_v2_shadow[_<tag>]_test` (pattern
   `^afldb_v2_shadow(?:_[a-z0-9]+)*_test$`, `packages/domain/src/shadow-target.ts`) is a shadow
   target. `afldb`, `afldb_prod`, `afldb_dev`, `afldb_test`, `afldb_restore_test`, `code_test_db`,
   `postgres` and the templates are refused by name. A name containing `%` is refused (postgres.js
   opens the raw path). The name ends in `_test`, so the D5 test-DSN policy (ADR 0005) and the
   existing test-database refusals treat it as a test database too.
2. **A dedicated checkout with no `.env`.** Clone the reviewed V2 commit into its own directory on
   the rehearsal host (for example `~/afldb-v2-shadow`). It must contain no `.env*` file other than
   `.env.example`: the repository's tools fill unset DSN variables from `.env`
   (`tools/db/migrate.ts`, `tools/db/privileges.ts`, `tools/current-season/load-env.ts`), so a stray
   `.env` could redirect a step to DEV.
3. **One environment file, shadow DSNs only.** `~/.afldb-v2-shadow.env` (mode 600, never committed,
   never printed) exports the shadow DSNs and the application settings the app needs. DSNs carry
   **no password** (use `~/.pgpass`), so a DSN on a command line exposes no secret. Variable names
   used below: `AFLDB_V2_SHADOW_OWNER_DATABASE_URL` (owner role), `AFLDB_V2_SHADOW_IMPORT_DATABASE_URL`
   (`afldb_import`), `AFLDB_V2_SHADOW_APP_DATABASE_URL` (`afldb_app`),
   `AFLDB_V2_SHADOW_AUTH_DATABASE_URL` (`afldb_auth`), all naming `afldb_v2_shadow_test`.
4. **The guard before every state-changing step.** In the shell that will run the step, after
   exporting exactly the variables that step needs:

   ```bash
   npx tsx tools/v2/shadow-guard.ts check --require <VAR> [--require <VAR> ...] [--root <checkout>]
   ```

   Exit 0 prints `NAME -> <database>` for each connection variable and `SHADOW TARGET OK`; exit 2
   prints every finding and `SHADOW TARGET REFUSED: do not run the shadow step.` It refuses when a
   required variable is unset, when ANY set `*DATABASE_URL*` variable names a non-shadow database,
   when `PGSERVICE`/`PGSERVICEFILE` are set or `PGDATABASE` is not a shadow name, and when the
   checkout holds a `.env*` file other than `.env.example`. It makes no connection and prints no
   DSN. Limitation: a DSN with an empty host lets libpq/postgres.js fall back to `PGHOST`; the
   guard checks names, not hosts, so keep `PGHOST` unset or pointing at the rehearsal host. The
   guard also judges only the URL path, not DSN query parameters (postgres.js passes unknown ones as
   connection settings): write the shadow DSNs without query parameters. The capture tools still
   force `BEGIN ... READ ONLY`, read the state back and check `current_database()`.
5. **Evidence directory.** `~/afldb-v2-shadow-evidence/<STAMP>/`, outside the checkout. Every
   capture tool creates its output exclusively (`wx`) and refuses an existing file.

## 3. Prepare the copy (S-A1, S-A2)

```bash
set -a; . ~/.afldb-v2-shadow.env; set +a
cd ~/afldb-v2-shadow && git rev-parse HEAD          # the reviewed V2 commit; record it
npm ci                                                # the lockfile's packages; record the exit code

# the dump: the newest verified production backup (docs/backup-restore.md §1-§2), sha256 recorded
sha256sum <production dump>.dump

sudo -u postgres createdb -O <the role that owns afldb_test> afldb_v2_shadow_test
sudo -u postgres psql -d afldb_v2_shadow_test -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent;'
npx tsx tools/v2/shadow-guard.ts check --require AFLDB_V2_SHADOW_OWNER_DATABASE_URL
pg_restore --dbname="$AFLDB_V2_SHADOW_OWNER_DATABASE_URL" --no-owner --no-privileges --jobs=4 <production dump>.dump
```

`pg_restore` prints "must be owner of extension" for `pg_trgm`/`unaccent`; that is expected
(`docs/backup-restore.md` §2). The restored grants are absent (`--no-privileges`), which does not
affect §4: every capture reads as the owner role.

Gate 3: `pg_restore` exit 0 apart from the two known messages; the read-only check
`SELECT name FROM afldb_meta.schema_migrations ORDER BY name DESC LIMIT 3;` shows `110_...` as the
newest applied migration (111 and 112 are not in production).

## 4. BEFORE captures (read-only)

Every capture opens one read-only, repeatable-read transaction and rolls it back. The Stage 6
tools (`shadow-capture.ts`, `shadow-award-reports.ts`) have no override flag and refuse every
non-shadow target with exit 2, writing nothing. The Stage 2 manifest producer (item 1) is
different: it accepts any `*_test` database (including `afldb_test`) and, with its two non-test
flags, any database. **Never pass those flags here**; the `shadow-guard` run immediately before it
is what restricts it to the shadow copy.

```bash
E=~/afldb-v2-shadow-evidence/<STAMP>; mkdir -p "$E"
npx tsx tools/v2/shadow-guard.ts check --require AFLDB_V2_SHADOW_OWNER_DATABASE_URL

# 1. sealed-history manifest (Stage 2 producer; docs/v2/historical-manifest-spec.md)
npx tsx tools/v2/historical-manifest.ts produce --dsn-env AFLDB_V2_SHADOW_OWNER_DATABASE_URL --out "$E/before.manifest.json"

# 2. row-count census of every base table (default schemas public, staging, staging_aflw, aflw, afldb_meta)
npx tsx tools/v2/shadow-capture.ts row-counts --dsn-env AFLDB_V2_SHADOW_OWNER_DATABASE_URL --out "$E/before.row-counts.json"

# 3. Coleman: derive and compare every contract season (the contract starts in 1980,
#    data/reference/coleman-derivation.json first_season). --settled is the operator's attestation
#    that the sealed seasons are settled; without it every season is not_derivable (season_not_settled).
npx tsx --conditions=react-server tools/v2/shadow-award-reports.ts coleman \
    --dsn-env AFLDB_V2_SHADOW_OWNER_DATABASE_URL --from 1980 --through 2025 --settled --out "$E/before.coleman.json"

# 4. Brownlow: one report per season with staged AFL API votes. List them read-only first:
#    SELECT DISTINCT season FROM staging.afl_api_brownlow_vote WHERE family = 'brownlow_match_votes' ORDER BY 1;
npx tsx --conditions=react-server tools/v2/shadow-award-reports.ts brownlow \
    --dsn-env AFLDB_V2_SHADOW_OWNER_DATABASE_URL --season <S> --out "$E/before.brownlow-<S>.json"   # once per season

# 5. coverage registry claims (offline, from the checkout)
npx tsx tools/v2/shadow-parity.ts coverage-export --out "$E/before.coverage.json"
```

Notes. The row-count census counts base tables only (a partitioned table through its parent; views,
such as the `aflw` schema's, contribute nothing) and refuses a missing schema or a table with
row-level security. The Coleman capture loads stored Coleman rows for all seasons, so
`storedSeasonsWithoutOutcome` may list seasons outside the range; the before and after captures
behave identically. A Coleman `disagree` or a Brownlow `discrepancies`/`refused` outcome is data,
not a capture failure. Exit codes: capture tools 0 written, 2 refused or failed (nothing written);
`historical-manifest.ts produce` 0 written, 2 refused or failed; `coverage-export` 0 written (it
records registry problems in the file and the comparison fails on them), 3 error.

## 5. V2 schema: migrations 111-112 and privileges (S-A3)

```bash
# the repository runner's "test" target is used with the shadow DSN; afldb_test is NOT touched
export AFLDB_TEST_DATABASE_URL="$AFLDB_V2_SHADOW_OWNER_DATABASE_URL"
npx tsx tools/v2/shadow-guard.ts check --require AFLDB_TEST_DATABASE_URL
npm run db:migrate:test -- --status       # 111 and 112 pending, nothing else
npm run db:migrate:test                   # applies 111 then 112
npm run db:privileges:test                # tools/maintenance/privileges.sql on the shadow copy
unset AFLDB_TEST_DATABASE_URL
```

Gate 5: the status shows 0 pending; the read-only grant query of `docs/v2/cutover-runbook.md`
step 6 returns the expected matrix. Then a **post-migration parity point**: repeat §4 items 1, 2
into `$E/postmig.*` and run §8 with `postmig` as "after" for those two checks only (the other
checks report INCOMPLETE there by design). Expected: `historical_manifest` pass,
`table_row_counts` pass with exactly three `V2_TABLE_ADDED` info findings.

## 6. Build, run and look (S-A4; V2-GAP-002, V2-GAP-022)

```bash
export DATABASE_URL="$AFLDB_V2_SHADOW_APP_DATABASE_URL" AFLDB_AUTH_DATABASE_URL="$AFLDB_V2_SHADOW_AUTH_DATABASE_URL" \
       AFLDB_IMPORT_DATABASE_URL="$AFLDB_V2_SHADOW_IMPORT_DATABASE_URL" NEXT_TELEMETRY_DISABLED=1
npx tsx tools/v2/shadow-guard.ts check --require DATABASE_URL --require AFLDB_AUTH_DATABASE_URL --require AFLDB_IMPORT_DATABASE_URL
npm run build                             # first V2 production build; record exit code and duration
PORT=3901 HOSTNAME=127.0.0.1 npm run start   # local only; never behind Caddy or a public port
```

Then, signed in as an Admin and as a Super Admin (accounts present in the restored copy), the owner
eyeballs every screen of `docs/v2/admin-operations.md` §6 at 1280x800 and 390x844 and keeps
screenshots in `$E/visual/`. Optional automation with this repository's Playwright (check the
options with `npx playwright screenshot --help` first; `npx playwright install chromium` is a
network download and part of S-A4):

```bash
npx playwright open --save-storage "$E/visual/session.json" http://127.0.0.1:3901/admin    # sign in, close
npx playwright screenshot --load-storage "$E/visual/session.json" --viewport-size "1280,800" --full-page \
    http://127.0.0.1:3901/admin/operations "$E/visual/operations__1280x800.png"
```

(`session.json` holds a live session cookie for the shadow app: delete it at §11.) Prose approval
is not evidence: either images exist and the owner records a verdict, or the screen stays
`VISUAL: UNVERIFIED`.

**Curated proposal smoke** (through the running app, Super Admin): create two proposals for the
open season 2026 from `/admin/operations/awards`, validate both, approve one and reject the other;
check `/admin/operations/awards/[id]` shows the decision history. A sealed-season approval must be
refused without a 20-2000 character note (plan §7 R-029); try it once and record the refusal. Do
not approve any sealed-season proposal: that is an audited correction and would (correctly) fail
the parity's zero-tolerance check. **Coleman smoke:** compare one season on
`/admin/operations/coleman` (read-only). Do not publish unless the owner wants the ledger exercised;
a publication writes `derived_award_results` only (V2-GAP-021), which the parity treats as info.

## 7. AFL API settle replay and the suites (S-A3, S-A5)

**Replay, never acquire.** The settle reads an already-acquired snapshot from
`data/sources/afl_api/matches/<label>/` (git-ignored): copy one retained 2026 snapshot directory
from the host's main checkout into the shadow checkout, read-only, and record its label and
manifest hash. No acquire command is run; no AFL API request is made.

```bash
# the settle refuses unless the current-season switch is on in the SHADOW copy. Check, then set it there only:
#   SELECT key, value FROM site_settings WHERE key = 'acquisition.afl_api_current_season_enabled';
#   (verify the stored jsonb shape against parseSiteSettings in src/lib/site-settings.ts before writing)
#   INSERT INTO site_settings (key, value) VALUES ('acquisition.afl_api_current_season_enabled', 'true'::jsonb)
#     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
export DATABASE_URL="$AFLDB_V2_SHADOW_APP_DATABASE_URL" AFLDB_IMPORT_DATABASE_URL="$AFLDB_V2_SHADOW_IMPORT_DATABASE_URL"
npx tsx tools/v2/shadow-guard.ts check --require DATABASE_URL --require AFLDB_IMPORT_DATABASE_URL
npx tsx tools/current-season/settle-afl-api.ts --label <label> --validate-only
npx tsx tools/current-season/settle-afl-api.ts --label <label> --dry-run --auto-apply
npx tsx tools/current-season/settle-afl-api.ts --label <label> --apply --auto-apply
npx tsx tools/current-season/settle-afl-api.ts --label <label> --apply --auto-apply      # idempotence
npx tsx tools/current-season/settle-afl-api.ts --label <label> --report
```

Gate 7a: the settle preflight proves the control and writer DSNs name the same database
(`src/lib/acquisition/afl-api-ingestion-safety.ts`); the season seal admits only 2026 (an
in-progress season); the second `--apply` prints 0 for `canonicalRowsInserted`,
`canonicalRowsUpdated` and `canonicalApplicationsLogged` (as `docs/deployment.md` §7b step 8
requires of a rerun); `unresolvedIdentityPlayer` is 0 or every unit it names is refused (never a
placeholder). The machine-readable V2 reconciliation report has no producer in the CLI yet
(V2-GAP-027): keep the printed counters and the `--report` output as the evidence. A sealed season
label must be refused before any connection opens (`tests/afl-api-settle-cli-gate.test.ts`); try
one `--dry-run` with a 2025 label if one is retained, and record the refusal.

**Suites on Linux (V2-GAP-001, 003, 009, 013, 017).** Unit suite in the shadow checkout, with no
DSN in the environment: `env -u DATABASE_URL -u AFLDB_TEST_DATABASE_URL npx vitest run --no-cache`;
compare the ` FAIL ` lines with `docs/v2/evidence/baseline-failures.txt` (on Linux, the Windows-only
lines are expected to pass). Integration suites (S-A5): they were written for a rebuilt
`afldb_test`, so the authoritative run is on `afldb_test` rebuilt at the V2 commit, which is
destructive and needs the owner:

```bash
npm run db:test:rebuild -- --acknowledge-destroy afldb_test          # docs/deployment.md §6a
AFLDB_TEST_DATABASE_URL=<afldb_test owner DSN> AFLDB_TEST_IMPORT_DATABASE_URL=<afldb_test import DSN> \
    npx vitest run --no-cache tests/integration
```

Record the counts; in particular `privileges`, the awards suites, `settle-afl-api*`,
`admin-upload-route`, `email-intake` and `submission-promotion`.

## 8. AFTER captures and the parity verdict

Repeat every §4 command into `$E/after.*` (identical `--from`, `--through`, `--settled`,
`--season` and `--eligibility-rule` values), then:

```bash
npx tsx tools/v2/shadow-parity.ts compare \
    --manifest-before "$E/before.manifest.json"     --manifest-after "$E/after.manifest.json" \
    --row-counts-before "$E/before.row-counts.json" --row-counts-after "$E/after.row-counts.json" \
    --coleman-before "$E/before.coleman.json"       --coleman-after "$E/after.coleman.json" \
    --brownlow-before "$E/before.brownlow-<S>.json" [...] --brownlow-after "$E/after.brownlow-<S>.json" [...] \
    --coverage-before "$E/before.coverage.json"     --coverage-after "$E/after.coverage.json" \
    --out "$E/parity.json" --summary "$E/parity.txt"
```

Exit-code contract (`tools/v2/shadow-parity.ts`): **0 PASS, 1 FAIL, 2 INCOMPLETE, 3 ERROR**
(usage error, unknown or duplicate flag, `--summary` equal to `--out`, an output file that already
exists, a write failure). Verdict precedence: any failing check makes FAIL; otherwise any
incomplete check makes INCOMPLETE; only five passing checks make PASS. A missing, unreadable or
invalid input makes its check incomplete, **never** pass. The report (`afldb.v2.shadow-parity-report`
v1) is written for every verdict, labels inputs by file basename only, never repeats file content,
and embeds the thresholds below.

### Parity thresholds (policy `v2.parity.1`, `packages/derived/src/shadow-parity.ts`)

| Check | Fails on | Info only (never gates) |
|---|---|---|
| `historical_manifest` (zero tolerance on sealed history) | every comparator violation, unverified and review finding: `ROWS_CHANGED`, `KEYS_CHANGED`, `FACTS_CHANGED`, `TABLE_MISSING`, `REFERENCE_ROWS_DECREASED`, `REFERENCE_CHANGED`, `METADATA_CHANGED` on a sealed bucket, every definition change, `METADATA_COLUMNS_CHANGED`, `SPEC_VERSION_DIFFERS`; and `SEALED_RANGE_DIFFERS` (a rehearsal must not move the seal). Stable ids are digested as facts and reference tables whole, so any id change fails | `OPEN_SEASON_CHANGED` (2026), `TABLE_ADDED` |
| `table_row_counts` | `SCHEMAS_DIFFER`, `TABLE_DROPPED`, `UNEXPECTED_TABLE_ADDED`, `V2_TABLE_ABSENT` (each of the three V2 tables must exist after), `ROWS_DECREASED` in a non-V2 table | `V2_TABLE_ADDED` and `V2_TABLE_ROWS_CHANGED` (the only documented expected deltas: migrations 111/112), `ROWS_INCREASED` in a non-V2 table (season-grained zero tolerance is the manifest's job) |
| `coleman` | per season present before: `SEASON_MISSING`, `CATEGORY_CHANGED`, `STORED_WINNERS_CHANGED`, `DERIVED_WINNERS_CHANGED`, `INPUT_CHANGED`, `REFUSAL_CHANGED`; `STORED_SEASONS_WITHOUT_OUTCOME_CHANGED` | `PREEXISTING_DISAGREEMENT`, `PREEXISTING_NOT_DERIVABLE` (listed for owner reconciliation, V2-GAP-015), `SEASON_ADDED` |
| `brownlow` | for a season complete before: `SEASON_MISSING`, `SEASON_STATE_CHANGED`, `OUTCOME_CHANGED`, `PLAYER_TOTALS_CHANGED`, `AWARD_PRESENTATION_CHANGED`, `FINDINGS_CHANGED` | `PREEXISTING_DISCREPANCIES`, `PREEXISTING_REFUSED`, `IN_PROGRESS_SEASON_CHANGED`, `SEASON_ADDED` |
| `coverage` | `COVERAGE_REGISTRY_INVALID`, `COVERAGE_CELL_MISSING`, `COVERAGE_CHANGED` | — |
| every check | — (`INPUT_MISSING`, `INPUT_INVALID` make the check incomplete) | — |

Changing a threshold needs a new policy version and the owner's agreement; a FAIL is reconciled by
the owner (explained and accepted in writing in §10), never by editing the policy to pass.

Expected outcome of a clean rehearsal: PASS, with info findings for the 2026 season (settle replay,
curated smoke), the three V2 tables, and any pre-existing Coleman disagreements or Brownlow
discrepancies (each reviewed by the owner before production, V2-GAP-015/016).

## 9. Rollback rehearsal (S-A3; V2-GAP-026)

On the shadow copy, in this order, recording each gate:

1. **Code rollback.** Check out `PREV` (the commit production serves) in a second clean checkout,
   `npm ci`, `npm run build` against the shadow DSNs, start it on another local port, confirm the
   health endpoint, and run its preflight in read-only/inspection mode to observe the
   `unknown-applied-migration` finding for 111/112 that `docs/v2/rollback-runbook.md` §4.2 predicts.
2. **Database reversal.** `docs/v2/rollback-runbook.md` §5 against `afldb_v2_shadow_test` (exports,
   the three drops, the two ledger-row deletes, PREV's `privileges.sql`), then gate R5 and a manifest
   comparison against `$E/after.manifest.json` restricted to the historical tables: it must be
   `sealed-scope-identical`.
3. **Roll forward again** with the V2 checkout (§5) to prove the ledger rows were removed correctly
   (111/112 apply again cleanly).

## 10. Rehearsal record (fill in; nothing below has happened)

| Item | Value |
|---|---|
| V2 commit, `PREV` commit, rehearsal host, operator, date | — |
| approvals S-A1..S-A5 (reference each) | — |
| dump file name and sha256 | — |
| gate results §3, §5, §6, §7a, §9 | — |
| `npm run build` exit code, duration | — |
| unit suite counts on Linux; integration suite counts | — |
| parity verdict and `parity.json` sha256; every FAIL with the owner's reconciliation | — |
| visual verdict per screen (or VISUAL: UNVERIFIED) | — |
| Coleman disagreements reviewed; Brownlow outcomes reviewed | — |

## 11. Teardown

Stop both local apps; delete `$E/visual/session.json`; drop the copy
(`sudo -u postgres dropdb afldb_v2_shadow_test`); delete the shadow checkout's copied snapshot
directory and the environment file if it held anything beyond the shadow DSNs; keep the evidence
directory (it contains counts, digests and reports, no row content).
