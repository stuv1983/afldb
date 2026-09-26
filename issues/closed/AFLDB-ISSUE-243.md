# AFLDB-ISSUE-243 — Promotion preflight cannot validate target credentials and rejects known DEV operational artefacts

- **Status:** **Resolved (2026-09-26)** on four fresh operator-run read-only §8 preflights on DEV,
  all READY; see §11. Opened 2026-09-25. Implemented and DB-free validated. *(2026-09-26: committed
  `4df98d07` and deployed to DEV. The §10 closure audit kept this issue open until the four READY
  results were supplied.)*
- **Severity:** High. It blocks ISSUE-237 L4 at step A2, before any dump, candidate or swap.
- **Area:** operator workflow tooling. That is `tools/dev/preflight-core.ts` and
  `tools/dev/preflight.ts`, plus `docs/production-promotion.md` §3 and ISSUE-237 §11d A2.
- **Origin:** the first real ISSUE-237 L4 A2 run on DEV (2026-09-25, DEV deployed at `bfafed36`).
- **Branch / worktree:** `sonnet/issue-243`, `D:\dev\afldb-issue-243`.

## 1. Live evidence (operator-run, 2026-09-25)

| Step | DSN variable | Connected | Outcome |
|---|---|---|---|
| A2.1 source | `AFLDB_TEST_DATABASE_URL` | `afldb_test` / `afldb_owner`, migration parity 104/104 | **FAIL**: the DEV checkout held exactly two untracked settle manifests, `docs/rebuild-manifests/afltables_fitzroy_core/settle-2026-2026-09-15-2201.json` and `…-2203.json` |
| A2.2 owner | `AFLDB_OWNER_DATABASE_URL` | `afldb_dev` / `afldb_owner` | **FAIL**: `mode 'promotion' requires a *_test source database` |
| A2.3 import | `AFLDB_IMPORT_DATABASE_URL` | `afldb_dev` / `afldb_import` | **FAIL**: the same `*_test` refusal, then `permission denied for schema afldb_meta` |
| A2.4 backup | `AFLDB_BACKUP_DATABASE_URL` | `afldb_dev` / `afldb_backup` | **FAIL**: the same `*_test` refusal |

No L4 step after A2 ran. There was no dump, no candidate and no swap.

## 2. Root cause

1. **A2.1: dirty-tree rule.** `checkGit()` counted every `git status` line and failed any
   non-`read-only` mode on a non-empty count. The nightly `afldb-settle-afltables` unit writes
   `settle-<season>-<stamp>.json` under `docs/rebuild-manifests/afltables_fitzroy_core/`, and its
   service grants `ReadWritePaths` there. So a live DEV checkout carries them by design.
   `deploy/sync-dev-remote.sh` (`afldb_is_known_operational_artifact`) already classifies exactly
   these paths as known operational artefacts. The preflight had no classifier.
2. **A2.2–A2.4: no target concept.** `defaultsFor()` gave `promotion` the same defaults as
   `rebuild` (`AFLDB_TEST_DATABASE_URL` / `afldb_test`). `databaseTargetProblems()` then refused
   any promotion database whose name does not end in `_test`. A promotion target check against
   `afldb_dev` could therefore never pass.
   - A2.2 and A2.3 as documented also omitted `--expect-database`, so the defaulted `afldb_test`
     was a second mismatch.
   - Those three commands ran in the same DEV checkout, so the A2.1 dirty-tree FAIL applied to
     them as well.
3. **A2.3: unconditional ledger read.** After the identity query, `checkDatabase()` always read
   `afldb_meta.schema_migrations`. `afldb_import` has no `afldb_meta` access, and should not: it
   is not part of the import-role contract. `afldb_backup` can read it, so A2.4 failed only on the
   `*_test` rule.

## 3. Contract (implemented)

`--mode promotion` now requires an explicit `--promotion-side source|target`. The side is never
inferred from a role name, a DSN variable or DSN text.

| | `source` | `target` |
|---|---|---|
| Database | `*_test`. The default is `AFLDB_TEST_DATABASE_URL` / `afldb_test` | Exactly `afldb_dev` (`--environment dev`) or `afldb_prod` (`--environment prod`), and never `*_test` |
| `--dsn-env` | Optional (defaults as above) | **Required**: the credential under test |
| `--expect-role` | Exact when supplied | Exact when supplied |
| Migration parity | **Required**: ledger read and compared with the checkout | **Not read.** An INFO line says so. The target is replaced, so the source's parity is the gate, and a restricted import/backup credential needs no `afldb_meta` access |

**Refused before any database contact** (argument errors, exit 1):

- `--mode promotion` without `--promotion-side`;
- `--promotion-side` with any other mode;
- an unknown side value;
- `source` with an `--expect-database` that is not `*_test`, such as `afldb_dev`;
- `target` with an `--expect-database` other than the environment's database. For example,
  `--environment dev --expect-database afldb_prod` or `afldb_test` refuses, and so does
  `--environment prod --expect-database afldb_dev`;
- `target` without `--dsn-env`.

**After connection,** the identity check still refuses a database or role mismatch on both sides.
`databaseTargetProblems()` given `promotion` with no side keeps the strict source rule. Rebuild and
deploy logic is unchanged.

## 4. Working-tree classification (implemented)

`git status --porcelain=v1 -z --untracked-files=all` is now parsed per entry
(`classifyWorktreeStatus`). The output is kept raw, because trimming would eat the leading space of
an unstaged ` M`. Only **promotion** mode classifies:

- **Known operational artefact → WARN (listed, not a blocker).** This must be an **untracked**
  (`??`) path matching exactly
  `^docs/rebuild-manifests/afltables_fitzroy_core/settle-[A-Za-z0-9][A-Za-z0-9._-]*\.json$`.
- **FAIL:**
  - any tracked modification, including one to an allowlisted path;
  - any staged change, including a staged settle manifest;
  - a rename or copy;
  - any other untracked path, such as a source, config, script or migration file, or arbitrary
    JSON or CSV. This includes the deploy-only allowlist entries.

The allowlist is **narrower** than the deploy classifier on purpose. `.deploy-backups/`,
`FETCH_HEAD`, `.env.bak-*` and `afldb-ui-questions-*.csv` are not accepted by promotion. The single
pattern is the byte-identical regex `deploy/sync-dev-remote.sh` uses. A test asserts the deploy
script still contains it, so the two cannot drift. The bash helper runs on the remote host, and the
TypeScript preflight cannot source it.

The behaviour of `implementation`, `merge`, `rebuild` and `deploy` is unchanged: any dirty path
still FAILs. `read-only` still WARNs.

## 5. Changed files

- `tools/dev/preflight-core.ts` adds:
  - `PromotionSide`, `--promotion-side` parsing and the pre-DB combination refusals;
  - `promotionTargetDatabase`;
  - the side-aware `databaseTargetProblems`, `requiresMigrationParity` and
    `probeDatabase` (an injectable identity/ledger probe);
  - `migrationFindingStatus`;
  - `PROMOTION_OPERATIONAL_ARTIFACT_PATTERNS`, `isPromotionOperationalArtifact`,
    `classifyWorktreeStatus` and `worktreeFinding`.
- `tools/dev/preflight.ts`:
  - `checkGit` uses `worktreeFinding` on raw `-z` output;
  - `checkDatabase` delegates to `probeDatabase`;
  - the usage text documents the sides.
- `tests/workflow-preflight.test.ts` adds 10 cases (below).
- `docs/production-promotion.md` §3 has the source and target preflight commands.
- `issues/open/AFLDB-ISSUE-237.md` §11d: the A2 commands were corrected, and the first real A2
  attempt is recorded.
- Tracking: `issues.md`, `IssuesIndex.md` and `CHANGELOG.md`.

## 6. Tests (`tests/workflow-preflight.test.ts`, DB-free)

`AFLDB-ISSUE-243 promotion source vs target preflight` covers:

- source defaults to `afldb_test`; target/dev resolves to `afldb_dev` and target/prod to
  `afldb_prod`;
- invalid combinations throw at argument parsing:
  - target/dev with `afldb_prod`, and with `afldb_test`;
  - target/prod with `afldb_dev`;
  - source with `afldb_dev`;
  - target without `--dsn-env`;
  - promotion without a side;
  - an unknown side;
  - a side with each of the five other modes;
- connected-identity verdicts:
  - source accepts `afldb_test` and refuses `afldb_dev`;
  - target/dev accepts `afldb_dev` and refuses `afldb_prod`;
  - target/prod accepts `afldb_prod` and refuses `afldb_dev`;
  - an exact role mismatch refuses;
  - rebuild is unchanged, and a side-less promotion stays strict;
- target `afldb_import` and target `afldb_backup` pass with a ledger probe that throws
  `permission denied for schema afldb_meta`. The probe is **never called**. The same proof holds
  for target/prod, and a target/dev credential connected to `afldb_prod` FAILs;
- the source reads the ledger, and parity is PASS at 1/1. An empty ledger FAILs, a denied ledger
  read propagates as an error, and a role mismatch FAILs.

`AFLDB-ISSUE-243 promotion working-tree classification` covers:

- the pattern is byte-identical to `deploy/sync-dev-remote.sh`;
- the two live settle manifests give WARN, and a clean tree gives PASS;
- FAIL for:
  - a tracked or staged settle manifest;
  - a staged or unstaged source change;
  - an untracked migration;
  - an unknown file;
  - JSON beside the manifests;
  - an `afl_api` manifest;
  - the deploy-only CSV and `.env.bak-*`;
  - a known manifest plus an unknown file;
  - a rename;
- rebuild, deploy, implementation and merge still FAIL on a settle manifest, and read-only still
  WARNs;
- real `git status -z` output from a scratch repository: two manifests give WARN, and adding a
  tracked edit gives FAIL with the path named.

## 7. Validation (Claude-run, DB-free, 2026-09-25)

- `npx tsc --noEmit`: exit 0.
- `npx vitest run tests/workflow-preflight.test.ts`: 34/34 (24 existing plus 10 new).
- `npx vitest run tests/db-promotion-check.test.ts`: 189/189. It imports
  `promotion-inventory`, which the preflight also uses.
- `npx vitest run tests/data-overrides-source-contract.test.ts`: 65/65. It reads
  `docs/production-promotion.md`.
- `npx eslint tools/dev/preflight-core.ts tools/dev/preflight.ts tests/workflow-preflight.test.ts`:
  clean.
- `git diff --check`: clean.
- CLI argument refusals, which exit before any Git, `.env` or database step:
  - `--mode promotion --promotion-side target --environment dev --dsn-env AFLDB_OWNER_DATABASE_URL
    --expect-database afldb_prod` gives `FAIL arguments: promotion target for environment 'dev' is
    exactly 'afldb_dev', got --expect-database 'afldb_prod'.`, exit 1;
  - `--mode rebuild --promotion-side source` gives `FAIL arguments: --promotion-side is only valid
    with --mode promotion, not 'rebuild'.`

A local `node_modules` junction to `D:\dev\afldb\node_modules` was created so the suites could
run. It is gitignored and does not appear in `git status`.

## 8. Corrected ISSUE-237 L4 A2 commands (DEV host, `~/projects/afldb`)

```bash
npm run preflight -- --mode promotion --environment dev --promotion-side source \
  --dsn-env AFLDB_TEST_DATABASE_URL --expect-database afldb_test --expect-role afldb_owner
npm run preflight -- --mode promotion --environment dev --promotion-side target \
  --dsn-env AFLDB_OWNER_DATABASE_URL --expect-database afldb_dev --expect-role afldb_owner
npm run preflight -- --mode promotion --environment dev --promotion-side target \
  --dsn-env AFLDB_IMPORT_DATABASE_URL --expect-database afldb_dev --expect-role afldb_import
npm run preflight -- --mode promotion --environment dev --promotion-side target \
  --dsn-env AFLDB_BACKUP_DATABASE_URL --expect-database afldb_dev --expect-role afldb_backup
```

Expected results:

- Each prints `Preflight result: READY`.
- The two settle manifests show as `WARN working tree holds only known operational artefacts`.
- The three target runs print `INFO migration parity not read on a promotion target`.
- Any `FAIL` is a stop.

## 9. Next action

1. The operator reviews and commits.
2. Merge and deploy to DEV, so the DEV checkout carries this preflight.
3. Rerun ISSUE-237 L4 A2 with the §8 commands, under the separate ISSUE-237 L4 DEV authorisation.
4. Resolve this issue on that evidence: all four READY on DEV, with no other L4 step implied.

## 10. Closure audit against ISSUE-237 L4 (2026-09-26, DB-free, Claude-run): REMAINS OPEN

*(Historical. Superseded by the §11 resolution the same day.)*

- **Implementation state.** Committed `4df98d07`, which is contained in every later DEV deployment
  (`4bb23a8f`, `397f422d`, `6ae70722`).
- **Recorded progression.** After the fix, L4 went past A2 on at least three later runs:
  - the second attempt (ISSUE-237 §11d.12: A3 PASS, then STOP at A4.3);
  - the rolled-back `20260926-033212` run;
  - the accepted `20260926-085511` run (§11d.15).

  The record does not say whether the A5 attempt (§11d.14) re-ran A2.

  §11d A2 says "Every `FAIL` is a stop", so the operator saw no FAIL each time.
- **Missing (NOT RECORDED; the step ran).** §11d.12 states that "the A2 preflight results belong to
  AFLDB-ISSUE-243 and are recorded there", but this runbook holds none of them. No repository
  record carries any of:
  - the four `Preflight result: READY` lines;
  - the source parity line;
  - the three `INFO migration parity not read on a promotion target` lines (the proof that the
    restricted `afldb_import`/`afldb_backup` roles need no `afldb_meta` read);
  - the settle-manifest `WARN` classification.

  §9.4 resolves on "all four READY on DEV". Progression without FAIL is not the same evidence,
  because it does not show the WARN/INFO lines. The criterion is therefore not met on the record.
- **Closure path (operator, read-only).** Either option closes this issue on its own wording; no L4
  step is implied:
  - paste the four A2 outputs from any of those runs, if kept; or
  - rerun the four §8 commands on DEV now. They open read-only connections and write nothing.

## 11. Resolution (2026-09-26): RESOLVED on four READY §8 preflights

The operator reran the four read-only §8 preflights on DEV (`~/projects/afldb`) at revision
`dd7e28a6` with Node v22.23.2. This record was written from that operator-supplied evidence; no
command was run to write it. The earlier L4 A2 console output was not retained and is not claimed.

| # | Side | `--dsn-env` | Expected database / role | Result |
|---|---|---|---|---|
| 1 | source | `AFLDB_TEST_DATABASE_URL` | `afldb_test` / `afldb_owner` | migration parity **104/104**; **READY**, 0 blockers, 2 warnings |
| 2 | target | `AFLDB_OWNER_DATABASE_URL` | `afldb_dev` / `afldb_owner` | `INFO migration parity not read on a promotion target`; **READY**, 0 blockers, 2 warnings |
| 3 | target | `AFLDB_IMPORT_DATABASE_URL` | `afldb_dev` / `afldb_import` | same target parity INFO; **READY**, 0 blockers, 2 warnings |
| 4 | target | `AFLDB_BACKUP_DATABASE_URL` | `afldb_dev` / `afldb_backup` | same target parity INFO; **READY**, 0 blockers, 2 warnings |

All four runs also:

- recognised `main` as valid for promotion, contained current local `main`, and reported
  `origin/main` ahead 0 / behind 0;
- passed the migration-name collision check and the promotion plan/disposition contract;
- kept exactly three known, untracked operational rebuild-manifest artefacts as warnings, not
  blockers;
- performed no write, migration, plan write, deploy or service action.

**Closure basis.** §9.4's criterion (all four READY on DEV, with no other L4 step implied) is met,
and so is §10's: the target INFO lines prove that the restricted `afldb_import` and `afldb_backup`
credentials pass without an `afldb_meta` read, and the operational manifests are classified as
warnings. AFLDB-ISSUE-237 remains OPEN. No PROD action is implied.
